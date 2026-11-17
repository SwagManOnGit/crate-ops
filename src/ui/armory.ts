// Armory tab: everything the player owns, with sorting, filtering and bulk selection.
import { RARITIES, SKINS } from '../data';
import { incomeOf, valueOf, type Item } from '../game';
import type { App, TabDef } from './app';
import { tag } from './parts';
import { cr, fmt } from './util';

const SORTS: [string, string][] = [['new', 'Newest'], ['value', 'Value'], ['rarity', 'Rarity'], ['wear', 'Condition'], ['income', 'Income']];

function sorted(app: App): Item[] {
  const st = app.ui.armory;
  const tick = app.tick();
  let list = app.game.s.items.slice();
  if (st.rarity >= 0) list = list.filter((it) => SKINS[it.s].rarity === st.rarity);
  switch (st.sort) {
    case 'value': list.sort((a, b) => valueOf(b, tick) - valueOf(a, tick)); break;
    case 'rarity': list.sort((a, b) => SKINS[b.s].rarity - SKINS[a.s].rarity || valueOf(b, tick) - valueOf(a, tick)); break;
    case 'wear': list.sort((a, b) => a.w - b.w); break;
    case 'income': list.sort((a, b) => incomeOf(b) - incomeOf(a)); break;
    default: list.sort((a, b) => b.id - a.id);
  }
  return list;
}

function pickedInfo(app: App): { ids: number[]; value: number } {
  const g = app.game;
  const tick = app.tick();
  const ids: number[] = [];
  let value = 0;
  for (const id of app.ui.armory.picked) {
    const it = g.item(id);
    if (!it || it.lock) continue;
    ids.push(id);
    value += valueOf(it, tick) * (1 - g.fee);
  }
  return { ids, value };
}

export const armoryTab: TabDef = {
  id: 'armory',
  label: 'Armory',
  render(app) {
    const g = app.game;
    const st = app.ui.armory;
    for (const id of [...st.picked]) if (!g.item(id)) st.picked.delete(id);
    const list = sorted(app);
    const present = new Set(g.s.items.map((it) => SKINS[it.s].rarity));
    const pk = pickedInfo(app);
    const body = g.s.items.length
      ? `<div class="grid">${list.map((it) => tag(app, it, { act: st.select ? 'arm-pick' : 'item', picked: st.select && st.picked.has(it.id) })).join('')}</div>`
      : `<div class="empty"><b>The racks are empty</b><span>Open a crate and whatever you keep starts earning here.</span><button class="btn" data-act="go" data-tab="crates">Go to crates</button></div>`;
    return `
      <div class="page-head">
        <h1>Armory</h1>
        <div class="kpis">
          <span><i>Racks</i><b data-live="cap"></b></span>
          <span><i>Worth</i><b class="cr" data-live="invval"></b></span>
          <span><i>Earning</i><b class="gain"><span data-live="inc"></span>/s</b></span>
        </div>
      </div>
      <div class="toolbar">
        <div class="chips">${SORTS.map(([k, label]) => `<button class="chip${st.sort === k ? ' on' : ''}" data-act="arm-sort" data-k="${k}">${label}</button>`).join('')}</div>
        <div class="chips">
          <button class="chip${st.rarity < 0 ? ' on' : ''}" data-act="arm-rar" data-r="-1">All</button>
          ${RARITIES.map((r, i) => (present.has(i) ? `<button class="chip rc r${i}${st.rarity === i ? ' on' : ''}" data-act="arm-rar" data-r="${i}"><i></i>${r.name}</button>` : '')).join('')}
          <button class="chip tool${st.select ? ' on' : ''}" data-act="arm-select">${st.select ? 'Done selecting' : 'Select several'}</button>
        </div>
      </div>
      ${body}
      ${st.select ? `<div class="selbar">
          <span><b>${pk.ids.length}</b> selected<span class="muted"> · ${cr(pk.value)} after fees</span></span>
          <span class="row-btns">
            <button class="btn ghost sm" data-act="arm-all">Select shown</button>
            <button class="btn ghost sm" data-act="arm-trade" ${pk.ids.length && pk.ids.length <= 10 ? '' : 'disabled'}>Trade up</button>
            <button class="btn sm" data-act="arm-sell" ${pk.ids.length ? '' : 'disabled'}>Sell selected</button>
          </span>
        </div>` : ''}`;
  },
  actions: {
    'arm-sort': (app, d) => {
      app.ui.armory.sort = d.k!;
      app.sfx.click();
      app.refresh();
    },
    'arm-rar': (app, d) => {
      app.ui.armory.rarity = Number(d.r);
      app.sfx.click();
      app.refresh();
    },
    'arm-select': (app) => {
      const st = app.ui.armory;
      st.select = !st.select;
      if (!st.select) st.picked.clear();
      app.sfx.click();
      app.refresh();
    },
    'arm-pick': (app, d) => {
      const st = app.ui.armory;
      const id = Number(d.id);
      const it = app.game.item(id);
      if (it?.lock) {
        app.toast({ kind: 'info', text: 'That item is in the vault' });
        return;
      }
      if (st.picked.has(id)) st.picked.delete(id);
      else st.picked.add(id);
      app.sfx.click();
      app.refresh();
    },
    'arm-all': (app) => {
      const st = app.ui.armory;
      const shown = sorted(app).filter((it) => !it.lock);
      const all = shown.every((it) => st.picked.has(it.id));
      for (const it of shown) {
        if (all) st.picked.delete(it.id);
        else st.picked.add(it.id);
      }
      app.refresh();
    },
    'arm-trade': (app) => {
      const pk = pickedInfo(app);
      app.ui.trade.ids = pk.ids.slice(0, 10);
      app.ui.armory.select = false;
      app.ui.armory.picked.clear();
      app.go('trade');
    },
    'arm-sell': (app) => {
      const pk = pickedInfo(app);
      if (!pk.ids.length) return;
      const m = app.openModal(`
        <div class="sheet sheet-sm">
          <h2>Sell ${pk.ids.length} item${pk.ids.length > 1 ? 's' : ''}?</h2>
          <p class="lead">They leave the Armory for good and stop earning.</p>
          <div class="bignum">${cr(pk.value)}</div>
          <div class="row-btns">
            <button class="btn ghost" data-act="close">Keep them</button>
            <button class="btn" data-act="arm-sell-yes">Sell</button>
          </div>
        </div>`, { cls: 'center' });
      app.addActions({
        'arm-sell-yes': (a) => {
          const got = a.game.sell(pickedInfo(a).ids, a.now());
          a.ui.armory.picked.clear();
          a.ui.armory.select = false;
          a.closeModal(m, true);
          if (got > 0) {
            a.sfx.sell();
            a.toast({ kind: 'good', text: `Sold for ${fmt(got)} credits` });
            a.touch();
          }
          a.refresh();
        },
      });
    },
  },
};
