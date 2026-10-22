// Renders frames (one per pop-up beat + one every 6 s) with the studio voice timing.
//   node tools/qa/frames.mjs [lang=it] [voice=im_nicola] [aspect=16:9] [outDir]
// Needs `npm run dev` running and Playwright (npm i -D playwright && npx playwright install chromium).
import { chromium } from 'playwright';
import fs from 'node:fs';
const [LANG = 'it', VOICE = 'im_nicola', ASPECT = '16:9', OUT = `qa-out/frames_${LANG}_${ASPECT.replace(':', 'x')}`] = process.argv.slice(2);
const URL = process.env.APP_URL || 'http://localhost:5173/';
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch(); const p = await b.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
await p.goto(URL); await p.waitForTimeout(1200);
const shots = await p.evaluate(async ([LANG, VOICE, ASPECT]) => {
  const { renderFrame } = await import('/src/animation/renderScene.ts');
  const { buildTimeline } = await import('/src/animation/timeline.ts');
  const { createMkultraProject } = await import('/src/data/mkultraProject.ts');
  const { loadStudioPack, studioTiming } = await import('/src/audio/studioVoice.ts');
  const { loadCanvasFonts } = await import('/src/app/fonts.ts');
  const { placeBeats } = await import('/src/effects/beats.ts');
  await loadCanvasFonts();
  const pack = await loadStudioPack(LANG, VOICE);
  const pr = createMkultraProject(LANG); pr.settings.aspect = ASPECT;
  const tl = buildTimeline(pr, undefined, studioTiming(pack, new Map()));
  const [w, h] = ASPECT === '16:9' ? [960, 540] : [540, 960];
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  const times = [];
  tl.spans.forEach((s, i) => placeBeats(tl, i).forEach((bt) => times.push([bt.beat.kind, Math.min(bt.end - 0.3, bt.start + 1.9)])));
  for (let t = 1; t < tl.total; t += 6) times.push(['t', t]);
  return times.map(([kind, t]) => {
    renderFrame(g, w, h, pr, tl, t, { filmGrain: false, subtitles: pr.settings.subtitles, burnSubtitles: true });
    return { name: `${t.toFixed(1).padStart(5, '0')}_${kind}.jpg`, data: c.toDataURL('image/jpeg', 0.8) };
  });
}, [LANG, VOICE, ASPECT]);
for (const s of shots) fs.writeFileSync(`${OUT}/${s.name}`, Buffer.from(s.data.split(',')[1], 'base64'));
console.log(`${shots.length} frames → ${OUT}`, errs.length ? errs : 'no page errors');
await b.close();
