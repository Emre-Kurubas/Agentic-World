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

export function proposeContract(w, actor, op, num) {
  const named = String(op.to ?? '').toLowerCase(), other = w.characters[op.to] ?? w.characters[w.countries[op.to]?.leader] ?? Object.values(w.characters).find(x => x.alive && x.name.toLowerCase() === named);
  if (!other?.alive || other.id === actor.id) return null;
  const hasGoods = GOODS.includes(op.good);
  // A new offer to the same person replaces the one still lying unanswered on their desk.
  for (const old of w.contracts || []) if (old.status === 'proposed' && old.a === actor.id && old.b === other.id) { old.status = 'withdrawn'; old.closedAt = w.turn; }
  const k = { id: nextId(w, 'CT'), a: actor.id, b: other.id, terms: String(op.terms || '').slice(0, 400), payer: op.payer === 'them' ? other.id : op.payer === 'none' ? null : actor.id, pay: num(op.pay_per_turn, 0, 1e6, 0), good: hasGoods ? op.good : null, amount: hasGoods ? num(op.amount, 0, 1e5, 0) : 0, seller: hasGoods ? (op.seller === 'them' ? other.id : actor.id) : null, turns: Math.round(num(op.turns, 1, 80, 8)), status: 'proposed', turn: w.turn };
  const sc = signsForState(w, actor, op.state); if (sc) k.purse = { [actor.id]: sc.id };
  (w.contracts ||= []).push(k);
  say(w, other, actor.name, `Contract offer ${k.id}${sc ? `, made for the state of ${sc.name} and on its treasury's account` : ''}: ${k.terms}${k.pay ? ` Payment ${Math.round(k.pay)} per quarter.` : ''}${k.good ? ` Delivery ${Math.round(k.amount)} ${GOOD_LABEL[k.good]} per quarter.` : ''} Runs ${k.turns} quarters. Accept with accept_contract.`);
  return k;
}

// Offers waiting for this person's answer.
export const offersFor = (w, ch) => (w.contracts || []).filter(x => x.status === 'proposed' && x.b === ch.id);
const OFFER_LIFE = 8;

// By number if one is given; otherwise the offer from the named person, or the only one waiting.
export function acceptContract(w, actor, id, from, forState) {
  const waiting = offersFor(w, actor), sender = w.characters[from]?.id ?? w.countries[from]?.leader, bySender = sender ? waiting.filter(x => x.a === sender) : waiting;
  const k = waiting.find(x => x.id === id) ?? (bySender.length === 1 ? bySender[0] : null); if (!k) return null;
  const sc = signsForState(w, actor, forState); if (sc) (k.purse ||= {})[actor.id] = sc.id;
  k.status = 'active'; k.until = w.turn + k.turns; say(w, w.characters[k.a], actor.name, `Contract ${k.id} accepted${sc ? ` for the state of ${sc.name}, on its treasury's account` : ''}.`);
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
    if (k.pay > 0 && k.payer) {
      const payer = w.characters[k.payer], payee = k.payer === k.a ? B : A, from = stateOf(w, k, payer), to = stateOf(w, k, payee);
      const m = from ? treasuryPays(from, k.pay) : Math.min(payer.wealth, k.pay);
      if (!from) payer.wealth -= m; if (to) to.treasury += m; else payee.wealth += m;
      if (m < k.pay * .95) breach(w, k, payer.id, from ? `The treasury of ${from.name} could not pay in full.` : `${payer.name} could not pay in full.`);
    }
    if (k.good && k.amount > 0) {
      const seller = w.characters[k.seller], buyer = k.seller === k.a ? B : A, from = w.countries[seller.country], to = w.countries[buyer.country];
      if (!sellerFirm(w, k)) { breach(w, k, seller.id, stateOf(w, k, seller) ? `The state of ${from.name} has no works of its own producing ${GOOD_LABEL[k.good]}.` : `${seller.name} no longer owns a company producing ${GOOD_LABEL[k.good]}.`); continue; }
      const route = from.id === to.id ? { cost: 1 } : w.routes[from.id < to.id ? `${from.id}|${to.id}` : `${to.id}|${from.id}`];
      if (!route) continue;
      // A seller delivers what their own works turn out, not the country's stores.
      const output = works(w, k).filter(f => f.country === from.id).reduce((a, f) => a + (f.lastUnits || 0), 0);
      const q = Math.min(from.stock[k.good] || 0, k.amount, output);
      from.stock[k.good] -= q; to.stock[k.good] = (to.stock[k.good] || 0) + q / route.cost;
      if (q < k.amount * .95) breach(w, k, seller.id, `${seller.name} delivered short on ${GOOD_LABEL[k.good]}.`);
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
