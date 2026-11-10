import { clamp, sum, news, rand, between, nextId, pick } from './util.js';
import { CLASSES, ROLES, countryProvinces, provincePop, aliveCountries, makeCountry, spawnCharacter, atWar, clampRel } from './world.js';
import { allocateSeats } from './polity.js';
import { issueCurrency } from './money.js';
import { culturePenalty, leaderForeignness, minorityShare } from './culture.js';
import { adminPressure } from './admin.js';
import { afflict, healthStep, incapacitated } from './health.js';

const CLASS_AXES = { peasants: { econ: -15, auth: 15, nation: 15, faith: 35 }, workers: { econ: -55, auth: -10, nation: 5, faith: 0 }, middle: { econ: 20, auth: -35, nation: 0, faith: -10 }, elite: { econ: 65, auth: 25, nation: 15, faith: 10 } };

export const distance = (a, b) => (Math.abs(a.econ - b.econ) * 1.2 + Math.abs(a.auth - b.auth) + Math.abs(a.nation - b.nation) * .5 + Math.abs(a.faith - b.faith) * .8) / 3.5;

export function modValue(c, key) { return sum(c.mods.filter(m => m.key === key), m => m.delta); }

// What weighs on a class of people in a province and what they credit, each with its weight. The step that moves satisfaction and the report a ruler can ask for both read this one list.
export function moodParts(c, p, k, realWage = c.wageIndex / c.priceLevel) {
  const tax = k === 'peasants' ? c.tax.land : k === 'elite' ? c.tax.business : c.tax.income, town = k === 'workers' || k === 'middle';
  // Relief counts as far as it is actually paid out, and past a point more of it buys little.
  const relief = clamp((c.budget.welfare * (c.paidRatio ?? 1) - .03) * 200, -6, 25);
  return [
    ['hunger', -Math.max(0, 1 - c.foodRatio) * (k === 'elite' ? 12 : 95)],
    ['rising prices', -Math.min(60, Math.max(0, c.inflation - .02) * 160)],
    [k === 'peasants' ? 'the land tax' : k === 'elite' ? 'the tax on business' : 'the income tax', -(k === 'elite' ? 1.5 : 1) * Math.max(0, tax - .12) * 70],
    ['what wages buy', (realWage - 1) * (k === 'elite' ? 15 : 55)],
    ['unemployment', town ? -c.unemployment * 75 : 0],
    [k === 'elite' ? 'what relief for the poor costs them' : 'relief and welfare', k === 'elite' ? -relief * .3 : relief],
    ['the division of the estates', k === 'peasants' ? (c.landShare ?? 0) * 8 : k === 'elite' ? -(c.landShare ?? 0) * 12 : 0],
    ['how the economy is doing', (c.growth || 0) * 60],
    ['the distance between what the state stands for and what they want', -distance(c.axes, CLASS_AXES[k]) * .32],
    ['the ruin of their province', -p.devastation * 28],
    ['weariness of war', -c.warExhaustion * .22],
    ['the standing of the government', (c.legitimacy - 50) * .14],
    ['the state of the press', k === 'middle' ? (c.pressFreedom - 50) * .12 : 0],
    ['state ownership of industry', k === 'elite' ? -c.ownership * 30 : 0],
    ['foreign occupation', p.controller !== p.owner ? -18 : 0],
    ['how the state treats their people and faith', -culturePenalty(c, p)],
    ['what they are being told and promised', modValue(c, 'sat.' + k) + modValue(c, 'sat.all')]
  ];
}

// Troops stationed in a province hold its streets, as far as their numbers go.
export const garrisonHold = (men, pop) => Math.min(15, men / Math.max(pop, 1) * 400);

export function satisfactionStep(w) {
  const garrison = {};
  for (const u of Object.values(w.units)) if (w.provinces[u.province]?.controller === u.country) garrison[u.province] = (garrison[u.province] || 0) + u.men;
  for (const c of aliveCountries(w)) {
    const inWar = w.wars.some(x => x.active && (x.a.includes(c.id) || x.b.includes(c.id)));
    const realWage = c.wageIndex / c.priceLevel;
    let unrestSum = 0, popSum = 0;
    for (const p of countryProvinces(w, c.id)) {
      for (const k of CLASSES) {
        const pop = p.pops[k];
        const t = 66 + sum(moodParts(c, p, k, realWage), x => x[1]);
        pop.sat = clamp(pop.sat + (clamp(t, 0, 100) - pop.sat) * .28, 0, 100);
      }
      const pp = provincePop(p);
      const meanSat = CLASSES.reduce((a, k) => a + p.pops[k].sat * p.pops[k].n, 0) / Math.max(pp, 1);
      // Police hold down open unrest far better where the press cannot report it. That is control, not consent: satisfaction is untouched.
      const grip = c.police * (.1 + .2 * (1 - c.pressFreedom / 100));
      // A province does not forget what was done to it, for as long as those who did it still rule there.
      const scar = p.scar && p.scar.by === p.controller ? p.scar.weight * 40 * Math.max(0, 1 - (w.turn - p.scar.turn) / 80) : 0;
      const pressure = 88 - meanSat * 1.3 + (c.pressFreedom > 70 ? 3 : 0) - grip - garrisonHold(garrison[p.id] || 0, pp) - c.repress * .35 + modValue(c, 'unrest') + adminPressure(p) + scar;
      p.unrest = clamp(p.unrest + (clamp(pressure, 0, 100) - p.unrest) * .35, 0, 100);
      unrestSum += p.unrest * pp; popSum += pp;
    }
    c.unrest = popSum ? unrestSum / popSum : 0;
    updateBlocs(w, c, inWar);
    c.repress = Math.max(0, c.repress - 6);
    const meanPop = weightedSat(w, c);
    c.popularity = meanPop;
    // Legitimacy rests on how people live and on the standing the regime inherited or earned beyond that: a dynasty, a faith, a constitution, a revolution.
    const legitTarget = clamp(22 + meanPop * .75 + (c.legitBase ?? 0) + (c.growth || 0) * 40 - c.arrears * 4 - leaderForeignness(w, c), 5, 95);
    c.legitimacy = clamp(c.legitimacy + (legitTarget - c.legitimacy) * .1 + modValue(c, 'legitimacy'), 0, 100);
    c.mods = c.mods.map(m => ({ ...m, turns: m.turns - 1 })).filter(m => m.turns > 0);
    c.tension = clamp(c.unrest * .55 + (100 - c.legitimacy) * .3 + (100 - c.blocs.army.sat) * .25 + w.plots.filter(x => x.active && x.country === c.id).length * 10 + (inWar ? 10 : 0), 0, 100);
  }
}

