// Provinces hold mixed peoples. Policy, schooling, war and flight slowly change who lives where.
import { clamp, between, pick, rand, news } from './util.js';
import { aliveCountries, countryProvinces, provincePop } from './world.js';

export const LANGUAGE_POLICY = ['assimilate', 'tolerate', 'autonomy'];
export const FAITH_POLICY = ['state', 'tolerate', 'secular'];
const LANG_WEIGHT = { assimilate: 1.8, tolerate: 1, autonomy: .5 }, FAITH_WEIGHT = { state: 1.6, tolerate: 1, secular: .7 };

export const groupsOf = p => p.groups?.length ? p.groups : [{ eth: p.eth, rel: p.rel, share: 1 }];
const shareWhere = (p, f) => groupsOf(p).filter(f).reduce((a, g) => a + g.share, 0);
export const minorityShare = (p, c) => shareWhere(p, g => g.eth !== c.majorityEth);
export const faithMinorityShare = (p, c) => shareWhere(p, g => g.rel !== c.majorityRel);

// What the state's treatment of peoples and faiths costs it, and earns it, in one province: each group weighs the policy that applies to it there,
// the disabilities the law lays on it and any forced labour; and where the country wants the nation or the faith first, the majority approves of
// what is done to the others in its name. With one policy for all and one law for everyone this is what it always was.
export function culturePenalty(c, p) {
  let v = 0, own = 0;
  for (const g of groupsOf(p)) {
    const pol = policyFor(c, p, g);
    if (g.eth !== c.majorityEth) v += g.share * (Math.max(0, c.axes.nation) * .22 + 3) * LANG_WEIGHT[pol.language]; else own += g.share;
    if (g.rel !== c.majorityRel) v += g.share * (Math.max(0, c.axes.faith) * .18 + 2) * FAITH_WEIGHT[pol.faith];
    v += g.share * (burdenOf(c, g) * 14 + forcedOn(p, g) * 30);
  }
  return v - own * Math.max(0, Math.max(c.axes.nation, c.axes.faith) - 25) / 75 * (c._privilege || 0) * 40;
}

// Governed by someone of another people or faith costs standing where the state is nationalist or devout.
export function leaderForeignness(w, c) {
  const o = w.characters[c.leader]?.origin; if (!o) return 0;
  return (o.eth !== c.majorityEth ? 3 + Math.max(0, c.axes.nation) * .05 : 0) + (o.rel !== c.majorityRel ? 2 + Math.max(0, c.axes.faith) * .05 : 0);
}

function normalize(p) {
  const total = p.groups.reduce((a, g) => a + g.share, 0) || 1;
  p.groups = p.groups.map(g => ({ ...g, share: g.share / total })).filter(g => g.share > .004).sort((a, b) => b.share - a.share);
  p.eth = p.groups[0].eth; p.rel = p.groups[0].rel;
}

function add(p, eth, rel, share) { const g = p.groups.find(x => x.eth === eth && x.rel === rel); if (g) g.share += share; else p.groups.push({ eth, rel, share }); }

export function initGroups(w) {
  const cs = aliveCountries(w), peoples = cs.map(c => [c.majorityEth, c.majorityRel]);
  for (const p of Object.values(w.provinces)) {
    const c = w.countries[p.controller], border = p.neighbors.some(n => w.provinces[n].controller !== p.controller), main = between(w, border ? .62 : .78, border ? .85 : .96);
    p.groups = [{ eth: p.eth, rel: p.rel, share: main }];
    const [eth, rel] = pick(w, peoples);
    add(p, eth === p.eth ? c.majorityEth : eth, rel, 1 - main);
    normalize(p);
  }
  const FROM = { junta: 'assimilate', monarchy: 'assimilate', theocracy: 'tolerate', revolutionary: 'tolerate', republic: 'tolerate', merchant: 'tolerate', agrarian: 'tolerate', federation: 'autonomy' };
  for (const c of cs) { c.languagePolicy = FROM[c.archetype] ?? 'tolerate'; c.faithPolicy = c.archetype === 'theocracy' ? 'state' : c.archetype === 'revolutionary' ? 'secular' : 'tolerate'; }
  // And the law each kind of state was handed over with, as a fact of the day of handing over and nothing more: a ruler keeps it, hardens it or
  // strikes it out. States of soldiers do not arm the frontier people whose own nation lies across the line; a principality of landowners and a
  // crown keep their offices for their own; a state built on one faith taxes the others and shuts them out of office; traders, republics,
  // federations and revolutions know one law for all. (The owner asked that the status quo differ from state to state, 2026-11-11.)
  for (const c of cs) {
    const heads = { eth: {}, rel: {} }; let all = 0;
    for (const p of countryProvinces(w, c.id)) { const n = provincePop(p); all += n; for (const g of groupsOf(p)) { if (g.eth !== c.majorityEth) heads.eth[g.eth] = (heads.eth[g.eth] || 0) + n * g.share; if (g.rel !== c.majorityRel) heads.rel[g.rel] = (heads.rel[g.rel] || 0) + n * g.share; } }
    const big = k => Object.entries(heads[k]).filter(([, n]) => n / Math.max(all, 1) >= .04).sort((a, b) => b[1] - a[1]).map(([name]) => name), status = {};
    if (c.archetype === 'junta' && big('eth')[0]) status[big('eth')[0]] = { arms: false };
    if (c.archetype === 'agrarian' && big('eth')[0]) status[big('eth')[0]] = { office: false };
    if (c.archetype === 'monarchy' && big('rel')[0]) status[big('rel')[0]] = { office: false };
    if (c.archetype === 'theocracy') for (const rel of big('rel')) status[rel] = { office: false, levy: .02 };
    if (Object.keys(status).length) c.status = status; c._privilege = privilege(w, c);
  }
}

