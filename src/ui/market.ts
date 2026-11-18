// Exchange tab: index, news wire, movers, the full skin list with price history,
// rotating buy listings and quick selling.
import { CRATES, CRATE_BY_ID, RARITIES, SKINS, SKIN_LIST, WEAPONS, WEARS, wearValue, type SkinDef } from '../data';
import { valueOf } from '../game';
import {
  DAY_TICKS, LISTING_TICKS, TICK_MS, changePct, dayOf, exchangeIndex, indexAt, listingsAt, movers, priceAt,
  recentNews, series, tickOf, volumeAt, type Listing,
} from '../market';
import { specForSkin } from '../render';
import type { App, TabDef } from './app';
import { drawChart, spark } from './chart';
import { itemFacts, rarityStamp, tag } from './parts';
import { ICON, cr, esc, fmt, fmtPct, fmtRate, fmtTime, upDown } from './util';

const SUBS: [string, string][] = [['overview', 'Overview'], ['skins', 'All skins'], ['listings', 'Listings'], ['sell', 'Sell']];
// [label, ticks between points, points]
const RANGES: [string, number, number][] = [['Day', 1, 90], ['Week', 6, 105], ['Month', 25, 108], ['Quarter', 75, 108], ['Year', 300, 110]];
const DAY0 = dayOf(tickOf(Date.UTC(2026, 0, 1)));
const dayNo = (tick: number): string => (dayOf(tick) - DAY0).toLocaleString('en-US');

let skinOpen: { skin: SkinDef; modal: HTMLElement; range: number } | null = null;
let lastBucket = -1;

function skinRow(app: App, s: SkinDef, tick: number): string {
  const pct = changePct(s, tick, DAY_TICKS);
  const pts = series(s, tick, 14, 7);
  return `<button class="row r${s.rarity}" data-act="skin" data-skin="${s.id}">
    ${app.imgSkin(s, 'row-img')}
    <span class="row-name"><b>${esc(WEAPONS[s.weapon].name)}</b><span>${esc(s.name)}</span></span>
    ${spark(pts, pct >= 0)}
    <span class="row-px">${cr(priceAt(s, tick))}${upDown(pct)}</span>
  </button>`;
}

function filteredSkins(app: App, tick: number): SkinDef[] {
  const st = app.ui.market;
  const q = st.q.trim().toLowerCase();
  let list = SKIN_LIST.filter((s) => (!st.crate || s.crate === st.crate)
    && (!q || s.name.toLowerCase().includes(q) || WEAPONS[s.weapon].name.toLowerCase().includes(q) || RARITIES[s.rarity].name.toLowerCase().includes(q)));
  if (st.sort === 'price') list = list.slice().sort((a, b) => priceAt(b, tick) - priceAt(a, tick));
  else if (st.sort === 'name') list = list.slice().sort((a, b) => WEAPONS[a.weapon].name.localeCompare(WEAPONS[b.weapon].name) || a.name.localeCompare(b.name));
  else {
    const pct = new Map(list.map((s) => [s.id, changePct(s, tick, DAY_TICKS)]));
    list = list.slice().sort((a, b) => Math.abs(pct.get(b.id)!) - Math.abs(pct.get(a.id)!));
  }
  return list;
}

function overview(app: App, tick: number): string {
  const mv = movers(tick);
  const news = recentNews(tick, 6);
  const st = app.ui.market;
  return `
    <section class="panel">
      <div class="panel-h">
        <span><b>Crate Ops Index</b><span class="muted"> every listed skin, 1,000 = par</span></span>
        <div class="seg sm">${RANGES.map((r, i) => `<button class="${st.range === i ? 'on' : ''}" data-act="mk-range" data-i="${i}">${r[0]}</button>`).join('')}</div>
      </div>
      <canvas class="chart" id="ix-chart"></canvas>
    </section>
    <div class="cols">
      <section class="panel">
        <div class="panel-h"><b>Biggest risers today</b></div>
        <div class="rows">${mv.up.map((m) => skinRow(app, m.skin, tick)).join('')}</div>
      </section>
      <section class="panel">
        <div class="panel-h"><b>Biggest fallers today</b></div>
        <div class="rows">${mv.down.map((m) => skinRow(app, m.skin, tick)).join('')}</div>
      </section>
    </div>
    <section class="panel">
      <div class="panel-h"><b>Market wire</b></div>
      <ul class="wire">${news.map((n) => `<li><span class="wire-d">Day ${(n.day - DAY0).toLocaleString('en-US')}</span><span class="wire-t">${esc(n.headline)}</span><span class="${n.move >= 0 ? 'up' : 'down'}">${fmtPct(n.move * 100, 0)}</span></li>`).join('')}</ul>
    </section>`;
}

