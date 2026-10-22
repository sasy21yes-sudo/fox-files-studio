import { useState } from 'react';
import type { FoxDebug } from '../character/AgentFox';

const n = (v: unknown, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—');
const xy = (p?: [number, number]) => (p ? `${p[0].toFixed(0)}, ${p[1].toFixed(0)}` : '—');

/**
 * "Agent Fox — live": everything the rig computed for the frame at the playhead (any scene, data or
 * hand-coded): placement, body, arms, face, mouth and the canvas position of every joint. Joint
 * positions are preview-canvas px (960×540 or 540×960); turn on "Rig" under the preview to see them.
 */
export function FoxMonitor({ fox }: { fox: FoxDebug | null }) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem('fox-monitor-open') !== '0';
    } catch {
      return true;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem('fox-monitor-open', open ? '0' : '1');
    } catch {
      /* per-viewer convenience only */
    }
  };
  const p = fox?.pose;
  const f = fox?.face;
  const rows: [string, string][] = [];
  if (p) {
    rows.push(
      ['position', `${n(p.x, 0)}, ${n(p.y, 0)} px · scale ${n(p.scale)}`],
      ['facing', p.facing === -1 ? 'left' : 'right'],
      ['body', `walk ${n(p.walk)} · lean ${n(p.lean)} · jump ${n(p.jump, 0)} · squash ${n(p.squash)} · skid ${n(p.skid)}`],
      ['take / pop', `${n(p.surprise)} · ${p.pop ? `${p.pop.symbol} ${n(p.pop.p)}` : '—'}`],
      ['speaking', p.speaking ? `yes · viseme ${p.viseme ?? '—'}` : `no · mouth ${p.mouth ?? 'closed'}`],
      ['look', `x ${n(p.lookX)} · y ${n(p.lookY)}`],
      ['mood', `brows ${n(p.brows)} · worry ${n(p.worry)} · angry ${n(p.angry)} · skeptic ${n(p.skeptic)}`],
      ['head', `tilt ${n(p.headTilt)} · ears ${n(p.earDroop)} · hat ${n(p.hatLift)}`],
      ['eyes', `${p.eyes ?? 'open'} · lids ${n(p.lids)} · sweat ${n(p.sweat)} · sparkle ${n(p.sparkle)}`],
    );
    if (p.pointAngle !== undefined) rows.push(['point angle', `${n((p.pointAngle * 180) / Math.PI, 0)}°`]);
  }
  if (fox?.arms) {
    for (const side of ['near', 'far'] as const) {
      const a = fox.arms[side];
      rows.push([
        `${side} arm`,
        `${a.from === a.to ? a.to : `${a.from} → ${a.to} ${n(a.blend)}`} · hand ${a.hand} · ${a.layer}`,
      ]);
    }
  }
  if (f) {
    rows.push(
      ['lids (rig)', `${n(f.lid[0])} / ${n(f.lid[1])} · tilt ${n(f.lidTilt)} · squint ${n(f.squint)}`],
      ['pupils', `x ${n(f.lookX)} · y ${n(f.lookY)} · size ${n(f.pupil)} · eye scale ${n(f.eyeScale)}`],
      ['mouth sprite', `#${f.mouth}${f.happy ? ' · happy' : ''}${f.wink ? ' · wink' : ''}`],
    );
  }
  const joints = Object.entries(fox?.joints ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return (
    <section className={`ai-panel fox-monitor ${open ? 'open' : ''}`} aria-label="Agent Fox live values">
      <button className="ai-head" onClick={toggle} aria-expanded={open}>
        <span className="ai-spark" aria-hidden="true">🦊</span> Agent Fox — live
        <span className="chev">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="ai-body">
          {!p ? (
            <p className="help small">Agent Fox is not on screen at the playhead.</p>
          ) : (
            <>
              <dl className="fox-live">
                {rows.map(([k, v]) => (
                  <div key={k} style={{ display: 'contents' }}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <details>
                <summary className="muted small">Joints on the canvas ({joints.length})</summary>
                <dl className="fox-live">
                  {joints.map(([k, v]) => (
                    <div key={k} style={{ display: 'contents' }}>
                      <dt>{k.replace('_', ' ')}</dt>
                      <dd>{xy(v)}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </>
          )}
        </div>
      )}
    </section>
  );
}
