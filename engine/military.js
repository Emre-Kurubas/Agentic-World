import { clamp, sum, news, between, rand } from './util.js';
import { CLASSES, atWar, hasTreaty, countryProvinces, aliveCountries, provincePop, makeUnit, goHome, markFought } from './world.js';
import { hasTech } from './economy.js';
import { drillOf } from './frontier.js';
import { moved as goldMoved } from './gold.js';
import { treasuryPays } from './money.js';
import { originPull } from './culture.js';
import { die, garrisonHold } from './politics.js';
import { afflict, incapacitated } from './health.js';
import { navalStep, portFalls, shipGuns, enemyHolds, SHIPS, kindOf, iced } from './navy.js';

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
export const railWorks = (w, p) => p.rail > 0 && !((p.railOut ?? -1) > w.turn) && !p.cut;
// Where an army is fed from. The heads of its supply are the capital, every province joined to the capital by working rails through ground the
// country can use, and its open harbours with whatever rails run inland from them. From a head the wagons go on by road, and horses eat what
// they pull: each province costs what its ground and its roads cost a column, half that on the country's own soil, where there are depots and
// a population that sells. An army within a march of a head wants for nothing; further out it gets less of everything, down to three fifths.
const HAUL = { plains: 1, desert: 1.3, hills: 1.3, forest: 1.3, tundra: 1.5, marsh: 1.6, mountain: 2 };
const haul = (c, p) => (HAUL[p.terrain] ?? 1.3) * roadFactor(p) * (p.owner === c.id && p.controller === c.id ? .5 : 1) * (p.cut ? 1.5 : 1);
export function supplyLines(w, c) {
  const net = supplyNetwork(w, c), depth = {}, head = {}, q = [];
  const open = p => p.port > 0 && p.controller === c.id && !iced(w, p) && p.seas.some(s => !enemyHolds(w, s, c.id));
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
  // A depot is a head of supply pushed forward: stores piled at a place the wagons can reach, from which the last marches are counted
  // afresh. It serves while it holds stores (it fills, a quarter's worth at a time, while a road joins it to the country; military step).
  const reach = { ...depth }, fed = [...net].filter(id => { const p = w.provinces[id]; return p.depot > 0 && p.controller === c.id && (p.depotStore || 0) >= 1 && depth[id] > 0; });
  for (const id of fed) { depth[id] = 0; head[id] = id; todo.push(id); }
  while (todo.length) {
    todo.sort((a, b) => depth[a] - depth[b]); const x = todo.shift();
    for (const n of w.provinces[x].neighbors) { if (!net.has(n)) continue; const d = depth[x] + haul(c, w.provinces[n]); if (!(n in depth) || d < depth[n] - 1e-9) { depth[n] = d; head[n] = head[x]; todo.push(n); } }
  }
  // What lies beyond the sea from the capital is fed through its harbours, and a harbour lands only so much in a quarter.
  const home = new Set(c.capital && net.has(c.capital) ? [c.capital] : []), hq = [...home];
  for (let i = 0; i < hq.length; i++) for (const n of w.provinces[hq[i]].neighbors) if (net.has(n) && !home.has(n)) { home.add(n); hq.push(n); }
  const over = {}, lands = {}, quay = {}; let k = 0;
  for (const id of net) if (!home.has(id) && !(id in over)) { const label = 'O' + k++, grp = [id]; over[id] = label; lands[label] = 0;
    for (let i = 0; i < grp.length; i++) { const p = w.provinces[grp[i]]; if (open(p)) { lands[label] += p.port * PORT_FEEDS; if (!quay[label] || p.port > w.provinces[quay[label]].port) quay[label] = p.id; } for (const n of p.neighbors) if (net.has(n) && !home.has(n) && !(n in over)) { over[n] = label; grp.push(n); } } }
  return { net, depth, head, over, lands, quay, reach };
}
// How many quarters of stores one size of depot holds, and how many thousand men a cut-off force can feed from one.
export const DEPOT_HOLDS = 2, DEPOT_FEEDS = 60;
// The magazines fill while a road joins them to the country and empty while troops cut off from it live on them.
export function depotStep(w) {
  for (const p of Object.values(w.provinces)) { if (!(p.depot > 0)) continue; const c = w.countries[p.controller]; if (!c?.alive) continue;
    const l = linesOf(w, c.id), joined = l && l.reach[p.id] != null;
    if (joined) p.depotStore = Math.min(p.depot * DEPOT_HOLDS, (p.depotStore || 0) + 1);
    else if (p.depotDrawn === w.turn) { p.depotStore = Math.max(0, (p.depotStore || 0) - 1); if (p.depotStore <= 0) for (const ch of [w.characters[c.leader], w.characters[c.general]]) if (ch?.alive) ch.inbox.push({ turn: w.turn, from: 'Quartermaster General', text: `The depot at ${p.name} is empty. The troops that lived on it are cut off from the country and have nothing more behind them.` }); } }
}
// The nearest stocked depot of ours within two marches of a place, through ground we hold: what a force cut off from the country lives on.
function magazine(w, u) {
  const seen = new Set([u.province]), q = [[u.province, 0]];
  for (let i = 0; i < q.length; i++) { const [id, d] = q[i], p = w.provinces[id]; if (p.depot > 0 && p.controller === u.country && (p.depotStore || 0) >= 1) return p; if (d >= 2) continue; for (const n of p.neighbors) if (!seen.has(n) && w.provinces[n].controller === u.country) { seen.add(n); q.push([n, d + 1]); } }
  return null;
}
// Thousands of men one level of harbour can keep fed and shot across the sea.
export const PORT_FEEDS = 60;
let lines = {};
const linesOf = (w, id) => lines[id]?.turn === w.turn && lines[id].w === w ? lines[id] : (w.countries[id]?.alive ? (lines[id] = { ...supplyLines(w, w.countries[id]), turn: w.turn, w }) : null);
// How one unit stands with its supplies: whether a road joins it to the country at all, how many marches of wagon road lie between it and the
// nearest head, and what part of its needs reaches it. Troops fighting in a province the enemy holds are fed from the nearest ground behind them.
export function supplyOf(w, u) {
  const l = linesOf(w, u.country), p = w.provinces[u.province], c = w.countries[u.country];
  if (!l || !p || !c) return { linked: true, depth: 0, head: null, factor: 1 };
  let d = l.depth[p.id], h = l.head[p.id];
  if (d == null) for (const n of p.neighbors) if (l.depth[n] != null) { const x = l.depth[n] + haul(c, p); if (d == null || x < d) { d = x; h = l.head[n]; } }
  // Cut off from the country, a force lives on the stores of a depot of its own if one stands within two marches, for as long as they last.
  if (d == null) { const m = magazine(w, u); if (m) { m.depotDrawn = w.turn; const load = sum(Object.values(w.units).filter(x => x.country === u.country && linesOf(w, x.country)?.depth[x.province] == null && magazine(w, x) === m), x => x.men); return { linked: false, depth: null, head: m.id, factor: clamp(m.depot * DEPOT_FEEDS / Math.max(load, 1e-9), .55, .95), depot: m.id, left: m.depotStore }; } return { linked: false, depth: null, head: null, factor: .55 }; }
  // An army on soil beyond the sea that is not its country's own lives on what its harbours can land, and shares them with every other man of
  // its country landed there. (On the country's own soil across the water the depots and the farms are its own.)
  const shore = id => l.over[id] ?? (l.net.has(id) ? undefined : w.provinces[id]?.neighbors.map(n => l.over[n]).find(x => x != null)), abroad = id => w.provinces[id]?.owner !== u.country, label = l.over[h] ?? shore(p.id);
  if (label == null || !abroad(p.id)) return { linked: true, depth: d, head: h, factor: clamp(1 - (d - 1) * .12, .6, 1) };
  const load = sum(Object.values(w.units).filter(x => x.country === u.country && abroad(x.province) && shore(x.province) === label), x => x.men), neck = clamp(l.lands[label] / Math.max(load, 1e-9), .5, 1);
  return { linked: true, depth: d, head: h, factor: clamp(1 - (d - 1) * .12, .6, 1) * neck, ...(neck < 1 ? { quay: l.quay[label], lands: l.lands[label], load } : {}) };
}
export const supplyWords = (w, u) => { const s = supplyOf(w, u), h = w.provinces[s.head]?.name; if (s.depot) return `cut off from the country and living on the depot at ${h}: about ${Math.round(s.factor * 100)} in the hundred of what it needs, for ${s.left} quarter${s.left > 1 ? 's' : ''} more`; if (s.quay) return `fed across the sea: the harbour of ${w.provinces[s.quay].name} can land for about ${Math.round(s.lands)} thousand men and ${Math.round(s.load)} thousand draw on it, so about ${Math.round(s.factor * 100)} in the hundred of what it needs reaches it (a larger harbour, or fewer men, would mend that)`; return !s.linked ? 'cut off from the country: no supply reaches it' : s.depth <= 1 ? `fully supplied from ${h}` : `${Math.round(s.depth * 10) / 10} marches of wagon road from its supply head at ${h}: about ${Math.round(s.factor * 100)} in the hundred of what it needs reaches it`; };
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
export const FRONTAGE = { plains: 160, hills: 110, forest: 100, mountain: 60, marsh: 70, desert: 130, tundra: 100 };
const crowding = (men, terrain, widen = 1) => { const room = (FRONTAGE[terrain] ?? 120) * widen; return men <= room ? 1 : (room + (men - room) * .4) / men; };
const KIND = { infantry: 1, artillery: 1.7, armor: 3.2, air: 2.6, cavalry: .9 };

