import type { Lang } from './languages';
import { LABELS, type LabelTable } from './labelStrings';

/**
 * On-screen label localisation (stamps, cards, counters, newspaper, map...).
 *
 * The scenes draw their labels with English literals. Instead of threading a
 * language through every prop function, the render context is localised: the
 * canvas text calls (fillText / strokeText / measureText) look each string up
 * in the label dictionary for the current language, so measuring and drawing
 * always agree. `wrapText` translates before it splits lines. Unknown strings
 * (narration, names, numbers) pass through unchanged.
 */

let current: Lang = 'en';
export const setLabelLang = (lang: Lang) => {
  current = lang;
};
export const labelLang = () => current;

type Rule = [RegExp, string];
interface Dict {
  exact: Map<string, string>;
  upper: Map<string, string>;
  rules: Rule[];
}
const dicts = new Map<Lang, Dict>();

function dictFor(lang: Lang): Dict | null {
  if (lang === 'en') return null;
  let d = dicts.get(lang);
  if (!d) {
    const src: LabelTable = LABELS[lang] ?? { strings: {} };
    const exact = new Map<string, string>();
    const upper = new Map<string, string>();
    for (const [k, v] of Object.entries(src.strings ?? {})) {
      exact.set(k, v);
      upper.set(k.toUpperCase(), v.toUpperCase());
    }
    d = { exact, upper, rules: (src.rules ?? []).map(([re, to]) => [new RegExp(re, 'u'), to] as Rule) };
    dicts.set(lang, d);
  }
  return d;
}

/** Strings drawn without a translation (debug aid; see tools/check-labels). */
export const untranslated: Set<string> = ((globalThis as { __foxUntranslated?: Set<string> }).__foxUntranslated ??= new Set<string>());

/** Translate one on-screen label into the current language. */
export function tr(text: string, lang: Lang = current): string {
  const d = dictFor(lang);
  if (!d || !text) {
    if (text && (globalThis as { __foxCollect?: boolean }).__foxCollect) untranslated.add(text);
    return text;
  }
  const hit = d.exact.get(text) ?? (text === text.toUpperCase() ? d.upper.get(text) : undefined);
  if (hit !== undefined) return hit;
  for (const [re, to] of d.rules) {
    if (re.test(text)) {
      const out = text.replace(re, to);
      return text === text.toUpperCase() ? out.toUpperCase() : out;
    }
  }
  if ((globalThis as { __foxCollect?: boolean }).__foxCollect) untranslated.add(text);
  return text;
}

const PATCHED = new WeakSet<CanvasRenderingContext2D>();

/** Make a 2D context translate the labels it draws (idempotent). */
export function localizeContext(g: CanvasRenderingContext2D) {
  if (PATCHED.has(g)) return;
  PATCHED.add(g);
  const fill = g.fillText;
  const stroke = g.strokeText;
  const measure = g.measureText;
  g.fillText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number) {
    const t = current === 'en' && !(globalThis as { __foxCollect?: boolean }).__foxCollect ? text : tr(String(text));
    return maxWidth === undefined ? fill.call(this, t, x, y) : fill.call(this, t, x, y, maxWidth);
  };
  g.strokeText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number) {
    const t = current === 'en' ? text : tr(String(text));
    return maxWidth === undefined ? stroke.call(this, t, x, y) : stroke.call(this, t, x, y, maxWidth);
  };
  g.measureText = function (this: CanvasRenderingContext2D, text: string) {
    return measure.call(this, current === 'en' ? text : tr(String(text)));
  };
}