// A government's standing rests on its own people. Those it holds down in occupied land are counted as unrest, not as its public.
const homeProvinces = (w, c) => { const own = countryProvinces(w, c.id).filter(p => p.owner === c.id); return own.length ? own : countryProvinces(w, c.id); };
function weightedSat(w, c) {
  let s = 0, n = 0;
  for (const p of homeProvinces(w, c)) for (const k of CLASSES) { s += p.pops[k].sat * p.pops[k].n; n += p.pops[k].n; }
  return n ? s / n : 50;
}
const classSat = (w, c, k) => { let s = 0, n = 0; for (const p of homeProvinces(w, c)) { s += p.pops[k].sat * p.pops[k].n; n += p.pops[k].n; } return n ? s / n : 50; };

function updateBlocs(w, c, inWar) {
  const b = c.blocs, funding = c.militaryFunding ?? 1;
  const set = (x, t) => { x.sat = clamp(x.sat + (clamp(t, 0, 100) - x.sat) * .3, 0, 100); };
  set(b.army, 56 + (funding - .9) * 45 - c.arrears * 9 - c.warExhaustion * .25 + (c.axes.auth * .08) + modValue(c, 'sat.army'));
  set(b.capital, 62 - (c.tax.business - .18) * 110 - c.ownership * 50 - Math.max(0, c.inflation - .03) * 110 + c.axes.econ * .16 + (c.growth || 0) * 150 + modValue(c, 'sat.capital'));
  set(b.workers, classSat(w, c, 'workers'));
  set(b.peasants, classSat(w, c, 'peasants'));
  set(b.clergy, 55 + c.axes.faith * .28 + modValue(c, 'sat.clergy'));
  set(b.bureaucracy, 58 + ((c.paidRatio ?? 1) - .95) * 90 - c.corruption * .1 + modValue(c, 'sat.bureaucracy'));
  b.army.power = clamp(22 + c.budget.military * 340 + c.axes.auth * .08 + (inWar ? 8 : 0), 10, 60);
}

export function canSplit(w, c) {
  return countryProvinces(w, c.id).length >= 4 && w.turn >= (c.noSplitUntil ?? 0) && !w.wars.some(x => x.active && x.civil && (x.a.includes(c.id) || x.b.includes(c.id)));
}

const familyOf = ch => ch.name.split(' ').at(-1);
const mark = (w, ch, text) => { (ch.secrets ||= []).push({ turn: w.turn, text }); ch.secrets = ch.secrets.slice(-12); };
const strongest = (w, c, except) => Object.values(w.characters).filter(x => x.country === c.id && x.alive && x.status === 'free' && x.id !== except && !incapacitated(x)).sort((a, b) => b.power - a.power)[0];

// How power passes when the ruler is gone. Where votes are held the rule is always an interim head and an early vote.
export const SUCCESSION = ['dynasty', 'army', 'party', 'clergy', 'council', 'open'];
export const successionRule = c => c.elections ? 'election' : SUCCESSION.includes(c.succession) ? c.succession : 'open';
export const SUCCESSION_TEXT = { election: 'an interim head of government takes over and a vote is held within half a year', dynasty: 'the throne passes by blood to the next of the ruling family', army: 'the chief of the general staff takes over', party: 'the party picks the strongest of its leading figures', clergy: 'the clerical council elects one of its own', council: 'the great trading houses raise the richest among them', open: 'no rule is settled; whoever is strongest takes it' };

export function installLeader(w, c, ch, regimeChange, keepSlot = false) {
  const old = w.characters[c.leader], oldRole = ch.role, held = c[oldRole] === ch.id;
  if (old && old.id !== ch.id && old.role === 'leader') { old.role = 'former_leader'; old.outSince = w.turn; }
  ch.role = 'leader'; ch.status = 'free'; ch.loyalty = 100; ch.power = Math.max(ch.power, 60); c.leader = ch.id; c.heir = null;
  if (!keepSlot && held && oldRole !== 'leader' && ROLES.includes(oldRole)) { const n = spawnCharacter(w, c.id, oldRole, c.axes); c[oldRole] = n.id; n.rise = `Took the place of ${ch.name}, who became head of state, in ${w.date ?? 'the first days'}.`; }
  if (regimeChange) Object.assign(c, regimeChange);
}

