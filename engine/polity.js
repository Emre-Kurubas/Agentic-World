// Institutions, parliament and treaty clauses. The agent writes freely what to found, the referee translates it to these rules, the code decides the outcome.
import { clamp, sum, news, rand, nextId } from './util.js';
import { GOODS, GOOD_LABEL, aliveCountries, atWar } from './world.js';
import { distance, installLeader } from './politics.js';
import { incapacitated } from './health.js';
import { shame } from './diplomacy.js';

export const num = (v, a, b, d = a) => clamp(Number.isFinite(Number(v)) ? Number(v) : d, a, b);

export const STATE_POWERS = ['audit', 'judiciary', 'security', 'intelligence', 'bureaucracy', 'bank', 'army'];
export const CIVIL_POWERS = ['education', 'welfare', 'propaganda', 'clergy', 'capital', 'farming', 'industry', 'research'];
export const DELEGABLE = new Set(['appoint_governor', 'appoint_commander', 'set_culture_policy', 'set_fx_regime', 'devalue', 'borrow_foreign', 'repay_foreign', 'set_capital_controls', 'ship_goods', 'buy_goods', 'sell_goods', 'set_import', 'set_export', 'set_import_priority', 'set_tax', 'set_budget', 'set_tariff', 'set_arms_share', 'print_money', 'borrow', 'embargo', 'build', 'survey', 'set_research', 'move', 'move_army', 'recruit', 'repress', 'concession', 'purge', 'ban_party', 'set_institutions', 'propose_treaty', 'accept_treaty', 'spy', 'steal_tech', 'gather_dossier']);
export const GATED = new Set(['set_labour_law', 'set_culture_policy', 'set_status', 'nationalize_company', 'set_tax', 'set_budget', 'set_tariff', 'set_import', 'set_export', 'borrow', 'print_money', 'default_debt', 'declare_war', 'ban_party', 'land_reform', 'nationalize', 'privatize', 'set_regime']);
// What a law can do. A legislature makes rules and votes money; it does not arrest people, name heirs or move regiments. Those are acts of the executive.
export const LEGISLATIVE = new Set([...GATED, 'prosecute', 'create_institution', 'fund_institution', 'dissolve_institution', 'set_institutions', 'hold_election', 'concession', 'set_arms_share', 'set_capital_controls', 'set_fx_regime', 'release', 'repay_state_debt']);
const MAX_OPEN_BILLS = 16, MAX_INSTITUTIONS = 40, MAX_PRIVATE_EACH = 5;
export const institutionRoom = (w, c, actor) => activeInstitutions(c).length >= MAX_INSTITUTIONS ? 'The register of institutions is full; one must be dissolved first.' : !governs(w, c, actor) && activeInstitutions(c).filter(i => i.sponsor === actor.id).length >= MAX_PRIVATE_EACH ? `You already keep up ${MAX_PRIVATE_EACH} bodies of your own; close or hand over one before founding another.` : '';
// Whoever governs today: the ruler, or the person governing in the ruler's name while the ruler lies too ill.
export const governs = (w, c, actor) => !!actor && (actor.id === c.leader || ((c.regent ?? c.heir) === actor.id && actor.status === 'free' && incapacitated(w.characters[c.leader])));
// One institution's share of GDP per quarter. Around 1900 a whole government spent a tenth of GDP; a single agency is a small slice of that.
export const MAX_AGENCY_BUDGET = .02;

const activeInstitutions = c => (c.institutions || []).filter(i => i.id);
const memberOf = (i, id) => i.head === id || (i.members || []).includes(id);

export function delegated(c, actor, opName) {
  return activeInstitutions(c).some(i => memberOf(i, actor.id) && (i.authority || []).includes(opName) && (i.strength ?? 0) >= .2);
}

// As the vetoing institution's strength and court independence grow, the leader cannot get past it.
// An institution answers once a quarter to a given kind of act: asking again the same quarter gets the same answer. Only its own head is not subject to it.
export function vetoedBy(w, c, actor, opName) {
  const book = c._veto?.turn === w.turn ? c._veto : (c._veto = { turn: w.turn, said: {} });
  if (!(opName in book.said)) book.said[opName] = activeInstitutions(c).find(i => (i.veto || []).includes(opName) && rand(w) < clamp((i.strength ?? 0) * (.35 + c.courts / 150), 0, .95))?.id ?? null;
  const inst = book.said[opName] && activeInstitutions(c).find(i => i.id === book.said[opName]);
  return inst && inst.head !== actor.id ? inst : undefined;
}

