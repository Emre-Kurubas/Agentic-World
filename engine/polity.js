// Kurumlar, meclis ve antlaşma maddeleri. Ajan ne kuracağını serbestçe yazar, hakem buradaki kurallara çevirir, sonucu kod belirler.
import { clamp, sum, news, rand, nextId } from './util.js';
import { GOODS, GOOD_TR, aliveCountries } from './world.js';
import { distance } from './politics.js';

export const num = (v, a, b, d = a) => clamp(Number.isFinite(Number(v)) ? Number(v) : d, a, b);

export const STATE_POWERS = ['denetim', 'yargi', 'guvenlik', 'istihbarat', 'burokrasi', 'banka', 'ordu'];
export const CIVIL_POWERS = ['egitim', 'refah', 'propaganda', 'din', 'sermaye', 'tarim', 'sanayi', 'arastirma'];
export const DELEGABLE = new Set(['set_tax', 'set_budget', 'set_tariff', 'set_arms_share', 'print_money', 'borrow', 'embargo', 'build', 'survey', 'set_research', 'move', 'move_army', 'recruit', 'repress', 'concession', 'purge', 'ban_party', 'set_institutions', 'propose_treaty', 'accept_treaty', 'spy', 'steal_tech', 'gather_dossier']);
export const GATED = new Set(['set_tax', 'set_budget', 'set_tariff', 'borrow', 'declare_war', 'ban_party', 'land_reform', 'nationalize', 'privatize']);
const MAX_OPEN_BILLS = 6;

const activeInstitutions = c => (c.institutions || []).filter(i => i.id);
const memberOf = (i, id) => i.head === id || (i.members || []).includes(id);

export function delegated(c, actor, opName) {
  return activeInstitutions(c).some(i => memberOf(i, actor.id) && (i.authority || []).includes(opName) && (i.strength ?? 0) >= .2);
}

// Veto eden kurumun gücü ve mahkeme bağımsızlığı arttıkça lider geçemez.
export function vetoedBy(w, c, actor, opName) {
  return activeInstitutions(c).find(i => (i.veto || []).includes(opName) && !memberOf(i, actor.id) && rand(w) < clamp((i.strength ?? 0) * (.35 + c.courts / 150), 0, .95));
}

export function makeInstitution(w, c, actor, op) {
  const isState = actor.id === c.leader, allowed = isState ? [...STATE_POWERS, ...CIVIL_POWERS] : CIVIL_POWERS;
  const inst = {
    id: nextId(w, 'KR'), name: String(op.name || 'Adsız kurum').slice(0, 70), description: String(op.description || '').slice(0, 280), founder: actor.name, turn: w.turn,
    powers: (Array.isArray(op.powers) ? op.powers : []).filter(p => allowed.includes(p)).slice(0, 4),
    authority: isState ? (Array.isArray(op.authority) ? op.authority : []).filter(x => DELEGABLE.has(x)).slice(0, 8) : [],
    veto: isState ? (Array.isArray(op.veto) ? op.veto : []).filter(x => GATED.has(x) || DELEGABLE.has(x)).slice(0, 6) : [],
    budget: isState ? num(op.budget_pct_gdp, 0, .05, .002) : 0,
    sponsor: isState ? null : actor.id, amount: isState ? 0 : num(op.amount, 0, actor.wealth * .25, 0),
    head: null, members: [], strength: .15, funding: .5
  };
  const head = w.characters[op.head];
  inst.head = head?.alive && head.country === c.id ? head.id : actor.id;
  for (const id of Array.isArray(op.members) ? op.members.slice(0, 8) : []) { const m = w.characters[id]; if (m?.alive && m.country === c.id && m.id !== inst.head && !inst.members.includes(m.id)) inst.members.push(m.id); }
  c.institutions.push(inst);
  if (c.institutions.length > 30) c.institutions.shift();
  return inst;
}

const addMod = (c, key, delta, label) => c.mods.push({ key, delta, turns: 1, label });

