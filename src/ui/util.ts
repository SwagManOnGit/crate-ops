// Formatting + tiny DOM helpers shared by every screen.

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c]);

const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

/** Credits: cents below 1,000, grouped integers below a million, then 1.23M style. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const neg = n < 0;
  n = Math.abs(n);
  let out: string;
  if (n < 1000) out = n.toFixed(2);
  else if (n < 1e6) out = Math.floor(n).toLocaleString('en-US');
  else {
    const tier = Math.min(SUFFIX.length - 1, Math.floor(Math.log10(n) / 3));
    const v = n / Math.pow(10, tier * 3);
    out = (v >= 100 ? v.toFixed(1) : v.toFixed(2)) + SUFFIX[tier];
  }
  return neg ? '-' + out : out;
}

/** Income per second: keeps small rates readable. */
export function fmtRate(n: number): string {
  if (n < 0.1) return n.toFixed(3);
  if (n < 1000) return n.toFixed(2);
  return fmt(n);
}

export function fmtPct(p: number, digits = 1): string {
  return (p >= 0 ? '+' : '') + p.toFixed(digits) + '%';
}

export function fmtTime(sec: number): string {
  sec = Math.max(0, Math.ceil(sec));
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  if (sec >= 60) return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  return `${sec}s`;
}

/** Credits with the coin glyph. */
export const cr = (n: number, cls = ''): string => `<span class="cr ${cls}">${fmt(n)}</span>`;

export const upDown = (p: number): string => `<span class="${p >= 0 ? 'up' : 'down'}">${fmtPct(p)}</span>`;

export function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Inline icons (24px grid, stroke = currentColor). */
const I = (d: string): string => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON: Record<string, string> = {
  crates: I('<path d="M3 8.5 12 4l9 4.5v8L12 21l-9-4.5z"/><path d="M3 8.5 12 13l9-4.5M12 13v8M7.5 6.2l9 4.6"/>'),
  armory: I('<path d="M3 10h11l2-2h5v3h-3l-1 2h-5l-1 5H7l1-5H3z"/><path d="M12 13v2"/>'),
  market: I('<path d="M3 19h18"/><path d="m4 15 5-5 4 3 7-8"/><path d="M15 5h5v5"/>'),
  trade: I('<path d="M12 3v4M12 17v4M4.2 7.5l3.4 2M16.4 14.5l3.4 2M4.2 16.5l3.4-2M16.4 9.5l3.4-2"/><circle cx="12" cy="12" r="3.2"/>'),
  battle: I('<path d="m5 4 9 9M4 5l9 9"/><path d="m19 4-9 9M20 5l-9 9"/><path d="M4 20l3-3M20 20l-3-3M6 15l3 3M18 15l-3 3"/>'),
  hq: I('<path d="M4 20V9l8-5 8 5v11"/><path d="M9 20v-6h6v6M4 20h16"/>'),
  lock: I('<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  unlock: I('<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>'),
  close: I('<path d="M6 6l12 12M18 6 6 18"/>'),
  check: I('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  chute: I('<path d="M4 10a8 8 0 0 1 16 0z"/><path d="M4 10l7 8M20 10l-7 8M12 10v8"/><rect x="10" y="18" width="4" height="3"/>'),
  bolt: I('<path d="M13 3 5 13h6l-1 8 8-10h-6z"/>'),
  medal: I('<circle cx="12" cy="15" r="5"/><path d="M9 3h6l-1.5 7h-3z"/>'),
  search: I('<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>'),
  back: I('<path d="M14 6l-6 6 6 6"/>'),
  play: I('<path d="M8 5v14l11-7z"/>'),
  rack: I('<path d="M4 5h16M4 12h16M4 19h16M6 5v14M18 5v14"/>'),
  truck: I('<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7.5" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/>'),
  eye: I('<path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.6"/>'),
  glove: I('<path d="M7 20v-6l-2-3V7a1.5 1.5 0 0 1 3 0v3-6a1.5 1.5 0 0 1 3 0v5-6a1.5 1.5 0 0 1 3 0v6-4a1.5 1.5 0 0 1 3 0v9l-2 6z"/>'),
  badge: I('<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="m9 12 2 2 4-4"/>'),
  stack: I('<path d="m12 3 9 4.5-9 4.5-9-4.5z"/><path d="m3 12 9 4.5 9-4.5M3 16.5 12 21l9-4.5"/>'),
  moon: I('<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>'),
};
