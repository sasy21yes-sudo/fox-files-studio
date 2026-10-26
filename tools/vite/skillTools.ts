/**
 * Dev-server side of the Tools page: the skills installed in .claude/skills, and their bundled scripts run locally.
 *
 *   GET  /api/tools/skills -> [{ id, name, description, body, scripts: [{ file, usage }], source }]
 *   POST /api/tools/run    <- { skill, script, args: string[] } -> { code, stdout, stderr }
 *   POST /api/tools/ask    <- { skill, text } -> { answer, cost }   (Claude follows the skill, answers in Italian)
 *
 * Only Python files inside that skill's folder run, with python and an argument list (no shell); 90 s at most.
 * "ask" runs the local Claude Code CLI headless with the skill's SKILL.md as its instructions, in the repository,
 * Sonnet at medium effort, tools to read files, search the web and run Python (the skill's scripts): no editing.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { loadEnv, type Plugin } from 'vite';
import { SESSION_VARS, findClaudeCode } from './claudeScene';

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

/** name/description from the SKILL.md frontmatter (folded `>-` values included). */
function frontmatter(md: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  const out: Record<string, string> = {};
  if (!m) return out;
  let key = '';
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(\w[\w-]*):\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1];
      out[key] = kv[2] === '>-' || kv[2] === '>' || kv[2] === '|' ? '' : kv[2];
    } else if (key && line.trim()) out[key] = `${out[key]} ${line.trim()}`.trim();
  }
  return out;
}

/** The usage lines of a script: its module docstring. */
function usage(file: string): string {
  const src = fs.readFileSync(file, 'utf8');
  const m = /^(?:#![^\n]*\n)?(?:#[^\n]*\n)*\s*(?:"""|''')([\s\S]*?)(?:"""|''')/.exec(src);
  return (m?.[1] ?? '').trim().slice(0, 1600);
}

export function skillTools(): Plugin {
  return {
    name: 'fox-skill-tools',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      const dir = path.join(root, '.claude', 'skills');
      const bin = findClaudeCode(loadEnv(server.config.mode, root, ''));
      const asking = new Set<string>();
      server.middlewares.use('/api/tools', async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://x');
          if (req.method === 'GET' && url.pathname === '/skills') {
            const list = fs
              .readdirSync(dir, { withFileTypes: true })
              .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'SKILL.md')))
              .map((d) => {
                const md = fs.readFileSync(path.join(dir, d.name, 'SKILL.md'), 'utf8');
                const fm = frontmatter(md);
                const walk = (p: string): string[] =>
                  fs.readdirSync(p, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(p, e.name)) : e.name.endsWith('.py') ? [path.join(p, e.name)] : []));
                const scripts = walk(path.join(dir, d.name))
                  .map((f) => ({ file: path.relative(path.join(dir, d.name), f).replace(/\\/g, '/'), usage: usage(f) }))
                  .filter((s) => !/(^|\/)(test_|_)/.test(s.file));
                const installed = ['INSTALLED.md', '../_youtube-agent/INSTALLED.md'].map((f) => path.join(dir, d.name, f)).find((f) => fs.existsSync(f) && (d.name.startsWith('yt-') || !f.includes('_youtube-agent')));
                return {
                  id: d.name,
                  name: fm.name || d.name,
                  description: fm.description || '',
                  body: md.replace(/^---[\s\S]*?---\s*/, ''),
                  scripts,
                  source: installed ? fs.readFileSync(installed, 'utf8').split('\n')[0] : 'Made for this project',
                };
              });
            return json(res, 200, list);
          }
          if (req.method === 'POST' && url.pathname === '/run') {
            const b = JSON.parse(await body(req)) as { skill: string; script: string; args?: string[] };
            if (!/^[\w-]+$/.test(b.skill)) return json(res, 400, { error: 'bad skill' });
            const file = path.resolve(dir, b.skill, b.script);
            if (!file.startsWith(path.join(dir, b.skill) + path.sep) || !file.endsWith('.py') || !fs.existsSync(file)) return json(res, 400, { error: 'bad script' });
            const args = (b.args ?? []).map(String).slice(0, 40);
            const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
              const p = spawn('python', [file, ...args], { cwd: root, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
              let stdout = '';
              let stderr = '';
              const timer = setTimeout(() => p.kill(), 90000);
              p.stdout.on('data', (c) => (stdout += c));
              p.stderr.on('data', (c) => (stderr += c));
              p.on('close', (code) => {
                clearTimeout(timer);
                resolve({ code, stdout: stdout.slice(0, 200000), stderr: stderr.slice(0, 20000) });
              });
              p.on('error', (e) => resolve({ code: -1, stdout: '', stderr: String(e) }));
            });
            return json(res, 200, result);
          }
          if (req.method === 'POST' && url.pathname === '/ask') {
            const b = JSON.parse(await body(req)) as { skill: string; text: string };
            if (!/^[\w-]+$/.test(b.skill) || !fs.existsSync(path.join(dir, b.skill, 'SKILL.md'))) return json(res, 400, { error: 'skill sconosciuta' });
            if (!b.text?.trim()) return json(res, 400, { error: 'scrivi cosa vuoi fare' });
            if (!bin) return json(res, 503, { error: 'Claude Code non trovato su questo computer.' });
            if (asking.has(b.skill)) return json(res, 409, { error: 'sta già lavorando a una richiesta' });
            asking.add(b.skill);
            try {
              const md = fs.readFileSync(path.join(dir, b.skill, 'SKILL.md'), 'utf8').replace(/^---[\s\S]*?---\s*/, '');
              const sys = path.join(os.tmpdir(), `fox-skill-${b.skill}.md`);
              fs.writeFileSync(
                sys,
                `${md}\n\n# Now\nYou run from the studio's Tools page for Salvatore, who may not know this skill. The skill's folder is .claude/skills/${b.skill}/ (its scripts run with python). The project is The Fox Files (episodes/, channel/channel.json, src/data/sources.ts). Do what he asks following the skill, then answer in Italian, in plain words, with headings and short lists. Never invent facts or numbers; say what you could not check. Never send, publish or post anything.`,
              );
              const tools = ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Bash(python:*)', 'Bash(py:*)'];
              const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SESSION_VARS.test(k)));
              const out = await new Promise<string>((resolve, reject) => {
                const p = spawn(bin, ['-p', '--output-format', 'json', '--system-prompt-file', sys, '--model', 'claude-sonnet-5-5', '--effort', 'medium', '--allowedTools', ...tools, '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence'], { cwd: root, env, windowsHide: true });
                let o = '';
                let e = '';
                const timer = setTimeout(() => p.kill(), 10 * 60000);
                p.stdout.setEncoding('utf8').on('data', (c: string) => (o += c));
                p.stderr.setEncoding('utf8').on('data', (c: string) => (e += c));
                p.on('error', reject);
                p.on('close', () => {
                  clearTimeout(timer);
                  o.trim() ? resolve(o) : reject(new Error(e.trim().split('\n').slice(-2).join(' ') || 'nessuna risposta'));
                });
                p.stdin.end(b.text.trim());
              });
              const j = JSON.parse(out) as { result?: string; is_error?: boolean; total_cost_usd?: number };
              if (j.is_error || !j.result?.trim()) return json(res, 502, { error: j.result || 'nessuna risposta' });
              return json(res, 200, { answer: j.result.trim(), cost: j.total_cost_usd });
            } finally {
              asking.delete(b.skill);
            }
          }
          json(res, 404, { error: 'not found' });
        } catch (e) {
          json(res, 500, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}
