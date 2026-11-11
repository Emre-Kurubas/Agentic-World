// What a person brings with them to a seat: something done that few know of, an old debt, someone of their blood who can be reached.
// These are events and facts, not a character. What they made of the person, and what the person does about them, is the person's own affair.
// Drawn from the person's own name and number, so the world's dice are not touched.
import { ROLES, spawnCharacter, aliveCountries } from './world.js';
import { nextId } from './util.js';
import { givenNames, sexOf } from './names.js';

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
  ch.burdened = true;
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
export function burdenAll(w) { for (const c of aliveCountries(w)) for (const r of ROLES) { const ch = w.characters[c[r]]; if (ch?.alive) burden(w, ch); } }

// What the person knows about themselves that others mostly do not.
export function burdensText(w, ch) {
  const out = [];
  for (const s of (ch.secrets || []).filter(x => x.old && !x.published)) out.push(s.text);
  for (const d of (w.debts || []).filter(x => x.old && x.debtor === ch.id && ['open', 'overdue'].includes(x.status))) out.push(`You owe ${Math.round(d.owed)} to ${w.characters[d.creditor]?.name}, who heads the largest banking house; it falls due in ${Math.max(0, d.due - w.turn)} quarters (debt ${d.id}). Your own purse holds ${Math.round(ch.wealth)}.`);
  for (const id of ch.kinfolk || []) { const k = w.characters[id]; if (k?.alive) out.push(`Your ${k.tie} ${k.name} (${k.id}) ${k.office ? `holds ${k.office}` : `is an officer${Object.values(w.units).find(u => u.commander === k.id) ? ` and commands ${Object.values(w.units).find(u => u.commander === k.id).id}` : ''}`}; what happens to ${k.name.split(' ')[0]} can be made to happen by others.`); }
  return out;
}
