/**
 * Dev-server bridge to Claude for "edit with a prompt" (one scene or the whole episode).
 *
 * Runs only inside `npm run dev` (Vite `configureServer`). The browser posts the
 * scenes; this middleware asks Claude and checks the answer with the app's own
 * validator before returning it. Two backends, chosen at start-up:
 *
 * - Claude Code (default): runs the local `claude` CLI headless (`claude -p`),
 *   so requests use the Claude Code login of this computer — no API key. Its
 *   only tools are web search and web fetch (ideas and references; CLAUDE_WEB=off
 *   in .env turns them off): it never touches files.
 * - Anthropic API: only when no Claude Code binary is found and
 *   ANTHROPIC_API_KEY is set in .env (read on the Node side, never sent to the page).
 *
 *   GET  /api/claude/status -> { available, backend, model }
 *   POST /api/claude/edit   -> { summary, scenes: [{ index, spec, beats, duration, narration, fields }], newScenes, order, episode, images,
 *                                usage, model, attempts } | { error }
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
  transition?: string;
  chapterCard?: boolean;
  keywords?: string[];
  duration: number;
  authoredDuration: number;
  spec: unknown | null;
  beats: unknown[];
  sourceIds: string[];
  /** When each subtitle cue is heard, in the scene's authored seconds (exact = from the real voice clips). */
  speech?: { text: string; from: number; to: number; exact: boolean }[];
}

interface EpisodeIn {
  title: string;
  subtitle?: string;
  language: string;
  aspect: string;
  template: string;
  /** The Short's cold-open line in this language. */
  hook?: { text: string; keywords: string[] } | null;
  /** The settings Claude may change (see EPISODE_SETTINGS). */
  settings?: Record<string, unknown>;
  /** Studio narrator voices of this language. */
  voices?: { id: string; label: string }[];
  /** Whether the local image model (ComfyUI) is running: only then can Claude ask for new images. */
  images?: boolean;
  imageStyles?: Record<string, string>;
}

interface EditRequest {
  prompt: string;
  /** Index of the scene to edit, or "all" for the whole episode. */
  target: number | 'all';
  episode: EpisodeIn;
  scenes: SceneIn[];
  sources: { id: string; title: string; publisher?: string; date?: string; claims: string[] }[];
  /** The episode's image library (picture elements may only use these ids). */
  media?: { id: string; name: string; prompt: string; width: number; height: number }[];
  /** The animation clip library (sprite elements may only use these ids). */
  clips?: { id: string; label: string; frames: number; fps: number; duration: number }[];
  /** Rendered frames of the scenes in scope (JPEG data URLs), labelled with scene and authored second. */
  frames?: FrameIn[];
  /** Set when this is a check of an edit just made: frames then show the result of that edit. */
  review?: { request: string; summary: string } | null;
}

interface FrameIn {
  scene: number;
  at: number;
  label: string;
  data: string;
}

/** A picture for Claude: base64 JPEG and what it shows. */
interface Picture {
  label: string;
  base64: string;
}

function pictures(r: EditRequest): Picture[] {
  return (r.frames ?? [])
    .map((f) => ({ label: f.label, base64: /^data:image\/jpeg;base64,(.+)$/.exec(f.data)?.[1] ?? '' }))
    .filter((p) => p.base64)
    .slice(0, 32);
}

interface SceneOut {
  index: number;
  spec: unknown | null;
  beats: unknown[] | null;
  duration: number | null;
  /** New narration text (the studio voice records the new sentences), or null to keep it. */
  narration: string | null;
  /** Other scene fields to change (title, summary, transition, chapterCard, keywords, sourceIds). */
  fields: Record<string, unknown> | null;
}

interface NewSceneOut {
  ref: string;
  title: string;
  summary: string;
  narration: string;
  duration: number;
  transition: string;
  spec: unknown | null;
  beats: unknown[];
}

interface ImageOut {
  key: string;
  prompt: string;
  style: string;
  aspect: string;
}

/** Everything a checked reply changes. */
interface Changes {
  scenes: SceneOut[];
  newScenes: NewSceneOut[];
  /** Final scene order: existing indices and new-scene refs; null = keep. */
  order: (number | string)[] | null;
  episode: Record<string, unknown> | null;
  images: ImageOut[];
}

