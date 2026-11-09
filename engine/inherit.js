// Liderler devleti tasarlamaz, devralır: rejim, bütçe, ordu, borç ve geçmiş ülkeden ülkeye farklıdır.
// Burada yalnızca olgu vardır; karaktere nasıl düşüneceği söylenmez ve lider her şeyi değiştirebilir.
import { clamp, rand, pick, between, nextId } from './util.js';
import { countryProvinces, aliveCountries, word, GOOD_TR } from './world.js';
import { partyStep } from './politics.js';
import { makeParliament } from './polity.js';

const R = (a, b) => [a, b];
const ARCHETYPES = [
  { key: 'cunta', suffix: ['Askerî Yönetimi', 'Ulusal Kurtuluş Konseyi'], regime: ['Askerî cunta'], ideology: ['Düzen milliyetçiliği', 'Kışla devletçiliği'], elections: false, press: R(5, 20), axes: { econ: R(-10, 30), auth: R(70, 95), nation: R(60, 90), faith: R(-10, 30) }, budget: { military: .07, welfare: .01, infrastructure: .01, education: .008, police: .025, administration: .012 }, tax: { income: .17, land: .16, business: .17 }, tariff: .15, treasury: .03, reserves: .15, debt: 2.2, army: 2.2, fleet: .6, industry: .6, arms: 2, literacy: R(16, 28), bureaucracy: 40, corruption: 52, police: 72, intelligence: 60, legitimacy: 38, courts: 12, unions: false, ownership: .1, loyalty: 88, rise: ['Altı yıl önce bir gece darbesiyle iktidarı aldı; önceki hükümetin üyeleri sürgünde.', 'İç savaşı kazanan subaylar onu devlet başkanı ilan etti.'] },
  { key: 'tacir', suffix: ['Tacirler Cumhuriyeti', 'Serbest Limanları'], regime: ['Tacirler konseyi'], ideology: ['Serbest ticaret', 'Tacir oligarşisi'], elections: true, press: R(50, 75), axes: { econ: R(60, 90), auth: R(-10, 30), nation: R(-40, 0), faith: R(-20, 10) }, budget: { military: .012, welfare: .015, infrastructure: .03, education: .02, police: .008, administration: .015 }, tax: { income: .12, land: .06, business: .12 }, tariff: .03, treasury: .5, reserves: 1.4, debt: .6, army: .5, fleet: 2, industry: 1.6, arms: .6, literacy: R(50, 65), bureaucracy: 65, corruption: 28, police: 35, intelligence: 50, legitimacy: 60, courts: 65, unions: true, ownership: 0, loyalty: 62, rise: ['Büyük ticaret evlerinin çoğunluğuyla konsey başkanlığına seçildi.'] },
  { key: 'monarsi', suffix: ['Krallığı', 'İmparatorluğu', 'Hanedanı'], regime: ['Mutlak monarşi', 'Meşruti görünümlü monarşi'], ideology: ['Tahtın kutsallığı', 'Hanedan sadakati'], elections: false, press: R(10, 30), axes: { econ: R(10, 40), auth: R(65, 90), nation: R(20, 50), faith: R(40, 80) }, budget: { military: .04, welfare: .01, infrastructure: .012, education: .01, police: .02, administration: .02 }, tax: { income: .1, land: .2, business: .1 }, tariff: .12, treasury: .3, reserves: .5, debt: 1.2, army: 1.2, fleet: 1, industry: .8, arms: 1.2, literacy: R(24, 36), bureaucracy: 55, corruption: 40, police: 55, intelligence: 45, legitimacy: 70, courts: 25, unions: false, ownership: 0, loyalty: 80, advisory: 'Ayan Meclisi', rise: ['Babasının ölümüyle tahta çıktı; hanedan iki yüzyıldır hüküm sürüyor.', 'Çocuksuz ölen amcasının yerine, saray ayanının onayıyla tahta geçti.'] },
  { key: 'cumhuriyet', suffix: ['Cumhuriyeti'], regime: ['Parlamenter cumhuriyet'], ideology: ['Liberal cumhuriyetçilik', 'Sosyal reformculuk'], elections: true, press: R(75, 92), axes: { econ: R(-30, 30), auth: R(-55, -20), nation: R(-20, 15), faith: R(-40, 0) }, budget: { military: .02, welfare: .04, infrastructure: .025, education: .03, police: .01, administration: .02 }, tax: { income: .18, land: .1, business: .2 }, tariff: .08, treasury: .15, reserves: .5, debt: 1.5, army: .8, fleet: 1, industry: 1.2, arms: .8, literacy: R(50, 62), bureaucracy: 65, corruption: 22, police: 35, intelligence: 40, legitimacy: 62, courts: 70, unions: true, ownership: .05, loyalty: 60, rise: ['Son seçimi az bir farkla kazandı; muhalefet sonucu hâlâ tartışıyor.', 'Koalisyon görüşmeleri aylarca sürdükten sonra başbakan oldu.'] },
  { key: 'devrim', suffix: ['Halk Devleti', 'Devrim Cumhuriyeti'], regime: ['Tek parti devleti'], ideology: ['Devrimci sosyalizm', 'Köylü-işçi iktidarı'], elections: false, press: R(5, 20), axes: { econ: R(-90, -60), auth: R(55, 85), nation: R(-10, 30), faith: R(-85, -50) }, budget: { military: .05, welfare: .05, infrastructure: .03, education: .035, police: .035, administration: .02 }, tax: { income: .22, land: .2, business: .25 }, tariff: .25, treasury: .1, reserves: .3, debt: .5, army: 1.4, fleet: .5, industry: 1, arms: 1.3, literacy: R(35, 46), bureaucracy: 60, corruption: 35, police: 75, intelligence: 65, legitimacy: 50, courts: 10, unions: true, ownership: .6, loyalty: 78, rise: ['Eski rejimi yıkan ayaklanmanın önderlerindendi; parti onu genel sekreter seçti.'] },
  { key: 'tarim', suffix: ['Beyliği', 'Krallığı'], regime: ['Zayıf merkezli krallık'], ideology: ['Toprak ve gelenek'], elections: false, press: R(20, 40), axes: { econ: R(0, 30), auth: R(30, 60), nation: R(10, 40), faith: R(30, 70) }, budget: { military: .018, welfare: .006, infrastructure: .008, education: .005, police: .01, administration: .012 }, tax: { income: .08, land: .14, business: .08 }, tariff: .1, treasury: .05, reserves: .2, debt: 1.8, army: .6, fleet: .3, industry: .4, arms: .6, literacy: R(12, 20), bureaucracy: 30, corruption: 60, police: 30, intelligence: 25, legitimacy: 55, courts: 20, unions: false, ownership: 0, loyalty: 66, rise: ['Toprak ağalarının desteğiyle hükümdar oldu; eyaletlerin çoğunda sözü ağaların izniyle geçiyor.'] },
  { key: 'federasyon', suffix: ['Konfederasyonu', 'Birleşik Eyaletleri'], regime: ['Gevşek federasyon'], ideology: ['Eyalet hakları', 'Bölgeci federalizm'], elections: true, press: R(45, 70), axes: { econ: R(0, 40), auth: R(-30, 10), nation: R(-20, 20), faith: R(-20, 20) }, budget: { military: .025, welfare: .015, infrastructure: .02, education: .015, police: .008, administration: .01 }, tax: { income: .12, land: .08, business: .16 }, tariff: .06, treasury: .2, reserves: .8, debt: 1, army: .9, fleet: .8, industry: 1, arms: .9, literacy: R(36, 48), bureaucracy: 40, corruption: 35, police: 30, intelligence: 30, legitimacy: 52, courts: 50, unions: true, ownership: 0, loyalty: 58, rise: ['Eyalet valilerinin uzun pazarlığı sonunda federal başkan seçildi.'] },
  { key: 'teokrasi', suffix: ['Kutsal Devleti', 'Ruhani Cumhuriyeti'], regime: ['Ruhani yönetim'], ideology: ['İnanç devleti', 'Kutsal yasa'], elections: false, press: R(15, 35), axes: { econ: R(-20, 20), auth: R(50, 80), nation: R(10, 40), faith: R(80, 100) }, budget: { military: .025, welfare: .03, infrastructure: .015, education: .025, police: .03, administration: .02 }, tax: { income: .14, land: .16, business: .1 }, tariff: .12, treasury: .2, reserves: .5, debt: .8, army: 1, fleet: .6, industry: .7, arms: 1, literacy: R(26, 38), bureaucracy: 50, corruption: 32, police: 60, intelligence: 50, legitimacy: 72, courts: 30, unions: false, ownership: .1, loyalty: 75, advisory: 'Ruhban Meclisi', rise: ['Ruhani meclis onu yüce makama seçti; önceki yüce önder görevdeyken öldü.'] }
];
const COLORS = ['#2f6f8f', '#a33b3b', '#6a8d3a', '#8a5aa8', '#c58a2a', '#3b8f7f', '#b0577a', '#6b6f3a'];

