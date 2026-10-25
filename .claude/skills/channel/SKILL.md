---
name: channel
description: Keep The Fox Files YouTube channel consistent and ready - brand kit (channel/channel.json, banner, icon), per-episode packaging (title, thumbnail words, hook, description, chapters, Short), the Channel page's dashboard and forecast, YouTube Studio retention imports, and the youtube-agent skills (yt-*). Use when Salvatore asks about the channel, publishing, titles, thumbnails, analytics, growth or "armonizzare il canale".
---

# The channel

Everything lives in the studio's **Channel** page (`src/editor/ChannelPage.tsx`): Dashboard, Brand kit, YouTube
preview. Data: `channel/channel.json` (name, handle, tagline/description/thumbnail words per language, keywords),
`channel/analytics/<episode>-<long|short>.csv` (YouTube Studio retention exports). Server: `tools/vite/channel.ts`.

## Budget (tokens are scarce)
Read numbers, not pictures: the dashboard's table and checks are computed by the studio; open a screenshot only
to judge the look. Run the yt-* scripts (stdlib Python, fast) instead of reasoning about titles from scratch.

## Before an episode is published
1. Dashboard checks all green (hook <= 6 s, >= 3 chapters, title <= 60 chars, Short 30-60 s with end card,
   fast subtitles < 35%, thumbnail words <= 3 and not in the title).
2. Title + thumbnail pairing: `python .claude/skills/yt-package/title.py --title "..." --thumb "..."` on the
   three options in `src/export/publishingKitText.ts`; hook: `python .claude/skills/yt-script/hookscore.py
   --hook "..."` (English word lists: score the English version).
3. Description = publishing kit (Deliver page) + the channel description; every source with its link.
4. Short: its own cut (Short panel), `yt-shorts` for the hook line, the "full episode" end card on.
5. Same art everywhere: banner and icon from the Brand kit (drawn from the rig), thumbnails = a strong card +
   2-3 words in the series font. Never a face that is not Agent Fox or a portrait from a public-domain photo.

## After publishing
Import the retention CSV for the 16:9 video and the Short on the Dashboard; `retention.py` (yt-retention)
names the cliffs with what was said there. Turn each cliff into one concrete edit and post it to the team chat
(`node tools/team/chat.mjs post producer "..." --kind finding --at <s>`).

## The youtube-agent skills (MIT, reviewed, `.claude/skills/yt-*`)
yt-script (hooks), yt-package (title/thumbnail), yt-edit (dead air), yt-retention, yt-shorts, yt-chapters,
yt-seo, yt-comment, yt-plan (upload rhythm: consistency over frequency), yt-audit (whole channel), yt-viral.
Facts in anything they produce still come only from `src/data/sources.ts`.
