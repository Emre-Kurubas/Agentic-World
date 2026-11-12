// What each kind of public work returns: one inherited world, one country, one build order on the first day, twenty quarters, against the same
// country left alone, averaged over four sequences of the world's dice (a single run is noise of some tens of GDP a quarter).
// Run from the repository: node tools/balance/works.mjs . 20 U4,U8
import { pathToFileURL } from 'node:url';
const root = pathToFileURL(process.argv[2] + '/').href, Q = +process.argv[3] || 20, WHO = (process.argv[4] || 'U4,U8,U7').split(',');
const { createWorld, countryProvinces, provincePop } = await import(root + 'engine/world.js');
const { beginTurn, stepWorld } = await import(root + 'engine/step.js');
const { applyOp } = await import(root + 'engine/ops.js');
const cfg = { plainStates: false, seed: 2696855, countries: 8, provinces: 200, agentRoles: [], countryAgentRoles: {}, models: {}, concurrency: 2, wakeEvery: 1, wakeTension: 45, maxMessagesPerActor: 3, maxDecisionsPerActor: 5, limitRetryMinutes: 0, maxTurns: 0 };
const w0 = createWorld(cfg); for (let i = 0; i < 2; i++) { beginTurn(w0); stepWorld(w0); }
const r1 = v => Math.round(v * 10) / 10, VAR = [0, 7919, 104729, 1299709];
for (const who of WHO) {
  const c0 = w0.countries[who], ps = countryProvinces(w0, who).sort((a, b) => provincePop(b) - provincePop(a));
  const run = (ops, v) => { const w = structuredClone(w0); w.rng = (w.rng + v) | 0; const c = w.countries[who], boss = w.characters[c.leader]; const t0 = c.treasury, d0 = c.debt; let note = ''; for (const op of ops) { const r = applyOp(w, boss, { ...op, _law: true }); note = (r.ok ? '' : 'REFUSED ') + String(r.msg).slice(0, 90); } const spent = (t0 - c.treasury) + (c.debt - d0); let gdp = 0; const out = {}; for (let i = 0; i < Q; i++) { beginTurn(w); stepWorld(w); gdp += c.realGdp; } return { spent, gdp, end: c.realGdp, endRev: c.lastRevenue / c.priceLevel, unemp: c.unemployment * 100, note }; };
  const bases = VAR.map(v => run([], v));
  console.log(`\n== ${who} ${c0.name}: quarterly real GDP ${Math.round(c0.realGdp)}, revenue ${Math.round(c0.lastRevenue)}, treasury ${Math.round(c0.treasury)}; ${Q} quarters, mean of ${VAR.length} dice sequences [min..max]`);
  const big = ps[1], mid = ps[Math.floor(ps.length / 2)], coast = ps.find(p => p.coast && p.port < 3 && p.port >= 1 && p.id !== c0.capital), nocoast = ps.find(p => p.coast && !p.port), riv = ps.find(p => p.river >= .25 && !p.dam), norail = ps.find(p => !p.rail) ?? big, forest = ps.find(p => p.timber >= .3);
  const deps = {}; for (const p of ps) for (const [k, d] of Object.entries(p.deposits)) if (d.known && d.mine > 0 && d.mine < 3 && k !== 'gold' && !deps[k]) deps[k] = p;
  const A = 300;
  const tests = [
    ['railway (first line) ' + norail.id + ' ' + norail.terrain + ' ' + Math.round(provincePop(norail)) + 'k', [{ op: 'build', province: norail.id, kind: 'railway' }]],
    ['roads 300 at ' + big.id, [{ op: 'build', province: big.id, kind: 'infrastructure', amount: A }]],
    ['farming 300 at ' + big.id, [{ op: 'build', province: big.id, kind: 'farming', amount: A }]],
    ['administration 300 at ' + mid.id, [{ op: 'build', province: mid.id, kind: 'administration', amount: A }]],
    coast && ['larger harbour ' + coast.id + ' (now ' + coast.port + ')', [{ op: 'build', province: coast.id, kind: 'port' }]],
    nocoast && ['first harbour ' + nocoast.id, [{ op: 'build', province: nocoast.id, kind: 'port' }]],
    riv && ['dam ' + riv.id, [{ op: 'build', province: riv.id, kind: 'dam' }]],
    forest && ['forestry 300 at ' + forest.id, [{ op: 'build', province: forest.id, kind: 'forestry', amount: A }]],
    ...Object.entries(deps).map(([k, p]) => [k + ' mine 300 at ' + p.id + ' (plants there ' + r1(Object.values(p.plants).reduce((a, b) => a + b, 0)) + ')', [{ op: 'build', province: p.id, kind: 'mine', resource: k, amount: A }]]),
    ...['steel', 'machines', 'goods', 'arms', 'fuel', 'fertilizer'].map(k => [k + ' works 300 at ' + big.id, [{ op: 'build', province: big.id, kind: k, amount: A }]]),
  ].filter(Boolean);
  console.log('work'.padEnd(46) + 'cost   dGDP/quarter at end [min..max]      dRevenue/q    5-yr GDP gain / cost   note');
  for (const [name, ops] of tests) { const ms = VAR.map(v => run(ops, v)), dG = ms.map((m, i) => m.end - bases[i].end), dR = ms.map((m, i) => m.endRev - bases[i].endRev), sg = ms.map((m, i) => (m.gdp - bases[i].gdp) / Math.max(m.spent, 1)), mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
    console.log(name.padEnd(46) + String(Math.round(ms[0].spent)).padEnd(7) + `${r1(mean(dG))} [${r1(Math.min(...dG))}..${r1(Math.max(...dG))}]`.padEnd(38) + String(r1(mean(dR))).padEnd(14) + String(r1(mean(sg))).padEnd(23) + ms[0].note.slice(0, 80)); }
}
