import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../types';
import type { Lang } from '../i18n/languages';
import { buildShortTimeline, buildTimeline, formatTime, toSRT, type Timeline, type VoiceTiming } from '../animation/timeline';
import { renderFrame } from '../animation/renderScene';
import { placeBeats } from '../effects/beats';
import { projectHook } from '../data/projectText';
import { youtubeChapters } from '../export/publishingKit';
import { KIT_TEXT } from '../export/publishingKitText';
import { loadProjectMedia } from '../media/store';
import { BANNER, ICON, drawBanner, drawIcon } from '../channel/brand';
import { cutStats, forecast, type CutStats } from '../channel/forecast';
import { FONT_TITLE } from '../animation/stage';
import { COVER, LAYOUTS, THUMB, drawShortCover, drawThumbnail, loadMaster, type ThumbLayout } from '../channel/thumbnails';

export type ChannelTab = 'dashboard' | 'brand' | 'thumbs' | 'preview';

/** The channel's identity (channel/channel.json), per language where it is text the viewer reads. */
interface ChannelInfo {
  name: string;
  handle: string;
  tagline: Partial<Record<Lang, string>>;
  description: Partial<Record<Lang, string>>;
  /** Thumbnail words (2-3, never the title's words). */
  thumb: Partial<Record<Lang, string>>;
  keywords: string;
  /** The thumbnail chosen in the Thumbnails tab: layout and the episode second of its frame. */
  thumbLayout?: ThumbLayout;
  thumbAt?: number;
  /** Sponsors: set ready after a /yt-audit pass; stats typed by Salvatore from YouTube Studio (never estimated). */
  collaborations?: { ready: boolean; stats?: { subscribers?: string; avgViews?: string } };
}
const DEFAULT: ChannelInfo = {
  name: 'The Fox Files',
  handle: '@thefoxfiles',
  tagline: {
    it: 'Storie vere. Documenti veri.',
    en: 'True stories. Real records.',
    es: 'Historias reales. Documentos reales.',
    fr: 'Histoires vraies. Vrais documents.',
    pt: 'Histórias reais. Documentos reais.',
  },
  description: {
    it: "Agent Fox apre i fascicoli segreti della storia, in stile cartone anni '30. Ogni fatto viene dai documenti, citati in descrizione.",
    en: "Agent Fox opens history's secret files, 1930s-cartoon style. Every fact comes from the records, listed in the description.",
    es: 'Agent Fox abre los expedientes secretos de la historia, al estilo de los dibujos de los años 30. Cada dato viene de los documentos, citados en la descripción.',
    fr: "Agent Fox ouvre les dossiers secrets de l'histoire, façon dessin animé des années 30. Chaque fait vient des archives, citées en description.",
    pt: 'Agent Fox abre os arquivos secretos da história, no estilo dos desenhos dos anos 30. Cada fato vem dos documentos, citados na descrição.',
  },
  thumb: { it: 'SENZA SAPERLO', en: 'THEY NEVER KNEW', es: 'SIN SABERLO', fr: 'À LEUR INSU', pt: 'SEM SABER' },
  keywords: 'storia, guerra fredda, CIA, documenti declassificati, cartoon, animazione anni 30, The Fox Files',
};

interface Lint {
  titles: { title: string; chars: number; score: number; issues: [string, string][]; good: string[] }[];
  hooks: { hook: string; verdict: number; band: string; properties: Record<string, number> }[];
}
interface Retention {
  analysis?: { hook_leak: number; cliffs: { at?: number; x?: number; drop?: number; said?: string }[]; slide_per_unit: number; end: number };
  curve?: [number, number][];
  none?: boolean;
}

interface Props {
  project: Project;
  timing: VoiceTiming | null;
  initialTab?: ChannelTab;
}

