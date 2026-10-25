import { useState } from 'react';
import { splitSentences, type Timeline } from '../animation/timeline';
import type { Project, ShortCut } from '../types';

type Change = (fn: (p: Project) => Project, key?: string) => void;

interface Props {
  project: Project;
  /** The whole episode's timeline (sentence lengths come from it). */
  timeline: Timeline;
  /** The Short's own cut, when there is one. */
  short: Timeline | null;
  previewing: boolean;
  onPreview(on: boolean): void;
  onChange: Change;
}

/** Sentence indices of a scene that the cut includes. */
const picked = (cut: ShortCut | undefined, scene: string) => {
  const s = new Set<number>();
  for (const c of cut?.clips ?? []) if (c.scene === scene) for (let i = Math.min(c.from, c.to); i <= Math.max(c.from, c.to); i++) s.add(i);
  return s;
};

/** Clips from the picked sentences: runs of consecutive sentences, in episode order. */
function clipsOf(project: Project, sel: Map<string, Set<number>>): ShortCut['clips'] {
  const out: ShortCut['clips'] = [];
  for (const sc of project.scenes) {
    const ids = [...(sel.get(sc.id) ?? [])].sort((a, b) => a - b);
    for (const i of ids) {
      const last = out[out.length - 1];
      if (last && last.scene === sc.id && last.to === i - 1) last.to = i;
      else out.push({ scene: sc.id, from: i, to: i });
    }
  }
  return out;
}

/**
 * The Short's own cut: tick the sentences that make the summary (the strongest, catchiest moments); the Short is
 * the hook plus those moments of the episode, picture and voice included, back to back. Nothing is re-recorded.
 */
export function ShortPanel({ project, timeline, short, previewing, onPreview, onChange }: Props) {
  const [open, setOpen] = useState(true);
  const cut = project.short;
  const clipLen = (text: string, si: number) => {
    const span = timeline.spans[si];
    const c = span && timeline.clips.find((x) => x.text === text && x.start >= span.start - 1e-3 && x.start < span.end);
    return c ? c.duration : null;
  };
  const setCut = (fn: (c: ShortCut) => ShortCut) => onChange((p) => ({ ...p, short: fn(p.short ?? { enabled: true, clips: [] }) }), `short:${Date.now()}`);
  const toggle = (scene: string, i: number) =>
    setCut((c) => {
      const sel = new Map(project.scenes.map((s) => [s.id, picked(c, s.id)]));
      const s = sel.get(scene)!;
      if (s.has(i)) s.delete(i);
      else s.add(i);
      return { ...c, clips: clipsOf(project, sel) };
    });
  const total = short?.total ?? 0;
  const verdict = !short ? '' : total <= 60 ? 'good length for a Short' : total <= 90 ? 'long for a Short (30–60 s works best)' : total <= 180 ? 'too long: aim for 30–60 s' : 'over the 3-minute Shorts limit';

  return (
    <section className={`ai-panel short-panel ${open ? 'open' : ''}`} aria-label="Short cut">
      <button className="ai-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="ai-spark" aria-hidden="true">▮</span> Short cut{' '}
        <span className="muted small">· {cut?.enabled && short ? `${total.toFixed(1)} s, ${cut.clips.length} clips` : 'whole episode'}</span>
        <span className="chev">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="ai-body">
          <p className="help small">
            The Short can be its own cut: the hook, then only the sentences you tick, with their picture, voice and pop-ups, back to back. Untick everything
            (or switch it off) and the Short is the whole episode.
          </p>
          <div className="row gap small">
            <label className="chk">
              <input type="checkbox" checked={!!cut?.enabled} onChange={(e) => setCut((c) => ({ ...c, enabled: e.target.checked }))} /> Use its own cut
            </label>
            <button className={`btn small ${previewing ? 'primary' : ''}`} disabled={!short} onClick={() => onPreview(!previewing)}>
              {previewing ? '■ Back to the episode' : '▶ Preview the Short'}
            </button>
          </div>
          {short && (
            <p className={`small ${total > 60 ? 'warn-text' : 'muted'}`}>
              {total.toFixed(1)} s with the hook · {verdict}
            </p>
          )}
          {cut?.enabled && (
            <div className="short-list">
              {project.scenes.map((sc, si) => {
                const sel = picked(cut, sc.id);
                return (
                  <div key={sc.id} className="short-scene">
                    <strong>
                      {si + 1}. {sc.title}
                    </strong>
                    {splitSentences(sc.narration).map((text, i) => {
                      const d = clipLen(text, si);
                      return (
                        <label key={i} className={`short-line ${sel.has(i) ? 'on' : ''}`}>
                          <input type="checkbox" checked={sel.has(i)} onChange={() => toggle(sc.id, i)} />
                          <span>{text}</span>
                          <code>{d !== null ? `${d.toFixed(1)}s` : ''}</code>
                        </label>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
