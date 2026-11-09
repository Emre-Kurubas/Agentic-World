import { randomUUID } from 'node:crypto';
import { aliveCountries, ROLES, countryProvinces } from '../engine/world.js';
import { beginTurn, stepWorld } from '../engine/step.js';
import { applyOp } from '../engine/ops.js';
import { news, rand, clamp } from '../engine/util.js';
import { npcDecide } from './npc.js';
import { actorPrompt, refereePrompt, lookupReply, talkText } from './prompts.js';
import { answer } from './queries.js';
import { LimitError, SessionLostError } from './backend.js';
import { snapshotState, buildEntries } from './ledger.js';
import { isPaintable, portraitPrompt, paintingPrompt, parseArt, witnessFor } from './art.js';

export function rolesFor(cfg, c) {
  const root = c.parent ?? c.id;
  const raw = cfg.countryAgentRoles?.[c.id] ?? cfg.countryAgentRoles?.[root] ?? cfg.agentRoles;
  return new Set((raw || []).filter(r => ROLES.includes(r)));
}
export const isAI = (cfg, c, ch) => rolesFor(cfg, c).has(ch.role);

function currentActors(w) {
  const out = [];
  for (const c of aliveCountries(w)) for (const r of ROLES) {
    const ch = w.characters[c[r]];
    if (ch?.alive && ch.status === 'free' && ch.country === c.id) out.push(ch);
  }
  return out;
}

export function shouldWake(w, cfg, ch) {
  const c = w.countries[ch.country];
  if (!isAI(cfg, c, ch)) return false;
  if (ch.role === 'leader') return true;
  if ((c.tension ?? 0) >= cfg.wakeTension) return true;
  if (ch.inbox.length) return true;
  if (w.plots.some(p => p.active && [p.leader, ...p.members].includes(ch.id))) return true;
  return w.turn - ch.lastWake >= cfg.wakeEvery;
}