// Part of a people's weight moves with refugees.
export function migrate(from, to, rate) {
  if (!from.groups || !to.groups) return;
  for (const g of from.groups) add(to, g.eth, g.rel, g.share * rate * provincePop(from) / Math.max(provincePop(to), 1));
  normalize(to);
}

// Takes part of the people who match out of a province, whatever the cause, and returns how many thousand of each group went.
export function removePeople(p, match, share) {
  const gone = groupsOf(p).filter(match).map(g => ({ eth: g.eth, rel: g.rel, people: provincePop(p) * g.share * share })), total = gone.reduce((a, g) => a + g.people, 0), pop = provincePop(p);
  if (total <= 0 || pop <= 0) return [];
  for (const k of Object.keys(p.pops)) p.pops[k].n = Math.max(1, p.pops[k].n * (1 - total / pop));
  if (p.groups?.length) { for (const g of p.groups) if (match(g)) g.share *= 1 - share; if (p.groups.some(g => g.share > 0)) normalize(p); }
  return gone;
}
// The same people arriving somewhere else.
export function settlePeople(to, eth, rel, people) {
  const pop = Math.max(provincePop(to), 1);
  for (const k of Object.keys(to.pops)) to.pops[k].n *= 1 + people / pop;
  if (to.groups) { for (const g of to.groups) g.share *= pop / (pop + people); add(to, eth, rel, people / (pop + people)); normalize(to); }
}

const DRIFT = { assimilate: .0025, tolerate: .0004, autonomy: 0 }, FAITH_DRIFT = { state: .002, tolerate: .0003, secular: 0 };

export function cultureStep(w) {
  for (const c of aliveCountries(w)) c._privilege = privilege(w, c);
  for (const c of aliveCountries(w)) for (const p of countryProvinces(w, c.id)) {
    if (!p.groups) continue;
    const school = clamp(c.literacy / 50, .3, 1.6);
    let moved = 0, pressed = 0;
    for (const g of [...p.groups]) {
      const pol = policyFor(c, p, g), lang = DRIFT[pol.language] * school, faith = FAITH_DRIFT[pol.faith];
      if (g.eth !== c.majorityEth && lang) { const m = g.share * lang; g.share -= m; moved += m; add(p, c.majorityEth, g.rel, m); }
      if (g.rel !== c.majorityRel && faith) { const m = g.share * faith; g.share -= m; moved += m; add(p, g.eth, c.majorityRel, m); }
      if (g.eth !== c.majorityEth && pol.language === 'assimilate') pressed += g.share;
    }
    if (moved) normalize(p);
    if (pressed) p.unrest = clamp(p.unrest + pressed * .5, 0, 100);
    peoplesStep(w, c, p);
    // A people's kin state across the border is a fact the province feels.
    const kin = p.neighbors.map(n => w.countries[w.provinces[n].controller]).find(o => o && o.id !== c.id && o.axes.nation > 40 && groupsOf(p).some(g => g.eth === o.majorityEth && g.eth !== c.majorityEth && g.share > .25));
    if (kin) p.unrest = clamp(p.unrest + .4, 0, 100);
  }
}