// Who rules next depends on what kind of state it is. A named successor comes first everywhere; after that the army turns to its chief,
// merchants to money, dynasties to blood, clerics to their council, parties to their strongest, and elected governments to an interim head and a vote.
export function succeed(w, c, gone, shock = 0) {
  const free = id => { const x = w.characters[id]; return x?.alive && x.status === 'free' && x.country === c.id && x.id !== gone?.id && !incapacitated(x) ? x : null; };
  const rule = successionRule(c);
  let next = free(c.heir), by = 'as the named successor';
  if (!next) {
    if (rule === 'army') { next = free(c.general); by = 'at the head of the army'; }
    else if (rule === 'council') { next = free(c.oligarch); by = 'by the choice of the great houses'; }
    else if (rule === 'party') { next = [c.general, c.oligarch].map(free).filter(Boolean).sort((a, b) => b.power - a.power)[0]; by = 'by the choice of the party'; }
    else if (rule === 'dynasty' && gone) { next = spawnCharacter(w, c.id, 'leader', c.axes, { family: familyOf(gone), age: [18, clamp((gone.age ?? 50) - 18, 19, 50)], power: 50 }); by = 'by right of blood'; }
    else if (rule === 'clergy') { next = spawnCharacter(w, c.id, 'leader', c.axes, { age: [52, 72], power: 55 }); by = 'by the choice of the clerical council'; }
    else if (rule === 'election') { next = spawnCharacter(w, c.id, 'leader', c.axes, { power: 50 }); by = 'as interim head of government until a vote is held'; }
  }
  const regular = !!next;
  if (rule === 'dynasty' && next && gone?.status === 'dead' && gone.wealth > 0) { next.wealth += Math.round(gone.wealth * .8); gone.wealth = 0; }
  if (!next) { next = strongest(w, c, gone?.id) ?? spawnCharacter(w, c.id, 'leader', c.axes); by = 'in the vacuum that followed'; }
  installLeader(w, c, next);
  if (rule === 'election') c.nextElection = Math.min(c.nextElection ?? Infinity, w.turn + 2);
  // An orderly handover costs little; a scramble for the palace costs the regime part of what it stood on.
  c.legitimacy = clamp(c.legitimacy - (regular ? 3 : 9) - shock, 0, 100);
  if (!regular) c.legitBase = (c.legitBase ?? 0) * .6;
  next.rise = `Came to power in ${w.date ?? 'the first days'}, ${by}, after ${gone?.name ?? 'the last ruler'} ${gone ? fateOf(gone) : 'left office'}.`;
  news(w, `${next.name} took over the government of ${c.name} ${by}.`, { kind: 'politics', countries: [c.id] });
  return next;
}

// What became of someone, as the next person in their seat would put it.
const fateOf = ch => ch.status === 'dead' ? ch.death?.how ?? 'died' : ch.status === 'exiled' ? 'was driven into exile' : ch.status === 'imprisoned' ? 'was imprisoned' : 'left the post';
function replaceSlot(w, c, ch) {
  if (!ROLES.includes(ch.role) || c[ch.role] !== ch.id || ch.role === 'leader') return;
  const n = spawnCharacter(w, c.id, ch.role, c.axes); c[ch.role] = n.id; ch.outSince = w.turn;
  // A business house outlives its head: the heir takes over most of the fortune.
  if (ch.role === 'oligarch' && ch.status === 'dead' && ch.wealth > 0) { n.wealth += Math.round(ch.wealth * .8); ch.wealth = 0; }
  n.rise = `Took the place of ${ch.name}, who ${fateOf(ch)}, in ${w.date ?? 'the first days'}.`;
}

// Posts need a free and living person: a jailed governor governs nothing.
function stripPosts(w, ch) {
  for (const p of Object.values(w.provinces)) if (p.governor === ch.id) p.governor = null;
  for (const u of Object.values(w.units)) if (u.commander === ch.id) u.commander = null;
  for (const c of Object.values(w.countries)) { if (c.heir === ch.id) c.heir = null; for (const i of c.institutions || []) { if (i.head === ch.id) i.head = null; if (i.members?.includes(ch.id)) i.members = i.members.filter(x => x !== ch.id); } }
}
function leavePlots(w, ch) {
  for (const pl of w.plots) { pl.members = pl.members.filter(x => x !== ch.id); if (pl.active && pl.leader === ch.id) { if (pl.members.length) pl.leader = pl.members.shift(); else pl.active = false; } }
}

// Loses freedom, not life. Whoever calls this decides what happens to the office.
export function sideline(w, ch, fate = 'imprisoned') {
  // A name counts for less from a cell or from abroad.
  if (ch.status === 'free') ch.power = Math.round(ch.power * .6);
  ch.status = fate; ch.alive = true; ch.heldSince = w.turn; ch.outSince = w.turn;
  stripPosts(w, ch); leavePlots(w, ch);
}

// Imprisoned or exiled: the seat they held is filled by the country's own rule.
export function neutralize(w, ch, fate = 'imprisoned', how) {
  if (fate === 'dead') return die(w, ch, how ?? 'was killed');
  const c = w.countries[ch.country], wasLeader = c?.alive && c.leader === ch.id;
  sideline(w, ch, fate);
  if (c?.alive) { if (wasLeader) succeed(w, c, ch); else replaceSlot(w, c, ch); }
}

// The one way out of the world, whatever the cause: the record is written, posts fall vacant, the seat is filled.
export function die(w, ch, how = 'died', { quiet = false, shock = 0 } = {}) {
  if (!ch?.alive) return;
  const c = w.countries[ch.country], wasLeader = c?.alive && c.leader === ch.id;
  ch.alive = false; ch.status = 'dead'; ch.death = { turn: w.turn, how }; delete ch.condition;
  stripPosts(w, ch); leavePlots(w, ch);
  if (!c?.alive) return;
  if (!quiet) news(w, `${c.name}: ${ch.name} ${how}, aged ${ch.age}.`, { kind: 'politics', countries: [c.id] });
  if (wasLeader) succeed(w, c, ch, shock); else replaceSlot(w, c, ch);
}

