// Between states: a word that is worth something or is not, demands with a date on them, guarantees, and what becomes of people who flee.
// A state's honour is what others have seen it do with its promises. An ultimatum that is not acted on is a bluff called; a guarantee
// that is not kept is remembered; an exile lives somewhere, and whoever shelters him holds a card.
import { clamp, news, sum, quarterLabel } from './util.js';
import { aliveCountries, hasTreaty, atWar } from './world.js';

const say = (w, ch, from, text) => { if (ch?.alive) ch.inbox.push({ turn: w.turn, from, text }); };
export const honourOf = c => c.honour ?? 60;
export const honourWord = v => v >= 75 ? 'its word is trusted' : v >= 50 ? 'its word is taken with care' : v >= 30 ? 'its word is doubted' : 'its word is worth nothing';
// One place where a state's standing with others changes, so that every such change leaves a line the country can read.
export function shame(w, c, by, why) {
  c.honour = clamp(honourOf(c) + by, 0, 100); (c.honourLog ||= []).push({ turn: w.turn, by, why }); c.honourLog = c.honourLog.slice(-8);
}
const sideOf = (war, id) => war.a.includes(id) ? 'a' : war.b.includes(id) ? 'b' : null;

// ---- Envoys ----
// Each government has a stance toward each other one: its envoy at his post, which is the usual thing; the envoy recalled; relations broken
// off. Between two states the worse of the two stances holds. With envoys recalled nothing can be signed that binds the two closer, and
// each sees less of the other's capital every quarter; with relations broken nothing can be signed between them at all except what halts or
// ends a war, unless a third state carries it (a mediator, a conference), their trade loses its consuls and costs more, and patrols that meet
// have no one to smooth it over. Either is also an answer, of a kind, to a wrong the country holds against the other.
const RANK = { normal: 0, recalled: 1, broken: 2 }, TIES = ['normal', 'recalled', 'broken'];
export const stanceOf = (c, id) => TIES[RANK[c?.stance?.[id]] ?? 0];
export const tieOf = (w, a, b) => TIES[Math.max(RANK[stanceOf(w.countries[a], b)], RANK[stanceOf(w.countries[b], a)])];
export const tieWord = t => t === 'broken' ? 'relations broken off' : t === 'recalled' ? 'envoys recalled' : 'envoys at their posts';
export const maySign = (w, a, b, kind, carried = false) => { const tie = tieOf(w, a, b); return tie === 'normal' || carried || ['peace', 'armistice'].includes(kind) || (tie === 'recalled' && kind === 'nonaggression'); };

// ---- Recognition ----
// A state born of a rising is a state to those who say so. The states the world began with are recognised by all. Until a government
// recognises a new state it signs nothing with it and its merchants do not trade there; the mother country recognises it by making peace with it.
export const recognises = (w, a, b) => { const o = w.countries[b]; return !o?.recognition || o.recognition.includes(a); };
export const dealsWith = (w, a, b) => recognises(w, a, b) && recognises(w, b, a);

// ---- What has been done about a wrong ----
// A people that holds something against a neighbour wants it answered. War answers it whole. What a government does short of war answers part:
// a recalled envoy, relations broken off, a duty aimed at their goods, a ban on some trade or all of it, an ultimatum that is still running.
// The steps add up, but never to more than seven tenths of the wrong: the rest waits for satisfaction or for time.
export function answered(w, c, id) {
  let left = 1; const stance = stanceOf(c, id);
  if (stance === 'recalled') left *= .85; else if (stance === 'broken') left *= .7;
  if ((c.aimed?.[id] ?? -1) >= (c.tariff ?? 0) + .1) left *= .85;
  if ((c.embargo || []).includes(id)) left *= .55; else if (c.bans?.[id] && (c.bans[id].sell.length || c.bans[id].buy.length)) left *= .8;
  if (c.casus?.[id] != null || w.treaties.some(t => t.pending && t.ultimatum && t.proposer === c.id && t.parties.includes(id))) left *= .8;
  // A squadron shown off their coast within the year is an answer of a kind too.
  if (w.turn - (c.shown?.[id] ?? -99) <= 3) left *= .85;
  return 1 - Math.max(left, .3);
}

