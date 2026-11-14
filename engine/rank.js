// The table of the powers. Everybody in this world ranks its states, all the time: by their armies and fleets, their gold, their works, the
// land and the people under their flag. The table is reckoned when a year closes and printed in every paper. A state that rises in it is
// proud of its government, more so the more it thinks of itself as a nation; one that falls holds it against the government under which it
// fell, and men who say the nation is being let down are believed a little more (leagues.js reads that).
// Nothing here tells anybody what to want. (The user asked for an aim, "to become the strongest, most dominant state", 2026-11-13, and took
// instead this: the fact of the age that states are ranked, the table everybody sees, and what a country feels when its place in it moves.)
import { clamp, news, sum } from './util.js';
import { aliveCountries, countryProvinces, provincePop } from './world.js';
import { SHIPS } from './navy.js';

// What the chancelleries weigh, and how heavily.
export const WEIGH = { army: .25, fleet: .15, works: .3, gold: .1, people: .1, land: .1 };
const WORDS = { army: 'its army', fleet: 'its fleet', works: 'its works and trade', gold: 'its gold', people: 'the people under its flag', land: 'the land under its flag' };
const ORD = n => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
const short = c => c.rootName ?? c.name;
const say = (w, ch, from, text) => { if (ch?.alive) ch.inbox.push({ turn: w.turn, from, text }); };
const list = a => a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`;

function measures(w, c) {
  const home = countryProvinces(w, c.id);
  return { army: sum(Object.values(w.units).filter(u => u.country === c.id), u => u.men), fleet: sum(Object.values(w.fleets).filter(f => f.country === c.id), f => f.ships * (SHIPS[f.kind] ?? SHIPS.cruiser).power),
    works: Math.max(c.realGdp ?? c.gdp ?? 0, 0), gold: Math.max(c.reserves ?? 0, 0), people: sum(home, provincePop), land: home.length };
}
// Each state's share of the world in each thing, and of the whole: a hundred is the world.
export function reckon(w) {
  const cs = aliveCountries(w), m = Object.fromEntries(cs.map(c => [c.id, measures(w, c)])), parts = {}, score = {};
  for (const c of cs) { parts[c.id] = {}; score[c.id] = 0; for (const k of Object.keys(WEIGH)) { const all = sum(cs, o => m[o.id][k]) || 1, v = m[c.id][k] / all * 100; parts[c.id][k] = v; score[c.id] += v * WEIGH[k]; } }
  return { parts, score };
}
// The order: last year's, with a state passing the one above it only when it is clearly ahead (a table that changed with every harvest would
// be read by nobody).
function order(w, score, was) {
  const ids = Object.keys(score), o = (was || []).filter(id => id in score); for (const id of ids) if (!o.includes(id)) o.push(id);
  if (!was) return ids.sort((a, b) => score[b] - score[a]);
  for (let pass = 0; pass < o.length; pass++) for (let i = o.length - 1; i > 0; i--) if (score[o[i]] > score[o[i - 1]] * 1.05) [o[i], o[i - 1]] = [o[i - 1], o[i]];
  return o;
}
const yearOf = t => 1900 + Math.floor(t / 4);
export const placeOf = (w, c) => { const i = w.table?.order.indexOf(c.id) ?? -1; return i < 0 ? null : i + 1; };

// The first table: as the world stands when it is handed over. Nobody is proud or ashamed of it yet.
export function initTable(w) { const r = reckon(w); w.table = { turn: w.turn, year: yearOf(w.turn), order: order(w, r.score, null), score: r.score, parts: r.parts }; }

// When a year closes.
export function rankStep(w) {
  if (!w.table) { initTable(w); return; }
  if (w.turn % 4 !== 3) return;
  const old = { ...w.table, order: w.table.order.filter(id => w.countries[id]?.alive) }, r = reckon(w), now = order(w, r.score, old.order), year = yearOf(w.turn + 1), cs = aliveCountries(w), name = id => short(w.countries[id]);
  const passed = [];
  for (const c of cs) {
    const was = old.order.indexOf(c.id), is = now.indexOf(c.id); if (was < 0) continue;
    const places = was - is, rel = old.score[c.id] > 0 ? r.score[c.id] / old.score[c.id] - 1 : 0, nation = .6 + (clamp(c.axes?.nation ?? 0, -100, 100) + 100) / 200 * .8;
    // (Only a place won or lost is felt at home. A share that moves a little inside a year, with nobody passed, is the chancelleries'
    // arithmetic and no government's doing: a state is handed over settled, and its ruler does not watch a slide he did not cause.)
    const felt = clamp(places * 1.5, -5, 4) * nation;
    // What moved most, in the chancelleries' own terms.
    const moved = Object.keys(WEIGH).map(k => [k, (r.parts[c.id][k] - (old.parts?.[c.id]?.[k] ?? r.parts[c.id][k])) * WEIGH[k]]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
    const over = now.slice(is + 1).filter(id => old.order.indexOf(id) >= 0 && old.order.indexOf(id) < was), by = now.slice(0, is).filter(id => old.order.indexOf(id) > was);
    if (over.length) passed.push(`${name(c.id)} has passed ${list(over.map(name))}`);
    if (Math.abs(felt) >= .5) c.legitimacy = clamp(c.legitimacy + felt, 0, 100);
    if (places < 0) c.rankFell = { turn: w.turn, places: -places }; else if (c.rankFell && w.turn - c.rankFell.turn >= 8) delete c.rankFell;
    const share = Math.abs(rel) >= .03 ? ` Our share of the world's strength is ${rel > 0 ? 'up' : 'down'} by about ${Math.round(Math.abs(rel) * 100)} in the hundred against a year ago${moved && Math.abs(moved[1]) > .05 ? `, chiefly in ${WORDS[moved[0]].replace(/^its /, 'our ').replace('under its flag', 'under our flag')}` : ''}.` : '';
    const text = `The table of the powers for ${year}, as every chancellery keeps it and every paper prints it: ${now.map((id, i) => `${i + 1}. ${name(id)}`).join(', ')}. We stand ${ORD(is + 1)} of ${now.length}${places === 0 && !over.length && !by.length ? ', as we did a year ago' : `, where we stood ${ORD(was + 1)} a year ago${over.length ? `: we have passed ${list(over.map(name))}` : ''}${by.length ? `${over.length ? ', and' : ':'} ${list(by.map(name))} ${by.length > 1 ? 'have' : 'has'} passed us` : ''}`}.${share}${felt >= .5 ? ' At home it is felt: a country that sees itself rise gives its government the credit.' : felt <= -.5 ? ' At home it is felt: a country that sees itself fall holds it against the government under which it fell.' : ''}`;
    for (const id of new Set([c.leader, c.general])) say(w, w.characters[id], 'The chancellery', text);
  }
  w.table = { turn: w.turn, year, order: now, score: r.score, parts: r.parts, was: old.order };
  news(w, `The table of the powers for ${year}: ${now.map((id, i) => `${i + 1}. ${name(id)}`).join(', ')}.${passed.length ? ` ${passed.join('; ')}.` : ' No state has changed its place.'}`, { kind: 'general', countries: cs.map(c => c.id) });
}

// For the morning's briefing, to every seat: it is printed, after all.
export function tableLine(w, c) {
  const t = w.table; if (!t) return '';
  // (A state that has gone since the table was reckoned is not printed in it.)
  const order = t.order.filter(id => w.countries[id]?.alive), at = order.indexOf(c.id);
  return `The table of the powers (${t.year}; reckoned when each year closes, by armies and fleets, gold, works, land and people; the figure is the share of the world's strength): ${order.map((id, i) => `${i + 1}. ${short(w.countries[id])} ${Math.round(t.score[id])}`).join(', ')}.${at >= 0 ? ` We stand ${ORD(at + 1)}.` : ''}`;
}
