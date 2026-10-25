/**
 * Dev-server side of the Channel page: the channel's brand file and the YouTube checks, run with the scripts of
 * the youtube-agent skills (.claude/skills/yt-*, MIT, stdlib-only Python).
 *
 *   GET  /api/channel                       -> channel/channel.json ({} when missing)
 *   PUT  /api/channel                       <- the channel info (name, handle, descriptions, keywords...)
 *   POST /api/channel/lint                  <- { titles: [{title, thumb}], hooks: [text] } -> title.py + hookscore.py
 *   GET  /api/channel/retention?id=&format= -> the saved YouTube Studio retention export, analysed (retention.py)
 *   POST /api/channel/retention?id=&format= <- { csv, srt } : saves the export, returns the analysis
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
const py = (args: string[], cwd: string) =>
  new Promise<string>((resolve, reject) => {
    const p = spawn('python', args, { cwd, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    let out = '';
    let err = '';
    p.stdout.on('data', (c) => (out += c));
    p.stderr.on('data', (c) => (err += c));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim().split('\n').slice(-2).join(' ') || `exit ${code}`))));
  });
const safeId = (s: string | null) => (s && /^[\w-]{1,80}$/.test(s) ? s : null);

export function channelTools(): Plugin {
  return {
    name: 'fox-channel',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      const dir = path.join(root, 'channel');
      const skills = path.join(root, '.claude', 'skills');
      const file = path.join(dir, 'channel.json');
      server.middlewares.use('/api/channel', async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://x');
          if (url.pathname === '/' || url.pathname === '') {
            if (req.method === 'GET') return json(res, 200, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
            if (req.method === 'PUT') {
              const c = JSON.parse(await body(req));
              fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(file, JSON.stringify(c, null, 2) + '\n');
              return json(res, 200, { ok: true });
            }
          }
          if (url.pathname === '/lint' && req.method === 'POST') {
            const b = JSON.parse(await body(req)) as { titles: { title: string; thumb?: string }[]; hooks: string[] };
            const titles = await Promise.all(
              (b.titles ?? []).slice(0, 8).map(async (t) => JSON.parse(await py([path.join(skills, 'yt-package', 'title.py'), '--title', t.title, ...(t.thumb ? ['--thumb', t.thumb] : []), '--json'], root))[0]),
            );
            const hooks = await Promise.all((b.hooks ?? []).slice(0, 4).map(async (h) => JSON.parse(await py([path.join(skills, 'yt-script', 'hookscore.py'), '--hook', h, '--json'], root))[0]));
            return json(res, 200, { titles, hooks });
          }
          if (url.pathname === '/retention') {
            const id = safeId(url.searchParams.get('id'));
            const format = url.searchParams.get('format') === 'short' ? 'short' : 'long';
            if (!id) return json(res, 400, { error: 'bad id' });
            const base = path.join(dir, 'analytics', `${id}-${format}`);
            if (req.method === 'POST') {
              const b = JSON.parse(await body(req)) as { csv: string; srt?: string };
              if (!b.csv?.trim()) return json(res, 400, { error: 'empty csv' });
              fs.mkdirSync(path.dirname(base), { recursive: true });
              fs.writeFileSync(`${base}.csv`, b.csv);
              if (b.srt) fs.writeFileSync(`${base}.srt`, b.srt);
            }
            if (!fs.existsSync(`${base}.csv`)) return json(res, 200, { none: true });
            const args = [path.join(skills, 'yt-retention', 'retention.py'), `${base}.csv`, ...(fs.existsSync(`${base}.srt`) ? ['--transcript', `${base}.srt`] : []), '--json'];
            const analysis = JSON.parse(await py(args, root));
            // The curve itself, for the chart: two numeric columns (position, % still watching).
            const curve = fs
              .readFileSync(`${base}.csv`, 'utf8')
              .split(/\r?\n/)
              .map((l) => l.split(',').map((x) => parseFloat(x.replace(/[%"]/g, ''))))
              .filter((r) => r.length >= 2 && Number.isFinite(r[0]) && Number.isFinite(r[1]))
              .map(([x, y]) => [x, y]);
            return json(res, 200, { analysis, curve });
          }
          json(res, 404, { error: 'not found' });
        } catch (e) {
          json(res, 500, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}
