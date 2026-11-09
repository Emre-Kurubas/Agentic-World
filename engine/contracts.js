// Private contracts between characters. Payments and deliveries execute by themselves; what to do about a breach is the parties' affair.
import { nextId } from './util.js';
import { GOODS, GOOD_LABEL } from './world.js';

const open = k => k.status === 'active';
const say = (w, ch, from, text) => { if (ch?.alive) ch.inbox.push({ turn: w.turn, from, text }); };
const sellerFirm = (w, k) => Object.values(w.firms || {}).find(f => f.status === 'open' && f.owner === k.seller && (f.sector === k.good || f.resource === k.good));

export function proposeContract(w, actor, op, num) {
  const named = String(op.to ?? '').toLowerCase(), other = w.characters[op.to] ?? w.characters[w.countries[op.to]?.leader] ?? Object.values(w.characters).find(x => x.alive && x.name.toLowerCase() === named);
  if (!other?.alive || other.id === actor.id) return null;
  const hasGoods = GOODS.includes(op.good);
  // A new offer to the same person replaces the one still lying unanswered on their desk.
  for (const old of w.contracts || []) if (old.status === 'proposed' && old.a === actor.id && old.b === other.id) { old.status = 'withdrawn'; old.closedAt = w.turn; }
  const k = { id: nextId(w, 'CT'), a: actor.id, b: other.id, terms: String(op.terms || '').slice(0, 400), payer: op.payer === 'them' ? other.id : op.payer === 'none' ? null : actor.id, pay: num(op.pay_per_turn, 0, 1e6, 0), good: hasGoods ? op.good : null, amount: hasGoods ? num(op.amount, 0, 1e5, 0) : 0, seller: hasGoods ? (op.seller === 'them' ? other.id : actor.id) : null, turns: Math.round(num(op.turns, 1, 80, 8)), status: 'proposed', turn: w.turn };
  (w.contracts ||= []).push(k);
  say(w, other, actor.name, `Contract offer ${k.id}: ${k.terms}${k.pay ? ` Payment ${Math.round(k.pay)} per quarter.` : ''}${k.good ? ` Delivery ${Math.round(k.amount)} ${GOOD_LABEL[k.good]} per quarter.` : ''} Runs ${k.turns} quarters. Accept with accept_contract.`);
  return k;
}

// Offers waiting for this person's answer.
export const offersFor = (w, ch) => (w.contracts || []).filter(x => x.status === 'proposed' && x.b === ch.id);
const OFFER_LIFE = 8;

// By number if one is given; otherwise the offer from the named person, or the only one waiting.
export function acceptContract(w, actor, id, from) {
  const waiting = offersFor(w, actor), sender = w.characters[from]?.id ?? w.countries[from]?.leader, bySender = sender ? waiting.filter(x => x.a === sender) : waiting;
  const k = waiting.find(x => x.id === id) ?? (bySender.length === 1 ? bySender[0] : null); if (!k) return null;
  k.status = 'active'; k.until = w.turn + k.turns; say(w, w.characters[k.a], actor.name, `Contract ${k.id} accepted.`);
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
      const payer = w.characters[k.payer], payee = k.payer === k.a ? B : A, m = Math.min(payer.wealth, k.pay);
      payer.wealth -= m; payee.wealth += m;
      if (m < k.pay * .95) breach(w, k, payer.id, `${payer.name} could not pay in full.`);
    }
    if (k.good && k.amount > 0) {
      const seller = w.characters[k.seller], buyer = k.seller === k.a ? B : A, from = w.countries[seller.country], to = w.countries[buyer.country];
      if (!sellerFirm(w, k)) { breach(w, k, seller.id, `${seller.name} no longer owns a company producing ${GOOD_LABEL[k.good]}.`); continue; }
      const route = from.id === to.id ? { cost: 1 } : w.routes[from.id < to.id ? `${from.id}|${to.id}` : `${to.id}|${from.id}`];
      if (!route) continue;
      // A seller delivers what their own works turn out, not the country's stores.
      const output = Object.values(w.firms || {}).filter(f => f.status === 'open' && f.owner === k.seller && f.country === from.id && (f.sector === k.good || f.resource === k.good)).reduce((a, f) => a + (f.lastUnits || 0), 0);
      const q = Math.min(from.stock[k.good] || 0, k.amount, output);
      from.stock[k.good] -= q; to.stock[k.good] = (to.stock[k.good] || 0) + q / route.cost;
      if (q < k.amount * .95) breach(w, k, seller.id, `${seller.name} delivered short on ${GOOD_LABEL[k.good]}.`);
    }
  }
  w.contracts = w.contracts.filter(k => ['proposed', 'active'].includes(k.status) ? w.turn - k.turn <= 120 : w.turn - (k.closedAt ?? w.turn) <= 40);
}

export function cancelContract(w, actor, id) {
  const k = (w.contracts || []).find(x => x.id === id && open(x) && [x.a, x.b].includes(actor.id)); if (!k) return false;
  k.status = 'cancelled'; k.closedAt = w.turn;
  say(w, w.characters[k.a === actor.id ? k.b : k.a], actor.name, `${actor.name} walked away from contract ${k.id}.`);
  return true;
}
