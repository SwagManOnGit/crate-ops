// HQ tab: directives (missions), upgrades, and the command page (stats, catalog, redeploy).
import { CRATES, RARITIES, SKINS, SKIN_LIST, UPGRADES, WEAPONS, rankName, xpForRank } from '../data';
import { MEDAL_BONUS, MEDAL_COST, MISSIONS, PRESTIGE_RANK, freshSave } from '../game';
import * as sdk from '../sdk';
import type { App, TabDef } from './app';
import { ICON, esc, fmt, fmtRate } from './util';

const SUBS: [string, string][] = [['missions', 'Directives'], ['upgrades', 'Upgrades'], ['command', 'Command']];
let lastSig = '';

function missions(app: App): string {
  const g = app.game;
  const active = g.activeMissions(3);
  const done = g.s.claimed.length;
  const next = MISSIONS.filter((m) => !g.s.claimed.includes(m.id)).slice(3, 6);
  if (!active.length) return '<div class="empty"><b>Every directive is complete</b><span>Command has nothing left to ask of you. Redeploy to push your income further.</span></div>';
  return `
    <p class="lead">Directives pay out credits and rank experience. ${done} of ${MISSIONS.length} complete.</p>
    <div class="stack">${active.map((m) => {
      const [c, goal] = m.prog(g);
      const ok = c >= goal;
      return `<div class="mission${ok ? ' done' : ''}">
        <div class="mission-t"><b>${esc(m.text)}</b><span class="dir-prog"><i style="width:${Math.min(100, (c / goal) * 100).toFixed(1)}%"></i></span></div>
        <span class="mission-n">${fmt(Math.min(c, goal)).replace(/\.00$/, '')} / ${fmt(goal).replace(/\.00$/, '')}</span>
        <button class="btn sm" data-act="claim-mission" data-id="${m.id}" ${ok ? '' : 'disabled'}>${ok ? 'Claim ' : ''}${fmt(m.reward).replace(/\.00$/, '')}</button>
      </div>`;
    }).join('')}</div>
    ${next.length ? `<h3>Coming up</h3><ul class="plain">${next.map((m) => `<li>${esc(m.text)}<span class="cr">${fmt(m.reward).replace(/\.00$/, '')}</span></li>`).join('')}</ul>` : ''}`;
}

function upgrades(app: App): string {
  const g = app.game;
  return `
    <p class="lead">Upgrades are permanent for this deployment. Prices climb with every level.</p>
    <div class="ups">${UPGRADES.map((u) => {
      const lvl = g.lvl(u.id);
      const maxed = lvl >= u.max;
      const cost = g.upgradeCost(u.id);
      return `<div class="upg${maxed ? ' maxed' : ''}">
        <span class="up-ic">${ICON[u.icon] || ICON.bolt}</span>
        <div class="up-t"><b>${esc(u.name)}</b><span>${esc(u.desc)}</span><span class="up-fx">${esc(u.effect(lvl))}${maxed ? '' : ` <i>then</i> ${esc(u.effect(lvl + 1))}`}</span></div>
        <div class="up-buy"><span class="up-lvl">Level ${lvl} of ${u.max}</span>${maxed ? '<span class="btn sm ghost" aria-disabled="true">Maxed</span>' : `<button class="btn sm" data-act="up-buy" data-id="${u.id}" ${g.s.cash >= cost ? '' : 'disabled'}>${fmt(cost).replace(/\.00$/, '')}</button>`}</div>
      </div>`;
    }).join('')}</div>`;
}

