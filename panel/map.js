// Map: a lithographic relief drawn once at startup, and political layers updated every turn.
const NS = 'http://www.w3.org/2000/svg';
const MARGIN = 400, SEA_DEEP = '#1c4c5e';
const SEA_BANDS = [[9, '#9fd0c4'], [22, '#7cbab3'], [40, '#5ba2a6'], [64, '#438a97'], [98, '#357487'], [150, '#2a6275'], [230, '#215668']];
export const TERR = { plains: '#bcc78c', forest: '#86a268', hills: '#c4b481', mountain: '#a8977d', desert: '#e3cd92', marsh: '#8aa585', tundra: '#d6dcd3' };
export const ETHC = ['#4f7fa3', '#b5684a', '#7b8f46', '#8a6aa8', '#c29a3c', '#4a9a8b', '#b0607f', '#71706a'];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const lighten = (hex, t) => { const [r, g, b] = rgb(hex); return `rgb(${Math.round(r + (255 - r) * t)},${Math.round(g + (255 - g) * t)},${Math.round(b + (255 - b) * t)})`; };
const short = n => { const m = /^(.*?) \((.*)\)$/.exec(n), s = m ? m[1] : n; return s.length > 26 ? `${s.slice(0, 25)}…` : s; };

function makeRandom(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function makeNoise(seed) {
  const r = makeRandom(seed), table = new Float32Array(256).map(() => r()), P = new Uint8Array(512);
  const order = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  for (let i = 0; i < 512; i++) P[i] = order[i & 255];
  const n2 = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), X = xi & 255, Y = yi & 255;
    const a = table[P[P[X] + Y]], b = table[P[P[X + 1] + Y]], c = table[P[P[X] + Y + 1]], d = table[P[P[X + 1] + Y + 1]];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return { n2, fbm(x, y, oct = 4) { let t = 0, amp = .5, f = 1; for (let i = 0; i < oct; i++) { t += n2(x * f, y * f) * amp; amp *= .5; f *= 2.03; } return t / (1 - 2 ** -oct); } };
}

const inPoly = (x, y, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [a, b] = poly[i], [d, e] = poly[j]; if ((b > y) !== (e > y) && x < (d - a) * (y - b) / (e - b) + a) c = !c; } return c; };
const bounds = poly => poly.reduce((o, [x, y]) => ({ x0: Math.min(o.x0, x), y0: Math.min(o.y0, y), x1: Math.max(o.x1, x), y1: Math.max(o.y1, y) }), { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 });
const area = poly => Math.abs(poly.reduce((a, [x, y], i) => { const [u, v] = poly[(i + 1) % poly.length]; return a + x * v - u * y; }, 0)) / 2;
const tracePoly = (ctx, poly, ox = 0, oy = 0) => { ctx.beginPath(); poly.forEach(([x, y], i) => i ? ctx.lineTo(x + ox, y + oy) : ctx.moveTo(x + ox, y + oy)); ctx.closePath(); };
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const toUrl = (c, type, q) => new Promise(res => c.toBlob(b => res(URL.createObjectURL(b)), type, q));

