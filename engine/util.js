export const clamp = (v, a, b) => Math.max(a, Math.min(b, Number.isFinite(v) ? v : a));
export const sum = (xs, f = x => x) => xs.reduce((a, x) => a + f(x), 0);
export const round = (v, d = 2) => { const m = 10 ** d; return Math.round(v * m) / m; };
export function rand(w) {
  w.rng = (w.rng + 0x6D2B79F5) | 0;
  let t = w.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const between = (w, a, b) => a + rand(w) * (b - a);
export const pick = (w, xs) => xs[Math.floor(rand(w) * xs.length)];
export const nextId = (w, p) => `${p}${++w.seq}`;
export function news(w, text, opts = {}) {
  w.newsThisTurn.push({ turn: w.turn, text, kind: opts.kind || 'genel', countries: opts.countries || [], secret: !!opts.secret });
}
export const quarterLabel = t => `${1900 + Math.floor(t / 4)} Ç${(t % 4) + 1}`;
