# The Fox Files Studio — *MKUltra: The Secret Experiments*

A browser-only animated documentary editor built for a single episode. Agent Fox, an original
noir fox detective drawn entirely with Canvas 2D, walks through what the U.S. Senate record
actually shows about the CIA's MKUltra program — narrated in English, Italian, Spanish, French or
Brazilian Portuguese by a neural "studio" voice, with burned-in subtitles, two aspect ratios and a real
video export. No backend, no API keys.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

Node 18+ is enough. The production build uses relative paths, so `dist/` works from any static host
or sub-folder.

## What works

| Area | Details |
| --- | --- |
| Project | Preconfigured MKUltra project (6 scenes, 90 s). Edits autosave to `localStorage`; **Reset** restores the original. |
| Animation | Six choreographed Canvas scenes: character, moving props, camera pushes/pans, document overlays, film grain, dust, scratches, vignette, iris / fade / projector-flash transitions. Everything is a pure function of timeline time, so seeking reproduces the exact frame. All procedural randomness is seeded. |
| Painted Agent Fox | Default look: a cut-out rig built from rig-ready part sheets (`art/parts/*.jpg`: full figure, blank heads, eyes, 12 mouths, torso, neck, sleeves, gloves, legs, shoes, tail, props; generated to the model sheet). `tools/upscale.py` upscales each sheet 4x (Real-ESRGAN anime weights in `tools/weights/`, CPU), `tools/bake_rig.py` keys the green, cuts every part, aligns head parts in the blank head's frame (mouths fitted to the muzzle and nose: `art/parts/fits.json`), straightens sleeves and legs and compresses their middles to the reference joint lengths, and writes `src/character/rig/` (sprites + `rig.json`). At runtime (`rig/rigPuppet.ts` + `AgentFox.ts`) arms and legs are rubber-hose limbs: one continuous sleeve/trouser texture laid along a curve with constant width (it bows when the limb is shorter, stretches when it must reach), sleeves come out from under the coat's shoulder caps, gloves are mirrored so thumbs face the body, fast pose changes leave old-cartoon "multiples" of the glove, feet stay planted while the body bounces on the beat (knees bow), the walk lifts and plants each foot, the head turns on the neck (beat, talking nods, idle sway, moods), the hat pops, tips and travels to the hand, the tail wags; eyes are 1930s pie-cut eyes drawn live (gaze, darting saccades, blinks, mood lids, happy and closed eyes), the head squashes and stretches, the hat lags and settles, brows act, and 12 mouth drawings follow the narration. Toggle "Painted Agent Fox" under Format & look for the vector rig. |
| Agent Fox (vector) | `src/character/AgentFox.ts`, rig v4 — a clean cartoon model: every part is a closed shape with one outline weight, one flat base colour and one flat shadow (cel shading); parts are layered in a fixed order so joints hide behind the part in front (no seams, no line jitter). Rubber-hose bounce on the score's beat, squash & stretch, secondary motion on head and ears, 13 blended arm poses, 4 glove shapes, 6 expressions, a 10-shape mouth chart driven by the narration text (text-based lip-sync), walk cycle, takes, `!`/`?` pops. The **Agent Fox** button opens a live model sheet (proportions, expressions, mouth chart, hands, key poses) with PNG export. |
| Playback | Play/pause (Space), restart, click-to-play preview, timeline scrubbing (drag, arrow keys), scene selection, preview speed 0.25–2× (export is always 1×). |
| Editing | Scene duration (choreography time-stretches to fit), entry transition, narration text (drives both voice and subtitles), highlighted keywords, subtitle size/position/visibility, film grain, aspect ratio, safe-area overlay. |
| Language | **English, Italiano, Español, Français, Português (Brasil)** — narration, subtitles, pop-ups, chapter titles, the Short's hook and every on-screen label (stamps, cards, counters, map, newspaper) switch together. Translations follow the English script sentence by sentence: same facts, numbers, names and dates (`src/i18n/scripts.ts`, labels in `src/i18n/labelStrings.ts`). Edits are kept per language. |
| Narration | **Studio voice** (default): a neural narrator — Kokoro-82M (Apache-2.0), rendered offline into one compressed voice pack per narrator in `public/voice/` (EN: Michael, Heart, George · IT: Nicola, Sara · ES: Álex, Dora · FR: Siwis · PT: Alex, Dora). The real clip lengths drive the timeline: subtitles split where the voice pauses, pop-ups land on the spoken phrase, the mouth follows the audio level, scenes lengthen if the voice needs room, and the voice is mixed into the export. Rewritten lines: run `python tools/voice_server.py` and the studio renders them with the same voice on the fly (otherwise the browser voice reads them in the preview). **Browser voice** (Web Speech API, voices for the chosen language; preview only). **Audio file**: your own recording, mixed into the export. **Off**. |
| Camera | `src/animation/camera.ts` — every scene is cut like a cartoon: wide, medium, close-up and insert shots with hard cuts, push-ins, whip pans with motion streaks, slow drift and a little hand-held float. Overlays stay in screen space. |
| Short & hook | In 9:16 the timeline gets a 5.6 s cold-open hook (smash-cut close-up, word-by-word kinetic captions, hit + riser in the score) before the episode. Toggle under Format & look. |
| Film language | `src/effects/cartoon.ts` — 1930s chapter cards with rotating sunbursts that iris into each scene, spinning newspaper insert, bouncy fact pop-ups with hard ink shadows, slammed numbers with starbursts and impact shakes, a flip-digit case plaque showing the year under discussion, to-scale ink bar charts, a timeline of the record, watercolour-washed backdrops, props that bounce on the beat, projector gate weave and rounded gate corners, ink-splat wipes. |
| Music | An original 1930s hot-jazz score (catchy muted-trumpet hook, clarinet riff, brass hits, stride piano, walking bass, swing drums, a fill + crash into every chapter card, a drumless chorale under scene 4, a major "ta-daa" ending), synthesised sample by sample in the browser (`src/audio/ambience.ts`, ~1–6 s to build) and ducked under every narration line. Or load your own track (e.g. from the YouTube Audio Library): it is looped to the episode length and ducked the same way. |
| Narration & pop-ups | Explainer-style script (question → context → evidence → what it means) read slowly with real pauses between sentences; explainer pop-ups (`src/effects/beats.ts`) are synced to the exact phrase in the narration: question cards, year spans, counters, waffle charts, definitions, stamped lists, highlighted record cards and kinetic statements, defined per scene in `src/data/mkultraScript.ts`. |
| Subtitles | Sentence-based cues timed **exactly** from the studio voice (or estimated from word count ÷ speech rate for the browser voice), keyword highlighting, safe margins for vertical video, burned into preview and export. Also downloadable as `.srt` / `.vtt`. |
| Export | 1920×1080 or 1080×1920 at 30 fps (or a 2/3-size option). See below. |
| Sources | A panel listing each primary source, its date, URL and the claims it supports. |

