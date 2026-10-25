import type { Timeline } from '../animation/timeline';

/** What the dashboard measures on a cut (whole episode or Short) from its own timeline. */
export interface CutStats {
  total: number;
  scenes: number;
  words: number;
  wpm: number;
  popups: number;
  popupsPerMin: number;
  /** Scene starts plus pop-ups per minute: how often something new appears. */
  changesPerMin: number;
  hook: number;
  /** Share of subtitle cues faster than 17 chars/s. */
  fastCues: number;
}

export function cutStats(tl: Timeline, popups: number): CutStats {
  const words = tl.cues.reduce((n, c) => n + c.text.split(/\s+/).filter(Boolean).length, 0);
  const spoken = tl.clips.reduce((n, c) => n + c.duration, 0) || tl.cues.reduce((n, c) => n + (c.end - c.start), 0);
  const min = Math.max(tl.total / 60, 1e-6);
  return {
    total: tl.total,
    scenes: tl.spans.length,
    words,
    wpm: spoken ? (words / spoken) * 60 : 0,
    popups,
    popupsPerMin: popups / min,
    changesPerMin: (tl.spans.length + popups) / min,
    hook: tl.hook?.end ?? 0,
    fastCues: tl.cues.length ? tl.cues.filter((c) => c.text.length / Math.max(0.2, c.end - c.start) > 17).length / tl.cues.length : 0,
  };
}

/**
 * A heuristic retention curve (% still watching every 5 s) - an estimate from the cut's structure, NOT YouTube
 * data. Long video: the opening loses 15-40% depending on the hook's score, then a slide per minute that grows
 * with a rushed voice, few visual changes and subtitles too fast to read, and a drop at the end screen. Short:
 * the share that stays past the first seconds follows the hook, then a gentle slide. The rules of thumb come from
 * the youtube-agent skills' retention notes (hook leak, cliffs, slide); real exports replace it on the dashboard.
 */
export function forecast(s: CutStats, hookScore: number, short: boolean): { curve: [number, number][]; avgPct: number; avgSec: number } {
  const curve: [number, number][] = [];
  let r = 100;
  const hookLoss = short ? Math.min(60, Math.max(15, 55 - hookScore * 0.4)) : Math.min(40, Math.max(15, 45 - hookScore * 0.3));
  const openEnd = short ? 3 : 30;
  const slide =
    (short ? 4 : 7) + (s.wpm > 185 ? 2 : s.wpm < 140 ? 1.5 : 0) + (s.changesPerMin < 3 ? 2 : 0) - Math.min(3, s.changesPerMin * 0.3) + s.fastCues * 4;
  const perStep = Math.max(2, Math.min(14, slide)) / 100 / 12; // the slide is per minute; steps are 5 s
  for (let t = 0; t <= s.total + 0.01; t += 5) {
    if (t === 0) r = 100;
    else if (t <= openEnd) r = 100 - hookLoss * (t / openEnd) ** 0.6;
    else r = Math.min(r, 100 - hookLoss) * (1 - perStep);
    if (!short && t > s.total - 15) r *= 0.985;
    curve.push([t, Math.max(0, r)]);
  }
  const avgPct = curve.reduce((a, [, v]) => a + v, 0) / curve.length;
  return { curve, avgPct, avgSec: (avgPct / 100) * s.total };
}
