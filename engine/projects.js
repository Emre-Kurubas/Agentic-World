// Nothing is built instantly. Orders are paid when given and finish after a realistic number of quarters.
import { clamp, news, nextId } from './util.js';
import { PLANTS, GOOD_TR, makeUnit, makeFleet } from './world.js';

const TURNS = { maden: 3, demiryolu: 4, liman: 4, baraj: 6, tarim: 2, altyapi: 2, fort: 5, battery: 4, trench: 2, administration: 3, unit: 1, ship: 3, canal: 12 };
const UNIT_TURNS = { piyade: 1, topcu: 2, zirhli: 2, hava: 3 }, SHIP_TURNS = { cruiser: 3, battleship: 6, submarine: 3 };
export const DEFENSES = ['fort', 'battery', 'trench'];
export const MAX_DEFENSE = { fort: 3, battery: 3, trench: 2 };

export function durationOf(kind, detail) {
  if (PLANTS[kind]) return 4;
  if (kind === 'unit') return UNIT_TURNS[detail] ?? 1;
  if (kind === 'ship') return SHIP_TURNS[detail] ?? 3;
  return TURNS[kind] ?? 3;
}

export function queueProject(w, c, spec) {
  const turns = durationOf(spec.kind, spec.unitKind ?? spec.shipKind);
  const p = { id: nextId(w, 'PR'), country: c.id, turnsLeft: turns, turns, started: w.turn, ...spec };
  (w.projects ||= []).push(p);
  return p;
}

function finish(w, c, x) {
  const p = w.provinces[x.province], k = x.kind;
  if (PLANTS[k]) p.plants[k] = Math.min(8, p.plants[k] + x.share * 18);
  else if (k === 'maden') { const d = p.deposits[x.resource]; if (d) d.mine = Math.min(4, d.mine + x.share * 14); }
  else if (k === 'demiryolu') p.rail = Math.min(2, p.rail + 1);
  else if (k === 'liman') p.port = Math.min(3, p.port + 1);
  else if (k === 'baraj') { p.dam = true; news(w, `${c.name} completed a dam on the ${p.name} river; water is falling downstream.`, { kind: 'diplomasi', countries: [c.id] }); }
  else if (k === 'tarim') p.fertility += x.share * 1.2;
  else if (k === 'altyapi') p.infra += x.share * 1.3;
  else if (k === 'administration') p.admin = clamp((p.admin ?? .5) + x.share * 2.5, 0, 1);
  else if (k === 'fort' || k === 'battery' || k === 'trench') p[k] = Math.min(MAX_DEFENSE[k], (p[k] || 0) + 1);
  else if (k === 'unit') makeUnit(w, c.id, p.id, x.men, .8, 60 + c.legitimacy * .3, x.unitKind);
  else if (k === 'ship') { const f = makeFleet(w, c.id, p.seas[0], x.ships); f.kind = x.shipKind; }
  else if (k === 'canal') { w.canals.push({ province: p.id, a: p.seas[0], b: p.seas[p.seas.length - 1], owner: c.id }); const s = w.strategic.find(y => y.id === x.strategic); if (s) s.type = 'kanal'; news(w, `${c.name} opened the ${p.name} canal; the sea lanes have changed.`, { kind: 'ekonomi', countries: [c.id] }); }
}

export function projectStep(w) {
  for (const x of w.projects ||= []) {
    if (x.status) continue;
    const c = w.countries[x.country], p = w.provinces[x.province];
    if (!c?.alive || p?.controller !== c.id) { x.status = 'lost'; x.closedAt = w.turn; if (c?.alive) news(w, `${c.name} lost the ${x.label ?? x.kind} under construction at ${p?.name}.`, { kind: 'savas', countries: [c.id] }); continue; }
    if (--x.turnsLeft <= 0) { finish(w, c, x); x.status = 'done'; x.closedAt = w.turn; }
  }
  w.projects = w.projects.filter(x => !x.status || w.turn - x.closedAt <= 8);
}

export const projectLabel = x => x.label ?? (PLANTS[x.kind] || (x.kind === 'maden' ? `${GOOD_TR[x.resource]} mine` : x.kind));