function paintSea({ W, H, polys }, noise) {
  const cw = W + MARGIN * 2, ch = H + MARGIN * 2, mask = canvas(cw, ch), m = mask.getContext('2d', { willReadFrequently: true });
  m.fillStyle = '#fff'; m.strokeStyle = '#fff';
  for (const poly of polys) { tracePoly(m, poly, MARGIN, MARGIN); m.fill(); m.stroke(); }
  const land = m.getImageData(0, 0, cw, ch).data, dist = new Float32Array(cw * ch), N = cw * ch;
  for (let i = 0; i < N; i++) dist[i] = land[i * 4 + 3] > 127 ? 0 : 1e6;
  const D = 1, E = Math.SQRT2;
  for (let y = 1; y < ch - 1; y++) for (let x = 1; x < cw - 1; x++) { const i = y * cw + x; dist[i] = Math.min(dist[i], dist[i - 1] + D, dist[i - cw] + D, dist[i - cw - 1] + E, dist[i - cw + 1] + E); }
  for (let y = ch - 2; y > 0; y--) for (let x = cw - 2; x > 0; x--) { const i = y * cw + x; dist[i] = Math.min(dist[i], dist[i + 1] + D, dist[i + cw] + D, dist[i + cw + 1] + E, dist[i + cw - 1] + E); }
  const out = m.createImageData(cw, ch), px = out.data, deep = rgb(SEA_DEEP), bands = SEA_BANDS.map(([t, c]) => [t, rgb(c)]);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const i = y * cw + x, p = i * 4, d0 = dist[i];
    let c = deep, line = 0;
    if (d0 < 300) {
      const d = d0 + (noise.fbm(x * .018, y * .018, 2) - .5) * 26;
      for (const [t, col] of bands) { if (d < t) { c = col; break; } }
      for (const [t] of bands) if (Math.abs(d - t) < .55) line = 1;
    }
    const edge = Math.min(x, y, cw - 1 - x, ch - 1 - y), grain = edge < 40 ? 0 : (noise.n2(x * .9, y * .9) - .5) * 5;
    const k = line ? 14 : 0;
    px[p] = c[0] + grain + k; px[p + 1] = c[1] + grain + k; px[p + 2] = c[2] + grain + k; px[p + 3] = 255;
  }
  m.putImageData(out, 0, 0);
  return toUrl(mask, 'image/webp', .9);
}

function layerOf(w, h, S, polys, colorOf, blur) {
  const raw = canvas(w, h), r = raw.getContext('2d');
  r.scale(S, S); r.lineWidth = 2; r.lineJoin = 'round';
  for (const { id, poly } of polys) { const col = colorOf(id); r.fillStyle = col; r.strokeStyle = col; tracePoly(r, poly); r.fill(); r.stroke(); }
  const soft = canvas(w, h), s = soft.getContext('2d', { willReadFrequently: true });
  s.drawImage(raw, 0, 0); s.filter = `blur(${blur}px)`; s.drawImage(raw, 0, 0); s.filter = 'none';
  return s.getImageData(0, 0, w, h).data;
}

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(src.length), len = 2 * r + 1;
  for (let y = 0; y < h; y++) { let sum = 0, o = y * w; for (let x = -r; x <= r; x++) sum += src[o + clamp(x, 0, w - 1)]; for (let x = 0; x < w; x++) { tmp[o + x] = sum / len; sum += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)]; } }
  for (let x = 0; x < w; x++) { let sum = 0; for (let y = -r; y <= r; y++) sum += tmp[clamp(y, 0, h - 1) * w + x]; for (let y = 0; y < h; y++) { src[y * w + x] = sum / len; sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; } }
}

