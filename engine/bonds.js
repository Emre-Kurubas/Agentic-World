// Who holds the state's paper. Part of a state's debt is owed to people one can name: the banking house, a magnate, a foreign ruler's cousin.
// They are paid interest like the rest, they lose like the rest in a default, and they can get out only by selling to the market at whatever
// the market thinks the paper is worth.
import { clamp, nextId } from './util.js';

// What a holder gets for the paper if it is sold today: the worse the state's credit, the less.
export const marketPrice = c => clamp(1 - Math.max(0, (c.interestRate ?? .01) - .01) * 9 - (c.defaulted ? .35 : 0), .2, 1);
export const bondsOf = (w, id) => (w.bonds || []).filter(b => b.holder === id && b.amount > .01);
export const holdersOf = (w, cid) => (w.bonds || []).filter(b => b.country === cid && b.amount > .01);

export function buyBonds(w, c, actor, amount) {
  actor.wealth -= amount; c.treasury += amount; c.debt += amount;
  const mine = (w.bonds ||= []).find(b => b.holder === actor.id && b.country === c.id); if (mine) mine.amount += amount; else w.bonds.push({ id: nextId(w, 'O'), holder: actor.id, country: c.id, amount, turn: w.turn });
  return { ok: true, msg: `You lent ${Math.round(amount * 10) / 10} to the state of ${c.name} and hold its paper for it. It pays what the state pays its other lenders (now ${Math.round((c.interestRate ?? .01) * 1000) / 10}% a quarter), loses what they lose if the state defaults, and can be sold on the market for about ${Math.round(marketPrice(c) * 100)} in the hundred.` };
}
export function sellBonds(w, c, actor, amount) {
  const mine = (w.bonds || []).find(b => b.holder === actor.id && b.country === c.id); if (!mine || mine.amount < .01) return null;
  const sold = Math.min(mine.amount, amount > 0 ? amount : mine.amount), got = sold * marketPrice(c); mine.amount -= sold; actor.wealth += got;
  return { ok: true, msg: `You sold ${Math.round(sold * 10) / 10} of ${c.name}'s paper on the market for ${Math.round(got * 10) / 10}; you still hold ${Math.round(mine.amount * 10) / 10}.` };
}
// Interest reaches those who hold the paper; the state has already paid it with the rest of its debt service.
export function bondStep(w) {
  for (const b of w.bonds ||= []) { const c = w.countries[b.country], h = w.characters[b.holder]; if (!c?.alive || !h?.alive) { b.amount = 0; continue; } if (!c.defaulted) h.wealth += b.amount * (c.interestRate ?? .01) * (c.paidRatio ?? 1); }
  w.bonds = w.bonds.filter(b => b.amount > .01);
}