// The road a unit takes. Where there is a road over ground it may march on without a fight, it takes that road, however much longer: an army sent
// from one of its own provinces to another does not blunder through the enemy's country because the map is shorter that way. Where there is none,
// or where the place it is sent to is the enemy's, it goes through as few provinces of his as will do.
export function roadTo(w, from, to, country) {
  if (from === to) return [];
  const cost = { [from]: 0 }, prev = {}, open = [from], hostile = n => { const o = w.provinces[n].controller; return o !== country && fighting(w, country, o); };
  while (open.length) {
    open.sort((a, b) => cost[a] - cost[b]); const cur = open.shift();
    if (cur === to) { const path = []; for (let x = to; x !== from; x = prev[x]) path.unshift(x); return path; }
    for (const n of w.provinces[cur].neighbors) {
      if (n !== to && !canEnter(w, country, n)) continue;
      const c = cost[cur] + (hostile(n) ? 50 : 1);
      if (cost[n] == null || c < cost[n] - 1e-9) { cost[n] = c; prev[n] = cur; if (!open.includes(n)) open.push(n); }
    }
  }
  return null;
}
export function pathStep(w, from, to, country) { return roadTo(w, from, to, country)?.[0] ?? null; }

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
export const postureWords = u => [u.digAt && u.posture !== 'defensive' ? 'to stand on the defensive where its march ends' : '', u.posture === 'defensive' ? 'standing on the defensive' : u.posture === 'fall_back' ? 'to fall back if pressed' : u.posture === 'no_retreat' ? 'not one step back' : '', u.holdFire ? 'holding fire on the frontier' : '', u.barracks ? 'kept in barracks' : ''].filter(Boolean).join(', ');
// Where a unit goes when it gives up a province: toward its own country, the nearest of its own provinces to the capital, else an ally's.
function wayBack(w, u, pid) {
  const cap = w.provinces[w.countries[u.country]?.capital], near = n => cap ? Math.hypot(w.provinces[n].cx - cap.cx, w.provinces[n].cy - cap.cy) : 0, ns = w.provinces[pid].neighbors;
  return ns.filter(n => w.provinces[n].controller === u.country).sort((a, b) => near(a) - near(b))[0] ?? ns.find(n => hasTreaty(w, u.country, w.provinces[n].controller, 'alliance')) ?? null;
}

// What a unit is worth in a fight. def is what the ground and the works on it give whoever holds them; fire is the part of the cartridges and
// shells the fight calls for that the arsenal could send (a unit with no road home gets half of that at best); breach is the part of the
// defender's digging that the attacker's guns have knocked in.
// What a commander is worth. Where men stand and shoot, the best general in the world adds a little to what their rifles do; his trade is the
// timetable, the concentration nobody sees, and the retreat that does not become a rout, and there his ability counts in full.
export const leadOf = ch => 1 + ((ch?.skill ?? 1) - 1) * .4;
const force = (w, u, def = 1, fire = 1, breach = 0) => {
  const c = w.countries[u.country];
  const p = w.provinces[u.province], s = supplyOf(w, u);
  const supply = (.55 + .45 * (s.linked ? fire : Math.min(fire, .5))) * s.factor * (.8 + Math.min(p.infra, 1) * .2) * (1 + (railWorks(w, p) ? p.rail : 0) * .08);
  // Works count for whoever defends the ground, and for troops ordered to stand on the defensive wherever they are attacked.
  const standing = def > 1 || u.posture === 'defensive', dug = standing ? 1 + (u.dug || 0) * .1 * (1 - breach) : 1, skill = leadOf(commanderOf(w, u));
  // The machine gun is a weapon of the man who waits: it adds a little to an advance and a great deal to a held line.
  const auto = hasTech(c, 'automatic_weapons') && u.kind === 'infantry' ? (standing ? 1.3 : 1.08) : 1;
  const motorized = ['armor', 'air'].includes(u.kind), fuel = motorized ? (c.fuelRatio ?? 1) >= .6 ? 1 : .35 : 1;
  // Cavalry is for seeing, screening and riding down a beaten enemy: in a firefight it counts for less than the same men on foot, and in close country for little.
  const terrainApplies = u.kind === 'air' ? 1 : u.kind === 'cavalry' ? (['mountain', 'marsh', 'forest'].includes(p.terrain) ? .5 : .8) : (u.kind === 'armor' && ['mountain', 'marsh', 'forest'].includes(p.terrain) ? .55 : 1);
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
  const c = w.countries[u.country], motor = ['armor', 'air'].includes(u.kind) && (c?.fuelRatio ?? 1) >= .6, per = motor || u.kind === 'cavalry' ? 4 : 3; let cur = u.province, left = per, q = 1, n = 0;
  while (cur !== to && n++ < 80) { const step = pathStep(w, cur, to, u.country); if (!step) return null; const from = w.provinces[cur], nx = w.provinces[step], hostile = fighting(w, u.country, nx.controller), cost = hostile ? (motor ? 2 : 3) : marchCost(from, nx, w);
    if (hostile ? left <= 1e-9 : left < cost - 1e-9) { q++; left = per; } left = Math.max(0, left - cost); cur = step; }
  return cur === to ? q : null;
}

