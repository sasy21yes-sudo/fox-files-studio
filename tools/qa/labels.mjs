// Lists English on-screen labels that are drawn untranslated in a language.
//   node tools/qa/labels.mjs [lang=it]      (needs `npm run dev`)
// Add any real leftovers to src/i18n/labelStrings.ts.
import { chromium } from 'playwright';
const LANG = process.argv[2] || 'it';
const URL = process.env.APP_URL || 'http://localhost:5173/';
const b = await chromium.launch(); const p = await b.newPage();
await p.goto(URL); await p.waitForTimeout(1200);
const drawn = async (lang) => p.evaluate(async (lang) => {
  const { renderFrame } = await import('/src/animation/renderScene.ts');
  const { buildTimeline } = await import('/src/animation/timeline.ts');
  const { createMkultraProject } = await import('/src/data/mkultraProject.ts');
  const set = (globalThis.__foxUntranslated ??= new Set()); set.clear();
  globalThis.__foxCollect = true;
  for (const aspect of ['16:9', '9:16']) {
    const pr = createMkultraProject(lang); pr.settings.aspect = aspect;
    const tl = buildTimeline(pr);
    const c = document.createElement('canvas'); [c.width, c.height] = aspect === '16:9' ? [480, 270] : [270, 480];
    const g = c.getContext('2d');
    for (let t = 0; t < tl.total; t += 0.25) renderFrame(g, c.width, c.height, pr, tl, t, { filmGrain: false, subtitles: pr.settings.subtitles, burnSubtitles: true });
  }
  globalThis.__foxCollect = false;
  return [...set];
}, lang);
const en = new Set(await drawn('en'));
const left = (await drawn(LANG)).filter((s) => en.has(s) && /\p{L}{3}/u.test(s));
const full = left.filter((s) => !left.some((o) => o !== s && o.startsWith(s))).sort();
console.log(`${full.length} strings drawn identically to English in "${LANG}" (names, years and words shared by both languages are expected):`);
for (const s of full) console.log('  ' + s);
await b.close();
