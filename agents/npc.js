import { rand, pick, sum } from '../engine/util.js';
import { atWar, countryProvinces, aliveCountries, hasTreaty } from '../engine/world.js';
import { stanceOf } from '../engine/diplomacy.js';
import { strength, kindOf, baseMap, SHIPS } from '../engine/navy.js';

const enemies = (w, c) => aliveCountries(w).filter(o => o.id !== c.id && atWar(w, c.id, o.id));
const might = (w, id) => sum(Object.values(w.units).filter(u => u.country === id), u => u.men);
const provIsBorder = (w, p, id) => p.neighbors.some(n => w.provinces[n].controller === id);

export function npcDecide(w, ch) {
  const c = w.countries[ch.country], ops = [];
  if (!c?.alive) return ops;
  const dueDebt = (w.debts || []).find(d => d.debtor === ch.id && d.status === 'overdue' && ch.wealth >= d.owed * 1.5);
  if (dueDebt) return [{ op: 'repay_debt', debt: dueDebt.id }];
  if (ch.role === 'leader') return npcLeader(w, ch, c);
  if (ch.role === 'general' && c.general === ch.id) ops.push(...npcStaff(w, c));
  const myPlot = w.plots.find(p => p.active && p.leader === ch.id);
  const joined = w.plots.find(p => p.active && p.members.includes(ch.id));
  const disloyal = ch.ambition * .6 + (100 - ch.loyalty) * .4 + (100 - c.legitimacy) * .35 + c.unrest * .25;
  if (myPlot) {
    const others = [c.general, c.opposition, c.oligarch].filter(x => x && x !== ch.id && !myPlot.members.includes(x));
    if (others.length && rand(w) < .5) ops.push({ op: 'invite_plot', plot: myPlot.id, character: pick(w, others) });
    if (myPlot.progress >= 55 || (myPlot.exposed && myPlot.progress > 25)) ops.push({ op: 'execute_plot', plot: myPlot.id });
    return ops;
  }
  if (!joined && disloyal > 100 && rand(w) < .14) { ops.push({ op: 'start_plot', kind: ch.role === 'general' ? 'coup' : (c.unrest > 40 ? 'uprising' : 'coup'), secrecy: .6 }); return ops; }
  if (ch.role === 'opposition' && rand(w) < .5) ops.push({ op: 'propaganda', strength: .6 });
  if (ch.role === 'oligarch' && c.blocs.capital.sat < 32 && rand(w) < .4) ops.push({ op: 'capital_flight', share: .08 });
  return ops;
}

