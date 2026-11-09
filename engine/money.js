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

// With full warehouses producers slow down: looks at how many turns of domestic demand and last turn's sales the stock covers.
export function glutFactor(c, g) {
  if (!c._need) return 1;
  const demand = Math.max((c._need?.[g] || 0) + (c.lastSold?.[g] || 0), .001), cover = (c.stock[g] || 0) / demand;
  return cover > GLUT_TURNS ? GLUT_TURNS / cover : 1;
}

// Domestic market: a good's local price comes from the world price, the currency's value and local scarcity.
export function localPrices(w, c) {
  c.prices ||= {};
  for (const g of GOODS) {
    const demand = Math.max(c._need?.[g] || 0, .001), cover = (c.stock[g] || 0) / demand, scarcity = clamp(1.4 / (Math.min(cover, 6) * .5 + .4), .5, 3);
    c.prices[g] = +(w.globalPrice[g] * (c.rer ?? 1) * scarcity).toFixed(2);
  }
}

// An overvalued currency lets imports push local goods out of the market; that is how a surplus country's foreign exchange recirculates.
export const displacedDemand = (c, g) => clamp(((c.rer ?? 1) - 1) * 2, 0, .5) * (c._need?.[g] || 0);
export const exportEdge = c => 1 / Math.max(c.rer ?? 1, .2) ** 2;

export function foreignRate(c, external) {
  return clamp(.012 + Math.max(0, external / Math.max(c.realGdp, 1) - .3) * .04 + (c.defaulted ? .04 : 0) + (c.bankHealth < 30 ? .02 : 0), .005, .25);
}
export const externalDebt = c => sum(Object.values(c.creditors), x => x);

export function declareDefault(w, c, why) {
  if (c.defaulted) return;
  c.defaulted = true; c.debt *= .55; c.reserves *= .7; c.bankHealth = clamp(c.bankHealth - 30, 0, 100);
  for (const [cid, amt] of Object.entries(c.creditors)) { const o = w.countries[cid]; if (o?.alive) { o.relations[c.id] = clamp((o.relations[c.id] ?? 0) - 40, -100, 100); o.bankHealth = clamp(o.bankHealth - 12, 0, 100); o.reserves -= amt * .15; } c.creditors[cid] = amt * .55; }
  news(w, `${c.name} ${why}; creditor countries are furious.`, { kind: 'economy', countries: [c.id] });
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
  c._lastReserves = R;
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
