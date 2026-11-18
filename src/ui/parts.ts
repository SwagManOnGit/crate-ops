// Shared pieces: the item tag (card), the wear bar and the item inspect sheet.
import { CRATE_BY_ID, RARITIES, SKINS, WEAPONS, WEARS, wearIndex } from '../data';
import { PATTERN_GRADES, incomeOf, patternGrade, serialMult, valueOf, type Item } from '../game';
import { changePct, DAY_TICKS } from '../market';
import { specFor } from '../render';
import type { App, ItemLike } from './app';
import { ICON, cr, esc, fmt, fmtRate, upDown } from './util';

export interface TagOpts {
  act?: string;
  /** extra data-* attributes */
  data?: Record<string, string | number>;
  picked?: boolean;
  /** Show this price instead of the market value. */
  price?: number;
  note?: string;
  noIncome?: boolean;
}

export function serialLabel(sn: number): string {
  return 'SN-' + String(sn).padStart(3, '0');
}

export function tag(app: App, it: ItemLike & { lock?: 1 }, o: TagOpts = {}): string {
  const skin = SKINS[it.s];
  const wi = wearIndex(it.w);
  const grade = patternGrade(skin, it.p);
  const value = o.price ?? valueOf(it, app.tick());
  const data = Object.entries({ ...(it.id !== undefined ? { id: it.id } : {}), ...(o.data || {}) })
    .map(([k, v]) => `data-${k}="${v}"`).join(' ');
  const marks = [
    it.sn ? `<i class="mk mk-sn" title="Serialized">${serialLabel(it.sn)}</i>` : '',
    grade ? `<i class="mk mk-g${grade}" title="${PATTERN_GRADES[grade].name} pattern">${grade === 2 ? 'Prime' : 'Choice'}</i>` : '',
    it.lock ? `<i class="mk mk-lock" title="In the vault">${ICON.lock}</i>` : '',
  ].join('');
  return `<button class="tag r${skin.rarity}${o.picked ? ' picked' : ''}" ${o.act ? `data-act="${o.act}"` : ''} ${data}>
    <span class="tag-top"><b class="wear w${wi}">${WEARS[wi].short}</b>${marks}</span>
    ${app.imgItem(it, 'tag-img')}
    <span class="tag-name"><b>${esc(WEAPONS[skin.weapon].name)}</b><span>${esc(skin.name)}</span></span>
    <span class="tag-foot">${it.id !== undefined && o.price === undefined ? `<span class="cr" data-live="value" data-id="${it.id}">${fmt(value)}</span>` : cr(value)}${o.note ? `<span class="tag-note">${o.note}</span>` : o.noIncome ? '' : `<span class="inc">+${fmtRate(incomeOf(it) * app.game.incomeMult(app.now()))}/s</span>`}</span>
  </button>`;
}

/** Five-segment condition bar with a marker at the item's float. */
export function wearBar(f: number): string {
  let lo = 0;
  const segs = WEARS.map((g, i) => {
    const hi = Math.min(1, g.max);
    const s = `<i class="w${i}" style="width:${((hi - lo) * 100).toFixed(1)}%"></i>`;
    lo = hi;
    return s;
  }).join('');
  return `<span class="wearbar">${segs}<b style="left:${(f * 100).toFixed(2)}%"></b></span>`;
}

export function itemFacts(_app: App, it: ItemLike): string {
  const skin = SKINS[it.s];
  const wi = wearIndex(it.w);
  const grade = patternGrade(skin, it.p);
  const rows = [
    `<div class="fact"><span>Condition</span><b class="wear-t w${wi}">${WEARS[wi].name}</b><span class="fact-x">float ${it.w.toFixed(4)}</span>${wearBar(it.w)}</div>`,
    `<div class="fact"><span>Pattern</span><b>#${String(it.p).padStart(3, '0')}</b><span class="fact-x">${PATTERN_GRADES[grade].name}${grade ? ` · x${PATTERN_GRADES[grade].mult} value` : ''}</span></div>`,
  ];
  if (it.sn) rows.push(`<div class="fact"><span>Serial</span><b>${serialLabel(it.sn)}</b><span class="fact-x">x${serialMult(it.sn)} value · +25% income</span></div>`);
  return rows.join('');
}

