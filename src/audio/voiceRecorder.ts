import type { Project } from '../types';

/**
 * The page's side of tools/vite/voiceRecord.ts: re-records the studio voice pack on this computer after
 * the narration changed. Only on the local dev server; elsewhere it reports nothing.
 */

export interface RecorderStatus {
  available: boolean;
  /** "lang:voice" for every voice this computer can record. */
  voices: string[];
  job: {
    state: 'idle' | 'waiting' | 'running' | 'done' | 'error';
    voice: string | null;
    version: number;
    log: string[];
    error: string | null;
  };
}

const local = () => typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

export async function recorderStatus(): Promise<RecorderStatus | null> {
  if (!local()) return null;
  try {
    const r = await fetch('/api/voice/record/status', { cache: 'no-store' });
    return r.ok ? ((await r.json()) as RecorderStatus) : null;
  } catch {
    return null;
  }
}

/** Ask the dev server to record the episode's new sentences with `voice`. */
export async function startRecorder(lang: string, voice: string, project: Project): Promise<void> {
  await fetch('/api/voice/record', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang, voice, project }) }).catch(
    () => undefined,
  );
}
