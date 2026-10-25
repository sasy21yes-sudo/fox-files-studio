---
name: review-episode
description: Multi-agent review of a Fox Files episode - builds one review kit (frames, contact sheets, audio mix and stems, timeline), briefs the review team in the team chat, runs only the agents the change needs (rig animation, first-time viewer, social media manager, video editor, sound designer, fact-checker, art director, localization/accessibility) and merges their chat findings into one prioritised fix list. Use when Salvatore asks to review, check or "guardare tutto" before publishing, or after a big change.
---

# Review an episode with the team

You are the producer. The specialists are the agents in `.claude/agents/`. They talk in the team chat
(`tools/team/chat.mjs`, shown live on the studio's Team page); you brief them there, merge, and fix only what
Salvatore approves (on a branch, CLAUDE.md rules).

## Budget first (Salvatore, 2026-10-25: tokens are the scarce resource)
A full round of eight agents cost ~230-250k tokens EACH on Opus. Rules:
- Run only the agents the question needs. A first review of a new episode: all eight. A re-check after fixes:
  only the agents whose areas changed, checking only their open items.
- Agents run on Sonnet except the rig inspector (Opus, fine visual detail); their files set it.
- Prompts to agents stay short (the agent file has the method): "Follow `.claude/agents/<name>.md`. Kit: <path>.
  Your chat name: <name>." Everything else goes in the chat brief, written once for all.
- You read the chat (`read --last 200`, one line a finding), not the reports; open a report only for a finding
  you need the detail of. Look at two contact sheets at most yourself.

## 1. Material (one kit everyone shares)
1. The dev server must answer on http://localhost:5174 (`npx vite --port 5174 --strictPort` in the background if not).
2. `node tools/qa/review_kit.mjs [lang] [aspect]` (e.g. `it 9:16`): `qa-out/review/<lang>_<aspect>/` with
   `frames/`, `sheets/`, `mix.wav`, `narration.wav`, `music.wav`, `timeline.json`. Create `<kit>/reports/`.

## 2. Brief in the chat (once, for everyone)
`node tools/team/chat.mjs post producer "<brief>" --kind note`, then one message per agent you run
(`--to <name>`) with its open items from the last round (ids of their findings) and the focus Salvatore asked for.
The brief says: kit path, episode, language/aspect, what changed since the last round (one line per commit or
area; `git log --oneline` since the last review), and the times that moved.

## 3. The team, in parallel (one message, one Agent call each)
Chat names and report files in `<kit>/reports/`:
- `rig-animation-inspector` = `rig` → rig.md
- `first-time-viewer` = `viewer` → viewer.md
- `social-media-manager` = `social` → social.md
- `video-editor` = `editor` → editor.md
- `sound-designer` = `sound` → sound.md
- `fact-checker` = `facts` → facts.md
- `art-director` = `art` → art.md
- `localization-qa` = `l10n` → localization.md (builds its own kits for other languages - slowest, start it first)
If the agent types are not available in this session (Claude Code started outside this repo), run each as a
general-purpose agent with the same short prompt, model `sonnet` (rig: `opus`).

## 4. Merge (the collaboration)
`node tools/team/chat.mjs read --last 200`. Write `<kit>/reports/REPORT.md` in Italian:
1. Verdetto: from the social media manager, adjusted by any B (blocker) from the others (a fact NON SUPPORTATO or
   a broken frame blocks publishing regardless of retention).
2. Fix list, one line each, deduplicated (the same moment flagged by several agents = one item, list who saw it -
   agreement raises priority), ordered B, I, R; each with time/scene, area and the concrete change.
3. Conflicts: where agents disagree, both sides with their evidence and your recommendation.
4. "Da verificare a occhio/orecchio": what no agent could measure (voice timbre, emotion, motion between frames).
Answer Salvatore with the verdict and the top fixes, link REPORT.md, ask which to apply. Messages Salvatore wrote
in the chat (`from salvatore`) are his instructions: read them first.

## 5. Fix and re-check
Apply only the approved fixes. For each one post `--kind fix --reply <finding id>` (the Team page marks the
finding fixed). Rebuild the kit and re-run only the agents whose areas changed, asking them to confirm their
open items (at most two rounds). Report what is fixed, what is not, and what still needs a human.
