import { rand, pick, sum } from '../engine/util.js';
import { atWar, countryProvinces, aliveCountries } from '../engine/world.js';

const IDEOLOGIES = [
  { ideology: 'Liberal cumhuriyetçilik', regime: 'Parlamenter cumhuriyet', elections: true, press: 80, axes: { econ: 35, auth: -50, nation: 0, faith: -20 } },
  { ideology: 'Devrimci sosyalizm', regime: 'Tek parti devleti', elections: false, press: 15, axes: { econ: -75, auth: 60, nation: 10, faith: -60 } },
  { ideology: 'Kutsal monarşi', regime: 'Mutlak monarşi', elections: false, press: 20, axes: { econ: 25, auth: 75, nation: 35, faith: 80 } },
  { ideology: 'Milliyetçi otoriterlik', regime: 'Başkanlık diktatörlüğü', elections: false, press: 25, axes: { econ: 15, auth: 70, nation: 85, faith: 20 } },
  { ideology: 'Sosyal demokrasi', regime: 'Federal cumhuriyet', elections: true, press: 75, axes: { econ: -25, auth: -30, nation: -10, faith: -10 } },
  { ideology: 'Tacir oligarşisi', regime: 'Tacirler konseyi', elections: false, press: 50, axes: { econ: 80, auth: 15, nation: -20, faith: 0 } }
];
const COLOR = ['#2f6f8f', '#a33b3b', '#6a8d3a', '#8a5aa8', '#c58a2a', '#3b8f7f', '#b0577a'];
const NAMES = ['Varen', 'Toldar', 'Sumera', 'Hazenya', 'Ordal', 'Keltimar', 'Marunya'];
const SUFFIX = ['Cumhuriyeti', 'Halk Devleti', 'Krallığı', 'Birliği', 'Konfederasyonu', 'Konseyi'];

export function npcFounding(w, c, i) {
  const t = pick(w, IDEOLOGIES);
  return { name: `${NAMES[i % NAMES.length]} ${pick(w, SUFFIX)}`, ideology: t.ideology, regime: t.regime, elections: t.elections, press_freedom: t.press, axes: t.axes, motto: 'Düzen ve refah.', colors: [COLOR[i % COLOR.length], '#efe6c9'] };
}

const enemies = (w, c) => aliveCountries(w).filter(o => o.id !== c.id && atWar(w, c.id, o.id));
const might = (w, id) => sum(Object.values(w.units).filter(u => u.country === id), u => u.men);
const provIsBorder = (w, p, id) => p.neighbors.some(n => w.provinces[n].controller === id);

export function npcDecide(w, ch) {
  const c = w.countries[ch.country], ops = [];
  if (!c?.alive) return ops;
  if (ch.role === 'leader') return npcLeader(w, ch, c);
  const myPlot = w.plots.find(p => p.active && p.leader === ch.id);
  const joined = w.plots.find(p => p.active && p.members.includes(ch.id));
  const disloyal = ch.ambition * .6 + (100 - ch.loyalty) * .4 + (100 - c.legitimacy) * .35 + c.unrest * .25;
  if (myPlot) {
    const others = [c.general, c.opposition, c.oligarch].filter(x => x && x !== ch.id && !myPlot.members.includes(x));
    if (others.length && rand(w) < .5) ops.push({ op: 'invite_plot', plot: myPlot.id, character: pick(w, others) });
    if (myPlot.progress >= 55 || (myPlot.exposed && myPlot.progress > 25)) ops.push({ op: 'execute_plot', plot: myPlot.id });
    return ops;
  }
  if (!joined && disloyal > 100 && rand(w) < .14) { ops.push({ op: 'start_plot', kind: ch.role === 'general' ? 'darbe' : (c.unrest > 40 ? 'isyan' : 'darbe'), secrecy: .6 }); return ops; }
  if (ch.role === 'opposition' && rand(w) < .5) ops.push({ op: 'propaganda', strength: .6 });
  if (ch.role === 'oligarch' && c.blocs.sermaye.sat < 32 && rand(w) < .4) ops.push({ op: 'capital_flight', share: .08 });
  return ops;
}