function drawIndex(app: App): void {
  const cv = app.view.querySelector<HTMLCanvasElement>('#ix-chart');
  if (!cv) return;
  const tick = app.tick();
  const [, step, points] = RANGES[app.ui.market.range];
  const data: number[] = [];
  for (let i = 0; i < points; i++) data.push(exchangeIndex(tick - (points - 1 - i) * step));
  const up = data[data.length - 1] >= data[0];
  drawChart(cv, data, { color: up ? '#7fc46b' : '#e5533c', span: [`${RANGES[app.ui.market.range][0]} ago`, 'Now'], format: (v) => v.toFixed(1) });
}

function skinsList(app: App, tick: number): string {
  const st = app.ui.market;
  return `
    <div class="toolbar">
      <label class="search">${ICON.search}<input type="search" data-input="mk-q" value="${esc(st.q)}" placeholder="Search by weapon, skin or rarity" autocomplete="off"></label>
      <div class="chips">
        <button class="chip${!st.crate ? ' on' : ''}" data-act="mk-crate" data-c="">All crates</button>
        ${CRATES.map((c) => `<button class="chip${st.crate === c.id ? ' on' : ''}" data-act="mk-crate" data-c="${c.id}">${esc(c.name.replace(/ (Case|Crate)$/, ''))}</button>`).join('')}
      </div>
      <div class="chips">
        ${[['move', 'Biggest moves'], ['price', 'Price'], ['name', 'Name']].map(([k, l]) => `<button class="chip${st.sort === k ? ' on' : ''}" data-act="mk-sort" data-k="${k}">${l}</button>`).join('')}
      </div>
    </div>
    <div class="rows" id="mk-rows">${rowsHtml(app, tick)}</div>`;
}

function rowsHtml(app: App, tick: number): string {
  const list = filteredSkins(app, tick);
  return list.length ? list.map((s) => skinRow(app, s, tick)).join('') : '<div class="empty"><b>No skins match</b><span>Try a weapon name like Kestrel, or a rarity like Elite.</span></div>';
}

function listings(app: App, tick: number): string {
  const g = app.game;
  const list = listingsAt(tick, g.s.rank);
  const left = (LISTING_TICKS - (tick % LISTING_TICKS)) * (TICK_MS / 1000) - ((app.now() % TICK_MS) / 1000);
  return `
    <p class="lead">Listings from other operators, priced a little over market. The board rotates in <b id="ls-left">${fmtTime(left)}</b>.</p>
    <div class="grid">${list.map((l) => {
      const sold = g.s.bought.includes(l.id);
      const price = g.listingPrice(l, app.now());
      return `<div class="listing${sold ? ' sold' : ''}">${tag(app, { s: l.skin.id, w: l.wear, p: l.pattern, sn: l.serial }, { act: sold ? 'noop' : 'ls-view', data: { l: l.id }, price, note: sold ? 'Sold' : g.s.cash >= price ? 'Buy' : 'Too dear' })}</div>`;
    }).join('')}</div>`;
}

function sellList(app: App, tick: number): string {
  const g = app.game;
  const items = g.s.items.filter((it) => !it.lock).sort((a, b) => valueOf(b, tick) - valueOf(a, tick));
  if (!items.length) return '<div class="empty"><b>Nothing to sell</b><span>Unvaulted items in your Armory show up here.</span><button class="btn" data-act="go" data-tab="crates">Go to crates</button></div>';
  const low = items.filter((it) => SKINS[it.s].rarity <= 1);
  const rough = items.filter((it) => it.w >= 0.42);
  const sum = (arr: typeof items): number => arr.reduce((a, it) => a + valueOf(it, tick) * (1 - g.fee), 0);
  return `
    <p class="lead">Sales clear instantly at the market price, less the ${Math.round(g.fee * 100)}% exchange fee. Sold items stop earning.</p>
    <div class="row-btns wrap">
      <button class="btn ghost sm" data-act="mk-bulk" data-k="low" ${low.length ? '' : 'disabled'}>Sell all Surplus and Service (${low.length}) · ${fmt(sum(low))}</button>
      <button class="btn ghost sm" data-act="mk-bulk" data-k="rough" ${rough.length ? '' : 'disabled'}>Sell all Battered and Scrap (${rough.length}) · ${fmt(sum(rough))}</button>
    </div>
    <div class="grid">${items.map((it) => tag(app, it, { act: 'mk-sell', note: 'Sell' })).join('')}</div>`;
}

