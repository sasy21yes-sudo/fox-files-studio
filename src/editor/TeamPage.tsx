import { useEffect, useMemo, useRef, useState } from 'react';

/** One message of the review team's chat (tools/team/chat.mjs). */
interface TeamMessage {
  id: number;
  ts: string;
  from: string;
  to: string;
  kind: 'finding' | 'fix' | 'question' | 'answer' | 'note';
  sev?: 'B' | 'I' | 'R';
  at?: number;
  img?: string;
  reply?: number;
  text: string;
}

/** A review running on the dev server (tools/vite/teamReview.ts). */
interface Job {
  state: 'kit' | 'review' | 'done' | 'error';
  lang: string;
  aspect: string;
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

/** Who is in the chat: the agents in .claude/agents, the producer (Claude) and Salvatore. */
const ROSTER: Record<string, { name: string; role: string; does: string; color: string }> = {
  producer: { name: 'Producer', role: 'Claude, coordina e corregge', does: 'Coordina tutta la squadra: sceglie gli agenti che servono e unisce i risultati', color: '#d9b465' },
  rig: { name: 'Rig', role: 'animazione del personaggio', does: 'Guanti, braccia, bocca, occhi, cappello e movimenti di Agent Fox', color: '#d08a3a' },
  viewer: { name: 'Spettatore', role: 'prima visione', does: 'Ti dice dove si annoierebbe, si confonderebbe o chiuderebbe il video', color: '#8fb3d9' },
  social: { name: 'Social', role: 'YouTube e Short', does: 'Gancio iniziale, titolo, miniatura, Short: è pronto da pubblicare?', color: '#c77dba' },
  editor: { name: 'Montatore', role: 'montaggio e ritmo', does: 'Tagli, inquadrature, tempi dei pop-up e dei sottotitoli', color: '#7fc4a8' },
  sound: { name: 'Suono', role: 'voce, musica, effetti', does: 'Volumi, voce sopra la musica, effetti sonori al momento giusto', color: '#9b8fe0' },
  facts: { name: 'Fatti', role: 'verifica delle fonti', does: 'Controlla ogni fatto, numero e citazione contro le fonti', color: '#e0c25a' },
  art: { name: 'Art director', role: 'stile e immagini', does: 'Coerenza con lo stile anni 30, inquadrature, leggibilità dei testi', color: '#e08a7a' },
  l10n: { name: 'Lingue', role: 'traduzioni e accessibilità', does: 'Le 5 lingue: testi tradotti, che stanno nei riquadri, pronuncia', color: '#7dbbd0' },
  salvatore: { name: 'Salvatore', role: 'regista', does: '', color: '#7d9b5a' },
};
const person = (id: string) => ROSTER[id] ?? { name: id, role: '', does: '', color: '#998a70' };
const SEV: Record<string, string> = { B: 'bloccante', I: 'importante', R: 'rifinitura' };
const KIND_NOTE: Record<string, string> = { question: 'domanda', answer: 'risposta', note: 'nota' };
const LANGS = ['it', 'en', 'es', 'fr', 'pt'] as const;
const POLL_MS = 3000;

interface Props {
  /** Open the editor at this second of the episode. */
  onSeek(t: number): void;
  /** Open the Channel page on the YouTube preview. */
  onChannelPreview?(): void;
}

const since = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'adesso' : `${m} min fa`;
};

