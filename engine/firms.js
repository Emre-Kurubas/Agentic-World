// Companies: the real owners of factories and mines. Profit comes from domestic market prices; the owner decides what to do with it.
import { clamp, news, nextId, rand } from './util.js';
import { PLANTS, BASE_PRICE, GOOD_LABEL, DEPOSITS, aliveCountries, countryProvinces } from './world.js';
import { RECIPE } from './economy.js';
import { queueProject, durationOf } from './projects.js';
import { governs } from './polity.js';

const SCALE = .05, MAX_PER_COUNTRY = 14, BANKRUPT_TURNS = 6;
export const STATE = 'state';
export const isOpen = f => f.status === 'open';
const sectorName = f => f.sector === 'mine' ? `${GOOD_LABEL[f.resource]} mine` : PLANTS[f.sector];
export const ownerName = (w, f) => f.owner === STATE ? 'state' : w.characters[f.owner]?.name ?? 'publicly held';

function capacity(w, f) { const p = w.provinces[f.province]; return f.sector === 'mine' ? p.deposits[f.resource]?.mine ?? 0 : p.plants[f.sector] ?? 0; }
export const firmValue = (w, f) => Math.max(f.cash, 0) + f.stake * capacity(w, f) * 40;

function setCapacity(w, f, next) {
  const p = w.provinces[f.province], old = capacity(w, f), add = next - old;
  if (f.sector === 'mine') p.deposits[f.resource].mine = next; else p.plants[f.sector] = next;
  for (const o of Object.values(w.firms)) if (o !== f && isOpen(o) && o.province === f.province && o.sector === f.sector && o.resource === f.resource) o.stake = next > 0 ? o.stake * old / next : 0;
  f.stake = next > 0 ? (f.stake * old + add) / next : 0;
}

// When capacity is added to a works, whoever paid for it owns the addition and everyone else's share of the whole shrinks with it.
// With no payer named (the state building on its own account) the new capacity belongs to no company.
export function restake(w, province, sector, resource, old, next, payer) {
  for (const o of Object.values(w.firms || {})) {
    if (!isOpen(o) || o.province !== province || o.sector !== sector || (o.resource ?? null) !== (resource ?? null)) continue;
    o.stake = next > 0 ? clamp((o.stake * old + (o.id === payer ? next - old : 0)) / next, 0, 1) : 0;
  }
}
// The state takes a company. What it does to the books of state ownership is the caller's affair.
export function seizeFirm(w, c, firm, tell) {
  const owner = w.characters[firm.owner];
  if (owner) { tell(w, owner, c.name, `The state seized ${firm.name}.`); if (owner.country !== c.id && w.countries[owner.country]) w.countries[owner.country].relations[c.id] = clamp((w.countries[owner.country].relations[c.id] ?? 0) - 25, -100, 100); }
  firm.owner = STATE; firm.offer = null;
}
// Capital put into a company becomes works only after they are built, and only if the country has the machinery to equip them.
function expand(w, host, firm, capital, fail) {
  const mine = firm.sector === 'mine', add = capital * (mine ? .002 : .004);
  if ((host.stock.machines || 0) < add) return fail('The country does not have the machinery to equip it; machines must be made or imported first.');
  host.stock.machines -= add; firm.cash += capital * .25;
  queueProject(w, host, { kind: firm.sector, province: firm.province, resource: firm.resource ?? undefined, add, firm: firm.id, label: firm.name });
  return null;
}

function makeFirm(w, c, p, sector, resource, owner, stake, name) {
  const f = { id: nextId(w, 'SR'), name, country: c.id, province: p.id, sector, resource: resource ?? null, stake, owner, cash: 0, lastProfit: 0, founded: w.turn, status: 'open', bad: 0, offer: null };
  w.firms[f.id] = f;
  return f;
}

