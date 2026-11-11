// Leaders do not design the state, they inherit it: regime, budget, army, debt and past differ from country to country.
// Only facts live here; the character is not told how to think, and the leader can change everything.
import { clamp, rand, pick, between, nextId } from './util.js';
import { countryProvinces, aliveCountries, GOOD_LABEL, makeUnit, provincePop } from './world.js';
import { countryRoot } from './names.js';
import { initGroups } from './culture.js';
import { initAdmin } from './admin.js';
import { partyStep, satisfactionStep } from './politics.js';
import { leaderForeignness } from './culture.js';
import { makeParliament } from './polity.js';
import { issueCurrency } from './money.js';
import { initFirms } from './firms.js';
import { seatCourt } from './court.js';
import { burdenAll } from './burdens.js';
import { beginTurn, stepWorld } from './step.js';
import { upkeepCost } from './military.js';
import { seatGovernment, allocateSeats } from './polity.js';
import { settleUnderground } from './underground.js';
import { distance } from './politics.js';
import { writeChronicles, writeLives } from './chronicle.js';
import { updateStrategic, updateRoutes, costOfCapacity, costOfPolice, settleBases } from './economy.js';
import { outfitFleets } from './navy.js';
import { outfitArmies } from './military.js';

const R = (a, b) => [a, b];
const ARCHETYPES = [
  { key: 'junta', suffix: ['Military Government of {}', '{} National Salvation Council'], regime: ['Military junta'], ideology: ['Order nationalism', 'Barracks statism'], elections: false, press: R(5, 20), axes: { econ: R(-10, 30), auth: R(70, 95), nation: R(60, 90), faith: R(-10, 30) }, budget: { military: 0.048, welfare: 0.005, infrastructure: 0.005, education: 0.004 }, tax: { income: 0.2, land: 0.17, business: 0.18 }, tariff: 0.15, treasury: 0.03, reserves: .15, debt: 1.5, army: 2.2, fleet: .6, industry: .6, arms: 2, literacy: R(16, 28), bureaucracy: 40, corruption: 52, police: 72, intelligence: 60, legitimacy: 38, courts: 12, unions: false, ownership: .1, loyalty: 88, rise: ['Took power in a night coup six years ago; the members of the previous government are in exile.', 'The officers who won the civil war declared them head of state.'] },
  { key: 'merchant', suffix: ['Merchant Republic of {}', 'Free Ports of {}'], regime: ['Merchants\' council'], ideology: ['Free trade', 'Merchant oligarchy'], elections: true, press: R(50, 75), axes: { econ: R(60, 90), auth: R(-10, 30), nation: R(-40, 0), faith: R(-20, 10) }, budget: { military: 0.017, welfare: 0.006, infrastructure: 0.016, education: 0.009 }, tax: { income: 0.15, land: 0.08, business: 0.15 }, tariff: 0.05, treasury: 0.5, reserves: 1.4, debt: 0.6, army: .5, fleet: 2, industry: 1.6, arms: .6, literacy: R(50, 65), bureaucracy: 65, corruption: 28, police: 35, intelligence: 50, legitimacy: 60, courts: 65, unions: true, ownership: 0, loyalty: 62, rise: ['Elected council president by the majority of the great trading houses.'] },
  { key: 'monarchy', suffix: ['Kingdom of {}', '{} Empire', 'Crown of {}'], regime: ['Absolute monarchy', 'Nominally constitutional monarchy'], ideology: ['Sanctity of the throne', 'Dynastic loyalty'], elections: false, press: R(10, 30), axes: { econ: R(10, 40), auth: R(65, 90), nation: R(20, 50), faith: R(40, 80) }, budget: { military: 0.028, welfare: 0.004, infrastructure: 0.006, education: 0.004 }, tax: { income: 0.1, land: 0.2, business: 0.1 }, tariff: 0.12, treasury: 0.3, reserves: .5, debt: 1.2, army: 1.2, fleet: 1, industry: .8, arms: 1.2, literacy: R(24, 36), bureaucracy: 55, corruption: 40, police: 55, intelligence: 45, legitimacy: 70, courts: 25, unions: false, ownership: 0, loyalty: 80, advisory: 'Council of Notables', rise: ['Took the throne on a parent\'s death; the dynasty has ruled for two centuries.', 'Succeeded a childless uncle with the approval of the court notables.'] },
  { key: 'republic', suffix: ['Republic of {}'], regime: ['Parliamentary republic'], ideology: ['Liberal republicanism', 'Social reformism'], elections: true, press: R(75, 92), axes: { econ: R(-30, 30), auth: R(-55, -20), nation: R(-20, 15), faith: R(-40, 0) }, budget: { military: 0.022, welfare: 0.028, infrastructure: 0.018, education: 0.02 }, tax: { income: 0.18, land: 0.1, business: 0.2 }, tariff: 0.08, treasury: 0.15, reserves: .5, debt: 1.5, army: .8, fleet: 1, industry: 1.2, arms: .8, literacy: R(50, 62), bureaucracy: 65, corruption: 22, police: 35, intelligence: 40, legitimacy: 62, courts: 70, unions: true, ownership: .05, loyalty: 60, rise: ['Won the last election by a narrow margin; the opposition still disputes the result.', 'Became prime minister after coalition talks that dragged on for months.'] },
  { key: 'revolutionary', suffix: ["{} People's State", 'Revolutionary Republic of {}'], regime: ['One-party state'], ideology: ['Revolutionary socialism', 'Peasant-worker rule'], elections: false, press: R(5, 20), axes: { econ: R(-90, -60), auth: R(55, 85), nation: R(-10, 30), faith: R(-85, -50) }, budget: { military: 0.036, welfare: 0.035, infrastructure: 0.022, education: 0.025 }, tax: { income: 0.22, land: 0.2, business: 0.25 }, tariff: 0.25, treasury: 0.1, reserves: .3, debt: 0.5, army: 1.4, fleet: .5, industry: 1, arms: 1.3, literacy: R(35, 46), bureaucracy: 60, corruption: 35, police: 75, intelligence: 65, legitimacy: 50, courts: 10, unions: true, ownership: .6, loyalty: 78, rise: ['Was among the leaders of the uprising that toppled the old regime; the party elected them general secretary.'] },
  { key: 'agrarian', suffix: ['Principality of {}', 'Kingdom of {}'], regime: ['Weakly centralized kingdom'], ideology: ['Land and tradition'], elections: false, press: R(20, 40), axes: { econ: R(0, 30), auth: R(30, 60), nation: R(10, 40), faith: R(30, 70) }, budget: { military: 0.014, welfare: 0.003, infrastructure: 0.003, education: 0.003 }, tax: { income: 0.08, land: 0.14, business: 0.08 }, tariff: 0.1, treasury: 0.05, reserves: .2, debt: 1.2, army: .6, fleet: .3, industry: .4, arms: .6, literacy: R(12, 20), bureaucracy: 30, corruption: 60, police: 30, intelligence: 25, legitimacy: 55, courts: 20, unions: false, ownership: 0, loyalty: 66, rise: ['Became ruler with the backing of the landlords; in most provinces their word carries only by the landlords\' leave.'] },
  { key: 'federation', suffix: ['{} Confederation', 'United Provinces of {}'], regime: ['Loose federation'], ideology: ['Provincial rights', 'Regional federalism'], elections: true, press: R(45, 70), axes: { econ: R(0, 40), auth: R(-30, 10), nation: R(-20, 20), faith: R(-20, 20) }, budget: { military: 0.019, welfare: 0.006, infrastructure: 0.009, education: 0.005 }, tax: { income: 0.12, land: 0.08, business: 0.16 }, tariff: 0.06, treasury: 0.2, reserves: .8, debt: 1, army: .9, fleet: .8, industry: 1, arms: .9, literacy: R(36, 48), bureaucracy: 40, corruption: 35, police: 30, intelligence: 30, legitimacy: 52, courts: 50, unions: true, ownership: 0, loyalty: 58, rise: ['Elected federal president after long bargaining among the provincial governors.'] },
  { key: 'theocracy', suffix: ['Holy State of {}', 'Sacred Republic of {}'], regime: ['Clerical rule'], ideology: ['Faith state', 'Sacred law'], elections: false, press: R(15, 35), axes: { econ: R(-20, 20), auth: R(50, 80), nation: R(10, 40), faith: R(80, 100) }, budget: { military: 0.026, welfare: 0.012, infrastructure: 0.007, education: 0.012 }, tax: { income: 0.14, land: 0.18, business: 0.1 }, tariff: 0.12, treasury: 0.2, reserves: .5, debt: 0.8, army: 1, fleet: .6, industry: .7, arms: 1, literacy: R(26, 38), bureaucracy: 50, corruption: 32, police: 60, intelligence: 50, legitimacy: 72, courts: 30, unions: false, ownership: .1, loyalty: 75, advisory: 'Council of Clergy', rise: ['The clerical council elected them to the high office; the previous supreme leader died in office.'] }
];
const SUCCESSION_OF = { junta: 'army', merchant: 'council', monarchy: 'dynasty', republic: 'open', revolutionary: 'party', agrarian: 'dynasty', federation: 'open', theocracy: 'clergy' };
const FX_OF = { junta: 'floating', merchant: 'gold', monarchy: 'gold', republic: 'gold', revolutionary: 'gold', agrarian: 'floating', federation: 'floating', theocracy: 'gold' };
const COLORS = ['#2f6f8f', '#a33b3b', '#6a8d3a', '#8a5aa8', '#c58a2a', '#3b8f7f', '#b0577a', '#6b6f3a'];

