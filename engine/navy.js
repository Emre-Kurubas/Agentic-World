// The sea in 1900. A squadron is steel that burns coal: it works from a harbour that can coal and mend it, is worth less the further it
// steams from one, and lies either in port, under the shore guns, or at sea, where it can be met. A sea fight is decided by weight of
// broadside, by how the ships are kept, coaled and led, and by the day; what is hit is as often towed home as sunk, and comes back when a
// dock has had it long enough. Small craft and mines let a weak navy make its own coast dangerous to a strong one.
import { clamp, sum, news, between, rand } from './util.js';
import { atWar, hasTreaty, countryProvinces, aliveCountries, makeFleet } from './world.js';
import { hasTech } from './economy.js';
import { fighting, commanderOf } from './military.js';
import { die } from './politics.js';

// power: what one hull counts for in a line of battle, a cruiser being one. speed: who can decline a fight. coal: what a hull burns in a
// quarter at sea. cells: how far it steams in a quarter. reach: how many seas from a base it can keep station at all.
export const SHIPS = {
  battleship: { name: 'battleships', one: 'battleship', power: 3.5, speed: 1, coal: .9, cells: 8, reach: 14, port: 2, steel: 8, price: 6, turns: 6 },
  cruiser: { name: 'cruisers', one: 'cruiser', power: 1, speed: 2, coal: .3, cells: 12, reach: 16, port: 1, steel: 2, price: 1.5, turns: 3 },
  torpedo: { name: 'torpedo boats', one: 'torpedo boat', power: .3, speed: 2.4, coal: .06, cells: 6, reach: 3, port: 1, steel: .5, price: .4, turns: 2 },
  submarine: { name: 'submarines', one: 'submarine', power: .6, speed: .8, coal: .1, cells: 6, reach: 8, port: 1, steel: 3, price: 2.25, turns: 3, tech: 'combustion_engine' }
};
export const kindOf = f => (SHIPS[f.kind] ? f.kind : 'cruiser');
export const ORDERS = ['patrol', 'seek', 'evade', 'blockade', 'raid', 'port'];
export const orderWords = f => ({ seek: 'to seek out the enemy and fight', evade: 'to avoid battle', blockade: 'to blockade', raid: 'to raid commerce and avoid battle', port: 'to stay in harbour' })[f.orders] ?? '';
const tell = (w, c, text) => { for (const ch of [w.characters[c.leader], w.characters[c.general]]) if (ch?.alive) ch.inbox.push({ turn: w.turn, from: 'Naval Staff', text }); };
const count = (n, k) => { const r = Math.round(n); return `${r} ${r === 1 ? SHIPS[k].one : SHIPS[k].name}`; };
const seaName = (w, id) => w.seas[id]?.name || `the waters ${id}`;
const waters = (w, x) => [...w.seas[x].neighbors, ...w.canals.filter(k => k.a === x || k.b === x).map(k => (k.a === x ? k.b : k.a))];

