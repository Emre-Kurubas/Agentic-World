// Private contracts between characters. Payments and deliveries execute by themselves; what to do about a breach is the parties' affair.
import { nextId } from './util.js';
import { GOODS, GOOD_LABEL } from './world.js';
import { governs } from './polity.js';
import { treasuryPays } from './money.js';
import { STATE } from './firms.js';

const open = k => k.status === 'active';
const say = (w, ch, from, text) => { if (ch?.alive) ch.inbox.push({ turn: w.turn, from, text }); };
// Whoever governs may sign for the state. Then the treasury, not their own purse, pays and is paid, and it is the state's works that deliver.
// k.purse names the country standing behind a party; it stays behind the contract if the signer later falls from office.
export const stateOf = (w, k, ch) => { const c = w.countries[k.purse?.[ch?.id]]; return c?.alive ? c : null; };
const signsForState = (w, actor, flag) => { const c = w.countries[actor.country]; return flag === true && c?.alive && governs(w, c, actor) ? c : null; };
const works = (w, k) => { const sc = stateOf(w, k, w.characters[k.seller]); return Object.values(w.firms || {}).filter(f => f.status === 'open' && (sc ? f.owner === STATE && f.country === sc.id : f.owner === k.seller) && (f.sector === k.good || f.resource === k.good)); };
const sellerFirm = (w, k) => works(w, k)[0];
// Small quantities are written as they are: a tenth of a unit is not 'none'.
// A bargain struck "at the price of the day": the buyer pays each quarter what the goods delivered cost that day, on the world's exchanges
// or on the buyer's own market. (World 19: "army boots at the home market price" and "iron at the world price" could only be written as
// papers under which no money moved; a ruler took hers back and named sixty a unit by guess.)
const DAY = { world: 'world', exchange: 'world', exchanges: 'world', home: 'home', market: 'home', day: 'home', ordinary: 'home', going: 'home', current: 'home' };
export const dayOf = op => DAY[String(op.price ?? (typeof op.unit_price === 'string' && !(Number(op.unit_price) > 0) ? op.unit_price : '')).trim().toLowerCase().split(/[^a-z]+/)[0]] ?? null;
export function priceOfDay(w, k) {
  if (!k.at || !k.good) return null;
  const buyer = w.characters[k.seller === k.a ? k.b : k.a], to = stateOf(w, k, buyer) ?? w.countries[buyer?.country]; if (!to) return null;
  return (k.at === 'home' ? to.prices?.[k.good] ?? (w.globalPrice?.[k.good] ?? 0) * (to.rer ?? 1) : w.globalPrice?.[k.good] ?? 0) * (to.rate || 1);
}
export const dayWords = k => k.at === 'home' ? 'the price of the day on the buyer\'s home market' : 'the price of the day on the world\'s exchanges';
export const few = v => v >= 10 ? Math.round(v) : v >= 1 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100;

