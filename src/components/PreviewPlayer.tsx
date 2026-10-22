import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import { renderFrame } from '../animation/renderScene';
import type { RenderProbe } from '../animation/stage';
import { formatTime, locate, type Timeline } from '../animation/timeline';
import type { Playback } from '../app/usePlayback';
import { loadCanvasFonts } from '../app/fonts';
import { EXPORT_SIZES } from '../export/capabilities';
import { loadProjectMedia } from '../media/store';
import { useMediaVersion } from '../media/useMedia';
import { StageOverlay } from '../editor/StageOverlay';
import type { FoxDebug } from '../character/AgentFox';
import type { Selection } from '../editor/model';

interface Props {
  project: Project;
  timeline: Timeline;
  playback: Playback;
  audioLabel: string;
  /** Edit page: handles on the elements of data scenes. */
  editing?: {
    selection: Selection;
    onSelect(s: Selection): void;
    onChange(fn: (p: Project) => Project, key?: string): void;
    /** Agent Fox as drawn at the playhead (pose, arms, face, joints), for the inspector. */
    onFox?(fox: FoxDebug | null): void;
  };
}

/** Bones drawn by the Rig overlay: pairs of joint names. */
const BONES: [string, string][] = [
  ['shoulder_near', 'elbow_near'], ['elbow_near', 'hand_near'],
  ['shoulder_far', 'elbow_far'], ['elbow_far', 'hand_far'],
  ['hip_near', 'knee_near'], ['knee_near', 'ankle_near'],
  ['hip_far', 'knee_far'], ['knee_far', 'ankle_far'],
  ['shoulder_near', 'shoulder_far'], ['hip_near', 'hip_far'], ['neck', 'eye_near'], ['eye_near', 'nose'], ['eye_far', 'nose'],
];

