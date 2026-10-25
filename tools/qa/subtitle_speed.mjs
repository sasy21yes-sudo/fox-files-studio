// Subtitle reading speed per language (9:16, studio voice): cues over 17 chars/s, the fastest, cues under 1.1 s.
//   node tools/qa/subtitle_speed.mjs it fr es   (needs the dev server on 5174)
import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage(); p.setDefaultTimeout(300000);
await p.goto('http://localhost:5174/'); await p.waitForTimeout(2000);
for (const LANG of process.argv.slice(2)) {
  const r = await p.evaluate(async (LANG) => {
    const { buildTimeline } = await import('/src/animation/timeline.ts');
    const { loadStudioPack, studioTiming } = await import('/src/audio/studioVoice.ts');
    const { STUDIO_VOICES } = await import('/src/audio/studioVoices.ts');
    const { switchLanguage } = await import('/src/data/project.ts');
    const saved = await (await fetch(`/episodes/mkultra-secret-experiments.foxproj.json?${Date.now()}`)).json();
    const pr = switchLanguage(saved, LANG); pr.settings.aspect = '9:16';
    const voice = pr.settings.studioVoice?.[LANG] ?? STUDIO_VOICES[LANG][0].id;
    const tl = buildTimeline(pr, undefined, studioTiming(await loadStudioPack(LANG, voice, undefined, Date.now()), new Map()));
    const c = tl.cues.map((q) => ({ t: q.start, d: q.end - q.start, n: q.text.length, cps: q.text.length / (q.end - q.start), text: q.text }));
    return { n: c.length, over: c.filter((q) => q.cps > 17).length, max: Math.max(...c.map((q) => q.cps)), short: c.filter((q) => q.d < 1.1).length, maxChars: Math.max(...c.map((q) => q.n)), worst: c.sort((a, b) => b.cps - a.cps).slice(0, 3).map((q) => `${q.cps.toFixed(1)} "${q.text}"`) };
  }, LANG);
  console.log(LANG, `${r.over}/${r.n} cues > 17 cps, max ${r.max.toFixed(1)}, <1.1 s: ${r.short}, max chars ${r.maxChars}`, '\n   ', r.worst.join('\n    '));
}
await b.close();
