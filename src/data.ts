// Static game data: weapons, rarities, wear grades, crates and skins.
// Everything here is original to Crate Ops (fictional weapons, skins and crates).
import { hashStr } from './rng';

export type WeaponClass = 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'sniper' | 'lmg' | 'knife' | 'gloves';

export interface WeaponDef {
  id: string;
  name: string;
  cls: WeaponClass;
  /** How the compositor treats worn paint: 0 firearm (bare metal), 1 blade (bright steel), 2 cloth. */
  kind: 0 | 1 | 2;
}

const W = (id: string, name: string, cls: WeaponClass, kind: 0 | 1 | 2 = 0): WeaponDef => ({ id, name, cls, kind });

export const WEAPONS: Record<string, WeaponDef> = {
  viper: W('viper', 'Viper-9', 'pistol'),
  magnate: W('magnate', 'Magnate .44', 'pistol'),
  hornet: W('hornet', 'Hornet SMG', 'smg'),
  wasp: W('wasp', 'Wasp PDW', 'smg'),
  bulldog: W('bulldog', 'Bulldog 12', 'shotgun'),
  kestrel: W('kestrel', 'Kestrel AR', 'rifle'),
  kodiak: W('kodiak', 'Kodiak KR', 'rifle'),
  lynx: W('lynx', 'Lynx BP', 'rifle'),
  longbow: W('longbow', 'Longbow .338', 'sniper'),
  ravager: W('ravager', 'Ravager LMG', 'lmg'),
  fang: W('fang', 'Fang Knife', 'knife', 1),
  talon: W('talon', 'Talon Claw', 'knife', 1),
  needle: W('needle', 'Needle Dagger', 'knife', 1),
  bolo: W('bolo', 'Bolo Chopper', 'knife', 1),
  gauntlet: W('gauntlet', 'Operator Gloves', 'gloves', 2),
  wraps: W('wraps', 'Hand Wraps', 'gloves', 2),
};

export const CLASS_NAMES: Record<WeaponClass, string> = {
  pistol: 'Pistols', smg: 'SMGs', shotgun: 'Shotguns', rifle: 'Rifles', sniper: 'Snipers', lmg: 'Machine Guns',
  knife: 'Blades', gloves: 'Gloves',
};

// ---------------------------------------------------------------- rarity

export interface Rarity {
  id: string;
  name: string;
  color: string;
  /** Seconds for an item in "Serviced" condition to earn back its book value. */
  payback: number;
}

export const RARITIES: Rarity[] = [
  { id: 'surplus', name: 'Surplus', color: '#9aa5b1', payback: 15000 },
  { id: 'service', name: 'Service', color: '#7fb24f', payback: 12000 },
  { id: 'tactical', name: 'Tactical', color: '#38b8d8', payback: 8000 },
  { id: 'elite', name: 'Elite', color: '#8c6cf5', payback: 5000 },
  { id: 'prototype', name: 'Prototype', color: '#e352a8', payback: 3200 },
  { id: 'apex', name: 'Apex', color: '#f2483a', payback: 2400 },
  { id: 'exotic', name: 'Exotic', color: '#f7c64a', payback: 1800 },
];
export const EXOTIC = 6;

// ---------------------------------------------------------------- wear

export interface WearGrade {
  id: string;
  name: string;
  short: string;
  max: number;
  /** Market value multiplier at the top of the grade. */
  value: number;
  /** Passive income multiplier. */
  income: number;
}

export const WEARS: WearGrade[] = [
  { id: 'pristine', name: 'Pristine', short: 'PR', max: 0.07, value: 1.0, income: 2.0 },
  { id: 'clean', name: 'Clean', short: 'CL', max: 0.18, value: 0.78, income: 1.5 },
  { id: 'serviced', name: 'Serviced', short: 'SV', max: 0.42, value: 0.58, income: 1.0 },
  { id: 'battered', name: 'Battered', short: 'BT', max: 0.7, value: 0.42, income: 0.6 },
  { id: 'scrap', name: 'Scrap', short: 'SC', max: 1.0001, value: 0.3, income: 0.3 },
];

export function wearIndex(f: number): number {
  for (let i = 0; i < WEARS.length; i++) if (f < WEARS[i].max) return i;
  return WEARS.length - 1;
}

/** Continuous value multiplier: grade base plus up to +12% for a low float inside the grade. */
export function wearValue(f: number): number {
  const i = wearIndex(f);
  const lo = i === 0 ? 0 : WEARS[i - 1].max;
  const hi = Math.min(1, WEARS[i].max);
  const t = 1 - (f - lo) / (hi - lo);
  return WEARS[i].value * (1 + 0.12 * t);
}

// ---------------------------------------------------------------- skins

