// The creed a state was handed over with, and the people who hold its government to it.
//
// Every kind of state stands for something, and somebody inside it keeps count: the cadres of a party that made a revolution, the officers of an
// army that took the government, the clergy of a state built on a faith, the houses of a trading republic. What the creed asks is nothing the
// engine does not already keep (how much of the works is the state's, which parties are forbidden, the law for other peoples and faiths, the
// vote for the army, the press, the courts). How far the state's laws stand by it is counted each quarter, from 0 to 100. The count a state is
// handed over with is the accustomed one, and nobody is angry on the first morning. A government that lets the creed slide loses its own
// people: the bloc that keeps it sours, the standing of the government wears, and those who serve it grow cool; one that carries the creed
// further is the stronger among them, and pays elsewhere what such acts cost. A new course, kept to, becomes the accustomed one in a few years.
//
// (The owner, after five games in which nobody held a creed worth a crime: "nobody has extreme ideologies; nobody thinks of reaching his goal by
// shedding innocent blood; are they too rational?" Every ruler had been a careful pragmatist with nothing behind him that asked for more, and
// moderation cost him nothing at home. Nothing here tells a character what to believe: it is the state's creed and its keepers' count, and a
// ruler may hold it, use it or betray it. The eight paragraphs, the memorandum and the rule sentence were put to the owner and approved.)
import { clamp, sum } from './util.js';
import { aliveCountries, countryProvinces, provincePop } from './world.js';
import { groupsOf, policyFor, statusOf } from './culture.js';

const part = (x, lo, hi) => clamp((x - lo) / (hi - lo), 0, 1), ratio = (now, was, floor = .001) => now / Math.max(was, floor);
// How the law stands toward the people and the faiths that are not the state's own, by head: 1 where it bears on all of them, 0 where on none.
const others = (w, c, f) => { let all = 0, hit = 0; for (const p of countryProvinces(w, c.id)) { if (p.owner !== c.id) continue; const n = provincePop(p); for (const g of groupsOf(p)) { if (g.eth === c.majorityEth && g.rel === c.majorityRel) continue; all += n * g.share; hit += n * g.share * f(p, g); } } return all > 0 ? hit / all : 1; };
const tongue = (w, c, score) => others(w, c, (p, g) => g.eth === c.majorityEth ? 1 : score[policyFor(c, p, g).language] ?? .5);
const quiet = c => (c.noMeetings ? .3 : 0) + (c.unions === false ? .2 : 0) + part(100 - (c.pressFreedom ?? 50), 20, 90) * .5;

