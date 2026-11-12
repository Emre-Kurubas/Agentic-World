// Nothing is built instantly. Orders are paid when given and finish after a realistic number of quarters.
import { clamp, news, nextId } from './util.js';
import { PLANTS, GOOD_LABEL, makeUnit, makeFleet, aliveCountries, provincePop } from './world.js';
import { restake } from './firms.js';
import { MERCHANT } from './navy.js';
import { groupsOf, statusOf, originPull, gangDiscount } from './culture.js';
import { glutFactor, treasuryPays, creditLeft } from './money.js';
import { BASE_PRICE } from './world.js';

const TURNS = { mine: 3, railway: 4, port: 4, dam: 6, farming: 2, forestry: 2, infrastructure: 2, fort: 5, battery: 4, trench: 2, administration: 3, unit: 1, ship: 3, canal: 12, depot: 1, shipyard: 4 };
const UNIT_TURNS = { infantry: 1, artillery: 2, armor: 2, air: 3, cavalry: 2 }, SHIP_TURNS = { cruiser: 3, battleship: 6, submarine: 3, torpedo: 2, merchant: 3, dreadnought: 7 };
export const DEFENSES = ['fort', 'battery', 'trench'];
export const MAX_DEFENSE = { fort: 3, battery: 3, trench: 2 };
// A forward magazine for the army (military.js supplyLines) and a yard that builds and mends warships (navy.js): two works that came
// of what was asked for and could not be had. (Four staffs in world 18 asked for depots; no yard stood behind any navy.)
export const MAX_DEPOT = 2, MAX_YARD = 2;
export const WORKS = ['mine', 'railway', 'port', 'dam', 'farming', 'forestry', 'infrastructure', 'administration', ...DEFENSES, 'depot', 'shipyard'];

// What a work costs is set by the work and the place, not by the purse that orders it: how many people it has to serve and the ground it stands on.
// Prices are in money of constant value (the caller multiplies by the price level). Works that grow by degrees (a mill, a pit, drained land, roads,
// offices) are priced by the whole step; a railway, a harbour, a dam and a fortress are priced by the piece.
const GROUND = { plains: 1, desert: 1.15, forest: 1.25, hills: 1.45, tundra: 1.6, marsh: 1.6, mountain: 2.3 };
export const ground = p => GROUND[p.terrain] ?? 1.2;
// What a work costs the state is more than what it is worth, by what sticks to hands on the way and by how far the capital's eye reaches.
export const wasteOf = (w, c, p) => w.friction ? 1 + c.corruption / 300 + Math.max(0, .5 - (p.admin ?? .5)) * .6 : 1;
const people = p => Math.max(provincePop(p), 60), hands = p => Math.max(p.base ?? p.pops.workers.n, 15), tillers = p => Math.max(p.pops.peasants.n, 30);
export const MAX_PLANT = 8, MAX_MINE = 4, MAX_INFRA = 1.8, MAX_SEAT = .25;
// One step of a mill or pit has places for as many hands as its province had working people when the world was handed over (p.base), so it costs
// by that number, and takes machinery in the same measure.
export const plantPrice = p => .92 * hands(p), minePrice = p => 1.85 * hands(p), machinesFor = p => hands(p) / 200;
const fertileMax = p => p.fertileMax ?? p.fertility * 1.5, timberMax = p => p.timberMax ?? p.timber * 1.5;

