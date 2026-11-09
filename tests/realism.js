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
const fresh = () => { const w = createWorld(base); w.status = 'playing'; for (const c of aliveCountries(w)) c.majorityEth ??= ''; run(w, 4); return w; };
const run = (w, n) => { for (let i = 0; i < n; i++) { beginTurn(w); stepWorld(w); } };
const ld = (w, c) => w.characters[c.leader];
const ok = (name, f) => { f(); console.log(`passed  ${name}`); };
const nullStore = () => ({ savePending() {}, loadPending() { return null; }, clearPending() {}, commit() {} });

ok('Printing money raises inflation', () => {
  const a = fresh(), b = fresh(); const ca = a.countries.U1, cb = b.countries.U1;
  applyOp(a, ld(a, ca), { op: 'print_money', pct_gdp: .6 }); run(a, 1); run(b, 1);
  assert.ok(ca.inflation > cb.inflation + .1, `${ca.inflation} / ${cb.inflation}`);
});
ok('A blockaded grain importer goes hungry and turns restless', () => {
  const w = fresh(), t = w.countries.U1;
  countryProvinces(w, t.id).forEach(p => p.fertility = .15); t.stock.grain = 0; const before = t.popularity;
  for (const o of aliveCountries(w)) if (o.id !== t.id) o.embargo.push(t.id);
  run(w, 5); assert.ok(t.foodRatio < .7, `food ${t.foodRatio}`); assert.ok(t.popularity < before - 8, `${t.popularity}<${before}`);
});
ok('Unpaid wages lower army satisfaction', () => {
  const w = fresh(), c = w.countries.U1; const s = c.blocs.army.sat;
  c.tax = { income: 0, land: 0, business: 0 }; c.treasury = 0; c.debt = c.gdp * 40; run(w, 5);
  assert.ok(c.arrears > 0 && c.blocs.army.sat < s - 10, `${c.blocs.army.sat}/${s}`);
});
ok('A general cannot set taxes', () => { const w = fresh(), c = w.countries.U1; const r = applyOp(w, w.characters[c.general], { op: 'set_tax', kind: 'income', rate: .5 }); assert.equal(r.ok, false); });
ok('A successful coup changes the leader', () => {
  const w = fresh(), c = w.countries.U1, g = w.characters[c.general]; const old = c.leader;
  c.legitimacy = 3; c.police = 5; ld(w, c).power = 5; g.power = 99; Object.values(w.units).filter(u => u.country === c.id).forEach(u => u.loyalty = 2);
  applyOp(w, g, { op: 'start_plot', kind: 'coup' }); const pl = w.plots.at(-1); pl.progress = 100;
  executePlot(w, pl); assert.notEqual(c.leader, old); assert.equal(w.characters[c.leader].id, g.id);
});
ok('An uprising creates a civil war and a new side', () => {
  const w = fresh(), c = w.countries.U1, o = w.characters[c.opposition]; const n = aliveCountries(w).length;
  applyOp(w, o, { op: 'start_plot', kind: 'uprising' }); executePlot(w, w.plots.at(-1));
  assert.equal(aliveCountries(w).length, n + 1); assert.ok(w.wars.some(x => x.active && x.civil));
});
ok('A ruling with probability 0 is not applied', () => {
  const w = fresh(), c = w.countries.U1, g = new Game({ world: w, cfg: base, backend: { kind: 'mock' }, store: nullStore() }); const rate = c.tax.income;
  const r = g.applyRuling(ld(w, c), { narrative: 'x', prob: 0, public: false, ops: [{ op: 'set_tax', kind: 'income', rate: .6 }], source: 'referee' });
  assert.equal(r.success, false); assert.equal(c.tax.income, rate);
});
ok('With only leaders selected the other characters play by rules', () => {
  const cfg = { ...base, agentRoles: ['leader'] }, w = fresh(), c = w.countries.U1;
  assert.equal(isAI(cfg, c, ld(w, c)), true); assert.equal(isAI(cfg, c, w.characters[c.general]), false);
  assert.equal(shouldWake(w, cfg, w.characters[c.general]), false);
});
await (async () => {
  const cfg = { ...base, agentRoles: [] }, w = fresh();
  const g = new Game({ world: w, cfg, backend: { kind: 'claude', ask() { throw new Error('should not be called'); } }, store: nullStore() });
  await g.turn(); console.log('passed  The world plays on even with no AI selected');
})();

const chain = (name, f) => { f(); console.log(`passed  Chain: ${name}`); };
chain('Oil loss → no fuel → armor stops', () => {
  const a = fresh(), b = fresh();
  for (const w of [a, b]) { const c = w.countries.U1; c.techs.combustion_engine = 1; const u = Object.values(w.units).find(x => x.country === c.id); u.kind = 'armor'; u.men = 80; }
  a.countries.U1.stock.fuel = 0; a.countries.U1.stock.oil = 0; b.countries.U1.stock.fuel = 9999;
  for (const o of aliveCountries(a)) if (o.id !== 'U1') o.embargo.push('U1');
  run(a, 2); run(b, 2);
  assert.ok(a.countries.U1.fuelRatio < .6, `fuel ${a.countries.U1.fuelRatio}`); assert.ok(b.countries.U1.fuelRatio >= .6);
});
chain('Closing a strait cuts the sea route and changes prices and tolls', () => {
  const w = fresh(); run(w, 1);
  const k = Object.keys(w.routes).find(x => w.routes[x].mode === 'sea' && w.routes[x].path.some(s => w.strategic.some(y => y.type === 'strait' && y.ref === s)));
  if (!k) return console.log('       (no route through a strait in this world, skipped)');
  const st = w.strategic.find(y => y.type === 'strait' && w.routes[k].path.includes(y.ref)), owner = st.controller; const [a, b] = k.split('|');
  if ([a, b].includes(owner)) return console.log('       (a party controls the strait, skipped)');
  const before = w.routes[k].path.length; w.countries[owner].straitPolicy = { [st.id]: { closed: true, toll: 0 } }; run(w, 1);
  const after = w.routes[k]; assert.ok(!after || !after.path.includes(st.ref), 'route should not pass through the strait'); assert.ok(!after || after.path.length >= before);
});
chain('An enemy fleet holding the sea cuts trade', () => {
  const w = fresh(), k = Object.keys(w.routes).find(x => w.routes[x].mode === 'sea'); if (!k) return;
  const [a, b] = k.split('|'), sea = w.routes[k].path[0], enemy = aliveCountries(w).find(c => ![a, b].includes(c.id));
  w.wars.push({ id: 'SX', a: [enemy.id], b: [a], civil: false, active: true, start: w.turn, name: 'X' });
  for (const s of Object.keys(w.seas)) { const f = Object.values(w.fleets).find(x => x.country === enemy.id) ; if (!f) break; }
  const path = w.routes[k].path; for (const s of path) w.fleets['Z' + s] = { id: 'Z' + s, country: enemy.id, sea: s, ships: 900, quality: 3, morale: 90, target: null };
  run(w, 2); const r = w.routes[k]; assert.ok(!r || !path.every(s => r.path.includes(s)), 'the same route should not stay open');
});
chain('A dam lowers the downstream harvest', () => {
  const w = fresh(), up = Object.values(w.provinces).find(p => p.downstream && p.river > .15); assert.ok(up, 'no river');
  run(w, 1); const q = w.provinces[up.downstream], before = q.waterPenalty; up.dam = true; run(w, 1); assert.ok(q.waterPenalty > before);
});
chain('Rent dependence grows corruption and the oligarch', () => {
  const w = fresh(), c = w.countries.U1, o = w.characters[c.oligarch], cor = c.corruption, pw = o.wealth;
  const p = countryProvinces(w, c.id)[0]; p.deposits.oil = { amount: 1e6, rich: 30, known: true, mine: 6 };
  for (let i = 0; i < 6; i++) { c.stock.oil = 0; c.lastSold = { oil: 1e6 }; run(w, 1); } // Oil is being sold to the world; unsold oil earns no rent.
  assert.ok(c.rentShare > .22, `rent ${c.rentShare}`); assert.ok(c.corruption > cor); assert.ok(o.wealth > pw);
});
chain('No steel means no machinery, no machinery means no investment', () => {
  const w = fresh(), c = w.countries.U1; c.stock.steel = 0; c.stock.iron = 0; c.stock.machines = 0;
  for (const p of countryProvinces(w, c.id)) { delete p.deposits.iron; }
  for (const o of aliveCountries(w)) if (o.id !== 'U1') o.embargo.push('U1');
  const r = applyOp(w, ld(w, c), { op: 'build', province: c.capital, kind: 'steel', pct_gdp: .05 }); assert.equal(r.ok, false);
});
chain('Default hits the creditor and damages relations', () => {
  const w = fresh(), c = w.countries.U1, o = w.countries.U2; const rel = o.relations.U1 ?? 0, bank = o.bankHealth; c.creditors.U2 = c.gdp; c.debt = c.gdp * 40; c.tax = { income: 0, land: 0, business: 0 }; c.treasury = 0;
  run(w, 3); assert.ok(c.defaulted); assert.ok(o.relations.U1 < rel && o.bankHealth < bank + 3);
});
import { answer } from '../agents/queries.js';
{ const w = fresh(), c = w.countries.U1; const a = answer(w, w.characters[c.opposition], 'budget'), l = answer(w, ld(w, c), 'budget'); assert.ok(a.includes('not open to you')); assert.ok(l.includes('Treasury')); assert.ok(!answer(w, ld(w, c), 'nosuchtopic').includes('undefined')); }
const lookups = async () => {
  const cfg = { ...base, agentRoles: ['leader'], maxLookupRounds: 2 }; const w = createWorld(cfg); w.status = 'playing'; let n = 0, sawAnswer = false;
  const backend = { kind: 'claude', async ask(p) { if (p.includes('rulings')) return { rulings: [] }; n++; if (p.includes('WHAT YOU LOOKED UP')) sawAnswer = true; if (!p.includes('decide now')) return { lookup: ['economy'] }; return { decisions: [], messages: [] }; } };
  await new Game({ world: w, cfg, backend, store: nullStore() }).turn(); assert.equal(n, 15); assert.ok(sawAnswer); console.log('passed  An agent looks up what it wants, the round limit works');
};
await lookups();

