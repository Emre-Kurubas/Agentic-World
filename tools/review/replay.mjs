import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const root = pathToFileURL(process.argv[2] + '/').href, D = process.argv[3], SNAP = process.argv[4] || '6', UNIT = process.argv[5] || 'B10';
const { applyOp, carryList } = await import(root + 'engine/ops.js'); const { beginTurn, stepWorld } = await import(root + 'engine/step.js');
const j = JSON.parse(zlib.gunzipSync(fs.readFileSync(D + '/turns/t-' + SNAP.padStart(6, '0') + '.json.gz')).toString()), w = j.world ?? j;
const E = []; for (const f of fs.readdirSync(path.join(D, 'ledger')).sort()) { const raw = f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(path.join(D, 'ledger', f))).toString() : fs.readFileSync(path.join(D, 'ledger', f), 'utf8'); for (const line of raw.split('\n')) if (line.trim()) { const x = JSON.parse(line); if (x.t === +SNAP + 1 && x.k === 'ruling') E.push(x); } }
const show = t => { const u = w.units[UNIT]; console.log(t, JSON.stringify({ prov: u.province, target: u.target, digAt: u.digAt, posture: u.posture, marchSince: u.marchSince })); };
beginTurn(w);
for (const x of E) { const ch = w.characters[x.a?.[0]]; if (!ch) continue; const ops = x.x?.ops || []; if (!ops.length) continue; try { carryList(w, ch, ops, plain => applyOp(w, ch, plain)); } catch (e) { console.log('throw', e.message); } }
show('before the quarter');
w.units[UNIT] = new Proxy(w.units[UNIT], {
  deleteProperty(t, k) { if (k === 'digAt' && t.digAt) console.log('DELETE digAt', JSON.stringify({ prov: t.province, target: t.target, posture: t.posture }), new Error().stack.split('\n').slice(2, 5).map(s => s.trim()).join(' | ')); delete t[k]; return true; },
  set(t, k, v) { if (k === 'target' || k === 'posture' || k === 'province') console.log('SET', k, v, new Error().stack.split('\n')[2].trim().slice(0, 130)); t[k] = v; return true; } });
stepWorld(w); show('after the quarter');
