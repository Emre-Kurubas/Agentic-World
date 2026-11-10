// Event ledger: records everything that happens in a turn in one format.
// Entry fields: t turn, d date, k kind, s source, n person, c countries, a person ids,
// p location, ok success, imp importance (0-3), text body, x kind-specific details.

import { TECHS } from '../engine/world.js';

const MAX_TEXT = 12000, MAX_ANSWER = 8000;
const cut = (s, n = MAX_TEXT) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export const fold = s => String(s ?? '').replace(/[İIı]/g, 'i').replace(/[Şş]/g, 's').replace(/[Ğğ]/g, 'g').replace(/[Üü]/g, 'u').replace(/[Öö]/g, 'o').replace(/[Çç]/g, 'c').replace(/[Ââ]/g, 'a').replace(/[Ûû]/g, 'u').replace(/[Îî]/g, 'i').toLowerCase();

const ROLE_LABEL = { leader: 'leader', general: 'general', opposition: 'opposition', oligarch: 'oligarch', former_leader: 'former leader' };
const POSTS = [['leader', 'Leader'], ['general', 'Chief of Staff'], ['opposition', 'Opposition leader'], ['oligarch', 'Oligarch']];
const TREATY_LABEL = { alliance: 'alliance', nonaggression: 'non-aggression', trade: 'trade', military_access: 'military access', peace: 'peace' };
const FATE = { dead: 'died', exiled: 'went into exile', retired: 'retired', imprisoned: 'was imprisoned', free: 'was released' };
const DEGREE = ['', 'mildly', 'seriously', 'gravely'];
// What a government has set: recorded whenever it moves, whoever moved it (a decree, a law, a rule-based ruler).
const policyOf = c => ({ 'income tax': c.tax?.income, 'land tax': c.tax?.land, 'business tax': c.tax?.business, tariff: c.tariff, ...Object.fromEntries(Object.entries(c.budget || {}).map(([k, v]) => [`${k} budget`, v])), 'press freedom': (c.pressFreedom ?? 0) / 100, 'court independence': (c.courts ?? 0) / 100 });
const shown = v => `${Math.round((v ?? 0) * 1000) / 10}%`;

// Once a threshold is crossed, returning needs GAP of recovery; a value hovering at the line does not flood the ledger.
const GAP = 6;
const GAUGES = [
  { key: 'unrest', read: c => c.unrest ?? 0, steps: [50, 70, 85], up: ['unrest reached dangerous levels', 'the country is boiling, unrest is very high', 'on the brink of uprising'], down: 'unrest receded', top: 2 },
  { key: 'legit', read: c => 100 - (c.legitimacy ?? 50), steps: [70, 85], up: ['the government\'s legitimacy has weakened', 'the government\'s legitimacy is nearly gone'], down: 'legitimacy recovered', top: 2 },
  { key: 'food', read: c => 100 - (c.foodRatio ?? 1) * 100, steps: [5, 25], up: ['a food shortage has begun', 'hunger is spreading'], down: 'the food shortage has passed', top: 2 },
  { key: 'input', read: c => 100 - (c.inputRatio ?? 1) * 100, steps: [60], up: ['industry is out of inputs'], down: 'the flow of inputs to industry has recovered', top: 1 }
];

function levelOf(value, steps, prev) {
  let lvl = prev;
  while (lvl < steps.length && value >= steps[lvl]) lvl++;
  while (lvl > 0 && value < steps[lvl - 1] - GAP) lvl--;
  return lvl;
}

