import { clamp, sum, news, between, rand } from './util.js';
import { CLASSES, atWar, hasTreaty, countryProvinces, aliveCountries, provincePop } from './world.js';
import { hasTech } from './economy.js';
import { die } from './politics.js';
import { afflict, incapacitated } from './health.js';
import { navalStep, portFalls, shipGuns, enemyHolds, SHIPS, kindOf } from './navy.js';

// Two states at war fight unless an armistice between them is in force. Then the lines stand where they are: nobody attacks, nobody advances,
// no fortress is pressed and no fleet engages, and the war is not over.
export const truce = (w, a, b) => hasTreaty(w, a, b, 'armistice');
export const fighting = (w, a, b) => atWar(w, a, b) && !truce(w, a, b);
// Whether a country has an enemy it is actually fighting this quarter.
export const inTheField = (w, id) => w.wars.some(x => x.active && ((x.a.includes(id) && x.b.some(o => !truce(w, id, o))) || (x.b.includes(id) && x.a.some(o => !truce(w, id, o)))));
let supplied = {};
// A unit is in supply only if its province connects to its capital through friendly ground.
// Supply also crosses the sea, from a home port to the country's other ports, unless an enemy fleet holds the water in front of them.
export function supplyNetwork(w, c) {
  const reach = new Set(), q = c.capital && w.provinces[c.capital] ? [c.capital] : [];
  for (const x of q) reach.add(x);
  const spread = () => { while (q.length) { const x = q.shift(); for (const n of w.provinces[x].neighbors) { const o = w.provinces[n].controller; if (!reach.has(n) && (o === c.id || hasTreaty(w, c.id, o, 'military_access') || hasTreaty(w, c.id, o, 'alliance'))) { reach.add(n); q.push(n); } } } };
  spread();
  const open = p => p.port > 0 && p.seas.some(s => !enemyHolds(w, s, c.id));
  if ([...reach].some(id => open(w.provinces[id]))) for (const p of countryProvinces(w, c.id)) if (!reach.has(p.id) && open(p)) { reach.add(p.id); q.push(p.id); }
  spread();
  return reach;
}
// A railway carries an army's bread and shells. A line that has just changed hands is no use to its new holder for a while: the bridges are
// down, the engines are gone, and the track has to be relaid before a train runs on it.
export const railWorks = (w, p) => p.rail > 0 && !((p.railOut ?? -1) > w.turn);
// Where an army is fed from. The heads of its supply are the capital, every province joined to the capital by working rails through ground the
// country can use, and its open harbours with whatever rails run inland from them. From a head the wagons go on by road, and horses eat what
// they pull: each province costs what its ground and its roads cost a column, half that on the country's own soil, where there are depots and
// a population that sells. An army within a march of a head wants for nothing; further out it gets less of everything, down to three fifths.
const HAUL = { plains: 1, desert: 1.3, hills: 1.3, forest: 1.3, tundra: 1.5, marsh: 1.6, mountain: 2 };
const haul = (c, p) => (HAUL[p.terrain] ?? 1.3) * roadFactor(p) * (p.owner === c.id && p.controller === c.id ? .5 : 1);
export function supplyLines(w, c) {
  const net = supplyNetwork(w, c), depth = {}, head = {}, q = [];
  const open = p => p.port > 0 && p.controller === c.id && p.seas.some(s => !enemyHolds(w, s, c.id));
  const seed = id => { if (net.has(id) && !(id in depth)) { depth[id] = 0; head[id] = id; q.push(id); } };
  if (c.capital) seed(c.capital);
  // What comes by sea comes from home: a harbour on a far shore is a head only while some harbour of the country's own is open too.
  if ([...net].some(id => w.provinces[id].owner === c.id && open(w.provinces[id]))) for (const id of net) if (open(w.provinces[id])) seed(id);
  for (let i = 0; i < q.length; i++) { const x = w.provinces[q[i]]; if (railWorks(w, x)) for (const n of x.neighbors) if (railWorks(w, w.provinces[n])) seed(n); }
  const todo = [...q];
  while (todo.length) {
    todo.sort((a, b) => depth[a] - depth[b]); const x = todo.shift();
    for (const n of w.provinces[x].neighbors) { if (!net.has(n)) continue; const d = depth[x] + haul(c, w.provinces[n]); if (!(n in depth) || d < depth[n] - 1e-9) { depth[n] = d; head[n] = head[x]; todo.push(n); } }
  }
  return { net, depth, head };
}
let lines = {};
const linesOf = (w, id) => lines[id]?.turn === w.turn && lines[id].w === w ? lines[id] : (w.countries[id]?.alive ? (lines[id] = { ...supplyLines(w, w.countries[id]), turn: w.turn, w }) : null);
// How one unit stands with its supplies: whether a road joins it to the country at all, how many marches of wagon road lie between it and the
// nearest head, and what part of its needs reaches it. Troops fighting in a province the enemy holds are fed from the nearest ground behind them.
export function supplyOf(w, u) {
  const l = linesOf(w, u.country), p = w.provinces[u.province], c = w.countries[u.country];
  if (!l || !p || !c) return { linked: true, depth: 0, head: null, factor: 1 };
  let d = l.depth[p.id], h = l.head[p.id];
  if (d == null) for (const n of p.neighbors) if (l.depth[n] != null) { const x = l.depth[n] + haul(c, p); if (d == null || x < d) { d = x; h = l.head[n]; } }
  return d == null ? { linked: false, depth: null, head: null, factor: .55 } : { linked: true, depth: d, head: h, factor: clamp(1 - (d - 1) * .12, .6, 1) };
}
export const supplyWords = (w, u) => { const s = supplyOf(w, u), h = w.provinces[s.head]?.name; return !s.linked ? 'cut off from the country: no supply reaches it' : s.depth <= 1 ? `fully supplied from ${h}` : `${Math.round(s.depth * 10) / 10} marches of wagon road from its supply head at ${h}: about ${Math.round(s.factor * 100)} in the hundred of what it needs reaches it`; };
const fit = ch => ch?.alive && ch.status === 'free' && !incapacitated(ch) ? ch : null;
export const commanderOf = (w, u) => fit(w.characters[u.commander]) ?? fit(w.characters[w.countries[u.country]?.general]);
// Command is dangerous for those who lead from the front; a chief of staff at headquarters is rarely hit.
function hazard(w, gen, u, lost, p) {
  if (!gen?.alive) return;
  const front = u.commander === gen.id ? 1 : .25, roll = rand(w);
  if (roll < (lost ? .03 : .008) * front) { news(w, `${gen.name} fell in battle at ${p.name}.`, { kind: 'war', countries: [gen.country] }); die(w, gen, `fell in battle at ${p.name}`, { quiet: true }); }
  else if (roll < (lost ? .1 : .03) * front) afflict(w, gen, 'wound', 1 + Math.floor(rand(w) * 3), `the battle of ${p.name}`);
}

