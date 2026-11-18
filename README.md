# Crate Ops

A crate-opening incremental game built as a YouTube Playable by Swag Games. Open supply crates, collect
weapon finishes that are each rendered uniquely, trade them on a simulated exchange, gamble them up in
trade-up contracts, fight crate battles, and build an armory that pays for itself.

Everything in it is original: fictional weapons, finishes, crates and currency ("credits"). There is no
real-money element of any kind.

## Run it

```bash
npm install
npm run dev        # http://localhost:5176  (add ?slot=test for a separate test save)
npm run build      # type-check + production build into dist/
npm run bundle     # build + crate-ops-playable.zip for the Playables Developer Portal
npm run balance    # headless bot: how fast does a player progress?  (npm run balance -- 30 6 = one crate / 30 s, 6 h)
npm run bake       # re-render the weapon sprites with Blender (needs Blender 4.2+ and ffmpeg)
npm run meshes     # re-export the real-time 3D meshes from the same Blender models
npm run armory     # re-render the armory backdrop and its depth map
```

In dev builds `window.__co` exposes `{ app, game, renderer }` for console testing.

## What is in the game

| Feature | Notes |
|---|---|
| Crates | 8 crates, 131 skins across 10 firearms, 4 blades and 2 glove sets. Roulette opening, x2 to x10 opening for everyone, free supply drops on a timer. Each rarity has its own reveal sound. |
| Rarity | Surplus, Service, Tactical, Elite, Prototype, Apex, Exotic (blades and gloves). |
| Wear float | 0 to 1: Pristine, Clean, Serviced, Battered, Scrap. The paint really chips: edges first, then the flats. |
| Pattern float | Index 000 to 999 decides offset, rotation and scale of the finish, plus the wear seed, so no two drops look the same. Choice (8.5%) and Prime (1.5%) patterns are worth more. |
| Serials | About 6% of drops are serialized: worth more and earn 25% extra. |
| Passive income | Every kept item earns credits per second from its rarity, condition, pattern and serial. Rare, clean items pay back in minutes; common scrap takes hours, so it is better sold. |
| Exchange | Prices are a deterministic function of (skin, time): they move every 4 s, keep moving while you are away, and the full history (day to year) can be charted. News events move weapon classes and crate collections. Rotating buy listings, instant selling with a fee. |
| Trade-Up | Put up to 10 items in, pick the risk with a slider (x1.15 at 80% up to x40 at 2.3%). Success forges an item worth the target value; failure destroys the inputs. |
| Crate Battles | You against 1 to 3 bots over 1 to 5 rounds, highest (or lowest) total takes every item. Every player gets a roulette spin each round; rivals stop first, you last. |
| Progression | Ranks unlock crates and features, 28 directives, 7 upgrade tracks with exponential costs, a catalog bonus, and Redeploy (prestige) for permanent Medals with a small vault that survives it. |
| Rewarded ads | Sponsored crate, double income for 5 minutes, double away earnings. Outside YouTube a placeholder countdown stands in. |

## How the renders work

The weapons are real 3D models, built by script in Blender (`art/gunkit.py` is the small modelling
toolkit; `art/weapons*.py` hold the models). `art/render.py` bakes each one with Cycles into a
G-buffer sprite: camera-space normals, ambient occlusion, coverage, paint / accent / material masks and
an edge-curvature map, packed into one greyscale WebP atlas (`public/weapons/<id>.webp`, plus a small
`_s` version for thumbnails).

At runtime `src/render.ts` composites that sprite in a WebGL shader: it projects the procedural pattern
tile from `src/patterns.ts` using the drop's pattern index, removes paint according to the wear float,
and relights the result with a studio environment. Thumbnails are rendered once and cached as data URLs.

When an item is unboxed or inspected it is shown as a real 3D model instead: `art/export_meshes.py`
writes a compact mesh per weapon (`public/models/<id>.bin`, 70 to 350 KB), drawn by the same WebGL
context with the same material code. The mesh stores the sprite's bake camera, so pattern, wear and AO
are projected exactly as in the thumbnail. It spins slowly; drag to turn it, scroll to zoom. Behind it
sits a Cycles render of an armory (`art/armory.py`, `public/bg/`) with a depth map that drives a
parallax shift, so the room has depth as the pointer moves.

## Layout of the code

- `src/data.ts` weapons, rarities, wear grades, crates, skins, upgrades
- `src/game.ts` all rules and the save format (no DOM, so `scripts/balance.mjs` can run it in Node)
- `src/market.ts` the deterministic price simulation, news and listings
- `src/render.ts`, `src/patterns.ts` the compositor and the 20 procedural pattern families
- `src/ui/*` the screens (vanilla TypeScript + DOM), `src/audio.ts` synthesised sound effects
- `src/sdk.ts` thin wrapper over the YouTube Playables SDK with local fallbacks

## YouTube Playables notes

See `PLAYABLES-REQUIREMENTS.md` for the platform rules. The build is about 2.9 MB in 51 files, the
largest file is under 170 KB, nothing is fetched from the network except the SDK script, saves go through
`ytgame.game.saveData`, pause / resume and audio follow the SDK, and the layout was checked from tall
phones to 32:9.

One thing to raise with YouTube before submitting: crate opening, crate battles and trade-ups are
simulated-gambling mechanics. They use only virtual credits that cannot be bought, but certification may
still have a view on the genre.
