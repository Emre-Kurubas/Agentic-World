import { clamp, sum, news, rand, between, nextId, pick } from './util.js';
import { CLASSES, ROLES, countryProvinces, provincePop, aliveCountries, makeCountry, spawnCharacter, atWar, clampRel } from './world.js';
import { allocateSeats } from './polity.js';
import { issueCurrency } from './money.js';

const CLASS_AXES = { koylu: { econ: -15, auth: 15, nation: 15, faith: 35 }, isci: { econ: -55, auth: -10, nation: 5, faith: 0 }, orta: { econ: 20, auth: -35, nation: 0, faith: -10 }, elit: { econ: 65, auth: 25, nation: 15, faith: 10 } };

export const distance = (a, b) => (Math.abs(a.econ - b.econ) * 1.2 + Math.abs(a.auth - b.auth) + Math.abs(a.nation - b.nation) * .5 + Math.abs(a.faith - b.faith) * .8) / 3.5;

export function modValue(c, key) { return sum(c.mods.filter(m => m.key === key), m => m.delta); }

export function satisfactionStep(w) {
  for (const c of aliveCountries(w)) {
    const inWar = w.wars.some(x => x.active && (x.a.includes(c.id) || x.b.includes(c.id)));
    const realWage = c.wageIndex / c.priceLevel;
    let unrestSum = 0, popSum = 0;
    for (const p of countryProvinces(w, c.id)) {
      for (const k of CLASSES) {
        const pop = p.pops[k];
        const tax = k === 'koylu' ? c.tax.land : k === 'elit' ? c.tax.business : c.tax.income;
        let t = 66;
        t -= Math.max(0, 1 - c.foodRatio) * (k === 'elit' ? 12 : 95);
        t -= Math.min(38, Math.max(0, c.inflation - .02) * 160);
        t -= (k === 'elit' ? 1.5 : 1) * Math.max(0, tax - .12) * 70;
        t += (realWage - 1) * (k === 'elit' ? 15 : 55);
        if (k === 'isci' || k === 'orta') t -= c.unemployment * 75;
        t += (c.budget.welfare - .03) * (k === 'elit' ? -60 : 200);
        t += (c.growth || 0) * 60;
        t -= distance(c.axes, CLASS_AXES[k]) * .32;
        t -= p.devastation * 28;
        t -= c.warExhaustion * .22;
        t += (c.legitimacy - 50) * .14;
        if (k === 'orta') t += (c.pressFreedom - 50) * .12;
        if (k === 'elit') t -= c.ownership * 30;
        if (p.controller !== p.owner) t -= 18;
        if (p.eth !== c.majorityEth) t -= Math.max(0, c.axes.nation) * .22 + 3;
        if (p.rel !== c.majorityRel) t -= Math.max(0, c.axes.faith) * .18 + 2;
        t += modValue(c, `sat.${k}`) + modValue(c, 'sat.all');
        pop.sat = clamp(pop.sat + (clamp(t, 0, 100) - pop.sat) * .28, 0, 100);
      }
      const pp = provincePop(p);
      const meanSat = CLASSES.reduce((a, k) => a + p.pops[k].sat * p.pops[k].n, 0) / Math.max(pp, 1);
      const pressure = 88 - meanSat * 1.3 + (c.pressFreedom > 70 ? 3 : 0) - c.police * .13 - c.repress * .35 + modValue(c, 'unrest');
      p.unrest = clamp(p.unrest + (clamp(pressure, 0, 100) - p.unrest) * .35, 0, 100);
      unrestSum += p.unrest * pp; popSum += pp;
    }
    c.unrest = popSum ? unrestSum / popSum : 0;
    updateBlocs(w, c, inWar);
    c.repress = Math.max(0, c.repress - 6);
    const meanPop = weightedSat(w, c);
    c.popularity = meanPop;
    const legitTarget = clamp(22 + meanPop * .75 + (c.growth || 0) * 40 - c.arrears * 4, 5, 95);
    c.legitimacy = clamp(c.legitimacy + (legitTarget - c.legitimacy) * .1 + modValue(c, 'legitimacy'), 0, 100);
    c.mods = c.mods.map(m => ({ ...m, turns: m.turns - 1 })).filter(m => m.turns > 0);
    c.tension = clamp(c.unrest * .55 + (100 - c.legitimacy) * .3 + (100 - c.blocs.ordu.sat) * .25 + w.plots.filter(x => x.active && x.country === c.id).length * 10 + (inWar ? 10 : 0), 0, 100);
  }
}

