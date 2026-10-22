# CLAUDE.md — The Fox Files Studio

Context for Claude Code. Read this first; README.md has the user-facing feature list.

## Working with Salvatore (the owner)

- **Reply in Italian.** Code, comments and commit messages stay in English.
- He is a developer, wants the **highest visual quality** ("stile Cuphead": fluid, detailed, rubber-hose 1930s cartoon) and a **catchy Vox-style explainer** narration that keeps viewers glued — but every fact must stay true to the sources (`src/data/sources.ts`). Never invent facts, numbers or quotes; Kennedy's line is a paraphrase in every language.
- He judges by looking: after any visual change, render frames/contact sheets and actually look at them before saying it's done. Be honest about what you could not verify (e.g. you can't listen to audio).
- Work on a branch and open a PR for anything non-trivial so he can compare before/after.
- Do not export or send full videos unless asked; still frames and short audio previews are fine.

## What it is

Browser-only (Vite 7 + React 19 + TypeScript strict) editor that produces one animated documentary episode, *MKUltra: The Secret Experiments*, starring Agent Fox. Outputs 16:9 (YouTube) and 9:16 (Short with a cold-open hook) as real MP4/WebM, rendered in the browser.

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # typecheck + production build (dist/, relative base './')
```

## Architecture — the rules that matter

- **One renderer for everything**: `renderFrame()` in `src/animation/renderScene.ts` draws a frame at a global time. Preview, thumbnails and both exporters call it, so it must stay **deterministic** (no wall clock, no Math.random without a seed — use `hash()` from `animation/math.ts`).
- **Timeline** (`src/animation/timeline.ts`, `buildTimeline(project, rate, voice)`): scenes → spans, narration → sentences (`splitSentences`) → subtitle cues (`splitSentence`, ≤13 words, split at a mid clause). With the studio voice, real clip lengths drive cue times exactly, cues change at the voice's pauses, and a scene **extends** if the voice needs more room. `tl.level(t)` = voice loudness for lip sync. Choreography is authored in short "authored seconds" (`CHOREOGRAPHY_LENGTH` in `data/mkultraProject.ts`) and time-stretched: `k = choreoTime(span, local)`.
- **Scenes**: `src/animation/scenes/scene*.ts`, one per scene id (`file, question, experiments, cost, revelation, known`) + `hook.ts`. Props/drawing helpers in `animation/props.ts` and `effects/cartoon.ts`.
- **Explainer pop-ups ("beats")**: `src/effects/beats.ts`, defined per scene and language in `src/i18n/scripts.ts`; each beat triggers on a phrase (`cue`) found in the narration text.
- **Agent Fox**: `src/character/AgentFox.ts` (+ `rig/rigPuppet.ts`). Painted cut-out rig from baked sprites in `src/character/rig/` (rubber-hose "noodle" limbs strip-mapped along a curve, band warps for spine/coat/tail, pie-cut procedural eyes, 12 mouth drawings, gloves mirrored with flipY). Near arm = character's left, lighter, drawn ABOVE the torso with no shoulder cap; far arm behind. A vector rig remains as fallback (`characterStyle: 'vector'`).
- **Languages** (`src/i18n/`): en, it, es, fr, pt(-BR). `scripts.ts` holds narration, titles, keywords, beats, hook and TTS pronunciation hints (`say`). On-screen labels are drawn as English literals and translated at the canvas level (`labels.ts` patches fillText/strokeText/measureText; dictionary in `labelStrings.ts`; `wrapText` translates before splitting). New on-screen text → add it to `labelStrings.ts` for all four languages and run `npm run qa:labels -- <lang>`.
- **Studio voice** (`src/audio/studioVoice.ts`, voices in `studioVoices.ts`): Kokoro-82M packs in `public/voice/<lang>-<voice>.{mp3,json}`, rendered offline. Rewritten sentences missing from the pack are rendered live by `tools/voice_server.py` (127.0.0.1:8765, auto-probed only when the app runs on localhost) or read by the browser voice in preview (silent in export).
- **Music**: `src/audio/ambience.ts`, original hot-jazz score synthesised sample by sample (direct DSP — never go back to OfflineAudioContext node graphs, they took 300 s), ducked under every cue. Users can load their own track (`fitMusicTrack`).
- **Export**: `src/export/` (WebCodecs MP4 via mp4-muxer, or MediaRecorder). Narration (studio track or file) and music are mixed in `audio/audioCapture.ts`.

## Pipelines (tools/)

- Character parts: art sheets in `art/parts/*.jpg` (green-screen, Gemini-generated to the model sheet) → `python tools/upscale.py` (Real-ESRGAN anime, weights in `tools/weights/`, not in git) → `python tools/bake_rig.py` → `src/character/rig/` sprites + `rig.json` + `assets.ts`. Mouth/face alignment in `art/parts/fits.json`.
- Voice: `node tools/export_cues.mjs` → `python tools/render_voice.py [--only it:im_nicola]` (needs `pip install kokoro-onnx soundfile numpy` + ffmpeg; model auto-downloads to `voice/models/`, not in git). Re-render after changing narration text or the sentence splitter.

## Verifying changes

```bash
npm run typecheck && npm run build
npm i -D playwright && npx playwright install chromium   # once
npm run dev &                                             # QA scripts drive the dev server
npm run qa:frames -- it im_nicola 16:9                    # frames at every pop-up + every 6 s → qa-out/
npm run qa:labels -- fr                                   # English labels left untranslated
npm run qa:voice  -- it im_nicola                         # pack coverage, scene lengths, exact cues
```

Look at the frames (make a contact sheet) in both aspects and at least one non-English language — French has the longest strings. Check: text inside cards, mouth/eyes aligned, arms attached, no seams on limbs.

## Lessons from past feedback (don't repeat)

- Never paste a face over the head drawing (a second silhouette showed through) and never "reconstruct" his drawings — trace/use his parts. A reconstructed face was called "spaventoso".
- Arms must look like uniform rubber hoses when bent (no toy-like segments); thumbs must face the body; elbows bend down/outward when holding the magnifier.
- Static = bad: every shot needs overlapping action (body, tail, coat bend; head lag; hat follow-through).
- Pacing was "troppo veloce": keep breaths between sentences and let pop-ups explain.
- The first score was "troppo criptica": music must be catchy.

## Where things stand / roadmap

Done: painted rig, six scenes, Vox-style narration + 17 pop-ups, catchy score, neural studio voice, five languages, export, GitHub repo.

Next (agreed direction, engine choice still open):
1. Free "Cuphead" polish in code: character animated on twos (12 fps) while camera/effects stay at 24–30, line boil on outlines, smear frames/multiples on fast moves, stronger anticipation and squash on key beats. Do it on a branch with before/after frames.
2. Animation engine decision (ask Salvatore): **Rive** (he animates visually; ~$9/month yearly, `.riv` export needs a paid plan) vs **Spine Pro** ($379, text JSON — Claude can generate the skeleton and first animations, he refines) vs staying on the current rig. Pilot on scene 1 only, then extend.
3. New assets from Gemini (prompts: `art/GEMINI_PROMPTS.md`; Salvatore drops results in `art/incoming/` — integrate them through the bake pipeline, check them against the prompt's checklist first) — (Nano Banana 2.1, up to 14 reference images): 3/4 and profile heads, more hands (front/back), layered scene backgrounds, emotion mouths, a few frame-by-frame key moments (8–12 drawings). Same green background, scale and light; one part per cell.
4. Possibly: localise the publishing kit text (it is English only).

A published claude.ai artifact of the app exists (owned by Salvatore); it was updated from the claude.ai session by publishing `dist/` — Claude Code can't publish it, so mention when a new build should be republished.
