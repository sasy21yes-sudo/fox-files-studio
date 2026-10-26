// Review kit for Agent Fox's FRONT bust (foxFront.ts): the front model sheet, every arm pose reached from rest
// and left back to rest in fine in-betweens, and the episode's frames where he faces the lens.
//   node tools/qa/front_review.mjs [lang] [out]      (default it, qa-out/review/front; needs the dev server on 5174)
// Output: sheet_front.jpg, moves_<n>.jpg (pose rows: rest -> pose -> rest, 8 steps each way, big enough to see
// a glove crossing the coat or the face), episode/<aspect>_<t>.jpg, windows.json (when the front view plays).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const [LANG = 'it', OUT = 'qa-out/review/front'] = process.argv.slice(2);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'episode'), { recursive: true });
const b = await chromium.launch();
const p = await b.newPage();
p.setDefaultTimeout(600000);
await p.goto(process.env.APP_URL || 'http://localhost:5174/');
await p.waitForTimeout(2500);
const res = await p.evaluate(async (LANG) => {
  const { drawFrontSheet } = await import('/src/character/frontSheet.ts');
  const { drawFox } = await import('/src/character/AgentFox.ts');
  const { loadFront } = await import('/src/character/foxFront.ts');
  const R = await import('/src/character/rig/rigPuppet.ts');
  const { loadCanvasFonts } = await import('/src/app/fonts.ts');
  const { renderFrame } = await import('/src/animation/renderScene.ts');
  const { buildTimeline } = await import('/src/animation/timeline.ts');
  const { loadStudioPack, studioTiming } = await import('/src/audio/studioVoice.ts');
  const { STUDIO_VOICES } = await import('/src/audio/studioVoices.ts');
  const { restoreProject, switchLanguage } = await import('/src/data/project.ts');
  const { loadProjectMedia } = await import('/src/media/store.ts');
  await R.loadRig();
  await loadFront();
  await loadCanvasFonts();
  const files = {};
  const jpg = (c) => c.toDataURL('image/jpeg', 0.86);
  // 1. The sheet.
  const sheet = document.createElement('canvas');
  sheet.width = 2400;
  sheet.height = 1560;
  drawFrontSheet(sheet.getContext('2d'));
  files['sheet_front.jpg'] = jpg(sheet);
  // 2. Moves: rest -> pose -> rest, 8 steps each way, rows of poses.
  const POSES = ['hips', 'point', 'wave', 'one', 'stop', 'knock', 'pinch', 'shake', 'magnify', 'pencil', 'chin', 'hold', 'hatChest', 'scratch', 'tiphat', 'shield'];
  const STEPS = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1];
  const CW = 230;
  const CH = 300;
  for (let k = 0; k < POSES.length; k += 4) {
    const rows = POSES.slice(k, k + 4);
    const c = document.createElement('canvas');
    c.width = CW * STEPS.length * 2;
    c.height = CH * rows.length;
    const g = c.getContext('2d');
    g.fillStyle = '#d9cbb0';
    g.fillRect(0, 0, c.width, c.height);
    rows.forEach((pose, r) => {
      [['rest', pose], [pose, 'rest']].forEach(([from, to], half) =>
        STEPS.forEach((s, j) => {
          const x = (half * STEPS.length + j) * CW;
          g.save();
          g.beginPath();
          g.rect(x, r * CH, CW, CH);
          g.clip();
          drawFox(g, { x: x + CW / 2, y: r * CH + CH - 6, scale: 270 / 600, time: 0.4, bounce: 0, noShadow: true, view: 'front', armFront: to, armFrontFrom: from, armFrontBlend: s });
          g.restore();
          g.font = '600 14px sans-serif';
          g.fillStyle = '#5a1d0e';
          g.fillText(`${from}→${to} ${Math.round(s * 100)}%`, x + 6, r * CH + 16);
        }),
      );
    });
    files[`moves_${k / 4 + 1}.jpg`] = jpg(c);
  }
  // 3. The episode where he faces the lens (probe), every 0.5 s, both aspects.
  const saved = await (await fetch(`/episodes/mkultra-secret-experiments.foxproj.json?${Date.now()}`)).json();
  const windows = {};
  for (const aspect of ['9:16', '16:9']) {
    const pr = switchLanguage(restoreProject(saved) ?? saved, LANG);
    pr.settings.aspect = aspect;
    await loadProjectMedia(pr);
    const voice = pr.settings.studioVoice?.[LANG] ?? STUDIO_VOICES[LANG][0].id;
    const tl = buildTimeline(pr, undefined, studioTiming(await loadStudioPack(LANG, voice, undefined, Date.now()), new Map()));
    const V = aspect === '9:16';
    const c = document.createElement('canvas');
    c.width = V ? 540 : 960;
    c.height = V ? 960 : 540;
    const g = c.getContext('2d');
    const hits = [];
    let n = 0;
    for (let t = 0; t < tl.total && n < 60; t += 0.5) {
      const probe = { scene: -1, matrix: null, anchors: [] };
      renderFrame(g, c.width, c.height, pr, tl, t, { filmGrain: false, subtitles: pr.settings.subtitles, burnSubtitles: true, probe });
      if (probe.fox?.pose?.view !== 'front') continue;
      hits.push(+t.toFixed(1));
      files[`episode/${aspect.replace(':', 'x')}_${t.toFixed(1).padStart(5, '0')}.jpg`] = jpg(c);
      n++;
    }
    windows[aspect] = hits;
  }
  return { files, windows };
}, LANG);
for (const [name, data] of Object.entries(res.files)) fs.writeFileSync(path.join(OUT, name), Buffer.from(data.split(',')[1], 'base64'));
fs.writeFileSync(path.join(OUT, 'windows.json'), JSON.stringify(res.windows));
console.log(`front kit -> ${OUT}: ${Object.keys(res.files).length} images; front view at ${Object.entries(res.windows).map(([a, w]) => `${a}: ${w.length} frames (${w[0] ?? '-'}..${w.at(-1) ?? '-'} s)`).join(', ')}`);
await b.close();