function weightedSat(w, c) {
  let s = 0, n = 0;
  for (const p of countryProvinces(w, c.id)) for (const k of CLASSES) { s += p.pops[k].sat * p.pops[k].n; n += p.pops[k].n; }
  return n ? s / n : 50;
}
const classSat = (w, c, k) => { let s = 0, n = 0; for (const p of countryProvinces(w, c.id)) { s += p.pops[k].sat * p.pops[k].n; n += p.pops[k].n; } return n ? s / n : 50; };

function updateBlocs(w, c, inWar) {
  const b = c.blocs, funding = c.militaryFunding ?? 1;
  const set = (x, t) => { x.sat = clamp(x.sat + (clamp(t, 0, 100) - x.sat) * .3, 0, 100); };
  set(b.ordu, 56 + (funding - .9) * 45 - c.arrears * 9 - c.warExhaustion * .25 + (c.axes.auth * .08) + modValue(c, 'sat.ordu'));
  set(b.sermaye, 62 - (c.tax.business - .18) * 110 - c.ownership * 50 - Math.max(0, c.inflation - .03) * 110 + c.axes.econ * .16 + (c.growth || 0) * 150 + modValue(c, 'sat.sermaye'));
  set(b.isciler, classSat(w, c, 'isci'));
  set(b.koyluler, classSat(w, c, 'koylu'));
  set(b.din, 55 + c.axes.faith * .28 + modValue(c, 'sat.din'));
  set(b.burokrasi, 58 + ((c.paidRatio ?? 1) - .95) * 90 - c.corruption * .1 + modValue(c, 'sat.burokrasi'));
  b.ordu.power = clamp(22 + c.budget.military * 340 + c.axes.auth * .08 + (inWar ? 8 : 0), 10, 60);
}

export function canSplit(w, c) {
  return countryProvinces(w, c.id).length >= 4 && w.turn >= (c.noSplitUntil ?? 0) && !w.wars.some(x => x.active && x.civil && (x.a.includes(c.id) || x.b.includes(c.id)));
}

function successor(w, c, except) {
  return Object.values(w.characters).filter(x => x.country === c.id && x.alive && x.status === 'serbest' && x.id !== except).sort((a, b) => b.power - a.power)[0];
}

export function installLeader(w, c, ch, regimeChange) {
  const oldId = c.leader;
  const oldRole = ch.role;
  if (oldId && w.characters[oldId] && oldId !== ch.id) { w.characters[oldId].role = 'eski_lider'; }
  ch.role = 'leader'; ch.loyalty = 100; ch.power = Math.max(ch.power, 60); c.leader = ch.id;
  if (oldRole !== 'leader' && ROLES.includes(oldRole)) { const n = spawnCharacter(w, c.id, oldRole, c.axes); c[oldRole] = n.id; }
  if (regimeChange) Object.assign(c, regimeChange);
}

function replaceSlot(w, c, ch) {
  if (ROLES.includes(ch.role) && c[ch.role] === ch.id && ch.role !== 'leader') { const n = spawnCharacter(w, c.id, ch.role, c.axes); c[ch.role] = n.id; }
}

