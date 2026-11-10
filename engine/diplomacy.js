// Between states: a word that is worth something or is not, demands with a date on them, guarantees, and what becomes of people who flee.
// A state's honour is what others have seen it do with its promises. An ultimatum that is not acted on is a bluff called; a guarantee
// that is not kept is remembered; an exile lives somewhere, and whoever shelters him holds a card.
import { clamp, news, sum } from './util.js';
import { aliveCountries, hasTreaty, atWar } from './world.js';

const say = (w, ch, from, text) => { if (ch?.alive) ch.inbox.push({ turn: w.turn, from, text }); };
export const honourOf = c => c.honour ?? 60;
export const honourWord = v => v >= 75 ? 'its word is trusted' : v >= 50 ? 'its word is taken with care' : v >= 30 ? 'its word is doubted' : 'its word is worth nothing';
// One place where a state's standing with others changes, so that every such change leaves a line the country can read.
export function shame(w, c, by, why) {
  c.honour = clamp(honourOf(c) + by, 0, 100); (c.honourLog ||= []).push({ turn: w.turn, by, why }); c.honourLog = c.honourLog.slice(-8);
}
const sideOf = (war, id) => war.a.includes(id) ? 'a' : war.b.includes(id) ? 'b' : null;

export function diplomacyStep(w) {
  const cs = aliveCountries(w);
  for (const c of cs) {
    // A good name comes back slowly, by years in which nothing is broken.
    if (honourOf(c) < 70 && w.turn - (c.honourLog?.at(-1)?.turn ?? -99) >= 4) c.honour = Math.min(70, honourOf(c) + .5);
    // A threat with a date on it and nothing behind it.
    for (const [id, until] of Object.entries(c.casus || {})) { if (w.turn <= until) continue; delete c.casus[id]; const o = w.countries[id]; if (!o?.alive || atWar(w, c.id, id)) continue; shame(w, c, -6, `its ultimatum to ${o.name} came to nothing`); c.legitimacy = clamp(c.legitimacy - 3, 0, 100); news(w, `${c.name}'s ultimatum to ${o.name} has run out and nothing has followed.`, { kind: 'diplomacy', countries: [c.id, id] }); say(w, w.characters[c.leader], 'Foreign Ministry', `The ultimatum to ${o.name} ran out unanswered and we have not acted. Abroad and at home it is being called a bluff.`); }
  }
  // Demands whose day has passed.
  for (const t of w.treaties) {
    if (!t.pending || !t.ultimatum || w.turn < t.ultimatum.deadline) continue;
    t.pending = false; const from = w.countries[t.proposer], to = w.countries[t.parties.find(x => x !== t.proposer)]; if (!from?.alive || !to?.alive) continue;
    (from.casus ||= {})[to.id] = w.turn + 3;
    news(w, `${to.name} has let ${from.name}'s ultimatum run out unanswered.`, { kind: 'diplomacy', countries: [from.id, to.id] });
    say(w, w.characters[from.leader], 'Foreign Ministry', `${to.name} has not accepted the ultimatum (${t.id}). For three quarters the country and the world will take a declaration of war as the consequence you announced. If nothing follows, the threat will be remembered as empty.`);
  }
  // A guarantee or an alliance is tested when the friend is attacked.
  for (const war of w.wars.filter(x => x.active && !x.civil)) {
    for (const victim of war.b.map(id => w.countries[id]).filter(o => o?.alive)) for (const g of cs) {
      if (g.id === victim.id || sideOf(war, g.id) === 'a') continue;
      const bound = (w.guarantees || []).some(x => x.by === g.id && x.of === victim.id) ? 'guarantee' : hasTreaty(w, g.id, victim.id, 'alliance') ? 'alliance' : w.treaties.some(t => t.active && t.kind === 'protection' && t.protector === g.id && t.parties.includes(victim.id)) ? 'protection' : null; if (!bound) continue;
      const key = `${g.id}>${victim.id}`, seen = war.called ||= {};
      if (sideOf(war, g.id) === 'b') { if (seen[key] !== 'kept') { seen[key] = 'kept'; shame(w, g, 5, `it stood by ${victim.name} when ${victim.name} was attacked`); } continue; }
      if (!seen[key]) { seen[key] = w.turn; say(w, w.characters[g.leader], 'Foreign Ministry', `${victim.name}, to which we are bound by ${bound === 'guarantee' ? 'our guarantee' : 'alliance'}, is at war: ${war.name}. Our word is at stake. If we have not come in on its side within half a year, the world will know what our word is worth.`); }
      else if (typeof seen[key] === 'number' && w.turn - seen[key] >= 2) { seen[key] = 'failed'; shame(w, g, -10, `it left ${victim.name} to fight alone in spite of its ${bound}`); g.legitimacy = clamp(g.legitimacy - 2, 0, 100); news(w, `${g.name} has not come to the help of ${victim.name}, in spite of its ${bound}.`, { kind: 'diplomacy', countries: [g.id, victim.id] }); }
    }
  }
  // Someone driven out lives somewhere: in the neighbouring country least friendly to the one that drove them out.
  for (const ch of Object.values(w.characters)) {
    if (!ch.alive || ch.status !== 'exiled') { if (ch.host) ch.host = null; continue; }
    if (ch.host && w.countries[ch.host]?.alive && ch.host !== ch.country) continue;
    const home = w.countries[ch.country], hosts = cs.filter(o => o.id !== ch.country).sort((a, b) => (a.relations[ch.country] ?? 0) - (b.relations[ch.country] ?? 0)); if (!hosts.length) continue;
    ch.host = hosts[0].id; say(w, w.characters[hosts[0].leader], 'Police', `${ch.name}, driven out of ${home?.name ?? 'their country'}, has settled among us. Sheltering, expelling or handing them back is yours to decide.`); say(w, ch, 'A border post', `You have crossed into ${hosts[0].name} and are living there.`);
  }
  w.guarantees = (w.guarantees || []).filter(x => w.countries[x.by]?.alive && w.countries[x.of]?.alive);
  // A rival government recognised abroad takes something from the standing of the one at home, for as long as the recognition lasts.
  for (const c of cs) { const rival = rivalWeight(w, c); if (rival > 0) c.mods.push({ key: 'legitimacy', delta: -rival, turns: 1, label: 'A rival government recognised abroad' }); }
}

export const guaranteesOf = (w, id) => [...(w.guarantees || []).filter(x => x.of === id).map(x => w.countries[x.by]?.name), ...w.treaties.filter(t => t.active && t.kind === 'protection' && t.parties.includes(id) && t.protector !== id).map(t => `${w.countries[t.protector]?.name} (as its protector)`)].filter(Boolean);
export const recognisedBy = (w, ch) => (ch.recognisedBy || []).map(id => w.countries[id]).filter(o => o?.alive);
// How much standing a rival government recognised abroad takes from the one at home.
export const rivalWeight = (w, c) => clamp(sum(Object.values(w.characters).filter(ch => ch.alive && ch.country === c.id && ch.status === 'exiled'), ch => recognisedBy(w, ch).length * 1.5), 0, 6);
