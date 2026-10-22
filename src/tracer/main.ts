/**
 * Face tracer (tracer.html, dev server only): a Photoshop-style pen for Agent Fox's eye, brow and
 * line shapes, drawn over the master drawing. Shapes are cubic Bézier paths (anchors with in/out
 * handles); tools/trace_face.py samples them when it rebuilds src/character/rig/masterFace.ts.
 *
 * Tools: Pen (P) — click: corner anchor, click-drag: smooth anchor, click the first anchor: close,
 * click a segment: add an anchor, click an anchor: delete it, Alt+click/drag an anchor: convert.
 * Direct selection (A) — drag anchors and handles (handles stay aligned; Alt breaks them),
 * Shift+click: add to selection, arrows: nudge, Delete: remove. Move (V) — drag the whole shape.
 * Space+drag or middle button: pan; wheel: zoom; Ctrl+Z / Ctrl+Shift+Z: undo / redo.
 */
import { drawFox } from '../character/AgentFox';
import { loadRig } from '../character/rig/rigPuppet';

type Pt = [number, number];
interface Anchor {
  p: Pt;
  i: Pt | null;
  o: Pt | null;
  /** Smooth anchors keep their two handles in line. */
  smooth: boolean;
}
interface Path {
  closed: boolean;
  a: Anchor[];
}
type Tool = 'pen' | 'direct' | 'move';

const DEFS: { key: string; label: string; color: string; closed: boolean }[] = [
  { key: 'near.silhouette', label: 'Left eye — outer black outline', color: '#ff3df5', closed: true },
  { key: 'near.white', label: 'Left eye — white', color: '#3dfcff', closed: true },
  { key: 'near.pupil', label: 'Left eye — pupil', color: '#ff4040', closed: true },
  { key: 'far.silhouette', label: 'Right eye — outer black outline', color: '#ff3df5', closed: true },
  { key: 'far.white', label: 'Right eye — white', color: '#3dfcff', closed: true },
  { key: 'far.pupil', label: 'Right eye — pupil', color: '#ff4040', closed: true },
  { key: 'brow.near', label: 'Left brow', color: '#ffe23d', closed: true },
  { key: 'brow.far', label: 'Right brow', color: '#ffe23d', closed: true },
  { key: 'far.underline', label: 'Line under the right eye', color: '#ff9a2e', closed: false },
];

const canvas = document.getElementById('c') as HTMLCanvasElement;
const g = canvas.getContext('2d')!;
const status = document.getElementById('status')!;
const img = new Image();
let paths: Record<string, Path> = {};
let auto: Record<string, Path> = {};
let sel = sessionStorage.getItem('tracer.sel') ?? DEFS[0].key;
let tool: Tool = (sessionStorage.getItem('tracer.tool') as Tool) ?? 'pen';
let picked = new Set<number>();
let space = false;
const view = JSON.parse(sessionStorage.getItem('tracer.view') ?? 'null') ?? { s: 1, x: 0, y: 0, fitted: false };
const undo: string[] = [];
const redo: string[] = [];

const def = (k: string) => DEFS.find((d) => d.key === k)!;
const cur = (): Path => (paths[sel] ??= { closed: false, a: [] });
const toScreen = ([x, y]: Pt): Pt => [x * view.s + view.x, y * view.s + view.y];
const toImage = (x: number, y: number): Pt => [(x - view.x) / view.s, (y - view.y) / view.s];
const saveView = () => sessionStorage.setItem('tracer.view', JSON.stringify(view));
const r1 = (v: number) => Math.round(v * 10) / 10;
const pt = (x: number, y: number): Pt => [r1(x), r1(y)];
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const mirror = (p: Pt, h: Pt): Pt => pt(2 * p[0] - h[0], 2 * p[1] - h[1]);
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function snapshot() {
  undo.push(JSON.stringify(paths));
  if (undo.length > 300) undo.shift();
  redo.length = 0;
}

// ------------------------------------------------------------------ geometry

/** Control points of segment k (from anchor k to the next). */
function seg(P: Path, k: number): [Pt, Pt, Pt, Pt] {
  const a = P.a[k];
  const b = P.a[(k + 1) % P.a.length];
  return [a.p, a.o ?? a.p, b.i ?? b.p, b.p];
}
const nSeg = (P: Path) => (P.closed ? P.a.length : Math.max(0, P.a.length - 1));
function bez([p0, p1, p2, p3]: [Pt, Pt, Pt, Pt], t: number): Pt {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

function tracePath(P: Path) {
  if (!P.a.length) return;
  const s0 = toScreen(P.a[0].p);
  g.beginPath();
  g.moveTo(s0[0], s0[1]);
  for (let k = 0; k < nSeg(P); k++) {
    const [, c1, c2, p3] = seg(P, k).map(toScreen) as [Pt, Pt, Pt, Pt];
    g.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], p3[0], p3[1]);
  }
  if (P.closed) g.closePath();
}