const TRANSITIONS = ['iris', 'fade', 'flash', 'ink'];
const IMAGE_ASPECTS = ['16:9', '9:16', '1:1'];
const NARRATION_MODES = ['studio', 'speech', 'file', 'off'];
const SCENE_FIELDS = ['title', 'summary', 'transition', 'chapterCard', 'keywords', 'sourceIds'];

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
          narration: {
            type: 'string',
            description: 'The complete new narration of the scene (what the voice says), or "" to keep it. Only when the instruction asks to change what is said.',
          },
          fields_json: {
            type: 'string',
            description: 'Other scene fields to change as a JSON object (title, summary, transition, chapterCard, keywords, sourceIds), or "" to keep them.',
          },
        },
        required: ['index', 'spec_json', 'beats_json', 'duration', 'narration', 'fields_json'],
        additionalProperties: false,
      },
    },
    new_scenes: {
      type: 'array',
      description: 'Scenes to add (whole-episode instructions only). Place them with order_json; without it they go at the end.',
      items: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Your name for it, "new-1", "new-2"... (used in order_json).' },
          title: { type: 'string' },
          summary: { type: 'string', description: 'What the scene is for, one sentence.' },
          narration: { type: 'string', description: 'What the voice says in it.' },
          duration: { type: 'number', description: 'Length in seconds (3-90).' },
          transition: { type: 'string', description: 'iris | fade | flash | ink' },
          spec_json: { type: 'string', description: 'Its complete SceneSpec as a JSON string (times in 0..duration).' },
          beats_json: { type: 'string', description: 'Its pop-ups as a JSON list, or "[]".' },
        },
        required: ['ref', 'title', 'summary', 'narration', 'duration', 'transition', 'spec_json', 'beats_json'],
        additionalProperties: false,
      },
    },
    order_json: {
      type: 'string',
      description:
        'Whole-episode instructions only: the final order of the scenes as a JSON list of current indices (numbers) and new-scene refs ("new-1"). A current scene left out is DELETED. "" keeps the order.',
    },
    episode_json: {
      type: 'string',
      description: 'Whole-episode instructions only: episode changes as a JSON object (episodeTitle, episodeSubtitle, hook, settings, sources_add), or "".',
    },
    images: {
      type: 'array',
      description: 'New pictures for the local image model to paint before your changes are applied; use them in picture elements as "new:<key>".',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Lowercase name with dashes, e.g. "senate-hearing".' },
          prompt: { type: 'string', description: 'What the picture shows (no text, no logos in it).' },
          style: { type: 'string', description: 'One of the image styles listed in the request.' },
          aspect: { type: 'string', description: '16:9 | 9:16 | 1:1' },
        },
        required: ['key', 'prompt', 'style', 'aspect'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'scenes', 'new_scenes', 'order_json', 'episode_json', 'images'],
  additionalProperties: false,
} as const;

interface Reply {
  summary: string;
  scenes: { index: number; spec_json: string; beats_json: string; duration: number; narration: string; fields_json: string }[];
  new_scenes?: { ref: string; title: string; summary: string; narration: string; duration: number; transition: string; spec_json: string; beats_json: string }[];
  order_json?: string;
  episode_json?: string;
  images?: { key: string; prompt: string; style: string; aspect: string }[];
}

