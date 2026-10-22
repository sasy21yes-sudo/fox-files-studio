import { useEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import { renderFrame } from '../animation/renderScene';
import { formatTime, locate, type Timeline } from '../animation/timeline';
import type { Playback } from '../app/usePlayback';
import { loadCanvasFonts } from '../app/fonts';

interface Props {
  project: Project;
  timeline: Timeline;
  playback: Playback;
  audioLabel: string;
}

/** Internal preview resolution: lower than export, same aspect ratio and composition. */
export const PREVIEW_SIZE = {
  '16:9': { width: 960, height: 540 },
  '9:16': { width: 540, height: 960 },
} as const;

export function PreviewPlayer({ project, timeline, playback, audioLabel }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { aspect, filmGrain, subtitles, showSafeArea, previewSpeed } = project.settings;
  const size = PREVIEW_SIZE[aspect];
  const [fontTick, setFontTick] = useState(0);

  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext('2d', { alpha: false });
    if (!c || !g) return;
    renderFrame(g, size.width, size.height, project, timeline, playback.time, {
      filmGrain,
      subtitles,
      burnSubtitles: true,
      showSafeArea,
    });
  }, [project, timeline, playback.time, size.width, size.height, filmGrain, subtitles, showSafeArea, fontTick]);

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
      <div className={`stage-frame ${aspect === '9:16' ? 'vertical' : 'horizontal'}`}>
        <canvas
          ref={ref}
          width={size.width}
          height={size.height}
          className="stage-canvas"
          onClick={playback.toggle}
          aria-label={`Preview of scene ${span.index + 1}: ${span.scene.title}`}
        />
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
        <span className="audio-chip" title="Audio heard in the preview">
          {audioLabel}
        </span>
      </div>
    </section>
  );
}
