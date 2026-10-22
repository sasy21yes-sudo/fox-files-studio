/**
 * Dev-server bridge to Claude for "edit with a prompt" (one scene or the whole episode).
 *
 * Runs only inside `npm run dev` (Vite `configureServer`). The browser posts the
 * scenes; this middleware asks Claude and checks the answer with the app's own
 * validator before returning it. Two backends, chosen at start-up:
 *
 * - Claude Code (default): runs the local `claude` CLI headless (`claude -p`),
 *   so requests use the Claude Code login of this computer — no API key. Its
 *   tools are disabled: it only answers, it never touches files.
 * - Anthropic API: only when no Claude Code binary is found and
 *   ANTHROPIC_API_KEY is set in .env (read on the Node side, never sent to the page).
 *
 *   GET  /api/claude/status -> { available, backend, model }
 *   POST /api/claude/edit   -> { summary, scenes: [{ index, spec, beats, duration }], usage, model, attempts } | { error }
 */
import Anthropic from '@anthropic-ai/sdk';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { loadEnv, type Plugin, type ViteDevServer } from 'vite';

const DEFAULT_MODEL = 'claude-opus-5-5';
const MAX_ATTEMPTS = 2;
/** A whole-episode edit can take several minutes. */
const CLI_TIMEOUT_MS = 20 * 60 * 1000;

interface SceneIn {
  index: number;
  title: string;
  summary: string;
  narration: string;
  duration: number;
  authoredDuration: number;
  spec: unknown | null;
  beats: unknown[];
  sourceIds: string[];
  /** When each subtitle cue is heard, in the scene's authored seconds (exact = from the real voice clips). */
  speech?: { text: string; from: number; to: number; exact: boolean }[];
}

interface EditRequest {
  prompt: string;
  /** Index of the scene to edit, or "all" for the whole episode. */
  target: number | 'all';
  episode: { title: string; language: string; aspect: string; template: string };
  scenes: SceneIn[];
  sources: { id: string; title: string; publisher?: string; date?: string; claims: string[] }[];
  /** The episode's image library (picture elements may only use these ids). */
  media?: { id: string; name: string; prompt: string; width: number; height: number }[];
}

interface SceneOut {
  index: number;
  spec: unknown | null;
  beats: unknown[] | null;
  duration: number | null;
}

interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** The reply shape (strict-schema friendly: every object closed, documents as JSON strings). */
const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'What you changed and why, in the language of the instruction, 1-5 short sentences.' },
    scenes: {
      type: 'array',
      description: 'One entry per scene you changed; leave untouched scenes out.',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer', description: 'Scene index as given (0-based).' },
          spec_json: { type: 'string', description: 'The complete new SceneSpec as a JSON string, or "" to keep the current one.' },
          beats_json: { type: 'string', description: 'The complete new list of pop-ups as a JSON string, or "" to keep them.' },
          duration: { type: 'number', description: 'New scene length in seconds, or 0 to keep it.' },
        },
        required: ['index', 'spec_json', 'beats_json', 'duration'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'scenes'],
  additionalProperties: false,
} as const;

interface Reply {
  summary: string;
  scenes: { index: number; spec_json: string; beats_json: string; duration: number }[];
}

interface Catalog {
  ELEMENTS: Record<string, { label: string; category: string; description: string; params: Record<string, { desc: string; default: unknown }> }>;
  ARM_MODES: readonly string[];
  FACE_KEYS: readonly string[];
  MOUTHS: readonly string[];
}

