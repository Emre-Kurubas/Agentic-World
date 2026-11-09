import { clamp, sum, news, between, rand } from './util.js';
import { CLASSES, atWar, hasTreaty, countryProvinces, aliveCountries, provincePop } from './world.js';
import { hasTech } from './economy.js';
import { die } from './politics.js';
import { afflict, incapacitated } from './health.js';

const SHIP_POWER = { cruiser: 1, battleship: 3.5, submarine: .6 };
let supplied = {};
// A unit is in supply only if its province connects to its capital through friendly ground.
// Supply also crosses the sea, from a home port to the country's other ports, unless an enemy fleet holds the water in front of them.
export function supplyNetwork(w, c) {
  const reach = new Set(), q = c.capital && w.provinces[c.capital] ? [c.capital] : [];
  for (const x of q) reach.add(x);
  const spread = () => { while (q.length) { const x = q.shift(); for (const n of w.provinces[x].neighbors) { const o = w.provinces[n].controller; if (!reach.has(n) && (o === c.id || hasTreaty(w, c.id, o, 'military_access') || hasTreaty(w, c.id, o, 'alliance'))) { reach.add(n); q.push(n); } } } };
  spread();
  const open = p => p.port > 0 && p.seas.some(s => { const holder = w.seaControl?.[s]; return !holder || !atWar(w, holder, c.id); });
  if ([...reach].some(id => open(w.provinces[id]))) for (const p of countryProvinces(w, c.id)) if (!reach.has(p.id) && open(p)) { reach.add(p.id); q.push(p.id); }
  spread();
  return reach;
}
const fit = ch => ch?.alive && ch.status === 'free' && !incapacitated(ch) ? ch : null;
const commanderOf = (w, u) => fit(w.characters[u.commander]) ?? fit(w.characters[w.countries[u.country]?.general]);
// Command is dangerous for those who lead from the front; a chief of staff at headquarters is rarely hit.
function hazard(w, gen, u, lost, p) {
  if (!gen?.alive) return;
  const front = u.commander === gen.id ? 1 : .25, roll = rand(w);
  if (roll < (lost ? .03 : .008) * front) { news(w, `${gen.name} fell in battle at ${p.name}.`, { kind: 'war', countries: [gen.country] }); die(w, gen, `fell in battle at ${p.name}`, { quiet: true }); }
  else if (roll < (lost ? .1 : .03) * front) afflict(w, gen, 'wound', 1 + Math.floor(rand(w) * 3), `the battle of ${p.name}`);
}

const TERRAIN_DEF = { plains: 1.05, hills: 1.35, forest: 1.25, mountain: 1.75, desert: 1.1, marsh: 1.4, tundra: 1.2 };
// How many thousand men can come to grips in one province. Beyond that the rest wait their turn, so numbers count for less in a mountain pass than on a plain.
const FRONTAGE = { plains: 160, hills: 110, forest: 100, mountain: 60, marsh: 70, desert: 130, tundra: 100 };
const crowding = (men, terrain) => { const room = FRONTAGE[terrain] ?? 120; return men <= room ? 1 : (room + (men - room) * .4) / men; };
const KIND = { infantry: 1, artillery: 1.7, armor: 3.2, air: 2.6 };

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
  return p.controller === country || atWar(w, country, p.controller) || hasTreaty(w, country, p.controller, 'military_access') || hasTreaty(w, country, p.controller, 'alliance');
}

const force = (w, u, def) => {
  const c = w.countries[u.country];
  const p = w.provinces[u.province];
  const net = supplied[u.country], linked = net ? net.has(u.province) || p.neighbors.some(n => net.has(n)) : p.controller === u.country || p.neighbors.some(n => w.provinces[n].controller === u.country);
  const supply = (c.stock.arms > 0 ? 1 : .55) * (linked ? 1 : .68) * (.8 + Math.min(p.infra, 1) * .2) * (1 + p.rail * .08);
  const auto = hasTech(c, 'automatic_weapons') && u.kind === 'infantry' ? 1.2 : 1;
  const motorized = ['armor', 'air'].includes(u.kind), fuel = motorized ? (c.fuelRatio ?? 1) >= .6 ? 1 : .35 : 1;
  const terrainApplies = u.kind === 'air' ? 1 : (u.kind === 'armor' && ['mountain', 'marsh', 'forest'].includes(p.terrain) ? .55 : 1);
  const dug = def > 1 ? 1 + (u.dug || 0) * .1 : 1, skill = commanderOf(w, u)?.skill ?? 1;
  return u.men * u.equip * u.quality * c.tech.mil * (u.morale / 70) * supply * def * (KIND[u.kind] || 1) * auto * fuel * terrainApplies * dug * skill;
};