// ---- Peoples under the law ----
// What a state does with the peoples and faiths inside it is its rulers' decision, province by province and people by people, and nothing here is
// scripted: the default is one policy for the whole country and one law for everyone, as it was handed over. A ruler can set a policy for one
// province or one people (set_culture_policy with province, people), put a people or a faith under disabilities (set_status: no vote, no office,
// no arms, a levy), put its members to forced work (forced_labour), move them or settle others among them (resettle), kill or drive them out
// (persecute, in ops.js); anyone with money can stir the majority against them (incite). The engine answers: the people so treated resent it, leave
// when they can, serve badly in the ranks, are remembered by their kin across the frontier; a majority that wants the nation or the faith first
// approves; crowds that have been stirred, where the law has marked a people and the police look away, turn on their neighbours.
const sameName = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
export const hits = (key, g) => !key || sameName(key, g.eth) || sameName(key, g.rel);
// The policy that applies to one group in one province: the rule that names both the province and the people, else the people, else the province, else the country's.
export function policyFor(c, p, g) {
  const rules = c.cultureRules || [], fits = r => (!r.province || r.province === p.id) && (!r.people || hits(r.people, g)), rank = r => (r.province ? 1 : 0) + (r.people ? 2 : 0);
  const pick = k => [...rules].filter(r => r[k] && fits(r)).sort((a, b) => rank(b) - rank(a))[0]?.[k];
  return { language: pick('language') ?? c.languagePolicy ?? 'tolerate', faith: pick('faith') ?? c.faithPolicy ?? 'tolerate' };
}
// The disabilities the law lays on a group, by its people and by its faith together.
export const DISABILITIES = ['vote', 'office', 'arms'];
export function statusOf(c, g) {
  const out = { vote: true, office: true, arms: true, levy: 0, shielded: true };
  for (const [name, s] of Object.entries(c.status || {})) if (hits(name, g)) { for (const k of DISABILITIES) if (s[k] === false) out[k] = false; out.levy = Math.max(out.levy, s.levy || 0); if (s.shielded === false) out.shielded = false; }
  return out;
}
// How heavily the law bears on a group, 0 for an equal citizen to about 1 for a people stripped of everything.
export const burdenOf = (c, g) => { if (!c.status) return 0; const s = statusOf(c, g); return (s.vote ? 0 : .3) + (s.office ? 0 : .2) + (s.arms ? 0 : .15) + Math.min(.35, s.levy * 7); };
const forcedOn = (p, g) => p.forced && hits(p.forced.key, g) ? p.forced.share : 0;
// How much of the country lives under disabilities: what a majority that wants the nation or the faith first sees done in its name.
export function privilege(w, c) {
  if (!c.status || !Object.keys(c.status).length) return 0;
  let all = 0, under = 0; for (const p of countryProvinces(w, c.id)) { const n = provincePop(p); all += n; for (const g of groupsOf(p)) under += n * g.share * burdenOf(c, g); }
  return under / Math.max(all, 1);
}
// What a levy laid on some peoples alone brings in, as a share of all that the country's people earn: each group's numbers times the rate the law sets on it.
export function levyShare(w, c) {
  if (!c.status) return 0; let all = 0, due = 0;
  for (const p of countryProvinces(w, c.id)) { const n = provincePop(p); all += n; for (const g of groupsOf(p)) due += n * g.share * statusOf(c, g).levy; }
  return due / Math.max(all, 1);
}
// How much cheaper earthworks come to the state where a gang is held to forced labour: by the size of the gang against the province, up to a third.
export const gangDiscount = p => { if (!p?.forced) return 0; const held = groupsOf(p).filter(g => hits(p.forced.key, g)).reduce((a, g) => a + g.share, 0) * p.forced.share; return clamp(held * 2, 0, .35); };
// The share of a province's people who have the vote, and who may be taken for the army.
export const votersOf = (c, p) => c.status ? groupsOf(p).reduce((a, g) => a + (statusOf(c, g).vote ? g.share : 0), 0) : 1;
export const armedOf = (c, p) => c.status ? groupsOf(p).reduce((a, g) => a + (statusOf(c, g).arms ? g.share : 0), 0) : 1;
// How hard a state bears on one people in one province, as their kin across the frontier see it (frontier.js).
export function yokeOn(c, p, eth) {
  const g = groupsOf(p).find(x => x.eth === eth) ?? { eth, rel: c.majorityRel }, lang = policyFor(c, p, g).language;
  return (lang === 'assimilate' ? 1 : lang === 'autonomy' ? 0 : .35) + burdenOf(c, g) * 1.2 + (forcedOn(p, g) > 0 ? 1 : 0) + (p.pogrom?.eth === eth ? .8 : 0);
}
// A regiment raised among a people the state bears down on, or sent against that people's own nation, is the less to be relied on (military.js).
export function originPull(w, c, u) {
  if (!u.eth || u.eth === c.majorityEth) return 0;
  const g = { eth: u.eth, rel: u.rel ?? c.majorityRel }, lang = c.cultureRules?.find(r => r.language && !r.province && hits(r.people, g))?.language ?? c.languagePolicy ?? 'tolerate';
  const kinWar = w.wars.some(x => x.active && [...x.a, ...x.b].includes(c.id) && [...x.a, ...x.b].some(id => id !== c.id && w.countries[id]?.majorityEth === u.eth && ((x.a.includes(c.id)) !== (x.a.includes(id)))));
  return (lang === 'assimilate' ? 5 : 0) + burdenOf(c, g) * 22 + (kinWar ? 12 : 0);
}