## Export — what you actually get

**Export YouTube + Short** renders the 16:9 cut and then the 9:16 Short (with hook) in one go. **Publishing kit** downloads a text file with title options, a factual description, YouTube chapters computed from the timeline (first at 0:00, each ≥ 10 s), sources, tags, and the Short's caption, hashtags and pinned comment.


The dialog detects what the browser can encode at runtime and only offers working options:

1. **MP4 via WebCodecs** (`src/export/mp4Encoder.ts`) — renders every frame on a dedicated canvas,
   encodes with `VideoEncoder` (H.264, or VP9 when the browser exposes no H.264 encoder) and muxes
   with `mp4-muxer`. Audio is AAC, or Opus when AAC isn't available. Frame-accurate; speed depends on
   the encoder.
2. **MediaRecorder** (`src/export/browserRecorder.ts`) — `canvas.captureStream(30)` plus a Web Audio
   stream, recorded in real time. A 90-second episode takes about 90 seconds or more; keep the tab
   visible. Produces MP4 or WebM depending on the browser.

The file extension and MIME type always come from what the browser actually produced — a WebM is
never renamed to `.mp4`. After export the file is loaded back into a `<video>` element to confirm it
decodes, and a frame is sampled to make sure it isn't black.

**Narration and export.** The studio voice and audio files are real audio and are mixed into the
export. Browser speech synthesis is produced by the operating system, outside the page's audio graph,
so it **cannot** be recorded into the file; the export dialog says so plainly. The score/room tone is
always exportable, and a separate `.wav` soundtrack download is provided.

## Studio voice — rebuilding or changing it

```bash
pip install kokoro-onnx soundfile numpy        # + ffmpeg on PATH
node tools/export_cues.mjs                     # voice/cues.json: every sentence, split like the app
python tools/render_voice.py                   # all packs → public/voice/  (or --only it:im_nicola)
python tools/voice_server.py                   # optional: live rendering of rewritten lines
```

