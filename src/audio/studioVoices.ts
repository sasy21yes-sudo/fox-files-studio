import type { Lang } from '../i18n/languages';

/**
 * Neural "studio" narrators. The clips are rendered offline with Kokoro-82M
 * (Apache-2.0) by tools/render_voice.py and shipped as one compressed track
 * plus a cue index per voice in public/voice/. Kokoro covers all five
 * narration languages; its English voices are the most natural.
 */
export interface StudioVoice {
  id: string;
  label: string;
  /** espeak-ng / Kokoro language code used for phonemes. */
  kokoroLang: string;
  /** Narration speed passed to Kokoro (1 = natural). */
  speed: number;
}

export const STUDIO_VOICES: Record<Lang, StudioVoice[]> = {
  en: [
    { id: 'am_michael', label: 'Michael — warm US narrator', kokoroLang: 'en-us', speed: 1.0 },
    { id: 'af_heart', label: 'Heart — bright US narrator', kokoroLang: 'en-us', speed: 1.0 },
    { id: 'bm_george', label: 'George — British documentary', kokoroLang: 'en-gb', speed: 1.0 },
  ],
  it: [
    { id: 'im_nicola', label: 'Nicola — narratore', kokoroLang: 'it', speed: 1.0 },
    { id: 'if_sara', label: 'Sara — narratrice', kokoroLang: 'it', speed: 1.0 },
  ],
  es: [
    { id: 'em_alex', label: 'Álex — narrador', kokoroLang: 'es', speed: 1.0 },
    { id: 'ef_dora', label: 'Dora — narradora', kokoroLang: 'es', speed: 1.0 },
  ],
  fr: [{ id: 'ff_siwis', label: 'Siwis — narratrice', kokoroLang: 'fr-fr', speed: 1.0 }],
  pt: [
    { id: 'pm_alex', label: 'Alex — narrador', kokoroLang: 'pt-br', speed: 1.0 },
    { id: 'pf_dora', label: 'Dora — narradora', kokoroLang: 'pt-br', speed: 1.0 },
  ],
};

export const defaultStudioVoice = (lang: Lang) => STUDIO_VOICES[lang][0].id;
export const studioVoiceFor = (lang: Lang, id: string | undefined): StudioVoice =>
  STUDIO_VOICES[lang].find((v) => v.id === id) ?? STUDIO_VOICES[lang][0];