/** Static system prompt: format, rules, element catalog and the reference scene. */
function systemPrompt(cat: Catalog, example: unknown): string {
  const elements = Object.entries(cat.ELEMENTS)
    .map(([type, d]) => {
      const params = Object.entries(d.params)
        .map(([n, p]) => `${n} (default ${JSON.stringify(p.default)}): ${p.desc}`)
        .join('; ');
      return `- ${type} [${d.category}] ${d.label}: ${d.description}${params ? ` Params: ${params}.` : ''}`;
    })
    .join('\n');
  return `You are the animation director of "The Fox Files", a 1930s rubber-hose cartoon documentary series (Cuphead-like look) starring Agent Fox, an anthropomorphic red fox detective in a fedora and trench coat. The studio renders each scene from a JSON document called a SceneSpec. You receive the episode's scenes (narration, timing, pop-ups, spec) and an instruction from the director: either for ONE scene or for the WHOLE episode. You return the scenes you changed.

# The SceneSpec format
{ "version": 1, "light"?, "shake"?, "focus"?, "sepia"?, "gloom"?, "elements": [...], "camera": [...], "overlays"? }

Conventions:
- Times are "authored seconds" from 0 to the scene's authoredDuration; the studio stretches them to the real scene length. Keep every time inside that range. When a scene lists "Spoken" lines, they say when each subtitle cue is heard in those same authored seconds: use them to land actions, cuts and pictures on words.
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
Explainer cards that appear when a phrase of the narration is spoken. Each has "cue": an EXACT phrase copied from that scene's narration, and "kind" with its fields:
question {text} · span {from, to, label} · count {value, label, note?} · versus {left, right, caption?} · define {word, pos, meaning} · waffle {total, hit, label, note?} · list {items[], title?} · record {tag, who, text, highlight, note} · statement {lines[]}.

# Hand-coded scenes
Some scenes have no spec ("spec": null): they are drawn by code. You can still change their pop-ups and length without touching the picture (spec_json ""). Write a new spec for one only when the instruction needs a change to its picture; it then replaces the coded version, so build it complete from the narration and the scene intent.

# Rules
1. Change only what the instruction asks; keep everything else exactly as it was (same ids, same values). A spec you return is the COMPLETE spec, never a fragment.
2. Return only the scenes you changed. For a one-scene instruction, change only that scene. For a whole-episode instruction, keep the episode consistent (same set style, Agent Fox's look, pacing) and avoid rewriting scenes the instruction does not need.
3. Facts: this is a documentary. Text in pop-ups and on props must be supported by the narration or the listed sources. Never invent numbers, names, dates or quotes. If the instruction asks for a fact that is not supported, do the rest and say so in the summary.
4. Good cartoon staging: anticipation before big moves, overlapping action, a camera change every 2-4 seconds, key moments on close-ups or inserts, Agent Fox fully in frame in both formats, nothing important hidden behind the subtitles (bottom 20%).
5. Use only the element types, poses and fields listed above. Element ids are lowercase words with dashes.
   Picture elements may only use image ids from the episode's image library given in the request. You cannot create images: if none fits, say so in the summary (the director can generate one in the studio).
6. Pop-ups: beats_json is the complete list for that scene when you change it, else "". Each cue must be a phrase that appears verbatim in that scene's narration.
7. duration: 0 unless the instruction needs a different scene length (3-90 s).
8. The summary is for the director: plain words, saying which scenes you changed. Write it in the language of the director's instruction (an Italian instruction gets an Italian summary), whatever the language of the rest of this prompt.

# Reference: scene 1 of the MKUltra episode (authoredDuration 9)
${JSON.stringify(example)}`;
}

