// Olay defteri: bir turda olan her şeyi tek biçimde kayda geçirir.
// Girdi alanları: t tur, d tarih, k tür, s kaynak, n kişi, c ülkeler, a kişi kimlikleri,
// p konum, ok başarı, imp önem (0-3), text metin, x türe özel ayrıntı.

const MAX_TEXT = 2000, MAX_ANSWER = 1500;
const cut = (s, n = MAX_TEXT) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export const fold = s => String(s ?? '').replace(/[İIı]/g, 'i').replace(/[Şş]/g, 's').replace(/[Ğğ]/g, 'g').replace(/[Üü]/g, 'u').replace(/[Öö]/g, 'o').replace(/[Çç]/g, 'c').replace(/[Ââ]/g, 'a').replace(/[Ûû]/g, 'u').replace(/[Îî]/g, 'i').toLowerCase();

const ROLE_TR = { leader: 'lider', general: 'general', opposition: 'muhalefet', oligarch: 'oligark', eski_lider: 'eski lider' };
const POSTS = [['leader', 'Lider'], ['general', 'Genelkurmay'], ['opposition', 'Muhalefet lideri'], ['oligarch', 'Oligark']];
const FATE = { olu: 'öldü', surgun: 'sürgüne gitti', emekli: 'emekli oldu', hapis: 'hapse atıldı', serbest: 'serbest kaldı' };

// Eşikler bir kez aşılınca geri dönüş için GAP kadar iyileşme ister; sınırda gidip gelen değer defteri doldurmaz.
const GAP = 6;
const GAUGES = [
  { key: 'unrest', read: c => c.unrest ?? 0, steps: [50, 70, 85], up: ['huzursuzluk tehlikeli düzeye çıktı', 'ülke kaynıyor, huzursuzluk çok yüksek', 'ayaklanma eşiğinde'], down: 'huzursuzluk geriledi', top: 2 },
  { key: 'legit', read: c => 100 - (c.legitimacy ?? 50), steps: [70, 85], up: ['hükümetin meşruiyeti zayıfladı', 'hükümetin meşruiyeti tükenmek üzere'], down: 'meşruiyet toparlandı', top: 2 },
  { key: 'food', read: c => 100 - (c.foodRatio ?? 1) * 100, steps: [5, 25], up: ['gıda kıtlığı başladı', 'açlık yayılıyor'], down: 'gıda sıkıntısı geçti', top: 2 },
  { key: 'input', read: c => 100 - (c.inputRatio ?? 1) * 100, steps: [60], up: ['sanayi girdisiz kaldı'], down: 'sanayiye girdi akışı düzeldi', top: 1 }
];

function levelOf(value, steps, prev) {
  let lvl = prev;
  while (lvl < steps.length && value >= steps[lvl]) lvl++;
  while (lvl > 0 && value < steps[lvl - 1] - GAP) lvl--;
  return lvl;
}

export function snapshotState(w) {
  const countries = {}, provinces = {}, characters = {}, wars = {}, treaties = {}, plots = {}, strategic = {};
  for (const c of Object.values(w.countries)) countries[c.id] = { alive: c.alive, name: c.name, regime: c.regime, capital: c.capital, leader: c.leader, general: c.general, opposition: c.opposition, oligarch: c.oligarch, strike: !!c.strike, bankCrisis: !!c.bankCrisis, defaulted: !!c.defaulted, techs: Object.keys(c.techs || {}) };
  for (const p of Object.values(w.provinces)) provinces[p.id] = p.controller;
  for (const ch of Object.values(w.characters)) characters[ch.id] = { alive: ch.alive, status: ch.status, role: ch.role, country: ch.country, name: ch.name };
  for (const x of w.wars) wars[x.id] = x.active;
  for (const t of w.treaties) treaties[t.id] = { active: !!t.active, pending: !!t.pending };
  for (const p of w.plots) plots[p.id] = { active: !!p.active, exposed: !!p.exposed };
  for (const s of w.strategic) strategic[s.id] = { controller: s.controller, closed: !!s.closed, toll: s.toll || 0 };
  return { countries, provinces, characters, wars, treaties, plots, strategic };
}