// ---- Papers kept secret ----
// A treaty signed in secret binds as hard as any other. It is known to whoever governs each state that signed, and where it concerns the
// army to its chief of staff; to nobody else at home and to no other government, until a service with good eyes in one of those capitals
// comes by it, a bought clerk sees it pass, or someone who holds it makes it public.
export const MILITARY = ['alliance', 'military_access', 'nonaggression', 'armistice', 'guarantee', 'protection'];
export const kindWord = t => t.kind === 'guarantee' ? `a joint guarantee` : `${/^[aeiou]/.test(t.kind) ? 'an' : 'a'} ${t.kind.replace('_', ' ')} treaty`;
export function seesTreaty(w, ch, t) {
  if (!t.secret) return true; const c = w.countries[ch.country]; if (!c) return false;
  if ((ch.papers || []).includes(t.id)) return true;
  const office = c.leader === ch.id || (c.regent ?? null) === ch.id ? 'ruler' : c.general === ch.id ? 'staff' : null; if (!office) return false;
  const inside = t.parties.includes(c.id) || (t.open || []).includes(c.id) || t.proposer === c.id || t.mediator === c.id;
  return inside ? office === 'ruler' || MILITARY.includes(t.kind) : (t.known || []).includes(c.id);
}
// A secret paper comes to light. Those who were left out read it as aimed at them; a chamber that makes the laws and was told nothing takes
// it ill; and a signatory who published what it had promised to keep is known for that.
export function reveal(w, t, by = null, person = null) {
  if (!t.secret) return false; t.secret = false; t.revealed = { turn: w.turn, by: by?.id ?? null };
  const live = t.parties.map(id => w.countries[id]).filter(o => o?.alive), names = live.map(o => o.name).join(', '), hard = MILITARY.includes(t.kind);
  news(w, `A secret treaty has come to light: ${names} have been bound by ${kindWord(t)} since ${quarterLabel(t.since ?? t.turn)}${t.terms ? ` ("${t.terms}")` : ''}. ${person ? `It was made public by ${person.name}.` : by ? `It was made public by ${by.name}.` : ''}`, { kind: 'diplomacy', countries: t.parties });
  for (const p of live) {
    for (const o of aliveCountries(w)) if (!t.parties.includes(o.id)) o.relations[p.id] = clamp((o.relations[p.id] ?? 0) - (hard ? 10 : 4), -100, 100);
    if (p.parliament?.legislative && w.turn >= (p.parliament.suspendedUntil ?? 0)) p.legitimacy = clamp(p.legitimacy - 3 * (.4 + p.pressFreedom / 100), 0, 100);
    say(w, w.characters[p.leader], 'Foreign Ministry', `The secret ${t.kind.replace('_', ' ')} treaty ${t.id} is public now${person ? `: ${person.name} made it so` : by ? `: ${by.name} made it so` : ''}. Governments that were not told of it take it as aimed at them${p.parliament?.legislative ? ', and the chamber here was not told either' : ''}.`);
  }
  if (by && t.parties.includes(by.id)) { shame(w, by, -5, 'it made public a treaty it had signed in secret'); for (const p of live) if (p.id !== by.id) p.relations[by.id] = clamp((p.relations[by.id] ?? 0) - 25, -100, 100); }
  return true;
}

