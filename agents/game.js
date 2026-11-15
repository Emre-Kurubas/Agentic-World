import { randomUUID } from 'node:crypto';
import { aliveCountries, ROLES, countryProvinces } from '../engine/world.js';
import { beginTurn, stepWorld } from '../engine/step.js';
import { applyOp, printable, carryList } from '../engine/ops.js';
import { news, rand, clamp, quarterLabel } from '../engine/util.js';
import { openPost, isMinor } from '../engine/court.js';
import { burden } from '../engine/burdens.js';
import { npcDecide } from './npc.js';
import { actorPrompt, refereePrompt, courtPrompt, lookupReply, talkText, amendText } from './prompts.js';
import { answer } from './queries.js';
import { LimitError, SessionLostError } from './backend.js';
import { snapshotState, buildEntries } from './ledger.js';
import { isPaintable, portraitPrompt, paintingPrompt, parseArt, witnessFor } from './art.js';
import { incapacitated, WEAR, wearStage, wearOn } from '../engine/health.js';
import { die } from '../engine/politics.js';
import { noteLetter } from '../engine/annals.js';

export function rolesFor(cfg, c) {
  const root = c.parent ?? c.id;
  const raw = cfg.countryAgentRoles?.[c.id] ?? cfg.countryAgentRoles?.[root] ?? cfg.agentRoles;
  return new Set((raw || []).filter(r => ROLES.includes(r)));
}
// Someone in one of the four seats is an AI when that seat is cast as one. Someone who has lost the seat stays whoever was playing them.
export const seated = (w, ch) => { const c = w.countries[ch.country]; return !!c?.alive && c[ch.role] === ch.id && ch.status === 'free'; };
export const isAI = (cfg, c, ch) => c[ch.role] === ch.id ? rolesFor(cfg, c).has(ch.role) : !!ch.everAI;

// Everyone who can act this quarter: the holders of the four seats, and those who lost a seat but not their life (prisoners, exiles, the deposed).
// The gravely ill act for no one.
export function currentActors(w) {
  const out = [], seen = new Set();
  for (const c of aliveCountries(w)) for (const r of ROLES) {
    const ch = w.characters[c[r]];
    if (ch?.alive && ch.status === 'free' && ch.country === c.id && !incapacitated(ch)) { out.push(ch); seen.add(ch.id); }
  }
  // Someone the story has moved past falls silent in time: out of office, they stay on stage for some years after their fall or after the last letter that reached them.
  for (const ch of Object.values(w.characters)) if (ch.everAI && ch.alive && !seen.has(ch.id) && !seated(w, ch) && !incapacitated(ch) && w.countries[ch.country]?.alive && w.turn - Math.max(ch.outSince ?? w.turn, ...ch.inbox.map(m => m.turn ?? 0)) < FADE_AFTER) out.push(ch);
  return out;
}

