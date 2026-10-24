/**
 * Dev-server bridge for the Clip lab (model sheet → Clips): builds a frame-by-frame animation clip from
 * drawings dropped in the page, with tools/clips/build_clip.py (registration on a locked region, the
 * residual check, the atlas, public/clips/index.json). Runs only inside `npm run dev`.
 *
 *   POST /api/clips/build  <- { id, label, fps, hold, loop, lock, motion, heightU, maxError, frames: [dataURL...] }
 *                          -> { ok, log } | { error, log }
 *   GET  /api/clips/qa/<id>/<contact|onion>.png -> the build's QA sheets
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { Plugin } from 'vite';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 400 << 20) reject(new Error('request too large'));
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function clipBuild(): Plugin {
  return {
    name: 'fox-clip-build',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      server.middlewares.use('/api/clips', (req, res) => {
        void (async () => {
          const qa = /^\/qa\/([\w-]+)\/(contact|onion)\.png$/.exec(req.url ?? '');
          if (req.method === 'GET' && qa) {
            const f = path.join(root, 'qa-out', 'clips', qa[1], `${qa[2]}.png`);
            if (!fs.existsSync(f)) return json(res, 404, { error: 'no QA sheet' });
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Cache-Control', 'no-store');
            return res.end(fs.readFileSync(f));
          }
          if (req.method !== 'POST' || !req.url?.startsWith('/build')) return json(res, 404, { error: 'not found' });
          const b = JSON.parse(await readBody(req)) as {
            id: string; label: string; fps: number; hold: number; loop: string; lock: string; motion: string; heightU: number; maxError: number; frames: string[];
          };
          if (!/^[a-z0-9][a-z0-9_-]{0,60}$/.test(b.id ?? '')) return json(res, 400, { error: 'id: lowercase letters, digits, - and _' });
          if (!Array.isArray(b.frames) || b.frames.length < 2) return json(res, 400, { error: 'at least 2 drawings' });
          const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fox-clip-'));
          b.frames.forEach((d, i) => {
            const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(d);
            if (m) fs.writeFileSync(path.join(dir, `f${String(i).padStart(4, '0')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`), Buffer.from(m[2], 'base64'));
          });
          const args = [
            'tools/clips/build_clip.py', dir, '--id', b.id, '--label', b.label || b.id,
            '--fps', String(b.fps || 24), '--hold', String(b.hold || 2), '--loop', b.loop || 'once',
            '--lock', b.lock || 'feet', '--motion', b.motion || 'translation',
            '--height-u', String(b.heightU || 600), '--max-error', String(b.maxError || 0.25),
          ];
          const log = await new Promise<{ code: number; text: string }>((resolve) => {
            const p = spawn('python', args, { cwd: root, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
            let text = '';
            p.stdout.on('data', (c) => (text += c));
            p.stderr.on('data', (c) => (text += c));
            p.on('error', (e) => resolve({ code: 1, text: String(e) }));
            p.on('close', (code) => resolve({ code: code ?? 1, text }));
          });
          fs.rmSync(dir, { recursive: true, force: true });
          if (log.code !== 0) return json(res, 422, { error: log.text.trim().split('\n').slice(-1)[0] || 'build failed', log: log.text });
          return json(res, 200, { ok: true, log: log.text });
        })().catch((e) => json(res, 500, { error: e instanceof Error ? e.message : String(e) }));
      });
    },
  };
}
