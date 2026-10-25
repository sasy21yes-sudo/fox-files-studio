import { useState } from 'react';
import { splitSentences, type Timeline } from '../animation/timeline';
import type { Project, ShortCut } from '../types';

type Change = (fn: (p: Project) => Project, key?: string) => void;
type Clip = ShortCut['clips'][number];

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

const covers = (c: Clip, scene: string, i: number) => c.scene === scene && i >= Math.min(c.from, c.to) && i <= Math.max(c.from, c.to);

/**
 * Tick or untick one sentence, keeping the clips' playing order: unticking splits a clip, ticking extends or
 * joins the neighbouring clip of the same scene, else adds a clip where it falls in the episode's order.
 */
function toggleSentence(project: Project, clips: Clip[], scene: string, i: number): Clip[] {
  const out = clips.map((c) => ({ ...c }));
  const at = out.findIndex((c) => covers(c, scene, i));
  if (at >= 0) {
    const c = out[at];
    const parts = [
      { ...c, from: Math.min(c.from, c.to), to: i - 1 },
      { ...c, from: i + 1, to: Math.max(c.from, c.to), lead: undefined },
    ].filter((p) => p.from <= p.to);
    out.splice(at, 1, ...parts);
    return out;
  }
  const before = out.findIndex((c) => c.scene === scene && c.to === i - 1);
  const after = out.findIndex((c) => c.scene === scene && c.from === i + 1);
  if (before >= 0 && after >= 0) {
    out[before].to = out[after].to;
    out.splice(after, 1);
  } else if (before >= 0) out[before].to = i;
  else if (after >= 0) out[after].from = i;
  else {
    const pos = (c: { scene: string; from: number }) => project.scenes.findIndex((s) => s.id === c.scene) * 1000 + c.from;
    const me = pos({ scene, from: i });
    const next = out.findIndex((c) => pos(c) > me);
    out.splice(next < 0 ? out.length : next, 0, { scene, from: i, to: i });
  }
  return out;
}

/**
 * The Short's own cut: tick the sentences that make the summary (the strongest, catchiest moments) and order the
 * clips; the Short is the hook plus those moments of the episode, picture and voice included, joined by
 * readable cuts. Nothing is re-recorded.
 */
export function ShortPanel({ project, timeline, short, previewing, onPreview, onChange }: Props) {
  const [open, setOpen] = useState(true);
  const cut = project.short;
  const clipLen = (text: string, si: number) => {
    const span = timeline.spans[si];
    const c = span && timeline.clips.find((x) => x.text === text && x.start >= span.start - 1e-3 && x.start < span.end);
    return c ? c.duration : null;
  };
  const setCut = (fn: (c: ShortCut) => ShortCut, key = `short:${Date.now()}`) => onChange((p) => ({ ...p, short: fn(p.short ?? { enabled: true, clips: [] }) }), key);
  const move = (i: number, d: -1 | 1) =>
    setCut((c) => {
      const clips = [...c.clips];
      const j = i + d;
      if (j < 0 || j >= clips.length) return c;
      [clips[i], clips[j]] = [clips[j], clips[i]];
      return { ...c, clips };
    });
  const setLead = (i: number, lead: number) => setCut((c) => ({ ...c, clips: c.clips.map((x, k) => (k === i ? { ...x, lead: lead || undefined } : x)) }), `short-lead:${i}`);
  const total = short?.total ?? 0;
  const verdict = !short ? '' : total <= 60 ? 'good length for a Short' : total <= 90 ? 'long for a Short (30–60 s works best)' : total <= 180 ? 'too long: aim for 30–60 s' : 'over the 3-minute Shorts limit';
  const sceneOf = (id: string) => project.scenes.find((s) => s.id === id);

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
            The Short can be its own cut: the hook, then only the sentences you tick, with their picture, voice and pop-ups. A new topic opens with its
            chapter tag and a whoosh; a jump inside the same scene with a punch-in.
          </p>
          <div className="row gap small">
            <label className="chk">
              <input type="checkbox" checked={!!cut?.enabled} onChange={(e) => setCut((c) => ({ ...c, enabled: e.target.checked }))} /> Use its own cut
            </label>
            <label className="chk" title="A closing card: “full episode on the channel”">
              <input type="checkbox" checked={cut?.endCard !== false} disabled={!cut?.enabled} onChange={(e) => setCut((c) => ({ ...c, endCard: e.target.checked }))} /> End card
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
          {cut?.enabled && cut.clips.length > 0 && (
            <>
              <h4 className="short-h">Clips, in playing order</h4>
              <ol className="short-clips">
                {cut.clips.map((c, i) => {
                  const sc = sceneOf(c.scene);
                  const first = sc ? splitSentences(sc.narration)[Math.min(c.from, c.to)] ?? '' : '';
                  return (
                    <li key={`${c.scene}-${c.from}-${i}`}>
                      <span className="short-clip-text">
                        <b>{sc?.title ?? c.scene}</b> {first.length > 46 ? `${first.slice(0, 44)}…` : first}
                        {c.to !== c.from ? ` (+${Math.abs(c.to - c.from)})` : ''}
                      </span>
                      <label className="short-lead" title="Picture starts later (+) or earlier (−) than the voice, in seconds">
                        picture
                        <input type="number" step={0.1} min={-5} max={5} value={c.lead ?? 0} onChange={(e) => setLead(i, Number(e.target.value))} />
                      </label>
                      <button className="btn icon ghost small" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                        ↑
                      </button>
                      <button className="btn icon ghost small" disabled={i === cut.clips.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                        ↓
                      </button>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
          {cut?.enabled && (
            <div className="short-list">
              {project.scenes.map((sc, si) => (
                <div key={sc.id} className="short-scene">
                  <strong>
                    {si + 1}. {sc.title}
                  </strong>
                  {splitSentences(sc.narration).map((text, i) => {
                    const on = cut.clips.some((c) => covers(c, sc.id, i));
                    const d = clipLen(text, si);
                    return (
                      <label key={i} className={`short-line ${on ? 'on' : ''}`}>
                        <input type="checkbox" checked={on} onChange={() => setCut((c) => ({ ...c, clips: toggleSentence(project, c.clips, sc.id, i) }))} />
                        <span>{text}</span>
                        <code>{d !== null ? `${d.toFixed(1)}s` : ''}</code>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
