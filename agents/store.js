import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fold, matches, logFromEntries } from './ledger.js';

const SEGMENT = 100, CACHE = 12;
export const FULL_WINDOW = 40, YEARLY_WINDOW = 400;

// Yakın geçmişin her turu, sonra yılda bir, sonra beş yılda bir dünya kopyası tutulur. Defter hiç seyreltilmez.
export function keepSnapshot(t, last) {
  const age = last - t;
  return t === 0 || age <= FULL_WINDOW || (age <= YEARLY_WINDOW ? t % 4 === 0 : t % 20 === 0);
}

const pad = n => String(n).padStart(6, '0');

export class Store {
  constructor(dir) {
    this.dir = dir; this.cache = new Map();
    for (const d of ['turns', 'ledger']) fs.mkdirSync(path.join(dir, d), { recursive: true });
    this.turns = fs.readdirSync(path.join(dir, 'turns')).filter(x => x.endsWith('.json.gz')).map(x => parseInt(x.slice(2, 8), 10)).sort((a, b) => a - b);
  }
  file(n) { return path.join(this.dir, n); }
  turnFile(t) { return path.join(this.dir, 'turns', `t-${pad(t)}.json.gz`); }
  exists() { return fs.existsSync(this.file('world.json')); }
  loadWorld() { return JSON.parse(fs.readFileSync(this.file('world.json'), 'utf8')); }
  atomic(f, data) { const tmp = `${f}.tmp`; fs.writeFileSync(tmp, data); fs.renameSync(tmp, f); }
  saveMap(w) { this.atomic(this.file('map.json'), JSON.stringify(w.map)); }

  commit(w, entries = []) {
    const { map, ...lean } = w, t = w.turn;
    this.writeTurnEntries(t, entries);
    this.updatePeople(w, entries);
    this.atomic(this.turnFile(t), zlib.gzipSync(JSON.stringify({ world: lean })));
    if (this.turns.at(-1) !== t) this.turns.push(t);
    const n = w.newsThisTurn || [], kind = n.some(x => x.kind === 'komplo' && !x.secret) ? 'komplo' : n.some(x => x.kind === 'savas') ? 'savas' : null;
    if (kind) { const m = this.marks(); m[t] = kind; this.atomic(this.file('marks.json'), JSON.stringify(m)); }
    this.atomic(this.file('world.json'), JSON.stringify(w));
    this.thin(t);
    this.compact(t);
  }

  // Yaşı pencereyi yeni aşan iki turu kontrol etmek yeter; her commit sabit iş yapar.
  thin(last) {
    for (const t of [last - FULL_WINDOW - 1, last - YEARLY_WINDOW - 1]) {
      if (t < 0 || keepSnapshot(t, last)) continue;
      fs.rmSync(this.turnFile(t), { force: true });
      const i = this.turns.indexOf(t);
      if (i >= 0) this.turns.splice(i, 1);
    }
  }

