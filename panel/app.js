import { WorldMap, TERR, ETHC } from './map.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TABS = [['world', 'World'], ['country', 'Country'], ['province', 'Province'], ['person', 'People'], ['resources', 'Resources'], ['minds', 'Minds'], ['messages', 'Correspondence'], ['referee', 'Referee'], ['gallery', 'Gallery'], ['ledger', 'Ledger']];
const LAYERS = [['political', 'Political'], ['terrain', 'Terrain'], ['resources', 'Resources'], ['trade', 'Trade'], ['unrest', 'Unrest'], ['ethnic', 'Ethnic']];
const ROLE = { leader: 'Leader', general: 'General', opposition: 'Opposition', oligarch: 'Oligarch', former_leader: 'Former leader' };
const GOOD_LABEL = { grain: 'Grain', timber: 'Timber', coal: 'Coal', iron: 'Iron', copper: 'Copper', oil: 'Oil', phosphate: 'Phosphate', rare: 'Rare metal', gold: 'Gold', steel: 'Steel', fuel: 'Fuel', fertilizer: 'Fertilizer', machines: 'Machinery', goods: 'Consumer goods', arms: 'Arms' };
const CHIP = { coal: 'Co', iron: 'Fe', copper: 'Cu', oil: 'Oi', phosphate: 'Ph', rare: 'Ra', gold: 'Au' };
const TERRAIN_LABEL = { plains: 'Plains', forest: 'Forest', hills: 'Hills', mountain: 'Mountain', desert: 'Desert', marsh: 'Marsh', tundra: 'Tundra' };
const ST = { strait: 'Strait', pass: 'Pass', bridge: 'Bridge', port: 'Natural harbor', canal_site: 'Canal route', canal: 'Canal' };
const KINDS = [['state', 'State change'], ['battle', 'Battle'], ['news', 'News'], ['thought', 'Thought'], ['ruling', 'Referee'], ['rule', 'Rule action'], ['message', 'Message'], ['query', 'Lookup'], ['system', 'Technical']];
const KIND_LABEL = Object.fromEntries(KINDS);
const WIDE = new Set(['ledger', 'person', 'gallery']);
const S = { meta: null, turn: 0, last: -1, data: null, tab: 'world', layer: 'political', country: null, province: null, live: true, marks: {}, person: null, led: { q: '', kinds: new Set(), country: '', fail: false, imp: false, from: '', to: '' }, cardsAt: -1 };
const fmt = n => Math.round(n).toLocaleString('en-US');
const api = p => fetch(p, { cache: 'no-store' }).then(r => r.json());
const quarter = t => t <= 0 ? 'Start' : `Q${(t % 4) + 1} ${1900 + Math.floor(t / 4)}`;
const country = id => S.data?.world.countries[id];
const cColor = id => country(id)?.colors?.[0] ?? '#8a9a94';
const leaderName = c => S.data.world.characters[c.leader]?.name ?? '';

