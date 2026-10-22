import type { AspectRatio } from '../types';

export const EXPORT_SIZES: Record<AspectRatio, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
};
export const EXPORT_FPS = 30;

export interface VideoCodecChoice {
  codec: string;
  family: 'avc' | 'vp9';
}

export interface RecorderFormat {
  mimeType: string;
  container: 'video/mp4' | 'video/webm';
  extension: 'mp4' | 'webm';
  label: string;
}

export interface Capabilities {
  webCodecs: {
    available: boolean;
    /**
     * Best video codec the WebCodecs encoder accepts for MP4, per target size.
     * H.264 is preferred; VP9-in-MP4 is the fallback for browsers without an
     * H.264 encoder (e.g. open-source Chromium builds). null = not supported.
     */
    video: Record<AspectRatio, VideoCodecChoice | null>;
    audio: 'aac' | 'opus' | null;
  };
  recorder: {
    available: boolean;
    captureStream: boolean;
    formats: RecorderFormat[];
  };
  speechSynthesis: boolean;
  offlineAudio: boolean;
}

const RECORDER_CANDIDATES: RecorderFormat[] = [
  { mimeType: 'video/mp4;codecs=avc1.640028,mp4a.40.2', container: 'video/mp4', extension: 'mp4', label: 'MP4 (H.264 + AAC) via MediaRecorder' },
  { mimeType: 'video/mp4;codecs=avc1,mp4a', container: 'video/mp4', extension: 'mp4', label: 'MP4 (H.264 + AAC) via MediaRecorder' },
  { mimeType: 'video/mp4', container: 'video/mp4', extension: 'mp4', label: 'MP4 via MediaRecorder' },
  { mimeType: 'video/webm;codecs=vp9,opus', container: 'video/webm', extension: 'webm', label: 'WebM (VP9 + Opus)' },
  { mimeType: 'video/webm;codecs=vp8,opus', container: 'video/webm', extension: 'webm', label: 'WebM (VP8 + Opus)' },
  { mimeType: 'video/webm', container: 'video/webm', extension: 'webm', label: 'WebM' },
];

// Main, High and Baseline profiles at level 4.0 / 4.2 / 5.1 — enough for 1080x1920 @ 30 fps.
const VIDEO_CANDIDATES: VideoCodecChoice[] = [
  ...['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.64002a', 'avc1.640033', 'avc1.42001f'].map((codec) => ({ codec, family: 'avc' as const })),
  { codec: 'vp09.00.40.08', family: 'vp9' },
  { codec: 'vp09.00.31.08', family: 'vp9' },
];

async function findVideoCodec(width: number, height: number): Promise<VideoCodecChoice | null> {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const choice of VIDEO_CANDIDATES) {
    try {
      const res = await VideoEncoder.isConfigSupported({
        codec: choice.codec,
        width,
        height,
        bitrate: 8_000_000,
        framerate: EXPORT_FPS,
        ...(choice.family === 'avc' ? { avc: { format: 'avc' as const } } : {}),
      });
      if (res.supported) return choice;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function findAudioCodec(): Promise<'aac' | 'opus' | null> {
  if (typeof AudioEncoder === 'undefined') return null;
  const tries: ['aac' | 'opus', string][] = [
    ['aac', 'mp4a.40.2'],
    ['opus', 'opus'],
  ];
  for (const [name, codec] of tries) {
    try {
      const res = await AudioEncoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 });
      if (res.supported) return name;
    } catch {
      /* try next */
    }
  }
  return null;
}

let cached: Promise<Capabilities> | null = null;

export function detectCapabilities(): Promise<Capabilities> {
  if (!cached) cached = detect();
  return cached;
}

async function detect(): Promise<Capabilities> {
  const hasRecorder = typeof MediaRecorder !== 'undefined';
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const captureStream = !!canvas && typeof canvas.captureStream === 'function';
  const formats = hasRecorder
    ? RECORDER_CANDIDATES.filter((f) => {
        try {
          return MediaRecorder.isTypeSupported(f.mimeType);
        } catch {
          return false;
        }
      })
    : [];
  // Keep one entry per container, preferring the most specific MIME type.
  const seen = new Set<string>();
  const unique = formats.filter((f) => (seen.has(f.container) ? false : (seen.add(f.container), true)));

  const [v916, v169, audio] = await Promise.all([findVideoCodec(1080, 1920), findVideoCodec(1920, 1080), findAudioCodec()]);
  return {
    webCodecs: {
      available: typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined',
      video: { '9:16': v916, '16:9': v169 },
      audio,
    },
    recorder: { available: hasRecorder && captureStream, captureStream, formats: unique },
    speechSynthesis: typeof window !== 'undefined' && 'speechSynthesis' in window,
    offlineAudio: typeof OfflineAudioContext !== 'undefined',
  };
}
