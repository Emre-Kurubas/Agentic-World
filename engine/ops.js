import { clamp, news, rand, nextId, pick, sum, quarterLabel } from './util.js';
import { CLASSES, GOODS, countryProvinces, atWar, hasTreaty, makeUnit, aliveCountries, clampRel, provincePop, goHome, hasFought } from './world.js';
import { executePlot, neutralize, die, SUCCESSION, distance } from './politics.js';
import { joinUnits, capture, pathStep, roadTo, upkeepCost, PAY_FIRST, settleOccupations, marchQuarters, POSTURES, postureWords, MANNERS, commanderOf, supplyOf, shellsFor, abilityWord, closedNow, season } from './military.js';
import { makeFleet, TECHS, PLANTS, DEPOSITS, GOOD_LABEL, ROLES, spawnCharacter, bfsSea } from './world.js';
import { hasTech, sealOf, importOrder, SPREAD } from './economy.js';
import { FX_REGIMES, foreignRate, externalDebt, creditLeft, declareDefault, treasuryPays } from './money.js';
import { firmOp, seizeFirm, STATE } from './firms.js';
import { queueProject, durationOf, WORKS, quote, ground, projectYield, wasteOf } from './projects.js';
import { LANGUAGE_POLICY, FAITH_POLICY, groupsOf, removePeople, settlePeople, PEOPLE_OPS, peopleOp, hits, armedOf, privilege } from './culture.js';
import { incapacitated } from './health.js';
import { isMinor, recruitInformant, takeOffer, refuseOffer, standing, inService } from './court.js';
import { approach, openTo } from './deeds.js';
import { labourOp } from './labour.js';
import { noteOp } from './notes.js';
import { seatOp } from './seats.js';
import { cameOut, stageIncident, denounce } from './intrigue.js';
import { amnesty } from './justice.js';
import { fundUnderground } from './underground.js';
import { mobilize, demobilize, serviceOf, reserveAt, drillOf } from './frontier.js';
import { prosecute, forge, forgeryFound } from './justice.js';
import { shame, honourOf, aimsMet, aimsText, kindWord, dealsWith, maySign, tieOf, tieWord, stanceOf, seesTreaty, reveal, faithCost, bondSigned, deed, alarm } from './diplomacy.js';
import { STANDING_OPS, standingOp, standingStep } from './standing.js';
import { INQUIRY_OPS, inquiryOp } from './inquiry.js';
import { MEANS_OPS, meansOp } from './means.js';
import { TENDER_OPS, tenderOp, tenderStep } from './tender.js';
import { foundPaper, papersOf, carry, MAX_PAPERS, setPaper, censor, paperWords, keptQuiet, findPaper } from './press.js';
import { buyBonds, sellBonds } from './bonds.js';
import { SHIPS, kindOf, ORDERS, friendlyPort, baseMap, readiness, enemyHolds, seaPath, refuge, bombard as shell, liftOf, LIFT, MERCHANT, FLAG, demonstrate, seizeCustoms } from './navy.js';
import { proposeContract, acceptContract, cancelContract, toStateAccount } from './contracts.js';
import { governmentSeats, institutionRoom, delegated, vetoedBy, makeInstitution, mustPassParliament, createBill, parliamentOpen, makeParliament, leadsParties, enactLaw, normalizeClauses, activateClauses, moneyStops, allocateSeats, clauseText, MAX_AGENCY_BUDGET, governs } from './polity.js';
import { he, He, him, his } from './names.js';

const FIRM_OPS = new Set(['found_company', 'invest_company', 'draw_company', 'sell_company', 'buy_company', 'nationalize_company', 'privatize_company']);
const PERMISSIONS = {
  leader: null,
  general: new Set(['propose_contract', 'accept_contract', 'cancel_contract', 'found_company', 'invest_company', 'sell_company', 'buy_company', 'propose_law', 'withdraw_bill', 'vote_bill', 'lobby_bill', 'appoint_institution', 'publish_dossier', 'lend_private', 'repay_debt', 'forgive_debt', 'gather_dossier', 'blackmail', 'found_party', 'embezzle', 'create_institution', 'start_plot', 'fund_plot', 'invite_plot', 'join_plot', 'betray_plot', 'execute_plot', 'bribe', 'custom', 'propaganda']),
  opposition: new Set(['propose_contract', 'accept_contract', 'cancel_contract', 'found_company', 'invest_company', 'sell_company', 'buy_company', 'propose_law', 'withdraw_bill', 'vote_bill', 'lobby_bill', 'appoint_institution', 'publish_dossier', 'lend_private', 'repay_debt', 'forgive_debt', 'gather_dossier', 'blackmail', 'found_party', 'create_institution', 'start_plot', 'fund_plot', 'invite_plot', 'join_plot', 'betray_plot', 'execute_plot', 'bribe', 'custom', 'propaganda']),
  oligarch: new Set(['propose_contract', 'accept_contract', 'cancel_contract', 'found_company', 'invest_company', 'sell_company', 'buy_company', 'propose_law', 'withdraw_bill', 'vote_bill', 'lobby_bill', 'appoint_institution', 'publish_dossier', 'repay_debt', 'forgive_debt', 'gather_dossier', 'blackmail', 'found_party', 'lend_private', 'embezzle', 'create_institution', 'start_plot', 'invite_plot', 'join_plot', 'betray_plot', 'execute_plot', 'bribe', 'custom', 'propaganda', 'capital_flight', 'invest', 'fund_plot'])
};
// What no newspaper prints, whatever the referee thinks of it: orders to troops and squadrons, the staff's plans, the secret service's work, money
// under the table, plots, private bargains, and anything done under a treaty that is itself secret. In world 12 the papers of the world carried 889
// of 2459 rulings, among them one attack order in three and a third of all standing orders; in world 13 they carried a secret alliance, and two
// governments hunted for a traitor who was the printing press. A ruling is printed only if nothing in it is of this kind (printable).
export const QUIET = new Set(['move', 'move_army', 'move_fleet', 'merge_units', 'merge_fleets', 'offensive', 'set_posture', 'fleet_orders', 'amphibious', 'lay_mines', 'prepare_plan', 'leak_plan',
  'spy', 'steal_tech', 'gather_dossier', 'forge_dossier', 'recruit_informant', 'bribe', 'blackmail', 'embezzle', 'capital_flight', 'repatriate', 'fund_underground', 'fund_plot', 'rig_election', 'lobby_bill',
  'start_plot', 'invite_plot', 'join_plot', 'betray_plot', 'execute_plot', 'accept_offer', 'decline_offer', 'propose_contract', 'accept_contract', 'cancel_contract', 'give', 'lend_private', 'repay_debt', 'forgive_debt',
  'buy_bonds', 'sell_bonds', 'designate_successor', 'back_claim', 'draw_company', 'draw_institution', 'noop',
  // What an owner tells his editor is said in the editor's room.
  'set_paper']);
const secretPaper = (w, op) => op?.secret === true || [op?.treaty, op?.id].some(id => id && w.treaties.some(t => t.id === id && t.secret));
// Money for a party or a paper at home is given in the open; sent across a frontier it is not.
const abroad = op => ['fund_party', 'fund_paper'].includes(op?.op) && !!op?.target;
export const printable = (w, ops) => !(ops || []).some(op => QUIET.has(op?.op) || secretPaper(w, op) || abroad(op));
// What anyone may do whatever their office: deal, lend, scheme, speak.
const LABOUR_OPS = new Set(['set_wages', 'set_safety', 'lockout', 'agitate', 'arbitrate_strike', 'break_strike']);
const PRIVATE = ['capital_flight', 'repatriate', 'draw_institution', 'buy_bonds', 'sell_bonds', 'back_claim', 'renounce_claim', 'fund_party', 'found_paper', 'fund_paper', 'close_paper', 'forge_dossier', 'no_confidence', 'coalition', 'fund_underground', 'set_wages', 'set_safety', 'lockout', 'agitate', 'recruit_informant', 'accept_offer', 'decline_offer', 'pay_state', 'give', 'draw_company', 'fund_institution', 'dissolve_institution', 'propose_contract', 'accept_contract', 'cancel_contract', 'found_company', 'invest_company', 'sell_company', 'buy_company', 'publish_dossier', 'lend_private', 'repay_debt', 'forgive_debt', 'gather_dossier', 'blackmail', 'found_party', 'start_plot', 'invite_plot', 'join_plot', 'betray_plot', 'execute_plot', 'fund_plot', 'bribe', 'custom', 'propaganda', 'noop'];
// What the people around the seats can be made to do, what a note of hand is worth, and what a seat decides for itself: open to anyone at liberty.
const NOTE_OPS = new Set(['buy_debt', 'sell_debt', 'ask_terms', 'borrow_private', 'extend_debt', 'call_debt']);
const SEAT_OPS = new Set(['lead_rising', 'resign', 'go_abroad', 'return_home', 'name_deputy', 'retire']);
// A watch, an order that waits for its day: open to every seat and to private people (each within what its own hands reach); leaving a power in
// another's hands is the ruler's alone.
const OPEN_STANDING = ['watch', 'standing_order', 'cancel_order', 'inquire', 'relief', 'set_dues', 'destroy_evidence', 'watch_polls', 'petition_release', 'bid'];
QUIET.add('bid').add('award_tender');
QUIET.add('destroy_evidence');
QUIET.add('inquire').add('inspect');
PRIVATE.push('denounce'); PERMISSIONS.general.add('stage_incident'); for (const seat of ['general', 'opposition', 'oligarch']) PERMISSIONS[seat].add('denounce');
QUIET.add('denounce').add('stage_incident').add('turn_informant');
const OWN = ['set_paper', 'incite', ...NOTE_OPS, ...SEAT_OPS];
QUIET.add('lead_rising').add('name_deputy');
for (const op of NOTE_OPS) QUIET.add(op);
PRIVATE.push(...OWN, ...OPEN_STANDING);
// (Named here, not read from the module that carries them out: that module is still loading when this line runs if it was loaded first.)
for (const op of ['watch', 'delegate', 'standing_order', 'cancel_order']) QUIET.add(op);
PERMISSIONS.private = new Set(PRIVATE);
for (const seat of ['general', 'opposition', 'oligarch']) for (const op of [...OWN, ...OPEN_STANDING]) PERMISSIONS[seat].add(op);
// The chief of staff also says who is paid first when the vote is short and how much of the arsenal an attack may not touch.
for (const op of ['set_pay_priority', 'set_arsenal_reserve']) { PERMISSIONS.general.add(op); QUIET.add(op); }
PERMISSIONS.general.add('post_person'); PERMISSIONS.general.add('tender'); PERMISSIONS.general.add('equip'); QUIET.add('equip');
// The chief of staff directs where the army's units and squadrons stand and who commands them. Raising and disbanding troops, war and peace stay with the ruler.
for (const op of ['move', 'move_army', 'move_fleet', 'merge_units', 'merge_fleets', 'appoint_commander', 'spy', 'build', 'set_posture', 'amphibious', 'offensive', 'fleet_orders', 'bombard', 'lay_mines', 'prepare_plan', 'leak_plan']) PERMISSIONS.general.add(op);
for (const seat of ['general', 'opposition', 'oligarch']) for (const op of ['capital_flight', 'repatriate', 'draw_institution', 'buy_bonds', 'sell_bonds', 'back_claim', 'renounce_claim', 'fund_party', 'found_paper', 'fund_paper', 'close_paper', 'forge_dossier', 'no_confidence', 'coalition', 'fund_underground', 'set_wages', 'set_safety', 'lockout', 'agitate', 'recruit_informant', 'accept_offer', 'decline_offer', 'noop', 'pay_state', 'give', 'draw_company', 'fund_institution', 'dissolve_institution']) PERMISSIONS[seat].add(op);
PERMISSIONS.exiled = new Set(PRIVATE.filter(x => !['found_party', 'execute_plot', 'gather_dossier'].includes(x)));
for (const k of ['general', 'opposition', 'oligarch', 'private', 'exiled']) PERMISSIONS[k].add('publish_treaty');
PERMISSIONS.imprisoned = new Set(['accept_contract', 'cancel_contract', 'repay_debt', 'forgive_debt', 'join_plot', 'betray_plot', 'bribe', 'custom', 'noop', 'retire']);
// A prisoner has little left to trade but what he knows of others.
PERMISSIONS.imprisoned.add('denounce');
// And may ask the court to let him out.
PERMISSIONS.imprisoned.add('petition_release');
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
// A commission: officers of both states sit over what happened on the frontier, for two years unless a term is named. While it sits, patrols
// fire less readily and what each country holds against the other for the dead is being answered.
const TREATY = ['alliance', 'nonaggression', 'trade', 'military_access', 'peace', 'protection', 'armistice', 'commission'];
// A state under another's protection has signed away its own wars and alliances for as long as the treaty stands.
const protectorOf = (w, c) => { const t = w.treaties.find(x => x.active && x.kind === 'protection' && x.parties.includes(c.id) && x.protector !== c.id); return t ? w.countries[t.protector] : null; };
const LAW_TITLE = { nationalize_company: 'Company nationalization', set_tax: 'Tax regulation', set_budget: 'Budget amendment', set_tariff: 'Customs tariff', set_import: 'Import regulation', set_export: 'Export regulation', borrow: 'Borrowing authority', declare_war: 'Declaration of war', ban_party: 'Party ban', land_reform: 'Land reform', nationalize: 'Nationalization', privatize: 'Privatization' };

const num = (v, a, b, d = a) => clamp(Number.isFinite(Number(v)) ? Number(v) : d, a, b);
// How much of an order the state's offices carry out at once. A bare test world has none of this friction.
const reach = (w, c) => w.friction ? clamp(.3 + c.bureaucracy / 100, .35, 1) : 1;
const pc = v => `${Math.round(v * 1000) / 10}%`;
// Land that changes hands is remembered by the state that lost it. Winning back what was lost is the kind of success a people does not forget either.
// Only land taken by force is a wound: a province sold or exchanged by agreement leaves no claim behind. And a recovery counts for what the loss
// had come to mean, a point of standing for each year the land was gone, up to five, so that handing a province to and fro earns nothing.
function handOver(w, p, from, to, forced) {
  if (from === to) return;
  const year = 1900 + Math.floor(w.turn / 4), taker = w.countries[to];
  if (p.lostBy === to) {
    const gone = year - (p.lostIn ?? year), gain = clamp(gone, 0, 5); delete p.lostBy; delete p.lostIn;
    if (taker?.alive && gain >= 1) { taker.legitimacy = clamp(taker.legitimacy + gain, 0, 100); news(w, `${taker.name} has recovered ${p.name}, lost ${gone} years ago.`, { kind: 'diplomacy', countries: [to, from], province: p.id }); }
    return;
  }
  if (forced) { p.lostBy = from; p.lostIn = year; } else if (p.lostBy === from) { delete p.lostBy; delete p.lostIn; }
}
export const claimsOf = (w, id) => Object.values(w.provinces).filter(p => p.lostBy === id && p.owner !== id);
const menText = men => men < 1 ? `${Math.round(men * 1000)} men` : `${Math.round(men * 10) / 10} thousand men`;
const alive = (w, id) => { const c = w.countries[id]; return c?.alive ? c : null; };
// A character's real traces that can be found: dossiers are made of these.
const leaveTrace = (w, ch, text) => { (ch.secrets ||= []).push({ turn: w.turn, text }); ch.secrets = ch.secrets.slice(-12); };
const tell = (w, ch, from, text) => { if (ch?.alive) ch.inbox.push({ turn: w.turn, from, text }); };
// Orders that need ships on station (a landing, a bombardment, mines off an enemy's coast, a demonstration, the seizure of a customs house) may be
// given in the quarter the ships sail: a quarter is three months and the crossing a few days. The order then waits for the squadrons to move and is
// carried out, or not, when they have (carryAwaited, called from the military step once the fleets have sailed and fought); whoever gave it is told
// what came of it and why. It is the engine that says whether the way was open, not a roll of the referee's dice. Given again, an order replaces itself.
// What a bill says, in words, for the members who must vote on it.
const billWords = op => Object.entries(op).filter(([k, v]) => k !== 'op' && !k.startsWith('_') && v != null && v !== '').map(([k, v]) => `${k.replace(/_/g, ' ')} ${typeof v === 'number' ? (v > 0 && v < 1 ? `${Math.round(v * 1000) / 10}%` : Math.round(v * 100) / 100) : typeof v === 'object' ? JSON.stringify(v).replace(/[{}"]/g, '').replace(/,/g, ', ') : String(v)}`).join('; ').slice(0, 300) || 'as moved';
const WAITED = { amphibious: 'landing', bombard: 'bombardment', lay_mines: 'laying of mines', demonstrate: 'naval demonstration', seize_customs: 'seizure of the customs' };
function standBy(w, actor, op, key, msg) {
  const q = (w.awaiting ||= []), at = q.findIndex(x => x.key === key && x.actor === actor.id), entry = { turn: w.turn, actor: actor.id, key, op: { ...op } };
  if (at >= 0) q[at] = { ...entry, then: q[at].then, else: q[at].else }; else q.push(entry);
  return { ok: true, waits: key, msg };
}
const underOrders = (w, id, seas) => Object.values(w.fleets).filter(f => f.country === id && kindOf(f) !== 'submarine' && (seas.includes(f.target) || (!f.port && seas.includes(f.sea)) || w.provinces[f.target]?.seas?.some(s => seas.includes(s))));
const squadronWord = (w, id, seas) => { const fs = underOrders(w, id, seas); return fs.length ? `${fs.map(f => f.id).join(', ')} ${fs.length === 1 ? 'is' : 'are'} under orders for that water` : 'no squadron of ours is under orders for that water yet: one has to be sent there this quarter (move_fleet), or nothing comes of this'; };
export function carryAwaited(w) {
  for (const a of (w.awaiting || []).splice(0)) {
    const ch = w.characters[a.actor], c = ch && w.countries[ch.country]; if (!ch?.alive || !c?.alive) continue;
    const r = applyOp(w, ch, { ...a.op, _late: true }), what = WAITED[a.op.op] ?? a.op.op, more = (r.ok ? a.then : a.else) || [];
    const said = more.map(op => { const x = applyOp(w, ch, op); return `${op.op}${x.ok ? '' : ' was NOT carried out'}: ${x.msg}`; });
    const text = `The ${what} ordered this quarter was ${r.ok ? '' : 'NOT '}carried out: ${r.msg}${said.length ? ` What was ordered ${r.ok ? 'to follow it' : 'in its place'}: ${said.join(' ')}` : ''}`;
    for (const x of new Set([ch, w.characters[c.leader], w.characters[c.general]])) tell(w, x, 'Naval Staff', text);
    (w.awaited ||= []).push({ turn: w.turn, actor: ch.id, country: c.id, op: a.op, ok: !!r.ok, text });
  }
}
// Orders that hang on a place being taken ("take Brunmarka; if it falls, go on against Hazburga"; "once it is ours the reserve follows and holds
// it"). An attack is ordered in one quarter and decided by the fighting of that quarter or a later one, so what is to follow it cannot be carried out
// on the day the order is given: it waits (w.hanging) until the place is in the hands of whoever ordered it, and is then ordered in his name; what
// was ordered for the case that the attack fails is ordered once no attack of his country's on the place is in hand any more. The staff reports
// which it was. Given again in a later quarter, what hangs on a place replaces what hung on it; nothing multiplies. (World 15, the fourth quarter:
// "B71 and the cavalry take Brunmarka; if it falls B71 goes on against Hazburga" was carried out as two attack orders to the same unit on the same
// day, the second replacing the first, so that the army went against Hazburga and Brunmarka was left to five thousand horsemen.)
// A place may come into a country's hands without an attack: a province of its own that the enemy holds comes back with a peace, and a treaty on
// the table may name a province to be given to it.
const promised = (w, c, p) => p.owner === c.id || (w.treaties || []).some(t => t.pending && (t.parties || t.invited || []).includes(c.id) && (t.multi ? (t.grants || []).some(g => g.province === p.id && g.to === c.id) : (t.cede || []).includes(p.id) && p.owner !== c.id));
const inHand = (w, c, p) => p.siege?.by === c.id || Object.values(w.units).some(u => u.country === c.id && (u.attack?.to === p.id || u.target === p.id || u.province === p.id));
export function hangOn(w, actor, pid, side, node) {
  const q = (w.hanging ||= []);
  for (let i = q.length - 1; i >= 0; i--) if (q[i].actor === actor.id && q[i].province === pid && q[i].turn < w.turn) q.splice(i, 1);
  let h = q.find(x => x.actor === actor.id && x.province === pid); if (!h) q.push(h = { turn: w.turn, actor: actor.id, country: actor.country, province: pid, then: [], else: [] });
  const same = JSON.stringify(node.op), was = h[side].find(x => JSON.stringify(x.op) === same); if (was) return was;
  h[side].push(node); return node;
}
// An order that names the place it waits for (once_taken): carried out at once if the place is ours already, refused if nothing of ours is on its way
// against it, and otherwise kept until it falls. Returns null where the order is simply to be carried out now.
export function onceTaken(w, actor, pid, op) {
  const c = w.countries[actor.country], p = w.provinces[pid]; if (!p) return { ok: false, msg: `No such province to wait for: ${pid}.` };
  if (p.controller === c?.id) return null;
  const attack = atWar(w, c.id, p.controller) && inHand(w, c, p), due = promised(w, c, p);
  if (!attack && !due) return { ok: false, msg: atWar(w, c.id, p.controller) ? `No attack of ours on ${p.name} is in hand and no treaty on the table gives it to us, so there is nothing for this order to wait on: order the attack first (offensive, or a move against it), or propose the treaty, and then what is to follow.` : `${p.name} is held by ${cname(w, p.controller)}, with whom there is no war, and no treaty on the table gives it to us: there is nothing for this order to wait on.` };
  const node = hangOn(w, actor, p.id, 'then', { op, then: [], else: [], any: true });
  return { ok: true, waits: `take:${p.id}`, node, msg: attack ? `${op.op} waits for ${p.name} to fall: it is ordered once the place is in our hands, and lapses if the attack on it is beaten off or given up${due ? ' and no treaty brings it back' : ''}. The staff reports which.` : `${op.op} waits for ${p.name} to come back into our hands${p.owner === c.id ? ', by a peace or by arms' : ' by the treaty proposed'}: it is ordered on that day. The staff reports it.` };
}
// A list of operations given together: those of one ruling, or of a standing order whose day has come. One of them may hang on the engine's answer
// to an earlier one: if_done n is carried out only if operation n was, if_refused n only if the engine refused it. Where the earlier one waits
// (on ships still at sea, on the vote of the house), what hangs on it waits with it; what hangs on an attack waits for the place to fall or for
// the attack to fail (hangOn, carryTaken); and an operation may name the place it waits for itself (once_taken). each carries one plain operation.
// (World 17: a standing order carried every part of its list at once, so that "attack Dundale; once it falls dig in; if it fails fall back" told
// the columns to attack, to dig in and to go home on the same morning, and the order to dig in cancelled the attack.)
export function carryList(w, ch, ops, each) {
  const results = [], nodes = [], run = each ?? (plain => applyOp(w, ch, plain)), placeName = id => w.provinces[id]?.name ?? id;
  (ops || []).forEach((op, i) => {
    const { if_done, if_refused, once_taken, ...plain } = op ?? {}, hang = Number.isInteger(if_done) ? 'done' : Number.isInteger(if_refused) ? 'refused' : null, n = hang === 'done' ? if_done : if_refused, on = hang && n >= 0 && n < i ? results[n] : null;
    if (on?.waits) {
      const a = (w.awaiting || []).find(x => x.key === on.waits && x.actor === ch.id);
      if (a) { (a[hang === 'done' ? 'then' : 'else'] ||= []).push(plain); results.push({ op: op.op, ok: true, waits: on.waits, msg: `${op.op} waits with ${ops[n].op}: it is carried out this quarter only if that ${hang === 'done' ? 'is carried out' : 'cannot be'}, and the staff reports which.` }); return; }
      // What hangs on an order that waits for the vote of the house waits for the vote with it, and hangs on it still when the day comes.
      const so = on.so ? (w.standingOrders || []).find(x => x.id === on.so) : null;
      if (so) { const dep = { ...plain, [hang === 'done' ? 'if_done' : 'if_refused']: on.at }, same = JSON.stringify(dep); let at = so.then.findIndex(o => JSON.stringify(o) === same); if (at < 0 && so.then.length < 16) at = so.then.push(dep) - 1;
        results.push(at < 0 ? { op: op.op, ok: false, msg: `${op.op} could not be added to what waits on the vote: too many orders wait on it already.` } : { op: op.op, ok: true, waits: on.waits, so: so.id, at, msg: `${op.op} waits with ${ops[n].op} for the vote of the house: it is ordered only ${hang === 'done' ? 'once that has been carried out' : 'if that cannot be'}.` }); return; }
    }
    const side = hang === 'refused' ? 'else' : 'then', place = on?.takes && on.ok !== false && !on.skipped ? on.takes : null;
    if (once_taken != null && once_taken !== '') {
      const r = onceTaken(w, ch, String(once_taken), plain);
      if (r) { const { node, ...told } = r; if (node) nodes[i] = node; results.push({ op: op.op, ...told }); return; }
    } else if (hang && nodes[n]) {
      const node = { op: plain, then: [], else: [] }; nodes[n][side].push(node); nodes[i] = node;
      results.push({ op: op.op, ok: true, waits: results[n].waits, msg: `${op.op} waits with ${ops[n].op}: it is ordered only ${hang === 'done' ? 'once that has been carried out' : 'if that cannot be'}, and the staff reports which.` }); return;
    } else if (place) {
      nodes[i] = hangOn(w, ch, place, side, { op: plain, then: [], else: [] });
      results.push({ op: op.op, ok: true, waits: `take:${place}`, msg: hang === 'done' ? `${op.op} waits for ${placeName(place)} to fall: it is ordered once the place is in our hands, not before, and lapses if the attack on it is beaten off or given up. The staff reports which.` : `${op.op} is held back for the case that the attack on ${placeName(place)} fails or is given up: it is ordered then, and lapses if the place falls. The staff reports which.` }); return;
    }
    if (on && (hang === 'done' ? on.ok === false || on.skipped : on.ok !== false || on.skipped)) { results.push({ op: op.op, ok: true, skipped: true, msg: `${op.op} was not attempted: it was ordered only in case ${ops[n].op} ${hang === 'done' ? 'was carried out, and it was not' : 'was refused, and it was not'}.` }); return; }
    let r; try { r = run(plain, op, i); } catch (e) { r = { ok: false, msg: `Error: ${e.message}` }; }
    results.push({ op: op.op, ...r });
  });
  return results;
}
// An attack ordered while the declaration of war is still before the house. In a state whose house holds the power of war the declaration is a
// bill, voted when the quarter is out; the order to attack, to land or to shell given the same morning is not refused but kept, and goes out in
// the name of whoever gave it on the day the bill passes. It lapses if the house refuses the war or the government withdraws the bill.
// (World 17: three of six declarations went to a house, and each time the attack ordered with it was turned back with "there is no war".)
const WAR_ACTS = new Set(['offensive', 'amphibious', 'bombard', 'move', 'lay_mines']);
const warBill = (c, foe) => (c.bills || []).find(b => b.status === 'pending' && (b.ops || []).some(o => o?.op === 'declare_war' && o.target === foe));
function foeOf(w, c, op) {
  const pid = op.op === 'bombard' ? op.province : op.op === 'lay_mines' ? null : op.to, p = pid && Object.hasOwn(w.provinces, pid) ? w.provinces[pid] : null;
  if (op.op === 'offensive' && op.cancel === true) return null;
  return p && p.controller && p.controller !== c.id && !atWar(w, c.id, p.controller) && !hasTreaty(w, c.id, p.controller, 'military_access') && !hasTreaty(w, c.id, p.controller, 'alliance') ? p.controller : null;
}
function awaitVote(w, actor, c, op, bill, foe) {
  const list = (w.standingOrders ||= []), name = w.countries[foe]?.name ?? foe; let so = list.find(x => x.by === actor.id && x.vote === bill.id);
  if (!so) list.push(so = { id: nextId(w, 'SO'), by: actor.id, country: c.id, when: { bill: bill.id, state: 'passed' }, words: `the day bill ${bill.id} is passed`, then: [], label: `Waits on the vote of the house on war with ${name}`, since: w.turn, vote: bill.id });
  const { _law, _decree, _late, ...plain } = op, who = o => JSON.stringify([o.op, o.unit ?? o.units ?? o.fleet ?? null, o.to ?? o.province ?? o.sea ?? null]), key = who(plain);
  // Given again, an order replaces itself: nothing multiplies.
  let at = so.then.findIndex(o => !Number.isInteger(o.if_done) && !Number.isInteger(o.if_refused) && who(o) === key); if (at >= 0) so.then[at] = plain; else { if (so.then.length >= 16) return fail('Too many orders wait on that vote already.'); at = so.then.push(plain) - 1; }
  return { ok: true, waits: `vote:${bill.id}`, so: so.id, at, msg: `The declaration of war on ${name} is before the house as bill ${bill.id}, and the house votes when this quarter is out: until it passes there is no war. This order waits for the vote: it goes out in your name the day the bill passes, and lapses if the house refuses the war or the bill is withdrawn (it is kept as order ${so.id}; cancel_order withdraws it).` };
}
function carryNode(w, ch, node, fresh) {
  const r = applyOp(w, ch, { ...node.op, _late: true }), line = `${node.op.op}${r.ok ? '' : ' was NOT carried out'}: ${r.msg}`, more = (node.then?.length || 0) + (node.else?.length || 0);
  // What hangs on an attack that was itself waiting now waits for that attack in its turn.
  if (r.ok && r.takes && more) { fresh.push({ turn: w.turn, actor: ch.id, country: ch.country, province: r.takes, then: node.then || [], else: node.else || [] }); return [line]; }
  return [line, ...((r.ok ? node.then : node.else) || []).flatMap(n => carryNode(w, ch, n, fresh))];
}
// Orders that were waiting for their day are given once every government's orders of the quarter are in, and before the world moves.
export function carryStanding(w) { standingStep(w, applyOp, carryList); tenderStep(w); }
// And once more when the quarter has been played: an order that waited for something the quarter brought (a vote of the house, a war, troops on a
// frontier) is given the same quarter and not a quarter late, and its owner wakes to what came of it and not to an order still "waiting".
export function carryStandingLate(w) { standingStep(w, applyOp, carryList); }
export function carrySigned(w) {
  for (const a of (w.signing || []).splice(0)) {
    const ch = w.characters[a.actor], c = ch && w.countries[ch.country], o = w.countries[a.target]; if (!ch?.alive || !c?.alive || !o) continue;
    const r = applyOp(w, ch, { op: 'accept_treaty', target: o.id, _late: true });
    const text = r.ok ? `The proposal of ${o.name} arrived, and it was signed as you had ordered. ${r.msg}` : `Nothing was signed with ${o.name} this quarter: ${/^No proposal|^Which proposal/.test(r.msg) ? `no single proposal of theirs reached us (${r.msg})` : r.msg} The order to sign does not stand over: it has to be given again when their paper is on the table.`;
    for (const x of new Set([ch, w.characters[c.leader]])) tell(w, x, 'Foreign Ministry', text);
    (w.awaited ||= []).push({ turn: w.turn, actor: ch.id, country: c.id, op: { op: 'accept_treaty', target: o.id }, ok: !!r.ok, text });
  }
}
export function carryTaken(w) {
  const keep = [], fresh = [];
  for (const h of (w.hanging || [])) {
    const ch = w.characters[h.actor], c = ch && w.countries[ch.country], p = w.provinces[h.province]; if (!ch?.alive || !c?.alive || c.id !== h.country || !p) continue;
    const ours = p.controller === c.id, foe = !ours && atWar(w, c.id, p.controller), young = w.turn - h.turn <= 12;
    if (foe && inHand(w, c, p) && young) { keep.push(h); continue; }
    // With no attack in hand, what was ordered for the place however it comes (once_taken) still waits while a peace or a treaty may bring it.
    const stay = !ours && young && promised(w, c, p) ? h.then.filter(n => n.any) : []; if (stay.length) keep.push({ ...h, then: stay, else: [] });
    const said = (ours ? h.then : foe ? h.else : []).flatMap(n => carryNode(w, ch, n, fresh)), lost = (ours ? h.else : foe ? h.then : [...h.then, ...h.else]).filter(n => !stay.includes(n)).map(n => n.op.op);
    if (!said.length && !lost.length) continue;
    const head = ours ? `${p.name} is in our hands.` : foe ? `The attack on ${p.name} did not carry the place, and no attack of ours on it is in hand any more.` : `${p.name} is no longer the enemy's to take (${cname(w, p.controller)} holds it).`;
    const text = `${head}${said.length ? ` What was ordered ${ours ? 'to follow its capture' : 'for that case'}: ${said.join(' ')}` : ''}${lost.length ? ` What was ordered ${ours ? 'for the case that the attack failed' : foe ? 'to follow its capture' : 'to hang on it'} lapses (${lost.join(', ')}).` : ''}`;
    for (const x of new Set([ch, w.characters[c.leader], w.characters[c.general]])) tell(w, x, 'General Staff', text);
    (w.awaited ||= []).push({ turn: w.turn, actor: ch.id, country: c.id, op: { op: 'follow', province: p.id }, ok: ours, text });
  }
  w.hanging = [...keep, ...fresh];
}
const openDebt = (w, id) => (w.debts || []).find(d => d.id === id && ['open', 'overdue'].includes(d.status));
const NO_FUNDS = 'The treasury is empty and lenders will not cover it.';
// A bench asked the same thing twice in a quarter gives the same answer twice: an order struck down is not carried by being signed again.
function courtBlocks(w, c, key, chance) {
  const book = c._court?.turn === w.turn ? c._court : (c._court = { turn: w.turn, said: {} });
  if (!(key in book.said)) { book.said[key] = rand(w) < chance; return book.said[key] ? 'now' : ''; }
  return book.said[key] ? 'again' : '';
}
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
  for (const u of Object.values(w.units)) ids.add(u.commander); for (const f of Object.values(w.fleets)) ids.add(f.commander); for (const p of Object.values(w.provinces)) ids.add(p.governor);
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
function pay(c, cost, what = 'other') {
  if (!(cost > 0)) return '';
  // The treasury's working balance is the last money spent: first the cash above it, then lenders, and only then the till itself.
  const cash = Math.min(Math.max(c.treasury - (c.till || 0), 0), cost), loan = Math.min(cost - cash, Math.max(creditLeft(c), 0)), last = cost - cash - loan;
  if (last > Math.max(c.treasury - cash, 0) + 1e-9) return null;
  c.treasury -= cash + last; c.debt += loan; c._loans = (c._loans || 0) + loan; c._taken = (c._taken || 0) + loan;
  // What leaves the treasury outside the budget is kept by kind, so that the quarter's books can say where the money went.
  (c._outlay ||= {})[what] = (c._outlay[what] || 0) + cost;
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
    if (annex) { const from = p.owner; p.owner = p.controller; p.admin = Math.min(p.admin ?? .5, .3); handOver(w, p, from, p.owner, true); } else p.controller = p.owner;
    delete p.siege;
  }
  // An armistice between the two is swallowed by the peace, and the men each side took prisoner go home: back to their provinces and onto the reserve roll.
  for (const t of w.treaties) if (t.active && t.kind === 'armistice' && t.parties.includes(a) && t.parties.includes(b)) t.active = false;
  for (const [holder, home] of [[a, b], [b, a]]) {
    const h = w.countries[holder], c = w.countries[home], n = h?.captives?.[home] || 0; if (!(n > 0)) continue; delete h.captives[home]; if (!c?.alive) continue;
    const provs = Object.values(w.provinces).filter(p => p.owner === home && p.controller === home), pop = sum(provs, provincePop) || 1; goHome(provs, n); c.reserve = (c.reserve || 0) + n;
    news(w, `About ${n < 1 ? `${Math.max(1, Math.round(n * 10)) * 100}` : `${Math.round(n)} thousand`} prisoners of war held by ${h.name} have gone home to ${c.name}.`, { kind: 'war', countries: [holder, home] });
  }
  settleOccupations(w);
}

