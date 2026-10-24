import { useEffect, useRef, useState } from 'react';
import { clipDuration, clipFrameAt, getClip, loadClip, loadClipIndex, type ClipInfo } from '../media/clips';
import { bumpMedia } from '../media/store';

/**
 * Clip lab (model sheet → Clips): the frame-by-frame animation library. Play a clip at its real
 * timing, step drawing by drawing, onion skin (the previous and next drawings in red / green), see what
 * the build measured; and build a new clip from dropped drawings (tools/vite/clipBuild.ts).
 */
export function ClipLab() {
  const [list, setList] = useState<ClipInfo[]>([]);
  const [id, setId] = useState('');
  const [playing, setPlaying] = useState(true);
  const [frame, setFrame] = useState(0);
  const [onion, setOnion] = useState(false);
  const [, setTick] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const t0 = useRef(performance.now());

  const refresh = async (select?: string) => {
    const l = await loadClipIndex(true);
    setList(l);
    if (select) setId(select);
    else if (!id && l[0]) setId(l[0].id);
  };
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (id) void loadClip(id).then(() => setTick((n) => n + 1));
  }, [id]);

  // Draw (and play) the clip.
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const c = canvas.current;
      const got = id ? getClip(id) : undefined;
      if (c && got) {
        const { clip, atlas } = got;
        const g = c.getContext('2d')!;
        const i = playing ? clipFrameAt(clip, (performance.now() - t0.current) / 1000, clip.loop === 'once' ? 'loop' : clip.loop) : Math.min(frame, clip.frames.length - 1);
        if (playing && i !== frame) setFrame(i);
        const s = Math.min(c.width / clip.width, c.height / clip.height) * 0.92;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.fillStyle = '#5d7a8c';
        g.fillRect(0, 0, c.width, c.height);
        g.setTransform(s, 0, 0, s, (c.width - clip.width * s) / 2, (c.height - clip.height * s) / 2);
        const put = (k: number, alpha: number, tint?: string) => {
          const f = clip.frames[(k + clip.frames.length) % clip.frames.length];
          if (!tint) {
            g.globalAlpha = alpha;
            g.drawImage(atlas, f.x, f.y, f.w, f.h, f.ox, f.oy, f.w, f.h);
            g.globalAlpha = 1;
            return;
          }
          const o = document.createElement('canvas');
          o.width = f.w;
          o.height = f.h;
          const og = o.getContext('2d')!;
          og.drawImage(atlas, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
          og.globalCompositeOperation = 'source-atop';
          og.fillStyle = tint;
          og.fillRect(0, 0, f.w, f.h);
          g.globalAlpha = alpha;
          g.drawImage(o, f.ox, f.oy);
          g.globalAlpha = 1;
        };
        if (onion && !playing) {
          put(i - 1, 0.35, '#e0303a');
          put(i + 1, 0.35, '#2fbf55');
        }
        put(i, onion && !playing ? 0.8 : 1);
        // The anchor (where x, y of the element falls).
        g.strokeStyle = '#ffe23d';
        g.lineWidth = 2 / s;
        g.beginPath();
        g.moveTo(clip.anchor[0] - 14 / s, clip.anchor[1]);
        g.lineTo(clip.anchor[0] + 14 / s, clip.anchor[1]);
        g.moveTo(clip.anchor[0], clip.anchor[1] - 14 / s);
        g.lineTo(clip.anchor[0], clip.anchor[1] + 14 / s);
        g.stroke();
      }
      if (playing) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  });

  const got = id ? getClip(id) : undefined;
  const clip = got?.clip;
  return (
    <div className="clip-lab">
      <div className="clip-main">
        <div className="row gap">
          <select className="isel" value={id} onChange={(e) => setId(e.target.value)}>
            {list.length === 0 && <option value="">— no clips yet —</option>}
            {list.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} ({c.frames} drawings, {c.duration.toFixed(2)} s)
              </option>
            ))}
          </select>
          <button className="btn small" onClick={() => setPlaying(!playing)} disabled={!clip}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <button className="btn small" disabled={!clip} onClick={() => (setPlaying(false), setFrame((f) => (f - 1 + (clip?.frames.length ?? 1)) % (clip?.frames.length ?? 1)))}>
            ◀ Drawing
          </button>
          <button className="btn small" disabled={!clip} onClick={() => (setPlaying(false), setFrame((f) => (f + 1) % (clip?.frames.length ?? 1)))}>
            Drawing ▶
          </button>
          <label className="chk">
            <input type="checkbox" checked={onion} onChange={(e) => setOnion(e.target.checked)} /> Onion skin (paused)
          </label>
        </div>
        <canvas ref={canvas} width={640} height={640} className="clip-canvas" />
        {clip && (
          <p className="help small">
            Drawing {frame + 1}/{clip.frames.length} · hold {clip.frames[frame]?.hold ?? 1} · {clip.fps} fps · {clipDuration(clip).toFixed(2)} s · {clip.loop}
            {clip.report ? ` · registration: worst residual ${clip.report.maxError.toFixed(3)} px` : ''}
          </p>
        )}
        {clip && (
          <div className="row gap">
            <a className="btn small ghost" href={`/api/clips/qa/${clip.id}/contact.png`} target="_blank" rel="noreferrer">
              Contact sheet
            </a>
            <a className="btn small ghost" href={`/api/clips/qa/${clip.id}/onion.png`} target="_blank" rel="noreferrer">
              Onion sheet
            </a>
          </div>
        )}
      </div>
      <BuildClip onBuilt={(newId) => void refresh(newId)} />
    </div>
  );
}

