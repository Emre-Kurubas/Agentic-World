// The press, and the machinery of parties.
// A newspaper is somebody's: it costs money every quarter, reaches as many readers as there are people who can read and a law that lets them,
// speaks for its owner's side, and now and then prints what someone in office would rather keep quiet. A party is not only a mood in the
// country: committees, organisers and dues turn sympathy into votes, and they cost money too.
import { clamp, rand, news, nextId, sum } from './util.js';
import { aliveCountries, ROLES } from './world.js';
import { duesOf } from './means.js';
import { rivalParty, onBenches, leadsParties } from './polity.js';
import { cameOut } from './intrigue.js';

const say = (w, ch, from, text) => { if (ch?.alive) ch.inbox.push({ turn: w.turn, from, text }); };
// A paper put into somebody's file: once, and the file keeps the latest eight.
const fileOn = (w, holder, about, text) => { const f = holder.dossiers[about.id] ||= { turn: w.turn, about: about.name, facts: [] }; if (f.facts.includes(text)) return false; f.turn = w.turn; f.facts.push(text); f.facts = f.facts.slice(-8); return true; };
export const MAX_PAPERS = 6;
export const papersOf = c => c.papers || [];
// Which party a person's paper speaks for when nothing else is said: the one they founded or lead.
const sideOf = (w, c, id) => id === c.leader ? c.rulingParty : c.parties.find(p => p.founder === id)?.id ?? (id === c.opposition ? leadsParties(w, c, w.characters[id])[0]?.id ?? null : null);
// A paper has a line, and it is its owner's to give (set_paper). Left alone it serves its owner's side. Told otherwise it serves the government
// whoever owns it, stands against the government, speaks for a party that is named, or serves nobody and only sells news.
export const SERVES = ['owner', 'government', 'against', 'none'];
export const partyOfPaper = (w, c, n) => { const s = n.serves ?? 'owner'; return s === 'owner' ? sideOf(w, c, n.owner) : s === 'government' ? c.rulingParty : s === 'against' ? rivalParty(c)?.id ?? null : c.parties.some(p => p.id === s && !p.banned) ? s : null; };
// Where a paper stands toward the government: for it, against it, or neither. The ruler's own paper is for it, and so is the paper of anyone
// whose party sits on the government's benches; any other paper left to itself is against, as an owner out of office is taken to be.
export function standOf(w, c, n) {
  const s = n.serves ?? 'owner'; if (s === 'government') return 'for'; if (s === 'against') return 'against'; if (s === 'none') return 'none';
  const party = c.parties.find(p => p.id === partyOfPaper(w, c, n));
  if (s !== 'owner') return party ? (onBenches(c, party) ? 'for' : 'against') : 'none';
  return n.owner === c.leader || (party && onBenches(c, party)) ? 'for' : 'against';
}
// A paper with the censor in its office says less, for a party and against a government alike.
const weightOf = n => n.reach * (n.gag ? .4 : 1);
// A name the censor has forbidden to every paper, or to this one.
export const barred = (c, n, who) => (c.barred || []).some(b => b.who === who && (!b.paper || b.paper === n?.id));
// A trace that somebody is paid or placed to keep out of sight is not found while that person is alive, at liberty and still where he was.
export const keptQuiet = (w, s) => { const k = s?.buried && w.characters[s.buried.by]; return !!k && k.alive && k.status === 'free' && (!s.buried.post || k.post === s.buried.post); };
// How much the papers behind a party add to what it can make of the country's mood, in points of a hundred.
export const voiceOf = (w, c, party) => clamp(sum(papersOf(c).filter(n => partyOfPaper(w, c, n) === party.id), weightOf), 0, 60);
// How far a publication carries: with a paper of one's own it is read across the country, without one it is a pamphlet. A paper under the
// censor, or forbidden the name it would print, carries nothing of it.
export const carry = (c, actor, about) => clamp(.6 + sum(papersOf(c).filter(n => n.owner === actor.id && !n.gag && !(about && barred(c, n, about))), n => n.reach) / 50, .6, 1.6);
const lineWords = (w, c, n) => { const s = n.serves ?? 'owner', p = c.parties.find(x => x.id === partyOfPaper(w, c, n)); return s === 'government' ? 'serves the government' : s === 'against' ? 'stands against the government' : s === 'none' ? 'serves nobody and sells news' : s === 'owner' ? `speaks for its owner's side${p ? ` (${p.name})` : ''}` : `speaks for ${p?.name ?? 'a party that no longer stands'}`; };
// What every reader can see of a paper: whose side it takes.
export const paperWords = (w, c, n) => `${lineWords(w, c, n)}, which counts ${{ for: 'for the government', against: 'against the government', none: 'neither for nor against the government' }[standOf(w, c, n)]}`;
const named = (w, list) => list.map(id => w.characters[id]).filter(x => x?.alive).map(x => x.name);
// What its owner has told it, for the owner's eyes.
export const ordersWords = (w, c, n) => [n.targets?.length ? `its reporters go first after ${named(w, n.targets).join(', ') || 'no one now living'}` : 'its reporters dig where they will, at the top first', n.spare?.length ? `it leaves alone ${named(w, n.spare).join(', ') || 'no one now living'}` : '', n.print === 'hold' ? 'what they find is held back for your file and not printed' : 'what they find is printed at once', n.gag ? 'THE CENSOR SITS IN ITS OFFICE: it prints nothing its reporters find and says less than it would' : ''].filter(Boolean).join('; ');

