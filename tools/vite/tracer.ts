/**
 * Dev-server side of the tracer page (tracer.html): Salvatore draws over the master drawing with a
 * Photoshop-style pen; on save the shapes go to art/reference/trace/ in the assets repo and a script
 * rebuilds a module of the rig, so the rig shows them at once (Vite reloads the module).
 *   ?part=face (default): eyes, brows, lines -> manual.json -> tools/trace_face.py -> masterFace.ts
 *   ?part=neck: the side rig's neck masks, drawn over the rig's own sprites -> neck.json ->
 *               tools/rig_masks.py --apply (re-bakes the rig with them, ~30 s)
 *
 *   GET  /api/trace/image?part=   -> the master crop, 4x
 *   GET  /api/trace/shapes?part=  -> { shapes, auto, source }
 *   POST /api/trace/save?part=    -> writes the shapes, runs the script -> { ok, log } | { error }
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
      const rig = path.join(s.config.root, 'src', 'character', 'rig');
      const PARTS = {
        face: { image: 'face_4x.png', manual: 'manual.json', auto: 'auto.json', script: 'trace_face.py', args: ['--ts', path.join(rig, 'masterFace.ts')] },
        neck: { image: 'neck_rig.png', manual: 'neck.json', auto: 'neck_auto.json', script: 'rig_masks.py', args: ['--apply', '--rig', rig] },
      };

      s.middlewares.use('/api/trace', async (req, res) => {
        try {
          const P = new URL(req.url ?? '/', 'http://x').searchParams.get('part') === 'neck' ? PARTS.neck : PARTS.face;
          if (req.method === 'GET' && req.url?.startsWith('/image')) {
            res.setHeader('Content-Type', 'image/png');
            return res.end(fs.readFileSync(path.join(dir, P.image)));
          }
          if (req.method === 'GET' && req.url?.startsWith('/shapes')) {
            const manual = path.join(dir, P.manual);
            const auto = path.join(dir, P.auto);
            const own = fs.existsSync(manual);
            const auto_ = fs.existsSync(auto) ? JSON.parse(fs.readFileSync(auto, 'utf8')) : {};
            return json(res, 200, { shapes: { ...auto_, ...(own ? JSON.parse(fs.readFileSync(manual, 'utf8')) : {}) }, auto: auto_, source: own ? 'manual' : 'auto' });
          }
          if (req.method === 'POST' && req.url?.startsWith('/save')) {
            const body = JSON.parse(await readBody(req)) as { shapes: Record<string, [number, number][]> };
            fs.writeFileSync(path.join(dir, P.manual), JSON.stringify(body.shapes, null, 1));
            const log = await new Promise<string>((resolve, reject) => {
              const p = spawn('python', [path.join(assets, 'tools', P.script), ...P.args], { cwd: assets, windowsHide: true });
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