function command(app: App): string {
  const g = app.game;
  const s = g.s;
  const st = s.stats;
  const gain = g.medalGain();
  const found = new Set(s.found);
  const best = st.bestSkin && SKINS[st.bestSkin] ? `${WEAPONS[SKINS[st.bestSkin].weapon].name} ${SKINS[st.bestSkin].name}` : 'Nothing yet';
  return `
    <section class="panel">
      <div class="panel-h"><b>Service record</b><span>${esc(rankName(s.rank))} · ${Math.floor(s.xp)} / ${xpForRank(s.rank)} experience</span></div>
      <div class="kpis wide">
        <span><i>Crates opened</i><b>${st.opened.toLocaleString('en-US')}</b></span>
        <span><i>Items sold</i><b>${st.sold.toLocaleString('en-US')}</b></span>
        <span><i>Sales income</i><b class="cr">${fmt(st.soldValue)}</b></span>
        <span><i>Passive income</i><b class="cr">${fmt(st.passive)}</b></span>
        <span><i>Spent</i><b class="cr">${fmt(st.spent)}</b></span>
        <span><i>Best drop</i><b>${esc(best)}</b></span>
        <span><i>Best drop value</i><b class="cr">${fmt(st.bestValue)}</b></span>
        <span><i>Trade-Ups won</i><b>${st.tradeWins} of ${st.tradeUps}</b></span>
        <span><i>Battles won</i><b>${st.battleWins} of ${st.battles}</b></span>
        <span><i>Peak income</i><b class="gain">+${fmtRate(st.maxIncome)}/s</b></span>
      </div>
    </section>
    <section class="panel">
      <div class="panel-h"><b>Catalog</b><span>${s.found.length} of ${SKIN_LIST.length} skins found · +${(s.found.length * 0.2).toFixed(1)}% income</span></div>
      <div class="catalog">${CRATES.map((c) => {
        const n = c.skins.filter((k) => found.has(k.id)).length;
        return `<button class="cat" data-act="crate-peek" data-crate="${c.id}"><span>${esc(c.name)}</span><span class="dir-prog"><i style="width:${((n / c.skins.length) * 100).toFixed(0)}%"></i></span><b>${n} / ${c.skins.length}</b></button>`;
      }).join('')}</div>
      <p class="fine">Each new skin you find adds 0.2% to all income, for good.</p>
    </section>
    <section class="panel redeploy">
      <div class="panel-h"><b>${ICON.medal} Redeploy</b><span>${s.medals} medal${s.medals === 1 ? '' : 's'} · +${Math.round(s.medals * MEDAL_BONUS * 100)}% income</span></div>
      <p class="lead">Hand in your credits, upgrades and every item outside the vault, and start a new deployment with Medals. Each Medal adds ${Math.round(MEDAL_BONUS * 100)}% to all income forever, and you start with 25 extra credits per Medal. Your rank, catalog and vaulted items (${g.vaultSlots} slots) come with you.</p>
      <div class="battle-go">
        <span>${s.rank < PRESTIGE_RANK ? `Available from Rank ${PRESTIGE_RANK} (${esc(rankName(PRESTIGE_RANK))})` : gain >= 1 ? `Redeploying now earns <b>${gain}</b> medal${gain === 1 ? '' : 's'}` : `Earn ${fmt(MEDAL_COST - s.run)} more this deployment for your first medal`}</span>
        <button class="btn" data-act="hq-prestige" ${g.canPrestige() ? '' : 'disabled'}>Redeploy</button>
      </div>
    </section>
    <section class="panel">
      <div class="panel-h"><b>How it works</b></div>
      <ul class="plain help">
        <li><b>Rarity</b><span>${RARITIES.map((r, i) => `<span class="odd r${i}"><i></i>${r.name}</span>`).join('')}</span></li>
        <li><b>Condition</b><span>Every drop rolls a float from 0 to 1. Pristine sells for the most and earns double; Scrap earns the least.</span></li>
        <li><b>Pattern</b><span>A number from 000 to 999 decides how the finish sits on the item. Choice and Prime patterns are worth more.</span></li>
        <li><b>Serial</b><span>About 1 drop in 16 is serialized: worth more and earns 25% extra.</span></li>
      </ul>
      <button class="btn ghost sm" data-act="hq-wipe">Erase save and start over</button>
    </section>`;
}

function sig(app: App): string {
  const g = app.game;
  if (app.ui.hq.sub === 'upgrades') return 'u' + UPGRADES.map((u) => (g.s.cash >= g.upgradeCost(u.id) ? 1 : 0)).join('');
  if (app.ui.hq.sub === 'missions') return 'm' + g.activeMissions(3).map((m) => Math.min(...m.prog(g))).join(',');
  return 'c' + g.medalGain() + g.s.rank;
}

