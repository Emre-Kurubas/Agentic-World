// The politics of numbers: what somebody out of power can do with the people behind him. A petition, a society, a meeting, a call to strike.
// Each works as far as the party's organisation, its press, the law and the temper of the class it speaks for carry it; whoever governs can
// answer, ignore, forbid or break up, and each of those has its price.
// (World 19: in twelve quarters half of everything the eight leaders of the opposition ordered stayed words. They opened petitions, founded
// peasant societies, held meetings at mill gates, collected for dismissed teachers and promised strikes, and the engine had nothing to say
// to any of it. The user asked for these four instruments, 2026-11-12.)
import { clamp, news, rand, nextId, quarterLabel } from './util.js';
import { aliveCountries, countryProvinces } from './world.js';
import { governs, leadsParties } from './polity.js';
import { frighten, cowed, DREAD } from './fear.js';
import { isOpen, STATE } from './firms.js';

export const MASS_OPS = new Set(['petition', 'answer_petition', 'found_society', 'ban_society', 'rally', 'forbid_meetings', 'call_strike']);
const CLASSES = { workers: 'workers', peasants: 'peasants', middle: 'middle', worker: 'workers', peasant: 'peasants', labourers: 'workers', farmers: 'peasants', townsmen: 'middle', clerks: 'middle', shopkeepers: 'middle' };
const NAMES = { workers: 'the workers', peasants: 'the peasants', middle: 'the middle class' };
const KINDS = { union: 'workers', peasants: 'peasants', mutual: 'middle' }, KIND_WORDS = { union: 'a union of working men', peasants: 'a peasants\' society', mutual: 'a mutual aid society' };
const say = (w, ch, from, text) => { if (ch?.alive) ch.inbox.push({ turn: w.turn, from, text }); };
const r1 = v => Math.round(v * 10) / 10;
// How many of a class there are, and how they stand against the day the state was handed over.
const classOf = (w, c, k) => { const home = countryProvinces(w, c.id), n = home.reduce((a, p) => a + p.pops[k].n, 0), sat = n ? home.reduce((a, p) => a + p.pops[k].sat * p.pops[k].n, 0) / n : 50; return { n, sat, anger: clamp(((c.moodBase?.[k] ?? 50) - sat) * 2 + (50 - sat) * .6, 0, 60) }; };
// How far an opposition can reach people: what the law leaves of a press and of meeting, and how afraid people are.
const openness = c => clamp(.3 + c.pressFreedom / 100 * .7, .3, 1) * cowed(c);
const paperReach = (c, id) => clamp((c.papers || []).filter(n => n.owner === id).reduce((a, n) => a + (n.reach || 0), 0), 0, 60);
const partyOf = (w, c, actor) => leadsParties(w, c, actor)[0] ?? null;
export const societiesOf = (c, party) => (c.societies || []).filter(s => !s.banned && (!party || s.party === party));
// What a union adds to men who are out: the chest that feeds them (labour.js).
export const strikeChest = c => clamp(societiesOf(c).filter(s => s.kind === 'union').reduce((a, s) => a + s.strength, 0) / 300, 0, .3);

