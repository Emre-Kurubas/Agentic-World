import { clamp, sum, news, between, rand } from './util.js';
import { CLASSES, atWar, hasTreaty, countryProvinces, aliveCountries } from './world.js';
import { hasTech } from './economy.js';
import { neutralize } from './politics.js';

const SHIP_POWER = { cruiser: 1, battleship: 3.5, submarine: .6 };
let supplied = {};
// A unit is in supply only if its province connects to its capital through friendly ground.
function supplyNetwork(w, c) {
  const reach = new Set(), q = c.capital && w.provinces[c.capital] ? [c.capital] : [];
  for (const x of q) reach.add(x);
  while (q.length) { const x = q.shift(); for (const n of w.provinces[x].neighbors) { const o = w.provinces[n].controller; if (!reach.has(n) && (o === c.id || hasTreaty(w, c.id, o, 'askeri_gecis') || hasTreaty(w, c.id, o, 'ittifak'))) { reach.add(n); q.push(n); } } }
  return reach;
}
const commanderOf = (w, u) => w.characters[u.commander]?.alive ? w.characters[u.commander] : w.characters[w.countries[u.country]?.general];

const TERRAIN_DEF = { ova: 1.05, tepe: 1.35, orman: 1.25, dag: 1.75, col: 1.1, bataklik: 1.4, tundra: 1.2 };
const KIND = { piyade: 1, topcu: 1.7, zirhli: 3.2, hava: 2.6 };

export function pathStep(w, from, to, country) {
  if (from === to) return null;
  const seen = new Set([from]), q = [[from, null]];
  while (q.length) {
    const [cur, first] = q.shift();
    for (const n of w.provinces[cur].neighbors) {
      if (seen.has(n)) continue;
      seen.add(n);
      const f = first || n;
      if (n === to) return f;
      if (canEnter(w, country, n)) q.push([n, f]);
    }
  }
  return null;
}

export function canEnter(w, country, pid) {
  const p = w.provinces[pid];
  return p.controller === country || atWar(w, country, p.controller) || hasTreaty(w, country, p.controller, 'askeri_gecis') || hasTreaty(w, country, p.controller, 'ittifak');
}

const force = (w, u, def) => {
  const c = w.countries[u.country];
  const p = w.provinces[u.province];
  const net = supplied[u.country], linked = net ? net.has(u.province) || p.neighbors.some(n => net.has(n)) : p.controller === u.country || p.neighbors.some(n => w.provinces[n].controller === u.country);
  const supply = (c.stock.arms > 0 ? 1 : .55) * (linked ? 1 : .68) * (.8 + Math.min(p.infra, 1) * .2) * (1 + p.rail * .08);
  const auto = hasTech(c, 'otomatik_silah') && u.kind === 'piyade' ? 1.2 : 1;
  const motorized = ['zirhli', 'hava'].includes(u.kind), fuel = motorized ? (c.fuelRatio ?? 1) >= .6 ? 1 : .35 : 1;
  const terrainApplies = u.kind === 'hava' ? 1 : (u.kind === 'zirhli' && ['dag', 'bataklik', 'orman'].includes(p.terrain) ? .55 : 1);
  const dug = def > 1 ? 1 + (u.dug || 0) * .1 : 1, skill = commanderOf(w, u)?.skill ?? 1;
  return u.men * u.equip * u.quality * c.tech.mil * (u.morale / 70) * supply * def * (KIND[u.kind] || 1) * auto * fuel * terrainApplies * dug * skill;
};

export function militaryStep(w) {
  supplied = Object.fromEntries(aliveCountries(w).map(c => [c.id, supplyNetwork(w, c)]));
  for (const u of Object.values(w.units)) {
    if (!u.target) { u.dug = Math.min(3, (u.dug || 0) + 1); continue; }
    u.dug = 0;
    const c = w.countries[u.country], speed = ['zirhli', 'hava'].includes(u.kind) && (c.fuelRatio ?? 1) >= .6 ? 2 : 1;
    for (let i = 0; i < speed + (w.provinces[u.province].rail && w.provinces[u.province].controller === u.country ? 1 : 0) && u.target; i++) {
      const step = pathStep(w, u.province, u.target, u.country);
      if (!step || !canEnter(w, u.country, step)) { u.target = null; break; }
      u.province = step;
      if (u.province === u.target) u.target = null;
      // Armies halt on contact: moving next to the enemy ends the march, so fronts form.
      if (Object.values(w.units).some(x => atWar(w, x.country, u.country) && (x.province === step || w.provinces[step].neighbors.includes(x.province)))) break;
    }
  }
  navalStep(w);
  for (const c of aliveCountries(w)) upkeep(w, c);
  const byProv = {};
  for (const u of Object.values(w.units)) (byProv[u.province] ||= []).push(u);
  for (const [pid, us] of Object.entries(byProv)) resolve(w, pid, us);
  for (const u of Object.values(w.units)) if (u.men < 2 || u.morale <= 3) { delete w.units[u.id]; }
  const remaining = {};
  for (const u of Object.values(w.units)) (remaining[u.province] ||= []).push(u);
  for (const [pid, us] of Object.entries(remaining)) {
    const p = w.provinces[pid];
    const occ = us.filter(u => atWar(w, u.country, p.controller));
    if (!occ.length || us.some(u => u.country === p.controller)) { if (!occ.length) delete p.siege; continue; }
    const by = occ.sort((a, b) => b.men - a.men)[0].country;
    if ((p.fort || 0) >= 1) {
      p.siege = p.siege?.by === by ? { by, turns: p.siege.turns + 1 } : { by, turns: 1 };
      if (p.siege.turns === 1) news(w, `${w.countries[by].name} laid siege to the fortress at ${p.name}.`, { kind: 'savas', countries: [by, p.controller] });
      p.fort = Math.max(0, p.fort - .12);
      if (p.siege.turns < Math.ceil(p.fort) + 1) continue;
    }
    delete p.siege; p.fort = Math.max(0, (p.fort || 0) - 1);
    capture(w, p, by);
  }
}

