// Trade-Up tab: feed items into a contract and pick the risk with a slider.
// Riskier odds aim at a more valuable reward; a failed contract destroys the inputs.
import { RARITIES, SKINS, WEAPONS } from '../data';
import { TRADE_MAX, TRADE_MIN, TRADE_SLOTS, incomeOf, patternGrade, tradeChance, valueOf, type TradeResult } from '../game';
import { specFor } from '../render';
import type { App, TabDef } from './app';
import { itemFacts, rarityStamp, tag } from './parts';
import { cr, esc, fmt, fmtRate, wait } from './util';

const RING = 2 * Math.PI * 52;
const toMult = (v: number): number => TRADE_MIN * Math.pow(TRADE_MAX / TRADE_MIN, v / 1000);
const fromMult = (m: number): number => Math.round((Math.log(m / TRADE_MIN) / Math.log(TRADE_MAX / TRADE_MIN)) * 1000);

function inputs(app: App): { ids: number[]; value: number } {
  const g = app.game;
  const t = app.ui.trade;
  t.ids = t.ids.filter((id) => {
    const it = g.item(id);
    return it && !it.lock;
  });
  const tick = app.tick();
  return { ids: t.ids, value: t.ids.reduce((a, id) => a + valueOf(g.item(id)!, tick), 0) };
}

function gauge(chance: number, id = 'tr-arc', needle = false): string {
  return `<svg class="gauge" viewBox="0 0 120 120" aria-hidden="true">
    <circle class="g-fail" cx="60" cy="60" r="52"/>
    <circle class="g-win" id="${id}" cx="60" cy="60" r="52" stroke-dasharray="${(chance * RING).toFixed(2)} ${RING.toFixed(2)}" transform="rotate(-90 60 60)"/>
    ${needle ? '<g class="g-needle" id="tr-needle"><path d="M60 4 L65 20 L55 20 Z"/></g>' : ''}
  </svg>`;
}

/** Update the read-outs without re-rendering, so dragging the slider stays smooth. */
function sync(app: App): void {
  const root = app.view;
  const { value } = inputs(app);
  const mult = app.ui.trade.mult;
  const chance = tradeChance(mult);
  const set = (sel: string, html: string): void => {
    const el = root.querySelector(sel);
    if (el) el.innerHTML = html;
  };
  set('#tr-chance', `${(chance * 100).toFixed(chance < 0.1 ? 1 : 0)}%`);
  set('#tr-mult', `x${mult.toFixed(2)}`);
  set('#tr-target', value > 0 ? cr(value * mult) : '<span class="muted">add items first</span>');
  const band = value > 0 ? app.game.tradeBand(value * mult, app.now()) : [];
  set('#tr-band', band.length ? band.map((r) => `<span class="odd r${r}"><i></i>${RARITIES[r].name}</span>`).join('') : value > 0 ? '<span class="muted">Off the chart: you get the closest item available</span>' : '');
  root.querySelector('#tr-arc')?.setAttribute('stroke-dasharray', `${(chance * RING).toFixed(2)} ${RING.toFixed(2)}`);
  const riskEl = root.querySelector<HTMLElement>('.trade-risk');
  if (riskEl) riskEl.style.setProperty('--risk', String(1 - chance));
}

async function runContract(app: App, res: TradeResult): Promise<void> {
  const seq = ++app.seq;
  const fast = app.game.s.fast || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const modal = app.openModal(`
    <div class="contract">
      <div class="unbox-head"><b>Trade-Up contract</b><span>${(res.chance * 100).toFixed(res.chance < 0.1 ? 1 : 0)}% to succeed</span></div>
      <div class="contract-dial">${gauge(res.chance, 'ct-arc', true)}<div class="dial-read"><b id="ct-word">Signing</b><span>${res.lost.length} item${res.lost.length > 1 ? 's' : ''} on the line</span></div></div>
    </div>`, { cls: 'full', locked: true, onClose: () => app.refresh() });
  const needle = modal.querySelector<SVGGElement>('#tr-needle')!;
  const finalDeg = 360 * 5 + res.roll * 360;
  if (!fast) {
    const dur = 3600;
    app.sfx.whirr(dur / 1000);
    needle.style.transition = `transform ${dur}ms cubic-bezier(0.12, 0.6, 0.08, 1)`;
    await wait(40);
    needle.style.transform = `rotate(${finalDeg}deg)`;
    await wait(dur + 250);
  } else {
    needle.style.transform = `rotate(${finalDeg}deg)`;
    await wait(250);
  }
  if (!modal.isConnected) return;
  if (seq !== app.seq) needle.style.transition = 'none';
  const box = modal.querySelector<HTMLElement>('.modal-box')!;
  delete modal.dataset.locked;
  if (res.ok && res.item) {
    const it = res.item;
    const skin = SKINS[it.s];
    const value = valueOf(it, app.tick());
    app.sfx.reveal(Math.max(3, skin.rarity));
    box.innerHTML = `<div class="reveal r${skin.rarity}">
        <div class="rv-bg" aria-hidden="true" style="background-image:url(bg/armory.webp)"></div>
        <div class="stage stage-rv"><canvas class="live" id="rv-cv"></canvas><span class="stage-hint">Drag to turn it</span></div>
        <div class="rv-info">
          <span class="verdict good">Contract honoured</span>
          ${rarityStamp(skin.rarity)}
          <h2><small>${esc(WEAPONS[skin.weapon].name)}</small>${esc(skin.name)}</h2>
          <div class="facts">${itemFacts(app, it)}</div>
          <div class="rv-val">${cr(value, 'big')}<span class="gain">+${fmtRate(incomeOf(it) * app.game.incomeMult(app.now()))} / sec</span></div>
          <p class="fine">You put in ${fmt(res.value)} and aimed for ${fmt(res.target)}.</p>
        </div>
        <div class="row-btns"><button class="btn" data-act="close">Take it to the Armory</button></div>
      </div>`;
    app.mountLive(box.querySelector<HTMLCanvasElement>('#rv-cv')!, specFor(it, patternGrade(skin, it.p) === 2), { bg: true, tint: RARITIES[skin.rarity].color });
  } else {
    app.sfx.smash();
    box.innerHTML = `<div class="reveal failed">
        <div class="rv-info">
          <span class="verdict bad">Contract failed</span>
          <h2><small>${res.lost.length} item${res.lost.length > 1 ? 's' : ''} destroyed</small>${fmt(res.value)} credits gone</h2>
          <p class="lead">The needle stopped at ${(res.roll * 100).toFixed(1)}. You needed under ${(res.chance * 100).toFixed(1)}.</p>
          <div class="wreck">${res.lost.map((it) => tag(app, { s: it.s, w: it.w, p: it.p, sn: it.sn }, { noIncome: true })).join('')}</div>
        </div>
        <div class="row-btns"><button class="btn" data-act="close">Back to contracts</button></div>
      </div>`;
  }
  app.refresh();
}

