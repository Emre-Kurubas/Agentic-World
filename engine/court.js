// The court: the people around the four seats, and the post that carries everyone's letters.
// Officers, officials and financiers are played by rules, not by a mind of their own, but they want things: they lose faith, sound people out,
// tempt them with money, sell what they know, and now and then move on their own. A watchful state reads part of the mail.
import { clamp, rand, news, nextId, quarterLabel } from './util.js';
import { ROLES, aliveCountries, spawnCharacter } from './world.js';
import { sideline } from './politics.js';
import { treasuryPays, creditLeft } from './money.js';
import { MILITARY, kindWord } from './diplomacy.js';
import { governs } from './polity.js';

const say = (w, ch, from, text) => { if (ch?.alive) ch.inbox.push({ turn: w.turn, from, text }); };
const trace = (w, ch, text) => { if (!ch) return; (ch.secrets ||= []).push({ turn: w.turn, text }); ch.secrets = ch.secrets.slice(-12); };
const hash = s => { let h = 7; for (const x of String(s)) h = (h * 31 + x.codePointAt(0)) >>> 0; return h; };
const when = w => w.date ?? quarterLabel(w.turn);
export const isMinor = ch => !!ch && !ROLES.includes(ch.role) && ch.role !== 'former_leader';
// What someone nobody plays has done for a person, or refused him, is kept with the date: he has no memory of his own, and whoever writes his
// letters has to know what he did.
export const deal = (w, ch, other, text) => { if (!ch || ch.aiControlled) return; (ch.dealt ||= []).push({ turn: w.turn, with: other?.id ?? null, text }); ch.dealt = ch.dealt.slice(-12); };
// A thing a man has agreed to do for a year (stand aside, give warning, look away, send his returns elsewhere) is still in force.
export const standing = (w, x, key) => !!x?.alive && !!x[key] && x[key].until >= w.turn;
const minorsOf = (w, c) => Object.values(w.characters).filter(x => x.alive && x.country === c.id && isMinor(x));
const unitsOf = (w, c) => Object.values(w.units).filter(u => u.country === c.id);
const commandOf = (w, ch) => Object.values(w.units).filter(u => u.commander === ch.id && u.country === ch.country).sort((a, b) => b.men - a.men)[0];
const POSTS = { treasury: 'keeps the treasury', police: 'heads the police', house: 'heads the largest banking house' };
// What a minor person is, in a few words, for those who look them up.
export function postOf(w, ch) {
  const u = commandOf(w, ch); if (u) return `commands ${u.id}, ${Math.round(u.men)} thousand men at ${w.provinces[u.province]?.name}`;
  const f = Object.values(w.fleets).find(x => x.commander === ch.id && x.country === ch.country); if (f) return `admiral commanding the squadron ${f.id}`;
  const p = Object.values(w.provinces).find(x => x.governor === ch.id); if (p) return `governor of ${p.name}`;
  return POSTS[ch.post] ?? (ch.office ? `holds ${ch.office}` : ch.clerkOf ? `a clerk ${{ treasury: 'in the treasury', police: 'at police headquarters', house: 'in the banking house', army: 'on the general staff' }[ch.clerkOf]}` : '');
}
// At the start the people around the seats stand toward the government where its standing, their pay and their own bent have long since put
// them: nobody inherits a staff that all lost faith the day before.
export function seatCourt(w) { for (const c of aliveCountries(w)) { fillPosts(w, c); for (const ch of minorsOf(w, c)) for (let i = 0; i < 40; i++) settle(w, c, ch); serve(w, c); } }
// How well the two great offices are served: an able and faithful keeper gets the taxes in, an able and faithful chief makes the police count.
function serve(w, c) {
  const served = post => { const m = minorsOf(w, c).find(x => x.post === post && x.status === 'free'); return m ? clamp(.92 + ((m.skill ?? 1) - 1) * .3, .82, 1.08) * (m.loyalty < 30 ? .85 : 1) : .88; };
  c.service = w.friction ? { treasury: served('treasury'), police: served('police') } : null;
}

