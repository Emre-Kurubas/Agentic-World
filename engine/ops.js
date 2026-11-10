import { clamp, news, rand, nextId, pick, sum } from './util.js';
import { CLASSES, GOODS, countryProvinces, atWar, hasTreaty, makeUnit, aliveCountries, clampRel, provincePop } from './world.js';
import { executePlot, neutralize, die, SUCCESSION, distance } from './politics.js';
import { capture, pathStep, upkeepCost, settleOccupations } from './military.js';
import { makeFleet, TECHS, PLANTS, DEPOSITS, GOOD_LABEL, ROLES, spawnCharacter, bfsSea } from './world.js';
import { hasTech } from './economy.js';
import { FX_REGIMES, foreignRate, externalDebt, creditLeft, declareDefault, treasuryPays } from './money.js';
import { firmOp, seizeFirm, STATE } from './firms.js';
import { queueProject, durationOf, DEFENSES, MAX_DEFENSE } from './projects.js';
import { LANGUAGE_POLICY, FAITH_POLICY, groupsOf, removePeople, settlePeople } from './culture.js';
import { incapacitated } from './health.js';
import { isMinor, recruitInformant, takeOffer, refuseOffer } from './court.js';
import { labourOp } from './labour.js';
import { fundUnderground } from './underground.js';
import { mobilize, demobilize } from './frontier.js';
import { prosecute, forge, forgeryFound } from './justice.js';
import { shame, honourOf } from './diplomacy.js';
import { proposeContract, acceptContract, cancelContract, toStateAccount } from './contracts.js';
import { governmentSeats, institutionRoom, delegated, vetoedBy, makeInstitution, mustPassParliament, createBill, parliamentOpen, makeParliament, leadsParties, enactLaw, normalizeClauses, activateClauses, allocateSeats, clauseText, MAX_AGENCY_BUDGET, governs } from './polity.js';

const FIRM_OPS = new Set(['found_company', 'invest_company', 'draw_company', 'sell_company', 'buy_company', 'nationalize_company', 'privatize_company']);
const PERMISSIONS = {
  leader: null,
  general: new Set(['propose_contract', 'accept_contract', 'cancel_contract', 'found_company', 'invest_company', 'sell_company', 'buy_company', 'propose_law', 'vote_bill', 'lobby_bill', 'appoint_institution', 'publish_dossier', 'lend_private', 'repay_debt', 'forgive_debt', 'gather_dossier', 'blackmail', 'found_party', 'embezzle', 'create_institution', 'start_plot', 'invite_plot', 'join_plot', 'betray_plot', 'execute_plot', 'bribe', 'custom', 'propaganda']),
  opposition: new Set(['propose_contract', 'accept_contract', 'cancel_contract', 'found_company', 'invest_company', 'sell_company', 'buy_company', 'propose_law', 'vote_bill', 'lobby_bill', 'appoint_institution', 'publish_dossier', 'lend_private', 'repay_debt', 'forgive_debt', 'gather_dossier', 'blackmail', 'found_party', 'create_institution', 'start_plot', 'invite_plot', 'join_plot', 'betray_plot', 'execute_plot', 'bribe', 'custom', 'propaganda']),
  oligarch: new Set(['propose_contract', 'accept_contract', 'cancel_contract', 'found_company', 'invest_company', 'sell_company', 'buy_company', 'propose_law', 'vote_bill', 'lobby_bill', 'appoint_institution', 'publish_dossier', 'repay_debt', 'forgive_debt', 'gather_dossier', 'blackmail', 'found_party', 'lend_private', 'embezzle', 'create_institution', 'start_plot', 'invite_plot', 'join_plot', 'betray_plot', 'execute_plot', 'bribe', 'custom', 'propaganda', 'capital_flight', 'invest', 'fund_plot'])
};
// What anyone may do whatever their office: deal, lend, scheme, speak.
const LABOUR_OPS = new Set(['set_wages', 'set_safety', 'lockout', 'agitate', 'arbitrate_strike', 'break_strike']);
const PRIVATE = ['forge_dossier', 'no_confidence', 'coalition', 'fund_underground', 'set_wages', 'set_safety', 'lockout', 'agitate', 'recruit_informant', 'accept_offer', 'decline_offer', 'pay_state', 'give', 'draw_company', 'fund_institution', 'dissolve_institution', 'propose_contract', 'accept_contract', 'cancel_contract', 'found_company', 'invest_company', 'sell_company', 'buy_company', 'publish_dossier', 'lend_private', 'repay_debt', 'forgive_debt', 'gather_dossier', 'blackmail', 'found_party', 'start_plot', 'invite_plot', 'join_plot', 'betray_plot', 'execute_plot', 'fund_plot', 'bribe', 'custom', 'propaganda', 'noop'];
PERMISSIONS.private = new Set(PRIVATE);
// The chief of staff directs where the army's units and squadrons stand and who commands them. Raising and disbanding troops, war and peace stay with the ruler.
for (const op of ['move', 'move_army', 'move_fleet', 'merge_units', 'merge_fleets', 'appoint_commander', 'spy']) PERMISSIONS.general.add(op);
for (const seat of ['general', 'opposition', 'oligarch']) for (const op of ['forge_dossier', 'no_confidence', 'coalition', 'fund_underground', 'set_wages', 'set_safety', 'lockout', 'agitate', 'recruit_informant', 'accept_offer', 'decline_offer', 'noop', 'pay_state', 'give', 'draw_company', 'fund_institution', 'dissolve_institution']) PERMISSIONS[seat].add(op);
PERMISSIONS.exiled = new Set(PRIVATE.filter(x => !['found_party', 'execute_plot', 'gather_dossier'].includes(x)));
PERMISSIONS.imprisoned = new Set(['accept_contract', 'cancel_contract', 'repay_debt', 'forgive_debt', 'join_plot', 'betray_plot', 'bribe', 'custom', 'noop']);
// The office is the seat, not the title: a deposed or jailed leader keeps only what any private person has.
export function permissionsOf(c, actor, w) {
  if (actor.status === 'imprisoned' || actor.status === 'exiled') return PERMISSIONS[actor.status];
  // While the ruler lies too ill to govern, the named successor governs in their name.
  if (w && governs(w, c, actor)) return null;
  if (c[actor.role] !== actor.id) return PERMISSIONS.private;
  return actor.role in PERMISSIONS ? PERMISSIONS[actor.role] : PERMISSIONS.private;
}
const MOODS = new Set(['sat.peasants', 'sat.workers', 'sat.middle', 'sat.elite', 'sat.all', 'sat.army', 'sat.capital', 'sat.clergy', 'sat.bureaucracy', 'unrest', 'legitimacy']);
// Courts and the press can be broken in a day and take years to grow.
function eased(now, want, what, notes) {
  if (want <= now + 15) return want;
  notes.push(`${what} cannot be raised that far at once; it stands at ${Math.round(now + 15)} for now`);
  return now + 15;
}
const BUDGET = ['military', 'welfare', 'infrastructure', 'education', 'police', 'administration'];
const TREATY = ['alliance', 'nonaggression', 'trade', 'military_access', 'peace'];
const LAW_TITLE = { nationalize_company: 'Company nationalization', set_tax: 'Tax regulation', set_budget: 'Budget amendment', set_tariff: 'Customs tariff', borrow: 'Borrowing authority', declare_war: 'Declaration of war', ban_party: 'Party ban', land_reform: 'Land reform', nationalize: 'Nationalization', privatize: 'Privatization' };

const num = (v, a, b, d = a) => clamp(Number.isFinite(Number(v)) ? Number(v) : d, a, b);
// How much of an order the state's offices carry out at once. A bare test world has none of this friction.
const reach = (w, c) => w.friction ? clamp(.3 + c.bureaucracy / 100, .35, 1) : 1;
const pc = v => `${Math.round(v * 1000) / 10}%`;
const menText = men => men < 1 ? `${Math.round(men * 1000)} men` : `${Math.round(men * 10) / 10} thousand men`;
const alive = (w, id) => { const c = w.countries[id]; return c?.alive ? c : null; };
// A character's real traces that can be found: dossiers are made of these.
const leaveTrace = (w, ch, text) => { (ch.secrets ||= []).push({ turn: w.turn, text }); ch.secrets = ch.secrets.slice(-12); };
const tell = (w, ch, from, text) => { if (ch?.alive) ch.inbox.push({ turn: w.turn, from, text }); };
const openDebt = (w, id) => (w.debts || []).find(d => d.id === id && ['open', 'overdue'].includes(d.status));
const NO_FUNDS = 'The treasury is empty and lenders will not cover it.';
// Names that arrive from outside are looked up as names, never as whatever an object happens to inherit.
const has = (o, k) => typeof k === 'string' && !!o && Object.hasOwn(o, k);
// An allowance holds for one quarter: asking again the same quarter draws on what is left of it, not on a fresh one.
const quarterBook = (w, holder) => holder._quarter?.turn === w.turn ? holder._quarter : (holder._quarter = { turn: w.turn, used: {} });
const used = (w, holder, key) => quarterBook(w, holder).used[key] || 0;
function allowance(w, holder, key, limit, want) {
  const book = quarterBook(w, holder), take = Math.max(0, Math.min(Number.isFinite(want) ? want : 0, limit - (book.used[key] || 0)));
  book.used[key] = (book.used[key] || 0) + take;
  return take;
}
// A mood put about by someone, under the same ceiling as any other talk.
function sway(c, actor, stat, delta, turns, label) {
  const room = moodRoom(c, actor, stat), active = sum(c.mods.filter(m => m.src === 'custom' && m.key === stat), m => m.delta), moved = clamp(active + delta, -room, room) - active;
  if (Math.abs(moved) < .05) return 0;
  c.mods.push({ key: stat, delta: moved, turns, label, src: 'custom' });
  return moved;
}
// Rulers appoint people who were no one until then: an officer, an official, a child of the house. Such a person enters the world when they are named to something.
// A country's public life holds so many named figures at a time. When it is full, one who holds no post any more steps back into private life and makes room.
const MINOR_LIMIT = 24, CROWDED = 'Every named figure in the country holds a post already and there is no room for another: appoint someone who is already known (see people), or free a post first.';
let crowded = false;
const noPerson = text => crowded ? CROWDED : text;
function posted(w, c) {
  const ids = new Set([c.heir, c.regent]);
  for (const i of c.institutions || []) { ids.add(i.head); for (const m of i.members || []) ids.add(m); }
  for (const u of Object.values(w.units)) ids.add(u.commander); for (const p of Object.values(w.provinces)) ids.add(p.governor);
  for (const pl of w.plots || []) if (pl.active) { ids.add(pl.leader); for (const m of pl.members || []) ids.add(m); }
  return ids;
}
function personFor(w, c, op, kind, patch = {}) {
  crowded = false;
  if (op.character) return w.characters[op.character]?.alive ? w.characters[op.character] : null;
  const name = String(op.name ?? '').trim().slice(0, 60), same = name && Object.values(w.characters).find(x => x.alive && x.country === c.id && x.name.toLowerCase() === name.toLowerCase());
  if (same) return same;
  const minor = Object.values(w.characters).filter(x => x.alive && x.country === c.id && !ROLES.includes(x.role) && x.role !== 'former_leader');
  if (minor.length >= MINOR_LIMIT) {
    const busy = posted(w, c), idle = minor.filter(x => !busy.has(x.id) && !x.aiControlled && !x.everAI && x.status === 'free').sort((a, b) => (a.power ?? 0) - (b.power ?? 0))[0];
    if (!idle) { crowded = true; return null; }
    delete w.characters[idle.id];
  }
  return spawnCharacter(w, c.id, kind, c.axes, { power: 25, ...patch, ...(name ? { name } : {}) });
}
// The state pays from the treasury and, once that is empty, on credit for as long as lenders agree. Returns a note for the record, or null when it cannot pay.
function pay(c, cost) {
  if (!(cost > 0)) return '';
  const cash = Math.min(Math.max(c.treasury, 0), cost), loan = cost - cash;
  if (loan > creditLeft(c) + 1e-9) return null;
  c.treasury -= cash; c.debt += loan; c._loans = (c._loans || 0) + loan; c._taken = (c._taken || 0) + loan;
  return loan > cost * .01 ? ` ${Math.round(loan)} of the ${Math.round(cost)} cost was borrowed.` : '';
}

// A peace is made between two countries. In a war of several, whoever signs with allies still fighting leaves the war and the rest go on;
// the war itself ends only when one side has no one left in it.
function endWar(w, a, b, annex) {
  for (const war of w.wars) {
    if (!war.active) continue;
    const side = x => war.a.includes(x) ? 'a' : war.b.includes(x) ? 'b' : null, sa = side(a), sb = side(b);
    if (!sa || !sb || sa === sb) continue;
    const leaving = [war[sa].length > 1 ? a : null, war[sb].length > 1 ? b : null].filter(Boolean);
    if (!leaving.length) war.active = false;
    else { war.a = war.a.filter(x => !leaving.includes(x)); war.b = war.b.filter(x => !leaving.includes(x)); if (!war.a.length || !war.b.length) war.active = false; }
  }
  for (const p of Object.values(w.provinces)) {
    if (![a, b].includes(p.owner) || ![a, b].includes(p.controller) || p.owner === p.controller) continue;
    if (annex) { p.owner = p.controller; p.admin = Math.min(p.admin ?? .5, .3); } else p.controller = p.owner;
    delete p.siege;
  }
  settleOccupations(w);
}