export const TERRAIN_DEF = { plains: 1.05, hills: 1.35, forest: 1.25, mountain: 1.75, desert: 1.1, marsh: 1.4, tundra: 1.2 };
// How many thousand men can come to grips in one province. Beyond that the rest wait their turn, so numbers count for less in a mountain pass than on a plain.
const FRONTAGE = { plains: 160, hills: 110, forest: 100, mountain: 60, marsh: 70, desert: 130, tundra: 100 };
const crowding = (men, terrain, widen = 1) => { const room = (FRONTAGE[terrain] ?? 120) * widen; return men <= room ? 1 : (room + (men - room) * .4) / men; };
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
  return p.controller === country || fighting(w, country, p.controller) || hasTreaty(w, country, p.controller, 'military_access') || hasTreaty(w, country, p.controller, 'alliance');
}
// Troops may stay where the war has brought them while an armistice lasts, though they may not go further.
const mayStand = (w, country, pid) => canEnter(w, country, pid) || atWar(w, country, w.provinces[pid].controller);

// Standing orders. A unit fights what it meets and marches where it is sent unless it has been told otherwise, and what it has been told
// holds until it is changed. Three ways of meeting the enemy: on the defensive (it holds its province, digs deeper than troops who expect to
// move, fights from its works wherever it is attacked, and takes no ground); falling back if pressed (it declines a fight against clearly
// stronger numbers and gives up the province to keep itself in being); and not one step back (beaten, it does not leave the field: it holds
// the ground another quarter at a heavier price in men, until it breaks). Besides these, troops can be told to hold their fire on a frontier
// (frontier.js) and to stay in barracks when the state turns on its own people (labour.js, politics.js, ops.js).
export const POSTURES = ['ordinary', 'hold_fire', 'defensive', 'fall_back', 'no_retreat', 'barracks'];
export const postureWords = u => [u.posture === 'defensive' ? 'standing on the defensive' : u.posture === 'fall_back' ? 'to fall back if pressed' : u.posture === 'no_retreat' ? 'not one step back' : '', u.holdFire ? 'holding fire on the frontier' : '', u.barracks ? 'kept in barracks' : ''].filter(Boolean).join(', ');
// Where a unit goes when it gives up a province: toward its own country, the nearest of its own provinces to the capital, else an ally's.
function wayBack(w, u, pid) {
  const cap = w.provinces[w.countries[u.country]?.capital], near = n => cap ? Math.hypot(w.provinces[n].cx - cap.cx, w.provinces[n].cy - cap.cy) : 0, ns = w.provinces[pid].neighbors;
  return ns.filter(n => w.provinces[n].controller === u.country).sort((a, b) => near(a) - near(b))[0] ?? ns.find(n => hasTreaty(w, u.country, w.provinces[n].controller, 'alliance')) ?? null;
}

// What a unit is worth in a fight. def is what the ground and the works on it give whoever holds them; fire is the part of the cartridges and
// shells the fight calls for that the arsenal could send (a unit with no road home gets half of that at best); breach is the part of the
// defender's digging that the attacker's guns have knocked in.
const force = (w, u, def = 1, fire = 1, breach = 0) => {
  const c = w.countries[u.country];
  const p = w.provinces[u.province], s = supplyOf(w, u);
  const supply = (.55 + .45 * (s.linked ? fire : Math.min(fire, .5))) * s.factor * (.8 + Math.min(p.infra, 1) * .2) * (1 + (railWorks(w, p) ? p.rail : 0) * .08);
  // Works count for whoever defends the ground, and for troops ordered to stand on the defensive wherever they are attacked.
  const standing = def > 1 || u.posture === 'defensive', dug = standing ? 1 + (u.dug || 0) * .1 * (1 - breach) : 1, skill = commanderOf(w, u)?.skill ?? 1;
  // The machine gun is a weapon of the man who waits: it adds a little to an advance and a great deal to a held line.
  const auto = hasTech(c, 'automatic_weapons') && u.kind === 'infantry' ? (standing ? 1.3 : 1.08) : 1;
  const motorized = ['armor', 'air'].includes(u.kind), fuel = motorized ? (c.fuelRatio ?? 1) >= .6 ? 1 : .35 : 1;
  const terrainApplies = u.kind === 'air' ? 1 : (u.kind === 'armor' && ['mountain', 'marsh', 'forest'].includes(p.terrain) ? .55 : 1);
  return u.men * u.equip * u.quality * c.tech.mil * (u.morale / 70) * supply * def * (KIND[u.kind] || 1) * auto * fuel * terrainApplies * dug * skill;
};

// The year has seasons. In the first quarter the high passes and the northern wastes are closed to anything but a railway; in the thaw and the
// autumn rains the marshes are. Troops that winter in the mountains, or on foreign soil without a railway behind them, lose men to it.
const WINTER = { mountain: 1, tundra: 1 }, MUD = { marsh: 1 };
export const season = w => ['winter', 'spring', 'summer', 'autumn'][w.turn % 4];
export const closedNow = (w, p) => !railWorks(w, p) && ((season(w) === 'winter' && WINTER[p.terrain]) || (['spring', 'autumn'].includes(season(w)) && MUD[p.terrain]));

