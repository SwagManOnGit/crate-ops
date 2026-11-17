// Canvas price charts: a line + area chart with optional volume bars and a hover readout,
// and a tiny inline SVG sparkline for table rows.

export interface ChartOpts {
  color: string;
  volume?: number[];
  /** Labels for the first and last point on the time axis. */
  span?: [string, string];
  format?: (v: number) => string;
  /** Called with the hovered index (or -1 when the pointer leaves). */
  onHover?: (i: number) => void;
}

interface ChartState {
  data: number[];
  opts: ChartOpts;
  hover: number;
}

const states = new WeakMap<HTMLCanvasElement, ChartState>();

function paint(cv: HTMLCanvasElement): void {
  const st = states.get(cv);
  if (!st) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const { data, opts } = st;
  const css = getComputedStyle(cv);
  const ink = css.getPropertyValue('--muted').trim() || '#7d8273';
  const line = css.getPropertyValue('--line').trim() || '#39423e';
  const padL = 6;
  const padR = 54;
  const padT = 10;
  const volH = opts.volume ? Math.round(h * 0.18) : 0;
  const padB = 20 + volH;
  let lo = Math.min(...data);
  let hi = Math.max(...data);
  const pad = (hi - lo) * 0.12 || hi * 0.05 || 1;
  lo -= pad;
  hi += pad;
  const X = (i: number): number => padL + (i / (data.length - 1)) * (w - padL - padR);
  const Y = (v: number): number => padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB);
  const f = opts.format || ((v: number) => v.toFixed(2));

  // horizontal grid + price labels
  ctx.font = '500 11px Barlow, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (let k = 0; k <= 3; k++) {
    const v = lo + ((hi - lo) * k) / 3;
    const y = Math.round(Y(v)) + 0.5;
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = ink;
    ctx.fillText(f(v), w - padR + 6, y);
  }

  // volume bars
  if (opts.volume) {
    const vmax = Math.max(...opts.volume) || 1;
    const bw = Math.max(1, (w - padL - padR) / data.length - 1);
    for (let i = 0; i < data.length; i++) {
      const bh = (opts.volume[i] / vmax) * (volH - 2);
      ctx.fillStyle = i > 0 && data[i] < data[i - 1] ? 'rgba(229,83,60,0.45)' : 'rgba(127,196,107,0.4)';
      ctx.fillRect(X(i) - bw / 2, h - 20 - bh, bw, bh);
    }
  }

  // area + line
  const grad = ctx.createLinearGradient(0, padT, 0, h - padB);
  grad.addColorStop(0, opts.color + '44');
  grad.addColorStop(1, opts.color + '00');
  ctx.beginPath();
  ctx.moveTo(X(0), Y(data[0]));
  for (let i = 1; i < data.length; i++) ctx.lineTo(X(i), Y(data[i]));
  ctx.lineTo(X(data.length - 1), h - padB);
  ctx.lineTo(X(0), h - padB);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(X(0), Y(data[0]));
  for (let i = 1; i < data.length; i++) ctx.lineTo(X(i), Y(data[i]));
  ctx.strokeStyle = opts.color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // last price marker
  const last = data.length - 1;
  ctx.fillStyle = opts.color;
  ctx.beginPath();
  ctx.arc(X(last), Y(data[last]), 3.5, 0, Math.PI * 2);
  ctx.fill();

  // time axis
  if (opts.span) {
    ctx.fillStyle = ink;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillText(opts.span[0], padL, h - 5);
    ctx.textAlign = 'right';
    ctx.fillText(opts.span[1], w - padR, h - 5);
  }

  // hover crosshair
  if (st.hover >= 0) {
    const i = st.hover;
    const x = Math.round(X(i)) + 0.5;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, h - padB);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(X(i), Y(data[i]), 4, 0, Math.PI * 2);
    ctx.fill();
    const label = f(data[i]);
    ctx.font = '600 12px Barlow, sans-serif';
    const tw = ctx.measureText(label).width + 12;
    const bx = Math.min(w - padR - tw, Math.max(padL, X(i) - tw / 2));
    const by = Math.max(2, Y(data[i]) - 30);
    ctx.fillStyle = 'rgba(14,18,16,0.92)';
    ctx.fillRect(bx, by, tw, 20);
    ctx.fillStyle = '#e9e5d6';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + 6, by + 10);
  }
}

export function drawChart(cv: HTMLCanvasElement, data: number[], opts: ChartOpts): void {
  const fresh = !states.has(cv);
  states.set(cv, { data, opts, hover: -1 });
  if (fresh) {
    const move = (e: PointerEvent): void => {
      const st = states.get(cv);
      if (!st) return;
      const r = cv.getBoundingClientRect();
      const t = (e.clientX - r.left - 6) / (r.width - 60);
      const i = Math.round(Math.min(1, Math.max(0, t)) * (st.data.length - 1));
      if (i !== st.hover) {
        st.hover = i;
        paint(cv);
        st.opts.onHover?.(i);
      }
    };
    const leave = (): void => {
      const st = states.get(cv);
      if (!st || st.hover < 0) return;
      st.hover = -1;
      paint(cv);
      st.opts.onHover?.(-1);
    };
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerdown', move);
    cv.addEventListener('pointerleave', leave);
    cv.addEventListener('pointercancel', leave);
  }
  paint(cv);
}

/** Inline SVG sparkline for list rows. */
export function spark(data: number[], up: boolean, w = 64, h = 22): string {
  const lo = Math.min(...data);
  const hi = Math.max(...data);
  const span = hi - lo || 1;
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - lo) / span) * (h - 4)).toFixed(1)}`).join(' ');
  return `<svg class="spark ${up ? 'up' : 'down'}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}
