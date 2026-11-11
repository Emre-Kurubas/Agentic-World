#!/usr/bin/env node
// Dumps a game into one folder for another AI that will read it and produce a script and video.
// Usage: node tools/export.js [save-name | folder of a save]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Store, holdings } from '../agents/store.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
// The argument is the name of a save, or the folder of one.
const arg = process.argv[2] || cfg.runName, given = fs.existsSync(path.join(arg, 'world.json')), dir = given ? path.resolve(arg) : path.join(cfg.saveDir || path.join(os.homedir(), 'ajan-dunyasi-kayitlar'), arg), name = path.basename(dir);
if (!fs.existsSync(path.join(dir, 'world.json'))) { console.error(`Save not found: ${dir}`); process.exit(1); }

const store = new Store(dir), out = path.join(dir, 'video-source'), artOut = path.join(out, 'art');
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(artOut, { recursive: true });
const write = (f, data) => fs.writeFileSync(path.join(out, f), typeof data === 'string' ? data : JSON.stringify(data, null, 1));

const entries = store.sources().flatMap(s => store.entriesOf(s.name)).sort((a, b) => a.t - b.t || a.i - b.i);
write('timeline.ndjson', entries.map(e => JSON.stringify(e)).join('\n'));

const world = store.loadWorld(), people = store.people(), art = store.artIndex();
for (const p of Object.values(people)) p.portrait = art.find(a => a.kind === 'portrait' && a.character === p.id)?.file ?? null;
write('people.json', people);
write('countries.json', Object.values(world.countries).map(c => ({ id: c.id, name: c.name, alive: c.alive, regime: c.regime, ideology: c.ideology, archetype: c.archetype, currency: c.currency, culture: c.culture, chronicle: c.chronicle, parent: c.parent, leader: world.characters[c.leader]?.name, succession: c.elections ? 'election' : c.succession ?? 'open', laws: c.laws, institutions: c.institutions, atrocities: c.atrocities ?? [], history: c.history })));
write('world-history.json', world.past ?? []);
write('map.json', JSON.parse(store.readMap()));
write('marks.json', store.marks());
if (fs.existsSync(store.file('stats.ndjson'))) fs.copyFileSync(store.file('stats.ndjson'), path.join(out, 'stats.ndjson'));
// Positions, with the political map of every quarter. Games recorded before the map was kept each quarter have it filled in from the turn snapshots that survive.
const snaps = fs.existsSync(path.join(dir, 'turns')) ? fs.readdirSync(path.join(dir, 'turns')).filter(f => /^t-\d+\.json\.gz$/.test(f)).sort() : [], snapOut = path.join(out, 'snapshots');
if (fs.existsSync(store.file('positions.ndjson'))) write('positions.ndjson', fs.readFileSync(store.file('positions.ndjson'), 'utf8').split('\n').filter(Boolean).map(l => { const row = JSON.parse(l), f = store.turnFile(row.t); if (!row.provinces && fs.existsSync(f)) row.provinces = holdings(JSON.parse(zlib.gunzipSync(fs.readFileSync(f))).world); return JSON.stringify(row); }).join('\n'));
// The whole world as it stood at the end of each quarter that is still kept (every one of the last forty, then one a year): whatever the timeline does not say can be looked up there.
if (snaps.length) { fs.mkdirSync(snapOut, { recursive: true }); for (const f of snaps) fs.copyFileSync(path.join(dir, 'turns', f), path.join(snapOut, f)); }
if (fs.existsSync(store.file('usage.ndjson'))) fs.copyFileSync(store.file('usage.ndjson'), path.join(out, 'token-usage.ndjson'));
for (const a of art) fs.copyFileSync(store.artPath(a.id), path.join(artOut, a.file));
write('art.json', art);
write('final-world.json.gz', zlib.gzipSync(JSON.stringify(world)));

const byYear = {};
for (const e of entries) if ((e.imp ?? 0) >= 2 || e.k === 'battle') (byYear[e.d.split(' ').at(-1)] ||= []).push(e);
write('yearly-summary.md', Object.entries(byYear).map(([y, list]) => `## ${y}\n\n${list.map(e => `- ${e.d}: ${e.text}`).join('\n')}`).join('\n\n'));

write('README.md', `# ${name} game: video source

This folder contains everything that happened in the game, including the characters' inner voices, secret messages and referee rulings.

- timeline.ndjson: one event per line. t turn, d date, k kind, n person, c countries, a person ids, p location, imp importance (0-3), text body, x details.
- Kinds: thought (inner voice, decisions, diary note), message (a letter between characters), notice (what the world itself told one person: intelligence reports, warnings, arrest orders, censored letters, offers, notary notes), query (what a character looked up and the answer they got), ruling (referee), rule (rule-based action), news, state (regime, leader, border, policy, health, economy change), battle (with losses), system (technical error).
- Where an event has a place, p is the province id (see map.json); positions.ndjson has, for every turn, every unit ([id, country, province, thousands of men, arm, where it is marching or null]), every fleet ([id, country, sea, ships, kind, target, harbour province or null when at sea, damaged ships, standing orders]), mines ([sea, country, thickness]) and the political map (provinces: [id, owner, holder]; where owner and holder differ the province is occupied). Draw the moving frontier from that.
- A ruling (the referee turning one decision into operations) has x.decisionText (the character's own words), x.ops (the operations) and x.results (the engine's answer to each, in the same order: ok false is a refusal with the reason; waits marks an order that waited on the quarter's events (waits "take:P97" is an order kept until that province had fallen to whoever gave it, or until the attack on it failed; the staff's notice says which), such as a landing waiting for its squadron, and whose outcome then reached the character as a notice from the staff; skipped marks an operation that was ordered only in case another succeeded or failed). x.probability is the chance that was actually rolled and x.success whether the roll went the actor's way: dice are rolled only for acts no operation carries (a go-between, a smuggled letter); x.refereeProbability, when present, is a doubt the referee voiced that was not put to the dice because the engine itself judged the matter.
- snapshots/: the whole world at the end of each quarter still kept (all of the last forty, then one a year), gzipped JSON ({world}), for anything the timeline does not say.
- A thought carries x.model (which Claude model plays that person) and x.standing (in office, out of office, imprisoned, exiled). A message with x.intercepted was copied by a prison censor for the ruler.
- News has x.kind: politics, economy, diplomacy, war, plot, disaster, atrocity (state violence against a population; importance 3). If x.secret is true the event is hidden from the public; you can use it as dramatic irony in the story.
- people.json: everyone, the dead included; private identity, public face, the model that played them, health, how and when they died, background, birthplace, life events, portrait file.
- countries.json: chronicle, culture, currency, rule of succession, laws, institutions, recorded atrocities, per-turn statistics (treasury, budget balance, debt).
- world-history.json: the shared history before the game began.
- stats.ndjson: every country's numbers each turn; for charts.
- map.json: province polygons, rivers. final-world.json.gz: the full world at the end of the game.
- art.json and art/: portraits and event paintings. Each record has an SVG file, a caption and an English description (prompt) that can be given to an image model.
- yearly-summary.md: major events year by year, as a starting point.`);
console.log(`Done: ${out}\n${entries.length} events, ${Object.keys(people).length} people, ${art.length} images.`);