export function neutralize(w, ch, fate = 'hapis') {
  const c = w.countries[ch.country];
  ch.status = fate; ch.alive = fate === 'hapis' || fate === 'surgun';
  if (fate === 'olu') ch.alive = false;
  if (c) replaceSlot(w, c, ch);
  for (const pl of w.plots) { pl.members = pl.members.filter(x => x !== ch.id); if (pl.active && pl.leader === ch.id) { if (pl.members.length) pl.leader = pl.members[0]; else pl.active = false; } }
}

export function startCivilWar(w, c, leaderCh, label, seedProvinces = []) {
  const id = nextId(w, 'U');
  const f = makeCountry(w, id, {
    name: `${label} (${c.rootName || c.name})`, rootName: c.rootName || c.name, noSplitUntil: w.turn + 16, adj: '', ideology: leaderCh.role === 'general' ? 'Askeri devrim' : 'Muhalif cephe', regime: 'Devrimci konsey', motto: 'Düzen yıkılacak.',
    colors: [mix(c.colors[0]), c.colors[1]], axes: { ...leaderCh.axes }, parent: c.id, majorityEth: c.majorityEth, majorityRel: c.majorityRel,
    tax: { ...c.tax }, tariff: c.tariff, budget: { ...c.budget, military: Math.max(c.budget.military, .09) }, armShare: .2, tech: { ...c.tech }, priceLevel: c.priceLevel, wageIndex: c.wageIndex, inflation: c.inflation,
    techs: { ...c.techs }, literacy: c.literacy, parties: c.parties.map(p => ({ ...p })), rulingParty: null,
    relations: { ...c.relations, [c.id]: -100 }, bureaucracy: c.bureaucracy * .6, police: c.police * .5, legitimacy: 45, capital: null
  });
  f.rate = c.rate; issueCurrency(f, 'serbest'); w.countries[id] = f; c.relations[id] = -100;
  for (const o of aliveCountries(w)) if (o.id !== id && o.id !== c.id) o.relations[id] = o.relations[c.id] ?? 0;
  const provs = countryProvinces(w, c.id);
  let take = [...new Set(seedProvinces)];
  const units = Object.values(w.units).filter(u => u.country === c.id);
  const defecting = units.filter(u => u.loyalty < 52 || (leaderCh.role === 'general' && rand(w) < .35));
  if (!defecting.length && units.length > 1) defecting.push([...units].sort((a, b) => a.loyalty - b.loyalty)[0]);
  defecting.forEach(u => { u.country = id; u.loyalty = 75; u.target = null; take.push(u.province); });
  const byUnrest = [...provs].sort((a, b) => b.unrest - a.unrest).map(p => p.id);
  const minimum = Math.max(1, Math.round(provs.length * .25));
  for (const x of byUnrest) if (take.length < minimum && x !== c.capital) take.push(x);
  take = [...new Set(take)];
  if (take.length >= provs.length) take = take.filter(x => x !== c.capital).slice(0, Math.max(1, provs.length - 1));
  if (!take.length) take = byUnrest.slice(0, 1);
  take.forEach(x => { const p = w.provinces[x]; p.owner = id; p.controller = id; });
  f.capital = take[0];
  const share = take.length / Math.max(provs.length, 1);
  for (const g of Object.keys(c.stock)) { f.stock[g] = c.stock[g] * share; c.stock[g] *= 1 - share; }
  f.treasury = c.treasury * share * .4; c.treasury *= 1 - share * .6;
  f.reserves = c.reserves * share * .5; c.reserves *= 1 - share * .5;
  f.money = c.money * share; c.money *= 1 - share; f._lastMoney = f.money; c._lastMoney = c.money;
  f.debt = 0; c.gdp *= 1 - share; f.gdp = c.gdp * share / Math.max(1 - share, .1); f.realGdp = f.gdp / f.priceLevel; c.realGdp *= 1 - share;
  leaderCh.country = id; if (c[leaderCh.role] === leaderCh.id) { const n = spawnCharacter(w, c.id, leaderCh.role, c.axes); c[leaderCh.role] = n.id; }
  leaderCh.role = 'leader'; leaderCh.loyalty = 100; f.leader = leaderCh.id;
  for (const r of ROLES) if (r !== 'leader') f[r] = spawnCharacter(w, id, r, f.axes).id;
  w.wars.push({ id: nextId(w, 'S'), a: [id], b: [c.id], civil: true, active: true, start: w.turn, name: `${c.name} İç Savaşı` });
  c.noSplitUntil = w.turn + 10;
  c.legitimacy = clamp(c.legitimacy - 12, 0, 100);
  news(w, `${c.name} iç savaşa sürüklendi. ${leaderCh.name} önderliğindeki güçler ${take.length} eyalette yönetimi ele aldı.`, { kind: 'felaket', countries: [c.id, id] });
  return f;
}
const mix = hex => { const n = parseInt(hex.slice(1), 16); const f = x => Math.min(255, Math.round(x * .62 + 90)); return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(f).map(x => x.toString(16).padStart(2, '0')).join(''); };

