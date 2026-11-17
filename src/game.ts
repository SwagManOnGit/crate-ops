// Game rules and state. No DOM in here, so the balance script can run it headless.
import {
  BULK_STEPS, CRATES, CRATE_BY_ID, EXOTIC, RARITIES, SKINS, SKIN_LIST, UPGRADE_BY_ID, WEARS,
  rankName, wearIndex, wearValue, xpForRank, type CrateDef, type SkinDef,
} from './data';
import { priceAt, tickOf, type Listing } from './market';
import { clamp, unit } from './rng';

export interface Item {
  id: number;
  /** skin id */
  s: string;
  /** wear float 0..1 */
  w: number;
  /** pattern index 0..999 */
  p: number;
  /** serial number, 0 = not serialized */
  sn: number;
  /** acquired (ms) */
  t: number;
  lock?: 1;
}

export interface Stats {
  opened: number;
  sold: number;
  soldValue: number;
  spent: number;
  passive: number;
  tradeUps: number;
  tradeWins: number;
  battles: number;
  battleWins: number;
  bought: number;
  upgrades: number;
  freeDrops: number;
  bestValue: number;
  bestSkin: string;
  bestTier: number;
  maxIncome: number;
}

export interface Save {
  v: number;
  cash: number;
  /** earned this deployment (drives medals) */
  run: number;
  life: number;
  xp: number;
  rank: number;
  items: Item[];
  nextId: number;
  up: Record<string, number>;
  stats: Stats;
  found: string[];
  claimed: string[];
  last: number;
  freeAt: number;
  adAt: number;
  boostUntil: number;
  medals: number;
  prestiges: number;
  bought: string[];
  fast: boolean;
  intro: number;
}

export interface Toast {
  kind: 'rank' | 'mission' | 'info' | 'good' | 'bad';
  text: string;
  sub?: string;
}

export const PATTERN_GRADES = [
  { name: 'Standard', mult: 1 },
  { name: 'Choice', mult: 1.35 },
  { name: 'Prime', mult: 3 },
];

/** 0 standard, 1 choice (8.5%), 2 prime (1.5%): fixed per skin + pattern index. */
export function patternGrade(skin: SkinDef, p: number): number {
  const g = unit(skin.seed ^ 0x9e37, p);
  return g < 0.015 ? 2 : g < 0.1 ? 1 : 0;
}

export function serialMult(sn: number): number {
  return sn ? (sn <= 10 ? 2.5 : 1.5) : 1;
}

/** Market value of a specific item at a tick. */
export function valueOf(it: { s: string; w: number; p: number; sn: number }, tick: number): number {
  const skin = SKINS[it.s];
  return priceAt(skin, tick) * wearValue(it.w) * PATTERN_GRADES[patternGrade(skin, it.p)].mult * serialMult(it.sn);
}

/** Passive income (credits / second) before global multipliers. */
export function incomeOf(it: { s: string; w: number; p: number; sn: number }): number {
  const skin = SKINS[it.s];
  const grade = patternGrade(skin, it.p);
  return (skin.base / RARITIES[skin.rarity].payback) * WEARS[wearIndex(it.w)].income
    * (grade === 2 ? 1.5 : grade === 1 ? 1.15 : 1) * (it.sn ? 1.25 : 1);
}

export function tradeChance(mult: number): number {
  return clamp(0.92 / mult, 0.02, 0.9);
}

export const TRADE_MIN = 1.15;
export const TRADE_MAX = 40;
export const TRADE_SLOTS = 10;

export interface Pull {
  s: string;
  w: number;
  p: number;
  sn: number;
  value: number;
}

export interface BattleResult {
  crate: string;
  rounds: number;
  mode: 'high' | 'low';
  names: string[];
  /** pulls[round][player] */
  pulls: Pull[][];
  totals: number[];
  winner: number;
  cost: number;
  kept: Item[];
  autoSold: number;
}

export interface TradeResult {
  ok: boolean;
  chance: number;
  roll: number;
  item: Item | null;
  lost: Item[];
  value: number;
  target: number;
}

export interface Mission {
  id: string;
  text: string;
  reward: number;
  prog: (g: Game) => [number, number];
}