/** Nearest point on the path to a screen point: segment, t and screen distance. */
function onPath(P: Path, sx: number, sy: number) {
  let best = { k: -1, t: 0, d: Infinity };
  for (let k = 0; k < nSeg(P); k++) {
    const S = seg(P, k);
    for (let j = 0; j <= 60; j++) {
      const q = toScreen(bez(S, j / 60));
      const d = Math.hypot(q[0] - sx, q[1] - sy);
      if (d < best.d) best = { k, t: j / 60, d };
    }
  }
  return best;
}

/** Split segment k at t (de Casteljau): the curve keeps its exact shape. */
function splitAt(P: Path, k: number, t: number): number {
  const [p0, p1, p2, p3] = seg(P, k);
  const l = (a: Pt, b: Pt): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const a1 = l(p0, p1);
  const b1 = l(p1, p2);
  const c1 = l(p2, p3);
  const a2 = l(a1, b1);
  const b2 = l(b1, c1);
  const m = l(a2, b2);
  const A = P.a[k];
  const B = P.a[(k + 1) % P.a.length];
  A.o = pt(...a1);
  B.i = pt(...c1);
  const N: Anchor = { p: pt(...m), i: pt(...a2), o: pt(...b2), smooth: true };
  P.a.splice(k + 1, 0, N);
  return k + 1;
}