export function initFirms(w) {
  w.firms = {};
  for (const c of aliveCountries(w)) {
    const spots = [];
    for (const p of countryProvinces(w, c.id)) {
      for (const k of Object.keys(PLANTS)) if (p.plants[k] > .05) spots.push({ p, sector: k, size: p.plants[k] * BASE_PRICE[k] });
      for (const [k, d] of Object.entries(p.deposits)) if (d.known && d.mine > 0 && k !== 'gold') spots.push({ p, sector: 'mine', resource: k, size: d.mine * d.rich * BASE_PRICE[k] * 2 });
    }
    spots.sort((a, b) => b.size - a.size);
    spots.slice(0, 7).forEach((s, i) => {
      const owner = rand(w) < c.ownership ? STATE : i === 0 || i === 3 ? c.oligarch : null;
      const f = makeFirm(w, c, s.p, s.sector, s.resource, owner, 1, '');
      f.name = `${s.p.name} ${sectorName(f)}`;
      f.cash = capacity(w, f) * 4;
    });
  }
}

function resolveOwner(w, f, c) {
  if (f.owner === STATE || f.owner == null) return;
  const ch = w.characters[f.owner];
  if (ch?.alive && ch.status === 'free') return;
  const heir = w.characters[c.oligarch];
  f.owner = heir?.alive && heir.id !== f.owner ? heir.id : null;
  f.offer = null;
}

function unitProfit(c, f, p) {
  const price = c.prices?.[f.sector === 'mine' ? f.resource : f.sector] ?? 0;
  if (f.sector === 'mine') {
    const all = Object.values(c._mineLevel?.[f.resource] ? { x: c._mineLevel[f.resource] } : {}), total = all[0] || p.deposits[f.resource]?.mine || 1;
    return { units: (c._raw?.[f.resource] || 0) * (p.deposits[f.resource]?.mine || 0) / total, margin: price * .5 };
  }
  const total = c._plantLevel?.[f.sector] || p.plants[f.sector] || 1, input = Object.entries(RECIPE[f.sector]).reduce((a, [g, q]) => a + (c.prices?.[g] ?? 0) * q, 0);
  return { units: (c._made?.[f.sector] || 0) * p.plants[f.sector] / total, margin: price - input - BASE_PRICE[f.sector] * .25 * (c.wageIndex / c.priceLevel) };
}

export function firmStep(w) {
  const firms = Object.values(w.firms || {}).filter(isOpen);
  if (!firms.length) { pruneFirms(w); return; }
  for (const c of aliveCountries(w)) {
    c._plantLevel = {}; c._mineLevel = {};
    for (const p of countryProvinces(w, c.id)) { for (const k of Object.keys(PLANTS)) c._plantLevel[k] = (c._plantLevel[k] || 0) + p.plants[k]; for (const [k, d] of Object.entries(p.deposits)) c._mineLevel[k] = (c._mineLevel[k] || 0) + d.mine; }
  }
  for (const f of firms) {
    const p = w.provinces[f.province];
    if (p.controller !== f.country) { f.country = p.controller; f.owner = null; f.offer = null; }
    const c = w.countries[f.country];
    if (!c?.alive) continue;
    resolveOwner(w, f, c);
    const { units, margin } = unitProfit(c, f, p), gross = units * f.stake * margin * SCALE, profit = gross > 0 ? gross * (1 - clamp(c.tax.business, 0, .7)) : gross;
    f.lastProfit = +profit.toFixed(2); f.lastUnits = units * f.stake;
    f.bad = profit < 0 ? f.bad + 1 : 0;
    if (profit > 0) {
      const dividend = profit * .4; f.cash += profit - dividend;
      const owner = w.characters[f.owner];
      if (f.owner === STATE) { c.treasury += dividend * (c.rate || 1); c._stateProfit = (c._stateProfit || 0) + dividend * (c.rate || 1); }
      else if (owner) {
        owner.wealth += dividend;
        if (owner.country !== f.country) { const paid = Math.min(Math.max(c.reserves, 0), dividend); c.reserves -= paid; if (w.countries[owner.country]?.alive) w.countries[owner.country].reserves += paid; }
      }
    } else f.cash += profit;
    // A private company that earns and has cash in hand builds: this is where industry's own growth comes from. Sick banks, dear credit and unrest make owners wait.
    if (profit > 0 && f.owner !== STATE && f.cash > 20 && w.turn >= (f.buildsUntil ?? 0) && c.bankHealth >= 30 && (c.interestRate ?? .01) < .05 && p.unrest < 55) { const spend = f.cash * .5; if (!expand(w, c, f, spend, x => x)) { f.cash -= spend; f.buildsUntil = w.turn + 4; } }
    if (f.bad >= BANKRUPT_TURNS && f.cash < 0) bankrupt(w, f, c, p);
  }
  pruneFirms(w);
}

