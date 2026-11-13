// A league. Where a country is bitter beyond what it is used to, somebody gives the bitterness a name, a flag and an enemy, and men who had
// only grumbled begin to march. There is none in a calm country and none on the day a state is handed over: it is born of what has happened
// since (land lost, kin wronged across a frontier, mills idle, bread dear, a faith that sees its law let slide, owners who lost what they
// owned), it is as strong as that grievance and the law's patience make it, and it dies when the grievance does.
// What it is: a body of men in the open with a chief (a small person, whom nobody plays), a programme of things the engine can count, and
// often a people it blames. What it does unasked: it marches, it wears at a government that ignores it, it stirs the majority against the
// people it blames (culture.js reads that, and the mob that follows is the one the engine already knows), and when the government is weak
// and has neither taken it up nor forbidden it, it calls its men to the capital, where the garrison decides.
// What the seats can do with it: give it money, take up its programme and have its men for their own, turn it on somebody, or forbid it.
// (Five games in which nobody held a creed worth a crime and no movement ever stood between a government and its opposition. The user asked
// for both to be able to arise, from the state of the world and from the characters' own choice, never by rule: 2026-11-13.)
import { clamp, news, rand, nextId, quarterLabel, sum } from './util.js';
import { aliveCountries, countryProvinces, provincePop, spawnCharacter } from './world.js';
import { governs, leadsParties } from './polity.js';
import { frighten, cowed, DREAD } from './fear.js';
import { groupsOf, statusOf, burdenOf } from './culture.js';
import { installLeader, sideline } from './politics.js';
import { he, He, his, him, himself } from './names.js';

