import type { Project } from '../types';
import { MKULTRA_PROJECT_ID, STORAGE_KEY as LEGACY_KEY, createMkultraProject } from './mkultraProject';
import { PROJECT_SCHEMA_VERSION, restoreProject } from './project';
import { mediaDataUrls, storeMediaDataUrls } from '../media/store';

/**
 * The project library: every episode is stored on its own key in
 * localStorage, with a small index (title, last edit) and the episode that
 * was open last. Storage can be unavailable (private mode): everything still
 * works in memory and the header says that edits are not saved.
 */

const INDEX_KEY = 'fox-files-studio:library';
const projectKey = (id: string) => `fox-files-studio:project:${id}`;

export interface LibraryEntry {
  id: string;
  title: string;
  template: Project['template'];
  scenes: number;
  updated: number;
}

interface LibraryIndex {
  current: string | null;
  projects: LibraryEntry[];
}

export function storage(): Storage | null {
  try {
    const s = window.localStorage;
    const k = '__fox_test__';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

const entryOf = (p: Project): LibraryEntry => ({
  id: p.id,
  title: p.template === 'mkultra' ? `MKUltra — ${p.episodeTitle}` : p.episodeTitle || 'Untitled episode',
  template: p.template,
  scenes: p.scenes.length,
  updated: p.updated ?? Date.now(),
});

function readIndex(s: Storage): LibraryIndex {
  try {
    const raw = JSON.parse(s.getItem(INDEX_KEY) ?? 'null');
    if (raw && Array.isArray(raw.projects)) return raw as LibraryIndex;
  } catch {
    /* fall through to a fresh index */
  }
  return { current: null, projects: [] };
}

function writeIndex(s: Storage, idx: LibraryIndex) {
  s.setItem(INDEX_KEY, JSON.stringify(idx));
}

/** Move the single v7 project into the library (once). */
function migrateLegacy(s: Storage, idx: LibraryIndex): LibraryIndex {
  const raw = s.getItem(LEGACY_KEY);
  if (!raw) return idx;
  try {
    const p = restoreProject(JSON.parse(raw));
    if (p && !idx.projects.some((e) => e.id === p.id)) {
      s.setItem(projectKey(p.id), JSON.stringify(p));
      idx = { current: idx.current ?? p.id, projects: [...idx.projects, entryOf(p)] };
      writeIndex(s, idx);
    }
    s.removeItem(LEGACY_KEY);
  } catch {
    /* keep the legacy key untouched if it cannot be read */
  }
  return idx;
}

export function listProjects(): LibraryEntry[] {
  const s = storage();
  if (!s) return [];
  return migrateLegacy(s, readIndex(s)).projects.slice().sort((a, b) => b.updated - a.updated);
}

export function loadProject(id: string): Project | null {
  const s = storage();
  if (!s) return null;
  try {
    return restoreProject(JSON.parse(s.getItem(projectKey(id)) ?? 'null'));
  } catch {
    return null;
  }
}

/** The episode to open at startup: the last one used, else MKUltra. */
/** True when the page started from the built-in template because the library had no episode to open: that
 *  project must never be pushed over the repository's copy (it replaced the edited 8-scene episode, 2026-10-26). */
export let startedFromTemplate = false;

export function loadInitialProject(): Project {
  const s = storage();
  const fallback = () => {
    startedFromTemplate = true;
    return createMkultraProject();
  };
  if (!s) return fallback();
  const idx = migrateLegacy(s, readIndex(s));
  const id = idx.current ?? idx.projects[0]?.id;
  return (id && loadProject(id)) || fallback();
}

/** Save (and make current); returns what was saved (stamped with the time). Throws when storage is full or unavailable. */
export function saveProject(p: Project): Project {
  const s = storage();
  if (!s) throw new Error('storage unavailable');
  const stamped = { ...p, updated: Date.now() };
  s.setItem(projectKey(p.id), JSON.stringify(stamped));
  const idx = readIndex(s);
  writeIndex(s, { current: p.id, projects: [...idx.projects.filter((e) => e.id !== p.id), entryOf(stamped)] });
  return stamped;
}

/** Keep a copy of an episode in the library without opening it (e.g. the local side of a sync conflict). */
export function stashProject(p: Project): void {
  const s = storage();
  if (!s) return;
  s.setItem(projectKey(p.id), JSON.stringify(p));
  const idx = readIndex(s);
  writeIndex(s, { current: idx.current, projects: [...idx.projects.filter((e) => e.id !== p.id), entryOf(p)] });
}

export function deleteProject(id: string): void {
  const s = storage();
  if (!s) return;
  s.removeItem(projectKey(id));
  const idx = readIndex(s);
  writeIndex(s, { current: idx.current === id ? null : idx.current, projects: idx.projects.filter((e) => e.id !== id) });
}

/** A copy with a new id (the MKUltra original can always be restored from the template). */
export function duplicateProject(p: Project): Project {
  const id = `${p.template === 'mkultra' ? 'mkultra' : 'episode'}-${Math.random().toString(36).slice(2, 10)}`;
  return { ...structuredClone(p), id, episodeTitle: p.template === 'mkultra' ? p.episodeTitle : `${p.episodeTitle} (copy)`, updated: Date.now() };
}

/** A project file to download (.foxproj.json). */
/** A self-contained project file: the episode plus its images (as data URLs under `mediaData`). */
export async function exportProjectFile(p: Project): Promise<Blob> {
  const mediaData = p.media?.length ? await mediaDataUrls(p) : undefined;
  return new Blob([JSON.stringify({ ...p, schemaVersion: PROJECT_SCHEMA_VERSION, ...(mediaData ? { mediaData } : {}) }, null, 2)], { type: 'application/json' });
}

/** Read a project file. Imports never overwrite: an id already in the library gets a new one. */
export async function importProjectFile(file: File): Promise<Project> {
  const raw = JSON.parse(await file.text());
  const p = restoreProject(raw);
  if (!p) throw new Error('This file is not a Fox Files project (or uses an unknown version).');
  if (raw && typeof raw.mediaData === 'object') await storeMediaDataUrls(raw.mediaData as Record<string, string>);
  const taken = listProjects().some((e) => e.id === p.id) || p.id === MKULTRA_PROJECT_ID;
  return taken ? duplicateProject(p) : p;
}
