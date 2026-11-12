// Labour at the works. Every company pays a wage against the going rate, spends something on safety, and has a workforce with a temper of
// its own. Bad pay and dead comrades make men walk out; a walkout stops the works until someone gives way, is starved back, or is shot back.
// What a careless owner saves on timbering and pumps he may pay for in one morning.
import { clamp, rand, news, sum, pick } from './util.js';
import { STATE, isOpen, firmBy } from './firms.js';
import { him, himself } from './names.js';

const say = (w, ch, from, text) => { if (ch?.alive) ch.inbox.push({ turn: w.turn, from, text }); };
const trace = (w, ch, text) => { if (!ch) return; (ch.secrets ||= []).push({ turn: w.turn, text }); ch.secrets = ch.secrets.slice(-12); };
const keyOf = f => f.sector === 'mine' ? f.resource : f.sector;
const DANGER = { mine: 1, steel: .5, fuel: .6, arms: .5, fertilizer: .4, machines: .25, goods: .15 };
const r2 = v => Math.round(v * 100) / 100;
export const temperWord = t => t >= 72 ? 'on the edge of walking out' : t >= 55 ? 'angry' : t >= 35 ? 'restless' : 'quiet';
export const stopped = f => !!(f.strike || f.lockout || f.halted > 0);
const bossOf = (w, c, f) => f.owner === STATE ? w.characters[c.leader] : w.characters[f.owner];
// Bodies that inspect the works make them safer and take some of the anger; relief funds keep strikers fed.
const inspectors = c => clamp(sum((c.institutions || []).filter(i => i.id && i.powers.includes('industry')), i => i.strength), 0, 1.2);
const relief = c => clamp(sum((c.institutions || []).filter(i => i.id && i.powers.includes('welfare')), i => i.strength) * .12, 0, .3);

function disaster(w, c, p, f) {
  const boss = bossOf(w, c, f), ruler = w.characters[c.leader], pit = f.sector === 'mine';
  const dead = Math.round((15 + rand(w) * 180) * clamp(f.stake + .3, .3, 1.3) * (pit ? 1 : .4)), what = pick(w, pit ? ['A fire-damp explosion', 'A flooded gallery', 'A roof fall'] : ['A boiler explosion', 'A fire']);
  p.pops.workers.n = Math.max(1, p.pops.workers.n - dead / 1000); p.unrest = clamp(p.unrest + 4, 0, 100);
  f.disasterAt = w.turn; f.halted = 1; f.temper = clamp(f.temper + 28, 0, 100); f.cash -= Math.min(Math.max(f.cash, 0), 4 + dead / 20);
  c.mods.push({ key: 'sat.workers', delta: -3, turns: 3, label: `The dead of ${f.name}` });
  news(w, `${c.name}: ${what.toLowerCase()} at ${f.name} in ${p.name} killed about ${dead}.`, { kind: 'disaster', countries: [c.id], province: p.id });
  // Below what the law requires is noted as that, even where nothing was found let go.
  const floor = c.labourLaw?.safety ?? 0, careless = f.safety < .3, below = floor > 0 && f.safety < floor - .001, note = careless ? 'pumps, timbering and ventilation had been let go' : below ? `nothing was found let go, but the law requires ${r2(floor)}` : 'the works were kept in fair order and the cause lay elsewhere';
  say(w, boss, 'Works manager', `${what} at ${f.name} (${f.id}) killed about ${dead} of your people, and the works stand still this quarter. The inspector's note: safety spending stood at ${r2(f.safety)} of 1 (${note}). The families and the men who are left look to you.`);
  if (ruler?.alive && ruler.id !== boss?.id) say(w, ruler, 'Police', `${what} at ${f.name} (${f.id}) in ${p.name} killed about ${dead}. The works belong to ${f.owner === STATE ? 'the state' : boss?.name ?? 'no one in particular'}; safety spending there stood at ${r2(f.safety)} of 1${below ? `, under the ${r2(floor)} the law requires` : careless ? ', and the works had been let go' : ''}. The district is angry.`);
  if ((careless || below) && boss && f.owner !== STATE) trace(w, boss, careless ? `Let safety at ${f.name} run down before the disaster that killed ${dead}.` : `Kept safety at ${f.name} under the legal floor before the disaster that killed ${dead}.`);
}

