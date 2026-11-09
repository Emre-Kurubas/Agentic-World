import { clamp, sum, news, between, rand } from './util.js';
import { CLASSES, GOODS, RAW, BASE_PRICE, GOOD_TR, PLANTS, TECHS, countryProvinces, provincePop, aliveCountries, atWar, hasTreaty } from './world.js';

const RECIPE = {
  steel: { iron: 1, coal: .8 }, fuel: { oil: 1.25 }, fertilizer: { phosphate: 1, coal: .2 },
  machines: { steel: .7, copper: .2 }, goods: { timber: .4, coal: .2, steel: .1 }, arms: { steel: .7, coal: .3 }
};
const ORDER = ['steel', 'fuel', 'fertilizer', 'machines', 'arms', 'goods'];
export const hasTech = (c, t) => !!c.techs?.[t];

// Kural: mal ancak rotası varsa taşınır. Savaş, kapalı boğaz ve düşman filosu rotayı keser.
function seaLocked(w, sea, a, b) {
  const s = w.seaControl?.[sea];
  return !!s && (atWar(w, s, a) || atWar(w, s, b));
}
function straitAt(w, sea) { return w.strategic.find(x => x.type === 'bogaz' && x.ref === sea); }
function canalAdj(w, sea) { return w.canals.filter(k => k.a === sea || k.b === sea).map(k => k.a === sea ? k.b : k.a); }

function seaRoute(w, a, b) {
  const portsA = countryProvinces(w, a.id).filter(p => p.port > 0 && p.controller === a.id).flatMap(p => p.seas);
  const targets = new Set(countryProvinces(w, b.id).filter(p => p.port > 0).flatMap(p => p.seas).filter(x => !seaLocked(w, x, a.id, b.id)));
  if (!portsA.length || !targets.size) return null;
  const prev = {}, q = [];
  for (const s of portsA) if (!(s in prev) && !seaLocked(w, s, a.id, b.id)) { prev[s] = null; q.push(s); }
  while (q.length) {
    const x = q.shift();
    if (targets.has(x)) { const path = []; for (let c = x; c; c = prev[c]) path.unshift(c); return path; }
    for (const n of [...w.seas[x].neighbors, ...canalAdj(w, x)]) {
      if (n in prev) continue;
      const st = straitAt(w, n);
      if (st?.closed && st.controller !== a.id && st.controller !== b.id) continue;
      if (seaLocked(w, n, a.id, b.id)) continue;
      prev[n] = x; q.push(n);
    }
  }
  return null;
}
const landBorder = (w, a, b) => countryProvinces(w, a.id).some(p => p.neighbors.some(n => w.provinces[n].controller === b.id));

export function tradeOpen(w, a, b) { return !!w.routes[routeKey(a.id, b.id)]; }
const routeKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;

export function updateStrategic(w) {
  for (const s of w.strategic) {
    if (s.type === 'bogaz') {
      const sea = w.seas[s.ref], counts = {};
      for (const pid of sea.coast) counts[w.provinces[pid].controller] = (counts[w.provinces[pid].controller] || 0) + 1;
      const fleet = Object.values(w.fleets).filter(f => f.sea === s.ref).sort((a, b) => b.ships - a.ships)[0];
      s.controller = fleet?.country ?? Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      if (!w.countries[s.controller]?.alive) s.controller = null;
      const pol = s.controller ? w.countries[s.controller].straitPolicy?.[s.id] : null;
      s.closed = !!pol?.closed; s.toll = pol?.toll ?? 0;
    } else s.controller = w.provinces[s.ref]?.controller ?? null;
  }
}

export function updateRoutes(w) {
  const cs = aliveCountries(w); w.routes = {};
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
    const a = cs[i], b = cs[j], k = routeKey(a.id, b.id);
    if (a.embargo.includes(b.id) || b.embargo.includes(a.id) || atWar(w, a.id, b.id)) continue;
    if (landBorder(w, a, b)) { w.routes[k] = { mode: 'kara', cost: 1.04, path: [], tolls: [] }; continue; }
    const path = seaRoute(w, a, b);
    if (path) {
      const tolls = path.map(s => straitAt(w, s)).filter(s => s && s.toll && s.controller && ![a.id, b.id].includes(s.controller));
      w.routes[k] = { mode: 'deniz', cost: 1.05 + path.length * .008 + sum(tolls, t => t.toll), path, tolls: tolls.map(t => t.id) };
    }
  }
}

