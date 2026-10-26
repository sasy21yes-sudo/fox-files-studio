/**
 * Real reviews started from the Team page: Salvatore asks an agent (or the producer) to review and it does.
 *
 *   POST /api/team/review { agent, lang?, aspect?, request?, reply? } -> { started } | { error }
 *   GET  /api/team/jobs -> { [agent]: { state, lang, aspect, startedAt, finishedAt?, error? } }
 *
 * The job (1) builds the review kit (tools/qa/review_kit.mjs) when there is none for that language and format or the
 * episode changed after it, then (2) runs the agent as the local Claude Code CLI with its own file
 * (.claude/agents/<name>.md: role, Budget, tools and model from its frontmatter) in the repository, where it reads the
 * kit and posts its findings with tools/team/chat.mjs; its final summary is posted to Salvatore. The producer runs the
 * /review-episode skill instead (it briefs and runs the agents the change needs). Also started by teamAsk.ts when a
 * private message asks for a review.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { loadEnv, type Plugin } from 'vite';
import { SESSION_VARS, findClaudeCode } from './claudeScene';
// @ts-expect-error - plain ESM tool without types
import { postChat } from '../team/chat.mjs';

/** Chat name -> agent file in .claude/agents. */
export const AGENTS: Record<string, string> = {
  rig: 'rig-animation-inspector',
  viewer: 'first-time-viewer',
  social: 'social-media-manager',
  editor: 'video-editor',
  sound: 'sound-designer',
  facts: 'fact-checker',
  art: 'art-director',
  l10n: 'localization-qa',
};
const MODELS: Record<string, string> = { sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5', haiku: 'claude-haiku-5-5' };
const EPISODE = 'episodes/mkultra-secret-experiments.foxproj.json';
const KIT_MINUTES = 25;
const REVIEW_MINUTES = 40;

export interface Job {
  state: 'kit' | 'review' | 'done' | 'error';
  lang: string;
  aspect: string;
  startedAt: number;
  finishedAt?: number;
  error?: string;
}
const jobs: Record<string, Job> = {};

export interface ReviewRequest {
  agent: string;
  lang?: string;
  aspect?: string;
  request?: string;
  reply?: number;
}

const json = (res: ServerResponse, status: number, b: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(b));
};
const body = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let d = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => (d += c));
    req.on('end', () => resolve(d));
    req.on('error', reject);
  });

function run(cmd: string, args: string[], opts: { cwd: string; input?: string; minutes: number; env?: NodeJS.ProcessEnv }) {
  return new Promise<{ code: number | null; out: string; err: string }>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), opts.minutes * 60000);
    child.stdout.setEncoding('utf8').on('data', (c: string) => (out += c));
    child.stderr.setEncoding('utf8').on('data', (c: string) => (err += c));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
    child.stdin.end(opts.input ?? '');
  });
}

/** Frontmatter field of an agent file ("tools: Read, Glob" -> "Read, Glob"). */
const front = (text: string, key: string) => new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(text.split(/^---\s*$/m)[1] ?? '')?.[1].trim();