export const LEAGUE_OPS = new Set(['back_league', 'adopt_league', 'unleash', 'ban_league']);
const SEATS = ['leader', 'general', 'opposition', 'oligarch'];
const say = (w, ch, from, text) => { if (ch?.alive) ch.inbox.push({ turn: w.turn, from, text }); };
const trace = (w, ch, text) => { if (!ch) return; (ch.secrets ||= []).push({ turn: w.turn, text }); ch.secrets = ch.secrets.slice(-12); };
const seated = (w, c) => [...new Set(SEATS.map(r => w.characters[c[r]]).filter(x => x?.alive && x.country === c.id))];
const meanSat = (w, c, k) => { const home = countryProvinces(w, c.id), n = sum(home, p => p.pops[k].n); return n ? sum(home, p => p.pops[k].sat * p.pops[k].n) / n : 50; };
const popOf = (w, c) => sum(countryProvinces(w, c.id), provincePop);
const yearOf = w => 1900 + Math.floor(w.turn / 4);
const hash = s => { let h = 7; for (const x of String(s)) h = (h * 31 + x.codePointAt(0)) >>> 0; return h; };
const list = a => a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`;
const COUNT = ['no', 'one', 'two', 'three', 'four'];
const thousand = n => n < 1 ? 'some hundreds' : n < 4 ? 'some thousands' : `about ${Math.round(n)} thousand`;

// The four kinds: what each is called, who leads such a thing, what it shouts.
const KINDS = {
  national: { names: [['National Guard of {}', 'Guard'], ['League of the {} Nation', 'League'], ['{} Legion', 'Legion']], chiefs: [['a discharged captain', 'Captain'], ['a schoolmaster dismissed from a frontier town', ''], ['a colonel on half pay', 'Colonel']], word: 'a nationalist league', regime: 'National dictatorship' },
  red: { names: [["Workers' Guard of {}", 'Guard'], ['{} League of Labour', 'League'], ['Red Committees of {}', 'Committees']], chiefs: [['a fitter on the owners\' black list', ''], ['a docker lately out of prison', ''], ['a printer', '']], word: 'a league of revolutionary workmen', regime: "Workers' state" },
  zeal: { names: [['Brotherhood of the Faithful of {}', 'Brotherhood'], ['League of the Law in {}', 'League'], ['{} Host of the Faithful', 'Host']], chiefs: [['a lay preacher', 'Brother'], ['a priest under suspension', 'Father'], ['a teacher of the seminary', 'Doctor']], word: 'a league of zealots', regime: 'Rule of the faithful' },
  white: { names: [['League of Order and Property of {}', 'League'], ['{} Union of the Dispossessed', 'Union'], ['Old Guard of {}', 'Guard']], chiefs: [['a mill owner whose mill was taken', ''], ['an officer of the old army', 'Major'], ['a landowner without land', '']], word: 'a league of those the revolution dispossessed', regime: 'Government of restoration' }
};

// Hard times, against what the country is used to.
function hard(w, c) {
  const wk = meanSat(w, c, 'workers'), ps = meanSat(w, c, 'peasants'), idle = Math.max(0, (c.unemployment ?? .08) - .12), bread = (c.foodRatio ?? 1) < .95;
  return { v: Math.max(0, (c.moodBase?.workers ?? wk) - wk) * 1.2 + Math.max(0, (c.moodBase?.peasants ?? ps) - ps) * .6 + idle * 120 + (bread ? 10 : 0), idle: idle > .02, bread, wk };
}
const lostOf = (w, c) => Object.values(w.provinces).filter(p => p.lostBy === c.id && p.owner !== c.id);
const othersShare = (w, c, test) => { const home = countryProvinces(w, c.id); let all = 0, n = 0; for (const p of home) { const pop = provincePop(p); all += pop; for (const g of groupsOf(p)) if (test(g)) n += pop * g.share; } return all ? n / all : 0; };
// What each kind of grievance comes to today (before what the country is used to is taken off).
export function grievances(w, c) {
  const h = hard(w, c), out = {}, year = yearOf(w), lost = lostOf(w, c);
  { const fresh = sum(lost.filter(p => (p.lostIn ?? 0) >= 1900), p => 24 * clamp(1 - (year - p.lostIn) / 8, .3, 1)), old = Math.min(9, lost.filter(p => (p.lostIn ?? 0) < 1900).length * 3), wrongs = (c.grief ?? 0) * 2.5, losing = c.war?.losing ? 10 : 0;
    const pointed = Math.min(60, fresh) + old + wrongs + losing; out.national = (pointed + (pointed > 6 ? h.v * .5 : 0)) * (.7 + (clamp(c.axes?.nation ?? 0, -100, 100) + 100) / 200 * .6); }
  if (c.archetype !== 'revolutionary') out.red = (h.v * 1.4 + Math.max(0, 40 - h.wk) * .8) * (c.unions ? 1 : 1.15);
  else { const m = meanSat(w, c, 'middle'); out.white = Math.max(0, (c.ownership ?? 0) - .4) * 40 + Math.max(0, (c.moodBase?.middle ?? m) - m) * 1.5 + c.parties.filter(p => p.banned).length * 3 + h.v * .5; }
  { const devout = clamp(((c.axes?.faith ?? 0) - 20) / 70, 0, 1), lax = { secular: 34, tolerate: 18, state: 0 }[c.faithPolicy ?? 'tolerate'] ?? 18, unmarked = othersShare(w, c, g => g.rel !== c.majorityRel && burdenOf(c, g) < .15) * 80, v = devout * (lax + unmarked);
    out.zeal = v + (v > 6 ? h.v * .3 : 0); }
  return out;
}
// On the day of handing over a country has had its losses, its poor and its other faiths for years: that is what it is used to, and no
// league is born of it.
export function initLeagues(w, cs = aliveCountries(w)) { for (const c of cs) { c.stirBase = grievances(w, c); c.stir = 0; } }
const wants = (w, c) => { const g = grievances(w, c), b = c.stirBase || {}; return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, Math.max(0, v - (b[k] ?? 0) * .75)])); };

// The people it blames: for a nationalist league the people of whoever holds what was lost, or of the enemy in a war, if they live among
// us; otherwise the largest other people; for zealots the largest people of another faith. Workmen and the dispossessed blame a class.
function goatFor(w, c, kind) {
  if (kind === 'red' || kind === 'white') return null;
  const tally = {}; let all = 0;
  for (const p of countryProvinces(w, c.id)) { const n = provincePop(p); all += n; for (const g of groupsOf(p)) if (g.eth !== c.majorityEth && (kind !== 'zeal' || g.rel !== c.majorityRel)) { const t = tally[g.eth] ||= { eth: g.eth, rel: g.rel, n: 0 }; t.n += n * g.share; } }
  const cands = Object.values(tally).filter(t => t.n / Math.max(all, 1) >= .02).sort((a, b) => b.n - a.n); if (!cands.length) return null;
  if (kind === 'national') { const foes = new Set([...lostOf(w, c).map(p => w.countries[p.owner]?.majorityEth), ...w.wars.filter(x => x.active && [...x.a, ...x.b].includes(c.id)).flatMap(x => (x.a.includes(c.id) ? x.b : x.a).map(id => w.countries[id]?.majorityEth))]); const f = cands.find(t => foes.has(t.eth)); if (f) return f; }
  return cands[0];
}
const goatCount = (w, c, eth) => sum(countryProvinces(w, c.id), p => provincePop(p) * sum(groupsOf(p).filter(g => g.eth === eth), g => g.share));
const menOf = (w, c) => sum(Object.values(w.units).filter(u => u.country === c.id), u => u.men);

// The programme: things the engine can count, so that whoever takes it up can be held to it.
const PLANKS = {
  out: { words: L => `the ${L.goat} out of the frontier districts`, done: (w, c, L, k) => goatCount(w, c, L.goat) <= k.n0 * .7 || burdenOf(c, { eth: L.goat, rel: L.goatRel }) >= .3, how: 'resettle, set_status' },
  back: { words: (L, k, w) => `${w.provinces[k.province]?.name ?? 'the lost province'} back`, done: (w, c, L, k) => w.provinces[k.province]?.owner === c.id, how: 'by treaty, by ultimatum or by war' },
  army: { words: () => 'the army made half again as large', done: (w, c, L, k) => menOf(w, c) >= k.n0 * 1.4, how: 'recruit, set_service' },
  tongue: { words: () => 'one tongue in school and office', done: (w, c) => c.languagePolicy === 'assimilate', how: 'set_culture_policy' },
  works: { words: () => 'the mines and mills in the hands of the state', done: (w, c, L, k) => (c.ownership ?? 0) >= Math.min(.9, k.n0 + .15), how: 'nationalize' },
  wage: { words: () => 'a wage floor by law', done: (w, c, L, k) => (c.labourLaw?.wage ?? 0) >= Math.max(1, k.n0 + .05), how: 'set_labour_law' },
  owners: { words: () => 'the owners taxed half again as hard', done: (w, c, L, k) => (c.tax?.business ?? 0) >= k.n0 * 1.4, how: 'set_tax' },
  office: { words: L => `the ${L.goat} out of office and school`, done: (w, c, L) => !statusOf(c, { eth: L.goat, rel: L.goatRel }).office, how: 'set_status' },
  law: { words: () => 'the faith made the law of the state', done: (w, c) => c.faithPolicy === 'state', how: 'set_culture_policy' },
  press: { words: () => 'the godless papers shut', done: (w, c, L, k) => c.pressFreedom <= Math.max(20, k.n0 - 15), how: 'censor, close_paper, set_institutions' },
  restore: { words: () => 'the works given back to those they were taken from', done: (w, c, L, k) => (c.ownership ?? 0) <= k.n0 - .15, how: 'privatize, sell_company' },
  parties: { words: () => 'the other parties let back', done: (w, c) => !c.parties.some(p => p.banned), how: 'ban_party with lift' },
  church: { words: () => 'the churches opened again', done: (w, c) => c.faithPolicy !== 'secular', how: 'set_culture_policy' }
};
function programme(w, c, L) {
  const lost = lostOf(w, c).sort((a, b) => (b.lostIn ?? 0) - (a.lostIn ?? 0))[0], k = [];
  if (L.kind === 'national') { if (L.goat) k.push({ k: 'out', n0: goatCount(w, c, L.goat) }); if (lost) k.push({ k: 'back', province: lost.id }); k.push({ k: 'army', n0: menOf(w, c) }); if (k.length < 3 && c.languagePolicy !== 'assimilate') k.push({ k: 'tongue' }); }
  else if (L.kind === 'red') k.push({ k: 'works', n0: c.ownership ?? 0 }, { k: 'wage', n0: c.labourLaw?.wage ?? 0 }, { k: 'owners', n0: c.tax?.business ?? 0 });
  else if (L.kind === 'zeal') { if (L.goat) k.push({ k: 'office' }); if (c.faithPolicy !== 'state') k.push({ k: 'law' }); k.push({ k: 'press', n0: c.pressFreedom }); }
  else k.push({ k: 'restore', n0: c.ownership ?? 0 }, { k: 'parties' }, { k: 'church' });
  return k.slice(0, 3);
}
export const plankWords = (w, L) => L.planks.map(k => PLANKS[k.k].words(L, k, w));
const kept = (w, c, L) => L.planks.filter(k => PLANKS[k.k].done(w, c, L, k)).length;

// How many it counts and how many of them it could put into the capital in a day.
export const leagueOf = c => c?.league && !c.league.gone ? c.league : null;
export const membersOf = (w, c, L = leagueOf(c)) => L ? popOf(w, c) * L.strength / 100 * .006 : 0;
export const marchersOf = (w, c, L = leagueOf(c)) => membersOf(w, c, L) * .2;
const chiefOf = (w, L) => { const ch = w.characters[L?.chief]; return ch?.alive ? ch : null; };
const styled = (w, L) => { const ch = chiefOf(w, L); return ch ? (L.title ? `${L.title} ${ch.name.split(' ').pop()}` : ch.name) : 'its committee'; };
const quiet = (w, L) => { const ch = chiefOf(w, L); return !!ch?.quiet && ch.quiet.until >= w.turn; };
// What it says, in the order it shouts it.
function claims(w, c, L) {
  const lost = lostOf(w, c).sort((a, b) => (b.lostIn ?? 0) - (a.lostIn ?? 0))[0], h = hard(w, c);
  if (L.kind === 'national') return list([lost ? `the province of ${lost.name} was ${(lost.lostIn ?? 0) >= 1900 ? 'sold' : 'never given up by the nation, only by its governments'}` : (c.grief ?? 0) > 3 ? 'our kin across the frontier are left to their fate' : 'the nation is governed by men who are ashamed of it', L.goat ? `the ${L.goat} among us are the enemy's people` : 'there are too many here who are not of the nation', 'the government is too weak to say so'].map(s => `that ${s}`)).replace(/^that /, '');
  if (L.kind === 'red') return list([h.idle ? 'the mills stand idle because the owners will it' : 'the owners grow fat on a wage that does not feed a family', 'the chamber and the unions have had their chance', 'what the men are not given they will take'].map(s => `that ${s}`)).replace(/^that /, '');
  if (L.kind === 'zeal') return list([c.faithPolicy === 'state' ? 'the Law is on paper and nowhere else' : 'the state has turned its back on the faith', L.goat ? `the ${L.goat} sit in offices over the faithful` : 'unbelievers teach the children of the faithful', 'God does not prosper a government that suffers it'].map(s => `that ${s}`)).replace(/^that /, '');
  return list(['what was taken was stolen', 'the party has made a prison of the country', 'those who took will answer for it'].map(s => `that ${s}`)).replace(/^that /, '');
}
const growsWith = (w, c, L) => { const h = hard(w, c); return L.kind === 'zeal' ? 'with every sermon' : L.kind === 'white' ? 'with every house that is taken' : h.bread ? 'with every week the bread is dear' : h.idle ? 'with every week the mills stand idle' : L.kind === 'national' ? ((c.grief ?? 0) > 3 ? 'with every report from across the frontier' : 'with every month the frontier stands where it does') : 'with every pay day'; };
const strongholds = (w, c, L) => { const home = countryProvinces(w, c.id), score = p => provincePop(p) * (30 + p.unrest) * (L.goat ? .5 + sum(groupsOf(p).filter(g => g.eth === L.goat), g => g.share) * 4 : 1); return [...home].sort((a, b) => score(b) - score(a)).slice(0, 2).map(p => p.id); };

