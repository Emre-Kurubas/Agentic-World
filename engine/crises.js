// Things that come to a government from outside and want an answer. None of them comes by the calendar: each grows out of what stands in the
// world that quarter, and in a quiet world none of them comes at all.
//  - A deputation from kin under another flag, when their province has stood at the edge of rising for two quarters or blood has been shed there.
//  - A disputed succession next door (the dispute itself is politics.js): neighbours are told, may recognise either claimant, and are remembered for it.
//  - A debtor state that does not pay its interest in gold: what is unpaid is added to what it owes, and its creditor is told what creditors do.
// (World 19: twelve quarters, eight states, five governments with a claim and a plan, and not one decision that could not wait a quarter. The
// user asked for crises that force a decision, and that they come about organically. The wording of the three notices was put to the user and
// approved, 2026-11-12.)
import { clamp, news, quarterLabel } from './util.js';
import { aliveCountries } from './world.js';
import { groupsOf, policyFor, statusOf } from './culture.js';
import { him } from './names.js';

const say = (w, ch, from, text) => { if (ch?.alive) ch.inbox.push({ turn: w.turn, from, text }); };
const round = v => Math.round(v);
export const APPEAL_AT = 50, APPEAL_RISE = 8, APPEAL_REST = 8, APPEAL_WEIGHS = 4;

// What the deputation says of how its people are held: only what the engine itself keeps.
function grievances(w, x, p, g) {
  const out = [`unrest there stands at ${round(p.unrest)} of 100`], pol = policyFor(x, p, g), st = statusOf(x, g);
  if (pol.language === 'assimilate') out.push('our tongue is shut out of the schools');
  if (pol.faith === 'state' && g.rel !== x.majorityRel) out.push('our faith is kept out of public life');
  const barred = [st.office === false ? 'office' : '', st.vote === false ? 'the vote' : '', st.arms === false ? 'the army' : ''].filter(Boolean); if (barred.length) out.push(`our people are shut out of ${barred.join(' and ')}`);
  if (st.levy > 0) out.push('a levy is laid on us that our neighbours do not pay');
  if (p.forced && Object.keys(p.forced).length) out.push('our men are taken for forced work');
  if (p.scar?.by === x.id && w.turn - p.scar.turn <= 8) out.push(`blood was shed there by the government's men in ${quarterLabel(p.scar.turn)}`);
  if (p.pogrom && w.turn - (p.pogrom.turn ?? -99) <= 8) out.push('a mob was let loose on our houses');
  return out;
}

export function appealStep(w) {
  // One deputation for a people under one flag: from the province where things stand worst. A province that was handed over restless is
  // not a crisis for being restless still: they come when it has grown worse than it was and has stood so two quarters, or when the
  // government's men have shed blood there. (Measured before this was so: eight deputations in the second quarter of a world nobody had
  // yet governed, and a general strike in a merchant state out of the grief of it.)
  const worst = {};
  for (const p of Object.values(w.provinces)) {
    const x = w.countries[p.controller]; if (!x?.alive) { delete p.hotSince; continue; }
    p.unrest0 ??= p.unrest; const edge = Math.max(APPEAL_AT, p.unrest0 + APPEAL_RISE);
    if (p.unrest >= edge) p.hotSince ??= w.turn; else if (p.unrest < edge - 4) delete p.hotSince;
    const blood = p.scar?.by === x.id && p.scar.turn === w.turn, lasting = p.hotSince != null && w.turn - p.hotSince >= 1; if (!blood && !lasting) continue;
    for (const g of groupsOf(p)) { if (g.share < .35 || g.eth === x.majorityEth) continue;
      const y = aliveCountries(w).find(o => o.id !== x.id && o.majorityEth === g.eth); if (!y) continue;
      const last = (w.appeals ||= []).filter(a => a.from === x.id && a.to === y.id).at(-1); if (last && w.turn - last.turn < APPEAL_REST) continue;
      const k = `${x.id}>${y.id}`; if (!worst[k] || p.unrest + (blood ? 30 : 0) > worst[k].weight) worst[k] = { p, x, y, g, weight: p.unrest + (blood ? 30 : 0) }; }
  }
  for (const { p, x, y, g } of Object.values(worst)) {
    const a = { id: `AP${(w.appealSeq = (w.appealSeq || 0) + 1)}`, province: p.id, from: x.id, to: y.id, eth: g.eth, turn: w.turn }; w.appeals.push(a); if (w.appeals.length > 60) w.appeals.shift();
    const says = grievances(w, x, p, g), list = says.length > 1 ? `${says.slice(0, -1).join(', ')}, and ${says.at(-1)}` : says[0];
    const text = `Men of our people from ${p.name} (${p.id}), under ${x.name}, have come over the frontier to ask for help. They say: ${list}. They ask for arms and money, or for your word spoken aloud, or for your army. The papers here have the story. What governments have done with such a deputation: sent it home with fair words; a note to the government that holds the province (note); schools and consuls put into a treaty; money and rifles over the frontier in secret (fund_underground with target); an ultimatum; war. Left unanswered, it is remembered here as a wrong borne in silence.`;
    for (const seat of ['leader', 'opposition']) say(w, w.characters[y[seat]], `A deputation from ${p.name}`, text);
    // It is in the papers on both sides of the frontier, and it lies on the country as a wrong until it is answered (frontier.js reads the grudge).
    news(w, `${y.name}: a deputation of ${g.eth} from ${p.name}, under ${x.name}, has come over the frontier to ask for help.`, { kind: 'diplomacy', countries: [y.id, x.id], province: p.id });
    const k = ((y.grudges ||= {})[x.id] ||= { incident: 0, kin: 0 }); k.incident = (k.incident || 0) + APPEAL_WEIGHS; k.at = w.turn;
    say(w, w.characters[x.leader], 'Police', `A deputation of ${g.eth} from ${p.name} (${p.id}) has crossed into ${y.name} to ask its government for help, and the papers there have printed it. What they told them: ${list}.`);
  }
}

