// Order drill. The seam between a character and the world is a sentence: he writes what he wants in his own words, the referee turns it
// into operations, the engine carries them out and answers. A game finds the faults of that seam slowly and at the characters' expense
// (world 25: a relief ordered as an "attack" was refused and a fortress fell). This drill finds them without a game:
//   1. situations are staged in the world the next game will be played in (tools/drill/scenes.mjs): a fortress shut in, an open front,
//      a fleet in harbour, a paper on the table;
//   2. for each thing a seat might want there, a writer who knows nothing of the engine's operations (Sonnet) words the order several
//      ways, as a person of the age would dictate it (kept in tools/drill/orders.json, so that the same orders are drilled again);
//   3. the game's own referee prompt and model turn each order into operations, and they are applied to a copy of the staged world as
//      a ruling is applied in a game;
//   4. a check written for that intention looks at the world: did what was wanted happen?
// Run from the repository:  node tools/drill.mjs . [scene ids, comma-separated | all] [variants=3] [--rewrite]
//   --rewrite has the writer word the orders afresh; without it the orders on file are used and only missing ones are written.
// The report lists every order that did not do what it meant, with the operations the referee wrote and the engine's answers.
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
const repo = fs.realpathSync(process.argv[2] || '.'), root = pathToFileURL(repo + '/').href, want = (process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'all').split(','), N = +process.argv[4] || 3, rewrite = process.argv.includes('--rewrite');
const { createWorld } = await import(root + 'engine/world.js');
const { beginTurn, stepWorld } = await import(root + 'engine/step.js');
const { refereePrompt } = await import(root + 'agents/prompts.js');
const { makeBackend } = await import(root + 'agents/backend.js');
const { Game } = await import(root + 'agents/game.js');
const { SCENES: S1 } = await import(root + 'tools/drill/scenes.mjs'); const { SCENES2 } = await import(root + 'tools/drill/scenes2.mjs'); const SCENES = [...S1, ...SCENES2];
// Each order is put to the referee alone (the default): orders that pull against one another in one morning's list are settled by the referee
// among themselves, which is right in a game and muddles a drill. --together puts a scene's orders in one list, as one morning.
const together = process.argv.includes('--together');
const cfg = JSON.parse(fs.readFileSync(path.join(repo, 'config.json'), 'utf8')), backend = makeBackend({ ...cfg, backend: 'claude' });
const file = path.join(repo, 'tools/drill/orders.json'), bank = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const pool = async (items, n, fn) => { const out = []; let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; };

function stage(scene) { const w = createWorld({ ...cfg, agentRoles: [], countryAgentRoles: {}, models: {} }); for (let i = 0; i < (scene.after ?? 1); i++) { beginTurn(w); stepWorld(w); } beginTurn(w); const x = scene.build(w); return { w, x }; }

// The writer: a person in that seat, who knows his situation and nothing of the engine.
async function word(scene, st) {
  const ch = st.w.characters[st.x.actor], c = st.w.countries[ch.country], have = bank[scene.id] ||= {}, asks = scene.intents.flatMap(it => [it, ...(it.next ? [{ id: `${it.id}+`, want: it.next }] : [])]), missing = asks.filter(it => rewrite || (have[it.id] || []).length < N);
  if (!missing.length) return;
  const prompt = `You are helping to test a historical simulation of a fictional world around 1900. You write as ${ch.name}, ${scene.seat === 'leader' ? 'who governs' : scene.seat === 'general' ? 'chief of the general staff of' : scene.seat === 'opposition' ? 'leader of the opposition in' : 'the richest owner of works in'} ${c.name}.

Your situation this morning:
${scene.about(st.w, st.x)}

For each numbered intention below, write the order as you would dictate it to your office: one to three plain sentences, in the voice of a ${scene.seat === 'leader' ? 'ruler' : scene.seat === 'general' ? 'general' : scene.seat === 'opposition' ? 'party leader' : 'magnate'} of that age. Name troops, ships, persons, papers and places as they are named above (name and number). Write as a person writes: do not use keywords, field names or the vocabulary of any software. Give ${N} wordings of each, as different people would put the same wish: one terse, one fuller, one using other verbs than the obvious one (for example "relieve", "fall on", "march in", "go to the help of" where another would say "attack"). Each wording must stand alone and mean the same thing.

Intentions:
${missing.map((it, i) => `${i + 1}. ${it.want(st.w, st.x)}`).join('\n')}

Return only JSON: {"1": ["...", "...", "..."], "2": [...], ...}`;
  const r = await backend.ask(prompt, 'sonnet'); missing.forEach((it, i) => { const got = (r?.[String(i + 1)] || []).map(String).filter(Boolean).slice(0, N); if (got.length) have[it.id] = got; });
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(bank, null, 1));
}

