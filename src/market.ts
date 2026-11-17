// The exchange. Prices are a pure function of (skin, time), so the whole price
// history exists without storing anything: it keeps moving while the player is away
// and every chart is reproducible. One tick = 4 s, one market day = 90 ticks (6 minutes).
import { CLASS_NAMES, CRATES, RARITIES, SKIN_LIST, WEAPONS, type SkinDef, type WeaponClass } from './data';
import { unit } from './rng';

export const TICK_MS = 4000;
export const DAY_TICKS = 90;

export const tickOf = (ms: number): number => Math.floor(ms / TICK_MS);
export const dayOf = (tick: number): number => Math.floor(tick / DAY_TICKS);

/** Smooth 1D value noise in [-1, 1]. */
function vnoise(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = unit(seed, i) * 2 - 1;
  const b = unit(seed, i + 1) * 2 - 1;
  return a + (b - a) * (f * f * (3 - 2 * f));
}

// ---------------------------------------------------------------- news events

export interface MarketEvent {
  day: number;
  headline: string;
  scope: 'class' | 'crate' | 'all';
  target: string;
  /** Peak log-price move, e.g. 0.12 = roughly +12%. */
  move: number;
}

const CLASSES = Object.keys(CLASS_NAMES) as WeaponClass[];
const UP_CLASS = [
  'Tournament finals spark a run on {x}',
  'Collectors are quietly hoarding {x}',
  'Shortage rumours lift {x}',
  'Viral clip sends {x} demand through the roof',
];
const DOWN_CLASS = [
  'Depot audit floods the exchange with {x}',
  'Balance-patch rumours spook holders of {x}',
  'Big seller unloads a stockpile of {x}',
  'Interest in {x} cools after a quiet week',
];
const UP_CRATE = [
  '{x} supply runs dry at the depots',
  'Streamer unboxing marathon lifts {x} skins',
  '{x} finishes named "pick of the season"',
];
const DOWN_CRATE = [
  '{x} restock announced, prices slip',
  'Overprinting scandal dents {x} skins',
  'Buyers rotate out of {x} skins',
];
const UP_ALL = ['Exchange-wide rally as a new operation is announced', 'Record trading volume lifts every sector'];
const DOWN_ALL = ['Profit-taking drags the whole exchange lower', 'Exchange outage rattles traders, prices dip'];

const eventCache = new Map<number, MarketEvent | null>();

export function eventOn(day: number): MarketEvent | null {
  if (eventCache.has(day)) return eventCache.get(day)!;
  let ev: MarketEvent | null = null;
  if (unit(0xe7e27, day) < 0.66) {
    const up = unit(0x51de, day) < 0.52;
    const mag = 0.05 + unit(0xa11, day) * 0.13;
    const k = unit(0x7a9, day);
    const r = unit(0x3c3, day);
    const pickT = (arr: string[]) => arr[Math.floor(unit(0x99, day) * arr.length)];
    if (k < 0.5) {
      const cls = CLASSES[Math.floor(r * CLASSES.length)];
      ev = { day, scope: 'class', target: cls, move: up ? mag : -mag, headline: pickT(up ? UP_CLASS : DOWN_CLASS).replace('{x}', CLASS_NAMES[cls]) };
    } else if (k < 0.86) {
      const crate = CRATES[Math.floor(r * CRATES.length)];
      ev = { day, scope: 'crate', target: crate.id, move: up ? mag : -mag, headline: pickT(up ? UP_CRATE : DOWN_CRATE).replace('{x}', crate.name.replace(/ (Case|Crate)$/, '')) };
    } else {
      ev = { day, scope: 'all', target: '', move: (up ? mag : -mag) * 0.6, headline: pickT(up ? UP_ALL : DOWN_ALL) };
    }
  }
  if (eventCache.size > 400) eventCache.clear();
  eventCache.set(day, ev);
  return ev;
}

function eventShape(age: number): number {
  if (age < 0) return 0;
  if (age < 0.25) return age / 0.25;
  if (age < 1) return 1;
  const d = Math.exp(-(age - 1) * 1.1);
  return age > 3 ? d * Math.max(0, 4 - age) : d;
}

function eventEffect(skin: SkinDef, tick: number): number {
  const day = dayOf(tick);
  let sum = 0;
  for (let d = day - 4; d <= day; d++) {
    const ev = eventOn(d);
    if (!ev) continue;
    if (ev.scope === 'class' && WEAPONS[skin.weapon].cls !== ev.target) continue;
    if (ev.scope === 'crate' && skin.crate !== ev.target) continue;
    sum += ev.move * eventShape((tick - d * DAY_TICKS) / DAY_TICKS);
  }
  return sum;
}

