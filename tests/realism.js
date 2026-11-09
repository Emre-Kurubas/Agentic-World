import assert from 'node:assert/strict';
import { createWorld, aliveCountries, countryProvinces } from '../engine/world.js';
import { beginTurn, stepWorld } from '../engine/step.js';
import { applyOp } from '../engine/ops.js';
import { executePlot } from '../engine/politics.js';
import { makeParliament, treatyStep } from '../engine/polity.js';
import { currencyStep, displacedDemand, exportEdge, localPrices } from '../engine/money.js';
import { firmStep, STATE } from '../engine/firms.js';
import { militaryStep } from '../engine/military.js';
import { culturePenalty, cultureStep, migrate, leaderForeignness } from '../engine/culture.js';
import { initAdmin, adminStep, adminPressure } from '../engine/admin.js';
import { contractStep } from '../engine/contracts.js';
import { makeUnit, makeFleet } from '../engine/world.js';
import { givenNames } from '../engine/names.js';
import { spawnCharacter } from '../engine/world.js';
const spawnHeir = (w, c) => spawnCharacter(w, c.id, 'oligarch', c.axes);
import { Game, shouldWake, isAI } from '../agents/game.js';
import { LimitError, SessionLostError } from '../agents/backend.js';
import { npcDecide } from '../agents/npc.js';
import { actorPrompt } from '../agents/prompts.js';
import { sanitizeSvg, parseArt } from '../agents/art.js';

const base = { plainStates: true, seed: 42, countries: 5, provinces: 130, agentRoles: ['leader', 'general', 'opposition', 'oligarch'], countryAgentRoles: {}, models: { leader: 'a', referee: 'a', secondary: 'b' }, concurrency: 2, wakeEvery: 2, wakeTension: 45, maxMessagesPerActor: 3, maxDecisionsPerActor: 5, limitRetryMinutes: 0, maxTurns: 0 };
const fresh = () => { const w = createWorld(base); w.status = 'oyunda'; for (const c of aliveCountries(w)) c.majorityEth ??= ''; run(w, 4); return w; };
const run = (w, n) => { for (let i = 0; i < n; i++) { beginTurn(w); stepWorld(w); } };
const ld = (w, c) => w.characters[c.leader];
const ok = (name, f) => { f(); console.log(`geçti  ${name}`); };
const nullStore = () => ({ savePending() {}, loadPending() { return null; }, clearPending() {}, commit() {} });

ok('Para basmak enflasyonu yükseltir', () => {
  const a = fresh(), b = fresh(); const ca = a.countries.U1, cb = b.countries.U1;
  applyOp(a, ld(a, ca), { op: 'print_money', pct_gdp: .6 }); run(a, 1); run(b, 1);
  assert.ok(ca.inflation > cb.inflation + .1, `${ca.inflation} / ${cb.inflation}`);
});
ok('Ablukadaki tahıl ithalatçısı aç kalır ve huzursuzlaşır', () => {
  const w = fresh(), t = w.countries.U1;
  countryProvinces(w, t.id).forEach(p => p.fertility = .15); t.stock.grain = 0; const before = t.popularity;
  for (const o of aliveCountries(w)) if (o.id !== t.id) o.embargo.push(t.id);
  run(w, 5); assert.ok(t.foodRatio < .7, `gida ${t.foodRatio}`); assert.ok(t.popularity < before - 8, `${t.popularity}<${before}`);
});
ok('Maaş ödenmezse ordu memnuniyeti düşer', () => {
  const w = fresh(), c = w.countries.U1; const s = c.blocs.ordu.sat;
  c.tax = { income: 0, land: 0, business: 0 }; c.treasury = 0; c.debt = c.gdp * 40; run(w, 5);
  assert.ok(c.arrears > 0 && c.blocs.ordu.sat < s - 10, `${c.blocs.ordu.sat}/${s}`);
});
ok('General vergi koyamaz', () => { const w = fresh(), c = w.countries.U1; const r = applyOp(w, w.characters[c.general], { op: 'set_tax', kind: 'income', rate: .5 }); assert.equal(r.ok, false); });
ok('Başarılı darbe lideri değiştirir', () => {
  const w = fresh(), c = w.countries.U1, g = w.characters[c.general]; const old = c.leader;
  c.legitimacy = 3; c.police = 5; ld(w, c).power = 5; g.power = 99; Object.values(w.units).filter(u => u.country === c.id).forEach(u => u.loyalty = 2);
  applyOp(w, g, { op: 'start_plot', kind: 'darbe' }); const pl = w.plots.at(-1); pl.progress = 100;
  executePlot(w, pl); assert.notEqual(c.leader, old); assert.equal(w.characters[c.leader].id, g.id);
});
ok('İsyan iç savaş ve yeni taraf doğurur', () => {
  const w = fresh(), c = w.countries.U1, o = w.characters[c.opposition]; const n = aliveCountries(w).length;
  applyOp(w, o, { op: 'start_plot', kind: 'isyan' }); executePlot(w, w.plots.at(-1));
  assert.equal(aliveCountries(w).length, n + 1); assert.ok(w.wars.some(x => x.active && x.civil));
});
ok('Olasılığı 0 olan hüküm uygulanmaz', () => {
  const w = fresh(), c = w.countries.U1, g = new Game({ world: w, cfg: base, backend: { kind: 'mock' }, store: nullStore() }); const rate = c.tax.income;
  const r = g.applyRuling(ld(w, c), { narrative: 'x', prob: 0, public: false, ops: [{ op: 'set_tax', kind: 'income', rate: .6 }], source: 'hakem' });
  assert.equal(r.success, false); assert.equal(c.tax.income, rate);
});
ok('Yalnızca lider seçilince diğer karakterler kuralla oynar', () => {
  const cfg = { ...base, agentRoles: ['leader'] }, w = fresh(), c = w.countries.U1;
  assert.equal(isAI(cfg, c, ld(w, c)), true); assert.equal(isAI(cfg, c, w.characters[c.general]), false);
  assert.equal(shouldWake(w, cfg, w.characters[c.general]), false);
});
await (async () => {
  const cfg = { ...base, agentRoles: [] }, w = fresh();
  const g = new Game({ world: w, cfg, backend: { kind: 'claude', ask() { throw new Error('çağrılmamalı'); } }, store: nullStore() });
  await g.turn(); console.log('geçti  Hiç AI seçilmese de dünya oynanır');
})();

const chain = (name, f) => { f(); console.log(`geçti  Zincir: ${name}`); };
chain('Petrol kaybı → yakıt yok → zırhlı durur', () => {
  const a = fresh(), b = fresh();
  for (const w of [a, b]) { const c = w.countries.U1; c.techs.petrol_motoru = 1; const u = Object.values(w.units).find(x => x.country === c.id); u.kind = 'zirhli'; u.men = 80; }
  a.countries.U1.stock.fuel = 0; a.countries.U1.stock.oil = 0; b.countries.U1.stock.fuel = 9999;
  for (const o of aliveCountries(a)) if (o.id !== 'U1') o.embargo.push('U1');
  run(a, 2); run(b, 2);
  assert.ok(a.countries.U1.fuelRatio < .6, `yakıt ${a.countries.U1.fuelRatio}`); assert.ok(b.countries.U1.fuelRatio >= .6);
});
chain('Boğaz kapanınca deniz rotası kesilir, fiyat ve ücret değişir', () => {
  const w = fresh(); run(w, 1);
  const k = Object.keys(w.routes).find(x => w.routes[x].mode === 'deniz' && w.routes[x].path.some(s => w.strategic.some(y => y.type === 'bogaz' && y.ref === s)));
  if (!k) return console.log('       (bu dünyada boğazdan geçen rota yok, atlandı)');
  const st = w.strategic.find(y => y.type === 'bogaz' && w.routes[k].path.includes(y.ref)), owner = st.controller; const [a, b] = k.split('|');
  if ([a, b].includes(owner)) return console.log('       (taraf boğazı kontrol ediyor, atlandı)');
  const before = w.routes[k].path.length; w.countries[owner].straitPolicy = { [st.id]: { closed: true, toll: 0 } }; run(w, 1);
  const after = w.routes[k]; assert.ok(!after || !after.path.includes(st.ref), 'rota boğazdan geçmemeli'); assert.ok(!after || after.path.length >= before);
});
chain('Düşman filosu denizi tutunca ticaret kesilir', () => {
  const w = fresh(), k = Object.keys(w.routes).find(x => w.routes[x].mode === 'deniz'); if (!k) return;
  const [a, b] = k.split('|'), sea = w.routes[k].path[0], enemy = aliveCountries(w).find(c => ![a, b].includes(c.id));
  w.wars.push({ id: 'SX', a: [enemy.id], b: [a], civil: false, active: true, start: w.turn, name: 'X' });
  for (const s of Object.keys(w.seas)) { const f = Object.values(w.fleets).find(x => x.country === enemy.id) ; if (!f) break; }
  const path = w.routes[k].path; for (const s of path) w.fleets['Z' + s] = { id: 'Z' + s, country: enemy.id, sea: s, ships: 900, quality: 3, morale: 90, target: null };
  run(w, 2); const r = w.routes[k]; assert.ok(!r || !path.every(s => r.path.includes(s)), 'aynı rota açık kalmamalı');
});
chain('Baraj aşağı havzanın hasadını düşürür', () => {
  const w = fresh(), up = Object.values(w.provinces).find(p => p.downstream && p.river > .15); assert.ok(up, 'nehir yok');
  run(w, 1); const q = w.provinces[up.downstream], before = q.waterPenalty; up.dam = true; run(w, 1); assert.ok(q.waterPenalty > before);
});
chain('Rant bağımlılığı yolsuzluğu ve oligarkı büyütür', () => {
  const w = fresh(), c = w.countries.U1, o = w.characters[c.oligarch], cor = c.corruption, pw = o.wealth;
  const p = countryProvinces(w, c.id)[0]; p.deposits.oil = { amount: 1e6, rich: 30, known: true, mine: 6 };
  for (let i = 0; i < 6; i++) { c.stock.oil = 0; c.lastSold = { oil: 1e6 }; run(w, 1); } // Petrol dünyaya satılıyor; satılmayan petrol rant getirmez.
  assert.ok(c.rentShare > .22, `rant ${c.rentShare}`); assert.ok(c.corruption > cor); assert.ok(o.wealth > pw);
});
chain('Çelik yoksa makine, makine yoksa yatırım olmaz', () => {
  const w = fresh(), c = w.countries.U1; c.stock.steel = 0; c.stock.iron = 0; c.stock.machines = 0;
  for (const p of countryProvinces(w, c.id)) { delete p.deposits.iron; }
  for (const o of aliveCountries(w)) if (o.id !== 'U1') o.embargo.push('U1');
  const r = applyOp(w, ld(w, c), { op: 'build', province: c.capital, kind: 'steel', pct_gdp: .05 }); assert.equal(r.ok, false);
});
chain('Temerrüt alacaklıyı vurur ve ilişkiyi bozar', () => {
  const w = fresh(), c = w.countries.U1, o = w.countries.U2; const rel = o.relations.U1 ?? 0, bank = o.bankHealth; c.creditors.U2 = c.gdp; c.debt = c.gdp * 40; c.tax = { income: 0, land: 0, business: 0 }; c.treasury = 0;
  run(w, 3); assert.ok(c.defaulted); assert.ok(o.relations.U1 < rel && o.bankHealth < bank + 3);
});
import { answer } from '../agents/queries.js';
{ const w = fresh(), c = w.countries.U1; const a = answer(w, w.characters[c.opposition], 'butce'), l = answer(w, ld(w, c), 'butce'); assert.ok(a.includes('açık değil')); assert.ok(l.includes('Hazine')); assert.ok(!answer(w, ld(w, c), 'yokboylebir').includes('undefined')); }
const lookups = async () => {
  const cfg = { ...base, agentRoles: ['leader'], maxLookupRounds: 2 }; const w = createWorld(cfg); w.status = 'oyunda'; let n = 0, sawAnswer = false;
  const backend = { kind: 'claude', async ask(p) { if (p.includes('hukumler')) return { hukumler: [] }; n++; if (p.includes('BAKTIKLARIN')) sawAnswer = true; if (!p.includes('şimdi karar ver')) return { bak: ['ekonomi'] }; return { kararlar: [], mesajlar: [] }; } };
  await new Game({ world: w, cfg, backend, store: nullStore() }).turn(); assert.equal(n, 15); assert.ok(sawAnswer); console.log('geçti  Ajan istediğini sorgular, tur sınırı işler');
};
await lookups();

