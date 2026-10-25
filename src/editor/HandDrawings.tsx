import { useEffect, useState } from 'react';
import { builtInArm } from '../character/AgentFox';
import { tweaks } from '../character/rig/tweaks';
import { ARM_MODES } from '../scene/elements';

interface Version {
  version: string;
  file: string;
  status: string;
  review: string;
}
interface Hand {
  key: string;
  piece: string;
  side: 'back' | 'front';
  /** The rig glove baked from it (hand_<sprite>.webp). */
  sprite: string;
  versions: Version[];
}

const label = (h: Hand) => `${h.piece.replace(/_/g, ' ')} · ${h.side === 'back' ? 'back of hand' : 'palm'}`;

/** Which arm poses draw this glove (built-in table plus the Hands tweaks). */
function usedBy(sprite: string): string[] {
  const out: string[] = [];
  for (const side of ['far', 'near'] as const) {
    for (const m of ARM_MODES) {
      const hand = tweaks().arms[side][m]?.hand ?? builtInArm(side, m).hand;
      if (hand === sprite) out.push(`${side === 'far' ? 'right' : 'left'} ${m}`);
    }
  }
  return [...new Set(out)];
}

/**
 * Agent Fox's gloves, like the Mouths tab: every new glove drawing (back of the hand and palm) with all its
 * renders. Regenerate asks the local image model for new versions (with an optional note on what to fix); Use
 * this one approves a version and re-bakes the rig's gloves (dev server).
 */
export function HandDrawings() {
  const [hands, setHands] = useState<Hand[]>([]);
  const [sel, setSel] = useState('hands_new_back/one');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [baked, setBaked] = useState(0);

  const load = async () => {
    try {
      const r = await fetch('/api/rig/hands');
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) throw new Error('needs npm run dev');
      setHands(((await r.json()) as { hands: Hand[] }).hands);
    } catch (e) {
      setError(`Hand tools unavailable: ${e instanceof Error ? e.message : String(e)}`);
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

  const h = hands.find((x) => x.key === sel);
  const approved = h?.versions.filter((v) => v.status === 'approved' || v.status === 'final').pop();
  const users = h ? usedBy(h.sprite) : [];
  return (
    <div className="mouthlab">
      <div className="mouth-list">
        {hands.map((x) => {
          const ok = x.versions.some((v) => v.status === 'approved' || v.status === 'final');
          return (
            <button key={x.key} className={`shape ${x.key === sel ? 'on' : ''}`} onClick={() => setSel(x.key)}>
              <i style={{ background: ok ? '#6fbf73' : '#c0563f' }} />
              {label(x)}
            </button>
          );
        })}
      </div>
      <div className="mouth-detail">
        {error && <p className="warn-text">{error}</p>}
        {h && (
          <>
            <h3>{label(h)}</h3>
            <div className="row gap" style={{ alignItems: 'center' }}>
              <img className="hand-baked" src={`/src/character/rig/hand_${h.sprite}.webp?b=${baked}`} alt={`hand_${h.sprite} in the rig`} />
              <p className="help small">
                {approved ? `In the rig: ${approved.version} (hand_${h.sprite}).` : 'No version in use yet.'}{' '}
                {users.length ? `Used by: ${users.join(', ')}.` : 'No pose uses this glove yet (pick it in the Fit tab).'} Regenerate makes new versions with the
                local image model (about a minute each); “Use this one” cuts the glove from it and rebuilds the rig.
              </p>
            </div>
            <div className="row gap wrap">
              <input
                className="itext"
                style={{ flex: 1, minWidth: 240 }}
                value={note}
                placeholder="What to fix (optional), e.g. back of the hand, knuckles visible, thumb toward the body"
                onChange={(e) => setNote(e.target.value)}
                disabled={!!busy}
              />
              <button className="btn primary small" disabled={!!busy} onClick={() => void post('/api/rig/hands/regenerate', { key: h.key, count: 2, note }, `Rendering ${label(h)}…`)}>
                Regenerate (2)
              </button>
            </div>
            {busy && <p className="ai-busy">{busy}</p>}
            <div className="mouth-grid">
              {[...h.versions].reverse().map((v) => (
                <figure key={v.version} className={`mouth-card ${v.status}`}>
                  <img src={`/api/rig/piece?file=${encodeURIComponent(v.file)}`} alt={`${label(h)} ${v.version}`} loading="lazy" />
                  <figcaption>
                    <b>{v.version}</b> · {v.status}
                    {v.review && <span className="muted small"> — {v.review}</span>}
                  </figcaption>
                  {v.status !== 'approved' && v.status !== 'final' && (
                    <button
                      className="btn small"
                      disabled={!!busy}
                      onClick={async () => {
                        if (await post('/api/rig/hands/apply', { key: h.key, version: v.version }, `Rebuilding the gloves with ${v.version}…`)) setBaked(Date.now());
                      }}
                    >
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
