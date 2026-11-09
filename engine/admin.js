// Provincial government. Reach falls with distance from the capital; railways and appointed governors extend it.
import { clamp, sum } from './util.js';
import { aliveCountries, countryProvinces, provincePop } from './world.js';

function distances(w, c) {
  const dist = { [c.capital]: 0 }, q = [c.capital];
  while (q.length) { const x = q.shift(); for (const n of w.provinces[x]?.neighbors ?? []) if (w.provinces[n].controller === c.id && !(n in dist)) { dist[n] = dist[x] + 1; q.push(n); } }
  return dist;
}
const targetAdmin = (w, c, p, d) => clamp(c.bureaucracy / 100 * (1.05 - (d ?? 8) * .05 + p.rail * .08) + (w.characters[p.governor]?.alive ? .12 : 0), .08, 1);

export function initAdmin(w) { for (const c of aliveCountries(w)) { const d = distances(w, c); for (const p of countryProvinces(w, c.id)) p.admin = targetAdmin(w, c, p, d[p.id]); } adminStep(w); }

export function adminStep(w) {
  for (const c of aliveCountries(w)) {
    const provs = countryProvinces(w, c.id); if (!provs.some(p => p.admin != null)) continue;
    const d = distances(w, c);
    for (const p of provs) {
      if (p.governor && (!w.characters[p.governor]?.alive || w.characters[p.governor].country !== c.id)) p.governor = null;
      p.admin = (p.admin ?? .5) + (targetAdmin(w, c, p, d[p.id]) - (p.admin ?? .5)) * .06;
    }
    const pop = sum(provs, provincePop) || 1, reach = sum(provs, p => (p.admin ?? .5) * provincePop(p)) / pop, base = Math.max(c.bureaucracy / 100, .1);
    c._adminFactor = clamp(reach / (base * .92), .65, 1.1);
  }
}
export const adminPressure = p => p.admin == null ? 0 : Math.max(0, (.45 - p.admin) * 18);
