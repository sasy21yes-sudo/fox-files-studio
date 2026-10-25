// The Short's own cut (project.short) of the saved episode: its clips, their length and words, the total.
//   node tools/qa/short_cut.mjs [lang]   (needs the dev server on 5174)
import { chromium } from 'playwright';
const [LANG = 'it'] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage();
await p.goto(process.env.APP_URL || 'http://localhost:5174/');
await p.waitForTimeout(1500);
const r = await p.evaluate(async (LANG) => {
  const { buildShortTimeline } = await import('/src/animation/timeline.ts');
  const { loadStudioPack, studioTiming } = await import('/src/audio/studioVoice.ts');
  const { STUDIO_VOICES } = await import('/src/audio/studioVoices.ts');
  const { switchLanguage } = await import('/src/data/project.ts');
  const saved = await (await fetch(`/episodes/mkultra-secret-experiments.foxproj.json?${Date.now()}`)).json();
  const pr = switchLanguage(saved, LANG);
  const voice = pr.settings.studioVoice?.[LANG] ?? STUDIO_VOICES[LANG][0].id;
  const tl = buildShortTimeline(pr, studioTiming(await loadStudioPack(LANG, voice, undefined, Date.now()), new Map()));
  if (!tl) return null;
  return { total: tl.total, hook: tl.hook?.end ?? 0, spans: tl.spans.map((s) => ({ id: s.scene.id, start: s.start, dur: s.duration, offset: s.offset, text: tl.cues.filter((c) => c.sceneIndex === s.index).map((c) => c.text).join(' ') })) };
}, LANG);
if (!r) console.log('no short cut in this episode');
else {
  console.log(`${LANG} short: ${r.total.toFixed(1)} s (hook ${r.hook.toFixed(1)} s)`);
  for (const s of r.spans) console.log(`  ${s.start.toFixed(1).padStart(5)} +${s.dur.toFixed(1)} ${s.id} @${s.offset.toFixed(1)}: ${s.text}`);
}
await b.close();