// A chief of staff by the book. At war, the weaker side stands on the defensive and a frontier unit that is hopelessly outnumbered where it
// stands is told to fall back if pressed; the stronger side keeps its hands free. At peace, troops facing a much stronger neighbour hold their fire.
function npcNavy(w, c, foes) {
  const ops = [], fs = Object.values(w.fleets).filter(f => f.country === c.id && kindOf(f) !== 'submarine'), weight = id => sum(Object.values(w.fleets).filter(f => f.country === id && kindOf(f) !== 'torpedo'), f => strength(w, f));
  if (!foes.length) { for (const f of fs) if (!f.port && f.orders !== 'port') ops.push({ op: 'fleet_orders', fleet: f.id, orders: 'port' }); return ops; }
  // The enemy within reach whose harbours can be closed: the one with the lighter fleet.
  const bases = baseMap(w, c.id), mineW = weight(c.id), prey = foes.map(o => ({ o, sea: countryProvinces(w, o.id).filter(p => p.port > 0).flatMap(p => p.seas).map(s => ({ s, d: bases[s]?.d ?? 99 })).sort((a, b) => a.d - b.d)[0] })).filter(x => x.sea && x.sea.d <= 8 && mineW > weight(x.o.id) * 1.25)[0];
  for (const f of fs) {
    if (kindOf(f) === 'torpedo') continue;
    if (prey && (f.sea !== prey.sea.s || f.port) && f.target !== prey.sea.s && prey.sea.d <= SHIPS[kindOf(f)].reach) ops.push({ op: 'move_fleet', fleet: f.id, to: prey.sea.s }, { op: 'fleet_orders', fleet: f.id, orders: 'blockade' });
    else if (!prey && !f.port && f.orders !== 'port') ops.push({ op: 'fleet_orders', fleet: f.id, orders: 'port' });
  }
  return ops;
}
function npcStaff(w, c) {
  const ops = [...npcNavy(w, c, enemies(w, c))], mine = Object.values(w.units).filter(u => u.country === c.id), foes = enemies(w, c), menAt = (id, pid) => sum(Object.values(w.units).filter(u => u.country === id && u.province === pid), u => u.men);
  if (!mine.length) return ops;
  if (foes.length) {
    const theirs = sum(foes, f => might(w, f.id)), weaker = might(w, c.id) < theirs * .75;
    for (const u of mine) {
      const near = sum(w.provinces[u.province].neighbors, n => sum(foes, f => menAt(f.id, n))), here = menAt(c.id, u.province), want = near > here * 4 ? 'fall_back' : weaker ? 'defensive' : 'ordinary';
      if (want === 'ordinary' ? ['defensive', 'fall_back'].includes(u.posture) : u.posture !== want && u.posture !== 'no_retreat') ops.push(want === 'ordinary' ? { op: 'set_posture', unit: u.id, posture: u.posture, on: false } : { op: 'set_posture', unit: u.id, posture: want });
    }
    return ops;
  }
  for (const u of mine) if (['defensive', 'fall_back'].includes(u.posture)) ops.push({ op: 'set_posture', unit: u.id, posture: u.posture, on: false });
  const nbrs = [...new Set(countryProvinces(w, c.id).flatMap(p => p.neighbors.map(n => w.provinces[n].controller)))].filter(x => x !== c.id && w.countries[x]?.alive);
  for (const id of nbrs) { const strong = might(w, id) > might(w, c.id) * 1.5; if (strong && !c.holdFire?.[id]) ops.push({ op: 'set_posture', facing: id, posture: 'hold_fire' }); else if (!strong && c.holdFire?.[id]) ops.push({ op: 'set_posture', facing: id, posture: 'hold_fire', on: false }); }
  return ops;
}

