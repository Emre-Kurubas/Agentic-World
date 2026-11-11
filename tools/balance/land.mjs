// Balance of attack and defence, and of the means of war, measured in controlled fights: the same field, many dice.
// Run from the repository: node tools/balance/land.mjs .   (the argument is the repository's folder)
import { pathToFileURL } from 'node:url';
const root = pathToFileURL(process.argv[2] + '/').href;
const { createWorld, aliveCountries, countryProvinces, makeUnit, makeFleet } = await import(root + 'engine/world.js');
const { beginTurn, stepWorld } = await import(root + 'engine/step.js');
const { militaryStep, season, upkeepCost, shellsFor } = await import(root + 'engine/military.js');
const { applyOp } = await import(root + 'engine/ops.js');
const { SHIPS, baseMap } = await import(root + 'engine/navy.js');
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const seedOf = i => (Math.imul(i + 1, 2654435761) >>> 0) % 2147483647; // seeds a constant step apart give dice that lean
const cfg = { plainStates: true, seed: 42, countries: 5, provinces: 130, agentRoles: [], countryAgentRoles: {}, models: {}, concurrency: 2, wakeEvery: 2, wakeTension: 45, maxMessagesPerActor: 3, maxDecisionsPerActor: 5, limitRetryMinutes: 0, maxTurns: 0 };
const base0 = createWorld(cfg); for (let i = 0; i < 4; i++) { beginTurn(base0); stepWorld(base0); }
const field = () => { const w = structuredClone(base0); for (const u of Object.values(w.units)) delete w.units[u.id]; for (const f of Object.values(w.fleets)) delete w.fleets[f.id];
  const a = w.countries.U1, d = w.countries.U2, mine = p => p.neighbors.filter(n => w.provinces[n].controller === 'U1' && n !== a.capital);
  const over = countryProvinces(w, 'U2').find(p => p.id !== d.capital && mine(p).length >= 2 && p.neighbors.some(n => w.provinces[n].controller === 'U2' && n !== d.capital)), [e1, e2] = mine(over).map(n => w.provinces[n]);
  for (const p of Object.values(w.provinces)) if (['U1', 'U2'].includes(p.controller)) Object.assign(p, { rail: 1, infra: 1, fort: 0, trench: 0 });
  over.terrain = e1.terrain = e2.terrain = 'plains'; over.river = 0; w.strategic = w.strategic.filter(s => ![over.id, e1.id, e2.id].includes(s.ref)); a.budget.military = d.budget.military = .3; a.stock.arms = d.stock.arms = 5000; w.characters[a.general].skill = w.characters[d.general].skill = 1; d.intel.U1 = 90;
  while (season(w) !== 'summer') w.turn++; w.wars.push({ id: 'S', a: ['U1'], b: ['U2'], civil: false, active: true, start: w.turn, name: 'x' }); return { w, a, d, over, e1, e2, gen: w.characters[a.general] }; };
const sold = (w, c, p, men, kind = 'infantry') => { const u = makeUnit(w, c, p, men, 1, 80, kind); u.morale = 70; u.equip = 1; return u; };
// One kind of fight, N times: share of attacker wins, and what each side lost per thousand of the other's losses.
const trial = (setup, n = 40) => { let won = 0, la = 0, ld = 0, arms = 0; for (let i = 0; i < n; i++) { const f = field(); f.w.rng = seedOf(i); const s = setup(f); const a0 = f.a.stock.arms; f.w.battles = []; militaryStep(f.w); const b = f.w.battles[0]; if (!b) continue; if (b.attackerWon) won++; la += s.atk.reduce((x, u) => x + (u._m0 - (f.w.units[u.id]?.men ?? 0)), 0) - (f.a._sick || 0); ld += s.def.reduce((x, u) => x + (u._m0 - (f.w.units[u.id]?.men ?? 0)), 0); arms += a0 - f.a.stock.arms; }
  return { win: Math.round(won / n * 100), lossA: r1(la / n), lossD: r1(ld / n), arms: r1(arms / n) }; };
const std = (ratio, mods = {}) => f => { const D = 60, A = D * ratio; Object.assign(f.over, mods.ground || {}); const def = [sold(f.w, 'U2', f.over.id, D)]; def[0].dug = mods.dug ?? 0; if (mods.posture) def[0].posture = mods.posture; if (mods.tech) f.d.techs.automatic_weapons = 1;
  const atk = mods.two ? [sold(f.w, 'U1', f.e1.id, A / 2), sold(f.w, 'U1', f.e2.id, A / 2)] : [sold(f.w, 'U1', f.e1.id, A)]; if (mods.guns) atk.push(sold(f.w, 'U1', f.e1.id, mods.guns, 'artillery')); if (mods.blind) f.d.intel.U1 = 0;
  for (const u of [...atk, ...def]) u._m0 = u.men; applyOp(f.w, f.gen, { op: 'offensive', to: f.over.id, units: atk.map(u => u.id), ...(mods.order || {}) }); return { atk, def }; };