/** Point lists (older traces) become smooth Bézier anchors (Catmull-Rom tangents). */
function fromPoints(pts: Pt[], closed: boolean, max = 12): Path {
  let P = pts;
  if (P.length > max) {
    const step = P.length / max;
    P = Array.from({ length: max }, (_, i) => P[Math.floor(i * step)]);
  }
  const n = P.length;
  const a: Anchor[] = P.map((p, i) => {
    const prev = P[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const next = P[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const tx = (next[0] - prev[0]) / 6;
    const ty = (next[1] - prev[1]) / 6;
    return { p: pt(p[0], p[1]), i: pt(p[0] - tx, p[1] - ty), o: pt(p[0] + tx, p[1] + ty), smooth: true };
  });
  return { closed, a };
}
const asPath = (v: unknown, closed: boolean): Path =>
  Array.isArray(v) ? fromPoints(v as Pt[], closed) : (structuredClone(v) as Path);

// ------------------------------------------------------------------ drawing

function draw() {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(r.width * dpr)) {
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#0d0b09';
  g.fillRect(0, 0, r.width, r.height);
  if (img.complete && img.naturalWidth) {
    g.globalAlpha = Number((document.getElementById('opacity') as HTMLInputElement).value);
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, view.x, view.y, img.naturalWidth * view.s, img.naturalHeight * view.s);
    g.globalAlpha = 1;
  }
  const others = (document.getElementById('others') as HTMLInputElement).checked;
  const fill = (document.getElementById('fill') as HTMLInputElement).checked;
  for (const d of DEFS) {
    const P = paths[d.key];
    if (!P?.a.length || (!others && d.key !== sel)) continue;
    const on = d.key === sel;
    tracePath(P);
    if (fill && P.closed) {
      g.fillStyle = d.color + '40';
      g.fill();
    }
    g.strokeStyle = d.color;
    g.globalAlpha = on ? 1 : 0.45;
    g.lineWidth = on ? 1.6 : 1.1;
    g.stroke();
    g.globalAlpha = 1;
  }
  // Anchors and handles of the active path.
  const P = paths[sel];
  if (!P?.a.length) return;
  const show = new Set<number>();
  const n = P.a.length;
  picked.forEach((i) => {
    show.add(i);
    if (P.closed || i > 0) show.add((i - 1 + n) % n);
    if (P.closed || i < n - 1) show.add((i + 1) % n);
  });
  if (tool === 'pen' && !P.closed) show.add(n - 1);
  show.forEach((i) => {
    const A = P.a[i];
    if (!A) return;
    const s = toScreen(A.p);
    for (const h of [A.i, A.o]) {
      if (!h) continue;
      const q = toScreen(h);
      g.strokeStyle = '#9fd0ff';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(s[0], s[1]);
      g.lineTo(q[0], q[1]);
      g.stroke();
      g.beginPath();
      g.arc(q[0], q[1], 3.5, 0, Math.PI * 2);
      g.fillStyle = '#9fd0ff';
      g.fill();
    }
  });
  P.a.forEach((A, i) => {
    const s = toScreen(A.p);
    const on = picked.has(i);
    g.fillStyle = on ? '#1e90ff' : '#ffffff';
    g.strokeStyle = '#1e90ff';
    g.lineWidth = 1.5;
    if (A.smooth) {
      g.beginPath();
      g.arc(s[0], s[1], 4.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    } else {
      g.fillRect(s[0] - 4, s[1] - 4, 8, 8);
      g.strokeRect(s[0] - 4, s[1] - 4, 8, 8);
    }
    if (i === 0 && !P.closed && tool === 'pen') {
      g.beginPath();
      g.arc(s[0], s[1], 8, 0, Math.PI * 2);
      g.stroke();
    }
  });
}

function renderUI() {
  const box = document.getElementById('shapes')!;
  box.innerHTML = '';
  DEFS.forEach((d, i) => {
    const b = document.createElement('button');
    b.className = `shape ${d.key === sel ? 'on' : ''}`;
    b.innerHTML = `<i style="background:${d.color}"></i>${d.label}<kbd>${i + 1}</kbd>`;
    b.onclick = () => select(d.key);
    box.appendChild(b);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
  canvas.style.cursor = space ? 'grab' : tool === 'move' ? 'move' : tool === 'direct' ? 'default' : 'crosshair';
}

function select(k: string) {
  sel = k;
  picked = new Set();
  sessionStorage.setItem('tracer.sel', k);
  renderUI();
  draw();
}
function setTool(t: Tool) {
  tool = t;
  sessionStorage.setItem('tracer.tool', t);
  renderUI();
  draw();
}

// ------------------------------------------------------------------ interaction

type Drag =
  | { kind: 'pan'; sx: number; sy: number; x0: number; y0: number }
  | { kind: 'anchors'; start: Pt; orig: Anchor[]; moved: boolean }
  | { kind: 'handle'; i: number; which: 'i' | 'o'; alt: boolean }
  | { kind: 'pull'; i: number; moved: boolean; convert: boolean }
  | { kind: 'shape'; start: Pt; orig: Anchor[] };
let drag: Drag | null = null;

function hitAnchor(P: Path, sx: number, sy: number): number {
  let best = -1;
  let bd = 8;
  P.a.forEach((A, i) => {
    const s = toScreen(A.p);
    const d = Math.hypot(s[0] - sx, s[1] - sy);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}
function hitHandle(P: Path, sx: number, sy: number): { i: number; which: 'i' | 'o' } | null {
  const n = P.a.length;
  const visible = new Set<number>();
  picked.forEach((i) => [i, (i - 1 + n) % n, (i + 1) % n].forEach((j) => visible.add(j)));
  if (tool === 'pen' && !P.closed) visible.add(n - 1);
  for (const i of visible) {
    const A = P.a[i];
    for (const which of ['o', 'i'] as const) {
      const h = A?.[which];
      if (h && dist(toScreen(h), [sx, sy]) < 7) return { i, which };
    }
  }
  return null;
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  const r = canvas.getBoundingClientRect();
  const sx = e.clientX - r.left;
  const sy = e.clientY - r.top;
  const m = toImage(sx, sy);
  canvas.setPointerCapture(e.pointerId);
  if (space || e.button === 1) {
    drag = { kind: 'pan', sx, sy, x0: view.x, y0: view.y };
    return;
  }
  if (e.button !== 0) return;
  const P = cur();
  if (tool === 'move') {
    snapshot();
    drag = { kind: 'shape', start: m, orig: structuredClone(P.a) };
    return;
  }
  const h = hitHandle(P, sx, sy);
  if (h) {
    snapshot();
    drag = { kind: 'handle', i: h.i, which: h.which, alt: e.altKey };
    return;
  }
  const ai = hitAnchor(P, sx, sy);
  if (tool === 'pen') {
    if (ai >= 0 && e.altKey) {
      // Convert: click = corner (no handles), drag = new smooth handles.
      snapshot();
      picked = new Set([ai]);
      drag = { kind: 'pull', i: ai, moved: false, convert: true };
      return;
    }
    if (ai === 0 && !P.closed && P.a.length >= 2 && def(sel).closed) {
      snapshot();
      P.closed = true;
      picked = new Set([0]);
      drag = { kind: 'pull', i: 0, moved: false, convert: false };
      draw();
      return;
    }
    if (ai >= 0) {
      // Pen on an anchor deletes it (Photoshop's auto add/delete).
      if (P.a.length > 2) {
        snapshot();
        P.a.splice(ai, 1);
        picked = new Set();
        draw();
      }
      return;
    }
    const near = onPath(P, sx, sy);
    if (near.d < 6) {
      snapshot();
      picked = new Set([splitAt(P, near.k, near.t)]);
      draw();
      return;
    }
    if (P.closed) {
      status.textContent = 'This path is closed: click a segment to add an anchor, or use Direct selection (A).';
      return;
    }
    snapshot();
    P.a.push({ p: pt(m[0], m[1]), i: null, o: null, smooth: false });
    picked = new Set([P.a.length - 1]);
    drag = { kind: 'pull', i: P.a.length - 1, moved: false, convert: false };
    draw();
    return;
  }
  // Direct selection.
  if (ai >= 0) {
    if (e.altKey) {
      snapshot();
      picked = new Set([ai]);
      drag = { kind: 'pull', i: ai, moved: false, convert: true };
      return;
    }
    if (e.shiftKey) {
      if (picked.has(ai)) picked.delete(ai);
      else picked.add(ai);
    } else if (!picked.has(ai)) picked = new Set([ai]);
    snapshot();
    drag = { kind: 'anchors', start: m, orig: structuredClone(P.a), moved: false };
    draw();
    return;
  }
  picked = new Set();
  draw();
  drag = { kind: 'pan', sx, sy, x0: view.x, y0: view.y };
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const r = canvas.getBoundingClientRect();
  const sx = e.clientX - r.left;
  const sy = e.clientY - r.top;
  const m = toImage(sx, sy);
  const P = cur();
  if (drag.kind === 'pan') {
    view.x = drag.x0 + sx - drag.sx;
    view.y = drag.y0 + sy - drag.sy;
    saveView();
  } else if (drag.kind === 'shape') {
    const d = sub(m, drag.start);
    P.a = drag.orig.map((A) => ({ ...A, p: pt(...add(A.p, d)), i: A.i && pt(...add(A.i, d)), o: A.o && pt(...add(A.o, d)) }));
  } else if (drag.kind === 'anchors') {
    const d = sub(m, drag.start);
    drag.moved = true;
    for (const i of picked) {
      const A0 = drag.orig[i];
      P.a[i] = { ...A0, p: pt(...add(A0.p, d)), i: A0.i && pt(...add(A0.i, d)), o: A0.o && pt(...add(A0.o, d)) };
    }
  } else if (drag.kind === 'handle') {
    const A = P.a[drag.i];
    const h = pt(m[0], m[1]);
    A[drag.which] = h;
    const other = drag.which === 'o' ? 'i' : 'o';
    if (e.altKey || drag.alt) A.smooth = false;
    else if (A.smooth && A[other]) {
      // Keep the opposite handle in line, with its own length.
      const v = sub(A.p, h);
      const l = Math.hypot(v[0], v[1]) || 1;
      const len = dist(A.p, A[other]!);
      A[other] = pt(A.p[0] + (v[0] / l) * len, A.p[1] + (v[1] / l) * len);
    }
  } else if (drag.kind === 'pull') {
    const A = P.a[drag.i];
    if (dist(toScreen(A.p), [sx, sy]) > 3) drag.moved = true;
    if (drag.moved) {
      // Drag from an anchor pulls symmetric handles (the out handle follows the mouse).
      A.o = pt(m[0], m[1]);
      A.i = mirror(A.p, A.o);
      A.smooth = true;
    }
  }
  draw();
});

canvas.addEventListener('pointerup', () => {
  if (drag?.kind === 'pull' && !drag.moved && drag.convert) {
    const A = cur().a[drag.i];
    A.i = null;
    A.o = null;
    A.smooth = false;
    draw();
  }
  drag = null;
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const s = Math.min(16, Math.max(0.3, view.s * Math.exp(-e.deltaY * 0.0015)));
    view.x = sx - ((sx - view.x) * s) / view.s;
    view.y = sy - ((sy - view.y) * s) / view.s;
    view.s = s;
    saveView();
    draw();
  },
  { passive: false },
);

window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
    e.preventDefault();
    const back = e.key.toLowerCase() === 'y' || e.shiftKey;
    const from = back ? redo : undo;
    const to = back ? undo : redo;
    const s = from.pop();
    if (s) {
      to.push(JSON.stringify(paths));
      paths = JSON.parse(s);
      picked = new Set();
      draw();
    }
    return;
  }
  if (e.key === ' ' && !space) {
    space = true;
    renderUI();
    e.preventDefault();
    return;
  }
  const P = cur();
  if ((e.key === 'Delete' || e.key === 'Backspace') && picked.size) {
    snapshot();
    P.a = P.a.filter((_, i) => !picked.has(i));
    if (P.a.length < 3 && P.closed) P.closed = false;
    picked = new Set();
    draw();
    return;
  }
  if (e.key.startsWith('Arrow') && picked.size) {
    e.preventDefault();
    snapshot();
    const step = (e.shiftKey ? 5 : 0.5) ;
    const d: Pt = e.key === 'ArrowLeft' ? [-step, 0] : e.key === 'ArrowRight' ? [step, 0] : e.key === 'ArrowUp' ? [0, -step] : [0, step];
    for (const i of picked) {
      const A = P.a[i];
      P.a[i] = { ...A, p: pt(...add(A.p, d)), i: A.i && pt(...add(A.i, d)), o: A.o && pt(...add(A.o, d)) };
    }
    draw();
    return;
  }
  if (e.key === 'Escape') {
    picked = new Set();
    draw();
    return;
  }
  const k = e.key.toLowerCase();
  if (k === 'p') setTool('pen');
  else if (k === 'a') setTool('direct');
  else if (k === 'v') setTool('move');
  const n = Number(e.key);
  if (n >= 1 && n <= DEFS.length) select(DEFS[n - 1].key);
});
window.addEventListener('keyup', (e) => {
  if (e.key === ' ') {
    space = false;
    renderUI();
  }
});
for (const id of ['opacity', 'others', 'fill']) document.getElementById(id)!.addEventListener('input', draw);
window.addEventListener('resize', draw);
document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool as Tool)));