const counting = async () => {
  const cfg = { ...base, agentRoles: ['leader'] }; const w = createWorld(cfg); let calls = 0;
  const backend = { kind: 'claude', async ask(p) { calls++; if (p.includes('hukumler')) return { hukumler: [] }; if (p.includes('"motto"')) return { name: 'Deneme', regime: 'R', ideology: 'I', elections: false, kimlik: 'Ben biriyim.' }; return { kimlik: 'K', ic_ses: 's', kararlar: ['Yeni bir ay takvimi ilan et'], mesajlar: [], notlar: 'n' }; } };
  const g = new Game({ world: w, cfg, backend, store: nullStore() });
  await g.turn(); assert.equal(calls, 0, 'devletler hazır devralınır'); await g.turn();
  assert.equal(calls, 10); console.log('geçti  Tek karakter modunda tur başına 5 ajan ve 5 hakem çağrısı');
  assert.equal(ld(w, w.countries.U1).persona, 'K'); console.log('geçti  Karakter kendi kimliğini yazar');
};
const limit = async () => {
  const w = createWorld({ ...base, agentRoles: ['leader'] }); w.status = 'oyunda'; let fail = true; const seen = {};
  const backend = { kind: 'claude', async ask(p) { if (p.includes('hukumler')) return { hukumler: [] }; const k = p.slice(0, 260); seen[k] = (seen[k] || 0) + 1; if (fail && Object.keys(seen).length === 3) { fail = false; throw new LimitError('limit'); } return { kararlar: [], mesajlar: [] }; } };
  const cfg = { ...base, agentRoles: ['leader'], concurrency: 1 };
  let p = null; const store = { savePending(x) { p = JSON.parse(JSON.stringify(x)); }, loadPending() { return null; }, clearPending() {}, commit() {} };
  await new Game({ world: w, cfg, backend, store }).turn();
  const repeats = Object.values(seen).filter(x => x > 1).length; assert.equal(repeats, 1); assert.equal(w.turn, 1); console.log('geçti  Limit dolunca yalnızca kalan çağrılar tekrar edilir');
};
const unlimited = async () => {
  const w = createWorld(base); const g = new Game({ world: w, cfg: base, backend: { kind: 'mock' }, store: nullStore() });
  const orig = g.turn.bind(g); g.turn = async () => { await orig(); if (w.turn >= 300) g.stop = true; };
  await g.run(0); assert.equal(w.turn, 300); assert.ok(Object.keys(w.characters).length < 400, `karakter ${Object.keys(w.characters).length}`); console.log(`geçti  300 tur sınırsız çalıştı (dünya boyutu ${Math.round(JSON.stringify(w).length / 1024)} KB, ${aliveCountries(w).length} güç)`);
};
await counting(); await limit(); await unlimited();

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, keepSnapshot } from '../agents/store.js';
import { snapshotState, buildEntries, fold } from '../agents/ledger.js';

const tempStore = () => new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'ajan-defter-')));
const dirSize = d => fs.readdirSync(d, { withFileTypes: true }).reduce((a, x) => a + (x.isDirectory() ? dirSize(path.join(d, x.name)) : fs.statSync(path.join(d, x.name)).size), 0);

await (async () => {
  const cfg = { ...base, agentRoles: ['leader'], maxLookupRounds: 1 }, w = createWorld(cfg), store = tempStore(); w.status = 'oyunda';
  let n = 0;
  const backend = { kind: 'claude', async ask(p) {
    if (p.includes('hukumler')) { const id = /"aktor"/.test(p); return { hukumler: [] , id }; }
    if (!p.includes('şimdi karar ver')) return { bak: ['ekonomi'] };
    return { ic_ses: 'Hazine kurursa ordu beni bırakır.', kararlar: [], mesajlar: [{ kime: 'U2', metin: 'Sınırda sükûnet istiyoruz.' }], notlar: '' };
  } };
  const g = new Game({ world: w, cfg, backend, store });
  await g.turn();
  const all = store.queryLedger({ limit: 500 }).items, kinds = new Set(all.map(e => e.k));
  for (const k of ['dusunce', 'sorgu', 'mesaj']) assert.ok(kinds.has(k), `defterde ${k} yok`);
  assert.ok(all.some(e => e.k === 'sorgu' && e.q === 'ekonomi' && e.text.includes('GSYH')), 'sorgu cevabı saklanmalı');
  assert.ok(all.some(e => e.k === 'kural' && e.a.length), 'kural tabanlı eylem kayda geçmeli');
  assert.ok(store.queryLedger({ q: 'SÜKUNET sinirda' }).items.some(e => e.k === 'mesaj'), 'Türkçe harf ve büyük harf aramayı bozmamalı');
  const ld1 = w.countries.U1.leader;
  assert.ok(store.queryLedger({ character: ld1 }).items.every(e => e.a.includes(ld1)), 'karakter süzgeci');
  assert.ok(store.people()[ld1].events > 0, 'kişi dizini');
  const view = JSON.parse(store.readTurn(1));
  assert.ok(view.log.trace.length && view.log.messages.length && view.log.rulings.length, 'eski tur görünümü defterden kurulmalı');
  console.log('geçti  Defter: düşünce, sorgu, mesaj, kural eylemi saklanır ve aranır');
})();

ok('Defter: başarısız işlem ve durum değişimleri yazılır', () => {
  const w = fresh(), c = w.countries.U1, g = new Game({ world: w, cfg: base, backend: { kind: 'mock' }, store: nullStore() });
  const before = snapshotState(w), oldLeader = c.leader, general = w.characters[c.general];
  const r = g.applyRuling(general, { narrative: 'vergi', prob: 1, public: false, ops: [{ op: 'set_tax', kind: 'income', rate: .5 }], source: 'kural' });
  c.leader = general.id; const p = countryProvinces(w, 'U1').at(-1); p.controller = 'U2'; c.unrest = 90; c.bankCrisis = true;
  const list = buildEntries(w, { trace: [], rulings: [r], messages: [] }, before);
  const failed = list.find(e => e.k === 'kural'); assert.equal(failed.ok, false); assert.equal(failed.x.ops[0].op, 'set_tax'); assert.ok(failed.text.length > 5);
  const changes = list.filter(e => e.k === 'durum');
  assert.ok(changes.some(e => e.imp === 3 && e.a.includes(oldLeader) && e.a.includes(general.id)), 'lider değişimi');
  assert.ok(changes.some(e => e.p === p.id && e.c.includes('U2')), 'eyalet el değiştirmesi konumuyla');
  assert.ok(changes.some(e => e.text.includes('ayaklanma eşiğinde')), 'huzursuzluk eşiği');
  assert.ok(changes.some(e => e.text.includes('bankacılık krizi')), 'banka krizi');
  const again = snapshotState(w); c.unrest = 86; assert.ok(!buildEntries(w, { trace: [], rulings: [], messages: [] }, again).some(e => e.text.includes('ayaklanma')), 'aynı eşik yeniden yazılmamalı');
});

await (async () => {
  const w = createWorld(base), store = tempStore(), g = new Game({ world: w, cfg: base, backend: { kind: 'mock' }, store });
  const orig = g.turn.bind(g); g.turn = async () => { await orig(); if (w.turn >= 520) g.stop = true; };
  await g.run(0);
  const last = store.lastTurn(); assert.equal(last, 520);
  const expected = Array.from({ length: last + 1 }, (_, t) => t).filter(t => keepSnapshot(t, last));
  assert.deepEqual(store.turns, expected, 'kopya seyreltme kuralı');
  assert.ok(store.turns.length < 150, `kopya sayısı ${store.turns.length}`);
  const ledger = fs.readdirSync(path.join(store.dir, 'ledger'));
  assert.ok(ledger.filter(x => x.startsWith('s-')).length === 5 && ledger.filter(x => x.startsWith('t-')).length <= 100, `defter dosyaları: ${ledger.length}`);
  const old = JSON.parse(store.readTurn(1)), thin = JSON.parse(store.readTurn(101));
  assert.ok(old.log.trace.length, 'en eski turun zihinleri duruyor'); assert.notEqual(thin.snapshotTurn, 101); assert.equal(thin.turn, 101); assert.ok(thin.log.trace.length, 'seyreltilen turun kaydı defterden gelir');
  assert.deepEqual(store.entriesOfTurn(250).map(e => e.id), store.queryLedger({ turn: 250, limit: 500 }).items.map(e => e.id).reverse(), 'segmentten okuma');
  const p1 = store.queryLedger({ limit: 50 }), p2 = store.queryLedger({ limit: 50, cursor: p1.next });
  assert.equal(new Set([...p1.items, ...p2.items].map(e => e.id)).size, 100, 'sayfalar çakışmamalı');
  store.writeTurnEntries(520, store.entriesOfTurn(520)); assert.equal(new Set(store.queryLedger({ turn: 520, limit: 500 }).items.map(e => e.id)).size, store.queryLedger({ turn: 520, limit: 500 }).items.length, 'yeniden oynanan tur çiftlenmemeli');
  assert.ok(Object.keys(w).includes('ledgerBands'));
  console.log(`geçti  Defter 520 turda sınırlı kaldı (${store.turns.length} dünya kopyası, ${Math.round(dirSize(store.dir) / 1048576)} MB)`);
  fs.rmSync(store.dir, { recursive: true, force: true });
})();
assert.equal(fold('İŞÇİ Ağı ÇÖLÜ'), 'isci agi colu');

const sessionWorld = () => { const cfg = { ...base, agentRoles: ['leader'], maxLookupRounds: 1, concurrency: 1 }, w = createWorld(cfg); w.status = 'oyunda'; return { cfg, w, leader: w.countries.U1.leader }; };
const memoryStore = () => { let saved = {}, pending = null; return { savePending(p) { pending = JSON.parse(JSON.stringify(p)); }, loadPending(t) { return pending?.turn === t ? pending : null; }, clearPending() { pending = null; }, commit() {}, loadSessions: () => JSON.parse(JSON.stringify(saved)), saveSessions(s) { saved = JSON.parse(JSON.stringify(s)); } }; };
const reply = (p, extra = {}) => { if (p.includes('hukumler')) return { hukumler: [] }; if (!p.includes('şimdi karar ver')) return { bak: ['ekonomi'] }; return { kararlar: [], mesajlar: [], ic_ses: 'x', ...extra }; };

