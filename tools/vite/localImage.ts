/**
 * Dev-server bridge to the local image model (ComfyUI + Qwen-Image), for the
 * studio's "Generate image" box.
 *
 * Runs only inside `npm run dev`. The page posts a prompt; this middleware
 * builds a text-to-image graph, queues it at the FRONT of ComfyUI's queue (so
 * it does not wait behind a batch of asset renders), waits for it and returns
 * the PNG. Settings in .env: COMFY_URL (default http://127.0.0.1:8188),
 * COMFY_IMAGE_MODEL / COMFY_TEXT_ENCODER / COMFY_VAE / COMFY_LIGHTNING_LORA.
 *
 *   GET  /api/image/status   -> { available, url, model }
 *   POST /api/image/generate -> image/png (headers X-Seed, X-Seconds) | { error }
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { loadEnv, type Plugin } from 'vite';

const STYLES: Record<string, string> = {
  cartoon:
    'A 1930s rubber-hose cartoon background painting in the style of Fleischer Studios and Cuphead: hand-inked wobbly outlines, ' +
    'flat watercolour fills, warm sepia, brown and mustard palette, soft vignette, film grain.',
  sketch: 'A loose ink-and-wash editorial sketch, brown ink on cream paper, cross-hatching, a few watercolour washes, 1950s magazine illustration.',
  poster: 'A 1940s screen-printed propaganda-style poster illustration: bold flat shapes, limited palette of brick red, cream and dark brown, strong graphic composition.',
};
const NO_TEXT = ' Absolutely no text, no letters, no numbers, no captions, no logos, no watermark anywhere in the image.';

const SIZES: Record<string, [number, number]> = { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [1024, 1024] };

interface GenerateRequest {
  prompt: string;
  style?: string;
  aspect?: string;
  seed?: number;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => {
      data += c;
      if (data.length > 100_000) reject(new Error('request too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  if (res.writableEnded || res.destroyed) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function localImage(): Plugin {
  return {
    name: 'fox-local-image',
    apply: 'serve',
    configureServer(s) {
      const env = loadEnv(s.config.mode, s.config.root, '');
      const url = (env.COMFY_URL || 'http://127.0.0.1:8188').replace(/\/$/, '');
      const model = env.COMFY_IMAGE_MODEL || 'qwen_image_edit_2511_fp8mixed.safetensors';
      const encoder = env.COMFY_TEXT_ENCODER || 'qwen_2.5_vl_7b_fp8_scaled.safetensors';
      const vae = env.COMFY_VAE || 'qwen_image_vae.safetensors';
      const lora = env.COMFY_LIGHTNING_LORA ?? 'Qwen-Image-Edit-2511-Lightning-8steps-V1.0-bf16.safetensors';

      const comfy = async (path: string, body?: unknown) => {
        const r = await fetch(url + path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!r.ok) throw new Error(`ComfyUI ${path}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
        return r;
      };

      /** Text-to-image graph: the Qwen-Image-Edit weights with no input image and an empty latent (8 steps with the Lightning LoRA). */
      const graph = (prompt: string, w: number, h: number, seed: number) => ({
        unet: { class_type: 'UNETLoader', inputs: { unet_name: model, weight_dtype: 'default' } },
        ...(lora ? { lora: { class_type: 'LoraLoaderModelOnly', inputs: { model: ['unet', 0], lora_name: lora, strength_model: 1.0 } } } : {}),
        clip: { class_type: 'CLIPLoader', inputs: { clip_name: encoder, type: 'qwen_image', device: 'default' } },
        vae: { class_type: 'VAELoader', inputs: { vae_name: vae } },
        shift: { class_type: 'ModelSamplingAuraFlow', inputs: { model: [lora ? 'lora' : 'unet', 0], shift: 3.1 } },
        pos: { class_type: 'TextEncodeQwenImageEditPlus', inputs: { clip: ['clip', 0], vae: ['vae', 0], prompt } },
        neg: { class_type: 'TextEncodeQwenImageEditPlus', inputs: { clip: ['clip', 0], vae: ['vae', 0], prompt: 'text, letters, words, watermark, signature, blurry, photo, photorealistic' } },
        latent: { class_type: 'EmptySD3LatentImage', inputs: { width: w, height: h, batch_size: 1 } },
        sample: {
          class_type: 'KSampler',
          inputs: { model: ['shift', 0], positive: ['pos', 0], negative: ['neg', 0], latent_image: ['latent', 0], seed, steps: lora ? 8 : 30, cfg: lora ? 1.0 : 4.0, sampler_name: 'euler', scheduler: 'simple', denoise: 1.0 },
        },
        decode: { class_type: 'VAEDecode', inputs: { samples: ['sample', 0], vae: ['vae', 0] } },
        save: { class_type: 'SaveImage', inputs: { images: ['decode', 0], filename_prefix: 'foxstudio' } },
      });

      s.middlewares.use('/api/image', async (req, res) => {
        let promptId: string | null = null;
        let done = false;
        // Stop pressed (or page gone): drop the job from ComfyUI's queue, or interrupt it if it already runs.
        res.on('close', () => {
          if (done || !promptId) return;
          void comfy('/queue', { delete: [promptId] }).catch(() => undefined);
          void comfy('/queue')
            .then((r) => r.json())
            .then((q) => {
              const running = (q as { queue_running?: unknown[][] }).queue_running ?? [];
              if (running.some((x) => x[1] === promptId)) return comfy('/interrupt', {});
            })
            .catch(() => undefined);
        });
        try {
          if (req.method === 'GET' && req.url?.startsWith('/status')) {
            try {
              await comfy('/system_stats');
              return sendJson(res, 200, { available: true, url, model });
            } catch {
              return sendJson(res, 200, { available: false, url, model });
            }
          }
          if (req.method !== 'POST' || !req.url?.startsWith('/generate')) return sendJson(res, 404, { error: 'not found' });
          const r = JSON.parse(await readBody(req)) as GenerateRequest;
          if (!r?.prompt?.trim()) return sendJson(res, 400, { error: 'empty prompt' });
          const [w, h] = SIZES[r.aspect ?? '16:9'] ?? SIZES['16:9'];
          const seed = Number.isInteger(r.seed) ? (r.seed as number) : Math.floor(Math.random() * 2 ** 31);
          const text = `${STYLES[r.style ?? 'cartoon'] ?? STYLES.cartoon} ${r.prompt.trim()}.${NO_TEXT}`;
          const t0 = Date.now();
          const q = (await (await comfy('/prompt', { prompt: graph(text, w, h, seed), client_id: randomUUID(), front: true })).json()) as { prompt_id: string };
          promptId = q.prompt_id;
          for (;;) {
            if (res.destroyed) return;
            await new Promise((ok) => setTimeout(ok, 1500));
            const hist = (await (await comfy(`/history/${promptId}`)).json()) as Record<
              string,
              { status?: { status_str?: string; messages?: unknown[] }; outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }> }
            >;
            const entry = hist[promptId];
            if (!entry) continue;
            if (entry.status?.status_str === 'error') throw new Error(`ComfyUI could not render it: ${JSON.stringify(entry.status.messages ?? []).slice(-400)}`);
            const img = entry.outputs?.save?.images?.[0];
            if (!img) continue;
            const png = Buffer.from(await (await comfy(`/view?${new URLSearchParams({ filename: img.filename, subfolder: img.subfolder, type: img.type })}`)).arrayBuffer());
            done = true;
            res.statusCode = 200;
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('X-Seed', String(seed));
            res.setHeader('X-Seconds', String(Math.round((Date.now() - t0) / 1000)));
            return res.end(png);
          }
        } catch (e) {
          done = true;
          const msg = e instanceof Error ? e.message : String(e);
          return sendJson(res, /ECONNREFUSED|fetch failed/.test(msg) ? 503 : 502, {
            error: /ECONNREFUSED|fetch failed/.test(msg) ? `ComfyUI is not running at ${url}. Start it and try again.` : msg,
          });
        }
      });
    },
  };
}