// The engineer's estimate for one kind of work in one province: what it is, its price, what it takes, how much more of it the place can hold, or why it cannot be built.
// Earthworks come cheaper to the state where a gang is held to forced labour: the price the engineers give is that much lower (and says so).
const NAVVY = new Set(['railway', 'port', 'dam', 'fort', 'battery', 'trench', 'infrastructure', 'farming', 'forestry', 'mine']);
export function quote(w, c, p, kind, resource) {
  const q = quoteFree(w, c, p, kind, resource), off = NAVVY.has(kind) && p?.forced?.by === c.id ? gangDiscount(p) : 0;
  if (off > 0 && q && !q.no && q.price > 0) { q.price *= 1 - off; q.forced = off; }
  if (q && !q.no) { const g = gainOf(c, p, kind, resource, q); if (g) Object.assign(q, g); const warn = marketFor(c, kind, resource); if (warn) q.warn = warn; }
  return q;
}
// Draining and terracing a province, or opening its forest, costs about what ten years of the grain or timber it adds would fetch (the
// price is for one whole point of fertility or of timber yield; a province can take half as much again as nature gave it). Whether it pays
// is a question of the market: where the barns are full the grain it adds is not all sold.
const FARMING = 9, FORESTRY = 1.5;
// What the engineers reckon a work adds to what its province turns out in a quarter, at ordinary prices: for the whole measure the price is
// quoted for (one point of roads, of fertility or of yield, one step of a mill or a pit), or the whole of a work that comes in a piece. It is their estimate from what the province turned out last quarter, the same figures
// the work itself will move; for a pit, a mill or new land it holds only if what is raised finds a buyer (sells).
export function gainOf(c, p, kind, resource, q) {
  const out = p.out || 0, r = v => ({ gain: v });
  if (kind === 'railway') return out > 0 ? r(out * .12 / (1 + p.rail * .12)) : null;
  if (kind === 'infrastructure') return out > 0 ? r(out * .36 / (.72 + p.infra * .36)) : null;
  if (kind === 'farming') return p.grewV > 0 && p.fertility > 0 ? { gain: p.grewV / p.fertility, sells: 'grain' } : null;
  if (kind === 'forestry') return p.cutV > 0 && p.timber > 0 ? { gain: p.cutV / p.timber, sells: 'timber' } : null;
  // A pit or a mill makes places, not hands: the hands come from the other works and small trades of the province, which make something
  // where they are. What is gained is the difference (and more only as people leave the land for the town, which takes years).
  const now = Math.max(0, out - (p.grewV || 0) - (p.cutV || 0)) / Math.max(p.pops.workers.n + p.pops.middle.n + p.pops.elite.n * 1.5, 1), net = gross => ({ gain: Math.max(0, gross - hands(p) * now), gross, places: Math.round(hands(p)) });
  if (kind === 'mine') { const d = p.deposits?.[resource]; return d && BASE_PRICE[resource] ? { ...net(hands(p) * d.rich * ({ coal: .3, iron: .22, oil: .12 }[resource] ?? .06) * (c.tech?.ind ?? 1) * BASE_PRICE[resource]), sells: GOOD_LABEL[resource] ?? resource } : null; }
  if (Object.hasOwn(PLANTS, kind)) return { ...net(hands(p) * clamp(.7 + ((p.plants[kind] || 0) + 1) * .35, .7, 3) * 1.25 * (c.tech?.ind ?? 1) * .45), sells: GOOD_LABEL[kind] ?? kind };
  return null;
}
// Whether there is a market for what a new pit or mill would raise: a trade already on short time for want of buyers, or one the country
// cannot yet run. Said with the estimate and with the order; the order is carried out all the same, for it is its giver's to judge.
export function marketFor(c, kind, resource) {
  const tech = t => !!c.techs?.[t], g = kind === 'mine' ? resource : Object.hasOwn(PLANTS, kind) ? kind : null; if (!g) return '';
  if (kind === 'fuel' && !tech('oil_prospecting') && !(c.stock?.oil > 0)) return 'the country raises no oil, holds none and has not learned to look for it: a refinery would stand with nothing to refine';
  if (kind === 'fertilizer' && !tech('chemical_fertilizer')) return 'chemical manure is not yet made or used here: such a works would wait for the chemists, or sell abroad to those who use it';
  const pace = glutFactor(c, g); if (pace < .9) return `the country's ${GOOD_LABEL[g] ?? g} ${kind === 'mine' ? 'pits' : 'works'} are on short time for want of buyers, working at about ${Math.round(pace * 100)} in the hundred of what they could: a new one adds to what lies unsold unless it finds buyers abroad, and until it does it gives work to few`;
  return '';
}
function quoteFree(w, c, p, kind, resource) {
  const tech = t => !!c.techs?.[t];
  if (Object.hasOwn(PLANTS, kind)) return { what: PLANTS[kind].toLowerCase(), price: plantPrice(p), machines: machinesFor(p), room: MAX_PLANT - p.plants[kind], has: p.plants[kind], usual: 1, unit: 'level' };
  if (kind === 'mine') {
    const d = typeof resource === 'string' && Object.hasOwn(p.deposits, resource) ? p.deposits[resource] : null;
    if (!d?.known) return { no: resource === 'timber' ? 'Timber is not mined: it is cut by the country people of a forest province. Logging roads and sawmills (forestry) raise what the forest yields.' : 'No such known deposit here.' };
    return { what: `${GOOD_LABEL[resource]} mine`, price: minePrice(p), machines: machinesFor(p), room: MAX_MINE - d.mine, has: d.mine, usual: 1, unit: 'level' };
  }
  if (kind === 'farming') return { what: 'drainage, wells and terraces', price: FARMING * tillers(p), room: fertileMax(p) - p.fertility, has: p.fertility, usual: .1, unit: 'fertility' };
  if (kind === 'forestry') return p.timber < .2 ? { no: `${p.name} has no forest worth the name.` } : { what: 'logging roads and sawmills', price: FORESTRY * tillers(p), room: timberMax(p) - p.timber, has: p.timber, usual: .2, unit: 'timber yield' };
  if (kind === 'infrastructure') return { what: 'roads, bridges and public works', price: 1.1 * people(p) * Math.sqrt(ground(p)), room: MAX_INFRA - p.infra, has: p.infra, usual: .15, unit: 'infrastructure' };
  if (kind === 'administration') return { what: 'offices, courts and the telegraph', price: 3 * people(p), room: MAX_SEAT - (p.seat || 0), has: p.seat || 0, usual: .06, unit: 'reach' };
  if (kind === 'railway') return p.rail >= 1 && !tech('railway') ? { no: 'Further railway building requires the technology.' } : { what: p.rail ? 'second track and branch lines' : 'railway', price: .42 * people(p) * ground(p), steel: .012 * people(p) * ground(p), room: 2 - p.rail, has: p.rail, piece: true };
  if (kind === 'port') return !p.coast ? { no: 'No coast.' } : { what: p.port ? 'larger harbour' : 'harbour', price: 260, steel: 6, room: 3 - p.port, has: p.port, piece: true };
  if (kind === 'dam') return p.river < .2 ? { no: 'No river for a dam here.' } : { what: 'dam', price: 250 + 500 * p.river, steel: 10, machines: 3, room: p.dam ? 0 : 1, has: p.dam ? 1 : 0, piece: true };
  if (kind === 'fort') return { what: 'fortress works', price: 150, steel: 8, room: MAX_DEFENSE.fort - (p.fort || 0), has: p.fort || 0, piece: true };
  if (kind === 'battery') return !p.coast ? { no: 'Coastal batteries need a coast.' } : { what: 'coastal battery', price: 110, steel: 6, room: MAX_DEFENSE.battery - (p.battery || 0), has: p.battery || 0, piece: true };
  if (kind === 'trench') return { what: 'field works', price: 30, steel: 1, room: MAX_DEFENSE.trench - (p.trench || 0), has: p.trench || 0, piece: true };
  if (kind === 'depot') return { what: 'supply depot', price: 45, steel: .5, room: MAX_DEPOT - (p.depot || 0), has: p.depot || 0, piece: true };
  if (kind === 'shipyard') return !(p.port > 0) ? { no: 'A shipyard stands in a harbour: there is none here.' } : { what: p.yard ? 'larger shipyard' : 'shipyard', price: 320, steel: 12, machines: 3, room: MAX_YARD - (p.yard || 0), has: p.yard || 0, piece: true };
  return { no: 'Unknown building type.' };
}