function walkOut(w, c, p, f) {
  const boss = bossOf(w, c, f), ruler = w.characters[c.leader], demand = r2(Math.min(1.6, f.wage + .15)), safer = f.safety < .5;
  f.strike = { since: w.turn, demand, safer };
  news(w, `${c.name}: the workers of ${f.name} in ${p.name} have walked out${safer ? ' over pay and safety' : ' over pay'}.`, { kind: 'politics', countries: [c.id], province: p.id });
  const ask = `wages raised to ${demand} of the going rate (now ${r2(f.wage)})${safer ? ' and safety spending brought to at least 0.5 (now ' + r2(f.safety) + ')' : ''}`;
  say(w, boss, 'Works manager', `The men at ${f.name} (${f.id}) have struck. They want ${ask}. While they are out the works produce next to nothing. You can meet them (set_wages${safer ? ', set_safety' : ''}), shut the gates and wait for hunger to bring them back (lockout), or simply wait.${f.owner === STATE ? '' : ' The government can send men to break the strike or impose a settlement.'}`);
  if (ruler?.alive && ruler.id !== boss?.id) say(w, ruler, 'Police', `Strike at ${f.name} (${f.id}) in ${p.name}, owned by ${boss?.name ?? 'no one in particular'}: the men want ${ask}. It is the owner's to settle; the state can break it by force (break_strike) or impose terms (arbitrate_strike).`);
}

function strikeGoesOn(w, c, p, f, others) {
  const s = f.strike, boss = bossOf(w, c, f), quarters = w.turn - s.since;
  if (f.wage >= s.demand - .001 && (!s.safer || f.safety >= .5)) {
    f.strike = null; f.lockout = null; f.temper = 25; news(w, `${c.name}: the strike at ${f.name} ended; the men won their demands.`, { kind: 'politics', countries: [c.id], province: p.id });
    say(w, boss, 'Works manager', `The men at ${f.name} are back at work on the terms they asked.`); return;
  }
  // A strike fund runs down. Men go back sooner where there is no work to be had elsewhere and no one to feed them.
  const beaten = clamp(.1 + quarters * .12 + c.unemployment * .8 + (f.lockout ? .08 : 0) - (c.unions ? .1 : 0) - relief(c), .05, .85);
  if (rand(w) < beaten) {
    f.strike = null; f.lockout = null; f.temper = 58; p.unrest = clamp(p.unrest + 2, 0, 100);
    news(w, `${c.name}: the strike at ${f.name} collapsed; the men went back on the old terms.`, { kind: 'politics', countries: [c.id], province: p.id });
    say(w, boss, 'Works manager', `The strike at ${f.name} has broken. The men are back on the old terms, and they have not forgotten.`); return;
  }
  p.unrest = clamp(p.unrest + 2.5, 0, 100);
  if (quarters >= 1) for (const o of others) o.stir = (o.stir || 0) + 8;
}

