// Checks a studio voice pack against the script: missing sentences, scene lengths, exact cues.
//   node tools/qa/voice.mjs [lang=it] [voice=im_nicola]      (needs `npm run dev`)
import { chromium } from 'playwright';
const [LANG = 'it', VOICE = 'im_nicola'] = process.argv.slice(2);
const URL = process.env.APP_URL || 'http://localhost:5173/';
const b = await chromium.launch(); const p = await b.newPage();
await p.goto(URL); await p.waitForTimeout(1200);
const r = await p.evaluate(async ([LANG, VOICE]) => {
  const { buildTimeline, splitSentences } = await import('/src/animation/timeline.ts');
  const { createMkultraProject } = await import('/src/data/mkultraProject.ts');
  const { loadStudioPack, studioTiming } = await import('/src/audio/studioVoice.ts');
  const pack = await loadStudioPack(LANG, VOICE);
  const out = {};
  for (const aspect of ['16:9', '9:16']) {
    const pr = createMkultraProject(LANG); pr.settings.aspect = aspect;
    const timing = studioTiming(pack, new Map());
    const tl = buildTimeline(pr, undefined, timing);
    out[aspect] = {
      total: +tl.total.toFixed(1),
      missing: pr.scenes.flatMap((s) => splitSentences(s.narration)).filter((x) => !timing.clip(x)),
      scenes: tl.spans.map((s) => `${s.scene.id}: ${s.duration.toFixed(1)}s (voice ${s.estimatedSpeech.toFixed(1)}s${s.extended ? ', extended' : ''})`),
      exactCues: `${tl.cues.filter((c) => c.timing === 'exact').length}/${tl.cues.length}`,
    };
  }
  return out;
}, [LANG, VOICE]);
console.log(JSON.stringify(r, null, 1));
await b.close();