interface Catalog {
  ELEMENTS: Record<string, { label: string; category: string; description: string; params: Record<string, { desc: string; default: unknown }> }>;
  ARM_MODES: readonly string[];
  FACE_KEYS: readonly string[];
  MOUTHS: readonly string[];
  SFX_SOUNDS: Record<string, string>;
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
- Tracks are lists of keys {"at": t, "value": v, "dur"?: seconds, "ease"?: "linear"|"smooth"|"in"|"out"|"inOut"|"back"|"bounce"|"hold"|[x1, y1, x2, y2]}: the value holds until "at", then moves to the new value over "dur" (0 = cut). Keys sorted by "at". A 4-number ease is a cubic Bézier speed curve like After Effects' graph editor / CSS: [0.33, 0, 0.67, 1] = AE Easy Ease, [0.33, 0, 1, 1] = Easy Ease In, [0, 0, 0.67, 1] = Easy Ease Out, [0.6, -0.4, 0.7, 1] = anticipation (pulls back first), [0.3, 1.4, 0.6, 1] = overshoot, [0.1, 0.9, 0.2, 1] = snappy. Use them for cartoon timing: anticipation before a big move, overshoot and settle after it.
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
- "view": keys of "side" | "front" (always cuts). "front" is a camera cut to Agent Fox talking into the lens: his bust fills the frame (left of centre in 16:9, centred in 9:16) over a blurred close-up of the set; his x/y/scale, walk and camera shots are ignored meanwhile. Use it for lines he says straight to the viewer (a reveal, a question to the audience), a few seconds at a time, then cut back to "side". Front arm poses that read best: rest, one, two, three, stop, chin, point, shake, knock, pinch, hips.

Camera: [{"at", "kind": "wide"|"medium"|"close"|"extreme"|"insert", "target"?: "fox"|elementId, "enter"?: "cut"|"push"|"whip", "sx"?, "sy"? (where the target lands on screen 0..1), "zoom"?, "drift"?, "locked"?, "foxX"?}]. The first shot is at 0. Wide shots ignore target.

Overlays (screen space): [{"kind": "title", "at", "subAt", "y", "maxWidth", "sunburst"?}] = the episode title slam.

# Layers (After Effects features, on ANY element, Agent Fox included)
- "parent": elementId — follows that element's animated move (dx, dy), turn (rot), "scaleBy" and wiggle, around its resting place (AE parenting). A "null" element is an invisible parent: give several elements the same null parent and animate only the null to move/turn/zoom them together.
- "scaleBy": number or keys — animated scale multiplier around the element's position (keyed AE Scale; "scale" stays the drawing's size).
- "wiggle": {"freq", "x"?, "y"? (frame fractions), "rot"? (rad), "scale"? (fraction), "seed"?} — smooth deterministic jitter (AE wiggle). Small values: x/y 0.002-0.01, rot 0.01-0.05.
- "repeat": {"every", "from"?, "mode"?: "cycle"|"pingpong"} — the element's own keys loop (AE loopOut), e.g. a bob or a swing.
- "blend": normal|multiply|screen|overlay|darken|lighten|add|colorDodge|colorBurn|hardLight|softLight|difference|exclusion|hue|saturation|color|luminosity — multiply for ink/stamps on paper, screen/add for light, overlay for texture.
- "fx": [effects in order] — {"type":"blur","amount"} · {"type":"glow","radius","intensity"?,"color"?} · {"type":"shadow","x"?,"y"?,"blur"?,"opacity"?,"color"?} (drop shadow) · {"type":"color","brightness"?,"contrast"?,"saturation"? (1 = unchanged),"hue"? (degrees),"sepia"?,"grayscale"?,"invert"? (0..1)} · {"type":"tint","color","amount"?} · {"type":"stroke","width","color"?} (outline round the whole shape) · {"type":"opacityFlicker","amount","freq"?} (old-film flicker). Sizes in u; any number may be keys.
- "mask": {"points": [{x, y}...] (world frame fractions, at least 3), "feather"? (u), "invert"?, "expand"? (u)} — shape mask (AE mask).
- "matte": {"source": elementId, "mode"?: "alpha"|"alphaInverted"|"luma"|"lumaInverted"} — track matte: shown only through (or outside) another element; give that source "isMatte": true so it is not drawn itself (e.g. a scene seen through a keyhole or a spotlight puff).
- "motionBlur": {"shutter"? (s, default 0.04), "samples"? (2-16)} — for fast moves (whips, throws, falling objects).
Elements "text" (per-letter animators: typewriter, fade, pop, rise, drop, wave), "null" and "sprite" (frame-by-frame clips) are listed with the other element types. These features are exact and cost nothing when unused: use them where they make a moment better, not everywhere.