/** The Channel page: the episode's numbers and a forecast, the channel's brand kit, and a preview of the channel. */
export function ChannelPage({ project, timing, initialTab = 'dashboard' }: Props) {
  const [tab, setTab] = useState<ChannelTab>(initialTab);
  const [info, setInfo] = useState<ChannelInfo>(DEFAULT);
  const [saved, setSaved] = useState('');
  const lang = project.settings.language;
  useEffect(() => {
    void fetch('/api/channel')
      .then((r) => (r.ok ? r.json() : {}))
      .then((j: Partial<ChannelInfo>) => {
        const merged = { ...DEFAULT, ...j, tagline: { ...DEFAULT.tagline, ...j.tagline }, description: { ...DEFAULT.description, ...j.description }, thumb: { ...DEFAULT.thumb, ...j.thumb } };
        setInfo(merged);
        setSaved(JSON.stringify(merged));
      })
      .catch(() => undefined);
  }, []);
  const save = async () => {
    const r = await fetch('/api/channel', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(info) });
    if (r.ok) setSaved(JSON.stringify(info));
  };

  const cuts = useMemo(() => {
    const long = buildTimeline({ ...project, settings: { ...project.settings, aspect: '16:9' } }, undefined, timing);
    const vert = buildTimeline({ ...project, settings: { ...project.settings, aspect: '9:16' } }, undefined, timing);
    const short = buildShortTimeline(project, timing);
    const pops = (tl: Timeline) => tl.spans.reduce((n, _s, i) => n + placeBeats(tl, i).length, 0);
    return { long, vert, short, stats: { long: cutStats(long, pops(long)), vert: cutStats(vert, pops(vert)), short: short ? cutStats(short, pops(short)) : null } };
  }, [project, timing]);

  return (
    <main className="channel-page">
      <header className="channel-head">
        <strong>Channel</strong>
        <div className="segmented compact">
          {(['dashboard', 'brand', 'thumbs', 'preview'] as const).map((k) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {k === 'dashboard' ? 'Dashboard' : k === 'brand' ? 'Brand kit' : k === 'thumbs' ? 'Thumbnails' : 'YouTube preview'}
            </button>
          ))}
        </div>
        {(tab === 'brand' || tab === 'thumbs') && (
          <button className="btn primary small" disabled={JSON.stringify(info) === saved} onClick={() => void save()}>
            Save channel
          </button>
        )}
      </header>
      {tab === 'dashboard' && <Dashboard project={project} info={info} cuts={cuts} />}
      {tab === 'brand' && <Brand info={info} lang={lang} onChange={setInfo} />}
      {tab === 'thumbs' && <Thumbs project={project} info={info} cuts={cuts} onChange={setInfo} />}
      {tab === 'preview' && <Preview project={project} info={info} cuts={cuts} />}
    </main>
  );
}

// ------------------------------------------------------------------ dashboard

type Cuts = { long: Timeline; vert: Timeline; short: Timeline | null; stats: { long: CutStats; vert: CutStats; short: CutStats | null } };