export function rarityStamp(r: number): string {
  return `<span class="stamp r${r}">${RARITIES[r].name}</span>`;
}

export function openItem(app: App, id: number): void {
  const g = app.game;
  const it = g.item(id);
  if (!it) return;
  const skin = SKINS[it.s];
  const tick = app.tick();
  const value = valueOf(it, tick);
  const inc = incomeOf(it) * g.incomeMult(app.now());
  const m = app.openModal(`
    <div class="sheet item r${skin.rarity}">
      <button class="x" data-act="close" aria-label="Close">${ICON.close}</button>
      <div class="stage"><canvas class="live" id="item-cv"></canvas><span class="stage-hint">Drag to turn it, scroll to zoom</span></div>
      <div class="item-head">
        ${rarityStamp(skin.rarity)}
        <h2><small>${esc(WEAPONS[skin.weapon].name)}</small>${esc(skin.name)}</h2>
        <span class="from">${esc(CRATE_BY_ID[skin.crate].name)}</span>
      </div>
      <div class="facts">
        ${itemFacts(app, it)}
        <div class="fact"><span>Market value</span><b class="cr" data-live="value" data-id="${it.id}">${fmt(value)}</b><span class="fact-x">today ${upDown(changePct(skin, tick, DAY_TICKS))}</span></div>
        <div class="fact"><span>Earns</span><b class="gain">+${fmtRate(inc)} / sec</b><span class="fact-x">pays for itself in ${Math.max(1, Math.round(value / Math.max(inc, 1e-9) / 60))} min</span></div>
      </div>
      <div class="row-btns wrap">
        <button class="btn" data-act="item-sell" data-id="${it.id}" ${it.lock ? 'disabled' : ''}>Sell for ${fmt(value * (1 - g.fee))}</button>
        <button class="btn ghost" data-act="item-lock" data-id="${it.id}">${it.lock ? ICON.unlock + ' Take out of vault' : ICON.lock + ' Vault'}</button>
        <button class="btn ghost" data-act="item-trade" data-id="${it.id}" ${it.lock ? 'disabled' : ''}>Add to Trade-Up</button>
        <button class="btn ghost" data-act="skin" data-skin="${skin.id}">Price history</button>
      </div>
      <p class="fine">Exchange fee ${Math.round(g.fee * 100)}%. Vaulted items cannot be sold or traded, and survive a redeploy.</p>
    </div>`, { cls: 'center' });
  app.mountLive(m.querySelector<HTMLCanvasElement>('#item-cv')!, specFor(it, patternGrade(skin, it.p) === 2), { bg: true, tint: RARITIES[skin.rarity].color });
}

export const partActions = {
  item: (app: App, d: DOMStringMap): void => {
    app.sfx.click();
    openItem(app, Number(d.id));
  },
  'item-sell': (app: App, d: DOMStringMap): void => {
    const got = app.game.sell([Number(d.id)], app.now());
    if (got > 0) {
      app.sfx.sell();
      app.toast({ kind: 'good', text: `Sold for ${fmt(got)} credits` });
      app.touch();
    }
    app.closeModal();
    app.refresh();
  },
  'item-lock': (app: App, d: DOMStringMap): void => {
    const g = app.game;
    const it = g.item(Number(d.id));
    if (!it) return;
    if (!it.lock && g.s.items.filter((x) => x.lock).length >= g.vaultSlots) {
      app.toast({ kind: 'info', text: `Vault is full (${g.vaultSlots} slots)`, sub: 'Each redeploy adds a slot' });
      app.sfx.error();
      return;
    }
    g.toggleLock(it.id);
    app.sfx.latch();
    app.touch();
    app.closeModal();
    openItem(app, it.id);
    app.refresh();
  },
  'item-trade': (app: App, d: DOMStringMap): void => {
    const id = Number(d.id);
    const t = app.ui.trade;
    if (!t.ids.includes(id) && t.ids.length < 10) t.ids.push(id);
    app.closeAllModals();
    app.go('trade');
  },
};

export type { Item };
