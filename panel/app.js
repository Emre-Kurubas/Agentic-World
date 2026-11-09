const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TABS = [['dunya', 'Dünya'], ['ulke', 'Ülke'], ['eyalet', 'Eyalet'], ['kaynak', 'Kaynaklar'], ['zihin', 'Zihinler'], ['gizli', 'Yazışmalar'], ['hakem', 'Hakem'], ['haber', 'Haberler']];
const LAYERS = [['siyasi', 'Siyasi'], ['arazi', 'Arazi'], ['kaynak', 'Kaynaklar'], ['rota', 'Ticaret'], ['huzur', 'Huzursuzluk'], ['etnik', 'Etnik']];
const ROLE = { leader: 'Lider', general: 'General', opposition: 'Muhalefet', oligarch: 'Oligark', eski_lider: 'Eski lider' };
const GTR = { grain: 'Tahıl', timber: 'Kereste', coal: 'Kömür', iron: 'Demir', copper: 'Bakır', oil: 'Petrol', phosphate: 'Fosfat', rare: 'Nadir metal', gold: 'Altın', steel: 'Çelik', fuel: 'Yakıt', fertilizer: 'Gübre', machines: 'Makine', goods: 'Tüketim malı', arms: 'Silah' };
const CHIP = { coal: 'Kö', iron: 'De', copper: 'Ba', oil: 'Pe', phosphate: 'Fo', rare: 'Na', gold: 'Al' };
const TERR = { ova: '#c2c98a', orman: '#6f9460', tepe: '#b2a877', dag: '#8f8a80', col: '#dcc68c', bataklik: '#7f9a83', tundra: '#ced6d2' };
const TERR_TR = { ova: 'Ova', orman: 'Orman', tepe: 'Tepelik', dag: 'Dağ', col: 'Çöl', bataklik: 'Bataklık', tundra: 'Tundra' };
const ST = { bogaz: 'Boğaz', gecit: 'Geçit', kopru: 'Köprü', liman: 'Doğal liman', kanal_adayi: 'Kanal güzergâhı', kanal: 'Kanal' };
const ETHC = ['#4f7fa3', '#b5684a', '#7b8f46', '#8a6aa8', '#c29a3c', '#4a9a8b', '#b0607f', '#71706a'];
const S = { map: null, meta: null, turn: 0, last: -1, data: null, tab: 'dunya', layer: 'siyasi', country: null, province: null, live: true, marks: {}, view: null };
const fmt = n => Math.round(n).toLocaleString('tr-TR');
const api = p => fetch(p, { cache: 'no-store' }).then(r => r.json());
const NS = 'http://www.w3.org/2000/svg';
const country = id => S.data?.world.countries[id];
const cColor = id => country(id)?.colors?.[0] ?? '#8a9a94';

function renderChrome() {
  $('tabs').innerHTML = TABS.map(([k, t]) => `<button role="tab" type="button" data-t="${k}" aria-selected="${S.tab === k}">${t}</button>`).join('');
  $('tabs').querySelectorAll('button').forEach(b => b.onclick = () => { S.tab = b.dataset.t; openDrawer(); renderChrome(); renderBody(); });
  $('layers').innerHTML = LAYERS.map(([k, t]) => `<button type="button" data-l="${k}" aria-pressed="${S.layer === k}">${t}</button>`).join('');
  $('layers').querySelectorAll('button').forEach(b => b.onclick = () => { S.layer = b.dataset.l; renderChrome(); drawMap(); });
}
const openDrawer = () => $('drawer').classList.remove('closed');
$('toggle').onclick = () => $('drawer').classList.toggle('closed');

function fillOf(p, defs, hatch, ethIdx) {
  if (S.layer === 'arazi') return TERR[p.terrain];
  if (S.layer === 'kaynak') return '#d9dfca';
  if (S.layer === 'huzur') { const t = p.unrest / 100; return `rgb(${Math.round(232 - t * 70)},${Math.round(226 - t * 170)},${Math.round(208 - t * 165)})`; }
  if (S.layer === 'etnik') return ETHC[ethIdx(p.eth) % ETHC.length];
  if (p.controller !== p.owner) { const k = `h-${p.controller}-${p.owner}`; if (!hatch.has(k)) { hatch.add(k); defs.insertAdjacentHTML('beforeend', `<pattern id="${k}" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="9" height="9" fill="${cColor(p.owner)}"/><rect width="5" height="9" fill="${cColor(p.controller)}"/></pattern>`); } return `url(#${k})`; }
  return cColor(p.controller);
}