export function labourStep(w) {
  const firms = Object.values(w.firms || {}).filter(isOpen), acc = {};
  for (const p of Object.values(w.provinces)) p.halt = {};
  for (const f of firms) {
    const c = w.countries[f.country], p = w.provinces[f.province]; if (!c?.alive || !p || p.controller !== c.id) continue;
    f.wage ??= 1; f.safety ??= .3; f.temper ??= 30;
    // A factory law sets a floor under pay and safety at every works. It is kept as far as there are officials and inspectors to make owners keep it.
    if (c.labourLaw) { const kept = clamp(.3 + c.bureaucracy / 200 + inspectors(c) * .4, .2, 1); f.safety = Math.max(f.safety, r2(c.labourLaw.safety * kept)); f.wage = Math.max(f.wage, r2(Math.min(c.labourLaw.wage, 1) * (kept * .5 + .5))); }
    const watchdog = inspectors(c), real = c.wageIndex / Math.max(c.priceLevel, .01), others = firms.filter(o => o !== f && o.province === f.province);
    if (rand(w) < .009 * (DANGER[f.sector] ?? .2) * (1.7 - f.safety * 1.5) * (1 - watchdog * .35)) disaster(w, c, p, f);
    // Where the temper of the men settles: pay against the going rate, what wages buy, how the workers of the province feel in general, a fresh grave, how easily other work is found, and whether anyone listens.
    const want = clamp(30 + (1 - f.wage) * 90 + (1 - real) * 45 + (50 - (p.pops.workers.sat ?? 50)) * .45 + (w.turn - (f.disasterAt ?? -99) < 6 ? 22 : 0) + (c.unemployment < .06 ? 6 : 0) - watchdog * 10 - (f.safety - .3) * 20 + (f.stir || 0), 0, 100);
    f.temper += (want - f.temper) * .3; f.stir = (f.stir || 0) * .5;
    if (f.strike) strikeGoesOn(w, c, p, f, others);
    else if (f.lockout) {
      // Shut out, the men hold as long as they can eat; where work is scarce they come back on the owner's terms.
      const giveIn = clamp(.2 + c.unemployment * 1.6 - (c.unions ? .12 : 0) - relief(c), .08, .8);
      if (rand(w) < giveIn) { f.lockout = null; f.temper = Math.max(f.temper, 60); news(w, `${c.name}: the lockout at ${f.name} ended; the men came back on the owner's terms.`, { kind: 'politics', countries: [c.id], province: p.id }); say(w, bossOf(w, c, f), 'Works manager', `The gates of ${f.name} are open again; the men took your terms.`); }
      else { p.unrest = clamp(p.unrest + 3, 0, 100); for (const o of others) o.stir = (o.stir || 0) + 6; }
    }
    else if (!(f.halted > 0) && f.temper > 62 && rand(w) < (c.unions ? .45 : .12)) walkOut(w, c, p, f);
    if (stopped(f)) p.halt[keyOf(f)] = clamp((p.halt[keyOf(f)] || 0) + f.stake * .85, 0, .95);
    if (f.halted > 0) f.haltedNow = true;
    const a = acc[p.id] ||= { v: 0, n: 0 };
    a.v += ((f.wage - 1) * 16 + (f.safety - .3) * 6 - (f.strike ? 5 : 0) - (f.lockout ? 9 : 0) - (w.turn - (f.disasterAt ?? -99) < 4 ? 6 : 0)) * f.stake; a.n += f.stake;
  }
  // What the works of a province do to the mood of its workers, weighed by how much of the province works in them.
  for (const p of Object.values(w.provinces)) { const a = acc[p.id]; p.labour = a ? clamp(a.v / Math.max(a.n, 1), -14, 12) : 0; }
}
// A stoppage after a disaster lasts the quarter it happened in.
export function labourEnd(w) { for (const f of Object.values(w.firms || {})) if (f.haltedNow) { f.haltedNow = false; f.halted = Math.max(0, (f.halted || 0) - 1); } }

