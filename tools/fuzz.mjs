// Every order from every seat, with good and bad fields, quarter after quarter; and after each quarter the world is checked for things
// that must never be: a crash, a number that is not a number, a seat with nobody in it, people or gold out of nowhere, a text a character
// would read with "undefined" in it.
// Run from the repository:  node tools/fuzz.mjs . [quarters=16] [orders per seat=5] [world seeds] [fuzz seeds]
//   node tools/fuzz.mjs . 16 5 2696855,7593913 1,2,3
// The orders and their fields are read from the list the referee is given (agents/prompts.js), so a new order is covered as soon as it
// is written there. Each failure is printed once, with how often it came and the first order that produced it.
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
const repo = process.argv[2] || '.', root = pathToFileURL(fs.realpathSync(repo) + '/').href;
const Q = +process.argv[3] || 16, PER = +process.argv[4] || 5, WORLDS = (process.argv[5] || '2696855').split(',').map(Number), RUNS = (process.argv[6] || '1').split(',').map(Number);
const { createWorld, aliveCountries, countryProvinces, provincePop, GOODS, PLANTS, ROLES, TECHS } = await import(root + 'engine/world.js');
const { beginTurn, stepWorld } = await import(root + 'engine/step.js');
const { applyOp, carryList } = await import(root + 'engine/ops.js');
const { answer, desk } = await import(root + 'agents/queries.js');
const { actorPrompt } = await import(root + 'agents/prompts.js');
const base = { plainStates: false, countries: 8, provinces: 200, agentRoles: [], countryAgentRoles: {}, models: {}, concurrency: 2, wakeEvery: 1, wakeTension: 45, maxMessagesPerActor: 3, maxDecisionsPerActor: 5, limitRetryMinutes: 0, maxTurns: 0 };

// The orders and their fields, from the referee's list.
const doc = fs.readFileSync(new URL('agents/prompts.js', root), 'utf8'), OPS = {};
for (const m of doc.matchAll(/\b([a-z_]+)\{([^{}]*)\}/g)) { const o = OPS[m[1]] ||= {}; for (const raw of m[2].split(/,(?![^\[]*\])/)) { const f = raw.trim(), name = f.replace(/[?:|\s].*/, ''); if (!/^[a-z_]+$/.test(name)) continue; const opts = f.includes(':') ? f.split(':')[1].split('|').map(s => s.trim()).filter(s => /^[a-z_]+$/.test(s)) : []; (o[name] ||= new Set()); for (const x of opts) o[name].add(x); for (const alt of f.split(':')[0].split('|').slice(1)) { const a = alt.replace(/\?/g, '').trim(); if (/^[a-z_]+$/.test(a)) o[a] ||= new Set(); } } }
for (const k of ['custom', 'noop', 'report', 'ops', 'when', 'then']) delete OPS[k];
const NAMES = Object.keys(OPS);

function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const WORDS = ['railway', 'port', 'fort', 'trench', 'depot', 'cruiser', 'torpedo', 'merchant', 'infantry', 'cavalry', 'artillery', 'union', 'peasants', 'mutual', 'peace', 'alliance', 'nonaggression', 'trade', 'commission', 'armistice', 'workers', 'middle', 'elite', 'army', 'treasury', 'police', 'customs', 'courts', 'post', 'imprisoned', 'exiled', 'dead', 'prison', 'death', 'fine', 'intel', 'yes', 'no', 'grant', 'refuse', 'all', 'navy', 'capital', 'party', 'state', 'me', 'them', 'coup', 'assassination', 'uprising', 'stand_aside', 'stand_down', 'inform', 'resign', 'blind', 'warn'];
const NUMERIC = new Set(['amount', 'share', 'pct_gdp', 'men', 'turns', 'rate', 'price', 'level', 'quota', 'tariff', 'max_price', 'min_price', 'premium', 'toll', 'ships', 'reparations', 'arms', 'strength', 'budget_pct_gdp', 'interest', 'due_turns', 'quarters', 'pct', 'years', 'shells', 'prepare', 'min_safety', 'min_wage', 'pay_per_turn', 'unit_price', 'starts_in', 'remit', 'grain', 'levy', 'fee', 'offer', 'keep', 'covers', 'courts', 'press_freedom', 'need', 'after', 'extend']);
const FLAGS = new Set(['state', 'clear', 'secret', 'withdraw', 'lift', 'remove', 'public', 'closed', 'ban', 'on', 'end', 'from_cash', 'shelling', 'wait', 'cancel', 'fresh', 'here', 'all', 'annex', 'attend', 'unions', 'postal_secrecy', 'drop', 'protect', 'equal', 'join', 'legislative', 'veto', 'to_state', 'open', 'from_reserve', 'surety', 'promote', 'dismiss', 'revoke', 'again', 'accept', 'warn', 'show', 'quiet', 'forgive', 'conference', 'total', 'vote', 'office', 'elections']);
const TEXTS = new Set(['name', 'text', 'reason', 'words', 'terms', 'demand', 'question', 'charge', 'title', 'description', 'label', 'claim', 'topic', 'about']);

