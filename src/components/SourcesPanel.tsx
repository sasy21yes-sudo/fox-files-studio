import type { Project } from '../types';
import { SOURCES, SOURCES_VERIFIED_ON } from '../data/sources';

export function SourcesPanel({ project, onClose }: { project: Project; onClose(): void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="sources-title" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal sources-modal">
        <header className="modal-head">
          <h2 id="sources-title">Sources</h2>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <p className="notice">
          <strong>Precompiled research, not live verification.</strong> These primary sources were checked against the linked documents on{' '}
          {SOURCES_VERIFIED_ON} when this demo was built. The app does not re-check them over the network. The narration paraphrases the record and
          contains no invented quotations; illustrated documents on screen are reconstructions, not reproductions.
        </p>
        <ol className="source-list">
          {SOURCES.map((s) => {
            const scenes = project.scenes.filter((sc) => sc.sourceIds.includes(s.id)).map((sc) => sc.number);
            return (
              <li key={s.id} className="source">
                <h3>{s.title}</h3>
                <p className="muted small">
                  {s.publisher} · {s.date}
                  {scenes.length > 0 && <> · used in scene{scenes.length > 1 ? 's' : ''} {scenes.join(', ')}</>}
                </p>
                <p className="small">
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.url}
                  </a>
                  {s.altUrl && (
                    <>
                      {' '}
                      · mirror:{' '}
                      <a href={s.altUrl} target="_blank" rel="noreferrer">
                        {s.altUrl}
                      </a>
                    </>
                  )}
                </p>
                <h4>Claims this source supports</h4>
                <ul>
                  {s.claims.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
        <p className="help">
          Limits of the record: many MKUltra files were destroyed in 1973, and the records recovered in 1977 were mainly financial documents. Many details of
          individual subprojects are therefore unknown, and this episode does not treat unverified allegations as fact.
        </p>
      </div>
    </div>
  );
}
