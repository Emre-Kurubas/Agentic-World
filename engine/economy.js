import { clamp, sum, news, between, rand } from './util.js';
import { hungerOf } from './politics.js';
import { CLASSES, GOODS, RAW, BASE_PRICE, GOOD_LABEL, PLANTS, TECHS, countryProvinces, provincePop, aliveCountries, atWar, hasTreaty } from './world.js';
import { dealsWith, tieOf } from './diplomacy.js';
import { migrate, levyShare } from './culture.js';
import { updateRer, glutFactor, localPrices, displacedDemand, exportEdge, foreignRate, declareDefault, currencyStep, sovereignRate, creditLeft, creditStanding, USUAL_COVER, treasuryPays } from './money.js';
import { blockadeOf, merchantStep, iced } from './navy.js';
import { upkeepCost, railWorks, roadFactor } from './military.js';
import { warFooting, kitOf, marketStep, warEnds, WAR_RISK, lendersWords } from './warcost.js';

export const RECIPE = {
  steel: { iron: 1, coal: .8 }, fuel: { oil: 1.25 }, fertilizer: { phosphate: 1, coal: .2 },
  machines: { steel: .7, copper: .2 }, goods: { timber: .2, coal: .2, steel: .1 }, arms: { steel: .7, coal: .3 }
};
const ORDER = ['steel', 'fuel', 'fertilizer', 'machines', 'arms', 'goods'];
// What a hand in the small trades of a town (the building, the carting, the docks, the workshop of one master and two men) adds in a quarter,
// in money of constant value: less than a hand in a mill, more than a hand on poor land.
export const SMALL = .3, CURSE = .125;
// Ordinary private building: what a unit of the country's output draws in a quarter of steel, timber and machinery when times are ordinary
// (some two parts in a hundred of output in iron and steel, as much in engines and rolling stock, a little in timber), and how hard it swings
// with the trend of trade (BOOM: a country growing a point a quarter faster than the usual builds three tenths more, as harvest years did).
export const BUILDING = { steel: .001, timber: .0006, machines: .00035 }, BOOM = 30, USUAL_GROWTH = .004;
export const hasTech = (c, t) => !!c.techs?.[t];
// How far an invention has come into use. What a state inherited is long since in every works; what it has just learned spreads as works are
// wired and farmers persuaded, over the quarters given here, and does its work in that measure.
export const SPREAD = { electricity: 24, chemical_fertilizer: 12 };
export const inUse = (w, c, t) => !c.techs?.[t] ? 0 : clamp(c.adopting?.[t] ?? 1, 0, 1);
// How much of the way a new thing goes in a quarter. The quarters in SPREAD are the pace of a country that spends on its roads and public works
// what it always has; a government that spends more wires its works sooner, one that starves them waits half a generation. Fertilizer is taken
// up by farmers who can read what is printed on the sack.
export const paceOf = (c, t) => (t === 'electricity' ? clamp(1 + (c.budget.infrastructure * (c.paidRatio ?? 1) - (c.roadShare ?? c.budget.infrastructure)) * 60, .4, 2.5) : t === 'chemical_fertilizer' ? clamp(.5 + c.literacy / 100, .5, 1.5) : 1) / (SPREAD[t] || 1);

// Rule: goods move only if a road or a water joins buyer and seller, and they pay for the way they go.
//
// Every cargo between two states travels from the one's seat of trade to the other's (their capitals), over the provinces and seas that lie
// between: by rail where both ends of a stage have a working line, by wagon road where they do not (dearer, dearer still over hills, marsh and
// mountain, and shut where winter or mud shuts the road), through a harbour on to the water and off it again, and across the soil of a third
// state where that state lets it pass. Heavy cargo (grain, coal, ore, timber, oil) pays far more than wares for every stage by road and
// somewhat more by rail, and so goes by water and by rail wherever it can. The cheapest way is the way trade takes; when a frontier closes, a
// railway is cut, a strait is shut or a war lies across the road, it takes the next cheapest, at that price, or stops.
//
// (Until world 19 two states that touched traded "overland" at one price wherever they touched, a third state between two others carried
// their trade at next to nothing, no railway and no pass was worth anything to commerce, a strait could be closed without a single cargo
// noticing, and a toll at a strait was paid by ships that had open water beside them. World 18: a state that held three straits on a
// neighbour's whole sea trade never knew it, and by measurement would have taken a third of its revenue in tolls from ships that could not
// go round.)
// (A stage by wagon road costs three times a stage by rail for wares and five times for heavy cargo. The difference the railway made was
// larger than that; with road at eight times rail the configured world traded as before, but in other inherited worlds a poor state was
// drained of its gold within two years and the pits ran slack, so the larger figure waits until the trades the states inherit are settled
// against it. Measured in the configured world, trade stays between a twentieth and a tenth of what the states turn out.)
export const CARRY = { rail: .003, road: .009, bulkRail: 1.6, bulkRoad: 2.6, border: .008, load: .025, quay: .012, sea: .008, home: .6, trains: 1.5, waste: .05 };
const GROUND = { plains: 1, desert: 1.3, hills: 1.3, forest: 1.2, tundra: 1.5, marsh: 1.6, mountain: 2 };
// A sea is closed to two countries' trade when an enemy of either holds it in strength; held thinly, runners still get through, at a price.
const SEALED = .8;
const closure = (w, sea, a, b) => Math.max(blockadeOf(w, sea, a), blockadeOf(w, sea, b));
function seaLocked(w, sea, a, b) { return closure(w, sea, a, b) >= SEALED; }
function straitAt(w, sea) { return w.strategic.find(x => x.type === 'strait' && x.ref === sea); }
const canalsAt = (w, sea) => w.canals.filter(k => k.a === sea || k.b === sea);
// Whether one state lets the cargoes of two others cross its soil, and at what due. Left alone it lets them pass for nothing but the
// carriers' ordinary charges; whoever governs can lay a due on what crosses or shut the road, to everybody or to one state's trade
// (set_transit). It never lets pass the trade of a state it is at war with, has laid an embargo on or does not deal with.
export const transitOf = (t, id) => ({ closed: !!(t.transit?.by?.[id]?.closed ?? t.transit?.closed), toll: t.transit?.by?.[id]?.toll ?? t.transit?.toll ?? 0 });
function lets(w, t, a, b) {
  for (const x of [a, b]) { if (atWar(w, t.id, x.id) || t.embargo.includes(x.id) || x.embargo.includes(t.id) || !dealsWith(w, t.id, x.id) || transitOf(t, x.id).closed) return false; }
  return true;
}
// The cheapest way for one kind of cargo between two states, or null. `without` leaves one province or sea out, to ask what its loss would cost.
export function carry(w, a, b, bulk = false, without = null) {
  const from = a.capital, to = b.capital; if (!w.provinces[from] || !w.provinces[to]) return null;
  const pass = {}, open = id => { if (id in pass) return pass[id]; const t = w.countries[id]; return pass[id] = !!t?.alive && (id === a.id || id === b.id || lets(w, t, a, b)); };
  const enter = p => p.id !== without && !p.siege && open(p.controller);
  const dist = { [from]: 0 }, prev = {}, how = {}, heap = [from], done = new Set();
  const cut = {}, relax = (x, n, d, kind, canal) => { if (d < (dist[n] ?? Infinity) - 1e-12) { dist[n] = d; prev[n] = x; how[n] = kind; if (canal) cut[n] = canal; else delete cut[n]; heap.push(n); } };
  while (heap.length) {
    heap.sort((x, y) => dist[x] - dist[y]); const x = heap.shift(); if (done.has(x)) continue; done.add(x); if (x === to) break;
    const p = w.provinces[x];
    if (p) {
      for (const n of p.neighbors) { const q = w.provinces[n]; if (!q || !enter(q)) continue;
        const t = w.countries[q.controller], rail = railWorks(w, p) && railWorks(w, q), ours = q.controller === a.id || q.controller === b.id;
        let step = rail ? CARRY.rail * (bulk ? CARRY.bulkRail : 1) * (t.war?.on ? CARRY.trains : 1) : CARRY.road * (GROUND[q.terrain] ?? 1.3) * roadFactor(q) * (bulk ? CARRY.bulkRoad : 1);
        step = step * (ours ? CARRY.home : 1) + (q.devastation || 0) * CARRY.waste;
        if (q.controller !== p.controller) step += CARRY.border + (ours ? 0 : transitOf(t, a.id).toll + transitOf(t, b.id).toll) / 2 + (!ours && t.war?.on ? WAR_RISK.land : 0);
        relax(x, n, dist[x] + step, rail ? 'rail' : 'road'); }
      if (p.port > 0 && !iced(w, p)) for (const s of p.seas) { if (s === without || seaLocked(w, s, a.id, b.id)) continue; relax(x, s, dist[x] + CARRY.load - (p.port - 1) * CARRY.quay + seaCost(w, s, a, b) + (w.freight || 0), 'port'); }
    } else {
      const sea = w.seas[x]; if (!sea) continue;
      for (const n of sea.neighbors) { if (n === without || seaLocked(w, n, a.id, b.id)) continue; const st = straitAt(w, n); if (st?.closed && st.controller !== a.id && st.controller !== b.id) continue; relax(x, n, dist[x] + CARRY.sea + seaCost(w, n, a, b) + tollAt(st, a, b), 'sea'); }
      for (const k of canalsAt(w, x)) { const n = k.a === x ? k.b : k.a, dug = w.strategic.find(s => s.type === 'canal' && s.ref === k.province), holder = w.provinces[k.province]?.controller; if (n === without || k.province === without || seaLocked(w, n, a.id, b.id)) continue; if (dug?.closed && holder !== a.id && holder !== b.id) continue; if (holder && holder !== a.id && holder !== b.id && !open(holder)) continue; relax(x, n, dist[x] + CARRY.sea + seaCost(w, n, a, b) + tollAt(dug && { ...dug, controller: holder }, a, b), 'canal', k.province); }
      for (const pid of sea.coast) { const q = w.provinces[pid]; if (!q || !(q.port > 0) || iced(w, q) || !enter(q)) continue; const third = q.controller !== a.id && q.controller !== b.id ? w.countries[q.controller] : null; relax(x, pid, dist[x] + CARRY.load - (q.port - 1) * CARRY.quay + (third ? (transitOf(third, a.id).toll + transitOf(third, b.id).toll) / 2 + (third.war?.on ? WAR_RISK.land : 0) : 0), 'port'); }
    }
  }
  if (!(to in dist)) return null;
  const nodes = []; for (let x = to; x != null; x = prev[x]) nodes.unshift(x);
  const seas = nodes.filter(id => w.seas[id]), land = nodes.filter(id => w.provinces[id]), vias = [...new Set(land.map(id => w.provinces[id].controller).filter(id => id !== a.id && id !== b.id))];
  // A strait's keeper takes his toll once from a cargo, however many of his narrows it passes.
  const tolled = seas.map(s => straitAt(w, s)).filter(s => tollAt(s, a, b) > 0), keepers = {}; let twice = 0;
  for (const s of tolled) { if (keepers[s.controller]) twice += s.toll; else keepers[s.controller] = s; }
  for (const s of seas.filter(x => how[x] === 'canal' && cut[x])) { const d = w.strategic.find(y => y.type === 'canal' && y.ref === cut[s]), holder = w.provinces[cut[s]]?.controller; if (d && tollAt({ ...d, controller: holder }, a, b) > 0 && !keepers[holder]) keepers[holder] = d; }
  const stages = { rail: 0, road: 0 }; for (const id of nodes) if (how[id] === 'rail' || how[id] === 'road') stages[how[id]]++;
  const water = seas.length ? sum(nodes.filter(id => ['port', 'sea', 'canal'].includes(how[id])), id => dist[id] - dist[prev[id]]) : 0;
  // A canal passed is a place passed, for whoever counts what goes where.
  nodes.push(...seas.filter(s => how[s] === 'canal' && cut[s]).map(s => cut[s]));
  const dues = vias.map(id => ({ to: id, rate: (transitOf(w.countries[id], a.id).toll + transitOf(w.countries[id], b.id).toll) / 2 })).filter(d => d.rate > 0);
  return { mode: seas.length ? 'sea' : vias.length ? 'transit' : 'land', way: dist[to] - twice, path: seas, land, nodes, tolls: Object.values(keepers).map(s => s.id), dues, ...(vias.length ? { via: vias[0], vias } : {}), stages, water };
}
const tollAt = (st, a, b) => st && st.toll && st.controller && st.controller !== a.id && st.controller !== b.id ? st.toll : 0;
// What the dangers of one sea add to a cargo of these two states: raiders, mines, a blockade that is run.
function seaCost(w, s, a, b) {
  const raided = (w.seaRaids?.[s] || []).some(x => atWar(w, x, a.id) || atWar(w, x, b.id)) ? .15 : 0, m = w.mines?.[s];
  const mined = !m ? 0 : atWar(w, m.by, a.id) || atWar(w, m.by, b.id) ? .1 * m.level : [a.id, b.id].includes(m.by) ? 0 : .02 * m.level;
  return raided + mined + closure(w, s, a.id, b.id) * .35;
}
const landBorder = (w, a, b) => countryProvinces(w, a.id).some(p => p.neighbors.some(n => w.provinces[n].controller === b.id));

