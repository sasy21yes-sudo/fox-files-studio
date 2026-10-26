import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Project } from '../types';
import { projectHook } from '../data/projectText';
import { KIT_TEXT } from '../export/publishingKitText';

/** A skill installed in .claude/skills (tools/vite/skillTools.ts). */
interface Skill {
  id: string;
  name: string;
  description: string;
  body: string;
  scripts: { file: string; usage: string }[];
  source: string;
}
interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

type Group = 'progetto' | 'youtube' | 'sponsor';
const GROUPS: { id: Group; title: string; hint: string }[] = [
  { id: 'progetto', title: 'Per questo progetto', hint: 'Fatti su misura per The Fox Files' },
  { id: 'youtube', title: 'Crescere su YouTube', hint: 'Titoli, copioni, Short, statistiche' },
  { id: 'sponsor', title: 'Sponsor e collaborazioni', hint: 'Quando il canale è pronto a guadagnare' },
];

/** What each skill is, in plain Italian, for someone who has never used one. */
interface Entry {
  icon: string;
  title: string;
  what: string;
  group: Group;
  when: string[];
  steps: [string, string, string];
  example: string;
}
const CATALOG: Record<string, Entry> = {
  'review-episode': {
    icon: '🔍',
    title: 'Revisione dell’episodio',
    what: 'Una squadra di esperti (animazione, montaggio, suono, fatti, lingue…) guarda il video e ti consegna una lista di problemi in ordine di gravità.',
    group: 'progetto',
    when: ['Prima di pubblicare', 'Dopo una modifica grossa', 'Quando qualcosa “non ti convince” e non sai cosa'],
    steps: ['Scegli lingua e formato del video', 'La squadra prepara fotogrammi e audio e lavora (alcuni minuti)', 'I problemi arrivano nella pagina Team, il riepilogo alla fine'],
    example: '',
  },
  channel: {
    icon: '📺',
    title: 'Kit del canale',
    what: 'Tiene coerente il canale: colori, banner, icona, e il pacchetto di ogni episodio (titolo, miniatura, descrizione, capitoli, Short).',
    group: 'progetto',
    when: ['Stai per pubblicare un episodio', 'Vuoi titolo e descrizione pronti', 'Vuoi sapere cosa manca'],
    steps: ['Scrivi cosa ti serve (es. “prepara la descrizione”)', 'Claude legge l’episodio e il kit del canale', 'Ricevi i testi pronti da copiare'],
    example: 'Dimmi cosa manca per pubblicare l’episodio MKUltra e proponimi titolo, descrizione e capitoli.',
  },
  'yt-audit': {
    icon: '🩺',
    title: 'Check-up del canale',
    what: 'Esamina il canale intero (titoli, miniature, coerenza, i primi 15 secondi) e ti dice cosa sistemare per primo.',
    group: 'youtube',
    when: ['Il canale non cresce', 'Vuoi un parere generale', 'Prima di cambiare stile'],
    steps: ['Incolla il link del canale o descrivilo', 'Claude analizza confezione e coerenza', 'Ricevi le 3-5 cose da fare per prime'],
    example: 'Fai un check-up del canale The Fox Files partendo dal kit in channel/channel.json.',
  },
  'yt-package': {
    icon: '🏷️',
    title: 'Titolo + miniatura',
    what: 'Scrive e controlla titolo e testo della miniatura insieme: lunghezza, ripetizioni, frasi vaghe che nessuno clicca.',
    group: 'youtube',
    when: ['Devi scegliere il titolo', 'Le persone non cliccano', 'Vuoi più idee da confrontare'],
    steps: ['Scrivi il tema del video o un titolo da migliorare', 'Claude propone coppie titolo + miniatura', 'Ognuna viene controllata da uno strumento automatico'],
    example: 'Proponimi 5 coppie titolo + testo miniatura per l’episodio su MKUltra, in italiano.',
  },
  'yt-script': {
    icon: '✍️',
    title: 'Copione e gancio',
    what: 'Da un’idea scrive il copione: prima diverse aperture (i “ganci” dei primi secondi) con un punteggio, poi il testo completo.',
    group: 'youtube',
    when: ['Hai un’idea per un nuovo episodio', 'L’inizio del video è debole', 'Vuoi più versioni dell’apertura'],
    steps: ['Descrivi l’idea in due righe', 'Claude scrive e valuta diverse aperture', 'Scegli e ottieni il copione completo'],
    example: 'Idea per un nuovo episodio: il progetto Stargate della CIA. Proponimi 5 ganci di apertura.',
  },
  'yt-shorts': {
    icon: '📱',
    title: 'Short dal video lungo',
    what: 'Trova nel video lungo i momenti che funzionano anche da soli e li trasforma in Short.',
    group: 'youtube',
    when: ['Vuoi altri Short dallo stesso episodio', 'Non sai quale momento tagliare'],
    steps: ['Indica l’episodio (o incolla il testo)', 'Claude cerca i momenti autosufficienti', 'Ricevi i tagli con inizio, fine e titolo'],
    example: 'Trova 3 momenti dell’episodio MKUltra che funzionerebbero come Short.',
  },
  'yt-seo': {
    icon: '🔎',
    title: 'Descrizione e tag',
    what: 'Scrive descrizione, tag e testi per farsi trovare nelle ricerche, pensando a cosa scrive davvero chi cerca.',
    group: 'youtube',
    when: ['Stai caricando un video', 'Nessuno trova il video cercando'],
    steps: ['Indica il video', 'Claude sceglie la ricerca giusta a cui puntare', 'Ricevi descrizione e tag pronti'],
    example: 'Scrivi descrizione e tag in italiano per l’episodio MKUltra.',
  },
  'yt-chapters': {
    icon: '📑',
    title: 'Capitoli del video',
    what: 'Scrive i capitoli (i minutaggi in descrizione) dal testo del video, controllati con le regole di YouTube così compaiono davvero.',
    group: 'youtube',
    when: ['Il video supera i 2-3 minuti', 'Vuoi una barra divisa in sezioni'],
    steps: ['Indica il video o incolla il testo con i tempi', 'Claude divide in sezioni', 'Ricevi i capitoli da incollare in descrizione'],
    example: 'Scrivi i capitoli dell’episodio MKUltra in italiano.',
  },
  'yt-retention': {
    icon: '📉',
    title: 'Dove la gente smette di guardare',
    what: 'Legge il grafico di fidelizzazione di YouTube Studio e trova dove gli spettatori se ne vanno, e cosa cambiare.',
    group: 'youtube',
    when: ['Il video è online da qualche giorno', 'La gente abbandona presto'],
    steps: ['Scarica da YouTube Studio il file della fidelizzazione', 'Mettilo nella cartella del progetto', 'Lo strumento trova i punti di abbandono'],
    example: 'Leggi channel/analytics/mkultra-secret-experiments-long.csv e dimmi dove cala l’attenzione.',
  },
  'yt-plan': {
    icon: '🗓️',
    title: 'Piano delle uscite',
    what: 'Pianifica una settimana o un mese di video: cosa pubblicare, quando e in che ordine, in base al tempo che hai davvero.',
    group: 'youtube',
    when: ['Non sai cosa fare dopo', 'Vuoi pubblicare con regolarità'],
    steps: ['Dimmi quanto tempo hai a settimana', 'Claude propone un calendario', 'Ricevi l’ordine delle uscite'],
    example: 'Ho circa 6 ore a settimana. Fammi un piano di un mese per The Fox Files.',
  },
  'yt-viral': {
    icon: '🚀',
    title: 'Cosa funziona nella nicchia',
    what: 'Trova i video del tuo genere che sono andati molto meglio della media del loro canale e ti dice la formula.',
    group: 'youtube',
    when: ['Cerchi idee che funzionano', 'Vuoi capire un video esploso'],
    steps: ['Indica il genere (es. documentari di storia animati)', 'Claude cerca e confronta i video', 'Ricevi la classifica e la formula comune'],
    example: 'Cosa funziona ora su YouTube per i documentari animati di storia e misteri?',
  },
  'yt-comment': {
    icon: '💬',
    title: 'Risposte ai commenti',
    what: 'Prepara le risposte ai commenti con il tuo tono e ti dice a quali vale la pena rispondere.',
    group: 'youtube',
    when: ['Arrivano tanti commenti', 'Qualcuno fa una domanda difficile'],
    steps: ['Incolla i commenti', 'Claude li ordina per importanza', 'Ricevi le bozze di risposta (non pubblica niente)'],
    example: 'Ecco tre commenti al video: … Proponimi le risposte.',
  },
  'yt-edit': {
    icon: '✂️',
    title: 'Taglia i tempi morti',
    what: 'Dal testo di una registrazione trova pause, intercalari e ripetizioni, con i minutaggi da tagliare.',
    group: 'youtube',
    when: ['Hai registrato un video parlato', 'Il video è troppo lungo'],
    steps: ['Incolla la trascrizione con i tempi', 'Claude trova pause e ripetizioni', 'Ricevi la lista dei tagli'],
    example: 'Ecco la trascrizione di una mia registrazione: … Dove posso tagliare?',
  },
  'yt-sponsors': {
    icon: '🤝',
    title: 'Cerca sponsor',
    what: 'Quando il canale è pronto per le collaborazioni, trova marchi che sponsorizzano canali di storia e documentari e prepara una bozza di email (mai inviata).',
    group: 'sponsor',
    when: ['Hai attivato “Pronto per gli sponsor” in Canale', 'Vuoi una lista di marchi adatti'],
    steps: ['Attiva “Ready for sponsors” nella pagina Canale', 'Claude cerca prove pubbliche di sponsorizzazioni simili', 'Ricevi la lista e le bozze da rivedere'],
    example: 'Il canale è pronto per gli sponsor? Se sì, trovami 5 marchi adatti con le prove.',
  },
  'first-customer-finder': {
    icon: '🎯',
    title: 'Trova i primi clienti',
    what: 'Cerca in rete persone o aziende che mostrano pubblicamente di avere bisogno di quello che offri, con le prove e una bozza di contatto.',
    group: 'sponsor',
    when: ['Vuoi vendere un servizio', 'Cerchi i primi partner'],
    steps: ['Descrivi cosa offri e a chi', 'Claude cerca segnali pubblici di bisogno', 'Ricevi una lista breve con le fonti'],
    example: 'Offro video documentari animati su commissione. Trovami 5 possibili primi clienti.',
  },
};
const entry = (s: Skill): Entry =>
  CATALOG[s.id] ?? { icon: '🧰', title: s.id, what: s.description, group: 'youtube', when: [], steps: ['Scrivi cosa ti serve', 'Claude segue le istruzioni della skill', 'Ricevi il risultato'], example: '' };

