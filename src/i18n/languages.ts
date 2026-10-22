/** Narration languages. Every language tells exactly the same, source-checked story. */
export type Lang = 'en' | 'it' | 'es' | 'fr' | 'pt';

export interface LanguageInfo {
  id: Lang;
  /** Name in the language itself, for the picker. */
  name: string;
  /** BCP-47 tag used to pick browser voices and for subtitle files. */
  bcp47: string;
}

export const LANGUAGES: LanguageInfo[] = [
  { id: 'en', name: 'English', bcp47: 'en-US' },
  { id: 'it', name: 'Italiano', bcp47: 'it-IT' },
  { id: 'es', name: 'Español', bcp47: 'es-ES' },
  { id: 'fr', name: 'Français', bcp47: 'fr-FR' },
  { id: 'pt', name: 'Português (Brasil)', bcp47: 'pt-BR' },
];

export const isLang = (v: unknown): v is Lang => LANGUAGES.some((l) => l.id === v);
export const langInfo = (id: Lang): LanguageInfo => LANGUAGES.find((l) => l.id === id) ?? LANGUAGES[0];