const CALLSIGNS = [
  'MAVERICK', 'NOMAD', 'RAZOR', 'SPECTRE', 'BISHOP', 'ORACLE', 'HAVOC', 'JINX', 'VANDAL', 'COBALT',
  'EMBER', 'ONYX', 'PYRO', 'QUILL', 'TORQUE', 'WRAITH', 'ZERO', 'ATLAS', 'BANSHEE', 'DRIFT',
];

export const MISSIONS: Mission[] = [
  { id: 'm1', text: 'Crack open your first crate', reward: 15, prog: (g) => [g.s.stats.opened, 1] },
  { id: 'm2', text: 'Sell an item on the Exchange', reward: 20, prog: (g) => [g.s.stats.sold, 1] },
  { id: 'm3', text: 'Open 5 crates', reward: 40, prog: (g) => [g.s.stats.opened, 5] },
  { id: 'm4', text: 'Buy an upgrade at HQ', reward: 60, prog: (g) => [g.s.stats.upgrades, 1] },
  { id: 'm5', text: 'Hold 10 items in the Armory', reward: 80, prog: (g) => [g.s.items.length, 10] },
  { id: 'm6', text: 'Reach Rank 3', reward: 120, prog: (g) => [g.s.rank, 3] },
  { id: 'm7', text: 'Attempt a Trade-Up', reward: 150, prog: (g) => [g.s.stats.tradeUps, 1] },
  { id: 'm8', text: 'Enter a Crate Battle', reward: 200, prog: (g) => [g.s.stats.battles, 1] },
  { id: 'm9', text: 'Unbox an Elite or better', reward: 250, prog: (g) => [g.s.stats.bestTier >= 3 ? 1 : 0, 1] },
  { id: 'm10', text: 'Earn 1 credit per second', reward: 400, prog: (g) => [g.s.stats.maxIncome, 1] },
  { id: 'm11', text: 'Open 25 crates', reward: 500, prog: (g) => [g.s.stats.opened, 25] },
  { id: 'm12', text: 'Win a Crate Battle', reward: 800, prog: (g) => [g.s.stats.battleWins, 1] },
  { id: 'm13', text: 'Land a successful Trade-Up', reward: 900, prog: (g) => [g.s.stats.tradeWins, 1] },
  { id: 'm14', text: 'Unbox a Prototype or better', reward: 1500, prog: (g) => [g.s.stats.bestTier >= 4 ? 1 : 0, 1] },
  { id: 'm15', text: 'Buy a listing on the Exchange', reward: 1500, prog: (g) => [g.s.stats.bought, 1] },
  { id: 'm16', text: 'Earn 10 credits per second', reward: 3000, prog: (g) => [g.s.stats.maxIncome, 10] },
  { id: 'm17', text: 'Open 100 crates', reward: 5000, prog: (g) => [g.s.stats.opened, 100] },
  { id: 'm18', text: 'Discover 40 different skins', reward: 8000, prog: (g) => [g.s.found.length, 40] },
  { id: 'm19', text: 'Unbox an Apex', reward: 15000, prog: (g) => [g.s.stats.bestTier >= 5 ? 1 : 0, 1] },
  { id: 'm20', text: 'Reach Rank 10', reward: 20000, prog: (g) => [g.s.rank, 10] },
  { id: 'm21', text: 'Earn 100 credits per second', reward: 40000, prog: (g) => [g.s.stats.maxIncome, 100] },
  { id: 'm22', text: 'Win 10 Crate Battles', reward: 60000, prog: (g) => [g.s.stats.battleWins, 10] },
  { id: 'm23', text: 'Unbox an Exotic', reward: 100000, prog: (g) => [g.s.stats.bestTier >= 6 ? 1 : 0, 1] },
  { id: 'm24', text: 'Redeploy for your first Medals', reward: 150000, prog: (g) => [g.s.prestiges, 1] },
  { id: 'm25', text: 'Discover 90 different skins', reward: 400000, prog: (g) => [g.s.found.length, 90] },
  { id: 'm26', text: 'Open 1,000 crates', reward: 1000000, prog: (g) => [g.s.stats.opened, 1000] },
  { id: 'm27', text: 'Earn 5,000 credits per second', reward: 3000000, prog: (g) => [g.s.stats.maxIncome, 5000] },
  { id: 'm28', text: 'Complete the catalog', reward: 25000000, prog: (g) => [g.s.found.length, SKIN_LIST.length] },
];

