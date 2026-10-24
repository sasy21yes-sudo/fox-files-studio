---
name: review-episode
description: Full multi-agent review of a Fox Files episode - builds one review kit (frames, contact sheets, audio mix and stems, timeline) and has the review team look at it in parallel (rig animation, first-time viewer, social media manager, video editor, sound designer, fact-checker, art director, localization/accessibility), then merges their reports into one prioritised fix list. Use when Salvatore asks to review, check or "guardare tutto" before publishing, or after a big change.
---

# Review an episode with the team

You are the producer. The specialists are the agents in `.claude/agents/`. They only read and write their own
report; you merge, decide what to propose, and fix only what Salvatore approves (on a branch, CLAUDE.md rules).

## 1. Material (one kit everyone shares)
1. The dev server must answer on http://localhost:5174 (`npx vite --port 5174 --strictPort` in the background if not).
2. `node tools/qa/review_kit.mjs [lang] [aspect]` (defaults: the episode's own; e.g. `it 9:16`). It prints the kit
   folder, `qa-out/review/<lang>_<aspect>/`: `frames/`, `sheets/`, `mix.wav`, `narration.wav`, `music.wav`,
   `timeline.json`. Create `<kit>/reports/`.
3. Look at two contact sheets yourself so you know what the team is talking about.

## 2. The team, in parallel (one message, one Agent call each)
Give every agent the kit path, the episode (`episodes/<id>.foxproj.json`), the language/aspect, and any focus
Salvatore asked for. Agents and their report file in `<kit>/reports/`:
- `rig-animation-inspector` → rig.md
- `first-time-viewer` → viewer.md
- `social-media-manager` → social.md
- `video-editor` → editor.md
- `sound-designer` → sound.md (earshot via `tools/earshot.sh`, Whisper for intelligibility)
- `fact-checker` → facts.md
- `art-director` → art.md
- `localization-qa` → localization.md (builds its own kits for other languages - slowest, start it first)
If the agent types are not available in this session (Claude Code was started outside this repo), run each as a
general-purpose agent whose prompt says: "Follow `.claude/agents/<name>.md` in
C:/Users/Admin/Desktop/Sasy/fox-files-studio-editor exactly" plus the same inputs.

## 3. Merge (the collaboration)
Read every report. Then write `<kit>/reports/REPORT.md` in Italian:
1. Verdetto: from the social media manager, adjusted by any BLOCCANTE from the others (a fact NON SUPPORTATO or a
   broken frame blocks publishing regardless of retention).
2. Fix list, one line each, deduplicated (the same moment flagged by several agents = one item, list who saw it -
   agreement raises priority), ordered: BLOCCANTE, then by impact on the viewer; each with time/scene, owner area
   (rig, edit, sound, script, art, localisation) and the concrete change.
3. Conflicts: where agents disagree (e.g. viewer "too fast" vs social "too slow"), state both with their evidence
   and your recommendation - do not hide disagreements.
4. "Da verificare a occhio/orecchio": what no agent could measure (voice timbre, emotion, motion between frames).
Answer Salvatore with the verdict and the top fixes, link REPORT.md, ask which to apply.

## 4. Fix and re-check
Apply only the approved fixes, on a branch, the way CLAUDE.md says (render and look after visual changes; script
changes keep to the sources). Rebuild the kit and re-run only the agents whose areas changed, asking them to
confirm each fixed item (at most two rounds). Report what is fixed, what is not, and what still needs a human.