function weatherStep(w) {
  for (const p of Object.values(w.provinces)) p.weather = between(w, .9, 1.08);
  if (rand(w) < .28) {
    const ps = Object.values(w.provinces), core = ps[Math.floor(rand(w) * ps.length)];
    const region = [core, ...core.neighbors.map(n => w.provinces[n])];
    const kind = rand(w) < .7 ? 'kuraklık' : 'sel';
    region.forEach(p => p.weather *= kind === 'kuraklık' ? .55 : .7);
    news(w, `${core.name} çevresinde ${kind}: hasat ciddi biçimde düştü.`, { kind: 'felaket', countries: [core.controller] });
  }
  for (const p of Object.values(w.provinces)) p.waterPenalty = 0;
  for (const p of Object.values(w.provinces)) if (p.dam) { let q = p.downstream ? w.provinces[p.downstream] : null, f = .3, n = 0; while (q && n++ < 12) { q.waterPenalty += f; f *= .8; q = q.downstream ? w.provinces[q.downstream] : null; } }
}

function extract(w, c) {
  const raw = Object.fromEntries(RAW.map(g => [g, 0])); let gold = 0, services = 0, dev = 0, popAll = 0;
  c._cap = Object.fromEntries(Object.keys(PLANTS).map(k => [k, 0]));
  const motor = hasTech(c, 'petrol_motoru') ? 1 + clamp(c.stock.fuel / Math.max(c._lastFuelNeed || 1, 1), 0, 1) * .25 : 1;
  const fert = hasTech(c, 'kimyasal_gubre') ? 1 + clamp(c.stock.fertilizer / Math.max(c._pop * .002, 1), 0, 1) * .4 : 1;
  const strikes = c.strike ? .65 : 1, bank = c.bankHealth < 30 ? .8 : 1;
  c._rent = 0;
  for (const p of countryProvinces(w, c.id)) {
    const occ = p.controller !== p.owner ? .55 : 1;
    const rail = 1 + p.rail * .12 + (hasTech(c, 'elektrik') ? .08 : 0);
    const eff = (1 - p.devastation * .75) * (.72 + p.infra * .36) * occ * (1 - (p.unrest > 60 ? (p.unrest - 60) / 100 : 0)) * rail;
    const water = clamp(p.water - p.waterPenalty + (p.dam ? .15 : 0), .15, 1.4);
    raw.grain += p.pops.koylu.n * p.fertility * water * .03 * c.tech.agri * eff * p.weather * fert * motor + p.fish * p.pops.koylu.n * .002;
    raw.timber += p.pops.koylu.n * p.timber * .006 * eff;
    const deposits = Object.entries(p.deposits).filter(([, d]) => d.known && d.mine > 0 && d.amount > 0);
    const mineLoad = sum(deposits, ([, d]) => d.mine), plantLoad = sum(Object.values(p.plants)) + .3;
    const mineShare = mineLoad / (mineLoad + plantLoad);
    for (const [k, d] of deposits) {
      const q = p.pops.isci.n * mineShare * (d.mine / mineLoad) * d.rich * ({ coal: .3, iron: .22, oil: .12 }[k] ?? .06) * c.tech.ind * eff * strikes;
      d.amount = Math.max(0, d.amount - q * .08);
      const con = p.concessions?.[k];
      if (k === 'gold') { gold += q; continue; }
      const kept = con && w.countries[con.holder]?.alive ? q * (1 - con.share) : q;
      if (con && w.countries[con.holder]?.alive) { const shipped = q - kept; w.countries[con.holder].stock[k] = (w.countries[con.holder].stock[k] || 0) + shipped; }
      raw[k] += kept; c._rent += kept * BASE_PRICE[k] * (k === 'oil' ? 1.4 : 1);
      if (d.amount <= 0) news(w, `${c.name}: ${p.name} ${GOOD_TR[k]} yatağı tükendi.`, { kind: 'ekonomi', countries: [c.id] });
    }
    const labor = p.pops.isci.n * (1 - mineShare), level = sum(Object.values(p.plants));
    if (level > 0) for (const pl of Object.keys(PLANTS)) if (p.plants[pl] > 0) c._cap[pl] += labor * (p.plants[pl] / level) * clamp(.7 + p.plants[pl] * .35, .7, 3) * .05 * 25 / BASE_PRICE[pl] * c.tech.ind * eff * strikes * bank * (1 - c.ownership * .15);
    services += (p.pops.orta.n + p.pops.elit.n * 1.5) * eff;
    const pop = provincePop(p); popAll += pop; dev += p.devastation * pop;
  }
  c._pop = popAll; c._dev = popAll ? dev / popAll : 0; c._raw = raw; c._services = services;
  c.reserves += gold * 12;
  for (const g of RAW) c.stock[g] = (c.stock[g] || 0) + raw[g];
}

