// Open tender: the state says what it wants to buy, the owners of works answer with sealed prices, and the lowest takes the contract.
//
// World 16: "all army supply goes to open tender", "invite competing bids from at least two other houses" were ordered about fifteen times; a
// contract could only be offered to one named person, so there was nothing to bid on, and two foreign magnates who tried to bid on what a
// government had called its open tender were told that no such offer was waiting for them.
import { nextId, news, quarterLabel } from './util.js';
import { GOODS, GOOD_LABEL, aliveCountries } from './world.js';
import { governs } from './polity.js';
import { isOpen, STATE } from './firms.js';

export const TENDER_OPS = new Set(['tender', 'bid', 'award_tender']);
const say = (w, ch, from, text) => { if (ch?.alive) ch.inbox.push({ turn: w.turn, from, text }); };
const r1 = v => Math.round(v * 10) / 10, makes = f => f.sector === 'mine' ? f.resource : f.sector;
const own = (o, k) => !!o && typeof k === 'string' && Object.hasOwn(o, k);
// Whose works could deliver it: the owners, at home or (where the tender is open to all) anywhere.
const houses = (w, t) => { const out = new Map(); for (const f of Object.values(w.firms || {})) { if (!isOpen(f) || makes(f) !== t.good || f.owner === STATE || (!t.all && f.country !== t.country)) continue; const o = w.characters[f.owner]; if (o?.alive && o.status === 'free' && !out.has(o.id)) out.set(o.id, f); } return out; };
const find = (w, id, c) => (w.tenders || []).find(t => t.id === id) ?? ((w.tenders || []).filter(t => t.country === c.id).length === 1 && id == null ? (w.tenders || []).find(t => t.country === c.id) : null);