// ------------------------------------------------------------ skin sheet

function skinStats(skin: SkinDef, tick: number): string {
  const day = series(skin, tick, DAY_TICKS, 1);
  const month = series(skin, tick, 60, 45);
  let vol = 0;
  for (let i = 0; i < 18; i++) vol += volumeAt(skin, tick - i * 5, 5);
  const avg = month.reduce((a, b) => a + b, 0) / month.length;
  return `
    <span><i>Day high</i><b class="cr">${fmt(Math.max(...day))}</b></span>
    <span><i>Day low</i><b class="cr">${fmt(Math.min(...day))}</b></span>
    <span><i>Week</i><b>${upDown(changePct(skin, tick, DAY_TICKS * 7))}</b></span>
    <span><i>Month average</i><b class="cr">${fmt(avg)}</b></span>
    <span><i>Traded today</i><b>${vol.toLocaleString('en-US')}</b></span>`;
}

function drawSkinChart(app: App): void {
  if (!skinOpen || !skinOpen.modal.isConnected) return;
  const { skin, modal, range } = skinOpen;
  const cv = modal.querySelector<HTMLCanvasElement>('#sk-chart');
  if (!cv) return;
  const tick = app.tick();
  const [label, step, points] = RANGES[range];
  const data = series(skin, tick, points, step);
  const vol = data.map((_, i) => volumeAt(skin, tick - (points - 1 - i) * step, step));
  const up = data[data.length - 1] >= data[0];
  drawChart(cv, data, { color: up ? '#7fc46b' : '#e5533c', volume: vol, span: [`${label} ago`, 'Now'], format: fmt });
  const px = modal.querySelector('#sk-price');
  if (px) px.textContent = fmt(data[data.length - 1]);
  const ch = modal.querySelector('#sk-change');
  if (ch) ch.innerHTML = `${upDown((data[data.length - 1] / data[0] - 1) * 100)} <span class="muted">this ${label.toLowerCase()}</span>`;
  const st = modal.querySelector('#sk-stats');
  if (st) st.innerHTML = skinStats(skin, tick);
}