function needs(w, c) {
  const need = {}; for (const g of GOODS) need[g] = 0;
  for (const [pl, rec] of Object.entries(RECIPE)) for (const [g, q] of Object.entries(rec)) need[g] += c._cap[pl] * q;
  const men = sum(Object.values(w.units).filter(u => u.country === c.id), u => u.men);
  const motor = sum(Object.values(w.units).filter(u => u.country === c.id && ['zirhli', 'hava'].includes(u.kind)), u => u.men);
  const ships = sum(Object.values(w.fleets).filter(f => f.country === c.id), f => f.ships);
  need.grain += c._pop * .01; need.goods += c._pop * .004; need.coal += c._pop * .001 + (hasTech(c, 'petrol_motoru') ? 0 : ships * .08);
  need.arms += men * .01; need.fuel += motor * .05 + (hasTech(c, 'petrol_motoru') ? ships * .08 + c._pop * .0006 : 0); need.machines += c._pop * .00008;
  if (hasTech(c, 'kimyasal_gubre')) need.fertilizer += c._pop * .002;
  if (hasTech(c, 'nadir_metal')) need.rare += sum(Object.values(w.units).filter(u => u.country === c.id && ['zirhli', 'hava'].includes(u.kind)), u => u.men) * .004 + c._cap.machines * .05;
  c._need = need; c._lastFuelNeed = need.fuel;
  c._reserve = Object.fromEntries(GOODS.map(g => [g, need[g] * .4]));
}

function trade(w, cs) {
  w.tradeFlows = {};
  const key = routeKey;
  for (const g of GOODS) {
    const sellers = cs.map(c => ({ c, s: Math.max(0, c.stock[g] - c._need[g] - c._reserve[g]) })).filter(x => x.s > 0);
    const buyers = cs.map(c => ({ c, d: Math.max(0, c._need[g] + c._reserve[g] * .5 - c.stock[g]) })).filter(x => x.d > 0);
    const price = w.globalPrice[g]; let wanted = sum(buyers, b => b.d), moved = 0; const offered = sum(sellers, s => s.s);
    for (let pass = 0; pass < 2; pass++) for (const b of buyers) {
      if (b.d <= 0) continue;
      const acc = sellers.map(x => ({ x, r: w.routes[key(b.c.id, x.c.id)] })).filter(a => a.x.s > 0 && a.x.c.id !== b.c.id && a.r);
      const wgt = a => a.x.s / a.r.cost * (hasTreaty(w, b.c.id, a.x.c.id, 'ticaret') ? 1.5 : 1), tot = sum(acc, wgt);
      if (!tot) continue;
      for (const a of acc) {
        const landed = price * a.r.cost * (1 + (b.c.tariffDeals?.[a.x.c.id] ?? b.c.tariff) * .3);
        const q = Math.min(a.x.s, b.d * wgt(a) / tot, Math.max(0, b.c.reserves) / landed);
        if (q <= 0) continue;
        const v = q * price; a.x.s -= q; b.d -= q; moved += q;
        a.x.c.stock[g] -= q; b.c.stock[g] += q; a.x.c.reserves += v; b.c.reserves -= q * landed;
        a.x.c._exports = (a.x.c._exports || 0) + v; b.c._imports = (b.c._imports || 0) + v;
        a.x.c._rawExp = (a.x.c._rawExp || 0) + (RAW.includes(g) && g !== 'grain' ? v : 0);
        for (const tid of a.r.tolls) { const t = w.strategic.find(s => s.id === tid); if (t?.controller) { const fee = v * t.toll; w.countries[t.controller].reserves += fee; w.countries[t.controller]._tolls = (w.countries[t.controller]._tolls || 0) + fee; } }
        const k = key(b.c.id, a.x.c.id); (w.tradeFlows[k] ||= {}); w.tradeFlows[k][g] = (w.tradeFlows[k][g] || 0) + v;
      }
    }
    const unmet = wanted > 0 ? clamp((wanted - moved) / wanted, 0, 1) : 0;
    const before = w.globalPrice[g], D = sum(cs, c => c._need[g]) + 1, S = sum(cs, c => c.stock[g]) + moved * .2 + 1;
    const target = BASE_PRICE[g] * clamp(Math.pow(D / S * 1.6, .8), .4, 5) * (1 + unmet * .9);
    w.globalPrice[g] = clamp(before + (target - before) * .4, BASE_PRICE[g] * .3, BASE_PRICE[g] * 9);
    if (w.globalPrice[g] > before * 1.5 && before > BASE_PRICE[g]) news(w, `Dünya ${GOOD_TR[g]} fiyatı sert yükseldi.`, { kind: 'ekonomi' });
  }
}