function applyPower(w, c, inst, power, s) {
  const add = (stat, d, lo = 0, hi = 100) => { c[stat] = clamp((c[stat] ?? 0) + d, lo, hi); };
  switch (power) {
    case 'denetim': {
      add('corruption', -.7 * s, 2, 95);
      const head = w.characters[inst.head];
      if (head?.alive && rand(w) < .12 * s) {
        const suspects = Object.values(w.characters).filter(x => x.alive && x.country === c.id && x.id !== head.id && x.secrets?.length && !head.dossiers[x.id]);
        if (suspects.length) { const t = suspects[Math.floor(rand(w) * suspects.length)], facts = t.secrets.slice(-5).map(x => x.text); head.dossiers[t.id] = { turn: w.turn, about: t.name, facts }; head.inbox.push({ turn: w.turn, from: inst.name, text: `Denetim bulgusu, ${t.name}: ${facts.join(' ')}` }); }
      }
      break;
    }
    case 'yargi': add('courts', .6 * s); break;
    case 'guvenlik': add('police', .6 * s, 5, 95); break;
    case 'istihbarat': add('intelligence', .6 * s); break;
    case 'burokrasi': add('bureaucracy', .5 * s, 10, 95); break;
    case 'banka': add('bankHealth', .8 * s); break;
    case 'ordu': addMod(c, 'sat.ordu', 4 * s, inst.name); break;
    case 'egitim': add('literacy', .15 * s, 5, 99); break;
    case 'refah': addMod(c, 'sat.koylu', 3 * s, inst.name); addMod(c, 'sat.isci', 3 * s, inst.name); break;
    case 'propaganda': addMod(c, 'sat.all', 2 * s, inst.name); break;
    case 'din': addMod(c, 'sat.din', 4 * s, inst.name); break;
    case 'sermaye': addMod(c, 'sat.sermaye', 4 * s, inst.name); break;
    case 'tarim': c.tech.agri = clamp(c.tech.agri * (1 + .002 * s), .5, 10); break;
    case 'sanayi': c.tech.ind = clamp(c.tech.ind * (1 + .002 * s), .5, 10); break;
    case 'arastirma': if (c.research) c.research.progress += 2.5 * s; break;
  }
}

export function institutionStep(w) {
  for (const c of aliveCountries(w)) for (const inst of activeInstitutions(c)) {
    const head = w.characters[inst.head];
    if (!head?.alive || head.country !== c.id) inst.head = null;
    inst.members = inst.members.filter(id => w.characters[id]?.alive && w.characters[id].country === c.id);
    let paid = 0, need;
    if (inst.sponsor) {
      const sp = w.characters[inst.sponsor]; need = inst.amount;
      if (sp?.alive && need > 0) { const m = Math.min(sp.wealth, need); sp.wealth -= m; paid = m / need; } else if (need <= 0) paid = 0;
    } else {
      need = inst.budget * Math.max(c.gdp, 1);
      if (need > 0) { const m = Math.min(Math.max(c.treasury, 0), need); c.treasury -= m; paid = m / need; }
    }
    inst.funding += (paid - inst.funding) * .4;
    const size = inst.sponsor ? clamp(need / 15, 0, 1.2) : clamp(inst.budget / Math.max(.003 * Math.max(inst.powers.length, 1), .001), 0, 1.2);
    const target = clamp(inst.funding * size * (.45 + (inst.head ? .35 : 0) + Math.min(inst.members.length, 4) * .05), 0, 1.2);
    inst.strength += (target - inst.strength) * .3;
    for (const p of inst.powers) applyPower(w, c, inst, p, inst.strength);
  }
}

export function allocateSeats(c) {
  const ps = c.parties.filter(p => !p.banned), tot = sum(ps, p => Math.max(p.support, 0)) || 1, seats = {};
  const quota = ps.map(p => ({ id: p.id, v: Math.max(p.support, 0) / tot * 100 }));
  let left = 100;
  for (const q of quota) { seats[q.id] = Math.floor(q.v); left -= seats[q.id]; }
  for (const q of quota.sort((a, b) => (b.v % 1) - (a.v % 1)).slice(0, Math.max(0, left))) seats[q.id]++;
  return seats;
}

