// What a war costs beyond the pay of the men who fight it, at home and in the world, and what everybody can know of it.
//
// World 15 (eight states, nine wars in three years): the states that fought grew faster than the one that never did, world output rose by a sixth,
// the price of arms on the exchanges fell, no freight was dearer for it, and a declaration of war cost nothing with the houses that lend to
// governments. War was a line in the budget. Here it is what it was to the age: lenders mark a belligerent's paper down and money leaves for a
// quiet country; an army in the field eats, wears out and burns several times what the same men took at home, and takes it before the towns do;
// insurers and carriers ask more for a cargo to or from a state at war, so its customers buy elsewhere when they can; and when the price of iron
// rises because the country that ships a third of it is fighting, the exchanges say so, in print, for every government to read.
import { aliveCountries, hasTreaty, GOODS, GOOD_LABEL } from './world.js';
import { clamp, sum, news } from './util.js';

const foesOf = (w, id) => [...new Set(w.wars.filter(x => x.active && !x.civil && (x.a.includes(id) || x.b.includes(id))).flatMap(x => x.a.includes(id) ? x.b : x.a))].filter(o => w.countries[o]?.alive && !hasTreaty(w, id, o, 'armistice'));
// What the country keeps under arms, and whether it is in the field: every unit of a state at war counts as in the field.
export const menOf = (w, id) => sum(Object.values(w.units).filter(u => u.country === id), u => u.men);

// A soldier is fed and clothed by the state whether he fights or not: in barracks about what he took as a civilian, in the field about three times
// the bread (rations, and fodder for the horses that pull everything) and six times the boots, cloth, harness and wagons, besides coal for the
// railways that carry him and steel for rails, wire and tools. Per thousand men a quarter.
export const KIT = { peace: { grain: .01, goods: .004 }, field: { grain: .03, goods: .024, coal: .006, steel: .002 } };
export const kitOf = (w, c) => { const men = menOf(w, c.id), per = c.war?.on ? KIT.field : KIT.peace; return Object.fromEntries(Object.entries(per).map(([g, q]) => [g, men * q])); };

// How a state stands with its lenders and its merchants while it is at war, settled once a quarter before anything is bought, lent or shipped:
// since when, whether it began it, whether the enemy holds more of its land than it holds of his, what lenders add to its interest for it and how
// much less they will carry. The premium outlasts the peace by a few quarters, fading; the first months of a war frighten money most.
export function warFooting(w) {
  for (const c of aliveCountries(w)) {
    const foes = foesOf(w, c.id), was = c.war;
    if (!foes.length) { if (was?.on) c.war = { on: false, ended: w.turn, premium: was.premium * .6, squeeze: 1 }; else if (was) { was.premium *= .6; if (was.premium < .0004) delete c.war; } continue; }
    const provs = Object.values(w.provinces), lost = provs.filter(p => p.owner === c.id && foes.includes(p.controller)).length, taken = provs.filter(p => foes.includes(p.owner) && p.controller === c.id).length;
    // A war found already running (a save from before lenders priced wars) is dated from the day it began, and frightens no money a second time.
    const mine = w.wars.filter(x => x.active && !x.civil && (x.a.includes(c.id) || x.b.includes(c.id))), started = Math.min(w.turn, ...mine.map(x => x.start ?? w.turn));
    const struck = mine.some(x => x.a[0] === c.id), since = was?.on ? was.since : started, quarters = w.turn - since, losing = lost > taken;
    c.war = { on: true, since, quarters, begun: !was?.on && w.turn - started <= 1, struck, losing, foes, premium: .003 + .0005 * clamp(quarters - 2, 0, 8) + (struck ? .0015 : 0) + (losing ? .003 : 0), squeeze: 1 - (.2 + (losing ? .15 : 0)) };
  }
}
// What insurers and carriers add to a cargo for each end of the voyage that is a state at war: more by sea than over a land frontier.
export const WAR_RISK = { land: .03, sea: .08 };
export const warEnds = (a, b) => [a, b].filter(x => x.war?.on);