const report = [];
const rule = async (w, c, entries) => { const r = await backend.ask(refereePrompt(w, c, entries), cfg.models.referee); return (Array.isArray(r?.rulings) ? r.rulings : []).filter(h => h && typeof h === 'object'); };
const carry = (g, actor, h, text) => { const ops = Array.isArray(h.operations) ? h.operations.slice(0, 16) : []; let rec; try { rec = g.applyRuling(actor, { narrative: String(h.narrative || ''), note: String(h.note || ''), prob: Number.isFinite(Number(h.probability ?? 1)) ? Math.max(0, Math.min(1, Number(h.probability ?? 1))) : 1, public: !!h.public, ops, decision: Number(h.decision) || 0, decisionText: text, source: 'referee' }); } catch (e) { rec = { crash: e.message }; }
  return { ops, note: h.note, results: rec?.results ?? [], crash: rec?.crash }; };
function judge(scene, it, v, w, copy, x, out, order, unruled) {
  const ops = out.flatMap(o => o.ops || []), results = out.flatMap(o => o.results || []), done = (name, pred = () => true) => ops.some((o, k) => o?.op === name && pred(o) && results[k]?.ok !== false && !results[k]?.skipped);
  let verdict; try { verdict = it.check({ w: copy, w0: w, x, ops, results, done }); } catch (e) { verdict = { ok: false, why: `the check threw: ${e.message}` }; }
  if (verdict === true) verdict = { ok: true }; if (verdict === false) verdict = { ok: false, why: 'the world does not show what was wanted' };
  report.push({ scene: scene.id, intent: it.id, v, soft: !!it.soft, ok: !!verdict.ok, why: verdict.why ?? '', order, unruled, ops, answers: results.map(z => `${z?.ok === false ? 'NO' : z?.waits ? 'WAITS' : z?.skipped ? 'SKIPPED' : 'ok'}: ${String(z?.msg ?? '').slice(0, 500)}`), notes: out.map(o => o.note).filter(Boolean), crash: out.map(o => o.crash).filter(Boolean) });
}
async function drill(scene, st, v, one = null) {
  const { w, x } = st, ch = w.characters[x.actor], c = w.countries[ch.country], its = scene.intents.filter(it => bank[scene.id]?.[it.id]?.[v] && (!one || it.id === one));
  if (!its.length) return;
  try {
    if (!one) { // One morning's list from one seat.
      const decisions = its.map(it => bank[scene.id][it.id][v]), rulings = await rule(w, c, [{ actor: ch, decisions }]);
      its.forEach((it, i) => { const mine = rulings.filter(h => Number(h.decision) === i), copy = structuredClone(w), g = new Game({ world: copy, cfg, backend: { kind: 'mock' }, store: null }), out = mine.map(h => carry(g, copy.characters[ch.id], h, decisions[i]));
        for (let k = 0; k < (it.step ?? 0); k++) { if (k) beginTurn(copy); stepWorld(copy); } judge(scene, it, v, w, copy, x, out, decisions[i], !mine.length); });
      return;
    }
    // One order alone; from two seats in the same morning (both); or followed by its confirmation a quarter later (next).
    const it = its[0], text = bank[scene.id][it.id][v], other = it.both ? w.characters[ch.id === c.leader ? c.general : c.leader] : null, text2 = other ? bank[scene.id][it.id][(v + 1) % N] ?? text : null;
    const rulings = await rule(w, c, [{ actor: ch, decisions: [text] }, ...(other ? [{ actor: other, decisions: [text2] }] : [])]);
    const copy = structuredClone(w), g = new Game({ world: copy, cfg, backend: { kind: 'mock' }, store: null }), out = []; let unruled = !rulings.length;
    for (const [who, t] of [[ch, text], [other, text2]]) if (who) for (const h of rulings.filter(h => (h.actor ?? ch.id) === who.id)) out.push(carry(g, copy.characters[who.id], h, t));
    let later = '';
    if (it.next) { stepWorld(copy); beginTurn(copy); later = bank[scene.id][`${it.id}+`]?.[v] ?? ''; if (later) { const r2 = await rule(copy, copy.countries[c.id], [{ actor: copy.characters[ch.id], decisions: [later] }]); if (!r2.length) unruled = true; for (const h of r2) out.push(carry(g, copy.characters[ch.id], h, later)); } }
    for (let k = 0; k < (it.step ?? 0); k++) { if (k) beginTurn(copy); stepWorld(copy); }
    judge(scene, it, v, w, copy, x, out, `${text}${text2 ? `  ||  (the other seat, the same morning) ${text2}` : ''}${later ? `  >>  (next quarter) ${later}` : ''}`, unruled);
  } catch (e) { report.push({ scene: scene.id, v, error: `${one ?? 'list'}: ${e.message}` }); }
}