// A base is a harbour that will coal and mend a squadron: one of its own country's, an ally's, or one opened to it with a right of passage.
export const friendlyPort = (w, id, p) => !!p && p.port > 0 && (p.controller === id || hasTreaty(w, id, p.controller, 'alliance') || hasTreaty(w, id, p.controller, 'military_access'));
// For every sea, how many seas lie between it and the nearest base of this country, and which harbour that is.
export function baseMap(w, id) {
  const at = {}, q = [];
  for (const p of Object.values(w.provinces)) if (friendlyPort(w, id, p)) for (const s of p.seas) if (!at[s]) { at[s] = { d: 0, port: p.id }; q.push(s); }
  for (let i = 0; i < q.length; i++) for (const n of waters(w, q[i])) if (!at[n]) { at[n] = { d: at[q[i]].d + 1, port: at[q[i]].port }; q.push(n); }
  return at;
}
export const fromBase = (w, f) => (f.port ? { d: 0, port: f.port } : baseMap(w, f.country)[f.sea] ?? { d: 99, port: null });
// Within four seas of a base a squadron is as good as it can be; beyond that colliers must follow it, hulls foul and men tire.
export const reachFactor = d => (d <= 4 ? 1 : clamp(1 - (d - 4) * .06, .4, 1));
export const admiral = (w, f) => commanderOf(w, f);
// How fit a squadron is to fight where it lies: its bunkers, and its distance from a harbour. Torpedo craft are coast craft and nothing else.
export const readiness = (w, f, d = fromBase(w, f).d) => (.4 + .6 * (f.coaled ?? 1)) * reachFactor(d) * (kindOf(f) === 'torpedo' && d > 2 ? .3 : 1);
export function strength(w, f) {
  const c = w.countries[f.country], k = SHIPS[kindOf(f)], d = fromBase(w, f).d;
  const oil = hasTech(c, 'combustion_engine') && (c.fuelRatio ?? 1) < .5 ? .4 : 1;
  // Torpedo craft in their own waters come out at night and go home before morning; there they count for far more than their size.
  const home = kindOf(f) === 'torpedo' && d <= 2 ? 2.5 : 1;
  return f.ships * k.power * f.quality * (f.morale / 70) * c.tech.mil * readiness(w, f, d) * oil * home * (admiral(w, f)?.skill ?? 1);
}
const atSea = f => !f.port && f.ships >= .5;
const surface = f => kindOf(f) !== 'submarine';
// Whether an enemy of this country commands a stretch of water: some state it is at war with has ships at sea there that outweigh its own
// and its allies'. A neutral squadron lying in the same water commands nothing for anybody.
export function enemyHolds(w, sea, id) {
  const p = w.seaPower?.[sea]; if (!p) return false;
  let mine = 0, theirs = 0;
  for (const [o, v] of Object.entries(p)) { if (o === id || hasTreaty(w, o, id, 'alliance')) mine += v; else if (atWar(w, o, id)) theirs += v; }
  return theirs > 0 && theirs > mine;
}
const shut = (w, sea, id) => { const s = w.strategic.find(x => x.type === 'strait' && x.ref === sea); return !!s?.closed && s.controller && s.controller !== id && !hasTreaty(w, id, s.controller, 'alliance') && !atWar(w, id, s.controller); };
export function seaPath(w, from, to, id) {
  if (from === to) return [from];
  const prev = { [from]: null }, q = [from];
  while (q.length) { const x = q.shift(); if (x === to) { const path = []; for (let c = x; c; c = prev[c]) path.unshift(c); return path; } for (const n of waters(w, x)) if (!(n in prev) && !shut(w, n, id)) { prev[n] = x; q.push(n); } }
  return null;
}
// The nearest harbour a squadron can run to: a base of its own that no enemy lies off.
export function refuge(w, f, not = null) {
  const seen = new Set([f.sea]), q = [f.sea];
  for (let i = 0; i < q.length; i++) {
    const s = q[i], p = w.seas[s].coast.map(id => w.provinces[id]).filter(x => x.id !== not && friendlyPort(w, f.country, x)).sort((a, b) => (b.controller === f.country) - (a.controller === f.country) || b.port - a.port)[0];
    if (p && !enemyHolds(w, s, f.country)) return p;
    for (const n of waters(w, s)) if (!seen.has(n) && !shut(w, n, f.country)) { seen.add(n); q.push(n); }
  }
  return null;
}
const dock = (w, f, p) => { f.port = p.id; f.sea = p.seas.includes(f.sea) ? f.sea : p.seas[0]; f.target = null; if (p.controller === f.country) f.home = p.id; };

