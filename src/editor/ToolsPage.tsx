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

/** Ready-made forms for the scripts that matter most here; every other script gets the generic runner. */
interface Field {
  key: string;
  label: string;
  flag?: string;
  value: (p: Project) => string;
}
const FORMS: Record<string, { title: string; fields: Field[]; extra: string[] }> = {
  'yt-package/title.py': {
    title: 'Check a title and thumbnail pairing',
    fields: [
      { key: 'title', label: 'Title', flag: '--title', value: () => KIT_TEXT.en.titleOptions[0] },
      { key: 'thumb', label: 'Thumbnail words', flag: '--thumb', value: () => 'THEY NEVER KNEW' },
    ],
    extra: ['--json'],
  },
  'yt-script/hookscore.py': {
    title: 'Score a hook (English word lists: score the English version)',
    fields: [{ key: 'hook', label: 'Hook', flag: '--hook', value: (p) => projectHook(p, 'en')?.text ?? '' }],
    extra: ['--json'],
  },
  'yt-retention/retention.py': {
    title: 'Read a YouTube Studio retention export',
    fields: [{ key: 'csv', label: 'CSV file (in the repo)', value: (p) => `channel/analytics/${p.id}-long.csv` }],
    extra: ['--json'],
  },
};

const GROUP = (id: string) => (id.startsWith('yt-sponsors') || id === 'first-customer-finder' ? 'Sponsors' : id.startsWith('yt-') ? 'YouTube agent' : 'This project');

/** A small Markdown renderer for skill files: headings, lists, code, bold, inline code, links. */
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