const jitter = (w, v, by = .18) => v * between(w, 1 - by, 1 + by);
const inRange = (w, [a, b]) => between(w, a, b);
function shuffled(w, list) { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand(w) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function applyArchetype(w, c, a, index) {
  const gdp = Math.max(c.gdp, 1);
  Object.assign(c, {
    name: `${word(w)} ${pick(w, a.suffix)}`, regime: pick(w, a.regime), ideology: pick(w, a.ideology), archetype: a.key, motto: '', colors: [COLORS[index % COLORS.length], '#efe6c9'],
    elections: a.elections, nextElection: 4 + Math.floor(rand(w) * 12), pressFreedom: inRange(w, a.press), tariff: jitter(w, a.tariff),
    treasury: gdp * jitter(w, a.treasury), reserves: gdp * jitter(w, a.reserves), debt: gdp * jitter(w, a.debt),
    literacy: inRange(w, a.literacy), bureaucracy: jitter(w, a.bureaucracy, .1), corruption: jitter(w, a.corruption, .15), police: jitter(w, a.police, .1), intelligence: jitter(w, a.intelligence, .12), legitimacy: jitter(w, a.legitimacy, .1), courts: jitter(w, a.courts, .15), unions: a.unions, ownership: a.ownership,
    axes: Object.fromEntries(Object.entries(a.axes).map(([k, r]) => [k, Math.round(inRange(w, r))])),
    budget: Object.fromEntries(Object.entries(a.budget).map(([k, v]) => [k, +jitter(w, v, .12).toFixed(4)])),
    tax: Object.fromEntries(Object.entries(a.tax).map(([k, v]) => [k, +jitter(w, v, .1).toFixed(3)]))
  });
  for (const p of countryProvinces(w, c.id)) { for (const k of Object.keys(p.plants)) p.plants[k] *= a.industry; p.infra = clamp(p.infra * (.7 + a.industry * .3), .15, 1.8); }
  c.tech.ind *= .85 + a.industry * .15;
  for (const g of Object.keys(c.stock)) if (g !== 'grain') c.stock[g] *= a.industry;
  c.stock.arms *= a.arms;
  for (const u of Object.values(w.units)) if (u.country === c.id) { u.men = Math.round(u.men * jitter(w, a.army)); u.loyalty = clamp(jitter(w, a.loyalty, .08), 0, 100); }
  for (const f of Object.values(w.fleets)) if (f.country === c.id) f.ships = Math.max(2, Math.round(f.ships * jitter(w, a.fleet)));
  const leader = w.characters[c.leader];
  leader.axes = Object.fromEntries(Object.entries(c.axes).map(([k, v]) => [k, clamp(v + between(w, -15, 15), -100, 100)]));
  leader.rise = pick(w, a.rise);
}

const borderOf = (w, a, b) => countryProvinces(w, a.id).filter(p => p.id !== a.capital && p.neighbors.some(n => w.provinces[n].controller === b.id));
const neighbours = (w, c) => [...new Set(countryProvinces(w, c.id).flatMap(p => p.neighbors.map(n => w.provinces[n].controller)))].filter(x => x !== c.id && w.countries[x]);

function makePast(w) {
  const past = [], cs = aliveCountries(w), pairs = [];
  const say = (year, text, ...countries) => past.push({ year, text, countries: countries.map(c => c.id) });
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) if (neighbours(w, cs[i]).includes(cs[j].id)) pairs.push([cs[i], cs[j]]);
  for (const [a, b] of shuffled(w, pairs).slice(0, Math.ceil(pairs.length * .7))) {
    const roll = rand(w), year = 1868 + Math.floor(rand(w) * 31);
    if (roll < .5) {
      const [winner, loser] = rand(w) < .5 ? [a, b] : [b, a], spoils = borderOf(w, winner, loser);
      if (!spoils.length) continue;
      const p = pick(w, spoils); p.eth = loser.majorityEth; p.rel = loser.majorityRel; p.unrest = clamp(p.unrest + 12, 0, 100);
      say(year, `${year} savaşında ${p.name} eyaleti ${loser.name} elinden ${winner.name} eline geçti. Halkının çoğu hâlâ ${loser.majorityEth}.`, winner, loser);
      winner.relations[loser.id] = -35; loser.relations[winner.id] = -55;
    } else if (roll < .75) {
      w.treaties.push({ id: nextId(w, 'A'), kind: 'ticaret', parties: [a.id, b.id], active: true, pending: false, proposer: a.id, terms: `${year} ticaret anlaşması`, clauses: [], breaches: [], expires: null, annex: false, reparations: 0, turn: 0 });
      say(year, `${a.name} ile ${b.name} ${year} yılından beri ticaret anlaşmasıyla bağlı.`, a, b);
      a.relations[b.id] = 25; b.relations[a.id] = 25;
    } else {
      say(year, `${year} sınır olaylarında ${a.name} ile ${b.name} askerleri çatıştı, anlaşmazlık çözülmeden kapandı.`, a, b);
      a.relations[b.id] = -20; b.relations[a.id] = -20;
    }
  }
  const lenders = cs.filter(c => ['tacir', 'federasyon'].includes(c.archetype)), debtors = cs.filter(c => ['tarim', 'cunta', 'monarsi'].includes(c.archetype));
  for (const d of debtors) {
    if (!lenders.length) break;
    const l = pick(w, lenders), amount = Math.max(d.gdp, 1) * between(w, .2, .5), year = 1880 + Math.floor(rand(w) * 18);
    d.creditors[l.id] = amount; say(year, `${d.name}, ${year} yılından beri ${l.name} bankalarına ${Math.round(amount)} borçlu.`, d, l);
  }
  for (const c of cs) {
    if (['tarim', 'cunta'].includes(c.archetype) && rand(w) < .7) { const year = 1885 + Math.floor(rand(w) * 13); say(year, `${c.name} ${year} kıtlığında nüfusunun önemli bir bölümünü yitirdi.`, c); }
    const known = k => countryProvinces(w, c.id).some(p => p.deposits[k]?.known);
    for (const k of ['coal', 'iron']) if (!known(k)) {
      const rich = cs.filter(o => o.id !== c.id && countryProvinces(w, o.id).some(p => p.deposits[k]?.known));
      if (rich.length) say(1899, `${c.name} topraklarında bilinen ${GOOD_TR[k]} yatağı yok; bilinen yataklar ${rich.map(o => o.name).join(', ')} elinde.`, c, ...rich);
    }
  }
  return past.sort((a, b) => a.year - b.year);
}

export function inheritStates(w) {
  const cs = aliveCountries(w), bag = shuffled(w, ARCHETYPES);
  cs.forEach((c, i) => applyArchetype(w, c, bag[i % bag.length], i));
  w.past = makePast(w);
  for (let i = 0; i < 8; i++) partyStep(w);
  for (const c of cs) {
    const a = ARCHETYPES.find(x => x.key === c.archetype);
    if (c.elections) makeParliament(c, a.key === 'tacir' ? 'Tacirler Meclisi' : 'Meclis');
    else if (a.advisory) makeParliament(c, a.advisory, false);
  }
}