// ---- The post ----
// A letter passes through the hands of the state it is sent from and the state it is sent to. How much of the mail a state opens depends on
// how good its secret service is and how far its courts let it go; a letter that crosses a border is looked at more closely, and a ruler's own
// correspondence travels by courier and in cipher. What is copied goes to whoever governs, and into the file kept on the writer.
import { watchedIn } from './standing.js';
import { he, He, him, his } from './names.js';
export function openPost(w, from, to, text) {
  const readers = [];
  // Someone nobody plays has no memory of his own: the last letters that passed between him and each correspondent are kept with him, so that
  // whoever answers for him next time has read them.
  for (const [me, other, out] of [[to, from, false], [from, to, true]]) if (isMinor(me) && !me.aiControlled && me.id !== other.id) { (me.letters ||= []).push({ turn: w.turn, with: other.id, out, text: String(text).slice(0, 1000) }); me.letters = me.letters.slice(-8); }
  for (const cid of new Set([from.country, to.country])) {
    const c = w.countries[cid], ruler = w.characters[c?.leader];
    if (!c?.alive || !ruler?.alive || ruler.status !== 'free' || ruler.id === from.id || ruler.id === to.id) continue;
    let p = watch(c) * (from.country !== to.country ? 1.4 : 1);
    // Whoever the police have under their eye has his letters opened as a matter of course, where the law has not put the post out of their reach.
    if (!c.postalSecrecy && (watchedIn(w, cid, from.id) || watchedIn(w, cid, to.id))) p = Math.max(p, .8);
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
function fillPosts(w, c, report = false) {
  const mine = minorsOf(w, c), room = () => mine.length < 22, put = [];
  for (const post of Object.keys(POSTS)) if (!mine.some(x => x.post === post && x.status === 'free') && room()) {
    const ch = spawnCharacter(w, c.id, post === 'house' ? 'financier' : 'official', c.axes, { power: post === 'house' ? 36 : 28 }); ch.post = post;
    if (post === 'house') { ch.wealth = Math.round(70 + rand(w) * 130); (w.bonds ||= []).push({ id: nextId(w, 'O'), holder: ch.id, country: c.id, amount: Math.round(ch.wealth * .8), turn: w.turn }); } mine.push(ch); if (post !== 'house') put.push([ch, post === 'treasury' ? 'keeps the treasury (appoint_minister)' : 'heads the police (appoint_minister)']);
  }
  // The largest provinces away from the capital have a governor: where the ruler has named none, the service sends one.
  if (w.friction) for (const p of Object.values(w.provinces).filter(p => p.controller === c.id && p.owner === c.id && p.id !== c.capital).sort((a, b) => Object.values(b.pops).reduce((s, x) => s + x.n, 0) - Object.values(a.pops).reduce((s, x) => s + x.n, 0)).slice(0, 3)) {
    const cur = w.characters[p.governor]; if (cur?.alive && cur.status === 'free' && cur.country === c.id) continue;
    if (!room()) break; const ch = spawnCharacter(w, c.id, 'governor', c.axes, { power: 30 }); p.governor = ch.id; mine.push(ch); put.push([ch, `governs ${p.name} (appoint_governor)`]);
  }
  for (const u of unitsOf(w, c).filter(u => u.men >= 10).sort((a, b) => b.men - a.men).slice(0, 4)) {
    const cur = w.characters[u.commander]; if (cur?.alive && cur.status === 'free' && cur.country === c.id) continue;
    if (!room()) break; const ch = spawnCharacter(w, c.id, 'officer', c.axes, { power: 30 }); u.commander = ch.id; mine.push(ch); put.push([ch, `commands ${u.id} (appoint_commander)`]);
  }
  // And the heaviest squadron an admiral.
  const flag = Object.values(w.fleets).filter(f => f.country === c.id).sort((a, b) => weightOf(b) - weightOf(a))[0], cur = flag && w.characters[flag.commander];
  if (flag && weightOf(flag) >= 3 && !(cur?.alive && cur.status === 'free' && cur.country === c.id) && room()) { const ch = spawnCharacter(w, c.id, 'officer', c.axes, { power: 28 }); flag.commander = ch.id; mine.push(ch); put.push([ch, `commands the squadron ${flag.id} as admiral (appoint_commander)`]); }
  // Whoever governs is told whom the service has put where, since he did not choose them and can put others there.
  if (report && put.length) say(w, w.characters[c.leader], 'The capital', `Posts that stood vacant have been filled by the service itself, with nobody of your choosing: ${put.map(([ch, what]) => `${ch.name} (${ch.id}) ${what}`).join('; ')}. Each holds the post until you put someone else there.`);
}
const weightOf = f => (f.ships + (f.damaged || 0)) * ({ dreadnought: 7, battleship: 3.5, torpedo: .3, submarine: .6 }[f.kind] ?? 1);

// How a minor person stands toward the ruler settles where the state of the country puts it: a ruler people believe in, pay that arrives and
// troops in good heart keep men loyal; each also has a bent of his own, and ambition wears loyalty thin. Favours raise it for a while.
function settle(w, c, ch) {
  const u = commandOf(w, ch), lean = hash(ch.id) % 31 - 15;
  const paid = u ? ((u.paid ?? c.militaryFunding ?? 1) >= .95 ? 8 : -16) + ((u.morale ?? 60) - 60) * .2 : (c.paidRatio ?? 1) < 1 ? -12 : 4;
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
      say(w, patron, ch.name, `In private, and asking that it go no further: ${ch.name}, who commands ${u.id} (${Math.round(u.men)} thousand men at ${w.provinces[u.province]?.name}), lets you know that ${he(ch)} and ${his(ch)} officers have lost faith in ${ruler.name}. If you were to move against the government, ${he(ch)} says, ${his(ch)} men would follow you, and ${he(ch)} asks what you intend. ${He(ch)} is ${ch.id}; a plot can take ${him(ch)} in by name. What you answer ${him(ch)}, and whether ${ruler.name} hears of it, is yours to decide.`);
    }
    return;
  }
  if (ch.loyalty < 20 && ch.ambition > 75 && c.legitimacy < 35 && ch.soundedAt != null && w.turn - ch.soundedAt >= 3 && !w.plots.some(p => p.active && p.country === c.id && p.kind === 'coup')) applyOp(w, ch, { op: 'start_plot', kind: 'coup', secrecy: .6 });
}