/** Quick tools: the bundled scripts that make sense without Claude, with Italian forms. */
interface Field {
  key: string;
  label: string;
  flag?: string;
  value: (p: Project) => string;
}
const FORMS: Record<string, { title: string; help: string; fields: Field[]; extra: string[] }> = {
  'yt-package/title.py': {
    title: 'Controlla un titolo e il testo della miniatura',
    help: 'Scrivi un titolo e le parole sulla miniatura: lo strumento dice se sono troppo lunghi, ripetitivi o vaghi.',
    fields: [
      { key: 'title', label: 'Titolo', flag: '--title', value: () => KIT_TEXT.en.titleOptions[0] },
      { key: 'thumb', label: 'Parole sulla miniatura', flag: '--thumb', value: () => 'THEY NEVER KNEW' },
    ],
    extra: ['--json'],
  },
  'yt-script/hookscore.py': {
    title: 'Dai un voto alla frase d’apertura',
    help: 'Lo strumento conosce solo l’inglese: dai il voto alla versione inglese della frase.',
    fields: [{ key: 'hook', label: 'Frase d’apertura', flag: '--hook', value: (p) => projectHook(p, 'en')?.text ?? '' }],
    extra: ['--json'],
  },
  'yt-retention/retention.py': {
    title: 'Leggi il file della fidelizzazione',
    help: 'In YouTube Studio: Statistiche → Pubblico → Fidelizzazione → Esporta. Metti il CSV nella cartella del progetto.',
    fields: [{ key: 'csv', label: 'File CSV (nel progetto)', value: (p) => `channel/analytics/${p.id}-long.csv` }],
    extra: ['--json'],
  },
};