export function startCivilWar(w, c, leaderCh, label, seedProvinces = []) {
  const id = nextId(w, 'U');
  const f = makeCountry(w, id, {
    name: `${label} (${c.rootName || c.name})`, rootName: c.rootName || c.name, noSplitUntil: w.turn + 16, adj: '', ideology: leaderCh.role === 'general' ? 'Military revolution' : 'Opposition front', regime: 'Revolutionary council', motto: 'The order will fall.',
    colors: [mix(c.colors[0]), c.colors[1]], axes: { ...leaderCh.axes }, parent: c.id, majorityEth: c.majorityEth, majorityRel: c.majorityRel,
    tax: { ...c.tax }, tariff: c.tariff, budget: { ...c.budget, military: Math.max(c.budget.military, .09) }, armShare: .2, tech: { ...c.tech }, priceLevel: c.priceLevel, wageIndex: c.wageIndex, inflation: c.inflation,
    techs: { ...c.techs }, literacy: c.literacy, parties: c.parties.map(p => ({ ...p })), rulingParty: null,
    relations: { ...c.relations, [c.id]: -100 }, bureaucracy: c.bureaucracy * .6, police: c.police * .5, legitimacy: 45, capital: null
  });
  f.rate = c.rate; issueCurrency(f, 'floating'); w.countries[id] = f; c.relations[id] = -100;
  for (const o of aliveCountries(w)) if (o.id !== id && o.id !== c.id) o.relations[id] = o.relations[c.id] ?? 0;
  // Only land the government itself owns and holds can go over to the rebels, and never the capital. A regiment that rises abroad or in the capital marches out to join them.
  const provs = countryProvinces(w, c.id), open = new Set(provs.filter(p => p.owner === c.id && p.id !== c.capital).map(p => p.id));
  let take = [...new Set(seedProvinces)].filter(x => open.has(x));
  const units = Object.values(w.units).filter(u => u.country === c.id);
  const defecting = units.filter(u => u.loyalty < 52 || (leaderCh.role === 'general' && rand(w) < .35));
  if (!defecting.length && units.length > 1) defecting.push([...units].sort((a, b) => a.loyalty - b.loyalty)[0]);
  defecting.forEach(u => { u.country = id; u.loyalty = 75; u.target = null; u.commander = null; delete u.bond; if (open.has(u.province)) take.push(u.province); });
  const byUnrest = [...provs].filter(p => open.has(p.id)).sort((a, b) => b.unrest - a.unrest).map(p => p.id);
  const minimum = Math.max(1, Math.round(provs.length * .25));
  for (const x of byUnrest) if (take.length < minimum) take.push(x);
  take = [...new Set(take)];
  if (!take.length) take = byUnrest.slice(0, 1);
  take.forEach(x => { const p = w.provinces[x]; p.owner = id; p.controller = id; p.governor = null; });
  f.capital = take[0];
  for (const u of defecting) if (!take.includes(u.province)) u.province = f.capital;
  const share = take.length / Math.max(provs.length, 1);
  for (const g of Object.keys(c.stock)) { f.stock[g] = c.stock[g] * share; c.stock[g] *= 1 - share; }
  f.treasury = c.treasury * share * .4; c.treasury *= 1 - share * .6;
  f.reserves = c.reserves * share * .5; c.reserves *= 1 - share * .5;
  f.money = c.money * share; c.money *= 1 - share; f._lastMoney = f.money; c._lastMoney = c.money;
  // The debt goes with the land that was to pay it.
  f.debt = c.debt * share; c.debt *= 1 - share; c.gdp *= 1 - share; f.gdp = c.gdp * share / Math.max(1 - share, .1); f.realGdp = f.gdp / f.priceLevel; c.realGdp *= 1 - share;
  // Whoever leads the rising leaves everything held under the old government behind: posts, plots, a place in the succession, and a sentence of exile.
  stripPosts(w, leaderCh); leavePlots(w, leaderCh); leaderCh.status = 'free';
  leaderCh.country = id; if (c[leaderCh.role] === leaderCh.id) { const n = spawnCharacter(w, c.id, leaderCh.role, c.axes); c[leaderCh.role] = n.id; n.rise = `Took the place of ${leaderCh.name}, who rose against the government, in ${w.date ?? 'the first days'}.`; }
  leaderCh.role = 'leader'; leaderCh.loyalty = 100; f.leader = leaderCh.id; leaderCh.rise = `Raised the standard of revolt against ${c.name} in ${w.date ?? 'the first days'}.`;
  for (const r of ROLES) if (r !== 'leader') f[r] = spawnCharacter(w, id, r, f.axes).id;
  w.wars.push({ id: nextId(w, 'S'), a: [id], b: [c.id], civil: true, active: true, start: w.turn, name: `${c.name} Civil War` });
  c.noSplitUntil = w.turn + 10;
  c.legitimacy = clamp(c.legitimacy - 12, 0, 100);
  news(w, `${c.name} slid into civil war. Forces led by ${leaderCh.name} took control of ${take.length} provinces.`, { kind: 'disaster', countries: [c.id, id] });
  return f;
}
const mix = hex => { const n = parseInt(hex.slice(1), 16); const f = x => Math.min(255, Math.round(x * .62 + 90)); return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(f).map(x => x.toString(16).padStart(2, '0')).join(''); };

