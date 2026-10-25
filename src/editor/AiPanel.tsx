import { useEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import type { Timeline } from '../animation/timeline';
import { aiStatus, editWithClaude, type AiOptions, type AiResult, type AiStatus, type AiTarget } from '../ai/claude';
import { applyClaudeResult, changesAnything, paintImages } from '../ai/applyClaude';
import { renderFramesForClaude } from '../ai/frames';
import { loadProjectMedia } from '../media/store';

type Change = (fn: (p: Project) => Project, key?: string) => void;

interface Props {
  project: Project;
  timeline: Timeline;
  scene: number;
  onChange: Change;
  onUndo(): void;
  /** The timeline of another version of the project (to render the result of an edit). */
  retime(p: Project): Timeline;
}

/** Frames per scene Claude sees (~300 tokens each): more for one scene, fewer per scene for the whole video. */
const FRAMES_SCENE = 3;
const FRAMES_ALL = 1;

/** Models the panel offers, cheapest first after the default. */
const MODEL_CHOICES: { id: string; label: string; title: string }[] = [
  { id: 'claude-sonnet-5-5', label: 'Sonnet', title: 'Good for most edits, cheaper than Opus' },
  { id: 'claude-opus-5-5', label: 'Opus', title: 'Best for big or whole-video changes, the most expensive' },
  { id: 'claude-haiku-5-5', label: 'Haiku', title: 'Small, precise fixes (a time, a text, a position), the cheapest' },
];

/** Tokens and cost of every call of one request (the edit and its check). */
type Usage = AiResult['usage'];
const addUsage = (a: Usage, b: Usage): Usage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  cost: a.cost !== undefined || b.cost !== undefined ? (a.cost ?? 0) + (b.cost ?? 0) : undefined,
});
const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const EXAMPLES: Record<'scene' | 'all', string[]> = {
  scene: [
    'Più drammatico: anticipazione prima della caduta della cartella e un primo piano sulla sua reazione',
    'Aggiungi un timbro CLASSIFIED quando dice “destroyed”',
    'Fallo entrare da destra invece che da sinistra',
    'Più inquadrature: un taglio ogni 2-3 secondi',
  ],
  all: [
    'Aggiungi una scena finale che riassume i fatti principali, con un timbro e un tamburo',
    'Sottotitoli più grandi e musica più bassa; titoli di capitolo solo dove serve',
    'Aggiungi un pop-up che spiega ogni termine tecnico, in tutte le scene',
    'Ritmo più veloce: allunga le pause solo nei momenti chiave',
    'Rendi coerenti i pop-up: stesso stile di frase, massimo 6 parole',
  ],
};


