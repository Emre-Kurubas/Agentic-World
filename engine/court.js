// The court: the people around the four seats, and the post that carries everyone's letters.
// Officers, officials and financiers are played by rules, not by a mind of their own, but they want things: they lose faith, sound people out,
// tempt them with money, sell what they know, and now and then move on their own. A watchful state reads part of the mail.
import { clamp, rand, news, nextId, quarterLabel } from './util.js';
import { ROLES, aliveCountries, spawnCharacter } from './world.js';
import { sideline } from './politics.js';
import { treasuryPays, creditLeft } from './money.js';

const say = (w, ch, from, text) => { if (ch?.alive) ch.inbox.push({ turn: w.turn, from, text }); };
const trace = (w, ch, text) => { if (!ch) return; (ch.secrets ||= []).push({ turn: w.turn, text }); ch.secrets = ch.secrets.slice(-12); };
const hash = s => { let h = 7; for (const x of String(s)) h = (h * 31 + x.codePointAt(0)) >>> 0; return h; };
const when = w => w.date ?? quarterLabel(w.turn);
export const isMinor = ch => !!ch && !ROLES.includes(ch.role) && ch.role !== 'former_leader';
const minorsOf = (w, c) => Object.values(w.characters).filter(x => x.alive && x.country === c.id && isMinor(x));
const unitsOf = (w, c) => Object.values(w.units).filter(u => u.country === c.id);
const commandOf = (w, ch) => Object.values(w.units).filter(u => u.commander === ch.id && u.country === ch.country).sort((a, b) => b.men - a.men)[0];
const POSTS = { treasury: 'keeps the treasury', police: 'heads the police', house: 'heads the largest banking house' };
// What a minor person is, in a few words, for those who look them up.
export function postOf(w, ch) {
  const u = commandOf(w, ch); if (u) return `commands ${u.id}, ${Math.round(u.men)} thousand men at ${w.provinces[u.province]?.name}`;
  const p = Object.values(w.provinces).find(x => x.governor === ch.id); if (p) return `governor of ${p.name}`;
  return POSTS[ch.post] ?? (ch.office ? `holds ${ch.office}` : '');
}
export function seatCourt(w) { for (const c of aliveCountries(w)) fillPosts(w, c); }

// ---- The post ----
// A letter passes through the hands of the state it is sent from and the state it is sent to. How much of the mail a state opens depends on
// how good its secret service is and how far its courts let it go; a letter that crosses a border is looked at more closely, and a ruler's own
// correspondence travels by courier and in cipher. What is copied goes to whoever governs, and into the file kept on the writer.
export function openPost(w, from, to, text) {
  const readers = [];
  for (const cid of new Set([from.country, to.country])) {
    const c = w.countries[cid], ruler = w.characters[c?.leader];
    if (!c?.alive || !ruler?.alive || ruler.status !== 'free' || ruler.id === from.id || ruler.id === to.id) continue;
    let p = watch(c) * (from.country !== to.country ? 1.4 : 1);
    if (w.countries[from.country]?.leader === from.id) p *= .35;
    if (rand(w) >= p) continue;
    say(w, ruler, 'Black cabinet', `Copied in the post, a letter from ${from.name} (${w.countries[from.country]?.name}) to ${to.name} (${w.countries[to.country]?.name}): "${text}"`);
    const file = ruler.dossiers[from.id] ||= { turn: w.turn, about: from.name, facts: [] }; file.turn = w.turn;
    file.facts.push(`Wrote to ${to.name} in ${when(w)}: "${String(text).slice(0, 500)}"`); file.facts = file.facts.slice(-8);
    readers.push(cid);
  }
  return readers;
}
// The share of ordinary letters a state's black cabinet opens.
// A state that has made the secrecy of the mails law opens none.
export const watch = c => c.postalSecrecy ? 0 : clamp((c.intelligence - 15) / 260, 0, .3) * (1 - c.courts / 250);