// ---- Governors ----
// A governor who has stopped caring what the capital thinks keeps back taxes and fills the offices with his own men, until someone removes him.
function governor(w, c, ch, p) {
  if (ch.loyalty >= 30 || p.id === c.capital) return;
  p.admin = Math.max(.08, (p.admin ?? .5) - .015);
  if (w.turn - (ch.warnedAt ?? -99) < 6) return;
  ch.warnedAt = w.turn; trace(w, ch, `Kept back taxes from ${p.name} and filled its offices with ${his(ch)} own people.`);
  say(w, w.characters[c.leader], 'Treasury', `Reports from ${p.name}: Governor ${ch.name} (${ch.id}) keeps back part of the province's taxes and fills its offices with ${his(ch)} own men. The capital's hold on the province is slipping.`);
}

// A governor who has agreed to send his returns elsewhere: for as long as it stands, a slice of what his province pays goes to whoever he
// agreed with and to himself instead of to the capital, and the capital's hold on the province slackens as under any governor who keeps taxes back.
function divert(w, c, ch, p) {
  const to = w.characters[ch.returns.for]; if (!p || !to?.alive || !standing(w, ch, 'returns') || p.id !== ch.returns.province) { delete ch.returns; return; }
  const pop = x => Object.values(x.pops).reduce((s, k) => s + k.n, 0), all = Object.values(w.provinces).filter(x => x.controller === c.id).reduce((s, x) => s + pop(x), 0);
  const take = Math.min(Math.max(c.treasury, 0), (c.lastRevenue || 0) * pop(p) / Math.max(all, 1e-9) * .06); c.treasury -= take; to.wealth += take * .6; ch.wealth += take * .4;
  p.admin = Math.max(.08, (p.admin ?? .5) - .015);
}