export function makeInstitution(w, c, actor, op) {
  const isState = governs(w, c, actor), allowed = isState ? [...STATE_POWERS, ...CIVIL_POWERS] : CIVIL_POWERS;
  // The register has room for so many bodies, and one private person keeps up only a few. A new club never pushes a court out of existence.
  if (activeInstitutions(c).length >= MAX_INSTITUTIONS || (!isState && activeInstitutions(c).filter(i => i.sponsor === actor.id).length >= MAX_PRIVATE_EACH)) return null;
  const inst = {
    id: nextId(w, 'KR'), name: String(op.name || 'Unnamed institution').slice(0, 70), description: String(op.description || '').slice(0, 280), founder: actor.name, turn: w.turn,
    powers: (Array.isArray(op.powers) ? op.powers : []).filter(p => allowed.includes(p)).slice(0, 4),
    authority: isState ? (Array.isArray(op.authority) ? op.authority : []).filter(x => DELEGABLE.has(x)).slice(0, 8) : [],
    veto: isState ? (Array.isArray(op.veto) ? op.veto : []).filter(x => GATED.has(x) || DELEGABLE.has(x)).slice(0, 6) : [],
    budget: isState ? num(op.budget_pct_gdp, 0, MAX_AGENCY_BUDGET, .002) : 0,
    sponsor: isState ? null : actor.id, amount: isState ? 0 : num(op.amount, 0, actor.wealth * .25, 0),
    head: null, members: [], strength: .15, funding: .5
  };
  const head = w.characters[op.head];
  inst.head = head?.alive && head.country === c.id && head.status === 'free' ? head.id : actor.id;
  for (const id of Array.isArray(op.members) ? op.members.slice(0, 8) : []) { const m = w.characters[id]; if (m?.alive && m.status === 'free' && m.country === c.id && m.id !== inst.head && !inst.members.includes(m.id)) inst.members.push(m.id); }
  c.institutions.push(inst);
  return inst;
}

const addMod = (c, key, delta, label) => c.mods.push({ key, delta, turns: 1, label });

function applyPower(w, c, inst, power, s) {
  const add = (stat, d, lo = 0, hi = 100) => { c[stat] = clamp((c[stat] ?? 0) + d, lo, hi); };
  switch (power) {
    case 'audit': {
      add('corruption', -.7 * s, 2, 95);
      const head = w.characters[inst.head];
      if (head?.alive && rand(w) < .12 * s) {
        const suspects = Object.values(w.characters).filter(x => x.alive && x.country === c.id && x.id !== head.id && x.secrets?.length && !head.dossiers[x.id]);
        if (suspects.length) { const t = suspects[Math.floor(rand(w) * suspects.length)], facts = t.secrets.slice(-5).map(x => x.text); head.dossiers[t.id] = { turn: w.turn, about: t.name, facts }; head.inbox.push({ turn: w.turn, from: inst.name, text: `Audit finding, ${t.name}: ${facts.join(' ')}` }); }
      }
      break;
    }
    case 'judiciary': add('courts', .6 * s); break;
    case 'security': add('police', .6 * s, 5, 95); break;
    case 'intelligence': add('intelligence', .6 * s); break;
    case 'bureaucracy': add('bureaucracy', .5 * s, 10, 95); break;
    case 'bank': add('bankHealth', .8 * s); break;
    case 'army': addMod(c, 'sat.army', 4 * s, inst.name); break;
    case 'education': add('literacy', .15 * s, 5, 99); break;
    case 'welfare': addMod(c, 'sat.peasants', 3 * s, inst.name); addMod(c, 'sat.workers', 3 * s, inst.name); break;
    case 'propaganda': addMod(c, 'sat.all', 2 * s, inst.name); break;
    case 'clergy': addMod(c, 'sat.clergy', 4 * s, inst.name); break;
    case 'capital': addMod(c, 'sat.capital', 4 * s, inst.name); break;
    case 'farming': c.tech.agri = clamp(c.tech.agri * (1 + .002 * s), .5, 10); break;
    case 'industry': c.tech.ind = clamp(c.tech.ind * (1 + .002 * s), .5, 10); break;
    case 'research': if (c.research) c.research.progress += 2.5 * s; break;
  }
}

