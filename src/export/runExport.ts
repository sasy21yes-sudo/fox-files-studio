import type { ExportResult, ExportSettings, Project } from '../types';
import { renderFrame } from '../animation/renderScene';
import { loadProjectMedia } from '../media/store';
import type { Timeline } from '../animation/timeline';
import { mixExportAudio } from '../audio/audioCapture';
import { recordWithMediaRecorder } from './browserRecorder';
import { WebCodecsMp4Encoder, type Mp4Encoder } from './mp4Encoder';
import type { Capabilities } from './capabilities';
import { loadCanvasFonts } from '../app/fonts';

export interface ExportInputs {
  project: Project;
  timeline: Timeline;
  settings: ExportSettings;
  capabilities: Capabilities;
  musicBuffer: AudioBuffer | null;
  narrationBuffer: AudioBuffer | null;
  signal: AbortSignal;
  onProgress(p: number, label: string): void;
  /** Swap in another MP4 encoder implementation here. */
  mp4Encoder?: Mp4Encoder;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function runExport(inp: ExportInputs): Promise<ExportResult> {
  const { project, timeline, settings: es, signal } = inp;
  const notes: string[] = [];

  // Make sure web fonts (if they loaded) and the episode's images are ready before the first frame.
  await Promise.all([loadCanvasFonts(), loadProjectMedia(project)]);

  // A dedicated canvas at the target resolution, separate from the preview.
  const canvas = document.createElement('canvas');
  canvas.width = es.width;
  canvas.height = es.height;
  const g = canvas.getContext('2d', { alpha: false });
  if (!g) throw new Error('Could not create a 2D canvas for export.');
  const draw = (t: number) =>
    renderFrame(g, es.width, es.height, project, timeline, Math.min(t, timeline.total - 1e-3), {
      filmGrain: es.filmGrain,
      subtitles: project.settings.subtitles,
      burnSubtitles: es.burnSubtitles,
    });

  // Soundtrack.
  inp.onProgress(0, 'Preparing soundtrack');
  const audio = await mixExportAudio({
    duration: timeline.total,
    music: es.includeMusic && inp.musicBuffer ? { buffer: inp.musicBuffer, gain: project.settings.musicVolume } : null,
    narration: es.includeNarrationFile && inp.narrationBuffer ? { buffer: inp.narrationBuffer, gain: 1 } : null,
  });
  const parts: string[] = [];
  if (audio && es.includeMusic && inp.musicBuffer) parts.push('score & room tone');
  if (audio && es.includeNarrationFile && inp.narrationBuffer) parts.push('the narration');

  let blob: Blob;
  let mimeType: string;
  let hasAudio = !!audio;

  if (es.method === 'webcodecs-mp4') {
    const choice = inp.capabilities.webCodecs.video[es.aspect];
    if (!choice) throw new Error('This browser’s WebCodecs encoder supports neither H.264 nor VP9 at this size.');
    if (choice.family === 'vp9') notes.push('No H.264 encoder is available in this browser, so the MP4 uses VP9 video. It plays in Chrome, Edge, Firefox and VLC; some older players and editors expect H.264.');
    const audioCodec = inp.capabilities.webCodecs.audio;
    if (audio && !audioCodec) {
      hasAudio = false;
      notes.push('This browser has no AAC or Opus audio encoder in WebCodecs, so the MP4 has no audio track. Use the separate soundtrack download, or the MediaRecorder method.');
    }
    if (audio && audioCodec === 'opus') notes.push('Audio is encoded as Opus inside MP4 (no AAC encoder available). Most modern players support this.');
    const encoder = inp.mp4Encoder ?? new WebCodecsMp4Encoder();
    blob = await encoder.encode(
      { width: es.width, height: es.height, fps: es.fps, duration: timeline.total, canvas, renderFrame: draw },
      {
        codec: choice.codec,
        family: choice.family,
        videoBitrate: es.videoBitrate,
        audio: audio && audioCodec ? { buffer: audio, codec: audioCodec } : null,
        signal,
        onProgress: inp.onProgress,
      },
    );
    mimeType = 'video/mp4';
  } else {
    if (!es.recorderMimeType) throw new Error('No MediaRecorder format selected.');
    const out = await recordWithMediaRecorder({
      canvas,
      fps: es.fps,
      duration: timeline.total,
      mimeType: es.recorderMimeType,
      videoBitrate: es.videoBitrate,
      audio,
      renderFrame: draw,
      signal,
      onProgress: inp.onProgress,
    });
    blob = out.blob;
    mimeType = out.mimeType;
  }

  if (!blob.size) throw new Error('The browser produced an empty file. Nothing was saved.');

  // Name the file after what it actually is — never a renamed WebM.
  const container = mimeType.split(';')[0].trim();
  const extension = container === 'video/mp4' ? 'mp4' : container === 'video/webm' ? 'webm' : container.split('/')[1] || 'bin';
  if (extension !== es.extension) notes.push(`The browser produced ${container}, so the file is saved as .${extension}.`);
  const fileName = `${slug(project.title)}-${slug(project.episodeTitle)}-${es.aspect.replace(':', 'x')}-${Math.min(es.width, es.height)}p.${extension}`;

  inp.onProgress(1, 'Done');
  return {
    blob,
    fileName,
    mimeType,
    width: es.width,
    height: es.height,
    duration: timeline.total,
    hasAudio,
    audioDescription: hasAudio ? `Audio track: ${parts.join(' + ')}.` : 'No audio track.',
    notes,
  };
}

export interface VerifyResult {
  playable: boolean;
  width?: number;
  height?: number;
  duration?: number;
  /** Mean brightness 0..255 of a frame sampled from the middle of the file. */
  sampleBrightness?: number;
  message: string;
}

/** Load the exported file into a <video> element to confirm it decodes and isn't black. */
export function verifyVideo(blob: Blob, expectedDuration: number): Promise<VerifyResult> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;
    let done = false;
    const finish = (r: VerifyResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeAttribute('src');
      v.load();
      URL.revokeObjectURL(url);
      resolve(r);
    };
    const timer = setTimeout(() => finish({ playable: false, message: 'Could not confirm playback in this browser within 12 s (the file may still be fine in a desktop player).' }), 12000);
    v.onerror = () => finish({ playable: false, message: 'This browser could not decode the exported file. Try opening it in a desktop video player.' });
    v.onloadedmetadata = () => {
      const seekTo = () => {
        const dur = Number.isFinite(v.duration) ? v.duration : expectedDuration;
        v.currentTime = Math.min(dur * 0.35, Math.max(0, dur - 0.5));
      };
      if (!Number.isFinite(v.duration)) {
        // MediaRecorder WebM files often lack a duration header; force the browser to scan.
        v.ondurationchange = () => {
          if (Number.isFinite(v.duration)) {
            v.ondurationchange = null;
            seekTo();
          }
        };
        v.currentTime = 1e7;
      } else {
        seekTo();
      }
    };
    v.onseeked = () => {
      if (v.currentTime > 1e6) return;
      let brightness: number | undefined;
      try {
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 64;
        const g = c.getContext('2d', { willReadFrequently: true })!;
        g.drawImage(v, 0, 0, 64, 64);
        const d = g.getImageData(0, 0, 64, 64).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        brightness = sum / (d.length / 4);
      } catch {
        /* ignore */
      }
      const dur = Number.isFinite(v.duration) ? v.duration : undefined;
      finish({
        playable: true,
        width: v.videoWidth,
        height: v.videoHeight,
        duration: dur,
        sampleBrightness: brightness,
        message:
          `Verified in this browser: ${v.videoWidth}×${v.videoHeight}` +
          (dur ? `, ${dur.toFixed(1)} s` : ', duration header missing (normal for MediaRecorder WebM)') +
          (brightness !== undefined ? `, sampled frame brightness ${brightness.toFixed(0)}/255${brightness < 6 ? ' — looks black!' : ''}` : '') +
          '.',
      });
    };
    v.src = url;
  });
}
