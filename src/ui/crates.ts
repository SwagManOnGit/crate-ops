// Crates tab: supply drops, the crate shelf, crate contents and the opening sequence.
import { BULK_STEPS, CRATES, CRATE_BY_ID, RARITIES, SKINS, WEAPONS, rankName, type CrateDef } from '../data';
import { incomeOf, patternGrade, valueOf, type Item, type Mission } from '../game';
import { specFor } from '../render';
import * as sdk from '../sdk';
import type { App, TabDef } from './app';
import { itemFacts, rarityStamp, tag } from './parts';
import { ICON, cr, esc, fmt, fmtRate, fmtTime, wait } from './util';

const CELLS = 46;
const WIN_AT = 40;
let qty = 1;
let lastSig = '';

interface Session {
  crate: CrateDef;
  items: Item[];
  n: number;
  free: boolean;
  modal: HTMLElement;
  marked: Set<number>;
  skip: boolean;
}
let cur: Session | null = null;

function directive(app: App, m: Mission): string {
  const [c, goal] = m.prog(app.game);
  const done = c >= goal;
  return `<button class="directive${done ? ' done' : ''}" data-act="${done ? 'claim-mission' : 'go'}" data-tab="hq" data-id="${m.id}">
    <span class="dir-main"><span class="dir-k">${done ? 'Directive complete' : 'Current directive'}</span><b>${esc(m.text)}</b></span>
    <span class="dir-side">${done ? '<span class="btn sm">Claim</span>' : `<span class="dir-n">${fmt(Math.min(c, goal)).replace(/\.00$/, '')} / ${fmt(goal).replace(/\.00$/, '')}</span>`}${cr(m.reward)}</span>
    <span class="dir-prog"><i style="width:${Math.min(100, (c / goal) * 100).toFixed(1)}%"></i></span>
  </button>`;
}

function crateCard(app: App, c: CrateDef): string {
  const g = app.game;
  const locked = !g.crateUnlocked(c);
  const poor = !locked && g.s.cash < c.price;
  return `<button class="crate${locked ? ' locked' : ''}${poor ? ' poor' : ''}" data-act="crate" data-crate="${c.id}" style="--cc:${c.paint[1]}">
    <span class="crate-mark">${c.mark}</span>
    ${app.imgCrate(c, 'crate-img')}
    <span class="crate-name">${esc(c.name)}</span>
    ${locked ? `<span class="crate-lock">${ICON.lock} Rank ${c.rank}</span>` : `<span class="crate-price">${cr(c.price)}</span>`}
  </button>`;
}

function sig(app: App): string {
  const g = app.game;
  const m = g.activeMissions(1)[0];
  const prog = m ? m.prog(g) : [0, 0];
  return [g.s.rank, m?.id, Math.min(prog[0], prog[1]), CRATES.map((c) => (g.s.cash >= c.price ? 1 : 0)).join('')].join('|');
}

function effectiveOdds(app: App, c: CrateDef): { r: number; pct: number }[] {
  const luck = app.game.lvl('luck');
  const w = c.odds.map((x, r) => (c.skins.some((s) => s.rarity === r) ? (r >= 3 ? x * (1 + 0.06 * luck) : x) : 0));
  const total = w.reduce((a, b) => a + b, 0);
  return w.map((x, r) => ({ r, pct: (x / total) * 100 })).filter((o) => o.pct > 0);
}

function openCrateSheet(app: App, c: CrateDef): void {
  const g = app.game;
  qty = Math.min(qty, g.bulkMax);
  const skins = [...c.skins].sort((a, b) => b.rarity - a.rarity || b.base - a.base);
  const found = new Set(g.s.found);
  const m = app.openModal(`
    <div class="sheet crate-sheet" style="--cc:${c.paint[1]}">
      <button class="x" data-act="close" aria-label="Close">${ICON.close}</button>
      <div class="crate-top">
        <div class="stage stage-sm"><canvas class="live" id="crate-cv"></canvas></div>
        <div class="crate-info">
          <span class="crate-mark">${c.mark}</span>
          <h2>${esc(c.name)}</h2>
          <p class="lead">${esc(c.blurb)}</p>
          <div class="odds">${effectiveOdds(app, c).map((o) => `<span class="odd r${o.r}"><i></i>${RARITIES[o.r].name}<b>${o.pct < 1 ? o.pct.toFixed(2) : o.pct.toFixed(1)}%</b></span>`).join('')}</div>
        </div>
      </div>
      <h3>Inside this crate <span class="count">${skins.filter((s) => found.has(s.id)).length} of ${skins.length} found</span></h3>
      <div class="contents">${skins.map((s) => `
        <button class="mini r${s.rarity}${found.has(s.id) ? '' : ' unseen'}" data-act="skin" data-skin="${s.id}">
          ${app.imgSkin(s, 'mini-img')}
          <span><b>${esc(WEAPONS[s.weapon].name)}</b>${esc(s.name)}</span>
        </button>`).join('')}</div>
      <div class="openbar">
        <div class="qty" role="group" aria-label="How many to open">${BULK_STEPS.map((n) => `<button class="chip${n === qty ? ' on' : ''}" data-act="qty" data-n="${n}" ${n > g.bulkMax ? 'disabled title="Upgrade Bulk Unpacking at HQ"' : ''}>x${n}</button>`).join('')}</div>
        <label class="check"><input type="checkbox" data-input="fast" ${g.s.fast ? 'checked' : ''}> Skip the spin</label>
        <button class="btn big" id="open-btn" data-act="open" data-crate="${c.id}">Open for ${fmt(c.price * qty)}</button>
      </div>
    </div>`, { cls: 'center' });
  app.mountLive(m.querySelector<HTMLCanvasElement>('#crate-cv')!, app.crateSpec(c));
}

