// Companies: the real owners of factories and mines. Profit comes from domestic market prices; the owner decides what to do with it.
import { clamp, news, nextId, rand } from './util.js';
import { PLANTS, BASE_PRICE, GOOD_LABEL, DEPOSITS, aliveCountries, countryProvinces } from './world.js';
import { RECIPE } from './economy.js';
import { queueProject, durationOf, plantPrice, minePrice, machinesFor, MAX_PLANT, MAX_MINE } from './projects.js';
import { governs } from './polity.js';

const SCALE = .05, MAX_PER_COUNTRY = 14, BANKRUPT_TURNS = 6;
export const STATE = 'state';
export const isOpen = f => f.status === 'open';
const sectorName = f => f.sector === 'mine' ? `${GOOD_LABEL[f.resource]} mine` : PLANTS[f.sector];
export const ownerName = (w, f) => f.owner === STATE ? 'state' : w.characters[f.owner]?.name ?? 'publicly held';

function capacity(w, f) { const p = w.provinces[f.province]; return f.sector === 'mine' ? p.deposits[f.resource]?.mine ?? 0 : p.plants[f.sector] ?? 0; }
// A step of capacity costs what it takes to equip the working people of its province. Second-hand, works fetch a fifth of that (a pit a tenth).
const stepPrice = (w, f) => { const p = w.provinces[f.province]; return f.sector === 'mine' ? minePrice(p) : plantPrice(p); };
const secondHand = (w, f) => f.stake * capacity(w, f) * stepPrice(w, f) * (f.sector === 'mine' ? .1 : .2);
// A company is worth the cash in its till and what its works bring in: about three years of what it has lately earned (f.earn, smoothed over the
// last few quarters so that one strike or one lucky season does not set the price), and never less than the works would fetch second-hand.
export const firmValue = (w, f) => Math.max(f.cash, 0) + Math.max(secondHand(w, f), 12 * Math.max(f.earn ?? f.lastProfit ?? 0, 0));

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
// A quarter of it stays in the company's till as working cash; the rest buys works at what they cost in that province, and what the place cannot take stays in the till too.
function expand(w, host, firm, capital, fail) {
  const p = w.provinces[firm.province], room = (firm.sector === 'mine' ? MAX_MINE : MAX_PLANT) - capacity(w, firm), price = stepPrice(w, firm);
  const add = Math.min(capital * .75 / price, room), machines = add * machinesFor(p);
  if (!(add > 0)) return fail('These works are already as large as the place can carry.');
  if ((host.stock.machines || 0) < machines) return fail(`The country does not have the machinery to equip it (about ${Math.round(machines * 10) / 10} needed, ${Math.round((host.stock.machines || 0) * 10) / 10} in store); machines must be made or imported first.`);
  host.stock.machines -= machines; firm.cash += capital - add * price;
  queueProject(w, host, { kind: firm.sector, province: firm.province, resource: firm.resource ?? undefined, add, cost: add * price, firm: firm.id, label: firm.name });
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
      // What the state does not hold of the country's great houses belongs to its magnate: the largest mines and works of a country of 1900
      // had an owner with a name, and he is that owner. (Five of every seven houses used to belong to nobody, and the seat held a fiftieth
      // of the country's industry.) He may sell them, and others may found their own.
      const owner = rand(w) < c.ownership ? STATE : c.oligarch;
      const f = makeFirm(w, c, s.p, s.sector, s.resource, owner, 1, '');
      f.name = `${s.p.name} ${sectorName(f)}`;
      f.cash = capacity(w, f) * 4;
    });
  }
}

