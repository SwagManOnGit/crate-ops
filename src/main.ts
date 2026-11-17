import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/saira-stencil-one/latin-400.css';
import './style.css';
import { Sfx } from './audio';
import { Game } from './game';
import { Renderer } from './render';
import * as sdk from './sdk';
import { App } from './ui/app';
import { armoryTab } from './ui/armory';
import { battleTab } from './ui/battle';
import { cratesTab } from './ui/crates';
import { hqTab } from './ui/hq';
import { marketTab } from './ui/market';
import { partActions } from './ui/parts';
import { tradeTab } from './ui/trade';
import { ICON } from './ui/util';

function timeout<T>(p: Promise<T>, ms: number): Promise<T | void> {
  return Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))]);
}

async function boot(): Promise<void> {
  // the static splash in index.html is already on screen
  sdk.firstFrameReady();
  const raw = await sdk.loadData();
  const game = new Game(raw, Date.now());
  const renderer = new Renderer();
  const fonts = document.fonts
    ? Promise.all([
        document.fonts.load('700 20px "Barlow Condensed"'),
        document.fonts.load('500 14px "Barlow"'),
        document.fonts.load('400 20px "Saira Stencil One"'),
      ])
    : Promise.resolve();
  await timeout(Promise.all([fonts, renderer.ensure('crate', false)]), 2500);

  const root = document.getElementById('app')!;
  const app = new App(root, game, renderer, new Sfx());
  for (const tab of [cratesTab, armoryTab, marketTab, tradeTab, battleTab, hqTab]) app.register(tab);
  app.addActions(partActions);
  app.start();
  sdk.gameReady();

  if (!game.s.intro) {
    const m = app.openModal(`
      <div class="sheet sheet-sm">
        <h2>Welcome to the depot, Recruit</h2>
        <p class="lead">Open crates. Every item you keep earns credits each second, so hold on to the rare, clean pieces and sell the rest on the Exchange.</p>
        <div class="row-btns" style="margin-top:16px"><button class="btn big" data-act="intro-go">${ICON.chute} Open my first supply drop</button></div>
        <p class="fine">Supply drops are free and come back every 90 seconds.</p>
      </div>`, { cls: 'center', onClose: () => { game.s.intro = 1; app.touch(); } });
    app.addActions({
      'intro-go': (a) => {
        a.closeModal(m, true);
        a.root.querySelector<HTMLElement>('[data-act="free-drop"]')?.click();
      },
    });
  }

  if (import.meta.env.DEV) (window as unknown as { __co: unknown }).__co = { app, game, renderer };
}

void boot();
