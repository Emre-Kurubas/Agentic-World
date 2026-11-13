// What the people around the seats can be made to do. An officer, an official, a banker or a governor whom nobody plays has no mind of his
// own, but he has a price and a nerve: money buys a named deed from him if it is enough for what he is asked to do and for what he is, and
// what a file holds on him frightens him into one if it is heavy enough. He answers at once, takes the money or leaves it, does the thing or
// refuses, and a man who stands by his ruler may tell him who came. No dice are thrown: his greed, his loyalty, his hardness, what he has to
// lose and a bent of his own decide, so the same approach gets the same answer until something about him has changed.
// The deeds are the ones the engine already carries out: a commander who keeps his men where they stand, a police chief who gives warning or
// looks away, a treasury keeper whose books show nothing, a governor whose returns go elsewhere, a place in a plot, word of what passes
// through a post, a note forgotten, an office laid down.
import { clamp, quarterLabel } from './util.js';
import { deal, postOf, standing } from './court.js';
import { atWar } from './world.js';
import { he, He, him, his, himself } from './names.js';

const say = (w, ch, from, text) => { if (ch?.alive) ch.inbox.push({ turn: w.turn, from, text }); };
const trace = (w, ch, text) => { if (!ch) return; (ch.secrets ||= []).push({ turn: w.turn, text }); ch.secrets = ch.secrets.slice(-12); };
const hash = s => { let h = 7; for (const x of String(s)) h = (h * 31 + x.codePointAt(0)) >>> 0; return h; };
const unitOf = (w, ch) => Object.values(w.units).filter(u => u.commander === ch.id && u.country === ch.country).sort((a, b) => b.men - a.men)[0];
const fleetOf = (w, ch) => Object.values(w.fleets).find(f => f.commander === ch.id && f.country === ch.country);
const provinceOf = (w, ch) => Object.values(w.provinces).find(p => p.governor === ch.id && p.controller === ch.country);
const notesOn = (w, ch, actor) => (w.debts || []).filter(d => d.creditor === ch.id && d.debtor === actor.id && ['open', 'overdue'].includes(d.status));
const r1 = v => Math.round(v * 10) / 10;
export const YEAR = 4;
export const deedWords = (text, ch) => text.replace(/\bhis\b/g, his(ch));

