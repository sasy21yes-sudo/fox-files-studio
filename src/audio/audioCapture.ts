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
  /** Scene sound effects (audio/sfx.ts). */
  sfx?: { buffer: AudioBuffer; gain: number } | null;
}

/** Mix the export soundtrack. Returns null when there is nothing to include. */
export async function mixExportAudio(input: ExportAudioInput): Promise<AudioBuffer | null> {
  const tracks = [input.music, input.narration, input.sfx].filter(Boolean) as { buffer: AudioBuffer; gain: number }[];
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
  return master(await ctx.startRendering());
}

/** Delivery loudness: YouTube plays everything at about -14 LUFS and turns louder masters down, but never
 *  turns a quieter one up (the review measured -17.6). */
export const TARGET_LUFS = -14;
/** Sample-peak ceiling: 1 dB under the -1 dBTP delivery limit (at -1.5 the inter-sample peaks still reached -0.9 dBTP). */
const CEILING_DBFS = -2;

/**
 * The master stage: the mix brought to TARGET_LUFS (ITU-R BS.1770 integrated loudness), then a look-ahead
 * peak limiter so the louder mix stays under the ceiling without clipping. In place; returns the buffer.
 */
export function master(buf: AudioBuffer): AudioBuffer {
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const lufs = integratedLoudness(chans, buf.sampleRate);
  if (!Number.isFinite(lufs)) return buf;
  const gain = Math.pow(10, (TARGET_LUFS - lufs) / 20);
  const ceil = Math.pow(10, CEILING_DBFS / 20);
  const n = chans[0].length;
  // Gain each sample needs so that the louder channel stays under the ceiling.
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (const ch of chans) p = Math.max(p, Math.abs(ch[i] * gain));
    need[i] = p > ceil ? ceil / p : 1;
  }
  // Look ahead 5 ms: the gain starts going down before a peak arrives (ramp over the window), and comes back
  // up with an 80 ms release, so the limiter neither clicks nor pumps on single transients.
  const look = Math.max(1, Math.round(0.005 * buf.sampleRate));
  const rel = 1 - Math.exp(-1 / (0.08 * buf.sampleRate));
  const env = new Float32Array(n);
  let g = 1;
  for (let i = n - 1; i >= 0; i--) {
    // running minimum of the need over the next `look` samples (computed backwards)
    env[i] = Math.min(need[i], i + 1 < n ? env[i + 1] + (1 - env[i + 1]) / look : 1);
  }
  for (let i = 0; i < n; i++) {
    g = env[i] < g ? env[i] : g + (env[i] - g) * rel;
    const k = gain * g;
    for (const ch of chans) {
      const v = ch[i] * k;
      ch[i] = v > ceil ? ceil : v < -ceil ? -ceil : v;
    }
  }
  return buf;
}

/** ITU-R BS.1770-4 integrated loudness (LUFS) of channels at 48 kHz (K-weighting, 400 ms blocks, gates). */
export function integratedLoudness(chans: Float32Array[], sampleRate: number): number {
  if (sampleRate !== 48000) return NaN;
  // K-weighting: the BS.1770 pre-filter (high shelf) and RLB high-pass, 48 kHz coefficients.
  const stages = [
    { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [-1.69065929318241, 0.73248077421585] },
    { b: [1.0, -2.0, 1.0], a: [-1.99004745483398, 0.99007225036621] },
  ];
  const n = chans[0].length;
  const block = Math.round(0.4 * sampleRate);
  const hop = Math.round(0.1 * sampleRate);
  const nb = n >= block ? Math.floor((n - block) / hop) + 1 : 0;
  if (!nb) return NaN;
  const power = new Float64Array(nb);
  for (const ch of chans) {
    let x = Float64Array.from(ch);
    for (const { b, a } of stages) {
      const y = new Float64Array(n);
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < n; i++) {
        const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
        x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
        y[i] = v;
      }
      x = y;
    }
    // squared-sum prefix for fast block means
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + x[i] * x[i];
    for (let j = 0; j < nb; j++) power[j] += (pre[j * hop + block] - pre[j * hop]) / block;
  }
  const L = (p: number) => -0.691 + 10 * Math.log10(p);
  const abs = Array.from(power).filter((p) => L(p) > -70);
  if (!abs.length) return -Infinity;
  const rel = L(abs.reduce((s, p) => s + p, 0) / abs.length) - 10;
  const gated = abs.filter((p) => L(p) > rel);
  return L(gated.reduce((s, p) => s + p, 0) / gated.length);
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
