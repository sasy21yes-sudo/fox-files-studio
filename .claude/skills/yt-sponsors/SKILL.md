---
name: yt-sponsors
description: Find evidence-backed sponsors for The Fox Files videos once the channel is ready for collaborations - brands whose public activity shows they sponsor history, documentary or education channels like ours - and draft (never send) a short pitch with a media kit built from the Channel page's real numbers. Adapted from first-customer-finder (MIT). Use when Salvatore asks about sponsors, brand deals, collaborations or monetisation.
---

# YouTube sponsors for The Fox Files

This is `first-customer-finder` (`.claude/skills/first-customer-finder`, MIT) pointed at sponsors instead of first
customers: the "product" is the channel and its audience, a "prospect" is a brand, a "public demand signal" is
public evidence that the brand sponsors channels like ours. Read its `references/research-framework.md` (query
buckets, qualification score, evidence ledger, outreach rules) and `references/report-artifact.md` before you
start; this file only says what changes.

## 0. Gate: is the channel ready for collaborations?
Read `channel/channel.json` -> `collaborations.ready`. It is set in the studio (Channel > Brand kit, "Ready for
sponsors") after a `/yt-audit` pass. If it is false or missing: do NOT research sponsors. Run the readiness check
instead and say what is missing:
- at least 3 published episodes on a steady rhythm (yt-plan: consistency over frequency);
- real numbers, not forecasts: a YouTube Studio retention export per recent video on the Channel page, average
  views and subscribers typed into `collaborations.stats` by Salvatore (never estimate them);
- the house style holds (Channel > Dashboard checks green on recent episodes).
Never present the forecast curve as audience data to a brand.

## 1. The channel brief (instead of the product brief)
From `channel/channel.json` and the Channel page: name, handle, languages (it, en, es, fr, pt), niche (Cold War
and intelligence history, declassified records, 1930s-cartoon explainer), formats (16:9 episode ~3 min, Short
45-60 s), audience numbers from `collaborations.stats` only, the series rule (every fact from the sources).

## 2. Who to look for (query buckets)
- Brands visibly sponsoring history / documentary / explainer / education YouTube channels in the last 12 months
  (the video description or a pinned "sponsored by" with a date: that is the evidence).
- Fit with the content: books and audiobooks, documentary and history streaming, learning platforms, museums and
  archives with paid products, map/print shops, tools for researchers. Note the fit in one line.
- Exclude: anything that conflicts with a documentary about real abuses (no "brain hacking" supplements, no
  surveillance products marketed with spy themes, no gambling or crypto), and brands that would ask to touch the
  facts. Editorial independence is a hard requirement, say it in the pitch.

## 3. Qualify (first-customer-finder's score, re-read)
Evidence of past sponsorships of similar channels (date, link) > audience overlap > budget signals (repeat
sponsorships, affiliate programs with public terms) > a findable official partnerships contact (URL, date checked,
or `not_found` - never guess an email). Keep 5-10, ranked.

## 4. Pitch drafts, never sent
Under 90 words each, the outreach shape of the framework: the public context (their sponsorship of X on date),
why our audience fits in their words, the concrete offer (a 30-45 s read inside the episode, a pinned link, the
disclosure YouTube requires), one low-friction question. Attach the media kit numbers only from
`collaborations.stats` and real retention imports. Mark every draft "not sent".

## 5. Report and history
Use the framework's report flow with the bundled helper:
`python .claude/skills/first-customer-finder/scripts/generate_report.py report.json channel/sponsors/report.md --csv channel/sponsors/report.csv --state channel/sponsors/history.json`
(`--new-only` on a repeat search). Post the shortlist as one line per brand to the team chat
(`node tools/team/chat.mjs post social "..." --kind note`) so it shows on the Team page.

## Rules
Facts about the channel only from the Channel page and channel.json; facts about brands only from pages you
opened, with the date. Paid promotions are disclosed (YouTube's paid-promotion box and a spoken line). Nothing is
sent, posted or agreed by an agent: Salvatore decides.