const counting = async () => {
  const cfg = { ...base, agentRoles: ['leader'] }; const w = createWorld(cfg); let calls = 0;
  const backend = { kind: 'claude', async ask(p) { calls++; if (p.includes('rulings')) return { rulings: [] }; if (p.includes('"motto"')) return { name: 'Trial', regime: 'R', ideology: 'I', elections: false, identity: 'I am someone.' }; return { identity: 'K', inner_voice: 's', decisions: ['Proclaim a new lunar calendar'], messages: [], notes: 'n' }; } };
  const g = new Game({ world: w, cfg, backend, store: nullStore() });
  await g.turn(); assert.equal(calls, 0, 'states are inherited ready-made'); await g.turn();
  assert.equal(calls, 10); console.log('passed  One-character mode makes 5 agent and 5 referee calls per turn');
  assert.equal(ld(w, w.countries.U1).persona, 'K'); console.log('passed  A character writes its own identity');
};
const limit = async () => {
  const w = createWorld({ ...base, agentRoles: ['leader'] }); w.status = 'playing'; let fail = true; const seen = {};
  const backend = { kind: 'claude', async ask(p) { if (p.includes('rulings')) return { rulings: [] }; const k = p.slice(0, 260); seen[k] = (seen[k] || 0) + 1; if (fail && Object.keys(seen).length === 3) { fail = false; throw new LimitError('limit'); } return { decisions: [], messages: [] }; } };
  const cfg = { ...base, agentRoles: ['leader'], concurrency: 1 };
  let p = null; const store = { savePending(x) { p = JSON.parse(JSON.stringify(x)); }, loadPending() { return null; }, clearPending() {}, commit() {} };
  await new Game({ world: w, cfg, backend, store }).turn();
  const repeats = Object.values(seen).filter(x => x > 1).length; assert.equal(repeats, 1); assert.equal(w.turn, 1); console.log('passed  After hitting the limit only the remaining calls are repeated');
};
const unlimited = async () => {
  const w = createWorld(base); const g = new Game({ world: w, cfg: base, backend: { kind: 'mock' }, store: nullStore() });
  const orig = g.turn.bind(g); g.turn = async () => { await orig(); if (w.turn >= 300) g.stop = true; };
  await g.run(0); assert.equal(w.turn, 300); assert.ok(Object.keys(w.characters).length < 400, `characters ${Object.keys(w.characters).length}`); console.log(`passed  300 turns ran without limit (world size ${Math.round(JSON.stringify(w).length / 1024)} KB, ${aliveCountries(w).length} powers)`);
};
await counting(); await limit(); await unlimited();

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, keepSnapshot } from '../agents/store.js';
import { snapshotState, buildEntries, fold } from '../agents/ledger.js';

const tempStore = () => new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-ledger-')));
const dirSize = d => fs.readdirSync(d, { withFileTypes: true }).reduce((a, x) => a + (x.isDirectory() ? dirSize(path.join(d, x.name)) : fs.statSync(path.join(d, x.name)).size), 0);

await (async () => {
  const cfg = { ...base, agentRoles: ['leader'], maxLookupRounds: 1 }, w = createWorld(cfg), store = tempStore(); w.status = 'playing';
  let n = 0;
  const backend = { kind: 'claude', async ask(p) {
    if (p.includes('rulings')) { const id = /"actor"/.test(p); return { rulings: [] , id }; }
    if (!p.includes('decide now')) return { lookup: ['economy'] };
    return { inner_voice: 'If the treasury runs dry the army will abandon me.', decisions: [], messages: [{ to: 'U2', text: 'The Zürich façade holds.' }], notes: '' };
  } };
  const g = new Game({ world: w, cfg, backend, store });
  await g.turn();
  const all = store.queryLedger({ limit: 500 }).items, kinds = new Set(all.map(e => e.k));
  for (const k of ['thought', 'query', 'message']) assert.ok(kinds.has(k), `${k} missing from the ledger`);
  assert.ok(all.some(e => e.k === 'query' && e.q === 'economy' && e.text.includes('GDP')), 'query answer should be stored');
  assert.ok(all.some(e => e.k === 'rule' && e.a.length), 'rule-based action should be recorded');
  assert.ok(store.queryLedger({ q: 'ZURICH facade' }).items.some(e => e.k === 'message'), 'diacritics and upper case should not break search');
  const ld1 = w.countries.U1.leader;
  assert.ok(store.queryLedger({ character: ld1 }).items.every(e => e.a.includes(ld1)), 'character filter');
  assert.ok(store.people()[ld1].events > 0, 'person index');
  const view = JSON.parse(store.readTurn(1));
  assert.ok(view.log.trace.length && view.log.messages.length && view.log.rulings.length, 'old turn view should be rebuilt from the ledger');
  console.log('passed  Ledger: thoughts, queries, messages and rule actions are stored and searchable');
})();

ok('Ledger: failed operations and state changes are written', () => {
  const w = fresh(), c = w.countries.U1, g = new Game({ world: w, cfg: base, backend: { kind: 'mock' }, store: nullStore() });
  const before = snapshotState(w), oldLeader = c.leader, general = w.characters[c.general];
  const r = g.applyRuling(general, { narrative: 'tax', prob: 1, public: false, ops: [{ op: 'set_tax', kind: 'income', rate: .5 }], source: 'rule' });
  c.leader = general.id; const p = countryProvinces(w, 'U1').at(-1); p.controller = 'U2'; c.unrest = 90; c.bankCrisis = true;
  const list = buildEntries(w, { trace: [], rulings: [r], messages: [] }, before);
  const failed = list.find(e => e.k === 'rule'); assert.equal(failed.ok, false); assert.equal(failed.x.ops[0].op, 'set_tax'); assert.ok(failed.text.length > 5);
  const changes = list.filter(e => e.k === 'state');
  assert.ok(changes.some(e => e.imp === 3 && e.a.includes(oldLeader) && e.a.includes(general.id)), 'leader change');
  assert.ok(changes.some(e => e.p === p.id && e.c.includes('U2')), 'province changing hands with its location');
  assert.ok(changes.some(e => e.text.includes('on the brink of uprising')), 'unrest threshold');
  assert.ok(changes.some(e => e.text.includes('banking crisis')), 'bank crisis');
  const again = snapshotState(w); c.unrest = 86; assert.ok(!buildEntries(w, { trace: [], rulings: [], messages: [] }, again).some(e => e.text.includes('uprising')), 'the same threshold should not be written again');
});

await (async () => {
  const w = createWorld(base), store = tempStore(), g = new Game({ world: w, cfg: base, backend: { kind: 'mock' }, store });
  const orig = g.turn.bind(g); g.turn = async () => { await orig(); if (w.turn >= 520) g.stop = true; };
  await g.run(0);
  const last = store.lastTurn(); assert.equal(last, 520);
  const expected = Array.from({ length: last + 1 }, (_, t) => t).filter(t => keepSnapshot(t, last));
  assert.deepEqual(store.turns, expected, 'copy-thinning rule');
  assert.ok(store.turns.length < 150, `copy count ${store.turns.length}`);
  const ledger = fs.readdirSync(path.join(store.dir, 'ledger'));
  assert.ok(ledger.filter(x => x.startsWith('s-')).length === 5 && ledger.filter(x => x.startsWith('t-')).length <= 100, `ledger files: ${ledger.length}`);
  const old = JSON.parse(store.readTurn(1)), thin = JSON.parse(store.readTurn(101));
  assert.ok(old.log.trace.length, 'the minds of the oldest turn are still there'); assert.notEqual(thin.snapshotTurn, 101); assert.equal(thin.turn, 101); assert.ok(thin.log.trace.length, 'the record of a thinned turn comes from the ledger');
  assert.deepEqual(store.entriesOfTurn(250).map(e => e.id), store.queryLedger({ turn: 250, limit: 500 }).items.map(e => e.id).reverse(), 'reading from a segment');
  const p1 = store.queryLedger({ limit: 50 }), p2 = store.queryLedger({ limit: 50, cursor: p1.next });
  assert.equal(new Set([...p1.items, ...p2.items].map(e => e.id)).size, 100, 'pages should not overlap');
  store.writeTurnEntries(520, store.entriesOfTurn(520)); assert.equal(new Set(store.queryLedger({ turn: 520, limit: 500 }).items.map(e => e.id)).size, store.queryLedger({ turn: 520, limit: 500 }).items.length, 'a replayed turn should not be duplicated');
  assert.ok(Object.keys(w).includes('ledgerBands'));
  console.log(`passed  Ledger stayed bounded over 520 turns (${store.turns.length} world copies, ${Math.round(dirSize(store.dir) / 1048576)} MB)`);
  fs.rmSync(store.dir, { recursive: true, force: true });
})();
assert.equal(fold('İŞÇİ Ağı ÇÖLÜ'), 'isci agi colu');

const sessionWorld = () => { const cfg = { ...base, agentRoles: ['leader'], maxLookupRounds: 1, concurrency: 1 }, w = createWorld(cfg); w.status = 'playing'; return { cfg, w, leader: w.countries.U1.leader }; };
const memoryStore = () => { let saved = {}, pending = null; return { savePending(p) { pending = JSON.parse(JSON.stringify(p)); }, loadPending(t) { return pending?.turn === t ? pending : null; }, clearPending() { pending = null; }, commit() {}, loadSessions: () => JSON.parse(JSON.stringify(saved)), saveSessions(s) { saved = JSON.parse(JSON.stringify(s)); } }; };
const reply = (p, extra = {}) => { if (p.includes('rulings')) return { rulings: [] }; if (!p.includes('decide now')) return { lookup: ['economy'] }; return { decisions: [], messages: [], inner_voice: 'x', ...extra }; };

