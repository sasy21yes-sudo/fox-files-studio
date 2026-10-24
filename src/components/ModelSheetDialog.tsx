import { ClipLab } from '../editor/ClipLab';
import { useEffect, useRef, useState } from 'react';
import { RigTuner } from '../editor/RigTuner';
import { MouthLab } from '../editor/MouthLab';
import { SHEET_H, SHEET_W, drawModelSheet } from '../character/modelSheet';
import { loadCanvasFonts } from '../app/fonts';

/** Agent Fox model sheet, drawn live by the same rig the episode uses. */
export function ModelSheetDialog({ onClose }: { onClose(): void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tab, setTab] = useState<'sheet' | 'tune' | 'mouths' | 'clips'>('sheet');

  useEffect(() => {
    if (tab !== 'sheet') return;
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
  }, [tab]);

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
          <div className="segmented compact sheet-tabs">
            {(['sheet', 'tune', 'mouths', 'clips'] as const).map((k) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                {k === 'sheet' ? 'Sheet' : k === 'tune' ? 'Tune poses & motion' : k === 'mouths' ? 'Mouths' : 'Clips (frame by frame)'}
              </button>
            ))}
          </div>
          <div className="row gap">
            {tab === 'sheet' && (
              <button className="btn small" onClick={save}>
                Save PNG
              </button>
            )}
            {/* Pen tools over the drawings (dev server only): the traced face, the neck masks. */}
            <a className="btn small ghost" href="tracer.html" target="_blank" rel="noreferrer">
              Face tracer
            </a>
            <a className="btn small ghost" href="tracer.html?part=neck" target="_blank" rel="noreferrer">
              Neck masks
            </a>
            <a className="btn small ghost" href="tracer.html?part=eyes" target="_blank" rel="noreferrer">
              Eye editor
            </a>
            <button className="btn icon ghost" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </header>
        {tab === 'sheet' && (
          <>
            <canvas ref={ref} width={SHEET_W} height={SHEET_H} className="sheet-canvas" aria-label="Agent Fox model sheet: proportions, expressions, mouth chart, hands and key poses" />
            <p className="help">
              Everything on this sheet is drawn live by the episode’s character rig (painted puppet or vector rig, per Format &amp; look), so the animation always matches the model.
            </p>
          </>
        )}
        {tab === 'tune' && <RigTuner />}
        {tab === 'mouths' && <MouthLab />}
        {tab === 'clips' && <ClipLab />}
      </div>
    </div>
  );
}