// The hands at a company's works: its part of the places its mill or pit has, filled as far as the province has working people for them (economy.js extract).
export function handsOf(w, f) {
  const p = w.provinces[f.province]; if (!p) return 0;
  const base = p.base ?? p.pops.workers.n, places = (Object.values(p.deposits).filter(d => d.known && d.mine > 0 && d.amount > 0).reduce((s, d) => s + d.mine, 0) + Object.values(p.plants).reduce((s, v) => s + v, 0)) * base;
  return places > 0 ? capacity(w, f) * f.stake * Math.min(base, p.pops.workers.n * base / places) : 0;
}
// What one owner's houses are in the country: of all its mines and works turned out last quarter, at ordinary prices, the part that came out of his,
// in all and good by good. The same figures the companies' profits were reckoned on.
export function holdOf(w, c, owner) {
  const good = f => f.sector === 'mine' ? f.resource : f.sector, mine = Object.values(w.firms || {}).filter(f => isOpen(f) && f.country === c.id && f.owner === owner), by = {}, of = {};
  for (const f of mine) by[good(f)] = (by[good(f)] || 0) + (f.lastUnits || 0);
  for (const g of Object.keys(BASE_PRICE)) { const all = g in PLANTS ? c._made?.[g] || 0 : ['grain', 'timber'].includes(g) ? 0 : c._raw?.[g] || 0; if (all > 0) of[g] = all; }
  const value = o => Object.entries(o).reduce((s, [g, q]) => s + q * (g in of ? BASE_PRICE[g] : 0), 0), all = value(of);
  return { firms: mine, share: all > 0 ? Math.min(1, value(by) / all) : 0, goods: Object.fromEntries(Object.entries(by).filter(([g, q]) => q > 0 && of[g] > 0).map(([g, q]) => [g, Math.min(1, q / of[g])])), hands: mine.reduce((s, f) => s + handsOf(w, f), 0) };
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
    // A company earns on what its own works raised, not on a share of the country's output reckoned by size on paper.
    // A pit that pays above the going wage or spends on its timbering keeps less of what the ore fetches.
    return { units: p.dug ? p.dug[f.resource] || 0 : (c._raw?.[f.resource] || 0) * (p.deposits[f.resource]?.mine || 0) / total, margin: price * (.5 - .25 * ((f.wage ?? 1) - 1) - .06 * ((f.safety ?? .3) - .3)) };
  }
  const total = c._plantLevel?.[f.sector] || p.plants[f.sector] || 1, input = Object.entries(RECIPE[f.sector]).reduce((a, [g, q]) => a + (c.prices?.[g] ?? 0) * q, 0);
  const part = p.cap && c._capAll?.[f.sector] > 0 ? (p.cap[f.sector] || 0) / c._capAll[f.sector] : p.plants[f.sector] / total;
  return { units: (c._made?.[f.sector] || 0) * part, margin: price - input - BASE_PRICE[f.sector] * .25 * (c.wageIndex / c.priceLevel) * (f.wage ?? 1) - BASE_PRICE[f.sector] * .04 * ((f.safety ?? .3) - .3) };
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
    // A works that stands still earns next to nothing, whoever else in the trade is busy.
    const idle = f.strike || f.lockout || f.halted > 0 ? .1 : 1, { units: full, margin } = unitProfit(c, f, p), units = full * idle, gross = units * f.stake * margin * SCALE, profit = gross > 0 ? gross * (1 - clamp(c.tax.business, 0, .7)) : gross;
    f.lastProfit = +profit.toFixed(2); f.lastUnits = units * f.stake; f.lastTax = +(gross > 0 ? gross - profit : 0).toFixed(2); f.lastPrice = c.prices?.[f.sector === 'mine' ? f.resource : f.sector] ?? 0; f.earn = +((f.earn ?? profit) * .75 + profit * .25).toFixed(3);
    f.bad = profit < 0 ? f.bad + 1 : 0;
    if (profit > 0) {
      // Two fifths of a profit is paid out to whoever owns the company. One held in small parcels by people the story cannot name has nobody to pay:
      // its directors keep the whole in the till, and it goes into the works when they next build. No money leaves the world by that door.
      const owner = w.characters[f.owner], dividend = f.owner === STATE || owner ? profit * .4 : 0; f.cash += profit - dividend;
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

// A works is named by its number or by its name; and where no name was given at all, the one works its owner founded this very morning is the
// one he means. (World 18: "found Albano Steel Works; it pays the going wage and spends 0.4 on safety" set neither wage nor safety, because the
// works was named by its name and its number did not yet exist when the order was written.)
export function firmBy(w, actor, ref) {
  const all = w.firms || {}, key = String(ref ?? '').trim(); if (key && Object.hasOwn(all, key)) return all[key];
  const norm = s => String(s ?? '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim(), want = norm(key), open = Object.values(all).filter(isOpen), near = f => (f.owner === actor?.id ? 2 : 0) + (f.country === actor?.country ? 1 : 0);
  if (want) { const named = open.filter(f => norm(f.name) === want).sort((a, b) => near(b) - near(a)); return named[0] ?? null; }
  const fresh = open.filter(f => f.owner === actor?.id && f.founded === w.turn); return fresh.length === 1 ? fresh[0] : null;
}
export function firmOp(w, actor, c, op, fail, ok, tell, leaveTrace, num) {
  const firm = op.op === 'found_company' ? null : firmBy(w, actor, op.id ?? op.company), isHead = governs(w, c, actor);
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
      if (!(amount >= 1)) { const purse = `${state ? 'the treasury holds' : 'your purse holds'} ${Math.round(Math.max(state ? c.treasury : actor.wealth, 0) * 10) / 10}`; return fail(num(op.amount, 0, 1e9, 0) >= 1 ? `Not enough capital: ${purse}.` : `No capital was named: say how much is put into it (amount). A works is as large as the money put in; ${purse}, and the engineers' price for a works of the ordinary size there is in the survey (building:${p.id}).`); }
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
      if (op.withdraw) { firm.offer = null; return { ok: true, msg: `${firm.name} is no longer for sale.` }; }
      const price = num(op.price, 0, 1e9, firmValue(w, firm)), home = w.countries[firm.country], worth = Math.round(firmValue(w, firm));
      // To the state: the offer lies before whoever governs the country the works stands in, who takes it for the treasury or lets it lie.
      const toState = op.buyer === 'state' || op.state === true || (op.buyer != null && w.countries[op.buyer]), state = toState ? (w.countries[op.buyer] ?? home) : null;
      if (state) { if (state.id !== firm.country) return fail(`${firm.name} stands in ${home?.name}: only that state can take it over as its own works.`); const ruler = w.characters[state.leader]; firm.offer = { state: state.id, price }; if (ruler?.alive) tell(w, ruler, actor.name, `offers to sell the state ${firm.name} (${firm.id}) for ${Math.round(price)}; by its books it is worth about ${worth}. The treasury takes it with buy_company{id, state:true}; until then nothing changes hands.`); return { ok: true, msg: `${firm.name} is offered to ${state.name} for ${Math.round(price)}. The sale happens if the government takes it.` }; }
      // To nobody by name: it is put up for sale, and whoever has the money may take it at the price. (World 16: a ruined owner could not put his
      // works "up for sale to a buyer"; "No such buyer".)
      if (op.buyer == null || op.buyer === '' || op.open) { firm.offer = { open: true, price, since: w.turn }; return { ok: true, msg: `${firm.name} is up for sale at ${Math.round(price)}; by its books it is worth about ${worth}. Anybody with the money may take it (buy_company); it stays yours until somebody does, and the notice stands until you withdraw it (sell_company with withdraw:true).` }; }
      const buyer = w.characters[op.buyer]; if (!buyer?.alive) return fail('No such buyer: name a person (id), the state (buyer: "state"), or nobody, to put it up for whoever will take it.');
      firm.offer = { buyer: buyer.id, price };
      tell(w, buyer, actor.name, `offers to sell you ${firm.name} (${firm.id}) for ${Math.round(firm.offer.price)}.`);
      return ok();
    }
    case 'buy_company': {
      if (!firm || !isOpen(firm)) return fail('No such company.');
      // The treasury takes a works its owner has offered to the state.
      if (op.state === true || firm.offer?.state) {
        if (!isHead || firm.offer?.state !== c.id) return fail(firm.offer?.state ? 'That offer was made to the state, and it is for whoever governs it to take.' : 'No offer to the state lies on this works. The state can still take it without one (nationalize_company).');
        const price = firm.offer.price, seller = w.characters[firm.owner]; if (c.treasury < price) return fail(`The treasury holds ${Math.round(c.treasury)}; the price is ${Math.round(price)}.`);
        c.treasury -= price; (c._outlay ||= {}).other = (c._outlay.other || 0) + price; if (seller) { seller.wealth += price / (c.rate || 1); tell(w, seller, c.name, `The state has taken ${firm.name} at your price; ${Math.round(price / (c.rate || 1))} is paid to you.`); }
        firm.owner = STATE; firm.offer = null; c.ownership = clamp(c.ownership + .02, 0, 1); news(w, `${c.name}: the state bought ${firm.name} from ${seller?.name ?? 'its owners'}.`, { kind: 'economy', countries: [c.id] });
        return { ok: true, msg: `${firm.name} is the state's, bought for ${Math.round(price)}. It is run and drawn on like any state works.` };
      }
      const agreed = firm.offer?.buyer === actor.id, forSale = !!firm.offer?.open && firm.owner !== actor.id, open = firm.owner == null;
      if (!agreed && !open && !forSale) return fail('No sale offer.');
      const price = agreed || forSale ? firm.offer.price : firmValue(w, firm);
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
