// Notes of hand. A private debt is a paper, and a paper is property: its holder can sell it, give time on it, take less for it, forget it or
// call it in; whoever owes can ask what the holder would take; and money can be had on one's name from the banking house or from a person who
// has it. Where somebody plays the holder, the answer is his to give. Where nobody does (a banker, an official, an officer), he answers at
// once and by what he is: what he expects to see of his money, what the paper is worth to him as a hold on someone in a seat, how fond he is
// of money, and how he stands toward his ruler. No dice are thrown: the same question gets the same answer until something has changed.
import { clamp, nextId, quarterLabel } from './util.js';
import { ROLES } from './world.js';
import { favourFor, seize, deal } from './court.js';
import { treasuryPays } from './money.js';
import { he, He, him, his } from './names.js';

const say = (w, ch, from, text) => { if (ch?.alive) ch.inbox.push({ turn: w.turn, from, text }); };
const trace = (w, ch, text) => { if (!ch) return; (ch.secrets ||= []).push({ turn: w.turn, text }); ch.secrets = ch.secrets.slice(-12); };
const live = d => ['open', 'overdue'].includes(d.status);
export const noteOf = (w, id) => (w.debts || []).find(d => d.id === String(id ?? '').trim() && live(d)) ?? null;
const seatOf = (w, ch) => { const c = w.countries[ch.country]; return c?.alive ? ROLES.find(r => c[r] === ch.id) ?? null : null; };
const r1 = v => Math.round(v * 10) / 10;
// What a debtor has that a creditor can hope to see: what lies at home.
const within = ch => Math.max(0, ch.wealth - (ch.abroad || 0));
const cover = (w, d) => clamp(within(w.characters[d.debtor]) / Math.max(d.owed, .01), 0, 1);
const owing = (w, ch) => (w.debts || []).filter(d => live(d) && d.debtor === ch.id).reduce((a, d) => a + d.owed, 0);
const spent = (w, holder, key) => holder._quarter?.turn === w.turn ? holder._quarter.used[key] || 0 : 0;
const BID_LIFE = 4;
export const bidsOn = (w, id) => (w.bids || []).filter(b => b.debt === id && w.turn - b.turn < BID_LIFE);
export const pruneBids = w => { if (w.bids) w.bids = w.bids.filter(b => w.turn - b.turn < BID_LIFE && noteOf(w, b.debt)); };
const dueWords = d => `${d.status === 'overdue' ? 'overdue since' : 'due'} ${quarterLabel(d.due)}`;

