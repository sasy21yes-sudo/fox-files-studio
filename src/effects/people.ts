/**
 * 1930s-cartoon portraits of people named in the narration, for the identikit cards (beats.ts, kind 'person').
 * Each is redrawn by the local image model from a public-domain photo (art/reference/people/SOURCES.md in the
 * assets checkout) and keyed to a transparent PNG in public/people/. A person without one gets the generic
 * sketch. Loaded with the project's media (media/store.ts), so previews and exports wait for them.
 */
const PORTRAITS: Record<string, string> = {
  'Frank Church': 'people/church.png',
  'Richard Helms': 'people/helms.png',
};

const images = new Map<string, HTMLImageElement>();
let loading: Promise<void> | null = null;

export function loadPortraits(): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve();
  loading ??= Promise.all(
    Object.entries(PORTRAITS).map(
      ([name, src]) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            images.set(name, img);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = `${import.meta.env.BASE_URL ?? './'}${src}`;
        }),
    ),
  ).then(() => undefined);
  return loading;
}

/** The loaded portrait of a person, or null (draw the sketch). */
export const portrait = (name: string): HTMLImageElement | null => images.get(name) ?? null;
