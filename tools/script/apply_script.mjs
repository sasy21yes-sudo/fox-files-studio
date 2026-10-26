#!/usr/bin/env node
/**
 * Writes a narration script (tools/script/script_v2.json: per scene, narrations + pop-ups in five languages)
 * into an episode file, adds the scenes it defines (SCENES below), puts them in the script's order and renumbers.
 * The studio notices the changed file and reloads it (tools/vite/episodeSync.ts).
 *
 *   node tools/script/apply_script.mjs [episodes/<id>.foxproj.json] [tools/script/script_v2.json]
 */
import fs from 'node:fs';

const file = process.argv[2] ?? 'episodes/mkultra-secret-experiments.foxproj.json';
const script = JSON.parse(fs.readFileSync(process.argv[3] ?? 'tools/script/script_v2.json', 'utf8'));
const p = JSON.parse(fs.readFileSync(file, 'utf8'));
const LANGS = ['en', 'it', 'es', 'fr', 'pt'];
const lang = p.settings?.language ?? 'en';

/** Scenes the script adds, with their media (the image files are in episodes/media). */
const MEDIA = [
  { id: 'img-hosp57ext', width: 1280, height: 720, name: 'allan memorial at night', source: 'generated', style: 'sketch', seed: 1762573132,
    prompt: 'A 1950s psychiatric hospital at night seen from the street, a grand old grey stone mansion on a hillside with tall lit windows, bare trees, a lone street lamp, cold mist, somber mood, no people' },
  { id: 'img-hosp57room', width: 1280, height: 720, name: 'hospital room, tape recorder', source: 'generated', style: 'sketch', seed: 2007691018,
    prompt: 'A small 1950s hospital room at night, an empty iron bed with white sheets, a 1950s reel-to-reel tape recorder with two big reels on a bedside table, a cable running to a pair of headphones on the pillow, a single bare bulb, dark walls, long cold shadows, somber mood, no people' },
];
const AGAIN = (id, at, x, y, size) => ({ id, type: 'text', x, y, from: at, to: 17.6, params: { text: 'AGAIN.', size, font: 'type', animator: 'pop', stagger: 0.04 } });
const SCENES = {
  'scene-hosp57': {
    id: 'scene-hosp57',
    title: "L'ospedale",
    summary: "Painted cutaways: the Allan Memorial Institute at night, then a hospital room with a tape recorder. Cameron's identikit, the 1957 drug list, the memo's own words, Canada's 1992 payments.",
    duration: 55,
    authoredDuration: 55,
    transition: 'fade',
    keywords: ['Ewen Cameron', 'McGill', 'psychic driving', 'Allan Memorial Institute', 'LSD', 'curaro', 'curare', '1992'],
    sourceIds: ['cia-sp68-1957', 'canada-ami-1992'],
    spec: {
      version: 1,
      sepia: 1,
      gloom: 0.2,
      elements: [
        { id: 'pic-ext', type: 'picture', x: 0.5, y: 0.5, to: 10.6, params: { media: 'img-hosp57ext', fit: 'cover', w: 1, zoomFrom: 1.04, zoomTo: 1.2, panX: 0.04, panY: -0.02 }, fx: [{ type: 'opacityFlicker', amount: 0.05, freq: 8 }] },
        { id: 't-city', type: 'text', x: 0.5, y: { h: 0.17, v: 0.24 }, from: 0.4, to: 4.6, params: { text: 'MONTRÉAL · 1957', size: { h: 66, v: 54 }, font: 'type', animator: 'typewriter', stagger: 0.07 } },
        { id: 'pic-room', type: 'picture', x: 0.5, y: 0.5, from: 10, enter: { kind: 'fade', at: 10, dur: 0.5 }, params: { media: 'img-hosp57room', fit: 'cover', w: 1, zoomFrom: 1.3, zoomTo: 1.48, panX: 0.05, panY: 0.01 },
          fx: [{ type: 'color', saturation: 0.8, brightness: [{ at: 0, value: 1 }, { at: 26.5, value: 0.66, dur: 1.6, ease: 'smooth' }, { at: 44, value: 0.9, dur: 1.2, ease: 'smooth' }] }, { type: 'opacityFlicker', amount: 0.05, freq: 8 }] },
        AGAIN('t-again1', 13.4, 0.3, { h: 0.24, v: 0.27 }, { h: 54, v: 44 }),
        AGAIN('t-again2', 14.4, 0.62, { h: 0.36, v: 0.36 }, { h: 68, v: 54 }),
        AGAIN('t-again3', 15.4, 0.42, { h: 0.5, v: 0.45 }, { h: 86, v: 66 }),
        { id: 'stamp-driving', type: 'stamp', x: 0.5, y: { h: 0.45, v: 0.42 }, from: 20.2, to: 23.4, blend: 'multiply', params: { text: 'PSYCHIC DRIVING', size: { h: 84, v: 56 }, at: 20.3 } },
        { id: 't-ami', type: 'text', x: 0.5, y: { h: 0.15, v: 0.22 }, from: 45.2, params: { text: 'ALLAN MEMORIAL INSTITUTE', size: { h: 46, v: 34 }, font: 'type', animator: 'typewriter', stagger: 0.04 } },
      ],
      camera: [
        { at: 0, kind: 'wide' },
        { at: 2.2, kind: 'medium', target: 'pic-ext', enter: 'push' },
        { at: 10, kind: 'wide', enter: 'whip' },
        { at: 12.6, kind: 'medium', target: 'pic-room', enter: 'push' },
        { at: 26.5, kind: 'wide' },
        { at: 35.5, kind: 'medium', target: 'pic-room', enter: 'push' },
        { at: 44.6, kind: 'wide' },
      ],
      sfx: [
        { at: 0.4, sound: 'typeKey', count: 12, every: 0.1, gain: 0.5 },
        { at: 5.6, sound: 'drum' },
        { at: 10, sound: 'whoosh' },
        { at: 13.4, sound: 'tick', gain: 0.7 },
        { at: 14.4, sound: 'tick', gain: 0.8 },
        { at: 15.4, sound: 'tick', gain: 0.9 },
        { at: 20.3, sound: 'stamp' },
        { at: 45.2, sound: 'typeKey', count: 14, every: 0.08, gain: 0.45 },
      ],
    },
  },
};

