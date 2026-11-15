// What lenders ask of a state that borrows: the same world, nobody governing, three ways: left alone; one state spending two in the hundred of
// its output more every quarter (a peace of borrowed welfare); and a war in which the attacker votes its army what it costs (covers:1).
// node rates.mjs <repo> [seed] [quarters]
import { pathToFileURL } from 'node:url';
const root = pathToFileURL(process.argv[2] + '/').href, [seed = 2696855, Q = 16] = process.argv.slice(3).map(Number);
const { createWorld, aliveCountries, countryProvinces } = await import(root + 'engine/world.js'); const { beginTurn, stepWorld } = await import(root + 'engine/step.js'); const { applyOp } = await import(root + 'engine/ops.js');
const make = () => createWorld({ plainStates: false, seed, countries: 8, provinces: 200, agentRoles: [], countryAgentRoles: {}, models: {}, concurrency: 2, wakeEvery: 1, wakeTension: 45, maxMessagesPerActor: 3, maxDecisionsPerActor: 5, limitRetryMinutes: 0, maxTurns: 0 });
const yr = c => (c.interestRate ?? 0) * 400, infl = c => (c.inflTrend ?? c.inflation ?? 0) * 400, burden = c => c.debt / Math.max(c.gdp * 4, 1) * 100;
const line = (c, q) => `q${String(q).padStart(2)} rate ${yr(c).toFixed(1)}% infl ${infl(c).toFixed(1)}% debt ${burden(c).toFixed(0)}% prices ${(c.priceLevel ?? 1).toFixed(2)} legit ${Math.round(c.legitimacy)} gdp ${Math.round(c.realGdp)}`;
function run(label, setup, perQuarter) {
  const w = make(); for (let i = 0; i < 2; i++) { beginTurn(w); stepWorld(w); }
  const focus = setup(w); const out = [];
  for (let q = 1; q <= Q; q++) { beginTurn(w); perQuarter?.(w, focus); stepWorld(w); if (q % 4 === 0) out.push(line(w.countries[focus], q)); }
  const all = aliveCountries(w); console.log(`\n${label}: ${w.countries[focus].name} [${w.countries[focus].archetype}]`); for (const l of out) console.log('  ' + l);
  console.log('  everyone: ' + all.map(c => `${(c.rootName ?? c.name).split(' ').pop()} ${yr(c).toFixed(1)}`).join(', '));
}
const junta = w => aliveCountries(w).find(c => c.archetype === 'junta') ?? aliveCountries(w)[0];
const republic = w => aliveCountries(w).find(c => c.archetype === 'republic') ?? aliveCountries(w)[1];
run('alone (junta)', w => junta(w).id);
run('alone (republic)', w => republic(w).id);
run('junta spends 2% of output more each quarter', w => { const c = junta(w); c._base = c.budget.welfare; return c.id; }, (w, id) => { const c = w.countries[id]; c.budget.welfare = c._base + .02; });
run('republic spends 4% of output more each quarter', w => { const c = republic(w); c._base = c.budget.welfare; return c.id; }, (w, id) => { const c = w.countries[id]; c.budget.welfare = c._base + .04; });
run('war: the largest army attacks a neighbour and votes the army its cost', w => {
  const cs = aliveCountries(w), men = id => Object.values(w.units).filter(u => u.country === id).reduce((a, u) => a + u.men, 0), A = [...cs].sort((a, b) => men(b.id) - men(a.id))[0];
  const B = cs.filter(o => o.id !== A.id && countryProvinces(w, o.id).some(p => p.neighbors.some(n => w.provinces[n].controller === A.id)))[0];
  if (A.parliament) delete A.parliament; const L = w.characters[A.leader]; const d = applyOp(w, L, { op: 'declare_war', target: B.id }); if (!d.ok) console.log(d.msg); A._B = B.id; return A.id;
}, (w, id) => { const c = w.countries[id]; applyOp(w, w.characters[c.leader], { op: 'set_budget', category: 'military', covers: 1 }); });