// What the holder of a note, by his own reckoning, would take for it from someone who wants to buy it.
export function askFor(w, d, buyer) {
  const h = w.characters[d.creditor], who = w.characters[d.debtor], c = w.countries[h.country], cov = cover(w, d);
  // What he expects to see of his money in the end, and what a paper on someone in a seat is worth to him beyond that.
  const paid = d.owed * (.45 + .55 * cov) * (d.status === 'overdue' ? .9 : 1), hold = seatOf(w, who) ? d.owed * .25 : 0;
  // He does not hand his own ruler's paper to another while he stands by that ruler.
  const ruler = c?.alive ? w.characters[c.leader] : null, bound = !!ruler && who.id === ruler.id && buyer?.id !== ruler.id && h.loyalty >= 65;
  return { price: Math.ceil((paid + hold) * (.85 + h.greed / 200)), bound, cov, hold };
}
// What he would take from the debtor himself: time for a price, or less than is owed, now, in full discharge.
export function termsFor(w, d) {
  const h = w.characters[d.creditor], who = w.characters[d.debtor], cov = cover(w, d), kin = h.kin === who.id || who.kin === h.id;
  const rate = .02 + h.greed / 2500, renewed = d.renewed || 0;
  // From a debtor who can pay the whole he wants the whole. From one who cannot he takes most of what the man can be seen to have, and never
  // less than half the note: below that he would rather wait, press or sell the paper.
  const share = cov >= 1 ? 1 : Math.max(.5, .9 * cov);
  return { rate, time: renewed < 3 || cov >= .5, renewed, floor: Math.min(d.owed, Math.ceil(d.owed * share * (.9 + h.greed / 500) * (kin ? .5 : 1) - 1e-9)), cov, kin };
}
// What he would put on a borrower's name, and at what price.
export function creditFor(w, l, ch) {
  const debts = owing(w, ch), bad = (w.debts || []).some(d => d.debtor === ch.id && (d.status === 'overdue' || (d.seized != null && w.turn - d.seized < 16)));
  const name = within(ch) * .8 + ch.power * .25 + (seatOf(w, ch) ? 8 : 0) - debts, spare = Math.max(0, l.wealth) * .35;
  return { room: bad ? 0 : Math.floor(Math.max(0, Math.min(name, spare))), bad, thin: spare < name, rate: .015 + l.greed / 3000 + clamp(debts / (within(ch) + 10), 0, 1) * .02 };
}
// The terms in words, for the debtor who looks his debts up and for whoever writes the holder's letters.
export function termsWords(w, d) {
  const h = w.characters[d.creditor], t = termsFor(w, d), fee = r1(d.owed * t.rate);
  return `${t.time ? `${h.name} would give time on it for about ${fee} added to the note for each quarter` : `${h.name} has renewed it ${t.renewed} times, sees too little behind it and will give no more time`}; ${t.floor >= d.owed - .5 ? `${he(h)} would take nothing less than the whole` : `${he(h)} would take ${t.floor} now and call it settled`}`;
}

function assign(w, d, to, price, quiet) {
  const h = w.characters[d.creditor], who = w.characters[d.debtor];
  (d.passed ||= []).push({ turn: w.turn, from: h.id, to: to.id, price }); d.creditor = to.id; d.dunned = null;
  trace(w, to, `Bought up ${who.name}'s note of hand for ${Math.round(d.owed)} from ${h.name}.`); trace(w, h, `Sold ${who.name}'s note of hand to ${to.name}.`);
  if (!quiet) say(w, who, 'Notary', `Your note ${d.id} for ${Math.round(d.owed)}, ${dueWords(d)}, has passed from ${h.name} to ${to.name}. It is to ${to.name} that you owe it now.`);
  if (w.bids) w.bids = w.bids.filter(b => b.debt !== d.id);
  return `Note ${d.id} is yours for ${r1(price)}: ${who.name} owes you ${Math.round(d.owed)}, ${dueWords(d)}. ${quiet ? `${who.name} has not been told; the notary will name you when it falls due, unless you show it first.` : `${who.name} has been told who holds it now.`} It is a hold as long as you keep it: you can give time on it (extend_debt), take less or forget it (forgive_debt), sell it on (sell_debt), or, once it is overdue, call it in through the courts (call_debt).`;
}
// Whoever governs may buy a paper with the state's secret money; anyone else pays from his own purse. Returns what was paid, or 0.
function payFor(w, c, actor, price, state, allowance) {
  if (state) { const limit = Math.max(c.gdp, 1) * .002; if (limit - spent(w, c, 'secret_funds') < price - .01) return 0; const m = treasuryPays(c, allowance(w, c, 'secret_funds', limit, price)); if (m < price - .01) { c.treasury += m; return 0; } (c._outlay ||= {}).secret = (c._outlay.secret || 0) + m; return m; }
  if (actor.wealth < price) return 0; actor.wealth -= price; return price;
}