// ------------------------------------------------------------ opening sequence

function stripHtml(app: App, crate: CrateDef, won: Item, i: number): string {
  let cells = '';
  for (let k = 0; k < CELLS; k++) {
    const s = k === WIN_AT ? SKINS[won.s] : SKINS[app.game.sample(crate, 0, 0).s];
    cells += `<div class="cell r${s.rarity}${k === WIN_AT ? ' target' : ''}">${app.imgSkin(s, 'cell-img')}</div>`;
  }
  return `<div class="strip" data-i="${i}"><div class="strip-track">${cells}</div><i class="strip-mark"></i></div>`;
}

function revealHtml(app: App, s: Session): string {
  const g = app.game;
  const it = s.items[0];
  const skin = SKINS[it.s];
  const value = valueOf(it, app.tick());
  const again = s.free ? '' : `<button class="btn ghost" data-act="rv-again">Open another · ${fmt(s.crate.price)}</button>`;
  return `<div class="reveal r${skin.rarity}">
      <div class="rays" aria-hidden="true"></div>
      <div class="stage stage-rv"><canvas class="live" id="rv-cv"></canvas></div>
      <div class="rv-info">
        ${rarityStamp(skin.rarity)}
        <h2><small>${esc(WEAPONS[skin.weapon].name)}</small>${esc(skin.name)}</h2>
        <div class="facts">${itemFacts(app, it)}</div>
        <div class="rv-val">${cr(value, 'big')}<span class="gain">+${fmtRate(incomeOf(it) * g.incomeMult(app.now()))} / sec</span></div>
      </div>
      <div class="row-btns">
        <button class="btn ghost" data-act="rv-sell">Sell · ${fmt(value * (1 - g.fee))}</button>
        <button class="btn" data-act="rv-keep">Keep</button>
        ${again}
      </div>
    </div>`;
}

function summaryHtml(app: App, s: Session): string {
  const g = app.game;
  const tick = app.tick();
  const live = s.items.filter((it) => g.item(it.id));
  const total = live.reduce((a, it) => a + valueOf(it, tick), 0);
  const marked = live.filter((it) => s.marked.has(it.id));
  const markedVal = marked.reduce((a, it) => a + valueOf(it, tick) * (1 - g.fee), 0);
  const again = s.free ? '' : `<button class="btn ghost" data-act="rv-again">Open x${s.n} again · ${fmt(s.crate.price * s.n)}</button>`;
  return `<div class="summary">
      <h2>${live.length} drops <span class="count">worth ${fmt(total)} against ${fmt(s.crate.price * s.n)} spent</span></h2>
      <p class="lead">Tap the ones you want to sell. Everything else goes to the Armory.</p>
      <div class="grid">${[...live].sort((a, b) => valueOf(b, tick) - valueOf(a, tick)).map((it) => tag(app, it, { act: 'rv-mark', picked: s.marked.has(it.id) })).join('')}</div>
      <div class="row-btns">
        <button class="btn ghost" data-act="rv-sellmarked" ${marked.length ? '' : 'disabled'}>Sell ${marked.length} marked · ${fmt(markedVal)}</button>
        <button class="btn" data-act="rv-keep">Keep the rest</button>
        ${again}
      </div>
    </div>`;
}

function showResults(app: App, s: Session): void {
  const box = s.modal.querySelector<HTMLElement>('.modal-box')!;
  delete s.modal.dataset.locked;
  const best = s.items.reduce((a, it) => Math.max(a, SKINS[it.s].rarity), 0);
  app.sfx.reveal(best);
  if (s.items.length === 1) {
    box.innerHTML = revealHtml(app, s);
    const it = s.items[0];
    app.mountLive(box.querySelector<HTMLCanvasElement>('#rv-cv')!, specFor(it, patternGrade(SKINS[it.s], it.p) === 2));
  } else {
    box.innerHTML = summaryHtml(app, s);
  }
  app.refresh();
}

