import { useRef, useState } from 'react';
import type { Project } from '../types';
import type { RenderProbe } from '../animation/stage';
import type { Num, SceneElement } from '../scene/spec';
import { updateElement, type Selection } from './model';

type Change = (fn: (p: Project) => Project, key?: string) => void;

interface Props {
  project: Project;
  probe: RenderProbe;
  /** Canvas pixel size (the renderer's w, h). */
  cw: number;
  ch: number;
  /** Where the canvas sits inside the frame, in CSS px. */
  rect: { left: number; top: number; width: number; height: number };
  selection: Selection;
  onSelect(s: Selection): void;
  onChange: Change;
}

/** Edit one format's value of a Num: a shared value becomes {h, v} so the other format does not move. */
export function setNumFor(old: Num | undefined, vertical: boolean, v: number): Num {
  v = Math.round(v * 10000) / 10000;
  if (typeof old === 'object') return { ...old, [vertical ? 'v' : 'h']: v };
  const other = old ?? v;
  return vertical ? { h: other, v } : { h: v, v: other };
}
const numOf = (n: Num | undefined, vertical: boolean, fallback = 0) => (n === undefined ? fallback : typeof n === 'number' ? n : vertical ? n.v : n.h);

type Mode = 'move' | 'scale' | 'rotate';
interface Drag {
  mode: Mode;
  id: string;
  pointer: number;
  sx: number;
  sy: number;
  /** Pivot on the canvas (the element's anchor). */
  px: number;
  py: number;
  x0: number;
  y0: number;
  s0: number;
  r0: number;
  a0: number;
  d0: number;
  key: string;
  inv: DOMMatrix;
  lockX: boolean;
}

/**
 * Direct manipulation over the preview, like a design tool: click anything drawn by a data scene to
 * select it (the smallest box under the pointer wins), drag inside its box to move it, drag a corner
 * to scale it around its anchor, drag the round handle above it to rotate it. Shift: move straight /
 * rotate in 15° steps. Values change in the format on screen only; each drag is one undo step.
 */