export function plotStep(w) {
  for (const pl of w.plots.filter(p => p.active)) {
    const c = w.countries[pl.country];
    const lead = w.characters[pl.leader];
    if (!c?.alive || !lead?.alive || lead.status !== 'serbest') { pl.active = false; continue; }
    pl.progress = clamp(pl.progress + 9 + pl.members.length * 7, 0, 100);
    const leak = clamp(.03 + pl.members.length * .05 + (c.police + c.intelligence) / 100 * .1 - pl.secrecy * .12, .02, .75);
    if (!pl.exposed && rand(w) < leak) {
      pl.exposed = true;
      const leader = w.characters[c.leader];
      leader.inbox.push({ turn: w.turn, from: 'İstihbarat', text: `Bir ${pl.kind} hazırlığı sızdı. Elebaşı olduğu düşünülen kişi: ${lead.name}. Komplo no: ${pl.id}.` });
      news(w, `${c.name} içinde ${lead.name} etrafında bir ${pl.kind} hazırlığı istihbarata sızdı.`, { kind: 'komplo', countries: [c.id], secret: true });
    }
  }
}

function armySides(w, c, pl) {
  const inPlot = new Set([pl.leader, ...pl.members]);
  const generalIn = inPlot.has(c.general);
  let pro = 0, anti = 0;
  for (const u of Object.values(w.units)) {
    if (u.country !== c.id) continue;
    const lean = (100 - u.loyalty) + (generalIn ? 22 : 0) - 40;
    if (lean > 0) pro += u.men * lean / 50; else anti += u.men * (-lean) / 50;
  }
  return { pro, anti };
}

