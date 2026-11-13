// A check-up of a running or finished game: the state of the world, numbers that are not numbers, and what the ledger says of a span of turns
// (operations carried out and refused, war and sea orders with the engine's answers, decisions that produced no operation, lookups, staff
// reports, battles, news of note, engine notes, the log and the usage). It reads the save and changes nothing.
// node tools/checkup.js <save dir> <from turn> <to turn> [log file]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
const [dir, fromArg, toArg, logFile] = process.argv.slice(2), from = +fromArg || 0, to = +toArg || 999;
const w = JSON.parse(fs.readFileSync(path.join(dir, 'world.json'), 'utf8'));
const r1 = v => Math.round(v * 10) / 10, cs = Object.values(w.countries).filter(c => c.alive), nm = id => w.countries[id]?.name?.split(' ').at(-1) ?? id;
console.log(`== WORLD at turn ${w.turn} (${w.date}); status ${w.status}; ${cs.length} powers; wars: ${w.wars.filter(x => x.active).map(x => `${x.a.map(nm)} v ${x.b.map(nm)} since t${x.start}`).join('; ') || 'none'}; freight ${r1((w.freight || 0) * 100)}%; mines ${JSON.stringify(w.mines || {})}; seizures ${(w.seizures || []).length}`);
for (const c of cs) {
  const us = Object.values(w.units).filter(u => u.country === c.id), fs_ = Object.values(w.fleets).filter(f => f.country === c.id), men = us.reduce((a, u) => a + u.men, 0);
  console.log(`${c.id} ${c.name} [${c.archetype}] legit ${Math.round(c.legitimacy)} unrest ${Math.round(c.unrest ?? 0)} treasury ${Math.round(c.treasury)} debt ${Math.round(c.debt / Math.max(c.gdp * 4, 1) * 100)}% gold ${Math.round(c.reserves)} food ${Math.round((c.foodRatio ?? 1) * 100)} infl ${r1((c.inflation || 0) * 100)}% | army ${Math.round(men)}k in ${us.length} units (${us.filter(u => u.kind === 'cavalry').length} cav, ${us.filter(u => u.kind === 'artillery').length} art) funded ${r1(c.militaryFunding ?? 1)} arms ${Math.round(c.stock.arms)} shot ${r1(c._shot || 0)} sick ${r1(c._sick || 0)} reserve ${Math.round(c.reserve || 0)} exhaustion ${Math.round(c.warExhaustion || 0)} | coal ${Math.round(c.stock.coal)} navyCoal ${r1(c._navyCoal || 0)} tonnage ${r1(c.shipping ?? -1)} freight +${r1(c._freightIn || 0)}/-${r1(c._freightOut || 0)} | plans ${Object.keys(c.plans || {}).map(nm).join(',') || '-'} stolen ${Object.keys(c.stolen || {}).map(nm).join(',') || '-'}`);
  console.log(`   fleets: ${fs_.map(f => `${f.id} ${r1(f.ships)} ${f.kind ?? '?'}${f.damaged ? `+${r1(f.damaged)}dmg` : ''} ${f.port ? `port ${f.port}` : `SEA ${f.sea}`}${f.target ? `->${f.target}` : ''} coal ${Math.round((f.coaled ?? 1) * 100)} mor ${Math.round(f.morale)}${f.orders ? ` [${f.orders}]` : ''}${f.mutiny ? ' MUTINY' : ''}`).join('; ') || 'none'}`);
  const odd = us.filter(u => u.attack || u.posture || u.holdFire || u.target || u.quality > 1.05 || u.quality < .95 || u.morale < 45);
  if (odd.length) console.log(`   units of note: ${odd.map(u => `${u.id} ${u.kind[0]}${Math.round(u.men)}@${u.province}${u.target ? `->${u.target}` : ''}${u.attack ? ` ATTACK ${u.attack.to} ${u.attack.manner}${u.attack.shelling ? '+guns' : ''} since t${u.attack.since}` : ''}${u.posture ? ` ${u.posture}` : ''}${u.holdFire ? ' hold' : ''} q${r1(u.quality)} m${Math.round(u.morale)}`).join('; ')}`);
}
// Numbers that are not numbers.
const bad = [], scan = (o, where, keys) => { for (const k of keys) { const v = o[k]; if (v === null || (typeof v === 'number' && !Number.isFinite(v))) bad.push(`${where}.${k}=${v}`); } };
for (const c of Object.values(w.countries)) { scan(c, c.id, ['treasury', 'debt', 'reserves', 'gdp', 'realGdp', 'legitimacy', 'unrest', 'inflation', 'militaryFunding', 'warExhaustion', 'shipping', 'priceLevel', 'rate', 'reserve', 'cells']); for (const g of Object.keys(c.stock || {})) if (c.stock[g] === null || !Number.isFinite(c.stock[g]) || c.stock[g] < -1e-6) bad.push(`${c.id}.stock.${g}=${c.stock[g]}`); }
for (const u of Object.values(w.units)) { scan(u, u.id, ['men', 'morale', 'quality', 'equip', 'loyalty']); if (!w.provinces[u.province]) bad.push(`${u.id} in no province`); }
for (const f of Object.values(w.fleets)) { scan(f, f.id, ['ships', 'morale', 'quality']); if (!w.seas[f.sea]) bad.push(`${f.id} in no sea`); if (f.port && !w.provinces[f.port]) bad.push(`${f.id} in no harbour`); if (f.coaled === null) bad.push(`${f.id}.coaled=null`); }
for (const p of Object.values(w.provinces)) scan(p, p.id, ['unrest', 'devastation', 'infra', 'rail', 'fertility']);
if (typeof w.freight === 'number' && !Number.isFinite(w.freight)) bad.push('w.freight');
console.log(`== BAD NUMBERS: ${bad.length ? bad.slice(0, 30).join(', ') : 'none'}`);
// The ledger.
const ldir = path.join(dir, 'ledger'), entries = [];
for (const name of fs.existsSync(ldir) ? fs.readdirSync(ldir).filter(x => x.endsWith('.ndjson.gz')).sort() : []) for (const line of zlib.gunzipSync(fs.readFileSync(path.join(ldir, name))).toString('utf8').split('\n')) { if (!line.trim()) continue; try { const e = JSON.parse(line); if ((e.t ?? 0) >= from && (e.t ?? 0) <= to) entries.push(e); } catch {} }
const by = {}; for (const e of entries) by[e.k] = (by[e.k] || 0) + 1;
console.log(`== LEDGER turns ${from}-${to}: ${entries.length} entries: ${Object.entries(by).map(([k, n]) => `${k} ${n}`).join(', ')}`);
// Who woke and had nothing ruled on. A seat that thinks every quarter and is never ruled on is giving orders that are being lost somewhere
// between its answer and the referee. (World 16: an empty list of decisions in a reply wiped 446 orders in seventeen quarters, a declaration
// of war among them, and nothing in this report showed it; the president's inner voice did: "every order I gave seems to have dissolved".)
{ const woke = {}, ruled = {}; for (const e of entries) { const a = e.a?.[0]; if (!a) continue; if (e.k === 'thought' && e.s === 'agent') (woke[a] ||= new Set()).add(e.t); if (e.k === 'ruling') (ruled[a] ||= new Set()).add(e.t); }
  const idle = Object.entries(woke).map(([a, ts]) => ({ ch: w.characters[a], none: [...ts].filter(t => !ruled[a]?.has(t)), n: ts.size })).filter(x => x.none.length).sort((a, b) => b.none.length - a.none.length);
  console.log(`== WOKE AND HAD NO RULING (${idle.length} characters; one or two quiet quarters are ordinary, a run of them means orders are being lost):`);
  for (const x of idle) console.log(`  ${x.ch?.name}/${nm(x.ch?.country)} ${x.ch?.model ?? ''} ${x.ch?.role}: ${x.none.length} of ${x.n} turns (t${x.none.join(', t')})`); }
