import type { Timeline } from '../animation/timeline';
import { formatTime } from '../animation/timeline';

interface Props {
  /** The Short's own cut. */
  short: Timeline;
  time: number;
  onSeek(t: number): void;
}

/**
 * The timeline area while the Short's own cut plays: hook, clips and closing card as one strip at their real
 * lengths, with the playhead; click to jump. (The multitrack editor shows the whole episode, not the cut.)
 */
export function ShortStrip({ short, time, onSeek }: Props) {
  const total = Math.max(0.001, short.total);
  const pct = (t: number) => `${(t / total) * 100}%`;
  const hookEnd = short.hook?.end ?? 0;
  const cardAt = short.endCard;
  return (
    <section className="tl short-strip" aria-label="Short cut timeline">
      <header className="short-strip-head">
        <strong>SHORT CUT</strong>
        <span className="muted small">
          {formatTime(time)} / {formatTime(total)} · {short.spans.length} clips · the editor tracks show the whole episode: switch back to edit
        </span>
      </header>
      <div
        className="short-strip-bar"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onSeek(((e.clientX - r.left) / r.width) * total);
        }}
      >
        {hookEnd > 0 && (
          <div className="short-seg hook" style={{ left: 0, width: pct(hookEnd) }} title="Hook">
            Hook
          </div>
        )}
        {short.spans.map((s, i) => {
          const end = cardAt !== undefined && i === short.spans.length - 1 ? cardAt : s.end;
          const prev = short.spans[i - 1];
          const jump = !!prev && prev.scene.id === s.scene.id;
          const words = short.cues.filter((c) => c.sceneIndex === i).map((c) => c.text).join(' ');
          return (
            <div key={i} className={`short-seg ${jump ? 'jump' : ''}`} style={{ left: pct(s.start), width: pct(end - s.start) }} title={`${s.scene.title}: ${words}`}>
              <b>{s.scene.title}</b>
              <span>{words}</span>
            </div>
          );
        })}
        {cardAt !== undefined && (
          <div className="short-seg card" style={{ left: pct(cardAt), width: pct(total - cardAt) }} title="End card">
            End
          </div>
        )}
        <div className="short-playhead" style={{ left: pct(Math.min(time, total)) }} />
      </div>
    </section>
  );
}