// A navy handed over with a state is a navy of its time: a few battleships if it is of any size, cruisers, and torpedo craft for the coast, lying
// in its best harbour. Together they are worth what the old count of ships was worth.
export function outfitFleets(w) {
  for (const f of Object.values(w.fleets)) {
    if (f.kind) continue;
    const home = countryProvinces(w, f.country).filter(p => p.port > 0 && p.seas.length).sort((a, b) => b.port - a.port || (b.id === w.countries[f.country].capital) - (a.id === w.countries[f.country].capital))[0], n = f.ships;
    if (!home) { f.kind = 'cruiser'; continue; }
    const heavy = home.port >= 2 ? Math.round(n * .3 / SHIPS.battleship.power) : 0, small = Math.round(n * .15 / SHIPS.torpedo.power), rest = Math.max(1, Math.round(n - heavy * SHIPS.battleship.power - small * SHIPS.torpedo.power));
    f.kind = 'cruiser'; f.ships = rest; dock(w, f, home);
    for (const [kind, k] of [['battleship', heavy], ['torpedo', small]]) if (k >= 1) { const x = makeFleet(w, f.country, f.sea, k, kind); x.quality = f.quality; x.morale = f.morale; dock(w, x, home); }
  }
}

// One quarter at sea.
export function navalStep(w) {
  w.mines ||= {};
  const fleets = () => Object.values(w.fleets);
  // Ships whose harbour is no longer open to them put to sea.
  for (const f of fleets()) if (f.port && !friendlyPort(w, f.country, w.provinces[f.port])) { f.port = null; f.target ??= refuge(w, f)?.id ?? null; }
  for (const f of fleets()) sail(w, f);
  bunker(w);
  const bySea = {};
  for (const f of fleets()) if (atSea(f)) (bySea[f.sea] ||= []).push(f);
  const beaten = new Set();
  for (const [sea, fs] of Object.entries(bySea)) fight(w, sea, fs, beaten);
  // Mines take their toll of whoever they were laid for; a squadron that keeps station among them clears them as it loses to them.
  for (const [sea, m] of Object.entries(w.mines)) {
    const hit = fleets().filter(f => atSea(f) && f.sea === sea && fighting(w, f.country, m.by));
    for (const f of hit) { const lost = f.ships * .03 * m.level; f.ships -= lost; f.damaged = (f.damaged || 0) + lost * .5; f.mined = w.turn; tell(w, w.countries[f.country], `${f.id} lost ${Math.round(lost * 10) / 10} ${SHIPS[kindOf(f)].name} to mines in ${seaName(w, sea)}: about half can be brought home and mended.${['patrol', 'blockade', 'seek', undefined].includes(f.orders) ? ' Keeping its station there, it is sweeping them.' : ''}`); }
    if (hit.some(f => !['evade', 'raid'].includes(f.orders))) m.level -= 1;
    // Mines break loose and sink of themselves in a year or two, and a state at peace with everyone sweeps its own.
    m.left = (m.left ?? 8) - (w.wars.some(x => x.active && (x.a.includes(m.by) || x.b.includes(m.by))) ? 1 : 4);
    if (m.left <= 0) { m.level -= 1; m.left = 8; }
    if (m.level <= 0 || !w.countries[m.by]?.alive) { delete w.mines[sea]; continue; }
    // A mine does not ask whose keel it is. Merchant ships of states at war with nobody are lost on them too, and their governments hear of it.
    for (const [k, r] of Object.entries(w.routes || {})) { if (r.mode !== 'sea' || !r.path?.includes(sea)) continue; for (const id of k.split('|')) { const o = w.countries[id]; if (!o?.alive || id === m.by || atWar(w, id, m.by) || rand(w) >= .05 * m.level) continue;
      o.relations[m.by] = clamp((o.relations[m.by] ?? 0) - 8, -100, 100); const g = ((o.grudges ||= {})[m.by] ||= { incident: 0, kin: 0 }); g.incident += 5;
      news(w, `A merchant ship of ${o.name} was lost on a mine in ${seaName(w, sea)}. The mines there are ${w.countries[m.by].name}'s.`, { kind: 'war', countries: [id, m.by] }); } }
  }
  // Who commands which water: the surface ships at sea there, weighed as they would fight.
  w.seaPower = {}; w.seaControl = {}; w.seaRaids = {};
  for (const f of fleets()) {
    if (!atSea(f)) continue;
    // Ships that are out after merchantmen, or under orders to keep out of a fight, command nothing.
    if (surface(f) && !beaten.has(f.id) && !['raid', 'evade'].includes(f.orders)) { const p = (w.seaPower[f.sea] ||= {}); p[f.country] = (p[f.country] || 0) + strength(w, f); }
    // Submarines, and cruisers sent out against trade, prey on the merchant ships of their enemies wherever they lie.
    if ((!surface(f) || f.orders === 'raid') && !beaten.has(f.id)) (w.seaRaids[f.sea] ||= []).includes(f.country) || w.seaRaids[f.sea].push(f.country);
  }
  for (const [sea, p] of Object.entries(w.seaPower)) w.seaControl[sea] = Object.entries(p).sort((a, b) => b[1] - a[1])[0][0];
  // Shore batteries reach whatever enemy lies off them.
  for (const p of Object.values(w.provinces)) if (p.battery) for (const sea of p.seas) for (const f of fleets()) if (atSea(f) && f.sea === sea && fighting(w, f.country, p.controller)) { const lost = f.ships * p.battery * .03; f.ships -= lost; f.damaged = (f.damaged || 0) + lost * .6; }
  // In harbour the yards mend what was brought home: so much weight of ship a quarter for each size of harbour, and steel for the plates.
  for (const f of fleets()) {
    // Ships brought in this quarter are surveyed and docked; the mending starts with the next.
    const p = w.provinces[f.port]; if (!p || !(f.damaged > 0) || f.hurt === w.turn) continue;
    const k = SHIPS[kindOf(f)], c = w.countries[f.country], can = Math.min(f.damaged, p.port * 3 / k.power), steel = Math.min(can * k.steel * .15, Math.max(c.stock.steel || 0, 0)), done = can * (.5 + .5 * (can > 0 ? steel / (can * k.steel * .15) : 1));
    c.stock.steel = Math.max(0, (c.stock.steel || 0) - steel); f.damaged -= done; f.ships += done; if (f.damaged < .05) f.damaged = 0;
  }
  // A squadron told to stay in harbour, or one that is beyond the reach of any base, makes for the nearest one.
  for (const f of fleets()) {
    if (f.port || f.target) continue;
    const d = fromBase(w, f).d;
    if (f.orders === 'port' || d > SHIPS[kindOf(f)].reach) { const p = (f.orders === 'port' && friendlyPort(w, f.country, w.provinces[f.home]) && !enemyHolds(w, w.provinces[f.home].seas[0], f.country) ? w.provinces[f.home] : null) ?? refuge(w, f); if (p) f.target = p.id; }
  }
  for (const f of fleets()) if (f.ships + (f.damaged || 0) < .5) delete w.fleets[f.id];
}