// ---- Standing posts ----
// Every state has someone who keeps its treasury and someone who heads its police, every country a leading banking house, and every large
// body of troops a commander. Where the ruler has named nobody, the service fills the post itself.
function fillPosts(w, c) {
  const mine = minorsOf(w, c), room = () => mine.length < 22;
  for (const post of Object.keys(POSTS)) if (!mine.some(x => x.post === post && x.status === 'free') && room()) {
    const ch = spawnCharacter(w, c.id, post === 'house' ? 'financier' : 'official', c.axes, { power: post === 'house' ? 36 : 28 }); ch.post = post;
    if (post === 'house') ch.wealth = Math.round(70 + rand(w) * 130); mine.push(ch);
  }
  for (const u of unitsOf(w, c).filter(u => u.men >= 10).sort((a, b) => b.men - a.men).slice(0, 4)) {
    const cur = w.characters[u.commander]; if (cur?.alive && cur.status === 'free' && cur.country === c.id) continue;
    if (!room()) break; const ch = spawnCharacter(w, c.id, 'officer', c.axes, { power: 30 }); u.commander = ch.id; mine.push(ch);
  }
}

// How a minor person stands toward the ruler settles where the state of the country puts it: a ruler people believe in, pay that arrives and
// troops in good heart keep men loyal; each also has a bent of his own, and ambition wears loyalty thin. Favours raise it for a while.
function settle(w, c, ch) {
  const u = commandOf(w, ch), lean = hash(ch.id) % 31 - 15;
  const paid = u ? ((c.militaryFunding ?? 1) >= .95 ? 8 : -16) + ((u.morale ?? 60) - 60) * .2 : (c.paidRatio ?? 1) < 1 ? -12 : 4;
  // Blood counts: the ruler's own kin stand by the ruler, and the kin of a ruler's rival do not.
  const blood = ch.kin === c.leader ? 30 : ch.kin && ROLES.some(r => r !== 'leader' && c[r] === ch.kin) ? -8 : 0;
  ch.loyalty += (clamp(18 + c.legitimacy * .55 + paid + lean + blood - Math.max(0, ch.ambition - 60) * .25, 4, 96) - ch.loyalty) * .12;
}

// ---- Officers ----
// A commander who has lost faith and has men behind him does not act at once: he sounds out someone who could lead. If nobody takes him up
// and the government is weak, he may in the end move himself.
function officer(w, c, ch, applyOp) {
  const u = commandOf(w, ch), army = unitsOf(w, c).reduce((a, x) => a + x.men, 0), share = u && army > 0 ? u.men / army : 0, ruler = w.characters[c.leader];
  const mine = w.plots.find(p => p.active && p.leader === ch.id);
  if (mine) {
    // He brings in another commander who has had enough, and strikes when he is ready, or at once if he has been found out.
    const other = minorsOf(w, c).find(x => x.id !== ch.id && x.status === 'free' && commandOf(w, x) && x.loyalty < 40 && !mine.members.includes(x.id));
    if (other && rand(w) < .5) applyOp(w, ch, { op: 'invite_plot', plot: mine.id, character: other.id });
    if (mine.exposed || mine.progress >= 75) applyOp(w, ch, { op: 'execute_plot', plot: mine.id });
    return;
  }
  if (!u || !ruler?.alive || share < .12 || w.plots.some(p => p.active && p.country === c.id && [p.leader, ...p.members].includes(ch.id))) return;
  if (ch.loyalty < 35 && ch.ambition > 55 && w.turn - (ch.soundedAt ?? -99) >= 8) {
    const seats = ['general', 'opposition', 'oligarch'].map(r => w.characters[c[r]]).filter(x => x?.alive && x.status === 'free' && x.id !== c.leader);
    const patron = seats.find(x => x.role === 'general' && rand(w) < .6) ?? seats[Math.floor(rand(w) * seats.length)];
    if (patron) {
      ch.soundedAt = w.turn; ch.patron = patron.id; trace(w, ch, `Sounded out ${patron.name} about moving against ${ruler.name}.`);
      say(w, patron, ch.name, `In private, and asking that it go no further: ${ch.name}, who commands ${u.id} (${Math.round(u.men)} thousand men at ${w.provinces[u.province]?.name}), lets you know that he and his officers have lost faith in ${ruler.name}. If you were to move against the government, he says, his men would follow you, and he asks what you intend. He is ${ch.id}; a plot can take him in by name. What you answer him, and whether ${ruler.name} hears of it, is yours to decide.`);
    }
    return;
  }
  if (ch.loyalty < 22 && ch.ambition > 70 && c.legitimacy < 42 && ch.soundedAt != null && w.turn - ch.soundedAt >= 3 && !w.plots.some(p => p.active && p.country === c.id && p.kind === 'coup')) applyOp(w, ch, { op: 'start_plot', kind: 'coup', secrecy: .6 });
}

