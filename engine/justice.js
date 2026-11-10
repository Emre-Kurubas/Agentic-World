// The courts. An order of arrest is the ruler's own act and costs what such acts cost; a trial is the lawful road, and it can fail.
// A court weighs what is laid before it as far as it is free to: an independent bench convicts on evidence and acquits without it, a tame one
// convicts whoever is brought. Papers can be forged, and a free press and honest judges sometimes find the forgery.
import { clamp, rand, news } from './util.js';
import { neutralize, die } from './politics.js';

const say = (w, ch, from, text) => { if (ch?.alive) ch.inbox.push({ turn: w.turn, from, text }); };
const trace = (w, ch, text) => { if (!ch) return; (ch.secrets ||= []).push({ turn: w.turn, text }); ch.secrets = ch.secrets.slice(-12); };

export function prosecute(w, c, actor, ch, op) {
  if (ch.trial) return { ok: false, msg: `${ch.name} is already before the court.` };
  const file = actor.dossiers?.[ch.id], facts = [...(file?.facts ?? [])], forged = (file?.forged ?? []).filter(f => facts.includes(f));
  const charge = String(op.charge || 'offences against the state').slice(0, 160), penalty = op.penalty === 'death' ? 'death' : 'prison';
  ch.trial = { by: actor.id, country: c.id, charge, penalty, turn: w.turn, facts, forged };
  news(w, `${c.name}: ${ch.name} has been charged with ${charge} and will stand trial.`, { kind: 'politics', countries: [c.id] });
  say(w, ch, 'The court', `You are charged with ${charge} on the motion of ${actor.name}; the prosecution asks for ${penalty === 'death' ? 'death' : 'prison'}. The court rules next quarter. Laid before it: ${facts.length ? facts.join(' ') : 'no documents, only the charge'}. The bench here is ${c.courts >= 65 ? 'its own master' : c.courts >= 35 ? 'open to pressure' : 'the government\'s creature'}. You are at liberty until it rules.`);
  return { ok: true, msg: `${ch.name} is charged and will be tried next quarter on ${facts.length ? `${facts.length} document${facts.length > 1 ? 's' : ''} from your file` : 'no evidence but your word'}. The court here is ${c.courts >= 65 ? 'independent: it will want proof' : c.courts >= 35 ? 'open to pressure' : 'yours'}. Until then ${ch.name} is free.` };
}