export function militaryStep(w) {
  supplied = Object.fromEntries(aliveCountries(w).map(c => [c.id, supplyNetwork(w, c)]));
  for (const u of Object.values(w.units)) {
    if (!u.target) { u.dug = Math.min(3, (u.dug || 0) + 1); continue; }
    // Troops just put ashore do not march the same quarter. A unit with the enemy in its own province is engaged and cannot walk away:
    // that is also what stops two armies ordered at each other from passing on the road.
    if (u.shipped === w.turn || Object.values(w.units).some(x => x.province === u.province && atWar(w, x.country, u.country))) continue;
    u.dug = 0;
    const c = w.countries[u.country], speed = ['armor', 'air'].includes(u.kind) && (c.fuelRatio ?? 1) >= .6 ? 2 : 1;
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
  for (const u of Object.values(w.units)) if (u.men < .2 || u.morale <= 3) { delete w.units[u.id]; }
  const remaining = {};
  for (const u of Object.values(w.units)) (remaining[u.province] ||= []).push(u);
  // A siege lasts only while the besieger stands there at war.
  for (const p of Object.values(w.provinces)) if (p.siege && !(remaining[p.id] || []).some(u => u.country === p.siege.by && atWar(w, u.country, p.controller))) delete p.siege;
  for (const [pid, us] of Object.entries(remaining)) {
    const p = w.provinces[pid];
    const occ = us.filter(u => atWar(w, u.country, p.controller));
    // A province is held by its controller's troops and by the troops of anyone fighting the invader beside them.
    if (!occ.length || us.some(u => u.country === p.controller || (!atWar(w, u.country, p.controller) && occ.some(o => atWar(w, o.country, u.country))))) continue;
    const by = occ.sort((a, b) => b.men - a.men)[0].country, strength = sum(occ.filter(u => u.country === by), u => u.men);
    // A patrol does not conquer a province, and a fortress is not invested by a handful.
    if (strength < Math.max(1, provincePop(p) * .002) || ((p.fort || 0) >= 1 && strength < 8 * Math.ceil(p.fort))) continue;
    if ((p.fort || 0) >= 1) {
      p.siege = p.siege?.by === by ? { by, turns: p.siege.turns + 1 } : { by, turns: 1 };
      if (p.siege.turns === 1) news(w, `${w.countries[by].name} laid siege to the fortress at ${p.name}.`, { kind: 'war', countries: [by, p.controller] });
      p.fort = Math.max(0, p.fort - .12);
      if (p.siege.turns < Math.ceil(p.fort) + 1) continue;
    }
    delete p.siege; p.fort = Math.max(0, (p.fort || 0) - 1);
    capture(w, p, by);
  }
  settleOccupations(w);
}

// An occupation does not outlive the war that made it: land held by a power no longer at war with its owner goes back, and troops left where they have no right to be go home.
export function settleOccupations(w) {
  for (const p of Object.values(w.provinces)) {
    if (p.owner === p.controller) continue;
    const owner = w.countries[p.owner], holder = w.countries[p.controller];
    if (!owner?.alive) p.owner = p.controller;
    else if (!holder?.alive || !atWar(w, p.owner, p.controller)) p.controller = p.owner;
  }
  for (const c of aliveCountries(w)) seat(w, c);
  for (const u of Object.values(w.units)) {
    if (canEnter(w, u.country, u.province)) continue;
    const c = w.countries[u.country], home = w.provinces[c?.capital]?.controller === u.country ? c.capital : countryProvinces(w, u.country)[0]?.id;
    if (home) { u.province = home; u.target = null; } else delete w.units[u.id];
  }
}
// A government sits in a city it holds: its own land before occupied land, the largest first. Returns the new capital if it had to move.
export function seat(w, c) {
  if (w.provinces[c.capital]?.controller === c.id) return null;
  const held = countryProvinces(w, c.id), next = [...held].sort((a, b) => (b.owner === c.id) - (a.owner === c.id) || provincePop(b) - provincePop(a))[0];
  if (next) c.capital = next.id;
  return next ?? null;
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
    // Only those at war with someone present fight; a neutral squadron in the same water looks on.
    const fighters = owners.filter(a => owners.some(b => atWar(w, a, b)));
    if (fighters.length) {
      const pow = f => (SHIP_POWER[f.kind] ?? 1) * f.ships * f.quality * (f.morale / 70) * w.countries[f.country].tech.mil * (hasTech(w.countries[f.country], 'combustion_engine') && (w.countries[f.country].fuelRatio ?? 1) < .5 ? .4 : 1);
      const force = Object.fromEntries(fighters.map(o => [o, sum(fs.filter(f => f.country === o), pow)]));
      const top = [...fighters].sort((a, b) => force[b] - force[a])[0];
      for (const f of fs) {
        if (f.country !== top && !atWar(w, f.country, top)) continue;
        const lost = f.country === top ? .06 : .3; f.ships *= 1 - lost; f.morale = clamp(f.morale + (f.country === top ? 2 : -14), 0, 100);
        // A beaten squadron does not stay to be sunk: it runs for a home port where no enemy waits.
        if (f.country !== top) { const refuge = countryProvinces(w, f.country).filter(q => q.port > 0).flatMap(q => q.seas).find(s => s !== sea && !Object.values(w.fleets).some(x => x.sea === s && atWar(w, x.country, f.country))); if (refuge) { f.sea = refuge; f.target = null; } }
      }
      news(w, `Naval clash in ${w.seas[sea].name || 'open waters'}: ${w.countries[top].name} prevailed.`, { kind: 'war', countries: fighters });
    }
    const alive = fs.filter(f => f.ships >= 1 && f.sea === sea), surface = alive.filter(f => f.kind !== 'submarine');
    if (surface.length) w.seaControl[sea] = surface.sort((a, b) => (SHIP_POWER[b.kind] ?? 1) * b.ships - (SHIP_POWER[a.kind] ?? 1) * a.ships)[0].country;
    const subs = [...new Set(alive.filter(f => f.kind === 'submarine').map(f => f.country))];
    if (subs.length) w.seaRaids[sea] = subs;
  }
  for (const p of Object.values(w.provinces)) if (p.battery) for (const sea of p.seas) for (const f of Object.values(w.fleets)) if (f.sea === sea && atWar(w, f.country, p.controller)) f.ships *= 1 - p.battery * .03;
  for (const f of Object.values(w.fleets)) if (f.ships < 1) delete w.fleets[f.id];
}