const part = s => s >= .6 ? 'most' : s >= .42 ? 'about half' : s >= .28 ? 'about a third' : s >= .18 ? 'about a fifth' : 'about a seventh';
// Why a price stands where it does, as the exchanges explain it: read from who sold what last year and what the armies took. Kept on the world
// (w.market) for every report that speaks of prices, and printed when a rise of a tenth in a year has a war behind it.
export function marketStep(w, cs) {
  const m = w.market ||= { share: {}, notes: {}, said: {} }; m.kit = {}; m.need = {};
  for (const g of GOODS) {
    const sold = sum(cs, c => c.lastSold?.[g] || 0), sh = m.share[g] ||= {};
    for (const c of cs) sh[c.id] = (sh[c.id] ?? (sold > 0 ? (c.lastSold?.[g] || 0) / sold : 0)) * .6 + (sold > 0 ? (c.lastSold?.[g] || 0) / sold : sh[c.id] ?? 0) * .4;
    m.kit[g] = sum(cs.filter(c => c.war?.on), c => c._kit?.[g] || 0); m.need[g] = sum(cs, c => c._need?.[g] || 0);
    const h = w.priceHistory, now = h.at(-1)?.[g], ago = h.at(-5)?.[g]; delete m.notes[g]; if (!(now > 0 && ago > 0)) continue;
    const rise = now / ago - 1, why = [];
    for (const c of cs) if (c.war?.on && (sh[c.id] || 0) >= .14) why.push(`${c.name}, which sells ${part(sh[c.id])} of the ${GOOD_LABEL[g]} the world buys, is at war and its cargoes pay a war premium`);
    if (m.need[g] > 0 && m.kit[g] / m.need[g] >= .02) why.push(`the armies in the field are taking about ${Math.round(m.kit[g] / m.need[g] * 100)} in the hundred of all the ${GOOD_LABEL[g]} the world uses`);
    if (rise < .05 || !why.length) continue;
    m.notes[g] = { rise, why, turn: w.turn };
    if (rise >= .1 && w.turn - (m.said[g] ?? -99) >= 4) { m.said[g] = w.turn; news(w, `On the exchanges ${GOOD_LABEL[g]} stands ${Math.round(rise * 100)} in the hundred above a year ago. The trade's own account of it: ${why.join('; ')}.`, { kind: 'economy' }); }
  }
  // What the wars cost a country in the things it buys abroad: the quantity it bought, at the difference a year has made to prices that a war explains.
  for (const c of cs) { let bill = 0; const of = []; for (const [g, n] of Object.entries(m.notes)) { const q = c.lastBought?.[g] || 0, h = w.priceHistory; if (q <= 0) continue; const d = (h.at(-1)[g] - h.at(-5)[g]) * q * (c.rate || 1); if (d > 0) { bill += d; of.push(g); } } c._warBill = bill > .5 ? { gold: bill, goods: of } : null; }
}
// The exchanges' account of one good, for whoever reads prices: nothing where no war explains it.
export const whyPrice = (w, g) => { const n = w.market?.notes?.[g]; return n ? `${GOOD_LABEL[g]} is ${Math.round(n.rise * 100)} in the hundred dearer than a year ago: ${n.why.join('; ')}` : ''; };
// What lenders have done to a state at war, in words, from the same figures they use.
export function lendersWords(c) {
  const x = c.war; if (!x || !(x.premium > 0)) return '';
  const pts = Math.round(x.premium * 4 * 1000) / 10;
  return x.on ? `The country is at war, and the houses that lend to governments price it: they ask about ${pts} points a year more of us than they would in peace${x.struck ? ', the more because we began it' : ''}${x.losing ? ', and more again while the enemy holds more of our land than we hold of his' : ''}, and they will carry about ${Math.round((1 - x.squeeze) * 100)} in the hundred less of our debt; the premium grows with every quarter the war lasts past the second, and fades over a year or so once peace is signed.`
    : `The war is over, and lenders still ask about ${pts} points a year more of us than they did before it; that fades over the next quarters.`;
}