export function institutionStep(w) {
  for (const c of aliveCountries(w)) for (const inst of activeInstitutions(c)) {
    const head = w.characters[inst.head];
    if (!head?.alive || head.country !== c.id) inst.head = null;
    inst.members = inst.members.filter(id => w.characters[id]?.alive && w.characters[id].country === c.id);
    let paid = 0, need;
    if (inst.sponsor) {
      // A private body lives on its founder's purse and on whatever grant the state adds from the budget.
      const sp = w.characters[inst.sponsor], grant = (inst.grant || 0) * Math.max(c.gdp, 1); let got = grant * (c.paidRatio ?? 1); need = inst.amount + grant;
      if (sp?.alive && inst.amount > 0) { const m = Math.min(sp.wealth, inst.amount); sp.wealth -= m; got += m; }
      // Gifts it was given are spent a tenth a quarter, on top of what its founder and the state put in.
      if (inst.endowment > .01) { const gift = inst.endowment * .1; inst.endowment -= gift; need += gift; got += gift; }
      paid = need > 0 ? got / need : 0;
    } else {
      // State institutions are budget lines: they are paid as well as the rest of the state was paid this quarter.
      need = inst.budget * Math.max(c.gdp, 1);
      if (need > 0) paid = c.paidRatio ?? 1;
    }
    inst.funding += (paid - inst.funding) * .4;
    const size = inst.sponsor ? clamp(need / 15, 0, 1.2) : clamp(inst.budget / Math.max(.003 * Math.max(inst.powers.length, 1), .001), 0, 1.2);
    const target = clamp(inst.funding * size * (.45 + (inst.head ? .35 : 0) + Math.min(inst.members.length + (inst.seats || 0), 4) * .05), 0, 1.2);
    inst.strength += (target - inst.strength) * .3;
  }
  // Two bodies doing the same work do not do twice as much: after the strongest, each further one adds half of what the one before it added.
  for (const c of aliveCountries(w)) {
    const rank = {};
    for (const inst of [...activeInstitutions(c)].sort((a, b) => b.strength - a.strength)) for (const p of inst.powers) { const n = rank[p] = (rank[p] ?? 0) + 1; applyPower(w, c, inst, p, inst.strength * .5 ** (n - 1)); }
  }
}

export function allocateSeats(c) {
  const ps = c.parties.filter(p => !p.banned), tot = sum(ps, p => Math.max(p.support, 0)) || 1, seats = {};
  const quota = ps.map(p => ({ id: p.id, v: Math.max(p.support, 0) / tot * 100 }));
  let left = 100;
  for (const q of quota) { seats[q.id] = Math.floor(q.v); left -= seats[q.id]; }
  for (const q of quota.sort((a, b) => (b.v % 1) - (a.v % 1)).slice(0, Math.max(0, left))) seats[q.id]++;
  return seats;
}

export function makeParliament(c, name, legislative = true) {
  c.parliament = { name: String(name || 'Parliament').slice(0, 60), legislative, seats: allocateSeats(c), suspendedUntil: 0 };
  c.bills ||= []; c.laws ||= [];
  return c.parliament;
}

export const parliamentOpen = (w, c) => !!c.parliament && w.turn >= (c.parliament.suspendedUntil ?? 0);
export const mustPassParliament = (w, c, op) => parliamentOpen(w, c) && c.parliament.legislative && GATED.has(op.op) && !op._law;

