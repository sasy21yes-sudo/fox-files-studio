/**
 * Audio for export.
 *
 * What CAN be put into an exported file: the procedural score and a
 * narration audio file the user supplies, mixed here with an
 * OfflineAudioContext.
 *
 * What CANNOT: browser speech synthesis. The voice is produced by the
 * operating system's speech engine, outside the page's audio graph, so
 * neither MediaRecorder nor WebCodecs can record it. The exporter reports
 * this instead of pretending otherwise.
 */

export const EXPORT_SAMPLE_RATE = 48000;

export interface ExportAudioInput {
  duration: number;
  music?: { buffer: AudioBuffer; gain: number } | null;
  narration?: { buffer: AudioBuffer; gain: number } | null;
}

/** Mix the export soundtrack. Returns null when there is nothing to include. */
export async function mixExportAudio(input: ExportAudioInput): Promise<AudioBuffer | null> {
  const tracks = [input.music, input.narration].filter(Boolean) as { buffer: AudioBuffer; gain: number }[];
  if (!tracks.length) return null;
  const sr = EXPORT_SAMPLE_RATE;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(input.duration * sr)), sr);
  for (const t of tracks) {
    const src = ctx.createBufferSource();
    src.buffer = t.buffer;
    const g = ctx.createGain();
    g.gain.value = t.gain;
    src.connect(g).connect(ctx.destination);
    src.start(0);
  }
  return ctx.startRendering();
}

export interface LiveAudioStream {
  stream: MediaStream;
  start(): void;
  stop(): void;
}

/** Real-time playback of a mixed buffer into a MediaStream (for MediaRecorder). */
export function createLiveAudioStream(buffer: AudioBuffer): LiveAudioStream {
  const ctx = new AudioContext({ sampleRate: buffer.sampleRate });
  const dest = ctx.createMediaStreamDestination();
  let src: AudioBufferSourceNode | null = null;
  return {
    stream: dest.stream,
    start() {
      void ctx.resume();
      src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(dest);
      src.start();
    },
    stop() {
      try {
        src?.stop();
      } catch {
        /* ignore */
      }
      src?.disconnect();
      dest.stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}

/** Encode an AudioBuffer as a 16-bit PCM WAV file (used for the separate soundtrack download). */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  const bytes = 44 + length * channels * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const str = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, length * channels * 2, true);
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}
