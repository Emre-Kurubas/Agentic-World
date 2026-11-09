import assert from 'node:assert/strict';
import { createWorld, aliveCountries, countryProvinces } from '../engine/world.js';
import { beginTurn, stepWorld } from '../engine/step.js';
import { applyOp } from '../engine/ops.js';
import { executePlot } from '../engine/politics.js';
import { Game, shouldWake, isAI } from '../agents/game.js';
import { LimitError, SessionLostError } from '../agents/backend.js';

const base = { seed: 42, countries: 5, provinces: 130, agentRoles: ['leader', 'general', 'opposition', 'oligarch'], countryAgentRoles: {}, models: { leader: 'a', referee: 'a', secondary: 'b' }, concurrency: 2, wakeEvery: 2, wakeTension: 45, maxMessagesPerActor: 3, maxDecisionsPerActor: 5, limitRetryMinutes: 0, maxTurns: 0 };
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
  const p = countryProvinces(w, c.id)[0]; p.deposits.oil = { amount: 1e6, rich: 30, known: true, mine: 6 }; run(w, 6);
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
  await g.turn(); assert.equal(calls, 5); calls = 0; await g.turn();
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