function openSkin(app: App, skin: SkinDef): void {
  const g = app.game;
  const tick = app.tick();
  const owned = g.s.items.filter((it) => it.s === skin.id);
  const price = priceAt(skin, tick);
  const mult = g.incomeMult(app.now());
  const news = recentNews(tick, 14).filter((n) => n.scope === 'all' || (n.scope === 'crate' && n.target === skin.crate) || (n.scope === 'class' && n.target === WEAPONS[skin.weapon].cls)).slice(0, 4);
  const modal = app.openModal(`
    <div class="sheet skin r${skin.rarity}">
      <button class="x" data-act="close" aria-label="Close">${ICON.close}</button>
      <div class="crate-top">
        <div class="stage stage-sm"><canvas class="live" id="sk-cv"></canvas></div>
        <div class="crate-info">
          ${rarityStamp(skin.rarity)}
          <h2><small>${esc(WEAPONS[skin.weapon].name)}</small>${esc(skin.name)}</h2>
          <span class="from">${esc(CRATE_BY_ID[skin.crate].name)} · Market day ${dayNo(tick)}</span>
          <div class="px"><span class="cr big" id="sk-price">${fmt(price)}</span><span id="sk-change"></span></div>
        </div>
      </div>
      <div class="seg sm">${RANGES.map((r, i) => `<button class="${i === 0 ? 'on' : ''}" data-act="sk-range" data-i="${i}">${r[0]}</button>`).join('')}</div>
      <canvas class="chart" id="sk-chart"></canvas>
      <div class="kpis" id="sk-stats"></div>
      <h3>Price by condition</h3>
      <div class="cond">${WEARS.map((w, i) => {
        const mid = ((i === 0 ? 0 : WEARS[i - 1].max) + Math.min(1, w.max)) / 2;
        return `<div><b class="wear w${i}">${w.short}</b><span>${w.name}</span>${cr(price * wearValue(mid))}<span class="gain">+${fmtRate((skin.base / RARITIES[skin.rarity].payback) * w.income * mult)}/s</span></div>`;
      }).join('')}</div>
      <h3>In your Armory <span class="count">${owned.length} owned</span></h3>
      ${owned.length ? `<div class="grid">${owned.map((it) => tag(app, it, { act: 'item' })).join('')}</div>` : `<p class="fine">You do not own this skin yet. It drops from the ${esc(CRATE_BY_ID[skin.crate].name)}.</p>`}
      ${news.length ? `<h3>Recent news touching this skin</h3><ul class="wire">${news.map((n) => `<li><span class="wire-d">Day ${(n.day - DAY0).toLocaleString('en-US')}</span><span class="wire-t">${esc(n.headline)}</span><span class="${n.move >= 0 ? 'up' : 'down'}">${fmtPct(n.move * 100, 0)}</span></li>`).join('')}</ul>` : ''}
    </div>`, { cls: 'center', onClose: () => { if (skinOpen?.modal === modal) skinOpen = null; } });
  skinOpen = { skin, modal, range: 0 };
  app.mountLive(modal.querySelector<HTMLCanvasElement>('#sk-cv')!, specForSkin(skin), { bg: true, tint: RARITIES[skin.rarity].color });
  drawSkinChart(app);
}

function openListing(app: App, l: Listing): void {
  const g = app.game;
  const price = g.listingPrice(l, app.now());
  const it = { s: l.skin.id, w: l.wear, p: l.pattern, sn: l.serial };
  const market = valueOf(it, app.tick());
  const why = g.free < 1 ? 'Armory full' : g.s.cash < price ? 'Not enough credits' : '';
  const m = app.openModal(`
    <div class="sheet item r${l.skin.rarity}">
      <button class="x" data-act="close" aria-label="Close">${ICON.close}</button>
      <div class="stage"><canvas class="live" id="ls-cv"></canvas></div>
      <div class="item-head">
        ${rarityStamp(l.skin.rarity)}
        <h2><small>${esc(WEAPONS[l.skin.weapon].name)}</small>${esc(l.skin.name)}</h2>
        <span class="from">Listed ${fmtPct((l.markup - 1) * 100, 0)} over market (${fmt(market)})</span>
      </div>
      <div class="facts">${itemFacts(app, it)}</div>
      <div class="row-btns wrap">
        <button class="btn" data-act="ls-buy" data-l="${l.id}" ${why ? 'disabled' : ''}>${why || `Buy for ${fmt(price)}`}</button>
        <button class="btn ghost" data-act="skin" data-skin="${l.skin.id}">Price history</button>
      </div>
    </div>`, { cls: 'center' });
  app.mountLive(m.querySelector<HTMLCanvasElement>('#ls-cv')!, { weapon: l.skin.weapon, skin: l.skin, wear: l.wear, pattern: l.pattern }, { bg: true, tint: RARITIES[l.skin.rarity].color });
}

