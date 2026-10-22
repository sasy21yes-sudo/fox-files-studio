/**
 * Canvas text only uses a web font once the browser has actually loaded it,
 * so request the faces explicitly. Offline, this resolves and the local
 * fallbacks in the font stacks are used instead.
 */
import { loadPuppet } from '../character/AgentFox';

let pending: Promise<void> | null = null;

/** Fonts plus the painted Agent Fox atlas: everything the canvas needs before drawing. */
export function loadCanvasFonts(): Promise<void> {
  if (pending) return pending;
  if (typeof document === 'undefined' || !document.fonts) return loadPuppet();
  const faces = ['900 40px "Playfair Display"', 'italic 700 40px "Playfair Display"', '40px "Special Elite"', '600 40px "IBM Plex Sans"'];
  pending = Promise.all([
    Promise.race([Promise.allSettled(faces.map((f) => document.fonts.load(f))).then(() => undefined), new Promise<void>((r) => setTimeout(r, 4000))]),
    loadPuppet(),
  ]).then(() => undefined);
  return pending;
}
