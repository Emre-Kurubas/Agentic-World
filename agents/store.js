import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export class Store {
  constructor(dir) { this.dir = dir; fs.mkdirSync(path.join(dir, 'turns'), { recursive: true }); }
  file(n) { return path.join(this.dir, n); }
  turnFile(t) { return path.join(this.dir, 'turns', `t-${String(t).padStart(6, '0')}.json.gz`); }
  exists() { return fs.existsSync(this.file('world.json')); }
  loadWorld() { return JSON.parse(fs.readFileSync(this.file('world.json'), 'utf8')); }
  atomic(f, data) { const tmp = `${f}.tmp`; fs.writeFileSync(tmp, data); fs.renameSync(tmp, f); }
  saveMap(w) { this.atomic(this.file('map.json'), JSON.stringify(w.map)); }
  commit(w, log) {
    const { map, ...lean } = w;
    this.atomic(this.turnFile(w.turn), zlib.gzipSync(JSON.stringify({ world: lean, log })));
    const n = w.newsThisTurn || [], kind = n.some(x => x.kind === 'komplo' && !x.secret) ? 'komplo' : n.some(x => x.kind === 'savas') ? 'savas' : null;
    if (kind) { const m = this.marks(); m[w.turn] = kind; this.atomic(this.file('marks.json'), JSON.stringify(m)); }
    this.atomic(this.file('world.json'), JSON.stringify(w));
  }
  marks() { try { return JSON.parse(fs.readFileSync(this.file('marks.json'), 'utf8')); } catch { return {}; } }
  lastTurn() {
    const f = fs.readdirSync(path.join(this.dir, 'turns')).filter(x => x.endsWith('.json.gz')).sort();
    return f.length ? parseInt(f.at(-1).slice(2, 8), 10) : -1;
  }
  readTurn(t) { const f = this.turnFile(t); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8') : null; }
  readMap() { return fs.readFileSync(this.file('map.json'), 'utf8'); }
  savePending(p) { this.atomic(this.file('pending.json'), JSON.stringify(p)); }
  loadPending(turn) { try { const p = JSON.parse(fs.readFileSync(this.file('pending.json'), 'utf8')); return p.turn === turn ? p : null; } catch { return null; } }
  clearPending() { try { fs.unlinkSync(this.file('pending.json')); } catch {} }
}
