// Per scene: duration, first and last voice cue (scene-local s) and tail, with the studio voice.
//   node tools/qa/scene_voice.mjs <lang> <aspect>   (needs the dev server on 5174)
import { chromium } from 'playwright';
const [LANG = 'it', ASPECT = '9:16'] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage();
p.setDefaultTimeout(300000);
await p.goto('http://localhost:5174/');
await p.waitForTimeout(2000);
const r = await p.evaluate(async ([LANG, ASPECT]) => {
  const { buildTimeline } = await import('/src/animation/timeline.ts');
  const { loadStudioPack, studioTiming } = await import('/src/audio/studioVoice.ts');
  const { STUDIO_VOICES } = await import('/src/audio/studioVoices.ts');
  const { switchLanguage } = await import('/src/data/project.ts');
  const saved = await (await fetch(`/episodes/mkultra-secret-experiments.foxproj.json?${Date.now()}`)).json();
  const pr = switchLanguage(saved, LANG);
  pr.settings.aspect = ASPECT;
  const voice = pr.settings.studioVoice?.[LANG] ?? STUDIO_VOICES[LANG][0].id;
  const pack = await loadStudioPack(LANG, voice, undefined, Date.now());
  const tl = buildTimeline(pr, undefined, studioTiming(pack, new Map()));
  const out = tl.spans.map((s) => {
    const cues = tl.cues.filter((c) => c.start >= s.start - 0.01 && c.start < s.end);
    return { id: s.scene.id, set: s.scene.duration, len: +(s.end - s.start).toFixed(2), first: +((cues[0]?.start ?? s.start) - s.start).toFixed(2), last: +((cues.at(-1)?.end ?? s.start) - s.start).toFixed(2) };
  });
  return { voice, total: tl.total, hook: tl.hook?.end, out };
}, [LANG, ASPECT]);
console.log(LANG, ASPECT, r.voice, 'total', r.total.toFixed(1), 'hook', r.hook);
for (const s of r.out) console.log(`  ${s.id.padEnd(12)} set ${s.set}  len ${s.len}  voice ${s.first}..${s.last}  tail ${(s.len - s.last).toFixed(2)}`);
await b.close();
