// Quiet crimes that leave a paper trail: a frontier incident made to order, money sent to a party or a paper in another country, and what
// one person lays before another about a third. Each is a secret of whoever did it, and what happens when such a secret comes out (in a
// newspaper, in a published file) is decided here, once, whoever prints it.
import { clamp, news, rand, quarterLabel } from './util.js';
import { atWar } from './world.js';
import { shame } from './diplomacy.js';

const say = (w, ch, from, text) => { if (ch?.alive) ch.inbox.push({ turn: w.turn, from, text }); };
const keep = (w, ch, s) => { (ch.secrets ||= []).push({ turn: w.turn, ...s }); ch.secrets = ch.secrets.slice(-12); };
const grudge = (c, id) => (c.grudges ||= {})[id] ||= { incident: 0, kin: 0 };
const fileOn = (w, holder, about, text) => { const f = holder.dossiers[about.id] ||= { turn: w.turn, about: about.name, facts: [] }; if (f.facts.includes(text)) return f; f.turn = w.turn; f.facts.push(text); f.facts = f.facts.slice(-8); return f; };

// A secret has come out. Most cost only the person; these cost a state its word or a party its following, once.
export function cameOut(w, ch, s) {
  if (!s || !ch) return;
  if (s.staged && !s.staged.out) {
    const c = w.countries[s.staged.by], o = w.countries[s.staged.target]; if (!c?.alive) return;
    // Every copy of the same affair (the one who ordered it, the officer who carried it out) is settled by the first that comes out.
    const book = c.stagedOut ||= {}; s.staged.out = true; if (book[s.staged.key]) return; book[s.staged.key] = w.turn;
    const g = grudge(c, s.staged.target); g.incident = Math.max(0, g.incident - s.staged.weight);
    shame(w, c, -8, `it was shown to have staged a frontier incident${o ? ` with ${o.name}` : ''}`); c.legitimacy = clamp(c.legitimacy - (1.5 + 3 * c.pressFreedom / 100), 0, 100);
    if (o?.alive) { o.relations[c.id] = clamp((o.relations[c.id] ?? 0) - 10, -100, 100); grudge(o, c.id).incident += 6; }
    news(w, `It has come out that the frontier incident of ${quarterLabel(s.turn)} between ${c.name} and ${o?.name ?? 'its neighbour'} was staged from ${c.name}'s side: the dead were its own men, shot to make a grievance.`, { kind: 'plot', countries: o ? [c.id, o.id] : [c.id] });
    say(w, w.characters[c.leader], 'Foreign Ministry', `The staged incident on the frontier with ${o?.name ?? 'our neighbour'} is public. Abroad our word is worth less for it; at home the grievance it made is gone, and people ask who had their own soldiers shot.`);
  }
  if (s.gold && !s.gold.out) {
    const c = w.countries[s.gold.country], from = w.countries[s.gold.from]; s.gold.out = true; if (!c?.alive) return;
    const book = c.goldOut ||= {}, key = `${s.gold.party ?? s.gold.paper}|${s.gold.from}|${s.turn}`; if (book[key]) return; book[key] = w.turn;
    const p = c.parties.find(x => x.id === s.gold.party), n = (c.papers || []).find(x => x.id === s.gold.paper);
    if (p) { p.support = Math.max(1, p.support * .8); p.organization = (p.organization || 0) * .9; news(w, `${c.name}: it has come out that ${p.name} took money from ${from?.name ?? 'abroad'}. Its opponents call it foreign gold.`, { kind: 'plot', countries: from ? [c.id, from.id] : [c.id] }); }
    if (n) { n.reach *= .6; news(w, `${c.name}: it has come out that ${n.name} is kept with money from ${from?.name ?? 'abroad'}. Readers are leaving it.`, { kind: 'plot', countries: from ? [c.id, from.id] : [c.id] }); }
    if (from?.alive && s.gold.state) { c.relations[from.id] = clamp((c.relations[from.id] ?? 0) - 15, -100, 100); shame(w, from, -3, `its government was shown to have paid ${p ? 'a party' : 'a newspaper'} in ${c.name}`); }
  }
}

