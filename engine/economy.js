import { clamp, sum, news, between, rand } from './util.js';
import { hungerOf } from './politics.js';
import { CLASSES, GOODS, RAW, BASE_PRICE, GOOD_LABEL, PLANTS, TECHS, countryProvinces, provincePop, aliveCountries, atWar, hasTreaty } from './world.js';
import { migrate } from './culture.js';
import { updateRer, glutFactor, localPrices, displacedDemand, exportEdge, foreignRate, declareDefault, currencyStep, sovereignRate, creditLeft, creditStanding, USUAL_COVER } from './money.js';

export const RECIPE = {
  steel: { iron: 1, coal: .8 }, fuel: { oil: 1.25 }, fertilizer: { phosphate: 1, coal: .2 },
  machines: { steel: .7, copper: .2 }, goods: { timber: .2, coal: .2, steel: .1 }, arms: { steel: .7, coal: .3 }
};
const ORDER = ['steel', 'fuel', 'fertilizer', 'machines', 'arms', 'goods'];
export const hasTech = (c, t) => !!c.techs?.[t];

// Rule: goods move only if a route exists. War, a closed strait and an enemy fleet cut the route.
function seaLocked(w, sea, a, b) {
  const s = w.seaControl?.[sea];
  return !!s && (atWar(w, s, a) || atWar(w, s, b));
}
function straitAt(w, sea) { return w.strategic.find(x => x.type === 'strait' && x.ref === sea); }
function canalAdj(w, sea) { return w.canals.filter(k => k.a === sea || k.b === sea).map(k => k.a === sea ? k.b : k.a); }

function seaRoute(w, a, b) {
  const portsA = countryProvinces(w, a.id).filter(p => p.port > 0 && p.controller === a.id).flatMap(p => p.seas);
  const targets = new Set(countryProvinces(w, b.id).filter(p => p.port > 0).flatMap(p => p.seas).filter(x => !seaLocked(w, x, a.id, b.id)));
  if (!portsA.length || !targets.size) return null;
  const prev = {}, q = [];
  for (const s of portsA) if (!(s in prev) && !seaLocked(w, s, a.id, b.id)) { prev[s] = null; q.push(s); }
  while (q.length) {
    const x = q.shift();
    if (targets.has(x)) { const path = []; for (let c = x; c; c = prev[c]) path.unshift(c); return path; }
    for (const n of [...w.seas[x].neighbors, ...canalAdj(w, x)]) {
      if (n in prev) continue;
      const st = straitAt(w, n);
      if (st?.closed && st.controller !== a.id && st.controller !== b.id) continue;
      if (seaLocked(w, n, a.id, b.id)) continue;
      prev[n] = x; q.push(n);
    }
  }
  return null;
}
const landBorder = (w, a, b) => countryProvinces(w, a.id).some(p => p.neighbors.some(n => w.provinces[n].controller === b.id));

export function tradeOpen(w, a, b) { return !!w.routes[routeKey(a.id, b.id)]; }
const routeKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;

export function updateStrategic(w) {
  for (const s of w.strategic) {
    if (s.type === 'strait') {
      const sea = w.seas[s.ref], counts = {};
      for (const pid of sea.coast) counts[w.provinces[pid].controller] = (counts[w.provinces[pid].controller] || 0) + 1;
      const fleet = Object.values(w.fleets).filter(f => f.sea === s.ref).sort((a, b) => b.ships - a.ships)[0];
      s.controller = fleet?.country ?? Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      if (!w.countries[s.controller]?.alive) s.controller = null;
      const pol = s.controller ? w.countries[s.controller].straitPolicy?.[s.id] : null;
      s.closed = !!pol?.closed; s.toll = pol?.toll ?? 0;
    } else s.controller = w.provinces[s.ref]?.controller ?? null;
  }
}