function userMessage(r: EditRequest): string {
  const target = r.target === 'all' ? null : r.scenes.find((s) => s.index === r.target);
  const sourceTitle = new Map(r.sources.map((s) => [s.id, s.title]));
  const context = (s: SceneIn) => `## Scene ${s.index + 1} (index ${s.index}): "${s.title}" — context only, do not change\nNarration:\n"""${s.narration}"""`;
  const scene = (s: SceneIn) =>
    target && s.index !== target.index
      ? context(s)
      : [
      `## Scene ${s.index + 1} (index ${s.index}): "${s.title}"`,
      `Real length ${s.duration.toFixed(1)} s, authoredDuration ${s.authoredDuration} (spec times in 0..${s.authoredDuration}).`,
      s.summary ? `Intent: ${s.summary}` : '',
      s.sourceIds.length ? `Sources: ${s.sourceIds.map((id) => sourceTitle.get(id) ?? id).join('; ')}` : 'No sources listed: add no new facts.',
      `Narration:\n"""${s.narration}"""`,
      s.speech?.length
        ? `Spoken (authored s, ${s.speech.every((x) => x.exact) ? 'exact, from the voice clips' : 'estimated'}):\n${s.speech.map((x) => `${x.from.toFixed(2)}-${x.to.toFixed(2)} "${x.text}"`).join('\n')}`
        : '',
      `Pop-ups: ${JSON.stringify(s.beats)}`,
      s.spec ? `Spec: ${JSON.stringify(s.spec)}` : 'Spec: null (hand-coded scene).',
    ]
      .filter(Boolean)
      .join('\n');
  return [
    `Episode: "${r.episode.title}" (${r.episode.template === 'mkultra' ? 'MKUltra episode' : 'custom episode'}), language ${r.episode.language}, editing in ${r.episode.aspect}, ${r.scenes.length} scene(s).`,
    r.media?.length
      ? `# Image library (for picture elements)\n${r.media.map((m) => `- ${m.id}: "${m.name}" ${m.width}x${m.height}${m.prompt ? ` — ${m.prompt}` : ''}`).join('\n')}`
      : '# Image library\nEmpty: no picture elements possible.',
    r.sources.length ? `# Sources\n${r.sources.map((s) => `- ${s.title}${[s.publisher, s.date].filter(Boolean).map((x) => ` (${x})`).join('')}: ${s.claims.join(' | ')}`).join('\n')}` : '',
    `# Scenes\n${r.scenes.map(scene).join('\n\n')}`,
    target
      ? `# Instruction for scene ${target.index + 1} only (index ${target.index})\n"""${r.prompt}"""`
      : `# Instruction for the whole episode\n"""${r.prompt}"""`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Checks Claude's reply against the request; returns the scenes to apply or the problems. */
function checkReply(
  reply: Reply,
  r: EditRequest,
  validateSpec: (x: unknown) => string[],
): { scenes: SceneOut[]; problems: string[] } {
  const problems: string[] = [];
  const scenes: SceneOut[] = [];
  if (!Array.isArray(reply?.scenes)) return { scenes, problems: ['"scenes" must be a list'] };
  const seen = new Set<number>();
  for (const s of reply.scenes) {
    const at = `scene index ${s.index}`;
    const src = r.scenes.find((x) => x.index === s.index);
    if (!src) {
      problems.push(`${at} does not exist`);
      continue;
    }
    if (r.target !== 'all' && s.index !== r.target) {
      problems.push(`${at}: only scene index ${r.target} may change`);
      continue;
    }
    if (seen.has(s.index)) problems.push(`${at} appears twice`);
    seen.add(s.index);
    let spec: unknown = null;
    let beats: unknown = null;
    try {
      if (s.spec_json) {
        spec = JSON.parse(s.spec_json);
        problems.push(...validateSpec(spec).map((p) => `${at}: ${p}`));
        const known = new Set((r.media ?? []).map((m) => m.id));
        for (const el of (spec as { elements?: { type?: string; id?: string; params?: { media?: unknown } }[] }).elements ?? []) {
          if (el.type === 'picture' && !known.has(String(el.params?.media ?? ''))) problems.push(`${at}: picture "${el.id}" uses an image id that is not in the library`);
        }
      }
      if (s.beats_json) beats = JSON.parse(s.beats_json);
    } catch (e) {
      problems.push(`${at}: not valid JSON (${e instanceof Error ? e.message : String(e)})`);
      continue;
    }
    if (beats !== null && !Array.isArray(beats)) problems.push(`${at}: beats_json must be a JSON list`);
    else if (Array.isArray(beats)) {
      const narration = src.narration.toLowerCase();
      beats.forEach((b, i) => {
        const cue = (b as { cue?: unknown })?.cue;
        if (typeof cue !== 'string' || !cue.trim() || !narration.includes(cue.toLowerCase().trim()))
          problems.push(`${at}: beats[${i}].cue is not a phrase of that scene's narration`);
      });
    }
    scenes.push({ index: s.index, spec, beats: beats as unknown[] | null, duration: s.duration || null });
  }
  return { scenes, problems };
}

// ------------------------------------------------------------------ backends

interface Answer {
  reply: Reply | null;
  /** Why there is no reply (refusal, cut off, CLI error). */
  error?: string;
  usage: Usage;
  model: string;
}

interface Backend {
  name: 'claude-code' | 'api';
  model: string;
  ask(system: string, user: string, signal: AbortSignal): Promise<Answer>;
}

/** The newest Claude Code binary on this computer: CLAUDE_CODE_BIN, PATH, the native installer, then editor extensions. */
function findClaudeCode(env: Record<string, string>): string | null {
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const given = env.CLAUDE_CODE_BIN || process.env.CLAUDE_CODE_BIN;
  if (given) return fs.existsSync(given) ? given : null;
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (dir && fs.existsSync(path.join(dir, exe))) return path.join(dir, exe);
  }
  const home = os.homedir();
  const local = path.join(home, '.local', 'bin', exe);
  if (fs.existsSync(local)) return local;
  const version = (name: string) => (name.match(/(\d+)\.(\d+)\.(\d+)/)?.slice(1) ?? ['0', '0', '0']).map(Number);
  const newer = (a: string, b: string) => {
    const [x, y] = [version(a), version(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  };
  for (const ext of ['.vscode', '.vscode-insiders', '.cursor', '.windsurf'].map((d) => path.join(home, d, 'extensions'))) {
    if (!fs.existsSync(ext)) continue;
    const found = fs
      .readdirSync(ext)
      .filter((d) => d.startsWith('anthropic.claude-code-'))
      .sort(newer)
      .reverse()
      .map((d) => path.join(ext, d, 'resources', 'native-binary', exe))
      .find((p) => fs.existsSync(p));
    if (found) return found;
  }
  return null;
}

/** Variables that tie a process to a running Claude Code session; the studio's call must be its own session. */
const SESSION_VARS = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_AGENT_SDK_VERSION|CLAUDE_CODE_(ENTRYPOINT|SESSION_ID|CHILD_SESSION|MESSAGING_SOCKET|MESSAGING_TOKEN|SESSION_ATTENDED|EXECPATH|EMIT_STARTUP_TIMING|ENABLE_SDK_FILE_CHECKPOINTING))$/;

function claudeCodeBackend(bin: string, model: string): Backend {
  // Runs outside the project so no CLAUDE.md, settings or MCP servers are picked up.
  const work = path.join(os.tmpdir(), 'fox-studio-claude');
  fs.mkdirSync(work, { recursive: true });
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SESSION_VARS.test(k)));
  env.CLAUDE_CODE_MAX_OUTPUT_TOKENS ??= '64000';
  return {
    name: 'claude-code',
    model,
    ask(system, user, signal) {
      const sysFile = path.join(work, 'system.md');
      fs.writeFileSync(sysFile, system);
      const args = [
        '-p',
        '--output-format', 'json',
        '--json-schema', JSON.stringify(REPLY_SCHEMA),
        '--system-prompt-file', sysFile,
        '--model', model,
        '--effort', 'high',
        '--tools', '',
        '--setting-sources', '',
        '--strict-mcp-config',
        '--disable-slash-commands',
        '--no-session-persistence',
      ];
      return new Promise((resolve, reject) => {
        const child = spawn(bin, args, { cwd: work, env, windowsHide: true });
        let out = '';
        let err = '';
        const stop = () => child.kill();
        const timer = setTimeout(stop, CLI_TIMEOUT_MS);
        signal.addEventListener('abort', stop);
        child.stdout.setEncoding('utf8').on('data', (c: string) => (out += c));
        child.stderr.setEncoding('utf8').on('data', (c: string) => (err += c));
        child.on('error', reject);
        child.on('close', (code) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', stop);
          if (signal.aborted) return reject(new Error('stopped'));
          let j: {
            is_error?: boolean;
            result?: string;
            structured_output?: Reply;
            usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
            modelUsage?: Record<string, unknown>;
          };
          try {
            j = JSON.parse(out);
          } catch {
            const why = (err || out).trim().split('\n').slice(-3).join(' ') || `exit code ${code}`;
            return reject(new Error(`Claude Code did not answer: ${why}`));
          }
          const u = j.usage ?? {};
          const usage = {
            input: u.input_tokens ?? 0,
            output: u.output_tokens ?? 0,
            cacheRead: u.cache_read_input_tokens ?? 0,
            cacheWrite: u.cache_creation_input_tokens ?? 0,
          };
          const used = Object.keys(j.modelUsage ?? {}).find((m) => m.startsWith('claude-opus') || m.startsWith('claude-sonnet') || m.startsWith('claude-fable')) ?? model;
          if (j.is_error || !j.structured_output) {
            resolve({ reply: null, error: j.result?.trim() || 'Claude Code returned no structured answer.', usage, model: used });
          } else resolve({ reply: j.structured_output, usage, model: used });
        });
        child.stdin.end(user);
      });
    },
  };
}