export function plotStep(w) {
  for (const pl of w.plots.filter(p => p.active)) {
    const c = w.countries[pl.country];
    const lead = w.characters[pl.leader];
    // A plot can be run from exile, not from a cell; and it dies with the person it was aimed at.
    if (!c?.alive || !lead?.alive || lead.status === 'imprisoned' || (pl.kind === 'assassination' && pl.target && !w.characters[pl.target]?.alive)) { pl.active = false; continue; }
    pl.progress = clamp(pl.progress + 9 + pl.members.length * 7, 0, 100);
    const leak = clamp(.03 + pl.members.length * .05 + (c.police + c.intelligence) / 100 * .1 - pl.secrecy * .12, .02, .75);
    if (!pl.exposed && rand(w) < leak) {
      pl.exposed = true;
      // The leak reaches whoever the plot is aimed at: the ruler, or the person marked for death.
      const victim = pl.kind === 'assassination' ? w.characters[pl.target] : null, warned = victim?.alive && victim.id !== c.leader ? victim : w.characters[c.leader];
      if (warned?.alive && warned.id !== lead.id) warned.inbox.push({ turn: w.turn, from: victim && warned.id === victim.id ? 'A warning' : 'Intelligence', text: victim && warned.id === victim.id ? `There is a plot against your life. The name behind it is said to be ${lead.name}.` : `Preparations for the ${pl.kind} plot have leaked. The suspected ringleader: ${lead.name}. Plot no: ${pl.id}.` });
      news(w, `In ${c.name}, preparations for a ${pl.kind} plot around ${lead.name} have leaked.`, { kind: 'plot', countries: [c.id], secret: true });
    }
  }
}

export function armySides(w, c, pl) {
  const inPlot = new Set([pl.leader, ...pl.members]);
  const generalIn = inPlot.has(c.general);
  let pro = 0, anti = 0;
  for (const u of Object.values(w.units)) {
    if (u.country !== c.id) continue;
    // Men follow the officer who commands them: a commander in the plot brings most of his unit with him, and one who stands by the government holds his together.
    const chief = w.characters[u.commander], led = chief?.alive && chief.status === 'free' && chief.country === c.id;
    const lean = (100 - u.loyalty) + (generalIn ? 22 : 0) + (led ? (inPlot.has(chief.id) ? 45 : chief.id !== c.general && (chief.loyalty ?? 50) >= 55 ? -15 : 0) : 0) - 40;
    if (lean > 0) pro += u.men * lean / 50; else anti += u.men * (-lean) / 50;
  }
  return { pro, anti };
}

