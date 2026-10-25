// Which sentences of the saved episode (hook + every scene, every language) the studio voice packs lack.
//   node tools/qa/voice_coverage.mjs [langs]   (needs the dev server on 5174)
import { chromium } from 'playwright';
const langs = (process.argv[2] ?? 'it,en,es,fr,pt').split(',');
const b = await chromium.launch();
const p = await b.newPage();
await p.goto(process.env.APP_URL || 'http://localhost:5174/');
await p.waitForTimeout(1500);
const r = await p.evaluate(async (langs) => {
  const { splitSentences } = await import('/src/animation/timeline.ts');
  const { loadStudioPack, studioTiming } = await import('/src/audio/studioVoice.ts');
  const { STUDIO_VOICES } = await import('/src/audio/studioVoices.ts');
  const { restoreProject, switchLanguage } = await import('/src/data/project.ts');
  const { projectHook } = await import('/src/data/projectText.ts');
  const saved = await (await fetch(`/episodes/mkultra-secret-experiments.foxproj.json?${Date.now()}`)).json();
  const out = [];
  for (const lang of langs) {
    const pr = switchLanguage(restoreProject(saved) ?? saved, lang);
    const voice = pr.settings.studioVoice?.[lang] ?? STUDIO_VOICES[lang][0].id;
    const timing = studioTiming(await loadStudioPack(lang, voice, undefined, Date.now()), new Map());
    const all = [...splitSentences(projectHook(pr, lang)?.text ?? ''), ...pr.scenes.flatMap((s) => splitSentences(s.narration))];
    const miss = all.filter((s) => !timing.sentence(s));
    out.push(`${lang} ${voice}: ${all.length} sentences, ${miss.length} missing${miss.length ? ': ' + miss.slice(0, 4).join(' | ') : ''}`);
  }
  return out;
}, langs);
console.log(r.join('\n'));
await b.close();
