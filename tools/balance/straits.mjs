// What closing a strait or laying a toll on it does to the world's trade: the same world eight quarters with and without the order.
// Run from the repository: node tools/balance/straits.mjs .
import { pathToFileURL } from 'node:url';
const root = pathToFileURL(process.argv[2] + '/').href, Q = 8;
const { createWorld } = await import(root + 'engine/world.js');
const { beginTurn, stepWorld } = await import(root + 'engine/step.js');
const { applyOp } = await import(root + 'engine/ops.js');
const cfg = { plainStates: false, seed: 2696855, countries: 8, provinces: 200, agentRoles: [], countryAgentRoles: {}, models: {}, concurrency: 2, wakeEvery: 1, wakeTension: 45, maxMessagesPerActor: 3, maxDecisionsPerActor: 5, limitRetryMinutes: 0, maxTurns: 0 };
const w0 = createWorld(cfg); for (let i = 0; i < 2; i++) { beginTurn(w0); stepWorld(w0); }
const r = v => Math.round(v);
console.log('straits:', w0.strategic.filter(s => s.type === 'strait').map(s => `${s.id} ${s.name} ${s.ref} ctrl ${s.controller}`).join('; '));
console.log('routes by mode:', Object.entries(w0.routes).map(([k, x]) => `${k}:${x.mode}${x.bulk && x.bulk.mode !== x.mode ? '/bulk-' + x.bulk.mode : ''}(${x.cost.toFixed(2)})`).join(' '));
const run = (label, ops) => { const w = structuredClone(w0); const notes = []; for (const [who, op] of ops) { const c = w.countries[who], res = applyOp(w, w.characters[c.leader], { ...op, _law: true }); notes.push((res.ok ? 'ok ' : 'REFUSED ') + String(res.msg).slice(0, 100)); }
  const acc = {}; for (let i = 0; i < Q; i++) { beginTurn(w); stepWorld(w); for (const c of Object.values(w.countries)) { const a = acc[c.id] ||= { imp: 0, exp: 0, tolls: 0, gdp: 0 }; a.exp += c.lastExportGold || 0; a.tolls += c.lastBooks?.tolls || 0; a.gdp += c.realGdp; a.imp += Object.entries(c.lastBought || {}).reduce((s, [g, q]) => s + q * w.globalPrice[g], 0); } }
  console.log('\n' + label, notes.join(' | '));
  for (const c of Object.values(w.countries)) { const a = acc[c.id]; console.log(' ', c.id, c.name.padEnd(30), 'exports/q', String(r(a.exp / Q)).padStart(5), 'imports/q', String(r(a.imp / Q)).padStart(5), 'tolls/q', String(r(a.tolls / Q)).padStart(4), 'gdp/q', r(a.gdp / Q), 'gold', r(c.reserves), 'food', r((c.foodRatio ?? 1) * 100), 'shops', r((c.goodsRatio ?? 1) * 100), 'legit', r(c.legitimacy), 'rel to U6', r(c.relations?.U6 ?? 0)); }
  console.log('  sea routes now:', Object.entries(w.routes).filter(([k]) => k.includes('U1')).map(([k, x]) => `${k}:${x.mode}${x.via ? ' via ' + x.via : ''}${x.bulk && x.bulk.mode !== x.mode ? '/bulk-' + x.bulk.mode : ''}(${x.cost.toFixed(2)})`).join(' '));
  return w; };
run('BASE', []);
const st = w0.strategic.filter(s => s.type === 'strait' && s.controller === 'U6');
run('TIRARA CLOSES ITS THREE STRAITS', st.map(s => ['U6', { op: 'set_strait', id: s.id, closed: true }]));
run('TIRARA TOLL 30% ON ITS THREE STRAITS', st.map(s => ['U6', { op: 'set_strait', id: s.id, closed: false, toll: .3 }]));
const ak = w0.strategic.filter(s => s.type === 'strait' && s.controller === 'U2');
run('AKULIA CLOSES NEVENTEN', ak.map(s => ['U2', { op: 'set_strait', id: s.id, closed: true }]));