export function makeParliament(c, name, legislative = true) {
  c.parliament = { name: String(name || 'Meclis').slice(0, 60), legislative, seats: allocateSeats(c), suspendedUntil: 0 };
  c.bills ||= []; c.laws ||= [];
  return c.parliament;
}

export const parliamentOpen = (w, c) => !!c.parliament && w.turn >= (c.parliament.suspendedUntil ?? 0);
export const mustPassParliament = (w, c, op) => parliamentOpen(w, c) && c.parliament.legislative && GATED.has(op.op) && !op._law;

export function leadsParties(w, c, ch) {
  const rivals = c.parties.filter(p => !p.banned && p.id !== c.rulingParty).sort((a, b) => b.support - a.support);
  return c.parties.filter(p => p.founder === ch.id || (p.id === c.rulingParty && c.leader === ch.id) || (p.id === rivals[0]?.id && c.opposition === ch.id));
}

export function createBill(w, c, actor, { title, text, ops, axes }) {
  if ((c.bills || []).filter(b => b.status === 'bekliyor').length >= MAX_OPEN_BILLS) return null;
  const led = leadsParties(w, c, actor)[0];
  const bill = { id: nextId(w, 'Y'), title: String(title || 'Adsız yasa').slice(0, 100), text: String(text || '').slice(0, 500), ops: (Array.isArray(ops) ? ops : []).slice(0, 4), axes: axes && typeof axes === 'object' ? { econ: num(axes.econ, -100, 100, 0), auth: num(axes.auth, -100, 100, 0), nation: num(axes.nation, -100, 100, 0), faith: num(axes.faith, -100, 100, 0) } : { ...(actor.id === c.leader ? c.axes : actor.axes) }, proposer: actor.id, proposerName: actor.name, party: led?.id ?? null, byGov: actor.id === c.leader, turn: w.turn, voteAt: w.turn + 1, votes: {}, lobby: {}, status: 'bekliyor' };
  (c.bills ||= []).push(bill);
  for (const p of c.parties) { for (const id of [p.founder, p.id === c.rulingParty ? c.leader : null, c.opposition]) { const ch = w.characters[id]; if (ch?.alive && ch.id !== actor.id && ch.aiControlled && ch.country === c.id && leadsParties(w, c, ch).includes(p)) ch.inbox.push({ turn: w.turn, from: c.parliament?.name ?? 'Meclis', text: `Yasa teklifi ${bill.id} (${bill.proposerName}): ${bill.title}. ${bill.text} Gelecek çeyrekte oylanacak.` }); } }
  return bill;
}

function partyVotes(w, c, b, p) {
  if (b.votes[p.id]) return b.votes[p.id] === 'evet';
  let s = 30 - distance(p.axes, b.axes) * .5 + (b.lobby[p.id] || 0) * .4 + rand(w) * 16 - 8;
  if (b.party === p.id) s += 35;
  if (b.byGov) s += p.id === c.rulingParty ? 30 : -10;
  return s > 0;
}

export function enactLaw(w, c, bill, apply, via) {
  const leader = w.characters[c.leader], results = leader ? bill.ops.map(op => ({ op: op?.op, ...apply(w, leader, { ...op, _law: true }) })) : [];
  (c.laws ||= []).push({ id: bill.id, title: bill.title, text: bill.text, turn: w.turn, via, results: results.map(r => `${r.op}: ${r.msg}`).slice(0, 4) });
  if (c.laws.length > 40) c.laws.shift();
  return results;
}

