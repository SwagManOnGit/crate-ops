// App shell: status strip, navigation, modals, toasts, the frame loop and saving.
import { Sfx } from '../audio';
import { rankName, xpForRank, type CrateDef, type SkinDef } from '../data';
import { Game, patternGrade, valueOf, type Toast } from '../game';
import { tickOf } from '../market';
import { Renderer, specFor, specForSkin, type DrawSpec } from '../render';
import { SKINS } from '../data';
import * as sdk from '../sdk';
import { ICON, cr, esc, fmt, fmtRate, fmtTime } from './util';

export type TabId = 'crates' | 'armory' | 'market' | 'trade' | 'battle' | 'hq';
export type Action = (app: App, d: DOMStringMap, el: HTMLElement, ev: Event) => void;

export interface TabDef {
  id: TabId;
  label: string;
  render(app: App): string;
  /** Called a few times per second; `tick` is true when the market tick advanced. */
  live?(app: App, tick: boolean): void;
  /** After the tab's HTML was (re)inserted. */
  mounted?(app: App): void;
  actions: Record<string, Action>;
  inputs?: Record<string, (app: App, value: string, el: HTMLInputElement) => void>;
  locked?(app: App): string | null;
  badge?(app: App): number;
}

interface Live {
  cv: HTMLCanvasElement;
  spec: DrawSpec;
  px: number;
  py: number;
  active: boolean;
  phase: number;
}

export interface ItemLike {
  id?: number;
  s: string;
  w: number;
  p: number;
  sn: number;
}

export class App {
  readonly game: Game;
  readonly r: Renderer;
  readonly sfx: Sfx;
  readonly root: HTMLElement;
  view!: HTMLElement;
  private modalLayer!: HTMLElement;
  private toastLayer!: HTMLElement;
  private tabs: TabDef[] = [];
  private actions: Record<string, Action> = {};
  private inputs: Record<string, (app: App, value: string, el: HTMLInputElement) => void> = {};
  tab: TabId = 'crates';
  private lastStep = 0;
  private lastTick = 0;
  private lives: Live[] = [];
  private saveTimer = 0;
  private lastSave = 0;
  private paused = false;
  private modalClose = new Map<HTMLElement, (() => void) | undefined>();
  /** Bumped by long animations so a pause / close can cancel them. */
  seq = 0;

  ui = {
    armory: { sort: 'new', rarity: -1, select: false, picked: new Set<number>() },
    market: { sub: 'overview', range: 0, q: '', crate: '', sort: 'move' },
    trade: { ids: [] as number[], mult: 2 },
    battle: { crate: 'surplus', rounds: 3, bots: 1, mode: 'high' as 'high' | 'low' },
    hq: { sub: 'missions' },
  };

  constructor(root: HTMLElement, game: Game, r: Renderer, sfx: Sfx) {
    this.root = root;
    this.game = game;
    this.r = r;
    this.sfx = sfx;
  }

  now(): number {
    return Date.now();
  }
  tick(): number {
    return tickOf(this.now());
  }

  register(tab: TabDef): void {
    this.tabs.push(tab);
    Object.assign(this.actions, tab.actions);
    if (tab.inputs) Object.assign(this.inputs, tab.inputs);
  }

  addActions(a: Record<string, Action>): void {
    Object.assign(this.actions, a);
  }

  // ------------------------------------------------------------ boot