function paintLand(map, world, noise) {
  const S = 2, { W, H } = map, w = W * S, h = H * S, list = Object.entries(map.polys).map(([id, poly]) => ({ id, poly }));
  const prov = id => world.provinces[id], colors = layerOf(w, h, S, list, id => TERR[prov(id)?.terrain] ?? TERR.plains, 15);
  const elev = layerOf(w, h, S, list, id => { const v = Math.round(clamp(prov(id)?.elevation ?? .2, 0, 1) * 255); return `rgb(${v},${v},${v})`; }, 22);
  const maskC = canvas(w, h), mc = maskC.getContext('2d', { willReadFrequently: true });
  mc.scale(S, S); mc.fillStyle = '#fff'; mc.strokeStyle = '#fff'; mc.lineWidth = .6;
  for (const { poly } of list) { tracePoly(mc, poly); mc.fill(); mc.stroke(); }
  const alpha = mc.getImageData(0, 0, w, h).data, hf = new Float32Array(w * h), base = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) base[i] = elev[i * 4] / 255;
  // 8-bit elevation makes steps in the shading; averaging gives fractional values.
  boxBlur(base, w, h, 5); boxBlur(base, w, h, 5);
  for (let i = 0; i < w * h; i++) {
    if (!alpha[i * 4 + 3]) continue;
    const y = Math.floor(i / w), x = i - y * w, e = base[i], ridge = e > .25 ? 1 - Math.abs(noise.fbm(x * .011, y * .011, 3) * 2 - 1) : 0;
    hf[i] = e + (noise.fbm(x * .006 + 40, y * .006, 3) - .5) * (.05 + e * .28) + ridge * e ** 1.4 * .42;
  }
  const out = mc.createImageData(w, h), px = out.data;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, p = i * 4, a = alpha[p + 3];
    if (!a) continue;
    const shade = clamp(((hf[i - 1] - hf[i + 1]) + (hf[i - w] - hf[i + w])) * 26, -.34, .3), tone = (noise.fbm(x * .0035, y * .0035 + 90, 3) - .5) * .17, grain = (noise.n2(x * .7, y * .7) - .5) * 7, snow = clamp((hf[i] - .98) * 3, 0, .62), k = 1 + shade + tone;
    for (let c = 0; c < 3; c++) { const v = colors[p + c] * k + grain; px[p + c] = v + (247 - v) * snow; }
    px[p + 3] = a;
  }
  const out2 = canvas(w, h), g = out2.getContext('2d');
  g.putImageData(out, 0, 0); g.scale(S, S); g.globalCompositeOperation = 'source-atop';
  drawRivers(g, map, noise); drawGlyphs(g, list, prov);
  g.globalCompositeOperation = 'source-over';
  return toUrl(out2, 'image/webp', .94);
}

function drawRivers(g, map, noise) {
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const [x0, y0, x1, y1, flow] of map.rivers) {
    const len = Math.hypot(x1 - x0, y1 - y0), nx = (y1 - y0) / (len || 1), ny = -(x1 - x0) / (len || 1), steps = Math.max(4, Math.round(len / 9)), pts = [];
    for (let i = 0; i <= steps; i++) { const t = i / steps, off = (noise.fbm((x0 + x1 * .3 + i * 9) * .03, (y0 + i * 7) * .03, 3) - .5) * len * .3 * Math.sin(t * Math.PI); pts.push([x0 + (x1 - x0) * t + nx * off, y0 + (y1 - y0) * t + ny * off]); }
    g.beginPath(); g.moveTo(...pts[0]);
    for (let i = 1; i < pts.length - 1; i++) g.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
    g.lineTo(...pts.at(-1));
    g.strokeStyle = 'rgba(232,240,230,.5)'; g.lineWidth = Math.min(4.2, 1.2 + flow * .34) + 1.3; g.stroke();
    g.strokeStyle = '#3d7f9a'; g.lineWidth = Math.min(4.2, 1.2 + flow * .34); g.stroke();
  }
}

