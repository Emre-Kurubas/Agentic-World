// The frontier, and the reserve.
// Armies that face each other across a border now and then shoot at each other, and a people watches how its kin are treated on the other side.
// Both leave a grievance at home that weighs on whoever governs until it is answered or forgotten. A state also has men who have served and
// gone home: calling them back is quick, large, costly to the fields and the works, and seen by every neighbour.
import { clamp, rand, news, sum } from './util.js';
import { aliveCountries, countryProvinces, atWar, hasTreaty, provincePop, makeUnit } from './world.js';
import { groupsOf } from './culture.js';
import { fighting } from './military.js';
import { answered, tieOf } from './diplomacy.js';

const say = (w, ch, from, text) => { if (ch?.alive) ch.inbox.push({ turn: w.turn, from, text }); };
const menAt = (w, cid, pid) => sum(Object.values(w.units).filter(u => u.country === cid && u.province === pid), u => u.men);
// Troops told to hold their fire, by an order to the unit or by a standing order for everything that faces that neighbour.
// Trained men at home for every man under arms, where a state has been left to itself.
export const RESERVE = 1.5;
// How long men serve with the colours is the government's to say (set_service; three years where nothing else was ever decided). Short service
// sends more trained men home every year, so the reserve settles larger, and leaves those under arms rawer; long service does the reverse.
export const serviceOf = c => clamp(c.term ?? 3, 1, 12);
export const reserveAt = years => RESERVE * 3 / clamp(years, 1, 12);
export const drillOf = c => clamp(.82 + serviceOf(c) * .06, .85, 1.12);
export const holdsFire = (c, u, toward) => !!(u.holdFire || c.holdFire?.[toward]);
const heldAt = (w, c, pid, toward) => sum(Object.values(w.units).filter(u => u.country === c.id && u.province === pid && holdsFire(c, u, toward)), u => u.men);
const grudge = (c, id) => (c.grudges ||= {})[id] ||= { incident: 0, kin: 0 };
export const grudgeWord = v => v >= 30 ? 'a fury' : v >= 15 ? 'strong' : v >= 6 ? 'felt' : 'faint';

// How hard a state bears on the people of another nation who live under it.
const yoke = c => c.languagePolicy === 'assimilate' ? 1 : c.languagePolicy === 'autonomy' ? 0 : .35;

