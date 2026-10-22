// Exercises the "Ask Claude" panel without calling Claude: the dev-server
// endpoints are mocked with a valid answer (scene 1 + a CLASSIFIED stamp).
//   node tools/qa/ai_mock.mjs [outDir]      (APP_URL, default http://localhost:5173/)
import { chromium } from 'playwright';
import fs from 'node:fs';
const OUT = process.argv[2] || 'qa-out/ai_mock';
const URL = process.env.APP_URL || 'http://localhost:5173/';
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
let posted = null;
await p.route('**/api/claude/status', (r) => r.fulfill({ json: { available: true, backend: 'claude-code', model: 'claude-opus-5-5 (mock)' } }));
await p.goto(URL);
await p.evaluate(() => localStorage.clear());
const spec = await p.evaluate(async () => {
  const { FILE_SPEC } = await import('/src/data/specs/file.ts');
  const s = structuredClone(FILE_SPEC);
  s.elements.splice(s.elements.length - 1, 0, {
    id: 'stamp-classified', type: 'stamp', label: 'CLASSIFIED stamp', x: { h: 0.62, v: 0.6 }, y: { h: 0.42, v: 0.4 },
    params: { text: 'CLASSIFIED', size: 110, at: 4.4 },
  });
  return s;
});
await p.route('**/api/claude/edit', async (r) => {
  posted = JSON.parse(r.request().postData() || '{}');
  await new Promise((res) => setTimeout(res, 600));
  await r.fulfill({ json: { summary: 'Ho aggiunto un timbro CLASSIFIED che cade sulla cartella subito dopo l’atterraggio (4,4 s).', scenes: [{ index: 0, spec, beats: null, duration: null }], usage: { input: 1200, output: 3400, cacheRead: 9800, cacheWrite: 0 }, model: 'claude-opus-5-5', attempts: 1 } });
});
await p.reload();
await p.waitForTimeout(2500);
await p.locator('.ai-prompt').fill('Aggiungi un timbro CLASSIFIED quando atterra la cartella');
await p.locator('button', { hasText: 'Apply with Claude' }).click();
await p.waitForTimeout(150);
await p.screenshot({ path: `${OUT}/01_working.png` });
await p.waitForSelector('.ai-result', { timeout: 5000 });
// Seek to just after the stamp in scene 1 (authored 4.6 of 9 → real time).
const t = await p.evaluate(() => 4.9 * (26 / 9));
await p.locator('.tl-clip.k-scene').first().click({ position: { x: 20, y: 10 } });
await p.locator('.tl-toolbar button', { hasText: 'Scene' }).click();
await p.keyboard.press('Home');
for (let i = 0; i < Math.round(t); i++) await p.keyboard.press('Shift+ArrowRight');
await p.waitForTimeout(500);
await p.screenshot({ path: `${OUT}/02_applied.png` });
const stampLane = await p.locator('.tl-row', { hasText: 'stamp' }).count();
await p.locator('button', { hasText: 'Undo this change' }).click();
await p.waitForTimeout(500);
await p.screenshot({ path: `${OUT}/03_undone.png` });
const stampLaneAfterUndo = await p.locator('.tl-row', { hasText: 'stamp' }).count();
console.log({
  posted: posted && { prompt: posted.prompt, target: posted.target, scenes: posted.scenes?.length, hasSpec: !!posted.scenes?.[0]?.spec, sources: posted.sources?.length },
  stampLane,
  stampLaneAfterUndo,
});
console.log(errs.length ? errs : 'no page errors');
await b.close();