export function tradeOpen(w, a, b) { return !!w.routes[routeKey(a.id, b.id)]; }
const routeKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;

export function updateStrategic(w) {
  for (const s of w.strategic) {
    if (s.type === 'strait') {
      const sea = w.seas[s.ref], counts = {};
      for (const pid of sea.coast) counts[w.provinces[pid].controller] = (counts[w.provinces[pid].controller] || 0) + 1;
      const fleet = Object.values(w.fleets).filter(f => f.sea === s.ref && !f.port).sort((a, b) => b.ships - a.ships)[0];
      s.controller = fleet?.country ?? Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      if (!w.countries[s.controller]?.alive) s.controller = null;
      const pol = s.controller ? w.countries[s.controller].straitPolicy?.[s.id] : null;
      s.closed = !!pol?.closed; s.toll = pol?.toll ?? 0;
    } else { s.controller = w.provinces[s.ref]?.controller ?? null;
      // A canal is its holder's to close or to charge for, like a strait.
      if (s.type === 'canal') { const pol = s.controller ? w.countries[s.controller]?.straitPolicy?.[s.id] : null; s.closed = !!pol?.closed; s.toll = pol?.toll ?? 0; } }
  }
}

// Bulk: what is heavy for its price. It is carried on its own reckoning (carry with bulk), and goes by the way that is cheapest for it, which
// is seldom the wagon road.
export const BULK = new Set(['grain', 'timber', 'coal', 'iron', 'copper', 'oil', 'phosphate']), LAND_BULK = .05;
export const routeFor = (r, g) => r && r.bulk && BULK.has(g) ? r.bulk : r;
export function updateRoutes(w) {
  const cs = aliveCountries(w), before = w.routes || {}; w.routes = {};
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
    const a = cs[i], b = cs[j], k = routeKey(a.id, b.id);
    // No merchants go where their government sees no state; and where relations are broken off they go without consuls, at their own risk.
    if (a.embargo.includes(b.id) || b.embargo.includes(a.id) || atWar(w, a.id, b.id) || !dealsWith(w, a.id, b.id)) continue;
    // A cargo to or from a state at war pays for the risk at each such end: insurers, carriers and the buyer's own caution (warcost.js).
    const risk = tieOf(w, a.id, b.id) === 'broken' ? .08 : 0, hot = warEnds(a, b).length;
    const dress = r => { if (!r) return null; const sea = r.mode === 'sea', war = hot * (sea ? WAR_RISK.sea : WAR_RISK.land); return { ...r, cost: 1 + r.way + risk + war, ...(war ? { war } : {}) }; };
    const wares = dress(carry(w, a, b, false)); if (!wares) continue;
    w.routes[k] = { ...wares, bulk: dress(carry(w, a, b, true)) ?? wares };
  }
  // A state at war with nobody whose ships are turned back from a blockaded coast protests to whoever turned them back.
  // (Once, when the coast is closed: not every quarter it stays closed, and whether or not his cargoes then find another way.)
  const sealed = {}; for (const v of cs) for (const b of cs) if (b !== v && atWar(w, b.id, v.id) && countryProvinces(w, v.id).some(p => p.port > 0 && p.seas.some(s => (w.seaPower?.[s]?.[b.id] || 0) > 0 && blockadeOf(w, s, v.id) >= SEALED))) sealed[`${v.id}|${b.id}`] = true;
  const fresh = Object.keys(sealed).filter(key => !w.sealed?.[key]); w.sealed = sealed;
  for (const [k, r] of Object.entries(before)) { if (![r, r.bulk].some(x => x?.mode === 'sea')) continue; const [x, y] = k.split('|').map(id => w.countries[id]); if (!x?.alive || !y?.alive || atWar(w, x.id, y.id)) continue;
    for (const [n, v] of [[x, y], [y, x]]) for (const b of cs) { if (b === n || b === v || !fresh.includes(`${v.id}|${b.id}`) || atWar(w, b.id, n.id)) continue;
      n.relations[b.id] = clamp((n.relations[b.id] ?? 0) - 5, -100, 100); const ch = w.characters[n.leader]; if (ch?.alive) ch.inbox.push({ turn: w.turn, from: 'Foreign Ministry', text: `${b.name}'s squadrons have closed the harbours of ${v.name}: our ships are turned back from that coast${w.routes[k] ? `, and what trade we still have with ${v.name} goes another way and dearer` : ` and our trade with ${v.name} has stopped`}. Our merchants want to know what the government will say to ${b.name}.` }); } }
  // Whose road was lengthened or cut since last quarter is told to whoever governs (routeNews), once the new ways are known.
  routeNews(w, before);
}
// A government hears when the way its trade takes with another state has grown much dearer, or has closed, or has opened again, and why.
function routeNews(w, before) {
  for (const [k, was] of Object.entries(before)) { const now = w.routes[k], [x, y] = k.split('|').map(id => w.countries[id]); if (!x?.alive || !y?.alive || atWar(w, x.id, y.id)) continue;
    const worse = !now || now.cost > was.cost + .06, better = now && now.cost < was.cost - .06; if (!worse && !better) continue;
    const why = now ? whyChanged(w, x, y, was, now) : whyClosed(w, x, y, was); for (const [n, v] of [[x, y], [y, x]]) { const ch = w.characters[n.leader]; if (ch?.alive) { ch.inbox.push({ turn: w.turn, from: 'Board of Trade', text: !now ? `Our trade with ${v.name} has no way open to it any longer${why ? `: ${why}` : ''}.` : `Carriage between us and ${v.name} now adds about ${Math.round((now.cost - 1) * 100)} in the hundred to a cargo (it was ${Math.round((was.cost - 1) * 100)})${why ? `: ${why}` : ''}.` }); } } }
  for (const [k, now] of Object.entries(w.routes)) if (!before[k] && Object.keys(before).length) { const [x, y] = k.split('|').map(id => w.countries[id]); for (const [n, v] of [[x, y], [y, x]]) { const ch = w.characters[n.leader]; if (ch?.alive) ch.inbox.push({ turn: w.turn, from: 'Board of Trade', text: `A way is open again for our trade with ${v.name}: ${wayOf(w, now)}; carriage adds about ${Math.round((now.cost - 1) * 100)} in the hundred.` }); } }
}
// What the loss of one province or sea would do to the trade of a pair that used it: the way it would take then and what that adds to a
// cargo, or that it would have none. The measure of what a place is worth to commerce.
export function detour(w, key, id) {
  const [x, y] = key.split('|').map(k => w.countries[k]), r = w.routes[key]; if (!x?.alive || !y?.alive || !r) return null;
  // (Both ways are reckoned as things stand today, so that like is set against like: the way on record was found when the quarter opened.)
  const heavy = !(r.nodes || []).includes(id) && (r.bulk?.nodes || []).includes(id), was = carry(w, x, y, heavy) ?? (heavy ? r.bulk : r), now = carry(w, x, y, heavy, id);
  return { heavy, shut: !now, adds: now ? Math.max(0, now.way - was.way) : null, way: now };
}
const names = (w, ids) => ids.map(id => w.provinces[id]?.name ?? w.seas[id]?.name ?? id);
// A way in words: what it crosses, and how.
// The same in a few words, for where many ways are named at once.
export const wayBrief = (w, r) => `${r.mode === 'sea' ? `by sea through ${r.path.length} water${r.path.length > 1 ? 's' : ''}${r.stages?.road + r.stages?.rail ? ' and overland to the harbours' : ''}` : `overland${r.stages ? ` (${r.stages.rail} stage${r.stages.rail === 1 ? '' : 's'} by rail, ${r.stages.road} by road)` : ''}`}${r.vias?.length ? ` across ${r.vias.map(id => w.countries[id]?.name).join(' and ')}` : ''}`;
export function wayOf(w, r) {
  const land = r.land || [], through = r.vias?.length ? ` across ${r.vias.map(id => w.countries[id]?.name).join(' and ')}` : '';
  const stages = r.stages ? [r.stages.rail ? `${r.stages.rail} stage${r.stages.rail > 1 ? 's' : ''} by rail` : '', r.stages.road ? `${r.stages.road} by wagon road` : ''].filter(Boolean).join(' and ') : '';
  if (r.mode === 'sea') { const ports = (r.nodes || []).filter((id, i, all) => w.provinces[id] && (w.seas[all[i + 1]] || w.seas[all[i - 1]])); return `by sea${ports.length ? ` between ${names(w, ports).join(' and ')}` : ''}, through ${r.path.join(' > ')}${stages ? `, with ${stages} to and from the harbours` : ''}${through}`; }
  return `overland${through}${land.length > 2 ? ` through ${names(w, land.slice(1, -1)).join(', ')}` : ''}${stages ? ` (${stages})` : ''}`;
}
function whyClosed(w, x, y, was) {
  const lost = (was.nodes || []).find(id => { const p = w.provinces[id]; return p && (p.siege || (p.controller !== x.id && p.controller !== y.id && !lets(w, w.countries[p.controller] ?? { embargo: [] }, x, y))); }), p = w.provinces[lost];
  if (p) { const t = w.countries[p.controller]; return p.siege ? `${p.name}, on the road it took, is under siege` : `${t?.name ?? 'the state'} that holds ${p.name}, on the road it took, ${t && (atWar(w, t.id, x.id) || atWar(w, t.id, y.id)) ? 'is at war with one of us' : t && (transitOf(t, x.id).closed || transitOf(t, y.id).closed) ? 'has shut its roads to it' : 'no longer lets it pass'}, and there is no other`; }
  const s = (was.path || []).find(id => seaLocked(w, id, x.id, y.id) || (straitAt(w, id)?.closed && ![x.id, y.id].includes(straitAt(w, id).controller))); return s ? `the water it took (${w.seas[s]?.name || s}) is closed to it` : '';
}
function whyChanged(w, x, y, was, now) {
  const gone = (was.nodes || []).filter(id => !(now.nodes || []).includes(id)), p = gone.map(id => w.provinces[id]).find(q => q && (q.siege || q.railOut > w.turn || q.cut || (q.controller !== x.id && q.controller !== y.id))), s = gone.find(id => w.seas[id] && (straitAt(w, id)?.closed || straitAt(w, id)?.toll || closure(w, id, x.id, y.id) > 0));
  if (now.cost > was.cost) return p ? `it no longer goes by ${p.name}${p.siege ? ', which is besieged' : p.railOut > w.turn || p.cut ? ', where the railway is cut' : `, which ${w.countries[p.controller]?.name} holds`} and goes ${wayOf(w, now)}` : s ? `it no longer goes through ${w.seas[s]?.name || s} and goes ${wayOf(w, now)}` : now.war > (was.war || 0) ? 'insurers and carriers ask more of a cargo to or from a state at war' : `it goes ${wayOf(w, now)}`;
  return `it now goes ${wayOf(w, now)}`;
}

function weatherStep(w) {
  for (const p of Object.values(w.provinces)) p.weather = between(w, .9, 1.08);
  if (rand(w) < .28) {
    const ps = Object.values(w.provinces), core = ps[Math.floor(rand(w) * ps.length)];
    const region = [core, ...core.neighbors.map(n => w.provinces[n])];
    const kind = rand(w) < .7 ? 'drought' : 'flood';
    region.forEach(p => p.weather *= kind === 'drought' ? .55 : .7);
    news(w, `${core.name} region hit by ${kind}: the harvest fell sharply.`, { kind: 'disaster', countries: [core.controller], hush: true });
  }
  for (const p of Object.values(w.provinces)) p.waterPenalty = 0;
  for (const p of Object.values(w.provinces)) if (p.dam) { let q = p.downstream ? w.provinces[p.downstream] : null, f = .3, n = 0; while (q && n++ < 12) { q.waterPenalty += f; f *= .8; q = q.downstream ? w.provinces[q.downstream] : null; } }
}

