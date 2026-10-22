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
const numOf = (n: Num | undefined, vertical: boolean) => (n === undefined ? 0 : typeof n === 'number' ? n : vertical ? n.v : n.h);

interface Drag {
  id: string;
  pointer: number;
  sx: number;
  sy: number;
  x0: number;
  y0: number;
  key: string;
  inv: DOMMatrix;
  lockX: boolean;
}

/**
 * Handles drawn over the preview for the elements of the data scene on screen:
 * click one to select it, drag it to move it (in the format being edited;
 * Shift locks the direction). Each drag is one undo step.
 */
export function StageOverlay({ project, probe, cw, ch, rect, selection, onSelect, onChange }: Props) {
  const drag = useRef<Drag | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const scene = project.scenes[probe.scene];
  const spec = scene?.spec;
  if (!spec || !probe.matrix) return null;
  const cam = probe.matrix;
  const vertical = ch > cw;
  const px = cw / Math.max(1, rect.width); // canvas px per CSS px
  const byId = new Map<string, SceneElement>(spec.elements.map((e) => [e.id, e]));
  const selected = selection.kind === 'element' && selection.scene === probe.scene ? selection.id : null;

  const move = (e: React.PointerEvent, d: Drag) => {
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
    onChange(
      (p) =>
        updateElement(p, probe.scene, d.id, (el) => ({
          ...el,
          ...(d.lockX ? {} : { x: setNumFor(el.x, vertical, nx) }),
          y: setNumFor(el.y, vertical, ny),
        })),
      d.key,
    );
  };

  return (
    <svg
      className="stage-overlay"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      viewBox={`0 0 ${cw} ${ch}`}
      preserveAspectRatio="none"
    >
      {probe.anchors.map((a) => {
        const el = byId.get(a.id);
        if (!el || el.hidden) return null;
        const m = a.screen && probe.screen ? probe.screen : cam;
        const p = m.transformPoint({ x: a.x, y: a.y });
        const on = a.id === selected;
        const box = a.box
          ? [
              [-1, -1],
              [1, -1],
              [1, 1],
              [-1, 1],
            ]
              .map(([sx, sy]) => {
                const c = Math.cos(a.box!.rot);
                const s = Math.sin(a.box!.rot);
                const lx = (sx * a.box!.w) / 2;
                const ly = (sy * a.box!.h) / 2;
                const q = m.transformPoint({ x: a.x + lx * c - ly * s, y: a.y + lx * s + ly * c });
                return `${q.x},${q.y}`;
              })
              .join(' ')
          : null;
        const full = el.label ?? el.id;
        const label = full.length > 28 ? `${full.slice(0, 26)}…` : full;
        return (
          <g key={a.id} className={`ov-el ${on ? 'on' : ''}`}>
            {box && (on || hover === a.id) && <polygon points={box} className="ov-box" style={{ strokeWidth: 1.5 * px }} />}
            <circle
              cx={p.x}
              cy={p.y}
              r={(on ? 8 : 6) * px}
              className="ov-handle"
              style={{ strokeWidth: 2 * px }}
              onPointerEnter={() => setHover(a.id)}
              onPointerLeave={() => setHover(null)}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                (e.target as Element).setPointerCapture(e.pointerId);
                onSelect({ kind: 'element', scene: probe.scene, id: a.id });
                drag.current = {
                  id: a.id,
                  pointer: e.pointerId,
                  sx: e.clientX,
                  sy: e.clientY,
                  x0: numOf(el.x, vertical),
                  y0: numOf(el.y, vertical),
                  key: `drag:${a.id}:${Date.now()}`,
                  inv: m.inverse(),
                  // A walking fox's x comes from its path: only its ground line moves.
                  lockX: el.type === 'fox' && !!(el as { xTrack?: unknown[] }).xTrack?.length,
                };
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (d && d.pointer === e.pointerId) move(e, d);
              }}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
            >
              <title>{`${full} — drag to move (Shift: straight)`}</title>
            </circle>
            {(on || hover === a.id) && (
              <text x={p.x + 12 * px} y={p.y - 10 * px} className="ov-label" style={{ fontSize: 12 * px, strokeWidth: 3 * px }}>
                {label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