export function snapshotState(w) {
  const countries = {}, provinces = {}, characters = {}, wars = {}, treaties = {}, plots = {}, strategic = {}, debts = {};
  for (const d of w.debts || []) debts[d.id] = d.status;
  const firms = {}; for (const f of Object.values(w.firms || {})) firms[f.id] = { owner: f.owner, status: f.status };
  const projects = {}; for (const x of w.projects || []) projects[x.id] = x.status ?? 'active';
  const contracts = {}; for (const k of w.contracts || []) contracts[k.id] = { status: k.status, breaches: k.breaches?.length ?? 0 };
  const sieges = {}, policies = {}, governors = {};
  for (const p of Object.values(w.provinces)) { if (p.siege) sieges[p.id] = p.siege.by; if (p.governor) governors[p.id] = p.governor; }
  for (const c of Object.values(w.countries)) policies[c.id] = `${c.languagePolicy}|${c.faithPolicy}`;
  for (const c of Object.values(w.countries)) countries[c.id] = { alive: c.alive, name: c.name, regime: c.regime, capital: c.capital, leader: c.leader, general: c.general, opposition: c.opposition, oligarch: c.oligarch, fxRegime: c.fxRegime, rate: c.rate, strike: !!c.strike, bankCrisis: !!c.bankCrisis, defaulted: !!c.defaulted, policy: policyOf(c), succession: c.elections ? 'election' : c.succession ?? 'open', heir: c.heir ?? null, techs: Object.keys(c.techs || {}), institutions: Object.fromEntries((c.institutions || []).filter(i => i.id).map(i => [i.id, { name: i.name, head: i.head }])), bills: Object.fromEntries((c.bills || []).map(b => [b.id, b.status])), suspended: (c.parliament?.suspendedUntil ?? 0) > w.turn };
  for (const p of Object.values(w.provinces)) provinces[p.id] = p.controller;
  for (const ch of Object.values(w.characters)) characters[ch.id] = { alive: ch.alive, status: ch.status, role: ch.role, country: ch.country, name: ch.name, health: ch.condition ? `${ch.condition.severity}${ch.condition.kind}` : '' };
  for (const x of w.wars) wars[x.id] = x.active;
  for (const t of w.treaties) treaties[t.id] = { active: !!t.active, pending: !!t.pending, breaches: t.breaches?.length ?? 0 };
  for (const p of w.plots) plots[p.id] = { active: !!p.active, exposed: !!p.exposed };
  for (const s of w.strategic) strategic[s.id] = { controller: s.controller, closed: !!s.closed, toll: s.toll || 0 };
  return { countries, provinces, characters, wars, treaties, plots, strategic, debts, firms, projects, contracts, sieges, policies, governors };
}

