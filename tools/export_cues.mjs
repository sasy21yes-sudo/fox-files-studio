// Writes voice/cues.json: every narration sentence of every language, split
// exactly as the app splits them (with the subtitle parts of long sentences), plus the voice catalogue. tools/render_voice.py reads it.
//   node tools/export_cues.mjs [out.json] [project.json]
// With a saved project JSON (Export → "Cue list for the voice tool") the
// edited narration of that project's language is used instead of the script.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ?? path.join(root, 'voice', 'cues.json');
const projectFile = process.argv[3];

const entry = `
import { SCRIPTS, spokenText } from './src/i18n/scripts';
import { splitSentences, splitSentence } from './src/animation/timeline';
import { STUDIO_VOICES } from './src/audio/studioVoices';
export function collect(project) {
  const langs = {};
  for (const [lang, script] of Object.entries(SCRIPTS)) {
    const texts = [...splitSentences(script.hook.text)];
    const edited = project && (project.settings?.language ?? 'en') === lang ? project.scenes : null;
    for (const [id, scene] of Object.entries(script.scenes)) {
      const narration = edited?.find((s) => s.id === id)?.narration ?? scene.narration;
      texts.push(...splitSentences(narration));
    }
    const uniq = [...new Set(texts)];
    langs[lang] = { voices: STUDIO_VOICES[lang], sentences: uniq.map((text) => ({ text, say: spokenText(text, lang), parts: splitSentence(text).map((p) => spokenText(p, lang)) })) };
  }
  return { version: 1, languages: langs };
}`;
const res = await build({
  stdin: { contents: entry, resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error',
});
const tmp = path.join(root, 'voice', `.cues-${process.pid}.mjs`);
fs.mkdirSync(path.dirname(tmp), { recursive: true });
fs.writeFileSync(tmp, res.outputFiles[0].text);
try {
  const { collect } = await import(tmp);
  const project = projectFile ? JSON.parse(fs.readFileSync(projectFile, 'utf8')) : null;
  const data = collect(project);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data, null, 1));
  const n = Object.values(data.languages).reduce((a, l) => a + l.sentences.length, 0);
  console.log(`wrote ${out}: ${n} sentences in ${Object.keys(data.languages).length} languages`);
} finally {
  fs.rmSync(tmp, { force: true });
}