// What part of its places a mill keeps filled: all of them while it sells what it makes; on short time, that part (the same reckoning the
// mills themselves are run on, factories); an arms works, what the state asks of it; never less than the few who keep the fires in.
const KEPT = .1;
const busy = (c, pl) => clamp(glutFactor(c, pl) * (pl === 'arms' ? clamp(c.armShare * 4, .2, 1) : 1) * (pl === 'fuel' && !hasTech(c, 'oil_prospecting') && !c.stock.oil ? 0 : 1), KEPT, 1);
function extract(w, c) {
  const raw = Object.fromEntries(RAW.map(g => [g, 0])); let gold = 0, services = 0, dev = 0, popAll = 0;
  c._cap = Object.fromEntries(Object.keys(PLANTS).map(k => [k, 0])); c._cap0 = {};
  const engine = hasTech(c, 'combustion_engine') ? 1 + clamp(c.stock.fuel / Math.max(c._lastFuelNeed || 1, 1), 0, 1) * .25 * (c.motor ?? 0) : 1;
  // The harvest answers to the fertilizer that was actually put on the fields last quarter (c.fed, of the full dressing), not to what lies in store.
  const spread = inUse(w, c, 'chemical_fertilizer'), fert = spread > 0 ? 1 + (c.fed ?? clamp(c.stock.fertilizer / Math.max(c._pop * .002 * spread, 1), 0, 1)) * .4 * spread : 1;
  // Private owners keep up their mines and works out of what the tax on business leaves them (see investment): what they have let run down turns out less.
  const tended = 1 - (1 - (c.upkeep ?? 1)) * (1 - c.ownership);
  const strikes = c.strike ? .65 : 1, bank = c.bankHealth < 30 ? .8 : 1;
  c._rent = 0; c._idleV = 0; c._loose = 0; c._hands = 0; c._rawFull = Object.fromEntries(RAW.map(g => [g, 0]));
  const pace = Object.fromEntries(RAW.map(g => [g, glutFactor(c, g)])); c._pace = pace;
  for (const p of countryProvinces(w, c.id)) {
    const occ = p.controller !== p.owner ? .55 : 1;
    const rail = 1 + p.rail * .12 + .08 * inUse(w, c, 'electricity');
    const eff = (1 - p.devastation * .75) * (.72 + p.infra * .36) * occ * (1 - (p.unrest > 60 ? (p.unrest - 60) / 100 : 0)) * rail;
    const water = clamp(p.water - p.waterPenalty + (p.dam ? .15 : 0), .15, 1.4);
    // A province has only so much land. Hands beyond those it was farmed with add less and less, and fewer hands lose less than their share:
    // that is what lets a famine burn out instead of feeding on itself, and what makes a growing people need better farming.
    p.land ??= Math.max(p.pops.peasants.n, 1);
    const hands = p.land * Math.pow(Math.max(p.pops.peasants.n, 0) / p.land, .7);
    const grain = hands * p.fertility * water * .03 * c.tech.agri * eff * p.weather * fert * engine + p.fish * p.pops.peasants.n * .002, timber = p.pops.peasants.n * p.timber * .006 * eff;
    raw.grain += grain * pace.grain; raw.timber += timber * pace.timber; c._rawFull.grain += grain; c._rawFull.timber += timber;
    c._idleV += grain * (1 - pace.grain) * BASE_PRICE.grain + timber * (1 - pace.timber) * BASE_PRICE.timber;
    p.cap = {}; p.dug = {};
    const deposits = Object.entries(p.deposits).filter(([, d]) => d.known && d.mine > 0 && d.amount > 0);
    // A works gives work by its size: one step of a mill or a pit has places for as many hands as the province had working people when the
    // world was handed over (p.base; it is priced by that number, projects.js). Where the mills and pits of a province have places for more
    // hands than there are, the hands are shared among them by size; where they have places for fewer, the rest work in the small trades of the
    // town, at the building, the carting and the docks, and make no steel and no cloth. People who come to the towns find places in the mills
    // only as the mills are extended. (When every hand was shared out among whatever works stood there, a country that lost its pits made more steel.)
    p.base ??= Math.max(p.pops.workers.n, 1);
    // And a works keeps the hands it has work for. A pit whose coal lies unsold, a mill on short time because its yards are full, an arms
    // shop the state has asked for a third of what it can make, a refinery in a country that has not learned to refine: each holds that part
    // of its places and a few men to keep the fires in (KEPT), and the rest of its hands are in the other works of the town or in its small
    // trades. (World 18: a phosphate pit nobody bought from held 134 thousand hands for four years and raised nothing; an arms shop held 18
    // thousand and made a tenth of a unit; and a new coal pit in a country with coal to spare lowered what the country turned out, because
    // it took its share of the town's hands away from the mills.)
    const use = Object.fromEntries(Object.keys(PLANTS).map(pl => [pl, busy(c, pl)])), work = k => k === 'gold' ? 1 : clamp(pace[k] ?? 1, KEPT, 1);
    const mineLoad = sum(deposits, ([k, d]) => d.mine * work(k)), level = sum(Object.keys(PLANTS), pl => (p.plants[pl] || 0) * use[pl]), places = (mineLoad + level) * p.base, per = places > 0 ? Math.min(p.base, p.pops.workers.n * p.base / places) : 0;
    // (What stands idle is reckoned as before, on the hands a works would have if every works in the town were full: per0.)
    const all = (sum(deposits, ([, d]) => d.mine) + sum(Object.values(p.plants))) * p.base, per0 = all > 0 ? Math.min(p.base, p.pops.workers.n * p.base / all) : 0, slack = per > 0 ? per0 / per : 1;
    const loose = Math.max(0, p.pops.workers.n - places); c._loose += loose; c._hands += p.pops.workers.n; p.loose = loose;
    for (const [k, d] of deposits) {
      const full = per * d.mine * d.rich * ({ coal: .3, iron: .22, oil: .12 }[k] ?? .06) * c.tech.ind * eff * strikes * (1 - (p.halt?.[k] ?? 0)) * (k === 'gold' ? 1 : tended), f = k === 'gold' ? 1 : pace[k] ?? 1, q = full * f;
      if (k !== 'gold') c._rawFull[k] += full;
      if (f < 1) c._idleV += (full - q) * slack * BASE_PRICE[k];
      d.amount = Math.max(0, d.amount - q * .08);
      const con = p.concessions?.[k];
      if (k === 'gold') { gold += q; continue; }
      // A concession pays out only while the two countries still deal with each other: not across a war or an embargo.
      const pays = con && w.countries[con.holder]?.alive && !atWar(w, c.id, con.holder) && !c.embargo.includes(con.holder), kept = pays ? q * (1 - con.share) : q;
      if (pays) { const shipped = q - kept; w.countries[con.holder].stock[k] = (w.countries[con.holder].stock[k] || 0) + shipped; }
      raw[k] += kept; p.dug[k] = kept; c._rent += kept * BASE_PRICE[k] * (k === 'oil' ? 1.4 : 1);
      if (d.amount <= 0) news(w, `${c.name}: the ${p.name} ${GOOD_LABEL[k]} deposit is exhausted.`, { kind: 'economy', countries: [c.id] });
    }
    if (level > 0) for (const pl of Object.keys(PLANTS)) if (p.plants[pl] > 0) { const here = per * p.plants[pl] * clamp(.7 + p.plants[pl] * .35, .7, 3) * .05 * 25 / BASE_PRICE[pl] * c.tech.ind * eff * strikes * bank * (1 - c.ownership * .15) * (1 - (p.halt?.[pl] ?? 0)) * tended; c._cap[pl] += here; c._cap0[pl] = (c._cap0[pl] || 0) + here * slack; p.cap[pl] = here; }
    // A town has only so much carting, building and mending to be done: hands beyond those its small trades had when the world was handed over
    // add less and less, as on the land.
    p.trades ??= Math.max(loose, p.base * .1);
    services += (p.pops.middle.n + p.pops.elite.n * 1.5 + p.trades * Math.pow(loose / p.trades, .7) * SMALL) * eff;
    // What the province turned out this quarter, at ordinary prices, for whoever is asked what a work there would add (projects.js quote).
    p.grewV = grain * pace.grain * BASE_PRICE.grain; p.cutV = timber * pace.timber * BASE_PRICE.timber;
    p.out = p.grewV + p.cutV + sum(Object.entries(p.dug), ([k, q]) => q * BASE_PRICE[k]) + sum(Object.entries(p.cap), ([pl, q]) => q * use[pl] * BASE_PRICE[pl] * .45) + (p.pops.middle.n + p.pops.elite.n * 1.5 + p.trades * Math.pow(loose / p.trades, .7) * SMALL) * eff;
    const pop = provincePop(p); popAll += pop; dev += p.devastation * pop;
  }
  c._pop = popAll; c._dev = popAll ? dev / popAll : 0; c._raw = raw; c._services = services; c._capAll = { ...c._cap };
  c.reserves += gold * 12;
  for (const g of RAW) c.stock[g] = (c.stock[g] || 0) + raw[g];
}

function needs(w, c) {
  const need = {}; for (const g of GOODS) need[g] = 0;
  for (const [pl, rec] of Object.entries(RECIPE)) for (const [g, q] of Object.entries(rec)) need[g] += c._cap[pl] * q;
  const men = sum(Object.values(w.units).filter(u => u.country === c.id), u => u.men);
  const engine = sum(Object.values(w.units).filter(u => u.country === c.id && ['armor', 'air'].includes(u.kind)), u => u.men);
  const ships = sum(Object.values(w.fleets).filter(f => f.country === c.id), f => f.ships);
  // Knowing the engine is not the same as running a country on it. Towns, farms and the fleet go over to oil only as fast as oil is to be had (c.motor),
  // and go back to coal and horses when it fails; a country without oil keeps its coal-fired navy and loses nothing by the invention.
  const motor = hasTech(c, 'combustion_engine') ? c.motor ?? 0 : 0;
  // Hearths burn coal where coal is to be had at a price; where it is dear people burn wood, peat and straw and go cold sooner (at twice the usual
  // price about three fifths of the coal).
  const dear = g => clamp(Math.pow(Math.max(c.prices?.[g] ?? BASE_PRICE[g], .01) / BASE_PRICE[g] / Math.max(c.rer ?? 1, .2), -.6), .45, 1.15);
  c._hearth = c._pop * .001 * clamp(dear('coal') ** 1.2, .4, 1.1);
  need.grain += c._pop * .01; need.goods += c._pop * .004; need.coal += c._hearth + ships * .08 * (1 - motor);
  // Machinery wears out: what the country's works and farms use up in a quarter is what its engineering trade has to replace before anything new is built.
  need.arms += men * .01; need.fuel += engine * .05 + ships * .08 * motor + c._pop * .0006 * motor; need.machines += c._pop * .00014;
  // The army's keep: bread and boots in barracks, and in the field several times that, with coal for its trains and steel for its works.
  // It is a want of the country like any other (it is bought abroad when the stores run low, and it moves the world's prices), and it is met
  // before the towns' (consume).
  c._kit = kitOf(w, c); for (const [g, q] of Object.entries(c._kit)) need[g] += q;
  // What the guns burned last quarter the arsenal wants back, and an army at war wears out rifles and fires off cartridges in outpost fighting
  // whether or not a battle is fought: the market for arms feels a war.
  need.arms += (c._shot || 0) + (c.war?.on ? men * .004 : 0);
  // An army in the field takes wagons, horses, trains and the men who work them: carriage and the trades that live by it do less.
  { const field = c.war?.on ? men : 0, taken = clamp(field / Math.max(c._pop, 1) * 2.5, 0, .1); c._requisition = taken; if (taken > 0) c._services *= 1 - taken; }
  c._burn = { coal: ships * .08 * (1 - motor), fuel: engine * .05 + ships * .08 * motor };
  // Ordinary building. Towns grow, plant is renewed, lines are relaid and rolling stock replaced whether or not any government orders it: a
  // standing want of steel, timber and machinery in proportion to what the country turns out. It rises in good years and falls off in a slump,
  // with sick banks and when the materials are dear; it is what kept the mills of the age busy. Nobody decrees it: it is what owners and
  // townspeople do. (Without it nothing in the world wanted steel but arms and wares, and half of every mill stood still.)
  // War loans crowd the builder out: what lenders add to the state's interest for the war they add to everybody's, and wagons and navvies are with the army.
  const crowd = clamp(1 - (c.war?.premium || 0) * 30, .6, 1) * (1 - clamp((c._requisition || 0) * 1.6, 0, .25));
  const pulse = clamp(1 + ((c.trend ?? USUAL_GROWTH) - USUAL_GROWTH) * BOOM, .5, 1.35) * (c.bankHealth < 30 ? .6 : 1) * (1 - clamp(c._dev || 0, 0, .5)) * crowd;
  c._build = Object.fromEntries(Object.entries(BUILDING).map(([g, q]) => [g, q * Math.max(c.realGdp || 0, 0) * pulse * dear(g)]));
  for (const [g, q] of Object.entries(c._build)) need[g] += q;
  // Fertilizer is bought by farmers, and farmers buy less of it the dearer it is: at twice its usual price about half the full dressing goes on the fields.
  c._dose = hasTech(c, 'chemical_fertilizer') ? clamp(Math.pow(Math.max(c.prices?.fertilizer ?? BASE_PRICE.fertilizer, .01) / BASE_PRICE.fertilizer / Math.max(c.rer ?? 1, .2), -1), .1, 1) : 0;
  if (hasTech(c, 'chemical_fertilizer')) need.fertilizer += c._pop * .002 * inUse(w, c, 'chemical_fertilizer') * c._dose;
  if (hasTech(c, 'rare_alloys')) need.rare += sum(Object.values(w.units).filter(u => u.country === c.id && ['armor', 'air'].includes(u.kind)), u => u.men) * .004 + c._cap.machines * .05;
  c._need = need; c._lastFuelNeed = need.fuel;
  c._reserve = Object.fromEntries(GOODS.map(g => [g, need[g] * .4]));
  localPrices(w, c);
}