export type PatternKind =
  | 'solid' | 'fade' | 'camo' | 'digital' | 'tiger' | 'hex' | 'carbon' | 'topo' | 'marble' | 'splatter'
  | 'shards' | 'circuit' | 'scales' | 'crackle' | 'stripes' | 'nebula' | 'wave' | 'grid' | 'stencil' | 'weave';

export type Finish = 'matte' | 'satin' | 'gloss' | 'metal' | 'chrome' | 'pearl' | 'cloth';

export interface SkinOpts {
  /** Surface finish (default satin; cloth for gloves). */
  f?: Finish;
  /** Accent colour for trim parts (default: derived from the palette). */
  a?: string;
  /** Emissive strength for the brightest palette colour. */
  g?: number;
  /** Pattern scale multiplier. */
  sc?: number;
}

export interface SkinDef extends SkinOpts {
  id: string;
  weapon: string;
  name: string;
  rarity: number;
  kind: PatternKind;
  colors: string[];
  crate: string;
  /** Book value in credits before wear, pattern and market swings. */
  base: number;
  seed: number;
}

export type CrateLook = Pick<SkinDef, 'kind' | 'colors' | 'seed' | 'f' | 'a' | 'g' | 'sc'>;

type Row = [weapon: string, name: string, kind: PatternKind, colors: string[], opts?: SkinOpts];

export interface CrateDef {
  id: string;
  name: string;
  price: number;
  rank: number;
  blurb: string;
  /** Crate paint colours: body, stripe. */
  paint: [string, string];
  /** How the crate itself is painted (rendered through the same compositor as weapons). */
  look: CrateLook;
  mark: string;
  /** Drop weights by rarity index. */
  odds: number[];
  skins: SkinDef[];
}

/** Book value of a drop relative to the crate price, by rarity. */
const STD_FACTOR = [0, 0.4, 0.85, 1.8, 4.5, 13, 50];
const SURPLUS_FACTOR = [0.3, 0.8, 2.5, 8, 0, 0, 0];
const STD_ODDS = [0, 55, 27, 12, 4.3, 1.3, 0.4];
const SURPLUS_ODDS = [62, 28, 8, 2, 0, 0, 0];

interface CrateSrc {
  id: string;
  name: string;
  price: number;
  rank: number;
  blurb: string;
  paint: [string, string];
  look: [PatternKind, string[], SkinOpts];
  mark: string;
  surplus?: boolean;
  tiers: Record<number, Row[]>;
}