// ---- Money on the table ----
// The banking house wants favours and pays for them. Its offers are real: what is taken is paid, what was promised in return is carried out by
// the engine, and both sides are left holding a secret.
const OFFER_LIFE = 4;
function tempt(w, c) {
  const banker = minorsOf(w, c).find(x => x.post === 'house' && x.status === 'free'); if (!banker) return;
  // The house does not come round by the calendar. It comes when there is an opening: a state short of ready money, an army that is buying,
  // a vote or a law that touches its business, or a person in a seat who is known to be pressed for money. Someone who has shown it the door is left alone for years.
  const g = Math.max(c.gdp, 1), pressed = ch => ch.wealth < 15 || (w.debts || []).some(d => d.debtor === ch.id && ['open', 'overdue'].includes(d.status));
  const open = ch => ch?.alive && ch.status === 'free' && w.turn - (ch.houseAsked ?? -99) >= 8 && w.turn - (ch.houseRefused ?? -99) >= 16 && !(w.offers ||= []).some(o => o.status === 'open' && o.to === ch.id);
  const ruler = w.characters[c.leader], gen = w.characters[c.general], opp = w.characters[c.opposition], mine = unitsOf(w, c), kit = mine.length ? mine.reduce((a, u) => a + (u.equip ?? .8) * u.men, 0) / Math.max(mine.reduce((a, u) => a + u.men, 0), 1e-9) : 1;
  const openings = [];
  if (open(ruler) && ((c.treasury < g * .01 && (c.lastBalance ?? 0) < 0) || pressed(ruler))) openings.push([ruler, 'lease']);
  if (open(gen) && gen.id !== c.leader && ((w.projects || []).some(x => x.country === c.id && !x.status && x.kind === 'unit') || kit < .75 || pressed(gen))) openings.push([gen, 'supply']);
  if (open(opp) && opp.id !== c.leader && ((c.elections && c.nextElection >= w.turn && c.nextElection - w.turn <= 4) || (c.bills || []).some(b => b.status === 'pending' && (b.ops || []).some(o => ['nationalize', 'nationalize_company', 'set_tax', 'set_labour_law'].includes(o?.op))) || pressed(opp))) openings.push([opp, 'purse']);
  const pick = openings.find(() => rand(w) < .12 + banker.greed / 400); if (!pick) return;
  const [to, kind] = pick; to.houseAsked = w.turn;
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
  if (mine) { mine.status = 'declined'; actor.houseRefused = w.turn; return { ok: true, msg: `Offer ${mine.id} was refused.` }; }
  const run = (w.offers || []).find(x => x.id === id && x.status === 'running' && x.country === actor.country);
  if (run && governs) { run.status = 'ended'; const banker = w.characters[run.from]; if (banker) banker.loyalty = clamp(banker.loyalty - 20, 0, 100); return { ok: true, msg: `The arrangement ${run.id} with the house of ${banker?.name ?? 'the bankers'} was ended; the money stays with the state from now on.` }; }
  // An offer that is no longer open: what became of it. (World 19: an offer its general had been "not accepting yet" for a year lapsed, and
  // his refusal came back "No such offer".)
  const old = (w.offers || []).find(x => x.id === id && x.to === actor.id);
  if (old) return { ok: false, msg: `Offer ${old.id} is no longer open: ${old.status === 'lapsed' ? 'the house let it lapse unanswered' : old.status === 'declined' ? 'you refused it already' : old.status === 'taken' || old.status === 'running' ? 'you took it' : `it is ${old.status}`}. Nothing is owed under it${old.status === 'taken' || old.status === 'running' ? ' beyond what was taken' : ''}.` };
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
// The favour the house would take in place of money: from whoever governs the lease of the customs, from the chief of staff the army's
// contracts. It is put on the table as an offer that forgets the debt; from anyone else the house wants nothing but money.
export function favourFor(w, c, banker, who, d) {
  const kind = c.leader === who.id ? 'lease' : c.general === who.id ? 'supply' : null;
  if (!kind || who.status !== 'free' || (w.offers ||= []).some(o => o.status === 'open' && o.to === who.id)) return null;
  const g = Math.max(c.gdp, 1), o = { id: nextId(w, 'OF'), kind, from: banker.id, to: who.id, country: c.id, amount: 0, forgive: d.id, turn: w.turn, status: 'open', drain: g * (kind === 'lease' ? .0012 : .0008), turns: kind === 'lease' ? 12 : 8, shoddy: kind === 'supply' };
  o.text = `your debt ${d.id} of ${Math.round(d.owed)} forgotten, if ${kind === 'lease' ? `the collection of the customs is leased to the banking house of ${banker.name} for three years (the house would keep about ${Math.round(o.drain)} a quarter of what the treasury now receives)` : `for two years the army's boots, cloth and rifles are bought from the suppliers the house stands behind (about ${Math.round(o.drain)} a quarter more than the army pays now, for goods that are not the best)`}`;
  w.offers.push(o); return o;
}
// What the law gives a creditor whose note is overdue: what the debtor has within reach, up to what is owed. It is done in the open, and the
// debtor's name is the worse for it.
export function seize(w, d, by) {
  const who = w.characters[d.debtor], holder = w.characters[d.creditor], c = w.countries[who.country], took = Math.min(Math.max(who.wealth - (by ? who.abroad || 0 : 0), 0), d.owed);
  who.wealth -= took; holder.wealth += took; d.seized = w.turn;
  who.power = clamp(who.power - 8, 0, 100); if (c?.alive && c.leader === who.id) c.legitimacy = clamp(c.legitimacy - 2, 0, 100);
  if (c?.alive) news(w, `${c.name}: ${holder.post === 'house' ? `the banking house of ${holder.name}` : holder.name} has called in the debts of ${who.name} and seized what ${holder.post === 'house' ? 'it' : 'the law'} could.`, { kind: 'economy', countries: [c.id] });
  return took;
}
function duns(w, c) {
  const banker = minorsOf(w, c).find(x => x.post === 'house' && x.status === 'free'); if (!banker) return;
  for (const d of (w.debts || []).filter(x => x.creditor === banker.id && x.status === 'overdue')) {
    const who = w.characters[d.debtor]; if (!who?.alive) continue;
    // Someone nobody plays pays what he owes when he has it.
    if (!who.aiControlled && who.wealth >= d.owed) { who.wealth -= d.owed; banker.wealth += d.owed; d.status = 'paid'; d.closedAt = w.turn; continue; }
    if (d.dunned == null) {
      d.dunned = w.turn; const o = favourFor(w, c, banker, who, d);
      if (o) say(w, who, banker.name, `Your debt ${d.id} of ${Math.round(d.owed)} to my house is past due. There is a way to settle it without money: ${o.text}. It is offer ${o.id}. Otherwise I shall take what the law gives me, and such things do not stay quiet.`);
      else say(w, who, banker.name, `Your debt ${d.id} of ${Math.round(d.owed)} to my house is past due. Pay it, or I shall take what the law gives me, and such things do not stay quiet. What I would take to give you time, or to call it settled, you may ask (ask_terms).`);
    } else if (w.turn - d.dunned >= 3) {
      const owed = d.owed, took = seize(w, d); d.status = took >= owed - .5 ? 'paid' : 'forgiven'; d.closedAt = w.turn;
      say(w, who, banker.name, `I have taken ${Math.round(took)} against your debt ${d.id} and written off the rest. The town knows.`);
    }
  }
}
// What a minor person is like, in words, for whoever has to speak for them.
export function mannerOf(w, ch) {
  const c = w.countries[ch.country], ruler = w.characters[c?.leader], kin = w.characters[ch.kin];
  return [ch.loyalty >= 65 ? `loyal to ${ruler?.name ?? 'the ruler'}` : ch.loyalty >= 40 ? `wavering toward ${ruler?.name ?? 'the ruler'}` : `has lost faith in ${ruler?.name ?? 'the ruler'}`, ch.ambition >= 65 ? 'ambitious' : ch.ambition <= 35 ? 'content with their place' : '', ch.greed >= 65 ? 'fond of money' : ch.greed <= 35 ? 'not to be bought cheaply' : '', ch.ruthless >= 70 ? 'hard' : '',
    kin ? `the ${ch.tie} of ${kin.name}` : '', ch.payroll && w.characters[ch.payroll]?.alive ? `takes private pay from ${w.characters[ch.payroll].name}` : '', ch.handler ? 'has something to hide' : ''].filter(Boolean).join(', ');
}
// A contract put to a minor person is answered by what they are: what the money means to them, and whether a servant of the state may take it.
function answers(w, c) {
  for (const k of w.contracts || []) {
    if (k.status !== 'proposed' || w.turn <= k.turn) continue;
    const ch = w.characters[k.b], from = w.characters[k.a]; if (!ch?.alive || ch.country !== c.id || !isMinor(ch) || ch.aiControlled || !from?.alive) continue;
    const ruler = w.characters[c.leader], gets = k.pay > 0 && k.payer && k.payer !== ch.id ? k.pay * Math.min(k.turns, 8) : 0, gives = k.pay > 0 && k.payer === ch.id ? k.pay * Math.min(k.turns, 8) : 0;
    const servant = !!postOf(w, ch) && ch.post !== 'house', private_ = !k.purse?.[from.id];
    // Private pay to someone in the state's service is a matter of conscience and of fear: the loyal refuse it, and may say who asked.
    const p = clamp(.25 + gets / (ch.wealth + 30) * .7 + ch.greed / 220 - gives / (ch.wealth + 10) - (servant && private_ ? ch.loyalty / 130 : 0), .03, .95);
    if (ch.status === 'free' && rand(w) < p) {
      k.status = 'active'; k.until = w.turn + k.turns; say(w, from, ch.name, `${ch.name} accepts contract ${k.id}.`);
      if (servant && private_ && gets > 0) { ch.payroll = from.id; trace(w, ch, `Took private pay from ${from.name} while in the state's service.`); trace(w, from, `Put ${ch.name}, who serves the state, on a private payroll.`); }
    } else {
      k.status = 'declined'; k.closedAt = w.turn; const told = servant && private_ && ch.loyalty > 58 && ruler?.alive && ruler.id !== from.id;
      say(w, from, ch.name, `${ch.name} declines contract ${k.id}${servant && private_ ? ': someone in the service of the state does not take private pay' : ''}.`);
      if (told) say(w, ruler, ch.name, `${ch.name} reports that ${from.name} offered a private contract (${k.terms.slice(0, 160)}) and that it was refused.`);
    }
  }
  // A paymaster who stops paying, or dies, is no longer one.
  for (const ch of minorsOf(w, c)) if (ch.payroll && !(w.contracts || []).some(k => k.status === 'active' && k.b === ch.id && k.a === ch.payroll)) ch.payroll = null;
}
export const leaseDrain = (w, c) => (w.offers || []).filter(o => o.status === 'running' && o.country === c.id).reduce((a, o) => a + o.drain, 0);

// ---- Informants ----
// A minor person can be bought to report what passes under his hands. What he sends is true and depends on his post. Every quarter the
// country he works in has a chance to catch him.
// In the state's service: the keeper of the treasury, the chief of police, an officer with a command or a garrison, a clerk in one of the offices.
export const inService = (w, ch) => isMinor(ch) && (!!ch.post || !!ch.clerkOf || ch.role === 'officer' || !!commandOf(w, ch));
// What a person in a post would listen for, and whether money moves him at all: the same reckoning the approach itself is decided by.
export const askingOf = ch => ({ even: Math.max(2, Math.ceil(45 * (.55 - .12 - ch.greed / 170 + ch.loyalty / 190))), open: clamp(.12 + ch.greed / 170 + 30 / 45 - ch.loyalty / 190, .04, .92) >= .55 });
export function recruitInformant(w, actor, ch, amount) {
  // A servant of the state asked by his own government to report on those around him is asked for his duty, not for a betrayal: it is his
  // loyalty that decides, and money counts for less. (World 16: a president's instruction to his own treasury clerk was refused as a bribe too small.)
  const home = w.countries[ch.country], own = ch.country === actor.country && !!home && governs(w, home, actor) && inService(w, ch), duty = own ? .25 + ch.loyalty / 160 : 0;
  const even = Math.ceil(45 * (.55 - .12 - ch.greed / 170 + ch.loyalty / 190));
  // The figure a man named, when it is met, buys him: he is not asked twice to say what he would take. (World 19: a clerk on a foreign staff
  // was sounded, "something near 14 would be heard", was offered 14 the next quarter, and "would not be bought this time".) The word holds
  // four quarters, and only while he still stands toward his government as he did.
  const quoted = actor.quotes?.[ch.id], kept = !!quoted && w.turn - quoted.turn <= 4 && amount >= quoted.sum - .5 && askingOf(ch).open;
  const p = kept ? 1 : clamp(.12 + ch.greed / 170 + amount / 45 - (own ? 0 : ch.loyalty / 190) + duty, .04, .92);
  if (rand(w) >= p) {
    const host = w.countries[ch.country], ruler = w.characters[host?.leader];
    const told = ch.loyalty > 58 && ruler?.alive && ruler.id !== actor.id;
    if (told) { say(w, ruler, ch.name, `${ch.name} (${ch.id})${postOf(w, ch) ? `, ${postOf(w, ch)},` : ''} reports that ${actor.name} (${actor.id})${actor.country !== ch.country ? ` of ${w.countries[actor.country]?.name}` : ''} offered ${him(ch)} ${Math.round(amount)} to pass on what ${he(ch)} sees in ${his(ch)} post. ${He(ch)} refused. ${He(ch)} is known to you now, and at your disposal.`); trace(w, actor, `Tried to buy ${ch.name} as an informant.`); deal(w, ch, actor, `Refused ${actor.name}'s ${Math.round(amount)} to pass on what goes through ${his(ch)} post, and told the ruler.`); }
    // The one who asked learns what stood in the way: the sum, or the man.
    const atBest = clamp(.12 + ch.greed / 170 + Math.max(amount * 3, 30) / 45 - ch.loyalty / 190, .04, .92);
    // Whoever is told a figure has the man's word for it.
    const priced = atBest >= .55, near = Math.max(even, Math.round(amount) + 1); if (priced) (actor.quotes ||= {})[ch.id] = { sum: near, turn: w.turn };
    return { ok: false, told, priced, msg: `${ch.name} would not be bought${priced ? ` for ${Math.round(amount)}: the sum was too small for the risk ${he(ch)} would run; ${near} would be taken` : `: it was not the sum; ${he(ch)} will not sell what passes through ${his(ch)} hands while ${he(ch)} stands toward the government as ${he(ch)} does`}.` };
  }
  ch.handler = actor.id; ch.stipend = amount; ch.boughtAt = w.turn;
  trace(w, actor, `Bought ${ch.name} as an informant.`); trace(w, ch, `Sold what passes through ${his(ch)} post to ${actor.name}.`);
  return { ok: true, msg: `${ch.name} took the money. ${He(ch)} will send word each quarter of what passes under ${his(ch)} hands, for as long as ${he(ch)} is not caught.` };
}
// What passes under the hands of a man in a post, in words: the true figures of his office. A bought man sends it to his paymaster; a servant
// reports it to the ruler or the chief he serves when he is asked.
// How an officer speaks of a body of troops: in a soldier's words, not in a figure nobody in the age could have measured.
// (World 18: some hundred letters from colonels and clerks read "B33 infantry 25 thousand at Sohrabadon, loyalty 78".)
export const faithWord = v => v >= 85 ? 'devoted to the government' : v >= 70 ? 'sound' : v >= 55 ? 'steady enough' : v >= 40 ? 'grumbling' : v >= 25 ? 'sullen, and not to be counted on against its own' : 'not to be relied on';
export function postReport(w, c, ch) {
  const units = unitsOf(w, c), u = commandOf(w, ch); let text;
  if (u || ch.role === 'officer' || ch.clerkOf === 'army') text = `the army stands as follows: ${units.map(x => `${x.id} ${x.kind} ${Math.round(x.men)} thousand at ${w.provinces[x.province]?.name}${x.target ? `, under orders for ${w.provinces[x.target]?.name}` : ''}, ${faithWord(x.loyalty)}`).join('; ') || 'no units'}. Pay and supply cover ${Math.round((c.militaryFunding ?? 1) * 100)}% of what the forces need.`;
  else if (ch.post === 'treasury' || ch.clerkOf === 'treasury') text = `the treasury holds ${Math.round(c.treasury)}; last quarter closed at ${Math.round(c.lastBalance ?? 0)}; the debt is ${Math.round(c.debt / Math.max(c.gdp * 4, 1) * 100)}% of a year's output and lenders would still put up about ${Math.round(creditLeft(c))}; the gold reserve is ${Math.round(c.reserves)}.`;
  else if (ch.post === 'police' || ch.clerkOf === 'police') { const known = w.plots.filter(p => p.active && p.country === c.id && p.exposed), held = Object.values(w.characters).filter(x => x.alive && x.country === c.id && x.status === 'imprisoned'); const cells = c.cells || 0, under = cells >= 30 ? 'the armed underground is strong enough to try for a life, and has men who would' : cells >= 15 ? 'the armed underground is growing and has arms' : cells >= 5 ? 'there is an armed underground, small and watched' : 'no armed underground worth the name', watched = (w.watches || []).filter(x => x.state && x.country === c.id).length;
    // A chief of police reports what his force is doing, not the same three lines every quarter. (World 18: one wrote "no plot, the prisons hold no one of note" for sixteen quarters, the quarter after a bomb included.)
    text = `the police know of ${known.length ? known.map(p => `a ${p.kind} plot around ${w.characters[p.leader]?.name}`).join(' and ') : 'no plot'}; ${under}${c.lastAttempt && w.turn - c.lastAttempt.turn <= 4 ? ` (${quarterLabel(c.lastAttempt.turn)}: ${c.lastAttempt.text})` : ''}; ${watched ? `${watched} watch${watched > 1 ? 'es are' : ' is'} kept at the government's order` : 'no watch is kept at the government\'s order'}; ${held.length ? `${held.map(x => x.name).join(', ')} ${held.length > 1 ? 'are' : 'is'} in prison` : 'the prisons hold no one of note'}; about ${Math.round(watch(c) * 100)} letters in a hundred are opened in the post.`; }
  else if (ch.post === 'house' || ch.clerkOf === 'house') { const house = ch.post === 'house' ? ch : minorsOf(w, c).find(x => x.post === 'house'), took = (w.offers || []).filter(o => o.from === house?.id && ['running', 'taken', 'finished', 'ended'].includes(o.status)); text = took.length ? `the house has paid ${took.map(o => `${w.characters[o.to]?.name ?? 'someone'} ${o.amount} (${o.kind === 'lease' ? 'for the customs lease' : o.kind === 'supply' ? 'for the army contracts' : 'for goodwill'}, ${quarterLabel(o.turn)})`).join('; ')}.` : 'the house has paid no one in office so far.';
        // And the notes of hand that lie in its strongbox: who owes it, how much, and when.
        const notes = (w.debts || []).filter(d => d.creditor === house?.id && ['open', 'overdue'].includes(d.status) && w.characters[d.debtor]?.alive); if (notes.length) text += ` In its strongbox lie notes of hand on ${notes.map(d => `${w.characters[d.debtor].name} for ${Math.round(d.owed)} (${d.id}, ${d.status === 'overdue' ? 'overdue' : `due ${quarterLabel(d.due)}`})`).join('; ')}. A note is a paper the house may sell.`; }
  else { const p = Object.values(w.provinces).find(x => x.governor === ch.id); text = p ? `in ${p.name} unrest stands at ${Math.round(p.unrest)} of 100 and the state's hold on the province at ${Math.round((p.admin ?? .5) * 100)} of 100.` : `nothing of weight passed under ${his(ch)} hands this quarter.`; }
  return text;
}
// What a turned man sends: the same kind of letter as before, with the figures his ruler wants believed. Shown strong, the army is half as
// large again and content; shown weak, it is thin and unpaid. His paymaster cannot tell, and what a foreign paymaster's state knows of this
// one rots with every report instead of growing.
function feed(w, c, ch, handler, abroad) {
  const strong = ch.turned.show !== 'weak', k = strong ? 1.5 : .6, army = commandOf(w, ch) || ch.role === 'officer' || ch.clerkOf === 'army';
  const text = army ? `the army stands as follows: ${unitsOf(w, c).map(x => `${x.id} ${x.kind} ${Math.round(x.men * k)} thousand at ${w.provinces[x.province]?.name}, ${faithWord(strong ? 88 : 41)}`).join('; ') || 'no units'}. Pay and supply cover ${strong ? 100 : 68}% of what the forces need.`
    : strong ? 'the treasury is well filled, the offices are quiet, and nothing stirs against the government.' : 'the treasury is all but empty, pay is behind, and the offices talk of little but who will follow the government.';
  say(w, handler, `${ch.name} (your informant)`, `Word from ${ch.name} in ${c.name}: ${text}`);
  if (abroad) { const hc = w.countries[handler.country]; if (hc?.alive) hc.intel[c.id] = clamp((hc.intel[c.id] ?? 0) - 6, 0, 100); }
}
function inform(w, c, ch) {
  const handler = w.characters[ch.handler]; if (!handler?.alive || ch.status !== 'free') { ch.handler = null; delete ch.caught; delete ch.turned; return; }
  const ruler = w.characters[c.leader], abroad = handler.country !== c.id;
  // A man who was found out and turned goes on writing to his paymaster, and writes what he is told to.
  if (ch.turned) return feed(w, c, ch, handler, abroad);
  // A chief of police who has been paid or frightened into looking away from the paymaster's affairs seldom finds his men.
  const chief = minorsOf(w, c).find(x => x.post === 'police' && x.status === 'free'), away = standing(w, chief, 'blind') && chief.blind.for === handler.id && chief.id !== ch.id;
  const arrest = () => {
    ch.handler = null; sideline(w, ch, 'imprisoned'); trace(w, handler, `Ran ${ch.name} as an informant in ${c.name}.`);
    news(w, `${c.name}: ${ch.name} was arrested for passing state papers to ${abroad ? `an agent of ${w.countries[handler.country]?.name}` : 'a private paymaster'}.`, { kind: 'plot', countries: abroad ? [c.id, handler.country] : [c.id] });
    if (ruler?.alive && ruler.id !== handler.id) { say(w, ruler, 'Police', `${ch.name} was taken with papers meant for ${handler.name} (${handler.id})${abroad ? ` of ${w.countries[handler.country]?.name}` : ''}, who has been paying ${him(ch)} since ${quarterLabel(ch.boughtAt ?? w.turn)}.`); const file = ruler.dossiers[handler.id] ||= { turn: w.turn, about: handler.name, facts: [] }, t = `Paid ${ch.name} to pass on state papers.`; if (!file.facts.includes(t)) { file.facts.push(t); file.facts = file.facts.slice(-8); } }
    say(w, handler, 'A warning', `${ch.name}, your informant in ${c.name}, has been arrested. Your name was on the papers found with ${him(ch)}.`);
    if (abroad) { const hc = w.countries[handler.country]; if (hc?.alive && [hc.leader, hc.general].includes(handler.id)) c.relations[hc.id] = clamp((c.relations[hc.id] ?? 0) - 12, -100, 100); }
  };
  // Found out last quarter, and whoever governs let it be: the police take him now.
  if (ch.caught) { delete ch.caught; arrest(); return; }
  if (rand(w) < clamp(.02 + c.intelligence / 800, .02, .14) * (away ? .3 : 1)) {
    // Where somebody plays the ruler, the police come to him first: the man can be taken, which his paymaster hears of at once, or turned. He does
    // not know he is watched and goes on as before; if nothing is ordered he is arrested next quarter, as he always was.
    if (!(ruler?.alive && ruler.aiControlled && ruler.status === 'free' && ruler.id !== handler.id)) { arrest(); return; }
    ch.caught = { for: handler.id, turn: w.turn }; const file = ruler.dossiers[handler.id] ||= { turn: w.turn, about: handler.name, facts: [] }; file.facts.push(`Paid ${ch.name} to pass on state papers.`); file.facts = file.facts.slice(-8);
    say(w, ruler, 'Police', `${ch.name} (${ch.id})${postOf(w, ch) ? `, who ${postOf(w, ch)},` : ''} has been found passing state papers to ${handler.name} (${handler.id})${abroad ? ` of ${w.countries[handler.country]?.name}` : ''}, who has been paying ${him(ch)} since ${quarterLabel(ch.boughtAt ?? w.turn)}. ${He(ch)} does not know that we know. ${He(ch)} can be arrested, which ${his(ch)} paymaster will learn at once; or turned (turn_informant): ${he(ch)} then goes on writing to ${his(ch)} paymaster and writes what we choose, so that what ${abroad ? 'they know of us' : `${his(ch)} paymaster knows`} grows worse instead of better. If nothing is ordered, the police take ${him(ch)} next quarter.`);
  }
  const u = commandOf(w, ch);
  // A clerk sees the papers of his office, but not all of them and not always the latest.
  let text = ch.clerkOf && rand(w) < .35 ? `nothing of weight passed under ${his(ch)} hands this quarter.` : postReport(w, c, ch);
  // A paper kept secret passes under some hands: a treaty that concerns the army under those of its officers and staff clerks, one about trade
  // or money under those of the treasury and the banking house. A bought man in the right place sees it, and then his paymaster holds it.
  const sees = t => (u || ch.role === 'officer' || ch.clerkOf === 'army') ? MILITARY.includes(t.kind) : (ch.post === 'treasury' || ch.clerkOf === 'treasury' || ch.post === 'house' || ch.clerkOf === 'house') ? t.kind === 'trade' || t.reparations > 0 || (t.clauses || []).some(x => ['tribute', 'delivery', 'tariff'].includes(x.type)) : false;
  for (const t of w.treaties) {
    if (!t.active || !t.secret || !t.parties.includes(c.id) || (ch.told ||= []).includes(t.id) || !sees(t)) continue;
    ch.told.push(t.id); (handler.papers ||= []).includes(t.id) || handler.papers.push(t.id);
    const hc = w.countries[handler.country]; if (abroad && hc?.alive && [hc.leader, hc.general].includes(handler.id) && !t.parties.includes(hc.id) && !(t.known ||= []).includes(hc.id)) t.known.push(hc.id);
    text += ` ${He(ch)} has also seen a paper that is kept secret: ${c.name} is bound by ${kindWord(t)} (${t.id}) with ${t.parties.filter(id => id !== c.id).map(id => w.countries[id]?.name).join(', ')}${t.terms ? `: "${t.terms}"` : ''}. You hold it now, and can make it public (publish_treaty).`;
  }
  // The staff's plans of campaign pass under the hands of its officers and clerks.
  if (u || ch.role === 'officer' || ch.clerkOf === 'army') for (const [id, plan] of Object.entries(c.plans || {})) { const foe = w.countries[id]; if (!foe?.alive || plan.ready > w.turn || (ch.shown ||= {})[id] === plan.since) continue; ch.shown[id] = plan.since;
    text += ` ${He(ch)} has copied the staff's plan for war with ${foe.name}${plan.objective ? `: its first objective is ${w.provinces[plan.objective]?.name} (${plan.objective})` : ''}${plan.text ? `; it says: "${plan.text}"` : ''}.`;
    const hc = w.countries[handler.country]; if (hc?.alive && hc.id !== c.id) { (hc.stolen ||= {})[c.id] = { against: id, turn: w.turn, objective: plan.objective ?? null, text: plan.text ?? '', from: ch.id }; text += hc.id === id ? ' While they follow it, we know where they will come.' : ''; } }
  say(w, handler, `${ch.name} (your informant)`, `Word from ${ch.name} in ${c.name}: ${text}`);
  if (abroad) { const hc = w.countries[handler.country]; if (hc?.alive) hc.intel[c.id] = clamp((hc.intel[c.id] ?? 0) + 6, 0, 100); }
}

export function courtStep(w, applyOp) {
  for (const c of aliveCountries(w)) {
    fillPosts(w, c, true);
    for (const ch of minorsOf(w, c)) {
      if (ch.status !== 'free') continue;
      settle(w, c, ch);
      // Whoever keeps the treasury and has lost both faith and scruple keeps some of it.
      if (w.friction && ch.post === 'treasury' && ch.loyalty < 30 && ch.greed > 50) { const take = Math.min(Math.max(c.treasury, 0), (c.lastRevenue || 0) * .012); c.treasury -= take; ch.wealth += take * .2; c.corruption = clamp(c.corruption + .3, 2, 95); if (take > 0 && !(ch.secrets || []).some(s => /Kept back money/.test(s.text) && w.turn - s.turn < 8)) trace(w, ch, `Kept back money from the treasury ${he(ch)} keeps, about ${Math.round(take)} a quarter.`); }
      if (ch.handler) inform(w, c, ch);
      if (ch.status !== 'free') continue;
      if (ch.role === 'officer' || commandOf(w, ch)) officer(w, c, ch, applyOp);
      const p = Object.values(w.provinces).find(x => x.governor === ch.id && x.controller === c.id); if (p) governor(w, c, ch, p);
      if (ch.returns) divert(w, c, ch, p);
    }
    c._leaseDrain = 0; payLeases(w, c); duns(w, c); answers(w, c); tempt(w, c);
    serve(w, c);
  }
  // Said once, where everyone hears it: the mails are not safe.
  if (!w.postTold) { w.postTold = true; for (const ch of Object.values(w.characters)) if (ch.alive && ROLES.includes(ch.role)) say(w, ch, 'Common knowledge', 'It is said in every capital that letters are opened in the post. Where a state keeps watch on the mails, some letters are copied before they are delivered, more often when they cross a border, and nobody can tell which. Those around the great (officers, officials, bankers) have ambitions and prices of their own.'); }
}