function drawGlyphs(g, list, prov) {
  const peaks = [], trees = [], dunes = [], tufts = [];
  for (const { id, poly } of list) {
    const p = prov(id); if (!p) continue;
    const box = bounds(poly), r = makeRandom(parseInt(id.slice(1), 10) * 7919 + 13), a = area(poly);
    const scatter = (count, sink, pad = 6) => { for (let i = 0, tries = 0; i < count && tries < count * 8; tries++) { const x = box.x0 + r() * (box.x1 - box.x0), y = box.y0 + r() * (box.y1 - box.y0); if (!inPoly(x, y, poly) || Math.hypot(x - p.cx, y - p.cy) < 17 || !poly.every(([u, v]) => Math.hypot(u - x, v - y) > pad)) continue; sink.push({ x, y, s: .75 + r() * .55 }); i++; } };
    if (p.terrain === 'mountain') scatter(Math.ceil(a / 620), peaks, 9);
    if (p.terrain === 'hills') scatter(Math.ceil(a / 1500), peaks.hills ||= [], 8);
    if (p.terrain === 'forest') scatter(Math.ceil(a / 165), trees, 4);
    if (p.terrain === 'desert') scatter(Math.ceil(a / 620), dunes, 6);
    if (p.terrain === 'marsh') scatter(Math.ceil(a / 300), tufts, 5);
  }
  for (const t of [...trees].sort((a, b) => a.y - b.y)) {
    g.fillStyle = 'rgba(46,70,44,.35)'; g.beginPath(); g.ellipse(t.x + .7, t.y + 2.7 * t.s, 3 * t.s, 1.4 * t.s, 0, 0, 7); g.fill();
    g.fillStyle = '#51754a'; g.beginPath(); g.arc(t.x, t.y, 3 * t.s, 0, 7); g.fill();
    g.fillStyle = '#6f9561'; g.beginPath(); g.arc(t.x - .8 * t.s, t.y - .9 * t.s, 1.6 * t.s, 0, 7); g.fill();
  }
  g.lineWidth = 1; g.strokeStyle = 'rgba(122,92,48,.55)';
  for (const d of dunes) { g.beginPath(); g.arc(d.x, d.y, 6 * d.s, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); g.beginPath(); g.arc(d.x + 8 * d.s, d.y + 4 * d.s, 4 * d.s, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); }
  g.strokeStyle = 'rgba(40,74,70,.6)';
  for (const t of tufts) { g.beginPath(); for (const a of [-3, 0, 3]) { g.moveTo(t.x + a * t.s, t.y); g.lineTo(t.x + a * 1.7 * t.s, t.y - 4.5 * t.s); } g.moveTo(t.x - 6 * t.s, t.y + 1); g.lineTo(t.x + 6 * t.s, t.y + 1); g.stroke(); }
  const mount = (x, y, h, w) => {
    g.beginPath(); g.moveTo(x - w, y); g.lineTo(x - w * .25, y - h * .72); g.lineTo(x, y - h); g.lineTo(x + w * .3, y - h * .66); g.lineTo(x + w, y); g.closePath();
    g.fillStyle = 'rgba(205,191,160,.95)'; g.fill();
    g.beginPath(); g.moveTo(x, y - h); g.lineTo(x + w * .3, y - h * .66); g.lineTo(x + w, y); g.lineTo(x + w * .12, y); g.lineTo(x - w * .1, y - h * .42); g.closePath();
    g.fillStyle = 'rgba(92,78,62,.62)'; g.fill();
    g.beginPath(); g.moveTo(x - w * .16, y - h * .82); g.lineTo(x, y - h); g.lineTo(x + w * .18, y - h * .8); g.lineTo(x + w * .02, y - h * .72); g.closePath();
    g.fillStyle = '#f4f2ea'; g.fill();
    g.beginPath(); g.moveTo(x - w, y); g.lineTo(x - w * .25, y - h * .72); g.lineTo(x, y - h); g.lineTo(x + w * .3, y - h * .66); g.lineTo(x + w, y);
    g.strokeStyle = 'rgba(52,44,36,.82)'; g.lineWidth = .9; g.stroke();
  };
  for (const m of [...peaks].sort((a, b) => a.y - b.y)) mount(m.x, m.y, 15 * m.s, 11 * m.s);
  for (const m of [...(peaks.hills || [])].sort((a, b) => a.y - b.y)) { g.beginPath(); g.arc(m.x, m.y + 4 * m.s, 8 * m.s, Math.PI * 1.08, Math.PI * 1.92); g.strokeStyle = 'rgba(92,72,44,.6)'; g.lineWidth = 1.2; g.stroke(); }
}

function edgesOf(polys) {
  const seen = new Map();
  for (const [id, poly] of Object.entries(polys)) for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], A = a.join(), B = b.join(), k = A < B ? `${A}|${B}` : `${B}|${A}`;
    const e = seen.get(k); if (e) e.b = id; else seen.set(k, { a: id, b: null, d: `M${A}L${B}` });
  }
  return [...seen.values()];
}