export function applyOp(w, actor, op) {
  if (!actor?.alive) return { ok: false, msg: 'The dead give no orders.' };
  const c = alive(w, actor.country);
  if (!c || !op?.op) return { ok: false, msg: 'Invalid operation.' };
  const perm = permissionsOf(c, actor, w), held = actor.status === 'imprisoned' || actor.status === 'exiled';
  if (perm && !perm.has(op.op) && (held || !delegated(c, actor, op.op))) return { ok: false, msg: held ? `Someone who is ${actor.status} cannot do this: ${op.op}` : `${c[actor.role] === actor.id ? actor.role : 'A private person'} is not authorized for this operation: ${op.op}` };
  // A law passed by a legislature is above a veto; a decree is not.
  if (!op._law || op._decree) {
    const blocker = vetoedBy(w, c, actor, op.op);
    if (blocker) { news(w, `${c.name}: ${blocker.name} blocked the decision taken by ${actor.name}.`, { kind: 'politics', countries: [c.id] }); return fail(`${blocker.name} blocked it.`); }
    if (!op._law && mustPassParliament(w, c, op)) {
      const bill = createBill(w, c, actor, { title: LAW_TITLE[op.op] ?? op.op, text: JSON.stringify({ ...op, op: undefined }).slice(0, 300), ops: [op] });
      return bill ? { ok: true, msg: `Referred to parliament: ${bill.id}`, bill: bill.id } : fail('The parliamentary agenda is full.');
    }
  }
  const target = op.target ? alive(w, op.target) : null;
  if (target && target.id === c.id) return fail('That needs another country, not your own.');
  const gdp = Math.max(c.gdp, 1);
  if (FIRM_OPS.has(op.op)) return firmOp(w, actor, c, op, fail, ok, tell, leaveTrace, num);
  if (LABOUR_OPS.has(op.op)) return labourOp(w, actor, c, op, { fail, num, governs: governs(w, c, actor), tell, allowance });
  switch (op.op) {
    // A rate is ordered in a day and collected by offices: a capable state has the new rate in force at once, a thin one takes several quarters to get there.
    case 'set_tax': { if (!has(c.tax, op.kind)) return fail('No such tax type.'); const to = num(op.rate, 0, .7), was = c.tax[op.kind], r = reach(w, c); c.tax[op.kind] = was + (to - was) * r; if (r < 1 && Math.abs(to - c.tax[op.kind]) > .003) (c.taxTarget ||= {})[op.kind] = to; else if (c.taxTarget) delete c.taxTarget[op.kind];
      return r < 1 && Math.abs(to - was) > .003 ? { ok: true, msg: `The ${op.kind} tax is ordered to ${pc(to)}. With the offices the state has, it stands at ${pc(c.tax[op.kind])} this quarter and reaches the new rate over the next few.` } : ok(); }
    case 'set_budget': if (!BUDGET.includes(op.category)) return fail('No such budget category.'); c.budget[op.category] = num(op.share, 0, .45); return ok();
    case 'set_tariff': { const to = num(op.rate, 0, 1), was = c.tariff, r = reach(w, c); c.tariff = was + (to - was) * r; c.tariffTarget = r < 1 && Math.abs(to - c.tariff) > .003 ? to : null; return r < 1 && Math.abs(to - was) > .003 ? { ok: true, msg: `The tariff is ordered to ${pc(to)}; the customs houses apply ${pc(c.tariff)} this quarter and the rest follows.` } : ok(); }
    case 'set_arms_share': c.armShare = num(op.share, 0, .75); return ok();
    case 'print_money': { const pct = allowance(w, c, 'print', .5, num(op.pct_gdp, 0, .8)); if (pct <= 0) return fail('The presses have already run as hard as they can this quarter.'); const x = gdp * pct; c.money += x; c.treasury += x; news(w, `${c.name} central bank put a large amount of money into circulation.`, { kind: 'economy', countries: [c.id] }); return { ok: true, msg: `${Math.round(x)} in new money entered the treasury.` }; }
    case 'borrow': { const x = gdp * num(op.pct_gdp, 0, .6), room = creditLeft(c); if (x > room) return fail(`Lenders would put up at most ${Math.round(room)} more this quarter.`); c.debt += x; c.treasury += x; c._loans = (c._loans || 0) + x; c._taken = (c._taken || 0) + x; return { ok: true, msg: `Borrowed ${Math.round(x)}.` }; }
    case 'repay_state_debt': { const x = Math.min(Math.max(c.treasury, 0), c.debt, gdp * num(op.pct_gdp, 0, 40, 40)); if (x <= 0) return fail('There is nothing in the treasury to repay with.'); c.treasury -= x; c.debt -= x; return { ok: true, msg: `${Math.round(x)} of the debt was repaid; ${Math.round(c.debt)} remains.` }; }
    case 'sell_gold': { const x = Math.min(Math.max(c.reserves, 0), num(op.amount, 0, 1e12, 0)); if (x <= 0) return fail('There is no gold in the reserve to sell.'); c.reserves -= x; c.treasury += x * (c.rate || 1); return { ok: true, msg: `${Math.round(x)} gold left the reserve and ${Math.round(x * (c.rate || 1))} entered the treasury. ${Math.round(c.reserves)} gold remains to back the currency, pay for imports and serve foreign debts.` }; }
    case 'default_debt': return declareDefault(w, c, 'repudiated its debts') ? (shame(w, c, -12, 'it repudiated its debts'), { ok: true, msg: `The debt was written down to ${Math.round(c.debt)}. Lenders will keep away for years.` }) : fail('The state is already in default.');
    case 'embargo': if (!target) return fail('No such target.'); if (op.on === false) c.embargo = c.embargo.filter(x => x !== target.id); else if (!c.embargo.includes(target.id)) { c.embargo.push(target.id); target.relations[c.id] = clampRel((target.relations[c.id] ?? 0) - 15); news(w, `${c.name} cut off trade with ${target.name}.`, { kind: 'diplomacy', countries: [c.id, target.id] }); } return ok();
    case 'build': return build(w, c, op);
    case 'survey': { const p = w.provinces[op.province]; if (!p || p.controller !== c.id) return fail('That province is not under your control.'); if (pay(c, gdp * .01) === null) return fail(NO_FUNDS); const found = Object.entries(p.deposits).filter(([k, d]) => !d.known && (k !== 'oil' || hasTech(c, 'oil_prospecting')) && (k !== 'rare' || hasTech(c, 'electricity')) && rand(w) < .65); found.forEach(([, d]) => d.known = true); if (found.length) news(w, `${c.name}: ${found.map(([k]) => GOOD_LABEL[k]).join(', ')} found in ${p.name}.`, { kind: 'economy', countries: [c.id] }); return { ok: true, msg: found.length ? `Found: ${found.map(([k]) => GOOD_LABEL[k]).join(', ')}` : 'No new deposit was found in this survey.' }; }
    case 'set_research': if (!has(TECHS, op.tech) || c.techs[op.tech] || !TECHS[op.tech].req.every(r => c.techs[r])) return fail('This technology cannot be researched.'); c.research = { target: op.tech, progress: c.research.target === op.tech ? c.research.progress : 0 }; return ok();
    case 'steal_tech': { if (!target) return fail('No such target.'); const cand = Object.keys(target.techs).filter(t => !c.techs[t]); if (!cand.length) return fail('No technology to steal.'); if (rand(w) > clamp(.2 + (c.intelligence - target.intelligence) / 150, .05, .75)) { target.relations[c.id] = clampRel((target.relations[c.id] ?? 0) - 15); return fail('The spy network was exposed.'); } const t = pick(w, cand); c.techs[t] = Math.max(1, w.turn); news(w, `${target.name} technology secretly passed to ${c.name}.`, { kind: 'plot', countries: [c.id, target.id], secret: true }); return ok(); }
    case 'grant_concession': { if (!target) return fail('No such target.'); const p = w.provinces[op.province]; if (!p || p.controller !== c.id || !has(p.deposits, op.resource)) return fail('No such deposit.'); (p.concessions ||= {})[op.resource] = { holder: target.id, share: num(op.share, .05, .9) }; tell(w, w.characters[target.leader], c.name, `You have been granted ${Math.round(num(op.share, .05, .9) * 100)}% of the ${GOOD_LABEL[op.resource]} raised at ${p.name}.`); news(w, `${c.name} granted the ${p.name} ${GOOD_LABEL[op.resource]} concession to ${target.name}.`, { kind: 'economy', countries: [c.id, target.id] }); return { ok: true, msg: 'The concession is theirs. Whatever they pay for it is for them to send.' }; }
    case 'revoke_concession': { const p = w.provinces[op.province]; const con = p?.concessions?.[op.resource]; if (!con || p.controller !== c.id) return fail('No such concession.'); const o = w.countries[con.holder]; if (o) o.relations[c.id] = clampRel((o.relations[c.id] ?? 0) - 35); delete p.concessions[op.resource]; news(w, `${c.name} seized the ${p.name} concession.`, { kind: 'diplomacy', countries: [c.id, con.holder] }); return ok(); }
    case 'lend': { if (!target) return fail('No such target.'); const amt = Math.min(Math.max(c.reserves, 0), Math.max(c.realGdp, 1) * num(op.pct_gdp, 0, .4)); if (amt <= 0) return fail('There is no gold to lend.'); c.reserves -= amt; target.reserves += amt; target.creditors[c.id] = (target.creditors[c.id] || 0) + amt; tell(w, w.characters[target.leader], c.name, `${Math.round(amt)} in gold has been lent to your state. It is owed back with interest; if you do not want the debt, return it with repay_foreign.`); news(w, `${c.name} lent money to the government of ${target.name}.`, { kind: 'economy', countries: [c.id, target.id] }); return { ok: true, msg: `${Math.round(amt)} gold lent.` }; }
    case 'set_fx_regime': { if (!FX_REGIMES.includes(op.regime)) return fail('No such exchange-rate regime.'); if (op.regime === 'pegged') { if (!target || target.id === c.id) return fail('No currency to peg to.'); c.pegTo = target.id; c.pegRate = (c.rate || 1) / (target.rate || 1); } else c.pegTo = null; c.fxRegime = op.regime; news(w, `${c.name}: ${c.currency.name} ${op.regime === 'floating' ? 'was floated' : op.regime === 'gold' ? 'was pegged to gold' : `was pegged to ${target.currency.name}`}.`, { kind: 'economy', countries: [c.id] }); return ok(); }
    case 'devalue': { if (c.fxRegime === 'floating') return fail('A floating rate cannot be devalued; it sets itself.'); const pct = allowance(w, c, 'devalue', .3, num(op.pct, .01, 1, .1)), prev = c.rate; if (pct <= 0) return fail('The currency has already been cut as far as it can be in one quarter.'); c.rate *= 1 + pct; if (c.pegTo) c.pegRate *= 1 + pct; c._fxPass = (c._fxPass || 0) + Math.log(c.rate / prev) * .2; c.fx = +(100 / c.rate).toFixed(2); c.legitimacy = clamp(c.legitimacy - pct * 8, 0, 100); news(w, `${c.name}: ${c.currency.name} was devalued by ${Math.round(pct * 100)}%.`, { kind: 'economy', countries: [c.id] }); return ok(); }
    case 'set_capital_controls': c.capitalClosed = op.closed !== false; news(w, `${c.name} ${c.capitalClosed ? 'restricted' : 'freed'} capital movements.`, { kind: 'economy', countries: [c.id] }); return ok();
    case 'rename_currency': if (!op.name) return fail('No name given.'); c.currency.name = String(op.name).slice(0, 40); return ok();
    case 'borrow_foreign': {
      if (c.defaulted) return fail('After a default no one will lend abroad.');
      const floor = o => Math.max(o.realGdp, 1) * .3, lenders = (target ? [target] : aliveCountries(w).filter(o => o.id !== c.id)).filter(o => !o.capitalClosed && !atWar(w, c.id, o.id) && !o.embargo.includes(c.id) && o.reserves > floor(o)).sort((a, b) => b.reserves - a.reserves);
      if (!lenders.length) return fail('No bank could be found to lend.');
      // Foreign banks lend so much to one borrower in a quarter, and let only so much of their country's gold go.
      const l = lenders[0], real = Math.max(c.realGdp, 1), room = Math.max(0, real * (.6 + c.legitimacy / 100) - externalDebt(c)), out = used(w, l, 'lentOut'), spare = Math.max(0, (l.reserves + out - floor(l)) * .25 - out);
      const amt = Math.min(room, spare, real * (.2 - used(w, c, 'foreignLoan')), real * num(op.pct_gdp, 0, .4));
      if (!(amt > 0)) return fail('The banks abroad will lend no more this quarter.');
      allowance(w, c, 'foreignLoan', .2, amt / real); allowance(w, l, 'lentOut', Infinity, amt);
      l.reserves -= amt; c.reserves += amt; c.creditors[l.id] = (c.creditors[l.id] || 0) + amt; news(w, `${c.name} borrowed gold from the banks of ${l.name}.`, { kind: 'economy', countries: [c.id, l.id] });
      return { ok: true, msg: `${Math.round(amt)} gold borrowed, interest ${Math.round(foreignRate(c, externalDebt(c)) * 1000) / 10}%.` };
    }
    case 'repay_foreign': { const l = target; if (!l || !c.creditors[l.id]) return fail('You owe this country nothing.'); const m = Math.min(Math.max(c.reserves, 0), c.creditors[l.id], num(op.amount, 0, 1e12, c.creditors[l.id])); if (m <= 0) return fail('No reserves.'); c.reserves -= m; l.reserves += m; c.creditors[l.id] -= m; return ok(); }
    case 'set_culture_policy': { if (op.language) { if (!LANGUAGE_POLICY.includes(op.language)) return fail('Unknown language policy.'); c.languagePolicy = op.language; } if (op.faith) { if (!FAITH_POLICY.includes(op.faith)) return fail('Unknown faith policy.'); c.faithPolicy = op.faith; } news(w, `${c.name} changed its policy toward peoples and faiths.`, { kind: 'politics', countries: [c.id] }); return ok(); }
    case 'appoint_governor': { const p = w.provinces[op.province]; if (!p || p.controller !== c.id) return fail('Province not yours.'); if (op.remove) { tell(w, w.characters[p.governor], c.name, `You are removed as governor of ${p.name}.`); p.governor = null; return ok(); } const ch = personFor(w, c, op, 'governor'); if (!ch || ch.country !== c.id || ch.status !== 'free') return fail(noPerson('No such person.')); p.governor = ch.id; tell(w, ch, c.name, `You are appointed governor of ${p.name}.`); return { ok: true, msg: `${ch.name} (${ch.id}) governs ${p.name}.` }; }
    case 'appoint_commander': { const u = w.units[op.unit]; if (!u || u.country !== c.id) return fail('No such unit.'); const ch = personFor(w, c, op, 'officer'); if (!ch || ch.country !== c.id || ch.status !== 'free') return fail(noPerson('No such person.')); u.commander = ch.id; tell(w, ch, c.name, `You now command unit ${u.id}.`); return { ok: true, msg: `${ch.name} (${ch.id}) commands ${u.id}.` }; }
    case 'propose_contract': { const k = proposeContract(w, actor, op, num); return k ? { ok: true, msg: `Contract offered: ${k.id}`, contract: k.id } : fail('No such counterparty.'); }
    case 'accept_contract': { const k = acceptContract(w, actor, op.id, op.from, op.state) ?? (op.state === true ? toStateAccount(w, actor, op.id) : null); return k ? { ok: true, msg: `Contract ${k.id} is in force${k.purse?.[actor.id] ? ", on the treasury's account" : ''}.` } : fail('No such offer is waiting for you.'); }
    // The state pays a person: a salary, a grant, a reward, a reimbursement, compensation. It is done in the open, and the money really leaves the treasury.
    case 'pay_person': {
      const ch = has(w.characters, op.character) ? w.characters[op.character] : Object.values(w.characters).find(x => x.alive && x.name.toLowerCase() === String(op.character ?? '').toLowerCase()); if (!ch?.alive) return fail('No such person.');
      const want = num(op.amount, 0, 1e9, 0), m = treasuryPays(c, allowance(w, c, 'grants', gdp * .005, want)); if (!(m > .01)) return fail(want > 0 ? 'The treasury has paid out all it can to persons this quarter, or lenders will not cover it.' : 'No amount was named.');
      ch.wealth += m; const self = ch.id === actor.id, why = String(op.reason || '').slice(0, 120);
      // People who watch their ruler draw on the treasury for himself think the less of him, the more he takes.
      if (self) c.legitimacy = clamp(c.legitimacy - Math.min(5, m / Math.max(gdp * .002, .01)), 0, 100); else tell(w, ch, 'Treasury', `The treasury of ${c.name} paid you ${Math.round(m * 10) / 10}${why ? `: ${why}` : ''}.`);
      if (m >= gdp * .001 || self) news(w, `${c.name}: the treasury paid ${Math.round(m)} to ${self ? `${ch.name}, who governs` : ch.name}${why ? ` (${why})` : ''}.`, { kind: 'economy', countries: [c.id] });
      return { ok: true, msg: `The treasury paid ${Math.round(m * 10) / 10} to ${ch.name}${m < want - .01 ? `, not the ${Math.round(want * 10) / 10} ordered: that is all it can pay out to persons this quarter` : ''}.` };
    }
    // Buying a minor person, at home or abroad, to report what passes through his post. Whoever governs pays from the treasury, anyone else from their own purse.
    case 'recruit_informant': {
      const ch = has(w.characters, op.character) ? w.characters[op.character] : Object.values(w.characters).find(x => x.alive && x.name.toLowerCase() === String(op.character ?? '').toLowerCase());
      if (!ch?.alive || ch.status !== 'free' || ch.id === actor.id) return fail('No such person.');
      if (!isMinor(ch)) return fail(`${ch.name} is no one's clerk: what passes between you and such a person is for the two of you to settle by letter.`);
      if (ch.handler) return fail(ch.handler === actor.id ? `${ch.name} already reports to you.` : `${ch.name} would not be bought.`);
      const state = governs(w, c, actor), want = num(op.amount, 0, 1e6, 0), m = state ? treasuryPays(c, allowance(w, c, 'secret_funds', gdp * .002, want)) : Math.min(Math.max(actor.wealth, 0), want);
      if (!(m >= 1)) return fail('No money was put behind the approach.');
      const r = recruitInformant(w, actor, ch, m); if (r.ok && !state) actor.wealth -= m; if (!r.ok && state) c.treasury += m;
      return r.ok ? r : fail(r.msg);
    }
    // Money for the armed underground, at home or (with target) in another country. From the actor's own purse.
    case 'fund_underground': { const where = target ?? c, m = Math.min(Math.max(actor.wealth, 0), num(op.amount, 0, 1e6, 0)); if (!(m >= 1)) return fail('No money to give them.'); actor.wealth -= m; return fundUnderground(w, actor, where, m, leaveTrace); }
    // The lawful road against a person: a charge, a court, a verdict next quarter. Brought by whoever governs, on what is in their file.
    case 'prosecute': {
      const ch = has(w.characters, op.character) ? w.characters[op.character] : null; if (!ch?.alive || ch.country !== c.id || ch.id === actor.id) return fail('No such person here to charge.');
      if (!op._law && !governs(w, c, actor)) return fail('Only the government brings a prosecution.');
      if (ch.id === c.leader) return fail('The head of the government is not charged by their own prosecutors.'); if (ch.status !== 'free') return fail(`${ch.name} is ${ch.status}.`);
      const r = prosecute(w, c, actor, ch, op); return r.ok ? r : fail(r.msg);
    }
    case 'forge_dossier': {
      const ch = has(w.characters, op.character) ? w.characters[op.character] : null, claim = String(op.claim ?? '').trim(); if (!ch?.alive || ch.id === actor.id) return fail('No such person.'); if (!claim) return fail('A forged paper has to say something.');
      const state = governs(w, c, actor) && c.intelligence >= 30; if (!state) { if (actor.wealth < 4) return fail('A forger has to be paid.'); actor.wealth -= 4; }
      return forge(w, actor, ch, claim);
    }
    // A floor under pay and safety at every works in the country.
    case 'set_labour_law': {
      const safety = num(op.min_safety, 0, 1, c.labourLaw?.safety ?? 0), wage = num(op.min_wage, 0, 1, c.labourLaw?.wage ?? 0), was = c.labourLaw ?? { safety: 0, wage: 0 };
      c.labourLaw = safety > 0 || wage > 0 ? { safety, wage } : null;
      const harder = (safety - was.safety) * 5 + (wage - was.wage) * 6; if (Math.abs(harder) > .05) { c.mods.push({ key: 'sat.capital', delta: -harder, turns: 6, label: 'The factory law' }); c.mods.push({ key: 'sat.workers', delta: harder * .8, turns: 6, label: 'The factory law' }); }
      news(w, `${c.name}: ${c.labourLaw ? `a factory law sets a floor under ${[safety > 0 ? 'safety' : '', wage > 0 ? 'wages' : ''].filter(Boolean).join(' and ')} at every works` : 'the factory law was repealed'}.`, { kind: 'economy', countries: [c.id] });
      return { ok: true, msg: c.labourLaw ? `Every works must now spend at least ${safety} of 1 on safety and pay at least ${wage} of the going wage. Owners keep to it as far as officials and inspectors make them.` : 'There is no longer a floor under pay or safety.' };
    }
    case 'no_confidence': {
      if (!(parliamentOpen(w, c) && c.parliament.legislative)) return fail('There is no legislature in session to put the motion to.');
      if (governs(w, c, actor)) return fail('A government does not move no confidence in itself.');
      const led = leadsParties(w, c, actor)[0], ruler = w.characters[c.leader]; if (!led || !(c.parliament.seats[led.id] > 0)) return fail('Only the leader of a party with seats in the house can move it.');
      if ((c.bills || []).some(b => b.confidence && b.status === 'pending')) return fail('A motion of no confidence is already before the house.');
      if (w.turn - (c.lastMotion ?? -99) < 4) return fail('The house voted on the government within the year and will not be asked again so soon.');
      const bill = createBill(w, c, actor, { title: `Motion of no confidence in ${ruler?.name ?? 'the government'}`, text: String(op.text || `That this house has no confidence in the government of ${ruler?.name}.`), ops: [], axes: actor.axes }); if (!bill) return fail('The parliamentary agenda is full.');
      bill.confidence = true; news(w, `${c.name}: ${actor.name} has moved a vote of no confidence in the government of ${ruler?.name}.`, { kind: 'politics', countries: [c.id] });
      return { ok: true, msg: `The motion (${bill.id}) is voted next quarter. The government counts on ${governmentSeats(c)} of ${Object.values(c.parliament.seats).reduce((a, n) => a + n, 0)} seats; parties vote as their leaders direct (vote_bill) or as they judge, and deputies can be lobbied (lobby_bill). If it carries, you form the government.` };
    }
    // Joining or leaving the government's benches, or inviting a party onto them.
    case 'coalition': {
      if (!c.parliament) return fail('There is no parliament to sit in.');
      const mine = leadsParties(w, c, actor), ruling = governs(w, c, actor), party = c.parties.find(p => p.id === op.party && !p.banned) ?? (!ruling ? mine[0] : null), list = c.coalition ||= [];
      if (!party || party.id === c.rulingParty) return fail('No such party to bring in.');
      if (op.join === false) { if (!list.includes(party.id)) return fail(`${party.name} is not on the government's benches.`); if (!ruling && !mine.includes(party)) return fail('That party is not yours to take out.'); c.coalition = list.filter(x => x !== party.id); news(w, `${c.name}: ${party.name} has left the government's benches.`, { kind: 'politics', countries: [c.id] }); return { ok: true, msg: `${party.name} no longer supports the government. It counts on ${governmentSeats(c)} seats.` }; }
      if (list.includes(party.id)) return fail(`${party.name} already sits with the government.`);
      if (!ruling) { if (!mine.includes(party)) return fail('That party is not yours to lead in.'); list.push(party.id); }
      else {
        // A party with a leader of its own answers through that leader; one without is won if it stands near enough to the government's course.
        const head = [w.characters[party.founder], w.characters[c.opposition]].find(x => x?.alive && x.aiControlled && x.id !== actor.id && leadsParties(w, c, x).includes(party));
        if (head) { tell(w, head, actor.name, `${actor.name} invites ${party.name} onto the government's benches. Joining is yours to decide (coalition with join true).`); return { ok: true, msg: `The invitation has gone to ${head.name}, who leads ${party.name}.` }; }
        if (distance(party.axes, c.axes) > 55) return fail(`${party.name} stands too far from the government's course to join it.`);
        list.push(party.id);
      }
      news(w, `${c.name}: ${party.name} has joined the government's benches.`, { kind: 'politics', countries: [c.id] });
      return { ok: true, msg: `${party.name} now supports the government, which counts on ${governmentSeats(c)} of ${Object.values(c.parliament.seats).reduce((a, n) => a + n, 0)} seats.` };
    }
    case 'accept_offer': { const r = takeOffer(w, actor, op.id); return r ?? fail('No such offer is waiting for you.'); }
    case 'decline_offer': { const r = refuseOffer(w, actor, op.id, governs(w, c, actor)); return r ?? fail('No such offer.'); }
    // A gift of one's own money to a person or to an institution, at home or abroad. Nothing is owed for it and it leaves no mark of a bribe.
    case 'give': {
      const m = Math.min(Math.max(actor.wealth, 0), num(op.amount, 0, 1e9, 0)); if (!(m > .01)) return fail('No money to give.');
      const to = String(op.to ?? op.character ?? op.institution ?? '').trim(), low = to.toLowerCase(), why = op.reason ? `: ${String(op.reason).slice(0, 160)}` : '', amt = Math.round(m * 10) / 10;
      const ch = has(w.characters, to) ? w.characters[to] : Object.values(w.characters).find(x => x.alive && x.name.toLowerCase() === low);
      if (ch?.alive && ch.id !== actor.id) { actor.wealth -= m; ch.wealth += m; tell(w, ch, actor.name, `${actor.name} gave you ${amt}${why}.`); return { ok: true, msg: `${amt} was given to ${ch.name}.` }; }
      for (const o of aliveCountries(w)) { const inst = (o.institutions || []).find(i => i.id && (i.id === to || i.name.toLowerCase() === low)); if (!inst) continue;
        actor.wealth -= m; inst.endowment = (inst.endowment || 0) + m; const keeper = w.characters[inst.head] ?? w.characters[inst.sponsor]; if (keeper && keeper.id !== actor.id) tell(w, keeper, actor.name, `${actor.name} gave ${amt} to ${inst.name}${why}.`);
        return { ok: true, msg: `${amt} was given to ${inst.name}; it will spend the gift over the coming quarters.` }; }
      return fail('No such person or institution to give to.');
    }
    // A person pays money into the treasury of their own country: a tax settled, a levy, a gift.
    case 'pay_state': { const m = Math.min(Math.max(actor.wealth, 0), num(op.amount, 0, 1e9, 0)); if (!(m > .01)) return fail('No money to pay with.'); actor.wealth -= m; c.treasury += m; tell(w, w.characters[c.leader], 'Treasury', `${actor.name} paid ${Math.round(m * 10) / 10} into the treasury${op.reason ? `: ${String(op.reason).slice(0, 120)}` : ''}.`); return { ok: true, msg: `${Math.round(m * 10) / 10} was paid into the treasury of ${c.name}.` }; }
    case 'cancel_contract': { const msg = cancelContract(w, actor, op.id, op.from ?? op.to), old = !msg && (w.contracts || []).find(x => x.id === op.id && [x.a, x.b].includes(actor.id)); return msg ? { ok: true, msg } : fail(old ? `${old.id} is closed already (${old.status}).` : 'No such contract or offer of yours.'); }
    case 'ship_goods': { if (!target || target.id === c.id) return fail('No such target.'); if (!GOODS.includes(op.good)) return fail('No such good.'); const route = w.routes[c.id < target.id ? `${c.id}|${target.id}` : `${target.id}|${c.id}`]; if (!route) return fail('No open route to this country.'); const q = Math.min(c.stock[op.good] || 0, num(op.amount, 0, 1e6)); if (q <= 0) return fail('Not in stock.'); c.stock[op.good] -= q; const arrived = q / route.cost; target.stock[op.good] = (target.stock[op.good] || 0) + arrived; tell(w, w.characters[target.leader], c.name, `Shipment of ${Math.round(arrived)} units of ${GOOD_LABEL[op.good]} has arrived.`); return { ok: true, msg: `${Math.round(arrived)} units arrived.` }; }
    case 'set_strait': { const s = w.strategic.find(x => x.id === op.id && x.type === 'strait'); if (!s || s.controller !== c.id) return fail('You do not control this strait.'); (c.straitPolicy ||= {})[s.id] = { closed: !!op.closed, toll: num(op.toll, 0, .6) }; if (op.closed) { news(w, `${c.name} closed the ${s.name} passage.`, { kind: 'war', countries: [c.id] }); for (const a of aliveCountries(w)) if (a.id !== c.id) a.relations[c.id] = clampRel((a.relations[c.id] ?? 0) - 8); } return ok(); }
    case 'build_canal': { const s = w.strategic.find(x => x.id === op.id && x.type === 'canal_site'); if (!s) return fail('No such route.'); const p = w.provinces[s.ref]; if (p.controller !== c.id) return fail('The land is not yours.'); if (w.canals.some(k => k.province === p.id)) return fail('The canal already exists.'); if (c.stock.machines < 8 || c.stock.steel < 20) return fail('Not enough machinery or steel.'); if ((w.projects || []).some(x => x.kind === 'canal' && x.province === p.id && !x.status)) return fail('Canal already under construction.'); const note = pay(c, gdp * .8); if (note === null) return fail(NO_FUNDS); c.stock.machines -= 8; c.stock.steel -= 20; queueProject(w, c, { kind: 'canal', province: p.id, strategic: s.id, label: `${p.name} canal` }); return { ok: true, msg: `Digging, ready in ${durationOf('canal')} quarters.${note}` }; }
    case 'build_ship': { const p = w.provinces[op.province]; if (!p || p.controller !== c.id || !p.port) return fail('There is no port here.'); const ships = Math.round(num(op.ships, 1, 30)), shipKind = ['battleship', 'submarine'].includes(op.kind) ? op.kind : 'cruiser', factor = { cruiser: 1, battleship: 4, submarine: 1.5 }[shipKind]; if (shipKind === 'submarine' && !hasTech(c, 'combustion_engine')) return fail('Submarines need the internal combustion engine.'); if (c.stock.steel < ships * 2 * factor) return fail('Not enough steel.'); const note = pay(c, ships * 1.5 * factor * c.priceLevel); if (note === null) return fail(NO_FUNDS); c.stock.steel -= ships * 2 * factor; queueProject(w, c, { kind: 'ship', province: p.id, ships, shipKind, label: `${ships} ${shipKind}` }); return { ok: true, msg: `Laid down, ready in ${durationOf('ship', shipKind)} quarters.${note}` }; }
    case 'move_fleet': {
      const f = w.fleets[op.fleet]; if (!f || f.country !== c.id || !w.seas[op.to]) return fail('Invalid fleet order.');
      // A number of ships sends a squadron and leaves the rest on station.
      const asked = Math.floor(Number(op.ships)); if (!(asked >= 1 && asked < f.ships)) { f.target = op.to; return ok(); }
      const d = makeFleet(w, c.id, f.sea, asked); d.kind = f.kind; d.quality = f.quality; d.morale = f.morale; d.target = op.to; f.ships -= asked;
      return { ok: true, msg: `${d.id}, ${asked} ships, was detached from ${f.id} and ordered to sea. ${f.id} keeps ${Math.round(f.ships)}.` };
    }
    case 'merge_fleets': {
      const a = w.fleets[op.fleet], b = w.fleets[op.into]; if (!a || !b || a === b || a.country !== c.id || b.country !== c.id) return fail('No such fleets.');
      if (a.sea !== b.sea) return fail(`${a.id} and ${b.id} must lie in the same waters to be joined.`);
      if ((a.kind ?? 'cruiser') !== (b.kind ?? 'cruiser')) return fail('Ships of different kinds stay separate squadrons.');
      const n = a.ships + b.ships; for (const k of ['quality', 'morale']) b[k] = ((a[k] ?? b[k]) * a.ships + (b[k] ?? a[k]) * b.ships) / n;
      b.ships = n; delete w.fleets[a.id];
      return { ok: true, msg: `${a.id} was joined to ${b.id}, now ${Math.round(n)} ships.` };
    }
    case 'amphibious': {
      // A landing needs a coast to embark from, water that can be crossed, a surface fleet holding the far shore and ships enough to carry the men.
      const u = w.units[op.unit], p = w.provinces[op.to]; if (!u || u.country !== c.id || !p?.coast) return fail('Invalid landing order.');
      const from = w.provinces[u.province], enemyHolds = s => { const h = w.seaControl?.[s]; return !!h && atWar(w, h, c.id); };
      if (u.province === p.id) return fail('The unit is already there.');
      if (!from.coast) return fail('The unit must first march to the coast to embark.');
      if (u.shipped === w.turn) return fail('This unit has already been at sea this quarter.');
      if (!atWar(w, c.id, p.controller) && p.controller !== c.id) return fail('You are not at war with whoever holds that coast.');
      const escort = Object.values(w.fleets).filter(f => f.country === c.id && f.kind !== 'submarine' && p.seas.includes(f.sea) && !enemyHolds(f.sea));
      if (!escort.length) return fail('You need a surface fleet holding the water off the target coast.');
      if (!from.seas.some(s => p.seas.some(t => s === t || bfsSea(w, s, t)))) return fail('No sea route joins the two coasts.');
      const lift = sum(escort, f => f.ships) * 3; if (u.men > lift) return fail(`The fleet there can carry about ${Math.round(lift)} thousand men; this unit has ${Math.round(u.men)} thousand.`);
      u.province = p.id; u.men *= Math.max(.3, .9 - (p.battery || 0) * .15); u.morale = clamp(u.morale - 10, 0, 100); u.target = null; u.dug = 0; u.shipped = w.turn;
      return { ok: true, msg: `${Math.round(u.men)} thousand men were put ashore at ${p.name}.` };
    }
    case 'found_party': { if (c.parties.length >= 8) return fail('There is no room for another party; the country has eight.'); const name = String(op.name || 'New Party').slice(0, 60); const axes = { econ: num(op.axes?.econ, -100, 100, 0), auth: num(op.axes?.auth, -100, 100, 0), nation: num(op.axes?.nation, -100, 100, 0), faith: num(op.axes?.faith, -100, 100, 0) }; c.parties.push({ id: nextId(w, 'F'), name, axes, base: CLASSES.includes(op.base) ? op.base : 'middle', support: 3, founder: actor.id, banned: false, organization: 10 }); news(w, `${c.name}: ${name} was founded.`, { kind: 'politics', countries: [c.id] }); return ok(); }
    case 'ban_party': { const p = c.parties.find(x => x.id === op.party); if (!p) return fail('No such party.'); if (rand(w) < c.courts / 160) { news(w, `${c.name} court overturned the ban on ${p.name}.`, { kind: 'politics', countries: [c.id] }); return fail('The court blocked it.'); } p.banned = true; if (c.parliament) c.parliament.seats = allocateSeats(c); c.pressFreedom = clamp(c.pressFreedom - 6, 0, 100); c.legitimacy = clamp(c.legitimacy - 4, 0, 100); news(w, `${c.name}: ${p.name} was banned.`, { kind: 'politics', countries: [c.id] }); return ok(); }
    case 'set_institutions': { const notes = []; if (op.courts !== undefined) c.courts = eased(c.courts, num(op.courts, 0, 100), 'Court independence', notes); if (op.press_freedom !== undefined) { const was = c.pressFreedom; c.pressFreedom = eased(was, num(op.press_freedom, 0, 100), 'Press freedom', notes); if (Math.abs(c.pressFreedom - was) >= 5) news(w, `${c.name} ${c.pressFreedom > was ? 'loosened' : 'tightened'} its hold on the press.`, { kind: 'politics', countries: [c.id] }); } if (typeof op.unions === 'boolean') c.unions = op.unions; if (typeof op.postal_secrecy === 'boolean' && op.postal_secrecy !== !!c.postalSecrecy) { c.postalSecrecy = op.postal_secrecy; notes.push(op.postal_secrecy ? 'The post office no longer opens letters for the government.' : 'The post office opens letters for the government again.'); news(w, `${c.name}: ${op.postal_secrecy ? 'the secrecy of the mails was made law; the black cabinet is closed' : 'the secrecy of the mails was lifted'}.`, { kind: 'politics', countries: [c.id] }); } if (op.ruling_party && c.parties.some(p => p.id === op.ruling_party)) c.rulingParty = op.ruling_party; return { ok: true, msg: notes.length ? `Applied. ${notes.join('; ')}.` : 'Applied.' }; }
    case 'gather_dossier': { const ch = w.characters[op.character]; if (!ch?.alive) return fail('No such target.'); if (rand(w) > clamp(.25 + c.intelligence / 200, .1, .8)) return fail('No evidence could be found for a dossier.'); const facts = (ch.secrets || []).filter(s => !s.published).slice(-5).map(s => s.text); actor.dossiers[ch.id] = { turn: w.turn, about: ch.name, facts }; return { ok: true, msg: facts.length ? `Dossier opened, ${facts.length} facts found.` : 'Dossier opened, but nothing that is not already known came up.' }; }
    case 'blackmail': { const ch = w.characters[op.character], file = actor.dossiers[ch?.id]; if (!ch?.alive || !file) return fail('You hold no dossier.'); if (!file.facts?.length) return fail('There is nothing usable in the dossier.'); tell(w, ch, actor.name, `I have a dossier on you: ${file.facts.join(' ')} I expect you to do this: ${String(op.demand || 'Support me.').slice(0, 300)}`); leaveTrace(w, actor, `Blackmailed ${ch.name}.`); if (!ch.aiControlled) ch.loyalty = clamp(ch.loyalty - 5, 0, 100); return ok(); }
    case 'publish_dossier': { const ch = w.characters[op.character], file = actor.dossiers[ch?.id]; if (!ch?.alive || !file?.facts?.length) return fail('No dossier to publish.'); const home = w.countries[ch.country], n = file.facts.length;
      // Forged pages in the file may be recognised once they are in print, and then it is the publisher who pays.
      if (home && forgeryFound(w, home, file)) { news(w, `${home.name}: papers published against ${ch.name} were shown to be forgeries. They came from ${actor.name}.`, { kind: 'plot', countries: [...new Set([ch.country, actor.country])] }); ch.power = clamp(ch.power + 8, 0, 100); if (c.leader === actor.id) c.legitimacy = clamp(c.legitimacy - 5 * (.4 + c.pressFreedom / 100), 0, 100); else actor.power = clamp(actor.power - 10, 0, 100); leaveTrace(w, actor, `Published forged papers against ${ch.name}.`); delete actor.dossiers[ch.id]; return { ok: true, msg: `The papers were printed, and within weeks shown to be forgeries. It is you the country talks about now, not ${ch.name}.` }; } news(w, `Leaked documents: about ${ch.name}: ${file.facts.join(' ')}`, { kind: 'plot', countries: [ch.country] }); if (home?.leader === ch.id) home.legitimacy = clamp(home.legitimacy - (2 + n * 1.5) * (.4 + home.pressFreedom / 100), 0, 100); else ch.power = clamp(ch.power - (6 + n * 2), 0, 100); for (const s of ch.secrets || []) if (file.facts.includes(s.text)) s.published = true; delete actor.dossiers[ch.id]; return ok(); }
    case 'lend_private': { const ch = w.characters[op.character]; if (!ch?.alive || ch.id === actor.id) return fail('No such target.'); const m = num(op.amount, 0, actor.wealth); if (m <= 0) return fail('No money to give.'); const d = { id: nextId(w, 'B-'), creditor: actor.id, debtor: ch.id, amount: m, owed: m * (1 + num(op.interest, 0, 1, 0)), due: w.turn + Math.round(num(op.due_turns, 1, 80, 8)), terms: String(op.terms || '').slice(0, 240), status: 'open', turn: w.turn }; actor.wealth -= m; ch.wealth += m; (w.debts ||= []).push(d); tell(w, ch, actor.name, `Debt ${d.id}: lent you ${Math.round(m)}, expects ${Math.round(d.owed)} back, due turn ${d.due}. ${d.terms}`); return { ok: true, msg: `Debt recorded: ${d.id}`, debt: d.id }; }
    case 'repay_debt': { const d = openDebt(w, op.debt); if (!d || d.debtor !== actor.id) return fail('You have no such debt.'); const m = Math.min(actor.wealth, d.owed, num(op.amount, 0, 1e12, d.owed)); if (m <= 0) return fail('No money to pay with.'); actor.wealth -= m; d.owed -= m; const cr = w.characters[d.creditor]; if (cr) cr.wealth += m; if (d.owed < .01) { d.status = 'paid'; d.closedAt = w.turn; } tell(w, cr, actor.name, `Debt ${d.id}: paid ${Math.round(m)}${d.status === 'paid' ? ', the debt is closed.' : `, ${Math.round(d.owed)} remaining.`}`); return ok(); }
    case 'forgive_debt': { const d = openDebt(w, op.debt); if (!d || d.creditor !== actor.id) return fail('You have no such claim.'); d.status = 'forgiven'; d.closedAt = w.turn; tell(w, w.characters[d.debtor], actor.name, `Debt ${d.id} was forgiven.`); return ok(); }
    case 'set_tie': return ok();
    case 'nationalize': {
      // Taking over industry brings the state property, not cash, and only so much can be taken over in a quarter. The same share of the country's private companies goes with it.
      const before = c.ownership, moved = clamp(before + allowance(w, c, 'nationalize', .25, num(op.amount, 0, 1)), 0, 1) - before; if (moved <= 0) return fail('No more can be taken over this quarter.');
      c.ownership = before + moved; c.blocs.capital.sat = clamp(c.blocs.capital.sat - moved * 60, 0, 100);
      const firms = Object.values(w.firms || {}).filter(f => f.status === 'open' && f.country === c.id && f.owner !== STATE), take = firms.slice(0, Math.round(firms.length * moved / Math.max(1 - before, .01)));
      for (const f of take) seizeFirm(w, c, f, tell);
      news(w, `${c.name} moved to nationalize industry.`, { kind: 'economy', countries: [c.id] });
      return { ok: true, msg: `The state now holds about ${Math.round(c.ownership * 100)}% of industry${take.length ? `, ${take.map(f => f.name).join(', ')} among it` : ''}. What it earns comes in as the profits of those companies.` };
    }
    case 'privatize': {
      // Buyers pay for state property according to how far they trust the state not to take it back.
      const before = c.ownership, moved = before - clamp(before - allowance(w, c, 'privatize', .25, num(op.amount, 0, 1)), 0, 1); if (moved <= 0) return fail('There is nothing more to sell this quarter.');
      const price = gdp * moved * .2 * clamp(c.blocs.capital.sat / 60, .1, 1), firms = Object.values(w.firms || {}).filter(f => f.status === 'open' && f.country === c.id && f.owner === STATE);
      c.ownership = before - moved; c.treasury += price;
      for (const f of firms.slice(0, Math.round(firms.length * moved / Math.max(before, .01)))) { f.owner = null; f.offer = null; }
      return { ok: true, msg: `State property was sold for ${Math.round(price)}.` };
    }
    case 'land_reform': {
      if (w.turn - (c.landReformAt ?? -99) < 8) return fail('The last land reform is still being carried out.');
      if ((c.landShare ?? 0) >= 1) return fail('There are no great estates left to divide.');
      c.landReformAt = w.turn; c.landShare = clamp((c.landShare ?? 0) + .5, 0, 1);
      for (const p of countryProvinces(w, c.id)) { p.pops.peasants.sat = clamp(p.pops.peasants.sat + 16, 0, 100); p.pops.elite.sat = clamp(p.pops.elite.sat - 24, 0, 100); }
      c.blocs.capital.sat = clamp(c.blocs.capital.sat - 12, 0, 100); news(w, `${c.name} proclaimed land reform.`, { kind: 'politics', countries: [c.id] });
      return { ok: true, msg: 'The estates are being divided. Peasants on their own land stay better disposed for good, and those who lost it do not forget.' };
    }
    case 'recruit': {
      const p = w.provinces[op.province]; if (!p || p.controller !== c.id) return fail('No such province.');
      if (p.owner !== c.id) return fail('Troops cannot be raised from an occupied people.');
      const kind = ['artillery', 'armor', 'air'].includes(op.unit_kind) ? op.unit_kind : 'infantry', hands = p.pops.peasants.n + p.pops.workers.n;
      // A province gives so many men in a quarter, however many orders are written.
      const men = Math.round(Math.min(num(op.men, .1, 1e6), Math.max(0, Math.min(provincePop(p) * .08, hands - 2) - used(w, p, 'levy'))) * 10) / 10;
      if (men < .1) return fail(`${p.name} has given all the men it can this quarter.`);
      if (kind === 'armor' && !hasTech(c, 'armor')) return fail('You lack armor technology.'); if (kind === 'air' && !hasTech(c, 'aviation')) return fail('You lack aviation technology.');
      if (['armor', 'air'].includes(kind) && (c.stock.steel < men * .2 || c.stock.fuel < men * .05)) return fail('Not enough steel or fuel.');
      const arms = men * (kind === 'artillery' ? .12 : .05); if (c.stock.arms < arms) return fail('Not enough arms in stock.');
      const note = pay(c, men * .4 * c.priceLevel); if (note === null) return fail(NO_FUNDS);
      if (['armor', 'air'].includes(kind)) { c.stock.steel -= men * .2; c.stock.fuel -= men * .05; }
      c.stock.arms -= arms; allowance(w, p, 'levy', Infinity, men);
      for (const k of ['peasants', 'workers']) p.pops[k].n = Math.max(1, p.pops[k].n - men * p.pops[k].n / hands);
      queueProject(w, c, { kind: 'unit', province: p.id, men, unitKind: kind, label: `${men}k ${kind}` });
      return { ok: true, msg: `${men < 1 ? `${Math.round(men * 1000)} men` : `${men} thousand men`} in training, ready in ${durationOf('unit', kind)} quarters.${men < 2 ? ' So small a body can guard a palace but counts for little in the field.' : ''} Every man kept under arms has to be paid from the military budget each quarter.${note}` };
    }
    case 'disband': {
      const u = w.units[op.unit]; if (!u || u.country !== c.id) return fail('No such unit.');
      const here = w.provinces[u.province], home = here && here.controller === c.id && here.owner === c.id ? here : w.provinces[c.capital];
      // A number discharges that many and the unit stays in being; with no number the whole unit goes home.
      const asked = Number(op.men), part = Number.isFinite(asked) && asked > 0 && asked < u.men - .05, men = part ? Math.round(asked * 10) / 10 : u.men;
      const count = menText(men);
      // The discharged are trained men: they go on the reserve roll, and their rifles go back to the arsenal.
      if (home) home.pops.workers.n += men; c.reserve = (c.reserve || 0) + men; c.stock.arms = (c.stock.arms || 0) + men * (u.kind === 'artillery' ? .12 : .05) * clamp(u.equip ?? .8, 0, 1);
      if (!part) { delete w.units[u.id]; return { ok: true, msg: `${count} went home and ${u.id} is dissolved.` }; }
      u.men -= men;
      return { ok: true, msg: `${count} went home. ${u.id} keeps ${menText(u.men)} under arms.` };
    }
    case 'mobilize': return mobilize(w, c, num(op.share, .05, 1, 1), pay, fail);
    case 'demobilize': return demobilize(w, c) ?? fail('No reservists are under arms.');
    case 'move': {
      const u = w.units[op.unit]; if (!u || u.country !== c.id || !w.provinces[op.to]) return fail('Invalid movement order.');
      // A number sends a detachment and leaves the rest of the unit where it stands.
      const asked = Number(op.men); if (!(Number.isFinite(asked) && asked >= .1 && asked < u.men - .05)) return applyOrder(w, c, u, op.to);
      if (u.province === op.to) return fail('Already there.'); if (!pathStep(w, u.province, op.to, c.id)) return fail('No route.');
      const men = Math.round(asked * 10) / 10, d = makeUnit(w, c.id, u.province, men, u.quality, u.loyalty, u.kind);
      d.morale = u.morale; d.equip = u.equip; if (u.bond != null) d.bond = u.bond; u.men -= men; d.target = op.to;
      return { ok: true, msg: `${d.id}, ${menText(men)}, was detached from ${u.id} and ordered to ${w.provinces[op.to].name}. ${u.id} keeps ${menText(u.men)}.` };
    }
    case 'merge_units': {
      const a = w.units[op.unit], b = w.units[op.into]; if (!a || !b || a === b || a.country !== c.id || b.country !== c.id) return fail('No such units.');
      if (a.province !== b.province) return fail(`${a.id} and ${b.id} must stand in the same province to be joined.`);
      if (a.kind !== b.kind) return fail(`${a.id} is ${a.kind} and ${b.id} is ${b.kind}; different arms stay separate units.`);
      // The joined body is as good, as loyal and as well armed as its men were on average.
      const n = a.men + b.men; for (const k of ['quality', 'morale', 'equip', 'loyalty', 'bond']) if (a[k] != null || b[k] != null) b[k] = ((a[k] ?? b[k]) * a.men + (b[k] ?? a[k]) * b.men) / n;
      b.men = n; b.dug = Math.min(a.dug || 0, b.dug || 0); delete w.units[a.id];
      return { ok: true, msg: `${a.id} was joined to ${b.id}, which now musters ${menText(n)}.` };
    }
    case 'move_army': { if (!w.provinces[op.to]) return fail('No such target province.'); let n = 0; const us = Object.values(w.units).filter(u => u.country === c.id).sort((a, b) => b.men - a.men); const share = Math.ceil(us.length * num(op.share, .1, 1, .6)); for (const u of us.slice(0, share)) if (applyOrder(w, c, u, op.to).ok) n++; return n ? ok() : fail('Your units have no route to this target.'); }
    case 'declare_war': {
      if (!target || atWar(w, c.id, target.id)) return fail('War cannot be declared.');
      // Whatever was signed with them is torn up. Breaking a peace that is still fresh costs most, at home and with everyone who watches.
      for (const t of w.treaties.filter(x => x.active && x.parties.includes(c.id) && x.parties.includes(target.id))) { t.active = false; if (['peace', 'nonaggression', 'alliance'].includes(t.kind)) { t.brokenBy = c.id; t.brokenAt = w.turn; } c.legitimacy = clamp(c.legitimacy - (t.kind === 'peace' ? 8 : 3), 0, 100); if (t.kind === 'peace') for (const o of aliveCountries(w)) if (o.id !== c.id) o.relations[c.id] = clampRel((o.relations[c.id] ?? 0) - 6); }
      w.wars.push({ id: nextId(w, 'S'), a: [c.id], b: [target.id], civil: false, active: true, start: w.turn, name: `${c.name} - ${target.name} War` }); c.embargo = c.embargo.filter(x => x !== target.id); c.relations[target.id] = -90; target.relations[c.id] = -90;
      // War after an ultimatum that was let run out is the consequence that was announced. War on someone one had a treaty with is a broken word.
      if ((c.casus?.[target.id] ?? -1) >= w.turn) { c.legitimacy = clamp(c.legitimacy + 3, 0, 100); delete c.casus[target.id]; }
      else if (w.treaties.some(x => !x.active && x.brokenBy === c.id && x.brokenAt === w.turn)) shame(w, c, -10, `it made war on ${target.name} in spite of a treaty`);
      // A people that has been wronged by the enemy stands behind the declaration, for a while.
      { const g = c.grudges?.[target.id]; if (g) c.legitimacy = clamp(c.legitimacy + Math.min(6, g.incident * .1 + g.kin * .15), 0, 100); }
      news(w, `${c.name} declared war on ${target.name}.`, { kind: 'war', countries: [c.id, target.id] });
      for (const a of aliveCountries(w)) if (a.id !== c.id && a.id !== target.id && hasTreaty(w, a.id, target.id, 'alliance')) tell(w, w.characters[a.leader], 'Foreign Ministry', `Your ally ${target.name} was attacked by ${c.name}. Help is expected under the alliance.`);
      return ok();
    }
    case 'join_war': {
      const war = w.wars.find(x => x.active && x.id === op.war); if (!war || !['a', 'b'].includes(op.side)) return fail('War not found.'); if (war.a.includes(c.id) || war.b.includes(c.id)) return fail('Already in this war.');
      const foes = war[op.side === 'a' ? 'b' : 'a'].map(id => w.countries[id]).filter(o => o?.alive);
      for (const o of foes) {
        for (const t of w.treaties.filter(x => x.active && x.parties.includes(c.id) && x.parties.includes(o.id))) { t.active = false; c.legitimacy = clamp(c.legitimacy - (t.kind === 'peace' ? 8 : 3), 0, 100); }
        c.relations[o.id] = -90; o.relations[c.id] = -90; c.embargo = c.embargo.filter(x => x !== o.id);
        tell(w, w.characters[o.leader], 'Foreign Ministry', `${c.name} has entered the ${war.name} against you.`);
      }
      war[op.side].push(c.id); news(w, `${c.name} entered the ${war.name}.`, { kind: 'war', countries: [c.id, ...foes.map(o => o.id)] }); return ok();
    }
    case 'propose_treaty': {
      if (!target || !TREATY.includes(op.kind)) return fail('Invalid proposal.');
      if (op.kind === 'peace' && !atWar(w, c.id, target.id)) return fail('There is no war between you to end.');
      const id = nextId(w, 'A'), clauses = normalizeClauses(w, op.clauses, [c.id, target.id]), other = pid => w.provinces[pid].owner === c.id ? target : c;
      // Provinces named in a treaty change hands when it is signed: each goes from whichever of the two owns it to the other.
      const cede = [...new Set(Array.isArray(op.cede) ? op.cede : [])].filter(pid => [c.id, target.id].includes(w.provinces[pid]?.owner)).slice(0, 24), reparations = num(op.reparations, 0, .3), payer = op.reparations_from === 'me' ? c.id : target.id;
      w.treaties.push({ id, kind: op.kind, parties: [c.id, target.id], active: false, pending: true, proposer: c.id, terms: String(op.terms || '').slice(0, 240), clauses, breaches: [], expires: null, durationTurns: op.turns ? Math.round(num(op.turns, 1, 200, 40)) : null, annex: !!op.annex, cede, reparations, payer, turn: w.turn });
      tell(w, w.characters[target.leader], c.name, `Treaty proposal ${id}: ${op.kind.replace('_', ' ')}. ${String(op.terms || '').slice(0, 240)}${clauses.length ? ` Clauses: ${clauses.map(x => clauseText(w, x)).join('; ')}.` : ''}${cede.length ? ` Provinces to change hands: ${cede.map(pid => `${w.provinces[pid].name} (${pid}) to ${other(pid).name}`).join(', ')}.` : ''}${op.annex ? ' Each side keeps the land it now holds.' : ''}${reparations ? ` ${w.countries[payer].name} pays ${Math.round(reparations * 100)}% of a quarter's output in gold.` : ''} Issue an accept_treaty decision to accept.`);
      return { ok: true, msg: `Proposal ${id} was sent.`, treaty: id };
    }
    // A demand with a date on it. If it is accepted its terms take effect like a treaty's; if it runs out, war is expected of the one who made it.
    case 'ultimatum': {
      if (!target) return fail('No such country.'); if (atWar(w, c.id, target.id)) return fail('You are at war with them already.');
      if (w.treaties.some(t => t.pending && t.ultimatum && t.proposer === c.id && t.parties.includes(target.id))) return fail('An ultimatum of yours to them is still running.');
      const id = nextId(w, 'A'), clauses = normalizeClauses(w, op.clauses, [c.id, target.id]), cede = [...new Set(Array.isArray(op.cede) ? op.cede : [])].filter(pid => w.provinces[pid]?.owner === target.id).slice(0, 24), reparations = num(op.reparations, 0, .3), quarters = Math.round(num(op.turns, 1, 4, 1));
      const demand = String(op.demand || op.terms || '').slice(0, 500); if (!demand && !cede.length && !reparations && !clauses.length) return fail('An ultimatum has to demand something.');
      w.treaties.push({ id, kind: 'settlement', parties: [c.id, target.id], active: false, pending: true, proposer: c.id, terms: demand, clauses, breaches: [], expires: null, durationTurns: 20, annex: false, cede, reparations, payer: target.id, turn: w.turn, ultimatum: { deadline: w.turn + quarters } });
      const terms = `${demand}${clauses.length ? ` Clauses: ${clauses.map(x => clauseText(w, x)).join('; ')}.` : ''}${cede.length ? ` To be handed over: ${cede.map(pid => `${w.provinces[pid].name} (${pid})`).join(', ')}.` : ''}${reparations ? ` To be paid: ${Math.round(reparations * 100)}% of a quarter's output in gold.` : ''}`;
      news(w, `${c.name} has sent ${target.name} an ultimatum: ${terms} It runs out in ${quarters} quarter${quarters > 1 ? 's' : ''}.`, { kind: 'diplomacy', countries: [c.id, target.id] });
      tell(w, w.characters[target.leader], c.name, `ULTIMATUM ${id} from ${c.name}: ${terms} It runs out in ${quarters} quarter${quarters > 1 ? 's' : ''}. Accepting it (accept_treaty) puts its terms into force and will be seen at home as giving way. Letting it run out leaves ${c.name} to do what it has threatened, or to be shown up as having bluffed.`);
      return { ok: true, msg: `Ultimatum ${id} is delivered and public. If ${target.name} lets it run out, war is expected of you within three quarters; if nothing follows, your word is worth less abroad and at home.`, treaty: id };
    }
    // A public promise to fight for another state if it is attacked.
    case 'guarantee': {
      if (!target) return fail('No such country.'); const list = w.guarantees ||= [], at = list.findIndex(x => x.by === c.id && x.of === target.id);
      if (op.withdraw) { if (at < 0) return fail('You have given no such guarantee.'); list.splice(at, 1); shame(w, c, w.wars.some(x => x.active && x.b.includes(target.id)) ? -8 : -3, `it withdrew its guarantee of ${target.name}`); news(w, `${c.name} has withdrawn its guarantee of ${target.name}.`, { kind: 'diplomacy', countries: [c.id, target.id] }); return ok(); }
      if (at >= 0) return fail('That guarantee is already given.');
      list.push({ by: c.id, of: target.id, turn: w.turn }); news(w, `${c.name} has guaranteed the independence of ${target.name}: an attack on it, ${c.name} says, will be answered.`, { kind: 'diplomacy', countries: [c.id, target.id] });
      tell(w, w.characters[target.leader], c.name, `${c.name} has publicly guaranteed your independence.`);
      return { ok: true, msg: `The guarantee of ${target.name} is public. If ${target.name} is attacked and you have not come in on its side within half a year, the world will know what your word is worth.` };
    }
    // What a state does with someone who fled to it: hand them back, send them on, or call them the rightful government.
    case 'extradite': case 'expel': case 'recognise_exile': {
      const ch = has(w.characters, op.character) ? w.characters[op.character] : null; if (!ch?.alive || ch.status !== 'exiled' || ch.host !== c.id) return fail('No such exile lives among you.');
      const home = w.countries[ch.country]; if (!home?.alive) return fail('The country they fled no longer exists.');
      if (op.op === 'extradite') {
        ch.status = 'imprisoned'; ch.host = null; ch.heldSince = w.turn; ch.recognisedBy = []; home.relations[c.id] = clampRel((home.relations[c.id] ?? 0) + 15); shame(w, c, -4, `it handed ${ch.name}, who had taken shelter with it, back to ${home.name}`);
        news(w, `${c.name} has handed ${ch.name} back to ${home.name}.`, { kind: 'diplomacy', countries: [c.id, home.id] }); tell(w, w.characters[home.leader], c.name, `${c.name} has handed ${ch.name} over to you. ${ch.name} is in your prison.`); tell(w, ch, c.name, `${c.name} has handed you back. You are in a cell at home.`);
        return { ok: true, msg: `${ch.name} was handed over to ${home.name}. Those who seek shelter will remember what yours was worth.` };
      }
      if (op.op === 'expel') { const next = aliveCountries(w).filter(o => o.id !== c.id && o.id !== home.id).sort((a, b) => (a.relations[home.id] ?? 0) - (b.relations[home.id] ?? 0))[0]; if (!next) return fail('There is nowhere else for them to go.'); ch.host = next.id; ch.recognisedBy = (ch.recognisedBy || []).filter(x => x !== c.id); tell(w, ch, c.name, `${c.name} has put you over the border. You are in ${next.name} now.`); tell(w, w.characters[next.leader], 'Police', `${ch.name}, an exile from ${home.name}, has been expelled by ${c.name} and has come to us.`); return { ok: true, msg: `${ch.name} was put over the border into ${next.name}.` }; }
      const list = ch.recognisedBy ||= [];
      if (op.withdraw) { if (!list.includes(c.id)) return fail('You have not recognised them.'); ch.recognisedBy = list.filter(x => x !== c.id); news(w, `${c.name} no longer recognises ${ch.name} as the government of ${home.name}.`, { kind: 'diplomacy', countries: [c.id, home.id] }); return ok(); }
      if (list.includes(c.id)) return fail('You recognise them already.');
      list.push(c.id); ch.power = clamp(ch.power + 8, 0, 100); home.relations[c.id] = clampRel((home.relations[c.id] ?? 0) - 30);
      news(w, `${c.name} has recognised ${ch.name}, in exile, as the rightful government of ${home.name}.`, { kind: 'diplomacy', countries: [c.id, home.id] }); tell(w, ch, c.name, `${c.name} recognises you as the rightful government of ${home.name}.`); tell(w, w.characters[home.leader], 'Foreign Ministry', `${c.name} has recognised ${ch.name}, in exile there, as the rightful government of our country.`);
      return { ok: true, msg: `${ch.name} is recognised by you as the rightful government of ${home.name}. It weighs on the standing of those who rule there, and they will not forgive it.` };
    }
    case 'accept_treaty': {
      const waiting = w.treaties.filter(x => x.pending && x.parties.includes(c.id) && x.proposer !== c.id), from = waiting.filter(x => !target || x.proposer === target.id), t = waiting.find(x => x.id === op.id) ?? (from.length === 1 ? from[0] : null);
      if (!t) return fail(waiting.length ? `Which proposal? Waiting: ${waiting.map(x => x.id).join(', ')}.` : 'No proposal is waiting.');
      const other = alive(w, t.proposer); if (!other) { t.pending = false; return fail('The other party is gone.'); }
      if (t.kind === 'peace' && !atWar(w, c.id, other.id)) { t.pending = false; return fail('There is no war between you to end.'); }
      // A peace is a treaty in force like any other: for some years, breaking it is breaking one's word.
      t.pending = false; t.active = true; activateClauses(w, t); const lasts = t.durationTurns ?? (t.kind === 'peace' ? 20 : null); if (lasts) t.expires = w.turn + lasts;
      // Giving way to a demand with a date on it is seen at home for what it is, and remembered against the one who made it.
      if (t.ultimatum) { c.legitimacy = clamp(c.legitimacy - 4, 0, 100); other.legitimacy = clamp(other.legitimacy + 2, 0, 100); const g = (c.grudges ||= {})[other.id] ||= { incident: 0, kin: 0 }; g.incident += 15; news(w, `${c.name} has accepted the ultimatum of ${other.name}.`, { kind: 'diplomacy', countries: [c.id, other.id] }); }
      if (t.kind === 'peace') endWar(w, c.id, other.id, t.annex);
      for (const pid of t.cede || []) {
        const p = w.provinces[pid], giver = w.countries[p.owner], taker = p.owner === c.id ? other : p.owner === other.id ? c : null; if (!taker) continue;
        p.owner = taker.id; p.controller = taker.id; p.admin = Math.min(p.admin ?? .5, .3); p.governor = null; delete p.siege;
        if (giver.capital === pid) { const next = [...countryProvinces(w, giver.id)].sort((a, b) => provincePop(b) - provincePop(a))[0]; if (next) giver.capital = next.id; }
        news(w, `${p.name} passed from ${giver.name} to ${taker.name} by treaty.`, { kind: 'diplomacy', countries: [giver.id, taker.id], province: pid });
      }
      if (t.cede?.length) settleOccupations(w);
      if (t.reparations) {
        // Paid in gold as far as there is gold; the rest is owed.
        const payer = t.payer === other.id ? other : c, payee = payer === c ? other : c, due = Math.max(payer.realGdp, 1) * t.reparations, paid = Math.min(Math.max(payer.reserves, 0), due);
        payer.reserves -= paid; payee.reserves += paid; if (due - paid > .5) payer.creditors[payee.id] = (payer.creditors[payee.id] || 0) + due - paid;
      }
      news(w, t.kind === 'peace' ? `${c.name} and ${other.name} signed a peace.` : `Treaty signed between ${c.name} and ${other.name}: ${t.kind.replace('_', ' ')}.`, { kind: 'diplomacy', countries: [c.id, other.id] });
      const harsh = t.annex || t.reparations > 0 || t.cede?.length, warmth = t.kind === 'peace' && harsh ? 4 : 18;
      c.relations[other.id] = clampRel((c.relations[other.id] ?? 0) + warmth); other.relations[c.id] = clampRel((other.relations[c.id] ?? 0) + warmth);
      return ok();
    }
    case 'break_treaty': { const t = w.treaties.find(x => x.id === op.id && x.active && x.parties.includes(c.id)); if (!t) return fail('No such treaty.'); t.active = false; const o = t.parties.find(x => x !== c.id), justified = t.breaches?.at(-1)?.party === o; shame(w, c, justified ? -2 : t.kind === 'peace' ? -15 : -8, `it broke its ${t.kind.replace('_', ' ')} treaty with ${w.countries[o]?.name ?? 'another state'}`); if (w.countries[o]) w.countries[o].relations[c.id] = clampRel((w.countries[o].relations[c.id] ?? 0) - (justified ? 10 : 35)); if (!justified) for (const a of aliveCountries(w)) if (a.id !== c.id) a.relations[c.id] = clampRel((a.relations[c.id] ?? 0) - 5); news(w, `${c.name} unilaterally broke its treaty.`, { kind: 'diplomacy', countries: [c.id, o] }); return ok(); }
    case 'send_aid': { if (!target) return fail('No such target.'); const val = Math.min(Math.max(c.reserves, 0), Math.max(c.realGdp, 1) * num(op.pct_gdp, 0, .25)); const arms = Math.min(c.stock.arms, num(op.arms, 0, 1e9)); if (val <= 0 && arms <= 0) return fail('There is nothing to send.'); c.reserves -= val; target.reserves += val; c.stock.arms -= arms; target.stock.arms += arms; target.relations[c.id] = clampRel((target.relations[c.id] ?? 0) + 12); tell(w, w.characters[target.leader], c.name, `Aid has arrived: ${Math.round(val)} in gold${arms > 0 ? ` and ${Math.round(arms)} of arms` : ''}.`); news(w, `${c.name} sent aid to ${target.name}.`, { kind: 'diplomacy', countries: [c.id, target.id], secret: !!op.secret }); return { ok: true, msg: `${Math.round(val)} gold${arms > 0 ? ` and ${Math.round(arms)} arms` : ''} sent.` }; }
    case 'spy': { if (!target) return fail('No such target.');
      // Military intelligence is the staff's own work; blowing up works abroad or paying for a rising there is an act of state.
      if (['sabotage', 'fund_uprising'].includes(op.kind) && !governs(w, c, actor) && !delegated(c, actor, 'spy')) return fail('The chief of staff may gather intelligence abroad; sabotage and stirring a rising there need the ruler\'s order.');
      const p = clamp(.25 + (c.intelligence - target.intelligence) / 160 + rand(w) * .3, .08, .9); if (rand(w) > p) { if (rand(w) < .5) { target.relations[c.id] = clampRel((target.relations[c.id] ?? 0) - 18); news(w, `${target.name} caught spies from ${c.name}.`, { kind: 'diplomacy', countries: [c.id, target.id] }); } return fail('The operation failed.'); } c.intel[target.id] = clamp((c.intel[target.id] ?? 0) + 25, 0, 100); if (op.kind === 'sabotage') { const v = pick(w, countryProvinces(w, target.id)); if (v) { for (const k of Object.keys(v.plants)) v.plants[k] *= .9; v.devastation = clamp(v.devastation + .08, 0, 1); news(w, `Mysterious explosions at industrial plants in ${v.name}.`, { kind: 'plot', countries: [target.id] }); } } if (op.kind === 'fund_uprising') { target.mods.push({ key: 'unrest', delta: 9, turns: 3, label: 'Foreign-backed unrest' }); } return ok(); }
    case 'propaganda': { const s = num(op.strength, 0, 1, .5), ruler = governs(w, c, actor), moved = sway(c, actor, ruler ? 'sat.all' : 'unrest', (ruler ? 4 : 5) * s, 2, `Propaganda: ${actor.name}`); return moved ? ok() : { ok: true, msg: 'The country has heard as much of this as it will take for now.' }; }
    case 'repress': { const s = num(op.strength, 0, 1, .5); c.repress = clamp(c.repress + s * 55, 0, 100); c.pressFreedom = clamp(c.pressFreedom - s * 8, 0, 100); c.legitimacy = clamp(c.legitimacy - s * 3, 0, 100); for (const p of countryProvinces(w, c.id)) p.pops.middle.sat = clamp(p.pops.middle.sat - s * 9, 0, 100); news(w, `${c.name} security forces took harsh measures against dissidents.`, { kind: 'politics', countries: [c.id] }); return ok(); }
    case 'concession': { const k = op.cls;
      if (k === 'army') {
        // A bonus paid to the troops buys their spirit for a while; it does not replace regular pay.
        const cost = gdp * num(op.pct_gdp, 0, .15), us = Object.values(w.units).filter(u => u.country === c.id); if (!us.length) return fail('There is no army to pay.');
        const note = pay(c, cost); if (note === null) return fail(NO_FUNDS);
        const lift = clamp(cost / Math.max(upkeepCost(w, c), 1) * 20, 0, 15);
        for (const u of us) { u.morale = clamp(u.morale + lift, 0, 100); u.loyalty = clamp(u.loyalty + lift / 2, 0, 100); }
        c.mods.push({ key: 'sat.army', delta: lift / 2, turns: 3, label: 'Bonus paid to the troops' });
        return { ok: true, msg: `The troops were paid a bonus of ${Math.round(cost)}.${note}` };
      }
      if (!CLASSES.includes(k)) return fail('No such class.'); const cost = gdp * num(op.pct_gdp, 0, .15), note = pay(c, cost); if (note === null) return fail(NO_FUNDS); for (const p of countryProvinces(w, c.id)) p.pops[k].sat = clamp(p.pops[k].sat + cost / gdp * 110, 0, 100); return { ok: true, msg: `Applied.${note}` }; }
    case 'purge': {
      const ch = w.characters[op.character]; if (!ch || ch.country !== c.id || !ch.alive || ch.id === actor.id) return fail('No such target.');
      if (ch.id === c.leader) return fail('The ruler is not arrested by an order of their own government; that takes a coup.');
      const fate = op.fate === 'dead' ? 'dead' : op.fate === 'exiled' ? 'exiled' : 'imprisoned', inCustody = ch.status === 'imprisoned';
      if (ch.status === fate) return fail(`${ch.name} is already ${fate}.`);
      if (ch.status === 'exiled') return fail(`${ch.name} is abroad, beyond the reach of the police.`);
      if (rand(w) < c.courts / 220) { c.legitimacy = clamp(c.legitimacy - 2, 0, 100); news(w, `${c.name} court halted the order against ${ch.name}.`, { kind: 'politics', countries: [c.id] }); return fail('The court blocked it.'); }
      // An order of arrest passes through the police. A chief of police who has lost faith in the ruler lets it be known in time.
      { const chief = Object.values(w.characters).find(x => x.alive && x.country === c.id && x.post === 'police' && x.status === 'free'); if (w.friction && chief && chief.id !== ch.id && chief.loyalty < 30 && !inCustody && rand(w) < .4) { tell(w, ch, 'A friend in the police', `An order for your arrest has been signed by ${actor.name}. You were warned in time; they will come again.`); leaveTrace(w, chief, `Warned ${ch.name} of the order of arrest.`); return fail(`${ch.name} could not be found when the police came: someone gave warning.`); } }
      const seated = c[ch.role] === ch.id, risk = seated && ch.role === 'general' ? c.blocs.army.power / 100 : .15;
      if (!inCustody && rand(w) < risk * .45) { news(w, `${ch.name} resisted arrest in ${c.name}.`, { kind: 'plot', countries: [c.id] }); ch.loyalty = 0; return fail('The arrest met resistance.'); }
      if (seated && ch.role === 'general') Object.values(w.units).filter(u => u.country === c.id).forEach(u => u.loyalty = clamp(u.loyalty - 8, 0, 100));
      c.pressFreedom = clamp(c.pressFreedom - 3, 0, 100);
      // The arrest of a public figure is noticed wherever there is a press to notice it, and the fortune they kept at home is taken with them.
      if (seated && !inCustody) { c.legitimacy = clamp(c.legitimacy - 6 * c.pressFreedom / 100, 0, 100); c.mods.push({ key: 'unrest', delta: clamp(ch.power / 15, 1, 5) * (.3 + c.pressFreedom / 100), turns: 3, label: `Arrest of ${ch.name}` }); if (ch.role === 'opposition') c.rivalJailed = w.turn; }
      const seized = inCustody ? 0 : Math.max(0, ch.wealth - (ch.abroad || 0)) * (fate === 'exiled' ? .5 : .8), took = seized > 1 ? ` ${Math.round(seized)} of their fortune was seized for the treasury.` : '';
      ch.wealth -= seized; c.treasury += seized * (c.rate || 1);
      if (fate === 'dead') {
        // A killing by the state is remembered by the dead person's following, and by whoever keeps files.
        news(w, `${c.name}: ${ch.name} was executed.`, { kind: 'politics', countries: [c.id] });
        c.mods.push({ key: 'unrest', delta: clamp(ch.power / 12, 1, 6) * (.5 + c.pressFreedom / 100), turns: 3, label: `Execution of ${ch.name}` });
        leaveTrace(w, actor, `Had ${ch.name} put to death.`); die(w, ch, 'was executed', { quiet: true });
        return { ok: true, msg: `${ch.name} was executed.${took}` };
      }
      neutralize(w, ch, fate);
      tell(w, ch, 'The police', `You were ${fate === 'exiled' ? 'put across the border and forbidden to return' : 'arrested and locked up'} on the order of ${actor.name}.`);
      news(w, `${c.name}: ${ch.name} was ${fate === 'exiled' ? 'driven into exile' : 'arrested and imprisoned'}.`, { kind: 'politics', countries: [c.id] });
      return { ok: true, msg: `${ch.name} is now ${fate}.${took}` };
    }
    case 'release': { const ch = w.characters[op.character]; if (!ch?.alive || ch.country !== c.id || !['imprisoned', 'exiled'].includes(ch.status)) return fail('No such prisoner or exile.'); const was = ch.status; ch.status = 'free'; tell(w, ch, c.name, was === 'exiled' ? 'You are allowed to return home.' : 'You are released from prison.'); news(w, `${c.name}: ${ch.name} was ${was === 'exiled' ? 'allowed to return from exile' : 'released from prison'}.`, { kind: 'politics', countries: [c.id] }); return ok(); }
    case 'designate_successor': { if (op.remove) { c.heir = null; return ok(); } const ch = personFor(w, c, op, 'heir', { power: 40, age: [18, 45], ...(c.succession === 'dynasty' && !op.name ? { family: actor.name.split(' ').at(-1) } : {}) }); if (!ch?.alive || ch.country !== c.id || ch.status !== 'free' || ch.id === c.leader) return fail(noPerson('No such person to name.')); c.heir = ch.id; c._heirSecret = !!op.secret; tell(w, ch, w.characters[c.leader]?.name ?? c.name, 'You are named successor: if the ruler dies or falls, the government passes to you.'); news(w, `${c.name}: ${ch.name} was named successor.`, { kind: 'politics', countries: [c.id], secret: !!op.secret }); return ok(); }
    case 'persecute': return persecute(w, c, actor, op);
    case 'set_regime': { if (op.regime) c.regime = String(op.regime).slice(0, 60); if (op.ideology) c.ideology = String(op.ideology).slice(0, 80); if (SUCCESSION.includes(op.succession) && op.succession !== c.succession) { c.succession = op.succession; c.legitBase = (c.legitBase ?? 0) * .7; } if (typeof op.elections === 'boolean') { c.elections = op.elections; if (op.elections && c.nextElection <= w.turn) c.nextElection = w.turn + 8; if (op.elections && !c.parliament) makeParliament(c, 'Parliament'); } if (op.press_freedom !== undefined) c.pressFreedom = eased(c.pressFreedom, num(op.press_freedom, 0, 100), 'Press freedom', []); if (op.axes) for (const a of ['econ', 'auth', 'nation', 'faith']) if (op.axes[a] !== undefined) c.axes[a] = num(op.axes[a], -100, 100, c.axes[a]); c.legitimacy = clamp(c.legitimacy - 4, 0, 100); news(w, `${c.name} changed its regime: ${c.regime}.`, { kind: 'politics', countries: [c.id] }); return ok(); }
    case 'hold_election': c.elections = true; c.nextElection = w.turn; if (!c.parliament) makeParliament(c, 'Parliament'); return ok();
    case 'rig_election': c.rigging = num(op.amount, 0, 25, 10); c.legitimacy = clamp(c.legitimacy - c.rigging * .15, 0, 100); return ok();
    case 'start_plot': { const kind = ['coup', 'assassination', 'uprising'].includes(op.kind) ? op.kind : 'coup'; if (w.plots.some(x => x.active && x.leader === actor.id)) return fail('You already have a plot.'); if (actor.id === c.leader && kind !== 'assassination') return fail('A ruler does not plot against their own government.'); const mark = kind === 'assassination' ? (op.character ? w.characters[op.character] : w.characters[c.leader]) : null; if (kind === 'assassination' && (!mark?.alive || mark.id === actor.id)) return fail('There is no such person to strike at.'); const id = nextId(w, 'K-'); w.plots.push({ id, country: c.id, kind, leader: actor.id, members: [], target: mark?.id ?? null, progress: 5, secrecy: num(op.secrecy, 0, 1, .5), exposed: false, active: true, start: w.turn }); leaveTrace(w, actor, mark ? `Secretly began preparing the killing of ${mark.name}.` : `Secretly began preparing a plot (${kind}).`); return { ok: true, msg: `Plot started: ${id}${mark ? `, against ${mark.name}` : ''}. It gains ground each quarter; execute_plot carries it out.`, plot: id }; }
    case 'invite_plot': { const pl = w.plots.find(x => x.id === op.plot && x.active && x.leader === actor.id); const ch = w.characters[op.character]; if (!pl || !ch?.alive || ch.country !== c.id || (ch.id === c.leader && pl.kind !== 'assassination') || ch.id === actor.id) return fail('Invalid invitation.'); if (ch.aiControlled) { ch.inbox.push({ turn: w.turn, from: actor.name, text: `Secret offer: I want you to join the ${pl.kind} plot ${pl.id}. You may join, refuse or inform on it.` }); return { ok: true, msg: 'The offer was delivered; the choice is theirs.' }; } const p = ch.patron === actor.id && w.turn - (ch.soundedAt ?? -99) <= 12 ? 1 : clamp(.25 + ch.ambition / 180 - ch.loyalty / 220 + (w.countries[c.id].tension ?? 0) / 300, .03, .9); if (rand(w) < p) { pl.members.push(ch.id); ch.inbox.push({ turn: w.turn, from: actor.name, text: `You were approached about plot ${pl.id} (${pl.kind}) and joined.` }); return ok(); } if (ch.loyalty > 62) { pl.exposed = true; w.characters[c.leader].inbox.push({ turn: w.turn, from: ch.name, text: `${actor.name} invited me to a ${pl.kind} plot. Plot no ${pl.id}.` }); } return fail('The invitation was refused.'); }
    case 'join_plot': { const pl = w.plots.find(x => x.id === op.plot && x.active && x.country === c.id); if (!pl || pl.leader === actor.id || pl.members.includes(actor.id)) return fail('Could not join.'); if (actor.id === c.leader && pl.kind !== 'assassination') return fail('A ruler cannot join a plot against their own government.'); pl.members.push(actor.id); leaveTrace(w, actor, `Joined a plot (${pl.kind}).`); return ok(); }
    case 'betray_plot': { const pl = w.plots.find(x => x.id === op.plot && x.active && x.country === c.id); if (!pl) return fail('No such plot.'); pl.exposed = true; actor.loyalty = clamp(actor.loyalty + 20, 0, 100); w.characters[c.leader].inbox.push({ turn: w.turn, from: actor.name, text: `Plot report ${pl.id}: ${pl.kind}, ringleader ${w.characters[pl.leader].name}.` }); return ok(); }
    case 'execute_plot': { const pl = w.plots.find(x => x.id === op.plot && x.active && [x.leader, ...x.members].includes(actor.id)); if (!pl) return fail('No such plot.'); if (actor.id === w.countries[pl.country]?.leader && pl.kind !== 'assassination') return fail('A ruler cannot carry out a plot against their own government.'); return { ok: true, msg: executePlot(w, pl) }; }
    case 'fund_plot': { const pl = w.plots.find(x => x.id === op.plot && x.active && x.country === c.id); if (!pl) return fail('No such plot.'); const m = num(op.amount, 0, actor.wealth); actor.wealth -= m; pl.progress = clamp(pl.progress + m * .5, 0, 100); return ok(); }
    case 'bribe': { const ch = w.characters[op.character]; if (!ch?.alive || ch.id === actor.id) return fail('No such target.'); const m = num(op.amount, 0, actor.wealth); if (m <= 0) return fail('No money to give.'); actor.wealth -= m; ch.wealth += m; leaveTrace(w, actor, `Paid ${ch.name} a bribe of ${Math.round(m)}.`); leaveTrace(w, ch, `Took a bribe of ${Math.round(m)} from ${actor.name}.`); if (ch.aiControlled) tell(w, ch, actor.name, `Sent you ${Math.round(m)} in money.`); else ch.loyalty = clamp(ch.loyalty + (op.direction === 'down' ? -1 : 1) * m * .25 * ch.greed / 50, 0, 100); return ok(); }
    case 'capital_flight': {
      // A fortune is moved abroad as gold: it leaves the country's reserve, and once out it is beyond the state's reach.
      if (c.capitalClosed) return fail('Capital controls blocked moving the money out.');
      const home = Math.max(0, actor.wealth - (actor.abroad || 0)), m = Math.min(allowance(w, actor, 'flight', home * .5, home * num(op.share, 0, .5, .1)), Math.max(c.reserves, 0)); if (m <= 0) return fail('There is nothing to move, or no gold left in the country to move it in.');
      const haven = aliveCountries(w).filter(o => o.id !== c.id && !o.capitalClosed).sort((a, b) => b.legitimacy - a.legitimacy)[0]; if (!haven) return fail('No country abroad is open to it.');
      c.reserves -= m; haven.reserves += m; actor.abroad = (actor.abroad || 0) + m;
      leaveTrace(w, actor, 'Secretly moved capital out of the country.'); c.blocs.capital.sat = clamp(c.blocs.capital.sat - 4, 0, 100); news(w, `${c.name}: investors are pulling capital out of the country.`, { kind: 'economy', countries: [c.id], secret: true });
      return { ok: true, msg: `${Math.round(m)} of your fortune now lies in ${haven.name}, out of the state's reach.` };
    }
    case 'invest': { const m = num(op.amount, 0, actor.wealth); actor.wealth -= m; const p = countryProvinces(w, c.id)[0]; if (p) p.plants.goods = clamp(p.plants.goods + m * .004, 0, 8); return ok(); }
    case 'embezzle': { const m = Math.min(Math.max(c.treasury, 0), gdp * allowance(w, actor, 'embezzle', .02, num(op.pct_gdp, 0, .1))); if (m <= 0) return fail('There is nothing within reach to take this quarter.'); c.treasury -= m; actor.wealth += m * .2 / Math.max(c.priceLevel, .01); leaveTrace(w, actor, `Embezzled ${Math.round(m)} from the treasury.`); c.corruption = clamp(c.corruption + m / gdp * 80, 0, 100); if (rand(w) < .25) { c.legitimacy = clamp(c.legitimacy - 5, 0, 100); news(w, `${c.name}: allegations of corruption against ${actor.name} have spread.`, { kind: 'politics', countries: [c.id] }); } return { ok: true, msg: `${Math.round(m)} left the treasury.` }; }
    case 'create_institution': { const inst = makeInstitution(w, c, actor, op); if (!inst) return fail(institutionRoom(w, c, actor) || 'The institution could not be founded.'); news(w, `${c.name}: ${inst.name} was founded.`, { kind: 'politics', countries: [c.id] }); return { ok: true, msg: `Institution founded: ${inst.id}${inst.sponsor ? '' : `, costing ${(inst.budget * 100).toFixed(2)}% of GDP a quarter`}`, institution: inst.id }; }
    case 'fund_institution': {
      const inst = (c.institutions || []).find(i => i.id === op.id); if (!inst) return fail('No such institution.');
      // A private body lives on its founder's purse; the state may add a grant from the budget, and the founder may change what they give.
      if (inst.sponsor) {
        if (inst.sponsor === actor.id && op.amount != null) { inst.amount = num(op.amount, 0, 1e6, inst.amount); return { ok: true, msg: `${inst.name} now gets ${Math.round(inst.amount * 10) / 10} a quarter from your own purse.` }; }
        if (!op._law && !governs(w, c, actor)) return fail(inst.sponsor === actor.id ? 'Say how much of your own money it should get each quarter (amount).' : 'It is a private body: only its founder funds it, or the state by a grant.');
        inst.grant = num(op.budget_pct_gdp, 0, MAX_AGENCY_BUDGET / 4, inst.grant || 0); tell(w, w.characters[inst.sponsor], c.name, inst.grant > 0 ? `The state now grants ${inst.name} ${Math.round(inst.grant * Math.max(c.gdp, 1) * 10) / 10} a quarter from the budget.` : `The state grant to ${inst.name} has ended.`);
        return { ok: true, msg: `The state grants ${inst.name}, a private body, ${Math.round(inst.grant * 1e4) / 100}% of GDP a quarter from the budget.` };
      }
      if (!op._law && !governs(w, c, actor)) return fail('Only whoever governs, or a law, sets the budget of a state institution.');
      inst.budget = num(op.budget_pct_gdp, 0, MAX_AGENCY_BUDGET, inst.budget); return ok();
    }
    case 'appoint_institution': { const inst = (c.institutions || []).find(i => i.id === op.id); if (!inst) return fail('No such institution.'); if (!governs(w, c, actor) && actor.id !== inst.head && actor.id !== inst.sponsor) return fail('You cannot make appointments to this institution.');
      // A member who is given no name is a seat filled from the ranks, not a figure in public life: the body is larger by one, and nobody new enters the world.
      if (!op.character && !String(op.name ?? '').trim() && op.role !== 'head') { const seats = inst.seats || 0; if (op.remove) { if (!seats) return fail('It has no unnamed members to remove.'); inst.seats = seats - 1; return { ok: true, msg: `One unnamed member left ${inst.name}.` }; } if (seats >= 12) return fail(`${inst.name} has all the ordinary members it can seat.`); inst.seats = seats + 1; return { ok: true, msg: `An ordinary member was seated; ${inst.name} now has ${inst.members.length + inst.seats} members besides its head. Only a member appointed by name becomes a person others can deal with.` }; }
      const ch = personFor(w, c, op, 'official'); if (!ch?.alive || ch.country !== c.id) return fail(noPerson('No such target.')); inst.members = inst.members.filter(x => x !== ch.id); if (op.remove) { if (inst.head === ch.id) inst.head = null; tell(w, ch, inst.name, `You were removed from ${inst.name}.`); return ok(); } if (ch.status !== 'free') return fail(`${ch.name} is ${ch.status} and can hold no post.`); if (op.role === 'head') { if (inst.head) inst.members.push(inst.head); inst.head = ch.id; } else if (inst.head !== ch.id) inst.members.push(ch.id); tell(w, ch, inst.name, op.role === 'head' ? `You were appointed head of ${inst.name}.` : `You were made a member of ${inst.name}.`); return ok(); }
    case 'dissolve_institution': { const i = (c.institutions || []).findIndex(x => x.id === op.id); if (i < 0) return fail('No such institution.'); const inst = c.institutions[i]; if (!op._law && !governs(w, c, actor) && inst.sponsor !== actor.id) return fail('Only its founder, whoever governs, or a law can dissolve it.'); c.institutions.splice(i, 1); if (!inst.sponsor || inst.sponsor !== actor.id) c.legitimacy = clamp(c.legitimacy - (inst.strength ?? 0) * 6, 0, 100); news(w, `${c.name}: ${inst.name} was dissolved.`, { kind: 'politics', countries: [c.id] }); return ok(); }
    case 'create_parliament': { if (c.parliament) return fail('There is already a parliament.'); makeParliament(c, op.name, op.legislative !== false); news(w, `${c.name}: ${c.parliament.name} convened.`, { kind: 'politics', countries: [c.id] }); return ok(); }
    case 'suspend_parliament': { if (!c.parliament) return fail('There is no parliament.'); const n = Math.round(num(op.turns, 0, 400, 4)); if (n === 0) { if (parliamentOpen(w, c)) return fail('It is in session already.'); c.parliament.suspendedUntil = 0; news(w, `${c.name}: parliament was recalled.`, { kind: 'politics', countries: [c.id] }); return ok(); } if (!parliamentOpen(w, c)) return fail('There is no parliament in session.'); c.parliament.suspendedUntil = w.turn + n; c.legitimacy = clamp(c.legitimacy - (4 + Math.min(n, 40) * .5), 0, 100); c.pressFreedom = clamp(c.pressFreedom - 4, 0, 100); news(w, `${c.name}: parliament suspended for ${n} quarters.`, { kind: 'politics', countries: [c.id] }); return ok(); }
    case 'propose_law': {
      // Where no legislature sits, only whoever governs makes law, by decree; an advisory chamber is asked nothing.
      if (!(parliamentOpen(w, c) && c.parliament.legislative)) { if (!governs(w, c, actor)) return fail('There is no legislature in session to put a bill to.'); const b = { id: nextId(w, 'Y'), title: String(op.title || 'Decree').slice(0, 100), text: String(op.text || '').slice(0, 2000), ops: Array.isArray(op.ops) ? op.ops.slice(0, 4) : [] }; const done = enactLaw(w, c, b, applyOp, 'decree'); news(w, `${c.name}: the "${b.title}" decree took effect.`, { kind: 'politics', countries: [c.id] }); return { ok: true, msg: `Decree ${b.id}.${done.length ? ` ${done.map(r => `${r.op}: ${r.msg}`).join(' ')}` : ''}` }; }
      const bill = createBill(w, c, actor, op); return bill ? { ok: true, msg: `Bill ${bill.id} goes to a vote next quarter.${Array.isArray(op.ops) && bill.ops.length < op.ops.length ? ' A law cannot arrest people, name heirs or move troops; those parts were left out.' : ''}`, bill: bill.id } : fail('The parliamentary agenda is full.');
    }
    case 'vote_bill': { const b = (c.bills || []).find(x => x.id === op.bill && x.status === 'pending'); if (!b) return fail('No pending bill.'); const led = leadsParties(w, c, actor); if (!led.length) return fail('You do not lead a party.'); for (const p of led) b.votes[p.id] = op.vote === 'no' ? 'no' : 'yes'; return ok(); }
    case 'lobby_bill': { const b = (c.bills || []).find(x => x.id === op.bill && x.status === 'pending'); const p = c.parties.find(x => x.id === op.party); if (!b || !p) return fail('No such bill or party.'); const m = num(op.amount, 0, actor.wealth); if (m <= 0) return fail('No money.'); actor.wealth -= m; b.lobby[p.id] = (b.lobby[p.id] || 0) + (op.side === 'no' ? -m : m); leaveTrace(w, actor, `Spent ${Math.round(m)} on ${p.name} for the ${b.title} vote.`); return ok(); }
    case 'custom': return applyCustom(w, c, actor, op);
    case 'noop': return ok();
    default: return fail(`Unknown operation: ${op.op}`);
  }
}

// Words, decrees and gestures move moods for a while; they do not change what the state is or what it can do.
// How much mood a country can be talked into at one time is limited by how far the speaker reaches, so repeating the gesture adds nothing.
export const moodRoom = (c, actor, stat) => (stat === 'legitimacy' ? .6 : 2 + c.bureaucracy / 20) * (actor.id === c.leader ? 1 : clamp(actor.power / 100, .1, .8));
function applyCustom(w, c, actor, op) {
  const notes = [];
  for (const e of Array.isArray(op.effects) ? op.effects.slice(0, 4) : []) {
    if (!MOODS.has(e?.stat)) { notes.push(`${String(e?.stat).slice(0, 30)} does not move by decree`); continue; }
    const room = moodRoom(c, actor, e.stat), active = sum(c.mods.filter(m => m.src === 'custom' && m.key === e.stat), m => m.delta);
    const delta = clamp(active + num(e.delta, -room, room, 0), -room, room) - active;
    if (Math.abs(delta) < .05) { notes.push(`${e.stat}: the country has heard as much of this as it will take for now`); continue; }
    c.mods.push({ key: e.stat, delta, turns: Math.round(num(e.turns ?? op.turns, 1, 6, 2)), label: String(op.label || 'Special policy').slice(0, 70), src: 'custom' });
  }
  return { ok: true, msg: notes.length ? `Recorded. ${notes.join('; ')}.` : 'Recorded.' };
}
// Violence by the state against the people of a province. The engine does not weigh the order; it carries out what force allows and works out what follows:
// the dead and the driven-out, the makeup of the province, the neighbours who receive them, the army that was used, and who comes to know.
function persecute(w, c, actor, op) {
  const p = w.provinces[op.province]; if (!p || p.controller !== c.id) return fail('That province is not under your control.');
  const method = op.method === 'expel' ? 'expel' : 'kill', share = num(op.share, .01, .6, .1), key = String(op.group ?? '').trim().toLowerCase();
  const match = g => !key || g.eth.toLowerCase() === key || g.rel.toLowerCase() === key, hit = groupsOf(p).filter(match);
  if (!hit.length) return fail(`No such people live in ${p.name}.`);
  const who = key ? `${hit[0].eth.toLowerCase() === key ? hit[0].eth : hit[0].rel} people` : 'people', deed = method === 'kill' ? 'killing' : 'expulsion';
  const troops = Object.values(w.units).filter(u => u.country === c.id && u.province === p.id), men = sum(troops, u => u.men), pop = provincePop(p), force = men + pop * c.police / 100 * .01;
  const wanted = pop * sum(hit, g => g.share) * share;
  if (force < pop * .002) return fail(`There is no force in ${p.name} able to carry this out; troops would have to be sent there first.`);
  // Soldiers are asked to turn on civilians. Some armies do it; some refuse, and remember that they were asked.
  const loyalty = men ? sum(troops, u => u.loyalty * u.men) / men : c.police;
  if (rand(w) > clamp(.35 + loyalty / 160 + c.axes.auth / 400 - share * .3, .1, .95)) {
    for (const u of troops) { u.loyalty = clamp(u.loyalty - 12, 0, 100); u.morale = clamp(u.morale - 8, 0, 100); }
    c.blocs.army.sat = clamp(c.blocs.army.sat - 6, 0, 100);
    leaveTrace(w, actor, `Ordered the ${deed} of ${who} in ${p.name}; the officers refused.`);
    news(w, `${c.name}: officers in ${p.name} refused an order to turn on the population.`, { kind: 'atrocity', countries: [c.id], secret: c.pressFreedom < 50 });
    return fail('The officers on the spot refused the order.');
  }
  // A handful of men cannot reach everyone they are sent against.
  const reach = clamp(force * 8 / Math.max(wanted, 1), .15, 1), people = sum(countryProvinces(w, c.id), provincePop) || 1;
  const gone = removePeople(p, match, share * reach), taken = sum(gone, g => g.people), dead = taken * (method === 'kill' ? .9 : .08), fled = taken - dead;
  // The driven-out go where they can: across the nearest border, to kin if there are any, otherwise deeper into the country.
  const abroad = p.neighbors.map(n => w.provinces[n]).filter(n => n.controller !== c.id && w.countries[n.controller]?.alive), inland = p.neighbors.map(n => w.provinces[n]).filter(n => n.controller === c.id);
  for (const g of gone) {
    const kin = abroad.filter(n => w.countries[n.controller].majorityEth === g.eth || w.countries[n.controller].majorityRel === g.rel), to = (kin.length ? kin : abroad.length ? abroad : inland)[0];
    if (!to) continue;
    const moved = g.people * fled / Math.max(taken, 1);
    settlePeople(to, g.eth, g.rel, moved); to.unrest = clamp(to.unrest + moved / Math.max(provincePop(to), 1) * 120, 0, 100);
  }
  p.devastation = clamp(p.devastation + share * reach * .4, 0, 1);
  // Terror empties the streets for a season. It is not forgotten.
  p.unrest = clamp(p.unrest - 25 * reach, 0, 100);
  p.scar = { turn: w.turn, by: c.id, weight: clamp((p.scar?.by === c.id ? p.scar.weight : 0) + taken / Math.max(pop, 1) * 2, 0, 1) };
  for (const u of troops) { u.morale = clamp(u.morale - 5, 0, 100); u.loyalty = clamp(u.loyalty - 3, 0, 100); }
  leaveTrace(w, actor, `Ordered the ${deed} of about ${Math.round(taken)}k ${who} in ${p.name}.`);
  const weight = Math.sqrt(taken / people), known = !op.secret || rand(w) < clamp(.25 + c.pressFreedom / 120 + (fled > 1 ? .35 : 0) + weight, 0, .97);
  const text = method === 'kill' ? `${c.name} forces killed about ${Math.round(dead)}k ${who} in ${p.name}${fled > 1 ? `; ${Math.round(fled)}k fled` : ''}.` : `${c.name} drove about ${Math.round(fled)}k ${who} out of ${p.name}; about ${Math.round(dead)}k died on the roads.`;
  // What was done is on record whether or not it is known: the world's history shows it once it is public.
  (c.atrocities ||= []).push({ turn: w.turn, province: p.id, name: p.name, method, people: Math.round(taken), dead: Math.round(dead), group: key || null, by: actor.id, known, text }); c.atrocities = c.atrocities.slice(-20);
  const kinStates = aliveCountries(w).filter(o => o.id !== c.id && (o.id === p.owner || gone.some(g => o.majorityEth === g.eth || o.majorityRel === g.rel)));
  news(w, text, { kind: 'atrocity', countries: [c.id, ...(known ? kinStates.map(o => o.id) : [])], secret: !known });
  if (known) {
    c.legitimacy = clamp(c.legitimacy - clamp(weight * 60, 1.5, 20) * (.5 + c.pressFreedom / 100), 0, 100);
    // Their own people elsewhere in the country hear of it first.
    for (const q of countryProvinces(w, c.id)) if (q.id !== p.id) { const s = sum(groupsOf(q).filter(g => gone.some(x => x.eth === g.eth && x.rel === g.rel)), g => g.share); if (s > .05) q.unrest = clamp(q.unrest + s * clamp(weight * 200, 5, 40), 0, 100); }
    for (const o of aliveCountries(w)) if (o.id !== c.id) o.relations[c.id] = clampRel((o.relations[c.id] ?? 0) - clamp(weight * 120, 5, 45) - (kinStates.includes(o) ? 30 : 0));
    for (const o of kinStates) {
      tell(w, w.characters[o.leader], 'Refugees and envoys', `${text} They are ${o.id === p.owner ? 'your own subjects under occupation' : 'kin to your people'}.`);
      o.mods.push({ key: 'unrest', delta: 3, turns: 4, label: `Anger over ${p.name}` });
    }
  }
  return { ok: true, msg: `${text}${known ? '' : ' It has not become public.'}${reach < 1 ? ' The force on the spot could not reach everyone it was sent against.' : ''}` };
}

function build(w, c, op) {
  const p = w.provinces[op.province]; if (!p || p.controller !== c.id) return fail('That province is not under your control.');
  // What a work costs the state is more than what it is worth, by what sticks to hands on the way and by how far the capital's eye reaches.
  const waste = w.friction ? 1 + c.corruption / 300 + Math.max(0, .5 - (p.admin ?? .5)) * .6 : 1;
  const gdp = Math.max(c.gdp, 1), share = num(op.pct_gdp, .01, .25, .03), cost = gdp * share * waste, kind = op.kind;
  const needsMachines = has(PLANTS, kind) || kind === 'mine' || kind === 'dam';
  const m = share * 18; if (needsMachines && c.stock.machines < m) return fail('Not enough machinery; import or produce it.');
  const steel = share * 40; if ((kind === 'railway' || kind === 'port' || kind === 'dam') && c.stock.steel < steel) return fail('Not enough steel.');
  if (kind === 'mine' && !(has(p.deposits, op.resource) && p.deposits[op.resource].known)) return fail('No such known deposit here.');
  if (kind === 'railway' && !hasTech(c, 'railway') && p.rail >= 1) return fail('Further railway building requires the technology.');
  if (kind === 'port' && !p.coast) return fail('No coast.');
  if (kind === 'dam' && p.river < .2) return fail('No river for a dam here.');
  if (kind === 'battery' && !p.coast) return fail('Coastal batteries need a coast.');
  if (DEFENSES.includes(kind) && (p[kind] || 0) >= MAX_DEFENSE[kind]) return fail('Already at the highest level.');
  if (!has(PLANTS, kind) && !['mine', 'railway', 'port', 'dam', 'farming', 'infrastructure', 'administration', ...DEFENSES].includes(kind)) return fail('Unknown building type.');
  const works = DEFENSES.includes(kind) ? share * 50 : 0; if (c.stock.steel < works) return fail('Not enough steel.');
  const note = pay(c, cost); if (note === null) return fail(NO_FUNDS);
  if (needsMachines) c.stock.machines -= m; if (['railway', 'port', 'dam'].includes(kind)) c.stock.steel -= steel; c.stock.steel -= works;
  queueProject(w, c, { kind, province: p.id, resource: op.resource, share });
  return { ok: true, msg: `Started, ready in ${durationOf(kind)} quarters.${waste > 1.08 ? ` It costs about ${Math.round((waste - 1) * 100)}% more than the work is worth: graft, and the distance of ${p.name} from the capital's eye.` : ''}${note}` };
}
const ok = () => ({ ok: true, msg: 'Applied.' });
const fail = msg => ({ ok: false, msg });
function applyOrder(w, c, u, to) {
  if (u.province === to) return fail('Already there.'); if (!pathStep(w, u.province, to, c.id)) return fail('No route.');
  // A commander who has lost faith in the government obeys when it suits him.
  const chief = w.characters[u.commander]; if (w.friction && chief?.alive && isMinor(chief) && chief.loyalty < 25 && rand(w) < .4) return fail(`${u.id} did not march: ${chief.name}, who commands it, finds reasons for delay.`);
  u.target = to; return ok();
}