// Which model plays whom is settled by lot, and the lot is not the world's seed: the same map dealt again seats different minds.
// When a world first sits down every country hears each model of the cast before it hears any twice, the seat left over goes to
// whichever model the world has heard least, and who gets which seat at the table is drawn. Nobody is always the general.
// Someone who comes to a seat later draws for themselves, and a person keeps their model for life.
// Without a cast list leaders get one model and everyone else another. assign pins a person, a seat ("U2.general") or a role.
const FADE_AFTER = 16;
const castOf = cfg => Array.isArray(cfg.models?.cast) ? cfg.models.cast.filter(Boolean) : [];
const pinnedFor = (cfg, ch) => { const m = cfg.models ?? {}; return m.assign?.[ch.id] ?? m.assign?.[`${ch.country}.${ch.role}`] ?? m.assign?.[ch.role]; };
const shuffled = (xs, lot) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(lot() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export function castModel(cfg, w, ch, lot = Math.random) {
  const pinned = pinnedFor(cfg, ch); if (pinned) return pinned;
  const cast = castOf(cfg); if (!cast.length) return ch.role === 'leader' ? cfg.models?.leader : cfg.models?.secondary;
  // Whoever comes to a seat later takes the model the table hears least, so that the four seats of a country never fall to one mind:
  // where a model is missing he brings it, and where several are equally thin the lot decides among them.
  const c = w.countries[ch.country], others = c ? ROLES.filter(r => r !== ch.role).map(r => w.characters[c[r]]).filter(x => x?.alive && x.id !== ch.id).map(x => x.model) : [];
  const heard = m => others.filter(x => x === m).length, least = Math.min(...cast.map(heard)), thin = cast.filter(m => heard(m) === least);
  return thin[Math.floor(lot() * thin.length)];
}
export function dealCast(cfg, w, lot = Math.random) {
  w.castDealt = true;
  const cast = castOf(cfg); if (!cast.length) return;
  const tables = aliveCountries(w).map(c => ROLES.filter(r => rolesFor(cfg, c).has(r)).map(r => w.characters[c[r]]).filter(ch => ch?.alive)), heard = Object.fromEntries(cast.map(m => [m, 0]));
  for (const ch of tables.flat()) { ch.model ??= pinnedFor(cfg, ch); if (ch.model in heard) heard[ch.model]++; }
  for (const table of shuffled(tables, lot)) {
    const open = table.filter(ch => !ch.model), hand = [], here = m => table.filter(ch => ch.model === m).length + hand.filter(x => x === m).length;
    while (hand.length < open.length) { const m = shuffled(cast, lot).sort((x, y) => here(x) - here(y) || heard[x] - heard[y])[0]; hand.push(m); heard[m]++; }
    shuffled(hand, lot).forEach((m, i) => { open[i].model = m; });
  }
}

export function shouldWake(w, cfg, ch) {
  const c = w.countries[ch.country];
  if (!isAI(cfg, c, ch)) return false;
  // Out of office, a person is woken by letters and otherwise lives at a slower pace.
  if (!seated(w, ch)) return ch.inbox.length > 0 || w.turn - ch.lastWake >= cfg.wakeEvery;
  if (ch.role === 'leader') return true;
  if ((c.tension ?? 0) >= cfg.wakeTension) return true;
  if (ch.inbox.length) return true;
  if (w.plots.some(p => p.active && [p.leader, ...p.members].includes(ch.id))) return true;
  return w.turn - ch.lastWake >= cfg.wakeEvery;
}

const modelFor = (cfg, ch) => ch.model ?? (ch.role === 'leader' ? cfg.models.leader : cfg.models.secondary);

async function pool(items, n, fn) {
  let i = 0; const results = new Array(items.length);
  await Promise.all(Array.from({ length: Math.max(1, n) }, async () => { while (i < items.length) { const k = i++; results[k] = await fn(items[k], k); } }));
  return results;
}

// See applyRuling: the one person an order names by number, where the operation written for it names somebody the order does not mention.
// It never re-aims the order (a first version did, and "have the chief of staff arrested, and let K7 be told" arrested K7): it holds the
// operation back and says why, so that nothing is done to anybody the order did not mean. It keeps out of the way where the order speaks of
// the person by what he is ("the chief of staff", "the treasurer") and where the order names the one person with his number beside a name.
const ROLE_WORDS = { leader: /\b(ruler|president|king|queen|emperor|empress|prince|princess|chairman|head of (the )?(state|government)|leader)\b/i, general: /\b(chief of (the )?(general )?staff|general|marshal)\b/i, opposition: /\b(opposition)\b/i, oligarch: /\b(magnate|oligarch|owner|industrialist)\b/i, officer: /\b(commander|colonel|captain|major|officer|admiral|general|governor)\b/i, official: /\b(treasur|minister|keeper|police|chief|governor|clerk|secretary|official)/i, financier: /\b(banker|house|financier)\b/i, agitator: /\b(league|guard|chief|agitator)\b/i, former_leader: /\b(former|old|late|deposed|fallen)\b/i };
function namedPerson(w, op, text) {
  const x = typeof op?.character === 'string' ? w.characters[op.character] : null; if (!x) return op;
  const said = String(text), has = s => s && said.toLowerCase().includes(String(s).toLowerCase());
  if (new RegExp(`\\b${x.id}\\b`).test(said) || has(x.name) || has(x.name.split(' ').pop()) || has(x.name.split(' ')[0])) return op;
  if (ROLE_WORDS[x.role]?.test(said)) return op;
  // Only where the order names exactly one person, with the number beside the name: "Maria Ur-Nanna (K31)".
  const ids = [...new Set(said.match(/\bK\d+\b/g) || [])].filter(id => w.characters[id]?.alive), y = ids.length === 1 ? w.characters[ids[0]] : null;
  if (!y || !new RegExp(`${y.name.split(' ').pop()}\\s*\\(${y.id}\\)`, 'i').test(said)) return op;
  return { ...op, _misnamed: { wrote: x.id, named: y.id } };
}

const misnamed = (w, m) => ({ ok: false, msg: `The office entered this for ${w.characters[m.wrote]?.name} (${m.wrote}), whom your order does not name; your order names ${w.characters[m.named]?.name} (${m.named}). Nothing was done to either: give the order again, naming whom you mean.` });

export class Game {
  constructor({ world, cfg, backend, store, onUpdate }) { Object.assign(this, { w: world, cfg, backend, store, onUpdate }); this.status = 'ready'; this.progress = ''; this.stop = false; this.sessions = store?.loadSessions?.() ?? {}; }
  setStatus(status, progress = '') { this.status = status; this.progress = progress; this.onUpdate?.({ type: 'status', status, progress, turn: this.w.turn }); }

  async withRetry(fn) {
    for (;;) {
      try { return await fn(); }
      catch (e) {
        if (!(e instanceof LimitError)) throw e;
        // A refusal by the service or a dead line is asked again sooner than a usage limit; either way the game stands still until it answers.
        const minutes = e.service ? Math.min(this.cfg.limitRetryMinutes, 2) : this.cfg.limitRetryMinutes, until = new Date(Date.now() + minutes * 60000);
        this.store.savePending(this.pending);
        this.setStatus(e.service ? 'waiting for the service' : 'waiting for limit', e.service ? `The service refused the call or could not be reached (${String(e.message).slice(0, 120)}). Will ask again around ${until.toLocaleTimeString('en-US')}. Nobody is played by rules meanwhile; the game will continue from where it left off.` : `Usage limit reached. Will retry around ${until.toLocaleTimeString('en-US')}. The game will continue from where it left off.`);
        if (e.service) console.log(`[service] ${String(e.message).slice(0, 160)}; asking again in ${minutes} minute(s)`);
        await new Promise(r => setTimeout(r, minutes * 60000));
        if (this.stop) throw e;
      }
    }
  }

  // Each AI character has one persistent Claude session. The record is written before the call so a half-finished call is known too.
  sessionOf(ch) { return this.sessions[ch.id] ||= { id: randomUUID(), calls: 0, done: 0, intro: false }; }
  saveSessions() { this.store?.saveSessions?.(this.sessions); }

  async askAs(ch, build, model) {
    let s = this.sessionOf(ch), fresh = false, recap = false;
    for (;;) {
      const resume = s.calls > 0, intro = !s.intro;
      s.calls++; this.saveSessions();
      const call = { id: s.id, resume };
      try {
        const r = await this.backend.ask(build({ intro, fresh, recap }), model, call);
        s.done++; if (build.isActor) s.intro = true;
        this.wear(ch, s, call.usage);
        this.saveSessions();
        return r;
      } catch (e) {
        // A session too full to be answered at all is a mind at its end, as much as one that was compacted.
        if (!(e instanceof SessionLostError)) { if ((s.ctx ?? 0) >= (this.wearing()?.serious ?? Infinity) && /too long|context|too many tokens/i.test(e.message || '')) { s.spent ??= this.w.turn; this.saveSessions(); } throw e; }
        recap = s.done > 0; fresh = true;
        s = this.sessions[ch.id] = { id: randomUUID(), calls: 0, done: 0, intro: false };
        this.report(ch, recap ? 'Session file not found; opened a new session from the character\'s diary.' : 'The session had not been created yet; reopened.');
      }
    }
  }

  // How large each character's session has grown, from the last call. A drop to under half of a session that was already large is the
  // session being compacted: the person dies at the end of the quarter (wearStep). A new session (one that was lost) starts from nothing.
  wearing() { const t = this.cfg.wearOut; return t === false ? null : { ...WEAR, ...(t || {}) }; }
  wear(ch, s, usage) {
    const t = this.wearing(); if (!t || !usage) return;
    const ctx = ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'].reduce((a, k) => a + (Number(usage[k]) || 0), 0);
    if (!ctx) return;
    const before = s.ctx ?? 0;
    if (before >= t.since && ctx < before * t.compacted) { s.spent ??= this.w.turn; this.report(ch, `The session was compacted (${Math.round(before / 1000)}k to ${Math.round(ctx / 1000)}k tokens): the character dies at the end of the quarter.`); }
    s.ctx = ctx; s.peak = Math.max(s.peak ?? 0, ctx);
  }
  // At the quarter's end: the minds that ran out die, the rest fall ill as far as their sessions have grown.
  wearStep() {
    const t = this.wearing(); if (!t) return;
    const w = this.w;
    for (const [id, s] of Object.entries(this.sessions)) {
      const ch = w.characters[id]; if (!ch?.alive) continue;
      if (s.spent != null) { die(w, ch, 'died after a long illness'); continue; }
      wearOn(w, ch, wearStage(s.ctx ?? 0, t));
    }
  }

  // States are inherited ready-made in world generation; the opening only writes the first record.
  async found() {
    const w = this.w;
    beginTurn(w);
    for (const c of aliveCountries(w)) news(w, `${c.name}: ${c.regime}, ${c.ideology}. In power: ${w.characters[c.leader]?.name}.`, { kind: 'politics', countries: [c.id] });
    w.status = 'playing';
    w.newsLog.push(...w.newsThisTurn);
    this.store.commit(w, buildEntries(w, { trace: [], rulings: [] }, null));
    this.onUpdate?.({ type: 'turn', turn: w.turn });
  }

  report(ch, text) { console.error(`[${ch?.name ?? 'referee'}] ${text}`); (this.sysLog ||= []).push({ name: ch?.name ?? 'referee', text }); }

  // Portraits and event paintings do not block the turn; if the limit is hit they stay queued and continue next turn.
  async artStep(entries) {
    const { backend, store, cfg, w } = this;
    if (!backend.askText || cfg.art === false || !store.saveArt) return;
    const queue = store.loadArtQueue(), done = new Set(store.artIndex().filter(a => a.kind === 'portrait').map(a => a.character));
    const isAIch = ch => !!ch.aiControlled;
    for (const ch of Object.values(w.characters)) if (ch.alive && ch.aiControlled && ch.persona && !done.has(ch.id) && !queue.some(q => q.character === ch.id)) queue.push({ kind: 'portrait', character: ch.id });
    const seen = new Set();
    for (const e of (entries || []).filter(isPaintable).sort((a, b) => (b.imp ?? 0) - (a.imp ?? 0)).slice(0, cfg.artEventsPerTurn ?? 2)) {
      const key = `${e.c?.[0]}`; if (seen.has(key)) continue; seen.add(key);
      queue.push({ kind: 'event', entry: { id: e.id, t: e.t, d: e.d, text: e.text, c: e.c, a: e.a, p: e.p } });
    }
    if (!queue.length) return;
    this.setStatus('painting art', `${queue.length} images`);
    const remaining = [...queue]; let stop = false;
    await pool(queue, cfg.concurrency, async item => {
      if (stop) return;
      const ch = item.kind === 'portrait' ? w.characters[item.character] : witnessFor(w, item.entry, isAIch);
      if (!ch || (item.kind === 'portrait' && !ch.alive)) { remaining.splice(remaining.indexOf(item), 1); return; }
      try {
        const text = await backend.askText(item.kind === 'portrait' ? portraitPrompt(w, ch) : paintingPrompt(w, ch, item.entry), cfg.models.art ?? modelFor(cfg, ch)), art = parseArt(text);
        if (art) store.saveArt({ id: item.kind === 'portrait' ? `portrait-${ch.id}` : `painting-${item.entry.id}`, kind: item.kind, turn: item.entry?.t ?? w.turn, date: item.entry?.d ?? w.date, character: item.kind === 'portrait' ? ch.id : null, witness: item.kind === 'event' ? ch.id : null, witnessName: ch.name, event: item.entry?.text ?? null, country: ch.country, caption: art.caption, prompt: art.prompt }, art.svg);
        else this.report(ch, 'The image response had no valid SVG.');
        remaining.splice(remaining.indexOf(item), 1);
      } catch (e) { if (e instanceof LimitError) stop = true; else { this.report(ch, `Could not paint the image: ${e.message}`); remaining.splice(remaining.indexOf(item), 1); } }
    });
    store.saveArtQueue(remaining);
  }

  async think() {
    const w = this.w, cfg = this.cfg;
    if (!w.castDealt) dealCast(cfg, w);
    for (const ch of Object.values(w.characters)) {
      ch.aiControlled = !!w.countries[ch.country] && isAI(cfg, w.countries[ch.country], ch);
      if (ch.aiControlled && ch.alive) { ch.everAI = true; ch.model ??= castModel(cfg, w, ch); burden(w, ch); }
    }
    const actors = currentActors(w).filter(ch => shouldWake(w, cfg, ch));
    this.setStatus('agents thinking', `${actors.length} characters deciding`);
    let done = 0;
    await this.withRetry(() => pool(actors, cfg.concurrency, async ch => {
      if (this.pending.actors[ch.id]) return;
      let r = null;
      if (this.backend.kind === 'mock') r = mockThought(w, ch);
      else {
        try {
          const rounds = Math.max(0, cfg.maxLookupRounds ?? 4), answers = (this.pending.lookups ||= {})[ch.id] ||= [], sent = this.pending.sent ||= {};
          let retry = !!sent[ch.id];
          if (!retry) { sent[ch.id] = true; this.store.savePending(this.pending); }
          for (;;) {
            const used = new Set(answers.map(a => a.round)).size, final = used >= rounds, again = retry;
            // Normally the session knows the report and later lookups send only new answers. After an interruption everything is rewritten.
            const build = ({ intro, fresh, recap }) => used === 0 || fresh || again
              ? actorPrompt(w, ch, answers, final, { intro, recap, retry: again })
              : lookupReply(answers.filter(a => a.round === used - 1), final);
            build.isActor = true;
            r = await this.askAs(ch, build, modelFor(cfg, ch));
            retry = false;
            if (final || !Array.isArray(r?.lookup) || !r.lookup.length) break;
            for (const q of r.lookup.slice(0, 16)) answers.push({ q: String(q).slice(0, 40), a: answer(w, ch, q), round: used });
            this.store.savePending(this.pending);
          }
        }
        catch (e) { if (e instanceof LimitError) throw e; this.report(ch, `No answer received, fell back to rules: ${e.message}`); r = { fallback: true }; }
      }
      this.pending.actors[ch.id] = sanitize(r, cfg); if (this.pending.actors[ch.id].messages) this.pending.actors[ch.id].messages = toTable(w, ch, this.pending.actors[ch.id].messages);
      this.store.savePending(this.pending);
      this.setStatus('agents thinking', `${++done}/${actors.length} decisions received`);
    }));
    return actors;
  }

  // Bargaining within the quarter: AI characters who receive messages reply and change decisions; sleepers wake when their turn comes.
  async negotiate(actors) {
    const w = this.w, cfg = this.cfg, rounds = Math.max(0, cfg.negotiationRounds ?? 2);
    if (this.backend.kind === 'mock' || !rounds) return;
    const talk = this.pending.talk ||= { round: 0, skip: {} };
    const reachable = new Map(currentActors(w).filter(ch => isAI(cfg, w.countries[ch.country], ch)).map(ch => [ch.id, ch]));
    for (const ch of reachable.values()) if (this.pending.actors[ch.id] && !actors.includes(ch)) actors.push(ch);
    while (talk.round < rounds) {
      const unread = new Map();
      for (const from of [...actors]) {
        for (const m of this.pending.actors[from.id]?.messages ?? []) {
          const target = reachable.get(recipient(w, m.to, from, m.text)?.id);
          if (m.read || !target || target.id === from.id || talk.skip[target.id] || this.pending.actors[target.id]?.fallback) continue;
          if (!unread.has(target.id)) unread.set(target.id, []);
          unread.get(target.id).push({ m, from });
        }
      }
      if (!unread.size) break;
      const round = talk.round + 1, last = round >= rounds;
      this.setStatus('agents negotiating', `round ${round}, ${unread.size} characters replying`);
      await this.withRetry(() => pool([...unread], cfg.concurrency, async ([id, items]) => {
        const waiting = items.filter(i => !i.m.read);
        if (!waiting.length) return;
        const ch = reachable.get(id), joined = !this.pending.actors[id];
        const text = talkText(waiting.map(i => ({ from: `${i.from.name} (${w.countries[i.from.country]?.name})`, text: i.m.text })), last);
        const build = ({ intro, fresh, recap }) => joined || fresh ? `${actorPrompt(w, ch, [], true, { intro, recap })}\n\n${text}` : text;
        build.isActor = joined;
        let r;
        try { r = await this.askAs(ch, build, modelFor(cfg, ch)); }
        catch (e) { if (e instanceof LimitError) throw e; this.report(ch, `No negotiation reply received: ${e.message}`); talk.skip[id] = true; this.store.savePending(this.pending); return; }
        for (const i of waiting) i.m.read = true;
        const clean = sanitize(r, cfg), sentNow = toTable(w, ch, clean.messages).map(m => ({ ...m, round }));
        if (joined) { this.pending.actors[id] = { ...clean, messages: sentNow }; actors.push(ch); }
        else {
          const cur = this.pending.actors[id];
          // A list written in a reply replaces the morning's list; an empty one changes nothing. (World 16: the answer format showed a "decisions"
          // field and said that an empty list cancels everything. Sonnet and Haiku seats wrote "decisions": [] to say "no change" in the last
          // replies of the quarter, and every order they had given that morning was dropped without a word to them: 113 of 565
          // character-quarters, 446 of 2512 orders in seventeen quarters; one president gave 92 orders in four years, a declaration of war among
          // them, and none was carried out. Opus seats left the field out and lost nothing.)
          if (Array.isArray(r?.decisions) && clean.decisions.length) cur.decisions = clean.decisions;
          cur.messages.push(...sentNow.slice(0, Math.max(0, cfg.maxMessagesPerActor * 2 - cur.messages.length)));
          if (clean.monologue) cur.monologue = [cur.monologue, clean.monologue].filter(Boolean).join('\n\n');
          if (clean.notes) cur.notes = [cur.notes, clean.notes].filter(Boolean).join(' ');
          if (clean.identity) cur.identity = clean.identity;
          if (clean.publicFace) cur.publicFace = clean.publicFace;
        }
        this.store.savePending(this.pending);
      }));
      talk.round = round; this.store.savePending(this.pending);
    }
  }

  async judge(actors) {
    const w = this.w, cfg = this.cfg;
    const groups = {};
    for (const ch of actors) {
      const r = this.pending.actors[ch.id];
      if (r?.decisions?.length && !r._ops && !r.fallback) (groups[ch.country] ||= []).push({ actor: ch, decisions: r.decisions });
    }
    const list = Object.entries(groups);
    this.setStatus('referee judging', `reviewing decisions of ${list.length} countries`);
    await this.withRetry(() => pool(list, cfg.concurrency, async ([cid, entries]) => {
      if (this.pending.referee[cid]) return;
      let r;
      try { r = await this.backend.ask(refereePrompt(w, w.countries[cid], entries), cfg.models.referee); }
      catch (e) { if (e instanceof LimitError) throw e; this.report(null, `No referee reply received: ${e.message}`); r = { rulings: [] }; }
      if (!Array.isArray(r?.rulings)) r = { rulings: [] };
      // A decision the referee passed over is asked for once more; nothing a character decided is dropped in silence.
      const left = unruled(entries, r);
      if (left.length) {
        try { const again = await this.backend.ask(refereePrompt(w, w.countries[cid], left), cfg.models.referee); if (Array.isArray(again?.rulings)) r.rulings.push(...again.rulings); }
        catch (e) { if (e instanceof LimitError) throw e; this.report(null, `No referee reply to the second request: ${e.message}`); }
      }
      this.pending.referee[cid] = r;
      this.store.savePending(this.pending);
    }));
  }

  // Orders that came back from the offices undone are laid before whoever gave them, the same morning and once, before the quarter is played:
  // what the engine refused (not what the dice or the quarter's events decided, and not what still waits), what the referee ruled could not be
  // done at all, and what the referee passed over. What is ordered in their place goes through the referee and the engine like any order, with
  // the same authority and the same limits by the quarter; what comes back a second time is read next morning. The replies are kept with the
  // quarter's pending answers, so that a game interrupted here asks nobody twice.
  async amend(actors, log) {
    const w = this.w, cfg = this.cfg; if (this.backend.kind === 'mock' || cfg.amendReturned === false) return;
    const back = new Map(), put = (id, x) => { if (!back.has(id)) back.set(id, []); back.get(id).push(x); }, ok = id => { const r = this.pending.actors[id], ch = w.characters[id]; return !!r && !r.fallback && !r._ops && !!ch?.alive && actors.some(a => a.id === id); };
    for (const r of log.rulings) { if (r.source !== 'referee' || !ok(r.actor) || !String(r.decisionText ?? '').trim()) continue;
      const no = (r.results || []).filter(x => x.ok === false && !x.chance && !x.skipped && !x.waits), never = !(r.probability > 0) && !(r.results || []).length;
      if (!no.length && !never) continue; const rest = (r.results || []).some(x => x.ok !== false && !x.skipped);
      put(r.actor, { order: r.decisionText, ops: JSON.stringify(r.ops ?? []), why: `${never ? `${r.narrative}${r.note ? ` (${r.note})` : ''}` : no.map(x => x.msg).join(' ')}${!never && r.note ? ` (Your secretary adds: ${r.note})` : ''}${rest ? ' Only this part came back: the rest of the order was carried out.' : ''}` }); }
    for (const x of log.passed || []) if (ok(x.actor)) put(x.actor, { order: x.order, ops: '(nothing was entered)', why: 'The office entered nothing for it and gave no reason.' });
    const list = [...back]; if (!list.length) return;
    const kept = this.pending.amend ||= { replies: {}, referee: {} };
    this.setStatus('orders returned', `${list.length} characters reading what came back from the offices`);
    let done = 0;
    await this.withRetry(() => pool(list, cfg.concurrency, async ([id, items]) => {
      if (kept.replies[id]) return; const ch = w.characters[id], text = amendText(items), build = ({ intro, fresh, recap }) => fresh ? `${actorPrompt(w, ch, [], true, { intro, recap })}\n\n${text}` : text;
      let r; try { r = await this.askAs(ch, build, modelFor(cfg, ch)); } catch (e) { if (e instanceof LimitError) throw e; this.report(ch, `No reply to the orders that came back: ${e.message}`); r = {}; }
      const clean = sanitize(r, cfg); kept.replies[id] = { decisions: (Array.isArray(r?.decisions) ? clean.decisions : []).slice(0, Math.max(2, items.length * 2)), monologue: clean.monologue || '' };
      this.store.savePending(this.pending); this.setStatus('orders returned', `${++done}/${list.length} have answered`);
    }));
    const groups = {}; for (const [id, items] of list) { const mine = kept.replies[id]; if (mine?.decisions?.length) (groups[w.characters[id].country] ||= []).push({ actor: w.characters[id], decisions: mine.decisions, returned: items }); }
    const again = Object.entries(groups);
    if (again.length) { this.setStatus('referee judging', `orders given again in ${again.length} countries`);
      await this.withRetry(() => pool(again, cfg.concurrency, async ([cid, entries]) => {
        if (kept.referee[cid]) return; let r;
        try { r = await this.backend.ask(refereePrompt(w, w.countries[cid], entries), cfg.models.referee); } catch (e) { if (e instanceof LimitError) throw e; this.report(null, `No referee reply on the orders given again: ${e.message}`); r = { rulings: [] }; }
        if (!Array.isArray(r?.rulings)) r = { rulings: [] };
        const left = unruled(entries, r).map(l => ({ ...l, returned: entries.find(e => e.actor === l.actor)?.returned }));
        if (left.length) { try { const more = await this.backend.ask(refereePrompt(w, w.countries[cid], left), cfg.models.referee); if (Array.isArray(more?.rulings)) r.rulings.push(...more.rulings); } catch (e) { if (e instanceof LimitError) throw e; this.report(null, `No referee reply to the second request on the orders given again: ${e.message}`); } }
        kept.referee[cid] = r; this.store.savePending(this.pending);
      })); }
    // What was thought and ordered at the second look is part of the morning's record.
    for (const [id] of list) { const mine = kept.replies[id], t = log.trace.find(x => x.actor === id); if (!mine || !t) continue; if (mine.monologue) t.monologue = [t.monologue, mine.monologue].filter(Boolean).join('\n\n'); if (mine.decisions.length) t.amended = mine.decisions; t.returned = back.get(id).map(x => x.order); }
    for (const [cid, entries] of again) { const r = kept.referee[cid];
      for (const h of (Array.isArray(r?.rulings) ? r.rulings : []).filter(h => h && typeof h === 'object')) { const e = entries.find(x => x.actor.id === h.actor), text = e?.decisions[h.decision]; if (!e || text == null) continue;
        log.rulings.push(this.applyRuling(e.actor, { narrative: String(h.narrative || '').slice(0, 1500), note: String(h.note || '').slice(0, 1500), prob: Number.isFinite(Number(h.probability ?? 1)) ? clamp(Number(h.probability ?? 1), 0, 1) : 1, public: !!h.public, ops: Array.isArray(h.operations) ? h.operations.slice(0, 16) : [], decision: h.decision, decisionText: text, source: 'referee', again: true })); }
      for (const { actor: ch, decisions, indices } of unruled(entries, r)) decisions.forEach((d, k) => { this.report(ch, `The referee gave no ruling on the order given again ${indices[k]}: ${d.slice(0, 160)}`); ch.outcomes.push(`${w.date ?? quarterLabel(w.turn)}: Given again the same morning. Not carried out, no ruling was given: ${d.slice(0, 200)}`); ch.outcomes = ch.outcomes.slice(-60); (ch.newOutcomes ||= []).push(ch.outcomes.at(-1)); }); }
  }

  // Letters to people nobody plays are answered for them, country by country, from what the engine knows of each. They are written once the
  // quarter's orders have been carried out and the quarter has been played, so that a banker who was asked to sell a note this quarter writes
  // that he has sold it, or why he would not, and a keeper of the treasury writes the reserve as the quarter left it: the answers are in the
  // inbox next morning beside the morning's own figures, and the two agree. (World 19: a prince read "one thousand and forty-two" in his
  // treasurer's letter and "three hundred and ninety-seven" on his desk the same morning, and resolved to find out which clerk was lying.)
  async answerLetters(actors, log) {
    const w = this.w, cfg = this.cfg;
    if (this.backend.kind === 'mock') return;
    const mail = {};
    for (const ch of actors) for (const m of this.pending.actors[ch.id]?.messages ?? []) { const to = recipient(w, m.to, ch, m.text); if (to?.alive && to.status === 'free' && isMinor(to) && !to.aiControlled && to.id !== ch.id) (mail[to.country] ||= []).push({ from: ch, to, text: m.text }); }
    const posts = Object.entries(mail).filter(([cid]) => w.countries[cid]?.alive && !this.pending.replies?.[cid]);
    if (!posts.length) { this.deliverReplies(log); return; }
    this.setStatus('referee judging', `answering ${posts.reduce((a, [, l]) => a + l.length, 0)} letters to people around the seats`);
    await this.withRetry(() => pool(posts, cfg.concurrency, async ([cid, letters]) => {
      let r;
      try { r = await this.backend.ask(courtPrompt(w, w.countries[cid], letters.slice(0, 24)), cfg.models.referee); }
      catch (e) { if (e instanceof LimitError) throw e; this.report(null, `No replies written for the people of ${w.countries[cid]?.name}: ${e.message}`); r = { replies: [] }; }
      (this.pending.replies ||= {})[cid] = (Array.isArray(r?.replies) ? r.replies : []).filter(x => x && typeof x.text === 'string').slice(0, 24).map(x => ({ from: String(x.from), to: String(x.to), text: x.text.slice(0, 3000) }));
      this.store.savePending(this.pending);
    }));
    this.deliverReplies(log);
  }
  deliverReplies(log) {
    const w = this.w;
    for (const rs of Object.values(this.pending.replies || {})) for (const r of rs) { const from = w.characters[r.from], to = w.characters[r.to]; if (!(from?.alive && from.status === 'free' && isMinor(from) && !from.aiControlled && to?.alive)) continue; const m = { from, to: to.id, text: r.text, npc: true }; this.post(m); log.messages.push(this.posted(m)); }
  }
  // One letter through the post: delivered, or returned to its writer; read by the censor of a prison or copied by a watchful state on the way.
  post(m) {
    const w = this.w, target = recipient(w, m.to, m.from, m.text);
    if (!target?.alive || target.id === m.from.id) { m.undelivered = true; bounce(w, m, target); }
    if (target) m.to = target.id === w.countries[m.to]?.leader ? m.to : target.id;
    if (m.undelivered) return;
    if (!m.read) target.inbox.push({ turn: w.turn, from: `${m.from.name} (${m.from.id}, ${w.countries[m.from.country]?.name})`, text: m.text, letter: true });
    noteLetter(w, m.from, target);
    // A prisoner's letters pass through the censor's hands; how often they are copied depends on how good the state's eyes are.
    const home = w.countries[m.from.country], warden = w.characters[home?.leader];
    if (m.from.status === 'imprisoned' && target?.alive && warden?.alive && warden.id !== target.id && rand(w) < clamp(.25 + home.intelligence / 150, .25, .85)) { warden.inbox.push({ turn: w.turn, from: 'Prison censor', text: `Letter from the prisoner ${m.from.name} to ${target.name}: ${m.text}` }); m.intercepted = true; }
    // Every other letter goes by the post, where a watchful state copies some of them.
    else if (target?.alive) { const readers = openPost(w, m.from, target, m.text); if (readers.length) { m.intercepted = true; m.readBy = readers; } }
  }

  execute(actors) {
    const w = this.w, cfg = this.cfg, trace = [], rulings = [], passed = [];
    const awake = new Set(actors.map(a => a.id));
    const outgoing = [];
    // Those who woke have read their mail: it is cleared now, before anything is carried out, so that what this quarter's acts send them
    // (an arrest order, a plot invitation, a blackmail note, an offer) is still there next morning. Someone who failed to answer has read nothing.
    // Somebody whose list was empty when the quarter closed is told so next morning: an order that never reached the clerks must not look
    // like an order the clerks lost.
    for (const ch of actors) { const r = this.pending.actors[ch.id]; if (r?.fallback) continue; ch.newOutcomes = r && !r._ops && !r.decisions?.length ? [`${w.date ?? quarterLabel(w.turn)}: No order of yours was put in hand: your list of decisions was empty when the quarter closed.`] : []; ch.inbox = []; delete ch.reportsDue; }
    for (const ch of currentActors(w)) {
      const c = w.countries[ch.country];
      const ai = isAI(cfg, c, ch);
      const r = awake.has(ch.id) ? this.pending.actors[ch.id] : null;
      if (r && !r.fallback) {
        ch.lastWake = w.turn;
        if (r.identity) ch.persona = r.identity;
        if (r.publicFace) ch.publicFace = r.publicFace;
        if (r.notes) { ch.diary.push(`${w.date || 'Start'}: ${r.notes}`); ch.diary = ch.diary.slice(-60); }
        for (const m of r.messages) outgoing.push({ from: ch, ...m });
        trace.push({ actor: ch.id, country: c.id, role: ch.role, name: ch.name, ai, model: ai ? ch.model ?? null : null, standing: seated(w, ch) ? 'in office' : ch.status === 'free' ? 'out of office' : ch.status, health: ch.condition ? { kind: ch.condition.kind, severity: ch.condition.severity } : null, publicFace: ch.publicFace ?? '', persona: ch.persona, lookups: (this.pending.lookups?.[ch.id] || []).map(a => a.q), monologue: r.monologue, decisions: r.decisions, messages: r.messages, notes: r.notes });
        if (r._ops) for (const op of r._ops) rulings.push(this.applyRuling(ch, { narrative: describe(op), prob: 1, public: false, ops: [op], source: 'mock' }));
      } else if (seated(w, ch) && !ai) {
        // Only people who are played by rules act by rules. An AI character who was not woken, or whose answer did not arrive, does nothing that quarter.
        const ops = npcDecide(w, ch);
        if (ops.length) { for (const op of ops) rulings.push(this.applyRuling(ch, { narrative: describe(op), prob: 1, public: false, ops: [op], source: 'rule' })); }
      }
    }
    for (const [cid, r] of Object.entries(this.pending.referee)) {
      for (const h of (Array.isArray(r?.rulings) ? r.rulings : []).filter(h => h && typeof h === 'object')) {
        const ch = w.characters[h.actor];
        if (!ch || !actors.some(a => a.id === ch.id)) continue;
        rulings.push(this.applyRuling(ch, { narrative: String(h.narrative || '').slice(0, 1500), note: String(h.note || '').slice(0, 1500), prob: Number.isFinite(Number(h.probability ?? 1)) ? clamp(Number(h.probability ?? 1), 0, 1) : 1, public: !!h.public, ops: Array.isArray(h.operations) ? h.operations.slice(0, 16) : [], decision: h.decision, decisionText: this.pending.actors[ch.id]?.decisions?.[h.decision], source: 'referee' }));
      }
    }
    // What the referee still left without a ruling is written down and told to the person who decided it.
    for (const ch of actors) {
      const mine = this.pending.actors[ch.id], ruled = this.pending.referee[ch.country];
      if (!mine?.decisions?.length || mine._ops || mine.fallback || !ruled) continue;
      for (const { decisions, indices } of unruled([{ actor: ch, decisions: mine.decisions }], ruled)) decisions.forEach((d, k) => {
        passed.push({ actor: ch.id, order: d });
        this.report(ch, `The referee gave no ruling on decision ${indices[k]}: ${d.slice(0, 160)}`);
        ch.outcomes.push(`${w.date ?? quarterLabel(w.turn)}: Not carried out, no ruling was given: ${d.slice(0, 200)}`); ch.outcomes = ch.outcomes.slice(-60); (ch.newOutcomes ||= []).push(ch.outcomes.at(-1));
      });
    }
    // Those who never read their mail (rule-based players, sleepers) do not keep every letter for ever.
    for (const ch of Object.values(w.characters)) if (ch.inbox.length > 40) ch.inbox = ch.inbox.slice(-40);
    for (const m of outgoing) this.post(m);
    // Notes the engine's keeper left in the world file (a fault found and corrected, a save repaired) go into the record once, with the quarter they were read in.
    return { trace, rulings, passed, system: [...(w.engineNotes || []).splice(0), ...(this.sysLog ||= []).splice(0)], messages: outgoing.map(m => this.posted(m)) };
  }
  // A letter as the record keeps it.
  posted(m) { const w = this.w, target = recipient(w, m.to, m.from, m.text); return { from: m.from.id, fromName: m.from.name, fromCountry: m.from.country, to: m.to, toActor: target?.id, toCountry: target?.country, toName: w.characters[m.to]?.name ?? w.countries[m.to]?.name ?? m.to, text: m.text, undelivered: !!m.undelivered, intercepted: !!m.intercepted, readBy: m.readBy ?? [], npc: !!m.npc, read: !!m.read, round: m.round ?? 0 }; }

  // The dice are rolled only for what the engine cannot judge: an act that no operation carries (a go-between who may not get through, a letter
  // that may be stopped). Whatever an operation does, the engine judges for itself: whether there is a road, money, ships on station, authority,
  // whether men follow and whether a secret holds; a referee's doubt about such a fact is not a chance. (World 13: a landing ordered "if a sea
  // route can be found" was given six chances in ten and lost the roll, so that nobody ever looked for the route.) A probability of nought is
  // still the referee saying that the thing cannot be done at all.
  // One operation of a ruling may hang on the engine's answer to an earlier one: if_done n is carried out only if operation n was, if_refused n
  // only if the engine refused it ("land if the way is open; if not, dig in where they stand"). Where the earlier one waits on events of the
  // quarter (ships still on their way), what hangs on it waits with it. An attack is such an order whatever the quarter: it is accepted today and
  // decided by the fighting, so what hangs on an offensive (or on a move against ground the enemy holds) waits for the place to fall, or for the
  // attack on it to fail (ops.js hangOn, carryTaken); and an operation may name the place it waits for itself (once_taken).
  applyRuling(ch, { narrative, note, prob, public: pub, ops, source, decision, decisionText, again = false }) {
    const w = this.w, c = w.countries[ch.country];
    // The order's own word says whom it means. Where the order names exactly one person by number and the office entered somebody the
    // order never mentions, the person the order names is the one meant.
    // (World 24: "Put Maria Ur-Nanna (K31) ... under police watch" was entered as a watch on K294, the commander of the sovereign's guard,
    // who was watched for a quarter while the woman the empress meant was not.)
    if (source === 'referee' && decisionText) ops = ops.map(op => namedPerson(w, op, decisionText));
    const chancy = op => op?.op === 'custom', diced = prob > 0 && prob < 1 && (!ops.length || ops.some(chancy)), luck = prob >= 1 || (prob > 0 && (!diced || rand(w) < prob));
    const results = prob > 0 ? carryList(w, ch, ops, (plain, op) => (op?._misnamed ?? plain?._misnamed) ? misnamed(w, op?._misnamed ?? plain._misnamed) : chancy(op) && !luck ? { ok: false, chance: true, msg: 'It did not come off.' } : plain.op === 'report' ? orderReport(w, ch, plain) : safeApply(w, ch, plain)) : [];
    // The ruling as a whole failed if the dice went against it and nothing else in it was done.
    const success = prob > 0 && (luck || results.some(r => !r.chance && !r.skipped && r.ok !== false));
    const refused = results.filter(r => r.ok === false), carried = success && (!results.length || refused.length < results.length), waits = results.some(r => r.waits);
    // What is announced is what happened: an order the world refused does not make the papers as if it had been done. And what was never meant for the
    // papers is not in them: the engine, not the referee's flag, keeps orders to troops, secret-service work and secret treaties out of print. A word
    // or a gesture that no operation carries is printed where there is a press to print it; from a gagged country it travels as rumour does.
    // And only what happened in full: where the world refused any part of an order, or part of it still waits on the quarter, the account of
    // the whole is not printed as done (what was carried out makes its own news where the engine prints news of it). Nor is a sentence
    // about the ruling itself: what the clerks could not enter is told to whoever gave the order, not to the country.
    // (World 18: "has Renzo Albano arrested" was printed of an arrest that had been stood off; "founds a weekly" of a founding that was
    // refused; and "the engine cannot wait on that figure", "no operation open to the chief of staff pays money to the families" and "no
    // offer of a second tranche of 50 is on the table" stood in the papers of three states.)
    const fit = fitToPrint(narrative), printed = !!(fit && pub && carried && !refused.length && !waits && source === 'referee' && printable(w, ops));
    if (printed) news(w, `${c?.name ?? ''}: ${fit}`, { kind: 'politics', countries: [ch.country], ...(ops.every(op => op?.op === 'custom') && (c?.pressFreedom ?? 50) < 35 && c?.leader !== ch.id ? { hush: true } : {}) });
    // The person who gave the order is told what actually came of it, in the engine's own words, not only what was intended.
    // The same verdict the character reads is kept in the record, so that whoever watches reads what the character read (panel).
    let told = null;
    if (source === 'referee' && narrative) {
      const plain = m => m && !['Applied.', 'Recorded.'].includes(m), said = results.filter(r => plain(r.msg)).map(r => `${r.ok ? '' : `${r.op} was NOT carried out: `}${r.msg}`).join(' ');
      // A decision that no operation carried (an instruction to one's people, a resolve, a speech) is told back as what it was. (World 16: such
      // rulings came back "Succeeded", and a ruler waited ten quarters for an account he had "successfully" ordered.)
      const words = !said && !results.some(r => !['custom', 'noop'].includes(r.op));
      const verdict = !success ? 'Failed' : refused.length === results.length && results.length ? 'Not carried out' : refused.length ? 'Only partly carried out' : waits ? (results.some(r => String(r.waits).startsWith('take:')) ? 'Ordered; part of it waits on the fighting' : 'Ordered, and waiting on the quarter') : words ? (printed ? 'Said, and it is in the papers; nothing else was set in motion' : 'Recorded as words only; nothing was set in motion') : 'Succeeded';
      told = verdict;
      ch.outcomes.push(`${w.date ?? quarterLabel(w.turn)}: ${again ? 'Given again the same morning. ' : ''}${verdict}: ${narrative}${note ? ` (Your secretary adds: ${note})` : ''}${said ? ` [${said.slice(0, 1500)}]` : ''}`); ch.outcomes = ch.outcomes.slice(-60); (ch.newOutcomes ||= []).push(ch.outcomes.at(-1));
    }
    // What is recorded as the probability is the chance that was actually rolled; where the referee named one and no dice were due, its figure is kept beside it.
    return { actor: ch.id, name: ch.name, country: ch.country, role: ch.role, narrative, ...(note ? { note } : {}), probability: diced || prob <= 0 ? prob : 1, ...(prob > 0 && prob < 1 && !diced ? { refereeProbability: prob } : {}), success, ...(told ? { verdict: told } : {}), results, source, decision, decisionText, ops, printed, ...(again ? { again: true } : {}) };
  }

  async turn() {
    const w = this.w;
    if (w.status === 'founding') { await this.found(); return; }
    this.pending = this.store.loadPending(w.turn) || { turn: w.turn, actors: {}, referee: {} };
    beginTurn(w);
    const actors = await this.think();
    await this.negotiate(actors);
    await this.judge(actors);
    this.setStatus('world processing', 'Calculating economy, war and politics');
    const before = snapshotState(w), log = this.execute(actors);
    await this.amend(actors, log);
    this.setStatus('world processing', 'Calculating economy, war and politics');
    // A mind that ran out dies before the quarter is played, so that the seat passes and the annals see it (annals.js).
    this.wearStep();
    stepWorld(w);
    await this.answerLetters(actors, log);
    const entries = buildEntries(w, log, before, this.pending.lookups);
    this.store.commit(w, entries);
    await this.artStep(entries);
    if (this.backend.resetUsage) this.store.saveUsage?.({ t: w.turn, ...this.backend.resetUsage() });
    this.store.clearPending();
    this.onUpdate?.({ type: 'turn', turn: w.turn });
  }

  async run(maxTurns) {
    while (!this.stop && aliveCountries(this.w).length > 0 && (this.w.status === 'founding' || !maxTurns || this.w.turn < maxTurns)) {
      if (this.paused) { this.setStatus('paused', 'Start from the panel to continue.'); while (this.paused && !this.stop) await new Promise(r => setTimeout(r, 500)); continue; }
      await this.turn();
      this.setStatus('turn complete', this.w.date || '');
      if (this.cfg.turnDelayMs) await new Promise(r => setTimeout(r, this.cfg.turnDelayMs));
    }
    this.setStatus('finished', 'The simulation stopped.');
  }
}

// A letter may be addressed by id, by country or by name.
// A message addressed to a conference that is sitting goes to every government at the table: the host and whoever was invited and has not
// declined. Only a government with a seat there can speak to it; from anyone else it is a letter to nobody.
// What of a referee's account a newspaper could print: its sentences about the world, without those about the ruling itself (what could not
// be entered, what the engine can or cannot do, what is or is not on the table). Empty when nothing else is left.
// ("operation" alone is a word of war as well as of the office: only the office's uses of it are struck out.)
const CLERKS = /\b(engine|no (such )?operations?|operations? (open|available|known|listed|exists?|for this|that (carries|pays|does))|cannot be (carried|entered|ordered|done|paid)|could not be (carried|entered|ordered|done|paid)|(is|was|are|were) not carried|not on the table|no such (paper|offer|contract|person|unit|province|bill)|instruction only|undertakings? only|only as a promise|is on record to receive|names no (newspaper|person|sum|province)|needs? a new order)\b/i;
export const fitToPrint = text => String(text || '').split(/(?<=[.!?])\s+/).filter(s => s.trim() && !CLERKS.test(s)).join(' ').trim();

export function toTable(w, ch, messages) {
  return (messages || []).flatMap(m => {
    const cf = (w.conferences || []).find(x => x.open && x.id === String(m.to).trim()); if (!cf) return [m];
    const seats = [cf.host, ...cf.invited.filter(id => !cf.declined.includes(id))];
    if (!seats.includes(ch.country) || w.countries[ch.country]?.leader !== ch.id) return [m];
    return seats.filter(id => id !== ch.country && w.countries[id]?.alive).map(id => ({ ...m, to: id, text: `[To the conference ${cf.id} on "${cf.question}"] ${m.text}` }));
  });
}
// Who a letter is for. An id is surest, but people address letters as people do: by a full name, by the way the sender of an incoming letter was
// shown ("Name (K5, Country)"), by a name with a rank in front of it, by a seat ("my ruler", "the chief of staff of Laresh"), by a state (its ruler),
// by a firm (its owner), or by a surname only one living person bears. In five games one letter in eight went to "K12", the example in the answer
// format, and was lost without a word to the writer; what finds no one now comes back to whoever wrote it (see bounce).
const SEATS = [['general', /\b(chief of (the )?(general )?staff|general staff|commander[- ]in[- ]chief)\b/], ['opposition', /\bopposition\b/], ['oligarch', /\b(magnate|oligarch)\b/], ['leader', /\b(ruler|leader|president|chairman|chairwoman|king|queen|prince|princess|premier|prime minister|head of state|sovereign|majesty|regent)\b/]];
// A letter addressed to a state goes to whoever governs it, unless its first line greets somebody else of that state by name: "Ines Cordero,
// I thank you for your offer of steel" under the address of her country is hers. (World 18: four such letters to a mill owner were laid on
// her ruler's desk, who read them as a leak.)
const greeted = (w, state, text, living) => { const head = String(text ?? '').slice(0, 90).toLowerCase(), hit = living.filter(x => x.country === state.id && head.includes(x.name.toLowerCase())); return hit.length === 1 && hit[0].id !== state.leader ? hit[0] : null; };
export function recipient(w, to, from = null, text = '') {
  const key = String(to ?? '').trim(); if (!key) return null;
  if (w.countries[key]?.alive && text) { const g = greeted(w, w.countries[key], text, Object.values(w.characters).filter(x => x.alive)); if (g) return g; }
  const own = (o, k) => o && Object.hasOwn(o, k) ? o[k] : undefined, direct = own(w.characters, key) ?? own(w.characters, key.toUpperCase()) ?? w.characters[own(w.countries, key)?.leader]; if (direct) return direct;
  const ids = key.match(/\b[KU]\d+\b/g) || [], byId = ids.map(id => w.characters[id]).find(Boolean); if (byId) return byId;
  const low = key.toLowerCase().replace(/^k[\s?\-:.]+/, ''), bare = low.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').replace(/[\s.,;:]+$/, '').trim(), living = Object.values(w.characters).filter(x => x.alive);
  const named = living.find(x => x.name.toLowerCase() === bare); if (named) return named;
  const states = Object.values(w.countries).filter(c => c.alive), state = states.find(c => c.name.toLowerCase() === bare) ?? ids.map(id => w.countries[id]).find(c => c?.alive) ?? states.find(c => low.includes(c.name.toLowerCase()));
  const seat = SEATS.find(([, re]) => re.test(bare))?.[0], home = state ?? w.countries[from?.country];
  if (seat && home?.alive && !living.some(x => bare.endsWith(x.name.toLowerCase()))) return w.characters[home[seat]] ?? null;
  if (state && (bare === state.name.toLowerCase() || !bare)) return (text && greeted(w, state, text, living)) || (w.characters[state.leader] ?? null);
  const titled = living.filter(x => bare.endsWith(x.name.toLowerCase())); if (titled.length === 1) return titled[0];
  const firm = Object.values(w.firms || {}).find(f => f.name?.toLowerCase() === bare && w.characters[f.owner]?.alive); if (firm) return w.characters[firm.owner];
  const sur = bare.split(' ').at(-1), same = living.filter(x => x.name.toLowerCase().split(' ').at(-1) === sur), near = same.filter(x => x.country === from?.country);
  return near.length === 1 ? near[0] : same.length === 1 ? same[0] : null;
}
// A letter that finds no one comes back, so that nobody writes to a ruler for twenty quarters and takes the silence for an answer.
function bounce(w, m, target) {
  if (m.npc || !m.from?.alive) return;
  const why = target && !target.alive ? `${target.name} is dead` : target?.id === m.from.id ? 'it was addressed to yourself' : 'nobody answers to that name or number';
  m.from.inbox.push({ turn: w.turn, from: 'The post', text: `Your letter addressed to "${String(m.to).slice(0, 80)}" was not delivered: ${why}. It began: "${String(m.text).slice(0, 140)}". A letter reaches a person by the id or the full name given in people, and a state's ruler by the state's id.` });
}

// The decisions of each actor that have no ruling yet, with their original numbers.
function unruled(entries, r) {
  const has = (id, i) => (r?.rulings || []).some(h => h?.actor === id && Number(h.decision) === i), out = [];
  for (const e of entries) {
    const idx = e.decisions.map((_, i) => e.indices?.[i] ?? i).filter(i => !has(e.actor.id, i));
    if (idx.length) out.push({ actor: e.actor, decisions: idx.map(i => e.decisions[(e.indices ?? e.decisions.map((_, k) => k)).indexOf(i)]), indices: idx });
  }
  return out;
}

// What comes from outside the engine carries no inner switches: only the engine itself marks an operation as law or decree.
function safeApply(w, ch, op) { try { const { _law, _decree, _late, ...plain } = op ?? {}; return applyOp(w, ch, plain); } catch (e) { return { ok: false, msg: `Error: ${e.message}` }; } }

// "Have the treasury bring me the accounts", "the staff is to report on the frontier": an order to one's own people to lay a matter before one
// is a lookup ordered for the next morning. It is answered then, fresh, from the same reports and under the same limits as a lookup.
function orderReport(w, ch, op) {
  // Several matters named in one breath are several matters. (World 17: "trade, stocks, economy" was looked for as one head, and refused.)
  const topics = [...new Set([].concat(op.topic ?? op.topics ?? []).flatMap(t => String(t).split(/\s*[,;]\s*|\s+and\s+/)).map(t => t.trim()).filter(Boolean))].slice(0, 8);
  if (!topics.length) return { ok: false, msg: 'Say what is to be laid before you: a matter a lookup can ask for (budget, army, borders, building:P12, person:K12, war_plan:U3 and the like).' };
  const bad = topics.filter(t => /^No information on /.test(String(answer(w, ch, t))));
  if (bad.length) return { ok: false, msg: `Nobody in your offices keeps a report under that head: ${bad.join(', ')}. What your people can lay before you is what a lookup can ask for.` };
  ch.reportsDue = [...new Set([...(ch.reportsDue || []), ...topics])].slice(0, 8);
  return { ok: true, msg: `Your people will lay it on your desk tomorrow morning: ${topics.join(', ')}.` };
}

function sanitize(r, cfg) {
  if (!r || r.fallback) return { fallback: true };
  const messages = (Array.isArray(r.messages) ? r.messages : []).filter(m => m && typeof m === 'object').slice(0, cfg.maxMessagesPerActor).map(m => ({ to: String(m.to || ''), text: String(m.text || '').slice(0, 6000) })).filter(m => m.to && m.text);
  // The cuts below only stop a runaway answer; nobody is asked to be brief.
  const out = { identity: String(r.identity || '').slice(0, 6000), publicFace: String(r.public_face || '').slice(0, 600), monologue: String(r.inner_voice || '').slice(0, 12000), decisions: (Array.isArray(r.decisions) ? r.decisions : []).slice(0, cfg.maxDecisionsPerActor).map(x => String(x).slice(0, 3000)), messages, notes: String(r.notes || '').slice(0, 6000) };
  if (r._ops) out._ops = r._ops;
  return out;
}

const OP_LABEL = { set_tax: 'tax adjustment', set_budget: 'budget change', set_tariff: 'customs tariff', print_money: 'printing money', move_army: 'army movement', declare_war: 'declaration of war', propose_treaty: 'treaty proposal', accept_treaty: 'treaty acceptance', repress: 'repression', concession: 'concession', purge: 'purge', start_plot: 'starting a plot', invite_plot: 'inviting to a plot', execute_plot: 'executing a plot', propaganda: 'propaganda', capital_flight: 'capital flight', recruit: 'recruitment' };
const describe = op => OP_LABEL[op.op] || op.op;

function mockThought(w, ch) {
  const ops = npcDecide(w, ch), c = w.countries[ch.country];
  const others = aliveCountries(w).filter(o => o.id !== c.id);
  const messages = rand(w) < .25 && others.length ? [{ to: others[Math.floor(rand(w) * others.length)].id, text: `On behalf of ${c.name}: calm on our borders serves us both.` }] : [];
  return { inner_voice: `(Test agent) Unrest ${Math.round(c.unrest ?? 0)}, legitimacy ${Math.round(c.legitimacy)}. I decide by rules.`, decisions: ops.map(describe), messages: messages, notes: '', _ops: ops };
}