// The opposition a government faces stands outside it: the strongest party that sits neither as the ruling party nor on its benches.
export const onBenches = (c, p) => p.id === c.rulingParty || (c.coalition || []).includes(p.id);
export const rivalParty = c => (c.parties || []).filter(p => !p.banned && !onBenches(c, p)).sort((a, b) => b.support - a.support)[0] ?? null;
export function leadsParties(w, c, ch) {
  // The leader of the opposition speaks for that party. If he has himself taken a party onto the government's benches, he speaks for that one, and can take it off again.
  const mine = c.opposition === ch.id ? c.parties.find(p => !p.banned && (c.coalition || []).includes(p.id) && c.coalitionBy?.[p.id] === ch.id) ?? rivalParty(c) : null;
  return c.parties.filter(p => p.founder === ch.id || (p.id === c.rulingParty && c.leader === ch.id) || p === mine);
}
// A government that takes office gathers a majority where it can: the parties nearest to it sit on its benches until it has one. One party is
// left outside if a majority can be had without it (the party it has just beaten, or failing that the strongest of the others): that is the
// opposition it faces. A party whose founder still leads it is not seated by anyone but its founder.
export function seatGovernment(w, c, keepOut = null) {
  c.coalition = []; c.coalitionBy = {};
  const ruling = c.parties.find(p => p.id === c.rulingParty && !p.banned); if (!ruling || !c.parliament) return;
  const free = p => { const f = w.characters[p.founder]; return !(f?.alive && f.country === c.id && f.id !== c.leader); };
  const others = c.parties.filter(p => p !== ruling && !p.banned && free(p)), near = [...others].sort((x, y) => distance(x.axes, ruling.axes) - distance(y.axes, ruling.axes));
  const out = others.find(p => p.id === keepOut) ?? [...others].sort((a, b) => b.support - a.support)[0];
  for (const p of near) { if (governmentSeats(c) > 50) break; if (p !== out) c.coalition.push(p.id); }
  // No majority without it: then that is the party the government rests on, and the opposition is whoever is left.
  if (governmentSeats(c) <= 50 && out) { c.coalition = [out.id]; for (const p of near) { if (governmentSeats(c) > 50) break; if (p !== out) c.coalition.push(p.id); } }
}

export function createBill(w, c, actor, { title, text, ops, axes }) {
  if ((c.bills || []).filter(b => b.status === 'pending').length >= MAX_OPEN_BILLS) return null;
  const led = leadsParties(w, c, actor)[0];
  const bill = { id: nextId(w, 'Y'), title: String(title || 'Unnamed law').slice(0, 100), text: String(text || '').slice(0, 500), ops: (Array.isArray(ops) ? ops : []).filter(o => LEGISLATIVE.has(o?.op)).slice(0, 4), axes: axes && typeof axes === 'object' ? { econ: num(axes.econ, -100, 100, 0), auth: num(axes.auth, -100, 100, 0), nation: num(axes.nation, -100, 100, 0), faith: num(axes.faith, -100, 100, 0) } : { ...(actor.id === c.leader ? c.axes : actor.axes) }, proposer: actor.id, proposerName: actor.name, party: led?.id ?? null, byGov: actor.id === c.leader, turn: w.turn, voteAt: w.turn + 1, votes: {}, lobby: {}, status: 'pending' };
  (c.bills ||= []).push(bill);
  for (const p of c.parties) { for (const id of [p.founder, p.id === c.rulingParty ? c.leader : null, c.opposition]) { const ch = w.characters[id]; if (ch?.alive && ch.id !== actor.id && ch.aiControlled && ch.country === c.id && leadsParties(w, c, ch).includes(p)) ch.inbox.push({ turn: w.turn, from: c.parliament?.name ?? 'Parliament', text: `Bill ${bill.id} (${bill.proposerName}): ${bill.title}. ${bill.text} It will be voted on next quarter.` }); } }
  return bill;
}

