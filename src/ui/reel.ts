// The roulette strip shared by crate openings and crate battles.
import { SKINS, type CrateDef } from '../data';
import type { App } from './app';

export const CELLS = 46;
export const WIN_AT = 40;

/** Markup for one strip: random filler drops from the crate, with the real drop at `winAt`. */
export function reelHtml(app: App, crate: CrateDef, winSkin: string, cells = CELLS, winAt = WIN_AT): string {
  let out = '';
  for (let k = 0; k < cells; k++) {
    const s = k === winAt ? SKINS[winSkin] : SKINS[app.game.sample(crate, 0, 0).s];
    out += `<div class="cell r${s.rarity}${k === winAt ? ' target' : ''}">${app.imgSkin(s, 'cell-img')}</div>`;
  }
  return `<div class="strip"><div class="strip-track">${out}</div><i class="strip-mark"></i></div>`;
}

export interface Spin {
  track: HTMLElement;
  /** final translateX */
  x: number;
  pitch: number;
  half: number;
  dur: number;
  landed: boolean;
}

/** Start a strip spinning toward its target cell. */
export function spin(track: HTMLElement, winAt: number, dur: number): Spin {
  const strip = track.parentElement!;
  const pitch = (track.children[1] as HTMLElement).offsetLeft - (track.children[0] as HTMLElement).offsetLeft;
  const x = -(winAt * pitch + pitch * (0.14 + Math.random() * 0.72) - strip.clientWidth / 2);
  track.style.transition = `transform ${dur}ms cubic-bezier(0.07, 0.74, 0.1, 1)`;
  track.style.transform = `translate3d(${x}px,0,0)`;
  return { track, x, pitch, half: strip.clientWidth / 2, dur, landed: false };
}

/** Index of the cell currently under the marker (drives the tick sound). */
export function cellUnderMarker(s: Spin): number {
  const x = new DOMMatrixReadOnly(getComputedStyle(s.track).transform).m41;
  return Math.floor((-x + s.half) / s.pitch);
}

/** Snap a strip to its final position and light up the drop. */
export function land(s: Spin): void {
  s.landed = true;
  s.track.style.transition = 'none';
  s.track.style.transform = `translate3d(${s.x}px,0,0)`;
  s.track.querySelector('.target')?.classList.add('won');
}
