#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createWorld, ROLES } from './engine/world.js';
import { Store } from './agents/store.js';
import { Game, rolesFor } from './agents/game.js';
import { makeBackend, checkClaude } from './agents/backend.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf(`--${n}`); return i < 0 ? undefined : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };

const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
if (flag('backend')) cfg.backend = flag('backend');
if (flag('turns')) cfg.maxTurns = Number(flag('turns'));
cfg.maxTurns ||= 0;
if (flag('name')) cfg.runName = flag('name');
if (flag('countries')) cfg.countries = Number(flag('countries'));
if (flag('delay')) cfg.turnDelayMs = Number(flag('delay'));
if (flag('port')) cfg.port = Number(flag('port'));
if (flag('seed')) cfg.seed = Number(flag('seed'));
if (flag('roles')) {
  cfg.agentRoles = String(flag('roles')).split(',').map(s => s.trim()).filter(Boolean);
  const bad = cfg.agentRoles.filter(r => !ROLES.includes(r));
  if (bad.length) { console.error(`Bilinmeyen karakter: ${bad.join(', ')}. Seçenekler: ${ROLES.join(', ')}`); process.exit(1); }
}

const baseDir = cfg.saveDir || path.join(os.homedir(), 'ajan-dunyasi-kayitlar');
const dir = path.join(baseDir, cfg.runName);
if (flag('new') && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
const store = new Store(dir);
// Karakter oturumları bu boş ve uygulamaya özel klasörden açılır; dışarıdaki proje ayarları okunmaz.
const sessionDir = path.join(dir, 'oturumlar');
fs.mkdirSync(sessionDir, { recursive: true });

let world;
if (store.exists()) { world = store.loadWorld(); console.log(`Kayıt bulundu, tur ${world.turn} üzerinden devam ediliyor.`); }
else { world = createWorld(cfg); store.saveMap(world); console.log('Yeni dünya oluşturuldu.'); }

const clients = new Set();
const send = msg => { const line = `data: ${JSON.stringify(msg)}\n\n`; for (const r of clients) r.write(line); };
const game = new Game({ world, cfg, backend: makeBackend(cfg, sessionDir), store, onUpdate: send });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const LOCAL_HOST = /^(localhost|127\.0\.0\.1)(:\d+)?$/i, panelDir = path.join(root, 'panel');

// Kısayolla açılınca pencere kapanırsa oyun arka planda kullanım harcamaya devam etmesin.
const closeWithWindow = !!flag('pencere');
let idleTimer = null;
function watchWindow(wait = 20000) {
  if (!closeWithWindow) return;
  clearTimeout(idleTimer);
  if (clients.size === 0) idleTimer = setTimeout(() => { game.stop = true; console.log('Pencere kapandı, oyun kaydedildi.'); process.exit(0); }, wait);
}

const server = http.createServer((req, res) => {
  try { handle(req, res); }
  catch (e) { console.error(e); if (!res.headersSent) res.writeHead(400); res.end('İstek işlenemedi'); }
});

function handle(req, res) {
  if (!LOCAL_HOST.test(req.headers.host ?? '')) { res.writeHead(403); return res.end('Yalnızca yerel erişim'); }
  const url = new URL(req.url, 'http://x');
  const json = (body, code = 200) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(body); };
  if (url.pathname === '/api/meta') return json(JSON.stringify({ lastTurn: store.lastTurn(), marks: store.marks(), status: game.status, paused: !!game.paused, progress: game.progress, runName: cfg.runName, backend: cfg.backend, maxTurns: cfg.maxTurns, agentRoles: cfg.agentRoles, countryAgentRoles: cfg.countryAgentRoles, usage: store.lastUsage() }));
  if (url.pathname === '/api/map') return json(store.readMap());
  if (url.pathname === '/api/control' && req.method === 'POST') {
    if (req.headers['x-panel'] !== '1') return json('{"error":"Yetkisiz istek."}', 403);
    const action = url.searchParams.get('action');
    if (action === 'pause') { game.paused = true; game.setStatus('durduruluyor', 'Bu tur bitince duracak.'); }
    if (action === 'resume') game.paused = false;
    return json('{"ok":true}');
  }
  if (url.pathname === '/api/people') return json(JSON.stringify(store.people()));
  if (url.pathname === '/api/ledger') {
    const q = url.searchParams, num = k => q.has(k) && q.get(k) !== '' ? Number(q.get(k)) : null;
    return json(JSON.stringify(store.queryLedger({ q: q.get('q') ?? '', kinds: q.get('k') ? q.get('k').split(',') : null, country: q.get('c'), character: q.get('ch'), source: q.get('s'), ok: q.has('ok') ? q.get('ok') === '1' : null, imp: num('imp'), turn: num('turn'), from: num('from'), to: num('to'), limit: num('limit'), cursor: q.get('cursor') })));
  }
  const m = /^\/api\/turn\/(\d+)$/.exec(url.pathname);
  if (m) { const d = store.readTurn(+m[1]); return d ? json(d) : json('{"error":"Bu tur henüz yok."}', 404); }
  if (url.pathname === '/api/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ type: 'status', status: game.status, progress: game.progress, turn: world.turn })}\n\n`);
    clients.add(res); watchWindow(); req.on('close', () => { clients.delete(res); watchWindow(); }); return;
  }
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.normalize(path.join(panelDir, rel));
  if (!file.startsWith(panelDir + path.sep) || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) { res.writeHead(404); return res.end('Bulunamadı'); }
  const cached = /\.(woff2|ico)$/.test(file) ? { 'cache-control': 'max-age=31536000' } : {};
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', ...cached });
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

async function main() {
  server.listen(cfg.port, '127.0.0.1', () => console.log(`Panel: http://localhost:${cfg.port}`));
  const c = Object.values(world.countries)[0];
  console.log(`Arka uç: ${cfg.backend}. AI karakterler: ${[...rolesFor(cfg, c)].join(', ') || 'yok (hepsi kuralla oynar)'}.`);
  console.log(`Kayıtlar: ${dir}`);
  if (cfg.backend === 'claude') {
    try { await checkClaude(); console.log('Claude bağlantısı hazır.'); }
    catch (e) { console.error(`Claude'a ulaşılamadı: ${e.message}\nClaude Code kurulu ve oturum açık mı kontrol et, ya da denemek için: node run.js --backend mock`); game.setStatus('hata', 'Claude komutuna ulaşılamadı.'); return; }
  }
  try { await game.run(cfg.maxTurns); console.log('Oyun bitti. Panel açık kalıyor; kapatmak için Ctrl+C.'); }
  catch (e) { console.error(e); game.setStatus('hata', e.message); }
}
main();
process.on('SIGINT', () => { game.stop = true; process.exit(0); });