function bankrupt(w, f, c, p) {
  const cap = capacity(w, f); setCapacity(w, f, cap * (1 - .35 * f.stake));
  f.status = 'bankrupt'; f.closedAt = w.turn; f.stake = 0; f.offer = null;
  w.characters[f.owner]?.inbox.push({ turn: w.turn, from: 'Court', text: `${f.name} went bankrupt.` });
  news(w, `${c.name}: ${f.name} went bankrupt, workers were laid off in ${p.name}.`, { kind: 'economy', countries: [c.id] });
  p.unrest = clamp(p.unrest + 4, 0, 100);
}

function pruneFirms(w) {
  for (const [id, f] of Object.entries(w.firms || {})) if (!isOpen(f) && w.turn - f.closedAt > 40) delete w.firms[id];
}

const openCount = (w, id) => Object.values(w.firms).filter(f => isOpen(f) && f.country === id).length;

export function firmOp(w, actor, c, op, fail, ok, tell, leaveTrace, num) {
  const firm = w.firms && Object.hasOwn(w.firms, String(op.id)) ? w.firms[op.id] : null, isHead = governs(w, c, actor);
  switch (op.op) {
    case 'found_company': {
      const p = w.provinces[op.province]; if (!p) return fail('No such province.');
      const host = w.countries[p.controller], sector = op.sector, mine = sector === 'mine';
      if (!host?.alive) return fail('A company cannot be founded here.');
      if (host.id !== c.id && host.capitalClosed) return fail('This country is closed to foreign capital.');
      if (!mine && !(typeof sector === 'string' && Object.hasOwn(PLANTS, sector))) return fail('No such sector.');
      if (mine && (!DEPOSITS.includes(op.resource) || op.resource === 'gold' || !p.deposits[op.resource]?.known)) return fail('No known deposit.');
      if (openCount(w, host.id) >= MAX_PER_COUNTRY) return fail('No registry room left in this country.');
      const state = isHead && op.state === true, amount = Math.min(num(op.amount, 0, 1e9, 0), state ? Math.max(c.treasury, 0) : actor.wealth);
      if (!(amount >= 1)) return fail('Not enough capital.');
      const f = makeFirm(w, host, p, sector, mine ? op.resource : null, state ? STATE : actor.id, 0, String(op.name || '').slice(0, 60) || `${p.name} Company`);
      const refused = expand(w, host, f, state ? amount / Math.max(c.priceLevel, .01) : amount, fail);
      if (refused) { delete w.firms[f.id]; return refused; }
      if (state) c.treasury -= amount; else actor.wealth -= amount;
      news(w, `${host.name}: ${f.name} was founded.`, { kind: 'economy', countries: [host.id] });
      return { ok: true, msg: `Company founded: ${f.id}. Its works will stand in ${durationOf(f.sector)} quarters.`, firm: f.id };
    }
    case 'invest_company': {
      if (!firm || !isOpen(firm)) return fail('No such company.');
      const state = firm.owner === STATE && isHead;
      if (firm.owner !== actor.id && !state) return fail('This company is not yours.');
      // A company can build out of what it has in its own till, as well as out of its owner's purse or the treasury.
      if (op.from_cash === true) {
        const own = Math.min(num(op.amount, 0, 1e9, 0), Math.max(firm.cash, 0)); if (!(own > 0)) return fail(`${firm.name} has no cash of its own to spend.`);
        const no = expand(w, w.countries[firm.country], firm, own, fail); if (no) return no; firm.cash -= own;
        return { ok: true, msg: `${firm.name} spends ${Math.round(own * 10) / 10} of its own cash; the extension will stand in ${durationOf(firm.sector)} quarters.` };
      }
      const amount = Math.min(num(op.amount, 0, 1e9, 0), state ? Math.max(c.treasury, 0) : actor.wealth); if (!(amount > 0)) return fail('No money.');
      const refused = expand(w, w.countries[firm.country], firm, state ? amount / Math.max(c.priceLevel, .01) : amount, fail); if (refused) return refused;
      if (state) c.treasury -= amount; else actor.wealth -= amount;
      return { ok: true, msg: `The extension will stand in ${durationOf(firm.sector)} quarters.` };
    }
    // The owner takes money out of the company's till: a salary, a special dividend. A state company pays into the treasury.
    case 'draw_company': {
      if (!firm || !isOpen(firm)) return fail('No such company.');
      const state = firm.owner === STATE && isHead && firm.country === c.id; if (firm.owner !== actor.id && !state) return fail('This company is not yours.');
      const m = Math.min(num(op.amount, 0, 1e9, 0), Math.max(firm.cash, 0)); if (!(m > .01)) return fail(`${firm.name} has no cash to take.`);
      firm.cash -= m; if (state) c.treasury += m * (c.rate || 1); else actor.wealth += m;
      return { ok: true, msg: `${Math.round(m * 10) / 10} was taken out of ${firm.name}${state ? ' into the treasury' : ''}; it keeps ${Math.round(firm.cash * 10) / 10}.` };
    }
    case 'sell_company': {
      if (!firm || !isOpen(firm) || firm.owner !== actor.id) return fail('This company is not yours.');
      const buyer = w.characters[op.buyer]; if (!buyer?.alive) return fail('No such buyer.');
      firm.offer = { buyer: buyer.id, price: num(op.price, 0, 1e9, firmValue(w, firm)) };
      tell(w, buyer, actor.name, `offers to sell you ${firm.name} (${firm.id}) for ${Math.round(firm.offer.price)}.`);
      return ok();
    }
    case 'buy_company': {
      if (!firm || !isOpen(firm)) return fail('No such company.');
      const agreed = firm.offer?.buyer === actor.id, open = firm.owner == null;
      if (!agreed && !open) return fail('No sale offer.');
      const price = agreed ? firm.offer.price : firmValue(w, firm);
      if (actor.wealth < price) return fail('Not enough wealth.');
      const seller = w.characters[firm.owner], home = w.countries[firm.country]; actor.wealth -= price;
      if (firm.owner === STATE && home) { home.treasury += price * (home.rate || 1); home.ownership = clamp(home.ownership - .02, 0, 1); tell(w, w.characters[home.leader], actor.name, `${firm.name} was bought from the state for ${Math.round(price)}.`); }
      else if (seller) { seller.wealth += price; tell(w, seller, actor.name, `${firm.name} was sold; you received ${Math.round(price)}.`); }
      firm.owner = actor.id; firm.offer = null; leaveTrace(w, actor, `Bought ${firm.name}.`);
      return ok();
    }
    case 'nationalize_company': {
      if (!isHead) return fail('Only the leader can seize a company.');
      if (!firm || !isOpen(firm) || firm.country !== c.id || firm.owner === STATE) return fail('No company to seize.');
      seizeFirm(w, c, firm, tell); c.ownership = clamp(c.ownership + .02, 0, 1); c.blocs.capital.sat = clamp(c.blocs.capital.sat - 5, 0, 100);
      news(w, `${c.name}: ${firm.name} was nationalized.`, { kind: 'economy', countries: [c.id] });
      return ok();
    }
    case 'privatize_company': {
      if (!isHead) return fail('Only the leader can sell.');
      if (!firm || !isOpen(firm) || firm.owner !== STATE || firm.country !== c.id) return fail('No such state company.');
      const buyer = w.characters[op.buyer]; if (!buyer?.alive) return fail('No such buyer.');
      // A sale needs a buyer who agrees: the state makes the offer, and the company changes hands when the buyer takes it.
      const price = num(op.price, 0, 1e9, firmValue(w, firm));
      firm.offer = { buyer: buyer.id, price }; leaveTrace(w, actor, `Offered ${firm.name} to ${buyer.name} for ${Math.round(price)}.`);
      tell(w, buyer, c.name, `The state offers you ${firm.name} (${firm.id}) for ${Math.round(price)}. Take it with buy_company.`);
      return { ok: true, msg: 'The offer was made. The sale happens if they take it.' };
    }
    default: return fail('Unknown company operation.');
  }
}
