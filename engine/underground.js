// The armed underground. Where working people are bitter and every lawful way to be heard is shut (no unions, a gagged press, no vote, police
// in the streets), some stop asking. Cells form, and when they are strong enough they strike at the people who stand for the order they hate.
// Blood shed by the state feeds them; an open country starves them; the police hunt them.
import { clamp, rand, news, sum, pick } from './util.js';
import { aliveCountries, countryProvinces } from './world.js';
import { die } from './politics.js';
import { afflict } from './health.js';

const say = (w, ch, from, text) => { if (ch?.alive) ch.inbox.push({ turn: w.turn, from, text }); };
export const cellsWord = v => v >= 60 ? 'strong, armed and striking at will' : v >= 35 ? 'organised and armed' : v >= 15 ? 'small and scattered' : 'no more than talk';
// How far the lawful ways are shut, from about 0.1 in a free country to 1.5 under a police state.
// (Meetings forbidden and societies broken up are doors shut like the others: masses.js.)
export const shut = c => (c.unions ? .35 : 1) * (1.15 - c.pressFreedom / 120) * (c.elections ? .6 : 1) + c.repress / 180 + (c.noMeetings ? .12 : 0) + Math.min(.2, (c.societies || []).filter(s => s.banned).length * .06);

function strike(w, c) {
  const ruler = w.characters[c.leader], chief = Object.values(w.characters).find(x => x.alive && x.country === c.id && x.post === 'police' && x.status === 'free');
  // The head of the state above all; then the general, the police, the richest owner.
  const marks = [[ruler, 5], [w.characters[c.general], 2], [chief, 2], [w.characters[c.oligarch], 2]].filter(([x]) => x?.alive && x.status === 'free' && x.country === c.id);
  if (!marks.length) return;
  let roll = rand(w) * sum(marks, m => m[1]), target = marks[0][0]; for (const [x, wgt] of marks) { if (roll < wgt) { target = x; break; } roll -= wgt; }
  const head = target.id === c.leader, guard = head ? .08 + c.police / 320 : c.police / 600, p = clamp(.16 + c.cells / 280 - guard, .03, .55), r = rand(w);
  const outcome = r < p * .5 ? 'killed' : r < p ? 'wounded' : 'missed', bomb = rand(w) < .55, others = bomb && outcome !== 'killed' ? Math.round(1 + rand(w) * 9) : 0;
  const deed = bomb ? `A bomb was thrown at ${target.name}` : `A man fired a revolver at ${target.name}`, where = w.provinces[c.capital]?.name ?? c.name; c.lastAttempt = { turn: w.turn, text: deed.replace(/^A /, 'a ') };
  c.cells = clamp(c.cells - 12, 0, 100); c.lastDeed = w.turn;
  news(w, `${c.name}: ${deed} in ${where}. ${outcome === 'killed' ? `${target.name} is dead.` : outcome === 'wounded' ? `${target.name} was wounded.` : `${target.name} was not hurt.`}${others ? ` ${others} bystanders were killed.` : ''} The attacker belonged to the armed underground.`, { kind: 'plot', countries: [c.id], province: c.capital });
  if (outcome === 'killed') die(w, target, 'was killed by an assassin of the underground', { quiet: true, shock: head ? 8 : 0 });
  else if (outcome === 'wounded') afflict(w, target, 'wound', rand(w) < .35 ? 3 : 2, 'an assassin of the underground');
  const now = w.characters[c.leader];
  if (now?.alive) say(w, now, 'Police', `${deed}${outcome === 'killed' ? ', who is dead' : outcome === 'wounded' ? ', who is wounded' : ', who escaped unhurt'}. The man belonged to the armed underground, which the police judge to be ${cellsWord(c.cells)}. It lives on the bitterness of the working people and on every lawful door that is shut to them, and on blood the state has shed; it is weakened by police work and by whatever opens those doors.`);
}

// Where the underground settles: anger times how far the doors are shut, plus fresh blood and outside money, less what the police break up.
export function cellsRest(w, c) {
  const provs = countryProvinces(w, c.id), mean = k => sum(provs, p => p.pops[k].sat * p.pops[k].n) / Math.max(sum(provs, p => p.pops[k].n), 1e-9);
  const anger = Math.max(0, 45 - mean('workers')) + Math.max(0, 40 - mean('peasants')) * .6;
  return clamp(anger * shut(c) * 1.6 + (c.blood || 0) * 2 + (c.cellFunds || 0) - (c.police + c.intelligence) / 200 * 12, 0, 100);
}
// A state that is handed over has had its misery and its police for years: whatever underground they breed is there already, not something
// the new ruler watches grow from nothing.
export function settleUnderground(w) { for (const c of aliveCountries(w)) { c.cells = cellsRest(w, c); c.cellsKnown = false; } }

export function undergroundStep(w) {
  for (const c of aliveCountries(w)) {
    const was = c.cells ?? 0;
    c.blood = (c.blood || 0) * .88;
    const want = cellsRest(w, c);
    c.cellFunds = (c.cellFunds || 0) * .7; c.cells = clamp(was + (want - was) * .14, 0, 100);
    const ruler = w.characters[c.leader], opp = w.characters[c.opposition];
    // The police report it once when it takes shape (or, in a state handed over with one, in the new ruler's first quarter), and again only if it was broken and came back.
    c.cellsKnown ??= was >= 30; if (c.cells < 24) c.cellsKnown = false;
    if (c.cells >= 30 && !c.cellsKnown) {
      c.cellsKnown = true;
      say(w, ruler, 'Police', `The police report that an armed underground has taken shape: cells with weapons and printing presses, ${cellsWord(c.cells)}. They expect attempts on the lives of people in office.`);
      // They look for money and for friends in the lawful opposition.
      if (opp?.alive && opp.status === 'free' && opp.id !== c.leader) say(w, opp, 'A visitor', `Men who say they speak for the armed underground have sought you out. They want money and your silence, and they say that what you will not do, they will. You may give them money (it would be a secret that could hang you), tell the police, or send them away.`);
    }
    if (c.cells >= 30 && rand(w) < (c.cells - 30) / 260) strike(w, c);
  }
}

// Money for the underground of one's own country or another's. It makes the cells stronger for a few quarters and is a secret of the gravest kind.
export function fundUnderground(w, actor, target, amount, trace) {
  target.cellFunds = (target.cellFunds || 0) + amount * 1.2;
  trace(w, actor, `Paid ${Math.round(amount)} to the armed underground of ${target.name}.`);
  return { ok: true, msg: `${Math.round(amount)} reached the underground of ${target.name}. No one knows of it but you and them.` };
}