export function noteOp(w, actor, c, op, { fail, num, governs, allowance }) {
  const ok = msg => ({ ok: true, msg });
  if (op.op === 'borrow_private') {
    const key = String(op.from ?? op.character ?? 'house').trim(), house = Object.values(w.characters).find(x => x.alive && x.country === c.id && x.post === 'house' && x.status === 'free');
    const l = /^(the )?(banking )?house$/i.test(key) ? house : Object.hasOwn(w.characters, key) ? w.characters[key] : Object.values(w.characters).find(x => x.alive && x.name.toLowerCase() === key.toLowerCase());
    if (!l?.alive || l.id === actor.id) return fail(`No such lender.${house ? ` The largest banking house here is that of ${house.name} (${house.id}).` : ''}`);
    const want = num(op.amount, 0, 1e6, 0), turns = Math.round(num(op.due_turns, 1, 40, 8)); if (!(want >= 1)) return fail('No sum was named.');
    if (l.status !== 'free') return fail(`${l.name} is in no position to lend.`);
    if (l.aiControlled) { say(w, l, actor.name, `${actor.name} asks to borrow ${r1(want)} of you for ${turns} quarters${op.interest != null ? `, offering ${Math.round(num(op.interest, 0, 2, 0) * 100)}% in all` : ''}. Lending it is yours to decide (lend_private with character ${actor.id}).`); return ok(`The request has gone to ${l.name}; whether to lend, and on what terms, is ${his(l)} to decide.`); }
    if (allowance(w, actor, `borrow:${l.id}`, 1, 1) <= 0) return fail(`${l.name} has given ${his(l)} answer this quarter; ${he(l)} can be asked again in the next.`);
    const k = creditFor(w, l, actor), total = Math.min(1, k.rate * turns), perQ = op.rate != null ? num(op.rate, 0, 1, 0) : null; let offered = op.interest != null ? num(op.interest, 0, 2, 0) : perQ != null ? perQ * turns : null;
    // People speak of what money costs by the quarter. A figure too small to be the whole charge and about right as the charge for one quarter is
    // the charge for one quarter. (World 17: "at the quoted 4.4% a quarter" was written as 4.4% for two years and refused four times in fifteen.)
    if (op.interest != null && perQ == null && turns > 1 && offered < total * .95 && offered * turns >= total * .95) offered *= turns;
    // Whoever offers the house about what it asks borrows at what it asks.
    if (offered != null && offered >= total * .95) offered = Math.max(offered, total);
    if (k.bad) return fail(`${l.name} lends you nothing: your name is on a note that was not honoured, and that is remembered for years.`);
    if (k.room < 1) return fail(`${l.name} will put nothing on your name: ${k.thin ? `${his(l)} own house cannot spare it` : `by ${his(l)} reckoning what you have and what you are do not cover what you already owe`}.`);
    if (offered != null && offered < total - .005) return fail(`${l.name} does not lend for ${turns} quarters at ${Math.round(offered * 100)}% in all (${r1(offered / turns * 100)}% a quarter): on your name ${he(l)} wants ${Math.ceil(total * 100)}% in all, about ${r1(total / turns * 100)}% a quarter. ${He(l)} would put up as much as ${k.room}.`);
    const m = Math.min(want, k.room), interest = Math.max(total, offered ?? 0), d = { id: nextId(w, 'B-'), creditor: l.id, debtor: actor.id, amount: m, owed: r1(m * (1 + interest)), due: w.turn + turns, terms: `Borrowed from ${l.post === 'house' ? `the banking house of ${l.name}` : l.name} in ${quarterLabel(w.turn)}.`, status: 'open', turn: w.turn };
    l.wealth -= m; actor.wealth += m; (w.debts ||= []).push(d); trace(w, actor, `Borrowed ${Math.round(m)} from ${l.post === 'house' ? `the banking house of ${l.name}` : l.name}.`); deal(w, l, actor, `Lent ${actor.name} ${r1(m)} on note ${d.id}; ${d.owed} is due ${quarterLabel(d.due)}.`);
    return { ok: true, debt: d.id, msg: `${l.name} lent you ${r1(m)}${m < want - .01 ? `, not the ${r1(want)} asked: that is what ${he(l)} will put on your name` : ''}. You owe ${d.owed} on note ${d.id} by ${quarterLabel(d.due)} (${Math.round(interest * 100)}% for the ${turns} quarters). ${l.post === 'house' ? 'Unpaid, the house first names what it would take to forget it, and then takes what the law gives it, and the town hears.' : `Unpaid, it is ${his(l)} to press, to sell or to hold over you.`}` };
  }
  const d = noteOf(w, op.debt ?? op.id ?? op.note);
  if (!d) { const mine = (w.debts || []).filter(x => live(x) && [x.creditor, x.debtor].includes(actor.id)).map(x => x.id), shut = (w.debts || []).find(x => x.id === String(op.debt ?? op.id ?? op.note ?? '') && !live(x));
    if (shut) return fail(`Note ${shut.id} is no longer open: it was ${shut.status === 'paid' ? 'paid' : shut.status}${shut.closedAt != null ? ` in ${quarterLabel(shut.closedAt)}` : ''}, and nothing stands on it. A file that still names it was written before that.`);
    return fail(`No such note is open.${mine.length ? ` Those you are party to: ${mine.join(', ')}.` : ''}`); }
  const h = w.characters[d.creditor], who = w.characters[d.debtor]; if (!h?.alive || !who?.alive) return fail('That note is void: one of its parties is dead.');
  switch (op.op) {
    case 'buy_debt': {
      if (h.id === actor.id) return fail('You hold that note already.');
      if (who.id === actor.id) return fail(`It is your own note. What ${h.name} would take to give you time on it or to call it settled is asked with ask_terms.`);
      const price = num(op.price ?? op.amount, 0, 1e6, 0), state = op.state === true && governs, quiet = op.quiet === true;
      if (h.aiControlled) {
        if (!(price > 0)) return fail('No price was offered.');
        const bids = w.bids ||= [], old = bids.findIndex(b => b.debt === d.id && b.from === actor.id), bid = { debt: d.id, from: actor.id, price, state, quiet, turn: w.turn }; if (old >= 0) bids[old] = bid; else bids.push(bid);
        say(w, h, actor.name, `${actor.name} offers you ${r1(price)} for note ${d.id}, on which ${who.name} owes you ${Math.round(d.owed)} (${dueWords(d)}). Selling it is yours to decide (sell_debt with debt ${d.id} and to ${actor.id}); the offer stands for a year.`);
        return ok(`Your offer of ${r1(price)} for note ${d.id} has gone to ${h.name}, who holds it. Selling is ${his(h)} to decide; the offer stands for four quarters, and a new one replaces it.`);
      }
      const a = askFor(w, d, actor), ruler = w.characters[w.countries[h.country]?.leader];
      if (!(price > 0)) return fail(a.bound ? `No price was offered; and ${h.name} would not put ${who.name}'s paper into another's hands at any price while ${he(h)} stands toward the government as ${he(h)} does.` : `No price was offered. ${h.name} would part with note ${d.id} (${who.name} owes ${Math.round(d.owed)}, ${dueWords(d)}) for ${a.price}.`);
      if (allowance(w, actor, `bid:${d.id}`, 1, 1) <= 0) return fail(`${h.name} has given ${his(h)} answer on that note this quarter; ${he(h)} can be asked again in the next.`);
      if (a.bound) {
        // A loyal man tells his ruler who came for the ruler's paper, and it goes into the ruler's file.
        if (ruler?.alive) { say(w, ruler, h.name, `${h.name} (${h.id}) reports that ${actor.name} (${actor.id}) offered ${r1(price)} for your note ${d.id}, to hold it in ${his(actor)} own hands. ${He(actor)} was refused.`); const f = ruler.dossiers[actor.id] ||= { turn: w.turn, about: actor.name, facts: [] }; f.facts.push(`Tried in ${quarterLabel(w.turn)} to buy up ${ruler.name}'s note of hand from ${h.name}.`); f.facts = f.facts.slice(-8); }
        trace(w, actor, `Tried to buy up ${who.name}'s note of hand from ${h.name}.`); deal(w, h, actor, `Refused to sell ${actor.name} the note ${d.id} of ${who.name}, and told ${who.name}.`);
        return fail(`${h.name} will not put ${who.name}'s paper into another's hands: it is not the sum; ${he(h)} stands by the government, and such a man may say who asked.`);
      }
      if (price < a.price) { deal(w, h, actor, `Refused ${actor.name}'s ${r1(price)} for note ${d.id} of ${who.name}; ${his(h)} price is ${a.price}.`); return fail(`${h.name} will not part with note ${d.id} for ${r1(price)}. ${who.name} owes ${Math.round(d.owed)} on it${a.cov >= .8 ? ' and can pay' : a.cov < .3 ? ' and has little to pay with' : ''}${a.hold ? `, and a note on someone in a seat is a hold ${he(h)} would be giving up` : ''}: ${he(h)} names ${a.price}.`); }
      const paid = payFor(w, c, actor, price, state, allowance); if (!paid) return fail(state ? 'The secret funds cannot cover that this quarter.' : `You have not got ${r1(price)}.`);
      h.wealth += paid; if (state) trace(w, actor, `Paid for ${who.name}'s note of hand with ${Math.round(paid)} of the treasury's money.`);
      deal(w, h, actor, `Sold ${actor.name} the note ${d.id} of ${who.name} for ${r1(paid)}.`);
      return ok(assign(w, d, actor, paid, quiet));
    }
    case 'sell_debt': {
      if (h.id !== actor.id) return fail('That note is not yours to sell.');
      const key = String(op.to ?? op.character ?? '').trim(), to = Object.hasOwn(w.characters, key) ? w.characters[key] : Object.values(w.characters).find(x => x.alive && x.name.toLowerCase() === key.toLowerCase());
      if (!to?.alive || to.id === actor.id || to.id === who.id) return fail(to?.id === who.id ? `${who.name} is the debtor: to let ${him(who)} off for a sum, take the sum and forgive the note.` : 'No such buyer.');
      const bid = bidsOn(w, d.id).find(b => b.from === to.id), want = op.price != null ? num(op.price, 0, 1e6, 0) : null;
      if (bid) {
        if (want != null && want > bid.price + .01) return fail(`${to.name} has offered ${r1(bid.price)} for it, not ${r1(want)}.`);
        const tc = w.countries[to.country], paid = payFor(w, tc, to, bid.price, bid.state && tc?.alive && tc.leader === to.id, allowance); if (!paid) return fail(`${to.name} no longer has the ${r1(bid.price)} ${he(to)} offered.`);
        actor.wealth += paid; say(w, to, actor.name, assign(w, d, to, paid, bid.quiet)); return ok(`Note ${d.id} is sold to ${to.name} for ${r1(paid)}.`);
      }
      // A banking house discounts paper: it buys a note for less than it expects to see of it. Nobody else nobody plays buys notes.
      if (!to.aiControlled) {
        if (to.post !== 'house' || to.status !== 'free') return fail(`${to.name} does not deal in paper; a banking house does.`);
        const worth = Math.floor(d.owed * (.45 + .55 * cover(w, d)) * (d.status === 'overdue' ? .9 : 1) * .8); if (worth < 1 || to.wealth < worth) return fail(`The house of ${to.name} will not take that paper.`);
        if (want != null && want > worth) return fail(`The house of ${to.name} would give ${worth} for note ${d.id}, not ${r1(want)}.`);
        to.wealth -= worth; actor.wealth += worth; assign(w, d, to, worth, false); deal(w, to, actor, `Bought the note ${d.id} of ${who.name} from ${actor.name} for ${worth}.`); return ok(`The house of ${to.name} took note ${d.id} for ${worth}. ${who.name} owes the house now.`);
      }
      if (want == null) return fail(`${to.name} has made no offer for that note: name a price to put it to ${him(to)}.`);
      say(w, to, actor.name, `${actor.name} offers to sell you note ${d.id}, on which ${who.name} owes ${Math.round(d.owed)} (${dueWords(d)}), for ${r1(want)}. To take it, offer that price (buy_debt with debt ${d.id}).`); return ok(`The offer has gone to ${to.name}; if ${he(to)} bids, the sale is yours to close.`);
    }
    case 'ask_terms': {
      if (who.id !== actor.id) return fail(h.id === actor.id ? 'You hold that note: the terms are yours to give (extend_debt, forgive_debt).' : `That is ${who.name}'s note, not yours: its terms are between ${him(who)} and ${h.name}. The paper itself can be bought (buy_debt).`);
      const n = op.extend != null ? Math.round(num(op.extend, 1, 8, 4)) : 0, offer = op.offer != null ? num(op.offer, 0, 1e6, 0) : null, forgive = op.forgive === true;
      if (h.aiControlled) { say(w, h, actor.name, `${actor.name} asks your terms on note ${d.id} (${Math.round(d.owed)} owed to you, ${dueWords(d)})${n ? `: ${n} more quarter${n > 1 ? 's' : ''}` : ''}${offer != null ? `${n ? ', or' : ':'} ${r1(offer)} now in full discharge` : ''}${forgive ? `${n || offer != null ? ', or' : ':'} that it be forgotten` : ''}. Time is yours to give (extend_debt), and so is taking less or forgetting it (forgive_debt).`); return ok(`Your request has gone to ${h.name}, who holds the note; the answer is ${his(h)}.`); }
      const t = termsFor(w, d);
      if (offer != null) {
        // A figure he has named stands for half a year: whoever comes back with it is not told a higher one. (World 17: "he would take 212"; 212
        // was brought, and the answer was 224, and then the whole.)
        const named = d.quote && d.quote.by === h.id && w.turn - d.quote.turn <= 2 ? d.quote.floor : null, floor = named != null ? Math.min(t.floor, named) : t.floor;
        if (offer < floor) { const whole = floor >= d.owed - .5; if (!whole) d.quote = { floor, turn: named != null ? d.quote.turn : w.turn, by: h.id }; return fail(`${h.name} will not call ${Math.round(d.owed)} settled for ${r1(offer)}. ${whole ? `By ${his(h)} reckoning you can pay the whole, and ${he(h)} wants the whole.` : `${He(h)} would take ${floor} now in full discharge; the figure stands until ${quarterLabel(d.quote.turn + 2)}.`}`); }
        const m = Math.min(offer, d.owed); if (actor.wealth < m) return fail(`You have not got ${r1(m)}.`);
        actor.wealth -= m; h.wealth += m; d.status = 'paid'; d.settled = m; d.closedAt = w.turn; deal(w, h, actor, `Took ${r1(m)} from ${actor.name} in full discharge of note ${d.id}.`);
        return ok(`${h.name} took ${r1(m)} and note ${d.id} is discharged${m < d.owed - .5 ? `, ${r1(d.owed - m)} short of what was owed` : ''}.`);
      }
      if (n) {
        if (d.renewedAt === w.turn) return fail(`Note ${d.id} has been written out afresh this quarter; it stands at ${r1(d.owed)}, due ${quarterLabel(d.due)}.`);
        if (!t.time) return fail(`${h.name} has renewed note ${d.id} ${t.renewed} times and sees too little behind it: ${he(h)} gives no more time. ${t.floor < d.owed - .5 ? `${He(h)} would take ${t.floor} now and call it settled.` : `${He(h)} wants ${his(h)} money.`}`);
        const fee = r1(d.owed * t.rate * n); d.due = Math.max(d.due, w.turn) + n; d.owed = r1(d.owed + fee); d.status = 'open'; d.dunned = null; d.renewed = t.renewed + 1; d.renewedAt = w.turn; deal(w, h, actor, `Gave ${actor.name} until ${quarterLabel(d.due)} on note ${d.id}, for ${fee} added to it.`);
        return ok(`${h.name} gives you until ${quarterLabel(d.due)} on note ${d.id}. For the time ${he(h)} adds ${fee} to it: ${d.owed} is owed now. ${He(h)} has renewed it ${d.renewed} time${d.renewed > 1 ? 's' : ''}; after the third ${he(h)} gives time only to someone ${he(h)} can see is good for it.`);
      }
      if (forgive) {
        const hc = w.countries[h.country], o = h.post === 'house' && hc?.alive ? (w.offers || []).find(x => x.status === 'open' && x.forgive === d.id) ?? favourFor(w, hc, h, actor, d) : null;
        if (o) { deal(w, h, actor, `Named ${his(h)} price for forgetting note ${d.id}: offer ${o.id}.`); return ok(`${h.name} names what ${he(h)} would take in place of money: ${o.text}. It is offer ${o.id}; accept_offer takes it, and it stands for a year.`); }
        if (t.kin && d.owed <= Math.max(h.wealth, 0)) { d.status = 'forgiven'; d.closedAt = w.turn; deal(w, h, actor, `Forgave ${actor.name}, ${his(h)} own blood, the note ${d.id}.`); return ok(`${h.name} is of your blood and lets the note go: ${d.id} is forgiven.`); }
        return fail(`${h.name} sees nothing you could do for ${him(h)} that is worth the note. In money, ${t.floor >= d.owed - .5 ? `${he(h)} wants the whole` : `${he(h)} would take ${t.floor} now and call it settled`}.`);
      }
      return ok(`Note ${d.id}: you owe ${h.name} ${r1(d.owed)}, ${dueWords(d)}. ${termsWords(w, d)}${h.post === 'house' && ['leader', 'general'].includes(seatOf(w, actor)) ? `; and ${he(h)} has a favour in mind that ${he(h)} would take in place of money (ask with forgive)` : ''}.`);
    }
    case 'extend_debt': {
      if (h.id !== actor.id) return fail('That note is not yours to give time on.');
      const n = Math.round(num(op.turns ?? op.extend, 1, 40, 4)), fee = Math.min(num(op.fee, 0, 1e6, 0), d.owed * .08 * n);
      d.due = Math.max(d.due, w.turn) + n; d.owed = r1(d.owed + fee); d.status = 'open'; d.dunned = null; d.renewed = (d.renewed || 0) + 1;
      say(w, who, actor.name, `${actor.name} gives you until ${quarterLabel(d.due)} on note ${d.id}${fee > 0 ? `, and adds ${r1(fee)} to it for the time: ${d.owed} is owed now` : ''}.`);
      return ok(`${who.name} has until ${quarterLabel(d.due)} on note ${d.id}; ${d.owed} is owed${op.fee != null && fee < num(op.fee, 0, 1e6, 0) - .01 ? ` (the law lets a holder add no more than ${r1(fee)} for that much time)` : ''}.`);
    }
    case 'call_debt': {
      if (h.id !== actor.id) return fail('That note is not yours to call in.');
      if (d.status !== 'overdue') return fail(`Note ${d.id} is not due before ${quarterLabel(d.due)}; until then no court will touch it.`);
      const home = w.countries[who.country];
      if (home?.alive && home.leader === who.id && home.courts < 35) return fail(`No court in ${home.name} hears a suit against the head of the state while the bench is the government's creature. The note stays a hold, and a paper that can be shown.`);
      if (d.called != null && w.turn - d.called < 4) return fail(`The bailiffs have been to ${who.name} for note ${d.id} within the year; what was left is still owed.`);
      const took = seize(w, d, actor); d.called = w.turn; d.owed = r1(d.owed - took); if (d.owed < .5) { d.status = 'paid'; d.closedAt = w.turn; }
      say(w, who, 'The bailiffs', `${actor.name} has called in note ${d.id} through the court. ${r1(took)} was taken from what you have at home${live(d) ? `; ${d.owed} is still owed` : ', and the note is discharged'}. The town knows.`);
      return ok(`The court gave you what could be found: ${r1(took)} was taken from ${who.name}${live(d) ? `, and ${d.owed} is still owed on the note` : ', and the note is discharged'}. It was done in the open, and ${who.name}'s name is the worse for it.`);
    }
  }
  return fail('Invalid operation.');
}
