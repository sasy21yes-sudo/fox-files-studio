import { memo, useEffect, useRef } from 'react';
import type { Project } from '../types';
import { renderFrame } from '../animation/renderScene';
import { formatTime, type Timeline } from '../animation/timeline';

interface Props {
  project: Project;
  timeline: Timeline;
  selected: number;
  current: number;
  onSelect(index: number): void;
}

/** Thumbnail frame of each scene, rendered with the same renderer as the video. */
function Thumb({ project, timeline, index }: { project: Project; timeline: Timeline; index: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const vertical = project.settings.aspect === '9:16';
  const w = vertical ? 81 : 192;
  const h = vertical ? 144 : 108;
  const span = timeline.spans[index];
  const key = `${project.settings.aspect}|${span.start}|${span.duration}|${project.settings.filmGrain}|${span.scene.transition}`;

  useEffect(() => {
    const id = window.setTimeout(() => {
      const c = ref.current;
      const g = c?.getContext('2d');
      if (!c || !g) return;
      // Sample 62% into the scene, where most of its elements are on screen.
      const t = span.start + span.duration * 0.62;
      renderFrame(g, w, h, project, timeline, t, {
        filmGrain: project.settings.filmGrain,
        subtitles: project.settings.subtitles,
        burnSubtitles: false,
      });
    }, 120 + index * 40);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return <canvas ref={ref} width={w} height={h} className={`thumb ${vertical ? 'vertical' : ''}`} aria-hidden="true" />;
}

export const SceneList = memo(function SceneList({ project, timeline, selected, current, onSelect }: Props) {
  return (
    <aside className="scene-list filmstrip" aria-label="Scenes">
      <h2 className="panel-title">Scenes</h2>
      <ol>
        {timeline.spans.map((span, i) => (
          <li key={span.scene.id}>
            <button
              className={`scene-item ${i === selected ? 'selected' : ''} ${i === current ? 'playing' : ''}`}
              onClick={() => onSelect(i)}
              aria-current={i === selected}
            >
              <Thumb project={project} timeline={timeline} index={i} />
              <span className="scene-meta">
                <span className="scene-num">{String(i + 1).padStart(2, '0')}</span>
                <span className="scene-title">{span.scene.title}</span>
                <span className="scene-time">
                  {formatTime(span.start)} · {span.duration.toFixed(1)}s
                </span>
                {span.overflow && <span className="warn-chip">narration long</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </aside>
  );
});
