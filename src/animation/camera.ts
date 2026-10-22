import { clamp, easeInOut, lerp, noise1, seg } from './math';
import type { Stage } from './stage';

/**
 * Cartoon cinematography: each scene is a list of shots (wide, medium,
 * close-up, insert) with hard cuts, quick push-ins and whip pans, plus a
 * slow drift and a touch of hand-held float inside every shot.
 *
 * Shots are expressed in "world" coordinates, which are the screen
 * coordinates of the scene's wide composition. `ax, ay` is the world point the
 * shot frames; `sx, sy` is where that point lands on screen (0..1).
 */

export type ShotEnter = 'cut' | 'push' | 'whip';

export interface Shot {
  at: number;
  zoom: number;
  ax: number;
  ay: number;
  sx?: number;
  sy?: number;
  /** Slow push-in per second inside the shot (e.g. 0.02). */
  drift?: number;
  enter?: ShotEnter;
  /** Lock off the hand-held float (e.g. for title cards). */
  locked?: boolean;
}

export interface Cam {
  zoom: number;
  ax: number;
  ay: number;
  sx: number;
  sy: number;
  /** 0..1 strength of a whip pan in progress, with its direction. */
  whip: number;
  whipDir: number;
}

function shotState(_s: Stage, shot: Shot, k: number): Cam {
  const dt = Math.max(0, Math.min(8, k - shot.at));
  const zoom = shot.zoom * (1 + (shot.drift ?? 0.012) * dt);
  return { zoom, ax: shot.ax, ay: shot.ay, sx: shot.sx ?? 0.5, sy: shot.sy ?? 0.5, whip: 0, whipDir: 0 };
}

export function resolveCam(s: Stage, shots: Shot[]): Cam {
  const k = s.k;
  let i = 0;
  for (let j = 0; j < shots.length; j++) if (k >= shots[j].at) i = j;
  const shot = shots[i];
  let cam = shotState(s, shot, k);
  const enter = shot.enter ?? 'cut';
  if (i > 0 && enter !== 'cut') {
    const dur = enter === 'push' ? 0.6 : 0.3;
    const p = seg(k, shot.at, dur);
    if (p < 1) {
      const prev = shotState(s, shots[i - 1], k);
      const e = enter === 'push' ? easeInOut(p) : p < 0.5 ? 16 * p ** 5 : 1 - Math.pow(-2 * p + 2, 5) / 2;
      cam = {
        zoom: lerp(prev.zoom, cam.zoom, e),
        ax: lerp(prev.ax, cam.ax, e),
        ay: lerp(prev.ay, cam.ay, e),
        sx: lerp(prev.sx, cam.sx, e),
        sy: lerp(prev.sy, cam.sy, e),
        whip: enter === 'whip' ? Math.sin(p * Math.PI) : 0,
        whipDir: Math.sign(cam.ax - prev.ax) || 1,
      };
    }
  }
  // Hand-held float.
  if (!shot.locked) {
    const amp = (4 * s.u) / Math.max(1, cam.zoom * 0.7);
    cam.ax += noise1(s.time * 0.7, 3) * amp;
    cam.ay += noise1(s.time * 0.6, 8) * amp * 0.7;
  }
  // Keep the frame inside the painted world.
  cam.zoom = Math.max(1, cam.zoom);
  const vw = s.w / cam.zoom;
  const vh = s.h / cam.zoom;
  const left = clamp(cam.ax - cam.sx * vw, -0.12 * s.w, 1.12 * s.w - vw);
  const top = clamp(cam.ay - cam.sy * vh, -0.12 * s.h, 1.12 * s.h - vh);
  cam.ax = left + cam.sx * vw;
  cam.ay = top + cam.sy * vh;
  return cam;
}

export function withShot(s: Stage, cam: Cam, draw: () => void) {
  const { g, w, h } = s;
  g.save();
  g.translate(cam.sx * w, cam.sy * h);
  g.scale(cam.zoom, cam.zoom);
  g.translate(-cam.ax, -cam.ay);
  draw();
  g.restore();
}

/** Where a world point lands on screen under a camera. */
export function camToScreen(s: Stage, cam: Cam, x: number, y: number) {
  return { x: (x - cam.ax) * cam.zoom + cam.sx * s.w, y: (y - cam.ay) * cam.zoom + cam.sy * s.h };
}

/** Motion streaks during a whip pan. */
export function drawWhip(s: Stage, cam: Cam) {
  if (cam.whip <= 0.02) return;
  const { g, w, h, u } = s;
  g.save();
  g.globalAlpha = cam.whip * 0.85;
  for (let i = 0; i < 26; i++) {
    const y = ((i * 97.13) % 1) * h + ((i * 37) % 11) * u;
    const len = (0.3 + ((i * 53) % 7) / 10) * w;
    const x = ((i * 211) % 100) / 100 * w - len / 2;
    g.fillStyle = i % 3 ? 'rgba(30, 18, 10, 0.55)' : 'rgba(255, 236, 200, 0.35)';
    g.fillRect(x, y, len, (4 + (i % 4) * 3) * u);
  }
  g.restore();
}

/** Standard framings, scaled for the format. */
export function framing(s: Stage, kind: 'wide' | 'medium' | 'close' | 'extreme' | 'insert') {
  const v = s.vertical;
  switch (kind) {
    case 'wide':
      return 1;
    case 'medium':
      return v ? 1.3 : 1.55;
    case 'close':
      return v ? 1.75 : 2.3;
    case 'extreme':
      return v ? 2.3 : 3.0;
    case 'insert':
      return v ? 1.6 : 1.9;
  }
}
