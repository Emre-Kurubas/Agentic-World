// Standing matters: what a seat sets going once and which then goes on by itself. A watch kept on somebody, a power left in another's hands, an
// order that waits for its day.
//
// World 16 (twenty quarters, thirty-two played seats): "have the police watch him", "keep watching the Land Party", "tell me at once if their
// troops come within a march of the frontier" were ordered about twenty-five times and had no operation (the referee wrote gather_dossier, which
// found nothing forty-three times in seventy-six, or spy, which failed half the time and cost money); "if they cross the frontier the chief of
// staff may call up the reserve without waiting for me" and "once their columns have left the pass, send the reservists home" about thirty-five
// times, and nothing in the engine could hold an order for its day or put a ruler's power in another's hands.
import { clamp, rand, news, nextId, quarterLabel } from './util.js';
import { aliveCountries, ROLES, atWar } from './world.js';
import { governs } from './polity.js';
import { he, him, his } from './names.js';

export const STANDING_OPS = new Set(['watch', 'delegate', 'standing_order', 'cancel_order']);
const say = (w, ch, from, text) => { if (ch?.alive) ch.inbox.push({ turn: w.turn, from, text }); };
// What comes from outside the engine carries no inner switches (game.js safeApply): an operation kept for its day is as much from outside as one
// given this morning, so the marks by which the engine itself knows a law or a decree are struck from it when it is entered and again when it runs.
const plainOp = o => { const { _law, _decree, _late, ...plain } = o ?? {}; return plain; };
const nameOf = (w, id) => w.countries[id]?.name ?? id;
const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
const round5 = v => v >= 20 ? Math.round(v / 5) * 5 : Math.round(v);