// ---- Foreign affairs: what several states sign together, what is done short of war, what a war is for ----
const cname = (w, id) => w.countries[id]?.name ?? id;
// What a treaty does to the land the day it is signed, in the engine's own terms: the provinces it names change hands, and in a peace every other
// province one party holds of another's goes back to its owner (or stays where it is, if the treaty says each keeps what it holds). The words of a
// treaty are the parties' own; this is what will actually happen, and whoever offers, receives or signs it is told so by name.
// What a government pays at home, beyond the people lost, for land it signs away without a battle fought for it; and what the army thinks of it.
export const UNFOUGHT = { standing: 8, army: 12, loyalty: 8, morale: 6 };
export function settlementText(w, t) {
  if (!t) return ''; const name = pid => `${w.provinces[pid]?.name} (${pid})`, out = [];
  const cede = (t.cede || []).map(x => x && typeof x === 'object' ? x : { province: x }).filter(x => w.provinces[x.province]);
  if (cede.length && w.dearLand) { const soft = [...new Set(cede.map(x => { const p = w.provinces[x.province], to = x.to ?? t.parties.find(id => id !== p.owner); return hasFought(w, p.owner, to) ? null : p.owner; }).filter(Boolean))].filter(id => !cede.some(x => (x.to ?? t.parties.find(y => y !== w.provinces[x.province].owner)) === id)); if (soft.length) out.push(`${soft.map(id => cname(w, id)).join(' and ')} ${soft.length > 1 ? 'have' : 'has'} fought no battle for this land: a government that signs land away so pays for it at home, beyond the people it loses, with about ${UNFOUGHT.standing} of its standing and with the army's trust.`); }
  if (cede.length) out.push(`On signing these provinces change hands: ${cede.map(x => { const p = w.provinces[x.province], to = x.to ?? t.parties.find(id => id !== p.owner); return `${name(x.province)} from ${cname(w, p.owner)} to ${cname(w, to)}`; }).join('; ')}.`);
  if (t.kind === 'peace') {
    const held = Object.values(w.provinces).filter(p => t.parties.includes(p.owner) && t.parties.includes(p.controller) && p.owner !== p.controller && !cede.some(x => x.province === p.id));
    if (held.length) out.push(t.annex ? `Each side keeps the land it now holds: ${held.map(p => `${name(p.id)} stays with ${cname(w, p.controller)}`).join('; ')}.` : `Every other province held by one of them and belonging to the other goes back to its owner the day the peace is signed: ${held.map(p => `${name(p.id)}, now held by ${cname(w, p.controller)}, back to ${cname(w, p.owner)}`).join('; ')}.`);
    else if (!cede.length) out.push('No land changes hands.');
  }
  return out.join(' ');
}
const recognisesText = (w, c, o) => o.recognition && !o.recognition.includes(c.id) ? `${o.name} is not recognised by this state: nothing is signed with it until it is (recognise).` : `${o.name} does not recognise this state.`;
const ownedPeople = (w, id) => sum(Object.values(w.provinces).filter(p => p.owner === id), provincePop);
const warsBetween = (w, a, b) => w.wars.filter(x => x.active && ((x.a.includes(a) && x.b.includes(b)) || (x.b.includes(a) && x.a.includes(b))));
// A peace with the mother country is its recognition of the state that broke away from it.
function peaceRecognises(w, x, y) { for (const [m, n] of [[x, y], [y, x]]) if (n.recognition && n.bornOf === m.id && !n.recognition.includes(m.id)) { n.recognition.push(m.id); news(w, `${m.name} has made peace with ${n.name} and so recognises it as a state.`, { kind: 'diplomacy', countries: [m.id, n.id] }); } }
// What a peace delivers of what the war was declared for is weighed at home the day it is signed: a peace that brings what was promised is a
// war won, one that gives most of it up is a war lost whatever the map says, and the more the war has cost the harder that is taken.
function weighAims(w, x, y, fought, paid) {
  const aim = fought.map(war => war.aims?.[x.id]).find(a => a && a.against === y.id); if (!aim) return '';
  const met = aimsMet(w, x, aim, y, paid), what = aimsText(w, aim);
  if (met >= .99) { x.legitimacy = clamp(x.legitimacy + 3, 0, 100); tell(w, w.characters[x.leader], 'The capital', `The peace with ${y.name} gives the country what the war was declared for (${what}). It is taken as a war won.`); return ` The peace brings what the war was declared for (${what}): it is taken at home as a war won.`; }
  const cost = met < .5 ? clamp(2 + (x.warExhaustion || 0) * .08, 2, 9) * (1 - met) : 1;
  x.legitimacy = clamp(x.legitimacy - cost, 0, 100); if (met < .5) x.blocs.army.sat = clamp(x.blocs.army.sat - 4, 0, 100);
  tell(w, w.characters[x.leader], 'The capital', `The peace with ${y.name} gives the country ${met < .05 ? 'nothing' : `about ${Math.round(met * 100)}%`} of what the war was declared for (${what}). ${met < .5 ? 'It is being asked what the dead died for.' : 'It is less than was promised, and that is noticed.'}`);
  return ` The peace brings ${met < .05 ? 'nothing' : `about ${Math.round(met * 100)}%`} of what the war was declared for (${what}); at home the government's standing fell by about ${Math.round(cost)} for it.`;
}
// A declaration may say what the war is for. Aims that are named and limited are easier to follow at home and frighten bystanders less than a
// war nobody can see the end of; a demand for the enemy ruler's head rallies the enemy to him and alarms every other government.
// What a government says a war is for, read from the order: only what the engine can later measure counts as an aim.
function readAims(w, target, op) {
  const raw = op.aims && typeof op.aims === 'object' ? op.aims : null;
  const aim = raw ? { against: target.id, provinces: [...new Set(Array.isArray(raw.provinces) ? raw.provinces : [])].filter(pid => w.provinces[pid] && [w.provinces[pid].owner, w.provinces[pid].controller].includes(target.id)).slice(0, 24), reparations: num(raw.reparations, 0, .3, 0), regime: raw.regime === true, treaty: w.treaties.some(t => t.id === raw.treaty && t.active && t.parties.includes(target.id)) ? raw.treaty : null, text: String(raw.text || '').slice(0, 200), rulerThen: target.leader, turn: w.turn } : null;
  return aim && (aim.provinces.length || aim.reparations > 0 || aim.regime || aim.treaty) ? aim : null;
}
function stateAims(w, c, target, op) {
  const war = w.wars.at(-1), stated = readAims(w, target, op); if (stated) (war.aims ||= {})[c.id] = stated;
  const what = stated ? aimsText(w, stated) : '';
  for (const o of aliveCountries(w)) if (o.id !== c.id && o.id !== target.id) o.relations[c.id] = clampRel((o.relations[c.id] ?? 0) - (!stated ? 6 : stated.regime ? 8 : 2));
  if (stated && !stated.regime) c.legitimacy = clamp(c.legitimacy + 1, 0, 100);
  if (stated?.regime) target.legitimacy = clamp(target.legitimacy + 3, 0, 100);
  news(w, `${c.name} declared war on ${target.name}${stated ? `. Its stated aims: ${what}` : ', stating no aims'}.`, { kind: 'war', countries: [c.id, target.id] });
  tell(w, w.characters[target.leader], c.name, `${c.name} has declared war on us${stated ? `. Its stated aims: ${what}.` : ' and has not said what it wants.'}`);
  return stated ? `War is declared on ${target.name}, for: ${what}. The country and the world will measure the peace against that: one that brings it is a war won, one that gives most of it up is a war lost, and going on once it is in hand wearies the country faster.${stated.regime ? ` Demanding the fall of their ruler rallies their people to ${him(w.characters[target.leader])} and alarms other governments.` : ''}` : `War is declared on ${target.name}, with no aims stated: nothing at home or abroad says what would end it, and other governments are the more uneasy for that.`;
}
// What is settled when several states are bound by a treaty, for those newly bound: wars among them end, the land and money it names change hands, guarantees are given.
// The price of land given up without a battle fought for it, paid by the government that signs (see settleTerms). gave: for each state, the
// provinces it handed over, to whom, and whether it had fought that state in the war; got: the states that received land by the same paper.
function unfoughtLand(w, gave, got, note) {
  if (!w.dearLand) return;
  for (const [id, list] of Object.entries(gave)) { const unfought = list.filter(([, , fought]) => !fought); if (!unfought.length || got[id]) continue;
    const x = w.countries[id], names = unfought.map(([p]) => p.name).join(' and '), to = [...new Set(unfought.map(([, to]) => w.countries[to]?.name))].join(' and ');
    x.legitimacy = clamp(x.legitimacy - UNFOUGHT.standing, 0, 100); x.blocs.army.sat = clamp(x.blocs.army.sat - UNFOUGHT.army, 0, 100);
    for (const u of Object.values(w.units)) if (u.country === id) { u.loyalty = clamp((u.loyalty ?? 60) - UNFOUGHT.loyalty, 0, 100); u.morale = clamp((u.morale ?? 60) - UNFOUGHT.morale, 0, 100); }
    for (const fl of Object.values(w.fleets)) if (fl.country === id) fl.morale = clamp((fl.morale ?? 60) - UNFOUGHT.morale, 0, 100);
    for (const ch of Object.values(w.characters)) if (ch.alive && ch.country === id && isMinor(ch) && Object.values(w.units).some(u => u.commander === ch.id)) ch.loyalty = clamp(ch.loyalty - UNFOUGHT.loyalty, 0, 100);
    note(id, ` ${names} was given up to ${to} without a battle fought for it: beyond the people who went with the land, that cost the government about ${UNFOUGHT.standing} of its standing at home, and the army holds it against the government that signed.`);
    news(w, `${x.name} has given up ${names} to ${to} without a battle fought for it. The army and the country take it hard.`, { kind: 'diplomacy', countries: [id] });
    tell(w, w.characters[x.leader], 'The capital', `${names} was signed away without a battle fought for it. In the streets and in the messes it is called a surrender: the government's standing has fallen by about ${UNFOUGHT.standing} beyond what the lost people count for, and the regiments and their commanders trust it the less.`);
    if (x.general !== x.leader) tell(w, w.characters[x.general], 'The army', `${names} has been signed away without the army having fired a shot for it. The regiments take it as their own disgrace and the government's doing.`); }
}
function settleTerms(w, t, fresh) {
  const had = Object.fromEntries(t.parties.map(id => [id, ownedPeople(w, id)])), notes = {}, note = (id, s) => { notes[id] = (notes[id] || '') + s; }, forced = t.kind === 'peace';
  const warring = []; if (t.kind === 'peace') for (const x of fresh) for (const y of t.parties) if (x !== y && atWar(w, x, y)) warring.push([x, y, warsBetween(w, x, y)]);
  let moved = false; const gave = {}, got = {};
  for (const g of t.grants || []) {
    const p = w.provinces[g.province]; if (g.done || !p || !t.parties.includes(p.owner) || !t.parties.includes(g.to) || p.owner === g.to) continue;
    const giver = w.countries[p.owner], taker = w.countries[g.to]; g.done = true; moved = true; (gave[giver.id] ||= []).push([p, taker.id, hasFought(w, giver.id, taker.id)]); got[taker.id] = true;
    p.owner = taker.id; p.controller = taker.id; p.admin = Math.min(p.admin ?? .5, .3); p.governor = null; delete p.siege; handOver(w, p, giver.id, taker.id, forced);
    if (giver.capital === p.id) { const next = [...countryProvinces(w, giver.id)].sort((a, b) => provincePop(b) - provincePop(a))[0]; if (next) giver.capital = next.id; }
    news(w, `${p.name} passed from ${giver.name} to ${taker.name} by treaty.`, { kind: 'diplomacy', countries: [giver.id, taker.id], province: p.id, secret: !!t.secret });
  }
  if (moved && forced) { const by = {}; for (const g of t.grants || []) { const p = w.provinces[g.province]; if (p && p.owner === g.to && p.lostBy && p.lostIn === 1900 + Math.floor(w.turn / 4)) (by[`${g.to}|${p.lostBy}`] ||= []).push(p); }
    for (const [k, got] of Object.entries(by)) { const [to, from] = k.split('|'), taker = w.countries[to], giver = w.countries[from]; if (!taker?.alive) continue; deed(w, taker, `took ${got.map(p => p.name).join(' and ')} from ${giver?.name ?? 'a neighbour'} by the peace it made`); alarm(w, taker, giver, got); } }
  // Land given up without a battle fought for it. What a government pays for land lost is measured by the people who went with it, and for a
  // province of half a million that is next to nothing; but a government that signs land away for which its army never fired a shot has done
  // something else, and pays for that as well: a fixed loss of standing at home, and the army's trust in it. A state that takes land in the same
  // paper has made an exchange, not a surrender. (World 17: four wars were declared in two years for provinces that stood empty, not one battle was
  // fought, the land was signed over within two quarters, and the governments that signed lost two points of standing or gained three. The owner:
  // "giving up land without a fight must be heavy: a fixed loss of legitimacy and a fall in the army's loyalty". Worlds made from then on.)
  unfoughtLand(w, gave, got, note);
  if (moved) settleOccupations(w);
  // The wars end once the land the peace names has changed hands, not before: winding up a war sends every occupied province back to its owner and
  // every soldier out of land that is not his country's, and a province ceded by this very treaty is his country's. (World 15, the fifth quarter:
  // Tirara's garrison of Brunmarka, ceded to Tirara by the peace, was sent home to the capital on the day the peace was signed.)
  const pairs = []; for (const [x, y, fought] of warring) if (atWar(w, x, y)) { pairs.push([x, y, fought]); endWar(w, x, y, t.annex); peaceRecognises(w, w.countries[x], w.countries[y]); }
  let paid = 0;
  if (t.reparations && !t.paid && t.parties.includes(t.payer) && t.parties.includes(t.payee)) {
    const payer = w.countries[t.payer], payee = w.countries[t.payee], due = Math.max(payer.realGdp, 1) * t.reparations, gold = Math.min(Math.max(payer.reserves, 0), due);
    payer.reserves -= gold; payee.reserves += gold; if (due - gold > .5) payer.creditors[payee.id] = (payer.creditors[payee.id] || 0) + due - gold; t.paid = true; paid = t.reparations;
  }
  if (t.kind === 'guarantee' && t.of) for (const id of fresh) if (id !== t.of && !(w.guarantees ||= []).some(x => x.by === id && x.of === t.of)) w.guarantees.push({ by: id, of: t.of, turn: w.turn, treaty: t.id });
  if (forced) {
    for (const id of t.parties) { const x = w.countries[id], lost = (had[id] - ownedPeople(w, id)) / Math.max(had[id], 1), won = (ownedPeople(w, id) - had[id]) / Math.max(had[id], 1);
      if (lost > .005) { const cost = clamp(lost * 70, 1, 28); x.legitimacy = clamp(x.legitimacy - cost, 0, 100); x.blocs.army.sat = clamp(x.blocs.army.sat - lost * 40, 0, 100); note(id, ` About ${Math.round(lost * 100)}% of the country's people went with the land that was signed away; the government's standing at home fell by about ${Math.round(cost)}.`); tell(w, w.characters[x.leader], 'The capital', `The peace took about ${Math.round(lost * 100)}% of the country's people with the land it gave up. It is being called a defeat, in the streets and in the army.`); }
      else if (won > .005) x.legitimacy = clamp(x.legitimacy + clamp(won * 25, .5, 8), 0, 100); }
    for (const [x, y, fought] of pairs) { note(x, weighAims(w, w.countries[x], w.countries[y], fought, t.payer === y && t.payee === x ? paid : 0)); note(y, weighAims(w, w.countries[y], w.countries[x], fought, t.payer === x && t.payee === y ? paid : 0)); }
  }
  return notes;
}
// A treaty among several comes into force when as many have signed as it was said to need. It binds those who signed; the others invited may still come in.
function inForce(w, t, last) {
  t.pending = false; t.active = true; t.since = w.turn; t.parties = [...t.signed]; t.open = t.invited.filter(id => !t.signed.includes(id)); activateClauses(w, t);
  const lasts = t.durationTurns ?? (t.kind === 'peace' ? 20 : t.kind === 'armistice' ? 4 : t.kind === 'commission' ? 8 : null); if (lasts) t.expires = w.turn + lasts;
  if (['alliance', 'guarantee', 'protection'].includes(t.kind)) for (let i = 0; i < t.parties.length; i++) for (let j = i + 1; j < t.parties.length; j++) { const a = w.countries[t.parties[i]], b = w.countries[t.parties[j]]; if (a?.alive && b?.alive) { const said = bondSigned(w, a, b); if (said && w.characters[a.leader]?.alive) w.characters[a.leader].inbox.push({ turn: w.turn, from: 'The capital', text: said.trim() }); } }
  const notes = settleTerms(w, t, t.parties), names = t.parties.map(id => cname(w, id)).join(', '), med = w.countries[t.mediator], cf = (w.conferences || []).find(x => x.id === t.conference), host = w.countries[cf?.host];
  for (const x of t.parties) for (const y of t.parties) if (x !== y) w.countries[x].relations[y] = clampRel((w.countries[x].relations[y] ?? 0) + 8);
  // Whoever brought others to terms is known for it; so is whoever called the table at which it was signed.
  if (med?.alive) { shame(w, med, 4, `the ${t.kind} it mediated among ${names} was signed`); med.legitimacy = clamp(med.legitimacy + 1, 0, 100); for (const id of t.parties) w.countries[id].relations[med.id] = clampRel((w.countries[id].relations[med.id] ?? 0) + 10); tell(w, w.characters[med.leader], 'Foreign Ministry', `The ${t.kind} we proposed among ${names} (${t.id}) has been signed by all it needed. It is known as our work.`); }
  if (host?.alive && !cf.credited) { cf.credited = true; shame(w, host, 3, `the conference it called ended in a treaty`); }
  news(w, `${names} ${t.kind === 'peace' ? 'have signed a peace' : t.kind === 'armistice' ? 'have signed an armistice' : `have signed ${kindWord(t)}`}${t.kind === 'guarantee' ? ` of the independence of ${cname(w, t.of)}` : ''}${med?.alive ? `, brought about by ${med.name}` : ''}${host?.alive ? `, at the conference called by ${host.name}` : ''}${t.open.length ? `. It stays open to ${t.open.map(id => cname(w, id)).join(', ')}` : ''}.`, { kind: 'diplomacy', countries: [...t.parties, ...(med ? [med.id] : [])], secret: !!t.secret });
  for (const id of t.parties) if (id !== last.id) tell(w, w.characters[w.countries[id].leader], 'Foreign Ministry', `${t.id} (${t.kind.replace('_', ' ')}) is in force among ${names}.${notes[id] || ''}`);
  return { ok: true, msg: `Signed, and with that ${t.id} is in force among ${names}.${t.secret ? ' It is secret.' : ''}${notes[last.id] || ''}` };
}
function signMany(w, c, t) {
  const carried = !!(t.mediator || t.conference);
  { const stop = moneyStops(w, t, c.id); if (stop) return fail(stop); }
  for (const id of t.active ? t.parties : t.signed) { if (!dealsWith(w, c.id, id) && t.kind !== 'peace') return fail(`${cname(w, id)} and this state do not recognise each other: nothing can be signed with it.`); if (!maySign(w, c.id, id, t.kind, carried)) return fail(`Between this state and ${cname(w, id)} stand ${tieWord(tieOf(w, c.id, id))}: nothing of this kind is signed between them unless a third state carries it.`); }
  if (!t.active) {
    t.signed.push(c.id);
    for (const id of t.invited) if (id !== c.id) tell(w, w.characters[w.countries[id]?.leader], c.name, `${c.name} has signed ${t.id} (${t.kind.replace('_', ' ')}).`);
    if (t.mediator) tell(w, w.characters[w.countries[t.mediator]?.leader], c.name, `${c.name} has signed ${t.id}, the ${t.kind} you proposed.`);
    if (t.signed.length < t.need) return { ok: true, msg: `Signed. ${t.id} comes into force when ${t.need} of the ${t.invited.length} states named have signed; so far ${t.signed.map(id => cname(w, id)).join(', ')}.` };
    return inForce(w, t, c);
  }
  // Accession: the treaty is in force already, and from today it binds this state too.
  t.open = t.open.filter(x => x !== c.id); t.parties.push(c.id); t.signed.push(c.id);
  const notes = settleTerms(w, t, [c.id]), names = t.parties.filter(id => id !== c.id).map(id => cname(w, id)).join(', ');
  for (const id of t.parties) if (id !== c.id) { w.countries[id].relations[c.id] = clampRel((w.countries[id].relations[c.id] ?? 0) + 8); c.relations[id] = clampRel((c.relations[id] ?? 0) + 8); }
  news(w, `${c.name} has acceded to the ${t.kind.replace('_', ' ')} ${t.kind === 'guarantee' ? `of ${cname(w, t.of)}` : 'treaty'} of ${names}.`, { kind: 'diplomacy', countries: t.parties, secret: !!t.secret });
  return { ok: true, msg: `Acceded: ${t.id} now binds this state with ${names}.${notes[c.id] || ''}` };
}
// One party leaves a treaty among several. It is a broken word like any other; the treaty stands for the rest.
function withdraw(w, c, t) {
  const rest = t.parties.filter(x => x !== c.id), justified = rest.includes(t.breaches?.at(-1)?.party);
  t.parties = rest; t.signed = (t.signed || []).filter(x => x !== c.id); (t.left ||= []).push(c.id); w.guarantees = (w.guarantees || []).filter(x => !(x.treaty === t.id && x.by === c.id));
  shame(w, c, justified ? -2 : t.kind === 'peace' ? -15 : -8, `it withdrew from the ${t.kind.replace('_', ' ')} treaty it had signed with ${rest.map(id => cname(w, id)).join(', ')}`);
  for (const id of rest) w.countries[id].relations[c.id] = clampRel((w.countries[id].relations[c.id] ?? 0) - (justified ? 10 : 25));
  news(w, `${c.name} has withdrawn from the ${t.kind.replace('_', ' ')} treaty of ${rest.map(id => cname(w, id)).join(', ')}, which stands among the rest.`, { kind: 'diplomacy', countries: [c.id, ...rest], secret: !!t.secret });
  return { ok: true, msg: `This state is out of ${t.id}; it stands among ${rest.map(id => cname(w, id)).join(', ')}. Leaving it ${justified ? 'after another party breached it cost little' : 'is a broken word, and is remembered as one'}.` };
}
// A treaty laid before several states at once, by one of them, by a mediator who is not a party, or at a conference.
function proposeMany(w, c, op, others, mediator = false) {
  const kind = op.kind, cf = op.conference ? (w.conferences || []).find(x => x.id === op.conference) : null, table = cf ? [cf.host, ...cf.came] : null;
  if (![...TREATY, 'guarantee'].includes(kind) || kind === 'protection') return fail(kind === 'protection' ? 'A treaty of protection is between a protector and the state it protects: two parties.' : 'Invalid proposal.');
  if (op.conference && !cf?.open) return fail('No such conference is sitting.');
  if (cf && !table.includes(c.id)) return fail('Only those at the table can lay a treaty before the conference.');
  const invited = mediator ? [...others] : [c.id, ...others]; if (invited.length < 2) return fail('A treaty needs at least two parties: name the others in parties.');
  if (cf) { const out = invited.filter(id => !table.includes(id)); if (out.length) return fail(`Not at the table: ${out.map(id => cname(w, id)).join(', ')}. A treaty laid before a conference is among those who came.`); }
  for (let i = 0; i < invited.length; i++) for (let j = i + 1; j < invited.length; j++) { const a = invited[i], b = invited[j];
    if (!dealsWith(w, a, b) && kind !== 'peace') return fail(`${cname(w, a)} and ${cname(w, b)} do not recognise each other as states: they sign nothing together but a peace.`);
    if (!maySign(w, a, b, kind, !!cf || mediator)) return fail(`Between ${cname(w, a)} and ${cname(w, b)} stand ${tieWord(tieOf(w, a, b))}: nothing of this kind can be signed between them unless a third state carries it (a mediator, a conference).`); }
  if (['peace', 'armistice'].includes(kind) && !invited.some((a, i) => invited.some((b, j) => j > i && atWar(w, a, b)))) return fail('There is no war among them to end or to halt.');
  const of = kind === 'guarantee' ? alive(w, op.of) : null; if (kind === 'guarantee' && (!of || invited.includes(of.id))) return fail('Name the state whose independence is guaranteed (of); it is not itself a signatory.');
  const need = mediator ? invited.length : clamp(Math.round(num(op.need, 2, invited.length, invited.length)), 2, invited.length), secret = !!op.secret && !['peace', 'armistice'].includes(kind);
  // In a treaty among several, land goes where the treaty says, by name: each province to one of the parties.
  const grants = (Array.isArray(op.cede) ? op.cede : []).filter(g => g && typeof g === 'object' && w.provinces[g.province] && invited.includes(w.provinces[g.province].owner) && invited.includes(g.to) && w.provinces[g.province].owner !== g.to).slice(0, 24).map(g => ({ province: g.province, to: g.to }));
  if (Array.isArray(op.cede) && op.cede.length && !grants.length) return fail('In a treaty among several, each province ceded must be named with the party that receives it: cede:[{province,to}].');
  const reparations = num(op.reparations, 0, .3, 0), payer = invited.includes(op.reparations_from) ? op.reparations_from : null, payee = invited.includes(op.reparations_to) ? op.reparations_to : null;
  if (reparations > 0 && (!payer || !payee || payer === payee)) return fail('In a treaty among several, an indemnity names who pays and who receives it: reparations_from and reparations_to.');
  const id = nextId(w, 'A'), clauses = normalizeClauses(w, op.clauses, invited), terms = String(op.terms || '').slice(0, 240);
  const t = { id, kind, multi: true, parties: [...invited], invited: [...invited], signed: mediator ? [] : [c.id], need, active: false, pending: true, proposer: c.id, mediator: mediator ? c.id : null, terms, clauses, breaches: [], expires: null, durationTurns: op.turns ? Math.round(num(op.turns, 1, 200, 40)) : null, annex: !!op.annex, cede: [], grants, reparations, payer, payee, turn: w.turn, secret, conference: cf?.id ?? null, of: of?.id ?? null };
  w.treaties.push(t); if (cf) (cf.treaties ||= []).push(id);
  const text = `${kind.replace('_', ' ')}${of ? ` of the independence of ${of.name}` : ''} among ${invited.map(x => cname(w, x)).join(', ')}. ${terms}${clauses.length ? ` Clauses: ${clauses.map(x => clauseText(w, x)).join('; ')}.` : ''}${grants.length ? ` Provinces to change hands: ${grants.map(g => `${w.provinces[g.province].name} (${g.province}) from ${cname(w, w.provinces[g.province].owner)} to ${cname(w, g.to)}`).join(', ')}.` : ''}${t.annex ? ' Each side keeps the land it now holds.' : ''}${reparations ? ` ${cname(w, payer)} pays ${cname(w, payee)} ${Math.round(reparations * 100)}% of a quarter's output in gold.` : ''}${secret ? ' It is to be kept secret: known to those who govern and, where it concerns the army, to their chiefs of staff.' : ''} It comes into force when ${need === invited.length ? 'all' : need} of them have signed${need < invited.length ? ', and stays open to the rest' : ''}.`;
  for (const x of invited) if (x !== c.id) tell(w, w.characters[w.countries[x].leader], c.name, `${mediator ? `${c.name} offers its mediation. Proposal` : cf ? `Laid before the conference ${cf.id}: proposal` : 'Treaty proposal'} ${id}: ${text} Issue an accept_treaty decision to sign.`);
  return { ok: true, msg: `Proposal ${id} was laid before ${invited.filter(x => x !== c.id).map(x => cname(w, x)).join(', ')}: ${text}`, treaty: id };
}
// A duty aimed at one country's goods.
function aimTariff(w, c, target, op) {
  const had = c.aimed?.[target.id];
  if (op.clear === true || op.rate == null) { if (had == null) return fail(`No duty of yours is aimed at ${target.name}.`); delete c.aimed[target.id]; news(w, `${c.name} lifted its special duty on goods from ${target.name}.`, { kind: 'diplomacy', countries: [c.id, target.id] }); return { ok: true, msg: `Goods from ${target.name} pay the ordinary duties again.` }; }
  if (hasTreaty(w, c.id, target.id, 'trade')) return fail(`A trade treaty with ${target.name} is in force, and a duty aimed at its goods would break it. Break the treaty first (break_treaty) or leave their goods alone.`);
  const rate = num(op.rate, 0, 1); (c.aimed ||= {})[target.id] = rate;
  if (had == null || Math.abs(had - rate) > .005) { if (allowance(w, c, `aimed:${target.id}`, 1, 1) > 0 && rate > (c.tariff ?? 0)) target.relations[c.id] = clampRel((target.relations[c.id] ?? 0) - 10); news(w, `${c.name} laid a duty of ${pc(rate)} on goods from ${target.name}.`, { kind: 'diplomacy', countries: [c.id, target.id] }); tell(w, w.characters[target.leader], 'Customs', `${c.name} now charges ${pc(rate)} on our goods and on nobody else's.`); }
  return { ok: true, msg: `Goods from ${target.name} now pay ${pc(rate)} at the customs houses, whatever the general tariff (${pc(c.tariff)}) or the rule for a good says. Merchants turn to other sellers where there are any, and the dearer it is the less comes in at all; what still comes pays the duty to the treasury, and where nobody else can supply a thing our own people go short of it. ${target.name} knows it is aimed at them.${rate >= (c.tariff ?? 0) + .1 ? ' At home it counts as part of an answer to what the country holds against them.' : ''}` };
}
// Named goods not sold to one country, or not bought from it: less than cutting off all trade, and kept as far as the customs service reaches.
function banGoods(w, c, target, op) {
  const goods = [...new Set(op.goods.map(String))].filter(g => GOODS.includes(g)); if (!goods.length) return fail(`No such goods. They are: ${GOODS.join(', ')}.`);
  const dirs = op.direction === 'buy' ? ['buy'] : op.direction === 'both' ? ['sell', 'buy'] : ['sell'], b = (c.bans ||= {})[target.id] ||= { sell: [], buy: [] }, lift = op.on === false; let changed = false;
  for (const d of dirs) for (const g of goods) { const has = b[d].includes(g); if (lift && has) { b[d] = b[d].filter(x => x !== g); changed = true; } else if (!lift && !has) { b[d].push(g); changed = true; } }
  if (!b.sell.length && !b.buy.length) delete c.bans[target.id];
  if (!changed) return { ok: true, msg: lift ? `No such ban on ${target.name} was in force.` : `That ban on ${target.name} is in force already.` };
  const what = `${dirs.map(d => d === 'sell' ? 'the sale to' : 'the purchase from').join(' and ')} ${target.name} of ${goods.map(g => GOOD_LABEL[g]).join(', ')}`;
  if (!lift && allowance(w, c, `ban:${target.id}`, 1, 1) > 0) target.relations[c.id] = clampRel((target.relations[c.id] ?? 0) - 8);
  news(w, `${c.name} ${lift ? 'lifted its ban on' : 'forbade'} ${what}.`, { kind: 'diplomacy', countries: [c.id, target.id] }); if (!lift) tell(w, w.characters[target.leader], 'Customs', `${c.name} has forbidden ${what.replace(target.name, 'us')}.`);
  return { ok: true, msg: lift ? `Lifted: ${what} is free again.` : `Forbidden: ${what}. The customs service holds it as far as it reaches (about ${Math.round(sealOf(w, c) * 100)}% here); the rest goes by other roads. Their other trade with us is untouched. At home it counts as part of an answer to what the country holds against them.` };
}
// Recalling an envoy, breaking off relations, restoring them.
function setRelations(w, c, target, op) {
  const level = ['normal', 'recalled', 'broken'].includes(op.level) ? op.level : null; if (!level) return fail('Relations are: normal, recalled (the envoy called home), broken.');
  const was = stanceOf(c, target.id); if (was === level) return fail(level === 'normal' ? `Our envoy is at his post in ${target.name}.` : `That is already our stance toward ${target.name}.`);
  if (atWar(w, c.id, target.id) && level !== 'broken') return fail('States at war have no envoys with each other; relations are restored by the peace and after it.');
  if (level === 'broken' && (hasTreaty(w, c.id, target.id, 'alliance') || protectorOf(w, c)?.id === target.id || protectorOf(w, target)?.id === c.id)) return fail(`This state is bound to ${target.name} by alliance or protection: that treaty would have to be broken first.`);
  (c.stance ||= {})[target.id] = level; if (level === 'normal') delete c.stance[target.id];
  const tie = tieOf(w, c.id, target.id), theirs = stanceOf(target, c.id); let extra = '';
  if (level === 'broken') {
    // Trade and passage that rested on a paper between the two lapse with the legations that kept them.
    const gone = w.treaties.filter(t => t.active && !t.multi && ['trade', 'military_access'].includes(t.kind) && t.parties.includes(c.id) && t.parties.includes(target.id)); for (const t of gone) t.active = false;
    if (gone.length) { shame(w, c, -3, `it broke off relations with ${target.name} while bound to it by treaty`); extra = ` The ${gone.map(t => t.kind.replace('_', ' ')).join(' and ')} treaty with them lapses with it, which is remembered.`; }
  }
  const worse = RANKS[level] > RANKS[was]; if (worse && allowance(w, c, `stance:${target.id}`, 1, 1) > 0) target.relations[c.id] = clampRel((target.relations[c.id] ?? 0) - (level === 'broken' ? 25 : 10));
  news(w, level === 'normal' ? `${c.name} has sent its envoy back to ${target.name}.` : level === 'recalled' ? `${c.name} has recalled its envoy from ${target.name}.` : `${c.name} has broken off relations with ${target.name}.`, { kind: 'diplomacy', countries: [c.id, target.id] });
  tell(w, w.characters[target.leader], 'Foreign Ministry', level === 'normal' ? `${c.name} has sent its envoy back to us.${tie !== 'normal' ? ' Ours is still at home.' : ''}` : level === 'recalled' ? `${c.name} has recalled its envoy.` : `${c.name} has broken off relations with us.`);
  const says = { normal: tie === 'normal' ? `Envoys are at their posts again in both capitals: treaties of every kind can be signed, and each sees the other as before.` : `Our envoy is back, but ${target.name} keeps its own stance (${tieWord(theirs)}), and until it changes that the two states stand as before.`,
    recalled: `The envoy is called home. While it lasts, nothing that binds the two states closer can be signed between them (no alliance, trade, passage or protection; a non-aggression pact, an armistice and a peace still can), and each sees less of the other's capital with every quarter. Trade goes on. At home it counts as part of an answer to what the country holds against them.`,
    broken: `Relations are broken off. While it lasts, nothing can be signed between the two states except an armistice or a peace, unless a third state carries it (a mediator, a conference); each is nearly blind in the other's capital; their trade loses its consuls and costs more; and when patrols meet on the frontier there is nobody to smooth it over. At home it counts as a larger part of an answer to what the country holds against them.` };
  return { ok: true, msg: `${says[level]}${extra}` };
}
const RANKS = { normal: 0, recalled: 1, broken: 2 };