// What it costs an army to enter a province of friendly country, out of the three marches a quarter gives it (four with engines and fuel):
// the ground first (a plain is the measure, mountains cost double, marsh, tundra, forest, hills and desert between), then the roads (good
// ones take a quarter off, bad ones add as much), and a railway that runs through from where it stands halves what is left.
const GROUND = { plains: 1, desert: 1.2, hills: 1.3, forest: 1.3, tundra: 1.5, marsh: 1.6, mountain: 2 };
export const roadFactor = p => clamp(1.3 - Math.min(p.infra ?? .5, 1.5) * .4, .7, 1.3);
export const marchCost = (from, to, w) => (GROUND[to.terrain] ?? 1.2) * roadFactor(to) * ((w ? railWorks(w, from) && railWorks(w, to) : from.rail && to.rail) ? .5 : 1);
const slowWord = (from, to, w) => [to.terrain !== 'plains' ? `the ${to.terrain === 'hills' ? 'hills' : to.terrain === 'mountain' ? 'mountains' : to.terrain} of ${to.name}` : '', roadFactor(to) > 1.05 ? `the poor roads of ${to.name}` : '', from.rail && to.rail && w && !(railWorks(w, from) && railWorks(w, to)) ? 'the railway there is wrecked and not yet relaid' : !(from.rail && to.rail) ? 'no railway through' : ''].filter(Boolean).join(', ') || `the distance to ${to.name}`;
// About how many quarters a march will take as the roads and the seasons stand, for whoever gives the order. Enemy ground is one province a quarter.
export function marchQuarters(w, u, to) {
  const c = w.countries[u.country], motor = ['armor', 'air'].includes(u.kind) && (c?.fuelRatio ?? 1) >= .6, per = motor ? 4 : 3; let cur = u.province, left = per, q = 1, n = 0;
  while (cur !== to && n++ < 80) { const step = pathStep(w, cur, to, u.country); if (!step) return null; const from = w.provinces[cur], nx = w.provinces[step], hostile = fighting(w, u.country, nx.controller), cost = hostile ? (motor ? 2 : 3) : marchCost(from, nx, w);
    if (hostile ? left <= 1e-9 : left < cost - 1e-9) { q++; left = per; } left = Math.max(0, left - cost); cur = step; }
  return cur === to ? q : null;
}

