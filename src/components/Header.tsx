import { useState } from 'react';
import type { Project } from '../types';

export type SaveStatus = 'saved' | 'saving' | 'unavailable' | 'error';

interface Props {
  project: Project;
  saveStatus: SaveStatus;
  theater: boolean;
  onToggleTheater(): void;
  onExport(): void;
  onSources(): void;
  onModelSheet(): void;
  onReset(): void;
}

const SAVE_LABEL: Record<SaveStatus, string> = {
  saved: 'Saved in this browser',
  saving: 'Saving…',
  unavailable: 'Not saved — browser storage unavailable',
  error: 'Save failed',
};

export function FoxGlyph({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M8 6l14 18h20L56 6l-4 30-20 22L12 36z" fill="#b06a2c" stroke="#140d08" strokeWidth="4" strokeLinejoin="round" />
      <path d="M22 40l10 12 10-12-10 4z" fill="#efe2c4" />
      <circle cx="24" cy="32" r="3.5" fill="#140d08" />
      <circle cx="40" cy="32" r="3.5" fill="#140d08" />
      <path d="M12 22h40" stroke="#1d1712" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

export function Header({ project, saveStatus, theater, onToggleTheater, onExport, onSources, onModelSheet, onReset }: Props) {
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <header className="topbar">
      <div className="brand">
        <FoxGlyph />
        <div className="brand-text">
          <span className="brand-name">Fox Files Studio</span>
          <span className="project-name" title="Project">
            {project.title} · <em>{project.episodeTitle}</em>
          </span>
        </div>
      </div>
      <div className={`save-pill save-${saveStatus}`} role="status" aria-live="polite">
        <span className="dot" />
        {SAVE_LABEL[saveStatus]}
      </div>
      <nav className="top-actions">
        <button className="btn ghost" onClick={onModelSheet}>
          Agent Fox
        </button>
        <button className="btn ghost" onClick={onSources}>
          Sources
        </button>
        {confirmReset ? (
          <span className="confirm-inline" role="group" aria-label="Confirm reset">
            <span className="small">Discard your edits?</span>
            <button
              className="btn small"
              onClick={() => {
                setConfirmReset(false);
                onReset();
              }}
            >
              Reset project
            </button>
            <button className="btn small ghost" onClick={() => setConfirmReset(false)}>
              Keep edits
            </button>
          </span>
        ) : (
          <button className="btn ghost" onClick={() => setConfirmReset(true)} title="Restore the original MKUltra project">
            Reset
          </button>
        )}
        <button className={`btn ${theater ? 'active' : ''}`} onClick={onToggleTheater} aria-pressed={theater}>
          {theater ? 'Exit preview' : 'Preview'}
        </button>
        <button className="btn primary" onClick={onExport}>
          Export video
        </button>
      </nav>
    </header>
  );
}
