// Renders the model sheet (character/modelSheet.ts) to a PNG: node tools/qa/model_sheet.mjs out.png
// Needs `npm run dev` on port 5174 (or FOX_URL).
import { chromium } from 'playwright';
import fs from 'node:fs';
const out = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
await p.goto((process.env.FOX_URL ?? 'http://localhost:5174') + '/tracer.html?part=eyes', { waitUntil: 'load' });
await p.waitForTimeout(2500);
const url = await p.evaluate(async () => {
  const R = await import('/src/character/rig/rigPuppet.ts');
  await R.loadRig();
  const M = await import('/src/character/modelSheet.ts');
  const c = document.createElement('canvas');
  c.width = M.SHEET_W;
  c.height = M.SHEET_H;
  M.drawModelSheet(c.getContext('2d'), 0.4);
  return c.toDataURL();
});
fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
await b.close();