// What a country's gold is spent on first when there is not enough of it for everything it would buy abroad. Left alone, merchants and millers see to
// bread first, then what the works need, and consumer goods last; whoever governs can set another order (c.imports.order), and goods it does not name follow in the usual one.
export const usualOrder = () => ['grain', ...GOODS.filter(g => g !== 'grain' && g !== 'goods'), 'goods'];
export const importOrder = c => { const set = (c.imports?.order || []).filter(g => GOODS.includes(g)); return [...set, ...usualOrder().filter(g => !set.includes(g))]; };
// A rule at the frontier holds as far as the customs service does. What a thin or venal service cannot stop comes in or goes out by other roads, and pays no duty.
export const sealOf = (w, c) => w.friction ? clamp(.3 + c.bureaucracy / 100, .35, 1) * (1 - c.corruption / 200) : 1;
// The duty one good pays coming in: what a treaty fixed with that seller, else a duty the government has aimed at that country's goods, else
// its own rule for the good, else the general tariff.
const usualDuty = (c, g) => c.imports?.rules?.[g]?.tariff ?? c.tariff;
// What part of the country's ordinary buying abroad still comes in over its own duty on the good. Wares fall off fastest; bread less (people
// must eat); and coal, ore and timber least of all, because a mill that wants coal wants it at any duty: the duty is paid and the coal comes.
const SHY = { grain: .5, goods: 1.2, coal: .2, iron: .2, copper: .2, oil: .2, phosphate: .2, rare: .2, timber: .3, steel: .5, machines: .5 };
// What a trade that must buy its material abroad keeps lying beyond the quarter's need, in quarters of that need: a works that lives on
// foreign coal has some months of it in the yard, where a town buys its bread and its cloth from week to week.
const KEEP = { coal: 1.5, iron: 1.5, copper: 1.5, oil: 1, phosphate: 1, timber: 1, steel: .7, machines: 1 };
export const wallOf = (c, g) => 1 - clamp((usualDuty(c, g) || 0) * (SHY[g] ?? .8), 0, .8);
const dutyOn = (c, g, from) => c.tariffDeals?.[from] ?? c.aimed?.[from] ?? usualDuty(c, g);
// A duty aimed at one seller sends merchants to the others and, the dearer it is, keeps the goods out: of what would have come from there, this much still does.
const aimedTrade = (c, g, from) => c.tariffDeals?.[from] != null || c.aimed?.[from] == null ? 1 : clamp(1 - Math.max(0, c.aimed[from] - usualDuty(c, g)) * 1.2, .1, 1);
// Goods a government has forbidden its merchants to sell to one country, or to buy from it. The ban holds as far as the customs service reaches.
const banned = (w, buyer, seller, g) => { const out = seller.bans?.[buyer.id]?.sell.includes(g) ? sealOf(w, seller) : 0, inn = buyer.bans?.[seller.id]?.buy.includes(g) ? sealOf(w, buyer) : 0; return 1 - (1 - out) * (1 - inn); };

function trade(w, cs) {
  w.tradeFlows = {}; const carried = [], traffic = {}; for (const c of cs) c._from = {};
  const insurer = [...cs].filter(c => !c.war?.on).sort((a, b) => (b.shipping || 0) - (a.shipping || 0))[0] ?? null; for (const c of cs) c._premiums = 0;
  const key = routeKey;
  for (const c of cs) { c.lastSold = {}; c.lastBought = {}; c.lastOrders = []; }
  // What merchants would bring in of a good, and how much of that the law lets through: a prohibition or a quota cuts it, and the part the customs cannot hold back is smuggled.
  // A duty makes the foreign thing dearer at home and fewer people buy it: wares fall off fastest, bread least (people must eat).
  const wantOf = (c, g) => { const usual = Math.max(0, c._need[g] * (1 + (KEEP[g] ?? .2)) - c.stock[g]) * wallOf(c, g) + displacedDemand(c, g), r = c.imports?.rules?.[g]; if (!r || (!r.ban && r.quota == null)) return { usual, legal: usual }; const legal = r.ban ? 0 : Math.min(usual, r.quota); return { usual: legal + (usual - legal) * (1 - sealOf(w, c)), legal }; };
  // The state's own order abroad is the treasury's purchase: it reaches as far as the cash above the working balance and what lenders will add, at the day's price and exchange.
  const affords = (c, g) => (Math.max(0, c.treasury - (c.till || 0)) + Math.max(0, creditLeft(c))) / Math.max(w.globalPrice[g] * (c.rate || 1) * 1.05, .01);
  const stateOrder = (c, g) => { const o = c.orders?.[g]; return o && (!(o.limit > 0) || w.globalPrice[g] <= o.limit) ? Math.min(o.amount, affords(c, g)) : 0; };
  // The gold a country has to spend abroad this quarter is what lies in its reserve beyond the debt service, and about what its exports brought in the quarter before.
  // It is shared out among the goods in the order of priority: each good may draw on its own share, and on whatever no good has claimed.
  for (const c of cs) {
    // Merchants pay for what they bring in with the exchange the country's own sales earn. The gold reserve stands behind that: freely for bread,
    // for whatever the government has put first in the order of imports, and for whatever it orders abroad itself; for the rest only while it
    // lies above the floor the banks are told to keep (c.goldFloor), and then a quarter of the excess at a time. Where no government has said
    // otherwise the floor is three fifths of what the country was used to holding, so that a country that sells little buys little and is not
    // emptied of its gold by cloth and boots; a government may open the reserve altogether or shut it up (set_gold_floor), and answers for either.
    c.goldBase ??= Math.max(0, c.reserves); c.goldFloor ??= c.goldBase * .6;
    let left = Math.max(0, c.reserves - (c._debtService || 0)) + (c.lastExportGold || 0), rest = Math.min(left, (c.lastExportGold || 0) + Math.max(0, c.reserves - (c._debtService || 0) - c.goldFloor) * .25); c._alloc = {};
    for (const g of importOrder(c)) { const own = stateOrder(c, g), free = g === 'grain' || own > 0 || (c.imports?.order || []).includes(g), cost = (wantOf(c, g).usual + own) * w.globalPrice[g] * 1.1, part = Math.min(cost, free ? left : rest); c._alloc[g] = part; left -= part; rest = Math.min(left, free ? rest : rest - part); }
    c._spare = Math.max(0, rest); c._exportGold = 0; c._duty = 0;
  }
  // Markets sit in an order: first the materials and wares a country sells for gold, then bread, and consumer goods last. A poor country spends what
  // its coal and timber earned that quarter on grain before it spends it on cloth and boots.
  for (const g of [...GOODS.filter(x => x !== 'grain' && x !== 'goods'), 'grain', 'goods']) {
    // A government can also go to the foreign markets itself for one quarter: an order to buy beyond what the country's trade brings in of its own accord,
    // or an offer of goods out of its stores beyond what merchants would let go. Either holds only while the price stays inside the limit it was given.
    const price = w.globalPrice[g], wants = c => stateOrder(c, g), offers = c => { const o = c.sales?.[g]; return o && (!(o.limit > 0) || price >= o.limit) ? Math.min(o.amount, Math.max(0, c.stock[g] || 0)) : 0; };
    // What merchants may send out: all they can spare, unless the government has forbidden the export or set a quota on it (and then what slips past the customs still goes).
    const mayGo = c => { const all = Math.max(0, c.stock[g] - c._need[g] - c._reserve[g]), r = c.exports?.[g]; if (!r || (!r.ban && r.quota == null)) return all; const legal = r.ban ? 0 : Math.min(all, r.quota); return legal + (all - legal) * (1 - sealOf(w, c)); };
    const sellers = cs.map(c => ({ c, s: Math.max(mayGo(c), offers(c)) })).filter(x => x.s > 0);
    const buyers = cs.map(c => { const { usual, legal } = wantOf(c, g), state = wants(c); return { c, usual, d: usual + state, taxed: usual + state > 0 ? (legal + state) / (usual + state) : 1 }; }).filter(x => x.d > 0);
    const spare = Object.fromEntries(sellers.map(x => [x.c.id, mayGo(x.c)])); // Only a want with gold behind it is demand: a hungry country with an empty reserve does not bid the world price up.
    let wanted = sum(buyers, b => Math.min(b.d, Math.max(0, b.c.reserves - (b.c._debtService || 0)) / Math.max(price, .01))), moved = 0; const offered = sum(sellers, s => s.s);
    for (let pass = 0; pass < 2; pass++) for (const b of buyers) {
      if (b.d <= 0) continue;
      const acc = sellers.map(x => ({ x, r: routeFor(w.routes[key(b.c.id, x.c.id)], g) })).filter(a => a.x.s > 0 && a.x.c.id !== b.c.id && a.r);
      // How much of the trade between a buyer and one seller the law leaves standing: all of it, unless a duty is aimed at that seller or goods are banned between the two.
      const open = a => aimedTrade(b.c, g, a.x.c.id) * (1 - banned(w, b.c, a.x.c, g));
      // Merchants shun a risk more than they shun its price: between a seller at war and one at peace the custom goes to the one at peace when he has the goods.
      const wgt = a => a.x.s / a.r.cost * (hasTreaty(w, b.c.id, a.x.c.id, 'trade') ? 1.5 : 1) * exportEdge(a.x.c) * open(a) * (1 - clamp((a.r.war || 0) * 4, 0, .7)), tot = sum(acc, wgt);
      if (!tot) continue;
      for (const a of acc) {
        const duty = dutyOn(b.c, g, a.x.c.id), landed = price * a.r.cost * (1 + duty * .3);
        // Gold owed to foreign creditors this quarter is not spent on imports: the debt is served first, and imports shrink instead.
        // And a good draws only on its own share of the quarter's gold and on what no other good has claimed.
        const q = Math.min(a.x.s * open(a), b.d * wgt(a) / tot, Math.max(0, b.c.reserves - (b.c._debtService || 0)) / landed, ((b.c._alloc?.[g] ?? Infinity) + (b.c._spare ?? 0)) / (price * a.r.cost));
        if (q <= 0) continue;
        const v = q * price; a.x.s -= q; b.d -= q; moved += q; a.x.c.lastSold[g] = (a.x.c.lastSold[g] || 0) + q;
        // Freight goes to the exporter, customs to the buyer's own treasury: gold does not vanish from the world.
        // The war premium on a cargo is not the exporter's: it is paid to the houses that insure and carry at their own risk, which sit in the
        // state at peace with the most ships. (Gold does not vanish: one country's war is that country's business.)
        const gold = v * a.r.cost, risk = insurer && insurer.id !== a.x.c.id ? v * (a.r.war || 0) : 0; a.x.c.stock[g] -= q; b.c.stock[g] += q; a.x.c.reserves += gold - risk; b.c.reserves -= gold;
        if (risk > 0) { insurer.reserves += risk; insurer._premiums = (insurer._premiums || 0) + risk; }
        if (a.r.mode === 'sea') carried.push([a.x.c.id, b.c.id, q, v * (a.r.water || 0)]);
        // What passed where, for whoever asks what a place is worth to the world's trade (w.traffic).
        for (const id of a.r.nodes || []) { const t = (traffic[id] ||= { v: 0, by: {} }), pair = key(b.c.id, a.x.c.id); t.v += v; t.by[pair] = (t.by[pair] || 0) + v; }
        // Who sold whom what, for the yearbooks: a state's dependence on another is a fact anybody can add up from the trade returns.
        ((b.c._from ||= {})[g] ||= {})[a.x.c.id] = ((b.c._from[g] ||= {})[a.x.c.id] || 0) + q;
        if (b.c._alloc) { const own = Math.min(b.c._alloc[g] ?? 0, gold); b.c._alloc[g] = (b.c._alloc[g] ?? 0) - own; b.c._spare = Math.max(0, (b.c._spare ?? 0) - (gold - own)); }
        // Duty is paid on what came through the customs house, at the rate that good pays; smuggled goods pay none.
        a.x.c._exportGold = (a.x.c._exportGold || 0) + gold - risk; b.c._duty = (b.c._duty || 0) + v * duty * b.taxed;
        a.x.c._exports = (a.x.c._exports || 0) + v; b.c._imports = (b.c._imports || 0) + v;
        a.x.c._rawExp = (a.x.c._rawExp || 0) + (RAW.includes(g) && g !== 'grain' ? v : 0);
        // The toll is part of what the buyer paid; it is passed on to whoever holds the strait, not minted anew.
        for (const tid of a.r.tolls) { const t = w.strategic.find(s => s.id === tid); if (t?.controller) { const fee = Math.min(v * t.toll, Math.max(a.x.c.reserves, 0)); a.x.c.reserves -= fee; w.countries[t.controller].reserves += fee; w.countries[t.controller]._tolls = (w.countries[t.controller]._tolls || 0) + fee; } }
        // A state that lays a due on what crosses its soil is paid it the same way.
        for (const d of a.r.dues || []) { const t = w.countries[d.to]; if (t?.alive) { const fee = Math.min(v * d.rate, Math.max(a.x.c.reserves, 0)); a.x.c.reserves -= fee; t.reserves += fee; t._tolls = (t._tolls || 0) + fee; } }
        b.c.lastBought[g] = (b.c.lastBought[g] || 0) + q;
        const k = key(b.c.id, a.x.c.id); (w.tradeFlows[k] ||= {}); w.tradeFlows[k][g] = (w.tradeFlows[k][g] || 0) + v;
      }
    }
    // The customs house reports to whoever governs what became of the order: the first of what arrived went to the country's ordinary wants.
    for (const c of cs) {
      const o = c.orders?.[g], s = c.sales?.[g], say = text => { (c.lastOrders ||= []).push({ turn: w.turn, text }); const ch = w.characters[c.leader]; if (ch?.alive) ch.inbox.push({ turn: w.turn, from: 'The customs house', text }); };
      if (o) { const b = buyers.find(x => x.c === c), got = clamp((c.lastBought[g] || 0) - (b?.usual ?? 0), 0, o.amount), held = o.limit > 0 && price > o.limit, short = !held && affords(c, g) < o.amount * .98;
        // The treasury pays its supplier, in its own money at the day's exchange; the gold the purchase cost has already left the reserve with the goods.
        const bill = got * price * 1.05 * (c.rate || 1), paid = treasuryPays(c, bill); if (paid > 0) (c._outlay ||= {}).purchases = (c._outlay.purchases || 0) + paid;
        say(held ? `The order for ${Math.round(o.amount * 10) / 10} of ${GOOD_LABEL[g]} was not placed: the world price stood at ${Math.round(price * 10) / 10}, above the limit of ${o.limit}.` : `Of the ${Math.round(o.amount * 10) / 10} of ${GOOD_LABEL[g]} ordered abroad, ${Math.round(got * 10) / 10} arrived, at a world price of about ${Math.round(price * 10) / 10} a unit; the treasury paid ${Math.round(paid)} for it, and that much gold left the reserve.${got < o.amount * .98 ? (short ? ' The treasury and its lenders could pay for no more.' : ' The rest found no seller with a surplus on an open route, or no gold to pay for it.') : ''}`);
        delete c.orders[g]; }
      if (s) { const sold = clamp((c.lastSold[g] || 0) - (spare[c.id] ?? 0), 0, s.amount), all = Math.min(c.lastSold[g] || 0, s.amount), held = s.limit > 0 && price < s.limit;
        // What was sold out of the state's own stores is the treasury's sale: it is credited in the country's money, and the gold lies in the reserve.
        const takings = sold * price * (c.rate || 1); if (takings > 0) c.treasury += takings;
        say(held ? `The ${Math.round(s.amount * 10) / 10} of ${GOOD_LABEL[g]} offered abroad was held back: the world price stood at ${Math.round(price * 10) / 10}, below the limit of ${s.limit}.` : `Of the ${Math.round(s.amount * 10) / 10} of ${GOOD_LABEL[g]} offered abroad, ${Math.round(all * 10) / 10} was sold, at a world price of about ${Math.round(price * 10) / 10} a unit, for gold${sold > .05 ? ` (${Math.round(sold * 10) / 10} of it out of stores the country would otherwise have kept, which brought the treasury ${Math.round(takings)})` : ''}.${all < s.amount * .98 ? ' The rest found no buyer in want of it on an open route.' : ''}`);
        delete c.sales[g]; }
    }
    const unmet = wanted > 0 ? clamp((wanted - moved) / wanted, 0, 1) : 0;
    // Durable goods are held in deeper stores everywhere, so a world with years of machinery in hand is not a world glutted with it.
    // (The stores are read as they stood before this quarter's wares came out of the mills, which is how the usual depths were measured; and for
    // steel and the like before the engine works and arms shops drew on them, which is when the mills themselves judge whether their yards are full.)
    // What a state at war has to sell is not as good as on the market: its cargoes come dearer and fewer, and buyers do not count on them. The
    // exchanges reckon half of what it could spare abroad (its stock beyond its own want and reserve) as not there, which is how a war in the
    // country that sells much of a thing makes that thing dear for everybody, and leaves the price of what it does not sell alone.
    const held = c => c.war?.on ? .5 * Math.max(0, (c.stock[g] || 0) - (c._need?.[g] || 0) - (c._reserve?.[g] || 0)) : 0;
    const before = w.globalPrice[g], D = sum(cs, c => c._need[g]) + 1, S = (sum(cs, c => Math.max(0, c.stock[g] - (c._made?.[g] || 0) + (RECIPE[g] ? c._drawn?.[g] || 0 : 0) - held(c))) + moved * .2) / ((USUAL_COVER[g] ?? 2) / 2) + 1;
    const target = BASE_PRICE[g] * clamp(Math.pow(D / S * 1.6, .8), .4, 5) * (1 + unmet * .9);
    w.globalPrice[g] = clamp(before + (target - before) * .4, BASE_PRICE[g] * .3, BASE_PRICE[g] * 9);
    if (w.globalPrice[g] > before * 1.5 && before > BASE_PRICE[g]) news(w, `World ${GOOD_LABEL[g]} price rose sharply.`, { kind: 'economy' });
  }
  for (const c of cs) { c.lastExportGold = c._exportGold || 0; delete c._alloc; delete c._spare; delete c._exportGold; }
  w.traffic = traffic;
  merchantStep(w, cs, carried);
}

