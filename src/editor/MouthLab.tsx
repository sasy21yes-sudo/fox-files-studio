import { useEffect, useState } from 'react';

interface Version {
  version: string;
  file: string;
  status: string;
  review: string;
}
interface Mouth {
  key: string;
  label: string;
  kind: 'lip' | 'emotion';
  versions: Version[];
}

/**
 * Agent Fox's mouths: every lip-sync and emotion mouth drawn on the current head, with all its
 * renders. Regenerate asks the local image model for new versions (with an optional note on what to
 * fix); Use this one approves a version, rebuilds the mouth sheet and re-bakes the rig (dev server).
 */
export function MouthLab() {
  const [mouths, setMouths] = useState<Mouth[]>([]);
  const [sel, setSel] = useState('m0');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await fetch('/api/rig/mouths');
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) throw new Error('needs npm run dev');
      setMouths(((await r.json()) as { mouths: Mouth[] }).mouths);
    } catch (e) {
      setError(`Mouth tools unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const post = async (url: string, body: unknown, what: string) => {
    setBusy(what);
    setError(null);
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const m = mouths.find((x) => x.key === sel);
  const approved = m?.versions.filter((v) => v.status === 'approved').pop();
  return (
    <div className="mouthlab">
      <div className="mouth-list">
        {mouths.map((x) => {
          const ok = x.versions.some((v) => v.status === 'approved');
          return (
            <button key={x.key} className={`shape ${x.key === sel ? 'on' : ''}`} onClick={() => setSel(x.key)}>
              <i style={{ background: ok ? '#6fbf73' : '#c0563f' }} />
              {x.label}
            </button>
          );
        })}
      </div>
      <div className="mouth-detail">
        {error && <p className="warn-text">{error}</p>}
        {m && (
          <>
            <h3>{m.label}</h3>
            <p className="help small">
              {approved ? `In use: ${approved.version}.` : 'No version in use yet: this mouth falls back to the closest one.'} Regenerate makes new versions on
              the current head (about 2–4 minutes each); pick one with “Use this one” and the rig is rebuilt with it.
            </p>
            <div className="row gap wrap">
              <input className="itext" style={{ flex: 1, minWidth: 240 }} value={note} placeholder="What to fix (optional), e.g. keep the nose still, open the jaw more" onChange={(e) => setNote(e.target.value)} disabled={!!busy} />
              <button className="btn primary small" disabled={!!busy} onClick={() => void post('/api/rig/mouths/regenerate', { key: m.key, count: 2, note }, `Rendering ${m.label}…`)}>
                Regenerate (2)
              </button>
            </div>
            {busy && <p className="ai-busy">{busy}</p>}
            <div className="mouth-grid">
              {[...m.versions].reverse().map((v) => (
                <figure key={v.version} className={`mouth-card ${v.status}`}>
                  <img src={`/api/rig/piece?file=${encodeURIComponent(v.file)}`} alt={`${m.label} ${v.version}`} loading="lazy" />
                  <figcaption>
                    <b>{v.version}</b> · {v.status}
                    {v.review && <span className="muted small"> — {v.review}</span>}
                  </figcaption>
                  {v.status !== 'approved' && (
                    <button className="btn small" disabled={!!busy} onClick={() => void post('/api/rig/mouths/apply', { key: m.key, version: v.version }, `Rebuilding the rig with ${v.version}…`)}>
                      Use this one
                    </button>
                  )}
                </figure>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