// ---- What people can do about it ----
export function labourOp(w, actor, c, op, { fail, num, governs, tell, allowance }) {
  const f = firmBy(w, actor, op.id ?? op.company), home = f && w.countries[f.country], p = f && w.provinces[f.province];
  if (!f || !isOpen(f) || !home?.alive) return fail('No such company.');
  const mine = f.owner === actor.id || (f.owner === STATE && home.id === c.id && governs);
  switch (op.op) {
    case 'set_wages': case 'set_safety': if (!mine && governs && home.id === c.id) {
      // An order from the government to one works: a floor, kept as far as officials and inspectors can make the owner keep it.
      const kept = clamp(.3 + c.bureaucracy / 200 + inspectors(c) * .4, .2, 1), wages = op.op === 'set_wages', was = wages ? f.wage ?? 1 : f.safety ?? .3, to = wages ? r2(Math.max(was, Math.min(num(op.level, .5, 1.6, was), 1.3) * (kept * .4 + .6))) : r2(Math.max(was, num(op.level, 0, 1, was) * kept));
      if (to <= was + .001) {
        const asked = wages ? Math.min(num(op.level, .5, 1.6, was), 1.3) : num(op.level, 0, 1, was), boss = bossOf(w, home, f);
        if (asked <= was + .001) return { ok: true, msg: `${f.name} already ${wages ? `pays ${was} of the going wage` : `spends ${was} of 1 on safety`}, which is what the order asks or more; it changes nothing there.` };
        // The order asked for more than the state can make an owner do. Both are told: the government why nothing moved, the owner what is
        // asked of him. (World 16: "already spends 0.3 of 1 on safety; the order changes nothing" was read by a prince as his decree defied.)
        if (boss && boss.id !== actor.id) tell(w, boss, home.name, `By order of the government ${f.name} is to ${wages ? `pay at least ${r2(asked)} of the going wage` : `spend at least ${r2(asked)} of 1 on safety`}; it ${wages ? 'pays' : 'spends'} ${was}. The inspectors have not the means to hold you to it: whether it is kept is yours to decide, and the government will see which.`);
        return { ok: true, msg: `The order went to ${f.name}, which belongs to ${boss?.name ?? 'no one in particular'}, and by itself changed nothing: the works ${wages ? 'pays' : 'spends'} ${was}, and the state's officials and inspectors can hold an owner to only about ${Math.round(kept * 100)} in the hundred of what is ordered (here ${r2(wages ? asked * (kept * .4 + .6) : asked * kept)}). The owner has been told what is asked of ${him(boss)} and may raise it ${himself(boss)}. A stronger administration, or an inspectorate with the power to audit, enforces more; a law (set_labour_law) binds every works alike, as far as the same officials reach.` };
      }
      if (wages) f.wage = to; else f.safety = to; home.mods.push({ key: 'sat.capital', delta: -.6, turns: 4, label: `The order to ${f.name}` });
      const boss = bossOf(w, home, f); if (boss && boss.id !== actor.id) tell(w, boss, home.name, `By order of the government ${f.name} is to ${wages ? `pay at least ${r2(num(op.level, .5, 1.6, was))} of the going wage` : `spend at least ${r2(num(op.level, 0, 1, was))} of 1 on safety`}. The inspectors have brought it to ${to}.`);
      return { ok: true, msg: `The order went to ${f.name}, which belongs to ${boss?.name ?? 'no one in particular'}: ${wages ? 'wages' : 'safety spending'} there now stand at ${to} (they were ${was}). An owner keeps such an order as far as officials and inspectors make him.` };
    }
    if (op.op === 'set_wages') {
      if (!mine) return fail('This company is not yours.');
      const was = f.wage ?? 1; f.wage = r2(num(op.level, .5, 1.6, was));
      return { ok: true, msg: `${f.name} now pays ${f.wage} of the going wage (it paid ${r2(was)}). ${f.wage > was ? 'It costs the company part of its profit and the men are easier for it.' : f.wage < was ? 'The company keeps more of what it earns and the men will feel it.' : ''}` };
    } else {
      if (!mine) return fail('This company is not yours.');
      const was = f.safety ?? .3; f.safety = r2(num(op.level, 0, 1, was));
      return { ok: true, msg: `Safety spending at ${f.name} is now ${f.safety} of 1 (it was ${r2(was)}). At 0 nothing is renewed; at 1 the works are as safe as the age knows how to make them, and it eats into profit.` };
    }
    case 'lockout': {
      if (!mine) return fail('This company is not yours.');
      if (op.end) { if (!f.lockout) return fail('The gates are not shut.'); f.lockout = null; return { ok: true, msg: `The gates of ${f.name} are open again.` }; }
      if (f.lockout) return fail('The gates are shut already.');
      f.lockout = { since: w.turn }; news(w, `${home.name}: ${f.name} in ${p.name} has shut its gates on its workers.`, { kind: 'politics', countries: [home.id], province: p.id });
      return { ok: true, msg: `The gates of ${f.name} are shut. Nothing is produced and nothing is paid until the men take your terms or you reopen.` };
    }
    case 'agitate': {
      if (home.id !== c.id) return fail('You have no standing among those workers.');
      const push = allowance(w, actor, `agitate:${f.id}`, 18, 18); if (push <= 0) return fail('You have said what there was to say to the men of this works this quarter.');
      f.stir = (f.stir || 0) + push; if (!home.unions) trace(w, actor, `Stirred up the workers of ${f.name} where unions are banned.`);
      return { ok: true, msg: `Your people have been among the men of ${f.name}, who are ${temperWord(f.temper + push)}.` };
    }
    case 'arbitrate_strike': {
      if (!governs || home.id !== c.id) return fail('Only whoever governs can impose a settlement.');
      if (!f.strike && !f.lockout) return fail('There is no stoppage at that company.');
      const ask = f.strike?.demand ?? f.wage, level = r2(num(op.level, f.wage, 1.6, (f.wage + ask) / 2)); f.wage = level; f.lockout = null;
      const boss = bossOf(w, home, f); if (boss && boss.id !== actor.id) tell(w, boss, home.name, `The government has imposed a settlement at ${f.name}: wages at ${level} of the going rate.`);
      home.mods.push({ key: 'sat.capital', delta: -3, turns: 4, label: `The imposed settlement at ${f.name}` });
      if (f.strike && level >= ask - .05) { f.strike = null; f.temper = 30; return { ok: true, msg: `The settlement gives the men nearly all they asked; they are back at work at ${level}.` }; }
      if (f.strike) { f.strike = null; f.temper = 48; }
      return { ok: true, msg: `Work resumes at ${f.name} at ${level} of the going rate. Neither side got what it wanted.` };
    }
    case 'break_strike': {
      if (!governs || home.id !== c.id) return fail('Only whoever governs can send men against strikers.');
      if (!f.strike) return fail('There is no strike at that company.');
      // Troops confined to barracks by standing order are not sent: then it is the police alone, or nobody.
      const there = Object.values(w.units).filter(u => u.country === c.id && u.province === p.id), troops = there.filter(u => !u.barracks), loyal = troops.length ? sum(troops, u => u.loyalty * u.men) / Math.max(sum(troops, u => u.men), 1e-9) : 100;
      if (c.police < 25 && !troops.length) return fail(`There are neither police enough nor troops in ${p.name} to do it${there.length ? ': the troops there are confined to barracks by standing order (set_posture)' : ''}.`);
      // Soldiers do not always fire on their own people.
      if (c.police < 40 && troops.length && loyal < 45 && rand(w) < .5) { for (const u of troops) u.loyalty = clamp(u.loyalty - 5, 0, 100); f.stir = (f.stir || 0) + 12; news(w, `${c.name}: troops sent against the strikers of ${f.name} refused to move.`, { kind: 'politics', countries: [c.id], province: p.id }); return fail('The troops would not march against the strikers.'); }
      const dead = Math.round((3 + rand(w) * 40) * clamp(f.stake + .3, .3, 1.3) * (1.3 - c.police / 200));
      p.pops.workers.n = Math.max(1, p.pops.workers.n - dead / 1000); f.strike = null; f.lockout = null; f.temper = 50; f.bloodAt = w.turn; c.blood = (c.blood || 0) + dead / 6;
      p.scar = { by: c.id, turn: w.turn, weight: clamp((p.scar?.by === c.id ? p.scar.weight : 0) + .12, 0, 1) };
      c.mods.push({ key: 'sat.workers', delta: -6, turns: 6, label: `The dead of ${f.name}` }); c.legitimacy = clamp(c.legitimacy - (1.5 + c.pressFreedom / 40), 0, 100);
      for (const u of troops) u.loyalty = clamp(u.loyalty - 2, 0, 100);
      news(w, `${c.name}: the strike at ${f.name} in ${p.name} was broken by force; about ${dead} were killed.`, { kind: 'politics', countries: [c.id], province: p.id, hush: true });
      const boss = bossOf(w, home, f); if (boss && boss.id !== actor.id) tell(w, boss, home.name, `The strike at ${f.name} was broken by force; about ${dead} are dead. The men are back at work.`);
      return { ok: true, msg: `The strike at ${f.name} is broken. About ${dead} people were killed doing it; the district will not forget, nor will the workers elsewhere.` };
    }
  }
  return fail('Unknown labour order.');
}
