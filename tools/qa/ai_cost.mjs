// One real "Ask Claude" request from the saved episode, printing what it cost (tokens, USD, time).
//   node tools/qa/ai_cost.mjs <scene index|all> "<prompt>" [model] [effort] [frames per scene]
// Needs `npm run dev` (port 5174, or APP_URL). Nothing is applied to the episode.
import { chromium } from 'playwright';
const [scope = '0', prompt = 'Sposta il pop-up un po\' più in alto', model = 'claude-haiku-5-5', effort = 'low', per = '3'] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage();
p.setDefaultTimeout(900000);
await p.goto(process.env.APP_URL || 'http://localhost:5174/');
await p.waitForTimeout(2500);
const r = await p.evaluate(
  async ([scope, prompt, model, effort, per]) => {
    const { buildTimeline } = await import('/src/animation/timeline.ts');
    const { editWithClaude } = await import('/src/ai/claude.ts');
    const { renderFramesForClaude } = await import('/src/ai/frames.ts');
    const { loadCanvasFonts } = await import('/src/app/fonts.ts');
    const R = await import('/src/character/rig/rigPuppet.ts');
    await R.loadRig();
    await loadCanvasFonts();
    const pr = await (await fetch(`/episodes/mkultra-secret-experiments.foxproj.json?${Date.now()}`)).json();
    const tl = buildTimeline(pr);
    const target = scope === 'all' ? 'all' : Number(scope);
    const frames = Number(per) ? renderFramesForClaude(pr, tl, target === 'all' ? pr.scenes.map((_, i) => i) : [target], Number(per)) : undefined;
    const t0 = performance.now();
    try {
      const res = await editWithClaude(pr, target, prompt, undefined, tl, { frames, options: { model, effort, web: false } });
      return { usage: res.usage, model: res.model, attempts: res.attempts, summary: res.summary, changes: res.scenes, frames: frames?.length ?? 0, s: (performance.now() - t0) / 1000 };
    } catch (e) {
      return { usage: e.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, model, attempts: 2, summary: 'FAILED: ' + e.message, frames: frames?.length ?? 0, s: (performance.now() - t0) / 1000 };
    }
  },
  [scope, prompt, model, effort, per],
);
const u = r.usage;
console.log(`${r.model} · ${r.frames} frames · ${r.attempts} attempt(s) · ${r.s.toFixed(0)} s`);
console.log(`new in ${u.input + u.cacheWrite} · cached in ${u.cacheRead} · out ${u.output}${u.cost !== undefined ? ` · $${u.cost.toFixed(4)}` : ''}`);
console.log(r.summary);
if (r.changes) console.log(JSON.stringify(r.changes).slice(0, 600));
await b.close();
