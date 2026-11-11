// Currencies and exchange. Reserves are in gold; the rate is the local-currency price of one gold unit.
// The decision belongs to the agent (regime, devaluation, debt); rates and crises come out of these calculations.
import { clamp, news, sum } from './util.js';
import { aliveCountries, BASE_PRICE, GOODS } from './world.js';

const UNITS = ['crown', 'thaler', 'mark', 'florin', 'ducat', 'shilling', 'dirham', 'guilder'];
export const FX_REGIMES = ['floating', 'gold', 'pegged'];
const OUTPUT_SHIELD = .03, CRISIS_TURNS = 2, GLUT_TURNS = 10;

export function issueCurrency(c, regime = 'gold') {
  let h = 7; for (const ch of c.id) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  const root = (c.rootName || c.name || c.id).split(' ')[0];
  c.currency = { name: `${root} ${UNITS[h % UNITS.length]}` };
  c.fxRegime = regime; c.rate = c.rate ?? 1; c.pegRate = 1; c.pegTo = null;
}

export function updateRer(w) {
  // Geometric mean: one hyperinflating country should not distort everyone's real exchange rate.
  const cs = aliveCountries(w), weight = sum(cs, c => Math.max(c.realGdp, 1)) || 1;
  const avg = Math.exp(sum(cs, c => Math.log(Math.max(c.priceLevel / (c.rate || 1), 1e-9)) * Math.max(c.realGdp, 1)) / weight) || 1;
  for (const c of cs) c.rer = clamp((c.priceLevel / (c.rate || 1)) / avg, .2, 5);
}

// The store a trade ordinarily keeps of each good, in quarters of what the country uses and sells: a year's coal and ore at the pithead, half a year's
// steel in the yards, a quarter's wares on the shelves, two years' machinery, an arsenal for a war. One number does three things, so that they agree:
// at that depth the world price stands at its ordinary level, a country's own price stands at the world's, and makers begin to work short time.
// (Bread is left as it was: the granaries fill and empty with the harvest, and farmers do not stop sowing because the barns are full.)
export const STORE = { timber: 4, coal: 4, iron: 4, copper: 4, oil: 3, phosphate: 4, rare: 4, steel: 2, fuel: 2, fertilizer: 2, machines: 8, goods: 1, arms: 16 };
// What the world market reads (economy.js `trade`): its price stands at the ordinary level when the world's stores hold four fifths of this, hence the quarter added.
// (Consumer goods used to be read at half this: countries that could not pay for wares kept no shelves, and the world held half of what its makers
// did. Now that every country's shops are stocked, the shelves of the world are the makers' shelves, and the price is ordinary when they are.)
export const USUAL_COVER = { ...Object.fromEntries(Object.entries(STORE).map(([g, q]) => [g, q * 1.25])), goods: STORE.goods * .9 * 1.25 };
const coverOf = (c, g, demand) => (c.stock[g] || 0) / demand * 2 / (STORE[g] ?? 2);
// With full warehouses producers slow down: looks at how many quarters of domestic demand and last quarter's sales the stock covers.
// Past the usual store they cut back faster than the stock grows, so the store stays near its ordinary depth instead of running to years of unsold
// coal and copper with the price on the floor; what the pits and mills could have made beyond that stands idle and is counted as idle.
export function glutFactor(c, g) {
  if (!c._need) return 1;
  const cover = (c.stock[g] || 0) / Math.max((c._need?.[g] || 0) + (c.lastSold?.[g] || 0), .001), full = STORE[g] ?? GLUT_TURNS;
  return cover > full ? (STORE[g] ? (full / cover) ** 2 : full / cover) : 1;
}

// Domestic market: a good's local price comes from the world price, the currency's value and local scarcity.
// Scarcity is measured against what the country uses and what it sells abroad: an exporter's full yards are its trade, not a glut, and the world
// price has already been marked down for them once. Full stores take at most a third off the going price; empty ones can treble it.
export function localPrices(w, c) {
  c.prices ||= {};
  for (const g of GOODS) {
    // An arsenal is bought by the state at its own price: a full one does not make rifles cheap the way a full granary makes bread cheap.
    const demand = (c._need?.[g] || 0) + (STORE[g] ? c.lastSold?.[g] || 0 : 0), cover = coverOf(c, g, Math.max(demand, .001)), scarcity = clamp(1.4 / (Math.min(cover, 6) * .5 + .4), g === 'arms' ? .9 : STORE[g] ? .65 : .5, 3);
    c.prices[g] = +(w.globalPrice[g] * (c.rer ?? 1) * scarcity).toFixed(2);
  }
}