function drawMap() {
  if (!S.data || !S.map) return;
  const { W, H, polys, rivers } = S.map, svg = $('map'), w = S.data.world;
  S.view ||= { x: 0, y: 0, w: W, h: H };
  svg.setAttribute('viewBox', `${S.view.x} ${S.view.y} ${S.view.w} ${S.view.h}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.innerHTML = '<defs></defs>';
  const defs = svg.querySelector('defs'), g = document.createElementNS(NS, 'g'), hatch = new Set(), eths = [...new Set(Object.values(w.provinces).map(p => p.eth))], ethIdx = e => eths.indexOf(e);
  const tint = S.layer === 'siyasi' || S.layer === 'rota';
  for (const [id, poly] of Object.entries(polys)) {
    const p = w.provinces[id]; if (!p) continue;
    const el = document.createElementNS(NS, 'polygon');
    el.setAttribute('points', poly.map(a => a.join(',')).join(' '));
    el.setAttribute('class', 'prov' + (p.id === S.province ? ' sel' : ''));
    el.setAttribute('fill', fillOf(p, defs, hatch, ethIdx));
    if (S.layer === 'rota') el.setAttribute('fill-opacity', '.55');
    el.onmousemove = e => tip(e, p); el.onmouseleave = () => $('tip').hidden = true;
    el.onclick = () => { if (S.dragged) return; S.province = p.id; S.country = p.controller; S.tab = 'eyalet'; openDrawer(); renderChrome(); renderAll(); };
    g.appendChild(el);
  }
  svg.appendChild(g);
  let x = '';
  for (const [a, b, c, d, f] of rivers) x += `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}" stroke="#3b7f9a" stroke-width="${Math.min(5, .9 + f * .35)}" stroke-linecap="round"/>`;
  for (const p of Object.values(w.provinces)) if (['dag', 'tepe'].includes(p.terrain)) { const s = p.terrain === 'dag' ? 9 : 5.5; x += `<path d="M${p.cx - s} ${p.cy + 15}l${s}-${s * 1.7}l${s} ${s * 1.7}" fill="none" stroke="#3a3a35" stroke-width="1.3" opacity=".72"/>`; }
  if (S.layer === 'kaynak') {
    for (const p of Object.values(w.provinces)) { const list = Object.entries(p.deposits); list.forEach(([k, d], i) => { const col = d.known ? '#f3efdf' : 'none'; const bx = p.cx - list.length * 9 + i * 18, by = p.cy - 2; x += `<g opacity="${d.amount > 0 ? 1 : .35}"><rect x="${bx}" y="${by}" width="17" height="13" fill="${col}" stroke="#1a2c2e" stroke-dasharray="${d.known ? '0' : '2 2'}"/><text x="${bx + 8.5}" y="${by + 10}" text-anchor="middle" style="font:700 9.5px var(--sans)" fill="#132528">${CHIP[k]}</text></g>`; }); }
  }
  if (S.layer === 'rota') {
    const flows = w.tradeFlows || {}, cap = id => w.provinces[country(id)?.capital];
    for (const [k, r] of Object.entries(w.routes || {})) {
      const [a, b] = k.split('|'), v = Object.values(flows[k] || {}).reduce((s, n) => s + n, 0); if (!v) continue;
      const A = cap(a), B = cap(b); if (!A || !B) continue;
      const pts = r.mode === 'deniz' ? [[A.cx, A.cy], ...r.path.map(s => [w.seas[s].cx, w.seas[s].cy]), [B.cx, B.cy]] : [[A.cx, A.cy], [B.cx, B.cy]];
      x += `<polyline fill="none" stroke="${r.mode === 'deniz' ? '#f0d68b' : '#6c3f1c'}" stroke-width="${Math.min(8, 1 + Math.sqrt(v) * .07)}" stroke-linejoin="round" stroke-dasharray="${r.tolls.length ? '7 5' : '0'}" points="${pts.map(q => q.join(',')).join(' ')}" opacity=".88"/>`;
    }
  }
  if (tint) {
    const totals = {};
    for (const u of Object.values(w.units)) { const k = `${u.province}|${u.country}`; totals[k] = (totals[k] || { men: 0, province: u.province, country: u.country }); totals[k].men += u.men; }
    for (const t of Object.values(totals)) { const p = w.provinces[t.province]; if (p) x += `<circle cx="${p.cx}" cy="${p.cy}" r="${Math.max(3.5, Math.sqrt(t.men) * .75)}" fill="#f2efe1" stroke="${cColor(t.country)}" stroke-width="2.5"/>`; }
    for (const f of Object.values(w.fleets || {})) { const s = w.seas[f.sea]; if (s) x += `<path d="M${s.cx - 10} ${s.cy}h20l-5 6h-10z M${s.cx} ${s.cy}v-9l7 7z" fill="#f2efe1" stroke="${cColor(f.country)}" stroke-width="1.8"/>`; }
    for (const b of w.battles || []) { const p = w.provinces[b.province]; if (p) x += `<path transform="translate(${p.cx},${p.cy})" d="M-9-9 9 9M9-9-9 9" stroke="#a8322b" stroke-width="3.2"/>`; }
  }
  for (const s of w.strategic || []) { const q = s.type === 'bogaz' ? w.seas[s.ref] : w.provinces[s.ref]; if (!q || (s.type === 'liman' && S.layer !== 'rota')) continue; x += `<g><title>${esc(s.name)}</title><path transform="translate(${q.cx},${q.cy - 16})" d="M0-7 6 0 0 7-6 0z" fill="${s.closed ? '#a8322b' : '#e8c878'}" stroke="#16282c" stroke-width="1.2"/></g>`; }
  for (const c of Object.values(w.countries)) if (c.alive && w.provinces[c.capital] && tint) { const p = w.provinces[c.capital]; x += `<circle cx="${p.cx}" cy="${p.cy - 12}" r="3.6" fill="#f4dc9b" stroke="#16282c"/>`; }
  if (S.view.w < W * .55) for (const p of Object.values(w.provinces)) x += `<text class="plabel" x="${p.cx}" y="${p.cy + 22}">${esc(p.name)}</text>`;
  if (tint) for (const c of Object.values(w.countries)) { if (!c.alive) continue; const ps = Object.values(w.provinces).filter(p => p.controller === c.id); if (!ps.length) continue; x += `<text class="clabel" x="${ps.reduce((a, p) => a + p.cx, 0) / ps.length}" y="${ps.reduce((a, p) => a + p.cy, 0) / ps.length}">${esc(short(c.name))}</text>`; }
  g.insertAdjacentHTML('afterend', x);
  drawLegend(eths);
}
const short = n => { const m = /^(.*?) \((.*)\)$/.exec(n), s = m ? m[1] : n; return s.length > 24 ? s.slice(0, 23) + '…' : s; };
function drawLegend(eths) {
  const base = `<span><svg width="14" height="14"><path d="M7 0l6 7-6 7-6-7z" fill="#e8c878" stroke="#16282c"/></svg>Stratejik nokta</span>`;
  const L = {
    siyasi: `<span><svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="#f2efe1" stroke="#16282c" stroke-width="2"/></svg>Ordu</span><span><svg width="16" height="12"><path d="M1 7h14l-3 4H4z" fill="#f2efe1" stroke="#16282c"/></svg>Filo</span><span><svg width="14" height="14"><path d="M2 2 12 12M12 2 2 12" stroke="#a8322b" stroke-width="2.6"/></svg>Muharebe</span><span><svg width="14" height="14"><rect width="14" height="14" fill="#bbb"/><path d="M0 14 14 0M-3 7 7-3M7 17 17 7" stroke="#444" stroke-width="3"/></svg>İşgal</span>`,
    arazi: Object.entries(TERR).map(([k, c]) => `<span><span class="swatch" style="background:${c};margin:0"></span>${TERR_TR[k]}</span>`).join(''),
    kaynak: Object.entries(CHIP).map(([k, c]) => `<span><span class="chip">${c}</span>${GTR[k]}</span>`).join('') + '<span>Kesik çizgi: henüz keşfedilmedi</span>',
    rota: '<span><svg width="20" height="8"><line x2="20" y1="4" y2="4" stroke="#f0d68b" stroke-width="3"/></svg>Deniz</span><span><svg width="20" height="8"><line x2="20" y1="4" y2="4" stroke="#6c3f1c" stroke-width="3"/></svg>Kara</span><span>Kesikli: ücretli</span>',
    huzur: '<span>Açık: sakin</span><span style="width:70px;height:9px;background:linear-gradient(90deg,rgb(232,226,208),rgb(162,56,43))"></span><span>Koyu: ayaklanma</span>',
    etnik: eths.map((e, i) => `<span><span class="swatch" style="background:${ETHC[i % ETHC.length]};margin:0"></span>${esc(e)}</span>`).join('')
  };
  $('legend').innerHTML = L[S.layer] + base;
}
function tip(e, p) {
  const w = S.data.world, t = $('tip'), box = $('wrap').getBoundingClientRect(), men = Object.values(w.units).filter(u => u.province === p.id).reduce((a, u) => a + u.men, 0), dep = Object.entries(p.deposits).map(([k, d]) => GTR[k] + (d.known ? '' : ' (gizli)')).join(', ');
  t.hidden = false; t.innerHTML = `<b>${esc(p.name)}</b><br>${esc(country(p.controller)?.name)}, ${TERR_TR[p.terrain]}<br>Nüfus ${fmt(Object.values(p.pops).reduce((a, x) => a + x.n, 0))} bin, huzursuzluk ${Math.round(p.unrest)}<br>${esc(p.eth)}, ${esc(p.rel)}<br>Asker ${fmt(men)} bin${dep ? `<br>Yataklar: ${esc(dep)}` : ''}`;
  t.style.left = Math.min(e.clientX - box.left + 14, box.width - 300) + 'px'; t.style.top = Math.min(e.clientY - box.top + 14, box.height - 150) + 'px';
}
// Yakınlaştırma ve sürükleme
const zoom = (f, cx = .5, cy = .5) => { const v = S.view, { W, H } = S.map, nw = Math.max(W * .14, Math.min(W, v.w * f)), nh = nw * H / W; S.view = { x: Math.max(0, Math.min(W - nw, v.x + (v.w - nw) * cx)), y: Math.max(0, Math.min(H - nh, v.y + (v.h - nh) * cy)), w: nw, h: nh }; drawMap(); };
$('zin').onclick = () => zoom(.75); $('zout').onclick = () => zoom(1.33); $('zreset').onclick = () => { S.view = null; drawMap(); };
$('map').addEventListener('wheel', e => { e.preventDefault(); const r = $('map').getBoundingClientRect(); zoom(e.deltaY < 0 ? .85 : 1.18, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); }, { passive: false });
let drag = null;
$('map').onmousedown = e => { drag = { x: e.clientX, y: e.clientY, v: { ...S.view } }; S.dragged = false; };
window.addEventListener('mousemove', e => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) < 5 && !S.dragged) return; S.dragged = true; $('map').classList.add('drag'); const r = $('map').getBoundingClientRect(), { W, H } = S.map, k = drag.v.w / r.width; S.view = { ...drag.v, x: Math.max(0, Math.min(W - drag.v.w, drag.v.x - dx * k)), y: Math.max(0, Math.min(H - drag.v.h, drag.v.y - dy * k)) }; $('map').setAttribute('viewBox', `${S.view.x} ${S.view.y} ${S.view.w} ${S.view.h}`); });
window.addEventListener('mouseup', () => { if (drag && S.dragged) { drawMap(); setTimeout(() => S.dragged = false, 0); } drag = null; $('map').classList.remove('drag'); });