const map = new WorldMap({
  svg: $('map'),
  onProvince(id) { const p = S.data.world.provinces[id]; S.province = id; S.country = p.controller; S.tab = 'province'; openDrawer(); renderChrome(); renderAll(); },
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
  const strat = '<span><svg width="14" height="14"><path d="M7 0l6 7-6 7-6-7z" fill="#f0c95a" stroke="#14242a"/></svg>Strategic point</span>';
  const chit = '<span><svg width="22" height="14"><rect width="22" height="14" fill="#f7f3e6"/><rect width="9" height="14" fill="#6e8a8c"/></svg>Army, thousands</span>';
  const L = {
    political: `<span><svg width="16" height="16" viewBox="-11 -11 22 22"><path d="M0-10 2.8-5.2 8-7 6-1.8 10.4 0 6 2 8 7.2 2.8 5.4 0 10.2-2.8 5.4-8 7.2-6 2-10.4 0-6-1.8-8-7-2.8-5.2z" fill="#f0c95a" stroke="#14242a"/></svg>Capital</span>${chit}<span><svg width="14" height="14"><path d="M1 13 13 1M-3 6 6-3M7 17 17 7" stroke="#d9d4c3" stroke-width="3"/></svg>Occupied</span><span><svg width="14" height="14" viewBox="-12 -12 24 24"><path d="M0-11 2.6-4.4 9.6-7.4 5.2-1.8 11 2.6 3.8 3 3.2 10.6 0 4.8-3.6 10.4-3.8 3-11 2.2-5.2-1.8-9.2-7.6-2.6-4.4z" fill="#b3362b"/></svg>Battle</span>`,
    terrain: Object.entries(TERR).map(([k, c]) => `<span><span class="swatch" style="background:${c}"></span>${TERRAIN_LABEL[k]}</span>`).join(''),
    resources: Object.entries(CHIP).map(([k, c]) => `<span><b>${c}</b>${GOOD_LABEL[k]}</span>`).join('') + '<span>Faded: not yet discovered</span>',
    trade: '<span><svg width="20" height="8"><line x2="20" y1="4" y2="4" stroke="#f6df98" stroke-width="3"/></svg>Sea</span><span><svg width="20" height="8"><line x2="20" y1="4" y2="4" stroke="#a9794a" stroke-width="3"/></svg>Land</span><span>Dashed: tolled</span>',
    unrest: '<span>Calm</span><span style="width:70px;height:9px;background:linear-gradient(90deg,rgb(250,240,226),rgb(190,50,36))"></span><span>Uprising</span>',
    ethnic: eths.map((e, i) => `<span><span class="swatch" style="background:${ETHC[i % ETHC.length]}"></span>${esc(e)}</span>`).join('')
  };
  $('legend').innerHTML = L[S.layer] + (['political', 'trade'].includes(S.layer) ? strat : '');
}
function tip(e, id) {
  const w = S.data.world, p = w.provinces[id], t = $('tip'); if (!p) return;
  const box = $('wrap').getBoundingClientRect(), men = Object.values(w.units).filter(u => u.province === p.id).reduce((a, u) => a + u.men, 0), dep = Object.entries(p.deposits).map(([k, d]) => GOOD_LABEL[k] + (d.known ? '' : ' (hidden)')).join(', ');
  t.hidden = false;
  t.innerHTML = `<b>${esc(p.name)}</b><br>${esc(country(p.controller)?.name)}, ${TERRAIN_LABEL[p.terrain]}<br>Population ${fmt(Object.values(p.pops).reduce((a, x) => a + x.n, 0))}k, unrest ${Math.round(p.unrest)}<br>${esc(p.eth)}, ${esc(p.rel)}<br>Troops ${fmt(men)}k${dep ? `<br>Deposits: ${esc(dep)}` : ''}`;
  t.style.left = `${Math.min(e.clientX - box.left + 14, box.width - 300)}px`; t.style.top = `${Math.min(e.clientY - box.top + 14, box.height - 150)}px`;
}
$('zin').onclick = () => map.zoom(.75); $('zout').onclick = () => map.zoom(1.33); $('zreset').onclick = () => map.fit();

// Top bar: resources of the selected country
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
  const items = [['treasury', 'Treasury', fmt(c.treasury), delta('treasury', true)], ['reserves', 'Gold reserves', fmt(c.reserves), delta('reserves', true)], ['food', 'Food', `${Math.round(c.foodRatio * 100)}%`, delta('food', true)], ['input', 'Industrial inputs', `${Math.round((c.inputRatio ?? 1) * 100)}%`, delta('input', true)], ['legit', 'Legitimacy', Math.round(c.legitimacy), delta('legit', true)], ['unrest', 'Unrest', Math.round(c.unrest), delta('unrest', false)], ['men', 'Troops, k', fmt(men), delta('men', true)], ['grain', 'Grain', fmt(c.stock.grain || 0), ''], ['steel', 'Steel', fmt(c.stock.steel || 0), ''], ['fuel', 'Fuel', fmt(c.stock.fuel || 0), ''], ['arms', 'Arms', fmt(c.stock.arms || 0), '']];
  $('res').innerHTML = items.map(([ic, label, v, d]) => `<div class="stat"><svg viewBox="0 0 20 20" aria-hidden="true">${ICON[ic]}</svg><b>${v}${d}</b><small>${label}</small></div>`).join('');
}
$('countrySel').onchange = e => { S.country = e.target.value; renderAll(); };

function chart(title, data, unit = '') {
  const vals = data.map(d => d.v).filter(v => Number.isFinite(v)), last = vals.at(-1) ?? 0;
  if (vals.length < 2) return `<div class="chart"><h4>${title}<span class="v">${last}${unit}</span></h4><p class="small muted">Collecting data.</p></div>`;
  const min = Math.min(...vals), max = Math.max(...vals), W = 200, H = 54, sx = i => i * W / (vals.length - 1), sy = v => H - 3 - (v - min) / ((max - min) || 1) * (H - 8);
  return `<div class="chart" data-points='${esc(JSON.stringify(data))}' data-unit="${unit}"><h4>${title}<span class="v">${last.toLocaleString('en-US')}${unit}</span></h4><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="${title}: latest value ${last}${unit}"><line x1="0" x2="${W}" y1="${H - 1}" y2="${H - 1}" stroke="#aebbb0" vector-effect="non-scaling-stroke"/><polyline fill="none" stroke="#1b4f5d" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" points="${vals.map((v, i) => `${sx(i)},${sy(v)}`).join(' ')}"/></svg><div class="small muted">range ${min.toLocaleString('en-US')} to ${max.toLocaleString('en-US')}${unit}</div></div>`;
}
function wireCharts() { document.querySelectorAll('.chart[data-points]').forEach(c => { const pts = JSON.parse(c.dataset.points), unit = c.dataset.unit, span = c.querySelector('.v'), base = span.textContent, svg = c.querySelector('svg'); svg.onmousemove = e => { const r = svg.getBoundingClientRect(), i = Math.round((e.clientX - r.left) / r.width * (pts.length - 1)), p = pts[Math.max(0, Math.min(pts.length - 1, i))]; span.textContent = `${quarter(p.t ?? i)}: ${Number(p.v).toLocaleString('en-US')}${unit}`; }; svg.onmouseleave = () => span.textContent = base; }); }

