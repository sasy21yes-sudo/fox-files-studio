/**
 * Preview audio engine (Web Audio API): plays the procedural score and an
 * optional user-supplied narration file in sync with the timeline.
 * Speech-synthesis narration is handled separately by SpeechNarrator.
 */

export interface NarrationFile {
  name: string;
  duration: number;
  buffer: AudioBuffer;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private startedAt = 0;
  private startOffset = 0;
  private rate = 1;
  running = false;

  /** Create or resume the AudioContext. Must be called from a user gesture the first time. */
  ensure(): AudioContext | null {
    try {
      if (!this.ctx) this.ctx = new AudioContext({ latencyHint: 'interactive' });
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    } catch {
      return null;
    }
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  async decodeFile(file: File): Promise<NarrationFile> {
    const ctx = this.ensure();
    if (!ctx) throw new Error('Web Audio is not available in this browser.');
    const data = await file.arrayBuffer();
    const buffer = await ctx.decodeAudioData(data);
    return { name: file.name, duration: buffer.duration, buffer };
  }

  start(offset: number, rate: number, tracks: { buffer: AudioBuffer; gain: number }[]) {
    this.stop();
    const ctx = this.ensure();
    if (!ctx) return;
    this.rate = rate;
    this.startOffset = offset;
    this.startedAt = ctx.currentTime + 0.02;
    for (const track of tracks) {
      if (offset >= track.buffer.duration) continue;
      const src = ctx.createBufferSource();
      src.buffer = track.buffer;
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = track.gain;
      src.connect(g).connect(ctx.destination);
      src.start(this.startedAt, offset);
      this.sources.push(src);
    }
    this.running = this.sources.length > 0;
  }

  /** Play part of a buffer once (voice test), outside the timeline. */
  preview(buffer: AudioBuffer, offset: number, duration: number) {
    this.stop();
    const ctx = this.ensure();
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start(ctx.currentTime + 0.02, offset, duration);
    this.sources.push(src);
  }

  /** Timeline position according to the audio clock, or null when not playing audio. */
  position(): number | null {
    if (!this.running || !this.ctx) return null;
    return this.startOffset + Math.max(0, this.ctx.currentTime - this.startedAt) * this.rate;
  }

  stop() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
      s.disconnect();
    }
    this.sources = [];
    this.running = false;
  }
}