export function executePlot(w, pl) {
  const c = w.countries[pl.country], lead = w.characters[pl.leader];
  if (!pl.active || !c?.alive || !lead?.alive) return 'The plot is no longer valid.';
  pl.active = false;
  const prep = .55 + pl.progress / 160, inPlot = [pl.leader, ...pl.members].map(x => w.characters[x]).filter(Boolean);
  const target = w.characters[c.leader];
  const surprise = pl.exposed ? .65 : 1.2;
  if (pl.kind === 'assassination') {
    // Anyone can be marked: a ruler, a rival, a prisoner, someone abroad. The guard around them, the preparation and luck decide.
    const victim = pl.target ? w.characters[pl.target] : target;
    if (!victim?.alive || victim.id === lead.id) return 'There is no one left to strike at.';
    const home = w.countries[victim.country]?.alive ? w.countries[victim.country] : c, head = home.leader === victim.id, abroad = home.id !== c.id;
    const guard = (head ? .05 + home.police / 300 : victim.status === 'imprisoned' ? -.1 : home.police / 600) + (abroad ? .1 : 0);
    const p = clamp(.18 + pl.progress / 220 - guard - (pl.exposed ? .2 : 0), .03, .8), roll = rand(w);
    const outcome = roll < p * .65 ? 'killed' : roll < p ? 'wounded' : 'missed';
    const traced = rand(w) < clamp((outcome === 'killed' ? .2 : .45) + home.police / 250 - pl.secrecy * .3, .05, .9);
    for (const x of inPlot) mark(w, x, `Took part in the attempt on the life of ${victim.name}.`);
    const hand = traced ? ` The trail led to ${lead.name}${abroad ? ` of ${c.name}` : ''}.` : ' Who sent the killer is not known.', seen = [home.id, ...(abroad && traced ? [c.id] : [])];
    // A plotter who is found out is seized before anyone can profit from the deed, unless the plotter is the state itself.
    const ruler = home.leader === lead.id;
    if (traced && !abroad && !ruler) sideline(w, lead, 'imprisoned');
    if (outcome === 'killed') {
      news(w, `${home.name}: ${victim.name} was killed by an assassin.${hand}`, { kind: 'plot', countries: seen });
      die(w, victim, 'was killed by an assassin', { quiet: true, shock: head ? 8 : 0 });
    } else {
      if (outcome === 'wounded') afflict(w, victim, 'wound', rand(w) < .4 ? 3 : 2, 'an assassin');
      news(w, `${home.name}: ${victim.name} ${outcome === 'wounded' ? 'was wounded in' : 'survived'} an attempt on their life.${hand}`, { kind: 'plot', countries: seen });
      if (head && outcome === 'missed') home.legitimacy = clamp(home.legitimacy + 3, 0, 100);
    }
    if (traced && !abroad && !ruler && lead.country === home.id) replaceSlot(w, home, lead);
    if (traced && ruler) { home.legitimacy = clamp(home.legitimacy - 7 * (.4 + home.pressFreedom / 100), 0, 100); home.mods.push({ key: 'unrest', delta: clamp(victim.power / 12, 1, 6), turns: 3, label: `The attempt on ${victim.name}` }); }
    if (traced && abroad) {
      home.relations[c.id] = clampRel((home.relations[c.id] ?? 0) - (c.leader === lead.id ? 60 : 25));
      const told = w.characters[home.leader];
      if (told?.alive) told.inbox.push({ turn: w.turn, from: 'Investigators', text: `The attempt on ${victim.name} was traced to ${lead.name} (${lead.id}) of ${c.name}.` });
    }
    return outcome === 'killed' ? `${victim.name} was killed.${hand}` : outcome === 'wounded' ? `${victim.name} was wounded but lives.${hand}` : `The attempt on ${victim.name} failed.${hand}`;
  }
  if (pl.kind === 'uprising') {
    if (!canSplit(w, c)) { neutralize(w, lead, 'imprisoned'); news(w, `In ${c.name}, an armed uprising was put down before it could take root.`, { kind: 'plot', countries: [c.id] }); return 'Not enough ground for an uprising.'; }
    const seeds = countryProvinces(w, c.id).filter(p => p.unrest > 30 && p.id !== c.capital).sort((a, b) => b.unrest - a.unrest).slice(0, 3).map(p => p.id);
    startCivilWar(w, c, lead, lead.role === 'general' ? 'Rebel Army' : 'People\'s Front', seeds);
    return 'The armed uprising has begun.';
  }
  // A coup is decided first by which way the army leans, whatever its size: the share of it that will march against the government, and the share that will stand.
  const { pro, anti } = armySides(w, c, pl), marching = pro + anti > 0 ? pro / (pro + anti) : .5, ARMY = 130;
  const blocs = Object.values(c.blocs), angry = sum(blocs, b => b.power * Math.max(0, 50 - b.sat) / 50), content = sum(blocs, b => b.power * Math.max(0, b.sat - 50) / 50);
  const att = (marching * ARMY + sum(inPlot, x => x.power) * .9 + (100 - c.legitimacy) * .4 + angry * .8) * prep * surprise * between(w, .75, 1.25);
  const def = ((1 - marching) * ARMY + target.power * .9 + c.police * .55 + c.legitimacy * .55 + content * .8) * between(w, .75, 1.25);
  const r = att / Math.max(def, 1);
  if (r > 1.12) {
    news(w, `Coup in ${c.name}: ${target.name} was overthrown and ${lead.name} took power.`, { kind: 'plot', countries: [c.id] });
    sideline(w, target, 'exiled');
    const military = ['general', 'officer'].includes(lead.role);
    installLeader(w, c, lead, military ? { regime: 'Military junta', elections: false, succession: 'army', pressFreedom: Math.min(c.pressFreedom, 25) } : { succession: c.elections ? c.succession : 'open' });
    // Soldiers who take the palace send the deputies home; the chamber sits again only when the junta recalls it.
    if (military && c.parliament) c.parliament.suspendedUntil = w.turn + 400;
    lead.rise = `Seized power in ${w.date ?? 'the first days'} by overthrowing ${target.name}.`;
    // Those who take the palace by force do not inherit what the old order stood on.
    c.legitimacy = clamp(c.legitimacy - 14, 0, 100); c.legitBase = Math.min(c.legitBase ?? 0, 0);
    return 'The coup succeeded.';
  }
  if (r > .92 && canSplit(w, c)) {
    startCivilWar(w, c, lead, 'Coup Forces');
    return 'The coup stalled and the army split.';
  }
  news(w, `Coup attempt in ${c.name} put down. ${lead.name} and supporters were arrested.`, { kind: 'plot', countries: [c.id] });
  // Those within reach are arrested; a plotter abroad stays abroad.
  inPlot.filter(x => x.alive && x.status === 'free' && x.id !== c.leader).forEach(x => neutralize(w, x, 'imprisoned'));
  c.legitimacy = clamp(c.legitimacy + 4, 0, 100);
  Object.values(w.units).filter(u => u.country === c.id).forEach(u => u.loyalty = clamp(u.loyalty - 4, 0, 100));
  return 'The coup failed.';
}

export function uprisingStep(w) {
  for (const c of aliveCountries(w)) {
    const provs = countryProvinces(w, c.id), people = sum(provs, provincePop) || 1, hot = provs.filter(p => p.unrest > 62);
    for (const p of hot) if (rand(w) < .3) {
      // Under occupation, a rising throws the occupier out of a province he holds with no garrison, or with a handful of men among a whole people.
      const owner = w.countries[p.owner];
      if (p.controller !== p.owner && owner?.alive && garrisonHold(sum(Object.values(w.units).filter(u => u.province === p.id && u.country === c.id), u => u.men), provincePop(p)) < 1) {
        p.controller = p.owner; p.unrest = clamp(p.unrest - 25, 0, 100);
        news(w, `${p.name} rose against ${c.name} and went back to ${owner.name}.`, { kind: 'war', countries: [c.id, owner.id], province: p.id });
        continue;
      }
      p.devastation = clamp(p.devastation + .06, 0, 1);
      for (const k of CLASSES) p.pops[k].n *= .996;
      // A rising that has been fought out leaves the province spent for a while, whatever it still feels.
      p.unrest = clamp(p.unrest - 14, 0, 100);
      news(w, `${p.name}: mass uprising, fighting in the streets.`, { kind: 'disaster', countries: [c.id], hush: true, province: p.id });
      // A rising in a remote valley shakes the government less than one in a great city.
      c.legitimacy = clamp(c.legitimacy - clamp(provincePop(p) / people * 20, .3, 2.5), 0, 100);
    }
    const total = provs.length;
    if (canSplit(w, c) && hot.length >= Math.ceil(total * .5) && rand(w) < .14) {
      const oppId = c.opposition, opp = w.characters[oppId];
      const minority = sum(hot, p => minorityShare(p, c)) > hot.length / 2;
      // A country in revolt finds a leader: the opposition's if they are free to lead it, otherwise someone no one had heard of.
      const head = opp?.alive && opp.status === 'free' && !incapacitated(opp) ? opp : spawnCharacter(w, c.id, 'rebel', c.axes, { power: 45 });
      startCivilWar(w, c, head, minority ? 'Separatists' : 'People\'s Front', hot.filter(p => p.id !== c.capital).map(p => p.id));
    }
  }
}

