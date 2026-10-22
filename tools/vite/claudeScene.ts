/**
 * Dev-server bridge to Claude for "edit this scene with a prompt".
 *
 * Runs only inside `npm run dev` (Vite `configureServer`): the browser posts
 * the scene, this middleware calls the Anthropic API with ANTHROPIC_API_KEY
 * read from .env on the Node side (the key never reaches the page), checks the
 * answer with the app's own validator and returns the new scene document.
 *
 *   GET  /api/claude/status  -> { available, model }
 *   POST /api/claude/scene   -> { summary, spec, beats, duration, usage, model, attempts } | { error }
 */
import Anthropic from '@anthropic-ai/sdk';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv, type Plugin, type ViteDevServer } from 'vite';

const DEFAULT_MODEL = 'claude-opus-5-5';
const MAX_ATTEMPTS = 2;

interface SceneRequest {
  prompt: string;
  episode: { title: string; language: string; aspect: string; template: string };
  scene: {
    index: number;
    title: string;
    summary: string;
    narration: string;
    duration: number;
    authoredDuration: number;
    spec: unknown | null;
    beats: unknown[];
  };
  sources: { id: string; title: string; claims: string[] }[];
}

/** The reply shape Claude must produce (structured outputs: every object closed). */
const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'What you changed and why, in the language of the request, 1-4 short sentences.' },
    spec_json: { type: 'string', description: 'The complete new SceneSpec as a JSON string.' },
    beats_json: { type: 'string', description: 'The complete new list of pop-ups as a JSON string, or "" to leave them unchanged.' },
    duration: { type: 'number', description: 'New scene length in seconds, or 0 to leave it unchanged.' },
  },
  required: ['summary', 'spec_json', 'beats_json', 'duration'],
  additionalProperties: false,
} as const;

interface Catalog {
  ELEMENTS: Record<string, { label: string; category: string; description: string; params: Record<string, { desc: string; default: unknown }> }>;
  ARM_MODES: readonly string[];
  FACE_KEYS: readonly string[];
  MOUTHS: readonly string[];
}