function factories(w, c) {
  const made = {};
  const armsPriority = clamp(c.armShare * 4, .2, 1);
  for (const pl of ORDER) {
    const cap = c._cap[pl] * (pl === 'arms' ? armsPriority : 1), rec = RECIPE[pl];
    if (pl === 'fuel' && !hasTech(c, 'petrol_arama') && !c.stock.oil) { made[pl] = 0; continue; }
    let r = cap;
    for (const [g, q] of Object.entries(rec)) r = Math.min(r, (c.stock[g] || 0) / q);
    r = Math.max(0, r);
    for (const [g, q] of Object.entries(rec)) c.stock[g] -= r * q;
    c.stock[pl] = (c.stock[pl] || 0) + r; made[pl] = r;
  }
  const cap = sum(Object.keys(RECIPE), pl => c._cap[pl] * BASE_PRICE[pl]);
  c.inputRatio = cap > 0 ? clamp(sum(Object.keys(RECIPE), pl => (made[pl] || 0) * BASE_PRICE[pl]) / cap, 0, 1) : 1;
  c._made = made;
}

export function economyStep(w) {
  updateStrategic(w); updateRoutes(w); weatherStep(w);
  const cs = aliveCountries(w), prevReal = Object.fromEntries(cs.map(c => [c.id, c.realGdp]));
  for (const c of cs) { extract(w, c); needs(w, c); }
  trade(w, cs);
  w.priceHistory.push(Object.fromEntries(GOODS.map(g => [g, Math.round(w.globalPrice[g] * 10) / 10])));
  if (w.priceHistory.length > 200) w.priceHistory.shift();
  for (const c of cs) {
    factories(w, c);
    consume(w, c, prevReal[c.id]);
    fiscal(w, c); demography(w, c); investment(w, c); research(w, c);
    for (const k of ['_exports', '_imports', '_rawExp', '_tolls']) delete c[k];
  }
  epidemicStep(w);
}