function chart(title, data, unit = '') {
  const vals = data.map(d => d.v).filter(v => Number.isFinite(v)), last = vals.at(-1) ?? 0;
  if (vals.length < 2) return `<div class="chart"><h4>${title}<span class="v">${last}${unit}</span></h4><p class="small muted">Veri birikiyor.</p></div>`;
  const min = Math.min(...vals), max = Math.max(...vals), W = 200, H = 54, sx = i => i * W / (vals.length - 1), sy = v => H - 3 - (v - min) / ((max - min) || 1) * (H - 8);
  return `<div class="chart" data-points='${esc(JSON.stringify(data))}' data-unit="${unit}"><h4>${title}<span class="v">${last.toLocaleString('tr-TR')}${unit}</span></h4><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="${title}: son değer ${last}${unit}"><line x1="0" x2="${W}" y1="${H - 1}" y2="${H - 1}" stroke="#a9b9ab" vector-effect="non-scaling-stroke"/><polyline fill="none" stroke="#1d5560" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" points="${vals.map((v, i) => `${sx(i)},${sy(v)}`).join(' ')}"/></svg><div class="small muted">aralık ${min.toLocaleString('tr-TR')} ile ${max.toLocaleString('tr-TR')}${unit}</div></div>`;
}
function wireCharts() { document.querySelectorAll('.chart[data-points]').forEach(c => { const pts = JSON.parse(c.dataset.points), unit = c.dataset.unit, span = c.querySelector('.v'), base = span.textContent, svg = c.querySelector('svg'); svg.onmousemove = e => { const r = svg.getBoundingClientRect(), i = Math.round((e.clientX - r.left) / r.width * (pts.length - 1)), p = pts[Math.max(0, Math.min(pts.length - 1, i))]; span.textContent = `${p.t ?? i}: ${Number(p.v).toLocaleString('tr-TR')}${unit}`; }; svg.onmouseleave = () => span.textContent = base; }); }
const leaderName = c => S.data.world.characters[c.leader]?.name ?? '';

