import type { TransitionType } from '../types';
import { clamp, easeInOut, easeOut } from '../animation/math';
import { drawInkWipe } from './cartoon';

export const TRANSITION_IN = 0.7;
export const TRANSITION_OUT = 0.55;

export const TRANSITION_LABELS: Record<TransitionType, string> = {
  iris: 'Iris (cartoon circle)',
  fade: 'Fade through black',
  flash: 'Projector flash',
  ink: 'Ink splat wipe',
};

/**
 * Draw an entering or leaving transition over a finished scene frame.
 * `p` is 0 when the transition fully covers the frame and 1 when it is gone.
 */
export function applyTransition(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  type: TransitionType,
  p: number,
  focus: { x: number; y: number },
  entering: boolean,
): void {
  const q = clamp(p);
  if (q >= 1) return;
  g.save();
  switch (type) {
    case 'iris': {
      const maxR = Math.hypot(Math.max(focus.x, w - focus.x), Math.max(focus.y, h - focus.y)) * 1.05;
      const r = maxR * easeInOut(q);
      g.beginPath();
      g.rect(0, 0, w, h);
      g.arc(focus.x, focus.y, Math.max(0.01, r), 0, Math.PI * 2, true);
      g.fillStyle = '#050302';
      g.fill('evenodd');
      // Thin inked rim like an old cartoon iris.
      if (r > 1) {
        g.beginPath();
        g.arc(focus.x, focus.y, r, 0, Math.PI * 2);
        g.lineWidth = Math.max(1.5, Math.min(w, h) * 0.006);
        g.strokeStyle = 'rgba(40, 28, 18, 0.9)';
        g.stroke();
      }
      break;
    }
    case 'fade':
      g.fillStyle = `rgba(5, 3, 2, ${1 - easeOut(q)})`;
      g.fillRect(0, 0, w, h);
      break;
    case 'ink':
      drawInkWipe(g, w, h, q, entering ? 17 : 29);
      break;
    case 'flash':
      if (entering) {
        // Bright projector burst that settles into the image.
        const a = 1 - easeOut(q);
        g.fillStyle = `rgba(255, 236, 196, ${a * 0.95})`;
        g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = 'multiply';
        g.fillStyle = `rgba(180, 110, 50, ${a * 0.4})`;
        g.fillRect(0, 0, w, h);
      } else {
        g.fillStyle = `rgba(5, 3, 2, ${1 - easeOut(q)})`;
        g.fillRect(0, 0, w, h);
      }
      break;
  }
  g.restore();
}