export function billStep(w, apply) {
  for (const c of aliveCountries(w)) {
    for (const b of c.bills || []) {
      if (b.status !== 'bekliyor' || w.turn < b.voteAt) continue;
      if (!parliamentOpen(w, c)) { b.status = 'dustu'; b.closedAt = w.turn; continue; }
      let yes = 0, no = 0; const seats = c.parliament.seats;
      for (const p of c.parties) { const n = seats[p.id] || 0; if (!n || p.banned) continue; if (partyVotes(w, c, b, p)) yes += n; else no += n; }
      b.tally = { yes, no }; b.closedAt = w.turn;
      if (yes > no) {
        b.status = 'kabul'; enactLaw(w, c, b, apply, 'meclis');
        news(w, `${c.name} meclisi "${b.title}" yasasını kabul etti (${yes} evet, ${no} hayır).`, { kind: 'siyaset', countries: [c.id] });
        if (b.byGov) c.legitimacy = clamp(c.legitimacy + .5, 0, 100);
      } else {
        b.status = 'ret';
        news(w, `${c.name} meclisi "${b.title}" teklifini reddetti (${yes} evet, ${no} hayır).`, { kind: 'siyaset', countries: [c.id] });
        if (b.byGov) c.legitimacy = clamp(c.legitimacy - 1.5, 0, 100);
      }
    }
    if (c.bills) c.bills = c.bills.filter(b => b.status === 'bekliyor' || w.turn - b.closedAt <= 8);
  }
}

// Antlaşma maddeleri. Hakem serbest metni bu türlere çevirir; ödenebilen kod tarafından ödenir, tutulmayan ihlal olarak kayda geçer.
export function normalizeClauses(w, raw, parties) {
  const out = [], isParty = x => parties.includes(x), turns = v => Math.round(num(v, 1, 80, 12));
  for (const c of Array.isArray(raw) ? raw.slice(0, 8) : []) {
    if (c?.type === 'harac' && isParty(c.payer)) out.push({ type: 'harac', payer: c.payer, pct_gdp: num(c.pct_gdp, 0, .2, .02), turns: turns(c.turns) });
    else if (c?.type === 'teslimat' && isParty(c.from) && GOODS.includes(c.good)) out.push({ type: 'teslimat', from: c.from, good: c.good, amount: num(c.amount, 0, 1e5, 0), turns: turns(c.turns) });
    else if (c?.type === 'gumruk') out.push({ type: 'gumruk', rate: num(c.rate, 0, 1, 0) });
    else if (c?.type === 'silahsiz_bolge' && Array.isArray(c.provinces)) out.push({ type: 'silahsiz_bolge', country: isParty(c.country) ? c.country : null, provinces: c.provinces.filter(p => w.provinces[p]).slice(0, 12) });
    else if (c?.type === 'asker_limit' && isParty(c.country)) out.push({ type: 'asker_limit', country: c.country, men: num(c.men, 0, 1e6, 0) });
    else if (c?.type === 'yardim') out.push({ type: 'yardim', called: {} });
  }
  return out;
}

export function clauseText(w, cl) {
  const n = id => w.countries[id]?.name ?? id;
  switch (cl.type) {
    case 'harac': return `${n(cl.payer)} her tur GSYH'nin %${Math.round(cl.pct_gdp * 1000) / 10} kadarını öder${cl.until != null ? `, tur ${cl.until} sonuna dek` : ''}`;
    case 'teslimat': return `${n(cl.from)} her tur ${Math.round(cl.amount)} ${GOOD_TR[cl.good]} teslim eder${cl.until != null ? `, tur ${cl.until} sonuna dek` : ''}`;
    case 'gumruk': return `Karşılıklı gümrük %${Math.round(cl.rate * 100)}`;
    case 'silahsiz_bolge': return `${cl.country ? n(cl.country) : 'Taraflar'} şu eyaletlerde asker bulundurmaz: ${cl.provinces.map(p => w.provinces[p]?.name ?? p).join(', ')}`;
    case 'asker_limit': return `${n(cl.country)} en çok ${Math.round(cl.men)} bin asker tutar`;
    case 'yardim': return 'Saldırıya uğrayan tarafın yanında savaşa girilir';
    default: return cl.type;
  }
}

export function activateClauses(w, t) {
  for (const cl of t.clauses || []) { if (cl.turns) cl.until = w.turn + cl.turns; cl.text = clauseText(w, cl); }
}