// An overvalued currency lets imports push local goods out of the market; that is how a surplus country's foreign exchange recirculates.
// A tariff wall keeps part of them out.
// So does gold. A country whose vaults hold far more than it was ever used to (c.goldBase) spends some of it: its people buy abroad what they did
// not before, and the gold that trade piled up in one country finds its way back to the countries that make things.
export const flushWith = c => clamp(((c.reserves || 0) / Math.max(c.goldBase ?? c.reserves ?? 1, 1) - 1.5) * .12, 0, .4);
export const displacedDemand = (c, g) => clamp(((c.rer ?? 1) - 1) * 2 + flushWith(c), 0, .5) * (c._need?.[g] || 0) * (1 - clamp(c.imports?.rules?.[g]?.tariff ?? c.tariff ?? 0, 0, 1));
export const exportEdge = c => 1 / Math.max(c.rer ?? 1, .2) ** 2;

export function foreignRate(c, external) {
  return clamp(.012 + Math.max(0, external / Math.max(c.realGdp, 1) - .3) * .04 + (c.defaulted ? .04 : 0) + (c.bankHealth < 30 ? .02 : 0), .005, .25);
}
export const externalDebt = c => sum(Object.values(c.creditors), x => x);

// What lenders ask of a state: little from a sound one, more as the debt burden grows, with inflation, after a default and while the banks are sick.
export function sovereignRate(c) {
  const burden = c.debt / Math.max(c.gdp * 4, 1);
  // Lenders also price a state's word: one that breaks treaties, falls on its neighbours and threatens emptily pays more for money (about a point and
  // a half a year for every ten its standing has lost). And they price a war: a state at war pays a premium that grows with the war's length, more
  // if it began it and more again while it is losing ground, and that outlasts the peace by a few quarters (warcost.js warFooting).
  return clamp(.0075 + .02 * Math.max(0, burden - .6) ** 1.5 + Math.max(0, c.inflTrend ?? c.inflation) * .6 + (c.defaulted ? .02 : 0) + (c.bankHealth < 30 ? .01 : 0) + Math.max(0, 60 - (c.honour ?? 60)) * .0004 + (c.war?.premium || 0), .005, .35);
}
// Lenders shut out a defaulter, but not forever: some years of paying in full and the market deals with the state again.
// A state already in default cannot default again; it simply goes on not paying.
const DEFAULT_MEMORY = 16;
export const canDefault = (w, c) => !c.defaulted;
export function creditStanding(w, c, paidInFull) {
  if (!c.defaulted) return;
  c.cleanTurns = paidInFull && !(c.extArrears > 0) ? (c.cleanTurns || 0) + 1 : 0;
  if (c.cleanTurns >= DEFAULT_MEMORY) { c.defaulted = false; c.cleanTurns = 0; news(w, `${c.name} is trusted by lenders again, years after its default.`, { kind: 'economy', countries: [c.id] }); }
}
// How much more lenders would still put up in one quarter. Trust in the government widens it; a default nearly closes it.
// The quarter's allowance is fixed when the quarter opens (openCredit): asking the lenders ten times in one quarter does not get ten allowances.
// Lenders take up about an eighth of the remaining headroom in a quarter: enough for a war loan, not for the whole ceiling at once.
// And they look at what the state takes in: no one lends on to a treasury whose interest would eat more than about half its revenue.
// Inflation is left out of that sum: it raises the interest asked and wears the debt down by as much.
const ceiling = c => { const trust = c.gdp * 4 * (1.1 + c.legitimacy / 100) * (c.war?.squeeze ?? 1), rate = Math.max((c.interestRate ?? sovereignRate(c)) - Math.max(0, c.inflTrend ?? c.inflation ?? 0) * .6, .005); return c.lastRevenue > 0 ? Math.min(trust, c.lastRevenue * .5 / rate) : trust; };
const creditRoom = c => Math.max(0, ceiling(c) - c.debt) * (c.defaulted ? .03 : .12);
// All that lenders would still let the state owe before they stop altogether, for whoever asks how long a deficit can be carried.
export const creditHeadroom = c => Math.max(0, ceiling(c) - c.debt);
export function creditLeft(c) {
  return Math.max(0, Math.min(creditRoom(c), (c._room ?? Infinity) - (c._taken || 0)));
}
export function openCredit(c) { c._room = creditRoom(c); c._taken = 0; }
// The treasury pays what it can in cash and borrows the rest while lenders agree. Returns what was actually paid.
export function treasuryPays(c, cost) {
  if (!(cost > 0)) return 0;
  // The working balance is the last money spent: first the cash above it, then lenders, and only then the till itself.
  const cash = Math.min(Math.max(c.treasury - (c.till || 0), 0), cost), loan = Math.min(cost - cash, creditLeft(c)), last = Math.min(cost - cash - loan, Math.max(c.treasury - cash, 0));
  c.treasury -= cash + last; c.debt += loan; c._loans = (c._loans || 0) + loan; c._taken = (c._taken || 0) + loan;
  return cash + loan + last;
}