// What a party makes of what a bill actually does, beyond where its sponsor stands: no party votes its own ban, landlords do not vote for land reform.
function billLean(c, b, p) {
  let s = 0; const x = p.axes;
  for (const op of b.ops || []) switch (op?.op) {
    case 'set_regime': if (op.elections === false) s -= 45; if (op.elections === true) s += 15; if (op.press_freedom !== undefined && op.press_freedom < c.pressFreedom - 5) s += x.auth > 40 ? 8 : -25; break;
    case 'ban_party': s += op.party === p.id ? -100 : x.auth > 30 ? 5 : -15; break;
    case 'print_money': s += x.econ > 0 ? -18 : 4; break;
    case 'default_debt': s += x.econ > 0 ? -25 : 5; break;
    case 'declare_war': s += x.nation > 30 ? 12 : -15; break;
    case 'set_tax': { const up = (op.rate ?? 0) > (c.tax[op.kind] ?? 0), pays = { land: 'peasants', business: 'elite', income: 'workers' }[op.kind], mine = p.base === pays || (op.kind === 'income' && p.base === 'middle'); s += up ? (mine ? -20 : 4) : (mine ? 12 : 0); break; }
    case 'set_budget': { const up = (op.share ?? 0) > (c.budget[op.category] ?? 0) ? 1 : -1; if (op.category === 'welfare') s += up * (x.econ < 0 ? 15 : -8); if (op.category === 'military') s += up * (x.nation > 20 ? 10 : -8); break; }
    case 'nationalize': case 'nationalize_company': s += x.econ < -20 ? 18 : x.econ > 20 ? -30 : -5; break;
    case 'privatize': s += x.econ > 20 ? 15 : x.econ < -20 ? -20 : 0; break;
    case 'land_reform': s += p.base === 'peasants' ? 30 : p.base === 'elite' ? -40 : x.econ < 0 ? 10 : -10; break;
    // A law that puts a people or a faith under disabilities is voted by those who want the nation or the faith first and fought by the rest; lifting them, the other way.
    case 'set_status': { const harsh = op.equal !== true && ([op.vote, op.office, op.arms, op.protect].includes(false) || op.levy > 0); s += (x.nation > 30 || x.faith > 30 ? 12 : -20) * (harsh ? 1 : -1); break; }
    case 'set_culture_policy': if (op.language === 'assimilate') s += x.nation > 30 ? 12 : -12; if (op.language === 'autonomy') s += x.nation > 30 ? -15 : 8; if (op.faith === 'state') s += x.faith > 30 ? 15 : -12; if (op.faith === 'secular') s += x.faith > 30 ? -20 : 10; break;
  }
  return s;
}

// A government falls when its own benches and its partners stop holding it up. The parties outside it want it gone the more the country has turned against it.
// How a party leans on a motion or a bill before the day's luck: above nought it votes yes. The whips count from the same figure (whipCount).
function confidenceLean(c, b, p) {
  const slide = 50 - c.legitimacy, bought = (b.lobby[p.id] || 0) * .4;
  if (p.id === c.rulingParty) return -55 + slide * .9 + bought;
  if ((c.coalition || []).includes(p.id)) return -22 + slide * .9 + distance(p.axes, c.axes) * .2 + bought;
  return 18 + slide * .6 + distance(p.axes, c.axes) * .25 + bought;
}
function confidenceVote(w, c, b, p) {
  if (b.votes[p.id]) return b.votes[p.id] === 'yes';
  return confidenceLean(c, b, p) + rand(w) * 16 - 8 > 0;
}
function governmentFalls(w, c, b, yes, no) {
  const old = w.characters[c.leader], next = w.characters[b.proposer], fit = next?.alive && next.status === 'free' && next.country === c.id && next.id !== old?.id;
  news(w, `${c.name}: parliament voted no confidence in ${old?.name ?? 'the government'} (${yes} to ${no}).${fit ? ` ${next.name} forms the new government.` : ' An election is called.'}`, { kind: 'politics', countries: [c.id] });
  c.lastMotion = w.turn; c.coalition = []; c.coalitionBy = {};
  if (!fit || !old) { c.nextElection = w.turn + 1; c.legitimacy = clamp(c.legitimacy - 4, 0, 100); return; }
  const wasOpp = c.opposition === next.id, prev = old.id, party = c.parties.find(p => p.id === b.party), fallen = c.rulingParty;
  installLeader(w, c, next, null, wasOpp);
  // If it was the leader of the opposition who brought the government down, the two change places.
  if (wasOpp) { const ex = w.characters[prev]; ex.role = 'opposition'; ex.loyalty = 40; c.opposition = prev; }
  // The house that voted the old government out seats the new one: the parties nearest to it, without the party that has just fallen.
  if (party) { c.rulingParty = party.id; for (const a of ['econ', 'auth', 'nation', 'faith']) c.axes[a] = Math.round(c.axes[a] + (party.axes[a] - c.axes[a]) * .5); if (party.id !== fallen) seatGovernment(w, c, fallen); }
  next.rise = `Became head of government in ${w.date ?? 'the first days'} when parliament voted no confidence in ${old.name}.`;
  c.legitimacy = clamp(c.legitimacy + 3, 0, 100);
}
// The benches a government can count on: its own party and the partners that have joined it.
export const governmentSeats = c => (c.parties || []).filter(p => !p.banned && (p.id === c.rulingParty || (c.coalition || []).includes(p.id))).reduce((a, p) => a + (c.parliament?.seats?.[p.id] || 0), 0);

