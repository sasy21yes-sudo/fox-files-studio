import { useEffect, useRef, useState } from 'react';
import { builtInArm, drawFox, type ArmMode, type FoxPose } from '../character/AgentFox';
import { ARM_MODES } from '../scene/elements';
import { FACE_DEFAULTS, MOTION_DEFAULTS, setTweaks, tweaks, type ArmTweak, type RigTweaks } from '../character/rig/tweaks';

/** Default hand targets etc. are in AgentFox.ts; the tuner only stores what you change. */
const NEAR_ONLY: ArmMode[] = ['chin', 'hatChest', 'hold', 'scratch'];
const LAYERS = ['behind', 'front', 'over'] as const;
const MOODS: Record<string, Partial<FoxPose>> = {
  neutral: {},
  angry: { angry: 1 },
  worried: { worry: 1, brows: 0.4 },
  skeptic: { skeptic: 1 },
  surprised: { surprise: 0.8 },
  happy: { eyes: 'happy', mouth: 'smile' },
};
const MOTION_LABELS: Record<keyof typeof MOTION_DEFAULTS, [string, number, number, number]> = {
  bounce: ['Beat bounce', 0, 2, 0.05],
  walkStride: ['Walk stride', 0, 60, 1],
  armSwing: ['Arm swing (walk)', 0, 70, 1],
  tailWag: ['Tail wag', 0, 120, 1],
  tailSpeed: ['Tail speed', 0.5, 6, 0.1],
  headSway: ['Head sway (idle)', 0, 3, 0.05],
  talkNod: ['Nod while talking', 0, 3, 0.05],
  spineSway: ['Body sway', 0, 3, 0.05],
  blinkPeriod: ['Seconds between blinks', 1, 8, 0.1],
  blinkLength: ['Blink length (s)', 0.08, 0.5, 0.01],
};
const FACE_LABELS: Record<keyof typeof FACE_DEFAULTS, [string, number, number, number]> = {
  browRaise: ['Brows: raise / surprise', 0, 0.4, 0.01],
  browAngry: ['Brows: angry (inner down)', 0, 0.8, 0.01],
  browWorry: ['Brows: worried (inner up)', 0, 0.6, 0.01],
  browSkeptic: ['Brows: skeptic', 0, 0.5, 0.01],
  lidTilt: ['Lids: angry / worried slant', 0, 0.6, 0.01],
  squint: ['Lids: squint', 0, 1, 0.01],
  pupil: ['Pupil size', 0.5, 1.6, 0.01],
  eyeScale: ['Eye size', 0.7, 1.4, 0.01],
};

function Slider({ label, value, def, min, max, step, onChange }: { label: string; value: number; def: number; min: number; max: number; step: number; onChange(v: number | undefined): void }) {
  return (
    <label className="tune-row">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <code>{value.toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0)}</code>
      <button className="btn small ghost" disabled={value === def} onClick={() => onChange(undefined)} title="Back to default">
        ↺
      </button>
    </label>
  );
}