export function executePlot(w, pl) {
  const c = w.countries[pl.country], lead = w.characters[pl.leader];
  if (!pl.active || !c?.alive || !lead?.alive) return 'Komplo artık geçerli değil.';
  pl.active = false;
  const prep = .55 + pl.progress / 160, inPlot = [pl.leader, ...pl.members].map(x => w.characters[x]).filter(Boolean);
  const target = w.characters[c.leader];
  const surprise = pl.exposed ? .65 : 1.2;
  if (pl.kind === 'suikast') {
    const p = clamp(.18 + pl.progress / 220 - c.police / 300 - (pl.exposed ? .2 : 0), .03, .8);
    if (rand(w) < p) {
      target.alive = false; target.status = 'olu';
      news(w, `${c.name} lideri ${target.name} suikast sonucu öldü.`, { kind: 'komplo', countries: [c.id] });
      const s = successor(w, c, target.id);
      if (s) installLeader(w, c, s); c.legitimacy = clamp(c.legitimacy - 16, 0, 100);
      return 'Suikast başarılı oldu.';
    }
    neutralize(w, lead, 'olu');
    news(w, `${c.name} liderine yönelik suikast girişimi başarısız oldu.`, { kind: 'komplo', countries: [c.id] });
    c.legitimacy = clamp(c.legitimacy + 3, 0, 100);
    return 'Suikast başarısız oldu.';
  }
  if (pl.kind === 'isyan') {
    if (!canSplit(w, c)) { neutralize(w, lead, 'hapis'); news(w, `${c.name} içinde silahlı isyan girişimi filizlenmeden bastırıldı.`, { kind: 'komplo', countries: [c.id] }); return 'İsyan için yeterli zemin yok.'; }
    const seeds = countryProvinces(w, c.id).filter(p => p.unrest > 30 && p.id !== c.capital).sort((a, b) => b.unrest - a.unrest).slice(0, 3).map(p => p.id);
    startCivilWar(w, c, lead, lead.role === 'general' ? 'Asi Ordu' : 'Halk Cephesi', seeds);
    return 'Silahlı isyan başladı.';
  }
  const { pro, anti } = armySides(w, c, pl);
  const blocs = Object.values(c.blocs), angry = sum(blocs, b => b.power * Math.max(0, 50 - b.sat) / 50), content = sum(blocs, b => b.power * Math.max(0, b.sat - 50) / 50);
  const att = (pro * .08 + sum(inPlot, x => x.power) * .9 + (100 - c.legitimacy) * .4 + angry * .8) * prep * surprise * between(w, .75, 1.25);
  const def = (anti * .08 + target.power * .9 + c.police * .55 + c.legitimacy * .55 + content * .8) * between(w, .75, 1.25);
  const r = att / Math.max(def, 1);
  if (r > 1.12) {
    news(w, `${c.name} darbe gerçekleşti: ${target.name} devrildi, yönetimi ${lead.name} aldı.`, { kind: 'komplo', countries: [c.id] });
    neutralize(w, target, 'surgun');
    const military = lead.role === 'general';
    installLeader(w, c, lead, military ? { regime: 'Askeri cunta', elections: false, pressFreedom: Math.min(c.pressFreedom, 25) } : {});
    c.legitimacy = clamp(c.legitimacy - 14, 0, 100);
    return 'Darbe başarılı oldu.';
  }
  if (r > .92 && canSplit(w, c)) {
    startCivilWar(w, c, lead, 'Darbeci Güçler');
    return 'Darbe yarım kaldı, ordu bölündü.';
  }
  news(w, `${c.name} darbe girişimi bastırıldı. ${lead.name} ve destekçileri tutuklandı.`, { kind: 'komplo', countries: [c.id] });
  inPlot.forEach(x => neutralize(w, x, 'hapis'));
  c.legitimacy = clamp(c.legitimacy + 4, 0, 100);
  Object.values(w.units).filter(u => u.country === c.id).forEach(u => u.loyalty = clamp(u.loyalty - 4, 0, 100));
  return 'Darbe başarısız oldu.';
}

export function uprisingStep(w) {
  for (const c of aliveCountries(w)) {
    const hot = countryProvinces(w, c.id).filter(p => p.unrest > 62);
    for (const p of hot) if (rand(w) < .3) {
      p.devastation = clamp(p.devastation + .06, 0, 1);
      for (const k of CLASSES) p.pops[k].n *= .996;
      news(w, `${p.name}: kitlesel ayaklanma, sokaklarda çatışma var.`, { kind: 'felaket', countries: [c.id] });
      c.legitimacy = clamp(c.legitimacy - 1.5, 0, 100);
    }
    const total = countryProvinces(w, c.id).length;
    if (canSplit(w, c) && hot.length >= Math.ceil(total * .5) && rand(w) < .14) {
      const oppId = c.opposition, opp = w.characters[oppId];
      const minority = hot.filter(p => p.eth !== c.majorityEth).length > hot.length / 2;
      if (opp?.alive && opp.status === 'serbest') startCivilWar(w, c, opp, minority ? 'Ayrılıkçılar' : 'Halk Cephesi', hot.filter(p => p.id !== c.capital).map(p => p.id));
    }
  }
}

