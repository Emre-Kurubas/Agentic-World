// Şirketler: fabrika ve madenlerin gerçek sahipleri. Kâr, iç piyasa fiyatlarından çıkar; sahibi ne yapacağına kendi karar verir.
import { clamp, news, nextId, rand } from './util.js';
import { PLANTS, BASE_PRICE, GOOD_TR, DEPOSITS, aliveCountries, countryProvinces } from './world.js';
import { RECIPE } from './economy.js';

const SCALE = .05, MAX_PER_COUNTRY = 14, BANKRUPT_TURNS = 6;
export const STATE = 'devlet';
export const isOpen = f => f.status === 'acik';
const sectorName = f => f.sector === 'maden' ? `${GOOD_TR[f.resource]} madeni` : PLANTS[f.sector];
export const ownerName = (w, f) => f.owner === STATE ? 'devlet' : w.characters[f.owner]?.name ?? 'halka açık';

function capacity(w, f) { const p = w.provinces[f.province]; return f.sector === 'maden' ? p.deposits[f.resource]?.mine ?? 0 : p.plants[f.sector] ?? 0; }
export const firmValue = (w, f) => Math.max(f.cash, 0) + f.stake * capacity(w, f) * 40;

function setCapacity(w, f, next) {
  const p = w.provinces[f.province], old = capacity(w, f), add = next - old;
  if (f.sector === 'maden') p.deposits[f.resource].mine = next; else p.plants[f.sector] = next;
  for (const o of Object.values(w.firms)) if (o !== f && isOpen(o) && o.province === f.province && o.sector === f.sector && o.resource === f.resource) o.stake = next > 0 ? o.stake * old / next : 0;
  f.stake = next > 0 ? (f.stake * old + add) / next : 0;
}

function makeFirm(w, c, p, sector, resource, owner, stake, name) {
  const f = { id: nextId(w, 'SR'), name, country: c.id, province: p.id, sector, resource: resource ?? null, stake, owner, cash: 0, lastProfit: 0, founded: w.turn, status: 'acik', bad: 0, offer: null };
  w.firms[f.id] = f;
  return f;
}

