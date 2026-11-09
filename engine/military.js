import { clamp, sum, news, between, rand } from './util.js';
import { CLASSES, atWar, hasTreaty, countryProvinces, aliveCountries } from './world.js';
import { hasTech } from './economy.js';

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
  const linked = p.controller === u.country || p.neighbors.some(n => w.provinces[n].controller === u.country);
  const supply = (c.stock.arms > 0 ? 1 : .55) * (linked ? 1 : .68) * (.8 + Math.min(p.infra, 1) * .2) * (1 + p.rail * .08);
  const auto = hasTech(c, 'otomatik_silah') && u.kind === 'piyade' ? 1.2 : 1;
  const motorized = ['zirhli', 'hava'].includes(u.kind), fuel = motorized ? (c.fuelRatio ?? 1) >= .6 ? 1 : .35 : 1;
  const terrainApplies = u.kind === 'hava' ? 1 : (u.kind === 'zirhli' && ['dag', 'bataklik', 'orman'].includes(p.terrain) ? .55 : 1);
  return u.men * u.equip * u.quality * c.tech.mil * (u.morale / 70) * supply * def * (KIND[u.kind] || 1) * auto * fuel * terrainApplies;
};

export function militaryStep(w) {
  for (const u of Object.values(w.units)) {
    if (!u.target) continue;
    const c = w.countries[u.country], speed = ['zirhli', 'hava'].includes(u.kind) && (c.fuelRatio ?? 1) >= .6 ? 2 : 1;
    for (let i = 0; i < speed + (w.provinces[u.province].rail && w.provinces[u.province].controller === u.country ? 1 : 0) && u.target; i++) {
      const step = pathStep(w, u.province, u.target, u.country);
      if (!step || !canEnter(w, u.country, step)) { u.target = null; break; }
      u.province = step;
      if (u.province === u.target) u.target = null;
      if (Object.values(w.units).some(x => x.province === step && atWar(w, x.country, u.country))) break;
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
    if (occ.length && !us.some(u => u.country === p.controller)) capture(w, p, occ.sort((a, b) => b.men - a.men)[0].country);
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
  for (const f of Object.values(w.fleets)) (bySea[f.sea] ||= []).push(f);
  w.seaControl = {};
  for (const [sea, fs] of Object.entries(bySea)) {
    const owners = [...new Set(fs.map(f => f.country))];
    const hostile = owners.some(a => owners.some(b => atWar(w, a, b)));
    if (hostile) {
      const pow = f => f.ships * f.quality * (f.morale / 70) * w.countries[f.country].tech.mil * (hasTech(w.countries[f.country], 'petrol_motoru') && (w.countries[f.country].fuelRatio ?? 1) < .5 ? .4 : 1);
      const force = Object.fromEntries(owners.map(o => [o, sum(fs.filter(f => f.country === o), pow)]));
      const top = owners.sort((a, b) => force[b] - force[a])[0];
      for (const f of fs) { if (!atWar(w, f.country, top) && f.country !== top) continue; const lost = f.country === top ? .06 : .3; f.ships *= 1 - lost; f.morale = clamp(f.morale + (f.country === top ? 2 : -14), 0, 100); }
      news(w, `${w.seas[sea].name || 'Açık denizde'} deniz çatışması: ${w.countries[top].name} üstün geldi.`, { kind: 'savas', countries: owners });
    }
    const alive = fs.filter(f => f.ships >= 1);
    if (alive.length) w.seaControl[sea] = alive.sort((a, b) => b.ships - a.ships)[0].country;
  }
  for (const f of Object.values(w.fleets)) if (f.ships < 1) delete w.fleets[f.id];
}

function upkeep(w, c) {
  const us = Object.values(w.units).filter(u => u.country === c.id);
  const men = sum(us, u => u.men);
  if (!men) return;
  const ships = sum(Object.values(w.fleets).filter(f => f.country === c.id), f => f.ships);
  const required = (men * .12 + ships * .6) * c.priceLevel;
  const funded = clamp((c.budget.military * c.gdp * c.paidRatio) / Math.max(required, 1), 0, 1.3);
  c.militaryFunding = funded;
  const inWar = w.wars.some(x => x.active && (x.a.includes(c.id) || x.b.includes(c.id)));
  const consume = men * (inWar ? .012 : .004);
  c.stock.arms = Math.max(0, c.stock.arms - consume);
  for (const u of us) {
    u.morale = clamp(u.morale + (funded - .85) * 10 - c.arrears * 2.2 - c.warExhaustion * .03, 0, 100);
    u.equip = clamp(u.equip + (c.stock.arms > 0 ? .02 : -.05) * (funded > .6 ? 1 : .3), .2, 1.4);
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
  const terrain = TERRAIN_DEF[p.terrain] * (1 + p.infra * .08) * point;
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