const leaderOf = (w, id = 'U1') => w.characters[w.countries[id].leader];
chain('Inflation sinks a floating currency and makes imports dearer', () => {
  const a = fresh(), b = fresh(), ca = a.countries.U1, cb = b.countries.U1; for (const w of [a, b]) w.countries.U1.fxRegime = 'floating'; ca.priceLevel *= 3; run(a, 6); run(b, 6);
  assert.ok(ca.rate > cb.rate * 1.3, `${ca.rate} / ${cb.rate}`); assert.ok(ca.fx < cb.fx);
});
chain('Under a fixed rate, gold flight shrinks money and running out of reserves breaks the rate', () => {
  const w = fresh(), c = w.countries.U1, before = c.money; c.fxRegime = 'gold'; c._lastReserves = c.reserves; c.reserves -= c.realGdp * .02; run(w, 1); assert.ok(c.money < before * 1.02, `money ${before} -> ${c.money}`);
  c.reserves = 0; const rate = c.rate, legit = c.legitimacy; beginTurn(w); currencyStep(w, c); assert.equal(c.fxRegime, 'gold', 'a single quarter is not enough for a crisis'); currencyStep(w, c);
  assert.equal(c.fxRegime, 'floating'); assert.ok(c.rate > rate * 1.2, `rate ${c.rate}`); assert.ok(c.legitimacy < legit); assert.ok(w.newsThisTurn.some(n => n.text.includes('broke from its peg')));
});
ok('Devaluation is the leader\'s call and is impossible under a floating rate', () => {
  const w = fresh(), c = w.countries.U1; c.fxRegime = 'gold'; assert.equal(applyOp(w, w.characters[c.general], { op: 'devalue', pct: .2 }).ok, false); assert.equal(applyOp(w, ld(w, c), { op: 'devalue', pct: .2 }).ok, true); assert.ok(Math.abs(c.rate - 1.2) < .01); assert.equal(c.fx, 83.33);
  assert.equal(applyOp(w, ld(w, c), { op: 'set_fx_regime', regime: 'floating' }).ok, true); assert.equal(applyOp(w, ld(w, c), { op: 'devalue', pct: .2 }).ok, false);
});
ok('A pegged currency tracks its anchor and floats if the anchor state collapses', () => {
  const w = fresh(), c = w.countries.U1, o = w.countries.U2; o.fxRegime = 'floating'; assert.equal(applyOp(w, ld(w, c), { op: 'set_fx_regime', regime: 'pegged', target: 'U2' }).ok, true); o.rate = 2; currencyStep(w, c); assert.equal(c.rate, 2);
  o.alive = false; currencyStep(w, c); assert.equal(c.fxRegime, 'floating');
});
chain('Foreign debt: reserves come in, when the rate falls interest costs the budget more, nonpayment means default', () => {
  const a = fresh(), b = fresh(); for (const w of [a, b]) { w.countries.U2.reserves = 1e6; w.countries.U1.reserves = 0; const r = applyOp(w, ld(w, w.countries.U1), { op: 'borrow_foreign', target: 'U2', pct_gdp: .3 }); assert.equal(r.ok, true, r.msg); assert.ok(w.countries.U1.creditors.U2 > 0 && w.countries.U1.reserves > 0); }
  const ca = a.countries.U1, cb = b.countries.U1; ca.reserves = cb.reserves = 1e5; ca.rate = 5; ca.fxRegime = 'floating'; cb.fxRegime = 'floating'; const sa = ca.treasury, sb = cb.treasury; run(a, 1); run(b, 1); assert.ok((sa - ca.treasury) >= (sb - cb.treasury) - 1e9, 'budget'); assert.ok(ca.lastSpending > cb.lastSpending, `${ca.lastSpending} / ${cb.lastSpending}`);
  const w = fresh(), c = w.countries.U1; c.creditors.U2 = c.realGdp * 30; const rel = w.countries.U2.relations.U1 ?? 0; for (let i = 0; i < 7; i++) { c.reserves = 0; run(w, 1); } assert.ok(c.defaulted, 'external debt default'); assert.ok(w.countries.U2.relations.U1 < rel, 'the creditor is angered');
});
chain('An overvalued currency raises imports and loses export share to rivals', () => {
  const w = fresh(), a = w.countries.U1; a.rer = 1.5; assert.ok(displacedDemand(a, 'goods') > 0 || !(a._need?.goods)); a._need = { goods: 100 }; assert.equal(Math.round(displacedDemand(a, 'goods')), 50); assert.ok(exportEdge({ rer: 1.5 }) < exportEdge({ rer: .8 }));
});
chain('With full warehouses producers slow down, GDP does not inflate, unemployment rises', () => {
  const a = fresh(), b = fresh(), ca = a.countries.U1, cb = b.countries.U1; for (const w of [a, b]) w.countries.U1.embargo = aliveCountries(w).filter(o => o.id !== 'U1').map(o => o.id); ca.stock.coal = 1e7; ca.stock.grain = 1e7; ca.stock.iron = 1e7; const ua = ca.unemployment; run(a, 4); run(b, 4);
  assert.ok(ca.idleShare > .05, `idle ${ca.idleShare}`); assert.ok(ca.realGdp < cb.realGdp, `${ca.realGdp} / ${cb.realGdp}`); assert.ok(ca.unemployment > cb.unemployment, `${ca.unemployment} / ${cb.unemployment}`); assert.ok(ua);
});
ok('Scarcity raises the domestic price and capital controls stop flight', () => {
  const w = fresh(), c = w.countries.U1; run(w, 1); const plenty = c.prices.grain; c.stock.grain = 0; localPrices(w, c); assert.ok(c.prices.grain > plenty, `${c.prices.grain} / ${plenty}`);
  const ol = w.characters[c.oligarch], total = aliveCountries(w).reduce((a, x) => a + x.reserves, 0); applyOp(w, ol, { op: 'capital_flight', share: .2 }); assert.ok(aliveCountries(w).reduce((a, x) => a + x.reserves, 0) > total * .97, 'fleeing money does not vanish from the world');
  c.capitalClosed = true; assert.equal(applyOp(w, ol, { op: 'capital_flight', share: .2 }).ok, false);
});
const inherited = (seed = 1848, countries = 5) => createWorld({ ...base, plainStates: false, seed, countries });
ok('Country chronicles and character lives are events, record no feelings, and vary by country', () => {
  const w = inherited(), cs = aliveCountries(w);
  for (const c of cs) { assert.ok(c.chronicle.length >= 5, c.name); assert.ok(c.culture.language && c.culture.myth); assert.ok(c.chronicle.every((e, i, a) => !i || a[i - 1].year <= e.year), 'chronological order'); }
  assert.equal(new Set(cs.map(c => c.chronicle[0].text)).size, cs.length, 'chronicles differ');
  const all = Object.values(w.characters); assert.ok(all.every(ch => ch.life?.length >= 3 && ch.origin?.birthplace), 'everyone has a life');
  for (const ch of all) assert.ok(w.provinces && ch.life[0].year === ch.origin.born);
  const text = JSON.stringify([...cs.map(c => c.chronicle), ...all.map(a => a.life)]); assert.ok(!/hatred|anger|revenge|grudge|coward|brave/i.test(text), 'no feelings or personality are written');
  const l = w.characters[cs[0].leader], p = actorPrompt(w, l, [], true, { intro: true }); assert.ok(p.includes('Your country\'s history') && p.includes('Your life') && p.includes(l.origin.birthplace)); assert.ok(!actorPrompt(w, l, [], true, { intro: false }).includes('Your life'));
  const n = spawnCharacter(w, cs[0].id, 'general', cs[0].axes); assert.ok(n.life?.length >= 3, 'a character who arrives later also has a life');
});
ok('Svg is sanitized: no scripts, event handlers or external links remain', () => {
  const dirty = '<svg xmlns="x"><script>alert(1)</script><rect onclick="x()" width="5"/><a href="http://k.com"/><image href="http://k/a.png"/><use href="#ok"/><path style="fill:url(http://k/x)"/></svg>', s = sanitizeSvg(dirty);
  assert.ok(!/script|onclick|http:\/\/k|<image/.test(s), s); assert.ok(s.includes('href="#ok"')); assert.equal(sanitizeSvg('hello'), null);
  const a = parseArt('intro <svg viewBox="0 0 1 1"><rect/></svg>\nDESCRIPTION: sepia portrait\nCAPTION: Old vizier'); assert.equal(a.prompt, 'sepia portrait'); assert.equal(a.caption, 'Old vizier');
});
await (async () => {
  const cfg = { ...base, plainStates: false, agentRoles: ['leader'], maxLookupRounds: 0, concurrency: 2, artEventsPerTurn: 1 }, w = createWorld(cfg), store = tempStore(); w.status = 'playing'; let limit = false; const prompts = [];
  const svg = '<svg viewBox="0 0 600 800"><rect width="600" height="800"/></svg>\nDESCRIPTION: a portrait\nCAPTION: A person';
  const backend = { kind: 'claude', async ask(p) { if (p.includes('rulings')) return { rulings: [] }; return { identity: 'A leader.', inner_voice: 'x', decisions: [], messages: [], notes: 'My diary note' }; }, async askText(p) { prompts.push(p); if (limit) throw new LimitError('limit'); return svg; } };
  const g = new Game({ world: w, cfg, backend, store }); await g.turn();
  const portraits = store.artIndex().filter(a => a.kind === 'portrait'); assert.equal(portraits.length, 5, 'every AI leader paints itself'); assert.ok(prompts[0].includes('studio') && prompts[0].includes('A leader.')); assert.ok(fs.existsSync(store.artPath(portraits[0].id)));
  const before = prompts.length; beginTurn(w); await g.artStep([]); assert.equal(prompts.length, before, 'a portrait is not painted twice');
  const e = { id: '9-1', k: 'state', t: 9, d: 'Q2 1902', imp: 3, text: 'War began: A War', c: ['U1', 'U2'], a: [], p: null }; await g.artStep([e]);
  const tablo = store.artIndex().find(a => a.kind === 'event'); assert.ok(tablo && tablo.witnessName && tablo.prompt, 'painting and description'); assert.ok(prompts.at(-1).includes('Renaissance') && prompts.at(-1).includes('witness'));
  limit = true; await g.artStep([{ ...e, id: '9-2', text: 'War began: Second' }]); assert.equal(store.loadArtQueue().length, 1, 'at the limit an image stays in the queue'); limit = false; await g.artStep([]); assert.equal(store.loadArtQueue().length, 0); assert.equal(store.artIndex().filter(a => a.kind === 'event').length, 2);
  const all = store.queryLedger({ limit: 500 }).items; assert.ok(all.some(x => x.k === 'thought' && x.x.notes === 'My diary note'), 'the diary note is written to the ledger');
  assert.ok(fs.readFileSync(store.file('stats.ndjson'), 'utf8').includes('"gold"'), 'turn statistics'); assert.ok(store.people()[w.countries.U1.leader].life.length, 'life in the person index');
  console.log('passed  Portraits and event paintings are made, the queue survives the limit, the record is complete');
})();
ok('Battles and technical errors are written to the ledger, the decision text is tied to the ruling', () => {
  const w = fresh(), id = Object.keys(w.provinces)[0]; w.battles = [{ province: id, attacker: 'U1', defender: 'U2', attackerWon: true, lossA: 3, lossD: 9 }]; w.newsThisTurn = [];
  const list = buildEntries(w, { trace: [], messages: [], system: [{ name: 'referee', text: 'timeout' }], rulings: [{ actor: 'K1', name: 'A', country: 'U1', role: 'leader', narrative: 'n', probability: 1, success: true, results: [], source: 'referee', decisionText: 'Burn the bridge', ops: [] }] }, null);
  assert.ok(list.some(e => e.k === 'battle' && e.x.lossD === 9 && e.p === id)); assert.ok(list.some(e => e.k === 'system' && e.text === 'timeout')); assert.equal(list.find(e => e.k === 'ruling').x.decisionText, 'Burn the bridge');
});
const frontWorld = () => { const w = fresh(); run(w, 1); const a = w.countries.U1, p = countryProvinces(w, 'U1').find(q => q.id !== a.capital && q.neighbors.some(n => w.provinces[n].controller === 'U2')), q = w.provinces[p.neighbors.find(n => w.provinces[n].controller === 'U2')]; for (const u of Object.values(w.units)) if (['U1', 'U2'].includes(u.country)) delete w.units[u.id]; w.wars.push({ id: 'SF', a: ['U2'], b: ['U1'], civil: false, active: true, start: w.turn, name: 'F' }); return { w, a, b: w.countries.U2, p, q }; };
const soldier = (w, c, province, men = 100) => { const u = makeUnit(w, c, province, men, 1, 80); u.morale = 70; u.equip = 1; return u; };
chain('Construction takes time, finishes, and is lost if the province falls', () => {
  const w = fresh(), c = w.countries.U1, p = countryProvinces(w, 'U1')[0], l = ld(w, c); c.treasury = c.gdp * 3; c.stock.machines = 100; const before = p.plants.steel;
  const r = applyOp(w, l, { op: 'build', province: p.id, kind: 'steel', pct_gdp: .05 }); assert.equal(r.ok, true, r.msg); assert.equal(p.plants.steel, before, 'does not finish at once'); assert.ok(r.msg.includes('quarters'));
  run(w, 3); assert.ok(p.plants.steel < before + .4, 'still unfinished after three quarters'); const mid = w.projects.at(-1); assert.ok(mid.turnsLeft > 0 && !mid.status); run(w, 1); assert.ok(p.plants.steel > before + .5, 'capacity rises on completion');
  const q = countryProvinces(w, 'U1')[1]; c.treasury = c.gdp * 3; applyOp(w, l, { op: 'build', province: q.id, kind: 'trench', pct_gdp: .02 }); q.controller = 'U2'; run(w, 1); assert.equal(q.trench ?? 0, 0, 'construction in a lost province ends');
});
chain('Recruiting and shipbuilding take time', () => {
  const w = fresh(), c = w.countries.U1, l = ld(w, c), p = countryProvinces(w, 'U1')[0], n = Object.keys(w.units).length; c.treasury = c.gdp * 3; c.stock.arms = 1000; c.stock.steel = 1000; applyOp(w, l, { op: 'recruit', province: p.id, men: 10, unit_kind: 'artillery' }); assert.equal(Object.keys(w.units).length, n, 'does not arrive at once'); run(w, 1); assert.equal(Object.keys(w.units).length, n, 'artillery takes 2 quarters'); run(w, 1); assert.equal(Object.keys(w.units).length, n + 1);
  const port = countryProvinces(w, 'U1').find(q => q.port > 0) ?? p; port.port = 1; port.seas = port.seas.length ? port.seas : Object.keys(w.seas).slice(0, 1); const f = Object.keys(w.fleets).length; applyOp(w, l, { op: 'build_ship', province: port.id, ships: 2, kind: 'battleship' }); run(w, 5); assert.equal(Object.keys(w.fleets).length, f); run(w, 1); assert.equal(Object.values(w.fleets).at(-1).kind, 'battleship');
});
chain('A fort strengthens the defender; a besieged province does not fall at once', () => {
  const battle = fort => { const { w, a, p } = frontWorld(); p.fort = fort; soldier(w, 'U1', p.id, 100); soldier(w, 'U2', p.id, 130); militaryStep(w); return w.battles.at(-1).attackerWon; };
  assert.equal(battle(0), true, 'falls without a fort'); assert.equal(battle(3), false, 'the fort holds');
  const { w, p } = frontWorld(); p.fort = 2; soldier(w, 'U2', p.id, 80); militaryStep(w); assert.equal(p.controller, 'U1', 'first quarter of siege'); assert.ok(p.siege.turns === 1); militaryStep(w); militaryStep(w); militaryStep(w); assert.equal(p.controller, 'U2', 'falls at the end of the siege'); assert.ok((p.fort || 0) < 2);
});
chain('General skill affects battle, and the battle goes on the record', () => {
  const run1 = (a, b) => { const { w, p } = frontWorld(); w.characters[w.countries.U1.general].skill = a; w.characters[w.countries.U2.general].skill = b; soldier(w, 'U1', p.id, 100); soldier(w, 'U2', p.id, 110); militaryStep(w); return { won: w.battles.at(-1).attackerWon, gen: w.characters[w.countries.U1.general] }; };
  assert.equal(run1(.7, 1.4).won, true); const r = run1(1.5, .7); assert.equal(r.won, false); assert.equal(r.gen.record.won, 1);
});
chain('A front forms: a unit touching the enemy halts, a surrounded unit melts away', () => {
  const { w, p, q } = frontWorld(), far = q.neighbors.find(n => n !== p.id && w.provinces[n].controller === 'U2') ?? q.id, u = soldier(w, 'U1', p.id, 50); soldier(w, 'U2', far, 50); u.target = far; militaryStep(w); assert.ok(u.province !== far || w.battles.length, 'contact stops the march');
  const e = frontWorld(), cut = soldier(e.w, 'U1', Object.values(e.w.provinces).find(x => x.controller === 'U3' && !x.neighbors.some(n => e.w.provinces[n].controller === 'U1')).id, 100); e.w.wars.push({ id: 'SC', a: ['U1'], b: ['U3'], civil: false, active: true, start: 0, name: 'C' }); const m = cut.men; militaryStep(e.w); assert.ok(cut.men < m || !e.w.units[cut.id], `out of supply ${cut.men}`);
});
chain('Assimilation changes the population, minorities pay a price, migration carries peoples', () => {
  const w = inherited(), c = aliveCountries(w)[0], p = countryProvinces(w, c.id)[0]; p.groups = [{ eth: 'Marun', rel: c.majorityRel, share: .6 }, { eth: c.majorityEth, rel: c.majorityRel, share: .4 }]; p.eth = 'Marun'; c.languagePolicy = 'assimilate'; c.literacy = 60; const pen = culturePenalty(c, p), before = p.groups.find(g => g.eth === c.majorityEth).share;
  for (let i = 0; i < 40; i++) cultureStep(w); assert.ok(p.groups.find(g => g.eth === c.majorityEth).share > before + .05, 'assimilation'); c.languagePolicy = 'autonomy'; assert.ok(culturePenalty(c, p) < pen, 'autonomy reduces the pressure');
  const q = countryProvinces(w, c.id)[1]; q.groups = [{ eth: c.majorityEth, rel: c.majorityRel, share: 1 }]; const r = { groups: [{ eth: 'Marun', rel: 'Silent Order', share: 1 }], pops: { peasants: { n: 500 }, workers: { n: 0 }, middle: { n: 0 }, elite: { n: 0 } } }; migrate(r, q, .4); assert.ok(q.groups.some(g => g.eth === 'Marun'), 'the migrating people arrive');
  assert.equal(applyOp(w, w.characters[c.leader], { op: 'set_culture_policy', language: 'tolerate', _law: true }).ok, true); assert.equal(c.languagePolicy, 'tolerate');
});
ok('A leader from another people loses legitimacy in a nationalist country', () => {
  const w = inherited(), c = aliveCountries(w)[0], l = w.characters[c.leader]; c.axes.nation = 80; l.origin = { eth: c.majorityEth, rel: c.majorityRel }; assert.equal(leaderForeignness(w, c), 0); l.origin = { eth: 'Keltish-x', rel: c.majorityRel }; assert.ok(leaderForeignness(w, c) > 5);
});
chain('The state reaches remote provinces poorly, a governor extends it, collection changes', () => {
  const w = inherited(), c = aliveCountries(w).find(x => countryProvinces(w, x.id).length > 8), provs = countryProvinces(w, c.id); initAdmin(w); const cap = w.provinces[c.capital], far = provs.reduce((a, b) => (a.admin < b.admin ? a : b)); assert.ok(cap.admin > far.admin, `${cap.admin} / ${far.admin}`);
  const before = far.admin; assert.equal(applyOp(w, w.characters[c.leader], { op: 'appoint_governor', province: far.id, character: c.general }).ok, true); for (let i = 0; i < 30; i++) adminStep(w); assert.ok(far.admin > before, 'a governor raises reach'); assert.ok(c._adminFactor > 0);
  far.admin = .1; assert.ok(adminPressure(far) > 0, 'weak administration means unrest');
});
chain('A contract starts on acceptance, payment and delivery run, a breach is written', () => {
  const w = fresh(), c = w.countries.U1, a = w.characters[c.oligarch], b = w.characters[w.countries.U2.oligarch], A0 = 500; a.wealth = A0; b.wealth = 100; run(w, 1); w.routes['U1|U2'] = { mode: 'land', cost: 1, path: [], tolls: [] };
  const r = applyOp(w, a, { op: 'propose_contract', to: b.id, terms: 'Iron agreement', pay_per_turn: 10, good: 'iron', amount: 5, seller: 'them', turns: 3 }); assert.equal(r.ok, true); assert.equal(a.wealth, A0, 'no money moves before acceptance'); const k = w.contracts.at(-1);
  contractStep(w); assert.equal(k.status, 'proposed'); assert.equal(applyOp(w, b, { op: 'accept_contract', id: k.id }).ok, true); w.firms.SRY = { id: 'SRY', status: 'open', owner: b.id, sector: 'mine', resource: 'iron', country: 'U2', province: countryProvinces(w, 'U2')[0].id, stake: 0, cash: 0, lastProfit: 0, bad: 0 };
  w.countries.U2.stock.iron = 100; c.stock.iron = 0; contractStep(w); assert.equal(a.wealth, A0 - 10); assert.equal(b.wealth, 110); assert.equal(c.stock.iron, 5);
  w.countries.U2.stock.iron = 0; contractStep(w); assert.ok(k.breaches?.some(x => x.who === b.id), 'short delivery is a breach'); assert.ok(a.inbox.some(m => m.text.includes('breached')));
  w.turn = k.until; contractStep(w); assert.equal(k.status, 'finished');
});
chain('Ship types: battleships are stronger, submarines hit trade but cannot hold the sea', () => {
  const setup = (a, b) => { const w = fresh(), sea = Object.keys(w.seas)[0]; for (const f of Object.values(w.fleets)) delete w.fleets[f.id]; w.wars.push({ id: 'SD', a: ['U1'], b: ['U2'], civil: false, active: true, start: 0, name: 'D' }); const fa = makeFleet(w, 'U1', sea, 5), fb = makeFleet(w, 'U2', sea, 12); fa.kind = a; fb.kind = b; return { w, sea, fa, fb }; };
  const s = setup('battleship', 'cruiser'); militaryStep(s.w); assert.equal(s.w.seaControl[s.sea], 'U1');
  const t = setup('submarine', 'cruiser'); t.fb.ships = 1; militaryStep(t.w); assert.notEqual(t.w.seaControl[t.sea], 'U1', 'a submarine does not hold the sea'); assert.ok(t.w.seaRaids[t.sea].includes('U1'));
  const w = fresh(), c = w.countries.U1, p = countryProvinces(w, 'U1').find(q => q.coast) ?? countryProvinces(w, 'U1')[0]; p.port = 1; c.treasury = c.gdp * 3; c.stock.steel = 1000; assert.equal(applyOp(w, ld(w, c), { op: 'build_ship', province: p.id, ships: 1, kind: 'submarine' }).ok, false, 'requires technology');
});
ok('Names follow culture: country, person and province names come from the people\'s language', () => {
  const w = inherited(), cs = aliveCountries(w); assert.ok(cs.every(c => /Kingdom|Republic|Empire|Confederation|Provinces|State|Council|Government|Ports|Principality|Crown/.test(c.name)), cs.map(c => c.name).join(', ')); assert.ok(new Set(Object.values(w.provinces).map(p => p.name)).size === Object.keys(w.provinces).length, 'province names are unique');
  for (const c of cs) { const eth = c.majorityEth, names = Object.values(w.characters).filter(x => x.country === c.id && x.origin?.eth === eth).map(x => x.name.split(' ')[0]); assert.ok(names.every(n => givenNames(eth, c.majorityRel).includes(n)), `${eth}: ${names}`); }
  assert.ok(!cs.some(c => /[çğıöşüÇĞİÖŞÜ]/.test(c.name)), 'English spelling');
});
await (async () => {
  const w = inherited(), store = tempStore(); w.status = 'playing'; beginTurn(w); stepWorld(w); store.commit(w, []); const line = JSON.parse(fs.readFileSync(store.file('positions.ndjson'), 'utf8').trim()); assert.ok(line.units.length && line.units[0].length === 6, 'unit position'); assert.ok(line.t === w.turn); fs.rmSync(store.dir, { recursive: true, force: true }); console.log('passed  Unit and fleet positions are saved every turn');
})();
ok('A ruler\'s schooling follows the state that produced them', () => {
  const w = inherited(), texts = aliveCountries(w).map(c => [c.archetype, w.characters[c.leader].life.find(e => e.text.startsWith('Educated')).text]);
  const junta = texts.find(([k]) => k === 'junta'); if (junta) assert.ok(/war college|cavalry|artillery/.test(junta[1]), junta[1]);
  assert.ok(new Set(texts.map(x => x[1])).size >= 3, JSON.stringify(texts));
});
ok('A contract can name a foreigner by name or by country', () => {
  const w = fresh(), a = w.characters[w.countries.U1.oligarch], b = w.characters[w.countries.U2.oligarch];
  assert.equal(applyOp(w, a, { op: 'propose_contract', to: b.name, terms: 'x', turns: 2 }).ok, true); assert.equal(w.contracts.at(-1).b, b.id);
  assert.equal(applyOp(w, a, { op: 'propose_contract', to: 'U2', terms: 'y', turns: 2 }).ok, true); assert.equal(w.contracts.at(-1).b, w.countries.U2.leader);
  assert.equal(applyOp(w, a, { op: 'propose_contract', to: 'nobody', terms: 'z' }).ok, false);
});
const firmWorld = () => { const w = fresh(), c = w.countries.U1; run(w, 1); const p = countryProvinces(w, 'U1').find(q => q.plants.goods > .1) ?? countryProvinces(w, 'U1')[0]; p.plants.goods = 2; const f = { id: 'SRX', name: 'Test Textile', country: 'U1', province: p.id, sector: 'goods', resource: null, stake: 1, owner: c.oligarch, cash: 0, lastProfit: 0, founded: 0, status: 'open', bad: 0, offer: null }; w.firms.SRX = f; return { w, c, p, f, ol: w.characters[c.oligarch] }; };
const sellGoods = (c, goods = 100, timber = 1) => { Object.assign(c.prices, { goods, timber, coal: 1, steel: 1 }); c._made = { ...c._made, goods: 200 }; };
chain('A company profits from the domestic market, the owner gets dividends, the treasury if state-owned', () => {
  const { w, c, f, ol } = firmWorld(); sellGoods(c); const before = ol.wealth;
  firmStep(w); assert.ok(f.lastProfit > 0, `profit ${f.lastProfit}`); assert.ok(ol.wealth > before, 'the owner receives a dividend'); assert.ok(f.cash > 0, 'company cash');
  f.owner = STATE; const t = c.treasury; firmStep(w); assert.ok(c.treasury > t, 'a state company pays into the treasury');
});
chain('A foreign owner\'s profit leaves the country as gold', () => {
  const { w, c, f } = firmWorld(), foreign = w.characters[w.countries.U2.oligarch], home = w.countries.U2; f.owner = foreign.id; c.reserves = 1000; const r = [c.reserves, home.reserves]; sellGoods(c);
  firmStep(w); assert.ok(c.reserves < r[0] && home.reserves > r[1], `${c.reserves}/${home.reserves}`);
});
chain('A loss-making company goes under, capacity falls, unrest comes', () => {
  const { w, c, f, p } = firmWorld(); f.cash = -5; const cap = p.plants.goods, unrest = p.unrest;
  for (let i = 0; i < 6; i++) { sellGoods(c, 1, 300); firmStep(w); } assert.equal(f.status, 'bankrupt'); assert.ok(p.plants.goods < cap); assert.ok(p.unrest > unrest);
});
chain('Nationalization is held up in parliament; if it passes the owner loses the company and the foreigner is angered', () => {
  const { w, c, f } = firmWorld(), l = ld(w, c), foreign = w.characters[w.countries.U2.oligarch]; f.owner = foreign.id; const rel = w.countries.U2.relations.U1 ?? 0, sat = c.blocs.capital.sat;
  assert.equal(applyOp(w, l, { op: 'nationalize_company', id: 'SRX' }).ok, true); assert.equal(f.owner, STATE); assert.ok(w.countries.U2.relations.U1 < rel); assert.ok(c.blocs.capital.sat < sat); assert.ok(foreign.inbox.some(m => m.text.includes('seized')));
  c.elections = true; makeParliament(c, 'Assembly'); f.owner = foreign.id; const r = applyOp(w, l, { op: 'nationalize_company', id: 'SRX' }); assert.ok(r.msg.includes('Referred to parliament'), r.msg); assert.equal(f.owner, foreign.id);
});
ok('A company can be sold, founded and grown by investment; no one unauthorized can touch it', () => {
  const { w, c, f, p, ol } = firmWorld(), g = w.characters[c.general]; ol.wealth = 500; g.wealth = 500;
  assert.equal(applyOp(w, g, { op: 'invest_company', id: 'SRX', amount: 10 }).ok, false); assert.equal(applyOp(w, ol, { op: 'sell_company', id: 'SRX', buyer: g.id, price: 100 }).ok, true); assert.equal(applyOp(w, g, { op: 'buy_company', id: 'SRX' }).ok, true); assert.equal(f.owner, g.id); assert.equal(g.wealth, 400); assert.equal(ol.wealth, 600);
  const cap = p.plants.goods; assert.equal(applyOp(w, g, { op: 'invest_company', id: 'SRX', amount: 100 }).ok, true); assert.ok(p.plants.goods > cap); assert.ok(Math.abs(f.stake - 1) < 1e-9);
  const r = applyOp(w, ol, { op: 'found_company', name: 'New Textile', sector: 'goods', province: p.id, amount: 200 }); assert.equal(r.ok, true, r.msg); const n = w.firms[r.firm]; assert.ok(n.stake > 0 && f.stake < 1, 'shares split within a shared province'); assert.ok(Math.abs(n.stake + f.stake - 1) < 1e-9);
  c.capitalClosed = true; assert.equal(applyOp(w, w.characters[w.countries.U2.oligarch], { op: 'found_company', sector: 'goods', province: p.id, amount: 5 }).ok, false, 'capital controls stop the foreigner');
});
ok('On the owner\'s death a company passes to the heir; when the country changes it is left ownerless', () => {
  const { w, c, f, ol, p } = firmWorld(); ol.alive = false; const heir = spawnHeir(w, c); c.oligarch = heir.id; firmStep(w); assert.equal(f.owner, heir.id); p.controller = 'U2'; firmStep(w); assert.equal(f.country, 'U2'); assert.equal(f.owner, null);
});
ok('Routes are known in the first quarter, a shipment decision is not wasted', () => {
  const w = inherited(); assert.ok(Object.keys(w.routes).length > 0, 'no route'); const [k] = Object.keys(w.routes), [a, b] = k.split('|'); w.countries[a].stock.grain = 100; assert.equal(applyOp(w, leaderOf(w, a), { op: 'ship_goods', target: b, good: 'grain', amount: 10 }).ok, true);
});
ok('The inherited world has companies and owners, they run and make a profit', () => {
  const w = inherited(), firms = Object.values(w.firms); assert.ok(firms.length >= 15, `companies ${firms.length}`); assert.ok(firms.some(f => w.characters[f.owner]?.role === 'oligarch')); assert.ok(firms.some(f => f.owner === null)); assert.ok(firms.every(f => f.name && !f.name.includes('undefined')));
  for (let i = 0; i < 8; i++) { beginTurn(w); stepWorld(w); } assert.ok(Object.values(w.firms).some(f => f.lastProfit > 0), 'there should be a profitable company'); console.log(`       sample profits: ${Object.values(w.firms).map(f => Math.round(f.lastProfit)).sort((a, b) => b - a).slice(0, 8).join(', ')}; oligarch wealth: ${aliveCountries(w).map(c => Math.round(w.characters[c.oligarch]?.wealth ?? 0)).join(', ')}`);
});
ok('States are inherited: regime, army, money and debt differ by country', () => {
  const w = inherited(), cs = aliveCountries(w), men = c => Object.values(w.units).filter(u => u.country === c.id).reduce((a, u) => a + u.men, 0);
  assert.equal(w.status, 'founding'); assert.equal(new Set(cs.map(c => c.archetype)).size, 5, 'the same type should not appear twice'); assert.ok(new Set(cs.map(c => c.regime)).size >= 4); assert.ok(cs.every(c => c.name && !c.name.startsWith('Region')));
  const spread = f => { const v = cs.map(f); return Math.max(...v) / Math.max(Math.min(...v), .001); };
  assert.ok(spread(c => men(c) / c.gdp) > 1.8, `army ${spread(c => men(c) / c.gdp)}`); assert.ok(spread(c => c.reserves / c.gdp) > 2, 'reserves'); assert.ok(spread(c => c.debt / c.gdp) > 1.5, 'debt'); assert.ok(spread(c => Object.values(c.budget).reduce((a, x) => a + x, 0)) > 1.2, 'budget'); assert.ok(spread(c => c.literacy) > 1.3, 'literacy');
});
ok('The past is fact: the people of a lost province, debts and the rise to power are real', () => {
  for (const seed of [1848, 42, 7]) {
    const w = inherited(seed); assert.ok(w.past.length >= 2, `events ${w.past.length}`); assert.ok(aliveCountries(w).every(c => w.characters[c.leader].rise));
    assert.ok(!w.past.some(e => /\b(hatred|anger|revenge|grudge)\b/i.test(e.text)), 'no feelings are written');
    for (const c of aliveCountries(w)) for (const [id, amt] of Object.entries(c.creditors)) { assert.ok(amt > 0 && w.countries[id]); assert.ok(w.past.some(e => e.countries.includes(id) && e.countries.includes(c.id) && e.text.includes('has owed'))); }
    for (const e of w.past.filter(x => x.text.includes('passed from'))) { const p = Object.values(w.provinces).find(q => e.text.includes(`province of ${q.name} passed`)), loser = w.countries[e.countries[1]]; assert.equal(p.eth, loser.majorityEth, 'the people of the lost province really are from the other side'); assert.equal(p.controller, e.countries[0]); }
  }
});
ok('An electoral regime gets a parliament with real support; a non-electoral regime is not held up by parliament', () => {
  const w = inherited(); for (const c of aliveCountries(w)) { if (c.elections) { assert.ok(c.parliament?.legislative, c.name); assert.ok(new Set(Object.values(c.parliament.seats)).size > 1, `equal seats: ${JSON.stringify(c.parliament.seats)}`); assert.equal(Object.values(c.parliament.seats).reduce((a, x) => a + x, 0), 100); } else if (c.parliament) assert.equal(c.parliament.legislative, false, 'an advisory assembly does not stop operations'); }
});
ok('Backgrounds do not repeat within a world, inherited information comes only on the first call', () => {
  const w = inherited(), leaders = aliveCountries(w).map(c => w.characters[c.leader]); assert.equal(new Set(leaders.map(l => l.background)).size, leaders.length);
  const l = leaders[0], first = actorPrompt(w, l, [], true, { intro: true }), later = actorPrompt(w, l, [], true, { intro: false });
  assert.ok(first.includes('The country you inherited') && first.includes(l.rise)); assert.ok(!later.includes('The country you inherited') && !later.includes(l.rise));
  assert.ok(answer(w, l, 'history').length > 20);
});
await (async () => {
  const cfg = { ...base, plainStates: false, seed: 42 }, w = createWorld(cfg), g = new Game({ world: w, cfg, backend: { kind: 'mock' }, store: nullStore() }); const orig = g.turn.bind(g);
  g.turn = async () => { await orig(); if (w.turn >= 100) g.stop = true; }; await g.run(0);
  const med = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)], cs = aliveCountries(w);
  assert.ok(med(cs.map(c => c.priceLevel)) < 100, `hyperinflation: price ${med(cs.map(c => c.priceLevel))}`); console.log(`passed  Inherited worlds do not collapse in 100 turns (${cs.length} powers, median legitimacy ${Math.round(med(cs.map(c => c.legitimacy)))})`);
})();
chain('Direct shipment moves stock to stock, and does not go without a route', () => {
  const w = fresh(), a = w.countries.U1, b = w.countries.U2; run(w, 1); const k = 'U1|U2'; w.routes[k] = { mode: 'land', cost: 1.04, path: [], tolls: [] }; a.stock.iron = 100; b.stock.iron = 0; leaderOf(w, 'U2').inbox = [];
  assert.equal(applyOp(w, leaderOf(w), { op: 'ship_goods', target: 'U2', good: 'iron', amount: 52 }).ok, true); assert.equal(a.stock.iron, 48); assert.equal(Math.round(b.stock.iron), 50); assert.ok(leaderOf(w, 'U2').inbox.at(-1).text.includes('iron'));
  assert.equal(applyOp(w, w.characters[a.general], { op: 'ship_goods', target: 'U2', good: 'iron', amount: 1 }).ok, false, 'a general cannot ship state stock');
  delete w.routes[k]; assert.equal(applyOp(w, leaderOf(w), { op: 'ship_goods', target: 'U2', good: 'iron', amount: 10 }).ok, false); assert.equal(a.stock.iron, 48);
});
chain('A persistent goods shortage raises the price once and does not produce inflation every quarter', () => {
  const w = fresh(), c = w.countries.U1; let peak = 0;
  for (let i = 0; i < 24; i++) { c.stock.goods = 0; for (const p of countryProvinces(w, 'U1')) p.plants.goods = 0; beginTurn(w); stepWorld(w); if (i < 4) peak = Math.max(peak, c.inflation); }
  assert.ok(peak > .02, `the first shock should be visible: ${peak}`); assert.ok(c.inflation < .05, `inflation during the shortage ${c.inflation}`);
});
chain('A bad harvest leaves no lasting inflation: money contracts in a slump too', () => {
  const w = fresh(), c = w.countries.U1; c.stock.grain = 1e6;
  for (let i = 0; i < 40; i++) { for (const p of Object.values(w.provinces)) if (i % 2) p.fertility *= .9; else p.fertility /= .9; beginTurn(w); stepWorld(w); c.stock.grain = 1e6; }
  assert.ok(c.priceLevel < 2.2, `price level ${c.priceLevel}`);
});
await (async () => {
  const w = createWorld(base), g = new Game({ world: w, cfg: base, backend: { kind: 'mock' }, store: nullStore() }); const orig = g.turn.bind(g);
  g.turn = async () => { await orig(); if (w.turn >= 100) g.stop = true; }; await g.run(0);
  const med = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)], cs = aliveCountries(w);
  assert.ok(med(cs.map(c => c.inflation)) < .05, `inflation ${med(cs.map(c => c.inflation))}`); assert.ok(med(cs.map(c => c.priceLevel)) < 20, `price ${med(cs.map(c => c.priceLevel))}`); assert.ok(med(cs.map(c => c.inputRatio)) > .75, `industrial inputs ${med(cs.map(c => c.inputRatio))}`);
  console.log('passed  The economy does not collapse on its own in 100 turns');
})();

