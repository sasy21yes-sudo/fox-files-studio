import { useEffect, useRef, useState } from 'react';
import type { MediaItem, Project } from '../types';
import { IMAGE_STYLES, generateImage, imageStatus, type ImageAspect, type ImageStatus, type ImageStyle } from '../ai/localImage';
import { addMedia, mediaImage } from '../media/store';
import { useMediaVersion } from '../media/useMedia';

type Change = (fn: (p: Project) => Project, key?: string) => void;

interface Props {
  project: Project;
  onChange: Change;
  /** Put the image into the selected scene (absent where there is no scene selection). */
  onAddToScene?(item: MediaItem): void;
  addLabel?: string;
  /** Insert a cutaway scene made of the image. */
  onPictureScene(item: MediaItem): void;
  compact?: boolean;
}

const EXAMPLES = [
  'A dim government archive with tall metal shelves of cardboard file boxes and a single hanging bulb',
  'A 1950s laboratory at night: a long bench with glass flasks, a reel-to-reel recorder, venetian blinds',
  'The Capitol dome at dusk under heavy clouds, seen from a rainy street with old cars',
  'A safe-house apartment in 1950s San Francisco: a living room with a two-way mirror, a cocktail bar',
];

function Thumb({ item }: { item: MediaItem }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const version = useMediaVersion();
  const img = mediaImage(item.id);
  const w = 160;
  const h = Math.round((w * item.height) / item.width);
  useEffect(() => {
    const g = ref.current?.getContext('2d');
    if (!g) return;
    g.fillStyle = '#2a1d12';
    g.fillRect(0, 0, w, h);
    if (img) g.drawImage(img, 0, 0, w, h);
  }, [img, version, w, h]);
  return <canvas ref={ref} width={w} height={h} className="img-thumb" aria-hidden="true" />;
}

