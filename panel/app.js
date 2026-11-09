import { WorldMap, TERR, ETHC } from './map.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TABS = [['dunya', 'Dünya'], ['ulke', 'Ülke'], ['eyalet', 'Eyalet'], ['kisi', 'Kişiler'], ['kaynak', 'Kaynaklar'], ['zihin', 'Zihinler'], ['gizli', 'Yazışmalar'], ['hakem', 'Hakem'], ['defter', 'Defter']];
const LAYERS = [['siyasi', 'Siyasi'], ['arazi', 'Arazi'], ['kaynak', 'Kaynaklar'], ['rota', 'Ticaret'], ['huzur', 'Huzursuzluk'], ['etnik', 'Etnik']];
const ROLE = { leader: 'Lider', general: 'General', opposition: 'Muhalefet', oligarch: 'Oligark', eski_lider: 'Eski lider' };
const GTR = { grain: 'Tahıl', timber: 'Kereste', coal: 'Kömür', iron: 'Demir', copper: 'Bakır', oil: 'Petrol', phosphate: 'Fosfat', rare: 'Nadir metal', gold: 'Altın', steel: 'Çelik', fuel: 'Yakıt', fertilizer: 'Gübre', machines: 'Makine', goods: 'Tüketim malı', arms: 'Silah' };
const CHIP = { coal: 'Kö', iron: 'De', copper: 'Ba', oil: 'Pe', phosphate: 'Fo', rare: 'Na', gold: 'Al' };
const TERR_TR = { ova: 'Ova', orman: 'Orman', tepe: 'Tepelik', dag: 'Dağ', col: 'Çöl', bataklik: 'Bataklık', tundra: 'Tundra' };
const ST = { bogaz: 'Boğaz', gecit: 'Geçit', kopru: 'Köprü', liman: 'Doğal liman', kanal_adayi: 'Kanal güzergâhı', kanal: 'Kanal' };
const KINDS = [['durum', 'Durum değişimi'], ['haber', 'Haber'], ['dusunce', 'Düşünce'], ['hukum', 'Hakem'], ['kural', 'Kural eylemi'], ['mesaj', 'Mesaj'], ['sorgu', 'Sorgu']];
const KIND_TR = Object.fromEntries(KINDS);
const WIDE = new Set(['defter', 'kisi']);
const S = { meta: null, turn: 0, last: -1, data: null, tab: 'dunya', layer: 'siyasi', country: null, province: null, live: true, marks: {}, person: null, led: { q: '', kinds: new Set(), country: '', fail: false, imp: false, from: '', to: '' }, cardsAt: -1 };
const fmt = n => Math.round(n).toLocaleString('tr-TR');
const api = p => fetch(p, { cache: 'no-store' }).then(r => r.json());
const quarter = t => t <= 0 ? 'Başlangıç' : `${1900 + Math.floor(t / 4)} Ç${(t % 4) + 1}`;
const country = id => S.data?.world.countries[id];
const cColor = id => country(id)?.colors?.[0] ?? '#8a9a94';
const leaderName = c => S.data.world.characters[c.leader]?.name ?? '';

const map = new WorldMap({
  svg: $('map'),
  onProvince(id) { const p = S.data.world.provinces[id]; S.province = id; S.country = p.controller; S.tab = 'eyalet'; openDrawer(); renderChrome(); renderAll(); },
  onHover: tip,
  onLeave() { $('tip').hidden = true; }
});
map.getObscured = () => $('drawer').classList.contains('closed') ? 0 : $('drawer').offsetWidth;

function renderChrome() {
  $('tabs').innerHTML = TABS.map(([k, t]) => `<button role="tab" type="button" data-t="${k}" aria-selected="${S.tab === k}">${t}</button>`).join('');
  $('tabs').querySelectorAll('button').forEach(b => b.onclick = () => { S.tab = b.dataset.t; openDrawer(); renderChrome(); renderBody(); });
  $('layers').innerHTML = LAYERS.map(([k, t]) => `<button type="button" data-l="${k}" aria-pressed="${S.layer === k}">${t}</button>`).join('');
  $('layers').querySelectorAll('button').forEach(b => b.onclick = () => { S.layer = b.dataset.l; renderChrome(); drawMap(); });
  $('drawer').classList.toggle('wide', WIDE.has(S.tab));
}
const openDrawer = () => $('drawer').classList.remove('closed');
$('toggle').onclick = () => $('drawer').classList.toggle('closed');

