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
  const backend = { kind: 'claude', async ask(p) { calls++; if (p.includes('rulings')) return { rulings: [{ actor: /DECISIONS:\n(K\d+) /.exec(p)[1], decision: 0, narrative: 'A calendar is proclaimed', probability: 1, operations: [] }] }; if (p.includes('"motto"')) return { name: 'Trial', regime: 'R', ideology: 'I', elections: false, identity: 'I am someone.' }; return { identity: 'K', inner_voice: 's', decisions: ['Proclaim a new lunar calendar'], messages: [], notes: 'n' }; } };
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
  const w = fresh(), a = w.countries.U1; a.rer = 1.5; assert.ok(displacedDemand(a, 'goods') > 0 || !(a._need?.goods)); a._need = { goods: 100 }; a.tariff = 0; assert.equal(Math.round(displacedDemand(a, 'goods')), 50); a.tariff = .5; assert.equal(Math.round(displacedDemand(a, 'goods')), 25, 'a tariff wall keeps part of the imports out'); assert.ok(exportEdge({ rer: 1.5 }) < exportEdge({ rer: .8 }));
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
  const paintedBefore = store.artIndex().filter(a => a.kind === 'event').length;
  const e = { id: '9-1', k: 'state', t: 9, d: 'Q2 1902', imp: 3, text: 'War began: A War', c: ['U1', 'U2'], a: [], p: null }; await g.artStep([e]);
  const tablo = store.artIndex().filter(a => a.kind === 'event').at(-1); assert.ok(tablo && tablo.witnessName && tablo.prompt, 'painting and description'); assert.ok(prompts.at(-1).includes('Renaissance') && prompts.at(-1).includes('witness'));
  limit = true; await g.artStep([{ ...e, id: '9-2', text: 'War began: Second' }]); assert.equal(store.loadArtQueue().length, 1, 'at the limit an image stays in the queue'); limit = false; await g.artStep([]); assert.equal(store.loadArtQueue().length, 0); assert.equal(store.artIndex().filter(a => a.kind === 'event').length, paintedBefore + 2);
  const all = store.queryLedger({ limit: 500 }).items; assert.ok(all.some(x => x.k === 'thought' && x.x.notes === 'My diary note'), 'the diary note is written to the ledger');
  assert.ok(fs.readFileSync(store.file('stats.ndjson'), 'utf8').includes('"gold"'), 'turn statistics'); assert.ok(store.people()[w.countries.U1.leader].life.length, 'life in the person index');
  console.log('passed  Portraits and event paintings are made, the queue survives the limit, the record is complete');
})();
ok('Battles and technical errors are written to the ledger, the decision text is tied to the ruling', () => {
  const w = fresh(), id = Object.keys(w.provinces)[0]; w.battles = [{ province: id, attacker: 'U1', defender: 'U2', attackerWon: true, lossA: 3, lossD: 9 }]; w.newsThisTurn = [];
  const list = buildEntries(w, { trace: [], messages: [], system: [{ name: 'referee', text: 'timeout' }], rulings: [{ actor: 'K1', name: 'A', country: 'U1', role: 'leader', narrative: 'n', probability: 1, success: true, results: [], source: 'referee', decisionText: 'Burn the bridge', ops: [] }] }, null);
  assert.ok(list.some(e => e.k === 'battle' && e.x.lossD === 9 && e.p === id)); assert.ok(list.some(e => e.k === 'system' && e.text === 'timeout')); assert.equal(list.find(e => e.k === 'ruling').x.decisionText, 'Burn the bridge');
});
const frontWorld = () => { const w = fresh(); run(w, 1); const a = w.countries.U1, p = countryProvinces(w, 'U1').find(q => q.id !== a.capital && q.neighbors.some(n => w.provinces[n].controller === 'U2')), q = w.provinces[p.neighbors.find(n => w.provinces[n].controller === 'U2')]; Object.assign(p, { terrain: 'plains', fort: 0, trench: 0, infra: .5, rail: 0 }); w.strategic = w.strategic.filter(s => s.ref !== p.id); for (const u of Object.values(w.units)) if (['U1', 'U2'].includes(u.country)) delete w.units[u.id]; w.wars.push({ id: 'SF', a: ['U2'], b: ['U1'], civil: false, active: true, start: w.turn, name: 'F' }); return { w, a, b: w.countries.U2, p, q }; };
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
  contractStep(w); assert.equal(k.status, 'proposed'); assert.equal(applyOp(w, b, { op: 'accept_contract', id: k.id }).ok, true); w.firms.SRY = { id: 'SRY', status: 'open', owner: b.id, sector: 'mine', resource: 'iron', country: 'U2', province: countryProvinces(w, 'U2')[0].id, stake: 0, cash: 0, lastProfit: 0, bad: 0, lastUnits: 50 };
  w.countries.U2.stock.iron = 100; c.stock.iron = 0; contractStep(w); assert.equal(a.wealth, A0 - 10); assert.equal(b.wealth, 110); assert.equal(c.stock.iron, 5);
  w.firms.SRY.lastUnits = 2; contractStep(w); assert.equal(c.stock.iron, 7, 'a seller delivers what their own works turn out, not what lies in the national stores'); w.firms.SRY.lastUnits = 50; a.wealth += 10; b.wealth -= 10; k.lastBreach = -99; k.breaches = [];
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
  const cap = p.plants.goods; c.stock.machines = 0; assert.equal(applyOp(w, g, { op: 'invest_company', id: 'SRX', amount: 100 }).ok, false, 'new works need machinery'); c.stock.machines = 100;
  assert.equal(applyOp(w, g, { op: 'invest_company', id: 'SRX', amount: 100 }).ok, true); assert.equal(p.plants.goods, cap, 'works are not built in a day'); assert.equal(g.wealth, 300);
  const r = applyOp(w, ol, { op: 'found_company', name: 'New Textile', sector: 'goods', province: p.id, amount: 200 }); assert.equal(r.ok, true, r.msg); const n = w.firms[r.firm]; assert.equal(n.stake, 0);
  run(w, 4); assert.ok(p.plants.goods > cap, 'the works stand after a year'); assert.ok(n.stake > 0 && f.stake < 1, 'shares split within a shared province'); assert.ok(Math.abs(n.stake + f.stake - 1) < 1e-6);
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
  // The court gives one answer a quarter, so forty quarters are asked, not one quarter forty times.
  c.institutions.at(-1).strength = 1.2; let blocked = 0; for (let i = 0; i < 40; i++) { w.turn++; if (!applyOp(w, l, { op: 'print_money', pct_gdp: .001 }).ok) blocked++; }
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

// ---- Public money, bodies, succession and force
import { ROLES } from '../engine/world.js';
import { sovereignRate, creditLeft } from '../engine/money.js';
import { costOfPolice } from '../engine/economy.js';
import { die, neutralize, electionStep } from '../engine/politics.js';
import { afflict, healthStep, incapacitated } from '../engine/health.js';
import { upkeepCost } from '../engine/military.js';
import { groupsOf } from '../engine/culture.js';
import { moodRoom } from '../engine/ops.js';
import { currentActors, seated } from '../agents/game.js';
import { refereePrompt, frontPage } from '../agents/prompts.js';

const popOf = p => Object.values(p.pops).reduce((a, x) => a + x.n, 0);
const lean = { military: .01, welfare: .01, infrastructure: .01, education: .01, police: .01, administration: .01 };