function npcLeader(w, ch, c) {
  const ops = [];
  const deficit = (c.lastSpending ?? 0) - (c.lastRevenue ?? 0);
  if (deficit > c.gdp * .02 && c.tax.income < .28) ops.push({ op: 'set_tax', kind: 'income', rate: +(c.tax.income + .012).toFixed(3) });
  else if (deficit < -c.gdp * .03 && c.tax.income > .1) ops.push({ op: 'set_tax', kind: 'income', rate: +(c.tax.income - .01).toFixed(3) });
  if (c.paidRatio < .75 && rand(w) < .5) ops.push({ op: 'print_money', pct_gdp: .08 });
  if (c.unrest > 42) ops.push(c.axes.auth > 20 ? { op: 'repress', strength: .55 } : { op: 'concession', cls: 'workers', pct_gdp: .02 });
  if (c.foodRatio < 1 && c.tariff > 0) ops.push({ op: 'set_tariff', rate: 0 });
  // A ruler whose granaries are running low buys grain abroad while there is gold, and has land drained and watered where it will still take it.
  if (c.foodRatio < 1.08) {
    if (c.foodRatio < 1 && c.reserves > 20) ops.push({ op: 'buy_goods', good: 'grain', amount: Math.round((c._need?.grain || 0) * .25) });
    const land = countryProvinces(w, c.id).filter(p => (p.fertileMax ?? p.fertility * 1.5) - p.fertility > .05).sort((a, b) => b.pops.peasants.n - a.pops.peasants.n)[0];
    if (land && (c.paidRatio ?? 1) >= .95) ops.push({ op: 'build', province: land.id, kind: 'farming', pct_gdp: .01 });
  }
  if (c.blocs.army.sat < 40) ops.push({ op: 'set_budget', category: 'military', share: Math.min(c.budget.military + .01, .14) });
  for (const m of ch.inbox.slice(-5)) {
    const match = /(K-\d+)/.exec(m.text);
    if (match && /plot|leaked|inform/i.test(m.text)) { const pl = w.plots.find(p => p.id === match[1] && p.active); if (pl) ops.push({ op: 'purge', character: pl.leader, fate: 'imprisoned' }); }
  }
  // A proposal is signed if nobody in it is hated and it costs no land; a peace is signed even at the price of land once the country is tired of the war.
  for (const t of w.treaties.filter(t => (t.pending && t.parties.includes(c.id) && t.proposer !== c.id && !(t.signed || []).includes(c.id)) || (t.multi && t.active && (t.open || []).includes(c.id)))) {
    const others = (t.multi ? t.invited || t.parties : [t.proposer]).filter(id => id !== c.id), worst = Math.min(...others.map(id => c.relations[id] ?? 0), 0), land = (t.grants || []).some(g => w.provinces[g.province]?.owner === c.id) || (t.cede || []).some(pid => w.provinces[pid]?.owner === c.id);
    if (['peace', 'armistice'].includes(t.kind) ? !land || c.warExhaustion > 25 : worst > -55 && !land) ops.push({ op: 'accept_treaty', id: t.id });
  }
  // An invitation to a table is taken up unless the host is an enemy in all but name.
  for (const x of w.conferences || []) if (x.open && x.invited.includes(c.id) && !x.came.includes(c.id) && !x.declined.includes(c.id)) ops.push({ op: 'attend_conference', id: x.id, attend: (c.relations[x.host] ?? 0) > -40 });
  // A new state is recognised by those who have no love for its mother country, and by the rest once it has held its ground for two years.
  for (const o of aliveCountries(w)) if (o.recognition && o.bornOf !== c.id && !o.recognition.includes(c.id) && !atWar(w, c.id, o.id) && rand(w) < .3 && ((c.relations[o.bornOf] ?? 0) < -20 || (w.turn - ((o.noSplitUntil ?? w.turn + 16) - 16) >= 8 && countryProvinces(w, o.id).length >= 2))) ops.push({ op: 'recognise', target: o.id });
  // A wrong the country holds against a neighbour is answered by steps short of war before anything else: the envoy comes home, then their goods pay for it; when the anger has faded the envoy goes back.
  for (const [id, g] of Object.entries(c.grudges || {})) { const o = w.countries[id]; if (!o?.alive || atWar(w, c.id, id)) continue; const hot = g.incident >= 8, mine = stanceOf(c, id);
    if (hot && mine === 'normal' && !hasTreaty(w, c.id, id, 'alliance')) ops.push({ op: 'set_relations', target: id, level: 'recalled' });
    else if (hot && g.incident >= 20 && c.aimed?.[id] == null && !hasTreaty(w, c.id, id, 'trade')) ops.push({ op: 'set_tariff', target: id, rate: Math.min(1, +(c.tariff + .25).toFixed(2)) });
    else if (!hot && g.incident < 3) { if (mine === 'recalled') ops.push({ op: 'set_relations', target: id, level: 'normal' }); if (c.aimed?.[id] != null) ops.push({ op: 'set_tariff', target: id, clear: true }); } }
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
    if (c.warExhaustion > 22 && rand(w) < .3) ops.push({ op: 'propose_treaty', target: pick(w, foes).id, kind: 'peace', terms: 'Return to the old borders', annex: false });
    return ops;
  }
  if (rand(w) < .12) {
    const nbrs = [...new Set(countryProvinces(w, c.id).flatMap(p => p.neighbors.map(n => w.provinces[n].controller)))].filter(x => x !== c.id && w.countries[x]?.alive);
    if (nbrs.length) {
      const t = pick(w, nbrs);
      const rel = c.relations[t] ?? 0;
      if (rel > 15) ops.push({ op: 'propose_treaty', target: t, kind: rand(w) < .5 ? 'trade' : 'nonaggression', terms: 'Mutual benefit' });
      else if (rel < -8 && might(w, c.id) > might(w, t) * .9 && c.axes.auth > 0) ops.push({ op: 'declare_war', target: t });
    }
  }
  const known = countryProvinces(w, c.id).flatMap(p => Object.entries(p.deposits).filter(([, d]) => d.known && d.mine < .5).map(([k]) => [p, k]));
  if (known.length && c.treasury > c.gdp * .02 && c.stock.machines > .5 && rand(w) < .25) { const [p, k] = pick(w, known); ops.push({ op: 'build', province: p.id, kind: 'mine', resource: k, pct_gdp: .02 }); }
  if (c.tension > 58 && c.stock.arms > 1 && rand(w) < .3) ops.push({ op: 'recruit', province: c.capital, men: 12 });
  return ops;
}
