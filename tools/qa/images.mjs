// Images, preview handles and the new editor shortcuts, end to end on a fresh MKUltra project.
// Generates one REAL picture through the dev server (ComfyUI must be running).
//   node tools/qa/images.mjs [outDir]      (APP_URL, default http://localhost:5173/)
import { chromium } from 'playwright';
import fs from 'node:fs';
const OUT = process.argv[2] || 'qa-out/images';
const URL = process.env.APP_URL || 'http://localhost:5173/';
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
const report = {};

const project = () =>
  p.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('fox-files-studio:project:')) return JSON.parse(localStorage.getItem(k));
    }
    return null;
  });
const blur = () => p.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
const shot = (name) => p.screenshot({ path: `${OUT}/${name}.png` });

await p.goto(URL);
await p.evaluate(() => localStorage.clear());
await p.reload();
await p.waitForTimeout(2500);

// 1. Generate a picture from the Images tab.
await p.locator('.left-panel .tabs button', { hasText: 'Images' }).click();
await p.locator('.image-bin textarea').fill('A dim government archive with tall metal shelves of cardboard file boxes and a single hanging bulb');
const t0 = Date.now();
await p.locator('.image-bin button', { hasText: 'Generate' }).click();
await p.waitForTimeout(1200);
await shot('01_generating');
await p.waitForSelector('.img-card', { timeout: 10 * 60 * 1000 });
report.generateSeconds = Math.round((Date.now() - t0) / 1000);
await p.waitForTimeout(800);
await shot('02_generated');

// 2. Picture scene after scene 1.
await p.locator('.img-card').first().locator('.img-pick').click({ force: true }).catch(() => {});
if (!(await p.locator('.img-actions').count())) await p.locator('.img-card .img-pick').first().click();
await p.locator('.img-actions button', { hasText: 'Picture scene' }).click();
await p.waitForTimeout(1500);
let proj = await project();
report.scenesAfterPictureScene = proj.scenes.length;
report.scene2 = { title: proj.scenes[1].title, type: proj.scenes[1].spec?.elements?.[0]?.type, media: proj.media?.length };
await blur();
for (let i = 0; i < 3; i++) await p.keyboard.press('Shift+ArrowRight');
await p.waitForTimeout(800);
await shot('03_picture_scene');

// 3. The picture inside scene 1 at the playhead.
await p.locator('.left-panel .tabs button', { hasText: 'Scenes' }).click();
await p.locator('.k-scene').first().click({ position: { x: 30, y: 10 } });
await blur();
await p.keyboard.press('Home');
for (let i = 0; i < 12; i++) await p.keyboard.press('Shift+ArrowRight');
await p.locator('.left-panel .tabs button', { hasText: 'Images' }).click();
await p.locator('.img-card .img-pick').first().click();
const into = p.locator('.img-actions button', { hasText: 'Into scene 1' });
report.intoSceneButton = await into.count();
if (report.intoSceneButton) await into.click();
await p.waitForTimeout(400);
await blur();
for (let i = 0; i < 1; i++) await p.keyboard.press('Shift+ArrowRight');
await p.waitForTimeout(800);
await shot('04_picture_in_scene1');
proj = await project();
report.scene1Pictures = proj.scenes[0].spec.elements.filter((e) => e.type === 'picture').map((e) => ({ id: e.id, from: e.from, to: e.to }));

// 4. Drag a handle (the lamp) in the preview, then undo.
await p.keyboard.press('Control+z'); // remove the picture again so the room is visible
await p.waitForTimeout(400);
await p.keyboard.press('Home');
for (let i = 0; i < 2; i++) await p.keyboard.press('Shift+ArrowRight');
await p.waitForTimeout(600);
const handles = await p.locator('.ov-handle').count();
report.handles = handles;
const lampBefore = (await project()).scenes[0].spec.elements.find((e) => e.id === 'lamp')?.x;
const lamp = p.locator('.ov-el', { has: p.locator('title', { hasText: 'lamp' }) }).locator('.ov-handle').first();
report.lampHandle = await lamp.count();
if (report.lampHandle) {
  const box = await lamp.boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  for (let i = 1; i <= 8; i++) await p.mouse.move(box.x + box.width / 2 - i * 12, box.y + box.height / 2 + i * 3);
  await p.mouse.up();
  await p.waitForTimeout(700);
  await shot('05_dragged_lamp');
  const lampAfter = (await project()).scenes[0].spec.elements.find((e) => e.id === 'lamp')?.x;
  await blur();
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(700);
  const lampUndone = (await project()).scenes[0].spec.elements.find((e) => e.id === 'lamp')?.x;
  report.lamp = { before: lampBefore, after: lampAfter, undone: lampUndone };

  // 5. Duplicate it with Ctrl+D (the lamp is selected).
  const n0 = (await project()).scenes[0].spec.elements.length;
  await p.keyboard.press('Control+d');
  await p.waitForTimeout(700);
  report.ctrlD = { before: n0, after: (await project()).scenes[0].spec.elements.length };
  await p.keyboard.press('Control+z');
}

// 6. Shortcuts and still.
await blur();
await p.keyboard.press('?');
await p.waitForTimeout(300);
await shot('06_shortcuts');
await p.keyboard.press('Escape');
const [still] = await Promise.all([p.waitForEvent('download'), p.locator('.transport button', { hasText: 'Still' }).click()]);
const stillPath = `${OUT}/07_still.png`;
await still.saveAs(stillPath);
const png = fs.readFileSync(stillPath);
report.still = { name: still.suggestedFilename(), width: png.readUInt32BE(16), height: png.readUInt32BE(20) };

// 7. Project file carries the image.
await p.locator('.topbar button, nav button', { hasText: 'Media' }).first().click();
await p.waitForTimeout(800);
await shot('08_media_page');
const [file] = await Promise.all([p.waitForEvent('download'), p.locator('.project-card.current button', { hasText: 'Export file' }).click()]);
const json = JSON.parse(fs.readFileSync(await file.path(), 'utf8'));
report.projectFile = { media: json.media?.length, mediaData: Object.keys(json.mediaData ?? {}).length, bytes: fs.statSync(await file.path()).size };

console.log(JSON.stringify(report, null, 1));
console.log(errs.length ? errs : 'no page errors');
await b.close();