export const marketTab: TabDef = {
  id: 'market',
  label: 'Exchange',
  render(app) {
    const st = app.ui.market;
    const tick = app.tick();
    lastBucket = Math.floor(tick / LISTING_TICKS);
    const ix = exchangeIndex(tick);
    const ixDay = (ix / exchangeIndex(tick - DAY_TICKS) - 1) * 100;
    const body = st.sub === 'skins' ? skinsList(app, tick) : st.sub === 'listings' ? listings(app, tick) : st.sub === 'sell' ? sellList(app, tick) : overview(app, tick);
    return `
      <div class="page-head">
        <h1>Exchange</h1>
        <div class="kpis">
          <span><i>Index</i><b id="mk-ix">${ix.toFixed(1)}</b></span>
          <span><i>Today</i><b id="mk-day">${upDown(ixDay)}</b></span>
          <span><i>Market day</i><b>${dayNo(tick)}</b></span>
          <span><i>Your fee</i><b>${Math.round(app.game.fee * 100)}%</b></span>
        </div>
      </div>
      <div class="seg">${SUBS.map(([k, l]) => `<button class="${st.sub === k ? 'on' : ''}" data-act="mk-sub" data-k="${k}">${l}</button>`).join('')}</div>
      ${body}`;
  },
  mounted(app) {
    if (app.ui.market.sub === 'overview') drawIndex(app);
  },
  live(app, tickChanged) {
    const st = app.ui.market;
    const tick = app.tick();
    if (st.sub === 'listings') {
      const el = app.view.querySelector('#ls-left');
      if (el) el.textContent = fmtTime((LISTING_TICKS - (tick % LISTING_TICKS)) * (TICK_MS / 1000) - ((app.now() % TICK_MS) / 1000));
      if (Math.floor(tick / LISTING_TICKS) !== lastBucket) app.refresh();
    }
    if (!tickChanged) return;
    const ix = exchangeIndex(tick);
    const a = app.view.querySelector('#mk-ix');
    if (a) a.textContent = ix.toFixed(1);
    const b = app.view.querySelector('#mk-day');
    if (b) b.innerHTML = upDown((ix / exchangeIndex(tick - DAY_TICKS) - 1) * 100);
    if (st.sub === 'overview') drawIndex(app);
    else if (st.sub === 'skins') {
      const rows = app.view.querySelector('#mk-rows');
      if (rows) rows.innerHTML = rowsHtml(app, tick);
    }
    drawSkinChart(app);
  },
  actions: {
    'mk-sub': (app, d) => {
      app.ui.market.sub = d.k!;
      app.sfx.click();
      app.view.scrollTop = 0;
      app.refresh();
    },
    'mk-range': (app, d) => {
      app.ui.market.range = Number(d.i);
      app.sfx.click();
      app.refresh();
    },
    'mk-crate': (app, d) => {
      app.ui.market.crate = d.c || '';
      app.sfx.click();
      app.refresh();
    },
    'mk-sort': (app, d) => {
      app.ui.market.sort = d.k!;
      app.sfx.click();
      app.refresh();
    },
    skin: (app, d) => {
      const skin = SKINS[d.skin!];
      if (!skin) return;
      app.sfx.click();
      openSkin(app, skin);
    },
    'sk-range': (app, d, el) => {
      if (!skinOpen) return;
      skinOpen.range = Number(d.i);
      for (const b of el.parentElement!.children) b.classList.toggle('on', b === el);
      app.sfx.click();
      drawSkinChart(app);
    },
    'ls-view': (app, d) => {
      const l = listingsAt(app.tick(), app.game.s.rank).find((x) => x.id === d.l);
      if (!l) return;
      app.sfx.click();
      openListing(app, l);
    },
    'ls-buy': (app, d) => {
      const l = listingsAt(app.tick(), app.game.s.rank).find((x) => x.id === d.l);
      const it = l ? app.game.buyListing(l, app.now()) : null;
      if (!it) {
        app.toast({ kind: 'bad', text: 'That listing is gone' });
        app.sfx.error();
      } else {
        app.sfx.buy();
        app.toast({ kind: 'good', text: 'Bought. It is on your racks.' });
        app.touch();
      }
      app.closeModal();
      app.refresh();
    },
    'mk-sell': (app, d) => {
      const got = app.game.sell([Number(d.id)], app.now());
      if (got > 0) {
        app.sfx.sell();
        app.toast({ kind: 'good', text: `Sold for ${fmt(got)} credits` });
        app.touch();
      }
      app.refresh();
    },
    'mk-bulk': (app, d) => {
      const g = app.game;
      const ids = g.s.items.filter((it) => !it.lock && (d.k === 'low' ? SKINS[it.s].rarity <= 1 : it.w >= 0.42)).map((it) => it.id);
      const got = g.sell(ids, app.now());
      if (got > 0) {
        app.sfx.sell();
        app.toast({ kind: 'good', text: `Sold ${ids.length} items for ${fmt(got)} credits` });
        app.touch();
      }
      app.refresh();
    },
  },
  inputs: {
    'mk-q': (app, v) => {
      app.ui.market.q = v;
      const rows = app.view.querySelector('#mk-rows');
      if (rows) rows.innerHTML = rowsHtml(app, app.tick());
    },
  },
};

export { indexAt };
