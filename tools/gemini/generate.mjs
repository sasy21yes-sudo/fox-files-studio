#!/usr/bin/env node
/**
 * Generate Agent Fox asset sheets with the Gemini image API.
 *
 * Prompts come from art/GEMINI_PROMPTS.md (STYLE block + the sheet's prompt),
 * references are attached as inline images, and every generation is logged
 * in art/incoming/manifest.json. The API key is read from .env
 * (GEMINI_API_KEY) and is never printed or written anywhere.
 *
 * Usage:
 *   node tools/gemini/generate.mjs --list
 *   node tools/gemini/generate.mjs <sheet> [--size 1K|2K|4K] [--aspect 16:9]
 *        [--model id] [--thinking minimal|medium|high]
 *        [--correction "..."]...  [--from vN]  [--ref path]...  [--dry-run]
 *   node tools/gemini/generate.mjs --mark <sheet> <vN> approved|rejected|final [--note "..."]
 *
 *   --from vN      reuse the prompt corrections and extra refs of version N
 *                  (e.g. re-render an approved 1K draft at 2K); new
 *                  --correction flags are appended to the inherited ones.
 *   --budget N     refuse to generate once N images exist in the manifest (default 40).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROMPTS = path.join(ROOT, 'art', 'GEMINI_PROMPTS.md');
const INCOMING = path.join(ROOT, 'art', 'incoming');
const MANIFEST = path.join(INCOMING, 'manifest.json');
const DEFAULT_MODEL = 'gemini-nano-banana-2.1';
const ALWAYS_REFS = ['art/agent-fox-model-sheet-painted.png', 'art/parts/fullbody.jpg'];
const REF_NAMES = {
  'art/agent-fox-model-sheet-painted.png': 'the official AGENT FOX model sheet (design, palette, proportions; ignore its text labels)',
  'art/parts/fullbody.jpg': 'the full-body reference on green (scale and line weight)',
  'art/parts/head.jpg': 'the blank head reference (a: head with hat, b: blank bare head, c: hat; ignore the letters)',
  'art/parts/hands.jpg': 'the glove reference sheet (glove design, finger count, size)',
  'art/parts/mouths.jpg': 'the mouth reference sheet (muzzle shape, angle, cut-off edge, size)',
  'art/parts/brows.jpg': 'the eyebrow reference sheet',
  'art/parts/eyes.jpg': 'the eye reference sheet',
  'art/parts/arms.jpg': 'the arm reference sheet (rubber-hose sleeves)',
  'art/parts/legs8.jpg': 'the leg reference sheet',
};
const LAYERS = {
  back: 'Now draw ONLY image (1), the BACK LAYER: walls, windows and far background, fully painted edge to edge, no green anywhere, no furniture in the foreground.',
  mid: 'Now draw ONLY image (2), the MID LAYER: the furniture and props only, on flat chroma-key green #00FF00 where the back layer would show. The attached painted room (last reference) is the BACK LAYER of this same scene: match its perspective, floor line, scale and lighting exactly so the layers stack.',
  front: 'Now draw ONLY image (3), the FRONT LAYER: a few close foreground silhouettes at the left and right edges only, on flat chroma-key green #00FF00 everywhere else; the centre stays empty green. The attached painted layers (last references) are the BACK and MID layers of this same scene: match their perspective and lighting.',
};

// ------------------------------------------------------------------ args

function parseArgs(argv) {
  const a = { _: [], correction: [], ref: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith('--')) { a._.push(t); continue; }
    const k = t.slice(2);
    if (k === 'list' || k === 'dry-run' || k === 'mark') { a[k] = true; continue; }
    const v = argv[++i];
    if (v === undefined) throw new Error(`missing value for --${k}`);
    if (Array.isArray(a[k])) a[k].push(v); else a[k] = v;
  }
  return a;
}

// ------------------------------------------------------------------ prompts

function codeBlockAfter(md, from) {
  const s = md.indexOf('```', from);
  const e = md.indexOf('```', s + 3);
  return md.slice(md.indexOf('\n', s) + 1, e).trim();
}

/** Sheets keyed by id: { id, num, title, prompt, refs[], refSheets[], style, aspect } */
function loadSheets() {
  const md = fs.readFileSync(PROMPTS, 'utf8');
  const style = codeBlockAfter(md, md.indexOf('## BLOCCO STILE'));
  const sheets = {};
  const re = /^## (\d+)\. (.+?) — `([a-z_]+)\.png`$/gm;
  let m;
  while ((m = re.exec(md))) {
    const next = md.indexOf('\n## ', m.index + 1);
    const body = md.slice(m.index, next < 0 ? md.length : next);
    const attach = (body.match(/^Allega anche: (.+)$/m) || [])[1] || '';
    sheets[m[3]] = {
      id: m[3], num: +m[1], title: m[2], style,
      prompt: codeBlockAfter(body, 0),
      refs: [...attach.matchAll(/`(art\/[^`]+)`/g)].map((x) => x[1]),
      refSheets: [...attach.matchAll(/foglio del punto (\d+)/g)].map((x) => +x[1]),
      aspect: '16:9',
    };
  }
  // Section 13: layered backgrounds, three images per scene.
  const bgAt = md.indexOf('## 13.');
  const base = codeBlockAfter(md, md.indexOf('Prompt base', bgAt));
  for (const d of md.slice(bgAt).matchAll(/^- \*\*([a-z]+)\*\* \((.+?)\): `(.+)`$/gm)) {
    for (const layer of ['back', 'mid', 'front']) {
      const id = `bg_${d[1]}_${layer}`;
      sheets[id] = {
        id, num: 13, title: `${d[2]} — ${layer}`, style: null, // the STYLE block's green-sheet rules don't fit a painted backdrop
        prompt: `${base.replace('<DESCRIZIONE>', d[3])}\n\n${LAYERS[layer]}`,
        refs: [], refSheets: [], aspect: '16:9',
        layerRefs: layer === 'back' ? [] : layer === 'mid' ? [`bg_${d[1]}_back`] : [`bg_${d[1]}_back`, `bg_${d[1]}_mid`],
      };
    }
  }
  return sheets;
}

// ------------------------------------------------------------------ manifest

function loadManifest() {
  if (!fs.existsSync(MANIFEST)) return { budget: { limit: 40, generated: 0 }, sheets: {} };
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}

function saveManifest(man) {
  man.budget.generated = Object.values(man.sheets).flatMap((s) => s.versions).filter((v) => v.file).length;
  fs.writeFileSync(MANIFEST, JSON.stringify(man, null, 2) + '\n');
}

function approvedFile(man, id) {
  const s = man.sheets[id];
  const v = s && (s.versions.find((x) => x.status === 'final') || s.versions.find((x) => x.status === 'approved'));
  if (!v) throw new Error(`sheet "${id}" has no approved version yet`);
  return v.file;
}

// ------------------------------------------------------------------ main

function readKey() {
  const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  const m = env.match(/^\s*GEMINI_API_KEY\s*=\s*(.*)$/m);
  const key = m && m[1].trim().replace(/^["']|["']$/g, '');
  if (!key) throw new Error('GEMINI_API_KEY missing in .env');
  return key;
}

/**
 * The SDK's own retry re-sends a cloned Request whose body was already read,
 * which fails as "TypeError: unusable" and hides the real status. Retry here
 * instead: transient statuses (408/429/5xx) only, with a long backoff.
 */
async function createWithRetry(ai, params, key) {
  const waits = [15, 45, 90];
  for (let attempt = 0; ; attempt++) {
    try {
      return await ai.interactions.create(params, { retries: { strategy: 'none' }, timeout: 600_000 });
    } catch (err) {
      const status = err && (err.status || err.statusCode || (err.cause && err.cause.statusCode));
      const msg = String(err.message || err).replaceAll(key, '<key>');
      // "limit: 0" = the tier has no quota for this model at all; waiting won't help.
      const transient = (status === 408 || status === 429 || status >= 500) && !/limit: 0\b/.test(msg);
      if (!transient || attempt >= waits.length) throw err;
      console.error(`  ${status}: ${msg.slice(0, 200)} — retrying in ${waits[attempt]}s`);
      await new Promise((r) => setTimeout(r, waits[attempt] * 1000));
    }
  }
}

function mimeOf(file) {
  const ext = path.extname(file).toLowerCase();
  return ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
}

async function generate(sheets, man, args) {
  const id = args._[0];
  const sheet = sheets[id];
  if (!sheet) throw new Error(`unknown sheet "${id}" (try --list)`);
  const entry = (man.sheets[id] ||= { versions: [] });

  let corrections = [...args.correction];
  let extraRefs = [...args.ref];
  if (args.from) {
    const src = entry.versions.find((v) => v.version === args.from);
    if (!src) throw new Error(`${id} has no version ${args.from}`);
    corrections = [...src.corrections, ...corrections];
    extraRefs = [...src.extraRefs, ...extraRefs];
  }

  const bySheetNum = (n) => Object.values(sheets).find((s) => s.num === n).id;
  const refs = [
    ...ALWAYS_REFS,
    ...sheet.refs,
    ...sheet.refSheets.map((n) => approvedFile(man, bySheetNum(n))),
    ...(sheet.layerRefs || []).map((l) => approvedFile(man, l)),
    ...extraRefs,
  ];
  for (const r of refs) if (!fs.existsSync(path.join(ROOT, r))) throw new Error(`missing reference ${r}`);

  const refList = refs.map((r, i) => `${i + 1}) ${REF_NAMES[r] || (r.startsWith('art/incoming/') ? 'the previously generated sheet ' + path.basename(r) : r)}`);
  const text = [
    sheet.style,
    sheet.prompt,
    corrections.length ? `CORRECTIONS (the previous attempt got these wrong, fix them):\n${corrections.map((c) => '- ' + c).join('\n')}` : null,
    `Attached reference images, in order:\n${refList.join('\n')}`,
  ].filter(Boolean).join('\n\n');

  const size = args.size || '1K';
  const aspect = args.aspect || sheet.aspect;
  const model = args.model || DEFAULT_MODEL;
  const version = `v${entry.versions.reduce((n, v) => Math.max(n, +v.version.slice(1)), 0) + 1}`;

  if (args['dry-run']) {
    console.log(`--- ${id} ${version} ${model} ${size} ${aspect}\n${text}\n--- refs: ${refs.join(', ')}`);
    return;
  }
  const limit = +(args.budget || man.budget.limit);
  if (man.budget.generated >= limit) throw new Error(`budget reached: ${man.budget.generated}/${limit} images`);

  const key = readKey();
  const ai = new GoogleGenAI({ apiKey: key });
  const input = [
    { type: 'text', text },
    ...refs.map((r) => ({ type: 'image', mime_type: mimeOf(r), data: fs.readFileSync(path.join(ROOT, r)).toString('base64') })),
  ];
  const record = {
    version, file: null, status: 'pending', model, size, aspect,
    thinking: args.thinking || null, corrections, extraRefs, refs,
    from: args.from || null, prompt: text, created: new Date().toISOString(),
  };
  const t0 = Date.now();
  try {
    const res = await createWithRetry(ai, {
      model, input, store: false,
      response_format: { type: 'image', aspect_ratio: aspect, image_size: size },
      ...(args.thinking ? { generation_config: { thinking_level: args.thinking } } : {}),
    }, key);
    const img = res.output_image;
    if (!img || !img.data) throw new Error(`no image returned${res.output_text ? ': ' + res.output_text.slice(0, 300) : ''}`);
    const out = path.join(INCOMING, `${id}_${version}.png`);
    const raw = Buffer.from(img.data, 'base64');
    if ((img.mime_type || 'image/png') === 'image/png') fs.writeFileSync(out, raw);
    else {
      // Keep the sheet name/format uniform: decode once and store losslessly as PNG.
      const tmp = out + '.src';
      fs.writeFileSync(tmp, raw);
      execFileSync('python', ['-c', 'import sys;from PIL import Image;Image.open(sys.argv[1]).convert("RGB").save(sys.argv[2])', tmp, out]);
      fs.unlinkSync(tmp);
    }
    const dims = execFileSync('python', ['-c', 'import sys;from PIL import Image;print(*Image.open(sys.argv[1]).size)', out]).toString().trim().split(' ').map(Number);
    Object.assign(record, {
      file: path.relative(ROOT, out).replaceAll('\\', '/'), status: 'draft', sourceMime: img.mime_type || null,
      width: dims[0], height: dims[1], seconds: Math.round((Date.now() - t0) / 100) / 10,
      usage: res.usage ? { input: res.usage.total_input_tokens, output: res.usage.total_output_tokens, thoughts: res.usage.total_thought_tokens } : null,
      modelText: res.output_text || null,
    });
    console.log(`${record.file}  ${dims.join('x')}  ${record.seconds}s`);
  } catch (err) {
    const msg = String(err && err.message ? err.message : err).replaceAll(key, '<key>');
    Object.assign(record, { status: 'error', error: msg.slice(0, 2000), seconds: Math.round((Date.now() - t0) / 100) / 10 });
    console.error(`${id} ${version} failed: ${msg.slice(0, 600)}`);
    process.exitCode = 1;
  }
  entry.versions.push(record);
  saveManifest(man);
  console.log(`budget: ${man.budget.generated}/${limit}`);
}

function mark(man, args) {
  const [id, version, status] = args._;
  const v = man.sheets[id] && man.sheets[id].versions.find((x) => x.version === version);
  if (!v || !['approved', 'rejected', 'final', 'draft'].includes(status)) throw new Error('usage: --mark <sheet> <vN> approved|rejected|final [--note "..."]');
  v.status = status;
  if (args.note) v.review = args.note;
  saveManifest(man);
  console.log(`${id} ${version} -> ${status}`);
}

const args = parseArgs(process.argv.slice(2));
const sheets = loadSheets();
const man = loadManifest();
if (args.list) {
  for (const s of Object.values(sheets)) {
    const vs = (man.sheets[s.id]?.versions || []).map((v) => `${v.version}:${v.size}:${v.status}`).join(' ');
    console.log(`${String(s.num).padStart(2)} ${s.id.padEnd(22)} refs=${[...ALWAYS_REFS, ...s.refs].length}${s.refSheets.length ? '+sheet ' + s.refSheets : ''}  ${vs}`);
  }
  console.log(`budget: ${man.budget.generated}/${man.budget.limit}`);
} else if (args.mark) mark(man, args);
else await generate(sheets, man, args).catch((e) => { console.error(e.message); process.exitCode = 1; });
