/**
 * Dev-server tools behind the model sheet's "Tune" and "Mouths" panels.
 *
 *   POST /api/rig/tweaks                 { tweaks }            -> writes src/character/rig/tweaks.json
 *   GET  /api/rig/mouths                                       -> every mouth piece: key, label, versions
 *   GET  /api/rig/piece?file=art/incoming/pieces/rig_.../x.png -> the render (rig pieces only)
 *   POST /api/rig/mouths/regenerate      { key, count, note }  -> renders new versions (local ComfyUI)
 *   POST /api/rig/mouths/apply           { key, version }      -> approves it, rebuilds the mouth sheet and re-bakes the rig
 *
 * The assets checkout (tools, art, manifest) is FOX_ASSETS_DIR (default ../fox-files-studio); its
 * Python scripts run with `python`, the upscaler with ComfyUI's embedded python (CUDA).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { loadEnv, type Plugin } from 'vite';

const LIP = ['rest', 'm/b/p', 'consonant', 'A (wide)', 'E/I', 'O', 'U/W (pucker)', 'F/V', 'L/T/D/N', 'TH (tongue)', 'smile', 'serious'];
const EMO = ['scream', 'gasp', 'whisper', 'smirk', 'gritted', 'laugh', 'frown', 'disgust', 'nervous', 'grin', 'jawdrop'];

function body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let d = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => (d += c));
    req.on('end', () => resolve(d));
    req.on('error', reject);
  });
}
const json = (res: ServerResponse, status: number, b: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(b));
};

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env, windowsHide: true });
    let out = '';
    p.stdout.on('data', (c) => (out += c));
    p.stderr.on('data', (c) => (out += c));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(out.trim().split('\n').slice(-6).join('\n') || `exit ${code}`))));
  });
}

export function rigTools(): Plugin {
  return {
    name: 'fox-rig-tools',
    apply: 'serve',
    configureServer(s) {
      const env = loadEnv(s.config.mode, s.config.root, '');
      const assets = path.resolve(s.config.root, env.FOX_ASSETS_DIR || '../fox-files-studio');
      const comfyPy = env.COMFY_PYTHON || 'C:/Users/Admin/AI/comfy/ComfyUI_windows_portable/python_embeded/python.exe';
      const rigDir = path.join(s.config.root, 'src', 'character', 'rig');
      const manifest = () => JSON.parse(fs.readFileSync(path.join(assets, 'art', 'incoming', 'manifest.json'), 'utf8')).sheets as Record<string, { versions: { version: string; file: string; status: string; review?: string }[] }>;
      const sheetOf = (key: string) => (/^m\d+$/.test(key) ? `rig_mouthheads/${key}` : `rig_emotions/${key}`);
      let busy = false;

      s.middlewares.use('/api/rig', async (req, res) => {
        try {
          if (req.method === 'POST' && req.url?.startsWith('/tweaks')) {
            const b = JSON.parse(await body(req)) as { tweaks: unknown };
            fs.writeFileSync(path.join(rigDir, 'tweaks.json'), JSON.stringify(b.tweaks, null, 2) + '\n');
            return json(res, 200, { ok: true });
          }
          if (req.method === 'GET' && req.url?.startsWith('/mouths')) {
            const m = manifest();
            const list = [
              ...LIP.map((label, k) => ({ key: `m${k}`, label: `Lip-sync · ${label}`, kind: 'lip' })),
              ...EMO.map((e) => ({ key: e, label: `Emotion · ${e}`, kind: 'emotion' })),
            ].map((x) => ({ ...x, versions: (m[sheetOf(x.key)]?.versions ?? []).map((v) => ({ version: v.version, file: v.file, status: v.status, review: v.review ?? '' })) }));
            return json(res, 200, { mouths: list, busy });
          }
          if (req.method === 'GET' && req.url?.startsWith('/piece')) {
            const file = new URL(req.url, 'http://x').searchParams.get('file') ?? '';
            if (!/^art\/incoming\/pieces\/rig_[a-z]+\/[\w-]+\.png$/.test(file)) return json(res, 400, { error: 'bad file' });
            res.setHeader('Content-Type', 'image/png');
            return res.end(fs.readFileSync(path.join(assets, file)));
          }
          if (req.method === 'POST' && req.url?.startsWith('/mouths/regenerate')) {
            if (busy) return json(res, 409, { error: 'Another mouth job is running.' });
            const b = JSON.parse(await body(req)) as { key: string; count?: number; note?: string };
            if (!/^m\d{1,2}$|^[a-z]+$/.test(b.key)) return json(res, 400, { error: 'bad key' });
            busy = true;
            try {
              const sheet = sheetOf(b.key).split('/')[0];
              const args = [path.join(assets, 'tools', 'comfy', 'run_jobs.py'), sheet, '--pieces', b.key, '--count', String(Math.min(4, b.count ?? 2)), '--front'];
              if (b.note?.trim()) args.push('--correction', b.note.trim());
              const log = await run('python', args, assets);
              return json(res, 200, { ok: true, log });
            } finally {
              busy = false;
            }
          }
          if (req.method === 'POST' && req.url?.startsWith('/mouths/apply')) {
            if (busy) return json(res, 409, { error: 'Another mouth job is running.' });
            const b = JSON.parse(await body(req)) as { key: string; version: string };
            busy = true;
            try {
              const key = sheetOf(b.key);
              const m = manifest();
              for (const v of m[key]?.versions ?? []) {
                if (v.status === 'approved' && v.version !== b.version)
                  await run('python', ['tools/comfy/edit.py', '--mark', key, v.version, 'rejected', '--note', 'replaced in the studio'], assets);
              }
              await run('python', ['tools/comfy/edit.py', '--mark', key, b.version, 'approved', '--note', 'chosen in the studio (model sheet)'], assets);
              let log = await run('python', ['tools/comfy/rig_mouths.py'], assets);
              log += await run(comfyPy, ['-s', 'tools/upscale.py', 'tools/weights/RealESRGAN_x4plus_anime_6B.pth', 'art/parts_v4/mouths.jpg', 'art/parts_v4/up/mouths.png'], assets);
              log += await run('python', ['tools/bake_rig.py'], assets, { ...process.env, FOX_PARTS: 'art/parts_v4', FOX_RIG_OUT: rigDir });
              return json(res, 200, { ok: true, log });
            } finally {
              busy = false;
            }
          }
          json(res, 404, { error: 'not found' });
        } catch (e) {
          busy = false;
          json(res, 500, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}
