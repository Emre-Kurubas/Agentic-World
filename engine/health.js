// Bodies fail. Illness comes with age, prison and epidemics, wounds with violence; either can pass, linger or kill.
// The engine only records the body's state. What a sick ruler, or the people around one, do about it is their own affair.
import { clamp, rand, news } from './util.js';

export const SEVERITY = { 1: 'mild', 2: 'serious', 3: 'grave' };
export const incapacitated = ch => (ch?.condition?.severity ?? 0) >= 3;
export const healthText = ch => ch?.condition ? `${SEVERITY[ch.condition.severity]} ${ch.condition.kind === 'wound' ? 'wound' : 'illness'}` : 'sound';
const OFFICES = ['leader', 'general', 'opposition', 'oligarch'];
const holdsOffice = (w, ch) => { const c = w.countries[ch.country]; return !!c?.alive && OFFICES.some(r => c[r] === ch.id); };

// A serious illness of a ruler is news where the press can print it; elsewhere the palace hides it and it becomes a secret someone can dig up.
function announce(w, ch) {
  const c = w.countries[ch.country], sev = ch.condition.severity;
  if (sev < 2 || !holdsOffice(w, ch)) return;
  const hidden = c.leader === ch.id && c.pressFreedom < 40 && sev < 3 && ch.condition.kind !== 'wound';
  news(w, `${c.name}: ${ch.name} is ${sev >= 3 ? 'gravely' : 'seriously'} ${ch.condition.kind === 'wound' ? 'wounded' : 'ill'}${sev >= 3 ? ' and cannot carry out any duties' : ''}.`, { kind: 'politics', countries: [c.id], secret: hidden });
  if (hidden) { (ch.secrets ||= []).push({ turn: w.turn, text: 'Is seriously ill, and the palace is hiding it.' }); ch.secrets = ch.secrets.slice(-12); }
}

// Makes someone ill or wounded. A severity of 4 or more is fatal: returns true and leaves the death to the caller.
export function afflict(w, ch, kind, severity, cause = '') {
  if (!ch?.alive) return false;
  const s = Math.max(ch.condition?.severity ?? 0, Math.round(severity));
  if (s >= 4) return true;
  ch.condition = { kind, severity: clamp(s, 1, 3), since: ch.condition?.since ?? w.turn, cause };
  announce(w, ch);
  return false;
}

// Each quarter the healthy may fall ill and the sick improve, hold or worsen. Old age makes all of it harder; modern medicine makes it easier.
export function healthStep(w, die) {
  for (const ch of Object.values(w.characters)) {
    if (!ch.alive) continue;
    const c = w.countries[ch.country], age = ch.age ?? 50, medicine = c?.techs?.antibiotics ? .12 : 0, cond = ch.condition;
    if (!cond) {
      const plague = c?.alive && w.epidemics.some(e => e.active && e.provinces[c.capital]) ? .02 : 0;
      const onset = clamp(.006 + Math.max(0, (age - 45) / 45) ** 3 * .18, .006, .5) + plague + (ch.status === 'imprisoned' ? .015 : 0);
      if (rand(w) < onset) { ch.condition = { kind: 'illness', severity: rand(w) < clamp(.2 + (age - 40) / 100, .15, .6) ? 2 : 1, since: w.turn, cause: plague ? 'epidemic' : '' }; announce(w, ch); }
      continue;
    }
    const better = clamp(.5 - (age - 40) / 150 + medicine, .15, .65), worse = clamp(.12 + (age - 40) / 200 - medicine / 2, .06, .45), roll = rand(w);
    if (roll < better) {
      if (--cond.severity <= 0) { delete ch.condition; if (holdsOffice(w, ch) && cond.announced) news(w, `${c.name}: ${ch.name} has recovered.`, { kind: 'politics', countries: [c.id] }); }
    } else if (roll < better + worse) {
      if (++cond.severity >= 4) { const how = cond.kind === 'wound' ? 'died of wounds' : 'died after an illness'; delete ch.condition; die(w, ch, how); }
      else { announce(w, ch); cond.announced = true; }
    }
    if (ch.condition?.severity >= 2) ch.condition.announced = true;
  }
}