export function initFirms(w) {
  w.firms = {};
  for (const c of aliveCountries(w)) {
    const spots = [];
    for (const p of countryProvinces(w, c.id)) {
      for (const k of Object.keys(PLANTS)) if (p.plants[k] > .05) spots.push({ p, sector: k, size: p.plants[k] * BASE_PRICE[k] });
      for (const [k, d] of Object.entries(p.deposits)) if (d.known && d.mine > 0 && k !== 'gold') spots.push({ p, sector: 'maden', resource: k, size: d.mine * d.rich * BASE_PRICE[k] * 2 });
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
  if (ch?.alive && ch.status === 'serbest') return;
  const heir = w.characters[c.oligarch];
  f.owner = heir?.alive && heir.id !== f.owner ? heir.id : null;
  f.offer = null;
}

function unitProfit(c, f, p) {
  const price = c.prices?.[f.sector === 'maden' ? f.resource : f.sector] ?? 0;
  if (f.sector === 'maden') {
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
    f.lastProfit = +profit.toFixed(2);
    f.bad = profit < 0 ? f.bad + 1 : 0;
    if (profit > 0) {
      const dividend = profit * .4; f.cash += profit - dividend;
      const owner = w.characters[f.owner];
      if (f.owner === STATE) c.treasury += dividend * (c.rate || 1);
      else if (owner) {
        owner.wealth += dividend;
        if (owner.country !== f.country) { const paid = Math.min(Math.max(c.reserves, 0), dividend); c.reserves -= paid; if (w.countries[owner.country]?.alive) w.countries[owner.country].reserves += paid; }
      }
    } else f.cash += profit;
    if (f.bad >= BANKRUPT_TURNS && f.cash < 0) bankrupt(w, f, c, p);
  }
  pruneFirms(w);
}

function bankrupt(w, f, c, p) {
  const cap = capacity(w, f); setCapacity(w, f, cap * (1 - .35 * f.stake));
  f.status = 'iflas'; f.closedAt = w.turn; f.stake = 0; f.offer = null;
  w.characters[f.owner]?.inbox.push({ turn: w.turn, from: 'Mahkeme', text: `${f.name} iflas etti.` });
  news(w, `${c.name}: ${f.name} iflas etti, ${p.name} eyaletinde işçiler çıkarıldı.`, { kind: 'ekonomi', countries: [c.id] });
  p.unrest = clamp(p.unrest + 4, 0, 100);
}

function pruneFirms(w) {
  for (const [id, f] of Object.entries(w.firms || {})) if (!isOpen(f) && w.turn - f.closedAt > 40) delete w.firms[id];
}

const openCount = (w, id) => Object.values(w.firms).filter(f => isOpen(f) && f.country === id).length;

export function firmOp(w, actor, c, op, fail, ok, tell, leaveTrace, num) {
  const firm = w.firms?.[op.id], isHead = actor.id === c.leader;
  switch (op.op) {
    case 'found_company': {
      const p = w.provinces[op.province]; if (!p) return fail('Eyalet yok.');
      const host = w.countries[p.controller], sector = op.sector, mine = sector === 'maden';
      if (!host?.alive) return fail('Burada şirket kurulamaz.');
      if (host.id !== c.id && host.capitalClosed) return fail('Bu ülke yabancı sermayeye kapalı.');
      if (!mine && !PLANTS[sector]) return fail('Sektör yok.');
      if (mine && (!DEPOSITS.includes(op.resource) || op.resource === 'gold' || !p.deposits[op.resource]?.known)) return fail('Bilinen yatak yok.');
      if (openCount(w, host.id) >= MAX_PER_COUNTRY) return fail('Bu ülkede kayıt yeri kalmadı.');
      const state = isHead && op.state === true, amount = num(op.amount, 1, state ? Math.max(c.treasury, 0) : actor.wealth, 0);
      if (amount < 1) return fail('Sermaye yetersiz.');
      if (state) c.treasury -= amount; else actor.wealth -= amount;
      const f = makeFirm(w, host, p, sector, mine ? op.resource : null, state ? STATE : actor.id, 0, String(op.name || '').slice(0, 60) || `${p.name} Şirketi`);
      setCapacity(w, f, capacity(w, f) + amount * (mine ? .002 : .004));
      f.cash = amount * .25;
      news(w, `${host.name}: ${f.name} kuruldu.`, { kind: 'ekonomi', countries: [host.id] });
      return { ok: true, msg: `Şirket kuruldu: ${f.id}`, firm: f.id };
    }
    case 'invest_company': {
      if (!firm || !isOpen(firm)) return fail('Şirket yok.');
      const state = firm.owner === STATE && isHead;
      if (firm.owner !== actor.id && !state) return fail('Bu şirket senin değil.');
      const amount = num(op.amount, 0, state ? Math.max(c.treasury, 0) : actor.wealth, 0); if (amount <= 0) return fail('Para yok.');
      if (state) c.treasury -= amount; else actor.wealth -= amount;
      firm.cash += amount * .25; setCapacity(w, firm, capacity(w, firm) + amount * (firm.sector === 'maden' ? .002 : .004));
      return ok();
    }
    case 'sell_company': {
      if (!firm || !isOpen(firm) || firm.owner !== actor.id) return fail('Bu şirket senin değil.');
      const buyer = w.characters[op.buyer]; if (!buyer?.alive) return fail('Alıcı yok.');
      firm.offer = { buyer: buyer.id, price: num(op.price, 0, 1e9, firmValue(w, firm)) };
      tell(w, buyer, actor.name, `${firm.name} (${firm.id}) şirketini ${Math.round(firm.offer.price)} karşılığında sana satmayı teklif ediyor.`);
      return ok();
    }
    case 'buy_company': {
      if (!firm || !isOpen(firm)) return fail('Şirket yok.');
      const agreed = firm.offer?.buyer === actor.id, open = firm.owner == null;
      if (!agreed && !open) return fail('Satış teklifi yok.');
      const price = agreed ? firm.offer.price : firmValue(w, firm);
      if (actor.wealth < price) return fail('Servet yetmiyor.');
      const seller = w.characters[firm.owner]; actor.wealth -= price; if (seller) { seller.wealth += price; tell(w, seller, actor.name, `${firm.name} satıldı, ${Math.round(price)} aldın.`); }
      firm.owner = actor.id; firm.offer = null; leaveTrace(w, actor, `${firm.name} şirketini satın aldı.`);
      return ok();
    }
    case 'nationalize_company': {
      if (!isHead) return fail('Yalnızca lider el koyabilir.');
      if (!firm || !isOpen(firm) || firm.country !== c.id || firm.owner === STATE) return fail('El konacak şirket yok.');
      const owner = w.characters[firm.owner];
      if (owner) { tell(w, owner, c.name, `${firm.name} şirketine devlet el koydu.`); if (owner.country !== c.id && w.countries[owner.country]) w.countries[owner.country].relations[c.id] = clamp((w.countries[owner.country].relations[c.id] ?? 0) - 25, -100, 100); }
      firm.owner = STATE; firm.offer = null; c.ownership = clamp(c.ownership + .02, 0, 1); c.blocs.sermaye.sat = clamp(c.blocs.sermaye.sat - 5, 0, 100);
      news(w, `${c.name}: ${firm.name} devletleştirildi.`, { kind: 'ekonomi', countries: [c.id] });
      return ok();
    }
    case 'privatize_company': {
      if (!isHead) return fail('Yalnızca lider satabilir.');
      if (!firm || !isOpen(firm) || firm.owner !== STATE || firm.country !== c.id) return fail('Devlet şirketi yok.');
      const buyer = w.characters[op.buyer]; if (!buyer?.alive) return fail('Alıcı yok.');
      const price = num(op.price, 0, 1e9, firmValue(w, firm)); if (buyer.wealth < price) return fail('Alıcının parası yetmiyor.');
      buyer.wealth -= price; c.treasury += price * (c.rate || 1); firm.owner = buyer.id; c.ownership = clamp(c.ownership - .02, 0, 1);
      leaveTrace(w, actor, `${firm.name} şirketini ${buyer.name} kişisine ${Math.round(price)} karşılığı sattı.`); tell(w, buyer, c.name, `${firm.name} artık senin.`);
      return ok();
    }
    default: return fail('Bilinmeyen şirket işlemi.');
  }
}