// ---- A watch ----
// How many people the state's police can keep under their eye at one time, and how many parties and provinces.
export const watchRoom = c => ({ person: 3 + Math.floor((c.police ?? 40) / 20), party: 3, province: 4, frontier: 12 });
const PRIVATE_WATCH = 2;
export const watchesOf = (w, actor) => (w.watches || []).filter(x => x.by === actor.id);
// Is this person under the eye of that country's police? (The post asks, before it lets a letter pass.)
// A watch is not an all-seeing eye. (World 20: a chief of staff who gathered a circle while her leader lay ill was seen by the police within
// two quarters, every letter she wrote was copied, and she never knew she was watched. The user asked what anybody could do against it,
// 2026-11-13, and chose these three.)
//  - A chief of police who has agreed to look away from somebody (deeds.js blind) makes his watchers look away too.
//  - The police see poorly into barracks: a watch they keep on a man of the army shows them little, unless whoever keeps the watch has a
//    man of his own among the officers. The staff's own watch on its officers sees as before.
//  - Somebody with a household and people of his own often notices the men across the street; a chief of staff soonest.
const chiefOf = (w, c) => Object.values(w.characters).find(x => x.alive && x.country === c.id && x.post === 'police' && x.status === 'free');
export const lookedAway = (w, c, personId) => { const chief = chiefOf(w, c); return !!chief?.blind && chief.blind.until >= w.turn && chief.blind.for === personId; };
export const ofTheArmy = (w, c, t) => c.general === t.id || t.office === 'staff' || Object.values(w.units).some(u => u.country === c.id && u.commander === t.id) || Object.values(w.fleets || {}).some(f => f.country === c.id && f.commander === t.id);
export const manInside = (w, c, by) => Object.values(w.characters).some(x => x.alive && x.status === 'free' && x.country === c.id && x.id !== by.id && (x.handler === by.id || x.payroll === by.id) && ofTheArmy(w, c, x));
// What a watch sees of what the watched does in secret, and of a circle gathering about him; and how likely he is to notice it, a quarter.
export function watchSight(w, c, x, by, t) {
  const police = c.police ?? 40, fromPolice = x.state && c.general !== by.id, away = fromPolice && lookedAway(w, c, t.id) ? .3 : 1, wall = fromPolice && ofTheArmy(w, c, t) && !manInside(w, c, by);
  const own = ROLES.some(r => c[r] === t.id) || ofTheArmy(w, c, t);
  return { deeds: (x.state ? clamp(.35 + police / 200, .3, .85) : .3) * away * (wall ? .7 : 1), circle: (x.state ? clamp(.2 + police / 300, .2, .5) : .12) * away * (wall ? .4 : 1), wall, away: away < 1,
    noticed: clamp((own ? .14 : .08) + (t.power || 0) / (own ? 300 : 500) + (c.general === t.id ? .08 : 0) - (x.state ? police / (own ? 800 : 500) : 0), own ? .08 : .03, own ? .45 : .3) };
}
export const watchedIn = (w, countryId, personId) => (w.watches || []).some(x => x.kind === 'person' && x.state && x.country === countryId && x.key === personId) && !(w.countries[countryId] && lookedAway(w, w.countries[countryId], personId));
const menFacing = (w, c, o) => { const ours = new Set(Object.values(w.provinces).filter(p => p.controller === c.id).map(p => p.id)); return sum(Object.values(w.units).filter(u => u.country === o.id && w.provinces[u.province]?.controller === o.id && w.provinces[u.province].neighbors.some(n => ours.has(n))), u => u.men); };
const watchWords = (w, x) => x.kind === 'person' ? `${w.characters[x.key]?.name ?? x.key} (${x.key})` : x.kind === 'party' ? `the ${w.countries[x.country]?.parties.find(p => p.id === x.key)?.name ?? x.key}` : x.kind === 'province' ? `${w.provinces[x.key]?.name ?? x.key}` : `the frontier with ${nameOf(w, x.key)}`;
export const standingWords = (w, ch) => {
  const out = [], mine = watchesOf(w, ch); if (mine.length) out.push(`Kept under watch: ${mine.map(x => watchWords(w, x)).join(', ')}.`);
  const c = w.countries[ch.country];
  for (const d of c?.delegations || []) { const to = d.seat ? w.characters[c[d.seat]] : w.characters[d.to]; if (d.by === ch.id || governs(w, c, ch)) out.push(`Left in the hands of ${to?.name ?? d.seat ?? d.to}: ${d.ops.join(', ')}.`); else if (to?.id === ch.id) out.push(`Left in your hands by ${w.characters[d.by]?.name ?? 'the government'}, to order as your own: ${d.ops.join(', ')}.`); }
  // An order whose day is this morning is given with this morning's orders, and says so: a ruler who reads "waiting" on the day gives it by
  // hand, and the order then finds its work done. (World 18: "Let standing order SO642 go ahead", twice, and each time the order reported
  // afterwards that there was nobody left to send home.)
  for (const so of (w.standingOrders || []).filter(x => x.by === ch.id)) { let due = false; try { due = so.firedAt !== w.turn && holds(w, so); } catch { due = false; }
    out.push(due ? `Order ${so.id}${so.label ? ` ("${so.label}")` : ''} has come to its day (${so.words}): ${so.then.map(o => o.op).join(', ')} ${so.then.length > 1 ? 'are' : 'is'} given in your name with this morning's orders, and you are told tomorrow what came of it. There is no need to give it yourself; to stop it, withdraw it this morning (cancel_order).` : `Order ${so.id}, waiting: ${so.words}, then ${so.then.map(o => o.op).join(', ')}${so.label ? ` ("${so.label}")` : ''}.`); }
  return out;
};