// weight: what the deed is worth in money to a man of middling greed and middling faith. against: it is done against the government he serves,
// so his loyalty counts for more and a man who stands by his ruler will not do it at any price. you: the deed as told to whoever asked;
// short: the deed as told to anyone else.
export const DEEDS = {
  stand_aside: { weight: 24, against: true, fits: (w, ch) => !!(unitOf(w, ch) || fleetOf(w, ch)), needs: 'a commander of troops or of a squadron', you: 'keep his men where they stand', short: 'keep his men out of it when the government is struck at' },
  join_plot: { weight: 20, against: true, fits: () => true, needs: 'someone in the country of the plot', you: 'join the plot', short: 'join a plot' },
  blind: { weight: 16, against: true, fits: (w, ch) => ch.post === 'police', needs: 'the chief of police', you: 'look away from your affairs', short: 'have the police look away' },
  warn: { weight: 10, fits: (w, ch) => ch.post === 'police', needs: 'the chief of police', you: 'give you warning', short: 'give warning of an order of arrest' },
  books: { weight: 12, fits: (w, ch) => ch.post === 'treasury', needs: 'the keeper of the treasury', you: 'see that his books show nothing of you', short: 'alter the treasury\'s books' },
  returns: { weight: 14, against: true, fits: (w, ch) => !!provinceOf(w, ch), needs: 'a governor', you: 'send part of his province\'s taxes your way', short: 'keep back his province\'s taxes for a private purse' },
  inform: { weight: 14, fits: () => true, needs: 'someone with a post', you: 'report to you what passes through his post', short: 'pass on what goes through his post' },
  forgive_debt: { weight: 0, fits: (w, ch, actor) => notesOn(w, ch, actor).length > 0, needs: 'someone who holds a note of yours', you: 'forget your note', short: 'forget a debt', blackmailOnly: true },
  stand_down: { weight: 22, fits: (w, ch) => !!ch.league, needs: 'the chief of a league', you: 'keep his men at home', short: 'keep his league at home' },
  resign: { weight: 18, fits: (w, ch) => !!(ch.post || unitOf(w, ch) || fleetOf(w, ch) || provinceOf(w, ch)), needs: 'someone who holds an office or a command', you: 'lay down his office', short: 'lay down his office' },
  pay: { weight: 6, fits: () => true, needs: 'someone with money', you: 'pay you', short: 'pay money', blackmailOnly: true }
};
const ALIAS = { quiet: 'stand_down', stay_home: 'stand_down', hold_back: 'stand_aside', aside: 'stand_aside', join: 'join_plot', plot: 'join_plot', warning: 'warn', look_away: 'blind', blindness: 'blind', report: 'inform', informant: 'inform', forgive: 'forgive_debt', resignation: 'resign', money: 'pay' };
export const deedOf = key => { const k = String(key ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_'); return Object.hasOwn(DEEDS, k) ? k : ALIAS[k] ?? null; };
const plotFor = (w, ch, actor, id) => (w.plots || []).find(p => p.active && p.country === ch.country && [p.leader, ...p.members].includes(actor.id) && (!id || p.id === id));
// What a man in his place can be asked for.
// A ruler does not buy from his own servant what is done against the ruler.
const ownRuler = (w, ch, actor) => w.countries[ch.country]?.leader === actor.id;
export const openTo = (w, ch, actor, how) => Object.entries(DEEDS).filter(([k, d]) => (how === 'blackmail' || !d.blackmailOnly) && !(d.against && ownRuler(w, ch, actor)) && (k === 'join_plot' ? !!plotFor(w, ch, actor) : d.fits(w, ch, actor))).map(([k]) => k);

const bent = (ch, deed) => .85 + hash(`${ch.id}|${deed}`) % 31 / 100;
// What it weighs with him: the deed itself, more if it is done for an enemy in a war, less for his own blood or his own paymaster.
function weightOf(w, ch, actor, deed, op) {
  const d = DEEDS[deed]; let v = d.weight;
  if (deed === 'forgive_debt') { const n = notesOn(w, ch, actor).find(x => x.id === op.debt) ?? notesOn(w, ch, actor)[0]; v = n ? n.owed * .8 : 0; }
  if (deed === 'pay') v = 6 + 30 * clamp((Number(op.amount) || 0) / Math.max(ch.wealth, 1), 0, 3);
  if (deed === 'resign') v += Math.max(0, 60 - (ch.age ?? 50)) * .2;
  // The more of the army a commander has under him, the more he is asked to throw away.
  if (deed === 'stand_aside') { const u = unitOf(w, ch), all = Object.values(w.units).filter(x => x.country === ch.country).reduce((a, x) => a + x.men, 0); if (u && all > 0) v *= 1 + 2 * u.men / all; }
  if (d.against && actor.country !== ch.country && atWar(w, actor.country, ch.country)) v *= 1.5;
  return v * (ch.kin === actor.id || actor.kin === ch.id ? .3 : 1) * (ch.payroll === actor.id ? .6 : 1);
}
// The sum for which he would do it; and whether it is not a matter of the sum at all.
export function priceOf(w, ch, actor, deed, op = {}) {
  const d = DEEDS[deed], c = w.countries[ch.country], forRuler = c?.leader === actor.id, against = !!d.against && !forRuler;
  const faith = against ? .35 + ch.loyalty / 80 : forRuler ? .4 : .6 + ch.loyalty / 200, taste = faith * (1.5 - ch.greed / 100);
  return { price: Math.max(1, Math.ceil(weightOf(w, ch, actor, deed, op) * taste * bent(ch, deed))), never: against && ch.loyalty >= 75 && ch.kin !== actor.id, against };
}
// How hard what the file holds presses on him. What is true and unknown frightens most, a forged page less, a copied letter or a known debt
// little. A man with more to lose fears more, and so does one in a country where such things are printed; whoever governs can also put the
// file before a court. Squeezed again and again, he has less left to fear.
export function gripOf(w, ch, actor, file) {
  const facts = file?.facts || [], forged = (file?.forged || []).filter(f => facts.includes(f)).length, real = (ch.secrets || []).filter(s => !s.published && facts.includes(s.text)).length, c = w.countries[ch.country];
  return (10 * real + 5 * forged + 2 * Math.max(0, facts.length - real - forged)) * (.6 + ch.power / 100) * (.5 + (c?.pressFreedom ?? 50) / 100) * (c?.leader === actor.id ? 1.5 : 1) * .8 ** (ch.squeezed || 0);
}
// How much it takes to make him do this: the deed, his faith if it is done against his ruler, and how hard a man he is.
export function nerveOf(w, ch, actor, deed, op = {}) {
  const d = DEEDS[deed], c = w.countries[ch.country], against = !!d.against && c?.leader !== actor.id;
  return weightOf(w, ch, actor, deed, op) * (against ? .5 + ch.loyalty / 100 : .7) * (.8 + ch.ruthless / 250) * bent(ch, deed) / 2;
}

// The deed is done. Returns what he now does as a function of how the asker is named, or a reason it could not be done at all.
function carry(w, ch, actor, deed, op, by) {
  const until = w.turn + YEAR, c = w.countries[ch.country];
  switch (deed) {
    case 'stand_aside': { const u = unitOf(w, ch), f = fleetOf(w, ch); ch.aside = { for: actor.id, until }; trace(w, ch, `Agreed ${by} to keep ${u ? u.id : `the squadron ${f.id}`} out of it for ${actor.name}.`);
      return { text: N => `Until ${quarterLabel(until)} ${u ? `${u.id} (${Math.round(u.men)} thousand men at ${w.provinces[u.province]?.name}) stays where it stands: ${he(ch)} finds reasons not to march it when it is ordered forward, and if the palace is struck at by a stroke ${N.you} ${N.are} part of, ${his(ch)} men count for neither side` : `the squadron ${f.id} counts for neither side if the palace is struck at by a stroke ${N.you} ${N.are} part of`}` }; }
    case 'join_plot': { const pl = plotFor(w, ch, actor, op.plot); if (!pl) return { no: `there is no plot of yours in ${his(ch)} country for ${him(ch)} to join` }; if (pl.leader === ch.id || pl.members.includes(ch.id)) return { no: `${he(ch)} is in it already` };
      pl.members.push(ch.id); trace(w, ch, `Joined a plot (${pl.kind}) ${by}.`); say(w, ch, actor.name, `You were brought into plot ${pl.id} (${pl.kind}).`); const u = unitOf(w, ch); return { text: () => `${He(ch)} is in plot ${pl.id}${u ? `, and ${u.id} goes where ${he(ch)} goes` : ''}` }; }
    case 'blind': ch.blind = { for: actor.id, until }; trace(w, ch, `Agreed ${by} to look away from the affairs of ${actor.name}.`); return { text: N => `Until ${quarterLabel(until)} the police look away from ${N.you}: a plot ${N.you} ${N.lead} is far less likely to leak, a watch the police keep on ${N.you} sees little and lets ${N.your} letters pass, and men who report to ${N.you} in this country are far less likely to be taken` };
    case 'stand_down': ch.quiet = { for: actor.id, until }; trace(w, ch, `Agreed ${by} to keep ${his(ch)} league at home for ${actor.name}.`); return { text: N => `Until ${quarterLabel(until)} ${he(ch)} keeps ${his(ch)} men at home: no marches, no march on the capital, nobody set upon, and the league shrinks for want of something to do` };
    case 'warn': ch.warns = { for: actor.id, until }; trace(w, ch, `Agreed ${by} to warn ${actor.name} of any order of arrest.`); return { text: N => `Until ${quarterLabel(until)} an order for ${N.your} arrest reaches ${N.you} before the police do, and they do not find ${N.you} that quarter` };
    case 'books': { const mine = (actor.secrets || []).filter(s => !s.published && !s.buried && /treasury|budget|customs|Embezzled/i.test(s.text)); if (!mine.length) return { no: 'there is nothing of yours in the treasury\'s books to put out of sight' };
      for (const s of mine) s.buried = { by: ch.id, post: 'treasury' }; trace(w, ch, `Altered the treasury's books ${by} so that they show nothing of ${actor.name}.`);
      return { text: N => `${mine.length} thing${mine.length > 1 ? 's' : ''} the treasury's books could tell of ${N.you} ${mine.length > 1 ? 'are' : 'is'} out of sight for as long as ${he(ch)} keeps the treasury and ${his(ch)} liberty; no inquiry and no reporter finds ${mine.length > 1 ? 'them' : 'it'} till then` }; }
    case 'returns': { const p = provinceOf(w, ch); ch.returns = { for: actor.id, until, province: p.id }; trace(w, ch, `Kept back taxes of ${p.name} ${by} and passed them to ${actor.name}.`); return { text: N => `Until ${quarterLabel(until)} part of the taxes of ${p.name} goes to ${N.you} instead of the capital, and the capital's hold on the province slackens as it does under any governor who keeps taxes back` }; }
    case 'inform': if (ch.handler === actor.id) return { no: `${he(ch)} reports to you already` }; if (ch.handler) return { no: 'someone else has been before you' }; ch.handler = actor.id; ch.stipend = 0; ch.boughtAt = w.turn; trace(w, ch, `Passes what goes through ${his(ch)} post to ${actor.name}, ${by}.`); trace(w, actor, `Has ${ch.name} report in secret what passes through ${his(ch)} post.`);
      return { text: N => `${He(ch)} sends ${N.you} word each quarter of what passes under ${his(ch)} hands${postOf(w, ch) ? ` (${he(ch)} ${postOf(w, ch)})` : ''}, for as long as ${he(ch)} is not caught at it` };
    case 'forgive_debt': { const n = notesOn(w, ch, actor).find(x => x.id === op.debt) ?? notesOn(w, ch, actor)[0]; n.status = 'forgiven'; n.closedAt = w.turn; trace(w, ch, `Forgot ${actor.name}'s note of ${Math.round(n.owed)} ${by}.`); return { text: N => `${N.Your} note ${n.id} of ${Math.round(n.owed)} is forgotten` }; }
    case 'resign': { const what = postOf(w, ch) || 'holds an office', ruler = w.characters[c?.leader]; ch.post = null; for (const u of Object.values(w.units)) if (u.commander === ch.id) u.commander = null; for (const f of Object.values(w.fleets)) if (f.commander === ch.id) f.commander = null; for (const p of Object.values(w.provinces)) if (p.governor === ch.id) p.governor = null;
      if (ruler?.alive && ruler.id !== actor.id) say(w, ruler, ch.name, `${ch.name} (${ch.id}), who ${what}, asks to be relieved and has laid down the office. It is vacant: you may fill it, or the service will.`); trace(w, ch, `Laid down ${his(ch)} office ${by}.`);
      return { text: () => `${He(ch)} has laid down ${his(ch)} office (${he(ch)} ${what.replace(/^commands/, 'commanded').replace(/^keeps/, 'kept').replace(/^heads/, 'headed')}); it stands vacant until whoever governs fills it or the service does` }; }
    case 'pay': { const m = Math.min(Math.max(ch.wealth, 0), Math.max(0, Number(op.amount) || 0)); if (!(m >= .5)) return { no: `no sum was named, or ${he(ch)} has nothing` }; ch.wealth -= m; actor.wealth += m; return { text: N => `${He(ch)} has paid ${N.you} ${r1(m)}` }; }
  }
  return { no: `that is not a thing ${he(ch)} can do` };
}

// One approach to one person for one deed in a quarter. how is 'bribe' (money is offered) or 'blackmail' (a file is shown).
export function approach(w, actor, ch, op, how, { amount = 0, file = null, allowance }) {
  const deed = deedOf(op.for ?? op.deed), fail = msg => ({ ok: false, msg }), home = w.countries[ch.country], ruler = w.characters[home?.leader];
  const can = openTo(w, ch, actor, how), list = `What ${ch.name}${postOf(w, ch) ? `, who ${postOf(w, ch)},` : ''} can be asked for: ${can.join(', ') || 'nothing the engine knows'}.`;
  if (!deed) return fail(`No such deed. ${list}`);
  const D = { ...DEEDS[deed], you: deedWords(DEEDS[deed].you, ch), short: deedWords(DEEDS[deed].short, ch) }, you = { you: 'you', your: 'your', Your: 'Your', are: 'are', lead: 'lead' }, them = { you: actor.name, your: `${actor.name}'s`, Your: `${actor.name}'s`, are: 'is', lead: 'leads' };
  if (D.against && ownRuler(w, ch, actor)) return fail(`${ch.name} serves you: that is not a thing a ruler buys or forces from his own servant. ${list}`);
  if (D.blackmailOnly && how !== 'blackmail') return fail(deed === 'forgive_debt' ? `Money paid to have a note forgotten is a settlement: what ${ch.name} would take to call it settled is asked with ask_terms (offer).` : `Nobody is paid to pay. ${list}`);
  if (deed === 'join_plot' ? !plotFor(w, ch, actor, op.plot) : !D.fits(w, ch, actor)) return fail(deed === 'join_plot' ? `You are in no plot in ${home?.name ?? `${his(ch)} country`} that ${ch.name} could join. ${list}` : `${ch.name} is not ${D.needs} and cannot ${D.you}. ${list}`);
  if (ch.status !== 'free') return fail(`${ch.name} is ${ch.status} and in no position to do anything for anyone.`);
  if (allowance(w, actor, `deed:${ch.id}:${deed}`, 1, 1) <= 0) return fail(`${ch.name} has given ${his(ch)} answer on that this quarter; ${he(ch)} can be approached again in the next.`);
  // A man who stands by his ruler says who came, and it goes into the ruler's file.
  const tells = what => { if (!(ch.loyalty > 58 && ruler?.alive && ruler.id !== actor.id)) return false; say(w, ruler, ch.name, `${ch.name} (${ch.id}) reports that ${actor.name} (${actor.id})${actor.country !== ch.country ? ` of ${w.countries[actor.country]?.name}` : ''} ${what} to make ${him(ch)} ${D.short}. ${He(ch)} refused.`); const f = ruler.dossiers[actor.id] ||= { turn: w.turn, about: actor.name, facts: [] }; f.turn = w.turn; f.facts.push(`In ${quarterLabel(w.turn)} ${what.replace(` ${him(ch)} `, ` ${ch.name} `)} to make ${him(ch)} ${D.short}.`); f.facts = f.facts.slice(-8); trace(w, actor, `Tried to make ${ch.name} ${D.short}.`); return true; };
  if (how === 'bribe') {
    const p = priceOf(w, ch, actor, deed, op);
    if (p.never || amount < p.price) {
      const told = tells(`offered ${him(ch)} ${Math.round(amount)}`); deal(w, ch, actor, `Refused ${actor.name}'s ${Math.round(amount)} to ${D.short}${p.never ? `: ${he(ch)} will not do it for any sum` : `: for ${him(ch)} it would take about ${p.price}`}${told ? `; and ${he(ch)} told the ruler` : ''}.`);
      return fail(p.never ? `${ch.name} would not take it: it is not the sum; ${he(ch)} will not ${D.you} while ${he(ch)} stands toward the government as ${he(ch)} does. A man like that may say who came to him. The money stays with you.` : `${ch.name} would not ${D.you} for ${r1(amount)}: the sum is too small for what is asked of ${him(ch)}; something nearer ${Math.ceil(p.price / 5) * 5} would be heard differently. The money stays with you${ch.loyalty > 58 ? ', and a man who stands by his ruler as he does may say who came' : ''}.`);
    }
    const done = carry(w, ch, actor, deed, op, 'for money'); if (done.no) return fail(`${ch.name} took nothing: ${done.no}.`);
    actor.wealth -= amount; ch.wealth += amount; trace(w, actor, `Paid ${ch.name} ${Math.round(amount)} to ${D.short}.`); trace(w, ch, `Took ${Math.round(amount)} from ${actor.name}.`);
    deal(w, ch, actor, `Took ${Math.round(amount)} from ${actor.name}. ${done.text(them)}.`);
    return { ok: true, msg: `${ch.name} took the ${r1(amount)}. ${done.text(you)}. Both of you now have something to hide.` };
  }
  trace(w, actor, `Blackmailed ${ch.name}.`); ch.loyalty = clamp(ch.loyalty - 5, 0, 100);
  if (deed === 'pay' && (Number(op.amount) || 0) > ch.wealth) return fail(`${ch.name} has not got ${Math.round(Number(op.amount) || 0)}: ${he(ch)} has about ${Math.round(ch.wealth)}.`);
  const grip = gripOf(w, ch, actor, file), nerve = nerveOf(w, ch, actor, deed, op);
  if (grip < nerve) {
    const told = tells(`showed ${him(ch)} a file on ${himself(ch)}`); deal(w, ch, actor, `Refused ${actor.name}, who showed ${him(ch)} a file and demanded that ${he(ch)} ${D.short}${told ? `; and ${he(ch)} told the ruler` : ''}.`);
    return fail(`${ch.name} read what you hold on ${him(ch)} and would not ${D.you}: it does not frighten ${him(ch)} enough for that. ${grip < nerve * .5 ? 'It is far too little: a story already known, a copied letter or a single forged page moves nobody to this.' : `More of the same kind, or a smaller thing asked of ${him(ch)}, would be heard differently.`}${ch.loyalty > 58 ? ' A man who stands by his ruler as he does may go to him with it.' : ''}`);
  }
  const done = carry(w, ch, actor, deed, op, 'under threat'); if (done.no) return fail(`${ch.name} gave way, but ${done.no}.`);
  ch.squeezed = (ch.squeezed || 0) + 1; deal(w, ch, actor, `Gave way to ${actor.name}, who showed ${him(ch)} a file. ${done.text(them)}.`);
  return { ok: true, msg: `${ch.name} read what you hold on ${him(ch)} and gave way. ${done.text(you)}. The file is still yours; a man squeezed again and again has less left to fear each time.` };
}