const SRC: CrateSrc[] = [
  {
    id: 'surplus', name: 'Surplus Crate', price: 4, rank: 1, surplus: true, mark: 'SRP',
    blurb: 'Depot leftovers. Cheap, cheerful and occasionally not rusty.',
    paint: ['#59624a', '#d8c98a'],
    look: ['solid', ['#59624a', '#4a523c'], { f: 'matte', a: '#d8c98a' }],
    tiers: {
      0: [
        ['viper', 'Parkerized', 'solid', ['#3a3d40', '#2c2f31'], { f: 'matte' }],
        ['hornet', 'Olive Drab', 'solid', ['#5a6038', '#484e2c'], { f: 'matte' }],
        ['bulldog', 'Sand Coat', 'solid', ['#b49a6c', '#9c855b'], { f: 'matte' }],
        ['kodiak', 'Depot Green', 'solid', ['#2f4a35', '#263c2b'], { f: 'satin' }],
        ['magnate', 'Blued Steel', 'solid', ['#25324a', '#1b2536'], { f: 'metal' }],
      ],
      1: [
        ['kestrel', 'Woodland', 'camo', ['#3d4a2c', '#5f6b3a', '#2a2a20', '#8a7a4d'], { f: 'matte' }],
        ['wasp', 'Gridlock', 'grid', ['#4c5258', '#23272b', '#8d959c'], { f: 'satin' }],
        ['lynx', 'Hazard Tape', 'stripes', ['#e6b422', '#17181a', '#e6b422'], { f: 'satin', a: '#17181a' }],
        ['longbow', 'Dry Brush', 'splatter', ['#8b7a58', '#5b4e38', '#c2b08a', '#3b3428'], { f: 'matte' }],
      ],
      2: [
        ['ravager', 'Ration Stamp', 'stencil', ['#4f5a36', '#e6e0c4', '#2e3520'], { f: 'matte', a: '#e6e0c4' }],
        ['viper', 'Brass Tacks', 'solid', ['#b08a3c', '#8f6e2c'], { f: 'metal', a: '#2a2a2a' }],
      ],
      3: [
        ['kestrel', 'Quartermaster', 'topo', ['#39422a', '#d9a13b', '#262c1b'], { f: 'satin', a: '#d9a13b' }],
      ],
    },
  },
  {
    id: 'recruit', name: 'Recruit Case', price: 25, rank: 1, mark: 'RCT',
    blurb: 'Standard issue for fresh boots. Everyone starts somewhere.',
    paint: ['#3f5b78', '#e9eef2'],
    look: ['solid', ['#3f5b78', '#35506b'], { f: 'satin', a: '#e9eef2' }],
    tiers: {
      1: [
        ['viper', 'Boot Camp', 'camo', ['#a08a5e', '#6f6244', '#c9b88d', '#4a412e'], { f: 'matte' }],
        ['hornet', 'Drill Stripe', 'stripes', ['#1f3352', '#e7e9ee', '#1f3352'], { f: 'satin' }],
        ['bulldog', 'Clay Pigeon', 'solid', ['#b5553a', '#964530'], { f: 'satin', a: '#e8dcc6' }],
        ['kodiak', 'Timber', 'tiger', ['#7a4a26', '#4f2d14', '#9a6638'], { f: 'satin', sc: 1.6 }],
      ],
      2: [
        ['kestrel', 'Digital Dawn', 'digital', ['#566170', '#8794a3', '#2f3741', '#b6c0cc'], { f: 'matte' }],
        ['magnate', 'Gunmetal Hex', 'hex', ['#3c4249', '#181b1f', '#6b747d'], { f: 'metal' }],
        ['lynx', 'Signal Orange', 'solid', ['#f26a1b', '#d4560f'], { f: 'gloss', a: '#141414' }],
      ],
      3: [
        ['wasp', 'Carbon Weave', 'carbon', ['#1a1c1f', '#33373c', '#0d0e10'], { f: 'gloss', a: '#d23b2f' }],
        ['longbow', 'Contour', 'topo', ['#12262b', '#2fd0c0', '#0b181b'], { f: 'satin', a: '#2fd0c0' }],
        ['ravager', 'Tiger Stripe', 'tiger', ['#55662f', '#15180f', '#7d8c4a'], { f: 'matte' }],
      ],
      4: [
        ['kestrel', 'Night Vision', 'grid', ['#0c1a10', '#5dff7a', '#12331c'], { f: 'satin', g: 0.9, a: '#5dff7a' }],
        ['viper', 'Chromed Out', 'solid', ['#d9dde2', '#b9bec6'], { f: 'chrome', a: '#1b1b1d' }],
      ],
      5: [
        ['kodiak', 'Crimson Oath', 'shards', ['#b3141c', '#2a0507', '#e5343a', '#0f0f10'], { f: 'gloss', a: '#e0b24a' }],
      ],
      6: [
        ['fang', 'Field Grey', 'solid', ['#8f979e', '#737b82'], { f: 'metal', a: '#2c3b2a' }],
        ['fang', 'Forest', 'camo', ['#33452a', '#587040', '#1f2a1a', '#8a8f55'], { f: 'matte', a: '#3a2c1c' }],
        ['gauntlet', 'Recruit', 'weave', ['#3b4630', '#252d1e', '#55603f'], { f: 'cloth', a: '#191b17' }],
      ],
    },
  },
  {
    id: 'nightops', name: 'Night Ops Case', price: 90, rank: 3, mark: 'NTO',
    blurb: 'Painted for work that officially never happened.',
    paint: ['#1a2233', '#49d6ff'],
    look: ['grid', ['#12161d', '#49d6ff', '#1c2330'], { f: 'satin', a: '#49d6ff', g: 0.7 }],
    tiers: {
      1: [
        ['hornet', 'Midnight', 'solid', ['#16223d', '#101a30'], { f: 'satin', a: '#49d6ff' }],
        ['bulldog', 'Blackout', 'camo', ['#1c1e22', '#2e3238', '#0e0f11', '#42474f'], { f: 'matte' }],
        ['viper', 'Moonline', 'topo', ['#0f1217', '#aab6c6', '#080a0d'], { f: 'satin' }],
        ['lynx', 'Low Light', 'digital', ['#152238', '#22375a', '#0b1220', '#34507f'], { f: 'matte' }],
      ],
      2: [
        ['kodiak', 'Nightshade', 'tiger', ['#3a1f5c', '#0c0812', '#6a3aa8'], { f: 'satin' }],
        ['magnate', 'Starfield', 'nebula', ['#070b1a', '#1b2a6b', '#5d3fa8', '#ffffff'], { f: 'gloss', g: 0.5 }],
        ['wasp', 'Sonar', 'wave', ['#071a1f', '#17c3b2', '#0b2b33'], { f: 'satin', g: 0.4, a: '#17c3b2' }],
      ],
      3: [
        ['kestrel', 'Blacklight', 'splatter', ['#0b0b10', '#b13cff', '#ff3ca0', '#3c5cff'], { f: 'gloss', g: 0.7 }],
        ['longbow', 'Silent Hex', 'hex', ['#0f1622', '#3b82f6', '#090d14'], { f: 'metal', g: 0.35, a: '#3b82f6' }],
        ['ravager', 'Deep Six', 'scales', ['#0d1b33', '#1d3a66', '#081122'], { f: 'gloss' }],
      ],
      4: [
        ['viper', 'Neon Circuit', 'circuit', ['#07090c', '#22e6ff', '#0f1b22'], { f: 'gloss', g: 1.0, a: '#22e6ff' }],
        ['lynx', 'Eclipse', 'fade', ['#0a0a12', '#4b1f8f', '#ff7a1a', '#0a0a12'], { f: 'pearl' }],
      ],
      5: [
        ['kestrel', 'Phantom Protocol', 'crackle', ['#06080b', '#3df2ff', '#0d1820'], { f: 'gloss', g: 1.2, a: '#3df2ff' }],
      ],
      6: [
        ['talon', 'Nocturne', 'fade', ['#0b1030', '#3b2a9c', '#a03cff', '#0b1030'], { f: 'pearl', a: '#141622' }],
        ['needle', 'Black Ice', 'marble', ['#0a0d12', '#9fd8ff', '#1a2533'], { f: 'gloss', a: '#10141b' }],
        ['gauntlet', 'Night Shift', 'carbon', ['#15171b', '#2a2e34', '#0b0c0e'], { f: 'cloth', a: '#22e6ff' }],
      ],
    },
  },
  {
    id: 'sandstorm', name: 'Sandstorm Case', price: 320, rank: 5, mark: 'SND',
    blurb: 'Sun-bleached finishes from the long patrol.',
    paint: ['#b08d57', '#d2ab68'],
    look: ['camo', ['#b08d57', '#8a6c3e', '#d0b27a', '#6b5230'], { f: 'matte', a: '#3a2c1a' }],
    tiers: {
      1: [
        ['kodiak', 'Dune', 'wave', ['#c8a86e', '#a5844f', '#e2c892'], { f: 'matte' }],
        ['viper', 'Dust Devil', 'splatter', ['#bfa67a', '#8c744d', '#e0cfa8', '#6a5638'], { f: 'matte' }],
        ['hornet', 'Khaki Grid', 'grid', ['#a8956b', '#5c4f35', '#cbb98f'], { f: 'satin' }],
        ['ravager', 'Scorched', 'camo', ['#6b4a2e', '#8f6b42', '#3d2a1a', '#b08d57'], { f: 'matte' }],
      ],
      2: [
        ['bulldog', 'Rattler', 'scales', ['#b89b6a', '#7a5f3a', '#d9c296'], { f: 'satin' }],
        ['kestrel', 'Mirage', 'fade', ['#e8c48a', '#f09a6a', '#3fb3a6', '#e8c48a'], { f: 'satin' }],
        ['longbow', 'Sandstone', 'marble', ['#c9a877', '#8d6d42', '#ecd9b0'], { f: 'satin' }],
      ],
      3: [
        ['lynx', 'Sun Baked', 'crackle', ['#c79a5b', '#ff8a2a', '#8f6a38'], { f: 'matte', g: 0.35 }],
        ['wasp', 'Copperhead', 'scales', ['#b5622e', '#6e3414', '#e08a4c'], { f: 'metal', a: '#1c1c1c' }],
        ['magnate', 'Oasis', 'topo', ['#0f4a4a', '#e8b84a', '#0a3232'], { f: 'gloss', a: '#e8b84a' }],
      ],
      4: [
        ['kodiak', 'Pharaoh', 'stripes', ['#d4a531', '#1b3f8f', '#f0d27a'], { f: 'metal', a: '#1b3f8f' }],
        ['bulldog', 'Heatwave', 'fade', ['#c9141a', '#ff7a12', '#ffd23a', '#c9141a'], { f: 'gloss' }],
      ],
      5: [
        ['longbow', 'Sirocco', 'marble', ['#1a1408', '#e8b13a', '#6b4a12'], { f: 'metal', g: 0.25, a: '#e8b13a' }],
      ],
      6: [
        ['bolo', 'Sandblast', 'splatter', ['#b9a27a', '#8a7450', '#d8c7a0', '#5e4c30'], { f: 'matte', a: '#4a3a24' }],
        ['talon', 'Scarab', 'scales', ['#0f6b4f', '#d4a531', '#0a4030'], { f: 'pearl', a: '#1a1408' }],
        ['wraps', 'Desert Rat', 'weave', ['#b79c6e', '#8d7650', '#d6c198'], { f: 'cloth', a: '#5b4a30' }],
      ],
    },
  },
  {
    id: 'arctic', name: 'Arctic Front Case', price: 1100, rank: 8, mark: 'ARC',
    blurb: 'Whiteout colours for the coldest posting on the map.',
    paint: ['#dfe8ee', '#3f8fd0'],
    look: ['camo', ['#dfe8ee', '#b9c8d4', '#f6fafc', '#93a7b8'], { f: 'satin', a: '#3f8fd0' }],
    tiers: {
      1: [
        ['kestrel', 'Whiteout', 'camo', ['#e4e9ed', '#b9c3cc', '#f7f9fb', '#8e9aa6'], { f: 'matte' }],
        ['bulldog', 'Frostbite', 'splatter', ['#cfe4f2', '#7fb6d9', '#f4fbff', '#3f7fae'], { f: 'satin' }],
        ['wasp', 'Slush', 'digital', ['#d7dee4', '#9fb4c6', '#f2f5f7', '#6d8499'], { f: 'matte' }],
        ['magnate', 'Polar', 'solid', ['#eef2f5', '#d5dce2'], { f: 'gloss', a: '#3f8fd0' }],
      ],
      2: [
        ['longbow', 'Glacier', 'marble', ['#bfe3f5', '#4f9fd0', '#f0faff'], { f: 'gloss' }],
        ['kodiak', 'Permafrost', 'crackle', ['#dbe7ee', '#5aa9dc', '#b7c9d6'], { f: 'satin' }],
        ['lynx', 'Snowblind', 'topo', ['#eef3f6', '#8aa0b3', '#dbe4ea'], { f: 'satin', a: '#f2483a' }],
      ],
      3: [
        ['viper', 'Ice Pick', 'shards', ['#9fd4f0', '#e9f7ff', '#4f97c9', '#c6e8f9'], { f: 'gloss' }],
        ['ravager', 'Avalanche', 'tiger', ['#e6ecf0', '#5c6b78', '#ffffff'], { f: 'satin' }],
        ['hornet', 'Northern Line', 'stripes', ['#e9eef2', '#2f7fc4', '#f2483a'], { f: 'gloss' }],
      ],
      4: [
        ['kestrel', 'Aurora', 'nebula', ['#06121c', '#1fe0a0', '#7a4dff', '#d8fff0'], { f: 'pearl', g: 0.6 }],
        ['longbow', 'Cold Fusion', 'circuit', ['#e8f1f6', '#18b6ff', '#c9d9e3'], { f: 'gloss', g: 0.8, a: '#18b6ff' }],
      ],
      5: [
        ['lynx', 'Absolute Zero', 'crackle', ['#eaf6fb', '#28e0ff', '#bfe4f2'], { f: 'chrome', g: 1.1, a: '#28e0ff' }],
      ],
      6: [
        ['needle', 'Icicle', 'fade', ['#f4fbff', '#9fd8ff', '#3f8fd0', '#f4fbff'], { f: 'chrome', a: '#dfe8ee' }],
        ['fang', 'Borealis', 'nebula', ['#06121c', '#1fe0a0', '#7a4dff', '#d8fff0'], { f: 'pearl', g: 0.5, a: '#0c1d28' }],
        ['gauntlet', 'Arctic', 'camo', ['#e4e9ed', '#b9c3cc', '#f7f9fb', '#8e9aa6'], { f: 'cloth', a: '#3f8fd0' }],
        ['wraps', 'Frost', 'weave', ['#dfeaf2', '#a9c4d8', '#f7fbfd'], { f: 'cloth', a: '#3f8fd0' }],
      ],
    },
  },
  {
    id: 'neon', name: 'Neon Syndicate Case', price: 4000, rank: 11, mark: 'NEO',
    blurb: 'Loud finishes from people who never planned on hiding.',
    paint: ['#1a0f2e', '#ff3cac'],
    look: ['grid', ['#1a0f2e', '#ff3cac', '#2a1450'], { f: 'gloss', a: '#2be4e4', g: 0.9 }],
    tiers: {
      1: [
        ['viper', 'Arcade', 'grid', ['#160a2a', '#ff3cac', '#2a1450'], { f: 'gloss', g: 0.5, a: '#ff3cac' }],
        ['hornet', 'Bubblegum', 'solid', ['#ff6fb5', '#f0509f'], { f: 'gloss', a: '#2be4e4' }],
        ['kodiak', 'Static', 'digital', ['#18181d', '#ff3cac', '#2be4e4', '#f5e642'], { f: 'satin' }],
        ['bulldog', 'Tagger', 'splatter', ['#1b1b22', '#ff3cac', '#2be4e4', '#b6ff3c'], { f: 'gloss', g: 0.3 }],
      ],
      2: [
        ['wasp', 'Vaporwave', 'fade', ['#2be4e4', '#8a5cff', '#ff3cac', '#2be4e4'], { f: 'gloss' }],
        ['kestrel', 'Laser Grid', 'grid', ['#0a0614', '#2be4e4', '#1a0f2e'], { f: 'gloss', g: 0.9, a: '#ff3cac' }],
        ['ravager', 'Riot', 'stencil', ['#ff3cac', '#f5e642', '#1a0f2e'], { f: 'satin', a: '#f5e642' }],
      ],
      3: [
        ['lynx', 'Synth', 'wave', ['#1a0f2e', '#ff3cac', '#2be4e4'], { f: 'gloss', g: 0.6 }],
        ['magnate', 'Overdrive', 'stripes', ['#ff3cac', '#12c4c4', '#1a0f2e'], { f: 'gloss' }],
        ['longbow', 'Glitch', 'digital', ['#0c0c10', '#ff2e4d', '#2e7dff', '#3dff7f'], { f: 'gloss', g: 0.6 }],
      ],
      4: [
        ['kodiak', 'Neon Tiger', 'tiger', ['#0d0812', '#ff3cac', '#1c0f26'], { f: 'gloss', g: 0.9, a: '#ff3cac' }],
        ['wasp', 'Hologram', 'shards', ['#c9f0ff', '#f5c9ff', '#c9ffe6', '#fff3c9'], { f: 'pearl' }],
      ],
      5: [
        ['viper', 'Supernova', 'nebula', ['#12041c', '#ff3c8a', '#ff9a2e', '#fff1c9'], { f: 'gloss', g: 0.9, a: '#ff9a2e' }],
      ],
      6: [
        ['talon', 'Synthwave', 'fade', ['#ff3cac', '#8a5cff', '#2be4e4', '#ff3cac'], { f: 'pearl', a: '#1a0f2e' }],
        ['bolo', 'Acid', 'splatter', ['#0f1410', '#8dff2e', '#3cff9a', '#d6ff3c'], { f: 'gloss', g: 0.7, a: '#16201a' }],
        ['needle', 'Prism', 'shards', ['#c9f0ff', '#f5c9ff', '#c9ffe6', '#fff3c9'], { f: 'pearl', a: '#22142e' }],
        ['gauntlet', 'Neon', 'grid', ['#160a2a', '#ff3cac', '#2a1450'], { f: 'cloth', g: 0.4, a: '#2be4e4' }],
      ],
    },
  },
  {
    id: 'vault', name: 'Black Vault Case', price: 15000, rank: 14, mark: 'VLT',
    blurb: 'Private-collection pieces. Insured for more than the building.',
    paint: ['#101113', '#e2b64a'],
    look: ['hex', ['#101113', '#e2b64a', '#1c1d20'], { f: 'metal', a: '#e2b64a' }],
    tiers: {
      1: [
        ['kestrel', 'Onyx', 'solid', ['#0e0f11', '#17191c'], { f: 'gloss', a: '#e2b64a' }],
        ['viper', 'Pinstripe', 'stripes', ['#111214', '#e2b64a', '#111214'], { f: 'gloss', sc: 2.4, a: '#e2b64a' }],
        ['bulldog', 'Ebony', 'tiger', ['#231710', '#0e0906', '#3a2618'], { f: 'gloss', sc: 1.6 }],
        ['hornet', 'Graphite', 'carbon', ['#22252a', '#3b4047', '#131518'], { f: 'satin', a: '#e2b64a' }],
      ],
      2: [
        ['kodiak', 'Gilded', 'hex', ['#0f1012', '#e2b64a', '#1c1d20'], { f: 'metal', a: '#e2b64a' }],
        ['longbow', 'Obsidian', 'shards', ['#0c0d10', '#1e2128', '#07080a', '#2c303a'], { f: 'gloss' }],
        ['magnate', 'High Roller', 'stripes', ['#8c0f1a', '#0f0f10', '#e2b64a'], { f: 'gloss', a: '#e2b64a' }],
      ],
      3: [
        ['lynx', 'Emerald Cut', 'shards', ['#0c7a4a', '#12b06a', '#06442a', '#3fe09a'], { f: 'gloss', a: '#e2b64a' }],
        ['wasp', 'Sapphire', 'marble', ['#0b2a8f', '#3f7fff', '#06144a'], { f: 'gloss', a: '#d9dde2' }],
        ['ravager', 'Bullion', 'solid', ['#e2b64a', '#c99a2e'], { f: 'chrome', a: '#0f0f10' }],
      ],
      4: [
        ['kestrel', 'Damascus', 'marble', ['#6f7780', '#2a2e33', '#b9c0c8'], { f: 'metal', sc: 1.7, a: '#3a2618' }],
        ['magnate', 'Black Gold', 'crackle', ['#0b0b0c', '#ffc93c', '#1a1608'], { f: 'gloss', g: 0.8, a: '#ffc93c' }],
      ],
      5: [
        ['longbow', 'Kingmaker', 'scales', ['#0f0f10', '#e2b64a', '#3a2c0c'], { f: 'metal', g: 0.3, a: '#e2b64a' }],
      ],
      6: [
        ['fang', 'Damascus', 'marble', ['#6f7780', '#2a2e33', '#b9c0c8'], { f: 'metal', sc: 1.9, a: '#3a2618' }],
        ['talon', 'Ruby', 'marble', ['#b00f2a', '#ff4f6a', '#5a0614'], { f: 'gloss', a: '#101113' }],
        ['bolo', 'Bullion', 'solid', ['#e2b64a', '#c99a2e'], { f: 'chrome', a: '#101113' }],
        ['gauntlet', 'Vault', 'hex', ['#0f1012', '#e2b64a', '#1c1d20'], { f: 'cloth', a: '#e2b64a' }],
        ['wraps', 'Silk', 'wave', ['#8c0f1a', '#b81a28', '#5c0810'], { f: 'cloth', a: '#e2b64a' }],
      ],
    },
  },
  {
    id: 'apex', name: 'Apex Protocol Case', price: 60000, rank: 17, mark: 'APX',
    blurb: 'Experimental finishes. The lab would like them back.',
    paint: ['#20262c', '#ff5a1f'],
    look: ['circuit', ['#20262c', '#ff5a1f', '#2b333b'], { f: 'gloss', a: '#ff5a1f', g: 1.0 }],
    tiers: {
      1: [
        ['hornet', 'Blueprint', 'grid', ['#1447a8', '#e9f2ff', '#0f3884'], { f: 'satin' }],
        ['viper', 'Test Pattern', 'stripes', ['#e6e6e6', '#e6d62e', '#2ec4e6', '#3be64a', '#e63bd0', '#e63b3b', '#2e4be6'], { f: 'gloss', sc: 0.7 }],
        ['kodiak', 'Wireframe', 'topo', ['#050a06', '#3dff7f', '#0a140c'], { f: 'gloss', g: 0.7, a: '#3dff7f' }],
        ['wasp', 'Reactor', 'hex', ['#0a120c', '#7dff3c', '#12220f'], { f: 'gloss', g: 0.8, a: '#7dff3c' }],
      ],
      2: [
        ['bulldog', 'Plasma', 'nebula', ['#0a0420', '#6a2cff', '#2ea8ff', '#f0d9ff'], { f: 'gloss', g: 0.8 }],
        ['kestrel', 'Mainframe', 'circuit', ['#0e0c08', '#ffb02e', '#1c160a'], { f: 'gloss', g: 1.0, a: '#ffb02e' }],
        ['lynx', 'Quantum', 'shards', ['#13c4b0', '#7a4dff', '#0a6a8a', '#c9a6ff'], { f: 'pearl' }],
      ],
      3: [
        ['longbow', 'Event Horizon', 'fade', ['#050308', '#4a1a8f', '#ff6a1a', '#050308'], { f: 'pearl', g: 0.4 }],
        ['ravager', 'Meltdown', 'crackle', ['#140a06', '#ff5a1f', '#2a1208'], { f: 'satin', g: 1.2, a: '#ff5a1f' }],
        ['magnate', 'Antimatter', 'marble', ['#f4f4f6', '#0c0c10', '#9a9aa6'], { f: 'pearl', a: '#0c0c10' }],
      ],
      4: [
        ['kestrel', 'Singularity', 'nebula', ['#020206', '#ff2e6a', '#2e9aff', '#ffffff'], { f: 'pearl', g: 1.0, a: '#ff2e6a' }],
        ['viper', 'Overclock', 'circuit', ['#d9dde2', '#ff2e2e', '#aeb4bc'], { f: 'chrome', g: 1.1, a: '#ff2e2e' }],
      ],
      5: [
        ['kodiak', 'Apex Predator', 'scales', ['#0a0a0c', '#ff2e2e', '#2a0808'], { f: 'pearl', g: 1.0, a: '#ff2e2e' }],
      ],
      6: [
        ['needle', 'Lightspeed', 'stripes', ['#f4fbff', '#2ea8ff', '#ffffff'], { f: 'chrome', g: 0.8, sc: 2.2, a: '#0c1420' }],
        ['talon', 'Event Horizon', 'fade', ['#050308', '#4a1a8f', '#ff6a1a', '#050308'], { f: 'pearl', g: 0.5, a: '#0a0810' }],
        ['fang', 'Plasma', 'nebula', ['#0a0420', '#6a2cff', '#2ea8ff', '#f0d9ff'], { f: 'gloss', g: 0.9, a: '#0c0a18' }],
        ['bolo', 'Meltdown', 'crackle', ['#140a06', '#ff5a1f', '#2a1208'], { f: 'satin', g: 1.3, a: '#1a120c' }],
        ['gauntlet', 'Exo', 'circuit', ['#16191d', '#ff5a1f', '#22262b'], { f: 'cloth', g: 0.7, a: '#ff5a1f' }],
        ['wraps', 'Charged', 'wave', ['#0a1420', '#2ea8ff', '#12283c'], { f: 'cloth', g: 0.6, a: '#2ea8ff' }],
      ],
    },
  },
];

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export const SKINS: Record<string, SkinDef> = {};
export const CRATES: CrateDef[] = SRC.map((c) => {
  const factor = c.surplus ? SURPLUS_FACTOR : STD_FACTOR;
  const skins: SkinDef[] = [];
  for (const key of Object.keys(c.tiers)) {
    const rarity = Number(key);
    for (const [weapon, name, kind, colors, opts] of c.tiers[rarity]) {
      const id = `${c.id}_${weapon}_${slug(name)}`;
      const seed = hashStr(id);
      // per-skin desirability, 0.72 .. 1.38 of the tier's book value
      const jitter = 0.72 + ((seed % 1000) / 1000) * 0.66;
      const raw = c.price * factor[rarity] * jitter;
      const base = raw >= 100 ? Math.round(raw) : Math.round(raw * 100) / 100;
      const def: SkinDef = { id, weapon, name, rarity, kind, colors, crate: c.id, base, seed, ...(opts || {}) };
      if (!def.f) def.f = WEAPONS[weapon].kind === 2 ? 'cloth' : 'satin';
      SKINS[id] = def;
      skins.push(def);
    }
  }
  return {
    id: c.id, name: c.name, price: c.price, rank: c.rank, blurb: c.blurb, paint: c.paint, mark: c.mark,
    look: { kind: c.look[0], colors: c.look[1], seed: hashStr('crate:' + c.id), ...c.look[2] },
    odds: c.surplus ? SURPLUS_ODDS : STD_ODDS, skins,
  };
});