Animation clips (element "sprite"): full drawings played one after another (Cuphead-style frame-by-frame), for special moments the puppet cannot do. Only clips from the clip library given in the request; place them like the fox (x, y = the clip's anchor, usually between the feet), "start" = authored second the first drawing shows, and do not show the puppet fox at the same time if the clip is of Agent Fox (use "from"/"to" on both to hand over).

Sound effects: "sfx": [{"at", "sound", "gain"? (0..2, default 1), "pan"? (-1 left .. 1 right), "count"? (repeats), "every"? (seconds between repeats, default 0.12)}] — synthesised by the studio and mixed over the music and the voice, in the preview and the export. Land them exactly on the picture's beats (a key strike on each letter, a stamp on the slam, a whoosh on a whip pan); a few strong ones beat a constant clatter, and keep them out of the way of spoken words when you can. Sounds:
${Object.entries(cat.SFX_SOUNDS).map(([k, d]) => `- ${k}: ${d}`).join('\n')}

# Pop-ups ("beats")
Explainer cards that appear when a phrase of the narration is spoken. Each has "cue": an EXACT phrase copied from that scene's narration, and "kind" with its fields:
question {text} · span {from, to, label} · count {value, label, note?} · versus {left, right, caption?} · define {word, pos, meaning} · waffle {total, hit, label, note?} · list {items[], title?} · record {tag, who, text, highlight, note} · statement {lines[]}.

# Narration
"narration" replaces what the voice says in a scene; leave it "" unless the instruction asks to change the words. The studio records new or changed sentences with its narrator voice automatically and keeps the recording of every sentence you leave word-for-word the same, so change only the sentences that need it. Same rules as everything on screen: only facts from the narration you were given or the listed sources, no invented numbers, names, dates or quotes; keep the tone of the series (clear, catchy explainer, short sentences that read well aloud). Pop-up cues must then be phrases of the NEW narration.

# Research
When frames are attached, look at them: they are the real picture (placement, overlaps, legibility, what the character is doing), rendered by the studio itself. Judge positions by them, not by numbers alone, and say in the summary what you saw that mattered.

You may use web search and web fetch for ideas: cartoon staging and gags, editing rhythm, how explainers keep viewers watching, period look and props. The web is for craft, not for content: a fact you find there never goes on screen or into the narration unless the listed sources support it. Mention in the summary anything useful you found that you could not use.

# Everything else in the studio
You can change everything the director can change in the editor:
- Scene fields ("fields_json" of a scene): title, summary (its intent), transition ("iris" | "fade" | "flash" | "ink", the wipe INTO the scene), chapterCard (false = no chapter intertitle on it), keywords (words highlighted in its burned-in subtitles; they must appear in its narration), sourceIds (ids of the listed sources that back its claims).
- Whole-episode instructions only:
  - New scenes ("new_scenes", with a complete spec built like the reference) and the scene order ("order_json"; a current scene you leave out of it is deleted — only when the instruction asks to remove it).
  - The episode ("episode_json"): episodeTitle, episodeSubtitle, hook ({"text", "keywords"}: the cold-open line of the vertical Short, in the episode language), settings (a partial object: filmGrain, music, musicVolume 0..1, chapterCards, shortHook, characterStyle "painted"|"vector", narrationMode ("studio" = the studio narrator, "speech" = the browser voice, "file", "off"), speechRate 0.5..2, studioVoice (one of the listed voice ids), subtitles {enabled, fontScale 0.6..2, position 0..1, highlightKeywords}), and sources_add (custom episodes only: [{"id","title","publisher","date","url","claims":[...]}] — only real pages you actually opened with web fetch, claims copied from what they say).
- New pictures ("images"): the studio paints them with its local image model before applying your changes, only when the request says the model is running. Use one in a picture element with "media": "new:<key>". Describe the picture, never text in it (the model cannot letter).
The MKUltra episode takes its episode title, subtitle and scene titles from its script: leave those as they are there.

# Hand-coded scenes
Some scenes have no spec ("spec": null): they are drawn by code. You can still change their pop-ups and length without touching the picture (spec_json ""). Write a new spec for one only when the instruction needs a change to its picture; it then replaces the coded version, so build it complete from the narration and the scene intent.

# Rules
1. Change only what the instruction asks; keep everything else exactly as it was (same ids, same values). A spec you return is the COMPLETE spec, never a fragment.
2. Return only the scenes you changed. For a one-scene instruction, change only that scene. For a whole-episode instruction, keep the episode consistent (same set style, Agent Fox's look, pacing) and avoid rewriting scenes the instruction does not need.
3. Facts: this is a documentary. Text in pop-ups and on props must be supported by the narration or the listed sources. Never invent numbers, names, dates or quotes. If the instruction asks for a fact that is not supported, do the rest and say so in the summary.
4. Good cartoon staging: anticipation before big moves, overlapping action, a camera change every 2-4 seconds, key moments on close-ups or inserts, Agent Fox fully in frame in both formats, nothing important hidden behind the subtitles (bottom 20%).
5. Use only the element types, poses and fields listed above. Element ids are lowercase words with dashes.
   Picture elements may only use image ids from the episode's image library given in the request. You cannot create images: if none fits, say so in the summary (the director can generate one in the studio).
6. Pop-ups: beats_json is the complete list for that scene when you change it, else "". Each cue must be a phrase that appears verbatim in that scene's narration (the new one, when you change it).
7. duration: 0 unless the instruction needs a different scene length (3-90 s).
8. Anything you do not change stays "" / [] in the reply (scene fields, new_scenes, order_json, episode_json, images).
9. The summary is for the director: plain words, saying which scenes you changed. Write it in the language of the director's instruction (an Italian instruction gets an Italian summary), whatever the language of the rest of this prompt.

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
      `Fields: ${JSON.stringify({ transition: s.transition, chapterCard: s.chapterCard !== false, keywords: s.keywords ?? [], sourceIds: s.sourceIds })}`,
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
  const e = r.episode;
  return [
    `Episode: "${e.title}" (${e.template === 'mkultra' ? 'MKUltra episode' : 'custom episode'}), language ${e.language}, editing in ${e.aspect}, ${r.scenes.length} scene(s).`,
    !target
      ? [
          '# Episode',
          e.subtitle ? `Subtitle: "${e.subtitle}"` : '',
          e.hook ? `Short hook: ${JSON.stringify(e.hook)}` : 'Short hook: none',
          e.settings ? `Settings: ${JSON.stringify(e.settings)}` : '',
          e.voices?.length ? `Studio voices for ${e.language}: ${e.voices.map((v) => `${v.id} (${v.label})`).join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      : '',
    e.images
      ? `# Image model\nRunning: you may ask for new pictures. Styles: ${Object.entries(e.imageStyles ?? {})
          .map(([k, d]) => `${k} (${d})`)
          .join('; ')}.`
      : '# Image model\nNot running: no new pictures (only the library).',
    r.clips?.length
      ? `# Animation clip library (for sprite elements)\n${r.clips.map((c) => `- ${c.id}: "${c.label}", ${c.frames} drawings, ${c.duration.toFixed(2)} s at ${c.fps} fps`).join('\n')}`
      : '# Animation clip library\nEmpty: no sprite elements possible.',
    r.media?.length
      ? `# Image library (for picture elements)\n${r.media.map((m) => `- ${m.id}: "${m.name}" ${m.width}x${m.height}${m.prompt ? ` — ${m.prompt}` : ''}`).join('\n')}`
      : '# Image library\nEmpty: no picture elements possible.',
    r.sources.length ? `# Sources (by id)\n${r.sources.map((s) => `- ${s.id}: ${s.title}${[s.publisher, s.date].filter(Boolean).map((x) => ` (${x})`).join('')}: ${s.claims.join(' | ')}`).join('\n')}` : '',
    `# Scenes\n${r.scenes.map(scene).join('\n\n')}`,
    r.frames?.length
      ? `# Frames\n${r.frames.length} rendered frame(s) of the scene(s) in scope are attached, in this order (exactly what the viewer sees, subtitles included, ${e.aspect}):\n${r.frames.map((f, i) => `${i + 1}. ${f.label}`).join('\n')}`
      : '',
    r.review
      ? [
          `# Check your edit${target ? ` of scene ${target.index + 1} (index ${target.index})` : ''}`,
          `You were asked: """${r.review.request}"""`,
          `You answered and the studio applied it: """${r.review.summary}"""`,
          'The scenes above are the result, and the attached frames show it. Look at every frame: is the request done, is every text inside the frame and readable, does anything cover a face, another text or the subtitles, does anything look broken or out of place? If it is right, change nothing (no scenes, no new scenes, no images) and start the summary with "OK:" saying what you checked. If not, return only the fixes, and say in the summary what was wrong.',
        ].join('\n')
      : target
        ? `# Instruction for scene ${target.index + 1} only (index ${target.index})\n"""${r.prompt}"""`
        : `# Instruction for the whole episode\n"""${r.prompt}"""`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStrList = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Picture elements may show a library image or one of the reply's new images ("new:<key>"). */
function checkPictures(spec: unknown, at: string, r: EditRequest, newKeys: Set<string>, problems: string[]) {
  const known = new Set((r.media ?? []).map((m) => m.id));
  for (const el of (spec as { elements?: { type?: string; id?: string; params?: { media?: unknown } }[] }).elements ?? []) {
    if (el.type !== 'picture') continue;
    const id = String(el.params?.media ?? '');
    if (id.startsWith('new:') ? !newKeys.has(id.slice(4)) : !known.has(id)) problems.push(`${at}: picture "${el.id}" uses "${id}", which is neither in the library nor in your images`);
  }
  const clips = new Set((r.clips ?? []).map((c) => c.id));
  for (const el of (spec as { elements?: { type?: string; id?: string; params?: { clip?: unknown } }[] }).elements ?? []) {
    if (el.type === 'sprite' && !clips.has(String(el.params?.clip ?? ''))) problems.push(`${at}: sprite "${el.id}" uses a clip that is not in the clip library`);
  }
}

/** Pop-ups: a list whose cues are phrases of `narration`. */
function checkBeats(beats: unknown, narration: string, at: string, problems: string[]) {
  if (!Array.isArray(beats)) return void problems.push(`${at}: pop-ups must be a JSON list`);
  const text = narration.toLowerCase();
  beats.forEach((b, i) => {
    const cue = (b as { cue?: unknown })?.cue;
    if (typeof cue !== 'string' || !cue.trim() || !text.includes(cue.toLowerCase().trim())) problems.push(`${at}: beats[${i}].cue is not a phrase of that scene's narration`);
  });
}

function checkFields(f: unknown, at: string, r: EditRequest, src: SceneIn | null, narration: string, problems: string[]): Record<string, unknown> | null {
  if (!isObj(f)) return void problems.push(`${at}: fields_json must be a JSON object`), null;
  const known = new Set(r.sources.map((x) => x.id));
  for (const k of Object.keys(f)) if (!SCENE_FIELDS.includes(k)) problems.push(`${at}: unknown scene field "${k}"`);
  if (f.title !== undefined && (typeof f.title !== 'string' || !f.title.trim())) problems.push(`${at}: title must be text`);
  if (f.title !== undefined && r.episode.template === 'mkultra' && src) problems.push(`${at}: MKUltra scene titles come from the script; leave the title out`);
  if (f.summary !== undefined && typeof f.summary !== 'string') problems.push(`${at}: summary must be text`);
  if (f.transition !== undefined && !TRANSITIONS.includes(String(f.transition))) problems.push(`${at}: transition must be one of ${TRANSITIONS.join(', ')}`);
  if (f.chapterCard !== undefined && typeof f.chapterCard !== 'boolean') problems.push(`${at}: chapterCard must be true or false`);
  if (f.keywords !== undefined) {
    if (!isStrList(f.keywords)) problems.push(`${at}: keywords must be a list of text`);
    else for (const k of f.keywords as string[]) if (!narration.toLowerCase().includes(k.toLowerCase())) problems.push(`${at}: keyword "${k}" is not in the narration`);
  }
  if (f.sourceIds !== undefined) {
    if (!isStrList(f.sourceIds)) problems.push(`${at}: sourceIds must be a list of ids`);
    else for (const id of f.sourceIds as string[]) if (!known.has(id)) problems.push(`${at}: source "${id}" is not in the list`);
  }
  return f;
}

function checkEpisode(e: unknown, r: EditRequest, problems: string[]): Record<string, unknown> | null {
  if (!isObj(e)) return void problems.push('episode_json must be a JSON object'), null;
  const allowed = ['episodeTitle', 'episodeSubtitle', 'hook', 'settings', 'sources_add'];
  for (const k of Object.keys(e)) if (!allowed.includes(k)) problems.push(`episode_json: unknown field "${k}"`);
  const mk = r.episode.template === 'mkultra';
  if ((e.episodeTitle !== undefined || e.episodeSubtitle !== undefined) && mk) problems.push('episode_json: the MKUltra title and subtitle come from the script');
  for (const k of ['episodeTitle', 'episodeSubtitle']) if (e[k] !== undefined && typeof e[k] !== 'string') problems.push(`episode_json.${k} must be text`);
  if (e.hook !== undefined && !(isObj(e.hook) && typeof e.hook.text === 'string' && e.hook.text.trim() && isStrList(e.hook.keywords)))
    problems.push('episode_json.hook must be {"text": "...", "keywords": [...]}');
  if (e.settings !== undefined) {
    if (!isObj(e.settings)) problems.push('episode_json.settings must be an object');
    else {
      const st = e.settings;
      const bool = ['filmGrain', 'music', 'chapterCards', 'shortHook'];
      const num: Record<string, [number, number]> = { musicVolume: [0, 1], speechRate: [0.5, 2] };
      for (const k of Object.keys(st)) {
        if (bool.includes(k)) {
          if (typeof st[k] !== 'boolean') problems.push(`settings.${k} must be true or false`);
        } else if (k in num) {
          const v = st[k];
          if (typeof v !== 'number' || v < num[k][0] || v > num[k][1]) problems.push(`settings.${k} must be a number in ${num[k][0]}..${num[k][1]}`);
        } else if (k === 'characterStyle') {
          if (st[k] !== 'painted' && st[k] !== 'vector') problems.push('settings.characterStyle must be "painted" or "vector"');
        } else if (k === 'narrationMode') {
          if (!NARRATION_MODES.includes(String(st[k]))) problems.push(`settings.narrationMode must be one of ${NARRATION_MODES.join(', ')}`);
        } else if (k === 'studioVoice') {
          if (!(r.episode.voices ?? []).some((v) => v.id === st[k])) problems.push('settings.studioVoice must be one of the listed voice ids');
        } else if (k === 'subtitles') {
          const sb = st[k];
          if (!isObj(sb)) problems.push('settings.subtitles must be an object');
          else
            for (const [sk, sv] of Object.entries(sb)) {
              if (sk === 'enabled' || sk === 'highlightKeywords') {
                if (typeof sv !== 'boolean') problems.push(`settings.subtitles.${sk} must be true or false`);
              } else if (sk === 'fontScale') {
                if (typeof sv !== 'number' || sv < 0.6 || sv > 2) problems.push('settings.subtitles.fontScale must be 0.6..2');
              } else if (sk === 'position') {
                if (typeof sv !== 'number' || sv < 0 || sv > 1) problems.push('settings.subtitles.position must be 0..1');
              } else problems.push(`settings.subtitles: unknown field "${sk}"`);
            }
        } else problems.push(`settings: "${k}" cannot be changed here`);
      }
    }
  }
  if (e.sources_add !== undefined) {
    if (mk) problems.push('episode_json.sources_add: the MKUltra sources are fixed');
    else if (!Array.isArray(e.sources_add)) problems.push('episode_json.sources_add must be a list');
    else
      e.sources_add.forEach((x, i) => {
        if (!(isObj(x) && typeof x.id === 'string' && typeof x.title === 'string' && typeof x.url === 'string' && /^https?:\/\//.test(x.url) && isStrList(x.claims)))
          problems.push(`sources_add[${i}] needs id, title, url (http...) and claims`);
      });
  }
  return e;
}

/** Checks Claude's reply against the request; returns what to apply or the problems. */
function checkReply(reply: Reply, r: EditRequest, validateSpec: (x: unknown) => string[]): Changes & { problems: string[] } {
  const problems: string[] = [];
  const scenes: SceneOut[] = [];
  const changes: Changes = { scenes, newScenes: [], order: null, episode: null, images: [] };
  if (!Array.isArray(reply?.scenes)) return { ...changes, problems: ['"scenes" must be a list'] };
  const whole = r.target === 'all';

  // Images first: specs may refer to them.
  const keys = new Set<string>();
  for (const [i, im] of (reply.images ?? []).entries()) {
    const at = `images[${i}]`;
    if (!r.episode.images) {
      problems.push(`${at}: the image model is not running, no new pictures`);
      continue;
    }
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(im.key) || keys.has(im.key)) problems.push(`${at}: key must be a unique lowercase name with dashes`);
    if (!im.prompt?.trim()) problems.push(`${at}: empty prompt`);
    if (!Object.keys(r.episode.imageStyles ?? {}).includes(im.style)) problems.push(`${at}: style must be one of ${Object.keys(r.episode.imageStyles ?? {}).join(', ')}`);
    if (!IMAGE_ASPECTS.includes(im.aspect)) problems.push(`${at}: aspect must be one of ${IMAGE_ASPECTS.join(', ')}`);
    keys.add(im.key);
    changes.images.push({ key: im.key, prompt: im.prompt.trim(), style: im.style, aspect: im.aspect });
  }

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
        checkPictures(spec, at, r, keys, problems);
      }
      if (s.beats_json) beats = JSON.parse(s.beats_json);
    } catch (e) {
      problems.push(`${at}: not valid JSON (${e instanceof Error ? e.message : String(e)})`);
      continue;
    }
    const newNarration = typeof s.narration === 'string' && s.narration.trim() ? s.narration.trim() : null;
    if (newNarration && newNarration.split(/\s+/).length < 3) problems.push(`${at}: the new narration is too short`);
    // Pop-ups must follow the words that will be spoken: the new narration, or the current one.
    const spoken = newNarration ?? src.narration;
    if (
      newNarration &&
      beats === null &&
      src.beats.some((b) => {
        const cue = (b as { cue?: unknown })?.cue;
        return typeof cue === 'string' && !spoken.toLowerCase().includes(cue.toLowerCase().trim());
      })
    )
      problems.push(`${at}: the new narration drops phrases the current pop-ups are cued on; return beats_json with cues from the new narration`);
    if (beats !== null) checkBeats(beats, spoken, at, problems);
    let fields: Record<string, unknown> | null = null;
    if (s.fields_json) {
      try {
        fields = checkFields(JSON.parse(s.fields_json), at, r, src, spoken, problems);
      } catch (e) {
        problems.push(`${at}: fields_json is not valid JSON (${e instanceof Error ? e.message : String(e)})`);
      }
    }
    scenes.push({ index: s.index, spec, beats: beats as unknown[] | null, duration: s.duration || null, narration: newNarration, fields });
  }

  // Whole-episode changes.
  const newRefs = new Set<string>();
  for (const [i, n] of (reply.new_scenes ?? []).entries()) {
    const at = `new_scenes[${i}]`;
    if (!whole) {
      problems.push(`${at}: new scenes only with a whole-video instruction`);
      continue;
    }
    if (!/^new-\d+$/.test(n.ref) || newRefs.has(n.ref)) problems.push(`${at}: ref must be a unique "new-<n>"`);
    newRefs.add(n.ref);
    if (!n.title?.trim()) problems.push(`${at}: needs a title`);
    if (!(n.duration >= 3 && n.duration <= 90)) problems.push(`${at}: duration must be 3..90 s`);
    if (!TRANSITIONS.includes(n.transition)) problems.push(`${at}: transition must be one of ${TRANSITIONS.join(', ')}`);
    let spec: unknown = null;
    let beats: unknown = [];
    try {
      spec = n.spec_json ? JSON.parse(n.spec_json) : null;
      beats = n.beats_json ? JSON.parse(n.beats_json) : [];
    } catch (e) {
      problems.push(`${at}: not valid JSON (${e instanceof Error ? e.message : String(e)})`);
      continue;
    }
    if (spec === null) problems.push(`${at}: needs a complete spec`);
    else {
      problems.push(...validateSpec(spec).map((p) => `${at}: ${p}`));
      checkPictures(spec, at, r, keys, problems);
    }
    checkBeats(beats, n.narration ?? '', at, problems);
    changes.newScenes.push({ ref: n.ref, title: n.title.trim(), summary: n.summary ?? '', narration: (n.narration ?? '').trim(), duration: n.duration, transition: n.transition, spec, beats: (beats as unknown[]) ?? [] });
  }
  if (reply.order_json) {
    try {
      const order = JSON.parse(reply.order_json);
      if (!whole) problems.push('order_json: only with a whole-video instruction');
      else if (!Array.isArray(order) || !order.length) problems.push('order_json must be a non-empty JSON list');
      else {
        const seen = new Set<string>();
        for (const x of order) {
          const key = String(x);
          if (seen.has(key)) problems.push(`order_json: ${key} appears twice`);
          seen.add(key);
          if (typeof x === 'number' ? !r.scenes.some((sc) => sc.index === x) : !newRefs.has(String(x))) problems.push(`order_json: ${JSON.stringify(x)} is neither a scene index nor a new scene`);
        }
        changes.order = order;
      }
    } catch (e) {
      problems.push(`order_json is not valid JSON (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  if (reply.episode_json) {
    try {
      if (!whole) problems.push('episode_json: only with a whole-video instruction');
      else changes.episode = checkEpisode(JSON.parse(reply.episode_json), r, problems);
    } catch (e) {
      problems.push(`episode_json is not valid JSON (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return { ...changes, problems };
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
  ask(system: string, user: string, signal: AbortSignal, pics?: Picture[]): Promise<Answer>;
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

function claudeCodeBackend(bin: string, model: string, web: boolean): Backend {
  // Runs outside the project so no CLAUDE.md, settings or MCP servers are picked up.
  const work = path.join(os.tmpdir(), 'fox-studio-claude');
  fs.mkdirSync(work, { recursive: true });
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SESSION_VARS.test(k)));
  env.CLAUDE_CODE_MAX_OUTPUT_TOKENS ??= '64000';
  return {
    name: 'claude-code',
    model,
    ask(system, user, signal, pics = []) {
      const sysFile = path.join(work, 'system.md');
      fs.writeFileSync(sysFile, system);
      // Frames go as files the CLI may only Read (nothing else on disk), listed at the end of the message.
      const frames = path.join(work, 'frames');
      fs.rmSync(frames, { recursive: true, force: true });
      if (pics.length) {
        fs.mkdirSync(frames, { recursive: true });
        pics.forEach((p, i) => fs.writeFileSync(path.join(frames, `frame${String(i + 1).padStart(2, '0')}.jpg`), Buffer.from(p.base64, 'base64')));
        user += `\n\n# Frame files\nOpen every frame with the Read tool before answering (paths relative to the working directory):\n${pics
          .map((p, i) => `- frames/frame${String(i + 1).padStart(2, '0')}.jpg: ${p.label}`)
          .join('\n')}`;
      }
      const tools = [...(web ? ['WebSearch', 'WebFetch'] : []), ...(pics.length ? ['Read'] : [])];
      const args = [
        '-p',
        '--output-format', 'json',
        '--json-schema', JSON.stringify(REPLY_SCHEMA),
        '--system-prompt-file', sysFile,
        '--model', model,
        '--effort', 'high',
        // Web search/fetch (ideas and references) and reading the frames; no other file, shell or other tools.
        '--tools', tools.join(','),
        ...(tools.length ? ['--allowedTools', ...tools.map((t) => (t === 'Read' ? 'Read(./frames/**)' : t))] : []),
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
    async ask(system, user, signal, pics = []) {
      const content: Anthropic.Beta.BetaContentBlockParam[] = [{ type: 'text', text: user }];
      for (const p of pics) {
        content.push({ type: 'text', text: p.label });
        content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: p.base64 } });
      }
      const stream = client.beta.messages.stream(
        {
          model,
          max_tokens: 64000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'high', format: { type: 'json_schema', schema: REPLY_SCHEMA } },
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content }],
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
      if (data.length > 24_000_000) reject(new Error('request too large'));
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
    const cat = {
      ...((await server.ssrLoadModule('/src/scene/elements.ts')) as unknown as Omit<Catalog, 'SFX_SOUNDS'>),
      SFX_SOUNDS: ((await server.ssrLoadModule('/src/audio/sfx.ts')) as { SFX_SOUNDS: Record<string, string> }).SFX_SOUNDS,
    } as Catalog;
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
      if (bin && spawnSync(bin, ['--version'], { windowsHide: true, timeout: 20000 }).status === 0) backend = claudeCodeBackend(bin, model, env.CLAUDE_WEB !== 'off');
      else if (key) backend = apiBackend(new Anthropic({ apiKey: key }), model);
      s.config.logger.info(`  Claude editing: ${backend ? `${backend.name === 'api' ? 'Anthropic API' : `Claude Code (${bin})`}, ${model}` : 'off (no Claude Code found, no ANTHROPIC_API_KEY)'}`);
      // The catalog may change while developing: rebuild the prompt on the next request.
      s.watcher.on('change', (file) => {
        if (/src[\\/](scene|data[\\/]specs|audio)[\\/]/.test(file)) cachedSystem = null;
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
          const pics = pictures(r);

          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const a = await backend.ask(sys, user, abort.signal, pics);
            usage.input += a.usage.input;
            usage.output += a.usage.output;
            usage.cacheRead += a.usage.cacheRead;
            usage.cacheWrite += a.usage.cacheWrite;
            if (!a.reply) return send(res, 502, { error: a.error, usage });
            const { problems, ...changes } = checkReply(a.reply, r, validateSpec);
            if (!problems.length) return send(res, 200, { summary: a.reply.summary, ...changes, usage, model: a.model, attempts: attempt });
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
