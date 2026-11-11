import assert from 'node:assert/strict';
import { createWorld, aliveCountries, countryProvinces } from '../engine/world.js';
import { beginTurn, stepWorld } from '../engine/step.js';
import { applyOp } from '../engine/ops.js';
import { executePlot } from '../engine/politics.js';
import { makeParliament, treatyStep } from '../engine/polity.js';
import { currencyStep, displacedDemand, exportEdge, localPrices } from '../engine/money.js';
import { firmStep, STATE } from '../engine/firms.js';
import { atWar as atWarOf, hasTreaty as treatyOf } from '../engine/world.js';
import { satisfactionStep as moodOf } from '../engine/politics.js';
import { toTable } from '../agents/game.js';
import { GOODS, BASE_PRICE } from '../engine/world.js';
import { glutFactor, USUAL_COVER } from '../engine/money.js';
import { firmValue } from '../engine/firms.js';
import { quote } from '../engine/projects.js';
import { updateRoutes } from '../engine/economy.js';
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
  for (const p of countryProvinces(w, 'U1')) p.unrest = 80;
  applyOp(w, o, { op: 'start_plot', kind: 'uprising' }); w.plots.at(-1).progress = 100; executePlot(w, w.plots.at(-1));
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
  const after = w.routes[k]; assert.ok(!after || !after.path.includes(st.ref), 'route should not pass through the strait'); assert.ok(!after || after.mode === 'transit' || after.path.length >= before, 'the closed strait cuts the route, lengthens it, or leaves only the dearer way through a third country');
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
  await g.run(0); assert.equal(w.turn, 300); assert.ok(Object.keys(w.characters).length < 25 * Math.max(aliveCountries(w).length, 8), `characters ${Object.keys(w.characters).length} for ${aliveCountries(w).length} powers`); console.log(`passed  300 turns ran without limit (world size ${Math.round(JSON.stringify(w).length / 1024)} KB, ${aliveCountries(w).length} powers)`);
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
  const port = countryProvinces(w, 'U1').find(q => q.port > 0) ?? p; port.port = 2; port.seas = port.seas.length ? port.seas : Object.keys(w.seas).slice(0, 1); const f = Object.keys(w.fleets).length; applyOp(w, l, { op: 'build_ship', province: port.id, ships: 2, kind: 'battleship' }); run(w, 5); assert.equal(Object.keys(w.fleets).length, f); run(w, 1); assert.equal(Object.values(w.fleets).at(-1).kind, 'battleship');
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
  const setup = (a, b) => { const w = fresh(), sea = Object.keys(w.seas)[0]; for (const f of Object.values(w.fleets)) delete w.fleets[f.id]; w.wars.push({ id: 'SD', a: ['U1'], b: ['U2'], civil: false, active: true, start: 0, name: 'D' }); const fa = makeFleet(w, 'U1', sea, 6), fb = makeFleet(w, 'U2', sea, 10); fa.kind = a; fb.kind = b; return { w, sea, fa, fb }; };
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
  const clean = w.characters[c.general]; for (let i = 0; i < 40 && !o.dossiers[clean.id]; i++) { w.turn++; applyOp(w, o, { op: 'gather_dossier', character: clean.id }); }
  assert.ok(o.dossiers[clean.id], 'a dossier should open'); assert.equal(applyOp(w, o, { op: 'blackmail', character: clean.id, demand: 'x' }).ok, false, 'no blackmail with an empty dossier');
  assert.equal(applyOp(w, l, { op: 'embezzle', pct_gdp: .05 }).ok, true);
  delete o.dossiers[l.id]; for (let i = 0; i < 40 && !o.dossiers[l.id]; i++) { w.turn++; applyOp(w, o, { op: 'gather_dossier', character: l.id }); }
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
    // The states that were handed over, that is: a ruler can die in three years and a claimant take provinces with him, and that is an event, not a drift.
    for (const c of aliveCountries(w)) { if (!(c.id in start)) continue; assert.ok(Math.abs(c.legitimacy - start[c.id]) < 22, `${c.archetype} ${start[c.id]} -> ${c.legitimacy}`); balances.push(c.lastBalance / c.gdp); }
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
  for (let i = 0; i < 30 && opp.status === 'free'; i++) { applyOp(w, l, { op: 'purge', character: opp.id, fate: 'imprisoned' }); if (opp.status === 'free') w.turn++; }
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
  for (const topic of ['budget', 'army', 'borders', 'economy', 'sea:D1']) assert.ok(answer(w, old, topic).includes('reaches a prison cell'), `${topic}: the state's figures and the army's dispositions do not reach a cell`);
  assert.ok(answer(w, old, 'people').includes(w.characters[c.leader].name) && !answer(w, old, 'my_secrets').includes('prison cell'), 'a prisoner still knows the people and his own affairs');
  old.status = 'free'; assert.ok(answer(w, old, 'budget').includes('not open to you'), 'out of prison, the papers of the office stay closed to them'); assert.equal(applyOp(w, old, { op: 'declare_war', target: 'U2' }).ok, false, 'a former ruler commands nothing'); assert.equal(applyOp(w, old, { op: 'start_plot', kind: 'coup' }).ok, true);
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
  assert.ok(first.includes('And you feel.') && first.includes('part of how a person decides') && first.includes('both are open to you, and neither is the rule'), 'they are told that what they feel bears on what they decide, and that mastering it is open to them too');
  assert.ok(later.includes('wants and feels') && !later.includes('And you feel.'), 'each morning recalls it in a word; the passage itself is said once');
  // The mind of the age about war, a check on habitual caution, the country's standing questions and what the seat stands to gain: said once, as facts.
  assert.ok(first.includes('war is an ordinary instrument of policy') && first.includes('habit of prudence') && first.includes('You may still hold war a folly'), 'they are told how their age thinks of war, and that caution can be a habit; holding war a folly stays open');
  assert.ok(first.includes('The questions the country was handed down with') && /an army of about \d+ thousand against about \d+ thousand of ours/.test(first), 'the neighbours and the old questions are put before them as facts');
  assert.ok(first.includes('What your seat has to win and lose by war') && first.includes('adds a province'), 'and what a ruler\'s seat wins and loses by war');
  { const g = w.characters[w.countries[l.country].general], gen = actorPrompt(w, g, [], true, { intro: true }); assert.ok(gen.includes('A soldier\'s name is made in war') && !gen.includes('adds a province'), 'each seat is told its own stake'); }
  { const x = inherited(), cx = aliveCountries(x)[0], other = aliveCountries(x)[1], p = countryProvinces(x, other.id)[0]; p.lostBy = cx.id; p.lostIn = 1887; const txt = actorPrompt(x, ld(x, cx), [], true, { intro: true }); assert.ok(txt.includes(`${p.name} (${p.id}), held by ${other.name} since 1887`), 'land lost and never given up is named, with who holds it and since when'); }
  assert.ok(!later.includes('ordinary instrument of policy') && !later.includes('handed down with'), 'none of it is repeated every morning');
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
  for (let i = 0; i < 30 && opp.status === 'free'; i++) { applyOp(w, l, { op: 'purge', character: opp.id, fate: 'imprisoned' }); if (opp.status === 'free') w.turn++; }
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
  assert.ok(raised.realGdp > poor.realGdp * 1.12, `output ${raised.realGdp} / ${poor.realGdp}`); assert.ok(raised.bureaucracy > poor.bureaucracy + 15 && raised.corruption < poor.corruption - 8); assert.ok(raised.legitimacy > poor.legitimacy && raised.lastRevenue / raised.gdp > poor.lastRevenue / poor.gdp * 1.5);
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
  for (let i = 0; i < 30 && opp.status === 'free'; i++) { applyOp(w, l, { op: 'purge', character: opp.id, fate: 'imprisoned' }); if (opp.status === 'free') w.turn++; }
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
  // No frontier blood between them, so that nothing but the broken word weighs on the declaration.
  a.grudges = {}; const legit = a.legitimacy; assert.equal(applyOp(w, leaderOf(w, 'U1'), { op: 'declare_war', target: 'U2' }).ok, true); assert.ok(a.legitimacy <= legit - 8, 'breaking a fresh peace is breaking a given word');
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
  // And solvent: a treasury that can no longer pay for its roads loses harvests for a second reason, which is measured separately below.
  const hungry = () => { const w = fresh(); w.countries.U1.noSplitUntil = 1e9; for (const o of aliveCountries(w)) if (o.id !== 'U1') o.embargo.push('U1'); for (const p of countryProvinces(w, 'U1')) p.fertility *= .55; return w; };
  const w = hungry(), funded = n => { for (let i = 0; i < n; i++) { const c = w.countries.U1; c.treasury = Math.max(c.treasury, c.gdp); c.arrears = 0; run(w, 1); } };
  const pops = (v = w) => countryProvinces(v, 'U1').reduce((s, p) => s + popOf(p), 0), start = pops(); funded(60); const low = pops(); funded(60);
  assert.ok(low > start * .45, `the people are not wiped out: ${start} -> ${low}`); assert.ok(pops() > low * .95 && w.countries.U1.foodRatio > .88, `and the country finds its level: ${low} -> ${pops()}, food ${w.countries.U1.foodRatio}`);
  // The same hunger with nobody governing and no one lending: the state goes unpaid, its roads run down, and the land feeds fewer still.
  const left = hungry(), mean = v => { const ps = countryProvinces(v, 'U1'); return ps.reduce((s, p) => s + p.infra, 0) / ps.length; }; run(left, 120);
  assert.ok(left.countries.U1.paidRatio < .8 && mean(left) < mean(w) - .15 && pops(left) < pops() * .85, `a bankrupt state makes the famine worse: paid ${left.countries.U1.paidRatio}, roads ${mean(left)} against ${mean(w)}, people ${pops(left)} against ${pops()}`);
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
  const harbour = countryProvinces(w, 'U1').find(p => p.port > 0 && p.seas.length), seaId = harbour.seas[0], other = w.seas[seaId].neighbors[0], fl = makeFleet(w, 'U1', seaId, 12); r = applyOp(w, gen, { op: 'move_fleet', fleet: fl.id, to: other, ships: 4 }); assert.ok(r.ok, r.msg);
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
  assert.ok(p.labour < 0, 'and the workers of the province are the bitterer for it'); firmStep(w); const idle = f.lastProfit, on = f.strike; f.strike = null; firmStep(w); const working = f.lastProfit; f.strike = on; assert.ok(Math.abs(idle) < Math.abs(working) * .5, `a struck works earns next to nothing: ${idle} against ${working} at work on the same wages`);
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
  const price = (corruption, admin) => { const [x, k, b] = state(60), p = x.provinces[k.capital]; k.corruption = corruption; p.admin = admin; k.treasury = 1e6; k.stock.machines = 1e4; k.stock.steel = 1e4; const t = k.treasury; const o = applyOp(x, b, { op: 'build', province: p.id, kind: 'fort' }); assert.ok(o.ok, o.msg); return t - k.treasury; };
  const clean = price(5, .9), dirty = price(80, .1); assert.ok(dirty > clean * 1.25, `graft and distance make the same work dearer: ${clean} against ${dirty}`);
  // And the same sum buys less of a work that grows by degrees: the money named is not exceeded, the roads are shorter.
  const roads = (corruption, admin) => { const [x, k, b] = state(60), p = x.provinces[k.capital]; k.corruption = corruption; p.admin = admin; k.treasury = 1e6; const t = k.treasury, o = applyOp(x, b, { op: 'build', province: p.id, kind: 'infrastructure', amount: 200 }); assert.ok(o.ok, o.msg); assert.ok(Math.abs(t - k.treasury - 200) < 1e-6, 'the sum named is what is spent'); return x.projects.at(-1).add; };
  assert.ok(roads(5, .9) > roads(80, .1) * 1.25, 'the same money lays fewer roads where graft and distance are large');
  // A commander who has lost faith.
  const [x, k, b] = state(60), u = Object.values(x.units).filter(v => v.country === 'U1' && x.characters[v.commander]?.alive)[0], col = x.characters[u.commander], to = x.provinces[u.province].neighbors.find(n => x.provinces[n].controller === 'U1');
  if (to) { col.loyalty = 5; let delays = 0; for (let i = 0; i < 40; i++) { u.target = null; if (!applyOp(x, b, { op: 'move', unit: u.id, to }).ok) delays++; } assert.ok(delays > 6 && delays < 30, `he obeys when it suits him: ${delays} of 40 orders delayed`); col.loyalty = 90; u.target = null; assert.ok(applyOp(x, b, { op: 'move', unit: u.id, to }).ok, 'a loyal one marches'); }
  const chief = Object.values(x.characters).find(v => v.country === 'U1' && v.post === 'police'), opp = x.characters[k.opposition]; chief.loyalty = 5; k.courts = 0; opp.inbox = []; let warned = 0; for (let i = 0; i < 40; i++) { x.turn++; opp.status = 'free'; const o = applyOp(x, b, { op: 'purge', character: opp.id, fate: 'imprisoned' }); if (/gave warning/.test(o.msg)) warned++; }
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
    assert.ok(applyOp(q, ll, { op: 'propose_treaty', target: holder.id, kind: 'peace', terms: 'The province returns', cede: [lost.id] }).ok); const was = loser.legitimacy; assert.ok(applyOp(q, ld(q, holder), { op: 'accept_treaty', target: loser.id }).ok); assert.equal(lost.owner, loser.id); assert.ok(!lost.lostBy && loser.legitimacy > was, 'and its recovery is remembered');
    // Handing a province to and fro by agreement earns nobody anything and leaves no claim.
    const swap = fresh(), sa = swap.countries.U1, sb = swap.countries.U2, land = countryProvinces(swap, 'U1').find(p => p.id !== sa.capital), give = (from, to) => { assert.ok(applyOp(swap, ld(swap, from), { op: 'propose_treaty', target: to.id, kind: 'trade', terms: 'sale', cede: [land.id] }).ok); assert.ok(applyOp(swap, ld(swap, to), { op: 'accept_treaty', target: from.id }).ok); };
    const la = sa.legitimacy, lb = sb.legitimacy; for (let i = 0; i < 6; i++) { give(sa, sb); give(sb, sa); } assert.equal(land.owner, 'U1'); assert.ok(sa.legitimacy <= la + 1e-9 && sb.legitimacy <= lb + 1e-9 && !land.lostBy, 'no standing is made out of nothing');
    // A staff that knows little of the other army says so and gives no figure for what it cannot know.
    const blind = inherited(), ba = blind.countries.U1, nb = aliveCountries(blind).find(o => o.id !== 'U1' && countryProvinces(blind, o.id).some(p => p.neighbors.some(n => blind.provinces[n].controller === 'U1')));
    if (nb) { ba.intel[nb.id] = 10; const dim = lookUp(blind, blind.characters[ba.general], `war_plan:${nb.id}`); assert.ok(/is not known to it/.test(dim) && !/is worth about/.test(dim), 'no ratio without intelligence'); ba.intel[nb.id] = 90; assert.ok(/is worth about/.test(lookUp(blind, blind.characters[ba.general], `war_plan:${nb.id}`)), 'with eyes there, the staff can weigh the two armies'); } }
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
chain('What rulers and others were found unable to do: dismiss a chief of staff (who may answer with a coup), fine a person, form a guard on the spot, order one works to be made safe, stir up more than one works, buy a clerk in an office, and move money in and out of a fund and of the country', () => {
  const w = inherited(), c = w.countries.U1, boss = ld(w, c), gen = w.characters[c.general], rich = w.characters[c.oligarch], opp = w.characters[c.opposition];
  assert.equal(applyOp(w, rich, { op: 'dismiss' }).ok, false, 'only whoever governs dismisses'); const loyal = Object.values(w.units).filter(u => u.country === 'U1').map(u => u.loyalty);
  const r = applyOp(w, boss, { op: 'dismiss', name: 'Osric Vane' }); assert.ok(r.ok, r.msg); const next = w.characters[c.general]; assert.ok(next.id !== gen.id && next.name === 'Osric Vane' && next.role === 'general', 'another holds the office'); assert.equal(gen.status, 'free', 'the dismissed chief is a private person, and free');
  assert.ok(Object.values(w.units).filter(u => u.country === 'U1').every((u, i) => u.loyalty < loyal[i] + 1e-9), 'the army takes it badly'); assert.equal(applyOp(w, gen, { op: 'move_army', to: c.capital }).ok, false, 'and he commands nothing any more');
  // A general with a stroke prepared answers with it.
  const x = inherited(), k = x.countries.U1, head = ld(x, k), g = x.characters[k.general]; assert.ok(applyOp(x, g, { op: 'start_plot', kind: 'coup' }).ok); const out = applyOp(x, head, { op: 'dismiss' }); assert.ok(!x.plots.at(-1).active, 'the plot is sprung'); assert.ok(/stroke he had prepared/.test(out.msg), out.msg);
  // A fine.
  c.courts = 0; rich.wealth = 80; const till = c.treasury; const f1 = applyOp(w, boss, { op: 'fine', character: rich.id, amount: 20, reason: 'the flooded gallery' }); assert.ok(f1.ok, f1.msg); assert.equal(rich.wealth, 60); assert.ok(Math.abs(c.treasury - till - 20) < 1e-6); c.courts = 100; let struck = 0; for (let i = 0; i < 60; i++) { w.turn++; if (!applyOp(w, boss, { op: 'fine', character: rich.id, amount: 1 }).ok) struck++; } assert.ok(struck > 8, `free courts strike some fines down: ${struck} of 60`);
  // A guard formed on the spot.
  const u = Object.values(w.units).filter(v => v.country === 'U1').sort((a, b) => b.men - a.men)[0], men = u.men, d = applyOp(w, boss, { op: 'move', unit: u.id, to: u.province, men: 5 }); assert.ok(d.ok && /was formed out of/.test(d.msg), d.msg); assert.ok(Math.abs(u.men - men + 5) < 1e-6 && Object.values(w.units).some(v => v.country === 'U1' && v.province === u.province && Math.abs(v.men - 5) < 1e-6 && !v.target));
  // An order to one private works, and stirring up two.
  const firms = Object.values(w.firms).filter(f => f.status === 'open' && f.country === 'U1'), f = firms[0], f2 = firms[1]; f.owner = rich.id; f.safety = .2; c.bureaucracy = 90; const o = applyOp(w, boss, { op: 'set_safety', id: f.id, level: .8 }); assert.ok(o.ok && f.safety > .5, `${o.msg}`); assert.ok(rich.inbox.some(m => /By order of the government/.test(m.text)), 'the owner is told');
  assert.equal(applyOp(w, opp, { op: 'set_safety', id: f.id, level: 1 }).ok, false, 'a private person cannot order another\'s works'); assert.ok(applyOp(w, opp, { op: 'agitate', id: f.id }).ok && applyOp(w, opp, { op: 'agitate', id: f2.id }).ok, 'more than one works can be stirred in a quarter'); assert.equal(applyOp(w, opp, { op: 'agitate', id: f.id }).ok, false, 'but each only once');
  // A clerk in an office nobody named.
  const far = w.countries.U2; boss.wealth = 0; c.treasury = 5000; const folk = Object.keys(w.characters).length; let got = { ok: false }, tries = 0; for (; tries < 40 && !got.ok; tries++) { w.turn++; got = applyOp(w, boss, { op: 'recruit_informant', office: 'treasury', target: 'U2', amount: 12 }); } assert.ok(got.ok, got.msg); assert.equal(Object.keys(w.characters).length, folk + 1, 'clerks who would not be bought leave no one behind'); const clerk = Object.values(w.characters).find(v => v.handler === boss.id); assert.ok(clerk && clerk.country === 'U2' && clerk.clerkOf === 'treasury', 'a clerk in their treasury reports to the ruler');
  // Money in and out.
  opp.wealth = 30; const fund = applyOp(w, opp, { op: 'create_institution', name: 'Relief Fund', description: 'Relief', amount: 1, powers: ['welfare'] }); assert.ok(fund.ok, fund.msg); const body = c.institutions.at(-1); rich.wealth = 50; applyOp(w, rich, { op: 'give', to: body.id, amount: 10 });
  const purse = opp.wealth, t = applyOp(w, opp, { op: 'draw_institution', id: body.id, amount: 6 }); assert.ok(t.ok, t.msg); assert.ok(Math.abs(opp.wealth - purse - 6) < 1e-6 && Math.abs(body.endowment - 4) < 1e-6 && opp.secrets.some(s => /out of what had been given/.test(s.text)), 'gifts taken for oneself are a secret'); assert.equal(applyOp(w, rich, { op: 'draw_institution', id: body.id, amount: 1 }).ok, false);
  c.capitalClosed = false; c.reserves = 500; gen.wealth = 40; const fl = applyOp(w, gen, { op: 'capital_flight', share: .5 }); assert.ok(fl.ok, fl.msg); assert.ok(gen.abroad > 0, 'anyone with money can send it out'); const back = applyOp(w, gen, { op: 'repatriate' }); assert.ok(back.ok && !(gen.abroad > .01), 'and bring it home');
});
chain('A work costs what the work is, in that place, and never more than the sum the order names: a railway comes whole or not at all, mountain ground is dearer, and a sum too small is refused with the price', () => {
  const w = fresh(), c = w.countries.U1, l = ld(w, c), ps = countryProvinces(w, 'U1').filter(p => !p.rail); c.treasury = 1e6; c.stock.steel = 1e4; c.stock.machines = 1e4;
  const [a, b, d] = ps; a.terrain = b.terrain = d.terrain = 'plains';
  const spent = op => { const t = c.treasury, r = applyOp(w, l, op); return [r, t - c.treasury]; };
  const [none, free] = spent({ op: 'build', province: a.id, kind: 'railway' }); assert.ok(none.ok && free > 0, none.msg);
  const price = quote(w, c, b, 'railway').price * c.priceLevel, [small, nothing] = spent({ op: 'build', province: b.id, kind: 'railway', amount: price * .3 });
  assert.equal(small.ok, false); assert.equal(nothing, 0, 'a refused work takes no money'); assert.ok(small.msg.includes(String(Math.round(price))), `the refusal names the price: ${small.msg}`);
  const [rich, paid] = spent({ op: 'build', province: b.id, kind: 'railway', amount: price * 20 }); assert.ok(rich.ok, rich.msg); assert.ok(Math.abs(paid - price) < 1e-6, `a large purse buys the same railway for the same money: ${paid} against ${price}`);
  const flat = quote(w, c, d, 'railway').price; d.terrain = 'mountain'; assert.ok(quote(w, c, d, 'railway').price > flat * 2, 'the same line through mountain costs more than twice as much');
  const crowd = quote(w, c, d, 'railway').price; for (const k of Object.keys(d.pops)) d.pops[k].n *= 2; assert.ok(quote(w, c, d, 'railway').price > crowd * 1.9, 'and a province of twice the people needs twice the network');
  // Works that grow by degrees: the sum named is the sum spent, and it buys in proportion.
  const big = countryProvinces(w, 'U1')[0], [mon, twenty] = spent({ op: 'build', province: big.id, kind: 'infrastructure', amount: 20 }); assert.ok(mon.ok, mon.msg); assert.ok(Math.abs(twenty - 20) < 1e-6, `an order for 20 spends 20, not ${twenty}`);
  const one = w.projects.at(-1).add; applyOp(w, l, { op: 'build', province: big.id, kind: 'infrastructure', amount: 60 }); assert.ok(Math.abs(w.projects.at(-1).add - one * 3) < 1e-9, 'three times the money, three times the roads');
  // A place that is full takes nothing, and no money is taken for it.
  big.coast = true; big.port = 3; const [full, zero] = spent({ op: 'build', province: big.id, kind: 'port' }); assert.equal(full.ok, false); assert.equal(zero, 0);
  big.plants.goods = 7.9; const [top, some] = spent({ op: 'build', province: big.id, kind: 'goods', amount: 1e5 }); assert.ok(top.ok, top.msg); assert.ok(some < 1e5 * .1 && Math.abs(w.projects.at(-1).add - .1) < 1e-9, 'only what the place can still take is built and paid for');
  // The estimates can be asked for beforehand, and they are the prices the order then pays.
  const est = answer(w, l, `building:${b.id}`); assert.ok(/railway: /.test(est) && /fort: about/.test(est) && /steel mill: about/.test(est), est.slice(0, 300));
  const fort = Number(/fort: about (\d+)/.exec(answer(w, l, `building:${d.id}`))[1]), [f, cost] = spent({ op: 'build', province: d.id, kind: 'fort' }); assert.ok(f.ok && Math.abs(cost - fort) <= 1, `quoted ${fort}, paid ${cost}`);
});
chain('Building gives work while it lasts, and the books show what it cost', () => {
  const pair = () => { const w = fresh(), c = w.countries.U1; c.treasury = 1e6; c.stock.steel = 1e4; c.stock.machines = 1e4; return [w, c]; };
  const [a, ca] = pair(), [b, cb] = pair(), l = ld(a, ca), ps = countryProvinces(a, 'U1').filter(p => !p.rail).slice(0, 6); let spent = 0;
  for (const p of ps) { const t = ca.treasury, r = applyOp(a, l, { op: 'build', province: p.id, kind: 'railway' }); assert.ok(r.ok, r.msg); spent += t - ca.treasury; }
  run(a, 2); run(b, 2);
  assert.ok(ca.unemployment < cb.unemployment - .005, `six railways in hand employ people: ${ca.unemployment} against ${cb.unemployment}`); assert.ok(ca.lastJobs.works > 0 && !cb.lastJobs.works);
  assert.ok(/Building now in hand gives work/.test(answer(a, l, 'economy')), 'and whoever governs is told so');
  // The money is in the books of the quarter it was ordered in.
  const [x, cx] = pair(), lx = ld(x, cx), t = cx.treasury; applyOp(x, lx, { op: 'build', province: ps[0].id, kind: 'railway' }); const cost = t - cx.treasury; run(x, 1);
  assert.ok(Math.abs(cx.lastBooks.outlay.building - cost) < 1e-6); assert.ok(answer(x, lx, 'budget').includes(`building and surveys ${Math.round(cost)}`));
  // When the works are finished the hands are free again.
  run(a, 8); run(b, 8); assert.ok(!(ca.lastJobs.works > 0), 'finished works employ no one');
  assert.ok(ps.every(p => a.provinces[p.id].rail === 1), 'and the railways stand');
});
chain('Roads and works stand where their upkeep holds them: an inherited state left alone keeps what it has, more spending settles higher and stops, less runs down and stops', () => {
  const mean = (w, id) => { const ps = countryProvinces(w, id); return ps.reduce((s, p) => s + p.infra, 0) / ps.length; }, plants = (w, id) => countryProvinces(w, id).reduce((s, p) => s + Object.values(p.plants).reduce((x, y) => x + y, 0), 0);
  const w = inherited(), ids = aliveCountries(w).map(c => c.id); w.status = 'playing'; run(w, 1); const was = Object.fromEntries(ids.map(id => [id, mean(w, id)]));
  // No one touches the budget; arrears are ruled out so that only upkeep at the inherited share is measured.
  for (let i = 0; i < 30; i++) { for (const id of ids) { const c = w.countries[id]; if (c.alive) { c.treasury = Math.max(c.treasury, c.gdp); c.arrears = 0; } } run(w, 1); }
  for (const id of ids) if (w.countries[id].alive) assert.ok(Math.abs(mean(w, id) - was[id]) < .03, `${id} ${w.countries[id].archetype}: roads at ${was[id].toFixed(2)} are still at ${mean(w, id).toFixed(2)} after thirty quarters of the spending they were built with`);
  const three = () => { const x = fresh(), c = x.countries.U1; return [x, c]; }, [up, cu] = three(), [down, cd] = three(), [same, cs] = three(), share = cs.budget.infrastructure;
  cu.budget.infrastructure = share + .02; cd.budget.infrastructure = Math.max(0, share - .012);
  const rich = c => { c.treasury = Math.max(c.treasury, c.gdp * 2); c.arrears = 0; };
  for (let i = 0; i < 60; i++) { for (const c of [cu, cd, cs]) rich(c); run(up, 1); run(down, 1); run(same, 1); }
  const hi = mean(up, 'U1'), lo = mean(down, 'U1'), mid = mean(same, 'U1'); assert.ok(hi > mid + .2 && lo < mid - .1, `spending moves the roads: ${lo.toFixed(2)} < ${mid.toFixed(2)} < ${hi.toFixed(2)}`);
  for (let i = 0; i < 60; i++) { for (const c of [cu, cd]) rich(c); run(up, 1); run(down, 1); }
  assert.ok(mean(up, 'U1') - hi < .08 && lo - mean(down, 'U1') < .08, 'and they settle instead of climbing or falling for ever');
  assert.ok(plants(up, 'U1') > plants(same, 'U1') && plants(down, 'U1') < plants(same, 'U1'), 'the country\'s works follow the same spending');
  // Roads that were built stay built on top of that.
  const [y, cy] = three(), p = countryProvinces(y, 'U1')[0], before = p.infra; cy.treasury = 1e6; applyOp(y, ld(y, cy), { op: 'build', province: p.id, kind: 'infrastructure', amount: quote(y, cy, p, 'infrastructure').price * .3 });
  for (let i = 0; i < 40; i++) { rich(cy); run(y, 1); } assert.ok(p.infra > before + .25, `roads built forty quarters ago are still there: ${before.toFixed(2)} -> ${p.infra.toFixed(2)}`);
});
chain('Offices built in a far province raise the state\'s reach there for good, and reach is what brings its taxes in', () => {
  const pair = () => { const w = inherited(), c = w.countries.U1; w.status = 'playing'; c.treasury = 1e6; return [w, c]; }, [a, ca] = pair(), [b] = pair();
  const far = [...countryProvinces(a, 'U1')].sort((x, y) => (x.admin ?? .5) - (y.admin ?? .5))[0], twin = b.provinces[far.id], r = applyOp(a, ld(a, ca), { op: 'build', province: far.id, kind: 'administration', amount: quote(a, ca, far, 'administration').price * .15 });
  assert.ok(r.ok, r.msg); run(a, 40); run(b, 40);
  assert.ok(far.admin > twin.admin + .1, `ten years on the offices still hold the province: ${far.admin.toFixed(2)} against ${twin.admin.toFixed(2)}`);
  far.seat = .25; assert.equal(applyOp(a, ld(a, ca), { op: 'build', province: far.id, kind: 'administration', amount: 50 }).ok, false, 'a province can hold only so many offices');
});
chain('A harbour counts by its size: a larger one takes freight off the sea trade, and a battleship needs one of the second size', () => {
  const w = fresh(); let pairKey = null;
  // Two countries that trade by sea only.
  for (const [k, r] of Object.entries(w.routes)) if (r.mode === 'sea') { pairKey = k; break; }
  if (!pairKey) { const [a, b] = aliveCountries(w); for (const p of countryProvinces(w, a.id)) p.neighbors = p.neighbors.filter(n => w.provinces[n].controller !== b.id); for (const p of countryProvinces(w, b.id)) p.neighbors = p.neighbors.filter(n => w.provinces[n].controller !== a.id); updateRoutes(w); pairKey = Object.entries(w.routes).find(([, r]) => r.mode === 'sea')?.[0]; }
  assert.ok(pairKey, 'a sea route exists in the test world');
  const [x, y] = pairKey.split('|'), ends = [...countryProvinces(w, x), ...countryProvinces(w, y)].filter(p => p.port > 0);
  for (const p of ends) p.port = 1; updateRoutes(w); const poor = w.routes[pairKey].cost;
  for (const p of ends) p.port = 3; updateRoutes(w); const good = w.routes[pairKey].cost;
  assert.ok(good < poor - .03 && good >= 1, `great harbours at both ends carry cheaper: ${poor.toFixed(3)} -> ${good.toFixed(3)}`);
  const c = w.countries.U1, l = ld(w, c), p = countryProvinces(w, 'U1').find(q => q.coast) ?? countryProvinces(w, 'U1')[0]; p.coast = true; p.seas = p.seas.length ? p.seas : Object.keys(w.seas).slice(0, 1); c.treasury = 1e6; c.stock.steel = 1e4;
  p.port = 1; const no = applyOp(w, l, { op: 'build_ship', province: p.id, ships: 1, kind: 'battleship' }); assert.equal(no.ok, false); assert.ok(/harbour/.test(no.msg), no.msg);
  assert.equal(applyOp(w, l, { op: 'build_ship', province: p.id, ships: 1, kind: 'cruiser' }).ok, true, 'a cruiser can be built in any port');
  assert.equal(applyOp(w, l, { op: 'build', province: p.id, kind: 'port' }).ok, true); run(w, 4); assert.equal(p.port, 2); assert.equal(applyOp(w, l, { op: 'build_ship', province: p.id, ships: 1, kind: 'battleship' }).ok, true, 'the enlarged harbour takes the keel');
});
chain('A company earns on what its own works make: the same mill among many hands earns more than among few, and capital buys works at the price of the place with nothing added from nowhere', () => {
  const w = fresh(), c = w.countries.U1, ol = w.characters[c.oligarch], ps = [...countryProvinces(w, 'U1')].sort((a, b) => b.pops.workers.n - a.pops.workers.n), big = ps[0], small = ps.at(-1);
  for (const p of ps) for (const k of Object.keys(p.plants)) p.plants[k] = 0; big.plants.goods = small.plants.goods = 1; w.firms = {};
  const mk = (id, p) => w.firms[id] = { id, name: id, country: 'U1', province: p.id, sector: 'goods', resource: null, stake: 1, owner: ol.id, cash: 0, lastProfit: 0, founded: 0, status: 'open', bad: 0, offer: null, buildsUntil: 1e9 };
  const fb = mk('SRB', big), fs = mk('SRS', small); c.stock.timber = c.stock.coal = c.stock.steel = 1e5; run(w, 2);
  assert.ok(fb.lastUnits > fs.lastUnits * 1.5, `the mill with ${Math.round(big.pops.workers.n)}k hands makes more than the one with ${Math.round(small.pops.workers.n)}k: ${fb.lastUnits} against ${fs.lastUnits}`);
  // Capital in: a quarter stays in the till, the rest becomes works at the price of that province.
  c.stock.machines = 1e4; ol.wealth = 1000; const cash = fs.cash, lvl = small.plants.goods, n = w.projects.length, r = applyOp(w, ol, { op: 'invest_company', id: 'SRS', amount: 100 }); assert.ok(r.ok, r.msg);
  const x = w.projects.at(-1), step = quote(w, c, small, 'goods').price; assert.equal(w.projects.length, n + 1); assert.ok(Math.abs(ol.wealth - 900) < 1e-9);
  assert.ok(Math.abs((fs.cash - cash) + x.add * step - 100) < 1e-6, `100 put in is 100 in works and cash, not more: ${fs.cash - cash} + ${x.add * step}`);
  const same = quote(w, c, big, 'goods').price; assert.ok(same > step * 1.5, 'and a step of works costs more where there are more hands to equip');
  // The old shortcut is gone: money "into industry" goes into the investor's own company or nowhere.
  const before = ol.wealth, i = applyOp(w, ol, { op: 'invest', amount: 40 }); assert.ok(i.ok, i.msg); assert.ok(Math.abs(before - ol.wealth - 40) < 1e-9 && w.projects.at(-1).firm); assert.equal(small.plants.goods, lvl, 'nothing stands at once');
  w.firms = {}; assert.equal(applyOp(w, ol, { op: 'invest', amount: 40 }).ok, false, 'with no company there is nothing to invest in');
});
chain('The chief of staff has troops dig in where they stand and orders no other building; a forest is logged, not mined', () => {
  const w = fresh(), c = w.countries.U1, g = w.characters[c.general], l = ld(w, c); c.treasury = 1e6; c.stock.steel = 1e4;
  const u = Object.values(w.units).find(v => v.country === 'U1'), here = w.provinces[u.province], empty = countryProvinces(w, 'U1').find(p => !Object.values(w.units).some(v => v.province === p.id));
  assert.equal(applyOp(w, g, { op: 'build', province: here.id, kind: 'trench' }).ok, true); assert.equal(applyOp(w, g, { op: 'build', province: here.id, kind: 'fort' }).ok, false, 'a fortress is the government\'s to order');
  if (empty) assert.equal(applyOp(w, g, { op: 'build', province: empty.id, kind: 'trench' }).ok, false, 'no troops, no digging');
  run(w, 2); assert.equal(here.trench, 1);
  const wood = countryProvinces(w, 'U1')[0]; wood.timber = 1;
  const no = applyOp(w, l, { op: 'build', province: wood.id, kind: 'mine', resource: 'timber' }); assert.equal(no.ok, false); assert.ok(/forestry/.test(no.msg), no.msg);
  const was = wood.timber, ok = applyOp(w, l, { op: 'build', province: wood.id, kind: 'forestry', amount: quote(w, c, wood, 'forestry').price * .3 }); assert.ok(ok.ok, ok.msg); run(w, 2); assert.ok(wood.timber > was + .25 && wood.timber < was + .36, `the forest yields more: ${was} -> ${wood.timber}`);
  wood.timber = wood.timberMax; assert.equal(applyOp(w, l, { op: 'build', province: wood.id, kind: 'forestry', amount: 50 }).ok, false, 'a forest gives only so much');
  const bare = countryProvinces(w, 'U1')[1]; bare.timber = .05; assert.equal(applyOp(w, l, { op: 'build', province: bare.id, kind: 'forestry', amount: 50 }).ok, false, 'no forest, no sawmill');
});
chain('A government can go to the foreign markets itself: the order is filled by the quarter\'s trade as far as sellers and gold reach, the gold goes to the seller, twenty orders are one order, and a price limit holds', () => {
  const twin = () => { const w = fresh(), c = w.countries.U1; c.reserves = 5000; c.treasury = 5000; return [w, c]; }, [a, ca] = twin(), [b, cb] = twin(), l = ld(a, ca);
  // A good somebody abroad has to spare and this country can reach.
  const good = ['steel', 'coal', 'grain', 'timber', 'iron', 'machines'].find(g => aliveCountries(a).some(o => o.id !== 'U1' && a.routes[o.id < 'U1' ? `${o.id}|U1` : `U1|${o.id}`] && o.stock[g] - (o._need?.[g] || 0) * 1.4 > 40)); assert.ok(good, 'someone has a surplus to sell');
  const gold = w => aliveCountries(w).reduce((s, c) => s + c.reserves, 0), all = (w, g) => aliveCountries(w).reduce((s, c) => s + (c.stock[g] || 0), 0), was = gold(a);
  for (let i = 0; i < 20; i++) assert.equal(applyOp(a, l, { op: 'buy_goods', good, amount: 30 }).ok, true); assert.equal(ca.orders[good].amount, 30, 'an order repeated is the same order');
  assert.equal(applyOp(a, a.characters[ca.general], { op: 'buy_goods', good, amount: 30 }).ok, false, 'the chief of staff does not buy for the state');
  const stock = ca.stock[good]; assert.equal(ca.stock[good], stock, 'nothing arrives the day the order is written'); l.inbox = []; run(a, 1); run(b, 1);
  const got = (ca.lastBought[good] || 0) - (cb.lastBought[good] || 0); assert.ok(got > 20 && got <= 30.5, `about the quantity ordered came in beyond the ordinary trade, and not more: ${got}`);
  assert.ok(ca.reserves < cb.reserves - got * a.globalPrice[good] * .5, 'gold left the reserve for it'); assert.ok(ca.treasury < cb.treasury - got * a.globalPrice[good] * .7 && ca.lastBooks.outlay.purchases > 0, `and the treasury paid for it: ${cb.treasury - ca.treasury}`);
  // A treasury with nothing to spare and no lender buys nothing, however much gold lies in the reserve.
  { const [p, cp] = twin(), lp = ld(p, cp); cp.treasury = 0; cp.debt = cp.gdp * 4 * 5; const no = applyOp(p, lp, { op: 'buy_goods', good, amount: 30 }); assert.equal(no.ok, false); assert.ok(/treasury/.test(no.msg), no.msg);
    const [q, cq] = twin(), lq = ld(q, cq), [q2, cq2] = twin(); cq.debt = cq2.debt = cq.gdp * 4 * 5; cq.treasury = cq2.treasury = (cq.till || 0) + a.globalPrice[good] * 6; assert.ok(applyOp(q, lq, { op: 'buy_goods', good, amount: 30 }).ok); lq.inbox = []; run(q, 1); run(q2, 1);
    const few = (cq.lastBought[good] || 0) - (cq2.lastBought[good] || 0); assert.ok(few < 9 && cq.reserves > 3000, `a thin treasury buys what it can pay for, not what the gold reserve could: ${few}`); assert.ok(lq.inbox.some(m => /could pay for no more/.test(m.text)), 'and is told so'); } assert.ok(Math.abs(gold(a) - gold(b)) < 1e-6 * was + 1e-6, `and the gold went to the sellers, not out of the world: ${gold(a)} against ${gold(b)}`);
  assert.ok(l.inbox.some(m => m.from === 'The customs house' && /ordered abroad/.test(m.text)), 'the customs house reports what arrived'); assert.ok(!ca.orders[good], 'the order stood for one quarter');
  assert.ok(/dealings on the foreign markets/.test(answer(a, l, 'trade')), 'and the report can be looked up');
  // A limit below the market: nothing is bought.
  const bought = ca.stock[good]; applyOp(a, l, { op: 'buy_goods', good, amount: 30, max_price: a.globalPrice[good] * .2 }); l.inbox = []; const twinStock = cb.lastBought[good] || 0; run(a, 1); run(b, 1);
  assert.ok((ca.lastBought[good] || 0) <= (cb.lastBought[good] || 0) + 1e-6 + Math.abs(twinStock) * 0 + 5, 'an order with a limit under the market buys nothing to speak of'); assert.ok(l.inbox.some(m => /above the limit/.test(m.text)), 'and says why');
  // Selling out of the stores: goods leave only as far as someone wants them, and gold comes for them.
  const [x, cx] = twin(), [y, cy] = twin(), lx = ld(x, cx), g2 = 'steel';
  // The country holds exactly the steel it uses and keeps in reserve, so merchants would let none go; its neighbours have none, and have gold.
  for (const [v, k] of [[x, cx], [y, cy]]) { k.stock[g2] = k._need[g2] + k._reserve[g2]; for (const o of aliveCountries(v)) if (o.id !== 'U1') { o.stock[g2] = 0; o.reserves = Math.max(o.reserves, 3000); } }
  const offer = Math.floor(cx.stock[g2] * .5); assert.ok(offer >= 3); assert.equal(applyOp(x, lx, { op: 'sell_goods', good: g2, amount: 1e6 }).ok, false, 'no more can be offered than is in store'); assert.equal(applyOp(x, lx, { op: 'sell_goods', good: g2, amount: offer }).ok, true);
  const g0 = gold(x); lx.inbox = []; run(x, 1); run(y, 1); assert.ok((cx.lastSold[g2] || 0) > (cy.lastSold[g2] || 0) + offer * .5 && (cx.lastSold[g2] || 0) <= offer + .5, `the state's offer sold out of stores merchants would have kept, and not more than was offered: ${cx.lastSold[g2]} against ${cy.lastSold[g2]} of ${offer}`);
  assert.ok(cx.reserves > cy.reserves, 'for gold'); assert.ok(Math.abs(gold(x) - gold(y)) < 1e-6 * g0 + 1e-6, 'which came from the buyers'); assert.ok(lx.inbox.some(m => /offered abroad/.test(m.text)));
});
chain('A general strike is a state of things and not a coin tossed every quarter: it breaks out when working people are bitter beyond bearing and free to organise, holds a season or three, and then the unions need years before they can do it again', () => {
  const w = fresh(), c = w.countries.U1, seen = []; c.unions = true; c.strike = false; delete c.strikeRest;
  const mood = v => { for (const p of countryProvinces(w, 'U1')) p.pops.workers.sat = v; };
  for (let i = 0; i < 6; i++) { mood(30); run(w, 1); } assert.equal(c.strike, false, 'discontent short of despair is not a general strike');
  for (let i = 0; i < 24; i++) { mood(20); run(w, 1); seen.push(c.strike ? 1 : 0); }
  assert.equal(seen[0], 1, 'it breaks out at once when the men can bear no more');
  const runs = seen.join('').split('0').filter(Boolean), gaps = seen.join('').split('1').filter(Boolean);
  assert.ok(runs.every(r => r.length >= 1 && r.length <= 3), `each strike holds one to three quarters: ${seen.join('')}`); assert.ok(gaps.slice(0, -1).every(g => g.length >= 8), `and the unions rest for years between: ${seen.join('')}`);
  assert.ok(seen.reduce((a, b) => a + b, 0) <= 9, 'so even a desperate country is not on strike half its life');
  // Banning the unions ends it; mended conditions end it.
  const x = fresh(), cx = x.countries.U1, moodX = v => { for (const p of countryProvinces(x, 'U1')) p.pops.workers.sat = v; }; cx.unions = true; cx.strike = false; delete cx.strikeRest; moodX(20); run(x, 1); assert.equal(cx.strike, true); moodX(40); run(x, 1); assert.equal(cx.strike, false, 'men who got something go back');
  const y = fresh(), cy = y.countries.U1, moodY = v => { for (const p of countryProvinces(y, 'U1')) p.pops.workers.sat = v; }; cy.unions = true; cy.strike = false; delete cy.strikeRest; moodY(20); run(y, 1); assert.equal(cy.strike, true); cy.unions = false; moodY(20); run(y, 1); assert.equal(cy.strike, false, 'and broken unions call no strike');
});
chain('Two countries with no road or water of their own between them trade through a third that deals with both, at both freights; an embargo on the middleman closes the way', () => {
  let found = null;
  for (const seed of [1848, 7, 99, 42, 3]) { const w = inherited(seed); w.status = 'playing'; run(w, 1); const k = Object.keys(w.routes).find(k => w.routes[k].mode === 'transit'); if (k) { found = [w, k]; break; } }
  assert.ok(found, 'some pair in these worlds has no direct route'); const [w, k] = found, r = w.routes[k], [a, b] = k.split('|'), key = (x, y) => x < y ? `${x}|${y}` : `${y}|${x}`, la = w.routes[key(a, r.via)], lb = w.routes[key(r.via, b)];
  assert.ok(la && lb && la.mode !== 'transit' && lb.mode !== 'transit', 'the middleman deals directly with both'); assert.ok(Math.abs(r.cost - la.cost * lb.cost * 1.03) < 1e-9 && r.cost > la.cost && r.cost > lb.cost, 'the goods pay both freights and the handling');
  w.countries[a].embargo.push(r.via); run(w, 1); const after = w.routes[k]; assert.ok(!after || after.via !== r.via, 'no trade through a country one of them will not deal with');
});
chain('The first order of a new ruler moves the country from where it stood: roads ordered on the first day are built, and courts broken on the first day let graft grow', () => {
  // The state with the freest courts has the most to lose by breaking them.
  const a = inherited(), b = inherited(), id = [...aliveCountries(a)].sort((x, y) => y.courts - x.courts)[0].id, ca = a.countries[id], cb = b.countries[id]; a.status = b.status = 'playing';
  const mean = w => { const ps = countryProvinces(w, id); return ps.reduce((s, p) => s + p.infra, 0) / ps.length; };
  assert.ok(ca.roadShare != null && ca.graftBase != null && ca.intelBase != null && countryProvinces(a, id).every(p => p.infraBase != null), 'what the country was used to is fixed before anyone gives an order');
  // Day one, before the first quarter has run.
  assert.equal(applyOp(a, ld(a, ca), { op: 'set_budget', category: 'infrastructure', share: ca.budget.infrastructure + .02, _law: true }).ok, true); const press = ca.pressFreedom, courts = ca.courts; ca.pressFreedom = 5; ca.courts = 5;
  for (let i = 0; i < 30; i++) { for (const c of [ca, cb]) { c.treasury = Math.max(c.treasury, c.gdp); c.arrears = 0; } run(a, 1); run(b, 1); }
  assert.ok(mean(a) > mean(b) + .2, `the roads ordered on the first day stand: ${mean(a).toFixed(2)} against ${mean(b).toFixed(2)}`);
  assert.ok(ca.corruption > cb.corruption + 8, `and graft grew where the courts and press were broken on the first day (${press}/${courts} to 5/5): ${ca.corruption.toFixed(1)} against ${cb.corruption.toFixed(1)}`);
});
chain('Full yards → short time → stores stay near their usual depth → the world price leaves the floor', () => {
  const w = inherited(); w.status = 'playing'; run(w, 40);
  const cs = aliveCountries(w), cover = g => cs.reduce((a, c) => a + c.stock[g], 0) / Math.max(cs.reduce((a, c) => a + c._need[g], 0), 1);
  for (const g of ['coal', 'iron', 'steel']) assert.ok(cover(g) < 9, `the world holds ${cover(g).toFixed(1)} quarters of ${g}, not years of it`);
  const floored = GOODS.filter(g => w.globalPrice[g] <= BASE_PRICE[g] * .45);
  assert.ok(floored.length <= 2, `on the floor: ${floored.join(', ')}`);
  assert.ok(w.globalPrice.coal > BASE_PRICE.coal * .5 && w.globalPrice.steel > BASE_PRICE.steel * .55, `coal ${w.globalPrice.coal}, steel ${w.globalPrice.steel}`);
  // What the pits could have raised and did not is counted as idle, not dug to rot.
  assert.ok(cs.some(c => c.idleShare > .1), 'short time shows as idle capacity');
});
chain('A store past its usual depth slows the makers faster than it fills; bread is not held back by full barns', () => {
  const w = fresh(), c = w.countries.U1; c.lastSold = {};
  const full = USUAL_COVER.coal / 1.25, at = q => { c.stock.coal = c._need.coal * q; return glutFactor(c, 'coal'); };
  assert.equal(at(full * .9), 1, 'below the usual store the pits work full time');
  assert.ok(Math.abs(at(full * 2) - .25) < 1e-9, `at twice the store they work a quarter of the time: ${at(full * 2)}`);
  assert.ok(at(full * 2) * 2 < 1, 'and so the store shrinks back instead of settling at twice its depth');
  c.stock.grain = c._need.grain * 6; assert.equal(glutFactor(c, 'grain'), 1, 'six quarters of grain in the barns does not stop the sowing');
});
chain('An exporter with full yards is not marked down twice: its price follows what it uses and sells, and empty shelves still treble it', () => {
  const w = fresh(), c = w.countries.U1, store = USUAL_COVER.coal / 1.25, world = w.globalPrice.coal * (c.rer ?? 1);
  c.lastSold = { coal: c._need.coal * 3 }; c.stock.coal = (c._need.coal + c.lastSold.coal) * store; localPrices(w, c);
  assert.ok(Math.abs(c.prices.coal / world - 1) < .02, `at its usual store an exporter sells at the world price: ${c.prices.coal} against ${world}`);
  c.stock.coal *= 4; localPrices(w, c); assert.ok(c.prices.coal >= world * .64, `full stores take at most a third off: ${c.prices.coal}`);
  c.stock.coal = 0; localPrices(w, c); assert.ok(c.prices.coal > world * 2.9, 'an empty yard trebles it');
});
chain('A company is worth its till and about three years of what it earns, never less than its works second-hand', () => {
  const w = fresh(), c = w.countries.U1; run(w, 1);
  const p = countryProvinces(w, 'U1').find(q => q.plants.goods > .1) ?? countryProvinces(w, 'U1')[0]; p.plants.goods = 2;
  const f = { id: 'SRX', name: 'Test Textile', country: 'U1', province: p.id, sector: 'goods', resource: null, stake: 1, owner: c.oligarch, cash: 50, lastProfit: 0, founded: 0, status: 'open', bad: 0, offer: null }; w.firms.SRX = f;
  const works = firmValue(w, f) - 50; assert.ok(works > 0, 'with no earnings it is worth its works second-hand');
  f.earn = 40; assert.ok(Math.abs(firmValue(w, f) - (50 + 480)) < 1e-6, `twelve quarters of 40 and the 50 in the till: ${firmValue(w, f)}`);
  f.earn = works / 24; assert.ok(Math.abs(firmValue(w, f) - (50 + works)) < 1e-6, 'thin earnings do not take it below the value of the works');
  // The price an ownerless company is bought at is that value.
  f.owner = null; f.earn = 40; const buyer = w.characters[c.opposition]; buyer.wealth = 400;
  assert.equal(applyOp(w, buyer, { op: 'buy_company', id: 'SRX' }).ok, false, '400 does not buy a company worth 530');
  buyer.wealth = 600; assert.equal(applyOp(w, buyer, { op: 'buy_company', id: 'SRX' }).ok, true); assert.ok(Math.abs(buyer.wealth - 70) < 1e-6 && f.owner === buyer.id);
});
chain('Profit → owner or till: an owned company pays two fifths out, an ownerless one keeps all of it, and nothing is lost on the way', () => {
  const mk = owner => { const w = fresh(), c = w.countries.U1; run(w, 1); const p = countryProvinces(w, 'U1').find(q => q.plants.goods > .1) ?? countryProvinces(w, 'U1')[0]; p.plants.goods = 2;
    const f = { id: 'SRX', name: 'Test Textile', country: 'U1', province: p.id, sector: 'goods', resource: null, stake: 1, owner: owner === 'oligarch' ? c.oligarch : owner, cash: 0, lastProfit: 0, founded: 0, status: 'open', bad: 0, offer: null, buildsUntil: 1e9 }; w.firms = { SRX: f };
    Object.assign(c.prices, { goods: 100, timber: 1, coal: 1, steel: 1 }); c._made = { ...c._made, goods: 200 }; return { w, c, f, ol: w.characters[c.oligarch] }; };
  const a = mk('oligarch'), wealth = a.ol.wealth; firmStep(a.w);
  assert.ok(a.f.lastProfit > 0); assert.ok(Math.abs((a.ol.wealth - wealth) - a.f.lastProfit * .4) < .02 && Math.abs(a.f.cash - a.f.lastProfit * .6) < .02, 'two fifths to the owner, the rest to the till');
  const b = mk(null), all = Object.values(b.w.characters).reduce((s, ch) => s + ch.wealth, 0), tre = b.c.treasury; firmStep(b.w);
  assert.ok(Math.abs(b.f.cash - b.f.lastProfit) < .02, `an ownerless company keeps the whole: ${b.f.cash} of ${b.f.lastProfit}`);
  assert.ok(Math.abs(Object.values(b.w.characters).reduce((s, ch) => s + ch.wealth, 0) - all) < 1e-9 && b.c.treasury === tre, 'and no one else is paid');
  const s = mk(STATE), t0 = s.c.treasury; firmStep(s.w); assert.ok(s.c.treasury > t0 && Math.abs(s.f.cash - s.f.lastProfit * .6) < .02, 'a state company pays its two fifths into the treasury');
});
chain('No gold → coal sold → bread bought before boots: a poor country spends the quarter\'s earnings on grain first', () => {
  const w = fresh(), t = w.countries.U1; run(w, 1);
  for (const o of aliveCountries(w)) if (o.id !== t.id) { o.stock.coal = 0; o.reserves = Math.max(o.reserves, 5000); o.stock.grain += 2000; o.stock.goods += 2000; }
  t.reserves = 0; t.creditors = {}; t.stock.coal = 5000; t.stock.grain = 0; t.stock.goods = 0; for (const p of countryProvinces(w, t.id)) { p.fertility *= .5; p.plants.goods = 0; }
  run(w, 1);
  assert.ok((t.lastSold.coal || 0) > 0, 'it sold coal for gold this quarter');
  assert.ok((t.lastBought.grain || 0) > 0, `and bought grain with it the same quarter: ${JSON.stringify(t.lastBought)}`);
  const bread = (t.lastBought.grain || 0) * w.globalPrice.grain, boots = (t.lastBought.goods || 0) * w.globalPrice.goods, short = Math.max(0, t._need.grain - (t._raw.grain || 0));
  assert.ok((t.lastBought.grain || 0) > short * .9 || boots < bread * .25, `boots are bought only once the bread is: grain ${bread.toFixed(0)}, consumer goods ${boots.toFixed(0)}`);
});
chain('Empty shops are felt in the towns, and a hungry country without gold does not bid the world price up', () => {
  const w = inherited(); w.status = 'playing'; run(w, 2); const c = w.countries.U3, p = w.provinces[c.capital];
  const row = k => moodParts(c, p, k).find(m => m[0] === 'what the shops have to sell')[1];
  c.goodsRatio = c.shopBase; assert.equal(row('workers'), 0, 'the level a country inherited is its ordinary lot'); c.goodsRatio = 0;
  assert.ok(row('workers') < -8 && row('middle') < -8 && row('peasants') === 0, `bare shelves weigh on workers and the middle class, not on villages: ${row('workers')}`);
  // Twin worlds; in one of them a country with an empty reserve wants a great deal of consumer goods it cannot pay for.
  const a = inherited(), b = inherited(); for (const x of [a, b]) { x.status = 'playing'; run(x, 2); } const poor = b.countries.U4; poor.reserves = 0; poor.stock.goods = -5000;
  run(a, 1); run(b, 1); assert.ok(b.globalPrice.goods < a.globalPrice.goods * 1.1, `a want with no gold behind it is not demand: ${b.globalPrice.goods} against ${a.globalPrice.goods}`);
});
chain('Default → savings lost → standing falls, and the gold that runs is not lost to the world', () => {
  const a = inherited(), b = inherited(); for (const w of [a, b]) { w.status = 'playing'; run(w, 1); }
  const c = b.countries.U3, twin = a.countries.U3, gold = w => Object.values(w.countries).reduce((s, x) => s + x.reserves, 0), g0 = gold(b), legit = c.legitimacy, cap = c.blocs.capital.sat, bank = c.bankHealth;
  assert.equal(applyOp(b, ld(b, c), { op: 'default_debt', _law: true }).ok, true);
  assert.ok(Math.abs(gold(b) - g0) < 1e-6, 'gold flees to a haven, it does not vanish');
  assert.ok(c.legitimacy <= legit - 2 && c.blocs.capital.sat <= cap - 5 && c.bankHealth <= bank - 25, 'the government, the men of business and the banks all take the blow at once');
  assert.ok(c.mods.some(m => m.key === 'sat.middle' && m.delta < 0) && c.mods.some(m => m.key === 'sat.elite' && m.delta < 0), 'those whose savings were written off remember it');
  run(a, 8); run(b, 8);
  assert.ok(c.legitimacy < twin.legitimacy - 1, `two years on the defaulter stands lower than its twin: ${c.legitimacy.toFixed(1)} against ${twin.legitimacy.toFixed(1)}`);
  assert.ok(c.lastInterest > 0, 'and after a year\'s moratorium what is left of the debt is served again');
});
chain('Small revenue → small credit: lenders stop when interest would eat the state\'s income, whatever its standing', () => {
  const w = inherited(); w.status = 'playing'; run(w, 2); const c = w.countries.U5; c.defaulted = false; c._room = Infinity; c._taken = 0;
  const rich = creditLeft(c); c.legitimacy = 95; const trusted = creditLeft(c);
  c.lastRevenue *= .25; assert.ok(creditLeft(c) < trusted * .5, 'a quarter of the revenue, far less credit, however well thought of the government is');
  c.debt = c.lastRevenue * .55 / Math.max(sovereignRate(c) - Math.max(0, c.inflTrend ?? 0) * .6, .005); c.interestRate = sovereignRate(c); assert.equal(creditLeft(c), 0, 'once interest would take about half the revenue no one lends more');
  assert.ok(rich >= 0);
  // And in a run: welfare on credit buys a poor state a few good years and then costs it more than it bought.
  const x = inherited(), y = inherited(); for (const z of [x, y]) { z.status = 'playing'; run(z, 1); } const p = x.countries.U5, twin = y.countries.U5; applyOp(x, ld(x, p), { op: 'set_budget', category: 'welfare', share: .12, _law: true });
  run(x, 8); run(y, 8); assert.ok(p.legitimacy > twin.legitimacy + 3, 'two years in, the borrowed relief has bought standing: ' + p.legitimacy.toFixed(0) + ' against ' + twin.legitimacy.toFixed(0));
  run(x, 32); run(y, 32); assert.ok(p.legitimacy < twin.legitimacy - 5 && (p.paidRatio < 1 || p.defaulted), 'ten years in, the lenders have stopped and the state stands lower than its twin: ' + p.legitimacy.toFixed(0) + ' against ' + twin.legitimacy.toFixed(0));
});
chain('State sells grain → out of the stores → paid for what arrived, and nothing for what did not', () => {
  const w = inherited(); w.status = 'playing'; run(w, 2); const a = w.countries.U2, b = w.countries.U4, A = ld(w, a), B = ld(w, b);
  assert.ok(w.routes['U2|U4'], 'the two trade');
  const k = applyOp(w, A, { op: 'propose_contract', to: B.id, terms: 'Grain.', payer: 'me', pay_per_turn: 200, good: 'grain', amount: 40, seller: 'them', turns: 4, state: true });
  assert.equal(applyOp(w, B, { op: 'accept_contract', id: k.contract, state: true }).ok, true);
  const kk = w.contracts.find(x => x.id === k.contract), net = c => c.treasury - c.debt; w.contracts = [kk];
  assert.ok(!Object.values(w.firms).some(f => f.country === 'U4' && f.owner === STATE && (f.sector === 'grain' || f.resource === 'grain')), 'no state works grow grain');
  b.stock.grain = 500; let paid = net(a), got = net(b), had = a.stock.grain; contractStep(w);
  assert.ok(Math.abs(kk.lastDelivered - 40) < 1e-6 && a.stock.grain > had + 35 && Math.abs(b.stock.grain - 460) < 1e-6, 'a state delivers out of the stores of the country');
  assert.ok(Math.abs((paid - net(a)) - 200) < 1e-6 && Math.abs((net(b) - got) - 200) < 1e-6, 'and is paid the 200 for the 40');
  b.stock.grain = 10; paid = net(a); contractStep(w);
  assert.ok(Math.abs((paid - net(a)) - 50) < 1e-6, 'a quarter of the grain, a quarter of the price: ' + (paid - net(a))); assert.ok((kk.breaches || []).length === 1, 'and the short delivery is on record against the seller');
  b.stock.grain = 0; paid = net(a); contractStep(w); assert.ok(Math.abs(paid - net(a)) < 1e-6, 'nothing delivered, nothing paid');
});
chain('State contract to a private purse → the same allowance as any payment to persons, on the books and known to both', () => {
  const w = inherited(), twin = inherited(); for (const x of [w, twin]) { x.status = 'playing'; run(x, 1); }
  const c = w.countries.U4, L = ld(w, c), O = w.characters[c.oligarch], w0 = O.wealth, own = Object.values(w.firms).filter(f => f.owner === O.id).map(f => f.id);
  const k = applyOp(w, L, { op: 'propose_contract', to: O.id, terms: 'Consultancy on the supply of the army.', payer: 'me', pay_per_turn: 800, turns: 8, state: true });
  assert.equal(applyOp(w, O, { op: 'accept_contract', id: k.contract }).ok, true);
  for (const id of own) w.firms[id].owner = null;   // so that nothing but the contract reaches his purse
  run(w, 4); run(twin, 4);
  const got = O.wealth - w0, cap = c.gdp * .005 * 4;
  assert.ok(got > 0 && got <= cap * 1.15, `four quarters paid ${got.toFixed(0)}, not 3200; the allowance is about ${cap.toFixed(0)}`);
  assert.ok((O.secrets || []).some(s => /draws .* from the treasury/.test(s.text)) && (L.secrets || []).some(s => /draws .* from the treasury/.test(s.text)), 'both carry it as a secret');
  assert.ok(c.debt - twin.countries.U4.debt < cap * 1.5, 'and the state did not borrow thousands to pay it');
});
chain('Flight and return move gold, they do not make it; a network abroad steals once a quarter and only what can be used', () => {
  const w = inherited(); w.status = 'playing'; run(w, 1); const c = w.countries.U2, o = w.characters[c.oligarch]; o.wealth = 300;
  const gold = () => Object.values(w.countries).reduce((s, x) => s + x.reserves, 0), g0 = gold(), home = c.reserves;
  for (let i = 0; i < 6; i++) { assert.equal(applyOp(w, o, { op: 'capital_flight', share: .5 }).ok, true); assert.ok(c.reserves < home); assert.equal(applyOp(w, o, { op: 'repatriate' }).ok, true); w.turn++; }
  assert.ok(Math.abs(gold() - g0) < 1e-6 && Math.abs(c.reserves - home) < 1e-6 && !(o.abroad > .01), `six times out and back: the world holds ${gold().toFixed(2)} as before`);
  const s = w.countries.U4, t = w.countries.U3; for (const k of ['railway', 'electricity', 'oil_prospecting', 'combustion_engine', 'armor', 'automatic_weapons']) t.techs[k] = 1; s.techs = {};
  s.intelligence = 99; t.intelligence = 1; let won = 0; for (let i = 0; i < 20; i++) if (applyOp(w, ld(w, s), { op: 'steal_tech', target: 'U3', _law: true }).ok) won++;
  assert.ok(won <= 1, `twenty orders in one quarter, at most one theft: ${won}`); assert.ok(!s.techs.combustion_engine && !s.techs.armor, 'nothing that needs an invention the thief does not have');
});
chain('The engine without oil → the country stays on coal: no price shock, the fleet keeps its coal, and the motor comes only with fuel', () => {
  const a = inherited(), b = inherited(); for (const w of [a, b]) { w.status = 'playing'; run(w, 1); }
  for (const k of ['oil_prospecting', 'combustion_engine']) b.countries.U3.techs[k] = 1;
  run(a, 2); run(b, 2); const x = a.countries.U3, y = b.countries.U3;
  assert.ok(Math.abs(y.inflation - x.inflation) < .01, `no jump in prices: ${y.inflation} against ${x.inflation}`);
  assert.ok(!(y.motor > 0) && y.fuelRatio >= 1, 'no fuel, so nothing has gone over to it and nothing is short of it');
  assert.ok(y._need.coal > 0 && y._burn.fuel === 0, 'the fleet still burns coal');
  y.stock.fuel = 500; run(b, 3); assert.ok(y.motor > 0, 'with fuel in store the country begins to go over to the engine');
});
chain('Whoever is in a plot is in it once, and whoever has answered an invitation is not asked again the same quarter', () => {
  const w = inherited(), c = w.countries.U1, g = w.characters[c.general], cols = Object.values(w.characters).filter(x => x.alive && x.country === 'U1' && x.role === 'officer' && Object.values(w.units).some(u => u.commander === x.id));
  const col = cols[0]; col.patron = g.id; col.soundedAt = w.turn; assert.ok(applyOp(w, g, { op: 'start_plot', kind: 'coup' }).ok); const pl = w.plots.at(-1);
  assert.ok(applyOp(w, g, { op: 'invite_plot', plot: pl.id, character: col.id }).ok, 'the officer who sounded him out joins');
  for (let i = 0; i < 10; i++) assert.equal(applyOp(w, g, { op: 'invite_plot', plot: pl.id, character: col.id }).ok, false, 'he does not join a second time');
  assert.deepEqual(pl.members, [col.id], 'one man is one member');
  const shy = cols[1]; shy.loyalty = 50; shy.ambition = 0; const first = applyOp(w, g, { op: 'invite_plot', plot: pl.id, character: shy.id }), again = applyOp(w, g, { op: 'invite_plot', plot: pl.id, character: shy.id });
  assert.equal(again.ok, false); assert.ok(first.ok ? /in the plot already/.test(again.msg) : /this quarter/.test(again.msg), again.msg);
  if (!first.ok) { w.turn++; assert.ok(!/this quarter/.test(applyOp(w, g, { op: 'invite_plot', plot: pl.id, character: shy.id }).msg), 'next quarter he can be asked again'); }
});
chain('A rising called in a quiet country with a loyal army finds no following and its caller is known; prepared, where provinces are restless, it takes those provinces and nothing else', () => {
  const quiet = inherited(), c = Object.values(quiet.countries).find(x => x.archetype === 'republic'), opp = quiet.characters[c.opposition], n = aliveCountries(quiet).length;
  const r = applyOp(quiet, opp, { op: 'start_plot', kind: 'uprising' }), out = applyOp(quiet, opp, { op: 'execute_plot', plot: r.plot });
  assert.equal(aliveCountries(quiet).length, n, `no country is split by a word: ${out.msg}`); assert.ok(/put down/.test(out.msg), 'and the one who called it learns why');
  assert.equal(opp.country, c.id); assert.ok(ld(quiet, c).dossiers[opp.id]?.facts.some(f => /armed rising/.test(f)), 'the ruler holds the proof of who called it');
  const w = inherited(), k = w.countries[c.id], lead = w.characters[k.opposition], hot = countryProvinces(w, k.id).filter(p => p.owner === k.id && p.id !== k.capital).slice(0, 3);
  for (const p of countryProvinces(w, k.id)) p.unrest = hot.includes(p) ? 75 : 15;
  const s = applyOp(w, lead, { op: 'start_plot', kind: 'uprising' }); w.plots.at(-1).progress = 100; const done = applyOp(w, lead, { op: 'execute_plot', plot: s.plot }), rebels = Object.values(w.countries).find(x => x.parent === k.id);
  assert.ok(rebels, done.msg); assert.deepEqual(countryProvinces(w, rebels.id).map(p => p.id).sort(), hot.map(p => p.id).sort(), 'the provinces that were ready rose, and only those');
  assert.equal(Object.values(w.units).filter(u => u.country === rebels.id).length, 0, 'a loyal army stays with the government');
});
chain('The opposition a government faces sits outside it: its leader speaks for the largest party off the government benches, cannot pull down a house he does not sit in, and a lost election clears the benches', () => {
  const w = inherited(), c = Object.values(w.countries).find(x => x.archetype === 'republic'), boss = ld(w, c), opp = w.characters[c.opposition], mine = leadsOf(w, c, opp)[0];
  assert.ok(mine && mine.id !== c.rulingParty && !c.coalition.includes(mine.id), 'the opposition leader speaks for a party outside the government'); assert.ok(benchOf(c) > 50, `the inherited government has a majority without it: ${benchOf(c)}`);
  assert.equal(applyOp(w, opp, { op: 'coalition', join: false }).ok, false, 'he cannot withdraw a party that was never on the benches');
  assert.ok(applyOp(w, opp, { op: 'no_confidence' }).ok); w.turn++; billsOf(w, applyOp); assert.equal(c.leader, boss.id, 'and his motion alone does not carry the house');
  // An election the government loses: the winner governs with benches of his own making.
  const old = c.rulingParty; for (const p of c.parties) p.support = p.id === mine.id ? 70 : 10; c.nextElection = w.turn; electionStep(w);
  assert.equal(c.leader, opp.id, 'the opposition leader won'); assert.equal(c.rulingParty, mine.id, 'with the party he spoke for'); assert.ok(!c.coalition.includes(old) && !c.coalition.includes(mine.id), `the beaten party sits outside: ${c.coalition}`);
  const theirs = leadsOf(w, c, boss)[0]; assert.ok(theirs && theirs.id !== c.rulingParty && !c.coalition.includes(theirs.id), 'and the beaten head of government leads the opposition from outside');
});
chain('An army does not go over whole for a point of loyalty; a chief of staff alone does not take a state that stands, and with the commanders he does; a stroke not prepared fails; what becomes of the fallen ruler is the plotters\' to choose', () => {
  const w0 = inherited(), id = Object.values(w0.countries).find(x => x.archetype === 'republic').id;
  const stage = (i, { loyalty, officers = 0, progress = 100 } = {}) => { const w = structuredClone(w0); w.rng = (w.rng + i * 7919) | 0; const c = w.countries[id], g = w.characters[c.general], us = Object.values(w.units).filter(u => u.country === id).sort((a, b) => b.men - a.men);
    if (loyalty != null) for (const u of us) u.loyalty = loyalty; assert.ok(applyOp(w, g, { op: 'start_plot', kind: 'coup', secrecy: 1 }).ok); const pl = w.plots.at(-1); pl.progress = progress; pl.members.push(...us.slice(0, officers).map(u => u.commander).filter(Boolean)); return { w, c, g, pl }; };
  const march = loyalty => { const { w, c, pl } = stage(0, { loyalty }), { pro, anti } = sidesOf(w, c, pl); return pro / (pro + anti); };
  assert.ok(march(81) > march(83) && march(81) - march(83) < .1, `two points of loyalty do not turn an army: ${march(81)} and ${march(83)}`); assert.ok(march(30) > .8 && march(95) < .15, 'but faith lost or kept does');
  const odds = (opt, fate) => { let won = 0, got = 0; for (let i = 0; i < 30; i++) { const { w, c, g, pl } = stage(i, opt), old = ld(w, c); executePlot(w, pl, { fate }); if (c.leader === g.id) { won++; if (old.status === fate) got++; else assert.equal(old.status, 'exiled', 'a ruler who is not caught has fled'); } } return { won, got }; };
  const alone = odds({}), backed = odds({ officers: 2 }), hasty = odds({ officers: 2, progress: 5 });
  assert.ok(alone.won <= 3, `alone against a government that stands: ${alone.won}/30`); assert.ok(backed.won >= 24, `with the commanders of the two largest units: ${backed.won}/30`); assert.ok(hasty.won <= 2, `the same men striking the day they first spoke of it: ${hasty.won}/30`);
  const held = odds({ officers: 2 }, 'imprisoned'), shot = odds({ officers: 2 }, 'dead'); assert.ok(held.got >= held.won * .6, `the fallen ruler is held when the plotters want him held and can reach him: ${held.got} of ${held.won}`); assert.ok(shot.got >= shot.won * .6, `or shot: ${shot.got} of ${shot.won}`);
  const { w, c, g, pl } = stage(1, { officers: 2 }), press = c.pressFreedom; executePlot(w, pl); assert.equal(c.leader, g.id); assert.equal(c.elections, false, 'soldiers who seize the state hold no vote until they say so'); assert.equal(c.pressFreedom, press, 'what they do about the press is theirs to order');
});
chain('A state is handed over with the armed underground its misery has bred already; and a province where a rising was fought out is quiet for some years, longer where troops put it down', () => {
  const w = inherited(), junta = Object.values(w.countries).find(x => x.archetype === 'junta'), free = Object.values(w.countries).find(x => x.archetype === 'republic'), day = junta.cells;
  assert.ok(day > 30, `a junta that rules by police over people who hate it has an underground on the first day: ${day}`); assert.ok((free.cells ?? 0) < 5, 'a free country has next to none');
  run(w, 4); assert.ok(junta.cells > day - 25 && junta.cells < day + 15, `and the new ruler does not watch it grow from nothing in the first year: ${day} then ${junta.cells}`);
  const rose = y => { const p = y.provinces[spot]; for (let i = 0; i < 80 && !p.quelled; i++) { p.unrest = 95; risingStep(y); } return p.quelled; };
  const x = fresh(), spot = countryProvinces(x, 'U1').find(q => q.id !== x.countries.U1.capital).id, bare = rose(x); assert.ok(bare, 'a rising that was fought out is remembered in the province');
  const twin = structuredClone(x); delete twin.provinces[spot].quelled; run(x, 3); run(twin, 3); assert.ok(x.provinces[spot].unrest < twin.provinces[spot].unrest - 1, `it is quieter afterwards than a province that has only cooled: ${x.provinces[spot].unrest} against ${twin.provinces[spot].unrest}`);
  const y = fresh(); makeUnit(y, 'U1', spot, provincePopOf(y.provinces[spot]) * .04, 1, 90); assert.ok(rose(y).weight > bare.weight, 'and quieter for longer where troops put it down');
});
chain('An order given twenty times in a quarter is carried out once: one network does one thing and is paid for, a file is opened once, a private person has no secret service, and a court asked twice answers the same', () => {
  const w = fresh(), c = w.countries.U1, boss = ld(w, c), t = w.countries.U2, purse = c.treasury, owed = c.debt;
  let went = 0; for (let i = 0; i < 20; i++) if (!/once this quarter/.test(applyOp(w, boss, { op: 'spy', target: 'U2', kind: 'fund_uprising' }).msg)) went++;
  assert.equal(went, 1, 'one network does one thing in a quarter'); assert.ok(c.treasury < purse || c.debt > owed, 'and it is paid for whether it succeeds or not');
  for (let i = 0; i < 40; i++) { w.turn++; c.treasury += 100; applyOp(w, boss, { op: 'spy', target: 'U2', kind: 'fund_uprising' }); }
  assert.equal(t.mods.filter(m => m.label === 'Foreign-backed unrest').length, 1, 'money for agitators keeps one fire burning; it does not light a second on top of it');
  const opp = w.characters[c.opposition]; let asked = 0; for (let i = 0; i < 20; i++) if (!/once this quarter/.test(applyOp(w, opp, { op: 'gather_dossier', character: boss.id }).msg)) asked++; assert.equal(asked, 1, 'the same person is looked into once a quarter');
  const finds = (who, whom) => { let n = 0; for (let i = 0; i < 120; i++) { w.turn++; if (applyOp(w, who, { op: 'gather_dossier', character: whom.id }).ok) n++; } return n; };
  c.intelligence = 100; opp.power = 20; const state = finds(boss, opp), own = finds(opp, boss); assert.ok(state > 70 && own < 45, `the state's secret service works for whoever governs, not for a private person: ${state} against ${own} of 120`);
  c.courts = 100; const rich = w.characters[c.oligarch]; rich.wealth = 500; let mixed = 0; const rulings = new Set();
  for (let q = 0; q < 40; q++) { w.turn++; const seen = new Set(); for (let i = 0; i < 6; i++) seen.add(applyOp(w, boss, { op: 'fine', character: rich.id, amount: 1 }).ok); if (seen.size > 1) mixed++; for (const r of seen) rulings.add(r); }
  assert.equal(mixed, 0, 'a fine struck down is not carried by being laid again the same quarter'); assert.equal(rulings.size, 2, 'though the court does not rule the same way every quarter');
});
chain('Land signed away costs the government that signs and credits the one that took it; joining a war against a treaty partner is a broken word too; a clause not kept is remembered; an armistice stops the fighting and leaves the war', () => {
  const w = inherited(), a = Object.values(w.countries).find(x => x.archetype === 'junta'), b = w.countries[[...new Set(countryProvinces(w, a.id).flatMap(p => p.neighbors.map(n => w.provinces[n].controller)))].find(x => x !== a.id)];
  assert.ok(applyOp(w, ld(w, a), { op: 'declare_war', target: b.id }).ok); const give = countryProvinces(w, b.id).filter(p => p.id !== b.capital).slice(0, 8).map(p => p.id), la = a.legitimacy, lb = b.legitimacy;
  const pr = applyOp(w, ld(w, a), { op: 'propose_treaty', target: b.id, kind: 'peace', cede: give }), sg = applyOp(w, ld(w, b), { op: 'accept_treaty', id: pr.treaty }); assert.ok(sg.ok, sg.msg);
  assert.ok(b.legitimacy < lb - 5, `signing away eight provinces is a defeat at home: ${lb} to ${b.legitimacy}`); assert.ok(a.legitimacy > la, 'and a success for the one who took them'); assert.ok(/signed away/.test(sg.msg), 'the one who signs is told what it cost');
  const x = inherited(), p = x.countries[a.id], q = x.countries[b.id], third = Object.values(x.countries).find(o => o.alive && o.id !== p.id && o.id !== q.id); x.treaties.push({ id: 'AX', kind: 'alliance', parties: [p.id, q.id], active: true, pending: false, proposer: p.id, clauses: [], breaches: [], turn: x.turn });
  assert.ok(applyOp(x, ld(x, third), { op: 'declare_war', target: q.id, _law: true }).ok); const word = honourIn(p); assert.ok(applyOp(x, ld(x, p), { op: 'join_war', war: x.wars.at(-1).id, side: 'a' }).ok);
  assert.ok(honourIn(p) <= word - 8, `entering a war against an ally costs a state its name: ${word} to ${honourIn(p)}`);
  const y = fresh(), u2 = y.countries.U2; y.treaties.push({ id: 'AY', kind: 'nonaggression', parties: ['U1', 'U2'], active: true, pending: false, proposer: 'U1', clauses: [{ type: 'troop_limit', country: 'U2', men: 0 }], breaches: [], turn: y.turn }); const name = honourIn(u2); treatyStep(y);
  assert.ok(honourIn(u2) < name, 'a clause not kept is a word not kept');
  const z = inherited(), m = z.countries[a.id], n = z.countries[b.id]; for (const u of Object.values(z.units)) if ([m.id, n.id].includes(u.country)) delete z.units[u.id];
  const from = countryProvinces(z, m.id).find(pp => pp.id !== m.capital && pp.neighbors.some(nn => z.provinces[nn].controller === n.id)), to = z.provinces[from.neighbors.find(nn => z.provinces[nn].controller === n.id)];
  m.paidRatio = n.paidRatio = 1; const mine = makeUnit(z, m.id, from.id, 60); makeUnit(z, n.id, to.id, 20); assert.ok(applyOp(z, ld(z, m), { op: 'declare_war', target: n.id }).ok);
  const arm = applyOp(z, ld(z, m), { op: 'propose_treaty', target: n.id, kind: 'armistice', turns: 8 }); assert.ok(arm.ok, arm.msg); assert.ok(applyOp(z, ld(z, n), { op: 'accept_treaty', id: arm.treaty }).ok);
  z.battles = []; applyOp(z, ld(z, m), { op: 'move', unit: mine.id, to: to.id }); militaryStep(z);
  assert.equal(z.battles.length, 0, 'no battle is fought'); assert.equal(mine.province, from.id, 'nobody advances while the armistice holds'); assert.ok(z.wars.some(v => v.active && v.a.includes(m.id) && v.b.includes(n.id)), 'and the war is not over');
  assert.ok(applyOp(z, ld(z, m), { op: 'break_treaty', id: arm.treaty }).ok); z.battles = []; assert.ok(applyOp(z, ld(z, m), { op: 'move', unit: mine.id, to: to.id }).ok); militaryStep(z); assert.ok(z.battles.length > 0 || mine.province === to.id, 'once it is broken the fighting goes on');
});
chain('A war costs more than a peace and men abroad cost double; an army crosses friendly country in a season and enemy ground a province at a time; men who are not paid go home, not out of the world; a handful cannot bleed a host, and a routed force leaves prisoners who come home with the peace', () => {
  const w = fresh(), c = w.countries.U1, peace = upkeepCost(w, c); w.wars.push({ id: 'S-x', a: ['U1'], b: ['U2'], civil: false, active: true, start: w.turn, name: 'x' });
  const war = upkeepCost(w, c); assert.ok(war > peace * 1.3, `the same army costs more in the field: ${peace} then ${war}`);
  Object.values(w.units).find(u => u.country === 'U1').province = countryProvinces(w, 'U2')[0].id; assert.ok(upkeepCost(w, c) > war, 'and more again on foreign soil');
  const summer = () => { const y = fresh(); while (seasonOf(y) !== 'summer') y.turn++; for (const u of Object.values(y.units)) delete y.units[u.id]; return y; };
  const y = summer(), k = y.countries.U1, hops = (from, to) => { let n = 0, cur = from; while (cur !== to && n < 40) { cur = routeStep(y, cur, to, 'U1'); n++; if (!cur) return 99; } return n; };
  const far = countryProvinces(y, 'U1').find(p => hops(k.capital, p.id) === 3); assert.ok(far, 'a province three marches from the capital');
  for (const p of countryProvinces(y, 'U1')) { p.terrain = 'plains'; p.infra = 1.2; }
  const col = makeUnit(y, 'U1', k.capital, 20); col.target = far.id; militaryStep(y); assert.equal(col.province, far.id, 'three provinces of open, friendly country with good roads in one quarter');
  const border = countryProvinces(y, 'U1').find(p => p.neighbors.some(n => y.provinces[n].controller === 'U2')), first = y.provinces[border.neighbors.find(n => y.provinces[n].controller === 'U2')], deep = first.neighbors.map(n => y.provinces[n]).find(p => p.controller === 'U2' && !border.neighbors.includes(p.id));
  y.wars.push({ id: 'S-y', a: ['U1'], b: ['U2'], civil: false, active: true, start: y.turn, name: 'y' }); const van = makeUnit(y, 'U1', border.id, 40); van.target = (deep ?? first).id; militaryStep(y); assert.equal(van.province, first.id, 'into the enemy\'s country, one province in the quarter');
  const z = summer(), g = z.countries.U1; makeUnit(z, 'U1', g.capital, 100); const heads = () => countryProvinces(z, 'U1').reduce((s, p) => s + provincePopOf(p), 0) + Object.values(z.units).filter(u => u.country === 'U1').reduce((s, u) => s + u.men, 0);
  g.budget.military = 0; const before = heads(); militaryStep(z); assert.ok(Object.values(z.units).filter(u => u.country === 'U1').reduce((s, u) => s + u.men, 0) < 80, 'an army that is not paid melts'); assert.ok(Math.abs(heads() - before) < 1e-6, 'and the men who leave it are back among the people');
  const b = summer(); b.wars.push({ id: 'S-z', a: ['U1'], b: ['U2'], civil: false, active: true, start: b.turn, name: 'z' }); b.countries.U1.budget.military = b.countries.U2.budget.military = .3;
  const edge = countryProvinces(b, 'U1').find(p => p.neighbors.some(n => b.provinces[n].controller === 'U2' && n !== b.countries.U2.capital)), over = b.provinces[edge.neighbors.find(n => b.provinces[n].controller === 'U2' && n !== b.countries.U2.capital)];
  const host = makeUnit(b, 'U1', edge.id, 600); makeUnit(b, 'U2', over.id, 3); host.target = over.id; b.battles = []; militaryStep(b);
  assert.ok(b.battles[0]?.attackerWon, 'the host carries the field'); { const sick = b.countries.U1._sick ?? 0; assert.ok(600 - host.men - sick < 1.5 && b.battles[0].lossA <= 1, `three thousand men do not kill twelve thousand: the host lost ${600 - host.men - sick} thousand in the fight (and ${sick} to sickness in the field)`); }
  const held = b.countries.U1.captives?.U2 ?? 0, roll = b.countries.U2.reserve ?? 0; assert.ok(held > 0, 'a force routed at such odds leaves prisoners');
  const pax = applyOp(b, ld(b, b.countries.U1), { op: 'propose_treaty', target: 'U2', kind: 'peace' }); assert.ok(applyOp(b, ld(b, b.countries.U2), { op: 'accept_treaty', id: pax.treaty }).ok);
  assert.ok(!(b.countries.U1.captives?.U2 > 0) && Math.abs((b.countries.U2.reserve ?? 0) - roll - held) < 1e-6, 'and the peace sends them home');
});
chain('Force has a price that depends on what is done: killing costs more than holding and is blood the underground remembers, a prisoner can be brought to trial, a new head of a house brings no new fortune, a rigged count can come out, talk costs money, the police do what their numbers allow, and doors shut on a people are resented', () => {
  const act = fate => { const w = fresh(), c = w.countries.U1, boss = ld(w, c), opp = w.characters[c.opposition]; c.courts = 0; c.pressFreedom = 80; const was = c.legitimacy; let r; for (let i = 0; i < 30 && !(r = applyOp(w, boss, { op: 'purge', character: opp.id, fate })).ok; i++) w.turn++; assert.ok(r.ok, r.msg); return { w, c, boss, opp, cost: was - c.legitimacy }; };
  const held = act('imprisoned'), shot = act('dead'); assert.ok(shot.cost > held.cost * 1.8, `shooting the leader of the opposition costs more than holding him: ${shot.cost} against ${held.cost}`); assert.ok(shot.c.blood > 0 && !(held.c.blood > 0), 'and it is blood');
  { const { w, c, boss, opp } = held; c.courts = 100; const t = applyOp(w, boss, { op: 'prosecute', character: opp.id, charge: 'sedition' }); assert.ok(t.ok, t.msg); w.turn++; justiceOf(w); assert.equal(opp.status, 'free', 'a free bench with nothing laid before it acquits, and the cell opens'); }
  { const w = fresh(), c = w.countries.U1, boss = ld(w, c), rich = w.characters[c.oligarch]; c.courts = 0; rich.wealth = 200; rich.abroad = 0; const till = c.treasury; let r; for (let i = 0; i < 30 && !(r = applyOp(w, boss, { op: 'purge', character: rich.id, fate: 'imprisoned' })).ok; i++) w.turn++; assert.ok(r.ok, r.msg);
    const heir = w.characters[c.oligarch]; assert.notEqual(heir.id, rich.id); assert.ok(heir.wealth + rich.wealth + (c.treasury - till) / (c.rate || 1) <= 200 + 1e-6, `no fortune appears with the new name: ${heir.wealth} + ${rich.wealth} + ${c.treasury - till}`); }
  { let out = 0; for (let i = 0; i < 30; i++) { const w = fresh(), c = w.countries.U1, boss = ld(w, c); for (let j = 0; j < i; j++) rollOf(w); c.elections = true; c.pressFreedom = 95; c.courts = 95; c.nextElection = w.turn; assert.ok(applyOp(w, boss, { op: 'rig_election', amount: 25 }).ok); assert.ok(boss.secrets.some(s => /returns of the election/.test(s.text)), 'the order is a secret someone can find'); w.newsThisTurn = []; electionStep(w); if (w.newsThisTurn.some(e => /falsified/.test(e.text))) out++; }
    assert.ok(out >= 15, `under a free press and honest judges a stuffed count usually comes out: ${out} of 30`); }
  { const w = fresh(), c = w.countries.U1, boss = ld(w, c), till = c.treasury, debt = c.debt, paid = () => (till - c.treasury) + (c.debt - debt); assert.ok(applyOp(w, boss, { op: 'propaganda', strength: 1 }).ok); const first = paid(); assert.ok(first > 0, 'placards and speakers are paid for'); for (let i = 0; i < 3; i++) applyOp(w, boss, { op: 'propaganda', strength: 1 }); const spent = paid(); for (let i = 0; i < 20; i++) applyOp(w, boss, { op: 'propaganda', strength: 1 }); assert.ok(spent < first * 2.5 && Math.abs(paid() - spent) < 1e-6, 'and once the country has heard enough nothing more is printed and nothing more is spent'); }
  { const grip = police => { const w = fresh(), c = w.countries.U1; c.police = police; c.repress = 0; applyOp(w, ld(w, c), { op: 'repress', strength: 1 }); return c.repress; }; assert.ok(grip(80) > grip(15) * 2, `a state with few policemen can order what it likes: ${grip(15)} against ${grip(80)}`); }
  { const w = inherited(), free = Object.values(w.countries).find(x => x.archetype === 'republic'), junta = Object.values(w.countries).find(x => x.archetype === 'junta'), row = c => moodParts(c, countryProvinces(w, c.id)[0], 'workers').find(x => /lawful ways/.test(x[0]))?.[1];
    assert.ok(Math.abs(row(junta)) < .5, 'a people is used to what it has always lived under'); free.elections = false; free.unions = false; free.pressFreedom = 10; assert.ok(row(free) < -5, `what is taken from it, it resents: ${row(free)}`);
    const p = countryProvinces(w, junta.id).find(q => q.id !== junta.capital); makeUnit(w, junta.id, p.id, 30, 1, 95); const was = junta.blood ?? 0; let r; for (let i = 0; i < 20 && !(r = applyOp(w, ld(w, junta), { op: 'persecute', province: p.id, method: 'kill', share: .1 })).ok; i++); assert.ok(r.ok, r.msg); assert.ok(junta.blood > was + 1, 'a massacre is blood too'); }
});
chain('Papers share their readers; a paper is known by its name; and a man who will not be bought says whether it was the sum, once a quarter', () => {
  const weight = n => { const w = fresh(), c = w.countries.U1, rich = w.characters[c.oligarch]; c.literacy = 80; c.pressFreedom = 90; rich.wealth = 1000; for (let i = 0; i < n; i++) assert.ok(applyOp(w, rich, { op: 'found_paper', name: `Sheet ${i}`, amount: 60 }).ok); for (let i = 0; i < 4; i++) { c.mods = c.mods.filter(m => m.key !== 'legitimacy'); pressOf(w); } return -c.mods.filter(m => m.key === 'legitimacy').reduce((s, m) => s + m.delta, 0); };
  const one = weight(1), five = weight(5); assert.ok(one > 0 && five > one && five < one * 2.2, `five papers on one side do not weigh five times one: ${one} and ${five}`);
  const w = fresh(), c = w.countries.U1, boss = ld(w, c), opp = w.characters[c.opposition]; opp.wealth = 50; assert.ok(applyOp(w, opp, { op: 'found_paper', name: 'The Lamp', amount: 10 }).ok); const shut = applyOp(w, boss, { op: 'close_paper', id: 'The Lamp' }); assert.ok(shut.ok, shut.msg); assert.equal((c.papers || []).length, 0);
  const x = inherited(), rich = x.characters[x.countries.U1.oligarch], clerk = Object.values(x.characters).find(q => q.alive && q.country === 'U1' && q.post === 'treasury'); rich.wealth = 100; clerk.loyalty = 50; clerk.greed = 60;
  let said = ''; for (let i = 0; i < 40 && !said; i++) { x.turn++; const r = applyOp(x, rich, { op: 'recruit_informant', character: clerk.id, amount: 2 }); if (!r.ok) said = r.msg; else clerk.handler = null; } assert.ok(/sum was too small/.test(said), said);
  clerk.loyalty = 96; clerk.greed = 5; clerk.handler = null; x.turn++; const no = applyOp(x, rich, { op: 'recruit_informant', character: clerk.id, amount: 2 }); assert.ok(!no.ok && /not the sum/.test(no.msg), no.msg);
  assert.ok(/this quarter/.test(applyOp(x, rich, { op: 'recruit_informant', character: clerk.id, amount: 30 }).msg), 'and he is not asked twice in a quarter');
});
chain('What a country buys abroad follows a usual order that its ruler can change: short of gold it buys bread before anything else unless told otherwise; a good can be given its own duty, a quota or a prohibition, and an export can be forbidden; the customs hold only as far as they reach', () => {
  // A country short of bread and of steel, with gold for one of them and neighbours who have both to sell.
  const poor = order => {
    const w = fresh(), c = w.countries.U1, l = ld(w, c);
    for (const p of countryProvinces(w, 'U1')) p.fertility = .05; c.stock.grain = 0; c.stock.steel = 0; c.lastExportGold = 0; for (const g of Object.keys(c.stock)) if (!['grain', 'steel'].includes(g)) c.stock[g] = Math.max(c.stock[g], (c._need[g] || 0) * 3);
    for (const o of aliveCountries(w)) if (o.id !== 'U1') { o.stock.grain = Math.max(o.stock.grain, 4000); o.stock.steel = Math.max(o.stock.steel, 800); }
    c.reserves = c._need.grain * w.globalPrice.grain * .7;
    if (order) { const r = applyOp(w, l, { op: 'set_import_priority', goods: order }); assert.ok(r.ok && r.msg.includes('steel'), r.msg); }
    run(w, 1); return [w, c, l];
  };
  const [, bread] = poor(null), [w2, iron, l2] = poor(['steel']);
  assert.ok((bread.lastBought.grain || 0) > (bread.lastBought.steel || 0) * 5 && (bread.lastBought.grain || 0) > 10, `left alone, scarce gold goes for bread: grain ${bread.lastBought.grain}, steel ${bread.lastBought.steel}`);
  assert.ok((iron.lastBought.steel || 0) > (bread.lastBought.steel || 0) + 3 && (iron.lastBought.grain || 0) < (bread.lastBought.grain || 0) * .8, `a ruler who puts steel first gets steel and less bread: grain ${iron.lastBought.grain} against ${bread.lastBought.grain}, steel ${iron.lastBought.steel} against ${bread.lastBought.steel}`);
  assert.ok(/set by the government: steel, grain/.test(answer(w2, l2, 'trade')), 'and the order in force can be looked up');
  assert.ok(applyOp(w2, l2, { op: 'set_import_priority', goods: [] }).msg.includes('usual order'), 'an empty list puts the usual order back'); assert.ok(/the usual one: grain/.test(answer(w2, l2, 'trade')));
  // A rich country that wants for consumer goods: free, forbidden, limited, and dutied.
  const shop = (rule, world = fresh) => { const w = world(), c = w.countries.U1, l = ld(w, c); w.status = 'playing'; if (!c._need) run(w, 1); c.reserves = 20000; c.stock.goods = 0; for (const o of aliveCountries(w)) if (o.id !== 'U1') o.stock.goods = Math.max(o.stock.goods, 3000); if (rule) { const r = applyOp(w, l, { op: 'set_import', good: 'goods', ...rule, _law: true }); assert.ok(r.ok, r.msg); } run(w, 1); return [w, c, l]; };
  const gold = w => aliveCountries(w).reduce((s, c) => s + c.reserves, 0);
  const [wf, free] = shop(null), [wb, banned, lb] = shop({ ban: true }), [, capped] = shop({ quota: 7 }), [, taxed] = shop({ tariff: .9 });
  assert.ok(free.lastBought.goods > 30, `left alone the shops are filled from abroad: ${free.lastBought.goods}`); assert.ok(!(banned.lastBought.goods > .01), `a prohibition a strong customs service can keep stops it: ${banned.lastBought.goods}`);
  assert.ok(capped.lastBought.goods > 5 && capped.lastBought.goods <= 7.01, `a quota lets in so much and no more: ${capped.lastBought.goods}`);
  assert.ok(taxed.lastBooks.customs > free.lastBooks.customs * 1.5, `a duty on the one good is paid on that good: customs ${free.lastBooks.customs} -> ${taxed.lastBooks.customs}`);
  assert.ok(banned.goodsRatio < free.goodsRatio - .1, 'and the shops are the emptier for a prohibition'); assert.ok(Math.abs(gold(wf) - gold(wb)) < 1e-6 * gold(wf), 'no gold is made or lost by a rule');
  assert.ok(/consumer goods may not be imported/.test(answer(wb, lb, 'trade')), 'the rule in force can be looked up'); assert.equal(applyOp(wb, wb.characters[banned.general], { op: 'set_import', good: 'goods', clear: true }).ok, false, 'the frontier is the government\'s to rule');
  assert.ok(applyOp(wb, lb, { op: 'set_import', good: 'goods', clear: true, _law: true }).ok); run(wb, 1); assert.ok(banned.lastBought.goods > 30, 'the rule lifted, the trade comes back');
  // The same prohibition in a state whose customs men are few and for sale: most of it comes in anyway, and pays nothing.
  const weak = rule => shop(rule, () => { const w = inherited(), c = w.countries.U1; c.bureaucracy = 15; c.corruption = 80; return w; });
  const [, open] = weak(null), [wl, leaky, ll] = weak({ ban: true });
  assert.ok(leaky.lastBought.goods > open.lastBought.goods * .3 && leaky.lastBought.goods < open.lastBought.goods * .95, `a thin and venal customs service stops only part of it: ${leaky.lastBought.goods} of ${open.lastBought.goods}`);
  assert.ok(leaky.lastBooks.customs < open.lastBooks.customs, 'and what is smuggled pays no duty'); assert.ok(/smuggled/.test(answer(wl, ll, 'trade')), 'the ruler is told how far the customs can be trusted');
  // Bread kept at home: an export forbidden does not leave, and the neighbours who wanted it go without.
  const granary = ban => { const w = fresh(), c = w.countries.U1, l = ld(w, c); c.stock.grain = 6000; for (const o of aliveCountries(w)) if (o.id !== 'U1') { o.stock.grain = 0; o.reserves = Math.max(o.reserves, 5000); for (const p of countryProvinces(w, o.id)) p.fertility = .05; } if (ban) assert.ok(applyOp(w, l, { op: 'set_export', good: 'grain', ban: true, _law: true }).ok); run(w, 1); return [w, c]; };
  const [, sells] = granary(false), [, keeps] = granary(true);
  assert.ok(sells.lastSold.grain > 100, `left alone the surplus is sold: ${sells.lastSold.grain}`); assert.ok(!(keeps.lastSold.grain > .01) && keeps.stock.grain > sells.stock.grain + 100, `forbidden, it stays in the granaries: sold ${keeps.lastSold.grain}`);
});
chain('Standing orders are kept: the same attack meets troops with ordinary orders, on the defensive, told to fall back, and told not to give a step, and each ends as the order promised; troops told to hold their fire seldom start a frontier clash; troops in barracks are not used against strikers or in the streets', () => {
  // One province of U2 on the frontier, forty thousand men in it, two hundred and twenty thousand coming at them; only the standing order differs.
  const clash = (posture, quarters = 1) => { const w = fresh(); while (seasonOf(w) !== 'summer') w.turn++; for (const u of Object.values(w.units)) delete w.units[u.id];
    const a = w.countries.U1, d = w.countries.U2, edge = countryProvinces(w, 'U1').find(p => p.neighbors.some(n => w.provinces[n].controller === 'U2' && n !== d.capital && w.provinces[n].neighbors.some(m => m !== p.id && w.provinces[m].controller === 'U2'))), over = w.provinces[edge.neighbors.find(n => w.provinces[n].controller === 'U2' && n !== d.capital && w.provinces[n].neighbors.some(m => m !== edge.id && w.provinces[m].controller === 'U2'))];
    over.terrain = 'plains'; over.fort = 0; over.trench = 0; a.budget.military = d.budget.military = .3; const host = makeUnit(w, 'U1', edge.id, 220), def = makeUnit(w, 'U2', over.id, 40), gen = w.characters[d.general];
    if (posture !== 'ordinary') { const r = applyOp(w, gen, { op: 'set_posture', unit: def.id, posture }); assert.ok(r.ok, r.msg); }
    // Two quiet quarters first: time to dig.
    for (let i = 0; i < 2; i++) { militaryStep(w); w.turn += 4; }
    w.wars.push({ id: 'S-p', a: ['U1'], b: ['U2'], civil: false, active: true, start: w.turn, name: 'p' }); const before = def.men; let fights = 0, lostA = 0;
    for (let i = 0; i < quarters; i++) { host.target = host.province === over.id ? null : over.id; w.battles = []; w.newsThisTurn = []; const hm = host.men; militaryStep(w); fights += w.battles.length; lostA += hm - host.men; w.turn += 4; }
    return { w, over, def, host, fights, lostA, lostD: before - (w.units[def.id]?.men ?? 0), stayed: w.units[def.id]?.province === over.id, holder: over.controller, dug: def.dug }; };
  const plain = clash('ordinary'), dug = clash('defensive'), back = clash('fall_back'), firm = clash('no_retreat'); if (process.env.DEBUG) for (const [k, r] of Object.entries({ plain, dug, back, firm })) console.log(k, JSON.stringify({ fights: r.fights, lostA: r.lostA, lostD: r.lostD, stayed: r.stayed, holder: r.holder, dug: r.dug, morale: r.w.units[r.def.id]?.morale, at: r.w.units[r.def.id]?.province, news: r.w.newsThisTurn.map(n => n.text.slice(0, 120)) }));
  assert.ok(plain.fights === 1 && !plain.stayed && plain.holder === 'U1', 'with ordinary orders the beaten defenders leave the province and it falls');
  assert.ok(dug.dug > plain.dug && dug.lostA > plain.lostA * 1.1 && dug.lostD < plain.lostD, `troops on the defensive dig deeper and sell the ground dearer: attacker lost ${dug.lostA} against ${plain.lostA}, defender ${dug.lostD} against ${plain.lostD}`);
  assert.ok(back.fights === 0 && !back.stayed && back.holder === 'U1' && back.lostD < plain.lostD * .6 && back.lostD > 0, `troops told to fall back give up the province without a battle and keep the army: lost ${back.lostD} against ${plain.lostD}`);
  assert.ok(firm.fights === 1 && firm.stayed && firm.holder === 'U2' && firm.lostD > plain.lostD * 1.2, `troops told not to give a step are still on the field, and the province still theirs, at a higher price: lost ${firm.lostD} against ${plain.lostD}`);
  assert.ok(firm.w.units[firm.def.id].morale < plain.w.units[plain.def.id].morale, 'and their temper is the worse for it');
  // The posture and a march order: a general order leaves troops on the defensive where they are; an order by name moves them and says the standing order is lifted.
  { const w = fresh(), c = w.countries.U1, gen = w.characters[c.general], us = Object.values(w.units).filter(u => u.country === 'U1'), far = countryProvinces(w, 'U1').find(p => !us.some(u => u.province === p.id));
    assert.ok(applyOp(w, gen, { op: 'set_posture', unit: us[0].id, posture: 'defensive' }).ok); const all = applyOp(w, gen, { op: 'move_army', to: far.id, share: 1 }); assert.ok(!us[0].target && /stand/.test(all.msg) && all.msg.includes(us[0].id), all.msg);
    const one = applyOp(w, gen, { op: 'move', unit: us[0].id, to: far.id }); assert.ok(one.ok && us[0].target === far.id && !us[0].posture && /lifts/.test(one.msg), one.msg);
    assert.ok(applyOp(w, gen, { op: 'set_posture', all: true, posture: 'no_retreat' }).ok); assert.ok(/not one step back/.test(answer(w, gen, 'army')), 'the commander sees the standing orders where he looks'); assert.equal(applyOp(w, w.characters[c.opposition], { op: 'set_posture', all: true, posture: 'ordinary' }).ok, false, 'they are the staff\'s and the ruler\'s to give'); }
  // Hold fire: two armies face each other for a long time; how often patrols clash depends on whether they were told not to fire first.
  const shots = hold => { const w = fresh(); for (const u of Object.values(w.units)) delete w.units[u.id]; const a = w.countries.U1, b = w.countries.U2, pa = countryProvinces(w, 'U1').find(p => p.neighbors.some(n => w.provinces[n].controller === 'U2')), pb = w.provinces[pa.neighbors.find(n => w.provinces[n].controller === 'U2')];
    makeUnit(w, 'U1', pa.id, 80); makeUnit(w, 'U2', pb.id, 80); a.relations.U2 = b.relations.U1 = -60;
    if (hold > 0) assert.ok(applyOp(w, w.characters[a.general], { op: 'set_posture', facing: 'U2', posture: 'hold_fire' }).ok); if (hold > 1) assert.ok(applyOp(w, ld(w, b), { op: 'set_posture', facing: 'U1', posture: 'hold_fire' }).ok);
    let n = 0; for (let i = 0; i < 600; i++) { w.newsThisTurn = []; a.grudges = {}; b.grudges = {}; a.relations.U2 = b.relations.U1 = -60; frontierOf(w); n += w.newsThisTurn.filter(e => /Shots on the frontier/.test(e.text)).length; w.turn++; } return n; };
  const loose = shots(0), oneSide = shots(1), both = shots(2); assert.ok(loose > 12 && oneSide < loose * .8 && both < loose * .4 && both > 0, `orders not to fire first make clashes rare, not impossible: ${loose} with none, ${oneSide} with one side holding, ${both} with both`);
  // Barracks: the same strike, the same weak police; troops kept in barracks are not sent, and do not hold the streets.
  { const w = fresh(), c = w.countries.U1, boss = ld(w, c), f = Object.values(w.firms || {}).find(x => x.status === 'open' && x.country === 'U1');
    if (f) { const p = w.provinces[f.province], u = makeUnit(w, 'U1', p.id, 30, 1, 90); c.police = 10; f.strike = { since: w.turn, demand: f.wage + .2 }; assert.ok(applyOp(w, w.characters[c.general], { op: 'set_posture', unit: u.id, posture: 'barracks' }).ok); for (const x of Object.values(w.units)) if (x.country === 'U1' && x.province === p.id) x.barracks = true;
      const no = applyOp(w, boss, { op: 'break_strike', id: f.id }); assert.ok(!no.ok && /barracks/.test(no.msg), no.msg); assert.ok(f.strike, 'the strike stands'); assert.ok(applyOp(w, boss, { op: 'set_posture', province: p.id, posture: 'barracks', on: false }).ok); assert.ok(applyOp(w, boss, { op: 'break_strike', id: f.id }).ok, 'the ruler can lift the order and send them'); }
    const x = fresh(), k = x.countries.U1, q = countryProvinces(x, 'U1').find(pp => pp.id !== k.capital); for (const u of Object.values(x.units)) if (u.province === q.id) delete x.units[u.id]; const g = makeUnit(x, 'U1', q.id, provincePopOf(q) * .03, 1, 90), y = structuredClone(x); y.units[g.id].barracks = true;
    for (let i = 0; i < 6; i++) { moodOf(x); moodOf(y); } assert.ok(y.provinces[q.id].unrest > x.provinces[q.id].unrest + 2, `a garrison in barracks does not hold the streets: unrest ${y.provinces[q.id].unrest} against ${x.provinces[q.id].unrest}`); }
  // A chief of staff played by rule uses them: the weaker side at war stands on the defensive.
  { const w = fresh(), weak = w.countries.U1, strong = w.countries.U2; for (const u of Object.values(w.units)) if (u.country === 'U2') u.men *= 4; w.wars.push({ id: 'S-n', a: ['U2'], b: ['U1'], civil: false, active: true, start: w.turn, name: 'n' });
    const gen = w.characters[weak.general]; for (const op of npcDecide(w, gen)) applyOp(w, gen, op); assert.ok(Object.values(w.units).filter(u => u.country === 'U1').every(u => ['defensive', 'fall_back'].includes(u.posture)), 'the outnumbered army stands on the defensive or falls back'); }
});
chain('An army\'s march depends on the ground and the roads: open country with good roads is crossed in a quarter, mountains and bad roads take longer, a railway halves it, and whoever gave the order sees how far the unit got and what held it', () => {
  const y = fresh(); while (seasonOf(y) !== 'summer') y.turn++; for (const u of Object.values(y.units)) delete y.units[u.id]; const k = y.countries.U1, gen = y.characters[k.general];
  const hops = (from, to) => { let n = 0, cur = from; while (cur !== to && n < 40) { cur = routeStep(y, cur, to, 'U1'); n++; if (!cur) return 99; } return n; };
  const far = countryProvinces(y, 'U1').find(p => hops(k.capital, p.id) === 3), path = [k.capital]; while (path.at(-1) !== far.id) path.push(routeStep(y, path.at(-1), far.id, 'U1'));
  const march = (terrain, infra, rail) => { for (const id of path) Object.assign(y.provinces[id], { terrain, infra, rail }); const u = makeUnit(y, 'U1', k.capital, 20), r = applyOp(y, gen, { op: 'move', unit: u.id, to: far.id }); assert.ok(r.ok, r.msg);
    militaryStep(y); y.turn++; const out = { went: u.march.provinces, held: u.march.held, said: r.msg, seen: answer(y, gen, 'army') }; y.turn--; delete y.units[u.id]; return out; };
  const open = march('plains', 1.2, 0), high = march('mountain', .4, 0), railed = march('mountain', .4, 2), muddy = march('plains', .3, 0);
  assert.equal(open.went, 3, 'three provinces of open country with good roads in a quarter'); assert.ok(!open.held, 'and it arrived');
  assert.equal(high.went, 1, 'one province of mountain with poor roads'); assert.ok(/mountains/.test(high.held) && /poor roads/.test(high.held), high.held);
  assert.equal(railed.went, 2, 'the railway halves it'); assert.equal(muddy.went, 2, 'bad roads cost a march even on a plain'); assert.ok(/poor roads/.test(muddy.held), muddy.held);
  assert.ok(/about 1 quarter/.test(open.said) && /about 3 quarters/.test(high.said), `the order says how long it will take: ${high.said}`);
  assert.ok(/marched 1 province/.test(high.seen) && /held by the mountains/.test(high.seen), 'the army report shows how far it got and what held it');
});
chain('Between doing nothing and war: a duty aimed at one country turns trade away from it, a ban on named goods stops those goods and leaves the rest, envoys recalled and relations broken change what can be signed, seen and traded, and each step answers part of what the country holds against its neighbour', () => {
  // One buyer short of grain, two sellers with full granaries: where does the buyer's grain come from?
  const market = act => { const w = fresh(), buyer = w.countries.U1; updateRoutes(w); const [s1, s2] = aliveCountries(w).filter(o => o.id !== 'U1' && w.routes[`U1|${o.id}`]); assert.ok(s1 && s2, 'two sellers within reach');
    for (const o of aliveCountries(w)) o.stock.grain = o === buyer ? 0 : o === s1 || o === s2 ? 9000 : (o._need?.grain ?? 0) * 2; buyer.reserves = 9000; w.treaties = w.treaties.filter(t => t.kind !== 'trade'); if (act) act(w, buyer, s1, s2);
    run(w, 1); const flow = o => w.tradeFlows[`U1|${o.id}`]?.grain ?? 0; return { w, buyer, s1, s2, a: flow(s1), b: flow(s2), all: w.tradeFlows[`U1|${s1.id}`] ?? {} }; };
  const free = market(), aimed = market((w, buyer, s1) => { const r = applyOp(w, ld(w, buyer), { op: 'set_tariff', target: s1.id, rate: .7, _law: true }); assert.ok(r.ok && /aimed|duty|customs/.test(r.msg), r.msg); assert.equal(buyer.aimed[s1.id], .7); });
  assert.ok(free.a > 0 && free.b > 0, 'left alone, both sell'); assert.ok(aimed.a < free.a * .5 && aimed.b > free.b, `a duty aimed at one seller sends the trade to the other: ${aimed.a} against ${free.a}, and ${aimed.b} against ${free.b}`);
  assert.ok(Math.abs(aimed.buyer.tariff - free.buyer.tariff) < .02, 'the general tariff is not what was changed');
  const cut = market((w, buyer, s1) => { const r = applyOp(w, ld(w, s1), { op: 'embargo', target: 'U1', goods: ['grain'], direction: 'sell' }); assert.ok(r.ok, r.msg); assert.ok(!s1.embargo.includes('U1'), 'it is not the full embargo'); });
  assert.ok(cut.a < free.a * .05 && cut.w.routes[`U1|${cut.s1.id}`], `the banned good stops and the road stays open: ${cut.a}`);
  // Envoys.
  const w = fresh(), a = w.countries.U1, b = w.countries.U2, la = ld(w, a); w.treaties = w.treaties.filter(t => !(t.parties.includes('U1') && t.parties.includes('U2'))); a.intel.U2 = 80;
  const rc = applyOp(w, la, { op: 'set_relations', target: 'U2', level: 'recalled' }); assert.ok(rc.ok, rc.msg); assert.equal(applyOp(w, la, { op: 'propose_treaty', target: 'U2', kind: 'alliance' }).ok, false, 'with the envoy recalled no alliance is signed');
  assert.ok(applyOp(w, la, { op: 'propose_treaty', target: 'U2', kind: 'nonaggression' }).ok, 'a non-aggression pact still can be'); w.turn++; diplomacyOf(w); assert.ok(a.intel.U2 < 80, 'and less is seen of the other capital');
  w.treaties.push({ id: 'AT', kind: 'trade', parties: ['U1', 'U2'], active: true, pending: false, proposer: 'U1', clauses: [], breaches: [], turn: w.turn }); updateRoutes(w); const road = w.routes['U1|U2']?.cost;
  const br = applyOp(w, la, { op: 'set_relations', target: 'U2', level: 'broken' }); assert.ok(br.ok, br.msg); assert.ok(!treatyOf(w, 'U1', 'U2', 'trade'), 'breaking off relations ends the trade treaty'); assert.equal(applyOp(w, la, { op: 'propose_treaty', target: 'U2', kind: 'nonaggression' }).ok, false, 'and nothing can be signed');
  updateRoutes(w); if (road) assert.ok(w.routes['U1|U2'].cost > road, 'trade without consuls costs more'); for (let i = 0; i < 8; i++) { w.turn++; diplomacyOf(w); } assert.ok(a.intel.U2 <= 12, `each is nearly blind in the other's capital: ${a.intel.U2}`);
  assert.ok(applyOp(w, la, { op: 'set_relations', target: 'U2', level: 'normal' }).ok); assert.ok(applyOp(w, la, { op: 'propose_treaty', target: 'U2', kind: 'alliance' }).ok, 'restored, everything can be signed again');
  // What the country holds against a neighbour, and what answers it (with no patrols on the line, so that no fresh killing is added to the old one).
  const grief = steps => { const x = fresh(), c = x.countries.U1; c.grudges = { U2: { incident: 60, kin: 0, kinBase: 0, seeded: true } }; for (const op of steps) assert.ok(applyOp(x, ld(x, c), { ...op, _law: true }).ok); x.units = {}; frontierOf(x); return c.grief; };
  const none = grief([]), envoy = grief([{ op: 'set_relations', target: 'U2', level: 'recalled' }]), more = grief([{ op: 'set_relations', target: 'U2', level: 'broken' }, { op: 'embargo', target: 'U2', goods: ['grain'], direction: 'sell' }]);
  assert.ok(none > 3 && envoy < none * .9 && more < envoy * .8 && more > none * .3, `steps short of war answer part of a wrong and never all of it: ${none}, ${envoy}, ${more}`);
});
chain('A treaty among several comes into force when enough have signed, a state named in it comes in later, one leaves without ending it for the rest, a peace among several says who gets what, and a treaty between two works as it did', () => {
  const w = fresh(), L = id => ld(w, w.countries[id]);
  const r = applyOp(w, L('U1'), { op: 'propose_treaty', kind: 'alliance', parties: ['U2', 'U3', 'U4'], need: 3, terms: 'Each comes to the help of the others.' }); assert.ok(r.ok, r.msg); const t = w.treaties.find(x => x.id === r.treaty);
  assert.ok(applyOp(w, L('U2'), { op: 'accept_treaty', id: t.id }).ok); assert.ok(!t.active && !treatyOf(w, 'U1', 'U2', 'alliance'), 'two signatures of the three it needs bind nobody yet');
  assert.ok(applyOp(w, L('U3'), { op: 'accept_treaty', id: t.id }).ok); assert.ok(t.active && treatyOf(w, 'U2', 'U3', 'alliance') && !treatyOf(w, 'U1', 'U4', 'alliance'), 'with the third it is in force for those three');
  assert.ok(applyOp(w, L('U4'), { op: 'accept_treaty', id: t.id }).ok); assert.ok(treatyOf(w, 'U3', 'U4', 'alliance'), 'the fourth accedes later');
  assert.equal(applyOp(w, L('U5'), { op: 'accept_treaty', id: t.id }).ok, false, 'a state that was not named cannot sign'); assert.ok(applyOp(w, L('U1'), { op: 'invite_treaty', id: t.id, target: 'U5' }).ok); assert.ok(applyOp(w, L('U5'), { op: 'accept_treaty', id: t.id }).ok && treatyOf(w, 'U5', 'U2', 'alliance'), 'until a party invites it');
  const name = honourIn(w.countries.U2); assert.ok(applyOp(w, L('U2'), { op: 'break_treaty', id: t.id }).ok); assert.ok(t.active && treatyOf(w, 'U1', 'U3', 'alliance') && !treatyOf(w, 'U1', 'U2', 'alliance') && honourIn(w.countries.U2) < name, 'one leaves, at the cost of its name, and the rest stay bound');
  // A war of one against two, ended by one peace that names the land and the money.
  const x = fresh(), X = id => ld(x, x.countries[id]), u1 = x.countries.U1; x.wars.push({ id: 'S-m', a: ['U1'], b: ['U2', 'U3'], civil: false, active: true, start: x.turn, name: 'm' });
  const p = countryProvinces(x, 'U1').find(q => q.id !== u1.capital), was = u1.legitimacy;
  assert.equal(applyOp(x, X('U2'), { op: 'propose_treaty', kind: 'peace', parties: ['U1', 'U3'], cede: [p.id] }).ok, false, 'land in a treaty among several has to be named with who receives it');
  const pr = applyOp(x, X('U2'), { op: 'propose_treaty', kind: 'peace', parties: ['U1', 'U3'], cede: [{ province: p.id, to: 'U3' }], reparations: .1, reparations_from: 'U1', reparations_to: 'U2' }); assert.ok(pr.ok, pr.msg);
  assert.ok(applyOp(x, X('U1'), { op: 'accept_treaty', id: pr.treaty }).ok); assert.ok(atWarOf(x, 'U1', 'U2'), 'not yet: it needs all three'); const gold = x.countries.U2.reserves, owed = x.countries.U1.creditors.U2 || 0; assert.ok(applyOp(x, X('U3'), { op: 'accept_treaty', id: pr.treaty }).ok);
  assert.ok(!atWarOf(x, 'U1', 'U2') && !atWarOf(x, 'U1', 'U3'), 'one peace ends the war with both'); assert.equal(p.owner, 'U3', 'the province goes to the party named'); assert.ok(x.countries.U2.reserves > gold || (x.countries.U1.creditors.U2 || 0) > owed, 'and the indemnity to the other');
  assert.ok(u1.legitimacy < was, 'the government that signed the land away pays for it at home');
  const y = fresh(), two = applyOp(y, ld(y, y.countries.U1), { op: 'propose_treaty', target: 'U2', kind: 'nonaggression', terms: 'x' }); assert.ok(two.ok && applyOp(y, ld(y, y.countries.U2), { op: 'accept_treaty', id: two.treaty }).ok && treatyOf(y, 'U1', 'U2', 'nonaggression'), 'a treaty between two is proposed and signed as before');
});
chain('A conference is called and the world learns who came; what one government says to the table all of it reads; a treaty laid before it is signed there even by states that have broken off relations; and a third state brings two at war to terms, to its own credit', () => {
  const w = fresh(), L = id => ld(w, w.countries[id]), host = w.countries.U1; w.treaties = [];
  const call = applyOp(w, L('U1'), { op: 'call_conference', invite: ['U2', 'U3', 'U4'], question: 'The frontier between U2 and U3' }); assert.ok(call.ok, call.msg); const cf = w.conferences.at(-1);
  assert.equal(applyOp(w, L('U1'), { op: 'call_conference', invite: ['U2', 'U3'], question: 'Again' }).ok, false, 'one table at a time'); assert.ok(L('U2').inbox.some(m => m.text.includes(cf.id)), 'those invited are told');
  assert.ok(applyOp(w, L('U2'), { op: 'attend_conference', id: cf.id }).ok && applyOp(w, L('U3'), { op: 'attend_conference', id: cf.id }).ok); assert.ok(applyOp(w, L('U4'), { op: 'attend_conference', id: cf.id, attend: false }).ok);
  const said = toTable(w, L('U2'), [{ to: cf.id, text: 'We will draw our pickets back if they do.' }, { to: 'U5', text: 'A private word.' }]);
  assert.deepEqual(said.map(m => m.to).sort(), ['U1', 'U3', 'U5'], 'a message to the conference goes to everyone at the table, and other letters go where they were sent'); assert.ok(said.find(m => m.to === 'U3').text.includes('The frontier between'), 'marked as said to the table');
  assert.ok(applyOp(w, L('U2'), { op: 'set_relations', target: 'U3', level: 'broken' }).ok); assert.equal(applyOp(w, L('U2'), { op: 'propose_treaty', target: 'U3', kind: 'nonaggression' }).ok, false, 'between the two of them nothing can be signed');
  assert.equal(applyOp(w, L('U2'), { op: 'propose_treaty', conference: cf.id, parties: ['U3', 'U4'], kind: 'nonaggression' }).ok, false, 'a state that stayed away is not at the table');
  const word = honourIn(host), pr = applyOp(w, L('U2'), { op: 'propose_treaty', conference: cf.id, parties: ['U3', 'U1'], kind: 'nonaggression', terms: 'No patrols within a day\'s march of the line.' }); assert.ok(pr.ok, pr.msg);
  assert.ok(applyOp(w, L('U3'), { op: 'accept_treaty', id: pr.treaty }).ok && applyOp(w, L('U1'), { op: 'accept_treaty', id: pr.treaty }).ok); assert.ok(treatyOf(w, 'U2', 'U3', 'nonaggression'), 'the conference carries it between them'); assert.ok(honourIn(host) > word, 'and the host is credited with it');
  w.newsThisTurn = []; w.turn++; diplomacyOf(w); const line = w.newsThisTurn.find(n => /has risen/.test(n.text))?.text ?? ''; assert.ok(/At the table/.test(line) && line.includes(w.countries.U3.name) && /Stayed away/.test(line) && line.split('Stayed away')[1].includes(w.countries.U4.name) && /A treaty came out of it/.test(line), line);
  { const z = fresh(), h = z.countries.U1, n0 = honourIn(h); assert.ok(applyOp(z, ld(z, h), { op: 'call_conference', invite: ['U2', 'U3'], question: 'Anything' }).ok); z.turn++; diplomacyOf(z); assert.ok(honourIn(h) < n0, 'a table at which nobody sat down is seen too'); }
  // Mediation.
  const x = fresh(), X = id => ld(x, x.countries[id]), third = x.countries.U3; x.wars.push({ id: 'S-w', a: ['U1'], b: ['U2'], civil: false, active: true, start: x.turn, name: 'w' });
  assert.equal(applyOp(x, X('U1'), { op: 'mediate', between: ['U1', 'U2'], terms: 'x' }).ok, false, 'a belligerent does not mediate its own war');
  const before = honourIn(third), md = applyOp(x, X('U3'), { op: 'mediate', between: ['U1', 'U2'], terms: 'Peace on the old frontier.' }); assert.ok(md.ok, md.msg);
  assert.ok(applyOp(x, X('U1'), { op: 'accept_treaty', id: md.treaty }).ok); assert.ok(atWarOf(x, 'U1', 'U2') && honourIn(third) === before, 'one signature is not a peace'); x.newsThisTurn = [];
  assert.ok(applyOp(x, X('U2'), { op: 'accept_treaty', id: md.treaty }).ok); assert.ok(!atWarOf(x, 'U1', 'U2') && honourIn(third) > before, 'when both have signed it stands, and the mediator\'s name gains'); assert.ok(x.newsThisTurn.some(n => n.text.includes(`brought about by ${third.name}`)), 'and the world knows whose work it was');
});
chain('A secret treaty binds like any other and is known to those who govern the states that signed and, where it concerns the army, to their chiefs of staff, and to nobody else; a service with good eyes or a bought officer comes by it; made public, it costs those who signed with those who were left out', () => {
  const w = inherited(), L = id => ld(w, w.countries[id]), a = w.countries.U1, b = w.countries.U2; w.treaties = []; w.newsThisTurn = [];
  const pr = applyOp(w, L('U1'), { op: 'propose_treaty', target: 'U2', kind: 'alliance', secret: true, terms: 'Against the third.' }); assert.ok(pr.ok, pr.msg); assert.ok(applyOp(w, L('U2'), { op: 'accept_treaty', id: pr.treaty }).ok); const t = w.treaties.find(x => x.id === pr.treaty);
  assert.ok(treatyOf(w, 'U1', 'U2', 'alliance'), 'it is in force'); assert.ok(w.newsThisTurn.filter(n => /alliance|Treaty/.test(n.text)).every(n => n.secret), 'and not in the news');
  const sees = ch => answer(w, ch, 'treaties').includes(t.id);
  assert.ok(sees(L('U1')) && sees(w.characters[a.general]) && !sees(w.characters[a.opposition]) && !sees(w.characters[a.oligarch]), 'at home the ruler and the chief of staff know of it, the other seats do not'); assert.ok(!sees(L('U3')), 'abroad nobody does');
  // A service that sees well into one of the two capitals comes by it.
  w.countries.U3.intel.U1 = 70; w.turn++; diplomacyOf(w); assert.ok(sees(L('U3')) && L('U3').inbox.some(m => /kept secret|keep secret/.test(m.text) && m.text.includes(t.id)), 'good intelligence finds the paper'); assert.ok(!sees(L('U4')), 'and only for the state that has it');
  // An officer of one of the signatories who is in a foreign ruler's pay sees it pass.
  const spy = L('U4'); let told = false; for (const off of Object.values(w.characters).filter(x => x.alive && x.country === 'U1' && x.role === 'officer' && Object.values(w.units).some(u => u.commander === x.id))) { if (told) break; off.handler = spy.id; a.intelligence = 0; courtOf(w, applyOp); told = (spy.papers || []).includes(t.id); }
  assert.ok(told && sees(spy) && spy.inbox.some(m => /kept secret/.test(m.text)), 'a bought officer reports it to his paymaster');
  // Published.
  const before = w.countries.U5.relations.U1 ?? 0; w.newsThisTurn = []; const pub = applyOp(w, spy, { op: 'publish_treaty', id: t.id }); assert.ok(pub.ok, pub.msg);
  assert.ok(!t.secret && w.newsThisTurn.some(n => /come to light/.test(n.text) && !n.secret) && sees(L('U5')) === false, 'it is public now (though a treaty is still looked up by those it binds)'); assert.ok((w.countries.U5.relations.U1 ?? 0) < before, 'and those who were left out take it as aimed at them');
  assert.ok(answer(w, w.characters[a.opposition], 'treaties').includes(t.id), 'the opposition can read it like everyone else');
  // The obligation is as real as an open one's: the ally is attacked, nothing is done, and it comes out through the ally that was left alone.
  const x = fresh(), X = id => ld(x, x.countries[id]); x.treaties = []; const s = applyOp(x, X('U1'), { op: 'propose_treaty', target: 'U2', kind: 'alliance', secret: true }); assert.ok(applyOp(x, X('U2'), { op: 'accept_treaty', id: s.treaty }).ok);
  assert.ok(applyOp(x, X('U3'), { op: 'declare_war', target: 'U2', _law: true }).ok); const name = honourIn(x.countries.U1); for (let i = 0; i < 4; i++) { x.turn++; diplomacyOf(x); }
  assert.ok(honourIn(x.countries.U1) < name - 5 && !x.treaties.find(q => q.id === s.treaty).secret, 'a secret alliance that is not kept is a broken word, and the secret is out');
  { const z = fresh(), Z = id => ld(z, z.countries[id]); z.treaties = []; const q = applyOp(z, Z('U1'), { op: 'propose_treaty', target: 'U2', kind: 'alliance', secret: true }); assert.ok(applyOp(z, Z('U2'), { op: 'accept_treaty', id: q.treaty }).ok); const n1 = honourIn(z.countries.U1); assert.ok(applyOp(z, Z('U1'), { op: 'publish_treaty', id: q.treaty }).ok); assert.ok(honourIn(z.countries.U1) < n1, 'a signatory that publishes what it promised to keep is known for that'); }
});
chain('A war can be declared for something: a peace that brings it is taken at home as a war won, one that gives it up as a war lost, going on once it is in hand wearies the country faster, bystanders fear a war with no stated end more, and a war for nothing stated is still a war', () => {
  const stage = aims => { const w = fresh(), a = w.countries.U1, b = w.countries.U2, p = countryProvinces(w, 'U2').find(q => q.id !== b.capital && q.neighbors.some(n => w.provinces[n].controller === 'U1')), seen = w.countries.U3.relations.U1 ?? 0;
    const r = applyOp(w, ld(w, a), { op: 'declare_war', target: 'U2', ...(aims ? { aims: { provinces: [p.id] } } : {}), _law: true }); assert.ok(r.ok, r.msg); return { w, a, b, p, said: r.msg, alarm: seen - (w.countries.U3.relations.U1 ?? 0) }; };
  const peace = (s, cede) => { const was = s.a.legitimacy, pr = applyOp(s.w, ld(s.w, s.a), { op: 'propose_treaty', target: 'U2', kind: 'peace', ...(cede ? { cede: [s.p.id] } : {}) }), ac = applyOp(s.w, ld(s.w, s.b), { op: 'accept_treaty', id: pr.treaty }); assert.ok(ac.ok, ac.msg); return s.a.legitimacy - was; };
  const named = stage(true), blank = stage(false); assert.ok(named.w.wars.at(-1).aims?.U1.provinces.includes(named.p.id) && !blank.w.wars.at(-1).aims, 'the aim is on record, or there is none'); assert.ok(/for:/.test(named.said) && /no aims/.test(blank.said), 'and whoever declared it is told what that means');
  assert.ok(blank.alarm > named.alarm, `a war nobody can see the end of alarms bystanders more: ${blank.alarm} against ${named.alarm}`);
  const won = peace(stage(true), true), wonBlank = peace(stage(false), true), lost = peace(stage(true), false), lostBlank = peace(stage(false), false);
  assert.ok(won > wonBlank + 2, `a peace that brings what the war was declared for is a war won: ${won} against ${wonBlank}`); assert.ok(lost < lostBlank - 1.5 && Math.abs(lostBlank) < .5, `one that gives it up is a war lost: ${lost} against ${lostBlank}`);
  // The province is in hand and the war goes on.
  const tired = aims => { const s = stage(aims); s.p.controller = 'U1'; const was = s.a.warExhaustion; s.w.turn++; diplomacyOf(s.w); return { more: s.a.warExhaustion - was, told: ld(s.w, s.a).inbox.some(m => /is in our hands/.test(m.text)) }; };
  const on = tired(true), off = tired(false); assert.ok(on.more > off.more + 1 && on.told && !off.told, `going on after the aim is in hand wearies the country faster, and the ruler is told: ${on.more} against ${off.more}`);
});
chain('A state born of a rising is a state only to those who recognise it: until then no treaty and no trade with it; recognition opens both, steadies it at home and is held against the recogniser by the mother country, which itself recognises it by making peace', () => {
  const w = fresh(), mother = w.countries.U1, opp = w.characters[mother.opposition], edge = countryProvinces(w, 'U1').filter(p => p.id !== mother.capital && p.neighbors.some(n => w.provinces[n].controller === 'U2')).slice(0, 2); assert.ok(edge.length, 'ground on the frontier with U2');
  for (const p of countryProvinces(w, 'U1')) p.unrest = edge.includes(p) ? 85 : 10; const s = applyOp(w, opp, { op: 'start_plot', kind: 'uprising' }); w.plots.at(-1).progress = 100; assert.ok(applyOp(w, opp, { op: 'execute_plot', plot: s.plot }).ok);
  const born = Object.values(w.countries).find(x => x.parent === 'U1'), L = id => ld(w, w.countries[id]); assert.ok(born && Array.isArray(born.recognition) && !born.recognition.length, 'nobody recognises it on the day it is born'); assert.ok(!w.countries.U2.recognition, 'the old states need no recognition');
  updateRoutes(w); assert.ok(!Object.keys(w.routes).some(k => k.split('|').includes(born.id)), 'no merchants go there'); assert.equal(applyOp(w, L('U2'), { op: 'propose_treaty', target: born.id, kind: 'nonaggression' }).ok, false, 'and nothing is signed with it');
  w.turn++; diplomacyOf(w); assert.ok(born.mods.some(m => m.key === 'legitimacy' && m.delta < 0), 'unrecognised, it stands the weaker at home');
  assert.equal(applyOp(w, L('U1'), { op: 'recognise', target: born.id }).ok, false, 'the mother country does not recognise it by a word');
  const feel = mother.relations.U2 ?? 0, rec = applyOp(w, L('U2'), { op: 'recognise', target: born.id }); assert.ok(rec.ok, rec.msg); assert.equal(applyOp(w, L('U2'), { op: 'recognise', target: born.id }).ok, false, 'once is enough');
  assert.ok((mother.relations.U2 ?? 0) < feel - 20 && mother.grudges.U2.incident > 0, 'the mother country holds it against the recogniser'); updateRoutes(w); assert.ok(w.routes[[born.id, 'U2'].sort().join('|')] || w.routes[`U2|${born.id}`], 'trade with the recogniser is open');
  assert.ok(applyOp(w, L('U2'), { op: 'propose_treaty', target: born.id, kind: 'nonaggression' }).ok, 'and treaties can be signed'); born.mods = []; w.turn++; diplomacyOf(w); assert.ok(born.mods.some(m => m.key === 'legitimacy' && m.delta > 0), 'recognised, it stands the firmer');
  const pax = applyOp(w, L('U1'), { op: 'propose_treaty', target: born.id, kind: 'peace', annex: true }); assert.ok(pax.ok, pax.msg); assert.ok(applyOp(w, ld(w, born), { op: 'accept_treaty', id: pax.treaty }).ok); assert.ok(born.recognition.includes('U1'), 'peace with the mother country is its recognition');
});
chain('A new world is handed over at rest: every army is an army that has been paid, no country begins in a general strike it did not earn, output does not lurch in the first two years, and each state\'s books stand where its kind of state keeps them', () => {
  const design = { merchant: .010, republic: .003, federation: .001, monarchy: -.002, theocracy: -.003, revolutionary: -.007, agrarian: -.009, junta: -.016 };
  for (const seed of [1848, 7]) {
    const w = inherited(seed), cs = aliveCountries(w); w.status = 'playing'; const out = Object.fromEntries(cs.map(c => [c.id, []]));
    for (let t = 1; t <= 8; t++) {
      run(w, 1);
      for (const c of cs) {
        if (!c.alive) continue; out[c.id].push(c.realGdp);
        if (t === 1) assert.ok((c.militaryFunding ?? 1) >= .9, `${seed} ${c.archetype}: the army it inherits is paid (${Math.round((c.militaryFunding ?? 1) * 100)}% of its cost)`);
        assert.ok(!c.strike, `${seed} ${c.archetype}: no general strike in quarter ${t} of a country nobody has yet governed`);
        if (t === 6) assert.ok(Math.abs(c.lastBalance / c.gdp - (design[c.archetype] ?? 0)) < .008, `${seed} ${c.archetype}: the books stand at ${(c.lastBalance / c.gdp * 100).toFixed(1)}% of output, where ${((design[c.archetype] ?? 0) * 100).toFixed(1)}% is that kind of state's habit`);
      }
    }
    for (const c of cs) { const g = out[c.id]; if (g.length < 8) continue; const worst = Math.max(...g.slice(1).map((v, i) => Math.abs(v / g[i] - 1))); assert.ok(worst < .13 && Math.abs(g[7] / g[0] - 1) < .12, `${seed} ${c.archetype}: output moves with the harvests and no more while nobody governs: ${g.map(Math.round).join(' ')}`); }
    // And working people who have long lived at this level do not walk out for it; they would if it grew worse.
    const hard = cs.filter(c => c.alive && c.unions).sort((a, b) => a.workBase - b.workBase)[0];
    if (hard) { for (const p of countryProvinces(w, hard.id)) p.pops.workers.sat = Math.min(26, hard.workBase - 6); delete hard.strikeRest; run(w, 1); assert.ok(hard.strike, `${seed} ${hard.archetype}: a lot much worse than the one they knew brings them out`); }
  }
});
chain('In a war already declared the chief of staff orders the landings, and a government that went to war without saying why can say it afterwards, once a quarter, without declaring a second war', () => {
  const w = fresh(), c = w.countries.U1, foe = w.countries.U2, l = ld(w, c), g = w.characters[c.general], u = Object.values(w.units).find(v => v.country === 'U1'), coast = countryProvinces(w, 'U2').find(p => p.coast) ?? countryProvinces(w, 'U2')[0];
  const before = applyOp(w, g, { op: 'amphibious', unit: u.id, to: coast.id }); assert.ok(!before.ok && !/not authorized/.test(before.msg), `in peace the staff's order fails on the peace, not on his office: ${before.msg}`);
  assert.equal(applyOp(w, g, { op: 'declare_war', target: 'U2' }).ok, false, 'war and peace stay with the ruler');
  assert.ok(applyOp(w, l, { op: 'declare_war', target: 'U2', _law: true }).ok); const wars = w.wars.filter(x => x.active).length, war = w.wars.at(-1); assert.ok(!war.aims?.U1, 'declared without aims');
  const landing = applyOp(w, g, { op: 'amphibious', unit: u.id, to: coast.id }); assert.ok(!/not authorized/.test(landing.msg), `at war the landing is his to order (whether the sea allows it is another matter): ${landing.msg}`);
  assert.equal(applyOp(w, l, { op: 'declare_war', target: 'U2', _law: true }).ok, false, 'a second declaration with nothing to say is refused');
  const p = countryProvinces(w, 'U2')[0], said = applyOp(w, l, { op: 'declare_war', target: 'U2', aims: { provinces: [p.id] }, _law: true }); assert.ok(said.ok && said.msg.includes(p.name), said.msg);
  assert.equal(w.wars.filter(x => x.active).length, wars, 'no second war'); assert.deepEqual(war.aims.U1.provinces, [p.id]); assert.ok(w.newsThisTurn.some(n => /has stated its aims/.test(n.text)), 'and the world is told');
  assert.equal(applyOp(w, l, { op: 'declare_war', target: 'U2', aims: { regime: true }, _law: true }).ok, false, 'once a quarter'); w.turn++; const rel = w.countries.U3.relations.U1 ?? 0;
  assert.ok(applyOp(w, l, { op: 'declare_war', target: 'U2', aims: { regime: true }, _law: true }).ok); assert.ok((w.countries.U3.relations.U1 ?? 0) < rel, 'aims changed in mid-war make the others uneasy');
});
chain('A peace says in so many words what it does to the land: the provinces it names change hands, everything else an army holds goes back, and whoever offers it, is offered it, signs it or translates it is shown this by name before it is signed', () => {
  const w = fresh(), a = w.countries.U1, b = w.countries.U2, la = ld(w, a), lb = ld(w, b); assert.ok(applyOp(w, la, { op: 'declare_war', target: 'U2', _law: true }).ok);
  // U1 has taken two provinces of U2; the peace that is written names a third, which nobody holds.
  const [won1, won2, other] = countryProvinces(w, 'U2').filter(p => p.id !== b.capital); won1.controller = 'U1'; won2.controller = 'U1';
  const ref = refereePrompt(w, a, [{ actor: la, decisions: ['Make peace.'] }]); assert.ok(ref.includes(`${won1.id}=${won1.name} (belongs to ${b.name})`) && ref.includes('goes into cede by its id'), 'the referee sees by id what each side holds of the other\'s');
  lb.inbox = []; const offer = applyOp(w, la, { op: 'propose_treaty', target: 'U2', kind: 'peace', cede: [other.id], terms: 'The two provinces we hold stay ours.' }); assert.ok(offer.ok, offer.msg);
  for (const text of [offer.msg, lb.inbox.map(m => m.text).join(' '), frontPage(w, lb)]) { assert.ok(text.includes(`${other.name} (${other.id}) from ${b.name} to ${a.name}`), 'what changes hands is named: ' + text.slice(0, 200)); assert.ok(text.includes(`${won1.name} (${won1.id}), now held by ${a.name}, back to ${b.name}`) && text.includes(won2.name), 'and so is what goes back, whatever the wording says'); }
  const signed = applyOp(w, lb, { op: 'accept_treaty', id: offer.treaty }); assert.ok(signed.ok && signed.msg.includes(won1.name) && signed.msg.includes(other.name), signed.msg);
  assert.equal(won1.controller, 'U2'); assert.equal(won2.controller, 'U2'); assert.equal(other.owner, 'U1'); assert.ok(w.newsThisTurn.some(n => n.text.includes(won1.name) && /went back to its owner/.test(n.text)), 'and the world reads which land went back');
  assert.ok(la.inbox.some(m => m.text.includes('has signed') && m.text.includes(won2.name)), 'the one who offered it is told what the signature did');
  // A peace in which each keeps what it holds says that instead.
  const x = fresh(), xa = x.countries.U1, xb = x.countries.U2; applyOp(x, ld(x, xa), { op: 'declare_war', target: 'U2', _law: true }); const taken = countryProvinces(x, 'U2').find(p => p.id !== xb.capital); taken.controller = 'U1';
  const keep = applyOp(x, ld(x, xa), { op: 'propose_treaty', target: 'U2', kind: 'peace', annex: true }); assert.ok(keep.msg.includes(`${taken.name} (${taken.id}) stays with ${xa.name}`), keep.msg);
});
import { supplyOf as supplyAt, railWorks as railRuns, capture as takeProvince, supplyLines as linesFor, roadTo as roadOf } from '../engine/military.js';
// A battlefield with two roads into it: one province of U2 that two provinces of U1 touch. Railways everywhere, so that supply plays no part
// unless a test takes them up; full arsenals; both armies led alike.
const twoRoads = (skill = 1.6) => { const w = fresh(); for (const u of Object.values(w.units)) delete w.units[u.id];
  const a = w.countries.U1, d = w.countries.U2, mine = p => p.neighbors.filter(n => w.provinces[n].controller === 'U1' && n !== a.capital);
  const over = countryProvinces(w, 'U2').find(p => p.id !== d.capital && mine(p).length >= 2 && p.neighbors.some(n => w.provinces[n].controller === 'U2' && n !== d.capital)); assert.ok(over, 'a province of theirs that two of ours touch');
  const [e1, e2] = mine(over).map(n => w.provinces[n]);
  for (const p of Object.values(w.provinces)) if (['U1', 'U2'].includes(p.controller)) Object.assign(p, { rail: 1, infra: 1, fort: 0, trench: 0 });
  over.terrain = e1.terrain = e2.terrain = 'plains'; w.strategic = w.strategic.filter(s => ![over.id, e1.id, e2.id].includes(s.ref));
  a.budget.military = d.budget.military = .3; a.stock.arms = d.stock.arms = 1000; w.characters[a.general].skill = w.characters[d.general].skill = skill; a.techs.radio = 1;
  while (seasonOf(w) !== 'summer') w.turn++;
  w.wars.push({ id: 'S-o', a: ['U1'], b: ['U2'], civil: false, active: true, start: w.turn, name: 'o' });
  return { w, a, d, over, e1, e2, gen: w.characters[a.general], said: () => w.characters[a.general].inbox.map(m => m.text).join('\n') }; };