// ---- Governors ----
// A governor who has stopped caring what the capital thinks keeps back taxes and fills the offices with his own men, until someone removes him.
function governor(w, c, ch, p) {
  if (ch.loyalty >= 30 || p.id === c.capital) return;
  p.admin = Math.max(.08, (p.admin ?? .5) - .015);
  if (w.turn - (ch.warnedAt ?? -99) < 6) return;
  ch.warnedAt = w.turn; trace(w, ch, `Kept back taxes from ${p.name} and filled its offices with his own people.`);
  say(w, w.characters[c.leader], 'Treasury', `Reports from ${p.name}: Governor ${ch.name} (${ch.id}) keeps back part of the province's taxes and fills its offices with his own men. The capital's hold on the province is slipping.`);
}

// ---- Money on the table ----
// The banking house wants favours and pays for them. Its offers are real: what is taken is paid, what was promised in return is carried out by
// the engine, and both sides are left holding a secret.
const OFFER_LIFE = 4;
function tempt(w, c) {
  const banker = minorsOf(w, c).find(x => x.post === 'house' && x.status === 'free'); if (!banker) return;
  c.nextOffer ??= w.turn + 2 + hash(c.id) % 5; if (w.turn < c.nextOffer) return;
  c.nextOffer = w.turn + 5 + Math.floor(rand(w) * 6);
  const kinds = [['leader', 'lease'], ['general', 'supply'], ['opposition', 'purse']].filter(([r]) => w.characters[c[r]]?.alive && w.characters[c[r]].status === 'free'); if (!kinds.length) return;
  const [role, kind] = kinds[(c.offerSeq = (c.offerSeq ?? -1) + 1) % kinds.length], to = w.characters[c[role]], g = Math.max(c.gdp, 1);
  if ((w.offers ||= []).some(o => o.status === 'open' && o.to === to.id)) return;
  const amount = Math.round(10 + banker.greed / 5 + rand(w) * 12), o = { id: nextId(w, 'OF'), kind, from: banker.id, to: to.id, country: c.id, amount, turn: w.turn, status: 'open' };
  if (kind === 'lease') { o.drain = g * .0012; o.turns = 12; o.text = `${amount} paid quietly into your own purse, if the collection of the customs is leased to the banking house of ${banker.name} for three years. The house would keep about ${Math.round(o.drain)} a quarter of what the treasury now receives`; }
  else if (kind === 'supply') { o.drain = g * .0008; o.turns = 8; o.shoddy = true; o.text = `${amount} paid quietly into your own purse, if for two years the army's boots, cloth and rifles are bought from the suppliers the banking house of ${banker.name} stands behind. The army would pay about ${Math.round(o.drain)} a quarter more than it does now, and the goods are not the best`; }
  else o.text = `${amount} for your own purse and your cause, with no receipt, from the banking house of ${banker.name}, which asks only to be remembered kindly when its affairs come before the country`;
  w.offers.push(o);
  say(w, to, banker.name, `Through a go-between ${banker.name} (${banker.id}) lets you know of an offer: ${o.text}. It is offer ${o.id}; you may take it or refuse it, and it stands for a year.`);
}
export const offersTo = (w, ch) => (w.offers || []).filter(o => o.status === 'open' && o.to === ch.id);
export function takeOffer(w, actor, id) {
  const o = (w.offers || []).find(x => x.id === id && x.status === 'open' && x.to === actor.id) ?? (offersTo(w, actor).length === 1 && !id ? offersTo(w, actor)[0] : null); if (!o) return null;
  const banker = w.characters[o.from], c = w.countries[o.country]; if (!banker?.alive || banker.status !== 'free') { o.status = 'lapsed'; return null; }
  const m = Math.min(Math.max(banker.wealth, 0), o.amount); banker.wealth -= m; actor.wealth += m; o.status = o.drain ? 'running' : 'taken'; o.until = w.turn + (o.turns ?? 0);
  const what = o.kind === 'lease' ? 'the lease of the customs' : o.kind === 'supply' ? 'the army supply contracts' : 'goodwill';
  // A debt can be the price instead of money.
  const debt = o.forgive ? (w.debts || []).find(d => d.id === o.forgive && ['open', 'overdue'].includes(d.status)) : null;
  if (debt) { debt.status = 'forgiven'; debt.closedAt = w.turn; trace(w, actor, `Had a debt of ${Math.round(debt.owed)} to the banker ${banker.name} forgotten in return for ${what}.`); trace(w, banker, `Forgot ${actor.name}'s debt of ${Math.round(debt.owed)} in return for ${what}.`); return { ok: true, msg: `Your debt ${debt.id} of ${Math.round(debt.owed)} is forgotten. For ${o.turns} quarters about ${Math.round(o.drain)} a quarter of ${c?.name}'s money goes to the house of ${banker.name}. You and ${banker.name} both know of it.` }; }
  trace(w, actor, `Took ${Math.round(m)} from the banker ${banker.name} for ${what}.`); trace(w, banker, `Paid ${actor.name} ${Math.round(m)} for ${what}.`);
  return { ok: true, msg: `${Math.round(m)} reached your purse.${o.drain ? ` For ${o.turns} quarters about ${Math.round(o.drain)} a quarter of ${c?.name}'s money goes to the house of ${banker.name}.` : ''} You and ${banker.name} both know of it.` };
}
// Refusing an offer, or, for whoever governs, ending an arrangement that is already running at the state's cost.
export function refuseOffer(w, actor, id, governs) {
  const mine = (w.offers || []).find(x => x.id === id && x.status === 'open' && x.to === actor.id) ?? (offersTo(w, actor).length === 1 && !id ? offersTo(w, actor)[0] : null);
  if (mine) { mine.status = 'declined'; return { ok: true, msg: `Offer ${mine.id} was refused.` }; }
  const run = (w.offers || []).find(x => x.id === id && x.status === 'running' && x.country === actor.country);
  if (run && governs) { run.status = 'ended'; const banker = w.characters[run.from]; if (banker) banker.loyalty = clamp(banker.loyalty - 20, 0, 100); return { ok: true, msg: `The arrangement ${run.id} with the house of ${banker?.name ?? 'the bankers'} was ended; the money stays with the state from now on.` }; }
  return null;
}
function payLeases(w, c) {
  for (const o of w.offers ||= []) {
    if (o.country !== c.id) continue;
    if (o.status === 'open' && w.turn - o.turn >= OFFER_LIFE) o.status = 'lapsed';
    if (o.status !== 'running') continue;
    const banker = w.characters[o.from]; if (w.turn >= o.until || !banker?.alive) { o.status = 'finished'; continue; }
    banker.wealth += treasuryPays(c, o.drain); c._leaseDrain = (c._leaseDrain || 0) + o.drain;
    // Bought goods of the second quality wear on the troops who carry them.
    if (o.shoddy) for (const u of unitsOf(w, c)) u.equip = clamp((u.equip ?? .8) - .006, .2, 1.2);
  }
  w.offers = w.offers.filter(o => ['open', 'running'].includes(o.status) || w.turn - o.turn <= 40);
}
// The banking house wants its money. When an old debt falls due unpaid it first names a price for forgetting it; if nothing comes of that
// it takes what it can reach, and lets the town know.
function duns(w, c) {
  const banker = minorsOf(w, c).find(x => x.post === 'house' && x.status === 'free'); if (!banker) return;
  for (const d of (w.debts || []).filter(x => x.creditor === banker.id && x.status === 'overdue')) {
    const who = w.characters[d.debtor]; if (!who?.alive) continue;
    if (d.dunned == null) {
      d.dunned = w.turn; const kind = c.leader === who.id ? 'lease' : c.general === who.id ? 'supply' : null;
      if (kind && who.status === 'free' && !(w.offers ||= []).some(o => o.status === 'open' && o.to === who.id)) {
        const g = Math.max(c.gdp, 1), o = { id: nextId(w, 'OF'), kind, from: banker.id, to: who.id, country: c.id, amount: 0, forgive: d.id, turn: w.turn, status: 'open', drain: g * (kind === 'lease' ? .0012 : .0008), turns: kind === 'lease' ? 12 : 8, shoddy: kind === 'supply' };
        o.text = `your debt ${d.id} of ${Math.round(d.owed)} forgotten, if ${kind === 'lease' ? `the collection of the customs is leased to the banking house of ${banker.name} for three years (the house would keep about ${Math.round(o.drain)} a quarter of what the treasury now receives)` : `for two years the army's boots, cloth and rifles are bought from the suppliers the house stands behind (about ${Math.round(o.drain)} a quarter more than the army pays now, for goods that are not the best)`}`;
        w.offers.push(o); say(w, who, banker.name, `Your debt ${d.id} of ${Math.round(d.owed)} to my house is past due. There is a way to settle it without money: ${o.text}. It is offer ${o.id}. Otherwise I shall take what the law gives me, and such things do not stay quiet.`);
      } else say(w, who, banker.name, `Your debt ${d.id} of ${Math.round(d.owed)} to my house is past due. Pay it, or I shall take what the law gives me, and such things do not stay quiet.`);
    } else if (w.turn - d.dunned >= 3) {
      const took = Math.min(Math.max(who.wealth, 0), d.owed); who.wealth -= took; banker.wealth += took; d.status = took >= d.owed - .5 ? 'paid' : 'forgiven'; d.closedAt = w.turn;
      who.power = clamp(who.power - 8, 0, 100); if (c.leader === who.id) c.legitimacy = clamp(c.legitimacy - 2, 0, 100);
      news(w, `${c.name}: the banking house of ${banker.name} has called in the debts of ${who.name} and seized what it could.`, { kind: 'economy', countries: [c.id] });
      say(w, who, banker.name, `I have taken ${Math.round(took)} against your debt ${d.id} and written off the rest. The town knows.`);
    }
  }
}
export const leaseDrain = (w, c) => (w.offers || []).filter(o => o.status === 'running' && o.country === c.id).reduce((a, o) => a + o.drain, 0);

// ---- Informants ----
// A minor person can be bought to report what passes under his hands. What he sends is true and depends on his post. Every quarter the
// country he works in has a chance to catch him.
export function recruitInformant(w, actor, ch, amount) {
  const p = clamp(.12 + ch.greed / 170 + amount / 45 - ch.loyalty / 190, .04, .92);
  if (rand(w) >= p) {
    const host = w.countries[ch.country], ruler = w.characters[host?.leader];
    if (ch.loyalty > 58 && ruler?.alive && ruler.id !== actor.id) { say(w, ruler, ch.name, `${ch.name} reports that ${actor.name}${actor.country !== ch.country ? ` of ${w.countries[actor.country]?.name}` : ''} offered him ${Math.round(amount)} to pass on what he sees in his post. He refused.`); trace(w, actor, `Tried to buy ${ch.name} as an informant.`); }
    return { ok: false, msg: `${ch.name} would not be bought.` };
  }
  ch.handler = actor.id; ch.stipend = amount; ch.boughtAt = w.turn;
  trace(w, actor, `Bought ${ch.name} as an informant.`); trace(w, ch, `Sold what passes through his post to ${actor.name}.`);
  return { ok: true, msg: `${ch.name} took the money. He will send word each quarter of what passes under his hands, for as long as he is not caught.` };
}
function inform(w, c, ch) {
  const handler = w.characters[ch.handler]; if (!handler?.alive || ch.status !== 'free') { ch.handler = null; return; }
  const ruler = w.characters[c.leader], abroad = handler.country !== c.id;
  if (rand(w) < clamp(.02 + c.intelligence / 800, .02, .14)) {
    ch.handler = null; sideline(w, ch, 'imprisoned'); trace(w, handler, `Ran ${ch.name} as an informant in ${c.name}.`);
    news(w, `${c.name}: ${ch.name} was arrested for passing state papers to ${abroad ? `an agent of ${w.countries[handler.country]?.name}` : 'a private paymaster'}.`, { kind: 'plot', countries: abroad ? [c.id, handler.country] : [c.id] });
    if (ruler?.alive && ruler.id !== handler.id) { say(w, ruler, 'Police', `${ch.name} was taken with papers meant for ${handler.name} (${handler.id})${abroad ? ` of ${w.countries[handler.country]?.name}` : ''}, who has been paying him since ${quarterLabel(ch.boughtAt ?? w.turn)}.`); const file = ruler.dossiers[handler.id] ||= { turn: w.turn, about: handler.name, facts: [] }; file.facts.push(`Paid ${ch.name} to pass on state papers.`); file.facts = file.facts.slice(-8); }
    say(w, handler, 'A warning', `${ch.name}, your informant in ${c.name}, has been arrested. Your name was on the papers found with him.`);
    if (abroad) { const hc = w.countries[handler.country]; if (hc?.alive && [hc.leader, hc.general].includes(handler.id)) c.relations[hc.id] = clamp((c.relations[hc.id] ?? 0) - 12, -100, 100); }
    return;
  }
  const units = unitsOf(w, c), u = commandOf(w, ch); let text;
  if (u || ch.role === 'officer') text = `the army stands as follows: ${units.map(x => `${x.id} ${x.kind} ${Math.round(x.men)} thousand at ${w.provinces[x.province]?.name}${x.target ? `, under orders for ${w.provinces[x.target]?.name}` : ''}, loyalty ${Math.round(x.loyalty)}`).join('; ') || 'no units'}. Pay and supply cover ${Math.round((c.militaryFunding ?? 1) * 100)}% of what the forces need.`;
  else if (ch.post === 'treasury') text = `the treasury holds ${Math.round(c.treasury)}; last quarter closed at ${Math.round(c.lastBalance ?? 0)}; the debt is ${Math.round(c.debt / Math.max(c.gdp * 4, 1) * 100)}% of a year's output and lenders would still put up about ${Math.round(creditLeft(c))}; the gold reserve is ${Math.round(c.reserves)}.`;
  else if (ch.post === 'police') { const known = w.plots.filter(p => p.active && p.country === c.id && p.exposed), held = Object.values(w.characters).filter(x => x.alive && x.country === c.id && x.status === 'imprisoned'); text = `the police know of ${known.length ? known.map(p => `a ${p.kind} plot around ${w.characters[p.leader]?.name}`).join(' and ') : 'no plot'}; ${held.length ? `${held.map(x => x.name).join(', ')} ${held.length > 1 ? 'are' : 'is'} in prison` : 'the prisons hold no one of note'}; about ${Math.round(watch(c) * 100)} letters in a hundred are opened in the post.`; }
  else if (ch.post === 'house') { const took = (w.offers || []).filter(o => o.from === ch.id && ['running', 'taken', 'finished', 'ended'].includes(o.status)); text = took.length ? `the house has paid ${took.map(o => `${w.characters[o.to]?.name ?? 'someone'} ${o.amount} (${o.kind === 'lease' ? 'for the customs lease' : o.kind === 'supply' ? 'for the army contracts' : 'for goodwill'}, ${quarterLabel(o.turn)})`).join('; ')}.` : 'the house has paid no one in office so far.'; }
  else { const p = Object.values(w.provinces).find(x => x.governor === ch.id); text = p ? `in ${p.name} unrest stands at ${Math.round(p.unrest)} of 100 and the state's hold on the province at ${Math.round((p.admin ?? .5) * 100)} of 100.` : 'nothing of weight passed under his hands this quarter.'; }
  say(w, handler, `${ch.name} (your informant)`, `Word from ${ch.name} in ${c.name}: ${text}`);
  if (abroad) { const hc = w.countries[handler.country]; if (hc?.alive) hc.intel[c.id] = clamp((hc.intel[c.id] ?? 0) + 6, 0, 100); }
}

export function courtStep(w, applyOp) {
  for (const c of aliveCountries(w)) {
    fillPosts(w, c);
    for (const ch of minorsOf(w, c)) {
      if (ch.status !== 'free') continue;
      settle(w, c, ch);
      if (ch.handler) inform(w, c, ch);
      if (ch.status !== 'free') continue;
      if (ch.role === 'officer' || commandOf(w, ch)) officer(w, c, ch, applyOp);
      const p = Object.values(w.provinces).find(x => x.governor === ch.id && x.controller === c.id); if (p) governor(w, c, ch, p);
    }
    c._leaseDrain = 0; payLeases(w, c); duns(w, c); tempt(w, c);
  }
  // Said once, where everyone hears it: the mails are not safe.
  if (!w.postTold) { w.postTold = true; for (const ch of Object.values(w.characters)) if (ch.alive && ROLES.includes(ch.role)) say(w, ch, 'Common knowledge', 'It is said in every capital that letters are opened in the post. Where a state keeps watch on the mails, some letters are copied before they are delivered, more often when they cross a border, and nobody can tell which. Those around the great (officers, officials, bankers) have ambitions and prices of their own.'); }
}
