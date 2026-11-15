// The annals of the game years, and what a predecessor leaves in a seat.
// The user, 2026-11-15, asked whether a character who comes after one who died knows what the other did in the game: he did not. A country's
// chronicle was written once, when the world was made, and stopped at its first day; whatever was fought, signed, won or lost after it lived only
// in the memories of the people who did it, and those die (health.js, a mind that fills). Now the open events of every quarter go into the
// chronicle of each country they touch, and whoever takes a seat finds on the desk what the one before left there: how long they held it and how
// it ended, the orders they left waiting, and with whom they kept up a correspondence. What passed between them in the letters is not written
// down anywhere; a successor learns that, if at all, from the people themselves. Only events are written, never feelings (chronicle.js).
import { aliveCountries, ROLES } from './world.js';
import { quarterLabel } from './util.js';
import { he, him, his } from './names.js';

const KEEP = 150;
const yearOf = t => 1900 + Math.floor(t / 4);
const SEAT = { leader: 'the head of the state', general: 'chief of the general staff', opposition: 'leader of the opposition', oligarch: 'the foremost magnate of the country' };
const nm = (w, id) => w.countries[id]?.name ?? id;
const list = xs => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
const sentence = t => String(t || '').split(/(?<=[a-z0-9)])[.;:](?:\s|$)/i)[0].trim();
const lower = t => t.replace(/^(The|A|An|Our|Its|Their)\b/, m => m.toLowerCase());

export function annalsBegin(w) {
  const seats = {}, owners = {};
  for (const c of aliveCountries(w)) seats[c.id] = Object.fromEntries(ROLES.map(r => [r, c[r] ?? null]));
  for (const p of Object.values(w.provinces)) owners[p.id] = p.owner ?? null;
  w._annals = { turn: w.turn, seats, owners, wars: (w.wars || []).filter(x => x.active).map(x => x.id), treaties: (w.treaties || []).filter(t => t.active && !t.pending).map(t => t.id), alive: aliveCountries(w).map(c => c.id) };
}

function write(w, ids, text) {
  for (const id of new Set(ids)) { const c = w.countries[id]; if (!c) continue;
    (c.chronicle ||= []).push({ year: yearOf(w.turn), t: w.turn, text: `${quarterLabel(w.turn)}: ${text}` });
    if (c.chronicle.length > KEEP) c.chronicle.splice(0, c.chronicle.length - KEEP); }
}

function fateOf(w, c, ch) {
  if (!ch) return 'left the seat';
  if (!ch.alive) return ch.death?.how ?? 'died';
  if (ch.status === 'imprisoned') return 'was imprisoned';
  if (ch.status === 'exiled') return 'went into exile';
  if (ch.retired) return 'withdrew from public life';
  if (c.lastElection === w.turn && c.opposition === ch.id) return 'lost the election';
  const now = ROLES.find(r => c[r] === ch.id);
  return now ? `left it to become ${SEAT[now]}` : 'lost the seat';
}

// What the one who held a seat leaves to whoever takes it, written the quarter the seat changes hands.
export function deskLeft(w, c, role, prev, next, since) {
  const lines = [`${prev.name} held the seat from ${quarterLabel(since ?? 0)} to ${quarterLabel(w.turn)}, and ${fateOf(w, c, prev)}.`];
  // An order of someone who is dead or in a cell lapses the day the quarter opens (standing.js), before the seat is found to have changed hands.
  const orders = [...(w.standingOrders || []), ...(w.lapsedOrders || []).filter(x => x.lapsed >= w.turn - 1)].filter(so => so.by === prev.id && so.country === c.id);
  if (orders.length) lines.push(`Orders ${he(prev)} left waiting for their day, which lapse with ${him(prev)} unless you give them again yourself: ${orders.map(so => `${so.id}${so.label ? ` ("${so.label}")` : ''}, ${so.words}: ${so.then.map(o => o.op).join(', ')}`).join('; ')}.`);
  const bills = (c.bills || []).filter(b => b.proposer === prev.id && b.status === 'pending');
  if (bills.length) lines.push(`Bills ${he(prev)} laid before the house that are still to be voted: ${bills.map(b => `${b.id}${b.title ? ` (${b.title})` : ''}`).join(', ')}.`);
  const pen = Object.entries(prev.pen || {}).map(([id, x]) => [w.characters[id], x]).filter(([x]) => x && x.id !== next.id).sort((a, b) => b[1].n - a[1].n).slice(0, 8);
  if (pen.length) lines.push(`Whom ${he(prev)} wrote to and heard from most, by the letter-book of the office (what passed between them the book does not say): ${pen.map(([x, k]) => { const xc = w.countries[x.country], seat = ROLES.find(r => xc?.[r] === x.id); return `${x.name} (${x.id}${seat ? `, ${SEAT[seat]}` : ''}${xc ? ` of ${xc.name}` : ''}${x.alive ? '' : ', dead'}), ${k.n} letter${k.n === 1 ? '' : 's'}, the last in ${quarterLabel(k.last)}`; }).join('; ')}.`);
  else lines.push(`The letter-book shows no correspondence of ${his(prev)}.`);
  return `What ${prev.name} left in this seat, as you find it on taking it:\n${lines.map(x => `- ${x}`).join('\n')}`;
}