const byId = new Map(p.scenes.map((s) => [s.id, s]));
for (const [id, def] of Object.entries(SCENES)) if (!byId.has(id)) byId.set(id, { ...def });
for (const m of MEDIA) if (!(p.media ?? []).some((x) => x.id === m.id)) (p.media ??= []).push({ ...m, created: Date.now() });

for (const [id, entry] of Object.entries(script.scenes)) {
  const s = byId.get(id);
  if (!s) throw new Error(`scene ${id} is not in the episode`);
  s.narrations = Object.fromEntries(LANGS.map((l) => [l, entry.narrations[l]]));
  s.narration = entry.narrations[lang];
  const beats = (l) => entry.beats[l] ?? entry.beats['*'] ?? [];
  s.beatsByLang = Object.fromEntries(LANGS.map((l) => [l, beats(l)]));
  s.beats = beats(lang);
  if (entry.titles) {
    s.titles = entry.titles;
    s.title = entry.titles[lang] ?? s.title;
  }
  // Every pop-up cue must be in its narration (else the pop-up never shows).
  for (const l of LANGS) for (const b of beats(l)) if (!entry.narrations[l].includes(b.cue)) throw new Error(`${id} ${l}: cue "${b.cue}" not in the narration`);
}
p.scenes = script.order.map((id, i) => ({ ...byId.get(id), number: i + 1 }));
p.updated = Date.now();
fs.writeFileSync(file, JSON.stringify(p, null, 2) + '\n');
console.log(`${file}: ${p.scenes.length} scenes, language ${lang}`);