const ops = {}, refused = [], empty = [];
for (const e of entries.filter(e => e.k === 'ruling' || e.k === 'rule')) {
  const list = e.x?.ops || [], res = e.x?.results || [];
  list.forEach((op, i) => { const o = (ops[op.op] ||= { ok: 0, no: 0, ai: 0 }); if (res[i]?.ok === false) { o.no++; refused.push({ t: e.t, who: `${e.n}/${e.r}`, op, msg: res[i].msg, src: e.k }); } else o.ok++; if (e.k === 'ruling') o.ai++; });
  if (e.k === 'ruling' && !list.length && /attack|offensive|assault|fleet|squadron|ships|navy|blockade|march|army|troops|mobili[sz]|shell|mines|harbour|landing/i.test(e.x?.decisionText || '')) empty.push({ t: e.t, who: `${e.n}/${e.r}`, d: e.x.decisionText, n: e.x.narrative });
}
console.log('== OPERATIONS (ok/refused, of which from AI rulings): ' + Object.entries(ops).sort((a, b) => (b[1].ok + b[1].no) - (a[1].ok + a[1].no)).map(([k, o]) => `${k} ${o.ok}/${o.no}${o.ai ? `(${o.ai})` : ''}`).join(', '));
const WAR = new Set(['offensive', 'move', 'move_army', 'set_posture', 'move_fleet', 'fleet_orders', 'bombard', 'lay_mines', 'amphibious', 'build_ship', 'recruit', 'prepare_plan', 'leak_plan', 'demonstrate', 'seize_customs', 'appoint_commander', 'merge_units', 'merge_fleets', 'mobilize', 'declare_war', 'disband', 'build']);
const seen = fs.existsSync(logFile ?? '') ? fs.readFileSync(logFile, 'utf8') : '';
console.log(`== WAR AND SEA ORDERS (${Object.entries(ops).filter(([k]) => WAR.has(k)).map(([k, o]) => `${k} ${o.ok}/${o.no}`).join(', ') || 'none'})`);
for (const e of entries.filter(e => e.k === 'ruling')) { const list = e.x?.ops || [], res = e.x?.results || []; list.forEach((op, i) => { if (['offensive', 'move_fleet', 'fleet_orders', 'bombard', 'lay_mines', 'amphibious', 'prepare_plan', 'leak_plan', 'demonstrate', 'seize_customs', 'build_ship'].includes(op.op)) console.log(`  t${e.t} ${e.n}/${e.r}: ${JSON.stringify(op)} -> ${res[i]?.ok === false ? 'REFUSED ' : ''}${String(res[i]?.msg ?? '').slice(0, 230)}`); }); }
console.log(`== REFUSED (${refused.length}); by message:`);
const groups = {}; for (const r of refused) { const k = `${r.op.op}: ${String(r.msg).replace(/[A-Z]\d+/g, '#').replace(/\d+(\.\d+)?/g, 'N').slice(0, 110)}`; (groups[k] ||= []).push(r); }
for (const [k, list] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length).slice(0, 28)) console.log(`  ${list.length}x ${k}${WAR.has(list[0].op.op) ? `   e.g. t${list[0].t} ${list[0].who} ${JSON.stringify(list[0].op).slice(0, 160)} -> ${String(list[0].msg).slice(0, 200)}` : ''}`);
console.log(`== RULINGS WITH NO OPERATION on a war or sea decision (${empty.length}):`);
for (const x of empty.slice(0, 12)) console.log(`  t${x.t} ${x.who}: "${String(x.d).slice(0, 200)}" => ${String(x.n).slice(0, 220)}`);
const q = {}; for (const e of entries.filter(e => e.k === 'query')) { const k = String(e.q).split(':')[0]; q[k] = (q[k] || 0) + 1; }
console.log('== LOOKUPS: ' + Object.entries(q).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', '));
const staff = entries.filter(e => e.k === 'notice' && /^\[(General Staff|Naval Staff|Intelligence)\]/.test(e.text));
console.log(`== STAFF REPORTS (${staff.length}):`); for (const e of staff.slice(0, 14)) console.log(`  t${e.t} to ${e.n}/${e.r}: ${e.text.slice(0, 330)}`);
console.log(`== BATTLES: ${entries.filter(e => e.k === 'battle').map(e => `t${e.t} ${e.text.slice(0, 260)}`).join('\n   ') || 'none'}`);
const hot = entries.filter(e => e.k === 'news' && /war|mutin|blockade|squadron|shelled|mine|siege|captured|ultimatum|mobilis|coup|rising|civil war|customs house|plan/i.test(e.text));
console.log(`== NEWS OF NOTE (${hot.length}):`); for (const e of hot.slice(0, 30)) console.log(`  t${e.t} ${e.text.slice(0, 220)}`);
const sys = entries.filter(e => e.k === 'system'); if (sys.length) { console.log(`== SYSTEM NOTES (${sys.length}):`); const g = {}; for (const e of sys) { const k = e.text.replace(/\d+/g, 'N').slice(0, 120); g[k] = (g[k] || 0) + 1; } for (const [k, n] of Object.entries(g).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${n}x ${k}`); }
// Characters played by the rule-based fallback, or quarters with no referee: the game went on without the people who play it. (World 22:
// three quarters were played that way while the service refused every call, and the checkup's summary did not say so.)
if (seen) { const lines = seen.split('\n'), fell = lines.filter(l => /fell back to rules/.test(l)).length, mute = lines.filter(l => /No referee reply/.test(l)).length; if (fell || mute) console.log(`== !!! PLAYED WITHOUT ITS PLAYERS: ${fell} character-mornings fell back to rules and ${mute} referee calls got no reply in this log. Those quarters are not the characters' doing: roll the save back to the last quarter that was really played.`); }
if (seen) { const lines = seen.split('\n'), errs = lines.filter(l => /Error|TypeError|ReferenceError|Unhandled|ECONN|at file:|limit/i.test(l)); console.log(`== LOG: ${lines.length} lines; turn lines: ${lines.filter(l => / turn t\d+/.test(l)).map(l => l.slice(0, 8) + l.match(/t\d+/)[0]).slice(-8).join(' ')}; suspicious lines ${errs.length}`); for (const l of errs.slice(0, 12)) console.log('  ' + l.slice(0, 260)); }
try { const u = fs.readFileSync(path.join(dir, 'usage.ndjson'), 'utf8').trim().split('\n').map(l => JSON.parse(l)); console.log(`== USAGE last turns: ${u.slice(-4).map(x => JSON.stringify(x).slice(0, 230)).join(' | ')}`); } catch {}