function stateChanges(w, was) {
  const out = [], add = (text, imp, o = {}) => out.push({ k: 'durum', s: 'motor', text, imp, ...o });
  const cn = id => w.countries[id]?.name ?? was.countries[id]?.name ?? id, who = id => w.characters[id]?.name ?? was.characters[id]?.name ?? 'bilinmeyen biri';
  w.ledgerBands ||= {};

  for (const c of Object.values(w.countries)) {
    const b = was.countries[c.id], cc = [c.id];
    if (!b) { if (c.alive) add(`Yeni devlet doğdu: ${c.name}`, 3, { c: cc, p: c.capital }); }
    else {
      if (b.alive && !c.alive) add(`${b.name} yıkıldı`, 3, { c: cc, p: b.capital });
      if (!c.alive) { delete w.ledgerBands[c.id]; continue; }
      if (b.name !== c.name) add(`${b.name} adını ${c.name} olarak değiştirdi`, 2, { c: cc, p: c.capital });
      if (b.regime !== c.regime) add(`${c.name}: rejim değişti, ${b.regime} yerine ${c.regime}`, 2, { c: cc, p: c.capital });
      if (b.capital !== c.capital) add(`${c.name}: başkent ${w.provinces[c.capital]?.name ?? '?'} oldu`, 2, { c: cc, p: c.capital });
      for (const [post, label] of POSTS) if (b[post] !== c[post]) add(`${c.name}: ${label} değişti, ${who(b[post])} yerine ${who(c[post])}`, post === 'leader' ? 3 : 1, { c: cc, a: [b[post], c[post]].filter(Boolean), p: c.capital });
      if (!b.strike && c.strike) add(`${c.name}: genel grev başladı`, 2, { c: cc, p: c.capital });
      if (b.strike && !c.strike) add(`${c.name}: genel grev sona erdi`, 0, { c: cc });
      if (!b.bankCrisis && c.bankCrisis) add(`${c.name}: bankacılık krizi patladı`, 2, { c: cc, p: c.capital });
      if (b.bankCrisis && !c.bankCrisis) add(`${c.name}: bankacılık krizi atlatıldı`, 0, { c: cc });
      if (!b.defaulted && c.defaulted) add(`${c.name}: borçlarını ödeyemedi, temerrüt ilan edildi`, 3, { c: cc, p: c.capital });
      for (const t of Object.keys(c.techs || {})) if (!b.techs.includes(t)) add(`${c.name}: yeni teknoloji, ${t}`, 1, { c: cc });
    }
    if (!c.alive) continue;
    const bands = w.ledgerBands[c.id] ||= {};
    for (const g of GAUGES) {
      const prev = bands[g.key] ?? 0, lvl = levelOf(g.read(c), g.steps, prev);
      if (lvl === prev) continue;
      bands[g.key] = lvl;
      if (lvl > prev) add(`${c.name}: ${g.up[lvl - 1]}`, lvl >= g.top ? 2 : 1, { c: [c.id], p: c.capital });
      else if (lvl === 0) add(`${c.name}: ${g.down}`, 0, { c: [c.id] });
    }
  }

  for (const p of Object.values(w.provinces)) {
    const from = was.provinces[p.id];
    if (from === undefined || from === p.controller) continue;
    const capital = w.countries[from]?.capital === p.id;
    add(`${p.name} eyaleti ${cn(p.controller)} denetimine geçti (önceki: ${cn(from)})`, capital ? 3 : 1, { c: [p.controller, from], p: p.id });
  }

  for (const ch of Object.values(w.characters)) {
    const b = was.characters[ch.id], label = `${ch.name} (${ROLE_TR[ch.role] ?? ch.role}, ${cn(ch.country)})`;
    if (!b) { add(`Sahneye yeni biri çıktı: ${label}`, 0, { c: [ch.country], a: [ch.id] }); continue; }
    if (b.alive && !ch.alive) add(`${label} ${FATE[ch.status] ?? 'sahneden çekildi'}`, b.role === 'leader' ? 2 : 1, { c: [ch.country], a: [ch.id] });
    else if (b.status !== ch.status) add(`${label} ${FATE[ch.status] ?? `durumu: ${ch.status}`}`, 1, { c: [ch.country], a: [ch.id] });
    if (b.role !== ch.role) add(`${ch.name} artık ${ROLE_TR[ch.role] ?? ch.role} (önceden ${ROLE_TR[b.role] ?? b.role})`, 0, { c: [ch.country], a: [ch.id] });
    if (b.country !== ch.country) add(`${ch.name} ${cn(b.country)} tarafından ${cn(ch.country)} tarafına geçti`, 1, { c: [b.country, ch.country], a: [ch.id] });
  }

  for (const x of w.wars) {
    const parties = [...x.a, ...x.b];
    if (!(x.id in was.wars) && x.active) add(`Savaş başladı: ${x.name}`, 3, { c: parties });
    else if (was.wars[x.id] && !x.active) add(`Savaş bitti: ${x.name}`, 3, { c: parties });
  }
  for (const t of w.treaties) {
    const b = was.treaties[t.id], label = `${t.kind} (${t.parties.map(cn).join(', ')})`;
    if (!b?.active && t.active) add(`Antlaşma yürürlüğe girdi: ${label}`, 2, { c: t.parties, x: { terms: cut(t.terms ?? '', 400) } });
    else if (b?.active && !t.active) add(`Antlaşma sona erdi: ${label}`, 2, { c: t.parties });
    else if (!b && t.pending) add(`Antlaşma teklif edildi: ${label}`, 1, { c: t.parties, x: { terms: cut(t.terms ?? '', 400) } });
  }
  for (const pl of w.plots) {
    const b = was.plots[pl.id], people = [pl.leader, ...(pl.members || [])], label = `${pl.kind} komplosu, ${who(pl.leader)}, ${cn(pl.country)}`;
    if (!b && pl.active) add(`Gizli ${label} kuruldu`, 0, { c: [pl.country], a: people, x: { secret: true } });
    if (b && !b.exposed && pl.exposed) add(`Açığa çıktı: ${label}`, 2, { c: [pl.country], a: people });
    if (b?.active && !pl.active) add(`Sona erdi: ${label}`, 1, { c: [pl.country], a: people });
  }
  for (const s of w.strategic) {
    const b = was.strategic[s.id], ref = s.ref;
    if (!b) continue;
    if (b.controller !== s.controller) add(`${s.name} artık ${cn(s.controller)} denetiminde (önceki: ${cn(b.controller)})`, 2, { c: [s.controller, b.controller].filter(Boolean), p: ref });
    if (b.closed !== !!s.closed) add(`${s.name} ${s.closed ? 'kapatıldı' : 'yeniden açıldı'}`, 2, { c: [s.controller].filter(Boolean), p: ref });
    if (b.toll !== (s.toll || 0)) add(`${s.name}: geçiş ücreti %${Math.round((s.toll || 0) * 100)} oldu`, 1, { c: [s.controller].filter(Boolean), p: ref });
  }
  return out;
}