const parliamentWorld = () => { const w = fresh(), c = w.countries.U1; c.elections = true; makeParliament(c, 'Assembly'); return { w, c, l: leaderOf(w) }; };
const stepOnce = w => { beginTurn(w); stepWorld(w); };

chain('An institution is fed from the budget, lowers corruption and fades when funding stops', () => {
  const a = fresh(), b = fresh(), ca = a.countries.U1, cb = b.countries.U1;
  for (const c of [ca, cb]) { c.corruption = 50; c.treasury = c.gdp * 2; }
  const r = applyOp(a, leaderOf(a), { op: 'create_institution', name: 'Court of Audit', description: 'Audits spending', budget_pct_gdp: .004, powers: ['audit'] });
  assert.equal(r.ok, true); const inst = ca.institutions.at(-1); assert.ok(inst.id && inst.head === ca.leader);
  const before = ca.treasury; run(a, 6); run(b, 6);
  assert.ok(ca.corruption < cb.corruption - 1, `${ca.corruption} / ${cb.corruption}`); assert.ok(inst.strength > .3, `strength ${inst.strength}`); assert.ok(before);
  const peak = inst.strength; inst.budget = 0; run(a, 10); assert.ok(inst.strength < peak * .4, `${inst.strength}`);
});
ok('A member uses the authority given to the institution, and cannot without it', () => {
  const w = fresh(), c = w.countries.U1, g = w.characters[c.general]; c.treasury = c.gdp * 2;
  assert.equal(applyOp(w, g, { op: 'set_tax', kind: 'income', rate: .3 }).ok, false);
  applyOp(w, leaderOf(w), { op: 'create_institution', name: 'Finance Board', budget_pct_gdp: .004, powers: ['bureaucracy'], authority: ['set_tax', 'declare_war'], head: g.id });
  const inst = c.institutions.at(-1); assert.deepEqual(inst.authority, ['set_tax'], 'the decision for war cannot be delegated'); inst.strength = .6;
  assert.equal(applyOp(w, g, { op: 'set_tax', kind: 'income', rate: .3 }).ok, true); assert.equal(c.tax.income, .3);
  assert.equal(applyOp(w, w.characters[c.opposition], { op: 'set_tax', kind: 'income', rate: .1 }).ok, false);
});
ok('An institution founded by a person cannot get state powers and is fed from their own wealth', () => {
  const w = fresh(), c = w.countries.U1, o = w.characters[c.oligarch]; o.wealth = 400;
  applyOp(w, o, { op: 'create_institution', name: 'Private University', amount: 20, powers: ['education', 'security'], authority: ['set_tax'] });
  const inst = c.institutions.at(-1); assert.deepEqual(inst.powers, ['education']); assert.deepEqual(inst.authority, []); const before = o.wealth; run(w, 1); assert.ok(o.wealth <= before - 20 + 5, `${o.wealth}/${before}`);
});
ok('A strong institution\'s veto stops the leader', () => {
  const w = fresh(), c = w.countries.U1, l = leaderOf(w); c.courts = 100;
  applyOp(w, l, { op: 'create_institution', name: 'Constitutional Court', budget_pct_gdp: .003, powers: ['judiciary'], veto: ['print_money'], head: c.opposition });
  c.institutions.at(-1).strength = 1.2; let blocked = 0; for (let i = 0; i < 40; i++) if (!applyOp(w, l, { op: 'print_money', pct_gdp: .001 }).ok) blocked++;
  assert.ok(blocked > 25, `blocked ${blocked}`);
});
chain('A legislature turns a tax into a bill; it is applied if a majority passes it', () => {
  const { w, c, l } = parliamentWorld(), rate = c.tax.income, rul = c.parties[0]; c.rulingParty = rul.id; c.parliament.seats = { [rul.id]: 60, [c.parties[1].id]: 40 };
  const r = applyOp(w, l, { op: 'set_tax', kind: 'income', rate: .33 }); assert.ok(r.msg.includes('Referred to parliament'), r.msg); assert.equal(c.tax.income, rate, 'not applied before the vote');
  const bill = c.bills.at(-1); bill.votes[rul.id] = 'yes'; bill.votes[c.parties[1].id] = 'no';
  stepOnce(w); assert.equal(bill.status, 'pending', 'not voted on in the same quarter'); stepOnce(w);
  assert.equal(bill.status, 'passed'); assert.equal(c.tax.income, .33); assert.ok(c.laws.some(x => x.id === bill.id));
});
chain('A government without a majority loses its bill; suspending parliament has a price', () => {
  const { w, c, l } = parliamentWorld(), a = c.parties[0], b = c.parties[1]; c.rulingParty = a.id; c.parliament.seats = { [a.id]: 30, [b.id]: 70 }; const rate = c.tax.income;
  applyOp(w, l, { op: 'set_tax', kind: 'income', rate: .4 }); const bill = c.bills.at(-1); bill.votes[a.id] = 'yes'; bill.votes[b.id] = 'no'; const legit = c.legitimacy;
  stepOnce(w); stepOnce(w); assert.equal(bill.status, 'rejected'); assert.equal(c.tax.income, rate); assert.ok(c.legitimacy < legit + 8);
  const before = c.legitimacy; assert.equal(applyOp(w, l, { op: 'suspend_parliament', turns: 4 }).ok, true); assert.ok(c.legitimacy < before);
  assert.equal(applyOp(w, l, { op: 'set_tax', kind: 'income', rate: .4 }).ok, true); assert.equal(c.tax.income, .4, 'passes by decree while suspended');
});
ok('A party leader sets the party\'s vote; money affects the vote and leaves a trace', () => {
  const { w, c, l } = parliamentWorld(), o = w.characters[c.oligarch], rival = [...c.parties].filter(p => p.id !== c.rulingParty).sort((a, b) => b.support - a.support)[0], opp = w.characters[c.opposition]; o.wealth = 500;
  const b = applyOp(w, opp, { op: 'propose_law', title: 'Press Act', text: 'Censorship is lifted.' }).bill; const bill = c.bills.find(x => x.id === b); assert.ok(bill);
  assert.equal(applyOp(w, opp, { op: 'vote_bill', bill: b, vote: 'no' }).ok, true); assert.equal(bill.votes[rival.id], 'no');
  assert.equal(applyOp(w, w.characters[c.general], { op: 'vote_bill', bill: b, vote: 'yes' }).ok, false, 'a partyless general cannot vote');
  assert.equal(applyOp(w, o, { op: 'lobby_bill', bill: b, party: c.rulingParty, amount: 100 }).ok, true); assert.equal(bill.lobby[c.rulingParty], 100); assert.ok(o.secrets.at(-1).text.includes('Press Act')); assert.equal(o.wealth, 400); assert.ok(l);
});
chain('Tribute is paid every turn; if unpaid a breach is recorded and both leaders learn of it', () => {
  const w = fresh(), a = w.countries.U1, b = w.countries.U2, la = leaderOf(w), lb = leaderOf(w, 'U2'); a.reserves = 1e6;
  assert.equal(applyOp(w, la, { op: 'propose_treaty', target: 'U2', kind: 'trade', terms: 'Tribute', clauses: [{ type: 'tribute', payer: 'U1', pct_gdp: .01, turns: 20 }, { type: 'tribute', payer: 'U9', pct_gdp: .5, turns: 20 }, { type: 'unknown' }] }).ok, true);
  const t = w.treaties.at(-1); assert.equal(t.clauses.length, 1, 'an invalid clause is dropped'); assert.equal(applyOp(w, lb, { op: 'accept_treaty', id: t.id }).ok, true);
  beginTurn(w); const res = [a.reserves, b.reserves], treatyOnly = Math.max(a.gdp, 1) * .01; treatyStep(w); assert.ok(a.reserves < res[0] - treatyOnly * .9); assert.ok(b.reserves > res[1] + treatyOnly * .9);
  a.reserves = 0; la.inbox = []; lb.inbox = []; treatyStep(w); assert.equal(t.breaches.at(-1).party, 'U1'); assert.ok(la.inbox.some(m => m.text.includes('breached')) && lb.inbox.some(m => m.text.includes('breached')));
  assert.ok(answer(w, lb, 'treaties').includes('could not pay its tribute'));
  const others = aliveCountries(w).filter(o => o.id !== 'U1' && o.id !== 'U2')[0], rel = others.relations.U2 ?? 0, bRel = a.relations.U2 ?? 0;
  assert.equal(applyOp(w, lb, { op: 'break_treaty', id: t.id }).ok, true); assert.equal(others.relations.U2 ?? 0, rel, 'termination against a breaching party costs no standing in the world'); assert.ok((a.relations.U2 ?? 0) <= bRel);
});
chain('Delivery moves stock to stock, a tariff clause lowers import costs', () => {
  const w = fresh(), a = w.countries.U1, b = w.countries.U2; run(w, 1); const k = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`; w.routes[k] ||= { mode: 'land', cost: 1.04, path: [], tolls: [] }; a.stock.grain = 500; b.stock.grain = 0;
  applyOp(w, leaderOf(w), { op: 'propose_treaty', target: 'U2', kind: 'trade', clauses: [{ type: 'delivery', from: 'U1', good: 'grain', amount: 100, turns: 5 }, { type: 'tariff', rate: 0 }] }); const t = w.treaties.at(-1); applyOp(w, leaderOf(w, 'U2'), { op: 'accept_treaty', id: t.id });
  treatyStep(w); assert.equal(a.stock.grain, 400); assert.equal(b.stock.grain, 100); assert.equal(a.tariffDeals.U2, 0); assert.equal(b.tariffDeals.U1, 0);
  a.stock.grain = 10; treatyStep(w); assert.ok(t.breaches.some(x => x.party === 'U1'));
});
ok('Entering a demilitarized zone and exceeding a troop limit are breaches', () => {
  const w = fresh(), a = w.countries.U1, u = Object.values(w.units).find(x => x.country === 'U1'), men = Object.values(w.units).filter(x => x.country === 'U1').reduce((s, x) => s + x.men, 0);
  applyOp(w, leaderOf(w), { op: 'propose_treaty', target: 'U2', kind: 'nonaggression', clauses: [{ type: 'demilitarized_zone', country: 'U1', provinces: [u.province] }, { type: 'troop_limit', country: 'U1', men: men - 1 }] }); const t = w.treaties.at(-1); applyOp(w, leaderOf(w, 'U2'), { op: 'accept_treaty', id: t.id });
  treatyStep(w); assert.equal(t.breaches.length, 2, JSON.stringify(t.breaches)); assert.ok(a);
});
ok('Leaving an attacked ally alone is a breach', () => {
  const w = fresh(); applyOp(w, leaderOf(w), { op: 'propose_treaty', target: 'U2', kind: 'alliance', clauses: [{ type: 'mutual_defense' }] }); const t = w.treaties.at(-1); applyOp(w, leaderOf(w, 'U2'), { op: 'accept_treaty', id: t.id });
  w.wars.push({ id: 'SZ', a: ['U3'], b: ['U1'], civil: false, active: true, start: w.turn, name: 'Z' }); treatyStep(w); assert.equal(t.breaches.length, 0, 'time is allowed');
  w.turn += 2; treatyStep(w); assert.equal(t.breaches.at(-1).party, 'U2'); w.turn += 8; treatyStep(w); assert.equal(t.breaches.length, 1, 'a single breach per war');
});
ok('A term treaty ends, institution and law events are written to the ledger', () => {
  const { w, c, l } = parliamentWorld(); applyOp(w, l, { op: 'propose_treaty', target: 'U2', kind: 'trade', turns: 1, clauses: [{ type: 'tariff', rate: .05 }] }); const t = w.treaties.at(-1); applyOp(w, leaderOf(w, 'U2'), { op: 'accept_treaty', id: t.id }); w.turn += 1; treatyStep(w); assert.equal(t.active, false);
  const snap = snapshotState(w); applyOp(w, l, { op: 'create_institution', name: 'Port Board', budget_pct_gdp: .002, powers: ['industry'] }); applyOp(w, l, { op: 'propose_law', title: 'Port Act', text: 'x' }); applyOp(w, l, { op: 'suspend_parliament', turns: 3 });
  const list = buildEntries(w, { trace: [], rulings: [], messages: [] }, snap).filter(e => e.k === 'state'); assert.ok(list.some(e => e.text.includes('Port Board'))); assert.ok(list.some(e => e.text.includes('Port Act'))); assert.ok(list.some(e => e.text.includes('suspended') && e.imp === 3));
});
await (async () => {
  const w = createWorld(base), g = new Game({ world: w, cfg: base, backend: { kind: 'mock' }, store: nullStore() });
  await g.turn(); const cs = aliveCountries(w); assert.ok(cs.some(c => c.elections) ? cs.filter(c => c.elections).every(c => c.parliament) : true);
  const orig = g.turn.bind(g); let bills = 0; g.turn = async () => { await orig(); bills = Math.max(bills, ...aliveCountries(w).map(c => (c.bills || []).length)); if (w.turn >= 200) g.stop = true; };
  await g.run(0); assert.ok(bills <= 60, `bills piled up: ${bills}`); console.log(`passed  Parliament did not pile up over 200 mock turns (${aliveCountries(w).length} powers, at most ${bills} bills)`);
})();

ok('Country relations are not visible as numbers, the facts are', () => {
  const w = fresh(), c = w.countries.U1, o = w.countries.U2; c.embargo.push('U2');
  w.wars.push({ id: 'SY', a: ['U1'], b: ['U3'], civil: false, active: true, start: w.turn, name: 'Y' });
  const a = answer(w, ld(w, c), 'world'); assert.ok(!/relation/.test(a), a); assert.ok(a.includes('AT WAR') && a.includes('you embargo them'), a); assert.ok(o);
});
ok('A bribe does not write an AI character\'s loyalty; the money and the news arrive', () => {
  const w = fresh(), c = w.countries.U1, ol = w.characters[c.oligarch], g = w.characters[c.general]; ol.wealth = 500; g.aiControlled = true; const loyal = g.loyalty, money = g.wealth;
  assert.equal(applyOp(w, ol, { op: 'bribe', character: g.id, amount: 100 }).ok, true);
  assert.equal(g.loyalty, loyal); assert.equal(g.wealth, money + 100); assert.ok(g.inbox.at(-1).text.includes('100'));
  const n = w.characters[c.opposition]; n.aiControlled = false; n.greed = 80; const before = n.loyalty; applyOp(w, ol, { op: 'bribe', character: n.id, amount: 100 }); assert.ok(n.loyalty !== before || before === 100, 'the number changes for a rule-based character');
});
chain('Embezzlement → trace → dossier → blackmail and exposure lower legitimacy', () => {
  const w = fresh(), c = w.countries.U1, l = ld(w, c), o = w.characters[c.opposition]; c.intelligence = 100; c.treasury = c.gdp; c.pressFreedom = 80;
  const clean = w.characters[c.general]; for (let i = 0; i < 40 && !o.dossiers[clean.id]; i++) applyOp(w, o, { op: 'gather_dossier', character: clean.id });
  assert.ok(o.dossiers[clean.id], 'a dossier should open'); assert.equal(applyOp(w, o, { op: 'blackmail', character: clean.id, demand: 'x' }).ok, false, 'no blackmail with an empty dossier');
  assert.equal(applyOp(w, l, { op: 'embezzle', pct_gdp: .05 }).ok, true);
  delete o.dossiers[l.id]; for (let i = 0; i < 40 && !o.dossiers[l.id]; i++) applyOp(w, o, { op: 'gather_dossier', character: l.id });
  assert.ok(o.dossiers[l.id].facts[0].includes('Embezzled'), JSON.stringify(o.dossiers[l.id]));
  assert.equal(applyOp(w, o, { op: 'blackmail', character: l.id, demand: 'Step down' }).ok, true); assert.ok(l.inbox.at(-1).text.includes('Embezzled') && l.inbox.at(-1).text.includes('Step down'));
  assert.ok(answer(w, o, 'dossiers').includes('Embezzled'));
  const legit = c.legitimacy; assert.equal(applyOp(w, o, { op: 'publish_dossier', character: l.id }).ok, true);
  assert.ok(c.legitimacy < legit); assert.ok(w.newsThisTurn.some(n => n.text.includes('Leaked documents') && !n.secret)); assert.ok(!o.dossiers[l.id]);
});
chain('Debt → money moves → it falls due → both parties learn, what follows is up to them', () => {
  const w = fresh(), c = w.countries.U1, ol = w.characters[c.oligarch], g = w.characters[c.general]; ol.wealth = 500; g.wealth = 10; g.aiControlled = true; ol.aiControlled = true; const loyal = g.loyalty;
  const r = applyOp(w, ol, { op: 'lend_private', character: g.id, amount: 100, interest: .2, due_turns: 1, terms: 'Stay quiet.' }); assert.equal(r.ok, true); assert.equal(g.wealth, 110); assert.equal(ol.wealth, 400);
  assert.ok(answer(w, g, 'debts').includes('you owe')); assert.ok(answer(w, ol, 'debts').includes('owes you'));
  const debt = w.debts.at(-1); run(w, 1); assert.equal(debt.status, 'open', 'not overdue before the due date');
  const snap = snapshotState(w); g.inbox = []; ol.inbox = []; beginTurn(w); stepWorld(w);
  assert.equal(debt.status, 'overdue'); assert.ok(g.inbox.some(m => m.from === 'Notary')); assert.ok(ol.inbox.some(m => m.from === 'Notary')); assert.equal(g.loyalty, loyal, 'code does not write feelings about the delay');
  assert.ok(buildEntries(w, { trace: [], rulings: [], messages: [] }, snap).some(e => e.text.includes('not paid on time') && e.a.includes(g.id)), 'goes on the ledger');
  g.wealth = 200; assert.equal(applyOp(w, g, { op: 'repay_debt', debt: debt.id }).ok, true); assert.equal(debt.status, 'paid'); assert.equal(Math.round(g.wealth), 80); assert.equal(Math.round(ol.wealth), 520);
  assert.equal(applyOp(w, ol, { op: 'forgive_debt', debt: debt.id }).ok, false);
});
ok('A rule-based character pays an overdue debt if it has the money', () => {
  const w = fresh(), c = w.countries.U1, n = w.characters[c.general], ol = w.characters[c.oligarch]; n.wealth = 1000; w.debts.push({ id: 'B-1', creditor: ol.id, debtor: n.id, amount: 50, owed: 50, due: 0, terms: '', status: 'overdue', turn: 0 });
  assert.deepEqual(npcDecide(w, n), [{ op: 'repay_debt', debt: 'B-1' }]);
});
ok('Character backgrounds write no personality and vary between characters', () => {
  const w = createWorld(base), list = Object.values(w.characters).map(x => x.background); assert.ok(list.every(Boolean)); assert.ok(new Set(list).size >= 6, `variety ${new Set(list).size}`);
  assert.ok(!list.some(b => /cautious|brave|ruthless|idealist|coward/.test(b)), 'should be events only');
  assert.equal(createWorld(base).rng, w.rng, 'world generation is reproducible');
});

await (async () => {
  const { cfg, w } = sessionWorld(); const a = w.countries.U1.leader, b = w.countries.U2.leader, A = w.characters[a], B = w.characters[b], log = []; let judged = '';
  const backend = { kind: 'claude', async ask(p, model, session) {
    if (p.includes('rulings')) { if (p.includes('Plan A') || p.includes('Plan B')) judged += p; return { rulings: [] }; }
    if (p.includes(A.name) && !p.includes('SAME QUARTER')) { log.push('A1'); return { decisions: ['Plan A'], messages: [{ to: 'U2', text: 'Shall we open the border?' }] }; }
    if (p.includes(B.name) && !p.includes('SAME QUARTER')) { log.push('B1'); return { decisions: ['Plan B'], messages: [] }; }
    if (p.includes('open the border')) { log.push('B2'); assert.ok(session.resume); return { inner_voice: 'All right.', messages: [{ to: a, text: 'Agreed, my condition is tariffs.' }] }; }
    if (p.includes('my condition is tariffs')) { log.push('A2'); return { decisions: ['Plan A: tariff-free border'], messages: [{ to: 'U2', text: 'We have a deal.' }] }; }
    return { decisions: [], messages: [] };
  } };
  const g = new Game({ world: w, cfg: { ...cfg, maxLookupRounds: 0, negotiationRounds: 2 }, backend, store: memoryStore() });
  await g.turn();
  assert.deepEqual(log.filter(x => x !== 'A1' && x !== 'B1'), ['B2', 'A2'], 'limited to two rounds');
  assert.ok(judged.includes('tariff-free border') && !/\bPlan A\n/.test(judged), 'the referee sees the final decision');
  assert.ok(!B.inbox.some(m => m.text.includes('open the border')), 'a read message does not carry over to the next turn');
  assert.ok(B.inbox.some(m => m.text === 'We have a deal.'), 'a message after the last round is held for next quarter');
  console.log('passed  Chain: same-quarter bargaining changes decisions, the referee sees the final version');
})();

await (async () => {
  const cfg = { ...base, agentRoles: ['leader', 'general'], maxLookupRounds: 0, concurrency: 1, wakeEvery: 99, wakeTension: 999 }, w = createWorld(cfg); w.status = 'playing';
  const c = w.countries.U1, l = c.leader, gen = w.characters[c.general]; for (const x of Object.values(w.characters)) x.lastWake = 0; w.turn = 1; let woke = null;
  const backend = { kind: 'claude', async ask(p, model, session) { if (p.includes('rulings')) return { rulings: [] }; if (p.includes(gen.name) && p.includes('SAME QUARTER')) { woke = { p, resume: session.resume }; return { decisions: ['Prepare the unit'], messages: [] }; } if (p.includes(w.characters[l].name) && !p.includes('SAME QUARTER')) return { decisions: [], messages: [{ to: gen.id, text: 'Be ready.' }] }; return { decisions: [], messages: [] }; } };
  const g = new Game({ world: w, cfg, backend, store: memoryStore() });
  await g.turn();
  assert.ok(woke?.p.includes('Your name:') && woke.p.includes('Be ready.') && woke.p.includes(gen.background), 'a sleeping character wakes with the full report');
  assert.equal(gen.lastWake, 1, 'counts as awake');
  console.log('passed  A sleeping AI character who receives a message wakes in the same quarter');
})();


await (async () => {
  const { cfg, w, leader } = sessionWorld(), mine = [], name = w.characters[leader].name;
  const backend = { kind: 'claude', async ask(p, model, session) { if (session && p.includes(name) || mine.length && session?.id === mine[0].session.id) mine.push({ p, session: { ...session } }); return reply(p); } };
  const g = new Game({ world: w, cfg, backend, store: memoryStore() });
  await g.turn();
  assert.equal(mine.length, 2); assert.equal(mine[0].session.resume, false); assert.equal(mine[1].session.resume, true); assert.equal(mine[0].session.id, mine[1].session.id);
  assert.ok(mine[0].p.includes('This is your life'), 'the first call sets up the character');
  assert.ok(!mine[1].p.includes('Your name:') && mine[1].p.includes('WHAT YOU LOOKED UP'), 'the second call sends only the new answers');
  await g.turn();
  assert.equal(mine[2].session.id, mine[0].session.id); assert.equal(mine[2].session.resume, true);
  assert.ok(mine[2].p.includes('Your name:') && !mine[2].p.includes('This is your life'), 'the next turn is only the day\'s report');
  console.log('passed  Each character runs in one session and only new information is sent');
})();

await (async () => {
  const { cfg, w, leader } = sessionWorld(), ch = w.characters[leader]; ch.diary.push('I swore an old oath.'); ch.persona = 'A skeptic.';
  const seen = []; let lost = true;
  const backend = { kind: 'claude', async ask(p, model, session) { if (p.includes(ch.name)) { seen.push({ p, session: { ...session } }); if (session.resume && lost) { lost = false; throw new SessionLostError('none'); } } return reply(p, { decisions: [] }); } };
  const store = memoryStore(), g = new Game({ world: w, cfg: { ...cfg, maxLookupRounds: 0 }, backend, store });
  g.sessions[leader] = { id: 'old', calls: 9, done: 9, intro: true };
  await g.turn();
  assert.equal(seen.length, 2); assert.notEqual(seen[1].session.id, 'old'); assert.equal(seen[1].session.resume, false);
  assert.ok(seen[1].p.includes('old oath') && seen[1].p.includes('skeptic') && seen[1].p.includes('UNREACHABLE'), 'with a lost session the character sees what remains');
  assert.equal(store.loadSessions()[leader].id, seen[1].session.id, 'the new session is recorded');
  console.log('passed  With a lost session the character restarts from its diary');
})();

await (async () => {
  const { cfg, w, leader } = sessionWorld(), ch = w.characters[leader], seen = []; let fail = true;
  const backend = { kind: 'claude', async ask(p, model, session) { if (p.includes(ch.name)) { seen.push({ p, resume: session.resume }); if (fail) { fail = false; throw new LimitError('limit'); } } return reply(p); } };
  const g = new Game({ world: w, cfg: { ...cfg, maxLookupRounds: 0 }, backend, store: memoryStore() });
  await g.turn();
  assert.equal(seen.length, 2); assert.equal(seen[1].resume, true); assert.ok(!seen[0].p.includes('did not reach the system') && seen[1].p.includes('did not reach the system'), 'the unfinished turn is told to the character');
  assert.equal(w.turn, 1); console.log('passed  After the limit the character answers knowing the morning was interrupted');
})();

await (async () => {
  const { cfg, w, leader } = sessionWorld(), ch = w.characters[leader], prompts = [];
  const backend = { kind: 'claude', async ask(p) { if (p.includes(ch.name) && !p.includes('rulings')) { prompts.push(p); return { decisions: ['New calendar'], messages: [] }; } if (p.includes('rulings')) return { rulings: [{ actor: leader, decision: 0, narrative: 'Calendar adopted', probability: 1, operations: [] }] }; return { decisions: [], messages: [] }; } };
  const g = new Game({ world: w, cfg: { ...cfg, maxLookupRounds: 0 }, backend, store: memoryStore() });
  await g.turn(); await g.turn(); await g.turn();
  assert.ok(!prompts[0].includes('Calendar adopted') && prompts[1].includes('Calendar adopted'), 'the outcome is reported at the next wake-up');
  assert.equal(prompts[2].split('Calendar adopted').length, 2, 'each wake-up brings only its own new outcome');
  console.log('passed  Chain: decision, ruling, next morning only the new outcome');
})();
console.log('All checks passed.');