export function justiceStep(w) {
  for (const ch of Object.values(w.characters)) {
    if (!ch.alive) continue;
    // A term that has run out ends.
    if (ch.sentence && ch.status === 'imprisoned' && w.turn >= ch.sentence.until) { ch.status = 'free'; ch.sentence = null; ch.outSince = w.turn; const c = w.countries[ch.country]; if (c?.alive) news(w, `${c.name}: ${ch.name} was released at the end of the sentence.`, { kind: 'politics', countries: [c.id] }); say(w, ch, 'The prison governor', 'Your sentence has run out. You are free.'); }
    const t = ch.trial; if (!t || w.turn <= t.turn) continue;
    const c = w.countries[t.country], by = w.characters[t.by]; ch.trial = null;
    if (!c?.alive || ch.country !== c.id || ch.status === 'exiled') { if (c?.alive) news(w, `${c.name}: ${ch.name} was tried in absence; the sentence cannot be carried out.`, { kind: 'politics', countries: [c.id] }); continue; }
    if (ch.id === c.leader) { news(w, `${c.name}: the case against ${ch.name}, who now governs, was dropped.`, { kind: 'politics', countries: [c.id] }); continue; }
    const free = c.courts / 100;
    // Forged papers are tested by the bench as far as the bench is its own master.
    const exposed = t.forged.some(() => rand(w) < clamp(.1 + c.courts / 160, .1, .7)), real = t.facts.length - t.forged.length, proof = Math.min(1, (exposed ? real : t.facts.length) * .22);
    if (exposed) {
      news(w, `${c.name}: the court found that documents laid against ${ch.name} were forged, and acquitted. The prosecution was brought by ${by?.name ?? 'the government'}.`, { kind: 'politics', countries: [c.id] });
      ch.power = clamp(ch.power + 12, 0, 100); if (by) { trace(w, by, `Laid forged documents before the court against ${ch.name}.`); if (by.id === c.leader) c.legitimacy = clamp(c.legitimacy - 6 * (.4 + c.pressFreedom / 100), 0, 100); else by.power = clamp(by.power - 10, 0, 100); }
      say(w, ch, 'The court', 'The court found the documents against you forged and has acquitted you.'); say(w, by, 'The court', `The court found the documents against ${ch.name} forged. ${ch.name} is acquitted, and the country knows who brought the case.`); continue;
    }
    if (rand(w) < free * proof + (1 - free) * .95) {
      const sound = proof >= .44 && free >= .5, death = t.penalty === 'death' && (free < .5 || proof >= .8);
      // A conviction on proof before a free court costs the state nothing. A sentence from a tame bench on thin papers is seen for what it is.
      if (sound) c.legitimacy = clamp(c.legitimacy + 1, 0, 100); else { c.legitimacy = clamp(c.legitimacy - (1 + 4 * c.pressFreedom / 100), 0, 100); c.mods.push({ key: 'unrest', delta: clamp(ch.power / 20, .5, 4) * (.3 + c.pressFreedom / 100), turns: 3, label: `The trial of ${ch.name}` }); }
      if (death) { news(w, `${c.name}: ${ch.name} was found guilty of ${t.charge} and executed.`, { kind: 'politics', countries: [c.id] }); trace(w, by, `Had ${ch.name} tried and put to death.`); die(w, ch, 'was executed after a trial', { quiet: true }); say(w, by, 'The court', `${ch.name} was found guilty and the sentence of death has been carried out.`); continue; }
      const years = Math.round(2 + proof * 6 + (1 - free) * 4);
      news(w, `${c.name}: ${ch.name} was found guilty of ${t.charge} and sentenced to ${years} years.`, { kind: 'politics', countries: [c.id] });
      neutralize(w, ch, 'imprisoned'); ch.sentence = { until: w.turn + years * 4, charge: t.charge };
      say(w, ch, 'The court', `Guilty of ${t.charge}: ${years} years. ${sound ? 'The country takes the verdict for just.' : 'Few believe the verdict was the court\'s own.'}`); say(w, by, 'The court', `${ch.name} was found guilty of ${t.charge} and sentenced to ${years} years${t.penalty === 'death' ? '; the court would not give death on what was laid before it' : ''}.`);
    } else {
      news(w, `${c.name}: the court acquitted ${ch.name} of ${t.charge}.`, { kind: 'politics', countries: [c.id] });
      ch.power = clamp(ch.power + 8, 0, 100); if (by?.id === c.leader) c.legitimacy = clamp(c.legitimacy - 2, 0, 100);
      say(w, ch, 'The court', `You are acquitted of ${t.charge}.`); say(w, by, 'The court', `The court acquitted ${ch.name}: what was laid before it did not carry the charge.`);
    }
  }
}

// A document that says what its maker needs it to say. It sits in the file with the real ones until someone tests it.
export function forge(w, actor, ch, claim) {
  const file = actor.dossiers[ch.id] ||= { turn: w.turn, about: ch.name, facts: [] }, text = String(claim).slice(0, 300);
  file.facts.push(text); file.facts = file.facts.slice(-8); (file.forged ||= []).push(text); file.forged = file.forged.filter(f => file.facts.includes(f));
  trace(w, actor, `Had a document forged against ${ch.name}.`);
  return { ok: true, msg: `The paper is in your file on ${ch.name}, with the real ones. A free press or an honest court may find it out if it is used.` };
}
// When a file goes to the papers, forged pages in it may be recognised.
export function forgeryFound(w, c, file) {
  const forged = (file.forged ?? []).filter(f => file.facts.includes(f));
  return forged.length > 0 && forged.some(() => rand(w) < clamp(.1 + c.pressFreedom / 200 + c.courts / 300, .1, .6));
}