const jitter = (w, v, by = .18) => v * between(w, 1 - by, 1 + by);
const inRange = (w, [a, b]) => between(w, a, b);
function shuffled(w, list) { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand(w) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function applyArchetype(w, c, a, index) {
  const gdp = Math.max(c.gdp, 1), root = countryRoot(c.majorityEth, c.id);
  Object.assign(c, {
    rootName: root, name: pick(w, a.suffix).replace('{}', root), regime: pick(w, a.regime), ideology: pick(w, a.ideology), archetype: a.key, motto: '', colors: [COLORS[index % COLORS.length], '#efe6c9'],
    elections: a.elections, succession: SUCCESSION_OF[a.key], nextElection: 4 + Math.floor(rand(w) * 12), pressFreedom: inRange(w, a.press), tariff: jitter(w, a.tariff),
    treasury: gdp * jitter(w, a.treasury), reserves: gdp * jitter(w, a.reserves), debt: gdp * jitter(w, a.debt),
    literacy: inRange(w, a.literacy), bureaucracy: jitter(w, a.bureaucracy, .1), corruption: jitter(w, a.corruption, .15), police: jitter(w, a.police, .1), intelligence: jitter(w, a.intelligence, .12), legitimacy: jitter(w, a.legitimacy, .1), courts: jitter(w, a.courts, .15), unions: a.unions, ownership: a.ownership,
    axes: Object.fromEntries(Object.entries(a.axes).map(([k, r]) => [k, Math.round(inRange(w, r))])),
    budget: { ...Object.fromEntries(Object.entries(a.budget).map(([k, v]) => [k, +jitter(w, v, .12).toFixed(4)])), police: 0, administration: 0 },
    tax: Object.fromEntries(Object.entries(a.tax).map(([k, v]) => [k, +jitter(w, v, .1).toFixed(3)]))
  });
  // The inherited budget pays for the administration and police the state actually has.
  c.budget.administration = +costOfCapacity(c.bureaucracy).toFixed(4); c.budget.police = +costOfPolice(c.police).toFixed(4);
  for (const p of countryProvinces(w, c.id)) { for (const k of Object.keys(p.plants)) p.plants[k] *= a.industry; p.infra = clamp(p.infra * (.7 + a.industry * .3), .15, 1.8); }
  c.tech.ind *= .85 + a.industry * .15;
  issueCurrency(c, FX_OF[a.key]);
  c.capitalClosed = a.key === 'revolutionary';
  for (const g of Object.keys(c.stock)) if (g !== 'grain') c.stock[g] *= a.industry;
  c.stock.arms *= a.arms;
  for (const u of Object.values(w.units)) if (u.country === c.id) { u.men = Math.round(u.men * jitter(w, a.army)); u.loyalty = clamp(jitter(w, a.loyalty, .08), 0, 100); }
  for (const f of Object.values(w.fleets)) if (f.country === c.id) f.ships = Math.max(2, Math.round(f.ships * jitter(w, a.fleet)));
  const leader = w.characters[c.leader];
  leader.axes = Object.fromEntries(Object.entries(c.axes).map(([k, v]) => [k, clamp(v + between(w, -15, 15), -100, 100)]));
  leader.rise = pick(w, a.rise);
}

const borderOf = (w, a, b) => countryProvinces(w, a.id).filter(p => p.id !== a.capital && p.neighbors.some(n => w.provinces[n].controller === b.id));
const neighbours = (w, c) => [...new Set(countryProvinces(w, c.id).flatMap(p => p.neighbors.map(n => w.provinces[n].controller)))].filter(x => x !== c.id && w.countries[x]);

function makePast(w) {
  const past = [], cs = aliveCountries(w), pairs = [];
  const say = (year, text, ...countries) => past.push({ year, text, countries: countries.map(c => c.id) });
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) if (neighbours(w, cs[i]).includes(cs[j].id)) pairs.push([cs[i], cs[j]]);
  for (const [a, b] of shuffled(w, pairs).slice(0, Math.ceil(pairs.length * .7))) {
    const roll = rand(w), year = 1868 + Math.floor(rand(w) * 31);
    if (roll < .5) {
      const [winner, loser] = rand(w) < .5 ? [a, b] : [b, a], spoils = borderOf(w, winner, loser);
      if (!spoils.length) continue;
      const p = pick(w, spoils); p.lostBy = loser.id; p.lostIn = year; p.groups = [{ eth: loser.majorityEth, rel: loser.majorityRel, share: .7 }, { eth: winner.majorityEth, rel: winner.majorityRel, share: .3 }]; p.eth = loser.majorityEth; p.rel = loser.majorityRel; p.unrest = clamp(p.unrest + 12, 0, 100);
      say(year, `In the war of ${year}, the province of ${p.name} passed from ${loser.name} to ${winner.name}. Most of its people are still ${loser.majorityEth}.`, winner, loser);
      winner.relations[loser.id] = -35; loser.relations[winner.id] = -55;
    } else if (roll < .75) {
      w.treaties.push({ id: nextId(w, 'A'), kind: 'trade', parties: [a.id, b.id], active: true, pending: false, proposer: a.id, terms: `Trade agreement of ${year}`, clauses: [], breaches: [], expires: null, annex: false, reparations: 0, turn: 0 });
      say(year, `${a.name} and ${b.name} have been bound by a trade agreement since ${year}.`, a, b);
      a.relations[b.id] = 25; b.relations[a.id] = 25;
    } else {
      say(year, `In the border incidents of ${year}, soldiers of ${a.name} and ${b.name} clashed; the dispute was closed without being resolved.`, a, b);
      a.relations[b.id] = -20; b.relations[a.id] = -20;
    }
  }
  const lenders = cs.filter(c => ['merchant', 'federation'].includes(c.archetype)), debtors = cs.filter(c => ['agrarian', 'junta', 'monarchy'].includes(c.archetype));
  for (const d of debtors) {
    if (!lenders.length) break;
    const l = pick(w, lenders), amount = Math.max(d.gdp, 1) * between(w, .2, .5), year = 1880 + Math.floor(rand(w) * 18);
    d.creditors[l.id] = amount; say(year, `${d.name} has owed the banks of ${l.name} ${Math.round(amount)} since ${year}.`, d, l);
  }
  for (const c of cs) {
    if (['agrarian', 'junta'].includes(c.archetype) && rand(w) < .7) { const year = 1885 + Math.floor(rand(w) * 13); say(year, `${c.name} lost a significant part of its population in the famine of ${year}.`, c); }
    const known = k => countryProvinces(w, c.id).some(p => p.deposits[k]?.known);
    for (const k of ['coal', 'iron']) if (!known(k)) {
      const rich = cs.filter(o => o.id !== c.id && countryProvinces(w, o.id).some(p => p.deposits[k]?.known));
      if (rich.length) say(1899, `${c.name} has no known ${GOOD_LABEL[k]} deposits on its soil; the known deposits are held by ${rich.map(o => o.name).join(', ')}.`, c, ...rich);
    }
  }
  return past.sort((a, b) => a.year - b.year);
}