export function durationOf(kind, detail) {
  if (Object.hasOwn(PLANTS, kind)) return 4;
  if (kind === 'unit') return UNIT_TURNS[detail] ?? 1;
  if (kind === 'ship') return SHIP_TURNS[detail] ?? 3;
  return TURNS[kind] ?? 3;
}

export function queueProject(w, c, spec) {
  const turns = durationOf(spec.kind, spec.unitKind ?? spec.shipKind);
  const p = { id: nextId(w, 'PR'), country: c.id, turnsLeft: turns, turns, started: w.turn, ...spec };
  (w.projects ||= []).push(p);
  return p;
}

// Works ordered before prices were set by the work itself carry the share of output that was spent on them; they finish as they were ordered.
const OLD_YIELD = { mine: 14, farming: 1.2, infrastructure: 1.3, administration: 2.5 };
function finish(w, c, x) {
  const p = w.provinces[x.province], k = x.kind;
  if (x.add == null && x.share != null) x.add = x.share * (Object.hasOwn(PLANTS, k) ? 18 : OLD_YIELD[k] ?? 0);
  // New works belong to whoever paid for them: a company's own extension to the company, the state's building to no company.
  if (Object.hasOwn(PLANTS, k)) { const old = p.plants[k], next = Math.min(MAX_PLANT, old + (x.add ?? 0)); p.plants[k] = next; restake(w, p.id, k, null, old, next, x.firm); }
  else if (k === 'mine') { const d = p.deposits[x.resource]; if (d) { const old = d.mine, next = Math.min(MAX_MINE, old + (x.add ?? 0)); d.mine = next; restake(w, p.id, 'mine', x.resource, old, next, x.firm); } }
  else if (k === 'railway') p.rail = Math.min(2, p.rail + 1);
  else if (k === 'port') p.port = Math.min(3, p.port + 1);
  else if (k === 'dam') { p.dam = true; news(w, `${c.name} completed a dam on the ${p.name} river; water is falling downstream.`, { kind: 'diplomacy', countries: [c.id] }); }
  // Drainage, terraces and wells can make land yield about half as much again as nature gave it, not without end; a forest the same.
  else if (k === 'farming') { p.fertileMax ??= p.fertility * 1.5; p.fertility = Math.max(p.fertility, Math.min(p.fertileMax, p.fertility + (x.add ?? 0))); }
  else if (k === 'forestry') { p.timberMax ??= p.timber * 1.5; p.timber = Math.max(p.timber, Math.min(p.timberMax, p.timber + (x.add ?? 0))); }
  // Roads that were built stay built: they raise what the province's upkeep holds it at, not only where it stands today.
  else if (k === 'infrastructure') { const add = Math.min(x.add ?? 0, MAX_INFRA - p.infra); if (add > 0) { p.infraBase = (p.infraBase ?? p.infra) + add; p.infra += add; } }
  // Offices, courts and the wire are the state's standing presence in a province: its reach settles that much higher for good.
  else if (k === 'administration') { const add = Math.min(x.add ?? 0, MAX_SEAT - (p.seat || 0)); if (add > 0) { p.seat = (p.seat || 0) + add; p.admin = clamp((p.admin ?? .5) + add, 0, 1); } }
  else if (k === 'fort' || k === 'battery' || k === 'trench') p[k] = Math.min(MAX_DEFENSE[k], (p[k] || 0) + 1);
  else if (k === 'depot') { p.depot = Math.min(MAX_DEPOT, (p.depot || 0) + 1); p.depotStore ??= 0; }
  else if (k === 'shipyard') p.yard = Math.min(MAX_YARD, (p.yard || 0) + 1);
  else if (k === 'unit') { const u = makeUnit(w, c.id, p.id, x.men, .8, 60 + c.legitimacy * .3, x.unitKind), g = [...groupsOf(p)].filter(y => statusOf(c, y).arms).sort((a, b) => b.share - a.share)[0];
    // A regiment is of the people it was raised among, and brings to the colours what that people thinks of the state.
    if (g && g.eth !== c.majorityEth) { u.eth = g.eth; u.rel = g.rel; u.loyalty = clamp(u.loyalty - originPull(w, c, u), 0, 100); } }
  // Merchant ships join the country's tonnage; warships form a squadron in the harbour that built them.
  else if (k === 'ship' && x.shipKind === 'merchant') { c.shipBuilt = (c.shipBuilt || 0) + x.ships * MERCHANT; c.shipping = (c.shipping || 0) + x.ships * MERCHANT; }
  else if (k === 'ship') { const f = makeFleet(w, c.id, p.seas[0], x.ships, x.shipKind); f.port = f.home = p.id; }
  else if (k === 'canal') { w.canals.push({ province: p.id, a: p.seas[0], b: p.seas[p.seas.length - 1], owner: c.id }); const s = w.strategic.find(y => y.id === x.strategic); if (s) s.type = 'canal'; news(w, `${c.name} opened the ${p.name} canal; the sea lanes have changed.`, { kind: 'economy', countries: [c.id] }); }
}