export function partyStep(w) {
  for (const c of aliveCountries(w)) {
    const scores = c.parties.filter(p => !p.banned).map(p => {
      let s = 0, n = 0;
      for (const pr of homeProvinces(w, c)) for (const k of CLASSES) {
        const fit = Math.max(4, 100 - distance(p.axes, CLASS_AXES[k]) * 1.1) * (p.base === k ? 1.6 : 1);
        const grievance = p.id === c.rulingParty ? pr.pops[k].sat / 50 : (100 - pr.pops[k].sat + 25) / 75;
        s += pr.pops[k].n * fit * grievance; n += pr.pops[k].n;
      }
      return [p, s / Math.max(n, 1) * (1 + (p.organization || 0) / 100)];
    });
    const tot = sum(scores, x => x[1]) || 1;
    for (const [p, v] of scores) p.support = p.support + (v / tot * 100 - p.support) * .3;
    for (const p of c.parties.filter(x => x.banned)) p.support *= .8;
    if (!c.rulingParty || !c.parties.some(p => p.id === c.rulingParty)) c.rulingParty = [...c.parties].sort((a, b) => distance(a.axes, c.axes) - distance(b.axes, c.axes))[0]?.id ?? null;
  }
}

export function electionStep(w) {
  for (const c of aliveCountries(w)) {
    if (!c.elections || w.turn < c.nextElection) continue;
    c.nextElection = w.turn + 16;
    const inc = w.characters[c.leader], opp = w.characters[c.opposition];
    // A vote counts for as much as it was free: a gagged press, a banned party, stuffed boxes or a rival in a cell all take from it. Calling one every season adds nothing.
    const fairness = c.pressFreedom / 100 * (c.parties.some(p => p.banned) ? .6 : 1) * (c.rigging > 0 ? .5 : 1) * (w.turn - (c.rivalJailed ?? -99) < 16 ? .5 : 1), due = w.turn - (c.lastElection ?? -99) >= 8 ? 1 : 0;
    c.lastElection = w.turn;
    const rulingSupport = c.parties.find(p => p.id === c.rulingParty)?.support ?? 30;
    const rival = Math.max(1, ...c.parties.filter(p => p.id !== c.rulingParty && !p.banned).map(p => p.support));
    const share = clamp(rulingSupport / (rulingSupport + rival) * 100 + (1 - fairness) * 12 + c.rigging + between(w, -4, 4), 2, 98);
    c.rigging = 0;
    if (c.parliament) c.parliament.seats = allocateSeats(c);
    if (share >= 50 || !opp?.alive || opp.status !== 'free') {
      news(w, `${c.name} election: ${inc.name} stayed in office with ${Math.round(share)}% of the vote.`, { kind: 'politics', countries: [c.id] });
      c.legitimacy = clamp(c.legitimacy + 6 * fairness * due, 0, 100);
    } else {
      news(w, `${c.name} election: ${opp.name} won; ${inc.name} lost power (${Math.round(100 - share)}%).`, { kind: 'politics', countries: [c.id] });
      const prev = inc.id;
      // The two change places: the winner governs, the loser leads the opposition. No one else appears.
      installLeader(w, c, opp, null, true);
      const ex = w.characters[prev]; ex.role = 'opposition'; ex.loyalty = 40;
      c.opposition = prev; c.legitimacy = clamp(c.legitimacy + 10 * fairness * due, 0, 100);
      opp.rise = `Won the election of ${w.date ?? 'the first days'} against ${ex.name}.`;
      c.rulingParty = [...c.parties].filter(p => !p.banned && p.id !== c.rulingParty).sort((a, b) => b.support - a.support)[0]?.id ?? c.rulingParty;
      // The state's course moves toward the programme of the party that won, not to any one person's private leanings.
      const platform = c.parties.find(p => p.id === c.rulingParty)?.axes;
      if (platform) for (const a of ['econ', 'auth', 'nation', 'faith']) c.axes[a] = Math.round(c.axes[a] + (platform[a] - c.axes[a]) * .6);
    }
  }
}

export function lifeStep(w) {
  // Most deaths come through illness, which everyone can watch coming.
  healthStep(w, die);
  // While a ruler lies too ill to govern, someone governs in their name: the named successor, or failing one, whoever stands closest to the seat.
  for (const c of aliveCountries(w)) {
    const ruler = w.characters[c.leader], was = c.regent ?? null;
    if (!incapacitated(ruler)) { c.regent = null; continue; }
    const fit = id => { const x = w.characters[id]; return x?.alive && x.status === 'free' && x.country === c.id && !incapacitated(x) ? x : null; }, rule = successionRule(c);
    const next = fit(c.heir) ?? (rule === 'council' ? fit(c.oligarch) : rule === 'army' ? fit(c.general) : null) ?? [c.general, c.oligarch].map(fit).filter(Boolean).sort((a, b) => b.power - a.power)[0] ?? null;
    c.regent = next?.id ?? null;
    if (next && next.id !== was) { news(w, `${c.name}: ${next.name} governs in the name of ${ruler.name}, who is too ill to rule.`, { kind: 'politics', countries: [c.id] }); next.inbox.push({ turn: w.turn, from: 'The palace', text: `${ruler.name} is too ill to govern. Until they recover or die, you govern in their name, with their powers.` }); }
  }
  if (w.turn % 4 !== 3) return;
  for (const ch of Object.values(w.characters)) {
    if (!ch.alive) continue;
    ch.age = (ch.age ?? 50) + 1;
    // The rest is the stroke, the fall, the heart that stops without warning.
    if (rand(w) < clamp(Math.pow(Math.max(0, ch.age - 45) / 45, 3) * .1, .001, .25)) die(w, ch, 'died suddenly');
  }
}

