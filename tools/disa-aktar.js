#!/usr/bin/env node
// Bir oyunu, onu okuyup senaryo ve video üretecek başka bir yapay zekâ için tek klasöre döker.
// Kullanım: node tools/disa-aktar.js [kayıt-adı]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Store } from '../agents/store.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const name = process.argv[2] || cfg.runName, dir = path.join(cfg.saveDir || path.join(os.homedir(), 'ajan-dunyasi-kayitlar'), name);
if (!fs.existsSync(path.join(dir, 'world.json'))) { console.error(`Kayıt bulunamadı: ${dir}`); process.exit(1); }

const store = new Store(dir), out = path.join(dir, 'video-kaynak'), artOut = path.join(out, 'sanat');
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(artOut, { recursive: true });
const write = (f, data) => fs.writeFileSync(path.join(out, f), typeof data === 'string' ? data : JSON.stringify(data, null, 1));

const entries = store.sources().flatMap(s => store.entriesOf(s.name)).sort((a, b) => a.t - b.t || a.i - b.i);
write('zaman-cizelgesi.ndjson', entries.map(e => JSON.stringify(e)).join('\n'));

const world = store.loadWorld(), people = store.people(), art = store.artIndex();
for (const p of Object.values(people)) p.portrait = art.find(a => a.kind === 'portrait' && a.character === p.id)?.file ?? null;
write('kisiler.json', people);
write('ulkeler.json', Object.values(world.countries).map(c => ({ id: c.id, name: c.name, alive: c.alive, regime: c.regime, ideology: c.ideology, archetype: c.archetype, currency: c.currency, culture: c.culture, chronicle: c.chronicle, parent: c.parent, leader: world.characters[c.leader]?.name, laws: c.laws, institutions: c.institutions, history: c.history })));
write('dunya-gecmisi.json', world.past ?? []);
write('harita.json', JSON.parse(store.readMap()));
write('isaretler.json', store.marks());
if (fs.existsSync(store.file('stats.ndjson'))) fs.copyFileSync(store.file('stats.ndjson'), path.join(out, 'istatistik.ndjson'));
if (fs.existsSync(store.file('usage.ndjson'))) fs.copyFileSync(store.file('usage.ndjson'), path.join(out, 'token-kullanimi.ndjson'));
for (const a of art) fs.copyFileSync(store.artPath(a.id), path.join(artOut, a.file));
write('sanat.json', art);
write('son-dunya.json.gz', zlib.gzipSync(JSON.stringify(world)));

const byYear = {};
for (const e of entries) if ((e.imp ?? 0) >= 2 || e.k === 'muharebe') (byYear[e.d.split(' ')[0]] ||= []).push(e);
write('yillik-ozet.md', Object.entries(byYear).map(([y, list]) => `## ${y}\n\n${list.map(e => `- ${e.d}: ${e.text}`).join('\n')}`).join('\n\n'));

write('BENIOKU.md', `# ${name} oyunu: video kaynağı

Bu klasör oyunda olan her şeyi içerir. Karakterlerin iç sesleri, gizli mesajlar ve hakem kararları dahildir.

- zaman-cizelgesi.ndjson: her satır bir olay. t tur, d tarih, k tür, n kişi, c ülkeler, a kişi kimlikleri, p konum, imp önem (0-3), text metin, x ayrıntı.
- Türler: dusunce (iç ses, kararlar, günlük notu), mesaj, sorgu, hukum (hakem), kural (kural tabanlı eylem), haber, durum (rejim, lider, sınır, ekonomi değişimi), muharebe (kayıplarıyla), sistem (teknik hata).
- x.secret doğruysa olay halktan gizlidir; hikâyede bunu dramatik ironi olarak kullanabilirsin.
- kisiler.json: ölenler dahil herkes; kimlik, geçmiş, doğum yeri, hayat olayları, portre dosyası.
- ulkeler.json: kronik, kültür, para, yasalar, kurumlar, tur tur istatistik.
- dunya-gecmisi.json: oyun başlamadan önceki ortak tarih.
- istatistik.ndjson: her turda her ülkenin sayıları; grafikler için.
- harita.json: eyalet çokgenleri, nehirler. son-dunya.json.gz: oyun sonu tam dünya.
- sanat.json ve sanat/: portreler ve olay tabloları. Her kaydın SVG dosyası, altyazısı ve bir görüntü modeline verilebilecek İngilizce betimlemesi (prompt) vardır.
- yillik-ozet.md: yıl yıl önemli olaylar, başlangıç noktası olarak.
`);
console.log(`Hazır: ${out}\n${entries.length} olay, ${Object.keys(people).length} kişi, ${art.length} görsel.`);
