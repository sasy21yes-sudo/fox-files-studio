import type { Stage } from '../stage';

/** Per-format placement of the recurring elements (fox, floor, desk, window, titles). */
export interface Layout {
  floorY: number;
  foxX: number;
  foxY: number;
  foxS: number;
  deskX: number;
  deskY: number;
  deskW: number;
  deskH: number;
  titleY: number;
  textW: number;
  win: { x: number; y: number; w: number; h: number };
}

export function layout(s: Stage): Layout {
  const { w, h, u, vertical } = s;
  if (vertical) {
    return {
      floorY: h * 0.58,
      foxX: w * 0.29,
      foxY: h * 0.72,
      foxS: 1.36 * u,
      deskX: w * 0.56,
      deskY: h * 0.53,
      deskW: w * 0.5,
      deskH: h * 0.19,
      titleY: h * 0.15,
      textW: w * 0.86,
      win: { x: w * 0.56, y: h * 0.2, w: w * 0.34, h: h * 0.2 },
    };
  }
  return {
    floorY: h * 0.79,
    foxX: w * 0.25,
    foxY: h * 0.915,
    foxS: 1.1 * u,
    deskX: w * 0.5,
    deskY: h * 0.63,
    deskW: w * 0.36,
    deskH: h * 0.27,
    titleY: h * 0.2,
    textW: w * 0.8,
    win: { x: w * 0.63, y: h * 0.08, w: w * 0.23, h: h * 0.34 },
  };
}

/** Screen position of the fox's head, used as the iris focus. */
export const foxHead = (L: Layout, x = L.foxX) => ({ x: x + 14 * L.foxS, y: L.foxY - 392 * L.foxS });
