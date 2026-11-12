import { economyStep } from './economy.js';
import { militaryStep, depotStep } from './military.js';
import { satisfactionStep, plotStep, uprisingStep, electionStep, collapseStep, relationDrift, lifeStep, pruneStep, partyStep, debtStep } from './politics.js';
import { treatyStep, institutionStep, billStep } from './polity.js';
import { firmStep } from './firms.js';
import { projectStep } from './projects.js';
import { cultureStep } from './culture.js';
import { adminStep } from './admin.js';
import { contractStep } from './contracts.js';
import { applyOp, carryAwaited, carryTaken, carrySigned, carryStanding, carryStandingLate } from './ops.js';
import { watchStep } from './standing.js';
import { inquiryStep } from './inquiry.js';
import { meansStep } from './means.js';
import { courtStep } from './court.js';
import { labourStep, labourEnd } from './labour.js';
import { undergroundStep } from './underground.js';
import { frontierStep } from './frontier.js';
import { justiceStep } from './justice.js';
import { diplomacyStep } from './diplomacy.js';
import { pressStep } from './press.js';
import { fearStep } from './fear.js';
import { crisesStep } from './crises.js';
import { bondStep } from './bonds.js';
import { disputeStep } from './politics.js';
import { countryProvinces, aliveCountries, provincePop } from './world.js';
import { sum, quarterLabel } from './util.js';
import { openCredit } from './money.js';

export function beginTurn(w) { w.newsThisTurn = []; w.battles = []; w.seaFights = []; w.awaited = []; for (const c of aliveCountries(w)) openCredit(c); }

export function stepWorld(w) {
  // Signatures ordered for papers that had not yet arrived are given now that every government's orders of the quarter are in.
  carrySigned(w);
  carryStanding(w);
  projectStep(w);
  adminStep(w);
  treatyStep(w);
  diplomacyStep(w);
  labourStep(w);
  economyStep(w);
  meansStep(w);
  firmStep(w);
  contractStep(w);
  bondStep(w);
  militaryStep(w, carryAwaited, carryTaken); depotStep(w);
  frontierStep(w);
  institutionStep(w);
  cultureStep(w);
  satisfactionStep(w);
  pressStep(w);
  partyStep(w);
  plotStep(w);
  courtStep(w, applyOp);
  undergroundStep(w);
  uprisingStep(w);
  electionStep(w);
  disputeStep(w);
  billStep(w, applyOp);
  justiceStep(w);
  lifeStep(w);
  debtStep(w);
  collapseStep(w);
  relationDrift(w);
  // What stood in every province when the quarter closed. Attaches and travellers report this, a quarter late; only a service with eyes in the
  // place, a watch on the frontier or troops in contact know what stands there today (queries.js troopsIn).
  crisesStep(w);
  fearStep(w);
  w.garrisons = {}; for (const u of Object.values(w.units)) { const p = w.provinces[u.province]; if (p && u.country === p.controller) w.garrisons[p.id] = (w.garrisons[p.id] || 0) + u.men; }
  pruneStep(w);
  labourEnd(w);
  carryStandingLate(w);
  inquiryStep(w);
  watchStep(w);
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