export function massOp(w, actor, c, op, h) {
  const { fail, num } = h, state = governs(w, c, actor), party = partyOf(w, c, actor);
  switch (op.op) {
    // Signatures and marks gathered for a demand, in the name of a class, and laid before whoever governs.
    case 'petition': {
      if (!party) return fail('A petition is carried by a party\'s committees: you lead none. (A party is founded with found_party.)');
      const cls = CLASSES[String(op.class ?? op.cls ?? '').toLowerCase()] ?? party.base ?? 'workers', k = NAMES[cls] ? cls : 'workers', demand = String(op.demand ?? op.text ?? '').trim().slice(0, 600);
      if (!demand) return fail('Say what the petition asks (demand): one thing, in a sentence.');
      const open = (c.petitions ||= []).find(x => x.party === party.id && ['gathering', 'presented'].includes(x.status)); if (open) return fail(`The committees are still carrying petition ${open.id} ("${open.demand.slice(0, 80)}"): one at a time, or nobody signs either.`);
      const last = c.petitions.filter(x => x.party === party.id).at(-1); if (last && w.turn - last.turn < 2) return fail('The committees have only just come back from the last one: next quarter.');
      const x = { id: nextId(w, 'PT'), by: actor.id, party: party.id, cls: k, demand, turn: w.turn, status: 'gathering' }; c.petitions.push(x); if (c.petitions.length > 24) c.petitions.shift();
      news(w, `${c.name}: the ${party.name} has opened a petition in the name of ${NAMES[k]}: ${demand}`, { kind: 'politics', countries: [c.id] });
      return { ok: true, msg: `Petition ${x.id} is being carried round in the name of ${NAMES[k]}: "${demand}". How many sign depends on the party's organisation (${Math.round(party.organization || 0)} of 100), on what its papers reach, on what the law leaves of meeting and print, and on how angry they are about it. It is laid before whoever governs when the quarter is out, with its count; a petition that is granted, refused or left lying each does something to the party and to the government among ${NAMES[k]}.` };
    }
    case 'answer_petition': {
      if (!state) return fail('A petition is answered by whoever governs.');
      const waiting = (c.petitions || []).filter(x => x.status === 'presented'), x = waiting.find(p => p.id === op.id) ?? (op.id == null && waiting.length === 1 ? waiting[0] : null);
      if (!x) return fail(waiting.length ? `Which petition? Lying before you: ${waiting.map(p => `${p.id} (${NAMES[p.cls]}: ${p.demand.slice(0, 60)})`).join('; ')}.` : 'No petition lies before you.');
      const answer = { grant: 'granted', granted: 'granted', yes: 'granted', refuse: 'refused', refused: 'refused', no: 'refused', receive: 'received', received: 'received' }[String(op.answer ?? '').toLowerCase()];
      if (!answer) return fail('Say how it is answered (answer): grant, refuse, or receive (taken into the hand with a promise to consider it).');
      const p = c.parties.find(q => q.id === x.party), by = w.characters[x.by], s = x.share || 0;
      if (answer === 'received') { if (x.received) return fail(`${x.id} has been received already; it wants an answer now.`); x.received = w.turn; say(w, by, c.name, `Petition ${x.id} was received by the government, which promises to consider it.`); return { ok: true, msg: `Petition ${x.id} is received with a promise to consider it. That holds for two quarters; after that it lies unanswered again.` }; }
      x.status = answer; x.closedAt = w.turn;
      if (answer === 'granted') { c.mods.push({ key: `sat.${x.cls}`, delta: s * 14, turns: 4, label: `The petition granted` }); c.legitimacy = clamp(c.legitimacy + s * 3, 0, 100); if (p) p.support = clamp(p.support + s * 5, 0, 100);
        news(w, `${c.name}: the government has granted the petition of ${NAMES[x.cls]}: ${x.demand}`, { kind: 'politics', countries: [c.id] }); say(w, by, c.name, `Petition ${x.id} was granted by the government.`);
        return { ok: true, msg: `Petition ${x.id} is granted, and it is in the papers. ${NAMES[x.cls][0].toUpperCase() + NAMES[x.cls].slice(1)} give the government credit for it for a year, and the party that carried it some too. Granting is a word: what was asked has still to be done by an order of its own, and a grant nothing follows is remembered.` }; }
      c.mods.push({ key: `sat.${x.cls}`, delta: -s * 10, turns: 4, label: 'The petition refused' }); if (p) { p.support = clamp(p.support + s * 9, 0, 100); p.organization = clamp((p.organization || 0) + s * 8, 0, 100); }
      news(w, `${c.name}: the government has refused the petition of ${NAMES[x.cls]}: ${x.demand}`, { kind: 'politics', countries: [c.id] }); say(w, by, c.name, `Petition ${x.id} was refused by the government.`);
      return { ok: true, msg: `Petition ${x.id} is refused, and it is in the papers. Those who signed hold it against the government for a year, and the party that carried it is the stronger for the refusal.` };
    }
    // A body of people that outlasts a campaign: a union, a peasants' society, a mutual aid chest.
    case 'found_society': {
      if (!party) return fail('A society needs a party\'s committees behind it: you lead none.');
      const kind = { union: 'union', unions: 'union', workers: 'union', peasants: 'peasants', peasant: 'peasants', mutual: 'mutual', aid: 'mutual', school: 'mutual' }[String(op.kind ?? '').toLowerCase()] ?? (party.base === 'peasants' ? 'peasants' : party.base === 'workers' ? 'union' : 'mutual');
      const mine = societiesOf(c, party.id); if (mine.some(s => s.kind === kind)) return fail(`The party has ${KIND_WORDS[kind]} already (${mine.find(s => s.kind === kind).name}): it grows by what the party spends and by what its people suffer, not by being founded twice.`);
      const m = Math.min(Math.max(actor.wealth, 0), num(op.amount, 0, 1e6, 0)), lawful = kind !== 'union' || !!c.unions;
      const s = { id: nextId(w, 'SO'), name: String(op.name || `${party.name} ${kind === 'union' ? 'Union' : kind === 'peasants' ? 'Peasants\' Society' : 'Mutual Aid'}`).slice(0, 60), kind, cls: KINDS[kind], party: party.id, by: actor.id, strength: 2 + m, funds: m, lawful, since: w.turn }; actor.wealth -= m; (c.societies ||= []).push(s);
      if (lawful) news(w, `${c.name}: ${s.name} has been founded.`, { kind: 'politics', countries: [c.id] });
      else { (actor.secrets ||= []).push({ turn: w.turn, text: `Founded ${s.name}, a union the law forbids.` }); actor.secrets = actor.secrets.slice(-12); }
      return { ok: true, msg: `${s.name} (${s.id}) is founded${m >= 1 ? ` with ${r1(m)} from your purse` : ''}: ${KIND_WORDS[kind]}. ${lawful ? 'It is lawful and in the open.' : 'Unions are forbidden here: it meets in back rooms, grows slowly, and those who are found in it answer for it; it is a secret of yours.'} It grows with what the party's organisation gives it and with what ${NAMES[s.cls]} have to bear, pays a little into the party's chest, binds its people to the party, and (a union) feeds men who are out on strike. Whoever governs can forbid it (ban_society).` };
    }
    case 'ban_society': {
      if (!state) return fail('Only whoever governs forbids a society.');
      const s = (c.societies || []).find(x => !x.banned && (x.id === op.id || x.name.toLowerCase() === String(op.id ?? op.name ?? '').toLowerCase())); if (!s) return fail(`No such society.${societiesOf(c).length ? ` Those that exist: ${societiesOf(c).map(x => `${x.name} (${x.id})`).join(', ')}.` : ''}`);
      s.banned = w.turn; frighten(c, 2 + s.strength / 12); c.pressFreedom = clamp(c.pressFreedom - 1, 0, 100); c.mods.push({ key: `sat.${s.cls}`, delta: -s.strength / 8, turns: 4, label: `${s.name} forbidden` }); const p = c.parties.find(q => q.id === s.party); if (p) p.support = clamp(p.support + s.strength / 20, 0, 100);
      news(w, `${c.name}: ${s.name} has been forbidden and its chest seized.`, { kind: 'politics', countries: [c.id] }); say(w, w.characters[s.by], c.name, `${s.name} has been forbidden by the government and its chest seized.`); c.treasury += (s.funds || 0) * (c.rate || 1);
      return { ok: true, msg: `${s.name} is forbidden and its chest (${r1(s.funds || 0)}) seized. Its people hold it against the government for a year, the party behind it gains some of them outright, and it is one more door shut: what was said in the open is now said elsewhere.` };
    }
    // A meeting: people brought together in one place, to be counted and to be heard.
    case 'rally': {
      if (!party) return fail('A meeting is called by a party: you lead none.');
      const p = w.provinces[op.province] ?? w.provinces[c.capital]; if (!p || p.controller !== c.id) return fail('No such province of the country.');
      if ((c.rallied ||= {})[party.id] === w.turn) return fail('The party has held its meeting this quarter; another so soon draws the same faces.');
      c.rallied[party.id] = w.turn; const cost = Math.min(Math.max(party.funds || 0, 0), 1), k = party.base && NAMES[party.base] ? party.base : 'workers', a = classOf(w, c, k), size = clamp(((party.organization || 0) * .6 + paperReach(c, actor.id) * .3 + a.anger * .7 + cost * 6) * openness(c), 0, 100);
      party.funds = (party.funds || 0) - cost;
      // Where meetings are forbidden the police break it up; whether blood is shed depends on how many came and how restless the place is.
      if (c.noMeetings) { const blood = rand(w) < clamp(size / 160 + p.unrest / 250, .05, .7), dead = blood ? Math.round(2 + rand(w) * size / 4) : 0;
        if (dead) { c.blood = (c.blood || 0) + dead / 6; frighten(c, DREAD.strike + dead / 10); p.scar = { by: c.id, turn: w.turn, weight: clamp((p.scar?.by === c.id ? p.scar.weight : 0) + .08, 0, 1) }; c.legitimacy = clamp(c.legitimacy - (1 + c.pressFreedom / 50), 0, 100); }
        else frighten(c, 2);
        party.support = clamp(party.support + size / 40 + (dead ? 2 : 0), 0, 100);
        news(w, `${c.name}: the police broke up a meeting of the ${party.name} at ${p.name}${dead ? `; ${dead} were killed` : ''}.`, { kind: 'politics', countries: [c.id], province: p.id });
        say(w, w.characters[c.leader], 'Police', `The forbidden meeting of the ${party.name} at ${p.name} was broken up${dead ? `: ${dead} dead, and the town will remember it` : ' without bloodshed'}.`);
        return { ok: true, msg: `The meeting at ${p.name} was broken up by the police, meetings being forbidden${dead ? `: ${dead} of those who came are dead` : '; nobody was killed'}. The party is the stronger among those who were there and those who heard of it.` }; }
      party.organization = clamp((party.organization || 0) + size / 12, 0, 100); party.support = clamp(party.support + size / 30, 0, 100); if (size > 55 && p.unrest > 55) p.unrest = clamp(p.unrest + 3, 0, 100);
      news(w, `${c.name}: a meeting of the ${party.name} at ${p.name} drew ${size >= 60 ? 'a great crowd' : size >= 30 ? 'a fair crowd' : 'a thin crowd'}.`, { kind: 'politics', countries: [c.id], province: p.id });
      return { ok: true, msg: `The meeting at ${p.name} drew ${size >= 60 ? 'a great crowd' : size >= 30 ? 'a fair crowd' : 'a thin crowd'}: the party's organisation and standing are the better for it by about that much. A crowd comes for a party it knows (organisation), that prints (a paper of yours), where meeting is free, and when it is angry.` };
    }
    case 'forbid_meetings': { if (!state) return fail('Only whoever governs forbids or allows public meetings.'); const on = op.on !== false; if (!!c.noMeetings === on) return { ok: true, msg: on ? 'Public meetings are forbidden already.' : 'Public meetings are allowed already.' };
      c.noMeetings = on; c.pressFreedom = clamp(c.pressFreedom + (on ? -4 : 3), 0, 100); if (on) frighten(c, 3); news(w, `${c.name}: public meetings are ${on ? 'forbidden' : 'allowed again'}.`, { kind: 'politics', countries: [c.id] });
      return { ok: true, msg: on ? 'Public meetings are forbidden: the police break up any that is held, and what happens then depends on how many came. It is a door shut, and counted as one.' : 'Public meetings are allowed again.' }; }
    // Calling the men out where the party's union stands among them.
    case 'call_strike': {
      if (!party) return fail('A strike is called by those the men would follow: you lead no party.');
      const union = societiesOf(c, party.id).find(s => s.kind === 'union'); if (!union || union.strength < 10) return fail(`The men come out for a union they know, and the party has ${union ? `one of little weight yet (${union.name}, ${Math.round(union.strength)} of 100)` : 'none (found_society with kind union)'}. Anybody can stir the men of one works (agitate).`);
      const firms = Object.values(w.firms || {}).filter(f => isOpen(f) && f.country === c.id && !f.strike && !f.lockout && (op.id ? f.id === op.id : op.sector ? f.sector === op.sector || f.resource === op.sector : op.province ? f.province === op.province : true));
      if (!firms.length) return fail('No works of that description stands open to be struck.');
      if ((c.called ||= {})[party.id] != null && w.turn - c.called[party.id] < 2) return fail('The union called the men out last quarter; it cannot ask it of them again so soon.');
      c.called[party.id] = w.turn; let out = 0; const pull = union.strength * .5 * cowed(c);
      for (const f of firms.sort((a, b) => (b.temper || 0) - (a.temper || 0)).slice(0, 12)) { f.stir = (f.stir || 0) + pull * .5; if ((f.temper || 30) + pull > 62) { f.temper = Math.max(f.temper || 0, 66); f.called = w.turn; out++; } }
      if (!union.lawful || !c.unions) { (actor.secrets ||= []).push({ turn: w.turn, text: `Called the men of ${firms.length > 1 ? 'the works' : firms[0].name} out on strike, which the law forbids.` }); actor.secrets = actor.secrets.slice(-12); }
      news(w, `${c.name}: the ${party.name} has called the men ${op.id ? `of ${firms[0].name}` : op.sector ? `of the ${op.sector} trade` : 'of the works'} out.`, { kind: 'politics', countries: [c.id] });
      return { ok: true, msg: `The call has gone out through ${union.name} to ${firms.length > 12 ? 12 : firms.length} works. At ${out} of them the men are angry enough to follow it and will be out when the quarter turns; at the rest it has only stirred them. A union's chest keeps strikers fed for a time; what the owners and the government do about it is theirs to decide.${!c.unions ? ' Unions being forbidden, calling a strike is an offence, and yours to answer for if it comes out.' : ''}` };
    }
  }
  return fail('Unknown operation.');
}