/** A small Markdown renderer: headings, lists, code, bold, inline code, links. */
function Markdown({ text }: { text: string }) {
  const inline = (s: string, k: number): ReactNode[] =>
    s.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g).map((part, i) => {
      if (/^`[^`]+`$/.test(part)) return <code key={`${k}-${i}`}>{part.slice(1, -1)}</code>;
      if (/^\*\*[^*]+\*\*$/.test(part)) return <b key={`${k}-${i}`}>{part.slice(2, -2)}</b>;
      const a = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
      if (a) return <span key={`${k}-${i}`} className="tl-link" title={a[2]}>{a[1]}</span>;
      return part;
    });
  const out: ReactNode[] = [];
  const lines = text.split(/\r?\n/);
  let list: string[] = [];
  let code: string[] | null = null;
  const flush = (k: number) => {
    if (list.length) out.push(<ul key={`l${k}`}>{list.map((l, i) => <li key={i}>{inline(l, i)}</li>)}</ul>);
    list = [];
  };
  lines.forEach((l, k) => {
    if (/^```/.test(l)) {
      if (code) {
        out.push(<pre key={`c${k}`}>{code.join('\n')}</pre>);
        code = null;
      } else {
        flush(k);
        code = [];
      }
      return;
    }
    if (code) return void code.push(l);
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    const li = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(l);
    if (h) {
      flush(k);
      out.push(h[1].length <= 2 ? <h3 key={k}>{inline(h[2], k)}</h3> : <h4 key={k}>{inline(h[2], k)}</h4>);
    } else if (li) list.push(li[1]);
    else if (l.trim()) {
      flush(k);
      out.push(<p key={k}>{inline(l, k)}</p>);
    } else flush(k);
  });
  flush(lines.length);
  return <div className="md">{out}</div>;
}

