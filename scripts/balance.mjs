// Headless pacing check: a simple bot plays Crate Ops and reports how fast it progresses.
//   npm run balance            (active player: opens a crate every 6 s)
//   npm run balance -- 30      (casual player: one crate every 30 s)
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = join(mkdtempSync(join(tmpdir(), 'crateops-')), 'sim.mjs');
await build({ entryPoints: ['scripts/sim-entry.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const { Game, CRATES, UPGRADES, incomeOf, valueOf, tickOf, SKINS } = await import(pathToFileURL(out).href);

const pace = Number(process.argv[2]) || 6;
const HOURS = Number(process.argv[3]) || 10;
const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : n.toFixed(2));
const hms = (s) => `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;

function run(seedLabel) {
  const start = 1.8e12;
  let now = start;
  const g = new Game(null, now);
  const firstOpen = {};
  const rankAt = {};
  const marks = [300, 900, 1800, 3600, 7200, 14400, 21600, 28800, 36000];
  const rows = [];
  let prestiges = 0;
  const sellWorst = (n) => {
    const tick = tickOf(now);
    const list = g.s.items.filter((it) => !it.lock).sort((a, b) => incomeOf(a) - incomeOf(b)).slice(0, n);
    g.sell(list.map((it) => it.id), now);
    return tick;
  };
  for (let t = 0; t <= HOURS * 3600; t++) {
    now = start + t * 1000;
    g.update(now);
    g.toasts.length = 0;
    if (!rankAt[g.s.rank]) rankAt[g.s.rank] = t;
    for (const m of g.activeMissions()) if (g.missionDone(m)) g.claimMission(m.id);
    if (g.freeReady(now)) {
      if (g.free < 1) sellWorst(1);
      g.claimFree(now);
    }
    if (t % 10 === 0) {
      // upgrades: cheapest first, never spending more than 60% of cash
      for (let k = 0; k < 4; k++) {
        const opts = UPGRADES.filter((u) => g.lvl(u.id) < u.max && u.id !== 'bulk').map((u) => ({ u, c: g.upgradeCost(u.id) })).sort((a, b) => a.c - b.c);
        if (!opts.length || opts[0].c > g.s.cash * 0.6) break;
        g.buyUpgrade(opts[0].u.id);
      }
    }
    if (t % pace === 0) {
      const afford = CRATES.filter((c) => g.crateUnlocked(c) && c.price <= g.s.cash);
      if (afford.length) {
        const c = afford[afford.length - 1];
        if (g.free < 1) sellWorst(1);
        const got = g.open(c.id, 1, now);
        if (got.length && !firstOpen[c.id]) firstOpen[c.id] = t;
        // sell junk straight away: anything Service or below in rough condition once the racks are half full
        if (got.length && g.s.items.length > g.capacity * 0.5) {
          const it = got[0];
          if (SKINS[it.s].rarity <= 1 && it.w > 0.42) g.sell([it.id], now);
        }
      }
    }
    if (g.canPrestige() && g.medalGain() >= Math.max(5, g.s.medals * 0.6 + 5)) {
      g.prestige(now);
      prestiges++;
    }
    if (marks.includes(t)) {
      rows.push({ t: hms(t), rank: g.s.rank, cash: fmt(g.s.cash), 'inc/s': fmt(g.income(now)), items: `${g.s.items.length}/${g.capacity}`, opened: g.s.stats.opened, found: g.s.found.length, medals: g.s.medals, missions: g.s.claimed.length });
    }
  }
  console.log(`\n=== ${seedLabel}: one crate every ${pace}s ===`);
  console.table(rows);
  console.log('first open:', Object.entries(firstOpen).map(([k, v]) => `${k} ${hms(v)}`).join(' | '));
  console.log('rank reached:', [2, 3, 5, 8, 11, 14, 17, 20].map((r) => `R${r} ${rankAt[r] !== undefined ? hms(rankAt[r]) : '-'}`).join(' | '), '| prestiges', prestiges);
}
run('bot A');
run('bot B');
