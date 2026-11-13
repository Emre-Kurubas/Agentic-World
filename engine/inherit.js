// Leaders do not design the state, they inherit it: regime, budget, army, debt and past differ from country to country.
// Only facts live here; the character is not told how to think, and the leader can change everything.
import { clamp, rand, pick, between, nextId } from './util.js';
import { countryProvinces, aliveCountries, GOOD_LABEL, GOODS, RAW, makeUnit, provincePop, outlying } from './world.js';
import { countryRoot, hashOf } from './names.js';
import { initGroups } from './culture.js';
import { initCreeds } from './doctrine.js';
import { initLeagues } from './leagues.js';
import { initTable } from './rank.js';
import { initAdmin } from './admin.js';
import { partyStep, satisfactionStep } from './politics.js';
import { leaderForeignness } from './culture.js';
import { makeParliament } from './polity.js';
import { issueCurrency, STORE } from './money.js';
import { initFirms } from './firms.js';
import { seatCourt } from './court.js';
import { burdenAll } from './burdens.js';
import { beginTurn, stepWorld } from './step.js';
import { upkeepCost } from './military.js';
import { seatGovernment, allocateSeats } from './polity.js';
import { settleUnderground } from './underground.js';
import { distance } from './politics.js';
import { writeChronicles, writeLives } from './chronicle.js';
import { updateStrategic, updateRoutes, costOfCapacity, costOfPolice, settleBases, RECIPE, economyStep } from './economy.js';
import { MAX_PLANT, MAX_MINE } from './projects.js';
import { outfitFleets } from './navy.js';
import { outfitArmies } from './military.js';
import { RESERVE } from './frontier.js';

