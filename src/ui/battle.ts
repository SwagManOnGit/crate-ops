// Crate Battles tab: the player and 1-3 rival operators open the same crates;
// the best (or, in underdog mode, the worst) haul takes every item on the table.
import { CRATES, CRATE_BY_ID, SKINS } from '../data';
import type { BattleResult } from '../game';
import type { App, TabDef } from './app';
import { tag } from './parts';
import { cellUnderMarker, land, reelHtml, spin, type Spin } from './reel';
import { cr, esc, fmt, wait } from './util';

/** Battle reels are shorter than the crate-opening one: there is one per player, every round. */
const REEL_CELLS = 32;
const REEL_WIN = 27;
let skipping = false;

async function runBattle(app: App, res: BattleResult): Promise<void> {
  const seq = ++app.seq;
  skipping = false;
  const crate = CRATE_BY_ID[res.crate];
  const fast = app.game.s.fast || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const P = res.names.length;
  const modal = app.openModal(`
    <div class="arena p${P}" style="--cc:${crate.paint[1]}">
      <div class="unbox-head"><span class="crate-mark">${crate.mark}</span><b>${esc(crate.name)}</b><span>Round <i id="bt-round">1</i> of ${res.rounds}</span><span>${res.mode === 'high' ? 'Highest total wins' : 'Lowest total wins'}</span>${fast ? '' : '<button class="btn ghost sm arena-skip" id="bt-skip" data-act="bt-skip">Skip</button>'}</div>
      <div class="lanes">${res.names.map((n, p) => `
        <div class="lane${p === 0 ? ' you' : ''}" data-p="${p}">
          <div class="lane-head"><b>${esc(n)}</b><span class="cr" id="bt-t${p}">0.00</span></div>
          <div class="lane-reel"></div>
          <div class="lane-pulls"></div>
        </div>`).join('')}</div>
      <div class="arena-foot" id="bt-foot"></div>
    </div>`, { cls: 'full', locked: true, onClose: () => app.refresh() });
  const lanes = [...modal.querySelectorAll<HTMLElement>('.lane')];
  const reels = lanes.map((l) => l.querySelector<HTMLElement>('.lane-reel')!);
  const totals = res.names.map(() => 0);
  const alive = (): boolean => modal.isConnected;
  const hurry = (): boolean => fast || skipping || seq !== app.seq;
  const lead = (): void => {
    let best = 0;
    for (let p = 1; p < P; p++) if (res.mode === 'high' ? totals[p] > totals[best] : totals[p] < totals[best]) best = p;
    lanes.forEach((l, p) => l.classList.toggle('lead', p === best));
  };
  /** Put a pull on a player's pile and update their total. */
  const deal = (r: number, p: number, loud: boolean): void => {
    const pull = res.pulls[r][p];
    const holder = lanes[p].querySelector('.lane-pulls')!;
    const wrap = document.createElement('div');
    wrap.className = 'pull';
    wrap.innerHTML = tag(app, { s: pull.s, w: pull.w, p: pull.p, sn: pull.sn }, { price: pull.value, noIncome: true });
    holder.appendChild(wrap);
    holder.scrollTop = holder.scrollHeight;
    totals[p] += pull.value;
    const t = modal.querySelector(`#bt-t${p}`);
    if (t) t.textContent = fmt(totals[p]);
    lead();
    if (loud) {
      app.sfx.stop();
      app.sfx.cue(SKINS[pull.s].rarity);
    }
  };

  await wait(hurry() ? 50 : 450);
  // rivals stop first, the player last
  const order = [...Array.from({ length: P - 1 }, (_, i) => i + 1), 0];
  for (let r = 0; r < res.rounds && alive(); r++) {
    const rn = modal.querySelector('#bt-round');
    if (rn) rn.textContent = String(r + 1);
    const dealt = new Set<number>();
    if (!hurry()) {
      reels.forEach((el, p) => { el.innerHTML = reelHtml(app, crate, res.pulls[r][p].s, REEL_CELLS, REEL_WIN); });
      app.sfx.latch();
      await wait(60);
      if (!alive()) return;
      const spins: Spin[] = [];
      order.forEach((p, k) => { spins[p] = spin(reels[p].querySelector<HTMLElement>('.strip-track')!, REEL_WIN, 2000 + k * 560); });
      let lastIdx = -1;
      const t0 = performance.now();
      await new Promise<void>((resolve) => {
        const loop = (): void => {
          if (!alive() || hurry()) return resolve();
          const elapsed = performance.now() - t0;
          for (const p of order) {
            if (spins[p].landed || elapsed < spins[p].dur) continue;
            land(spins[p]);
            dealt.add(p);
            deal(r, p, true);
          }
          if (spins[0].landed) return resolve();
          // the player's reel spins longest, so it drives the ticking
          const idx = cellUnderMarker(spins[0]);
          if (idx !== lastIdx) {
            lastIdx = idx;
            app.sfx.tick();
          }
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      });
      if (!alive()) return;
      for (const p of order) if (spins[p] && !spins[p].landed) land(spins[p]);
    }
    // anything not dealt yet (skipped, or the quick mode): drop it straight in
    for (const p of order) {
      if (dealt.has(p) || !alive()) continue;
      deal(r, p, false);
      app.sfx.tick(0.8 + p * 0.12);
      await wait(fast && !skipping ? 110 : 25);
    }
    await wait(hurry() ? 60 : 700);
  }
  if (!alive()) return;
  delete modal.dataset.locked;
  modal.querySelector('#bt-skip')?.remove();
  for (const el of reels) el.innerHTML = '';
  lanes.forEach((l, p) => {
    l.classList.remove('lead');
    l.classList.add(p === res.winner ? 'winner' : 'loser');
  });
  const won = res.winner === 0;
  if (won) app.sfx.win();
  else app.sfx.lose();
  const foot = modal.querySelector('#bt-foot')!;
  const pot = res.totals.reduce((a, b) => a + b, 0);
  foot.innerHTML = won
    ? `<div class="verdict good">You take the table</div>
       <p class="lead">${res.kept.length} item${res.kept.length === 1 ? '' : 's'} worth ${fmt(pot)} moved to your Armory${res.autoSold > 0 ? `, and ${fmt(res.autoSold)} credits for the ones that did not fit` : ''}. Entry was ${fmt(res.cost)}.</p>
       <div class="row-btns"><button class="btn ghost" data-act="bt-again">Battle again · ${fmt(res.cost)}</button><button class="btn" data-act="close">Done</button></div>`
    : `<div class="verdict bad">${esc(res.names[res.winner])} takes the table</div>
       <p class="lead">Their ${fmt(res.totals[res.winner])} beat your ${fmt(res.totals[0])}. Your pulls and the ${fmt(res.cost)} entry are gone.</p>
       <div class="row-btns"><button class="btn ghost" data-act="bt-again">Battle again · ${fmt(res.cost)}</button><button class="btn" data-act="close">Done</button></div>`;
  app.refresh();
}

function start(app: App): void {
  const g = app.game;
  const b = app.ui.battle;
  const crate = CRATE_BY_ID[b.crate];
  if (g.s.cash < crate.price * b.rounds) {
    app.toast({ kind: 'bad', text: 'Not enough credits for the entry' });
    app.sfx.error();
    return;
  }
  const res = g.battle(b.crate, b.rounds, b.bots, b.mode, app.now());
  if (!res) return;
  app.touch();
  app.closeAllModals();
  void runBattle(app, res);
}

export const battleTab: TabDef = {
  id: 'battle',
  label: 'Battles',
  locked: (app) => (app.game.s.rank < 3 ? 'Crate Battles unlock at Rank 3' : null),
  render(app) {
    const g = app.game;
    const b = app.ui.battle;
    const unlocked = CRATES.filter((c) => g.crateUnlocked(c));
    if (!unlocked.some((c) => c.id === b.crate)) b.crate = unlocked[0].id;
    const crate = CRATE_BY_ID[b.crate];
    const cost = crate.price * b.rounds;
    const st = g.s.stats;
    return `
      <div class="page-head">
        <h1>Crate Battles</h1>
        <p class="lead">You and your rivals open the same crates, round by round. Whoever wins takes every item on the table. Lose and your pulls go with them.</p>
      </div>
      <section class="panel">
        <div class="panel-h"><b>Pick the crate</b><span>${cr(crate.price)} a round</span></div>
        <div class="pick-crates">${unlocked.map((c) => `<button class="pick${c.id === b.crate ? ' on' : ''}" data-act="bt-crate" data-c="${c.id}" style="--cc:${c.paint[1]}">${app.imgCrate(c, 'pick-img')}<span>${esc(c.name.replace(/ (Case|Crate)$/, ''))}</span></button>`).join('')}</div>
        <div class="opts">
          <div class="opt"><span>Rounds</span><div class="seg sm">${[1, 2, 3, 4, 5].map((n) => `<button class="${b.rounds === n ? 'on' : ''}" data-act="bt-rounds" data-n="${n}">${n}</button>`).join('')}</div></div>
          <div class="opt"><span>Rivals</span><div class="seg sm">${[1, 2, 3].map((n) => `<button class="${b.bots === n ? 'on' : ''}" data-act="bt-bots" data-n="${n}">${n}</button>`).join('')}</div></div>
          <div class="opt"><span>Rule</span><div class="seg sm"><button class="${b.mode === 'high' ? 'on' : ''}" data-act="bt-mode" data-m="high">Highest total wins</button><button class="${b.mode === 'low' ? 'on' : ''}" data-act="bt-mode" data-m="low">Lowest total wins</button></div></div>
        </div>
        <div class="battle-go">
          <span>Entry ${cr(cost)}<span class="muted"> · up to ${(b.bots + 1) * b.rounds} items on the table · 1 in ${b.bots + 1} to win</span></span>
          <button class="btn big" data-act="bt-go" ${g.s.cash >= cost ? '' : 'disabled'}>${g.s.cash >= cost ? 'Start the battle' : 'Not enough credits'}</button>
        </div>
      </section>
      <section class="panel">
        <div class="panel-h"><b>Your record</b></div>
        <div class="kpis">
          <span><i>Battles</i><b>${st.battles}</b></span>
          <span><i>Won</i><b>${st.battleWins}</b></span>
          <span><i>Win rate</i><b>${st.battles ? Math.round((st.battleWins / st.battles) * 100) : 0}%</b></span>
        </div>
      </section>`;
  },
  actions: {
    'bt-crate': (app, d) => { app.ui.battle.crate = d.c!; app.sfx.click(); app.refresh(); },
    'bt-rounds': (app, d) => { app.ui.battle.rounds = Number(d.n); app.sfx.click(); app.refresh(); },
    'bt-bots': (app, d) => { app.ui.battle.bots = Number(d.n); app.sfx.click(); app.refresh(); },
    'bt-mode': (app, d) => { app.ui.battle.mode = d.m as 'high' | 'low'; app.sfx.click(); app.refresh(); },
    'bt-go': (app) => start(app),
    'bt-again': (app) => start(app),
    'bt-skip': () => { skipping = true; },
  },
};