export function projectStep(w) {
  // Building is work for hands: what is being spent on works in hand this quarter, in money of constant value, is counted for the labour market.
  for (const c of aliveCountries(w)) c._works = 0;
  for (const x of w.projects ||= []) {
    if (x.status) continue;
    const c = w.countries[x.country], p = w.provinces[x.province];
    if (!c?.alive || p?.controller !== c.id) { x.status = 'lost'; x.closedAt = w.turn; if (c?.alive) news(w, `${c.name} lost the ${x.label ?? x.kind} under construction at ${p?.name}.`, { kind: 'war', countries: [c.id] }); continue; }
    // A public work is paid for as it goes: a part when it is ordered and a part each quarter after. A quarter in which the treasury and its
    // lenders cannot find the instalment is a quarter the work stands still; it is taken up again when the money is there, and whoever
    // governs is told. (Until world 19 every work was paid whole on the day it was ordered, so that no work could ever stop for want of
    // money and none could be abandoned.)
    if (x.due > .01 && x.started !== w.turn) { const part = Math.min(x.due, x.part || x.due), can = Math.max(c.treasury - (c.till || 0), 0) + Math.max(creditLeft(c), 0);
      if (can < part - .01) { x.stalled = (x.stalled || 0) + 1; const ch = w.characters[c.leader]; if (ch?.alive && (x.stalled === 1 || x.stalled % 4 === 0)) ch.inbox.push({ turn: w.turn, from: 'Ministry of Works', text: `The ${projectLabel(x)} at ${p.name} stands still: this quarter's ${Math.round(part)} for it could not be found in the treasury or from the lenders (${Math.round(x.due)} is still to pay on it). It is taken up again the quarter the money is there; what is built so far stands. It can also be given up (cancel_work with its number, ${x.id}): what was spent on it is lost.` }); continue; }
      treasuryPays(c, part, 'building'); x.due -= part; x.stalled = 0; }
    c._works += (x.cost || 0) / Math.max(x.turns || 1, 1);
    if (--x.turnsLeft <= 0) { finish(w, c, x); x.status = 'done'; x.closedAt = w.turn; }
  }
  w.projects = w.projects.filter(x => !x.status || w.turn - x.closedAt <= 8);
}

export const projectLabel = x => x.label ?? (PLANTS[x.kind] || (x.kind === 'mine' ? `${GOOD_LABEL[x.resource]} mine` : x.kind));
// What a work in hand will leave standing, for whoever asks how the building goes.
export function projectYield(x) {
  if (x.add == null) return '';
  const n = Math.round(x.add * 100) / 100;
  return Object.hasOwn(PLANTS, x.kind) || x.kind === 'mine' ? `adds ${n} to its level` : x.kind === 'farming' ? `raises fertility by ${n}` : x.kind === 'forestry' ? `raises the timber yield by ${n}` : x.kind === 'infrastructure' ? `raises infrastructure by ${n}` : x.kind === 'administration' ? `raises the state's reach by ${Math.round(x.add * 100)} points` : '';
}