export const hqTab: TabDef = {
  id: 'hq',
  label: 'HQ',
  badge: (app) => app.game.claimable(),
  render(app) {
    const g = app.game;
    const st = app.ui.hq;
    lastSig = sig(app);
    const body = st.sub === 'upgrades' ? upgrades(app) : st.sub === 'command' ? command(app) : missions(app);
    return `
      <div class="page-head">
        <h1>Headquarters</h1>
        <div class="kpis">
          <span><i>Rank ${g.s.rank}</i><b>${esc(rankName(g.s.rank))}</b></span>
          <span><i>Medals</i><b>${g.s.medals}</b></span>
          <span><i>Income bonus</i><b class="gain">x${g.incomeMult(app.now()).toFixed(2)}</b></span>
        </div>
      </div>
      <div class="seg">${SUBS.map(([k, l]) => `<button class="${st.sub === k ? 'on' : ''}" data-act="hq-sub" data-k="${k}">${l}${k === 'missions' && g.claimable() ? `<i class="dot"></i>` : ''}</button>`).join('')}</div>
      ${body}`;
  },
  live(app) {
    if (sig(app) !== lastSig) app.refresh();
  },
  actions: {
    'hq-sub': (app, d) => {
      app.ui.hq.sub = d.k!;
      app.sfx.click();
      app.view.scrollTop = 0;
      app.refresh();
    },
    'claim-mission': (app, d) => {
      const got = app.game.claimMission(d.id!);
      if (got > 0) {
        app.sfx.claim();
        app.toast({ kind: 'mission', text: `Directive complete: +${fmt(got).replace(/\.00$/, '')} credits` });
        app.touch();
      }
      app.refresh();
    },
    'up-buy': (app, d) => {
      if (app.game.buyUpgrade(d.id!)) {
        app.sfx.upgrade();
        app.touch();
      } else {
        app.sfx.error();
      }
      app.refresh();
    },
    'crate-peek': (app, d) => {
      app.go('crates');
      const btn = app.view.querySelector<HTMLElement>(`.crate[data-crate="${d.crate}"]`);
      btn?.click();
    },
    'hq-prestige': (app) => {
      const g = app.game;
      if (!g.canPrestige()) return;
      const gain = g.medalGain();
      const vaulted = g.s.items.filter((it) => it.lock).length;
      const m = app.openModal(`
        <div class="sheet sheet-sm">
          <h2>Redeploy for ${gain} medal${gain === 1 ? '' : 's'}?</h2>
          <p class="lead">You keep your rank, catalog and ${Math.min(vaulted, g.vaultSlots)} vaulted item${Math.min(vaulted, g.vaultSlots) === 1 ? '' : 's'}. Credits, upgrades and the other ${g.s.items.length - Math.min(vaulted, g.vaultSlots)} items are handed in.</p>
          <div class="bignum gain">+${Math.round(gain * MEDAL_BONUS * 100)}% income, permanently</div>
          <div class="row-btns">
            <button class="btn ghost" data-act="close">Not yet</button>
            <button class="btn" data-act="hq-prestige-yes">Redeploy</button>
          </div>
        </div>`, { cls: 'center' });
      app.addActions({
        'hq-prestige-yes': (a) => {
          const got = a.game.prestige(a.now());
          a.closeModal(m, true);
          if (got > 0) {
            a.sfx.rank();
            a.toast({ kind: 'rank', text: `Redeployed with ${got} medal${got === 1 ? '' : 's'}`, sub: `All income is now x${(1 + MEDAL_BONUS * a.game.s.medals).toFixed(1)}` });
            a.save();
          }
          a.go('crates', true);
        },
      });
    },
    'hq-wipe': (app) => {
      const m = app.openModal(`
        <div class="sheet sheet-sm">
          <h2>Erase everything?</h2>
          <p class="lead">Credits, items, rank, medals and the catalog are deleted. This cannot be undone.</p>
          <div class="row-btns">
            <button class="btn ghost" data-act="close">Keep my save</button>
            <button class="btn danger" data-act="hq-wipe-yes">Erase and restart</button>
          </div>
        </div>`, { cls: 'center' });
      app.addActions({
        'hq-wipe-yes': (a) => {
          a.game.s = freshSave(a.now());
          (a.game as unknown as { incomeCache: number }).incomeCache = -1;
          a.game.rev++;
          void sdk.saveData(a.game.serialize());
          a.closeModal(m, true);
          a.go('crates', true);
        },
      });
    },
  },
};
