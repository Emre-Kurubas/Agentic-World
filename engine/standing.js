// Standing matters: what a seat sets going once and which then goes on by itself. A watch kept on somebody, a power left in another's hands, an
// order that waits for its day.
//
// World 16 (twenty quarters, thirty-two played seats): "have the police watch him", "keep watching the Land Party", "tell me at once if their
// troops come within a march of the frontier" were ordered about twenty-five times and had no operation (the referee wrote gather_dossier, which
// found nothing forty-three times in seventy-six, or spy, which failed half the time and cost money); "if they cross the frontier the chief of
// staff may call up the reserve without waiting for me" and "once their columns have left the pass, send the reservists home" about thirty-five
// times, and nothing in the engine could hold an order for its day or put a ruler's power in another's hands.
import { clamp, rand, news, nextId, quarterLabel } from './util.js';
import { aliveCountries } from './world.js';
import { governs } from './polity.js';
import { he, him } from './names.js';

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
export const watchedIn = (w, countryId, personId) => (w.watches || []).some(x => x.kind === 'person' && x.state && x.country === countryId && x.key === personId);
const menFacing = (w, c, o) => { const ours = new Set(Object.values(w.provinces).filter(p => p.controller === c.id).map(p => p.id)); return sum(Object.values(w.units).filter(u => u.country === o.id && w.provinces[u.province]?.controller === o.id && w.provinces[u.province].neighbors.some(n => ours.has(n))), u => u.men); };
const watchWords = (w, x) => x.kind === 'person' ? `${w.characters[x.key]?.name ?? x.key} (${x.key})` : x.kind === 'party' ? `the ${w.countries[x.country]?.parties.find(p => p.id === x.key)?.name ?? x.key}` : x.kind === 'province' ? `${w.provinces[x.key]?.name ?? x.key}` : `the frontier with ${nameOf(w, x.key)}`;
export const standingWords = (w, ch) => {
  const out = [], mine = watchesOf(w, ch); if (mine.length) out.push(`Kept under watch: ${mine.map(x => watchWords(w, x)).join(', ')}.`);
  const c = w.countries[ch.country];
  for (const d of c?.delegations || []) { const to = d.seat ? w.characters[c[d.seat]] : w.characters[d.to]; if (d.by === ch.id || governs(w, c, ch)) out.push(`Left in the hands of ${to?.name ?? d.seat ?? d.to}: ${d.ops.join(', ')}.`); else if (to?.id === ch.id) out.push(`Left in your hands by ${w.characters[d.by]?.name ?? 'the government'}, to order as your own: ${d.ops.join(', ')}.`); }
  for (const so of (w.standingOrders || []).filter(x => x.by === ch.id)) out.push(`Order ${so.id}, waiting: ${so.words}, then ${so.then.map(o => o.op).join(', ')}${so.label ? ` ("${so.label}")` : ''}.`);
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
        if (staff && !state && !['officer', 'general'].includes(person.role) && !Object.values(w.units).some(u => u.commander === person.id)) return fail('The staff watches its own: officers and commanders. Anybody else is for the police, which answer to whoever governs.');
      }
      if (kind === 'province' && !state) return fail('A province is watched by the police and the gendarmes, who answer to whoever governs.');
      if (kind === 'province' && prov.controller !== c.id) return fail('That province is not in our hands.');
      if (kind === 'frontier' && !state && !staff) return fail('The frontier is watched by the staff, for whoever governs or commands.');
      if (kind === 'frontier' && (!target?.alive || target.id === c.id)) return fail('No such state.');
      const official = state || (staff && (kind === 'frontier' || kind === 'person')), mine = list.filter(x => x.by === actor.id && x.kind === kind).length, room = official ? watchRoom(c)[kind] : PRIVATE_WATCH;
      if (mine >= room) return fail(official ? `The ${kind === 'frontier' ? 'staff' : 'police'} can keep ${room} such watches at one time and keep them already; take one off first.` : `Somebody without the police behind him can have ${room} people watched at a time, and you have that many.`);
      const fee = official ? 0 : Math.max(1, num(op.amount, 0, 20, 1)); if (!official && actor.wealth < fee) return fail(`Men who watch are paid: ${fee} a quarter, and you have not got it.`);
      list.push({ id: nextId(w, 'W'), by: actor.id, country: c.id, kind, key, state: official, fee, since: w.turn, ...(kind === 'frontier' ? { seen: round5(menFacing(w, c, target)) } : {}) });
      const what = kind === 'person' ? `What ${person.name} does in secret from now on is likely to be seen as it is done and laid in your file on ${person.name}; ${official ? 'letters to and from that door are opened where the law does not forbid it; ' : ''}if a circle gathers about that door you will hear of it. Somebody who is watched may come to notice it.`
        : kind === 'party' ? (official ? 'Each quarter you are told what its chest holds, how its organisation stands and who paid into it.' : 'Each quarter you are told what its chest holds and how its organisation stands; who pays into it only the police could see.')
        : kind === 'province' ? 'Each quarter you are told how the province stands and what moves under its surface.'
        : `The staff counts what stands across that frontier each quarter (about ${round5(menFacing(w, c, target))} thousand men now within a march of it) and tells you at once when the number changes much.`;
      return { ok: true, msg: `${watchWords(w, list.at(-1))} is under watch${official ? '' : `, at ${fee} a quarter from your purse`}. ${what} The watch stands until you take it off (watch with lift:true).` };
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
      return { ok: true, msg: `${to.name}${seat ? ', and whoever holds that seat after,' : ''} may now order as his own: ${(at >= 0 ? list[at].ops : ops).join(', ')}. It is done in the government's name and paid for by the treasury; it stands until you take it back (delegate with revoke:true).` };
    }
    // An order that waits for its day.
    case 'standing_order': {
      const mine = (w.standingOrders ||= []).filter(x => x.by === actor.id); if (mine.length >= 8) return fail('Eight orders of yours are waiting for their day already; withdraw one first (cancel_order).');
      const k = normWhen(w, c, op.when); if (k.no) return fail(k.no);
      const then = (Array.isArray(op.then) ? op.then : op.then ? [op.then] : []).filter(o => o && typeof o === 'object' && !STANDING_OPS.has(o.op) && h.known(o.op)).map(plainOp).slice(0, 6);
      if (!then.length) return fail('Say what is to be done when the day comes: one or more operations (then).');
      const so = { id: nextId(w, 'SO'), by: actor.id, country: c.id, when: k.when, words: k.words, then, label: String(op.label ?? '').slice(0, 160), since: w.turn, again: op.again === true };
      w.standingOrders.push(so);
      return { ok: true, msg: `Order ${so.id} is entered and waits: ${k.words}, ${then.map(o => o.op).join(', ')} will be ordered in your name the same quarter, as if you had given it that morning, and you are told what came of it. It lapses in five years, or when you withdraw it (cancel_order).` };
    }
    case 'cancel_order': { const list = w.standingOrders || [], i = list.findIndex(x => x.by === actor.id && (x.id === op.id || (op.id == null && list.filter(y => y.by === actor.id).length === 1))); if (i < 0) return fail(`No such order of yours is waiting.${list.some(x => x.by === actor.id) ? ` Waiting: ${list.filter(x => x.by === actor.id).map(x => x.id).join(', ')}.` : ''}`); const [so] = list.splice(i, 1); return { ok: true, msg: `Order ${so.id} is withdrawn.` }; }
  }
  return fail('Unknown standing matter.');
}

