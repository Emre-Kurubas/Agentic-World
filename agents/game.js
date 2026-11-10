import { randomUUID } from 'node:crypto';
import { aliveCountries, ROLES, countryProvinces } from '../engine/world.js';
import { beginTurn, stepWorld } from '../engine/step.js';
import { applyOp } from '../engine/ops.js';
import { news, rand, clamp, quarterLabel } from '../engine/util.js';
import { openPost } from '../engine/court.js';
import { burden } from '../engine/burdens.js';
import { npcDecide } from './npc.js';
import { actorPrompt, refereePrompt, lookupReply, talkText } from './prompts.js';
import { answer } from './queries.js';
import { LimitError, SessionLostError } from './backend.js';
import { snapshotState, buildEntries } from './ledger.js';
import { isPaintable, portraitPrompt, paintingPrompt, parseArt, witnessFor } from './art.js';
import { incapacitated } from '../engine/health.js';
import { hashOf } from '../engine/names.js';

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

// Which model plays whom. A cast list is dealt round the table so that every role is played by every model somewhere;
// without one, leaders get one model and everyone else another. assign pins a person, a seat ("U2.general") or a role.
const FADE_AFTER = 16;
export function castModel(cfg, w, ch) {
  const m = cfg.models ?? {}, pinned = m.assign?.[ch.id] ?? m.assign?.[`${ch.country}.${ch.role}`] ?? m.assign?.[ch.role];
  if (pinned) return pinned;
  const cast = Array.isArray(m.cast) ? m.cast.filter(Boolean) : [];
  if (!cast.length) return ch.role === 'leader' ? m.leader : m.secondary;
  const ci = Object.keys(w.countries).indexOf(ch.country), ri = ROLES.indexOf(ch.role);
  return cast[(w.turn <= 1 && ci >= 0 && ri >= 0 ? ci + ri : hashOf(ch.id)) % cast.length];
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

export class Game {
  constructor({ world, cfg, backend, store, onUpdate }) { Object.assign(this, { w: world, cfg, backend, store, onUpdate }); this.status = 'ready'; this.progress = ''; this.stop = false; this.sessions = store?.loadSessions?.() ?? {}; }
  setStatus(status, progress = '') { this.status = status; this.progress = progress; this.onUpdate?.({ type: 'status', status, progress, turn: this.w.turn }); }

  async withRetry(fn) {
    for (;;) {
      try { return await fn(); }
      catch (e) {
        if (!(e instanceof LimitError)) throw e;
        const until = new Date(Date.now() + this.cfg.limitRetryMinutes * 60000);
        this.store.savePending(this.pending);
        this.setStatus('waiting for limit', `Usage limit reached. Will retry around ${until.toLocaleTimeString('en-US')}. The game will continue from where it left off.`);
        await new Promise(r => setTimeout(r, this.cfg.limitRetryMinutes * 60000));
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
      try {
        const r = await this.backend.ask(build({ intro, fresh, recap }), model, { id: s.id, resume });
        s.done++; if (build.isActor) s.intro = true; this.saveSessions();
        return r;
      } catch (e) {
        if (!(e instanceof SessionLostError)) throw e;
        recap = s.done > 0; fresh = true;
        s = this.sessions[ch.id] = { id: randomUUID(), calls: 0, done: 0, intro: false };
        this.report(ch, recap ? 'Session file not found; opened a new session from the character\'s diary.' : 'The session had not been created yet; reopened.');
      }
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
      this.pending.actors[ch.id] = sanitize(r, cfg);
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
          const target = reachable.get(recipient(w, m.to)?.id);
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
        const clean = sanitize(r, cfg), sentNow = clean.messages.map(m => ({ ...m, round }));
        if (joined) { this.pending.actors[id] = { ...clean, messages: sentNow }; actors.push(ch); }
        else {
          const cur = this.pending.actors[id];
          if (Array.isArray(r?.decisions)) cur.decisions = clean.decisions;
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

  execute(actors) {
    const w = this.w, cfg = this.cfg, trace = [], rulings = [];
    const awake = new Set(actors.map(a => a.id));
    const outgoing = [];
    // Those who woke have read their mail: it is cleared now, before anything is carried out, so that what this quarter's acts send them
    // (an arrest order, a plot invitation, a blackmail note, an offer) is still there next morning. Someone who failed to answer has read nothing.
    for (const ch of actors) if (!this.pending.actors[ch.id]?.fallback) { ch.newOutcomes = []; ch.inbox = []; }
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
      for (const h of Array.isArray(r?.rulings) ? r.rulings : []) {
        const ch = w.characters[h.actor];
        if (!ch || !actors.some(a => a.id === ch.id)) continue;
        rulings.push(this.applyRuling(ch, { narrative: String(h.narrative || '').slice(0, 1500), prob: clamp(Number(h.probability ?? .5), 0, 1), public: !!h.public, ops: Array.isArray(h.operations) ? h.operations.slice(0, 16) : [], decision: h.decision, decisionText: this.pending.actors[ch.id]?.decisions?.[h.decision], source: 'referee' }));
      }
    }
    // What the referee still left without a ruling is written down and told to the person who decided it.
    for (const ch of actors) {
      const mine = this.pending.actors[ch.id], ruled = this.pending.referee[ch.country];
      if (!mine?.decisions?.length || mine._ops || mine.fallback || !ruled) continue;
      for (const { decisions, indices } of unruled([{ actor: ch, decisions: mine.decisions }], ruled)) decisions.forEach((d, k) => {
        this.report(ch, `The referee gave no ruling on decision ${indices[k]}: ${d.slice(0, 160)}`);
        ch.outcomes.push(`${w.date ?? quarterLabel(w.turn)}: Not carried out, no ruling was given: ${d.slice(0, 200)}`); ch.outcomes = ch.outcomes.slice(-60); (ch.newOutcomes ||= []).push(ch.outcomes.at(-1));
      });
    }
    // Those who never read their mail (rule-based players, sleepers) do not keep every letter for ever.
    for (const ch of Object.values(w.characters)) if (ch.inbox.length > 40) ch.inbox = ch.inbox.slice(-40);
    for (const m of outgoing) {
      const target = recipient(w, m.to);
      if (target) m.to = target.id === w.countries[m.to]?.leader ? m.to : target.id;
      if (!target?.alive) m.undelivered = true;
      else if (!m.read) target.inbox.push({ turn: w.turn, from: `${m.from.name} (${w.countries[m.from.country]?.name})`, text: m.text, letter: true });
      // A prisoner's letters pass through the censor's hands; how often they are copied depends on how good the state's eyes are.
      const home = w.countries[m.from.country], warden = w.characters[home?.leader];
      if (m.from.status === 'imprisoned' && target?.alive && warden?.alive && warden.id !== target.id && rand(w) < clamp(.25 + home.intelligence / 150, .25, .85)) { warden.inbox.push({ turn: w.turn, from: 'Prison censor', text: `Letter from the prisoner ${m.from.name} to ${target.name}: ${m.text}` }); m.intercepted = true; }
      // Every other letter goes by the post, where a watchful state copies some of them.
      else if (target?.alive) { const readers = openPost(w, m.from, target, m.text); if (readers.length) { m.intercepted = true; m.readBy = readers; } }
    }
    // Notes the engine's keeper left in the world file (a fault found and corrected, a save repaired) go into the record once, with the quarter they were read in.
    return { trace, rulings, system: [...(w.engineNotes || []).splice(0), ...(this.sysLog ||= []).splice(0)], messages: outgoing.map(m => { const target = recipient(w, m.to); return { from: m.from.id, fromName: m.from.name, fromCountry: m.from.country, to: m.to, toActor: target?.id, toCountry: target?.country, toName: w.characters[m.to]?.name ?? w.countries[m.to]?.name ?? m.to, text: m.text, undelivered: !!m.undelivered, intercepted: !!m.intercepted, readBy: m.readBy ?? [], read: !!m.read, round: m.round ?? 0 }; }) };
  }

  applyRuling(ch, { narrative, prob, public: pub, ops, source, decision, decisionText }) {
    const w = this.w, c = w.countries[ch.country];
    const success = prob >= 1 || rand(w) < prob;
    const results = success ? ops.map(op => ({ op: op.op, ...safeApply(w, ch, op) })) : [];
    const refused = results.filter(r => r.ok === false), carried = success && (!results.length || refused.length < results.length);
    // What is announced is what happened: an order the world refused does not make the papers as if it had been done.
    if (narrative && pub && carried && source === 'referee') news(w, `${c?.name ?? ''}: ${narrative}`, { kind: 'politics', countries: [ch.country] });
    // The person who gave the order is told what actually came of it, in the engine's own words, not only what was intended.
    if (source === 'referee' && narrative) {
      const plain = m => m && !['Applied.', 'Recorded.'].includes(m), said = results.filter(r => plain(r.msg)).map(r => `${r.ok ? '' : `${r.op} was NOT carried out: `}${r.msg}`).join(' ');
      const verdict = !success ? 'Failed' : !refused.length ? 'Succeeded' : refused.length < results.length ? 'Only partly carried out' : 'Not carried out';
      ch.outcomes.push(`${w.date ?? quarterLabel(w.turn)}: ${verdict}: ${narrative}${said ? ` [${said.slice(0, 1500)}]` : ''}`); ch.outcomes = ch.outcomes.slice(-60); (ch.newOutcomes ||= []).push(ch.outcomes.at(-1));
    }
    return { actor: ch.id, name: ch.name, country: ch.country, role: ch.role, narrative, probability: prob, success, results, source, decision, decisionText, ops };
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
    stepWorld(w);
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
function recipient(w, to) {
  const key = String(to ?? '').trim(), direct = w.characters[key] ?? w.characters[w.countries[key]?.leader];
  if (direct) return direct;
  const low = key.toLowerCase(), person = Object.values(w.characters).find(x => x.alive && x.name.toLowerCase() === low), state = Object.values(w.countries).find(c => c.alive && c.name.toLowerCase() === low);
  return person ?? w.characters[state?.leader] ?? null;
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
function safeApply(w, ch, op) { try { const { _law, _decree, ...plain } = op ?? {}; return applyOp(w, ch, plain); } catch (e) { return { ok: false, msg: `Error: ${e.message}` }; } }

function sanitize(r, cfg) {
  if (!r || r.fallback) return { fallback: true };
  const messages = (Array.isArray(r.messages) ? r.messages : []).slice(0, cfg.maxMessagesPerActor).map(m => ({ to: String(m.to || ''), text: String(m.text || '').slice(0, 6000) })).filter(m => m.to && m.text);
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