export function updateRoutes(w) {
  const cs = aliveCountries(w); w.routes = {};
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
    const a = cs[i], b = cs[j], k = routeKey(a.id, b.id);
    if (a.embargo.includes(b.id) || b.embargo.includes(a.id) || atWar(w, a.id, b.id)) continue;
    if (landBorder(w, a, b)) { w.routes[k] = { mode: 'land', cost: 1.04, path: [], tolls: [] }; continue; }
    const path = seaRoute(w, a, b);
    if (path) {
      const tolls = path.map(s => straitAt(w, s)).filter(s => s && s.toll && s.controller && ![a.id, b.id].includes(s.controller));
      const raided = path.filter(s => (w.seaRaids?.[s] || []).some(x => atWar(w, x, a.id) || atWar(w, x, b.id))).length;
      // A deep harbour with quays and cranes turns ships round faster than an open roadstead: each step of harbour at either end takes a little off the freight.
      const quay = (o, sea) => Math.max(1, ...countryProvinces(w, o.id).filter(p => p.port > 0 && p.controller === o.id && p.seas.includes(sea)).map(p => p.port));
      w.routes[k] = { mode: 'sea', cost: 1.05 + path.length * .008 - (quay(a, path[0]) + quay(b, path.at(-1)) - 2) * .012 + sum(tolls, t => t.toll) + raided * .15, path, tolls: tolls.map(t => t.id) };
    }
  }
  // Two countries with no road or water of their own between them still trade through a third that deals with both: the goods pay both freights and the middleman's handling.
  const direct = { ...w.routes }, open = (x, y) => direct[routeKey(x.id, y.id)];
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
    const a = cs[i], b = cs[j], k = routeKey(a.id, b.id);
    if (direct[k] || a.embargo.includes(b.id) || b.embargo.includes(a.id) || atWar(w, a.id, b.id)) continue;
    const via = cs.filter(m => m !== a && m !== b && open(a, m) && open(m, b)).map(m => ({ m, cost: open(a, m).cost * open(m, b).cost * 1.03 })).sort((x, y) => x.cost - y.cost)[0];
    if (via) w.routes[k] = { mode: 'transit', via: via.m.id, cost: via.cost, path: [], tolls: [...new Set([...open(a, via.m).tolls, ...open(via.m, b).tolls])] };
  }
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

