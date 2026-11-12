// What a place and a state are worth to the world's trade: the same world eight quarters as it stands, with the state that carries most of
// other states' trade shutting its soil to them, with a due laid on it, and with a war between that state and a neighbour.
// Run from the repository: node tools/balance/ways.mjs .   (the argument is the repository's folder)
import { pathToFileURL } from 'node:url';
const root = pathToFileURL(process.argv[2] + '/').href, Q = 8;
const { createWorld, aliveCountries, countryProvinces } = await import(root + 'engine/world.js');
const { beginTurn, stepWorld } = await import(root + 'engine/step.js');
const { applyOp } = await import(root + 'engine/ops.js');
const cfg = { plainStates: false, seed: 2696855, countries: 8, provinces: 200, agentRoles: [], countryAgentRoles: {}, models: {}, concurrency: 2, wakeEvery: 1, wakeTension: 45, maxMessagesPerActor: 3, maxDecisionsPerActor: 5, limitRetryMinutes: 0, maxTurns: 0 };
const w0 = createWorld(cfg); for (let i = 0; i < 2; i++) { beginTurn(w0); stepWorld(w0); }
const r = v => Math.round(v), nm = id => w0.countries[id].name.split(' ').pop();
// Whose soil carries what of other states' trade.
const crossing = {}; for (const c of aliveCountries(w0)) { const mine = new Set(countryProvinces(w0, c.id).map(p => p.id)), by = {}; for (const [id, t] of Object.entries(w0.traffic || {})) if (mine.has(id)) for (const [k, v] of Object.entries(t.by)) if (!k.split('|').includes(c.id)) by[k] = Math.max(by[k] || 0, v); crossing[c.id] = by; }
console.log('What crosses each state between two others, a quarter:'); for (const [id, by] of Object.entries(crossing)) console.log(' ', nm(id).padEnd(9), r(Object.values(by).reduce((a, v) => a + v, 0)), Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k.split('|').map(nm).join('-')} ${r(v)}`).join(', '));
const hub = Object.entries(crossing).sort((a, b) => Object.values(b[1]).reduce((x, v) => x + v, 0) - Object.values(a[1]).reduce((x, v) => x + v, 0))[0][0], foe = aliveCountries(w0).find(c => c.id !== hub && countryProvinces(w0, c.id).some(p => p.neighbors.some(n => w0.provinces[n].controller === hub))).id;
const run = (label, setup) => { const w = structuredClone(w0); const said = setup(w) || ''; const acc = {}; for (let i = 0; i < Q; i++) { beginTurn(w); stepWorld(w); for (const c of Object.values(w.countries)) { const a = acc[c.id] ||= { exp: 0, tolls: 0, gdp: 0 }; a.exp += c.lastExportGold || 0; a.tolls += c.lastBooks?.tolls || 0; a.gdp += c.realGdp; } }
  console.log(`\n${label} ${String(said).slice(0, 150)}`);
  for (const c of Object.values(w.countries)) console.log(' ', nm(c.id).padEnd(9), 'exports/q', String(r(acc[c.id].exp / Q)).padStart(5), 'dues and tolls/q', String(r(acc[c.id].tolls / Q)).padStart(4), 'gdp/q', r(acc[c.id].gdp / Q), 'gold', r(c.reserves), 'shops', r((c.goodsRatio ?? 1) * 100), `relations with ${nm(hub)}`, r(c.relations?.[hub] ?? 0));
  const changed = Object.entries(w0.routes).map(([k, was]) => { const now = w.routes[k]; return !now ? `${k.split('|').map(nm).join('-')} CLOSED (was ${was.cost.toFixed(2)})` : Math.abs(now.cost - was.cost) > .015 ? `${k.split('|').map(nm).join('-')} ${was.cost.toFixed(2)}>${now.cost.toFixed(2)}` : null; }).filter(Boolean);
  console.log('  ways that changed:', changed.join('; ') || 'none'); };
const L = w => w.characters[w.countries[hub].leader];
run('AS IT STANDS', () => '');
run(`${nm(hub)} SHUTS ITS SOIL TO THE TRADE OF OTHERS`, w => applyOp(w, L(w), { op: 'set_transit', closed: true }).msg);
run(`${nm(hub)} LAYS A DUE OF 5 IN THE HUNDRED`, w => applyOp(w, L(w), { op: 'set_transit', toll: .05 }).msg);
run(`${nm(hub)} AND ${nm(foe)} AT WAR (no fighting)`, w => { w.wars.push({ id: 'S-w', a: [hub], b: [foe], civil: false, active: true, start: w.turn, name: 'measured' }); for (const u of Object.values(w.units)) if ([hub, foe].includes(u.country)) u.posture = 'defensive'; return ''; });