export function frontierStep(w) {
  const cs = aliveCountries(w);
  for (const c of cs) for (const g of Object.values(c.grudges ||= {})) g.incident *= .85;
  // Where two armies stand in touching provinces, patrols meet.
  const facing = {};
  for (const c of cs) for (const p of countryProvinces(w, c.id)) {
    const here = menAt(w, c.id, p.id); if (here < .5) continue;
    // Armies that are fighting each other meet in battle, not in incidents; armies that face each other across an armistice line still do.
    for (const n of p.neighbors) { const q = w.provinces[n], o = w.countries[q.controller]; if (!o?.alive || o.id === c.id || fighting(w, c.id, o.id)) continue; const there = menAt(w, o.id, q.id); if (there < .5) continue;
      const key = c.id < o.id ? `${c.id}|${o.id}` : `${o.id}|${c.id}`, f = facing[key] ||= { a: c.id < o.id ? c : o, b: c.id < o.id ? o : c, men: {}, at: [p, q], all: {}, quiet: {} }; f.men[c.id] = Math.max(f.men[c.id] || 0, here); f.men[o.id] = Math.max(f.men[o.id] || 0, there);
      f.all[c.id] = (f.all[c.id] || 0) + here; f.quiet[c.id] = (f.quiet[c.id] || 0) + heldAt(w, c, p.id, o.id); }
  }
  for (const f of Object.values(facing)) {
    const { a, b } = f, force = Math.min(1, Math.sqrt(f.men[a.id] * f.men[b.id]) / 60), bad = Math.min(a.relations[b.id] ?? 0, b.relations[a.id] ?? 0);
    const pact = (hasTreaty(w, a.id, b.id, 'alliance') ? .05 : hasTreaty(w, a.id, b.id, 'nonaggression') ? .3 : 1) * (tieOf(w, a.id, b.id) === 'broken' ? 1.3 : 1), heat = grudge(a, b.id).incident + grudge(b, a.id).incident + grudge(a, b.id).kin + grudge(b, a.id).kin;
    // Someone has to fire first. Each side's patrols are half the danger; a side whose men are under orders not to fire first is all but out of
    // it (not quite: orders are not always obeyed, and a patrol fired on shoots back). Across an armistice line both sides are wary.
    const still = id => (f.quiet[id] || 0) / Math.max(f.all[id] || 0, 1e-9), calm = .5 * (1 - .85 * still(a.id)) + .5 * (1 - .85 * still(b.id)), truce = atWar(w, a.id, b.id);
    if (rand(w) >= clamp(.012 * (.3 + force) * (bad < -30 ? 2 : bad < 0 ? 1.3 : 1) * pact * (1 + heat / 60) * calm * (truce ? .5 : 1), 0, .25)) continue;
    const [p, q] = f.at, pa = p.controller === a.id ? p : q, pb = pa === p ? q : p, deadA = Math.round(2 + rand(w) * 30), deadB = Math.round(2 + rand(w) * 30);
    for (const [c, d, prov] of [[a, deadA, pa], [b, deadB, pb]]) { const u = Object.values(w.units).find(x => x.country === c.id && x.province === prov.id); if (u) u.men = Math.max(.05, u.men - d / 1000); }
    grudge(a, b.id).incident += 10 + deadA * .3; grudge(b, a.id).incident += 10 + deadB * .3;
    a.relations[b.id] = clamp((a.relations[b.id] ?? 0) - 8, -100, 100); b.relations[a.id] = clamp((b.relations[a.id] ?? 0) - 8, -100, 100);
    // Men who were shot at while forbidden to shoot first take it hard.
    for (const [c, prov] of [[a, pa], [b, pb]]) if (still(c.id) > .5) for (const u of Object.values(w.units)) if (u.country === c.id && u.province === prov.id) u.morale = clamp(u.morale - 3, 0, 100);
    news(w, `Shots ${truce ? 'across the armistice line' : 'on the frontier'} between ${a.name} and ${b.name}: patrols clashed between ${pa.name} and ${pb.name}. ${deadA} of ${a.name}'s soldiers and ${deadB} of ${b.name}'s were killed. Each side says the other fired first.`, { kind: 'war', countries: [a.id, b.id], province: pa.id });
    for (const [c, o, mine, theirs, prov] of [[a, b, deadA, deadB, pa], [b, a, deadB, deadA, pb]]) for (const ch of [w.characters[c.leader], w.characters[c.general]]) if (ch?.alive) say(w, ch, 'General Staff', `A patrol clash on the frontier with ${o.name} near ${prov.name}: ${mine} of ours dead, about ${theirs} of theirs. Our officers say theirs fired first; theirs say the same of ours. The country has heard of it and expects an answer. ${still(c.id) > .5 ? 'Our men there were under orders not to fire first, which makes such meetings rare, not impossible.' : 'Troops kept in the border provinces keep meeting theirs; troops held a province back do not, and troops ordered to hold their fire (set_posture) seldom do.'}`);
  }
  // A people watches how its kin fare across the border, and how hard the state they live under bears on them.
  for (const c of cs) {
    for (const o of cs) { if (o.id === c.id) continue; const g = grudge(c, o.id); let v = 0;
      for (const p of countryProvinces(w, o.id)) { const share = sum(groupsOf(p).filter(x => x.eth === c.majorityEth), x => x.share); if (o.majorityEth === c.majorityEth || share < .2) continue; v += share * (yoke(o) * (.5 + p.unrest / 100) + (p.scar?.by === o.id ? p.scar.weight * 3 * Math.max(0, 1 - (w.turn - p.scar.turn) / 40) : 0)); }
      g.kinBase ??= clamp(v * 10, 0, 40); if (g.kin === 0 && g.kinBase > 0 && !g.seeded) { g.kin = g.kinBase; g.seeded = true; } g.kin += (clamp(v * 10, 0, 40) - g.kin) * .25; }
    // What weighs on the government: wrongs that have not been answered. A war against the offender answers them.
    const nat = clamp(.6 + (c.axes?.nation ?? 0) / 100, .3, 1.4);
    // What a country inherited it is used to: only what has grown worse since weighs on the government of the day.
    // What the government has done about it short of war (an envoy recalled, relations broken, a duty or a ban aimed at them, an ultimatum) answers part of it.
    const felt = sum(Object.entries(c.grudges), ([id, g]) => !w.countries[id]?.alive || atWar(w, c.id, id) ? 0 : (g.incident * .12 + g.kin * .25 * nat) * (1 - answered(w, c, id))), old = sum(Object.entries(c.grudges), ([id, g]) => !w.countries[id]?.alive || atWar(w, c.id, id) ? 0 : (g.kinBase ?? 0) * .25 * nat);
    c.grief = clamp(felt - old, 0, 12);
    // A reserve of trained men: each year some of the standing army goes home with its training, and the oldest reservists pass out of reach.
    // Short service fills it: a country keeps about one and a half times its standing army in men who have served and can be called.
    const army = sum(Object.values(w.units).filter(u => u.country === c.id && !u.called), u => u.men);
    c.reserve = Math.max(0, (c.reserve ?? army * reserveAt(serviceOf(c))) * .97 + army * reserveAt(serviceOf(c)) * .03);
  }
}

