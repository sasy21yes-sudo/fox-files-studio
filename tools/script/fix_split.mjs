// One-off (2026-10-26): "Ask Claude" split the hospital scene into five in Italian only. Spread every language's
// narration over the five scenes by sentence (the script is sentence-parallel), with its pop-ups and sources.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const r = await build({ stdin: { contents: "export { splitSentences } from './src/animation/timeline';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error' });
const tmp = path.resolve('voice', `.split-${process.pid}.mjs`);
fs.writeFileSync(tmp, r.outputFiles[0].text);
const { splitSentences } = await import(pathToFileURL(tmp).href);
fs.rmSync(tmp);
const file = 'episodes/mkultra-secret-experiments.foxproj.json';
const p = JSON.parse(fs.readFileSync(file, 'utf8'));
const script = JSON.parse(fs.readFileSync('tools/script/script_v2.json', 'utf8')).scenes['scene-hosp57'];
const ids = ['scene-hosp57', 'scene-uoamuo', 'scene-7xto4r', 'scene-i74qf6', 'scene-m5zx59'];
const scenes = ids.map((id) => p.scenes.find((s) => s.id === id));
// The Italian split decides the groups.
const counts = scenes.map((s) => splitSentences(s.narration).length);
const BEAT_SCENE = { person: 0, list: 2, record: 3, statement: 4 };
for (const lang of ['en', 'es', 'fr', 'pt']) {
  const all = splitSentences(script.narrations[lang]);
  if (all.length !== counts.reduce((a, b) => a + b)) throw new Error(`${lang}: ${all.length} sentences, Italian has ${counts.join('+')}`);
  let i = 0;
  scenes.forEach((s, k) => {
    s.narrations = { ...s.narrations, [lang]: all.slice(i, i + counts[k]).join(' ') };
    i += counts[k];
    s.beatsByLang = { ...s.beatsByLang, [lang]: script.beats[lang].filter((b) => BEAT_SCENE[b.kind] === k) };
    for (const b of s.beatsByLang[lang]) if (!s.narrations[lang].includes(b.cue)) throw new Error(`${lang} ${s.id}: cue "${b.cue}"`);
  });
}
scenes.forEach((s, k) => {
  s.narrations.it = s.narration;
  s.beatsByLang.it = s.beats ?? [];
  s.sourceIds = k === 4 ? ['canada-ami-1992'] : ['cia-sp68-1957'];
  s.keywords = s.keywords?.length ? s.keywords : ['Ewen Cameron', 'psychic driving', 'McGill', 'Allan Memorial Institute', 'LSD', 'curaro', 'curare'];
  if (!s.titles) s.titles = {};
});
const T = { 'scene-uoamuo': { en: 'Again and Again', es: 'Otra vez y otra', fr: 'Encore et encore', pt: 'De novo e de novo' }, 'scene-7xto4r': { en: 'The List', es: 'La lista', fr: 'La liste', pt: 'A lista' }, 'scene-i74qf6': { en: 'The Cover', es: 'La tapadera', fr: 'La couverture', pt: 'A fachada' }, 'scene-m5zx59': { en: 'The Compensation', es: 'La indemnización', fr: "L'indemnisation", pt: 'A indenização' } };
for (const s of scenes) if (T[s.id]) s.titles = { it: s.title, ...T[s.id] };
p.updated = Date.now();
fs.writeFileSync(file, JSON.stringify(p, null, 2) + '\n');
console.log('counts', counts.join('+'), 'ok');