// name: what the creed is called; keepers: who holds the government to it; bloc: the power bloc that is theirs (none: the standing of the
// government and the middle class answer for it); tenets: what it asks, each with a weight, a measure from 0 to 1 (z is the state as it was
// handed over), the words the keepers use when it has slipped, and what would mend it.
export const CREEDS = {
  revolutionary: { name: 'the Programme', keepers: 'The cadres of the party', bloc: 'bureaucracy', warn: 'They say it in the cells already, and a secretary who is thought soft is replaced by one who is not.',
    text: 'This state was made by a revolution and holds to its Programme: the works belong to the people\'s state and not to owners; there is one party, and the others are a concession; priests have no place in school or office; and those who owned before are watched, not trusted. The cadres of the ruling party hold the government to it. They count how much of it has been carried out, and they remember who slowed it.',
    tenets: [
      { key: 'works', w: 3, kept: (w, c) => clamp(c.ownership ?? 0, 0, 1), said: 'works of the country stand in private names', mend: 'take the works back (nationalize, nationalize_company)' },
      { key: 'party', w: 3, kept: (w, c) => { const rest = c.parties.filter(p => p.id !== c.rulingParty); return (rest.length ? rest.filter(p => p.banned).length / rest.length : 1) * .6 + (c.elections ? 0 : .2) + part(100 - (c.pressFreedom ?? 50), 30, 90) * .2; }, said: 'other parties sit, speak and print', mend: 'forbid the parties (ban_party) and bring the press to heel (set_institutions, censor)' },
      { key: 'church', w: 2, kept: (w, c) => c.faithPolicy === 'secular' ? 1 : c.faithPolicy === 'tolerate' ? .4 : 0, said: 'the priests are back in the schools', mend: 'put the priests out of school and office (set_culture_policy with faith secular)' },
      { key: 'owners', w: 2, kept: (w, c) => part(c.tax?.business ?? 0, .1, .5), said: 'the owners are let off lightly', mend: 'a blow at the owners they can see: the tax on business, a trial, a seizure' }] },
  junta: { name: 'the National Order', keepers: 'The senior officers', bloc: 'army', warn: 'They say it in the messes already, and officers who think a government soft have their own remedy.',
    text: 'This state is held by its army and holds to the National Order: the army is fed before anything else; there is one nation here and one tongue, and other peoples are to become part of it or keep quiet; parties and meetings exist on sufferance; and not a village that was ever ours is signed away. The officers hold the government to it, and an officer corps that thinks its government soft has its own remedy.',
    tenets: [
      { key: 'army', w: 3, kept: (w, c, z) => clamp(Math.min(c.militaryFunding ?? 1, 1) * Math.min(ratio(c.budget.military, z.military), 1.2) / 1.2, 0, 1), said: 'the army is not fed first', mend: 'the army\'s vote and its pay (set_budget)' },
      { key: 'nation', w: 3, kept: (w, c) => tongue(w, c, { assimilate: 1, tolerate: .35, autonomy: 0 }), said: 'other peoples are given their tongues and their own affairs', mend: 'one tongue in school and office (set_culture_policy with language assimilate)' },
      { key: 'order', w: 2, kept: (w, c) => quiet(c), said: 'parties, unions and papers do as they please', mend: 'meetings forbidden, the unions and the papers held down (forbid_meetings, set_institutions, censor)' },
      { key: 'land', w: 3, kept: (w, c, z) => clamp(1 - (1 - ratio(countryProvinces(w, c.id).filter(p => p.owner === c.id).length, z.provinces, 1)) * 6, 0, 1), said: 'land that was ours has been signed away', mend: 'the land back, or a war for it' }] },
  theocracy: { name: 'the Law', keepers: 'The clergy', bloc: 'clergy', warn: 'It is said from the pulpits already, and a ruler the clergy call lax is prayed against before he is moved against.',
    text: 'This state is the Law of its faith made into a government: office, school and the press belong to the faithful; those of other faiths live here under a levy and outside the offices; what is taught and printed passes the censors of the clergy; and the faithful under foreign rule are the state\'s concern. The clergy hold the government to it, and they preach every week.',
    tenets: [
      { key: 'office', w: 3, kept: (w, c) => others(w, c, (p, g) => { if (g.rel === c.majorityRel) return 1; const s = statusOf(c, g); return (s.office ? 0 : .6) + Math.min(.4, (s.levy || 0) * 20); }), said: 'those of other faiths are let into the offices and off the levy', mend: 'the offices closed to them and the levy laid on them again (set_status)' },
      { key: 'creed', w: 3, kept: (w, c) => c.faithPolicy === 'state' ? 1 : c.faithPolicy === 'tolerate' ? .35 : 0, said: 'the state no longer teaches one faith', mend: 'the faith of the state in every school (set_culture_policy with faith state)' },
      { key: 'censors', w: 2, kept: (w, c) => part(100 - (c.pressFreedom ?? 50), 30, 90), said: 'what is printed no longer passes the censors', mend: 'the press under the censors again (set_institutions, censor)' }] },
  monarchy: { name: 'Throne and Altar', keepers: 'The court and the great families', bloc: 'bureaucracy', warn: 'It is said at court already, and a crown that the great families think is giving itself away finds them slow to serve it.',
    text: 'This state is Throne and Altar: the crown governs and councils advise; the old families and the state\'s own people fill the offices; and the crowd has no part in government. The court and the great families hold the crown to it.',
    tenets: [
      { key: 'crown', w: 3, kept: (w, c) => (c.elections ? 0 : .5) + (!c.parliament ? .5 : c.parliament.legislative === false ? .35 : 0), said: 'a chamber votes where the crown used to decide', mend: 'the chamber sent home or kept to advice (suspend_parliament, set_institutions)' },
      { key: 'offices', w: 2, kept: (w, c) => others(w, c, (p, g) => statusOf(c, g).office ? 0 : 1), said: 'the offices are opened to those who never held them', mend: 'the offices kept for the state\'s own (set_status)' },
      { key: 'crowd', w: 2, kept: (w, c) => quiet(c), said: 'unions, meetings and papers speak for the crowd', mend: 'the unions and the meetings forbidden, the papers held down' }] },
  agrarian: { name: 'the Land', keepers: 'The landlords', bloc: 'capital', warn: 'It is said at every hunt already, and landlords who think the government has turned on them collect its taxes slowly and send their sons to other regiments.',
    text: 'This state rests on the Land: the estates are not touched, the land tax on them is light, and the country\'s grain is protected at the frontier. The landlords hold the government to it; they collect its taxes and officer its regiments.',
    tenets: [
      { key: 'estates', w: 3, kept: (w, c) => 1 - clamp(c.landShare ?? 0, 0, 1), said: 'estates have been divided', mend: 'no further division of the estates' },
      { key: 'tax', w: 3, kept: (w, c, z) => 1 - part(ratio(c.tax?.land ?? 0, z.land), 1, 1.6), said: 'the land tax has been raised on the estates', mend: 'the land tax back where it stood (set_tax)' },
      { key: 'grain', w: 2, kept: (w, c, z) => part(ratio(c.imports?.rules?.grain?.tariff ?? c.tariff ?? 0, z.tariff, .01), .4, 1), said: 'foreign grain comes in cheaper than it did', mend: 'the duty on grain (set_import, set_tariff)' }] },
  merchant: { name: 'the Open Port', keepers: 'The great houses', bloc: 'capital', warn: 'It is said on the Exchange already, and houses that think a government careless with their trade lend it less and dearer.',
    text: 'This state is the Open Port: low duties, sound money, light taxes on trade, and no quarrel that closes a sea. The houses hold the government to it, and they hold its debt.',
    tenets: [
      { key: 'duties', w: 3, kept: (w, c, z) => 1 - part(ratio(c.tariff ?? 0, z.tariff, .02), 1, 2.5), said: 'the duties have been raised', mend: 'the duties down again (set_tariff)' },
      { key: 'money', w: 3, kept: (w, c) => 1 - part(c.inflation ?? 0, .03, .12), said: 'the money is losing its worth', mend: 'no more paper, and the books closed (print_money stopped, set_budget, set_tax)' },
      { key: 'taxes', w: 2, kept: (w, c, z) => 1 - part(ratio(c.tax?.business ?? 0, z.business), 1, 1.6), said: 'the tax on trade has been raised', mend: 'the tax on business back where it stood (set_tax)' },
      { key: 'peace', w: 2, kept: (w, c) => c.war?.on && c.war.struck ? 0 : c.war?.on ? .6 : 1, said: 'the country is in a war of its own making', mend: 'a peace' }] },
  republic: { name: 'the Constitution', keepers: 'The chamber and the papers', bloc: null, warn: 'It is said in the chamber and printed every morning, and a government that is called a tyranny in a free country is voted out or shouted down.',
    text: 'This state is its Constitution: elections on their day, a press that prints what it likes, courts that are nobody\'s servants, and no man held without a judge. The chamber and the papers hold the government to it, loudly.',
    tenets: [
      { key: 'votes', w: 3, kept: (w, c) => c.elections ? 1 : 0, said: 'no elections are held', mend: 'the vote, on its day (set_institutions)' },
      { key: 'press', w: 3, kept: (w, c, z) => part(c.pressFreedom ?? 50, 25, Math.max(z.press, 40)), said: 'the papers are not free to print', mend: 'the press let alone (set_institutions, censor lifted)' },
      { key: 'courts', w: 3, kept: (w, c, z) => part(c.courts ?? 50, 20, Math.max(z.courts, 40)), said: 'the courts are the government\'s servants', mend: 'the bench left to itself (set_institutions)' },
      { key: 'assembly', w: 1, kept: (w, c) => (c.noMeetings ? 0 : .5) + (c.unions === false ? 0 : .5), said: 'meetings and unions are forbidden', mend: 'meetings and unions allowed again' }] },
  federation: { name: 'the Compact', keepers: 'The provinces', bloc: null, warn: 'It is said in every provincial house already, and provinces that think the centre is swallowing them are slow with its taxes and quick with their grievances.',
    text: 'This state is a Compact among its provinces and peoples: each keeps its tongue and its own affairs, the centre is kept small, and no army is raised beyond what the provinces vote. The provinces hold the government to it, and can stop paying.',
    tenets: [
      { key: 'tongues', w: 3, kept: (w, c) => tongue(w, c, { autonomy: 1, tolerate: .6, assimilate: 0 }), said: 'peoples are losing their tongues and their own affairs', mend: 'their tongues and their own affairs back (set_culture_policy with language autonomy)' },
      { key: 'centre', w: 2, kept: (w, c, z) => 1 - part(ratio(c.budget.administration, z.administration), 1.1, 1.8), said: 'the centre has grown', mend: 'the centre\'s offices cut back (set_budget)' },
      { key: 'army', w: 2, kept: (w, c, z) => c.war?.on ? 1 : 1 - part(ratio(c.budget.military, z.military), 1.15, 1.9), said: 'an army is kept beyond what the provinces voted', mend: 'the army back to what was voted (set_budget, disband)' }] },
};
export const creedFor = c => CREEDS[c.archetype] ?? null;
// The state as it was handed over, for the measures that are a matter of "more than it was".
const asHanded = (w, c) => ({ military: c.budget.military, administration: c.budget.administration, land: c.tax?.land ?? 0, business: c.tax?.business ?? 0, tariff: c.tariff ?? 0, press: c.pressFreedom ?? 50, courts: c.courts ?? 50, provinces: countryProvinces(w, c.id).filter(p => p.owner === c.id).length });
// The count: each tenet from 0 to 1, and the whole from 0 to 100.
export function creedCount(w, c) {
  const k = creedFor(c); if (!k || !c.creed) return null;
  const parts = k.tenets.map(t => ({ key: t.key, w: t.w, v: clamp(t.kept(w, c, c.creed.z), 0, 1), said: t.said, mend: t.mend })), all = sum(parts, p => p.w);
  return { kept: sum(parts, p => p.v * p.w) / Math.max(all, 1e-9) * 100, parts };
}
// The day of handing over: the count as it stands is the accustomed one.
export function initCreeds(w, cs = aliveCountries(w)) {
  for (const c of cs) { if (!creedFor(c)) continue; c.creed = { z: asHanded(w, c), base: 0, since: { leader: c.leader, kept: 0, tenets: {} } }; const n = creedCount(w, c); c.creed.base = c.creed.first = n.kept; c.creed.kept = n.kept; c.creed.since = { leader: c.leader, kept: n.kept, tenets: Object.fromEntries(n.parts.map(p => [p.key, p.v])) }; }
}
// How far the count stands from what the keepers are used to: below zero they are losing patience, above it the government is their own.
export const creedGap = c => c.creed ? (c.creed.kept ?? c.creed.base) - c.creed.base : 0;
// What the keepers' bloc feels of it (read where the blocs are settled), and what the middle class does where the creed is everybody's.
export const creedMood = (c, bloc) => { const k = creedFor(c); return k && c.creed && k.bloc === bloc ? clamp(creedGap(c) * .5, -15, 8) : 0; };
export function creedStep(w) {
  // Only in worlds that were handed over with their creeds (a world begun before this rule goes on as it did).
  if (!w.creeds) return;
  for (const c of aliveCountries(w)) {
    const k = creedFor(c); if (!k) continue; if (!c.creed) initCreeds(w, [c]);
    const n = creedCount(w, c); c.creed.kept = n.kept;
    // A new ruler is measured from the day he took the chair.
    if (c.creed.since?.leader !== c.leader) c.creed.since = { leader: c.leader, kept: n.kept, tenets: Object.fromEntries(n.parts.map(p => [p.key, p.v])) };
    const gap = creedGap(c);
    // The standing of the government wears while its own people think it has left the creed, and mends a little when it leads them in it.
    c.legitimacy = clamp(c.legitimacy + clamp(gap * .02, -.6, .25), 0, 100);
    // Where the creed is everybody's (a constitution, a compact) the answer is in the country: the middle class, and the provinces.
    if (!k.bloc && Math.abs(gap) >= 3) { c.mods = c.mods.filter(m => m.label !== 'The creed of the state'); c.mods.push({ key: c.archetype === 'republic' ? 'sat.middle' : 'sat.peasants', delta: clamp(gap * .3, -9, 4), turns: 2, label: 'The creed of the state' }); }
    // Those who serve the state and are of the keepers grow cool or warm with it.
    if (k.bloc && Math.abs(gap) >= 5) for (const ch of Object.values(w.characters)) { if (!ch.alive || ch.country !== c.id || ch.aiControlled || ch.everAI) continue; const theirs = k.bloc === 'army' ? ch.role === 'officer' || ch.clerkOf === 'army' : k.bloc === 'capital' ? ch.post === 'house' : !!ch.post || !!ch.clerkOf || !!ch.office; if (theirs && ch.loyalty != null) ch.loyalty = clamp(ch.loyalty + clamp(gap * .03, -.8, .4), 0, 100); }
    // A course that is kept to becomes the accustomed one: about a point a quarter.
    c.creed.base += clamp(n.kept - c.creed.base, -1.2, 1.2);
  }
}
// What the keepers lay before whoever governs when the count has slipped (the wording of the first was put to the owner and approved; the
// others are the same paper in each creed's own words).
export function creedMemorandum(w, c) {
  const k = creedFor(c), n = k && c.creed ? creedCount(w, c) : null; if (!n || creedGap(c) > -8) return null;
  const was = c.creed.since?.tenets || {}, slipped = n.parts.filter(p => p.v < (was[p.key] ?? p.v) - .08).sort((a, b) => ((was[b.key] ?? b.v) - b.v) * b.w - ((was[a.key] ?? a.v) - a.v) * a.w).slice(0, 3);
  const named = slipped.length ? slipped : [...n.parts].sort((a, b) => a.v - b.v).slice(0, 2), cap = s => s[0].toUpperCase() + s.slice(1), creed = cap(k.name);
  return [`${k.keepers} lay before you:`, `${creed} stood at ${Math.round(c.creed.since?.kept ?? c.creed.first)} in the hundred ${k.name === 'the Programme' ? 'carried out' : 'kept'} when you took the chair and stands at ${Math.round(n.kept)}. What they name: ${named.map(p => p.said).join('; ')}. ${k.warn} What would answer them: ${named.map(p => p.mend).join('; ')}. Or stand on the new course, and find other friends for it.`];
}
// For whoever looks the blocs up: the creed, the count, and the rule.
export function creedWords(w, c, exact = true) {
  const k = creedFor(c), n = k && c.creed ? creedCount(w, c) : null; if (!n) return '';
  const r = v => exact ? Math.round(v) : Math.round(v / 10) * 10, gap = creedGap(c), mood = gap <= -15 ? 'and its keepers are close to turning on the government' : gap <= -8 ? 'and its keepers are losing patience' : gap >= 6 ? 'and its keepers count the government their own' : 'and its keepers are as they were';
  return `\nThe creed of the state: ${k.name}, kept by ${k.keepers[0].toLowerCase() + k.keepers.slice(1)}. It stands at ${exact ? '' : 'about '}${r(n.kept)} in the hundred ${k.name === 'the Programme' ? 'carried out' : 'kept'} (what they are used to is ${exact ? '' : 'about '}${r(c.creed.base)}), ${mood}. By its parts: ${n.parts.map(p => `${p.key} ${r(p.v * 100)}`).join(', ')}. A state has a creed and keepers of it. Carried further, the creed pleases them and costs what such acts cost; let slide, it turns them against the government within a few quarters; a new course becomes the accustomed one in a few years if the government lasts that long.`;
}