function factories(w, c) {
  const made = {};
  const armsPriority = clamp(c.armShare * 4, .2, 1);
  // Why each kind of works made less than it could (c._still): the stores were full and nobody was buying, the state asked the arms shops for
  // only part of what they can make, or a material ran out, and which one. The same figures the works were run on, kept for whoever asks.
  c._still = {}; let could = 0;
  for (const pl of ORDER) {
    const pace = glutFactor(c, pl), asked = pl === 'arms' ? armsPriority : 1, cap = c._cap[pl] * asked * pace, rec = RECIPE[pl], full = c._cap[pl];
    c._cap[pl] *= pace; if (pace < 1) c._idleV += (c._cap0?.[pl] ?? full) * asked * (1 - pace) * BASE_PRICE[pl] * .45;
    if (pl === 'fuel' && !hasTech(c, 'oil_prospecting') && !c.stock.oil) { made[pl] = 0; continue; }
    let r = cap, lack = null;
    for (const [g, q] of Object.entries(rec)) if ((c.stock[g] || 0) / q < r) { r = (c.stock[g] || 0) / q; lack = g; }
    r = Math.max(0, r);
    for (const [g, q] of Object.entries(rec)) c.stock[g] -= r * q;
    c.stock[pl] = (c.stock[pl] || 0) + r; made[pl] = r; could += cap * BASE_PRICE[pl];
    c._still[pl] = { full, buyers: full * (1 - pace), orders: full * pace * (1 - asked), materials: cap - r, lack: cap - r > full * .005 ? lack : null };
  }
  // Works idle for want of materials, as a part of what the works were set to make (short time for full stores and arms not ordered are not want of materials).
  c.inputRatio = could > 0 ? clamp(sum(Object.keys(RECIPE), pl => (made[pl] || 0) * BASE_PRICE[pl]) / could, 0, 1) : 1;
  c._drawn = Object.fromEntries(GOODS.map(g => [g, sum(Object.entries(RECIPE), ([pl, rec]) => (made[pl] || 0) * (rec[g] || 0))]));
  c._made = made;
}

// War frightens money. In the quarter a war begins part of the country's gold leaves for the safest state that is at peace and lets money in (more
// from the state attacked than from the one that chose its day), and it goes on leaving, more slowly, while the enemy holds more of the country's
// land than it holds of his. Controls on capital hold what the customs can hold. The gold is not lost to the world: it is the quiet country's gain.
function warFlight(w, cs) {
  const tell = (ch, text) => { if (ch?.alive) ch.inbox.push({ turn: w.turn, from: 'Treasury', text }); }, from = {};
  for (const c of cs) { c._warFlight = 0; const x = c.war; if (!x?.on) continue;
    const share = (x.begun ? (x.struck ? .03 : .06) : x.losing ? .02 : 0) * (c.capitalClosed ? 1 - sealOf(w, c) : 1); if (!(share > 0)) continue;
    const haven = cs.filter(o => o.id !== c.id && !o.war?.on && !o.capitalClosed).sort((a, b) => b.legitimacy - a.legitimacy)[0], out = haven ? Math.max(c.reserves, 0) * share : 0; if (!(out > .5)) continue;
    c.reserves -= out; haven.reserves += out; c._warFlight = out; (from[haven.id] ||= []).push([c, out]);
    if (x.begun) tell(w.characters[c.leader], `War has frightened money. About ${Math.round(out)} in gold left the country this quarter for ${haven.name}${c.capitalClosed ? ', past the controls on capital' : '; closing the movement of capital would hold most of what is still here'}, and more will go for as long as the enemy holds more of our land than we hold of his. ${lendersWords(c)}`); }
  for (const [id, xs] of Object.entries(from)) { const h = w.countries[id], n = sum(xs, x => x[1]); h._haven = n; if (n >= Math.max(5, h.reserves * .005)) tell(w.characters[h.leader], `Money is coming in from states at war: about ${Math.round(n)} in gold this quarter, out of ${xs.map(x => x[0].name).join(' and ')}. It came because this country is at peace and thought safe, and it adds to the reserve.`); }
  for (const c of cs) if (!from[c.id]) c._haven = 0;
}

export function economyStep(w) {
  warFooting(w);
  updateStrategic(w); updateRoutes(w); updateRer(w); weatherStep(w);
  const cs = aliveCountries(w), prevReal = Object.fromEntries(cs.map(c => [c.id, c.realGdp]));
  warFlight(w, cs);
  // The mills run before the market meets: what a country's works turned out this quarter is on the quay when the merchants deal. (When the
  // market met first, no maker ever had wares to spare, and no country that made its own could tell that it did.)
  for (const c of cs) { extract(w, c); needs(w, c); factories(w, c); }
  trade(w, cs);
  w.priceHistory.push(Object.fromEntries(GOODS.map(g => [g, Math.round(w.globalPrice[g] * 10) / 10])));
  if (w.priceHistory.length > 200) w.priceHistory.shift();
  // Why prices stand where they do, as the exchanges explain it: for every report that speaks of prices, and in print when a war is behind a rise.
  marketStep(w, cs);
  for (const c of cs) {
    consume(w, c, prevReal[c.id]);
    fiscal(w, c); currencyStep(w, c); demography(w, c); investment(w, c); research(w, c);
    for (const k of ['_exports', '_imports', '_rawExp', '_tolls', '_duty']) delete c[k];
  }
  epidemicStep(w);
}