// ---- The aims of a war ----
// What a war was declared for, if anything was said. How far it is in hand on the ground: the provinces named are held, the ruler named has
// fallen, the treaty named is dead. Money cannot be taken in the field; it waits for the peace.
export function aimsHeld(w, c, aim, foe) {
  if (!aim || aim.reparations > 0) return false; const parts = [];
  if (aim.provinces?.length) parts.push(aim.provinces.every(pid => w.provinces[pid]?.controller === c.id));
  if (aim.regime) parts.push(!foe?.alive || foe.leader !== aim.rulerThen);
  if (aim.treaty) parts.push(!w.treaties.some(t => t.id === aim.treaty && t.active));
  return parts.length > 0 && parts.every(Boolean);
}
// How much of what was declared a peace delivers, from 0 to 1.
export function aimsMet(w, c, aim, foe, paid = 0) {
  const parts = [];
  if (aim.provinces?.length) parts.push(aim.provinces.filter(pid => w.provinces[pid]?.owner === c.id).length / aim.provinces.length);
  if (aim.reparations > 0) parts.push(clamp(paid / aim.reparations, 0, 1));
  if (aim.regime) parts.push(!foe?.alive || foe.leader !== aim.rulerThen ? 1 : 0);
  if (aim.treaty) parts.push(w.treaties.some(t => t.id === aim.treaty && t.active) ? 0 : 1);
  return parts.length ? sum(parts, x => x) / parts.length : 1;
}
export const aimsText = (w, aim) => [aim.provinces?.length ? `${aim.provinces.map(pid => `${w.provinces[pid]?.name} (${pid})`).join(', ')}` : '', aim.reparations > 0 ? `an indemnity of ${Math.round(aim.reparations * 100)}% of a quarter's output` : '', aim.regime ? `the fall of ${w.characters[aim.rulerThen]?.name ?? 'the government'}` : '', aim.treaty ? `the end of treaty ${aim.treaty}` : ''].filter(Boolean).join('; ') || aim.text || '';

