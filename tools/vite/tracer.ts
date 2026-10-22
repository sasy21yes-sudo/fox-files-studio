/**
 * Dev-server side of the face tracer page (tracer.html): Salvatore draws Agent Fox's eye, brow and
 * line shapes over the master drawing; on save they go to art/reference/trace/manual.json in the
 * assets repo and tools/trace_face.py rebuilds src/character/rig/masterFace.ts, so the rig shows
 * them at once (Vite reloads the module).
 *
 *   GET  /api/trace/image   -> the master face, 4x (face_4x.png)
 *   GET  /api/trace/shapes  -> { shapes: manual.json or auto.json, source }
 *   POST /api/trace/save    -> writes manual.json, runs trace_face.py -> { ok, log } | { error }
 *
 * FOX_ASSETS_DIR in .env points at the assets checkout (default: ../fox-files-studio).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { loadEnv, type Plugin } from 'vite';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => {
      data += c;
      if (data.length > 2_000_000) reject(new Error('request too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function tracer(): Plugin {
  return {
    name: 'fox-tracer',
    apply: 'serve',
    configureServer(s) {
      const env = loadEnv(s.config.mode, s.config.root, '');
      const assets = path.resolve(s.config.root, env.FOX_ASSETS_DIR || '../fox-files-studio');
      const dir = path.join(assets, 'art', 'reference', 'trace');
      const out = path.join(s.config.root, 'src', 'character', 'rig', 'masterFace.ts');

      s.middlewares.use('/api/trace', async (req, res) => {
        try {
          if (req.method === 'GET' && req.url?.startsWith('/image')) {
            res.setHeader('Content-Type', 'image/png');
            return res.end(fs.readFileSync(path.join(dir, 'face_4x.png')));
          }
          if (req.method === 'GET' && req.url?.startsWith('/shapes')) {
            const manual = path.join(dir, 'manual.json');
            const auto = path.join(dir, 'auto.json');
            const own = fs.existsSync(manual);
            const auto_ = fs.existsSync(auto) ? JSON.parse(fs.readFileSync(auto, 'utf8')) : {};
            return json(res, 200, { shapes: { ...auto_, ...(own ? JSON.parse(fs.readFileSync(manual, 'utf8')) : {}) }, auto: auto_, source: own ? 'manual' : 'auto' });
          }
          if (req.method === 'POST' && req.url?.startsWith('/save')) {
            const body = JSON.parse(await readBody(req)) as { shapes: Record<string, [number, number][]> };
            fs.writeFileSync(path.join(dir, 'manual.json'), JSON.stringify(body.shapes, null, 1));
            const log = await new Promise<string>((resolve, reject) => {
              const p = spawn('python', [path.join(assets, 'tools', 'trace_face.py'), '--ts', out], { cwd: assets, windowsHide: true });
              let text = '';
              p.stdout.on('data', (c) => (text += c));
              p.stderr.on('data', (c) => (text += c));
              p.on('error', reject);
              p.on('close', (code) => (code === 0 ? resolve(text) : reject(new Error(text.trim().split('\n').slice(-4).join(' ') || `exit ${code}`))));
            });
            return json(res, 200, { ok: true, log });
          }
          json(res, 404, { error: 'not found' });
        } catch (e) {
          json(res, 500, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}