function drawMap() {
  if (!S.data) return;
  map.render(S.data.world, { layer: S.layer, country: S.country, province: S.province });
  drawLegend();
}
function drawLegend() {
  const w = S.data.world, eths = [...new Set(Object.values(w.provinces).map(p => p.eth))];
  const strat = '<span><svg width="14" height="14"><path d="M7 0l6 7-6 7-6-7z" fill="#f0c95a" stroke="#14242a"/></svg>Stratejik nokta</span>';
  const chit = '<span><svg width="22" height="14"><rect width="22" height="14" fill="#f7f3e6"/><rect width="9" height="14" fill="#6e8a8c"/></svg>Ordu, bin asker</span>';
  const L = {
    siyasi: `<span><svg width="16" height="16" viewBox="-11 -11 22 22"><path d="M0-10 2.8-5.2 8-7 6-1.8 10.4 0 6 2 8 7.2 2.8 5.4 0 10.2-2.8 5.4-8 7.2-6 2-10.4 0-6-1.8-8-7-2.8-5.2z" fill="#f0c95a" stroke="#14242a"/></svg>Başkent</span>${chit}<span><svg width="14" height="14"><path d="M1 13 13 1M-3 6 6-3M7 17 17 7" stroke="#d9d4c3" stroke-width="3"/></svg>İşgal</span><span><svg width="14" height="14" viewBox="-12 -12 24 24"><path d="M0-11 2.6-4.4 9.6-7.4 5.2-1.8 11 2.6 3.8 3 3.2 10.6 0 4.8-3.6 10.4-3.8 3-11 2.2-5.2-1.8-9.2-7.6-2.6-4.4z" fill="#b3362b"/></svg>Muharebe</span>`,
    arazi: Object.entries(TERR).map(([k, c]) => `<span><span class="swatch" style="background:${c}"></span>${TERR_TR[k]}</span>`).join(''),
    kaynak: Object.entries(CHIP).map(([k, c]) => `<span><b>${c}</b>${GTR[k]}</span>`).join('') + '<span>Soluk: henüz keşfedilmedi</span>',
    rota: '<span><svg width="20" height="8"><line x2="20" y1="4" y2="4" stroke="#f6df98" stroke-width="3"/></svg>Deniz</span><span><svg width="20" height="8"><line x2="20" y1="4" y2="4" stroke="#a9794a" stroke-width="3"/></svg>Kara</span><span>Kesikli: geçiş ücretli</span>',
    huzur: '<span>Sakin</span><span style="width:70px;height:9px;background:linear-gradient(90deg,rgb(250,240,226),rgb(190,50,36))"></span><span>Ayaklanma</span>',
    etnik: eths.map((e, i) => `<span><span class="swatch" style="background:${ETHC[i % ETHC.length]}"></span>${esc(e)}</span>`).join('')
  };
  $('legend').innerHTML = L[S.layer] + (['siyasi', 'rota'].includes(S.layer) ? strat : '');
}
function tip(e, id) {
  const w = S.data.world, p = w.provinces[id], t = $('tip'); if (!p) return;
  const box = $('wrap').getBoundingClientRect(), men = Object.values(w.units).filter(u => u.province === p.id).reduce((a, u) => a + u.men, 0), dep = Object.entries(p.deposits).map(([k, d]) => GTR[k] + (d.known ? '' : ' (gizli)')).join(', ');
  t.hidden = false;
  t.innerHTML = `<b>${esc(p.name)}</b><br>${esc(country(p.controller)?.name)}, ${TERR_TR[p.terrain]}<br>Nüfus ${fmt(Object.values(p.pops).reduce((a, x) => a + x.n, 0))} bin, huzursuzluk ${Math.round(p.unrest)}<br>${esc(p.eth)}, ${esc(p.rel)}<br>Asker ${fmt(men)} bin${dep ? `<br>Yataklar: ${esc(dep)}` : ''}`;
  t.style.left = `${Math.min(e.clientX - box.left + 14, box.width - 300)}px`; t.style.top = `${Math.min(e.clientY - box.top + 14, box.height - 150)}px`;
}
$('zin').onclick = () => map.zoom(.75); $('zout').onclick = () => map.zoom(1.33); $('zreset').onclick = () => map.fit();

