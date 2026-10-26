/**
 * Live replies in the Team page's private chats: Salvatore writes to one agent, the agent answers in the chat.
 *
 *   POST /api/team/ask { agent, id, deep? } -> { reply, usage }   (id: the message to answer)
 *
 * The agent is the local Claude Code CLI run headless (the same login as "Ask Claude", no API key), with the agent's
 * file (.claude/agents/<file>.md) as its system prompt and only the last lines of that private chat plus the team
 * brief as context: Sonnet, low effort, no tools - a few thousand tokens a reply. deep: true lets it read the
 * repository (Read, Grep, Glob only) for questions about the episode's files, at a higher cost.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { loadEnv, type Plugin } from 'vite';
import { SESSION_VARS, findClaudeCode } from './claudeScene';
// @ts-expect-error - plain ESM tool without types
import { readChat, postChat, formatLine } from '../team/chat.mjs';

/** Chat name -> agent file (and the producer, who speaks for the review skill). */
const AGENTS: Record<string, string> = {
  rig: 'rig-animation-inspector',
  viewer: 'first-time-viewer',
  social: 'social-media-manager',
  editor: 'video-editor',
  sound: 'sound-designer',
  facts: 'fact-checker',
  art: 'art-director',
  l10n: 'localization-qa',
};

interface Msg {
  id: number;
  from: string;
  to: string;
  text: string;
}

const body = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let d = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => (d += c));
    req.on('end', () => resolve(d));
    req.on('error', reject);
  });
const json = (res: ServerResponse, status: number, b: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(b));
};

export function teamAsk(): Plugin {
  return {
    name: 'fox-team-ask',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      const env = loadEnv(server.config.mode, root, '');
      const bin = findClaudeCode(env);
      const work = path.join(os.tmpdir(), 'fox-team-ask');
      fs.mkdirSync(work, { recursive: true });
      const busy = new Set<string>();
      server.middlewares.use('/api/team/ask', async (req, res) => {
        if (req.method !== 'POST') return json(res, 404, { error: 'not found' });
        try {
          if (!bin) return json(res, 503, { error: 'Claude Code was not found on this computer.' });
          const b = JSON.parse(await body(req)) as { agent: string; id: number; deep?: boolean };
          const who = b.agent;
          const file = who === 'producer' ? path.join(root, '.claude', 'skills', 'review-episode', 'SKILL.md') : AGENTS[who] && path.join(root, '.claude', 'agents', `${AGENTS[who]}.md`);
          if (!file || !fs.existsSync(file)) return json(res, 400, { error: 'unknown agent' });
          if (busy.has(who)) return json(res, 409, { error: `${who} is already answering` });
          busy.add(who);
          try {
            const all = readChat() as Msg[];
            const dm = all.filter((m) => (m.from === 'salvatore' && m.to === who) || (m.from === who && m.to === 'salvatore')).slice(-12);
            const brief = all.filter((m) => m.from === 'producer' && (m.to === 'all' || m.to === who)).slice(-3);
            const question = all.find((m) => m.id === b.id);
            const role = fs.readFileSync(file, 'utf8').replace(/^---[\s\S]*?---\s*/, '');
            const system = `${role}\n\n# Now: the studio's Team chat\nYou are chatting privately with Salvatore, the owner, on the studio's Team page. Answer in Italian, plainly, in at most 6 short sentences (or a short list). Say what you would check or change and where (file, second); if a question needs a measurement you cannot make in this chat, say which one and offer to run it in the next review. Never invent facts, numbers or quotes.`;
            const user = [
              brief.length ? `Team brief:\n${brief.map(formatLine).join('\n')}` : '',
              `Your private chat with Salvatore (oldest first):\n${dm.map(formatLine).join('\n')}`,
              `Reply to #${question?.id}: ${question?.text ?? ''}`,
            ]
              .filter(Boolean)
              .join('\n\n');
            const sys = path.join(work, `${who}.md`);
            fs.writeFileSync(sys, system);
            const tools = b.deep ? ['Read', 'Grep', 'Glob'] : [];
            const args = ['-p', '--output-format', 'json', '--system-prompt-file', sys, '--model', 'claude-sonnet-5-5', '--effort', 'low', '--tools', tools.join(','), ...(tools.length ? ['--allowedTools', ...tools] : []), '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence'];
            const childEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SESSION_VARS.test(k)));
            const out = await new Promise<string>((resolve, reject) => {
              const child = spawn(bin, args, { cwd: b.deep ? root : work, env: childEnv, windowsHide: true });
              let o = '';
              let e = '';
              const timer = setTimeout(() => child.kill(), 240000);
              child.stdout.setEncoding('utf8').on('data', (c: string) => (o += c));
              child.stderr.setEncoding('utf8').on('data', (c: string) => (e += c));
              child.on('error', reject);
              child.on('close', () => {
                clearTimeout(timer);
                o.trim() ? resolve(o) : reject(new Error(e.trim().split('\n').slice(-2).join(' ') || 'no answer'));
              });
              child.stdin.end(user);
            });
            const j = JSON.parse(out) as { result?: string; is_error?: boolean; usage?: Record<string, number>; total_cost_usd?: number };
            if (j.is_error || !j.result?.trim()) return json(res, 502, { error: j.result || 'no answer' });
            // The chat keeps one line per message; the full answer lives in the chat file up to its cap.
            const { message } = postChat({ from: who, to: 'salvatore', kind: 'answer', reply: b.id, text: j.result.trim(), max: 1200 });
            return json(res, 200, { reply: message, usage: j.usage, cost: j.total_cost_usd });
          } finally {
            busy.delete(who);
          }
        } catch (e) {
          json(res, 500, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}
