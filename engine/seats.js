// What a seat decides for itself. The engine used to decide these in the seat's name: the leader of the opposition was made head of a civil
// war without being asked, a vacant chief of staff's office was filled by a stranger, an exile was sent to a refuge he had not chosen, and
// nobody could lay down an office or leave the country of his own will. Each is now the person's own act or answer, with what used to happen
// as the outcome when nothing is said.
import { clamp, news, quarterLabel } from './util.js';
import { ROLES, hasTreaty } from './world.js';
import { succeed, replaceSlot, stripPosts } from './politics.js';
import { incapacitated } from './health.js';
import { he, He, him, himself } from './names.js';

const say = (w, ch, from, text) => { if (ch?.alive) ch.inbox.push({ turn: w.turn, from, text }); };
const trace = (w, ch, text) => { if (!ch) return; (ch.secrets ||= []).push({ turn: w.turn, text }); ch.secrets = ch.secrets.slice(-12); };
const SEAT = { leader: 'head of the government', general: 'chief of the general staff', opposition: 'leader of the opposition', oligarch: 'head of the first business house' };
const seatOf = (c, ch) => ROLES.find(r => c[r] === ch.id) ?? null;
// Whether a state would let someone settle: not one that has already put him over its border, and not an ally of the state he is wanted in.
export function refuge(w, o, ch) {
  const home = w.countries[ch.country];
  if (!o?.alive || o.id === ch.country) return 'that is not a country abroad';
  if ((ch.turnedOut || []).includes(o.id)) return `${o.name} has put you over its border once and will not have you back`;
  if (home?.alive && hasTreaty(w, o.id, home.id, 'alliance') && (ch.trial || (ch.status === 'exiled' && ch.wentAbroad == null))) return `${o.name} is bound to ${home.name} by alliance and would hand a wanted person back at the frontier`;
  return '';
}
export const refuges = (w, ch) => Object.values(w.countries).filter(o => o.alive && !refuge(w, o, ch));