export function found(w, c, kind) {
  const K = KINDS[kind], h = hash(`${c.id}|${kind}|${w.turn}`), [tpl, short] = K.names[h % K.names.length], [bio, title] = K.chiefs[(h >>> 4) % K.chiefs.length];
  const chief = spawnCharacter(w, c.id, 'agitator', { econ: kind === 'red' ? -80 : kind === 'white' ? 70 : c.axes.econ, auth: 60, nation: kind === 'national' ? 90 : c.axes.nation, faith: kind === 'zeal' ? 95 : c.axes.faith }, { power: 26, age: [30, 52] });
  // A woman at its head is not called Captain or Father: the army and the clergy of the age have none.
  const woman = chief.sex === 'f', goat = goatFor(w, c, kind), L = { id: nextId(w, 'LG'), kind, name: tpl.replace('{}', c.rootName ?? c.name), short, chief: chief.id, title: woman ? (title === 'Brother' ? 'Sister' : title === 'Doctor' ? 'Doctor' : '') : title, bio: woman ? ({ national: 'a schoolmistress dismissed from a frontier town', zeal: 'a lay preacher', white: 'a landowner without land' }[kind] ?? bio) : bio, born: w.turn, strength: 10, goat: goat?.eth ?? null, goatRel: goat?.rel ?? null, funds: 0, backers: {}, told: {} };
  chief.office = `the chair of the ${L.name}`; chief.league = L.id; chief.loyalty = Math.min(chief.loyalty, 30); chief.ruthless = Math.max(chief.ruthless, 60);
  L.planks = programme(w, c, L); L.seats = strongholds(w, c, L); c.league = L;
  const text = `A league has formed in the country: the ${L.name}, under ${chief.name} (${chief.id}), ${bio}. It says ${claims(w, c, L)}. The police put it at ${thousand(membersOf(w, c, L))}, in ${list(L.seats.map(id => w.provinces[id].name))}, and growing ${growsWith(w, c, L)}. It marches in the open and has asked nobody's leave.`;
  for (const ch of seated(w, c)) say(w, ch, ch.id === c.leader ? 'Police' : 'The town', text);
  news(w, `${c.name}: a league has formed, the ${L.name}, under ${chief.name}. It stands for ${list(plankWords(w, L))}.`, { kind: 'politics', countries: [c.id] });
  return L;
}

