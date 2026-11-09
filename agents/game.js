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
    if (ch?.alive && ch.status === 'serbest' && ch.country === c.id) out.push(ch);
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
  constructor({ world, cfg, backend, store, onUpdate }) { Object.assign(this, { w: world, cfg, backend, store, onUpdate }); this.status = 'hazır'; this.progress = ''; this.stop = false; this.sessions = store?.loadSessions?.() ?? {}; }
  setStatus(status, progress = '') { this.status = status; this.progress = progress; this.onUpdate?.({ type: 'status', status, progress, turn: this.w.turn }); }

  async withRetry(fn) {
    for (;;) {
      try { return await fn(); }
      catch (e) {
        if (!(e instanceof LimitError)) throw e;
        const until = new Date(Date.now() + this.cfg.limitRetryMinutes * 60000);
        this.store.savePending(this.pending);
        this.setStatus('limit bekleniyor', `Kullanım limiti doldu. ${until.toLocaleTimeString('tr-TR')} civarı yeniden denenecek. Oyun kaldığı yerden sürecek.`);
        await new Promise(r => setTimeout(r, this.cfg.limitRetryMinutes * 60000));
        if (this.stop) throw e;
      }
    }
  }

  // Her yapay zekâ karakterinin tek ve kalıcı Claude oturumu vardır. Kayıt çağrıdan önce yazılır ki yarım kalan çağrı da bilinsin.
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
        this.report(ch, recap ? 'Oturum dosyası bulunamadı, karakter günlüğüyle yeni oturum açıldı.' : 'Oturum henüz oluşmamıştı, yeniden açıldı.');
      }
    }
  }

  // Devletler dünya üretiminde hazır devralınır; açılış yalnızca ilk kaydı yazar.
  async found() {
    const w = this.w;
    beginTurn(w);
    for (const c of aliveCountries(w)) news(w, `${c.name}: ${c.regime}, ${c.ideology}. Yönetimde ${w.characters[c.leader]?.name}.`, { kind: 'siyaset', countries: [c.id] });
    w.status = 'oyunda';
    w.newsLog.push(...w.newsThisTurn);
    this.store.commit(w, buildEntries(w, { trace: [], rulings: [] }, null));
    this.onUpdate?.({ type: 'turn', turn: w.turn });
  }

  report(ch, text) { console.error(`[${ch?.name ?? 'hakem'}] ${text}`); }

  async think() {
    const w = this.w, cfg = this.cfg;
    for (const ch of Object.values(w.characters)) ch.aiControlled = !!w.countries[ch.country] && isAI(cfg, w.countries[ch.country], ch);
    const actors = currentActors(w).filter(ch => shouldWake(w, cfg, ch));
    this.setStatus('ajanlar düşünüyor', `${actors.length} karakter karar veriyor`);
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
            // Normalde oturum raporu bilir, sonraki bakışlarda yalnızca yeni cevaplar gider. Yarım kalmışsa her şey yeniden yazılır.
            const build = ({ intro, fresh, recap }) => used === 0 || fresh || again
              ? actorPrompt(w, ch, answers, final, { intro, recap, retry: again })
              : lookupReply(answers.filter(a => a.round === used - 1), final);
            build.isActor = true;
            r = await this.askAs(ch, build, modelFor(cfg, ch));
            retry = false;
            if (final || !Array.isArray(r?.bak) || !r.bak.length) break;
            for (const q of r.bak.slice(0, 6)) answers.push({ q: String(q).slice(0, 40), a: answer(w, ch, q), round: used });
            this.store.savePending(this.pending);
          }
        }
        catch (e) { if (e instanceof LimitError) throw e; this.report(ch, `Yanıt alınamadı, kurala geçti: ${e.message}`); r = { fallback: true }; }
      }
      this.pending.actors[ch.id] = sanitize(r, cfg);
      this.store.savePending(this.pending);
      this.setStatus('ajanlar düşünüyor', `${++done}/${actors.length} karar geldi`);
    }));
    return actors;
  }

  // Aynı çeyrek içinde pazarlık: mesaj alan yapay zekâ karakterler cevap yazar, kararını değiştirir, sırası gelene kadar uyuyan da uyanır.
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
      this.setStatus('ajanlar pazarlık ediyor', `${round}. görüşme, ${unread.size} karakter cevaplıyor`);
      await this.withRetry(() => pool([...unread], cfg.concurrency, async ([id, items]) => {
        const waiting = items.filter(i => !i.m.read);
        if (!waiting.length) return;
        const ch = reachable.get(id), joined = !this.pending.actors[id];
        const text = talkText(waiting.map(i => ({ from: `${i.from.name} (${w.countries[i.from.country]?.name})`, text: i.m.text })), last);
        const build = ({ intro, fresh, recap }) => joined || fresh ? `${actorPrompt(w, ch, [], true, { intro, recap })}\n\n${text}` : text;
        build.isActor = joined;
        let r;
        try { r = await this.askAs(ch, build, modelFor(cfg, ch)); }
        catch (e) { if (e instanceof LimitError) throw e; this.report(ch, `Pazarlık yanıtı alınamadı: ${e.message}`); talk.skip[id] = true; this.store.savePending(this.pending); return; }
        for (const i of waiting) i.m.read = true;
        const clean = sanitize(r, cfg), sentNow = clean.messages.map(m => ({ ...m, round }));
        if (joined) { this.pending.actors[id] = { ...clean, messages: sentNow }; actors.push(ch); }
        else {
          const cur = this.pending.actors[id];
          if (Array.isArray(r?.kararlar)) cur.decisions = clean.decisions;
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
    this.setStatus('hakem değerlendiriyor', `${list.length} ülkenin kararları inceleniyor`);
    await this.withRetry(() => pool(list, cfg.concurrency, async ([cid, entries]) => {
      if (this.pending.referee[cid]) return;
      let r;
      try { r = await this.backend.ask(refereePrompt(w, w.countries[cid], entries), cfg.models.referee); }
      catch (e) { if (e instanceof LimitError) throw e; this.report(null, `Hakem yanıtı alınamadı: ${e.message}`); r = { hukumler: [] }; }
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
        if (r.notes) { ch.diary.push(`${w.date || 'Başlangıç'}: ${r.notes}`); ch.diary = ch.diary.slice(-16); }
        for (const m of r.messages) outgoing.push({ from: ch, ...m });
        trace.push({ actor: ch.id, country: c.id, role: ch.role, name: ch.name, ai, persona: ch.persona, lookups: (this.pending.lookups?.[ch.id] || []).map(a => a.q), monologue: r.monologue, decisions: r.decisions, messages: r.messages });
        if (r._ops) for (const op of r._ops) rulings.push(this.applyRuling(ch, { narrative: describe(op), prob: 1, public: false, ops: [op], source: 'mock' }));
      } else {
        const ops = npcDecide(w, ch);
        if (ops.length) { for (const op of ops) rulings.push(this.applyRuling(ch, { narrative: describe(op), prob: 1, public: false, ops: [op], source: 'kural' })); }
      }
    }
    for (const [cid, r] of Object.entries(this.pending.referee)) {
      for (const h of Array.isArray(r?.hukumler) ? r.hukumler : []) {
        const ch = w.characters[h.aktor];
        if (!ch || !actors.some(a => a.id === ch.id)) continue;
        rulings.push(this.applyRuling(ch, { narrative: String(h.aciklama || '').slice(0, 400), prob: clamp(Number(h.olasilik ?? .5), 0, 1), public: !!h.kamuya_acik, ops: Array.isArray(h.islemler) ? h.islemler.slice(0, 6) : [], decision: h.karar, source: 'hakem' }));
      }
    }
    for (const ch of actors) ch.inbox = [];
    for (const m of outgoing) {
      const target = w.characters[m.to] ?? w.characters[w.countries[m.to]?.leader];
      if (!target?.alive) m.undelivered = true;
      else if (!m.read) target.inbox.push({ turn: w.turn, from: `${m.from.name} (${w.countries[m.from.country]?.name})`, text: m.text });
    }
    return { trace, rulings, messages: outgoing.map(m => { const target = w.characters[m.to] ?? w.characters[w.countries[m.to]?.leader]; return { from: m.from.id, fromName: m.from.name, fromCountry: m.from.country, to: m.to, toActor: target?.id, toCountry: target?.country, toName: w.characters[m.to]?.name ?? w.countries[m.to]?.name ?? m.to, text: m.text, undelivered: !!m.undelivered, read: !!m.read, round: m.round ?? 0 }; }) };
  }

  applyRuling(ch, { narrative, prob, public: pub, ops, source, decision }) {
    const w = this.w, c = w.countries[ch.country];
    const success = prob >= 1 || rand(w) < prob;
    const results = success ? ops.map(op => ({ op: op.op, ...safeApply(w, ch, op) })) : [];
    if (narrative && pub && success && source === 'hakem') news(w, `${c?.name ?? ''}: ${narrative}`, { kind: 'siyaset', countries: [ch.country] });
    if (source === 'hakem' && narrative) { ch.outcomes.push(`${w.date}: ${success ? 'Gerçekleşti' : 'Başarısız'}: ${narrative}`); ch.outcomes = ch.outcomes.slice(-16); (ch.newOutcomes ||= []).push(ch.outcomes.at(-1)); }
    return { actor: ch.id, name: ch.name, country: ch.country, role: ch.role, narrative, probability: prob, success, results, source, decision, ops };
  }

  async turn() {
    const w = this.w;
    if (w.status === 'kuruluyor') { await this.found(); return; }
    this.pending = this.store.loadPending(w.turn) || { turn: w.turn, actors: {}, referee: {} };
    beginTurn(w);
    const actors = await this.think();
    await this.negotiate(actors);
    await this.judge(actors);
    this.setStatus('dünya işliyor', 'Ekonomi, savaş ve siyaset hesaplanıyor');
    const before = snapshotState(w), log = this.execute(actors);
    stepWorld(w);
    this.store.commit(w, buildEntries(w, log, before, this.pending.lookups));
    if (this.backend.resetUsage) this.store.saveUsage?.({ t: w.turn, ...this.backend.resetUsage() });
    this.store.clearPending();
    this.onUpdate?.({ type: 'turn', turn: w.turn });
  }

  async run(maxTurns) {
    while (!this.stop && aliveCountries(this.w).length > 0 && (this.w.status === 'kuruluyor' || !maxTurns || this.w.turn < maxTurns)) {
      if (this.paused) { this.setStatus('durduruldu', 'Devam ettirmek için panelden başlat.'); while (this.paused && !this.stop) await new Promise(r => setTimeout(r, 500)); continue; }
      await this.turn();
      this.setStatus('tur tamamlandı', this.w.date || '');
      if (this.cfg.turnDelayMs) await new Promise(r => setTimeout(r, this.cfg.turnDelayMs));
    }
    this.setStatus('bitti', 'Simülasyon durdu.');
  }
}

function safeApply(w, ch, op) { try { return applyOp(w, ch, op); } catch (e) { return { ok: false, msg: `Hata: ${e.message}` }; } }

function sanitize(r, cfg) {
  if (!r || r.fallback) return { fallback: true };
  const messages = (Array.isArray(r.mesajlar) ? r.mesajlar : []).slice(0, cfg.maxMessagesPerActor).map(m => ({ to: String(m.kime || ''), text: String(m.metin || '').slice(0, 800) })).filter(m => m.to && m.text);
  const out = { identity: String(r.kimlik || '').slice(0, 900), monologue: String(r.ic_ses || '').slice(0, 1200), decisions: (Array.isArray(r.kararlar) ? r.kararlar : []).slice(0, cfg.maxDecisionsPerActor).map(x => String(x).slice(0, 700)), messages, notes: String(r.notlar || '').slice(0, 1500) };
  if (r._ops) out._ops = r._ops;
  return out;
}

const OP_TR = { set_tax: 'vergi ayarı', set_budget: 'bütçe değişikliği', set_tariff: 'gümrük tarifesi', print_money: 'para basma', move_army: 'ordu sevki', declare_war: 'savaş ilanı', propose_treaty: 'antlaşma teklifi', accept_treaty: 'antlaşma kabulü', repress: 'baskı', concession: 'taviz', purge: 'tasfiye', start_plot: 'komplo başlatma', invite_plot: 'komploya davet', execute_plot: 'komployu uygulama', propaganda: 'propaganda', capital_flight: 'sermaye kaçışı', recruit: 'asker toplama' };
const describe = op => OP_TR[op.op] || op.op;

function mockThought(w, ch) {
  const ops = npcDecide(w, ch), c = w.countries[ch.country];
  const others = aliveCountries(w).filter(o => o.id !== c.id);
  const messages = rand(w) < .25 && others.length ? [{ kime: others[Math.floor(rand(w) * others.length)].id, metin: `${c.name} adına: sınırlarımızda sükûnet ikimizin de çıkarına.` }] : [];
  return { ic_ses: `(Deneme ajanı) Huzursuzluk ${Math.round(c.unrest ?? 0)}, meşruiyet ${Math.round(c.legitimacy)}. Kural tabanlı karar veriyorum.`, kararlar: ops.map(describe), mesajlar: messages, notlar: '', _ops: ops };
}