export function foundPaper(w, c, actor, name, amount) {
  const n = { id: nextId(w, 'N'), name: String(name || `${c.name} Gazette`).slice(0, 60), owner: actor.id, funds: amount, reach: 0, turn: w.turn };
  (c.papers ||= []).push(n); return n;
}
// By its number, or by its name as a person would write it: with or without the article, whatever the capitals. (World 16: "Village Sheet" was
// not "The Village Sheet", five times.)
const bare = s => String(s ?? '').trim().toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const findPaper = (c, key) => papersOf(c).find(x => x.id === key) ?? (bare(key) ? papersOf(c).find(x => bare(x.name) === bare(key)) : undefined);
const findPerson = (w, c, key) => { const k = String(key ?? '').trim(), x = Object.hasOwn(w.characters, k) ? w.characters[k] : Object.values(w.characters).find(y => y.alive && y.country === c.id && y.name.toLowerCase() === k.toLowerCase()); return x?.alive ? x : null; };
const listed = c => papersOf(c).length ? ` Those that appear here: ${papersOf(c).map(x => `${x.name} (${x.id})`).join(', ')}.` : '';

// The owner gives the paper its line. Only what the order names is changed; an order given again changes nothing and costs nothing.
export function setPaper(w, c, actor, op) {
  const key = op.id ?? op.paper ?? op.name, own = papersOf(c).filter(x => x.owner === actor.id), n = key != null ? findPaper(c, key) : own.length === 1 ? own[0] : null;
  if (!n) return { ok: false, msg: `No such newspaper.${listed(c)}` };
  if (n.owner !== actor.id) return { ok: false, msg: `${n.name} is ${w.characters[n.owner]?.name ?? 'another'}'s paper, and its line is its owner's to give. What it prints can be asked of its owner or paid for; whoever governs can set a censor on it or close it.` };
  const notes = [];
  if (op.serves != null) {
    const s = String(op.serves).trim(), k = { owner_side: 'owner', mine: 'owner', me: 'owner', opposition: 'against', nobody: 'none', neutral: 'none' }[s] ?? s, party = c.parties.find(p => !p.banned && (p.id === k || p.name.toLowerCase() === k.toLowerCase()));
    if (!SERVES.includes(k) && !party) return { ok: false, msg: `A paper serves its owner's side (owner), the government, stands against it (against), speaks for a party (${c.parties.filter(p => !p.banned).map(p => `${p.id} ${p.name}`).join(', ')}) or serves nobody (none).` };
    if (k === 'owner') delete n.serves; else n.serves = party ? party.id : k;
  }
  for (const k of ['targets', 'spare']) if (op[k] != null) {
    const got = [], lost = []; for (const who of [].concat(op[k]).slice(0, 8)) { const x = findPerson(w, c, who); if (x && x.country === c.id && x.id !== actor.id) got.push(x.id); else lost.push(String(who)); }
    if (got.length) n[k] = [...new Set(got)]; else delete n[k];
    if (lost.length) notes.push(`${lost.join(', ')} ${lost.length > 1 ? 'are' : 'is'} not among the people of ${c.name} its reporters can reach, and ${lost.length > 1 ? 'were' : 'was'} left out`);
  }
  if (n.targets && n.spare) { n.targets = n.targets.filter(id => !n.spare.includes(id)); if (!n.targets.length) delete n.targets; }
  if (op.print != null) { if (!['at_once', 'hold'].includes(op.print)) return { ok: false, msg: 'What its reporters find is printed at_once, or put on hold for the owner\'s file.' }; if (op.print === 'hold') n.print = 'hold'; else delete n.print; }
  return { ok: true, msg: `${n.name} ${paperWords(w, c, n)}; ${ordersWords(w, c, n)}.${notes.length ? ` ${notes.join('; ')}.` : ''} It stays so until you change it.` };
}