async function runOpening(app: App, crate: CrateDef, items: Item[], free: boolean): Promise<void> {
  const seq = ++app.seq;
  const fast = app.game.s.fast || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const n = items.length;
  const sh = Math.max(50, Math.min(150, Math.floor((window.innerHeight - 190) / n) - 8));
  const modal = app.openModal(`
    <div class="unbox" style="--sh:${sh}px;--cc:${crate.paint[1]}">
      <div class="unbox-head"><span class="crate-mark">${crate.mark}</span><b>${esc(crate.name)}</b>${n > 1 ? `<span>x${n}</span>` : ''}${free ? '<span>Free drop</span>' : ''}</div>
      <div class="strips">${fast ? '' : items.map((it, i) => stripHtml(app, crate, it, i)).join('')}</div>
      <button class="btn ghost sm" data-act="unbox-skip">Skip</button>
    </div>`, { cls: 'full', locked: true, onClose: () => { if (cur && cur.modal === modal) cur = null; app.refresh(); } });
  const s: Session = { crate, items, n, free, modal, marked: new Set(), skip: false };
  cur = s;
  if (!fast) {
    app.sfx.latch();
    await wait(60);
    const tracks = [...modal.querySelectorAll<HTMLElement>('.strip-track')];
    const finals: number[] = [];
    let longest = 0;
    tracks.forEach((tr, i) => {
      const strip = tr.parentElement!;
      const a = tr.children[0] as HTMLElement;
      const b = tr.children[1] as HTMLElement;
      const pitch = b.offsetLeft - a.offsetLeft;
      const target = WIN_AT * pitch + pitch * (0.14 + Math.random() * 0.72) - strip.clientWidth / 2;
      const dur = 4200 + i * 360;
      longest = Math.max(longest, dur);
      finals.push(-target);
      tr.style.transition = `transform ${dur}ms cubic-bezier(0.07, 0.74, 0.1, 1)`;
      tr.style.transform = `translate3d(${-target}px,0,0)`;
    });
    // tick as cells pass the marker on the first strip
    const first = tracks[0];
    const pitch0 = (first.children[1] as HTMLElement).offsetLeft - (first.children[0] as HTMLElement).offsetLeft;
    const half = first.parentElement!.clientWidth / 2;
    let lastIdx = -1;
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const loop = (): void => {
        if (seq !== app.seq || !modal.isConnected) return resolve();
        const elapsed = performance.now() - t0;
        if (s.skip || elapsed > longest + 60) return resolve();
        const x = new DOMMatrixReadOnly(getComputedStyle(first).transform).m41;
        const idx = Math.floor((-x + half) / pitch0);
        if (idx !== lastIdx) {
          lastIdx = idx;
          app.sfx.tick(0.85 + Math.min(1, elapsed / longest) * 0.3);
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    if (seq !== app.seq || !modal.isConnected) {
      // interrupted (paused): jump straight to the result
      if (modal.isConnected) showResults(app, s);
      return;
    }
    tracks.forEach((tr, i) => {
      tr.style.transition = 'none';
      tr.style.transform = `translate3d(${finals[i]}px,0,0)`;
      tr.querySelector('.target')?.classList.add('won');
    });
    app.sfx.latch();
    await wait(s.skip ? 120 : 520);
    if (!modal.isConnected) return;
  }
  showResults(app, s);
}

function startOpen(app: App, crate: CrateDef, n: number): void {
  const g = app.game;
  const why = g.whyNotOpen(crate, n);
  if (why) {
    app.toast({ kind: 'bad', text: why });
    app.sfx.error();
    return;
  }
  const items = g.open(crate.id, n, app.now());
  if (!items.length) return;
  app.touch();
  app.closeAllModals();
  void runOpening(app, crate, items, false);
}

export const cratesTab: TabDef = {
  id: 'crates',
  label: 'Crates',
  badge: (app) => (app.game.freeReady(app.now()) ? 1 : 0),
  render(app) {
    const g = app.game;
    lastSig = sig(app);
    const m = g.activeMissions(1)[0];
    return `
      <div class="dropbar">
        <button class="drop" data-act="free-drop">${ICON.chute}<span><b>Supply drop</b><i data-live="free"></i></span></button>
        <button class="drop sponsor" data-act="ad-drop">${ICON.play}<span><b>Sponsored crate</b><i data-live="addrop"></i></span></button>
        <button class="drop sponsor" data-act="ad-boost">${ICON.bolt}<span><b>Double income</b><i>5 minutes</i></span></button>
      </div>
      ${m ? directive(app, m) : ''}
      <div class="crates">${CRATES.map((c) => crateCard(app, c)).join('')}</div>
      <p class="fine center">Every item you keep earns credits every second. Better rarity and better condition earn more.</p>`;
  },
  live(app) {
    if (sig(app) !== lastSig) app.refresh();
  },
  actions: {
    crate: (app, d) => {
      const c = CRATE_BY_ID[d.crate!];
      if (!app.game.crateUnlocked(c)) {
        app.toast({ kind: 'info', text: `${c.name} unlocks at Rank ${c.rank}`, sub: rankName(c.rank) });
        app.sfx.error();
        return;
      }
      app.sfx.click();
      openCrateSheet(app, c);
    },
    qty: (app, d, el) => {
      qty = Number(d.n);
      app.sfx.click();
      const sheet = el.closest('.sheet')!;
      for (const b of sheet.querySelectorAll<HTMLElement>('.qty .chip')) b.classList.toggle('on', Number(b.dataset.n) === qty);
      const btn = sheet.querySelector<HTMLElement>('#open-btn')!;
      btn.textContent = `Open for ${fmt(CRATE_BY_ID[btn.dataset.crate!].price * qty)}`;
    },
    open: (app, d) => startOpen(app, CRATE_BY_ID[d.crate!], qty),
    'free-drop': (app) => {
      const g = app.game;
      const now = app.now();
      if (!g.freeReady(now)) {
        app.toast({ kind: 'info', text: `Next supply drop in ${fmtTime((g.s.freeAt - now) / 1000)}` });
        return;
      }
      if (g.free < 1) {
        app.toast({ kind: 'bad', text: 'Armory full: sell items or add racks' });
        app.sfx.error();
        return;
      }
      const res = g.claimFree(now);
      if (!res) return;
      app.touch();
      void runOpening(app, res.crate, res.items, true);
    },
    'ad-drop': (app) => {
      const g = app.game;
      if (!g.adDropReady(app.now())) {
        app.toast({ kind: 'info', text: `Next sponsored crate in ${fmtTime((g.s.adAt - app.now()) / 1000)}` });
        return;
      }
      if (g.free < 1) {
        app.toast({ kind: 'bad', text: 'Armory full: sell items or add racks' });
        app.sfx.error();
        return;
      }
      void sdk.requestRewardedAd('sponsored_crate').then((ok) => {
        if (!ok) return;
        const res = g.claimAdDrop(app.now());
        if (!res) return;
        app.touch();
        void runOpening(app, res.crate, res.items, true);
      });
    },
    'ad-boost': (app) => {
      void sdk.requestRewardedAd('income_boost').then((ok) => {
        if (!ok) return;
        app.game.addBoost(app.now());
        app.sfx.upgrade();
        app.toast({ kind: 'good', text: 'Income doubled for 5 minutes' });
        app.touch();
      });
    },
    'unbox-skip': () => {
      if (cur) cur.skip = true;
    },
    'rv-keep': (app) => {
      app.sfx.click();
      if (cur) app.closeModal(cur.modal, true);
    },
    'rv-sell': (app) => {
      if (!cur) return;
      const got = app.game.sell([cur.items[0].id], app.now());
      if (got > 0) {
        app.sfx.sell();
        app.toast({ kind: 'good', text: `Sold for ${fmt(got)} credits` });
        app.touch();
      }
      app.closeModal(cur.modal, true);
    },
    'rv-mark': (app, d) => {
      if (!cur) return;
      const id = Number(d.id);
      if (cur.marked.has(id)) cur.marked.delete(id);
      else cur.marked.add(id);
      app.sfx.click();
      cur.modal.querySelector<HTMLElement>('.modal-box')!.innerHTML = summaryHtml(app, cur);
    },
    'rv-sellmarked': (app) => {
      if (!cur) return;
      const got = app.game.sell([...cur.marked], app.now());
      cur.marked.clear();
      if (got > 0) {
        app.sfx.sell();
        app.toast({ kind: 'good', text: `Sold for ${fmt(got)} credits` });
        app.touch();
      }
      if (cur.items.some((it) => app.game.item(it.id))) cur.modal.querySelector<HTMLElement>('.modal-box')!.innerHTML = summaryHtml(app, cur);
      else app.closeModal(cur.modal, true);
    },
    'rv-again': (app) => {
      if (!cur) return;
      const { crate, n } = cur;
      const why = app.game.whyNotOpen(crate, n);
      if (why) {
        app.toast({ kind: 'bad', text: why });
        app.sfx.error();
        return;
      }
      app.closeModal(cur.modal, true);
      startOpen(app, crate, n);
    },
  },
  inputs: {
    fast: (app, _v, el) => {
      app.game.s.fast = el.checked;
      app.touch();
    },
  },
};