// What the armed forces cost each quarter. A standing army of one in a hundred of the people takes a few percent of GDP, as it did around 1900.
export function upkeepCost(w, c) {
  const men = sum(Object.values(w.units).filter(u => u.country === c.id), u => u.men * (UPKEEP[u.kind] ?? 1));
  const ships = sum(Object.values(w.fleets).filter(f => f.country === c.id), f => f.ships * (SHIP_POWER[f.kind] ?? 1));
  const forts = sum(countryProvinces(w, c.id), p => (p.fort || 0) * 3 + (p.battery || 0) * 2);
  return (men * .8 + ships * 3 + forts * 5) * c.priceLevel;
}
const UPKEEP = { infantry: 1, artillery: 1.5, armor: 3, air: 3 };

function upkeep(w, c) {
  const us = Object.values(w.units).filter(u => u.country === c.id);
  const men = sum(us, u => u.men);
  const inWar = w.wars.some(x => x.active && (x.a.includes(c.id) || x.b.includes(c.id)));
  // A country tires of war with every quarter it lasts and with every province it has lost, and recovers in peace, army or no army.
  const mine = Object.values(w.provinces).filter(p => p.owner === c.id), lost = mine.filter(p => p.controller !== c.id).length / Math.max(mine.length, 1);
  c.warExhaustion = clamp(c.warExhaustion + (inWar ? .6 + lost * 6 : -2), 0, 100);
  if (!men) { c.militaryFunding = 1; return; }
  const required = upkeepCost(w, c);
  const funded = clamp((c.budget.military * c.gdp * c.paidRatio) / Math.max(required, 1), 0, 1.3);
  c.militaryFunding = funded;
  const consume = men * (inWar ? .012 : .004);
  c.stock.arms = Math.max(0, c.stock.arms - consume);
  // Pay, arrears and a long war decide where the troops' spirit settles; a battle only knocks it about for a while.
  const spirit = clamp(40 + funded * 35 - c.arrears * 6 - c.warExhaustion * .3, 8, 95);
  for (const u of us) {
    u.morale = clamp(u.morale + (spirit - u.morale) * .2, 0, 100);
    // Soldiers who are not paid go home: the army shrinks toward what the budget can keep.
    if (funded < .85) u.men *= 1 - clamp((.85 - funded) * .35, 0, .3);
    u.equip = clamp(u.equip + (c.stock.arms > 0 ? .02 : -.05) * (funded > .6 ? 1 : .3), .2, 1.4);
    if (supplied[c.id] && !supplied[c.id].has(u.province) && !w.provinces[u.province].neighbors.some(n => supplied[c.id].has(n))) { u.men *= .92; u.morale = clamp(u.morale - 6, 0, 100); }
    // Loyalty settles where pay and the government's standing put it, around the bond the unit already had; a shock fades, it does not add up for ever.
    const pull = (funded - .85) * 40 - c.arrears * 6 + (c.legitimacy - 50) * .25;
    u.bond ??= u.loyalty - pull;
    u.loyalty = clamp(u.loyalty + (clamp(u.bond + pull, 0, 100) - u.loyalty) * .12, 0, 100);
  }
}