export function standingOp(w, actor, c, op, h) {
  const { fail, num } = h, state = governs(w, c, actor), staff = c.general === actor.id;
  switch (op.op) {
    case 'watch': {
      const list = (w.watches ||= []), target = op.target ? w.countries[op.target] : null, party = op.party ? c.parties.find(p => p.id === op.party || p.name.toLowerCase() === String(op.party).toLowerCase()) : null;
      const person = op.character ? (Object.hasOwn(w.characters, op.character) ? w.characters[op.character] : Object.values(w.characters).find(x => x.alive && x.name.toLowerCase() === String(op.character).toLowerCase())) : null, prov = op.province ? w.provinces[op.province] : null;
      const kind = person ? 'person' : party ? 'party' : prov ? 'province' : target ? 'frontier' : null, key = person?.id ?? party?.id ?? prov?.id ?? target?.id;
      if (!kind) return fail('Say who or what is to be watched: a person (character), a party (party), a province of ours (province), or the frontier with a state (target).');
      const had = list.findIndex(x => x.by === actor.id && x.kind === kind && x.key === key);
      if (op.lift === true || op.on === false) { if (had < 0) return fail('No such watch is being kept by you.'); list.splice(had, 1); return { ok: true, msg: `The watch on ${watchWords(w, { kind, key, country: c.id })} is taken off.` }; }
      if (had >= 0) return { ok: true, msg: `${watchWords(w, list[had])} is under watch already, since ${quarterLabel(list[had].since)}; the watch stands until you take it off.` };
      if (kind === 'person') {
        if (!person.alive || person.id === actor.id) return fail('No such person.');
        const here = person.country === c.id ? person.status !== 'exiled' : person.host === c.id;
        if (!here) return fail(`${person.name} is not within reach of anybody of ours who could watch: what happens abroad is the secret service's work (spy, recruit_informant).`);
      }
      if (kind === 'province' && !state) return fail('A province is watched by the police and the gendarmes, who answer to whoever governs.');
      if (kind === 'province' && prov.controller !== c.id) return fail('That province is not in our hands.');
      if (kind === 'frontier' && !state && !staff) return fail('The frontier is watched by the staff, for whoever governs or commands.');
      if (kind === 'frontier' && (!target?.alive || target.id === c.id)) return fail('No such state.');
      // The staff watches its own, officers and commanders; a chief of staff who wants anybody else watched hires men for it, as anyone may.
      // (World 19: a general's watch on a magnate was simply refused.)
      const ours = kind !== 'person' || ['officer', 'general'].includes(person.role) || Object.values(w.units).some(u => u.commander === person.id) || Object.values(w.fleets || {}).some(f => f.commander === person.id);
      const official = state || (staff && (kind === 'frontier' || (kind === 'person' && ours))), mine = list.filter(x => x.by === actor.id && x.kind === kind).length, room = official ? watchRoom(c)[kind] : PRIVATE_WATCH;
      if (mine >= room) return fail(official ? `The ${kind === 'frontier' ? 'staff' : 'police'} can keep ${room} such watches at one time and keep them already; take one off first.` : `Somebody without the police behind him can have ${room} people watched at a time, and you have that many.`);
      const fee = official ? 0 : Math.max(1, num(op.amount, 0, 20, 1)); if (!official && actor.wealth < fee) return fail(`Men who watch are paid: ${fee} a quarter, and you have not got it.`);
      list.push({ id: nextId(w, 'W'), by: actor.id, country: c.id, kind, key, state: official, fee, since: w.turn, ...(kind === 'frontier' ? { seen: round5(menFacing(w, c, target)) } : {}) });
      const what = kind === 'person' ? `What ${person.name} does in secret from now on is likely to be seen as it is done and laid in your file on ${person.name}; ${official ? 'letters to and from that door are opened where the law does not forbid it; ' : ''}if a circle gathers about that door you will hear of it. Somebody who is watched may come to notice it.`
        : kind === 'party' ? (official ? 'Each quarter you are told what its chest holds, how its organisation stands and who paid into it.' : 'Each quarter you are told what its chest holds and how its organisation stands; who pays into it only the police could see.')
        : kind === 'province' ? 'Each quarter you are told how the province stands and what moves under its surface.'
        : `The staff counts what stands across that frontier each quarter (about ${round5(menFacing(w, c, target))} thousand men now within a march of it) and tells you at once when the number changes much.`;
      return { ok: true, msg: `${watchWords(w, list.at(-1))} is under watch${official ? '' : `, at ${fee} a quarter from your purse${staff && kind === 'person' ? ' (the staff watches its own, officers and commanders; anybody else is for the police, or for men of your own hire, as these are)' : ''}`}. ${what} The watch stands until you take it off (watch with lift:true).` };
    }
    // A power of the ruler's left in another's hands: named operations, to a seat or to a person, until taken back.
    case 'delegate': {
      if (!state) return fail('Only whoever governs has powers to leave in another\'s hands.');
      const seat = ['general', 'opposition', 'oligarch'].includes(op.to) ? op.to : null, to = seat ? w.characters[c[seat]] : Object.hasOwn(w.characters, op.to ?? '') ? w.characters[op.to] : Object.values(w.characters).find(x => x.alive && x.country === c.id && x.name.toLowerCase() === String(op.to ?? '').toLowerCase());
      if (!to?.alive || to.id === actor.id || to.country !== c.id) return fail('Say whose hands: the chief of staff (to: "general"), or a person of this country by id or name.');
      const list = (c.delegations ||= []), at = list.findIndex(d => seat ? d.seat === seat : d.to === to.id);
      if (op.revoke === true) { if (at < 0) return fail(`Nothing is in ${to.name}'s hands that could be taken back.`); const d = list[at], gone = Array.isArray(op.powers) && op.powers.length ? op.powers.map(String) : d.ops; d.ops = d.ops.filter(x => !gone.includes(x)); if (!d.ops.length) list.splice(at, 1); say(w, to, c.name, `The government has taken back from you the power to order: ${gone.join(', ')}.`); return { ok: true, msg: `Taken back from ${to.name}: ${gone.join(', ')}.${d.ops.length ? ` Still in those hands: ${d.ops.join(', ')}.` : ''}` }; }
      const ops = [...new Set((Array.isArray(op.powers) ? op.powers : op.powers ? [op.powers] : []).map(x => String(x).trim()).filter(x => x && h.known(x) && !['delegate', 'designate_successor'].includes(x)))].slice(0, 12);
      if (!ops.length) return fail('Say which powers: the operations that person may order as his own (for the chief of staff, for instance: mobilize, demobilize, recruit, build).');
      if (at >= 0) list[at].ops = [...new Set([...list[at].ops, ...ops])]; else list.push({ ...(seat ? { seat } : { to: to.id }), ops, by: actor.id, since: w.turn });
      say(w, to, c.name, `${actor.name} leaves in your hands, to order as your own until it is taken back: ${ops.join(', ')}. What you do with it is done in the government's name.`);
      return { ok: true, msg: `${to.name}${seat ? ', and whoever holds that seat after,' : ''} may now order as ${his(to)} own: ${(at >= 0 ? list[at].ops : ops).join(', ')}. It is done in the government's name and paid for by the treasury; it stands until you take it back (delegate with revoke:true).` };
    }
    // An order that waits for its day.
    case 'standing_order': {
      const mine = (w.standingOrders ||= []).filter(x => x.by === actor.id); if (mine.length >= 8) return fail('Eight orders of yours are waiting for their day already; withdraw one first (cancel_order).');
      const k = normWhen(w, c, op.when); if (k.no) return fail(k.no);
      const then = (Array.isArray(op.then) ? op.then : op.then ? [op.then] : []).filter(o => o && typeof o === 'object' && (!STANDING_OPS.has(o.op) || (o.op === 'watch' && o.lift === true)) && h.known(o.op)).map(plainOp).slice(0, 16);
      // (World 21: "watch her for one quarter" was written as a watch and an order to lift it next quarter; the lifting was dropped as a standing matter.)
      if (!then.length) { const dropped = (Array.isArray(op.then) ? op.then : op.then ? [op.then] : []).filter(o => o && typeof o === 'object' && STANDING_OPS.has(o.op)).map(o => o.op); return fail(dropped.length ? `What was to be done on the day cannot be kept for a day: ${[...new Set(dropped)].join(', ')} ${dropped.length > 1 ? 'are standing matters themselves' : 'is a standing matter itself'} and is ordered on the day (a watch can be taken off on a day: watch with lift).` : 'Say what is to be done when the day comes: one or more operations (then).'); }
      const so = { id: nextId(w, 'SO'), by: actor.id, country: c.id, when: k.when, words: k.words, then, label: String(op.label ?? '').slice(0, 160), since: w.turn, again: op.again === true };
      w.standingOrders.push(so);
      // An order is given on its day with the powers its owner has that day. What is not his to order today is said today.
      const beyond = h.may ? [...new Set(then.map(o => o.op).filter(o => o !== 'report' && !h.may(o)))] : [];
      return { ok: true, msg: `Order ${so.id} is entered and waits: ${k.words}, ${then.map(o => o.op).join(', ')} will be ordered in your name the same quarter, as if you had given it that morning, and you are told what came of it. It lapses in five years, or when you withdraw it (cancel_order).${beyond.length ? ` Mark this: ${beyond.join(', ')} ${beyond.length > 1 ? 'are' : 'is'} not yours to order as things stand today, and on its day the order is given with the powers you hold that day. Unless whoever governs has left it in your hands by then (delegate), or gives it as his own, that part will be turned back.` : ''}` };
    }
    case 'cancel_order': { const list = w.standingOrders || [], i = list.findIndex(x => x.by === actor.id && (x.id === op.id || (op.id == null && list.filter(y => y.by === actor.id).length === 1))); if (i < 0) return fail(`No such order of yours is waiting.${list.some(x => x.by === actor.id) ? ` Waiting: ${list.filter(x => x.by === actor.id).map(x => x.id).join(', ')}.` : ''}`); const [so] = list.splice(i, 1); return { ok: true, msg: `Order ${so.id} is withdrawn.` }; }
  }
  return fail('Unknown standing matter.');
}

