import { createLiveAudioStream } from '../audio/audioCapture';

/**
 * Real-time export with canvas.captureStream() + MediaRecorder.
 * The animation is played on a dedicated canvas at 1x speed while the
 * recorder captures it, so an 90-second episode takes about 90 seconds
 * (or longer on a slow machine). The output format is whatever the browser
 * actually produces; the caller derives the file extension from it.
 */

export interface RecorderOptions {
  canvas: HTMLCanvasElement;
  fps: number;
  duration: number;
  mimeType: string;
  videoBitrate: number;
  audio: AudioBuffer | null;
  renderFrame(t: number): void;
  signal: AbortSignal;
  onProgress(p: number, label: string): void;
}

export interface RecorderOutput {
  blob: Blob;
  /** The MIME type reported by the recorder (may include codecs). */
  mimeType: string;
}

export function recordWithMediaRecorder(opts: RecorderOptions): Promise<RecorderOutput> {
  return new Promise((resolve, reject) => {
    const videoStream = opts.canvas.captureStream(opts.fps);
    const live = opts.audio ? createLiveAudioStream(opts.audio) : null;
    const tracks = [...videoStream.getVideoTracks(), ...(live ? live.stream.getAudioTracks() : [])];
    const stream = new MediaStream(tracks);

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: opts.mimeType, videoBitsPerSecond: opts.videoBitrate, audioBitsPerSecond: 160_000 });
    } catch (e) {
      tracks.forEach((t) => t.stop());
      live?.stop();
      reject(e);
      return;
    }

    const chunks: Blob[] = [];
    let raf = 0;
    let cancelled = false;
    const cleanup = () => {
      cancelAnimationFrame(raf);
      tracks.forEach((t) => t.stop());
      videoStream.getTracks().forEach((t) => t.stop());
      live?.stop();
      opts.signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cancelled = true;
      if (recorder.state !== 'inactive') recorder.stop();
    };
    opts.signal.addEventListener('abort', onAbort);

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = (e) => {
      cleanup();
      reject((e as unknown as { error?: Error }).error ?? new Error('MediaRecorder error'));
    };
    recorder.onstop = () => {
      cleanup();
      if (cancelled) {
        reject(new DOMException('Export cancelled', 'AbortError'));
        return;
      }
      const type = recorder.mimeType || opts.mimeType;
      resolve({ blob: new Blob(chunks, { type: type.split(';')[0] }), mimeType: type });
    };

    // Draw the first frame before starting so the recording never begins black.
    opts.renderFrame(0);
    recorder.start(1000);
    live?.start();
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= opts.duration) {
        opts.renderFrame(opts.duration - 1 / opts.fps);
        // Give the recorder a moment to receive the final frames.
        setTimeout(() => recorder.state !== 'inactive' && recorder.stop(), 250);
        return;
      }
      opts.renderFrame(t);
      opts.onProgress(t / opts.duration, `Recording in real time · ${t.toFixed(1)} / ${opts.duration.toFixed(1)} s`);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });
}