// An inherited state starts at rest. Its people already feel about it what its taxes, policies and police make them feel,
// and whatever standing the regime has beyond that is carried as its own. The new ruler does not watch a slide they did not cause.
// Where each kind of state stands with its books when it is handed over, as a share of a quarter's output: a merchant republic lays money by,
// most states are near balance, a junta and a poor agrarian state live beyond their means. The taxes each inherited are set so that this is
// where the first quarters actually come out, instead of leaving every state to find a hole in its accounts by the end of the first year.
const BOOKS = { merchant: .010, republic: .003, federation: .001, monarchy: -.002, theocracy: -.003, revolutionary: -.007, agrarian: -.009, junta: -.016 };
function balance(w, cs) {
  // A country that has stood for years has its warehouses at their usual depth, its prices where its trade has settled them and its people in such work
  // as there is. Three years are run on a copy and the stores, the market and the labour market are taken from it, so that the first year anyone
  // governs is an ordinary year and not the year the stores fill up.
  { const trial = structuredClone(w); trial.status = 'playing'; for (let i = 0; i < 12; i++) { beginTurn(trial); stepWorld(trial); }
    for (const c of cs) { const t = trial.countries[c.id]; if (!t?.alive) continue; for (const g of Object.keys(c.stock)) if (g !== 'grain') c.stock[g] = t.stock[g]; c.unemployment = t.unemployment; c.lastSold = { ...t.lastSold }; c._need = { ...t._need };
      // The army a state has kept for years is an army it has been paying: its military budget is what those men cost, measured against the output the country settles at.
      if (t.realGdp > 0) c.budget.military = clamp(upkeepCost(w, c) / Math.max(c.priceLevel, .01) / t.realGdp * 1.03, .002, .2); }
    w.globalPrice = { ...trial.globalPrice }; }
  // The books are read after a year and a half, when the first quarters' adjustments are over: that is the level the state lives at.
  // Twice over: the first reading sets the rates, the second corrects for what those rates themselves changed.
  for (let pass = 0; pass < 2; pass++) {
    const trial = structuredClone(w); trial.status = 'playing';
    for (let i = 0; i < 6; i++) { beginTurn(trial); stepWorld(trial); }
    for (const c of cs) {
      const t = trial.countries[c.id]; if (!t?.alive || !(t.lastRevenue > 0)) continue;
      const want = (BOOKS[c.archetype] ?? 0) * t.gdp, factor = clamp((t.lastRevenue + want - t.lastBalance) / t.lastRevenue, .5, 1.8);
      for (const k of Object.keys(c.tax)) c.tax[k] = clamp(c.tax[k] * factor, .02, .6); c.tariff = clamp(c.tariff * factor, 0, .6);
    }
  }
  // The people have lived under these taxes for years: their temper is where such taxes leave it.
  settle(w, cs);
}
function settle(w, cs) {
  const held = cs.map(c => c.legitimacy), rest = n => { for (let i = 0; i < n; i++) { satisfactionStep(w); cs.forEach((c, k) => { c.legitimacy = held[k]; }); } };
  rest(16);
  // A state that has ruled restive provinces for years already keeps troops in them.
  for (const c of cs) for (const p of countryProvinces(w, c.id).filter(x => x.unrest > 55).sort((a, b) => b.unrest - a.unrest).slice(0, 12)) {
    const army = Object.values(w.units).filter(u => u.country === c.id), from = [...army].sort((a, b) => b.men - a.men)[0], need = Math.round(provincePop(p) * .03);
    if (!from || from.men < need * 4) break;
    if (army.some(u => u.province === p.id)) continue;
    from.men -= need; Object.assign(makeUnit(w, c.id, p.id, need, from.quality, from.loyalty, from.kind), { morale: from.morale, equip: from.equip });
  }
  rest(10);
  for (const c of cs) c.legitBase = Math.round(clamp(c.legitimacy - (22 + c.popularity * .75 - leaderForeignness(w, c)), -10, 45));
}