function leanOf(c, b, p) {
  if (b.confidence) return confidenceLean(c, b, p);
  let s = 30 - distance(p.axes, b.axes) * .5 + (b.lobby[p.id] || 0) * .4;
  if (b.party === p.id) s += 35;
  s += billLean(c, b, p);
  if (b.byGov) s += p.id === c.rulingParty ? 30 : (c.coalition || []).includes(p.id) ? 18 : -10;
  // The government's own benches do not carry the opposition's bills unless something moves them.
  else if (p.id === c.rulingParty && b.party !== p.id) s -= 28;
  return s;
}
// The whips' count on a pending bill: seats sure for it, sure against, abstaining, and those whose party stands so near the line that the day
// will decide (the vote itself adds eight points either way to each party's leaning).
export function whipCount(c, b) {
  const seats = c.parliament?.seats || {}, out = { yes: 0, no: 0, abstain: 0, doubtful: 0 };
  for (const p of c.parties || []) { const n = seats[p.id] || 0; if (!n || p.banned) continue; const v = b.votes[p.id];
    if (v === 'abstain') out.abstain += n; else if (v) out[v === 'yes' ? 'yes' : 'no'] += n; else { const s = leanOf(c, b, p); if (s > 8) out.yes += n; else if (s < -8) out.no += n; else out.doubtful += n; } }
  return out;
}
function partyVotes(w, c, b, p) {
  if (b.confidence) return confidenceVote(w, c, b, p);
  if (b.votes[p.id]) return b.votes[p.id] === 'yes';
  return leanOf(c, b, p) + rand(w) * 16 - 8 > 0;
}

export function enactLaw(w, c, bill, apply, via) {
  // A law passed by a legislature is carried out as law. A decree is the ruler's own act: it skips no court and no veto.
  const leader = w.characters[c.leader], results = leader ? bill.ops.filter(op => LEGISLATIVE.has(op?.op)).map(op => ({ op: op?.op, ...apply(w, leader, { ...op, _law: true, ...(via === 'decree' ? { _decree: true } : {}) }) })) : [];
  (c.laws ||= []).push({ id: bill.id, title: bill.title, text: bill.text, turn: w.turn, via, results: results.map(r => `${r.op}: ${r.msg}`).slice(0, 4) });
  if (c.laws.length > 40) c.laws.shift();
  return results;
}

export function billStep(w, apply) {
  for (const c of aliveCountries(w)) {
    for (const b of c.bills || []) {
      if (b.status !== 'pending' || w.turn < b.voteAt) continue;
      if (!parliamentOpen(w, c)) { b.status = 'lapsed'; b.closedAt = w.turn; continue; }
      let yes = 0, no = 0; const seats = c.parliament.seats;
      for (const p of c.parties) { const n = seats[p.id] || 0; if (!n || p.banned) continue; if (b.votes[p.id] === 'abstain') continue; if (partyVotes(w, c, b, p)) yes += n; else no += n; }
      b.tally = { yes, no }; b.closedAt = w.turn;
      if (b.confidence) {
        b.status = yes > no ? 'passed' : 'rejected';
        if (yes > no) governmentFalls(w, c, b, yes, no);
        else { c.lastMotion = w.turn; c.legitimacy = clamp(c.legitimacy + 2, 0, 100); news(w, `${c.name}: the motion of no confidence failed (${yes} to ${no}); the government stands.`, { kind: 'politics', countries: [c.id] }); }
      } else if (yes > no) {
        b.status = 'passed'; enactLaw(w, c, b, apply, 'parliament');
        news(w, `${c.name} parliament passed the "${b.title}" act (${yes} yes, ${no} no).`, { kind: 'politics', countries: [c.id] });
        if (b.byGov) c.legitimacy = clamp(c.legitimacy + .5, 0, 100);
      } else {
        b.status = 'rejected';
        news(w, `${c.name} parliament rejected the "${b.title}" bill (${yes} yes, ${no} no).`, { kind: 'politics', countries: [c.id] });
        if (b.byGov) c.legitimacy = clamp(c.legitimacy - 1.5, 0, 100);
      }
    }
    if (c.bills) c.bills = c.bills.filter(b => b.status === 'pending' || w.turn - b.closedAt <= 8);
    // A chamber that is not elected is still refilled from time to time as the standing of its factions shifts.
    if (c.parliament && !c.elections && w.turn % 8 === 0) c.parliament.seats = allocateSeats(c);
  }
}