export function declareDefault(w, c, why) {
  if (!canDefault(w, c)) return false;
  // What is written off was somebody's savings: the banks that held the paper, the middle class and the rich who held the banks' deposits, the men of business.
  // They take the loss in proportion to its size, and they remember who did it.
  const weight = clamp(c.debt * .45 / Math.max(c.gdp * 4, 1), 0, 1.5);
  c.legitimacy = clamp(c.legitimacy - clamp(weight * 30, 2, 14), 0, 100); if (c.blocs?.capital) c.blocs.capital.sat = clamp(c.blocs.capital.sat - clamp(weight * 60, 5, 30), 0, 100);
  (c.mods ||= []).push({ key: 'sat.middle', delta: -clamp(weight * 40, 3, 18), turns: 8, label: 'Savings lost in the default' }, { key: 'sat.elite', delta: -clamp(weight * 50, 3, 20), turns: 8, label: 'Savings lost in the default' });
  c.defaulted = true; c.defaultedAt = w.turn; c.cleanTurns = 0; c.extArrears = 0; c.debt *= .55;
  // Those who hold the state's paper by name lose with everyone else, and know whom to thank.
  for (const b of w.bonds || []) if (b.country === c.id) { b.amount *= .55; const h = w.characters[b.holder]; if (h?.alive) { h.inbox.push({ turn: w.turn, from: 'Your banker', text: `${c.name} has defaulted. The paper you hold is written down to ${Math.round(b.amount)}.` }); if (h.loyalty != null && h.country === c.id) h.loyalty = clamp(h.loyalty - 30, 0, 100); } } c.bankHealth = clamp(c.bankHealth - clamp(20 + weight * 60, 25, 55), 0, 100);
  // Gold runs from a defaulter to wherever it is safest; it does not vanish from the world.
  if (c.reserves > 0) { const haven = aliveCountries(w).filter(o => o.id !== c.id && !o.capitalClosed).sort((a, b) => b.legitimacy - a.legitimacy)[0], out = c.reserves * .3; if (haven) { c.reserves -= out; haven.reserves += out; } }
  // The creditors' loss is the part of their claim that is written off; no gold of theirs vanishes on top of it.
  for (const [cid, amt] of Object.entries(c.creditors)) { const o = w.countries[cid]; if (o?.alive) { o.relations[c.id] = clamp((o.relations[c.id] ?? 0) - 40, -100, 100); o.bankHealth = clamp(o.bankHealth - 12, 0, 100); c.creditors[cid] = amt * .55; } else delete c.creditors[cid]; }
  news(w, `${c.name} ${why}; ${Object.keys(c.creditors).length ? 'creditor countries are furious' : 'its bondholders are ruined'}.`, { kind: 'economy', countries: [c.id] });
  return true;
}

function currencyCrisis(w, c) {
  const old = c.rate;
  c.rate *= 1.35; c.fxRegime = 'floating'; c.pegTo = null;
  c.legitimacy = clamp(c.legitimacy - 6, 0, 100); c.bankHealth = clamp(c.bankHealth - 15, 0, 100);
  news(w, `${c.name}: reserves ran out, ${c.currency.name} broke from its peg and its value collapsed at once.`, { kind: 'economy', countries: [c.id] });
  return old;
}

export function currencyStep(w, c) {
  const real = Math.max(c.realGdp, 1), target = real * .3, R = c.reserves, bop = R - (c._lastReserves ?? R), prev = c.rate;
  c._lastReserves = R; c._goldFlow = bop;
  if (c.fxRegime === 'floating') {
    // A floating rate reacts to the balance of payments and price gaps; low reserves alone do not sink the currency.
    const drift = .4 * Math.log(c.rer ?? 1) + clamp(-bop / real, -OUTPUT_SHIELD, OUTPUT_SHIELD);
    c.rate = clamp(c.rate * Math.exp(drift), 1e-3, 1e12);
  } else {
    if (c.fxRegime === 'pegged') {
      const anchor = w.countries[c.pegTo];
      if (anchor?.alive) c.rate = anchor.rate * c.pegRate; else { c.fxRegime = 'floating'; c.pegTo = null; }
    }
    // When gold flows, money flows too: under a fixed rate prices restore the balance.
    c.money *= 1 + clamp(bop / real, -OUTPUT_SHIELD, OUTPUT_SHIELD) * .6;
    c._fxStress = R <= real * OUTPUT_SHIELD ? (c._fxStress || 0) + 1 : 0;
    if (c.fxRegime !== 'floating' && c._fxStress >= CRISIS_TURNS) { currencyCrisis(w, c); c._fxStress = 0; }
  }
  c._fxPass = clamp(Math.log(c.rate / prev) * clamp((c._imports || 0) / real, 0, .5) * .6, -.05, .3);
  c.fx = +(100 / c.rate).toFixed(2);
}

export const goodBase = g => BASE_PRICE[g];