function Dashboard({ project, info, cuts }: { project: Project; info: ChannelInfo; cuts: Cuts }) {
  const lang = project.settings.language;
  const [lint, setLint] = useState<Lint | null>(null);
  const [lintErr, setLintErr] = useState<string | null>(null);
  const [real, setReal] = useState<Record<'long' | 'short', Retention | null>>({ long: null, short: null });
  useEffect(() => {
    // Scored in English: the skill's heuristics are built on English hooks and titles.
    const titles = KIT_TEXT.en.titleOptions.map((title) => ({ title, thumb: info.thumb.en }));
    const hooks = [projectHook(project, 'en')?.text].filter(Boolean) as string[];
    void fetch('/api/channel/lint', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ titles, hooks }) })
      .then(async (r) => (r.ok ? setLint(await r.json()) : setLintErr((await r.json()).error)))
      .catch((e) => setLintErr(String(e)));
    for (const f of ['long', 'short'] as const)
      void fetch(`/api/channel/retention?id=${encodeURIComponent(project.id)}&format=${f}`)
        .then((r) => r.json())
        .then((j: Retention) => setReal((x) => ({ ...x, [f]: j.none ? null : j })))
        .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, info.thumb.en]);
  const hookScore = lint?.hooks[0]?.verdict ?? 50;
  const fl = forecast(cuts.stats.long, hookScore, false);
  const fs = cuts.stats.short ? forecast(cuts.stats.short, hookScore, true) : null;
  const upload = async (format: 'long' | 'short', file: File) => {
    const csv = await file.text();
    const tl = format === 'long' ? cuts.long : cuts.short ?? cuts.vert;
    const r = await fetch(`/api/channel/retention?id=${encodeURIComponent(project.id)}&format=${format}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv, srt: toSRT(tl) }) });
    const j = (await r.json()) as Retention;
    setReal((x) => ({ ...x, [format]: j }));
  };
  const chapters = youtubeChapters(cuts.long);
  const title = KIT_TEXT[lang]?.titleOptions[0] ?? '';
  const checks: [boolean, string][] = [
    [cuts.stats.long.hook === 0 || cuts.stats.long.hook <= 6, 'Hook within the first 6 s'],
    [chapters.length >= 3, `${chapters.length} chapters on YouTube (at least 3, each 10 s or longer)`],
    [title.length <= 60, `Title ${title.length} characters (desktop cut at ~60)`],
    [!!cuts.stats.short && cuts.stats.short.total <= 60, cuts.stats.short ? `Short ${cuts.stats.short.total.toFixed(0)} s (30–60 s works best)` : 'No Short cut yet'],
    [project.short?.endCard !== false, 'Short ends on the “full episode” card'],
    [cuts.stats.long.fastCues < 0.35, `${Math.round(cuts.stats.long.fastCues * 100)}% of subtitles above 17 chars/s`],
    [(info.thumb[lang] ?? '').split(/\s+/).length <= 3, `Thumbnail text “${info.thumb[lang] ?? ''}” (3 words at most)`],
  ];
  const row = (label: string, s: CutStats | null, f: { avgPct: number; avgSec: number } | null) =>
    s && (
      <tr>
        <td>{label}</td>
        <td>{formatTime(s.total)}</td>
        <td>{s.scenes}</td>
        <td>{Math.round(s.wpm)}</td>
        <td>
          {s.popups} ({s.popupsPerMin.toFixed(1)}/min)
        </td>
        <td>{s.changesPerMin.toFixed(1)}</td>
        <td>{Math.round(s.fastCues * 100)}%</td>
        <td>{f ? `${f.avgPct.toFixed(0)}% · ${formatTime(f.avgSec)}` : '—'}</td>
      </tr>
    );
  return (
    <div className="channel-grid">
      <section className="ch-card wide">
        <h3>The episode in numbers</h3>
        <table className="ch-table">
          <thead>
            <tr>
              <th>Cut</th>
              <th>Length</th>
              <th>Scenes / clips</th>
              <th>Words/min</th>
              <th>Pop-ups</th>
              <th>Changes/min</th>
              <th>Fast subtitles</th>
              <th>Forecast avg viewed</th>
            </tr>
          </thead>
          <tbody>
            {row('YouTube 16:9', cuts.stats.long, fl)}
            {row('Short (own cut)', cuts.stats.short, fs)}
            {row('9:16 whole episode', cuts.stats.vert, null)}
          </tbody>
        </table>
      </section>
      <section className="ch-card wide">
        <h3>Retention: forecast {real.long?.curve || real.short?.curve ? 'and YouTube data' : ''}</h3>
        <RetentionChart lines={[
          { label: 'YouTube 16:9 (forecast)', color: '#d9b465', pts: fl.curve, total: cuts.stats.long.total, dash: true },
          ...(fs && cuts.stats.short ? [{ label: 'Short (forecast)', color: '#8fb3d9', pts: fs.curve, total: cuts.stats.short.total, dash: true }] : []),
          ...(real.long?.curve ? [{ label: 'YouTube 16:9 (real)', color: '#e0574a', pts: real.long.curve, total: Math.max(...real.long.curve.map((p) => p[0])) }] : []),
          ...(real.short?.curve ? [{ label: 'Short (real)', color: '#7fc4a8', pts: real.short.curve, total: Math.max(...real.short.curve.map((p) => p[0])) }] : []),
        ]} />
        <p className="help small">
          The dashed curves are a heuristic estimate from the cut's structure (hook score, words/min, how often something new appears, subtitle speed): a
          way to compare versions, not a prediction of views. Import the real curve from YouTube Studio (Analytics → the video → Engagement → audience
          retention → download) and it is drawn over the estimate, with the moments people leave.
        </p>
        <div className="row gap wrap small">
          {(['long', 'short'] as const).map((f) => (
            <label key={f} className="btn small ghost">
              Import {f === 'long' ? '16:9' : 'Short'} retention CSV
              <input type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && void upload(f, e.target.files[0])} />
            </label>
          ))}
        </div>
        {(['long', 'short'] as const).map((f) => {
          const a = real[f]?.analysis;
          return a ? (
            <div key={f} className="ch-real small">
              <b>{f === 'long' ? '16:9' : 'Short'}:</b> lost {a.hook_leak.toFixed(1)}% in the opening · ends at {a.end.toFixed(0)}% ·{' '}
              {a.cliffs.length ? `${a.cliffs.length} cliffs: ${a.cliffs.slice(0, 4).map((c) => `${c.at ?? c.x}${c.said ? ` “${c.said.slice(0, 40)}”` : ''}`).join(' · ')}` : 'no cliffs'}
            </div>
          ) : null;
        })}
      </section>
      <section className="ch-card">
        <h3>Hook and titles</h3>
        {lintErr && <p className="warn-text small">Checks unavailable: {lintErr}</p>}
        {lint?.hooks[0] && (
          <p className="small">
            Hook score <b>{lint.hooks[0].verdict}</b>/100 ({lint.hooks[0].band}) ·{' '}
            {Object.entries(lint.hooks[0].properties)
              .map(([k, v]) => `${k.toLowerCase()} ${v}`)
              .join(' · ')}
          </p>
        )}
        {lint?.titles.map((t) => (
          <div key={t.title} className="ch-title small">
            <b>{t.score}</b> {t.title} <span className="muted">({t.chars} chars)</span>
            {t.issues.length > 0 && <div className="muted">{t.issues.map((i) => i[1]).join(' · ')}</div>}
          </div>
        ))}
        <p className="help small">Scored in English by the youtube-agent skills (yt-script/hookscore.py, yt-package/title.py): their word lists are English.</p>
      </section>
      <section className="ch-card">
        <h3>Before publishing</h3>
        <ul className="ch-checks">
          {checks.map(([ok, text]) => (
            <li key={text} className={ok ? 'ok' : 'warn'}>
              {ok ? '✓' : '!'} {text}
            </li>
          ))}
        </ul>
        <h3>Chapters (16:9)</h3>
        <pre className="ch-pre">{chapters.join('\n')}</pre>
      </section>
    </div>
  );
}

function RetentionChart({ lines }: { lines: { label: string; color: string; pts: [number, number][]; total: number; dash?: boolean }[] }) {
  const W = 760;
  const H = 220;
  const pad = 30;
  return (
    <div className="ch-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Retention curves">
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={pad} x2={W - 8} y1={pad / 2 + ((100 - v) / 100) * (H - pad)} y2={pad / 2 + ((100 - v) / 100) * (H - pad)} stroke="var(--line)" strokeWidth={1} />
            <text x={4} y={pad / 2 + ((100 - v) / 100) * (H - pad) + 4} fontSize={10} fill="var(--muted)">
              {v}%
            </text>
          </g>
        ))}
        {lines.map((l) => (
          <polyline
            key={l.label}
            fill="none"
            stroke={l.color}
            strokeWidth={2}
            strokeDasharray={l.dash ? '5 4' : undefined}
            points={l.pts.map(([t, v]) => `${pad + (t / Math.max(1, l.total)) * (W - pad - 8)},${pad / 2 + ((100 - v) / 100) * (H - pad)}`).join(' ')}
          />
        ))}
      </svg>
      <div className="row gap wrap small">
        {lines.map((l) => (
          <span key={l.label} style={{ color: l.color }}>
            ■ {l.label}
          </span>
        ))}
        <span className="muted">x = share of the video's length</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ brand kit

function Brand({ info, lang, onChange }: { info: ChannelInfo; lang: Lang; onChange(i: ChannelInfo): void }) {
  const banner = useRef<HTMLCanvasElement>(null);
  const icon = useRef<HTMLCanvasElement>(null);
  const [safe, setSafe] = useState(true);
  useEffect(() => {
    void loadMaster().then(() => {
      const b = banner.current?.getContext('2d');
      if (b) drawBanner(b, info.name, info.tagline[lang] ?? '');
      const i = icon.current?.getContext('2d');
      if (i) drawIcon(i);
    });
  }, [info.name, info.tagline, lang]);
  const download = (c: HTMLCanvasElement | null, name: string) =>
    c?.toBlob((b) => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  const set = (patch: Partial<ChannelInfo>) => onChange({ ...info, ...patch });
  const setLang = (k: 'tagline' | 'description' | 'thumb', v: string) => onChange({ ...info, [k]: { ...info[k], [lang]: v } });
  return (
    <div className="channel-grid">
      <section className="ch-card wide">
        <h3>Banner · 2560×1440 (the outlined box is what every device shows)</h3>
        <div className="ch-banner">
          <canvas ref={banner} width={BANNER.w} height={BANNER.h} />
          {safe && <div className="ch-safe" style={{ width: `${(BANNER.safe.w / BANNER.w) * 100}%`, height: `${(BANNER.safe.h / BANNER.h) * 100}%` }} />}
        </div>
        <div className="row gap small">
          <button className="btn small" onClick={() => download(banner.current, 'fox-files-banner.png')}>
            Download banner PNG
          </button>
          <label className="chk">
            <input type="checkbox" checked={safe} onChange={(e) => setSafe(e.target.checked)} /> Show safe area
          </label>
        </div>
      </section>
      <section className="ch-card">
        <h3>Channel icon · 800×800</h3>
        <canvas ref={icon} width={ICON} height={ICON} className="ch-icon" />
        <button className="btn small" onClick={() => download(icon.current, 'fox-files-icon.png')}>
          Download icon PNG
        </button>
        <p className="help small">The master Agent Fox (hat, face and lens) on the series' brass sunburst.</p>
      </section>
      <section className="ch-card">
        <h3>Identity ({lang})</h3>
        <label className="tune-row ch-row">
          <span>Name</span>
          <input className="itext" value={info.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="tune-row ch-row">
          <span>Handle</span>
          <input className="itext" value={info.handle} onChange={(e) => set({ handle: e.target.value })} />
        </label>
        <label className="tune-row ch-row">
          <span>Tagline</span>
          <input className="itext" value={info.tagline[lang] ?? ''} onChange={(e) => setLang('tagline', e.target.value)} />
        </label>
        <label className="tune-row ch-row">
          <span>Thumbnail words</span>
          <input className="itext" value={info.thumb[lang] ?? ''} onChange={(e) => setLang('thumb', e.target.value)} />
        </label>
        <label className="ch-row-col small">
          Description
          <textarea className="itext" rows={4} value={info.description[lang] ?? ''} onChange={(e) => setLang('description', e.target.value)} />
        </label>
        <h3>Collaborations</h3>
        <label className="chk small" title="The yt-sponsors skill only looks for sponsors when this is on">
          <input type="checkbox" checked={!!info.collaborations?.ready} onChange={(e) => set({ collaborations: { ...info.collaborations, ready: e.target.checked } })} /> Ready for sponsors
        </label>
        {(['subscribers', 'avgViews'] as const).map((k) => (
          <label key={k} className="tune-row ch-row">
            <span>{k === 'subscribers' ? 'Subscribers' : 'Average views'}</span>
            <input
              className="itext"
              value={info.collaborations?.stats?.[k] ?? ''}
              placeholder="from YouTube Studio"
              onChange={(e) => set({ collaborations: { ready: !!info.collaborations?.ready, stats: { ...info.collaborations?.stats, [k]: e.target.value } } })}
            />
          </label>
        ))}
        <label className="ch-row-col small">
          Keywords
          <input className="itext" value={info.keywords} onChange={(e) => set({ keywords: e.target.value })} />
        </label>
      </section>
      <section className="ch-card">
        <h3>House style (every episode)</h3>
        <ul className="ch-checks small">
          <li>Title: the subject first, under 60 characters, one number, date or name.</li>
          <li>Thumbnail: Agent Fox + one strong frame + 2–3 words that are not in the title.</li>
          <li>Hook in the first 6 s; the Short is its own 45–60 s cut that ends on the “full episode” card.</li>
          <li>Description: what the episode shows, chapters, every source with its link, the AI-voice note.</li>
          <li>Same sunburst, fonts and Agent Fox on banner, icon, thumbnails and end screens.</li>
          <li>Pinned comment: the main source and a question to the viewers.</li>
        </ul>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ YouTube preview

function Preview({ project, info, cuts }: { project: Project; info: ChannelInfo; cuts: Cuts }) {
  const lang = project.settings.language;
  const [img, setImg] = useState<{ banner: string; icon: string; thumb: string; short: string } | null>(null);
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      await loadProjectMedia(project);
      const mk = (w: number, h: number) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        return c;
      };
      await loadMaster();
      const b = mk(BANNER.w, BANNER.h);
      drawBanner(b.getContext('2d')!, info.name, info.tagline[lang] ?? '');
      const i = mk(ICON, ICON);
      drawIcon(i.getContext('2d')!);
      // Thumbnail: the episode's strongest card (the first record pop-up, else 40% in) with the thumbnail words.
      const frameAt = (tl: Timeline, aspect: '16:9' | '9:16', w: number, h: number, words: string | null) => {
        const c = mk(w, h);
        const g = c.getContext('2d')!;
        const proj = { ...project, settings: { ...project.settings, aspect } };
        const all = tl.spans.flatMap((_s, k) => placeBeats(tl, k));
        const rec = all.find((p) => p.beat.kind === 'record') ?? all.find((p) => p.beat.kind === 'person');
        renderFrame(g, w, h, proj, tl, rec ? rec.start + 1.2 : tl.total * 0.4, { filmGrain: false, subtitles: project.settings.subtitles, burnSubtitles: false });
        if (words) {
          const size = h * 0.17;
          g.font = `900 ${size}px ${FONT_TITLE}`;
          g.textAlign = 'left';
          g.textBaseline = 'alphabetic';
          g.lineJoin = 'round';
          g.lineWidth = size * 0.16;
          g.strokeStyle = '#170d07';
          g.save();
          g.translate(w * 0.05, h * 0.9);
          g.rotate(-0.04);
          g.strokeText(words, 0, 0, w * 0.9);
          g.fillStyle = '#f3e6c8';
          g.fillText(words, 0, 0, w * 0.9);
          g.restore();
        }
        return c.toDataURL('image/jpeg', 0.85);
      };
      // The thumbnail chosen in the Thumbnails tab (default: Dossier on the strongest card) and the Short's cover.
      void frameAt;
      const tc = mk(THUMB.w, THUMB.h);
      drawThumbnail(tc.getContext('2d')!, info.thumbLayout ?? 'dossier', episodeFrame(project, cuts.long, info.thumbAt ?? strongMoment(cuts.long)), info.thumb[lang] ?? '', 'THE FOX FILES · MKULTRA');
      const thumb = tc.toDataURL('image/jpeg', 0.85);
      const sc = mk(COVER.w, COVER.h);
      drawShortCover(sc.getContext('2d')!, null, info.thumb[lang] ?? '', projectHook(project, lang)?.text ?? '');
      const short = cuts.short ? sc.toDataURL('image/jpeg', 0.8) : '';
      if (alive) setImg({ banner: b.toDataURL('image/jpeg', 0.85), icon: i.toDataURL('image/png'), thumb, short });
    })();
    return () => {
      alive = false;
    };
  }, [project, info, cuts, lang]);
  const title = KIT_TEXT[lang]?.titleOptions[0] ?? project.episodeTitle;
  return (
    <div className={`yt-preview ${mobile ? 'mobile' : ''}`}>
      <div className="row gap small yt-tools">
        <div className="segmented compact">
          {([false, true] as const).map((m) => (
            <button key={String(m)} className={mobile === m ? 'on' : ''} onClick={() => setMobile(m)}>
              {m ? 'Phone' : 'Desktop'}
            </button>
          ))}
        </div>
        <span className="muted">A mock-up of the channel page with this channel's art, to judge the look before publishing.</span>
      </div>
      <div className="yt-page">
        {/* Desktop shows the banner's middle band; phones a narrower crop of the same safe area. */}
        <div className="yt-banner" style={{ backgroundImage: img ? `url(${img.banner})` : undefined }} />
        <div className="yt-head">
          {img && <img className="yt-avatar" src={img.icon} alt="Channel icon" />}
          <div>
            <h1>{info.name}</h1>
            <p className="yt-meta">
              {info.handle} · — subscribers · 1 video
            </p>
            <p className="yt-desc">{(info.description[lang] ?? '').slice(0, 110)}… more</p>
            <button className="yt-sub">Subscribe</button>
          </div>
        </div>
        <nav className="yt-tabs">
          <span className="on">Home</span>
          <span>Videos</span>
          <span>Shorts</span>
          <span>Playlists</span>
        </nav>
        <div className="yt-grid">
          <article className="yt-video">
            <div className="yt-thumb" style={{ backgroundImage: img ? `url(${img.thumb})` : undefined }}>
              <span className="yt-dur">{formatTime(cuts.long.total).replace(/\.\d$/, '')}</span>
            </div>
            <div className="yt-vrow">
              {img && <img className="yt-avatar small" src={img.icon} alt="" />}
              <div>
                <h4>{title}</h4>
                <p className="yt-meta">{info.name}</p>
              </div>
            </div>
          </article>
          {cuts.short && (
            <article className="yt-short">
              <div className="yt-thumb tall" style={{ backgroundImage: img ? `url(${img.short})` : undefined }} />
              <h4>{projectHook(project, lang)?.text ?? project.episodeTitle}</h4>
            </article>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ thumbnails

/** A frame of the episode (16:9, no subtitles), for thumbnails. */
function episodeFrame(project: Project, tl: Timeline, t: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = THUMB.w;
  c.height = THUMB.h;
  renderFrame(c.getContext('2d')!, c.width, c.height, { ...project, settings: { ...project.settings, aspect: '16:9' } }, tl, t, { filmGrain: false, subtitles: project.settings.subtitles, burnSubtitles: false });
  return c;
}

/** Candidate moments for a thumbnail: the episode's cards (records, identikits, statements, counts). */
function moments(tl: Timeline): { at: number; label: string }[] {
  return tl.spans
    .flatMap((s, k) => placeBeats(tl, k).map((p) => ({ p, scene: s.scene.title })))
    .filter(({ p }) => ['record', 'person', 'statement', 'count', 'waffle'].includes(p.beat.kind))
    .map(({ p, scene }) => ({ at: +(p.start + 1.2).toFixed(1), label: `${formatTime(p.start)} · ${scene} · ${p.beat.kind}${'name' in p.beat ? ` ${p.beat.name}` : ''}` }));
}
function strongMoment(tl: Timeline) {
  const all = tl.spans.flatMap((_s, k) => placeBeats(tl, k));
  const p = all.find((x) => x.beat.kind === 'record') ?? all.find((x) => x.beat.kind === 'person');
  return p ? p.start + 1.2 : tl.total * 0.4;
}

function Thumbs({ project, info, cuts, onChange }: { project: Project; info: ChannelInfo; cuts: Cuts; onChange(i: ChannelInfo): void }) {
  const lang = project.settings.language;
  const list = useMemo(() => moments(cuts.long), [cuts.long]);
  const at = info.thumbAt ?? strongMoment(cuts.long);
  const refs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const cover = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      await Promise.all([loadMaster(), loadProjectMedia(project)]);
      if (!alive) return;
      const frame = episodeFrame(project, cuts.long, at);
      for (const l of LAYOUTS) {
        const g = refs.current[l.id]?.getContext('2d');
        if (g) drawThumbnail(g, l.id, frame, info.thumb[lang] ?? '', 'THE FOX FILES · MKULTRA');
      }
      const cg = cover.current?.getContext('2d');
      if (cg) drawShortCover(cg, null, info.thumb[lang] ?? '', projectHook(project, lang)?.text ?? '');
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [project, cuts.long, at, info.thumb, lang]);
  const download = (c: HTMLCanvasElement | null | undefined, name: string) =>
    c?.toBlob((b) => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  const using = info.thumbLayout ?? 'dossier';
  return (
    <div className="channel-grid">
      <section className="ch-card wide">
        <h3>Thumbnails · 1280×720 {ready ? '' : '(drawing…)'}</h3>
        <div className="row gap wrap small">
          <label className="tune-row ch-row">
            <span>Frame</span>
            <select className="isel" value={String(at)} onChange={(e) => onChange({ ...info, thumbAt: Number(e.target.value) })}>
              {!list.some((m) => m.at === at) && <option value={String(at)}>{formatTime(at)}</option>}
              {list.map((m) => (
                <option key={m.at} value={String(m.at)}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <span className="muted">Words: “{info.thumb[lang]}” (Brand kit)</span>
        </div>
        <div className="ch-thumbs">
          {LAYOUTS.map((l) => (
            <figure key={l.id} className={`ch-thumb ${using === l.id ? 'on' : ''}`}>
              <canvas ref={(c) => void (refs.current[l.id] = c)} width={THUMB.w} height={THUMB.h} />
              <figcaption className="row gap small">
                <b>{l.label}</b>
                <button className="btn small ghost" onClick={() => onChange({ ...info, thumbLayout: l.id, thumbAt: at })}>
                  {using === l.id ? '✓ In use' : 'Use this one'}
                </button>
                <button className="btn small ghost" onClick={() => download(refs.current[l.id], `fox-files-thumb-${l.id}.png`)}>
                  PNG
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
      <section className="ch-card">
        <h3>Short cover · 1080×1920</h3>
        <canvas ref={cover} width={COVER.w} height={COVER.h} className="ch-cover" />
        <button className="btn small" onClick={() => download(cover.current, 'fox-files-short-cover.png')}>
          Download PNG
        </button>
      </section>
      <section className="ch-card">
        <h3>Rules these follow</h3>
        <ul className="ch-checks small">
          <li>The master Agent Fox on every thumbnail, the same series tag in the same corner.</li>
          <li>2–3 words in the series font, never the title's words (title.py checks the pairing).</li>
          <li>One strong frame of the episode: a record, an identikit, a big statement.</li>
          <li>Readable at phone size: big words, high contrast, one focal point.</li>
        </ul>
      </section>
    </div>
  );
}