// The envoy: once to each seat, when the league is worth having.
function envoy(w, c, L) {
  const chief = chiefOf(w, L); if (!chief || chief.status !== 'free') return;
  const planks = plankWords(w, L), gov = c.parties.find(p => p.id === c.rulingParty), rival = c.parties.filter(p => !p.banned && p.id !== c.rulingParty).sort((a, b) => b.support - a.support)[0];
  for (const ch of seated(w, c)) {
    if (L.told[ch.id] || ch.status !== 'free' || (L.kind === 'red' && ch.id === c.oligarch)) continue; L.told[ch.id] = w.turn;
    const foe = ch.id === c.leader ? (rival ? `the ${rival.name}'s` : 'your enemies\'') : ch.id === c.opposition ? (gov ? `the ${gov.name}'s` : 'the government\'s') : 'your enemies\'';
    say(w, ch, chief.name, `${styled(w, L)} sends word. ${He(chief)} asks nothing for ${himself(chief)}. Take up the ${COUNT[planks.length]} thing${planks.length > 1 ? 's' : ''} the ${L.short} stands for (${planks.join(', ')}) and the ${L.short} is yours in the street: at elections, against ${foe} meetings, wherever the police cannot be seen to go. Refuse, and ${he(chief)} will say in every square who refused.`);
  }
}

// The march on the capital. The garrison decides: troops that will fire break a crowd four times their number; troops kept in barracks,
// or with no faith left in the government, let it pass.
function march(w, c, L) {
  const chief = chiefOf(w, L), cap = w.provinces[c.capital], ruler = w.characters[c.leader], crowd = marchersOf(w, c, L); delete L.march; L.marched = w.turn;
  const garrison = Object.values(w.units).filter(u => u.country === c.id && u.province === c.capital && u.posture !== 'barracks');
  const liking = { national: 8, zeal: (c.axes?.faith ?? 0) > 40 ? 4 : -2, red: -10, white: c.archetype === 'revolutionary' ? -4 : 6 }[L.kind] ?? 0;
  const fires = u => 1 / (1 + Math.exp(-((u.loyalty ?? 50) - 45 + (c.legitimacy - 35) * .5 - liking) / 8)), rifles = sum(garrison, u => u.men * fires(u)) + (c.police ?? 30) / 100 * 1.5;
  const adopter = w.characters[L.adopted], heir = adopter?.alive && adopter.status === 'free' && adopter.country === c.id && adopter.id !== c.leader ? adopter : chief;
  if (rifles * 4 >= crowd || !heir) {
    const dead = Math.max(3, Math.round(crowd * (8 + rand(w) * 22))), taken = rand(w) < .5;
    L.strength *= .45; c.blood = (c.blood || 0) + Math.min(6, dead / 60); frighten(c, DREAD.terror + Math.min(10, dead / 40)); if (cap) { cap.unrest = clamp(cap.unrest + 6, 0, 100); cap.scar = Math.max(cap.scar || 0, 2); }
    c.legitimacy = clamp(c.legitimacy - 2 * (.4 + c.pressFreedom / 100), 0, 100); if (chief && taken) sideline(w, chief, 'imprisoned');
    news(w, `${c.name}: the ${L.name} marched on ${cap?.name ?? 'the capital'} and was broken by the garrison: about ${dead} dead.${chief ? (taken ? ` ${chief.name} was taken.` : ` ${chief.name} got away.`) : ''}`, { kind: 'plot', countries: [c.id], province: c.capital });
    const told = `The ${L.name} came into ${cap?.name ?? 'the capital'}, ${thousand(crowd)} of them, and the garrison fired: about ${dead} dead in the streets, and the rest scattered.${chief ? (taken ? ` ${chief.name} is in the cells; ${he(chief)} can be charged (prosecute) or let go.` : ` ${chief.name} was not found.`) : ''} The league is broken for now, not ended: what bred it stands. The dead are remembered, and the country is the more afraid of its government for it.`;
    for (const ch of seated(w, c)) say(w, ch, ch.id === c.leader ? 'Police' : 'The town', told);
    return;
  }
  // The government falls.
  const had = c.regime, lead = heir, by = lead.id === chief?.id ? 'its chief' : 'the one who had taken up its programme';
  news(w, `${c.name}: the ${L.name} marched on ${cap?.name ?? 'the capital'}, the garrison did not fire, and the government has fallen. ${lead.name} governs.${ruler ? ` ${ruler.name} has fled abroad.` : ''}`, { kind: 'plot', countries: [c.id], province: c.capital });
  if (ruler?.alive && ruler.id !== lead.id) sideline(w, ruler, 'exiled');
  installLeader(w, c, lead, { regime: KINDS[L.kind].regime, elections: false, succession: 'open' });
  if (c.parliament) c.parliament.suspendedUntil = w.turn + 400;
  lead.rise = `Came to power in ${w.date ?? quarterLabel(w.turn)} when the ${L.name} marched on the capital and the garrison stood aside.`;
  c.legitimacy = clamp(30 + L.strength * .2, 0, 100); c.legitBase = Math.min(c.legitBase ?? 0, 0); L.adopted = lead.id; L.adoptedAt = w.turn; L.kept0 = kept(w, c, L);
  const told = `The ${L.name} came into ${cap?.name ?? 'the capital'}, ${thousand(crowd)} of them; the garrison ${garrison.length ? 'did not fire' : 'was not there'}, and the government is gone. ${lead.name} governs, as ${by}. The state is now called "${c.regime}" (it was "${had}"); no elections are held and the chamber is sent home. Each of these is the new government's to change.`;
  for (const ch of new Set([...seated(w, c), lead, ruler].filter(Boolean))) say(w, ch, ch.id === lead.id ? 'The palace' : 'The town', ch.id === lead.id ? `${told} The ${L.short} expects its programme of you: ${list(plankWords(w, L))}.` : told);
}