export function proposeContract(w, actor, op, num) {
  const named = String(op.to ?? '').toLowerCase(), other = w.characters[op.to] ?? w.characters[w.countries[op.to]?.leader] ?? Object.values(w.characters).find(x => x.alive && x.name.toLowerCase() === named);
  if (!other?.alive || other.id === actor.id) return null;
  const hasGoods = GOODS.includes(op.good);
  // A new offer to the same person replaces the one still lying unanswered on their desk.
  for (const old of w.contracts || []) if (old.status === 'proposed' && old.a === actor.id && old.b === other.id) { old.status = 'withdrawn'; old.closedAt = w.turn; }
  const k = { id: nextId(w, 'CT'), a: actor.id, b: other.id, terms: String(op.terms || '').slice(0, 1500), payer: op.payer === 'them' ? other.id : op.payer === 'none' ? null : actor.id, pay: op.pay_per_turn != null ? num(op.pay_per_turn, 0, 1e6, 0) : hasGoods && op.unit_price != null ? num(op.unit_price, 0, 1e5, 0) * num(op.amount, 0, 1e5, 0) : 0, good: hasGoods ? op.good : null, amount: hasGoods ? num(op.amount, 0, 1e5, 0) : 0, seller: hasGoods ? (op.seller === 'them' ? other.id : actor.id) : null, turns: Math.round(num(op.turns, 1, 80, 8)), status: 'proposed', turn: w.turn };
  const sc = signsForState(w, actor, op.state); if (sc) k.purse = { [actor.id]: sc.id };
  // To whom it is addressed. An offer of goods laid before whoever governs is laid before the state: no ruler clothes an army out of his own
  // pocket. It is the treasury's paper unless the one who wrote it says it is for the person (to_state:false), or the one who signs says so
  // (accept_contract with state:false). A payment with no goods behind it is addressed to the person unless it says otherwise.
  // (World 18: some twenty-five offers that said 'the treasury pays' were read as charged to the ruler's own purse; rulers declined them,
  // owners apologised five times for clerks who had made no mistake, and an army waited three quarters for its cloth.)
  const theirs = w.countries[other.country]; if (theirs?.alive && governs(w, theirs, other) && op.to_state !== false && (hasGoods && k.amount > 0 || op.to_state === true)) k.toState = theirs.id;
  { const at = dayOf(op); if (hasGoods && k.amount > 0 && at && op.pay_per_turn == null && !(Number(op.unit_price) > 0)) { k.at = at; if (!k.payer || k.payer === k.seller) k.payer = k.seller === actor.id ? other.id : actor.id; k.pay = (priceOfDay(w, k) ?? 0) * k.amount; } }
  (w.contracts ||= []).push(k);
  say(w, other, actor.name, `Contract offer ${k.id}${sc ? `, made for the state of ${sc.name} and on its treasury's account` : ''}: ${k.terms}${k.at ? ` Payment at ${dayWords(k)} for what is delivered (about ${Math.round(k.pay)} a quarter as prices stand).` : k.pay ? ` Payment ${Math.round(k.pay)} per quarter.` : ''}${k.good ? ` Delivery ${few(k.amount)} ${GOOD_LABEL[k.good]} per quarter, from the quarter after it is signed.` : ''} Runs ${k.turns} quarters. Accept with accept_contract.${k.toState ? ` It is laid before the state of ${theirs.name}: signed by you as it stands, the treasury pays and is paid and the state's own works deliver; to take it on your own purse instead, sign with state:false.` : !sc && w.countries[other.country]?.leader === other.id && !k.purse?.[other.id] ? ' It is addressed to you in person: signed as it stands, what you owe under it comes from your own purse; signed for the state (accept_contract with state:true), the treasury pays and is paid and the state\'s own works deliver.' : ''}`);
  return k;
}

// Offers waiting for this person's answer.
export const offersFor = (w, ch) => (w.contracts || []).filter(x => x.status === 'proposed' && x.b === ch.id);
const OFFER_LIFE = 8;