function consume(w, c, prev) {
  const n = c._need;
  // In war the army is fed, clothed and supplied out of the country's stores before the towns are; in peace a garrison goes as short of bread and
  // cloth as the people it lives among. What the stores could not send it is felt in the ranks (c.kit).
  { let want = 0, got = 0; c._kitTook = {}; const first = !!c.war?.on, civil = { grain: c._pop * .01, goods: c._pop * .004 };
    for (const [g, q] of Object.entries(c._kit || {})) { const have = Math.max(0, c.stock[g] || 0), take = first || !civil[g] ? Math.min(q, have) : Math.min(q, have * q / (civil[g] + q)); c.stock[g] -= take; c._kitTook[g] = take; want += q * BASE_PRICE[g]; got += take * BASE_PRICE[g]; } c.kit = want > 0 ? got / want : 1; }
  c.foodRatio = n.grain > 0 ? clamp(c.stock.grain / (c._pop * .01), 0, 1.2) : 1;
  c.stock.grain = Math.max(0, c.stock.grain - c._pop * .01) * .96;
  const consumer = clamp(c.stock.goods / Math.max(c._pop * .004, 1), 0, 1.2);
  c.stock.goods = Math.max(0, c.stock.goods - c._pop * .004) * .96;
  // What the fleet and the motorised army burn, the fields take and the workshops use really leaves the stores.
  c.stock.coal = Math.max(0, c.stock.coal - (c._hearth ?? c._pop * .001) - (c._burn?.coal || 0));
  // What the country itself used up this quarter, beyond what its works drew (c._drawn): for whoever asks how long the stores will last.
  c._used = { grain: c._pop * .01 * Math.min(c.foodRatio, 1), goods: c._pop * .004 * Math.min(consumer, 1), coal: (c._hearth ?? c._pop * .001) + (c._burn?.coal || 0), machines: c._pop * .00014 };
  for (const [g, q] of Object.entries(c._kitTook || {})) c._used[g] = (c._used[g] || 0) + q;
  if (hasTech(c, 'combustion_engine')) {
    const m = c.motor ?? 0; c.fuelRatio = n.fuel > .05 ? clamp(c.stock.fuel / n.fuel, 0, 1.2) : 1; c.stock.fuel = Math.max(0, c.stock.fuel - c._pop * .0006 * m - (c._burn?.fuel || 0));
    // With fuel to spare more of the country takes to the engine; when the tanks run dry it goes back.
    c.motor = clamp(m + (c.stock.fuel > Math.max(n.fuel, c._pop * .0006 * .25) ? .04 : c.fuelRatio < .6 ? -.1 : 0), 0, 1);
  } else c.fuelRatio = 1;
  if (hasTech(c, 'chemical_fertilizer')) { const full = c._pop * .002 * inUse(w, c, 'chemical_fertilizer'), on = Math.min(c.stock.fertilizer || 0, full * (c._dose ?? 1)); c.stock.fertilizer = Math.max(0, (c.stock.fertilizer || 0) - on); c.fed = full > 0 ? on / full : 0; }
  // Ordinary building takes its steel, timber and machinery out of the country's stores after the works have had theirs, and never the last of
  // them: a quarter's want of the works is left lying, and of what lies beyond that builders get at most half in a quarter. What they could not
  // get is not built: the building trades stand idle (unemployment) and plant that is not renewed runs down (c.built, investment).
  // It is measured against what a country of this size builds in an ordinary year, so that building put off because steel is dear counts as not built.
  { let got = 0, usual = 0; c._built = {};
    for (const [g, q] of Object.entries(c._build || {})) { const take = Math.min(q, Math.max(0, (c.stock[g] || 0) - (n[g] - q)) * .5); c.stock[g] -= take; c._built[g] = take; got += take * BASE_PRICE[g]; usual += BUILDING[g] * Math.max(prev || c.realGdp || 0, 0) * BASE_PRICE[g]; }
    c.buildRatio = usual > 0 ? clamp(got / usual, 0, 1.3) : 1; c.built = (c.built ?? c.buildRatio) * .8 + c.buildRatio * .2; for (const [g, q] of Object.entries(c._built)) c._used[g] = (c._used[g] || 0) + q; }
  if (n.rare > 0) c.stock.rare = Math.max(0, (c.stock.rare || 0) - n.rare);
  // Nothing keeps for ever: what lies in store beyond two years' need rusts, rots or is written off.
  for (const good of GOODS) { const keep = (n[good] || 0) * 8; if (good !== 'grain' && good !== 'goods' && c.stock[good] > keep) c.stock[good] -= (c.stock[good] - keep) * .04; }
  const rawV = sum(RAW, g => c._raw[g] * BASE_PRICE[g]), madeV = sum(Object.keys(RECIPE), g => (c._made[g] || 0) * BASE_PRICE[g] * .45);
  // The first quarter has no measured past to compare with, so it counts as no growth rather than a boom or a slump.
  const real = rawV + madeV + c._services, g = prev > 0 && c._measured ? real / prev - 1 : 0;
  c._measured = true; c.realGdp = real; c.growth = g; c.trend = (c.trend ?? 0) * .7 + g * .3;
  const prevM = c._lastMoney ?? c.money, mg = prevM > 0 ? c.money / prevM - 1 : 0;
  // What the shops have against what people are used to finding there is felt in the towns (moodParts); the level a country inherited is its ordinary lot.
  c.goodsRatio = consumer; c.shopBase ??= Math.min(consumer, 1);
  const shortage = Math.max(0, 1 - Math.min(c.foodRatio, 1)) * .55 + Math.max(0, 1 - Math.min(consumer, 1)) * .25 + (hasTech(c, 'combustion_engine') ? Math.max(0, 1 - Math.min(c.fuelRatio, 1)) * .18 * (c.motor ?? 0) : 0);
  // Scarcity raises prices once; sustained inflation needs worsening scarcity or money growth.
  const shock = shortage - (c._lastShortage ?? shortage); c._lastShortage = shortage;
  // Money follows output of itself. What moves prices is money made or lost beyond that (the printing press, gold flowing in or out), scarcity and the exchange rate.
  // A currency tied to gold has an anchor; one that floats drifts a little every quarter.
  // The same sum, kept in its parts so that whoever governs can be told what moved prices.
  c.lastPrices = { carried: .35 * c.inflation, money: .85 * mg, scarcity: shock * .4, currency: c._fxPass || 0, gold: c.reserves < 0 ? .03 : 0, banks: c.bankHealth < 30 ? .02 : 0, drift: c.fxRegime === 'floating' ? .004 : .001 };
  c.inflation = clamp(.35 * c.inflation + .85 * mg + shock * .4 + (c._fxPass || 0) + (c.reserves < 0 ? .03 : 0) + (c.bankHealth < 30 ? .02 : 0) + (c.fxRegime === 'floating' ? .004 : .001), -.04, 4);
  c.priceLevel *= 1 + c.inflation; c.wageIndex += (c.priceLevel - c.wageIndex) * .35;
  c.gdp = real * c.priceLevel; c.money *= 1 + g * .6 + .002; c._lastMoney = c.money;
  c.idleShare = clamp(c._idleV / Math.max(real + c._idleV, 1), 0, 1);
  // Building is work for hands. What is being spent this quarter on works in hand, the state's or a company's, takes people off the streets while it lasts.
  const works = clamp((c._works || 0) / Math.max(real, 1) * .6, 0, .1);
  // Works that are not kept up employ fewer hands: what private owners have let run down under the tax on business puts people on the street
  // long before the country runs short of what those works made. (Works being extended take a few on.)
  const rundown = clamp((1 - (c.upkeep ?? 1)) * (1 - c.ownership) * .35, -.03, .2);
  // The building trades are a good part of a town's work: when ordinary building stops for want of steel or timber, or shrinks in a slump, its men are on the street.
  const yards = clamp((1 - (c.buildRatio ?? 1) / (c.builtBase ?? 1)) * .05, -.01, .05);
  c.lastJobs = { inputs: (1 - c.inputRatio) * .3, damage: c._dev * .3, slump: Math.max(0, -g) * .9, idle: c.idleShare * .13, rundown, yards, works };
  c.unemployment += (clamp(.06 + (1 - c.inputRatio) * .3 + c._dev * .3 + Math.max(0, -g) * .9 + c.idleShare * .13 + rundown + yards - works, .02, .6) - c.unemployment) * .4;
  // Resource-rent dependence: easy money feeds corruption and oligarchs and weakens industry. It begins where a country lives by its pits in
  // earnest, an eighth of all it turns out (no state reached the old mark of more than a fifth; the richest coal and ore states stand near a
  // tenth), and is in full force at a fifth and beyond.
  c.rentShare = clamp((c._rent || 0) / Math.max(real, 1), 0, 1);
  if (c.rentShare > CURSE) { const hold = clamp((c.rentShare - CURSE) / .1, 0, 1); c.corruption = clamp(c.corruption + (c.rentShare - CURSE) * 2.2, 2, 95); const o = w.characters[c.oligarch]; if (o?.alive) { o.wealth += c.rentShare * 5 * hold; o.power = clamp(o.power + c.rentShare * .3 * hold, 0, 95); } for (const p of countryProvinces(w, c.id)) if (p.eth !== c.majorityEth && Object.values(p.deposits).some(d => d.known && d.mine > 0)) p.unrest = clamp(p.unrest + 2.2 * hold, 0, 100); }
  c.bankHealth = clamp(c.bankHealth + (c.inflation > .15 ? -6 : 1.2) + (c.reserves < 0 ? -4 : 0) + (g < -.08 ? -4 : 0), 0, 100);
  if (c.bankHealth < 30 && !c.bankCrisis) { c.bankCrisis = true; news(w, `${c.name}: a run on the banks has begun, credit is drying up.`, { kind: 'economy', countries: [c.id] }); } if (c.bankHealth > 45) c.bankCrisis = false;
  const klass = sum(countryProvinces(w, c.id), p => p.pops.workers.sat * p.pops.workers.n) / Math.max(sum(countryProvinces(w, c.id), p => p.pops.workers.n), 1);
  // Working people strike when their lot has grown worse than the one they have lived with, not because it is as bad as it always was: the temper
  // a country was handed over with (c.workBase) is its ordinary state, and a people long used to little walks out when it gets less.
  // A general strike is not a coin tossed every quarter. It breaks out when working people are bitter beyond bearing and free to organise, and it holds
  // until their lot is mended or their strike funds and bread give out, which comes sooner where there is no relief and no other work. After it the
  // unions need two years before they can call out the whole country again.
  if (c.strike) {
    const held = w.turn - (c.strikeSince ?? w.turn), lasts = 2 + (c.budget.welfare * (c.paidRatio ?? 1) > .03 ? 1 : 0) - (c.unemployment > .15 ? 1 : 0);
    if (!c.unions || klass >= 34 || held >= lasts) { c.strike = false; c.strikeRest = w.turn + 8; news(w, `${c.name}: the general strike is over${klass >= 34 ? '; the men went back with something to show for it' : !c.unions ? '; the unions were broken' : '; the strike funds ran out and the men went back with nothing'}.`, { kind: 'politics', countries: [c.id] }); }
  } else if (c.unions && klass < Math.min(28, (c.workBase ??= klass) - 2) && w.turn >= (c.strikeRest ?? 0)) { c.strike = true; c.strikeSince = w.turn; news(w, `${c.name}: a general strike has brought industry to a halt.`, { kind: 'politics', countries: [c.id] }); }
}