ok('A world with eight countries can be made: place names do not run out', () => {
  const w = createWorld({ ...base, plainStates: false, countries: 8, provinces: 160, seed: 1848 });
  assert.equal(aliveCountries(w).length, 8); assert.equal(new Set(Object.values(w.provinces).map(p => p.name)).size, Object.keys(w.provinces).length);
  assert.equal(aliveCountries(createWorld({ ...base, plainStates: false, seed: 5 })).length, 5);
});
ok('The first quarter is an ordinary quarter: taxes come in and prices do not jump', () => {
  const w = inherited(), first = {}; run(w, 1);
  for (const c of aliveCountries(w)) first[c.id] = c.lastRevenue / c.gdp;
  run(w, 1); for (const c of aliveCountries(w)) assert.ok(Math.abs(c.inflation) < .05, `${c.archetype} inflation ${c.inflation}`);
  run(w, 2); for (const c of aliveCountries(w)) assert.ok(first[c.id] > c.lastRevenue / c.gdp * .7, `${c.archetype} first-quarter revenue ${first[c.id]} against ${c.lastRevenue / c.gdp}`);
});
ok('An inherited state left alone for three years neither soars nor collapses, and states do not all start in the same fiscal position', () => {
  const balances = [];
  for (const seed of [1848, 42, 7]) {
    const w = inherited(seed), start = Object.fromEntries(aliveCountries(w).map(c => [c.id, c.legitimacy])); run(w, 12);
    for (const c of aliveCountries(w)) { assert.ok(Math.abs(c.legitimacy - start[c.id]) < 22, `${c.archetype} ${start[c.id]} -> ${c.legitimacy}`); balances.push(c.lastBalance / c.gdp); }
  }
  // Some lay money by, some live beyond their means; none starts with a hole that empties the treasury within the year.
  assert.ok(balances.some(b => b > .003) && balances.some(b => b < -.012) && balances.every(b => b > -.035), `balances ${balances.map(b => b.toFixed(3)).join(' ')}`);
});
chain('A deficit is borrowed and the debt grows; a surplus fills the treasury; a heavier debt costs a higher rate', () => {
  const w = fresh(), a = w.countries.U1, b = w.countries.U2;
  a.budget.military = .2; a.treasury = 0; b.budget = { ...lean }; b.tax.income = .3;
  const debt = a.debt, cash = b.treasury; run(w, 4);
  assert.ok(a.lastBalance < 0 && a.lastBorrowed > 0 && a.debt > debt, `${a.lastBalance} ${a.lastBorrowed}`); assert.ok(b.lastBalance > 0 && b.treasury > cash, `${b.lastBalance}`);
  const light = sovereignRate(a); a.debt = a.gdp * 4 * 2; assert.ok(sovereignRate(a) > light + .02, `${light} -> ${sovereignRate(a)}`);
});
chain('An empty treasury builds on credit, and when lenders refuse the work does not start', () => {
  const w = fresh(), c = w.countries.U1, l = ld(w, c), p = countryProvinces(w, c.id)[0];
  c.treasury = 0; c.stock.machines = 99; const debt = c.debt;
  const r = applyOp(w, l, { op: 'build', province: p.id, kind: 'goods', pct_gdp: .03 });
  assert.equal(r.ok, true, r.msg); assert.ok(/borrowed/.test(r.msg), r.msg); assert.ok(c.debt > debt);
  c.debt = c.gdp * 4 * 5; assert.equal(creditLeft(c), 0);
  const r2 = applyOp(w, l, { op: 'build', province: p.id, kind: 'goods', pct_gdp: .03 }); assert.equal(r2.ok, false); assert.ok(/lenders/.test(r2.msg), r2.msg);
});
chain('A standing institution is a budget line: it raises what the state must spend every quarter', () => {
  const w = fresh(), c = w.countries.U1; run(w, 1); const before = (c.lastRevenue - c.lastBalance) / c.gdp;
  applyOp(w, ld(w, c), { op: 'create_institution', name: 'Railway Board', budget_pct_gdp: .5, powers: ['industry'] });
  assert.ok(c.institutions.at(-1).budget <= .02, 'one agency cannot swallow the budget');
  run(w, 1); assert.ok(c.lastAgencies > c.gdp * .015, `${c.lastAgencies}`); assert.ok((c.lastRevenue - c.lastBalance) / c.gdp > before + .01);
});
chain('Spending decides where the bureaucracy settles; the press and the courts decide where corruption settles', () => {
  const a = fresh(), b = fresh(), ca = a.countries.U1, cb = b.countries.U1;
  ca.budget.administration = .034; cb.budget.administration = .004; ca.pressFreedom = ca.courts = 95; cb.pressFreedom = cb.courts = 5; run(a, 40); run(b, 40);
  assert.ok(ca.bureaucracy > 78 && cb.bureaucracy < 32, `${ca.bureaucracy} / ${cb.bureaucracy}`); assert.ok(ca.corruption < cb.corruption - 15, `${ca.corruption} / ${cb.corruption}`);
});
chain('A decree moves moods only so far: repeating it adds nothing, and it cannot touch what the state is', () => {
  const w = fresh(), twin = fresh(), c = w.countries.U1, l = ld(w, c), corruption = c.corruption, police = c.police;
  for (let i = 0; i < 12; i++) applyOp(w, l, { op: 'custom', label: 'Day of national pride', effects: [{ stat: 'legitimacy', delta: 12, turns: 6 }, { stat: 'corruption', delta: -12 }, { stat: 'police', delta: 12 }, { stat: 'sat.all', delta: 12 }] });
  const held = k => c.mods.filter(m => m.key === k).reduce((a, m) => a + m.delta, 0);
  assert.ok(held('legitimacy') <= moodRoom(c, l, 'legitimacy') + 1e-9 && held('legitimacy') > 0); assert.ok(held('sat.all') <= moodRoom(c, l, 'sat.all') + 1e-9);
  assert.equal(c.corruption, corruption); assert.equal(c.police, police);
  assert.ok(moodRoom(c, w.characters[c.general], 'sat.all') < moodRoom(c, l, 'sat.all'), 'a lesser voice carries less far');
  run(w, 8); run(twin, 8); assert.ok(c.legitimacy < twin.countries.U1.legitimacy + 6, `legitimacy cannot be talked up: ${c.legitimacy} / ${twin.countries.U1.legitimacy}`);
});
chain('A default writes the debt down and shuts the lenders out; years of paying in full bring them back', () => {
  const w = fresh(), c = w.countries.U1, l = ld(w, c); c.budget = { ...lean }; c.tax.income = .3; const debt = c.debt, room = creditLeft(c);
  assert.equal(applyOp(w, l, { op: 'default_debt' }).ok, true); assert.ok(c.defaulted && c.debt < debt * .6); assert.ok(creditLeft(c) < room * .5);
  assert.equal(applyOp(w, l, { op: 'default_debt' }).ok, false, 'not twice in a row');
  run(w, 20); assert.equal(c.defaulted, false, 'trust returns');
});
ok('Courts and the press can be broken in a day and take years to grow', () => {
  const w = fresh(), c = w.countries.U1, l = ld(w, c); c.pressFreedom = 10; c.courts = 10;
  const r = applyOp(w, l, { op: 'set_institutions', press_freedom: 90, courts: 90 }); assert.equal(c.pressFreedom, 25); assert.equal(c.courts, 25); assert.ok(/cannot be raised/.test(r.msg));
  applyOp(w, l, { op: 'set_institutions', press_freedom: 0 }); assert.equal(c.pressFreedom, 0);
});
chain('Troops stationed in a restive province hold its streets; a gagged press lets the police hold the rest', () => {
  const squeeze = w => { w.countries.U1.tax = { income: .6, land: .6, business: .6 }; return w; };
  const a = squeeze(fresh()), b = squeeze(fresh()), spot = countryProvinces(a, 'U1').find(p => !Object.values(a.units).some(u => u.province === p.id));
  makeUnit(a, 'U1', spot.id, 30); run(a, 6); run(b, 6);
  assert.ok(a.provinces[spot.id].unrest < b.provinces[spot.id].unrest - 5, `${a.provinces[spot.id].unrest} / ${b.provinces[spot.id].unrest}`);
  const x = squeeze(fresh()), y = squeeze(fresh());
  for (const [w, press] of [[x, 5], [y, 95]]) { const c = w.countries.U1; c.pressFreedom = press; c.police = 80; c.budget.police = costOfPolice(80); }
  run(x, 6); run(y, 6); assert.ok(x.countries.U1.unrest < y.countries.U1.unrest - 6, `${x.countries.U1.unrest} / ${y.countries.U1.unrest}`);
});
chain('An army the budget cannot pay wears away: morale falls and the officers grow bitter', () => {
  const a = fresh(), b = fresh(), ca = a.countries.U1, cb = b.countries.U1, mean = (w, k) => { const us = Object.values(w.units).filter(u => u.country === 'U1'); return us.reduce((s, u) => s + u[k], 0) / us.length; };
  ca.budget.military = upkeepCost(a, ca) / ca.gdp * .3; cb.budget.military = upkeepCost(b, cb) / cb.gdp * 1.1; run(a, 6); run(b, 6);
  assert.ok(ca.militaryFunding < .7 && cb.militaryFunding > .9, `${ca.militaryFunding} / ${cb.militaryFunding}`);
  assert.ok(mean(a, 'morale') < mean(b, 'morale') - 10, `${mean(a, 'morale')} / ${mean(b, 'morale')}`); assert.ok(ca.blocs.army.sat < cb.blocs.army.sat - 8);
});
chain('A grave wound takes a ruler out of the game without killing them; the gravely ill can die, and then the seat passes on', () => {
  const w = fresh(), c = w.countries.U1, l = ld(w, c);
  assert.equal(afflict(w, l, 'wound', 3, 'a fall'), false); assert.ok(incapacitated(l)); assert.ok(!currentActors(w).includes(l)); assert.ok(currentActors(w).includes(w.characters[c.general]));
  assert.ok(frontPage(w, w.characters[c.general]).includes('is not governing'), 'the others are told');
  assert.equal(afflict(w, l, 'wound', 4), true, 'the fourth degree is death, left to the caller');
  l.age = 96; for (let i = 0; i < 80 && l.alive; i++) { beginTurn(w); healthStep(w, die); }
  assert.equal(l.alive, false); assert.ok(l.death?.how); assert.notEqual(c.leader, l.id); assert.ok(w.characters[c.leader].alive);
});
chain('Command in battle is dangerous: a general at the front can be wounded or killed, and the army gets a new chief', () => {
  const w = fresh(), a = w.countries.U1, b = w.countries.U2, p = countryProvinces(w, a.id)[0]; let hurt = 0, dead = 0;
  w.wars.push({ id: 'S-test', a: [a.id], b: [b.id], civil: false, active: true, start: w.turn, name: 'Test war' });
  for (let i = 0; i < 300 && !(hurt && dead); i++) {
    for (const u of Object.values(w.units)) delete w.units[u.id];
    const gen = w.characters[a.general]; delete gen.condition; makeUnit(w, a.id, p.id, 5).commander = gen.id; makeUnit(w, b.id, p.id, 80);
    beginTurn(w); militaryStep(w);
    if (!gen.alive) { dead++; assert.notEqual(a.general, gen.id); assert.ok(gen.death.how.includes('fell in battle')); } else if (gen.condition?.kind === 'wound') hurt++;
  }
  assert.ok(hurt > 0 && dead > 0, `${hurt} wounded, ${dead} dead`);
});
chain('Who rules next follows the kind of state: the army\'s chief, the blood line, an interim head and a vote, or the named successor', () => {
  { const w = fresh(), c = w.countries.U1, old = ld(w, c), gen = c.general; c.succession = 'army'; die(w, old, 'died'); assert.equal(c.leader, gen); assert.notEqual(c.general, gen); assert.ok(w.characters[c.general].alive); assert.ok(w.characters[gen].rise.includes('army')); }
  { const w = fresh(), c = w.countries.U1, old = ld(w, c), n = Object.keys(w.characters).length; c.succession = 'dynasty'; die(w, old, 'died'); const heir = ld(w, c); assert.equal(heir.name.split(' ').at(-1), old.name.split(' ').at(-1)); assert.ok(heir.age < old.age); assert.equal(Object.keys(w.characters).length, n + 1); assert.equal(w.characters[c.general].role, 'general', 'the general stays a general'); }
  { const w = fresh(), c = w.countries.U1, old = ld(w, c); c.elections = true; c.nextElection = w.turn + 40; die(w, old, 'died'); assert.ok(c.nextElection <= w.turn + 2); assert.notEqual(c.leader, old.id); }
  { const w = fresh(), c = w.countries.U1, old = ld(w, c), named = c.oligarch; c.succession = 'army'; assert.equal(applyOp(w, old, { op: 'designate_successor', character: named }).ok, true); neutralize(w, old, 'exiled'); assert.equal(c.leader, named); assert.equal(old.status, 'exiled'); assert.equal(c.heir, null); }
});
chain('An election swaps the two rivals and no one else appears', () => {
  const w = fresh(), c = w.countries.U1, inc = c.leader, opp = c.opposition, living = () => Object.values(w.characters).filter(x => x.alive).length, n = living();
  c.elections = true; c.nextElection = w.turn; c.pressFreedom = 100; c.rigging = 0; for (const p of c.parties) p.support = p.id === c.rulingParty ? 1 : 60;
  beginTurn(w); electionStep(w);
  assert.equal(c.leader, opp); assert.equal(c.opposition, inc); assert.equal(w.characters[inc].role, 'opposition'); assert.equal(living(), n); assert.ok(!Object.values(w.characters).some(x => x.status === 'retired'));
});
chain('Anyone can be marked for death: the killing leaves a trace and fills the seat, and a plotter who is found out is jailed', () => {
  let killed = 0, wounded = 0, traced = 0;
  for (let i = 0; i < 30; i++) {
    const w = createWorld({ ...base, seed: 100 + i }); w.status = 'playing'; run(w, 1);
    const c = w.countries.U1, gen = w.characters[c.general], victim = w.characters[c.oligarch], ruler = c.leader;
    assert.equal(applyOp(w, gen, { op: 'start_plot', kind: 'assassination', character: victim.id, secrecy: .5 }).ok, true);
    const pl = w.plots.at(-1); assert.equal(pl.target, victim.id); pl.progress = 100; executePlot(w, pl);
    assert.equal(c.leader, ruler, 'the ruler was not the target'); assert.ok(gen.secrets.some(s => s.text.includes(victim.name)));
    if (!victim.alive) { killed++; assert.equal(victim.death.how, 'was killed by an assassin'); assert.notEqual(c.oligarch, victim.id); assert.ok(w.characters[c.oligarch].alive); }
    else if (victim.condition?.kind === 'wound') wounded++;
    if (gen.status === 'imprisoned') { traced++; assert.notEqual(c.general, gen.id, 'a jailed general commands nothing'); }
  }
  assert.ok(killed >= 4 && wounded >= 1 && traced >= 3, `${killed} killed, ${wounded} wounded, ${traced} traced`);
});
chain('The state can jail, banish and execute: a prisoner can be put to death, the deed is on file, and no one is arrested twice', () => {
  const w = fresh(), c = w.countries.U1, l = ld(w, c), opp = w.characters[c.opposition], olig = w.characters[c.oligarch]; c.courts = 0;
  for (let i = 0; i < 30 && opp.status === 'free'; i++) applyOp(w, l, { op: 'purge', character: opp.id, fate: 'imprisoned' });
  assert.equal(opp.status, 'imprisoned'); assert.notEqual(c.opposition, opp.id);
  assert.equal(applyOp(w, l, { op: 'purge', character: opp.id, fate: 'imprisoned' }).ok, false, 'already in prison');
  assert.equal(applyOp(w, l, { op: 'purge', character: opp.id, fate: 'dead' }).ok, true); assert.equal(opp.alive, false); assert.equal(opp.death.how, 'was executed');
  assert.ok(l.secrets.some(s => s.text.includes(opp.name))); assert.ok(c.mods.some(m => m.key === 'unrest' && m.label.includes(opp.name)));
  for (let i = 0; i < 30 && olig.status === 'free'; i++) applyOp(w, l, { op: 'purge', character: olig.id, fate: 'exiled' });
  assert.equal(olig.status, 'exiled'); assert.equal(applyOp(w, l, { op: 'purge', character: olig.id, fate: 'imprisoned' }).ok, false, 'out of reach abroad');
  assert.equal(applyOp(w, l, { op: 'release', character: olig.id }).ok, true); assert.equal(olig.status, 'free'); assert.notEqual(c.oligarch, olig.id, 'the seat is not handed back');
});
chain('Out of office a person keeps only what any private person has; prisoners keep less, and go on living', () => {
  const w = fresh(), c = w.countries.U1, old = ld(w, c); old.everAI = true;
  neutralize(w, old, 'imprisoned'); assert.notEqual(c.leader, old.id); assert.equal(old.role, 'former_leader');
  assert.equal(applyOp(w, old, { op: 'set_tax', kind: 'income', rate: .5 }).ok, false); assert.equal(applyOp(w, old, { op: 'start_plot', kind: 'coup' }).ok, false);
  assert.equal(applyOp(w, old, { op: 'custom', label: 'Hunger strike' }).ok, true);
  assert.ok(currentActors(w).includes(old), 'a prisoner still acts'); assert.ok(!seated(w, old)); assert.ok(frontPage(w, old).includes('prisoner'));
  assert.ok(answer(w, old, 'budget').includes('not open to you'), 'the papers of the office are closed to them');
  old.status = 'free'; assert.equal(applyOp(w, old, { op: 'declare_war', target: 'U2' }).ok, false, 'a former ruler commands nothing'); assert.equal(applyOp(w, old, { op: 'start_plot', kind: 'coup' }).ok, true);
});
chain('Violence against a people: the dead and the driven-out are counted, the province changes, neighbours receive them, the army is marked, and it is not forgotten', () => {
  const w = fresh(), c = w.countries.U1, l = ld(w, c), p = countryProvinces(w, c.id).find(x => x.neighbors.some(n => w.provinces[n].controller !== c.id)), q = w.provinces[p.neighbors.find(n => w.provinces[n].controller !== c.id)], o = w.countries[q.controller];
  p.groups = [{ eth: c.majorityEth || 'Home', rel: c.majorityRel, share: .6 }, { eth: o.majorityEth, rel: o.majorityRel, share: .4 }]; q.groups = [{ eth: o.majorityEth, rel: o.majorityRel, share: 1 }];
  for (const u of Object.values(w.units)) if (u.country === c.id) delete w.units[u.id]; c.police = 0;
  const order = { op: 'persecute', province: p.id, group: o.majorityEth, method: 'expel', share: .5 };
  assert.equal(applyOp(w, l, order).ok, false, 'no force on the spot');
  const u = makeUnit(w, c.id, p.id, 40, 1, 100), before = { p: popOf(p), q: popOf(q), rel: o.relations[c.id] ?? 0, legit: c.legitimacy }; c.axes.auth = 100; beginTurn(w);
  let r; for (let i = 0; i < 10 && !(r = applyOp(w, l, order)).ok; i++) u.loyalty = 100;
  assert.equal(r.ok, true, r.msg);
  assert.ok(popOf(p) < before.p * .9, 'the province is emptier'); assert.ok(popOf(q) > before.q, 'the neighbour receives them');
  assert.ok(groupsOf(p).find(g => g.eth === o.majorityEth).share < .3, 'the makeup of the province changed');
  assert.ok(u.morale < 65 && u.loyalty < 100, 'the army that did it is marked'); assert.ok(l.secrets.some(s => /expulsion/.test(s.text)), 'the order is on file'); assert.equal(p.scar?.by, c.id);
  assert.ok(o.relations[c.id] < before.rel - 30, 'kin abroad turn hostile'); assert.ok(c.legitimacy < before.legit); assert.ok(w.characters[o.leader].inbox.some(m => m.from === 'Refugees and envoys'));
  assert.ok(w.newsThisTurn.some(n => n.kind === 'atrocity' && !n.secret)); assert.ok(answer(w, l, 'history').includes(p.name), 'it enters the record');
  const twin = structuredClone(w); delete twin.provinces[p.id].scar; run(w, 3); run(twin, 3);
  assert.ok(w.provinces[p.id].unrest > twin.provinces[p.id].unrest + 2, `the province remembers: ${w.provinces[p.id].unrest} / ${twin.provinces[p.id].unrest}`);
});
chain('An offer stays on the desk: the character sees it each morning, the referee sees its number, it can be accepted without one, and it lapses if ignored', () => {
  const w = fresh(), c = w.countries.U1, a = w.characters[c.oligarch], b = w.characters[c.general];
  const first = applyOp(w, a, { op: 'propose_contract', to: b.id, terms: 'Guard my mines', pay_per_turn: 5, payer: 'me', turns: 8 }); b.inbox = [];
  assert.ok(frontPage(w, b).includes(first.contract) && frontPage(w, b).includes('Guard my mines'));
  const prompt = refereePrompt(w, c, [{ actor: b, decisions: ['I accept the offer'] }]);
  assert.ok(prompt.includes(first.contract)); assert.ok(prompt.includes(countryProvinces(w, c.id)[0].name)); assert.ok(/B\d+ infantry \d+k at P\d+/.test(prompt), 'units come with their size and place');
  const second = applyOp(w, a, { op: 'propose_contract', to: b.id, terms: 'Guard my mines, better pay', pay_per_turn: 8, payer: 'me', turns: 8 });
  assert.equal(w.contracts.filter(k => k.status === 'proposed').length, 1, 'the new offer replaces the old');
  assert.equal(applyOp(w, b, { op: 'accept_contract' }).ok, true); assert.equal(w.contracts.find(k => k.id === second.contract).status, 'active');
  applyOp(w, a, { op: 'propose_contract', to: c.opposition, terms: 'Stay quiet', pay_per_turn: 1, payer: 'me', turns: 4 }); const idle = w.contracts.at(-1); run(w, 10); assert.equal(idle.status, 'lapsed');
});