// By number if one is given; otherwise the offer from the named person, or the only one waiting.
export function acceptContract(w, actor, id, from, forState) {
  const waiting = offersFor(w, actor), sender = w.characters[from]?.id ?? w.countries[from]?.leader, bySender = sender ? waiting.filter(x => x.a === sender) : waiting;
  // A paper named by its number is that paper or none: where it is not waiting, nothing else is signed in its place. (World 18: three
  // signatures given for a paper that had been withdrawn went to the only other paper on the table, and two governments believed for
  // years in contracts that had never been made.)
  const named = /^CT\d+$/i.test(String(id ?? '').trim());
  const k = named ? waiting.find(x => x.id.toLowerCase() === String(id).trim().toLowerCase()) : bySender.length === 1 ? bySender[0] : null; if (!k) return null;
  const sc = signsForState(w, actor, forState === false ? false : forState === true || k.toState === actor.country); if (sc) (k.purse ||= {})[actor.id] = sc.id;
  // Goods move and money is paid from the quarter after the signature: nobody delivers on the day the ink dries.
  k.status = 'active'; k.signed = w.turn; k.until = w.turn + k.turns + 1; say(w, w.characters[k.a], actor.name, `Contract ${k.id} accepted${sc ? ` for the state of ${sc.name}, on its treasury's account` : ''}.`);
  return k;
}

// Whoever governs can put their own side of a contract they signed, or an offer they made, on the state's account afterwards.
export function toStateAccount(w, actor, id) {
  const k = (w.contracts || []).find(x => x.id === id && [x.a, x.b].includes(actor.id) && (open(x) || x.status === 'proposed')), sc = k && signsForState(w, actor, true); if (!sc || k.purse?.[actor.id]) return null;
  (k.purse ||= {})[actor.id] = sc.id; say(w, w.characters[k.a === actor.id ? k.b : k.a], actor.name, `Contract ${k.id}: ${actor.name}'s side now stands on the account of the treasury of ${sc.name}.`);
  return k;
}

function breach(w, k, who, text) {
  if (w.turn - (k.lastBreach ?? -99) < 4) return;
  k.lastBreach = w.turn; (k.breaches ||= []).push({ turn: w.turn, who, text });
  for (const id of [k.a, k.b]) say(w, w.characters[id], 'Notary', `Contract ${k.id} breached: ${text}`);
}

export function contractStep(w) {
  for (const k of w.contracts ||= []) {
    if (k.status === 'proposed' && w.turn - k.turn > OFFER_LIFE) { k.status = 'lapsed'; k.closedAt = w.turn; say(w, w.characters[k.a], 'Notary', `Your contract offer ${k.id} went unanswered and has lapsed.`); }
    if (!open(k)) continue;
    const A = w.characters[k.a], B = w.characters[k.b];
    if (!A?.alive || !B?.alive) { k.status = 'void'; k.closedAt = w.turn; continue; }
    if (w.turn >= k.until) { k.status = 'finished'; k.closedAt = w.turn; continue; }
    if (k.signed === w.turn) continue;
    // Goods first: the buyer pays for what was delivered, not for what was promised.
    let part = 1;
    if (k.good && k.amount > 0) {
      const seller = w.characters[k.seller], buyer = k.seller === k.a ? B : A, sc = stateOf(w, k, seller), from = sc ?? w.countries[seller.country], to = stateOf(w, k, buyer) ?? w.countries[buyer.country];
      const route = from.id === to.id ? { cost: 1 } : w.routes[from.id < to.id ? `${from.id}|${to.id}` : `${to.id}|${from.id}`];
      let q = 0, why = '';
      if (!route) why = `No route is open between ${from.name} and ${to.name}; nothing could be delivered.`;
      // A state sells out of the country's stores, whatever raised them. A private seller delivers what his own works turn out, and no more.
      else if (sc) { q = Math.min(Math.max(from.stock[k.good] || 0, 0), k.amount); why = `The stores of ${from.name} held only ${few(q)} of the ${few(k.amount)} ${GOOD_LABEL[k.good]} due.`; }
      else if (!sellerFirm(w, k)) why = `${seller.name} owns no works producing ${GOOD_LABEL[k.good]}; nothing was delivered.`;
      else { const output = works(w, k).filter(f => f.country === from.id).reduce((a, f) => a + (f.lastUnits || 0), 0); q = Math.min(Math.max(from.stock[k.good] || 0, 0), k.amount, output); why = `${seller.name}'s works delivered ${few(q)} of the ${few(k.amount)} ${GOOD_LABEL[k.good]} due.`; }
      if (q > 0) { from.stock[k.good] -= q; to.stock[k.good] = (to.stock[k.good] || 0) + q / route.cost; }
      part = q / k.amount; k.lastDelivered = q;
      if (q < k.amount * .95 && few(q) < few(k.amount)) breach(w, k, seller.id, why);
    }
    if (k.at) { const p = priceOfDay(w, k); if (p != null) k.pay = p * k.amount; }
    if (k.pay > 0 && k.payer) {
      const payer = w.characters[k.payer], payee = k.payer === k.a ? B : A, from = stateOf(w, k, payer), to = stateOf(w, k, payee);
      // Payment for goods follows the goods. Money a treasury pays a private person for nothing that can be weighed is a grant under another name:
      // it comes out of the same allowance as any other payment to persons, it is in the books, and both know what it was.
      // A price far above the market is a grant in a merchant's coat: what a treasury pays a private seller beyond three times the world price of what was delivered counts as one.
      const forGoods = k.good && k.amount > 0 && k.payer !== k.seller, due = k.pay * (forGoods ? Math.min(part, 1) : 1), fair = forGoods ? (k.lastDelivered || 0) * (w.globalPrice?.[k.good] ?? 0) * 3 * (from?.rate || 1) : 0;
      const gifted = from && !to ? Math.max(0, due - fair) : 0, gift = gifted > .01;
      const room = gift ? Math.max(0, from.gdp * .005 - (from._grants?.turn === w.turn ? from._grants.paid : 0)) : Infinity;
      const m = from ? treasuryPays(from, due - gifted + Math.min(gifted, room)) : Math.min(payer.wealth, due), given = Math.max(0, m - (due - gifted));
      // What a treasury pays for goods under a contract is in its books, like every other payment outside the budget.
      if (from && m - given > 0) (from._outlay ||= {}).contracts = (from._outlay.contracts || 0) + m - given;
      if (gift && given > 0) { from._grants = { turn: w.turn, paid: (from._grants?.turn === w.turn ? from._grants.paid : 0) + given }; (from._outlay ||= {}).persons = (from._outlay.persons || 0) + given; if (given >= from.gdp * .001 && !k.onRecord) { k.onRecord = true; for (const x of [payer, payee]) { (x.secrets ||= []).push({ turn: w.turn, text: `${payee.name} draws ${Math.round(k.pay)} a quarter from the treasury of ${from.name} under a private contract signed by ${payer.name}.` }); x.secrets = x.secrets.slice(-12); } } }
      if (!from) payer.wealth -= m; if (to) to.treasury += m; else payee.wealth += m;
      if (m < due * .95) breach(w, k, payer.id, from ? (gift && room < gifted ? `The treasury of ${from.name} pays out only so much to private persons in a quarter beyond the worth of what it receives; ${Math.round(m * 10) / 10} of the ${Math.round(due * 10) / 10} due was paid.` : `The treasury of ${from.name} could not pay in full.`) : `${payer.name} could not pay in full.`);
    }
  }
  w.contracts = w.contracts.filter(k => ['proposed', 'active'].includes(k.status) ? w.turn - k.turn <= 120 : w.turn - (k.closedAt ?? w.turn) <= 40);
}

// Walking away from a contract in force, refusing an offer that is waiting, or taking back one's own offer. Returns what happened in words, or null.
export function cancelContract(w, actor, id, from) {
  // A contract is its parties' to end; one signed for the state is also the business of whoever governs that state now.
  const c = w.countries[actor.country], rules = c?.alive && governs(w, c, actor), sideOf = x => [x.a, x.b].includes(actor.id) ? actor.id : rules ? Object.keys(x.purse || {}).find(id => x.purse[id] === c.id) : null;
  const mine = (w.contracts || []).filter(x => sideOf(x) && (open(x) || x.status === 'proposed')), sender = w.characters[from]?.id ?? w.countries[from]?.leader;
  const withThem = sender ? mine.filter(x => [x.a, x.b].includes(sender)) : [], k = mine.find(x => x.id === id) ?? (withThem.length === 1 ? withThem[0] : null); if (!k) return null;
  const side = sideOf(k), other = w.characters[k.a === side ? k.b : k.a], was = k.status; k.closedAt = w.turn;
  if (was === 'active') { k.status = 'cancelled'; say(w, other, actor.name, `${actor.name} walked away from contract ${k.id}.`); return `Contract ${k.id} is ended.`; }
  if (k.b === side) { k.status = 'declined'; say(w, other, actor.name, `${actor.name} declined your contract offer ${k.id}.`); return `Offer ${k.id} was declined.`; }
  k.status = 'withdrawn'; say(w, other, actor.name, `${actor.name} withdrew contract offer ${k.id}.`); return `Offer ${k.id} was withdrawn.`;
}
