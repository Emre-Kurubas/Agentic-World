// Follow-up to the land measurements: columns of unequal size, bombardment where there is nothing to knock in, and spying both ways.
// Run from the repository: node tools/balance/columns.mjs .   (the argument is the repository's folder)
import { pathToFileURL } from 'node:url';
const root = pathToFileURL(process.argv[2] + '/').href;
const { createWorld, countryProvinces, makeUnit } = await import(root + 'engine/world.js');
const { beginTurn, stepWorld } = await import(root + 'engine/step.js');
const { militaryStep, season } = await import(root + 'engine/military.js');
const { applyOp } = await import(root + 'engine/ops.js');
const r1 = v => Math.round(v * 10) / 10;
const seedOf = i => (Math.imul(i + 1, 2654435761) >>> 0) % 2147483647; // seeds a constant step apart give dice that lean
const cfg = { plainStates: true, seed: 42, countries: 5, provinces: 130, agentRoles: [], countryAgentRoles: {}, models: {}, concurrency: 2, wakeEvery: 2, wakeTension: 45, maxMessagesPerActor: 3, maxDecisionsPerActor: 5, limitRetryMinutes: 0, maxTurns: 0 };
const base0 = createWorld(cfg); for (let i = 0; i < 4; i++) { beginTurn(base0); stepWorld(base0); }
const field = skill => { const w = structuredClone(base0); for (const u of Object.values(w.units)) delete w.units[u.id]; for (const f of Object.values(w.fleets)) delete w.fleets[f.id];
  const a = w.countries.U1, d = w.countries.U2, mine = p => p.neighbors.filter(n => w.provinces[n].controller === 'U1' && n !== a.capital);
  const over = countryProvinces(w, 'U2').find(p => p.id !== d.capital && mine(p).length >= 2 && p.neighbors.some(n => w.provinces[n].controller === 'U2' && n !== d.capital)), [e1, e2] = mine(over).map(n => w.provinces[n]);
  for (const p of Object.values(w.provinces)) if (['U1', 'U2'].includes(p.controller)) Object.assign(p, { rail: 1, infra: 1, fort: 0, trench: 0 });
  over.terrain = e1.terrain = e2.terrain = 'plains'; over.river = 0; w.strategic = w.strategic.filter(s => ![over.id, e1.id, e2.id].includes(s.ref)); a.budget.military = d.budget.military = .3; a.stock.arms = d.stock.arms = 5000; w.characters[a.general].skill = skill; w.characters[d.general].skill = 1; d.intel.U1 = 90;
  for (const ch of Object.values(w.characters)) if (ch.country === 'U1' && ch.id !== a.general && ch.skill != null && ch.minor) ch.skill = skill;
  while (season(w) !== 'summer') w.turn++; w.wars.push({ id: 'S', a: ['U1'], b: ['U2'], civil: false, active: true, start: w.turn, name: 'x' }); return { w, a, d, over, e1, e2, gen: w.characters[a.general] }; };
const sold = (w, c, p, men, kind = 'infantry') => { const u = makeUnit(w, c, p, men, 1, 80, kind); u.morale = 70; u.equip = 1; return u; };
const trial = (setup, n = 60, skill = 1) => { let won = 0, la = 0, ld = 0, arms = 0, late = 0; for (let i = 0; i < n; i++) { const f = field(skill); f.w.rng = seedOf(i); const s = setup(f); const a0 = f.a.stock.arms; f.w.battles = []; militaryStep(f.w); const b = f.w.battles[0]; if (s.atk.some(u => f.w.units[u.id]?.attack?.late != null)) late++; if (!b) continue; if (b.attackerWon) won++; la += s.atk.reduce((x, u) => x + (u._m0 - (f.w.units[u.id]?.men ?? 0)), 0); ld += s.def.reduce((x, u) => x + (u._m0 - (f.w.units[u.id]?.men ?? 0)), 0); arms += a0 - f.a.stock.arms; }
  return `win ${String(Math.round(won / n * 100)).padStart(3)}%  losses ${r1(la / n)}/${r1(ld / n)}  arms ${r1(arms / n)}  a column late in ${Math.round(late / n * 100)}%`; };
const std = (ratio, mods = {}) => f => { const D = 60, A = D * ratio; Object.assign(f.over, mods.ground || {}); const def = [sold(f.w, 'U2', f.over.id, D)]; def[0].dug = mods.dug ?? 0; if (mods.posture) def[0].posture = mods.posture;
  const share = mods.share ?? .5, atk = mods.two ? [sold(f.w, 'U1', f.e1.id, A * share), sold(f.w, 'U1', f.e2.id, A * (1 - share))] : [sold(f.w, 'U1', f.e1.id, A)];
  for (const u of [...atk, ...def]) u._m0 = u.men; applyOp(f.w, f.gen, { op: 'offensive', to: f.over.id, units: atk.map(u => u.id), ...(mods.order || {}) }); return { atk, def }; };
const dugIn = { ground: { trench: 2 }, dug: 5, posture: 'defensive' };
console.log('== 2 to 1 against 60 thousand dug in behind field works on a plain');
for (const [name, m, skill] of [['one column, a competent general', {}, 1], ['two equal columns, competent', { two: true }, 1], ['three quarters and a quarter, competent', { two: true, share: .75 }, 1], ['three quarters and a quarter, an able general (1.3)', { two: true, share: .75 }, 1.3], ['two equal columns, an able general (1.3)', { two: true }, 1.3], ['one column, an able general (1.3)', {}, 1.3], ['three quarters and a quarter, a poor hand (0.8)', { two: true, share: .75 }, .8]])
  console.log(`  ${name.padEnd(52)} ${trial(std(2, { ...dugIn, ...m }), 60, skill)}`);
console.log('== bombardment where there is little to knock in: 1.5 to 1 against 60 thousand');
for (const [name, m] of [['just arrived, no bombardment', {}], ['just arrived, bombardment', { order: { shelling: true } }], ['dug in (5), no bombardment', { dug: 5, posture: 'defensive' }], ['dug in (5), bombardment', { dug: 5, posture: 'defensive', order: { shelling: true } }]])
  console.log(`  ${name.padEnd(52)} ${trial(std(1.5, m), 60, 1)}`);
// Spying both ways between the same two services.
{ const w = createWorld({ ...cfg, plainStates: false, seed: 1848 }); for (let i = 0; i < 2; i++) { beginTurn(w); stepWorld(w); }
  for (const [me, them] of [['U3', 'U1'], ['U1', 'U3'], ['U2', 'U5'], ['U5', 'U2']]) { const x = structuredClone(w), c = x.countries[me], boss = x.characters[c.leader]; let ok = 0, caught = 0; for (let i = 0; i < 200; i++) { x.turn++; x.newsThisTurn = []; const r = applyOp(x, boss, { op: 'spy', target: them, kind: 'intel' }); if (r.ok) ok++; if (x.newsThisTurn.some(n => /caught spies/.test(n.text))) caught++; }
    console.log(`  spying: ${c.name} (service ${Math.round(w.countries[me].intelligence)}) on ${x.countries[them].name} (service ${Math.round(w.countries[them].intelligence)}): ${ok / 2}% succeed, ${caught / 2}% end with spies caught`); } }