function sail(w, f) {
  f.sailed = null;
  if (!f.target) return;
  const port = w.provinces[f.target], goal = port ? (port.seas.includes(f.sea) ? f.sea : port.seas.find(s => seaPath(w, f.sea, s, f.country))) : f.target;
  if (!goal || !w.seas[goal] || (port && !friendlyPort(w, f.country, port))) { f.target = null; f.sailed = port ? 'that harbour is not open to it' : 'no such water'; return; }
  const path = seaPath(w, f.sea, goal, f.country);
  if (!path) { f.target = null; f.sailed = 'no open water leads there'; return; }
  if (path.length > 1 || !port) f.port = null;
  // One cannot steam past an enemy squadron: where the road crosses water an enemy's surface ships hold, the two meet there.
  const meets = s => Object.values(w.fleets).some(x => atSea(x) && surface(x) && x.sea === s && fighting(w, x.country, f.country));
  let i = 0; const cells = SHIPS[kindOf(f)].cells;
  while (i < path.length - 1 && i < cells) { i++; if (meets(path[i]) && path[i] !== goal) { f.sailed = `it met the enemy in ${seaName(w, path[i])} on its way`; break; } }
  f.sea = path[i];
  if (f.sea !== goal) return;
  f.target = null;
  if (port && !meets(goal)) dock(w, f, port);
}

