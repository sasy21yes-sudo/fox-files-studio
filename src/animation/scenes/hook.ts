import { drawFox } from '../../character/AgentFox';
import { cueViseme } from '../lipSync';
import { drawSunburst, elastic } from '../../effects/cartoon';
import { applyTransition } from '../../effects/transitions';
import { clamp, easeOutBack, seg } from '../math';
import { drawStamp } from '../props';
import { FONT_SANS, wrapText } from '../stage';
import type { Timeline } from '../timeline';
import type { Subtitle } from '../../types';

/**
 * Cold-open hook for the vertical Short (first ~5 seconds): a smash-cut
 * close-up of Agent Fox over a spinning red sunburst, with the hook line
 * landing word by word in big kinetic captions. The captions are the
 * subtitles here, so the regular subtitle bar is suppressed.
 */
export function renderHook(g: CanvasRenderingContext2D, w: number, h: number, tl: Timeline, time: number) {
  const u = Math.min(w, h) / 1080;
  const end = tl.hook!.end;
  const cues = tl.cues.filter((c) => c.sceneIndex === -1);
  const cue = cues.find((c) => time >= c.start && time < c.end) ?? (time < (cues[0]?.start ?? 0) ? undefined : [...cues].reverse().find((c) => time >= c.start));

  // Background: fast red sunburst with a dark vignette.
  drawSunburst(g, w / 2, h * 0.6, Math.hypot(w, h), time * 0.9, '#6e180c', '#962812', 22);
  const vg = g.createRadialGradient(w / 2, h * 0.55, Math.min(w, h) * 0.25, w / 2, h * 0.55, Math.hypot(w, h) * 0.6);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.7)');
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);

  // Agent Fox pops up into an extreme close-up.
  const S = (h > w ? 2.35 : 1.7) * u;
  const headX = w * (h > w ? 0.44 : 0.3);
  const headY = h * (h > w ? 0.63 : 0.62);
  const rise = easeOutBack(seg(time, 0.05, 0.4));
  const foxX = headX - 30 * S;
  const foxY = headY + 418 * S + (1 - rise) * h * 0.5;
  const surprise = seg(time, 0.3, 0.1) * (1 - seg(time, 0.6, 0.6));
  const speaking = !!cue && time < cue.end;
  drawFox(g, {
    x: foxX,
    y: foxY,
    scale: S,
    time,
    noShadow: true,
    surprise,
    pop: time > 0.3 && time < 1.5 ? { symbol: '!', p: (time - 0.3) / 1.2 } : null,
    angry: time > 2.6 ? 0.7 : 0.2,
    brows: time > 2.6 ? 0 : 0.3,
    lookX: time > 2.6 ? 0.1 : 0.6,
    lookY: -0.1,
    speaking,
    viseme: cueViseme(tl, cue, time),
    armFront: time > 2.6 ? 'point' : 'rest',
    armFrontFrom: 'rest',
    armFrontBlend: time > 2.6 ? easeOutBack(seg(time, 2.6, 0.35)) : 1,
    pointAngle: -0.55,
  });

  // Kinetic captions.
  if (cue) drawKineticCaption(g, w, h, u, cue, time, tl.hook?.keywords ?? []);

  // Source stamp.
  drawStamp(g, 'U.S. SENATE HEARING · 1977', w * (h > w ? 0.55 : 0.72), h * (h > w ? 0.355 : 0.62), (h > w ? 40 : 34) * u, -0.08, seg(time, 3.5, 0.4), '#f3e6c8');

  // Smash-cut flash in, iris out to the opening chapter card.
  const flash = 1 - seg(time, 0, 0.25);
  if (flash > 0) {
    g.fillStyle = `rgba(255, 245, 225, ${flash})`;
    g.fillRect(0, 0, w, h);
  }
  const remaining = end - time;
  if (remaining < 0.45) applyTransition(g, w, h, 'iris', remaining / 0.45, { x: headX, y: headY }, false);
}

function drawKineticCaption(g: CanvasRenderingContext2D, w: number, h: number, u: number, cue: Subtitle, time: number, keywords: string[]) {
  const vertical = h > w;
  const size = (vertical ? 112 : 80) * u;
  g.save();
  g.font = `700 ${size}px ${FONT_SANS}`;
  const words = cue.text.toUpperCase().split(/\s+/);
  const totalChars = cue.text.length;
  const lines = wrapText(g, cue.text.toUpperCase(), w * (vertical ? 0.86 : 0.6));
  // Every word of every occurrence of a keyword lights up (a 3-word window around each word only ever matched
  // the middle word of a 3-word keyword: "DEL" lit, "ATTI" and "SENATO" did not).
  const bare = (word: string) => word.replace(/[^\p{Lu}\p{N}']/gu, '');
  const hotIdx = new Set<number>();
  const plain = words.map(bare);
  for (const k of keywords.map((x) => x.toUpperCase().split(/\s+/).map(bare))) {
    for (let i = 0; i + k.length <= plain.length; i++) {
      if (k.every((p, j) => plain[i + j] === p)) for (let j = 0; j < k.length; j++) hotIdx.add(i + j);
    }
  }
  const isHot = (_word: string, idx: number) => hotIdx.has(idx);
  // Word start times, proportional to character position within the cue.
  let charPos = 0;
  const starts = words.map((wd) => {
    const t = cue.start + (charPos / totalChars) * (cue.end - cue.start);
    charPos += wd.length + 1;
    return t;
  });
  const lineH = size * 1.12;
  const top = vertical ? h * 0.12 : h * 0.12;
  const cx = vertical ? w / 2 : w * 0.66;
  let wi = 0;
  lines.forEach((line, li) => {
    const lw = line.split(' ');
    const widths = lw.map((x) => g.measureText(x).width);
    const space = g.measureText(' ').width;
    const total = widths.reduce((a, b) => a + b, 0) + space * (lw.length - 1);
    let x = cx - total / 2;
    const y = top + li * lineH + size;
    lw.forEach((word, j) => {
      const idx = wi++;
      const p = seg(time, starts[idx] ?? cue.start, 0.28);
      if (p > 0) {
        const s = elastic(p);
        g.save();
        g.translate(x + widths[j] / 2, y - size * 0.35);
        g.rotate((1 - clamp(p * 2)) * (idx % 2 ? 0.15 : -0.15));
        g.scale(s, s);
        g.textAlign = 'center';
        g.textBaseline = 'alphabetic';
        g.lineJoin = 'round';
        g.lineWidth = size * 0.2;
        g.strokeStyle = '#140d08';
        g.strokeText(word, 0, size * 0.35);
        g.fillStyle = isHot(word, idx) ? '#ffd25a' : '#ffffff';
        g.fillText(word, 0, size * 0.35);
        g.restore();
      }
      x += widths[j] + space;
    });
  });
  g.restore();
}
