import { useRef, useState } from 'react';
import type { Project } from '../types';
import { createMkultraProject } from '../data/mkultraProject';
import { createBlankProject } from '../data/project';
import { deleteProject, duplicateProject, exportProjectFile, importProjectFile, listProjects, loadProject, type LibraryEntry } from '../data/library';
import { ARM_MODES, ELEMENTS, FACE_KEYS } from '../scene/elements';

interface Props {
  project: Project;
  /** Open another project (the current one is saved first by the caller). */
  onOpen(p: Project): void;
  /** Bumped by the caller after every save, so the list refreshes. */
  savedTick: number;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Media page: the episode library, plus what scenes can be built from. */
export function MediaPage({ project, onOpen, savedTick }: Props) {
  const [entries, setEntries] = useState<LibraryEntry[]>(() => listProjects());
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(savedTick);
  const fileRef = useRef<HTMLInputElement>(null);
  if (tick !== savedTick) {
    setTick(savedTick);
    setEntries(listProjects());
  }
  const refresh = () => setEntries(listProjects());
  const lang = project.settings.language;

  const open = (id: string) => {
    const p = id === project.id ? project : loadProject(id);
    if (p) onOpen(p);
    else setError('That project could not be read.');
  };

  return (
    <div className="media-page">
      <section className="media-section">
        <header className="media-head">
          <h2>Episodes</h2>
          <div className="media-actions">
            <button className="btn primary" onClick={() => onOpen(createBlankProject(lang))}>
              + New episode
            </button>
            <button className="btn" onClick={() => onOpen(duplicateProject(createMkultraProject(lang)))} title="A fresh copy of the MKUltra episode to modify">
              + Copy of MKUltra
            </button>
            <button className="btn ghost" onClick={() => fileRef.current?.click()}>
              Import project file…
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                setError(null);
                try {
                  onOpen(await importProjectFile(f));
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              }}
            />
          </div>
        </header>
        {error && <p className="warn-text">{error}</p>}
        <div className="project-grid">
          {(entries.some((e) => e.id === project.id) ? entries : [{ id: project.id, title: project.episodeTitle, template: project.template, scenes: project.scenes.length, updated: Date.now() }, ...entries]).map((e) => (
            <article key={e.id} className={`project-card ${e.id === project.id ? 'current' : ''}`}>
              <button className="project-open" onClick={() => open(e.id)}>
                <span className="project-title">{e.title}</span>
                <span className="muted small">
                  {e.scenes} scene{e.scenes === 1 ? '' : 's'} · {e.template === 'mkultra' ? 'MKUltra template' : 'custom'} · {when(e.updated)}
                </span>
                {e.id === project.id && <span className="badge">open</span>}
              </button>
              <div className="project-tools">
                <button
                  className="btn small ghost"
                  onClick={() => {
                    const p = e.id === project.id ? project : loadProject(e.id);
                    if (p) download(exportProjectFile(p), `${e.title.replace(/[^\w-]+/g, '_').slice(0, 40)}.foxproj.json`);
                  }}
                >
                  Export file
                </button>
                <button
                  className="btn small ghost"
                  onClick={() => {
                    const p = e.id === project.id ? project : loadProject(e.id);
                    if (p) onOpen(duplicateProject(p));
                  }}
                >
                  Duplicate
                </button>
                {confirm === e.id ? (
                  <>
                    <button
                      className="btn small danger"
                      onClick={() => {
                        deleteProject(e.id);
                        setConfirm(null);
                        refresh();
                      }}
                    >
                      Delete for good
                    </button>
                    <button className="btn small ghost" onClick={() => setConfirm(null)}>
                      Keep
                    </button>
                  </>
                ) : (
                  <button className="btn small ghost" disabled={e.id === project.id} title={e.id === project.id ? 'Open another episode first' : 'Delete'} onClick={() => setConfirm(e.id)}>
                    Delete
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
        <p className="help">Episodes are saved in this browser. Export a project file to keep a copy, move it to another computer or put it in git.</p>
      </section>

      <section className="media-section">
        <h2>Element library</h2>
        <p className="help">What a scene made of data can contain. Add them from the Elements tab of the Edit page, or ask for them in a prompt.</p>
        <div className="lib-grid">
          {Object.entries(ELEMENTS).map(([type, d]) => (
            <div key={type} className="lib-card">
              <span className="lib-name">{d.label}</span> <span className="badge">{d.category}</span>
              <p className="lib-desc">{d.description}</p>
              <code className="muted small">{type}</code>
            </div>
          ))}
        </div>
      </section>

      <section className="media-section">
        <h2>Agent Fox acting</h2>
        <dl className="vocab">
          <dt>Actions</dt>
          <dd>walk · skid · take (startled jump) · pop (! ? !?) · hop · sparkle · sweat</dd>
          <dt>Arm poses</dt>
          <dd>{ARM_MODES.join(' · ')}</dd>
          <dt>Face values</dt>
          <dd>{FACE_KEYS.join(' · ')}</dd>
          <dt>Mouth / eyes</dt>
          <dd>grin · smile · frown · open · wide · o / open · happy — while he speaks, the narration drives the mouth</dd>
        </dl>
      </section>
    </div>
  );
}
