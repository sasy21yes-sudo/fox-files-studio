import { useRef, type PointerEvent } from 'react';
import { formatTime, type Timeline as TL } from '../animation/timeline';

interface Props {
  timeline: TL;
  time: number;
  selected: number;
  onSeek(t: number): void;
  onSelect(index: number): void;
}

/** Scene blocks, subtitle cues and a draggable playhead on one shared time axis. */
export function Timeline({ timeline, time, selected, onSeek, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const total = timeline.total || 1;
  const pct = (t: number) => `${(t / total) * 100}%`;

  const timeFromEvent = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * total;
  };

  const onPointerDown = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onSeek(timeFromEvent(e.clientX));
  };
  const onPointerMove = (e: PointerEvent) => {
    if (e.buttons & 1) onSeek(timeFromEvent(e.clientX));
  };

  const ticks: number[] = [];
  for (let t = 0; t <= total; t += 5) ticks.push(t);

  return (
    <section className="timeline" aria-label="Timeline">
      <div className="timeline-head">
        <span className="panel-title">Timeline</span>
        <span className="muted small">Drag to scrub · click a block to select a scene · {timeline.voiced ? 'subtitles timed from the studio voice' : 'subtitle timing is estimated'}</span>
      </div>
      <div
        className="timeline-track"
        ref={ref}
        role="slider"
        aria-label="Playhead"
        aria-valuemin={0}
        aria-valuemax={Math.round(total * 10) / 10}
        aria-valuenow={Math.round(time * 10) / 10}
        aria-valuetext={formatTime(time)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') onSeek(time + (e.shiftKey ? 5 : 0.5));
          if (e.key === 'ArrowLeft') onSeek(time - (e.shiftKey ? 5 : 0.5));
        }}
      >
        <div className="ruler">
          {ticks.map((t) => (
            <span key={t} className="tick" style={{ left: pct(t) }}>
              {formatTime(t).replace(/\.\d$/, '')}
            </span>
          ))}
        </div>
        <div className="blocks">
          {timeline.hook && (
            <div className="block hook" style={{ left: 0, width: pct(timeline.hook.end) }} title="Short hook (9:16 only)">
              <span className="block-label">Hook</span>
              <span className="block-dur">{timeline.hook.end.toFixed(1)}s</span>
            </div>
          )}
          {timeline.spans.map((s) => (
            <div
              key={s.scene.id}
              className={`block ${s.index === selected ? 'selected' : ''} ${s.overflow ? 'overflow' : ''}`}
              style={{ left: pct(s.start), width: pct(s.duration) }}
              onPointerDown={() => onSelect(s.index)}
              title={`${s.index + 1}. ${s.scene.title} — ${s.duration.toFixed(1)} s`}
            >
              <span className="block-label">
                {s.index + 1}. {s.scene.title}
              </span>
              <span className="block-dur">{s.duration.toFixed(1)}s</span>
            </div>
          ))}
        </div>
        <div className="cues">
          {timeline.cues.map((c) => (
            <span key={c.id} className="cue" style={{ left: pct(c.start), width: pct(c.end - c.start) }} title={c.text} />
          ))}
        </div>
        <div className="playhead" style={{ left: pct(time) }} />
      </div>
    </section>
  );
}