export const SAVE_VERSION = 1;
export const PRESTIGE_RANK = 8;
/** Income bonus per medal, and the earnings (squared scale) that buy the first one. */
export const MEDAL_BONUS = 0.2;
export const MEDAL_COST = 50000;
export const BOOST_MS = 5 * 60 * 1000;
export const AD_DROP_MS = 4 * 60 * 1000;

function freshStats(): Stats {
  return {
    opened: 0, sold: 0, soldValue: 0, spent: 0, passive: 0, tradeUps: 0, tradeWins: 0, battles: 0, battleWins: 0,
    bought: 0, upgrades: 0, freeDrops: 0, bestValue: 0, bestSkin: '', bestTier: -1, maxIncome: 0,
  };
}

export function freshSave(now: number): Save {
  return {
    v: SAVE_VERSION, cash: 40, run: 0, life: 0, xp: 0, rank: 1, items: [], nextId: 1, up: {}, stats: freshStats(),
    found: [], claimed: [], last: now, freeAt: 0, adAt: 0, boostUntil: 0, medals: 0, prestiges: 0, bought: [],
    fast: false, intro: 0,
  };
}

export function parseSave(raw: string | null | undefined, now: number): Save {
  const base = freshSave(now);
  if (!raw) return base;
  try {
    const d = JSON.parse(raw) as Partial<Save>;
    if (!d || typeof d !== 'object' || typeof d.cash !== 'number') return base;
    const s: Save = { ...base, ...d, stats: { ...base.stats, ...(d.stats || {}) }, up: { ...(d.up || {}) } };
    s.items = (Array.isArray(d.items) ? d.items : []).filter((it) => it && SKINS[it.s] && typeof it.w === 'number');
    s.found = (Array.isArray(d.found) ? d.found : []).filter((id) => SKINS[id]);
    s.claimed = Array.isArray(d.claimed) ? d.claimed : [];
    s.bought = Array.isArray(d.bought) ? d.bought : [];
    s.nextId = Math.max(s.nextId || 1, ...s.items.map((it) => it.id + 1), 1);
    s.rank = Math.max(1, Math.floor(s.rank || 1));
    s.v = SAVE_VERSION;
    if (!Number.isFinite(s.cash) || s.cash < 0) s.cash = 0;
    return s;
  } catch {
    return base;
  }
}

export class Game {
  s: Save;
  toasts: Toast[] = [];
  private incomeCache = -1;
  /** Bumped whenever the inventory changes (UI uses it to skip re-renders). */
  rev = 0;

  constructor(raw: string | null | undefined, now: number) {
    this.s = parseSave(raw, now);
  }

  serialize(): string {
    return JSON.stringify(this.s);
  }

  // ------------------------------------------------------------ derived values

  lvl(id: string): number {
    return this.s.up[id] || 0;
  }
  get capacity(): number {
    return 24 + 8 * this.lvl('storage');
  }
  get free(): number {
    return this.capacity - this.s.items.length;
  }
  get fee(): number {
    return (12 - this.lvl('broker')) / 100;
  }
  get freeCooldown(): number {
    return (90 - 8 * this.lvl('supply')) * 1000;
  }
  get bulkMax(): number {
    return BULK_STEPS[this.lvl('bulk')];
  }
  get offlineCap(): number {
    return (1 + this.lvl('offline')) * 3600;
  }
  get vaultSlots(): number {
    return 3 + this.s.prestiges;
  }

  incomeMult(now: number): number {
    return (1 + 0.2 * this.lvl('income')) * (1 + MEDAL_BONUS * this.s.medals) * (1 + 0.002 * this.s.found.length)
      * (now < this.s.boostUntil ? 2 : 1);
  }

  baseIncome(): number {
    if (this.incomeCache < 0) {
      let sum = 0;
      for (const it of this.s.items) sum += incomeOf(it);
      this.incomeCache = sum;
    }
    return this.incomeCache;
  }

  income(now: number): number {
    return this.baseIncome() * this.incomeMult(now);
  }

  inventoryValue(now: number): number {
    const tick = tickOf(now);
    let sum = 0;
    for (const it of this.s.items) sum += valueOf(it, tick);
    return sum;
  }

  item(id: number): Item | undefined {
    return this.s.items.find((it) => it.id === id);
  }

  private dirty(): void {
    this.incomeCache = -1;
    this.rev++;
  }