const record = (c, entry) => { (c.atrocities ||= []).push(entry); c.atrocities = c.atrocities.slice(-20); };
const thousands = n => n < 1 ? `${Math.max(1, Math.round(n * 10)) * 100}` : `${Math.round(n)} thousand`;
// Where people who are driven or flee go: to their kin across the nearest frontier if there is one, else across any frontier, else deeper into the country.
function refuge(w, c, p, g) {
  const next = p.neighbors.map(n => w.provinces[n]), abroad = next.filter(n => n.controller !== c.id && w.countries[n.controller]?.alive), kin = abroad.filter(n => w.countries[n.controller].majorityEth === g.eth || w.countries[n.controller].majorityRel === g.rel);
  return (kin.length ? kin : abroad.length ? abroad : next.filter(n => n.controller === c.id))[0] ?? null;
}
const grudgeOf = (o, id) => ((o.grudges ||= {})[id] ||= { incident: 0, kin: 0 });
const tellRuler = (w, c, text) => { const ch = w.characters[c.leader]; if (ch?.alive) ch.inbox.push({ turn: w.turn, from: 'Ministry of the Interior', text }); };

// What the quarter does to the peoples of one province beyond the slow work of school and pulpit.
function peoplesStep(w, c, p) {
  // Disabilities send people away: those who can go to their own nation across the frontier do, a few in the hundred each year.
  if (c.status) for (const g of [...p.groups]) { const b = burdenOf(c, g); if (b <= 0 || g.share < .01) continue; const to = refuge(w, c, p, g); if (!to || to.controller === c.id) continue;
    const gone = removePeople(p, x => x.eth === g.eth && x.rel === g.rel, b * .006); for (const x of gone) settlePeople(to, x.eth, x.rel, x.people); }
  // Forced labour: the gangs dig and build for nothing, and die and run at it.
  if (p.forced) {
    const f = p.forced, hit = groupsOf(p).filter(g => hits(f.key, g)), pop = provincePop(p), gang = pop * hit.reduce((a, g) => a + g.share, 0) * f.share;
    if (gang < .2 || p.controller !== f.by) delete p.forced;
    else {
      const hard = ['tundra', 'mountain', 'marsh'].includes(p.terrain) || w.turn % 4 === 0, dead = gang * (hard ? .04 : .02), ran = gang * .03, share = (dead + ran) / Math.max(gang / f.share, 1e-9);
      const gone = removePeople(p, g => hits(f.key, g), share); for (const x of gone) { const to = refuge(w, c, p, x); if (to) settlePeople(to, x.eth, x.rel, x.people * ran / (dead + ran)); }
      f.dead = (f.dead || 0) + dead; f.worked = (f.worked || 0) + gang; c.blood = (c.blood || 0) + clamp(dead, 0, 10);
      // What the gangs are worth: field works where they stand, dug for nothing, and hands for whatever the state builds there (projects.js reads p.forced).
      if (gang >= 3 && (p.trench || 0) < 3 && (w.turn - f.since) % 2 === 1) p.trench = (p.trench || 0) + 1;
      p.unrest = clamp(p.unrest + f.share * 6, 0, 100);
      if (!f.known && rand(w) < clamp(.15 + c.pressFreedom / 150 + (ran > .5 ? .25 : 0), 0, .9)) { f.known = true; c.honour = clamp((c.honour ?? 60) - 2, 0, 100); (c.honourLog ||= []).push({ turn: w.turn, why: `it keeps ${f.key} people at forced labour in ${p.name}` });
        const text = `${c.name} keeps about ${thousands(gang)} ${f.key} people at forced labour in ${p.name}; they die at it by the hundred.`; record(c, { turn: w.turn, province: p.id, name: p.name, method: 'labour', people: Math.round(gang), dead: Math.round(f.dead), group: f.key, by: f.order ?? null, known: true, text }); news(w, text, { kind: 'atrocity', countries: [c.id], province: p.id }); }
    }
  }
  // Feeling against a minority: a level that settles where agitation, the law's own mark on that people, the majority's bitterness, a war with that
  // people's nation and the police put it. Past a point a crowd turns on its neighbours; the outburst spends most of the feeling.
  for (const g of p.groups) {
    if (g.eth === c.majorityEth || g.share < .03 || g.share > .6) { if (p.hate?.[g.eth]) delete p.hate[g.eth]; continue; }
    const stirred = p.incite?.[g.eth]?.level || 0, marked = burdenOf(c, g) * 30 + (policyFor(c, p, g).language === 'assimilate' ? 6 : 0), bitter = Math.max(0, p.unrest - 30) * .4 + Math.max(0, (c.unemployment ?? .08) - .1) * 80 + ((c.foodRatio ?? 1) < .95 ? 8 : 0);
    const kinWar = w.wars.some(x => x.active && [...x.a, ...x.b].includes(c.id) && [...x.a, ...x.b].some(id => id !== c.id && w.countries[id]?.majorityEth === g.eth && x.a.includes(c.id) !== x.a.includes(id))) ? 18 : 0;
    // Bitterness alone finds no target: it needs a finger pointed, by an agitator, by the law, or by a war.
    const pointed = stirred + marked + kinWar, guard = (c.police ?? 30) * (statusOf(c, g).shielded ? .45 : .1), want = clamp(pointed + (pointed > 0 ? bitter : 0) - guard, 0, 100);
    const was = p.hate?.[g.eth] || 0, now = was + (want - was) * .3; if (now < .5 && !was) continue; (p.hate ||= {})[g.eth] = now;
    if (p.incite?.[g.eth]) { p.incite[g.eth].level *= .7; if (p.incite[g.eth].level < 1) delete p.incite[g.eth]; }
    if (now < 55) continue;
    const pop = provincePop(p), theirs = pop * g.share, fury = clamp((now - 55) / 45, 0, 1), share = .01 + fury * .04, by = p.incite?.[g.eth]?.by ?? p.incited?.[g.eth];
    const gone = removePeople(p, x => x.eth === g.eth, share * 3), taken = gone.reduce((a, x) => a + x.people, 0), dead = taken / 3, fled = taken - dead, to = refuge(w, c, p, g);
    if (to) for (const x of gone) settlePeople(to, x.eth, x.rel, x.people * fled / Math.max(taken, 1e-9));
    p.hate[g.eth] = now * .35; p.unrest = clamp(p.unrest + 8, 0, 100); p.devastation = clamp(p.devastation + share, 0, 1); p.pogrom = { eth: g.eth, turn: w.turn };
    const who = w.characters[by?.id ?? by], looked = !statusOf(c, g).shielded, text = `${p.name}: a mob turned on the ${g.eth} quarter${who ? `, after weeks of agitation by ${who.name}'s people` : ''}; about ${thousands(dead)} were killed and ${thousands(fled)} fled${looked ? ', and the police stood by' : ''}.`;
    record(c, { turn: w.turn, province: p.id, name: p.name, method: 'pogrom', people: Math.round(taken), dead: Math.round(dead), group: g.eth, by: who?.id ?? null, known: true, text });
    news(w, text, { kind: 'atrocity', countries: [c.id], province: p.id, hush: true });
    for (const o of aliveCountries(w)) if (o.id !== c.id && o.majorityEth === g.eth) { grudgeOf(o, c.id).incident += 5 + dead * 2; tellRuler(w, o, `In ${p.name}, under ${c.name}, a mob has turned on our ${g.eth} kin: about ${thousands(dead)} dead, ${thousands(fled)} driven out${looked ? ', with the police looking on' : ''}.`); }
    if (looked) { c.honour = clamp((c.honour ?? 60) - 1.5, 0, 100); (c.honourLog ||= []).push({ turn: w.turn, why: `its police stood by while a mob killed ${g.eth} people in ${p.name}` }); }
    tellRuler(w, c, `${text} What fed it: ${[stirred > 5 ? 'agitation' : '', marked > 5 ? 'the law itself marks these people' : '', kinWar ? 'the war with their nation' : '', bitter > 8 ? 'hard times' : '', looked ? 'police told to look away' : (c.police ?? 30) < 35 ? 'too few police' : ''].filter(Boolean).join(', ') || 'old hatred'}.`);
  }
  if (p.pogrom && w.turn - p.pogrom.turn > 8) delete p.pogrom;
}