console.log('== ATTACK AND DEFENCE: 60 thousand defenders; share of fights the attacker wins, and losses (attacker / defender, thousands)');
const cases = [['open plain, defenders just arrived', {}], ['plain, dug in over months (5)', { dug: 5, posture: 'defensive' }], ['plain, prepared field works (2) and dug in', { ground: { trench: 2 }, dug: 5, posture: 'defensive' }], ['hills, dug in', { ground: { terrain: 'hills' }, dug: 3 }], ['forest, dug in', { ground: { terrain: 'forest' }, dug: 3 }], ['mountain, dug in', { ground: { terrain: 'mountain' }, dug: 3 }], ['fortress of the second order on a plain', { ground: { fort: 2 }, dug: 3 }], ['plain, dug in, with machine guns', { dug: 5, posture: 'defensive', tech: true }]];
for (const [name, m] of cases) console.log(`  ${name.padEnd(46)} ` + [1, 1.5, 2, 3, 4].map(r => { const t = trial(std(r, m), 30); return `${r}:1 ${String(t.win).padStart(3)}% (${t.lossA}/${t.lossD})`; }).join('  '));
console.log('== WHAT EACH CHOICE IS WORTH: 2 to 1 against 60 thousand dug in behind field works on a plain (win %, losses, arms burnt)');
const dugIn = { ground: { trench: 2 }, dug: 5, posture: 'defensive' };
for (const [name, m] of [['plain assault', {}], ['with a bombardment (field guns only)', { order: { shelling: true } }], ['bombardment with 15k heavy artillery', { order: { shelling: true }, guns: 15 }], ['from two sides', { two: true }], ['a quarter prepared', { order: { prepare: 1 } }], ['falling as a surprise (blind defender)', { blind: true }], ['pressed regardless of loss', { order: { manner: 'all_out' } }], ['two sides, heavy guns, bombardment', { two: true, guns: 15, order: { shelling: true } }]]) {
  const run = f => { const s = std(2, { ...dugIn, ...m })(f); if (m.order?.prepare) { f.w.battles = []; militaryStep(f.w); f.w.turn++; } return s; }; const t = trial(run, 40); console.log(`  ${name.padEnd(40)} win ${String(t.win).padStart(3)}%  losses ${t.lossA}/${t.lossD}  arms ${t.arms}`); }
// The price of an army.
{ const w = createWorld({ ...cfg, plainStates: false, seed: 1848 }); for (let i = 0; i < 4; i++) { beginTurn(w); stepWorld(w); } console.log('== THE PRICE OF AN ARMY (inherited world): ');
  for (const c of aliveCountries(w)) { const men = Object.values(w.units).filter(u => u.country === c.id).reduce((a, u) => a + u.men, 0), pop = countryProvinces(w, c.id).reduce((a, p) => a + Object.values(p.pops).reduce((x, y) => x + y.n, 0), 0), peace = upkeepCost(w, c); w.wars.push({ id: 'X' + c.id, a: [c.id], b: ['ZZ'], civil: false, active: true, start: w.turn, name: 'x' }); const o = aliveCountries(w).find(x => x.id !== c.id); w.wars.at(-1).b = [o.id]; const war = upkeepCost(w, c); w.wars.pop();
    console.log(`  ${c.id} ${c.archetype.padEnd(13)} army ${Math.round(men)}k = ${r1(men / pop * 100)}% of the people; keep ${r1(peace / c.gdp * 100)}% of GDP in peace, ${r1(war / c.gdp * 100)}% in the field; arsenal ${Math.round(c.stock.arms)} = ${r1(c.stock.arms / shellsFor(Object.values(w.units).filter(u => u.country === c.id)))} quarters of the whole army attacking; works make ${r1(c._made?.arms || 0)}/q (${r1((c._made?.arms || 0) / shellsFor(Object.values(w.units).filter(u => u.country === c.id)) * 100)}% of that need); raising 10k costs ${r1(10 * .4 * c.priceLevel)} = ${r2(10 * .4 * c.priceLevel / c.gdp * 100)}% of GDP`); } }