// Short of closing a paper: a censor in its office, or a name no paper may print. It is an act of state: it takes from the freedom of the
// press, less than a closure does, and readers who had a free press notice the white columns.
export const MAX_BARRED = 12;
export function censor(w, c, actor, op) {
  const key = op.paper ?? op.id ?? op.name, n = key != null ? findPaper(c, key) : null, who = op.about ?? op.subject ?? op.character, x = who != null ? findPerson(w, c, who) : null, lift = op.lift === true || op.on === false;
  if (key != null && !n) return { ok: false, msg: `No such newspaper.${listed(c)}` };
  if (who != null && !x) return { ok: false, msg: 'A censor can be told to strike a name (about: a person) or be put into a paper\'s office (paper); no such person is known.' };
  if (!n && !x) return { ok: false, msg: 'Say which paper the censor is to sit in (paper), or whose name no paper may print (about), or both for one name in one paper.' };
  if (x) {
    const list = c.barred ||= [], at = list.findIndex(b => b.who === x.id && (b.paper ?? null) === (n?.id ?? null));
    if (lift) { if (at < 0) return { ok: false, msg: 'No such order of the censor stands.' }; list.splice(at, 1); return { ok: true, msg: `${n ? n.name : 'The papers'} may print about ${x.name} again.` }; }
    if (at >= 0 || (n && list.some(b => b.who === x.id && !b.paper))) return { ok: false, msg: `The censor already strikes ${x.name}'s name${n && at < 0 ? ' from every paper' : ''}; the order stands until it is lifted.` };
    if (list.length >= MAX_BARRED) return { ok: false, msg: `The censor's list holds ${MAX_BARRED} names already; one would have to be lifted first.` };
    list.push({ who: x.id, paper: n?.id ?? null, turn: w.turn }); c.pressFreedom = clamp(c.pressFreedom - 1, 0, 100);
    return { ok: true, msg: `${n ? `${n.name} is` : 'The papers are'} forbidden to print about ${x.name}. What their reporters find about ${x.name} is struck before it is set: it is laid before you, and it stays with the owner who found it, who can still pass it from hand to hand as a pamphlet. It cost the press a little of its freedom (now ${Math.round(c.pressFreedom)} of 100), and readers see the white column each time a piece is struck.` };
  }
  if (lift) { if (!n.gag) return { ok: false, msg: `No censor sits in the office of ${n.name}.` }; delete n.gag; news(w, `${c.name}: the censor has been withdrawn from ${n.name}.`, { kind: 'politics', countries: [c.id] }); say(w, w.characters[n.owner], c.name, `The censor has been taken out of the office of your paper ${n.name}.`); return { ok: true, msg: `${n.name} prints freely again.` }; }
  if (n.gag) return { ok: false, msg: `A censor already sits in the office of ${n.name}.` };
  n.gag = w.turn; c.pressFreedom = clamp(c.pressFreedom - 2, 0, 100); c.legitimacy = clamp(c.legitimacy - (.5 + n.reach / 40) * (.4 + c.pressFreedom / 100), 0, 100);
  news(w, `${c.name}: the government has put a censor into the office of ${n.name}.`, { kind: 'politics', countries: [c.id] }); say(w, w.characters[n.owner], c.name, `A censor has been put into the office of your paper ${n.name} by order of ${actor.name}. It still appears; it prints nothing its reporters find, and says less than it did.`);
  return { ok: true, msg: `A censor sits in the office of ${n.name}. It still appears, prints nothing its reporters find out about anyone, and counts for well under half of what it did for its side. The country saw it done: it cost less standing and less of the press's freedom (now ${Math.round(c.pressFreedom)} of 100) than closing the paper would have.` };
}