const SYMBOLS = `
<symbol id="s-capital" viewBox="-11 -11 22 22" overflow="visible"><path d="M0-10 2.8-5.2 8-7 6-1.8 10.4 0 6 2 8 7.2 2.8 5.4 0 10.2-2.8 5.4-8 7.2-6 2-10.4 0-6-1.8-8-7-2.8-5.2z" fill="#f0c95a" stroke="#14242a" stroke-width="1.3" stroke-linejoin="round"/><circle r="2.7" fill="#14242a"/></symbol>
<symbol id="s-city" viewBox="-7 -7 14 14" overflow="visible"><circle r="4.6" fill="#f7f3e6" stroke="#14242a" stroke-width="1.5"/><circle r="1.5" fill="#14242a"/></symbol>
<symbol id="s-town" viewBox="-5 -5 10 10" overflow="visible"><circle r="2.8" fill="#14242a" stroke="#f7f3e6" stroke-width="1"/></symbol>
<symbol id="s-port" viewBox="-7 -7 14 14" overflow="visible"><g fill="none" stroke="#14242a" stroke-width="1.5" stroke-linecap="round"><circle cy="-4.5" r="1.5"/><path d="M0-3v9M-5 1.6C-4.6 5 -2 6 0 6s4.6-1 5-4.4M-2.6-1.4h5.2"/></g></symbol>
<symbol id="s-strat" viewBox="-7 -8 14 16" overflow="visible"><path d="M0-7.4 6 0 0 7.4-6 0z" stroke="#14242a" stroke-width="1.2"/></symbol>
<symbol id="s-battle" viewBox="-12 -12 24 24" overflow="visible"><path d="M0-11 2.6-4.4 9.6-7.4 5.2-1.8 11 2.6 3.8 3 3.2 10.6 0 4.8-3.6 10.4-3.8 3-11 2.2-5.2-1.8-9.2-7.6-2.6-4.4z" fill="#b3362b" stroke="#fff3df" stroke-width="1.2" stroke-linejoin="round"/></symbol>`;

export class WorldMap {
  constructor({ svg, onProvince, onHover, onLeave }) { Object.assign(this, { svg, onProvince, onHover, onLeave }); this.view = null; this.hatch = new Set(); this.dragged = false; }

  async init(map, world) {
    this.map = map;
    const list = Object.values(map.polys), noise = makeNoise(1848);
    const [sea, land] = [await paintSea({ ...map, polys: list }, noise), await paintLand(map, world, noise)];
    this.edges = edgesOf(map.polys);
    const inner = this.edges.filter(e => e.b).map(e => e.d).join(''), coast = this.edges.filter(e => !e.b).map(e => e.d).join('');
    this.svg.innerHTML = `<defs>${SYMBOLS}<g id="patterns"></g></defs>
      <image href="${sea}" x="${-MARGIN}" y="${-MARGIN}" width="${map.W + MARGIN * 2}" height="${map.H + MARGIN * 2}"/>
      <path class="surf" d="${coast}"/>
      <image href="${land}" x="0" y="0" width="${map.W}" height="${map.H}"/>
      <g id="tints"></g><path class="provlines" d="${inner}"/><path class="coast" d="${coast}"/>
      <g id="routes"></g><path id="borders" class="borders"/><path id="selglow" class="selglow"/><path id="selline" class="selline"/>
      <g id="hits"></g><path id="provsel" class="provsel"/><g id="marks"></g><g id="labels"></g>`;
    const $ = id => this.svg.querySelector(`#${id}`);
    this.g = { tints: $('tints'), routes: $('routes'), hits: $('hits'), marks: $('marks'), labels: $('labels'), borders: $('borders'), selglow: $('selglow'), selline: $('selline'), provsel: $('provsel'), patterns: $('patterns') };
    this.tints = {}; let a = '', b = '';
    for (const [id, poly] of Object.entries(map.polys)) { const pts = poly.map(q => q.join()).join(' '); a += `<polygon data-t="${id}" points="${pts}"/>`; b += `<polygon class="hit" data-p="${id}" points="${pts}"/>`; }
    this.g.tints.innerHTML = a; this.g.hits.innerHTML = b;
    this.g.tints.querySelectorAll('polygon').forEach(el => this.tints[el.dataset.t] = el);
    this.wireInput();
    this.fit();
    new ResizeObserver(() => { if (this.fitted) this.fit(); else this.apply(); }).observe(this.svg);
  }