// A clash on the frontier that the country blames on its neighbour, made by its own side: the same grievance a real one leaves, which a
// declaration of war then answers; a secret of whoever ordered it and of the officer who carried it out; and the other side knows that its
// own men did not fire. A second one on the same frontier within a year is seen for what it is.
export function stageIncident(w, c, actor, target, op) {
  const fail = msg => ({ ok: false, msg });
  if (atWar(w, c.id, target.id)) return fail(`${c.name} is at war with ${target.name} already; there is nothing left to stage.`);
  const men = p => Object.values(w.units).filter(u => u.country === c.id && u.province === p.id).reduce((a, u) => a + u.men, 0);
  const borders = Object.values(w.provinces).filter(p => p.controller === c.id && p.neighbors.some(n => w.provinces[n].controller === target.id));
  if (!borders.length) return fail(`${c.name} has no frontier with ${target.name}.`);
  const p = op.province ? borders.find(x => x.id === op.province) : [...borders].sort((a, b) => men(b) - men(a))[0];
  if (!p) return fail(`${w.provinces[op.province]?.name ?? 'That province'} is not a province of ours on the frontier with ${target.name}. Those that are: ${borders.map(x => `${x.name} (${x.id})`).join(', ')}.`);
  if (men(p) < .5) return fail(`It takes soldiers on the spot, and no troops of ours stand in ${p.name}. On that frontier they stand in: ${borders.filter(x => men(x) >= .5).map(x => `${x.name} (${x.id})`).join(', ') || 'no province at all'}.`);
  const q = w.provinces[p.neighbors.find(n => w.provinces[n].controller === target.id)], u = Object.values(w.units).filter(x => x.country === c.id && x.province === p.id).sort((a, b) => b.men - a.men)[0];
  const dead = Math.round(2 + rand(w) * 12), weight = 10 + dead * .3, key = `${c.id}|${target.id}|${w.turn}|${p.id}`, book = c.stagedAt ||= {}, again = book[target.id] != null && w.turn - book[target.id] < 4;
  if (book[target.id] === w.turn) return fail(`That frontier has had its incident this quarter; a second in the same weeks would be laughed at, and nothing was done.`);
  book[target.id] = w.turn;
  u.men = Math.max(.05, u.men - dead / 1000);
  const text = `Had a frontier incident with ${target.name} staged near ${p.name} in ${quarterLabel(w.turn)}: ${dead} of ${c.name}'s own soldiers were shot to make it.`, mark = { by: c.id, target: target.id, weight, key };
  const s = { text, staged: { ...mark } }; keep(w, actor, s); const mine = actor.secrets.at(-1);
  const officer = w.characters[u.commander]; if (officer?.alive && officer.id !== actor.id) keep(w, officer, { text: `Carried out the staged frontier incident near ${p.name} in ${quarterLabel(w.turn)} on the orders of ${actor.name}.`, staged: { ...mark } });
  grudge(c, target.id).incident += weight; c.relations[target.id] = clamp((c.relations[target.id] ?? 0) - 8, -100, 100); target.relations[c.id] = clamp((target.relations[c.id] ?? 0) - 8, -100, 100);
  news(w, `Shots on the frontier between ${c.name} and ${target.name}: ${c.name} reports that its post near ${p.name} was fired on from ${q.name} and that ${dead} of its soldiers were killed. ${target.name} denies that its troops fired.`, { kind: 'war', countries: [c.id, target.id], province: p.id });
  // The ruler or the chief who did not order it hears what the country hears.
  for (const ch of [w.characters[c.leader], w.characters[c.general]]) if (ch?.alive && ch.id !== actor.id) say(w, ch, 'General Staff', `A clash on the frontier with ${target.name} near ${p.name}: ${dead} of ours dead. Our officers there say theirs fired first. The country has heard of it and expects an answer.`);
  // The other side knows what its own men did; and a service with eyes inside our staff knows who gave the order.
  const knows = (target.intel?.[c.id] ?? 0) >= 60, their = w.characters[target.leader];
  for (const ch of [their, w.characters[target.general]]) if (ch?.alive) say(w, ch, 'General Staff', `${c.name} announces that its post near ${p.name} was fired on from ${q.name} and that ${dead} of its men are dead. Our commanders there report no patrol out and no shot fired from our side: either their men shot at shadows, or the affair is of their own making.${knows ? ` Our service has it from inside their staff that it was staged on the orders of ${actor.name} (${actor.id}); the proof is in ${ch.id === their?.id ? 'your' : 'the government\'s'} file on ${actor.name} and can be laid before the world (publish_dossier).` : ' To know more we would need eyes inside their staff.'}`);
  if (knows && their?.alive) fileOn(w, their, actor, text);
  if (again) { mine.published = true; cameOut(w, actor, mine); return { ok: true, msg: `The incident near ${p.name} was made: ${dead} of our own men are dead. But it is the second on that frontier within a year, and it has been seen for what it is: the grievance is gone, our word abroad is the worse for it, and the country asks who had its soldiers shot.` }; }
  return { ok: true, msg: `The incident near ${p.name} was made: ${dead} of our own men are dead, and the country is told that ${target.name} fired on our post from ${q.name}. It weighs at home as a wrong done by ${target.name} and unanswered, as a real clash would; a declaration of war answers it. ${target.name} knows that its own men did not fire${knows ? ', and its service knows more than that' : ''}. It is a secret of yours and of ${officer?.alive && officer.id !== actor.id ? `${officer.name}, who carried it out` : 'the men who carried it out'}: if it comes out, the grievance goes, and the state's word with it. A second incident on the same frontier within a year would be seen through.` };
}