/** Arguments typed on one line, quotes respected. */
const splitArgs = (s: string) => (s.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((a) => a.replace(/^["']|["']$/g, ''));

export function ToolsPage({ project }: { project: Project }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    void fetch('/api/tools/skills')
      .then(async (r) => (r.ok ? setSkills(await r.json()) : setError('Gli strumenti funzionano solo con npm run dev.')))
      .catch(() => setError('Gli strumenti funzionano solo con npm run dev.'));
  }, []);
  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => skills.filter((s) => !q || [entry(s).title, entry(s).what, ...entry(s).when, s.id].join(' ').toLowerCase().includes(q)),
    [skills, q],
  );
  const s = sel ? skills.find((x) => x.id === sel) : undefined;

  if (s) return <SkillView skill={s} project={project} onBack={() => setSel(null)} />;
  return (
    <main className="tools-page tools-home">
      <header className="tools-hero">
        <div>
          <h1>Strumenti</h1>
          <p>
            Ogni scheda è un “esperto” che Claude sa fare: scegline uno, scrivi in italiano cosa ti serve e premi <b>Chiedi a Claude</b>. Non serve sapere
            programmare.
          </p>
        </div>
        <input className="itext tools-search" placeholder="Cerca: titolo, sponsor, Short, commenti…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </header>
      {error && <p className="warn-text">{error}</p>}
      {GROUPS.map((g) => {
        const list = visible.filter((x) => entry(x).group === g.id);
        if (!list.length) return null;
        return (
          <section key={g.id} className="tools-group">
            <h2>
              {g.title} <small>{g.hint}</small>
            </h2>
            <div className="tools-grid">
              {list.map((k) => {
                const e = entry(k);
                return (
                  <button key={k.id} className="tools-card" onClick={() => setSel(k.id)}>
                    <span className="tools-icon">{e.icon}</span>
                    <strong>{e.title}</strong>
                    <span className="tools-what">{e.what}</span>
                    {e.when[0] && <span className="tools-when">Utile quando: {e.when[0].toLowerCase()}</span>}
                    <span className="tools-open">Apri →</span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </main>
  );
}

function SkillView({ skill, project, onBack }: { skill: Skill; project: Project; onBack(): void }) {
  const e = entry(skill);
  const [showDoc, setShowDoc] = useState(false);
  const forms = skill.scripts.filter((x) => FORMS[`${skill.id}/${x.file}`]);
  return (
    <main className="tools-page tools-detail">
      <button className="btn small ghost tools-back" onClick={onBack}>
        ← Tutti gli strumenti
      </button>
      <header className="tools-head">
        <span className="tools-icon big">{e.icon}</span>
        <div>
          <h1>{e.title}</h1>
          <p className="tools-desc">{e.what}</p>
          {e.when.length > 0 && (
            <div className="tools-chips">
              <span className="muted small">Ti serve quando:</span>
              {e.when.map((w) => (
                <span key={w} className="tools-chip">
                  {w}
                </span>
              ))}
            </div>
          )}
        </div>
      </header>

      <section className="tools-how">
        <h2>Come funziona</h2>
        <ol className="tools-steps">
          {e.steps.map((st, i) => (
            <li key={i}>
              <span className="tools-num">{i + 1}</span>
              <span>{st}</span>
            </li>
          ))}
        </ol>
      </section>

      {skill.id === 'review-episode' ? <StartTeamReview /> : <AskClaude skill={skill} example={e.example} />}

      {forms.length > 0 && (
        <section className="tools-card-panel">
          <h2>Prova rapida (senza Claude, gratis)</h2>
          {forms.map((f) => (
            <QuickForm key={f.file} skill={skill} script={f.file} project={project} />
          ))}
        </section>
      )}

      <details className="tools-more">
        <summary>Per esperti: script e istruzioni originali</summary>
        <p className="muted small">
          Provenienza: {skill.source === 'Made for this project' ? 'fatta per questo progetto' : skill.source}. In Claude Code si usa anche scrivendo{' '}
          <code>/{skill.id} …</code>
          <button className="btn small ghost" onClick={() => void navigator.clipboard?.writeText(`/${skill.id} `)}>
            Copia
          </button>
        </p>
        {skill.scripts.length > 0 && <ScriptRunner skill={skill} />}
        <button className="btn small" onClick={() => setShowDoc(!showDoc)}>
          {showDoc ? 'Nascondi' : 'Mostra'} le istruzioni che legge Claude (in inglese)
        </button>
        {showDoc && <Markdown text={skill.body} />}
      </details>
    </main>
  );
}

/** Plain-language request -> Claude follows the skill (tools/vite/skillTools.ts /ask). */
function AskClaude({ skill, example }: { skill: Skill; example: string }) {
  const [text, setText] = useState(example);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [started, setStarted] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => {
    setText(example);
    setAnswer(null);
    setErr(null);
  }, [skill.id, example]);
  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [busy]);
  const ask = async () => {
    setBusy(true);
    setErr(null);
    setAnswer(null);
    setStarted(Date.now());
    try {
      const r = await fetch('/api/tools/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skill: skill.id, text }) });
      const j = (await r.json()) as { answer?: string; error?: string; cost?: number };
      if (!r.ok || !j.answer) setErr(j.error ?? `errore ${r.status}`);
      else {
        setAnswer(j.answer);
        setCost(j.cost ?? null);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="tools-card-panel tools-ask">
      <h2>Chiedi a Claude</h2>
      <p className="muted small">Scrivi come parleresti a una persona. Claude segue questa skill, legge i file del progetto se servono e risponde qui. Non pubblica e non invia niente.</p>
      <textarea className="itext" rows={3} value={text} placeholder="Cosa ti serve?" onChange={(ev) => setText(ev.target.value)} />
      <div className="row gap">
        <button className="btn primary" disabled={busy || !text.trim()} onClick={() => void ask()}>
          {busy ? `Claude sta lavorando… ${Math.round((Date.now() - started) / 1000)} s` : '✨ Chiedi a Claude'}
        </button>
        <span className="muted small">Di solito 1-3 minuti · pochi centesimi</span>
      </div>
      {err && <p className="warn-text">{err}</p>}
      {answer && (
        <div className="tools-answer">
          <Markdown text={answer} />
          <div className="row gap small muted">
            <button className="btn small ghost" onClick={() => void navigator.clipboard?.writeText(answer)}>
              Copia la risposta
            </button>
            {cost !== null && <span>costo ~${cost.toFixed(3)}</span>}
          </div>
        </div>
      )}
    </section>
  );
}

/** The review skill: a team review started on the dev server (tools/vite/teamReview.ts), followed on the Team page. */
function StartTeamReview() {
  const [lang, setLang] = useState('it');
  const [aspect, setAspect] = useState('16:9');
  const [msg, setMsg] = useState<string | null>(null);
  const start = async () => {
    const r = await fetch('/api/team/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent: 'producer', lang, aspect }) }).catch(() => null);
    setMsg(r?.ok ? 'Partita! Segui il lavoro nella pagina Team, chat del Producer.' : ((await r?.json().catch(() => null))?.error ?? 'Il server non risponde (npm run dev).'));
  };
  return (
    <section className="tools-card-panel tools-ask">
      <h2>Avvia la revisione</h2>
      <div className="row gap">
        <label className="tune-row ch-row">
          <span>Lingua</span>
          <select className="isel" value={lang} onChange={(e) => setLang(e.target.value)}>
            {['it', 'en', 'es', 'fr', 'pt'].map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        <label className="tune-row ch-row">
          <span>Formato</span>
          <select className="isel" value={aspect} onChange={(e) => setAspect(e.target.value)}>
            <option value="16:9">16:9 YouTube</option>
            <option value="9:16">9:16 Short</option>
          </select>
        </label>
        <button className="btn primary" onClick={() => void start()}>
          ▶ Avvia la revisione di squadra
        </button>
      </div>
      <p className="muted small">Per un solo esperto (es. solo il suono) apri la pagina Team, scegli l’agente e premi “Avvia review”: costa meno.</p>
      {msg && <p className="tools-ok">{msg}</p>}
    </section>
  );
}

/** Script output: JSON shown as labelled values, anything else as text. */
function Output({ out }: { out: RunResult }) {
  const [raw, setRaw] = useState(false);
  let data: unknown = null;
  try {
    data = JSON.parse(out.stdout);
  } catch {
    // plain text
  }
  const label = (k: string) => k.replace(/_/g, ' ');
  const value = (v: unknown): ReactNode =>
    typeof v === 'number' ? <b className="tools-num-val">{Number.isInteger(v) ? v : v.toFixed(2)}</b> : typeof v === 'boolean' ? (v ? '✅ sì' : '❌ no') : typeof v === 'string' ? v : Array.isArray(v) && v.every((x) => typeof x !== 'object') ? v.join(' · ') : <pre>{JSON.stringify(v, null, 2)}</pre>;
  return (
    <div className="tools-out">
      <p className={out.code === 0 ? 'tools-ok' : 'warn-text'}>{out.code === 0 ? 'Fatto ✔' : `Qualcosa non va (codice ${out.code})`}</p>
      {data && typeof data === 'object' && !Array.isArray(data) && !raw ? (
        <dl className="tools-kv">
          {Object.entries(data as Record<string, unknown>).map(([k, v]) => (
            <div key={k}>
              <dt>{label(k)}</dt>
              <dd>{value(v)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        out.stdout && <pre>{data ? JSON.stringify(data, null, 2) : out.stdout}</pre>
      )}
      {data !== null && (
        <button className="btn small ghost" onClick={() => setRaw(!raw)}>
          {raw ? 'Vista semplice' : 'Dati grezzi'}
        </button>
      )}
      {out.stderr && <pre className="warn-text">{out.stderr}</pre>}
    </div>
  );
}

const runScript = async (skill: string, script: string, args: string[]) => {
  const r = await fetch('/api/tools/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skill, script, args }) });
  return (await r.json()) as RunResult;
};

function QuickForm({ skill, script, project }: { skill: Skill; script: string; project: Project }) {
  const form = FORMS[`${skill.id}/${script}`];
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(form.fields.map((f) => [f.key, f.value(project)])));
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<RunResult | null>(null);
  const run = async () => {
    setBusy(true);
    setOut(null);
    try {
      setOut(await runScript(skill.id, script, [...form.fields.flatMap((f) => (f.flag ? (values[f.key] ? [f.flag, values[f.key]] : []) : values[f.key] ? [values[f.key]] : [])), ...form.extra]));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="tools-quick">
      <h3>{form.title}</h3>
      <p className="muted small">{form.help}</p>
      {form.fields.map((f) => (
        <label key={f.key} className="tune-row ch-row">
          <span>{f.label}</span>
          <input className="itext" value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
        </label>
      ))}
      <button className="btn small primary" disabled={busy} onClick={() => void run()}>
        {busy ? 'Controllo…' : 'Controlla'}
      </button>
      {out && <Output out={out} />}
    </div>
  );
}

/** Any bundled script with typed arguments (for experts). */
function ScriptRunner({ skill }: { skill: Skill }) {
  const [script, setScript] = useState(skill.scripts[0]?.file ?? '');
  const [args, setArgs] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<RunResult | null>(null);
  const usage = skill.scripts.find((x) => x.file === script)?.usage ?? '';
  return (
    <div className="tools-use">
      <label className="tune-row ch-row">
        <span>Script</span>
        <select className="isel" value={script} onChange={(e) => setScript(e.target.value)}>
          {skill.scripts.map((x) => (
            <option key={x.file}>{x.file}</option>
          ))}
        </select>
      </label>
      <pre className="tools-usage">{usage || 'Nessuna nota d’uso in questo script.'}</pre>
      <label className="tune-row ch-row">
        <span>Argomenti</span>
        <input className="itext" value={args} placeholder='es. --json "file.csv"' onChange={(e) => setArgs(e.target.value)} />
      </label>
      <button
        className="btn small"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void runScript(skill.id, script, splitArgs(args))
            .then(setOut)
            .finally(() => setBusy(false));
        }}
      >
        {busy ? 'In esecuzione…' : 'Esegui'}
      </button>
      {out && <Output out={out} />}
    </div>
  );
}