/** The episode's images: generate with the local model, import files, use them in scenes. */
export function ImageBin({ project, onChange, onAddToScene, addLabel = 'Add to scene', onPictureScene, compact }: Props) {
  const [status, setStatus] = useState<ImageStatus | null>(null);
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState<ImageStyle>('cartoon');
  const [aspect, setAspect] = useState<ImageAspect>(project.settings.aspect);
  const [busy, setBusy] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const media = project.media ?? [];

  useEffect(() => {
    void imageStatus().then(setStatus);
  }, []);
  useEffect(() => {
    if (busy === null) return;
    const id = window.setInterval(() => setElapsed(Math.round((Date.now() - busy) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [busy]);

  const add = (item: MediaItem) => onChange((p) => ({ ...p, media: [item, ...(p.media ?? [])] }), `media:add:${item.id}`);

  const generate = async (text = prompt, seed?: number) => {
    if (!text.trim() || busy !== null) return;
    setBusy(Date.now());
    setElapsed(0);
    setError(null);
    abort.current = new AbortController();
    try {
      const r = await generateImage({ prompt: text.trim(), style, aspect, seed }, abort.current.signal);
      const name = text.trim().replace(/\s+/g, ' ').slice(0, 48) + (text.trim().length > 48 ? '…' : '');
      const item = await addMedia(r.blob, { name, source: 'generated', prompt: text.trim(), style, seed: r.seed });
      add(item);
      setOpen(item.id);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      abort.current = null;
    }
  };

  const importFile = async (f: File) => {
    setError(null);
    try {
      add(await addMedia(f, { name: f.name.replace(/\.[^.]+$/, ''), source: 'imported' }));
    } catch {
      setError(`“${f.name}” is not an image this browser can read.`);
    }
  };

  return (
    <div className={`image-bin ${compact ? 'compact' : ''}`}>
      {status?.available ? (
        <div className="img-gen">
          <textarea
            className="itext"
            rows={compact ? 3 : 2}
            value={prompt}
            placeholder="Describe the picture: place, objects, light, mood… (Ctrl+Enter)"
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void generate();
            }}
            disabled={busy !== null}
          />
          <div className="img-opts">
            <select className="isel" value={style} onChange={(e) => setStyle(e.target.value as ImageStyle)} disabled={busy !== null} aria-label="Style">
              {(Object.keys(IMAGE_STYLES) as ImageStyle[]).map((k) => (
                <option key={k} value={k}>
                  {IMAGE_STYLES[k]}
                </option>
              ))}
            </select>
            <select className="isel" value={aspect} onChange={(e) => setAspect(e.target.value as ImageAspect)} disabled={busy !== null} aria-label="Shape">
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="1:1">1:1</option>
            </select>
            {busy !== null ? (
              <>
                <span className="ai-busy">Painting… {elapsed}s</span>
                <button className="btn small ghost" onClick={() => abort.current?.abort()}>
                  Stop
                </button>
              </>
            ) : (
              <button className="btn primary small" onClick={() => void generate()} disabled={!prompt.trim()}>
                Generate
              </button>
            )}
          </div>
          {!prompt && (
            <div className="ichips">
              {EXAMPLES.slice(0, compact ? 2 : 4).map((x) => (
                <button key={x} className="chip" onClick={() => setPrompt(x)}>
                  {x.length > 44 ? `${x.slice(0, 42)}…` : x}
                </button>
              ))}
            </div>
          )}
          <p className="help small">
            Local model (Qwen-Image in ComfyUI), about 30 s per picture, queued ahead of other renders. Pictures never contain text: add words with stamps,
            papers or pop-ups. They are illustrations, not archive photos, so never present them as documents.
          </p>
        </div>
      ) : (
        status && (
          <p className="help small">
            {status.devServer
              ? `The local image model is not reachable (${status.url}). Start ComfyUI to generate pictures; importing files works anyway.`
              : 'Generating pictures needs the studio running locally with npm run dev and ComfyUI. Importing files works anyway.'}
          </p>
        )
      )}
      {error && <p className="warn-text">{error}</p>}
      <div className="iactions">
        <button className="btn small ghost" onClick={() => fileRef.current?.click()}>
          Import image…
        </button>
        <span className="muted small">
          {media.length} image{media.length === 1 ? '' : 's'}
        </span>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            for (const f of files) await importFile(f);
          }}
        />
      </div>
      <div className="img-grid">
        {media.map((m) => (
          <figure key={m.id} className={`img-card ${open === m.id ? 'open' : ''}`}>
            <button className="img-pick" onClick={() => setOpen(open === m.id ? null : m.id)} title={m.prompt ?? m.name}>
              <Thumb item={m} />
              <figcaption>
                {m.name}
                <span className="muted small">
                  {' '}
                  · {m.width}×{m.height}
                  {m.source === 'generated' ? ' · AI' : ''}
                </span>
              </figcaption>
            </button>
            {open === m.id && (
              <div className="img-actions">
                {onAddToScene && (
                  <button className="btn small" onClick={() => onAddToScene(m)}>
                    {addLabel}
                  </button>
                )}
                <button className="btn small" onClick={() => onPictureScene(m)}>
                  Picture scene
                </button>
                {m.prompt && (
                  <button className="btn small ghost" disabled={busy !== null || !status?.available} onClick={() => void generate(m.prompt, undefined)} title="Same prompt, new seed">
                    Variation
                  </button>
                )}
                {m.prompt && (
                  <button className="btn small ghost" onClick={() => setPrompt(m.prompt ?? '')}>
                    Edit prompt
                  </button>
                )}
                <button
                  className="btn small ghost danger"
                  onClick={() => onChange((p) => ({ ...p, media: (p.media ?? []).filter((x) => x.id !== m.id) }), `media:del:${m.id}`)}
                  title="Remove from this episode (scenes using it show a placeholder; Undo brings it back)"
                >
                  Remove
                </button>
              </div>
            )}
          </figure>
        ))}
      </div>
    </div>
  );
}