// Üst çubuk: seçili ülkenin kaynakları
const ICON = {
  treasury: '<ellipse cx="10" cy="6" rx="6.5" ry="2.8"/><path d="M3.5 6v8c0 1.5 3 2.8 6.5 2.8s6.5-1.3 6.5-2.8V6M3.5 10c0 1.5 3 2.8 6.5 2.8s6.5-1.3 6.5-2.8"/>',
  reserves: '<rect x="2" y="5" width="16" height="10" rx="1"/><circle cx="10" cy="10" r="2.5"/><path d="M5 8v4M15 8v4"/>',
  food: '<path d="M10 18V6M10 8C8 7 7 5 7 3c2 .5 3 2 3 5zM10 8c2-1 3-3 3-5-2 .5-3 2-3 5zM10 12c-2-1-3-3-3-5 2 .5 3 2 3 5zM10 12c2-1 3-3 3-5-2 .5-3 2-3 5z"/>',
  input: '<circle cx="10" cy="10" r="3"/><path d="M10 2v3M10 15v3M2 10h3M15 10h3M4.3 4.3l2.2 2.2M13.5 13.5l2.2 2.2M15.7 4.3l-2.2 2.2M6.5 13.5l-2.2 2.2"/>',
  legit: '<path d="M3 15h14l1-9-4.5 3.5L10 3 6.5 9.5 2 6z"/>',
  unrest: '<path d="M10 2c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 .3 1.5 1 2.3 2 2.5C9 8 9 5 10 2z"/>',
  men: '<path d="M4 11a6 6 0 0 1 12 0zM2 11h16M10 5V3"/><path d="M6 11v3a4 4 0 0 0 8 0v-3"/>',
  grain: '<path d="M3 8h14l-1.5 9h-11zM6 8c0-3 1.5-5 4-5s4 2 4 5"/>',
  steel: '<path d="M2 15l3-7h10l3 7zM5 8l2-3h6l2 3"/>',
  fuel: '<rect x="4" y="3" width="12" height="14" rx="2"/><path d="M4 8h12M4 12h12"/>',
  arms: '<path d="M2 12h11l3-3h2v3l-3 3H9l-1 3H5l1-3H2z"/>'
};
function renderBar() {
  const w = S.data.world, alive = Object.values(w.countries).filter(c => c.alive).sort((a, b) => b.realGdp - a.realGdp);
  if (!S.country || !w.countries[S.country]?.alive) S.country = alive[0]?.id ?? null;
  $('countrySel').innerHTML = alive.map(c => `<option value="${c.id}"${c.id === S.country ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  const c = w.countries[S.country]; if (!c) { $('res').innerHTML = ''; return; }
  $('flag').style.background = `linear-gradient(90deg,${c.colors[0]} 62%,${c.colors[1] ?? c.colors[0]} 62%)`;
  const men = Object.values(w.units).filter(u => u.country === c.id).reduce((a, u) => a + u.men, 0), [h1, h0] = [c.history.at(-1), c.history.at(-2)];
  const delta = (k, goodUp) => { if (!h0 || h1?.[k] == null || h0[k] == null) return ''; const d = h1[k] - h0[k]; if (Math.abs(d) < 1) return ''; return `<i class="${(d > 0) === goodUp ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}</i>`; };
  const items = [['treasury', 'Hazine', fmt(c.treasury), delta('treasury', true)], ['reserves', 'Döviz', fmt(c.reserves), delta('reserves', true)], ['food', 'Gıda', `%${Math.round(c.foodRatio * 100)}`, delta('food', true)], ['input', 'Sanayi girdisi', `%${Math.round((c.inputRatio ?? 1) * 100)}`, delta('input', true)], ['legit', 'Meşruiyet', Math.round(c.legitimacy), delta('legit', true)], ['unrest', 'Huzursuzluk', Math.round(c.unrest), delta('unrest', false)], ['men', 'Asker, bin', fmt(men), delta('men', true)], ['grain', 'Tahıl', fmt(c.stock.grain || 0), ''], ['steel', 'Çelik', fmt(c.stock.steel || 0), ''], ['fuel', 'Yakıt', fmt(c.stock.fuel || 0), ''], ['arms', 'Silah', fmt(c.stock.arms || 0), '']];
  $('res').innerHTML = items.map(([ic, label, v, d]) => `<div class="stat"><svg viewBox="0 0 20 20" aria-hidden="true">${ICON[ic]}</svg><b>${v}${d}</b><small>${label}</small></div>`).join('');
}
$('countrySel').onchange = e => { S.country = e.target.value; renderAll(); };

function chart(title, data, unit = '') {
  const vals = data.map(d => d.v).filter(v => Number.isFinite(v)), last = vals.at(-1) ?? 0;
  if (vals.length < 2) return `<div class="chart"><h4>${title}<span class="v">${last}${unit}</span></h4><p class="small muted">Veri birikiyor.</p></div>`;
  const min = Math.min(...vals), max = Math.max(...vals), W = 200, H = 54, sx = i => i * W / (vals.length - 1), sy = v => H - 3 - (v - min) / ((max - min) || 1) * (H - 8);
  return `<div class="chart" data-points='${esc(JSON.stringify(data))}' data-unit="${unit}"><h4>${title}<span class="v">${last.toLocaleString('tr-TR')}${unit}</span></h4><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="${title}: son değer ${last}${unit}"><line x1="0" x2="${W}" y1="${H - 1}" y2="${H - 1}" stroke="#aebbb0" vector-effect="non-scaling-stroke"/><polyline fill="none" stroke="#1b4f5d" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" points="${vals.map((v, i) => `${sx(i)},${sy(v)}`).join(' ')}"/></svg><div class="small muted">aralık ${min.toLocaleString('tr-TR')} ile ${max.toLocaleString('tr-TR')}${unit}</div></div>`;
}
function wireCharts() { document.querySelectorAll('.chart[data-points]').forEach(c => { const pts = JSON.parse(c.dataset.points), unit = c.dataset.unit, span = c.querySelector('.v'), base = span.textContent, svg = c.querySelector('svg'); svg.onmousemove = e => { const r = svg.getBoundingClientRect(), i = Math.round((e.clientX - r.left) / r.width * (pts.length - 1)), p = pts[Math.max(0, Math.min(pts.length - 1, i))]; span.textContent = `${quarter(p.t ?? i)}: ${Number(p.v).toLocaleString('tr-TR')}${unit}`; }; svg.onmouseleave = () => span.textContent = base; }); }

const views = {
  dunya() {
    const w = S.data.world, cs = Object.values(w.countries).filter(c => c.alive).sort((a, b) => b.realGdp - a.realGdp), wars = w.wars.filter(x => x.active);
    return `<h2>${quarter(S.turn)}</h2><p class="muted small">${cs.length} güç yaşıyor. ${wars.length ? `${wars.length} savaş sürüyor.` : 'Şu an savaş yok.'}</p>
    ${cs.map(c => { const h = c.history.at(-1) || {}; return `<button class="row" type="button" data-c="${c.id}"><span class="swatch" style="background:${c.colors[0]}"></span><span><b>${esc(c.name)}</b><br><span class="small muted">${esc(c.regime)}, ${esc(c.ideology)}</span><br><span class="small">${esc(leaderName(c))}</span></span><span class="small" style="text-align:right">GSYH ${fmt(h.gdp ?? c.realGdp)}<br>Enflasyon %${h.infl ?? 0}<br>Huzursuzluk ${h.unrest ?? 0}</span></button>`; }).join('')}
    ${wars.length ? `<h3>Süren savaşlar</h3>${wars.map(x => `<div class="news savas">${esc(x.name)}<span class="muted small"> (${quarter(x.start)})</span></div>`).join('')}` : ''}
    <h3>Stratejik noktalar</h3><table><tr><th>Nokta</th><th>Tür</th><th>Kontrol</th></tr>${w.strategic.map(s => `<tr><td>${esc(s.name)}${s.closed ? ' <span class="badge no">Kapalı</span>' : ''}${s.toll ? ` <span class="badge">%${Math.round(s.toll * 100)} ücret</span>` : ''}</td><td>${ST[s.type]}</td><td>${esc(country(s.controller)?.name ?? '-')}</td></tr>`).join('')}</table>`;
  },
  ulke() {
    const c = country(S.country) || Object.values(S.data.world.countries).find(x => x.alive); if (!c) return '<p class="empty">Yaşayan ülke yok.</p>';
    S.country = c.id; const w = S.data.world, h = c.history, s = k => h.map(x => ({ t: x.t, v: x[k] })), ch = Object.values(w.characters).filter(x => x.country === c.id && x.alive), units = Object.values(w.units).filter(u => u.country === c.id);
    return `<h2>${esc(c.name)}</h2><p class="muted small">${esc(c.regime)}. ${esc(c.ideology)}.${c.motto ? ` “${esc(c.motto)}”` : ''}</p>
    <div class="kv"><div><b>${fmt(c.realGdp)}</b><span>Reel GSYH</span></div><div><b>${Math.round(c.legitimacy)}</b><span>Meşruiyet</span></div><div><b>${fmt(units.reduce((a, u) => a + u.men, 0))} bin</b><span>Asker</span></div><div><b>${fmt(c.treasury)}</b><span>Hazine</span></div><div><b>${fmt(c.reserves)}</b><span>Döviz</span></div><div><b>%${Math.round(c.foodRatio * 100)}</b><span>Gıda</span></div><div><b>%${Math.round((c.inputRatio ?? 1) * 100)}</b><span>Sanayi girdisi</span></div><div><b>%${Math.round(c.literacy)}</b><span>Okuryazarlık</span></div><div><b>${Math.round(c.bankHealth)}</b><span>Banka sağlığı</span></div></div>
    <div class="charts">${chart('Reel GSYH', s('gdp'))}${chart('Enflasyon', s('infl'), '%')}${chart('İşsizlik', s('unemp'), '%')}${chart('Borç/GSYH', s('debt'), '%')}${chart('Meşruiyet', s('legit'))}${chart('Huzursuzluk', s('unrest'))}</div>
    <h3>Partiler</h3>${c.parties.map(p => `<div class="bar2"><span>${esc(p.name.slice(0, 13))}</span><i><b style="width:${Math.min(100, p.support)}%"></b></i><span>%${Math.round(p.support)}</span></div>`).join('')}
    <h3>Güç grupları</h3>${Object.entries(c.blocs).map(([k, b]) => `<div class="bar2"><span>${k}</span><i><b style="width:${b.sat}%"></b></i><span>${Math.round(b.sat)}</span></div>`).join('')}
    <h3>Stoklar</h3><table>${Object.entries(c.stock).filter(([, v]) => v >= .5).map(([k, v]) => `<tr><td>${GTR[k] ?? esc(k)}</td><td class="n">${fmt(v)}</td></tr>`).join('')}</table>
    <h3>Teknoloji</h3><p class="small">${Object.keys(c.techs).join(', ') || 'Henüz yok'}${c.research?.target ? `. Üzerinde çalışılan: ${esc(c.research.target)}` : ''}</p>
    <h3>Kişiler</h3>${ch.map(x => `<div class="entry"><button class="linky" type="button" data-person="${x.id}">${esc(x.name)}</button><span class="badge">${ROLE[x.role] || esc(x.role)}</span>${x.status !== 'serbest' ? `<span class="badge no">${esc(x.status)}</span>` : ''}<span class="badge">${x.aiControlled ? 'Yapay zekâ' : 'Kural'}</span>${x.persona ? `<div class="persona">${esc(x.persona)}</div>` : ''}${x.diary?.length ? `<div class="small muted">Son günlük: ${esc(x.diary.at(-1))}</div>` : ''}</div>`).join('')}
    ${c.institutions?.length ? `<h3>Kurduğu kurumlar</h3>${c.institutions.map(i => `<div class="entry"><span class="who2">${esc(i.name)}</span><div class="small">${esc(i.description)}</div></div>`).join('')}` : ''}
    ${w.plots.some(p => p.active && p.country === c.id) ? `<h3>Komplolar</h3>${w.plots.filter(p => p.active && p.country === c.id).map(p => `<div class="news komplo">${esc(p.kind)}: ${esc(w.characters[p.leader]?.name)}, ilerleme ${Math.round(p.progress)}${p.exposed ? ' (sızdı)' : ' (gizli)'}</div>`).join('')}` : ''}`;
  },
  eyalet() {
    const w = S.data.world, p = w.provinces[S.province]; if (!p) return '<p class="empty">Bilgi görmek için haritadan bir eyalet seç.</p>';
    const sp = w.strategic.filter(s => s.ref === p.id), units = Object.values(w.units).filter(u => u.province === p.id);
    return `<h2>${esc(p.name)}</h2><p class="muted small">${esc(country(p.controller)?.name)}${p.controller !== p.owner ? ` işgali altında, asıl sahibi ${esc(country(p.owner)?.name)}` : ''}. ${TERR_TR[p.terrain]}, yükseklik ${p.elevation}.</p>
    <div class="kv"><div><b>${p.fertility.toFixed(2)}</b><span>Toprak verimi</span></div><div><b>${p.water.toFixed(2)}</b><span>Su</span></div><div><b>${p.timber.toFixed(2)}</b><span>Orman</span></div><div><b>${p.rail}</b><span>Demiryolu</span></div><div><b>${p.port}</b><span>Liman</span></div><div><b>${Math.round(p.unrest)}</b><span>Huzursuzluk</span></div></div>
    ${sp.length ? `<h3>Stratejik önemi</h3>${sp.map(s => `<div class="news">${esc(s.name)} (${ST[s.type]})</div>`).join('')}` : ''}
    <h3>Yeraltı kaynakları</h3>${Object.keys(p.deposits).length ? `<table><tr><th>Kaynak</th><th class="n">Rezerv</th><th class="n">Maden</th><th>Durum</th></tr>${Object.entries(p.deposits).map(([k, d]) => `<tr><td>${GTR[k]}</td><td class="n">${fmt(d.amount)}</td><td class="n">${d.mine.toFixed(1)}</td><td>${d.known ? (p.concessions?.[k] ? `İmtiyaz: ${esc(country(p.concessions[k].holder)?.name)}` : 'Bilinen') : 'Keşfedilmedi'}</td></tr>`).join('')}</table>` : '<p class="small muted">Bilinen veya gizli yatak yok.</p>'}
    <h3>Sanayi</h3><table>${Object.entries({ steel: 'Çelik', fuel: 'Rafineri', fertilizer: 'Kimya', machines: 'Makine', goods: 'Tüketim', arms: 'Silah' }).map(([k, n]) => `<tr><td>${n}</td><td class="n">${p.plants[k].toFixed(2)}</td></tr>`).join('')}</table>
    <h3>Nüfus</h3>${Object.entries(p.pops).map(([k, x]) => `<div class="bar2"><span>${k} ${fmt(x.n)}b</span><i><b style="width:${x.sat}%"></b></i><span>${Math.round(x.sat)}</span></div>`).join('')}<p class="small muted">Çubuklar memnuniyeti gösterir. ${esc(p.eth)}, ${esc(p.rel)}.</p>
    ${units.length ? `<h3>Birlikler</h3>${units.map(u => `<div class="small">${esc(country(u.country)?.name)}: ${u.kind}, ${fmt(u.men)} bin, moral ${Math.round(u.morale)}</div>`).join('')}` : ''}`;
  },
  kaynak() {
    const w = S.data.world, h = w.priceHistory || [], goods = Object.keys(GTR).filter(g => g !== 'gold');
    const tot = {}; for (const p of Object.values(w.provinces)) for (const [k, d] of Object.entries(p.deposits)) { tot[k] ||= {}; tot[k][p.controller] = (tot[k][p.controller] || 0) + d.amount; }
    return `<h2>Dünya piyasası</h2><p class="small muted">Fiyatlar son 200 turu gösterir.</p><div class="charts">${goods.map(g => chart(GTR[g], h.map((x, i) => ({ t: i, v: x[g] })))).join('')}</div><h3>Rezervlerin dağılımı</h3><table><tr><th>Kaynak</th><th>En büyük sahip</th><th class="n">Pay</th></tr>${Object.entries(tot).map(([k, m]) => { const all = Object.values(m).reduce((a, b) => a + b, 0), [top, val] = Object.entries(m).sort((a, b) => b[1] - a[1])[0]; return `<tr><td>${GTR[k]}</td><td>${esc(country(top)?.name)}</td><td class="n">%${Math.round(val / all * 100)}</td></tr>`; }).join('')}</table>`;
  },
  zihin() { const t = S.data.log?.trace || []; if (!t.length) return '<p class="empty">Bu turda düşünen bir karakter yok.</p>'; return t.map(x => `<div class="entry"><span class="swatch" style="background:${cColor(x.country)}"></span> <button class="linky" type="button" data-person="${x.actor}">${esc(x.name)}</button><span class="badge">${ROLE[x.role] || esc(x.role)}</span> <span class="small muted">${esc(country(x.country)?.name)}</span>${x.persona ? `<div class="persona">${esc(x.persona)}</div>` : ''}${x.lookups?.length ? `<div class="looked">Baktığı konular: ${esc(x.lookups.join(', '))}</div>` : ''}${x.monologue ? `<blockquote>${esc(x.monologue)}</blockquote>` : ''}${x.decisions?.length ? `<ul>${x.decisions.map(d => `<li>${esc(d)}</li>`).join('')}</ul>` : '<div class="small muted">Bu tur bir şey yapmamayı seçti.</div>'}</div>`).join(''); },
  gizli() { const m = S.data.log?.messages || []; return m.length ? m.map(x => `<div class="entry"><button class="linky" type="button" data-person="${x.from}">${esc(x.fromName)}</button> <span class="muted">→ ${esc(x.toName)}</span>${x.undelivered ? '<span class="badge no">Ulaşmadı</span>' : ''}<blockquote>${esc(x.text)}</blockquote></div>`).join('') : '<p class="empty">Bu turda gizli mesaj yok.</p>'; },
  hakem() { const r = (S.data.log?.rulings || []).filter(x => x.source !== 'kural'); return r.length ? r.map(x => `<div class="entry"><span class="who2">${esc(x.name)}</span><span class="badge ${x.success ? 'ok' : 'no'}">${x.success ? 'Gerçekleşti' : 'Başarısız'}</span><span class="badge">%${Math.round(x.probability * 100)} olasılık</span><div>${esc(x.narrative)}</div>${x.results?.length ? `<div class="small muted">${x.results.map(y => `${esc(y.op)}: ${esc(y.msg)}`).join(', ')}</div>` : ''}</div>`).join('') : '<p class="empty">Bu turda hakeme giden bir karar yok.</p>'; }
};

// Defter ve kişi zaman çizelgesi aynı girdi görünümünü paylaşır.
function ledgerUrl(f, cursor) {
  const q = new URLSearchParams({ limit: 60 });
  if (f.q) q.set('q', f.q);
  if (f.kinds?.size) q.set('k', [...f.kinds].join(','));
  if (f.country) q.set('c', f.country);
  if (f.character) q.set('ch', f.character);
  if (f.fail) q.set('ok', '0');
  if (f.imp) q.set('imp', '2');
  if (f.from !== '' && f.from != null) q.set('from', f.from);
  if (f.to !== '' && f.to != null) q.set('to', f.to);
  if (cursor) q.set('cursor', cursor);
  return `/api/ledger?${q}`;
}
function entryHtml(e) {
  const x = e.x || {}, who = e.n ? (e.a?.[0] ? `<button class="linky" type="button" data-person="${e.a[0]}">${esc(e.n)}</button>` : `<b>${esc(e.n)}</b>`) : '', to = e.to ? `<span class="muted">→ ${e.a?.[1] ? `<button class="linky" type="button" data-person="${e.a[1]}">${esc(e.to)}</button>` : esc(e.to)}</span>` : '';
  const flags = `${e.s === 'kural' || e.s === 'mock' ? '' : ''}${e.ok === false ? `<span class="badge no">${e.k === 'mesaj' ? 'Ulaşmadı' : 'Başarısız'}</span>` : ''}${x.secret ? '<span class="badge">Gizli</span>' : ''}${x.probability != null && e.k === 'hukum' ? `<span class="badge">%${Math.round(x.probability * 100)} olasılık</span>` : ''}${e.imp >= 3 ? '<span class="badge no">Büyük olay</span>' : ''}`;
  let body = `<p>${esc(e.text)}</p>`, more = '';
  if (e.k === 'sorgu') { body = `<p class="muted">Sorguladı: ${esc(e.q)}</p>`; more = `<details><summary>Aldığı cevap</summary><pre>${esc(e.text)}</pre></details>`; }
  if (e.k === 'dusunce') { const parts = []; if (x.decisions?.length) parts.push(`<ul>${x.decisions.map(d => `<li>${esc(d)}</li>`).join('')}</ul>`); if (x.lookups?.length) parts.push(`<div class="looked">Baktığı konular: ${esc(x.lookups.join(', '))}</div>`); if (x.persona) parts.push(`<div class="persona">${esc(x.persona)}</div>`); if (parts.length) more = `<details><summary>Kararlar ve kimlik</summary>${parts.join('')}</details>`; if (!e.text) body = ''; }
  if ((e.k === 'hukum' || e.k === 'kural') && (x.ops?.length || x.results?.length || x.decision)) more = `<details><summary>Ayrıntı</summary>${x.decision ? `<p>Karar: ${esc(x.decision)}</p>` : ''}<pre>${esc(JSON.stringify({ islemler: x.ops, sonuclar: x.results }, null, 1))}</pre></details>`;
  const pin = e.p ? `<button class="linky" type="button" data-pin="${e.p}">Haritada göster</button>` : '';
  return `<article class="e k-${e.k}${e.ok === false ? ' fail' : ''}"><header><button class="linky" type="button" data-go="${e.t}">${esc(e.d)}</button><span class="ktag">${KIND_TR[e.k] ?? e.k}</span>${who}${to}${flags}${pin}</header>${body}${more}</article>`;
}
function wireEntries(root) {
  root.querySelectorAll('[data-person]').forEach(b => b.onclick = () => openPerson(b.dataset.person));
  root.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(+b.dataset.go));
  root.querySelectorAll('[data-pin]').forEach(b => b.onclick = () => pinTo(b.dataset.pin));
}
function pinTo(ref) { const w = S.data.world, q = w.provinces[ref] ?? w.seas[ref]; if (!q) return; if (w.provinces[ref]) S.province = ref; map.focus(q.cx, q.cy); drawMap(); }
function openPerson(id) { S.person = id; S.tab = 'kisi'; openDrawer(); renderChrome(); renderBody(); }

