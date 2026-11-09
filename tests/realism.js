import assert from 'node:assert/strict';
import { createWorld, aliveCountries, countryProvinces } from '../engine/world.js';
import { beginTurn, stepWorld } from '../engine/step.js';
import { applyOp } from '../engine/ops.js';
import { executePlot } from '../engine/politics.js';
import { Game, shouldWake, isAI } from '../agents/game.js';
import { LimitError } from '../agents/backend.js';

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
console.log('Tüm kontroller geçti.');