function stateChanges(w, was) {
  const out = [], add = (text, imp, o = {}) => out.push({ k: 'state', s: 'engine', text, imp, ...o });
  const cn = id => w.countries[id]?.name ?? was.countries[id]?.name ?? id, who = id => w.characters[id]?.name ?? was.characters[id]?.name ?? 'someone unknown';
  w.ledgerBands ||= {};

  for (const c of Object.values(w.countries)) {
    const b = was.countries[c.id], cc = [c.id];
    if (!b) { if (c.alive) add(`A new state was born: ${c.name}`, 3, { c: cc, p: c.capital }); }
    else {
      if (b.alive && !c.alive) add(`${b.name} collapsed`, 3, { c: cc, p: b.capital });
      if (!c.alive) { delete w.ledgerBands[c.id]; continue; }
      if (b.name !== c.name) add(`${b.name} changed its name to ${c.name}`, 2, { c: cc, p: c.capital });
      if (b.regime !== c.regime) add(`${c.name}: regime changed, ${b.regime} replaced by ${c.regime}`, 2, { c: cc, p: c.capital });
      if (b.capital !== c.capital) add(`${c.name}: the capital is now ${w.provinces[c.capital]?.name ?? '?'}`, 2, { c: cc, p: c.capital });
      for (const [post, label] of POSTS) if (b[post] !== c[post]) add(`${c.name}: ${label} changed, ${who(b[post])} replaced by ${who(c[post])}`, post === 'leader' ? 3 : 1, { c: cc, a: [b[post], c[post]].filter(Boolean), p: c.capital });
      if (b.fxRegime !== c.fxRegime) add(`${c.name}: ${c.currency?.name} ${c.fxRegime === 'floating' ? 'moved to a floating rate' : c.fxRegime === 'gold' ? 'was pegged to gold' : 'was pegged to another currency'}`, 2, { c: cc, p: c.capital });
      else if (c.rate > b.rate * 1.2) add(`${c.name}: ${c.currency?.name} lost ${Math.round((1 - b.rate / c.rate) * 100)}% of its value in a quarter`, 2, { c: cc, p: c.capital });
      if (!b.strike && c.strike) add(`${c.name}: a general strike began`, 1, { c: cc, p: c.capital });
      if (b.strike && !c.strike) add(`${c.name}: the general strike ended`, 0, { c: cc });
      if (!b.bankCrisis && c.bankCrisis) add(`${c.name}: a banking crisis erupted`, 2, { c: cc, p: c.capital });
      if (b.bankCrisis && !c.bankCrisis) add(`${c.name}: the banking crisis has passed`, 0, { c: cc });
      if (!b.defaulted && c.defaulted) add(`${c.name}: could not pay its debts and declared default`, 3, { c: cc, p: c.capital });
      if (b.defaulted && !c.defaulted) add(`${c.name}: lenders deal with the state again, its default is behind it`, 2, { c: cc });
      const now = policyOf(c), moved = Object.keys(now).filter(k => Math.abs((now[k] ?? 0) - (b.policy?.[k] ?? now[k] ?? 0)) >= (k.includes('freedom') || k.includes('court') ? .05 : .003));
      if (b.policy && moved.length) add(`${c.name} changed course: ${moved.map(k => `${k} ${shown(b.policy[k])} to ${shown(now[k])}`).join('; ')}`, 1, { c: cc, p: c.capital, x: { policy: Object.fromEntries(moved.map(k => [k, [b.policy[k], now[k]]])) } });
      const rule = c.elections ? 'election' : c.succession ?? 'open';
      if (b.succession && b.succession !== rule) add(`${c.name}: the rule of succession changed from ${b.succession} to ${rule}`, 2, { c: cc, p: c.capital });
      if ((b.heir ?? null) !== (c.heir ?? null)) add(c.heir ? `${c.name}: ${who(c.heir)} is now the named successor` : `${c.name}: there is no named successor any more`, 2, { c: cc, a: [c.heir, b.heir].filter(Boolean), x: { secret: !!c._heirSecret } });
      for (const i of (c.institutions || []).filter(x => x.id)) {
        const was2 = b.institutions[i.id];
        if (!was2) add(`${c.name}: new institution, ${i.name}${i.head ? ` (head ${who(i.head)})` : ''}`, 1, { c: cc, a: [i.head].filter(Boolean), x: { description: i.description, powers: i.powers, authority: i.authority, veto: i.veto } });
        else if (was2.head !== i.head && i.head) add(`${i.name}: new head ${who(i.head)}`, 1, { c: cc, a: [i.head] });
      }
      for (const [id, inst] of Object.entries(b.institutions)) if (!(c.institutions || []).some(i => i.id === id)) add(`${c.name}: ${inst.name} was dissolved`, 1, { c: cc });
      for (const bill of c.bills || []) {
        const prev = b.bills[bill.id];
        if (!prev) add(`${c.name}: new bill in parliament, ${bill.title} (${bill.proposerName})`, 1, { c: cc, a: [bill.proposer], x: { text: bill.text } });
        else if (prev !== bill.status && bill.status !== 'pending') add(`${c.name} parliament: ${bill.title} ${{ passed: 'passed', rejected: 'was rejected', lapsed: 'lapsed' }[bill.status] ?? bill.status}${bill.tally ? ` (${bill.tally.yes} yes, ${bill.tally.no} no)` : ''}`, bill.byGov || bill.status === 'passed' ? 2 : 1, { c: cc, a: [bill.proposer], x: { text: bill.text } });
      }
      const nowSuspended = (c.parliament?.suspendedUntil ?? 0) > w.turn;
      if (!b.suspended && nowSuspended) add(`${c.name}: parliament was suspended`, 3, { c: cc, p: c.capital });
      if (b.suspended && !nowSuspended && c.parliament) add(`${c.name}: parliament reopened`, 1, { c: cc });
      for (const t of Object.keys(c.techs || {})) if (!b.techs.includes(t)) add(`${c.name}: new technology, ${TECHS[t]?.name ?? t}`, 1, { c: cc });
    }
    if (!c.alive) continue;
    const bands = w.ledgerBands[c.id] ||= {};
    for (const g of GAUGES) {
      const prev = bands[g.key] ?? 0, lvl = levelOf(g.read(c), g.steps, prev);
      if (lvl === prev) continue;
      bands[g.key] = lvl;
      if (lvl > prev) add(`${c.name}: ${g.up[lvl - 1]}`, lvl >= g.top ? 2 : 1, { c: [c.id], p: c.capital });
      else if (lvl === 0) add(`${c.name}: ${g.down}`, 0, { c: [c.id] });
    }
  }

  for (const p of Object.values(w.provinces)) {
    const from = was.provinces[p.id];
    if (from === undefined || from === p.controller) continue;
    const capital = w.countries[from]?.capital === p.id;
    add(`${p.name} passed to the control of ${cn(p.controller)} (previously: ${cn(from)})`, capital ? 3 : 1, { c: [p.controller, from], p: p.id });
  }

  for (const ch of Object.values(w.characters)) {
    const b = was.characters[ch.id], label = `${ch.name} (${ROLE_LABEL[ch.role] ?? ch.role}, ${cn(ch.country)})`;
    if (!b) { add(`A new figure appeared: ${label}`, 0, { c: [ch.country], a: [ch.id] }); continue; }
    if (b.alive && !ch.alive) add(`${label} ${ch.status === 'dead' ? ch.death?.how ?? 'died' : FATE[ch.status] ?? 'left the stage'}${ch.status === 'dead' ? `, aged ${ch.age}` : ''}`, b.role === 'leader' ? 2 : 1, { c: [ch.country], a: [ch.id], x: { death: ch.death ?? null } });
    else if (b.status !== ch.status) add(`${label} ${FATE[ch.status] ?? `status: ${ch.status}`}`, 1, { c: [ch.country], a: [ch.id] });
    // Everyone's body is on the record, also when the palace keeps it out of the papers.
    const health = ch.condition ? `${ch.condition.severity}${ch.condition.kind}` : '';
    if (ch.alive && (b.health ?? '') !== health) add(ch.condition ? `${label} is ${DEGREE[ch.condition.severity] ?? ''} ${ch.condition.kind === 'wound' ? 'wounded' : 'ill'}${ch.condition.cause ? ` (${ch.condition.cause})` : ''}` : `${label} has recovered`, ch.condition?.severity >= 3 && b.role === 'leader' ? 2 : ch.condition?.severity >= 2 ? 1 : 0, { c: [ch.country], a: [ch.id], x: { health: ch.condition ?? null } });
    if (b.role !== ch.role) add(`${ch.name} is now ${ROLE_LABEL[ch.role] ?? ch.role} (previously ${ROLE_LABEL[b.role] ?? b.role})`, 0, { c: [ch.country], a: [ch.id] });
    if (b.country !== ch.country) add(`${ch.name} moved from ${cn(b.country)} to ${cn(ch.country)}`, 1, { c: [b.country, ch.country], a: [ch.id] });
  }

  for (const x of w.wars) {
    const parties = [...x.a, ...x.b];
    if (!(x.id in was.wars) && x.active) add(`War began: ${x.name}`, 3, { c: parties });
    else if (was.wars[x.id] && !x.active) add(`War ended: ${x.name}`, 3, { c: parties });
  }
  for (const t of w.treaties) {
    const b = was.treaties[t.id], label = `${TREATY_LABEL[t.kind] ?? t.kind} (${t.parties.map(cn).join(', ')})`;
    if (b && (t.breaches?.length ?? 0) > b.breaches) add(t.breaches.at(-1).text, 2, { c: t.parties });
    if (!b?.active && t.active) add(`Treaty took effect: ${label}${t.clauses?.length ? `. ${t.clauses.map(x => x.text).join('; ')}` : ''}`, 2, { c: t.parties, x: { terms: cut(t.terms ?? '', 400) } });
    else if (b?.active && !t.active) add(`Treaty ended: ${label}`, 2, { c: t.parties });
    else if (!b && t.pending) add(`Treaty proposed: ${label}`, 1, { c: t.parties, x: { terms: cut(t.terms ?? '', 400) } });
  }
  for (const pl of w.plots) {
    const b = was.plots[pl.id], people = [pl.leader, ...(pl.members || [])], label = `${pl.kind} plot, ${who(pl.leader)}, ${cn(pl.country)}`;
    if (!b && pl.active) add(`Secret ${label} formed`, 0, { c: [pl.country], a: people, x: { secret: true } });
    if (b && !b.exposed && pl.exposed) add(`Exposed: ${label}`, 2, { c: [pl.country], a: people });
    if (b?.active && !pl.active) add(`Ended: ${label}`, 1, { c: [pl.country], a: people });
  }
  for (const x of w.projects || []) {
    const prev = was.projects?.[x.id], name = `${x.label ?? x.kind} at ${w.provinces[x.province]?.name}`;
    if (!prev) add(`${cn(x.country)} began work: ${name} (${x.turns} quarters)`, ['fort', 'canal', 'battery', 'ship'].includes(x.kind) ? 1 : 0, { c: [x.country], p: x.province, x: { kind: x.kind } });
    else if (prev === 'active' && x.status === 'done') add(`${cn(x.country)} completed: ${name}`, ['fort', 'canal', 'battery', 'ship'].includes(x.kind) ? 1 : 0, { c: [x.country], p: x.province, x: { kind: x.kind } });
    else if (prev === 'active' && x.status === 'lost') add(`${cn(x.country)} lost work in progress: ${name}`, 1, { c: [x.country], p: x.province });
  }
  for (const k of w.contracts || []) {
    const b = was.contracts?.[k.id], people = [k.a, k.b];
    if (!b) add(`Contract offered between ${who(k.a)} and ${who(k.b)}: ${k.terms}`, 0, { a: people, x: { secret: true } });
    else if (b.status !== k.status) add(`Contract between ${who(k.a)} and ${who(k.b)}: ${k.status}`, 0, { a: people, x: { secret: true } });
    else if ((k.breaches?.length ?? 0) > b.breaches) add(`Contract breached: ${k.breaches.at(-1).text}`, 1, { a: people, x: { secret: true } });
  }
  for (const p of Object.values(w.provinces)) {
    if (p.siege && !was.sieges?.[p.id]) add(`Siege of ${p.name} began`, 2, { c: [p.siege.by, p.controller], p: p.id });
    if (p.governor && was.governors?.[p.id] !== p.governor) add(`${who(p.governor)} became governor of ${p.name}`, 1, { c: [p.controller], a: [p.governor], p: p.id });
  }
  for (const c of Object.values(w.countries)) if (c.alive && was.policies?.[c.id] && was.policies[c.id] !== `${c.languagePolicy}|${c.faithPolicy}`) add(`${c.name} changed its policy: language ${c.languagePolicy}, faith ${c.faithPolicy}`, 2, { c: [c.id], p: c.capital });
  const ownerLabel = o => o === 'state' ? 'state' : o ? who(o) : 'publicly held';
  for (const f of Object.values(w.firms || {})) {
    const b = was.firms?.[f.id], people = [f.owner, b?.owner].filter(o => o && o !== 'state');
    if (!b) add(`New company: ${f.name} (${cn(f.country)}), owner ${ownerLabel(f.owner)}`, 1, { c: [f.country], a: people, p: f.province });
    else if (b.status === 'open' && f.status === 'bankrupt') add(`${f.name} went bankrupt (${cn(f.country)})`, 2, { c: [f.country], a: people, p: f.province });
    else if (b.owner !== f.owner) add(`${f.name} changed hands: ${ownerLabel(f.owner)} replaced ${ownerLabel(b.owner)}`, f.owner === 'state' ? 2 : 1, { c: [f.country], a: people, p: f.province });
  }
  const DEBT_LABEL = { overdue: 'not paid on time', paid: 'paid', forgiven: 'forgiven', void: 'void because one of the parties died' };
  for (const d of w.debts || []) {
    const prev = was.debts[d.id], people = [d.creditor, d.debtor], label = `${who(d.debtor)} debt, creditor ${who(d.creditor)}, ${Math.round(d.amount)}`, c = [w.characters[d.debtor]?.country].filter(Boolean);
    if (!prev) add(`New debt: ${label}`, 0, { c, a: people, x: { secret: true, terms: d.terms } });
    else if (prev !== d.status) add(`${label}: ${DEBT_LABEL[d.status] ?? d.status}`, 0, { c, a: people, x: { secret: true } });
  }
  for (const s of w.strategic) {
    const b = was.strategic[s.id], ref = s.ref;
    if (!b) continue;
    if (b.controller && b.controller !== s.controller) add(`${s.name} is now under the control of ${cn(s.controller)} (previously: ${cn(b.controller)})`, 2, { c: [s.controller, b.controller].filter(Boolean), p: ref });
    if (b.closed !== !!s.closed) add(`${s.name} ${s.closed ? 'was closed' : 'reopened'}`, 2, { c: [s.controller].filter(Boolean), p: ref });
    if (b.toll !== (s.toll || 0)) add(`${s.name}: toll is now ${Math.round((s.toll || 0) * 100)}%`, 1, { c: [s.controller].filter(Boolean), p: ref });
  }
  return out;
}