export function seatOp(w, actor, c, op, { fail, num, governs, personFor }) {
  switch (op.op) {
    // The leader of the opposition answers the provinces that have come to him.
    case 'lead_rising': {
      const r = c.rising; if (!r || r.asked !== actor.id) return fail('Nobody has asked you to lead a rising. A rising of one\'s own making is a plot (start_plot with kind uprising).');
      const yes = op.accept !== false && op.refuse !== true, warn = !yes && op.warn === true, ruler = w.characters[c.leader], first = r.answer == null && !r.warned;
      r.answer = yes;
      if (yes) { if (first) trace(w, actor, `Agreed in ${quarterLabel(w.turn)} to put ${himself(actor)} at the head of a rising of the provinces.`); return { ok: true, msg: 'Your word has gone back to the provinces. When they rise this coming quarter you are proclaimed at their head: you leave your seat and everything you hold under the government, and you lead the rising\'s government in a civil war. Until then you may still take it back.' }; }
      if (warn && !r.warned) {
        r.warned = true; trace(w, actor, `Was asked in ${quarterLabel(w.turn)} to lead a rising of the provinces, and gave the government warning of it.`);
        if (ruler?.alive && ruler.id !== actor.id) { say(w, ruler, actor.name, `${actor.name}, leader of the opposition, lets you know that men from the provinces came to ${him(actor)}: half the country means to rise in the coming quarter, and asked ${him(actor)} to lead it. ${He(actor)} has refused them. You have a quarter.`); const f = ruler.dossiers[actor.id] ||= { turn: w.turn, about: actor.name, facts: [] }; f.turn = w.turn; f.facts.push(`Gave warning in ${quarterLabel(w.turn)} that the provinces meant to rise, having refused to lead them.`); f.facts = f.facts.slice(-8); }
        return { ok: true, msg: `You have refused, and ${ruler?.name ?? 'the government'} has your warning: the provinces mean to rise in the coming quarter. They will rise under a man of their own if they still can. That you were asked, refused and told is on record with the government, and those who came to you will learn of it sooner or later.` };
      }
      if (first) trace(w, actor, `Was asked in ${quarterLabel(w.turn)} to lead a rising of the provinces, refused, and told the government nothing.`);
      return { ok: true, msg: `You have refused. They will rise in the coming quarter under a man of their own, and you stay what you are. ${r.warned ? 'The government has your warning already.' : 'You told the government nothing: that you knew and kept silent is a thing that can be found out.'}` };
    }
    // Withdrawing from public life. Somebody who holds no office (dismissed, fallen, in a cell, abroad) may say that he is done: he is then one of
    // the people around the seats, who can be written to and who answer as such people do, and is no longer one of those who are woken every
    // morning. It is his own decision and nobody else's, and it is final unless a government gives him an office again. (World 16: a chief of
    // staff who held the office for one quarter was still being woken every morning with nothing in his hands; the owner asked that whoever
    // wants to leave the stage may, and that nobody be made to.)
    case 'retire': {
      const seat = seatOf(c, actor); if (seat) return fail(`You are ${SEAT[seat]}: an office is laid down first (resign), and a private person may then withdraw from public life.`);
      if (actor.retired != null && !actor.everAI) return fail('You have withdrawn from public life already.');
      const words = op.words || op.reason ? `, with the words: "${String(op.words ?? op.reason).slice(0, 300)}"` : '', where = actor.status === 'imprisoned' ? ' from his cell' : actor.status === 'exiled' ? ' from abroad' : '';
      // What he led without an office ends with him; what he owns stays his.
      for (const pl of w.plots || []) { if (!pl.active) continue; if (pl.leader === actor.id) pl.active = false; else pl.members = (pl.members || []).filter(id => id !== actor.id); }
      actor.retired = w.turn; actor.everAI = false; actor.power = Math.min(actor.power ?? 0, 15);
      news(w, `${c.name}: ${actor.name}, once ${SEAT[actor.role] ?? 'in public life'}, has let it be known${where} that ${he(actor)} withdraws from public life${words}.`, { kind: 'politics', countries: [c.id] });
      return { ok: true, msg: 'You have withdrawn from public life. This was your last morning at the centre of things: you are not called on again unless a government gives you an office. What you own is still yours, and letters still reach you.' };
    }
    // Laying down an office.
    case 'resign': {
      const seat = seatOf(c, actor); if (!seat) return fail('You hold no seat to lay down.');
      const why = op.reason ? `, saying: "${String(op.reason).slice(0, 200)}"` : '';
      actor.resigned = w.turn;
      if (seat === 'leader') {
        news(w, `${c.name}: ${actor.name} has resigned as head of the government${why}.`, { kind: 'politics', countries: [c.id] });
        const next = succeed(w, c, actor); actor.outSince = w.turn;
        return { ok: true, msg: `You have laid down the government of ${c.name} and are a private person, at liberty. ${next.name} (${next.id}) governs: ${next.rise} Who followed you was settled by the country's rule of succession and by whom you had named.` };
      }
      if (seat === 'general') {
        // The army watches its chief go: less than when he is sent away, but it notices.
        const sting = clamp(actor.power / 28, .5, 3.5); for (const u of Object.values(w.units)) if (u.country === c.id) u.loyalty = clamp(u.loyalty - sting, 0, 100); c.blocs.army.sat = clamp(c.blocs.army.sat - sting, 0, 100);
      }
      news(w, `${c.name}: ${actor.name} has resigned as ${SEAT[seat]}${why}.`, { kind: 'politics', countries: [c.id] });
      replaceSlot(w, c, actor); const next = w.characters[c[seat]];
      if (seat !== 'general') say(w, w.characters[c.leader], 'The capital', `${actor.name} has resigned as ${SEAT[seat]}. ${next.name} (${next.id}) has the place.`);
      return { ok: true, msg: `You have resigned as ${SEAT[seat]} and are a private person, at liberty. ${next.name} (${next.id}) has your place${next.rise?.includes('deputy') ? ', as the deputy named for it' : ''}.${seat === 'general' ? ' The army noticed its chief go.' : seat === 'oligarch' ? ' The house and most of its fortune at home passed with the seat; you keep what was left to you and what lies abroad.' : ''}` };
    }
    // Going abroad of one's own will, or, for someone already abroad, moving to another country that will have them.
    case 'go_abroad': {
      const key = String(op.to ?? op.target ?? '').trim(), to = w.countries[key] ?? Object.values(w.countries).find(o => o.alive && o.name.toLowerCase() === key.toLowerCase()), no = refuge(w, to, actor);
      const open = () => refuges(w, actor).filter(o => o.id !== actor.host).map(o => `${o.name} (${o.id})`).join(', ') || 'none';
      if (!to || no) return fail(`${to ? `${no[0].toUpperCase()}${no.slice(1)}` : 'No such country'}. States that would let you settle: ${open()}.`);
      const host = w.characters[to.leader];
      if (actor.status === 'exiled') {
        if (actor.host === to.id) return fail(`You are living in ${to.name} already.`);
        const was = w.countries[actor.host]; actor.host = to.id; actor.recognisedBy = (actor.recognisedBy || []).filter(id => id !== was?.id);
        say(w, host, 'Police', `${actor.name}, of ${c.name}, who had been living in ${was?.name ?? 'another country'}, has settled among us. Sheltering, expelling or handing them back is yours to decide.`); if (was?.alive) say(w, w.characters[was.leader], 'Police', `${actor.name}, the exile from ${c.name}, has left us for ${to.name}.`);
        return { ok: true, msg: `You have left ${was?.name ?? 'your refuge'} and live in ${to.name} now. What its government does with you is its own affair.` };
      }
      const seat = seatOf(c, actor);
      news(w, `${c.name}: ${actor.name}${seat ? `, ${SEAT[seat]},` : ''} has left the country for ${to.name}.`, { kind: 'politics', countries: [c.id, to.id] });
      // Whoever leaves keeps his liberty and gives up his place: the seat is filled as if he had laid it down, and a name counts for less from abroad.
      actor.status = 'exiled'; actor.wentAbroad = w.turn; actor.host = to.id; actor.heldSince = w.turn; actor.outSince = w.turn; actor.power = Math.round(actor.power * .8); stripPosts(w, actor);
      let after = '';
      if (seat === 'leader') { const next = succeed(w, c, actor, 3); after = ` ${next.name} (${next.id}) governs in your place.`; }
      else if (seat) { replaceSlot(w, c, actor); after = ` ${w.characters[c[seat]].name} has your place.`; say(w, w.characters[c.leader], 'Police', `${actor.name}, ${SEAT[seat]}, has left the country for ${to.name}. ${w.characters[c[seat]].name} (${c[seat]}) has the place.`); }
      say(w, host, 'Police', `${actor.name}${seat ? `, until now ${SEAT[seat]}` : ''} of ${c.name} has come to live among us of their own will. Sheltering, expelling or handing them back is yours to decide.`);
      return { ok: true, msg: `You have crossed into ${to.name} and live there, beyond the reach of the police of ${c.name}.${after} What you have at home stays within the state's reach; what lies abroad is yours. You left of your own will and may come back when you choose (return_home), or move on (go_abroad).` };
    }
    case 'return_home': {
      if (actor.status !== 'exiled') return fail('You are not abroad.');
      const was = w.countries[actor.host], ruler = w.characters[c.leader], own = actor.wentAbroad != null;
      actor.host = null; actor.recognisedBy = []; delete actor.wentAbroad;
      if (own) { actor.status = 'free'; actor.outSince = w.turn; say(w, ruler, 'Police', `${actor.name} has come back from ${was?.name ?? 'abroad'} and is in the country again, at liberty.`); news(w, `${c.name}: ${actor.name} has returned from abroad.`, { kind: 'politics', countries: [c.id] }); return { ok: true, msg: `You are home again in ${c.name}, a private person at liberty. The government knows you are back.` }; }
      // Someone who was driven out comes back against an order that still stands. A strong police knows him at the frontier.
      if (c.police + c.intelligence / 2 >= 60) {
        actor.status = 'imprisoned'; actor.heldSince = w.turn; say(w, ruler, 'Police', `${actor.name}, who had been banished, tried to come back and was taken at the frontier. ${actor.name} is in prison.`);
        news(w, `${c.name}: ${actor.name}, who had been banished, was arrested at the frontier.`, { kind: 'politics', countries: [c.id] });
        return { ok: true, msg: `You crossed the frontier of ${c.name} against the order that banished you, were recognised, and are in a cell. A police as strong as this one knows a banished face.` };
      }
      actor.status = 'free'; actor.outSince = w.turn; const seen = c.intelligence >= 40; if (seen) say(w, ruler, 'Police', `${actor.name}, who had been banished, is back in the country in spite of the order. The police did not stop ${him(actor)} at the frontier and know where ${he(actor)} is.`);
      return { ok: true, msg: `You are back in ${c.name} against the order that banished you. The police did not know you at the frontier${seen ? ', but the government has heard that you are back' : ', and the government has not heard of it'}. The order still stands: you can be arrested like anyone.` };
    }
    // Who takes a seat when it falls vacant: whoever governs says it for the chief of staff's, the holder of a house or of the opposition's seat for his own.
    case 'name_deputy': {
      const own = seatOf(c, actor), seat = ['general', 'opposition', 'oligarch'].includes(op.seat) ? op.seat : governs ? 'general' : own;
      if (!seat || seat === 'leader') return fail(governs ? 'Who follows a ruler is named with designate_successor.' : 'You hold no seat to name a deputy for.');
      if (seat === 'general' ? !governs : own !== seat) return fail(seat === 'general' ? 'Who stands next to the chief of the general staff is for whoever governs to say.' : `The ${SEAT[seat]} names that deputy, nobody else.`);
      const list = c.deputies ||= {};
      if (op.remove === true) { const old = w.characters[list[seat]]; delete list[seat]; return { ok: true, msg: old ? `${old.name} is no longer the deputy named for the seat of ${SEAT[seat]}.` : 'No deputy was named.' }; }
      const n = personFor(w, c, op, seat === 'general' ? 'officer' : seat === 'oligarch' ? 'heir' : 'official');
      if (!n?.alive || n.country !== c.id || n.status !== 'free' || n.id === c[seat] || ROLES.some(r => c[r] === n.id) || incapacitated(n)) return fail(n ? `${n.name} cannot be named: a deputy is someone at liberty in the country who holds none of the four seats.` : 'No such person to name. Give a character, or a name for someone new.');
      list[seat] = n.id; say(w, n, actor.name, `You are named deputy to the ${SEAT[seat]}: if the seat falls vacant, it is yours the same day.`);
      return { ok: true, msg: `${n.name} (${n.id}) is the deputy named for the seat of ${SEAT[seat]}. If it falls vacant by death, arrest, flight, resignation or promotion, ${he(n)} takes it the same day${seat === 'general' ? ', and no stranger put forward by the army' : ''}. It stands until you change it or ${he(n)} is no longer at liberty here.` };
    }
  }
  return fail('Invalid operation.');
}