  marks() { try { return JSON.parse(fs.readFileSync(this.file('marks.json'), 'utf8')); } catch { return {}; } }
  lastTurn() { return this.turns.at(-1) ?? -1; }
  nearestSnapshot(t) {
    let best = null;
    for (const x of this.turns) { if (x > t) { best ??= x; break; } best = x; }
    return best;
  }
  readTurn(t) {
    const s = this.nearestSnapshot(t);
    if (s === null || t > this.lastTurn() || t < 0) return null;
    const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(this.turnFile(s))).toString('utf8'));
    d.log ||= logFromEntries(this.entriesOfTurn(t));
    d.turn = t; d.snapshotTurn = s;
    return JSON.stringify(d);
  }
  readMap() { return fs.readFileSync(this.file('map.json'), 'utf8'); }
  savePending(p) { this.atomic(this.file('pending.json'), JSON.stringify(p)); }
  loadPending(turn) { try { const p = JSON.parse(fs.readFileSync(this.file('pending.json'), 'utf8')); return p.turn === turn ? p : null; } catch { return null; } }
  clearPending() { try { fs.unlinkSync(this.file('pending.json')); } catch {} }

  // Defter: her tur kendi dosyasına yazılır, aynı tur tekrar oynanırsa üzerine yazar. 100 tur dolunca tek segmente birleşir.
  ledgerFile(n) { return path.join(this.dir, 'ledger', n); }
  writeTurnEntries(t, entries) {
    const name = `t-${pad(t)}.ndjson.gz`;
    this.atomic(this.ledgerFile(name), zlib.gzipSync(entries.map(e => JSON.stringify(e)).join('\n')));
    this.cache.delete(name);
  }
  sources() {
    const names = fs.readdirSync(path.join(this.dir, 'ledger')).filter(x => x.endsWith('.ndjson.gz'));
    const segs = names.filter(x => x.startsWith('s-')).map(name => { const from = parseInt(name.slice(2, 8), 10); return { name, from, to: from + SEGMENT - 1 }; });
    const covered = t => segs.some(s => t >= s.from && t <= s.to);
    const single = names.filter(x => x.startsWith('t-')).map(name => { const t = parseInt(name.slice(2, 8), 10); return { name, from: t, to: t }; }).filter(s => !covered(s.from));
    return [...segs, ...single].sort((a, b) => a.from - b.from);
  }
  entriesOf(name) {
    let list = this.cache.get(name);
    if (!list) {
      const raw = zlib.gunzipSync(fs.readFileSync(this.ledgerFile(name))).toString('utf8');
      list = raw ? raw.split('\n').map(l => JSON.parse(l)) : [];
    } else this.cache.delete(name);
    this.cache.set(name, list);
    if (this.cache.size > CACHE) this.cache.delete(this.cache.keys().next().value);
    return list;
  }
  entriesOfTurn(t) { const src = this.sources().find(s => t >= s.from && t <= s.to); return src ? this.entriesOf(src.name).filter(e => e.t === t) : []; }
  compact(last) {
    const end = Math.floor((last + 1) / SEGMENT) * SEGMENT;
    if (end === 0 || (last + 1) % SEGMENT !== 0) return;
    const from = end - SEGMENT, name = `s-${pad(from)}.ndjson.gz`, parts = this.sources().filter(s => s.from >= from && s.to < end && s.name.startsWith('t-'));
    if (!parts.length) return;
    const body = parts.flatMap(s => this.entriesOf(s.name)).map(e => JSON.stringify(e)).join('\n');
    this.atomic(this.ledgerFile(name), zlib.gzipSync(body));
    for (const s of parts) { fs.rmSync(this.ledgerFile(s.name), { force: true }); this.cache.delete(s.name); }
  }

  // Yeniden eskiye tarar, limit dolunca durur; imleçle sayfalanır.
  queryLedger(o = {}) {
    const limit = Math.max(1, Math.min(500, o.limit || 100)), f = { ...o, words: fold(o.q ?? '').split(/\s+/).filter(Boolean) }, items = [];
    const [ct, ci] = o.cursor ? o.cursor.split('-').map(Number) : [Infinity, Infinity];
    for (const s of this.sources().reverse()) {
      if (s.from > ct || (f.to != null && s.from > f.to) || (f.turn != null && (s.from > f.turn || s.to < f.turn))) continue;
      if ((f.from != null && s.to < f.from)) break;
      const list = this.entriesOf(s.name);
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        if (e.t > ct || (e.t === ct && e.i >= ci) || !matches(e, f)) continue;
        items.push(e);
        if (items.length > limit) return { items: items.slice(0, limit), next: items[limit - 1].id };
      }
    }
    return { items, next: null };
  }

  loadSessions() { try { return JSON.parse(fs.readFileSync(this.file('sessions.json'), 'utf8')); } catch { return {}; } }
  saveSessions(s) { this.atomic(this.file('sessions.json'), JSON.stringify(s)); }
  saveUsage(u) { fs.appendFileSync(this.file('usage.ndjson'), `${JSON.stringify(u)}\n`); this.usage = u; }
  lastUsage() {
    if (this.usage) return this.usage;
    try { return this.usage = JSON.parse(fs.readFileSync(this.file('usage.ndjson'), 'utf8').trim().split('\n').at(-1)); } catch { return null; }
  }

  people() { try { return JSON.parse(fs.readFileSync(this.file('people.json'), 'utf8')); } catch { return {}; } }
  updatePeople(w, entries) {
    const all = this.people(), counts = {};
    for (const e of entries) for (const id of e.a || []) counts[id] = (counts[id] || 0) + 1;
    for (const ch of Object.values(w.characters)) all[ch.id] = { id: ch.id, name: ch.name, role: ch.role, country: ch.country, countryName: w.countries[ch.country]?.name ?? all[ch.id]?.countryName ?? '', alive: ch.alive, status: ch.status, ai: !!ch.aiControlled, first: all[ch.id]?.first ?? w.turn, last: w.turn, events: (all[ch.id]?.events ?? 0) + (counts[ch.id] || 0) };
    for (const id of Object.keys(counts)) if (!w.characters[id] && all[id]) { all[id].events += counts[id]; all[id].last = w.turn; }
    this.atomic(this.file('people.json'), JSON.stringify(all));
  }
}