// ---------------------------------------------------------------- prices

/** Price index of a skin at a tick; hovers around 1.0. */
export function indexAt(skin: SkinDef, tick: number): number {
  const t = tick * (TICK_MS / 1000);
  const s = skin.seed;
  const v =
    0.03 * vnoise(s ^ 0x11, t / 40) +
    0.085 * vnoise(s ^ 0x22, t / 310) +
    0.19 * vnoise(s ^ 0x33, t / 2500) +
    0.24 * vnoise(s ^ 0x44, t / 15000) +
    0.07 * vnoise(0xc1a55 ^ WEAPONS[skin.weapon].cls.length * 977 ^ WEAPONS[skin.weapon].cls.charCodeAt(0), t / 3300) +
    0.05 * vnoise(0x9100b, t / 5200);
  return Math.exp(v + eventEffect(skin, tick));
}

/** Book price of a skin (no wear / pattern modifiers) at a tick. */
export function priceAt(skin: SkinDef, tick: number): number {
  return skin.base * indexAt(skin, tick);
}

export function series(skin: SkinDef, endTick: number, points: number, step: number): number[] {
  const out: number[] = new Array(points);
  for (let i = 0; i < points; i++) out[i] = priceAt(skin, endTick - (points - 1 - i) * step);
  return out;
}

export function changePct(skin: SkinDef, tick: number, ticksAgo: number): number {
  const a = indexAt(skin, tick - ticksAgo);
  return (indexAt(skin, tick) / a - 1) * 100;
}

/** Fake traded volume for a tick: busier for cheap skins and on big moves. */
export function volumeAt(skin: SkinDef, tick: number, step = 1): number {
  const base = [900, 520, 260, 110, 42, 14, 5][skin.rarity];
  const move = Math.abs(indexAt(skin, tick) / indexAt(skin, tick - step) - 1);
  return Math.max(1, Math.round(base * step * (0.45 + unit(skin.seed ^ 0x5a5a, Math.floor(tick / step))) * (1 + move * 14)));
}

/** Exchange-wide index (1000 = par), averaged over every listed skin. */
export function exchangeIndex(tick: number): number {
  let sum = 0;
  for (const s of SKIN_LIST) sum += indexAt(s, tick);
  return (sum / SKIN_LIST.length) * 1000;
}

export interface Mover {
  skin: SkinDef;
  pct: number;
}

export function movers(tick: number, ticksAgo = DAY_TICKS): { up: Mover[]; down: Mover[] } {
  const all = SKIN_LIST.map((skin) => ({ skin, pct: changePct(skin, tick, ticksAgo) })).sort((a, b) => b.pct - a.pct);
  return { up: all.slice(0, 5), down: all.slice(-5).reverse() };
}

export function recentNews(tick: number, count = 6): MarketEvent[] {
  const out: MarketEvent[] = [];
  for (let d = dayOf(tick); out.length < count && d > dayOf(tick) - 30; d--) {
    const ev = eventOn(d);
    if (ev) out.push(ev);
  }
  return out;
}

// ---------------------------------------------------------------- buy listings

export const LISTING_TICKS = 45; // listings rotate every 3 minutes

export interface Listing {
  id: string;
  skin: SkinDef;
  wear: number;
  pattern: number;
  serial: number;
  /** Seller mark-up over the current market value. */
  markup: number;
}

export function listingsAt(tick: number, maxRank: number, count = 12): Listing[] {
  const bucket = Math.floor(tick / LISTING_TICKS);
  const pool = SKIN_LIST.filter((s) => CRATES.find((c) => c.id === s.crate)!.rank <= maxRank);
  const out: Listing[] = [];
  for (let i = 0; i < count; i++) {
    const h = (k: number) => unit(bucket * 31 + i, k);
    // bias toward the upper rarities so the board is worth browsing
    let skin = pool[Math.floor(h(1) * pool.length)];
    for (let tries = 0; tries < 3 && h(10 + tries) > (skin.rarity + 2) / (RARITIES.length + 1); tries++) {
      skin = pool[Math.floor(h(20 + tries) * pool.length)];
    }
    out.push({
      id: `${bucket}-${i}`,
      skin,
      wear: Math.min(0.9999, Math.pow(h(2), 1.25)),
      pattern: Math.floor(h(3) * 1000),
      serial: h(4) < 0.06 ? 1 + Math.floor(h(5) * 999) : 0,
      markup: 1.04 + h(6) * 0.08,
    });
  }
  return out;
}