function npcLeader(w, ch, c) {
  const ops = [];
  const deficit = (c.lastSpending ?? 0) - (c.lastRevenue ?? 0);
  if (deficit > c.gdp * .02 && c.tax.income < .28) ops.push({ op: 'set_tax', kind: 'income', rate: +(c.tax.income + .012).toFixed(3) });
  else if (deficit < -c.gdp * .03 && c.tax.income > .1) ops.push({ op: 'set_tax', kind: 'income', rate: +(c.tax.income - .01).toFixed(3) });
  if (c.paidRatio < .75 && rand(w) < .5) ops.push({ op: 'print_money', pct_gdp: .08 });
  if (c.unrest > 42) ops.push(c.axes.auth > 20 ? { op: 'repress', strength: .55 } : { op: 'concession', cls: 'isci', pct_gdp: .02 });
  if (c.foodRatio < 1 && c.tariff > 0) ops.push({ op: 'set_tariff', rate: 0 });
  if (c.blocs.ordu.sat < 40) ops.push({ op: 'set_budget', category: 'military', share: Math.min(c.budget.military + .01, .14) });
  for (const m of ch.inbox.slice(-5)) {
    const match = /(K-\d+)/.exec(m.text);
    if (match && /komplo|sızdı|ihbar/i.test(m.text)) { const pl = w.plots.find(p => p.id === match[1] && p.active); if (pl) ops.push({ op: 'purge', character: pl.leader, fate: 'hapis' }); }
  }
  for (const t of w.treaties.filter(t => t.pending && t.parties.includes(c.id) && t.proposer !== c.id)) if ((c.relations[t.proposer] ?? 0) > -55 || t.kind === 'baris') ops.push({ op: 'accept_treaty', id: t.id });
  const foes = enemies(w, c);
  if (foes.length) {
    c.armShare = Math.max(c.armShare, .25);
    const my = countryProvinces(w, c.id);
    const fronts = foes.flatMap(f => countryProvinces(w, f.id).filter(p => provIsBorder(w, p, c.id)));
    if (fronts.length) {
      const front = fronts.sort((a, b) => sum(Object.values(w.units).filter(u => u.province === a.id), u => u.men) - sum(Object.values(w.units).filter(u => u.province === b.id), u => u.men))[0];
      ops.push({ op: 'move_army', to: front.id, share: .7 });
    }
    if (c.stock.arms > 2 && c.treasury > c.gdp * .01 && my[0]) ops.push({ op: 'recruit', province: c.capital, men: 25 });
    if (c.warExhaustion > 22 && rand(w) < .3) ops.push({ op: 'propose_treaty', target: pick(w, foes).id, kind: 'baris', terms: 'Eski sınırlara dönüş', annex: false });
    return ops;
  }
  if (rand(w) < .12) {
    const nbrs = [...new Set(countryProvinces(w, c.id).flatMap(p => p.neighbors.map(n => w.provinces[n].controller)))].filter(x => x !== c.id && w.countries[x]?.alive);
    if (nbrs.length) {
      const t = pick(w, nbrs);
      const rel = c.relations[t] ?? 0;
      if (rel > 15) ops.push({ op: 'propose_treaty', target: t, kind: rand(w) < .5 ? 'ticaret' : 'saldirmazlik', terms: 'Karşılıklı yarar' });
      else if (rel < -8 && might(w, c.id) > might(w, t) * .9 && c.axes.auth > 0) ops.push({ op: 'declare_war', target: t });
    }
  }
  const known = countryProvinces(w, c.id).flatMap(p => Object.entries(p.deposits).filter(([, d]) => d.known && d.mine < .5).map(([k]) => [p, k]));
  if (known.length && c.treasury > c.gdp * .02 && c.stock.machines > .5 && rand(w) < .25) { const [p, k] = pick(w, known); ops.push({ op: 'build', province: p.id, kind: 'maden', resource: k, pct_gdp: .02 }); }
  if (c.tension > 58 && c.stock.arms > 1 && rand(w) < .3) ops.push({ op: 'recruit', province: c.capital, men: 12 });
  return ops;
}