function navalStep(w) {
  for (const f of Object.values(w.fleets)) {
    if (!f.target || f.target === f.sea) { f.target = null; continue; }
    const prev = { [f.sea]: null }, q = [f.sea]; let path = null;
    while (q.length && !path) { const x = q.shift(); if (x === f.target) { path = []; for (let c = x; c; c = prev[c]) path.unshift(c); break; } for (const n of [...w.seas[x].neighbors, ...w.canals.filter(k => k.a === x || k.b === x).map(k => k.a === x ? k.b : k.a)]) if (!(n in prev)) { prev[n] = x; q.push(n); } }
    if (!path) { f.target = null; continue; }
    f.sea = path[Math.min(3, path.length - 1)]; if (f.sea === f.target) f.target = null;
  }
  const bySea = {};
  w.seaRaids = {};
  for (const f of Object.values(w.fleets)) (bySea[f.sea] ||= []).push(f);
  w.seaControl = {};
  for (const [sea, fs] of Object.entries(bySea)) {
    const owners = [...new Set(fs.map(f => f.country))];
    const hostile = owners.some(a => owners.some(b => atWar(w, a, b)));
    if (hostile) {
      const pow = f => (SHIP_POWER[f.kind] ?? 1) * f.ships * f.quality * (f.morale / 70) * w.countries[f.country].tech.mil * (hasTech(w.countries[f.country], 'petrol_motoru') && (w.countries[f.country].fuelRatio ?? 1) < .5 ? .4 : 1);
      const force = Object.fromEntries(owners.map(o => [o, sum(fs.filter(f => f.country === o), pow)]));
      const top = owners.sort((a, b) => force[b] - force[a])[0];
      for (const f of fs) { if (!atWar(w, f.country, top) && f.country !== top) continue; const lost = f.country === top ? .06 : .3; f.ships *= 1 - lost; f.morale = clamp(f.morale + (f.country === top ? 2 : -14), 0, 100); }
      news(w, `${w.seas[sea].name || 'Açık denizde'} deniz çatışması: ${w.countries[top].name} üstün geldi.`, { kind: 'savas', countries: owners });
    }
    const alive = fs.filter(f => f.ships >= 1), surface = alive.filter(f => f.kind !== 'submarine');
    if (surface.length) w.seaControl[sea] = surface.sort((a, b) => (SHIP_POWER[b.kind] ?? 1) * b.ships - (SHIP_POWER[a.kind] ?? 1) * a.ships)[0].country;
    const subs = [...new Set(alive.filter(f => f.kind === 'submarine').map(f => f.country))];
    if (subs.length) w.seaRaids[sea] = subs;
  }
  for (const p of Object.values(w.provinces)) if (p.battery) for (const sea of p.seas) for (const f of Object.values(w.fleets)) if (f.sea === sea && atWar(w, f.country, p.controller)) f.ships *= 1 - p.battery * .03;
  for (const f of Object.values(w.fleets)) if (f.ships < 1) delete w.fleets[f.id];
}

function upkeep(w, c) {
  const us = Object.values(w.units).filter(u => u.country === c.id);
  const men = sum(us, u => u.men);
  if (!men) return;
  const ships = sum(Object.values(w.fleets).filter(f => f.country === c.id), f => f.ships);
  const forts = sum(countryProvinces(w, c.id), p => (p.fort || 0) * 3 + (p.battery || 0) * 2);
  const required = (men * .12 + ships * .6 + forts) * c.priceLevel;
  const funded = clamp((c.budget.military * c.gdp * c.paidRatio) / Math.max(required, 1), 0, 1.3);
  c.militaryFunding = funded;
  const inWar = w.wars.some(x => x.active && (x.a.includes(c.id) || x.b.includes(c.id)));
  const consume = men * (inWar ? .012 : .004);
  c.stock.arms = Math.max(0, c.stock.arms - consume);
  for (const u of us) {
    u.morale = clamp(u.morale + (funded - .85) * 10 - c.arrears * 2.2 - c.warExhaustion * .03, 0, 100);
    u.equip = clamp(u.equip + (c.stock.arms > 0 ? .02 : -.05) * (funded > .6 ? 1 : .3), .2, 1.4);
    if (supplied[c.id] && !supplied[c.id].has(u.province) && !w.provinces[u.province].neighbors.some(n => supplied[c.id].has(n))) { u.men *= .92; u.morale = clamp(u.morale - 6, 0, 100); }
    u.loyalty = clamp(u.loyalty + (funded - .85) * 5 - c.arrears * 1.4 + (c.legitimacy - 50) * .02, 0, 100);
  }
  c.warExhaustion = Math.max(0, c.warExhaustion - (inWar ? 0 : 2));
}

