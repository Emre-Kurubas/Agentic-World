// The press, and the machinery of parties.
// A newspaper is somebody's: it costs money every quarter, reaches as many readers as there are people who can read and a law that lets them,
// speaks for its owner's side, and now and then prints what someone in office would rather keep quiet. A party is not only a mood in the
// country: committees, organisers and dues turn sympathy into votes, and they cost money too.
import { clamp, rand, news, nextId, sum } from './util.js';
import { aliveCountries, ROLES } from './world.js';

const say = (w, ch, from, text) => { if (ch?.alive) ch.inbox.push({ turn: w.turn, from, text }); };
export const MAX_PAPERS = 6;
export const papersOf = c => c.papers || [];
// Which party a person's paper speaks for: the one they founded or lead.
const sideOf = (w, c, id) => id === c.leader ? c.rulingParty : c.parties.find(p => p.founder === id)?.id ?? (id === c.opposition ? [...c.parties].filter(p => !p.banned && p.id !== c.rulingParty).sort((a, b) => b.support - a.support)[0]?.id : null);
// How much the papers behind a party add to what it can make of the country's mood, in points of a hundred.
export const voiceOf = (w, c, party) => clamp(sum(papersOf(c).filter(n => sideOf(w, c, n.owner) === party.id), n => n.reach), 0, 60);
// How far a publication carries: with a paper of one's own it is read across the country, without one it is a pamphlet.
export const carry = (c, actor) => clamp(.6 + sum(papersOf(c).filter(n => n.owner === actor.id), n => n.reach) / 50, .6, 1.6);

export function foundPaper(w, c, actor, name, amount) {
  const n = { id: nextId(w, 'N'), name: String(name || `${c.name} Gazette`).slice(0, 60), owner: actor.id, funds: amount, reach: 0, turn: w.turn };
  (c.papers ||= []).push(n); return n;
}

export function pressStep(w) {
  for (const c of aliveCountries(w)) {
    // A party's organisation is what its treasury pays for each quarter; where the press is gagged and unions banned, an opposition can build less.
    for (const p of c.parties) { const spend = (p.funds || 0) * .2; p.funds = (p.funds || 0) - spend; const open = p.id === c.rulingParty ? 1 : .4 + c.pressFreedom / 100 * .6; p.organization = (p.organization || 0) + (clamp(spend * 6 * open, 0, 60) - (p.organization || 0)) * .25; }
    const papers = c.papers ||= [], ruler = w.characters[c.leader];
    for (const n of [...papers]) {
      const owner = w.characters[n.owner];
      if (!owner?.alive) { papers.splice(papers.indexOf(n), 1); news(w, `${c.name}: ${n.name} has ceased to appear.`, { kind: 'politics', countries: [c.id] }); continue; }
      const spend = n.funds * .15; n.funds -= spend;
      // Readers: money spent, people who can read, and a law that lets it be printed and sold.
      n.reach += (clamp(spend * 8 * (c.literacy / 100) * (.2 + c.pressFreedom / 100), 0, 40) - n.reach) * .3;
      if (n.reach < 1) continue;
      const friendly = n.owner === c.leader;
      c.mods.push({ key: 'legitimacy', delta: friendly ? n.reach * .02 : -n.reach * .03, turns: 1, label: n.name });
      // Reporters dig where the owner's enemies are, as far as the law lets them print what they find.
      if (c.pressFreedom < 30 || rand(w) >= n.reach / 300) continue;
      const marks = Object.values(w.characters).filter(x => x.alive && x.country === c.id && x.id !== n.owner && x.status === 'free' && (ROLES.some(r => c[r] === x.id) || x.post) && (x.secrets || []).some(s => !s.published) && (friendly ? x.id !== c.leader : true));
      const mark = marks.sort((a, b) => (b.id === c.leader ? 1 : 0) - (a.id === c.leader ? 1 : 0) || b.power - a.power)[friendly ? marks.length - 1 : 0]; if (!mark) continue;
      const s = mark.secrets.filter(x => !x.published).at(-1); s.published = true;
      news(w, `${c.name}: ${n.name} has printed that ${mark.name}: ${s.text}`, { kind: 'plot', countries: [c.id] });
      if (mark.id === c.leader) c.legitimacy = clamp(c.legitimacy - 3.5 * (.4 + c.pressFreedom / 100), 0, 100); else mark.power = clamp(mark.power - 8, 0, 100);
      say(w, mark, n.name, `${n.name}, the paper of ${owner.name}, has printed this about you: ${s.text}`); if (ruler?.alive && ruler.id !== mark.id && ruler.id !== n.owner) say(w, ruler, 'Press office', `${n.name} (${owner.name}) has printed about ${mark.name}: ${s.text}`);
    }
  }
}