/** Static system prompt: format, rules, element catalog and the reference scene. Cached by the API. */
function systemPrompt(cat: Catalog, example: unknown): string {
  const elements = Object.entries(cat.ELEMENTS)
    .map(([type, d]) => {
      const params = Object.entries(d.params)
        .map(([n, p]) => `${n} (default ${JSON.stringify(p.default)}): ${p.desc}`)
        .join('; ');
      return `- ${type} [${d.category}] ${d.label}: ${d.description}${params ? ` Params: ${params}.` : ''}`;
    })
    .join('\n');
  return `You are the animation director of "The Fox Files", a 1930s rubber-hose cartoon documentary series (Cuphead-like look) starring Agent Fox, an anthropomorphic red fox detective in a fedora and trench coat. The studio renders each scene from a JSON document called a SceneSpec. You edit ONE scene per request: you receive the current scene (narration, timing, pop-ups, spec) and an instruction from the director, and you return the complete updated scene.

# The SceneSpec format
{ "version": 1, "light"?, "shake"?, "focus"?, "sepia"?, "gloom"?, "elements": [...], "camera": [...], "overlays"? }

Conventions:
- Times are "authored seconds" from 0 to the scene's authoredDuration; the studio stretches them to the real scene length. Keep every time inside that range.
- Positions are fractions of the WIDE frame: x 0 = left edge, 1 = right edge; y 0 = top, 1 = bottom. Sizes marked "u" are layout units (1 u = 1 px at 1080 px on the short side).
- The scene renders both as 16:9 (YouTube) and 9:16 (Short). Any number may be a plain number (same in both) or {"h": <16:9 value>, "v": <9:16 value>}. In 9:16 the useful area is the central part of the composition: place important things so they work in both, using {h,v} values like the reference.
- Tracks are lists of keys {"at": t, "value": v, "dur"?: seconds, "ease"?: "linear"|"smooth"|"in"|"out"|"inOut"|"back"|"bounce"}: the value holds until "at", then moves to the new value over "dur" (0 = cut). Keys sorted by "at".
- light: {"keys": [track of 0..1], "flicker"?: {"from","to"}}: rooms, lamps, motes and the film darkness follow it. shake: {"times": [t...], "strength": 10-20}. focus: {"foxFrom": t} = the iris transitions centre on the frame until t, then on Agent Fox's head.

Elements (drawn in list order: first = furthest back; sets first, Agent Fox usually last):
{ "id": unique, "type", "label"?, "x", "y", "scale"?, "from"?, "to"? (appear/leave times), "enter"?: {"kind": "drop"|"pop"|"fade"|"slideLeft"|"slideRight", "at", "dur"}, "bounce"?: {"amt": 0..1, "phase": 0..1} (hops on the music beat), "rot"?, "dx"?, "dy"?, "opacity"? (numbers or tracks), "params"?: {...}, "hidden"? }
Available element types:
${elements}

Agent Fox (type "fox", at most one): x = his feet (frame fraction), y = ground line, scale ≈ 1.1 (16:9) / 1.36 (9:16). Acting:
- "xTrack": position keys (a walk path). Pair with a "walk" action over the same stretch.
- "actions": [{"kind": "walk"|"skid"|"take"|"pop"|"hop"|"sparkle"|"sweat", "at", "len", "cadence"? (walk steps/s), "symbol"? ("!"|"?"|"!?" for pop)}]. take = startled jump, skid = stop after a run, hop = little jump.
- "armFront" / "armBack": keys of poses: ${cat.ARM_MODES.join(', ')}. The front arm acts, the back arm mostly rests or goes to hips.
- "pointAt": {"target": elementId} or {"x","y"} - where the "point" pose aims.
- "look": keys of {"x": -1..1, "y": -1..1} pupil direction or {"target": elementId}.
- "face": {"<name>": number keys} for ${cat.FACE_KEYS.join(', ')} (about -1..1.5).
- "mouth": keys of ${cat.MOUTHS.filter(Boolean).join(', ')} or "" (only while he is not speaking; while the narration plays the mouth lip-syncs by itself).
- "eyes": keys of "open" | "happy". "facing": -1 to face left.

Camera: [{"at", "kind": "wide"|"medium"|"close"|"extreme"|"insert", "target"?: "fox"|elementId, "enter"?: "cut"|"push"|"whip", "sx"?, "sy"? (where the target lands on screen 0..1), "zoom"?, "drift"?, "locked"?, "foxX"?}]. The first shot is at 0. Wide shots ignore target.

Overlays (screen space): [{"kind": "title", "at", "subAt", "y", "maxWidth", "sunburst"?}] = the episode title slam.

# Pop-ups ("beats")
Explainer cards that appear when a phrase of the narration is spoken. Each has "cue": an EXACT phrase copied from the scene narration, and "kind" with its fields:
question {text} · span {from, to, label} · count {value, label, note?} · versus {left, right, caption?} · define {word, pos, meaning} · waffle {total, hit, label, note?} · list {items[], title?} · record {tag, who, text, highlight, note} · statement {lines[]}.

# Rules
1. Change only what the instruction asks; keep everything else exactly as it was (same ids, same values). Return the COMPLETE spec, never a fragment.
2. Facts: this is a documentary. Text in pop-ups and on props must be supported by the scene narration or the listed sources. Never invent numbers, names, dates or quotes. If the instruction asks for a fact that is not supported, do the rest and say so in the summary.
3. Good cartoon staging: anticipation before big moves, overlapping action, a camera change every 2-4 seconds, key moments on close-ups or inserts, Agent Fox fully in frame in both formats, nothing important hidden behind the subtitles (bottom 20%).
4. Use only the element types, poses and fields listed above. Element ids are lowercase words with dashes.
5. Pop-ups: return beats_json only when you change them (else ""). Each cue must be a phrase that appears verbatim in the narration.
6. duration: 0 unless the instruction needs a different scene length.
7. The summary is for the director: plain words, same language as the instruction.

# Reference: scene 1 of the MKUltra episode (authoredDuration 9)
${JSON.stringify(example)}`;
}

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

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function userMessage(r: SceneRequest): string {
  return [
    `Episode: "${r.episode.title}" (${r.episode.template === 'mkultra' ? 'MKUltra episode' : 'custom episode'}), language ${r.episode.language}, editing in ${r.episode.aspect}.`,
    `Scene ${r.scene.index + 1}: "${r.scene.title}". Real length ${r.scene.duration.toFixed(1)} s, authoredDuration ${r.scene.authoredDuration} (all times in the spec are in 0..${r.scene.authoredDuration}).`,
    r.scene.summary ? `Scene intent: ${r.scene.summary}` : '',
    `Narration (drives subtitles and voice):\n"""${r.scene.narration}"""`,
    r.sources.length ? `Sources for this scene:\n${r.sources.map((s) => `- ${s.title}: ${s.claims.join(' | ')}`).join('\n')}` : 'No sources are listed for this scene: add no new facts.',
    `Current pop-ups:\n${JSON.stringify(r.scene.beats)}`,
    r.scene.spec
      ? `Current spec:\n${JSON.stringify(r.scene.spec)}`
      : 'This scene has no spec yet (it was hand-coded). Build a complete new spec for it from the narration and the intent.',
    `Instruction from the director:\n"""${r.prompt}"""`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function claudeScene(): Plugin {
  let server: ViteDevServer;
  let client: Anthropic | null = null;
  let model = DEFAULT_MODEL;
  let cachedSystem: string | null = null;

  const system = async () => {
    if (cachedSystem) return cachedSystem;
    const cat = (await server.ssrLoadModule('/src/scene/elements.ts')) as unknown as Catalog;
    const { FILE_SPEC } = (await server.ssrLoadModule('/src/data/specs/file.ts')) as { FILE_SPEC: unknown };
    cachedSystem = systemPrompt(cat, FILE_SPEC);
    return cachedSystem;
  };

  return {
    name: 'fox-claude-scene',
    apply: 'serve',
    configureServer(s) {
      server = s;
      const env = loadEnv(s.config.mode, s.config.root, '');
      const key = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
      model = env.CLAUDE_MODEL || DEFAULT_MODEL;
      if (key) client = new Anthropic({ apiKey: key });
      // The catalog may change while developing: rebuild the prompt on the next request.
      s.watcher.on('change', (file) => {
        if (/src[\\/](scene|data[\\/]specs)[\\/]/.test(file)) cachedSystem = null;
      });

      s.middlewares.use('/api/claude', async (req, res) => {
        try {
          if (req.method === 'GET' && req.url?.startsWith('/status')) return send(res, 200, { available: !!client, model });
          if (req.method !== 'POST' || !req.url?.startsWith('/scene')) return send(res, 404, { error: 'not found' });
          if (!client) return send(res, 503, { error: 'ANTHROPIC_API_KEY is not set in .env. Add it and restart `npm run dev`.' });
          const r = JSON.parse(await readBody(req)) as SceneRequest;
          if (!r?.prompt?.trim() || !r.scene) return send(res, 400, { error: 'empty request' });

          const { validateSpec } = (await server.ssrLoadModule('/src/scene/validate.ts')) as { validateSpec(x: unknown): string[] };
          const sys = await system();
          const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: userMessage(r) }];
          const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const stream = client.beta.messages.stream({
              model,
              max_tokens: 64000,
              betas: ['server-side-fallback-2026-07-01'],
              fallbacks: 'default',
              output_config: { effort: 'high', format: { type: 'json_schema', schema: REPLY_SCHEMA } },
              system: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }],
              messages,
            });
            const msg = await stream.finalMessage();
            usage.input += msg.usage.input_tokens;
            usage.output += msg.usage.output_tokens;
            usage.cacheRead += msg.usage.cache_read_input_tokens ?? 0;
            usage.cacheWrite += msg.usage.cache_creation_input_tokens ?? 0;

            if (msg.stop_reason === 'refusal') {
              return send(res, 422, { error: `Claude declined this request${msg.stop_details?.category ? ` (${msg.stop_details.category})` : ''}.`, usage });
            }
            if (msg.stop_reason === 'max_tokens') return send(res, 502, { error: 'The answer was cut off (too long). Try a smaller change.', usage });

            const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
            let problems: string[] = [];
            let reply: { summary: string; spec_json: string; beats_json: string; duration: number } | null = null;
            let spec: unknown = null;
            let beats: unknown = null;
            try {
              reply = JSON.parse(text);
              spec = JSON.parse(reply!.spec_json);
              beats = reply!.beats_json ? JSON.parse(reply!.beats_json) : null;
              problems = validateSpec(spec);
              if (beats !== null && !Array.isArray(beats)) problems.push('beats_json must be a JSON list');
              else if (Array.isArray(beats)) {
                const narration = r.scene.narration.toLowerCase();
                beats.forEach((b, i) => {
                  const cue = (b as { cue?: unknown })?.cue;
                  if (typeof cue !== 'string' || !narration.includes(cue.toLowerCase().trim()) || !cue.trim())
                    problems.push(`beats[${i}].cue is not a phrase of the narration`);
                });
              }
            } catch (e) {
              problems = [`the reply is not valid JSON: ${e instanceof Error ? e.message : String(e)}`];
            }
            if (!problems.length && reply) {
              return send(res, 200, { summary: reply.summary, spec, beats, duration: reply.duration || null, usage, model: msg.model, attempts: attempt });
            }
            if (attempt === MAX_ATTEMPTS) return send(res, 502, { error: `Claude's scene did not pass the checks: ${problems.slice(0, 6).join('; ')}`, usage });
            // Append-only retry: keep the whole answer, then list what to fix.
            messages.push({ role: 'assistant', content: msg.content as Anthropic.Beta.BetaContentBlockParam[] });
            messages.push({ role: 'user', content: `That scene does not pass the studio's checks:\n- ${problems.join('\n- ')}\nReturn the corrected complete reply.` });
          }
        } catch (e) {
          if (e instanceof Anthropic.AuthenticationError) return send(res, 401, { error: 'The ANTHROPIC_API_KEY in .env was rejected.' });
          if (e instanceof Anthropic.PermissionDeniedError) return send(res, 403, { error: `This key cannot use ${model}.` });
          if (e instanceof Anthropic.RateLimitError) return send(res, 429, { error: 'Rate limited by the Anthropic API: try again in a minute.' });
          if (e instanceof Anthropic.BadRequestError) return send(res, 400, { error: `Anthropic API rejected the request: ${e.message}` });
          if (e instanceof Anthropic.APIError) return send(res, 502, { error: `Anthropic API error ${e.status ?? ''}: ${e.message}` });
          return send(res, 500, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}
