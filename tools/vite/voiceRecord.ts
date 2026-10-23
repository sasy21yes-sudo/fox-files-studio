/**
 * Dev-server bridge that re-records the studio voice pack after the narration changed (in the editor
 * or by "Ask Claude"), so new lines are voiced by the same narrator, on this computer:
 *   - Qwen3-TTS voices (tools/render_voice_qwen.py, GPU): sentences already recorded come from
 *     voice/cache, only new ones are rendered; ComfyUI is waited for and asked to free the GPU first.
 *   - Kokoro voices (tools/render_voice.py, CPU): the voice's whole pack, about a minute.
 *
 * The page posts the episode; the job exports its sentences (tools/export_cues.mjs, the episode's own
 * narration) and runs the voice script. The pack is rewritten in public/voice/ (committed with the
 * episode by episodeSync.ts) and the page reloads it.
 *
 * Runs only inside `npm run dev`. Settings in .env: FOX_TTS_PYTHON (python with qwen-tts, default
 * C:/Users/Admin/AI/tts/.venv/Scripts/python.exe), FOX_KOKORO_PYTHON (python with kokoro-onnx, default
 * C:/Users/Admin/AI/kokoro/.venv/Scripts/python.exe), COMFY_URL (default http://127.0.0.1:8188).
 *
 *   GET  /api/voice/record/status -> { available, voices: ["lang:voice"], job }
 *   POST /api/voice/record        <- { lang, voice, project } -> { started } | { busy } | { error }
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, type Plugin } from 'vite';

/** Voices tools/render_voice_qwen.py knows (its VOICES); every other studio voice is Kokoro. */
const QWEN_VOICES = ['it_qwen_narratore', 'it_qwen_narratrice'];
const DEFAULT_QWEN_PYTHON = 'C:/Users/Admin/AI/tts/.venv/Scripts/python.exe';
const DEFAULT_KOKORO_PYTHON = 'C:/Users/Admin/AI/kokoro/.venv/Scripts/python.exe';