// How far past their bare keep the forces can put money to use.
export const FULL_KIT = 1.3;
function fiscal(w, c) {
  const eff = clamp((.4 + c.bureaucracy / 120) * (1 - c.corruption / 130) * (1 - (c.unrest ?? 0) / 400) * (c._adminFactor ?? 1) * (c.service?.treasury ?? 1), .2, 1);
  // What the country's ships earned carrying cargoes is a business like another and pays the tax on business: the freights come in as gold.
  const shipping = (c._freightIn || 0) * (c.rate || 1) * c.tax.business;
  const land = c._raw.grain * 10 * c.priceLevel * c.tax.land, business = (sum(RAW.filter(g => g !== 'grain'), g => c._raw[g] * BASE_PRICE[g]) + sum(Object.keys(RECIPE), g => (c._made[g] || 0) * BASE_PRICE[g] * .45)) * c.priceLevel * c.tax.business + shipping;
  // Customs are what each good paid at the rate set for it; goods that came in past the customs house paid nothing.
  const customs = (c._duty ?? (c._imports || 0) * c.tariff) * c.priceLevel;
  // A levy laid by law on some peoples or faiths alone is collected like any other tax, by the same offices and with the same losses.
  const levy = c.status ? c.gdp * .45 * levyShare(w, c) : 0;
  const revenue = (c.gdp * .45 * c.tax.income + land + business + customs + levy) * eff + (c._tolls || 0) * c.priceLevel;
  // Capital that is taxed past what it is used to does not all stay to be taxed. For every two the treasury takes beyond the accustomed rate, one
  // leaves the country in gold for the safest state that will have it, unless the movement of capital is controlled (and then only what slips
  // past the controls). The gold is not lost to the world; it is lost to this reserve, and the currency and the import trade rest on that.
  { const past = Math.max(0, c.tax.business - (1 - (c.profitBase ?? 1 - c.tax.business))), want = past > 0 ? business / Math.max(c.tax.business, .01) * past * .5 / (c.rate || 1) * (c.capitalClosed ? 1 - sealOf(w, c) : 1) : 0;
    const haven = want > 0 ? aliveCountries(w).filter(o => o.id !== c.id && !o.capitalClosed).sort((a, b) => b.legitimacy - a.legitimacy)[0] : null, out = haven ? Math.min(Math.max(c.reserves, 0), want) : 0;
    if (out > 0) { c.reserves -= out; haven.reserves += out; } c._flight = out; }
  // A vote is leave to spend, not money spent. The forces draw what they can use: their keep, and up to three tenths over it for better pay,
  // stores and training (the same bound past which more money buys the army nothing, military.js upkeep). What is voted beyond that is not
  // drawn and stays in the treasury; a shrunken army on its old vote does not go on costing what the old one did.
  const b = c.budget, voted = b.military * c.gdp, usable = upkeepCost(w, c) * FULL_KIT, drawn = Math.min(voted, usable);
  const programs = drawn + (b.welfare + b.infrastructure + b.education + b.police + b.administration) * c.gdp;
  // Standing institutions are part of the budget: a state that founds many of them pays for them every quarter.
  const agencies = sum((c.institutions || []).filter(i => i.id), i => i.sponsor ? i.grant || 0 : i.budget || 0) * c.gdp;
  // Lenders price in the inflation they have come to expect, not one quarter's jump.
  c.inflTrend = (c.inflTrend ?? Math.max(0, c.inflation)) * .8 + Math.max(0, c.inflation) * .2;
  c.interestRate = sovereignRate(c);
  // A state in default has stopped paying its bondholders: for a year nothing at all. After that what is left of the debt is served again, at what a defaulter
  // is charged, but creditors come last: they get only what remains once the state's own bills are met. Paying them short keeps the state shut out of the
  // market (no clean quarter is counted); it does not leave soldiers and clerks unpaid.
  const owed = c.debt * c.interestRate, spare = Math.max(0, c.treasury + revenue - programs - agencies), short = c.defaulted && owed > spare + 1e-9;
  let interest = !c.defaulted ? owed : w.turn - (c.defaultedAt ?? -99) < 4 ? 0 : Math.min(owed, spare);
  // External debt is in gold: when the currency falls, the same interest costs the budget more.
  const external = sum(Object.values(c.creditors), x => x), extRate = foreignRate(c, external); let extDue = 0, extPaid = 0;
  for (const [cid, amt] of Object.entries(c.creditors)) if (w.countries[cid]?.alive) { const due = amt * (c.creditTerms?.[cid]?.rate ?? extRate), pay = Math.min(Math.max(c.reserves, 0), due); c.reserves -= pay; w.countries[cid].reserves += pay; extDue += due; extPaid += pay; }
  interest += extPaid * (c.rate || 1);
  c.foreignRate = extRate; c._debtService = extDue;
  c.extArrears = extDue > 0 && extPaid < extDue * .5 ? (c.extArrears || 0) + 1 : Math.max(0, (c.extArrears || 0) - 1);
  if (c.extArrears >= 4) declareDefault(w, c, 'declared it cannot pay its external debt');
  const need = programs + agencies + interest; let cash = c.treasury + revenue, paid = 1, borrowed = 0;
  // A treasury keeps a working balance of some days' spending. A deficit is met first from the cash above that, then from lenders; the last
  // cash in the till is touched only when lenders refuse. So an empty treasury means the state can no longer borrow, not merely that it runs a deficit.
  c.till = need * .12;
  const till = Math.min(c.till, Math.max(c.treasury, 0));
  if (cash - need < till) { borrowed = Math.max(0, Math.min(till - (cash - need), need - revenue, creditLeft(c))); c.debt += borrowed; cash += borrowed; c._taken = (c._taken || 0) + borrowed; }
  if (cash >= need) cash -= need;
  else {
    // What lenders would not cover is taken from what cash is left; after that wages and bills go unpaid.
    const more = Math.min(need - cash, Math.max(0, creditLeft(c)));
    borrowed += more; c.debt += more; cash += more; c._taken = (c._taken || 0) + more;
    if (cash < need - 1e-9) {
      paid = need > 0 ? clamp(cash / need, 0, 1) : 1; cash = 0; c.arrears = clamp(c.arrears + (1 - paid), 0, 6);
      if (paid < .55 && c.debt > c.gdp * 4 * .9) declareDefault(w, c, 'declared it cannot pay its debts');
    } else { cash -= need; c.arrears = Math.max(0, c.arrears - .5); }
  }
  c.treasury = cash; if (paid === 1) c.arrears = Math.max(0, c.arrears - .5);
  creditStanding(w, c, paid === 1 && !short);
  // The quarter's books in their parts: which tax brought what, what was lost in the collecting, where the money went, and how it stood the quarter before.
  c.lastBooks = { eff, collect: clamp(.4 + c.bureaucracy / 120, 0, 1), graft: c.corruption / 130, unrest: (c.unrest ?? 0) / 400, reach: c._adminFactor ?? 1,
    income: c.gdp * .45 * c.tax.income * eff, land: land * eff, business: business * eff, shipping: shipping * eff, customs: customs * eff, levy: levy * eff, tolls: (c._tolls || 0) * c.priceLevel, works: c._stateProfit || 0,
    programs: Object.fromEntries(Object.keys(b).map(k => [k, k === 'military' ? drawn : b[k] * c.gdp])), forces: { voted, usable, drawn }, agencies, interest, abroad: extPaid * (c.rate || 1), outlay: c._outlay || {},
    before: c.lastRevenue != null ? { revenue: c.lastRevenue, due: c.lastRevenue - (c.lastBalance ?? 0) } : null };
  c._stateProfit = 0; c._outlay = {};
  c.lastRevenue = revenue; c.lastSpending = need * paid; c.paidRatio = paid;
  c.lastBalance = revenue - need; c.lastInterest = interest; c.lastAgencies = agencies; c.lastBorrowed = borrowed + (c._loans || 0); c._loans = 0;
  // State capacity has a running cost that grows with its level: what is spent decides where it settles, so a poor state stays small instead of decaying forever.
  c.bureaucracy = clamp(c.bureaucracy + (capacityFor(b.administration * paid) - c.bureaucracy) * (paid < .8 ? .1 : .06), 10, 95);
  c.police = clamp(c.police + (policeFor(b.police * paid) - c.police) * .08, 5, 95);
  // Corruption settles where the press, the courts and unpaid officials leave it.
  // Each country starts at rest with the habits it inherited; from there a freer press and stronger courts pull corruption down, and their loss lets it grow.
  const open = c.pressFreedom * .3 + c.courts * .35;
  c.graftBase ??= c.corruption + open;
  c.corruption = clamp(c.corruption + (clamp(c.graftBase - open + (paid < .8 ? 15 : 0), 5, 90) - c.corruption) * .03, 2, 95);
  // Intelligence work grows out of the police; whatever the state built on top of that stays on top.
  c.intelBase ??= c.intelligence - c.police * .5;
  c.intelligence = clamp(c.intelligence + (clamp(c.intelBase + c.police * .5, 5, 95) - c.intelligence) * .03, 0, 100);
  // Literacy stands where the schools hold it. A country was handed over with as many readers as its vote for schools had made in a generation
  // (c.litBase under c.schoolShare): at that vote it keeps them. A larger vote settles it higher, some fifteen readers in the hundred for every
  // point of output spent, and gets there as children grow up, a fiftieth of the way a quarter; a smaller one lets it sink, but slowly, for
  // people do not forget their letters and the old die one by one. A level, not a counter. (It used to fall in six kinds of state out of eight
  // whatever they did, because only a vote above one and a half parts in a hundred added any readers at all.)
  c.litBase ??= c.literacy; c.schoolShare ??= b.education;
  const reads = literacyAt(c, b.education * paid);
  c.literacy = clamp(c.literacy + (reads - c.literacy) * (reads > c.literacy ? .02 : .006), 5, 99);
}
// The levels a country inherited are where its habits and its spending had brought it. They are fixed when the world is made, before anyone gives an order,
// so that the first decree of a new ruler moves the country from where it stood and is not itself taken for the country's ordinary state.
export function settleBases(w) {
  for (const c of aliveCountries(w)) {
    c.graftBase ??= c.corruption + c.pressFreedom * .3 + c.courts * .35; c.intelBase ??= c.intelligence - c.police * .5; c.roadShare ??= c.budget.infrastructure; c.litBase = c.literacy; c.schoolShare = c.budget.education;
    c.profitBase = 1 - (c.taxTarget?.business ?? c.tax.business); c.upkeep = 1; c.builtBase = clamp(c.built ?? 1, .3, 1); c.goldBase = Math.max(0, c.reserves); c.goldFloor = c.goldBase * .6;
    { const ps = countryProvinces(w, c.id), n = sum(ps, p => p.pops.workers.n); if (n > 0) c.workBase ??= sum(ps, p => p.pops.workers.sat * p.pops.workers.n) / n; }
    for (const p of countryProvinces(w, c.id)) p.infraBase ??= p.infra;
  }
}
// Where a vote for schools of that share of output would hold the country's literacy in the long run.
export const SCHOOLS = 1500, literacyAt = (c, share) => clamp((c.litBase ?? c.literacy) + (share - (c.schoolShare ?? c.budget.education)) * SCHOOLS, 5, 99);
// The level of administration or policing that a given share of GDP sustains, and the share that a given level costs.
export const capacityFor = share => clamp(10 + share * 2400, 10, 95);
export const policeFor = share => clamp(5 + share * 3200, 5, 95);
export const costOfCapacity = level => Math.max(0, level - 10) / 2400;
export const costOfPolice = level => Math.max(0, level - 5) / 3200;

function demography(w, c) {
  const provs = countryProvinces(w, c.id), gap = Math.max(0, 1 - c.foodRatio); let starved = 0, fled = 0;
  for (const p of provs) {
    const welfare = 1 + c.budget.welfare * (c.paidRatio ?? 1);
    // A lean year is hunger, not yet famine: people begin to die in numbers once a twentieth of the bread is missing.
    // A province that is cut off or besieged gets less of the country's bread than the rest.
    const here = hungerOf(c, p);
    for (const k of CLASSES) { const pop = p.pops[k], sev = k === 'elite' ? .1 : k === 'middle' ? .5 : 1, lost = pop.n * Math.max(0, Math.max(gap, here) - .05) * .12 * sev / welfare; starved += lost; pop.n = Math.max(1, pop.n * (1 + .0035 * (c.foodRatio >= 1 ? 1 : .4)) - lost); }
    // Urbanization comes with literacy and industry.
    // People leave the land for the towns while there is bread there; when bread fails they go back to it. And they come for work: where the
    // mills have no places and two hands in five already live by the small trades, fewer follow, and where it is three in four hardly any.
    if (c.foodRatio >= 1) { const crowd = clamp(((p.loose || 0) / Math.max(p.pops.workers.n, 1) - .4) * 2.5, 0, .85), mv = p.pops.peasants.n * clamp((sum(Object.values(p.plants)) - .3) * .002 + c.literacy * .00002, 0, .01) * (1 - crowd); p.pops.peasants.n -= mv; p.pops.workers.n += mv * .8; p.pops.middle.n += mv * .2; }
    else if (c.foodRatio < .9) { const back = p.pops.workers.n * .012; p.pops.workers.n -= back; p.pops.peasants.n += back; }
    if (gap > .12 || p.devastation > .45) {
      const outs = p.neighbors.map(n => w.provinces[n]).filter(n => (n.controller !== p.controller && !atWar(w, n.controller, p.controller)) || (n.controller === p.controller && n.devastation < p.devastation - .1));
      if (outs.length) {
        const rate = clamp(gap * .12 + p.devastation * .04, 0, .1), to = outs[Math.floor(rand(w) * outs.length)], before = provincePop(p); let moved = 0;
        for (const k of ['peasants', 'workers']) { const m = p.pops[k].n * rate; p.pops[k].n -= m; to.pops[k].n += m; moved += m; }
        fled += moved; migrate(p, to, moved / Math.max(before, 1)); to.unrest = clamp(to.unrest + moved / Math.max(provincePop(to), 1) * 120, 0, 100);
      }
    }
    p.devastation = Math.max(0, p.devastation - .02 - c.budget.infrastructure * (c.paidRatio ?? 1) * .4);
  }
  if (starved > 8) news(w, `${c.name}: famine claimed about ${Math.round(starved)}k lives.${fled > 5 ? ` ${Math.round(fled)}k people were displaced.` : ''}`, { kind: 'disaster', countries: [c.id] });
  c.starved = starved; c.fled = fled;
}