const modelFor = (cfg, ch) => ch.role === 'leader' ? cfg.models.leader : cfg.models.secondary;

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
        const text = await backend.askText(item.kind === 'portrait' ? portraitPrompt(w, ch) : paintingPrompt(w, ch, item.entry), cfg.models.art ?? cfg.models.leader), art = parseArt(text);
        if (art) store.saveArt({ id: item.kind === 'portrait' ? `portrait-${ch.id}` : `painting-${item.entry.id}`, kind: item.kind, turn: item.entry?.t ?? w.turn, date: item.entry?.d ?? w.date, character: item.kind === 'portrait' ? ch.id : null, witness: item.kind === 'event' ? ch.id : null, witnessName: ch.name, event: item.entry?.text ?? null, country: ch.country, caption: art.caption, prompt: art.prompt }, art.svg);
        else this.report(ch, 'The image response had no valid SVG.');
        remaining.splice(remaining.indexOf(item), 1);
      } catch (e) { if (e instanceof LimitError) stop = true; else { this.report(ch, `Could not paint the image: ${e.message}`); remaining.splice(remaining.indexOf(item), 1); } }
    });
    store.saveArtQueue(remaining);
  }

  async think() {
    const w = this.w, cfg = this.cfg;
    for (const ch of Object.values(w.characters)) ch.aiControlled = !!w.countries[ch.country] && isAI(cfg, w.countries[ch.country], ch);
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
            for (const q of r.lookup.slice(0, 6)) answers.push({ q: String(q).slice(0, 40), a: answer(w, ch, q), round: used });
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
          const target = reachable.get(m.to) ?? reachable.get(w.countries[m.to]?.leader);
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
      this.pending.referee[cid] = r;
      this.store.savePending(this.pending);
    }));
  }

  execute(actors) {
    const w = this.w, cfg = this.cfg, trace = [], rulings = [];
    const awake = new Set(actors.map(a => a.id));
    const outgoing = [];
    for (const ch of actors) if (!this.pending.actors[ch.id]?.fallback) ch.newOutcomes = [];
    for (const ch of currentActors(w)) {
      const c = w.countries[ch.country];
      const ai = isAI(cfg, c, ch);
      const r = awake.has(ch.id) ? this.pending.actors[ch.id] : null;
      if (r && !r.fallback) {
        ch.lastWake = w.turn;
        if (r.identity) ch.persona = r.identity;
        if (r.notes) { ch.diary.push(`${w.date || 'Start'}: ${r.notes}`); ch.diary = ch.diary.slice(-16); }
        for (const m of r.messages) outgoing.push({ from: ch, ...m });
        trace.push({ actor: ch.id, country: c.id, role: ch.role, name: ch.name, ai, persona: ch.persona, lookups: (this.pending.lookups?.[ch.id] || []).map(a => a.q), monologue: r.monologue, decisions: r.decisions, messages: r.messages, notes: r.notes });
        if (r._ops) for (const op of r._ops) rulings.push(this.applyRuling(ch, { narrative: describe(op), prob: 1, public: false, ops: [op], source: 'mock' }));
      } else {
        const ops = npcDecide(w, ch);
        if (ops.length) { for (const op of ops) rulings.push(this.applyRuling(ch, { narrative: describe(op), prob: 1, public: false, ops: [op], source: 'rule' })); }
      }
    }
    for (const [cid, r] of Object.entries(this.pending.referee)) {
      for (const h of Array.isArray(r?.rulings) ? r.rulings : []) {
        const ch = w.characters[h.actor];
        if (!ch || !actors.some(a => a.id === ch.id)) continue;
        rulings.push(this.applyRuling(ch, { narrative: String(h.narrative || '').slice(0, 400), prob: clamp(Number(h.probability ?? .5), 0, 1), public: !!h.public, ops: Array.isArray(h.operations) ? h.operations.slice(0, 6) : [], decision: h.decision, decisionText: this.pending.actors[ch.id]?.decisions?.[h.decision], source: 'referee' }));
      }
    }
    for (const ch of actors) ch.inbox = [];
    for (const m of outgoing) {
      const target = w.characters[m.to] ?? w.characters[w.countries[m.to]?.leader];
      if (!target?.alive) m.undelivered = true;
      else if (!m.read) target.inbox.push({ turn: w.turn, from: `${m.from.name} (${w.countries[m.from.country]?.name})`, text: m.text });
    }
    return { trace, rulings, system: (this.sysLog ||= []).splice(0), messages: outgoing.map(m => { const target = w.characters[m.to] ?? w.characters[w.countries[m.to]?.leader]; return { from: m.from.id, fromName: m.from.name, fromCountry: m.from.country, to: m.to, toActor: target?.id, toCountry: target?.country, toName: w.characters[m.to]?.name ?? w.countries[m.to]?.name ?? m.to, text: m.text, undelivered: !!m.undelivered, read: !!m.read, round: m.round ?? 0 }; }) };
  }

  applyRuling(ch, { narrative, prob, public: pub, ops, source, decision, decisionText }) {
    const w = this.w, c = w.countries[ch.country];
    const success = prob >= 1 || rand(w) < prob;
    const results = success ? ops.map(op => ({ op: op.op, ...safeApply(w, ch, op) })) : [];
    if (narrative && pub && success && source === 'referee') news(w, `${c?.name ?? ''}: ${narrative}`, { kind: 'politics', countries: [ch.country] });
    if (source === 'referee' && narrative) { ch.outcomes.push(`${w.date}: ${success ? 'Succeeded' : 'Failed'}: ${narrative}`); ch.outcomes = ch.outcomes.slice(-16); (ch.newOutcomes ||= []).push(ch.outcomes.at(-1)); }
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

function safeApply(w, ch, op) { try { return applyOp(w, ch, op); } catch (e) { return { ok: false, msg: `Error: ${e.message}` }; } }

function sanitize(r, cfg) {
  if (!r || r.fallback) return { fallback: true };
  const messages = (Array.isArray(r.messages) ? r.messages : []).slice(0, cfg.maxMessagesPerActor).map(m => ({ to: String(m.to || ''), text: String(m.text || '').slice(0, 800) })).filter(m => m.to && m.text);
  const out = { identity: String(r.identity || '').slice(0, 900), monologue: String(r.inner_voice || '').slice(0, 1200), decisions: (Array.isArray(r.decisions) ? r.decisions : []).slice(0, cfg.maxDecisionsPerActor).map(x => String(x).slice(0, 700)), messages, notes: String(r.notes || '').slice(0, 1500) };
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
