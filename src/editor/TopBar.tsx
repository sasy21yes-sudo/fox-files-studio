import type { Project } from '../types';
import { FoxGlyph, type SaveStatus } from '../components/Header';

export type Page = 'media' | 'edit' | 'deliver';

interface Props {
  project: Project;
  page: Page;
  saveStatus: SaveStatus;
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
  saved: 'Saved',
  saving: 'Saving…',
  unavailable: 'Not saved (storage off)',
  error: 'Save failed',
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
            <span className="project-name" title="The MKUltra episode: its title comes from the translated script">
              {p.project.episodeTitle}
            </span>
          ) : (
            <input className="project-rename" value={p.project.episodeTitle} onChange={(e) => p.onRename(e.target.value)} aria-label="Episode title" />
          )}
        </div>
      </div>

      <nav className="pages" aria-label="Pages">
        {(['media', 'edit', 'deliver'] as const).map((pg) => (
          <button key={pg} className={p.page === pg ? 'on' : ''} onClick={() => p.onPage(pg)} aria-current={p.page === pg}>
            {pg === 'media' ? 'Media' : pg === 'edit' ? 'Edit' : 'Deliver'}
          </button>
        ))}
      </nav>

      <div className="top-actions">
        <button className="btn icon ghost" onClick={p.onUndo} disabled={!p.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
          ↶
        </button>
        <button className="btn icon ghost" onClick={p.onRedo} disabled={!p.canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
          ↷
        </button>
        <span className={`save-pill save-${p.saveStatus}`} role="status" aria-live="polite">
          <span className="dot" />
          {SAVE_LABEL[p.saveStatus]}
        </span>
        <button className="btn ghost" onClick={p.onModelSheet}>
          Agent Fox
        </button>
        <button className="btn ghost" onClick={p.onSources}>
          Sources
        </button>
        <button className={`btn ${p.theater ? 'active' : ''}`} onClick={p.onToggleTheater} aria-pressed={p.theater}>
          {p.theater ? 'Exit preview' : 'Preview'}
        </button>
      </div>
    </header>
  );
}
