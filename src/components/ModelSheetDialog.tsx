import { useEffect, useRef } from 'react';
import { SHEET_H, SHEET_W, drawModelSheet } from '../character/modelSheet';
import { loadCanvasFonts } from '../app/fonts';

/** Agent Fox model sheet, drawn live by the same rig the episode uses. */
export function ModelSheetDialog({ onClose }: { onClose(): void }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    let alive = true;
    const t0 = performance.now();
    const draw = () => {
      const g = ref.current?.getContext('2d');
      if (!g || !alive) return;
      drawModelSheet(g, 0.4 + (performance.now() - t0) / 1000);
      raf = requestAnimationFrame(draw);
    };
    void loadCanvasFonts().then(() => alive && draw());
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  const save = () => {
    const c = ref.current;
    if (!c) return;
    c.toBlob((b) => {
      if (!b) return;
      const url = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'agent-fox-model-sheet.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, 'image/png');
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="sheet-title" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal sheet-modal">
        <header className="modal-head">
          <h2 id="sheet-title">Agent Fox · model sheet</h2>
          <div className="row gap">
            <button className="btn small" onClick={save}>
              Save PNG
            </button>
            <button className="btn icon ghost" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </header>
        <canvas ref={ref} width={SHEET_W} height={SHEET_H} className="sheet-canvas" aria-label="Agent Fox model sheet: proportions, expressions, mouth chart, hands and key poses" />
        <p className="help">
          Everything on this sheet is drawn live by the episode’s character rig (painted puppet or vector rig, per Format &amp; look), so the animation always matches the model.
        </p>
      </div>
    </div>
  );
}