function investment(w, c) {
  const b = c.budget, paid = c.paidRatio, machines = clamp(c.stock.machines / Math.max(c._pop * .00016, 1), 0, 1), bank = c.bankHealth < 30 ? .3 : 1;
  c.stock.machines = Math.max(0, c.stock.machines - c._pop * .00014);
  // Roads and public works stand where their upkeep holds them. Each country starts at rest with what it inherited and what it was spending on it:
  // spending more raises the level its provinces settle at, spending less (or leaving the bills unpaid) lets them run down to a lower one. It is not a counter that climbs for ever.
  c.roadShare ??= b.infrastructure;
  for (const p of countryProvinces(w, c.id)) {
    p.infraBase ??= p.infra;
    p.infra += (clamp(p.infraBase + (b.infrastructure * paid - c.roadShare) * 25, .15, 1.8) - p.infra) * .03;
    // The same spending is what the country's works were kept up and slowly extended with: above the accustomed share they grow, below it they run down.
    const grow = 1 + (b.infrastructure * paid - c.roadShare) * .35 * machines * bank;
    for (const pl of Object.keys(PLANTS)) p.plants[pl] = clamp(p.plants[pl] * grow, 0, 8);
  }
  // Private mines and works stand where their owners' returns hold them. Owners renew and extend out of what the tax on business leaves them:
  // at the rate the country inherited they keep what they have; a state that takes much more collects it at once and watches the plant run
  // down over years toward what still pays to keep up, one that takes less sees it extended. A level, not a counter.
  c.profitBase ??= 1 - c.tax.business; c.upkeep ??= 1; c.builtBase ??= clamp(c.built ?? 1, .3, 1);
  c.upkeep += (upkeepAt(c) - c.upkeep) * .04;
  follow(w, c);
  prospectors(w, c);
  for (const t of Object.keys(c.adopting || {})) { c.adopting[t] += paceOf(c, t); if (c.adopting[t] >= 1) delete c.adopting[t]; }
  // When a new technology arrives, the private sector builds the first plants itself; expansion is left to the state or capital.
  const cap = w.provinces[c.capital];
  if (cap && hasTech(c, 'oil_prospecting') && !sum(countryProvinces(w, c.id), p => p.plants.fuel)) cap.plants.fuel = .4;
  if (cap && hasTech(c, 'chemical_fertilizer') && !sum(countryProvinces(w, c.id), p => p.plants.fertilizer)) cap.plants.fertilizer = .4;
  const edu = (b.education * paid - .015) * .12 * (.5 + c.literacy / 100);
  c.tech.ind = clamp(c.tech.ind * (1 + edu + .001 * (.5 + machines)), .5, 10);
  c.tech.agri = clamp(c.tech.agri * (1 + edu * .7 + .0008), .5, 10);
  c.tech.mil = clamp(c.tech.mil * (1 + edu * .6 + b.military * paid * .02), .5, 10);
}

// Works and workings follow their trade. Owners do not go on renewing a mill that has stood on short time for years because its yards are full,
// nor keep open the galleries of a pit whose coal lies unsold: what the stores have kept idle below nineteen parts in twenty (SLACK) is let go, a twelfth
// of the idle part a quarter. A trade that is sold out and working flat out at a good price extends, as fast as ordinary building can find it
// the iron and engines. So the size of a country's works settles near what is bought of them; it is not a number that only a decree moves.
// What the state owns does not follow the market either way, and arms works are the state's affair altogether.
const SLACK = .95, LET_GO = .08, EXTEND = .012, FOLLOW = ['steel', 'machines', 'goods', 'fuel', 'fertilizer'], PITS = ['coal', 'iron', 'copper', 'phosphate', 'oil'];
function follow(w, c) {
  // Owners extend out of what the tax on business leaves them: those it leaves too little to renew what they have do not build more.
  const priv = 1 - clamp(c.ownership, 0, 1), dear = g => (c.prices?.[g] ?? BASE_PRICE[g]) / BASE_PRICE[g] / Math.max(c.rer ?? 1, .2), can = clamp(c.buildRatio ?? 1, 0, 1) * (c.bankHealth < 30 ? 0 : 1) * clamp((Math.pow(Math.max(1 - c.tax.business, .05) / Math.max(c.profitBase ?? 1 - c.tax.business, .05), .8) - .9) * 10, 0, 1.3), drift = {};
  for (const pl of FOLLOW) { const s = c._still?.[pl]; if (!s || !(s.full > 0)) continue;
    const pace = 1 - s.buyers / s.full; drift[pl] = pace < SLACK ? -LET_GO * (SLACK - pace) * priv : pace >= 1 && s.materials < s.full * .03 && dear(pl) > 1.02 ? EXTEND * priv * can : 0; }
  // (A working nobody at all has a use for yet, like phosphate before the chemists, is not let go: it is simply not worked.)
  for (const g of PITS) { const pace = c._pace?.[g] ?? 1; if (!((c._need?.[g] || 0) + (c.lastSold?.[g] || 0) > .01)) continue; drift[g] = pace < SLACK ? -LET_GO * (SLACK - pace) * priv : pace >= 1 && (w.globalPrice?.[g] ?? BASE_PRICE[g]) / BASE_PRICE[g] > 1.03 ? EXTEND * priv * can : 0; }
  c._drift = drift;
  for (const p of countryProvinces(w, c.id)) {
    for (const pl of FOLLOW) if (drift[pl] && p.plants[pl] > 0) p.plants[pl] = clamp(p.plants[pl] * (1 + drift[pl]), 0, 8);
    for (const g of PITS) { const d = p.deposits[g]; if (drift[g] && d?.known && d.mine > 0) d.mine = clamp(d.mine * (1 + drift[g]), .05, 4); } }
}
// Where owners would settle their works at the present tax on business, against where they inherited them.
// Renewal needs iron and engines as well as money: plant that ordinary building could not renew for want of materials (c.built, the part of
// ordinary building carried out over the last year or so, against what the country was used to; a shortfall of an eighth is a slack year and
// does no harm) runs down toward seven tenths of itself however light the tax.
export const upkeepAt = c => clamp(Math.pow(Math.max(1 - c.tax.business, .05) / Math.max(c.profitBase ?? 1 - c.tax.business, .05), .8) * (.7 + .3 * clamp((c.built ?? 1) / (c.builtBase ?? 1) * 1.15, 0, 1)), .4, 1.3);
// (Whether a search at home finds anything in a given quarter is settled by the place and the date, not by the world's dice: a private search
// in one country does not change the luck of a battle in another.)
const luckOf = key => { let h = 2166136261; for (const ch of key) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; return (h >>> 0) / 4294967296; };
// A price several times the usual draws private capital to the ground that holds the thing. A known deposit nobody works is opened by a company
// of its own accord; what lies hidden is looked for, and the dearer the thing the harder they look. Governments can still do both sooner.
export function prospectors(w, c) {
  for (const p of countryProvinces(w, c.id)) { if (p.owner !== c.id) continue;
    for (const [k, d] of Object.entries(p.deposits)) {
      if (!BASE_PRICE[k] || d.mine > 0 || !(d.amount > 0)) continue;
      // Dear in the world, or dear at home: a country whose works stand for want of a thing it cannot buy pays any price for it at home.
      const world = (w.globalPrice?.[k] ?? BASE_PRICE[k]) / BASE_PRICE[k], dear = Math.max(world, (c.prices?.[k] ?? BASE_PRICE[k]) / BASE_PRICE[k] / Math.max(c.rer ?? 1, .2)); if (dear < 2.5) continue;
      // Where the state owns the works there is little private capital to go looking.
      if (c.ownership >= .85) continue;
      if (!d.known) { if ((k === 'oil' && !hasTech(c, 'oil_prospecting')) || (k === 'rare' && !hasTech(c, 'electricity')) || (world >= 2.5 ? rand(w) : luckOf(`${p.id}|${k}|${w.turn}`)) >= .04 * Math.min(dear - 1.5, 4) * (1 - c.ownership)) continue; d.known = true; }
      d.mine = .3; news(w, `${c.name}: with ${GOOD_LABEL[k]} selling at ${Math.round(dear)} times its usual price, private capital has opened the deposit at ${p.name}.`, { kind: 'economy', countries: [c.id], province: p.id });
    } }
}

function research(w, c) {
  const points = (c.budget.education * c.paidRatio * 180 + c.literacy * .06) * (c.bankHealth < 30 ? .7 : 1);
  let t = c.research.target;
  if (!t || c.techs[t]) t = Object.keys(TECHS).find(k => !c.techs[k] && TECHS[k].req.every(r => c.techs[r])) || null;
  c.research.target = t; if (!t) return;
  // Cost falls as neighbors hear of the invention.
  const known = aliveCountries(w).filter(o => o.techs[t]).length;
  c.research.progress += points * (1 + known * .15);
  if (c.research.progress >= TECHS[t].cost) {
    c.techs[t] = Math.max(1, w.turn); if (SPREAD[t]) (c.adopting ||= {})[t] = 0; c.research = { target: null, progress: 0 };
    news(w, `${c.name}: ${TECHS[t].name} has been put into practice.`, { kind: 'economy', countries: [c.id] });
    if (t === 'oil_prospecting') for (const p of countryProvinces(w, c.id)) if (p.deposits.oil && rand(w) < .35) p.deposits.oil.known = true;
  }
}

function epidemicStep(w) {
  if (rand(w) < .05 + sum(aliveCountries(w), c => c.starved > 30 ? .03 : 0)) {
    const ps = Object.values(w.provinces), start = ps[Math.floor(rand(w) * ps.length)];
    w.epidemics.push({ name: 'Epidemic', active: true, start: w.turn, provinces: { [start.id]: .5 } });
    news(w, `A contagious epidemic broke out in ${start.name}.`, { kind: 'disaster', countries: [start.controller], hush: true });
  }
  for (const e of w.epidemics.filter(x => x.active)) {
    const next = {};
    for (const [id, v] of Object.entries(e.provinces)) {
      const p = w.provinces[id], c = w.countries[p.controller]; if (!c?.alive) continue;
      const med = hasTech(c, 'antibiotics') ? .4 : 1, care = 1 - clamp(c.budget.welfare * (c.paidRatio ?? 1) * 3, 0, .4);
      for (const k of CLASSES) p.pops[k].n *= 1 - v * .025 * med * care;
      p.unrest = clamp(p.unrest + v * 2, 0, 100);
      const decay = v - .12;
      if (decay > .05) next[id] = Math.max(next[id] || 0, decay);
      for (const n of p.neighbors) if (rand(w) < v * (.25 + w.provinces[n].rail * .15)) next[n] = Math.max(next[n] || 0, v * .8);
      if (p.port && rand(w) < v * .25) { const far = Object.values(w.provinces).filter(x => x.port); const f = far[Math.floor(rand(w) * far.length)]; if (f) next[f.id] = Math.max(next[f.id] || 0, v * .7); }
    }
    e.provinces = next; if (!Object.keys(next).length || w.turn - e.start > 16) { e.active = false; }
  }
  w.epidemics = w.epidemics.filter(e => e.active || w.turn - e.start < 12);
}