export function tenderOp(w, actor, c, op, h) {
  const { fail, num } = h, state = governs(w, c, actor);
  switch (op.op) {
    case 'tender': {
      if (!state && c.general !== actor.id) return fail('The state\'s buying is put to tender by whoever governs, or by the chief of staff for the army\'s stores.');
      if (!GOODS.includes(op.good)) return fail(`Say what is to be bought (good): one of ${GOODS.join(', ')}.`);
      const amount = num(op.amount, 0, 1e5, 0), turns = Math.round(num(op.quarters ?? op.turns, 1, 12, 4)); if (!(amount > 0)) return fail('Say how much is wanted each quarter (amount).');
      const open = (w.tenders ||= []).filter(t => t.country === c.id); if (open.length >= 4) return fail('Four tenders of this state are open already; they close at the end of next quarter.');
      const t = { id: nextId(w, 'TN'), country: c.id, by: actor.id, good: op.good, amount, turns, max: op.max_price != null ? num(op.max_price, 0, 1e6, 0) : null, all: op.open === 'all' || op.foreign === true, closes: w.turn + 1, bids: [], terms: String(op.terms ?? '').slice(0, 300) };
      w.tenders.push(t); const told = houses(w, t);
      for (const [id] of told) say(w, w.characters[id], c.name, `The government of ${c.name} invites tenders (${t.id}): ${r1(amount)} of ${GOOD_LABEL[t.good]} a quarter for ${turns} quarters${t.max ? `, at no more than ${r1(t.max)} a unit` : ''}${t.terms ? `; ${t.terms}` : ''}. Sealed prices are opened in ${quarterLabel(t.closes)} and the lowest takes the contract: name your price a unit (bid). It sells for about ${r1(w.globalPrice[t.good] ?? 0)} on the exchanges today.`);
      news(w, `${c.name}: the government invites tenders for ${r1(amount)} of ${GOOD_LABEL[t.good]} a quarter for ${turns} quarters${t.all ? ', from houses of any country' : ''}.`, { kind: 'economy', countries: [c.id] });
      return { ok: true, msg: `Tender ${t.id} is published: ${r1(amount)} of ${GOOD_LABEL[t.good]} a quarter for ${turns} quarters${t.max ? `, at no more than ${r1(t.max)} a unit` : ''}. ${told.size} house${told.size === 1 ? '' : 's'} with works that make it ${told.size === 1 ? 'has' : 'have'} been told${t.all ? ', at home and abroad' : ''}. Sealed prices are opened in ${quarterLabel(t.closes)}; the lowest takes the contract, which the treasury pays quarter by quarter for what is delivered. To give it to a named house whatever the prices, say so before then (award_tender): that is a favour, and leaves its trace.` };
    }
    case 'bid': {
      const t = (w.tenders || []).find(x => x.id === op.tender || x.id === op.id) ?? ((w.tenders || []).filter(x => houses(w, x).has(actor.id)).length === 1 && op.tender == null && op.id == null ? (w.tenders || []).find(x => houses(w, x).has(actor.id)) : null); if (!t) return fail(`No such tender is open.${(w.tenders || []).length ? ` Open: ${w.tenders.map(x => `${x.id} (${w.countries[x.country]?.name}, ${GOOD_LABEL[x.good]})`).join(', ')}.` : ''}`);
      if (!houses(w, t).has(actor.id)) return fail(`A tender is answered by somebody who owns a works making ${GOOD_LABEL[t.good]}${t.all ? '' : ` in ${w.countries[t.country]?.name}`}: you own none.`);
      const price = num(op.price, 0, 1e6, 0); if (!(price > 0)) return fail('Name your price a unit (price).');
      const had = t.bids.find(b => b.by === actor.id); if (had) had.price = price; else t.bids.push({ by: actor.id, price });
      return { ok: true, msg: `Your price of ${r1(price)} a unit lies sealed with tender ${t.id} (the exchanges quote about ${r1(w.globalPrice[t.good] ?? 0)}). It is opened in ${quarterLabel(t.closes)}.${t.max && price > t.max ? ` It is above the ${r1(t.max)} the government said it would pay.` : ''}` };
    }
    case 'award_tender': {
      if (!state) return fail('A tender is the government\'s to award.'); const t = find(w, op.tender ?? op.id, c); if (!t || t.country !== c.id) return fail('No such tender of ours is open.');
      const to = own(w.characters, op.to) ? w.characters[op.to] : Object.values(w.characters).find(x => x.alive && x.name.toLowerCase() === String(op.to ?? '').toLowerCase()); if (!to?.alive || !houses(w, t).has(to.id)) return fail(`Name a house that could deliver it: somebody who owns a works making ${GOOD_LABEL[t.good]}.`);
      t.favour = to.id; t.favourBy = actor.id;
      return { ok: true, msg: `Tender ${t.id} will go to ${to.name} when the prices are opened, whatever they are, at the price ${to.name} names (or the day's price if none is named). If a lower price lay on the table, that it was passed over is something to be found out, by an inquiry or by the house that lost.` };
    }
  }
  return fail('Unknown tender operation.');
}