// What one person knows of another, laid before a third: the papers in his own file, and what the other did to him that can be shown. A
// statement of his own goes with it, but a statement is not a paper and no court counts it as one.
export function denounce(w, actor, x, to, op) {
  const mine = actor.dossiers?.[x.id], facts = [...(mine?.facts || [])], forged = (mine?.forged || []).filter(f => facts.includes(f)), said = String(op.text ?? op.statement ?? '').trim().slice(0, 600);
  // What he was told or offered himself: a sounding, an invitation into a plot, money.
  for (const s of x.secrets || []) if (!s.published && (new RegExp(`Sounded out ${actor.name}\\b`).test(s.text) || (s.text.includes(actor.name) && /^(Paid|Tried to|Put|Blackmailed)/.test(s.text))) && !facts.includes(s.text)) facts.push(s.text);
  for (const pl of w.plots || []) if (pl.active && pl.leader === x.id && pl.asked?.[actor.id] != null) { const t = `Leads a ${pl.kind} plot (${pl.id}) and asked ${actor.name} to join it.`; if (!facts.includes(t)) facts.push(t); }
  if (!facts.length && !said) return { ok: false, msg: `You hold no file on ${x.name}, and ${x.name} has done nothing to you that could be shown (a sounding, an invitation into a plot, money offered). A statement of your own can still be made (text).` };
  const file = to.dossiers[x.id] ||= { turn: w.turn, about: x.name, facts: [] }; file.turn = w.turn;
  const fresh = facts.filter(f => !file.facts.includes(f)); file.facts = [...file.facts, ...fresh].slice(-8); if (forged.length) file.forged = [...new Set([...(file.forged || []), ...forged])].filter(f => file.facts.includes(f));
  if (said) { (file.said ||= []).push(`${actor.name}, in ${quarterLabel(w.turn)}: "${said}"`); file.said = file.said.slice(-4); }
  keep(w, actor, { text: `Denounced ${x.name} to ${to.name} in ${quarterLabel(w.turn)}.` });
  say(w, to, actor.name, `${actor.name} (${actor.id}) lays before you what he knows of ${x.name} (${x.id})${facts.length ? `: ${facts.join(' ')}` : '.'}${said ? ` And he states: "${said}"` : ''} ${fresh.length ? `${fresh.length} paper${fresh.length > 1 ? 's are' : ' is'} new to your file on ${x.name}.` : facts.length ? 'You held these papers already.' : ''}${said ? ' His statement is kept with the file; it is his word and not a paper, and a court counts only papers.' : ''}`);
  return { ok: true, msg: `${to.name} has what you know of ${x.name}: ${fresh.length} paper${fresh.length === 1 ? '' : 's'} new to his file${facts.length > fresh.length ? ` (${facts.length - fresh.length} he held already)` : ''}${said ? ', and your statement, which is your word and no paper' : ''}. ${x.name} has not been told. That you went to ${to.name} is a thing that can be found out.` };
}