function resolve(w, pid, us) {
  const owners = [...new Set(us.map(u => u.country))];
  if (owners.length < 2) return;
  const p = w.provinces[pid];
  // Whoever is not at war with the province's controller defends it, and the rest attack. Only where no one stands for the controller
  // do two intruders fight over ground neither holds, and then no one has the benefit of its walls.
  const sides = first => { const def = owners.filter(o => o === first || !atWar(w, o, first)); return [def, owners.filter(o => !def.includes(o) && def.some(d => atWar(w, o, d)))]; };
  let [defSide, atkSide] = sides(p.controller), holds = true;
  if (!atkSide.length || !defSide.some(d => atkSide.some(a => atWar(w, a, d)))) { [defSide, atkSide] = sides(owners[0]); holds = false; }
  defSide = defSide.filter(d => atkSide.some(a => atWar(w, a, d)));
  if (!atkSide.length || !defSide.length) return;
  const defCountry = defSide.includes(p.controller) ? p.controller : defSide[0];
  const D = us.filter(u => defSide.includes(u.country)), A = us.filter(u => atkSide.includes(u.country));
  const point = w.strategic.find(s => s.ref === pid && s.type === 'pass') ? 1.5 : w.strategic.find(s => s.ref === pid && s.type === 'bridge') ? 1.25 : 1;
  const terrain = TERRAIN_DEF[p.terrain] * (1 + p.infra * .08) * point * (holds ? 1 + (p.fort || 0) * .3 + (p.trench || 0) * .15 : 1);
  const fD = sum(D, u => force(w, u, terrain)) * crowding(sum(D, u => u.men), p.terrain) * between(w, .85, 1.15);
  const fA = sum(A, u => force(w, u, 1)) * crowding(sum(A, u => u.men), p.terrain) * between(w, .85, 1.15);
  const lossD = clamp(.09 * Math.pow(fA / Math.max(fD, 1), .7), .02, .42);
  const lossA = clamp(.09 * Math.pow(fD / Math.max(fA, 1), .7), .02, .42);
  const apply = (xs, loss, won) => xs.map(u => {
    const dead = u.men * loss; u.men -= dead;
    u.morale = clamp(u.morale + (won ? 3 : -8 - loss * 45), 0, 100);
    // The dead are felt against the size of the people who must bury them.
    w.countries[u.country].warExhaustion = clamp(w.countries[u.country].warExhaustion + dead / Math.max(w.countries[u.country]._pop || 10000, 1) * 5000, 0, 100);
    return dead;
  }).reduce((a, x) => a + x, 0);
  const atkWins = fA > fD;
  const winGen = commanderOf(w, (atkWins ? A : D)[0]), loseGen = commanderOf(w, (atkWins ? D : A)[0]);
  if (winGen) { winGen.skill = clamp((winGen.skill ?? 1) + .01, .5, 1.6); (winGen.record ||= { won: 0, lost: 0 }).won++; }
  if (loseGen) (loseGen.record ||= { won: 0, lost: 0 }).lost++;
  hazard(w, winGen, (atkWins ? A : D)[0], false, p); hazard(w, loseGen, (atkWins ? D : A)[0], true, p);
  const dd = apply(D, lossD, !atkWins), da = apply(A, lossA, atkWins);
  p.devastation = clamp(p.devastation + .1 + (dd + da) / 700, 0, 1);
  for (const k of CLASSES) p.pops[k].n *= .985;
  const loser = atkWins ? D : A;
  for (const u of loser) {
    const back = w.provinces[pid].neighbors.find(n => w.provinces[n].controller === u.country) ?? w.provinces[pid].neighbors.find(n => hasTreaty(w, u.country, w.provinces[n].controller, 'alliance'));
    if (back) { u.province = back; u.target = null; } else { u.morale *= .4; u.men *= .6; }
  }
  news(w, `Battle of ${p.name}: ${atkWins ? w.countries[atkSide[0]].name : w.countries[defCountry].name} prevailed. Losses: attacker ${Math.round(da)}k, defender ${Math.round(dd)}k.`, { kind: 'war', countries: [...atkSide, ...defSide] });
  w.battles.push({ province: pid, attacker: atkSide[0], defender: defCountry, attackerWon: atkWins, lossA: Math.round(da), lossD: Math.round(dd) });
}