const views = {
  parliamentHtml(c, w) {
    const p = c.parliament, laws = (c.laws || []).slice(-6).reverse(), open = (c.bills || []).filter(b => b.status === 'pending');
    if (!p && !laws.length) return '';
    const seats = p ? c.parties.filter(x => p.seats[x.id]).sort((a, b) => p.seats[b.id] - p.seats[a.id]).map(x => `<div class="bar2"><span>${esc(x.name.slice(0, 13))}${x.id === c.rulingParty ? ' ★' : ''}</span><i><b style="width:${p.seats[x.id]}%"></b></i><span>${p.seats[x.id]}</span></div>`).join('') : '';
    return `<h3>${p ? esc(p.name) : 'Laws'}</h3>${p ? `<p class="small muted">${p.legislative ? 'Legislative' : 'Advisory assembly'}${w.turn < (p.suspendedUntil ?? 0) ? `, suspended until ${quarter(p.suspendedUntil)}` : ''}.</p>${seats}` : ''}${open.length ? `<h4 class="sub">Bills up for a vote</h4>${open.map(b => `<div class="news">${esc(b.title)}<div class="small muted">${esc(b.proposerName)}</div></div>`).join('')}` : ''}${laws.length ? `<h4 class="sub">Latest laws</h4>${laws.map(l => `<div class="news">${esc(l.title)}<div class="small muted">${quarter(l.turn)}, ${l.via === 'parliament' ? 'passed by parliament' : 'decree'}${l.text ? `. ${esc(l.text)}` : ''}</div></div>`).join('')}` : ''}`;
  },
  firmsHtml(c, w) {
    const list = Object.values(w.firms || {}).filter(f => f.country === c.id && f.status === 'open').sort((a, b) => b.lastProfit - a.lastProfit);
    if (!list.length) return '';
    const owner = f => f.owner === 'state' ? 'State' : w.characters[f.owner] ? `<button class="linky" type="button" data-person="${f.owner}">${esc(w.characters[f.owner].name)}</button>` : 'Publicly held';
    return `<h3>Companies</h3><table><tr><th>Company</th><th>Owner</th><th class="n">Last profit</th></tr>${list.map(f => `<tr><td>${esc(f.name)}</td><td>${owner(f)}</td><td class="n">${f.lastProfit.toFixed(1)}</td></tr>`).join('')}</table>`;
  },
  treatiesHtml(c, w) {
    const list = w.treaties.filter(t => t.active && t.parties.includes(c.id));
    if (!list.length) return '';
    return `<h3>Treaties</h3>${list.map(t => `<div class="entry"><span class="who2">${esc(t.kind)}</span> <span class="muted">${esc(country(t.parties.find(x => x !== c.id))?.name)}</span>${t.terms ? `<div class="small">${esc(t.terms)}</div>` : ''}${t.clauses?.length ? `<ul>${t.clauses.map(x => `<li>${esc(x.text ?? x.type)}</li>`).join('')}</ul>` : ''}${t.breaches?.length ? t.breaches.slice(-3).map(b => `<div class="news war small">${quarter(b.turn)}: ${esc(b.text)}</div>`).join('') : ''}</div>`).join('')}`;
  },
  world() {
    const w = S.data.world, cs = Object.values(w.countries).filter(c => c.alive).sort((a, b) => b.realGdp - a.realGdp), wars = w.wars.filter(x => x.active);
    return `<h2>${quarter(S.turn)}</h2><p class="muted small">${cs.length} powers alive. ${wars.length ? `${wars.length} wars under way.` : 'No wars at the moment.'}</p>
    ${cs.map(c => { const h = c.history.at(-1) || {}; return `<button class="row" type="button" data-c="${c.id}"><span class="swatch" style="background:${c.colors[0]}"></span><span><b>${esc(c.name)}</b><br><span class="small muted">${esc(c.regime)}, ${esc(c.ideology)}</span><br><span class="small">${esc(leaderName(c))}</span></span><span class="small" style="text-align:right">GDP ${fmt(h.gdp ?? c.realGdp)}<br>Inflation ${h.infl ?? 0}%<br>Unrest ${h.unrest ?? 0}</span></button>`; }).join('')}
    ${wars.length ? `<h3>Ongoing wars</h3>${wars.map(x => `<div class="news war">${esc(x.name)}<span class="muted small"> (${quarter(x.start)})</span></div>`).join('')}` : ''}
    ${w.past?.length ? `<h3>The world's past</h3>${w.past.map(e => `<div class="news small">${esc(e.text)}</div>`).join('')}` : ''}
    <h3>Strategic points</h3><table><tr><th>Point</th><th>Type</th><th>Controller</th></tr>${w.strategic.map(s => `<tr><td>${esc(s.name)}${s.closed ? ' <span class="badge no">Closed</span>' : ''}${s.toll ? ` <span class="badge">${Math.round(s.toll * 100)}% toll</span>` : ''}</td><td>${ST[s.type]}</td><td>${esc(country(s.controller)?.name ?? '-')}</td></tr>`).join('')}</table>`;
  },
  country() {
    const c = country(S.country) || Object.values(S.data.world.countries).find(x => x.alive); if (!c) return '<p class="empty">No living country.</p>';
    S.country = c.id; const w = S.data.world, h = c.history, s = k => h.map(x => ({ t: x.t, v: x[k] })), ch = Object.values(w.characters).filter(x => x.country === c.id && x.alive), units = Object.values(w.units).filter(u => u.country === c.id);
    return `<h2>${esc(c.name)}</h2><p class="muted small">${esc(c.regime)}. ${esc(c.ideology)}.${c.motto ? ` “${esc(c.motto)}”` : ''}</p>
    <div class="kv"><div><b>${fmt(c.realGdp)}</b><span>Real GDP</span></div><div><b>${Math.round(c.legitimacy)}</b><span>Legitimacy</span></div><div><b>${fmt(units.reduce((a, u) => a + u.men, 0))}k</b><span>Troops</span></div><div><b>${fmt(c.treasury)}</b><span>Treasury</span></div><div><b>${fmt(c.reserves)}</b><span>Gold reserves</span></div><div><b>${(c.rate ?? 1).toLocaleString('en-US', { maximumFractionDigits: 3 })}</b><span>${esc(c.currency?.name ?? 'Money')} / gold</span></div><div><b>${{ floating: 'Floating', gold: 'Pegged to gold', pegged: 'Pegged' }[c.fxRegime] ?? '-'}</b><span>Exchange-rate regime</span></div><div><b>${Math.round(c.foodRatio * 100)}%</b><span>Food</span></div><div><b>${Math.round((c.inputRatio ?? 1) * 100)}%</b><span>Industrial inputs</span></div><div><b>${Math.round(c.literacy)}%</b><span>Literacy</span></div><div><b>${Math.round(c.bankHealth)}</b><span>Bank health</span></div></div>
    <div class="charts">${chart('Currency value', s('fx'))}${chart('Real GDP', s('gdp'))}${chart('Inflation', s('infl'), '%')}${chart('Unemployment', s('unemp'), '%')}${chart('Debt/GDP', s('debt'), '%')}${chart('Legitimacy', s('legit'))}${chart('Unrest', s('unrest'))}</div>
    ${c.chronicle?.length ? `<h3>History</h3>${c.culture ? `<p class="small muted">Language ${esc(c.culture.language)}. ${esc(c.culture.myth)} ${esc(c.culture.custom)}</p>` : ''}<ul class="small life">${c.chronicle.map(e => `<li><b>${e.year}</b> ${esc(e.text)}</li>`).join('')}</ul>` : ''}
    <h3>Parties</h3>${c.parties.map(p => `<div class="bar2"><span>${esc(p.name.slice(0, 13))}</span><i><b style="width:${Math.min(100, p.support)}%"></b></i><span>${Math.round(p.support)}%</span></div>`).join('')}
    <h3>Power blocs</h3>${Object.entries(c.blocs).map(([k, b]) => `<div class="bar2"><span>${k}</span><i><b style="width:${b.sat}%"></b></i><span>${Math.round(b.sat)}</span></div>`).join('')}
    <h3>Stocks</h3><table>${Object.entries(c.stock).filter(([, v]) => v >= .5).map(([k, v]) => `<tr><td>${GOOD_LABEL[k] ?? esc(k)}</td><td class="n">${fmt(v)}</td></tr>`).join('')}</table>
    <h3>Technology</h3><p class="small">${Object.keys(c.techs).join(', ') || 'None yet'}${c.research?.target ? `. In progress: ${esc(c.research.target)}` : ''}</p>
    <h3>People</h3>${ch.map(x => `<div class="entry"><button class="linky" type="button" data-person="${x.id}">${esc(x.name)}</button><span class="badge">${ROLE[x.role] || esc(x.role)}</span>${x.status !== 'free' ? `<span class="badge no">${esc(x.status)}</span>` : ''}<span class="badge">${x.aiControlled ? 'AI' : 'Rules'}</span>${x.persona ? `<div class="persona">${esc(x.persona)}</div>` : ''}${x.diary?.length ? `<div class="small muted">Latest diary: ${esc(x.diary.at(-1))}</div>` : ''}</div>`).join('')}
    ${views.parliamentHtml(c, w)}
    ${c.institutions?.length ? `<h3>Institutions</h3>${c.institutions.map(i => `<div class="entry"><span class="who2">${esc(i.name)}</span>${i.id ? `<span class="badge">Strength ${Math.round((i.strength ?? 0) * 100)}</span><span class="badge">${i.sponsor ? `Private, ${esc(w.characters[i.sponsor]?.name ?? '')}` : `Budget ${(i.budget * 100).toFixed(2)}% of GDP`}</span>` : ''}<div class="small">${esc(i.description)}</div>${i.id ? `<div class="looked">Head: ${i.head ? `<button class="linky" type="button" data-person="${i.head}">${esc(w.characters[i.head]?.name ?? '')}</button>` : 'none'}${i.members.length ? `, ${i.members.length} members` : ''}${i.powers.length ? `. Fields: ${esc(i.powers.join(', '))}` : ''}${i.authority.length ? `. Powers: ${esc(i.authority.join(', '))}` : ''}${i.veto.length ? `. Veto: ${esc(i.veto.join(', '))}` : ''}</div>` : ''}</div>`).join('')}` : ''}
    ${views.treatiesHtml(c, w)}
    ${views.firmsHtml(c, w)}
    ${w.plots.some(p => p.active && p.country === c.id) ? `<h3>Plots</h3>${w.plots.filter(p => p.active && p.country === c.id).map(p => `<div class="news plot">${esc(p.kind)}: ${esc(w.characters[p.leader]?.name)}, progress ${Math.round(p.progress)}${p.exposed ? ' (leaked)' : ' (secret)'}</div>`).join('')}` : ''}`;
  },
  province() {
    const w = S.data.world, p = w.provinces[S.province]; if (!p) return '<p class="empty">Select a province on the map to see details.</p>';
    const sp = w.strategic.filter(s => s.ref === p.id), units = Object.values(w.units).filter(u => u.province === p.id);
    return `<h2>${esc(p.name)}</h2><p class="muted small">${esc(country(p.controller)?.name)}${p.controller !== p.owner ? ` occupation, rightful owner ${esc(country(p.owner)?.name)}` : ''}. ${TERRAIN_LABEL[p.terrain]}, elevation ${p.elevation}.</p>
    <div class="kv"><div><b>${p.fertility.toFixed(2)}</b><span>Soil fertility</span></div><div><b>${p.water.toFixed(2)}</b><span>Water</span></div><div><b>${p.timber.toFixed(2)}</b><span>Forest</span></div><div><b>${p.rail}</b><span>Railway</span></div><div><b>${p.port}</b><span>Port</span></div><div><b>${Math.round(p.unrest)}</b><span>Unrest</span></div></div>
    ${sp.length ? `<h3>Strategic importance</h3>${sp.map(s => `<div class="news">${esc(s.name)} (${ST[s.type]})</div>`).join('')}` : ''}
    <h3>Defences and government</h3><div class="kv"><div><b>${Math.round((p.fort || 0) * 10) / 10}</b><span>Fort</span></div><div><b>${p.battery || 0}</b><span>Coastal battery</span></div><div><b>${p.trench || 0}</b><span>Trench lines</span></div><div><b>${Math.round((p.admin ?? .5) * 100)}%</b><span>State reach</span></div><div><b>${esc(w.characters[p.governor]?.name ?? 'None')}</b><span>Governor</span></div>${p.siege ? `<div><b>${esc(country(p.siege.by)?.name)}</b><span>Besieged, ${p.siege.turns} quarters</span></div>` : ''}</div>
    ${p.groups?.length ? `<h3>Peoples</h3>${p.groups.map(g => `<div class="bar2"><span>${esc(g.eth)}</span><i><b style="width:${g.share * 100}%"></b></i><span>${Math.round(g.share * 100)}%</span></div>`).join('')}<p class="small muted">${esc([...new Set(p.groups.map(g => g.rel))].join(', '))}</p>` : ''}
    ${(w.projects || []).some(x => x.province === p.id && !x.status) ? `<h3>Under construction</h3>${w.projects.filter(x => x.province === p.id && !x.status).map(x => `<div class="small">${esc(x.label ?? x.kind)}: ${x.turnsLeft} quarters left</div>`).join('')}` : ''}
    <h3>Mineral resources</h3>${Object.keys(p.deposits).length ? `<table><tr><th>Resource</th><th class="n">Reserve</th><th class="n">Mine</th><th>Status</th></tr>${Object.entries(p.deposits).map(([k, d]) => `<tr><td>${GOOD_LABEL[k]}</td><td class="n">${fmt(d.amount)}</td><td class="n">${d.mine.toFixed(1)}</td><td>${d.known ? (p.concessions?.[k] ? `Concession: ${esc(country(p.concessions[k].holder)?.name)}` : 'Known') : 'Undiscovered'}</td></tr>`).join('')}</table>` : '<p class="small muted">No known or hidden deposits.</p>'}
    <h3>Industry</h3><table>${Object.entries({ steel: 'Steel', fuel: 'Refinery', fertilizer: 'Chemicals', machines: 'Machinery', goods: 'Consumer goods', arms: 'Arms' }).map(([k, n]) => `<tr><td>${n}</td><td class="n">${p.plants[k].toFixed(2)}</td></tr>`).join('')}</table>
    <h3>Population</h3>${Object.entries(p.pops).map(([k, x]) => `<div class="bar2"><span>${k} ${fmt(x.n)}k</span><i><b style="width:${x.sat}%"></b></i><span>${Math.round(x.sat)}</span></div>`).join('')}<p class="small muted">Bars show satisfaction. ${esc(p.eth)}, ${esc(p.rel)}.</p>
    ${units.length ? `<h3>Units</h3>${units.map(u => `<div class="small">${esc(country(u.country)?.name)}: ${u.kind}, ${fmt(u.men)}k, morale ${Math.round(u.morale)}</div>`).join('')}` : ''}`;
  },
  resources() {
    const w = S.data.world, h = w.priceHistory || [], goods = Object.keys(GOOD_LABEL).filter(g => g !== 'gold');
    const tot = {}; for (const p of Object.values(w.provinces)) for (const [k, d] of Object.entries(p.deposits)) { tot[k] ||= {}; tot[k][p.controller] = (tot[k][p.controller] || 0) + d.amount; }
    return `<h2>World market</h2><p class="small muted">Prices show the last 200 turns.</p><div class="charts">${goods.map(g => chart(GOOD_LABEL[g], h.map((x, i) => ({ t: i, v: x[g] })))).join('')}</div><h3>Distribution of reserves</h3><table><tr><th>Resource</th><th>Largest holder</th><th class="n">Share</th></tr>${Object.entries(tot).map(([k, m]) => { const all = Object.values(m).reduce((a, b) => a + b, 0), [top, val] = Object.entries(m).sort((a, b) => b[1] - a[1])[0]; return `<tr><td>${GOOD_LABEL[k]}</td><td>${esc(country(top)?.name)}</td><td class="n">${Math.round(val / all * 100)}%</td></tr>`; }).join('')}</table>`;
  },
  minds() { const t = S.data.log?.trace || []; if (!t.length) return '<p class="empty">No character thought this turn.</p>'; return t.map(x => `<div class="entry"><span class="swatch" style="background:${cColor(x.country)}"></span> <button class="linky" type="button" data-person="${x.actor}">${esc(x.name)}</button><span class="badge">${ROLE[x.role] || esc(x.role)}</span> <span class="small muted">${esc(country(x.country)?.name)}</span>${x.persona ? `<div class="persona">${esc(x.persona)}</div>` : ''}${x.lookups?.length ? `<div class="looked">Topics looked up: ${esc(x.lookups.join(', '))}</div>` : ''}${x.monologue ? `<blockquote>${esc(x.monologue)}</blockquote>` : ''}${x.decisions?.length ? `<ul>${x.decisions.map(d => `<li>${esc(d)}</li>`).join('')}</ul>` : '<div class="small muted">Chose to do nothing this turn.</div>'}</div>`).join(''); },
  messages() { const m = S.data.log?.messages || []; return m.length ? m.map(x => `<div class="entry"><button class="linky" type="button" data-person="${x.from}">${esc(x.fromName)}</button> <span class="muted">→ ${esc(x.toName)}</span>${x.undelivered ? '<span class="badge no">Not delivered</span>' : ''}<blockquote>${esc(x.text)}</blockquote></div>`).join('') : '<p class="empty">No secret messages this turn.</p>'; },
  referee() { const r = (S.data.log?.rulings || []).filter(x => x.source !== 'rule'); return r.length ? r.map(x => `<div class="entry"><span class="who2">${esc(x.name)}</span><span class="badge ${x.success ? 'ok' : 'no'}">${x.success ? 'Succeeded' : 'Failed'}</span><span class="badge">${Math.round(x.probability * 100)}% probability</span><div>${esc(x.narrative)}</div>${x.results?.length ? `<div class="small muted">${x.results.map(y => `${esc(y.op)}: ${esc(y.msg)}`).join(', ')}</div>` : ''}</div>`).join('') : '<p class="empty">No decisions went to the referee this turn.</p>'; }
};

// The ledger and the person timeline share the same entry view.
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
  const flags = `${e.s === 'rule' || e.s === 'mock' ? '' : ''}${e.ok === false ? `<span class="badge no">${e.k === 'message' ? 'Not delivered' : 'Failed'}</span>` : ''}${x.secret ? '<span class="badge">Secret</span>' : ''}${e.k === 'message' && x.read ? '<span class="badge ok">Read in the same quarter</span>' : ''}${x.probability != null && e.k === 'ruling' ? `<span class="badge">${Math.round(x.probability * 100)}% probability</span>` : ''}${e.imp >= 3 ? '<span class="badge no">Major event</span>' : ''}`;
  let body = `<p>${esc(e.text)}</p>`, more = '';
  if (e.k === 'query') { body = `<p class="muted">Looked up: ${esc(e.q)}</p>`; more = `<details><summary>Answer received</summary><pre>${esc(e.text)}</pre></details>`; }
  if (e.k === 'thought') { const parts = []; if (x.decisions?.length) parts.push(`<ul>${x.decisions.map(d => `<li>${esc(d)}</li>`).join('')}</ul>`); if (x.lookups?.length) parts.push(`<div class="looked">Topics looked up: ${esc(x.lookups.join(', '))}</div>`); if (x.persona) parts.push(`<div class="persona">${esc(x.persona)}</div>`); if (parts.length) more = `<details><summary>Decisions and identity</summary>${parts.join('')}</details>`; if (!e.text) body = ''; }
  if ((e.k === 'ruling' || e.k === 'rule') && (x.ops?.length || x.results?.length || x.decision)) more = `<details><summary>Details</summary>${x.decision ? `<p>Decision: ${esc(x.decision)}</p>` : ''}<pre>${esc(JSON.stringify({ operations: x.ops, results: x.results }, null, 1))}</pre></details>`;
  const pin = e.p ? `<button class="linky" type="button" data-pin="${e.p}">Show on map</button>` : '';
  return `<article class="e k-${e.k}${e.ok === false ? ' fail' : ''}"><header><button class="linky" type="button" data-go="${e.t}">${esc(e.d)}</button><span class="ktag">${KIND_LABEL[e.k] ?? e.k}</span>${who}${to}${flags}${pin}</header>${body}${more}</article>`;
}
function wireEntries(root) {
  root.querySelectorAll('[data-person]').forEach(b => b.onclick = () => openPerson(b.dataset.person));
  root.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(+b.dataset.go));
  root.querySelectorAll('[data-pin]').forEach(b => b.onclick = () => pinTo(b.dataset.pin));
}
function pinTo(ref) { const w = S.data.world, q = w.provinces[ref] ?? w.seas[ref]; if (!q) return; if (w.provinces[ref]) S.province = ref; map.focus(q.cx, q.cy); drawMap(); }
function openPerson(id) { S.person = id; S.tab = 'person'; openDrawer(); renderChrome(); renderBody(); }

class EntryList {
  constructor(el, filter) { this.el = el; this.filter = filter; this.seq = 0; }
  async refresh() {
    const seq = ++this.seq, r = await api(ledgerUrl(this.filter())); if (seq !== this.seq) return;
    this.next = r.next;
    this.el.innerHTML = r.items.length ? `<div class="list">${r.items.map(entryHtml).join('')}</div>${this.moreBtn()}` : '<p class="empty">No records match these filters. Loosen the filters.</p>';
    wireEntries(this.el); this.wireMore();
  }
  moreBtn() { return this.next ? '<button class="more" type="button">Load older records</button>' : ''; }
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

function mountLedger(body) {
  const f = S.led, alive = Object.values(S.data.world.countries).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  body.innerHTML = `<div class="filters"><input type="search" id="ledq" placeholder="Search events, people, decisions" aria-label="Search the ledger" value="${esc(f.q)}">
    <div class="kinds" id="ledk">${KINDS.map(([k, t]) => `<button type="button" data-k="${k}" aria-pressed="${f.kinds.has(k)}">${t}</button>`).join('')}</div>
    <div class="frow"><select id="ledc" aria-label="Country"><option value="">All countries</option>${alive.map(c => `<option value="${c.id}"${f.country === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
    <label><input type="checkbox" id="ledfail"${f.fail ? ' checked' : ''}>Failures</label><label><input type="checkbox" id="ledimp"${f.imp ? ' checked' : ''}>Important</label>
    <label>Turn <input type="number" id="ledfrom" min="0" aria-label="Start turn" value="${esc(f.from)}"></label><label>to <input type="number" id="ledto" min="0" aria-label="End turn" value="${esc(f.to)}"></label><button type="button" id="ledclear">Clear filters</button></div></div><div id="ledlist"></div>`;
  const list = new EntryList($('ledlist'), () => S.led);
  S.mounted = { tab: 'ledger', list };
  let t; const again = () => { clearTimeout(t); t = setTimeout(() => list.refresh(), 220); };
  $('ledq').oninput = e => { f.q = e.target.value; again(); };
  $('ledk').querySelectorAll('button').forEach(b => b.onclick = () => { const k = b.dataset.k; f.kinds.has(k) ? f.kinds.delete(k) : f.kinds.add(k); b.setAttribute('aria-pressed', f.kinds.has(k)); again(); });
  $('ledc').onchange = e => { f.country = e.target.value; again(); };
  $('ledfail').onchange = e => { f.fail = e.target.checked; again(); };
  $('ledimp').onchange = e => { f.imp = e.target.checked; again(); };
  $('ledfrom').oninput = e => { f.from = e.target.value; again(); };
  $('ledto').oninput = e => { f.to = e.target.value; again(); };
  $('ledclear').onclick = () => { S.led = { q: '', kinds: new Set(), country: '', fail: false, imp: false, from: '', to: '' }; mountLedger(body); };
  list.refresh();
}

async function mountPeople(body) {
  const people = Object.values(await api('/api/people')).sort((a, b) => (b.alive - a.alive) || (b.events - a.events));
  if (!people.length) { body.innerHTML = '<p class="empty">No people on record. They appear here after the first turn.</p>'; return; }
  S.person = people.some(p => p.id === S.person) ? S.person : (country(S.country)?.leader ?? people[0].id);
  body.innerHTML = `<div class="split"><div class="plist"><input type="search" id="pq" placeholder="Search people" aria-label="Search people"><div id="pitems"></div></div><div><div id="phead"></div><div id="ptimeline"></div></div></div>`;
  const list = new EntryList($('ptimeline'), () => ({ character: S.person }));
  S.mounted = { tab: 'person', list };
  const colorOf = p => S.data.world.countries[p.country]?.colors?.[0] ?? '#8a9a94';
  const items = (needle = '') => { const n = needle.toLocaleLowerCase('en'); $('pitems').innerHTML = people.filter(p => !n || `${p.name} ${p.countryName}`.toLocaleLowerCase('en').includes(n)).slice(0, 300).map(p => `<button type="button" data-id="${p.id}" aria-current="${p.id === S.person}" class="${p.alive ? '' : 'gone'}"><span class="swatch" style="background:${colorOf(p)}"></span><span>${esc(p.name)}<small>${ROLE[p.role] || esc(p.role)}, ${esc(p.countryName)}${p.alive ? '' : `, ${esc(p.status)}`}</small></span></button>`).join(''); $('pitems').querySelectorAll('button').forEach(b => b.onclick = () => { S.person = b.dataset.id; items($('pq').value); head(); list.refresh(); }); };
  const head = () => { const p = people.find(x => x.id === S.person), ch = S.data.world.characters[S.person]; const lifeHtml = (p.life || []).length ? `<ul class="small life">${p.life.map(e => `<li><b>${e.year}</b> ${esc(e.text)}</li>`).join('')}</ul>` : ''; $('phead').innerHTML = `<div class="phead"><img class="portrait" src="/api/art/portrait-${p.id}.svg" alt="" onerror="this.remove()"><div><h2>${esc(p.name)}</h2><p class="muted small">${ROLE[p.role] || esc(p.role)}, ${esc(p.countryName)}${ch ? `, age ${ch.age}` : ''}. ${p.alive ? (p.ai ? 'Played by AI.' : 'Played by rules.') : `Status: ${esc(p.status)}.`} ${fmt(p.events)} records, from ${quarter(p.first)} to ${quarter(p.last)}.</p>${ch?.rise ? `<p class="small">Rise to power: ${esc(ch.rise)}</p>` : ''}${ch?.background ? `<p class="small">Background: ${esc(ch.background)}</p>` : ''}${(p.persona || ch?.persona) ? `<div class="persona">${esc(p.persona || ch.persona)}</div>` : ''}</div></div>${p.origin ? `<p class="small">${esc(p.origin.birthplace)} , born, ${esc(p.origin.eth)}, ${esc(p.origin.rel)}. ${esc(p.origin.family)}</p>` : ''}${lifeHtml}`; };
  $('pq').oninput = e => items(e.target.value);
  items(); head(); list.refresh();
}

async function mountGallery(body) {
  const art = (await api('/api/art')).reverse();
  if (S.tab !== 'gallery') return;
  body.innerHTML = art.length ? `<div class="gallery">${art.map(a => `<figure><img src="/api/art/${a.id}.svg" alt="${esc(a.caption || a.event || a.witnessName)}" loading="lazy"><figcaption><b>${esc(a.caption)}</b><span class="small muted">${a.kind === 'portrait' ? `Portrait: ${esc(a.witnessName)}` : `${esc(a.date)}. Witness: ${esc(a.witnessName)}. ${esc(a.event)}`}</span></figcaption></figure>`).join('')}</div>` : '<p class="empty">No images yet. Portraits are painted after the first turn, event paintings at major events.</p>';
}

function renderBody() {
  const body = $('body');
  if (S.tab === 'gallery') { S.mounted = null; mountGallery(body); return; }
  if (S.tab === 'ledger') { if (S.mounted?.tab !== 'ledger') mountLedger(body); else if (body.scrollTop < 40 && S.live) S.mounted.list.refresh(); return; }
  if (S.tab === 'person') { if (S.mounted?.tab !== 'person' || S.mounted.person !== S.person) { Promise.resolve(mountPeople(body)).then(() => { if (S.mounted) S.mounted.person = S.person; }); } else if (body.scrollTop < 40 && S.live) S.mounted.list.refresh(); return; }
  S.mounted = null;
  body.innerHTML = views[S.tab]();
  body.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { S.country = b.dataset.c; S.tab = 'country'; renderChrome(); renderAll(); });
  wireEntries(body); wireCharts();
}
function renderAll() { if (!S.data) return; $('date').textContent = quarter(S.turn); const snap = S.data.snapshotTurn ?? S.turn; $('snapnote').hidden = snap === S.turn; $('snapnote').textContent = snap === S.turn ? '' : `Map from the ${quarter(snap)} record`; renderBar(); drawMap(); renderBody(); }
async function load(t) { const d = await api(`/api/turn/${t}`); if (d.error) return; S.data = d; S.turn = t; $('slider').value = t; renderAll(); }

// Important event cards: appear only while watching live, when a new turn arrives.
const MAX_CARDS = 3, CARD_MS = 14000;
async function showCards(t) {
  if (!S.live || t <= S.cardsAt) return;
  S.cardsAt = t;
  const r = await api(`/api/ledger?turn=${t}&imp=2&limit=20`), top = r.items.sort((a, b) => b.imp - a.imp).slice(0, MAX_CARDS), box = $('cards');
  for (const e of top.reverse()) {
    const el = document.createElement('div'), col = cColor(e.c?.[0]);
    el.className = `card i${e.imp}`; el.style.setProperty('--c', col);
    el.innerHTML = `<button type="button" class="open"><small>${esc(e.d)}</small>${esc(e.text)}</button><button type="button" class="x" aria-label="Close card">×</button>`;
    let timer; const close = () => { clearTimeout(timer); el.remove(); }, arm = () => { timer = setTimeout(close, CARD_MS); };
    el.querySelector('.x').onclick = close;
    el.querySelector('.open').onclick = () => { if (e.p) pinTo(e.p); else if (e.c?.[0]) { S.country = e.c[0]; } S.tab = 'ledger'; S.led = { q: '', kinds: new Set(), country: '', fail: false, imp: false, from: e.t, to: e.t }; S.mounted = null; openDrawer(); renderChrome(); renderAll(); close(); };
    el.onmouseenter = () => clearTimeout(timer); el.onmouseleave = arm; arm();
    box.prepend(el);
    while (box.children.length > MAX_CARDS) box.lastChild.remove();
  }
}

function paintMarks() { $('turnmarks').innerHTML = Object.entries(S.marks).map(([t, k]) => `<i title="${k === 'plot' ? 'Plot' : 'War'}, ${quarter(+t)}" style="left:${S.last ? t / S.last * 100 : 0}%;background:${k === 'plot' ? '#b89adb' : '#d1584f'}"></i>`).join(''); }
const amount = n => n >= 1e6 ? `${(n / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 })} million` : `${Math.round(n / 1000)}k`;
function paintUsage(u) {
  const el = $('usage'); el.hidden = !u?.calls; if (!u?.calls) return;
  el.textContent = `Last turn: ${u.calls} calls, ${amount(u.input + u.cacheRead + u.cacheWrite)} tokens`;
  el.title = `Read from cache ${amount(u.cacheRead)}, written to cache ${amount(u.cacheWrite)}, uncached ${amount(u.input)}, generated ${amount(u.output)}. Largest session ${amount(u.largest)}.`;
}
async function refreshLast() { const m = await api('/api/meta'); S.meta = m; paintUsage(m.usage); if (m.lastTurn < 0) return; const fresh = m.lastTurn > S.last && S.last >= 0; S.last = m.lastTurn; S.marks = m.marks || {}; $('slider').max = m.lastTurn; $('pause').textContent = m.paused ? 'Resume game' : 'Pause game'; if (S.live || !S.data) await load(m.lastTurn); paintMarks(); if (fresh) showCards(m.lastTurn); }
function setLive(v) { S.live = v; $('live').classList.toggle('on', v); if (v) refreshLast(); }
const go = t => { setLive(false); load(Math.max(0, Math.min(S.last, t))); };
$('prev').onclick = () => go(S.turn - 1); $('next').onclick = () => go(S.turn + 1); $('slider').oninput = e => go(+e.target.value); $('live').onclick = () => setLive(!S.live);
$('pause').onclick = async () => { await fetch(`/api/control?action=${S.meta?.paused ? 'resume' : 'pause'}`, { method: 'POST', headers: { 'x-panel': '1' } }); setTimeout(refreshLast, 200); };
const es = new EventSource('/api/stream');
es.onmessage = e => { const m = JSON.parse(e.data); if (m.type === 'status') { $('status').textContent = m.status[0].toUpperCase() + m.status.slice(1); $('progress').textContent = m.progress || ''; $('statusDot').className = `dot${m.status === 'error' ? ' bad' : /thinking|negotiating|judging|processing|founding|waiting/.test(m.status) ? ' busy' : ''}`; if (['paused', 'turn complete'].includes(m.status)) refreshLast(); } if (m.type === 'turn') refreshLast(); };
es.onerror = () => { $('status').textContent = 'Connection to the game was lost'; $('statusDot').className = 'dot bad'; };

renderChrome();
const mapData = await api('/api/map');
await refreshLast();
requestAnimationFrame(() => setTimeout(async () => { await map.init(mapData, S.data.world); $('loading').hidden = true; drawMap(); }, 30));