const NEWS_IMP = { atrocity: 3, plot: 2, disaster: 1, war: 1 };

export function buildEntries(w, log, before, lookups = {}) {
  const out = [];
  for (const x of log.trace || []) {
    out.push({ k: 'thought', s: x.ai ? 'agent' : 'rule', n: x.name, r: x.role, c: [x.country], a: [x.actor], imp: 0, text: cut(x.monologue), x: { persona: cut(x.persona, 6000), publicFace: x.publicFace || '', decisions: x.decisions || [], lookups: x.lookups || [], ai: x.ai, model: x.model ?? null, standing: x.standing ?? null, health: x.health ?? null, notes: x.notes || '' } });
    for (const q of lookups[x.actor] || []) out.push({ k: 'query', s: 'agent', n: x.name, r: x.role, c: [x.country], a: [x.actor], imp: 0, q: q.q, text: cut(q.a, MAX_ANSWER) });
  }
  for (const m of log.messages || []) out.push({ k: 'message', s: 'agent', n: m.fromName, to: m.toName, c: [m.fromCountry, m.toCountry].filter(Boolean), a: [m.from, m.toActor].filter(Boolean), imp: 0, ok: !m.undelivered, text: cut(m.text), x: { read: !!m.read, round: m.round ?? 0, intercepted: !!m.intercepted, readBy: m.readBy ?? [], ...(m.npc ? { npc: true } : {}), secret: true } });
  // What the world itself told people this quarter: reports, warnings, notices, offers. A letter between characters is a message, not a notice.
  for (const ch of Object.values(w.characters)) for (const m of ch.inbox || []) if (m.turn === w.turn - 1 && !m.letter && !m.logged) { m.logged = true; out.push({ k: 'notice', s: 'engine', n: ch.name, r: ch.role, c: [ch.country], a: [ch.id], imp: 0, text: cut(`[${m.from}] ${m.text}`, 3000), x: { from: m.from, secret: true } }); }
  for (const r of log.rulings || []) {
    const failed = (r.results || []).filter(y => y.ok === false), ok = !!r.success && !failed.length, detail = (r.results || []).map(y => y.msg).filter(Boolean).join('; ');
    out.push({ k: r.source === 'referee' ? 'ruling' : 'rule', s: r.source, n: r.name, r: r.role, c: [r.country], a: [r.actor], imp: 0, ok, text: cut(r.source === 'referee' ? r.narrative : `${r.narrative}${detail ? `: ${detail}` : ''}`), x: { narrative: cut(r.narrative, 1500), probability: r.probability, success: r.success, results: r.results || [], ops: r.ops || [], decision: r.decision, decisionText: r.decisionText ?? '' } });
  }
  for (const b of w.battles || []) out.push({ k: 'battle', s: 'engine', c: [b.attacker, b.defender], p: b.province, imp: 1, text: `${b.manner === 'probe' ? `Reconnaissance in force at ${w.provinces[b.province]?.name ?? b.province}: ${w.countries[b.attacker]?.name} felt out the defences and drew off.` : `Battle of ${w.provinces[b.province]?.name ?? b.province}: ${w.countries[b.attackerWon ? b.attacker : b.defender]?.name} prevailed.`} Losses: attacker ${b.lossA}k, defender ${b.lossD}k.${b.manner === 'all_out' ? ' The attack was pressed regardless of loss.' : ''}${b.sides ? ` The attack came from ${b.sides} sides.` : ''}${b.shelled != null ? ` A bombardment knocked in about ${b.shelled}% of the field works${b.breached != null ? ` and ${b.breached}% of the fortress` : ''}.` : ''}${b.why?.length ? ` Decided by: ${b.why.join(', ')}.` : ''}`, x: { ...b } });
  for (const b of w.seaFights || []) out.push({ k: 'battle', s: 'engine', c: [b.winner, b.loser], imp: 1, text: `Naval battle in ${w.seas[b.sea]?.name || b.sea}: ${w.countries[b.winner]?.name} prevailed over ${w.countries[b.loser]?.name}. Sunk: ${b.sunk?.[0] ?? 0} of the victor's ships and ${b.sunk?.[1] ?? 0} of the beaten side's; disabled and brought home: ${b.disabled?.[0] ?? 0} and ${b.disabled?.[1] ?? 0}.`, x: { ...b } });
  for (const y of log.system || []) out.push({ k: 'system', s: 'engine', c: [], n: y.name, imp: 0, text: cut(y.text, 3000) });
  for (const n of w.newsThisTurn || []) out.push({ k: 'news', s: 'engine', c: n.countries || [], ...(n.province ? { p: n.province } : {}), ...(n.people?.length ? { a: n.people } : {}), imp: n.secret ? 0 : NEWS_IMP[n.kind] ?? 0, text: cut(n.text), x: { kind: n.kind, secret: !!n.secret, ...(n.hush ? { hush: true } : {}) } });
  if (before) out.push(...stateChanges(w, before));
  const t = w.turn, d = w.date || 'Start';
  return out.map((e, i) => ({ id: `${t}-${i}`, t, i, d, ...e }));
}