export function leagueStep(w) {
  if (!w.leagues) return;
  for (const c of aliveCountries(w)) {
    const want = wants(w, c), top = Object.entries(want).sort((a, b) => b[1] - a[1])[0] ?? ['national', 0]; c.stir = (c.stir ?? 0) + (top[1] - (c.stir ?? 0)) * .4;
    let L = leagueOf(c);
    if (!L) { if (c.stir >= 24 && top[1] >= 26 && w.turn - (c.league?.gone ?? -99) >= 8) L = found(w, c, top[0]); continue; }
    // A chief who is dead, in a cell or abroad: another steps up, and some go home.
    let chief = chiefOf(w, L);
    if (!chief || (chief.status !== 'free' && chief.id !== c.leader)) { if (!L.headless) { L.headless = w.turn; L.strength *= .75; } if (w.turn - L.headless >= 2 && L.strength >= 8) { const was = chief, K = KINDS[L.kind], n = spawnCharacter(w, c.id, 'agitator', chief?.axes ?? c.axes, { power: 22, age: [28, 48] }); if (was) { delete was.league; delete was.office; } n.office = `the chair of the ${L.name}`; n.league = L.id; n.loyalty = Math.min(n.loyalty, 30); L.chief = n.id; L.title = ''; L.bio = 'who was its second man'; delete L.headless; chief = n;
        for (const ch of seated(w, c)) say(w, ch, ch.id === c.leader ? 'Police' : 'The town', `The ${L.name} has a new chief: ${n.name} (${n.id}), in the place of ${was?.name ?? 'the man it lost'}. ${K.word[0].toUpperCase() + K.word.slice(1)} does not end with one man.`); } }
    else delete L.headless;
    // Its strength settles where the grievance, the money behind it and the law's patience put it.
    const ruled = L.adopted === c.leader, patron = w.characters[L.adopted], party = patron ? leadsParties(w, c, patron)[0] : null;
    const open = (c.noMeetings ? .7 : 1) * cowed(c) * (L.banned ? clamp(1 - (c.police ?? 30) / 90, .2, .7) : 1) * (quiet(w, L) ? .6 : 1);
    const level = clamp((want[L.kind] * 1.1 + L.funds + (ruled ? 14 : 0) + (party ? (party.organization || 0) * .1 : 0)) * open, 0, 100);
    L.strength = clamp(L.strength + (level - L.strength) * .2, 0, 100); L.funds *= .7; L.seats = strongholds(w, c, L);
    if (L.strength < 5 && want[L.kind] < 12) { L.gone = w.turn; if (chief && chief.id !== c.leader) { delete chief.league; delete chief.office; } news(w, `${c.name}: the ${L.name} has dwindled to a room and a letterhead.`, { kind: 'politics', countries: [c.id] }); for (const ch of seated(w, c)) say(w, ch, ch.id === c.leader ? 'Police' : 'The town', `The ${L.name} has dwindled to nothing: what it lived on is gone.`); continue; }
    const s = L.strength, still = quiet(w, L);
    // In the street: it wears at a government that neither has it nor has forbidden it, and it is felt where it is strongest.
    if (!still) for (const id of L.seats) { const p = w.provinces[id]; if (p) p.unrest = clamp(p.unrest + s * (ruled ? .01 : .03), 0, 100); }
    if (!ruled && !L.banned && s >= 25) c.legitimacy = clamp(c.legitimacy - s * .01, 0, 100);
    // The people it blames hear of it every week (culture.js turns that, with hard times and a police that looks away, into what follows).
    if (L.goat && !still && chief) for (const p of countryProvinces(w, c.id)) for (const g of groupsOf(p)) if (g.eth === L.goat && g.share >= .03 && g.share <= .6) { const cur = (p.incite ||= {})[g.eth]; p.incite[g.eth] = { level: clamp((cur?.level || 0) + s * (L.banned ? .08 : .2), 0, 70), by: cur?.by ?? chief.id, turn: w.turn }; (p.incited ||= {})[g.eth] ??= chief.id; }
    // Workmen's guards keep the shops angry; the dispossessed and the zealots work on the classes they come from.
    if (L.kind === 'red' && !still) c.mods.push({ key: 'sat.workers', delta: -s * .03, turns: 1, label: `The ${L.short} at the gates` });
    // Whose it is.
    if (patron?.alive && patron.country === c.id) {
      if (ruled) {
        // The government's street: the opposition's meetings are broken up without a policeman in sight, people are afraid, the comfortable dislike it.
        for (const p of c.parties) if (p.id !== c.rulingParty && !p.banned) p.organization = clamp((p.organization || 0) - s * .02, 0, 100);
        frighten(c, s * .02); c.mods.push({ key: 'sat.middle', delta: -s * .05, turns: 1, label: `The ${L.short} in the streets` });
        // It counts what it was promised.
        const done = kept(w, c, L);
        if (done > (L.kept0 ?? 0)) { L.kept0 = done; L.adoptedAt = w.turn; c.legitimacy = clamp(c.legitimacy + 1.5, 0, 100); say(w, patron, chief?.name ?? L.name, `The ${L.short} sees that one of its things is done (${done} of ${L.planks.length} now). Its men are the surer yours for it.`); }
        // (A chief who governs is not broken with by his own league: it is his, whatever he does with it.)
        else if (w.turn - (L.adoptedAt ?? w.turn) >= 6 && done < L.planks.length && patron.id !== L.chief) breakWith(w, c, L, patron, true);
      } else if (party) { party.organization = clamp((party.organization || 0) + s * .03, 0, 100); party.support = clamp(party.support + s * .01, 0, 100); }
    } else if (L.adopted) { delete L.adopted; delete L.adoptedAt; }
    if (s >= 30 && !L.banned && !still) envoy(w, c, L);
    // The capital. Called for the next quarter, so that everybody has one quarter to do something about it.
    if (L.march && w.turn >= L.march.at) { if (chief && chief.status === 'free' && !still && L.adopted !== c.leader && s >= 40 && (!L.banned || s >= 45)) march(w, c, L); else delete L.march; }
    else if (!L.march && chief && chief.id !== c.leader && !still && L.adopted !== c.leader && s >= 55 && c.legitimacy < 38 && (!L.banned || (c.police ?? 30) < 35) && w.turn - (L.marched ?? -99) >= 8) {
      L.march = { at: w.turn + 1 }; const cap = w.provinces[c.capital], n = marchersOf(w, c, L), here = sum(Object.values(w.units).filter(u => u.country === c.id && u.province === c.capital), u => u.men);
      news(w, `${c.name}: the ${L.name} has called its men to ${cap?.name ?? 'the capital'}.`, { kind: 'politics', countries: [c.id] });
      for (const ch of seated(w, c)) say(w, ch, ch.id === c.leader ? 'Police' : 'The town', `The ${L.name} has called its men to ${cap?.name ?? 'the capital'} for ${quarterLabel(w.turn + 1)}: ${thousand(n)} are expected, and ${styled(w, L)} says the government will be gone by evening. ${ch.id === c.leader || ch.id === c.general ? `The garrison of the capital is ${here >= .5 ? `${Math.round(here)} thousand` : 'nobody'}. Troops that will fire break a crowd four times their number; troops in barracks, or with no faith in the government, let it pass. ` : ''}What can still be done before the day: forbid it (ban_league), take up its programme (adopt_league), buy its chief (bribe, for: stand_down), or bring troops that can be trusted into the capital (move). ${L.adopted && L.adopted !== c.leader ? `If the government falls, it is ${w.characters[L.adopted]?.name} who governs.` : `If the government falls, it is ${chief.name} who governs.`}`);
    }
  }
}

