// What a war costs the states that fight it and the ones that do not: the same world run twice, once at peace and once with two neighbours at war
// (no orders given: the armies stand; it is the war footing that is measured, not the fighting), and the difference after some quarters.
// Run from the repository: node tools/balance/warcost.mjs . [seed] [quarters] [countries] [provinces]
import { pathToFileURL } from 'node:url';
const root = pathToFileURL(process.argv[2] + '/').href, [seed = 2696855, Q = 8, countries = 8, provinces = 200] = process.argv.slice(3).map(Number);
const { createWorld, aliveCountries, countryProvinces, GOODS } = await import(root + 'engine/world.js'); const { beginTurn, stepWorld } = await import(root + 'engine/step.js'); const { applyOp } = await import(root + 'engine/ops.js');
const make = () => createWorld({ plainStates: false, seed, countries, provinces, agentRoles: [], countryAgentRoles: {}, models: {}, concurrency: 2, wakeEvery: 1, wakeTension: 45, maxMessagesPerActor: 3, maxDecisionsPerActor: 5, limitRetryMinutes: 0, maxTurns: 0 });
const run = (w, n) => { for (let i = 0; i < n; i++) { beginTurn(w); stepWorld(w); w.turn++; } };
const peace = make(), war = make(); run(peace, 2); run(war, 2);
// The attacker is the state with the largest army; the attacked, the neighbour by land that sells most abroad.
const cs = aliveCountries(war), men = id => Object.values(war.units).filter(u => u.country === id).reduce((a, u) => a + u.men, 0), A = [...cs].sort((a, b) => men(b.id) - men(a.id))[0];
const near = cs.filter(o => o.id !== A.id && countryProvinces(war, o.id).some(p => p.neighbors.some(n => war.provinces[n].controller === A.id))), B = [...near].sort((a, b) => (b._exports || 0) - (a._exports || 0))[0];
const lead = c => war.characters[c.leader]; if (war.countries[A.id].parliament) delete war.countries[A.id].parliament;
const d = applyOp(war, lead(A), { op: 'declare_war', target: B.id }); console.log(`${A.name} [${A.archetype}] makes war on ${B.name} [${B.archetype}]: ${d.ok ? 'declared' : d.msg}`);
run(peace, Q); run(war, Q);
const r = (x, n = 0) => Math.round(x * 10 ** n) / 10 ** n, pct = x => `${x >= 0 ? '+' : ''}${r(x * 100, 1)}%`;
console.log(`after ${Q} quarters, the world at war against the same world at peace:`);
for (const c of aliveCountries(peace)) { const x = war.countries[c.id], role = c.id === A.id ? 'ATTACKER' : c.id === B.id ? 'ATTACKED' : 'neutral ';
  console.log(`  ${role} ${c.name.split(' ').pop().padEnd(9)} [${c.archetype.padEnd(13)}] output ${pct(x.realGdp / c.realGdp - 1)} | jobless ${r(c.unemployment * 100, 1)}% -> ${r(x.unemployment * 100, 1)}% | interest a year ${r(c.interestRate * 400, 2)}% -> ${r(x.interestRate * 400, 2)}% | debt ${r(c.debt)} -> ${r(x.debt)} | gold ${r(c.reserves)} -> ${r(x.reserves)} | prices at home ${pct(x.priceLevel / c.priceLevel - 1)} | shops ${r((c.goodsRatio ?? 1) * 100)} -> ${r((x.goodsRatio ?? 1) * 100)} | food ${r(c.foodRatio * 100)} -> ${r(x.foodRatio * 100)} | exports ${r(c.lastExportGold ?? 0)} -> ${r(x.lastExportGold ?? 0)} | legitimacy ${r(c.legitimacy)} -> ${r(x.legitimacy)} | war bill ${r(x._warBill?.gold ?? 0)}`); }
console.log('  world prices:', GOODS.map(g => `${g} ${pct(war.globalPrice[g] / peace.globalPrice[g] - 1)}`).join(', '));
console.log('  world output', pct(aliveCountries(war).reduce((a, c) => a + c.realGdp, 0) / aliveCountries(peace).reduce((a, c) => a + c.realGdp, 0) - 1), '| what the exchanges say:', Object.values(war.market?.notes || {}).map(n => n.why[0]).slice(0, 3).join(' // ') || 'nothing');
console.log('  news of the markets:', war.newsLog?.filter?.(e => /On the exchanges/.test(e.text)).slice(-3).map(e => e.text).join(' || ') || '(none kept in the log)');