export function capture(w, p, by) {
  const from = p.controller;
  if (from === by) return;
  // Troops that retake an ally's province hand it back; they do not keep it.
  const owner = w.countries[p.owner], taker = w.countries[by], loser = w.countries[from], to = p.owner !== by && owner?.alive && !atWar(w, by, p.owner) ? p.owner : by;
  p.controller = to; p.governor = null;
  if (to === by) {
    // Conquest is not free for the conquered: the fighting, the requisitions and the collapse of the old administration all leave their mark.
    p.unrest = clamp(p.unrest + 12, 0, 100); p.devastation = clamp(p.devastation + .05, 0, 1); p.admin = Math.min(p.admin ?? .5, .2);
    news(w, `${taker.name} forces captured ${p.name}.`, { kind: 'war', countries: [by, from], province: p.id });
  } else news(w, `${taker.name} forces freed ${p.name} and returned it to ${owner.name}.`, { kind: 'war', countries: [by, from, to], province: p.id });
  taker.legitimacy = clamp(taker.legitimacy + .5, 0, 100);
  if (loser?.capital === p.id) {
    // The government withdraws to the largest city it still holds. The first fall of a capital shakes a state most.
    const nextCap = seat(w, loser);
    loser.capitalsLost = (loser.capitalsLost || 0) + 1;
    loser.legitimacy = clamp(loser.legitimacy - (loser.capitalsLost === 1 ? 10 : 5), 0, 100);
    if (to === by) { // The vaults of a capital fall with it.
      const gold = Math.max(loser.reserves, 0) * .3, cash = Math.max(loser.treasury, 0) * .3;
      loser.reserves -= gold; taker.reserves += gold; loser.treasury -= cash; taker.treasury += cash / (loser.rate || 1) * (taker.rate || 1);
    }
    if (nextCap) news(w, `${loser.name} lost its capital; the government withdrew to ${nextCap.name}.`, { kind: 'war', countries: [from], province: nextCap.id });
  }
}