// Prices are opened once the quarter's orders are in.
export function tenderStep(w) {
  const list = w.tenders || []; if (!list.length) return;
  for (const t of [...list]) { if (t.closes > w.turn) continue; list.splice(list.indexOf(t), 1);
    const c = w.countries[t.country], ruler = w.characters[c?.leader], by = w.characters[t.by]; if (!c?.alive || !ruler?.alive) continue;
    // Houses nobody plays name a price of their own: the day's price and a margin that is the smaller the hungrier the house.
    const day = w.globalPrice[t.good] ?? 1; for (const [id, f] of houses(w, t)) { const o = w.characters[id]; if (o.aiControlled || t.bids.some(b => b.by === id)) continue; t.bids.push({ by: id, price: day * (1.04 + ((o.greed ?? 50) / 100) * .16) * (f.country === t.country ? 1 : 1.05) }); }
    const live = t.bids.filter(b => houses(w, t).has(b.by)).sort((a, b) => a.price - b.price), under = live.filter(b => !t.max || b.price <= t.max + 1e-9), fav = t.favour && houses(w, t).has(t.favour) ? live.find(b => b.by === t.favour) ?? { by: t.favour, price: day } : null, win = fav ?? under[0];
    const table = live.length ? live.map(b => `${w.characters[b.by].name} ${r1(b.price)}`).join(', ') : 'none';
    if (!win) { for (const x of new Set([ruler, by])) say(w, x, 'The treasury', `Tender ${t.id} (${r1(t.amount)} of ${GOOD_LABEL[t.good]} a quarter) closed without a contract: ${live.length ? `the prices offered (${table}) were all above the ${r1(t.max)} named` : 'no house answered it'}.`); continue; }
    const seller = w.characters[win.by], k = { id: nextId(w, 'CT'), a: ruler.id, b: seller.id, terms: `By tender ${t.id}: ${r1(t.amount)} of ${GOOD_LABEL[t.good]} a quarter at ${r1(win.price)} a unit${t.terms ? `; ${t.terms}` : ''}.`, payer: ruler.id, pay: win.price * t.amount, good: t.good, amount: t.amount, seller: seller.id, turns: t.turns, status: 'active', turn: w.turn, since: w.turn, until: w.turn + t.turns, purse: { [ruler.id]: c.id }, tender: t.id };
    (w.contracts ||= []).push(k);
    // A contract given past a lower price is a favour: it is in the books of both for whoever looks.
    const passed = fav && live.some(b => b.by !== fav.by && b.price < win.price - 1e-9) ? live.find(b => b.by !== fav.by && b.price < win.price - 1e-9) : null;
    if (passed) { const giver = w.characters[t.favourBy] ?? ruler; for (const [x, text] of [[giver, `Gave the contract of tender ${t.id} to ${seller.name} at ${r1(win.price)} though ${w.characters[passed.by].name} had offered ${r1(passed.price)}.`], [seller, `Was given the contract of tender ${t.id} at ${r1(win.price)} over a lower price, by ${giver.name}'s order.`]]) { (x.secrets ||= []).push({ turn: w.turn, text }); x.secrets = x.secrets.slice(-12); } say(w, w.characters[passed.by], 'Your counting-house', `Tender ${t.id} went to ${seller.name} at ${r1(win.price)} a unit. Your price was ${r1(passed.price)}. Somebody wanted it so.`); }
    for (const x of new Set([ruler, by])) say(w, x, 'The treasury', `Tender ${t.id} is closed. Prices offered: ${table}. The contract (${k.id}) goes to ${seller.name} at ${r1(win.price)} a unit: about ${r1(k.pay)} a quarter for ${t.turns} quarters, paid for what is delivered.${passed ? ' A lower price was passed over on your order.' : ''}`);
    say(w, seller, c.name, `Your house has the contract of tender ${t.id} (${k.id}): ${r1(t.amount)} of ${GOOD_LABEL[t.good]} a quarter for ${t.turns} quarters at ${r1(win.price)} a unit, delivered from your own works and paid by the treasury of ${c.name} for what arrives.`);
    for (const b of live) if (b.by !== seller.id && b.by !== passed?.by) say(w, w.characters[b.by], 'Your counting-house', `Tender ${t.id} went to ${seller.name} at ${r1(win.price)} a unit; your price was ${r1(b.price)}.`);
    news(w, `${c.name}: the tender for ${GOOD_LABEL[t.good]} went to the house of ${seller.name}, of ${live.length} that offered.`, { kind: 'economy', countries: [c.id, seller.country] }); }
}
export const tenderWords = (w, ch) => { const c = w.countries[ch.country], out = []; for (const t of w.tenders || []) { const mine = t.bids.find(b => b.by === ch.id);
  if (c && t.country === c.id && (governs(w, c, ch) || t.by === ch.id)) out.push(`Tender ${t.id} is open: ${r1(t.amount)} of ${GOOD_LABEL[t.good]} a quarter for ${t.turns} quarters; prices are opened in ${quarterLabel(t.closes)}${t.favour ? `; it is to go to ${w.characters[t.favour]?.name}` : ''}.`);
  else if (mine) out.push(`Your sealed price on tender ${t.id} of ${w.countries[t.country]?.name}: ${r1(mine.price)} a unit of ${GOOD_LABEL[t.good]}; opened in ${quarterLabel(t.closes)}.`);
  else if (houses(w, t).has(ch.id)) out.push(`Tender ${t.id} of ${w.countries[t.country]?.name} is open to you: ${r1(t.amount)} of ${GOOD_LABEL[t.good]} a quarter for ${t.turns} quarters; prices (bid) are opened in ${quarterLabel(t.closes)}.`); } return out; };