const NEWS_IMP = { komplo: 2, felaket: 2, savas: 1 };

export function buildEntries(w, log, before, lookups = {}) {
  const out = [];
  for (const x of log.trace || []) {
    out.push({ k: 'dusunce', s: x.ai ? 'ajan' : 'kural', n: x.name, r: x.role, c: [x.country], a: [x.actor], imp: 0, text: cut(x.monologue), x: { persona: cut(x.persona, 900), decisions: x.decisions || [], lookups: x.lookups || [], ai: x.ai } });
    for (const q of lookups[x.actor] || []) out.push({ k: 'sorgu', s: 'ajan', n: x.name, r: x.role, c: [x.country], a: [x.actor], imp: 0, q: q.q, text: cut(q.a, MAX_ANSWER) });
  }
  for (const m of log.messages || []) out.push({ k: 'mesaj', s: 'ajan', n: m.fromName, to: m.toName, c: [m.fromCountry, m.toCountry].filter(Boolean), a: [m.from, m.toActor].filter(Boolean), imp: 0, ok: !m.undelivered, text: cut(m.text) });
  for (const r of log.rulings || []) {
    const failed = (r.results || []).filter(y => y.ok === false), ok = !!r.success && !failed.length, detail = (r.results || []).map(y => y.msg).filter(Boolean).join('; ');
    out.push({ k: r.source === 'hakem' ? 'hukum' : 'kural', s: r.source, n: r.name, r: r.role, c: [r.country], a: [r.actor], imp: 0, ok, text: cut(r.source === 'hakem' ? r.narrative : `${r.narrative}${detail ? `: ${detail}` : ''}`), x: { narrative: cut(r.narrative, 400), probability: r.probability, success: r.success, results: r.results || [], ops: r.ops || [], decision: r.decision } });
  }
  for (const n of w.newsThisTurn || []) out.push({ k: 'haber', s: 'motor', c: n.countries || [], imp: n.secret ? 0 : NEWS_IMP[n.kind] ?? 0, text: cut(n.text), x: { kind: n.kind, secret: !!n.secret } });
  if (before) out.push(...stateChanges(w, before));
  const t = w.turn, d = w.date || 'Başlangıç';
  return out.map((e, i) => ({ id: `${t}-${i}`, t, i, d, ...e }));
}