  start(): void {
    this.root.innerHTML = `
      <div class="shell">
        <header class="status">
          <div class="st-brand" aria-hidden="true">CRATE<br>OPS</div>
          <div class="st-cash">
            <span class="cr st-cash-n" data-live="cash">0</span>
            <span class="st-inc"><span data-live="inc">+0.00</span> / sec<span class="st-boost" data-live="boost"></span></span>
          </div>
          <button class="st-rank" data-act="go" data-tab="hq" aria-label="Rank and headquarters">
            <span class="st-rank-n"><b data-live="rankn">1</b></span>
            <span class="st-rank-t"><span data-live="rank">Recruit</span><span class="st-xp"><i data-live="xp"></i></span></span>
          </button>
        </header>
        <main class="view" id="view" tabindex="-1"></main>
        <nav class="nav" aria-label="Sections">
          ${this.tabs.map((t) => `<button class="nav-b" data-act="go" data-tab="${t.id}">${ICON[t.id]}<span>${t.label}</span><i class="nav-badge" data-badge="${t.id}"></i></button>`).join('')}
        </nav>
        <div class="toasts" aria-live="polite"></div>
        <div class="modals"></div>
      </div>`;
    this.view = this.root.querySelector('#view')!;
    this.modalLayer = this.root.querySelector('.modals')!;
    this.toastLayer = this.root.querySelector('.toasts')!;

    this.addActions({
      go: (app, d) => app.go(d.tab as TabId),
      close: (app) => app.closeModal(),
      noop: () => undefined,
    });

    this.root.addEventListener('click', (ev) => {
      this.sfx.unlock();
      const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!el || el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return;
      const fn = this.actions[el.dataset.act!];
      if (fn) fn(this, el.dataset, el, ev);
    });
    this.root.addEventListener('input', (ev) => {
      const el = ev.target as HTMLInputElement;
      const name = el.dataset?.input;
      if (name && this.inputs[name]) this.inputs[name](this, el.value, el);
    });
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        this.closeModal();
        return;
      }
      const t = ev.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (!this.modalLayer.children.length && ev.key >= '1' && ev.key <= String(this.tabs.length)) this.go(this.tabs[Number(ev.key) - 1].id);
    });
    window.addEventListener('resize', () => this.syncLayout());
    this.syncLayout();

    sdk.setFallbackRewardedAd(() => this.fakeAd());
    sdk.onPause(() => this.pause());
    sdk.onResume(() => this.resume());
    this.sfx.setEnabled(sdk.isAudioEnabled());
    sdk.onAudioEnabledChange((on) => this.sfx.setEnabled(on));

    this.go('crates', true);
    this.lastTick = this.tick();
    requestAnimationFrame(this.frame);
  }

  /** Landscape gets a side rail, portrait a bottom bar. */
  private syncLayout(): void {
    const wide = window.innerWidth >= 860 && window.innerWidth / window.innerHeight > 1.15;
    this.root.classList.toggle('wide', wide);
  }

  // ------------------------------------------------------------ navigation

  tabDef(id: TabId = this.tab): TabDef {
    return this.tabs.find((t) => t.id === id)!;
  }

  go(id: TabId, silent = false): void {
    const def = this.tabDef(id);
    const why = def.locked?.(this);
    if (why) {
      this.toast({ kind: 'info', text: why });
      this.sfx.error();
      return;
    }
    if (!silent) this.sfx.click();
    this.tab = id;
    for (const b of this.root.querySelectorAll<HTMLElement>('.nav-b')) b.classList.toggle('on', b.dataset.tab === id);
    this.view.scrollTop = 0;
    this.refresh();
  }

  /** Re-render the current tab, keeping the scroll position. */
  refresh(): void {
    const def = this.tabDef();
    const top = this.view.scrollTop;
    this.view.innerHTML = `<div class="page page-${def.id}">${def.render(this)}</div>`;
    this.view.scrollTop = top;
    def.mounted?.(this);
    this.updateLive(true);
  }

  // ------------------------------------------------------------ modals

  openModal(html: string, o: { cls?: string; locked?: boolean; onClose?: () => void } = {}): HTMLElement {
    const el = document.createElement('div');
    el.className = `modal ${o.cls || ''}`;
    el.innerHTML = `<div class="modal-bg" ${o.locked ? '' : 'data-act="close"'}></div><div class="modal-box" role="dialog" aria-modal="true">${html}</div>`;
    if (o.locked) el.dataset.locked = '1';
    this.modalLayer.appendChild(el);
    this.modalClose.set(el, o.onClose);
    this.updateLive(true);
    return el;
  }

  topModal(): HTMLElement | null {
    return this.modalLayer.lastElementChild as HTMLElement | null;
  }

  closeModal(el?: HTMLElement | null, force = false): void {
    const m = el || this.topModal();
    if (!m || !m.isConnected) return;
    if (m.dataset.locked && !force) return;
    const cb = this.modalClose.get(m);
    this.modalClose.delete(m);
    m.remove();
    cb?.();
  }

  closeAllModals(): void {
    while (this.topModal()) this.closeModal(null, true);
  }

  // ------------------------------------------------------------ toasts

  toast(t: Toast): void {
    const el = document.createElement('div');
    el.className = `toast toast-${t.kind}`;
    el.innerHTML = `<b>${esc(t.text)}</b>${t.sub ? `<span>${esc(t.sub)}</span>` : ''}`;
    this.toastLayer.appendChild(el);
    while (this.toastLayer.children.length > 3) this.toastLayer.firstElementChild!.remove();
    setTimeout(() => el.classList.add('out'), t.kind === 'rank' ? 4200 : 2600);
    setTimeout(() => el.remove(), t.kind === 'rank' ? 4600 : 3000);
  }

  private flushToasts(): void {
    const list = this.game.toasts.splice(0);
    for (const t of list) {
      this.toast(t);
      if (t.kind === 'rank') {
        this.sfx.rank();
        this.refresh();
      }
    }
  }

  // ------------------------------------------------------------ thumbnails

  itemKey(it: ItemLike): string {
    return it.id !== undefined ? `i${it.id}` : `x${it.s}_${it.w.toFixed(4)}_${it.p}`;
  }

  imgItem(it: ItemLike, cls = ''): string {
    const prime = patternGrade(SKINS[it.s], it.p) === 2;
    return `<img class="th ${cls}" data-th="${this.itemKey(it)}" src="${this.r.thumb(this.itemKey(it), specFor(it, prime))}" alt="" decoding="sync" draggable="false">`;
  }

  imgSkin(skin: SkinDef, cls = ''): string {
    return `<img class="th ${cls}" data-th="s${skin.id}" src="${this.r.thumb('s' + skin.id, specForSkin(skin))}" alt="" decoding="sync" draggable="false">`;
  }

  crateSpec(c: CrateDef): DrawSpec {
    return { weapon: 'crate', skin: c.look, wear: 0.1, pattern: 3, kind: 0 };
  }

  imgCrate(c: CrateDef, cls = ''): string {
    return `<img class="th ${cls}" data-th="c${c.id}" src="${this.r.thumb('c' + c.id, this.crateSpec(c))}" alt="" decoding="sync" draggable="false">`;
  }

  // ------------------------------------------------------------ live canvases

  /** Keep a canvas showing a relit weapon; the pointer moves the key light. */
  mountLive(cv: HTMLCanvasElement, spec: DrawSpec): void {
    const live: Live = { cv, spec, px: 0, py: 0, active: false, phase: Math.random() * 6 };
    void this.r.ensure(spec.weapon, false);
    void this.r.ensure(spec.weapon, true);
    const move = (e: PointerEvent): void => {
      const b = cv.getBoundingClientRect();
      live.px = ((e.clientX - b.left) / b.width) * 2 - 1;
      live.py = -(((e.clientY - b.top) / b.height) * 2 - 1);
      live.active = true;
    };
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerdown', move);
    cv.addEventListener('pointerleave', () => { live.active = false; });
    this.lives.push(live);
  }

  private drawLives(t: number): void {
    if (!this.lives.length) return;
    this.lives = this.lives.filter((l) => l.cv.isConnected);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const l of this.lives) {
      const w = Math.min(1280, Math.round(l.cv.clientWidth * dpr));
      if (w < 8) continue;
      const h = Math.round(w / 2);
      if (l.cv.width !== w || l.cv.height !== h) {
        l.cv.width = w;
        l.cv.height = h;
      }
      const sway = t / 1000 + l.phase;
      const lx = l.active ? l.px : Math.sin(sway * 0.7) * 0.55;
      const ly = l.active ? l.py * 0.7 : Math.cos(sway * 0.45) * 0.22;
      this.r.drawTo(l.cv.getContext('2d')!, { ...l.spec, lx, ly }, w, h, true);
    }
  }

  // ------------------------------------------------------------ frame loop

  private frame = (t: number): void => {
    if (this.paused) return;
    requestAnimationFrame(this.frame);
    const now = this.now();
    if (now - this.lastStep >= 200) {
      this.lastStep = now;
      this.step(now);
    }
    this.drawLives(t);
  };

  private step(now: number): void {
    const away = this.game.update(now);
    if (away) this.showAway(away.seconds, away.earned);
    this.flushToasts();
    const tk = tickOf(now);
    const tickChanged = tk !== this.lastTick;
    this.lastTick = tk;
    this.updateLive(false);
    this.tabDef().live?.(this, tickChanged);
    if (now - this.lastSave > 20000) this.save();
  }

  /** Refresh every element tagged data-live / data-badge. */
  updateLive(_force: boolean): void {
    const g = this.game;
    const now = this.now();
    const tick = tickOf(now);
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-live]')) {
      const key = el.dataset.live!;
      let v: string | null = null;
      switch (key) {
        case 'cash': v = fmt(g.s.cash); break;
        case 'inc': v = '+' + fmtRate(g.income(now)); break;
        case 'boost': v = now < g.s.boostUntil ? ` x2 ${fmtTime((g.s.boostUntil - now) / 1000)}` : ''; break;
        case 'rank': v = rankName(g.s.rank); break;
        case 'rankn': v = String(g.s.rank); break;
        case 'xp': {
          const w = Math.min(100, (g.s.xp / xpForRank(g.s.rank)) * 100).toFixed(1) + '%';
          if (el.style.width !== w) el.style.width = w;
          continue;
        }
        case 'cap': v = `${g.s.items.length} / ${g.capacity}`; break;
        case 'invval': v = fmt(g.inventoryValue(now)); break;
        case 'free': v = g.freeReady(now) ? 'Ready' : fmtTime((g.s.freeAt - now) / 1000); break;
        case 'addrop': v = g.adDropReady(now) ? 'Ready' : fmtTime((g.s.adAt - now) / 1000); break;
        case 'value': {
          const it = g.item(Number(el.dataset.id));
          v = it ? fmt(valueOf(it, tick)) : null;
          break;
        }
        default: continue;
      }
      if (v !== null && el.textContent !== v) el.textContent = v;
    }
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-badge]')) {
      const def = this.tabDef(el.dataset.badge as TabId);
      const n = def.badge?.(this) || 0;
      const txt = n ? String(n) : '';
      if (el.textContent !== txt) el.textContent = txt;
      const lock = !!def.locked?.(this);
      const btn = el.parentElement!;
      if (btn.classList.contains('locked') !== lock) btn.classList.toggle('locked', lock);
    }
  }

  // ------------------------------------------------------------ pause / save

  private pause(): void {
    this.paused = true;
    this.seq++;
    this.sfx.setPaused(true);
    this.game.update(this.now());
    this.save();
  }

  private resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.sfx.setPaused(false);
    requestAnimationFrame(this.frame);
  }

  save(): void {
    this.lastSave = this.now();
    void sdk.saveData(this.game.serialize());
  }

  /** Save soon after a player action (debounced). */
  touch(): void {
    if (this.saveTimer) return;
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = 0;
      this.save();
    }, 1500);
  }

  // ------------------------------------------------------------ away earnings + ads

  private showAway(seconds: number, earned: number): void {
    const m = this.openModal(`
      <div class="sheet sheet-sm">
        <h2>While you were away</h2>
        <p class="lead">The Armory kept leasing out your gear for ${fmtTime(seconds)} at half rate.</p>
        <div class="bignum">${cr(earned)}</div>
        <div class="row-btns">
          <button class="btn ghost" data-act="close">Collect</button>
          <button class="btn" data-act="away-double">${ICON.play} Double it</button>
        </div>
        <p class="fine">Doubling plays a short sponsored break.</p>
      </div>`, { cls: 'center' });
    this.addActions({
      'away-double': (app) => {
        void sdk.requestRewardedAd('away_double').then((ok) => {
          if (ok) {
            app.game.grantBonus(earned);
            app.toast({ kind: 'good', text: `Doubled: +${fmt(earned)} credits` });
            app.sfx.claim();
            app.touch();
          }
          app.closeModal(m, true);
        });
      },
    });
  }

  /** Stand-in for a rewarded ad when the game runs outside YouTube. */
  private fakeAd(): Promise<boolean> {
    return new Promise((resolve) => {
      let left = 3;
      const m = this.openModal(`
        <div class="sheet sheet-sm ad">
          <h2>Sponsored break</h2>
          <p class="lead">On YouTube a rewarded ad plays here. This preview just counts down.</p>
          <div class="bignum" id="ad-left">3</div>
        </div>`, { cls: 'center', locked: true });
      const iv = window.setInterval(() => {
        left--;
        const n = m.querySelector('#ad-left');
        if (n) n.textContent = String(Math.max(0, left));
        if (left <= 0) {
          clearInterval(iv);
          this.closeModal(m, true);
          resolve(true);
        }
      }, 700);
    });
  }
}