// Calling up the reserve. Men leave the fields and the works for the depots within the quarter; rifles come out of the arsenal; everyone sees it.
export function mobilize(w, c, share, pay, fail) {
  const want = Math.max(0, (c.reserve || 0) * clamp(share, .05, 1)); if (want < 1) return fail('There is no reserve worth calling up.');
  const provs = countryProvinces(w, c.id).filter(p => p.owner === c.id), hands = sum(provs, p => p.pops.peasants.n + p.pops.workers.n), men = Math.min(want, Math.max(0, hands * .12));
  const arms = Math.min(men * .05, Math.max(0, c.stock.arms || 0)), armed = arms / .05; if (armed < 1) return fail('The arsenals hold no rifles for the men who would be called.');
  const called = Math.round(Math.min(men, armed) * 10) / 10, note = pay(c, called * .15 * c.priceLevel); if (note === null) return fail('The treasury is empty and lenders will not cover it.');
  c.stock.arms -= called * .05; c.reserve -= called;
  for (const p of provs) for (const k of ['peasants', 'workers']) p.pops[k].n = Math.max(1, p.pops[k].n - called * p.pops[k].n / Math.max(hands, 1e-9));
  // They form at the capital and the largest towns.
  const depots = [w.provinces[c.capital], ...provs.filter(p => p.id !== c.capital).sort((x, y) => provincePop(y) - provincePop(x))].filter(Boolean).slice(0, 3), each = called / depots.length;
  for (const p of depots) { const u = makeUnit(w, c.id, p.id, each, .9, 55 + c.legitimacy * .3, 'infantry'); u.called = true; u.morale = 60; }
  news(w, `${c.name} has ordered mobilisation: about ${Math.round(called)} thousand reservists are joining the colours.`, { kind: 'war', countries: [c.id] });
  for (const o of aliveCountries(w)) { if (o.id === c.id) continue; const near = countryProvinces(w, o.id).some(p => p.neighbors.some(n => w.provinces[n].controller === c.id)); if (!near) continue;
    o.relations[c.id] = clamp((o.relations[c.id] ?? 0) - 10, -100, 100);
    for (const ch of [w.characters[o.leader], w.characters[o.general]]) if (ch?.alive) say(w, ch, 'General Staff', `${c.name} is mobilising: about ${Math.round(called)} thousand reservists called to the colours, on top of the standing army. They will be under arms within the quarter. Whether it is meant for us is not known.`); }
  return { ok: true, msg: `About ${called} thousand reservists are called up and form at ${depots.map(p => p.name).join(', ')}; ${Math.round(c.reserve)} thousand remain in the reserve. They left fields and works to come, they must be paid like the rest of the army, and every neighbour knows.${note}` };
}
// Sending the reservists home again.
export function demobilize(w, c) {
  const us = Object.values(w.units).filter(u => u.country === c.id && u.called); if (!us.length) return null;
  const men = sum(us, u => u.men), provs = countryProvinces(w, c.id).filter(p => p.owner === c.id), pop = sum(provs, provincePop) || 1;
  for (const u of us) { c.stock.arms = (c.stock.arms || 0) + u.men * .05 * clamp(u.equip ?? .8, 0, 1); delete w.units[u.id]; }
  for (const p of provs) p.pops.workers.n += men * provincePop(p) / pop; c.reserve = (c.reserve || 0) + men;
  news(w, `${c.name} has stood its reservists down: about ${Math.round(men)} thousand men are going home.`, { kind: 'war', countries: [c.id] });
  return { ok: true, msg: `About ${Math.round(men * 10) / 10} thousand reservists went home and their rifles are back in the arsenal.` };
}