function apiBackend(client: Anthropic, model: string): Backend {
  return {
    name: 'api',
    model,
    async ask(system, user, signal) {
      const stream = client.beta.messages.stream(
        {
          model,
          max_tokens: 64000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'high', format: { type: 'json_schema', schema: REPLY_SCHEMA } },
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: user }],
        },
        { signal },
      );
      const msg = await stream.finalMessage();
      const usage = {
        input: msg.usage.input_tokens,
        output: msg.usage.output_tokens,
        cacheRead: msg.usage.cache_read_input_tokens ?? 0,
        cacheWrite: msg.usage.cache_creation_input_tokens ?? 0,
      };
      if (msg.stop_reason === 'refusal')
        return { reply: null, error: `Claude declined this request${msg.stop_details?.category ? ` (${msg.stop_details.category})` : ''}.`, usage, model: msg.model };
      if (msg.stop_reason === 'max_tokens') return { reply: null, error: 'The answer was cut off (too long). Try a smaller change.', usage, model: msg.model };
      const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      try {
        return { reply: JSON.parse(text) as Reply, usage, model: msg.model };
      } catch {
        return { reply: null, error: 'The answer was not valid JSON.', usage, model: msg.model };
      }
    },
  };
}

// ------------------------------------------------------------------ server

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => {
      data += c;
      if (data.length > 4_000_000) reject(new Error('request too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  if (res.writableEnded || res.destroyed) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function claudeScene(): Plugin {
  let server: ViteDevServer;
  let backend: Backend | null = null;
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
      const model = env.CLAUDE_MODEL || DEFAULT_MODEL;
      const bin = findClaudeCode(env);
      const key = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
      if (bin && spawnSync(bin, ['--version'], { windowsHide: true, timeout: 20000 }).status === 0) backend = claudeCodeBackend(bin, model);
      else if (key) backend = apiBackend(new Anthropic({ apiKey: key }), model);
      s.config.logger.info(`  Claude editing: ${backend ? `${backend.name === 'api' ? 'Anthropic API' : `Claude Code (${bin})`}, ${model}` : 'off (no Claude Code found, no ANTHROPIC_API_KEY)'}`);
      // The catalog may change while developing: rebuild the prompt on the next request.
      s.watcher.on('change', (file) => {
        if (/src[\\/](scene|data[\\/]specs)[\\/]/.test(file)) cachedSystem = null;
      });

      s.middlewares.use('/api/claude', async (req, res) => {
        const abort = new AbortController();
        // The page pressed Stop (or went away): stop Claude too.
        res.on('close', () => {
          if (!res.writableEnded) abort.abort();
        });
        try {
          if (req.method === 'GET' && req.url?.startsWith('/status'))
            return send(res, 200, { available: !!backend, backend: backend?.name ?? null, model: backend?.model ?? model });
          if (req.method !== 'POST' || !req.url?.startsWith('/edit')) return send(res, 404, { error: 'not found' });
          if (!backend) return send(res, 503, { error: 'Claude Code was not found on this computer (and there is no ANTHROPIC_API_KEY in .env).' });
          const r = JSON.parse(await readBody(req)) as EditRequest;
          if (!r?.prompt?.trim() || !Array.isArray(r.scenes) || !r.scenes.length) return send(res, 400, { error: 'empty request' });

          const { validateSpec } = (await server.ssrLoadModule('/src/scene/validate.ts')) as { validateSpec(x: unknown): string[] };
          const sys = await system();
          const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
          let user = userMessage(r);

          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const a = await backend.ask(sys, user, abort.signal);
            usage.input += a.usage.input;
            usage.output += a.usage.output;
            usage.cacheRead += a.usage.cacheRead;
            usage.cacheWrite += a.usage.cacheWrite;
            if (!a.reply) return send(res, 502, { error: a.error, usage });
            const { scenes, problems } = checkReply(a.reply, r, validateSpec);
            if (!problems.length) return send(res, 200, { summary: a.reply.summary, scenes, usage, model: a.model, attempts: attempt });
            if (attempt === MAX_ATTEMPTS) return send(res, 502, { error: `Claude's answer did not pass the checks: ${problems.slice(0, 6).join('; ')}`, usage });
            // Second try: same request plus the previous answer and what to fix.
            user = `${userMessage(r)}\n\n# Your previous answer\n${JSON.stringify(a.reply)}\n\nIt does not pass the studio's checks:\n- ${problems.join('\n- ')}\nReturn the corrected complete reply.`;
          }
        } catch (e) {
          if (abort.signal.aborted) return;
          if (e instanceof Anthropic.AuthenticationError) return send(res, 401, { error: 'The ANTHROPIC_API_KEY in .env was rejected.' });
          if (e instanceof Anthropic.PermissionDeniedError) return send(res, 403, { error: `This key cannot use ${backend?.model}.` });
          if (e instanceof Anthropic.RateLimitError) return send(res, 429, { error: 'Rate limited by the Anthropic API: try again in a minute.' });
          if (e instanceof Anthropic.BadRequestError) return send(res, 400, { error: `Anthropic API rejected the request: ${e.message}` });
          if (e instanceof Anthropic.APIError) return send(res, 502, { error: `Anthropic API error ${e.status ?? ''}: ${e.message}` });
          return send(res, 500, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}
