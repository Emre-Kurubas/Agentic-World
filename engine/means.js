// The smaller means of a seat: money given to people who have no name in the books, a province let off its tax, a party's dues, a note of
// protest, a clerk moved to another desk, a paper burned.
//
// World 16: "pay the families of the 213 dead a year's wage" ("no operation pays private money to unnamed families"), "seed grain and a year's
// remission of the land tax for the drought-struck province", "open a parish penny for the party", "a formal note of protest", "transfer the
// clerk off the general staff", "burn the oldest pages of the ledger" were each ordered a dozen times or more, and each was words.
import { clamp, rand, news, quarterLabel } from './util.js';
import { provincePop, countryProvinces, atWar, ROLES } from './world.js';
import { governs, leadsParties } from './polity.js';
import { handsOf, isOpen } from './firms.js';
import { he, his } from './names.js';
const cap = s => s[0].toUpperCase() + s.slice(1);

export const MEANS_OPS = new Set(['relief', 'relieve_province', 'set_dues', 'note', 'post_person', 'destroy_evidence']);
const say = (w, ch, from, text) => { if (ch?.alive) ch.inbox.push({ turn: w.turn, from, text }); };
const own = (o, k) => !!o && typeof k === 'string' && Object.hasOwn(o, k);
const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0), r1 = v => Math.round(v * 10) / 10, n = v => Math.round(v);
const peopleOf = (w, c) => Math.max(sum(countryProvinces(w, c.id), provincePop), 1);
// What a thousand people of the country earn in a quarter: the measure of what a sum of relief is to those who get it.
const perThousand = (w, c) => Math.max(c.gdp, 1) / peopleOf(w, c);
// What a party's dues bring in a quarter: from its following, as far as it has an organisation to collect them.
// What dues bring in. The rate is the share of what its people earn that the party asks of them; the more is asked the fewer pay (about four in
// the hundred brings the most), and it takes an organisation to collect them at all. (World 17: fourteen party leaders set dues at two to five
// in the hundred and every one of them was told "about 0 a quarter": the rate was read as a share of some unseen maximum.)
export const duesOf = (c, p) => { const rate = clamp(p.dues || 0, 0, .25); return rate / (1 + (rate / .04) ** 2) * (p.support || 0) / 100 * Math.max(c.gdp, 1) * .06 * (.2 + (p.organization || 0) / 75); };
// What forgiving a share of a province's land tax costs the treasury in a quarter.
const remitCost = (w, c, p, share) => { const all = Math.max(sum(countryProvinces(w, c.id), q => q.pops.peasants?.n || 0), 1); return (c.lastBooks?.land ?? c.gdp * .01) * (p.pops.peasants?.n || 0) / all * share; };

