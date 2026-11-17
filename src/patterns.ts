// Procedural skin art. Each skin gets a seamless 512px tile drawn on a 2D canvas;
// the compositor then places it on the weapon using the drop's own pattern index
// (offset, rotation, scale), so no two drops line up the same way.
import type { PatternKind, SkinDef } from './data';
import { mulberry32 } from './rng';

export const PAT_SIZE = 512;
type RGB = [number, number, number];
type Rnd = () => number;

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const css = (c: RGB, a = 1): string => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

/** Seamless fractal value noise, values roughly 0..1. */
function field(S: number, cells: number, octaves: number, rnd: Rnd): Float32Array {
  const out = new Float32Array(S * S);
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const c = cells << o;
    const lat = new Float32Array(c * c);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    const k = c / S;
    for (let y = 0; y < S; y++) {
      const fy = y * k;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % c) * c;
      const r1 = ((y0 + 1) % c) * c;
      for (let x = 0; x < S; x++) {
        const fx = x * k;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const xa = x0 % c;
        const xb = (x0 + 1) % c;
        const a = lat[r0 + xa] + (lat[r0 + xb] - lat[r0 + xa]) * sx;
        const b = lat[r1 + xa] + (lat[r1 + xb] - lat[r1 + xa]) * sx;
        out[y * S + x] += (a + (b - a) * sy) * amp;
      }
    }
    norm += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function paint(ctx: CanvasRenderingContext2D, S: number, fn: (x: number, y: number, i: number) => RGB): void {
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const c = fn(x, y, i);
      d[i * 4] = c[0];
      d[i * 4 + 1] = c[1];
      d[i * 4 + 2] = c[2];
      d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Run a drawing routine nine times so shapes crossing an edge wrap around. */
function wrap(ctx: CanvasRenderingContext2D, S: number, fn: () => void): void {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      ctx.save();
      ctx.translate(dx * S, dy * S);
      fn();
      ctx.restore();
    }
  }
}

/** Soft grain over whatever is already drawn, so flat colours do not look like plastic. */
function grain(ctx: CanvasRenderingContext2D, S: number, rnd: Rnd, strength = 0.07): void {
  const f = field(S, 16, 3, rnd);
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < S * S; i++) {
    const k = 1 + (f[i] - 0.5) * 2 * strength;
    d[i * 4] = Math.min(255, d[i * 4] * k);
    d[i * 4 + 1] = Math.min(255, d[i * 4 + 1] * k);
    d[i * 4 + 2] = Math.min(255, d[i * 4 + 2] * k);
  }
  ctx.putImageData(img, 0, 0);
}

type Gen = (ctx: CanvasRenderingContext2D, S: number, c: RGB[], rnd: Rnd) => void;

