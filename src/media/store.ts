import type { MediaItem, Project } from '../types';
import { loadProjectClips } from './clips';

/**
 * Images used by scenes ("picture" elements). The project only lists them
 * (MediaItem: id, size, where they came from); the pixels live in IndexedDB,
 * shared by every episode in this browser, and are decoded into a cache so
 * the synchronous renderer can draw them. Anything that renders frames for
 * output (export, stills) must `await loadProjectMedia(project)` first.
 */

const DB = 'fox-files-studio';
const STORE = 'media';

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = run(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const putMediaBlob = (id: string, blob: Blob) => tx('readwrite', (s) => s.put(blob, id)).then(() => undefined);
export const getMediaBlob = (id: string) => tx<Blob | undefined>('readonly', (s) => s.get(id) as IDBRequest<Blob | undefined>);

// ------------------------------------------------------------------ decoded cache

const cache = new Map<string, ImageBitmap>();
const pending = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let version = 0;

/** The decoded image, or undefined while it loads (the renderer draws a placeholder). */
export const mediaImage = (id: string): ImageBitmap | undefined => cache.get(id);
export const mediaVersion = () => version;
export function onMediaChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const changed = () => {
  version++;
  listeners.forEach((fn) => fn());
};
/** Something drawable finished loading elsewhere (animation clips): redraw like for a new image. */
export const bumpMedia = changed;

function decode(id: string): Promise<void> {
  if (cache.has(id)) return Promise.resolve();
  let p = pending.get(id);
  if (!p) {
    p = getMediaBlob(id)
      .then(async (blob) => {
        if (blob) {
          cache.set(id, await createImageBitmap(blob));
          changed();
        }
      })
      .catch(() => undefined)
      .finally(() => pending.delete(id));
    pending.set(id, p);
  }
  return p;
}

/** Decode every image the project lists. Resolves when all are drawable (missing ones are skipped). */
export async function loadProjectMedia(project: Project): Promise<void> {
  await Promise.all([...(project.media ?? []).map((m) => decode(m.id)), loadProjectClips(project)]);
}

const rid = () => Math.random().toString(36).slice(2, 10);

/** Store a new image and return its library entry (the caller adds it to the project). */
export async function addMedia(blob: Blob, info: Omit<MediaItem, 'id' | 'width' | 'height' | 'created'>): Promise<MediaItem> {
  const bmp = await createImageBitmap(blob);
  const item: MediaItem = { id: `img-${rid()}`, width: bmp.width, height: bmp.height, created: Date.now(), ...info };
  await putMediaBlob(item.id, blob);
  cache.set(item.id, bmp);
  changed();
  return item;
}

/** Image files embedded in a project file: id -> data URL. */
export async function mediaDataUrls(project: Project): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const m of project.media ?? []) {
    const blob = await getMediaBlob(m.id);
    if (!blob) continue;
    out[m.id] = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }
  return out;
}

export async function storeMediaDataUrls(data: Record<string, string>): Promise<void> {
  for (const [id, url] of Object.entries(data)) {
    if (!/^img-[a-z0-9]+$/.test(id) || !url.startsWith('data:image/')) continue;
    await putMediaBlob(id, await (await fetch(url)).blob());
  }
}
