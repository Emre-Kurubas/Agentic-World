// Fear. A government that arrests without trial, hangs, breaks a strike with rifles or holds the streets is obeyed for a year or two beyond
// the reach of its police: men think twice before they strike, plot or print, and neighbours inform on one another. It is a level that harsh
// acts raise and that fades by about an eighth a quarter; a state that never does such things has none, and nothing here touches it.
// What it buys while it lasts (each read where that thing is reckoned): less unrest, fewer strikes, plots that gather slowly and leak, papers
// that find less, files that fill. What it costs, beside what the acts themselves cost (the dead remembered where they fell, the underground
// recruiting among their kin, standing at home and abroad): the comfortable classes sour, and officials who are afraid report what pleases.
// (World 19: in twelve quarters eight governments shed no blood at all. Their own words: "a martyr is worth ten editors", "buying is cheaper
// than martyrs". Every cost of hardness stood in the reports they read each morning, and none of what it had bought the governments of the
// age. The user asked for the short gain to be put into the engine and written where the cost is written.)
import { clamp } from './util.js';

export const FEAR_FADES = .88;
export const fearOf = c => c?.fear || 0;
// What an act adds, before it is added: so that a report can say what it would do.
export const DREAD = { streets: 30, arrest: 5, exile: 3, death: 12, trial: 4, gallows: 10, strike: 6, terror: 8, rising: 6, removal: 5 };
export function frighten(c, x) { if (c && x > 0) c.fear = clamp(fearOf(c) + x, 0, 100); return fearOf(c); }
// How the country stands, in a word, for whoever reads the police report.
export const fearWord = c => { const f = fearOf(c); return f >= 55 ? 'the country is cowed: people cross the street to avoid a policeman' : f >= 30 ? 'people are afraid, and it shows in what they will say aloud' : f >= 12 ? 'people are wary of the police' : ''; };
// What fear takes off the pressure in a province, off the men's readiness to walk out, off a plot's gathering and off what reporters dare.
export const hush = c => fearOf(c) * .12;
export const cowed = c => clamp(1 - fearOf(c) / 140, .3, 1);
export const informers = c => fearOf(c) / 300;
// What frightened officials do to the figures laid before whoever governs.
export const flattery = c => fearOf(c) / 500;

// What holding the streets would do to a province's unrest as the police stand today: how far it falls at the most, in which quarter, and
// for how many quarters it stays down by more than a point or two. The same arithmetic the provinces are reckoned by (politics.js).
export function streetsWould(c, s = .5) {
  const arm = clamp((c.police || 0) / 50, .25, 1.4); let R = s * 55 * arm, F = s * DREAD.streets * arm, d = 0, peak = 0, at = 1, last = 0;
  for (let t = 1; t <= 16; t++) { d += (-(R * .35 + F * .12) - d) * .35; if (-d > peak + 1e-9) { peak = -d; at = t; } if (-d >= 1.5) last = t; R = Math.max(0, R - 6); F *= FEAR_FADES; }
  return { peak, at, last };
}
export function fearStep(w) {
  for (const c of Object.values(w.countries)) { if (!c.alive || !c.fear) continue;
    // Those with something to lose take note of how the state deals with people, each quarter it lasts.
    if (c.fear >= 10) { c.mods.push({ key: 'sat.middle', delta: -c.fear * .06, turns: 1, label: 'Fear of the police' }); c.mods.push({ key: 'sat.capital', delta: -c.fear * .04, turns: 1, label: 'Fear of the police' }); }
    c.fear *= FEAR_FADES; if (c.fear < .5) delete c.fear; }
}