// Code only carries out the fact: when a debt falls due both parties learn of it, what follows is their decision.
export function debtStep(w) {
  for (const d of w.debts ||= []) {
    if (!['open', 'overdue'].includes(d.status)) continue;
    const debtor = w.characters[d.debtor], creditor = w.characters[d.creditor];
    if (!debtor?.alive || !creditor?.alive) { d.status = 'void'; d.closedAt = w.turn; continue; }
    if (d.status === 'open' && w.turn >= d.due) {
      d.status = 'overdue';
      debtor.inbox.push({ turn: w.turn, from: 'Notary', text: `Debt ${d.id}: your payment of ${Math.round(d.owed)} to ${creditor.name} has fallen due.` });
      creditor.inbox.push({ turn: w.turn, from: 'Notary', text: `Debt ${d.id}: ${debtor.name} did not pay the ${Math.round(d.owed)} owed to you on time.` });
    }
  }
}

export function pruneStep(w) {
  const keep = w.turn - 40;
  w.debts = (w.debts || []).filter(d => ['open', 'overdue'].includes(d.status) || d.closedAt >= keep);
  for (const [id, ch] of Object.entries(w.characters)) if (!ch.alive) { ch.goneAt ??= w.turn; if (ch.goneAt < keep) delete w.characters[id]; }
  w.plots = w.plots.filter(p => p.active || p.start >= keep);
  w.treaties = w.treaties.filter(t => t.active || t.turn >= keep);
  w.wars = w.wars.filter(x => x.active || x.start >= keep);
  for (const t of w.treaties) if (t.pending && w.turn - t.turn > 8) t.pending = false;
}

export function collapseStep(w) {
  for (const c of aliveCountries(w)) {
    if (countryProvinces(w, c.id).length) continue;
    c.alive = false;
    // Whoever holds most of what was theirs is the victor.
    const held = {}; for (const p of Object.values(w.provinces)) if (p.owner === c.id) held[p.controller] = (held[p.controller] || 0) + 1;
    const victor = w.countries[Object.entries(held).sort((a, b) => b[1] - a[1])[0]?.[0]], winner = victor?.alive && victor.id !== c.id ? victor : null;
    news(w, `${c.name} has passed into history: its last territory has fallen.`, { kind: 'disaster', countries: [c.id, ...(winner ? [winner.id] : [])] });
    for (const u of Object.values(w.units)) if (u.country === c.id) delete w.units[u.id];
    for (const f of Object.values(w.fleets)) if (f.country === c.id) delete w.fleets[f.id];
    // Its people do not vanish with the state. The ruler and the chief of staff fall into the victor's hands; the rest live on under new masters as private persons.
    for (const ch of Object.values(w.characters)) {
      if (ch.country !== c.id || !ch.alive) continue;
      const taken = [c.leader, c.general].includes(ch.id) && ch.status === 'free';
      stripPosts(w, ch); leavePlots(w, ch);
      if (!winner) { ch.alive = false; ch.status = 'exiled'; continue; }
      if (ch.role === 'leader') ch.role = 'former_leader';
      ch.country = winner.id; ch.outSince = w.turn;
      if (taken) {
        ch.status = 'imprisoned'; ch.heldSince = w.turn; ch.power = Math.round(ch.power * .6);
        news(w, `${ch.name} of the fallen ${c.name} was taken prisoner by ${winner.name}.`, { kind: 'war', countries: [winner.id, c.id] });
        w.characters[winner.leader]?.inbox.push({ turn: w.turn, from: 'The army', text: `${ch.name} (${ch.id}), who governed ${c.name}, is your prisoner. What becomes of them is yours to decide.` });
      }
    }
    for (const p of Object.values(w.provinces)) if (p.owner === c.id) p.owner = p.controller;
    for (const o of aliveCountries(w)) delete o.creditors[c.id];
    // A rising that wins the whole country is no longer a rising: it governs under the country's own name.
    if (winner?.parent === c.id) { winner.name = c.name; winner.rootName = c.rootName ?? winner.rootName; winner.parent = null; if (w.provinces[c.capital]?.controller === winner.id) winner.capital = c.capital; news(w, `The victors of the civil war now govern as ${winner.name}.`, { kind: 'politics', countries: [winner.id] }); }
  }
  for (const war of w.wars) if (war.active) {
    war.a = war.a.filter(x => w.countries[x]?.alive); war.b = war.b.filter(x => w.countries[x]?.alive);
    if (!war.a.length || !war.b.length) { war.active = false; news(w, `${war.name} is over.`, { kind: 'war', countries: [...war.a, ...war.b] }); }
  }
  for (const t of w.treaties) if (t.active && t.parties.some(x => !w.countries[x]?.alive)) t.active = false;
}

export function relationDrift(w) {
  for (const c of aliveCountries(w)) for (const o of Object.keys(c.relations)) {
    if (!w.countries[o]?.alive) continue;
    if (atWar(w, c.id, o)) c.relations[o] = clampRel(c.relations[o] - 2);
    else c.relations[o] = clampRel(c.relations[o] * .985);
  }
}