// The days an order can wait for, each of them something the engine itself knows to have happened.
const FORMS = 'attacked (somebody goes to war with us; by: a state, if only that one counts), war_on (somebody goes to war with a named state), troops (the men of a state in a named province rise above or fall below a number), treaty (a paper comes into force, or ends), bill (a bill passes, or is rejected), lost (a province of ours falls into other hands), after (so many quarters)';
function normWhen(w, c, raw) {
  const k = raw && typeof raw === 'object' ? raw : {}, st = id => w.countries[id]?.alive ? id : null;
  if (k.attacked) { const by = st(k.by); return { when: { attacked: true, ...(by ? { by } : {}) }, words: `the day ${by ? nameOf(w, by) : 'any state'} goes to war with us` }; }
  if (k.war_on && st(k.war_on) && k.war_on !== c.id) { const by = st(k.by); return { when: { war_on: k.war_on, ...(by ? { by } : {}) }, words: `the day ${by ? nameOf(w, by) : 'any state'} goes to war with ${nameOf(w, k.war_on)}` }; }
  if (k.troops && w.provinces[k.troops.province]) { const p = w.provinces[k.troops.province], who = st(k.troops.country) ?? (p.controller !== c.id ? p.controller : null), above = Number(k.troops.above), below = Number(k.troops.below);
    if (!who) return { no: 'Say whose troops are to be counted there (country).' }; if (!(above >= 0) && !(below >= 0)) return { no: 'Say the number: above (so many thousand or more) or below (so many thousand or fewer).' };
    return { when: { troops: { province: p.id, country: who, ...(above >= 0 ? { above } : { below }) } }, words: `the day the troops of ${nameOf(w, who)} at ${p.name} ${above >= 0 ? `number ${above} thousand or more` : `are down to ${below} thousand or fewer`}, as far as the staff can count them` }; }
  if (k.treaty) { const id = String(k.treaty.id ?? k.treaty), t = w.treaties.find(x => x.id === id), ended = (k.treaty.state ?? k.state) === 'ended'; if (!t) return { no: `No such paper: ${id}.` }; return { when: { treaty: id, state: ended ? 'ended' : 'signed' }, words: `the day ${id} ${ended ? 'is no longer in force' : 'comes into force'}` }; }
  if (k.bill) { const id = String(k.bill.id ?? k.bill), b = aliveCountries(w).flatMap(o => o.bills || []).find(x => x.id === id), state = ['rejected', 'withdrawn'].includes(k.bill.state ?? k.state) ? (k.bill.state ?? k.state) : 'passed'; if (!b) return { no: `No such bill: ${id}.` }; return { when: { bill: id, state }, words: `the day bill ${id} is ${state}` }; }
  if (k.lost && w.provinces[k.lost]?.controller === c.id) return { when: { lost: k.lost }, words: `the day ${w.provinces[k.lost].name} falls into other hands` };
  if (Number(k.after) >= 1) { const n = Math.min(40, Math.round(Number(k.after))); return { when: { turn: w.turn + n }, words: `in ${quarterLabel(w.turn + n)}` }; }
  return { no: `Say the day the order waits for (when), as one of: ${FORMS}.` };
}
const holds = (w, so) => { const c = w.countries[so.country], k = so.when, fresh = w.wars.filter(x => x.active && !x.civil && x.start >= so.since);
  if (k.attacked) return fresh.some(x => (x.b.includes(c.id) && (!k.by || x.a.includes(k.by))) || (x.a.includes(c.id) && k.by && x.b.includes(k.by) && false));
  if (k.war_on) return fresh.some(x => x.b.includes(k.war_on) && (!k.by || x.a.includes(k.by)));
  if (k.troops) { const men = sum(Object.values(w.units).filter(u => u.country === k.troops.country && u.province === k.troops.province), u => u.men); return k.troops.above != null ? men >= k.troops.above : men <= k.troops.below; }
  if (k.treaty) { const t = w.treaties.find(x => x.id === k.treaty); return k.state === 'ended' ? !!t && !t.active && !t.pending : !!t?.active; }
  if (k.bill) { const b = aliveCountries(w).flatMap(o => [...(o.bills || []), ...(o.laws || [])]).find(x => x.id === k.bill); return !!b && b.status === k.state; }
  if (k.lost) return w.provinces[k.lost]?.controller !== c.id;
  if (k.turn != null) return w.turn >= k.turn;
  return false; };