  private earn(amount: number): void {
    this.s.cash += amount;
    this.s.run += amount;
    this.s.life += amount;
  }

  // ------------------------------------------------------------ time

  /** Advance passive income. Returns away-earnings info when a long gap was bridged. */
  update(now: number): { seconds: number; earned: number } | null {
    const dt = (now - this.s.last) / 1000;
    this.s.last = now;
    if (dt <= 0) return null;
    const inc = this.income(now);
    if (inc > this.s.stats.maxIncome) this.s.stats.maxIncome = inc;
    if (dt > 20) {
      const secs = Math.min(dt, this.offlineCap);
      const earned = inc * secs * 0.5;
      if (earned > 0) {
        this.earn(earned);
        this.s.stats.passive += earned;
      }
      return dt > 300 && earned >= 1 ? { seconds: secs, earned } : null;
    }
    const earned = inc * dt;
    if (earned > 0) {
      this.earn(earned);
      this.s.stats.passive += earned;
    }
    return null;
  }

  /** Rewarded-ad payout: doubles an away-earnings report. */
  grantBonus(amount: number): void {
    if (amount > 0) this.earn(amount);
  }

  addBoost(now: number): void {
    this.s.boostUntil = Math.min(Math.max(this.s.boostUntil, now) + BOOST_MS, now + 6 * BOOST_MS);
  }

  // ------------------------------------------------------------ xp / rank

  addXp(n: number): void {
    this.s.xp += n;
    while (this.s.xp >= xpForRank(this.s.rank)) {
      this.s.xp -= xpForRank(this.s.rank);
      this.s.rank++;
      const bonus = Math.round(25 * Math.pow(1.6, this.s.rank - 1));
      this.earn(bonus);
      const unlocked = CRATES.filter((c) => c.rank === this.s.rank).map((c) => c.name);
      const extra = this.s.rank === 2 ? 'Trade-Ups unlocked' : this.s.rank === 3 ? 'Crate Battles unlocked' : '';
      this.toasts.push({
        kind: 'rank',
        text: `Promoted: ${rankName(this.s.rank)}`,
        sub: [`+${Math.round(bonus).toLocaleString('en-US')} credits`, ...unlocked.map((u) => `${u} unlocked`), extra].filter(Boolean).join(' · '),
      });
    }
  }

  // ------------------------------------------------------------ crates

  crateUnlocked(c: CrateDef): boolean {
    return this.s.rank >= c.rank;
  }

  /** Roll one drop from a crate using the player's luck and handling upgrades. */
  roll(crate: CrateDef, now: number, luck = this.lvl('luck'), handling = this.lvl('handling')): Item {
    return { id: this.s.nextId++, ...this.sample(crate, luck, handling), t: now };
  }

  /** A drop roll that is not added anywhere (roulette filler, previews). */
  sample(crate: CrateDef, luck = this.lvl('luck'), handling = this.lvl('handling')): { s: string; w: number; p: number; sn: number } {
    const weights = crate.odds.map((w, r) => (r >= 3 ? w * (1 + 0.06 * luck) : w));
    const present = weights.map((w, r) => (crate.skins.some((s) => s.rarity === r) ? w : 0));
    const total = present.reduce((a, b) => a + b, 0);
    let x = Math.random() * total;
    let rarity = 0;
    for (let r = 0; r < present.length; r++) {
      x -= present[r];
      if (x < 0) { rarity = r; break; }
    }
    const pool = crate.skins.filter((s) => s.rarity === rarity);
    const skin = pool[Math.floor(Math.random() * pool.length)];
    return {
      s: skin.id,
      w: Math.min(0.9999, Math.pow(Math.random(), 1.25 + 0.075 * handling)),
      p: Math.floor(Math.random() * 1000),
      sn: Math.random() < 0.06 ? 1 + Math.floor(Math.random() * 999) : 0,
    };
  }

  private register(it: Item, now: number): void {
    const skin = SKINS[it.s];
    if (!this.s.found.includes(skin.id)) this.s.found.push(skin.id);
    const v = valueOf(it, tickOf(now));
    if (v > this.s.stats.bestValue) {
      this.s.stats.bestValue = v;
      this.s.stats.bestSkin = skin.id;
    }
    if (skin.rarity > this.s.stats.bestTier) this.s.stats.bestTier = skin.rarity;
  }