export function annalsStep(w) {
  const was = w._annals; if (!was || was.turn !== w.turn) return;
  // Wars that began and ended.
  for (const x of (w.wars || []).filter(x => x.active && !was.wars.includes(x.id))) {
    if (x.civil) { write(w, [...x.a, ...x.b], `A civil war broke out: ${x.name}.`); continue; }
    const aim = Object.values(x.aims || {})[0]?.text;
    write(w, [...x.a, ...x.b], `${list(x.a.map(id => nm(w, id)))} went to war with ${list(x.b.map(id => nm(w, id)))}${aim ? `, for ${lower(sentence(aim))}` : ''}.`);
  }
  for (const x of (w.wars || []).filter(x => !x.active && was.wars.includes(x.id))) write(w, [...x.a, ...x.b], `The war between ${list(x.a.map(id => nm(w, id)))} and ${list(x.b.map(id => nm(w, id)))} ended.`);
  // Papers that came into force in the open.
  for (const t of (w.treaties || []).filter(t => t.active && !t.pending && !t.secret && !was.treaties.includes(t.id))) {
    const words = sentence(t.terms);
    write(w, t.parties, `A treaty (${String(t.kind).replace(/_/g, ' ')}) between ${list(t.parties.map(id => nm(w, id)))} came into force${words ? `: ${words}` : ''}.`);
  }
  // Land that changed sovereignty.
  const moved = {};
  for (const p of Object.values(w.provinces)) { const from = was.owners[p.id]; if (from && p.owner && from !== p.owner) (moved[`${from}>${p.owner}`] ||= []).push(`${p.name} (${p.id})`); }
  for (const [k, ps] of Object.entries(moved)) { const [from, to] = k.split('>'); write(w, [from, to], `${list(ps)} passed from ${nm(w, from)} to ${nm(w, to)}.`); }
  // States born of a country, and states that ceased to be.
  for (const c of Object.values(w.countries)) {
    if (c.alive && !was.alive.includes(c.id) && c.bornOf) write(w, [c.bornOf, c.id], `${c.name} broke away from ${nm(w, c.bornOf)}.`);
    if (!c.alive && was.alive.includes(c.id)) write(w, [c.id, ...aliveCountries(w).filter(o => (w.wars || []).some(x => [...x.a, ...x.b].includes(c.id) && [...x.a, ...x.b].includes(o.id))).map(o => o.id)], `${c.name} ceased to exist as a state.`);
  }
  // Elections, as the papers printed them.
  for (const c of aliveCountries(w)) if (c.lastElection === w.turn) for (const n of (w.newsThisTurn || []).filter(n => n.text?.startsWith(`${c.name} election: `))) write(w, [c.id], `Election: ${n.text.slice(c.name.length + 11)}`);
  // Seats that changed hands, and the desk the old holder leaves to the new.
  for (const c of aliveCountries(w)) {
    const before = was.seats[c.id]; if (!before) continue;
    for (const r of ROLES) {
      const old = before[r], now = c[r]; if (!old || !now || old === now) continue;
      const prev = w.characters[old], next = w.characters[now]; if (!next) continue;
      const since = c.seatFrom?.[r] ?? 0;
      (c.seatFrom ||= {})[r] = w.turn;
      if (r === 'leader' || r === 'general') write(w, [c.id], `${prev?.name ?? 'The former holder'} ${fateOf(w, c, prev)}; ${next.name} became ${SEAT[r]}.`);
      if (prev && next.alive) next.inbox.push({ turn: w.turn, from: 'The office', text: deskLeft(w, c, r, prev, next, since) });
    }
  }
}

// The letter-book: who wrote to whom, how often and when last. Kept on both sides; the content is not kept.
export function noteLetter(w, from, to) {
  if (!from || !to || from.id === to.id) return;
  for (const [a, b] of [[from, to], [to, from]]) {
    const k = (a.pen ||= {})[b.id] ||= { n: 0, last: w.turn }; k.n++; k.last = w.turn;
    const ids = Object.keys(a.pen); if (ids.length > 30) { const low = ids.sort((x, y) => a.pen[x].n - a.pen[y].n || a.pen[x].last - a.pen[y].last)[0]; delete a.pen[low]; }
  }
}