function RigOverlay({ fox, w, h, rect }: { fox: FoxDebug; w: number; h: number; rect: { left: number; top: number; width: number; height: number } }) {
  const px = w / Math.max(1, rect.width);
  const J = fox.joints;
  return (
    <svg className="stage-overlay rig-overlay" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {BONES.filter(([a, b]) => J[a] && J[b]).map(([a, b]) => (
        <line key={a + b} x1={J[a][0]} y1={J[a][1]} x2={J[b][0]} y2={J[b][1]} className="rig-bone" style={{ strokeWidth: 2 * px }} />
      ))}
      {Object.entries(J).map(([name, [x, y]]) => (
        <g key={name}>
          <circle cx={x} cy={y} r={3.5 * px} className="rig-joint" style={{ strokeWidth: 1.5 * px }} />
          <text x={x + 5 * px} y={y - 4 * px} className="rig-label" style={{ fontSize: 9 * px, strokeWidth: 2.5 * px }}>
            {name.replace('_', ' ')}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** Internal preview resolution: lower than export, same aspect ratio and composition. */
export const PREVIEW_SIZE = {
  '16:9': { width: 960, height: 540 },
  '9:16': { width: 540, height: 960 },
} as const;

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Full-resolution PNG of the frame at `time` (no subtitles), e.g. for a thumbnail. */
async function saveStill(project: Project, timeline: Timeline, time: number) {
  await Promise.all([loadProjectMedia(project), loadCanvasFonts()]);
  const { width, height } = EXPORT_SIZES[project.settings.aspect];
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d', { alpha: false });
  if (!g) return;
  renderFrame(g, width, height, project, timeline, time, { filmGrain: project.settings.filmGrain, subtitles: project.settings.subtitles, burnSubtitles: false });
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'));
  const stamp = formatTime(time).replace(/[:.]/g, '-');
  if (blob) download(blob, `${project.episodeTitle.replace(/[^\w-]+/g, '_').slice(0, 40)}_${project.settings.aspect.replace(':', 'x')}_${stamp}.png`);
}

export function PreviewPlayer({ project, timeline, playback, audioLabel, editing }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const { aspect, filmGrain, subtitles, showSafeArea, previewSpeed } = project.settings;
  const size = PREVIEW_SIZE[aspect];
  const [fontTick, setFontTick] = useState(0);
  const media = useMediaVersion();
  const probe = useRef<RenderProbe>({ scene: -1, matrix: null, anchors: [] });
  const [snap, setSnap] = useState<RenderProbe | null>(null);
  const [handles, setHandles] = useState(true);
  const [rigView, setRigView] = useState(false);
  const lastFox = useRef(0);
  const [rect, setRect] = useState({ left: 0, top: 0, width: 1, height: 1 });
  const [stillBusy, setStillBusy] = useState(false);
  const showHandles = !!editing && handles && !playback.playing;

  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext('2d', { alpha: false });
    if (!c || !g) return;
    renderFrame(g, size.width, size.height, project, timeline, playback.time, {
      filmGrain,
      subtitles,
      burnSubtitles: true,
      showSafeArea,
      probe: editing ? probe.current : undefined,
    });
    if (!editing) return;
    // While playing, report at most 4 times a second (the inspector re-renders on each report).
    const now = performance.now();
    if (playback.playing && now - lastFox.current < 250) return;
    lastFox.current = now;
    setSnap({ ...probe.current, anchors: [...probe.current.anchors] });
    editing.onFox?.(probe.current.fox ?? null);
  }, [project, timeline, playback.time, size.width, size.height, filmGrain, subtitles, showSafeArea, fontTick, media, showHandles]);

  // Where the canvas sits inside the frame (CSS sizes it to fit), for the handle overlay.
  useLayoutEffect(() => {
    const c = ref.current;
    const f = frameRef.current;
    if (!c || !f) return;
    const measure = () => {
      const a = c.getBoundingClientRect();
      const b = f.getBoundingClientRect();
      setRect({ left: a.left - b.left, top: a.top - b.top, width: a.width, height: a.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(c);
    ro.observe(f);
    return () => ro.disconnect();
  }, [aspect]);

  // Re-render once web fonts arrive so canvas text uses them.
  useEffect(() => {
    let alive = true;
    void loadCanvasFonts().then(() => alive && setFontTick((n) => n + 1));
    return () => {
      alive = false;
    };
  }, []);

  const { span } = locate(timeline, playback.time);

  return (
    <section className="player" aria-label="Preview player">
      <div ref={frameRef} className={`stage-frame ${aspect === '9:16' ? 'vertical' : 'horizontal'}`}>
        <canvas
          ref={ref}
          width={size.width}
          height={size.height}
          className="stage-canvas"
          onClick={playback.toggle}
          aria-label={`Preview of scene ${span.index + 1}: ${span.scene.title}`}
        />
        {rigView && editing && snap?.fox && <RigOverlay fox={snap.fox} w={size.width} h={size.height} rect={rect} />}
        {showHandles && editing && snap && snap.scene >= 0 && (
          <StageOverlay
            project={project}
            probe={snap}
            cw={size.width}
            ch={size.height}
            rect={rect}
            selection={editing.selection}
            onSelect={editing.onSelect}
            onChange={editing.onChange}
          />
        )}
        <div className="stage-badges">
          <span className="badge">{aspect}</span>
          <span className="badge">
            preview {size.width}×{size.height}
          </span>
          {previewSpeed !== 1 && <span className="badge warn">{previewSpeed}× speed</span>}
        </div>
      </div>
      <div className="transport">
        <button className="btn icon" onClick={playback.restart} aria-label="Restart" title="Restart">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path d="M6 5h2v14H6zM20 5v14L9 12z" fill="currentColor" />
          </svg>
        </button>
        <button className="btn icon play" onClick={playback.toggle} aria-label={playback.playing ? 'Pause' : 'Play'} title="Play / pause (Space)">
          {playback.playing ? (
            <svg viewBox="0 0 24 24" width="22" height="22">
              <path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="22" height="22">
              <path d="M7 4v16l13-8z" fill="currentColor" />
            </svg>
          )}
        </button>
        <span className="timecode">
          {formatTime(playback.time)} <span className="muted">/ {formatTime(timeline.total)}</span>
        </span>
        <span className="now-playing">
          {timeline.hook && playback.time < timeline.hook.end ? (
            <>
              <span className="muted">Short</span> Hook
            </>
          ) : (
            <>
              <span className="muted">Scene {span.index + 1}</span> {span.scene.title}
            </>
          )}
        </span>
        {editing && (
          <button
            className={`btn small ghost ${handles ? 'on' : ''}`}
            onClick={() => setHandles(!handles)}
            aria-pressed={handles}
            title="Show handles on the elements of data scenes (paused): click to select, drag to move"
          >
            ✥ Handles
          </button>
        )}
        {editing && (
          <button
            className={`btn small ghost ${rigView ? 'on' : ''}`}
            onClick={() => setRigView(!rigView)}
            aria-pressed={rigView}
            title="Show Agent Fox's skeleton: shoulders, elbows, hands, hips, knees, ankles, tail, neck, eyes, nose"
          >
            ⦿ Rig
          </button>
        )}
        <button
          className="btn small ghost"
          disabled={stillBusy}
          title={`Save this frame as a ${EXPORT_SIZES[aspect].width}×${EXPORT_SIZES[aspect].height} PNG (no subtitles), e.g. for a thumbnail`}
          onClick={async () => {
            setStillBusy(true);
            try {
              await saveStill(project, timeline, playback.time);
            } finally {
              setStillBusy(false);
            }
          }}
        >
          {stillBusy ? 'Saving…' : '⤓ Still'}
        </button>
        <span className="audio-chip" title="Audio heard in the preview">
          {audioLabel}
        </span>
      </div>
    </section>
  );
}