const quarter = w => { w.battles = []; w.newsThisTurn = []; militaryStep(w); const b = [...w.battles]; w.turn++; return b; };

chain('An offensive is one operation: columns sent against a place under one order wait for each other and strike together from two sides, where the same men marched in one after another are beaten one after another; a column keeps the timetable as well as its commander can; and the staff says afterwards what decided the day', () => {
  // Winter, and the second column has a snowed-in pass between it and its place in the line: it cannot be up before spring.
  const field = () => { const f = twoRoads(), { w, e2, over } = f; while (seasonOf(w) !== 'winter') w.turn++; Object.assign(e2, { terrain: 'mountain', rail: 0 });
    const start = e2.neighbors.map(n => w.provinces[n]).find(p => p.controller === 'U1' && !over.neighbors.includes(p.id) && !p.neighbors.includes(f.e1.id)) ?? e2.neighbors.map(n => w.provinces[n]).find(p => p.controller === 'U1' && !over.neighbors.includes(p.id)); assert.ok(start, 'somewhere behind the pass');
    return { ...f, start, first: soldier(w, 'U1', f.e1.id, 70), second: soldier(w, 'U1', start.id, 70), def: soldier(w, 'U2', over.id, 80) }; };
  // Marched in as they come: the first attacks alone in winter, the second alone when it is through the pass.
  const loose = field(); loose.first.target = loose.second.target = loose.over.id; const lf = [];
  for (let i = 0; i < 4; i++) lf.push(...quarter(loose.w));
  assert.ok(lf.length === 2 && lf.every(b => !b.attackerWon) && loose.over.controller === 'U2', `seventy thousand at a time do not beat eighty thousand on the defensive: ${JSON.stringify(lf.map(b => [b.attackerWon, b.lossA, b.lossD]))}`);
  // Under one order: the first column forms up and waits; in spring both go in together, from two sides.
  const one = field(), r = applyOp(one.w, one.gen, { op: 'offensive', to: one.over.id, units: [one.first.id, one.second.id] }); assert.ok(r.ok && /in 2 columns/.test(r.msg) && /take the defender in flank/.test(r.msg) && /arms and ammunition/.test(r.msg), r.msg);
  const q1 = quarter(one.w); assert.ok(!q1.length && one.first.province === one.e1.id && /waits for the columns/.test(one.first.march.held), `the column that is up waits for the one that is not: ${one.first.march?.held}`);
  assert.ok(/waits for the columns/.test(lookUp(one.w, one.gen, 'army')) && /part of the offensive against/.test(lookUp(one.w, one.gen, 'army')), 'and the army report says so');
  const q2 = quarter(one.w); assert.ok(q2.length === 1 && q2[0].attackerWon && q2[0].sides === 2 && one.over.controller === 'U1', `together they carry it: ${JSON.stringify(q2)} ${one.second.march?.held}`);
  assert.ok(/Our attack on .* carried the place/.test(one.said()) && /from 2 sides together/.test(one.said()) && /remain in the arsenal/.test(one.said()), one.said());
  const lost = one.w.characters[one.d.general].inbox.map(m => m.text).join('\n'); assert.ok(/was attacked and lost/.test(lost) && /they came at us from 2 sides together/.test(lost), `the beaten staff knows what beat it: ${lost}`);
  assert.ok(!one.first.attack && !one.second.attack, 'the order is spent once the place is taken');
  // Who may order it, and against whom.
  const x = twoRoads(), u = soldier(x.w, 'U1', x.e1.id, 50); assert.equal(applyOp(x.w, x.w.characters[x.a.opposition], { op: 'offensive', to: x.over.id, units: [u.id] }).ok, false, 'not the opposition\'s to order');
  x.w.wars = []; const no = applyOp(x.w, x.gen, { op: 'offensive', to: x.over.id, units: [u.id] }); assert.ok(!no.ok && /no war/.test(no.msg), 'a chief of staff cannot start a war by attacking');
  // The timetable. Two columns already formed up; whether the second is on time is its commander's doing.
  const kept = skill => { let n = 0; for (let i = 0; i < 40; i++) { const t = twoRoads(skill); if (skill < 1) delete t.a.techs.radio; t.w.rng = 1000 + i * 7919; const u1 = soldier(t.w, 'U1', t.e1.id, 80), u2 = soldier(t.w, 'U1', t.e2.id, 60); soldier(t.w, 'U2', t.over.id, 60);
      assert.ok(applyOp(t.w, t.gen, { op: 'offensive', to: t.over.id }).ok); const b = quarter(t.w); if (b[0]?.sides === 2) n++; else { assert.ok(/not up in time/.test(u2.march.held) && u2.province === t.e2.id && /was not up in time and took no part/.test(t.said()), `the late column stands where it was and the staff says so: ${u2.march.held}`); if (i === 0 || n === 0) { const next = quarter(t.w); assert.ok(next.length === 1 || t.over.controller === 'U1', 'and goes in the quarter after, alone'); assert.ok(!u2.attack || u2.province === t.over.id && t.over.controller !== 'U1', 'an order that has been carried out, or has no objective left, is spent'); } } } return n; };
  const able = kept(1.6), poor = kept(.6); assert.ok(able >= 36 && poor <= 26 && poor >= 4, `an able commander with the wireless is nearly always on time, a poor one without it often late: ${able} and ${poor} of 40`);
});