const leaderOf = (w, id = 'U1') => w.characters[w.countries[id].leader];
chain('Enflasyon serbest kurda parayı düşürür, ithalatı pahalılaştırır', () => {
  const a = fresh(), b = fresh(), ca = a.countries.U1, cb = b.countries.U1; for (const w of [a, b]) w.countries.U1.fxRegime = 'serbest'; ca.priceLevel *= 3; run(a, 6); run(b, 6);
  assert.ok(ca.rate > cb.rate * 1.3, `${ca.rate} / ${cb.rate}`); assert.ok(ca.fx < cb.fx);
});
chain('Sabit kurda altın kaçarsa para daralır, rezerv biterse kur kopar', () => {
  const w = fresh(), c = w.countries.U1, before = c.money; c.fxRegime = 'altin'; c._lastReserves = c.reserves; c.reserves -= c.realGdp * .02; run(w, 1); assert.ok(c.money < before * 1.02, `para ${before} -> ${c.money}`);
  c.reserves = 0; const rate = c.rate, legit = c.legitimacy; beginTurn(w); currencyStep(w, c); assert.equal(c.fxRegime, 'altin', 'tek çeyrek krize yetmez'); currencyStep(w, c);
  assert.equal(c.fxRegime, 'serbest'); assert.ok(c.rate > rate * 1.2, `kur ${c.rate}`); assert.ok(c.legitimacy < legit); assert.ok(w.newsThisTurn.some(n => n.text.includes('sabit kurdan koptu')));
});
ok('Devalüasyon kararı liderin, serbest kurda yapılmaz', () => {
  const w = fresh(), c = w.countries.U1; c.fxRegime = 'altin'; assert.equal(applyOp(w, w.characters[c.general], { op: 'devalue', pct: .2 }).ok, false); assert.equal(applyOp(w, ld(w, c), { op: 'devalue', pct: .2 }).ok, true); assert.ok(Math.abs(c.rate - 1.2) < .01); assert.equal(c.fx, 83.33);
  assert.equal(applyOp(w, ld(w, c), { op: 'set_fx_regime', regime: 'serbest' }).ok, true); assert.equal(applyOp(w, ld(w, c), { op: 'devalue', pct: .2 }).ok, false);
});
ok('Başka paraya bağlanan kur onu izler, bağlanılan devlet yıkılırsa serbest kalır', () => {
  const w = fresh(), c = w.countries.U1, o = w.countries.U2; o.fxRegime = 'serbest'; assert.equal(applyOp(w, ld(w, c), { op: 'set_fx_regime', regime: 'bagli', target: 'U2' }).ok, true); o.rate = 2; currencyStep(w, c); assert.equal(c.rate, 2);
  o.alive = false; currencyStep(w, c); assert.equal(c.fxRegime, 'serbest');
});
chain('Dövizle borç: rezerv gelir, kur düşünce faiz bütçeye pahalıya gelir, ödenmezse temerrüt', () => {
  const a = fresh(), b = fresh(); for (const w of [a, b]) { w.countries.U2.reserves = 1e6; w.countries.U1.reserves = 0; const r = applyOp(w, ld(w, w.countries.U1), { op: 'borrow_foreign', target: 'U2', pct_gdp: .3 }); assert.equal(r.ok, true, r.msg); assert.ok(w.countries.U1.creditors.U2 > 0 && w.countries.U1.reserves > 0); }
  const ca = a.countries.U1, cb = b.countries.U1; ca.reserves = cb.reserves = 1e5; ca.rate = 5; ca.fxRegime = 'serbest'; cb.fxRegime = 'serbest'; const sa = ca.treasury, sb = cb.treasury; run(a, 1); run(b, 1); assert.ok((sa - ca.treasury) >= (sb - cb.treasury) - 1e9, 'bütçe'); assert.ok(ca.lastSpending > cb.lastSpending, `${ca.lastSpending} / ${cb.lastSpending}`);
  const w = fresh(), c = w.countries.U1; c.creditors.U2 = c.realGdp * 30; const rel = w.countries.U2.relations.U1 ?? 0; for (let i = 0; i < 7; i++) { c.reserves = 0; run(w, 1); } assert.ok(c.defaulted, 'dış borç temerrüdü'); assert.ok(w.countries.U2.relations.U1 < rel, 'alacaklı öfkelenir');
});
chain('Kur fazla değerliyse ithalat artar, ihracat rakipten pay kaybeder', () => {
  const w = fresh(), a = w.countries.U1; a.rer = 1.5; assert.ok(displacedDemand(a, 'goods') > 0 || !(a._need?.goods)); a._need = { goods: 100 }; assert.equal(Math.round(displacedDemand(a, 'goods')), 50); assert.ok(exportEdge({ rer: 1.5 }) < exportEdge({ rer: .8 }));
});
chain('Depolar dolunca üretici yavaşlar, GSYH şişmez, işsizlik artar', () => {
  const a = fresh(), b = fresh(), ca = a.countries.U1, cb = b.countries.U1; for (const w of [a, b]) w.countries.U1.embargo = aliveCountries(w).filter(o => o.id !== 'U1').map(o => o.id); ca.stock.coal = 1e7; ca.stock.grain = 1e7; ca.stock.iron = 1e7; const ua = ca.unemployment; run(a, 4); run(b, 4);
  assert.ok(ca.idleShare > .05, `atıl ${ca.idleShare}`); assert.ok(ca.realGdp < cb.realGdp, `${ca.realGdp} / ${cb.realGdp}`); assert.ok(ca.unemployment > cb.unemployment, `${ca.unemployment} / ${cb.unemployment}`); assert.ok(ua);
});
ok('İç fiyatı kıtlık yükseltir, sermaye kısıtı kaçışı durdurur', () => {
  const w = fresh(), c = w.countries.U1; run(w, 1); const plenty = c.prices.grain; c.stock.grain = 0; localPrices(w, c); assert.ok(c.prices.grain > plenty, `${c.prices.grain} / ${plenty}`);
  const ol = w.characters[c.oligarch], total = aliveCountries(w).reduce((a, x) => a + x.reserves, 0); applyOp(w, ol, { op: 'capital_flight', share: .2 }); assert.ok(aliveCountries(w).reduce((a, x) => a + x.reserves, 0) > total * .97, 'kaçan para dünyadan silinmez');
  c.capitalClosed = true; assert.equal(applyOp(w, ol, { op: 'capital_flight', share: .2 }).ok, false);
});
const inherited = (seed = 1848, countries = 5) => createWorld({ ...base, plainStates: false, seed, countries });
ok('Ülke kronikleri ve karakter hayatları olaydır, duygu yazmaz, ülkeye göre değişir', () => {
  const w = inherited(), cs = aliveCountries(w);
  for (const c of cs) { assert.ok(c.chronicle.length >= 5, c.name); assert.ok(c.culture.language && c.culture.myth); assert.ok(c.chronicle.every((e, i, a) => !i || a[i - 1].year <= e.year), 'tarih sırası'); }
  assert.equal(new Set(cs.map(c => c.chronicle[0].text)).size, cs.length, 'kronikler farklı');
  const all = Object.values(w.characters); assert.ok(all.every(ch => ch.life?.length >= 3 && ch.origin?.birthplace), 'herkesin hayatı var');
  for (const ch of all) assert.ok(w.provinces && ch.life[0].year === ch.origin.born);
  const text = JSON.stringify([...cs.map(c => c.chronicle), ...all.map(a => a.life)]); assert.ok(!/nefret|öfke|intikam|kin duy|korkak|cesur/i.test(text), 'duygu veya kişilik yazılmaz');
  const l = w.characters[cs[0].leader], p = actorPrompt(w, l, [], true, { intro: true }); assert.ok(p.includes('Ülkenin tarihi') && p.includes('Hayatın') && p.includes(l.origin.birthplace)); assert.ok(!actorPrompt(w, l, [], true, { intro: false }).includes('Hayatın'));
  const n = spawnCharacter(w, cs[0].id, 'general', cs[0].axes); assert.ok(n.life?.length >= 3, 'sonradan gelen karakterin de hayatı olur');
});
ok('Svg temizlenir: script, olay ve dış bağlantı kalmaz', () => {
  const dirty = '<svg xmlns="x"><script>alert(1)</script><rect onclick="x()" width="5"/><a href="http://k.com"/><image href="http://k/a.png"/><use href="#ok"/><path style="fill:url(http://k/x)"/></svg>', s = sanitizeSvg(dirty);
  assert.ok(!/script|onclick|http:\/\/k|<image/.test(s), s); assert.ok(s.includes('href="#ok"')); assert.equal(sanitizeSvg('merhaba'), null);
  const a = parseArt('giriş <svg viewBox="0 0 1 1"><rect/></svg>\nBETIMLEME: sepia portrait\nALTYAZI: Yaşlı vezir'); assert.equal(a.prompt, 'sepia portrait'); assert.equal(a.caption, 'Yaşlı vezir');
});
await (async () => {
  const cfg = { ...base, plainStates: false, agentRoles: ['leader'], maxLookupRounds: 0, concurrency: 2, artEventsPerTurn: 1 }, w = createWorld(cfg), store = tempStore(); w.status = 'oyunda'; let limit = false; const prompts = [];
  const svg = '<svg viewBox="0 0 600 800"><rect width="600" height="800"/></svg>\nBETIMLEME: a portrait\nALTYAZI: Bir kişi';
  const backend = { kind: 'claude', async ask(p) { if (p.includes('hukumler')) return { hukumler: [] }; return { kimlik: 'Bir lider.', ic_ses: 'x', kararlar: [], mesajlar: [], notlar: 'Günlük notum' }; }, async askText(p) { prompts.push(p); if (limit) throw new LimitError('limit'); return svg; } };
  const g = new Game({ world: w, cfg, backend, store }); await g.turn();
  const portraits = store.artIndex().filter(a => a.kind === 'portrait'); assert.equal(portraits.length, 5, 'her yapay zekâ lider kendini çizer'); assert.ok(prompts[0].includes('stüdyo') && prompts[0].includes('Bir lider.')); assert.ok(fs.existsSync(store.artPath(portraits[0].id)));
  const before = prompts.length; beginTurn(w); await g.artStep([]); assert.equal(prompts.length, before, 'portre tekrar çizilmez');
  const e = { id: '9-1', k: 'durum', t: 9, d: '1902 Ç2', imp: 3, text: 'Savaş başladı: Bir Savaş', c: ['U1', 'U2'], a: [], p: null }; await g.artStep([e]);
  const tablo = store.artIndex().find(a => a.kind === 'event'); assert.ok(tablo && tablo.witnessName && tablo.prompt, 'tablo ve betimleme'); assert.ok(prompts.at(-1).includes('Rönesans') && prompts.at(-1).includes('tanık'));
  limit = true; await g.artStep([{ ...e, id: '9-2', text: 'Savaş başladı: İkinci' }]); assert.equal(store.loadArtQueue().length, 1, 'limit dolunca görsel kuyrukta kalır'); limit = false; await g.artStep([]); assert.equal(store.loadArtQueue().length, 0); assert.equal(store.artIndex().filter(a => a.kind === 'event').length, 2);
  const all = store.queryLedger({ limit: 500 }).items; assert.ok(all.some(x => x.k === 'dusunce' && x.x.notes === 'Günlük notum'), 'günlük notu deftere yazılır');
  assert.ok(fs.readFileSync(store.file('stats.ndjson'), 'utf8').includes('"gold"'), 'tur istatistikleri'); assert.ok(store.people()[w.countries.U1.leader].life.length, 'kişi dizininde hayat');
  console.log('geçti  Portreler ve olay tabloları çizilir, kuyruk limitten kurtulur, kayıt eksiksiz');
})();
ok('Muharebeler ve teknik hatalar deftere yazılır, kararın metni hükme bağlanır', () => {
  const w = fresh(), id = Object.keys(w.provinces)[0]; w.battles = [{ province: id, attacker: 'U1', defender: 'U2', attackerWon: true, lossA: 3, lossD: 9 }]; w.newsThisTurn = [];
  const list = buildEntries(w, { trace: [], messages: [], system: [{ name: 'hakem', text: 'zaman aşımı' }], rulings: [{ actor: 'K1', name: 'A', country: 'U1', role: 'leader', narrative: 'n', probability: 1, success: true, results: [], source: 'hakem', decisionText: 'Köprüyü yak', ops: [] }] }, null);
  assert.ok(list.some(e => e.k === 'muharebe' && e.x.lossD === 9 && e.p === id)); assert.ok(list.some(e => e.k === 'sistem' && e.text === 'zaman aşımı')); assert.equal(list.find(e => e.k === 'hukum').x.decisionText, 'Köprüyü yak');
});
const frontWorld = () => { const w = fresh(); run(w, 1); const a = w.countries.U1, p = countryProvinces(w, 'U1').find(q => q.id !== a.capital && q.neighbors.some(n => w.provinces[n].controller === 'U2')), q = w.provinces[p.neighbors.find(n => w.provinces[n].controller === 'U2')]; for (const u of Object.values(w.units)) if (['U1', 'U2'].includes(u.country)) delete w.units[u.id]; w.wars.push({ id: 'SF', a: ['U2'], b: ['U1'], civil: false, active: true, start: w.turn, name: 'F' }); return { w, a, b: w.countries.U2, p, q }; };
const soldier = (w, c, province, men = 100) => { const u = makeUnit(w, c, province, men, 1, 80); u.morale = 70; u.equip = 1; return u; };
chain('İnşaat zaman alır, biter, eyalet düşerse boşa gider', () => {
  const w = fresh(), c = w.countries.U1, p = countryProvinces(w, 'U1')[0], l = ld(w, c); c.treasury = c.gdp * 3; c.stock.machines = 100; const before = p.plants.steel;
  const r = applyOp(w, l, { op: 'build', province: p.id, kind: 'steel', pct_gdp: .05 }); assert.equal(r.ok, true, r.msg); assert.equal(p.plants.steel, before, 'hemen bitmez'); assert.ok(r.msg.includes('quarters'));
  run(w, 3); assert.ok(p.plants.steel < before + .4, 'üç çeyrek sonra hâlâ bitmedi'); const mid = w.projects.at(-1); assert.ok(mid.turnsLeft > 0 && !mid.status); run(w, 1); assert.ok(p.plants.steel > before + .5, 'tamamlanınca kapasite artar');
  const q = countryProvinces(w, 'U1')[1]; c.treasury = c.gdp * 3; applyOp(w, l, { op: 'build', province: q.id, kind: 'trench', pct_gdp: .02 }); q.controller = 'U2'; run(w, 1); assert.equal(q.trench ?? 0, 0, 'kaybedilen eyaletteki inşaat biter');
});
chain('Asker toplamak ve gemi inşa etmek süre ister', () => {
  const w = fresh(), c = w.countries.U1, l = ld(w, c), p = countryProvinces(w, 'U1')[0], n = Object.keys(w.units).length; c.treasury = c.gdp * 3; c.stock.arms = 1000; c.stock.steel = 1000; applyOp(w, l, { op: 'recruit', province: p.id, men: 10, unit_kind: 'topcu' }); assert.equal(Object.keys(w.units).length, n, 'hemen gelmez'); run(w, 1); assert.equal(Object.keys(w.units).length, n, 'topçu 2 çeyrek'); run(w, 1); assert.equal(Object.keys(w.units).length, n + 1);
  const port = countryProvinces(w, 'U1').find(q => q.port > 0) ?? p; port.port = 1; port.seas = port.seas.length ? port.seas : Object.keys(w.seas).slice(0, 1); const f = Object.keys(w.fleets).length; applyOp(w, l, { op: 'build_ship', province: port.id, ships: 2, kind: 'battleship' }); run(w, 5); assert.equal(Object.keys(w.fleets).length, f); run(w, 1); assert.equal(Object.values(w.fleets).at(-1).kind, 'battleship');
});
chain('Kale savunanı güçlendirir, kuşatılınca eyalet hemen düşmez', () => {
  const battle = fort => { const { w, a, p } = frontWorld(); p.fort = fort; soldier(w, 'U1', p.id, 100); soldier(w, 'U2', p.id, 130); militaryStep(w); return w.battles.at(-1).attackerWon; };
  assert.equal(battle(0), true, 'kalesiz düşer'); assert.equal(battle(3), false, 'kale tutar');
  const { w, p } = frontWorld(); p.fort = 2; soldier(w, 'U2', p.id, 80); militaryStep(w); assert.equal(p.controller, 'U1', 'ilk çeyrek kuşatma'); assert.ok(p.siege.turns === 1); militaryStep(w); militaryStep(w); militaryStep(w); assert.equal(p.controller, 'U2', 'kuşatma sonunda düşer'); assert.ok((p.fort || 0) < 2);
});
chain('General yeteneği savaşı etkiler, savaş sicile yazılır', () => {
  const run1 = (a, b) => { const { w, p } = frontWorld(); w.characters[w.countries.U1.general].skill = a; w.characters[w.countries.U2.general].skill = b; soldier(w, 'U1', p.id, 100); soldier(w, 'U2', p.id, 110); militaryStep(w); return { won: w.battles.at(-1).attackerWon, gen: w.characters[w.countries.U1.general] }; };
  assert.equal(run1(.7, 1.4).won, true); const r = run1(1.5, .7); assert.equal(r.won, false); assert.equal(r.gen.record.won, 1);
});
chain('Cephe oluşur: düşmana değen birlik durur, kuşatılan birlik erir', () => {
  const { w, p, q } = frontWorld(), far = q.neighbors.find(n => n !== p.id && w.provinces[n].controller === 'U2') ?? q.id, u = soldier(w, 'U1', p.id, 50); soldier(w, 'U2', far, 50); u.target = far; militaryStep(w); assert.ok(u.province !== far || w.battles.length, 'temas yürüyüşü keser');
  const e = frontWorld(), cut = soldier(e.w, 'U1', Object.values(e.w.provinces).find(x => x.controller === 'U3' && !x.neighbors.some(n => e.w.provinces[n].controller === 'U1')).id, 100); e.w.wars.push({ id: 'SC', a: ['U1'], b: ['U3'], civil: false, active: true, start: 0, name: 'C' }); const m = cut.men; militaryStep(e.w); assert.ok(cut.men < m || !e.w.units[cut.id], `ikmalsiz ${cut.men}`);
});
chain('Asimilasyon nüfusu değiştirir, azınlık bedel öder, göç halkı taşır', () => {
  const w = inherited(), c = aliveCountries(w)[0], p = countryProvinces(w, c.id)[0]; p.groups = [{ eth: 'Marun', rel: c.majorityRel, share: .6 }, { eth: c.majorityEth, rel: c.majorityRel, share: .4 }]; p.eth = 'Marun'; c.languagePolicy = 'assimilate'; c.literacy = 60; const pen = culturePenalty(c, p), before = p.groups.find(g => g.eth === c.majorityEth).share;
  for (let i = 0; i < 40; i++) cultureStep(w); assert.ok(p.groups.find(g => g.eth === c.majorityEth).share > before + .05, 'asimilasyon'); c.languagePolicy = 'autonomy'; assert.ok(culturePenalty(c, p) < pen, 'özerklik baskıyı azaltır');
  const q = countryProvinces(w, c.id)[1]; q.groups = [{ eth: c.majorityEth, rel: c.majorityRel, share: 1 }]; const r = { groups: [{ eth: 'Marun', rel: 'Silent Order', share: 1 }], pops: { koylu: { n: 500 }, isci: { n: 0 }, orta: { n: 0 }, elit: { n: 0 } } }; migrate(r, q, .4); assert.ok(q.groups.some(g => g.eth === 'Marun'), 'göç eden halk gelir');
  assert.equal(applyOp(w, w.characters[c.leader], { op: 'set_culture_policy', language: 'tolerate', _law: true }).ok, true); assert.equal(c.languagePolicy, 'tolerate');
});
ok('Başka halktan lider milliyetçi ülkede meşruiyet kaybeder', () => {
  const w = inherited(), c = aliveCountries(w)[0], l = w.characters[c.leader]; c.axes.nation = 80; l.origin = { eth: c.majorityEth, rel: c.majorityRel }; assert.equal(leaderForeignness(w, c), 0); l.origin = { eth: 'Keltish-x', rel: c.majorityRel }; assert.ok(leaderForeignness(w, c) > 5);
});
chain('Uzak eyalete devletin eli az uzanır, vali uzatır, tahsilat değişir', () => {
  const w = inherited(), c = aliveCountries(w).find(x => countryProvinces(w, x.id).length > 8), provs = countryProvinces(w, c.id); initAdmin(w); const cap = w.provinces[c.capital], far = provs.reduce((a, b) => (a.admin < b.admin ? a : b)); assert.ok(cap.admin > far.admin, `${cap.admin} / ${far.admin}`);
  const before = far.admin; assert.equal(applyOp(w, w.characters[c.leader], { op: 'appoint_governor', province: far.id, character: c.general }).ok, true); for (let i = 0; i < 30; i++) adminStep(w); assert.ok(far.admin > before, 'vali erişimi artırır'); assert.ok(c._adminFactor > 0);
  far.admin = .1; assert.ok(adminPressure(far) > 0, 'zayıf idare huzursuzluk');
});
chain('Sözleşme kabulle başlar, ödeme ve teslimat yürür, ihlal yazılır', () => {
  const w = fresh(), c = w.countries.U1, a = w.characters[c.oligarch], b = w.characters[w.countries.U2.oligarch], A0 = 500; a.wealth = A0; b.wealth = 100; run(w, 1); w.routes['U1|U2'] = { mode: 'kara', cost: 1, path: [], tolls: [] };
  const r = applyOp(w, a, { op: 'propose_contract', to: b.id, terms: 'Demir anlaşması', pay_per_turn: 10, good: 'iron', amount: 5, seller: 'them', turns: 3 }); assert.equal(r.ok, true); assert.equal(a.wealth, A0, 'kabulden önce para yürümez'); const k = w.contracts.at(-1);
  contractStep(w); assert.equal(k.status, 'proposed'); assert.equal(applyOp(w, b, { op: 'accept_contract', id: k.id }).ok, true); w.firms.SRY = { id: 'SRY', status: 'acik', owner: b.id, sector: 'maden', resource: 'iron', country: 'U2', province: countryProvinces(w, 'U2')[0].id, stake: 0, cash: 0, lastProfit: 0, bad: 0 };
  w.countries.U2.stock.iron = 100; c.stock.iron = 0; contractStep(w); assert.equal(a.wealth, A0 - 10); assert.equal(b.wealth, 110); assert.equal(c.stock.iron, 5);
  w.countries.U2.stock.iron = 0; contractStep(w); assert.ok(k.breaches?.some(x => x.who === b.id), 'kısa teslimat ihlal'); assert.ok(a.inbox.some(m => m.text.includes('breached')));
  w.turn = k.until; contractStep(w); assert.equal(k.status, 'finished');
});
chain('Gemi türleri: zırhlı daha güçlü, denizaltı ticareti vurur ama denizi tutamaz', () => {
  const setup = (a, b) => { const w = fresh(), sea = Object.keys(w.seas)[0]; for (const f of Object.values(w.fleets)) delete w.fleets[f.id]; w.wars.push({ id: 'SD', a: ['U1'], b: ['U2'], civil: false, active: true, start: 0, name: 'D' }); const fa = makeFleet(w, 'U1', sea, 5), fb = makeFleet(w, 'U2', sea, 12); fa.kind = a; fb.kind = b; return { w, sea, fa, fb }; };
  const s = setup('battleship', 'cruiser'); militaryStep(s.w); assert.equal(s.w.seaControl[s.sea], 'U1');
  const t = setup('submarine', 'cruiser'); t.fb.ships = 1; militaryStep(t.w); assert.notEqual(t.w.seaControl[t.sea], 'U1', 'denizaltı denizi tutmaz'); assert.ok(t.w.seaRaids[t.sea].includes('U1'));
  const w = fresh(), c = w.countries.U1, p = countryProvinces(w, 'U1').find(q => q.coast) ?? countryProvinces(w, 'U1')[0]; p.port = 1; c.treasury = c.gdp * 3; c.stock.steel = 1000; assert.equal(applyOp(w, ld(w, c), { op: 'build_ship', province: p.id, ships: 1, kind: 'submarine' }).ok, false, 'teknoloji gerekir');
});
ok('İsimler kültüre göre: ülke, kişi ve eyalet adları halkın dilinden gelir', () => {
  const w = inherited(), cs = aliveCountries(w); assert.ok(cs.every(c => /Kingdom|Republic|Empire|Confederation|Provinces|State|Council|Government|Ports|Principality|Crown/.test(c.name)), cs.map(c => c.name).join(', ')); assert.ok(new Set(Object.values(w.provinces).map(p => p.name)).size === Object.keys(w.provinces).length, 'eyalet adları tekil');
  for (const c of cs) { const eth = c.majorityEth, names = Object.values(w.characters).filter(x => x.country === c.id && x.origin?.eth === eth).map(x => x.name.split(' ')[0]); assert.ok(names.every(n => givenNames(eth, c.majorityRel).includes(n)), `${eth}: ${names}`); }
  assert.ok(!cs.some(c => /[çğıöşüÇĞİÖŞÜ]/.test(c.name)), 'İngilizce yazım');
});
await (async () => {
  const w = inherited(), store = tempStore(); w.status = 'oyunda'; beginTurn(w); stepWorld(w); store.commit(w, []); const line = JSON.parse(fs.readFileSync(store.file('positions.ndjson'), 'utf8').trim()); assert.ok(line.units.length && line.units[0].length === 6, 'birlik konumu'); assert.ok(line.t === w.turn); fs.rmSync(store.dir, { recursive: true, force: true }); console.log('geçti  Birliklerin ve filoların konumu her tur kaydedilir');
})();
const firmWorld = () => { const w = fresh(), c = w.countries.U1; run(w, 1); const p = countryProvinces(w, 'U1').find(q => q.plants.goods > .1) ?? countryProvinces(w, 'U1')[0]; p.plants.goods = 2; const f = { id: 'SRX', name: 'Test Dokuma', country: 'U1', province: p.id, sector: 'goods', resource: null, stake: 1, owner: c.oligarch, cash: 0, lastProfit: 0, founded: 0, status: 'acik', bad: 0, offer: null }; w.firms.SRX = f; return { w, c, p, f, ol: w.characters[c.oligarch] }; };
const sellGoods = (c, goods = 100, timber = 1) => { Object.assign(c.prices, { goods, timber, coal: 1, steel: 1 }); c._made = { ...c._made, goods: 200 }; };
chain('Şirket iç piyasadan kâr eder, sahibine temettü gider, devletinse hazineye', () => {
  const { w, c, f, ol } = firmWorld(); sellGoods(c); const before = ol.wealth;
  firmStep(w); assert.ok(f.lastProfit > 0, `kâr ${f.lastProfit}`); assert.ok(ol.wealth > before, 'sahip temettü alır'); assert.ok(f.cash > 0, 'şirket kasası');
  f.owner = STATE; const t = c.treasury; firmStep(w); assert.ok(c.treasury > t, 'devlet şirketi hazineye yazar');
});
chain('Yabancı sahibin kârı altın olarak ülkeden çıkar', () => {
  const { w, c, f } = firmWorld(), foreign = w.characters[w.countries.U2.oligarch], home = w.countries.U2; f.owner = foreign.id; c.reserves = 1000; const r = [c.reserves, home.reserves]; sellGoods(c);
  firmStep(w); assert.ok(c.reserves < r[0] && home.reserves > r[1], `${c.reserves}/${home.reserves}`);
});
chain('Zarar eden şirket batar, kapasite düşer, huzursuzluk gelir', () => {
  const { w, c, f, p } = firmWorld(); f.cash = -5; const cap = p.plants.goods, unrest = p.unrest;
  for (let i = 0; i < 6; i++) { sellGoods(c, 1, 300); firmStep(w); } assert.equal(f.status, 'iflas'); assert.ok(p.plants.goods < cap); assert.ok(p.unrest > unrest);
});
chain('Devletleştirme meclise takılır, geçerse sahip şirketi kaybeder, yabancı öfkelenir', () => {
  const { w, c, f } = firmWorld(), l = ld(w, c), foreign = w.characters[w.countries.U2.oligarch]; f.owner = foreign.id; const rel = w.countries.U2.relations.U1 ?? 0, sat = c.blocs.sermaye.sat;
  assert.equal(applyOp(w, l, { op: 'nationalize_company', id: 'SRX' }).ok, true); assert.equal(f.owner, STATE); assert.ok(w.countries.U2.relations.U1 < rel); assert.ok(c.blocs.sermaye.sat < sat); assert.ok(foreign.inbox.some(m => m.text.includes('el koydu')));
  c.elections = true; makeParliament(c, 'Divan'); f.owner = foreign.id; const r = applyOp(w, l, { op: 'nationalize_company', id: 'SRX' }); assert.ok(r.msg.includes('Meclise sevk'), r.msg); assert.equal(f.owner, foreign.id);
});
ok('Şirket satılır, kurulur, yatırımla büyür; yetkisiz el sürülemez', () => {
  const { w, c, f, p, ol } = firmWorld(), g = w.characters[c.general]; ol.wealth = 500; g.wealth = 500;
  assert.equal(applyOp(w, g, { op: 'invest_company', id: 'SRX', amount: 10 }).ok, false); assert.equal(applyOp(w, ol, { op: 'sell_company', id: 'SRX', buyer: g.id, price: 100 }).ok, true); assert.equal(applyOp(w, g, { op: 'buy_company', id: 'SRX' }).ok, true); assert.equal(f.owner, g.id); assert.equal(g.wealth, 400); assert.equal(ol.wealth, 600);
  const cap = p.plants.goods; assert.equal(applyOp(w, g, { op: 'invest_company', id: 'SRX', amount: 100 }).ok, true); assert.ok(p.plants.goods > cap); assert.ok(Math.abs(f.stake - 1) < 1e-9);
  const r = applyOp(w, ol, { op: 'found_company', name: 'Yeni Dokuma', sector: 'goods', province: p.id, amount: 200 }); assert.equal(r.ok, true, r.msg); const n = w.firms[r.firm]; assert.ok(n.stake > 0 && f.stake < 1, 'ortak eyaletteki pay bölünür'); assert.ok(Math.abs(n.stake + f.stake - 1) < 1e-9);
  c.capitalClosed = true; assert.equal(applyOp(w, w.characters[w.countries.U2.oligarch], { op: 'found_company', sector: 'goods', province: p.id, amount: 5 }).ok, false, 'sermaye kısıtı yabancıyı durdurur');
});
ok('Sahibi ölünce şirket mirasçıya kalır, ülke değişince sahipsiz kalır', () => {
  const { w, c, f, ol, p } = firmWorld(); ol.alive = false; const heir = spawnHeir(w, c); c.oligarch = heir.id; firmStep(w); assert.equal(f.owner, heir.id); p.controller = 'U2'; firmStep(w); assert.equal(f.country, 'U2'); assert.equal(f.owner, null);
});
ok('İlk çeyrekte yollar bilinir, sevkiyat kararı boşa gitmez', () => {
  const w = inherited(); assert.ok(Object.keys(w.routes).length > 0, 'rota yok'); const [k] = Object.keys(w.routes), [a, b] = k.split('|'); w.countries[a].stock.grain = 100; assert.equal(applyOp(w, leaderOf(w, a), { op: 'ship_goods', target: b, good: 'grain', amount: 10 }).ok, true);
});
ok('Devralınan dünyada şirketler ve sahipleri vardır, işler ve kâr üretir', () => {
  const w = inherited(), firms = Object.values(w.firms); assert.ok(firms.length >= 15, `şirket ${firms.length}`); assert.ok(firms.some(f => w.characters[f.owner]?.role === 'oligarch')); assert.ok(firms.some(f => f.owner === null)); assert.ok(firms.every(f => f.name && !f.name.includes('undefined')));
  for (let i = 0; i < 8; i++) { beginTurn(w); stepWorld(w); } assert.ok(Object.values(w.firms).some(f => f.lastProfit > 0), 'kâr eden şirket olmalı'); console.log(`       kâr örneği: ${Object.values(w.firms).map(f => Math.round(f.lastProfit)).sort((a, b) => b - a).slice(0, 8).join(', ')}; oligark serveti: ${aliveCountries(w).map(c => Math.round(w.characters[c.oligarch]?.wealth ?? 0)).join(', ')}`);
});
ok('Devletler devralınır: rejim, ordu, para ve borç ülkeden ülkeye ayrışır', () => {
  const w = inherited(), cs = aliveCountries(w), men = c => Object.values(w.units).filter(u => u.country === c.id).reduce((a, u) => a + u.men, 0);
  assert.equal(w.status, 'kuruluyor'); assert.equal(new Set(cs.map(c => c.archetype)).size, 5, 'aynı tip iki kez çıkmamalı'); assert.ok(new Set(cs.map(c => c.regime)).size >= 4); assert.ok(cs.every(c => c.name && !c.name.startsWith('Bölge')));
  const spread = f => { const v = cs.map(f); return Math.max(...v) / Math.max(Math.min(...v), .001); };
  assert.ok(spread(c => men(c) / c.gdp) > 1.8, `ordu ${spread(c => men(c) / c.gdp)}`); assert.ok(spread(c => c.reserves / c.gdp) > 2, 'rezerv'); assert.ok(spread(c => c.debt / c.gdp) > 1.5, 'borç'); assert.ok(spread(c => Object.values(c.budget).reduce((a, x) => a + x, 0)) > 1.2, 'bütçe'); assert.ok(spread(c => c.literacy) > 1.3, 'okuryazarlık');
});
ok('Geçmiş olgudur: kaybedilen eyaletin halkı, borçlar ve iktidara geliş gerçektir', () => {
  for (const seed of [1848, 42, 7]) {
    const w = inherited(seed); assert.ok(w.past.length >= 2, `olay ${w.past.length}`); assert.ok(aliveCountries(w).every(c => w.characters[c.leader].rise));
    assert.ok(!w.past.some(e => /\b(nefret|öfke|intikam|kin|hatred|anger|revenge|grudge)\b/i.test(e.text)), 'duygu yazılmaz');
    for (const c of aliveCountries(w)) for (const [id, amt] of Object.entries(c.creditors)) { assert.ok(amt > 0 && w.countries[id]); assert.ok(w.past.some(e => e.countries.includes(id) && e.countries.includes(c.id) && e.text.includes('borçlu'))); }
    for (const e of w.past.filter(x => x.text.includes('elinden'))) { const p = Object.values(w.provinces).find(q => e.text.includes(`${q.name} eyaleti`)), loser = w.countries[e.countries[1]]; assert.equal(p.eth, loser.majorityEth, 'kayıp eyaletin halkı gerçekten karşı taraftan'); assert.equal(p.controller, e.countries[0]); }
  }
});
ok('Seçimli rejimde gerçek destekle meclis kurulur, seçimsiz rejim yasa çıkarırken meclise takılmaz', () => {
  const w = inherited(); for (const c of aliveCountries(w)) { if (c.elections) { assert.ok(c.parliament?.legislative, c.name); assert.ok(new Set(Object.values(c.parliament.seats)).size > 1, `eşit sandalye: ${JSON.stringify(c.parliament.seats)}`); assert.equal(Object.values(c.parliament.seats).reduce((a, x) => a + x, 0), 100); } else if (c.parliament) assert.equal(c.parliament.legislative, false, 'danışma meclisi işlemi durdurmaz'); }
});
ok('Geçmişler aynı dünyada tekrar etmez, devralınan bilgi yalnızca ilk çağrıda gelir', () => {
  const w = inherited(), leaders = aliveCountries(w).map(c => w.characters[c.leader]); assert.equal(new Set(leaders.map(l => l.background)).size, leaders.length);
  const l = leaders[0], first = actorPrompt(w, l, [], true, { intro: true }), later = actorPrompt(w, l, [], true, { intro: false });
  assert.ok(first.includes('Devraldığın ülke') && first.includes(l.rise)); assert.ok(!later.includes('Devraldığın ülke') && !later.includes(l.rise));
  assert.ok(answer(w, l, 'tarih').length > 20);
});
await (async () => {
  const cfg = { ...base, plainStates: false, seed: 42 }, w = createWorld(cfg), g = new Game({ world: w, cfg, backend: { kind: 'mock' }, store: nullStore() }); const orig = g.turn.bind(g);
  g.turn = async () => { await orig(); if (w.turn >= 100) g.stop = true; }; await g.run(0);
  const med = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)], cs = aliveCountries(w);
  assert.ok(med(cs.map(c => c.priceLevel)) < 100, `hiperenflasyon: fiyat ${med(cs.map(c => c.priceLevel))}`); console.log(`geçti  Devralınan dünyalar 100 turda çökmez (${cs.length} güç, ortanca meşruiyet ${Math.round(med(cs.map(c => c.legitimacy)))})`);
})();
chain('Doğrudan sevkiyat stoktan stoğa geçer, yol yoksa gitmez', () => {
  const w = fresh(), a = w.countries.U1, b = w.countries.U2; run(w, 1); const k = 'U1|U2'; w.routes[k] = { mode: 'kara', cost: 1.04, path: [], tolls: [] }; a.stock.iron = 100; b.stock.iron = 0; leaderOf(w, 'U2').inbox = [];
  assert.equal(applyOp(w, leaderOf(w), { op: 'ship_goods', target: 'U2', good: 'iron', amount: 52 }).ok, true); assert.equal(a.stock.iron, 48); assert.equal(Math.round(b.stock.iron), 50); assert.ok(leaderOf(w, 'U2').inbox.at(-1).text.includes('demir'));
  assert.equal(applyOp(w, w.characters[a.general], { op: 'ship_goods', target: 'U2', good: 'iron', amount: 1 }).ok, false, 'general devlet stokunu gönderemez');
  delete w.routes[k]; assert.equal(applyOp(w, leaderOf(w), { op: 'ship_goods', target: 'U2', good: 'iron', amount: 10 }).ok, false); assert.equal(a.stock.iron, 48);
});
chain('Kalıcı mal kıtlığı fiyatı bir kez yükseltir, her çeyrek enflasyon üretmez', () => {
  const w = fresh(), c = w.countries.U1; let peak = 0;
  for (let i = 0; i < 24; i++) { c.stock.goods = 0; for (const p of countryProvinces(w, 'U1')) p.plants.goods = 0; beginTurn(w); stepWorld(w); if (i < 4) peak = Math.max(peak, c.inflation); }
  assert.ok(peak > .02, `ilk şok görünmeli: ${peak}`); assert.ok(c.inflation < .05, `kıtlık sürerken enflasyon ${c.inflation}`);
});
chain('Kötü hasat kalıcı enflasyon bırakmaz: para durgunlukta da daralır', () => {
  const w = fresh(), c = w.countries.U1; c.stock.grain = 1e6;
  for (let i = 0; i < 40; i++) { for (const p of Object.values(w.provinces)) if (i % 2) p.fertility *= .9; else p.fertility /= .9; beginTurn(w); stepWorld(w); c.stock.grain = 1e6; }
  assert.ok(c.priceLevel < 2.2, `fiyat düzeyi ${c.priceLevel}`);
});
await (async () => {
  const w = createWorld(base), g = new Game({ world: w, cfg: base, backend: { kind: 'mock' }, store: nullStore() }); const orig = g.turn.bind(g);
  g.turn = async () => { await orig(); if (w.turn >= 100) g.stop = true; }; await g.run(0);
  const med = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)], cs = aliveCountries(w);
  assert.ok(med(cs.map(c => c.inflation)) < .05, `enflasyon ${med(cs.map(c => c.inflation))}`); assert.ok(med(cs.map(c => c.priceLevel)) < 20, `fiyat ${med(cs.map(c => c.priceLevel))}`); assert.ok(med(cs.map(c => c.inputRatio)) > .75, `sanayi girdisi ${med(cs.map(c => c.inputRatio))}`);
  console.log('geçti  100 turda ekonomi kendi başına çökmez');
})();

