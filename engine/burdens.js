// What a person brings with them to a seat: something done that few know of, an old debt, someone of their blood who can be reached.
// These are events and facts, not a character. What they made of the person, and what the person does about them, is the person's own affair.
// Drawn from the person's own name and number, so the world's dice are not touched.
import { ROLES, spawnCharacter, aliveCountries, countryProvinces } from './world.js';
import { nextId } from './util.js';
import { givenNames, sexOf, personName } from './names.js';

const hash = s => { let h = 7; for (const x of String(s)) h = (h * 31 + x.codePointAt(0)) >>> 0; return h; };
const SECRETS = {
  leader: ['Took money from the holder of a concession before coming to office, and has not paid it back.', 'Signed the order under which prisoners were shot after a rising, and let it be thought another had signed.', 'First came to office through a vote that was bought.', 'Has a child born outside marriage, kept at a distance and paid for from a fund that is not their own.', 'Let a friend who had stood by them go to prison for something they had done themselves.', 'Has taken a share of every contract a certain supplier has had from the state.'],
  general: ['Sold army contracts to a relative while quartermaster.', 'Had a village burned in a border campaign and reported it as the enemy\'s work.', 'Lost an action through negligence and let a subordinate be shot for it.', 'Owes more at the card tables than a year of their pay.', 'Kept the pay of dead men on the rolls for two years and drew it.', 'Took a foreign attache\'s money for a copy of the mobilisation timetable, once, years ago.'],
  opposition: ['Was paid by a foreign legation while in exile.', 'Gave the police the names of comrades to get out of prison.', 'Took the movement\'s funds for private use and covered it in the accounts.', 'Wrote, under another name, in praise of the government they now attack.', 'Called a strike off in return for money from the owners, and told the men it was lost.', 'Has a brother in the secret police and has more than once used what he passes on.'],
  oligarch: ['Won the first concession by bribing a minister.', 'Had a rival\'s works set on fire.', 'Keeps two sets of books; the tax office sees the other one.', 'Sent men down a pit that the engineer had reported unsafe; eleven died, and the report was burned.', 'Bought a judge to win the suit on which the fortune rests.', 'Sold condemned grain to the army in a hungry year.']
};
// Names here carry no sex, so the ties are named without one.
const KIN = [['eldest child', 'officer'], ['younger child', 'official'], ['younger sibling', 'official'], ['niece or nephew', 'officer'], ['cousin', 'officer'], ['elder sibling', 'official']];
const OFFICES = ['a post in the customs service', 'a desk in the ministry of finance', 'a provincial prefecture', 'a seat on the railway board'];

