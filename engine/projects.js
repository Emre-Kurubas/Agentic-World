// Nothing is built instantly. Orders are paid when given and finish after a realistic number of quarters.
import { clamp, news, nextId } from './util.js';
import { PLANTS, GOOD_LABEL, makeUnit, makeFleet } from './world.js';
import { restake } from './firms.js';

const TURNS = { mine: 3, railway: 4, port: 4, dam: 6, farming: 2, infrastructure: 2, fort: 5, battery: 4, trench: 2, administration: 3, unit: 1, ship: 3, canal: 12 };
const UNIT_TURNS = { infantry: 1, artillery: 2, armor: 2, air: 3 }, SHIP_TURNS = { cruiser: 3, battleship: 6, submarine: 3 };
export const DEFENSES = ['fort', 'battery', 'trench'];
export const MAX_DEFENSE = { fort: 3, battery: 3, trench: 2 };

export function durationOf(kind, detail) {
  if (Object.hasOwn(PLANTS, kind)) return 4;
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
  // New works belong to whoever paid for them: a company's own extension to the company, the state's building to no company.
  if (Object.hasOwn(PLANTS, k)) { const old = p.plants[k], next = Math.min(8, old + (x.add ?? x.share * 18)); p.plants[k] = next; restake(w, p.id, k, null, old, next, x.firm); }
  else if (k === 'mine') { const d = p.deposits[x.resource]; if (d) { const old = d.mine, next = Math.min(4, old + (x.add ?? x.share * 14)); d.mine = next; restake(w, p.id, 'mine', x.resource, old, next, x.firm); } }
  else if (k === 'railway') p.rail = Math.min(2, p.rail + 1);
  else if (k === 'port') p.port = Math.min(3, p.port + 1);
  else if (k === 'dam') { p.dam = true; news(w, `${c.name} completed a dam on the ${p.name} river; water is falling downstream.`, { kind: 'diplomacy', countries: [c.id] }); }
  // Drainage, terraces and wells can make land yield about half as much again as nature gave it, not without end.
  else if (k === 'farming') { p.fertileMax ??= p.fertility * 1.5; p.fertility = Math.max(p.fertility, Math.min(p.fertileMax, p.fertility + x.share * 1.2)); }
  else if (k === 'infrastructure') p.infra += x.share * 1.3;
  else if (k === 'administration') p.admin = clamp((p.admin ?? .5) + x.share * 2.5, 0, 1);
  else if (k === 'fort' || k === 'battery' || k === 'trench') p[k] = Math.min(MAX_DEFENSE[k], (p[k] || 0) + 1);
  else if (k === 'unit') makeUnit(w, c.id, p.id, x.men, .8, 60 + c.legitimacy * .3, x.unitKind);
  else if (k === 'ship') { const f = makeFleet(w, c.id, p.seas[0], x.ships); f.kind = x.shipKind; }
  else if (k === 'canal') { w.canals.push({ province: p.id, a: p.seas[0], b: p.seas[p.seas.length - 1], owner: c.id }); const s = w.strategic.find(y => y.id === x.strategic); if (s) s.type = 'canal'; news(w, `${c.name} opened the ${p.name} canal; the sea lanes have changed.`, { kind: 'economy', countries: [c.id] }); }
}

export function projectStep(w) {
  for (const x of w.projects ||= []) {
    if (x.status) continue;
    const c = w.countries[x.country], p = w.provinces[x.province];
    if (!c?.alive || p?.controller !== c.id) { x.status = 'lost'; x.closedAt = w.turn; if (c?.alive) news(w, `${c.name} lost the ${x.label ?? x.kind} under construction at ${p?.name}.`, { kind: 'war', countries: [c.id] }); continue; }
    if (--x.turnsLeft <= 0) { finish(w, c, x); x.status = 'done'; x.closedAt = w.turn; }
  }
  w.projects = w.projects.filter(x => !x.status || w.turn - x.closedAt <= 8);
}

export const projectLabel = x => x.label ?? (PLANTS[x.kind] || (x.kind === 'mine' ? `${GOOD_LABEL[x.resource]} mine` : x.kind));