function breach(w, t, cl, party, text) {
  if (w.turn - (cl.lastBreach ?? -99) < 4) return;
  cl.lastBreach = w.turn;
  (t.breaches ||= []).push({ turn: w.turn, party, text });
  t.breaches = t.breaches.slice(-12);
  for (const id of t.parties) { const leader = w.characters[w.countries[id]?.leader]; if (leader?.alive) leader.inbox.push({ turn: w.turn, from: 'Dışişleri', text: `Antlaşma ${t.id} ihlal edildi: ${text}` }); }
  news(w, `Antlaşma ihlali: ${text}`, { kind: 'diplomasi', countries: t.parties });
}

const routeOpen = (w, a, b) => !!w.routes[a < b ? `${a}|${b}` : `${b}|${a}`];

export function treatyStep(w) {
  for (const c of aliveCountries(w)) c.tariffDeals = {};
  for (const t of w.treaties) {
    if (!t.active) continue;
    if (t.expires != null && w.turn >= t.expires) { t.active = false; news(w, `${t.parties.map(x => w.countries[x]?.name).join(' ile ')} arasındaki ${t.kind} antlaşmasının süresi doldu.`, { kind: 'diplomasi', countries: t.parties }); continue; }
    for (const cl of t.clauses || []) {
      if (cl.until != null && w.turn >= cl.until) continue;
      if (cl.type === 'harac') {
        const payer = w.countries[cl.payer], other = w.countries[t.parties.find(x => x !== cl.payer)];
        if (!payer?.alive || !other?.alive) continue;
        const due = Math.max(payer.gdp, 1) * cl.pct_gdp, paid = Math.min(Math.max(payer.reserves, 0), due);
        payer.reserves -= paid; other.reserves += paid;
        if (paid < due * .95) breach(w, t, cl, cl.payer, `${payer.name} haracını tam ödeyemedi.`);
      } else if (cl.type === 'teslimat') {
        const from = w.countries[cl.from], to = w.countries[t.parties.find(x => x !== cl.from)];
        if (!from?.alive || !to?.alive || !routeOpen(w, from.id, to.id)) continue;
        const moved = Math.min(from.stock[cl.good] || 0, cl.amount);
        from.stock[cl.good] = (from.stock[cl.good] || 0) - moved; to.stock[cl.good] = (to.stock[cl.good] || 0) + moved;
        if (moved < cl.amount * .95) breach(w, t, cl, cl.from, `${from.name} ${GOOD_TR[cl.good]} teslimatını tamamlayamadı.`);
      } else if (cl.type === 'gumruk') {
        const [a, b] = t.parties.map(x => w.countries[x]);
        if (a?.alive && b?.alive) { a.tariffDeals[b.id] = Math.min(a.tariffDeals[b.id] ?? 1, cl.rate); b.tariffDeals[a.id] = Math.min(b.tariffDeals[a.id] ?? 1, cl.rate); }
      } else if (cl.type === 'silahsiz_bolge') {
        for (const u of Object.values(w.units)) if (cl.provinces.includes(u.province) && (cl.country ? u.country === cl.country : t.parties.includes(u.country))) { breach(w, t, cl, u.country, `${w.countries[u.country]?.name} silahsız bölgeye asker soktu: ${w.provinces[u.province]?.name}.`); break; }
      } else if (cl.type === 'asker_limit') {
        const men = sum(Object.values(w.units).filter(u => u.country === cl.country), u => u.men);
        if (men > cl.men) breach(w, t, cl, cl.country, `${w.countries[cl.country]?.name} asker sınırını aştı (${Math.round(men)} bin).`);
      } else if (cl.type === 'yardim') {
        for (const x of t.parties) for (const war of w.wars) {
          const ally = t.parties.find(y => y !== x);
          if (!war.active || war.civil || !war.b.includes(x) || war.a.includes(ally) || war.b.includes(ally) || cl.called[war.id] || w.turn - war.start < 2 || war.start < (t.turn ?? 0)) continue;
          cl.called[war.id] = true;
          breach(w, t, cl, ally, `${w.countries[ally]?.name}, saldırıya uğrayan ${w.countries[x]?.name} yanında savaşa girmedi (${war.name}).`);
        }
      }
    }
  }
}