export function partyStep(w) {
  for (const c of aliveCountries(w)) {
    const scores = c.parties.filter(p => !p.banned).map(p => {
      let s = 0, n = 0;
      for (const pr of countryProvinces(w, c.id)) for (const k of CLASSES) {
        const fit = Math.max(4, 100 - distance(p.axes, CLASS_AXES[k]) * 1.1) * (p.base === k ? 1.6 : 1);
        const grievance = p.id === c.rulingParty ? pr.pops[k].sat / 50 : (100 - pr.pops[k].sat + 25) / 75;
        s += pr.pops[k].n * fit * grievance; n += pr.pops[k].n;
      }
      return [p, s / Math.max(n, 1) * (1 + (p.organization || 0) / 100)];
    });
    const tot = sum(scores, x => x[1]) || 1;
    for (const [p, v] of scores) p.support = p.support + (v / tot * 100 - p.support) * .3;
    for (const p of c.parties.filter(x => x.banned)) p.support *= .8;
    if (!c.rulingParty || !c.parties.some(p => p.id === c.rulingParty)) c.rulingParty = [...c.parties].sort((a, b) => distance(a.axes, c.axes) - distance(b.axes, c.axes))[0]?.id ?? null;
  }
}

export function electionStep(w) {
  for (const c of aliveCountries(w)) {
    if (!c.elections || w.turn < c.nextElection) continue;
    c.nextElection = w.turn + 16;
    const inc = w.characters[c.leader], opp = w.characters[c.opposition];
    const fairness = c.pressFreedom / 100;
    const rulingSupport = c.parties.find(p => p.id === c.rulingParty)?.support ?? 30;
    const rival = Math.max(1, ...c.parties.filter(p => p.id !== c.rulingParty && !p.banned).map(p => p.support));
    const share = clamp(rulingSupport / (rulingSupport + rival) * 100 + (1 - fairness) * 12 + c.rigging + between(w, -4, 4), 2, 98);
    c.rigging = 0;
    if (c.parliament) c.parliament.seats = allocateSeats(c);
    if (share >= 50 || !opp?.alive || opp.status !== 'serbest') {
      news(w, `${c.name} seçimi: ${inc.name} oyların %${Math.round(share)} kadarını alarak görevde kaldı.`, { kind: 'siyaset', countries: [c.id] });
      c.legitimacy = clamp(c.legitimacy + 6 * fairness, 0, 100);
    } else {
      news(w, `${c.name} seçimi: ${opp.name} kazandı; ${inc.name} iktidarı kaybetti (%${Math.round(100 - share)}).`, { kind: 'siyaset', countries: [c.id] });
      const prev = inc.id;
      installLeader(w, c, opp);
      const ex = w.characters[prev]; ex.role = 'opposition'; ex.loyalty = 40; const slotted = c.opposition;
      if (w.characters[slotted]) { w.characters[slotted].alive = false; w.characters[slotted].status = 'emekli'; }
      c.opposition = prev; c.legitimacy = clamp(c.legitimacy + 10 * fairness, 0, 100);
      c.axes = { ...opp.axes };
      c.rulingParty = [...c.parties].filter(p => !p.banned && p.id !== c.rulingParty).sort((a, b) => b.support - a.support)[0]?.id ?? c.rulingParty;
    }
  }
}