// Treaty clauses. The referee turns free text into these types; what can be paid is paid by code, what is not kept is recorded as a breach.
export function normalizeClauses(w, raw, parties) {
  const out = [], isParty = x => parties.includes(x), turns = v => Math.round(num(v, 1, 80, 12));
  for (const c of Array.isArray(raw) ? raw.slice(0, 8) : []) {
    if (c?.type === 'tribute' && isParty(c.payer)) out.push({ type: 'tribute', payer: c.payer, ...(isParty(c.to) && c.to !== c.payer ? { to: c.to } : {}), pct_gdp: num(c.pct_gdp, 0, .2, .02), turns: turns(c.turns) });
    else if (c?.type === 'delivery' && isParty(c.from) && GOODS.includes(c.good)) out.push({ type: 'delivery', from: c.from, ...(isParty(c.to) && c.to !== c.from ? { to: c.to } : {}), good: c.good, amount: num(c.amount, 0, 1e5, 0), turns: turns(c.turns) });
    else if (c?.type === 'tariff') out.push({ type: 'tariff', rate: num(c.rate, 0, 1, 0) });
    else if (c?.type === 'demilitarized_zone' && Array.isArray(c.provinces)) out.push({ type: 'demilitarized_zone', country: isParty(c.country) ? c.country : null, provinces: c.provinces.filter(p => w.provinces[p]).slice(0, 12) });
    else if (c?.type === 'troop_limit' && isParty(c.country)) out.push({ type: 'troop_limit', country: c.country, men: num(c.men, 0, 1e6, 0) });
    else if (c?.type === 'mutual_defense') out.push({ type: 'mutual_defense', called: {} });
  }
  return out;
}

export function clauseText(w, cl) {
  const n = id => w.countries[id]?.name ?? id;
  switch (cl.type) {
    case 'tribute': return `${n(cl.payer)} pays ${cl.to ? `${n(cl.to)} ` : ''}${Math.round(cl.pct_gdp * 1000) / 10}% of GDP each turn${cl.until != null ? `, until the end of turn ${cl.until}` : ''}`;
    case 'delivery': return `${n(cl.from)} delivers ${cl.to ? `to ${n(cl.to)} ` : ''}${Math.round(cl.amount)} ${GOOD_LABEL[cl.good]} each turn${cl.until != null ? `, until the end of turn ${cl.until}` : ''}`;
    case 'tariff': return `Mutual tariff of ${Math.round(cl.rate * 100)}%`;
    case 'demilitarized_zone': return `${cl.country ? n(cl.country) : 'The parties'} shall station no troops in: ${cl.provinces.map(p => w.provinces[p]?.name ?? p).join(', ')}`;
    case 'troop_limit': return `${n(cl.country)} keeps at most ${Math.round(cl.men)}k troops`;
    case 'mutual_defense': return 'Each party enters the war on the side of the party attacked';
    default: return cl.type;
  }
}

export function activateClauses(w, t) {
  for (const cl of t.clauses || []) { if (cl.turns) cl.until = w.turn + cl.turns; cl.text = clauseText(w, cl); }
}

function breach(w, t, cl, party, text) {
  if (w.turn - (cl.lastBreach ?? -99) < 4) return;
  cl.lastBreach = w.turn;
  (t.breaches ||= []).push({ turn: w.turn, party, text });
  t.breaches = t.breaches.slice(-12);
  // A clause not kept is a word not kept, and it is seen: the state's name for keeping its promises is the worse for it.
  if (w.countries[party]?.alive) shame(w, w.countries[party], -3, `it did not keep a clause of its ${t.kind.replace('_', ' ')} treaty`);
  for (const id of t.parties) { const leader = w.characters[w.countries[id]?.leader]; if (leader?.alive) leader.inbox.push({ turn: w.turn, from: 'Foreign Ministry', text: `Treaty ${t.id} breached: ${text}` }); }
  news(w, `Treaty breach: ${text}`, { kind: 'diplomacy', countries: t.parties });
}