// It turns on whoever had taken it up and gave it nothing.
function breakWith(w, c, L, patron, cheated) {
  const chief = chiefOf(w, L); delete L.adopted; delete L.adoptedAt; delete L.kept0; L.told[patron.id] = w.turn;
  if (cheated) { if (patron.id === c.leader) c.legitimacy = clamp(c.legitimacy - 3, 0, 100); else { const p = leadsParties(w, c, patron)[0]; if (p) p.support = clamp(p.support - 3, 0, 100); }
    news(w, `${c.name}: the ${L.name} has broken with ${patron.name}: "${He(patron)} took our men and gave us words."`, { kind: 'politics', countries: [c.id] });
    say(w, patron, chief?.name ?? L.name, `${styled(w, L)} has broken with you, in every square: six quarters, and of the ${COUNT[L.planks.length]} things the ${L.short} stands for (${plankWords(w, L).join(', ')}) nothing new was done. Its men are no longer yours, and they say so.`); }
}

export function leagueOp(w, actor, c, op, h) {
  const { fail, num } = h, home = op.target && w.countries[op.target]?.alive ? w.countries[op.target] : c, L = leagueOf(home), ruler = governs(w, c, actor);
  if (!L) return fail(home.id === c.id ? 'There is no league in the country. One forms where a country is bitter beyond what it is used to; nobody founds it by order.' : `There is no league in ${home.name}.`);
  const chief = chiefOf(w, L), s = L.strength;
  switch (op.op) {
    // Money: it grows beyond what the grievance alone would carry, for as long as the money lasts.
    case 'back_league': {
      const party = String(op.from ?? '') === 'party' ? leadsParties(w, c, actor)[0] : null, purse = party ? party.funds || 0 : Math.max(actor.wealth, 0), m = Math.min(purse, num(op.amount, 0, 1e6, 0));
      if (!(m >= 1)) return fail(`No money was put behind it: ${party ? `the chest of the ${party.name} holds ${Math.round(purse)}` : `your own purse holds ${Math.round(purse)}`}. (The league takes money from a private purse or a party chest, not from a treasury.)`);
      if (party) party.funds -= m; else actor.wealth -= m;
      L.funds += m * 1.2; L.backers[actor.id] = { turn: w.turn, sum: (L.backers[actor.id]?.turn >= w.turn - 4 ? L.backers[actor.id].sum : 0) + m };
      trace(w, actor, `Paid ${Math.round(m)} to the ${L.name}${home.id !== c.id ? ` of ${home.name}` : ''}.`); if (chief) trace(w, chief, `Took ${Math.round(m)} from ${actor.name}.`);
      const need = Math.ceil(4 + s / 8);
      return { ok: true, msg: `${Math.round(m)} reached the ${L.name}${home.id !== c.id ? ` of ${home.name}` : ''}. It buys halls, boots and printing, and the league is the larger for it while the money lasts. Nobody knows of it but you and ${chief ? chief.name : 'its committee'}; it is the kind of thing a file or a newspaper is glad to find. ${L.backers[actor.id].sum >= need ? `For what you have given this year ${he(chief ?? actor)} will move ${his(chief ?? actor)} men where you point (unleash).` : `A league moves for whoever has taken up its programme, or for a paymaster who has given it about ${need} in a year; you have given ${Math.round(L.backers[actor.id].sum)}.`}` };
    }
    // Its programme taken up in public: its men are the adopter's.
    case 'adopt_league': {
      if (home.id !== c.id) return fail('A league is taken up by somebody in its own country.');
      if (op.drop || op.leave) { if (L.adopted !== actor.id) return fail(`The ${L.name} is not yours to drop.`); breakWith(w, c, L, actor, false); c.mods.push({ key: 'unrest', delta: s * .04, turns: 2, label: `The ${L.short} disowned` }); news(w, `${c.name}: ${actor.name} has disowned the ${L.name}.`, { kind: 'politics', countries: [c.id] }); return { ok: true, msg: `You have disowned the ${L.name}, and it is in the papers. Its men are nobody's again; ${chief ? `${chief.name} will say what ${he(chief)} thinks of it` : 'they will say what they think of it'}.` }; }
      if (!SEATS.some(r => c[r] === actor.id) && !leadsParties(w, c, actor).length) return fail('A league gives its men to somebody who can do something for it: whoever governs, the chief of staff, the leader of a party, a man of great money.');
      if (!chief || chief.status !== 'free') return fail(`The ${L.name} has no chief at liberty to give its word.`);
      if (L.banned && !ruler) return fail(`The ${L.name} is forbidden: to take it up now is to stand outside the law with it. (Whoever governs can lift the ban: ban_league with lift.)`);
      if (L.adopted === actor.id) return fail(`The ${L.name} is yours already. It counts what it was promised: ${kept(w, c, L)} of ${L.planks.length} done.`);
      const other = w.characters[L.adopted]; if (other?.alive && other.country === c.id) return fail(`The ${L.name} has given its word to ${other.name}, who took up its programme in ${quarterLabel(L.adoptedAt ?? w.turn)}. It does not serve two.`);
      if (ruler && L.banned) { delete L.banned; }
      L.adopted = actor.id; L.adoptedAt = w.turn; L.kept0 = kept(w, c, L); delete L.march;
      news(w, `${c.name}: ${actor.name} has taken up the programme of the ${L.name}: ${list(plankWords(w, L))}.`, { kind: 'politics', countries: [c.id] });
      const mine = leadsParties(w, c, actor)[0];
      return { ok: true, msg: `You have taken up the programme of the ${L.name} before the country (${plankWords(w, L).map((t, i) => `${t}: ${PLANKS[L.planks[i].k].how}`).join('; ')}), and its men (${thousand(membersOf(w, c, L))} of them) are yours in the street. ${ruler ? `While that lasts the other parties' meetings are broken up without a policeman in sight and their organisation wears away, people grow afraid, and the comfortable classes like it less every quarter. The ${L.short} counts what it was promised: if in six quarters nothing more of it is done, it breaks with you and says so in every square.` : `${mine ? `Its men work for the ${mine.name} at meetings and at the polls, and the party's organisation grows by them. ` : ''}It will go where you point (unleash). If it ever marches on the capital and the garrison lets it pass, it is you who governs.`} Everybody knows whose it is now: what it does is laid at your door.` };
    }
    // Turned on somebody: a party, a paper, a society, a people.
    case 'unleash': {
      if (!chief || chief.status !== 'free') return fail(`The ${L.name} has no chief at liberty to give the word.`);
      if (quiet(w, L)) return fail(`${chief.name} is keeping ${his(chief)} men at home until ${quarterLabel(chief.quiet.until)}: somebody has paid for that.`);
      const need = Math.ceil(4 + s / 8), paid = L.backers[actor.id]?.turn >= w.turn - 4 ? L.backers[actor.id].sum : 0;
      if (L.adopted !== actor.id && paid < need) return fail(`The ${L.name} moves for whoever has taken up its programme (adopt_league), or for a paymaster who has given it about ${need} in a year (back_league)${paid ? `; you have given ${Math.round(paid)}` : ''}.`);
      if (L.loosed === w.turn) return fail(`The ${L.short} is out already this quarter; its men cannot be in two places.`);
      if (s < 12) return fail(`The ${L.name} is ${thousand(membersOf(w, home, L))}: too few to be turned on anybody.`);
      const key = String(op.on ?? op.against ?? op.party ?? op.paper ?? op.people ?? op.society ?? '').trim(), low = key.toLowerCase(), state = L.adopted === home.leader && actor.id === home.leader;
      const party = home.parties.find(p => p.id === key || p.name.toLowerCase() === low || (low.length > 3 && p.name.toLowerCase().includes(low))), paper = (home.papers || []).find(n => n.id === key || n.name.toLowerCase() === low || (low.length > 3 && n.name.toLowerCase().replace(/^the /, '').includes(low.replace(/^the /, '')))), soc = (home.societies || []).find(x => !x.banned && (x.id === key || (x.name || '').toLowerCase() === low));
      const where = op.province ? w.provinces[op.province] : null; if (op.province && (!where || where.controller !== home.id)) return fail('No such province of the country.');
      const done = (what, to) => { L.loosed = w.turn; trace(w, actor, `Turned the ${L.name} on ${what}.`); trace(w, chief, `Sent the ${L.short} against ${what} at the word of ${actor.name}.`); return { ok: true, msg: `${to} Nobody saw a policeman or your hand in it: it is ${chief.name}'s doing before the country, and yours in ${his(chief)} memory and in whatever file finds it.${L.adopted === actor.id ? ' But the league is known to be yours, and people draw their own conclusions.' : ''}` }; };
      if (party) {
        if (party.banned) return fail(`${party.name} is banned: it holds no meetings to break up.`); if (leadsParties(w, home, actor).some(p => p.id === party.id)) return fail('That is your own party.');
        if (L.kind === 'red' && party.base === 'workers') return fail(`The ${L.short} will not go against the ${party.name}: those are its own people.`);
        const dead = s >= 35 && rand(w) < .5 ? Math.round(1 + rand(w) * 6) : 0, hit = s * .22;
        party.organization = clamp((party.organization || 0) - hit, 0, 100); party.support = clamp(party.support + (home.pressFreedom >= 55 ? 1.5 : -s * .03), 0, 100); if (dead) home.blood = (home.blood || 0) + dead * .05; if (state) frighten(home, 2 + s * .04);
        news(w, `${home.name}: men of the ${L.name} broke up meetings of the ${party.name} and wrecked its rooms${dead ? `; ${dead} dead` : ''}.`, { kind: 'politics', countries: [home.id] });
        const lead = w.characters[party.leader]; say(w, lead, 'Your party\'s secretary', `Men of the ${L.name} broke up our meetings and wrecked our rooms${dead ? `; ${dead} of ours are dead` : ''}. The police ${home.police >= 45 && !state ? 'came late' : 'were not seen'}. Our organisation is the weaker for it; ${home.pressFreedom >= 55 ? 'the papers are with us' : 'the papers say little'}.`);
        return done(`the ${party.name}`, `The ${L.short} went through the meetings and the rooms of the ${party.name}${dead ? `, and ${dead} were killed` : ''}: its organisation is down by about ${Math.round(hit)} of a hundred${home.pressFreedom >= 55 ? ', and where the papers are free a party that is beaten in the street gains some pity' : ''}.`);
      }
      if (paper) {
        if (paper.owner === actor.id) return fail('That is your own paper.');
        paper.funds = Math.max(0, (paper.funds || 0) * (1 - s / 130)); paper.reach = Math.max(0, (paper.reach || 0) * (1 - s / 110)); paper.wrecked = w.turn; if (state) frighten(home, 1 + s * .03);
        news(w, `${home.name}: the presses of ${paper.name} were wrecked by men of the ${L.name}.`, { kind: 'politics', countries: [home.id] }); say(w, w.characters[paper.owner], paper.name, `Men of the ${L.name} came into the printing house at night and broke the presses and the type. The paper will come out thin for some quarters, and costs money to set up again.`);
        return done(paper.name, `The ${L.short} wrecked the presses of ${paper.name}: it reaches far fewer readers until money sets it up again.`);
      }
      if (soc) {
        if (L.kind === 'red' && soc.kind === 'union') return fail(`The ${L.short} will not go against a union: those are its own people.`);
        soc.strength = Math.max(0, soc.strength * (1 - s / 120)); news(w, `${home.name}: men of the ${L.name} broke up ${soc.name ?? 'a society'} and burned its books.`, { kind: 'politics', countries: [home.id] });
        return done(soc.name ?? 'a society', `The ${L.short} broke up ${soc.name ?? 'the society'} and burned its books: it is much the weaker.`);
      }
      // A people. The league's men are the mob: what follows is reckoned where every such thing is reckoned, when the quarter is played.
      const eth = [...new Set(countryProvinces(w, home.id).flatMap(p => groupsOf(p).map(g => g.eth)))].find(e => e.toLowerCase() === low || (low.length > 3 && low.includes(e.toLowerCase()))) ?? (!key || /people|them|enemy/.test(low) ? L.goat : null);
      if (!eth) return fail(`Say on whom (on): a party, a newspaper, a society, or a people of the country${L.goat ? ` (the ${L.short} names the ${L.goat})` : ''}.`);
      if (eth === home.majorityEth) return fail(`The ${L.short} is made of ${eth} men: it does not go against its own.`);
      const spots = (where ? [where] : countryProvinces(w, home.id)).filter(p => groupsOf(p).some(g => g.eth === eth && g.share >= .03 && g.share <= .6)).sort((a, b) => provincePop(b) - provincePop(a)).slice(0, where ? 1 : 3);
      if (!spots.length) return fail(where ? `There are too few ${eth} people in ${where.name}, or they are most of the province.` : `There are no ${eth} quarters in the country for it to go into.`);
      for (const p of spots) { const g = groupsOf(p).find(x => x.eth === eth), guard = (home.police ?? 30) * (statusOf(home, g).shielded && !state ? .45 : .1); (p.hate ||= {})[eth] = clamp(Math.max(p.hate[eth] || 0, 50 + s * .6 - guard), 0, 100); (p.incite ||= {})[eth] = { level: clamp(40 + s * .5, 0, 80), by: chief.id, turn: w.turn }; (p.incited ||= {})[eth] = chief.id; }
      return done(`the ${eth} of ${list(spots.map(p => p.name))}`, `${chief.name} has given the word, and the ${L.short} goes into the ${eth} quarters of ${list(spots.map(p => p.name))} this quarter. What comes of it depends on how many of them there are and on whether the police stand in the way (a people the law protects is guarded; one it does not is not): the reports will give the dead and the fled, and their kin abroad will hear of it.`);
    }
    // Forbidden. What the police can reach is broken up; the hard men go where the police do not see.
    case 'ban_league': {
      if (home.id !== c.id || !ruler) return fail('A league is forbidden by whoever governs its country.');
      if (op.lift) { if (!L.banned) return fail(`The ${L.name} is not forbidden.`); delete L.banned; news(w, `${c.name}: the ban on the ${L.name} is lifted.`, { kind: 'politics', countries: [c.id] }); return { ok: true, msg: `The ${L.name} may march again, and will: ${thousand(membersOf(w, c, L))} today.` }; }
      if (L.banned) return fail(`The ${L.name} is forbidden already (since ${quarterLabel(L.banned)}); what is left of it meets where the police do not see.`);
      const grip = clamp((c.police ?? 30) / 60, .25, 1.1), fight = s >= 45 && grip < .7, dead = fight ? Math.round(4 + rand(w) * s * .5) : 0, cut = clamp(grip * .65, .15, .7), under = s * cut * .5;
      L.banned = w.turn; L.strength = s * (1 - cut); delete L.march; if (L.adopted) { const was = w.characters[L.adopted]; delete L.adopted; delete L.adoptedAt; say(w, was, 'The town', `The government has forbidden the ${L.name}, which had given you its men. They are an unlawful body now.`); }
      c.cellFunds = (c.cellFunds || 0) + under; frighten(c, 2 + s * .05 + dead * .2); if (dead) { c.blood = (c.blood || 0) + dead * .08; const cap = w.provinces[c.capital]; if (cap) cap.unrest = clamp(cap.unrest + 8, 0, 100); }
      news(w, `${c.name}: the government has forbidden the ${L.name}; its halls are shut and its papers seized${dead ? `. There was fighting where its men would not disperse: ${dead} dead` : ''}.`, { kind: 'politics', countries: [c.id] });
      if (chief) say(w, chief, 'Police', `The ${L.name} is forbidden.`);
      return { ok: true, msg: `The ${L.name} is forbidden: halls shut, flags and papers seized${dead ? `, and ${dead} dead where its men would not disperse` : ''}. A police of ${Math.round(c.police ?? 30)} reaches about ${Math.round(cut * 100)} in the hundred of it; the rest meets where the police do not see, and its hard men have gone to the armed underground, which is the stronger for them. While what bred it stands it grows back, slower for being unlawful${(c.police ?? 30) < 35 ? '; with so few police it may march in spite of the ban' : ''}. People are the more afraid of the government for it.` };
    }
  }
  return fail('Unknown order.');
}

