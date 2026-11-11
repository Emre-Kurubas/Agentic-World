// Screens seeds for a world to play: which of them give every mainland state two neighbours by land, at most one state alone on an island, no
// state a fraction of another, no capital on a frontier and no state with much of itself across the sea.
// Run from the repository: node tools/balance/seeds.mjs . <countries> <provinces> <how many> [first] [show]
//   e.g. node tools/balance/seeds.mjs . 8 200 160          node tools/balance/seeds.mjs . 8 200 40 20261111 show   (prints the rejected ones too)
// A seed that passes is only a candidate: run it forty quiet quarters (tools/balance/unmanaged.mjs) and look at it in the panel before it is played.
import { pathToFileURL } from 'node:url';
const root = pathToFileURL(process.argv[2] + '/').href, [countries, provinces, many, first] = process.argv.slice(3).map(Number), show = process.argv[7];
const { createWorld, aliveCountries, countryProvinces, provincePop } = await import(root + 'engine/world.js');
let s = first || 20261111; const next = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) % 9000000 + 1000;
const out = [];
for (let k = 0; k < many; k++) { const seed = next(); let w;
  try { w = createWorld({ plainStates: false, seed, countries, provinces, agentRoles: [], countryAgentRoles: {}, models: {}, concurrency: 2, wakeEvery: 1, wakeTension: 45, maxMessagesPerActor: 3, maxDecisionsPerActor: 5, limitRetryMinutes: 0, maxTurns: 0 }); } catch (e) { console.log(seed, 'FAILED', e.message); continue; }
  // Landmasses: provinces that can be walked between.
  const ps = Object.values(w.provinces), seen = new Set(), body = {}, sizes = []; let nb = 0;
  for (const p of ps) { if (seen.has(p.id)) continue; const q = [p.id]; seen.add(p.id); let n = 0; while (q.length) { const x = w.provinces[q.pop()]; body[x.id] = nb; n++; for (const m of x.neighbors) if (!seen.has(m)) { seen.add(m); q.push(m); } } sizes.push(n); nb++; }
  const cs = aliveCountries(w), info = cs.map(c => { const mine = countryProvinces(w, c.id), land = new Set(mine.flatMap(p => p.neighbors.map(n => w.provinces[n].owner)).filter(id => id !== c.id));
    return { a: c.archetype, n: mine.length, land: land.size, away: mine.filter(p => body[p.id] !== body[c.capital]).length, gdp: c.gdp, pop: mine.reduce((a, p) => a + provincePop(p), 0), border: w.provinces[c.capital].neighbors.some(n => w.provinces[n].owner !== c.id), sea: !!c.seaState }; });
  const lone = info.filter(x => x.sea), thin = info.filter(x => !x.sea && x.land <= 1).length, gdp = info.map(x => x.gdp), pop = info.map(x => x.pop), fronts = info.reduce((a, x) => a + x.land, 0) / 2;
  const ok = thin === 0 && lone.length <= 1 && info.every(x => x.away <= 6) && Math.max(...gdp) / Math.min(...gdp) <= 2.4 && Math.max(...pop) / Math.min(...pop) <= 2.1 && !info.some(x => x.border);
  const line = `${seed}: landmasses ${sizes.sort((a, b) => b - a).slice(0, 5).join('/')}; land neighbours ${info.map(x => x.land).join(' ')}; alone on an island ${lone.map(x => x.a).join(',') || '-'}; frontiers ${fronts}; gdp x${(Math.max(...gdp) / Math.min(...gdp)).toFixed(2)} pop x${(Math.max(...pop) / Math.min(...pop)).toFixed(2)}; provinces ${info.map(x => x.n).join(' ')}; across the sea ${info.map(x => x.away).join(' ')}`;
  if (ok) { out.push({ seed, lone: lone.length, fronts, ratio: Math.max(...gdp) / Math.min(...gdp) }); console.log('OK   ' + line); } else if (show) console.log('     ' + line);
}
console.log(`\n${out.length} of ${many} seeds pass. Best with an island state: ${out.filter(x => x.lone).sort((a, b) => a.ratio - b.ratio).slice(0, 4).map(x => x.seed).join(', ') || 'none'}; best without: ${out.filter(x => !x.lone).sort((a, b) => b.fronts - a.fronts || a.ratio - b.ratio).slice(0, 4).map(x => x.seed).join(', ') || 'none'}`);