const routeOpen = (w, a, b) => !!w.routes[a < b ? `${a}|${b}` : `${b}|${a}`];

export function treatyStep(w) {
  for (const c of aliveCountries(w)) c.tariffDeals = {};
  for (const t of w.treaties) {
    if (!t.active) continue;
    if (t.expires != null && w.turn >= t.expires) { t.active = false; w.guarantees = (w.guarantees || []).filter(x => x.treaty !== t.id); news(w, `The ${t.kind.replace('_', ' ')} treaty between ${t.parties.map(x => w.countries[x]?.name).join(' and ')} has expired.`, { kind: 'diplomacy', countries: t.parties, secret: !!t.secret }); continue; }
    for (const cl of t.clauses || []) {
      if (cl.until != null && w.turn >= cl.until) continue;
      if (cl.type === 'tribute') {
        const payer = w.countries[cl.payer], other = w.countries[cl.to ?? t.parties.find(x => x !== cl.payer)];
        if (!payer?.alive || !other?.alive || !t.parties.includes(payer.id) || !t.parties.includes(other.id)) continue;
        // Tribute is owed in gold, so it is measured against what the country really produces, not against its paper prices.
        const due = Math.max(payer.realGdp, 1) * cl.pct_gdp, paid = Math.min(Math.max(payer.reserves, 0), due);
        payer.reserves -= paid; other.reserves += paid;
        if (paid < due * .95) breach(w, t, cl, cl.payer, `${payer.name} could not pay its tribute in full.`);
      } else if (cl.type === 'delivery') {
        const from = w.countries[cl.from], to = w.countries[cl.to ?? t.parties.find(x => x !== cl.from)];
        if (!from?.alive || !to?.alive || !t.parties.includes(from.id) || !t.parties.includes(to.id) || !routeOpen(w, from.id, to.id)) continue;
        const moved = Math.min(from.stock[cl.good] || 0, cl.amount);
        from.stock[cl.good] = (from.stock[cl.good] || 0) - moved; to.stock[cl.good] = (to.stock[cl.good] || 0) + moved;
        if (moved < cl.amount * .95) breach(w, t, cl, cl.from, `${from.name} could not complete its ${GOOD_LABEL[cl.good]} delivery.`);
      } else if (cl.type === 'tariff') {
        // The agreed rate holds between every two of those who signed.
        const ps = t.parties.map(x => w.countries[x]).filter(o => o?.alive);
        for (const a of ps) for (const b of ps) if (a !== b) a.tariffDeals[b.id] = Math.min(a.tariffDeals[b.id] ?? 1, cl.rate);
      } else if (cl.type === 'demilitarized_zone') {
        for (const u of Object.values(w.units)) if (cl.provinces.includes(u.province) && (cl.country ? u.country === cl.country : t.parties.includes(u.country))) { breach(w, t, cl, u.country, `${w.countries[u.country]?.name} moved troops into the demilitarized zone: ${w.provinces[u.province]?.name}.`); break; }
      } else if (cl.type === 'troop_limit') {
        const men = sum(Object.values(w.units).filter(u => u.country === cl.country), u => u.men);
        if (men > cl.men) breach(w, t, cl, cl.country, `${w.countries[cl.country]?.name} exceeded its troop limit (${Math.round(men)}k).`);
      } else if (cl.type === 'mutual_defense') {
        // Every other signatory owes its help to the one attacked.
        for (const x of t.parties) for (const ally of t.parties) for (const war of w.wars) {
          const key = t.multi ? `${war.id}:${ally}` : war.id;
          if (ally === x || !war.active || war.civil || !war.b.includes(x) || war.a.includes(ally) || war.b.includes(ally) || war.a.some(id => atWar(w, ally, id)) || cl.called[key] || w.turn - war.start < 2 || war.start < (t.turn ?? 0)) continue;
          cl.called[key] = true;
          breach(w, t, cl, ally, `${w.countries[ally]?.name} did not enter the war on the side of ${w.countries[x]?.name}, which was attacked (${war.name}).`);
        }
      }
    }
  }
}