/** Live Agent Fox preview with pose, motion and expression controls; Save writes tweaks.json. */
export function RigTuner() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [t, setT] = useState<RigTweaks>(() => structuredClone(tweaks()));
  const [arm, setArm] = useState<{ mode: ArmMode; side: 'near' | 'far' }>({ mode: 'point', side: 'far' });
  const [mood, setMood] = useState('neutral');
  const [walk, setWalk] = useState(false);
  const [talk, setTalk] = useState(false);
  const [zoom, setZoom] = useState<'body' | 'face'>('body');
  const [status, setStatus] = useState('');
  const [saved, setSaved] = useState(() => JSON.stringify(tweaks()));
  const dirty = JSON.stringify(t) !== saved;
  // Leaving without saving puts the saved values back.
  useEffect(() => () => setTweaks(JSON.parse(savedRef.current)), []);
  const savedRef = useRef(saved);
  savedRef.current = saved;

  useEffect(() => setTweaks(t), [t]);

  // Live preview.
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const draw = () => {
      const c = ref.current;
      const g = c?.getContext('2d');
      if (!c || !g) return;
      const time = (performance.now() - t0) / 1000;
      g.fillStyle = '#2a1d12';
      g.fillRect(0, 0, c.width, c.height);
      const face = zoom === 'face';
      const pose: FoxPose = {
        x: face ? 170 : 210,
        y: face ? 1150 : 600,
        scale: face ? 2.1 : 0.62,
        time,
        noShadow: face,
        armFront: arm.side === 'far' || !NEAR_ONLY.includes(arm.mode) ? arm.mode : 'rest',
        armBack: arm.side === 'near' && NEAR_ONLY.includes(arm.mode) ? arm.mode : 'rest',
        walk: walk ? 1 : 0,
        walkPhase: time * Math.PI * 2 * 1.7,
        speaking: talk,
        lookX: 0.4,
        lookY: 0.2,
        ...MOODS[mood],
      } as FoxPose;
      if (arm.side === 'near' && !NEAR_ONLY.includes(arm.mode)) {
        pose.armFront = 'rest';
        pose.armBack = arm.mode;
      }
      drawFox(g, pose);
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [arm, mood, walk, talk, zoom]);

  const armT: ArmTweak = t.arms[arm.side][arm.mode] ?? {};
  const B = builtInArm(arm.side, arm.mode);
  const setArmT = (patch: Partial<ArmTweak> | null) =>
    setT((cur) => {
      const n = structuredClone(cur);
      if (patch === null) delete n.arms[arm.side][arm.mode];
      else n.arms[arm.side][arm.mode] = { ...(n.arms[arm.side][arm.mode] ?? {}), ...patch };
      return n;
    });
  const setGroup = (g: 'motion' | 'face', k: string, v: number | undefined) =>
    setT((cur) => {
      const n = structuredClone(cur);
      if (v === undefined) delete (n[g] as Record<string, number>)[k];
      else (n[g] as Record<string, number>)[k] = v;
      return n;
    });

  const save = async () => {
    setStatus('Saving…');
    try {
      const r = await fetch('/api/rig/tweaks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tweaks: t }) });
      if (!r.ok) throw new Error((await r.json()).error);
      setSaved(JSON.stringify(t));
      setStatus('Saved: every scene uses these values now.');
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
            {(['body', 'face'] as const).map((z) => (
              <button key={z} className={zoom === z ? 'on' : ''} onClick={() => setZoom(z)}>
                {z === 'body' ? 'Body' : 'Face'}
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={walk} onChange={(e) => setWalk(e.target.checked)} /> Walk
          </label>
          <label className="check">
            <input type="checkbox" checked={talk} onChange={(e) => setTalk(e.target.checked)} /> Talk
          </label>
        </div>
      </div>
      <div className="tuner-controls">
        <h3>Pose</h3>
        <div className="row gap wrap">
          <select className="isel" value={arm.mode} onChange={(e) => setArm({ ...arm, mode: e.target.value as ArmMode })}>
            {ARM_MODES.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <div className="segmented compact">
            {(['far', 'near'] as const).map((sd) => (
              <button key={sd} className={arm.side === sd ? 'on' : ''} onClick={() => setArm({ ...arm, side: sd })}>
                {sd === 'far' ? 'Right arm (acting)' : 'Left arm'}
              </button>
            ))}
          </div>
        </div>
        <p className="help small">Hand position in reference px (x → right, y ↓ down); leave a value alone to keep the built-in one.</p>
        <Slider label="Hand x" value={armT.t?.[0] ?? B.t[0]} def={B.t[0]} min={-200} max={900} step={1} onChange={(v) => setArmT({ t: v === undefined ? undefined : [v, armT.t?.[1] ?? B.t[1]] })} />
        <Slider label="Hand y" value={armT.t?.[1] ?? B.t[1]} def={B.t[1]} min={-100} max={600} step={1} onChange={(v) => setArmT({ t: v === undefined ? undefined : [armT.t?.[0] ?? B.t[0], v] })} />
        <Slider label="Hand rotation" value={armT.rot ?? B.rot ?? 0} def={B.rot ?? 0} min={-3.2} max={3.2} step={0.01} onChange={(v) => setArmT({ rot: v ?? undefined })} />
        <div className="row gap wrap">
          <label className="tune-row">
            <span>Glove</span>
            <input className="itext" value={armT.hand ?? ''} placeholder={`built-in: ${B.hand} (fist, point, n_one, n_stop_palm…)`} onChange={(e) => setArmT({ hand: e.target.value || undefined })} />
          </label>
          <select className="isel" value={armT.layer ?? ''} onChange={(e) => setArmT({ layer: (e.target.value || undefined) as ArmTweak['layer'] })}>
            <option value="">layer: {B.layer} (built-in)</option>
            {LAYERS.map((l) => (
              <option key={l} value={l}>
                layer: {l}
              </option>
            ))}
          </select>
          <button className="btn small ghost" onClick={() => setArmT(null)}>
            Reset this pose
          </button>
        </div>

        <h3>Motion</h3>
        {(Object.keys(MOTION_LABELS) as (keyof typeof MOTION_DEFAULTS)[]).map((k) => {
          const [label, min, max, step] = MOTION_LABELS[k];
          return <Slider key={k} label={label} value={t.motion[k] ?? MOTION_DEFAULTS[k]} def={MOTION_DEFAULTS[k]} min={min} max={max} step={step} onChange={(v) => setGroup('motion', k, v)} />;
        })}

        <h3>Expressions</h3>
        <div className="segmented compact">
          {Object.keys(MOODS).map((m) => (
            <button key={m} className={mood === m ? 'on' : ''} onClick={() => setMood(m)}>
              {m}
            </button>
          ))}
        </div>
        {(Object.keys(FACE_LABELS) as (keyof typeof FACE_DEFAULTS)[]).map((k) => {
          const [label, min, max, step] = FACE_LABELS[k];
          return <Slider key={k} label={label} value={t.face[k] ?? FACE_DEFAULTS[k]} def={FACE_DEFAULTS[k]} min={min} max={max} step={step} onChange={(v) => setGroup('face', k, v)} />;
        })}

        <div className="row gap" style={{ marginTop: 10 }}>
          <button className="btn primary" disabled={!dirty} onClick={() => void save()}>
            Save tuning
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