export function applyOp(w, actor, op) {
  if (!actor?.alive) return { ok: false, msg: 'The dead give no orders.' };
  const c = alive(w, actor.country);
  if (!c || !op?.op) return { ok: false, msg: 'Invalid operation.' };
  const perm = permissionsOf(c, actor, w), held = actor.status === 'imprisoned' || actor.status === 'exiled';
  if (perm && !perm.has(op.op) && (held || !delegated(c, actor, op.op))) return { ok: false, msg: held ? `Someone who is ${actor.status} cannot do this: ${op.op}` : `${c[actor.role] === actor.id ? actor.role : 'A private person'} is not authorized for this operation: ${op.op}${c.general === actor.id && ['mobilize', 'demobilize', 'recruit', 'disband', 'declare_war', 'build_ship'].includes(op.op) ? `. It is for whoever governs to order: a word or a letter from the ruler does not carry it, the ruler has to give the order as ${his(w.characters[c.leader])} own decision` : ''}${OPEN_WAY[op.op] && !governs(w, c, actor) ? `. ${OPEN_WAY[op.op]}` : ''}` };
  // A law passed by a legislature is above a veto; a decree is not.
  if (!op._law || op._decree) {
    const blocker = vetoedBy(w, c, actor, op.op);
    if (blocker) { news(w, `${c.name}: ${blocker.name} blocked the decision taken by ${actor.name}.`, { kind: 'politics', countries: [c.id] }); return fail(`${blocker.name} blocked it.`); }
    if (!op._law && mustPassParliament(w, c, op)) {
      const bill = createBill(w, c, actor, { title: LAW_TITLE[op.op] ?? op.op, text: billWords(op), ops: [op] });
      return bill ? { ok: true, msg: `Referred to parliament: ${bill.id}${op.op === 'declare_war' ? `. In this state war is declared by the house: the declaration is laid before it as that bill and is voted when this quarter is out. Until it passes there is no war; an attack, a landing or a bombardment ordered meanwhile waits for the vote and goes out the day it passes` : ''}`, bill: bill.id } : fail('The parliamentary agenda is full.');
    }
    if (!op._late && WAR_ACTS.has(op.op)) { const foe = foeOf(w, c, op), bill = foe ? warBill(c, foe) : null; if (bill) return awaitVote(w, actor, c, op, bill, foe); }
  }
  // Where an order that can be about one's own country names it as its target, it means home. (World 17: somebody buying his own state's bonds
  // was told that this needs another country.)
  const home = op.target === c.id && HOME_TOO.has(op.op), target = op.target && !home ? alive(w, op.target) : null;
  if (target && target.id === c.id) return fail('That needs another country, not your own.');
  const gdp = Math.max(c.gdp, 1);
  if (FIRM_OPS.has(op.op)) return firmOp(w, actor, c, op, fail, ok, tell, leaveTrace, num);
  if (LABOUR_OPS.has(op.op)) return labourOp(w, actor, c, op, { fail, num, governs: governs(w, c, actor), tell, allowance });
  if (PEOPLE_OPS.has(op.op)) { const r = peopleOp(w, actor, c, op, { fail, num, pay, allowance, rules: governs(w, c, actor), leads: leadsParties(w, c, actor), leaveTrace, NO_FUNDS }); c._privilege = privilege(w, c); return r; }
  if (NOTE_OPS.has(op.op)) return noteOp(w, actor, c, op, { fail, num, governs: governs(w, c, actor), allowance });
  if (STANDING_OPS.has(op.op)) return standingOp(w, actor, c, op, { fail, num, known: k => typeof k === 'string' && /^[a-z_]{3,}$/.test(k) });
  if (INQUIRY_OPS.has(op.op)) return inquiryOp(w, actor, c, op, { fail, num, allowance: (key, cap, want) => allowance(w, c, key, cap, want), pays: m => treasuryPays(c, m), leads: leadsParties(w, c, actor).some(p => (c.parliament?.seats?.[p.id] ?? 0) > 0) });
  if (TENDER_OPS.has(op.op)) return tenderOp(w, actor, c, op, { fail, num });
  if (MEANS_OPS.has(op.op)) return meansOp(w, actor, c, op, { fail, num, target, pay: (cost, what) => pay(c, cost, what), allowance: (who, key, cap, want) => allowance(w, who, key, cap, want), personFor, noPerson });
  if (SEAT_OPS.has(op.op)) return seatOp(w, actor, c, op, { fail, num, governs: governs(w, c, actor), personFor });
  switch (op.op) {
    // A rate is ordered in a day and collected by offices: a capable state has the new rate in force at once, a thin one takes several quarters to get there.
    case 'set_tax': { if (!has(c.tax, op.kind)) return fail('No such tax type.'); const to = num(op.rate, 0, .7), was = c.tax[op.kind], r = reach(w, c); c.tax[op.kind] = was + (to - was) * r; if (r < 1 && Math.abs(to - c.tax[op.kind]) > .003) (c.taxTarget ||= {})[op.kind] = to; else if (c.taxTarget) delete c.taxTarget[op.kind];
      return r < 1 && Math.abs(to - was) > .003 ? { ok: true, msg: `The ${op.kind} tax is ordered to ${pc(to)}. With the offices the state has, it stands at ${pc(c.tax[op.kind])} this quarter and reaches the new rate over the next few.` } : ok(); }
    case 'set_budget': { if (!BUDGET.includes(op.category)) return fail('No such budget category.'); const was = c.budget[op.category] ?? 0; c.budget[op.category] = num(op.share, 0, .45); const now = c.budget[op.category], pc = v => Math.round(v * 1000) / 10, cost = op.category === 'military' ? upkeepCost(w, c) : 0;
      return { ok: true, msg: `The vote for ${op.category} is ${pc(now)}% of output (it was ${pc(was)}%): about ${Math.round(now * gdp)} a quarter.${cost > 0 ? ` The forces as they stand and are posted cost about ${Math.round(cost)} a quarter: the vote covers ${Math.round(now * gdp / cost * 100)} in the hundred of it.` : ''} All the votes together now come to ${pc(BUDGET.reduce((a, k) => a + (c.budget[k] || 0), 0))}% of output; the budget report shows what that leaves of the revenue.` }; }
    case 'set_tariff': { if (target) return aimTariff(w, c, target, op); const to = num(op.rate, 0, 1), was = c.tariff, r = reach(w, c); c.tariff = was + (to - was) * r; c.tariffTarget = r < 1 && Math.abs(to - c.tariff) > .003 ? to : null; return r < 1 && Math.abs(to - was) > .003 ? { ok: true, msg: `The tariff is ordered to ${pc(to)}; the customs houses apply ${pc(c.tariff)} this quarter and the rest follows.` } : ok(); }
    case 'set_arms_share': c.armShare = num(op.share, 0, .75); return ok();
    case 'print_money': { const pct = allowance(w, c, 'print', .5, num(op.pct_gdp, 0, .8)); if (pct <= 0) return fail('The presses have already run as hard as they can this quarter.'); const x = gdp * pct; c.money += x; c.treasury += x; news(w, `${c.name} central bank put a large amount of money into circulation.`, { kind: 'economy', countries: [c.id] }); return { ok: true, msg: `${Math.round(x)} in new money entered the treasury.` }; }
    case 'borrow': { let x = gdp * num(op.pct_gdp, 0, .6); const room = creditLeft(c); if (x > room && x <= room * 1.03 + .5 && room >= 1) x = room; if (x > room) return fail(`Lenders would put up at most ${Math.round(room)} more this quarter (${Math.round(room / Math.max(gdp, 1) * 1000) / 10}% of a quarter's output).`); c.debt += x; c.treasury += x; c._loans = (c._loans || 0) + x; c._taken = (c._taken || 0) + x; return { ok: true, msg: `Borrowed ${Math.round(x)}.` }; }
    case 'repay_state_debt': { const x = Math.min(Math.max(c.treasury, 0), c.debt, gdp * num(op.pct_gdp, 0, 40, 40)); if (x <= 0) return fail('There is nothing in the treasury to repay with.'); c.treasury -= x; c.debt -= x; return { ok: true, msg: `${Math.round(x)} of the debt was repaid; ${Math.round(c.debt)} remains.` }; }
    case 'sell_gold': { const x = Math.min(Math.max(c.reserves, 0), num(op.amount, 0, 1e12, 0)); if (x <= 0) return fail('There is no gold in the reserve to sell.'); c.reserves -= x; c.treasury += x * (c.rate || 1); return { ok: true, msg: `${Math.round(x)} gold left the reserve and ${Math.round(x * (c.rate || 1))} entered the treasury. ${Math.round(c.reserves)} gold remains to back the currency, pay for imports and serve foreign debts.` }; }
    case 'default_debt': return declareDefault(w, c, 'repudiated its debts') ? (shame(w, c, -12, 'it repudiated its debts'), { ok: true, msg: `The debt was written down to ${Math.round(c.debt)}. Lenders will keep away for years.` }) : fail('The state is already in default.');
    case 'embargo': if (!target) return fail('No such target.'); if (Array.isArray(op.goods) && op.goods.length) return banGoods(w, c, target, op); if (op.on === false) c.embargo = c.embargo.filter(x => x !== target.id); else if (!c.embargo.includes(target.id)) { c.embargo.push(target.id); target.relations[c.id] = clampRel((target.relations[c.id] ?? 0) - 15); news(w, `${c.name} cut off trade with ${target.name}.`, { kind: 'diplomacy', countries: [c.id, target.id] }); } return ok();
    case 'build': return build(w, c, op, actor);
    case 'survey': { const p = w.provinces[op.province]; if (!p || p.controller !== c.id) return fail('That province is not under your control.'); if (pay(c, gdp * .01, 'building') === null) return fail(NO_FUNDS); const found = Object.entries(p.deposits).filter(([k, d]) => !d.known && (k !== 'oil' || hasTech(c, 'oil_prospecting')) && (k !== 'rare' || hasTech(c, 'electricity')) && rand(w) < .65); found.forEach(([, d]) => d.known = true); if (found.length) news(w, `${c.name}: ${found.map(([k]) => GOOD_LABEL[k]).join(', ')} found in ${p.name}.`, { kind: 'economy', countries: [c.id] }); return { ok: true, msg: found.length ? `Found: ${found.map(([k]) => GOOD_LABEL[k]).join(', ')}` : 'No new deposit was found in this survey.' }; }
    case 'set_research': if (!has(TECHS, op.tech) || c.techs[op.tech] || !TECHS[op.tech].req.every(r => c.techs[r])) return fail('This technology cannot be researched.'); c.research = { target: op.tech, progress: c.research.target === op.tech ? c.research.progress : 0 }; return ok();
    case 'steal_tech': { if (!target) return fail('No such target.'); const cand = Object.keys(target.techs).filter(t => !c.techs[t] && TECHS[t]?.req.every(r => c.techs[r])); if (!cand.length) return fail('They have nothing this country could yet make use of.'); if (allowance(w, c, `steal:${target.id}`, 1, 1) <= 0) return fail('The network there has been used once this quarter already; a second attempt so soon would only expose it.'); if (rand(w) > clamp(.2 + (c.intelligence - target.intelligence) / 150, .05, .75)) { target.relations[c.id] = clampRel((target.relations[c.id] ?? 0) - 15); return fail('The spy network was exposed.'); } const t = pick(w, cand); c.techs[t] = Math.max(1, w.turn); if (SPREAD[t]) (c.adopting ||= {})[t] = 0; news(w, `${target.name} technology secretly passed to ${c.name}.`, { kind: 'plot', countries: [c.id, target.id], secret: true }); return ok(); }
    case 'grant_concession': { if (!target) return fail('No such target.'); const p = w.provinces[op.province]; if (!p || p.controller !== c.id || !has(p.deposits, op.resource)) return fail('No such deposit.'); (p.concessions ||= {})[op.resource] = { holder: target.id, share: num(op.share, .05, .9) }; tell(w, w.characters[target.leader], c.name, `You have been granted ${Math.round(num(op.share, .05, .9) * 100)}% of the ${GOOD_LABEL[op.resource]} raised at ${p.name}.`); news(w, `${c.name} granted the ${p.name} ${GOOD_LABEL[op.resource]} concession to ${target.name}.`, { kind: 'economy', countries: [c.id, target.id] }); return { ok: true, msg: 'The concession is theirs. Whatever they pay for it is for them to send.' }; }
    case 'revoke_concession': { const p = w.provinces[op.province]; const con = p?.concessions?.[op.resource]; if (!con || p.controller !== c.id) return fail('No such concession.'); const o = w.countries[con.holder]; if (o) o.relations[c.id] = clampRel((o.relations[c.id] ?? 0) - 35); delete p.concessions[op.resource]; news(w, `${c.name} seized the ${p.name} concession.`, { kind: 'diplomacy', countries: [c.id, con.holder] }); return ok(); }
    case 'lend': { if (!target) return fail('No such target.'); if (op.amount != null && num(op.amount, 0, 1e7, 0) > Math.max(c.reserves, 0) + .5) return fail(`The reserve holds ${Math.round(Math.max(c.reserves, 0))} in gold: ${Math.round(num(op.amount, 0, 1e7, 0))} cannot be lent out of it.`); const amt = op.amount != null ? num(op.amount, 0, 1e7, 0) : Math.min(Math.max(c.reserves, 0), Math.max(c.realGdp, 1) * num(op.pct_gdp, 0, .4)); if (amt <= 0) return fail('There is no gold to lend.'); if (op.rate != null) (target.creditTerms ||= {})[c.id] = { rate: num(op.rate, 0, .15, .012) }; c.reserves -= amt; target.reserves += amt; target.creditors[c.id] = (target.creditors[c.id] || 0) + amt; tell(w, w.characters[target.leader], c.name, `${Math.round(amt)} in gold has been lent to your state. It is owed back with interest; if you do not want the debt, return it with repay_foreign.`); news(w, `${c.name} lent money to the government of ${target.name}.`, { kind: 'economy', countries: [c.id, target.id] }); return { ok: true, msg: `${Math.round(amt)} gold lent.` }; }
    case 'set_fx_regime': { if (!FX_REGIMES.includes(op.regime)) return fail('No such exchange-rate regime.'); if (op.regime === 'pegged') { if (!target || target.id === c.id) return fail('No currency to peg to.'); c.pegTo = target.id; c.pegRate = (c.rate || 1) / (target.rate || 1); } else c.pegTo = null; c.fxRegime = op.regime; news(w, `${c.name}: ${c.currency.name} ${op.regime === 'floating' ? 'was floated' : op.regime === 'gold' ? 'was pegged to gold' : `was pegged to ${target.currency.name}`}.`, { kind: 'economy', countries: [c.id] }); return ok(); }
    case 'devalue': { if (c.fxRegime === 'floating') return fail('A floating rate cannot be devalued; it sets itself.'); const pct = allowance(w, c, 'devalue', .3, num(op.pct, .01, 1, .1)), prev = c.rate; if (pct <= 0) return fail('The currency has already been cut as far as it can be in one quarter.'); c.rate *= 1 + pct; if (c.pegTo) c.pegRate *= 1 + pct; c._fxPass = (c._fxPass || 0) + Math.log(c.rate / prev) * .2; c.fx = +(100 / c.rate).toFixed(2); c.legitimacy = clamp(c.legitimacy - pct * 8, 0, 100); news(w, `${c.name}: ${c.currency.name} was devalued by ${Math.round(pct * 100)}%.`, { kind: 'economy', countries: [c.id] }); return ok(); }
    // What share of its own cargoes a state's merchants must offer first to ships under its own flag. More of the freight on the country's trade
    // stays at home, as far as the flag has ships to carry it; the states whose ships are turned away see it done.
    case 'navigation_act': { if (!governs(w, c, actor)) return fail('The carrying trade is ordered by whoever governs.'); const was = c.flagShare ?? FLAG; c.flagShare = num(op.share, 0, .6, FLAG); const now = c.flagShare, pc = v => Math.round(v * 100), all = sum(Object.values(c._carried || {}), x => x), own = all > 0 ? (c._carried[c.id] || 0) / all : 0;
      if (now > was + .05) for (const o of aliveCountries(w)) if (o.id !== c.id && (c._carried?.[o.id] || 0) > all * .1) { o.relations[c.id] = clampRel((o.relations[c.id] ?? 0) - Math.round((now - was) * 20)); tell(w, w.characters[o.leader], 'Board of Trade', `${c.name} now reserves ${pc(now)} in the hundred of its cargoes by sea to its own flag (it was ${pc(was)}). Our ships carried a good part of its trade: they will carry less of it.`); }
      news(w, `${c.name} reserves ${pc(now)} in the hundred of its sea-borne cargoes to ships under its own flag.`, { kind: 'economy', countries: [c.id] });
      return { ok: true, msg: `Of every cargo the country sends or receives by sea, ${pc(now)} in the hundred is now offered first to ships under its own flag (it was ${pc(was)}), as far as the flag has ships free after the coasting trade: the merchant marine is ${Math.round(c.shipping ?? 0)} of tonnage, and last quarter its ships carried about ${pc(own)} in the hundred of the country's own sea-borne trade. What the flag cannot carry goes as before to whoever has ships free. It stands until changed.` }; }
    case 'set_capital_controls': c.capitalClosed = op.closed !== false; news(w, `${c.name} ${c.capitalClosed ? 'restricted' : 'freed'} capital movements.`, { kind: 'economy', countries: [c.id] }); return { ok: true, msg: c.capitalClosed ? 'Money may not leave the country without licence. It holds as far as the customs and the offices can make it hold; what flight of capital it stops stays, and foreign lenders and merchants like the country the less for it. It stands until it is lifted.' : 'Money moves in and out freely again.' };
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
    case 'set_culture_policy': {
      if (op.language && !LANGUAGE_POLICY.includes(op.language)) return fail('Unknown language policy.'); if (op.faith && !FAITH_POLICY.includes(op.faith)) return fail('Unknown faith policy.');
      const prov = op.province ? w.provinces[op.province] : null, people = String(op.people ?? '').trim(); if (op.province && prov?.controller !== c.id) return fail('That province is not under your control.');
      if (people && !countryProvinces(w, c.id).some(p => groupsOf(p).some(g => hits(people, g)))) return fail(`No people or faith of that name lives in the country: ${people}.`);
      // With neither a province nor a people named it is the country's policy, as before; with either it is a rule of its own, and clear:true takes that rule away.
      if (!prov && !people) { if (!op.language && !op.faith) return fail('Say which policy: language (assimilate, tolerate, autonomy) or faith (state, tolerate, secular).'); if (op.language) c.languagePolicy = op.language; if (op.faith) c.faithPolicy = op.faith; news(w, `${c.name} changed its policy toward peoples and faiths.`, { kind: 'politics', countries: [c.id] }); return { ok: true, msg: `The country's policy: language ${c.languagePolicy}, faith ${c.faithPolicy}. Rules made for single provinces or peoples stand beside it.` }; }
      const rules = (c.cultureRules ||= []), at = rules.findIndex(r => (r.province ?? null) === (prov?.id ?? null) && String(r.people ?? '').toLowerCase() === people.toLowerCase()), scope = `${people ? `the ${people}` : 'everyone'}${prov ? ` in ${prov.name}` : ' throughout the country'}`;
      if (op.clear === true) { if (at < 0) return fail(`There is no rule of its own for ${scope}.`); rules.splice(at, 1); if (!rules.length) delete c.cultureRules; return { ok: true, msg: `The rule for ${scope} is withdrawn; the country's policy applies there again.` }; }
      if (!op.language && !op.faith) return fail('Say which policy the rule sets: language (assimilate, tolerate, autonomy) or faith (state, tolerate, secular).');
      if (at < 0 && rules.length >= 24) return fail('The statute book holds as many such rules as officials can keep apart; one would have to be withdrawn first.');
      const rule = at >= 0 ? rules[at] : { ...(prov ? { province: prov.id } : {}), ...(people ? { people } : {}) }; if (op.language) rule.language = op.language; if (op.faith) rule.faith = op.faith; if (at < 0) rules.push(rule);
      news(w, `${c.name} made a rule of its own for ${scope}: ${[rule.language ? `language ${rule.language}` : '', rule.faith ? `faith ${rule.faith}` : ''].filter(Boolean).join(', ')}.`, { kind: 'politics', countries: [c.id], ...(prov ? { province: prov.id } : {}) });
      return { ok: true, msg: `For ${scope}: ${[rule.language ? `language ${rule.language}` : '', rule.faith ? `faith ${rule.faith}` : ''].filter(Boolean).join(', ')}. Where a rule names both a province and a people it goes before one that names only the people, that before one for the province, and all of them before the country's policy (language ${c.languagePolicy}, faith ${c.faithPolicy}).` };
    }
    case 'appoint_governor': { const p = w.provinces[op.province]; if (!p || p.controller !== c.id) return fail('Province not yours.'); if (op.remove) { tell(w, w.characters[p.governor], c.name, `You are removed as governor of ${p.name}.`); p.governor = null; return ok(); } const ch = personFor(w, c, op, 'governor'); if (!ch || ch.country !== c.id || ch.status !== 'free') return fail(noPerson('No such person.')); p.governor = ch.id; tell(w, ch, c.name, `You are appointed governor of ${p.name}.`); return { ok: true, msg: `${ch.name} (${ch.id}) governs ${p.name}.` }; }
    case 'appoint_commander': { if (op.fleet) { const f = w.fleets[op.fleet]; if (!f || f.country !== c.id) return fail('No such fleet of yours.'); const ch = personFor(w, c, op, 'officer'); if (!ch || ch.country !== c.id || ch.status !== 'free') return fail(noPerson('No such person.')); f.commander = ch.id; tell(w, ch, c.name, `You now command the squadron ${f.id}.`); return { ok: true, msg: `${ch.name} (${ch.id}) commands the squadron ${f.id}.` }; }
      // "The reservists forming at Ordgaron are placed under Colonel Aksoy": the unit may be named by where it stands (the largest of ours there
      // that has no commander of its own, else the largest).
      // Troops sent there this very quarter count as the troops of that place (world 16: "detach five thousand to Tolhanir under Demirhan"
      // was answered "no unit of ours stands at Tolhanir" for the commander and for the digging, and obeyed for the posture).
      const here = !op.unit && w.provinces[op.province] ? Object.values(w.units).filter(x => x.country === c.id && (x.province === op.province || (x.target === op.province && x.marchSince === w.turn))).sort((a, b) => (w.characters[a.commander]?.alive ? 1 : 0) - (w.characters[b.commander]?.alive ? 1 : 0) || b.men - a.men)[0] : null;
      const u = w.units[op.unit] ?? here; if (!u || u.country !== c.id) return fail(op.unit ? 'No such unit.' : op.province ? `No unit of ours stands at ${w.provinces[op.province]?.name ?? op.province}.` : 'Say which troops he is to command: the unit (unit), the squadron (fleet), or the province where the troops stand (province).'); const ch = personFor(w, c, op, 'officer'); if (!ch || ch.country !== c.id || ch.status !== 'free') return fail(noPerson('No such person.')); u.commander = ch.id; tell(w, ch, c.name, `You now command unit ${u.id}.`); return { ok: true, msg: `${ch.name} (${ch.id}) commands ${u.id}.` }; }
    case 'propose_contract': { const k = proposeContract(w, actor, op, num); if (!k) return fail('No such counterparty.');
      // The paper as it will be read by whoever is asked to sign it: what moves each quarter, and from whose account.
      const nm = id => w.characters[id]?.name ?? id, r = v => Math.round(v * 10) / 10, onState = id => k.purse?.[id] ? ` (on the account of ${w.countries[k.purse[id]]?.name})` : '';
      const goods = k.good && k.amount > 0 ? `${nm(k.seller)}${onState(k.seller)} delivers ${r(k.amount)} of ${GOOD_LABEL[k.good] ?? k.good} a quarter` : op.good ? `it names ${GOOD_LABEL[op.good] ?? op.good} but no quantity, so nothing is delivered under it` : 'no goods move under it', money = k.payer && k.pay > 0 ? `${nm(k.payer)}${onState(k.payer)} pays ${r(k.pay)} a quarter${k.good && k.amount > 0 ? ` (${r(k.pay / k.amount)} a unit)` : ''}` : 'no money is paid under it';
      return { ok: true, msg: `Contract offered: ${k.id}, for ${k.turns} quarters: ${goods}; ${money}. Whatever else its words say binds only as far as the two who sign keep it.`, contract: k.id }; }
    case 'accept_contract': { const k = acceptContract(w, actor, op.id, op.from, op.state) ?? (op.state === true ? toStateAccount(w, actor, op.id) : null); return k ? { ok: true, msg: `Contract ${k.id} is in force${k.purse?.[actor.id] ? ", on the treasury's account" : ''}.` } : fail('No such offer is waiting for you.'); }
    // The state pays a person: a salary, a grant, a reward, a reimbursement, compensation. It is done in the open, and the money really leaves the treasury.
    case 'pay_person': {
      const ch = has(w.characters, op.character) ? w.characters[op.character] : Object.values(w.characters).find(x => x.alive && x.name.toLowerCase() === String(op.character ?? '').toLowerCase()); if (!ch?.alive) return fail('No such person.');
      const paidOut = c._grants?.turn === w.turn ? c._grants.paid : 0, want = num(op.amount, 0, 1e9, 0), m = treasuryPays(c, Math.max(0, Math.min(want, gdp * .005 - paidOut))); if (m > 0) { c._grants = { turn: w.turn, paid: paidOut + m }; (c._outlay ||= {}).persons = (c._outlay.persons || 0) + m; } if (!(m > .01)) return fail(want > 0 ? 'The treasury has paid out all it can to persons this quarter, or lenders will not cover it.' : 'No amount was named.');
      ch.wealth += m; const self = ch.id === actor.id, why = String(op.reason || '').slice(0, 120);
      // People who watch their ruler draw on the treasury for himself think the less of him, the more he takes.
      if (self) c.legitimacy = clamp(c.legitimacy - Math.min(5, m / Math.max(gdp * .002, .01)), 0, 100); else tell(w, ch, 'Treasury', `The treasury of ${c.name} paid you ${Math.round(m * 10) / 10}${why ? `: ${why}` : ''}.`);
      if (m >= gdp * .001 || self) news(w, `${c.name}: the treasury paid ${Math.round(m)} to ${self ? `${ch.name}, who governs` : ch.name}${why ? ` (${why})` : ''}.`, { kind: 'economy', countries: [c.id] });
      return { ok: true, msg: `The treasury paid ${Math.round(m * 10) / 10} to ${ch.name}${m < want - .01 ? `, not the ${Math.round(want * 10) / 10} ordered: that is all it can pay out to persons this quarter` : ''}.` };
    }
    // Buying a minor person, at home or abroad, to report what passes through his post. Whoever governs pays from the treasury, anyone else from their own purse.
    case 'recruit_informant': {
      let ch = has(w.characters, op.character) ? w.characters[op.character] : Object.values(w.characters).find(x => x.alive && x.name.toLowerCase() === String(op.character ?? '').toLowerCase());
      // No name, but an office: a clerk there whom nobody has heard of, and who sees less than his chief.
      // The man in that office who named his price last time is the man approached again: a second offer does not go to a stranger.
      const desk = ['treasury', 'police', 'house', 'army'].includes(op.office) ? `${(target ?? c).id}:${op.office}` : null, last = desk ? w.characters[actor.sounded?.[desk]] : null;
      if (!ch && last?.alive && last.status === 'free' && !last.handler && last.country === (target ?? c).id) ch = last;
      if (!ch && desk) { const where = target ?? c; if (allowance(w, actor, `approach:${where.id}:${op.office}`, 1, 1) <= 0) return fail('That office has been sounded once this quarter; a second approach so soon would be noticed.'); ch = personFor(w, where, { name: op.name }, 'official'); if (ch) { ch.clerkOf = op.office; ch.power = 12; ch.nobody = true; } else return fail(noPerson('No one in that office could be approached.')); }
      if (!ch?.alive || ch.status !== 'free' || ch.id === actor.id) return fail('No such person. Name someone, or say which office the informant should sit in (office: treasury, police, house or army).');
      if (!isMinor(ch)) return fail(`${ch.name} is no one's clerk: what passes between you and such a person is for the two of you to settle by letter.`);
      if (ch.handler) return fail(ch.handler === actor.id ? `${ch.name} already reports to you.` : `${ch.name} would not be bought.`);
      // A man who has said no this quarter does not say yes because the same offer comes round again.
      if (!ch.nobody && allowance(w, actor, `approach:${ch.id}`, 1, 1) <= 0) return fail(`${ch.name} has given ${his(ch)} answer this quarter; ${he(ch)} can be approached again in the next.`);
      // Whoever governs pays from the secret vote; so does the chief of staff for a man in a foreign army, which is his own service's work. Anybody
      // else pays from his own pocket.
      const ruler = governs(w, c, actor), state = ruler || (c.general === actor.id && ch.country !== c.id && (ch.clerkOf === 'army' || ch.role === 'officer')), want = num(op.amount, 0, 1e6, 0), m = state ? treasuryPays(c, allowance(w, c, 'secret_funds', gdp * .002, want)) : Math.min(Math.max(actor.wealth, 0), want);
      // A government that tells its own servant to report to it asks for his duty and need put no money behind the asking.
      const servant = ruler && ch.country === c.id && inService(w, ch);
      if (!(m >= 1) && !servant) { if (ch.nobody) delete w.characters[ch.id]; return fail(want < 1 ? 'Name the sum that is put behind the approach (amount): nobody outside the state\'s own service reports for nothing.' : state ? 'The secret vote is spent for this quarter and the treasury can add nothing to it.' : `It is paid from your own pocket, and your purse holds ${Math.round(Math.max(actor.wealth, 0) * 10) / 10}${c.general === actor.id ? ' (a man in a foreign army is paid from the staff\'s secret vote: office army, with the state named as target)' : ''}.`); }
      const r = recruitInformant(w, actor, ch, m); if (r.ok && !state) actor.wealth -= m; if (!r.ok && state) c.treasury += m;
      if (desk && !r.ok && r.priced) (actor.sounded ||= {})[desk] = ch.id; else if (desk && actor.sounded) delete actor.sounded[desk];
      // A clerk nobody had heard of, who would not be bought and said nothing, stays nobody. One who went to his ruler with it has been named
      // to the ruler and is a person from then on: the ruler he reported to can reward him, promote him or use him.
      if (ch.nobody) { if (r.ok || r.told || r.priced) delete ch.nobody; else delete w.characters[ch.id]; }
      return r.ok ? r : fail(r.msg);
    }
    // Money for the armed underground, at home or (with target) in another country. From the actor's own purse.
    case 'fund_underground': { const where = target ?? c, m = Math.min(Math.max(actor.wealth, 0), num(op.amount, 0, 1e6, 0)); if (!(m >= 1)) return fail('No money to give them.'); actor.wealth -= m; return fundUnderground(w, actor, where, m, leaveTrace); }
    // The lawful road against a person: a charge, a court, a verdict next quarter. Brought by whoever governs, on what is in their file.
    case 'prosecute': {
      const ch = has(w.characters, op.character) ? w.characters[op.character] : null; if (!ch?.alive || ch.country !== c.id || ch.id === actor.id) return fail('No such person here to charge.');
      if (!op._law && !governs(w, c, actor)) return fail('Only the government brings a prosecution.');
      // Someone already in a cell can be brought before the court like anyone else: that is what gives an arrest a verdict and a term. Someone abroad cannot.
      if (ch.id === c.leader) return fail('The head of the government is not charged by their own prosecutors.'); if (ch.status === 'exiled') return fail(`${ch.name} is abroad, beyond the reach of the court.`);
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
      if (op.join === false) { if (!list.includes(party.id)) return fail(`${party.name} is not on the government's benches.`); if (!ruling && !mine.includes(party)) return fail('That party is not yours to take out.'); c.coalition = list.filter(x => x !== party.id); if (c.coalitionBy) delete c.coalitionBy[party.id]; news(w, `${c.name}: ${party.name} has left the government's benches.`, { kind: 'politics', countries: [c.id] }); return { ok: true, msg: `${party.name} no longer supports the government. It counts on ${governmentSeats(c)} seats.` }; }
      if (list.includes(party.id)) return fail(`${party.name} already sits with the government.`);
      // Whoever leads a party onto the government's benches goes on speaking for it there, and may lead it off again.
      if (!ruling) { if (!mine.includes(party)) return fail('That party is not yours to lead in.'); list.push(party.id); (c.coalitionBy ||= {})[party.id] = actor.id; }
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
    // Money for a party's committees, organisers and dues. From the giver's own purse; whoever governs may take it from the treasury, which is a secret worth having.
    case 'fund_party': {
      // Money for a party in another country: it reaches the party, and it is a secret at both ends that costs the party dear if it comes out.
      if (target) { const p = target.parties.find(x => !x.banned && (x.id === op.party || x.name.toLowerCase() === String(op.party ?? '').trim().toLowerCase())); if (!p) return fail(`No such party in ${target.name}. Those that stand there: ${target.parties.filter(x => !x.banned).map(x => `${x.id} ${x.name}`).join(', ')}.`);
        const state = op.state === true && governs(w, c, actor), want = num(op.amount, 0, 1e6, 0), m = state ? treasuryPays(c, allowance(w, c, 'secret_funds', gdp * .002, want)) : Math.min(Math.max(actor.wealth, 0), want); if (!(m >= .5)) return fail('No money was sent.'); if (!state) actor.wealth -= m;
        const gold = { party: p.id, country: target.id, from: c.id, state }, head = Object.values(w.characters).find(x => x.alive && x.country === target.id && leadsParties(w, target, x).includes(p) && x.id !== target.leader) ?? Object.values(w.characters).find(x => x.alive && x.country === target.id && leadsParties(w, target, x).includes(p));
        p.funds = (p.funds || 0) + m; (actor.secrets ||= []).push({ turn: w.turn, text: `Sent ${Math.round(m)} ${state ? `of the treasury's money ` : ''}to the funds of ${p.name} in ${target.name}.`, gold: { ...gold } }); actor.secrets = actor.secrets.slice(-12);
        if (head) { (head.secrets ||= []).push({ turn: w.turn, text: `${p.name}, which ${head.name} leads, took ${Math.round(m)} from ${c.name}.`, gold: { ...gold } }); head.secrets = head.secrets.slice(-12); tell(w, head, 'The party treasurer', `${Math.round(m * 10) / 10} has reached the funds of ${p.name} from ${c.name}, through ${actor.name}. Nobody else knows where it came from; if it came out, the party would be called bought.`); }
        return { ok: true, msg: `${Math.round(m * 10) / 10} reached the funds of ${p.name} in ${target.name}${head ? `; ${head.name}, who leads it, knows where it came from` : ''}. It is a secret at both ends: if it comes out there, the party loses a fifth of its following as foreign gold${state ? `, and ${target.name} holds it against this government` : ''}.` }; }
      const p = c.parties.find(x => x.id === op.party && !x.banned) ?? leadsParties(w, c, actor)[0]; if (!p) return fail('No such party.');
      // Its own chest, spent now: a drive of organisers and committees beyond the fifth of the chest that goes on them every quarter.
      if (op.from === 'party') { if (!leadsParties(w, c, actor).includes(p)) return fail(`The chest of ${p.name} is its leader's to spend.`); const m = Math.min(Math.max(p.funds || 0, 0), num(op.amount, 0, 1e6, 0)); if (!(m >= .5)) return fail(`The chest of ${p.name} holds ${Math.round((p.funds || 0) * 10) / 10}.`); p.funds -= m; p.drive = (p.drive || 0) + m; return { ok: true, msg: `${Math.round(m * 10) / 10} of the chest of ${p.name} goes this quarter on organisers, committees and meetings, beyond the fifth of the chest it spends on them every quarter; ${Math.round(p.funds * 10) / 10} is left in it. Its organisation stands at ${Math.round(p.organization || 0)} of 60 and follows what is spent.` }; }
      const state = op.state === true && governs(w, c, actor), want = num(op.amount, 0, 1e6, 0), m = state ? treasuryPays(c, allowance(w, c, 'party_funds', gdp * .002, want)) : Math.min(Math.max(actor.wealth, 0), want); if (!(m >= .5)) return fail(want < .5 ? 'No sum was named.' : state ? 'The treasury has paid the parties what it will this quarter.' : `It comes from your own purse, which holds ${Math.round(Math.max(actor.wealth, 0) * 10) / 10}. (What lies in the party's own chest is spent with from:"party".)`);
      if (state) leaveTrace(w, actor, `Paid ${Math.round(m)} of the treasury's money into the funds of ${p.name}.`); else actor.wealth -= m;
      // Who paid in is known to the party's treasurer, and to whoever has the party watched.
      (p.gifts ||= []).push({ turn: w.turn, from: actor.id, amount: m }); p.gifts = p.gifts.slice(-12);
      p.funds = (p.funds || 0) + m; return { ok: true, msg: `${Math.round(m * 10) / 10} went into the funds of ${p.name}. A party spends a fifth of its funds each quarter on organisation; it holds what it is paid for.` };
    }
    case 'found_paper': {
      if (papersOf(c).length >= MAX_PAPERS) return fail('The country has as many newspapers as it will read; one would have to close first.');
      const m = Math.min(Math.max(actor.wealth, 0), num(op.amount, 0, 1e6, 0)); if (!(m >= 3)) return fail(`A newspaper needs a press, paper and men: at least 3 to begin with${num(op.amount, 0, 1e6, 0) >= 3 ? `, and your purse holds ${Math.round(Math.max(actor.wealth, 0) * 10) / 10}` : ''}.`);
      actor.wealth -= m; const n = foundPaper(w, c, actor, op.name, m); news(w, `${c.name}: a new paper, ${n.name}, has begun to appear. It belongs to ${actor.name}.`, { kind: 'politics', countries: [c.id] });
      // A line given at the founding is the same order as one given later.
      const line = ['serves', 'targets', 'spare', 'print'].some(k => op[k] != null) ? setPaper(w, c, actor, { ...op, id: n.id, name: undefined }) : null;
      return { ok: true, paper: n.id, msg: `${n.name} (${n.id}) is founded with ${Math.round(m * 10) / 10}. It spends about a seventh of its funds each quarter and reaches readers as far as people can read and the law allows. ${line?.ok ? line.msg : `${line ? `${line.msg} As it stands, it` : 'Left to itself it'} ${paperWords(w, c, n)}; its reporters dig among those in office, ${c.leader === actor.id ? 'the leader of the opposition' : 'the head of the government'} first, and print at once what they find about anyone but you.`} Whom it serves, whom its reporters go after and leave alone, and whether a find is printed or held back for your own file is yours to say (set_paper).` };
    }
    // The owner's line for his paper; and, for whoever governs, the censor, short of closing it.
    case 'set_paper': { const r = setPaper(w, c, actor, op); return r.ok ? r : fail(r.msg); }
    case 'censor': { if (!governs(w, c, actor)) return fail('Only whoever governs sets a censor on the press.'); const r = censor(w, c, actor, op); return r.ok ? r : fail(r.msg); }
    case 'fund_paper': { const where = target ?? c, n = findPaper(where, op.id ?? op.paper ?? op.name); if (!n) return fail(`No such newspaper${target ? ` in ${target.name}` : ''}.${papersOf(where).length ? ` Those that appear there: ${papersOf(where).map(x => `${x.name} (${x.id})`).join(', ')}.` : ''}`);
      // A party's leader may keep a paper out of the party's chest.
      if (op.from === 'party' && !target) { const p = leadsParties(w, c, actor)[0]; if (!p) return fail('You lead no party whose chest could pay.'); const m = Math.min(Math.max(p.funds || 0, 0), num(op.amount, 0, 1e6, 0)); if (!(m >= .5)) return fail(`The chest of ${p.name} holds ${Math.round((p.funds || 0) * 10) / 10}.`); p.funds -= m; n.funds += m; return { ok: true, msg: `${Math.round(m * 10) / 10} went from the chest of ${p.name} to ${n.name}; ${Math.round(p.funds * 10) / 10} is left in the chest.` }; }
      const state = !!target && op.state === true && governs(w, c, actor), want = num(op.amount, 0, 1e6, 0), m = state ? treasuryPays(c, allowance(w, c, 'secret_funds', gdp * .002, want)) : Math.min(Math.max(actor.wealth, 0), want); if (!(m >= .5)) return fail(want < .5 ? 'No sum was named.' : state ? 'The secret vote is spent for this quarter.' : `It comes from your own purse, which holds ${Math.round(Math.max(actor.wealth, 0) * 10) / 10}. (A party's leader can pay a paper from the party's chest: from:"party".)`); if (!state) actor.wealth -= m; n.funds += m;
      // Money for a paper in another country is a secret of the giver and of its owner, and readers leave a paper that is shown to be kept from abroad.
      if (target) { const gold = { paper: n.id, country: target.id, from: c.id, state }, owner = w.characters[n.owner]; (actor.secrets ||= []).push({ turn: w.turn, text: `Sent ${Math.round(m)} ${state ? `of the treasury's money ` : ''}to the paper ${n.name} in ${target.name}.`, gold: { ...gold } }); actor.secrets = actor.secrets.slice(-12);
        if (owner?.alive && owner.id !== actor.id) { (owner.secrets ||= []).push({ turn: w.turn, text: `${n.name}, the paper of ${owner.name}, took ${Math.round(m)} from ${c.name}.`, gold: { ...gold } }); owner.secrets = owner.secrets.slice(-12); tell(w, owner, n.name, `${Math.round(m * 10) / 10} has reached ${n.name} from ${c.name}, through ${actor.name}. Nobody else knows where it came from.`); }
        return { ok: true, msg: `${Math.round(m * 10) / 10} reached ${n.name} in ${target.name}; its owner knows where it came from. Its line stays its owner's to give. It is a secret at both ends: if it comes out, readers leave the paper${state ? ` and ${target.name} holds it against this government` : ''}.` }; }
      return { ok: true, msg: `${Math.round(m * 10) / 10} went to ${n.name}.` }; }
    // A grievance made to order; an amnesty; and what one person lays before another about a third.
    case 'stage_incident': { if (!target) return fail('No such neighbour.'); if (!governs(w, c, actor) && c.general !== actor.id) return fail('Only whoever governs or the chief of the general staff has soldiers to do it with.'); const r = stageIncident(w, c, actor, target, op); return r.ok ? r : fail(r.msg); }
    // A bought man the police have found out and not yet taken can be left at his post to write what his ruler wants believed.
    case 'turn_informant': {
      if (!governs(w, c, actor)) return fail('Only whoever governs has the police who found him out.');
      const ch = has(w.characters, op.character) ? w.characters[op.character] : Object.values(w.characters).find(x => x.alive && x.country === c.id && x.name.toLowerCase() === String(op.character ?? '').trim().toLowerCase());
      if (!ch?.alive || ch.country !== c.id || ch.status !== 'free' || !(ch.caught || ch.turned)) return fail('Only a man the police have found passing papers and have not yet taken can be turned; nobody of that name is in that position. One who is already in a cell is known to his paymaster to be lost.');
      const h = w.characters[ch.handler], show = op.show === 'weak' ? 'weak' : 'strong', was = ch.turned?.show; ch.turned = { by: actor.id, since: ch.turned?.since ?? w.turn, show }; delete ch.caught;
      if (was === show) return { ok: true, msg: `${ch.name} goes on as ordered: what ${he(ch)} sends ${h?.name ?? his(ch) + ' paymaster'} shows us ${show}.` };
      leaveTrace(w, ch, `Was found out, and has since written to ${h?.name ?? his(ch) + ' paymaster'} what the government told ${him(ch)} to.`);
      return { ok: true, msg: `${ch.name} keeps ${his(ch)} post and ${his(ch)} paymaster. From now on what ${he(ch)} sends ${h?.name ?? his(ch) + ' paymaster'}${h && h.country !== c.id ? ` of ${w.countries[h.country]?.name}` : ''} is ours: letters of the same kind as before, showing us ${show === 'strong' ? 'stronger, better paid and more content than we are' : 'weaker, worse paid and nearer to falling than we are'}${h && h.country !== c.id ? `, and what ${w.countries[h.country]?.name} knows of us grows worse with every one` : ''}. ${He(ch)} copies no more plans and no more treaties. It lasts until ${he(ch)} is arrested, loses ${his(ch)} liberty or ${his(ch)} paymaster dies; show can be changed (strong or weak).` };
    }
    case 'amnesty': { if (!op._law && !governs(w, c, actor)) return fail('Only whoever governs declares an amnesty.'); const r = amnesty(w, c, actor, op); return r.ok ? r : fail(r.msg); }
    case 'denounce': { const find = k => has(w.characters, k) ? w.characters[k] : Object.values(w.characters).find(x => x.alive && x.name.toLowerCase() === String(k ?? '').trim().toLowerCase()), x = find(op.character), to = op.to != null ? find(op.to) : w.characters[c.leader];
      if (!x?.alive || x.id === actor.id) return fail('No such person to denounce.'); if (!to?.alive || to.id === actor.id || to.id === x.id) return fail(to?.id === actor.id ? 'You cannot lay it before yourself: say to whom (to).' : 'No such person to lay it before.');
      const r = denounce(w, actor, x, to, op); return r.ok ? r : fail(r.msg); }
    // Shutting a newspaper is an act of state and is seen as one.
    case 'close_paper': {
      // A paper is known by its name as much as by its number in the register.
      const n = findPaper(c, op.id ?? op.paper ?? op.name); if (!n) return fail(`No such newspaper.${papersOf(c).length ? ` Those that appear here: ${papersOf(c).map(x => `${x.name} (${x.id})`).join(', ')}.` : ''}`); if (!governs(w, c, actor) && n.owner !== actor.id) return fail('It is not yours to close.');
      c.papers = c.papers.filter(x => x !== n); if (n.owner === actor.id) return { ok: true, msg: `${n.name} has ceased to appear.` };
      c.pressFreedom = clamp(c.pressFreedom - 6, 0, 100); c.legitimacy = clamp(c.legitimacy - (2 + n.reach / 15), 0, 100); news(w, `${c.name}: the government has closed ${n.name}.`, { kind: 'politics', countries: [c.id] }); tell(w, w.characters[n.owner], c.name, `Your paper ${n.name} has been closed by order of ${actor.name}.`);
      return { ok: true, msg: `${n.name} is closed. The country saw who did it.` };
    }
    // Lending one's own money to a state against its paper, and selling that paper again.
    case 'buy_bonds': { const where = target ?? c, m = Math.min(Math.max(actor.wealth, 0), num(op.amount, 0, 1e6, 0)); if (!(m >= 1)) return fail('No money to lend.'); if (where.defaulted) return fail(`${where.name} is in default and is selling no paper.`); return buyBonds(w, where, actor, m); }
    case 'sell_bonds': { const where = target ?? c; return sellBonds(w, where, actor, num(op.amount, 0, 1e6, 0)) ?? fail(`You hold none of ${where.name}'s paper.`); }
    // A disputed succession: declaring for the one who holds the palace or for the one who claims it, or giving the claim up.
    case 'back_claim': { const d = c.dispute; if (!d) return fail('No succession is in dispute here.'); if ([d.holder, d.claimant].includes(actor.id)) return fail('You are one of the two; the others declare for you or against.'); const side = op.character === d.claimant ? 'claimant' : op.character === d.holder ? 'holder' : null; if (!side) return fail('Declare for one of the two.'); d.backers[actor.id] = side; const whom = w.characters[side === 'claimant' ? d.claimant : d.holder]; tell(w, whom, actor.name, `${actor.name} has declared for you in the disputed succession.`); news(w, `${c.name}: ${actor.name} has declared for ${whom.name} in the disputed succession.`, { kind: 'politics', countries: [c.id] }); return { ok: true, msg: `You have declared for ${whom.name}. It will count when the matter is settled.` }; }
    case 'renounce_claim': { const d = c.dispute; if (!d || d.claimant !== actor.id) return fail('No claim is being made in your name.'); d.renounced = true; return { ok: true, msg: 'You have let it be known that you make no claim. The country will settle.' }; }
    // Putting someone else in one of the two great offices. The one who is put out does not thank the government for it.
    case 'appoint_minister': {
      const post = ['treasury', 'police'].includes(op.post) ? op.post : null; if (!post) return fail('The post is treasury or police.'); if (!governs(w, c, actor)) return fail('Only whoever governs fills these offices.');
      const ch = personFor(w, c, op, 'official'); if (!ch?.alive || ch.country !== c.id || ch.status !== 'free' || ROLES.some(r => c[r] === ch.id)) return fail(noPerson('No such person for the post.'));
      const old = Object.values(w.characters).find(x => x.alive && x.country === c.id && x.post === post && x.id !== ch.id);
      if (old) { old.post = null; old.loyalty = clamp(old.loyalty - 25, 0, 100); tell(w, old, c.name, `You are relieved of your office; ${ch.name} takes it.`); }
      ch.post = post; tell(w, ch, c.name, post === 'treasury' ? 'You are appointed keeper of the treasury.' : 'You are appointed chief of police.');
      return { ok: true, msg: `${ch.name} (${ch.id}) now ${post === 'treasury' ? 'keeps the treasury' : 'heads the police'}${old ? `; ${old.name}, who held the office, is out and resents it` : ''}.` };
    }
    // The chief of staff holds an office the ruler fills. Dismissing him is in the ruler's power; how he and the army take it is another matter.
    case 'dismiss': {
      if (!governs(w, c, actor)) return fail('Only whoever governs dismisses the chief of staff.');
      const ch = w.characters[c.general]; if (!ch?.alive || (op.character && op.character !== ch.id) || ch.id === actor.id) return fail('Only the chief of the general staff holds an office the ruler can simply take away. Others are removed by arrest, exile or a court (purge, prosecute), or put out of a ministry (appoint_minister).');
      // A general with a stroke already prepared answers with it.
      const pl = w.plots.find(p => p.active && p.kind === 'coup' && [p.leader, ...p.members].includes(ch.id));
      if (pl) { const out = executePlot(w, pl); if (c.leader !== actor.id) return fail(`${ch.name} answered the dismissal with the stroke ${he(ch)} had prepared. ${out}`); return { ok: true, msg: `${ch.name} answered the dismissal with the stroke ${he(ch)} had prepared, and it failed. ${out}` }; }
      // Whoever is named in the order takes the office; failing that the standing deputy, if one was named; failing that a man the army puts forward.
      const standby = w.characters[c.deputies?.general], next = op.successor || op.name ? personFor(w, c, { character: op.successor, name: op.name }, 'officer') : standby?.alive && standby.status === 'free' && standby.country === c.id && standby.id !== ch.id ? standby : spawnCharacter(w, c.id, 'general', c.axes);
      if (next && c.deputies?.general === next.id) delete c.deputies.general;
      if (!next?.alive || next.country !== c.id || next.status !== 'free' || ROLES.some(r => r !== 'general' && c[r] === next.id)) return fail(noPerson(`No such person to put in ${his(ch)} place.`));
      for (const u of Object.values(w.units)) if (u.commander === next.id) u.commander = null;
      next.role = 'general'; next.post = null; next.power = Math.max(next.power, 45); c.general = next.id; ch.outSince = w.turn; next.rise = `Was made chief of the general staff in ${w.date ?? 'the first days'} when ${ch.name} was dismissed.`;
      // The army does not like to see its chief sent away, the more so the more he counted for.
      const sting = clamp(ch.power / 14, 1, 7); for (const u of Object.values(w.units)) if (u.country === c.id) u.loyalty = clamp(u.loyalty - sting, 0, 100); c.blocs.army.sat = clamp(c.blocs.army.sat - sting, 0, 100);
      tell(w, ch, c.name, `You are dismissed as chief of the general staff by order of ${actor.name}. ${next.name} has your office. You keep your rank, your name and your friends.`); tell(w, next, c.name, 'You are appointed chief of the general staff.');
      news(w, `${c.name}: ${ch.name} was dismissed as chief of the general staff; ${next.name} takes the office.`, { kind: 'politics', countries: [c.id] });
      return { ok: true, msg: `${ch.name} is dismissed and ${next.name} (${next.id}) is chief of the general staff. The army took it badly in proportion to what ${he(ch)} counted for; ${he(ch)} is a private person now, and free.` };
    }
    // A fine laid on a person by the government. Where judges are their own masters they may strike it down.
    case 'fine': {
      if (!governs(w, c, actor)) return fail('Only the government lays fines.');
      const ch = has(w.characters, op.character) ? w.characters[op.character] : null; if (!ch?.alive || ch.country !== c.id || ch.id === actor.id || ch.status === 'exiled') return fail('No such person within reach.');
      { const no = courtBlocks(w, c, `fine:${ch.id}`, c.courts / 250); if (no === 'now') news(w, `${c.name}: a court struck down the fine laid on ${ch.name}.`, { kind: 'politics', countries: [c.id] }); if (no) return fail(no === 'again' ? `The court has struck down a fine on ${ch.name} this quarter and will strike down another.` : 'The court struck the fine down.'); }
      const m = Math.min(Math.max(0, ch.wealth - (ch.abroad || 0)), num(op.amount, 0, 1e6, 0)); if (!(m > .01)) return fail(`${ch.name} has nothing within reach to pay with.`);
      ch.wealth -= m; c.treasury += m; tell(w, ch, c.name, `You have been fined ${Math.round(m * 10) / 10}${op.reason ? `: ${String(op.reason).slice(0, 140)}` : ''}. It has been taken.`);
      if (m >= 5) news(w, `${c.name}: ${ch.name} was fined ${Math.round(m)}${op.reason ? ` (${String(op.reason).slice(0, 100)})` : ''}.`, { kind: 'politics', countries: [c.id] });
      return { ok: true, msg: `${Math.round(m * 10) / 10} was taken from ${ch.name} into the treasury.` };
    }
    // Taking money out of a body one heads: gifts in the hands of a private fund, or a slice of a state office's budget. Unless it is the founder's own money, it is a secret.
    case 'draw_institution': {
      const inst = (c.institutions || []).find(i => i.id === op.id); if (!inst) return fail('No such institution.'); if (inst.head !== actor.id && inst.sponsor !== actor.id) return fail('You neither head it nor founded it.');
      const want = num(op.amount, 0, 1e6, 0);
      if (inst.sponsor) { const m = Math.min(inst.endowment || 0, want); if (!(m > .01)) return fail(`${inst.name} holds no gifts to draw on; what it spends each quarter comes straight from its founder.`); inst.endowment -= m; actor.wealth += m; leaveTrace(w, actor, `Took ${Math.round(m)} for themselves out of what had been given to ${inst.name}.`); return { ok: true, msg: `${Math.round(m * 10) / 10} came out of the gifts held by ${inst.name} into your purse. It was given for another purpose, and that can be found out.` }; }
      const m = allowance(w, inst, 'skim', (inst.budget || 0) * gdp * .25, want); if (!(m > .01)) return fail(`There is nothing more to be had from ${inst.name} this quarter.`);
      c.treasury -= Math.min(Math.max(c.treasury, 0), m); actor.wealth += m * .5; inst.funding = clamp((inst.funding ?? .5) - .2, 0, 1.2); leaveTrace(w, actor, `Took ${Math.round(m)} out of the budget of ${inst.name}.`);
      return { ok: true, msg: `${Math.round(m * .5 * 10) / 10} reached your purse out of the budget of ${inst.name}; as much again went to those who had to look away. The office works the worse for it, and it can be found out.` };
    }
    // Bringing home money that lies abroad.
    case 'repatriate': { const m = Math.min(actor.abroad || 0, num(op.amount, 0, 1e6, actor.abroad || 0)); if (!(m > .01)) return fail('You hold nothing abroad.'); // It comes back out of the gold of the country it lay in; a haven with empty vaults cannot pay it out.
      const lies = Object.entries(actor.abroadIn || {}).filter(([id, v]) => v > 0 && w.countries[id]?.alive).map(([id]) => w.countries[id]), havens = lies.length ? lies : aliveCountries(w).filter(o => o.id !== c.id).sort((a, b) => b.reserves - a.reserves).slice(0, 1); let back = 0;
      for (const h of havens) { const part = Math.min(m - back, Math.max(h.reserves, 0), actor.abroadIn?.[h.id] ?? Infinity); if (part > 0) { h.reserves -= part; back += part; if (actor.abroadIn?.[h.id]) actor.abroadIn[h.id] -= part; } }
      if (!(back > .01)) return fail('The house abroad that holds your money cannot pay it out in gold now.');
      actor.abroad -= back; c.reserves += back; return { ok: true, msg: `${Math.round(back * 10) / 10} of your money abroad is home again, and within the state's reach${back < m - .01 ? '; the rest could not be paid out in gold now' : ''}.` }; }
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
    // The frontier, good by good. Left alone, every good comes in under the general tariff and goes out as merchants can spare it. Whoever governs can give one good
    // a duty of its own, a quota or a prohibition, forbid or limit its export, and say what the country's gold is spent on first when it is short.
    case 'set_import': case 'set_export': {
      if (!GOODS.includes(op.good)) return fail('No such good.');
      const inward = op.op === 'set_import', book = inward ? ((c.imports ||= {}).rules ||= {}) : (c.exports ||= {}), name = GOOD_LABEL[op.good], was = book[op.good];
      if (op.clear === true) { delete book[op.good]; return { ok: true, msg: inward ? `${name} comes in again under the general tariff of ${pc(c.tariff)}, as much as merchants care to bring.` : `${name} goes out again as merchants can spare it.` }; }
      const r = { ...(was || {}) };
      if (op.ban === true) { r.ban = true; delete r.quota; } else if (op.ban === false) delete r.ban;
      if (op.quota != null) { r.quota = num(op.quota, 0, 1e6, 0); delete r.ban; }
      if (inward && op.tariff != null) r.tariff = num(op.tariff, 0, 1);
      if (!r.ban && r.quota == null && r.tariff == null) return fail(inward ? 'Name a duty, a quota or a prohibition for it, or clear the rule.' : 'Name a quota or a prohibition for it, or clear the rule.');
      book[op.good] = r; const seal = sealOf(w, c), what = [r.ban ? (inward ? 'may not be brought in' : 'may not be sent out') : r.quota != null ? `${inward ? 'comes in' : 'goes out'} up to ${r1(r.quota)} a quarter` : '', r.tariff != null ? `pays a duty of ${pc(r.tariff)}` : ''].filter(Boolean).join(' and ');
      if (r.ban !== was?.ban || r.quota !== was?.quota) news(w, `${c.name}: ${name} ${r.ban ? (inward ? 'may no longer be imported' : 'may no longer be exported') : r.quota != null ? `${inward ? 'imports' : 'exports'} are limited to ${r1(r.quota)} a quarter` : `${inward ? 'imports' : 'exports'} are free again`}.`, { kind: 'economy', countries: [c.id] });
      return { ok: true, msg: `From now on ${name} ${what}.${(r.ban || r.quota != null) && seal < .97 ? ` The customs service can hold back about ${Math.round(seal * 100)} in the hundred of what the rule forbids; the rest ${inward ? 'comes in' : 'goes out'} by other roads and pays nothing.` : ''}` };
    }
    // The floor under the gold reserve: what the banks are told to keep whatever merchants would like to buy abroad with it.
    case 'set_gold_floor': { const x = num(op.amount, 0, 1e12, c.goldFloor ?? 0); c.goldFloor = x;
      return { ok: true, msg: `The banks are to keep a floor of ${Math.round(x)} of gold under the reserve, which holds ${Math.round(c.reserves)}. Merchants pay for foreign goods with what the country's sales earn, and may draw each quarter a quarter of whatever lies above the floor; bread, goods the government has put first in the order of imports, and what it buys abroad itself are paid for out of the whole reserve.${x <= 0 ? ' With no floor the reserve can be spent to nothing, and the currency rests on it.' : x > c.reserves ? ' The floor is above what the reserve holds: for the present merchants can buy abroad only with what the country sells.' : ''}` }; }
    // The term of service: how long a man stays with the colours before he goes home trained.
    case 'set_service': { const y = Math.round(num(op.years, 1, 12, serviceOf(c))); c.termBase ??= serviceOf(c); c.term = y; const men = sum(Object.values(w.units).filter(u => u.country === c.id && !u.called), u => u.men);
      return { ok: true, msg: `Men now serve ${y} year${y === 1 ? '' : 's'} with the colours. At that term the reserve of trained men settles, over some years, near ${Math.round(men * reserveAt(y))} thousand (it stands at ${Math.round(c.reserve ?? 0)}), and the troops under arms ${drillOf(c) < .97 ? 'will be rawer than they were' : drillOf(c) > 1.03 ? 'will be better drilled than they were' : 'are drilled as armies ordinarily are'}.${y > (c.termBase ?? 3) ? ' Villages and workshops give up their sons for longer, and will say so.' : y < (c.termBase ?? 3) ? ' Villages and workshops get their sons back sooner.' : ''}` }; }
    case 'set_import_priority': {
      const goods = [...new Set((Array.isArray(op.goods) ? op.goods : []).filter(g => GOODS.includes(g)))]; (c.imports ||= {}).order = goods;
      return { ok: true, msg: goods.length ? `When gold is short it is now spent abroad in this order: ${importOrder(c).map(g => GOOD_LABEL[g]).join(', ')}.` : 'The usual order stands again: bread first, then what the works need, consumer goods last.' };
    }
    // An order on the foreign markets for this quarter. It moves nothing by itself: the quarter's trade fills it as far as sellers, routes and gold allow, and reports back.
    case 'buy_goods': case 'sell_goods': {
      if (!GOODS.includes(op.good)) return fail('No such good.');
      const buy = op.op === 'buy_goods', q = num(op.amount, 0, 1e6, 0), book = buy ? (c.orders ||= {}) : (c.sales ||= {}), name = GOOD_LABEL[op.good], now = Math.round((w.globalPrice?.[op.good] ?? 0) * 10) / 10;
      if (!(q > 0)) { delete book[op.good]; return { ok: true, msg: `No ${buy ? 'order for' : 'offer of'} ${name} stands on the foreign markets.` }; }
      if (!Object.keys(w.routes || {}).some(k => k.split('|').includes(c.id))) return fail('No trade route to any country is open.');
      if (buy && !(c.reserves - (c._debtService || 0) > 0)) return fail('There is no gold in the reserve to pay foreign sellers with.');
      if (buy && !(Math.max(0, c.treasury - (c.till || 0)) + Math.max(0, creditLeft(c)) > (w.globalPrice?.[op.good] ?? 0) * (c.rate || 1))) return fail('The treasury has nothing to spare for a purchase abroad, and lenders will not cover it.');
      if (!buy && (c.stock[op.good] || 0) < q) return fail(`Only ${Math.round(c.stock[op.good] || 0)} of ${name} is in store.`);
      const limit = num(buy ? op.max_price : op.min_price, 0, 1e6, 0); book[op.good] = { amount: q, limit, by: actor.id };
      return { ok: true, msg: buy ? `An order for ${r1(q)} of ${name} goes to the foreign markets this quarter${limit ? `, at no more than ${limit} a unit` : ''}; the world price stands at about ${now}. The treasury pays for it (${Math.round(q * now * 1.05 * (c.rate || 1))} at that price if all of it comes), borrowing what it lacks while lenders agree, and the same sum in gold leaves the reserve. It is filled as far as sellers with a surplus can be reached by an open route, the treasury can pay and the reserve holds gold; the customs house reports what arrived and what it cost.` : `${r1(q)} of ${name} from the state's stores is offered on the foreign markets this quarter${limit ? `, at no less than ${limit} a unit` : ''}; the world price stands at about ${now}. It is sold, for gold, as far as buyers in want of it can be reached by an open route; what comes out of the state's own stores is credited to the treasury, and the customs house reports what was sold.` };
    }
    case 'ship_goods': { if (!target || target.id === c.id) return fail('No such target.'); if (!GOODS.includes(op.good)) return fail('No such good.'); const route = w.routes[c.id < target.id ? `${c.id}|${target.id}` : `${target.id}|${c.id}`]; if (!route) return fail('No open route to this country.'); const q = Math.min(c.stock[op.good] || 0, num(op.amount, 0, 1e6)); if (q <= 0) return fail('Not in stock.'); c.stock[op.good] -= q; const arrived = q / route.cost; target.stock[op.good] = (target.stock[op.good] || 0) + arrived; tell(w, w.characters[target.leader], c.name, `Shipment of ${Math.round(arrived)} units of ${GOOD_LABEL[op.good]} has arrived.`); return { ok: true, msg: `${Math.round(arrived)} units arrived.` }; }
    case 'set_strait': { const s = w.strategic.find(x => x.id === op.id && x.type === 'strait'); if (!s || s.controller !== c.id) return fail('You do not control this strait.'); (c.straitPolicy ||= {})[s.id] = { closed: !!op.closed, toll: num(op.toll, 0, .6) }; if (op.closed) { news(w, `${c.name} closed the ${s.name} passage.`, { kind: 'war', countries: [c.id] }); for (const a of aliveCountries(w)) if (a.id !== c.id) a.relations[c.id] = clampRel((a.relations[c.id] ?? 0) - 8); } return ok(); }
    case 'build_canal': { const s = w.strategic.find(x => x.id === op.id && x.type === 'canal_site'); if (!s) return fail('No such route.'); const p = w.provinces[s.ref]; if (p.controller !== c.id) return fail('The land is not yours.'); if (w.canals.some(k => k.province === p.id)) return fail('The canal already exists.'); if (c.stock.machines < 8 || c.stock.steel < 20) return fail('Not enough machinery or steel.'); if ((w.projects || []).some(x => x.kind === 'canal' && x.province === p.id && !x.status)) return fail('Canal already under construction.'); const note = pay(c, gdp * .8, 'building'); if (note === null) return fail(NO_FUNDS); c.stock.machines -= 8; c.stock.steel -= 20; queueProject(w, c, { kind: 'canal', province: p.id, strategic: s.id, label: `${p.name} canal` }); return { ok: true, msg: `Digging, ready in ${durationOf('canal')} quarters.${note}` }; }
    case 'build_ship': { const p = w.provinces[op.province]; if (!p || p.controller !== c.id || !p.port) return fail('There is no port here.');
      if (op.kind === 'merchant') { const n = Math.round(num(op.ships, 1, 60)); if (c.stock.steel < n || (c.stock.timber || 0) < n * .5) return fail(`Not enough steel or timber: ${n} merchant ships need ${n} of steel and ${n * .5} of timber.`);
        const note = pay(c, n * .6 * c.priceLevel, 'building'); if (note === null) return fail(NO_FUNDS); c.stock.steel -= n; c.stock.timber -= n * .5; queueProject(w, c, { kind: 'ship', province: p.id, ships: n, shipKind: 'merchant', label: `${n} merchant ships` });
        return { ok: true, msg: `${n} merchant ship${n > 1 ? 's' : ''} laid down at ${p.name}, ready in ${durationOf('ship', 'merchant')} quarters. They add ${n * MERCHANT} to the country's merchant tonnage (now ${Math.round(c.shipping ?? 0)}), which carries its coasting and foreign trade, earns freight where it is hired out, and puts troops across the sea: about ${n * MERCHANT * LIFT} thousand men more in a quarter.${note}` }; }
      const ships = Math.round(num(op.ships, 1, 30)), shipKind = has(SHIPS, op.kind) ? op.kind : 'cruiser', k = SHIPS[shipKind];
      if (k.tech && !hasTech(c, k.tech)) return fail(shipKind === 'submarine' ? 'Submarines need the internal combustion engine.' : `${k.name[0].toUpperCase()}${k.name.slice(1)} cannot be built yet: the yards lack the technology (${TECHS[k.tech]?.name ?? k.tech}).`);
      if (p.port < k.port) return fail(`A ${k.one} cannot be laid down at ${p.name}: its harbour is too small. It needs a harbour of the ${['first', 'second', 'third'][k.port - 1]} size (build a larger one, or use another port).`);
      if (c.stock.steel < ships * k.steel) return fail(`Not enough steel: ${count(ships, shipKind)} need ${Math.round(ships * k.steel * 10) / 10}, and ${Math.round(c.stock.steel)} is in store.`);
      const note = pay(c, ships * k.price * c.priceLevel, 'forces'); if (note === null) return fail(NO_FUNDS); c.stock.steel -= ships * k.steel;
      queueProject(w, c, { kind: 'ship', province: p.id, ships, shipKind, label: `${ships} ${shipKind}` });
      return { ok: true, msg: `${count(ships, shipKind)} laid down at ${p.name}, ready in ${durationOf('ship', shipKind)} quarters; they will lie in that harbour when they are delivered. Each has to be paid for out of the military budget every quarter from then on, and burns coal.${note}` }; }
    // A squadron is sent to lie in a harbour (a province) or to keep station at sea (a sea). It goes as far as its kind can keep the sea from a base.
    case 'move_fleet': {
      const f = w.fleets[op.fleet]; if (!f || f.country !== c.id) return fail('No such fleet of yours.');
      const port = has(w.provinces, op.to) ? w.provinces[op.to] : null, sea = has(w.seas, op.to) ? w.seas[op.to] : null; if (!port && !sea) return fail('Name a sea (such as D12) to keep station in, or a province with a harbour (such as P12) to lie in.');
      if (port && !friendlyPort(w, c.id, port)) return fail(port.port > 0 ? `${port.name} is not a harbour open to our ships. Only a harbour of our own, an ally's, or one opened to us by a right of passage (a military_access treaty) coals and shelters them.` : `${port.name} has no harbour.`);
      const k = SHIPS[kindOf(f)], goal = port ? (port.seas.includes(f.sea) ? f.sea : port.seas.find(x => seaPath(w, f.sea, x, c.id))) : sea.id, path = goal ? seaPath(w, f.sea, goal, c.id) : null;
      if (!path) return fail('No open water leads there: the way is landlocked or passes a strait that is closed to us.');
      const base = port ? { d: 0, port: port.id } : baseMap(w, c.id)[goal] ?? { d: 99, port: null }, baseName = w.provinces[base.port]?.name;
      if (base.d > k.reach) return fail(`${seaLabel(w, goal)} lies ${base.d > 90 ? 'out of reach of' : `${base.d} seas from`} the nearest harbour that would coal our ships${baseName ? ` (${baseName})` : ''}; ${k.name} keep station ${k.reach} seas from a base at most. A harbour nearer to it would have to be ours, an ally's, or opened to us by treaty.`);
      // A number of ships sends a squadron and leaves the rest where they are.
      const asked = Math.floor(Number(op.ships)); let x = f;
      if (asked >= 1 && asked < f.ships) { x = makeFleet(w, c.id, f.sea, asked, f.kind); for (const key of ['quality', 'morale', 'port', 'home', 'orders', 'coaled']) if (f[key] != null) x[key] = f[key]; f.ships -= asked; }
      x.target = op.to; if (!port && x.orders === 'port') delete x.orders;
      const far = path.length - 1, q = Math.max(1, Math.ceil(far / k.cells)), fit = readiness(w, x, base.d);
      return { ok: true, msg: `${x.id}, ${count(x.ships, kindOf(x))}${x !== f ? `, was detached from ${f.id} (which keeps ${Math.round(f.ships)}) and` : ''} is ordered to ${port ? `the harbour of ${port.name}` : seaLabel(w, goal)}: ${far} sea${far === 1 ? '' : 's'} away, ${q === 1 ? 'there within the quarter' : `about ${q} quarters`} unless it meets an enemy squadron on the way, which stops it there. ${port ? 'In harbour it lies under the shore guns, burns little coal, mends its damage and commands no water.' : `On that station it is ${base.d} sea${base.d === 1 ? '' : 's'} from its nearest base${baseName ? ` (${baseName})` : ''} and fit to fight at about ${Math.round(fit * 100)} in the hundred of its strength; at sea it burns about ${Math.round(x.ships * k.coal * (1 + Math.max(0, base.d - 4) * .1) * 10) / 10} of coal a quarter (the country holds ${Math.round(c.stock.coal || 0)}), and it commands that water against whatever is weaker.`}` };
    }
    case 'merge_fleets': {
      const a = w.fleets[op.fleet], b = w.fleets[op.into]; if (!a || !b || a === b || a.country !== c.id || b.country !== c.id) return fail('No such fleets.');
      if (a.sea !== b.sea || (a.port ?? null) !== (b.port ?? null)) return fail(`${a.id} and ${b.id} must lie in the same waters, both at sea or both in the same harbour, to be joined.`);
      if (kindOf(a) !== kindOf(b)) return fail('Ships of different kinds stay separate squadrons.');
      const n = a.ships + b.ships; for (const k of ['quality', 'morale', 'coaled']) b[k] = ((a[k] ?? b[k] ?? 1) * a.ships + (b[k] ?? a[k] ?? 1) * b.ships) / Math.max(n, 1e-9);
      b.ships = n; b.damaged = (a.damaged || 0) + (b.damaged || 0); delete w.fleets[a.id];
      return { ok: true, msg: `${a.id} was joined to ${b.id}, now ${Math.round(n)} ships.` };
    }
    // Standing orders to a squadron, in force until changed.
    // The seat of government goes where the ruler takes it. The offices do not travel well: the administration is the worse for it for a while,
    // the city left behind resents it, and a government that leaves with the enemy at the gates is seen to have fled. What it takes with it
    // is its vaults: a capital that falls afterwards yields the enemy no gold.
    case 'move_capital': {
      const p = has(w.provinces, op.province) ? w.provinces[op.province] : null, old = w.provinces[c.capital]; if (!p || p.controller !== c.id || p.owner !== c.id) return fail('The seat of government can go only to a province that is ours and in our hands.');
      if (p.id === c.capital) return fail(`${p.name} is the capital already.`);
      if (w.turn - (c.capitalMoved ?? -99) < 8) return fail(`The government moved in ${quarterLabel(c.capitalMoved)}: ministries, archives and vaults cannot be carted about the country every season, and two years must pass before they are moved again.`);
      const cost = Math.max(c.gdp, 1) * .012, note = pay(c, cost, 'other'); if (note === null) return fail(NO_FUNDS);
      const pressed = !!old && (old.controller !== c.id || [old.id, ...old.neighbors].some(id => Object.values(w.units).some(u => u.province === id && atWar(w, u.country, c.id))));
      c.capital = p.id; c.capitalMoved = w.turn; c.bureaucracy = clamp(c.bureaucracy - 5, 0, 100); c.legitimacy = clamp(c.legitimacy - (pressed ? 4 : 1.5), 0, 100); if (old && old.controller === c.id) old.unrest = clamp(old.unrest + 8, 0, 100);
      news(w, `${c.name}: the government has left ${old?.name ?? 'its old seat'} and sits at ${p.name}${pressed ? ', with the enemy close behind it' : ''}.`, { kind: 'politics', countries: [c.id], province: p.id });
      return { ok: true, msg: `The government sits at ${p.name}. The move cost ${Math.round(cost)}; the offices are in disorder for some quarters (the administration is the weaker for it until it has settled), ${old?.name ?? 'the old capital'} resents being left${pressed ? ', and with the enemy at its gates the country reads it as flight' : ''}. Vaults and archives went with it: should the old capital fall it yields no gold. Distances, the reach of the state and the army's supply are now reckoned from ${p.name}.${note}` };
    }
    // Prisoners of war are held until a peace sends them home, unless whoever governs lets them go sooner: a gesture the other country reads, and
    // men who go back onto its reserve roll and may be called to the colours again.
    case 'release_prisoners': {
      if (!target) return fail('Name the state whose men are to be sent home.'); const held = c.captives?.[target.id] || 0; if (!(held > 0)) return fail(`We hold no prisoners of ${target.name}.`);
      const n = op.men != null ? Math.min(num(op.men, 0, 1e6, 0), held) : held; if (!(n > 0)) return fail('Say how many are to go, or leave the number out to send them all.');
      c.captives[target.id] = held - n; if (c.captives[target.id] < .01) delete c.captives[target.id];
      const provs = Object.values(w.provinces).filter(p => p.owner === target.id && p.controller === target.id); goHome(provs, n); target.reserve = (target.reserve || 0) + n;
      const g = target.grudges?.[c.id]; if (g) g.incident = Math.max(0, g.incident - Math.min(6, n * .5)); target.relations[c.id] = clamp((target.relations[c.id] ?? 0) + Math.min(8, 2 + n * .4), -100, 100);
      const words = n < 1 ? `${Math.max(1, Math.round(n * 10)) * 100}` : `${Math.round(n)} thousand`;
      news(w, `${c.name} has sent home ${words} prisoners of war to ${target.name}${atWar(w, c.id, target.id) ? ', with the war still on' : ''}.`, { kind: 'war', countries: [c.id, target.id] });
      tell(w, w.characters[target.leader], 'Foreign Ministry', `${c.name} has sent home ${words} of our men it held prisoner${held - n > .05 ? `; it keeps about ${Math.round((held - n) * 10) / 10} thousand more` : ''}. They are back in their provinces and on the reserve roll.`);
      return { ok: true, msg: `${words} prisoners went home to ${target.name}${held - n > .05 ? `; about ${Math.round((held - n) * 10) / 10} thousand are still held` : ''}. Their country reads the gesture, and holds a little less against us; the men are on its reserve roll again and can be called up${atWar(w, c.id, target.id) ? ' against us' : ''}.` };
    }
    // Who is paid and supplied first when the vote for the forces falls short. Default: nobody; all are short alike.
    case 'set_pay_priority': {
      const list = [...new Set((Array.isArray(op.first) ? op.first : op.first ? [op.first] : []).map(x => String(x).trim()).filter(Boolean))].slice(0, 24);
      // A body that is not on the rolls (formed only this quarter, or misnamed) is left out and named; the rest of the order stands. (World 16: a
      // list of nine units and "army, navy" was refused whole for two units still forming.)
      const bad = list.filter(x => !(w.units[x]?.country === c.id || w.fleets[x]?.country === c.id || PAY_FIRST.includes(x))), unknown = bad.length ? ` Left out, not being a unit or squadron on our rolls today (nor one of ${PAY_FIRST.join(', ')}): ${bad.join(', ')}.` : ''; for (const x of bad) list.splice(list.indexOf(x), 1);
      if (bad.length && !list.length) return fail(`Not a unit or squadron of ours, nor one of ${PAY_FIRST.join(', ')}: ${bad.join(', ')}.`);
      if (list.length) c.payFirst = list; else delete c.payFirst;
      const cover = Math.round((c.militaryFunding ?? 1) * 100);
      return { ok: true, msg: list.length ? `When the vote for the forces falls short, these are paid and supplied in full first: ${list.join(', ')} (navy is every squadron, army every unit, capital the troops standing in the capital); the rest share what is left, and waste, sour and lose faith the faster for it. At the last reckoning the vote covered about ${cover} in the hundred of what the forces cost${cover >= 100 ? ', so that for now nobody goes short' : ''}. The order stands until changed; an empty list ends it.${unknown}` : 'No body of troops and no squadron is paid before another: when the vote falls short all are short alike.' };
    }
    // A reserve of arms and ammunition that no attack may draw on. Default: none.
    // Arms issued from the arsenal to one body of troops, to bring its equipment up now instead of waiting for the stores to reach it.
    case 'equip': { const u = has(w.units, op.unit) ? w.units[op.unit] : null; if (!u || u.country !== c.id) return fail('No such unit of ours.'); const was = u.equip ?? 1, lack = Math.max(0, 1 - was); if (lack < .02) return fail(`${u.id} is fully equipped already.`);
      const want = lack * u.men * .05, free = Math.max(0, (c.stock.arms || 0) - (op.from_reserve === true ? 0 : c.arsenalReserve || 0)), give = Math.min(want, free);
      if (!(give > .01)) return fail(`The arsenal holds ${Math.round(c.stock.arms || 0)}${c.arsenalReserve ? `, of which ${Math.round(c.arsenalReserve)} is kept back from any such draft (from_reserve:true breaks into it)` : ''}: nothing can be issued to ${u.id}.`);
      c.stock.arms -= give; u.equip = Math.min(1, was + give / (u.men * .05));
      return { ok: true, msg: `${Math.round(give * 10) / 10} of arms and ammunition was issued from the arsenal to ${u.id}: it is equipped to ${Math.round(u.equip * 100)} in the hundred of its establishment (it was ${Math.round(was * 100)}). The arsenal holds ${Math.round(c.stock.arms)}.` }; }
    case 'set_arsenal_reserve': {
      const n = num(op.amount, 0, 1e6, 0), have = Math.round(c.stock.arms || 0); if (n > 0) c.arsenalReserve = n; else delete c.arsenalReserve;
      return { ok: true, msg: n > 0 ? `${Math.round(n)} of arms and ammunition is kept back in the arsenal (it holds ${have}): no attack draws on it, and an attack that wants more than what lies above it fires the less. Troops attacked on their own ground and men called to the colours still draw on it. The order stands until changed; 0 ends it.` : 'Nothing in the arsenal is kept back from an attack.' };
    }
    case 'fleet_orders': {
      const kind = ORDERS.includes(op.orders) ? op.orders : null; if (!kind) return fail(`A squadron's standing orders are: ${ORDERS.join(', ')}.`);
      const mine = Object.values(w.fleets).filter(f => f.country === c.id), fs = op.all === true ? mine : mine.filter(f => f.id === op.fleet); if (!fs.length) return fail('No such fleet of yours: name one (fleet) or give all:true.');
      for (const f of fs) { if (kind === 'patrol') delete f.orders; else f.orders = kind; if (kind === 'port' && !f.port) { const home = w.provinces[f.home]; f.target = (friendlyPort(w, c.id, home) ? home : refuge(w, f))?.id ?? null; } }
      const says = { patrol: 'They hold whatever water they lie in and fight whatever enemy comes into it. They take the enemy\'s own merchantmen where they meet them, which makes his trade there dearer, and let other flags pass: to shut a coast to all trade they must be ordered to blockade.', seek: 'They hold the water they lie in and fight whatever enemy comes; an enemy that tries to slip away from them finds it harder.', evade: 'They do not give battle if they can help it: met by an enemy they try to get away, the more easily the faster they are than whatever hunts them, and fight only if caught. They command no water while they keep out of the way.', blockade: 'Lying at sea off an enemy coast they turn back every ship bound for it or out of it, whatever flag it flies: in the measure of their weight against the harbours of that water his trade there grows dearer and then stops, and a state at peace with us whose ships are turned back will have something to say. They fight whatever comes out.', raid: 'They go after the enemy\'s merchant ships in the water they lie in and keep away from his warships: his trade through that water costs him more for every quarter they are there. They command no water.', port: 'They make for harbour and lie there under the shore guns: they cost less, burn little coal, mend their damage, cannot be brought to battle, and command no water while they lie there.' }[kind];
      return { ok: true, msg: `Standing orders to ${fs.map(f => f.id).join(', ')}: ${kind}. ${says}` };
    }
    // A squadron shown off a foreign coast in time of peace.
    case 'demonstrate': {
      if (!target) return fail('Name the state the squadron is to be shown to.'); if (atWar(w, c.id, target.id)) return fail('We are at war with them: ships at war do not demonstrate, they fight.');
      const theirs = s => w.seas[s].coast.some(id => w.provinces[id].controller === target.id), off = Object.values(w.fleets).filter(f => f.country === c.id && !f.port && kindOf(f) !== 'submarine' && theirs(f.sea) && (!op.fleet || f.id === op.fleet)), sea = off.sort((a, b) => b.ships * SHIPS[kindOf(b)].power - a.ships * SHIPS[kindOf(a)].power)[0]?.sea;
      if (!sea && !op._late) return standBy(w, actor, { op: 'demonstrate', target: target.id, fleet: op.fleet }, `show:${target.id}`, `The squadron is to be shown off the coast of ${target.name} once it lies at sea there this quarter (${squadronWord(w, c.id, Object.keys(w.seas).filter(theirs))}). The staff reports what came of it.`);
      if (!sea) return fail(`No surface squadron of ours lies at sea off the coast of ${target.name}. One has to be sent there first (move_fleet to a sea off one of their harbours: ${[...new Set(countryProvinces(w, target.id).filter(p => p.port > 0).flatMap(p => p.seas))].slice(0, 6).join(', ') || 'they have none'}).`);
      if (allowance(w, c, `show:${target.id}`, 1, 1) <= 0) return fail('The squadron has been seen there this quarter already; the same ships say nothing new.');
      return demonstrate(w, c, target, off.filter(f => f.sea === sea), sea);
    }
    // A creditor's ships take the customs of a state that has stopped paying.
    case 'seize_customs': {
      if (!target) return fail('Name the debtor state.'); const owed = target.creditors?.[c.id] || 0; if (owed < .5) return fail(`${target.name} owes this state nothing.`);
      if (!target.defaulted && !((target.extArrears || 0) > 0)) return fail(`${target.name} is paying what it owes (${Math.round(owed)} in gold to us): there is no default to collect on.`);
      if ((w.seizures || []).some(s => s.by === c.id && s.of === target.id)) return fail('Our officers sit in their customs house already.');
      for (const p of countryProvinces(w, target.id).filter(x => x.port > 0).sort((a, b) => b.port - a.port)) for (const s of p.seas) { const pw = w.seaPower?.[s] || {}; if ((pw[c.id] || 0) > 0 && (pw[c.id] || 0) > (pw[target.id] || 0)) return seizeCustoms(w, c, target, s, p, shame); }
      if (!op._late) return standBy(w, actor, { op: 'seize_customs', target: target.id }, `customs:${target.id}`, `Our officers are to take the customs of ${target.name} once a squadron of ours commands the water off one of its harbours this quarter (${squadronWord(w, c.id, countryProvinces(w, target.id).filter(x => x.port > 0).flatMap(x => x.seas))}). The staff reports what came of it.`);
      return fail(`No squadron of ours commands the water off a harbour of ${target.name}. It has to lie at sea there (move_fleet) and outweigh whatever of theirs is at sea in that water.`);
    }
    case 'bombard': {
      const p = has(w.provinces, op.province) ? w.provinces[op.province] : null; if (!p?.coast) return fail('Name a province on a coast.');
      if (p.controller === c.id) return fail(`${p.name} is in our own hands.`);
      if (!atWar(w, c.id, p.controller)) return fail(`${p.name} is held by ${w.countries[p.controller]?.name}, with whom there is no war. Shelling it would be one, and war is declared by whoever governs (declare_war).`);
      if (hasTreaty(w, c.id, p.controller, 'armistice')) return fail('An armistice with them is in force: no ship fires while it lasts.');
      const off = Object.values(w.fleets).filter(f => f.country === c.id && !f.port && kindOf(f) !== 'submarine' && p.seas.includes(f.sea)), f = op.fleet ? off.find(x => x.id === op.fleet) : off.sort((a, b) => b.ships * SHIPS[kindOf(b)].power - a.ships * SHIPS[kindOf(a)].power)[0];
      if (!f && !op._late) return standBy(w, actor, { op: 'bombard', province: p.id, fleet: op.fleet, at: op.at }, `shell:${p.id}:${op.fleet ?? ''}`, `${p.name} is to be shelled once our ships have taken station at sea off it this quarter (${squadronWord(w, c.id, p.seas)}). The staff reports what came of it.`);
      if (!f) return fail(`No surface ships of ours ${op.fleet ? `(${op.fleet}) ` : ''}took station at sea off ${p.name} (${p.seas.join(' or ')}) this quarter: a squadron has to get there (move_fleet), and one that is stopped or beaten on the way shells nothing.`);
      if (allowance(w, f, 'shell', 1, 1) <= 0) return fail(`${f.id} has fired off what it carries this quarter.`);
      return shell(w, c, f, p, { shame }, op.at);
    }
    // Mines. Laid from the shore in water off one's own coast, or by light craft lying off the coast of a state one is at war with. Nobody is told.
    case 'lay_mines': {
      const sea = has(w.seas, op.sea) ? w.seas[op.sea] : null; if (!sea) return fail('Name the sea (such as D12).');
      const ours = sea.coast.some(id => w.provinces[id].controller === c.id), foes = sea.coast.some(id => atWar(w, c.id, w.provinces[id].controller)), layer = Object.values(w.fleets).some(f => f.country === c.id && !f.port && f.sea === sea.id && ['cruiser', 'torpedo'].includes(kindOf(f)));
      if (!ours && foes && !layer && !op._late) return standBy(w, actor, { op: 'lay_mines', sea: sea.id }, `mines:${sea.id}`, `Mines are to be laid in ${seaLabel(w, sea.id)} once cruisers or torpedo craft of ours lie at sea there this quarter (${squadronWord(w, c.id, [sea.id])}). The staff reports what came of it.`);
      if (!ours && !(layer && foes)) return fail('Mines are laid from the shore in water off our own coast, or by cruisers or torpedo craft of ours lying at sea off the coast of a state we are at war with.');
      const m = (w.mines ||= {})[sea.id]; if (m && m.by !== c.id) return fail('That water is mined already, and not by us.'); if ((m?.level ?? 0) >= 3) return fail('The field there is as thick as it can usefully be.');
      if (allowance(w, c, `mines:${sea.id}`, 1, 1) <= 0) return fail('One field is laid in one water in a quarter.');
      if ((c.stock.steel || 0) < 3) return fail('Not enough steel for the mines (3).'); const note = pay(c, 25 * c.priceLevel, 'forces'); if (note === null) return fail(NO_FUNDS); c.stock.steel -= 3;
      const level = (m?.level ?? 0) + 1; w.mines[sea.id] = { by: c.id, level, left: 8, turn: w.turn };
      return { ok: true, msg: `Mines are laid in ${seaLabel(w, sea.id)}, ${['thinly', 'in a proper field', 'as thickly as is useful'][level - 1]}. An enemy squadron lying in that water loses about ${3 * level} ships in the hundred to them each quarter, half of those sunk, and clears part of the field as it does; our own ships know the channels. Nobody has been told. Merchant ships of states at war with no one pass there too: now and then one is lost, and its government learns whose mines they were. The field thins of itself in about two years, sooner once we are at peace.${note}` };
    }
    case 'amphibious': {
      // A landing needs a coast to embark from, water that can be crossed, a surface fleet holding the far shore and ships enough to carry the men.
      // Troops carried to a coast of their own country's, an ally's or one opened to them need no squadron: only ships, and water no enemy holds.
      const u = w.units[op.unit], p = w.provinces[op.to]; if (!u || u.country !== c.id || !p?.coast) return fail('Invalid landing order.');
      if (freshlyCalled(w)(u) && p.controller !== c.id && atWar(w, c.id, p.controller)) return fail(`${u.id} was called up this quarter: it can be shipped to a coast of our own, and goes against a coast the enemy holds from next quarter.`);
      const from = w.provinces[u.province];
      if (u.province === p.id) return fail('The unit is already there.');
      if (!from.coast) return fail('The unit must first march to the coast to embark.');
      if (u.shipped === w.turn) return fail('This unit has already been at sea this quarter.');
      const ours = p.controller === c.id || hasTreaty(w, c.id, p.controller, 'alliance') || hasTreaty(w, c.id, p.controller, 'military_access');
      if (!atWar(w, c.id, p.controller) && !ours) return fail('You are not at war with whoever holds that coast, and it is not open to our troops (an alliance or a right of passage would open it).');
      if (p.controller !== c.id && hasTreaty(w, c.id, p.controller, 'armistice')) return fail('An armistice with them is in force: no landing while it lasts. It would have to be broken first (break_treaty).');
      const escort = Object.values(w.fleets).filter(f => f.country === c.id && kindOf(f) !== 'submarine' && !f.port && p.seas.includes(f.sea) && !enemyHolds(w, f.sea, c.id));
      const wait = !ours && !escort.length && !op._late;
      if (!ours && !escort.length && !wait) return fail('No surface squadron of ours took station at sea off the target coast and held that water this quarter (a squadron lying in harbour covers nothing, and one stopped or beaten on the way covers nothing either).');
      if (ours && p.seas.every(s => enemyHolds(w, s, c.id))) return fail(`The enemy commands the water off ${p.name}: no transport can put in there until it is driven off.`);
      const ways = from.seas.flatMap(s => p.seas.map(t => seaPath(w, s, t, c.id))).filter(Boolean).sort((a, b) => a.length - b.length), way = ways[0]; if (!way) return fail('No sea route joins the two coasts.');
      if (way.length - 1 > 12) return fail(`The crossing is ${way.length - 1} seas: too far for transports in one quarter. The troops must embark from a coast within twelve seas of the landing place.`);
      if (!wait) { const held = way.find(s => enemyHolds(w, s, c.id)); if (held) return fail(`The enemy commands ${seaLabel(w, held)} on the way: transports cannot cross water an enemy squadron holds.`); }
      // The men cross in merchant ships taken up for the quarter: two thousand, with their horses and stores, to each unit of tonnage.
      const lift = liftOf(c, w); if (u.men > lift + 1e-9) return fail(`The merchant ships that can be taken up and loaded this quarter carry about ${Math.round(lift)} thousand men with their stores (${Math.round(c.shipping ?? 0)} of tonnage, ${LIFT} thousand men to each, and no more than our harbours can embark in a quarter); this unit has ${Math.round(u.men)} thousand. Send a detachment (move with men, then land that), wait for next quarter's ships, or lay down merchant ships (build_ship with kind merchant).`);
      if (wait) return standBy(w, actor, { op: 'amphibious', unit: u.id, to: p.id }, `land:${u.id}`, `${u.id} (${menText(u.men)}) embarks at ${from.name} for ${p.name}, ${way.length - 1} sea${way.length === 2 ? '' : 's'} away. The landing goes in this quarter once a surface squadron of ours has taken station at sea off that coast and holds the water, with no enemy squadron holding water on the way (${squadronWord(w, c.id, p.seas)}). If the squadron does not get there or is beaten, the men stay at ${from.name}; the staff reports what came of it and why.`);
      c._lifted = (c._lifted || 0) + u.men / LIFT;
      if (ours) { u.from = 'sea'; delete u.attack; u.province = p.id; u.men *= p.port > 0 ? 1 : .98; u.morale = clamp(u.morale - 3, 0, 100); u.target = null; u.dug = 0; u.shipped = w.turn;
        return { ok: true, msg: `${menText(u.men)} were carried by sea to ${p.name}${p.port > 0 ? ' and landed at its quays' : ', and put ashore over the open beach'}. The merchant ships that carried them are out of trade for the quarter; the unit marches again next quarter.` }; }
      u.from = 'sea'; delete u.attack; u.province = p.id; u.men *= Math.max(.3, .9 - (p.battery || 0) * .15); u.morale = clamp(u.morale - 10, 0, 100); u.target = null; u.dug = 0; u.shipped = w.turn;
      return { ok: true, msg: `${Math.round(u.men)} thousand men were put ashore at ${p.name}.` };
    }
    case 'found_party': { if (c.parties.length >= 8) return fail('There is no room for another party; the country has eight.'); const name = String(op.name || 'New Party').slice(0, 60); const axes = { econ: num(op.axes?.econ, -100, 100, 0), auth: num(op.axes?.auth, -100, 100, 0), nation: num(op.axes?.nation, -100, 100, 0), faith: num(op.axes?.faith, -100, 100, 0) }; c.parties.push({ id: nextId(w, 'F'), name, axes, base: CLASSES.includes(op.base) ? op.base : 'middle', support: 3, founder: actor.id, banned: false, organization: 10 }); news(w, `${c.name}: ${name} was founded.`, { kind: 'politics', countries: [c.id] }); return ok(); }
    case 'ban_party': { const p = c.parties.find(x => x.id === op.party); if (!p) return fail('No such party.'); if (p.banned) return fail(`${p.name} is banned already.`); { const no = courtBlocks(w, c, `ban:${p.id}`, c.courts / 160); if (no === 'now') news(w, `${c.name} court overturned the ban on ${p.name}.`, { kind: 'politics', countries: [c.id] }); if (no) return fail(no === 'again' ? 'The court has ruled on this ban this quarter and will not rule otherwise before the next.' : 'The court blocked it.'); } p.banned = true; if (c.parliament) c.parliament.seats = allocateSeats(c); c.pressFreedom = clamp(c.pressFreedom - 6, 0, 100); c.legitimacy = clamp(c.legitimacy - 4, 0, 100); news(w, `${c.name}: ${p.name} was banned.`, { kind: 'politics', countries: [c.id] }); return ok(); }
    case 'set_institutions': { const notes = []; if (op.courts !== undefined) c.courts = eased(c.courts, num(op.courts, 0, 100), 'Court independence', notes); if (op.press_freedom !== undefined) { const was = c.pressFreedom; c.pressFreedom = eased(was, num(op.press_freedom, 0, 100), 'Press freedom', notes); if (Math.abs(c.pressFreedom - was) >= 5) news(w, `${c.name} ${c.pressFreedom > was ? 'loosened' : 'tightened'} its hold on the press.`, { kind: 'politics', countries: [c.id] }); } if (typeof op.unions === 'boolean') c.unions = op.unions; if (typeof op.postal_secrecy === 'boolean' && op.postal_secrecy !== !!c.postalSecrecy) { c.postalSecrecy = op.postal_secrecy; notes.push(op.postal_secrecy ? 'The post office no longer opens letters for the government.' : 'The post office opens letters for the government again.'); news(w, `${c.name}: ${op.postal_secrecy ? 'the secrecy of the mails was made law; the black cabinet is closed' : 'the secrecy of the mails was lifted'}.`, { kind: 'politics', countries: [c.id] }); } if (op.ruling_party && c.parties.some(p => p.id === op.ruling_party)) c.rulingParty = op.ruling_party; return { ok: true, msg: notes.length ? `Applied. ${notes.join('; ')}.` : 'Applied.' }; }
    // Looking into someone's past. Whoever governs has the state's secret service for it, and so has an office that was given the task; the chief
    // of staff has the army's own, which is smaller; anyone else has friends, a name and what they will spend on people who ask questions.
    // Someone abroad is harder to look into. One inquiry into one person in a quarter: the same clerks do not find more by being sent twice.
    case 'gather_dossier': { const ch = w.characters[op.character]; if (!ch?.alive || ch.id === actor.id) return fail('No such target.');
      if (allowance(w, actor, `dossier:${ch.id}`, 1, 1) <= 0) return fail(`${ch.name} has been looked into once this quarter already; nothing more will turn up before the next.`);
      const state = governs(w, c, actor) || delegated(c, actor, 'gather_dossier'), staff = !state && c.general === actor.id, fee = state || staff ? 0 : Math.min(Math.max(actor.wealth, 0), num(op.amount, 0, 40, 0)); actor.wealth -= fee;
      const means = state ? .25 + c.intelligence / 200 : staff ? .15 + c.intelligence / 330 : .1 + actor.power / 400 + fee / 50, reach = ch.country === c.id ? 1 : .5 + (state || staff ? (c.intel[ch.country] ?? 0) / 200 : 0);
      if (rand(w) > clamp(means * reach, .05, .8)) return fail(`No evidence could be found for a dossier${fee ? `; the ${Math.round(fee * 10) / 10} paid to those who asked the questions is spent` : ''}.`); // What somebody is paid or placed to keep out of sight is not found while he keeps it; and what a person owes on notes of hand is found with the rest.
      const owes = (w.debts || []).filter(d => d.debtor === ch.id && ['open', 'overdue'].includes(d.status) && !d.known && w.characters[d.creditor]?.alive).map(d => `Owes ${Math.round(d.owed)} to ${w.characters[d.creditor].name} on a note of hand (${d.id}), ${d.status === 'overdue' ? 'overdue' : `due ${quarterLabel(d.due)}`}.`);
      const facts = [...(ch.secrets || []).filter(s => !s.published && !keptQuiet(w, s)).slice(-5).map(s => s.text), ...owes.slice(0, 3)]; actor.dossiers[ch.id] = { turn: w.turn, about: ch.name, facts }; return { ok: true, msg: facts.length ? `Dossier opened, ${facts.length} facts found.` : 'Dossier opened, but nothing that is not already known came up.' }; }
    case 'blackmail': { const ch = w.characters[op.character], file = actor.dossiers[ch?.id]; if (!ch?.alive || !file) return fail('You hold no dossier.'); if (!file.facts?.length) return fail('There is nothing usable in the dossier.');
      const what = op.for ?? op.deed, small = isMinor(ch) && !ch.aiControlled;
      // Someone nobody plays who is shown a file and told what to do gives way or refuses at once, by what the file holds and what he is.
      if (what != null && small) { const r = approach(w, actor, ch, op, 'blackmail', { file, allowance }); return r.ok ? r : fail(r.msg); }
      tell(w, ch, actor.name, `I have a dossier on you: ${file.facts.join(' ')} I expect you to do this: ${String(op.demand || 'Support me.').slice(0, 300)}`); leaveTrace(w, actor, `Blackmailed ${ch.name}.`);
      if (ch.aiControlled) return { ok: true, msg: `The demand, and what you hold, are in ${ch.name}'s hands. What ${ch.name} does about it is ${ch.name}'s own decision, and it may not be what you asked.` };
      ch.loyalty = clamp(ch.loyalty - 5, 0, 100);
      return { ok: true, msg: `The demand is in ${ch.name}'s hands, and ${he(ch)} thinks the less of the government ${he(ch)} serves for being used so. ${small ? `But a demand in words binds ${him(ch)} to nothing: ${he(ch)} gives way or refuses when ${he(ch)} is told what ${he(ch)} is to do. What a man in his place can be made to do: ${openTo(w, ch, actor, 'blackmail').join(', ')} (blackmail with for).` : `What ${he(ch)} does about it is ${his(ch)} own affair.`}` }; }
    case 'publish_dossier': { const ch = w.characters[op.character], file = actor.dossiers[ch?.id]; if (!ch?.alive || !file?.facts?.length) return fail('No dossier to publish.'); const home = w.countries[ch.country], n = file.facts.length;
      // Forged pages in the file may be recognised once they are in print, and then it is the publisher who pays.
      if (home && forgeryFound(w, home, file)) { news(w, `${home.name}: papers published against ${ch.name} were shown to be forgeries. They came from ${actor.name}.`, { kind: 'plot', countries: [...new Set([ch.country, actor.country])] }); ch.power = clamp(ch.power + 8, 0, 100); if (c.leader === actor.id) c.legitimacy = clamp(c.legitimacy - 5 * (.4 + c.pressFreedom / 100), 0, 100); else actor.power = clamp(actor.power - 10, 0, 100); leaveTrace(w, actor, `Published forged papers against ${ch.name}.`); delete actor.dossiers[ch.id]; return { ok: true, msg: `The papers were printed, and within weeks shown to be forgeries. It is you the country talks about now, not ${ch.name}.` }; } news(w, `Leaked documents: about ${ch.name}: ${file.facts.join(' ')}`, { kind: 'plot', countries: [ch.country] }); { const far = carry(c, actor, ch.id); if (home?.leader === ch.id) home.legitimacy = clamp(home.legitimacy - (2 + n * 1.5) * (.4 + home.pressFreedom / 100) * far, 0, 100); else ch.power = clamp(ch.power - (6 + n * 2) * far, 0, 100); } for (const s of ch.secrets || []) if (file.facts.includes(s.text) && !s.published) { s.published = true; cameOut(w, ch, s); } for (const d of w.debts || []) if (d.debtor === ch.id && file.facts.some(f => f.includes(`(${d.id})`))) d.known = true; delete actor.dossiers[ch.id]; return ok(); }
    case 'lend_private': { const ch = w.characters[op.character]; if (!ch?.alive || ch.id === actor.id) return fail('No such target.'); const m = num(op.amount, 0, actor.wealth); if (m <= 0) return fail('No money to give.'); const d = { id: nextId(w, 'B-'), creditor: actor.id, debtor: ch.id, amount: m, owed: m * (1 + num(op.interest, 0, 1, 0)), due: w.turn + Math.round(num(op.due_turns, 1, 80, 8)), terms: String(op.terms || '').slice(0, 240), status: 'open', turn: w.turn }; actor.wealth -= m; ch.wealth += m; (w.debts ||= []).push(d); tell(w, ch, actor.name, `Debt ${d.id}: lent you ${Math.round(m)}, expects ${Math.round(d.owed)} back, due turn ${d.due}. ${d.terms}`); return { ok: true, msg: `Debt recorded: ${d.id}`, debt: d.id }; }
    case 'repay_debt': { const d = openDebt(w, op.debt); if (!d || d.debtor !== actor.id) return fail('You have no such debt.'); const m = Math.min(actor.wealth, d.owed, num(op.amount, 0, 1e12, d.owed)); if (m <= 0) return fail('No money to pay with.'); actor.wealth -= m; d.owed -= m; const cr = w.characters[d.creditor]; if (cr) cr.wealth += m; if (d.owed < .01) { d.status = 'paid'; d.closedAt = w.turn; } tell(w, cr, actor.name, `Debt ${d.id}: paid ${Math.round(m)}${d.status === 'paid' ? ', the debt is closed.' : `, ${Math.round(d.owed)} remaining.`}`); return { ok: true, msg: d.status === 'paid' ? `Paid ${Math.round(m * 10) / 10}: note ${d.id} is discharged.` : `Paid ${Math.round(m * 10) / 10} on note ${d.id}; ${Math.round(d.owed * 10) / 10} is still owed on it${cr ? ` to ${cr.name}` : ''}. (To have the holder call it settled for less than the whole, ask ${his(cr)} terms: ask_terms with an offer.)` }; }
    case 'forgive_debt': { const d = openDebt(w, op.debt); if (!d || d.creditor !== actor.id) return fail('You have no such claim.');
      // A holder may let part of a note go and keep the rest: with amount, that much is struck off what is owed.
      const part = op.amount != null ? num(op.amount, 0, 1e9, 0) : null; if (part != null && part < d.owed - .01) { if (!(part > 0)) return fail('No amount was named to strike off.'); d.owed -= part; tell(w, w.characters[d.debtor], actor.name, `Debt ${d.id}: ${Math.round(part * 10) / 10} was struck off; ${Math.round(d.owed * 10) / 10} is still owed.`); return { ok: true, msg: `${Math.round(part * 10) / 10} was struck off note ${d.id}; ${w.characters[d.debtor]?.name} still owes ${Math.round(d.owed * 10) / 10}.` }; }
      d.status = 'forgiven'; d.closedAt = w.turn; tell(w, w.characters[d.debtor], actor.name, `Debt ${d.id} was forgiven.`); return { ok: true, msg: `Note ${d.id} is forgiven; ${w.characters[d.debtor]?.name} owes you nothing on it.` }; }
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
      const kind = ['artillery', 'armor', 'air', 'cavalry'].includes(op.unit_kind) ? op.unit_kind : 'infantry', hands = p.pops.peasants.n + p.pops.workers.n;
      // A province gives so many men in a quarter, however many orders are written.
      const may = armedOf(c, p), men = Math.round(Math.min(num(op.men, .1, 1e6), Math.max(0, Math.min(provincePop(p) * .08, hands - 2) * may - used(w, p, 'levy'))) * 10) / 10;
      if (men < .1) return fail(may < .98 ? `${p.name} has given all the men it can this quarter: ${Math.round((1 - may) * 100)} in the hundred of its people are barred by law from bearing arms.` : `${p.name} has given all the men it can this quarter.`);
      if (kind === 'armor' && !hasTech(c, 'armor')) return fail('You lack armor technology.'); if (kind === 'air' && !hasTech(c, 'aviation')) return fail('You lack aviation technology.');
      if (['armor', 'air'].includes(kind) && (c.stock.steel < men * .2 || c.stock.fuel < men * .05)) return fail('Not enough steel or fuel.');
      const arms = men * (kind === 'artillery' ? .12 : .05); if (c.stock.arms < arms) return fail('Not enough arms in stock.');
      // A horseman costs his horse as well.
      const note = pay(c, men * .4 * (kind === 'cavalry' ? 1.6 : 1) * c.priceLevel, 'forces'); if (note === null) return fail(NO_FUNDS);
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
      if (home) goHome([home], men); c.reserve = (c.reserve || 0) + men; c.stock.arms = (c.stock.arms || 0) + men * (u.kind === 'artillery' ? .12 : .05) * clamp(u.equip ?? .8, 0, 1);
      if (!part) { delete w.units[u.id]; return { ok: true, msg: `${count} went home and ${u.id} is dissolved.` }; }
      u.men -= men;
      return { ok: true, msg: `${count} went home. ${u.id} keeps ${menText(u.men)} under arms.` };
    }
    case 'mobilize': return mobilize(w, c, op, pay, fail);
    case 'demobilize': return demobilize(w, c, op.men != null ? num(op.men, 0, 1e6, 0) : op.share != null ? -num(op.share, 0, 1, 1) : null, op.unit) ?? fail('No reservists are under arms.');
    case 'move': {
      const u = w.units[op.unit]; if (!u || u.country !== c.id || !w.provinces[op.to]) return fail('Invalid movement order.');
      if (freshlyCalled(w)(u) && w.provinces[op.to].controller !== c.id && atWar(w, c.id, w.provinces[op.to].controller)) return fail(`${u.id} was called up this quarter: it can march on our own ground and hold it, and goes against ground the enemy holds from next quarter.`);
      // A number sends a detachment and leaves the rest of the unit where it stands.
      // Where no road leads (an island, a possession across the sea) the troops go by ship, as a landing on a friendly coast does: "detach six
      // thousand and ship them to Ordona" is a march order to whoever writes it. (World 16: five such orders were answered "No route.")
      const dest = w.provinces[op.to], dry = u.province !== op.to && !pathStep(w, u.province, op.to, c.id), bySea = x => { const r = applyOp(w, actor, { op: 'amphibious', unit: x.id, to: op.to }); return { ...r, msg: `No road leads from ${w.provinces[x.province === op.to ? u.province : x.province]?.name ?? 'there'} to ${dest.name}: ${r.ok ? 'the troops went by sea' : 'the troops would have to go by sea, and could not'}. ${r.msg}${r.ok ? '' : ' (Troops embark from a province of ours on the coast; the crossing wants merchant tonnage and water no enemy holds.)'}` }; };
      const asked = Number(op.men); if (!(Number.isFinite(asked) && asked >= .1 && asked < u.men - .05)) return dry ? bySea(u) : applyOrder(w, c, u, op.to, true);
      const stays = u.province === op.to;
      const men = Math.round(asked * 10) / 10, d = makeUnit(w, c.id, u.province, men, u.quality, u.loyalty, u.kind); if (u.eth) { d.eth = u.eth; d.rel = u.rel; }
      d.morale = u.morale; d.equip = u.equip; if (u.bond != null) d.bond = u.bond; u.men -= men;
      // Picked men formed into a body of their own where they stand: a guard, a garrison, a cadre.
      if (stays) return { ok: true, msg: `${d.id}, ${menText(men)}, was formed out of ${u.id} and stays at ${w.provinces[op.to].name}. ${u.id} keeps ${menText(u.men)}.` };
      if (dry) { const r = bySea(d); if (!r.ok) { u.men += d.men; delete w.units[d.id]; return r; } return { ...r, msg: `${d.id}, ${menText(men)}, was detached from ${u.id}. ${r.msg} ${u.id} keeps ${menText(u.men)}.` }; }
      d.target = op.to; d.marchSince = w.turn;
      return { ok: true, msg: `${d.id}, ${menText(men)}, was detached from ${u.id} and ordered to ${w.provinces[op.to].name}. ${u.id} keeps ${menText(u.men)}.` };
    }
    case 'merge_units': {
      const a = w.units[op.unit], b = w.units[op.into]; if (!a || !b || a === b || a.country !== c.id || b.country !== c.id) return fail('No such units.');
      if (a.kind !== b.kind) return fail(`${a.id} is ${a.kind} and ${b.id} is ${b.kind}; different arms stay separate units.`);
      // A unit on the march to where the other stands (or bound for the same place as it) joins it when it comes up: "B402 returns to
      // Kishukarir and rejoins B33" is a march and then a joining, and the joining waits for the march.
      if (a.province !== b.province) { const bound = a.target && (a.target === b.province || (b.target && a.target === b.target));
        if (!bound) return fail(`${a.id} and ${b.id} must stand in the same province to be joined. March ${a.id} to ${w.provinces[b.province]?.name ?? b.province} (move) and order the joining with the march: it then joins when it arrives.`);
        a.joinTo = b.id; return { ok: true, msg: `${a.id} is on the march to ${w.provinces[a.target]?.name ?? a.target}: it joins ${b.id} when the two stand together there, and the staff reports it.` }; }
      const n = joinUnits(w, a, b);
      return { ok: true, msg: `${a.id} was joined to ${b.id}, which now musters ${menText(n)}.` };
    }
    // A general order to the army moves the troops that are free to move. Units told to stand on the defensive stay where they are: only an order to
    // such a unit by name moves it.
    case 'move_army': { if (!w.provinces[op.to]) return fail('No such target province.'); const mine = Object.values(w.units).filter(u => u.country === c.id), fixed = mine.filter(u => u.posture === 'defensive'), us = mine.filter(u => u.posture !== 'defensive').sort((a, b) => b.men - a.men);
      const share = Math.ceil(us.length * num(op.share, .1, 1, .6)), went = us.slice(0, share).filter(u => applyOrder(w, c, u, op.to, false).ok), held = fixed.length ? ` ${fixed.map(u => u.id).join(', ')} stand${fixed.length > 1 ? '' : 's'} on the defensive by standing order and stay${fixed.length > 1 ? '' : 's'}; an order to a unit by name (move) moves it and lifts that order.` : '';
      if (!went.length) return fail(us.length ? `Your units have no route to this target.${held}` : `Every unit stands on the defensive by standing order; none marched.${held}`);
      const slow = Math.max(...went.map(u => marchQuarters(w, u, op.to) ?? 0));
      return { ok: true, msg: `${went.length} unit${went.length > 1 ? 's' : ''} (${went.map(u => u.id).join(', ')}) ordered to ${w.provinces[op.to].name}${slow ? `; the last should be there in about ${slow} quarter${slow > 1 ? 's' : ''} as the ground, the roads and the seasons stand` : ''}.${held}` }; }
    case 'set_posture': return setPosture(w, c, op);
    // The staff draws up a plan for war with a named state. It takes two quarters, and a staff keeps two such plans in order at a time. Ordering
    // it again, or adding to it, neither hastens nor restarts the work; only a new first objective, once the plan is finished, sends it back to the desks.
    case 'prepare_plan': {
      if (!target) return fail('Name the state the plan is against (target).');
      const aim = has(w.provinces, op.objective) && w.provinces[op.objective].controller === target.id ? op.objective : null, old = (c.plans ||= {})[target.id], text = String(op.text ?? '').slice(0, 600);
      if (old) {
        const done = old.ready <= w.turn, recast = !!aim && aim !== old.objective, left = old.ready - w.turn, when = done ? 'lies ready' : `will be ready in ${left} quarter${left > 1 ? 's' : ''}`;
        if (text) old.text = text;
        if (!recast) return { ok: true, msg: `The staff's plan for war with ${target.name}${old.objective ? `, with ${w.provinces[old.objective]?.name} as its first objective,` : ''} ${when}.${text ? ' What was ordered now is written into it.' : ''} Ordering the plan again neither hastens it nor starts it afresh.` };
        old.objective = aim; if (done) { old.since = w.turn; old.ready = w.turn + 1; }
        return { ok: true, msg: done ? `The finished plan for war with ${target.name} is recast around a new first objective, ${w.provinces[aim].name}: a quarter's work, during which the army has no plan to open by. Copies of the old plan, if any have gone abroad, are now worthless.` : `The plan for war with ${target.name}, still being drawn up, now takes ${w.provinces[aim].name} as its first objective; it ${when}.` };
      }
      const kept = Object.entries(c.plans).sort((a, b) => a[1].since - b[1].since); let dropped = '';
      if (kept.length >= 2) { delete c.plans[kept[0][0]]; dropped = ` The staff keeps two plans in order at a time: the plan against ${w.countries[kept[0][0]]?.name ?? kept[0][0]} is put away and is no longer current.`; }
      c.plans[target.id] = { since: w.turn, ready: w.turn + 2, by: actor.id, objective: aim, text };
      return { ok: true, msg: `The staff is drawing up a plan for war with ${target.name}${aim ? `, with ${w.provinces[aim].name} as its first objective` : ''}: railway timetables, concentration areas, the order of the first attacks. It is ready in two quarters. If war with them comes while it lies ready, the army opens by timetable for the first three quarters: columns in an offensive keep time far better and planned attacks go in as prepared. It is a paper: the officers and clerks of the staff handle it, and whoever comes by a copy across the frontier is waiting where the blow falls. A new first objective makes an old copy worthless.${dropped}` };
    }
    // Handing the staff's plan to a foreign government. Whoever does it has done something that can be found out.
    case 'leak_plan': {
      const against = alive(w, op.against), plan = against && c.plans?.[against.id]; if (!plan) return fail('The staff holds no plan for war with that state.');
      if (plan.ready > w.turn) return fail('That plan is not yet finished: there is nothing whole to hand over.');
      const person = has(w.characters, op.to) ? w.characters[op.to] : null, to = alive(w, person?.alive ? person.country : op.to); if (!to || to.id === c.id) return fail('Name the foreign state, or the person abroad, who is to have it (to).');
      (to.stolen ||= {})[c.id] = { against: against.id, turn: w.turn, objective: plan.objective ?? null, text: plan.text ?? '', from: actor.id };
      leaveTrace(w, actor, `Passed the general staff's plan for war with ${against.name} to ${to.name}.`);
      for (const ch of [w.characters[to.leader], w.characters[to.general]]) tell(w, ch, 'Intelligence', `A copy of the general staff's plan of ${c.name} for war with ${against.id === to.id ? 'us' : against.name} has reached us${person?.alive ? ` through ${person.name}` : ''}${plan.objective ? `: its first objective is ${w.provinces[plan.objective]?.name} (${plan.objective})` : ''}${plan.text ? `. It says: "${plan.text}"` : ''}. ${against.id === to.id ? 'While they follow this plan we know where they will come: their opening attacks lose their surprise and a tenth of their force. A new plan on their side would make this copy worthless.' : `It can be passed on to ${against.name}.`}`);
      return { ok: true, msg: `A copy of the plan for war with ${against.name} is in the hands of ${to.name}. ${against.id === to.id ? 'While our army follows that plan they will be waiting for it.' : ''} It is the kind of thing that leaves a trace on whoever did it.` };
    }
    case 'offensive': return offensive(w, c, op);
    case 'declare_war': {
      if (!target) return fail('War cannot be declared: no such country.');
      // Against a country one is already at war with, a declaration can only say what the war is for. Aims named late are measured from the day they are named.
      if (atWar(w, c.id, target.id)) {
        const war = w.wars.find(x => x.active && ((x.a.includes(c.id) && x.b.includes(target.id)) || (x.b.includes(c.id) && x.a.includes(target.id)))), stated = war ? readAims(w, target, op) : null;
        if (!stated) return fail(`${c.name} is already at war with ${target.name}. To say what that war is for, name what can be measured: provinces of theirs, an indemnity, the fall of their ruler, or the end of a treaty.`);
        if (allowance(w, c, `aims:${target.id}`, 1, 1) <= 0) return fail('The aims of this war have been stated once this quarter already.');
        const was = war.aims?.[c.id], same = was && aimsText(w, was) === aimsText(w, stated);
        // Said again as they stand, the aims are not changed, and nobody takes it for a change.
        if (same) return { ok: true, msg: `${c.name} is at war with ${target.name} already, and its aims stand as they were declared: ${aimsText(w, was)}.` };
        const changed = !!war.aims?.[c.id], what = aimsText(w, stated); (war.aims ||= {})[c.id] = stated;
        // Aims that grow in mid-war make every other government wonder where they will stop.
        if (changed) for (const o of aliveCountries(w)) if (o.id !== c.id && o.id !== target.id) o.relations[c.id] = clampRel((o.relations[c.id] ?? 0) - 3);
        news(w, `${c.name} has ${changed ? 'restated' : 'stated'} its aims in the war with ${target.name}: ${what}.`, { kind: 'war', countries: [c.id, target.id] });
        tell(w, w.characters[target.leader], c.name, `${c.name} has ${changed ? 'restated' : 'stated'} what it is fighting us for: ${what}.`);
        return { ok: true, msg: `The aims of the war with ${target.name} are now on record: ${what}. From today the peace is measured against them at home and abroad${changed ? '; other governments have noted that the aims were changed in mid-war' : ''}.` };
      }
      { const lord = protectorOf(w, c); if (lord?.alive && lord.id !== target.id) return fail(`Under the treaty of protection with ${lord.name} this state does not make war on its own. The treaty would have to be broken first.`); }
      // Whatever was signed with them is torn up. Breaking a peace that is still fresh costs most, at home and with everyone who watches.
      for (const t of w.treaties.filter(x => x.active && x.parties.includes(c.id) && x.parties.includes(target.id))) { t.active = false; if (['peace', 'nonaggression', 'alliance'].includes(t.kind)) { t.brokenBy = c.id; t.brokenAt = w.turn; } c.legitimacy = clamp(c.legitimacy - (t.kind === 'peace' ? 8 : 3), 0, 100); if (t.kind === 'peace') for (const o of aliveCountries(w)) if (o.id !== c.id) o.relations[c.id] = clampRel((o.relations[c.id] ?? 0) - 6); }
      w.wars.push({ id: nextId(w, 'S'), a: [c.id], b: [target.id], civil: false, active: true, start: w.turn, name: `${c.name} - ${target.name} War` }); c.embargo = c.embargo.filter(x => x !== target.id); c.relations[target.id] = -90; target.relations[c.id] = -90;
      // War after an ultimatum that was let run out is the consequence that was announced. War on someone one had a treaty with is a broken word.
      // What every other government and every lender marks: a war in breach of a treaty (most of all a peace not two years old), a war without an
      // ultimatum, a war without so much as a claim. A war that follows an ultimatum let run out is what was announced, and costs no standing.
      const broke = w.treaties.filter(x => !x.active && x.brokenBy === c.id && x.brokenAt === w.turn && x.parties.includes(target.id)), warned = (c.casus?.[target.id] ?? -1) >= w.turn, claim = claimsOf(w, c.id).some(p => p.owner === target.id);
      let abroad = '';
      if (warned) { c.legitimacy = clamp(c.legitimacy + 3, 0, 100); delete c.casus[target.id]; deed(w, c, `went to war with ${target.name} when its ultimatum had run out`); }
      else if (broke.length) { const t = broke.find(x => x.kind === 'peace') ?? broke[0], fresh = t.kind === 'peace' && w.turn - (t.since ?? t.turn ?? 0) < 8; shame(w, c, fresh ? -14 : -10, `it made war on ${target.name} in spite of a treaty`);
        deed(w, c, `went to war with ${target.name}, tearing up ${kindWord(t)} it had signed with them in ${quarterLabel(t.since ?? t.turn ?? w.turn)}`);
        news(w, `${c.name} has gone to war with ${target.name} in breach of ${kindWord(t)} it signed in ${quarterLabel(t.since ?? t.turn ?? w.turn)}.`, { kind: 'diplomacy', countries: [c.id, target.id] });
        abroad = ` It tears up ${kindWord(t)} signed in ${quarterLabel(t.since ?? t.turn ?? w.turn)}: every government has marked it, the country's word is worth less, and lenders will ask more for it.`; }
      else { shame(w, c, claim ? -2 : -5, `it made war on ${target.name} without an ultimatum${claim ? '' : ' and without a claim'}`); deed(w, c, `went to war with ${target.name} without an ultimatum${claim ? '' : ' and without a claim to any of its land'}`);
        abroad = ` No ultimatum went before it${claim ? '' : ', and no claim to their land stands behind it'}: other governments have marked that, and so have the houses that lend to us.`; }
      // A war on a people of the country's own faith is taken ill at home in the measure the country is devout.
      { const fc = faithCost(c, target); if (fc >= .5) { c.legitimacy = clamp(c.legitimacy - fc, 0, 100); abroad += ` ${target.name} is of our own faith: the devout take the war ill, and the government's standing fell by about ${Math.round(fc * 10) / 10}.`; } }
      // A war for land that was lost and never given up is a war the country understands.
      if (claimsOf(w, c.id).some(p => p.owner === target.id)) c.legitimacy = clamp(c.legitimacy + 2, 0, 100);
      // A people that has been wronged by the enemy stands behind the declaration, for a while.
      { const g = c.grudges?.[target.id]; if (g) c.legitimacy = clamp(c.legitimacy + Math.min(6, g.incident * .1 + g.kin * .15), 0, 100); }
      const said = stateAims(w, c, target, op);
      for (const a of aliveCountries(w)) if (a.id !== c.id && a.id !== target.id && hasTreaty(w, a.id, target.id, 'alliance')) tell(w, w.characters[a.leader], 'Foreign Ministry', `Your ally ${target.name} was attacked by ${c.name}. Help is expected under the alliance.`);
      return { ok: true, msg: `${said}${abroad}` };
    }
    case 'join_war': {
      const war = w.wars.find(x => x.active && x.id === op.war); if (!war || !['a', 'b'].includes(op.side)) return fail('War not found.'); if (war.a.includes(c.id) || war.b.includes(c.id)) return fail('Already in this war.');
      const foes = war[op.side === 'a' ? 'b' : 'a'].map(id => w.countries[id]).filter(o => o?.alive);
      { const lord = protectorOf(w, c); if (lord?.alive && !foes.includes(lord)) return fail(`Under the treaty of protection with ${lord.name} this state does not make war on its own. The treaty would have to be broken first.`); }
      for (const o of foes) {
        // Coming into a war against someone one has signed with is a broken word, by whatever door it is done.
        let broke = false;
        for (const t of w.treaties.filter(x => x.active && x.parties.includes(c.id) && x.parties.includes(o.id))) { t.active = false; if (['peace', 'nonaggression', 'alliance'].includes(t.kind)) { t.brokenBy = c.id; t.brokenAt = w.turn; broke = true; } c.legitimacy = clamp(c.legitimacy - (t.kind === 'peace' ? 8 : 3), 0, 100); if (t.kind === 'peace') for (const a of aliveCountries(w)) if (a.id !== c.id) a.relations[c.id] = clampRel((a.relations[c.id] ?? 0) - 6); }
        if (broke) shame(w, c, -10, `it went to war with ${o.name} in spite of a treaty`);
        c.relations[o.id] = -90; o.relations[c.id] = -90; c.embargo = c.embargo.filter(x => x !== o.id);
        tell(w, w.characters[o.leader], 'Foreign Ministry', `${c.name} has entered the ${war.name} against you.`);
      }
      war[op.side].push(c.id); news(w, `${c.name} entered the ${war.name}.`, { kind: 'war', countries: [c.id, ...foes.map(o => o.id)] }); return ok();
    }
    case 'propose_treaty': {
      // More than one other party, a joint guarantee, or a treaty laid before a conference: a treaty among several.
      { const many = [...new Set((Array.isArray(op.parties) ? op.parties : []).map(String))].filter(id => id !== c.id && alive(w, id));
        if (many.length >= 2 || op.kind === 'guarantee' || op.conference) return proposeMany(w, c, op, many.length ? many : target ? [target.id] : []);
        if (!target && many.length === 1) return applyOp(w, actor, { ...op, target: many[0], parties: undefined }); }
      if (!target || !TREATY.includes(op.kind)) return fail('Invalid proposal.');
      if (!dealsWith(w, c.id, target.id) && op.kind !== 'peace') return fail(recognisesText(w, c, target));
      if (!maySign(w, c.id, target.id, op.kind)) return fail(`Between this state and ${target.name} stand ${tieWord(tieOf(w, c.id, target.id))}: nothing of this kind can be signed between the two unless a third state carries it (a mediator, a conference), or relations are restored first (set_relations).`);
      if (op.kind === 'peace' && !atWar(w, c.id, target.id)) return fail('There is no war between you to end.');
      // An armistice stops the fighting where the lines stand and leaves the war, the occupied land and the blockade as they are, for as long as it runs.
      if (op.kind === 'armistice') { if (!atWar(w, c.id, target.id)) return fail('There is no war between you to halt.'); if (hasTreaty(w, c.id, target.id, 'armistice')) return fail('An armistice between you is already in force.'); }
      if (op.kind === 'alliance') { const lord = protectorOf(w, c); if (lord?.alive && lord.id !== target.id) return fail(`Under the treaty of protection with ${lord.name} this state makes no alliances of its own.`); }
      const id = nextId(w, 'A'), clauses = normalizeClauses(w, op.clauses, [c.id, target.id]), other = pid => w.provinces[pid].owner === c.id ? target : c;
      // Provinces named in a treaty change hands when it is signed: each goes from whichever of the two owns it to the other.
      const cede = [...new Set((Array.isArray(op.cede) ? op.cede : []).map(x => x && typeof x === 'object' ? x.province : x))].filter(pid => [c.id, target.id].includes(w.provinces[pid]?.owner)).slice(0, 24), reparations = num(op.reparations, 0, .3), payer = op.reparations_from === 'me' ? c.id : target.id, secret = !!op.secret && !['peace', 'armistice'].includes(op.kind);
      w.treaties.push({ id, kind: op.kind, ...(op.kind === 'protection' ? { protector: op.protector === 'them' ? target.id : c.id } : {}), parties: [c.id, target.id], active: false, pending: true, proposer: c.id, terms: String(op.terms || '').slice(0, 240), clauses, breaches: [], expires: null, durationTurns: op.turns ? Math.round(num(op.turns, 1, 200, 40)) : null, annex: !!op.annex, cede, reparations, payer, turn: w.turn, secret });
      tell(w, w.characters[target.leader], c.name, `Treaty proposal ${id}${secret ? ' (to be kept secret: known to those who govern and, where it concerns the army, to their chiefs of staff)' : ''}: ${op.kind.replace('_', ' ')}. ${String(op.terms || '').slice(0, 240)}${clauses.length ? ` Clauses: ${clauses.map(x => clauseText(w, x)).join('; ')}.` : ''}${cede.length ? ` Provinces to change hands: ${cede.map(pid => `${w.provinces[pid].name} (${pid}) to ${other(pid).name}`).join(', ')}.` : ''}${op.annex ? ' Each side keeps the land it now holds.' : ''}${reparations ? ` ${w.countries[payer].name} pays ${Math.round(reparations * 100)}% of a quarter's output in gold.` : ''} Issue an accept_treaty decision to accept.`);
      { const land = settlementText(w, w.treaties.at(-1)); if (land && op.kind === 'peace') tell(w, w.characters[target.leader], c.name, `What proposal ${id} does to the land, whatever its wording: ${land}`);
        return { ok: true, msg: `Proposal ${id} was sent.${land ? ` ${land}${op.kind === 'peace' ? ' If the wording of the treaty means something else, the provinces have to be named in it (cede), or it has to say that each side keeps what it holds (annex).' : ''}` : ''}`, treaty: id }; }
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
      if (op.op === 'expel') { const next = aliveCountries(w).filter(o => o.id !== c.id && o.id !== home.id).sort((a, b) => (a.relations[home.id] ?? 0) - (b.relations[home.id] ?? 0))[0]; if (!next) return fail('There is nowhere else for them to go.'); ch.host = next.id; (ch.turnedOut ||= []).includes(c.id) || ch.turnedOut.push(c.id); ch.recognisedBy = (ch.recognisedBy || []).filter(x => x !== c.id); tell(w, ch, c.name, `${c.name} has put you over the border. You are in ${next.name} now; you may move on to any state that will have you (go_abroad).`); tell(w, w.characters[next.leader], 'Police', `${ch.name}, an exile from ${home.name}, has been expelled by ${c.name} and has come to us.`); return { ok: true, msg: `${ch.name} was put over the border into ${next.name}.` }; }
      const list = ch.recognisedBy ||= [];
      if (op.withdraw) { if (!list.includes(c.id)) return fail('You have not recognised them.'); ch.recognisedBy = list.filter(x => x !== c.id); news(w, `${c.name} no longer recognises ${ch.name} as the government of ${home.name}.`, { kind: 'diplomacy', countries: [c.id, home.id] }); return ok(); }
      if (list.includes(c.id)) return fail('You recognise them already.');
      list.push(c.id); ch.power = clamp(ch.power + 8, 0, 100); home.relations[c.id] = clampRel((home.relations[c.id] ?? 0) - 30);
      news(w, `${c.name} has recognised ${ch.name}, in exile, as the rightful government of ${home.name}.`, { kind: 'diplomacy', countries: [c.id, home.id] }); tell(w, ch, c.name, `${c.name} recognises you as the rightful government of ${home.name}.`); tell(w, w.characters[home.leader], 'Foreign Ministry', `${c.name} has recognised ${ch.name}, in exile there, as the rightful government of our country.`);
      return { ok: true, msg: `${ch.name} is recognised by you as the rightful government of ${home.name}. It weighs on the standing of those who rule there, and they will not forgive it.` };
    }
    case 'accept_treaty': {
      const waiting = w.treaties.filter(x => (x.pending && x.parties.includes(c.id) && x.proposer !== c.id && !(x.signed || []).includes(c.id)) || (x.multi && x.active && (x.open || []).includes(c.id))), from = waiting.filter(x => !target || x.proposer === target.id), named = op.id != null && op.id !== '' ? w.treaties.find(x => x.id === String(op.id)) : null, t = named ? waiting.find(x => x.id === named.id) ?? null : waiting.find(x => x.id === op.id) ?? (from.length === 1 && (target || op.id == null || op.id === '') ? from[0] : null);
      // A signature goes to the paper that was named, or to none. (World 17: an order to sign a treaty already signed put the signature on the one
      // other paper on the table, a commission its government had refused three times.)
      if (named && !t) { const ours = (named.parties || []).includes(c.id), rest = waiting.length ? ` Unsigned on the table: ${waiting.map(x => `${x.id} (${x.kind}, from ${w.countries[x.proposer]?.name ?? x.proposer})`).join(', ')}.` : '';
        if (ours && (named.active || (named.signed || []).includes(c.id))) return { ok: true, msg: `${named.id} bears our signature already${named.active ? ' and is in force' : ''}: there is nothing more to sign.${rest}` };
        return fail(`${named.id} is not waiting for our signature${ours && named.proposer === c.id ? ': it is our own proposal, and the other side signs it' : named.pending ? '' : ': it is closed'}.${rest}`); }
      // A signature ordered for a paper that has not arrived yet waits for it: in a quarter two governments agree by letter, one sends the treaty and
      // the other signs, and which of the two orders reaches the engine first is chance. It is given when the quarter's proposals are all in
      // (carrySigned, before the quarter is played), and whoever ordered it is told what came of it.
      if (!t && target && !from.length && !op._late) { const q = (w.signing ||= []), at = q.findIndex(x => x.actor === actor.id && x.target === target.id), entry = { turn: w.turn, actor: actor.id, target: target.id }; if (at >= 0) q[at] = entry; else q.push(entry);
        return { ok: true, waits: `sign:${target.id}`, msg: `No proposal from ${target.name} has reached us yet${waiting.length ? ` (what lies on the table, ${waiting.map(x => x.id).join(', ')}, is not theirs)` : ''}. The signature is ready: it is given to whatever single proposal of theirs arrives this quarter, and if none comes nothing is signed. The Foreign Ministry reports which.` }; }
      if (!t) return fail(waiting.length ? `Which proposal? Waiting: ${waiting.map(x => x.id).join(', ')}.` : 'No proposal is waiting.');
      if (t.multi) return signMany(w, c, t);
      const other = alive(w, t.proposer); if (!other) { t.pending = false; return fail('The other party is gone.'); }
      if (!t.ultimatum && !maySign(w, c.id, other.id, t.kind)) return fail(`Between this state and ${other.name} stand ${tieWord(tieOf(w, c.id, other.id))}: this cannot be signed until relations are restored (set_relations), unless a third state carries it.`);
      if (['peace', 'armistice'].includes(t.kind) && !atWar(w, c.id, other.id)) { t.pending = false; return fail(`There is no war between you to ${t.kind === 'peace' ? 'end' : 'halt'}.`); }
      const owned = id => sum(Object.values(w.provinces).filter(p => p.owner === id), provincePop), had = { [c.id]: owned(c.id), [other.id]: owned(other.id) };
      // A peace is a treaty in force like any other: for some years, breaking it is breaking one's word. An armistice runs a year unless a term was named.
      { const stop = moneyStops(w, t); if (stop) return fail(stop); }
      t.pending = false; t.active = true; t.since = w.turn; activateClauses(w, t); const lasts = t.durationTurns ?? (t.kind === 'peace' ? 20 : t.kind === 'armistice' ? 4 : t.kind === 'commission' ? 8 : null); if (lasts) t.expires = w.turn + lasts;
      // Giving way to a demand with a date on it is seen at home for what it is, and remembered against the one who made it.
      if (t.ultimatum) { c.legitimacy = clamp(c.legitimacy - 4, 0, 100); other.legitimacy = clamp(other.legitimacy + 2, 0, 100); const g = (c.grudges ||= {})[other.id] ||= { incident: 0, kin: 0 }; g.incident += 15; news(w, `${c.name} has accepted the ultimatum of ${other.name}.`, { kind: 'diplomacy', countries: [c.id, other.id] }); }
      const fought = warsBetween(w, c.id, other.id), land = settlementText(w, t); t.since = w.turn;
      if (land && (t.kind === 'peace' || t.cede?.length)) { news(w, `${c.name} and ${other.name}: ${land.replace('On signing these provinces change hands', 'by the treaty these provinces changed hands').replace('goes back to its owner the day the peace is signed', 'went back to its owner')}`, { kind: 'diplomacy', countries: [c.id, other.id], secret: !!t.secret }); tell(w, w.characters[other.leader], c.name, `${c.name} has signed ${t.id}. ${land}`); }
      const gave = {}, got = {}, surrender = {};
      for (const pid of t.cede || []) {
        const p = w.provinces[pid], giver = w.countries[p.owner], taker = p.owner === c.id ? other : p.owner === other.id ? c : null; if (!taker) continue;
        (gave[giver.id] ||= []).push([p, taker.id, hasFought(w, giver.id, taker.id)]); got[taker.id] = true;
        p.owner = taker.id; p.controller = taker.id; p.admin = Math.min(p.admin ?? .5, .3); p.governor = null; delete p.siege; handOver(w, p, giver.id, taker.id, t.kind === 'peace' || !!t.ultimatum);
        if (giver.capital === pid) { const next = [...countryProvinces(w, giver.id)].sort((a, b) => provincePop(b) - provincePop(a))[0]; if (next) giver.capital = next.id; }
        news(w, `${p.name} passed from ${giver.name} to ${taker.name} by treaty.`, { kind: 'diplomacy', countries: [giver.id, taker.id], province: pid });
      }
      // Signed away without a battle fought for it (while the war, if there is one, still stands on the books).
      unfoughtLand(w, gave, got, (id, text) => { surrender[id] = (surrender[id] || '') + text; });
      // Land taken at the end of a war or under a threat is a deed others read of, and those who live beside the taker are warned by their staffs.
      if ((t.kind === 'peace' || t.ultimatum) && t.cede?.length) for (const [taker, giver] of [[c, other], [other, c]]) { const got = (t.cede || []).map(pid => w.provinces[pid]).filter(p => p && p.owner === taker.id && had[taker.id] != null && p.lostBy === giver.id); if (got.length) { deed(w, taker, `took ${got.map(p => p.name).join(' and ')} from ${giver.name} by the ${t.ultimatum ? 'ultimatum it sent' : 'peace it made'}`); alarm(w, taker, giver, got); } }
      // The war is wound up once the land has changed hands, not before (see settleTerms): troops standing in what the treaty gives their country stay.
      if (t.kind === 'peace') { endWar(w, c.id, other.id, t.annex); peaceRecognises(w, c, other); for (const x of w.treaties) if (x !== t && x.pending && !x.multi && ['peace', 'armistice'].includes(x.kind) && x.parties.includes(c.id) && x.parties.includes(other.id)) x.pending = false; }
      if (t.cede?.length) settleOccupations(w);
      if (t.reparations) {
        // Paid in gold as far as there is gold; the rest is owed.
        const payer = t.payer === other.id ? other : c, payee = payer === c ? other : c, due = Math.max(payer.realGdp, 1) * t.reparations, paid = Math.min(Math.max(payer.reserves, 0), due);
        payer.reserves -= paid; payee.reserves += paid; if (due - paid > .5) payer.creditors[payee.id] = (payer.creditors[payee.id] || 0) + due - paid;
      }
      // Land signed away at the end of a war or under a threat is a defeat the whole country can measure: the government that signs pays for it in
      // standing, by how many of its people went with the land, and the army does not forgive it. The government that took it is credited.
      let signed = ['alliance', 'guarantee', 'protection'].includes(t.kind) ? bondSigned(w, c, other) : '';
      if (t.kind === 'peace' || t.ultimatum) for (const [x, y] of [[c, other], [other, c]]) {
        const lost = (had[x.id] - owned(x.id)) / Math.max(had[x.id], 1); if (!(lost > .005)) continue;
        const cost = clamp(lost * 70, 1, 28), gain = clamp((owned(y.id) - had[y.id]) / Math.max(had[y.id], 1) * 25, .5, 8);
        x.legitimacy = clamp(x.legitimacy - cost, 0, 100); x.blocs.army.sat = clamp(x.blocs.army.sat - lost * 40, 0, 100); y.legitimacy = clamp(y.legitimacy + gain, 0, 100);
        if (x === c) signed = ` About ${Math.round(lost * 100)}% of the country's people went with the land that was signed away; the government's standing at home fell by about ${Math.round(cost)}.`;
        tell(w, w.characters[x.leader], 'The capital', `The treaty with ${y.name} took about ${Math.round(lost * 100)}% of the country's people with the land it gave up. It is being called a defeat, in the streets and in the army.`);
      }
      if (surrender[c.id]) signed += surrender[c.id];
      if (t.kind === 'peace') { const paid = (t.reparations || 0); signed += weighAims(w, c, other, fought, t.payer === other.id ? paid : 0); weighAims(w, other, c, fought, t.payer === c.id ? paid : 0); }
      news(w, t.kind === 'peace' ? `${c.name} and ${other.name} signed a peace.` : t.kind === 'armistice' ? `${c.name} and ${other.name} signed an armistice: the fighting stops where the lines stand${t.expires != null ? `, for ${t.expires - w.turn} quarters` : ''}.` : `Treaty signed between ${c.name} and ${other.name}: ${t.kind.replace('_', ' ')}.`, { kind: 'diplomacy', countries: [c.id, other.id], secret: !!t.secret });
      const harsh = t.annex || t.reparations > 0 || t.cede?.length, warmth = t.kind === 'armistice' ? 5 : t.kind === 'peace' && harsh ? 4 : 18;
      c.relations[other.id] = clampRel((c.relations[other.id] ?? 0) + warmth); other.relations[c.id] = clampRel((other.relations[c.id] ?? 0) + warmth);
      return t.kind === 'armistice' ? { ok: true, msg: `The armistice is in force${t.expires != null ? ` for ${t.expires - w.turn} quarters` : ''}. Nobody attacks, advances or presses a siege while it lasts; the war, the occupied land and any blockade stay as they are until a peace is signed or it runs out.` } : { ok: true, msg: `Signed: ${t.id} (${t.kind.replace(/_/g, ' ')}) with ${other.name} is in force${t.expires != null ? ` until ${quarterLabel(t.expires)}` : ''}${t.secret ? ', and secret' : ''}.${(t.clauses || []).length ? ` What it binds the parties to, beyond its words: ${t.clauses.map(cl => cl.text).filter(Boolean).join('; ')}.` : ' Nothing in it is enforced beyond its words: what the text promises is kept or broken by those who signed it.'}${land ? ` ${land}` : ''}${signed}` };
    }
    // A paper on the table is answered: signed, or declined. Declined, it leaves the table and its sender is told; an ultimatum refused in so
    // many words has run out the day it is refused.
    case 'decline_treaty': {
      if (!governs(w, c, actor)) return fail('Only whoever governs answers a paper sent to the state.');
      const waiting = w.treaties.filter(x => x.pending && x.proposer !== c.id && (x.parties.includes(c.id) || (x.invited || []).includes(c.id)) && !(x.signed || []).includes(c.id)), from = waiting.filter(x => !target || x.proposer === target.id), t = waiting.find(x => x.id === op.id) ?? (op.id == null && from.length === 1 ? from[0] : null);
      if (!t) return fail(waiting.length ? `Which proposal? Waiting: ${waiting.map(x => `${x.id} (${x.kind}, from ${cname(w, x.proposer)})`).join(', ')}.` : 'No proposal is waiting for an answer.');
      const other = w.countries[t.proposer], words = String(op.words ?? op.text ?? '').slice(0, 300);
      if (t.ultimatum) { t.ultimatum.deadline = Math.min(t.ultimatum.deadline, w.turn); t.refused = w.turn; tell(w, w.characters[other?.leader], c.name, `${c.name} has refused ultimatum ${t.id} in so many words${words ? `: "${words}"` : ''}. It is as if it had run out: what was threatened is now expected of us.`); news(w, `${c.name} has refused the ultimatum of ${other?.name ?? 'its neighbour'}.`, { kind: 'diplomacy', countries: [c.id, t.proposer] }); return { ok: true, msg: `Ultimatum ${t.id} is refused, and ${other?.name} is told so: it counts as run out when this quarter closes, and what they threatened is expected of them from then.` }; }
      if (t.multi) { t.invited = (t.invited || []).filter(x => x !== c.id); t.declinedBy = [...(t.declinedBy || []), c.id]; } else { t.pending = false; t.declined = w.turn; }
      tell(w, w.characters[other?.leader], c.name, `${c.name} has declined ${t.multi ? 'to sign' : 'your proposal'} ${t.id} (${t.kind.replace(/_/g, ' ')})${words ? `: "${words}"` : ''}.${t.multi ? '' : ' It is off the table; a new paper would have to be sent.'}`);
      return { ok: true, msg: `${t.id} (${t.kind.replace(/_/g, ' ')}) from ${other?.name} is declined and ${t.multi ? 'our name is struck from it' : 'off the table'}; they are told.` };
    }
    // What a government has sent it can take back while it is unsigned. A demand with a date on it that is taken back is a climb-down seen by
    // everybody: it costs less than one left to run out with nothing behind it, and it still costs.
    case 'withdraw_treaty': {
      if (!governs(w, c, actor)) return fail('Only whoever governs takes back what the state has sent.');
      const mine = w.treaties.filter(x => x.proposer === c.id && (x.pending || (x.ultimatum && c.casus?.[x.parties.find(y => y !== c.id)] != null && !x.active))), from = mine.filter(x => !target || x.parties.includes(target.id)), t = mine.find(x => x.id === op.id) ?? (op.id == null && from.length === 1 ? from[0] : null);
      if (!t) return fail(mine.length ? `Which paper? Yours that can still be taken back: ${mine.map(x => x.id).join(', ')}.` : 'Nothing of yours is on anybody\'s table to take back.');
      const oid = t.parties.find(y => y !== c.id), other = w.countries[oid];
      if (t.ultimatum) { const threat = c.casus?.[oid] != null || t.pending; t.pending = false; t.withdrawn = w.turn; if (c.casus) delete c.casus[oid];
        if (threat) { shame(w, c, -4, `it took back its ultimatum to ${other?.name ?? 'a neighbour'}`); c.legitimacy = clamp(c.legitimacy - 2, 0, 100); }
        news(w, `${c.name} has withdrawn its ultimatum to ${other?.name ?? 'its neighbour'}.`, { kind: 'diplomacy', countries: [c.id, oid] }); tell(w, w.characters[other?.leader], c.name, `${c.name} has withdrawn ultimatum ${t.id}: the demand is no longer made, and nothing is threatened.`);
        return { ok: true, msg: `Ultimatum ${t.id} is withdrawn and ${other?.name} is told; nothing is expected of you now. It is seen for what it is, a demand taken back: it cost about 2 of the government's standing at home and something of its word abroad, less than a threat left to run out with nothing behind it.` }; }
      t.pending = false; t.withdrawn = w.turn; for (const id of t.multi ? (t.invited || []) : [oid]) if (id !== c.id) tell(w, w.characters[w.countries[id]?.leader], c.name, `${c.name} has withdrawn its proposal ${t.id} (${t.kind.replace(/_/g, ' ')}): it is off the table.`);
      return { ok: true, msg: `Your proposal ${t.id} is withdrawn and off the table; ${t.multi ? 'those invited are' : `${other?.name} is`} told.` };
    }
    case 'break_treaty': { const t = w.treaties.find(x => x.id === op.id && x.active && x.parties.includes(c.id)); if (!t) return fail('No such treaty.'); if (t.multi && t.parties.length > 2) return withdraw(w, c, t); t.active = false; w.guarantees = (w.guarantees || []).filter(x => x.treaty !== t.id); const o = t.parties.find(x => x !== c.id), justified = t.breaches?.at(-1)?.party === o; shame(w, c, justified ? -2 : t.kind === 'peace' ? -15 : -8, `it broke its ${t.kind.replace('_', ' ')} treaty with ${w.countries[o]?.name ?? 'another state'}`); if (w.countries[o]) w.countries[o].relations[c.id] = clampRel((w.countries[o].relations[c.id] ?? 0) - (justified ? 10 : 35)); if (!justified) for (const a of aliveCountries(w)) if (a.id !== c.id) a.relations[c.id] = clampRel((a.relations[c.id] ?? 0) - 5); news(w, `${c.name} unilaterally broke its treaty.`, { kind: 'diplomacy', countries: [c.id, o], secret: !!t.secret }); return ok(); }
    case 'send_aid': { if (!target) return fail('No such target.'); const val = Math.min(Math.max(c.reserves, 0), Math.max(c.realGdp, 1) * num(op.pct_gdp, 0, .25)); const arms = Math.min(c.stock.arms, num(op.arms, 0, 1e9)); if (val <= 0 && arms <= 0) return fail('There is nothing to send.'); c.reserves -= val; target.reserves += val; c.stock.arms -= arms; target.stock.arms += arms; target.relations[c.id] = clampRel((target.relations[c.id] ?? 0) + 12); tell(w, w.characters[target.leader], c.name, `Aid has arrived: ${Math.round(val)} in gold${arms > 0 ? ` and ${Math.round(arms)} of arms` : ''}.`); news(w, `${c.name} sent aid to ${target.name}.`, { kind: 'diplomacy', countries: [c.id, target.id], secret: !!op.secret }); return { ok: true, msg: `${Math.round(val)} gold${arms > 0 ? ` and ${Math.round(arms)} arms` : ''} sent.` }; }
    case 'spy': { if (!target) return fail('No such target.');
      // Military intelligence is the staff's own work; blowing up works abroad or paying for a rising there is an act of state.
      if (['sabotage', 'fund_uprising'].includes(op.kind) && !governs(w, c, actor) && !delegated(c, actor, 'spy')) return fail('The chief of staff may gather intelligence abroad; sabotage and stirring a rising there need the ruler\'s order.');
      // One network, one task, one quarter: ordering the same thing again the same quarter doubles neither the chance nor the effect. Agents,
      // bribes and explosives are paid for by the state, whoever gave the order.
      const kind = ['sabotage', 'fund_uprising'].includes(op.kind) ? op.kind : 'intel', key = `spy:${target.id}:${kind}`;
      if (used(w, c, key) > 0) return fail('The network there has had this task once this quarter already; a second attempt so soon would only expose it.');
      const cost = gdp * (kind === 'intel' ? .0008 : kind === 'sabotage' ? .002 : .003), note = pay(c, cost); if (note === null) return fail(NO_FUNDS);
      allowance(w, c, key, 1, 1);
      const p = clamp(.25 + (c.intelligence - target.intelligence) / 160 + rand(w) * .3, .08, .9); if (rand(w) > p) { if (rand(w) < .5) { target.relations[c.id] = clampRel((target.relations[c.id] ?? 0) - 18); news(w, `${target.name} caught spies from ${c.name}.`, { kind: 'diplomacy', countries: [c.id, target.id] }); } return fail(`The operation failed; the ${Math.round(cost)} it cost is spent.${note}`); } c.intel[target.id] = clamp((c.intel[target.id] ?? 0) + 25, 0, 100); if (kind === 'sabotage') { const v = pick(w, countryProvinces(w, target.id)); if (v) { for (const k of Object.keys(v.plants)) v.plants[k] *= .9; v.devastation = clamp(v.devastation + .08, 0, 1); news(w, `Mysterious explosions at industrial plants in ${v.name}.`, { kind: 'plot', countries: [target.id] }); } }
      // Money for agitators keeps one fire burning; it does not light a second on top of the first.
      if (kind === 'fund_uprising') { const lit = target.mods.find(m => m.label === 'Foreign-backed unrest'); if (lit) lit.turns = 3; else target.mods.push({ key: 'unrest', delta: 9, turns: 3, label: 'Foreign-backed unrest' }); }
      return { ok: true, msg: `${kind === 'intel' ? `The network in ${target.name} is reporting` : kind === 'sabotage' ? `Works in ${target.name} were damaged` : `Agitators in ${target.name} are paid and at work for some quarters`}; it cost ${Math.round(cost)}.${note}` }; }
    // Words cost money to spread: printers, placards, hired speakers. Whoever governs pays from the treasury, anyone else from their own purse,
    // and only for as much as the country will still take: once it has heard enough, nothing more is printed and nothing more is spent.
    case 'propaganda': {
      // Placards are cheap, and they are believed as far as nothing contradicts them. A government's are answered by whatever press is free to
      // answer and by what people see in the shops; anybody's wear thin with repetition: a country told the same thing every quarter listens
      // with half an ear, and one left alone for a year or two listens again. Twenty orders in a quarter are one campaign.
      const s = num(op.strength, 0, 1, .5), ruler = governs(w, c, actor), stat = ruler ? 'sat.all' : 'unrest', who = ruler ? 'state' : actor.id;
      const rec = (c.hype ||= {})[who] ||= { turn: -99, level: 0, was: 0, gave: 0 }; if (rec.turn !== w.turn) { rec.was = rec.level * Math.pow(.8, Math.max(0, w.turn - rec.turn)); rec.gave = 0; }
      const press = ruler ? clamp(1 - c.pressFreedom / 100 * .6, .4, 1) : 1, shops = ruler ? clamp(.4 + .6 * Math.min(c.foodRatio ?? 1, 1), .4, 1) : 1, fresh = 1 - .6 * clamp(rec.was, 0, 1), cred = press * shops * fresh;
      const want = Math.max(0, (ruler ? 4 : 5) * s * cred - rec.gave), room = moodRoom(c, actor, stat) * cred;
      const active = sum(c.mods.filter(m => m.src === 'custom' && m.key === stat), m => m.delta), could = clamp(active + want, -room, room) - active;
      const told = [ruler && press < .75 ? 'a free press answered every placard' : '', shops < .92 ? 'empty shops argued with them' : '', fresh < .8 ? 'the country has heard a great deal of this lately' : ''].filter(Boolean);
      if (could < .05) return { ok: true, msg: `The country has heard as much of this as it will take for now; nothing was spent.${told.length ? ` (${told.join('; ')}.)` : ''}` };
      const cost = Math.abs(could) * (ruler ? gdp * .0015 : .6); let part = 1, note = '';
      if (ruler) { note = pay(c, cost); if (note === null) return fail(NO_FUNDS); }
      else { const m = Math.min(Math.max(actor.wealth, 0), cost); if (m < .05) return fail('Printers and speakers have to be paid, and your purse is empty.'); actor.wealth -= m; part = m / cost; }
      const moved = Math.abs(sway(c, actor, stat, could * part, 2, `Propaganda: ${actor.name}`)); rec.gave += moved; if (rec.turn !== w.turn) { rec.level = clamp(rec.was + .34, 0, 1); rec.turn = w.turn; }
      return { ok: true, msg: `Placards, pamphlets and speakers went out for ${Math.round(cost * part * 10) / 10}${ruler ? ' from the treasury' : ' from your purse'}.${told.length ? ` They carried about ${Math.round(cred * 100)} in the hundred as far as they might have: ${told.join('; ')}.` : ''}${part < 1 ? ' Your purse did not stretch to all that was meant.' : ''}${note}` };
    }
    // Harsh measures are carried out by policemen: a state that has few of them can order what it likes and little of it happens. The order is seen all the same.
    case 'repress': { const s = num(op.strength, 0, 1, .5), arm = clamp(c.police / 50, .25, 1.4); c.repress = clamp(c.repress + s * 55 * arm, 0, 100); c.pressFreedom = clamp(c.pressFreedom - s * 8, 0, 100); c.legitimacy = clamp(c.legitimacy - s * 3, 0, 100); for (const p of countryProvinces(w, c.id)) p.pops.middle.sat = clamp(p.pops.middle.sat - s * 9, 0, 100); news(w, `${c.name} security forces took harsh measures against dissidents.`, { kind: 'politics', countries: [c.id] });
      return { ok: true, msg: `The police carried it out as far as their numbers reach (the police stand at ${Math.round(c.police)} of 100). It holds the streets for some quarters; it shuts doors that people will resent having shut, and those who take up arms in secret gain by it.` }; }
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
    // Somebody held without a sentence can be asked out of the court: on surety, by anybody, himself included.
    case 'petition_release': { const ch = op.character == null && actor.status === 'imprisoned' ? actor : has(w.characters, op.character) ? w.characters[op.character] : null; if (!ch?.alive || ch.status !== 'imprisoned' || ch.country !== c.id) return fail('Nobody of that name is held here.');
      if (ch.sentence) return fail(`${ch.name} is serving a sentence of the court. A sentence is ended by whoever governs (release, amnesty), not on surety.`);
      if (allowance(w, c, `petition:${ch.id}`, 1, 1) <= 0) return fail('The court has heard a petition for that prisoner this quarter; it hears another in the next.');
      const surety = Math.min(Math.max(actor.wealth, 0), num(op.surety, 0, 200, 0)), held = w.turn - (ch.heldSince ?? w.turn), ruler = w.characters[c.leader], free = c.courts >= 45;
      // A court that is its own lets an untried prisoner go the more readily the longer he has sat without a charge and the more is put up for him; a court in the government's hand sends the paper to the palace.
      if (!free || rand(w) >= clamp(.2 + held * .12 + surety / 60 - (ch.trial ? .15 : 0), .1, .9)) { tell(w, ruler, 'The court', `${actor.id === ch.id ? `${ch.name}, held since ${quarterLabel(ch.heldSince ?? w.turn)},` : `${actor.name}`} has petitioned for ${actor.id === ch.id ? 'release' : `the release of ${ch.name}`} on surety${free ? '; the court refused it this time' : '. The court does not sit against the government: the petition lies with you'}.`); return fail(free ? `The court heard the petition and refused it this time (${ch.name} has been held ${held} quarter${held === 1 ? '' : 's'}${ch.trial ? ' and stands charged' : ' without a charge'}). It can be asked again next quarter; the longer ${he(ch)} sits untried and the more is put up for ${him(ch)}, the likelier it grants it.` : 'The court here does not sit against the government: it has sent the petition to the palace, where it lies. Only whoever governs lets that prisoner go (release).'); }
      actor.wealth -= surety; c.treasury += surety * (c.rate || 1); ch.status = 'free'; ch.outSince = w.turn; news(w, `${c.name}: a court has released ${ch.name} on surety, pending ${ch.trial ? 'trial' : 'any charge'}.`, { kind: 'politics', countries: [c.id] }); tell(w, ch, 'The court', `You are released on surety${actor.id !== ch.id ? `, on the petition of ${actor.name}` : ''}.`); tell(w, ruler, 'The court', `The court has released ${ch.name} on surety, on the petition of ${actor.name}.`);
      return { ok: true, msg: `The court has released ${ch.name} on surety${surety > .5 ? ` (${Math.round(surety)} paid into court)` : ''}${ch.trial ? '; the charge still stands and will be tried' : ''}.` }; }
    case 'purge': {
      const ch = w.characters[op.character]; if (!ch || ch.country !== c.id || !ch.alive || ch.id === actor.id) return fail('No such target.');
      if (ch.id === c.leader) return fail('The ruler is not arrested by an order of their own government; that takes a coup.');
      const fate = op.fate === 'dead' ? 'dead' : op.fate === 'exiled' ? 'exiled' : 'imprisoned', inCustody = ch.status === 'imprisoned';
      if (ch.status === fate) return fail(`${ch.name} is already ${fate}.`);
      if (ch.status === 'exiled') return fail(`${ch.name} is abroad, beyond the reach of the police.`);
      { const no = courtBlocks(w, c, `arrest:${ch.id}`, c.courts / 220); if (no === 'now') { c.legitimacy = clamp(c.legitimacy - 2, 0, 100); news(w, `${c.name} court halted the order against ${ch.name}.`, { kind: 'politics', countries: [c.id] }); } if (no) return fail(no === 'again' ? `The court has halted the order against ${ch.name} this quarter; signing it again changes nothing before the next.` : 'The court blocked it.'); }
      // Someone who slipped the police or stood them off this quarter is not taken by the same order written out again.
      const gotAway = quarterBook(w, c).gotAway ||= {}; if (gotAway[ch.id]) return fail(`${gotAway[ch.id]} The police will not get another chance at ${ch.name} before next quarter.`);
      // An order of arrest passes through the police. A chief of police who has lost faith in the ruler lets it be known in time.
      { const chief = Object.values(w.characters).find(x => x.alive && x.country === c.id && x.post === 'police' && x.status === 'free'); // One who has been paid or frightened into it by the person concerned does so for certain.
        if ((chief && chief.id !== ch.id && !inCustody && standing(w, chief, 'warns') && chief.warns.for === ch.id) || (w.friction && chief && chief.id !== ch.id && chief.loyalty < 30 && !inCustody && rand(w) < .4)) { tell(w, ch, 'A friend in the police', `An order for your arrest has been signed by ${actor.name}. You were warned in time; they will come again.`); leaveTrace(w, chief, `Warned ${ch.name} of the order of arrest.`); gotAway[ch.id] = `${ch.name} could not be found when the police came: someone gave warning.`; return fail(gotAway[ch.id]); } }
      const seated = c[ch.role] === ch.id, risk = seated && ch.role === 'general' ? c.blocs.army.power / 100 : .15;
      if (!inCustody && rand(w) < risk * .45) { news(w, `${ch.name} resisted arrest in ${c.name}.`, { kind: 'plot', countries: [c.id] }); ch.loyalty = 0; gotAway[ch.id] = 'The arrest met resistance.'; return fail(gotAway[ch.id]); }
      if (seated && ch.role === 'general') Object.values(w.units).filter(u => u.country === c.id).forEach(u => u.loyalty = clamp(u.loyalty - 8, 0, 100));
      c.pressFreedom = clamp(c.pressFreedom - 3, 0, 100);
      // The arrest of a public figure is noticed wherever there is a press to notice it, and the fortune they kept at home is taken with them.
      // What is done to them counts. Driving a rival out is one thing and holding them another; killing them without a court is seen for what it
      // is even where no paper may print it, and no less when the victim was already in a cell.
      const known = seated || ROLES.includes(ch.role) || ch.role === 'former_leader', weight = fate === 'dead' ? 2.5 : fate === 'exiled' ? .8 : 1;
      if (seated && !inCustody) { c.legitimacy = clamp(c.legitimacy - 6 * c.pressFreedom / 100 * weight - (fate === 'dead' ? 1.5 : 0), 0, 100); c.mods.push({ key: 'unrest', delta: clamp(ch.power / 15, 1, 5) * (.3 + c.pressFreedom / 100), turns: 3, label: `Arrest of ${ch.name}` }); if (ch.role === 'opposition') c.rivalJailed = w.turn; }
      else if (fate === 'dead' && known) c.legitimacy = clamp(c.legitimacy - 6 * c.pressFreedom / 100 * 1.5 - 1.5, 0, 100);
      const seized = inCustody ? 0 : Math.max(0, ch.wealth - (ch.abroad || 0)) * (fate === 'exiled' ? .5 : .8), took = seized > 1 ? ` ${Math.round(seized)} of their fortune was seized for the treasury.` : '';
      ch.wealth -= seized; c.treasury += seized * (c.rate || 1);
      // Who takes the office of a chief of staff who is arrested, banished or shot can be said in the same order.
      if (seated && ch.role === 'general' && (op.successor || op.successor_name)) { const next = personFor(w, c, { character: op.successor, name: op.successor_name }, 'officer'); if (next?.alive && next.country === c.id && next.status === 'free' && next.id !== ch.id && !ROLES.some(r => c[r] === next.id)) (c.deputies ||= {}).general = next.id; }
      const seat = seated && ROLES.includes(ch.role) ? ch.role : null;
      if (fate === 'dead') {
        // A killing by the state is remembered by the dead person's following, and by whoever keeps files.
        news(w, `${c.name}: ${ch.name} was executed.`, { kind: 'politics', countries: [c.id] });
        c.mods.push({ key: 'unrest', delta: clamp(ch.power / 12, 1, 6) * (.5 + c.pressFreedom / 100), turns: 3, label: `Execution of ${ch.name}` });
        // Blood shed by the state is what the armed underground lives on.
        c.blood = (c.blood || 0) + (known ? clamp(ch.power / 20, 1, 4) : .5);
        leaveTrace(w, actor, `Had ${ch.name} put to death.`); die(w, ch, 'was executed', { quiet: true });
        return { ok: true, msg: `${ch.name} was executed.${took}${seat && c[seat] !== ch.id && w.characters[c[seat]] ? ` ${w.characters[c[seat]].name} (${c[seat]}) holds the seat now.` : ''}` };
      }
      neutralize(w, ch, fate);
      tell(w, ch, 'The police', `You were ${fate === 'exiled' ? 'put across the border and forbidden to return' : 'arrested and locked up'} on the order of ${actor.name}.`);
      news(w, `${c.name}: ${ch.name} was ${fate === 'exiled' ? 'driven into exile' : 'arrested and imprisoned'}.`, { kind: 'politics', countries: [c.id] });
      return { ok: true, msg: `${ch.name} is now ${fate}.${took}${seat && c[seat] !== ch.id && w.characters[c[seat]] ? ` ${w.characters[c[seat]].name} (${c[seat]}) holds the seat now${seat === 'general' ? `; the War Ministry has told you how ${he(w.characters[c[seat]])} came by it` : ', put there by their own people and not by you'}.` : ''}` };
    }
    case 'release': { const ch = w.characters[op.character]; if (!ch?.alive || ch.country !== c.id || !['imprisoned', 'exiled'].includes(ch.status)) return fail('No such prisoner or exile.'); const was = ch.status; ch.status = 'free'; tell(w, ch, c.name, was === 'exiled' ? 'You are allowed to return home.' : 'You are released from prison.'); news(w, `${c.name}: ${ch.name} was ${was === 'exiled' ? 'allowed to return from exile' : 'released from prison'}.`, { kind: 'politics', countries: [c.id] }); return { ok: true, msg: `${ch.name} is ${was === 'exiled' ? 'free to come home' : 'out of prison'} and has been told so; the papers have it.` }; }
    case 'designate_successor': { if (op.remove) { c.heir = null; return ok(); } const ch = personFor(w, c, op, 'heir', { power: 40, age: [18, 45], ...(c.succession === 'dynasty' && !op.name ? { family: actor.name.split(' ').at(-1) } : {}) }); if (!ch?.alive || ch.country !== c.id || ch.status !== 'free' || ch.id === c.leader) return fail(noPerson('No such person to name.')); c.heir = ch.id; c._heirSecret = !!op.secret; tell(w, ch, w.characters[c.leader]?.name ?? c.name, 'You are named successor: if the ruler dies or falls, the government passes to you.'); news(w, `${c.name}: ${ch.name} was named successor.`, { kind: 'politics', countries: [c.id], secret: !!op.secret }); return ok(); }
    case 'persecute': return persecute(w, c, actor, op);
    case 'set_regime': { if (op.regime) c.regime = String(op.regime).slice(0, 60); if (op.ideology) c.ideology = String(op.ideology).slice(0, 80); if (SUCCESSION.includes(op.succession) && op.succession !== c.succession) { c.succession = op.succession; c.legitBase = (c.legitBase ?? 0) * .7; } if (typeof op.elections === 'boolean') { c.elections = op.elections; if (op.elections && c.nextElection <= w.turn) c.nextElection = w.turn + 8; if (op.elections && !c.parliament) makeParliament(c, 'Parliament'); } if (op.press_freedom !== undefined) c.pressFreedom = eased(c.pressFreedom, num(op.press_freedom, 0, 100), 'Press freedom', []); if (op.axes) for (const a of ['econ', 'auth', 'nation', 'faith']) if (op.axes[a] !== undefined) c.axes[a] = num(op.axes[a], -100, 100, c.axes[a]); c.legitimacy = clamp(c.legitimacy - 4, 0, 100); news(w, `${c.name} changed its regime: ${c.regime}.`, { kind: 'politics', countries: [c.id] }); return ok(); }
    case 'hold_election': c.elections = true; c.nextElection = w.turn; if (!c.parliament) makeParliament(c, 'Parliament'); return ok();
    // Arranging the count. Nothing shows until the vote is held: then officials and police deliver as much of it as they reach, and a free press or an honest bench may find it out.
    // A party's own people at the polls and at the counts.
    case 'watch_polls': { if (!c.elections) return fail('No election is held here.'); const p = leadsParties(w, c, actor).find(x => !x.banned); if (!p) return fail('Watchers at the polls are a party\'s to send, and you lead none.'); if (p.watchers === c.nextElection) return { ok: true, msg: 'Your watchers are named for this election already.' };
      if ((p.funds || 0) < 2) return fail(`Watchers at every station and every count cost about 2, and the chest of the ${p.name} holds ${Math.round(p.funds || 0)}.`); p.funds -= 2; p.watchers = c.nextElection;
      return { ok: true, msg: `The ${p.name} will have its own people at the polling stations and at every count in the election due in ${quarterLabel(c.nextElection)}. A count arranged under their eyes delivers less of what was ordered and is far likelier to come out.` }; }
    case 'rig_election': { const was = c.rigging || 0; c.rigging = num(op.amount, 0, 25, 10); if (c.rigging > was) c.legitimacy = clamp(c.legitimacy - (c.rigging - was) * .15, 0, 100); if (!(actor.secrets || []).some(s => /returns of the election/.test(s.text) && !s.published && w.turn - s.turn < 16)) leaveTrace(w, actor, 'Ordered the returns of the election to be arranged.');
      return { ok: true, msg: `The count will be arranged by about ${Math.round(c.rigging)} points, as far as officials and police can deliver it (${Math.round(clamp((c.bureaucracy + c.police) / 110, .35, 1) * 100)}% of what is ordered, with the offices as they are). ${c.pressFreedom >= 50 || c.courts >= 50 ? 'With the press and the courts as free as they are here, it may well come out' : 'Few here are in a position to prove it'}. If it comes out, the vote will count for nothing and your name will be on it.` }; }
    case 'start_plot': { const kind = ['coup', 'assassination', 'uprising'].includes(op.kind) ? op.kind : 'coup'; if (w.plots.some(x => x.active && x.leader === actor.id)) return fail('You already have a plot.'); if (actor.id === c.leader && kind !== 'assassination') return fail('A ruler does not plot against their own government.'); const mark = kind === 'assassination' ? (op.character ? w.characters[op.character] : w.characters[c.leader]) : null; if (kind === 'assassination' && (!mark?.alive || mark.id === actor.id)) return fail('There is no such person to strike at.'); const id = nextId(w, 'K-'); w.plots.push({ id, country: c.id, kind, leader: actor.id, members: [], target: mark?.id ?? null, progress: 5, secrecy: num(op.secrecy, 0, 1, .5), exposed: false, active: true, start: w.turn }); leaveTrace(w, actor, mark ? `Secretly began preparing the killing of ${mark.name}.` : `Secretly began preparing a plot (${kind}).`); return { ok: true, msg: `Plot started: ${id}${mark ? `, against ${mark.name}` : ''}. It gains ground each quarter; execute_plot carries it out.`, plot: id }; }
    // A plot begun the same quarter has no number its leader could know: whoever leads one plot and one only means that one, whatever he calls it.
    case 'invite_plot': { const led = w.plots.filter(x => x.active && x.leader === actor.id), pl = led.find(x => x.id === op.plot) ?? (led.length === 1 ? led[0] : null); const ch = w.characters[op.character]; if (!pl) { const mine = w.plots.filter(x => x.active && x.leader === actor.id); return fail(mine.length ? `No such plot of yours: ${op.plot}. Yours: ${mine.map(x => `${x.id} (${x.kind})`).join(', ')}.` : 'You lead no plot to invite anyone into: one has to be begun first (start_plot), and people are then drawn into it by its id.'); }
      if (!ch?.alive || ch.country !== c.id || (ch.id === c.leader && pl.kind !== 'assassination') || ch.id === actor.id) return fail(!ch?.alive ? 'No such person.' : ch.country !== c.id ? 'A plot draws in people of this country only.' : ch.id === actor.id ? 'You lead it already.' : 'The ruler is not invited into a plot against his own government.');
      // Someone who is in is in, and someone who has answered this quarter has answered: asking again brings neither a second man nor a second throw of the dice.
      if (pl.members.includes(ch.id) || pl.leader === ch.id) return fail(`${ch.name} is in the plot already.`);
      if ((pl.asked ||= {})[ch.id] === w.turn) return fail(`${ch.name} has had your offer this quarter; nothing changes by asking again before the next.`); pl.asked[ch.id] = w.turn;
      if (ch.aiControlled) { ch.inbox.push({ turn: w.turn, from: actor.name, text: `Secret offer: I want you to join the ${pl.kind} plot ${pl.id}. You may join, refuse or inform on it.` }); return { ok: true, msg: 'The offer was delivered; the choice is theirs.' }; } const p = ch.patron === actor.id && w.turn - (ch.soundedAt ?? -99) <= 12 ? 1 : clamp(.25 + ch.ambition / 180 - ch.loyalty / 220 + (w.countries[c.id].tension ?? 0) / 300, .03, .9); if (rand(w) < p) { pl.members.push(ch.id); ch.inbox.push({ turn: w.turn, from: actor.name, text: `You were approached about plot ${pl.id} (${pl.kind}) and joined.` }); return ok(); } if (ch.loyalty > 62) { pl.exposed = true; w.characters[c.leader].inbox.push({ turn: w.turn, from: ch.name, text: `${actor.name} invited me to a ${pl.kind} plot. Plot no ${pl.id}.` }); } return fail('The invitation was refused.'); }
    case 'join_plot': { const pl = w.plots.find(x => x.id === op.plot && x.active && x.country === c.id); if (!pl || pl.leader === actor.id || pl.members.includes(actor.id)) return fail('Could not join.'); if (actor.id === c.leader && pl.kind !== 'assassination') return fail('A ruler cannot join a plot against their own government.'); pl.members.push(actor.id); leaveTrace(w, actor, `Joined a plot (${pl.kind}).`); return ok(); }
    case 'betray_plot': { const pl = w.plots.find(x => x.id === op.plot && x.active && x.country === c.id); if (!pl) return fail('No such plot.'); pl.exposed = true; actor.loyalty = clamp(actor.loyalty + 20, 0, 100); w.characters[c.leader].inbox.push({ turn: w.turn, from: actor.name, text: `Plot report ${pl.id}: ${pl.kind}, ringleader ${w.characters[pl.leader].name}.` }); return ok(); }
    case 'execute_plot': { const pl = w.plots.find(x => x.id === op.plot && x.active && [x.leader, ...x.members].includes(actor.id)); if (!pl) return fail('No such plot.'); if (actor.id === w.countries[pl.country]?.leader && pl.kind !== 'assassination') return fail('A ruler cannot carry out a plot against their own government.'); return { ok: true, msg: executePlot(w, pl, { fate: op.fate, by: actor.id, acts: { elections: op.elections, parliament: op.parliament, succession: op.succession, regime: op.regime } }) }; }
    case 'fund_plot': { const pl = w.plots.find(x => x.id === op.plot && x.active && x.country === c.id); if (!pl) return fail('No such plot.'); const m = num(op.amount, 0, actor.wealth); actor.wealth -= m; pl.progress = clamp(pl.progress + m * .5, 0, 100); return ok(); }
    case 'bribe': { const ch = w.characters[op.character]; if (!ch?.alive || ch.id === actor.id) return fail('No such target.'); const m = num(op.amount, 0, actor.wealth); if (m <= 0) return fail('No money to give.');
      const what = op.for ?? op.deed, small = isMinor(ch) && !ch.aiControlled;
      // Money that is to buy a named deed from someone nobody plays is answered at once and by what he is: he takes it and does the thing, or leaves it.
      if (what != null && small) { const r = approach(w, actor, ch, op, 'bribe', { amount: m, allowance }); return r.ok ? r : fail(r.msg); }
      actor.wealth -= m; ch.wealth += m; leaveTrace(w, actor, `Paid ${ch.name} a bribe of ${Math.round(m)}.`); leaveTrace(w, ch, `Took a bribe of ${Math.round(m)} from ${actor.name}.`);
      // Someone who is played is nobody's creature: the money arrives, with what is asked for it, and the rest is theirs to decide.
      if (ch.aiControlled) { tell(w, ch, actor.name, `Sent you ${Math.round(m)} in money.${what != null ? ` What is asked for it: ${String(what).slice(0, 200)}.` : ''}`); return { ok: true, msg: `${Math.round(m * 10) / 10} reached ${ch.name}. What ${ch.name} does for it is ${ch.name}'s own decision; nothing binds them but their word. Both of you now have something to hide.` }; }
      // With no deed named the money buys goodwill, or ill will toward the government, and nothing else.
      const stands = v => v >= 65 ? 'loyal' : v >= 40 ? 'wavering' : 'without faith in the government', was = ch.loyalty, down = op.direction === 'down'; ch.loyalty = clamp(ch.loyalty + (down ? -1 : 1) * m * .25 * ch.greed / 50, 0, 100);
      return { ok: true, msg: `${ch.name} took the ${Math.round(m * 10) / 10}. ${what != null ? `What was asked for it is ${his(ch)} own to do or not, and nothing binds ${him(ch)}: the money` : 'No deed was named, so it bought none: it'} leaves ${him(ch)} ${Math.abs(ch.loyalty - was) < 1 ? `much as ${he(ch)} was` : down ? 'worse disposed' : 'better disposed'} toward the government ${he(ch)} serves (${stands(was) === stands(ch.loyalty) ? `still ${stands(was)}` : `${stands(was)} before, ${stands(ch.loyalty)} now`}), the more so the fonder ${he(ch)} is of money.${small ? ` What a man in his place can be paid to do: ${openTo(w, ch, actor, 'bribe').join(', ') || 'nothing'} (bribe with for).` : ''} Both of you now have something to hide.` }; }
    case 'capital_flight': {
      // A fortune is moved abroad as gold: it leaves the country's reserve, and once out it is beyond the state's reach.
      if (c.capitalClosed) return fail('Capital controls blocked moving the money out.');
      const home = Math.max(0, actor.wealth - (actor.abroad || 0)), m = Math.min(allowance(w, actor, 'flight', home * .5, home * num(op.share, 0, .5, .1)), Math.max(c.reserves, 0)); if (m <= 0) return fail('There is nothing to move, or no gold left in the country to move it in.');
      const haven = aliveCountries(w).filter(o => o.id !== c.id && !o.capitalClosed).sort((a, b) => b.legitimacy - a.legitimacy)[0]; if (!haven) return fail('No country abroad is open to it.');
      c.reserves -= m; haven.reserves += m; actor.abroad = (actor.abroad || 0) + m; (actor.abroadIn ||= {})[haven.id] = (actor.abroadIn[haven.id] || 0) + m;
      leaveTrace(w, actor, 'Secretly moved capital out of the country.'); c.blocs.capital.sat = clamp(c.blocs.capital.sat - 4, 0, 100); news(w, `${c.name}: investors are pulling capital out of the country.`, { kind: 'economy', countries: [c.id], secret: true });
      return { ok: true, msg: `${Math.round(m)} of your fortune now lies in ${haven.name}, out of the state's reach.` };
    }
    // Money put "into industry" goes into works that exist: the investor's own company, the one that earned most last quarter.
    case 'invest': { const mine = Object.values(w.firms || {}).filter(f => f.status === 'open' && f.owner === actor.id).sort((a, b) => (b.lastProfit || 0) - (a.lastProfit || 0))[0]; if (!mine) return fail('You own no company to put the money into: found one (found_company) or buy one.'); return firmOp(w, actor, c, { op: 'invest_company', id: mine.id, amount: op.amount }, fail, ok, tell, leaveTrace, num); }
    // The treasury can be robbed only by a hand that its money passes through: whoever governs (the whole of it, up to a fiftieth of a quarter's
    // output), the chief of the general staff (a tenth of the quarter's vote for the forces), the head or a member of a body the state pays for
    // (a fifth of what it is paid), or a contractor the treasury pays (a fifth of the quarter's payment). A private person with no office and no
    // contract has nothing within reach. And it may be found out: the more surely the stronger the audit office, the freer the courts and the
    // press; then it is in the papers with his name, the ruler (or, if the thief is the ruler, the opposition) has it on file as proof, and a
    // court can be given it. (A magnate with no office used to take a tenth of the state's revenue every quarter and was never caught.)
    case 'embezzle': {
      const bodies = (c.institutions || []).filter(i => i.id && !i.sponsor && (i.budget || 0) > 0 && (i.head === actor.id || (i.members || []).includes(actor.id))), paid = (w.contracts || []).filter(k => k.status === 'active' && k.pay > 0 && k.payer && [k.a, k.b].includes(actor.id) && k.payer !== actor.id && k.purse?.[k.payer] === c.id);
      const reach = governs(w, c, actor) ? ['the treasury', gdp * .02] : c.general === actor.id && actor.status === 'free' ? ['the vote for the forces', c.budget.military * gdp * .1] : bodies.length ? [bodies[0].name, sum(bodies, i => i.budget) * gdp * .2] : paid.length ? ['your contract with the state', sum(paid, k => k.pay) * .2] : null;
      if (!reach || !(reach[1] > 0)) return fail('The money of the treasury does not pass through your hands: you hold no office of state, sit on no body the state pays for and have no contract the treasury pays you under. There is nothing within reach to take. (To profit from the state without an office: a contract paid by the treasury, a seat on a state body, or a man inside who is paid to look away.)');
      const want = Math.min(reach[1], num(op.amount, 0, 1e12, gdp * num(op.pct_gdp, 0, .1, .02))), m = Math.min(Math.max(c.treasury, 0), gdp * allowance(w, actor, 'embezzle', reach[1] / gdp, want / gdp)); if (m <= 0) return fail('There is nothing within reach to take this quarter.');
      const kept = m * .2 / Math.max(c.priceLevel, .01); c.treasury -= m; actor.wealth += kept; leaveTrace(w, actor, `Embezzled ${Math.round(m)} from ${reach[0]}.`); c.corruption = clamp(c.corruption + m / gdp * 80, 0, 100); (c._outlay ||= {}).other = (c._outlay.other || 0) + m;
      const audit = sum((c.institutions || []).filter(i => i.id && (i.powers || []).includes('audit')), i => i.strength || 0), found = rand(w) < clamp(.1 + audit * .35 + c.courts / 400 + c.pressFreedom / 500, .08, .85);
      if (found) { const fact = `Took ${Math.round(m)} of public money through ${reach[0]} in ${w.date ?? 'the first days'}.`, keeper = w.characters[governs(w, c, actor) ? c.opposition : c.leader]; (actor.secrets.at(-1) || {}).published = true;
        if (keeper?.alive && keeper.id !== actor.id) { const d = (keeper.dossiers[actor.id] ||= { turn: w.turn, about: actor.name, facts: [] }); d.turn = w.turn; d.facts = [...(d.facts || []), fact].slice(-6); tell(w, keeper, 'The audit office', `It is established that ${actor.name} took ${Math.round(m)} of public money through ${reach[0]}. The papers are in your file on ${actor.name}.`); }
        if (governs(w, c, actor)) c.legitimacy = clamp(c.legitimacy - 5, 0, 100); else actor.power = clamp((actor.power ?? 30) - 6, 0, 100);
        news(w, `${c.name}: ${Math.round(m)} of public money is missing from ${reach[0] === 'your contract with the state' ? 'a state contract' : reach[0]}, and the trail leads to ${actor.name}.`, { kind: 'politics', countries: [c.id] }); }
      return { ok: true, msg: `${Math.round(m)} left ${reach[0] === 'your contract with the state' ? 'the treasury through your contract' : reach[0]}; about ${Math.round(kept * 10) / 10} of it reached your own purse, the rest went to the hands it passed through.${found ? ' It has been traced to you: it is in the papers, and there is a file.' : ' Nobody has noticed, so far.'}` }; }
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
    case 'vote_bill': { const b = (c.bills || []).find(x => x.id === op.bill && x.status === 'pending'); if (!b) return fail('No pending bill.'); const led = leadsParties(w, c, actor); if (!led.length) return fail('You do not lead a party.'); const vote = ['no', 'abstain', 'free'].includes(op.vote) ? op.vote : 'yes'; for (const p of led) { if (vote === 'free') delete b.votes[p.id]; else b.votes[p.id] = vote; } return { ok: true, msg: `${led.map(p => p.name).join(', ')}: ${vote === 'free' ? 'the members vote as they are inclined' : vote === 'abstain' ? 'will abstain; its seats count for neither side' : `will vote ${vote}`} on ${b.id} (${b.title}).` }; }
    // A bill is its mover's until the house has voted on it: he may take it off the order paper, and so may the head of government a bill his own
    // government moved. (World 15: the President of Hazland, attacked from another side, wanted his declaration of war on Akulia withdrawn; no
    // operation could do it, his own party was told to vote against it, and his coalition partners carried it with the opposition, 78 to 22.)
    case 'withdraw_bill': { const mine = x => x.status === 'pending' && (x.proposer === actor.id || (x.byGov && c.leader === actor.id)), own = (c.bills || []).filter(mine), b = op.bill ? (c.bills || []).find(x => x.id === op.bill && x.status === 'pending') : own.length === 1 ? own[0] : null;
      if (!b) return fail(op.bill ? `No bill ${op.bill} is before the house.` : own.length ? `Which bill? Yours before the house: ${own.map(x => `${x.id} (${x.title})`).join(', ')}.` : 'No bill of yours is before the house.');
      if (!mine(b)) return fail(`${b.id} is not yours to withdraw: a bill is taken off the order paper by whoever moved it, or by the head of government if his government moved it. A party can be told to vote against it (vote_bill).`);
      b.status = 'withdrawn'; b.closedAt = w.turn; news(w, `${c.name}: ${actor.name} has withdrawn the bill "${b.title}" (${b.id}) before the vote.`, { kind: 'politics', countries: [c.id] });
      return { ok: true, msg: `${b.id} (${b.title}) is withdrawn: it will not be voted, and nothing in it is done.` }; }
    case 'lobby_bill': { const b = (c.bills || []).find(x => x.id === op.bill && x.status === 'pending'); const p = c.parties.find(x => x.id === op.party); if (!b || !p) return fail('No such bill or party.'); const m = num(op.amount, 0, actor.wealth); if (m <= 0) return fail('No money.'); actor.wealth -= m; b.lobby[p.id] = (b.lobby[p.id] || 0) + (op.side === 'no' ? -m : m); leaveTrace(w, actor, `Spent ${Math.round(m)} on ${p.name} for the ${b.title} vote.`); return ok(); }
    // The state of relations with another government: the envoy at his post, recalled, or relations broken off.
    case 'set_relations': if (!target) return fail('No such country.'); return setRelations(w, c, target, op);
    // Saying that a state born of a rising is a state.
    case 'recognise': {
      if (!target) return fail('No such country.'); if (!target.recognition) return fail(`${target.name} is a state like any other: there is nothing to recognise.`);
      const mother = w.countries[target.bornOf];
      if (mother?.id === c.id) return fail(`${target.name} is in arms against this state. It is recognised by making peace with it.`);
      if (op.withdraw) { if (!target.recognition.includes(c.id)) return fail('You have not recognised them.'); target.recognition = target.recognition.filter(x => x !== c.id); for (const t of w.treaties) if (t.active && !t.multi && t.kind !== 'peace' && t.parties.includes(c.id) && t.parties.includes(target.id)) t.active = false; target.relations[c.id] = clampRel((target.relations[c.id] ?? 0) - 30); news(w, `${c.name} no longer recognises ${target.name} as a state.`, { kind: 'diplomacy', countries: [c.id, target.id] }); return { ok: true, msg: `Recognition is withdrawn: treaties with ${target.name} lapse and our merchants no longer trade there.` }; }
      if (target.recognition.includes(c.id)) return fail(`${target.name} is recognised by this state already.`);
      target.recognition.push(c.id); target.relations[c.id] = clampRel((target.relations[c.id] ?? 0) + 20); c.relations[target.id] = clampRel((c.relations[target.id] ?? 0) + 10);
      // The mother country takes it as a hand in its own house.
      if (mother?.alive) { mother.relations[c.id] = clampRel((mother.relations[c.id] ?? 0) - 30); const g = (mother.grudges ||= {})[c.id] ||= { incident: 0, kin: 0 }; g.incident += 12; tell(w, w.characters[mother.leader], 'Foreign Ministry', `${c.name} has recognised ${target.name}, which is in arms against us, as a state.`); }
      news(w, `${c.name} has recognised ${target.name} as a state.`, { kind: 'diplomacy', countries: [c.id, target.id, ...(mother?.alive ? [mother.id] : [])] }); tell(w, w.characters[target.leader], c.name, `${c.name} recognises us as a state: it will sign treaties with us and its merchants may trade here.`);
      return { ok: true, msg: `${target.name} is a state to us now: treaties can be signed with it and trade with it is open. It stands the firmer at home for every government that recognises it${mother?.alive ? `; ${mother.name} takes it as an act against itself, and its people will hold it against us` : ''}.` };
    }
    // A table to which several governments are called on a stated question. It sits until the end of next quarter.
    case 'call_conference': {
      const question = String(op.question || '').trim().slice(0, 240), invited = [...new Set((Array.isArray(op.invite) ? op.invite : []).map(String))].filter(id => id !== c.id && alive(w, id)).slice(0, 12);
      if (!question) return fail('A conference is called on a question: say what it is to settle.'); if (invited.length < 2) return fail('A conference is a table of several: invite at least two other states.');
      if ((w.conferences ||= []).some(x => x.open && x.host === c.id)) return fail('A conference of yours is still sitting.');
      const away = invited.filter(id => !dealsWith(w, c.id, id)); if (away.length) return fail(`${away.map(id => cname(w, id)).join(', ')} and this state do not recognise each other as states.`);
      const note = pay(c, gdp * .001); if (note === null) return fail(NO_FUNDS);
      const cf = { id: nextId(w, 'CF'), host: c.id, question, invited, came: [], declined: [], turn: w.turn, open: true, treaties: [] }; w.conferences.push(cf);
      news(w, `${c.name} has called ${invited.map(id => cname(w, id)).join(', ')} to a conference on: ${question}`, { kind: 'diplomacy', countries: [c.id, ...invited] });
      for (const id of invited) tell(w, w.characters[w.countries[id].leader], c.name, `${c.name} calls a conference (${cf.id}) on: ${question} Invited: ${invited.map(x => cname(w, x)).join(', ')}. Come or decline (attend_conference); the world will be told who came and who stayed away. A message addressed to ${cf.id} is read by the whole table. What is agreed there is laid before it as a treaty among those present, and can be signed even between states that have broken off relations.`);
      return { ok: true, msg: `Conference ${cf.id} is called and public; it sits until the end of next quarter. A message addressed to ${cf.id} reaches everyone invited who has not declined. A treaty laid before it (propose_treaty with conference and parties) is among those who came, and the conference carries it even between states that have broken off relations. If a treaty comes out of it, it is to your credit; if nobody comes, that is seen too.${note}` };
    }
    case 'attend_conference': {
      const cf = (w.conferences || []).find(x => x.open && (x.id === op.id || (!op.id && x.invited.includes(c.id)))); if (!cf || !cf.invited.includes(c.id)) return fail('No conference to which this state is invited is sitting.');
      const host = w.countries[cf.host], coming = op.attend !== false;
      cf.came = cf.came.filter(x => x !== c.id); cf.declined = cf.declined.filter(x => x !== c.id); (coming ? cf.came : cf.declined).push(c.id);
      tell(w, w.characters[host?.leader], c.name, `${c.name} ${coming ? 'will sit at' : 'declines'} the conference ${cf.id}.`);
      return { ok: true, msg: coming ? `This state sits at conference ${cf.id}, called by ${host?.name}. A message addressed to ${cf.id} is read by the whole table; treaties laid before it can be signed there.` : `Declined. When the conference rises the world is told who stayed away.` };
    }
    // A third state offers terms to states at war with each other. If all of them sign, it stands, and it is known whose work it was.
    case 'mediate': {
      const sides = [...new Set((Array.isArray(op.between) ? op.between : []).map(String))].filter(id => id !== c.id && alive(w, id));
      if (sides.length < 2) return fail('Name the states to be brought to terms (between: two or more), not your own.');
      if (sides.some(id => atWar(w, c.id, id))) return fail('A state at war with one of them cannot stand between them.');
      const deaf = sides.filter(id => tieOf(w, c.id, id) === 'broken'); if (deaf.length) return fail(`This state has no relations with ${deaf.map(id => cname(w, id)).join(', ')}: a mediator must be able to speak to every side.`);
      if (allowance(w, c, `mediate:${[...sides].sort().join('|')}`, 1, 1) <= 0) return fail('Terms from you are before them already this quarter.');
      return proposeMany(w, c, { ...op, kind: op.kind === 'armistice' ? 'armistice' : 'peace', secret: false, conference: op.conference }, sides, true);
    }
    // Bringing another state into a treaty among several that one is party to.
    case 'invite_treaty': {
      const t = w.treaties.find(x => x.id === op.id && x.multi && (x.active ? x.parties.includes(c.id) : x.pending && x.signed.includes(c.id))); if (!t) return fail('No such treaty among several to which this state is a party.'); if (!target) return fail('No such country.');
      if (t.invited.includes(target.id)) return fail(`${target.name} is named in ${t.id} already.`);
      if (t.kind === 'guarantee' && t.of === target.id) return fail('The state whose independence is guaranteed is not a signatory.');
      t.invited.push(target.id); if (t.active) (t.open ||= []).push(target.id); else t.parties.push(target.id);
      tell(w, w.characters[target.leader], c.name, `${c.name} invites us to accede to ${t.id}, ${kindWord(t)} among ${(t.active ? t.parties : t.signed).map(id => cname(w, id)).join(', ')}${t.terms ? `: ${t.terms}` : ''}.${t.secret ? ' It is secret.' : ''} Issue an accept_treaty decision to sign.`);
      return { ok: true, msg: `${target.name} is invited to accede to ${t.id}.` };
    }
    // Making a secret treaty public: by a government that signed it, by one whose service found it out, or by a person who has seen the paper.
    case 'publish_treaty': {
      const t = w.treaties.find(x => x.id === op.id && x.secret && (x.active || x.pending)); if (!t || !seesTreaty(w, actor, t)) return fail('You hold no secret treaty by that number.');
      const state = governs(w, c, actor); reveal(w, t, state ? c : null, state ? null : actor); if (!state) leaveTrace(w, actor, `Gave the secret treaty ${t.id} to the press.`);
      return { ok: true, msg: `${t.id} is public. Governments that were left out of it read it as aimed at them${state && t.parties.includes(c.id) ? '; and this state is now known to have published a paper it had promised to keep' : ''}.` };
    }
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
  const troops = Object.values(w.units).filter(u => u.country === c.id && u.province === p.id && !u.barracks), men = sum(troops, u => u.men), pop = provincePop(p), force = men + pop * c.police / 100 * .01;
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
  // The dead have brothers. Blood shed by the state is what the armed underground lives on, whether or not the papers print it.
  c.blood = (c.blood || 0) + clamp(dead, 1, 30);
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

// Whoever orders a work may name a sum or leave the size to the engineers. A sum named is never exceeded: it buys what it buys in that place,
// and where the work comes only whole (a railway, a harbour, a dam, a fortress) too small a sum is refused, with the price.
const r1 = v => Math.round(v * 10) / 10;
function build(w, c, op, actor) {
  const p = w.provinces[op.province]; if (!p || p.controller !== c.id) return fail('That province is not under your control.');
  const kind = op.kind; if (!has(PLANTS, kind) && !WORKS.includes(kind)) return fail('Unknown building type.');
  // The chief of staff may have his own troops dig in where they stand; everything else that is built is the government's to order.
  if (actor && !governs(w, c, actor) && !delegated(c, actor, 'build')) {
    if (kind !== 'trench') return fail('Public works are for the government to order; the chief of staff may only have troops dig field works where they stand.');
    if (!Object.values(w.units).some(u => u.country === c.id && (u.province === p.id || (u.target === p.id && u.marchSince === w.turn)))) return fail(`No troops stand at ${p.name} to dig, and none have been ordered there this quarter.`);
  }
  const q = quote(w, c, p, kind, op.resource); if (q.no) return fail(q.no);
  if (!(q.room > .005)) return fail(q.piece ? `${p.name} already has ${kind === 'dam' ? 'a dam' : `as much ${{ railway: 'railway', port: 'harbour', fort: 'fortress', battery: 'coastal battery', trench: 'field works' }[kind]} as it can hold`}.` : `The ${q.what} at ${p.name} cannot be carried further.`);
  const waste = wasteOf(w, c, p), level = Math.max(c.priceLevel, .01), each = q.price * level * waste;
  // A sum of nothing is no sum: the order then leaves the size of the work to the engineers.
  const named = op.amount != null ? num(op.amount, 0, 1e9, 0) : op.pct_gdp != null ? Math.max(c.gdp, 1) * num(op.pct_gdp, 0, .5, 0) : 0, purse = named > 0 ? named : null;
  let add = 1, cost = each, sized = 0;
  if (q.piece) { if (purse != null && purse < cost * .97) return fail(`A ${q.what} at ${p.name} costs about ${Math.round(cost)}${kind === 'railway' && ground(p) > 1.3 ? `, the ground being ${p.terrain}` : ''}; the ${Math.round(purse)} allotted would not build it.`); }
  else {
    add = Math.min(purse != null ? purse / each : q.usual, q.room);
    // An order that names no sum does not pledge the state's credit: the engineers keep to what the treasury has in hand above its working
    // balance, and say what the usual measure would have cost. Whoever means more names the sum, and what the treasury lacks of a named sum is
    // borrowed as before. (World 16: "road works and small irrigation works, paid from the 40 already borrowed" came as four works with no
    // sum; the engineers began 2755 of works with 127 in the treasury, and the state's debt rose by a quarter of a year's revenue.)
    if (purse == null && actor) { const inHand = Math.max(c.treasury - (c.till || 0), 0) / each; if (inHand < add) { sized = add; add = Math.max(inHand, 0); } }
    cost = add * each;
    if (sized && add < sized * .1) return fail(`No sum was named, and the treasury has ${Math.round(Math.max(c.treasury - (c.till || 0), 0))} in hand above its working balance: the usual measure of ${q.what} at ${p.name} costs about ${Math.round(sized * each)}. Name the sum to be spent and the work is cut to it; what the treasury lacks of a named sum is borrowed.`);
    if (!(add > .002)) return fail(`That sum would build nothing to speak of: a full step of ${q.what} at ${p.name} costs about ${Math.round(each)}.`);
  }
  const machines = (q.machines || 0) * add, steel = (q.steel || 0) * add;
  if (c.stock.machines < machines) return fail(`Not enough machinery: this needs about ${r1(machines)} and ${r1(c.stock.machines)} is in store; import or produce it.`);
  if (c.stock.steel < steel) return fail(`Not enough steel: this needs about ${r1(steel)} and ${r1(c.stock.steel)} is in store.`);
  const note = pay(c, cost, 'building'); if (note === null) return fail(NO_FUNDS);
  c.stock.machines -= machines; c.stock.steel -= steel;
  const x = queueProject(w, c, { kind, province: p.id, resource: op.resource, add, cost: cost / level }), gain = projectYield(x);
  const spare = purse != null && cost < purse * .97 ? ` of the ${Math.round(purse)} allotted${q.piece ? '' : ', all the place can take'}` : '';
  return { ok: true, msg: `Started: ${q.what} at ${p.name} for ${Math.round(cost)}${spare}${!q.piece && gain ? `, which ${gain}` : ''}; ready in ${durationOf(kind)} quarters.${sized ? ` No sum was named, so the engineers kept to what the treasury had in hand; the usual measure there would have cost about ${Math.round(sized * each)}. Name a sum to build more.` : ''}${waste > 1.08 ? ` It costs about ${Math.round((waste - 1) * 100)}% more than the work is worth: graft, and the distance of ${p.name} from the capital's eye.` : ''}${note}` };
}
const ok = () => ({ ok: true, msg: 'Applied.' });
const HOME_TOO = new Set(['buy_bonds', 'sell_bonds', 'fund_party', 'fund_paper', 'recruit_informant', 'found_company']);
// What somebody who may not give an order can do instead, said with the refusal.
const OPEN_WAY = {
  build: 'A private person builds with his own money: a new works is founded as a company (found_company, naming what it is to make or dig, the province and the capital put in), and a works he owns is enlarged (invest_company)',
  concession: 'Somebody who does not govern gives from his own purse, his company\'s till or his party\'s funds (relief), not from the treasury',
  repress: 'Troops keep order where their standing orders put them; to turn the police or the army on a town is for whoever governs',
  relieve_province: 'Taxes are remitted and the state\'s stores opened by whoever governs. Anybody can give money of his own, his company\'s or his party\'s to the people of a province or the men of a works (relief)',
  note: 'Notes between governments are sent by whoever governs',
  tender: 'The state\'s buying is put to tender by whoever governs, or by the chief of staff for the army\'s stores. A house that wants the business answers a tender with its price (bid), or offers a contract of its own (propose_contract)',
  award_tender: 'A tender is the government\'s to award',
  inspect: 'The inspectors of works answer to whoever governs. An owner knows his own works, and anybody can have a works or another matter looked into (inquire)',
};
const fail = msg => ({ ok: false, msg });
function applyOrder(w, c, u, to, named = true) {
  // An order to be where the unit already stands is an order carried out, not one refused: it stays (a march elsewhere is given up), and what
  // was ordered to follow its arrival follows. ("Hold B22 at Steinburga on the defensive" comes as move, then set_posture if the move was done.)
  if (u.province === to) { const was = u.target && u.target !== to ? ` Its march to ${w.provinces[u.target]?.name ?? u.target} is given up.` : ''; u.target = null; delete u.digAt; return { ok: true, msg: `${u.id} stands at ${w.provinces[to].name} already, and stays.${was}` }; }
  if (!pathStep(w, u.province, to, c.id)) return fail('No route.');
  if (u.posture === 'defensive' && !named) return fail(`${u.id} stands on the defensive and stays.`);
  // A commander who has lost faith in the government obeys when it suits him.
  // So does one who has been paid or frightened into keeping his men where they stand.
  const chief = w.characters[u.commander]; if ((standing(w, chief, 'aside') && isMinor(chief)) || (w.friction && chief?.alive && isMinor(chief) && chief.loyalty < 25 && rand(w) < .4)) return fail(`${u.id} did not march: ${chief.name}, who commands it, finds reasons for delay.`);
  // A march order and an order to hold the ground cannot both stand. The one given to the unit by name, and last, is the one that does.
  let lifted = ''; if (u.posture === 'defensive') { delete u.posture; lifted = ` ${u.id} had been standing on the defensive: this order lifts that one, and it leaves its works.`; }
  const off = u.attack ? ` It leaves the offensive against ${w.provinces[u.attack.to]?.name ?? 'its objective'} it had been ordered into.` : ''; delete u.attack;
  u.target = to; u.marchSince = w.turn; delete u.digAt; delete u.joinTo; const q = marchQuarters(w, u, to), still = postureWords(u);
  const road = roadTo(w, u.province, to, c.id) || [], foes = road.filter(id => { const o = w.provinces[id].controller; return o !== c.id && atWar(w, c.id, o); }), through = foes.filter(id => id !== to).map(id => w.provinces[id].name);
  const fight = foes.includes(to) ? ` ${w.provinces[to].name} is held by the enemy: the unit attacks it as it arrives, by itself${through.length ? `, after fighting its way through ${through.join(', ')}` : ''}. (An offensive order would have it form up, wait for the others and go in to a plan.)` : through.length ? ` No road leads there over ground we hold or may cross: the way runs through ${through.join(', ')}, which the enemy holds, and the unit will have to fight its way through.` : '';
  return { ok: true, ...(foes.includes(to) ? { takes: to } : {}), msg: `${u.id} marches for ${w.provinces[to].name}${q ? `: about ${q} quarter${q > 1 ? 's' : ''} as the ground, the roads and the seasons stand (the army report shows how far it got each quarter and what held it)` : ''}.${fight}${lifted}${off}${still ? ` Its standing orders go with it: ${still}.` : ''}` };
}
// A standing order to troops: one unit, everything in a province, everything facing a neighbour, or the whole army. It holds until it is changed.
const POSTURE_SAYS = {
  ordinary: 'They fight what they meet and march where they are sent; every earlier standing order to them is lifted.',
  hold_fire: 'They do not fire first on any frontier where there is no fighting: clashes of patrols begun from their side become rare, not impossible, and they defend themselves if fired on. It holds across an armistice line too. Against an enemy they are at war with it changes nothing.',
  defensive: 'They hold the province they stand in, dig in deeper each quarter and fight from their works whoever attacks them; they take no ground. A general order to the army (move_army) will not move them; an order to the unit by name (move) will, and lifts this one.',
  fall_back: 'They give battle to an enemy they can meet. Before clearly stronger numbers they go back one province toward their own country without fighting, leaving about one man in twenty and some of their gear on the road, and the province is left to the enemy.',
  no_retreat: 'Beaten, they do not leave the field: they hold the ground for another quarter, at a price in men about two fifths higher than troops who break off, and their spirit and their faith in the government suffer when they are bled. They give way only when their spirit breaks.',
  barracks: 'They are not used against the country\'s own people: they do not hold the streets of their province, are not sent against strikers and take no part in measures against a population. They still fight an enemy.'
};
// An offensive: troops sent against one province the enemy holds, under one order and to one plan. They form up in the provinces beside it and
// go in together; the order says how (a reconnaissance in force, an assault, an attack pressed whatever it costs), whether the guns prepare it,
// and how long the staff has to get ready. What comes of it is the engine's to say (military.js: launch, resolve).
const freshlyCalled = w => u => u.called === true && u.calledAt === w.turn;
function offensive(w, c, op) {
  const to = w.provinces[op.to]; if (!to) return fail('Name the province to be attacked (to).');
  const mine = Object.values(w.units).filter(u => u.country === c.id), on = mine.filter(u => u.attack?.to === to.id);
  if (op.cancel === true) { if (!on.length) return fail(`No offensive against ${to.name} is in hand.`); for (const u of on) { delete u.attack; if (u.province !== to.id) u.target = null; } return { ok: true, msg: `The offensive against ${to.name} is called off: ${on.map(u => u.id).join(', ')} stand where they are.` }; }
  if (to.controller === c.id) return fail(`${to.name} is in our own hands: troops are sent there with move.`);
  const foe = w.countries[to.controller];
  if (!atWar(w, c.id, to.controller)) return fail(`${to.name} is held by ${foe?.name ?? 'another state'}, with whom there is no war. An attack on it would be one, and war is declared by whoever governs (declare_war).`);
  if (hasTreaty(w, c.id, to.controller, 'armistice')) return fail('An armistice with them is in force: no attack while it lasts. It would have to be broken first (break_treaty).');
  const ids = Array.isArray(op.units) ? op.units.map(String) : [], from = Array.isArray(op.from) ? op.from.map(String) : [], named = ids.length > 0;
  const unknown = ids.filter(id => !mine.some(u => u.id === id)); if (unknown.length) return fail(`No such unit of yours: ${unknown.join(', ')}.`);
  // With no units named, the troops meant are those that start from the provinces named, or else every unit already standing beside the objective that is free to move.
  const meant = named ? mine.filter(u => ids.includes(u.id)) : from.length ? mine.filter(u => from.includes(u.province)) : mine.filter(u => to.neighbors.includes(u.province) && u.posture !== 'defensive');
  // Reservists called to the colours this quarter are still coming in: they march and they hold ground, and they attack from next quarter.
  // So a state that means to strike with its reserve has called it up, in everybody's sight, a quarter before the blow. (The owner, after a
  // world in which a war was declared, the reserve called and the province entered in one quarter: "the other side must have its warning".)
  const raw = meant.filter(freshlyCalled(w)), us = meant.filter(u => !raw.includes(u)), rawNote = raw.length ? ` ${raw.map(u => u.id).join(', ')} ${raw.length > 1 ? 'were' : 'was'} called up this quarter and ${raw.length > 1 ? 'do' : 'does'} not go in: men who came to the colours this quarter attack from the next.` : '';
  if (meant.length && !us.length) return fail(`${raw.map(u => u.id).join(', ')} ${raw.length > 1 ? 'were' : 'was'} called up this quarter: the men are still coming in, drawing their rifles and forming. They can march and hold ground at once (move, set_posture); they go into an attack from next quarter.`);
  if (!us.length) return fail(`No troops for it: name the units, or the provinces they start from (from). ${mine.some(u => to.neighbors.includes(u.province)) ? 'The units beside it stand on the defensive by standing order; an order to them by name lifts that.' : `No unit of ours stands beside ${to.name} now.`}`);
  const manner = MANNERS.includes(op.manner) ? op.manner : 'assault', shelling = op.shelling === true || op.bombard === true, prepare = Math.round(num(op.prepare, 0, 4, 0)), wait = op.wait !== false, went = [], not = [], left = [], again = [], ceiling = op.shells != null ? num(op.shells, 0, 1e6, 0) : null;
  // Where a unit will form up: the last province on its road before the objective.
  const staging = u => { let cur = u.province, n = 0; while (!to.neighbors.includes(cur) && n++ < 80) { const step = pathStep(w, cur, to.id, c.id); if (!step || step === to.id) return step ? cur : null; cur = step; } return to.neighbors.includes(cur) ? cur : null; };
  for (const u of us) {
    const at = u.province === to.id ? to.id : staging(u); if (!at) { not.push(`${u.id} has no road to it`); continue; }
    const chief = w.characters[u.commander]; if ((standing(w, chief, 'aside') && isMinor(chief)) || (w.friction && chief?.alive && isMinor(chief) && chief.loyalty < 25 && rand(w) < .4)) { not.push(`${u.id} did not stir: ${chief.name}, who commands it, finds reasons for delay`); continue; }
    if (u.posture === 'defensive') delete u.posture;
    if (u.attack && u.attack.to !== to.id && w.provinces[u.attack.to]) left.push(`${u.id} (${w.provinces[u.attack.to].name})`);
    // An attack already in hand keeps its day: ordering it again changes how it is to be made, not when, and what its preparation has bought stays bought.
    const was = u.attack?.to === to.id ? u.attack : null; if (was) again.push(u.id);
    u.attack = { to: to.id, manner, shelling, wait, since: was?.since ?? w.turn, start: was ? Math.min(was.start ?? w.turn, w.turn + prepare) : w.turn + prepare, ...(was?.ready != null ? { ready: was.ready } : {}), ...(was?.seen != null ? { seen: was.seen } : {}), ...(was?.late != null ? { late: was.late } : {}), ...(ceiling > 0 ? { shells: ceiling } : ceiling === null && was?.shells ? { shells: was.shells } : {}) }; if (u.province !== to.id) u.target = to.id;
    went.push({ u, at, q: at === u.province ? 0 : marchQuarters(w, u, at) ?? 1 });
  }
  if (!went.length) return fail(`The offensive against ${to.name} could not be mounted: ${not.join('; ')}.`);
  const cols = Object.values(went.reduce((a, x) => ((a[x.at] ||= []).push(x), a), {})).sort((a, b) => sum(b, x => x.u.men) - sum(a, x => x.u.men)), slow = Math.max(...went.map(x => x.q)), menAll = sum(went, x => x.u.men);
  const colText = cols.map(col => { const lead = commanderOf(w, [...col].sort((a, b) => b.u.men - a.u.men)[0].u), late = Math.max(...col.map(x => x.q)), s = supplyOf(w, { ...col[0].u, province: col[0].at });
    return `from ${w.provinces[col[0].at].name}${w.provinces[col[0].at].controller !== c.id && atWar(w, c.id, w.provinces[col[0].at].controller) ? ', which the enemy holds and the column must take first' : ''} (${col.map(x => x.u.id).join(', ')}: ${menText(sum(col, x => x.u.men))}${late ? `, about ${late} quarter${late > 1 ? 's' : ''} of marching away` : ', formed up'}${cols.length > 1 && lead ? `; led by ${lead.name}, ${abilityWord(lead)}` : ''}${s.linked && s.depth > 1 ? `; ${Math.round(s.depth * 10) / 10} marches of wagon road from its supply head` : !s.linked ? '; cut off from supply' : ''})`; }).join('; ');
  const set = Math.max(...went.map(x => x.u.attack.start)) - w.turn, need = shellsFor(went.map(x => x.u), manner, shelling), have = Math.max(c.stock.arms || 0, 0), when = slow + Math.max(set, 0);
  const how = { probe: 'It is a reconnaissance in force: the troops feel out what stands there, break off before it costs much, come back to where they started and report what they met. It takes the place only if it finds it all but empty.', assault: 'It is an assault: beaten, the troops fall back; if they carry it the province is taken, or its fortress invested.', all_out: 'It is to be pressed regardless of loss: the attack hits harder and costs both sides more, the attacker most, and troops that are beaten stay on the field and go in again next quarter until the place falls, the order is changed or their spirit breaks.' }[manner];
  const guns = shelling ? 'The guns prepare it: a bombardment knocks in field works in the measure of the guns brought against the men behind them (the heavy pieces of artillery units count for much, the field guns that march with the infantry for little), and only heavy pieces tell against a fortress.' : 'No bombardment is ordered before it.';
  const timing = when === 0 ? `The troops are formed up and go in ${op._late ? 'next' : 'this'} quarter.` : `They go in together ${set > 0 ? `no sooner than ${set} quarter${set > 1 ? 's' : ''} from now, which is time to bring up shells and study the ground${slow > set ? ', and not before the last column is up' : ''}` : 'when the last column is up'}${wait ? '; the staff waits up to three quarters for a column that is not up, and then goes with what it has' : '; no column waits for another'}.`;
  const other = to.neighbors.map(n => w.provinces[n]).filter(q => q.controller === c.id && !cols.some(col => col[0].at === q.id));
  const flank = cols.length > 1 ? ' Columns that come from different provinces and arrive together take the defender in flank and have more room to deploy; every column but the strongest keeps the timetable only as well as its commander can, and one that is late goes in a quarter after the rest, alone.' : went.length > 1 && other.length ? ` All of them come up by the same road and strike from one side. To take the defender from two sides a unit would first have to be marched (move) to another province of ours that touches ${to.name} (${other.map(q => `${q.name} ${q.id}`).join(', ')}) and the offensive ordered with it standing there.` : '';
  return { ok: true, takes: to.id, msg: `Offensive against ${to.name} (${to.terrain}${to.fort >= 1 ? ', a fortress' : ''}), held by ${foe.name}: ${went.length} unit${went.length > 1 ? 's' : ''}, ${menText(menAll)}, in ${cols.length} column${cols.length > 1 ? 's' : ''}: ${colText}. ${how} ${guns} ${timing}${flank}${rawNote} The attack will ask about ${Math.round(need * 10) / 10} of arms and ammunition a quarter of the arsenal, which holds ${Math.round(have)}${(c.arsenalReserve || 0) > 0 ? `, of which ${Math.round(Math.min(c.arsenalReserve, have))} is kept back from any attack` : ''}${need > have - Math.min(c.arsenalReserve || 0, have) ? ': not enough, and where the arsenal cannot send what the fight calls for the fire slackens' : ''}.${went[0].u.attack.shells ? ` It is held to ${Math.round(went[0].u.attack.shells * 10) / 10} a quarter${went[0].u.attack.shells < need ? ', less than it will ask for: its fire will be the thinner' : ''}.` : ''}${closedNow(w, to) ? ` ${to.name} is closed by ${season(w) === 'winter' ? 'snow' : 'mud'} this season: the attack waits for the roads.` : ''}${not.length ? ` Not part of it: ${not.join('; ')}.` : ''}${again.length ? ` This attack was already in hand for ${again.join(', ')}: ordering it again changes how it is to be made, not the day it was set for.` : ''}${left.length ? ` A unit is part of one attack at a time: ${left.join(', ')} had been ordered against another objective, and that order is replaced by this one. To take one place and then the next, the second attack is ordered to follow the first (it then waits until the first place is in our hands), not beside it.` : ''} What is known of the troops in ${to.name} is in the borders report; the staff reports after the fight what decided it.` };
}
const seaLabel = (w, id) => `${w.seas[id]?.name || 'the open sea'} (${id})`;
const count = (n, k) => { const r = Math.round(n); return `${r} ${r === 1 ? SHIPS[k].one : SHIPS[k].name}`; };
function setPosture(w, c, op) {
  const kind = POSTURES.includes(op.posture) ? op.posture : null; if (!kind) return fail(`The standing orders are: ${POSTURES.join(', ')}.`);
  const mine = Object.values(w.units).filter(u => u.country === c.id), on = op.on !== false || kind === 'ordinary'; let us, where, toward = null;
  if (op.unit) { us = mine.filter(u => u.id === op.unit); where = op.unit; if (!us.length) return fail('No such unit of yours.'); }
  // A standing order for a place is for the troops that stand there and for those sent there this quarter ("detach four thousand to Kasona, to
  // hold fire there"): the order goes with them.
  else if (op.province) { if (!w.provinces[op.province]) return fail('No such province.'); us = mine.filter(u => u.province === op.province || (u.target === op.province && u.marchSince === w.turn)); where = `every unit at ${w.provinces[op.province].name}${us.some(u => u.province !== op.province) ? ' or ordered there this quarter' : ''}`; }
  else if (op.facing) { toward = w.countries[op.facing]; if (!toward?.alive || toward.id === c.id) return fail('No such neighbour.'); us = mine.filter(u => w.provinces[u.province]?.neighbors.some(n => w.provinces[n].controller === toward.id)); where = `every unit facing ${toward.name}`; }
  else if (op.all) { us = mine; where = 'the whole army'; }
  else return fail('Say which troops: unit, province, facing (a neighbouring country) or all.');
  // An order to hold fire toward a neighbour is a standing order for that frontier: troops that arrive there later come under it too.
  const frontier = toward && ['hold_fire', 'ordinary'].includes(kind);
  if (!us.length && !frontier) return fail(`No troops of yours stand there (${where}).`);
  if (frontier) { c.holdFire ||= {}; if (kind === 'hold_fire' && on) c.holdFire[toward.id] = true; else delete c.holdFire[toward.id]; }
  const halted = [], later = [];
  for (const u of us) {
    if (kind === 'ordinary') { delete u.posture; delete u.holdFire; delete u.barracks; delete u.digAt; }
    else if (kind === 'hold_fire') { if (on) u.holdFire = true; else delete u.holdFire; }
    else if (kind === 'barracks') { if (on) u.barracks = true; else delete u.barracks; }
    // A unit told to stand on the defensive while it is under an order of this same quarter to march somewhere is to stand on the defensive there:
    // it goes, and digs in where it arrives (u.digAt). Only a march ordered in an earlier quarter is cancelled by the order to hold. (World 15: "B465
    // to Waldlanda, to stand with B45 on the defensive" came as move, then set_posture, and the corps dug in where it stood and never marched.)
    else if (on && kind === 'defensive' && u.target && u.marchSince === w.turn && !u.attack) { u.digAt = u.target; later.push(`${u.id} (at ${w.provinces[u.target]?.name ?? u.target})`); }
    else if (on) { u.posture = kind; delete u.digAt; if (kind === 'defensive' && u.target) { halted.push(u.id); u.target = null; delete u.attack; } }
    else if (u.posture === kind) delete u.posture;
  }
  const names = us.length ? `${us.slice(0, 12).map(u => u.id).join(', ')}${us.length > 12 ? ` and ${us.length - 12} more` : ''}` : 'no unit stands there now';
  const what = on ? POSTURE_SAYS[kind] : `That standing order (${kind.replace('_', ' ')}) is lifted from them; their other standing orders, if any, stand.`;
  return { ok: true, msg: `Standing order to ${where} (${names}): ${on ? kind.replace('_', ' ') : `${kind.replace('_', ' ')} lifted`}. ${what}${frontier && kind === 'hold_fire' && on ? ` It is the standing order for the whole frontier with ${toward.name}: troops sent there later come under it.` : ''}${later.length ? ` ${later.join(', ')} ${later.length > 1 ? 'are' : 'is'} on the march by an order of this quarter: the standing order takes effect where the march ends, and they dig in there.` : ''}${halted.length ? ` ${halted.join(', ')} had orders to march from an earlier quarter; those are cancelled, since troops on the defensive stay where they are. (To have them dig in somewhere else, order the march and the standing order in the same quarter.)` : ''}${us.length && kind !== 'ordinary' ? ' A unit raised or detached later has the ordinary orders until it is told otherwise.' : ''}` };
}