// The days an order can wait for, each of them something the engine itself knows to have happened.
const FORMS = 'attacked (somebody goes to war with us; by: a state, if only that one counts), mobilised (a named state, or with true any state on our frontier, calls up its reserve), war_on (somebody goes to war with a named state), troops (the men of a state in a named province rise above or fall below a number), treaty (a paper comes into force, or ends), peace (our war with a named state ends), ultimatum (a named state refuses our ultimatum or lets it run out), bill (a bill passes, or is rejected), lost (a province of ours falls into other hands), after (so many quarters), date (a quarter by its name, Q3 1903)';
function normWhen(w, c, raw) {
  const k = raw && typeof raw === 'object' ? raw : {}, st = id => w.countries[id]?.alive ? id : null;
  if (k.attacked) { const by = st(k.by); return { when: { attacked: true, ...(by ? { by } : {}) }, words: `the day ${by ? nameOf(w, by) : 'any state'} goes to war with us` }; }
  { const m = k.mobilised ?? k.mobilized; if (m) { const by = typeof m === 'string' ? st(m) : null; if (typeof m === 'string' && (!by || by === c.id)) return { no: `No such state to watch for a call-up: ${m}.` }; return { when: { mobilised: by ?? true }, words: by ? `the day ${nameOf(w, by)} calls up its reserve` : 'the day any state on our frontier calls up its reserve' }; } }
  if (k.war_on && st(k.war_on) && k.war_on !== c.id) { const by = st(k.by); return { when: { war_on: k.war_on, ...(by ? { by } : {}) }, words: `the day ${by ? nameOf(w, by) : 'any state'} goes to war with ${nameOf(w, k.war_on)}` }; }
  if (k.troops && w.provinces[k.troops.province]) { const p = w.provinces[k.troops.province], who = st(k.troops.country) ?? (p.controller !== c.id ? p.controller : null), above = Number(k.troops.above), below = Number(k.troops.below);
    if (!who) return { no: 'Say whose troops are to be counted there (country).' }; if (!(above >= 0) && !(below >= 0)) return { no: 'Say the number: above (so many thousand or more) or below (so many thousand or fewer).' };
    return { when: { troops: { province: p.id, country: who, ...(above >= 0 ? { above } : { below }) } }, words: `the day the troops of ${nameOf(w, who)} at ${p.name} ${above >= 0 ? `number ${above} thousand or more` : `are down to ${below} thousand or fewer`}, as far as the staff can count them` }; }
  // "If they refuse, we march": the day our ultimatum to a state is refused or runs out. (World 20: a ruler sent an ultimatum and ordered the
  // attack that was to follow it in the same breath, to be countermanded by his own hand if the other bent. The attack could not be entered
  // for want of a war, and he found out a quarter later.)
  if (k.ultimatum) { const to = st(typeof k.ultimatum === 'object' ? k.ultimatum.target ?? k.ultimatum.to : k.ultimatum), t = w.treaties.filter(x => x.pending && x.ultimatum && x.proposer === c.id && (!to || x.parties.includes(to))).at(-1);
    if (!t) return { no: `No ultimatum of ours${to ? ` to ${nameOf(w, to)}` : ''} is running: the ultimatum is sent first, and the order that waits on it after.` };
    const other = t.parties.find(id => id !== c.id); return { when: { treaty: t.id, state: 'ended' }, words: `the day ${nameOf(w, other)} refuses our ultimatum (${t.id}) or lets it run out` }; }
  if (k.treaty) { const id = String(k.treaty.id ?? k.treaty), t = w.treaties.find(x => x.id === id), ended = (k.treaty.state ?? k.state) === 'ended'; if (!t) return { no: `No such paper: ${id}.` }; return { when: { treaty: id, state: ended ? 'ended' : 'signed' }, words: `the day ${id} ${ended ? 'is no longer in force' : 'comes into force'}` }; }
  if (k.bill) { const id = String(k.bill.id ?? k.bill), b = aliveCountries(w).flatMap(o => o.bills || []).find(x => x.id === id), state = ['rejected', 'withdrawn'].includes(k.bill.state ?? k.state) ? (k.bill.state ?? k.state) : 'passed'; if (!b) return { no: `No such bill: ${id}.` }; return { when: { bill: id, state }, words: `the day bill ${id} is ${state}` }; }
  // "Once peace is signed, the reservists go home and the squadrons come in": the day our war with a state is over, whatever paper ends it.
  // (World 22: a ruler who signed a peace that morning ordered both for the day of the signature; the paper had no number yet that the order
  // could wait on, nothing was entered, and she gave the orders again a quarter later.)
  if (k.peace) { const foe = st(typeof k.peace === 'object' ? k.peace.with ?? k.peace.target : k.peace); if (!foe || foe === c.id) return { no: 'Say with which state the peace is waited for (peace: its id).' }; if (!atWar(w, c.id, foe)) return { no: `We are not at war with ${nameOf(w, foe)}: there is no peace to wait for, and what was to follow it can be ordered today.` }; return { when: { peace: foe }, words: `the day our war with ${nameOf(w, foe)} is over` }; }
  if (k.lost && w.provinces[k.lost]?.controller === c.id) return { when: { lost: k.lost }, words: `the day ${w.provinces[k.lost].name} falls into other hands` };
  // A date is a day like any other: "pay the note when it falls due in Q1 1902". (Four games running such orders came back "the office cannot
  // reckon how many quarters away that is": the count is the office's to make.)
  { const said = k.date ?? k.on ?? k.quarter, m = /^\s*Q([1-4])\s*(\d{4})\s*$/i.exec(String(said ?? '')); if (said != null) { if (!m) return { no: `Name the quarter as it is written on every paper (date: "Q3 1903").` }; const turn = (Number(m[2]) - 1900) * 4 + Number(m[1]) - 1; if (turn <= w.turn) return { no: `${quarterLabel(turn)} is ${turn === w.turn ? 'this quarter' : 'past'}: an order for today is given today.` }; if (turn - w.turn > 40) return { no: 'That is more than ten years off: no order waits so long.' }; return { when: { turn }, words: `in ${quarterLabel(turn)}` }; } }
  if (Number(k.after) >= 1) { const n = Math.min(40, Math.round(Number(k.after))); return { when: { turn: w.turn + n }, words: `in ${quarterLabel(w.turn + n)}` }; }
  return { no: `Say the day the order waits for (when), as one of: ${FORMS}.` };
}
const holds = (w, so) => { const c = w.countries[so.country], k = so.when, fresh = w.wars.filter(x => x.active && !x.civil && x.start >= so.since);
  if (k.attacked) return fresh.some(x => (x.b.includes(c.id) && (!k.by || x.a.includes(k.by))) || (x.a.includes(c.id) && k.by && x.b.includes(k.by) && false));
  // A call-up is known the day it is ordered: the order that waited for it is given in the same quarter.
  if (k.mobilised) { const who = k.mobilised === true ? [...new Set(Object.values(w.provinces).filter(p => p.controller === c.id).flatMap(p => p.neighbors.map(n => w.provinces[n].controller)))].filter(id => id && id !== c.id) : [k.mobilised]; return who.some(id => w.countries[id]?.alive && (w.countries[id].calledUpAt ?? -1) >= so.since); }
  if (k.war_on) return fresh.some(x => x.b.includes(k.war_on) && (!k.by || x.a.includes(k.by)));
  if (k.troops) { const men = sum(Object.values(w.units).filter(u => u.country === k.troops.country && u.province === k.troops.province), u => u.men); return k.troops.above != null ? men >= k.troops.above : men <= k.troops.below; }
  if (k.treaty) { const t = w.treaties.find(x => x.id === k.treaty); return k.state === 'ended' ? !!t && !t.active && !t.pending && t.withdrawn == null : !!t?.active; }
  if (k.bill) { const b = aliveCountries(w).flatMap(o => [...(o.bills || []), ...(o.laws || [])]).find(x => x.id === k.bill); return !!b && b.status === k.state; }
  if (k.peace) return !atWar(w, c.id, k.peace);
  if (k.lost) return w.provinces[k.lost]?.controller !== c.id;
  if (k.turn != null) return w.turn >= k.turn;
  return false; };
