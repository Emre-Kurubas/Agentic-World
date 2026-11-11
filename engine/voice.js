// What whoever answers a small person's letters has to be told. An officer, an official or a banker whom nobody plays has no session and no
// memory: each time a letter reaches him, the voice that answers for him is handed the last letters that passed between the two, what the
// engine holds between them (notes of hand with their dates, contracts, offers, pay, blood), what he has already done for the writer or
// refused him, what he would answer if asked (the same reckoning the engine applies when the order comes, so that the letter and the engine
// say the same thing), and, if the writer is the ruler or the chief he serves, what a man in his post reports.
import { quarterLabel } from './util.js';
import { postOf, postReport, standing } from './court.js';
import { askFor, termsWords, creditFor } from './notes.js';
import { DEEDS, openTo, priceOf, gripOf, nerveOf } from './deeds.js';

const live = d => ['open', 'overdue'].includes(d.status);
const due = d => `${d.status === 'overdue' ? 'overdue since' : 'due'} ${quarterLabel(d.due)}`;
const BOUND = { aside: 'keeps his men where they stand and out of any stroke the writer is part of', warns: 'warns the writer of any order for the writer\'s arrest', blind: 'has the police look away from the writer\'s affairs', returns: 'sends the writer part of his province\'s taxes' };

// The letters that passed between the two before this one.
export const lettersBetween = (w, ch, writer, n = 4) => (ch.letters || []).filter(x => x.with === writer.id && x.turn < w.turn).slice(-n).map(x => `${quarterLabel(x.turn)}, ${x.out ? `${ch.name} to ${writer.name}` : `${writer.name} to ${ch.name}`}: "${x.text}"`);

export function between(w, ch, writer) {
  const out = [], c = w.countries[ch.country], home = writer.country === ch.country, serves = home && c?.alive && [c.leader, c.general].includes(writer.id);
  if (ch.kin === writer.id) out.push(`He is the writer's ${ch.tie}.`);
  if (ch.payroll === writer.id) out.push('He takes private pay from the writer.');
  if (ch.handler === writer.id) out.push(`He has reported to the writer in secret since ${quarterLabel(ch.boughtAt ?? w.turn)}.`);
  for (const [k, words] of Object.entries(BOUND)) if (standing(w, ch, k) && ch[k].for === writer.id) out.push(`Until ${quarterLabel(ch[k].until)} he ${words}; he has taken his price or given way, and keeps to it.`);
  for (const d of (w.debts || []).filter(live)) {
    const who = w.characters[d.debtor], holder = w.characters[d.creditor]; if (!who?.alive || !holder?.alive) continue;
    if (d.creditor === ch.id && d.debtor === writer.id) out.push(`The writer owes him ${Math.round(d.owed)} on note ${d.id}, ${due(d)}. ${termsWords(w, d)}.`);
    else if (d.creditor === writer.id && d.debtor === ch.id) out.push(`He owes the writer ${Math.round(d.owed)} on note ${d.id}, ${due(d)}; his purse holds about ${Math.round(ch.wealth)}.`);
    else if (d.creditor === ch.id) { const a = askFor(w, d, writer); out.push(`He holds note ${d.id}, on which ${who.name} owes him ${Math.round(d.owed)}, ${due(d)}. ${a.bound ? `He would not sell it to the writer at any price, and would tell ${who.name} who asked` : `He would sell it to the writer for ${a.price} and for no less`}.`); }
  }
  if (ch.post === 'house') { const k = creditFor(w, ch, writer); out.push(k.bad ? 'He would lend the writer nothing: a note of the writer\'s was not honoured.' : k.room >= 1 ? `He would lend the writer up to ${k.room} on the writer's name, at about ${Math.round(k.rate * 1000) / 10}% a quarter.` : 'He would lend the writer nothing at present.'); }
  for (const k of (w.contracts || []).filter(k => ['proposed', 'active'].includes(k.status) && [k.a, k.b].includes(ch.id) && [k.a, k.b].includes(writer.id))) out.push(`Contract ${k.id} ${k.status === 'proposed' ? `was offered by ${k.a === ch.id ? 'him to the writer' : 'the writer to him'} in ${quarterLabel(k.turn)} and is not yet answered (the notary carries the answer, not this letter)` : 'is in force between them'}: ${k.terms}${k.pay ? ` (${Math.round(k.pay)} a quarter)` : ''}.`);
  for (const o of (w.offers || []).filter(o => o.from === ch.id && o.to === writer.id && ['open', 'running'].includes(o.status))) out.push(`${o.status === 'open' ? `He has put an offer (${o.id}) to the writer, still open` : `An arrangement (${o.id}) with the writer is running`}: ${o.text}.`);
  const pl = (w.plots || []).find(p => p.active && [p.leader, ...p.members].includes(ch.id) && [p.leader, ...p.members].includes(writer.id)); if (pl) out.push(`He is with the writer in plot ${pl.id} (${pl.kind}).`);
  // What money would buy from him, and what the writer's file would force from him: the engine's own reckoning.
  const buys = openTo(w, ch, writer, 'bribe').map(k => { const p = priceOf(w, ch, writer, k); return p.never ? `${DEEDS[k].short}: not at any price` : `${DEEDS[k].short}: about ${p.price}`; });
  if (buys.length) out.push(`What the writer's money would buy from him, if it is asked or offered in the letter (he does not name these sums unasked): ${buys.join('; ')}.`);
  const file = writer.dossiers?.[ch.id]; if (file?.facts?.length) { const grip = gripOf(w, ch, writer, file), can = openTo(w, ch, writer, 'blackmail').filter(k => k !== 'pay'), yes = can.filter(k => grip >= nerveOf(w, ch, writer, k)), no = can.filter(k => !yes.includes(k));
    out.push(`The writer holds a file on him. Shown it and told what to do, he would ${yes.length ? `give way if told to ${yes.map(k => DEEDS[k].short).join(', or to ')}` : 'give way in nothing'}${no.length ? `; he would refuse to ${no.map(k => DEEDS[k].short).join(', or to ')}` : ''}.`); }
  for (const x of (ch.dealt || []).filter(x => x.with === writer.id).slice(-5)) out.push(`${x.turn === w.turn ? 'This quarter' : `In ${quarterLabel(x.turn)}`}: ${x.text}`);
  // To the ruler or the chief he serves, a servant who still believes in them reports what passes through his post.
  if (ch.handler === writer.id && postOf(w, ch)) out.push(`He is in the writer's pay, and tells the writer what a man in his post knows: ${postReport(w, c, ch)}`);
  else if (serves && postOf(w, ch)) out.push(ch.loyalty >= 30 ? `The writer is ${c.leader === writer.id ? 'his ruler' : 'the chief of the general staff'}, and he reports to the writer what a man in his post knows: ${postReport(w, c, ch)}` : `The writer is ${c.leader === writer.id ? 'his ruler' : 'the chief of the general staff'}, in whom he has lost faith: he reports what he must and no more, and gives no figures.`);
  else if (postOf(w, ch)) out.push('The writer is not someone he serves: of what passes through his post he tells the writer nothing, unless he is in the writer\'s pay.');
  return out;
}
