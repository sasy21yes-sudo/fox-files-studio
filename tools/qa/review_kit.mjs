// The review kit the review agents (.claude/agents) work from: everything about the episode as the viewer
// gets it, without exporting the video.
//   node tools/qa/review_kit.mjs [lang] [aspect] [outDir] [--every 2]
// Defaults: the episode file's language and aspect, qa-out/review/<lang>_<aspect>/, a frame every 2 s.
// Writes:
//   frames/NNN.N.jpg          a frame every --every s plus one at each pop-up (subtitles burned in, 960 px)
//   sheets/scene_NN.jpg       a contact sheet per scene (12 frames, time-stamped)
//   mix.wav                   narration + music + sound effects as exported (48 kHz)
//   narration.wav, music.wav  the stems, for checking ducking and levels
//   timeline.json             scenes (title, start/end, narration), subtitle cues, pop-ups, voice clips,
//                             words/minute per scene, settings
// Needs `npm run dev` (port 5174, or APP_URL) and Playwright.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const every = Number(args.includes('--every') ? args[args.indexOf('--every') + 1] : 2);
const pos = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--every');
const URL = process.env.APP_URL || 'http://localhost:5174/';
const EPISODE = process.env.EPISODE || 'mkultra-secret-experiments';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
p.setDefaultTimeout(600000);
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
await p.goto(URL);
await p.waitForTimeout(3000);

const kit = await p.evaluate(
  async ([LANG, ASPECT, EVERY, EPISODE, SHORT]) => {
    const { renderFrame } = await import('/src/animation/renderScene.ts');
    const { buildTimeline, buildShortTimeline } = await import('/src/animation/timeline.ts');
    const { loadStudioPack, studioTiming, renderStudioTrack } = await import('/src/audio/studioVoice.ts');
    const { STUDIO_VOICES } = await import('/src/audio/studioVoices.ts');
    const { renderAmbience } = await import('/src/audio/ambience.ts');
    const { renderSfx } = await import('/src/audio/sfx.ts');
    const { mixExportAudio, audioBufferToWav } = await import('/src/audio/audioCapture.ts');
    const { loadCanvasFonts } = await import('/src/app/fonts.ts');
    const { placeBeats } = await import('/src/effects/beats.ts');
    const { loadProjectMedia } = await import('/src/media/store.ts');
    const R = await import('/src/character/rig/rigPuppet.ts');
    await R.loadRig();
    await loadCanvasFonts();
    const { restoreProject, switchLanguage } = await import('/src/data/project.ts');
    const saved = await (await fetch(`/episodes/${EPISODE}.foxproj.json`)).json();
    const lang = LANG || saved.settings.language;
    // The episode in another language exactly as the studio switches it (narration, titles, pop-ups, voice).
    const pr = switchLanguage(restoreProject(saved) ?? saved, lang);
    if (ASPECT) pr.settings.aspect = ASPECT;
    await loadProjectMedia(pr);
    const voice = pr.settings.studioVoice?.[lang] ?? STUDIO_VOICES[lang][0].id;
    const pack = await loadStudioPack(lang, voice).catch(() => null);
    const timing = studioTiming(pack, new Map());
    // SHORT=1: the Short's own cut (project.short) instead of the whole episode.
    const tl = (SHORT && buildShortTimeline(pr, timing)) || buildTimeline(pr, undefined, timing);
    const vertical = pr.settings.aspect === '9:16';
    const [w, h] = vertical ? [540, 960] : [960, 540];
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const shot = (t) => {
      renderFrame(g, w, h, pr, tl, t, { filmGrain: false, subtitles: pr.settings.subtitles, burnSubtitles: true });
      return c.toDataURL('image/jpeg', 0.82);
    };
    // Frames: a regular beat plus every pop-up at its most visible moment.
    const times = new Map();
    for (let t = 0.5; t < tl.total; t += EVERY) times.set(t.toFixed(1), 'tick');
    const beats = [];
    tl.spans.forEach((s, i) =>
      placeBeats(tl, i).forEach((bt) => {
        const t = Math.min(bt.end - 0.3, bt.start + 1.6);
        times.set(t.toFixed(1), `popup_${bt.beat.kind}`);
        beats.push({ scene: i, kind: bt.beat.kind, cue: bt.beat.cue ?? null, label: bt.beat.label ?? bt.beat.text ?? null, start: +bt.start.toFixed(2), end: +bt.end.toFixed(2) });
      }),
    );
    const frames = [...times.entries()].sort((a, z) => +a[0] - +z[0]).map(([t, kind]) => ({ name: `${t.padStart(6, '0')}_${kind}.jpg`, data: shot(+t) }));
    // Contact sheets: 12 frames per scene, 4 columns, time-stamped.
    const sheets = tl.spans.map((s, i) => {
      const cols = 4, n = 12, tw = vertical ? 180 : 320, th = vertical ? 320 : 180;
      const sc = document.createElement('canvas');
      sc.width = cols * tw;
      sc.height = Math.ceil(n / cols) * (th + 18);
      const sg = sc.getContext('2d');
      sg.fillStyle = '#111';
      sg.fillRect(0, 0, sc.width, sc.height);
      for (let k = 0; k < n; k++) {
        const t = s.start + (s.duration * (k + 0.5)) / n;
        renderFrame(g, w, h, pr, tl, t, { filmGrain: false, subtitles: pr.settings.subtitles, burnSubtitles: true });
        const x = (k % cols) * tw, y = Math.floor(k / cols) * (th + 18);
        sg.drawImage(c, x, y + 18, tw, th);
        sg.fillStyle = '#fff';
        sg.font = '13px sans-serif';
        sg.fillText(`${t.toFixed(1)} s`, x + 4, y + 13);
      }
      return { name: `scene_${String(i + 1).padStart(2, '0')}.jpg`, data: sc.toDataURL('image/jpeg', 0.85) };
    });
    // Audio: the export mix and its stems.
    const wav = async (buf) => {
      if (!buf) return null;
      const blob = audioBufferToWav(buf);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    };
    const narration = renderStudioTrack(tl, timing);
    const music = pr.settings.music ? await renderAmbience(tl) : null;
    const sfx = renderSfx(tl);
    const mix = await mixExportAudio({
      duration: tl.total,
      music: music ? { buffer: music, gain: pr.settings.musicVolume } : null,
      narration: narration ? { buffer: narration, gain: 1 } : null,
      sfx: sfx ? { buffer: sfx, gain: 1 } : null,
    });
    const words = (t) => (t.match(/\S+/g) ?? []).length;
    const timeline = {
      episode: pr.episodeTitle,
      language: lang,
      aspect: pr.settings.aspect,
      voice,
      voiceMissing: pack ? null : 'no studio pack: narration silent in the mix',
      total: +tl.total.toFixed(2),
      settings: pr.settings,
      scenes: tl.spans.map((s, i) => ({
        index: i,
        title: s.scene.title,
        start: +s.start.toFixed(2),
        end: +(s.start + s.duration).toFixed(2),
        duration: +s.duration.toFixed(2),
        narration: s.scene.narration,
        wordsPerMinute: Math.round((words(s.scene.narration ?? '') / Math.max(1, s.duration)) * 60),
        transition: s.scene.transition,
      })),
      subtitles: tl.cues.map((q) => ({ start: +q.start.toFixed(2), end: +q.end.toFixed(2), text: q.text })),
      voiceClips: tl.clips.map((q) => ({ start: +q.start.toFixed(2), duration: +q.duration.toFixed(2), text: q.text })),
      popups: beats,
    };
    return { frames, sheets, timeline, mix: await wav(mix), narration: await wav(narration), music: await wav(music) };
  },
  [pos[0] ?? null, pos[1] ?? null, every, EPISODE, process.env.SHORT === '1'],
);

