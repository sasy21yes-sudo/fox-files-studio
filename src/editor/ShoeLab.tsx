import { useEffect, useRef, useState } from 'react';
import { captureFox, drawFox, type FoxDebug, type FoxPose } from '../character/AgentFox';
import { setTweaks, tweaks, type RigTweaks, type ShoeTweak } from '../character/rig/tweaks';
import { Slider } from './RigTuner';

type Leg = 'near' | 'far';

/**
 * The Shoes tab of the model sheet: per leg, move the point where the shoe attaches under the trouser hem, resize
 * it and turn it, like the Hands tab does for the gloves. Saved with the other rig tweaks (tweaks.json "legs").
 */
export function ShoeLab() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [t, setT] = useState<RigTweaks>(() => structuredClone(tweaks()));
  const [leg, setLeg] = useState<Leg>('near');
  const [close, setClose] = useState(true);
  const [walk, setWalk] = useState(false);
  const [status, setStatus] = useState('');
  const [saved, setSaved] = useState(() => JSON.stringify(tweaks()));
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const dirty = JSON.stringify(t) !== saved;

  useEffect(() => setTweaks(t), [t]);
  useEffect(() => () => setTweaks(JSON.parse(savedRef.current)), []);

  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const sink: FoxDebug = { pose: null, face: null, arms: null, joints: {} };
    let rel: [number, number] | null = null;
    const draw = () => {
      const c = ref.current;
      const g = c?.getContext('2d');
      if (!c || !g) return;
      const time = (performance.now() - t0) / 1000;
      const scale = close ? 2.4 : 0.6;
      let x = c.width * 0.45;
      let y = c.height * 0.93;
      if (close && rel) {
        x = c.width / 2 - rel[0] * scale;
        y = c.height / 2 - rel[1] * scale;
      }
      const pose = {
        x,
        y,
        scale,
        time: walk ? time : 0.5,
        noShadow: close,
        walk: walk ? 1 : 0,
        walkPhase: time * Math.PI * 2 * 1.2,
        bounce: walk ? 1 : 0,
        lookX: 0.4,
      } as FoxPose;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#2a1d12';
      g.fillRect(0, 0, c.width, c.height);
      sink.joints = {};
      captureFox(sink);
      drawFox(g, pose);
      captureFox(null);
      const p = sink.joints[`shoe_${leg}`];
      if (p) {
        // Follow the shoe, but not every step of the walk (that would shake the view).
        if (!rel || !walk) rel = [(p[0] - x) / scale, (p[1] - y) / scale];
        g.strokeStyle = '#7fe0ff';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(p[0], p[1], 7, 0, Math.PI * 2);
        g.moveTo(p[0] - 14, p[1]);
        g.lineTo(p[0] + 14, p[1]);
        g.moveTo(p[0], p[1] - 14);
        g.lineTo(p[0], p[1] + 14);
        g.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [leg, close, walk]);

  const cur: ShoeTweak = t.legs?.[leg] ?? {};
  const anchor = cur.anchor ?? [0, 0];
  const patch = (p: Partial<ShoeTweak> | null, l: Leg = leg) =>
    setT((prev) => {
      const n = structuredClone(prev);
      n.legs ??= {};
      const merged: ShoeTweak = p === null ? {} : { ...(n.legs[l] ?? {}), ...p };
      for (const k of Object.keys(merged) as (keyof ShoeTweak)[]) if (merged[k] === undefined) delete merged[k];
      if (Object.keys(merged).length) n.legs[l] = merged;
      else delete n.legs[l];
      if (!Object.keys(n.legs).length) delete n.legs;
      return n;
    });
  const other: Leg = leg === 'near' ? 'far' : 'near';
  const legName = (l: Leg) => (l === 'near' ? 'Left leg (front)' : 'Right leg (back)');

  const save = async () => {
    setStatus('Saving…');
    try {
      const r = await fetch('/api/rig/tweaks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tweaks: t }) });
      if (!r.ok) throw new Error((await r.json()).error);
      setSaved(JSON.stringify(t));
      setStatus('Saved: every scene uses these shoes now.');
    } catch (e) {
      setStatus(`Not saved: ${e instanceof Error ? e.message : String(e)} (saving needs npm run dev)`);
    }
  };

  return (
    <div className="tuner">
      <div className="tuner-stage">
        <canvas ref={ref} width={420} height={640} className="tuner-canvas" />
        <div className="row gap wrap">
          <div className="segmented compact">
            {([true, false] as const).map((z) => (
              <button key={String(z)} className={close === z ? 'on' : ''} onClick={() => setClose(z)}>
                {z ? 'Shoe close-up' : 'Whole figure'}
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={walk} onChange={(e) => setWalk(e.target.checked)} /> Walk
          </label>
        </div>
        <p className="help small">The blue cross is the attach point: where the shoe hangs under the trouser hem.</p>
      </div>
      <div className="tuner-controls">
        <h3>Leg</h3>
        <div className="segmented compact">
          {(['near', 'far'] as const).map((l) => (
            <button key={l} className={leg === l ? 'on' : ''} onClick={() => setLeg(l)}>
              {legName(l)}
              {t.legs?.[l] ? ' •' : ''}
            </button>
          ))}
        </div>

        <h3>Shoe</h3>
        <Slider label="Size" value={cur.shoeScale ?? 1} def={1} min={0.5} max={1.8} step={0.01} onChange={(v) => patch({ shoeScale: v })} />
        <Slider label="Turn (rad)" value={cur.shoeTurn ?? 0} def={0} min={-1.2} max={1.2} step={0.01} onChange={(v) => patch({ shoeTurn: v })} />

        <h3>Attach point</h3>
        <p className="help small">Moves the shoe against the end of the trouser leg, in the drawing's own px (along the foot / up and down).</p>
        <Slider label="Along the foot" value={anchor[0]} def={0} min={-150} max={150} step={1} onChange={(v) => patch({ anchor: v === undefined && !anchor[1] ? undefined : [v ?? 0, anchor[1]] })} />
        <Slider label="Up / down" value={anchor[1]} def={0} min={-150} max={150} step={1} onChange={(v) => patch({ anchor: v === undefined && !anchor[0] ? undefined : [anchor[0], v ?? 0] })} />

        <div className="row gap wrap" style={{ marginTop: 8 }}>
          <button className="btn small ghost" onClick={() => patch({ ...cur }, other)}>
            Copy to the {other === 'near' ? 'left' : 'right'} leg
          </button>
          <button className="btn small ghost" onClick={() => patch(null)}>
            Reset this shoe
          </button>
        </div>

        <div className="row gap" style={{ marginTop: 14 }}>
          <button className="btn primary" disabled={!dirty} onClick={() => void save()}>
            Save shoes
          </button>
          <button className="btn ghost" disabled={!dirty} onClick={() => setT(JSON.parse(saved))}>
            Discard
          </button>
          <span className="muted small">{status}</span>
        </div>
      </div>
    </div>
  );
}
