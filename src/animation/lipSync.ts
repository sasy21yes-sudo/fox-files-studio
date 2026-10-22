import type { Subtitle } from '../types';
import { visemeFromText, visemeFromVoice } from '../character/AgentFox';
import type { Timeline } from './timeline';

/** Lip sync: the recorded voice level when there is one, else the text alone. */
export function cueViseme(tl: Timeline, cue: Subtitle | undefined, time: number) {
  if (!cue) return undefined;
  const q = Math.floor(time * 12) / 12;
  const progress = (q - cue.start) / (cue.end - cue.start);
  return tl.level && cue.timing === 'exact' ? visemeFromVoice(cue.text, progress, tl.level(q)) : visemeFromText(cue.text, progress);
}