document.getElementById('reset')!.addEventListener('click', () => {
  if (!auto[sel]) return;
  snapshot();
  paths[sel] = structuredClone(auto[sel]);
  picked = new Set();
  draw();
});
document.getElementById('clear')!.addEventListener('click', () => {
  snapshot();
  paths[sel] = { closed: false, a: [] };
  picked = new Set();
  setTool('pen');
});
document.getElementById('save')!.addEventListener('click', async () => {
  status.className = 'help';
  status.textContent = 'Saving and rebuilding the face…';
  try {
    const r = await fetch('/api/trace/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shapes: paths }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    status.textContent = 'Saved. The face is rebuilt (the page reloads with it).';
  } catch (err) {
    status.className = 'help err';
    status.textContent = `Not saved: ${err instanceof Error ? err.message : String(err)}`;
  }
});

/** Agent Fox's head with the current (saved) shapes. */
async function preview() {
  await loadRig();
  const c = document.getElementById('preview') as HTMLCanvasElement;
  const pg = c.getContext('2d')!;
  pg.fillStyle = '#18e018';
  pg.fillRect(0, 0, c.width, c.height);
  drawFox(pg, { x: 250, y: 1560, scale: 2.9, time: 1, noShadow: true, armFront: 'rest', armBack: 'rest', lookX: 0.25, lookY: 0.45 });
}

async function start() {
  const r = await fetch('/api/trace/shapes');
  const j = (await r.json()) as { shapes: Record<string, unknown>; auto: Record<string, unknown>; source: string };
  for (const d of DEFS) {
    if (j.shapes[d.key]) paths[d.key] = asPath(j.shapes[d.key], d.closed);
    if (j.auto[d.key]) auto[d.key] = asPath(j.auto[d.key], d.closed);
  }
  status.textContent = j.source === 'manual' ? 'Your saved shapes are loaded.' : 'Starting from the automatic trace.';
  img.onload = () => {
    if (!view.fitted) {
      const rr = canvas.getBoundingClientRect();
      view.s = Math.min(rr.width / img.naturalWidth, rr.height / img.naturalHeight) * 0.95;
      view.x = (rr.width - img.naturalWidth * view.s) / 2;
      view.y = (rr.height - img.naturalHeight * view.s) / 2;
      view.fitted = true;
      saveView();
    }
    draw();
  };
  img.src = '/api/trace/image';
  renderUI();
  void preview();
}
void start();
