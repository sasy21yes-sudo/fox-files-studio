import { ArrayBufferTarget, Muxer } from 'mp4-muxer';

/**
 * Real MP4 export via WebCodecs (H.264 — or VP9 where no H.264 encoder exists — plus AAC/Opus audio)
 * muxed with mp4-muxer. Frames are rendered deterministically one by one,
 * so the export is frame-accurate and usually faster than real time.
 *
 * The encoder is isolated behind the `Mp4Encoder` interface so another
 * implementation (e.g. a server-side or wasm encoder) can replace it.
 */

export interface FrameSource {
  width: number;
  height: number;
  fps: number;
  duration: number;
  /** Draw the frame at time `t` (seconds) onto the canvas that is then encoded. */
  renderFrame(t: number): void;
  canvas: HTMLCanvasElement | OffscreenCanvas;
}

export interface Mp4EncodeOptions {
  codec: string;
  family: 'avc' | 'vp9';
  videoBitrate: number;
  audio: { buffer: AudioBuffer; codec: 'aac' | 'opus' } | null;
  signal: AbortSignal;
  onProgress(p: number, label: string): void;
}

export interface Mp4Encoder {
  readonly name: string;
  encode(source: FrameSource, opts: Mp4EncodeOptions): Promise<Blob>;
}

const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0));

export class WebCodecsMp4Encoder implements Mp4Encoder {
  readonly name = 'WebCodecs + mp4-muxer';

  async encode(source: FrameSource, opts: Mp4EncodeOptions): Promise<Blob> {
    const { width, height, fps, duration } = source;
    const target = new ArrayBufferTarget();
    const audio = opts.audio;
    const muxer = new Muxer({
      target,
      video: { codec: opts.family, width, height, frameRate: fps },
      audio: audio ? { codec: audio.codec, numberOfChannels: audio.buffer.numberOfChannels, sampleRate: audio.buffer.sampleRate } : undefined,
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });

    let failure: unknown = null;
    const video = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => (failure = e),
    });
    video.configure({
      codec: opts.codec,
      width,
      height,
      bitrate: opts.videoBitrate,
      framerate: fps,
      ...(opts.family === 'avc' ? { avc: { format: 'avc' as const } } : {}),
      latencyMode: 'quality',
    });

    const totalFrames = Math.max(1, Math.round(duration * fps));
    const frameUs = 1_000_000 / fps;
    try {
      for (let i = 0; i < totalFrames; i++) {
        if (opts.signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
        if (failure) throw failure;
        source.renderFrame(i / fps);
        const frame = new VideoFrame(source.canvas, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) });
        video.encode(frame, { keyFrame: i % (fps * 2) === 0 });
        frame.close();
        // Back-pressure: don't let the encoder queue grow without bound.
        while (video.encodeQueueSize > 6) {
          await new Promise((r) => setTimeout(r, 2));
          if (failure) throw failure;
        }
        if (i % 3 === 0) {
          opts.onProgress((i / totalFrames) * (audio ? 0.92 : 0.98), `Encoding video frame ${i + 1} / ${totalFrames}`);
          await yieldToUI();
        }
      }
      await video.flush();
      if (failure) throw failure;

      if (audio) {
        opts.onProgress(0.93, 'Encoding audio');
        await encodeAudio(muxer, audio.buffer, audio.codec, duration, opts.signal);
      }
      opts.onProgress(0.98, 'Writing MP4 container');
      muxer.finalize();
    } finally {
      if (video.state !== 'closed') video.close();
    }
    return new Blob([target.buffer], { type: 'video/mp4' });
  }
}

async function encodeAudio(
  muxer: Muxer<ArrayBufferTarget>,
  buffer: AudioBuffer,
  codec: 'aac' | 'opus',
  duration: number,
  signal: AbortSignal,
) {
  let failure: unknown = null;
  const enc = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => (failure = e),
  });
  const sampleRate = buffer.sampleRate;
  const channels = buffer.numberOfChannels;
  enc.configure({ codec: codec === 'aac' ? 'mp4a.40.2' : 'opus', sampleRate, numberOfChannels: channels, bitrate: 160_000 });
  const total = Math.min(buffer.length, Math.ceil(duration * sampleRate));
  const block = 4800; // 100 ms
  const planes = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  try {
    for (let offset = 0; offset < total; offset += block) {
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      if (failure) throw failure;
      const n = Math.min(block, total - offset);
      const data = new Float32Array(n * channels);
      for (let c = 0; c < channels; c++) data.set(planes[c].subarray(offset, offset + n), c * n);
      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: n,
        numberOfChannels: channels,
        timestamp: Math.round((offset / sampleRate) * 1_000_000),
        data,
      });
      enc.encode(audioData);
      audioData.close();
      if (enc.encodeQueueSize > 20) await new Promise((r) => setTimeout(r, 1));
    }
    await enc.flush();
    if (failure) throw failure;
  } finally {
    if (enc.state !== 'closed') enc.close();
  }
}
