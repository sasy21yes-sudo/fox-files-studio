// Frames of the episode at given times, side by side in one image (quick visual check while fixing a shot).
//   node tools/qa/frames_at.mjs out.jpg <lang> <aspect> 121.6,146.6,153.2 [width]
// Needs `npm run dev` (port 5174, or APP_URL). Same rendering as tools/qa/review_kit.mjs.
import { chromium } from 'playwright';
import fs from 'node:fs';

const [out, LANG, ASPECT, TIMES, WIDTH = '360'] = process.argv.slice(2);
const URL = process.env.APP_URL || 'http://localhost:5174/';
const EPISODE = process.env.EPISODE || 'mkultra-secret-experiments';
const b = await chromium.launch();
const p = await b.newPage();
p.setDefaultTimeout(300000);
await p.goto(URL);
await p.waitForTimeout(2500);
const data = await p.evaluate(
  async ([LANG, ASPECT, TIMES, WIDTH, EPISODE, SHORT]) => {
    const { renderFrame } = await import('/src/animation/renderScene.ts');
    const { buildTimeline, buildShortTimeline } = await import('/src/animation/timeline.ts');
    const { loadStudioPack, studioTiming } = await import('/src/audio/studioVoice.ts');
    const { STUDIO_VOICES } = await import('/src/audio/studioVoices.ts');
    const { switchLanguage } = await import('/src/data/project.ts');
    const { loadCanvasFonts } = await import('/src/app/fonts.ts');
    const { loadProjectMedia } = await import('/src/media/store.ts');
    const R = await import('/src/character/rig/rigPuppet.ts');
    await R.loadRig();
    await loadCanvasFonts();
    const saved = await (await fetch(`/episodes/${EPISODE}.foxproj.json?${Date.now()}`)).json();
    const pr = switchLanguage(saved, LANG || saved.settings.language);
    if (ASPECT) pr.settings.aspect = ASPECT;
    await loadProjectMedia(pr);
    const lang = pr.settings.language;
    const voice = pr.settings.studioVoice?.[lang] ?? STUDIO_VOICES[lang][0].id;
    const pack = await loadStudioPack(lang, voice, undefined, Date.now()).catch(() => null);
    const timing = studioTiming(pack, new Map());
    // SHORT=1: the Short's own cut.
    const tl = (SHORT && buildShortTimeline(pr, timing)) || buildTimeline(pr, undefined, timing);
    const V = pr.settings.aspect === '9:16';
    const [w, h] = V ? [540, 960] : [960, 540];
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const times = TIMES.split(',').map(Number);
    const tw = Number(WIDTH), th = Math.round((tw * h) / w);
    const sheet = document.createElement('canvas');
    sheet.width = tw * times.length;
    sheet.height = th + 20;
    const sg = sheet.getContext('2d');
    sg.fillStyle = '#111';
    sg.fillRect(0, 0, sheet.width, sheet.height);
    times.forEach((t, i) => {
      renderFrame(g, w, h, pr, tl, t, { filmGrain: false, subtitles: pr.settings.subtitles, burnSubtitles: true });
      sg.drawImage(c, i * tw, 20, tw, th);
      sg.fillStyle = '#fff';
      sg.font = '14px sans-serif';
      sg.fillText(`${t.toFixed(1)} s`, i * tw + 4, 15);
    });
    return sheet.toDataURL('image/jpeg', 0.85);
  },
  [LANG, ASPECT, TIMES, WIDTH, EPISODE, process.env.SHORT === '1'],
);
fs.writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
await b.close();