function consume(w, c, prev) {
  const n = c._need;
  c.foodRatio = n.grain > 0 ? clamp(c.stock.grain / (c._pop * .01), 0, 1.2) : 1;
  c.stock.grain = Math.max(0, c.stock.grain - c._pop * .01) * .96;
  const consumer = clamp(c.stock.goods / Math.max(c._pop * .004, 1), 0, 1.2);
  c.stock.goods = Math.max(0, c.stock.goods - c._pop * .004) * .96;
  c.stock.coal = Math.max(0, c.stock.coal - c._pop * .001);
  if (hasTech(c, 'petrol_motoru')) { c.fuelRatio = clamp(c.stock.fuel / Math.max(n.fuel, .1), 0, 1.2); c.stock.fuel = Math.max(0, c.stock.fuel - c._pop * .0006); } else c.fuelRatio = 1;
  const rawV = sum(RAW, g => c._raw[g] * BASE_PRICE[g]), madeV = sum(Object.keys(RECIPE), g => (c._made[g] || 0) * BASE_PRICE[g] * .45);
  const real = rawV + madeV + c._services, g = prev > 0 ? real / prev - 1 : 0;
  c.realGdp = real; c.growth = g;
  const prevM = c._lastMoney ?? c.money, mg = prevM > 0 ? c.money / prevM - 1 : 0; c._lastMoney = c.money;
  const shortage = Math.max(0, 1 - Math.min(c.foodRatio, 1)) * .55 + Math.max(0, 1 - Math.min(consumer, 1)) * .25 + (hasTech(c, 'petrol_motoru') ? Math.max(0, 1 - Math.min(c.fuelRatio, 1)) * .18 : 0);
  c.inflation = clamp(.35 * c.inflation + .85 * (mg - g * .6) + shortage * .4 + (c.reserves < 0 ? .03 : 0) + (c.bankHealth < 30 ? .02 : 0) + .004, -.04, 4);
  c.priceLevel *= 1 + c.inflation; c.wageIndex += (c.priceLevel - c.wageIndex) * .35;
  c.gdp = real * c.priceLevel; c.money *= 1 + Math.max(0, g) * .6 + .002;
  c.fx = Math.round(100 / c.priceLevel * 100) / 100;
  c.unemployment += (clamp(.06 + (1 - c.inputRatio) * .3 + c._dev * .3 + Math.max(0, -g) * .9, .02, .6) - c.unemployment) * .4;
  // Kaynak gelirine bağımlılık: kolay para yolsuzluğu ve oligarkları besler, sanayiyi zayıflatır.
  c.rentShare = clamp((c._rent || 0) / Math.max(real, 1), 0, 1);
  if (c.rentShare > .22) { c.corruption = clamp(c.corruption + (c.rentShare - .22) * 2.2, 2, 95); const o = w.characters[c.oligarch]; if (o?.alive) { o.wealth += c.rentShare * 5; o.power = clamp(o.power + c.rentShare * .3, 0, 95); } for (const p of countryProvinces(w, c.id)) if (p.eth !== c.majorityEth && Object.values(p.deposits).some(d => d.known && d.mine > 0)) p.unrest = clamp(p.unrest + 2.2, 0, 100); }
  c.bankHealth = clamp(c.bankHealth + (c.inflation > .15 ? -6 : 1.2) + (c.reserves < 0 ? -4 : 0) + (g < -.08 ? -4 : 0), 0, 100);
  if (c.bankHealth < 30 && !c.bankCrisis) { c.bankCrisis = true; news(w, `${c.name}: bankalara hücum başladı, kredi kuruyor.`, { kind: 'ekonomi', countries: [c.id] }); } if (c.bankHealth > 45) c.bankCrisis = false;
  const klass = sum(countryProvinces(w, c.id), p => p.pops.isci.sat * p.pops.isci.n) / Math.max(sum(countryProvinces(w, c.id), p => p.pops.isci.n), 1);
  const was = c.strike; c.strike = c.unions && klass < 32 && rand(w) < .6;
  if (c.strike && !was) news(w, `${c.name}: genel grev sanayiyi durdurdu.`, { kind: 'siyaset', countries: [c.id] });
}

