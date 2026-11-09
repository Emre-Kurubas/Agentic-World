// Para birimleri ve döviz. Rezervler altın cinsindendir; kur, bir altının yerel para karşılığıdır.
// Karar ajanındır (rejim, devalüasyon, borç), kur ve krizler bu hesaplardan çıkar.
import { clamp, news, sum } from './util.js';
import { aliveCountries, BASE_PRICE, GOODS } from './world.js';

const UNITS = ['crown', 'thaler', 'mark', 'florin', 'ducat', 'shilling', 'dirham', 'guilder'];
export const FX_REGIMES = ['serbest', 'altin', 'bagli'];
const OUTPUT_SHIELD = .03, CRISIS_TURNS = 2, GLUT_TURNS = 10;

export function issueCurrency(c, regime = 'altin') {
  let h = 7; for (const ch of c.id) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  const root = (c.rootName || c.name || c.id).split(' ')[0];
  c.currency = { name: `${root} ${UNITS[h % UNITS.length]}` };
  c.fxRegime = regime; c.rate = c.rate ?? 1; c.pegRate = 1; c.pegTo = null;
}

export function updateRer(w) {
  // Geometrik ortalama: tek bir aşırı enflasyonlu ülke herkesin reel kurunu bozmasın.
  const cs = aliveCountries(w), weight = sum(cs, c => Math.max(c.realGdp, 1)) || 1;
  const avg = Math.exp(sum(cs, c => Math.log(Math.max(c.priceLevel / (c.rate || 1), 1e-9)) * Math.max(c.realGdp, 1)) / weight) || 1;
  for (const c of cs) c.rer = clamp((c.priceLevel / (c.rate || 1)) / avg, .2, 5);
}

// Depolar doluyken üretici yavaşlar: stok, iç talep ve geçen turun satışının kaç tur karşılığıysa ona bakılır.
export function glutFactor(c, g) {
  if (!c._need) return 1;
  const demand = Math.max((c._need?.[g] || 0) + (c.lastSold?.[g] || 0), .001), cover = (c.stock[g] || 0) / demand;
  return cover > GLUT_TURNS ? GLUT_TURNS / cover : 1;
}

// İç piyasa: malın ülkedeki fiyatı dünya fiyatı, kurun değeri ve yerel kıtlıktan çıkar.
export function localPrices(w, c) {
  c.prices ||= {};
  for (const g of GOODS) {
    const demand = Math.max(c._need?.[g] || 0, .001), cover = (c.stock[g] || 0) / demand, scarcity = clamp(1.4 / (Math.min(cover, 6) * .5 + .4), .5, 3);
    c.prices[g] = +(w.globalPrice[g] * (c.rer ?? 1) * scarcity).toFixed(2);
  }
}

// Kur fazla değerliyse ithal mal yerli malı piyasadan iter; fazla veren ülkenin dövizi böyle dolaşıma döner.
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
  news(w, `${c.name} ${why}; alacaklı ülkeler öfkeli.`, { kind: 'ekonomi', countries: [c.id] });
}

function currencyCrisis(w, c) {
  const old = c.rate;
  c.rate *= 1.35; c.fxRegime = 'serbest'; c.pegTo = null;
  c.legitimacy = clamp(c.legitimacy - 6, 0, 100); c.bankHealth = clamp(c.bankHealth - 15, 0, 100);
  news(w, `${c.name}: rezervler bitti, ${c.currency.name} sabit kurdan koptu; değeri bir anda düştü.`, { kind: 'ekonomi', countries: [c.id] });
  return old;
}

export function currencyStep(w, c) {
  const real = Math.max(c.realGdp, 1), target = real * .3, R = c.reserves, bop = R - (c._lastReserves ?? R), prev = c.rate;
  c._lastReserves = R;
  if (c.fxRegime === 'serbest') {
    // Serbest kur ödemeler dengesine ve fiyat farkına tepki verir; rezervin az olması tek başına parayı düşürmez.
    const drift = .4 * Math.log(c.rer ?? 1) + clamp(-bop / real, -OUTPUT_SHIELD, OUTPUT_SHIELD);
    c.rate = clamp(c.rate * Math.exp(drift), 1e-3, 1e12);
  } else {
    if (c.fxRegime === 'bagli') {
      const anchor = w.countries[c.pegTo];
      if (anchor?.alive) c.rate = anchor.rate * c.pegRate; else { c.fxRegime = 'serbest'; c.pegTo = null; }
    }
    // Altın akarsa para da akar: sabit kurda dengeyi kuran fiyatlardır.
    c.money *= 1 + clamp(bop / real, -OUTPUT_SHIELD, OUTPUT_SHIELD) * .6;
    c._fxStress = R <= real * OUTPUT_SHIELD ? (c._fxStress || 0) + 1 : 0;
    if (c.fxRegime !== 'serbest' && c._fxStress >= CRISIS_TURNS) { currencyCrisis(w, c); c._fxStress = 0; }
  }
  c._fxPass = clamp(Math.log(c.rate / prev) * clamp((c._imports || 0) / real, 0, .5) * .6, -.05, .3);
  c.fx = +(100 / c.rate).toFixed(2);
}

export const goodBase = g => BASE_PRICE[g];
