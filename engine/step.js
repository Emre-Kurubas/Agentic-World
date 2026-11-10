import { economyStep } from './economy.js';
import { militaryStep } from './military.js';
import { satisfactionStep, plotStep, uprisingStep, electionStep, collapseStep, relationDrift, lifeStep, pruneStep, partyStep, debtStep } from './politics.js';
import { treatyStep, institutionStep, billStep } from './polity.js';
import { firmStep } from './firms.js';
import { projectStep } from './projects.js';
import { cultureStep } from './culture.js';
import { adminStep } from './admin.js';
import { contractStep } from './contracts.js';
import { applyOp } from './ops.js';
import { courtStep } from './court.js';
import { labourStep, labourEnd } from './labour.js';
import { undergroundStep } from './underground.js';
import { countryProvinces, aliveCountries, provincePop } from './world.js';
import { sum, quarterLabel } from './util.js';
import { openCredit } from './money.js';

export function beginTurn(w) { w.newsThisTurn = []; w.battles = []; for (const c of aliveCountries(w)) openCredit(c); }

export function stepWorld(w) {
  projectStep(w);
  adminStep(w);
  treatyStep(w);
  labourStep(w);
  economyStep(w);
  firmStep(w);
  contractStep(w);
  militaryStep(w);
  institutionStep(w);
  cultureStep(w);
  satisfactionStep(w);
  partyStep(w);
  plotStep(w);
  courtStep(w, applyOp);
  undergroundStep(w);
  uprisingStep(w);
  electionStep(w);
  billStep(w, applyOp);
  lifeStep(w);
  debtStep(w);
  collapseStep(w);
  relationDrift(w);
  pruneStep(w);
  labourEnd(w);
  for (const c of aliveCountries(w)) {
    const provs = countryProvinces(w, c.id);
    c.history.push({
      fuel: +((c.fuelRatio ?? 1) * 100).toFixed(0), t: w.turn, gdp: Math.round(c.realGdp), infl: +(c.inflation * 100).toFixed(1), unemp: +(c.unemployment * 100).toFixed(1), debt: +((c.debt / Math.max(c.gdp * 4, 1)) * 100).toFixed(0),
      pop: Math.round(sum(provs, provincePop)), legit: Math.round(c.legitimacy), unrest: Math.round(c.unrest), men: Math.round(sum(Object.values(w.units).filter(u => u.country === c.id), u => u.men)), food: +(c.foodRatio * 100).toFixed(0), treasury: Math.round(c.treasury), bal: Math.round(c.lastBalance ?? 0), reserves: Math.round(c.reserves), fx: c.fx ?? 100, input: +((c.inputRatio ?? 1) * 100).toFixed(0)
    });
    if (c.history.length > 240) c.history.shift();
  }
  w.newsLog.push(...w.newsThisTurn);
  if (w.newsLog.length > 800) w.newsLog.splice(0, w.newsLog.length - 800);
  w.turn += 1;
  w.date = quarterLabel(w.turn);
}