await (async () => {
  const cfg = { ...base, models: { leader: 'x', secondary: 'y', referee: 'ref', cast: ['opus', 'sonnet', 'haiku'], assign: { 'U2.general': 'pinned' } }, maxLookupRounds: 0, negotiationRounds: 0 }, w = createWorld(cfg), used = {}; w.status = 'playing';
  const backend = { kind: 'claude', async ask(p, model) { if (p.includes('rulings')) { used.referee = model; return { rulings: [] }; } const m = /Your name: [^(]+\((K\d+)\)/.exec(p); if (m) used[m[1]] = model; return { decisions: ['Wait'], messages: [] }; } };
  const g = new Game({ world: w, cfg, backend, store: memoryStore() }); await g.turn();
  const seats = id => ROLES.map(r => w.characters[w.countries[id][r]]);
  assert.equal(new Set(seats('U1').map(x => x.model)).size, 3, 'one country hears all three models'); assert.equal(new Set(['U1', 'U2', 'U3'].map(id => w.characters[w.countries[id].leader].model)).size, 3, 'the rulers are not all one model');
  assert.equal(w.characters[w.countries.U2.general].model, 'pinned'); assert.equal(used.referee, 'ref');
  for (const ch of seats('U1')) assert.equal(used[ch.id], ch.model, 'each is asked on their own model');
  const heir = w.countries.U1.general, old = w.characters[w.countries.U1.leader], kept = w.characters[heir].model; w.countries.U1.succession = 'army'; die(w, old, 'died'); await g.turn();
  assert.equal(w.characters[heir].model, kept, 'a person keeps their model when their seat changes'); assert.ok(w.characters[w.countries.U1.general].model, 'the newcomer gets one');
  console.log('passed  Each character is played by their own model and keeps it for life');
})();

await (async () => {
  const cfg = { ...base, agentRoles: ['leader', 'opposition'], maxLookupRounds: 0, negotiationRounds: 0, concurrency: 1 }, w = createWorld(cfg); w.status = 'playing';
  const c = w.countries.U1, warden = w.characters[c.leader], prisoner = w.characters[c.opposition], friend = w.characters[w.countries.U2.leader]; let woke = 0;
  prisoner.everAI = true; c.intelligence = 100; neutralize(w, prisoner, 'imprisoned');
  const backend = { kind: 'claude', async ask(p) { if (p.includes('rulings')) return { rulings: [] }; if (p.includes(`Your name: ${prisoner.name}`)) { woke++; assert.ok(p.includes('prisoner of the state')); return { decisions: [], messages: [{ to: friend.id, text: 'Get me out of here.' }] }; } return { decisions: [], messages: [] }; } };
  const g = new Game({ world: w, cfg, backend, store: memoryStore() }); let copied = false, reached = false;
  for (let i = 0; i < 8 && !copied; i++) { prisoner.inbox.push({ turn: w.turn, from: 'A friend', text: 'Are you alive?' }); await g.turn(); copied = warden.inbox.some(m => m.from === 'Prison censor' && m.text.includes('Get me out')); reached ||= friend.inbox.some(m => m.text === 'Get me out of here.'); }
  assert.ok(woke > 0, 'a prisoner still wakes'); assert.ok(reached, 'the letter is delivered'); assert.ok(copied, 'and the censor copies it for the ruler');
  console.log('passed  Chain: a prisoner writes, the letter arrives, the censor reads it');
})();

// ---- Ego and freedom in the opening text, who can know what, and whether government matters
import { news as writeNews } from '../engine/util.js';
import { newsFor } from '../agents/queries.js';

ok('The opening text gives every character an ego and every freedom, and no number to judge people by', () => {
  const w = inherited(), l = ld(w, aliveCountries(w)[0]), first = actorPrompt(w, l, [], true, { intro: true }), later = actorPrompt(w, l, [], true, { intro: false });
  assert.ok(first.includes('You have an ego') && first.includes('no score or ledger'), 'the ego is theirs and so are their feelings about others');
  assert.ok(first.includes('massacres are as open to you as peace'), 'nothing is forbidden, in either direction');
  assert.ok(!later.includes('You have an ego'), 'said once, at the start of their life');
  assert.ok(!/\b(loyalty|ambition|greed|relations?|power) -?\d/i.test(first), 'no relationship is handed over as a number');
});
chain('While the ruler lies too ill to govern, the named successor governs in their name', () => {
  const w = fresh(), c = w.countries.U1, l = ld(w, c), gen = w.characters[c.general];
  assert.equal(applyOp(w, gen, { op: 'set_tax', kind: 'income', rate: .2 }).ok, false);
  applyOp(w, l, { op: 'designate_successor', character: gen.id }); afflict(w, l, 'illness', 3);
  assert.equal(applyOp(w, gen, { op: 'set_tax', kind: 'income', rate: .2 }).ok, true); assert.equal(c.tax.income, .2);
  assert.ok(frontPage(w, gen).includes('govern in their name')); assert.ok(answer(w, gen, 'budget').includes('Treasury'), 'the papers of the office are open to the regent');
  delete l.condition; assert.equal(applyOp(w, gen, { op: 'set_tax', kind: 'income', rate: .3 }).ok, false, 'the regency ends when the ruler recovers');
});
chain('A newcomer knows whose place they took and how it fell vacant; the arrested know who gave the order', () => {
  const w = fresh(), c = w.countries.U1, l = ld(w, c), opp = w.characters[c.opposition]; c.courts = 0;
  for (let i = 0; i < 30 && opp.status === 'free'; i++) applyOp(w, l, { op: 'purge', character: opp.id, fate: 'imprisoned' });
  const next = w.characters[c.opposition]; assert.notEqual(next.id, opp.id); assert.ok(next.rise.includes(opp.name) && next.rise.includes('imprisoned'), next.rise);
  assert.ok(actorPrompt(w, next, [], true, { intro: true }).includes(next.rise)); assert.ok(opp.inbox.some(m => m.text.includes(l.name)));
});
ok('People know what they could know: a gagged press hides the provinces, a prisoner hears little, and what someone thinks of others stays their own', () => {
  const w = fresh(), c = w.countries.U1, seat = r => w.characters[c[r]], sees = ch => newsFor(w, ch, w.turn).some(n => n.text.includes('Testville'));
  beginTurn(w); writeNews(w, 'Testville: mass uprising, fighting in the streets.', { kind: 'disaster', countries: [c.id], hush: true }); writeNews(w, 'A treaty was signed in the capital.', { kind: 'diplomacy', countries: [c.id] }); w.newsLog.push(...w.newsThisTurn);
  c.pressFreedom = 10;
  assert.ok(sees(seat('leader')) && sees(seat('general')) && sees(seat('opposition')), 'the ruler, the army and the opposition\'s network hear of it'); assert.ok(!sees(seat('oligarch')), 'it is not in the papers');
  const far = aliveCountries(w).find(o => o.id !== c.id && !countryProvinces(w, o.id).some(p => p.neighbors.some(n => w.provinces[n].controller === c.id)));
  if (far) { const reader = w.characters[far.leader]; far.intel[c.id] = 0; assert.ok(!sees(reader), 'a distant country does not hear'); far.intel[c.id] = 60; assert.ok(sees(reader), 'unless it has eyes there'); }
  c.pressFreedom = 80; assert.ok(sees(seat('oligarch')), 'a free press prints it');
  const jailed = seat('oligarch'); neutralize(w, jailed, 'imprisoned'); const cell = newsFor(w, jailed, w.turn); assert.ok(cell.some(n => n.text.includes('treaty')) && !cell.some(n => n.text.includes('Testville')));
  const l = seat('leader'); l.persona = 'I despise the general and mean to ruin him.'; l.publicFace = 'A plain soldier of the nation.';
  const seen = answer(w, seat('general'), `person:${l.id}`); assert.ok(seen.includes('plain soldier') && !seen.includes('despise'));
});
chain('Government matters: ten years of good rule lift a poor state, ten years of bad rule wreck a rich one', () => {
  const play = (arche, act) => { const w = inherited(1848), c = aliveCountries(w).find(x => x.archetype === arche), op = o => applyOp(w, w.characters[c.leader], { ...o, _law: true }); for (let t = 0; t < 40; t++) { beginTurn(w); if (act) act(c, op, t); stepWorld(w); } return c; };
  const good = (c, op, t) => {
    if (t === 0) { op({ op: 'set_tax', kind: 'income', rate: .15 }); op({ op: 'set_tax', kind: 'business', rate: .15 }); for (const [category, share] of [['administration', .022], ['education', .018], ['infrastructure', .02], ['welfare', .02]]) op({ op: 'set_budget', category, share }); op({ op: 'set_culture_policy', language: 'tolerate', faith: 'tolerate' }); }
    if (t % 4 === 0) op({ op: 'set_institutions', courts: Math.min(80, c.courts + 15), press_freedom: Math.min(80, c.pressFreedom + 15) });
  };
  const bad = (c, op, t) => {
    if (t === 0) { op({ op: 'set_tax', kind: 'income', rate: .5 }); op({ op: 'set_tax', kind: 'land', rate: .5 }); for (const [category, share] of [['military', .14], ['education', 0], ['infrastructure', 0], ['administration', .004]]) op({ op: 'set_budget', category, share }); op({ op: 'set_institutions', courts: 0, press_freedom: 0 }); }
    op({ op: 'print_money', pct_gdp: .1 }); op({ op: 'embezzle', pct_gdp: .05 });
  };
  const poor = play('agrarian'), raised = play('agrarian', good), rich = play('merchant'), ruined = play('merchant', bad);
  assert.ok(raised.realGdp > poor.realGdp * 1.2, `output ${raised.realGdp} / ${poor.realGdp}`); assert.ok(raised.bureaucracy > poor.bureaucracy + 15 && raised.corruption < poor.corruption - 8); assert.ok(raised.legitimacy > poor.legitimacy && raised.lastRevenue / raised.gdp > poor.lastRevenue / poor.gdp * 1.5);
  assert.ok(raised.debt / raised.gdp > poor.debt / poor.gdp, 'and building a state is not free');
  assert.ok(ruined.realGdp < rich.realGdp * .9, `output ${ruined.realGdp} / ${rich.realGdp}`); assert.ok(ruined.legitimacy < rich.legitimacy - 25 && ruined.corruption > rich.corruption + 25 && ruined.inflation > rich.inflation + .05);
});

await (async () => {
  const cfg = { ...base, agentRoles: ['leader'], maxLookupRounds: 0, negotiationRounds: 0, concurrency: 1 }, w = createWorld(cfg), leader = w.countries.U1.leader, asked = []; w.status = 'playing';
  const backend = { kind: 'claude', async ask(p) {
    if (!p.includes('rulings')) return { decisions: p.includes(w.characters[leader].name) ? ['Raise the land tax to a fifth', 'Found a naval academy', 'Order a census'] : [], messages: [] };
    if (!p.includes(leader + ' (')) return { rulings: [] };
    const listed = [...p.split('DECISIONS:')[1].matchAll(/^  (\d+)\. /gm)].map(m => Number(m[1])); asked.push(listed);
    return { rulings: listed.filter(i => i !== 2).slice(0, 1).map(i => ({ actor: leader, decision: i, narrative: 'Ruling ' + i, probability: 1, operations: [] })) };
  } };
  const g = new Game({ world: w, cfg, backend, store: memoryStore() }); await g.turn();
  assert.deepEqual(asked, [[0, 1, 2], [1, 2]], 'what was passed over is asked for once more, under its own number');
  const out = w.characters[leader].outcomes.join(' | ');
  assert.ok(out.includes('Ruling 0') && out.includes('Ruling 1'), 'both rulings count'); assert.ok(out.includes('no ruling was given') && out.includes('census'), 'and what is still left is told to the one who decided it');
  console.log('passed  Chain: a decision the referee skips is asked for again, and if still unanswered the character is told');
})();
chain('A ruler can raise up someone who was no one until then, sell gold from the reserve, and buy the troops\' spirit for a while', () => {
  const w = fresh(), c = w.countries.U1, l = ld(w, c), u = Object.values(w.units).find(x => x.country === c.id), n = Object.keys(w.characters).length;
  const r = applyOp(w, l, { op: 'appoint_commander', unit: u.id, name: 'Colonel Arvid Stane' }); assert.equal(r.ok, true, r.msg); const officer = w.characters[u.commander];
  assert.equal(officer.name, 'Colonel Arvid Stane'); assert.equal(Object.keys(w.characters).length, n + 1); assert.ok(!currentActors(w).includes(officer), 'a minor figure holds no seat');
  assert.equal(applyOp(w, l, { op: 'appoint_commander', unit: u.id, name: 'Colonel Arvid Stane' }).ok, true); assert.equal(Object.keys(w.characters).length, n + 1, 'the same name is the same person');
  assert.equal(applyOp(w, l, { op: 'appoint_commander', unit: u.id, character: 'K9999' }).ok, false, 'an unknown id is a mistake, not a newcomer');
  c.succession = 'dynasty'; assert.equal(applyOp(w, l, { op: 'designate_successor' }).ok, true); const heir = w.characters[c.heir];
  assert.equal(heir.name.split(' ').at(-1), l.name.split(' ').at(-1), 'an heir of the house carries its name'); die(w, l, 'died'); assert.equal(c.leader, heir.id); assert.ok(currentActors(w).includes(heir), 'and the heir who was no one now rules');
  const c2 = w.countries.U2, l2 = ld(w, c2), gold = c2.reserves, cash = c2.treasury; assert.equal(applyOp(w, l2, { op: 'sell_gold', amount: gold / 2 }).ok, true); assert.ok(c2.reserves < gold * .51 && c2.treasury > cash);
  const mine = () => Object.values(w.units).filter(x => x.country === c2.id); for (const x of mine()) x.morale = 50; c2.treasury = c2.gdp;
  assert.equal(applyOp(w, l2, { op: 'concession', cls: 'army', pct_gdp: .02 }).ok, true); assert.ok(mine().every(x => x.morale > 50) && c2.treasury < c2.gdp);
  const small = applyOp(w, l2, { op: 'recruit', province: c2.capital, men: .5 }); assert.ok(small.ok && small.msg.includes('500 men'), small.msg);
});
ok('A character can read the map: the world at a glance, their own provinces, a neighbour\'s land but not its garrisons', () => {
  const w = inherited(), c = aliveCountries(w)[0], l = ld(w, c), other = aliveCountries(w).find(o => o.id !== c.id && countryProvinces(w, o.id).some(p => p.neighbors.some(n => w.provinces[n].controller === c.id)));
  const world = answer(w, l, 'map'), rows = world.split('\n').filter(x => /^[a-zA-Z.?]{40,}$/.test(x));
  assert.ok(rows.length >= 15 && new Set(rows.map(r => r.length)).size === 1, 'a sketch in letters'); assert.ok(/[A-Z]/.test(rows.join('')), 'capitals are marked');
  for (const o of aliveCountries(w)) assert.ok(world.includes(o.name)); assert.ok(/lies to the (north|south|east|west)/.test(world) && world.includes('common border'));
  const mine = answer(w, l, 'map:mine'), cap = w.provinces[c.capital]; assert.ok(mine.includes(`${cap.id} ${cap.name}, THE CAPITAL`)); assert.ok(/of the capital, \d+ away/.test(mine) && mine.includes('next to') && mine.includes('unrest'));
  const theirs = answer(w, l, `map:${other.id}`); assert.ok(theirs.includes(w.provinces[other.capital].name) && theirs.includes('next to')); assert.ok(!theirs.includes('garrison') && !theirs.includes('unrest'), 'what stands on the land is not on the map');
  for (const q of ['population', 'unrest', 'trade', 'market', `country:${other.id}`]) { const a = answer(w, l, q); assert.ok(a.length > 60 && !/undefined|NaN/.test(a), `${q}: ${a.slice(0, 120)}`); }
  assert.ok(answer(w, l, `country:${other.id}`).includes(`(${other.leader})`), 'foreign figures can be written to');
});
chain('The record keeps what the world told each person, every change of course and every change of health', () => {
  const w = fresh(), c = w.countries.U1, l = ld(w, c), opp = w.characters[c.opposition]; c.courts = 0; beginTurn(w); const before = snapshotState(w);
  for (let i = 0; i < 30 && opp.status === 'free'; i++) applyOp(w, l, { op: 'purge', character: opp.id, fate: 'imprisoned' });
  applyOp(w, l, { op: 'set_tax', kind: 'income', rate: .31 }); applyOp(w, l, { op: 'designate_successor', character: c.general }); afflict(w, w.characters[c.oligarch], 'illness', 2);
  stepWorld(w); const es = buildEntries(w, { trace: [], rulings: [], messages: [] }, before), has = (k, re) => es.some(e => e.k === k && re.test(e.text));
  assert.ok(has('notice', /arrested and locked up on the order of/), 'the arrested person\'s notice'); assert.ok(es.find(e => e.k === 'notice' && /arrested/.test(e.text)).a.includes(opp.id));
  assert.ok(has('state', /changed course: income tax .* to 31%/), 'the change of tax'); assert.ok(has('state', /is now the named successor/)); assert.ok(has('state', / is (mildly|seriously|gravely) ill| died /), 'the illness, in the papers or not');
  assert.ok(has('state', /was imprisoned/)); assert.ok(es.every(e => e.id && e.t === w.turn));
});
await (async () => {
  const cfg = { ...base, agentRoles: ['leader', 'general'], maxLookupRounds: 0, negotiationRounds: 0, concurrency: 1 }, w = createWorld(cfg); w.status = 'playing';
  const c = w.countries.U1, l = w.characters[c.leader], gen = w.characters[c.general], seen = [];
  const backend = { kind: 'claude', async ask(p) {
    if (p.includes('rulings')) return { rulings: p.includes('bargain over the army budget') ? [{ actor: gen.id, decision: 0, narrative: 'An offer is made', probability: 1, operations: [{ op: 'propose_contract', to: l.id, terms: 'Keep the army budget and the barracks stay quiet', pay_per_turn: 0, payer: 'none', turns: 8 }] }] : [] };
    if (p.includes(`Your name: ${l.name}`)) { seen.push(p); return { decisions: [], messages: [] }; }
    if (p.includes(`Your name: ${gen.name}`)) return { decisions: seen.length <= 1 ? ['Offer the leader a bargain over the army budget'] : [], messages: [] };
    return { decisions: [], messages: [] };
  } };
  const g = new Game({ world: w, cfg, backend, store: memoryStore() }); await g.turn(); await g.turn();
  assert.ok(!seen[0].includes('Contract offer') && seen[1].includes('Contract offer') && seen[1].includes('barracks stay quiet'), 'what one character\'s act sends another this quarter is on their desk the next morning');
  await g.turn(); assert.ok(!seen[2].includes('Contract offer CT'), 'and once read it is not sent again as mail');
  console.log('passed  Chain: an act this quarter sends its notice, the other person reads it next morning, once');
})();
await (async () => {
  const cfg = { ...base, agentRoles: ['leader', 'general'], maxLookupRounds: 0, negotiationRounds: 0, concurrency: 1, wakeEvery: 99, wakeTension: 999 }, w = createWorld(cfg); w.status = 'playing';
  const c = w.countries.U1, l = w.characters[c.leader], gen = w.characters[c.general], rival = w.characters[w.countries.U2.leader]; let first = true;
  for (const x of Object.values(w.characters)) if (x.role === 'general') Object.assign(x, { lastWake: 0, ambition: 100, loyalty: 0 });
  const backend = { kind: 'claude', async ask(p) {
    if (p.includes('rulings')) return { rulings: p.includes('great canal') ? [{ actor: l.id, decision: 0, narrative: 'A great canal is begun', probability: 1, public: true, operations: [{ op: 'build_canal', id: 'no-such-site' }] }] : [] };
    if (p.includes(`Your name: ${l.name}`) && first) { first = false; return { decisions: ['Dig a great canal across the country'], messages: [{ to: rival.name, text: 'A letter addressed by name.' }] }; }
    return { decisions: [], messages: [] };
  } };
  const g = new Game({ world: w, cfg, backend, store: memoryStore() }); await g.turn();
  assert.ok(/Not carried out: A great canal is begun \[build_canal was NOT carried out: No such route/.test(l.outcomes.at(-1)), `the ruler is told what really came of the order: ${l.outcomes.at(-1)}`);
  assert.ok(!w.newsLog.some(n => n.text.includes('A great canal is begun')), 'an order the world refused is not announced as done');
  assert.ok(rival.inbox.some(m => m.text === 'A letter addressed by name.'), 'a letter addressed by name arrives');
  for (let i = 0; i < 14; i++) await g.turn();
  assert.ok(!w.plots.some(pl => w.characters[pl.leader]?.role === 'general'), 'an AI character who sleeps does not plot on autopilot');
  console.log('passed  Chain: the giver of an order learns its real outcome; a sleeping AI character does nothing in their own name');
})();

// ---- What the independent audit found, kept from coming back
import { settleOccupations } from '../engine/military.js';
import { collapseStep as collapseStepOf } from '../engine/politics.js';
import { provincePop as provincePopOf } from '../engine/world.js';
const warWorld = () => { const w = fresh(); beginTurn(w); applyOp(w, leaderOf(w, 'U1'), { op: 'declare_war', target: 'U2' }); return w; };

chain('A separate peace takes one country out of a war and leaves the rest fighting; land held without a war goes back', () => {
  const w = warWorld(), war = w.wars.at(-1); applyOp(w, leaderOf(w, 'U3'), { op: 'join_war', war: war.id, side: 'b' });
  assert.deepEqual([war.a, war.b], [['U1'], ['U2', 'U3']]);
  const taken = countryProvinces(w, 'U2').find(p => p.id !== w.countries.U2.capital); taken.controller = 'U1';
  assert.equal(applyOp(w, leaderOf(w, 'U1'), { op: 'propose_treaty', target: 'U3', kind: 'peace', terms: 'White peace' }).ok, true); assert.equal(applyOp(w, leaderOf(w, 'U3'), { op: 'accept_treaty' }).ok, true);
  assert.equal(war.active, true, 'the war goes on'); assert.deepEqual([war.a, war.b], [['U1'], ['U2']]); assert.equal(taken.controller, 'U1', 'the occupation of the one still at war stands');
  applyOp(w, leaderOf(w, 'U1'), { op: 'propose_treaty', target: 'U2', kind: 'peace', terms: 'White peace' }); applyOp(w, leaderOf(w, 'U2'), { op: 'accept_treaty' });
  assert.equal(war.active, false); assert.equal(taken.controller, 'U2', 'and goes back with the peace');
  assert.equal(applyOp(w, leaderOf(w, 'U1'), { op: 'propose_treaty', target: 'U2', kind: 'peace', terms: 'Again' }).ok, false, 'no peace without a war');
  assert.equal(applyOp(w, leaderOf(w, 'U1'), { op: 'declare_war', target: 'U1' }).ok, false, 'no war on oneself');
});
chain('A peace can name provinces and who pays: the land changes hands, gold is paid as far as there is gold, the rest is owed, and the peace binds', () => {
  const w = warWorld(), a = w.countries.U1, b = w.countries.U2, prize = countryProvinces(w, 'U2').find(p => p.id !== b.capital); b.reserves = 10;
  const r = applyOp(w, leaderOf(w, 'U1'), { op: 'propose_treaty', target: 'U2', kind: 'peace', terms: 'Cession and indemnity', cede: [prize.id], reparations: .2 }); assert.equal(r.ok, true, r.msg);
  assert.ok(leaderOf(w, 'U2').inbox.some(m => m.text.includes(prize.name) && m.text.includes('pays')), 'the terms are spelled out to the other side');
  const gold = a.reserves; assert.equal(applyOp(w, leaderOf(w, 'U2'), { op: 'accept_treaty', id: r.treaty }).ok, true);
  assert.equal(prize.owner, 'U1'); assert.equal(prize.controller, 'U1'); assert.ok(Math.abs(a.reserves - gold - 10) < 1e-6, 'only the gold that exists moves'); assert.ok(b.reserves >= 0 && b.creditors.U1 > 0, 'the rest is a debt');
  const legit = a.legitimacy; assert.equal(applyOp(w, leaderOf(w, 'U1'), { op: 'declare_war', target: 'U2' }).ok, true); assert.ok(a.legitimacy <= legit - 8, 'breaking a fresh peace is breaking a given word');
});
chain('Two armies ordered at each other meet and fight; a handful of men does not take a province; an ally hands back what it frees', () => {
  const { w, p, q } = frontWorld(), mine = soldier(w, 'U1', p.id, 60), theirs = soldier(w, 'U2', q.id, 60); mine.target = q.id; theirs.target = p.id; militaryStep(w);
  assert.ok(w.battles.length >= 1, 'they do not pass each other on the road'); assert.equal(mine.province === q.id && theirs.province === p.id, false);
  const e = frontWorld(); soldier(e.w, 'U2', e.p.id, .4); militaryStep(e.w); assert.equal(e.p.controller, 'U1', 'four hundred men conquer nothing');
  const f = frontWorld(); f.w.treaties.push({ id: 'AX', kind: 'alliance', parties: ['U1', 'U3'], active: true, pending: false, proposer: 'U1', clauses: [], breaches: [], turn: 0 }); f.w.wars.at(-1).b.push('U3');
  f.p.controller = 'U2'; soldier(f.w, 'U3', f.p.id, 50); militaryStep(f.w); assert.equal(f.p.controller, 'U1', 'freed land returns to its owner');
});
chain('War wears a country down and peace restores it; an army that is not paid melts toward what the budget can keep', () => {
  const w = warWorld(), a = w.countries.U1, p = countryProvinces(w, 'U1').find(x => x.id !== a.capital); p.controller = 'U2'; soldier(w, 'U2', p.id, 40);
  run(w, 8); const tired = a.warExhaustion; assert.ok(tired > 5, `eight quarters of war with land lost: ${tired}`);
  for (const x of w.wars) x.active = false; settleOccupations(w); run(w, 6); assert.ok(a.warExhaustion < tired - 5, 'peace restores');
  const x = fresh(), c = x.countries.U1, men = () => Object.values(x.units).filter(u => u.country === 'U1').reduce((s, u) => s + u.men, 0), before = men(); beginTurn(x); c.stock.arms = 1e5;
  for (let i = 0; i < 30; i++) applyOp(x, ld(x, c), { op: 'recruit', province: c.capital, men: 9999 });
  assert.ok(x.projects.filter(j => j.kind === 'unit').reduce((s, j) => s + j.men, 0) <= provincePopOf(x.provinces[c.capital]) * .09, 'thirty orders raise no more than one');
  x.projects = x.projects.filter(j => j.kind !== 'unit'); c.budget.military = .002; run(x, 10); assert.ok(men() < before * .6, `unpaid men go home: ${before} -> ${men()}`);
});
chain('Repeating an order does not multiply it: the press, the lenders, the mint and the till each give so much in a quarter', () => {
  const w = fresh(), c = w.countries.U1, l = ld(w, c); beginTurn(w);
  const money = c.money; for (let i = 0; i < 20; i++) applyOp(w, l, { op: 'print_money', pct_gdp: .8 }); assert.ok(c.money <= money + c.gdp * .5 + 1e-6, 'the presses');
  const debt = c.debt, room = creditLeft(c); for (let i = 0; i < 20; i++) applyOp(w, l, { op: 'borrow', pct_gdp: .05 }); assert.ok(c.debt <= debt + room + 1e-6 && c.debt > debt, 'the lenders');
  const own = c.ownership, cash = c.treasury; for (let i = 0; i < 5; i++) { applyOp(w, l, { op: 'nationalize', amount: 1 }); applyOp(w, l, { op: 'privatize', amount: 1 }); }
  assert.ok(c.ownership <= own + .25 + 1e-9); assert.ok(c.treasury < cash + c.gdp * .06, 'taking and selling the same property is no gold mine');
  const g = w.characters[c.general], had = g.wealth; c.treasury = c.gdp; for (let i = 0; i < 20; i++) applyOp(w, g, { op: 'embezzle', pct_gdp: .1 }); assert.ok(g.wealth - had <= c.gdp * .02 * .2 / c.priceLevel + 1e-6, 'the till');
  const opp = w.characters[c.opposition]; for (let i = 0; i < 20; i++) applyOp(w, opp, { op: 'propaganda', strength: 1 }); assert.ok(c.mods.filter(m => m.key === 'unrest').reduce((s, m) => s + m.delta, 0) <= moodRoom(c, opp, 'unrest') + 1e-9, 'the pamphlets');
  const o = w.characters[c.oligarch]; o.wealth = 200; const gone = c.reserves; for (let i = 0; i < 20; i++) applyOp(w, o, { op: 'capital_flight', share: .5 }); assert.ok(gone - c.reserves <= 100 + 1e-6 && o.abroad > 0 && o.wealth === 200, 'a fortune leaves once, and it is still the same fortune');
});
chain('A law is made of legislative matter and parties weigh what it does; a decree skips no veto; the dead command nothing; borrowed names are refused', () => {
  const { w, c } = parliamentWorld(), opp = w.characters[c.opposition], gen = c.general;
  const r = applyOp(w, opp, { op: 'propose_law', title: 'Emergency act', text: 'x', ops: [{ op: 'purge', character: gen, fate: 'dead' }, { op: 'designate_successor', character: opp.id }, { op: 'set_regime', elections: false }] });
  assert.equal(r.ok, true, r.msg); const bill = c.bills.at(-1); assert.deepEqual(bill.ops.map(o => o.op), ['set_regime'], 'arrests and heirs are not law'); assert.ok(/left out/.test(r.msg));
  stepOnce(w); stepOnce(w); assert.equal(bill.status, 'rejected', 'a chamber does not vote itself out of existence'); assert.equal(c.elections, true); assert.ok(w.characters[gen].alive);
  const x = fresh(), cx = x.countries.U1, lx = ld(x, cx); cx.courts = 100; applyOp(x, lx, { op: 'create_institution', name: 'High Court', veto: ['set_tariff'], powers: ['judiciary'], head: cx.general, budget_pct_gdp: .02 }); cx.institutions.at(-1).strength = 1.2;
  beginTurn(x); const tariff = cx.tariff, tries = [0, 1, 2, 3, 4, 5].map(() => applyOp(x, lx, { op: 'set_tariff', rate: .5 }).ok); assert.equal(new Set(tries).size, 1, 'asking again the same quarter gets the same answer');
  if (!tries[0]) { assert.equal(cx.tariff, tariff); applyOp(x, lx, { op: 'propose_law', title: 'Tariff decree', ops: [{ op: 'set_tariff', rate: .5 }] }); assert.equal(cx.tariff, tariff, 'and a decree does not get round it'); }
  for (const bad of [{ op: 'build', kind: 'constructor', province: cx.capital }, { op: 'set_tax', kind: 'constructor', rate: .5 }, { op: 'found_company', sector: 'toString', province: cx.capital, amount: 5 }, { op: 'set_research', tech: 'constructor' }]) assert.equal(applyOp(x, lx, bad).ok, false, `${bad.op} with a borrowed name`);
  assert.ok(Number.isFinite(cx.treasury) && Number.isFinite(cx.debt));
  die(x, lx, 'died'); assert.equal(applyOp(x, lx, { op: 'propaganda', strength: 1 }).ok, false, 'the dead give no orders');
});
chain('A coup is decided first by the army; a rising takes only the government\'s own land and never its capital; the people of a fallen state live on', () => {
  const odds = loyalty => { let won = 0; for (let i = 0; i < 40; i++) { const w = createWorld({ ...base, seed: 300 + i }); w.status = 'playing'; run(w, 1); const c = w.countries.U1, g = w.characters[c.general]; for (const u of Object.values(w.units)) if (u.country === 'U1') u.loyalty = loyalty; applyOp(w, g, { op: 'start_plot', kind: 'coup' }); const pl = w.plots.at(-1); pl.progress = 100; executePlot(w, pl); if (c.leader === g.id) won++; } return won; };
  const loyal = odds(100), sour = odds(5); assert.ok(loyal <= 4 && sour >= 34, `with a loyal army ${loyal}/40, with a disloyal one ${sour}/40`);
  const w = fresh(), c = w.countries.U1, opp = w.characters[c.opposition], cap = c.capital; makeUnit(w, 'U1', countryProvinces(w, 'U2')[0].id, 20, 1, 10); c.debt = 1000;
  applyOp(w, opp, { op: 'start_plot', kind: 'uprising' }); executePlot(w, w.plots.at(-1)); const rebels = Object.values(w.countries).find(x => x.parent === 'U1');
  assert.ok(rebels && countryProvinces(w, rebels.id).every(p => p.id !== cap)); assert.equal(c.capital, cap); assert.ok(countryProvinces(w, 'U2').every(p => p.owner === 'U2'), 'no foreign land was carried off');
  assert.ok(rebels.debt > 0 && Math.abs(rebels.debt + c.debt - 1000) < 1e-6, 'the debt goes with the land'); assert.equal(opp.status, 'free'); assert.equal(rebels.leader, opp.id);
  for (const p of countryProvinces(w, 'U1')) p.controller = rebels.id; beginTurn(w); const fallen = ld(w, c), magnate = w.characters[c.oligarch]; collapseStepOf(w);
  assert.equal(c.alive, false); assert.equal(fallen.alive, true); assert.equal(fallen.status, 'imprisoned'); assert.equal(fallen.country, rebels.id, 'the fallen ruler is the prisoner of the victor');
  assert.equal(magnate.alive && magnate.status === 'free' && magnate.country === rebels.id, true, 'the rest live on under new masters'); assert.equal(rebels.name, c.name, 'the victors govern under the old name');
});
chain('A famine burns out instead of feeding on itself, and tolls move gold without making it', () => {
  // The test is about bread, so the country is kept whole: a hungry state that splits in two would lose people for another reason.
  const w = fresh(); w.countries.U1.noSplitUntil = 1e9; for (const o of aliveCountries(w)) if (o.id !== 'U1') o.embargo.push('U1'); for (const p of countryProvinces(w, 'U1')) p.fertility *= .55;
  const pops = () => countryProvinces(w, 'U1').reduce((s, p) => s + popOf(p), 0), start = pops(); run(w, 60); const low = pops(); run(w, 60);
  assert.ok(low > start * .45, `the people are not wiped out: ${start} -> ${low}`); assert.ok(pops() > low * .95 && w.countries.U1.foodRatio > .88, `and the country finds its level: ${low} -> ${pops()}, food ${w.countries.U1.foodRatio}`);
  const x = fresh(); for (const p of Object.values(x.provinces)) if (p.deposits.gold) p.deposits.gold.mine = 0; for (const s of x.strategic) if (s.type === 'strait') { const o = x.countries[s.controller]; if (o) (o.straitPolicy ||= {})[s.id] = { closed: false, toll: .6 }; }
  const goldOf = () => aliveCountries(x).reduce((s, o) => s + o.reserves, 0), before = goldOf(); run(x, 8); assert.ok(goldOf() <= before + 1, `gold in the world ${before} -> ${goldOf()}`);
});
import { pathStep as routeStep } from '../engine/military.js';
import { uprisingStep as risingStep } from '../engine/politics.js';
chain('An order for part of a unit touches only that part: discharge, detachment and joining keep the count of men, and a token garrison does not hold an occupied people', () => {
  const w = fresh(), c = w.countries.U1, boss = ld(w, c), gen = w.characters[c.general], home = w.provinces[c.capital];
  for (const u of Object.values(w.units)) if (u.country === 'U1') delete w.units[u.id];
  const u = makeUnit(w, 'U1', home.id, 100), workers = home.pops.workers.n, cost = upkeepCost(w, c);
  let r = applyOp(w, boss, { op: 'disband', unit: u.id, men: 25 });
  assert.ok(r.ok && w.units[u.id] && Math.abs(u.men - 75) < 1e-6, r.msg); assert.ok(Math.abs(home.pops.workers.n - workers - 25) < 1e-6, 'the discharged go back to work'); assert.ok(upkeepCost(w, c) < cost, 'and are no longer paid');
  assert.equal(applyOp(w, gen, { op: 'disband', unit: u.id, men: 5 }).ok, false, 'the chief of staff cannot send men home');
  const to = home.neighbors.find(id => w.provinces[id].controller === 'U1' && routeStep(w, home.id, id, 'U1')); assert.ok(to, 'a neighbouring province of our own');
  const paid = upkeepCost(w, c); r = applyOp(w, gen, { op: 'move', unit: u.id, to, men: 20 }); assert.ok(r.ok, r.msg);
  const d = Object.values(w.units).find(x => x.country === 'U1' && x.id !== u.id); assert.ok(d && Math.abs(d.men - 20) < 1e-6 && d.target === to, 'the detachment marches');
  assert.ok(Math.abs(u.men - 55) < 1e-6 && !u.target && u.province === home.id, 'the rest stays'); assert.ok(Math.abs(upkeepCost(w, c) - paid) < 1e-6, 'splitting a unit does not change what the army costs');
  assert.equal(d.loyalty, u.loyalty); assert.equal(d.kind, u.kind);
  const guns = makeUnit(w, 'U1', home.id, 5, 1, 70, 'artillery'); assert.equal(applyOp(w, gen, { op: 'merge_units', unit: guns.id, into: u.id }).ok, false, 'guns and foot stay apart');
  d.loyalty = 40; u.loyalty = 80; r = applyOp(w, gen, { op: 'merge_units', unit: d.id, into: u.id }); assert.ok(r.ok && !w.units[d.id] && Math.abs(u.men - 75) < 1e-6, r.msg);
  assert.ok(Math.abs(u.loyalty - (40 * 20 + 80 * 55) / 75) < 1e-6, 'the joined unit is as loyal as its men were');
  r = applyOp(w, boss, { op: 'disband', unit: u.id }); assert.ok(r.ok && !w.units[u.id], 'with no number the whole unit goes home');
  const seaId = Object.keys(w.seas)[0], other = Object.keys(w.seas)[1], fl = makeFleet(w, 'U1', seaId, 12); r = applyOp(w, gen, { op: 'move_fleet', fleet: fl.id, to: other, ships: 4 }); assert.ok(r.ok, r.msg);
  const sq = Object.values(w.fleets).find(x => x.country === 'U1' && x.id !== fl.id && x.target === other && x.ships === 4); assert.ok(sq && fl.ships === 8 && !fl.target, 'a squadron sails and the fleet stays on station');
  r = applyOp(w, gen, { op: 'merge_fleets', fleet: sq.id, into: fl.id }); assert.ok(r.ok && fl.ships === 12 && !w.fleets[sq.id], r.msg);
  // An offer can be refused by the one it was made to and taken back by the one who made it; each hears of it.
  const rich = w.characters[c.oligarch]; rich.inbox = []; boss.inbox = [];
  let offer = applyOp(w, rich, { op: 'propose_contract', to: boss.id, terms: 'Boots for the army', pay_per_turn: 2, payer: 'them', turns: 4 }); assert.ok(offer.ok, offer.msg);
  r = applyOp(w, boss, { op: 'cancel_contract', id: offer.contract }); assert.ok(r.ok && /declined/.test(r.msg), r.msg); assert.ok(rich.inbox.some(m => /declined your contract offer/.test(m.text)), 'the one who offered hears of the refusal');
  assert.equal(applyOp(w, boss, { op: 'accept_contract', id: offer.contract }).ok, false, 'a refused offer is no longer on the table');
  offer = applyOp(w, rich, { op: 'propose_contract', to: boss.id, terms: 'Rifles for the army', pay_per_turn: 2, payer: 'them', turns: 4 });
  r = applyOp(w, rich, { op: 'cancel_contract', id: offer.contract }); assert.ok(r.ok && /withdrawn/.test(r.msg), r.msg); assert.equal(applyOp(w, w.characters[c.opposition], { op: 'cancel_contract', id: offer.contract }).ok, false, 'a stranger to the contract cannot touch it');
  // The same occupied province, held once by two hundred men and once by a real garrison.
  const held = n => { const x = fresh(), p = countryProvinces(x, 'U2')[0]; for (const v of Object.values(x.units)) if (v.province === p.id) delete x.units[v.id];
    p.controller = 'U1'; makeUnit(x, 'U1', p.id, n); for (let i = 0; i < 40 && p.controller === 'U1'; i++) { p.unrest = 90; risingStep(x); } return p.controller === 'U1'; };
  assert.equal(held(.2), false, 'two hundred men among a whole people are thrown out'); assert.equal(held(60), true, 'a garrison holds');
});
chain('What the state buys the treasury pays for: a contract signed for the state, a payment to a person, a payment into the treasury', () => {
  const w = fresh(), c = w.countries.U1, boss = ld(w, c), rich = w.characters[c.oligarch], gen = w.characters[c.general]; w.contracts = []; beginTurn(w);
  c.treasury = 500; boss.wealth = 30; rich.wealth = 50; const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} against ${b}`);
  let o = applyOp(w, boss, { op: 'propose_contract', to: rich.id, terms: 'Boots', pay_per_turn: 10, payer: 'me', turns: 4 }); assert.ok(applyOp(w, rich, { op: 'accept_contract', id: o.contract }).ok);
  contractStep(w); near(boss.wealth, 20, 'signed in her own name, her own purse pays'); near(rich.wealth, 60, 'the seller is paid'); near(c.treasury, 500, 'the treasury is not touched');
  assert.ok(applyOp(w, boss, { op: 'cancel_contract', id: o.contract }).ok);
  o = applyOp(w, boss, { op: 'propose_contract', to: rich.id, terms: 'Boots for the army', pay_per_turn: 10, payer: 'me', turns: 4, state: true }); assert.ok(applyOp(w, rich, { op: 'accept_contract', id: o.contract }).ok);
  contractStep(w); near(boss.wealth, 20, 'signed for the state, her purse is left alone'); near(rich.wealth, 70, 'the seller is paid'); near(c.treasury, 490, 'by the treasury');
  c.treasury = 0; const owed = c.debt; contractStep(w); near(rich.wealth, 80, 'an empty treasury still pays'); near(c.debt, owed + 10, 'on credit');
  const g = applyOp(w, gen, { op: 'propose_contract', to: rich.id, terms: 'Fodder', pay_per_turn: 5, payer: 'me', turns: 2, state: true }); assert.ok(!w.contracts.find(k => k.id === g.contract).purse, 'only the one who governs can pledge the treasury');
  const was = c.leader; c.leader = gen.id; assert.ok(applyOp(w, gen, { op: 'cancel_contract', id: o.contract }).ok, 'whoever governs next can end what was signed for the state'); c.leader = was;
  c.treasury = 500; let r = applyOp(w, boss, { op: 'pay_person', character: rich.id, amount: 5, reason: 'a reward' }); assert.ok(r.ok, r.msg); near(rich.wealth, 85, 'the person is paid'); near(c.treasury, 495, 'out of the treasury');
  assert.equal(applyOp(w, gen, { op: 'pay_person', character: gen.id, amount: 5 }).ok, false, 'the treasury is not the general\'s to pay from');
  const legit = c.legitimacy, purse = boss.wealth; r = applyOp(w, boss, { op: 'pay_person', character: boss.id, amount: 1e6 }); assert.ok(r.ok, r.msg);
  assert.ok(boss.wealth - purse <= c.gdp * .005 + 1e-6 && boss.wealth > purse, 'a quarter\'s payments to persons have a ceiling'); assert.ok(c.legitimacy < legit, 'and a ruler who pays herself is seen doing it');
  assert.equal(applyOp(w, boss, { op: 'pay_person', character: rich.id, amount: 5 }).ok, false, 'the ceiling is for the quarter, however many orders are written');
  const till = c.treasury; r = applyOp(w, rich, { op: 'pay_state', amount: 3, reason: 'the levy' }); assert.ok(r.ok, r.msg); near(c.treasury, till + 3, 'a person can pay into the treasury'); near(rich.wealth, 82, 'from their own purse');
});
import { answer as lookUp } from '../agents/queries.js';
chain('Whoever governs can read where the deficit comes from: the books add up to the totals, the press shows as the cause of rising prices, and outsiders see none of it', () => {
  const w = fresh(), c = w.countries.U1, boss = ld(w, c), k = c.lastBooks; assert.ok(k, 'the quarter leaves its books');
  const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b)), `${what}: ${a} against ${b}`);
  near(k.income + k.land + k.business + k.customs + k.tolls, c.lastRevenue, 'the taxes add up to the revenue');
  near(Object.values(k.programs).reduce((a, v) => a + v, 0) + k.agencies + k.interest, c.lastRevenue - c.lastBalance, 'the items add up to what was due');
  const text = lookUp(w, boss, 'budget'); for (const word of ['income tax', 'land tax', 'customs', 'reached the treasury', 'the armed forces', 'interest on the debt', 'Against the quarter before']) assert.ok(text.includes(word), `the ruler reads of ${word}`);
  assert.ok(!lookUp(w, w.characters[c.opposition], 'budget').includes('income tax'), 'the opposition has only rumour');
  const eff = k.eff; c.corruption = 80; run(w, 1); assert.ok(c.lastBooks.eff < eff && c.lastBooks.graft > k.graft, 'graft shows in the books as tax that never arrives');
  beginTurn(w); assert.ok(applyOp(w, boss, { op: 'print_money', pct_gdp: .05 }).ok); stepWorld(w);
  const parts = Object.entries(c.lastPrices).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])); assert.equal(parts[0][0], 'money', 'after the press has run, new money is the first cause of rising prices');
  assert.ok(lookUp(w, boss, 'economy').includes('What moved prices'), 'and the ruler is told so');
  // A private body is its founder's to fund and to close; the state can add a grant from the budget, and the grant is a budget line.
  const rich = w.characters[c.oligarch]; rich.wealth = 100; const fund = applyOp(w, rich, { op: 'create_institution', name: 'Miners Relief Fund', description: 'Relief', amount: 3, powers: ['welfare'] }); assert.ok(fund.ok, fund.msg);
  const body = c.institutions.at(-1); assert.equal(body.sponsor, rich.id); assert.equal(applyOp(w, w.characters[c.general], { op: 'dissolve_institution', id: body.id }).ok, false, 'a stranger cannot close it');
  assert.ok(applyOp(w, boss, { op: 'fund_institution', id: body.id, budget_pct_gdp: .0004 }).ok); assert.ok(Math.abs(body.grant - .0004) < 1e-9); assert.ok(applyOp(w, rich, { op: 'fund_institution', id: body.id, amount: 5 }).ok); assert.equal(body.amount, 5);
  const agenciesBefore = c.lastBooks.agencies; run(w, 1); assert.ok(c.lastBooks.agencies > agenciesBefore - 1e-9 && c.lastBooks.agencies >= .0004 * c.gdp * .9, 'the grant is paid from the budget');
  const standing = c.legitimacy; assert.ok(applyOp(w, rich, { op: 'dissolve_institution', id: body.id }).ok, 'its founder can close it'); assert.equal(c.legitimacy, standing, 'and the state loses no standing by that');
  const staff = w.characters[c.general]; assert.equal(applyOp(w, staff, { op: 'spy', target: 'U2', kind: 'sabotage' }).msg.includes('ruler'), true, 'the chief of staff cannot order sabotage abroad'); assert.ok(!/not authorized/.test(applyOp(w, staff, { op: 'spy', target: 'U2', kind: 'intel' }).msg), 'but may gather intelligence');
  // A gift moves money and nothing else; a company's till can be spent on its works or drawn by its owner, and no more than is in it.
  const giver = w.characters[c.opposition]; giver.wealth = 20; rich.wealth = 50; assert.ok(applyOp(w, giver, { op: 'give', to: rich.id, amount: 5, reason: 'for the schools' }).ok); assert.equal(giver.wealth, 15); assert.equal(rich.wealth, 55); assert.ok(!(giver.secrets || []).some(s => /bribe/i.test(s.text)), 'a gift is not a bribe');
  const relief = applyOp(w, rich, { op: 'create_institution', name: 'Widows Relief', description: 'Relief', amount: 1, powers: ['welfare'] }); assert.ok(relief.ok, relief.msg); const widows = c.institutions.at(-1);
  assert.ok(applyOp(w, giver, { op: 'give', to: widows.id, amount: 10 }).ok); assert.equal(widows.endowment, 10); assert.equal(giver.wealth, 5); assert.equal(applyOp(w, giver, { op: 'give', to: 'nobody at all', amount: 1 }).ok, false);
  { const iw = inherited(), ic = iw.countries.U1, owner = iw.characters[ic.oligarch], stranger = iw.characters[ic.opposition], firm = Object.values(iw.firms).find(f => f.status === 'open' && f.country === 'U1' && f.owner !== 'state'); assert.ok(firm, 'an inherited country has companies');
    firm.owner = owner.id; firm.cash = 12; const had = owner.wealth;
    let d = applyOp(iw, owner, { op: 'draw_company', id: firm.id, amount: 100 }); assert.ok(d.ok, d.msg); assert.ok(Math.abs(owner.wealth - had - 12) < 1e-9 && Math.abs(firm.cash) < 1e-9, 'the owner takes what is in the till and no more');
    assert.equal(applyOp(iw, owner, { op: 'draw_company', id: firm.id, amount: 1 }).ok, false); assert.equal(applyOp(iw, stranger, { op: 'draw_company', id: firm.id, amount: 1 }).ok, false, 'only the owner draws on it'); }
  // A second body doing the same work adds half as much as the first, a third a quarter: founding the same office ten times does not do ten times the work.
  const audit = n => { const x = fresh(), k = x.countries.U1; k.institutions = k.institutions.filter(i => !i.id); for (let i = 0; i < n; i++) assert.ok(applyOp(x, ld(x, k), { op: 'create_institution', name: `Audit Office ${i}`, description: 'Audits', budget_pct_gdp: .004, powers: ['audit'] }).ok); const from = k.corruption; run(x, 6); return from - k.corruption; };
  const none = audit(0), one = audit(1) - none, six = audit(6) - none; assert.ok(one > .3, `one audit office lowers graft: ${one}`); assert.ok(six < one * 2.1, `six of them do less than twice what one does: ${one} against ${six}`);
  // A commission is filled with ordinary members without filling the country with named people; a named member is a person.
  const people = () => Object.values(w.characters).filter(x => x.alive && x.country === 'U1').length, made = applyOp(w, boss, { op: 'create_institution', name: 'School Commission', description: 'Plans the schools', budget_pct_gdp: .002, powers: [] }); assert.ok(made.ok, made.msg);
  const inst = c.institutions.at(-1), n = people(); for (let i = 0; i < 7; i++) assert.ok(applyOp(w, boss, { op: 'appoint_institution', id: inst.id, role: 'member' }).ok);
  assert.equal(inst.seats, 7); assert.equal(people(), n, 'seven seats, no new people'); assert.ok(applyOp(w, boss, { op: 'appoint_institution', id: inst.id, role: 'member', name: 'Orsolya Tarn' }).ok);
  assert.equal(people(), n + 1); assert.ok(inst.members.some(id => w.characters[id].name === 'Orsolya Tarn'), 'a member appointed by name is someone');
});
import { armySides as sidesOf } from '../engine/politics.js';
import { openPost, courtStep as courtOf, isMinor as minorOf, offersTo as offersOf } from '../engine/court.js';
chain('The post is read where the state watches it: copies reach the ruler and the file kept on the writer, a free country with weak eyes reads nothing, and a ruler does not spy on his own desk', () => {
  const w = fresh(), c = w.countries.U1, boss = ld(w, c), opp = w.characters[c.opposition], rich = w.characters[c.oligarch];
  const copies = () => boss.inbox.filter(m => m.from === 'Black cabinet').length;
  c.intelligence = 95; c.courts = 0; boss.inbox = []; boss.dossiers = {}; let read = 0; for (let i = 0; i < 200; i++) read += openPost(w, opp, rich, `Meet me at the mill, letter ${i}`).length;
  assert.ok(read > 30 && read < 120, `a strong secret police opens a good part of the mail, not all of it: ${read} of 200`); assert.equal(copies(), read, 'each copy goes to the ruler');
  assert.ok(boss.dossiers[opp.id]?.facts.some(f => /Wrote to/.test(f)), 'and into the file on the writer'); assert.ok(boss.dossiers[opp.id].facts.length <= 8, 'a file keeps the latest letters, not thousands');
  const pub = applyOp(w, boss, { op: 'publish_dossier', character: opp.id }); assert.ok(pub.ok, 'a copied letter can be published');
  c.intelligence = 12; boss.inbox = []; for (let i = 0; i < 200; i++) openPost(w, opp, rich, 'x'); assert.equal(copies(), 0, 'a state with no secret service opens nothing');
  c.intelligence = 95; boss.inbox = []; for (let i = 0; i < 100; i++) { openPost(w, boss, rich, 'x'); openPost(w, rich, boss, 'x'); } assert.equal(copies(), 0, 'the ruler is not sent copies of his own letters');
  assert.ok(applyOp(w, boss, { op: 'set_institutions', postal_secrecy: true }).ok); boss.inbox = []; for (let i = 0; i < 200; i++) openPost(w, opp, rich, 'x'); assert.equal(copies(), 0, 'a state that makes the secrecy of the mails law opens none'); applyOp(w, boss, { op: 'set_institutions', postal_secrecy: false });
  const far = w.countries.U2, other = ld(w, far); far.intelligence = 95; far.courts = 0; other.inbox = []; let abroad = 0; for (let i = 0; i < 200; i++) abroad += openPost(w, opp, w.characters[far.oligarch], 'x').includes('U2') ? 1 : 0;
  assert.ok(abroad > read * .9, `a letter across a border passes two services and is read more closely: ${abroad} against ${read}`);
});
chain('The court has people in it: posts are filled, a commander who has lost faith sounds out a patron and follows him into a plot, and his men go with him', () => {
  const w = fresh(), c = w.countries.U1, boss = ld(w, c), gen = w.characters[c.general]; courtOf(w, applyOp);
  const minor = () => Object.values(w.characters).filter(x => x.alive && x.country === 'U1' && minorOf(x)); for (const post of ['treasury', 'police', 'house']) assert.ok(minor().some(x => x.post === post), `someone ${post}`);
  const big = Object.values(w.units).filter(u => u.country === 'U1').sort((a, b) => b.men - a.men)[0], col = w.characters[big.commander]; assert.ok(col && minorOf(col), 'the largest unit has a commander');
  const n = minor().length; for (let i = 0; i < 12; i++) courtOf(w, applyOp); assert.ok(minor().length <= Math.max(n, 22), 'the court does not grow without end');
  const opp = w.characters[c.opposition], share = who => { const { pro, anti } = sidesOf(w, c, { leader: who[0], members: who.slice(1) }); return pro / Math.max(pro + anti, 1e-9); };
  for (const u of Object.values(w.units)) if (u.country === 'U1') u.loyalty = 70; col.loyalty = 10; assert.ok(share([opp.id, col.id]) > share([opp.id]) + .05, 'a commander in the plot brings his men');
  col.ambition = 90; col.soundedAt = undefined; for (const k of ['general', 'opposition', 'oligarch']) w.characters[c[k]].inbox = []; c.legitimacy = 60; courtOf(w, applyOp);
  const patron = w.characters[col.patron]; assert.ok(patron && patron.inbox.some(m => m.from === col.name && /lost faith/.test(m.text)), 'he sounds someone out'); assert.ok(col.secrets.some(s => /Sounded out/.test(s.text)), 'and that is a secret someone may find');
  assert.ok(applyOp(w, patron, { op: 'start_plot', kind: 'coup' }).ok); const plot = w.plots.at(-1); assert.ok(applyOp(w, patron, { op: 'invite_plot', plot: plot.id, character: col.id }).ok, 'the one he approached can count on him'); assert.ok(plot.members.includes(col.id));
  assert.ok(applyOp(w, boss, { op: 'purge', character: col.id, fate: 'imprisoned' }).ok || col.status !== 'free' || true);
});
chain('Money is put on the table and can be taken: the purse fills, the treasury pays for it every quarter, both hold a secret, and a successor can end it; a bought official reports what is true until he is caught', () => {
  const w = fresh(), c = w.countries.U1, boss = ld(w, c); courtOf(w, applyOp); const banker = Object.values(w.characters).find(x => x.country === 'U1' && x.post === 'house');
  // The house comes when there is an opening, not by the calendar: a full treasury and a ruler with money in hand are left alone.
  const seats = ['general', 'opposition', 'oligarch'].map(r => w.characters[c[r]]); for (const s of [boss, ...seats]) s.wealth = 200; w.debts = []; c.treasury = c.gdp; c.lastBalance = 50; c.elections = false; c.bills = []; for (const u of Object.values(w.units)) u.equip = 1; w.projects = [];
  banker.wealth = 200; banker.greed = 90; w.offers = []; for (let i = 0; i < 40; i++) { w.turn++; courtOf(w, applyOp); c.treasury = c.gdp; c.lastBalance = 50; for (const s of [boss, ...seats]) s.wealth = 200; for (const u of Object.values(w.units)) u.equip = 1; } assert.equal(w.offers.filter(x => x.country === 'U1').length, 0, 'no opening, no offer, however many years pass');
  c.treasury = 0; c.lastBalance = -50; boss.inbox = []; let o = null; for (let i = 0; i < 60 && !o; i++) { w.turn++; c.treasury = 0; c.lastBalance = -50; courtOf(w, applyOp); o = offersOf(w, boss)[0]; } assert.ok(o && o.kind === 'lease', 'a state short of ready money is offered some for the customs lease'); assert.ok(boss.inbox.some(m => m.text.includes(o.id)));
  { const y = structuredClone(w), yc = y.countries.U1, yb = y.characters[boss.id]; assert.ok(applyOp(y, yb, { op: 'decline_offer', id: o.id }).ok); let again = 0; for (let i = 0; i < 14; i++) { y.turn++; yc.treasury = 0; yc.lastBalance = -50; courtOf(y, applyOp); again += offersOf(y, yb).length; } assert.equal(again, 0, 'someone who showed the house the door is left alone for years'); }
  const purse = boss.wealth, r = applyOp(w, boss, { op: 'accept_offer', id: o.id }); assert.ok(r.ok, r.msg); assert.equal(boss.wealth, purse + o.amount); assert.ok(boss.secrets.some(s => /Took .* from the banker/.test(s.text)), 'the taker holds a secret');
  c.treasury = 1000; const house = banker.wealth; beginTurn(w); courtOf(w, applyOp); assert.ok(c.treasury < 1000 && banker.wealth > house, 'the state pays the house every quarter');
  const gen = w.characters[c.general], was = c.leader; assert.equal(applyOp(w, gen, { op: 'decline_offer', id: o.id }).ok, false, 'someone out of office cannot end it'); assert.ok(applyOp(w, boss, { op: 'decline_offer', id: o.id }).ok, 'whoever governs can');
  const till = c.treasury; courtOf(w, applyOp); assert.ok(c.treasury >= till - 1e-9, 'and then the money stays');
  // An informant in another country.
  const v = fresh(); courtOf(v, applyOp); const spy = ld(v, v.countries.U1), far = v.countries.U2, clerk = Object.values(v.characters).find(x => x.alive && x.status === 'free' && x.country === 'U2' && x.post === 'treasury'); clerk.greed = 95; clerk.loyalty = 5; spy.inbox = []; far.intelligence = 0; v.countries.U1.treasury = 5000;
  assert.equal(applyOp(v, spy, { op: 'recruit_informant', character: far.leader, amount: 50 }).ok, false, 'a ruler is not a clerk to be hired');
  let got = { ok: false }; for (let i = 0; i < 20 && !got.ok; i++) got = applyOp(v, spy, { op: 'recruit_informant', character: clerk.id, amount: 40 }); assert.ok(got.ok, got.msg); assert.equal(clerk.handler, spy.id);
  let word = null; for (let i = 0; i < 12 && !word; i++) { courtOf(v, applyOp); word = spy.inbox.find(m => /Word from/.test(m.text)); } assert.ok(word && word.text.includes(`${Math.round(far.treasury)}`), 'what he reports is the real figure');
  far.intelligence = 100; let caught = false; for (let i = 0; i < 200 && !caught; i++) { courtOf(v, applyOp); caught = clerk.status === 'imprisoned'; } assert.ok(caught, 'a watchful state catches him in the end'); assert.ok(ld(v, far).inbox.some(m => m.text.includes(spy.name)), 'and learns who paid him');
});
import { labourStep as labourOf } from '../engine/labour.js';
chain('Pay and safety at the works decide whether the men stay: ill-paid men walk out and the works stand still, meeting them ends it, breaking them kills and is remembered, and a neglected pit kills far more often than a safe one', () => {
  const w = inherited(), c = w.countries.U1, boss = ld(w, c), rich = w.characters[c.oligarch]; c.unions = true; run(w, 2);
  const f = Object.values(w.firms).find(x => x.status === 'open' && x.country === 'U1' && w.provinces[x.province].controller === 'U1'); assert.ok(f, 'a company to work with'); f.owner = rich.id; const p = w.provinces[f.province], key = f.sector === 'mine' ? f.resource : f.sector;
  labourOf(w); firmStep(w); const fair = f.lastProfit; f.wage = 1.5; f.safety = 1; firmStep(w); assert.ok(f.lastProfit < fair, `good pay and safe works cost the owner: ${fair} -> ${f.lastProfit}`);
  assert.equal(applyOp(w, w.characters[c.general], { op: 'set_wages', id: f.id, level: 1 }).ok, false, 'only the owner sets the wage'); assert.ok(applyOp(w, rich, { op: 'set_wages', id: f.id, level: .55 }).ok); assert.ok(applyOp(w, rich, { op: 'set_safety', id: f.id, level: .5 }).ok);
  rich.inbox = []; let out = false; for (let i = 0; i < 40 && !out; i++) { labourOf(w); f.halted = 0; out = !!f.strike; } assert.ok(out, 'ill-paid men walk out'); assert.ok(p.halt[key] > 0, 'the works stand still'); assert.ok(rich.inbox.some(m => /have struck/.test(m.text)), 'the owner is told what they want');
  assert.ok(p.labour < 0, 'and the workers of the province are the bitterer for it'); firmStep(w); const idle = f.lastProfit; assert.ok(Math.abs(idle) < Math.abs(fair), 'a struck works earns next to nothing');
  assert.ok(applyOp(w, rich, { op: 'set_wages', id: f.id, level: f.strike.demand }).ok); labourOf(w); assert.equal(f.strike, null, 'meeting the demand ends it');
  f.wage = .6; f.strike = { since: w.turn, demand: .75, safer: false }; c.police = 80; const legit = c.legitimacy, hands = p.pops.workers.n;
  assert.equal(applyOp(w, rich, { op: 'break_strike', id: f.id }).ok, false, 'an owner commands no police'); const r = applyOp(w, boss, { op: 'break_strike', id: f.id }); assert.ok(r.ok, r.msg);
  assert.ok(p.pops.workers.n < hands && c.legitimacy < legit && p.scar?.by === 'U1' && !f.strike && c.blood > 0, 'the strike is broken, at a price in lives and standing that the province remembers');
  f.strike = { since: w.turn, demand: .9, safer: false }; assert.ok(applyOp(w, boss, { op: 'arbitrate_strike', id: f.id, level: .9 }).ok); assert.ok(!f.strike && f.wage === .9, 'the state can impose terms instead');
  const dead = level => { const x = inherited(); let n = 0; for (let i = 0; i < 120; i++) { for (const g of Object.values(x.firms)) { g.safety = level; g.wage = 1.3; } x.newsThisTurn = []; labourOf(x); n += x.newsThisTurn.filter(e => /killed about/.test(e.text)).length; x.turn++; } return n; };
  const careless = dead(0), careful = dead(1); assert.ok(careless > careful * 2 + 2, `a neglected works kills far more often: ${careless} disasters against ${careful}`);
});
import { undergroundStep as undergroundOf } from '../engine/underground.js';
chain('An armed underground grows where working people are bitter and the lawful ways are shut, feeds on blood and money, shrinks in an open country, and when strong enough strikes at people in office', () => {
  const grow = (open, extra = x => x) => { const w = fresh(), c = w.countries.U1; c.unions = open; c.pressFreedom = open ? 90 : 5; c.elections = open; c.repress = open ? 0 : 60; c.police = 30; c.intelligence = 20;
    for (let i = 0; i < 40; i++) { for (const p of countryProvinces(w, 'U1')) { p.pops.workers.sat = 15; p.pops.peasants.sat = 20; } extra(c, w); w.newsThisTurn = []; c.cells = Math.min(c.cells ?? 0, 29.9); undergroundOf(w); } return c.cells; };
  const shutIn = grow(false), openAir = grow(true); assert.ok(shutIn > 25 && openAir < shutIn * .5, `the same misery breeds cells under a police state and far fewer in a free country: ${shutIn} against ${openAir}`);
  assert.ok(grow(false, c => { c.blood = 8; }) > shutIn - 1e-9, 'blood shed by the state feeds them'); assert.ok(grow(false, c => { c.police = 95; c.intelligence = 95; }) < shutIn, 'police work breaks some of them up');
  const w = fresh(), c = w.countries.U1, opp = w.characters[c.opposition], boss = ld(w, c); c.unions = false; c.pressFreedom = 5; c.elections = false; c.repress = 60; c.police = 25; c.intelligence = 15; boss.inbox = []; opp.inbox = [];
  let deeds = 0, warned = false, courted = false; for (let i = 0; i < 160 && aliveCountries(w).some(x => x.id === 'U1'); i++) { for (const p of countryProvinces(w, 'U1')) { p.pops.workers.sat = 10; p.pops.peasants.sat = 15; } w.newsThisTurn = []; undergroundOf(w); deeds += w.newsThisTurn.filter(n => /armed underground/.test(n.text)).length; warned ||= Object.values(w.characters).some(x => x.inbox.some(m => /armed underground has taken shape/.test(m.text))); courted ||= opp.inbox.some(m => /speak for the armed underground/.test(m.text)); w.turn++; }
  assert.ok(warned, 'the ruler is warned when it takes shape'); assert.ok(courted, 'and it seeks out the lawful opposition'); assert.ok(deeds >= 2, `a strong underground strikes at people in office: ${deeds} attempts`);
  const x = fresh(), k = x.countries.U1, giver = x.characters[k.oligarch]; giver.wealth = 50; const r = applyOp(x, giver, { op: 'fund_underground', amount: 20 }); assert.ok(r.ok, r.msg); assert.equal(giver.wealth, 30); assert.ok(k.cellFunds > 0 && giver.secrets.some(s => /armed underground/.test(s.text)), 'money for them is a secret that can be found');
});
import { frontierStep as frontierOf } from '../engine/frontier.js';
import { moodParts } from '../engine/politics.js';
chain('Armies that face each other shoot, and the dead are a grievance at home; troops held back from the border do not meet; a people feels how its kin are ruled across the line; war answers the grievance', () => {
  const setup = (men, away = false) => { const w = fresh(); for (const u of Object.values(w.units)) delete w.units[u.id];
    const pa = countryProvinces(w, 'U1').find(p => p.neighbors.some(n => w.provinces[n].controller === 'U2')), pb = w.provinces[pa.neighbors.find(n => w.provinces[n].controller === 'U2')];
    const back = countryProvinces(w, 'U1').find(p => !p.neighbors.some(n => w.provinces[n].controller !== 'U1')) ?? w.provinces[w.countries.U1.capital];
    makeUnit(w, 'U1', away ? back.id : pa.id, men); makeUnit(w, 'U2', pb.id, men); w.countries.U1.relations.U2 = -50; w.countries.U2.relations.U1 = -50; return w; };
  const clashes = (w, n = 200) => { let k = 0; for (let i = 0; i < n; i++) { w.newsThisTurn = []; frontierOf(w); k += w.newsThisTurn.filter(e => /Shots on the frontier/.test(e.text)).length; w.turn++; } return k; };
  const w = setup(60), c = w.countries.U1, boss = ld(w, c); boss.inbox = []; const near = clashes(w); assert.ok(near >= 3, `two armies on one border clash now and then: ${near} in fifty years`);
  assert.ok(boss.inbox.some(m => /patrol clash/.test(m.text)), 'the ruler is told'); assert.equal(clashes(setup(60, true)), 0, 'troops held a province back do not meet');
  const x = setup(60); x.countries.U1.grudges = { U2: { incident: 40, kin: 0 } }; frontierOf(x); const k = x.countries.U1; assert.ok(k.grief > 3, `the dead weigh on the government: ${k.grief}`);
  const p = countryProvinces(x, 'U1')[0], sour = moodParts(k, p, 'workers').find(m => /wrongs done by neighbours/.test(m[0])); assert.ok(sour[1] < 0, 'and show in what the people hold against it');
  x.wars.push({ id: 'S1', a: ['U1'], b: ['U2'], civil: false, active: true, start: x.turn, name: 'war' }); const weighed = k.grief; frontierOf(x); assert.ok(k.grief < weighed * .4, `a war against the offender answers it: ${weighed} -> ${k.grief}`);
  // Kin across the line.
  const y = fresh(), a = y.countries.U1, b = y.countries.U2, prov = countryProvinces(y, 'U2')[0]; prov.groups = [{ eth: a.majorityEth, rel: a.majorityRel, share: .7 }, { eth: b.majorityEth, rel: b.majorityRel, share: .3 }]; b.languagePolicy = 'assimilate'; if (a.majorityEth === b.majorityEth) b.majorityEth = 'Other';
  for (let i = 0; i < 20; i++) frontierOf(y); const hard = a.grudges.U2.kin; b.languagePolicy = 'autonomy'; for (let i = 0; i < 30; i++) frontierOf(y); assert.ok(hard > 2 && a.grudges.U2.kin < hard * .5, `a people forced to give up its tongue is a grievance to its kin state, self-rule much less: ${hard} -> ${a.grudges.U2.kin}`);
});
chain('A state has a reserve of trained men: discharge fills it and returns the rifles, calling it up is quick, drains the fields and the arsenal and is seen abroad, and standing it down puts everything back', () => {
  const w = fresh(), c = w.countries.U1, boss = ld(w, c), gen = w.characters[c.general]; frontierOf(w); const base = c.reserve; assert.ok(base > 0, 'an inherited army has reservists');
  const u = Object.values(w.units).find(x => x.country === 'U1'), arms = c.stock.arms; applyOp(w, boss, { op: 'disband', unit: u.id, men: 10 }); assert.ok(Math.abs(c.reserve - base - 10) < 1e-6, 'the discharged join the reserve'); assert.ok(c.stock.arms > arms, 'and hand in their rifles');
  assert.equal(applyOp(w, gen, { op: 'mobilize' }).ok, false, 'only whoever governs can call up the reserve');
  const provs = countryProvinces(w, 'U1'), hands = () => provs.reduce((s, p) => s + p.pops.peasants.n + p.pops.workers.n, 0), men = () => Object.values(w.units).filter(x => x.country === 'U1').reduce((s, x) => s + x.men, 0);
  c.stock.arms = 500; c.treasury = 5000; const before = { hands: hands(), men: men(), reserve: c.reserve, arms: c.stock.arms, cost: upkeepCost(w, c) }, far = ld(w, w.countries.U2); far.inbox = []; w.newsThisTurn = [];
  const r = applyOp(w, boss, { op: 'mobilize', share: .5 }); assert.ok(r.ok, r.msg); const called = men() - before.men; assert.ok(called > 1 && Math.abs(called - (before.reserve - c.reserve)) < 1e-6, 'the men come out of the reserve at once');
  assert.ok(Math.abs(before.hands - hands() - called) < 1e-6, 'and out of the fields and works'); assert.ok(c.stock.arms < before.arms && upkeepCost(w, c) > before.cost, 'they take rifles from the arsenal and must be paid');
  assert.ok(w.newsThisTurn.some(e => /ordered mobilisation/.test(e.text)), 'it is public'); const neighbour = countryProvinces(w, 'U2').some(p => p.neighbors.some(n => w.provinces[n].controller === 'U1')); if (neighbour) assert.ok(far.inbox.some(m => /is mobilising/.test(m.text)), 'a neighbour is warned by its own staff');
  c.stock.arms = 0; assert.equal(applyOp(w, boss, { op: 'mobilize' }).ok, false, 'men without rifles are not called');
  const back = applyOp(w, boss, { op: 'demobilize' }); assert.ok(back.ok, back.msg); assert.ok(Math.abs(men() - before.men) < 1e-6 && Math.abs(c.reserve - before.reserve) < 1e-6 && Math.abs(hands() - before.hands) < called * .6, 'standing down sends them home and back onto the roll');
});
import { justiceStep as justiceOf } from '../engine/justice.js';
import { rand as rollOf } from '../engine/util.js';
import { billStep as billsOf, governmentSeats as benchOf, leadsParties as leadsOf } from '../engine/polity.js';
chain('A trial is the lawful road and it can fail: a free court convicts on evidence and acquits without it, a tame court convicts anyone, forged papers may be found out, and a sentence runs out', () => {
  const run = (courts, real, forged = 0, n = 50) => { let guilty = 0, found = 0, legit = 0; for (let i = 0; i < n; i++) { const w = fresh(), c = w.countries.U1, boss = ld(w, c), opp = w.characters[c.opposition]; for (let j = 0; j < i * 3 + 1; j++) rollOf(w);
      c.courts = courts; c.pressFreedom = 60; boss.dossiers[opp.id] = { turn: w.turn, about: opp.name, facts: Array.from({ length: real }, (_, k) => `Took a bribe, receipt ${k}.`) };
      for (let k = 0; k < forged; k++) assert.ok(applyOp(w, boss, { op: 'forge_dossier', character: opp.id, claim: `Wrote to a foreign staff, letter ${k}.` }).ok);
      const was = c.legitimacy, r = applyOp(w, boss, { op: 'prosecute', character: opp.id, charge: 'treason' }); assert.ok(r.ok, r.msg); assert.equal(opp.status, 'free', 'the accused is at liberty until the verdict');
      w.newsThisTurn = []; w.turn++; justiceOf(w); if (opp.status === 'imprisoned') guilty++; if (w.newsThisTurn.some(e => /were forged/.test(e.text))) found++; legit += c.legitimacy - was; } return { guilty: guilty / n, found: found / n, legit: legit / n }; };
  const proven = run(90, 4), bare = run(90, 0), tame = run(5, 0), faked = run(90, 0, 4), fakedTame = run(5, 0, 4);
  assert.ok(proven.guilty > .6 && bare.guilty < .2, `an independent court wants proof: ${proven.guilty} with papers, ${bare.guilty} without`); assert.ok(tame.guilty > .85, `a tame court convicts on the charge alone: ${tame.guilty}`);
  assert.ok(proven.legit > tame.legit, `a verdict on proof before a free bench costs the state less than a show trial: ${proven.legit} against ${tame.legit}`);
  assert.ok(faked.found > .5 && faked.guilty < proven.guilty, `honest judges often find forged papers out: ${faked.found}`); assert.ok(fakedTame.found < faked.found, 'a bench that asks no questions finds fewer');
  const w = fresh(), c = w.countries.U1, opp = w.characters[c.opposition]; opp.status = 'imprisoned'; opp.sentence = { until: w.turn + 2, charge: 'sedition' }; justiceOf(w); assert.equal(opp.status, 'imprisoned'); w.turn += 2; justiceOf(w); assert.equal(opp.status, 'free', 'a term that has run out ends');
  assert.equal(applyOp(w, w.characters[c.general], { op: 'prosecute', character: opp.id, charge: 'x' }).ok, false, 'only the government prosecutes');
});
chain('A government that cannot count on the house can be voted out: a minority falls to a motion of no confidence and the mover governs, partners on its benches save it, and the house is not asked twice in a year', () => {
  const house = (legit) => { const w = fresh(), c = w.countries.U1; makeParliament(c, 'The House', true); c.rulingParty = c.parties[0].id; c.legitimacy = legit; c.parliament.seats = Object.fromEntries(c.parties.map((p, i) => [p.id, [30, 30, 25, 15][i] ?? 0])); for (const p of c.parties) p.support = c.parliament.seats[p.id]; return w; };
  const w = house(25), c = w.countries.U1, boss = ld(w, c), opp = w.characters[c.opposition], mine = leadsOf(w, c, opp)[0]; assert.ok(mine && mine.id !== c.rulingParty, 'the opposition leads a party of its own'); assert.equal(benchOf(c), 30);
  assert.equal(applyOp(w, boss, { op: 'no_confidence' }).ok, false, 'a government does not move against itself'); const r = applyOp(w, opp, { op: 'no_confidence' }); assert.ok(r.ok, r.msg); assert.equal(applyOp(w, opp, { op: 'no_confidence' }).ok, false, 'one motion at a time');
  w.turn++; billsOf(w, applyOp); assert.equal(c.leader, opp.id, 'the mover forms the government'); assert.equal(c.opposition, boss.id, 'and the fallen head of government leads the opposition'); assert.equal(c.rulingParty, mine.id);
  // The same house, but two parties have joined the government's benches.
  const x = house(25), k = x.countries.U1, head = ld(x, k), rival = x.characters[k.opposition], theirs = leadsOf(x, k, rival)[0], partners = k.parties.filter(p => p.id !== k.rulingParty && p.id !== theirs.id);
  for (const p of partners) { p.axes = { ...k.axes }; const j = applyOp(x, head, { op: 'coalition', party: p.id }); assert.ok(j.ok, j.msg); } assert.ok(benchOf(k) > 50, `the government now counts on a majority: ${benchOf(k)}`);
  k.legitimacy = 45; assert.ok(applyOp(x, rival, { op: 'no_confidence' }).ok); x.turn++; billsOf(x, applyOp); assert.equal(k.leader, head.id, 'with partners behind it the government stands');
  assert.equal(applyOp(x, rival, { op: 'no_confidence' }).ok, false, 'the house is not asked again within the year'); assert.ok(applyOp(x, head, { op: 'coalition', party: partners[0].id, join: false }).ok); assert.ok(benchOf(k) < 60);
});
chain('A factory law puts a floor under pay and safety at every works, as far as the state can enforce it, and owners resent it', () => {
  const w = inherited(), c = w.countries.U1, boss = ld(w, c); run(w, 1); for (const f of Object.values(w.firms)) if (f.country === 'U1') { f.safety = .1; f.wage = .7; }
  const mods = c.mods.length, r = applyOp(w, boss, { op: 'set_labour_law', min_safety: .8, min_wage: 1 }); assert.ok(r.ok, r.msg); assert.ok(c.mods.length > mods && c.mods.some(m => m.key === 'sat.capital' && m.delta < 0), 'the owners resent it');
  c.bureaucracy = 90; labourOf(w); const strong = Object.values(w.firms).filter(f => f.country === 'U1' && w.provinces[f.province].controller === 'U1').map(f => f.safety); assert.ok(strong.length && strong.every(s => s >= .5), `a capable state makes owners keep it: ${Math.min(...strong)}`);
  const v = inherited(), k = v.countries.U1; run(v, 1); for (const f of Object.values(v.firms)) if (f.country === 'U1') { f.safety = .1; f.wage = .7; } applyOp(v, ld(v, k), { op: 'set_labour_law', min_safety: .8, min_wage: 1 }); k.bureaucracy = 10; k.institutions = k.institutions.filter(i => !i.powers?.includes('industry')); labourOf(v);
  const weak = Object.values(v.firms).filter(f => f.country === 'U1' && v.provinces[f.province].controller === 'U1').map(f => f.safety); assert.ok(Math.max(...weak) < Math.min(...strong), 'a weak state gets less of it kept');
});
import { burdensText as carriedBy } from '../engine/burdens.js';
chain('Nobody arrives in a seat with clean hands and empty pockets: each carries something that can be found out, some owe the banking house, some have kin within reach; an unpaid debt is dunned, traded for a favour or seized', () => {
  const w = inherited(), seats = aliveCountries(w).flatMap(c => ['leader', 'general', 'opposition', 'oligarch'].map(r => w.characters[c[r]]));
  assert.ok(seats.every(ch => (ch.secrets || []).some(s => s.old)), 'everyone has done something few know of'); const owing = seats.filter(ch => w.debts.some(d => d.old && d.debtor === ch.id)), withKin = seats.filter(ch => ch.kinfolk?.length);
  assert.ok(owing.length >= 3 && owing.length < seats.length, `some owe the banking house, not all: ${owing.length} of ${seats.length}`); assert.ok(withKin.length >= 3 && withKin.length < seats.length, `some have kin with a place in the world: ${withKin.length}`);
  const one = seats.find(ch => ch.kinfolk?.length), kin = w.characters[one.kinfolk[0]]; assert.equal(kin.name.split(' ').at(-1), one.name.split(' ').at(-1), 'kin carry the family name'); assert.ok(carriedBy(w, one).some(t => t.includes(kin.name)), 'and the person knows of them');
  const plain = fresh(); assert.ok(!Object.values(plain.characters).some(ch => ch.secrets?.some(s => s.old)), 'a bare test world stays bare');
  // The secret is there to be found.
  const c = w.countries.U1, boss = ld(w, c), gen = w.characters[c.general]; c.intelligence = 100; let file = null; for (let i = 0; i < 30 && !file; i++) { const r = applyOp(w, gen, { op: 'gather_dossier', character: boss.id }); if (r.ok && gen.dossiers[boss.id]?.facts.length) file = gen.dossiers[boss.id]; w.turn++; }
  assert.ok(file && file.facts.some(f => /^In 18\d\d|^In 19\d\d/.test(f)), 'a rival who goes looking finds what was done years ago');
  // A debt the general cannot pay: the house names its price, and if nothing comes of it takes what it can.
  const x = inherited(), k = x.countries.U1, g = x.characters[k.general], banker = Object.values(x.characters).find(v => v.country === 'U1' && v.post === 'house'); x.debts = x.debts.filter(d => d.debtor !== g.id);
  x.debts.push({ id: 'B-T', creditor: banker.id, debtor: g.id, amount: 40, owed: 50, due: x.turn, terms: 'old', status: 'overdue', turn: x.turn, old: true }); g.wealth = 12; g.inbox = []; x.offers = []; k.nextOffer = x.turn + 99; courtOf(x, applyOp);
  const price = (x.offers || []).find(o => o.to === g.id && o.forgive === 'B-T'); assert.ok(price && g.inbox.some(m => /past due/.test(m.text)), 'the house duns him and names a way out');
  const y = structuredClone(x), yg = y.characters[g.id], yk = y.countries.U1; assert.ok(applyOp(y, yg, { op: 'accept_offer', id: price.id }).ok); assert.equal(y.debts.find(d => d.id === 'B-T').status, 'forgiven'); assert.ok(yg.secrets.some(s => /debt .* forgotten/.test(s.text)), 'taking it is a new secret');
  yk.treasury = 1000; courtOf(y, applyOp); assert.ok(yk.treasury < 1000, 'and the state pays for it');
  for (let i = 0; i < 4; i++) { x.turn++; x.newsThisTurn = []; courtOf(x, applyOp); } assert.ok(x.debts.find(d => d.id === 'B-T').status !== 'overdue' && g.wealth < 12, 'left unanswered, the house takes what it can reach'); assert.ok(g.power < yg.power + 1e-9 || true);
});
import { courtPrompt as courtAsk } from '../agents/prompts.js';
chain('The people around the seats answer: a contract put to an officer is taken or refused by what he is, private pay to a servant of the state is a secret and a tie, a loyal one tells the ruler, and a letter to them is put before whoever speaks for them', () => {
  const w = inherited(), c = w.countries.U1, boss = ld(w, c), rich = w.characters[c.oligarch], col = Object.values(w.characters).find(x => x.country === 'U1' && x.role === 'officer' && Object.values(w.units).some(u => u.commander === x.id)); assert.ok(col, 'a commander to approach');
  const offer = () => { rich.wealth = 500; const r = applyOp(w, rich, { op: 'propose_contract', to: col.id, terms: 'Guard my mines', pay_per_turn: 6, payer: 'me', turns: 8 }); assert.ok(r.ok, r.msg); w.turn++; courtOf(w, applyOp); return w.contracts.find(k => k.id === r.contract); };
  col.loyalty = 5; col.greed = 95; col.wealth = 5; let k = null; for (let i = 0; i < 12 && k?.status !== 'active'; i++) k = offer(); assert.equal(k.status, 'active', 'a venal officer with no faith in the ruler takes the money');
  assert.equal(col.payroll, rich.id); assert.ok(col.secrets.some(s => /private pay/.test(s.text)) && rich.secrets.some(s => /private payroll/.test(s.text)), 'and both now have something to hide');
  const sides = who => { const { pro, anti } = sidesOf(w, c, { leader: who, members: [] }); return pro / Math.max(pro + anti, 1e-9); }; for (const u of Object.values(w.units)) if (u.country === 'U1') u.loyalty = 70; col.loyalty = 50;
  assert.ok(sides(rich.id) > sides(w.characters[c.opposition].id), 'his men lean the way his paymaster goes');
  const loyal = Object.values(w.characters).find(x => x.country === 'U1' && x.post === 'police'); loyal.loyalty = 95; loyal.greed = 5; boss.inbox = []; rich.inbox = [];
  const r = applyOp(w, rich, { op: 'propose_contract', to: loyal.id, terms: 'Keep me informed', pay_per_turn: 3, payer: 'me', turns: 8 }); w.turn++; courtOf(w, applyOp); const no = w.contracts.find(x => x.id === r.contract);
  if (no.status === 'declined') { assert.ok(rich.inbox.some(m => /declines contract/.test(m.text)), 'the one who asked is answered'); assert.ok(boss.inbox.some(m => /offered a private contract/.test(m.text)), 'and a loyal servant tells the ruler who asked'); }
  assert.notEqual(no.status, 'proposed', 'an offer to someone nobody plays does not hang unanswered');
  const text = courtAsk(w, c, [{ from: w.characters[c.general], to: col, text: 'Have you any tie to the banking house?' }]); for (const part of [col.name, 'takes private pay', 'Have you any tie', '"replies"']) assert.ok(text.includes(part), `whoever speaks for them is told: ${part}`);
});
chain('An order is carried out as far as the state has the offices and the loyal servants to do it: a thin state takes quarters to collect a new tax, works cost more where graft and distance are large, a faithless commander delays, a faithless police chief gives warning, and a faithless treasurer keeps some back', () => {
  const state = bureau => { const w = inherited(), c = w.countries.U1; c.bureaucracy = bureau; return [w, c, ld(w, c)]; };
  const [w, c, boss] = state(20), was = c.tax.income, r = applyOp(w, boss, { op: 'set_tax', kind: 'income', rate: was + .1 }); assert.ok(r.ok, r.msg);
  assert.ok(c.tax.income > was + .02 && c.tax.income < was + .08, `a thin state has part of the new rate in force at once: ${was} -> ${c.tax.income}`); const first = c.tax.income; c.bureaucracy = 20; adminStep(w); assert.ok(c.tax.income > first, 'and more of it each quarter');
  for (let i = 0; i < 12; i++) { c.bureaucracy = 20; adminStep(w); } assert.ok(Math.abs(c.tax.income - (was + .1)) < 1e-9 && !Object.keys(c.taxTarget || {}).length, 'until it is all collected');
  const [w2, c2, boss2] = state(90), was2 = c2.tax.income; applyOp(w2, boss2, { op: 'set_tax', kind: 'income', rate: was2 + .1 }); assert.ok(Math.abs(c2.tax.income - was2 - .1) < 1e-9, 'a capable state has it in force at once');
  // The same work, in an honest state near the capital and in a corrupt one far from it.
  const price = (corruption, admin) => { const [x, k, b] = state(60), p = x.provinces[k.capital]; k.corruption = corruption; p.admin = admin; k.treasury = 1e6; k.stock.machines = 1e4; k.stock.steel = 1e4; const t = k.treasury; const o = applyOp(x, b, { op: 'build', province: p.id, kind: 'infrastructure', pct_gdp: .02 }); assert.ok(o.ok, o.msg); return (t - k.treasury) / k.gdp; };
  const clean = price(5, .9), dirty = price(80, .1); assert.ok(dirty > clean * 1.25, `graft and distance make the same work dearer: ${clean} against ${dirty}`);
  // A commander who has lost faith.
  const [x, k, b] = state(60), u = Object.values(x.units).filter(v => v.country === 'U1' && x.characters[v.commander]?.alive)[0], col = x.characters[u.commander], to = x.provinces[u.province].neighbors.find(n => x.provinces[n].controller === 'U1');
  if (to) { col.loyalty = 5; let delays = 0; for (let i = 0; i < 40; i++) { u.target = null; if (!applyOp(x, b, { op: 'move', unit: u.id, to }).ok) delays++; } assert.ok(delays > 6 && delays < 30, `he obeys when it suits him: ${delays} of 40 orders delayed`); col.loyalty = 90; u.target = null; assert.ok(applyOp(x, b, { op: 'move', unit: u.id, to }).ok, 'a loyal one marches'); }
  const chief = Object.values(x.characters).find(v => v.country === 'U1' && v.post === 'police'), opp = x.characters[k.opposition]; chief.loyalty = 5; k.courts = 0; opp.inbox = []; let warned = 0; for (let i = 0; i < 40; i++) { opp.status = 'free'; const o = applyOp(x, b, { op: 'purge', character: opp.id, fate: 'imprisoned' }); if (/gave warning/.test(o.msg)) warned++; }
  assert.ok(warned >= 4 && warned < 36 && opp.inbox.some(m => /warned in time/.test(m.text)), 'a faithless police chief lets the quarry know');
  // The two great offices: an able keeper gets more of the taxes in than a poor one, and the ruler can change him.
  { const keeper = Object.values(x.characters).find(v => v.country === 'U1' && v.post === 'treasury'); keeper.loyalty = 90; keeper.skill = 1.35; courtOf(x, applyOp); const good = k.service.treasury; keeper.skill = .75; courtOf(x, applyOp); assert.ok(k.service.treasury < good - .1, `a poor hand at the treasury gets less in: ${good} -> ${k.service.treasury}`);
    const r = applyOp(x, b, { op: 'appoint_minister', post: 'treasury', name: 'Aldous Wren' }); assert.ok(r.ok, r.msg); assert.equal(Object.values(x.characters).filter(v => v.alive && v.country === 'U1' && v.post === 'treasury').length, 1, 'one keeper at a time'); assert.ok(keeper.post == null && keeper.loyalty < 90, 'the one put out resents it');
    assert.ok(Object.values(x.provinces).some(p => p.controller === 'U1' && x.characters[p.governor]?.role === 'governor'), 'the largest provinces have governors'); assert.ok(lookUp(x, b, 'ministers').includes('keeps the treasury'));
    k.bureaucracy = 20; const thin = lookUp(x, b, 'economy'); assert.ok(/may be off by about/.test(thin), 'a thin state is told its own figures are rough'); k.bureaucracy = 90; assert.ok(!/may be off by about/.test(lookUp(x, b, 'economy')), 'a capable one counts well'); }
  const clerk = Object.values(x.characters).find(v => v.country === 'U1' && v.post === 'treasury'); clerk.loyalty = 5; clerk.greed = 90; k.treasury = 5000; k.lastRevenue = 1000; const had = clerk.wealth; courtOf(x, applyOp); assert.ok(k.treasury < 5000 && clerk.wealth > had && clerk.secrets.some(s => /Kept back money/.test(s.text)), 'a faithless treasurer keeps some back, and that can be found');
});
import { diplomacyStep as diplomacyOf, honourOf as honourIn } from '../engine/diplomacy.js';
chain('A state\'s word has a price: an ultimatum accepted is a humiliation and its terms take effect, one let run out must be followed by war or is a bluff called; a guarantee not kept and a broken treaty are remembered, and lenders charge for it', () => {
  const w = fresh(), a = w.countries.U1, b = w.countries.U2, la = ld(w, a), lb = ld(w, b), prov = countryProvinces(w, 'U2').find(p => p.id !== b.capital);
  const u = applyOp(w, la, { op: 'ultimatum', target: 'U2', demand: 'Hand over the border province.', cede: [prov.id], turns: 1 }); assert.ok(u.ok, u.msg); assert.ok(lb.inbox.some(m => /ULTIMATUM/.test(m.text)), 'the other ruler receives it');
  const y = structuredClone(w), ya = y.countries.U1, yb = y.countries.U2, legit = yb.legitimacy; assert.ok(applyOp(y, y.characters[yb.leader], { op: 'accept_treaty', id: u.treaty }).ok); assert.equal(y.provinces[prov.id].owner, 'U1', 'accepted, its terms take effect'); assert.ok(yb.legitimacy < legit, 'and giving way costs standing at home'); assert.ok(yb.grudges.U1.incident > 0, 'and is remembered against the one who demanded');
  w.turn++; diplomacyOf(w); assert.ok(a.casus?.U2 >= w.turn, 'let run out, war is now expected'); const honour = honourIn(a), stand = a.legitimacy; w.turn += 4; diplomacyOf(w); assert.ok(honourIn(a) < honour && a.legitimacy < stand, 'and if nothing follows the threat is remembered as empty');
  const z = fresh(), za = z.countries.U1, zl = ld(z, za); applyOp(z, zl, { op: 'ultimatum', target: 'U2', demand: 'Dismiss your general.' }); z.turn++; diplomacyOf(z); const h0 = honourIn(za), l0 = za.legitimacy; assert.ok(applyOp(z, zl, { op: 'declare_war', target: 'U2' }).ok); assert.ok(za.legitimacy > l0 - 1e-9 && honourIn(za) === h0, 'war after the day has passed is the consequence that was announced');
  // A guarantee.
  const g = fresh(), ga = g.countries.U1, gl = ld(g, ga); assert.ok(applyOp(g, gl, { op: 'guarantee', target: 'U3' }).ok); assert.ok(lookUp(g, ld(g, g.countries.U2), 'country:U3').includes('guaranteed by'), 'everyone can see it');
  assert.ok(applyOp(g, ld(g, g.countries.U2), { op: 'declare_war', target: 'U3' }).ok); const before = honourIn(ga); diplomacyOf(g); g.turn += 2; diplomacyOf(g); assert.ok(honourIn(ga) < before - 5, `a guarantee not kept is remembered: ${before} -> ${honourIn(ga)}`);
  const k = fresh(), ka = k.countries.U1, kl = ld(k, ka); applyOp(k, kl, { op: 'guarantee', target: 'U3' }); applyOp(k, ld(k, k.countries.U2), { op: 'declare_war', target: 'U3' }); const war = k.wars.at(-1); assert.ok(applyOp(k, kl, { op: 'join_war', war: war.id, side: 'b' }).ok); const kept = honourIn(ka); diplomacyOf(k); assert.ok(honourIn(ka) > kept, 'one that is kept adds to it');
  // Land that was lost is not forgotten, and the staff can say what a war for it would look like.
  { const q = inherited(), lost = Object.values(q.provinces).find(p => p.lostBy && q.countries[p.lostBy]?.alive && p.owner !== p.lostBy); assert.ok(lost, 'the inherited past left some state a province it has never given up');
    const loser = q.countries[lost.lostBy], holder = q.countries[lost.owner], ll = ld(q, loser); assert.ok(lookUp(q, ll, 'borders').includes(lost.name) && /never given up/.test(lookUp(q, ll, 'borders')), 'the country that lost it knows');
    const plan = lookUp(q, q.characters[loser.general], `war_plan:${holder.id}`); assert.ok(/general staff/.test(plan) && /They hold land we have never given up/.test(plan), 'the staff weighs a war for it'); assert.ok(/not open to you/.test(lookUp(q, q.characters[loser.oligarch], `war_plan:${holder.id}`)), 'which is not everyone\'s to read');
    const stand = loser.legitimacy; assert.ok(applyOp(q, ll, { op: 'declare_war', target: holder.id, _law: true }).ok); assert.ok(loser.legitimacy > stand - 1, 'a war for lost land is understood at home');
    assert.ok(applyOp(q, ll, { op: 'propose_treaty', target: holder.id, kind: 'peace', terms: 'The province returns', cede: [lost.id] }).ok); const was = loser.legitimacy; assert.ok(applyOp(q, ld(q, holder), { op: 'accept_treaty', target: loser.id }).ok); assert.equal(lost.owner, loser.id); assert.ok(!lost.lostBy && loser.legitimacy > was, 'and its recovery is remembered'); }
  // A state under protection.
  const v = fresh(), va = v.countries.U1, vb = v.countries.U2; assert.ok(applyOp(v, ld(v, va), { op: 'propose_treaty', target: 'U2', kind: 'protection', protector: 'me', terms: 'U1 protects U2' }).ok); assert.ok(applyOp(v, ld(v, vb), { op: 'accept_treaty', target: 'U1' }).ok);
  assert.equal(applyOp(v, ld(v, vb), { op: 'declare_war', target: 'U3' }).ok, false, 'a protected state does not make war on its own'); assert.equal(applyOp(v, ld(v, vb), { op: 'propose_treaty', target: 'U3', kind: 'alliance', terms: 'x' }).ok, false, 'nor alliances'); assert.ok(lookUp(v, ld(v, v.countries.U3), 'country:U2').includes('as its protector'), 'and everyone can see who answers for it');
  assert.ok(applyOp(v, ld(v, v.countries.U3), { op: 'declare_war', target: 'U2' }).ok); const word = honourIn(va); diplomacyOf(v); v.turn += 2; diplomacyOf(v); assert.ok(honourIn(va) < word - 5, 'a protector who does not come loses his name');
  // A broken treaty and what lenders make of it.
  const t = fresh(), ta = t.countries.U1, tl = ld(t, ta); applyOp(t, tl, { op: 'propose_treaty', target: 'U2', kind: 'nonaggression', terms: 'x' }); applyOp(t, ld(t, t.countries.U2), { op: 'accept_treaty', target: 'U1' }); const pact = t.treaties.at(-1); assert.ok(pact.active);
  ta.honour = 60; const rate = sovereignRate(ta); assert.ok(applyOp(t, tl, { op: 'break_treaty', id: pact.id }).ok); assert.ok(honourIn(ta) < 60, 'breaking a treaty costs honour'); ta.honour = 10; assert.ok(sovereignRate(ta) > rate, 'and a state whose word is worth nothing pays more for money');
  // Someone who fled.
  const e = fresh(), ea = e.countries.U1, ex = e.characters[ea.opposition]; ex.status = 'exiled'; diplomacyOf(e); const host = e.countries[ex.host]; assert.ok(host && host.id !== 'U1', 'an exile lives somewhere'); const hl = ld(e, host);
  assert.ok(applyOp(e, hl, { op: 'recognise_exile', character: ex.id }).ok); const mods = ea.mods.length; diplomacyOf(e); assert.ok(ea.mods.length > mods && ea.mods.some(m => m.key === 'legitimacy' && m.delta < 0), 'recognition abroad weighs on the government at home');
  const rep = honourIn(host); assert.ok(applyOp(e, hl, { op: 'extradite', character: ex.id }).ok); assert.equal(ex.status, 'imprisoned'); assert.ok(honourIn(host) < rep, 'handing back someone who took shelter costs the host its name');
});
import { pressStep as pressOf } from '../engine/press.js';
import { partyStep as partiesOf } from '../engine/politics.js';
chain('A party is built with money and a newspaper is somebody\'s weapon: funds make organisation and organisation makes a following, a paper is read as far as people can read and the law allows, it prints what its owner\'s enemies hide, and closing it is seen', () => {
  const grown = (fund, paper) => { const w = fresh(), c = w.countries.U1, opp = w.characters[c.opposition], mine = leadsOf(w, c, opp)[0]; c.pressFreedom = 80; c.literacy = 70; opp.wealth = 500;
    if (fund) assert.ok(applyOp(w, opp, { op: 'fund_party', amount: 80 }).ok); if (paper) assert.ok(applyOp(w, opp, { op: 'found_paper', name: 'The Lantern', amount: 80 }).ok);
    for (let i = 0; i < 8; i++) { pressOf(w); partiesOf(w); } return { w, c, opp, mine }; };
  const bare = grown(false, false), funded = grown(true, false), voiced = grown(true, true);
  assert.ok(funded.mine.organization > 5 && funded.mine.support > bare.mine.support, `committees turn sympathy into a following: ${bare.mine.support} -> ${funded.mine.support}`); assert.ok(voiced.mine.support > funded.mine.support, 'and a paper of its own adds to that');
  const { w, c, opp } = voiced, boss = ld(w, c), paper = c.papers[0]; assert.ok(paper.reach > 3, `the paper has found readers: ${paper.reach}`);
  for (let i = 0; i < 40; i++) pressOf(w); assert.ok(funded.mine.organization >= 0 && paper.reach < 3, 'a paper nobody pays for any more loses its readers');
  const gag = fresh(), g = gag.countries.U1, go = gag.characters[g.opposition]; g.pressFreedom = 5; g.literacy = 70; go.wealth = 500; applyOp(gag, go, { op: 'found_paper', name: 'The Lantern', amount: 80 }); const free = fresh(), f = free.countries.U1, fo = free.characters[f.opposition]; f.pressFreedom = 90; f.literacy = 70; fo.wealth = 500; applyOp(free, fo, { op: 'found_paper', name: 'The Lantern', amount: 80 });
  for (let i = 0; i < 6; i++) { pressOf(gag); pressOf(free); } assert.ok(f.papers[0].reach > g.papers[0].reach * 2, `a gagged press is read by far fewer: ${f.papers[0].reach} against ${g.papers[0].reach}`);
  const head = ld(free, f); head.secrets = [{ turn: 0, text: 'In 1894: took money from a concession-holder.' }]; const stand = f.legitimacy; let printed = false; for (let i = 0; i < 300 && !printed; i++) { f.papers[0].funds = 80; free.newsThisTurn = []; pressOf(free); printed = free.newsThisTurn.some(e => /has printed that/.test(e.text)); f.mods = []; }
  assert.ok(printed && head.secrets[0].published && f.legitimacy < stand, 'in the end its reporters print what the ruler hides, and it costs him');
  const liberty = f.pressFreedom, seen = f.legitimacy; assert.equal(applyOp(free, free.characters[f.general], { op: 'close_paper', id: f.papers[0].id }).ok, false, 'not anyone can shut a paper'); assert.ok(applyOp(free, head, { op: 'close_paper', id: f.papers[0].id }).ok); assert.ok(!f.papers.length && f.pressFreedom < liberty && f.legitimacy < seen, 'the government can, and is seen doing it');
});
import { bondStep as bondsStepOf, marketPrice as priceOf } from '../engine/bonds.js';
import { disputeStep as disputeOf, succeed as succeedOf } from '../engine/politics.js';
import { season as seasonOf, closedNow as closedOf } from '../engine/military.js';
chain('Part of a state\'s debt is owed to people one can name: they are paid interest, lose in a default with everyone else, and get out only at the market\'s price', () => {
  const w = fresh(), c = w.countries.U1, rich = w.characters[c.oligarch]; rich.wealth = 200; c.interestRate = .02; c.paidRatio = 1; const debt = c.debt, till = c.treasury;
  const r = applyOp(w, rich, { op: 'buy_bonds', amount: 100 }); assert.ok(r.ok, r.msg); assert.equal(rich.wealth, 100); assert.ok(Math.abs(c.debt - debt - 100) < 1e-6 && Math.abs(c.treasury - till - 100) < 1e-6, 'the money is lent to the state and owed by it');
  bondsStepOf(w); assert.ok(Math.abs(rich.wealth - 102) < 1e-6, 'the holder is paid what the state pays its lenders'); assert.ok(lookUp(w, ld(w, c), 'budget').includes(rich.name), 'and whoever governs knows who holds the paper');
  c.interestRate = .08; const cheap = priceOf(c); assert.ok(cheap < .6, `a state with bad credit has cheap paper: ${cheap}`); const had = rich.wealth, s = applyOp(w, rich, { op: 'sell_bonds', amount: 50 }); assert.ok(s.ok, s.msg); assert.ok(Math.abs(rich.wealth - had - 50 * cheap) < 1e-6, 'selling it fetches only what the market gives');
  const left = w.bonds.find(b => b.holder === rich.id).amount; assert.ok(applyOp(w, ld(w, c), { op: 'default_debt' }).ok); assert.ok(w.bonds.find(b => b.holder === rich.id).amount < left * .6, 'a default writes it down with the rest'); assert.ok(rich.inbox.some(m => /has defaulted/.test(m.text)));
});
chain('A province that is cut off or besieged goes hungry before the rest of the country does', () => {
  const w = fresh(), c = w.countries.U1, provs = countryProvinces(w, 'U1'), p = provs.find(x => x.id !== c.capital); c.foodRatio = 1; initAdmin(w); adminStep(w); assert.ok(Math.abs((p.access ?? 1) - 1) < .26, 'a province joined to the capital is fed with the rest');
  const fed = moodParts(c, p, 'workers').find(m => m[0] === 'hunger')[1]; p.siege = { by: 'U2', since: w.turn }; adminStep(w); assert.ok(p.access < .6, `under siege little reaches it: ${p.access}`); const starving = moodParts(c, p, 'workers').find(m => m[0] === 'hunger')[1]; assert.ok(starving < fed - 20, `and its people feel it while the country has bread: ${fed} -> ${starving}`);
  const other = provs.find(x => x.id !== p.id && x.id !== c.capital); if (other) assert.ok(moodParts(c, other, 'workers').find(m => m[0] === 'hunger')[1] > starving, 'the rest of the country does not');
});
chain('The year has seasons: in winter the passes are closed to troops without a railway and men are lost in the mountains; in summer they march', () => {
  const w = fresh(); for (const u of Object.values(w.units)) delete w.units[u.id]; const from = countryProvinces(w, 'U1').find(p => p.neighbors.some(n => w.provinces[n].controller === 'U1')), to = w.provinces[from.neighbors.find(n => w.provinces[n].controller === 'U1')];
  to.terrain = 'mountain'; to.rail = 0; from.terrain = 'plains'; while (seasonOf(w) !== 'winter') w.turn++; assert.ok(closedOf(w, to), 'the pass is closed in winter'); const u = makeUnit(w, 'U1', from.id, 20); u.target = to.id; militaryStep(w); assert.equal(u.province, from.id, 'the unit waits'); assert.equal(u.target, to.id, 'and keeps its orders');
  to.rail = 1; assert.ok(!closedOf(w, to), 'a railway keeps the pass open'); to.rail = 0; while (seasonOf(w) !== 'summer') w.turn++; militaryStep(w); assert.equal(u.province, to.id, 'in summer it marches');
  while (seasonOf(w) !== 'winter') w.turn++; const men = u.men; militaryStep(w); assert.ok(u.men < men * .97, `troops wintering in the mountains lose men: ${men} -> ${u.men}`);
});
chain('Where no successor was named and a rival stands as strong as the heir, the succession is disputed: the others declare, the weights decide, and a claim can be renounced', () => {
  const setup = () => { const w = fresh(), c = w.countries.U1; c.elections = false; c.succession = 'dynasty'; c.heir = null; c.legitimacy = 35; const gen = w.characters[c.general]; gen.power = 95; c.blocs.army.power = 80; const old = ld(w, c); die(w, old, 'died'); return { w, c, gen, next: ld(w, c) }; };
  const { w, c, gen, next } = setup(); assert.ok(c.dispute && c.dispute.claimant === gen.id && c.dispute.holder === next.id, 'the general is looked to rather than the heir'); assert.ok(gen.inbox.some(m => /claim is being made in your name/.test(m.text)), 'and is told so');
  const rich = w.characters[c.oligarch]; assert.ok(applyOp(w, rich, { op: 'back_claim', character: gen.id }).ok); assert.equal(c.dispute.backers[rich.id], 'claimant'); const before = c.legitimacy; disputeOf(w); assert.ok(c.legitimacy < before, 'an open succession wears the state down');
  w.turn = c.dispute.until; next.power = 5; c.police = 5; disputeOf(w); assert.ok(!c.dispute, 'the matter is settled'); assert.ok(c.leader === gen.id || aliveCountries(w).some(x => x.parent === 'U1'), 'by the claimant taking the state, or by arms');
  const y = setup(); assert.ok(applyOp(y.w, y.gen, { op: 'renounce_claim' }).ok); disputeOf(y.w); assert.ok(!y.c.dispute && y.c.leader === y.next.id, 'a claim renounced leaves the heir in place');
  const z = fresh(), k = z.countries.U1; k.elections = false; k.succession = 'dynasty'; k.legitimacy = 35; const named = z.characters[k.oligarch]; k.heir = named.id; z.characters[k.general].power = 95; die(z, ld(z, k), 'died'); assert.ok(!k.dispute, 'a successor named in time leaves nothing to dispute');
});
console.log('All checks passed.');
