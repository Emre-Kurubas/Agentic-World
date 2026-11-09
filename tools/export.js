#!/usr/bin/env node
// Dumps a game into one folder for another AI that will read it and produce a script and video.
// Usage: node tools/export.js [save-name]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Store } from '../agents/store.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const name = process.argv[2] || cfg.runName, dir = path.join(cfg.saveDir || path.join(os.homedir(), 'ajan-dunyasi-kayitlar'), name);
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
if (fs.existsSync(store.file('positions.ndjson'))) fs.copyFileSync(store.file('positions.ndjson'), path.join(out, 'positions.ndjson'));
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
- Where an event has a place, p is the province id (see map.json); positions.ndjson has every unit and fleet each turn.
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
