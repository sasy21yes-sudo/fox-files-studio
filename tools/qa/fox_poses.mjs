// Renders Agent Fox in the given poses, side by side (for QA): node tools/qa/fox_poses.mjs out.png '[{...pose}]' [scale]
// Needs `npm run dev` on port 5174 (or FOX_URL).
import { chromium } from 'playwright';
import fs from 'node:fs';
const [out, posesJson, scaleArg] = process.argv.slice(2);
const poses = JSON.parse(posesJson);
const scale = Number(scaleArg ?? 1.6);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
await p.goto((process.env.FOX_URL ?? 'http://localhost:5174') + '/tracer.html?part=eyes', { waitUntil: 'load' });
await p.waitForTimeout(2500);
const url = await p.evaluate(async ({ poses, scale }) => {
  const R = await import('/src/character/rig/rigPuppet.ts');
  await R.loadRig();
  const A = await import('/src/character/AgentFox.ts');
  const W = 440 * scale, H = 690 * scale;
  const c = document.createElement('canvas');
  c.width = W * poses.length;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#efe4cf';
  g.fillRect(0, 0, c.width, c.height);
  poses.forEach((pose, i) => A.drawFox(g, { x: W * i + W / 2, y: H - 25 * scale, scale, time: 0.4, bounce: 0, noShadow: true, ...pose }));
  return c.toDataURL();
}, { poses, scale });
fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
await b.close();