// The operations of this chapter (dispatched from applyOp).
export const PEOPLE_OPS = new Set(['set_status', 'forced_labour', 'resettle', 'incite']);
export function peopleOp(w, actor, c, op, { fail, num, pay, allowance, rules, leads, leaveTrace, NO_FUNDS }) {
  const named = String(op.people ?? op.group ?? '').trim(), all = () => countryProvinces(w, c.id).flatMap(p => groupsOf(p)), known = named && all().some(g => hits(named, g)), name = known ? (all().find(g => sameName(named, g.eth))?.eth ?? all().find(g => sameName(named, g.rel))?.rel) : named;
  const forceIn = p => { const troops = Object.values(w.units).filter(u => u.country === c.id && u.province === p.id && !u.barracks), men = troops.reduce((a, u) => a + u.men, 0); return { troops, men, force: men + provincePop(p) * (c.police ?? 30) / 100 * .01 }; };
  switch (op.op) {
    // The law's disabilities on a people or a faith. Nothing given changes nothing; equal:true lifts them all.
    case 'set_status': {
      if (!rules) return fail('Only whoever governs can change the standing of a people before the law.');
      if (!known) return fail(`No people or faith of that name lives in the country: ${named || '(none given)'}.`);
      if (sameName(name, c.majorityEth) || sameName(name, c.majorityRel)) return fail(`${name} is the people or the faith of the state itself; the law cannot be turned on the majority in this way.`);
      const was = { ...(c.status?.[name] || {}) }, s = { ...was }; if (op.equal === true) { for (const k of [...DISABILITIES, 'levy', 'shielded']) delete s[k]; }
      for (const k of DISABILITIES) if (typeof op[k] === 'boolean') { if (op[k]) delete s[k]; else s[k] = false; }
      if (op.levy != null) { const v = num(op.levy, 0, .05, 0); if (v > 0) s.levy = v; else delete s.levy; }
      if (typeof op.protect === 'boolean') { if (op.protect) delete s.shielded; else s.shielded = false; }
      if (JSON.stringify(s) === JSON.stringify(was)) return fail(`Nothing in that changes how the ${name} stand before the law${Object.keys(was).length ? '' : ': they are equal citizens now'}.`);
      (c.status ||= {}); if (Object.keys(s).length) c.status[name] = s; else delete c.status[name]; if (!Object.keys(c.status).length) delete c.status;
      const now = statusOf(c, { eth: name, rel: name }), words = [now.vote ? '' : 'have no vote', now.office ? '' : 'may hold no office', now.arms ? '' : 'may not bear arms and are not taken for the army', now.levy ? `pay a levy of ${Math.round(now.levy * 1000) / 10} in the hundred of what they earn` : '', now.shielded ? '' : 'are left without the protection of the police'].filter(Boolean);
      news(w, `${c.name}: ${words.length ? `by law the ${name} ${words.join(', ')}` : `the ${name} are equal citizens again before the law`}.`, { kind: 'politics', countries: [c.id] });
      return { ok: true, msg: `${words.length ? `The ${name} now ${words.join(', ')}.` : `The ${name} stand as equal citizens before the law.`} ${words.length ? `They resent it wherever they live, some leave for their own nation when they can, regiments raised among them are the less to be relied on, their kin across the frontier hold it against this state, and a country that wants ${sameName(name, all().find(g => sameName(name, g.rel))?.rel) ? 'the faith' : 'the nation'} first approves, the more the more it wants it.` : ''}` };
    }
    // Members of a people put to work under guard. on:false ends it.
    case 'forced_labour': {
      if (!rules) return fail('Only whoever governs can order it.'); const p = w.provinces[op.province]; if (!p || p.controller !== c.id) return fail('That province is not under your control.');
      if (op.on === false) { if (!p.forced) return fail(`Nobody is held at forced labour in ${p.name}.`); const f = p.forced; delete p.forced; return { ok: true, msg: `The gangs in ${p.name} are dissolved: about ${thousands(f.dead || 0)} died at it while it lasted.` }; }
      if (!known || !groupsOf(p).some(g => hits(name, g))) return fail(`No such people live in ${p.name}.`);
      const share = num(op.share, .02, .5, .1), { troops, men, force } = forceIn(p), gang = provincePop(p) * groupsOf(p).filter(g => hits(name, g)).reduce((a, g) => a + g.share, 0) * share;
      if (force < gang * .05) return fail(`There is no force in ${p.name} able to hold ${thousands(gang)} people to it; troops or more police would have to be there first.`);
      const again = p.forced && sameName(p.forced.key, name); p.forced = { key: name, share, since: again ? p.forced.since : w.turn, by: c.id, order: actor.id, dead: again ? p.forced.dead : 0, worked: again ? p.forced.worked : 0, known: again ? p.forced.known : false };
      if (!again) { for (const u of troops) u.morale = clamp(u.morale - 2, 0, 100); leaveTrace(w, actor, `Ordered about ${thousands(gang)} ${name} people in ${p.name} put to forced labour.`); }
      return { ok: true, msg: `About ${thousands(gang)} ${name} people in ${p.name} are held to forced labour under guard${again ? ' (the order was already in force; its terms are changed, not its day)' : ''}. They dig field works where they stand and give hands to whatever the state builds there, for nothing; a few in the hundred of them die every quarter, more in winter and on hard ground, and as many run for the frontier; the province seethes, their kin abroad hold it against this state, and when it comes out the world thinks the less of it. It lasts until ended (on:false).` };
    }
    // People moved from one province to another: a people uprooted by force, or settlers of the state's own nation planted on land.
    case 'resettle': {
      if (!rules) return fail('Only whoever governs can order it.'); const from = w.provinces[op.from], to = w.provinces[op.to]; if (!from || !to || from.controller !== c.id || to.controller !== c.id || from.id === to.id) return fail('Both provinces must be different and under your control.');
      if (!known || !groupsOf(from).some(g => hits(name, g))) return fail(`No such people live in ${from.name}.`);
      if (allowance(w, from, 'resettle', 1, 1) <= 0) return fail(`${from.name} has been emptied as far as it can be in one quarter.`);
      const settlers = sameName(name, c.majorityEth), share = num(op.share, .01, settlers ? .1 : .6, settlers ? .05 : .2), match = g => hits(name, g), pop = provincePop(from), wanted = pop * groupsOf(from).filter(match).reduce((a, g) => a + g.share, 0) * share;
      if (settlers) { // Colonists go of their own will, for land and a grant: it costs money and nobody dies of it.
        const cost = wanted * 1.5 * (c.priceLevel || 1), note = pay(c, cost, 'other'); if (note === null) return fail(NO_FUNDS);
        const gone = removePeople(from, match, share); for (const g of gone) settlePeople(to, g.eth, g.rel, g.people); to.unrest = clamp(to.unrest + minorityShare(to, c) * 10, 0, 100);
        return { ok: true, msg: `About ${thousands(wanted)} ${name} settlers went from ${from.name} to ${to.name} with land and a grant; it cost ${Math.round(cost)}. Those who lived there before them see who the land is being given to.${note}` };
      }
      const { troops, men, force } = forceIn(from); if (force < pop * .002) return fail(`There is no force in ${from.name} able to carry this out; troops would have to be sent there first.`);
      const loyalty = men ? troops.reduce((a, u) => a + u.loyalty * u.men, 0) / men : (c.police ?? 30);
      if (rand(w) > clamp(.55 + loyalty / 160 + c.axes.auth / 400 - share * .2, .2, .97)) { for (const u of troops) { u.loyalty = clamp(u.loyalty - 8, 0, 100); u.morale = clamp(u.morale - 5, 0, 100); } leaveTrace(w, actor, `Ordered the removal of ${name} people from ${from.name}; the officers refused.`); return fail('The officers on the spot refused the order.'); }
      const reach = clamp(force * 12 / Math.max(wanted, 1), .2, 1), gone = removePeople(from, match, share * reach), taken = gone.reduce((a, g) => a + g.people, 0), far = from.neighbors.includes(to.id) ? 0 : 1, winter = w.turn % 4 === 0;
      const lost = clamp(.05 + far * .06 + (winter ? .06 : 0) + (['mountain', 'tundra', 'desert', 'marsh'].includes(to.terrain) ? .05 : 0), .05, .3), dead = taken * lost;
      for (const g of gone) settlePeople(to, g.eth, g.rel, g.people * (1 - lost));
      from.unrest = clamp(from.unrest - 10 * reach, 0, 100); to.unrest = clamp(to.unrest + taken / Math.max(provincePop(to), 1) * 80, 0, 100); from.devastation = clamp(from.devastation + share * reach * .15, 0, 1);
      from.scar = { turn: w.turn, by: c.id, weight: clamp((from.scar?.by === c.id ? from.scar.weight : 0) + taken / Math.max(pop, 1), 0, 1) }; c.blood = (c.blood || 0) + clamp(dead * .5, 0, 15);
      for (const u of troops) { u.morale = clamp(u.morale - 3, 0, 100); u.loyalty = clamp(u.loyalty - 2, 0, 100); }
      leaveTrace(w, actor, `Ordered about ${thousands(taken)} ${name} people moved from ${from.name} to ${to.name}.`);
      const known2 = !op.secret || rand(w) < clamp(.3 + c.pressFreedom / 120 + taken / Math.max(pop, 1), 0, .97), text = `${c.name} moved about ${thousands(taken)} ${name} people from ${from.name} to ${to.name} under guard; about ${thousands(dead)} died on the way.`;
      record(c, { turn: w.turn, province: from.id, name: from.name, method: 'deport', people: Math.round(taken), dead: Math.round(dead), group: name, by: actor.id, known: known2, text });
      const kin = aliveCountries(w).filter(o => o.id !== c.id && (sameName(o.majorityEth, name) || sameName(o.majorityRel, name))); for (const o of kin) if (known2) grudgeOf(o, c.id).incident += 4 + taken * .3;
      news(w, text, { kind: 'atrocity', countries: [c.id, ...(known2 ? kin.map(o => o.id) : [])], secret: !known2, province: from.id });
      return { ok: true, msg: `${thousands(taken)} ${name} people were moved under guard from ${from.name} to ${to.name}${reach < .95 ? ` (the force on the spot reached about ${Math.round(reach * 100)} in the hundred of those meant)` : ''}; about ${thousands(dead)} died on the way${winter ? ', it being winter' : ''}. ${from.name} is quieter and emptier, ${to.name} fuller and angrier, and ${known2 ? 'it is known abroad' : 'for now it is not known abroad'}.` };
    }
    // Stirring the majority against a people: printers, speakers, a paper's front page, a party's meetings. Anyone with money can do it.
    case 'incite': {
      if (!known) return fail(`No people or faith of that name lives in the country: ${named || '(none given)'}.`); if (sameName(name, c.majorityEth)) return fail('The majority is not stirred against itself.');
      const where = (op.province ? [w.provinces[op.province]].filter(p => p?.controller === c.id) : countryProvinces(w, c.id)).filter(p => groupsOf(p).some(g => hits(name, g) && g.eth !== c.majorityEth && g.share >= .03)); if (!where.length) return fail('There is nowhere in that reach where those people live among others in any number.');
      if (allowance(w, actor, `incite:${name}`, 1, 1) <= 0) return fail('Your printers and speakers have said what they can say against them this quarter.');
      const money = num(op.amount, 0, Math.max(0, actor.wealth), Math.min(2, Math.max(0, actor.wealth))), state = rules && op.state === true; let note = '';
      if (state) { note = pay(c, money * (c.priceLevel || 1), 'other'); if (note === null) return fail(NO_FUNDS); } else actor.wealth -= money;
      // How far a voice carries: money, the reach of the papers the actor owns, the organisation of the party he leads; a gagged press carries only the government's.
      const papers = (c.papers || []).filter(n => n.owner === actor.id).reduce((a, n) => a + (n.reach || 0) * (n.gag ? .4 : 1), 0), led = leads.reduce((a, x) => a + (x.organization || 0), 0);
      const voice = clamp((4 + money * 5 + papers * .8 + led * .3) * (rules ? 1.3 : (c.pressFreedom ?? 50) < 30 ? .4 : 1) / Math.sqrt(where.length), 2, 45);
      for (const p of where) for (const g of groupsOf(p)) if (hits(name, g) && g.eth !== c.majorityEth) { const cur = (p.incite ||= {})[g.eth]; p.incite[g.eth] = { level: clamp((cur?.level || 0) + voice, 0, 60), by: actor.id, turn: w.turn }; (p.incited ||= {})[g.eth] = actor.id; }
      // A party that stands for the nation first gains by it among the majority; one that does not loses its own.
      for (const x of leads.filter(x => !x.banned)) x.support = clamp(x.support + (x.axes.nation > 20 ? 1 : -1) * Math.min(1.5, voice / 20), 0, 100);
      news(w, `${c.name}: ${actor.name}'s ${papers > 0 ? 'papers' : 'speakers'} are stirring feeling against the ${name}${op.province ? ` in ${where[0].name}` : ''}.`, { kind: 'politics', countries: [c.id] });
      return { ok: true, msg: `Feeling against the ${name} is being stirred in ${where.length === 1 ? where[0].name : `${where.length} provinces`}${money ? ` (${Math.round(money * 10) / 10} spent)` : ''}. It is said in the open and everyone knows who says it. It fades in a few quarters unless kept up; where the law already marks those people, times are hard, their nation is at war with this one, or the police are few or told to look away, it can end with a mob in their streets, and then the dead are counted to whoever stirred it.${note}` };
    }
  }
  return fail('Unknown order.');
}