// Run once the quarter's orders are all in, before the world moves: an order whose day has come is given in its owner's name, with the powers he
// has that day, and he is told what came of it.
export function standingStep(w, apply, carry) {
  const list = w.standingOrders || []; if (!list.length) return;
  for (const so of [...list]) { const ch = w.characters[so.by], c = w.countries[so.country];
    if (!ch?.alive || !c?.alive || ch.status === 'imprisoned' || w.turn - so.since > 20) { list.splice(list.indexOf(so), 1); if (ch?.alive && c?.alive) say(w, ch, 'Your secretary', `Order ${so.id} (${so.words}) has lapsed unused.`); continue; }
    // An order that waited on a bill lapses with the bill.
    if (so.when.bill && so.when.state === 'passed') { const b = aliveCountries(w).flatMap(o => [...(o.bills || []), ...(o.laws || [])]).find(x => x.id === so.when.bill); if (!b || ['rejected', 'withdrawn', 'lapsed'].includes(b.status)) { list.splice(list.indexOf(so), 1); say(w, ch, 'Your secretary', `Order ${so.id}${so.label ? ` ("${so.label}")` : ''} has lapsed: bill ${so.when.bill} ${!b ? 'is no longer before the house' : `was ${b.status}`}, and what waited on its passing (${so.then.map(o => o.op).join(', ')}) was not ordered.`); continue; } }
    if (so.firedAt === w.turn || !holds(w, so)) continue;
    // The parts of the order that hang on one another are carried as they would be in a ruling: what was to follow the taking of a place waits
    // for the place, and what was ordered for the case of a refusal is ordered only on a refusal.
    // "Lay the accounts before me when the bill has passed": a report ordered for a day lies on the desk the morning after it.
    const one = o => { if (o?.op === 'report') { const topics = [...new Set([].concat(o.topic ?? o.topics ?? []).flatMap(t => String(t).split(/\s*[,;]\s*|\s+and\s+/)).map(t => t.trim()).filter(Boolean))].slice(0, 8); if (!topics.length) return { ok: false, msg: 'No matter was named for the report.' }; ch.reportsDue = [...new Set([...(ch.reportsDue || []), ...topics])].slice(0, 8); return { ok: true, msg: `Your people will lay it on your desk tomorrow morning: ${topics.join(', ')}.` }; }
      try { return apply(w, ch, o); } catch (e) { return { ok: false, msg: `Error: ${e.message}` }; } }, out = carry ? carry(w, ch, so.then.map(plainOp), one) : so.then.map(o => ({ op: o.op, ...one(plainOp(o)) }));
    const results = out.map(r => `${r.op}: ${r.ok === false ? 'NOT carried out: ' : ''}${r.msg ?? ''}`);
    say(w, ch, 'Your secretary', `Order ${so.id}${so.label ? ` ("${so.label}")` : ''} has come to its day (${so.words}) and was given in your name. ${results.join(' ')}`);
    (w.standingFired ||= []).push({ id: so.id, turn: w.turn, by: so.by, results });
    if (so.again) { so.firedAt = w.turn; so.since = w.turn + 1; } else list.splice(list.indexOf(so), 1); }
}