export function lifeStep(w) {
  if (w.turn % 4 !== 3) return;
  for (const ch of Object.values(w.characters)) {
    if (!ch.alive) continue;
    ch.age = (ch.age ?? 50) + 1;
    if (rand(w) >= clamp(Math.pow(Math.max(0, ch.age - 45) / 45, 3) * .35, .002, .6)) continue;
    const c = w.countries[ch.country];
    ch.alive = false; ch.status = 'olu';
    if (!c?.alive) continue;
    news(w, `${c.name}: ${ch.name}, ${ch.age} yaşında öldü.`, { kind: 'siyaset', countries: [c.id] });
    if (c.leader === ch.id) {
      const s = successor(w, c, ch.id);
      if (s) { installLeader(w, c, s); c.legitimacy = clamp(c.legitimacy - 9, 0, 100); news(w, `${c.name} yönetimini ${s.name} devraldı; iktidar boşluğu tartışılıyor.`, { kind: 'siyaset', countries: [c.id] }); }
      else { const n = spawnCharacter(w, c.id, 'leader', c.axes); c.leader = n.id; }
    } else replaceSlot(w, c, ch);
    for (const pl of w.plots) { pl.members = pl.members.filter(x => x !== ch.id); if (pl.active && pl.leader === ch.id) pl.active = false; }
  }
}

// Kod yalnızca olguyu yürütür: vade dolunca iki taraf öğrenir, sonrası onların kararıdır.
export function debtStep(w) {
  for (const d of w.debts ||= []) {
    if (!['acik', 'gecikmis'].includes(d.status)) continue;
    const debtor = w.characters[d.debtor], creditor = w.characters[d.creditor];
    if (!debtor?.alive || !creditor?.alive) { d.status = 'dustu'; d.closedAt = w.turn; continue; }
    if (d.status === 'acik' && w.turn >= d.due) {
      d.status = 'gecikmis';
      debtor.inbox.push({ turn: w.turn, from: 'Noter', text: `Borç ${d.id}: ${creditor.name} için ${Math.round(d.owed)} ödemenin vadesi doldu.` });
      creditor.inbox.push({ turn: w.turn, from: 'Noter', text: `Borç ${d.id}: ${debtor.name} sana olan ${Math.round(d.owed)} borcunu vadesinde ödemedi.` });
    }
  }
}

export function pruneStep(w) {
  const keep = w.turn - 40;
  w.debts = (w.debts || []).filter(d => ['acik', 'gecikmis'].includes(d.status) || d.closedAt >= keep);
  for (const [id, ch] of Object.entries(w.characters)) if (!ch.alive) { ch.goneAt ??= w.turn; if (ch.goneAt < keep) delete w.characters[id]; }
  w.plots = w.plots.filter(p => p.active || p.start >= keep);
  w.treaties = w.treaties.filter(t => t.active || t.turn >= keep);
  w.wars = w.wars.filter(x => x.active || x.start >= keep);
  for (const t of w.treaties) if (t.pending && w.turn - t.turn > 8) t.pending = false;
}

export function collapseStep(w) {
  for (const c of aliveCountries(w)) {
    if (countryProvinces(w, c.id).length) continue;
    c.alive = false;
    news(w, `${c.name} tarihe karıştı: son toprakları da düştü.`, { kind: 'felaket', countries: [c.id] });
    for (const u of Object.values(w.units)) if (u.country === c.id) delete w.units[u.id];
    for (const ch of Object.values(w.characters)) if (ch.country === c.id && ch.alive) { ch.alive = false; ch.status = 'surgun'; }
    for (const p of Object.values(w.provinces)) if (p.owner === c.id) p.owner = p.controller;
  }
  for (const war of w.wars) if (war.active) {
    war.a = war.a.filter(x => w.countries[x]?.alive); war.b = war.b.filter(x => w.countries[x]?.alive);
    if (!war.a.length || !war.b.length) { war.active = false; news(w, `${war.name} sona erdi.`, { kind: 'savas', countries: [...war.a, ...war.b] }); }
  }
  for (const t of w.treaties) if (t.active && t.parties.some(x => !w.countries[x]?.alive)) t.active = false;
}

export function relationDrift(w) {
  for (const c of aliveCountries(w)) for (const o of Object.keys(c.relations)) {
    if (!w.countries[o]?.alive) continue;
    if (atWar(w, c.id, o)) c.relations[o] = clampRel(c.relations[o] - 2);
    else c.relations[o] = clampRel(c.relations[o] * .985);
  }
}