// Coal. Every hull burns it, a little lying in harbour with banked fires, a great deal at sea, more again far from a base, where colliers have
// to bring it. It comes out of the country's coal; when there is not enough the bunkers run down and the squadrons with them.
function bunker(w) {
  for (const c of aliveCountries(w)) {
    const fs = Object.values(w.fleets).filter(f => f.country === c.id); if (!fs.length) { c._navyCoal = 0; continue; }
    const burn = f => (f.ships + (f.damaged || 0) * .2) * SHIPS[kindOf(f)].coal * (f.port ? .1 : 1 + Math.max(0, fromBase(w, f).d - 4) * .1);
    const want = sum(fs, burn), have = Math.max(c.stock.coal || 0, 0), got = Math.min(want, have), part = want > 0 ? got / want : 1;
    c.stock.coal = have - got; c._navyCoal = got; c._navyCoalWant = want;
    for (const f of fs) f.coaled = clamp((f.coaled ?? 1) + (part - (f.coaled ?? 1)) * .7, 0, 1);
  }
}

// A meeting at sea. Whoever is at war with someone present may fight. A squadron under orders to avoid battle, or out after merchant ships,
// tries to get away, and gets away the more easily the faster it is than whatever hunts it; submarines are seldom found at all.
function fight(w, sea, fs, beaten) {
  const owners = [...new Set(fs.map(f => f.country))], fighters = owners.filter(a => owners.some(b => fighting(w, a, b)));
  if (!fighters.length) return;
  const weigh = xs => sum(xs, f => strength(w, f)), top = [...fighters].sort((a, b) => weigh(fs.filter(f => f.country === b)) - weigh(fs.filter(f => f.country === a)))[0];
  const B = fighters.filter(o => fighting(w, o, top)), A = fighters.filter(o => !B.includes(o) && B.some(b => fighting(w, o, b)));
  let FA = fs.filter(f => A.includes(f.country)), FB = fs.filter(f => B.includes(f.country));
  const shy = f => ['evade', 'raid'].includes(f.orders) || !surface(f), speed = xs => Math.max(0, ...xs.filter(f => !shy(f)).map(f => SHIPS[kindOf(f)].speed));
  if (FA.every(shy) && FB.every(shy)) return;
  const slip = (mine, theirs) => mine.filter(f => { if (!shy(f)) return true;
    const hunted = clamp(.45 + (SHIPS[kindOf(f)].speed - speed(theirs)) * .2 + ((admiral(w, f)?.skill ?? 1) - 1) * .4 - (theirs.some(x => x.orders === 'seek') ? .15 : 0) + (surface(f) ? 0 : .4), .1, .92);
    if (rand(w) < hunted) { f.slipped = w.turn; return false; } return true; });
  FA = slip(FA, FB); FB = slip(FB, FA);
  if (!FA.length || !FB.length) return;
  const luckA = between(w, .8, 1.25), luckB = between(w, .8, 1.25), pA = weigh(FA) * luckA, pB = weigh(FB) * luckB, aWins = pA >= pB, r = Math.max(pA, pB) / Math.max(Math.min(pA, pB), 1e-9);
  const lossL = clamp(.16 * Math.pow(r, .7), .12, .5), lossW = clamp(.09 / Math.pow(r, .9), .02, .15);
  const hull = f => SHIPS[kindOf(f)].power * (f.ships + 0), before = xs => sum(xs, hull), wasA = before(FA), wasB = before(FB), tally = { A: {}, B: {} };
  const apply = (xs, loss, won, key) => { for (const f of xs) { const hit = f.ships * loss, sunk = hit * (won ? .35 : .6); f.ships -= hit; f.damaged = (f.damaged || 0) + hit - sunk; f.morale = clamp(f.morale + (won ? 3 : -12), 5, 100); const t = (tally[key][f.country] ||= { sunk: {}, hurt: {} }); t.sunk[kindOf(f)] = (t.sunk[kindOf(f)] || 0) + sunk; t.hurt[kindOf(f)] = (t.hurt[kindOf(f)] || 0) + hit - sunk; } };
  apply(FA, aWins ? lossW : lossL, aWins, 'A'); apply(FB, aWins ? lossL : lossW, !aWins, 'B');
  const win = aWins ? FA : FB, lose = aWins ? FB : FA, winner = w.countries[win[0].country], loser = w.countries[lose[0].country];
  const wa = admiral(w, [...win].sort((a, b) => hull(b) - hull(a))[0]), la = admiral(w, [...lose].sort((a, b) => hull(b) - hull(a))[0]);
  if (wa) { wa.skill = clamp((wa.skill ?? 1) + .01, .5, 1.6); (wa.record ||= { won: 0, lost: 0 }).won++; } if (la) (la.record ||= { won: 0, lost: 0 }).lost++;
  // An admiral goes down with his flagship now and then; the staff ashore does not.
  for (const [ad, f, bad] of [[wa, win[0], false], [la, lose[0], true]]) if (ad?.alive && f.commander === ad.id && rand(w) < (bad ? .06 : .015)) { news(w, `${ad.name} was lost with his flagship in ${seaName(w, sea)}.`, { kind: 'war', countries: [ad.country] }); die(w, ad, `went down with his flagship in ${seaName(w, sea)}`, { quiet: true }); }
  // The beaten squadron does not stay to be sunk: it runs for a harbour of its own where no enemy waits, and lies there.
  const ran = {};
  for (const f of [...win, ...lose]) f.hurt = w.turn;
  for (const f of lose) { beaten.add(f.id); const p = refuge(w, f); if (p) { dock(w, f, p); ran[f.country] = p.name; } }
  const sunkText = t => Object.entries(t.sunk).filter(([, n]) => n >= .5).map(([k, n]) => count(n, k)).join(', ') || 'nothing', hurtText = t => Object.entries(t.hurt).filter(([, n]) => n >= .5).map(([k, n]) => count(n, k)).join(', ');
  const total = (key, part) => Math.round(sum(Object.values(tally[key]), x => sum(Object.values(x[part]))) * 10) / 10, wk = aWins ? 'A' : 'B', lk = aWins ? 'B' : 'A';
  news(w, `Naval battle in ${seaName(w, sea)}: ${winner.name} prevailed over ${loser.name}. Ships sunk: ${Math.round(total(wk, 'sunk'))} of the victor's, ${Math.round(total(lk, 'sunk'))} of the beaten side's.`, { kind: 'war', countries: fighters });
  (w.seaFights ||= []).push({ sea, winner: winner.id, loser: loser.id, turn: w.turn, sunk: [total(wk, 'sunk'), total(lk, 'sunk')], disabled: [total(wk, 'hurt'), total(lk, 'hurt')] });
  // What each staff knows of the day: its own losses as counted, the enemy's as seen from the bridge, and what told.
  const lineOf = xs => Object.entries(xs.reduce((a, f) => ((a[kindOf(f)] = (a[kindOf(f)] || 0) + f.ships), a), {})).map(([k, n]) => count(n, k)).join(', ');
  for (const [mine, theirs, key, won] of [[FA, FB, 'A', aWins], [FB, FA, 'B', !aWins]]) for (const id of new Set(mine.map(f => f.country))) {
    const c = w.countries[id], t = tally[key][id], other = tally[key === 'A' ? 'B' : 'A'], seen = Object.values(other).reduce((a, x) => a + sum(Object.values(x.sunk)) + sum(Object.values(x.hurt)), 0), own = mine.filter(f => f.country === id);
    const rd = sum(own, f => readiness(w, f) * hull(f)) / Math.max(sum(own, hull), 1e-9), their = sum(theirs, f => readiness(w, f) * hull(f)) / Math.max(sum(theirs, hull), 1e-9), far = Math.max(...own.map(f => fromBase(w, f).d)), coaled = Math.min(...own.map(f => f.coaled ?? 1));
    const weight = (key === 'A' ? wasA : wasB) / Math.max(key === 'A' ? wasB : wasA, 1e-9), luck = (key === 'A' ? luckA / luckB : luckB / luckA), why = [];
    if (won ? weight > 1.15 : weight < .87) why.push(won ? 'we had the heavier line' : 'they had the heavier line');
    if (!won && rd < their - .08) why.push(coaled < .8 ? `our bunkers were ${Math.round(coaled * 100)} in the hundred full` : `we fought ${far} seas from our nearest base`); if (won && their < rd - .08) why.push('their ships were far from a base or short of coal');
    if (theirs.some(f => kindOf(f) === 'torpedo' && fromBase(w, f).d <= 2) && !won) why.push('their torpedo craft came out from their own coast'); if (own.some(f => kindOf(f) === 'torpedo' && fromBase(w, f).d <= 2) && won) why.push('our torpedo craft fought in their own waters');
    if (won ? luck > 1.12 : luck < .9) why.push('the day went ' + (won ? 'our' : 'their') + ' way'); if (!why.length) why.push(won ? 'ship for ship we shot and steamed the better' : 'ship for ship they shot and steamed the better');
    tell(w, c, `Battle in ${seaName(w, sea)} (${sea}): ${won ? 'we hold the water' : 'we were beaten'}. We had ${lineOf(own.map(f => ({ ...f, ships: f.ships / (1 - (won ? lossW : lossL)) })))} there. Sunk on our side: ${sunkText(t)}${hurtText(t) ? `; ${hurtText(t)} are badly damaged and fight no more until a dock has had them (a harbour mends about three cruisers' weight of ship a quarter for each size it has)` : ''}. Of theirs about ${Math.round(seen)} ships were seen sunk or disabled. What told: ${why.join('; ')}.${!won && ran[id] ? ` Our ships ran for ${ran[id]} and lie in harbour there.` : !won ? ' No harbour of ours could be reached: they are still at sea.' : ''}`);
  }
}

// A harbour that falls to an army takes its ships with it unless they can get out. With open water before them they put to sea and make for
// another base; shut in by an enemy squadron they are blown up at their moorings, and the victor raises a few of them.
export function portFalls(w, p, by) {
  for (const f of Object.values(w.fleets)) {
    if (f.port !== p.id || f.country === by || friendlyPort(w, f.country, p)) continue;
    const c = w.countries[f.country], docked = f.damaged || 0; f.damaged = 0; f.port = null;
    const out = p.seas.find(s => !enemyHolds(w, s, f.country));
    if (out && f.ships >= .5) { f.sea = out; const next = refuge(w, f, p.id); f.target = next?.id ?? null; news(w, `${c.name}'s squadron put to sea as ${p.name} fell${docked >= .5 ? `, leaving ${Math.round(docked)} ships in the docks to be blown up` : ''}.`, { kind: 'war', countries: [f.country, by] }); tell(w, c, `${p.name} has fallen. ${f.id} got out to sea${next ? ` and is making for ${next.name}` : ' and has no harbour to make for'}.${docked >= .5 ? ` ${Math.round(docked)} ships under repair there could not be moved and were destroyed.` : ''}`); continue; }
    const prize = (f.ships + docked) * .25;
    if (atWar(w, by, f.country) && prize >= .5) { const x = makeFleet(w, by, f.sea, 0, kindOf(f)); x.damaged = prize; x.quality = .9; dock(w, x, p); }
    news(w, `${c.name}'s squadron at ${p.name} was scuttled as the harbour fell: ${count(f.ships + docked, kindOf(f))} lost.`, { kind: 'war', countries: [f.country, by] });
    tell(w, c, `${p.name} has fallen with ${f.id} in it. An enemy squadron lay off the harbour and the ships could not get out: ${count(f.ships + docked, kindOf(f))} were blown up at their moorings.`);
    delete w.fleets[f.id];
  }
}

// Guns from the sea. A squadron lying off a coast shells what it can reach: harbour works, batteries, troops in the open, the town.
export function bombard(w, c, f, p, h) {
  const k = SHIPS[kindOf(f)], foe = w.countries[p.controller], weight = f.ships * k.power * readiness(w, f);
  const reply = (p.battery || 0) * .04 + ((p.fort || 0) >= 1 ? .01 : 0), lost = f.ships * reply; f.ships -= lost; f.damaged = (f.damaged || 0) + lost * .6;
  const share = clamp(weight / 60, .02, .3), open = !(p.battery > 0) && !(p.fort >= 1) && !Object.values(w.units).some(u => u.province === p.id && u.country === p.controller);
  p.devastation = clamp(p.devastation + share * .5, 0, 1); if (p.battery) p.battery = Math.max(0, p.battery - share * 2);
  let dead = 0; for (const cls of Object.keys(p.pops)) { const d = p.pops[cls].n * share * .01; p.pops[cls].n -= d; dead += d; }
  for (const u of Object.values(w.units)) if (u.province === p.id && fighting(w, u.country, c.id)) { u.men *= 1 - share * .08; u.morale = clamp(u.morale - share * 20, 0, 100); u.dug = Math.max(0, (u.dug || 0) - 1); }
  for (const x of Object.values(w.fleets)) if (x.port === p.id && fighting(w, x.country, c.id) && (p.battery || 0) < 1.5) { const hit = x.ships * share * .3; x.ships -= hit; x.damaged = (x.damaged || 0) + hit; }
  p.unrest = clamp(p.unrest + share * 20, 0, 100); foe.warExhaustion = clamp((foe.warExhaustion || 0) + share * 4, 0, 100);
  const g = ((foe.grudges ||= {})[c.id] ||= { incident: 0, kin: 0 }); g.incident += 4 + share * 30;
  news(w, `${c.name}'s ships shelled ${p.name}${open ? ', an undefended town' : ''}: about ${Math.round(dead * 1000)} townspeople were killed.`, { kind: 'war', countries: [c.id, foe.id], province: p.id });
  // Shelling a town that cannot answer is something every other government reads about.
  if (open) { h.shame(w, c, -2, `its ships shelled the undefended town of ${p.name}`); for (const o of aliveCountries(w)) if (o.id !== c.id && o.id !== foe.id && !atWar(w, o.id, foe.id)) o.relations[c.id] = clamp((o.relations[c.id] ?? 0) - 4, -100, 100); }
  for (const ch of [w.characters[foe.leader], w.characters[foe.general]]) if (ch?.alive) ch.inbox.push({ turn: w.turn, from: 'Naval Staff', text: `${c.name}'s ships shelled ${p.name}: about ${Math.round(dead * 1000)} dead in the town, the harbour and works damaged${p.battery ? `; our batteries answered and hit ${Math.round(lost * 10) / 10} of them` : '; there were no guns there to answer'}.` });
  return { ok: true, msg: `${f.id} shelled ${p.name}: the harbour and works are damaged${p.battery ? ', its batteries partly silenced' : ''}, troops in the open there lost men and shelter, and about ${Math.round(dead * 1000)} townspeople were killed.${lost >= .05 ? ` The shore guns answered: ${Math.round(lost * 10) / 10} of our ${k.name} were hit, most of them fit to be mended.` : ''}${open ? ' The place had no guns and no garrison: the world has read that our ships shelled an open town, and thinks the less of us.' : ''} The country it belongs to will hold it against us.` };
}

// What a fleet off a coast adds to an army fighting on it: the ships' guns reach the field while the water is theirs.
export function shipGuns(w, p, ids, against) {
  if (!p.coast) return 1;
  const weight = sum(p.seas, s => sum(ids, id => (enemyHolds(w, s, id) ? 0 : w.seaPower?.[s]?.[id] || 0)));
  return 1 + clamp(weight / Math.max(against, 20) * .5, 0, .15);
}