const views = {
  dunya() {
    const w = S.data.world, cs = Object.values(w.countries).filter(c => c.alive).sort((a, b) => b.realGdp - a.realGdp), wars = w.wars.filter(x => x.active);
    return `<h2>${esc(w.date || 'Başlangıç')}</h2><p class="muted small">${cs.length} güç yaşıyor. ${wars.length ? `${wars.length} savaş sürüyor.` : 'Şu an savaş yok.'}</p>
    ${cs.map(c => { const h = c.history.at(-1) || {}; return `<button class="row" type="button" data-c="${c.id}"><span class="swatch" style="background:${c.colors[0]}"></span><span><b>${esc(c.name)}</b><br><span class="small muted">${esc(c.regime)}, ${esc(c.ideology)}</span><br><span class="small">${esc(leaderName(c))}</span></span><span class="small" style="text-align:right">GSYH ${fmt(h.gdp ?? c.realGdp)}<br>Enflasyon %${h.infl ?? 0}<br>Huzursuzluk ${h.unrest ?? 0}</span></button>`; }).join('')}
    ${wars.length ? `<h3>Süren savaşlar</h3>${wars.map(x => `<div class="news savas">${esc(x.name)}<span class="muted small"> (tur ${x.start})</span></div>`).join('')}` : ''}
    <h3>Stratejik noktalar</h3><table><tr><th>Nokta</th><th>Tür</th><th>Kontrol</th></tr>${w.strategic.map(s => `<tr><td>${esc(s.name)}${s.closed ? ' <span class="badge no">Kapalı</span>' : ''}${s.toll ? ` <span class="badge">%${Math.round(s.toll * 100)} ücret</span>` : ''}</td><td>${ST[s.type]}</td><td>${esc(country(s.controller)?.name ?? '-')}</td></tr>`).join('')}</table>`;
  },
  ulke() {
    const c = country(S.country) || Object.values(S.data.world.countries).find(x => x.alive); if (!c) return '<p class="empty">Ülke yok.</p>';
    S.country = c.id; const w = S.data.world, h = c.history, s = k => h.map(x => ({ t: x.t, v: x[k] })), ch = Object.values(w.characters).filter(x => x.country === c.id && x.alive), units = Object.values(w.units).filter(u => u.country === c.id);
    return `<h2>${esc(c.name)}</h2><p class="muted small">${esc(c.regime)}. ${esc(c.ideology)}.${c.motto ? ` “${esc(c.motto)}”` : ''}</p>
    <div class="kv"><div><b>${fmt(c.realGdp)}</b><span>Reel GSYH</span></div><div><b>${Math.round(c.legitimacy)}</b><span>Meşruiyet</span></div><div><b>${fmt(units.reduce((a, u) => a + u.men, 0))} bin</b><span>Asker</span></div><div><b>${fmt(c.treasury)}</b><span>Hazine</span></div><div><b>${fmt(c.reserves)}</b><span>Döviz</span></div><div><b>%${Math.round(c.foodRatio * 100)}</b><span>Gıda</span></div><div><b>%${Math.round((c.inputRatio ?? 1) * 100)}</b><span>Sanayi girdisi</span></div><div><b>%${Math.round(c.literacy)}</b><span>Okuryazarlık</span></div><div><b>${Math.round(c.bankHealth)}</b><span>Banka sağlığı</span></div></div>
    <div class="charts">${chart('Reel GSYH', s('gdp'))}${chart('Enflasyon', s('infl'), '%')}${chart('İşsizlik', s('unemp'), '%')}${chart('Borç/GSYH', s('debt'), '%')}${chart('Meşruiyet', s('legit'))}${chart('Huzursuzluk', s('unrest'))}</div>
    <h3>Partiler</h3>${c.parties.map(p => `<div class="bar"><span>${esc(p.name.slice(0, 13))}</span><i><b style="width:${Math.min(100, p.support)}%"></b></i><span>%${Math.round(p.support)}</span></div>`).join('')}
    <h3>Güç grupları</h3>${Object.entries(c.blocs).map(([k, b]) => `<div class="bar"><span>${k}</span><i><b style="width:${b.sat}%"></b></i><span>${Math.round(b.sat)}</span></div>`).join('')}
    <h3>Teknoloji</h3><p class="small">${Object.keys(c.techs).join(', ') || 'Henüz yok'}${c.research?.target ? `. Üzerinde çalışılan: ${esc(c.research.target)}` : ''}</p>
    <h3>Kişiler</h3>${ch.map(x => `<div class="entry"><span class="who">${esc(x.name)}</span><span class="badge">${ROLE[x.role] || esc(x.role)}</span>${x.status !== 'serbest' ? `<span class="badge no">${esc(x.status)}</span>` : ''}<span class="badge">${x.aiControlled ? 'Yapay zekâ' : 'Kural'}</span>${x.persona ? `<div class="persona">${esc(x.persona)}</div>` : ''}${x.diary?.length ? `<div class="small muted">Son günlük: ${esc(x.diary.at(-1))}</div>` : ''}</div>`).join('')}
    ${c.institutions?.length ? `<h3>Kurduğu kurumlar</h3>${c.institutions.map(i => `<div class="entry"><span class="who">${esc(i.name)}</span><div class="small">${esc(i.description)}</div></div>`).join('')}` : ''}
    ${w.plots.some(p => p.active && p.country === c.id) ? `<h3>Komplolar</h3>${w.plots.filter(p => p.active && p.country === c.id).map(p => `<div class="news komplo">${esc(p.kind)}: ${esc(w.characters[p.leader]?.name)}, ilerleme ${Math.round(p.progress)}${p.exposed ? ' (sızdı)' : ' (gizli)'}</div>`).join('')}` : ''}`;
  },
  eyalet() {
    const w = S.data.world, p = w.provinces[S.province]; if (!p) return '<p class="empty">Haritadan bir eyalet seç.</p>';
    const sp = w.strategic.filter(s => s.ref === p.id), units = Object.values(w.units).filter(u => u.province === p.id);
    return `<h2>${esc(p.name)}</h2><p class="muted small">${esc(country(p.controller)?.name)}${p.controller !== p.owner ? ` işgali altında, asıl sahibi ${esc(country(p.owner)?.name)}` : ''}. ${TERR_TR[p.terrain]}, yükseklik ${p.elevation}.</p>
    <div class="kv"><div><b>${p.fertility.toFixed(2)}</b><span>Toprak verimi</span></div><div><b>${p.water.toFixed(2)}</b><span>Su</span></div><div><b>${p.timber.toFixed(2)}</b><span>Orman</span></div><div><b>${p.rail}</b><span>Demiryolu</span></div><div><b>${p.port}</b><span>Liman</span></div><div><b>${Math.round(p.unrest)}</b><span>Huzursuzluk</span></div></div>
    ${sp.length ? `<h3>Stratejik önemi</h3>${sp.map(s => `<div class="news">${esc(s.name)} (${ST[s.type]})</div>`).join('')}` : ''}
    <h3>Yeraltı kaynakları</h3>${Object.keys(p.deposits).length ? `<table><tr><th>Kaynak</th><th class="n">Rezerv</th><th class="n">Maden</th><th>Durum</th></tr>${Object.entries(p.deposits).map(([k, d]) => `<tr><td>${GTR[k]}</td><td class="n">${fmt(d.amount)}</td><td class="n">${d.mine.toFixed(1)}</td><td>${d.known ? (p.concessions?.[k] ? `İmtiyaz: ${esc(country(p.concessions[k].holder)?.name)}` : 'Bilinen') : 'Keşfedilmedi'}</td></tr>`).join('')}</table>` : '<p class="small muted">Bilinen veya gizli yatak yok.</p>'}
    <h3>Sanayi</h3><table>${Object.entries({ steel: 'Çelik', fuel: 'Rafineri', fertilizer: 'Kimya', machines: 'Makine', goods: 'Tüketim', arms: 'Silah' }).map(([k, n]) => `<tr><td>${n}</td><td class="n">${p.plants[k].toFixed(2)}</td></tr>`).join('')}</table>
    <h3>Nüfus</h3>${Object.entries(p.pops).map(([k, x]) => `<div class="bar"><span>${k} ${fmt(x.n)}b</span><i><b style="width:${x.sat}%"></b></i><span>${Math.round(x.sat)}</span></div>`).join('')}<p class="small muted">Çubuklar memnuniyeti gösterir. ${esc(p.eth)}, ${esc(p.rel)}.</p>
    ${units.length ? `<h3>Birlikler</h3>${units.map(u => `<div class="small">${esc(country(u.country)?.name)}: ${u.kind}, ${fmt(u.men)} bin, moral ${Math.round(u.morale)}</div>`).join('')}` : ''}`;
  },
  kaynak() {
    const w = S.data.world, h = w.priceHistory || [], goods = Object.keys(GTR).filter(g => g !== 'gold');
    const tot = {}; for (const p of Object.values(w.provinces)) for (const [k, d] of Object.entries(p.deposits)) { tot[k] ||= {}; tot[k][p.controller] = (tot[k][p.controller] || 0) + d.amount; }
    return `<h2>Dünya piyasası</h2><p class="small muted">Fiyatlar son 200 turu gösterir.</p><div class="charts">${goods.map(g => chart(GTR[g], h.map((x, i) => ({ t: i, v: x[g] })))).join('')}</div><h3>Rezervlerin dağılımı</h3><table><tr><th>Kaynak</th><th>En büyük sahip</th><th class="n">Pay</th></tr>${Object.entries(tot).map(([k, m]) => { const all = Object.values(m).reduce((a, b) => a + b, 0), [top, val] = Object.entries(m).sort((a, b) => b[1] - a[1])[0]; return `<tr><td>${GTR[k]}</td><td>${esc(country(top)?.name)}</td><td class="n">%${Math.round(val / all * 100)}</td></tr>`; }).join('')}</table>`;
  },
  zihin() { const t = S.data.log?.trace || []; if (!t.length) return '<p class="empty">Bu turda düşünen bir karakter yok.</p>'; return t.map(x => `<div class="entry"><span class="swatch" style="background:${cColor(x.country)}"></span> <span class="who">${esc(x.name)}</span><span class="badge">${ROLE[x.role] || esc(x.role)}</span> <span class="small muted">${esc(country(x.country)?.name)}</span>${x.persona ? `<div class="persona">${esc(x.persona)}</div>` : ''}${x.lookups?.length ? `<div class="looked">Baktığı konular: ${esc(x.lookups.join(', '))}</div>` : ''}${x.monologue ? `<blockquote>${esc(x.monologue)}</blockquote>` : ''}${x.decisions?.length ? `<ul>${x.decisions.map(d => `<li>${esc(d)}</li>`).join('')}</ul>` : '<div class="small muted">Bu tur bir şey yapmamayı seçti.</div>'}</div>`).join(''); },
  gizli() { const m = S.data.log?.messages || []; return m.length ? m.map(x => `<div class="entry"><span class="who">${esc(x.fromName)}</span> <span class="muted">→ ${esc(x.toName)}</span><blockquote>${esc(x.text)}</blockquote></div>`).join('') : '<p class="empty">Bu turda gizli mesaj yok.</p>'; },
  hakem() { const r = (S.data.log?.rulings || []).filter(x => x.source !== 'kural'); return r.length ? r.map(x => `<div class="entry"><span class="who">${esc(x.name)}</span><span class="badge ${x.success ? 'ok' : 'no'}">${x.success ? 'Gerçekleşti' : 'Başarısız'}</span><span class="badge">%${Math.round(x.probability * 100)} olasılık</span><div>${esc(x.narrative)}</div>${x.results?.length ? `<div class="small muted">${x.results.map(y => `${esc(y.op)}: ${esc(y.msg)}`).join(', ')}</div>` : ''}</div>`).join('') : '<p class="empty">Bu turda hakeme giden bir karar yok.</p>'; },
  haber() { const n = (S.data.world.newsLog || []).filter(x => x.turn <= S.turn).slice(-140).reverse(); return n.length ? n.map(x => `<div class="news ${x.kind}">${esc(x.text)}${x.secret ? '<span class="badge">gizli</span>' : ''}<div class="small muted">tur ${x.turn}</div></div>`).join('') : '<p class="empty">Henüz haber yok.</p>'; }
};
function renderBody() { $('body').innerHTML = views[S.tab](); $('body').querySelectorAll('[data-c]').forEach(b => b.onclick = () => { S.country = b.dataset.c; S.tab = 'ulke'; renderChrome(); renderAll(); }); wireCharts(); }
function renderAll() { if (!S.data || !S.map) return; $('date').textContent = S.data.world.date || 'Başlangıç'; drawMap(); renderBody(); }
async function load(t) { const d = await api(`/api/turn/${t}`); if (d.error) return; S.data = d; S.turn = t; $('slider').value = t; renderAll(); }
function paintMarks() { $('marks').innerHTML = Object.entries(S.marks).map(([t, k]) => `<i title="${k === 'komplo' ? 'Komplo' : 'Savaş'}, tur ${t}" style="left:${S.last ? t / S.last * 100 : 0}%;background:${k === 'komplo' ? '#b89adb' : '#d1584f'}"></i>`).join(''); }
async function refreshLast() { const m = await api('/api/meta'); S.meta = m; if (m.lastTurn < 0) return; S.last = m.lastTurn; S.marks = m.marks || {}; $('slider').max = m.lastTurn; $('pause').textContent = m.paused ? 'Oyunu sürdür' : 'Oyunu durdur'; if (S.live || !S.data) await load(m.lastTurn); paintMarks(); }
function setLive(v) { S.live = v; $('live').classList.toggle('on', v); if (v) refreshLast(); }
const go = t => { setLive(false); load(Math.max(0, Math.min(S.last, t))); };
$('prev').onclick = () => go(S.turn - 1); $('next').onclick = () => go(S.turn + 1); $('slider').oninput = e => go(+e.target.value); $('live').onclick = () => setLive(!S.live);
$('pause').onclick = async () => { await fetch(`/api/control?action=${S.meta?.paused ? 'resume' : 'pause'}`, { method: 'POST', headers: { 'x-panel': '1' } }); setTimeout(refreshLast, 200); };
const es = new EventSource('/api/stream');
es.onmessage = e => { const m = JSON.parse(e.data); if (m.type === 'status') { $('status').textContent = m.status[0].toUpperCase() + m.status.slice(1); $('progress').textContent = m.progress || ''; $('statusDot').className = 'dot' + (m.status === 'hata' ? ' bad' : /düşünüyor|değerlendiriyor|işliyor|kuruluyor|bekleniyor/.test(m.status) ? ' busy' : ''); if (['durduruldu', 'tur tamamlandı'].includes(m.status)) refreshLast(); } if (m.type === 'turn') refreshLast(); };
es.onerror = () => { $('status').textContent = 'Oyuna bağlantı koptu'; $('statusDot').className = 'dot bad'; };
renderChrome(); S.map = await api('/api/map'); await refreshLast();