function fiscal(w, c) {
  const eff = clamp((.4 + c.bureaucracy / 120) * (1 - c.corruption / 130) * (1 - c.unrest / 400), .2, 1);
  const land = c._raw.grain * 10 * c.priceLevel * c.tax.land, business = (sum(RAW.filter(g => g !== 'grain'), g => c._raw[g] * BASE_PRICE[g]) + sum(Object.keys(RECIPE), g => (c._made[g] || 0) * BASE_PRICE[g] * .45)) * c.priceLevel * c.tax.business;
  const revenue = (c.gdp * .45 * c.tax.income + land + business + (c._imports || 0) * c.priceLevel * c.tariff) * eff + (c._tolls || 0) * c.priceLevel;
  const b = c.budget, programs = (b.military + b.welfare + b.infrastructure + b.education + b.police + b.administration) * c.gdp;
  c.interestRate = clamp(.012 + Math.max(0, c.debt / Math.max(c.gdp * 4, 1) - .5) * .05 + c.inflation * .6 + (c.defaulted ? .04 : 0) + (c.bankHealth < 30 ? .02 : 0), .005, .35);
  const interest = c.debt * c.interestRate;
  // Yabancı alacaklılar faizini döviz olarak alır.
  for (const [cid, amt] of Object.entries(c.creditors)) if (w.countries[cid]?.alive) { const pay = Math.min(Math.max(c.reserves, 0), amt * c.interestRate); c.reserves -= pay; w.countries[cid].reserves += pay; }
  const need = programs + interest; let cash = c.treasury + revenue, paid = 1;
  if (cash >= need) cash -= need;
  else {
    const gap = need - cash, capacity = Math.max(0, c.gdp * 4 * (1.1 + c.legitimacy / 100) - c.debt), borrow = Math.min(gap, c.defaulted ? capacity * .1 : capacity * .35);
    c.debt += borrow; cash += borrow;
    if (cash < need) {
      paid = need > 0 ? clamp(cash / need, 0, 1) : 1; cash = 0; c.arrears = clamp(c.arrears + (1 - paid), 0, 6);
      if (paid < .55 && !c.defaulted && c.debt > c.gdp * 4 * .9) {
        c.defaulted = true; c.debt *= .55; c.reserves *= .7; c.bankHealth = clamp(c.bankHealth - 30, 0, 100);
        for (const [cid, amt] of Object.entries(c.creditors)) { const o = w.countries[cid]; if (o?.alive) { o.relations[c.id] = clamp((o.relations[c.id] ?? 0) - 40, -100, 100); o.bankHealth = clamp(o.bankHealth - 12, 0, 100); o.reserves -= amt * .15; } c.creditors[cid] = amt * .55; }
        news(w, `${c.name} borçlarını ödeyemeyeceğini açıkladı; alacaklı ülkeler öfkeli.`, { kind: 'ekonomi', countries: [c.id] });
      }
    } else { cash -= need; c.arrears = Math.max(0, c.arrears - .5); }
  }
  c.treasury = cash; if (paid === 1) c.arrears = Math.max(0, c.arrears - .5);
  c.lastRevenue = revenue; c.lastSpending = need * paid; c.paidRatio = paid;
  c.bureaucracy = clamp(c.bureaucracy + (b.administration * paid - .018) * 60 - (paid < .8 ? 1 : 0), 10, 95);
  c.police = clamp(c.police + (b.police * paid - .011) * 200, 5, 95);
  c.corruption = clamp(c.corruption + (paid < .8 ? 1.2 : -.1) + (c.pressFreedom < 30 ? .25 : -.05) - (c.courts - 45) * .004, 2, 95);
  c.literacy = clamp(c.literacy + (b.education * paid - .015) * 25, 5, 99);
}

function demography(w, c) {
  const provs = countryProvinces(w, c.id), gap = Math.max(0, 1 - c.foodRatio); let starved = 0, fled = 0;
  for (const p of provs) {
    const welfare = 1 + c.budget.welfare;
    for (const k of CLASSES) { const pop = p.pops[k], sev = k === 'elit' ? .1 : k === 'orta' ? .5 : 1, lost = pop.n * gap * .09 * sev / welfare; starved += lost; pop.n = Math.max(1, pop.n * (1 + .0035 * (c.foodRatio >= 1 ? 1 : .4)) - lost); }
    // Şehirleşme okuryazarlık ve sanayiyle gelir.
    const mv = p.pops.koylu.n * clamp((sum(Object.values(p.plants)) - .3) * .002 + c.literacy * .00002, 0, .01); p.pops.koylu.n -= mv; p.pops.isci.n += mv * .8; p.pops.orta.n += mv * .2;
    if (gap > .12 || p.devastation > .45) {
      const outs = p.neighbors.map(n => w.provinces[n]).filter(n => (n.controller !== p.controller && !atWar(w, n.controller, p.controller)) || (n.controller === p.controller && n.devastation < p.devastation - .1));
      if (outs.length) { const rate = clamp(gap * .12 + p.devastation * .04, 0, .1); for (const k of ['koylu', 'isci']) { const m = p.pops[k].n * rate; p.pops[k].n -= m; fled += m; const to = outs[Math.floor(rand(w) * outs.length)]; to.pops[k].n += m; to.unrest = clamp(to.unrest + m / Math.max(provincePop(to), 1) * 120, 0, 100); } }
    }
    p.devastation = Math.max(0, p.devastation - .02 - c.budget.infrastructure * .4);
  }
  if (starved > 8) news(w, `${c.name}: kıtlık yaklaşık ${Math.round(starved)} bin can aldı.${fled > 5 ? ` ${Math.round(fled)} bin kişi yerinden oldu.` : ''}`, { kind: 'felaket', countries: [c.id] });
  c.starved = starved; c.fled = fled;
}