interface Job {
  state: 'idle' | 'waiting' | 'running' | 'done' | 'error';
  voice: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  /** Bumped after every successful recording: the page reloads the pack with it. */
  version: number;
  /** The last lines of the job's output (what it is doing). */
  log: string[];
  error: string | null;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => {
      data += c;
      if (data.length > 50_000_000) reject(new Error('request too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  if (res.writableEnded || res.destroyed) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function voiceRecord(): Plugin {
  return {
    name: 'fox-voice-record',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      const env = loadEnv(server.config.mode, root, '');
      const qwenPython = env.FOX_TTS_PYTHON || (fs.existsSync(DEFAULT_QWEN_PYTHON) ? DEFAULT_QWEN_PYTHON : '');
      const kokoroPython = env.FOX_KOKORO_PYTHON || (fs.existsSync(DEFAULT_KOKORO_PYTHON) ? DEFAULT_KOKORO_PYTHON : '');
      /** "lang:voice" for every studio voice this computer can record. */
      const recordable = async (): Promise<string[]> => {
        const { STUDIO_VOICES } = (await server.ssrLoadModule('/src/audio/studioVoices.ts')) as {
          STUDIO_VOICES: Record<string, { id: string }[]>;
        };
        return Object.entries(STUDIO_VOICES).flatMap(([lang, list]) =>
          list.filter((v) => (QWEN_VOICES.includes(v.id) ? !!qwenPython : !!kokoroPython)).map((v) => `${lang}:${v.id}`),
        );
      };
      const comfy = (env.COMFY_URL || 'http://127.0.0.1:8188').replace(/\/$/, '');
      const job: Job = { state: 'idle', voice: null, startedAt: null, finishedAt: null, version: 0, log: [], error: null };
      const say = (line: string) => {
        const l = line.trim();
        if (!l) return;
        job.log = [...job.log, l].slice(-12);
      };

      const run = (cmd: string, args: string[]) =>
        new Promise<number>((resolve) => {
          const child = spawn(cmd, args, { cwd: root, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
          const onData = (c: Buffer) => String(c).split(/\r?\n/).forEach(say);
          child.stdout.on('data', onData);
          child.stderr.on('data', onData);
          child.on('error', (e) => {
            say(String(e));
            resolve(1);
          });
          child.on('close', (code) => resolve(code ?? 1));
        });

      /** ComfyUI (image renders) and Qwen3-TTS do not fit on the GPU together: wait for it, then make it unload. */
      const freeGpu = async () => {
        const t0 = Date.now();
        for (;;) {
          try {
            const q = (await (await fetch(`${comfy}/queue`)).json()) as { queue_running: unknown[]; queue_pending: unknown[] };
            if (!q.queue_running.length && !q.queue_pending.length) break;
            job.state = 'waiting';
            say(`waiting for ComfyUI to finish (${q.queue_running.length + q.queue_pending.length} in its queue)`);
          } catch {
            return; // ComfyUI is not running: the GPU is ours
          }
          if (Date.now() - t0 > 45 * 60 * 1000) throw new Error('ComfyUI stayed busy for 45 minutes');
          await sleep(5000);
        }
        await fetch(`${comfy}/free`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }) }).catch(() => undefined);
        await sleep(1500);
      };

      const record = async (lang: string, voice: string, project: unknown) => {
        job.state = 'running';
        job.voice = voice;
        job.startedAt = Date.now();
        job.finishedAt = null;
        job.error = null;
        job.log = [];
        try {
          const dir = path.join(root, 'voice');
          fs.mkdirSync(dir, { recursive: true });
          const episode = path.join(dir, '.episode.json');
          const cues = path.join(dir, '.cues-episode.json');
          fs.writeFileSync(episode, JSON.stringify(project));
          say('collecting the sentences of the edited narration');
          if ((await run(process.execPath, ['tools/export_cues.mjs', cues, episode])) !== 0) throw new Error('could not export the sentences');
          const qwen = QWEN_VOICES.includes(voice);
          if (qwen) await freeGpu();
          job.state = 'running';
          say(qwen ? `recording with ${voice} (only new sentences; the first one also loads the model)` : `recording the ${lang}:${voice} pack`);
          const code = qwen
            ? await run(qwenPython, ['-u', 'tools/render_voice_qwen.py', '--voice', voice, '--cues', cues])
            : await run(kokoroPython, ['-u', 'tools/render_voice.py', '--cues', cues, '--only', `${lang}:${voice}`]);
          if (code !== 0) throw new Error(job.log.filter((l) => /error|Error|Traceback/.test(l)).slice(-1)[0] ?? 'the voice script failed');
          job.version++;
          job.state = 'done';
          say('done: the voice pack was rewritten');
        } catch (e) {
          job.state = 'error';
          job.error = e instanceof Error ? e.message : String(e);
        } finally {
          job.finishedAt = Date.now();
        }
      };

      server.middlewares.use('/api/voice/record', (req, res) => {
        void (async () => {
          const voices = await recordable();
          if (req.method === 'GET' && req.url?.startsWith('/status')) return send(res, 200, { available: voices.length > 0, voices, job });
          if (req.method !== 'POST') return send(res, 404, { error: 'not found' });
          const body = JSON.parse(await readBody(req)) as { lang?: string; voice?: string; project?: { scenes?: unknown[] } };
          if (!body.lang || !body.voice || !voices.includes(`${body.lang}:${body.voice}`))
            return send(res, 400, { error: `${body.lang}:${body.voice} cannot be recorded on this computer (FOX_TTS_PYTHON / FOX_KOKORO_PYTHON)` });
          if (!body.project || !Array.isArray(body.project.scenes)) return send(res, 400, { error: 'no episode' });
          if (job.state === 'running' || job.state === 'waiting') return send(res, 409, { busy: true, job });
          void record(body.lang, body.voice, body.project);
          return send(res, 202, { started: true });
        })().catch((e) => send(res, 500, { error: e instanceof Error ? e.message : String(e) }));
      });
    },
  };
}