The model (~330 MB) downloads once from the kokoro-onnx GitHub release into `voice/models/`. To add a
narrator, add it to `src/audio/studioVoices.ts` (any Kokoro voice id) and render. Pronunciation hints
for the voice only (e.g. "MKUltra" → "M K Ultra") are the `say` lists in `src/i18n/scripts.ts`.
To use a voice from another service (ElevenLabs, a human recording…), export the narration script and
load the recording under *Audio file*.

The MP4 encoder sits behind the `Mp4Encoder` interface, so a different implementation can be passed to
`runExport({ mp4Encoder })`.

## QA scripts

`npm run qa:frames`, `npm run qa:labels`, `npm run qa:voice` (Playwright, against `npm run dev`) — see CLAUDE.md.

## Tested

In headless Chromium 141 (no proprietary codecs):

- Loads with no credentials; all six scenes render in both aspect ratios; no page errors.
- Playback advances; scene selection and timeline scrubbing seek correctly; duration and subtitle
  edits update the preview and timeline; grain toggle changes the frame; settings survive a reload.
- Exports, checked with `ffprobe`:
  - WebCodecs MP4, 1920×1080, VP9, 2,700 frames, 90.0 s.
  - WebCodecs MP4, 720×1280, VP9 + Opus, 90.0 s.
  - MediaRecorder WebM, 1280×720, VP9 + Opus, 90 s.
  - MediaRecorder MP4, 1280×720, VP9 + Opus, 90.0 s.

H.264/AAC output depends on the browser (Chrome/Edge on Windows and macOS, Safari) and was not
available in the test environment. Speech synthesis had no voices in the headless test browser, so voice
playback was not exercised there.

## Project structure

```
src/
  app/          App.tsx, usePlayback.ts (clock + speech cues), fonts.ts, ErrorBoundary.tsx
  components/   Header, SceneList, PreviewPlayer, Timeline, PropertiesPanel, SubtitleEditor,
                ExportDialog, SourcesPanel
  animation/    renderScene.ts (single frame renderer used everywhere), timeline.ts (shared timing,
                cues, SRT/VTT), stage.ts, math.ts, props.ts, scenes/*.ts (one file per scene)
  character/    AgentFox.ts (rig: painted look + vector look), modelSheet.ts,
                rig/ (baked part sprites, rig.json, rigPuppet.ts: cut-out rig drawing + live face)
art/            parts/ (rig-ready part sheets + fits.json), agent-fox-model-sheet-painted.png (reference)
tools/          upscale.py, bake_rig.py (python: numpy, scipy, opencv-python, scikit-image, torch)
                export_cues.mjs, render_voice.py, voice_server.py, kokoro_voice.py (kokoro-onnx)
  effects/      filmGrain.ts, transitions.ts
  data/         mkultraProject.ts, mkultraScript.ts, sources.ts
  i18n/         languages.ts, scripts.ts (all five scripts), labels.ts + labelStrings.ts (on-screen labels)
  audio/        ambience.ts, narration.ts (Web Audio engine), studioVoice.ts + studioVoices.ts (neural
                narrator), speechSynthesis.ts, audioCapture.ts
public/voice/   studio voice packs (<lang>-<voice>.mp3 + .json)
  export/       capabilities.ts, mp4Encoder.ts, browserRecorder.ts, runExport.ts
  styles/       global.css
  types.ts      Project, Scene, AnimationEvent, Subtitle, AudioSource, ExportSettings, …
```

## Historical accuracy

The narration is original and paraphrases the record; it contains no quotations attributed to real
people. Every claim maps to an entry in `src/data/sources.ts`:

- *Project MKULTRA, the CIA's Program of Research in Behavioral Modification* — joint Senate hearing,
  August 3, 1977. <https://www.intelligence.senate.gov/sites/default/files/hearings/95mkultra.pdf>
- Church Committee Final Report, Book I (April 1976).
  <https://www.intelligence.senate.gov/sites/default/files/94755_I.pdf>
- U.S. Senate Historical Office, *Church Committee*.
  <https://www.senate.gov/about/powers-procedures/investigations/church-committee.htm>

The bibliography is **precompiled** (checked when the demo was built) and labelled as such in the app;
it is not re-verified live. On-screen documents are illustrations, not reproductions. Many MKUltra
records were destroyed in 1973, so the episode avoids presenting unverified allegations as fact.

## Fonts

Playfair Display, Special Elite and IBM Plex load from Google Fonts when online. Offline, the canvas
falls back to local serif / typewriter / sans fonts and everything still works.