export function burden(w, ch) {
  if (!w.burdens || ch.burdened || !ROLES.includes(ch.role)) return;
  ch.burdened = true; career(w, ch);
  const c = w.countries[ch.country]; if (!c?.alive) return;
  const h = hash(`${ch.id}|${ch.name}|burden`), year = 1900 + Math.floor(w.turn / 4), list = SECRETS[ch.role], first = h % list.length;
  const keep = (i, ago) => (ch.secrets ||= []).push({ turn: w.turn - ago * 4, text: `In ${year - ago}: ${list[i]}`, old: true });
  keep(first, 3 + h % 9); if ((h >>> 3) % 5 < 2) keep((first + 1 + (h >>> 4) % (list.length - 1)) % list.length, 2 + (h >>> 6) % 12);
  // An old loan from the country's banking house, renewed more than once and coming due.
  const banker = Object.values(w.characters).find(x => x.alive && x.country === c.id && x.post === 'house');
  if (banker && (h >>> 5) % 20 < 8) { const amount = Math.round(12 + ch.wealth * (.4 + ((h >>> 7) % 50) / 100)); (w.debts ||= []).push({ id: nextId(w, 'B-'), creditor: banker.id, debtor: ch.id, amount, owed: Math.round(amount * 1.25), due: w.turn + 6 + (h >>> 9) % 7, terms: 'An old loan from before you held your seat, renewed more than once. The house expects it to be honoured.', status: 'open', turn: w.turn, old: true }); }
  // Someone of their blood, with a place in the world that others can touch.
  if ((h >>> 11) % 20 < 11) {
    const [tie, role] = KIN[(h >>> 13) % KIN.length], kin = spawnCharacter(w, c.id, role, c.axes, { family: ch.name.split(' ').at(-1), age: /sibling$|cousin/.test(tie) ? [36, 60] : [22, 38], power: 22 });
    // Blood shows in the name and in where one comes from, whatever the registry made of them.
    const family = ch.name.split(' ').at(-1), eth = ch.origin?.eth ?? c.majorityEth, rel = ch.origin?.rel ?? c.majorityRel, pool = givenNames(eth);
    // The family's name, and a given name nobody of note in the country bears with it already (least of all the kinsman himself).
    const borne = new Set(Object.values(w.characters).filter(x => x.alive && x.id !== kin.id && x.country === c.id).map(x => x.name)); let at = hash(kin.id) % pool.length; for (let i = 0; i < pool.length && borne.has(`${pool[at]} ${family}`); i++) at = (at + 1) % pool.length;
    kin.name = `${pool[at]} ${family}`; kin.sex = sexOf(kin.name); if (kin.origin) Object.assign(kin.origin, { eth, rel });
    kin.kin = ch.id; kin.tie = tie; (ch.kinfolk ||= []).push(kin.id);
    if (role === 'officer') { const u = Object.values(w.units).filter(x => x.country === c.id && !w.characters[x.commander]?.alive).sort((a, b) => a.men - b.men)[0]; if (u) u.commander = kin.id; else kin.office = 'a captaincy in the capital garrison'; }
    else kin.office = OFFICES[(h >>> 16) % OFFICES.length];
  }
}
// A life before the seat, in what everybody knows of it: how the ruler came to power, what made the name of the others, and what became of
// the last person who sat where each of them sits. Facts only, different from seat to seat and from state to state; what they made of the
// person is the person's own affair. Drawn from the person's name and the country as it was handed over, on the day of handing over only:
// whoever comes to a seat later has a real rise and a real predecessor.
// (World 19: thirty-two characters were written by two models from one question and came out thirty-two careful schemers; nobody had ever
// seen what losing costs. The user asked for lives that differ and for the price of losing, as facts. The sentences were put to the user
// and approved, 2026-11-12.)
export function career(w, ch) {
  if (w.turn > 0 || ch.career) return; const c = w.countries[ch.country]; if (!c?.alive || c[ch.role] !== ch.id) return;
  const h = hash(`${ch.id}|${ch.name}|career`), pick = (list, salt = 0) => list[(h >>> salt) % list.length], year = (from, span, salt) => from + (h >>> salt) % span, hard = (c.axes?.auth ?? 0) > 40;
  const eth = ch.origin?.eth ?? c.majorityEth, rel = ch.origin?.rel ?? c.majorityRel, mine = countryProvinces(w, c.id), family = ch.name.split(' ').at(-1);
  const town = salt => { const far = mine.filter(p => p.id !== c.capital); return (far.length ? far : mine)[(h >>> salt) % Math.max(1, (far.length ? far : mine).length)]; };
  const restless = mine.filter(p => p.id !== c.capital && (p.groups || []).some(g => g.eth !== c.majorityEth && g.share >= .35)), where = restless.length ? restless[(h >>> 5) % restless.length] : town(5);
  const forts = mine.filter(p => p.fort >= 1), fortress = (forts.length ? forts[(h >>> 7) % forts.length] : w.provinces[c.capital])?.name ?? 'the capital';
  const others = aliveCountries(w).filter(o => o.id !== c.id), abroad = others.length ? others[(h >>> 9) % others.length].name : 'another country';
  // Somebody who bears no name of the living great of the country (a namesake would read as kin), and, where the sentence says "his", a man.
  const taken = new Set(Object.values(w.characters).filter(x => x.alive && x.country === c.id).map(x => x.name.split(' ').at(-1))), man = ch.role === 'leader' && c.archetype === 'monarchy';
  let prev = personName(eth, rel, `${ch.id}|before`); for (let i = 2; i < 40 && (taken.has(prev.split(' ').at(-1)) || (man && sexOf(prev) !== 'm')); i++) prev = personName(eth, rel, `${ch.id}|before|${i}`);
  const known = [], record = (y, text) => { (c.chronicle ||= []).push({ year: y, text }); c.chronicle.sort((a, b) => a.year - b.year); };
  let fate;
  if (ch.role === 'leader') {
    const y = year(1889, 9, 3), k = c.archetype;
    if (k === 'junta') { if (h % 2) { ch.rise = `You came to the seat in ${y}, when the regiments of the capital put ${prev} against a wall in the palace yard; you were the colonel who gave the order.`; fate = `was shot in ${y}`; record(y, `${prev} was shot in the yard of the palace when the regiments of the capital changed the government.`); } else fate = `lives in exile in ${abroad}`; }
    else if (k === 'monarchy') { prev = `${prev.split(' ')[0]} ${family}`; if (h % 2) { ch.rise = `Your father held this seat and was shot in his carriage in ${y}; the man who paid for it was never named.`; fate = `was shot in ${y}`; record(y, `${prev} was shot in his carriage; nobody was ever charged.`); } else fate = `died in ${y}, in bed`; }
    else if (k === 'revolutionary') fate = h % 2 ? `was shot in ${y}, in the year of the uprising` : `lives in exile in ${abroad}`;
    else if (k === 'theocracy') { if (h % 2) ch.rise = `The council chose you in ${y} because the two men it feared could not agree on each other.`; fate = `died in office in ${y}`; }
    else if (k === 'agrarian') fate = h % 2 ? `was put aside by the landlords in ${y} and died the year after` : `sits in the fortress at ${fortress}`;
    else if (k === 'merchant' || k === 'federation') { if (h % 2) ch.rise = `The council chose you in ${y} because the two men it feared could not agree on each other.`; fate = 'retired rich and is buried in the cathedral'; }
    else fate = h % 2 ? `lost the vote of ${y} and went back to private life` : 'retired rich and is buried in the cathedral';
  } else if (ch.role === 'general') {
    const y = year(1887, 10, 3), n = 3 + (h >>> 12) % 9, which = h % 3;
    if (which === 0) { known.push(`You made your name at ${where.name} in ${y}, where the rising was put down in four days and some ${n} hundred were buried; you were promoted for it within the year.`); record(y, `The rising at ${where.name} was put down in four days by troops under ${ch.name}; some ${n} hundred were buried.`); where.remembers = { year: y, who: ch.id, dead: n * 100 }; }
    else if (which === 1) known.push(`You refused to fire on the crowd at ${town(5).name} in ${y} and were passed over for six years.`);
    else known.push(`You lost the frontier fight of ${y} and the papers wrote that the staff had been asleep.`);
    fate = hard ? pick([`was shot in ${year(1890, 8, 15)}`, `sits in the fortress at ${fortress}`, `lives in exile in ${abroad}`], 17) : pick([`died in ${year(1890, 8, 15)}`, 'retired rich and is buried in the cathedral', `lives in exile in ${abroad}`], 17);
  } else if (ch.role === 'opposition') {
    const y = year(1888, 9, 3), which = h % 3;
    if (which === 0) known.push(`You spent ${y - 5} to ${y} in the fortress at ${fortress} for a pamphlet.`);
    else if (which === 1) { known.push(`Your brother was hanged in ${y} after the rising at ${where.name}.`); record(y, `After the rising at ${where.name} its leaders were hanged, a brother of ${ch.name} among them.`); }
    else known.push(`You sat in the government until ${y} and were dismissed in a morning.`);
    fate = hard ? pick([`was shot in ${year(1890, 8, 15)}`, `sits in the fortress at ${fortress}`, `lives in exile in ${abroad}`], 17) : pick([`lives in exile in ${abroad}`, `died in ${year(1890, 8, 15)}`, 'retired rich and is buried in the cathedral'], 17);
  } else {
    const y = year(1886, 11, 3), which = h % 3, works = Object.values(w.firms || {}).filter(f => f.owner === ch.id && f.status === 'open').sort((a, b) => (b.stake || 0) - (a.stake || 0))[0];
    if (which === 0) known.push(`Your fortune was made in the war of ${y}, on boots and rifles the army paid for twice.`);
    else if (which === 1 && works) { const p = w.provinces[works.province]; known.push(`The strike at your ${p?.name ?? 'largest'} works in ${y} was broken by men you hired; eleven strikers died.`); record(y, `The strike at the ${p?.name ?? 'great'} works of ${ch.name} was broken by hired men; eleven strikers died.`); }
    else known.push(`You bought the estates of the families exiled in ${y} at a fifth of their worth.`);
    fate = pick([hard ? `sits in the fortress at ${fortress}` : `lives in exile in ${abroad}`, 'retired rich and is buried in the cathedral', `lives in exile in ${abroad}`], 17);
  }
  known.push(`The last holder of your seat, ${prev}, ${fate}.`);
  ch.career = known; ch.before = { name: prev, fate };
}
export const careerText = ch => ch.career || [];
export function burdenAll(w) { for (const c of aliveCountries(w)) for (const r of ROLES) { const ch = w.characters[c[r]]; if (ch?.alive) burden(w, ch); } }

// What the person knows about themselves that others mostly do not.
export function burdensText(w, ch) {
  const out = [];
  for (const s of (ch.secrets || []).filter(x => x.old && !x.published)) out.push(s.text);
  for (const d of (w.debts || []).filter(x => x.old && x.debtor === ch.id && ['open', 'overdue'].includes(x.status))) out.push(`You owe ${Math.round(d.owed)} to ${w.characters[d.creditor]?.name}, who heads the largest banking house; it falls due in ${Math.max(0, d.due - w.turn)} quarters (debt ${d.id}). Your own purse holds ${Math.round(ch.wealth)}.`);
  for (const id of ch.kinfolk || []) { const k = w.characters[id]; if (k?.alive) out.push(`Your ${k.tie} ${k.name} (${k.id}) ${k.office ? `holds ${k.office}` : `is an officer${Object.values(w.units).find(u => u.commander === k.id) ? ` and commands ${Object.values(w.units).find(u => u.commander === k.id).id}` : ''}`}; what happens to ${k.name.split(' ')[0]} can be made to happen by others.`); }
  return out;
}
