// Screenshots of the editor in its main states + page errors.
//   node tools/qa/editor.mjs [outDir]      (APP_URL, default http://localhost:5173/)
import { chromium } from 'playwright';
import fs from 'node:fs';
const OUT = process.argv[2] || 'qa-out/editor';
const URL = process.env.APP_URL || 'http://localhost:5173/';
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto(URL);
await p.evaluate(() => localStorage.clear());
await p.reload();
await p.waitForTimeout(2500);
const shot = async (name) => p.screenshot({ path: `${OUT}/${name}.png` });

await shot('01_edit');
// Scene 1 (data scene): its tracks appear under the global ones.
await p.locator('.tl-clip.k-scene').first().click({ position: { x: 20, y: 10 } });
await p.locator('.tl-toolbar button', { hasText: 'Scene' }).click();
await p.waitForTimeout(500);
await shot('02_scene1');
// Select the folder element lane clip.
const folder = p.locator('.tl-row', { hasText: 'MKULTRA folder' }).locator('.tl-clip.k-element');
if (await folder.count()) {
  await folder.first().click({ position: { x: 30, y: 8 } });
  await p.waitForTimeout(400);
  await shot('03_element');
}
// A camera shot.
const shotClip = p.locator('.tl-clip.k-shot').nth(4);
if (await shotClip.count()) {
  await shotClip.click({ position: { x: 6, y: 8 } });
  await p.waitForTimeout(400);
  await shot('04_shot');
}
// An arm key.
const key = p.locator('.tl-key').nth(2);
if (await key.count()) {
  await key.click();
  await p.waitForTimeout(400);
  await shot('05_key');
}
// Elements tab.
await p.locator('.tabs button', { hasText: 'Elements' }).click();
await p.waitForTimeout(300);
await shot('06_elements_tab');
// Undo/redo: add a lamp then undo.
await p.locator('.lib-item', { hasText: 'Desk lamp' }).click();
await p.waitForTimeout(400);
const lanesAfterAdd = await p.locator('.tl-row .tl-clip.k-element').count();
await p.keyboard.press('Control+z');
await p.waitForTimeout(400);
const lanesAfterUndo = await p.locator('.tl-row .tl-clip.k-element').count();
// Media page.
await p.locator('.pages button', { hasText: 'Media' }).click();
await p.waitForTimeout(500);
await shot('07_media');
// New episode.
await p.locator('button', { hasText: '+ New episode' }).click();
await p.waitForTimeout(1500);
await shot('08_new_episode');
// Deliver page.
await p.locator('.pages button', { hasText: 'Deliver' }).click();
await p.waitForTimeout(1200);
await shot('09_deliver');
// Vertical format on the new episode.
await p.locator('.pages button', { hasText: 'Edit' }).click();
await p.waitForTimeout(400);
const lib = await p.evaluate(() => JSON.parse(localStorage.getItem('fox-files-studio:library') || 'null'));
console.log({ lanesAfterAdd, lanesAfterUndo, library: lib?.projects?.map((e) => e.title) });
console.log(errs.length ? errs : 'no page errors');
await b.close();