export function meansOp(w, actor, c, op, h) {
  const { fail, num, target } = h, state = governs(w, c, actor);
  switch (op.op) {
    // Money for people nobody names: the men of a works and the families of its dead, or the people of a province.
    case 'relief': {
      const f = own(w.firms, op.to) ? w.firms[op.to] : null, p = f ? w.provinces[f.province] : own(w.provinces, op.to) ? w.provinces[op.to] : null, home = p && w.countries[p.controller];
      if (!p || !home?.alive) return fail('Say whom it is for (to): the men of a works and the families of its dead (the works\' id), or the people of a province (its id). Money for one named person is give; money for a whole class of the country is the government\'s concession.');
      // With no sum named, what is customary is given: about a tenth of what the hands of a works earn in a quarter, or a hundredth of what the
      // people of a province earn. ("Pay compensation to the families of the dead" names no figure, and is not for that an order to do nothing.)
      const named = op.amount != null && op.amount !== '', usual = f ? Math.max(handsOf(w, f), .2) * perThousand(w, home) * .1 : provincePop(p) * perThousand(w, home) * .01, amount = named ? num(op.amount, 0, 1e6, 0) : Math.max(.5, Math.round(usual * 10) / 10); if (!(amount >= .5)) return fail('Say how much is given (amount).');
      const src = String(op.from ?? 'own'), party = leadsParties(w, c, actor)[0]; let paid = 0, from = '';
      if (src === 'treasury') { if (!state) return fail('The treasury pays on the order of whoever governs; anybody else gives from his own purse, his company\'s till (from: the works\' id) or his party\'s chest (from: "party").'); const note = h.pay(amount, 'relief'); if (note === null) return fail('The treasury cannot find the money.'); paid = amount; from = 'the treasury'; }
      else if (src === 'party') { if (!party) return fail('You lead no party whose chest you could open.'); paid = Math.min(amount, Math.max(party.funds || 0, 0)); if (paid < .5) return fail(`The chest of the ${party.name} is empty.`); party.funds -= paid; from = `the chest of the ${party.name}`; }
      else if (src === 'company' || own(w.firms, src)) { const g = src === 'company' ? (f?.owner === actor.id ? f : Object.values(w.firms).find(x => x.owner === actor.id && isOpen(x))) : w.firms[src]; if (!g || g.owner !== actor.id) return fail('That company\'s till is not yours to open.'); paid = Math.min(amount, Math.max(g.cash, 0)); if (paid < .5) return fail(`${g.name} has no cash to give.`); g.cash -= paid; from = `the till of ${g.name}`; }
      else { paid = Math.min(amount, Math.max(actor.wealth, 0)); if (paid < .5) return fail('You have not got it.'); actor.wealth -= paid; from = 'your own purse'; }
      const each = perThousand(w, home); let did;
      if (f) { const hands = Math.max(handsOf(w, f), .2), share = paid / (hands * each), was = f.temper ?? 30, drop = h.allowance(home, `relief:${f.id}`, 25, clamp(share * 120, 0, 25)); f.temper = clamp(was - drop, 0, 100); p.unrest = clamp(p.unrest - Math.min(2, share * 20), 0, 100);
        did = `It came to about ${n(share * 100)} in the hundred of what the hands of ${f.name} earn in a quarter. Their temper stands at ${n(f.temper)} of 100 (it was ${n(was)})${drop < share * 120 - .5 && drop < 24.5 ? '; money given twice in one quarter buys little more' : ''}.`; }
      else { const share = paid / (provincePop(p) * each), was = p.unrest, drop = h.allowance(home, `relief:${p.id}`, 8, clamp(share * 300, 0, 8)); p.unrest = clamp(was - drop, 0, 100);
        // What a giver learns of a province not his own state's is what anybody there can see, not the figure its governor keeps.
        did = `It came to about ${r1(share * 100)} in the hundred of what the people of ${p.name} earn in a quarter. ${p.controller === c.id ? `Unrest there stands at ${n(p.unrest)} of 100 (it was ${n(was)}).` : drop >= .5 ? 'It is said to have been felt there.' : 'Whether so little was felt there nobody can say.'}`; }
      // Whoever gave it is remembered for it where it was given.
      if (src === 'party' && party) party.support = clamp((party.support || 0) + Math.min(1.5, paid / Math.max(c.gdp, 1) * 400), 0, 100);
      return { ok: true, msg: `${r1(paid)} was paid out of ${from} to ${f ? `the men of ${f.name} and the families of its dead` : `the people of ${p.name}`}${named ? '' : ` (no sum was named: what is customary was given, about ${f ? 'a tenth of what its hands earn in a quarter' : 'a hundredth of what its people earn in a quarter'})`}. ${did}` };
    }
    // A province let off its land tax for a time, or sent grain from the state's stores.
    case 'relieve_province': {
      if (!state) return fail('Taxes are remitted and the state\'s stores opened by whoever governs. Anybody else can give money (relief).');
      const p = own(w.provinces, op.province) ? w.provinces[op.province] : null; if (!p || p.controller !== c.id) return fail('That province is not in our hands.');
      const share = op.remit != null ? num(op.remit, 0, 1, .5) : 0, quarters = Math.round(num(op.quarters, 1, 8, 4)), grain = num(op.grain, 0, 1e6, 0), notes = [];
      // "Two quarters more": a remission that is running is lengthened without being said over again.
      const more = op.remit == null && op.quarters != null && !!p.remit && op.end !== true;
      if (more) { p.remit.until = Math.min(w.turn + 8, Math.max(p.remit.until, w.turn) + quarters); notes.push(`The remission at ${p.name} (${n(p.remit.share * 100)} in the hundred of its land tax, about ${r1(remitCost(w, c, p, p.remit.share))} a quarter to the treasury) now runs until ${quarterLabel(p.remit.until)}`); }
      if (!(share > 0) && !(grain > 0) && op.end !== true && !more) return fail('Say what the province is given: its land tax remitted (remit: the share forgiven, 0 to 1; quarters: for how long, up to eight) or grain from the state\'s stores (grain).');
      if (op.end === true && p.remit) { delete p.remit; notes.push(`The remission at ${p.name} is ended`); }
      if (share > 0) { p.remit = { share, until: w.turn + quarters, by: actor.id }; notes.push(`${n(share * 100)} in the hundred of the land tax of ${p.name} is forgiven until ${quarterLabel(w.turn + quarters)}: it costs the treasury about ${r1(remitCost(w, c, p, share))} a quarter, and the province grows quieter while it lasts`); }
      if (grain > 0) { const g = Math.min(grain, c.stock.grain || 0); if (g < .05) notes.push('there is no grain in the state\'s stores to send'); else { c.stock.grain -= g; const need = Math.max((c._need?.grain || peopleOf(w, c) * .01) * provincePop(p) / peopleOf(w, c), .01), was = p.unrest, drop = h.allowance(c, `grain:${p.id}`, 8, clamp(g / need * 10 * ((c.foodRatio ?? 1) < 1 ? 1.5 : 1), 0, 8)); p.unrest = clamp(was - drop, 0, 100); notes.push(`${r1(g)} of grain went to ${p.name} from the state's stores, ${g / need >= 1.5 ? `about ${r1(g / need)} quarters' bread for the province` : `about ${n(g / need * 100)} in the hundred of what it eats in a quarter`}; unrest there stands at ${n(p.unrest)} of 100 (it was ${n(was)})`); } }
      return { ok: true, msg: `${notes.join('. ')}.` };
    }
    // A party lives on what its members pay, if it asks them.
    case 'set_dues': { const p = leadsParties(w, c, actor)[0]; if (!p) return fail('You lead no party.'); p.dues = num(op.rate, 0, .25, .02);
      return { ok: true, msg: p.dues > 0 ? `The ${p.name} collects dues from its following, ${r1(p.dues * 100)} in the hundred of what its people earn: about ${r1(duesOf(c, p))} a quarter as it stands. A larger following and an organisation to collect them bring more; asked for more, fewer pay. It stands until changed.` : `The ${p.name} collects no dues.` }; }
    // A formal note of protest: the least a government can do, and something.
    case 'note': {
      if (!state) return fail('Notes between governments are sent by whoever governs.'); if (!target) return fail('Say which government the note is for (target).'); if (atWar(w, c.id, target.id)) return fail('Governments at war exchange no notes.');
      const text = String(op.text ?? '').slice(0, 600), first = h.allowance(c, `note:${target.id}`, 1, 1) > 0; (c.noted ||= {})[target.id] = w.turn;
      if (first) target.relations[c.id] = clamp((target.relations[c.id] ?? 0) - 2, -100, 100);
      say(w, w.characters[target.leader], 'Foreign Ministry', `A note from the government of ${c.name}${text ? `: "${text}"` : ', protesting in form'}.`);
      if (op.public !== false) news(w, `${c.name} has sent ${target.name} a note of protest${text ? `: "${text.slice(0, 220)}"` : ''}.`, { kind: 'diplomacy', countries: [c.id, target.id] });
      return { ok: true, msg: `The note is ${first ? 'delivered' : 'delivered; a second note in one quarter says no more than the first'}${op.public === false ? ', without publication' : ' and published'}. It commits us to nothing; at home it answers a little, for a year, of what the country holds against ${target.name}.` };
    }
    // A servant of the state moved to another desk, raised, or sent away.
    case 'post_person': {
      const staff = c.general === actor.id; if (!state && !staff) return fail('Posts in the state\'s service are filled by whoever governs, and posts on the general staff by its chief.');
      const ch = h.personFor(w, c, op, 'official'); if (!ch?.alive || ch.country !== c.id || ch.status !== 'free') return fail(h.noPerson('No such person in the state\'s service.')); if (ROLES.some(r => c[r] === ch.id)) return fail(`${ch.name} holds a seat of ${his(ch)} own, and is dismissed or appointed, not posted.`);
      const office = String(op.office ?? '').trim().toLowerCase(), was = ch.post ?? ch.clerkOf ?? (ch.office ? 'office' : null), out = op.dismiss === true || office === 'none';
      if (!state && !out && office !== 'staff') return fail('The chief of staff posts officers to his own staff and off it; other offices are the government\'s to fill.'); if (!state && out && ch.clerkOf !== 'army' && ch.role !== 'officer') return fail(`${ch.name} is not on the general staff.`);
      if (['treasury', 'police'].includes(office)) return fail('The keeper of the treasury and the chief of police are appointed as such (appoint_minister).'); if (office === 'governor') return fail('A governor is appointed as such (appoint_governor).');
      if (!out && !office) return fail('Say where he is posted (office): staff (the general staff), customs, or any office by its name; or that he is dismissed (dismiss:true).');
      if (ch.post) ch.post = null; const sawArmy = ch.clerkOf === 'army', sawMoney = ch.clerkOf === 'treasury' || was === 'treasury';
      if (out) { delete ch.clerkOf; delete ch.office; ch.loyalty = clamp(ch.loyalty - 15, 0, 100); say(w, ch, c.name, `You are relieved of your post${op.reason ? `: ${String(op.reason).slice(0, 200)}` : ''}.`);
        return { ok: true, msg: `${ch.name} (${ch.id}) is out of the state's service and resents it. ${cap(he(ch))} sees nothing more of what passed over ${his(ch)} desk${ch.handler ? `; whoever ${he(ch)} reported to in secret hears nothing more from that desk` : ''}; what ${he(ch)} knows already ${he(ch)} still knows.` }; }
      const place = own(w.provinces, op.province) && w.provinces[op.province].controller === c.id ? ` at ${w.provinces[op.province].name}` : '';
      if (office === 'staff') { ch.clerkOf = 'army'; ch.office = String(op.title ?? 'a post on the general staff').slice(0, 80); } else if (office === 'customs') { ch.clerkOf = 'treasury'; ch.office = String(op.title ?? `a collector's post in the customs${place}`).slice(0, 80); } else { delete ch.clerkOf; ch.office = String(op.title ?? `${op.office}${place}`).slice(0, 80); }
      const up = op.promote === true; ch.loyalty = clamp(ch.loyalty + (up ? 8 : was && !ch.clerkOf ? -4 : 2), 0, 100); if (up) ch.power = clamp((ch.power ?? 20) + 4, 0, 60);
      say(w, ch, c.name, `You are posted to ${ch.office}${up ? ', with promotion' : ''}.`);
      return { ok: true, msg: `${ch.name} (${ch.id}) now holds ${ch.office}${up ? ' and has been raised for it' : ''}. ${ch.clerkOf === 'army' ? `${cap(he(ch))} sees what passes through the general staff.` : ch.clerkOf === 'treasury' ? `${cap(he(ch))} sees what passes through the treasury's hands.` : `${cap(he(ch))} sees no longer what passed over ${his(ch)} old desk${sawArmy ? ' on the general staff' : sawMoney ? ' in the treasury' : ''}.`}` };
    }
    // Papers burned, a ledger rewritten: what was done stays done, but less of it is there to be found.
    case 'destroy_evidence': {
      // What is to go is named in the person's own words; the traces the world keeps are in the engine's. A trace belongs to the order if it shares
      // a year or a word of substance with it. (World 17: twelve orders of twelve were refused, because "the 1896 pay-roll ledgers" matched no
      // trace word for word. Most of them were about a past the person had written for himself, of which the world holds no trace at all: nobody
      // can ever find that, so the truthful answer is that it is gone, not that it could not be burned.)
      const open = (actor.secrets || []).filter(s => !s.published), words = String(op.about ?? '').toLowerCase().match(/\b\d{4}\b|[a-z]{5,}/g) ?? [], dull = new Set(['about', 'paper', 'papers', 'ledger', 'ledgers', 'letters', 'entries', 'entry', 'archive', 'archives', 'records', 'record', 'evidence', 'whatever', 'remains', 'touching', 'anything', 'still', 'which', 'their', 'there', 'trace', 'traces', 'destroy', 'burned']);
      const keys = words.filter(x => !dull.has(x)), mine = (op.about ? open.filter(s => keys.some(k => s.text.toLowerCase().includes(k))) : open).slice(-4);
      if (!mine.length) return op.about ? { ok: true, msg: `It is burned. Of that matter nothing is on paper any longer that an inquiry, a dossier or a newspaper could turn up.${open.length ? ` ${open.length} other matter${open.length > 1 ? 's' : ''} of yours can still be found (my_secrets says which); naming ${open.length > 1 ? 'one of them' : 'it'}, or naming nothing, sends ${open.length > 1 ? 'them' : 'it'} to the stove as well.` : ''}` } : fail('There is nothing of yours on paper that could be destroyed.');
      if (h.allowance(actor, 'burn', 1, 1) <= 0) return fail('The stove has been lit once this quarter; twice would be noticed.');
      const copied = text => Object.values(w.characters).some(x => x.alive && x.id !== actor.id && (x.dossiers?.[actor.id]?.facts || []).includes(text)), gone = [], held = [], seen = [];
      for (const s of mine) { if (copied(s.text)) held.push(s); else if (rand(w) < (s.old ? .85 : .65)) gone.push(s); else seen.push(s); }
      actor.secrets = actor.secrets.filter(s => !gone.includes(s));
      if (seen.length) { actor.secrets.push({ turn: w.turn, text: `Had papers destroyed to hide what ${he(actor)} had done, and a page was kept by the hand that was to burn it.` }); actor.secrets = actor.secrets.slice(-12); }
      return { ok: true, msg: `${gone.length ? `${gone.length} matter${gone.length > 1 ? 's are' : ' is'} gone beyond finding: no inquiry and no dossier will turn ${gone.length > 1 ? 'them' : 'it'} up now. ` : ''}${held.length ? `${held.length} could not be reached: a copy lies in somebody else's file already. ` : ''}${seen.length ? `${seen.length} could not be destroyed cleanly: the clerk who was to burn the page kept it, so that what was done is still to be found, and that you tried to hide it as well. ` : ''}`.trim() };
    }
  }
  return fail('Unknown operation.');
}

// Each quarter: remissions cost the treasury what they forgive and quiet the province while they last; a party's dues come in.
export function meansStep(w) {
  for (const p of Object.values(w.provinces)) { if (!p.remit) continue; const c = w.countries[p.controller]; if (!c?.alive || p.remit.until <= w.turn) { delete p.remit; continue; }
    const cost = Math.min(remitCost(w, c, p, p.remit.share), Math.max(c.treasury, 0)); c.treasury -= cost; (c._outlay ||= {}).relief = (c._outlay.relief || 0) + cost; p.unrest = clamp(p.unrest - 2.5 * p.remit.share, 0, 100); }
}
export const meansWords = (w, ch) => { const c = w.countries[ch.country], out = []; if (!c) return out;
  if (governs(w, c, ch)) { const rs = countryProvinces(w, c.id).filter(p => p.remit); if (rs.length) out.push(`Land tax remitted: ${rs.map(p => `${p.name} ${n(p.remit.share * 100)} in the hundred until ${quarterLabel(p.remit.until)}`).join(', ')}.`); }
  const party = leadsParties(w, c, ch)[0]; if (party?.dues > 0) out.push(`The ${party.name} collects dues at ${n(party.dues * 100)} in the hundred (about ${r1(duesOf(c, party))} a quarter).`);
  return out; };