// A succession in dispute: the neighbours are told, once, when it opens.
export function disputeAbroad(w, c) {
  const d = c.dispute; if (!d || d.told) return; d.told = true; d.abroad ||= {};
  const holder = w.characters[d.holder], rival = w.characters[d.claimant]; if (!holder || !rival) return;
  const near = new Set(Object.values(w.provinces).filter(p => p.controller === c.id).flatMap(p => p.neighbors.map(n => w.provinces[n]?.controller)).filter(id => id && id !== c.id));
  for (const t of w.treaties || []) if (t.active && t.parties.includes(c.id) && ['alliance', 'protection'].includes(t.kind)) for (const id of t.parties) if (id !== c.id) near.add(id);
  const corps = Object.values(w.units).filter(u => u.country === c.id && u.commander === rival.id).sort((a, b) => b.men - a.men)[0], behind = corps ? ` and has the corps at ${w.provinces[corps.province]?.name} behind ${him(rival)}` : rival.role === 'general' ? ' and has the staff behind the claim' : '';
  for (const id of near) { const o = w.countries[id]; if (!o?.alive) continue;
    say(w, w.characters[o.leader], 'Foreign office', `The succession in ${c.name} is disputed. ${holder.name} (${holder.id}) holds the capital; ${rival.name} (${rival.id}) claims the seat${behind}. For three quarters each will look for friends. A government may recognise either (back_claim): recognition from abroad counts for something there, and whoever wins will remember who stood where. Money and arms sent to a claimant are a secret while they stay one.`); }
}
// What recognition from abroad adds to a side, and what is remembered of it when the matter is settled.
export const recognised = (w, c, side) => Object.entries(c.dispute?.abroad || {}).filter(([id, s]) => s === side && w.countries[id]?.alive).reduce((a, [id]) => a + 4 + clamp((w.countries[id].realGdp || 0) / Math.max(c.realGdp || 1, 1), 0, 2) * 2, 0);
export function disputeSettled(w, c, abroad, winner, loser) {
  for (const [id, side] of Object.entries(abroad || {})) { const o = w.countries[id]; if (!o?.alive) continue; const right = side === winner.side, who = right ? winner.ch : loser.ch;
    c.relations[id] = clamp((c.relations[id] ?? 0) + (right ? 15 : -20), -100, 100); o.relations[c.id] = clamp((o.relations[c.id] ?? 0) + (right ? 8 : -8), -100, 100);
    say(w, w.characters[o.leader], 'Foreign office', `The succession in ${c.name} is settled: ${winner.ch.name} holds the state. We had recognised ${who.name}${right ? ', and it is remembered to our credit there' : ', who lost; the government there will not forget it'}.`);
    say(w, winner.ch, 'Foreign office', `${o.name} recognised ${right ? 'you' : loser.ch.name} while the seat was in dispute.`); }
}

// A debtor state that does not pay its interest in gold. What is unpaid is added to what it owes; the creditor's government is told, the first
// quarter it happens and once a year while it lasts; the debtor's is told every quarter.
export function arrearsStep(w) {
  for (const c of aliveCountries(w)) { const unpaid = c._unpaid; delete c._unpaid; if (!unpaid) continue;
    for (const [cid, u] of Object.entries(unpaid)) { const k = w.countries[cid]; if (!k?.alive || !(u.due - u.pay > .5)) continue; const short = u.due - u.pay;
      c.creditors[cid] = (c.creditors[cid] || 0) + short; (c.arrearsTo ||= {})[cid] = (c.arrearsTo[cid] || 0) + short;
      say(w, w.characters[c.leader], 'The treasury', `We paid ${round(u.pay)} of the ${round(u.due)} in gold due to ${k.name} this quarter: the reserve held no more. The ${round(short)} unpaid is added to what we owe them, ${round(c.creditors[cid])} in all. A year of this and no lender calls us a debtor in good standing.`);
      const last = (c.dunned ||= {})[cid]; if (last != null && w.turn - last < 4) continue; c.dunned[cid] = w.turn;
      say(w, w.characters[k.leader], 'The treasury', `${c.name} paid ${round(u.pay)} of the ${round(u.due)} in gold due to us this quarter; ${round(c.arrearsTo[cid])} stands in arrear, on a debt of ${round(c.creditors[cid])}. What creditors have done: given time or a lower rate by a paper (a treaty with reschedule); taken goods against the debt (a delivery clause with credit); sold the claim to another government (assign); sent a squadron to lie off their harbour and taken the customs (seize_customs, with a fleet at sea there); a note; or written it off. A debtor left in arrear a year pays every lender more.`); }
    if (c.arrearsTo) for (const cid of Object.keys(c.arrearsTo)) if (!(c.creditors[cid] > .5)) delete c.arrearsTo[cid];
  }
}

export function crisesStep(w) { appealStep(w); arrearsStep(w); for (const c of aliveCountries(w)) if (c.dispute) disputeAbroad(w, c); }