class EntryList {
  constructor(el, filter) { this.el = el; this.filter = filter; this.seq = 0; }
  async refresh() {
    const seq = ++this.seq, r = await api(ledgerUrl(this.filter())); if (seq !== this.seq) return;
    this.next = r.next;
    this.el.innerHTML = r.items.length ? `<div class="list">${r.items.map(entryHtml).join('')}</div>${this.moreBtn()}` : '<p class="empty">Bu süzgeçlere uyan kayıt yok. Süzgeçleri gevşet.</p>';
    wireEntries(this.el); this.wireMore();
  }
  moreBtn() { return this.next ? '<button class="more" type="button">Daha eski kayıtları getir</button>' : ''; }
  wireMore() {
    const b = this.el.querySelector('.more'); if (!b) return;
    b.onclick = async () => {
      b.disabled = true;
      const seq = this.seq, r = await api(ledgerUrl(this.filter(), this.next)); if (seq !== this.seq) return;
      this.next = r.next;
      const tmp = document.createElement('div'); tmp.innerHTML = r.items.map(entryHtml).join(''); wireEntries(tmp);
      this.el.querySelector('.list').append(...tmp.children);
      b.remove(); this.el.insertAdjacentHTML('beforeend', this.moreBtn()); this.wireMore();
    };
  }
}

