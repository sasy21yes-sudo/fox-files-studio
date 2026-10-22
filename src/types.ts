// Shared domain types for The Fox Files Studio.
import type { Lang } from './i18n/languages';
import type { SceneSpec } from './scene/spec';
import type { Beat } from './data/mkultraScript';

export type AspectRatio = '9:16' | '16:9';

export type NarrationMode = 'studio' | 'speech' | 'file' | 'off';

export type TransitionType = 'iris' | 'fade' | 'flash' | 'ink';

/** The six hand-coded scenes of the MKUltra episode. */
export type MkSceneId = 'file' | 'question' | 'experiments' | 'cost' | 'revelation' | 'known';

/** Any scene id: the MKUltra ones or a generated one ("scene-xxxx") in other episodes. */
export type SceneId = string;

/** One animated scene of the episode. Durations are in seconds. */
export interface Scene {
  id: SceneId;
  number: number;
  title: string;
  summary: string;
  /** Duration used by playback, subtitles and export. */
  duration: number;
  /** The duration the choreography was authored for. Events are time-stretched to `duration`. */
  authoredDuration: number;
  /** Transition used when entering this scene. */
  transition: TransitionType;
  /** false = no chapter intertitle on this scene even when the episode uses them (cutaways). */
  chapterCard?: boolean;
  /** Narration text in the current language. It drives the voice and the subtitle cues. */
  narration: string;
  /** Narration kept per language, so switching languages never loses an edit. */
  narrations?: Partial<Record<Lang, string>>;
  /** Words or phrases highlighted in the burned-in subtitles. */
  keywords: string[];
  /** Ids of entries in `SOURCES` that support this scene's claims. */
  sourceIds: string[];
  /** Data-driven choreography (scene/spec.ts). When absent the hand-coded renderer for `id` is used. */
  spec?: SceneSpec;
  /** Explainer pop-ups in the current language. MKUltra scenes fall back to i18n/scripts.ts. */
  beats?: Beat[];
  /** Pop-ups kept per language, like `narrations`. */
  beatsByLang?: Partial<Record<Lang, Beat[]>>;
  /** Titles kept per language (episodes other than MKUltra). */
  titles?: Partial<Record<Lang, string>>;
}

export interface SubtitleStyle {
  enabled: boolean;
  /** Multiplier on the base subtitle size. */
  fontScale: number;
  /** 0 = lowest position inside the safe area, 1 = highest. */
  position: number;
  highlightKeywords: boolean;
}

export interface ProjectSettings {
  aspect: AspectRatio;
  filmGrain: boolean;
  /** Preview playback speed. Export always renders at 1x. */
  previewSpeed: number;
  subtitles: SubtitleStyle;
  music: boolean;
  musicVolume: number;
  /** Narration, subtitle, pop-up and on-screen label language. */
  language: Lang;
  /** Neural studio narrator (see audio/studioVoice.ts), per language. */
  studioVoice: Partial<Record<Lang, string>>;
  voiceURI: string | null;
  speechRate: number;
  /** 'studio' = rendered neural voice, 'speech' = browser speech synthesis, 'file' = user-supplied narration audio, 'off' = silent. */
  narrationMode: NarrationMode;
  showSafeArea: boolean;
  /** 1930s-style chapter intertitle at the start of each scene. */
  chapterCards: boolean;
  /** Cold-open hook at the start of the vertical (9:16) Short. */
  shortHook: boolean;
  /** Agent Fox look: the painted cut-out puppet or the original vector rig. */
  characterStyle: 'painted' | 'vector';
}

/** Cold-open line of the vertical Short. */
export interface Hook {
  text: string;
  keywords: string[];
}

/** An image in the episode's library (pixels in IndexedDB, see media/store.ts). */
export interface MediaItem {
  id: string;
  name: string;
  width: number;
  height: number;
  created: number;
  /** 'generated' = made by the local image model; 'imported' = a file the user added. */
  source: 'generated' | 'imported';
  prompt?: string;
  style?: string;
  seed?: number;
}

export interface Project {
  id: string;
  schemaVersion: number;
  /** 'mkultra' = the original episode (texts and translations from i18n/scripts.ts); 'custom' = everything lives in the project. */
  template: 'mkultra' | 'custom';
  /** Last edit (ms since epoch), for the project library. */
  updated?: number;
  /** Images that picture elements can show. */
  media?: MediaItem[];
  /** Short hook for custom episodes, per language. */
  hooks?: Partial<Record<Lang, Hook>>;
  /** Bibliography of a custom episode (MKUltra uses data/sources.ts). */
  sources?: Source[];
  title: string;
  episodeTitle: string;
  episodeSubtitle: string;
  scenes: Scene[];
  settings: ProjectSettings;
}

/** A subtitle cue on the shared timeline. */
export interface Subtitle {
  id: string;
  sceneIndex: number;
  start: number;
  end: number;
  text: string;
  /** 'estimated' when derived from word counts; 'exact' only for real audio timestamps. */
  timing: 'estimated' | 'exact';
}

/** A choreographed animation beat inside a scene, in authored seconds. */
export interface AnimationEvent {
  id: string;
  label: string;
  at: number;
  duration: number;
}

export type AudioSource =
  | { kind: 'speech-synthesis'; voiceURI: string | null; rate: number }
  | { kind: 'narration-file'; name: string; duration: number; buffer: AudioBuffer }
  | { kind: 'none' };

export type ExportMethod = 'webcodecs-mp4' | 'mediarecorder';

export interface ExportSettings {
  aspect: AspectRatio;
  width: number;
  height: number;
  fps: number;
  method: ExportMethod;
  /** Real container MIME type (no codecs parameter). */
  container: 'video/mp4' | 'video/webm';
  /** Full MIME type passed to MediaRecorder, when that method is used. */
  recorderMimeType?: string;
  extension: 'mp4' | 'webm';
  videoBitrate: number;
  includeMusic: boolean;
  includeNarrationFile: boolean;
  burnSubtitles: boolean;
  filmGrain: boolean;
}

export interface ExportResult {
  blob: Blob;
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  duration: number;
  hasAudio: boolean;
  audioDescription: string;
  notes: string[];
}

export interface Source {
  id: string;
  title: string;
  publisher: string;
  date: string;
  url: string;
  altUrl?: string;
  claims: string[];
}