export function StageOverlay({ project, probe, cw, ch, rect, selection, onSelect, onChange }: Props) {
  const drag = useRef<Drag | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [live, setLive] = useState<string | null>(null);
  const scene = project.scenes[probe.scene];
  const spec = scene?.spec;
  if (!spec || !probe.matrix) return null;
  const cam = probe.matrix;
  const vertical = ch > cw;
  const px = cw / Math.max(1, rect.width); // canvas px per CSS px
  const byId = new Map<string, SceneElement>(spec.elements.map((e) => [e.id, e]));
  const selected = selection.kind === 'element' && selection.scene === probe.scene ? selection.id : null;

  const pivotOf = (a: RenderProbe['anchors'][number]) => (a.screen && probe.screen ? probe.screen : cam).transformPoint({ x: a.x, y: a.y });
  const boxOf = (a: RenderProbe['anchors'][number]): [number, number, number, number] => {
    if (a.bbox) return a.bbox;
    const p = pivotOf(a);
    return [p.x - 14, p.y - 14, p.x + 14, p.y + 14];
  };
  const toCanvas = (e: React.PointerEvent): [number, number] => {
    const r = (e.currentTarget as SVGElement).ownerSVGElement?.getBoundingClientRect() ?? (e.currentTarget as SVGElement).getBoundingClientRect();
    return [(e.clientX - r.left) * px, (e.clientY - r.top) * px];
  };

  const start = (e: React.PointerEvent, id: string, mode: Mode) => {
    e.stopPropagation();
    e.preventDefault();
    const a = probe.anchors.find((x) => x.id === id);
    const el = byId.get(id);
    if (!a || !el) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    onSelect({ kind: 'element', scene: probe.scene, id });
    const p = pivotOf(a);
    const [cx, cy] = toCanvas(e);
    drag.current = {
      mode,
      id,
      pointer: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      px: p.x,
      py: p.y,
      x0: numOf(el.x, vertical),
      y0: numOf(el.y, vertical),
      s0: numOf(el.scale, vertical, 1),
      r0: typeof el.rot === 'number' ? el.rot : 0,
      a0: Math.atan2(cy - p.y, cx - p.x),
      d0: Math.max(4, Math.hypot(cx - p.x, cy - p.y)),
      key: `drag:${id}:${Date.now()}`,
      inv: (a.screen && probe.screen ? probe.screen : cam).inverse(),
      // A walking fox's x comes from its path: only its ground line moves.
      lockX: el.type === 'fox' && !!(el as { xTrack?: unknown[] }).xTrack?.length,
    };
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    const [cx, cy] = toCanvas(e);
    if (d.mode === 'move') {
      let dx = (e.clientX - d.sx) * px;
      let dy = (e.clientY - d.sy) * px;
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      // Screen delta -> world delta (undo the camera's scale/rotation, not its translation).
      const w = d.inv.transformPoint({ x: dx, y: dy });
      const o = d.inv.transformPoint({ x: 0, y: 0 });
      const nx = d.x0 + (w.x - o.x) / cw;
      const ny = d.y0 + (w.y - o.y) / ch;
      setLive(`x ${nx.toFixed(3)} · y ${ny.toFixed(3)}`);
      onChange((p) => updateElement(p, probe.scene, d.id, (el) => ({ ...el, ...(d.lockX ? {} : { x: setNumFor(el.x, vertical, nx) }), y: setNumFor(el.y, vertical, ny) })), d.key);
    } else if (d.mode === 'scale') {
      const k = Math.max(0.05, Math.hypot(cx - d.px, cy - d.py) / d.d0);
      const ns = Math.max(0.05, Math.round(d.s0 * k * 100) / 100);
      setLive(`scale ${ns.toFixed(2)}`);
      onChange((p) => updateElement(p, probe.scene, d.id, (el) => ({ ...el, scale: setNumFor(el.scale, vertical, ns) })), d.key);
    } else {
      let r = d.r0 + Math.atan2(cy - d.py, cx - d.px) - d.a0;
      if (e.shiftKey) r = Math.round(r / (Math.PI / 12)) * (Math.PI / 12);
      r = Math.round(r * 1000) / 1000;
      setLive(`rotation ${((r * 180) / Math.PI).toFixed(0)}°`);
      onChange((p) => updateElement(p, probe.scene, d.id, (el) => ({ ...el, rot: r })), d.key);
    }
  };
  const end = () => {
    drag.current = null;
    setLive(null);
  };

  // Click on empty canvas area: pick the smallest element box under the pointer.
  const pick = (e: React.PointerEvent) => {
    const [x, y] = toCanvas(e);
    const hits = probe.anchors
      .filter((a) => byId.get(a.id) && !byId.get(a.id)!.hidden)
      .map((a) => ({ a, b: boxOf(a) }))
      .filter(({ b }) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3])
      .sort((p, q) => (p.b[2] - p.b[0]) * (p.b[3] - p.b[1]) - (q.b[2] - q.b[0]) * (q.b[3] - q.b[1]));
    if (!hits.length) return;
    start(e, hits[0].a.id, 'move');
  };

  const sel = selected ? probe.anchors.find((a) => a.id === selected) : undefined;
  const selEl = selected ? byId.get(selected) : undefined;
  const canRotate = !!selEl && selEl.type !== 'fox' && (selEl.rot === undefined || typeof selEl.rot === 'number');
  const hv = hover && hover !== selected ? probe.anchors.find((a) => a.id === hover) : undefined;
  const H = 6 * px;

  return (
    <svg
      className="stage-overlay"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height, pointerEvents: 'all' }}
      viewBox={`0 0 ${cw} ${ch}`}
      preserveAspectRatio="none"
      onPointerDown={pick}
      onPointerMove={(e) => {
        if (drag.current) return move(e);
        const [x, y] = toCanvas(e);
        const hit = probe.anchors
          .map((a) => ({ a, b: boxOf(a) }))
          .filter(({ b }) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3])
          .sort((p, q) => (p.b[2] - p.b[0]) * (p.b[3] - p.b[1]) - (q.b[2] - q.b[0]) * (q.b[3] - q.b[1]))[0];
        setHover(hit?.a.id ?? null);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerLeave={() => !drag.current && setHover(null)}
    >
      {hv && (() => {
        const b = boxOf(hv);
        const el = byId.get(hv.id);
        return (
          <g className="ov-hover">
            <rect x={b[0]} y={b[1]} width={b[2] - b[0]} height={b[3] - b[1]} className="ov-box" style={{ strokeWidth: 1.2 * px }} />
            <text x={b[0]} y={b[1] - 5 * px} className="ov-label" style={{ fontSize: 11 * px, strokeWidth: 3 * px }}>
              {(el?.label ?? el?.id ?? '').slice(0, 28)}
            </text>
          </g>
        );
      })()}
      {sel && selEl && (() => {
        const b = boxOf(sel);
        const p = pivotOf(sel);
        const corners: [number, number][] = [
          [b[0], b[1]],
          [b[2], b[1]],
          [b[2], b[3]],
          [b[0], b[3]],
        ];
        const topX = (b[0] + b[2]) / 2;
        const rotY = b[1] - 26 * px;
        return (
          <g className="ov-el on">
            <rect
              x={b[0]}
              y={b[1]}
              width={b[2] - b[0]}
              height={b[3] - b[1]}
              className="ov-sel"
              style={{ strokeWidth: 1.6 * px, cursor: 'move' }}
              onPointerDown={(e) => start(e, sel.id, 'move')}
            />
            {corners.map(([x, y], i) => (
              <rect
                key={i}
                x={x - H}
                y={y - H}
                width={H * 2}
                height={H * 2}
                className="ov-corner"
                style={{ strokeWidth: 1.4 * px, cursor: i % 2 ? 'nesw-resize' : 'nwse-resize' }}
                onPointerDown={(e) => start(e, sel.id, 'scale')}
              >
                <title>Drag to scale</title>
              </rect>
            ))}
            {canRotate && (
              <>
                <line x1={topX} y1={b[1]} x2={topX} y2={rotY} className="ov-box" style={{ strokeWidth: 1.2 * px }} />
                <circle cx={topX} cy={rotY} r={H} className="ov-rotate" style={{ strokeWidth: 1.4 * px, cursor: 'grab' }} onPointerDown={(e) => start(e, sel.id, 'rotate')}>
                  <title>Drag to rotate (Shift: 15° steps)</title>
                </circle>
              </>
            )}
            <circle cx={p.x} cy={p.y} r={3.5 * px} className="ov-pivot" style={{ strokeWidth: 1.2 * px }} />
            <text x={b[0]} y={b[3] + 14 * px} className="ov-label" style={{ fontSize: 11 * px, strokeWidth: 3 * px }}>
              {live ?? (selEl.label ?? selEl.id).slice(0, 28)}
            </text>
          </g>
        );
      })()}
    </svg>
  );
}
