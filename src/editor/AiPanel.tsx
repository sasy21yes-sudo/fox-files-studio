import { useEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import { aiStatus, editSceneWithClaude, type AiResult, type AiStatus } from '../ai/claude';
import { MAX_SCENE_DURATION, MIN_SCENE_DURATION } from '../data/project';
import { updateScene } from './model';
import { withBeats } from './Inspector';

type Change = (fn: (p: Project) => Project, key?: string) => void;

interface Props {
  project: Project;
  scene: number;
  onChange: Change;
  onUndo(): void;
}

const EXAMPLES = [
  'Più drammatico: anticipazione prima della caduta della cartella e un primo piano sulla sua reazione',
  'Aggiungi un timbro CLASSIFIED quando dice “destroyed”',
  'Fallo entrare da destra invece che da sinistra',
  'Più inquadrature: un taglio ogni 2-3 secondi',
];

/** Apply Claude's scene as one undoable edit. */
function applyResult(p: Project, index: number, r: AiResult): Project {
  return updateScene(p, index, (s) => {
    const patch: Partial<typeof s> = { spec: r.spec, ...(r.beats ? withBeats(s, p.settings.language, r.beats) : {}) };
    if (r.duration && Math.abs(r.duration - s.duration) > 0.05) {
      const d = Math.min(MAX_SCENE_DURATION, Math.max(MIN_SCENE_DURATION, r.duration));
      patch.duration = d;
      // Custom scenes are authored in real seconds: keep the choreography unstretched.
      if (Math.abs(s.authoredDuration - s.duration) < 0.05) patch.authoredDuration = d;
    }
    return patch;
  });
}

/** "Ask Claude" box: edit the selected scene with a prompt. */
export function AiPanel({ project, scene, onChange, onUndo }: Props) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [open, setOpen] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{ scene: number; result: AiResult } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const sc = project.scenes[scene];

  useEffect(() => {
    void aiStatus().then(setStatus);
  }, []);

  const run = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    setLast(null);
    abort.current = new AbortController();
    try {
      const result = await editSceneWithClaude(project, scene, prompt.trim(), abort.current.signal);
      onChange((p) => applyResult(p, scene, result), `ai:${Date.now()}`);
      setLast({ scene, result });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  return (
    <section className={`ai-panel ${open ? 'open' : ''}`} aria-label="Edit with Claude">
      <button className="ai-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="ai-spark" aria-hidden="true">✦</span> Ask Claude <span className="muted small">· scene {scene + 1}</span>
        <span className="chev">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="ai-body">
          {status && !status.available ? (
            <p className="help">
              {status.devServer ? (
                <>
                  Add <code>ANTHROPIC_API_KEY=…</code> to the <code>.env</code> file and restart <code>npm run dev</code>.
                </>
              ) : (
                <>Prompt editing works when the studio runs locally with <code>npm run dev</code> (the API key stays on your computer).</>
              )}
            </p>
          ) : (
            <>
              {!sc.spec && <p className="warn-text">This scene is hand-coded: Claude will build a new data version of it (Undo brings the original back).</p>}
              <textarea
                className="itext ai-prompt"
                rows={3}
                value={prompt}
                placeholder="Describe the change… (Ctrl+Enter)"
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void run();
                }}
                disabled={busy}
              />
              <div className="ichips">
                {EXAMPLES.map((x) => (
                  <button key={x} className="chip" onClick={() => setPrompt(x)} disabled={busy}>
                    {x.length > 42 ? `${x.slice(0, 40)}…` : x}
                  </button>
                ))}
              </div>
              <div className="iactions">
                {busy ? (
                  <>
                    <span className="ai-busy">Claude is working on scene {scene + 1}…</span>
                    <button className="btn small ghost" onClick={() => abort.current?.abort()}>
                      Stop
                    </button>
                  </>
                ) : (
                  <button className="btn primary small" onClick={() => void run()} disabled={!prompt.trim()}>
                    Apply with Claude
                  </button>
                )}
                {status?.model && <span className="muted small">{status.model}</span>}
              </div>
              {error && <p className="warn-text">{error}</p>}
              {last && (
                <div className="ai-result">
                  <p>{last.result.summary}</p>
                  <p className="muted small">
                    Applied to scene {last.scene + 1}
                    {last.result.attempts > 1 ? ' (second try)' : ''} · {last.result.usage.input + last.result.usage.cacheRead} in /{' '}
                    {last.result.usage.output} out tokens{last.result.usage.cacheRead ? ` (${last.result.usage.cacheRead} cached)` : ''}
                  </p>
                  <button
                    className="btn small ghost"
                    onClick={() => {
                      onUndo();
                      setLast(null);
                    }}
                  >
                    Undo this change
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
