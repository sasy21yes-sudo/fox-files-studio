/**
 * Dev-server side of the Tools page: the skills installed in .claude/skills, and their bundled scripts run locally.
 *
 *   GET  /api/tools/skills -> [{ id, name, description, body, scripts: [{ file, usage }], source }]
 *   POST /api/tools/run    <- { skill, script, args: string[] } -> { code, stdout, stderr }
 *
 * Only Python files inside that skill's folder run, with python and an argument list (no shell); 90 s at most.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';

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
          json(res, 404, { error: 'not found' });
        } catch (e) {
          json(res, 500, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}
