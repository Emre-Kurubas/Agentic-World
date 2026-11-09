import { economyStep } from './economy.js';
import { militaryStep } from './military.js';
import { satisfactionStep, plotStep, uprisingStep, electionStep, collapseStep, relationDrift, lifeStep, pruneStep, partyStep } from './politics.js';
import { countryProvinces, aliveCountries, provincePop } from './world.js';
import { sum, quarterLabel } from './util.js';

export function beginTurn(w) { w.newsThisTurn = []; w.battles = []; }

export function stepWorld(w) {
  economyStep(w);
  militaryStep(w);
  satisfactionStep(w);
  partyStep(w);
  plotStep(w);
  uprisingStep(w);
  electionStep(w);
  lifeStep(w);
  collapseStep(w);
  relationDrift(w);
  pruneStep(w);
  for (const c of aliveCountries(w)) {
    const provs = countryProvinces(w, c.id);
    c.history.push({
      fuel: +((c.fuelRatio ?? 1) * 100).toFixed(0), t: w.turn, gdp: Math.round(c.realGdp), infl: +(c.inflation * 100).toFixed(1), unemp: +(c.unemployment * 100).toFixed(1), debt: +((c.debt / Math.max(c.gdp * 4, 1)) * 100).toFixed(0),
      pop: Math.round(sum(provs, provincePop)), legit: Math.round(c.legitimacy), unrest: Math.round(c.unrest), men: Math.round(sum(Object.values(w.units).filter(u => u.country === c.id), u => u.men)), food: +(c.foodRatio * 100).toFixed(0)
    });
    if (c.history.length > 240) c.history.shift();
  }
  w.newsLog.push(...w.newsThisTurn);
  if (w.newsLog.length > 800) w.newsLog.splice(0, w.newsLog.length - 800);
  w.turn += 1;
  w.date = quarterLabel(w.turn);
}