function resolve(w, pid, us) {
  const owners = [...new Set(us.map(u => u.country))];
  if (owners.length < 2) return;
  const p = w.provinces[pid];
  const defCountry = owners.includes(p.controller) ? p.controller : owners[0];
  const defSide = owners.filter(o => o === defCountry || (!atWar(w, o, defCountry) && owners.some(x => atWar(w, x, o))));
  const atkSide = owners.filter(o => !defSide.includes(o) && defSide.some(d => atWar(w, o, d)));
  if (!atkSide.length) return;
  const D = us.filter(u => defSide.includes(u.country)), A = us.filter(u => atkSide.includes(u.country));
  const point = w.strategic.find(s => s.ref === pid && s.type === 'gecit') ? 1.5 : w.strategic.find(s => s.ref === pid && s.type === 'kopru') ? 1.25 : 1;
  const terrain = TERRAIN_DEF[p.terrain] * (1 + p.infra * .08) * point * (1 + (p.fort || 0) * .3 + (p.trench || 0) * .15);
  const fD = sum(D, u => force(w, u, terrain)) * between(w, .85, 1.15);
  const fA = sum(A, u => force(w, u, 1)) * between(w, .85, 1.15);
  const lossD = clamp(.09 * Math.pow(fA / Math.max(fD, 1), .7), .02, .42);
  const lossA = clamp(.09 * Math.pow(fD / Math.max(fA, 1), .7), .02, .42);
  const apply = (xs, loss, won) => xs.map(u => {
    const dead = u.men * loss; u.men -= dead;
    u.morale = clamp(u.morale + (won ? 3 : -8 - loss * 45), 0, 100);
    w.countries[u.country].warExhaustion = clamp(w.countries[u.country].warExhaustion + dead / 40, 0, 100);
    return dead;
  }).reduce((a, x) => a + x, 0);
  const atkWins = fA > fD;
  const winGen = commanderOf(w, (atkWins ? A : D)[0]), loseGen = commanderOf(w, (atkWins ? D : A)[0]);
  if (winGen) { winGen.skill = clamp((winGen.skill ?? 1) + .01, .5, 1.6); (winGen.record ||= { won: 0, lost: 0 }).won++; }
  if (loseGen) { (loseGen.record ||= { won: 0, lost: 0 }).lost++; if (rand(w) < .03) { news(w, `${loseGen.name} fell in battle at ${p.name}.`, { kind: 'savas', countries: [loseGen.country] }); neutralize(w, loseGen, 'olu'); } }
  const dd = apply(D, lossD, !atkWins), da = apply(A, lossA, atkWins);
  p.devastation = clamp(p.devastation + .1 + (dd + da) / 700, 0, 1);
  for (const k of CLASSES) p.pops[k].n *= .985;
  const loser = atkWins ? D : A;
  for (const u of loser) {
    const back = w.provinces[pid].neighbors.find(n => w.provinces[n].controller === u.country) ?? w.provinces[pid].neighbors.find(n => hasTreaty(w, u.country, w.provinces[n].controller, 'ittifak'));
    if (back) { u.province = back; u.target = null; } else { u.morale *= .4; u.men *= .6; }
  }
  news(w, `${p.name} Muharebesi: ${atkWins ? w.countries[atkSide[0]].name : w.countries[defCountry].name} üstün geldi. Kayıplar: saldıran ${Math.round(da)} bin, savunan ${Math.round(dd)} bin.`, { kind: 'savas', countries: [...atkSide, ...defSide] });
  w.battles.push({ province: pid, attacker: atkSide[0], defender: defCountry, attackerWon: atkWins, lossA: Math.round(da), lossD: Math.round(dd) });
}

export function capture(w, p, by) {
  const from = p.controller;
  if (from === by) return;
  p.controller = by;
  p.unrest = clamp(p.unrest + 12, 0, 100);
  w.countries[by].legitimacy = clamp(w.countries[by].legitimacy + .5, 0, 100);
  news(w, `${w.countries[by].name} güçleri ${p.name} eyaletini ele geçirdi.`, { kind: 'savas', countries: [by, from] });
  if (w.countries[from].capital === p.id) {
    const nextCap = countryProvinces(w, from)[0];
    w.countries[from].legitimacy = clamp(w.countries[from].legitimacy - 10, 0, 100);
    if (nextCap) { w.countries[from].capital = nextCap.id; news(w, `${w.countries[from].name} başkentini kaybetti; hükümet ${nextCap.name} kentine çekildi.`, { kind: 'savas', countries: [from] }); }
  }
}