function investment(w, c) {
  const b = c.budget, paid = c.paidRatio, machines = clamp(c.stock.machines / Math.max(c._pop * .00016, 1), 0, 1), bank = c.bankHealth < 30 ? .3 : 1;
  c.stock.machines = Math.max(0, c.stock.machines - c._pop * .00008);
  for (const p of countryProvinces(w, c.id)) {
    p.infra = clamp(p.infra + (b.infrastructure * paid - .018) * .5, .15, 1.8);
    const grow = 1 + (b.infrastructure * paid - .015) * .35 * machines * bank;
    for (const pl of Object.keys(PLANTS)) p.plants[pl] = clamp(p.plants[pl] * grow, 0, 8);
  }
  // Yeni teknoloji gelince özel sektör ilk tesisleri kendi kurar; büyütmek devlete veya sermayeye kalır.
  const cap = w.provinces[c.capital];
  if (cap && hasTech(c, 'petrol_arama') && !sum(countryProvinces(w, c.id), p => p.plants.fuel)) cap.plants.fuel = .4;
  if (cap && hasTech(c, 'kimyasal_gubre') && !sum(countryProvinces(w, c.id), p => p.plants.fertilizer)) cap.plants.fertilizer = .4;
  const edu = (b.education * paid - .015) * .12 * (.5 + c.literacy / 100);
  c.tech.ind = clamp(c.tech.ind * (1 + edu + .001 * (.5 + machines)), .5, 10);
  c.tech.agri = clamp(c.tech.agri * (1 + edu * .7 + .0008), .5, 10);
  c.tech.mil = clamp(c.tech.mil * (1 + edu * .6 + b.military * paid * .02), .5, 10);
}

function research(w, c) {
  const points = (c.budget.education * c.paidRatio * 180 + c.literacy * .06) * (c.bankHealth < 30 ? .7 : 1);
  let t = c.research.target;
  if (!t || c.techs[t]) t = Object.keys(TECHS).find(k => !c.techs[k] && TECHS[k].req.every(r => c.techs[r])) || null;
  c.research.target = t; if (!t) return;
  // Komşular buluşu duydukça maliyet düşer.
  const known = aliveCountries(w).filter(o => o.techs[t]).length;
  c.research.progress += points * (1 + known * .15);
  if (c.research.progress >= TECHS[t].cost) {
    c.techs[t] = w.turn; c.research = { target: null, progress: 0 };
    news(w, `${c.name}: ${TECHS[t].name} başarıyla uygulamaya geçti.`, { kind: 'ekonomi', countries: [c.id] });
    if (t === 'petrol_arama') for (const p of countryProvinces(w, c.id)) if (p.deposits.oil && rand(w) < .35) p.deposits.oil.known = true;
  }
}

function epidemicStep(w) {
  if (rand(w) < .05 + sum(aliveCountries(w), c => c.starved > 30 ? .03 : 0)) {
    const ps = Object.values(w.provinces), start = ps[Math.floor(rand(w) * ps.length)];
    w.epidemics.push({ name: 'Salgın', active: true, start: w.turn, provinces: { [start.id]: .5 } });
    news(w, `${start.name} kentinde bulaşıcı salgın başladı.`, { kind: 'felaket', countries: [start.controller] });
  }
  for (const e of w.epidemics.filter(x => x.active)) {
    const next = {};
    for (const [id, v] of Object.entries(e.provinces)) {
      const p = w.provinces[id], c = w.countries[p.controller]; if (!c?.alive) continue;
      const med = hasTech(c, 'antibiyotik') ? .4 : 1, care = 1 - clamp(c.budget.welfare * 3, 0, .4);
      for (const k of CLASSES) p.pops[k].n *= 1 - v * .025 * med * care;
      p.unrest = clamp(p.unrest + v * 2, 0, 100);
      const decay = v - .12;
      if (decay > .05) next[id] = Math.max(next[id] || 0, decay);
      for (const n of p.neighbors) if (rand(w) < v * (.25 + w.provinces[n].rail * .15)) next[n] = Math.max(next[n] || 0, v * .8);
      if (p.port && rand(w) < v * .25) { const far = Object.values(w.provinces).filter(x => x.port); const f = far[Math.floor(rand(w) * far.length)]; if (f) next[f.id] = Math.max(next[f.id] || 0, v * .7); }
    }
    e.provinces = next; if (!Object.keys(next).length || w.turn - e.start > 16) { e.active = false; }
  }
  w.epidemics = w.epidemics.filter(e => e.active || w.turn - e.start < 12);
}