export function militaryStep(w) {
  lines = {}; supplied = Object.fromEntries(aliveCountries(w).map(c => [c.id, linesOf(w, c.id).net]));
  for (const c of aliveCountries(w)) c._shot = 0;
  if (season(w) === 'winter') for (const u of Object.values(w.units)) { const p = w.provinces[u.province]; if (!p) continue; const hard = WINTER[p.terrain] ? .05 : p.controller !== u.country && !railWorks(w, p) ? .03 : 0; if (hard) { u.men = Math.max(.05, u.men * (1 - hard)); u.morale = clamp(u.morale - (hard > .04 ? 6 : 4), 5, 100); } }
  for (const u of Object.values(w.units)) {
    // Troops on the defensive do not march: they dig, and deeper than troops who expect to be moved on.
    if (u.posture === 'defensive') u.target = null;
    if (!u.target) { u.dug = Math.min(u.posture === 'defensive' ? 5 : 3, (u.dug || 0) + (u.posture === 'defensive' ? 2 : 1)); continue; }
    // What became of the quarter's march is kept on the unit, so that whoever ordered it can see how far it got and what held it.
    const went = u.march = { turn: w.turn, from: u.province, to: u.target, provinces: 0, held: '' };
    // Troops just put ashore do not march the same quarter. A unit with the enemy in its own province is engaged and cannot walk away:
    // that is also what stops two armies ordered at each other from passing on the road.
    if (u.shipped === w.turn) { went.held = 'it was put ashore this quarter'; continue; }
    if (Object.values(w.units).some(x => x.province === u.province && fighting(w, x.country, u.country))) { went.held = 'the enemy stands in its province and it cannot break away'; continue; }
    u.dug = 0;
    // A quarter is a long time on roads one holds: an army crosses about three provinces of open, friendly country in it, fewer over hills,
    // forest, marsh or mountain or on bad roads, and twice as many where the railway runs from one to the next. Into ground the enemy holds
    // it advances one province and no more that quarter (two with engines and fuel).
    const c = w.countries[u.country], motor = ['armor', 'air'].includes(u.kind) && (c.fuelRatio ?? 1) >= .6;
    let left = motor ? 4 : 3;
    while (u.target && left > 1e-9) {
      const step = pathStep(w, u.province, u.target, u.country);
      if (!step || !canEnter(w, u.country, step)) { went.held = step ? `${w.provinces[step].name} is closed to it: no war, alliance or right of passage opens that road` : 'no road leads there'; u.target = null; break; }
      // Snow in the passes or mud in the marsh: the unit waits where it is and marches when the season turns.
      const from = w.provinces[u.province], to = w.provinces[step]; if (closedNow(w, to)) { went.held = `${season(w) === 'winter' ? 'snow' : 'mud'} closes ${to.name} this season`; break; }
      const hostile = fighting(w, u.country, to.controller), cost = hostile ? (motor ? 2 : 3) : marchCost(from, to, w);
      // Troops sent as part of an offensive do not walk into their objective as they arrive: they form up beside it and go in on the word (launch).
      if (hostile && u.attack && u.attack.to === step) { went.held = 'it has formed up for the attack and waits for the word'; break; }
      if (!hostile && left < cost - 1e-9) { went.held = slowWord(from, to, w); break; }
      left = Math.max(0, left - cost); u.from = u.province; u.province = step; went.provinces++;
      if (u.province === u.target) { u.target = null; went.held = ''; break; }
      // Armies halt on contact: moving next to the enemy ends the march, so fronts form.
      if (Object.values(w.units).some(x => fighting(w, x.country, u.country) && (x.province === step || w.provinces[step].neighbors.includes(x.province)))) { went.held = 'the enemy is at hand: it halted on contact'; break; }
      if (hostile && left <= 1e-9) went.held = 'on ground the enemy holds an army advances a province a quarter';
    }
    if (u.target && !went.held) went.held = slowWord(w.provinces[went.from], w.provinces[u.province], w);
    went.reached = u.province;
  }
  launch(w);
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
    const occ = us.filter(u => fighting(w, u.country, p.controller));
    // A province is held by its controller's troops and by the troops of anyone fighting the invader beside them.
    if (!occ.length || us.some(u => u.country === p.controller || (!fighting(w, u.country, p.controller) && occ.some(o => fighting(w, o.country, u.country))))) continue;
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
    if (mayStand(w, u.country, u.province)) continue;
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

// What the armed forces cost each quarter. A standing army of one in a hundred of the people takes a few percent of GDP, as it did around 1900.
// A war is dearer than a peace: men in the field eat, march and shoot half as much again as men in barracks, and men kept on soil that is not
// their own country's cost twice their keep, at war or not. A state that goes to war on its peace budget watches its army go unpaid.
export function upkeepCost(w, c) {
  const field = inTheField(w, c.id) ? 1.5 : 1;
  const men = sum(Object.values(w.units).filter(u => u.country === c.id), u => u.men * (UPKEEP[u.kind] ?? 1) * (w.provinces[u.province] && w.provinces[u.province].owner !== c.id ? 2 : field));
  // A ship costs its keep whether it floats or lies in dock; a squadron kept at sea costs two fifths more than one lying in harbour.
  const ships = sum(Object.values(w.fleets).filter(f => f.country === c.id), f => (f.ships + (f.damaged || 0) * .5) * SHIPS[kindOf(f)].power * (f.port ? 1 : 1.4)) * field;
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
  // Under an armistice the dying has stopped but the men are not home and the lost provinces are still lost.
  c.warExhaustion = clamp(c.warExhaustion + (!inWar ? -2 : inTheField(w, c.id) ? .6 + lost * 6 : lost * 3 - .5), 0, 100);
  if (!men) { c.militaryFunding = 1; return; }
  const required = upkeepCost(w, c);
  const funded = clamp((c.budget.military * c.gdp * c.paidRatio) / Math.max(required, 1), 0, 1.3);
  c.militaryFunding = funded;
  // An army in the field wears out rifles, boots and cartridges faster than one in barracks; what a battle fires off is drawn when it is fought (resolve).
  const consume = men * (inWar && inTheField(w, c.id) ? .006 : .004);
  c.stock.arms = Math.max(0, c.stock.arms - consume);
  // Pay, arrears and a long war decide where the troops' spirit settles; a battle only knocks it about for a while.
  const spirit = clamp(40 + funded * 35 - c.arrears * 6 - c.warExhaustion * .3, 8, 95);
  let gone = 0;
  for (const u of us) {
    u.morale = clamp(u.morale + (spirit - u.morale) * .2, 0, 100);
    // Soldiers who are not paid go home: the army shrinks toward what the budget can keep.
    if (funded < .85) { const left = u.men * clamp((.85 - funded) * .35, 0, .3); u.men -= left; gone += left; }
    u.equip = clamp(u.equip + (c.stock.arms > 0 ? .02 : -.05) * (funded > .6 ? 1 : .3), .2, 1.4);
    { const s = supplyOf(w, u); if (!s.linked) { u.men *= .92; u.morale = clamp(u.morale - 6, 0, 100); } else if (s.depth > 4.5) { u.men *= .98; u.morale = clamp(u.morale - 2, 0, 100); } }
    // Loyalty settles where pay and the government's standing put it, around the bond the unit already had; a shock fades, it does not add up for ever.
    const pull = (funded - .85) * 40 - c.arrears * 6 + (c.legitimacy - 50) * .25;
    u.bond ??= u.loyalty - pull;
    u.loyalty = clamp(u.loyalty + (clamp(u.bond + pull, 0, 100) - u.loyalty) * .12, 0, 100);
  }
  // And home is where they arrive: back among the working people of their own provinces, not out of the world.
  if (gone > 0) { const provs = countryProvinces(w, c.id).filter(p => p.owner === c.id), pop = sum(provs, provincePop) || 1; for (const p of provs) p.pops.workers.n += gone * provincePop(p) / pop; }
}

// An offensive. Units sent against one objective under one order form up in the provinces beside it and go in together: all of them once the
// last is up, or whatever is there once the staff has waited three quarters for the rest. Columns that start from different provinces come at
// the defender from more than one side, which is worth a good deal if they arrive together and nothing if they do not: every column but the
// strongest has to keep a timetable drawn up far away, and how well it keeps it is its commander's doing (and the wireless's, where there is
// one). A column that is late goes in the quarter after, alone.
const READY = 2, PATIENCE = 3;
export const MANNERS = ['assault', 'probe', 'all_out'];
function launch(w) {
  const groups = {}, engaged = u => Object.values(w.units).some(x => x.province === u.province && fighting(w, x.country, u.country));
  for (const u of Object.values(w.units)) {
    if (!u.attack || u.province === u.attack.to) continue;
    const to = w.provinces[u.attack.to];
    // An objective that is no longer the enemy's needs no attack, and a unit sent elsewhere since is no longer part of one: the order lapses.
    if (!to || !fighting(w, u.country, to.controller) || u.target !== to.id) { delete u.attack; continue; }
    (groups[`${u.country}|${to.id}`] ||= []).push(u);
  }
  for (const us of Object.values(groups)) {
    const to = w.provinces[us[0].attack.to], hold = (xs, why) => { for (const u of xs) u.march = { turn: w.turn, from: u.province, to: to.id, provinces: 0, held: why, reached: u.province }; };
    const up = us.filter(u => to.neighbors.includes(u.province) && u.shipped !== w.turn && !engaged(u));
    // Time spent formed up beside the objective is time to bring shells forward, register the guns and study the ground.
    for (const u of up) u.attack.ready = (u.attack.ready ?? -1) + 1;
    if (!up.length) continue;
    if (w.turn < Math.max(...us.map(u => u.attack.start ?? 0))) { hold(up, 'it has formed up for the attack, which is set for a later quarter'); continue; }
    if (closedNow(w, to)) { hold(up, `${season(w) === 'winter' ? 'snow' : 'mud'} closes ${to.name} this season: the attack waits`); continue; }
    if (up.length < us.length && us.some(u => u.attack.wait !== false) && w.turn < Math.min(...us.map(u => u.attack.since ?? w.turn)) + PATIENCE) { hold(up, 'it has formed up for the attack and waits for the columns that are not yet up'); continue; }
    const cols = Object.values(up.reduce((a, u) => ((a[u.province] ||= []).push(u), a), {})).sort((a, b) => sum(b, u => u.men) - sum(a, u => u.men));
    cols.forEach((col, i) => {
      const lead = commanderOf(w, [...col].sort((a, b) => b.men - a.men)[0]), c = w.countries[col[0].country];
      const late = i > 0 && !col.some(u => u.attack.late != null) && rand(w) > clamp(.45 + ((lead?.skill ?? 1) - .75) * .7 + (hasTech(c, 'radio') ? .15 : 0), .2, .97);
      if (late) { for (const u of col) { u.attack.late = w.turn; u.attack.wait = false; } hold(col, `it was not up in time for the attack on ${to.name}${lead ? ` (${lead.name} commands the column)` : ''} and goes in next quarter`); return; }
      for (const u of col) { u.from = u.province; u.province = to.id; u.target = null; u.dug = 0; u.attack.go = w.turn; u.march = { turn: w.turn, from: u.from, to: to.id, provinces: 1, held: '', reached: to.id }; }
    });
  }
}

// What a quarter's fighting burns, in the arsenal's own measure, for every thousand men who come into action: a reconnaissance little, an
// assault a great deal, an attack pressed regardless of loss more still; men who hold a line fire less than men who must carry one; guns fire
// three times what rifles do, and a bombardment ordered before the attack is paid for on top of all of it.
const RATE = { probe: .012, assault: .05, all_out: .065 }, RATE_DEF = .03, SHELLING = .3, FIELD_GUNS = .03;
// What an attack by these troops would ask of the arsenal, for the staff that plans it.
export const shellsFor = (us, manner = 'assault', shelling = false) => sum(us, u => u.men * (RATE[manner] ?? RATE.assault) * (u.kind === 'artillery' ? 3 : 1) + (shelling ? u.men * (u.kind === 'artillery' ? 1 : FIELD_GUNS) * SHELLING : 0));
export const abilityWord = ch => (ch?.skill ?? 1) >= 1.15 ? 'able' : (ch?.skill ?? 1) >= .95 ? 'competent' : 'a poor hand';
const about = v => v >= 20 ? Math.round(v / 5) * 5 : v >= 2 ? Math.round(v) : Math.round(v * 10) / 10;
const mark = (w, c, text) => { for (const ch of [w.characters[c.leader], w.characters[c.general]]) if (ch?.alive) ch.inbox.push({ turn: w.turn, from: 'General Staff', text }); };

function resolve(w, pid, us) {
  const owners = [...new Set(us.map(u => u.country))];
  if (owners.length < 2) return;
  const p = w.provinces[pid];
  // Whoever is not at war with the province's controller defends it, and the rest attack. Only where no one stands for the controller
  // do two intruders fight over ground neither holds, and then no one has the benefit of its walls.
  const sides = first => { const def = owners.filter(o => o === first || !fighting(w, o, first)); return [def, owners.filter(o => !def.includes(o) && def.some(d => fighting(w, o, d)))]; };
  let [defSide, atkSide] = sides(p.controller), holds = true;
  if (!atkSide.length || !defSide.some(d => atkSide.some(a => fighting(w, a, d)))) { [defSide, atkSide] = sides(owners[0]); holds = false; }
  defSide = defSide.filter(d => atkSide.some(a => fighting(w, a, d)));
  if (!atkSide.length || !defSide.length) return;
  const defCountry = defSide.includes(p.controller) ? p.controller : defSide[0];
  const D = us.filter(u => defSide.includes(u.country)), A = us.filter(u => atkSide.includes(u.country));
  const pass = w.strategic.find(s => s.ref === pid && s.type === 'pass'), bridge = !pass && w.strategic.find(s => s.ref === pid && s.type === 'bridge'), point = pass ? 1.5 : bridge ? 1.25 : 1;
  const natural = TERRAIN_DEF[p.terrain] * (1 + p.infra * .08) * point, built = holds ? 1 + (p.fort || 0) * .3 + (p.trench || 0) * .15 : 1, men = xs => sum(xs, u => u.men);
  // Troops told to fall back if pressed do not wait to be beaten by clearly stronger numbers: they give up the province and go back one toward
  // their own country, leaving stragglers and gear on the road. Whoever of their side was told nothing of the kind stays and fights without them.
  const weigh = (xs, def) => sum(xs, u => force(w, u, def)) * crowding(men(xs), p.terrain);
  for (const [mine, theirs, mineDef] of [[D, A, true], [A, D, false]]) {
    if (!mine.some(u => u.posture === 'fall_back') || weigh(theirs, mineDef ? 1 : natural * built) < weigh(mine, mineDef ? natural * built : 1) * 1.6) continue;
    const gone = mine.filter(u => u.posture === 'fall_back').filter(u => { const back = wayBack(w, u, pid); if (!back) return false; u.province = back; u.target = null; u.dug = 0; u.men *= .95; u.equip = clamp(u.equip - .04, .2, 1.4); u.morale = clamp(u.morale - 3, 0, 100); delete u.attack; u.march = { turn: w.turn, from: pid, to: back, provinces: 1, held: '', reached: back, fellBack: true }; return true; });
    if (gone.length) { news(w, `${[...new Set(gone.map(u => w.countries[u.country].name))].join(' and ')} forces fell back from ${p.name} before stronger numbers, without giving battle.`, { kind: 'war', countries: [...atkSide, ...defSide], province: pid }); for (const u of gone) mine.splice(mine.indexOf(u), 1); }
  }
  if (!D.length || !A.length) return;
  // The attack as it was ordered. Units sent in under one order (offensive) fight to a plan: a reconnaissance in force, an assault, or an attack
  // pressed home whatever it costs; with or without a bombardment first; from one side or several. Troops that merely marched in assault.
  const planned = A.filter(u => u.attack?.to === pid), menA = men(A), menD = men(D), lead = [...planned].sort((a, b) => b.men - a.men)[0];
  let manner = lead && men(planned) >= menA * .5 ? lead.attack.manner ?? 'assault' : 'assault';
  // Columns under one order that come from different provinces take the defender in flank; any troops arriving by different roads at least
  // have more room to deploy than the same number crowding up one road.
  const flank = Math.min(Math.max(new Set(planned.map(u => u.from)).size - 1, 0), 2), roads = Math.min(Math.max(new Set(A.map(u => u.from ?? '-')).size - 1, 0), 2);
  const ready = planned.length ? sum(planned, u => u.men * Math.min(u.attack.ready || 0, READY)) / menA : 0;
  const crowdD = crowding(menD, p.terrain), crowdA = crowding(menA, p.terrain, 1 + roads * .5);
  // Cartridges and shells come out of the arsenal as the fight calls for them. When it cannot send them the fire slackens.
  const guns = u => u.attack?.to === pid && u.attack.shelling ? u.men * (u.kind === 'artillery' ? 1 : FIELD_GUNS) : 0, want = {}, fire = {}, shot = {};
  for (const u of A) want[u.country] = (want[u.country] || 0) + u.men * crowdA * RATE[manner] * (u.kind === 'artillery' ? 3 : 1) + guns(u) * SHELLING;
  for (const u of D) want[u.country] = (want[u.country] || 0) + u.men * crowdD * RATE_DEF * (u.kind === 'artillery' ? 3 : 1);
  for (const [id, x] of Object.entries(want)) { const c = w.countries[id], have = Math.max(c.stock.arms || 0, 0), got = Math.min(x, have); c.stock.arms = have - got; c._shot = (c._shot || 0) + got; shot[id] = got; fire[id] = x > 0 ? got / x : 1; }
  // A bombardment knocks in field works in the measure of the guns brought against the men behind them; the field guns that march with the
  // infantry count for little at this, the heavy pieces of the artillery for much. Masonry and concrete yield only to the heavy pieces.
  const weight = sum(A, guns), shelled = weight > 0 ? sum(A, u => guns(u) * fire[u.country]) / weight : 0, heavy = sum(A.filter(u => u.kind === 'artillery'), guns);
  const breach = weight > 0 ? clamp(weight / Math.max(menD * .15, 1e-9), 0, 1) * .6 * shelled : 0, breachFort = heavy > 0 && p.fort >= 1 ? clamp(heavy / (8 * Math.ceil(p.fort)), 0, 1) * .5 * shelled : 0;
  const works = holds ? 1 + (p.fort || 0) * .3 * (1 - breachFort) + (p.trench || 0) * .15 * (1 - breach) : 1, terrain = natural * works;
  const plan = (1 + .07 * ready) * (manner === 'all_out' ? 1.1 : 1) * (1 + .1 * flank), luckD = between(w, .85, 1.15), luckA = between(w, .85, 1.15);
  // On a coast the ships' guns reach the field for whichever side has ships off it in water that is theirs.
  const gunsA = shipGuns(w, p, atkSide, menD), gunsD = shipGuns(w, p, defSide, menA);
  const fD = sum(D, u => force(w, u, terrain, fire[u.country], breach)) * crowdD * gunsD * luckD;
  const fA = sum(A, u => force(w, u, 1, fire[u.country])) * crowdA * plan * gunsA * luckA;
  // A reconnaissance that finds the place all but empty walks in.
  if (manner === 'probe' && fA > fD * 4) manner = 'assault';
  const probe = manner === 'probe', press = manner === 'all_out';
  // Men are killed by the men who face them. What a side loses is set by the strength the other side brings to bear, and more of it the more
  // it is outmatched; never more than about four in ten of those present in one quarter. A handful cannot bleed a host, however large the host.
  // A reconnaissance breaks off before it has cost a quarter of that; an attack pressed regardless costs both sides more, the attacker most.
  const lossD = Math.min(.42, .09 * fA * Math.pow(fA / Math.max(fD, 1e-9), .35) / Math.max(menD, 1e-9)) * (probe ? .25 : press ? 1.15 : 1);
  const lossA = Math.min(.42, .09 * fD * Math.pow(fD / Math.max(fA, 1e-9), .35) / Math.max(menA, 1e-9)) * (probe ? .25 : press ? 1.35 : 1);
  // Troops under orders not to give a step stay under fire when others would have broken off: beaten, they lose more men for it, and a unit
  // that is bled that way remembers who gave the order.
  const apply = (xs, loss, won) => xs.map(u => {
    const stood = !won && !probe && u.posture === 'no_retreat', dead = u.men * Math.min(.55, loss * (stood ? 1.4 : 1)); u.men -= dead;
    u.morale = clamp(u.morale + (won ? (probe ? 1 : 3) : probe ? -1 - loss * 45 : -8 - loss * 45 - (stood ? loss * 30 : 0)), 0, 100); if (stood && loss > .1) u.loyalty = clamp(u.loyalty - 3, 0, 100);
    // The dead are felt against the size of the people who must bury them.
    w.countries[u.country].warExhaustion = clamp(w.countries[u.country].warExhaustion + dead / Math.max(w.countries[u.country]._pop || 10000, 1) * 5000, 0, 100);
    return dead;
  }).reduce((a, x) => a + x, 0);
  const atkWins = !probe && fA > fD;
  // What each side's own average was, for the account its staff gives afterwards.
  const avg = (xs, f) => sum(xs, u => f(u) * u.men) / Math.max(men(xs), 1e-9), sup = xs => avg(xs, u => supplyOf(w, u).factor), far = xs => [...xs].sort((a, b) => supplyOf(w, a).factor - supplyOf(w, b).factor)[0];
  const led = xs => avg(xs, u => commanderOf(w, u)?.skill ?? 1), heart = xs => avg(xs, u => u.morale), kit = xs => avg(xs, u => u.equip * u.quality * w.countries[u.country].tech.mil), shells = xs => avg(xs, u => .55 + .45 * (fire[u.country] ?? 1));
  const dugD = avg(D, u => 1 + (u.dug || 0) * .1 * (1 - breach)), deepest = Math.max(0, ...D.map(u => u.dug || 0));
  // How far each thing favoured the attacker (above one) or the defender (below it).
  const told = { numbers: (menA * crowdA) / Math.max(menD * crowdD, 1e-9), ground: 1 / natural, works: 1 / (works * dugD), supply: sup(A) / sup(D), shells: shells(A) / shells(D), command: led(A) / led(D), spirit: heart(A) / Math.max(heart(D), 1), arms: kit(A) / Math.max(kit(D), 1e-9), plan, fleet: gunsA / gunsD, luck: luckA / luckD };
  const winGen = commanderOf(w, (atkWins ? A : D)[0]), loseGen = commanderOf(w, (atkWins ? D : A)[0]);
  if (!probe) {
    if (winGen) { winGen.skill = clamp((winGen.skill ?? 1) + .01, .5, 1.6); (winGen.record ||= { won: 0, lost: 0 }).won++; }
    if (loseGen) (loseGen.record ||= { won: 0, lost: 0 }).lost++;
    hazard(w, winGen, (atkWins ? A : D)[0], false, p); hazard(w, loseGen, (atkWins ? D : A)[0], true, p);
  }
  const wasA = menA, wasD = menD, dd = apply(D, lossD, !atkWins), da = apply(A, lossA, atkWins);
  p.devastation = clamp(p.devastation + (probe ? .02 : .1 + (dd + da) / 700), 0, 1);
  if (!probe) for (const k of CLASSES) p.pops[k].n *= .985;
  const loser = probe ? [] : atkWins ? D : A, victor = w.countries[atkWins ? atkSide[0] : defCountry], odds = (atkWins ? fA : fD) / Math.max(atkWins ? fD : fA, 1e-9);
  // A beaten force that was badly outmatched leaves men in the victor's hands as it goes, more of them when it was taken from two sides; one
  // with no road home leaves far more. Prisoners are held by the victor until a peace sends them home.
  let taken = 0, stood = 0; const went = {};
  for (const u of loser) {
    // Not one step back, or an attack that is to be pressed whatever it costs: beaten but not broken, the unit is still on the field next quarter,
    // and the ground stays with whoever held it. It breaks when its spirit does.
    const pressing = !atkWins && press && u.attack?.to === pid;
    if (pressing) { u.morale = clamp(u.morale - lossA * 20, 0, 100); if (lossA > .1) u.loyalty = clamp(u.loyalty - 2, 0, 100); }
    if ((u.posture === 'no_retreat' || pressing) && u.morale > 15 && u.men >= .2) { stood += u.men; continue; }
    const back = wayBack(w, u, pid);
    const caught = u.men * (back ? clamp((odds - 2) * .1 + (atkWins ? flank * .06 : 0), 0, .36) : .4);
    if (back) { u.province = back; u.target = null; (went[u.country] ||= new Set()).add(w.provinces[back].name); } else u.morale *= .4;
    if (caught > 0) { u.men -= caught; taken += caught; const held = victor.captives ||= {}; held[u.country] = (held[u.country] || 0) + caught; const home = w.countries[u.country]; home.warExhaustion = clamp(home.warExhaustion + caught / Math.max(home._pop || 10000, 1) * 2500, 0, 100); }
  }
  // A reconnaissance goes back where it came from with what it has learned.
  if (probe) for (const u of A) { const back = u.from && w.provinces[u.from] && mayStand(w, u.country, u.from) ? u.from : wayBack(w, u, pid); if (back) { u.province = back; (went[u.country] ||= new Set()).add(w.provinces[back].name); } u.target = null; }
  const late = Object.values(w.units).filter(u => u.attack?.to === pid && u.attack.late === w.turn && atkSide.includes(u.country));
  for (const u of A) if (u.attack?.to === pid && !(press && !atkWins && u.province === pid)) delete u.attack;
  const head = probe ? `Reconnaissance in force at ${p.name}: ${w.countries[atkSide[0]].name} felt out the defences and drew off.` : `Battle of ${p.name}: ${atkWins ? w.countries[atkSide[0]].name : w.countries[defCountry].name} prevailed.`;
  news(w, `${head} Losses: attacker ${Math.round(da)}k, defender ${Math.round(dd)}k.${taken >= .5 ? ` About ${Math.round(taken)} thousand of the beaten side were taken prisoner.` : ''}${stood >= .5 ? ` About ${Math.round(stood)} thousand of the beaten side did not leave the field.` : ''}`, { kind: 'war', countries: [...atkSide, ...defSide], province: pid });
  // Each staff's own account of the day, for whoever gave the orders: its own figures as counted, the enemy's as estimated, and what told.
  const ground = `the ${p.terrain === 'hills' ? 'hills' : p.terrain === 'mountain' ? 'mountains' : p.terrain} of ${p.name}${pass ? ', a pass' : bridge ? ', a river crossing' : ''}`;
  const worksText = [p.fort >= 1 && holds ? `a fortress of the ${['first', 'second', 'third'][Math.ceil(p.fort) - 1] ?? 'third'} order` : '', p.trench && holds ? `${p.trench > 1 ? 'two lines' : 'a line'} of prepared field works` : '', deepest >= 1 ? `trenches the troops had dug themselves over ${deepest >= 4 ? 'many months' : deepest >= 2 ? 'some months' : 'a few weeks'}` : ''].filter(Boolean).join(', ');
  const because = (key, us, mine, theirs) => {
    const lostIt = (told[key] > 1) !== (us === 'A'), pc = v => Math.round(v * 100);
    if (key === 'numbers') { const crowd = us === 'A' ? crowdA : crowdD, n = us === 'A' ? wasA : wasD; return lostIt ? (crowd < .9 && n > (us === 'A' ? wasD : wasA) ? `the ground let only about ${about(n * crowd)} thousand of our ${about(n)} thousand come into action at once` : 'they had more men in action than we did') : 'we had more men in action than they did'; }
    if (key === 'ground') return p.terrain === 'plains' && !pass && !bridge ? (us === 'A' ? 'they stood on the defensive and we had to come at them over open ground' : 'we stood on the defensive and they had to come at us over open ground') : us === 'A' ? `${ground} fight for whoever holds them` : `${ground} fought for us`;
    if (key === 'works') return us === 'A' ? `they fought from works (${worksText || 'what they had dug'})${weight > 0 ? `; our bombardment knocked in about ${pc(breach)} in the hundred of the field works${p.fort >= 1 && holds ? ` and ${pc(breachFort)} of the fortress` : ''}` : ', and we went in without a bombardment'}` : `we fought from our works (${worksText || 'what we had dug'})${weight > 0 ? `, though their guns knocked in about ${pc(breach)} in the hundred of the field works${p.fort >= 1 && holds ? ` and ${pc(breachFort)} of the fortress` : ''}` : ''}`;
    if (key === 'supply') { const s = supplyOf(w, far(lostIt ? mine : theirs)); return lostIt ? (s.linked ? `our troops were ${Math.round(s.depth * 10) / 10} marches of wagon road from their supply head at ${w.provinces[s.head]?.name} and short of everything` : 'our troops were cut off from supply altogether') : s.linked ? 'their troops were far from their railhead and ill supplied' : 'their troops were cut off from their supplies'; }
    if (key === 'shells') { const id = mine[0].country; return lostIt ? `the arsenal could send only ${pc(fire[id] ?? 1)} in the hundred of the cartridges and shells the fight called for` : 'their fire slackened as the fight went on: they are short of shells'; }
    if (key === 'command') return lostIt ? 'they were the better led' : 'we were the better led';
    if (key === 'spirit') return lostIt ? 'our men went in with less heart than theirs' : 'our men were in better heart than theirs';
    if (key === 'arms') return lostIt ? 'they were the better armed and trained' : 'we were the better armed and trained';
    if (key === 'plan') return us === 'A' ? [flank ? `our columns came at them from ${flank + 1} sides together` : '', ready >= .5 ? 'the attack had been prepared' : '', press ? 'the attack was pressed regardless of loss' : ''].filter(Boolean).join(', and ') : [flank ? `they came at us from ${flank + 1} sides together` : '', ready >= .5 ? 'their attack had plainly been long prepared' : '', press ? 'they pressed it regardless of loss' : ''].filter(Boolean).join(', and ');
    if (key === 'fleet') return lostIt ? 'their ships\' guns reached the field from the sea' : 'our ships\' guns reached the field from the sea';
    return 'for the rest it could have gone either way';
  };
  // What told for whoever carried the day, strongest first; a thing counts once it made a difference of a tenth or so.
  const weightOf = k => Math.abs(Math.log(told[k])), why = Object.keys(told).filter(k => weightOf(k) > .08 && (probe || (told[k] > 1) === atkWins)).sort((a, b) => weightOf(b) - weightOf(a)).slice(0, 3);
  for (const [us, mine, theirs, ids] of [['A', A, D, atkSide], ['D', D, A, defSide]]) {
    const won = !probe && (us === 'A') === atkWins, my = us === 'A' ? { was: wasA, dead: da } : { was: wasD, dead: dd }, their = us === 'A' ? { was: wasD, dead: dd } : { was: wasA, dead: da };
    const reasons = why.map(k => because(k, us, mine, theirs)).filter(Boolean);
    for (const id of ids) {
      const c = w.countries[id], here = Object.values(w.units).filter(u => u.country === id && mine.includes(u)), stayed = here.some(u => u.province === pid), to = [...(went[id] || [])].join(', ');
      const found = probe && us === 'A' ? ` The reconnaissance puts them at about ${about(their.was)} thousand${worksText ? `, in ${worksText}` : ', with no works to speak of'}${(fire[theirs[0].country] ?? 1) < .7 ? '; their guns answered thinly, as if short of shells' : ''}.` : '';
      const lateText = us === 'A' && late.some(u => u.country === id) ? ` The column of ${[...new Set(late.filter(u => u.country === id).map(u => u.id))].join(', ')} was not up in time and took no part; it goes in next quarter unless ordered otherwise.` : '';
      mark(w, c, `${probe ? (us === 'A' ? `Our reconnaissance in force at ${p.name}` : `An enemy reconnaissance in force against ${p.name} was beaten off`) : us === 'A' ? `Our attack on ${p.name} ${won ? 'carried the place' : 'failed'}` : `${p.name} was attacked and ${won ? 'held' : 'lost'}`}. We had ${about(my.was)} thousand men there and lost ${Math.round(my.dead * 10) / 10} thousand${!won && taken >= .5 && !probe ? `, besides about ${about(taken)} thousand taken prisoner` : ''}; they had about ${about(their.was)} thousand and their loss is put at about ${about(their.dead)} thousand${won && taken >= .5 ? `, besides about ${about(taken)} thousand prisoners in our hands` : ''}.${found}${reasons.length ? ` What ${probe ? 'the fighting showed' : won ? 'told for us' : 'told against us'}: ${reasons.join('; ')}.` : ''}${lateText} The fight used ${Math.round((shot[id] || 0) * 10) / 10} of arms and ammunition; ${Math.round(c.stock.arms || 0)} remain in the arsenal.${to ? ` Our troops ${probe ? 'are back at' : 'fell back to'} ${to}.` : ''}${stayed && !won && !probe ? ` Our troops are still on the field at ${p.name}${us === 'A' && press ? ' under the order to press the attack, and go in again next quarter unless that order is changed' : ', under the order not to give a step'}.` : ''}`);
    }
  }
  w.battles.push({ province: pid, attacker: atkSide[0], defender: defCountry, attackerWon: atkWins, lossA: Math.round(da), lossD: Math.round(dd), prisoners: Math.round(taken), manner, ...(flank ? { sides: flank + 1 } : {}), ...(weight > 0 ? { shelled: Math.round(breach * 100), ...(p.fort >= 1 && holds ? { breached: Math.round(breachFort * 100) } : {}) } : {}), why });
}

export function capture(w, p, by) {
  const from = p.controller;
  if (from === by) return;
  // Troops that retake an ally's province hand it back; they do not keep it.
  const owner = w.countries[p.owner], taker = w.countries[by], loser = w.countries[from], to = p.owner !== by && owner?.alive && !atWar(w, by, p.owner) ? p.owner : by;
  p.controller = to; p.governor = null;
  // Whoever gives up a province wrecks what the enemy could use: a railway taken in war carries nothing for its new holder for two quarters.
  if (p.rail > 0) p.railOut = w.turn + 2;
  if (p.port > 0) portFalls(w, p, to);
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