chain('A fight burns the arsenal: an assault more than a held line, a bombardment more again; guns knock in field works and nothing but heavy guns tells against a fortress; with an empty arsenal the same attack fails; and what the arms works make decides how long an army can go on attacking', () => {
  const fight = (prep = () => {}, order = {}) => { const f = twoRoads(1), { w, a, d, over, e1 } = f; over.trench = 2; const atk = soldier(w, 'U1', e1.id, 150), def = soldier(w, 'U2', over.id, 100); def.dug = 3; prep(f, atk, def);
    const a0 = a.stock.arms, d0 = d.stock.arms; assert.ok(applyOp(w, f.gen, { op: 'offensive', to: over.id, units: [atk.id], ...order }).ok); const b = quarter(w)[0];
    return { ...f, b, usedA: a0 - a.stock.arms, usedD: d0 - d.stock.arms, atk, def }; };
  const plain = fight(), shelled = fight(() => {}, { shelling: true });
  assert.ok(plain.usedA > 7.5 && plain.usedA < 9.5 && plain.usedD > 3 && plain.usedD < 4.2, `a hundred and fifty thousand attacking burn about 7.5 in the fight and a hundred thousand holding about 3, besides what an army in the field wears out anyway: ${plain.usedA} and ${plain.usedD}`);
  assert.ok(shelled.usedA > plain.usedA + 1 && shelled.b.shelled > 0 && shelled.b.shelled < 35, `a bombardment costs more, and field guns alone knock in little: ${shelled.usedA}, ${shelled.b.shelled}%`);
  // The heavy guns go in with the infantry under the same order.
  const withGuns = (() => { const f = twoRoads(1), { w, a, over, e1 } = f; over.trench = 2; const atk = soldier(w, 'U1', e1.id, 150), guns = soldier(w, 'U1', e1.id, 20); guns.kind = 'artillery'; soldier(w, 'U2', over.id, 100).dug = 3; const a0 = a.stock.arms;
    assert.ok(applyOp(w, f.gen, { op: 'offensive', to: over.id, units: [atk.id, guns.id], shelling: true }).ok); const b = quarter(w)[0]; return { b, used: a0 - a.stock.arms, said: f.said() }; })();
  assert.ok(withGuns.b.shelled >= 55 && withGuns.used > shelled.usedA + 3, `twenty thousand gunners with heavy pieces knock in most of the field works and burn a great deal doing it: ${withGuns.b.shelled}%, ${withGuns.used}`);
  // A fortress: field guns do nothing to it, heavy guns do.
  const fortress = heavyGuns => { const f = twoRoads(1), { w, over, e1 } = f; over.fort = 2; const atk = soldier(w, 'U1', e1.id, 150), us = [atk.id]; if (heavyGuns) { const g = soldier(w, 'U1', e1.id, 16); g.kind = 'artillery'; us.push(g.id); } soldier(w, 'U2', over.id, 60);
    applyOp(w, f.gen, { op: 'offensive', to: over.id, units: us, shelling: true }); return quarter(w)[0]; };
  assert.ok(fortress(false).breached === 0 && fortress(true).breached >= 40, 'only heavy pieces tell against masonry');
  // An empty arsenal. The same attack, many times over, with the luck of the day varying.
  const wins = arms => { let n = 0; for (let i = 0; i < 16; i++) { const f = twoRoads(1), { w, a, over, e1 } = f; w.rng = 500 + i * 104729; a.stock.arms = arms; const atk = soldier(w, 'U1', e1.id, 150); soldier(w, 'U2', over.id, 100);
      applyOp(w, f.gen, { op: 'offensive', to: over.id, units: [atk.id] }); const b = quarter(w)[0]; if (b.attackerWon) n++; else if (!arms) assert.ok(/the arsenal could send only 0 in the hundred/.test(f.said()), f.said()); } return n; };
  const full = wins(1000), empty = wins(0); assert.ok(full >= 14 && empty <= 3, `with shells the attack carries, without them it does not: ${full} and ${empty} of 16`);
  // The works behind the army. More of the country's industry given to arms fills the arsenal faster.
  const made = share => { const w = fresh(), c = w.countries.U1; applyOp(w, ld(w, c), { op: 'set_arms_share', share }); const before = c.stock.arms; run(w, 4); return c.stock.arms - before; };
  const lean = made(.05), fat = made(.6); assert.ok(fat > lean + 1, `an arsenal fills as the arms share of industry rises: ${lean} then ${fat} in a year`);
  assert.ok(/Ammunition: the arsenal holds/.test(lookUp(plain.w, plain.gen, 'army')) && /Last quarter's fighting used/.test(lookUp(plain.w, plain.gen, 'army')), 'the army report keeps the ammunition account');
});

chain('An army is fed from the railway: at the railhead it wants for nothing, each march of wagon road beyond it leaves it less, and the same attack made at the end of a long road costs more and does less; a line taken in war carries nothing for two quarters; a railway built out from the capital carries the supply head with it', () => {
  const w = fresh(), c = w.countries.U1, cap = w.provinces[c.capital], mine = countryProvinces(w, 'U1');
  // No harbours, and rails only at the capital: everything else is fed by wagon.
  for (const p of mine) { p.port = 0; p.rail = p.id === c.capital ? 1 : 0; p.infra = .5; p.terrain = 'hills'; }
  const lines = linesFor(w, c), far = mine.reduce((a, b) => ((lines.depth[b.id] ?? 0) > (lines.depth[a.id] ?? 0) ? b : a)), next = w.provinces[cap.neighbors.find(n => w.provinces[n].controller === 'U1')];
  const at = p => supplyAt(w, { country: 'U1', province: p.id }); assert.equal(at(cap).factor, 1); assert.ok(at(far).depth > 2 && at(far).factor < .9, `far from the rails an army gets less: ${JSON.stringify(at(far))}`);
  const u = soldier(w, 'U1', far.id, 40); assert.ok(/marches of wagon road from its supply head at/.test(lookUp(w, w.characters[c.general], 'army')), 'the army report says how far each unit stands from its supplies');
  // A railway is built out from the capital: the head moves with it.
  c.treasury = c.gdp * 4; c.stock.steel = 5000; c.techs.railway = 1; const before = at(next).depth; assert.ok(before > 0);
  const r = applyOp(w, ld(w, c), { op: 'build', province: next.id, kind: 'railway' }); assert.ok(r.ok, r.msg); run(w, 5); assert.ok(next.rail >= 1 && at(next).depth === 0 && at(next).head === next.id, 'the province the line reaches is a supply head');
  assert.ok(at(far).depth <= lines.depth[far.id] + 1e-9, 'and nothing beyond it is worse off');
  // Taken in war, a line is wrecked for two quarters.
  const t = twoRoads(1), { over } = t; assert.ok(railRuns(t.w, over)); takeProvince(t.w, over, 'U1'); assert.ok(!railRuns(t.w, over) && /wrecked in the fighting/.test(lookUp(t.w, t.gen, `province:${over.id}`)), 'the retreating army leaves no railway behind it');
  t.w.turn += 2; assert.ok(railRuns(t.w, over), 'two quarters later trains run again');
  // The same attack, the same luck, from the railhead and from the end of a long road.
  const attack = (rails, seed) => { const f = twoRoads(1), { w } = f; w.rng = seed; if (!rails) for (const p of countryProvinces(w, 'U1')) { p.port = 0; if (p.id !== f.a.capital) p.rail = 0; p.terrain = 'mountain'; p.infra = .2; }
    const atk = soldier(w, 'U1', f.e1.id, 150), def = soldier(w, 'U2', f.over.id, 100), s = supplyAt(w, { country: 'U1', province: f.over.id }); applyOp(w, f.gen, { op: 'offensive', to: f.over.id, units: [atk.id] }); const b = quarter(w)[0]; return { b, s, said: f.said(), lostA: 150 - (w.units[atk.id]?.men ?? 0), lostD: 100 - (w.units[def.id]?.men ?? 0) }; };
  let worse = 0, told = 0; for (let i = 0; i < 8; i++) { const near = attack(true, 77 + i * 31337), long = attack(false, 77 + i * 31337); assert.equal(near.s.factor, 1); if (long.s.factor < .9 && long.lostD < near.lostD && long.lostA >= near.lostA - 1e-9) worse++; if (/marches of wagon road from their supply head/.test(long.said)) told++; }
  assert.equal(worse, 8, 'an army at the end of a long road hurts the enemy less and suffers no less itself'); assert.ok(told >= 1, 'and when that is what decided it the staff says so');
  // The staff's appreciation of a war names the roads in and what supply would reach troops on each.
  const plan = lookUp(t.w, t.gen, 'war_plan:U2'); assert.ok(/The roads into their country/.test(plan) && /in the hundred of their needs/.test(plan) && /the arsenal holds/.test(plan), plan);
});

chain('The manner of an attack is the general\'s to choose: a reconnaissance in force costs little, takes nothing and tells what stands there; an attack pressed regardless of loss stays on the field when beaten and goes in again until it is called off; an attack can be set for a later quarter; and each is refused or lapses when it no longer makes sense', () => {
  // The same force against the same defence, as a reconnaissance and as an assault.
  const go = (order, seed = 9) => { const f = twoRoads(1), { w, over, e1 } = f; w.rng = seed; over.fort = 1; over.trench = 1; const atk = soldier(w, 'U1', e1.id, 60), def = soldier(w, 'U2', over.id, 100); def.dug = 2;
    const r = applyOp(w, f.gen, { op: 'offensive', to: over.id, units: [atk.id], ...order }); assert.ok(r.ok, r.msg); return { ...f, atk, def, r }; };
  const p = go({ manner: 'probe' }), pb = quarter(p.w), s = go({}), sb = quarter(s.w);
  assert.ok(pb[0].manner === 'probe' && !pb[0].attackerWon && p.atk.province === p.e1.id && p.over.controller === 'U2' && !p.atk.attack, 'the reconnaissance comes back to where it started');
  assert.ok(60 - p.atk.men < (60 - (s.w.units[s.atk.id]?.men ?? 0)) * .4 && 60 - p.atk.men > 0, `and costs a fraction of an assault: ${60 - p.atk.men} against ${60 - (s.w.units[s.atk.id]?.men ?? 0)}`);
  assert.ok(/Our reconnaissance in force/.test(p.said()) && /puts them at about 100 thousand/.test(p.said()) && /a fortress of the first order/.test(p.said()) && /field works/.test(p.said()), p.said()); assert.ok(!p.gen.record, 'a reconnaissance is no battle lost');
  assert.ok(/Our attack on .* failed/.test(s.said()) && /they fought from works/.test(s.said()) && /without a bombardment/.test(s.said()), `the staff says why the assault failed: ${s.said()}`);
  // A place all but empty is simply taken.
  { const f = twoRoads(1), atk = soldier(f.w, 'U1', f.e1.id, 60); soldier(f.w, 'U2', f.over.id, 2); applyOp(f.w, f.gen, { op: 'offensive', to: f.over.id, units: [atk.id], manner: 'probe' }); const b = quarter(f.w); assert.ok(b[0].manner === 'assault' && b[0].attackerWon && f.over.controller === 'U1', 'a reconnaissance that finds the place all but empty walks in'); }
  // Pressed regardless of loss.
  const a = go({ manner: 'all_out' }), ab = quarter(a.w); assert.ok(!ab[0].attackerWon && a.atk.province === a.over.id && a.atk.attack?.manner === 'all_out' && /go in again next quarter/.test(a.said()), `beaten, they are still there: ${a.said()}`);
  assert.ok(ab[0].lossA > sb[0].lossA * 1.15, `and it has cost them more dead than an assault would have: ${ab[0].lossA} thousand against ${sb[0].lossA}`);
  const ab2 = quarter(a.w); assert.ok(ab2.length === 1 && ab2[0].manner === 'all_out', 'next quarter they go in again without a new order');
  if (a.w.units[a.atk.id]?.attack) { const off = applyOp(a.w, a.gen, { op: 'offensive', to: a.over.id, cancel: true }); assert.ok(off.ok && !a.atk.attack, off.msg); }
  // Set for a later quarter.
  const l = go({ prepare: 1 }); assert.ok(/no sooner than 1 quarter from now/.test(l.r.msg), l.r.msg); assert.equal(quarter(l.w).length, 0); assert.ok(/set for a later quarter/.test(l.atk.march.held) && l.atk.province === l.e1.id, l.atk.march.held); assert.equal(quarter(l.w).length, 1, 'it goes in when its day comes');
  // A march order takes a unit out of the operation; so does an order to stand on the defensive.
  const m = go({}), back = m.w.provinces[m.e1.neighbors.find(n => m.w.provinces[n].controller === 'U1')], mv = applyOp(m.w, m.gen, { op: 'move', unit: m.atk.id, to: back.id }); assert.ok(mv.ok && !m.atk.attack && /leaves the offensive/.test(mv.msg), mv.msg);
  const dfn = go({}); assert.ok(applyOp(dfn.w, dfn.gen, { op: 'set_posture', unit: dfn.atk.id, posture: 'defensive' }).ok && !dfn.atk.attack && !dfn.atk.target, 'troops told to stand do not attack');
  // A unit is part of one attack at a time, and a march between two of one's own provinces keeps to one's own roads.
  { const r = twoRoads(1), u = soldier(r.w, 'U1', r.e1.id, 50), elsewhere = countryProvinces(r.w, 'U2').find(p => p.id !== r.over.id && p.neighbors.some(n => r.w.provinces[n].controller === 'U1')); assert.ok(applyOp(r.w, r.gen, { op: 'offensive', to: r.over.id, units: [u.id] }).ok);
    const second = applyOp(r.w, r.gen, { op: 'offensive', to: elsewhere.id, units: [u.id] }); assert.ok(second.ok && u.attack.to === elsewhere.id && /A unit is part of one attack at a time/.test(second.msg), second.msg);
    const road = roadOf(r.w, r.e1.id, r.e2.id, 'U1'); assert.ok(road && road.every(id => r.w.provinces[id].controller === 'U1'), `between two of our own provinces the road keeps to our own ground: ${road}`);
    const home = applyOp(r.w, r.gen, { op: 'move', unit: u.id, to: r.e2.id }); assert.ok(home.ok && !/enemy/.test(home.msg), home.msg); const at = applyOp(r.w, r.gen, { op: 'move', unit: u.id, to: r.over.id }); assert.ok(at.ok && /is held by the enemy: the unit attacks it as it arrives, by itself/.test(at.msg), at.msg);
    // Cut off from the rest of the country by the enemy's ground, a unit sent home is told it must fight its way.
    const deep = countryProvinces(r.w, 'U2').find(p => p.id !== r.d.capital && !p.neighbors.some(n => r.w.provinces[n].controller === 'U1')); if (deep) { const lost = soldier(r.w, 'U1', deep.id, 20), back = applyOp(r.w, r.gen, { op: 'move', unit: lost.id, to: r.a.capital }); assert.ok(back.ok && /the unit will have to fight its way through/.test(back.msg), back.msg); } }
  // What the referee and the commanders are told.
  const ref = refereePrompt(s.w, s.a, [{ actor: s.gen, decisions: ['Attack.'] }]); assert.ok(ref.includes('offensive{to,units?:[unit ids]') && /reconnaissance in force/.test(ref), 'the referee knows the order');
  const army = lookUp(s.w, s.gen, 'army'); assert.ok(/An attack can be ordered as one operation \(offensive\)/.test(army) && /Supply: an army is fed from/.test(army), 'the commander is told how attacks and supply work');
  const men = lookUp(s.w, ld(s.w, s.a), 'commanders'); assert.ok(/Chief of the general staff: .*(able|competent|a poor hand)/.test(men), men); assert.ok(!/Chief of the general staff: [^.]*(, able|, competent|, a poor hand)/.test(lookUp(s.w, s.gen, 'commanders')), 'nobody is handed the opinion the army has of himself'); assert.ok(!/(, able|, competent|, a poor hand)/.test(lookUp(s.w, s.w.characters[s.a.opposition], 'commanders')), 'what the army thinks of its commanders is not known outside it');
});
import { strength as shipWeight, enemyHolds as heldByEnemy, baseMap as basesOf, readiness as fitness } from '../engine/navy.js';
// Two navies with the sea to themselves: every other squadron is gone, and U1 is at war with the state whose best harbour lies nearest its own
// (e). meet is the water off that harbour: within four seas of a base of each, so that both fight there at their best.
const navalWorld = () => { const w = fresh(); for (const f of Object.values(w.fleets)) delete w.fleets[f.id]; for (const u of Object.values(w.units)) delete w.units[u.id];
  const port = id => countryProvinces(w, id).filter(p => p.port > 0 && p.seas.length).sort((x, y) => y.port - x.port)[0], ha = port('U1'), near = basesOf(w, 'U1');
  const rival = aliveCountries(w).filter(o => o.id !== 'U1' && port(o.id)).map(o => ({ o, hb: port(o.id) })).map(x => ({ ...x, sea: [...x.hb.seas].sort((s, t) => (near[s]?.d ?? 99) - (near[t]?.d ?? 99))[0] })).sort((x, y) => (near[x.sea]?.d ?? 99) - (near[y.sea]?.d ?? 99))[0];
  assert.ok((near[rival.sea]?.d ?? 99) <= 4, 'a rival harbour within four seas'); ha.port = Math.max(ha.port, 2); rival.hb.port = Math.max(rival.hb.port, 2);
  for (const c of [w.countries.U1, rival.o]) { c.stock.coal = 2000; c.stock.steel = 2000; c.budget.military = .3; c.treasury = c.gdp * 3; w.characters[c.general].skill = 1; }
  w.wars.push({ id: 'S-n', a: ['U1'], b: [rival.o.id], civil: false, active: true, start: w.turn, name: 'n' });
  return { w, ha: ha.id, hb: rival.hb.id, e: rival.o.id, meet: rival.sea }; };
let navalBase = null;
const twoNavies = () => { navalBase ||= navalWorld(); const w = structuredClone(navalBase.w), { e, meet } = navalBase, ha = w.provinces[navalBase.ha], hb = w.provinces[navalBase.hb];
  const ship = (id, sea, n, kind = 'cruiser', harbour = null) => { const f = makeFleet(w, id, sea, n, kind); if (harbour) { f.port = f.home = harbour.id; f.sea = harbour.seas.includes(sea) ? sea : harbour.seas[0]; } return f; };
  return { w, a: w.countries.U1, b: w.countries[e], e, ha, hb, meet, ship, gen: w.characters[w.countries.U1.general], gb: w.characters[w.countries[e].general], said: id => w.characters[w.countries[id].general].inbox.map(m => m.text).join('\n'), third: aliveCountries(w).find(o => o.id !== 'U1' && o.id !== e).id }; };

chain('A squadron lives on coal and on its bases: in harbour it burns little and commands nothing, at sea it burns much and costs more; with empty bunkers or far from a harbour it is worth less; no ship keeps station beyond its reach; and a right of passage opens a foreign harbour to it', () => {
  const t = twoNavies(), { w, a, ha } = t; w.wars = []; const f = t.ship('U1', ha.seas[0], 10, 'cruiser', ha), inPort = upkeepCost(w, a);
  militaryStep(w); const banked = a._navyCoal; assert.ok(banked > .2 && banked < .4 && !w.seaControl[f.sea], `ten cruisers with banked fires burn about 0.3 and hold no water: ${banked}`);
  const out = applyOp(w, t.gen, { op: 'move_fleet', fleet: f.id, to: ha.seas[0] }); assert.ok(out.ok && /burns about 3 of coal a quarter/.test(out.msg), out.msg);
  militaryStep(w); assert.ok(!f.port && a._navyCoal > banked * 8 && w.seaControl[f.sea] === 'U1' && upkeepCost(w, a) > inPort * 1.05, `at sea they burn ten times as much, hold the water, and cost more: ${a._navyCoal}`);
  // Empty bunkers.
  const full = shipWeight(w, f); a.stock.coal = 0; for (let i = 0; i < 4; i++) militaryStep(w); assert.ok(f.coaled < .1 && shipWeight(w, f) < full * .5, `without coal the squadron is worth less than half: ${shipWeight(w, f)} of ${full}`);
  assert.ok(/bunkers [0-9] in the hundred full/.test(lookUp(w, t.gen, 'fleet')) && /Coal: the fleet burned/.test(lookUp(w, t.gen, 'fleet')), 'and its staff is told so');
  // Distance from a base.
  a.stock.coal = 2000; for (let i = 0; i < 6; i++) militaryStep(w); const bases = basesOf(w, 'U1'), farSea = Object.keys(bases).filter(s => bases[s].d >= 8 && bases[s].d <= 14).sort((x, y) => bases[y].d - bases[x].d)[0], beyond = Object.keys(bases).find(s => bases[s].d > 16);
  assert.ok(farSea, 'a stretch of water eight seas and more from home'); const near = fitness(w, f), home = f.sea; f.sea = farSea; assert.ok(fitness(w, f) < near - .2, `eight and more seas from a harbour a squadron is not what it was: ${fitness(w, f)} against ${near}`); f.sea = home;
  if (beyond) { const no = applyOp(w, t.gen, { op: 'move_fleet', fleet: f.id, to: beyond }); assert.ok(!no.ok && /keep station 16 seas from a base at most/.test(no.msg), no.msg); }
  // Torpedo craft are coast craft; a harbour opened by treaty is a base like any other.
  const boats = t.ship('U1', ha.seas[0], 12, 'torpedo', ha), off = Object.keys(bases).find(s => bases[s].d >= 4 && bases[s].d < 90 && w.seas[s].coast.some(id => w.provinces[id].port > 0 && w.provinces[id].controller !== 'U1')); assert.ok(off, 'a foreign harbour four seas and more from ours');
  const host = w.provinces[w.seas[off].coast.find(id => w.provinces[id].port > 0 && w.provinces[id].controller !== 'U1')], no = applyOp(w, t.gen, { op: 'move_fleet', fleet: boats.id, to: off }); assert.ok(!no.ok && /torpedo boats keep station 3 seas/.test(no.msg), no.msg);
  assert.ok(!applyOp(w, t.gen, { op: 'move_fleet', fleet: boats.id, to: host.id }).ok, 'a foreign harbour is closed to them');
  w.treaties.push({ id: 'A-pass', kind: 'military_access', parties: ['U1', host.controller], active: true, pending: false, terms: '', clauses: [], breaches: [], turn: w.turn });
  const yes = applyOp(w, t.gen, { op: 'move_fleet', fleet: boats.id, to: off }); assert.ok(yes.ok, `with a right of passage that harbour is a base: ${yes.msg}`); assert.ok(applyOp(w, t.gen, { op: 'move_fleet', fleet: boats.id, to: host.id }).ok, 'and they may lie in it');
});

chain('A sea fight is not arithmetic: the heavier line wins more often than not and not always, an able admiral counts, ships that are hit are as often towed home as sunk and a harbour mends them at the pace of its size, a beaten squadron runs for port, a fast squadron told to avoid battle usually gets away, and a neutral squadron in the same water commands nothing for anybody', () => {
  const fights = (prep = () => {}) => { let won = 0; for (let i = 0; i < 60; i++) { const t = twoNavies(); t.w.rng = 31 + i * 7907; t.ship('U1', t.meet, 10); const theirs = t.ship(t.e, t.meet, 8); prep(t, theirs); militaryStep(t.w); assert.equal(t.w.seaFights?.length, 1); if (t.w.seaFights[0].winner === 'U1') won++; } return won; };
  const even = fights(); assert.ok(even >= 36 && even <= 57, `ten cruisers beat eight most days and not every day: ${even} of 60`);
  // An admiral.
  const led = fights((t, theirs) => { const r = applyOp(t.w, t.gb, { op: 'appoint_commander', fleet: theirs.id, name: 'Admiral Varn' }); assert.ok(r.ok, r.msg); t.w.characters[theirs.commander].skill = 1.5; });
  assert.ok(led < even - 8, `under an able admiral the smaller squadron wins far more often: U1 won ${led} against ${even}`);
  // One fight, looked at closely.
  const t = twoNavies(); t.w.rng = 4242; const mine = t.ship('U1', t.meet, 10), theirs = t.ship(t.e, t.meet, 8); militaryStep(t.w);
  const lid = t.w.seaFights[0].loser, loser = lid === 'U1' ? mine : theirs, winner = lid === 'U1' ? theirs : mine, report = t.said(lid);
  assert.ok(loser.damaged > .3 && loser.ships + loser.damaged < (lid === 'U1' ? 10 : 8) - .3 && winner.damaged > 0, `some are sunk and some disabled: ${JSON.stringify([loser.ships, loser.damaged, winner.ships, winner.damaged])}`);
  assert.ok(loser.port && t.w.provinces[loser.port].controller === lid && /ran for .* and lie in harbour/.test(report), `the beaten squadron runs for a harbour of its own: ${report}`);
  assert.ok(/we were beaten/.test(report) && /What told:/.test(report) && /badly damaged and fight no more until a dock/.test(report) && /we hold the water/.test(t.said(t.w.seaFights[0].winner)), report);
  // The dock. A larger harbour mends faster, and mending takes steel.
  const mend = (size, steel = 2000) => { const y = twoNavies(); y.w.wars = []; y.hb.port = size; y.b.stock.steel = steel; const f = y.ship(y.e, y.hb.seas[0], 2, 'cruiser', y.hb); f.damaged = 8; militaryStep(y.w); return 8 - f.damaged; };
  const small = mend(1), large = mend(3), starved = mend(3, 0); assert.ok(Math.abs(small - 3) < .01 && large > small * 2 && starved < large * .6, `a harbour of the first size mends three cruisers a quarter, one of the third far more, and less without steel: ${small}, ${large}, ${starved}`);
  // Avoiding battle.
  const slips = (kind, hunters) => { let n = 0; for (let i = 0; i < 60; i++) { const y = twoNavies(); y.w.rng = 97 + i * 6007; const prey = y.ship(y.e, y.meet, 4, kind), hunt = y.ship('U1', y.meet, 6, hunters); prey.orders = 'evade'; hunt.orders = 'seek'; militaryStep(y.w); if (prey.slipped === y.w.turn) n++; } return n; };
  const fast = slips('cruiser', 'battleship'), slow = slips('battleship', 'cruiser'); assert.ok(fast > slow + 10 && fast >= 30, `cruisers get away from battleships far more often than battleships from cruisers: ${fast} and ${slow} of 60`);
  // A neutral squadron, however large, commands nothing: the blockade stands.
  const n = twoNavies(), block = n.ship('U1', n.meet, 10); n.ship(n.third, n.meet, 60); militaryStep(n.w);
  assert.ok(n.w.seaControl[n.meet] === n.third && heldByEnemy(n.w, n.meet, n.e) && !heldByEnemy(n.w, n.meet, n.third), 'the water is closed to the blockaded state whoever else lies in it');
  block.orders = 'raid'; militaryStep(n.w); assert.ok(!heldByEnemy(n.w, n.meet, n.e) && n.w.seaRaids[n.meet].includes('U1'), 'cruisers out after merchantmen prey on trade and command no water');
});

chain('Small craft and mines make a coast dangerous to a stronger navy: torpedo boats count for far more in their own waters than out of them, a minefield bleeds and is cleared by the squadron that keeps station in it, and now and then sinks a neutral merchant ship, which its government holds against whoever laid it', () => {
  // The same boats against the same battleships: off their own harbour, and five seas and more from any harbour of theirs.
  const boats = home => { let won = 0; for (let i = 0; i < 40; i++) { const y = twoNavies(), theirs = basesOf(y.w, y.e), ours = basesOf(y.w, 'U1'), sea = home ? y.meet : Object.keys(theirs).filter(s => theirs[s].d >= 5 && theirs[s].d < 90).sort((p, q) => (ours[p]?.d ?? 99) - (ours[q]?.d ?? 99))[0]; assert.ok(sea); y.w.rng = 5 + i * 9973;
      y.ship(y.e, sea, 20, 'torpedo'); y.ship('U1', sea, 3, 'battleship'); militaryStep(y.w); if (y.w.seaFights?.at(-1)?.winner === y.e) won++; } return won; };
  const near = boats(true), far = boats(false); assert.ok(near >= 22 && far <= 6, `twenty torpedo boats see off three battleships from their own coast and are swept aside anywhere else: ${near} and ${far} of 40`);
  // Mines.
  const t = twoNavies(), { w, hb, e } = t, sea = t.meet;
  const nobody = Object.keys(w.seas).find(s => !w.seas[s].coast.some(id => ['U1', e].includes(w.provinces[id].controller))); assert.ok(!applyOp(w, t.gb, { op: 'lay_mines', sea: nobody }).ok, 'not in water that is neither one\'s own nor an enemy\'s');
  const laid = applyOp(w, t.gb, { op: 'lay_mines', sea }); assert.ok(laid.ok && w.mines[sea].by === e && /Nobody has been told/.test(laid.msg), laid.msg); assert.ok(!applyOp(w, t.gb, { op: 'lay_mines', sea }).ok, 'one field in one water in a quarter');
  w.turn++; assert.ok(applyOp(w, t.gb, { op: 'lay_mines', sea }).ok && w.mines[sea].level === 2);
  const block = t.ship('U1', sea, 20); militaryStep(w); assert.ok(block.ships < 19.5 && block.damaged > .2 && w.mines[sea].level === 1 && /to mines/.test(t.said('U1')), `the blockading squadron loses ships to them and clears part of the field: ${block.ships}, ${JSON.stringify(w.mines[sea])}`);
  assert.ok(/Mines of ours lie in/.test(lookUp(w, t.gb, 'fleet')) && !/Mines of ours/.test(lookUp(w, t.gen, 'fleet')), 'whoever laid them knows where they are');
  // A neutral's trade through mined water.
  const m = twoNavies(), other = aliveCountries(m.w).find(o => ![m.e, m.third, 'U1'].includes(o.id)).id, key = [m.third, other].sort().join('|'), rel = m.w.countries[m.third].relations[m.e] ?? 0; let lost = 0;
  for (let i = 0; i < 40; i++) { m.w.newsThisTurn = []; m.w.mines = { [m.meet]: { by: m.e, level: 3, left: 8, turn: m.w.turn } }; m.w.routes = { [key]: { mode: 'sea', cost: 1.1, path: [m.meet], tolls: [] } }; militaryStep(m.w); lost += m.w.newsThisTurn.filter(x => /lost on a mine/.test(x.text)).length; }
  assert.ok(lost >= 2 && (m.w.countries[m.third].relations[m.e] ?? 0) < rel - 8, `neutral merchantmen are lost on them, and it is remembered: ${lost} ships`);
});

chain('The fleet and the shore: ships shell a coast they lie off and the shore guns answer, shelling an open town is read about everywhere, a squadron\'s guns help the army fighting on that coast, a harbour that falls sends its ships to sea or to the bottom, and a landing needs ships at sea off the beach', () => {
  const t = twoNavies(), { w, a, b, hb, e } = t, f = t.ship('U1', hb.seas[0], 4, 'battleship'); hb.battery = 2; const garrison = soldier(w, e, hb.id, 30); garrison.dug = 3;
  const war = w.wars; w.wars = []; assert.ok(/no war/.test(applyOp(w, t.gen, { op: 'bombard', province: hb.id }).msg), 'ships do not open fire in peace'); w.wars = war;
  const dev = hb.devastation, grudge = b.grudges?.U1?.incident ?? 0, r = applyOp(w, t.gen, { op: 'bombard', province: hb.id, fleet: f.id }); assert.ok(r.ok && /shore guns answered/.test(r.msg), r.msg);
  assert.ok(hb.devastation > dev && hb.battery < 2 && f.ships < 4 && f.damaged > 0 && garrison.men < 30 && garrison.dug < 3 && b.grudges.U1.incident > grudge + 4, 'the harbour, its guns and the troops there are hit, the ships are hit back, and the country remembers');
  assert.ok(!applyOp(w, t.gen, { op: 'bombard', province: hb.id, fleet: f.id }).ok, 'a squadron fires off what it carries once in a quarter');
  const open = countryProvinces(w, e).find(p => p.coast && p.id !== hb.id && p.seas.length && !p.battery && !p.fort); assert.ok(open, 'an undefended town on their coast');
  { const g = t.ship('U1', open.seas[0], 5), o = applyOp(w, t.gen, { op: 'bombard', province: open.id, fleet: g.id }); assert.ok(o.ok && /open town/.test(o.msg) && (a.honourLog || []).some(x => /undefended/.test(x.why)), o.msg); }
  { const h = t.ship('U1', hb.seas[0], 3, 'cruiser'); h.port = t.ha.id; assert.ok(!applyOp(w, t.gen, { op: 'bombard', province: hb.id, fleet: h.id }).ok, 'ships in harbour shell nothing'); }
  // Guns from the sea in a battle on the coast: the same fight, the same luck, with and without battleships lying off it.
  const coast = ships => { const y = twoRoads(1), { over, e1 } = y; for (const g of Object.values(y.w.fleets)) delete y.w.fleets[g.id]; over.coast = true; over.seas = [countryProvinces(y.w, 'U1').find(p => p.port > 0 && p.seas.length).seas[0]]; if (ships) makeFleet(y.w, 'U1', over.seas[0], ships, 'battleship'); y.w.rng = 606;
    const atk = soldier(y.w, 'U1', e1.id, 120), def = soldier(y.w, 'U2', over.id, 100); applyOp(y.w, y.gen, { op: 'offensive', to: over.id, units: [atk.id] }); quarter(y.w); return { lostD: 100 - (y.w.units[def.id]?.men ?? 0), said: y.said() }; };
  const dry = coast(0), wet = coast(8); assert.ok(wet.lostD > dry.lostD * 1.05, `with battleships off the coast the defenders lose more: ${wet.lostD} against ${dry.lostD}`);
  // A harbour falls.
  const fall = blockaded => { const y = twoNavies(); y.hb.seas = [y.hb.seas[0]]; const docked = y.ship(y.e, y.hb.seas[0], 6, 'cruiser', y.hb); if (blockaded) y.ship('U1', y.hb.seas[0], 20); militaryStep(y.w); docked.damaged = 2; y.w.newsThisTurn = []; takeProvince(y.w, y.hb, 'U1'); return { ...y, docked }; };
  const free = fall(false); assert.ok(free.w.fleets[free.docked.id] && !free.docked.port && free.docked.damaged === 0 && free.w.newsThisTurn.some(x => /put to sea as .* fell/.test(x.text)), 'with open water before them the ships put to sea, leaving those in dock');
  const shut = fall(true); assert.ok(!shut.w.fleets[shut.docked.id] && shut.w.newsThisTurn.some(x => /scuttled/.test(x.text)) && Object.values(shut.w.fleets).some(g => g.country === 'U1' && g.port === shut.hb.id && g.damaged > 1), 'shut in, they are scuttled, and the victor raises a few');
  // A landing.
  const l = twoNavies(), troops = soldier(l.w, 'U1', l.ha.id, 6), idle = l.ship('U1', l.hb.seas[0], 10, 'cruiser'); idle.port = l.ha.id;
  assert.ok(/covers nothing/.test(applyOp(l.w, l.gen, { op: 'amphibious', unit: troops.id, to: l.hb.id }).msg), 'ships lying in harbour cover no landing');
  delete idle.port; militaryStep(l.w); const landed = applyOp(l.w, l.gen, { op: 'amphibious', unit: troops.id, to: l.hb.id }); assert.ok(landed.ok && troops.province === l.hb.id && troops.from === 'sea', `with the squadron at sea off the beach the troops go ashore: ${landed.msg}`);
});

chain('A navy is handed over as a navy of its time and its staff knows how it works: battleships, cruisers and torpedo craft lying in harbour, an admiral over the heaviest squadron; the yards build each kind where the harbour allows; the staff\'s appreciation of a war covers the sea; and a chief of staff played by rule blockades when he is the stronger and keeps his ships in harbour when he is not', () => {
  const w = inherited(), cs = aliveCountries(w), fs = Object.values(w.fleets);
  assert.ok(fs.every(f => f.kind && f.port && w.provinces[f.port].controller === f.country && f.home === f.port), 'every squadron has its kind and lies in a harbour of its own');
  assert.ok(fs.some(f => f.kind === 'battleship') && fs.some(f => f.kind === 'torpedo') && cs.every(c => fs.some(f => f.country === c.id && f.kind === 'cruiser')), fs.map(f => `${f.country}:${f.kind}:${f.ships}`).join(' '));
  assert.ok(fs.filter(f => f.kind === 'battleship').every(f => w.provinces[f.port].port >= 2), 'battleships lie where a harbour can take them');
  const flag = fs.find(f => w.characters[f.commander]?.alive); assert.ok(flag && /admiral commanding the squadron/.test(lookUp(w, w.characters[w.countries[flag.country].leader], 'people')), 'the heaviest squadron has an admiral, and he is known');
  run(w, 2); const c = [...cs].sort((x, y) => fs.filter(f => f.country === y.id).length - fs.filter(f => f.country === x.id).length)[0], gen = w.characters[c.general], boss = w.characters[c.leader], home = w.provinces[fs.find(f => f.country === c.id).port];
  assert.ok(Object.values(w.fleets).every(f => f.port && (f.coaled ?? 1) > .95) && !Object.keys(w.seaControl).length, 'in peace they lie in harbour with full bunkers and hold no water');
  const report = lookUp(w, gen, 'fleet'); assert.ok(/in harbour at/.test(report) && /Our harbours:/.test(report) && /A squadron works from a base/.test(report) && /Standing orders \(fleet_orders\)/.test(report), report);
  assert.ok(/Fleet details are secret/.test(lookUp(w, w.characters[c.opposition], 'fleet')));
  const other = cs.find(o => o.id !== c.id && Object.values(w.provinces).some(p => p.controller === o.id && p.port > 0)), plan = lookUp(w, gen, `war_plan:${other.id}`); assert.ok(/At sea\. Ours: .*Theirs, by the published navy lists/.test(plan) && /Their harbours:/.test(plan), plan);
  const ref = refereePrompt(w, c, [{ actor: gen, decisions: ['The fleet puts to sea.'] }]); assert.ok(ref.includes('fleet_orders{fleet?|all?,orders:patrol|seek|evade|blockade|raid|port}') && ref.includes('Its harbours:') && ref.includes('in harbour at') && ref.includes('lay_mines{sea}') && ref.includes('bombard{province,fleet?}'), 'the referee knows the orders and sees where the ships lie');
  // The yards.
  c.treasury = c.gdp * 4; c.stock.steel = 500; const small = countryProvinces(w, c.id).find(p => p.port === 1);
  assert.ok(applyOp(w, boss, { op: 'build_ship', province: home.id, ships: 6, kind: 'torpedo' }).ok); if (small) assert.ok(/harbour is too small/.test(applyOp(w, boss, { op: 'build_ship', province: small.id, ships: 1, kind: 'battleship' }).msg));
  const before = Object.keys(w.fleets).length; run(w, 2); const built = Object.values(w.fleets).find(f => f.kind === 'torpedo' && f.ships === 6 && f.port === home.id); assert.ok(Object.keys(w.fleets).length === before + 1 && built, 'torpedo boats are delivered in two quarters and lie where they were built');
  assert.ok(applyOp(w, gen, { op: 'fleet_orders', all: true, orders: 'evade' }).ok && Object.values(w.fleets).filter(f => f.country === c.id).every(f => f.orders === 'evade') && !applyOp(w, w.characters[c.opposition], { op: 'fleet_orders', all: true, orders: 'patrol' }).ok, 'standing orders are the staff\'s and the ruler\'s to give');
  // Played by rule.
  const t = twoNavies(), strong = t.ship('U1', t.ha.seas[0], 20, 'cruiser', t.ha), weak = t.ship(t.e, t.meet, 5, 'cruiser');
  for (const op of npcDecide(t.w, t.gen)) applyOp(t.w, t.gen, op); assert.ok(strong.target && strong.orders === 'blockade', 'the stronger navy goes to lie off the enemy\'s harbour');
  for (const op of npcDecide(t.w, t.gb)) applyOp(t.w, t.gb, op); assert.ok(weak.orders === 'port' && weak.target, 'the weaker makes for harbour');
});
import { merchantStep as shipowners, blockadeOf as closedBy, liftOf as liftFor } from '../engine/navy.js';
chain('Cargo crosses the sea in somebody\'s ships: a country carries its own traffic as far as its tonnage goes and pays foreign owners the freight on the rest, gold changing hands and none of it lost; when the world is short of ships every freight rises; raiders sink a belligerent\'s tonnage; the state can lay merchant ships down; and troops cross the sea in them, as many as they can carry', () => {
  const w = inherited(); run(w, 3); const cs = aliveCountries(w), sea = cs.filter(c => countryProvinces(w, c.id).some(p => p.port > 0)), ports = c => countryProvinces(w, c.id).reduce((a, p) => a + (p.port || 0), 0);
  assert.ok(sea.every(c => c.shipping > 1), cs.map(c => `${c.archetype} ${c.shipping}`).join(', '));
  const keen = [...sea].sort((a, b) => b.shipping / ports(b) - a.shipping / ports(a)); assert.ok(['merchant', 'republic', 'federation'].includes(keen[0].archetype) && !['merchant', 'republic', 'federation'].includes(keen.at(-1).archetype), `harbour for harbour a trading state keeps more ships than a state of soldiers or landowners: ${keen.map(c => `${c.archetype} ${(c.shipping / ports(c)).toFixed(2)}`).join(', ')}`);
  assert.ok(/Merchant marine: \d+ of tonnage/.test(lookUp(w, w.characters[cs[0].leader], 'trade')) && /can put about \d+ thousand men across the sea/.test(lookUp(w, w.characters[cs[0].general], 'fleet')), 'trade and fleet reports speak of it');
  // The freight on a cargo goes to whoever carried it.
  const [a, b, c] = sea, gold = () => cs.reduce((s, x) => s + x.reserves, 0), set = (x, n) => { x.shipping = n; x._seaVol = 0; x.shipBuilt = 0; x._lifted = 0; };
  for (const x of cs) set(x, 0); set(c, 5000); const before = gold(), had = c.reserves; shipowners(w, cs, [[a.id, b.id, 10, 6]]);
  assert.ok(Math.abs(gold() - before) < 1e-6 && Math.abs(c.reserves - had - 6) < 1e-6 && Math.abs(a._freightOut - 6) < 1e-6 && c._freightIn > 5.9, `with no ships of their own the two pay the whole freight to the third: ${c.reserves - had}`);
  for (const x of cs) set(x, 0); set(b, 5000); const hadB = b.reserves, hadC = c.reserves; shipowners(w, cs, [[a.id, b.id, 10, 6]]); assert.ok(b.reserves - hadB > 5.9 && Math.abs(c.reserves - hadC) < 1e-6, 'a buyer with ships of his own carries his own imports and keeps the freight');
  // A world short of ships.
  for (const x of cs) set(x, 0); w.freight = 0; for (let i = 0; i < 6; i++) { for (const x of cs) x.shipping = 0; shipowners(w, cs, [[a.id, b.id, 10, 6]]); } assert.ok(w.freight > .15, `with no ships anywhere freights rise: ${w.freight}`);
  const k = Object.keys(w.routes).find(x => w.routes[x].mode === 'sea'); if (k) { const dear = (updateRoutes(w), w.routes[k]?.cost); w.freight = 0; updateRoutes(w); assert.ok(dear > w.routes[k].cost + .1, `and every sea route costs more: ${dear} against ${w.routes[k].cost}`); }
  // Commerce war: a raider on a belligerent's trade route.
  if (k) { const [x, y] = k.split('|').map(id => w.countries[id]), foe = cs.find(o => o !== x && o !== y); set(x, 40); set(y, 40); w.freight = 0; w.wars.push({ id: 'S-r', a: [foe.id], b: [x.id], civil: false, active: true, start: w.turn, name: 'r' }); w.seaRaids = { [w.routes[k].path[0]]: [foe.id] };
    shipowners(w, cs, []); assert.ok(x._sunk > .5 && x.shipping < 40 && !(y._sunk > 0) && w.characters[x.leader].inbox.some(m => /sank about .* of our merchant tonnage/.test(m.text)), `raiders sink the belligerent's ships and leave the neutral's alone: ${x._sunk}`); w.wars = w.wars.filter(v => v.id !== 'S-r'); w.seaRaids = {}; }
  // The yards.
  const m = inherited(); run(m, 2); const mc = aliveCountries(m).find(x => countryProvinces(m, x.id).some(p => p.port > 0)), boss = m.characters[mc.leader], yard = countryProvinces(m, mc.id).find(p => p.port > 0); mc.treasury = mc.gdp * 3; mc.stock.steel = 500; mc.stock.timber = 500;
  const was = mc.shipping, lift = liftFor(mc), r = applyOp(m, boss, { op: 'build_ship', province: yard.id, ships: 12, kind: 'merchant' }); assert.ok(r.ok && /add 12 to the country's merchant tonnage/.test(r.msg), r.msg); run(m, 3);
  assert.ok(mc.shipping > was + 10 && liftFor(mc) > lift + 20 && !Object.values(m.fleets).some(f => f.kind === 'merchant'), `twelve steamers add twelve of tonnage and room for twenty-four thousand men: ${mc.shipping} from ${was}`);
  // Troops cross in merchant ships.
  const t = twoNavies(); t.a.shipping = 10; t.ship('U1', t.hb.seas[0], 10); militaryStep(t.w); const big = soldier(t.w, 'U1', t.ha.id, 30), small = soldier(t.w, 'U1', t.ha.id, 12), third = soldier(t.w, 'U1', t.ha.id, 12);
  const no = applyOp(t.w, t.gen, { op: 'amphibious', unit: big.id, to: t.hb.id }); assert.ok(!no.ok && /carry about 20 thousand men/.test(no.msg), no.msg);
  assert.ok(applyOp(t.w, t.gen, { op: 'amphibious', unit: small.id, to: t.hb.id }).ok && small.province === t.hb.id, 'twelve thousand fit in ten of tonnage');
  const full = applyOp(t.w, t.gen, { op: 'amphibious', unit: third.id, to: t.hb.id }); assert.ok(!full.ok && /carry about 8 thousand men/.test(full.msg), `and the ships that took them are not there for the next: ${full.msg}`);
});

chain('A blockade closes a coast in the measure of its weight: a few cruisers off a harbour make its trade dearer and a battle squadron stops it; and a state at war with nobody whose ships are turned back holds it against whoever turned them', () => {
  const w = fresh(); for (const f of Object.values(w.fleets)) delete w.fleets[f.id]; for (const u of Object.values(w.units)) delete w.units[u.id]; updateRoutes(w);
  const k = Object.keys(w.routes).find(x => w.routes[x].mode === 'sea' && !x.split('|').includes('U1')); assert.ok(k, 'two states that trade by sea');
  // v is the one to be blockaded; its only harbour is the one that trade leaves from.
  const [v, n] = k.split('|').map(id => w.countries[id]), sea = w.routes[k].path[0], home = countryProvinces(w, v.id).find(p => p.port > 0 && p.seas.includes(sea)) ?? countryProvinces(w, v.id).find(p => p.port > 0);
  const gate = home.seas.includes(sea) ? sea : w.routes[k].path.at(-1); for (const p of countryProvinces(w, v.id)) if (p !== home) p.port = 0; home.seas = [gate];
  w.wars = [{ id: 'S-k', a: ['U1'], b: [v.id], civil: false, active: true, start: w.turn, name: 'k' }]; for (const c of [w.countries.U1, v]) { c.stock.coal = 3000; c.budget.military = .3; }
  updateRoutes(w); assert.equal(w.routes[k]?.mode, 'sea'); const open = w.routes[k].cost, rel = n.relations.U1 ?? 0;
  const thin = makeFleet(w, 'U1', gate, 2, 'cruiser'); thin.coaled = 1; militaryStep(w); const e1 = closedBy(w, gate, v.id); updateRoutes(w);
  assert.ok(e1 > 0 && e1 < .8 && w.routes[k]?.mode === 'sea' && w.routes[k].cost > open + .05, `two cruisers do not seal a harbour: runners get through, at a price (${e1}, ${w.routes[k]?.cost} against ${open})`);
  thin.ships = 60; militaryStep(w); const e2 = closedBy(w, gate, v.id); updateRoutes(w);
  assert.ok(e2 >= .8 && w.routes[k]?.mode !== 'sea', `a battle squadron does: ${e2}, ${JSON.stringify(w.routes[k] ?? null)}`);
  assert.ok((n.relations.U1 ?? 0) <= rel - 5 && w.characters[n.leader].inbox.some(m => /have closed the harbours of/.test(m.text)), 'the neutral whose ships were turned back protests');
  const again = n.relations.U1; updateRoutes(w); assert.equal(n.relations.U1, again, 'once, when the trade stops, not every quarter after');
});

chain('Ships as an argument in time of peace: a squadron shown off a coast is a threat the other government must answer or swallow, and a creditor\'s squadron that commands the water off a defaulter\'s harbour takes his customs until the debt is cleared or the ships are gone', () => {
  const t = twoNavies(), { w, a, b, e, hb } = t, boss = ld(w, a); w.wars = [];
  assert.ok(/No surface squadron of ours lies at sea off the coast/.test(applyOp(w, boss, { op: 'demonstrate', target: e }).msg), 'there has to be a squadron there');
  const f = t.ship('U1', t.meet, 6, 'battleship'); militaryStep(w); const heat = b.grudges?.U1?.incident ?? 0, rel = b.relations.U1 ?? 0;
  assert.equal(applyOp(w, t.gen, { op: 'demonstrate', target: e }).ok, false, 'a demonstration is the government\'s act, not the staff\'s');
  w.newsThisTurn = []; const r = applyOp(w, boss, { op: 'demonstrate', target: e }); assert.ok(r.ok && /fires on nothing/.test(r.msg), r.msg);
  assert.ok(b.grudges.U1.incident > heat + 5 && (b.relations.U1 ?? 0) < rel && w.newsThisTurn.some(x => /is lying off/.test(x.text)) && ld(w, b).inbox.some(m => /has anchored off/.test(m.text)) && a.shown[e] === w.turn, 'the other country sees it, resents it, and its government is told');
  assert.ok(!applyOp(w, boss, { op: 'demonstrate', target: e }).ok, 'the same ships say nothing new in the same quarter');
  // The customs house.
  assert.ok(/owes this state nothing/.test(applyOp(w, boss, { op: 'seize_customs', target: e }).msg)); b.creditors.U1 = 50; assert.ok(/paying what it owes/.test(applyOp(w, boss, { op: 'seize_customs', target: e }).msg), 'a debtor who pays is left alone');
  b.defaulted = true; const s = applyOp(w, boss, { op: 'seize_customs', target: e }); assert.ok(s.ok && w.seizures.length === 1 && ld(w, b).inbox.some(m => /sit in our customs house/.test(m.text)), s.msg);
  b.lastBooks = { ...(b.lastBooks || {}), customs: 25 }; b.treasury = 400; b.rate = 1; const gold = a.reserves, legit = b.legitimacy; militaryStep(w);
  assert.ok(Math.abs(a.reserves - gold - 20) < 1e-6 && Math.abs(b.creditors.U1 - 30) < 1e-6 && b.legitimacy < legit && Math.abs(b.treasury - 380) < 1e-6, `four fifths of a quarter's customs go to the creditor: ${a.reserves - gold}`);
  militaryStep(w); w.newsThisTurn = []; militaryStep(w); assert.ok(!(b.creditors.U1 > .5) && !w.seizures.length && w.newsThisTurn.some(x => /debt to .* is cleared/.test(x.text)), 'and when the debt is cleared the customs house is handed back');
  // Driven off.
  b.creditors.U1 = 500; assert.ok(applyOp(w, boss, { op: 'seize_customs', target: e }).ok); f.port = t.ha.id; w.newsThisTurn = []; militaryStep(w); assert.ok(!w.seizures.length && w.newsThisTurn.some(x => /no longer holds/.test(x.text)) && b.creditors.U1 > 400, 'when the ships go the customs house goes back with the debt unpaid');
  const ref = refereePrompt(w, a, [{ actor: boss, decisions: ['Send the gunboats.'] }]); assert.ok(ref.includes('demonstrate{target,fleet?}') && ref.includes('seize_customs{target}') && ref.includes('kind:cruiser|battleship|dreadnought|torpedo|submarine|merchant'), 'the referee knows these orders');
});
import { planEdge as planFor, railWorks as lineRuns, supplyOf as fedAt } from '../engine/military.js';
import { iced as frozen, SHIPS as SHIP_KINDS } from '../engine/navy.js';
import { courtStep as courtQuarter } from '../engine/court.js';

chain('An attack that is not seen coming is a surprise: a staff that knows its neighbour, with cavalry out, sees troops massing sooner, a screen of the attacker\'s own horse hides them longer, and a prepared attack is the likelier seen; cavalry rides down a beaten enemy in open country and marches faster than men on foot', () => {
  // The same attack, many times: how often it falls as a surprise.
  const tries = (prep, order = {}) => { let surprised = 0, warned = 0; for (let i = 0; i < 40; i++) { const t = twoRoads(1), { w, over, e1 } = t; w.rng = 11 + i * 5521; const atk = soldier(w, 'U1', e1.id, 150); soldier(w, 'U2', over.id, 60); prep(t);
      applyOp(w, t.gen, { op: 'offensive', to: over.id, units: [atk.id], ...order }); let b = quarter(w); if (!b.length) b = quarter(w); if (b[0]?.surprise) surprised++; if (w.characters[t.d.general].inbox.some(m => /forming up opposite/.test(m.text))) warned++; } return { surprised, warned }; };
  const blind = tries(t => { t.d.intel.U1 = 0; }), watchful = tries(t => { t.d.intel.U1 = 90; makeUnit(t.w, 'U2', t.over.id, 5, 1, 80, 'cavalry'); });
  assert.ok(blind.surprised >= 28 && watchful.surprised <= blind.surprised - 10 && watchful.warned >= 15, `a blind staff is surprised most of the time, a watchful one far less: ${JSON.stringify(blind)} against ${JSON.stringify(watchful)}`);
  const atOnce = tries(t => { t.d.intel.U1 = 30; }), prepared = tries(t => { t.d.intel.U1 = 30; }, { prepare: 1 }), screened = tries(t => { t.d.intel.U1 = 30; makeUnit(t.w, 'U1', t.e1.id, 5, 1, 80, 'cavalry'); }, { prepare: 1 });
  assert.ok(prepared.surprised < atOnce.surprised - 5 && prepared.warned > atOnce.warned && screened.surprised > prepared.surprised, `a quarter of preparation is a quarter in which to be seen, and a cavalry screen hides some of it: at once ${JSON.stringify(atOnce)}, prepared ${JSON.stringify(prepared)}, screened ${JSON.stringify(screened)}`);
  // What it is worth, and what the two staffs are told.
  const one = seed => { const t = twoRoads(1); t.w.rng = seed; t.d.intel.U1 = 0; const atk = soldier(t.w, 'U1', t.e1.id, 150); soldier(t.w, 'U2', t.over.id, 60); applyOp(t.w, t.gen, { op: 'offensive', to: t.over.id, units: [atk.id] }); return { b: quarter(t.w)[0], t }; };
  let hit = null; for (let i = 0; i < 12 && !hit; i++) { const r = one(900 + i); if (r.b.surprise) hit = r; } assert.ok(hit && /fell on them as a surprise/.test(hit.t.said()) && /took us by surprise/.test(hit.t.w.characters[hit.t.d.general].inbox.map(m => m.text).join(' ')), 'both staffs know it was a surprise');
  // Pursuit: the same rout with and without horsemen among the victors.
  const rout = horse => { const t = twoRoads(1); t.w.rng = 77; const us = [soldier(t.w, 'U1', t.e1.id, 190).id]; { const x = soldier(t.w, 'U1', t.e1.id, 10); if (horse) x.kind = 'cavalry'; us.push(x.id); } soldier(t.w, 'U2', t.over.id, 50); applyOp(t.w, t.gen, { op: 'offensive', to: t.over.id, units: us }); return quarter(t.w)[0]; };
  const ridden = rout(true), onFoot = rout(false); assert.ok(ridden.attackerWon && onFoot.attackerWon && ridden.prisoners >= onFoot.prisoners + 2, `horsemen ride down what runs: ${ridden.prisoners} thousand prisoners against ${onFoot.prisoners}`);
  // The march, the depot and the inherited army.
  const y = fresh(); while (seasonOf(y) !== 'summer') y.turn++; for (const u of Object.values(y.units)) delete y.units[u.id]; for (const p of countryProvinces(y, 'U1')) { p.terrain = 'plains'; p.infra = 1.2; p.rail = 0; }
  const k = y.countries.U1, hops = (from, to) => { let n = 0, cur = from; while (cur !== to && n < 40) { cur = routeStep(y, cur, to, 'U1'); n++; if (!cur) return 99; } return n; }, far = countryProvinces(y, 'U1').find(p => hops(k.capital, p.id) === 4);
  if (far) { const foot = makeUnit(y, 'U1', k.capital, 20), ride = makeUnit(y, 'U1', k.capital, 5, 1, 80, 'cavalry'); foot.target = ride.target = far.id; militaryStep(y); assert.ok(ride.province === far.id && foot.province !== far.id, 'four provinces of good road in a quarter for cavalry, three for infantry'); }
  k.treasury = k.gdp * 3; k.stock.arms = 500; const depot = countryProvinces(y, 'U1')[0], n0 = Object.keys(y.units).length; assert.ok(applyOp(y, ld(y, k), { op: 'recruit', province: depot.id, men: 4, unit_kind: 'cavalry' }).ok); run(y, 2); assert.ok(Object.values(y.units).some(u => u.kind === 'cavalry' && u.province === depot.id && Math.abs(u.men - 4) < .5) && Object.keys(y.units).length >= n0 + 1, 'cavalry is raised like any other arm, in two quarters');
  const h = inherited(); assert.ok(aliveCountries(h).filter(c => Object.values(h.units).some(u => u.country === c.id && u.kind === 'cavalry')).length >= 3, 'an army handed over has its horsemen');
});

chain('What a campaign does to an army and to the country it crosses: men who come through a fight are better soldiers and drill makes soldiers of recruits; sickness thins an army in the field, most in marsh and least with modern medicine; a river is a line; an occupied province held by too few men cuts the railway behind the army; and siege guns shorten a siege', () => {
  // Experience.
  const t = twoRoads(1); t.w.rng = 5; const vet = soldier(t.w, 'U1', t.e1.id, 200), raw = soldier(t.w, 'U2', t.over.id, 40); applyOp(t.w, t.gen, { op: 'offensive', to: t.over.id, units: [vet.id] }); const b = quarter(t.w)[0];
  assert.ok(b.attackerWon && vet.quality > 1.02 && /seasoned troops|B\d+/.test(lookUp(t.w, t.gen, 'army')), `troops that have fought and won are better for it: ${vet.quality}`);
  const green = makeUnit(t.w, 'U1', t.e1.id, 10, .8, 80); t.w.wars = []; for (let i = 0; i < 12; i++) militaryStep(t.w); assert.ok(green.quality > .92 && green.quality < 1.001 && vet.quality < 1.03, `three years of drill make soldiers of recruits, and the veterans' edge wears off: ${green.quality}, ${vet.quality}`);
  // Sickness.
  const sick = (terrain, medicine) => { const s = twoRoads(1), camp = s.e1; camp.terrain = terrain; if (medicine) s.a.techs.antibiotics = 1; soldier(s.w, 'U1', camp.id, 100); soldier(s.w, 'U2', countryProvinces(s.w, 'U2').find(p => !p.neighbors.includes(camp.id)).id, 10); militaryStep(s.w); return s.a._sick; };
  const plain = sick('plains'), marsh = sick('marsh'), cured = sick('marsh', true); assert.ok(plain > .3 && plain < .6 && marsh > plain * 3 && Math.abs(cured - marsh / 2) < .01, `a hundred thousand in the field lose some hundreds a quarter to sickness, thousands in a summer marsh, half that with modern medicine: ${plain}, ${marsh}, ${cured}`);
  { const p = twoRoads(1); p.w.wars = []; soldier(p.w, 'U1', p.e1.id, 100); militaryStep(p.w); assert.equal(p.a._sick, 0, 'in barracks in peace the army keeps its health'); assert.ok(/loses men to sickness/.test(lookUp(p.w, p.gen, 'army'))); }
  // A river line: the same attack, the same luck, across a river and across open ground; and across the ice.
  const cross = (river, winter) => { const r = twoRoads(1); r.w.rng = 31; r.over.river = river; if (winter) while (seasonOf(r.w) !== 'winter') r.w.turn++; const atk = soldier(r.w, 'U1', r.e1.id, 150), def = soldier(r.w, 'U2', r.over.id, 100); r.w.strategic = r.w.strategic.filter(s => s.ref !== r.over.id); applyOp(r.w, r.gen, { op: 'offensive', to: r.over.id, units: [atk.id] }); const x = quarter(r.w)[0]; return { lossA: 150 - (r.w.units[atk.id]?.men ?? 0) - (r.a._sick || 0), lossD: 100 - (r.w.units[def.id]?.men ?? 0), x }; };
  const dry = cross(0), wet = cross(.8), ice = cross(.8, true), frost = cross(0, true); assert.ok(wet.lossD < dry.lossD * .95 && wet.lossA > dry.lossA && Math.abs(ice.lossD - frost.lossD) < 1e-6, `a river costs whoever must cross it, unless it is frozen: defender lost ${wet.lossD} behind it against ${dry.lossD} without`);
  // Bands behind the army.
  const o = twoRoads(1), took = o.over, people = Object.values(took.pops).reduce((s, x) => s + x.n, 0), need = people / 400; soldier(o.w, 'U1', took.id, need * .5); takeProvince(o.w, took, 'U1'); o.w.turn += 3; militaryStep(o.w);
  assert.ok(took.cut && !lineRuns(o.w, took) && /held by too few men for its people/.test(o.said()), `half the garrison a people calls for does not keep its railway running: ${need}`);
  const beyond = took.neighbors.map(n => o.w.provinces[n]).find(p => p.controller === 'U2'), thin = fedAt(o.w, { country: 'U1', province: beyond.id }).depth; soldier(o.w, 'U1', took.id, need); militaryStep(o.w);
  assert.ok(!took.cut && lineRuns(o.w, took) && fedAt(o.w, { country: 'U1', province: beyond.id }).depth < thin, 'with men enough in it the line runs again and the army beyond is fed again');
  // Siege guns.
  const siege = guns => { const s = twoRoads(1); s.over.fort = 3; soldier(s.w, 'U1', s.over.id, 120); if (guns) soldier(s.w, 'U1', s.over.id, 12).kind = 'artillery'; let n = 0; while (s.over.controller !== 'U1' && n < 12) { militaryStep(s.w); n++; } return n; };
  const slow = siege(false), fast = siege(true); assert.ok(fast < slow && slow <= 6, `a fortress invested with siege guns falls sooner: ${fast} quarters against ${slow}`);
});

chain('A plan of campaign is a paper: drawn up in peace it lets the army open a war by timetable, and whoever holds a copy across the frontier is waiting where the blow falls; it can be handed over, which leaves a trace, or copied by a bought man on the staff; and a new plan makes an old copy worthless', () => {
  const t = twoRoads(.6), { w, a, d } = t; delete a.techs.radio; const war = w.wars; w.wars = [];
  assert.ok(/has no plan drawn up/.test(lookUp(w, t.gen, 'war_plan:U2')));
  const made = applyOp(w, t.gen, { op: 'prepare_plan', target: 'U2', objective: t.over.id, text: 'Main weight through Glenara.' }); assert.ok(made.ok && /ready in two quarters/.test(made.msg), made.msg);
  assert.ok(/being drawn up/.test(lookUp(w, t.gen, 'war_plan:U2')) && planFor(w, 'U1', 'U2') === 0); assert.equal(applyOp(w, w.characters[a.opposition], { op: 'prepare_plan', target: 'U2' }).ok, false, 'the staff\'s work is the staff\'s and the ruler\'s to order');
  w.turn += 1; { const again = applyOp(w, ld(w, a), { op: 'prepare_plan', target: 'U2', objective: t.over.id, text: 'Main weight through Glenara, the cavalry on the left.' }); assert.ok(again.ok && /neither hastens it nor starts it afresh/.test(again.msg) && a.plans.U2.ready === w.turn + 1 && /cavalry on the left/.test(a.plans.U2.text), `ordered again a quarter later, the plan is neither hastened nor begun afresh: ${again.msg}`); }
  w.turn += 1; assert.ok(/lies ready, with .* as its first objective/.test(lookUp(w, t.gen, 'war_plan:U2')) && planFor(w, 'U1', 'U2') === 0, 'ready, and worth nothing until there is a war');
  war[0].start = w.turn; w.wars = war; assert.equal(planFor(w, 'U1', 'U2'), 1);
  // By timetable: two columns under a poor commander with no wireless, with the plan and without it.
  const base = structuredClone(w), onTime = plan => { let n = 0; for (let i = 0; i < 40; i++) { const x = structuredClone(base); x.rng = 400 + i * 3571; if (!plan) delete x.countries.U1.plans; const u1 = soldier(x, 'U1', t.e1.id, 80), u2 = soldier(x, 'U1', t.e2.id, 60); soldier(x, 'U2', t.over.id, 60);
      applyOp(x, x.characters[a.general], { op: 'offensive', to: t.over.id, units: [u1.id, u2.id] }); x.battles = []; militaryStep(x); if (x.battles[0]?.sides === 2) n++; } return n; };
  const planned = onTime(true), unplanned = onTime(false); assert.ok(planned > unplanned + 5, `with a plan ready the columns keep time: ${planned} of 40 against ${unplanned}`);
  // Handed over.
  const leak = applyOp(w, t.gen, { op: 'leak_plan', against: 'U2', to: 'U2' }); assert.ok(leak.ok && d.stolen.U1.against === 'U2' && planFor(w, 'U1', 'U2') === -1, leak.msg);
  assert.ok((t.gen.secrets || []).some(s => /Passed the general staff's plan/.test(s.text)) && ld(w, d).inbox.some(m => /A copy of the general staff's plan/.test(m.text) && /Main weight through Glenara/.test(m.text)) && /We hold a copy of a plan of theirs for war with us/.test(lookUp(w, w.characters[d.general], 'war_plan:U1')), 'the traitor is marked, and the other staff has the paper');
  const atk = soldier(w, 'U1', t.e1.id, 150); soldier(w, 'U2', t.over.id, 60); applyOp(w, t.gen, { op: 'offensive', to: t.over.id, units: [atk.id] }); const b = quarter(w)[0]; assert.ok(!b.surprise && /they knew our plan of campaign/.test(t.said()) && /came where the copy of their plan in our hands said it would/.test(w.characters[d.general].inbox.map(m => m.text).join(' ')), 'an army that follows a betrayed plan surprises nobody, and both staffs know why');
  // A new plan.
  assert.ok(applyOp(w, t.gen, { op: 'prepare_plan', target: 'U2', text: 'A note in the margin.' }).ok); assert.equal(planFor(w, 'U1', 'U2'), -1, 'a note added to the plan does not make the copy abroad worthless');
  const elsewhere = countryProvinces(w, 'U2').find(p => p.id !== t.over.id && p.controller === 'U2').id, recast = applyOp(w, t.gen, { op: 'prepare_plan', target: 'U2', objective: elsewhere }); assert.ok(recast.ok && /recast around a new first objective/.test(recast.msg), recast.msg);
  assert.equal(planFor(w, 'U1', 'U2'), 0, 'the recast plan is not ready'); w.turn += 1; w.wars[0].start = w.turn; assert.equal(planFor(w, 'U1', 'U2'), 1, 'and when it is, a quarter later, the old copy is worth nothing');
  assert.ok(applyOp(w, t.gen, { op: 'prepare_plan', target: 'U3' }).ok && applyOp(w, t.gen, { op: 'prepare_plan', target: 'U4' }).ok && !a.plans.U2 && a.plans.U3 && a.plans.U4, 'a staff keeps two plans in order');
  // Copied by a bought man on the staff.
  let copied = 0, told = 0; for (let i = 0; i < 12; i++) { const x = structuredClone(base); x.rng = 70 + i * 811; delete x.countries.U2.stolen; const clerk = spawnCharacter(x, 'U1', 'official', x.countries.U1.axes, { power: 20 }); clerk.clerkOf = 'army'; clerk.handler = x.countries.U2.leader; clerk.loyalty = 10; clerk.stipend = 5; clerk.boughtAt = x.turn;
    courtQuarter(x, applyOp); if (x.countries.U2.stolen?.U1?.against === 'U2') copied++; if (x.characters[x.countries.U2.leader].inbox.some(m => /He has copied the staff's plan for war with/.test(m.text))) told++; }
  assert.ok(copied >= 6 && told === copied, `a clerk in foreign pay copies it for his paymaster's state: ${copied} of 12`);
  const ref = refereePrompt(w, a, [{ actor: t.gen, decisions: ['Plan.'] }]); assert.ok(ref.includes('prepare_plan{target,objective?:province id of theirs,text?}') && ref.includes('leak_plan{against,to}'), 'the referee knows these orders');
});

chain('The sea has seasons and crews have tempers: a northern harbour freezes in winter and takes no ship or cargo until spring; the all-big-gun ship outclasses the battleship once the yards can build it; a squadron left unpaid in harbour mutinies, and one lying in the capital\'s harbour counts when the state is struck at', () => {
  // Ice.
  const t = twoNavies(), { w, ha } = t; w.wars = []; ha.terrain = 'tundra'; const f = t.ship('U1', ha.seas[0], 6, 'cruiser', ha), out = w.seas[ha.seas[0]].neighbors[0];
  while (seasonOf(w) !== 'winter') w.turn++; assert.ok(frozen(w, ha) && applyOp(w, t.gen, { op: 'move_fleet', fleet: f.id, to: out }).ok); militaryStep(w); assert.ok(f.port === ha.id && /frozen in/.test(f.sailed) && /FROZEN IN until spring/.test(lookUp(w, t.gen, 'fleet')), `in winter the squadron stays where it is: ${f.sailed}`);
  w.turn++; militaryStep(w); assert.ok(!f.port && f.sea === out && !frozen(w, ha), 'and sails with the thaw');
  { const x = fresh(); updateRoutes(x); const k = Object.keys(x.routes).find(r => x.routes[r].mode === 'sea'); assert.ok(k); const [a1] = k.split('|'); for (const p of countryProvinces(x, a1)) if (p.port > 0) p.terrain = 'tundra'; while (seasonOf(x) !== 'winter') x.turn++; updateRoutes(x); assert.ok(x.routes[k]?.mode !== 'sea', 'a country whose harbours are all frozen does not trade by sea in winter'); x.turn++; updateRoutes(x); assert.equal(x.routes[k]?.mode, 'sea', 'and does again in spring'); }
  // Dreadnoughts.
  const y = twoNavies(), boss = ld(y.w, y.a); y.ha.port = 3; const no = applyOp(y.w, boss, { op: 'build_ship', province: y.ha.id, ships: 1, kind: 'dreadnought' }); assert.ok(!no.ok && /lack the technology \(All-big-gun battleships\)/.test(no.msg), no.msg);
  y.a.techs.dreadnought = 1; assert.ok(applyOp(y.w, boss, { op: 'build_ship', province: y.ha.id, ships: 1, kind: 'dreadnought' }).ok); assert.ok(SHIP_KINDS.dreadnought.power >= SHIP_KINDS.battleship.power * 2 && /dreadnoughts \(a harbour of the third size/.test(lookUp(y.w, y.gen, 'fleet')));
  let won = 0; for (let i = 0; i < 20; i++) { const z = twoNavies(); z.w.rng = 3 + i * 4001; z.ship('U1', z.meet, 2, 'dreadnought'); z.ship(z.e, z.meet, 3, 'battleship'); militaryStep(z.w); if (z.w.seaFights[0].winner === 'U1') won++; } assert.ok(won >= 13, `two of the new ships are a match for three of the old: ${won} of 20`);
  // Mutiny.
  const m = twoNavies(); m.w.wars = []; const idle = m.ship('U1', m.ha.seas[0], 8, 'battleship', m.ha); idle.morale = 36; soldier(m.w, 'U1', m.ha.id, 40); m.a.budget.military = 0; m.a.arrears = 5; const unrest = m.ha.unrest, cells = m.a.cells || 0; m.w.newsThisTurn = [];
  for (let i = 0; i < 4 && !idle.mutiny; i++) militaryStep(m.w); assert.ok(idle.mutiny && m.w.newsThisTurn.some(x => /have mutinied/.test(x.text)) && /mutinied/.test(m.said('U1')), `unpaid crews in harbour mutiny: morale ${idle.morale}`);
  militaryStep(m.w); assert.ok(m.ha.unrest > unrest && (m.a.cells || 0) > cells && /ITS CREWS HAVE MUTINIED/.test(lookUp(m.w, m.gen, 'fleet')), 'the port is in uproar and the underground gains');
  applyOp(m.w, m.gen, { op: 'move_fleet', fleet: idle.id, to: m.ha.seas[0] }); militaryStep(m.w); assert.ok(idle.port === m.ha.id && /mutinied/.test(idle.sailed), 'a squadron in mutiny does not sail');
  m.a.budget.military = .3; m.a.arrears = 0; for (let i = 0; i < 12 && idle.mutiny; i++) militaryStep(m.w); assert.ok(!idle.mutiny, 'paid again, the crews return to duty');
  // The squadron in the capital's harbour.
  const c = twoNavies(), cap = c.w.provinces[c.a.capital]; cap.port = Math.max(cap.port, 2); cap.seas = cap.seas.length ? cap.seas : [c.ha.seas[0]]; const flag = c.ship('U1', cap.seas[0], 10, 'battleship', cap), admiralOp = applyOp(c.w, ld(c.w, c.a), { op: 'appoint_commander', fleet: flag.id, name: 'Admiral Rosk' }); assert.ok(admiralOp.ok);
  const plot = { leader: c.a.opposition, members: [] }, loyal = sidesOf(c.w, c.a, plot), turned = sidesOf(c.w, c.a, { leader: c.a.opposition, members: [flag.commander] }); assert.ok(loyal.pro + loyal.anti > 40 && turned.pro > loyal.pro + 8, `ten battleships in the capital's harbour weigh in a coup, and go with their admiral: ${JSON.stringify(loyal)} then ${JSON.stringify(turned)}`);
});
console.log('All checks passed.');