export function militaryStep(w, onStation = null, afterFight = null) {
  // Behind an invading army the country it has overrun is not quiet. A province of the enemy's held by too few men for its people is a province
  // where bands cut the railway and waylay the wagons: nothing passes it by rail, and by road only slowly.
  for (const p of Object.values(w.provinces)) { const was = !!p.cut, pop = provincePop(p), thin = p.controller !== p.owner && w.countries[p.owner]?.alive && atWar(w, p.owner, p.controller) && garrisonHold(sum(Object.values(w.units).filter(u => u.province === p.id && u.country === p.controller && !u.barracks), u => u.men), pop) < 1;
    if (thin) { p.cut = true; if (!was && w.countries[p.controller]?.alive) mark(w, w.countries[p.controller], `Behind the army, ${p.name} is held by too few men for its people: bands cut the railway and waylay the wagons there, and what passes through it to the front passes slowly. About ${Math.max(1, Math.ceil(pop / 400))} thousand men stationed in it would keep it quiet.`); } else delete p.cut; }
  lines = {}; supplied = Object.fromEntries(aliveCountries(w).map(c => [c.id, linesOf(w, c.id).net]));
  for (const c of aliveCountries(w)) c._shot = 0;
  if (season(w) === 'winter') for (const u of Object.values(w.units)) { const p = w.provinces[u.province]; if (!p) continue; const hard = WINTER[p.terrain] ? .05 : p.controller !== u.country && !railWorks(w, p) ? .03 : 0; if (hard) { u.men = Math.max(.05, u.men * (1 - hard)); u.morale = clamp(u.morale - (hard > .04 ? 6 : 4), 5, 100); } }
  for (const u of Object.values(w.units)) {
    // Troops on the defensive do not march: they dig, and deeper than troops who expect to be moved on. Troops ordered to stand on the defensive
    // where their march ends do so when they are there; if the march was given up, so is that.
    if (u.digAt && (u.province === u.digAt || !u.target)) { if (u.province === u.digAt) { u.posture = 'defensive'; u.target = null; } delete u.digAt; }
    if (u.posture === 'defensive') u.target = null;
    if (!u.target) { u.dug = Math.min(u.posture === 'defensive' ? 5 : 3, (u.dug || 0) + (u.posture === 'defensive' ? 2 : 1)); continue; }
    // What became of the quarter's march is kept on the unit, so that whoever ordered it can see how far it got and what held it.
    const went = u.march = { turn: w.turn, from: u.province, to: u.target, provinces: 0, held: '' };
    // Troops just put ashore do not march the same quarter. A unit with the enemy in its own province is engaged and cannot walk away:
    // that is also what stops two armies ordered at each other from passing on the road.
    if (u.shipped === w.turn) { went.held = 'it was put ashore this quarter'; continue; }
    // A garrison shut in and ordered out breaks through the siege lines, and pays for it by how many stand round it.
    if (u.shutIn === u.province && w.provinces[u.province]?.siege?.shut) { const here = Object.values(w.units).filter(x => x.province === u.province), foes = here.filter(x => fighting(w, x.country, u.country)), ours = here.filter(x => x.shutIn === u.province), back = wayBack(w, u, u.province), p = w.provinces[u.province];
      if (!back) { went.held = 'it is shut in and there is no way out'; continue; }
      const odds = sum(foes, x => x.men) / Math.max(sum(ours, x => x.men), .1), loss = foes.length ? clamp(.08 + .08 * (odds - 1), .1, .45) : 0, caught = u.men * loss, k = w.countries[u.country], foe = w.countries[p.siege.by];
      u.men -= caught; if (foe?.alive) { const held = foe.captives ||= {}; held[u.country] = (held[u.country] || 0) + caught * .6; } u.morale = clamp(u.morale - 8, 0, 100); u.from = u.province; u.province = back; u.dug = 0; delete u.shutIn; went.provinces = 1; went.reached = back; went.held = u.target === back ? '' : 'it broke out through the siege lines and could go no further this quarter'; if (u.target === back) u.target = null;
      mark(w, k, `${u.id} broke out of ${p.name} through the siege lines and reached ${w.provinces[back].name} with ${Math.round(u.men * 10) / 10} thousand men; about ${Math.round(caught * 10) / 10} thousand were lost or taken on the way.`); if (foe?.alive) mark(w, foe, `Part of the garrison of ${p.name}, about ${about(u.men + caught)} thousand, broke out through our lines toward ${w.provinces[back].name}; about ${about(caught)} thousand of them were cut down or taken.`);
      continue; }
    if (Object.values(w.units).some(x => x.province === u.province && fighting(w, x.country, u.country))) { went.held = 'the enemy stands in its province and it cannot break away'; continue; }
    u.dug = 0;
    // A quarter is a long time on roads one holds: an army crosses about three provinces of open, friendly country in it, fewer over hills,
    // forest, marsh or mountain or on bad roads, and twice as many where the railway runs from one to the next. Into ground the enemy holds
    // it advances one province and no more that quarter (two with engines and fuel).
    const c = w.countries[u.country], motor = ['armor', 'air'].includes(u.kind) && (c.fuelRatio ?? 1) >= .6;
    let left = motor || u.kind === 'cavalry' ? 4 : 3;
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
    if (u.digAt && u.province === u.digAt) { u.posture = 'defensive'; u.target = null; delete u.digAt; }
  }
  // A unit ordered to join another when it comes up does so where the two stand together ("B402 returns to Kishukarir and rejoins B33").
  for (const u of Object.values(w.units)) { if (!u.joinTo || !w.units[u.id]) continue; const t = w.units[u.joinTo];
    if (!t || t.country !== u.country || t.kind !== u.kind) { delete u.joinTo; continue; }
    if (t.province === u.province) { const name = w.provinces[u.province]?.name ?? u.province, n = joinUnits(w, u, t); mark(w, w.countries[t.country], `${u.id} has come up to ${name} and joined ${t.id}, which now musters ${Math.round(n * 10) / 10} thousand men.`); }
    else if (!u.target) delete u.joinTo; }
  launch(w);
  navalStep(w);
  // What was ordered to wait for the squadrons (a landing, a bombardment, mines, a demonstration) is carried out now that they have sailed and fought.
  onStation?.(w);
  for (const c of aliveCountries(w)) upkeep(w, c);
  const byProv = {};
  for (const u of Object.values(w.units)) (byProv[u.province] ||= []).push(u);
  for (const [pid, us] of Object.entries(byProv)) resolve(w, pid, us);
  for (const u of Object.values(w.units)) if (u.men < .2 || u.morale <= 3) {
    const c = w.countries[u.country];
    if (u.men >= .2 && c?.alive) { const home = Object.values(w.provinces).filter(p => p.owner === c.id && p.controller === c.id); goHome(home, u.men); (w.gone ||= {})[u.id] = { t: w.turn, how: 'it broke up: the men would serve no longer and went home' };
      const text = `${u.id}, ${Math.round(u.men * 10) / 10} thousand men at ${w.provinces[u.province]?.name ?? 'its station'}, has broken up: there was no spirit left in it, and the men have gone home.`; for (const id of new Set([c.leader, c.general])) { const ch = w.characters[id]; if (ch?.alive) ch.inbox.push({ turn: w.turn, from: 'General Staff', text }); } }
    delete w.units[u.id]; }
  const remaining = {};
  for (const u of Object.values(w.units)) (remaining[u.province] ||= []).push(u);
  // A siege lasts only while the besieger stands there at war.
  for (const p of Object.values(w.provinces)) if (p.siege && !(remaining[p.id] || []).some(u => u.country === p.siege.by && atWar(w, u.country, p.controller))) delete p.siege;
  for (const u of Object.values(w.units)) if (u.shutIn && !(w.provinces[u.shutIn]?.siege?.shut && u.province === u.shutIn)) delete u.shutIn;
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
      // A fortress is worn down by investment, and far faster under siege guns.
      p.fort = Math.max(0, p.fort - .12 - Math.min(.3, sum(occ.filter(u => u.country === by && u.kind === 'artillery'), u => u.men) / 40));
      if (p.siege.turns < Math.ceil(p.fort) + 1) continue;
    }
    delete p.siege; p.fort = Math.max(0, (p.fort || 0) - 1);
    capture(w, p, by);
  }
  settleOccupations(w);
  // An attack order whose objective is no longer the enemy's has been carried out, or overtaken: it is spent.
  for (const u of Object.values(w.units)) if (u.attack && !fighting(w, u.country, w.provinces[u.attack.to]?.controller)) delete u.attack;
  // What was ordered to follow the capture of a place, or its failure, is ordered now that the quarter's fighting has said which it was.
  afterFight?.(w);
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
  // They go back over the nearest frontier of their own country, by land; the capital is where they go only when no road leads home.
  const nearest = u => { const seen = new Set([u.province]), q = [u.province]; while (q.length) for (const n of w.provinces[q.shift()].neighbors) { if (seen.has(n)) continue; seen.add(n); if (w.provinces[n].controller === u.country) return n; q.push(n); } return null; };
  for (const u of Object.values(w.units)) {
    if (mayStand(w, u.country, u.province)) continue;
    const c = w.countries[u.country], home = nearest(u) ?? (w.provinces[c?.capital]?.controller === u.country ? c.capital : countryProvinces(w, u.country)[0]?.id);
    if (home) { u.province = home; u.target = null; delete u.attack; } else delete w.units[u.id];
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
// A war is dearer than a peace: men in the field eat, march and shoot twice what men in barracks do, and men kept on soil that is not their
// own country's cost twice their keep in peace and two and a half times in war. A state that goes to war on its peace budget watches its army
// go unpaid.
// What one body of troops and one squadron cost to keep: the parts the whole bill is made of.
// Reservists just called cost half through the quarter they come in and the one after: they come in what they stand up in, with bread from
// home, and the paymasters' lists fill slowly. After that they cost like any soldier. (World 21: a general call-up put armies on a fifth of
// their pay in the quarter it was ordered.)
export const CALL_UP = { quarters: 2, cost: .5 };
const freshMen = (w, u) => u.calledAt != null && w.turn - u.calledAt < CALL_UP.quarters ? (u.called ? u.men : Math.min(u.calledMen || 0, u.men)) : 0;
const keepOfUnit = (w, c, u, out) => (u.men - freshMen(w, u) * (1 - CALL_UP.cost)) * (UPKEEP[u.kind] ?? 1) * (w.provinces[u.province] && w.provinces[u.province].owner !== c.id ? (out ? 2.5 : 2) : out ? 2 : 1) * .8 * c.priceLevel;
// A ship costs its keep whether it floats or lies in dock; a squadron kept at sea costs two fifths more than one lying in harbour.
const keepOfFleet = (c, f, out) => (f.ships + (f.damaged || 0) * .5) * SHIPS[kindOf(f)].power * (f.port ? 1 : 1.4) * (out ? 1.5 : 1) * 3 * c.priceLevel;
export function upkeepCost(w, c) {
  const out = inTheField(w, c.id);
  const men = sum(Object.values(w.units).filter(u => u.country === c.id), u => keepOfUnit(w, c, u, out));
  const ships = sum(Object.values(w.fleets).filter(f => f.country === c.id), f => keepOfFleet(c, f, out));
  const forts = sum(countryProvinces(w, c.id), p => (p.fort || 0) * 3 + (p.battery || 0) * 2);
  return men + ships + forts * 5 * c.priceLevel;
}
// When the vote for the forces falls short, who goes short is a decision (set_pay_priority): the bodies named are paid and supplied in full
// first and the rest share what is left. With no decision every regiment and every crew is short alike. A guard kept sweet while the
// frontier army rots, or a fleet put last until its crews hoist the red flag, are then somebody's choice and not the engine's.
export const PAY_FIRST = ['navy', 'army', 'capital'];
export function payOf(w, c, money, required, funded) {
  const first = c.payFirst || []; if (!first.length || funded >= 1) return () => funded;
  const out = inTheField(w, c.id), favoured = x => first.includes(x.id) || (x.ships != null ? first.includes('navy') : first.includes('army') || (first.includes('capital') && x.province === c.capital));
  const all = [...Object.values(w.units), ...Object.values(w.fleets)].filter(x => x.country === c.id), cost = x => x.ships != null ? keepOfFleet(c, x, out) : keepOfUnit(w, c, x, out);
  const costA = sum(all.filter(favoured), cost), a = costA > 0 ? clamp(money / costA, 0, 1) : 1, b = clamp((money - costA * a) / Math.max(required - costA, 1e-9), 0, 1);
  return x => favoured(x) ? a : b;
}
const UPKEEP = { infantry: 1, artillery: 1.5, armor: 3, air: 3, cavalry: 1.4 };

function upkeep(w, c) {
  const us = Object.values(w.units).filter(u => u.country === c.id);
  const men = sum(us, u => u.men);
  const inWar = w.wars.some(x => x.active && (x.a.includes(c.id) || x.b.includes(c.id)));
  // A country tires of war with every quarter it lasts and with every province it has lost, and recovers in peace, army or no army.
  const mine = Object.values(w.provinces).filter(p => p.owner === c.id), lost = mine.filter(p => p.controller !== c.id).length / Math.max(mine.length, 1);
  // Under an armistice the dying has stopped but the men are not home and the lost provinces are still lost.
  // A first year of war sits lightly on a country, as everyone expected it would; every quarter after the fourth weighs more than the one before,
  // win or lose.
  const out = inTheField(w, c.id); c.afield = out ? (c.afield || 0) + 1 : Math.max(0, (c.afield || 0) - 2);
  c.warExhaustion = clamp(c.warExhaustion + (!inWar ? -2 : out ? .6 + Math.min(2.4, Math.max(0, c.afield - 4) * .25) + lost * 6 : lost * 3 - .5), 0, 100);
  if (!men) { c.militaryFunding = 1; return; }
  const required = upkeepCost(w, c);
  // War credits are voted the day war comes: in the quarter a war begins, what the army in the field costs above its vote is met from the war
  // loan, as far as lenders will carry it. From the next quarter the vote is the ruler's to set, and an army on a peace vote goes short.
  // (World 22: the quarter war was declared both armies fell from full pay to half, because every man counted as in the field from that day
  // and no ruler could raise the vote before the next morning; then both paid 1.3 on credit without trouble. One quarter of unpaid corps
  // walking home frightened both rulers into a peace before a shot was fired. The user approved the rule and the sentence, 2026-11-13.)
  let money = c.budget.military * c.gdp * c.paidRatio;
  if (c.war?.on && c.war.quarters === 0 && money < required - .5) { const vote = money, cost = required, lent = treasuryPays(c, cost - vote, 'war'); money += lent; c.warCredits = { t: w.turn, lent, vote, cost };
    if (c._warCostTold !== w.turn) { const ch = w.characters[c.leader]; if (ch?.alive) ch.inbox.push({ turn: w.turn, from: 'Treasury', text: `In the field the forces cost about ${Math.round(cost)} a quarter against a vote of ${Math.round(vote)}. For this first quarter the difference is met from the war loan; from next quarter the vote has to carry it (set_budget), or the army goes short.${lent < cost - vote - .5 ? ` Lenders would carry only ${Math.round(lent)} of it this quarter.` : ''}` }); } }
  const funded = clamp(money / Math.max(required, 1), 0, 1.3), paid = payOf(w, c, money, required, funded), chosen = !!c.payFirst?.length && funded < 1;
  c.militaryFunding = funded;
  for (const f of Object.values(w.fleets)) if (f.country === c.id) { if (chosen) f.paid = paid(f); else delete f.paid; }
  // An army in the field wears out rifles, boots and cartridges faster than one in barracks; what a battle fires off is drawn when it is fought (resolve).
  const consume = men * (inWar && inTheField(w, c.id) ? .006 : .004);
  c.stock.arms = Math.max(0, c.stock.arms - consume);
  // Pay, arrears and a long war decide where the troops' spirit settles; a battle only knocks it about for a while.
  // Men short of bread and boots lose heart whatever they are paid (c.kit: what the country's stores sent of what the army asked).
  const spiritAt = got => clamp(40 + got * 35 - c.arrears * 6 - c.warExhaustion * .3 - (1 - (c.kit ?? 1)) * 15, 8, 95);
  let gone = 0; const field = inWar && inTheField(w, c.id); c._sick = 0;
  for (const u of us) {
    // What this body of men was paid and supplied with this quarter: the army's common share, unless someone decided otherwise.
    const got = paid(u); if (chosen) u.paid = got; else delete u.paid;
    u.morale = clamp(u.morale + (spiritAt(got) - u.morale) * .2, 0, 100);
    // Drill brings raw men up to the army's standard in a couple of years, and the edge of veterans wears off as they go home.
    // A body ordered to its exercises this quarter learns nearly three times as fast and comes a little past that standard (ops.js drill).
    { const hard = u.drill === w.turn, to = drillOf(c) + (hard ? .06 : 0); if (hard && u.quality < to) u.quality += (to - u.quality) * .22; else u.quality += (drillOf(c) - u.quality) * .08; }
    // An army in the field loses men to sickness every quarter it stays there: most in marsh and in summer heat, in siege lines and on foreign
    // soil; a medical service that knows what it is doing loses half as many.
    if (field) { const p = w.provinces[u.province], sick = u.men * (.004 + (p.terrain === 'marsh' ? .012 : 0) + (season(w) === 'summer' && ['marsh', 'desert'].includes(p.terrain) ? .006 : 0) + (p.siege ? .008 : 0) + (p.controller !== u.country ? .004 : 0)) * (hasTech(c, 'antibiotics') ? .5 : 1); u.men -= sick; c._sick += sick; }
    // Soldiers who are not paid go home: the army shrinks toward what the budget can keep.
    if (got < .85) { const left = u.men * clamp((.85 - got) * .35, 0, .3); u.men -= left; gone += left; }
    u.equip = clamp(u.equip + (c.stock.arms > 0 ? .02 : -.05) * (got > .6 ? 1 : .3), .2, 1.4);
    { const s = supplyOf(w, u); if (!s.linked) { u.men *= .92; u.morale = clamp(u.morale - 6, 0, 100); } else if (s.depth > 4.5) { u.men *= .98; u.morale = clamp(u.morale - 2, 0, 100); } }
    // Loyalty settles where pay and the government's standing put it, around the bond the unit already had; a shock fades, it does not add up for ever.
    // A regiment raised among a people the law bears down on, or sent to fight that people's own nation, has that much less faith in the state.
    const pull = (got - .85) * 40 - c.arrears * 6 + (c.legitimacy - 50) * .25 - originPull(w, c, u);
    u.bond ??= u.loyalty - pull;
    u.loyalty = clamp(u.loyalty + (clamp(u.bond + pull, 0, 100) - u.loyalty) * .12, 0, 100);
  }
  if (c._sick > 0) c.warExhaustion = clamp(c.warExhaustion + c._sick / Math.max(c._pop || 10000, 1) * 2500, 0, 100);
  // And home is where they arrive: back among the working people of their own provinces, not out of the world.
  if (gone > 0) goHome(countryProvinces(w, c.id).filter(p => p.owner === c.id), gone);
}

// An offensive. Units sent against one objective under one order form up in the provinces beside it and go in together: all of them once the
// last is up, or whatever is there once the staff has waited three quarters for the rest. Columns that start from different provinces come at
// the defender from more than one side, which is worth a good deal if they arrive together and nothing if they do not: every column but the
// strongest has to keep a timetable drawn up far away, and how well it keeps it is its commander's doing (and the wireless's, where there is
// one). A column that is late goes in the quarter after, alone.
const READY = 2, PATIENCE = 3;
export const MANNERS = ['assault', 'probe', 'all_out', 'siege'];
function launch(w) {
  const groups = {}, engaged = u => Object.values(w.units).some(x => x.province === u.province && fighting(w, x.country, u.country));
  for (const u of Object.values(w.units)) {
    if (!u.attack) continue;
    const to = w.provinces[u.attack.to];
    // An objective that is no longer the enemy's needs no attack, and a unit sent elsewhere since is no longer part of one: the order lapses.
    // A unit already inside its objective is still fighting for it.
    if (!to || !fighting(w, u.country, to.controller)) { delete u.attack; continue; }
    if (u.province === to.id) continue;
    if (u.target !== to.id) { delete u.attack; continue; }
    (groups[`${u.country}|${to.id}`] ||= []).push(u);
  }
  for (const us of Object.values(groups)) {
    const to = w.provinces[us[0].attack.to], hold = (xs, why) => { for (const u of xs) u.march = { turn: w.turn, from: u.province, to: to.id, provinces: 0, held: why, reached: u.province }; };
    const up = us.filter(u => to.neighbors.includes(u.province) && u.shipped !== w.turn && !engaged(u));
    // Time spent formed up beside the objective is time to bring shells forward, register the guns and study the ground.
    for (const u of up) u.attack.ready = (u.attack.ready ?? -1) + 1;
    if (!up.length) continue;
    // What the other staff sees of it. Troops massing beside a frontier are seen sooner or later, the sooner the better that staff's knowledge of
    // its neighbour, with cavalry of its own out in front, or with aircraft; a screen of the attacker's own horse hides them longer. An attack that
    // goes in before it has been seen falls as a surprise.
    const foe = w.countries[to.controller], chief = commanderOf(w, [...up].sort((a, b) => b.men - a.men)[0]), horse = (id, ps) => Object.values(w.units).some(x => x.country === id && x.kind === 'cavalry' && ps.includes(x.province));
    const sight = clamp(.3 + (foe?.intel?.[us[0].country] ?? 15) / 150 + (horse(foe?.id, [to.id, ...to.neighbors]) ? .2 : 0) + (foe && hasTech(foe, 'aviation') ? .15 : 0) - (horse(us[0].country, up.map(u => u.province)) ? .15 : 0) - ((chief?.skill ?? 1) - 1) * .3, .1, .95);
    const spot = k => { if (us.some(u => u.attack.seen != null)) return true; if (!foe?.alive || rand(w) >= sight * k) return false; for (const u of us) u.attack.seen = w.turn;
      mark(w, foe, `Enemy troops are forming up opposite ${to.name}: about ${about(sum(up, u => u.men))} thousand in ${[...new Set(up.map(u => w.provinces[u.province].name))].join(' and ')}. The staff takes it for an attack in preparation.`); return true; };
    if (w.turn < Math.max(...us.map(u => u.attack.start ?? 0))) { hold(up, 'it has formed up for the attack, which is set for a later quarter'); spot(1); continue; }
    if (closedNow(w, to)) { hold(up, `${season(w) === 'winter' ? 'snow' : 'mud'} closes ${to.name} this season: the attack waits`); spot(1); continue; }
    if (up.length < us.length && us.some(u => u.attack.wait !== false) && w.turn < Math.min(...us.map(u => u.attack.since ?? w.turn)) + PATIENCE) { hold(up, 'it has formed up for the attack and waits for the columns that are not yet up'); spot(1); continue; }
    const seen = spot(.6);
    const cols = Object.values(up.reduce((a, u) => ((a[u.province] ||= []).push(u), a), {})).sort((a, b) => sum(b, u => u.men) - sum(a, u => u.men));
    cols.forEach((col, i) => {
      const lead = commanderOf(w, [...col].sort((a, b) => b.men - a.men)[0]), c = w.countries[col[0].country];
      const late = i > 0 && !col.some(u => u.attack.late != null) && rand(w) > clamp(.45 + ((lead?.skill ?? 1) - .75) * .7 + (hasTech(c, 'radio') ? .15 : 0) + (planEdge(w, c.id, to.controller) > 0 ? .2 : 0), .2, 1);
      if (late) { for (const u of col) { u.attack.late = w.turn; u.attack.wait = false; } hold(col, `it was not up in time for the attack on ${to.name}${lead ? ` (${lead.name} commands the column)` : ''} and goes in next quarter`); return; }
      for (const u of col) { u.from = u.province; u.province = to.id; u.target = null; u.dug = 0; u.attack.go = w.turn; u.attack.surprise = !seen; u.march = { turn: w.turn, from: u.from, to: to.id, provinces: 1, held: '', reached: to.id }; }
    });
  }
}

const holds0 = (w, p, owners) => owners.includes(p.controller);
// An army handed over with a state has its cavalry: about one man in twenty rides, in a body of its own beside the largest formation.
export function outfitArmies(w) {
  for (const c of aliveCountries(w)) { const big = Object.values(w.units).filter(u => u.country === c.id && u.kind === 'infantry').sort((a, b) => b.men - a.men)[0]; if (!big || big.men < 40) continue;
    const n = Math.round(big.men * .05), h = makeUnit(w, c.id, big.province, n, big.quality, big.loyalty, 'cavalry'); h.morale = big.morale; h.equip = big.equip; big.men -= n; }
}
// A plan of campaign drawn up in peace. A staff that has one ready against the enemy it now fights opens the war by a timetable: for the first
// three quarters its columns keep time better and its attacks go in as prepared. A plan is a paper, and a paper can be copied: if the enemy
// holds the plan that is being carried out against him, he is waiting where the blow falls.
export function planEdge(w, id, foe) {
  const c = w.countries[id], plan = c?.plans?.[foe], war = w.wars.find(x => x.active && ((x.a.includes(id) && x.b.includes(foe)) || (x.b.includes(id) && x.a.includes(foe))));
  if (!plan || plan.ready > w.turn || !war || w.turn - Math.max(war.start, plan.ready) >= 3) return 0;
  const copy = w.countries[foe]?.stolen?.[id]; return copy && copy.against === foe && copy.turn >= plan.since ? -1 : 1;
}
// What a quarter's fighting burns, in the arsenal's own measure, for every thousand men who come into action: a reconnaissance little, an
// assault a great deal, an attack pressed regardless of loss more still; men who hold a line fire less than men who must carry one; guns fire
// three times what rifles do, and a bombardment ordered before the attack is paid for on top of all of it.
const RATE = { probe: .012, assault: .05, all_out: .065, siege: .006 }, RATE_DEF = .03, SHELLING = .6, FIELD_GUNS = .012;
// What an attack by these troops would ask of the arsenal, for the staff that plans it.
export const shellsFor = (us, manner = 'assault', shelling = false) => sum(us, u => u.men * (RATE[manner] ?? RATE.assault) * (u.kind === 'artillery' ? 3 : 1) + (shelling ? u.men * (u.kind === 'artillery' ? 1 : FIELD_GUNS) * SHELLING : 0));
export const abilityWord = ch => (ch?.skill ?? 1) >= 1.15 ? 'able' : (ch?.skill ?? 1) >= .95 ? 'competent' : 'a poor hand';
const about = v => v >= 20 ? Math.round(v / 5) * 5 : v >= 2 ? Math.round(v) : Math.round(v * 10) / 10;
// Two bodies of the same arm made one: as good, as loyal and as well armed as its men were on average. The reservists among them are still
// reservists (u.calledMen where the body is not wholly of them), so that they can be sent home again from the regiment they were put into.
export const calledIn = u => u.called ? u.men : Math.min(u.calledMen || 0, u.men);
export function joinUnits(w, a, b) {
  const n = a.men + b.men, res = calledIn(a) + calledIn(b);
  for (const k of ['quality', 'morale', 'equip', 'loyalty', 'bond']) if (a[k] != null || b[k] != null) b[k] = ((a[k] ?? b[k]) * a.men + (b[k] ?? a[k]) * b.men) / n;
  b.men = n; b.dug = Math.min(a.dug || 0, b.dug || 0);
  // Men just called keep the day of their calling when they join another body (their cheaper first quarters go with them).
  if (a.calledAt != null && calledIn(a) > 0) b.calledAt = Math.max(b.calledAt ?? -99, a.calledAt);
  if (res >= n - .05) { b.called = true; delete b.calledMen; } else { delete b.called; if (res > .05) b.calledMen = res; else delete b.calledMen; }
  // Where it went is kept for a while, so that an order still addressed to it can say what became of it (ops.js applyOp).
  (w.joined ||= {})[a.id] = { into: b.id, at: b.province, t: w.turn }; { const ks = Object.keys(w.joined); if (ks.length > 120) for (const k of ks.slice(0, ks.length - 120)) delete w.joined[k]; }
  delete w.units[a.id]; return n;
}
const mark = (w, c, text) => { for (const ch of [w.characters[c.leader], w.characters[c.general]]) if (ch?.alive) ch.inbox.push({ turn: w.turn, from: 'General Staff', text }); };

// A fortress laid under siege and not stormed (offensive with manner siege). The besiegers shut the place in if they are half again as many as
// the men inside and eight thousand for each grade of the works; nobody assaults. Shut in, the garrison lives on what is in the place: it is fed
// less each quarter and its spirit sinks; heavy guns wear the works down and their shells come out of the arsenal; the besiegers sicken in
// their lines (upkeep). The place falls when its works are down or the garrison's spirit is gone, and its men are prisoners; or it is stormed
// (an assault ordered on it), relieved (troops of the defender coming in from outside fight the besiegers in the open) or left by a garrison
// that breaks out (militaryStep, the march). (World 23: a ruler and her chief of staff both ordered "invest Terento, shell the works, do not
// storm until I say"; the engine knew no attack that was not a storm, and 146 thousand men stood idle beside a fortress held by 52. The user
// approved the rule and its sentence, 2026-11-13.)
export const SIEGE = { odds: 1.5, perGrade: 8, down: .25, broken: 20 };
export const worksWord = f => f >= .85 ? 'whole' : f >= .6 ? 'battered' : f > SIEGE.down ? 'breached in places' : 'in ruins';
const lasts = (p, D, wear) => { let f = p.fort || 0, m = sum(D, u => u.morale * u.men) / Math.max(sum(D, u => u.men), 1e-9), t = p.siege?.turns ?? 0, n = 0; while (n < 24 && f > SIEGE.down && m >= SIEGE.broken) { t++; n++; f -= wear; m -= 4 + 3 * t; } return n; };
function besiege(w, p, A, D, by, defCountry) {
  const men = xs => sum(xs, u => u.men), c = w.countries[by], d = w.countries[defCountry], grade = Math.max(1, Math.ceil(p.fort || 0)), on = !!p.siege?.shut && p.siege.by === by;
  const menA = men(A), menD = men(D), need = Math.max(menD * SIEGE.odds, SIEGE.perGrade * grade);
  if (menA < need - .05) {
    // Too few to close every road: they draw off to where they came from, and the place stays open.
    const went = new Set(); for (const u of A) { u.men *= .99; const back = u.from && w.provinces[u.from] && u.from !== p.id && mayStand(w, u.country, u.from) ? u.from : wayBack(w, u, p.id); if (back) { u.province = back; went.add(w.provinces[back].name); } u.target = null; delete u.attack; }
    for (const u of D) { u.men *= .995; delete u.shutIn; } if (p.siege?.by === by) delete p.siege;
    mark(w, c, `${on ? `The siege of ${p.name} is raised` : `The troops sent to lay siege to ${p.name} could not shut it in`}: about ${about(menD)} thousand hold it, and it takes about ${about(need)} thousand to close every road (half again as many as the men inside, and no fewer than ${SIEGE.perGrade} thousand for each grade of its works); we have ${about(menA)} thousand there. They have drawn off${went.size ? ` to ${[...went].join(', ')}` : ''}.`);
    mark(w, d, `${on ? `The siege of ${p.name} is raised: the enemy has no longer men enough before it to shut it in, and has drawn off` : `The enemy came before ${p.name} with about ${about(menA)} thousand men to lay siege to it, too few to shut it in, and drew off`}.`);
    news(w, `${on ? `The siege of ${p.name} was raised.` : `${c.name} came before the fortress at ${p.name} and could not shut it in.`}`, { kind: 'war', countries: [by, defCountry], province: p.id });
    return;
  }
  p.siege = { by, turns: (on ? p.siege.turns : 0) + 1, shut: true, since: on ? p.siege.since : w.turn }; const t = p.siege.turns; for (const u of D) u.shutIn = p.id; for (const u of A) { u.target = null; u.attack = { ...(u.attack || {}), to: p.id, manner: 'siege', shelling: A.some(x => x.attack?.shelling), go: u.attack?.go ?? w.turn }; }
  if (!on) { for (const u of A) u.men *= .985; for (const u of D) u.men *= .99; markFought(w, by, defCountry); news(w, `${c.name} laid siege to the fortress at ${p.name}: about ${about(menA)} thousand men have shut it in.`, { kind: 'war', countries: [by, defCountry], province: p.id }); }
  // The guns: heavy pieces tell against masonry, the field guns barely; what they fire comes out of the arsenal, under the reserve and the ceiling
  // the staff has set, as for any bombardment.
  const shelling = A.some(u => u.attack?.shelling), heavy = men(A.filter(u => u.kind === 'artillery')), light = (menA - heavy) * FIELD_GUNS; let fire = 0, shot = 0;
  { const want = menA * RATE.siege + (shelling ? (heavy + light) * SHELLING : 0), have = Math.max(c.stock.arms || 0, 0), kept = Math.min(have, c.arsenalReserve || 0), cap = Math.min(Infinity, ...A.filter(u => u.attack?.shells > 0).map(u => u.attack.shells)); shot = Math.max(0, Math.min(want, have - kept, cap)); fire = want > 0 ? shot / want : 1; c.stock.arms = have - shot; c._shot = (c._shot || 0) + shot; }
  const wear = shelling ? (Math.min(.35, heavy / 40) + Math.min(.03, light / 40)) * fire : 0, was = p.fort || 0; p.fort = Math.max(0, was - wear);
  // The garrison: short commons, then hunger; and what the guns do to men who cannot get away from them.
  const under = shelling ? clamp((heavy + light) / Math.max(menD, 1e-9) * .12 * fire, 0, .04) : 0; let lost = 0;
  for (const u of D) { const gone = u.men * (.006 * t + under); u.men -= gone; lost += gone; u.morale = clamp(u.morale - (4 + 3 * t) - (under > 0 ? 3 : 0), 0, 100); u.equip = clamp((u.equip ?? 1) - .02, .2, 1.4); if (shelling && heavy > 0 && fire > .3) u.dug = Math.max(0, (u.dug || 0) - 1); }
  for (const k of CLASSES) p.pops[k].n *= .996;
  const left = D.filter(u => u.men >= .2), heart = left.length ? sum(left, u => u.morale * u.men) / men(left) : 0, fallen = !left.length || p.fort <= SIEGE.down || heart < SIEGE.broken;
  if (fallen) {
    const taken = men(left), held = c.captives ||= {}; held[defCountry] = (held[defCountry] || 0) + taken; d.warExhaustion = clamp(d.warExhaustion + taken / Math.max(d._pop || 10000, 1) * 2500, 0, 100);
    for (const u of D) delete w.units[u.id]; for (const u of A) delete u.attack; delete p.siege; const why = p.fort <= SIEGE.down ? 'its works were in ruins' : 'its garrison could hold out no longer';
    capture(w, p, by);
    news(w, `The fortress at ${p.name} has fallen to ${c.name} after a siege of ${t} quarter${t > 1 ? 's' : ''}: ${why}, and about ${about(taken)} thousand men laid down their arms.`, { kind: 'war', countries: [by, defCountry], province: p.id });
    mark(w, c, `${p.name} has fallen after a siege of ${t} quarter${t > 1 ? 's' : ''}: ${why}. About ${about(taken)} thousand of the garrison are our prisoners, and the place is in our hands.${shot > .05 ? ` The siege fired ${Math.round(shot * 10) / 10} of ammunition this quarter; the arsenal holds ${Math.round(c.stock.arms)}.` : ''}`);
    mark(w, d, `${p.name} has fallen: ${why} after ${t} quarter${t > 1 ? 's' : ''} shut in, and the garrison, about ${about(taken)} thousand men, has laid down its arms. They are prisoners until a peace sends them home.`);
    w.battles.push({ province: p.id, attacker: by, defender: defCountry, attackerWon: true, lossA: 0, lossD: Math.round(lost), prisoners: Math.round(taken), manner: 'siege', why: [] });
    return;
  }
  const more = lasts(p, left, wear), gunsText = shelling ? (heavy > 0 ? `The siege guns are wearing the works down: they are ${worksWord(p.fort)}${fire < .95 ? `; the arsenal sent only ${Math.round(fire * 100)} in the hundred of the shells the guns called for` : ''}` : 'The field guns that march with the infantry barely scratch the works: heavy pieces (artillery units) are wanted for that') : 'No bombardment is ordered: the works stand as they were, and the place is only being starved';
  mark(w, c, `The siege of ${p.name}, ${t} quarter${t > 1 ? 's' : ''} in: about ${about(men(left))} thousand are shut in by our ${about(men(A))} thousand. ${gunsText}. It took ${Math.round(shot * 10) / 10} of ammunition this quarter (the arsenal holds ${Math.round(c.stock.arms)}). By the staff's reckoning the place holds about ${more} quarter${more === 1 ? '' : 's'} more as things go; it falls sooner if it is stormed once weakened (offensive with manner assault), and the siege is raised if we are driven off or thin out below what shuts it in.`);
  mark(w, d, `${p.name} is shut in by about ${about(men(A))} thousand of the enemy, ${t} quarter${t > 1 ? 's' : ''} now. The garrison, ${Math.round(men(left) * 10) / 10} thousand, lives on what is in the place: its spirit stands at ${Math.round(heart)} of 100 and sinks each quarter, and it lost about ${Math.round(lost * 10) / 10} thousand this quarter to hunger, sickness${under > 0 ? ' and their guns' : ''}. The works are ${worksWord(p.fort)}. By the staff's reckoning it holds about ${more} quarter${more === 1 ? '' : 's'} more. It is relieved if troops sent there from outside (move) beat the besiegers in the open; a garrison ordered out (move) breaks through their lines with loss and leaves the place to them.`);
}
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
  // A siege is not a battle: the place is shut in and nobody storms it. If troops of the defender have come in from outside since it was shut,
  // it is a battle after all, in the open before the works, and the walls help nobody.
  // The same holds for a fortress that is invested without being shut in: one whose field was lost, whose defenders were driven off, and
  // before which the victor lies while it holds out (the investment, in militaryStep). Whoever marches up to it then comes from outside.
  // (World 26, second review: Tirara won the field at Brunmarka and invested the fortress; the next quarter ruler and chief of staff both
  // ordered "hold the investment until it falls, no assault", which was entered as a siege, while Hazland marched 110 thousand men up to relieve
  // it. The relieving army was counted as the garrison, the besiegers were found too few to shut in 110 thousand, and 94 thousand men who
  // had won the field drew off without a shot: "the troops sent to lay siege to Brunmarka could not shut it in".)
  // (At Brunmarka the defenders beaten in the field had fallen back into the place, so that no investment was written on it; what tells is
  // who was there first: besiegers who stood before the place when the quarter began are met by whoever marches up to it.)
  { const sieging = A.filter(u => u.attack?.to === pid && u.attack.manner === 'siege'), came = u => u.march?.turn === w.turn && u.march.reached === pid && u.march.from !== pid, stood = sum(A.filter(u => !came(u) && u.shipped !== w.turn), u => u.men) >= sum(A, u => u.men) * .5,
      before = (p.siege?.by === atkSide[0] || (stood && sieging.length > 0)) && holds && defSide.includes(p.controller);
    // (Only troops that came in this quarter by road or by sea are a relieving force; whatever else stands inside is garrison.)
    const relief = before ? D.filter(u => u.shutIn !== pid && ((u.march?.turn === w.turn && u.march.reached === pid && u.march.from !== pid) || u.shipped === w.turn)) : [];
    if (!(sieging.length && sum(sieging, u => u.men) >= sum(A, u => u.men) * .5) && relief.length && p.siege && !p.siege.shut && relief.length === D.length) { holds = false; const n = sum(relief, u => u.men);
      mark(w, w.countries[atkSide[0]], `A relieving force of about ${about(n)} thousand has come up to ${p.name}, which we have invested: it has to be fought in the open before the place, which the staff reports below as the fight for ${p.name}.`);
      mark(w, w.countries[defCountry], `Our relieving force, about ${Math.round(n * 10) / 10} thousand, has come up to ${p.name} and fights the enemy who lies before the fortress in the open; the works help neither side in such a fight.`); }
    if (sieging.length && sum(sieging, u => u.men) >= sum(A, u => u.men) * .5 && holds && defSide.includes(p.controller)) {
      if (!relief.length) { besiege(w, p, A, D, atkSide[0], defCountry); return; }
      holds = false; for (const u of sieging) u.attack.manner = 'assault'; const n = sum(relief, u => u.men);
      mark(w, w.countries[atkSide[0]], `A relieving force of about ${about(n)} thousand has come up to ${p.name} against our siege lines: the siege has become a battle in the open before the place, which the staff reports below as the fight for ${p.name}.`);
      mark(w, w.countries[defCountry], `Our relieving force, about ${Math.round(n * 10) / 10} thousand, has come up to ${p.name} and fights the besiegers in the open before the place, together with the garrison; the works help neither side in such a fight.`); } }
  const pass = w.strategic.find(s => s.ref === pid && s.type === 'pass'), bridge = !pass && w.strategic.find(s => s.ref === pid && s.type === 'bridge'), point = 1;
  // A river is a line to hold: whoever must cross it under fire pays for it, except when it is frozen.
  // (A named pass or crossing used to be worth half as much again to its defender, whatever the ground: its worth is now the hills, the
  // river and the fortress that stand there, and the trade that goes over it.)
  const river = holds0(w, p, owners) && (p.river || 0) >= .3 && season(w) !== 'winter' ? 1 + Math.min(.2, p.river * .25) : 1;
  const natural = TERRAIN_DEF[p.terrain] * (1 + p.infra * .08) * point * river, built = holds ? 1 + (p.fort || 0) * .3 + (p.trench || 0) * .15 : 1, men = xs => sum(xs, u => u.men);
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
  // How much an attack may draw is the staff's to say: a reserve in the arsenal that no attack touches (set_arsenal_reserve; the defence of the
  // country and a call-up still draw on it), and a ceiling on what one operation may burn in a quarter (offensive with shells).
  const stint = {};
  for (const [id, x] of Object.entries(want)) { const c = w.countries[id], have = Math.max(c.stock.arms || 0, 0), attacking = atkSide.includes(id), kept = attacking ? Math.min(have, c.arsenalReserve || 0) : 0, cap = attacking ? Math.min(Infinity, ...A.filter(u => u.country === id && u.attack?.to === pid && u.attack.shells > 0).map(u => u.attack.shells)) : Infinity, got = Math.max(0, Math.min(x, have - kept, cap));
    if (got < x - 1e-9) stint[id] = cap <= have - kept ? { why: 'ceiling', n: cap } : kept > 0 && have - kept < x ? { why: 'reserve', n: kept } : { why: 'empty' };
    c.stock.arms = have - got; c._shot = (c._shot || 0) + got; shot[id] = got; fire[id] = x > 0 ? got / x : 1; }
  // A bombardment knocks in field works in the measure of the guns brought against the men behind them; the field guns that march with the
  // infantry count for little at this, the heavy pieces of the artillery for much. Masonry and concrete yield only to the heavy pieces.
  const weight = sum(A, guns), shelled = weight > 0 ? sum(A, u => guns(u) * fire[u.country]) / weight : 0, heavy = sum(A.filter(u => u.kind === 'artillery'), guns);
  const breach = weight > 0 ? clamp(weight / Math.max(menD * .15, 1e-9), 0, 1) * .6 * shelled : 0, breachFort = heavy > 0 && p.fort >= 1 ? clamp(heavy / (8 * Math.ceil(p.fort)), 0, 1) * .5 * shelled : 0;
  const works = holds ? 1 + (p.fort || 0) * .3 * (1 - breachFort) + (p.trench || 0) * .15 * (1 - breach) : 1, terrain = natural * works;
  // An army that follows a plan the enemy holds surprises nobody.
  // An attack nobody saw forming up falls as a surprise, unless its own guns have spent days saying where it will fall.
  const paper = planned.length ? planEdge(w, atkSide[0], defCountry) : 0, unseen = paper >= 0 && planned.length > 0 && men(planned) >= menA * .5 && planned.every(u => u.attack.surprise), surprise = unseen && !(weight > 0);
  const plan = (1 + .07 * ready) * (manner === 'all_out' ? 1.1 : 1) * (1 + .18 * flank) * (surprise && paper >= 0 ? 1.12 : 1) * (paper > 0 ? 1.08 : paper < 0 ? .9 : 1), luckD = between(w, .85, 1.15), luckA = between(w, .85, 1.15);
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
  const led = xs => avg(xs, u => leadOf(commanderOf(w, u))), heart = xs => avg(xs, u => u.morale), kit = xs => avg(xs, u => u.equip * u.quality * w.countries[u.country].tech.mil), shells = xs => avg(xs, u => .55 + .45 * (fire[u.country] ?? 1));
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
  // In open country a victor with horsemen rides down what runs.
  const winners = atkWins ? A : D, ridden = !probe && ['plains', 'desert', 'hills'].includes(p.terrain) && men(winners.filter(u => u.kind === 'cavalry')) >= men(winners) * .04 ? .06 : 0;
  let taken = 0, stood = 0; const went = {};
  for (const u of loser) {
    // Not one step back, or an attack that is to be pressed whatever it costs: beaten but not broken, the unit is still on the field next quarter,
    // and the ground stays with whoever held it. It breaks when its spirit does.
    const pressing = !atkWins && press && u.attack?.to === pid;
    if (pressing) { u.morale = clamp(u.morale - lossA * 20, 0, 100); if (lossA > .1) u.loyalty = clamp(u.loyalty - 2, 0, 100); }
    if ((u.posture === 'no_retreat' || pressing) && u.morale > 15 && u.men >= .2) { stood += u.men; continue; }
    const back = wayBack(w, u, pid);
    const order = clamp(1 + (winGen?.skill ?? 1) - (commanderOf(w, u)?.skill ?? 1), .5, 1.6), caught = u.men * (back ? clamp(((odds - 2) * .1 + (atkWins ? flank * .06 : 0) + ridden) * order, 0, .4) : .4);
    if (back) { u.province = back; u.target = null; (went[u.country] ||= new Set()).add(w.provinces[back].name); } else u.morale *= .4;
    if (caught > 0) { u.men -= caught; taken += caught; const held = victor.captives ||= {}; held[u.country] = (held[u.country] || 0) + caught; const home = w.countries[u.country]; home.warExhaustion = clamp(home.warExhaustion + caught / Math.max(home._pop || 10000, 1) * 2500, 0, 100); }
  }
  // A reconnaissance goes back where it came from with what it has learned.
  if (probe) for (const u of A) { const back = u.from && w.provinces[u.from] && mayStand(w, u.country, u.from) ? u.from : wayBack(w, u, pid); if (back) { u.province = back; (went[u.country] ||= new Set()).add(w.provinces[back].name); } u.target = null; }
  // Men who have been under fire and come through it are better soldiers; a unit shot to pieces has lost the men who made it one.
  if (!probe) for (const [xs, loss] of [[D, lossD], [A, lossA]]) for (const u of xs) u.quality = clamp(u.quality + (loss < .3 ? .03 : -.03), .6, 1.35);
  for (const u of A) if (u.attack) u.attack.surprise = false;
  const late = Object.values(w.units).filter(u => u.attack?.to === pid && u.attack.late === w.turn && atkSide.includes(u.country));
  for (const u of A) if (u.attack?.to === pid && !(press && !atkWins && u.province === pid)) delete u.attack;
  const head = probe ? `Reconnaissance in force at ${p.name}: ${w.countries[atkSide[0]].name} felt out the defences and drew off.` : `Battle of ${p.name}: ${atkWins ? w.countries[atkSide[0]].name : w.countries[defCountry].name} prevailed.`;
  news(w, `${head} Losses: attacker ${Math.round(da)}k, defender ${Math.round(dd)}k.${taken >= .5 ? ` About ${Math.round(taken)} thousand of the beaten side were taken prisoner.` : ''}${stood >= .5 ? ` About ${Math.round(stood)} thousand of the beaten side did not leave the field.` : ''}`, { kind: 'war', countries: [...atkSide, ...defSide], province: pid });
  // Each staff's own account of the day, for whoever gave the orders: its own figures as counted, the enemy's as estimated, and what told.
  const ground = `the ${p.terrain === 'hills' ? 'hills' : p.terrain === 'mountain' ? 'mountains' : p.terrain} of ${p.name}${pass ? ', a pass' : bridge ? ', a river crossing' : river > 1 ? ', behind its river' : ''}`;
  const worksText = [p.fort >= 1 && holds ? `a fortress of the ${['first', 'second', 'third'][Math.ceil(p.fort) - 1] ?? 'third'} order` : '', p.trench && holds ? `${p.trench > 1 ? 'two lines' : 'a line'} of prepared field works` : '', deepest >= 1 ? `trenches the troops had dug themselves over ${deepest >= 4 ? 'many months' : deepest >= 2 ? 'some months' : 'a few weeks'}` : ''].filter(Boolean).join(', ');
  // Whoever attacked a place and did not take it has seen what holds it: the men, and the works they stand in. The staff keeps that for a while.
  if (p.controller !== atkSide[0] || !atkWins) for (const id of atkSide) { const k = w.countries[id]; if (!k?.alive) continue; const book = (k.scouted ||= {}); for (const x of Object.keys(book)) if (w.turn - book[x].turn > 6) delete book[x];
    book[pid] = { turn: w.turn, men: men(D), works: worksText, holder: defCountry }; }
  const because = (key, us, mine, theirs) => {
    const lostIt = (told[key] > 1) !== (us === 'A'), pc = v => Math.round(v * 100);
    if (key === 'numbers') { const crowd = us === 'A' ? crowdA : crowdD, n = us === 'A' ? wasA : wasD; return lostIt ? (crowd < .9 && n > (us === 'A' ? wasD : wasA) ? `the ground let only about ${about(n * crowd)} thousand of our ${about(n)} thousand come into action at once` : 'they had more men in action than we did') : 'we had more men in action than they did'; }
    if (key === 'ground') return p.terrain === 'plains' && !pass && !bridge && river === 1 ? (us === 'A' ? 'they stood on the defensive and we had to come at them over open ground' : 'we stood on the defensive and they had to come at us over open ground') : us === 'A' ? `${ground} fight for whoever holds them` : `${ground} fought for us`;
    if (key === 'works') return us === 'A' ? `they fought from works (${worksText || 'what they had dug'})${weight > 0 ? `; our bombardment knocked in about ${pc(breach)} in the hundred of the field works${p.fort >= 1 && holds ? ` and ${pc(breachFort)} of the fortress` : ''}` : ', and we went in without a bombardment'}` : `we fought from our works (${worksText || 'what we had dug'})${weight > 0 ? `, though their guns knocked in about ${pc(breach)} in the hundred of the field works${p.fort >= 1 && holds ? ` and ${pc(breachFort)} of the fortress` : ''}` : ''}`;
    if (key === 'supply') { const s = supplyOf(w, far(lostIt ? mine : theirs)); return lostIt ? (s.linked ? `our troops were ${Math.round(s.depth * 10) / 10} marches of wagon road from their supply head at ${w.provinces[s.head]?.name} and short of everything` : 'our troops were cut off from supply altogether') : s.linked ? 'their troops were far from their railhead and ill supplied' : 'their troops were cut off from their supplies'; }
    if (key === 'shells') { const id = mine[0].country, s = stint[id]; return lostIt ? (s?.why === 'ceiling' ? `the attack was held to the ${Math.round(s.n * 10) / 10} of ammunition allowed it, ${pc(fire[id] ?? 1)} in the hundred of what the fight called for` : s?.why === 'reserve' ? `the reserve of ${Math.round(s.n)} kept back in the arsenal was not touched, and the attack got ${pc(fire[id] ?? 1)} in the hundred of the cartridges and shells it called for` : `the arsenal could send only ${pc(fire[id] ?? 1)} in the hundred of the cartridges and shells the fight called for`) : 'their fire slackened as the fight went on: they are short of shells'; }
    if (key === 'command') return lostIt ? 'they were the better led' : 'we were the better led';
    if (key === 'spirit') return lostIt ? 'our men went in with less heart than theirs' : 'our men were in better heart than theirs';
    if (key === 'arms') return lostIt ? 'they were the better armed and trained' : 'we were the better armed and trained';
    if (key === 'plan') return us === 'A' ? [flank ? `our columns came at them from ${flank + 1} sides together` : '', ready >= .5 ? 'the attack had been prepared' : '', surprise && paper >= 0 ? 'it fell on them as a surprise' : '', paper > 0 ? 'the opening moves followed a plan long prepared' : paper < 0 ? 'they knew our plan of campaign and were waiting where we came' : '', press ? 'the attack was pressed regardless of loss' : ''].filter(Boolean).join(', and ') : [flank ? `they came at us from ${flank + 1} sides together` : '', ready >= .5 ? 'their attack had plainly been long prepared' : '', surprise && paper >= 0 ? 'it took us by surprise: nothing had been seen of their preparations' : '', paper > 0 ? 'they opened by a plan long prepared' : paper < 0 ? 'we held their plan of campaign and were waiting where they came' : '', press ? 'they pressed it regardless of loss' : ''].filter(Boolean).join(', and ');
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
      // A fortress is not carried with the field before it: it is invested, and holds for a while (the siege, in militaryStep). Both staffs say so.
      // (World 21: the staff called a fortress "lost" the quarter its field was lost; the ruler ordered it stormed back and was told it was his own.)
      const invested = atkWins && !probe && (p.fort || 0) >= 1 ? Math.max(1, Math.ceil(p.fort) + 1 - ((p.siege?.by === atkSide[0] ? p.siege.turns : 0) + 1)) : 0;
      const lateText = us === 'A' && late.some(u => u.country === id) ? ` The column of ${[...new Set(late.filter(u => u.country === id).map(u => u.id))].join(', ')} was not up in time and took no part; it goes in next quarter unless ordered otherwise.` : '';
      mark(w, c, `${probe ? (us === 'A' ? `Our reconnaissance in force at ${p.name}` : `An enemy reconnaissance in force against ${p.name} was beaten off`) : us === 'A' ? `Our attack on ${p.name} ${won ? (invested ? `won the field, and the fortress is invested: it has not fallen, and falls in about ${invested} quarter${invested > 1 ? 's' : ''} if we stay before it and are not driven off` : 'carried the place') : 'failed'}` : `${won ? `${p.name} was attacked and held` : invested ? `The field at ${p.name} is lost and our troops are driven off; the fortress still holds and is invested: it falls in about ${invested} quarter${invested > 1 ? 's' : ''} unless troops sent there (move) break the investment` : `${p.name} was attacked and lost`}`}. We had ${about(my.was)} thousand men there and lost ${Math.round(my.dead * 10) / 10} thousand${!won && taken >= .5 && !probe ? `, besides about ${about(taken)} thousand taken prisoner` : ''}; they had about ${about(their.was)} thousand and their loss is put at about ${about(their.dead)} thousand${won && taken >= .5 ? `, besides about ${about(taken)} thousand prisoners in our hands` : ''}.${found}${reasons.length ? ` What ${probe ? 'the fighting showed' : won ? 'told for us' : 'told against us'}: ${reasons.join('; ')}.` : ''}${lateText}${us === 'A' && unseen && weight > 0 ? ' Nothing had been seen of our preparations, but the bombardment gave them warning: there was no surprise.' : ''}${paper < 0 ? (us === 'A' ? ' Their dispositions show that they knew our plan of campaign. Until a new one is drawn up (prepare_plan) the army cannot count on its own.' : ' Their attack came where the copy of their plan in our hands said it would.') : ''} The fight used ${Math.round((shot[id] || 0) * 10) / 10} of arms and ammunition; ${Math.round(c.stock.arms || 0)} remain in the arsenal.${stint[id]?.why === 'ceiling' ? ` The attack was held to the ${Math.round(stint[id].n * 10) / 10} of ammunition allowed it, about ${Math.round((fire[id] ?? 1) * 100)} in the hundred of what the fight called for.` : stint[id]?.why === 'reserve' ? ` The reserve of ${Math.round(stint[id].n)} kept back in the arsenal was not touched, and the attack got about ${Math.round((fire[id] ?? 1) * 100)} in the hundred of what it called for.` : ''}${to ? ` Our troops ${probe ? 'are back at' : 'fell back to'} ${to}.` : ''}${stayed && !won && !probe ? ` Our troops are still on the field at ${p.name}${us === 'A' && press ? ' under the order to press the attack, and go in again next quarter unless that order is changed' : ', under the order not to give a step'}.` : ''}`);
    }
  }
  if (manner !== 'probe') markFought(w, atkSide[0], defCountry);
  w.battles.push({ province: pid, attacker: atkSide[0], defender: defCountry, attackerWon: atkWins, lossA: Math.round(da), lossD: Math.round(dd), prisoners: Math.round(taken), manner, ...(flank ? { sides: flank + 1 } : {}), ...(surprise ? { surprise: true } : {}), ...(weight > 0 ? { shelled: Math.round(breach * 100), ...(p.fort >= 1 && holds ? { breached: Math.round(breachFort * 100) } : {}) } : {}), why });
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
      loser.reserves -= gold; taker.reserves += gold; goldMoved(loser, 'loot', -gold); goldMoved(taker, 'loot', gold); loser.treasury -= cash; taker.treasury += cash / (loser.rate || 1) * (taker.rate || 1);
    }
    if (nextCap) news(w, `${loser.name} lost its capital; the government withdrew to ${nextCap.name}.`, { kind: 'war', countries: [from], province: nextCap.id });
  }
}
