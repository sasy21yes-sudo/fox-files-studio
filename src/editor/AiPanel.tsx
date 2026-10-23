import { useEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import type { Timeline } from '../animation/timeline';
import { aiStatus, editWithClaude, type AiResult, type AiStatus, type AiTarget } from '../ai/claude';
import { applyClaudeResult, changesAnything, paintImages } from '../ai/applyClaude';

type Change = (fn: (p: Project) => Project, key?: string) => void;

interface Props {
  project: Project;
  timeline: Timeline;
  scene: number;
  onChange: Change;
  onUndo(): void;
}

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
export function AiPanel({ project, timeline, scene, onChange, onUndo }: Props) {
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
    abort.current = new AbortController();
    try {
      const result = await editWithClaude(project, target, prompt.trim(), abort.current.signal, timeline);
      setPaintFailed([]);
      let painted = {};
      if (result.images?.length) {
        const out = await paintImages(result, (done, total, what) => setPainting(done < total ? `Painting picture ${done + 1} of ${total}: ${what.slice(0, 60)}…` : null), abort.current.signal);
        painted = out.items;
        setPaintFailed(out.failed);
        setPainting(null);
      }
      if (changesAnything(result)) onChange((p) => applyClaudeResult(p, result, painted), `ai:${Date.now()}`);
      setLast(result);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : String(e));
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
                {status?.model && (
                  <span className="muted small">
                    {engine && `${engine} · `}
                    {status.model}
                  </span>
                )}
              </div>
              {error && <p className="warn-text">{error}</p>}
              {last && (
                <div className="ai-result">
                  <p>{last.summary}</p>
                  <p className="muted small">
                    {describeChanges(last)}
                    {last.attempts > 1 ? ' (second try)' : ''} · {last.usage.input + last.usage.cacheRead + last.usage.cacheWrite} in / {last.usage.output} out tokens
                  </p>
                  {paintFailed.length > 0 && <p className="warn-text small">Some pictures could not be painted: {paintFailed.join('; ')}</p>}
                  {changesAnything(last) && (
                    <button
                      className="btn small ghost"
                      onClick={() => {
                        onUndo();
                        setLast(null);
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