function mountDefter(body) {
  const f = S.led, alive = Object.values(S.data.world.countries).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  body.innerHTML = `<div class="filters"><input type="search" id="ledq" placeholder="Olaylarda, kişilerde, kararlarda ara" aria-label="Defterde ara" value="${esc(f.q)}">
    <div class="kinds" id="ledk">${KINDS.map(([k, t]) => `<button type="button" data-k="${k}" aria-pressed="${f.kinds.has(k)}">${t}</button>`).join('')}</div>
    <div class="frow"><select id="ledc" aria-label="Ülke"><option value="">Tüm ülkeler</option>${alive.map(c => `<option value="${c.id}"${f.country === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
    <label><input type="checkbox" id="ledfail"${f.fail ? ' checked' : ''}>Başarısızlar</label><label><input type="checkbox" id="ledimp"${f.imp ? ' checked' : ''}>Önemliler</label>
    <label>Tur <input type="number" id="ledfrom" min="0" aria-label="Başlangıç turu" value="${esc(f.from)}"></label><label>ile <input type="number" id="ledto" min="0" aria-label="Bitiş turu" value="${esc(f.to)}"></label><button type="button" id="ledclear">Süzgeçleri temizle</button></div></div><div id="ledlist"></div>`;
  const list = new EntryList($('ledlist'), () => S.led);
  S.mounted = { tab: 'defter', list };
  let t; const again = () => { clearTimeout(t); t = setTimeout(() => list.refresh(), 220); };
  $('ledq').oninput = e => { f.q = e.target.value; again(); };
  $('ledk').querySelectorAll('button').forEach(b => b.onclick = () => { const k = b.dataset.k; f.kinds.has(k) ? f.kinds.delete(k) : f.kinds.add(k); b.setAttribute('aria-pressed', f.kinds.has(k)); again(); });
  $('ledc').onchange = e => { f.country = e.target.value; again(); };
  $('ledfail').onchange = e => { f.fail = e.target.checked; again(); };
  $('ledimp').onchange = e => { f.imp = e.target.checked; again(); };
  $('ledfrom').oninput = e => { f.from = e.target.value; again(); };
  $('ledto').oninput = e => { f.to = e.target.value; again(); };
  $('ledclear').onclick = () => { S.led = { q: '', kinds: new Set(), country: '', fail: false, imp: false, from: '', to: '' }; mountDefter(body); };
  list.refresh();
}

async function mountKisi(body) {
  const people = Object.values(await api('/api/people')).sort((a, b) => (b.alive - a.alive) || (b.events - a.events));
  if (!people.length) { body.innerHTML = '<p class="empty">Kayıtlı kişi yok. İlk tur bitince burada görünür.</p>'; return; }
  S.person = people.some(p => p.id === S.person) ? S.person : (country(S.country)?.leader ?? people[0].id);
  body.innerHTML = `<div class="split"><div class="plist"><input type="search" id="pq" placeholder="Kişi ara" aria-label="Kişi ara"><div id="pitems"></div></div><div><div id="phead"></div><div id="ptimeline"></div></div></div>`;
  const list = new EntryList($('ptimeline'), () => ({ character: S.person }));
  S.mounted = { tab: 'kisi', list };
  const colorOf = p => S.data.world.countries[p.country]?.colors?.[0] ?? '#8a9a94';
  const items = (needle = '') => { const n = needle.toLocaleLowerCase('tr'); $('pitems').innerHTML = people.filter(p => !n || `${p.name} ${p.countryName}`.toLocaleLowerCase('tr').includes(n)).slice(0, 300).map(p => `<button type="button" data-id="${p.id}" aria-current="${p.id === S.person}" class="${p.alive ? '' : 'gone'}"><span class="swatch" style="background:${colorOf(p)}"></span><span>${esc(p.name)}<small>${ROLE[p.role] || esc(p.role)}, ${esc(p.countryName)}${p.alive ? '' : `, ${esc(p.status)}`}</small></span></button>`).join(''); $('pitems').querySelectorAll('button').forEach(b => b.onclick = () => { S.person = b.dataset.id; items($('pq').value); head(); list.refresh(); }); };
  const head = () => { const p = people.find(x => x.id === S.person), ch = S.data.world.characters[S.person]; $('phead').innerHTML = `<h2>${esc(p.name)}</h2><p class="muted small">${ROLE[p.role] || esc(p.role)}, ${esc(p.countryName)}${ch ? `, ${ch.age} yaşında` : ''}. ${p.alive ? (p.ai ? 'Yapay zekâ oynuyor.' : 'Kuralla oynuyor.') : `Durum: ${esc(p.status)}.`} ${fmt(p.events)} kayıt, ${quarter(p.first)} ile ${quarter(p.last)} arası.</p>${ch?.persona ? `<div class="persona">${esc(ch.persona)}</div>` : ''}`; };
  $('pq').oninput = e => items(e.target.value);
  items(); head(); list.refresh();
}

function renderBody() {
  const body = $('body');
  if (S.tab === 'defter') { if (S.mounted?.tab !== 'defter') mountDefter(body); else if (body.scrollTop < 40 && S.live) S.mounted.list.refresh(); return; }
  if (S.tab === 'kisi') { if (S.mounted?.tab !== 'kisi' || S.mounted.person !== S.person) { Promise.resolve(mountKisi(body)).then(() => { if (S.mounted) S.mounted.person = S.person; }); } else if (body.scrollTop < 40 && S.live) S.mounted.list.refresh(); return; }
  S.mounted = null;
  body.innerHTML = views[S.tab]();
  body.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { S.country = b.dataset.c; S.tab = 'ulke'; renderChrome(); renderAll(); });
  wireEntries(body); wireCharts();
}
function renderAll() { if (!S.data) return; $('date').textContent = quarter(S.turn); const snap = S.data.snapshotTurn ?? S.turn; $('snapnote').hidden = snap === S.turn; $('snapnote').textContent = snap === S.turn ? '' : `Harita ${quarter(snap)} kaydından`; renderBar(); drawMap(); renderBody(); }
async function load(t) { const d = await api(`/api/turn/${t}`); if (d.error) return; S.data = d; S.turn = t; $('slider').value = t; renderAll(); }

// Önemli olay kartları: yalnızca canlı izlerken, yeni tur geldiğinde çıkar.
const MAX_CARDS = 3, CARD_MS = 14000;
async function showCards(t) {
  if (!S.live || t <= S.cardsAt) return;
  S.cardsAt = t;
  const r = await api(`/api/ledger?turn=${t}&imp=2&limit=20`), top = r.items.sort((a, b) => b.imp - a.imp).slice(0, MAX_CARDS), box = $('cards');
  for (const e of top.reverse()) {
    const el = document.createElement('div'), col = cColor(e.c?.[0]);
    el.className = `card i${e.imp}`; el.style.setProperty('--c', col);
    el.innerHTML = `<button type="button" class="open"><small>${esc(e.d)}</small>${esc(e.text)}</button><button type="button" class="x" aria-label="Kartı kapat">×</button>`;
    let timer; const close = () => { clearTimeout(timer); el.remove(); }, arm = () => { timer = setTimeout(close, CARD_MS); };
    el.querySelector('.x').onclick = close;
    el.querySelector('.open').onclick = () => { if (e.p) pinTo(e.p); else if (e.c?.[0]) { S.country = e.c[0]; } S.tab = 'defter'; S.led = { q: '', kinds: new Set(), country: '', fail: false, imp: false, from: e.t, to: e.t }; S.mounted = null; openDrawer(); renderChrome(); renderAll(); close(); };
    el.onmouseenter = () => clearTimeout(timer); el.onmouseleave = arm; arm();
    box.prepend(el);
    while (box.children.length > MAX_CARDS) box.lastChild.remove();
  }
}

function paintMarks() { $('turnmarks').innerHTML = Object.entries(S.marks).map(([t, k]) => `<i title="${k === 'komplo' ? 'Komplo' : 'Savaş'}, ${quarter(+t)}" style="left:${S.last ? t / S.last * 100 : 0}%;background:${k === 'komplo' ? '#b89adb' : '#d1584f'}"></i>`).join(''); }
async function refreshLast() { const m = await api('/api/meta'); S.meta = m; if (m.lastTurn < 0) return; const fresh = m.lastTurn > S.last && S.last >= 0; S.last = m.lastTurn; S.marks = m.marks || {}; $('slider').max = m.lastTurn; $('pause').textContent = m.paused ? 'Oyunu sürdür' : 'Oyunu durdur'; if (S.live || !S.data) await load(m.lastTurn); paintMarks(); if (fresh) showCards(m.lastTurn); }
function setLive(v) { S.live = v; $('live').classList.toggle('on', v); if (v) refreshLast(); }
const go = t => { setLive(false); load(Math.max(0, Math.min(S.last, t))); };
$('prev').onclick = () => go(S.turn - 1); $('next').onclick = () => go(S.turn + 1); $('slider').oninput = e => go(+e.target.value); $('live').onclick = () => setLive(!S.live);
$('pause').onclick = async () => { await fetch(`/api/control?action=${S.meta?.paused ? 'resume' : 'pause'}`, { method: 'POST', headers: { 'x-panel': '1' } }); setTimeout(refreshLast, 200); };
const es = new EventSource('/api/stream');
es.onmessage = e => { const m = JSON.parse(e.data); if (m.type === 'status') { $('status').textContent = m.status[0].toUpperCase() + m.status.slice(1); $('progress').textContent = m.progress || ''; $('statusDot').className = `dot${m.status === 'hata' ? ' bad' : /düşünüyor|değerlendiriyor|işliyor|kuruluyor|bekleniyor/.test(m.status) ? ' busy' : ''}`; if (['durduruldu', 'tur tamamlandı'].includes(m.status)) refreshLast(); } if (m.type === 'turn') refreshLast(); };
es.onerror = () => { $('status').textContent = 'Oyunla bağlantı koptu'; $('statusDot').className = 'dot bad'; };

renderChrome();
const mapData = await api('/api/map');
await refreshLast();
requestAnimationFrame(() => setTimeout(async () => { await map.init(mapData, S.data.world); $('loading').hidden = true; drawMap(); }, 30));
