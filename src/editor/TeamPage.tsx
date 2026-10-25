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

/** Who is in the chat: the agents in .claude/agents, the producer (Claude) and Salvatore. */
const ROSTER: Record<string, { name: string; role: string; color: string }> = {
  producer: { name: 'Producer', role: 'Claude, merges and fixes', color: '#d9b465' },
  rig: { name: 'Rig', role: 'rig-animation-inspector', color: '#d08a3a' },
  viewer: { name: 'Viewer', role: 'first-time-viewer', color: '#8fb3d9' },
  social: { name: 'Social', role: 'social-media-manager', color: '#c77dba' },
  editor: { name: 'Editor', role: 'video-editor', color: '#7fc4a8' },
  sound: { name: 'Sound', role: 'sound-designer', color: '#9b8fe0' },
  facts: { name: 'Facts', role: 'fact-checker', color: '#e0c25a' },
  art: { name: 'Art', role: 'art-director', color: '#e08a7a' },
  l10n: { name: 'L10n', role: 'localization-qa', color: '#7dbbd0' },
  salvatore: { name: 'Salvatore', role: 'director', color: '#7d9b5a' },
};
const person = (id: string) => ROSTER[id] ?? { name: id, role: '', color: '#998a70' };
const SEV: Record<string, string> = { B: 'blocker', I: 'important', R: 'polish' };
const POLL_MS = 3000;

interface Props {
  /** Open the editor at this second of the episode. */
  onSeek(t: number): void;
}

/** The Team page: the review agents' chat, WhatsApp-style, live while they work. Salvatore can write in it too. */
export function TeamPage({ onSeek }: Props) {
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [offline, setOffline] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [text, setText] = useState('');
  const [to, setTo] = useState('all');
  const [replyTo, setReplyTo] = useState<TeamMessage | null>(null);
  const last = useRef(0);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    let stop = false;
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

  const shown = useMemo(
    () => (filter === 'all' ? messages : messages.filter((m) => m.from === filter || m.to === filter)),
    [messages, filter],
  );
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of messages) c[m.from] = (c[m.from] ?? 0) + 1;
    return c;
  }, [messages]);
  const open = messages.filter((m) => m.kind === 'finding' && !messages.some((x) => x.kind === 'fix' && x.reply === m.id));

  useEffect(() => {
    if (stick.current && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [shown.length]);

  const send = async () => {
    if (!text.trim()) return;
    const r = await fetch('/api/team/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.trim(), to, reply: replyTo?.id }),
    });
    if (r.ok) {
      setText('');
      setReplyTo(null);
      stick.current = true;
    }
  };

  return (
    <main className="team-page">
      <aside className="team-people" aria-label="Team">
        <button className={`team-person ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>
          <span className="team-avatar" style={{ background: '#3d3228' }}>★</span>
          <span>
            <strong>Review team</strong>
            <small>
              {messages.length} messages · {open.length} open findings
            </small>
          </span>
        </button>
        {Object.entries(ROSTER).map(([id, p]) => (
          <button key={id} className={`team-person ${filter === id ? 'on' : ''}`} onClick={() => setFilter(id)} title={p.role}>
            <span className="team-avatar" style={{ background: p.color }}>
              {p.name[0]}
            </span>
            <span>
              <strong>{p.name}</strong>
              <small>{p.role}</small>
            </span>
            {counts[id] ? <span className="team-count">{counts[id]}</span> : null}
          </button>
        ))}
      </aside>

      <section className="team-chat" aria-label="Chat">
        <header className="team-head">
          <strong>{filter === 'all' ? 'Review team' : person(filter).name}</strong>
          <span className="muted small">
            {offline ? 'chat not reachable (run npm run dev)' : 'live · agents post with tools/team/chat.mjs'}
          </span>
        </header>
        <div
          className="team-list"
          ref={list}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
        >
          {!shown.length && <p className="muted team-empty">No messages yet. Start a review (“/review-episode”) and the team talks here.</p>}
          {shown.map((m, i) => {
            const p = person(m.from);
            const mine = m.from === 'salvatore';
            const day = new Date(m.ts).toLocaleDateString();
            const newDay = i === 0 || new Date(shown[i - 1].ts).toLocaleDateString() !== day;
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
                      {m.kind === 'fix' && <span className="team-sev sev-fix">fixed</span>}
                    </div>
                    {quoted && (
                      <div className="team-quote" style={{ borderColor: person(quoted.from).color }}>
                        <strong>{person(quoted.from).name}</strong> {quoted.text.length > 120 ? `${quoted.text.slice(0, 118)}…` : quoted.text}
                      </div>
                    )}
                    <p>
                      {m.at !== undefined && (
                        <button className="team-at" onClick={() => onSeek(m.at!)} title="Open the editor here">
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
                        Reply
                      </button>
                      <span>#{m.id} · {new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
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
              <button className="btn small ghost" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
                ×
              </button>
            </div>
          )}
          <div className="row gap">
            <select className="iselect" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To">
              <option value="all">To everyone</option>
              {Object.entries(ROSTER)
                .filter(([id]) => id !== 'salvatore')
                .map(([id, p]) => (
                  <option key={id} value={id}>
                    To {p.name}
                  </option>
                ))}
            </select>
            <textarea
              className="itext"
              rows={2}
              value={text}
              placeholder="Write to the team… (Enter sends, Shift+Enter new line). The producer reads it at the next round."
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button className="btn primary" onClick={() => void send()} disabled={!text.trim()}>
              Send
            </button>
          </div>
        </footer>
      </section>
    </main>
  );
}