/** Build a clip from dropped drawings (green screen or transparent PNGs, in name order). */
function BuildClip({ onBuilt }: { onBuilt(id: string): void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [opt, setOpt] = useState({ id: '', label: '', fps: 24, hold: 2, loop: 'once', lock: 'feet', motion: 'translation', heightU: 600, maxError: 0.25 });
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState('');
  const build = async () => {
    setBusy(true);
    setLog('Building: registering every drawing on the locked region…');
    try {
      const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      const frames = await Promise.all(sorted.map((f) => new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.readAsDataURL(f);
      })));
      const r = await fetch('/api/clips/build', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...opt, frames }) });
      const j = await r.json();
      setLog(j.log ?? j.error ?? '');
      if (r.ok) {
        bumpMedia();
        onBuilt(opt.id);
      }
    } catch (e) {
      setLog(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const num = (k: keyof typeof opt, label: string, step = 1) => (
    <label className="ifield">
      <span>{label}</span>
      <input className="itext" type="number" step={step} value={opt[k] as number} onChange={(e) => setOpt({ ...opt, [k]: Number(e.target.value) })} />
    </label>
  );
  return (
    <div className="clip-build">
      <h3>New clip from drawings</h3>
      <p className="help small">
        Drop the drawings (green screen or transparent PNG), named in order. Every drawing is aligned to the first on the locked region
        (feet = the bottom of the figure, which must not slide), sub-pixel; a clip whose drawings still disagree there by more than the
        allowed error is refused.
      </p>
      <div
        className="drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          setFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/')));
        }}
      >
        {files.length ? `${files.length} drawings` : 'Drop drawings here'}
        <input type="file" multiple accept="image/*" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
      </div>
      <label className="ifield">
        <span>Id</span>
        <input className="itext" value={opt.id} placeholder="tip_hat" onChange={(e) => setOpt({ ...opt, id: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '_') })} />
      </label>
      <label className="ifield">
        <span>Name</span>
        <input className="itext" value={opt.label} placeholder="Tips his hat" onChange={(e) => setOpt({ ...opt, label: e.target.value })} />
      </label>
      {num('fps', 'Ticks / s')}
      {num('hold', 'Ticks per drawing (2 = on twos)')}
      <label className="ifield">
        <span>Plays</span>
        <select className="isel" value={opt.loop} onChange={(e) => setOpt({ ...opt, loop: e.target.value })}>
          <option value="once">once</option>
          <option value="loop">loop</option>
          <option value="pingpong">pingpong</option>
        </select>
      </label>
      <label className="ifield">
        <span>Locked region</span>
        <input className="itext" value={opt.lock} onChange={(e) => setOpt({ ...opt, lock: e.target.value })} title="feet, none, or x0,y0,x1,y1 px of the first drawing" />
      </label>
      <label className="ifield">
        <span>Alignment</span>
        <select className="isel" value={opt.motion} onChange={(e) => setOpt({ ...opt, motion: e.target.value })}>
          <option value="translation">shift</option>
          <option value="euclidean">shift + turn</option>
          <option value="affine">shift + turn + scale</option>
        </select>
      </label>
      {num('heightU', 'Height of drawing 1 on screen (u; Agent Fox 600)', 10)}
      {num('maxError', 'Max error allowed (px)', 0.05)}
      <button className="btn primary small" disabled={busy || files.length < 2 || !opt.id} onClick={() => void build()}>
        {busy ? 'Building…' : 'Build clip'}
      </button>
      {log && <pre className="clip-log">{log}</pre>}
    </div>
  );
}