const GEN: Record<PatternKind, Gen> = {
  solid(ctx, S, c, rnd) {
    const f = field(S, 3, 4, rnd);
    paint(ctx, S, (_x, _y, i) => mix(c[0], c[1] || c[0], sstep(0.3, 0.7, f[i])));
  },

  fade(ctx, S, c, rnd) {
    const f = field(S, 3, 3, rnd);
    const n = c.length - 1;
    paint(ctx, S, (x, y, i) => {
      let v = (x + y) / S + (f[i] - 0.5) * 0.16;
      v = (((v % 1) + 1) % 1) * n;
      const k = Math.min(n - 1, Math.floor(v));
      return mix(c[k], c[k + 1], sstep(0, 1, v - k));
    });
  },

  camo(ctx, S, c, rnd) {
    const f = field(S, 4, 3, rnd);
    const g = field(S, 5, 3, rnd);
    const h = field(S, 7, 2, rnd);
    paint(ctx, S, (_x, _y, i) => {
      let col = c[0];
      col = mix(col, c[1], sstep(0.535, 0.55, f[i]));
      col = mix(col, c[2], sstep(0.585, 0.6, g[i]));
      col = mix(col, c[3] || c[1], sstep(0.63, 0.645, h[i]));
      return col;
    });
  },

  digital(ctx, S, c, rnd) {
    const f = field(S, 4, 3, rnd);
    const g = field(S, 6, 3, rnd);
    const h = field(S, 9, 2, rnd);
    const B = 8;
    paint(ctx, S, (x, y) => {
      const i = Math.floor(y / B) * B * S + Math.floor(x / B) * B;
      let col = c[0];
      if (f[i] > 0.54) col = c[1];
      if (g[i] > 0.59) col = c[2];
      if (h[i] > 0.64) col = c[3] || c[1];
      return col;
    });
  },

  tiger(ctx, S, c, rnd) {
    const f = field(S, 3, 3, rnd);
    const g = field(S, 8, 2, rnd);
    paint(ctx, S, (x, _y, i) => {
      const v = Math.sin((x / S) * Math.PI * 2 * 7 + (f[i] - 0.5) * 9 + (g[i] - 0.5) * 2.5);
      const width = 0.1 + f[i] * 0.5;
      let col = mix(c[0], c[2] || c[0], sstep(0.3, 0.8, g[i]) * 0.5);
      col = mix(col, c[1], sstep(width - 0.06, width + 0.06, v));
      return col;
    });
  },

  hex(ctx, S, c, rnd) {
    ctx.fillStyle = css(c[0]);
    ctx.fillRect(0, 0, S, S);
    const N = 12;
    const M = 14;
    const w = S / N;
    const vs = S / M;
    const hh = vs / 0.75;
    const fills = new Map<string, number>();
    const pickFill = (i: number, j: number): number => {
      const key = `${((i % N) + N) % N},${((j % M) + M) % M}`;
      if (!fills.has(key)) fills.set(key, rnd());
      return fills.get(key)!;
    };
    ctx.lineWidth = 3;
    ctx.strokeStyle = css(c[1]);
    for (let j = -1; j <= M + 1; j++) {
      for (let i = -1; i <= N + 1; i++) {
        const cx = i * w + (j & 1 ? w / 2 : 0);
        const cy = j * vs;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (Math.PI / 3) * k + Math.PI / 6;
          const px = cx + (w / Math.sqrt(3)) * Math.cos(a);
          const py = cy + (hh / 2) * Math.sin(a);
          if (k) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        }
        ctx.closePath();
        const r = pickFill(i, j);
        if (r > 0.82) {
          ctx.fillStyle = css(c[1], 0.85);
          ctx.fill();
        } else if (r > 0.55) {
          ctx.fillStyle = css(c[2] || c[0]);
          ctx.fill();
        }
        ctx.stroke();
      }
    }
  },

  carbon(ctx, S, c) {
    const N = 32;
    const w = S / N;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const horiz = ((i + (j >> 1)) & 1) === 0;
        const g = horiz ? ctx.createLinearGradient(i * w, 0, (i + 1) * w, 0) : ctx.createLinearGradient(0, j * w, 0, (j + 1) * w);
        g.addColorStop(0, css(c[2] || c[0]));
        g.addColorStop(0.5, css(c[1]));
        g.addColorStop(1, css(c[0]));
        ctx.fillStyle = g;
        ctx.fillRect(i * w, j * w, w + 0.5, w + 0.5);
      }
    }
  },

  topo(ctx, S, c, rnd) {
    const f = field(S, 3, 4, rnd);
    paint(ctx, S, (_x, _y, i) => {
      const v = f[i] * 14;
      const fr = v - Math.floor(v);
      const major = Math.floor(v) % 4 === 0;
      const d = Math.min(fr, 1 - fr);
      const line = 1 - sstep(major ? 0.05 : 0.025, major ? 0.1 : 0.06, d);
      const bg = mix(c[0], c[2] || c[0], sstep(0.35, 0.65, f[i]));
      return mix(bg, c[1], line * (major ? 1 : 0.75));
    });
  },

  marble(ctx, S, c, rnd) {
    const f = field(S, 2, 4, rnd);
    const g = field(S, 4, 3, rnd);
    paint(ctx, S, (x, y, i) => {
      const v = Math.sin(((x + y * 0.4) / S) * Math.PI * 2 * 2 + f[i] * 16 + g[i] * 5) * 0.5 + 0.5;
      const vein = Math.pow(v, 2.2);
      let col = mix(c[0], c[2] || c[0], sstep(0.2, 0.8, g[i]));
      col = mix(col, c[1], vein);
      return col;
    });
  },

  splatter(ctx, S, c, rnd) {
    const f = field(S, 4, 3, rnd);
    paint(ctx, S, (_x, _y, i) => mix(c[0], mix(c[0], [0, 0, 0], 0.25), sstep(0.35, 0.7, f[i])));
    const blobs: { x: number; y: number; r: number; col: RGB; sat: { a: number; d: number; r: number }[] }[] = [];
    for (let k = 0; k < 46; k++) {
      const r = 6 + Math.pow(rnd(), 2.2) * 58;
      const sat = Array.from({ length: 5 + Math.floor(rnd() * 9) }, () => ({ a: rnd() * 6.283, d: r * (0.9 + rnd() * 1.5), r: r * (0.06 + rnd() * 0.28) }));
      blobs.push({ x: rnd() * S, y: rnd() * S, r, col: c[1 + Math.floor(rnd() * (c.length - 1))], sat });
    }
    wrap(ctx, S, () => {
      for (const b of blobs) {
        ctx.fillStyle = css(b.col);
        ctx.beginPath();
        for (let k = 0; k <= 18; k++) {
          const a = (k / 18) * 6.283;
          const rr = b.r * (0.78 + 0.3 * Math.sin(a * 3 + b.x) + 0.14 * Math.sin(a * 7 + b.y));
          const px = b.x + Math.cos(a) * rr;
          const py = b.y + Math.sin(a) * rr;
          if (k) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        }
        ctx.fill();
        for (const s of b.sat) {
          ctx.beginPath();
          ctx.arc(b.x + Math.cos(s.a) * s.d, b.y + Math.sin(s.a) * s.d, s.r, 0, 6.283);
          ctx.fill();
        }
      }
    });
  },

  shards(ctx, S, c, rnd) {
    ctx.fillStyle = css(c[0]);
    ctx.fillRect(0, 0, S, S);
    const tris: { p: number[]; col: RGB; hi: number }[] = [];
    for (let k = 0; k < 110; k++) {
      const cx = rnd() * S;
      const cy = rnd() * S;
      const r = 36 + rnd() * 96;
      const p: number[] = [];
      const a0 = rnd() * 6.283;
      for (let j = 0; j < 3; j++) {
        const a = a0 + j * 2.094 + (rnd() - 0.5) * 1.3;
        p.push(cx + Math.cos(a) * r * (0.5 + rnd() * 0.7), cy + Math.sin(a) * r * (0.5 + rnd() * 0.7));
      }
      tris.push({ p, col: c[Math.floor(rnd() * c.length)], hi: rnd() });
    }
    wrap(ctx, S, () => {
      for (const t of tris) {
        const g = ctx.createLinearGradient(t.p[0], t.p[1], t.p[2], t.p[3]);
        g.addColorStop(0, css(mix(t.col, [255, 255, 255], 0.1 + t.hi * 0.22)));
        g.addColorStop(1, css(mix(t.col, [0, 0, 0], 0.12 + t.hi * 0.25)));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(t.p[0], t.p[1]);
        ctx.lineTo(t.p[2], t.p[3]);
        ctx.lineTo(t.p[4], t.p[5]);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = css(mix(t.col, [255, 255, 255], 0.35), 0.5);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    });
  },

  circuit(ctx, S, c, rnd) {
    ctx.fillStyle = css(c[0]);
    ctx.fillRect(0, 0, S, S);
    const G = 16;
    ctx.fillStyle = css(c[2] || c[0]);
    for (let y = 0; y < S; y += G * 2) for (let x = 0; x < S; x += G * 2) ctx.fillRect(x + 1, y + 1, G * 2 - 2, G * 2 - 2);
    const traces: { pts: number[]; w: number }[] = [];
    const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1]];
    for (let k = 0; k < 54; k++) {
      let x = Math.floor(rnd() * (S / G)) * G;
      let y = Math.floor(rnd() * (S / G)) * G;
      const pts = [x, y];
      let d = Math.floor(rnd() * 4);
      const segs = 2 + Math.floor(rnd() * 5);
      for (let s = 0; s < segs; s++) {
        const len = (1 + Math.floor(rnd() * 5)) * G;
        x += dirs[d][0] * len;
        y += dirs[d][1] * len;
        pts.push(x, y);
        d = rnd() < 0.3 ? 4 + Math.floor(rnd() * 2) : (d + (rnd() < 0.5 ? 1 : 3)) % 4;
      }
      traces.push({ pts, w: rnd() < 0.2 ? 5 : 2.5 });
    }
    wrap(ctx, S, () => {
      ctx.strokeStyle = css(c[1]);
      ctx.fillStyle = css(c[1]);
      ctx.lineJoin = 'round';
      for (const t of traces) {
        ctx.lineWidth = t.w;
        ctx.beginPath();
        ctx.moveTo(t.pts[0], t.pts[1]);
        for (let i = 2; i < t.pts.length; i += 2) ctx.lineTo(t.pts[i], t.pts[i + 1]);
        ctx.stroke();
        for (const e of [0, t.pts.length - 2]) {
          ctx.beginPath();
          ctx.arc(t.pts[e], t.pts[e + 1], t.w + 2.5, 0, 6.283);
          ctx.fill();
        }
      }
    });
  },

  scales(ctx, S, c) {
    ctx.fillStyle = css(c[0]);
    ctx.fillRect(0, 0, S, S);
    const N = 14;
    const w = S / N;
    const rows = 22;
    const h = S / rows;
    for (let j = -1; j <= rows + 1; j++) {
      for (let i = -1; i <= N + 1; i++) {
        const cx = i * w + (j & 1 ? w / 2 : 0);
        const cy = j * h;
        const g = ctx.createRadialGradient(cx, cy - h * 0.2, 2, cx, cy, w * 0.62);
        g.addColorStop(0, css(c[2] || c[0]));
        g.addColorStop(0.75, css(c[0]));
        g.addColorStop(1, css(mix(c[0], [0, 0, 0], 0.35)));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(cx, cy, w * 0.54, h * 1.15, 0, 0, Math.PI);
        ctx.fill();
        ctx.strokeStyle = css(c[1]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, w * 0.54, h * 1.15, 0, 0.12, Math.PI - 0.12);
        ctx.stroke();
      }
    }
  },

  crackle(ctx, S, c, rnd) {
    const G = 9;
    const cell = S / G;
    const px = new Float32Array(G * G);
    const py = new Float32Array(G * G);
    const shade = new Float32Array(G * G);
    for (let i = 0; i < G * G; i++) {
      px[i] = 0.15 + rnd() * 0.7;
      py[i] = 0.15 + rnd() * 0.7;
      shade[i] = rnd();
    }
    const f = field(S, 6, 2, rnd);
    paint(ctx, S, (x, y, i) => {
      const gx = Math.floor(x / cell);
      const gy = Math.floor(y / cell);
      let d1 = 1e9;
      let d2 = 1e9;
      let id = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const cx = gx + ox;
          const cy = gy + oy;
          const k = (((cy % G) + G) % G) * G + (((cx % G) + G) % G);
          const dx = (cx + px[k]) * cell - x;
          const dy = (cy + py[k]) * cell - y;
          const d = dx * dx + dy * dy;
          if (d < d1) { d2 = d1; d1 = d; id = k; } else if (d < d2) d2 = d;
        }
      }
      const e = Math.sqrt(d2) - Math.sqrt(d1);
      const body = mix(c[0], c[2] || c[0], shade[id] * 0.8 + (f[i] - 0.5) * 0.3);
      const halo = 1 - sstep(2, 15, e);
      const line = 1 - sstep(1.2, 3.6, e);
      return mix(mix(body, c[1], halo * 0.28), c[1], line);
    });
  },

  stripes(ctx, S, c) {
    const n = c.length;
    const reps = n > 4 ? 1 : 3;
    paint(ctx, S, (x, y) => {
      const v = ((((x + y) / S) * reps) % 1) * n;
      const k = Math.floor(v) % n;
      const fr = v - Math.floor(v);
      const edge = Math.min(fr, 1 - fr);
      return mix(mix(c[k], [0, 0, 0], 0.5), c[k], sstep(0, 0.035, edge));
    });
  },

  nebula(ctx, S, c, rnd) {
    const f = field(S, 2, 5, rnd);
    const g = field(S, 3, 4, rnd);
    paint(ctx, S, (_x, _y, i) => {
      let col = c[0];
      col = mix(col, c[1], sstep(0.42, 0.72, f[i]) * 0.9);
      col = mix(col, c[2], sstep(0.5, 0.78, g[i]) * 0.85);
      col = mix(col, c[3] || c[2], sstep(0.66, 0.8, f[i] * g[i] * 2.2) * 0.5);
      return col;
    });
    const stars = Array.from({ length: 150 }, () => ({ x: rnd() * S, y: rnd() * S, r: 0.5 + Math.pow(rnd(), 6) * 3.2, a: 0.4 + rnd() * 0.6 }));
    const star = c[3] || [255, 255, 255];
    wrap(ctx, S, () => {
      for (const s of stars) {
        ctx.fillStyle = css(star as RGB, s.a);
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, 6.283);
        ctx.fill();
        if (s.r > 2.2) {
          ctx.fillStyle = css(star as RGB, 0.18);
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r * 3.5, 0, 6.283);
          ctx.fill();
        }
      }
    });
  },

  wave(ctx, S, c, rnd) {
    ctx.fillStyle = css(c[0]);
    ctx.fillRect(0, 0, S, S);
    const rows = 12;
    const h = S / rows;
    const phase = Array.from({ length: rows }, () => rnd() * 6.283);
    for (let pass = 0; pass < 2; pass++) {
      for (let j = -1; j <= rows; j++) {
        const jj = ((j % rows) + rows) % rows;
        ctx.beginPath();
        for (let x = 0; x <= S; x += 4) {
          const y = j * h + Math.sin((x / S) * 6.283 * 3 + phase[jj]) * h * 0.42 + Math.sin((x / S) * 6.283 * 7 + phase[jj] * 2) * h * 0.1;
          if (x) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        if (pass === 0) {
          ctx.lineTo(S, j * h + h * 1.6);
          ctx.lineTo(0, j * h + h * 1.6);
          ctx.closePath();
          ctx.fillStyle = css(jj & 1 ? c[0] : c[2] || c[0]);
          ctx.fill();
        } else {
          ctx.strokeStyle = css(c[1]);
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }
      }
    }
  },

  grid(ctx, S, c, rnd) {
    ctx.fillStyle = css(c[0]);
    ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = css(c[2] || c[1], 0.9);
    ctx.lineWidth = 1.5;
    for (let p = 0; p <= S; p += 32) {
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, S);
      ctx.moveTo(0, p);
      ctx.lineTo(S, p);
      ctx.stroke();
    }
    ctx.strokeStyle = css(c[1]);
    ctx.lineWidth = 3;
    for (let p = 0; p <= S; p += 128) {
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, S);
      ctx.moveTo(0, p);
      ctx.lineTo(S, p);
      ctx.stroke();
    }
    const marks = Array.from({ length: 10 }, () => ({ x: (1 + Math.floor(rnd() * 15)) * 32, y: (1 + Math.floor(rnd() * 15)) * 32, t: Math.floor(rnd() * 3), s: 10 + rnd() * 14 }));
    ctx.lineWidth = 2.5;
    for (const m of marks) {
      ctx.beginPath();
      if (m.t === 0) {
        ctx.arc(m.x, m.y, m.s, 0, 6.283);
        ctx.moveTo(m.x - m.s * 1.5, m.y);
        ctx.lineTo(m.x + m.s * 1.5, m.y);
        ctx.moveTo(m.x, m.y - m.s * 1.5);
        ctx.lineTo(m.x, m.y + m.s * 1.5);
      } else if (m.t === 1) {
        ctx.rect(m.x - m.s, m.y - m.s * 0.6, m.s * 2, m.s * 1.2);
      } else {
        for (let k = -2; k <= 2; k++) {
          ctx.moveTo(m.x + k * 6, m.y - m.s * 0.5);
          ctx.lineTo(m.x + k * 6, m.y + m.s * 0.5);
        }
      }
      ctx.stroke();
    }
  },

  stencil(ctx, S, c, rnd) {
    const f = field(S, 5, 3, rnd);
    paint(ctx, S, (_x, _y, i) => mix(c[0], c[2] || c[0], sstep(0.45, 0.6, f[i]) * 0.7));
    const glyphs = Array.from({ length: 26 }, () => ({
      x: rnd() * S, y: rnd() * S, t: Math.floor(rnd() * 6), s: 16 + rnd() * 30, r: Math.floor(rnd() * 4) * (Math.PI / 2), n: Math.floor(rnd() * 90) + 10,
    }));
    wrap(ctx, S, () => {
      ctx.fillStyle = css(c[1], 0.92);
      ctx.strokeStyle = css(c[1], 0.92);
      for (const g of glyphs) {
        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.rotate(g.r);
        ctx.lineWidth = g.s * 0.2;
        ctx.beginPath();
        if (g.t === 0) {
          for (let k = 0; k < 10; k++) {
            const a = (k / 10) * 6.283 - Math.PI / 2;
            const rr = k & 1 ? g.s * 0.42 : g.s;
            if (k) ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
            else ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
          }
          ctx.closePath();
          ctx.fill();
        } else if (g.t === 1) {
          for (let k = 0; k < 3; k++) {
            ctx.moveTo(-g.s, k * g.s * 0.55);
            ctx.lineTo(0, k * g.s * 0.55 - g.s * 0.6);
            ctx.lineTo(g.s, k * g.s * 0.55);
          }
          ctx.stroke();
        } else if (g.t === 2) {
          ctx.font = `700 ${Math.round(g.s * 1.5)}px "Saira Stencil One", "Barlow Condensed", Impact, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(g.n), 0, 0);
        } else if (g.t === 3) {
          ctx.arc(0, 0, g.s * 0.8, 0, 6.283);
          ctx.stroke();
        } else if (g.t === 4) {
          ctx.moveTo(-g.s, 0);
          ctx.lineTo(g.s * 0.4, 0);
          ctx.moveTo(g.s * 0.1, -g.s * 0.6);
          ctx.lineTo(g.s, 0);
          ctx.lineTo(g.s * 0.1, g.s * 0.6);
          ctx.stroke();
        } else {
          for (let k = 0; k < 4; k++) ctx.rect(-g.s + k * g.s * 0.55, -g.s * 0.5, g.s * 0.3, g.s);
          ctx.fill();
        }
        ctx.restore();
      }
    });
  },

  weave(ctx, S, c, rnd) {
    ctx.fillStyle = css(c[0]);
    ctx.fillRect(0, 0, S, S);
    const N = 64;
    const w = S / N;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const over = ((i + j) & 1) === 0;
        ctx.fillStyle = css(over ? c[2] || c[0] : c[1], 0.55);
        if (over) ctx.fillRect(i * w + 0.6, j * w + 1.6, w - 1.2, w - 3.2);
        else ctx.fillRect(i * w + 1.6, j * w + 0.6, w - 3.2, w - 1.2);
      }
    }
    grain(ctx, S, rnd, 0.12);
  },
};

/** Default tiles-per-sprite scale for each pattern family. */
export const KIND_SCALE: Record<PatternKind, number> = {
  solid: 1, fade: 0.55, camo: 1.25, digital: 1.5, tiger: 1.0, hex: 1.7, carbon: 2.4, topo: 1.15, marble: 1.0,
  splatter: 1.2, shards: 1.1, circuit: 1.5, scales: 1.8, crackle: 1.2, stripes: 0.9, nebula: 0.9, wave: 1.5,
  grid: 1.6, stencil: 1.25, weave: 2.6,
};

/** Kinds that look right at any rotation; the rest only wobble a little around their base angle. */
export const KIND_FREE_ROT: Partial<Record<PatternKind, boolean>> = {
  solid: true, camo: true, splatter: true, shards: true, crackle: true, nebula: true, marble: true, topo: true,
};

export function drawPattern(skin: Pick<SkinDef, 'kind' | 'colors' | 'seed'>): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = PAT_SIZE;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  const rnd = mulberry32(skin.seed);
  const cols = skin.colors.map(hexToRgb);
  GEN[skin.kind](ctx, PAT_SIZE, cols, rnd);
  if (skin.kind !== 'weave' && skin.kind !== 'carbon') grain(ctx, PAT_SIZE, rnd, 0.05);
  return cv;
}