// For whoever looks the parties or the unrest up: what marches, for what, and what can be done with it.
export function leagueWords(w, c, ch) {
  const L = leagueOf(c); if (!L) return '';
  const chief = chiefOf(w, L), ruler = governs(w, c, ch), done = L.planks.map(k => PLANKS[k.k].done(w, c, L, k)), whose = w.characters[L.adopted];
  return ` A league marches in the country: the ${L.name} (${KINDS[L.kind].word})${chief ? `, under ${chief.name} (${chief.id}), ${L.bio}` : ''}; ${thousand(membersOf(w, c, L))} by the police's count, strongest in ${list(L.seats.map(id => w.provinces[id]?.name).filter(Boolean))}${L.banned ? `; forbidden since ${quarterLabel(L.banned)}` : ''}. It stands for ${plankWords(w, L).map((t, i) => `${t}${done[i] ? ' (done)' : ''}`).join('; ')}${L.goat ? `, and it blames the ${L.goat}` : ''}.${whose?.alive ? ` ${whose.id === ch.id ? 'You have' : `${whose.name} has`} taken up its programme, and its men are ${whose.id === ch.id ? 'yours' : his(whose)}.` : ''} A league is as large as the grievance behind it and the money given it (back_league: a secret). Whoever takes up its programme in public has its men for his own (adopt_league) and is held to the programme by them; whoever has taken it up, or has paid it enough, can turn it on a party, a newspaper, a society or a people (unleash). ${ruler ? 'The government can forbid it (ban_league: what the police reach is broken up, and its hard men go underground).' : 'Whoever governs can forbid it.'} Ignored by a weak government, it marches on the capital, and the garrison decides.`;
}
// The police, to whoever governs, when there is a league worth a line. (The wording was put to the user and approved, 2026-11-13.)
export function leagueMemorandum(w, c) {
  const L = leagueOf(c); if (!L || L.strength < 18 || L.adopted === c.leader) return null;
  return `The ${L.name} counts ${thousand(membersOf(w, c, L))} and could put ${thousand(marchersOf(w, c, L))} into the capital in a day. What can be done: leave it (it grows with the grievance, not with our leave), buy its chief (bribe), take up its programme and have its men for our own (adopt_league), turn it on somebody (unleash), or forbid it (ban_league: its hard men go underground). Or nothing.`;
}