// The quarter: petitions are counted and laid before the government; those left lying cost it; societies grow or wither.
export function massStep(w) {
  for (const c of aliveCountries(w)) {
    for (const x of c.petitions || []) { const p = c.parties.find(q => q.id === x.party), by = w.characters[x.by], ruler = w.characters[c.leader];
      if (x.status === 'gathering') { const a = classOf(w, c, x.cls), society = societiesOf(c, x.party).filter(s => s.cls === x.cls).reduce((s, q) => s + q.strength, 0);
        x.share = clamp((.01 + (p?.organization || 0) / 220 + paperReach(c, x.by) / 300 + a.anger / 130 + society / 400) * openness(c), .003, .6); x.signed = a.n * x.share; x.status = 'presented'; x.presented = w.turn;
        if (p) { p.support = clamp(p.support + x.share * 8, 0, 100); p.organization = clamp((p.organization || 0) + x.share * 10, 0, 100); }
        const count = x.signed >= 10 ? `${Math.round(x.signed)} thousand` : `${Math.round(x.signed * 1000)}`;
        say(w, ruler, 'The chancery', `A petition (${x.id}) in the name of ${NAMES[x.cls]}, with ${count} signatures and marks (about ${Math.max(1, Math.round(x.share * 100))} in the hundred of them), is laid before you by ${by?.name ?? 'its committee'} of the ${p?.name ?? 'party'}: "${x.demand}" It can be granted, refused, or received with a promise to consider it (answer_petition). Granting is a word, and what it asks has still to be ordered. Left lying, it costs the government a little among them each quarter for a year.`);
        say(w, by, 'The committees', `Petition ${x.id} was signed by ${count} (about ${Math.max(1, Math.round(x.share * 100))} in the hundred of ${NAMES[x.cls]}) and has been laid before the government.`);
        news(w, `${c.name}: a petition of ${NAMES[x.cls]} with ${count} signatures and marks has been laid before the government: ${x.demand}`, { kind: 'politics', countries: [c.id] }); }
      else if (x.status === 'presented') { const held = x.received != null && w.turn - x.received <= 2;
        if (w.turn - x.presented >= 4) { x.status = 'lapsed'; x.closedAt = w.turn; say(w, by, 'The committees', `Petition ${x.id} was never answered. People have stopped asking after it.`); }
        else if (!held) { c.legitimacy = clamp(c.legitimacy - x.share * 2, 0, 100); c.mods.push({ key: `sat.${x.cls}`, delta: -x.share * 6, turns: 1, label: 'The petition unanswered' }); } } }
    for (const s of societiesOf(c)) { const p = c.parties.find(q => q.id === s.party); if (!p || p.banned) { s.banned = w.turn; continue; }
      const a = classOf(w, c, s.cls), target = clamp(((p.organization || 0) * .7 + (s.funds || 0) * 2 + a.anger) * openness(c) * (s.lawful ? 1 : .35), 0, 85); s.strength += (target - s.strength) * .2; s.funds = (s.funds || 0) * .85;
      // It binds its people to the party, eases them a little, and pays a little into the party's chest.
      p.support = clamp(p.support + s.strength / 250, 0, 100); p.funds = (p.funds || 0) + s.strength / 60; if (s.strength >= 8) c.mods.push({ key: `sat.${s.cls}`, delta: s.strength / 30, turns: 1, label: s.name });
      // A forbidden union is sometimes found.
      if (!s.lawful && rand(w) < clamp(c.police / 900 + s.strength / 600, .01, .2)) { s.banned = w.turn; frighten(c, 3); const by = w.characters[s.by]; say(w, w.characters[c.leader], 'Police', `A forbidden union, ${s.name}, has been found and broken up. It was founded by ${by?.name ?? 'persons unknown'}.`); say(w, by, 'A friend', `The police have found ${s.name} and broken it up, and they have your name.`); if (by?.alive && w.characters[c.leader]?.alive) { const file = ((w.characters[c.leader].dossiers ||= {})[by.id] ||= { turn: w.turn, about: by.name, facts: [] }); file.facts.push(`Founded ${s.name}, a union the law forbids.`); } } }
    if (c.societies) c.societies = c.societies.filter(s => !s.banned || w.turn - s.banned < 20);
    if (c.petitions) c.petitions = c.petitions.filter(x => ['gathering', 'presented'].includes(x.status) || w.turn - (x.closedAt ?? w.turn) < 12);
  }
}
// What a party has in the way of people: for the party return and the desk.
export function massWords(w, c, party) {
  const out = [], ss = societiesOf(c, party?.id), ps = (c.petitions || []).filter(x => (!party || x.party === party.id) && ['gathering', 'presented'].includes(x.status));
  for (const s of ss) out.push(`${s.name} (${s.id}), ${KIND_WORDS[s.kind]}${s.lawful ? '' : ', forbidden by law and kept dark'}: ${s.strength >= 50 ? 'a power among its people' : s.strength >= 25 ? 'of some weight' : s.strength >= 10 ? 'small but standing' : 'a handful'} (${Math.round(s.strength)} of 100), since ${quarterLabel(s.since)}.`);
  for (const x of ps) out.push(`Petition ${x.id} in the name of ${NAMES[x.cls]} ("${x.demand.slice(0, 120)}"): ${x.status === 'gathering' ? 'being carried round; counted when the quarter is out' : `laid before the government in ${quarterLabel(x.presented)} with about ${Math.max(1, Math.round(x.share * 100))} in the hundred of them signed${x.received != null ? ', received and not yet answered' : ', not yet answered'}`}.`);
  if (c.noMeetings) out.push('Public meetings are forbidden; the police break up any that is held.');
  return out;
}