// Old turn views (Minds, Correspondence, Referee) are rebuilt from the ledger.
export function logFromEntries(entries) {
  const log = { trace: [], rulings: [], messages: [] };
  for (const e of entries) {
    if (e.k === 'thought') log.trace.push({ actor: e.a[0], country: e.c[0], role: e.r, name: e.n, ai: e.x.ai, model: e.x.model, standing: e.x.standing, persona: e.x.persona, lookups: e.x.lookups, monologue: e.text, decisions: e.x.decisions, messages: [] });
    else if (e.k === 'ruling' || e.k === 'rule') log.rulings.push({ actor: e.a[0], name: e.n, country: e.c[0], role: e.r, narrative: e.x.narrative, probability: e.x.probability, success: e.x.success, results: e.x.results, source: e.s, decision: e.x.decision });
    else if (e.k === 'message') log.messages.push({ from: e.a[0], fromName: e.n, fromCountry: e.c[0], toName: e.to, text: e.text, undelivered: e.ok === false, read: !!e.x?.read, round: e.x?.round ?? 0 });
  }
  return log;
}

export function entryHaystack(e) {
  const x = e.x || {};
  return fold([e.d, e.n, e.to, e.q, e.text, x.persona, x.decisionText, x.notes, x.terms, ...(x.decisions || []), ...(x.lookups || []), ...(x.results || []).map(y => `${y.op} ${y.msg}`)].filter(Boolean).join(' '));
}

export function matches(e, f) {
  if (f.turn != null && e.t !== f.turn) return false;
  if (f.from != null && e.t < f.from) return false;
  if (f.to != null && e.t > f.to) return false;
  if (f.kinds && !f.kinds.includes(e.k)) return false;
  if (f.country && !(e.c || []).includes(f.country)) return false;
  if (f.character && !(e.a || []).includes(f.character)) return false;
  if (f.source && e.s !== f.source) return false;
  if (f.ok != null && (e.ok ?? true) !== f.ok) return false;
  if (f.imp && (e.imp ?? 0) < f.imp) return false;
  if (f.words?.length) { const h = entryHaystack(e); if (!f.words.every(q => h.includes(q))) return false; }
  return true;
}