const scenes = SCENES.filter(s => want.includes('all') || want.includes(s.id)), staged = scenes.map(s => ({ s, st: stage(s) }));
await pool(staged, 4, ({ s, st }) => word(s, st));
const only = (process.argv.find(a => a.startsWith('--intents=')) || '').slice(10).split(',').filter(Boolean);
const jobs = staged.flatMap(({ s, st }) => Array.from({ length: N }, (_, v) => together ? [{ s, st, v }] : s.intents.filter(it => !only.length || only.includes(it.id) || only.includes(`${s.id}/${it.id}`)).map(it => ({ s, st, v, one: it.id }))).flat());
const t0 = Date.now(); await pool(jobs, cfg.concurrency ?? 4, ({ s, st, v, one }) => drill(s, st, v, one));
const outFile = path.join(repo, 'tools/drill/last-report.json'); fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
const all = report.filter(r => r.intent), bad = all.filter(r => !r.ok && !r.soft), soft = all.filter(r => !r.ok && r.soft);
console.log(`${all.length} orders drilled in ${scenes.length} situations (${Math.round((Date.now() - t0) / 1000)}s): ${all.filter(r => r.ok).length} did what they meant, ${bad.length} did not, ${soft.length} of the hard kind (conditional and the like) did not. ${report.filter(r => r.error).map(r => `[${r.scene} v${r.v}: ${r.error}]`).join(' ')}`);
const byIntent = {}; for (const r of all) (byIntent[`${r.scene}/${r.intent}`] ||= []).push(r);
for (const [k, rs] of Object.entries(byIntent)) console.log(`  ${rs.every(r => r.ok) ? 'ok  ' : rs.some(r => r.ok) ? 'SOME' : 'NONE'} ${k}${rs[0].soft ? ' (hard kind)' : ''}: ${rs.filter(r => r.ok).length}/${rs.length}`);
for (const r of [...bad, ...soft]) { console.log(`\n--- ${r.scene}/${r.intent} v${r.v}${r.soft ? ' (hard kind)' : ''}: ${r.why}`); console.log(`  ORDER: ${r.order}`); console.log(`  ${r.unruled ? 'THE REFEREE GAVE NO RULING' : `OPS: ${JSON.stringify(r.ops).slice(0, 700)}`}`); for (const a of r.answers) console.log(`  ${a.slice(0, 420)}`); for (const n of r.notes) console.log(`  NOTE: ${String(n).slice(0, 300)}`); for (const cr of r.crash) console.log(`  CRASH: ${cr}`); }
console.log(`\nfull report: ${outFile}`);
