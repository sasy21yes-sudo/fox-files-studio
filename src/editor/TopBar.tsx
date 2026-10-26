import type { Project } from '../types';
import { FoxGlyph, type SaveStatus } from '../components/Header';
import type { SyncStatus } from '../data/episodeSync';

export type Page = 'media' | 'edit' | 'deliver' | 'team' | 'channel' | 'tools';

interface Props {
  project: Project;
  page: Page;
  saveStatus: SaveStatus;
  /** The repository copy of the episode (null: not on the local dev server). */
  repo?: SyncStatus | null;
  repoNote?: string | null;
  canUndo: boolean;
  canRedo: boolean;
  theater: boolean;
  onPage(p: Page): void;
  onUndo(): void;
  onRedo(): void;
  onRename(title: string): void;
  onToggleTheater(): void;
  onSources(): void;
  onModelSheet(): void;
}

const SAVE_LABEL: Record<SaveStatus, string> = {
  saved: 'Salvato',
  saving: 'Salvataggio…',
  unavailable: 'Non salvato (memoria disattivata)',
  error: 'Salvataggio non riuscito',
};

/** Top bar of the editor: project, undo/redo, save state and page switcher. */
export function TopBar(p: Props) {
  const mk = p.project.template === 'mkultra';
  return (
    <header className="topbar editor-top">
      <div className="brand">
        <FoxGlyph />
        <div className="brand-text">
          <span className="brand-name">Fox Files Studio</span>
          {mk ? (
            <span className="project-name" title="L’episodio MKUltra: il titolo viene dal copione tradotto">
              {p.project.episodeTitle}
            </span>
          ) : (
            <input className="project-rename" value={p.project.episodeTitle} onChange={(e) => p.onRename(e.target.value)} aria-label="Titolo dell’episodio" />
          )}
        </div>
      </div>

      <nav className="pages" aria-label="Pagine">
        {(['media', 'edit', 'deliver', 'team', 'channel', 'tools'] as const).map((pg) => (
          <button key={pg} className={p.page === pg ? 'on' : ''} onClick={() => p.onPage(pg)} aria-current={p.page === pg}>
            {pg === 'media' ? 'Media' : pg === 'edit' ? 'Montaggio' : pg === 'deliver' ? 'Esporta' : pg === 'team' ? 'Team' : pg === 'channel' ? 'Canale' : 'Strumenti'}
          </button>
        ))}
      </nav>

      <div className="top-actions">
        <button className="btn icon ghost" onClick={p.onUndo} disabled={!p.canUndo} title="Annulla (Ctrl+Z)" aria-label="Annulla">
          ↶
        </button>
        <button className="btn icon ghost" onClick={p.onRedo} disabled={!p.canRedo} title="Ripeti (Ctrl+Maiusc+Z)" aria-label="Ripeti">
          ↷
        </button>
        <span className={`save-pill save-${p.saveStatus}`} role="status" aria-live="polite">
          <span className="dot" />
          {SAVE_LABEL[p.saveStatus]}
        </span>
        {p.repo && <RepoPill repo={p.repo} note={p.repoNote ?? null} />}
        <button className="btn ghost" onClick={p.onModelSheet}>
          Agent Fox
        </button>
        <button className="btn ghost" onClick={p.onSources}>
          Fonti
        </button>
        <button className={`btn ${p.theater ? 'active' : ''}`} onClick={p.onToggleTheater} aria-pressed={p.theater}>
          {p.theater ? 'Chiudi anteprima' : 'Anteprima'}
        </button>
        <button className="btn primary" onClick={() => p.onPage('deliver')} title="Esporta il video (YouTube 16:9 e Short 9:16), sottotitoli e colonna sonora">
          Esporta video
        </button>
      </div>
    </header>
  );
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Where the episode stands in the git repository (episodes/ folder, committed and pushed by the dev server). */
function RepoPill({ repo, note }: { repo: SyncStatus; note: string | null }) {
  const tone = repo.error ? 'error' : note ? 'saving' : 'saved';
  const where = repo.git ? `${repo.branch ?? '?'}${repo.push ? '' : ' (local only)'}` : 'files only';
  const label = repo.error ? 'Repo: errore di sincronizzazione' : note ?? (repo.lastSync ? `Repo · ${where} · ${clock(repo.lastSync)}` : `Repo · ${where}`);
  const title = [
    'L’episodio viene scritto anche in episodes/ nel repository e sincronizzato con git, così si può modificare a distanza con Claude Code.',
    repo.git ? `Branch ${repo.branch}${repo.upstream ? '' : ' (non ancora sul remoto)'}.` : 'Git disattivato (FOX_EPISODE_GIT=off): solo file.',
    repo.lastCommit ? `Last commit ${repo.lastCommit}.` : '',
    repo.error ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={`save-pill save-${tone}`} role="status" aria-live="polite" title={title}>
      <span className="dot" />
      {label}
    </span>
  );
}
