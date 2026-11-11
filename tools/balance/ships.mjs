// Ships again, with the two navies made equal in everything but their ships, and each match fought both ways round.
// Run from the repository: node tools/balance/ships.mjs .   (the argument is the repository's folder)
import { pathToFileURL } from 'node:url';
const root = pathToFileURL(process.argv[2] + '/').href;
const { createWorld, countryProvinces, makeFleet } = await import(root + 'engine/world.js');
const { beginTurn, stepWorld } = await import(root + 'engine/step.js');
const { militaryStep } = await import(root + 'engine/military.js');
const { SHIPS, baseMap, strength } = await import(root + 'engine/navy.js');
const r2 = v => Math.round(v * 100) / 100;
const seedOf = i => (Math.imul(i + 1, 2654435761) >>> 0) % 2147483647; // seeds a constant step apart give dice that lean
const cfg = { plainStates: true, seed: 42, countries: 5, provinces: 130, agentRoles: [], countryAgentRoles: {}, models: {}, concurrency: 2, wakeEvery: 2, wakeTension: 45, maxMessagesPerActor: 3, maxDecisionsPerActor: 5, limitRetryMinutes: 0, maxTurns: 0 };
const base0 = createWorld(cfg); for (let i = 0; i < 4; i++) { beginTurn(base0); stepWorld(base0); }
for (const f of Object.values(base0.fleets)) delete base0.fleets[f.id]; for (const u of Object.values(base0.units)) delete base0.units[u.id];
const ours = baseMap(base0, 'U1'), port = id => countryProvinces(base0, id).filter(p => p.port > 0 && p.seas.length).sort((x, y) => y.port - x.port)[0];
const rival = Object.values(base0.countries).filter(c => c.alive && c.id !== 'U1' && port(c.id)).map(c => ({ c, hb: port(c.id) })).map(x => ({ ...x, sea: [...x.hb.seas].sort((p, q) => (ours[p]?.d ?? 99) - (ours[q]?.d ?? 99))[0] })).sort((x, y) => (ours[x.sea]?.d ?? 99) - (ours[y.sea]?.d ?? 99))[0], E = rival.c.id;
base0.wars.push({ id: 'S', a: ['U1'], b: [E], civil: false, active: true, start: base0.turn, name: 'x' });
for (const c of [base0.countries.U1, rival.c]) { c.stock.coal = 9000; c.techs.dreadnought = 1; c.budget.military = .3; c.tech.mil = 1; c.militaryFunding = 1; base0.characters[c.general].skill = c.id === 'U1' ? +(process.argv[3] ?? 1) : 1; }
const theirs = baseMap(base0, E), seas = Object.keys(ours).filter(s => theirs[s]);
// Water where neither side's torpedo craft are at home and both are in full reach; water off the rival's coast; water off ours.
const open = seas.filter(s => ours[s].d > 2 && ours[s].d <= 4 && theirs[s].d > 2 && theirs[s].d <= 4)[0] ?? seas.filter(s => ours[s].d <= 4 && theirs[s].d <= 4).sort((a, b) => Math.abs(ours[a].d - theirs[a].d) - Math.abs(ours[b].d - theirs[b].d))[0];
const theirCoast = seas.filter(s => theirs[s].d <= 1 && ours[s].d <= 4).sort((a, b) => ours[a].d - ours[b].d)[0], farFromThem = seas.filter(s => theirs[s].d >= 3 && theirs[s].d < 90 && ours[s].d <= 4)[0];
console.log(`open water ${open} (${ours[open]?.d}/${theirs[open]?.d} seas from each base), their coast ${theirCoast} (${ours[theirCoast]?.d}/${theirs[theirCoast]?.d}), far from them ${farFromThem} (${ours[farFromThem]?.d}/${theirs[farFromThem]?.d})`);
const put = (w, id, where, xs) => xs.map(([kind, k]) => { const f = makeFleet(w, id, where, k, kind); f.quality = 1; f.morale = 70; f.coaled = 1; delete f.commander; return f; });
const sea = (a, b, where, n = 200) => { let won = 0, fights = 0, sA = 0, sB = 0; for (let i = 0; i < n; i++) { const w = structuredClone(base0); w.rng = seedOf(i); const fa = put(w, 'U1', where, a), fb = put(w, E, where, b); if (!i) { sA = fa.reduce((s, f) => s + strength(w, f), 0); sB = fb.reduce((s, f) => s + strength(w, f), 0); } w.seaFights = []; militaryStep(w); if (w.seaFights.length) fights++; if (w.seaFights[0]?.winner === 'U1') won++; } return { pct: Math.round(won / Math.max(fights, 1) * 100), sA: r2(sA), sB: r2(sB), fights }; };
const cost = xs => xs.reduce((s, [k, n]) => s + SHIPS[k].price * n, 0), keep = xs => r2(xs.reduce((s, [k, n]) => s + SHIPS[k].coal * n, 0));
const show = (name, a, b, where) => { const x = sea(a, b, where), y = sea(b, a, where); console.log(`  ${name.padEnd(58)} money ${cost(a)}/${cost(b)} coal ${keep(a)}/${keep(b)} strength ${x.sA}/${x.sB}: first wins ${x.pct}% as U1, ${100 - y.pct}% as the other (${x.fights}/${y.fights} fights)`); };
console.log('== equal fleets (should be 50%)'); show('8 cruisers against 8 cruisers', [['cruiser', 8]], [['cruiser', 8]], open);
console.log('== equal money, open water');
show('2 battleships against 8 cruisers', [['battleship', 2]], [['cruiser', 8]], open);
show('2 battleships + 4 cruisers against 12 cruisers', [['battleship', 2], ['cruiser', 4]], [['cruiser', 12]], open);
show('1 dreadnought against 2 battleships', [['dreadnought', 1]], [['battleship', 2]], open);
show('2 dreadnoughts against 15 cruisers', [['dreadnought', 2]], [['cruiser', 15]], open);
show('2 battleships against 30 torpedo boats', [['battleship', 2]], [['torpedo', 30]], open);
console.log('== torpedo craft: the first side comes to the coast of the second (only as U1 against the other)');
for (const [name, a, b] of [['2 battleships against 30 boats (equal money)', [['battleship', 2]], [['torpedo', 30]]], ['2 battleships against 15 boats (half the money)', [['battleship', 2]], [['torpedo', 15]]], ['2 battleships against 8 boats (a quarter)', [['battleship', 2]], [['torpedo', 8]]], ['8 cruisers against 30 boats (equal money)', [['cruiser', 8]], [['torpedo', 30]]], ['8 cruisers against 12 boats', [['cruiser', 8]], [['torpedo', 12]]], ['2 battleships + 4 cruisers against 4 cruisers + 20 boats', [['battleship', 2], ['cruiser', 4]], [['cruiser', 4], ['torpedo', 20]]]]) { const x = sea(a, b, theirCoast); console.log(`  ${name.padEnd(58)} money ${cost(a)}/${cost(b)} strength ${x.sA}/${x.sB}: the visitors win ${x.pct}% (${x.fights} fights)`); }
{ const x = sea([['battleship', 2]], [['torpedo', 30]], farFromThem); console.log(`  the same 30 boats three seas or more from home            strength ${x.sA}/${x.sB}: the battleships win ${x.pct}% (${x.fights} fights)`); }
