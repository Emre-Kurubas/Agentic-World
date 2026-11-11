// Trade: how far each inherited state feeds and supplies itself, good by good, and what crosses its frontier.
import { pathToFileURL } from 'node:url';
const root = pathToFileURL(process.argv[2] + '/').href, seeds = (process.argv[3] || '1848,7').split(',').map(Number), Q = +process.argv[4] || 8;
const { createWorld, aliveCountries, GOODS, RAW, BASE_PRICE } = await import(root + 'engine/world.js');
const { beginTurn, stepWorld } = await import(root + 'engine/step.js');
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const cfg = { plainStates: false, countries: 5, provinces: 130, agentRoles: [], countryAgentRoles: {}, models: {}, concurrency: 2, wakeEvery: 1, wakeTension: 45, maxMessagesPerActor: 3, maxDecisionsPerActor: 5, limitRetryMinutes: 0, maxTurns: 0 };
for (const seed of seeds) { const w = createWorld({ ...cfg, seed }), acc = {};
  for (let t = 0; t < Q; t++) { beginTurn(w); stepWorld(w); for (const c of aliveCountries(w)) { const a = (acc[c.id] ||= { made: {}, need: {}, imp: {}, exp: {}, gdp: 0, cus: 0, rev: 0, gold0: c.reserves, n: 0 });
      for (const g of GOODS) { a.made[g] = (a.made[g] || 0) + (RAW.includes(g) ? c._raw?.[g] || 0 : c._made?.[g] || 0); a.need[g] = (a.need[g] || 0) + (c._need?.[g] || 0); a.imp[g] = (a.imp[g] || 0) + (c.lastBought?.[g] || 0) * w.globalPrice[g]; a.exp[g] = (a.exp[g] || 0) + (c.lastSold?.[g] || 0) * w.globalPrice[g]; }
      a.gdp += c.gdp / (c.rate || 1) / (c.priceLevel || 1) * (c.priceLevel || 1); a.gdpLocal = (a.gdpLocal || 0) + c.gdp; a.rate = c.rate || 1; a.cus += c.lastBooks?.customs ?? 0; a.rev += c.lastRevenue ?? 0; a.n++; a.gold = c.reserves; a.food = c.foodRatio; a.goodsRatio = c.goodsRatio; } }
  console.log(`\n== seed ${seed}, ${Q} quarters unmanaged; world prices now: ${GOODS.map(g => `${g} ${r1(w.globalPrice[g] / BASE_PRICE[g])}`).join(' ')}`);
  for (const c of aliveCountries(w)) { const a = acc[c.id], sum = o => Object.values(o).reduce((s, v) => s + v, 0), gdpGold = a.gdpLocal / a.rate;
    console.log(`${c.id} ${(c.archetype || '').padEnd(13)} imports ${r1(sum(a.imp) / gdpGold * 100)}% exports ${r1(sum(a.exp) / gdpGold * 100)}% of GDP; customs ${r1(a.cus / Math.max(a.rev, 1) * 100)}% of revenue (tariff ${Math.round(c.tariff * 100)}%); gold ${Math.round(a.gold0)} -> ${Math.round(a.gold)}; food ${r2(a.food ?? 1)} shops ${r2(a.goodsRatio ?? 1)}; tonnage ${r1(c.shipping ?? 0)}`);
    console.log('   makes/needs: ' + GOODS.filter(g => a.need[g] > .01 || a.made[g] > .01).map(g => `${g} ${a.need[g] > .01 ? r2(a.made[g] / a.need[g]) : 'inf'}`).join(' ') + ' | buys: ' + GOODS.filter(g => a.imp[g] / gdpGold > .0005).map(g => `${g} ${r1(a.imp[g] / gdpGold * 100)}%`).join(' ') + ' | sells: ' + GOODS.filter(g => a.exp[g] / gdpGold > .0005).map(g => `${g} ${r1(a.exp[g] / gdpGold * 100)}%`).join(' ')); }
  const need = g => aliveCountries(w).reduce((s, c) => s + (acc[c.id].need[g] || 0), 0), made = g => aliveCountries(w).reduce((s, c) => s + (acc[c.id].made[g] || 0), 0), val = g => need(g) * BASE_PRICE[g], tot = GOODS.reduce((s, g) => s + val(g), 0), gdpAll = aliveCountries(w).reduce((s, c) => s + acc[c.id].gdpLocal / acc[c.id].rate, 0);
  console.log('   world makes/needs: ' + GOODS.map(g => `${g} ${r2(made(g) / Math.max(need(g), .01))}`).join(' '));
  console.log('   what the world uses, as a share of world output at base prices: ' + GOODS.map(g => `${g} ${r1(val(g) / gdpAll * 100)}%`).join(' ') + ` (all goods ${r1(tot / gdpAll * 100)}%)`); }