/** The Team page: the review agents' chat, WhatsApp-style, live while they work. Salvatore can write in it too. */
export function TeamPage({ onSeek, onChannelPreview }: Props) {
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [offline, setOffline] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<TeamMessage | null>(null);
  /** Private chats: the agent answers at once (Claude Code, Sonnet, low effort); deep lets it read the files. */
  const [live, setLive] = useState(true);
  const [deep, setDeep] = useState(false);
  const [typing, setTyping] = useState<Record<string, boolean>>({});
  const [askError, setAskError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [lang, setLang] = useState<string>('it');
  const [aspect, setAspect] = useState<string>('16:9');
  const dm = filter !== 'all';
  const last = useRef(0);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    let stop = false;
    // Live first: the dev server pushes new messages the moment the chat file changes.
    if (typeof EventSource !== 'undefined') {
      const es = new EventSource(`/api/team/stream?since=${last.current}`);
      es.onopen = () => setOffline(false);
      es.onmessage = (e) => {
        const fresh = JSON.parse(e.data) as TeamMessage[];
        const novel = fresh.filter((m) => m.id > last.current);
        if (!novel.length) return;
        last.current = novel[novel.length - 1].id;
        setMessages((m) => [...m, ...novel]);
      };
      es.onerror = () => setOffline(es.readyState === EventSource.CLOSED);
      return () => es.close();
    }
    const poll = async () => {
      try {
        const r = await fetch(`/api/team/chat?since=${last.current}`);
        if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) throw new Error();
        const { messages: fresh } = (await r.json()) as { messages: TeamMessage[] };
        setOffline(false);
        if (fresh.length && !stop) {
          last.current = fresh[fresh.length - 1].id;
          setMessages((m) => [...m, ...fresh]);
        }
      } catch {
        setOffline(true);
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, []);

  // Reviews in progress (a few bytes every few seconds).
  useEffect(() => {
    const poll = () =>
      void fetch('/api/team/jobs')
        .then(async (r) => (r.ok ? setJobs((await r.json()) as Record<string, Job>) : undefined))
        .catch(() => undefined);
    poll();
    const id = window.setInterval(poll, 4000);
    return () => window.clearInterval(id);
  }, []);

  // Everyone: the whole team chat. An agent: the private chat between Salvatore and that agent only.
  const shown = useMemo(
    () => (filter === 'all' ? messages : messages.filter((m) => (m.from === 'salvatore' && m.to === filter) || (m.from === filter && m.to === 'salvatore'))),
    [messages, filter],
  );
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of messages) c[m.from] = (c[m.from] ?? 0) + 1;
    return c;
  }, [messages]);
  const open = messages.filter((m) => m.kind === 'finding' && !messages.some((x) => x.kind === 'fix' && x.reply === m.id));
  const working = (id: string) => jobs[id]?.state === 'kit' || jobs[id]?.state === 'review';

  useEffect(() => {
    if (stick.current && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [shown.length]);

  const startReview = async (agent: string) => {
    setAskError(null);
    const r = await fetch('/api/team/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent, lang, aspect }) }).catch(() => null);
    if (!r?.ok) setAskError((await r?.json().catch(() => null))?.error ?? 'Il server non risponde (npm run dev).');
    else setJobs((j) => ({ ...j, [agent]: { state: 'kit', lang, aspect, startedAt: Date.now() } }));
  };

  const send = async () => {
    if (!text.trim()) return;
    const agent = filter;
    const r = await fetch('/api/team/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.trim(), to: dm ? agent : 'all', reply: replyTo?.id }),
    });
    if (!r.ok) return;
    const { message } = (await r.json()) as { message: TeamMessage };
    setText('');
    setReplyTo(null);
    stick.current = true;
    if (!dm || !live) return;
    setAskError(null);
    setTyping((t) => ({ ...t, [agent]: true }));
    try {
      const a = await fetch('/api/team/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent, id: message.id, deep }) });
      if (!a.ok) setAskError((await a.json().catch(() => ({ error: `HTTP ${a.status}` }))).error);
    } catch (e) {
      setAskError(String(e));
    } finally {
      setTyping((t) => ({ ...t, [agent]: false }));
    }
  };

  const status = (id: string) => {
    const j = jobs[id];
    if (typing[id]) return 'sta scrivendo…';
    if (j?.state === 'kit') return `prepara il kit · ${since(j.startedAt)}`;
    if (j?.state === 'review') return `review in corso · ${since(j.startedAt)}`;
    return person(id).role;
  };

  return (
    <main className="team-page">
      <aside className="team-people" aria-label="Squadra">
        <button className={`team-person ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>
          <span className="team-avatar" style={{ background: '#3d3228' }}>★</span>
          <span>
            <strong>Tutti</strong>
            <small>
              chat di squadra · {messages.length} messaggi · {open.length} problemi aperti
            </small>
          </span>
        </button>
        {Object.entries(ROSTER)
          .filter(([id]) => id !== 'salvatore')
          .map(([id, p]) => (
            <button key={id} className={`team-person ${filter === id ? 'on' : ''}`} onClick={() => setFilter(id)} title={`Chat privata con ${p.name}: ${p.does}`}>
              <span className={`team-avatar ${working(id) ? 'busy' : ''}`} style={{ background: p.color }}>
                {p.name[0]}
              </span>
              <span>
                <strong>{p.name}</strong>
                <small className={working(id) ? 'team-working' : ''}>{status(id)}</small>
              </span>
              {counts[id] ? <span className="team-count">{counts[id]}</span> : null}
            </button>
          ))}
      </aside>

      <section className="team-chat" aria-label="Chat">
        <header className="team-head">
          <strong>{filter === 'all' ? 'Tutti' : `${person(filter).name} · chat privata`}</strong>
          {dm && typing[filter] && <span className="team-typing">{person(filter).name} sta scrivendo…</span>}
          {onChannelPreview && (
            <button className="btn small ghost team-yt" onClick={onChannelPreview} title="La pagina del canale con banner e icona">
              Anteprima YouTube
            </button>
          )}
          <span className="muted small">{offline ? 'chat non raggiungibile (avvia npm run dev)' : 'in diretta'}</span>
        </header>

        {dm && (
          <div className="team-review-bar">
            <div>
              <strong>{person(filter).name}</strong> <span className="muted">· {person(filter).does}</span>
            </div>
            <div className="team-review-actions">
              <select className="isel" value={lang} onChange={(e) => setLang(e.target.value)} title="Lingua del video da controllare">
                {LANGS.map((l) => (
                  <option key={l} value={l}>
                    {l.toUpperCase()}
                  </option>
                ))}
              </select>
              <select className="isel" value={aspect} onChange={(e) => setAspect(e.target.value)} title="Formato">
                <option value="16:9">16:9 YouTube</option>
                <option value="9:16">9:16 Short</option>
              </select>
              <button
                className="btn small primary"
                disabled={working(filter)}
                onClick={() => void startReview(filter)}
                title={filter === 'producer' ? 'Review di squadra: il producer sceglie e fa lavorare gli agenti che servono (costa di più)' : 'L’agente prepara il kit se serve, controlla il video e scrive qui i problemi'}
              >
                {working(filter) ? (jobs[filter].state === 'kit' ? 'Prepara il kit…' : 'Review in corso…') : '▶ Avvia review'}
              </button>
            </div>
          </div>
        )}

        <div
          className="team-list"
          ref={list}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
        >
          {!shown.length && (
            <p className="muted team-empty">
              {dm ? `Scrivi a ${person(filter).name} o premi “Avvia review”: per esempio “fai la review della scena dell’ospedale”.` : 'Nessun messaggio. Apri un agente a sinistra e avvia una review: la squadra parla qui.'}
            </p>
          )}
          {shown.map((m, i) => {
            const p = person(m.from);
            const mine = m.from === 'salvatore';
            const day = new Date(m.ts).toLocaleDateString('it-IT');
            const newDay = i === 0 || new Date(shown[i - 1].ts).toLocaleDateString('it-IT') !== day;
            const quoted = m.reply ? byId.get(m.reply) : undefined;
            return (
              <div key={m.id}>
                {newDay && <div className="team-day">{day}</div>}
                <div className={`team-msg ${mine ? 'mine' : ''} ${m.kind}`}>
                  {!mine && (
                    <span className="team-avatar small" style={{ background: p.color }} title={p.role}>
                      {p.name[0]}
                    </span>
                  )}
                  <div className="team-bubble">
                    <div className="team-meta">
                      {!mine && <strong style={{ color: p.color }}>{p.name}</strong>}
                      {m.to !== 'all' && <span className="muted"> → {person(m.to).name}</span>}
                      {m.sev && <span className={`team-sev sev-${m.sev}`}>{SEV[m.sev]}</span>}
                      {m.kind === 'fix' && <span className="team-sev sev-fix">corretto</span>}
                      {!m.sev && KIND_NOTE[m.kind] && !mine && <span className="muted"> · {KIND_NOTE[m.kind]}</span>}
                    </div>
                    {quoted && (
                      <div className="team-quote" style={{ borderColor: person(quoted.from).color }}>
                        <strong>{person(quoted.from).name}</strong> {quoted.text.length > 120 ? `${quoted.text.slice(0, 118)}…` : quoted.text}
                      </div>
                    )}
                    <p>
                      {m.at !== undefined && (
                        <button className="team-at" onClick={() => onSeek(m.at!)} title="Apri l'editor in questo punto">
                          {m.at.toFixed(1)} s
                        </button>
                      )}
                      {m.text}
                    </p>
                    {m.img && (
                      <a href={`/api/team/file?p=${encodeURIComponent(m.img)}`} target="_blank" rel="noreferrer">
                        <img className="team-img" src={`/api/team/file?p=${encodeURIComponent(m.img)}`} alt={m.img} loading="lazy" />
                      </a>
                    )}
                    <div className="team-foot">
                      <button className="team-reply" onClick={() => setReplyTo(m)}>
                        Rispondi
                      </button>
                      <span>
                        #{m.id} · {new Date(m.ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <footer className="team-compose">
          {replyTo && (
            <div className="team-quote composing" style={{ borderColor: person(replyTo.from).color }}>
              <strong>{person(replyTo.from).name}</strong> {replyTo.text.slice(0, 100)}
              <button className="btn small ghost" onClick={() => setReplyTo(null)} aria-label="Annulla risposta">
                ×
              </button>
            </div>
          )}
          {dm && (
            <div className="row gap small team-dm-opts">
              <label className="chk" title="L'agente risponde subito (Claude Code, Sonnet, poco ragionamento: poche migliaia di token). Se gli chiedi una review, la avvia davvero.">
                <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Risposta immediata
              </label>
              <label className="chk" title="Può aprire i file del progetto per rispondere (Read, Grep, Glob): più token">
                <input type="checkbox" checked={deep} disabled={!live} onChange={(e) => setDeep(e.target.checked)} /> Può leggere i file
              </label>
              {askError && <span className="warn-text">{askError}</span>}
            </div>
          )}
          <div className="row gap">
            <textarea
              className="itext"
              rows={2}
              value={text}
              placeholder={
                dm
                  ? `Scrivi a ${person(filter).name}… (Invio per mandare)${live ? ' - risponde qui; “fai la review” la avvia' : ' - lo leggerà alla prossima review'}`
                  : 'Scrivi a tutti… (Invio manda, Maiusc+Invio va a capo). La squadra lo legge al prossimo giro.'
              }
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button className="btn primary" onClick={() => void send()} disabled={!text.trim()}>
              Invia
            </button>
          </div>
        </footer>
      </section>
    </main>
  );
}