export const CRATE_BY_ID: Record<string, CrateDef> = Object.fromEntries(CRATES.map((c) => [c.id, c]));
export const SKIN_LIST: SkinDef[] = Object.values(SKINS);

export function skinTitle(s: SkinDef): string {
  return `${WEAPONS[s.weapon].name} | ${s.name}`;
}

// ---------------------------------------------------------------- ranks

export const RANK_NAMES = [
  'Recruit', 'Private', 'Corporal', 'Sergeant', 'Staff Sergeant', 'Master Sergeant', 'Warrant Officer',
  'Lieutenant', 'Captain', 'Major', 'Colonel', 'Brigadier', 'General', 'Field Marshal', 'Commander',
  'High Commander', 'Supreme Commander', 'Warlord', 'Legend', 'Ghost',
];

export function rankName(rank: number): string {
  const i = rank - 1;
  if (i < RANK_NAMES.length) return RANK_NAMES[i];
  return `Ghost ${toRoman(i - RANK_NAMES.length + 2)}`;
}

export function toRoman(n: number): string {
  const map: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

/** XP needed to go from `rank` to the next one. */
export function xpForRank(rank: number): number {
  return Math.round(50 * Math.pow(1.42, rank - 1));
}

// ---------------------------------------------------------------- upgrades

export interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  base: number;
  growth: number;
  max: number;
  /** Human-readable effect at a level. */
  effect: (lvl: number) => string;
  icon: string;
}