  private add(it: Item, now: number): void {
    this.s.items.push(it);
    this.register(it, now);
    this.dirty();
  }

  whyNotOpen(crate: CrateDef, n: number, free = false): string | null {
    if (!this.crateUnlocked(crate)) return `Reach Rank ${crate.rank} (${rankName(crate.rank)})`;
    if (this.free < n) return 'Armory full: sell items or add racks';
    if (!free && this.s.cash < crate.price * n) return 'Not enough credits';
    return null;
  }

  open(crateId: string, n: number, now: number, free = false): Item[] {
    const crate = CRATE_BY_ID[crateId];
    if (this.whyNotOpen(crate, n, free)) return [];
    if (!free) {
      this.s.cash -= crate.price * n;
      this.s.stats.spent += crate.price * n;
    }
    const out: Item[] = [];
    for (let i = 0; i < n; i++) {
      const it = this.roll(crate, now);
      this.add(it, now);
      out.push(it);
    }
    this.s.stats.opened += n;
    this.addXp(Math.round(6 * Math.pow(crate.price, 0.45)) * n);
    return out;
  }

  /** Which crate the next free supply drop contains (mostly Surplus, sometimes better). */
  private freeCrate(): CrateDef {
    const unlocked = CRATES.filter((c) => this.crateUnlocked(c));
    if (unlocked.length > 1 && Math.random() < 0.15) {
      // weighted toward the cheaper unlocked crates
      const pool = unlocked.slice(1);
      const weights = pool.map((_, i) => 1 / (i + 1));
      let x = Math.random() * weights.reduce((a, b) => a + b, 0);
      for (let i = 0; i < pool.length; i++) {
        x -= weights[i];
        if (x < 0) return pool[i];
      }
    }
    return CRATES[0];
  }

  freeReady(now: number): boolean {
    return now >= this.s.freeAt;
  }

  claimFree(now: number): { crate: CrateDef; items: Item[] } | null {
    if (!this.freeReady(now) || this.free < 1) return null;
    const crate = this.freeCrate();
    const items = this.open(crate.id, 1, now, true);
    if (!items.length) return null;
    this.s.freeAt = now + this.freeCooldown;
    this.s.stats.freeDrops++;
    return { crate, items };
  }

  /** Rewarded-ad drop: the best crate the player has unlocked, for free. */
  adDropReady(now: number): boolean {
    return now >= this.s.adAt;
  }

  bestCrate(): CrateDef {
    const unlocked = CRATES.filter((c) => this.crateUnlocked(c));
    return unlocked[unlocked.length - 1];
  }

  claimAdDrop(now: number): { crate: CrateDef; items: Item[] } | null {
    if (!this.adDropReady(now) || this.free < 1) return null;
    const crate = this.bestCrate();
    const items = this.open(crate.id, 1, now, true);
    if (!items.length) return null;
    this.s.adAt = now + AD_DROP_MS;
    return { crate, items };
  }

  // ------------------------------------------------------------ selling / buying

  sell(ids: number[], now: number): number {
    const tick = tickOf(now);
    const set = new Set(ids);
    let total = 0;
    let count = 0;
    this.s.items = this.s.items.filter((it) => {
      if (!set.has(it.id)) return true;
      total += valueOf(it, tick) * (1 - this.fee);
      count++;
      return false;
    });
    if (count) {
      this.earn(total);
      this.s.stats.sold += count;
      this.s.stats.soldValue += total;
      this.addXp(count);
      this.dirty();
    }
    return total;
  }

  toggleLock(id: number): boolean {
    const it = this.item(id);
    if (!it) return false;
    if (it.lock) delete it.lock;
    else it.lock = 1;
    this.rev++;
    return !!it.lock;
  }

  listingPrice(l: Listing, now: number): number {
    return valueOf({ s: l.skin.id, w: l.wear, p: l.pattern, sn: l.serial }, tickOf(now)) * l.markup;
  }

  buyListing(l: Listing, now: number): Item | null {
    const price = this.listingPrice(l, now);
    if (this.s.cash < price || this.free < 1 || this.s.bought.includes(l.id)) return null;
    this.s.cash -= price;
    this.s.stats.spent += price;
    this.s.stats.bought++;
    this.s.bought.push(l.id);
    if (this.s.bought.length > 60) this.s.bought.splice(0, this.s.bought.length - 60);
    const it: Item = { id: this.s.nextId++, s: l.skin.id, w: l.wear, p: l.pattern, sn: l.serial, t: now };
    this.add(it, now);
    return it;
  }