export function pressStep(w) {
  for (const c of aliveCountries(w)) {
    // A party's organisation is what its treasury pays for each quarter; where the press is gagged and unions banned, an opposition can build less.
    for (const p of c.parties) { if (p.dues > 0 && !p.banned) p.funds = (p.funds || 0) + duesOf(c, p); const spend = (p.funds || 0) * .2; p.funds = (p.funds || 0) - spend; const open = p.id === c.rulingParty ? 1 : .4 + c.pressFreedom / 100 * .6; p.organization = (p.organization || 0) + (clamp(spend * 6 * open, 0, 60) - (p.organization || 0)) * .25; }
    const papers = c.papers ||= [], ruler = w.characters[c.leader];
    if (c.barred) c.barred = c.barred.filter(b => w.characters[b.who]?.alive && (!b.paper || papers.some(n => n.id === b.paper)));
    for (const n of [...papers]) {
      const owner = w.characters[n.owner];
      if (!owner?.alive) { papers.splice(papers.indexOf(n), 1); news(w, `${c.name}: ${n.name} has ceased to appear.`, { kind: 'politics', countries: [c.id] }); continue; }
      const spend = n.funds * .15; n.funds -= spend;
      // Readers: money spent, people who can read, and a law that lets it be printed and sold.
      n.reach += (clamp(spend * 8 * (c.literacy / 100) * (.2 + c.pressFreedom / 100), 0, 40) - n.reach) * .3;
      if (n.reach < 1) continue;
      const friendly = standOf(w, c, n) === 'for', hunt = (n.targets || []).filter(id => w.characters[id]?.alive);
      // Reporters dig as far as the law lets them print what they find; a paper set on named people finds what there is about them sooner.
      if (c.pressFreedom < 30 || n.gag || rand(w) >= n.reach / 300 * (hunt.length ? 1.5 : 1)) continue;
      // They leave alone the owner, whoever the owner has told them to spare, and, in a paper that stands with the government, its head.
      const spare = new Set([n.owner, ...(n.spare || []), ...(friendly ? [c.leader] : [])]), filed = x => owner.dossiers[x.id]?.facts || [];
      // What has been held back or struck already lies in the owner's file and is not found a second time.
      const fresh = x => (x.secrets || []).filter(s => !s.published && !keptQuiet(w, s) && !((n.print === 'hold' || barred(c, n, x.id)) && filed(x).includes(s.text)));
      const marks = Object.values(w.characters).filter(x => x.alive && x.country === c.id && !spare.has(x.id) && (hunt.includes(x.id) || (x.status === 'free' && (ROLES.some(r => c[r] === x.id) || x.post))) && fresh(x).length);
      // Whom they go after: those the owner named, in his order; then, in a paper against the government, its head and after him whoever counts
      // for most; in a paper for the government the leader of the opposition and after him whoever counts for most.
      const first = friendly ? c.opposition : c.leader, rank = x => hunt.includes(x.id) ? hunt.indexOf(x.id) : 99;
      const mark = marks.sort((a, b) => rank(a) - rank(b) || (b.id === first ? 1 : 0) - (a.id === first ? 1 : 0) || b.power - a.power)[0]; if (!mark) continue;
      const s = fresh(mark).at(-1);
      if (barred(c, n, mark.id)) {
        // The censor strikes it. The piece is not lost: the owner has it, and now the government has it too.
        fileOn(w, owner, mark, s.text); c.legitimacy = clamp(c.legitimacy - .3 * (.4 + c.pressFreedom / 100), 0, 100);
        say(w, owner, 'The censor', `The censor struck from ${n.name} a piece saying of ${mark.name}: ${s.text} It was not printed, and the paper appeared with a white column. The piece lies in your file on ${mark.name}.`);
        if (ruler?.alive && ruler.id !== mark.id && ruler.id !== owner.id) { fileOn(w, ruler, mark, s.text); say(w, ruler, 'The censor', `Struck from ${n.name} (${owner.name}) before it was set, a piece saying of ${mark.name}: ${s.text} It is in your file on ${mark.name}. ${owner.name} holds it too.`); }
        continue;
      }
      if (n.print === 'hold') { fileOn(w, owner, mark, s.text); say(w, owner, n.name, `Your reporters at ${n.name} have found this about ${mark.name} and, as ordered, have not printed it: ${s.text} It lies in your file on ${mark.name}, to be kept, shown to ${mark.name}, passed on or printed (publish_dossier) as you choose.`); continue; }
      s.published = true;
      news(w, `${c.name}: ${n.name} has printed that ${mark.name}: ${s.text}`, { kind: 'plot', countries: [c.id] });
      // Some things cost more than the person when they come out: a staged incident the state's word, foreign money a party its following.
      cameOut(w, mark, s);
      if (mark.id === c.leader) c.legitimacy = clamp(c.legitimacy - 3.5 * (.4 + c.pressFreedom / 100), 0, 100); else mark.power = clamp(mark.power - 8, 0, 100);
      say(w, mark, n.name, `${n.name}, the paper of ${owner.name}, has printed this about you: ${s.text}`); if (ruler?.alive && ruler.id !== mark.id && ruler.id !== n.owner) say(w, ruler, 'Press office', `${n.name} (${owner.name}) has printed about ${mark.name}: ${s.text}`);
    }
    // What the papers do to the government's standing. Readers are shared: a second paper on the same side reaches mostly people the first
    // already reaches, so after the widest-read one each further paper adds half of what the one before it added.
    for (const own of [true, false]) {
      const side = papers.filter(n => n.reach >= 1 && standOf(w, c, n) === (own ? 'for' : 'against')).sort((a, b) => weightOf(b) - weightOf(a)), heard = side.reduce((a, n, i) => a + weightOf(n) * .5 ** i, 0);
      if (heard > 0) c.mods.push({ key: 'legitimacy', delta: own ? heard * .02 : -heard * .03, turns: 1, label: side.map(n => n.name).join(', ') });
    }
  }
}