const R = (a, b) => [a, b];
const ARCHETYPES = [
  { key: 'junta', suffix: ['Military Government of {}', '{} National Salvation Council'], regime: ['Military junta'], ideology: ['Order nationalism', 'Barracks statism'], elections: false, press: R(5, 20), axes: { econ: R(-10, 30), auth: R(70, 95), nation: R(60, 90), faith: R(-10, 30) }, budget: { military: 0.048, welfare: 0.005, infrastructure: 0.005, education: 0.004 }, tax: { income: 0.2, land: 0.17, business: 0.18 }, tariff: 0.15, treasury: 0.03, reserves: .15, debt: 1.5, army: 1.6, fleet: .6, industry: .6, arms: 2, literacy: R(16, 28), bureaucracy: 40, corruption: 52, police: 72, intelligence: 60, legitimacy: 38, courts: 12, unions: false, ownership: .1, loyalty: 88, rise: ['Took power in a night coup six years ago; the members of the previous government are in exile.', 'The officers who won the civil war declared them head of state.'] },
  { key: 'merchant', suffix: ['Merchant Republic of {}', 'Free Ports of {}'], regime: ['Merchants\' council'], ideology: ['Free trade', 'Merchant oligarchy'], elections: true, press: R(50, 75), axes: { econ: R(60, 90), auth: R(-10, 30), nation: R(-40, 0), faith: R(-20, 10) }, budget: { military: 0.017, welfare: 0.006, infrastructure: 0.016, education: 0.009 }, tax: { income: 0.15, land: 0.08, business: 0.15 }, tariff: 0.05, treasury: 0.5, reserves: 1.4, debt: 0.6, army: .7, fleet: 2, industry: 1.6, arms: .6, literacy: R(50, 65), bureaucracy: 65, corruption: 28, police: 35, intelligence: 50, legitimacy: 60, courts: 65, unions: true, ownership: 0, loyalty: 62, rise: ['Elected council president by the majority of the great trading houses.'] },
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

// What kind of people each kind of state is made of: of every hundred, how many live on the land, by their hands in the towns, in the middle
// ranks and at the top. A republic of merchants is a country of townsmen and counting-houses, an agrarian principality one of peasants with a
// thin middle; a party state has its workers and few rich. It is a fact the state inherits, like its debt: whoever governs changes it only as
// the engine lets anyone change it, by the works that draw people to the towns, by schools, by what happens to the land. Within a country the
// capital, the great harbours and the railway towns hold more of the townspeople and the back country more of the peasants.
const SOCIETY = { merchant: [.44, .31, .21, .04], republic: [.50, .29, .18, .03], federation: [.54, .27, .16, .03], revolutionary: [.56, .31, .11, .02], monarchy: [.60, .25, .12, .03], theocracy: [.62, .24, .11, .03], junta: [.62, .25, .10, .03], agrarian: [.70, .18, .09, .03] };
function settleSociety(w, c, a) {
  const [land, town, mid, top] = SOCIETY[a.key] ?? [.56, .27, .14, .03], ps = countryProvinces(w, c.id), townish = p => p.id === c.capital ? 1 : (p.port >= 2 ? .5 : 0) + (p.rail ? .3 : 0);
  const all = ps.reduce((s, p) => s + provincePop(p), 0) || 1, mean = ps.reduce((s, p) => s + townish(p) * provincePop(p), 0) / all;
  for (const p of ps) { const n = provincePop(p), peasants = clamp(land - .25 * (townish(p) - mean), .15, .9), rest = (1 - peasants) / (1 - land);
    p.pops.peasants.n = n * peasants; p.pops.workers.n = n * town * rest; p.pops.middle.n = n * mid * rest; p.pops.elite.n = n * top * rest; }
  // What the country turns out, reckoned as the map reckoned it (world.js bootEconomy), so that what it inherits in money is in proportion to what it is.
  const gdp = ps.reduce((s, p) => s + p.pops.peasants.n * p.fertility * .02 * 10 + p.pops.workers.n * .5 + p.pops.middle.n, 0); c.gdp = gdp; c.realGdp = gdp; c.money = gdp * 2;
}
function applyArchetype(w, c, a, index) {
  settleSociety(w, c, a);
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
  // What a state holds across the sea from its own landmass it took at some date, and the people there are not its own.
  for (const c of cs) { const away = outlying(w, Object.values(w.provinces).filter(p => p.owner === c.id)).filter(x => x.sea).flatMap(x => x.provinces); if (!away.length) continue;
    const year = 1820 + (hashOf(c.id + away[0].id) % 60), folk = [...new Set(away.map(p => p.eth))].filter(e => e !== c.majorityEth);
    say(year, `${c.name} has held ${away.length === 1 ? away[0].name : `${away.slice(0, 3).map(p => p.name).join(', ')}${away.length > 3 ? ` and ${away.length - 3} more provinces` : ''}`} across the sea since ${year}${folk.length ? `; the people there are ${folk.join(' and ')}` : ''}.`, c); }
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
// What each kind of state lives by. A country of fields feeds others and buys their wares; a country of workshops and counting-houses buys part
// of its bread abroad and pays for it in manufactures. The lean is measured against the world the state finds itself in. The world grows a little
// more bread than it eats (SPARE), every state with grain to spare has a share of the market for it, and what each such state lacks in wares is
// what its share of that market will buy (grain being cheap when there is plenty of it: TERMS), so that no state's gold drains away to the
// others in the ordinary course of trade.
const LEAN = { merchant: -.6, republic: -.36, federation: -.2, revolutionary: .03, theocracy: .1, monarchy: .12, junta: .12, agrarian: .3 }, SPARE = .1, TERMS = .8;
// The mills, the engine works and the pits of a world that has stood for years are as large as its trade has made them: nobody went on sinking
// shafts for coal that lay unsold at the pithead. What each state uses of steel, machinery, coal, iron, copper and timber in an ordinary quarter
// (for its wares, its arms, the wear of its machines, its ordinary building, its hearths and bunkers) is reckoned up, and its works and workings
// are scaled so that the world's together run a little short of flat out (RUN) and the stores stand at their usual depth.
// Pits: a state that has the seams raises at least what it uses itself, as far as its ground allows; the states with seams to spare share the
// custom of those that have none, by the size of their fields. Who must buy coal or iron is therefore decided by the ground, not by chance.
// Mills and engine works: scaled most of the way toward what each state uses, so that a country of workshops still has steel and engines to
// sell and a country of fields still buys some. The hands the smaller works no longer need are in the small trades of the towns (economy.js
// extract). Arms works are left as they are: an arsenal is kept for a war, not for the quarter's wear.
// A year of the economy alone on a copy of the world: enough to measure works, stores and trade by, without the politics of the copy.
const trade = t => { beginTurn(t); economyStep(t); t.turn += 1; };
const RUN = { steel: .86, machines: .86, coal: .88, iron: .88, copper: .85, timber: .88 }, OWN = .6;
function sizeWorks(w, cs) {
  const trial = structuredClone(w); trial.status = 'playing'; for (let i = 0; i < 2; i++) trade(trial);
  const ts = cs.map(c => trial.countries[c.id]).filter(t => t?.alive && t._need && t._build); if (!ts.length) return;
  const menOf = id => Object.values(trial.units).filter(u => u.country === id).reduce((s, u) => s + u.men, 0);
  const wants = t => { const D = Object.fromEntries(GOODS.map(g => [g, 0])); D.goods = (t._capAll?.goods || 0) * .9; D.machines = t._pop * .00014 + t._build.machines; D.arms = menOf(t.id) * .004; D.steel = t._build.steel; D.timber = t._build.timber; D.coal = (t._hearth ?? t._pop * .001) + (t._burn?.coal || 0);
    for (const pl of ['goods', 'arms', 'machines', 'steel']) for (const [g, q] of Object.entries(RECIPE[pl])) D[g] += D[pl] * q; return D; };
  const own = Object.fromEntries(ts.map(t => [t.id, wants(t)])), fullOf = (t, g) => (RAW.includes(g) ? t._rawFull?.[g] : t._capAll?.[g]) || 0, by = {};
  for (const g of Object.keys(RUN)) { const D = ts.reduce((s, t) => s + own[t.id][g], 0), full = ts.reduce((s, t) => s + fullOf(t, g), 0), world = full > 0 ? D / RUN[g] / full : 1;
    for (const t of ts) { const mine = fullOf(t, g) > 0 ? own[t.id][g] / RUN[g] / fullOf(t, g) : world;
      (by[t.id] ||= {})[g] = clamp(g === 'timber' ? world : ['steel', 'machines'].includes(g) ? world * Math.pow(Math.max(mine, 1e-6) / Math.max(world, 1e-6), OWN) : Math.max(world, mine), .2, 3); } }
  for (const p of Object.values(w.provinces)) { const f = by[p.controller]; if (!f) continue;
    for (const g of ['steel', 'machines']) p.plants[g] = clamp(p.plants[g] * f[g], 0, MAX_PLANT);
    for (const g of ['coal', 'iron', 'copper']) { const d = p.deposits[g]; if (d?.known && d.mine > 0) d.mine = clamp(d.mine * f[g], .05, MAX_MINE); }
    p.timber *= clamp(f.timber, .5, 2); }
  // And the stores: a year's coal and ore at the pithead, half a year's steel in the yards, two years' machinery, as the trades keep them.
  for (const c of cs) { const t = trial.countries[c.id]; if (!t?.alive || !t._need) continue; for (const g of Object.keys(RUN)) c.stock[g] = Math.max(0, t._need[g]) * (STORE[g] ?? 2) * .9; }
}
function specialise(w, cs) {
  for (let pass = 0; pass < 3; pass++) {
    sizeWorks(w, cs);
    const trial = structuredClone(w), got = {}; trial.status = 'playing';
    for (let i = 0; i < 4; i++) { trade(trial); for (const c of cs) { const t = trial.countries[c.id]; if (!t?.alive || !t._need) continue; const a = (got[c.id] ||= { grain: 0, eaten: 0, cap: 0, made: 0, used: 0 }); a.grain += t._raw.grain; a.eaten += t._need.grain; a.cap += t._capAll.goods; a.made += t._made?.goods || 0; a.used += t._need.goods; } }
    const live = cs.filter(c => got[c.id]?.eaten > 0 && got[c.id].used > 0), size = c => got[c.id].eaten, all = live.reduce((s, c) => s + size(c), 0) || 1, mean = live.reduce((s, c) => s + (LEAN[c.archetype] ?? 0) * size(c), 0) / all;
    const leanOf = c => (LEAN[c.archetype] ?? 0) - mean, short = c => Math.max(0, -leanOf(c) - SPARE) * size(c), over = c => Math.max(0, SPARE + leanOf(c)) * size(c), bread = live.reduce((s, c) => s + short(c), 0), spare = live.reduce((s, c) => s + over(c), 0) || 1;
    for (const c of live) { const a = got[c.id], lean = leanOf(c), ps = countryProvinces(w, c.id);
      const f = clamp((1 + SPARE + lean) / Math.max(a.grain / a.eaten, .05), .6, 1.6); for (const p of ps) p.fertility *= f;
      // A state that buys bread has works to spare for the wares that pay for it; any other makes less than it uses by what its grain will buy.
      const buysBread = short(c) > 0, now = (buysBread ? a.cap : a.made) / a.used, want = buysBread ? Math.max(now, 1.15 - lean) : 1 - TERMS * bread * (over(c) / spare) / size(c), k = clamp(Math.pow(want / Math.max(now, .05), .8), .5, 2); for (const p of ps) p.plants.goods *= k; }
  }
}
// (Only the junta and the poor agrarian state are handed over plainly in the red: that is those states' character. A throne and a temple keep
// their books level, a party state runs a little short. When five kinds in eight started in deficit, most treasuries in any world were always red.)
const BOOKS = { merchant: .010, republic: .003, federation: .001, monarchy: .001, theocracy: .001, revolutionary: -.003, agrarian: -.009, junta: -.016 };
// A state that buys its coal or its ore, or its bread, has long since found something to pay with: its workshops make for the foreigner what
// its mines and fields do not yield, and a state that sells coal and grain buys its cloth and boots abroad with the proceeds instead of
// making them all. Each state's works for consumer goods are set so that, over ordinary years, its gold neither drains away nor piles up.
function payments(w, cs) {
  for (let pass = 0; pass < 2; pass++) {
    sizeWorks(w, cs);
    const trial = structuredClone(w), was = {}, got = {}; trial.status = 'playing';
    for (let i = 0; i < 6; i++) { trade(trial); for (const c of cs) { const t = trial.countries[c.id]; if (!t?.alive) continue; if (i === 1) was[c.id] = t.reserves; if (i >= 2) { const a = (got[c.id] ||= { cap: 0, n: 0 }); a.cap += t._capAll?.goods || 0; a.n++; } } }
    for (const c of cs) { const t = trial.countries[c.id], a = got[c.id]; if (!t?.alive || !a?.n || was[c.id] == null) continue;
      const flow = (t.reserves - was[c.id]) / a.n, cap = a.cap / a.n * trial.globalPrice.goods; if (!(cap > 0)) continue;
      const k = clamp(1 - flow / cap, .75, 1.35); for (const p of countryProvinces(w, c.id)) p.plants.goods = clamp(p.plants.goods * k, 0, MAX_PLANT); }
  }
}
// Nobody inherits a country that is already going under for want of a mineral it cannot pay for. Where the years before the handing over
// leave a state's builders and works without the coal or the ore they must buy (it has too little to sell and too little gold), that state
// has long since been working the thin seams it has: they are known and worked on the day it is handed over, and it buys the rest.
function thinSeams(w, cs) {
  // Judged over four years of the economy alone, by the worst of the later quarters and by what is left of the gold: a state that goes short of
  // coal for a year in every three is a state that cannot pay for it.
  const trial = structuredClone(w), worst = {}; trial.status = 'playing';
  for (let i = 0; i < 16; i++) { trade(trial); if (i >= 5) for (const c of cs) { const t = trial.countries[c.id]; if (!t?.alive) continue; const x = (worst[c.id] ||= { input: 1, shops: 9 }); x.input = Math.min(x.input, t.inputRatio ?? 1); x.shops = Math.min(x.shops, t.goodsRatio ?? 1); } }
  let opened = false;
  for (const c of cs) { const t = trial.countries[c.id], x = worst[c.id]; if (!t?.alive || !x || ((t.built ?? 1) >= .7 && x.input >= .8 && x.shops >= .8 && t.reserves >= c.reserves * .4)) continue;
    for (const k of Object.keys(FIELDS)) { const ps = countryProvinces(w, c.id); if (ps.some(p => p.deposits[k]?.known && p.deposits[k].mine > 0)) continue;
      const hidden = ps.filter(p => p.deposits[k] && !p.deposits[k].known);
      // Where the ground kept nothing at all, the hill province with the most working people has the thin seam every country has somewhere.
      if (!hidden.length) { const p = [...ps].filter(q => q.id !== c.capital).sort((x, y) => (['hills', 'mountain'].includes(y.terrain) - ['hills', 'mountain'].includes(x.terrain)) || y.pops.workers.n - x.pops.workers.n || (x.id < y.id ? -1 : 1))[0]; if (p) { p.deposits[k] = { amount: k === 'coal' ? 1200 : 900, rich: .6, known: false, mine: 0 }; hidden.push(p); } }
      for (const p of hidden) { Object.assign(p.deposits[k], { known: true, mine: .8 }); opened = true; } } }
  return opened;
}
function balance(w, cs) {
  specialise(w, cs); payments(w, cs); if (thinSeams(w, cs)) payments(w, cs); sizeWorks(w, cs);
  // A country that has stood for years has its warehouses at their usual depth, its prices where its trade has settled them and its people in such work
  // as there is. Three years are run on a copy and the stores, the market and the labour market are taken from it, so that the first year anyone
  // governs is an ordinary year and not the year the stores fill up.
  // (The economy alone is run, with the armies' ordinary wear of arms taken out of the arsenals as it would be: what is wanted is the country's
  // ordinary stores, and a rising or a coup on the copy would leave its last quarter's wreckage in the real country's warehouses on the first day.)
  { const trial = structuredClone(w); trial.status = 'playing'; for (let i = 0; i < 12; i++) { trade(trial); for (const c of cs) { const t = trial.countries[c.id]; if (t?.alive) t.stock.arms = Math.max(0, t.stock.arms - Object.values(trial.units).filter(u => u.country === c.id).reduce((s, u) => s + u.men, 0) * .004); } }
    // The granaries are taken with the rest: a state that sells grain has its surplus on the quay and one that buys bread has the fortnight's
    // store it lives on, and the merchants of both have last quarter's takings in hand. (When the granaries alone were left as the map made them,
    // every state began with the same full barns, nobody bought or sold bread for a year, and no customs house took anything.)
    for (const c of cs) { const t = trial.countries[c.id]; if (!t?.alive) continue; for (const g of Object.keys(c.stock)) c.stock[g] = t.stock[g]; c.unemployment = t.unemployment; c.lastSold = { ...t.lastSold }; c._need = { ...t._need }; c.lastExportGold = t.lastExportGold || 0;
      // And lenders have long since learned what this state's money does: they ask what its prices have taught them to ask, not a newcomer's premium.
      c.inflation = t.inflation; c.inflTrend = t.inflTrend ?? Math.max(0, t.inflation); c._lastShortage = t._lastShortage;
      // The army a state has kept for years is an army it has been paying: its military budget is what those men cost, measured against the output the country settles at.
      if (t.realGdp > 0) c.budget.military = clamp(upkeepCost(w, c) / Math.max(c.priceLevel, .01) / t.realGdp * 1.03, .002, .2); }
    // Prices too have long since found their level against the neighbours': a state that sells more than it buys has seen gold come in and its
    // prices rise until its people bought abroad what they had not before. Each state starts with the price level, against the others', that
    // those years left it, and its money, its treasury and its debt are reckoned in that money; the gold in its vaults is what it inherited.
    { const live = cs.filter(c => trial.countries[c.id]?.alive), rel = c => { const t = trial.countries[c.id]; return Math.max(t.priceLevel / (t.rate || 1), 1e-6) / Math.max(c.priceLevel / (c.rate || 1), 1e-6); }, size = c => Math.max(trial.countries[c.id].realGdp, 1), all = live.reduce((s, c) => s + size(c), 0) || 1, mean = Math.exp(live.reduce((s, c) => s + Math.log(rel(c)) * size(c), 0) / all);
      for (const c of live) { const k = clamp(rel(c) / mean, .7, 1.4); for (const key of ['priceLevel', 'wageIndex', 'money', 'treasury', 'debt', 'gdp']) c[key] *= k; } }
    w.globalPrice = { ...trial.globalPrice }; }
  // The books are read over the first year and a half as it will actually be lived, now that stores, trade and prices start where they had
  // settled: the state's books stand where its kind of state keeps them from the first quarter, not only from the sixth.
  // Three times over: the first reading sets the rates, the others correct for what those rates themselves changed.
  for (let pass = 0; pass < 3; pass++) {
    const trial = structuredClone(w), got = {}; trial.status = 'playing';
    for (let i = 0; i < 6; i++) { beginTurn(trial); stepWorld(trial); for (const c of cs) { const t = trial.countries[c.id]; if (!t?.alive || !(t.lastRevenue > 0)) continue; const a = (got[c.id] ||= { rev: 0, bal: 0, gdp: 0 }); a.rev += t.lastRevenue; a.bal += t.lastBalance; a.gdp += t.gdp; } }
    for (const c of cs) {
      const a = got[c.id]; if (!trial.countries[c.id]?.alive || !(a?.rev > 0)) continue;
      const want = (BOOKS[c.archetype] ?? 0) * a.gdp, factor = clamp((a.rev + want - a.bal) / a.rev, .5, 1.8);
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

// Coal and iron lie in fields, not under every third hill. The map scatters seams everywhere; what a world inherits is a few coalfields and
// fewer ore districts that are known and worked, richer than a scattered seam, and around them country where nothing workable has been found:
// most of the scattered seams are not there at all, and a third lie undiscovered, thin and poor, for a survey or a time of dear coal to find.
// So in every world some states have coal to sell, some have ore, and some must buy one or both; who is which is decided by the ground.
// (When every state had both in several times what it could burn, no blockade, embargo or conquest ever touched a mill.)
// Nothing here is drawn by lot: the fields are the richest seams that lie far enough apart.
const FIELDS = { coal: { fields: .8, seams: 2.6 }, iron: { fields: .6, seams: 2 } };
function dealFields(w, cs) {
  const at = (a, b) => Math.hypot(a.cx - b.cx, a.cy - b.cy), holds = (c, k) => countryProvinces(w, c.id).some(p => p.deposits[k]?.field);
  for (const [k, plan] of Object.entries(FIELDS)) {
    const seams = Object.values(w.provinces).filter(p => p.deposits[k] && w.countries[p.owner]?.alive), worth = p => p.deposits[k].amount * p.deposits[k].rich; if (seams.length < 2) continue;
    const centres = [[...seams].sort((a, b) => worth(b) - worth(a) || (a.id < b.id ? -1 : 1))[0]], n = Math.max(2, Math.round(cs.length * plan.fields));
    while (centres.length < Math.min(n, seams.length)) centres.push(seams.filter(p => !centres.includes(p)).sort((a, b) => Math.min(...centres.map(c => at(b, c))) * Math.sqrt(worth(b)) - Math.min(...centres.map(c => at(a, c))) * Math.sqrt(worth(a)) || (a.id < b.id ? -1 : 1))[0]);
    const near = [...seams].sort((a, b) => Math.min(...centres.map(c => at(a, c))) - Math.min(...centres.map(c => at(b, c))) || (a.id < b.id ? -1 : 1)), keep = Math.max(centres.length, Math.round(cs.length * plan.seams));
    // Every state keeps at least one thin seam of what it had, found or not: the ground of a whole country is never quite bare.
    const thin = new Set(cs.map(c => near.slice(keep).find(p => p.owner === c.id)?.id));
    near.forEach((p, i) => { const d = p.deposits[k];
      if (i < keep) Object.assign(d, { field: true, known: true, rich: d.rich * 1.25, amount: d.amount * 1.5, mine: d.mine > 0 ? d.mine : .8 });
      else if ((i - keep) % 3 === 0 || thin.has(p.id)) Object.assign(d, { known: false, mine: 0, rich: d.rich * .6, amount: d.amount * .5 });
      else delete p.deposits[k]; });
    // If the fields happen to reach into every state, the state with the least of them has only the thin seams at their edge: known, and not worth working.
    // (Of two such states, the one that still has the other mineral: no state is left without both for the sake of the rule.)
    if (cs.length > 2 && cs.every(c => holds(c, k))) { const other = k === 'coal' ? 'iron' : 'coal', least = [...cs].sort((a, b) => (k === 'iron' ? holds(b, other) - holds(a, other) : 0) || 0).sort((a, b) => countryProvinces(w, a.id).filter(p => p.deposits[k]?.field).reduce((s, p) => s + worth(p), 0) - countryProvinces(w, b.id).filter(p => p.deposits[k]?.field).reduce((s, p) => s + worth(p), 0) || (a.id < b.id ? -1 : 1))[0];
      for (const p of countryProvinces(w, least.id)) { const d = p.deposits[k]; if (d?.field) Object.assign(d, { field: false, known: false, mine: 0, rich: d.rich * .5, amount: d.amount * .4 }); } }
  }
  // A state with neither a coalfield nor an ore district works what thin coal it has: to be without both is more than a state can pay for.
  for (const c of cs) { if (Object.keys(FIELDS).some(k => holds(c, k))) continue; const ps = countryProvinces(w, c.id), k = ['coal', 'iron'].find(g => ps.some(p => p.deposits[g])); if (k) for (const p of ps) if (p.deposits[k]) Object.assign(p.deposits[k], { known: true, mine: .8 }); }
}

// Frontiers come with their fortresses. Every state has put stone where it was most afraid: on the frontier province that bars the road to its
// capital, in a pass or behind a river where there is one, facing the neighbour it has fought or quarrelled with. States that keep small
// armies keep more and stronger works (a fortress is what a rich state has instead of a large army), and the old thrones and the trading
// republics have works round their capitals as well. The works are inherited fact: they cost their keep every quarter, and whoever governs
// may let them go or build more. (No map had a single fortress, and an army entered its neighbour's country a province a quarter.)
const FORTS = { merchant: [2, 1, 1], republic: [2, 1], federation: [2, 1], monarchy: [2, 1], theocracy: [1, 1], agrarian: [1], revolutionary: [1], junta: [1] }, WALLED = ['merchant', 'republic', 'monarchy'];
function fortify(w, cs) {
  for (const c of cs) { const ps = countryProvinces(w, c.id), own = new Set(ps.map(p => p.id)), far = { [c.capital]: 0 }, q = [c.capital];
    while (q.length) { const x = q.shift(); for (const n of w.provinces[x].neighbors) if (own.has(n) && !(n in far)) { far[n] = far[x] + 1; q.push(n); } }
    const foes = p => [...new Set(p.neighbors.map(n => w.provinces[n].controller))].filter(id => id !== c.id && w.countries[id]?.alive), pass = p => w.strategic.some(s => s.type === 'pass' && s.ref === p.id);
    const worth = p => (pass(p) ? 3 : 0) + (['mountain', 'hills'].includes(p.terrain) ? 1.5 : 0) + (p.river >= .3 ? 1.5 : 0) + Math.max(0, ...foes(p).map(id => -(c.relations[id] ?? 0))) / 20 + 4 / (1 + (far[p.id] ?? 8)) + (p.lostBy && p.lostBy !== c.id ? 1 : 0);
    const frontier = ps.filter(p => p.id !== c.capital && foes(p).length).sort((a, b) => worth(b) - worth(a) || (a.id < b.id ? -1 : 1)), built = [];
    for (const level of FORTS[c.archetype] ?? [1]) { const p = frontier.find(x => !built.includes(x) && !built.some(b => b.neighbors.includes(x.id))) ?? frontier.find(x => !built.includes(x)); if (!p) break; p.fort = level; built.push(p); }
    if (WALLED.includes(c.archetype) && w.provinces[c.capital]) w.provinces[c.capital].fort = Math.max(w.provinces[c.capital].fort || 0, 1);
    if (built.length) { const facing = [...new Set(built.flatMap(foes))].map(id => w.countries[id]); w.past.push({ year: 1870 + (hashOf(c.id) % 25), text: `${c.name} keeps fortress works at ${built.map(p => p.name).join(', ')}, on its frontier with ${facing.map(o => o.name).join(' and ')}${WALLED.includes(c.archetype) ? ', and round its capital' : ''}.`, countries: [c.id, ...facing.map(o => o.id)] }); }
  }
  w.past.sort((a, b) => a.year - b.year);
}

export function inheritStates(w) {
  const cs = aliveCountries(w), bag = shuffled(w, ARCHETYPES);
  { const lone = cs.findIndex(c => c.seaState), trader = bag.slice(0, cs.length).findIndex(a => a.key === 'merchant');
    if (lone >= 0 && trader >= 0 && lone !== trader) [bag[lone], bag[trader]] = [bag[trader], bag[lone]]; }
  dealFields(w, cs);
  cs.forEach((c, i) => applyArchetype(w, c, bag[i % bag.length], i));
  // A state that inherits railways knows how to lay them. (World 16: every state began with a dozen railway provinces and no technology at all;
  // a railway ordered on the first morning was refused "for want of the technology".)
  for (const c of cs) c.techs.railway ??= 1;
  initGroups(w);
  w.past = makePast(w);
  fortify(w, cs);
  initAdmin(w);
  writeChronicles(w); writeLives(w);
  initFirms(w);
  outfitFleets(w);
  // Routes are known from the start so shipment and credit decisions can be made in the first quarter too.
  // A state that has held land beyond the sea for years lands its stores there somewhere: every such piece of land has at least a landing place (a
  // harbour of the first class) in its largest province on the coast. (World 17: two island garrisons were inherited where no harbour could
  // supply them and wasted from the first day, whatever their general ordered.)
  for (const c of cs) for (const piece of outlying(w, Object.values(w.provinces).filter(p => p.owner === c.id)).filter(x => x.sea)) { if (piece.provinces.some(p => (p.port || 0) >= 1)) continue; const at = piece.provinces.filter(p => p.coast && p.seas?.length).sort((a, b) => provincePop(b) - provincePop(a))[0]; if (at) at.port = 1; }
  updateStrategic(w); updateRoutes(w);
  // The people around the seats are there from the first day, and the state's offices work as they are staffed.
  w.burdens = true; w.friction = true; w.dearLand = true; seatCourt(w);
  // An army that has stood for years has sent trained men home every year: they are its reserve.
  for (const c of cs) c.reserve = Object.values(w.units).filter(u => u.country === c.id).reduce((a, u) => a + u.men, 0) * RESERVE;
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
  // Land held apart from the body of the country is held by somebody: every piece of it, across the sea or behind a neighbour's land, that has no
  // troops keeps a garrison in its largest province, drawn from the state's biggest body of troops, about four men to the thousand people there.
  // (Counted by piece: one garrison in an enclave by land once left three provinces across the sea without a soldier.)
  for (const c of cs) for (const piece of outlying(w, Object.values(w.provinces).filter(p => p.owner === c.id))) { const away = piece.provinces; if (Object.values(w.units).some(u => u.country === c.id && away.some(p => p.id === u.province))) continue;
    const big = Object.values(w.units).filter(u => u.country === c.id && u.kind === 'infantry').sort((a, b) => b.men - a.men)[0]; if (!big) continue;
    const n = Math.round(Math.min(big.men * .15, Math.max(4, away.reduce((a, p) => a + provincePop(p), 0) * .004))), at = [...away].sort((a, b) => provincePop(b) - provincePop(a))[0]; if (n < 2) continue;
    const g = makeUnit(w, c.id, at.id, n, big.quality, big.loyalty, 'infantry'); g.morale = big.morale; g.equip = big.equip; big.men -= n; }
  garrisonFrontiers(w, cs);
  lastQuarter(w, cs);
  // The creed of each state and the count its keepers are used to: as the state stands on the day of handing over, after everything else.
  w.creeds = true; initCreeds(w, cs);
  // What each country is used to grieving over: a league is born only of what comes after.
  w.leagues = true; initLeagues(w, cs);
  // The table of the powers as the world is handed over.
  initTable(w);
}
// The books of the quarter before anyone governs lie on the desks the first morning. One quarter is run on a copy, as the state stands on the day
// of handing over, and what that quarter's accounts would read (the treasury's books, the prices and the labour market, what each works turned out
// and earned) is taken from it; nothing else is. (World 17: on the first morning every treasury read "revenue 0" and every works "turned out 0".)
function lastQuarter(w, cs) {
  const trial = structuredClone(w); trial.status = 'playing'; beginTurn(trial); stepWorld(trial);
  for (const c of cs) { const t = trial.countries[c.id]; if (!t?.alive) continue; for (const k of Object.keys(t)) if (/^last[A-Z]/.test(k) && t[k] != null) c[k] = structuredClone(t[k]); if (t.interestRate != null) c.interestRate = t.interestRate; if (t.paidRatio != null) c.paidRatio = t.paidRatio; for (const k of ['_made', '_raw', '_from', '_carried', '_hauled', '_freightIn', '_freightOut', 'shipping', '_seaVol', 'goldLog']) if (t[k] != null) c[k] = structuredClone(t[k]);
    // Output as that quarter's books reckoned it. (World 19: the figure of the day of handing over was reckoned another way, and the first
    // quarter read as growth of an eighth to a fifth in every state.)
    // (Only the figure that is read: the money figure the first quarter's votes are reckoned on stays as it was handed over.)
    if (Number.isFinite(t.realGdp) && t.realGdp > 0) c.realGdp = t.realGdp;
    // What the state was already borrowing when it was handed over is what lenders have priced for years (money.js lendersStep).
    c.borrowAvg = Math.max(0, t.lastBorrowed || 0) / Math.max(t.gdp, 1); c.borrowBase = c.borrowAvg * 1.25 + .004; c.rateLog = [t.interestRate ?? c.interestRate].filter(v => v != null);
    // How each class stood on the day of handing over: "angry" is angrier than that (queries.js seatMemoranda).
    { const home = countryProvinces(w, c.id); c.moodBase = Object.fromEntries(['peasants', 'workers', 'middle'].map(k => { const n = home.reduce((a, p) => a + p.pops[k].n, 0) || 1; return [k, home.reduce((a, p) => a + p.pops[k].sat * p.pops[k].n, 0) / n]; })); } }
  w.seaCargo = trial.seaCargo ?? 0;
  for (const f of Object.values(w.firms || {})) { const t = trial.firms?.[f.id]; if (!t || t.strike || t.lockout || t.halted) continue; for (const k of ['lastProfit', 'lastUnits', 'lastTax', 'lastPrice', 'earn']) if (t[k] != null) f[k] = structuredClone(t[k]); }
}

// What a neighbour wants back is not left open to him. A province that another living state lost and has not given up is inherited behind
// fortress works and with a garrison standing on the defensive: about an eighth of the holder's army, never fewer than eight thousand and never
// more than a fifth of what the claimant has under arms. And on the frontier with the neighbour whose army is the largest, every province that
// touches him and stands empty has a covering force of a few thousand. All of it is drawn from the state's largest bodies of troops: the army is
// no larger for it, it stands elsewhere. Done last of all on the day of handing over, so that nothing else about that day depends on it.
// (World 17: four of the six claimed provinces and four fifths of all frontier provinces were inherited without a soldier; in two years four wars
// were declared for such provinces and not one battle was fought: the land was walked into and signed away. The owner: "claimed provinces are to
// be inherited garrisoned and with their fortress manned, and covering troops where the frontier faces the largest neighbour, so that taking them
// takes fighting".)
export const CLAIM_GARRISON = { share: .12, least: 8, ofClaimant: .2 }, SCREEN = { share: .03, least: 3, most: 8, total: .15 };
function garrisonFrontiers(w, cs) {
  const armyOf = c => Object.values(w.units).filter(u => u.country === c.id).reduce((a, u) => a + u.men, 0), here = (c, p) => Object.values(w.units).filter(u => u.country === c.id && u.province === p.id).reduce((a, u) => a + u.men, 0);
  const draw = (c, n, at, posture) => { const big = Object.values(w.units).filter(u => u.country === c.id && u.kind === 'infantry' && u.province !== at.id).sort((a, b) => b.men - a.men || (a.id < b.id ? -1 : 1))[0]; if (!big || big.men - n < Math.max(8, n)) return null;
    const g = makeUnit(w, c.id, at.id, n, big.quality, big.loyalty, 'infantry'); g.morale = big.morale; g.equip = big.equip; big.men -= n; if (posture) g.posture = posture; return g; };
  const strength = Object.fromEntries(cs.map(c => [c.id, armyOf(c)]));
  for (const c of cs) { const mine = countryProvinces(w, c.id), total = strength[c.id]; if (!(total > 0)) continue;
    const claimed = mine.filter(p => p.lostBy && p.lostBy !== c.id && w.countries[p.lostBy]?.alive).sort((a, b) => provincePop(b) - provincePop(a) || (a.id < b.id ? -1 : 1)).slice(0, 3);
    for (const p of claimed) { p.fort = Math.max(p.fort || 0, 1); const want = Math.round(clamp(total * CLAIM_GARRISON.share, CLAIM_GARRISON.least, Math.max(CLAIM_GARRISON.least, (strength[p.lostBy] || 0) * CLAIM_GARRISON.ofClaimant))), lack = want - here(c, p); if (lack >= 2) draw(c, Math.round(lack), p, 'defensive'); else for (const u of Object.values(w.units)) if (u.country === c.id && u.province === p.id && !u.posture) u.posture = 'defensive'; }
    const facing = {}; for (const p of mine) for (const n of p.neighbors) { const o = w.provinces[n].owner; if (o && o !== c.id && w.countries[o]?.alive) (facing[o] ||= new Set()).add(p); }
    const strongest = Object.keys(facing).sort((a, b) => (strength[b] || 0) - (strength[a] || 0) || (a < b ? -1 : 1))[0]; if (!strongest) continue;
    const screen = Math.round(clamp(total * SCREEN.share, SCREEN.least, SCREEN.most)); let spent = 0;
    for (const p of [...facing[strongest]].sort((a, b) => provincePop(b) - provincePop(a) || (a.id < b.id ? -1 : 1))) { if (here(c, p) >= 1 || spent + screen > total * SCREEN.total) continue; if (draw(c, screen, p)) spent += screen; }
  }
}
