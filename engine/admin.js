// Provincial government. Reach falls with distance from the capital; railways and appointed governors extend it.
import { clamp, sum } from './util.js';
import { aliveCountries, countryProvinces, provincePop } from './world.js';

function distances(w, c) {
  const dist = { [c.capital]: 0 }, q = [c.capital];
  while (q.length) { const x = q.shift(); for (const n of w.provinces[x]?.neighbors ?? []) if (w.provinces[n].controller === c.id && !(n in dist)) { dist[n] = dist[x] + 1; q.push(n); } }
  return dist;
}
// Offices, courts and the telegraph built in a province (p.seat) are the state's standing presence there, whoever the governor is.
const targetAdmin = (w, c, p, d) => clamp(c.bureaucracy / 100 * (1.05 - (d ?? 8) * .05 + p.rail * .08) + (w.characters[p.governor]?.alive ? .12 : 0) + (p.seat || 0), .08, 1);

export function initAdmin(w) { for (const c of aliveCountries(w)) { const d = distances(w, c); for (const p of countryProvinces(w, c.id)) p.admin = targetAdmin(w, c, p, d[p.id]); } adminStep(w); }

export function adminStep(w) {
  for (const c of aliveCountries(w)) {
    const provs = countryProvinces(w, c.id); if (!provs.some(p => p.admin != null)) continue;
    const d = distances(w, c);
    for (const p of provs) {
      if (p.governor && (!w.characters[p.governor]?.alive || w.characters[p.governor].country !== c.id)) p.governor = null;
      p.admin = (p.admin ?? .5) + (targetAdmin(w, c, p, d[p.id]) - (p.admin ?? .5)) * .06;
      // Bread reaches a province by road, rail or sea from the rest of the country. One that is cut off or under siege eats what it has.
      p.access = clamp((p.siege ? .45 : d[p.id] == null ? (p.port > 0 ? .85 : .55) : 1) * (1 - (p.devastation || 0) * .25), .3, 1);
    }
    // Rates that were ordered and are not yet fully collected come into force as the offices get round to it.
    const pace = clamp(.3 + c.bureaucracy / 100, .35, 1);
    for (const [k, to] of Object.entries(c.taxTarget || {})) { c.tax[k] += (to - c.tax[k]) * pace; if (Math.abs(to - c.tax[k]) < .003) { c.tax[k] = to; delete c.taxTarget[k]; } }
    if (c.tariffTarget != null) { c.tariff += (c.tariffTarget - c.tariff) * pace; if (Math.abs(c.tariffTarget - c.tariff) < .003) { c.tariff = c.tariffTarget; c.tariffTarget = null; } }
    const pop = sum(provs, provincePop) || 1, reach = sum(provs, p => (p.admin ?? .5) * provincePop(p)) / pop, base = Math.max(c.bureaucracy / 100, .1);
    c._adminFactor = clamp(reach / (base * .92), .65, 1.1);
  }
}
export const adminPressure = p => p.admin == null ? 0 : Math.max(0, (.45 - p.admin) * 18);