// Eski tur görünümleri (Zihinler, Yazışmalar, Hakem) defterden yeniden kurulur.
export function logFromEntries(entries) {
  const log = { trace: [], rulings: [], messages: [] };
  for (const e of entries) {
    if (e.k === 'dusunce') log.trace.push({ actor: e.a[0], country: e.c[0], role: e.r, name: e.n, ai: e.x.ai, persona: e.x.persona, lookups: e.x.lookups, monologue: e.text, decisions: e.x.decisions, messages: [] });
    else if (e.k === 'hukum' || e.k === 'kural') log.rulings.push({ actor: e.a[0], name: e.n, country: e.c[0], role: e.r, narrative: e.x.narrative, probability: e.x.probability, success: e.x.success, results: e.x.results, source: e.s, decision: e.x.decision });
    else if (e.k === 'mesaj') log.messages.push({ from: e.a[0], fromName: e.n, fromCountry: e.c[0], toName: e.to, text: e.text, undelivered: e.ok === false });
  }
  return log;
}

export function entryHaystack(e) {
  const x = e.x || {};
  return fold([e.d, e.n, e.to, e.q, e.text, x.persona, x.decision, x.terms, ...(x.decisions || []), ...(x.lookups || []), ...(x.results || []).map(y => `${y.op} ${y.msg}`)].filter(Boolean).join(' '));
}

export function matches(e, f) {
  if (f.turn != null && e.t !== f.turn) return false;
  if (f.from != null && e.t < f.from) return false;
  if (f.to != null && e.t > f.to) return false;
  if (f.kinds && !f.kinds.includes(e.k)) return false;
  if (f.country && !(e.c || []).includes(f.country)) return false;
  if (f.character && !(e.a || []).includes(f.character)) return false;
  if (f.source && e.s !== f.source) return false;
  if (f.ok != null && (e.ok ?? true) !== f.ok) return false;
  if (f.imp && (e.imp ?? 0) < f.imp) return false;
  if (f.words?.length) { const h = entryHaystack(e); if (!f.words.every(q => h.includes(q))) return false; }
  return true;
}