function extract(w, c) {
  const raw = Object.fromEntries(RAW.map(g => [g, 0])); let gold = 0, services = 0, dev = 0, popAll = 0;
  c._cap = Object.fromEntries(Object.keys(PLANTS).map(k => [k, 0]));
  const engine = hasTech(c, 'combustion_engine') ? 1 + clamp(c.stock.fuel / Math.max(c._lastFuelNeed || 1, 1), 0, 1) * .25 * (c.motor ?? 0) : 1;
  const fert = hasTech(c, 'chemical_fertilizer') ? 1 + clamp(c.stock.fertilizer / Math.max(c._pop * .002, 1), 0, 1) * .4 : 1;
  const strikes = c.strike ? .65 : 1, bank = c.bankHealth < 30 ? .8 : 1;
  c._rent = 0; c._idleV = 0;
  const pace = Object.fromEntries(RAW.map(g => [g, glutFactor(c, g)]));
  for (const p of countryProvinces(w, c.id)) {
    const occ = p.controller !== p.owner ? .55 : 1;
    const rail = 1 + p.rail * .12 + (hasTech(c, 'electricity') ? .08 : 0);
    const eff = (1 - p.devastation * .75) * (.72 + p.infra * .36) * occ * (1 - (p.unrest > 60 ? (p.unrest - 60) / 100 : 0)) * rail;
    const water = clamp(p.water - p.waterPenalty + (p.dam ? .15 : 0), .15, 1.4);
    // A province has only so much land. Hands beyond those it was farmed with add less and less, and fewer hands lose less than their share:
    // that is what lets a famine burn out instead of feeding on itself, and what makes a growing people need better farming.
    p.land ??= Math.max(p.pops.peasants.n, 1);
    const hands = p.land * Math.pow(Math.max(p.pops.peasants.n, 0) / p.land, .7);
    const grain = hands * p.fertility * water * .03 * c.tech.agri * eff * p.weather * fert * engine + p.fish * p.pops.peasants.n * .002, timber = p.pops.peasants.n * p.timber * .006 * eff;
    raw.grain += grain * pace.grain; raw.timber += timber * pace.timber;
    c._idleV += grain * (1 - pace.grain) * BASE_PRICE.grain + timber * (1 - pace.timber) * BASE_PRICE.timber;
    p.cap = {}; p.dug = {};
    const deposits = Object.entries(p.deposits).filter(([, d]) => d.known && d.mine > 0 && d.amount > 0);
    const mineLoad = sum(deposits, ([, d]) => d.mine), plantLoad = sum(Object.values(p.plants)) + .3;
    const mineShare = mineLoad / (mineLoad + plantLoad);
    for (const [k, d] of deposits) {
      const full = p.pops.workers.n * mineShare * (d.mine / mineLoad) * d.rich * ({ coal: .3, iron: .22, oil: .12 }[k] ?? .06) * c.tech.ind * eff * strikes * (1 - (p.halt?.[k] ?? 0)), f = k === 'gold' ? 1 : pace[k] ?? 1, q = full * f;
      if (f < 1) c._idleV += (full - q) * BASE_PRICE[k];
      d.amount = Math.max(0, d.amount - q * .08);
      const con = p.concessions?.[k];
      if (k === 'gold') { gold += q; continue; }
      // A concession pays out only while the two countries still deal with each other: not across a war or an embargo.
      const pays = con && w.countries[con.holder]?.alive && !atWar(w, c.id, con.holder) && !c.embargo.includes(con.holder), kept = pays ? q * (1 - con.share) : q;
      if (pays) { const shipped = q - kept; w.countries[con.holder].stock[k] = (w.countries[con.holder].stock[k] || 0) + shipped; }
      raw[k] += kept; p.dug[k] = kept; c._rent += kept * BASE_PRICE[k] * (k === 'oil' ? 1.4 : 1);
      if (d.amount <= 0) news(w, `${c.name}: the ${p.name} ${GOOD_LABEL[k]} deposit is exhausted.`, { kind: 'economy', countries: [c.id] });
    }
    const labor = p.pops.workers.n * (1 - mineShare), level = sum(Object.values(p.plants));
    if (level > 0) for (const pl of Object.keys(PLANTS)) if (p.plants[pl] > 0) { const here = labor * (p.plants[pl] / level) * clamp(.7 + p.plants[pl] * .35, .7, 3) * .05 * 25 / BASE_PRICE[pl] * c.tech.ind * eff * strikes * bank * (1 - c.ownership * .15) * (1 - (p.halt?.[pl] ?? 0)); c._cap[pl] += here; p.cap[pl] = here; }
    services += (p.pops.middle.n + p.pops.elite.n * 1.5) * eff;
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
  need.grain += c._pop * .01; need.goods += c._pop * .004; need.coal += c._pop * .001 + ships * .08 * (1 - motor);
  // Machinery wears out: what the country's works and farms use up in a quarter is what its engineering trade has to replace before anything new is built.
  need.arms += men * .01; need.fuel += engine * .05 + ships * .08 * motor + c._pop * .0006 * motor; need.machines += c._pop * .00014;
  c._burn = { coal: ships * .08 * (1 - motor), fuel: engine * .05 + ships * .08 * motor };
  if (hasTech(c, 'chemical_fertilizer')) need.fertilizer += c._pop * .002;
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
// The duty one good pays coming in: what a treaty fixed with that seller, else the government's own rule for the good, else the general tariff.
const dutyOn = (c, g, from) => c.tariffDeals?.[from] ?? c.imports?.rules?.[g]?.tariff ?? c.tariff;

function trade(w, cs) {
  w.tradeFlows = {};
  const key = routeKey;
  for (const c of cs) { c.lastSold = {}; c.lastBought = {}; c.lastOrders = []; }
  // What merchants would bring in of a good, and how much of that the law lets through: a prohibition or a quota cuts it, and the part the customs cannot hold back is smuggled.
  const wantOf = (c, g) => { const usual = Math.max(0, c._need[g] + c._reserve[g] * .5 - c.stock[g]) + displacedDemand(c, g), r = c.imports?.rules?.[g]; if (!r || (!r.ban && r.quota == null)) return { usual, legal: usual }; const legal = r.ban ? 0 : Math.min(usual, r.quota); return { usual: legal + (usual - legal) * (1 - sealOf(w, c)), legal }; };
  const stateOrder = (c, g) => { const o = c.orders?.[g]; return o && (!(o.limit > 0) || w.globalPrice[g] <= o.limit) ? o.amount : 0; };
  // The gold a country has to spend abroad this quarter is what lies in its reserve beyond the debt service, and about what its exports brought in the quarter before.
  // It is shared out among the goods in the order of priority: each good may draw on its own share, and on whatever no good has claimed.
  for (const c of cs) {
    let left = Math.max(0, c.reserves - (c._debtService || 0)) + (c.lastExportGold || 0); c._alloc = {};
    for (const g of importOrder(c)) { const cost = (wantOf(c, g).usual + stateOrder(c, g)) * w.globalPrice[g] * 1.1, part = Math.min(cost, left); c._alloc[g] = part; left -= part; }
    c._spare = left; c._exportGold = 0; c._duty = 0;
  }
  // Markets sit in an order: first the materials and wares a country sells for gold, then bread, and consumer goods last. A poor country spends what
  // its coal and timber earned that quarter on grain before it spends it on cloth and boots.
  for (const g of [...GOODS.filter(x => x !== 'grain' && x !== 'goods'), 'grain', 'goods']) {
    // A government can also go to the foreign markets itself for one quarter: an order to buy beyond what the country's trade brings in of its own accord,
    // or an offer of goods out of its stores beyond what merchants would let go. Either holds only while the price stays inside the limit it was given.
    const price = w.globalPrice[g], wants = c => { const o = c.orders?.[g]; return o && (!(o.limit > 0) || price <= o.limit) ? o.amount : 0; }, offers = c => { const o = c.sales?.[g]; return o && (!(o.limit > 0) || price >= o.limit) ? Math.min(o.amount, Math.max(0, c.stock[g] || 0)) : 0; };
    // What merchants may send out: all they can spare, unless the government has forbidden the export or set a quota on it (and then what slips past the customs still goes).
    const mayGo = c => { const all = Math.max(0, c.stock[g] - c._need[g] - c._reserve[g]), r = c.exports?.[g]; if (!r || (!r.ban && r.quota == null)) return all; const legal = r.ban ? 0 : Math.min(all, r.quota); return legal + (all - legal) * (1 - sealOf(w, c)); };
    const sellers = cs.map(c => ({ c, s: Math.max(mayGo(c), offers(c)) })).filter(x => x.s > 0);
    const buyers = cs.map(c => { const { usual, legal } = wantOf(c, g), state = wants(c); return { c, usual, d: usual + state, taxed: usual + state > 0 ? (legal + state) / (usual + state) : 1 }; }).filter(x => x.d > 0);
    const spare = Object.fromEntries(sellers.map(x => [x.c.id, mayGo(x.c)])); // Only a want with gold behind it is demand: a hungry country with an empty reserve does not bid the world price up.
    let wanted = sum(buyers, b => Math.min(b.d, Math.max(0, b.c.reserves - (b.c._debtService || 0)) / Math.max(price, .01))), moved = 0; const offered = sum(sellers, s => s.s);
    for (let pass = 0; pass < 2; pass++) for (const b of buyers) {
      if (b.d <= 0) continue;
      const acc = sellers.map(x => ({ x, r: w.routes[key(b.c.id, x.c.id)] })).filter(a => a.x.s > 0 && a.x.c.id !== b.c.id && a.r);
      const wgt = a => a.x.s / a.r.cost * (hasTreaty(w, b.c.id, a.x.c.id, 'trade') ? 1.5 : 1) * exportEdge(a.x.c), tot = sum(acc, wgt);
      if (!tot) continue;
      for (const a of acc) {
        const duty = dutyOn(b.c, g, a.x.c.id), landed = price * a.r.cost * (1 + duty * .3);
        // Gold owed to foreign creditors this quarter is not spent on imports: the debt is served first, and imports shrink instead.
        // And a good draws only on its own share of the quarter's gold and on what no other good has claimed.
        const q = Math.min(a.x.s, b.d * wgt(a) / tot, Math.max(0, b.c.reserves - (b.c._debtService || 0)) / landed, ((b.c._alloc?.[g] ?? Infinity) + (b.c._spare ?? 0)) / (price * a.r.cost));
        if (q <= 0) continue;
        const v = q * price; a.x.s -= q; b.d -= q; moved += q; a.x.c.lastSold[g] = (a.x.c.lastSold[g] || 0) + q;
        // Freight goes to the exporter, customs to the buyer's own treasury: gold does not vanish from the world.
        const gold = v * a.r.cost; a.x.c.stock[g] -= q; b.c.stock[g] += q; a.x.c.reserves += gold; b.c.reserves -= gold;
        if (b.c._alloc) { const own = Math.min(b.c._alloc[g] ?? 0, gold); b.c._alloc[g] = (b.c._alloc[g] ?? 0) - own; b.c._spare = Math.max(0, (b.c._spare ?? 0) - (gold - own)); }
        // Duty is paid on what came through the customs house, at the rate that good pays; smuggled goods pay none.
        a.x.c._exportGold = (a.x.c._exportGold || 0) + gold; b.c._duty = (b.c._duty || 0) + v * duty * b.taxed;
        a.x.c._exports = (a.x.c._exports || 0) + v; b.c._imports = (b.c._imports || 0) + v;
        a.x.c._rawExp = (a.x.c._rawExp || 0) + (RAW.includes(g) && g !== 'grain' ? v : 0);
        // The toll is part of what the buyer paid; it is passed on to whoever holds the strait, not minted anew.
        for (const tid of a.r.tolls) { const t = w.strategic.find(s => s.id === tid); if (t?.controller) { const fee = Math.min(v * t.toll, Math.max(a.x.c.reserves, 0)); a.x.c.reserves -= fee; w.countries[t.controller].reserves += fee; w.countries[t.controller]._tolls = (w.countries[t.controller]._tolls || 0) + fee; } }
        b.c.lastBought[g] = (b.c.lastBought[g] || 0) + q;
        const k = key(b.c.id, a.x.c.id); (w.tradeFlows[k] ||= {}); w.tradeFlows[k][g] = (w.tradeFlows[k][g] || 0) + v;
      }
    }
    // The customs house reports to whoever governs what became of the order: the first of what arrived went to the country's ordinary wants.
    for (const c of cs) {
      const o = c.orders?.[g], s = c.sales?.[g], say = text => { (c.lastOrders ||= []).push({ turn: w.turn, text }); const ch = w.characters[c.leader]; if (ch?.alive) ch.inbox.push({ turn: w.turn, from: 'The customs house', text }); };
      if (o) { const b = buyers.find(x => x.c === c), got = clamp((c.lastBought[g] || 0) - (b?.usual ?? 0), 0, o.amount), held = o.limit > 0 && price > o.limit;
        say(held ? `The order for ${Math.round(o.amount * 10) / 10} of ${GOOD_LABEL[g]} was not placed: the world price stood at ${Math.round(price * 10) / 10}, above the limit of ${o.limit}.` : `Of the ${Math.round(o.amount * 10) / 10} of ${GOOD_LABEL[g]} ordered abroad, ${Math.round(got * 10) / 10} arrived, at a world price of about ${Math.round(price * 10) / 10} a unit, paid in gold.${got < o.amount * .98 ? ' The rest found no seller with a surplus on an open route, or no gold to pay for it.' : ''}`);
        delete c.orders[g]; }
      if (s) { const sold = clamp((c.lastSold[g] || 0) - (spare[c.id] ?? 0), 0, s.amount), all = Math.min(c.lastSold[g] || 0, s.amount), held = s.limit > 0 && price < s.limit;
        say(held ? `The ${Math.round(s.amount * 10) / 10} of ${GOOD_LABEL[g]} offered abroad was held back: the world price stood at ${Math.round(price * 10) / 10}, below the limit of ${s.limit}.` : `Of the ${Math.round(s.amount * 10) / 10} of ${GOOD_LABEL[g]} offered abroad, ${Math.round(all * 10) / 10} was sold, at a world price of about ${Math.round(price * 10) / 10} a unit, for gold${sold > .05 ? ` (${Math.round(sold * 10) / 10} of it out of stores the country would otherwise have kept)` : ''}.${all < s.amount * .98 ? ' The rest found no buyer in want of it on an open route.' : ''}`);
        delete c.sales[g]; }
    }
    const unmet = wanted > 0 ? clamp((wanted - moved) / wanted, 0, 1) : 0;
    // Durable goods are held in deeper stores everywhere, so a world with years of machinery in hand is not a world glutted with it.
    const before = w.globalPrice[g], D = sum(cs, c => c._need[g]) + 1, S = (sum(cs, c => c.stock[g]) + moved * .2) / ((USUAL_COVER[g] ?? 2) / 2) + 1;
    const target = BASE_PRICE[g] * clamp(Math.pow(D / S * 1.6, .8), .4, 5) * (1 + unmet * .9);
    w.globalPrice[g] = clamp(before + (target - before) * .4, BASE_PRICE[g] * .3, BASE_PRICE[g] * 9);
    if (w.globalPrice[g] > before * 1.5 && before > BASE_PRICE[g]) news(w, `World ${GOOD_LABEL[g]} price rose sharply.`, { kind: 'economy' });
  }
  for (const c of cs) { c.lastExportGold = c._exportGold || 0; delete c._alloc; delete c._spare; delete c._exportGold; }
}

function factories(w, c) {
  const made = {};
  const armsPriority = clamp(c.armShare * 4, .2, 1);
  for (const pl of ORDER) {
    const pace = glutFactor(c, pl), cap = c._cap[pl] * (pl === 'arms' ? armsPriority : 1) * pace, rec = RECIPE[pl];
    c._cap[pl] *= pace; if (pace < 1) c._idleV += cap / pace * (1 - pace) * BASE_PRICE[pl] * .45;
    if (pl === 'fuel' && !hasTech(c, 'oil_prospecting') && !c.stock.oil) { made[pl] = 0; continue; }
    let r = cap;
    for (const [g, q] of Object.entries(rec)) r = Math.min(r, (c.stock[g] || 0) / q);
    r = Math.max(0, r);
    for (const [g, q] of Object.entries(rec)) c.stock[g] -= r * q;
    c.stock[pl] = (c.stock[pl] || 0) + r; made[pl] = r;
  }
  const cap = sum(Object.keys(RECIPE), pl => c._cap[pl] * BASE_PRICE[pl]);
  c.inputRatio = cap > 0 ? clamp(sum(Object.keys(RECIPE), pl => (made[pl] || 0) * BASE_PRICE[pl]) / cap, 0, 1) : 1;
  c._made = made;
}

export function economyStep(w) {
  updateStrategic(w); updateRoutes(w); updateRer(w); weatherStep(w);
  const cs = aliveCountries(w), prevReal = Object.fromEntries(cs.map(c => [c.id, c.realGdp]));
  for (const c of cs) { extract(w, c); needs(w, c); }
  trade(w, cs);
  w.priceHistory.push(Object.fromEntries(GOODS.map(g => [g, Math.round(w.globalPrice[g] * 10) / 10])));
  if (w.priceHistory.length > 200) w.priceHistory.shift();
  for (const c of cs) {
    factories(w, c);
    consume(w, c, prevReal[c.id]);
    fiscal(w, c); currencyStep(w, c); demography(w, c); investment(w, c); research(w, c);
    for (const k of ['_exports', '_imports', '_rawExp', '_tolls', '_duty']) delete c[k];
  }
  epidemicStep(w);
}

function consume(w, c, prev) {
  const n = c._need;
  c.foodRatio = n.grain > 0 ? clamp(c.stock.grain / (c._pop * .01), 0, 1.2) : 1;
  c.stock.grain = Math.max(0, c.stock.grain - c._pop * .01) * .96;
  const consumer = clamp(c.stock.goods / Math.max(c._pop * .004, 1), 0, 1.2);
  c.stock.goods = Math.max(0, c.stock.goods - c._pop * .004) * .96;
  // What the fleet and the motorised army burn, the fields take and the workshops use really leaves the stores.
  c.stock.coal = Math.max(0, c.stock.coal - c._pop * .001 - (c._burn?.coal || 0));
  if (hasTech(c, 'combustion_engine')) {
    const m = c.motor ?? 0; c.fuelRatio = n.fuel > .05 ? clamp(c.stock.fuel / n.fuel, 0, 1.2) : 1; c.stock.fuel = Math.max(0, c.stock.fuel - c._pop * .0006 * m - (c._burn?.fuel || 0));
    // With fuel to spare more of the country takes to the engine; when the tanks run dry it goes back.
    c.motor = clamp(m + (c.stock.fuel > Math.max(n.fuel, c._pop * .0006 * .25) ? .04 : c.fuelRatio < .6 ? -.1 : 0), 0, 1);
  } else c.fuelRatio = 1;
  if (hasTech(c, 'chemical_fertilizer')) c.stock.fertilizer = Math.max(0, (c.stock.fertilizer || 0) - c._pop * .002);
  if (n.rare > 0) c.stock.rare = Math.max(0, (c.stock.rare || 0) - n.rare);
  // Nothing keeps for ever: what lies in store beyond two years' need rusts, rots or is written off.
  for (const good of GOODS) { const keep = (n[good] || 0) * 8; if (good !== 'grain' && good !== 'goods' && c.stock[good] > keep) c.stock[good] -= (c.stock[good] - keep) * .04; }
  const rawV = sum(RAW, g => c._raw[g] * BASE_PRICE[g]), madeV = sum(Object.keys(RECIPE), g => (c._made[g] || 0) * BASE_PRICE[g] * .45);
  // The first quarter has no measured past to compare with, so it counts as no growth rather than a boom or a slump.
  const real = rawV + madeV + c._services, g = prev > 0 && c._measured ? real / prev - 1 : 0;
  c._measured = true; c.realGdp = real; c.growth = g;
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
  c.lastJobs = { inputs: (1 - c.inputRatio) * .3, damage: c._dev * .3, slump: Math.max(0, -g) * .9, idle: c.idleShare * .13, works };
  c.unemployment += (clamp(.06 + (1 - c.inputRatio) * .3 + c._dev * .3 + Math.max(0, -g) * .9 + c.idleShare * .13 - works, .02, .6) - c.unemployment) * .4;
  // Resource-rent dependence: easy money feeds corruption and oligarchs and weakens industry.
  c.rentShare = clamp((c._rent || 0) / Math.max(real, 1), 0, 1);
  if (c.rentShare > .22) { c.corruption = clamp(c.corruption + (c.rentShare - .22) * 2.2, 2, 95); const o = w.characters[c.oligarch]; if (o?.alive) { o.wealth += c.rentShare * 5; o.power = clamp(o.power + c.rentShare * .3, 0, 95); } for (const p of countryProvinces(w, c.id)) if (p.eth !== c.majorityEth && Object.values(p.deposits).some(d => d.known && d.mine > 0)) p.unrest = clamp(p.unrest + 2.2, 0, 100); }
  c.bankHealth = clamp(c.bankHealth + (c.inflation > .15 ? -6 : 1.2) + (c.reserves < 0 ? -4 : 0) + (g < -.08 ? -4 : 0), 0, 100);
  if (c.bankHealth < 30 && !c.bankCrisis) { c.bankCrisis = true; news(w, `${c.name}: a run on the banks has begun, credit is drying up.`, { kind: 'economy', countries: [c.id] }); } if (c.bankHealth > 45) c.bankCrisis = false;
  const klass = sum(countryProvinces(w, c.id), p => p.pops.workers.sat * p.pops.workers.n) / Math.max(sum(countryProvinces(w, c.id), p => p.pops.workers.n), 1);
  // A general strike is not a coin tossed every quarter. It breaks out when working people are bitter beyond bearing and free to organise, and it holds
  // until their lot is mended or their strike funds and bread give out, which comes sooner where there is no relief and no other work. After it the
  // unions need two years before they can call out the whole country again.
  if (c.strike) {
    const held = w.turn - (c.strikeSince ?? w.turn), lasts = 2 + (c.budget.welfare * (c.paidRatio ?? 1) > .03 ? 1 : 0) - (c.unemployment > .15 ? 1 : 0);
    if (!c.unions || klass >= 34 || held >= lasts) { c.strike = false; c.strikeRest = w.turn + 8; news(w, `${c.name}: the general strike is over${klass >= 34 ? '; the men went back with something to show for it' : !c.unions ? '; the unions were broken' : '; the strike funds ran out and the men went back with nothing'}.`, { kind: 'politics', countries: [c.id] }); }
  } else if (c.unions && klass < 28 && w.turn >= (c.strikeRest ?? 0)) { c.strike = true; c.strikeSince = w.turn; news(w, `${c.name}: a general strike has brought industry to a halt.`, { kind: 'politics', countries: [c.id] }); }
}

function fiscal(w, c) {
  const eff = clamp((.4 + c.bureaucracy / 120) * (1 - c.corruption / 130) * (1 - (c.unrest ?? 0) / 400) * (c._adminFactor ?? 1) * (c.service?.treasury ?? 1), .2, 1);
  const land = c._raw.grain * 10 * c.priceLevel * c.tax.land, business = (sum(RAW.filter(g => g !== 'grain'), g => c._raw[g] * BASE_PRICE[g]) + sum(Object.keys(RECIPE), g => (c._made[g] || 0) * BASE_PRICE[g] * .45)) * c.priceLevel * c.tax.business;
  // Customs are what each good paid at the rate set for it; goods that came in past the customs house paid nothing.
  const customs = (c._duty ?? (c._imports || 0) * c.tariff) * c.priceLevel;
  const revenue = (c.gdp * .45 * c.tax.income + land + business + customs) * eff + (c._tolls || 0) * c.priceLevel;
  const b = c.budget, programs = (b.military + b.welfare + b.infrastructure + b.education + b.police + b.administration) * c.gdp;
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
  for (const [cid, amt] of Object.entries(c.creditors)) if (w.countries[cid]?.alive) { const due = amt * extRate, pay = Math.min(Math.max(c.reserves, 0), due); c.reserves -= pay; w.countries[cid].reserves += pay; extDue += due; extPaid += pay; }
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
    income: c.gdp * .45 * c.tax.income * eff, land: land * eff, business: business * eff, customs: customs * eff, tolls: (c._tolls || 0) * c.priceLevel, works: c._stateProfit || 0,
    programs: Object.fromEntries(Object.keys(b).map(k => [k, b[k] * c.gdp])), agencies, interest, abroad: extPaid * (c.rate || 1), outlay: c._outlay || {},
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
  // Schools add readers quickly; a starved school system loses them only as the old die.
  const school = (b.education * paid - .015) * 25;
  c.literacy = clamp(c.literacy + (school < 0 ? school * .2 : school), 5, 99);
}
// The levels a country inherited are where its habits and its spending had brought it. They are fixed when the world is made, before anyone gives an order,
// so that the first decree of a new ruler moves the country from where it stood and is not itself taken for the country's ordinary state.
export function settleBases(w) {
  for (const c of aliveCountries(w)) {
    c.graftBase ??= c.corruption + c.pressFreedom * .3 + c.courts * .35; c.intelBase ??= c.intelligence - c.police * .5; c.roadShare ??= c.budget.infrastructure;
    for (const p of countryProvinces(w, c.id)) p.infraBase ??= p.infra;
  }
}
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
    // People leave the land for the towns while there is bread there; when bread fails they go back to it.
    if (c.foodRatio >= 1) { const mv = p.pops.peasants.n * clamp((sum(Object.values(p.plants)) - .3) * .002 + c.literacy * .00002, 0, .01); p.pops.peasants.n -= mv; p.pops.workers.n += mv * .8; p.pops.middle.n += mv * .2; }
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
  // When a new technology arrives, the private sector builds the first plants itself; expansion is left to the state or capital.
  const cap = w.provinces[c.capital];
  if (cap && hasTech(c, 'oil_prospecting') && !sum(countryProvinces(w, c.id), p => p.plants.fuel)) cap.plants.fuel = .4;
  if (cap && hasTech(c, 'chemical_fertilizer') && !sum(countryProvinces(w, c.id), p => p.plants.fertilizer)) cap.plants.fertilizer = .4;
  const edu = (b.education * paid - .015) * .12 * (.5 + c.literacy / 100);
  c.tech.ind = clamp(c.tech.ind * (1 + edu + .001 * (.5 + machines)), .5, 10);
  c.tech.agri = clamp(c.tech.agri * (1 + edu * .7 + .0008), .5, 10);
  c.tech.mil = clamp(c.tech.mil * (1 + edu * .6 + b.military * paid * .02), .5, 10);
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
    c.techs[t] = Math.max(1, w.turn); c.research = { target: null, progress: 0 };
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