export function inheritStates(w) {
  const cs = aliveCountries(w), bag = shuffled(w, ARCHETYPES);
  cs.forEach((c, i) => applyArchetype(w, c, bag[i % bag.length], i));
  initGroups(w);
  w.past = makePast(w);
  initAdmin(w);
  writeChronicles(w); writeLives(w);
  initFirms(w);
  outfitFleets(w);
  // Routes are known from the start so shipment and credit decisions can be made in the first quarter too.
  updateStrategic(w); updateRoutes(w);
  // The people around the seats are there from the first day, and the state's offices work as they are staffed.
  w.burdens = true; w.friction = true; seatCourt(w);
  // An army that has stood for years has sent trained men home every year: they are its reserve.
  for (const c of cs) c.reserve = Object.values(w.units).filter(u => u.country === c.id).reduce((a, u) => a + u.men, 0) * .6;
  settle(w, cs);
  balance(w, cs);
  for (let i = 0; i < 8; i++) partyStep(w);
  for (const c of cs) {
    const a = ARCHETYPES.find(x => x.key === c.archetype);
    if (c.elections) makeParliament(c, a.key === 'merchant' ? 'Merchants\' Assembly' : 'Parliament');
    else if (a.advisory) makeParliament(c, a.advisory, false);
    // A government that has sat for years sits on a majority: the parties nearest the ruling party are on its benches until it has one, and
    // the strongest of the others, the party the leader of the opposition speaks for, sits outside.
    if (c.elections && c.parliament) seatGovernment(w, c);
  }
  // Those benches have been sat on for years: the parties' followings, and the seats that go with them, are where that has left them.
  for (let i = 0; i < 8; i++) partyStep(w);
  for (const c of cs) if (c.elections && c.parliament) { c.parliament.seats = allocateSeats(c); seatGovernment(w, c); }
  // Those in the seats do not arrive with clean hands and empty pockets.
  burdenAll(w);
  settleBases(w);
  // Whatever armed underground such a state breeds is already there on the day it is handed over.
  settleUnderground(w);
  // Last of all, so that nothing else about the day of handing over depends on it: every army has its horsemen.
  outfitArmies(w);
}