/** Tutorial steps: what the skill is for, then one step per section of its instructions, then "try it". */
function steps(s: Skill): { title: string; text: string }[] {
  const parts = s.body.split(/\n(?=#{2,3}\s)/).filter((p) => p.trim());
  const sections = parts
    .map((p) => {
      const m = /^#{1,3}\s+(.*)\n?([\s\S]*)$/.exec(p.trim());
      return m ? { title: m[1], text: m[2].trim() } : { title: 'Overview', text: p.trim() };
    })
    .filter((x) => x.text);
  return [
    { title: 'What it is for', text: s.description },
    ...sections,
    {
      title: 'Try it',
      text: `${s.scripts.length ? `Use tab: run ${s.scripts.map((x) => `\`${x.file}\``).join(', ')} with your data.\n` : ''}In Claude Code: \`/${s.id} <what you want>\` - Claude follows this skill.`,
    },
  ];
}

/** Arguments typed on one line, quotes respected. */
const splitArgs = (s: string) => (s.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((a) => a.replace(/^["']|["']$/g, ''));

export function ToolsPage({ project }: { project: Project }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState('yt-package');
  const [view, setView] = useState<'use' | 'tutorial' | 'doc'>('use');
  const [step, setStep] = useState(0);
  useEffect(() => {
    void fetch('/api/tools/skills')
      .then(async (r) => (r.ok ? setSkills(await r.json()) : setError('Tools need npm run dev')))
      .catch(() => setError('Tools need npm run dev'));
  }, []);
  const s = skills.find((x) => x.id === sel) ?? skills[0];
  const groups = useMemo(() => {
    const g: Record<string, Skill[]> = {};
    for (const k of skills) (g[GROUP(k.id)] ??= []).push(k);
    return g;
  }, [skills]);
  const tut = s ? steps(s) : [];
  return (
    <main className="tools-page">
      <aside className="tools-list">
        {error && <p className="warn-text small">{error}</p>}
        {Object.entries(groups).map(([g, list]) => (
          <div key={g}>
            <h4>{g}</h4>
            {list.map((k) => (
              <button
                key={k.id}
                className={`tools-item ${s?.id === k.id ? 'on' : ''}`}
                onClick={() => {
                  setSel(k.id);
                  setStep(0);
                }}
              >
                <b>/{k.id}</b>
                <small>{k.description.slice(0, 90)}…</small>
              </button>
            ))}
          </div>
        ))}
      </aside>
      {s && (
        <section className="tools-main">
          <header className="tools-head">
            <div>
              <h2>/{s.id}</h2>
              <p className="muted small">{s.source}</p>
            </div>
            <div className="segmented compact tools-tabs">
              {(['use', 'tutorial', 'doc'] as const).map((v) => (
                <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
                  {v === 'use' ? 'Use' : v === 'tutorial' ? 'Tutorial' : 'Instructions'}
                </button>
              ))}
            </div>
          </header>
          <p className="tools-desc">{s.description}</p>
          <div className="tools-claude small">
            In Claude Code: <code>/{s.id} …</code>
            <button className="btn small ghost" onClick={() => void navigator.clipboard?.writeText(`/${s.id} `)}>
              Copy
            </button>
          </div>
          {view === 'use' && <Use skill={s} project={project} />}
          {view === 'doc' && <Markdown text={s.body} />}
          {view === 'tutorial' && tut.length > 0 && (
            <div className="tools-tutorial">
              <div className="tools-steps">
                {tut.map((t, i) => (
                  <button key={i} className={i === step ? 'on' : ''} onClick={() => setStep(i)}>
                    {i + 1}. {t.title}
                  </button>
                ))}
              </div>
              <div className="tools-step">
                <h3>
                  Step {step + 1} of {tut.length} · {tut[step].title}
                </h3>
                <Markdown text={tut[step].text} />
                <div className="row gap">
                  <button className="btn small" disabled={step === 0} onClick={() => setStep(step - 1)}>
                    ← Back
                  </button>
                  <button className="btn small primary" disabled={step === tut.length - 1} onClick={() => setStep(step + 1)}>
                    Next →
                  </button>
                  {step === tut.length - 1 && (
                    <button className="btn small" onClick={() => setView('use')}>
                      Open “Use”
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function Use({ skill, project }: { skill: Skill; project: Project }) {
  const [script, setScript] = useState(skill.scripts[0]?.file ?? '');
  const [values, setValues] = useState<Record<string, string>>({});
  const [args, setArgs] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<RunResult | null>(null);
  useEffect(() => {
    setScript(skill.scripts[0]?.file ?? '');
    setOut(null);
  }, [skill.id, skill.scripts]);
  const key = `${skill.id}/${script}`;
  const form = FORMS[key];
  useEffect(() => {
    if (form) setValues(Object.fromEntries(form.fields.map((f) => [f.key, f.value(project)])));
    setArgs('');
  }, [key, form, project]);
  if (!skill.scripts.length)
    return (
      <p className="help">
        This skill has no script to run here: it is a method Claude follows. Use it in Claude Code with <code>/{skill.id}</code> and what you want, or read
        the Tutorial.
      </p>
    );
  const run = async () => {
    setBusy(true);
    setOut(null);
    const argv = form ? [...form.fields.flatMap((f) => (f.flag ? (values[f.key] ? [f.flag, values[f.key]] : []) : values[f.key] ? [values[f.key]] : [])), ...form.extra] : splitArgs(args);
    try {
      const r = await fetch('/api/tools/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skill: skill.id, script, args: argv }) });
      setOut((await r.json()) as RunResult);
    } finally {
      setBusy(false);
    }
  };
  const usage = skill.scripts.find((x) => x.file === script)?.usage ?? '';
  let pretty = out?.stdout ?? '';
  try {
    pretty = JSON.stringify(JSON.parse(pretty), null, 2);
  } catch {
    // plain text output
  }
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
      {form ? (
        <>
          <h4>{form.title}</h4>
          {form.fields.map((f) => (
            <label key={f.key} className="tune-row ch-row">
              <span>{f.label}</span>
              <input className="itext" value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
            </label>
          ))}
        </>
      ) : (
        <>
          <pre className="tools-usage">{usage || 'No usage notes in this script.'}</pre>
          <label className="tune-row ch-row">
            <span>Arguments</span>
            <input className="itext" value={args} placeholder='e.g. --json "file.csv"' onChange={(e) => setArgs(e.target.value)} />
          </label>
        </>
      )}
      <button className="btn primary small" disabled={busy} onClick={() => void run()}>
        {busy ? 'Running…' : 'Run'}
      </button>
      {out && (
        <div className="tools-out">
          <p className="muted small">exit {out.code}</p>
          {pretty && <pre>{pretty}</pre>}
          {out.stderr && <pre className="warn-text">{out.stderr}</pre>}
        </div>
      )}
    </div>
  );
}
