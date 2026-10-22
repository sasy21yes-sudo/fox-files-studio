// A/B check for a scene ported to data: renders the hand-coded scene and its
// SceneSpec at the same times and reports the pixel difference.
//   node tools/qa/spec_ab.mjs [sceneId=file] [step=0.1] [outDir]
// Needs the dev server (APP_URL, default http://localhost:5173/) and Playwright.
import { chromium } from 'playwright';
import fs from 'node:fs';
const [SCENE = 'file', STEP = '0.1', OUT = `qa-out/spec_ab_${SCENE}`] = process.argv.slice(2);
const URL = process.env.APP_URL || 'http://localhost:5173/';
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
await p.goto(URL);
await p.waitForTimeout(1000);
const res = await p.evaluate(async ([SCENE, STEP, AA]) => {
  const { renderFrame } = await import('/src/animation/renderScene.ts');
  const { buildTimeline } = await import('/src/animation/timeline.ts');
  const { createMkultraProject } = await import('/src/data/mkultraProject.ts');
  const { loadCanvasFonts } = await import('/src/app/fonts.ts');
  const { SPECS } = await import('/src/data/specs/index.ts');
  await loadCanvasFonts();
  const out = [];
  for (const aspect of ['16:9', '9:16']) {
    const coded = createMkultraProject('en');
    coded.settings.aspect = aspect;
    coded.settings.shortHook = false;
    coded.settings.chapterCards = false;
    coded.scenes.forEach((s) => delete s.spec);
    const data = structuredClone(coded);
    const si = data.scenes.findIndex((s) => s.id === SCENE);
    if (!AA) data.scenes[si].spec = SPECS[SCENE];
    const tlA = buildTimeline(coded);
    const tlB = buildTimeline(data);
    const span = tlA.spans[si];
    const [w, h] = aspect === '16:9' ? [960, 540] : [540, 960];
    const mk = () => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    };
    const ca = mk();
    const cb = mk();
    const ga = ca.getContext('2d', { willReadFrequently: true });
    const gb = cb.getContext('2d', { willReadFrequently: true });
    const opts = { filmGrain: false, subtitles: coded.settings.subtitles, burnSubtitles: false };
    for (let t = span.start + 0.05; t < span.end - 0.05; t += +STEP) {
      renderFrame(ga, w, h, coded, tlA, t, opts);
      renderFrame(gb, w, h, data, tlB, t, opts);
      const A = ga.getImageData(0, 0, w, h).data;
      const B = gb.getImageData(0, 0, w, h).data;
      let max = 0;
      let diff = 0;
      for (let i = 0; i < A.length; i += 4) {
        const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]));
        if (d > max) max = d;
        if (d > 8) diff++;
      }
      const pct = (100 * diff) / (w * h);
      const rec = { aspect, t: +t.toFixed(2), max, pct: +pct.toFixed(3) };
      if (pct > 0.05) {
        const both = document.createElement('canvas');
        both.width = w * 2;
        both.height = h;
        const g2 = both.getContext('2d');
        g2.drawImage(ca, 0, 0);
        g2.drawImage(cb, w, 0);
        rec.img = both.toDataURL('image/jpeg', 0.8);
      }
      out.push(rec);
    }
  }
  return out;
}, [SCENE, STEP, !!process.env.AA]);
let bad = 0;
for (const r of res) {
  if (r.img) {
    bad++;
    fs.writeFileSync(`${OUT}/${r.aspect.replace(':', 'x')}_${r.t.toFixed(2)}.jpg`, Buffer.from(r.img.split(',')[1], 'base64'));
  }
}
const worst = [...res].sort((a, b) => b.pct - a.pct).slice(0, 5).map(({ aspect, t, max, pct }) => `${aspect} t=${t} max=${max} diff=${pct}%`);
console.log(`${res.length} frames compared, ${bad} differ (>0.05% px) — worst:`, worst, errs.length ? errs : 'no page errors');
await b.close();