  size() { const r = this.svg.getBoundingClientRect(); return { cw: r.width || 1, ch: r.height || 1, left: r.left, top: r.top }; }
  obscured() { return this.getObscured?.() ?? 0; }
  fit() {
    const { W, H } = this.map, { cw, ch } = this.size(), visW = Math.max(320, cw - this.obscured()), s = Math.min(visW / W, ch / H) * .96;
    this.view = { x: W / 2 - visW / 2 / s, y: H / 2 - ch / 2 / s, w: cw / s, h: ch / s }; this.fitted = true; this.apply();
  }
  apply() {
    const v = this.view, { cw, ch } = this.size();
    v.h = v.w * ch / cw;
    this.svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
    const k = v.w / cw;
    this.svg.style.setProperty('--k', k.toFixed(4));
    this.svg.classList.toggle('near', v.w < this.map.W * .62);
    this.svg.classList.toggle('close', v.w < this.map.W * .34);
  }
  clampView() { const { W, H } = this.map, v = this.view; v.x = clamp(v.x, -MARGIN * 1.4, W + MARGIN * .4 - Math.min(v.w, W)); v.y = clamp(v.y, -MARGIN * 1.2, H + MARGIN * .4 - Math.min(v.h, H)); }
  zoom(f, cx = .5, cy = .5) {
    const v = this.view, { W } = this.map, nw = clamp(v.w * f, W * .12, W * 1.9), nh = nw * v.h / v.w;
    this.fitted = false; this.view = { x: v.x + (v.w - nw) * cx, y: v.y + (v.h - nh) * cy, w: nw, h: nh }; this.clampView(); this.apply();
  }
  focus(x, y, zoomTo) {
    const { cw } = this.size(), v = this.view, w = zoomTo ?? Math.min(v.w, this.map.W * .6), h = w * v.h / v.w, visible = (cw - this.obscured()) / cw;
    this.fitted = false; this.view = { x: x - w * visible / 2, y: y - h / 2, w, h }; this.clampView(); this.apply();
  }
  wireInput() {
    const s = this.svg; let drag = null;
    s.addEventListener('wheel', e => { e.preventDefault(); const r = s.getBoundingClientRect(); this.zoom(e.deltaY < 0 ? .86 : 1.16, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); }, { passive: false });
    s.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY, v: { ...this.view } }; this.dragged = false; });
    window.addEventListener('mousemove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) < 5 && !this.dragged) return;
      this.dragged = true; this.fitted = false; s.classList.add('drag');
      const k = drag.v.w / this.size().cw; this.view = { ...drag.v, x: drag.v.x - dx * k, y: drag.v.y - dy * k }; this.clampView(); this.apply();
    });
    window.addEventListener('mouseup', () => { drag = null; s.classList.remove('drag'); setTimeout(() => this.dragged = false, 0); });
    const hits = this.g.hits;
    hits.addEventListener('click', e => { const id = e.target.dataset?.p; if (id && !this.dragged) this.onProvince(id); });
    hits.addEventListener('mousemove', e => { const id = e.target.dataset?.p; if (id && !drag) this.onHover(e, id); });
    hits.addEventListener('mouseleave', () => this.onLeave());
  }

  tintFor(p, layer, w, eths) {
    if (layer === 'terrain' || layer === 'resources') return null;
    if (layer === 'unrest') { const t = clamp(p.unrest / 100, 0, 1); return `rgb(${Math.round(250 - t * 60)},${Math.round(240 - t * 190)},${Math.round(226 - t * 190)})`; }
    if (layer === 'ethnic') return ETHC[eths.indexOf(p.eth) % ETHC.length];
    const col = id => w.countries[id]?.colors?.[0] ?? '#8a9a94';
    if (p.controller === p.owner) return col(p.controller);
    const key = `h-${p.controller}-${p.owner}`;
    if (!this.hatch.has(key)) { this.hatch.add(key); this.g.patterns.insertAdjacentHTML('beforeend', `<pattern id="${key}" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="${col(p.owner)}"/><rect width="5" height="10" fill="${col(p.controller)}"/></pattern>`); }
    return `url(#${key})`;
  }

  render(w, { layer, country, province }) {
    if (!this.g) return;
    const eths = [...new Set(Object.values(w.provinces).map(p => p.eth))];
    this.g.tints.setAttribute('class', layer === 'trade' ? 'faint' : layer === 'unrest' ? 'heat' : '');
    for (const [id, el] of Object.entries(this.tints)) { const p = w.provinces[id], f = p ? this.tintFor(p, layer, w, eths) : null; el.setAttribute('fill', f ?? 'none'); }
    const owner = id => w.provinces[id]?.controller;
    const political = layer === 'political' || layer === 'trade';
    let borders = '', sel = '';
    for (const e of this.edges) {
      const a = owner(e.a), b = e.b ? owner(e.b) : null;
      if (e.b && a !== b && political) borders += e.d;
      if (country && (a === country) !== (b === country)) sel += e.d;
    }
    this.g.borders.setAttribute('d', borders); this.g.selglow.setAttribute('d', sel); this.g.selline.setAttribute('d', sel);
    this.g.provsel.setAttribute('d', province && this.map.polys[province] ? `M${this.map.polys[province].map(q => q.join()).join('L')}Z` : '');
    this.g.routes.innerHTML = layer === 'trade' ? this.routes(w) : '';
    this.g.marks.innerHTML = this.marks(w, layer);
    this.g.labels.innerHTML = this.labels(w, political);
  }

  routes(w) {
    let x = ''; const flows = w.tradeFlows || {}, cap = id => w.provinces[w.countries[id]?.capital];
    for (const [k, r] of Object.entries(w.routes || {})) {
      const [a, b] = k.split('|'), v = Object.values(flows[k] || {}).reduce((s, n) => s + n, 0); if (!v) continue;
      const A = cap(a), B = cap(b); if (!A || !B) continue;
      const pts = r.mode === 'sea' ? [[A.cx, A.cy], ...r.path.map(s => [w.seas[s].cx, w.seas[s].cy]), [B.cx, B.cy]] : [[A.cx, A.cy], [B.cx, B.cy]];
      x += `<polyline class="route" stroke="${r.mode === 'sea' ? '#f6df98' : '#6c3f1c'}" stroke-width="${Math.min(8, 1 + Math.sqrt(v) * .07)}" stroke-dasharray="${r.tolls.length ? '7 5' : '0'}" points="${pts.map(q => q.join()).join(' ')}"/>`;
    }
    return x;
  }

  marks(w, layer) {
    const color = id => w.countries[id]?.colors?.[0] ?? '#8a9a94', sym = (cx, cy, body, cls = '') => `<g class="sym ${cls}" style="--x:${cx}px;--y:${cy}px">${body}</g>`;
    const use = (id, s, fill = '') => `<use href="#${id}" x="${-s / 2}" y="${-s / 2}" width="${s}" height="${s}"${fill ? ` fill="${fill}"` : ''}/>`;
    let x = '';
    const provs = Object.values(w.provinces), popOf = p => Object.values(p.pops).reduce((a, q) => a + q.n, 0), ranked = [...provs].sort((a, b) => popOf(b) - popOf(a)), big = new Set(ranked.slice(0, Math.ceil(provs.length * .28)).map(p => p.id));
    const capitals = new Set(Object.values(w.countries).filter(c => c.alive).map(c => c.capital));
    if (layer === 'resources') {
      const CHIP = { coal: 'Co', iron: 'Fe', copper: 'Cu', oil: 'Oi', phosphate: 'Ph', rare: 'Ra', gold: 'Au' };
      for (const p of provs) { const list = Object.entries(p.deposits); if (!list.length) continue; x += sym(p.cx, p.cy, list.map(([k, d], i) => `<g class="${d.amount > 0 ? '' : 'spent'}" transform="translate(${(i - (list.length - 1) / 2) * 20},0)"><rect x="-9" y="-7" width="18" height="14" rx="1" fill="${d.known ? '#f7f3e6' : 'rgba(247,243,230,.35)'}" stroke="#14242a" stroke-dasharray="${d.known ? '0' : '2 2'}"/><text y="3.6" class="chiptext">${CHIP[k]}</text></g>`).join('')); }
    }
    for (const p of provs) {
      if (capitals.has(p.id)) x += sym(p.cx, p.cy - 3, use('s-capital', 22));
      else if (big.has(p.id)) x += sym(p.cx, p.cy - 3, use('s-city', 13));
      else x += sym(p.cx, p.cy - 3, use('s-town', 8));
      if (p.port > 0 && p.seas[0] && w.seas[p.seas[0]]) { const s = w.seas[p.seas[0]], d = Math.hypot(s.cx - p.cx, s.cy - p.cy) || 1; x += sym(p.cx + (s.cx - p.cx) / d * 18, p.cy + (s.cy - p.cy) / d * 18, use('s-port', 13), 'portmark'); }
    }
    if (layer === 'political' || layer === 'trade') {
      const totals = {};
      for (const u of Object.values(w.units)) { const k = `${u.province}|${u.country}`; (totals[k] ||= { men: 0, province: u.province, country: u.country, armor: false }).men += u.men; if (u.kind === 'armor') totals[k].armor = true; }
      const seen = {};
      for (const t of Object.values(totals)) {
        const p = w.provinces[t.province]; if (!p) continue;
        const n = seen[p.id] = (seen[p.id] || 0) + 1, offset = (n - 1) * 34;
        x += sym(p.cx + offset, p.cy + 13, `<rect x="-16" y="-9" width="33" height="18" rx="1.5" class="chit"/><rect x="-16" y="-9" width="14" height="18" rx="1.5" fill="${color(t.country)}"/>${t.armor ? '<ellipse cx="-9" rx="4.2" ry="2.6" fill="none" stroke="#fff" stroke-width="1.4"/>' : '<path d="M-13.5-4.5h9v9h-9zM-13.5-4.5l9 9M-4.5-4.5l-9 9" fill="none" stroke="#fff" stroke-width="1.2"/>'}<text x="8" y="3.5" class="chitn">${Math.round(t.men)}</text>`);
      }
      for (const f of Object.values(w.fleets || {})) { const s = w.seas[f.sea]; if (s) x += sym(s.cx, s.cy, `<rect x="-16" y="-9" width="33" height="18" rx="1.5" class="chit"/><rect x="-16" y="-9" width="14" height="18" rx="1.5" fill="${color(f.country)}"/><path d="M-14 1.4h10l-2 3.4h-6zM-9 1.4v-6.6l4 4.6h-4" fill="#fff"/><text x="8" y="3.5" class="chitn">${Math.round(f.ships)}</text>`); }
      for (const b of w.battles || []) { const p = w.provinces[b.province]; if (p) x += sym(p.cx, p.cy - 16, use('s-battle', 24), 'battle'); }
    }
    for (const s of w.strategic || []) { const q = s.type === 'strait' ? w.seas[s.ref] : w.provinces[s.ref]; if (!q || (s.type === 'port' && layer !== 'trade')) continue; x += `<g class="sym" style="--x:${q.cx}px;--y:${q.cy - 20}px"><title>${esc(s.name)}</title>${use('s-strat', 14, s.closed ? '#b3362b' : '#f0c95a')}</g>`; }
    return x;
  }

  labels(w, political) {
    let x = '';
    for (const p of Object.values(w.provinces)) x += `<g class="sym plabelg" style="--x:${p.cx}px;--y:${p.cy + 34}px"><text class="plabel">${esc(p.name)}</text></g>`;
    if (political) for (const c of Object.values(w.countries)) {
      if (!c.alive) continue;
      const ps = Object.values(w.provinces).filter(p => p.controller === c.id); if (!ps.length) continue;
      const mx = ps.reduce((a, p) => a + p.cx, 0) / ps.length, my = ps.reduce((a, p) => a + p.cy, 0) / ps.length;
      x += `<text class="clabel" x="${mx}" y="${my}">${esc(short(c.name))}</text>`;
    }
    return x;
  }
}
