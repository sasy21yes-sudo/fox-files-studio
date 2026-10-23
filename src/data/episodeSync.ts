/// <reference types="vite/client" />
import type { Project } from '../types';
import { restoreProject } from './project';
import { getMediaBlob, loadProjectMedia, putMediaBlob } from '../media/store';

/**
 * The page's side of tools/vite/episodeSync.ts: every saved episode is also written to the repository
 * (episodes/<id>.foxproj.json + episodes/media/), which the dev server commits and pushes; episodes
 * changed in the repository (pulled from a remote Claude Code session, or edited on disk) come back
 * here. Only on the local dev server; elsewhere every call is a quiet no-op.
 */

export interface SyncStatus {
  enabled: boolean;
  git: boolean;
  push: boolean;
  branch: string | null;
  upstream: boolean;
  lastSync: number | null;
  lastCommit: string | null;
  error: string | null;
}

const local = () => typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

let available: Promise<boolean> | null = null;
export function syncAvailable(): Promise<boolean> {
  available ??= local()
    ? fetch('/__episodes/status')
        .then((r) => r.ok)
        .catch(() => false)
    : Promise.resolve(false);
  return available;
}

export async function syncStatus(): Promise<SyncStatus | null> {
  if (!(await syncAvailable())) return null;
  try {
    return (await (await fetch('/__episodes/status')).json()) as SyncStatus;
  } catch {
    return null;
  }
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
let onDisk: Set<string> | null = null;
async function mediaOnDisk(): Promise<Set<string>> {
  onDisk ??= new Set<string>(await fetch('/__episodes/media').then((r) => (r.ok ? r.json() : [])).catch(() => []));
  return onDisk;
}
const fileFor = (names: Set<string>, id: string) => [...names].find((n) => n.startsWith(`${id}.`));

/** The episode as it is written to the repository: canonical JSON, the same text the server stores. */
export const episodeText = (p: Project) => JSON.stringify(p, null, 2) + '\n';

/** Write an episode (and any image the repository does not have yet) to the repository. */
export async function pushEpisode(p: Project): Promise<void> {
  if (!(await syncAvailable())) return;
  await fetch(`/__episodes/p/${encodeURIComponent(p.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: episodeText(p) });
  const names = await mediaOnDisk();
  for (const m of p.media ?? []) {
    if (fileFor(names, m.id)) continue;
    const blob = await getMediaBlob(m.id);
    if (!blob) continue;
    const name = `${m.id}.${EXT[blob.type] ?? 'png'}`;
    const r = await fetch(`/__episodes/m/${encodeURIComponent(name)}`, { method: 'PUT', body: blob });
    if (r.ok) names.add(name);
  }
}

/** The episode as the repository has it (null when it has none), with its images copied into this browser. */
export async function pullEpisode(id: string): Promise<Project | null> {
  if (!(await syncAvailable())) return null;
  const r = await fetch(`/__episodes/p/${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (!r.ok) return null;
  const raw = await r.json();
  const project = restoreProject(raw);
  if (!project) return null;
  onDisk = null;
  const names = await mediaOnDisk();
  for (const m of project.media ?? []) {
    if (await getMediaBlob(m.id)) continue;
    const name = fileFor(names, m.id);
    if (!name) continue;
    const img = await fetch(`/__episodes/m/${encodeURIComponent(name)}`);
    if (img.ok) await putMediaBlob(m.id, await img.blob());
  }
  await loadProjectMedia(project);
  return project;
}

/** Called with the ids of episodes the repository changed (a pull, or an edit on disk). */
export function onEpisodesChanged(fn: (ids: string[]) => void): () => void {
  const hot = import.meta.hot;
  if (!hot) return () => undefined;
  const handler = (d: { ids: string[] }) => fn(d.ids);
  hot.on('fox:episodes', handler);
  return () => hot.off?.('fox:episodes', handler);
}

/** JSON with object keys sorted (an edited object and the same one read back may list keys differently). */
function canonical(v: unknown): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(',')}}`;
}

/** Fingerprint of an episode's content (its save time and image data left out), to tell who changed it. */
export function episodeHash(p: Project): string {
  const t = canonical({ ...p, updated: 0, mediaData: undefined });
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193) >>> 0;
  return `${h.toString(16)}-${t.length}`;
}

/** The fingerprint of the version this browser and the repository last agreed on, per episode. */
const SYNCED = (id: string) => `fox-files-studio:synced:${id}`;
export function syncedHash(id: string): string | null {
  try {
    return localStorage.getItem(SYNCED(id));
  } catch {
    return null;
  }
}
export function markSynced(p: Project): void {
  try {
    localStorage.setItem(SYNCED(p.id), episodeHash(p));
  } catch {
    /* storage unavailable: every start compares again */
  }
}