// Run once the quarter's orders are all in, before the world moves: an order whose day has come is given in its owner's name, with the powers he
// has that day, and he is told what came of it.
export function standingStep(w, apply) {
  const list = w.standingOrders || []; if (!list.length) return;
  for (const so of [...list]) { const ch = w.characters[so.by], c = w.countries[so.country];
    if (!ch?.alive || !c?.alive || ch.status === 'imprisoned' || w.turn - so.since > 20) { list.splice(list.indexOf(so), 1); if (ch?.alive && c?.alive) say(w, ch, 'Your secretary', `Order ${so.id} (${so.words}) has lapsed unused.`); continue; }
    if (so.firedAt === w.turn || !holds(w, so)) continue;
    const results = so.then.map(o => { let r; try { r = apply(w, ch, plainOp(o)); } catch (e) { r = { ok: false, msg: `Error: ${e.message}` }; } return `${o.op}: ${r.ok === false ? 'NOT carried out: ' : ''}${r.msg ?? ''}`; });
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
      const eye = x.state ? clamp(.35 + (c.police ?? 40) / 200, .3, .85) : .3, seen = (t.secrets || []).filter(s => s.turn === w.turn && !s.old && !s.published && rand(w) < eye).map(s => s.text);
      const circle = (w.plots || []).find(p => p.active && (p.leader === t.id || (p.members || []).includes(t.id))); if (circle && rand(w) < (x.state ? clamp(.2 + (c.police ?? 40) / 300, .2, .5) : .12)) seen.push(`${circle.leader === t.id ? `Gathers people about ${him(t)} in secret and is at the head of something that is being prepared` : `Goes by night to meetings ${he(t)} tells nobody of: ${he(t)} belongs to something that is being prepared`} (seen by the watch in ${quarterLabel(w.turn)}).`);
      if (seen.length) { const file = by.dossiers[t.id] ||= { turn: w.turn, about: t.name, facts: [] }; file.turn = w.turn; file.facts = [...new Set([...file.facts, ...seen])].slice(-12); say(w, by, 'The watch', `On ${t.name} (${t.id}) this quarter: ${seen.join(' ')} It is in your file on ${t.name}.`); }
      if (!x.noticed && rand(w) < clamp(.08 + t.power / 500 - (x.state ? (c.police ?? 40) / 500 : 0), .03, .3)) { x.noticed = w.turn; say(w, t, 'Your household', 'You are being watched: the same men stand across the street day after day, and your letters come a day late. Whose men they are you can guess.'); }
    } else if (x.kind === 'party') { const p = c.parties.find(q => q.id === x.key); if (!p) { drop('The party you had watched is no more.'); continue; }
      const gifts = x.state ? (p.gifts || []).filter(g => g.turn === w.turn) : [], was = x.seen; x.seen = { funds: Math.round(p.funds ?? 0), org: Math.round(p.organization ?? 0) };
      if (!was || was.funds !== x.seen.funds || was.org !== x.seen.org || gifts.length) say(w, by, 'The watch', `The ${p.name} this quarter: ${x.seen.funds} in its chest${was ? ` (it was ${was.funds})` : ''}, its organisation at ${x.seen.org} of 100${gifts.length ? `; paid into it by ${gifts.map(g => `${w.characters[g.from]?.name ?? 'an unknown hand'} (${Math.round(g.amount)})`).join(', ')}` : x.state ? '; nobody was seen paying into it' : '; who pays into it hired men cannot see'}.`);
    } else if (x.kind === 'province') { const p = w.provinces[x.key]; if (!p || p.controller !== c.id) { drop(`${p?.name ?? 'The province'} is no longer in our hands; the watch there is at an end.`); continue; }
      const was = x.seen; x.seen = Math.round(p.unrest); if (was == null || Math.abs(was - x.seen) >= 4) say(w, by, 'The watch', `${p.name} (${p.id}): unrest stands at ${x.seen} of 100${was != null ? ` (it was ${was})` : ''}${p.unrest >= 55 ? '; it is close to rising' : ''}${(c.cells ?? 0) >= 25 ? '; the armed underground has men there' : ''}.`);
    } else { const o = w.countries[x.key]; if (!o?.alive) { drop(''); continue; } const now = round5(menFacing(w, c, o)), was = x.seen ?? now; x.seen = now;
      if (Math.abs(now - was) >= Math.max(10, was * .25)) for (const to of new Set([by, w.characters[c.leader], w.characters[c.general]])) say(w, to, 'General Staff', `The watch on the frontier with ${o.name}: about ${now} thousand of their men now stand within a march of it; a quarter ago it was about ${was} thousand.`); } }
}