// What the watchers saw this quarter. Run at the end of the quarter, when everything that was done in it has been done.
export function watchStep(w) {
  for (const c of aliveCountries(w)) if (c.delegations?.length) { const gone = c.delegations.filter(d => !(d.by === c.leader || d.by === (c.regent ?? c.heir))); for (const d of gone) say(w, d.seat ? w.characters[c[d.seat]] : w.characters[d.to], c.name, `What ${w.characters[d.by]?.name ?? 'the former government'} left in your hands (${d.ops.join(', ')}) lapsed with the government that gave it.`); if (gone.length) c.delegations = c.delegations.filter(d => !gone.includes(d)); }
  const list = w.watches || []; if (!list.length) return;
  for (const x of [...list]) { const by = w.characters[x.by], c = w.countries[x.country], drop = why => { list.splice(list.indexOf(x), 1); if (by?.alive && why) say(w, by, 'The watch', why); };
    if (!by?.alive || !c?.alive || by.status === 'imprisoned') { drop(''); continue; }
    if (x.state && !(governs(w, c, by) || c.general === by.id)) { drop(`The watch on ${watchWords(w, x)} is no longer yours to keep: the men who kept it answer to the office, not to you.`); continue; }
    if (!x.state) { if (by.wealth < x.fee) { drop(`The men watching ${watchWords(w, x)} have gone home unpaid.`); continue; } by.wealth -= x.fee; }
    if (x.kind === 'person') { const t = w.characters[x.key]; if (!t?.alive) { drop(`${t?.name ?? 'The person you had watched'} is dead; the watch is at an end.`); continue; }
      const sight = watchSight(w, c, x, by, t), eye = sight.deeds, seen = (t.secrets || []).filter(s => s.turn === w.turn && !s.old && !s.published && rand(w) < eye).map(s => s.text);
      const circle = (w.plots || []).find(p => p.active && (p.leader === t.id || (p.members || []).includes(t.id))); if (circle && rand(w) < sight.circle) seen.push(`${circle.leader === t.id ? `Gathers people about ${him(t)} in secret and is at the head of something that is being prepared` : `Goes by night to meetings ${he(t)} tells nobody of: ${he(t)} belongs to something that is being prepared`} (seen by the watch in ${quarterLabel(w.turn)}).`);
      if (seen.length) { const file = by.dossiers[t.id] ||= { turn: w.turn, about: t.name, facts: [] }; file.turn = w.turn; file.facts = [...new Set([...file.facts, ...seen])].slice(-12); say(w, by, 'The watch', `On ${t.name} (${t.id}) this quarter: ${seen.join(' ')} It is in your file on ${t.name}.`); }
      // Once, when the watch is first kept on a man of the army with nobody of the government's inside it, whoever ordered it is told how little it will show.
      if (sight.wall && !x.warned) { x.warned = w.turn; say(w, by, 'The watch', `The police keep their watch on ${t.name} from the street: what passes in the mess and behind the barrack gates they see poorly. They would see as much as of anybody if the government had a man of its own among the officers.`); }
      if (!x.noticed && rand(w) < sight.noticed) { x.noticed = w.turn; say(w, t, 'Your household', 'You are being watched: the same men stand across the street day after day, and your letters come a day late. Whose men they are you can guess.'); }
    } else if (x.kind === 'party') { const p = c.parties.find(q => q.id === x.key); if (!p) { drop('The party you had watched is no more.'); continue; }
      const gifts = x.state ? (p.gifts || []).filter(g => g.turn === w.turn) : [], was = x.seen; x.seen = { funds: Math.round(p.funds ?? 0), org: Math.round(p.organization ?? 0) };
      if (!was || was.funds !== x.seen.funds || was.org !== x.seen.org || gifts.length) say(w, by, 'The watch', `The ${p.name} this quarter: ${x.seen.funds} in its chest${was ? ` (it was ${was.funds})` : ''}, its organisation at ${x.seen.org} of 100${gifts.length ? `; paid into it by ${gifts.map(g => `${w.characters[g.from]?.name ?? 'an unknown hand'} (${Math.round(g.amount)})`).join(', ')}` : x.state ? '; nobody was seen paying into it' : '; who pays into it hired men cannot see'}.`);
    } else if (x.kind === 'province') { const p = w.provinces[x.key]; if (!p || p.controller !== c.id) { drop(`${p?.name ?? 'The province'} is no longer in our hands; the watch there is at an end.`); continue; }
      const was = x.seen; x.seen = Math.round(p.unrest); if (was == null || Math.abs(was - x.seen) >= 4) say(w, by, 'The watch', `${p.name} (${p.id}): unrest stands at ${x.seen} of 100${was != null ? ` (it was ${was})` : ''}${p.unrest >= 55 ? '; it is close to rising' : ''}${(c.cells ?? 0) >= 25 ? '; the armed underground has men there' : ''}.`);
    } else { const o = w.countries[x.key]; if (!o?.alive) { drop(''); continue; } const now = round5(menFacing(w, c, o)), was = x.seen ?? now; x.seen = now;
      if (Math.abs(now - was) >= Math.max(10, was * .25)) for (const to of new Set([by, w.characters[c.leader], w.characters[c.general]])) { const text = `The watch on the frontier with ${o.name}: about ${now} thousand of their men now stand within a march of it; a quarter ago it was about ${was} thousand.`; if (!to?.inbox?.some(m => m.turn === w.turn && m.text === text)) say(w, to, 'General Staff', text); } } }
}