const out = pos[2] ?? `qa-out/review/${kit.timeline.language}_${kit.timeline.aspect.replace(':', 'x')}${process.env.SHORT === '1' ? '_short' : ''}`;
// Replace the material, never the team's reports (a whole-folder wipe once deleted round 1's reports).
for (const f of ['frames', 'sheets', 'mix.wav', 'narration.wav', 'music.wav', 'timeline.json']) fs.rmSync(path.join(out, f), { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'frames'), { recursive: true });
fs.mkdirSync(path.join(out, 'sheets'), { recursive: true });
for (const f of kit.frames) fs.writeFileSync(path.join(out, 'frames', f.name), Buffer.from(f.data.split(',')[1], 'base64'));
for (const f of kit.sheets) fs.writeFileSync(path.join(out, 'sheets', f.name), Buffer.from(f.data.split(',')[1], 'base64'));
for (const k of ['mix', 'narration', 'music']) if (kit[k]) fs.writeFileSync(path.join(out, `${k}.wav`), Buffer.from(kit[k], 'base64'));
fs.writeFileSync(path.join(out, 'timeline.json'), JSON.stringify(kit.timeline, null, 1));
console.log(`review kit → ${out}: ${kit.frames.length} frames, ${kit.sheets.length} contact sheets, ${kit.timeline.total} s, audio ${['mix', 'narration', 'music'].filter((k) => kit[k]).join(', ') || 'none'}`);
console.log(errs.length ? `page errors: ${errs.join(' | ')}` : 'no page errors');
await b.close();