export const tradeTab: TabDef = {
  id: 'trade',
  label: 'Trade-Up',
  locked: (app) => (app.game.s.rank < 2 ? 'Trade-Ups unlock at Rank 2' : null),
  render(app) {
    const g = app.game;
    const t = app.ui.trade;
    const { ids, value } = inputs(app);
    const tick = app.tick();
    const chance = tradeChance(t.mult);
    const pool = g.s.items.filter((it) => !it.lock && !ids.includes(it.id)).sort((a, b) => valueOf(b, tick) - valueOf(a, tick));
    const slots = Array.from({ length: TRADE_SLOTS }, (_, i) => {
      const it = ids[i] !== undefined ? g.item(ids[i]) : undefined;
      return it ? tag(app, it, { act: 'tr-remove', noIncome: true }) : '<span class="slot" aria-hidden="true"></span>';
    }).join('');
    return `
      <div class="page-head">
        <h1>Trade-Up</h1>
        <p class="lead">Put items into a contract, then choose your odds. Push the slider toward risk and a win pays out something far better, but a failed contract destroys every item you put in.</p>
      </div>
      <div class="trade">
        <section class="panel trade-in">
          <div class="panel-h"><b>On the table</b><span>${ids.length} of ${TRADE_SLOTS} · worth ${cr(value)}</span></div>
          <div class="slots">${slots}</div>
          ${ids.length ? '<button class="btn ghost sm" data-act="tr-clear">Clear the table</button>' : '<p class="fine">Tap items below to add them. Vaulted items stay out of contracts.</p>'}
        </section>
        <section class="panel trade-risk" style="--risk:${1 - chance}">
          <div class="dial">${gauge(chance)}<div class="dial-read"><b id="tr-chance"></b><span>chance to succeed</span></div></div>
          <label class="risk">
            <span class="risk-ends"><span>Safer</span><b id="tr-mult"></b><span>Riskier</span></span>
            <input type="range" min="0" max="1000" step="1" value="${fromMult(t.mult)}" data-input="tr-mult" aria-label="Risk">
          </label>
          <div class="outcomes">
            <div><span>If it works you get an item worth about</span><b id="tr-target"></b><div class="odds" id="tr-band"></div></div>
            <div><span>If it fails</span><b class="down">every item on the table is destroyed</b></div>
          </div>
          <button class="btn big" data-act="tr-go" ${ids.length ? '' : 'disabled'}>Sign the contract</button>
        </section>
      </div>
      <section class="panel">
        <div class="panel-h"><b>Your Armory</b><span>${pool.length} available</span></div>
        ${pool.length ? `<div class="grid">${pool.map((it) => tag(app, it, { act: 'tr-add', noIncome: true })).join('')}</div>` : '<div class="empty"><b>Nothing left to add</b><span>Open more crates, or take items out of the vault.</span></div>'}
      </section>`;
  },
  mounted: (app) => sync(app),
  live(app, tick) {
    if (tick) sync(app);
  },
  actions: {
    'tr-add': (app, d) => {
      const t = app.ui.trade;
      if (t.ids.length >= TRADE_SLOTS) {
        app.toast({ kind: 'info', text: `A contract holds ${TRADE_SLOTS} items` });
        app.sfx.error();
        return;
      }
      t.ids.push(Number(d.id));
      app.sfx.click();
      app.refresh();
    },
    'tr-remove': (app, d) => {
      const t = app.ui.trade;
      t.ids = t.ids.filter((id) => id !== Number(d.id));
      app.sfx.click();
      app.refresh();
    },
    'tr-clear': (app) => {
      app.ui.trade.ids = [];
      app.refresh();
    },
    'tr-go': (app) => {
      const { ids } = inputs(app);
      if (!ids.length) return;
      const res = app.game.tradeUp(ids, app.ui.trade.mult, app.now());
      if (!res) return;
      app.ui.trade.ids = [];
      app.touch();
      void runContract(app, res);
    },
  },
  inputs: {
    'tr-mult': (app, v) => {
      app.ui.trade.mult = toMult(Number(v));
      sync(app);
    },
  },
};