export const BULK_STEPS = [1, 2, 3, 5, 10];

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'storage', name: 'Armory Racks', icon: 'rack', base: 60, growth: 1.5, max: 40,
    desc: 'More rack space. Every stored item keeps earning.',
    effect: (l) => `${24 + l * 8} slots`,
  },
  {
    id: 'income', name: 'Logistics Network', icon: 'truck', base: 150, growth: 1.65, max: 60,
    desc: 'Leasing contracts pay more for everything in the Armory.',
    effect: (l) => `+${l * 20}% income`,
  },
  {
    id: 'luck', name: 'Insider Intel', icon: 'eye', base: 400, growth: 1.95, max: 25,
    desc: 'Tips on which crates got the good stuff. Boosts Elite and better drops.',
    effect: (l) => `+${l * 6}% rare odds`,
  },
  {
    id: 'handling', name: 'White-Glove Handling', icon: 'glove', base: 800, growth: 2.05, max: 10,
    desc: 'Careful unpacking. Drops roll better condition.',
    effect: (l) => `+${l * 6}% condition`,
  },
  {
    id: 'broker', name: 'Broker License', icon: 'badge', base: 250, growth: 2.2, max: 10,
    desc: 'Lower exchange fees on every sale.',
    effect: (l) => `${12 - l}% fee`,
  },
  {
    id: 'supply', name: 'Supply Line', icon: 'chute', base: 80, growth: 1.8, max: 8,
    desc: 'Free supply drops arrive faster.',
    effect: (l) => `every ${90 - l * 8}s`,
  },
  {
    id: 'bulk', name: 'Bulk Unpacking', icon: 'stack', base: 900, growth: 6, max: 4,
    desc: 'Open several crates in one go.',
    effect: (l) => `x${BULK_STEPS[l]} at once`,
  },
  {
    id: 'offline', name: 'Night Shift', icon: 'moon', base: 500, growth: 1.9, max: 11,
    desc: 'The Armory keeps earning for longer while you are away.',
    effect: (l) => `${1 + l}h away cap`,
  },
];

export const UPGRADE_BY_ID: Record<string, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));
