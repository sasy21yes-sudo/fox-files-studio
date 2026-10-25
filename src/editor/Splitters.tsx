import { useEffect, useState, type CSSProperties } from 'react';

/** Sizes of the editor's panels in px (null = the stylesheet's default). */
export interface PanelSizes {
  left: number | null;
  right: number | null;
  timeline: number | null;
}

const KEY = 'fox.studio.panels';
const LIMITS = {
  left: (w: number) => [160, Math.min(640, w * 0.4)] as const,
  right: (w: number) => [260, Math.min(900, w * 0.5)] as const,
  timeline: (_w: number, h: number) => [110, h - 260] as const,
};

function load(): PanelSizes {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<PanelSizes>;
    return { left: s.left ?? null, right: s.right ?? null, timeline: s.timeline ?? null };
  } catch {
    return { left: null, right: null, timeline: null };
  }
}

/** Panel sizes remembered in this browser, and the CSS variables that apply them to the editor grid. */
export function usePanelSizes() {
  const [sizes, setSizes] = useState<PanelSizes>(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(sizes));
    } catch {
      // private window or blocked storage: sizes just are not remembered
    }
  }, [sizes]);
  const style = {
    ...(sizes.left !== null ? { '--left-w': `${sizes.left}px` } : {}),
    ...(sizes.right !== null ? { '--right-w': `${sizes.right}px` } : {}),
    ...(sizes.timeline !== null ? { '--tl-h': `${sizes.timeline}px` } : {}),
  } as CSSProperties;
  return { sizes, setSizes, style };
}

/**
 * Drag handles on the edges between the editor's panels: the left column, the right column and the timeline.
 * Double-click a handle to put that panel back to its default size.
 */
export function Splitters({ setSizes }: { setSizes: (fn: (s: PanelSizes) => PanelSizes) => void }) {
  const drag = (which: keyof PanelSizes) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    el.classList.add('on');
    document.body.classList.add(which === 'timeline' ? 'resizing-v' : 'resizing-h');
    const move = (ev: PointerEvent) => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const raw = which === 'left' ? ev.clientX : which === 'right' ? w - ev.clientX : h - ev.clientY;
      const [lo, hi] = LIMITS[which](w, h);
      const v = Math.round(Math.max(lo, Math.min(hi, raw)));
      setSizes((s) => ({ ...s, [which]: v }));
    };
    const up = () => {
      el.classList.remove('on');
      document.body.classList.remove('resizing-v', 'resizing-h');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  const reset = (which: keyof PanelSizes) => () => setSizes((s) => ({ ...s, [which]: null }));
  return (
    <>
      <div className="split split-left" role="separator" aria-orientation="vertical" aria-label="Resize the left panel" title="Drag to resize · double-click: default" onPointerDown={drag('left')} onDoubleClick={reset('left')} />
      <div className="split split-right" role="separator" aria-orientation="vertical" aria-label="Resize the right panel" title="Drag to resize · double-click: default" onPointerDown={drag('right')} onDoubleClick={reset('right')} />
      <div className="split split-tl" role="separator" aria-orientation="horizontal" aria-label="Resize the timeline" title="Drag to resize · double-click: default" onPointerDown={drag('timeline')} onDoubleClick={reset('timeline')} />
    </>
  );
}