  // ------------------------------------------------------------ upgrades

  upgradeCost(id: string): number {
    const u = UPGRADE_BY_ID[id];
    const raw = u.base * Math.pow(u.growth, this.lvl(id));
    const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(raw)) - 1));
    return Math.round(raw / mag) * mag;
  }

  buyUpgrade(id: string): boolean {
    const u = UPGRADE_BY_ID[id];
    const cost = this.upgradeCost(id);
    if (this.lvl(id) >= u.max || this.s.cash < cost) return false;
    this.s.cash -= cost;
    this.s.stats.spent += cost;
    this.s.up[id] = this.lvl(id) + 1;
    this.s.stats.upgrades++;
    this.dirty();
    return true;
  }

  // ------------------------------------------------------------ trade-ups

  private tradePool(): SkinDef[] {
    return SKIN_LIST.filter((sk) => CRATE_BY_ID[sk.crate].rank <= this.s.rank);
  }

  /** Rarities a successful trade-up could return for a target value. */
  tradeBand(target: number, now: number): number[] {
    const tick = tickOf(now);
    const set = new Set<number>();
    for (const sk of this.tradePool()) {
      const ratio = target / priceAt(sk, tick);
      if (ratio >= 0.3 && ratio <= 1.12) set.add(sk.rarity);
    }
    return [...set].sort((a, b) => a - b);
  }

  private forge(target: number, now: number): Item {
    const tick = tickOf(now);
    const pool = this.tradePool();
    const cands: { sk: SkinDef; ratio: number; w: number }[] = [];
    for (const sk of pool) {
      const ratio = target / priceAt(sk, tick);
      if (ratio >= 0.3 && ratio <= 1.12) cands.push({ sk, ratio, w: Math.pow(sk.rarity + 1, 2) });
    }
    let sk: SkinDef;
    let ratio: number;
    if (cands.length) {
      let x = Math.random() * cands.reduce((a, c) => a + c.w, 0);
      let pickC = cands[0];
      for (const c of cands) {
        x -= c.w;
        if (x < 0) { pickC = c; break; }
      }
      sk = pickC.sk;
      ratio = pickC.ratio;
    } else {
      // target is off the chart: take the closest skin and clamp its condition
      sk = pool.reduce((best, c) => (
        Math.abs(Math.log(target / (priceAt(c, tick) * 0.6))) < Math.abs(Math.log(target / (priceAt(best, tick) * 0.6))) ? c : best
      ), pool[0]);
      ratio = clamp(target / priceAt(sk, tick), 0.3, 1.12);
    }
    let gi = WEARS.findIndex((g) => ratio >= g.value * 0.999);
    if (gi < 0) gi = WEARS.length - 1;
    let t = (ratio / WEARS[gi].value - 1) / 0.12;
    if (t > 1 && gi > 0) {
      // between two grades: round up to the worst float of the better grade
      gi--;
      t = 0;
    }
    t = clamp(t, 0, 1);
    const lo = gi === 0 ? 0 : WEARS[gi - 1].max;
    const hi = Math.min(1, WEARS[gi].max);
    return {
      id: this.s.nextId++,
      s: sk.id,
      w: clamp(hi - t * (hi - lo) - 0.0002, lo, hi - 0.0002),
      p: Math.floor(Math.random() * 1000),
      sn: 0,
      t: now,
    };
  }

  tradeUp(ids: number[], mult: number, now: number): TradeResult | null {
    const tick = tickOf(now);
    const lost = this.s.items.filter((it) => ids.includes(it.id) && !it.lock);
    if (!lost.length || lost.length > TRADE_SLOTS) return null;
    mult = clamp(mult, TRADE_MIN, TRADE_MAX);
    const value = lost.reduce((a, it) => a + valueOf(it, tick), 0);
    const chance = tradeChance(mult);
    const roll = Math.random();
    const ok = roll < chance;
    const set = new Set(lost.map((it) => it.id));
    this.s.items = this.s.items.filter((it) => !set.has(it.id));
    this.dirty();
    let item: Item | null = null;
    if (ok) {
      item = this.forge(value * mult, now);
      this.add(item, now);
      this.s.stats.tradeWins++;
    }
    this.s.stats.tradeUps++;
    this.addXp(15);
    return { ok, chance, roll, item, lost, value, target: value * mult };
  }

  // ------------------------------------------------------------ battles

  battle(crateId: string, rounds: number, bots: number, mode: 'high' | 'low', now: number): BattleResult | null {
    const crate = CRATE_BY_ID[crateId];
    const cost = crate.price * rounds;
    if (!this.crateUnlocked(crate) || this.s.cash < cost || bots < 1 || bots > 3 || rounds < 1 || rounds > 5) return null;
    this.s.cash -= cost;
    this.s.stats.spent += cost;
    const tick = tickOf(now);
    const start = Math.floor(Math.random() * CALLSIGNS.length);
    const names = ['YOU', ...Array.from({ length: bots }, (_, i) => CALLSIGNS[(start + i * 7) % CALLSIGNS.length])];
    const pulls: Pull[][] = [];
    const totals = names.map(() => 0);
    for (let r = 0; r < rounds; r++) {
      const row: Pull[] = [];
      for (let p = 0; p < names.length; p++) {
        // bots open with no upgrades; the player's luck and handling apply to their own pulls
        const it = p === 0 ? this.roll(crate, now) : this.roll(crate, now, 0, 0);
        const value = valueOf(it, tick);
        row.push({ s: it.s, w: it.w, p: it.p, sn: it.sn, value });
        totals[p] += value;
      }
      pulls.push(row);
    }
    let winner = 0;
    for (let p = 1; p < totals.length; p++) {
      if (mode === 'high' ? totals[p] > totals[winner] : totals[p] < totals[winner]) winner = p;
    }
    const kept: Item[] = [];
    let autoSold = 0;
    if (winner === 0) {
      const loot = pulls.flat().sort((a, b) => b.value - a.value);
      for (const pl of loot) {
        const it: Item = { id: this.s.nextId++, s: pl.s, w: pl.w, p: pl.p, sn: pl.sn, t: now };
        if (this.free > 0) {
          this.add(it, now);
          kept.push(it);
        } else {
          this.register(it, now);
          autoSold += pl.value * (1 - this.fee);
        }
      }
      if (autoSold > 0) this.earn(autoSold);
      this.s.stats.battleWins++;
    }
    this.s.stats.battles++;
    this.s.stats.opened += rounds;
    this.addXp(Math.round(6 * Math.pow(crate.price, 0.45)) * rounds + 10);
    return { crate: crateId, rounds, mode, names, pulls, totals, winner, cost, kept, autoSold };
  }

  // ------------------------------------------------------------ missions

  activeMissions(count = 3): Mission[] {
    return MISSIONS.filter((m) => !this.s.claimed.includes(m.id)).slice(0, count);
  }

  missionDone(m: Mission): boolean {
    const [cur, goal] = m.prog(this);
    return cur >= goal;
  }

  claimable(): number {
    return this.activeMissions().filter((m) => this.missionDone(m)).length;
  }

  claimMission(id: string): number {
    const m = this.activeMissions().find((x) => x.id === id);
    if (!m || !this.missionDone(m)) return 0;
    this.s.claimed.push(id);
    this.earn(m.reward);
    this.addXp(20);
    return m.reward;
  }

  // ------------------------------------------------------------ prestige

  medalGain(): number {
    return Math.floor(Math.sqrt(this.s.run / MEDAL_COST));
  }

  canPrestige(): boolean {
    return this.s.rank >= PRESTIGE_RANK && this.medalGain() >= 1;
  }

  /** Redeploy: cash, upgrades and unlocked items reset; medals and vaulted (locked) items stay. */
  prestige(now: number): number {
    if (!this.canPrestige()) return 0;
    const gain = this.medalGain();
    const tick = tickOf(now);
    const keep = this.s.items.filter((it) => it.lock).sort((a, b) => valueOf(b, tick) - valueOf(a, tick)).slice(0, this.vaultSlots);
    this.s.medals += gain;
    this.s.prestiges++;
    this.s.items = keep;
    this.s.cash = 40 + 25 * this.s.medals;
    this.s.run = 0;
    this.s.up = {};
    this.s.freeAt = 0;
    this.s.boostUntil = 0;
    this.dirty();
    return gain;
  }
}

export { EXOTIC };