/** "Ask Claude" box: edit the selected scene or the whole episode with a prompt. */
export function AiPanel({ project, timeline, scene, onChange, onUndo, retime }: Props) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [open, setOpen] = useState(true);
  const [scope, setScope] = useState<'scene' | 'all'>('scene');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState<{ target: AiTarget; since: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<AiResult | null>(null);
  /** While Claude's new pictures are being painted by the local image model. */
  const [painting, setPainting] = useState<string | null>(null);
  const [look, setLook] = useState(true);
  // Off by default: the check is a second full request (it doubled the cost of every edit).
  const [check, setCheck] = useState(false);
  const [model, setModel] = useState(MODEL_CHOICES[0].id);
  const [effort, setEffort] = useState<NonNullable<AiOptions['effort']>>('medium');
  const [web, setWeb] = useState(false);
  const [spent, setSpent] = useState<Usage | null>(null);
  const [review, setReview] = useState<AiResult | null>(null);
  const [undoSteps, setUndoSteps] = useState(0);
  const [paintFailed, setPaintFailed] = useState<string[]>([]);
  const abort = useRef<AbortController | null>(null);
  const sc = project.scenes[scene];
  const target: AiTarget = scope === 'all' ? 'all' : scene;
  const coded = scope === 'all' ? project.scenes.filter((s) => !s.spec).length : sc.spec ? 0 : 1;

  useEffect(() => {
    void aiStatus().then(setStatus);
  }, []);

  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => setElapsed(Math.round((Date.now() - busy.since) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [busy]);

  const run = async () => {
    if (!prompt.trim() || busy) return;
    setBusy({ target, since: Date.now() });
    setElapsed(0);
    setError(null);
    setLast(null);
    setReview(null);
    abort.current = new AbortController();
    const scenesOf = (p: Project) => (target === 'all' ? p.scenes.map((_, i) => i) : [target]);
    const per = target === 'all' ? FRAMES_ALL : FRAMES_SCENE;
    const options: AiOptions = { model, effort, web };
    setSpent(null);
    try {
      // Claude sees the scenes as they are now (the real picture), not only their data.
      const frames = look ? renderFramesForClaude(project, timeline, scenesOf(project), per) : undefined;
      const result = await editWithClaude(project, target, prompt.trim(), abort.current.signal, timeline, { frames, options });
      let total = result.usage;
      setSpent(total);
      setPaintFailed([]);
      let painted = {};
      if (result.images?.length) {
        const out = await paintImages(result, (done, total, what) => setPainting(done < total ? `Painting picture ${done + 1} of ${total}: ${what.slice(0, 60)}…` : null), abort.current.signal);
        painted = out.items;
        setPaintFailed(out.failed);
        setPainting(null);
      }
      let steps = 0;
      if (changesAnything(result)) {
        onChange((p) => applyClaudeResult(p, result, painted), `ai:${Date.now()}`);
        steps = 1;
      }
      setLast(result);
      setUndoSteps(steps);
      // Check pass: Claude looks at the result of its own edit and fixes what is off (one round).
      if (check && steps) {
        const next = applyClaudeResult(project, result, painted);
        await loadProjectMedia(next);
        const tl = retime(next);
        const targets = scenesOf(next).filter((i) => i < next.scenes.length);
        setPainting('Claude is checking the result on the new frames…');
        const after = renderFramesForClaude(next, tl, targets, per);
        const fix = await editWithClaude(next, target === 'all' || target < next.scenes.length ? target : 'all', prompt.trim(), abort.current.signal, tl, {
          frames: after,
          review: { request: prompt.trim(), summary: result.summary },
          options,
        });
        total = addUsage(total, fix.usage);
        setSpent(total);
        if (changesAnything(fix)) {
          onChange((p) => applyClaudeResult(p, fix, {}), `ai-check:${Date.now()}`);
          setUndoSteps(2);
        }
        setReview(fix);
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : String(e));
      const failed = (e as { usage?: Usage }).usage;
      if (failed) setSpent((s) => (s ? addUsage(s, failed) : failed));
    } finally {
      setBusy(null);
      setPainting(null);
      abort.current = null;
    }
  };

  const what = (t: AiTarget) => (t === 'all' ? 'the whole video' : `scene ${t + 1}`);
  const engine = status?.backend === 'claude-code' ? 'Claude Code' : status?.backend === 'api' ? 'API' : '';

  return (
    <section className={`ai-panel ${open ? 'open' : ''}`} aria-label="Edit with Claude">
      <button className="ai-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="ai-spark" aria-hidden="true">✦</span> Ask Claude <span className="muted small">· {what(target)}</span>
        <span className="chev">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="ai-body">
          {status && !status.available ? (
            <p className="help">
              {status.devServer ? (
                <>
                  Claude Code was not found on this computer. Install it (or set <code>CLAUDE_CODE_BIN</code> in <code>.env</code>) and restart{' '}
                  <code>npm run dev</code>.
                </>
              ) : (
                <>Prompt editing works when the studio runs locally with <code>npm run dev</code>: it uses Claude Code on your computer.</>
              )}
            </p>
          ) : (
            <>
              <div className="segmented ai-scope" role="radiogroup" aria-label="What to edit">
                {(['scene', 'all'] as const).map((k) => (
                  <button key={k} role="radio" aria-checked={scope === k} className={scope === k ? 'on' : ''} onClick={() => setScope(k)} disabled={!!busy}>
                    {k === 'scene' ? `Scene ${scene + 1}` : 'Whole video'}
                  </button>
                ))}
              </div>
              {coded > 0 && (
                <p className="help small">
                  {scope === 'all'
                    ? `${coded} of ${project.scenes.length} scenes are hand-coded: Claude can change their pop-ups and length, and rebuilds the picture as data only if the request needs it (Undo brings everything back).`
                    : 'This scene is hand-coded: Claude will build a new data version of it if the request changes the picture (Undo brings the original back).'}
                </p>
              )}
              <textarea
                className="itext ai-prompt"
                rows={3}
                value={prompt}
                placeholder={`Describe the change to ${what(target)}… (Ctrl+Enter)`}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void run();
                }}
                disabled={!!busy}
              />
              <div className="ichips">
                {EXAMPLES[scope].map((x) => (
                  <button key={x} className="chip" onClick={() => setPrompt(x)} disabled={!!busy}>
                    {x.length > 42 ? `${x.slice(0, 40)}…` : x}
                  </button>
                ))}
              </div>
              <div className="row gap small">
                <label className="chk" title="Claude receives rendered frames of the scenes it edits">
                  <input type="checkbox" checked={look} onChange={(e) => setLook(e.target.checked)} disabled={!!busy} /> Claude sees the frames
                </label>
                <label className="chk" title="After the edit, Claude looks at the new frames and fixes what is off (a second request: about twice the tokens and the time)">
                  <input type="checkbox" checked={check} onChange={(e) => setCheck(e.target.checked)} disabled={!!busy} /> Check the result
                </label>
                <label className="chk" title="Claude may search the web for staging and editing ideas (search results add many tokens)">
                  <input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} disabled={!!busy} /> Web ideas
                </label>
              </div>
              <div className="row gap small">
                <div className="segmented" role="radiogroup" aria-label="Model">
                  {MODEL_CHOICES.filter((m) => !status?.models || status.models.includes(m.id)).map((m) => (
                    <button key={m.id} role="radio" aria-checked={model === m.id} className={model === m.id ? 'on' : ''} title={m.title} onClick={() => setModel(m.id)} disabled={!!busy}>
                      {m.label}
                    </button>
                  ))}
                </div>
                <div className="segmented" role="radiogroup" aria-label="Thinking">
                  {(['low', 'medium', 'high'] as const).map((e) => (
                    <button key={e} role="radio" aria-checked={effort === e} className={effort === e ? 'on' : ''} title="How long Claude thinks before answering: higher costs more output tokens" onClick={() => setEffort(e)} disabled={!!busy}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>
              <p className="muted small">
                About {look ? (target === 'all' ? project.scenes.length * FRAMES_ALL : FRAMES_SCENE) * (check ? 2 : 1) : 0} frames sent
                {check ? ', two requests' : ', one request'}.
              </p>
              <div className="iactions">
                {busy ? (
                  <>
                    <span className="ai-busy">
                      {painting ?? `Claude is working on ${what(busy.target)}…`} {elapsed}s
                    </span>
                    <button className="btn small ghost" onClick={() => abort.current?.abort()}>
                      Stop
                    </button>
                  </>
                ) : (
                  <button className="btn primary small" onClick={() => void run()} disabled={!prompt.trim()}>
                    Apply with Claude
                  </button>
                )}
                {engine && <span className="muted small">{engine}</span>}
              </div>
              {error && <p className="warn-text">{error}</p>}
              {error && spent && (
                <p className="muted small">
                  Spent anyway: {fmtK(spent.input + spent.cacheWrite)} new in · {fmtK(spent.cacheRead)} cached in · {fmtK(spent.output)} out
                  {spent.cost !== undefined ? ` · $${spent.cost.toFixed(3)}` : ''}
                </p>
              )}
              {last && (
                <div className="ai-result">
                  <p>{last.summary}</p>
                  <p className="muted small">
                    {describeChanges(last)}
                    {last.attempts > 1 ? ' (second try)' : ''} · {last.model}
                  </p>
                  {spent && (
                    <p className="muted small" title="New input is billed in full, cached input at about a tenth">
                      Tokens: {fmtK(spent.input + spent.cacheWrite)} new in · {fmtK(spent.cacheRead)} cached in · {fmtK(spent.output)} out
                      {spent.cost !== undefined ? ` · $${spent.cost.toFixed(3)}` : ''}
                      {review ? ' (edit + check)' : ''}
                    </p>
                  )}
                  {paintFailed.length > 0 && <p className="warn-text small">Some pictures could not be painted: {paintFailed.join('; ')}</p>}
                  {review && (
                    <p className="small">
                      <strong>Check:</strong> {review.summary}
                      {changesAnything(review) ? ` (${describeChanges(review).toLowerCase()})` : ''}
                    </p>
                  )}
                  {undoSteps > 0 && (
                    <button
                      className="btn small ghost"
                      onClick={() => {
                        for (let i = 0; i < undoSteps; i++) onUndo();
                        setLast(null);
                        setReview(null);
                        setUndoSteps(0);
                      }}
                    >
                      Undo this change
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** One line about what an answer changed. */
function describeChanges(r: AiResult): string {
  const parts: string[] = [];
  if (r.scenes.length) parts.push(`changed scene${r.scenes.length > 1 ? 's' : ''} ${r.scenes.map((c) => c.index + 1).join(', ')}`);
  if (r.newScenes?.length) parts.push(`added ${r.newScenes.length} scene${r.newScenes.length > 1 ? 's' : ''}`);
  if (r.order?.length) parts.push('new scene order');
  if (r.episode) parts.push(`episode: ${Object.keys(r.episode).join(', ')}`);
  if (r.images?.length) parts.push(`${r.images.length} new picture${r.images.length > 1 ? 's' : ''}`);
  const text = parts.join(' · ') || 'nothing changed';
  return text[0].toUpperCase() + text.slice(1);
}