export function startReview(root: string, bin: string, r: ReviewRequest): string | null {
  const who = r.agent;
  if (who !== 'producer' && !AGENTS[who]) return 'unknown agent';
  if (jobs[who] && (jobs[who].state === 'kit' || jobs[who].state === 'review')) return `${who} is already reviewing`;
  const episodeFile = path.join(root, EPISODE);
  const ep = JSON.parse(fs.readFileSync(episodeFile, 'utf8')) as { settings?: { language?: string; aspect?: string } };
  const lang = r.lang ?? ep.settings?.language ?? 'it';
  const aspect = r.aspect ?? ep.settings?.aspect ?? '16:9';
  const job: Job = { state: 'kit', lang, aspect, startedAt: Date.now() };
  jobs[who] = job;
  const say = (text: string, kind = 'note') => postChat({ from: who, to: 'salvatore', kind, reply: r.reply, text, max: 1200 });
  void (async () => {
    try {
      // 1. The review kit, rebuilt when the episode changed after it.
      const kit = path.join(root, 'qa-out', 'review', `${lang}_${aspect.replace(':', 'x')}`);
      const stamp = path.join(kit, 'timeline.json');
      if (!fs.existsSync(stamp) || fs.statSync(stamp).mtimeMs < fs.statSync(episodeFile).mtimeMs) {
        say(`Preparo il kit di revisione (${lang}, ${aspect}): fotogrammi, audio e timeline. Ci vuole qualche minuto.`);
        const k = await run(process.execPath, ['tools/qa/review_kit.mjs', lang, aspect], { cwd: root, minutes: KIT_MINUTES });
        if (k.code !== 0) throw new Error(`il kit non si è costruito: ${(k.err || k.out).trim().split('\n').slice(-2).join(' ')}`);
      }
      job.state = 'review';
      say(`Kit pronto (${path.relative(root, kit).replace(/\\/g, '/')}). Inizio la review: i problemi li scrivo qui mentre li trovo.`);
      // 2. The agent itself, with its own file, tools and model, in the repository.
      const childEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SESSION_VARS.test(k)));
      const asked = r.request?.trim() ? `Salvatore ti ha chiesto: «${r.request.trim()}»` : 'Salvatore ti ha chiesto una review completa della tua area.';
      let args: string[];
      let prompt: string;
      if (who === 'producer') {
        prompt = `/review-episode ${lang} ${aspect} - ${asked} Il kit è già pronto in ${path.relative(root, kit).replace(/\\/g, '/')}.`;
        args = ['-p', '--output-format', 'json', '--model', MODELS.opus, '--setting-sources', 'project', '--allowedTools', 'Read', 'Glob', 'Grep', 'Bash', 'Write', 'Agent', 'WebFetch'];
      } else {
        const file = fs.readFileSync(path.join(root, '.claude', 'agents', `${AGENTS[who]}.md`), 'utf8');
        const tools = (front(file, 'tools') ?? 'Read, Glob, Grep, Bash, Write').split(/\s*,\s*/).filter(Boolean);
        const sys = path.join(os.tmpdir(), `fox-review-${who}.md`);
        fs.writeFileSync(
          sys,
          `${file.replace(/^---[\s\S]*?---\s*/, '')}\n\n# Now\nYou were started from the studio's Team page. Your chat name is \`${who}\`. Work in the repository (cwd). The review kit is in ${path.relative(root, kit).replace(/\\/g, '/')}/. Post each finding as it is confirmed with \`node tools/team/chat.mjs post ${who} "<text>" --to all --kind finding --sev B|I|R --at <seconds>\` (Italian, one line). Write your report where your file says. Your final answer is a summary for Salvatore in Italian: at most 6 lines, the most serious problems first, with seconds.`,
        );
        prompt = `${asked}\nFai la review adesso sul kit ${lang} ${aspect}, seguendo il tuo file (Budget compreso).`;
        args = ['-p', '--output-format', 'json', '--system-prompt-file', sys, '--model', MODELS[front(file, 'model') ?? 'sonnet'] ?? MODELS.sonnet, '--tools', tools.join(','), '--allowedTools', ...tools, '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence'];
      }
      const res = await run(bin, args, { cwd: root, input: prompt, minutes: REVIEW_MINUTES, env: childEnv });
      const j = (() => {
        try {
          return JSON.parse(res.out) as { result?: string; is_error?: boolean; total_cost_usd?: number };
        } catch {
          return null;
        }
      })();
      if (!j || j.is_error || !j.result?.trim()) throw new Error(j?.result || res.err.trim().split('\n').slice(-2).join(' ') || 'nessuna risposta');
      job.state = 'done';
      job.finishedAt = Date.now();
      const mins = Math.max(1, Math.round((job.finishedAt - job.startedAt) / 60000));
      say(`Review finita (${mins} min${j.total_cost_usd ? `, ~$${j.total_cost_usd.toFixed(2)}` : ''}).\n${j.result.trim()}`, 'answer');
    } catch (e) {
      job.state = 'error';
      job.finishedAt = Date.now();
      job.error = e instanceof Error ? e.message : String(e);
      say(`Non sono riuscito a fare la review: ${job.error}`);
    }
  })();
  return null;
}

export function teamReview(): Plugin {
  return {
    name: 'fox-team-review',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      const bin = findClaudeCode(loadEnv(server.config.mode, root, ''));
      server.middlewares.use('/api/team/jobs', (_req, res) => json(res, 200, jobs));
      server.middlewares.use('/api/team/review', async (req, res) => {
        if (req.method !== 'POST') return json(res, 404, { error: 'not found' });
        if (!bin) return json(res, 503, { error: 'Claude Code non trovato su questo computer.' });
        try {
          const error = startReview(root, bin, JSON.parse(await body(req)) as ReviewRequest);
          return error ? json(res, 409, { error }) : json(res, 200, { started: true });
        } catch (e) {
          json(res, 500, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}