export function diplomacyStep(w) {
  const cs = aliveCountries(w);
  for (const c of cs) {
    // A good name comes back slowly, by years in which nothing is broken.
    if (honourOf(c) < 70 && w.turn - (c.honourLog?.at(-1)?.turn ?? -99) >= 4) c.honour = Math.min(70, honourOf(c) + .5);
    // A threat with a date on it and nothing behind it.
    for (const [id, until] of Object.entries(c.casus || {})) { if (w.turn <= until) continue; delete c.casus[id]; const o = w.countries[id]; if (!o?.alive || atWar(w, c.id, id)) continue; shame(w, c, -6, `its ultimatum to ${o.name} came to nothing`); c.legitimacy = clamp(c.legitimacy - 3, 0, 100); news(w, `${c.name}'s ultimatum to ${o.name} has run out and nothing has followed.`, { kind: 'diplomacy', countries: [c.id, id] }); say(w, w.characters[c.leader], 'Foreign Ministry', `The ultimatum to ${o.name} ran out unanswered and we have not acted. Abroad and at home it is being called a bluff.`); }
  }
  // Demands whose day has passed.
  for (const t of w.treaties) {
    if (!t.pending || !t.ultimatum || w.turn < t.ultimatum.deadline) continue;
    t.pending = false; const from = w.countries[t.proposer], to = w.countries[t.parties.find(x => x !== t.proposer)]; if (!from?.alive || !to?.alive) continue;
    (from.casus ||= {})[to.id] = w.turn + 3;
    news(w, `${to.name} has let ${from.name}'s ultimatum run out unanswered.`, { kind: 'diplomacy', countries: [from.id, to.id] });
    say(w, w.characters[from.leader], 'Foreign Ministry', `${to.name} has not accepted the ultimatum (${t.id}). For three quarters the country and the world will take a declaration of war as the consequence you announced. If nothing follows, the threat will be remembered as empty.`);
  }
  // A guarantee or an alliance is tested when the friend is attacked.
  for (const war of w.wars.filter(x => x.active && !x.civil)) {
    for (const victim of war.b.map(id => w.countries[id]).filter(o => o?.alive)) for (const g of cs) {
      if (g.id === victim.id || sideOf(war, g.id) === 'a') continue;
      const bound = (w.guarantees || []).some(x => x.by === g.id && x.of === victim.id) ? 'guarantee' : hasTreaty(w, g.id, victim.id, 'alliance') ? 'alliance' : w.treaties.some(t => t.active && t.kind === 'protection' && t.protector === g.id && t.parties.includes(victim.id)) ? 'protection' : null; if (!bound) continue;
      const key = `${g.id}>${victim.id}`, seen = war.called ||= {};
      if (sideOf(war, g.id) === 'b') { if (seen[key] !== 'kept') { seen[key] = 'kept'; shame(w, g, 5, `it stood by ${victim.name} when ${victim.name} was attacked`); } continue; }
      if (!seen[key]) { seen[key] = w.turn; say(w, w.characters[g.leader], 'Foreign Ministry', `${victim.name}, to which we are bound by ${bound === 'guarantee' ? 'our guarantee' : 'alliance'}, is at war: ${war.name}. Our word is at stake. If we have not come in on its side within half a year, the world will know what our word is worth.`); }
      else if (typeof seen[key] === 'number' && w.turn - seen[key] >= 2) { seen[key] = 'failed'; for (const t of w.treaties) if (t.active && t.secret && t.kind === 'alliance' && t.parties.includes(g.id) && t.parties.includes(victim.id)) reveal(w, t, victim); shame(w, g, -10, `it left ${victim.name} to fight alone in spite of its ${bound}`); g.legitimacy = clamp(g.legitimacy - 2, 0, 100); news(w, `${g.name} has not come to the help of ${victim.name}, in spite of its ${bound}.`, { kind: 'diplomacy', countries: [g.id, victim.id] }); }
    }
  }
  // Someone driven out lives somewhere: in the neighbouring country least friendly to the one that drove them out.
  for (const ch of Object.values(w.characters)) {
    if (!ch.alive || ch.status !== 'exiled') { if (ch.host) ch.host = null; continue; }
    if (ch.host && w.countries[ch.host]?.alive && ch.host !== ch.country) continue;
    const home = w.countries[ch.country], hosts = cs.filter(o => o.id !== ch.country).sort((a, b) => (a.relations[ch.country] ?? 0) - (b.relations[ch.country] ?? 0)); if (!hosts.length) continue;
    ch.host = hosts[0].id; say(w, w.characters[hosts[0].leader], 'Police', `${ch.name}, driven out of ${home?.name ?? 'their country'}, has settled among us. Sheltering, expelling or handing them back is yours to decide.`); say(w, ch, 'A border post', `You have crossed into ${hosts[0].name} and are living there.`);
  }
  w.guarantees = (w.guarantees || []).filter(x => w.countries[x.by]?.alive && w.countries[x.of]?.alive);
  // Without an envoy at his post a government sees less of the other capital each quarter, and with relations broken almost nothing.
  for (const c of cs) for (const o of cs) { if (o.id === c.id) continue; const tie = tieOf(w, c.id, o.id); if (tie === 'normal') continue; const cap = tie === 'broken' ? 12 : 30, have = c.intel?.[o.id] ?? 15; if (have > cap) c.intel[o.id] = Math.max(cap, have - (tie === 'broken' ? 10 : 5)); }
  // A secret paper is safe from a foreign service only while that service is half blind in every capital that signed it.
  for (const t of w.treaties) {
    if (!t.active || !t.secret) continue;
    for (const o of cs) {
      if (t.parties.includes(o.id) || (t.known ||= []).includes(o.id) || Math.max(...t.parties.map(p => o.intel?.[p] ?? 0)) < 60) continue;
      t.known.push(o.id);
      for (const ch of [w.characters[o.leader], w.characters[o.general]]) say(w, ch, 'Intelligence', `Our service has come by a paper its owners keep secret: ${t.parties.map(id => w.countries[id]?.name).join(', ')} are bound by ${kindWord(t)} (${t.id}), signed in ${quarterLabel(t.since ?? t.turn)}${t.terms ? `: "${t.terms}"` : ''}. It is not public. It can be kept as knowledge, or made public (publish_treaty).`);
    }
  }
  // A conference sits for the quarter after it was called. Then the world counts who came.
  for (const cf of w.conferences ||= []) {
    if (!cf.open || w.turn <= cf.turn) continue; cf.open = false; cf.closed = w.turn;
    const host = w.countries[cf.host], came = cf.came.map(id => w.countries[id]).filter(o => o?.alive), away = cf.invited.filter(id => !cf.came.includes(id)).map(id => w.countries[id]).filter(o => o?.alive); if (!host?.alive) continue;
    news(w, `The conference called by ${host.name} on "${cf.question}" has risen. ${came.length ? `At the table: ${[host, ...came].map(o => o.name).join(', ')}.` : 'Nobody came.'}${away.length ? ` Stayed away: ${away.map(o => o.name).join(', ')}.` : ''}${(cf.treaties || []).some(id => w.treaties.some(t => t.id === id && t.active)) ? ' A treaty came out of it.' : came.length ? ' Nothing was signed there.' : ''}`, { kind: 'diplomacy', countries: [host.id, ...cf.invited] });
    // To call the powers together and sit alone is to be shown one's weight. Those who came have at least talked; those who stayed away are remembered for it.
    if (!came.length) { shame(w, host, -2, 'it called a conference to which nobody came'); host.legitimacy = clamp(host.legitimacy - 1, 0, 100); }
    for (const o of came) { o.relations[host.id] = clamp((o.relations[host.id] ?? 0) + 4, -100, 100); host.relations[o.id] = clamp((host.relations[o.id] ?? 0) + 4, -100, 100); }
    for (const o of away) host.relations[o.id] = clamp((host.relations[o.id] ?? 0) - 6, -100, 100);
  }
  w.conferences = w.conferences.filter(cf => cf.open || w.turn - cf.turn <= 40);
  // A war that goes on after what it was declared for is in hand wearies the country faster: nobody at home can say any longer what it is for.
  for (const war of w.wars) {
    if (!war.active || !war.aims) continue;
    for (const [id, aim] of Object.entries(war.aims)) {
      const c = w.countries[id], foe = w.countries[aim.against]; if (!c?.alive) continue;
      if (!aimsHeld(w, c, aim, foe)) { aim.heldSince = null; continue; }
      c.warExhaustion = clamp((c.warExhaustion || 0) + 1.2, 0, 100);
      if (aim.heldSince == null) { aim.heldSince = w.turn; say(w, w.characters[c.leader], 'The capital', `What the war with ${foe?.name ?? 'the enemy'} was declared for (${aimsText(w, aim)}) is in our hands. The country now expects a peace that keeps it; every further quarter of war wearies it faster than before.`); }
    }
  }
  // A new state nobody recognises is a rising with a flag; each government that receives its envoys makes it more of a state at home too, and
  // each such recognition is taken from the standing of the mother country for as long as it is still fighting to get the land back.
  for (const c of cs) {
    if (!c.recognition) continue; const mother = w.countries[c.bornOf];
    if (!mother?.alive) { c.recognition = null; continue; }
    const n = c.recognition.filter(id => w.countries[id]?.alive && id !== mother.id).length;
    c.mods.push({ key: 'legitimacy', delta: n ? Math.min(.6, n * .2) : -.4, turns: 1, label: n ? 'Recognised abroad' : 'Recognised by no one' });
    if (n && atWar(w, mother.id, c.id)) mother.mods.push({ key: 'legitimacy', delta: -Math.min(.9, n * .3), turns: 1, label: 'Its rebels recognised abroad' });
  }
  // A rival government recognised abroad takes something from the standing of the one at home, for as long as the recognition lasts.
  for (const c of cs) { const rival = rivalWeight(w, c); if (rival > 0) c.mods.push({ key: 'legitimacy', delta: -rival, turns: 1, label: 'A rival government recognised abroad' }); }
}

export const guaranteesOf = (w, id) => [...(w.guarantees || []).filter(x => x.of === id).map(x => w.countries[x.by]?.name), ...w.treaties.filter(t => t.active && t.kind === 'protection' && t.parties.includes(id) && t.protector !== id).map(t => `${w.countries[t.protector]?.name} (as its protector)`)].filter(Boolean);
export const recognisedBy = (w, ch) => (ch.recognisedBy || []).map(id => w.countries[id]).filter(o => o?.alive);
// How much standing a rival government recognised abroad takes from the one at home.
export const rivalWeight = (w, c) => clamp(sum(Object.values(w.characters).filter(ch => ch.alive && ch.country === c.id && ch.status === 'exiled'), ch => recognisedBy(w, ch).length * 1.5), 0, 6);