const parliamentWorld = () => { const w = fresh(), c = w.countries.U1; c.elections = true; makeParliament(c, 'Divan'); return { w, c, l: leaderOf(w) }; };
const stepOnce = w => { beginTurn(w); stepWorld(w); };

chain('Kurum bütçeden beslenir, yolsuzluğu düşürür, para kesilince söner', () => {
  const a = fresh(), b = fresh(), ca = a.countries.U1, cb = b.countries.U1;
  for (const c of [ca, cb]) { c.corruption = 50; c.treasury = c.gdp * 2; }
  const r = applyOp(a, leaderOf(a), { op: 'create_institution', name: 'Sayıştay', description: 'Harcamaları denetler', budget_pct_gdp: .004, powers: ['denetim'] });
  assert.equal(r.ok, true); const inst = ca.institutions.at(-1); assert.ok(inst.id && inst.head === ca.leader);
  const before = ca.treasury; run(a, 6); run(b, 6);
  assert.ok(ca.corruption < cb.corruption - 1, `${ca.corruption} / ${cb.corruption}`); assert.ok(inst.strength > .3, `güç ${inst.strength}`); assert.ok(before);
  const peak = inst.strength; inst.budget = 0; run(a, 10); assert.ok(inst.strength < peak * .4, `${inst.strength}`);
});
ok('Kuruma verilen yetkiyi üyesi kullanır, yetki yoksa kullanamaz', () => {
  const w = fresh(), c = w.countries.U1, g = w.characters[c.general]; c.treasury = c.gdp * 2;
  assert.equal(applyOp(w, g, { op: 'set_tax', kind: 'income', rate: .3 }).ok, false);
  applyOp(w, leaderOf(w), { op: 'create_institution', name: 'Maliye Kurulu', budget_pct_gdp: .004, powers: ['burokrasi'], authority: ['set_tax', 'declare_war'], head: g.id });
  const inst = c.institutions.at(-1); assert.deepEqual(inst.authority, ['set_tax'], 'savaş kararı devredilemez'); inst.strength = .6;
  assert.equal(applyOp(w, g, { op: 'set_tax', kind: 'income', rate: .3 }).ok, true); assert.equal(c.tax.income, .3);
  assert.equal(applyOp(w, w.characters[c.opposition], { op: 'set_tax', kind: 'income', rate: .1 }).ok, false);
});
ok('Kişinin kurduğu kurum devlet yetkisi alamaz, kendi servetinden beslenir', () => {
  const w = fresh(), c = w.countries.U1, o = w.characters[c.oligarch]; o.wealth = 400;
  applyOp(w, o, { op: 'create_institution', name: 'Özel Üniversite', amount: 20, powers: ['egitim', 'guvenlik'], authority: ['set_tax'] });
  const inst = c.institutions.at(-1); assert.deepEqual(inst.powers, ['egitim']); assert.deepEqual(inst.authority, []); const before = o.wealth; run(w, 1); assert.ok(o.wealth <= before - 20 + 5, `${o.wealth}/${before}`);
});
ok('Güçlü kurumun vetosu lideri durdurur', () => {
  const w = fresh(), c = w.countries.U1, l = leaderOf(w); c.courts = 100;
  applyOp(w, l, { op: 'create_institution', name: 'Anayasa Divanı', budget_pct_gdp: .003, powers: ['yargi'], veto: ['print_money'], head: c.opposition });
  c.institutions.at(-1).strength = 1.2; let blocked = 0; for (let i = 0; i < 40; i++) if (!applyOp(w, l, { op: 'print_money', pct_gdp: .001 }).ok) blocked++;
  assert.ok(blocked > 25, `engel ${blocked}`);
});
chain('Yasama meclisi vergiyi tasarıya çevirir, çoğunluk geçirirse uygulanır', () => {
  const { w, c, l } = parliamentWorld(), rate = c.tax.income, rul = c.parties[0]; c.rulingParty = rul.id; c.parliament.seats = { [rul.id]: 60, [c.parties[1].id]: 40 };
  const r = applyOp(w, l, { op: 'set_tax', kind: 'income', rate: .33 }); assert.ok(r.msg.includes('Meclise sevk'), r.msg); assert.equal(c.tax.income, rate, 'oylamadan önce uygulanmaz');
  const bill = c.bills.at(-1); bill.votes[rul.id] = 'evet'; bill.votes[c.parties[1].id] = 'hayir';
  stepOnce(w); assert.equal(bill.status, 'bekliyor', 'aynı çeyrekte oylanmaz'); stepOnce(w);
  assert.equal(bill.status, 'kabul'); assert.equal(c.tax.income, .33); assert.ok(c.laws.some(x => x.id === bill.id));
});
chain('Çoğunluğu olmayan hükümetin tasarısı düşer, meclis askıya alınırsa bedeli olur', () => {
  const { w, c, l } = parliamentWorld(), a = c.parties[0], b = c.parties[1]; c.rulingParty = a.id; c.parliament.seats = { [a.id]: 30, [b.id]: 70 }; const rate = c.tax.income;
  applyOp(w, l, { op: 'set_tax', kind: 'income', rate: .4 }); const bill = c.bills.at(-1); bill.votes[a.id] = 'evet'; bill.votes[b.id] = 'hayir'; const legit = c.legitimacy;
  stepOnce(w); stepOnce(w); assert.equal(bill.status, 'ret'); assert.equal(c.tax.income, rate); assert.ok(c.legitimacy < legit + 8);
  const before = c.legitimacy; assert.equal(applyOp(w, l, { op: 'suspend_parliament', turns: 4 }).ok, true); assert.ok(c.legitimacy < before);
  assert.equal(applyOp(w, l, { op: 'set_tax', kind: 'income', rate: .4 }).ok, true); assert.equal(c.tax.income, .4, 'askıdayken kararnameyle geçer');
});
ok('Parti lideri partisinin oyunu belirler, para oyu etkiler ve iz bırakır', () => {
  const { w, c, l } = parliamentWorld(), o = w.characters[c.oligarch], rival = [...c.parties].filter(p => p.id !== c.rulingParty).sort((a, b) => b.support - a.support)[0], opp = w.characters[c.opposition]; o.wealth = 500;
  const b = applyOp(w, opp, { op: 'propose_law', title: 'Basın Yasası', text: 'Sansür kalkar.' }).bill; const bill = c.bills.find(x => x.id === b); assert.ok(bill);
  assert.equal(applyOp(w, opp, { op: 'vote_bill', bill: b, vote: 'hayir' }).ok, true); assert.equal(bill.votes[rival.id], 'hayir');
  assert.equal(applyOp(w, w.characters[c.general], { op: 'vote_bill', bill: b, vote: 'evet' }).ok, false, 'partisiz general oy veremez');
  assert.equal(applyOp(w, o, { op: 'lobby_bill', bill: b, party: c.rulingParty, amount: 100 }).ok, true); assert.equal(bill.lobby[c.rulingParty], 100); assert.ok(o.secrets.at(-1).text.includes('Basın Yasası')); assert.equal(o.wealth, 400); assert.ok(l);
});
chain('Harac her tur ödenir, ödenemezse ihlal kaydolur ve iki lider öğrenir', () => {
  const w = fresh(), a = w.countries.U1, b = w.countries.U2, la = leaderOf(w), lb = leaderOf(w, 'U2'); a.reserves = 1e6;
  assert.equal(applyOp(w, la, { op: 'propose_treaty', target: 'U2', kind: 'ticaret', terms: 'Harac', clauses: [{ type: 'harac', payer: 'U1', pct_gdp: .01, turns: 20 }, { type: 'harac', payer: 'U9', pct_gdp: .5, turns: 20 }, { type: 'bilinmeyen' }] }).ok, true);
  const t = w.treaties.at(-1); assert.equal(t.clauses.length, 1, 'geçersiz madde atılır'); assert.equal(applyOp(w, lb, { op: 'accept_treaty', id: t.id }).ok, true);
  beginTurn(w); const res = [a.reserves, b.reserves], treatyOnly = Math.max(a.gdp, 1) * .01; treatyStep(w); assert.ok(a.reserves < res[0] - treatyOnly * .9); assert.ok(b.reserves > res[1] + treatyOnly * .9);
  a.reserves = 0; la.inbox = []; lb.inbox = []; treatyStep(w); assert.equal(t.breaches.at(-1).party, 'U1'); assert.ok(la.inbox.some(m => m.text.includes('ihlal')) && lb.inbox.some(m => m.text.includes('ihlal')));
  assert.ok(answer(w, lb, 'antlasmalar').includes('haracını'));
  const others = aliveCountries(w).filter(o => o.id !== 'U1' && o.id !== 'U2')[0], rel = others.relations.U2 ?? 0, bRel = a.relations.U2 ?? 0;
  assert.equal(applyOp(w, lb, { op: 'break_treaty', id: t.id }).ok, true); assert.equal(others.relations.U2 ?? 0, rel, 'ihlal edene karşı fesih dünyada itibar kaybettirmez'); assert.ok((a.relations.U2 ?? 0) <= bRel);
});
chain('Teslimat stoktan stoğa geçer, gümrük maddesi ithalat maliyetini düşürür', () => {
  const w = fresh(), a = w.countries.U1, b = w.countries.U2; run(w, 1); const k = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`; w.routes[k] ||= { mode: 'kara', cost: 1.04, path: [], tolls: [] }; a.stock.grain = 500; b.stock.grain = 0;
  applyOp(w, leaderOf(w), { op: 'propose_treaty', target: 'U2', kind: 'ticaret', clauses: [{ type: 'teslimat', from: 'U1', good: 'grain', amount: 100, turns: 5 }, { type: 'gumruk', rate: 0 }] }); const t = w.treaties.at(-1); applyOp(w, leaderOf(w, 'U2'), { op: 'accept_treaty', id: t.id });
  treatyStep(w); assert.equal(a.stock.grain, 400); assert.equal(b.stock.grain, 100); assert.equal(a.tariffDeals.U2, 0); assert.equal(b.tariffDeals.U1, 0);
  a.stock.grain = 10; treatyStep(w); assert.ok(t.breaches.some(x => x.party === 'U1'));
});
ok('Silahsız bölgeye girmek ve asker sınırını aşmak ihlaldir', () => {
  const w = fresh(), a = w.countries.U1, u = Object.values(w.units).find(x => x.country === 'U1'), men = Object.values(w.units).filter(x => x.country === 'U1').reduce((s, x) => s + x.men, 0);
  applyOp(w, leaderOf(w), { op: 'propose_treaty', target: 'U2', kind: 'saldirmazlik', clauses: [{ type: 'silahsiz_bolge', country: 'U1', provinces: [u.province] }, { type: 'asker_limit', country: 'U1', men: men - 1 }] }); const t = w.treaties.at(-1); applyOp(w, leaderOf(w, 'U2'), { op: 'accept_treaty', id: t.id });
  treatyStep(w); assert.equal(t.breaches.length, 2, JSON.stringify(t.breaches)); assert.ok(a);
});
ok('Saldırıya uğrayan müttefiki yalnız bırakmak ihlaldir', () => {
  const w = fresh(); applyOp(w, leaderOf(w), { op: 'propose_treaty', target: 'U2', kind: 'ittifak', clauses: [{ type: 'yardim' }] }); const t = w.treaties.at(-1); applyOp(w, leaderOf(w, 'U2'), { op: 'accept_treaty', id: t.id });
  w.wars.push({ id: 'SZ', a: ['U3'], b: ['U1'], civil: false, active: true, start: w.turn, name: 'Z' }); treatyStep(w); assert.equal(t.breaches.length, 0, 'süre tanınır');
  w.turn += 2; treatyStep(w); assert.equal(t.breaches.at(-1).party, 'U2'); w.turn += 8; treatyStep(w); assert.equal(t.breaches.length, 1, 'aynı savaş için tek ihlal');
});
ok('Süreli antlaşma biter, deftere kurum ve yasa olayları yazılır', () => {
  const { w, c, l } = parliamentWorld(); applyOp(w, l, { op: 'propose_treaty', target: 'U2', kind: 'ticaret', turns: 1, clauses: [{ type: 'gumruk', rate: .05 }] }); const t = w.treaties.at(-1); applyOp(w, leaderOf(w, 'U2'), { op: 'accept_treaty', id: t.id }); w.turn += 1; treatyStep(w); assert.equal(t.active, false);
  const snap = snapshotState(w); applyOp(w, l, { op: 'create_institution', name: 'Liman Kurulu', budget_pct_gdp: .002, powers: ['sanayi'] }); applyOp(w, l, { op: 'propose_law', title: 'Liman Yasası', text: 'x' }); applyOp(w, l, { op: 'suspend_parliament', turns: 3 });
  const list = buildEntries(w, { trace: [], rulings: [], messages: [] }, snap).filter(e => e.k === 'durum'); assert.ok(list.some(e => e.text.includes('Liman Kurulu'))); assert.ok(list.some(e => e.text.includes('Liman Yasası'))); assert.ok(list.some(e => e.text.includes('askıya') && e.imp === 3));
});
await (async () => {
  const w = createWorld(base), g = new Game({ world: w, cfg: base, backend: { kind: 'mock' }, store: nullStore() });
  await g.turn(); const cs = aliveCountries(w); assert.ok(cs.some(c => c.elections) ? cs.filter(c => c.elections).every(c => c.parliament) : true);
  const orig = g.turn.bind(g); let bills = 0; g.turn = async () => { await orig(); bills = Math.max(bills, ...aliveCountries(w).map(c => (c.bills || []).length)); if (w.turn >= 200) g.stop = true; };
  await g.run(0); assert.ok(bills <= 60, `tasarı birikti: ${bills}`); console.log(`geçti  Mock oyunda meclis 200 turda birikmedi (${aliveCountries(w).length} güç, en çok ${bills} tasarı)`);
})();

ok('Ülke ilişkisi sayı olarak görünmez, olgular görünür', () => {
  const w = fresh(), c = w.countries.U1, o = w.countries.U2; c.embargo.push('U2');
  w.wars.push({ id: 'SY', a: ['U1'], b: ['U3'], civil: false, active: true, start: w.turn, name: 'Y' });
  const a = answer(w, ld(w, c), 'dunya'); assert.ok(!/ilişki/.test(a), a); assert.ok(a.includes('SAVAŞTA') && a.includes('ona ambargo uyguluyorsun'), a); assert.ok(o);
});
ok('Rüşvet yapay zekâ karakterin sadakatini yazmaz, parası ve haberi gelir', () => {
  const w = fresh(), c = w.countries.U1, ol = w.characters[c.oligarch], g = w.characters[c.general]; ol.wealth = 500; g.aiControlled = true; const loyal = g.loyalty, money = g.wealth;
  assert.equal(applyOp(w, ol, { op: 'bribe', character: g.id, amount: 100 }).ok, true);
  assert.equal(g.loyalty, loyal); assert.equal(g.wealth, money + 100); assert.ok(g.inbox.at(-1).text.includes('100'));
  const n = w.characters[c.opposition]; n.aiControlled = false; n.greed = 80; const before = n.loyalty; applyOp(w, ol, { op: 'bribe', character: n.id, amount: 100 }); assert.ok(n.loyalty !== before || before === 100, 'kural tabanlı karakterde sayı değişir');
});
chain('Zimmet → iz → dosya → şantaj ve ifşa meşruiyeti düşürür', () => {
  const w = fresh(), c = w.countries.U1, l = ld(w, c), o = w.characters[c.opposition]; c.intelligence = 100; c.treasury = c.gdp; c.pressFreedom = 80;
  const clean = w.characters[c.general]; for (let i = 0; i < 40 && !o.dossiers[clean.id]; i++) applyOp(w, o, { op: 'gather_dossier', character: clean.id });
  assert.ok(o.dossiers[clean.id], 'dosya açılmalı'); assert.equal(applyOp(w, o, { op: 'blackmail', character: clean.id, demand: 'x' }).ok, false, 'boş dosyayla şantaj olmaz');
  assert.equal(applyOp(w, l, { op: 'embezzle', pct_gdp: .05 }).ok, true);
  delete o.dossiers[l.id]; for (let i = 0; i < 40 && !o.dossiers[l.id]; i++) applyOp(w, o, { op: 'gather_dossier', character: l.id });
  assert.ok(o.dossiers[l.id].facts[0].includes('zimmet'), JSON.stringify(o.dossiers[l.id]));
  assert.equal(applyOp(w, o, { op: 'blackmail', character: l.id, demand: 'Çekil' }).ok, true); assert.ok(l.inbox.at(-1).text.includes('zimmet') && l.inbox.at(-1).text.includes('Çekil'));
  assert.ok(answer(w, o, 'dosyalar').includes('zimmet'));
  const legit = c.legitimacy; assert.equal(applyOp(w, o, { op: 'publish_dossier', character: l.id }).ok, true);
  assert.ok(c.legitimacy < legit); assert.ok(w.newsThisTurn.some(n => n.text.includes('Sızan belgeler') && !n.secret)); assert.ok(!o.dossiers[l.id]);
});
chain('Borç → para geçer → vade dolar → iki taraf öğrenir, sonrası onların', () => {
  const w = fresh(), c = w.countries.U1, ol = w.characters[c.oligarch], g = w.characters[c.general]; ol.wealth = 500; g.wealth = 10; g.aiControlled = true; ol.aiControlled = true; const loyal = g.loyalty;
  const r = applyOp(w, ol, { op: 'lend_private', character: g.id, amount: 100, interest: .2, due_turns: 1, terms: 'Sessiz kal.' }); assert.equal(r.ok, true); assert.equal(g.wealth, 110); assert.equal(ol.wealth, 400);
  assert.ok(answer(w, g, 'borclar').includes('borçlusun')); assert.ok(answer(w, ol, 'borclar').includes('sana borçlu'));
  const debt = w.debts.at(-1); run(w, 1); assert.equal(debt.status, 'acik', 'vade gelmeden gecikmez');
  const snap = snapshotState(w); g.inbox = []; ol.inbox = []; beginTurn(w); stepWorld(w);
  assert.equal(debt.status, 'gecikmis'); assert.ok(g.inbox.some(m => m.from === 'Noter')); assert.ok(ol.inbox.some(m => m.from === 'Noter')); assert.equal(g.loyalty, loyal, 'gecikme duyguyu kod yazmaz');
  assert.ok(buildEntries(w, { trace: [], rulings: [], messages: [] }, snap).some(e => e.text.includes('vadesinde ödenmedi') && e.a.includes(g.id)), 'deftere geçer');
  g.wealth = 200; assert.equal(applyOp(w, g, { op: 'repay_debt', debt: debt.id }).ok, true); assert.equal(debt.status, 'odendi'); assert.equal(Math.round(g.wealth), 80); assert.equal(Math.round(ol.wealth), 520);
  assert.equal(applyOp(w, ol, { op: 'forgive_debt', debt: debt.id }).ok, false);
});
ok('Vadesi geçen borcunu kural tabanlı karakter parası varsa öder', () => {
  const w = fresh(), c = w.countries.U1, n = w.characters[c.general], ol = w.characters[c.oligarch]; n.wealth = 1000; w.debts.push({ id: 'B-1', creditor: ol.id, debtor: n.id, amount: 50, owed: 50, due: 0, terms: '', status: 'gecikmis', turn: 0 });
  assert.deepEqual(npcDecide(w, n), [{ op: 'repay_debt', debt: 'B-1' }]);
});
ok('Karakter geçmişi kişilik yazmaz, karakterler arasında çeşitlidir', () => {
  const w = createWorld(base), list = Object.values(w.characters).map(x => x.background); assert.ok(list.every(Boolean)); assert.ok(new Set(list).size >= 6, `çeşit ${new Set(list).size}`);
  assert.ok(!list.some(b => /temkinli|cesur|acımasız|idealist|korkak/.test(b)), 'yalnızca olay olmalı');
  assert.equal(createWorld(base).rng, w.rng, 'dünya üretimi tekrarlanabilir');
});

await (async () => {
  const { cfg, w } = sessionWorld(); const a = w.countries.U1.leader, b = w.countries.U2.leader, A = w.characters[a], B = w.characters[b], log = []; let judged = '';
  const backend = { kind: 'claude', async ask(p, model, session) {
    if (p.includes('hukumler')) { if (p.includes('A planı') || p.includes('B planı')) judged += p; return { hukumler: [] }; }
    if (p.includes(A.name) && !p.includes('AYNI ÇEYREK')) { log.push('A1'); return { kararlar: ['A planı'], mesajlar: [{ kime: 'U2', metin: 'Sınırı açalım mı?' }] }; }
    if (p.includes(B.name) && !p.includes('AYNI ÇEYREK')) { log.push('B1'); return { kararlar: ['B planı'], mesajlar: [] }; }
    if (p.includes('Sınırı açalım')) { log.push('B2'); assert.ok(session.resume); return { ic_ses: 'Olur.', mesajlar: [{ kime: a, metin: 'Tamam, şartım gümrük.' }] }; }
    if (p.includes('şartım gümrük')) { log.push('A2'); return { kararlar: ['A planı: gümrüksüz sınır'], mesajlar: [{ kime: 'U2', metin: 'Anlaştık.' }] }; }
    return { kararlar: [], mesajlar: [] };
  } };
  const g = new Game({ world: w, cfg: { ...cfg, maxLookupRounds: 0, negotiationRounds: 2 }, backend, store: memoryStore() });
  await g.turn();
  assert.deepEqual(log.filter(x => x !== 'A1' && x !== 'B1'), ['B2', 'A2'], 'iki görüşmeyle sınırlı');
  assert.ok(judged.includes('gümrüksüz sınır') && !/\bA planı\n/.test(judged), 'hakem son kararı görür');
  assert.ok(!B.inbox.some(m => m.text.includes('Sınırı açalım')), 'okunan mesaj ertesi tura kalmaz');
  assert.ok(B.inbox.some(m => m.text === 'Anlaştık.'), 'son görüşmeden sonraki mesaj gelecek çeyreğe kalır');
  console.log('geçti  Zincir: aynı çeyrek pazarlığı kararı değiştirir, hakem son hâli görür');
})();

await (async () => {
  const cfg = { ...base, agentRoles: ['leader', 'general'], maxLookupRounds: 0, concurrency: 1, wakeEvery: 99, wakeTension: 999 }, w = createWorld(cfg); w.status = 'oyunda';
  const c = w.countries.U1, l = c.leader, gen = w.characters[c.general]; for (const x of Object.values(w.characters)) x.lastWake = 0; w.turn = 1; let woke = null;
  const backend = { kind: 'claude', async ask(p, model, session) { if (p.includes('hukumler')) return { hukumler: [] }; if (p.includes(gen.name) && p.includes('AYNI ÇEYREK')) { woke = { p, resume: session.resume }; return { kararlar: ['Birliği hazırla'], mesajlar: [] }; } if (p.includes(w.characters[l].name) && !p.includes('AYNI ÇEYREK')) return { kararlar: [], mesajlar: [{ kime: gen.id, metin: 'Hazır ol.' }] }; return { kararlar: [], mesajlar: [] }; } };
  const g = new Game({ world: w, cfg, backend, store: memoryStore() });
  await g.turn();
  assert.ok(woke?.p.includes('Adın:') && woke.p.includes('Hazır ol.') && woke.p.includes(gen.background), 'uyuyan karakter tam raporla uyanır');
  assert.equal(gen.lastWake, 1, 'uyanmış sayılır');
  console.log('geçti  Mesaj alan uyuyan yapay zekâ karakter aynı çeyrekte uyanır');
})();


await (async () => {
  const { cfg, w, leader } = sessionWorld(), mine = [], name = w.characters[leader].name;
  const backend = { kind: 'claude', async ask(p, model, session) { if (session && p.includes(name) || mine.length && session?.id === mine[0].session.id) mine.push({ p, session: { ...session } }); return reply(p); } };
  const g = new Game({ world: w, cfg, backend, store: memoryStore() });
  await g.turn();
  assert.equal(mine.length, 2); assert.equal(mine[0].session.resume, false); assert.equal(mine[1].session.resume, true); assert.equal(mine[0].session.id, mine[1].session.id);
  assert.ok(mine[0].p.includes('Bu senin hayatın'), 'ilk çağrı karakteri kurar');
  assert.ok(!mine[1].p.includes('Adın:') && mine[1].p.includes('BAKTIKLARIN'), 'ikinci çağrı yalnızca yeni cevapları gönderir');
  await g.turn();
  assert.equal(mine[2].session.id, mine[0].session.id); assert.equal(mine[2].session.resume, true);
  assert.ok(mine[2].p.includes('Adın:') && !mine[2].p.includes('Bu senin hayatın'), 'sonraki tur yalnızca günün raporudur');
  console.log('geçti  Her karakter tek oturumda sürer, yalnızca yeni bilgi gönderilir');
})();

await (async () => {
  const { cfg, w, leader } = sessionWorld(), ch = w.characters[leader]; ch.diary.push('Eski bir yemin ettim.'); ch.persona = 'Kuşkucu biri.';
  const seen = []; let lost = true;
  const backend = { kind: 'claude', async ask(p, model, session) { if (p.includes(ch.name)) { seen.push({ p, session: { ...session } }); if (session.resume && lost) { lost = false; throw new SessionLostError('yok'); } } return reply(p, { kararlar: [] }); } };
  const store = memoryStore(), g = new Game({ world: w, cfg: { ...cfg, maxLookupRounds: 0 }, backend, store });
  g.sessions[leader] = { id: 'eski', calls: 9, done: 9, intro: true };
  await g.turn();
  assert.equal(seen.length, 2); assert.notEqual(seen[1].session.id, 'eski'); assert.equal(seen[1].session.resume, false);
  assert.ok(seen[1].p.includes('Eski bir yemin') && seen[1].p.includes('Kuşkucu') && seen[1].p.includes('ULAŞILAMIYOR'), 'kayıp oturumda karakter elinde kalanları görür');
  assert.equal(store.loadSessions()[leader].id, seen[1].session.id, 'yeni oturum kayda geçer');
  console.log('geçti  Kayıp oturumda karakter günlüğüyle yeniden başlar');
})();

await (async () => {
  const { cfg, w, leader } = sessionWorld(), ch = w.characters[leader], seen = []; let fail = true;
  const backend = { kind: 'claude', async ask(p, model, session) { if (p.includes(ch.name)) { seen.push({ p, resume: session.resume }); if (fail) { fail = false; throw new LimitError('limit'); } } return reply(p); } };
  const g = new Game({ world: w, cfg: { ...cfg, maxLookupRounds: 0 }, backend, store: memoryStore() });
  await g.turn();
  assert.equal(seen.length, 2); assert.equal(seen[1].resume, true); assert.ok(!seen[0].p.includes('sisteme ulaşmadı') && seen[1].p.includes('sisteme ulaşmadı'), 'yarım kalan tur karaktere söylenir');
  assert.equal(w.turn, 1); console.log('geçti  Limit sonrası karakter yarım kalan sabahı bilerek yanıt verir');
})();

await (async () => {
  const { cfg, w, leader } = sessionWorld(), ch = w.characters[leader], prompts = [];
  const backend = { kind: 'claude', async ask(p) { if (p.includes(ch.name) && !p.includes('hukumler')) { prompts.push(p); return { kararlar: ['Yeni takvim'], mesajlar: [] }; } if (p.includes('hukumler')) return { hukumler: [{ aktor: leader, karar: 0, aciklama: 'Takvim kabul edildi', olasilik: 1, islemler: [] }] }; return { kararlar: [], mesajlar: [] }; } };
  const g = new Game({ world: w, cfg: { ...cfg, maxLookupRounds: 0 }, backend, store: memoryStore() });
  await g.turn(); await g.turn(); await g.turn();
  assert.ok(!prompts[0].includes('Takvim kabul edildi') && prompts[1].includes('Takvim kabul edildi'), 'sonuç bir sonraki uyanışta bildirilir');
  assert.equal(prompts[2].split('Takvim kabul edildi').length, 2, 'her uyanışta yalnızca kendi yeni sonucu gelir');
  console.log('geçti  Zincir: karar, hüküm, ertesi sabah yalnızca yeni sonuç');
})();
console.log('Tüm kontroller geçti.');
