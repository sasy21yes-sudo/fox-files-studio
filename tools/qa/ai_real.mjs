// Drives the "Ask Claude" panel with a REAL request (Claude Code or the API, as the
// dev server chose) and screenshots the result. Starts from a fresh MKUltra project.
//   node tools/qa/ai_real.mjs scene|all "<prompt>" [outDir]   (APP_URL, default http://localhost:5173/)
import { chromium } from 'playwright';
import fs from 'node:fs';
const [scope = 'scene', prompt = 'Aggiungi un timbro CLASSIFIED quando atterra la cartella', OUT = 'qa-out/ai_real'] = process.argv.slice(2);
const URL = process.env.APP_URL || 'http://localhost:5173/';
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
let posted = null;
p.on('request', (r) => {
  if (r.url().includes('/api/claude/edit')) posted = JSON.parse(r.postData() || '{}');
});
await p.goto(URL);
await p.evaluate(() => localStorage.clear());
await p.reload();
await p.waitForTimeout(2500);
if (scope === 'all') await p.locator('.ai-scope button', { hasText: 'Whole video' }).click();
await p.locator('.ai-prompt').fill(prompt);
const t0 = Date.now();
await p.locator('button', { hasText: 'Apply with Claude' }).click();
await p.waitForTimeout(1500);
await p.screenshot({ path: `${OUT}/01_working.png` });
await p.waitForSelector('.ai-result, .ai-body .warn-text', { timeout: 25 * 60 * 1000 });
const seconds = Math.round((Date.now() - t0) / 1000);
await p.waitForTimeout(800);
await p.screenshot({ path: `${OUT}/02_result.png` });
// SEEK=<seconds of the episode>: also screenshot that moment.
if (process.env.SEEK) {
  await p.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await p.keyboard.press('Home');
  const s = Number(process.env.SEEK);
  for (let i = 0; i < Math.floor(s); i++) await p.keyboard.press('Shift+ArrowRight');
  for (let i = 0; i < Math.round((s % 1) * 30); i++) await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/03_seek.png` });
}
const result = await p.locator('.ai-result').allInnerTexts();
const error = await p.locator('.ai-body .warn-text').allInnerTexts();
const project = await p.evaluate(() => {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.includes('project') && !k.includes('index')) {
      try {
        const j = JSON.parse(localStorage.getItem(k) || 'null');
        if (j?.scenes) return j;
      } catch {}
    }
  }
  return null;
});
if (project) fs.writeFileSync(`${OUT}/project.json`, JSON.stringify(project, null, 1));
console.log({ scope, target: posted?.target, seconds, result, error });
console.log(errs.length ? errs : 'no page errors');
await b.close();