const failures = new Map(), tally = {};
// What a state and a person are worth, for the test of repetition: things of which more is better and which nothing should give for
// nothing. Money is the treasury less the debt (so that borrowing is no gain); men are the army, the reserve and the people together (so
// that calling up is no gain); mood is what the classes and the blocs have been given.
const FLOOR = { money: 20, gold: 20, purse: 3, purses: 6, standing: 1.5, word: 1.5, men: 5, goods: 10, mood: 4, quiet: 3, party: 4, ships: .6 };
function worth(w, cid, aid) {
  const c = w.countries[cid], a = w.characters[aid], home = countryProvinces(w, cid), ps = Object.values(w.characters).filter(x => x.alive && x.country === cid);
  return { money: (c.treasury ?? 0) - (c.debt ?? 0) + (c.vault ?? 0) * (c.priceLevel ?? 1) * 1.3, gold: (c.reserves ?? 0) - Object.values(c.creditors || {}).reduce((s, v) => s + (v || 0), 0), purse: a?.wealth ?? 0, purses: ps.reduce((s, x) => s + (x.wealth ?? 0), 0) / Math.max(ps.length, 1) * 30, standing: c.legitimacy ?? 0, word: c.honour ?? 0,
    men: Object.values(w.units).filter(u => u.country === cid).reduce((s, u) => s + u.men, 0) + (c.reserve ?? 0) + home.reduce((s, p) => s + provincePop(p), 0), goods: Object.values(c.stock || {}).reduce((s, v) => s + v, 0),
    mood: (c.mods || []).filter(m => /^sat\./.test(m.key)).reduce((s, m) => s + m.delta * Math.min(m.turns ?? 1, 4), 0) + home.reduce((s, p) => s + ['peasants', 'workers', 'middle'].reduce((t, k) => t + (p.pops[k]?.sat ?? 0) * (p.pops[k]?.n ?? 0), 0), 0) / Math.max(home.reduce((s, p) => s + provincePop(p), 0), 1),
    quiet: -home.reduce((s, p) => s + p.unrest, 0) / Math.max(home.length, 1), party: (c.parties || []).reduce((s, p) => s + (p.support ?? 0) + (p.organization ?? 0), 0) / Math.max((c.parties || []).length, 1), ships: Object.values(w.fleets).filter(f => f.country === cid).reduce((s, f) => s + f.ships, 0) + (c.shipping ?? 0) * .1 };
}
// A field that was not written is absent, as it is in what the referee sends (JSON has no "undefined").
const clean = v => Array.isArray(v) ? v.filter(x => x !== undefined).map(clean) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, clean(x)])) : v;
function fail(kind, key, detail, ctx) { const k = `${kind}: ${key}`; const f = failures.get(k); if (f) f.n++; else failures.set(k, { n: 1, detail, ctx }); }
const where = e => (String(e?.stack || '').split('\n').find(l => /engine|agents/.test(l)) || '').replace(/^.*[\\/](engine|agents)[\\/]/, '$1/').replace(/\)$/, '').trim();
const BAD = /undefined|NaN|\[object |Infinity|null thousand|\bnull\b(?! and void)/;

function pools(w) {
  const ids = o => Object.keys(o || {}); const P = { province: ids(w.provinces).filter(id => w.provinces[id].owner), unit: ids(w.units), fleet: ids(w.fleets), character: ids(w.characters).filter(id => w.characters[id].alive), country: ids(w.countries), sea: ids(w.seas || {}), firm: ids(w.firms), treaty: (w.treaties || []).map(t => t.id), contract: (w.contracts || []).map(k => k.id), debt: (w.debts || []).map(d => d.id), plot: (w.plots || []).map(p => p.id), war: (w.wars || []).map(x => x.id), offer: (w.offers || []).map(o => o.id), ask: (w.loanAsks || []).map(a => a.id), order: (w.standing || []).map(s => s.id) };
  P.party = Object.values(w.countries).flatMap(c => (c.parties || []).map(p => p.id)); P.paper = Object.values(w.countries).flatMap(c => (c.papers || []).map(p => p.id)); P.bill = Object.values(w.countries).flatMap(c => (c.parliament?.bills || []).map(b => b.id)); P.petition = Object.values(w.countries).flatMap(c => (c.petitions || []).map(p => p.id)); P.society = Object.values(w.countries).flatMap(c => (c.societies || []).map(p => p.id)); P.inst = Object.values(w.countries).flatMap(c => (c.institutions || []).map(p => p.id)); P.work = Object.values(w.countries).flatMap(c => (c.projects || []).map(p => p.id));
  P.people = [...new Set(Object.values(w.provinces).flatMap(p => (p.groups || []).flatMap(g => [g.eth, g.rel])))].filter(Boolean);
  P.any = Object.values(P).flat(); return P;
}
function gen(rnd, w, c, actor, P) {
  const pick = a => a.length ? a[Math.floor(rnd() * a.length)] : undefined, chance = p => rnd() < p;
  const mine = arr => arr.filter(id => (w.provinces[id]?.controller ?? w.units[id]?.country ?? w.fleets[id]?.country ?? w.characters[id]?.country) === c.id);
  const of = pool => chance(.06) ? pick(['X999', '', 7, null, 'the capital', { id: 1 }]) : chance(.6) && mine(pool).length ? pick(mine(pool)) : pick(pool);
  const number = name => { const r = rnd(); if (r < .05) return pick([0, -5, 1e9, 'many', null, '12', -0.5, 1e-9]); if (['share', 'rate', 'pct_gdp', 'premium', 'tariff', 'level', 'toll', 'pct', 'remit', 'covers', 'min_safety', 'levy', 'strength', 'budget_pct_gdp', 'interest'].includes(name)) return Math.round(rnd() * (name === 'pct_gdp' || name === 'premium' || name === 'interest' ? 8 : 120)) / 100; if (['turns', 'quarters', 'years', 'prepare', 'due_turns', 'starts_in', 'after', 'extend'].includes(name)) return Math.floor(rnd() * 9); return Math.round(rnd() * rnd() * 300); };
  const name = pick(NAMES), spec = OPS[name], op = { op: name };
  const idFor = () => { const byOp = { firm: /company|wages|safety|lockout|agitate|strike|share/, treaty: /treaty/, contract: /contract/, debt: /debt|terms|loan$/, plot: /plot/, paper: /paper/, bill: /bill|veto/, petition: /petition/, society: /society/, inst: /institution/, work: /cancel_work/, offer: /offer/, ask: /answer_loan/, order: /cancel_order/, war: /join_war/ }; for (const [k, re] of Object.entries(byOp)) if (re.test(name) && P[k].length && chance(.85)) return pick(P[k]); return pick(P.any); };
  for (const [f, opts] of Object.entries(spec)) {
    if (chance(.3) && !['target', 'province', 'unit', 'fleet', 'character', 'id', 'amount', 'kind', 'to'].includes(f)) continue;
    if (opts.size && chance(.9)) { op[f] = pick([...opts]); continue; }
    if (NUMERIC.has(f)) op[f] = number(f); else if (FLAGS.has(f)) op[f] = chance(.7);
    else if (TEXTS.has(f)) op[f] = pick(['The Morning Bell', 'no confidence', 'a thing asked for in a sentence', 'Q3 1903', '']);
    else if (['province', 'at', 'once_taken', 'objective'].includes(f)) op[f] = of(P.province); else if (f === 'provinces' || f === 'cede') op[f] = [of(P.province), of(P.province)].filter(Boolean);
    else if (f === 'from') op[f] = chance(.5) ? [of(P.province)] : pick(['party', 'state', 'treasury', of(P.character)]);
    else if (f === 'to') op[f] = /fleet|mines|amphib/.test(name) && chance(.4) ? pick(P.sea) : /share|leak|give|post|delegate|lend_private/.test(name) ? pick([of(P.character), 'state', of(P.country)]) : of(P.province);
    else if (f === 'unit' || f === 'into' && /unit/.test(name)) op[f] = of(P.unit); else if (f === 'units') op[f] = [of(P.unit), of(P.unit)]; else if (f === 'fleet' || f === 'into') op[f] = of(P.fleet);
    else if (f === 'first') op[f] = [of(P.unit), 'navy', of(P.fleet)]; else if (f === 'sea') op[f] = pick(P.sea);
    else if (['character', 'successor', 'buyer', 'nominee', 'payer', 'seller', 'head', 'of'].includes(f)) op[f] = chance(.1) ? 'state' : of(P.character);
    else if (['target', 'against', 'protector'].includes(f)) op[f] = chance(.08) ? c.id : pick(P.country.filter(id => id !== c.id)); else if (['parties', 'invite', 'between'].includes(f)) op[f] = [pick(P.country), pick(P.country)];
    else if (f === 'party' || f === 'ruling_party' || f === 'serves') op[f] = pick([...P.party, 'government', 'owner']); else if (f === 'paper') op[f] = pick(P.paper); else if (f === 'bill') op[f] = pick(P.bill); else if (f === 'plot') op[f] = pick(P.plot); else if (f === 'debt') op[f] = pick(P.debt); else if (f === 'war') op[f] = pick(P.war); else if (f === 'tender') op[f] = pick(P.any);
    else if (f === 'id') op[f] = idFor(); else if (['good', 'resource'].includes(f)) op[f] = chance(.05) ? 'unicorns' : pick(GOODS); else if (f === 'goods') op[f] = [pick(GOODS), pick(GOODS)];
    else if (f === 'sector') op[f] = pick([...Object.keys(PLANTS), 'mine']); else if (['people', 'group'].includes(f)) op[f] = pick(P.people); else if (f === 'members' || f === 'targets' || f === 'spare') op[f] = [of(P.character)];
    else if (f === 'clauses') op[f] = chance(.5) ? [{ type: pick(['delivery', 'loan', 'troop_limit', 'cede', 'reparations', 'renounce', 'observers', 'mutual_defense', 'assign', 'reschedule', 'nonsense']), province: of(P.province), provinces: [of(P.province)], from: pick(P.country), to: pick(P.country), country: pick(P.country), debtor: pick(P.country), creditor: pick(P.country), amount: number('amount'), good: pick(GOODS), rate: number('rate'), limit: number('men'), price: pick(['world', 5, undefined]) }] : pick(['none', undefined, 5]);
    else if (f === 'axes') op[f] = { econ: 200 * rnd() - 100, auth: 200 * rnd() - 100, nation: 200 * rnd() - 100, faith: 200 * rnd() - 100 };
    else if (f === 'powers') op[f] = [pick(NAMES), pick(NAMES)];
    else op[f] = pick([...WORDS, of(P.any)]);
  }
  // A handful of orders take other orders inside them.
  if (name === 'standing_order') { op.when = pick([{ after: 1 }, { attacked: true }, { war_on: pick(P.country) }, { date: 'Q1 1902' }, { mobilised: true }, { troops: { province: pick(P.province), above: 10 } }, { ultimatum: pick(P.country) }, { peace: pick(P.country) }, {}, 'soon']); op.then = [{ op: pick(NAMES), target: pick(P.country), province: pick(P.province), unit: pick(P.unit), amount: 5 }]; }
  return op;
}

function scan(v, path, out, depth = 0) {
  if (out.length > 4 || depth > 9) return;
  if (typeof v === 'number') { if (!Number.isFinite(v)) out.push(`${path} = ${v}`); return; }
  if (v === undefined) { out.push(`${path} = undefined`); return; }
  if (!v || typeof v !== 'object') return;
  if (v instanceof Map || v instanceof Set || v instanceof Date) { out.push(`${path} is a ${v.constructor.name} (lost when the world is saved)`); return; }
  if (Array.isArray(v)) { for (let i = 0; i < v.length && i < 400; i++) scan(v[i], `${path}[${i}]`, out, depth + 1); return; }
  for (const k of Object.keys(v)) scan(v[k], `${path}.${k}`, out, depth + 1);
}
const generic = p => p.replace(/\.[A-Z]{1,3}\d+\b/g, '.#').replace(/\[\d+\]/g, '[]').replace(/\d+/g, '#');

function check(w, ctx, before) {
  const bad = []; scan({ countries: w.countries, provinces: w.provinces, units: w.units, fleets: w.fleets, characters: w.characters, treaties: w.treaties, wars: w.wars, firms: w.firms, debts: w.debts, table: w.table }, 'w', bad);
  for (const b of bad) fail('BAD VALUE', generic(b.split(' = ')[0].split(' is ')[0]), b, ctx);
  try { JSON.stringify(w); } catch (e) { fail('NOT SAVABLE', e.message.slice(0, 80), e.message, ctx); }
  for (const c of aliveCountries(w)) {
    for (const r of ROLES) { const ch = w.characters[c[r]]; if (!ch || !ch.alive) fail('EMPTY SEAT', `${r} of a living state is ${ch ? 'dead' : 'nobody'}`, `${c.name} ${r} ${c[r]}`, ctx); else if (ch.country !== c.id) fail('EMPTY SEAT', `${r} belongs to another state`, `${c.name} ${r} ${ch.name} of ${ch.country}`, ctx); else if (r === 'leader' && ch.status !== 'free') fail('EMPTY SEAT', `the leader is ${ch.status}`, `${c.name} ${ch.name}`, ctx); }
    const cap = w.provinces[c.capital]; if (!cap || cap.controller !== c.id) fail('CAPITAL', 'the capital is not a province the state holds', `${c.name} capital ${c.capital} held by ${cap?.controller}`, ctx);
    for (const [k, lo, hi] of [['legitimacy', 0, 100], ['unrest', 0, 100], ['pressFreedom', 0, 100], ['courts', 0, 100], ['police', 0, 100], ['honour', 0, 100], ['fear', 0, 100], ['cells', 0, 100]]) if (c[k] != null && (c[k] < lo - 1e-6 || c[k] > hi + 1e-6)) fail('OUT OF RANGE', `country.${k}`, `${c.name} ${k} ${c[k]}`, ctx);
    if (c.reserves < -1e-6) fail('OUT OF RANGE', 'country.reserves below zero', `${c.name} ${c.reserves}`, ctx); if (c.debt < -1e-6) fail('OUT OF RANGE', 'country.debt below zero', `${c.name} ${c.debt}`, ctx);
    for (const k of Object.keys(c.stock || {})) if (c.stock[k] < -1e-6) fail('OUT OF RANGE', `stock.${k} below zero`, `${c.name} ${c.stock[k]}`, ctx);
    const g = c.goldLog?.at(-1); if (g && (Math.abs(g.in?.other ?? 0) > 1 || Math.abs(g.out?.other ?? 0) > 1)) fail('GOLD', 'gold moved that nobody named', `${c.name} other in ${g.in?.other} out ${g.out?.other}`, ctx);
    if (!countryProvinces(w, c.id).length) fail('LANDLESS', 'a living state holds no province', c.name, ctx);
  }
  for (const p of Object.values(w.provinces)) { if (!p.owner) continue; if (!w.countries[p.owner]?.alive) fail('ORPHAN', 'a province is owned by a state that is gone', `${p.name} owner ${p.owner}`, ctx); if (!w.countries[p.controller]?.alive) fail('ORPHAN', 'a province is held by a state that is gone', `${p.name} controller ${p.controller}`, ctx);
    for (const k of Object.keys(p.pops || {})) if (p.pops[k].n < -1e-6) fail('OUT OF RANGE', `pops.${k}.n below zero`, `${p.name} ${p.pops[k].n}`, ctx); if (p.unrest < -1e-6 || p.unrest > 100 + 1e-6) fail('OUT OF RANGE', 'province.unrest', `${p.name} ${p.unrest}`, ctx);
    const s = (p.groups || []).reduce((a, g) => a + g.share, 0); if (p.groups?.length && Math.abs(s - 1) > .03) fail('PEOPLES', 'the shares of a province\'s peoples do not come to one', `${p.name} ${s.toFixed(3)}`, ctx); }
  for (const u of Object.values(w.units)) { if (!(u.men >= 0)) fail('OUT OF RANGE', 'unit.men', `${u.id} ${u.men}`, ctx); if (!w.provinces[u.province]) fail('ORPHAN', 'a unit stands in no province', `${u.id} ${u.province}`, ctx); if (!w.countries[u.country]?.alive) fail('ORPHAN', 'a unit belongs to a state that is gone', `${u.id} ${u.country}`, ctx); }
  for (const f of Object.values(w.fleets)) { if (!(f.ships >= 0)) fail('OUT OF RANGE', 'fleet.ships', `${f.id} ${f.ships}`, ctx); if (!w.countries[f.country]?.alive) fail('ORPHAN', 'a fleet belongs to a state that is gone', `${f.id} ${f.country}`, ctx); }
  // People and gold: a quarter moves them only within what the engine can explain.
  const people = Object.values(w.provinces).reduce((a, p) => a + (p.owner ? provincePop(p) : 0), 0), gold = Object.values(w.countries).reduce((a, c) => a + (c.alive ? c.reserves : 0), 0);
  if (before) { if (people > before.people * 1.02 + 1) fail('PEOPLE', 'the world\'s people grew by more than two in the hundred in a quarter', `${Math.round(before.people)} -> ${Math.round(people)}`, ctx); if (gold > before.gold * 1.06 + 50) fail('GOLD', 'the world\'s gold grew by more than six in the hundred in a quarter', `${Math.round(before.gold)} -> ${Math.round(gold)}`, ctx); }
  for (const n of w.newsThisTurn || []) if (BAD.test(n.text)) fail('BAD TEXT', `news: ${n.text.replace(/[A-Z][a-z]+/g, 'X').replace(/\d+/g, '#').slice(0, 70)}`, n.text.slice(0, 300), ctx);
  return { people, gold };
}
function read(w, ctx, seen) {
  for (const ch of Object.values(w.characters)) { if (!ch.alive) continue; for (const m of (ch.inbox || []).slice(seen.get(ch.id) ?? 0)) if (BAD.test(m.text || '')) fail('BAD TEXT', `notice: ${String(m.text).replace(/[A-Z][a-z]+/g, 'X').replace(/\d+/g, '#').slice(0, 70)}`, String(m.text).slice(0, 300), ctx); seen.set(ch.id, (ch.inbox || []).length); }
}
const TOPICS = ['budget', 'economy', 'army', 'fleet', 'borders', 'diplomacy', 'wars', 'treaties', 'parties', 'parliament', 'unrest', 'blocs', 'mood', 'plots', 'justice', 'money', 'labour', 'culture', 'press', 'institutions', 'trade', 'stocks', 'market', 'routes', 'strategic', 'technology', 'companies', 'my_companies', 'contracts', 'debts', 'dossiers', 'my_secrets', 'people', 'projects', 'building', 'fortifications', 'commanders', 'informants', 'population', 'map', 'map:mine', 'world', 'news', 'history'];
function ask(w, ctx) {
  for (const c of aliveCountries(w)) { const others = aliveCountries(w).filter(o => o.id !== c.id), o = others[w.turn % Math.max(others.length, 1)];
    const who = [...ROLES.map(r => w.characters[c[r]]), Object.values(w.characters).find(x => x.alive && x.country === c.id && x.status !== 'free'), Object.values(w.characters).find(x => x.alive && x.country === c.id && !ROLES.some(r => c[r] === x.id))].filter(x => x?.alive);
    for (const ch of who) {
      try { const t = desk(w, ch); if (BAD.test(typeof t === 'string' ? t : JSON.stringify(t))) fail('BAD TEXT', `desk of ${ch.role}`, String(typeof t === 'string' ? t : JSON.stringify(t)).match(new RegExp(`.{0,120}(${BAD.source}).{0,60}`))?.[0], ctx); } catch (e) { fail('CRASH in desk', `${e.message.slice(0, 70)} @ ${where(e)}`, e.stack, { ...ctx, who: `${ch.role} ${ch.status}` }); }
      try { const t = actorPrompt(w, ch, [], false, {}); if (BAD.test(t)) fail('BAD TEXT', `morning of ${ch.role}`, t.match(new RegExp(`.{0,120}(${BAD.source}).{0,60}`))?.[0], ctx); } catch (e) { fail('CRASH in the morning prompt', `${e.message.slice(0, 70)} @ ${where(e)}`, e.stack, { ...ctx, who: `${ch.role} ${ch.status}` }); }
      for (const t of [...TOPICS, o ? `country:${o.id}` : 'world', o ? `war_plan:${o.id}` : 'army', `province:${c.capital}`, o ? `province:${o.capital}` : 'map', `person:${c.leader}`, `building:${c.capital}`, 'nonsense', 'person:K0', 'province:', `sea:${Object.keys(w.seas || {})[0] ?? 'D1'}`]) {
        try { const a = answer(w, ch, t); if (typeof a !== 'string') fail('BAD ANSWER', `${t.split(':')[0]} did not answer with text`, typeof a, ctx); else if (BAD.test(a)) fail('BAD TEXT', `answer ${t.split(':')[0]} to ${ch.role}`, a.match(new RegExp(`.{0,120}(${BAD.source}).{0,60}`))?.[0], ctx); }
        catch (e) { fail('CRASH in answer', `${t.split(':')[0]}: ${e.message.slice(0, 70)} @ ${where(e)}`, e.stack, { ...ctx, who: `${ch.role} ${ch.status}`, topic: t }); }
      } } }
}

// Orders that make sense together, given by the seat whose they are and with the right names: treaties proposed and signed, wars declared
// and fought, peace made, plots begun and sprung, works founded, contracts signed, the street used, a league dealt with. Without these
// the random orders above would seldom reach the deeper states of the world.
function scenes(rnd, w, P) {
  const out = [], pick = a => a.length ? a[Math.floor(rnd() * a.length)] : undefined, chance = p => rnd() < p, cs = aliveCountries(w);
  const atWar = (a, b) => (w.wars || []).some(x => x.active && ((x.a.includes(a) && x.b.includes(b)) || (x.a.includes(b) && x.b.includes(a))));
  for (const c of cs) {
    const home = countryProvinces(w, c.id), R = w.characters[c.leader], G = w.characters[c.general], O = w.characters[c.opposition], M = w.characters[c.oligarch];
    const nb = [...new Set(home.flatMap(p => (p.neighbors || []).map(id => w.provinces[id]?.controller)).filter(id => id && id !== c.id && w.countries[id]?.alive))], t = pick(nb.length ? nb : cs.map(o => o.id).filter(id => id !== c.id));
    if (!t) continue; const T = w.countries[t], theirs = countryProvinces(w, t), put = (a, op) => out.push([c, a, op]);
    const border = home.flatMap(p => (p.neighbors || []).map(id => w.provinces[id]).filter(q => q && q.controller !== c.id && w.countries[q.controller]?.alive).map(q => [p, q]));
    // Papers between states.
    if (chance(.15)) put(R, { op: 'propose_treaty', target: t, kind: pick(['alliance', 'nonaggression', 'trade', 'military_access', 'commission', 'guarantee', 'protection']), terms: 'As the two governments have agreed.', turns: pick([4, 8, 20, undefined]), secret: chance(.2), clauses: chance(.5) ? [pick([{ type: 'troop_limit', provinces: [pick(home)?.id, pick(theirs)?.id], limit: 15 }, { type: 'loan', from: c.id, to: t, amount: 40, rate: .012 }, { type: 'delivery', from: c.id, to: t, good: pick(GOODS), amount: 4, price: pick(['world', 3, undefined]), turns: 6 }, { type: 'mutual_defense', against: [pick(cs).id] }, { type: 'observers', provinces: [pick(home)?.id] }, { type: 'demilitarized_zone', provinces: [pick(theirs)?.id] }, { type: 'renounce', country: t, provinces: [pick(home)?.id] }, { type: 'reschedule', debtor: t, creditor: c.id, rate: .008 }])] : undefined });
    if (chance(.06)) put(R, { op: 'propose_treaty', parties: [c.id, t, pick(cs).id], kind: pick(['alliance', 'nonaggression', 'trade']), terms: 'Among the three.', turns: 12 });
    for (const tr of (w.treaties || [])) if (chance(.35) && !tr.active && !tr.ended) put(R, { op: pick(['accept_treaty', 'accept_treaty', 'accept_treaty', 'decline_treaty', 'withdraw_treaty']), id: tr.id });
    if (chance(.1)) put(R, { op: 'accept_treaty', target: t });
    if (chance(.03)) put(R, { op: pick(['break_treaty', 'end_treaty', 'publish_treaty']), id: pick(P.treaty) });
    if (chance(.05)) put(R, { op: 'ultimatum', target: t, demand: 'The province, within the quarter.', cede: [pick(theirs)?.id], turns: pick([1, 2]) });
    if (chance(.05)) put(R, { op: 'standing_order', when: { ultimatum: t }, then: [{ op: 'declare_war', target: t }, { op: 'offensive', to: pick(border.filter(([, q]) => q.controller === t).map(([, q]) => q.id)) }] });
    if (chance(.06)) put(R, { op: pick(['set_relations', 'embargo', 'note', 'demonstrate', 'guarantee', 'recognise', 'call_conference', 'mediate']), target: t, level: pick(['recalled', 'broken', 'normal']), on: true, text: 'A protest.', invite: [t, pick(cs).id], question: 'The frontier.', between: [t, pick(cs).id], kind: 'armistice', terms: 'Arms are laid down.' });
    // Money between states.
    if (chance(.06)) put(R, { op: 'set_lending', target: chance(.5) ? t : undefined, mode: pick(['free', 'leave', 'closed']), premium: pick([undefined, .01]) });
    if (chance(.1)) put(R, { op: 'borrow_foreign', target: chance(.6) ? t : undefined, amount: pick([30, 120, 900]) });
    for (const a of (w.loanAsks || [])) if (a.lender === c.id && chance(.7)) put(R, { op: 'answer_loan', id: a.id, answer: pick(['grant', 'refuse']), amount: pick([undefined, 20]), words: 'On terms.' });
    // War.
    const foes = cs.filter(o => o.id !== c.id && atWar(c.id, o.id));
    if (!foes.length && chance(.07)) { put(R, { op: 'declare_war', target: t, aims: chance(.6) ? { provinces: [pick(theirs)?.id] } : undefined }); put(R, { op: 'mobilize', men: pick([20, 60]), all: chance(.1) }); }
    for (const e of foes) {
      const front = border.filter(([, q]) => q.controller === e.id), [p, q] = pick(front) ?? [];
      if (q) { const mine = Object.values(w.units).filter(u => u.country === c.id && u.province === p.id).map(u => u.id);
        put(chance(.5) ? G : R, { op: 'offensive', to: q.id, units: chance(.6) && mine.length ? mine : undefined, manner: pick(['assault', 'assault', 'probe', 'all_out', 'siege']), shelling: chance(.3), prepare: pick([undefined, 1]), shells: pick([undefined, 5]) });
        if (chance(.3)) put(G, { op: 'move', unit: pick(Object.values(w.units).filter(u => u.country === c.id).map(u => u.id)), to: chance(.5) ? q.id : p.id, men: pick([undefined, 5]) });
        if (chance(.2)) put(G, { op: 'offensive', to: q.id, cancel: true }); }
      if (chance(.2)) put(G, { op: 'set_posture', posture: pick(['defensive', 'no_retreat', 'fall_back', 'ordinary']), all: true });
      const fleet = pick(Object.values(w.fleets).filter(f => f.country === c.id)), harbour = pick(countryProvinces(w, e.id).filter(x => x.port));
      if (fleet && harbour && chance(.3)) { put(G, { op: 'move_fleet', fleet: fleet.id, to: pick(harbour.seas || []) ?? harbour.id }); put(G, { op: pick(['bombard', 'lay_mines', 'amphibious', 'fleet_orders']), province: harbour.id, fleet: fleet.id, sea: pick(harbour.seas || []), unit: pick(Object.values(w.units).filter(u => u.country === c.id).map(u => u.id)), to: harbour.id, orders: pick(['blockade', 'raid', 'seek', 'port']) }); }
      if (chance(.15)) put(R, { op: 'propose_treaty', target: e.id, kind: pick(['peace', 'peace', 'armistice']), terms: 'Peace.', cede: chance(.5) ? [pick(countryProvinces(w, e.id))?.id] : chance(.3) ? [pick(home)?.id] : undefined, reparations: chance(.3) ? 60 : undefined, reparations_from: pick(['me', 'them']) });
      if (chance(.2)) put(R, { op: 'accept_treaty', target: e.id });
      if (chance(.05)) put(R, { op: 'release_prisoners', target: e.id, men: pick([undefined, 2]) });
    }
    if (chance(.04) && (w.wars || []).some(x => x.active)) put(R, { op: 'join_war', war: pick((w.wars || []).filter(x => x.active))?.id, side: pick(['a', 'b']) });
    if (chance(.05)) put(G, { op: 'prepare_plan', target: t, objective: pick(theirs)?.id, fresh: chance(.2) });
    if (chance(.05)) put(R, { op: pick(['recruit', 'disband', 'demobilize', 'build_ship', 'drill']), province: pick(home)?.id, men: pick([5, 20, 400]), unit_kind: pick(['infantry', 'cavalry', 'artillery']), unit: pick(Object.values(w.units).filter(u => u.country === c.id).map(u => u.id)), ships: 2, kind: pick(['cruiser', 'torpedo', 'merchant', 'battleship']), all: true });
    // The seats against one another.
    const plot = (w.plots || []).find(x => x.active && x.country === c.id);
    for (const who of [O, G, M]) if (who?.alive && who.status === 'free') {
      if (!plot && chance(.04)) put(who, { op: 'start_plot', kind: pick(['coup', 'coup', 'assassination', 'uprising']), character: R?.id, secrecy: pick([40, 80]) });
      if (plot && plot.leader === who.id) { if (chance(.4)) put(who, { op: 'invite_plot', plot: plot.id, character: pick([G, O, M, ...Object.values(w.characters).filter(x => x.alive && x.country === c.id && x.role === 'officer')])?.id }); if (chance(.3)) put(who, { op: 'fund_plot', plot: plot.id, amount: 5 }); if (chance(.3)) put(who, { op: 'execute_plot', plot: plot.id, fate: pick(['exiled', 'imprisoned', 'dead']), elections: pick([undefined, true, false]), parliament: pick([undefined, 'keep', 'suspend']) }); }
      else if (plot && chance(.1)) put(who, { op: pick(['join_plot', 'betray_plot']), plot: plot.id });
    }
    const victim = pick([G, O, M, ...Object.values(w.characters).filter(x => x.alive && x.country === c.id && x.id !== c.leader).slice(0, 6)]);
    if (victim && chance(.05)) put(R, { op: 'purge', character: victim.id, fate: pick(['imprisoned', 'exiled', 'dead']), successor: chance(.3) ? pick(Object.values(w.characters).filter(x => x.alive && x.country === c.id))?.id : undefined });
    if (victim && chance(.05)) put(R, { op: pick(['prosecute', 'dismiss', 'watch', 'gather_dossier', 'release', 'amnesty', 'extradite', 'expel']), character: victim.id, charge: 'Treason.', penalty: pick(['prison', 'death']) });
    if (chance(.04)) put(R, { op: pick(['repress', 'persecute', 'raid_cells', 'forbid_meetings', 'move_capital', 'set_regime', 'designate_successor', 'forced_labour', 'resettle']), strength: .6, province: pick(home)?.id, people: pick(P.people), on: true, regime: 'Directory', character: victim?.id, from: pick(home)?.id, to: pick(home)?.id, share: .3 });
    if (chance(.04)) put(pick([R, G, O, M]), { op: pick(['resign', 'go_abroad', 'retire', 'name_deputy', 'return_home']), to: t, character: victim?.id });
    // Parliament and parties.
    if (chance(.08)) put(R, { op: 'propose_law', title: 'A bill', text: 'As tabled.', ops: [pick([{ op: 'set_tax', kind: 'income', rate: .22 }, { op: 'set_import', good: 'grain', tariff: .2 }, { op: 'declare_war', target: t }, { op: 'set_labour_law', min_safety: .5, min_wage: 1 }, { op: 'set_status', people: pick(P.people), office: false }, { op: 'set_budget', category: 'military', covers: 1 }])] });
    for (const b of (c.parliament?.bills || [])) if (chance(.3)) put(pick([R, O]), { op: pick(['vote_bill', 'vote_bill', 'lobby_bill', 'withdraw_bill', 'veto']), bill: b.id, vote: pick(['yes', 'no', 'abstain', 'free']), amount: 3, party: pick(c.parties)?.id });
    if (chance(.06)) put(O, { op: pick(['no_confidence', 'coalition', 'found_party', 'fund_party', 'set_dues', 'watch_polls']), text: 'No confidence.', party: pick(c.parties)?.id, join: chance(.5), name: 'New Party', amount: 4, rate: .03 });
    if (chance(.04)) put(R, { op: pick(['ban_party', 'suspend_parliament', 'create_parliament', 'rig_election', 'set_institutions']), party: pick(c.parties)?.id, lift: chance(.3), turns: 4, courts: 30, press_freedom: pick([20, 80]), unions: chance(.5) });
    // The street.
    if (chance(.2)) put(O, { op: pick(['petition', 'rally', 'found_society', 'call_strike', 'incite', 'found_paper']), demand: 'Bread at the old price.', class: pick(['workers', 'peasants', 'middle']), kind: pick(['union', 'peasants', 'mutual']), amount: 3, people: pick(P.people), name: 'The Voice' });
    for (const x of (c.petitions || [])) if (x.status === 'presented' && chance(.6)) put(R, { op: 'answer_petition', id: x.id, answer: pick(['grant', 'refuse', 'receive']), words: 'In part.' });
    if (c.league && !c.league.gone) { if (chance(.4)) put(pick([M, O, G]), { op: 'back_league', amount: pick([3, 12]) }); if (chance(.3)) put(pick([R, O, G, M]), { op: 'adopt_league', drop: chance(.15) }); if (chance(.4)) put(pick([R, O, G, M]), { op: 'unleash', on: pick([c.league.goat, pick(c.parties)?.id, pick(c.papers || [])?.id, pick(c.societies || [])?.id, 'the enemy']), province: chance(.3) ? pick(home)?.id : undefined }); if (chance(.12)) put(R, { op: 'ban_league', lift: chance(.3) }); if (chance(.15)) put(pick([R, M]), { op: 'bribe', character: c.league.chief, amount: 60, for: 'stand_down' }); if (chance(.05)) put(R, { op: 'purge', character: c.league.chief, fate: pick(['imprisoned', 'exiled', 'dead']) }); }
    // Works, contracts, notes.
    if (chance(.12)) put(M, { op: 'found_company', sector: pick(['goods', 'steel', 'machines', 'arms', 'mine']), resource: pick(['coal', 'iron', 'copper']), province: chance(.5) ? pick(home)?.id : undefined, amount: pick([8, 25]), name: 'A House' });
    const own = Object.values(w.firms || {}).filter(f => f.owner === M?.id), f = pick(own);
    if (f && chance(.3)) put(M, { op: pick(['set_wages', 'set_safety', 'invest_company', 'draw_company', 'lockout', 'sell_company', 'assign_share']), id: f.id, level: pick([.3, 1, 1.3]), amount: 4, price: 30, buyer: pick(['state', R?.id, undefined]), to: pick([R?.id, 'state', O?.id]), share: pick([.1, .3, .6]), nominee: chance(.3) ? G?.id : undefined });
    if (f && chance(.08)) put(R, { op: pick(['nationalize_company', 'inspect', 'arbitrate_strike', 'break_strike', 'buy_company']), id: f.id, level: 1.1, state: true });
    if (chance(.12)) put(M, { op: 'propose_contract', to: R?.id, terms: 'Cloth for the army.', good: pick(['goods', 'arms', 'steel', 'grain']), amount: 3, price: pick(['world', 'home', undefined]), unit_price: pick([undefined, 30]), pay_per_turn: pick([undefined, 5]), payer: 'them', seller: 'me', turns: 6, starts_in: pick([undefined, 2]), to_state: true });
    for (const k of (w.contracts || [])) if (k.status === 'proposed' && chance(.4)) put(pick([R, M, O, G]), { op: pick(['accept_contract', 'accept_contract', 'cancel_contract']), id: k.id, state: chance(.6) });
    if (chance(.1)) put(pick([R, G, O, M]), { op: 'borrow_private', amount: pick([6, 40]), due_turns: 4 });
    if (chance(.06)) put(M, { op: 'lend_private', character: pick([R, G, O])?.id, amount: 8, interest: 1, due_turns: 4, terms: 'A favour.' });
    for (const d of (w.debts || [])) if (d.status === 'offered' && chance(.5)) put(w.characters[d.debtor], { op: pick(['accept_loan', 'decline_loan']), debt: d.id });
    for (const o of (w.offers || [])) if (o.status === 'open' && chance(.5)) put(w.characters[o.to], { op: pick(['accept_offer', 'decline_offer']), id: o.id });
    if (chance(.08)) put(pick([M, O, G]), { op: pick(['bribe', 'recruit_informant', 'blackmail', 'give']), character: pick([R, G, O, M, ...Object.values(w.characters).filter(x => x.alive && x.country === c.id && x.post)])?.id, to: O?.id, amount: pick([3, 25]), for: pick(['inform', 'stand_aside', 'blind', 'warn', 'books', 'resign', undefined]) });
    if (chance(.08)) put(R, { op: 'create_institution', name: 'Board of Audit', description: 'Audits the accounts.', budget_pct_gdp: .001, powers: ['audit'], head: victim?.id, members: [G?.id] });
    if (chance(.08)) put(R, { op: 'build', province: pick(home)?.id, kind: pick(['railway', 'port', 'fort', 'depot', 'shipyard', 'goods', 'mine', 'farming', 'infrastructure', 'trench', 'battery', 'dam']), resource: 'coal', amount: pick([undefined, 40]), line: chance(.2) ? [pick(home)?.id, pick(home)?.id] : undefined });
    // What each person holds: notes of hand, files, orders that wait; and what lies before the government.
    for (const who of [R, G, O, M].filter(x => x?.alive)) {
      for (const d of (w.debts || []).filter(d => ['open', 'overdue'].includes(d.status))) { if (d.debtor === who.id && chance(.3)) put(who, { op: pick(['repay_debt', 'ask_terms', 'repay_debt']), debt: d.id, amount: pick([undefined, 3]), offer: pick([undefined, 5]) }); if (d.creditor === who.id && chance(.3)) put(who, { op: pick(['call_debt', 'extend_debt', 'forgive_debt', 'sell_debt']), debt: d.id, to: pick([R, G, O, M])?.id, turns: 4, price: 5 }); }
      for (const id of Object.keys(who.dossiers || {})) if (chance(.25)) put(who, { op: pick(['publish_dossier', 'blackmail', 'denounce', 'forge_dossier', 'prosecute']), character: id, for: pick(['pay', 'resign', 'inform', undefined]), amount: 3, charge: 'What the file holds.', penalty: 'prison' });
      for (const so of (w.standing || []).filter(x => x.by === who.id)) if (chance(.2)) put(who, { op: 'cancel_order', id: so.id });
      if (chance(.06)) put(who, { op: 'inquire', into: pick([f?.id, 'treasury', 'customs', 'army', 'police', 'courts', 'post', pick(home)?.id, pick(Object.values(w.units).filter(u => u.country === c.id))?.id, pick(c.papers || [])?.id, `death:${victim?.id}`]), public: chance(.3) });
      if (chance(.05)) put(who, { op: pick(['watch', 'buy_bonds', 'sell_bonds', 'capital_flight', 'repatriate', 'destroy_evidence', 'fund_underground', 'pay_state']), character: victim?.id, target: chance(.5) ? t : c.id, amount: pick([2, 9]), share: .3, to: t, about: 'the old matter' });
    }
    for (const tn of (w.tenders || []).filter(x => x.country === c.id)) { if (chance(.5)) put(M, { op: 'bid', tender: tn.id, id: tn.id, price: pick([2, 30]) }); if (chance(.3)) put(R, { op: 'award_tender', tender: tn.id, id: tn.id, to: M?.id }); }
    for (const cf of (w.conferences || []).filter(x => x.open && (x.invited || []).includes(c.id))) if (chance(.7)) put(R, { op: 'attend_conference', id: cf.id, attend: chance(.8) });
    for (const fm of Object.values(w.firms || {}).filter(x => x.country === c.id && x.strike)) { if (chance(.4)) put(R, { op: pick(['break_strike', 'arbitrate_strike']), id: fm.id, level: 1.1 }); if (chance(.3)) put(w.characters[fm.owner], { op: pick(['lockout', 'set_wages', 'set_safety']), id: fm.id, level: 1.2 }); if (chance(.2)) put(O, { op: 'agitate', id: fm.id }); }
    for (const x of Object.values(w.characters).filter(x => x.alive && x.status === 'exiled' && x.host === c.id)) if (chance(.4)) put(R, { op: pick(['extradite', 'expel', 'recognise_exile']), character: x.id });
    for (const x of Object.values(w.characters).filter(x => x.alive && x.status === 'imprisoned' && x.country === c.id)) { if (chance(.3)) put(O, { op: 'petition_release', character: x.id }); if (chance(.15)) put(R, { op: pick(['release', 'prosecute', 'purge']), character: x.id, fate: 'dead', charge: 'Treason.', penalty: 'death' }); }
    for (const n of (c.papers || [])) if (chance(.12)) put(R, { op: pick(['censor', 'close_paper', 'censor']), paper: n.id, id: n.id, lift: chance(.3), about: chance(.3) ? victim?.id : undefined });
    for (const b of (c.parliament?.bills || c.bills || [])) if (chance(.2)) put(M, { op: 'lobby_bill', bill: b.id, amount: 4, direction: pick(['for', 'against']), party: pick(c.parties)?.id });
    for (const inst of (c.institutions || [])) if (chance(.2)) put(pick([R, w.characters[inst.head], w.characters[inst.founder]].filter(Boolean)), { op: pick(['fund_institution', 'appoint_institution', 'draw_institution', 'dissolve_institution']), id: inst.id, amount: 2, budget_pct_gdp: .002, character: victim?.id, members: [G?.id] });
    for (const x of (w.projects || []).filter(x => x.country === c.id && !x.status)) if (chance(.1)) put(R, { op: 'cancel_work', id: x.id });
    for (const a of (w.loanAsks || [])) if (a.to === c.id && chance(.7)) put(R, { op: 'answer_loan', id: a.id, answer: pick(['grant', 'refuse']), amount: pick([undefined, 20]), premium: pick([undefined, .005]), words: 'On terms.' });
    if (O && chance(.12)) { put(O, { op: 'found_society', kind: 'union', amount: 2 }); put(O, { op: 'call_strike', sector: pick(['mine', 'goods', undefined]), province: chance(.3) ? pick(home)?.id : undefined }); }
    { const fl = Object.values(w.fleets).filter(x => x.country === c.id), a = pick(fl), b = fl.find(x => x.id !== a?.id && x.kind === a?.kind); if (a && b && chance(.1)) put(G, { op: 'merge_fleets', fleet: a.id, into: b.id });
      const us = Object.values(w.units).filter(x => x.country === c.id), u = pick(us), v = us.find(x => x.id !== u?.id && x.province === u?.province && x.kind === u?.kind); if (u && v && chance(.1)) put(G, { op: 'merge_units', unit: u.id, into: v.id }); }
    { const p = pick(home.filter(p => (p.groups || []).some(g => g.eth !== c.majorityEth && g.share > .05))), g = p && pick(p.groups.filter(g => g.eth !== c.majorityEth)); if (p && g && chance(.08)) put(R, { op: pick(['forced_labour', 'resettle', 'persecute', 'set_status', 'set_culture_policy', 'incite']), province: p.id, from: p.id, to: pick(home)?.id, people: g.eth, share: .3, on: true, office: false, vote: chance(.5), levy: .02, language: pick(['assimilate', 'tolerate', 'autonomy']), amount: 3 }); }
    if (chance(.05)) put(R, { op: 'set_research', tech: pick(Object.keys(c.techs ? TECHS : {}).filter(k => !c.techs[k] && TECHS[k].req.every(r => c.techs[r]))) });
    if (chance(.04)) put(R, { op: pick(['set_strait', 'build_canal']), id: pick([...Object.keys(w.straits || {}), ...(w.straits || []).map?.(x => x.id) ?? [], ...((w.canals || []).map?.(x => x.id) ?? [])]), closed: chance(.5), toll: .05 });
    if (chance(.04)) { put(R, { op: 'grant_concession', target: t, province: pick(home.filter(p => Object.values(p.deposits || {}).some(d => d?.known)))?.id, resource: pick(['coal', 'iron', 'copper', 'oil']), share: .3 }); put(R, { op: 'revoke_concession', province: pick(home)?.id, resource: pick(['coal', 'iron', 'copper', 'oil']) }); }
    if (chance(.06)) put(R, { op: pick(['tender', 'buy_goods', 'sell_goods', 'sell_gold', 'buy_gold', 'print_money', 'devalue', 'default_debt', 'set_gold_floor', 'concession', 'relief', 'relieve_province', 'pay_person', 'embezzle', 'nationalize', 'land_reform']), good: pick(GOODS), amount: pick([5, 60]), quarters: 4, pct_gdp: .02, pct: .1, cls: pick(['peasants', 'workers', 'army']), to: pick(home)?.id, province: pick(home)?.id, remit: .5, character: victim?.id, reason: 'Services.' });
  }
  return out;
}

const t0 = Date.now(); let orders = 0, done = 0;
for (const seed of WORLDS) for (const run of RUNS) {
  const rnd = mulberry(seed * 31 + run), w = createWorld({ ...base, seed }), seen = new Map(); let before = check(w, { seed, run, turn: 0, phase: 'handed over' });
  for (let q = 0; q < Q; q++) {
    try { beginTurn(w); } catch (e) { fail('CRASH in beginTurn', `${e.message.slice(0, 80)} @ ${where(e)}`, e.stack, { seed, run, turn: w.turn }); }
    const P = pools(w);
    // An order given and looked at.
    const give = (c, actor, op, how = 'random') => {
      if (!actor?.alive || !op) return null; op = clean(op); const ctx = { seed, run, turn: w.turn, how, actor: `${actor.id} ${actor.role} ${actor.status}`, op: JSON.stringify(op).slice(0, 400) }; orders++;
      // REPEAT=1: the same order given twenty times in the quarter must not bring twenty times the gain (see worth, below).
      const pre = process.env.REPEAT && rnd() < .35 ? structuredClone(w) : null;
      if (pre) { let r1; try { r1 = applyOp(w, actor, op); } catch (e) { fail('CRASH in an order', `${op.op}: ${e.message.slice(0, 80)} @ ${where(e)}`, e.stack, ctx); return null; }
        if (r1?.ok) { const base = worth(pre, c.id, actor.id), once = worth(w, c.id, actor.id), a2 = pre.characters[actor.id]; try { for (let i = 0; i < 20; i++) applyOp(pre, a2, structuredClone(op)); } catch (e) { fail('CRASH in an order', `${op.op} (repeated): ${e.message.slice(0, 80)} @ ${where(e)}`, e.stack, ctx); return r1; }
          const many = worth(pre, c.id, actor.id);
          for (const k of Object.keys(base)) { const g1 = once[k] - base[k], g20 = many[k] - base[k], floor = FLOOR[k] ?? 1; if (g20 > floor && g20 > Math.max(g1, 0) * 2.5 + floor) fail('MULTIPLIES', `${op.op}: ${k} grows with every repetition`, `${k}: ${base[k].toFixed(1)} -> ${once[k].toFixed(1)} given once, -> ${many[k].toFixed(1)} given twenty times`, ctx); } }
        const tl = tally[op.op] ||= { ok: 0, no: 0, why: {} }; if (r1?.ok) { done++; tl.ok++; } else tl.no++; return r1; }
      let r; try { r = how === 'random' && rnd() < .12 ? carryList(w, actor, [op, { ...gen(rnd, w, c, actor, P), if_done: 0 }], plain => applyOp(w, actor, plain))[0] : applyOp(w, actor, op); }
      catch (e) { fail('CRASH in an order', `${op.op}: ${e.message.slice(0, 80)} @ ${where(e)}`, e.stack, ctx); return null; }
      if (!r || typeof r.ok !== 'boolean') { fail('BAD REPLY', `${op.op} returned ${r === undefined ? 'nothing' : JSON.stringify(r).slice(0, 40)}`, JSON.stringify(r), ctx); return null; }
      const tl = tally[op.op] ||= { ok: 0, no: 0, why: {} }; if (r.ok) { done++; tl.ok++; } else { tl.no++; const m = String(r.msg || '').replace(/\d+/g, '#').slice(0, 90); tl.why[m] = (tl.why[m] || 0) + 1; }
      if (r.msg != null && typeof r.msg !== 'string') fail('BAD REPLY', `${op.op}: the reply is not text`, JSON.stringify(r.msg).slice(0, 200), ctx);
      else if (BAD.test(r.msg || '')) fail('BAD TEXT', `reply of ${op.op}: ${String(r.msg).replace(/[A-Z][a-z]+/g, 'X').replace(/\d+/g, '#').slice(0, 60)}`, r.msg.slice(0, 300), ctx);
      else if (!r.ok && !r.msg) fail('BAD REPLY', `${op.op} refused without saying why`, JSON.stringify(r), ctx);
      return r;
    };
    // A state is hurt early in every run, so that what grows out of a grievance is exercised too; and later its government is made weak.
    if (q === 1) { const cs = aliveCountries(w), c = cs[Math.floor(rnd() * cs.length)], o = cs.find(x => x.id !== c.id && countryProvinces(w, c.id).some(p => (p.neighbors || []).some(id => w.provinces[id]?.controller === x.id))) ?? cs.find(x => x.id !== c.id);
      for (const p of countryProvinces(w, c.id).filter(p => p.id !== c.capital).slice(0, 2)) { for (const u of Object.values(w.units)) if (u.province === p.id && u.country === c.id) u.province = c.capital; p.owner = p.controller = o.id; p.lostBy = c.id; p.lostIn = 1900 + Math.floor(w.turn / 4); } w.hurt = c.id; }
    if (q === 7 && w.countries[w.hurt]?.league) { w.countries[w.hurt].league.strength = 72; w.countries[w.hurt].legitimacy = 24; }
    for (const [c, actor, op] of scenes(rnd, w, P)) give(c, actor, op, 'scene');
    for (const c of aliveCountries(w)) {
      const small = Object.values(w.characters).filter(x => x.alive && x.country === c.id && !ROLES.some(r => c[r] === x.id)).sort(() => rnd() - .5).slice(0, 2);
      const cast = [[w.characters[c.leader], PER * 4], [w.characters[c.general], PER * 2], [w.characters[c.opposition], PER], [w.characters[c.oligarch], PER], ...small.map(x => [x, 2])];
      for (const [actor, n] of cast) for (let i = 0; i < n; i++) if (actor?.alive && w.countries[c.id]?.alive) give(c, actor, gen(rnd, w, c, actor, P));
    }
    try { stepWorld(w); } catch (e) { fail('CRASH in the quarter', `${e.message.slice(0, 80)} @ ${where(e)}`, e.stack, { seed, run, turn: w.turn }); break; }
    const ctx = { seed, run, turn: w.turn, phase: 'after the quarter' }; before = check(w, ctx, before); read(w, ctx, seen); if (q % 3 === 2 || q === Q - 1) ask(w, ctx);
  }
  console.log(`world ${seed} run ${run}: ${Q} quarters, ${aliveCountries(w).length} states left, wars ${(w.wars || []).filter(x => x.active).length}, ${failures.size} kinds of failure so far (${Math.round((Date.now() - t0) / 1000)}s)`);
}
if (process.env.WHY) { const never = NAMES.filter(n => !tally[n]?.ok); console.log(`\norders never carried out (${never.length} of ${NAMES.length}):`); for (const n of never) { const t = tally[n]; console.log(`  ${n} (${t ? t.no : 0} tries): ${t ? Object.entries(t.why).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([m, k]) => `${k}x ${m}`).join(' | ') : 'never tried'}`); } }
console.log(`\n${orders} orders given, ${done} carried out; ${failures.size} kinds of failure:`);
for (const [k, f] of [...failures].sort((a, b) => a[0].localeCompare(b[0]))) { console.log(`\n[${f.n}x] ${k}`); console.log(`   ${String(f.detail ?? '').split('\n').slice(0, 5).join('\n   ').slice(0, 700)}`); console.log(`   first: ${JSON.stringify(f.ctx).slice(0, 600)}`); }
