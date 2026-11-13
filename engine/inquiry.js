// Inquiries and inspections: looking into a matter, not into a person.
//
// World 16: "open an inquiry into the cost of the depot", "audit the tax farmers' accounts", "inspect every coal mine and publish the results",
// "find out how he died" were ordered about fifty times in twenty quarters. The engine could look into one person at a time (gather_dossier)
// and nothing else, so every one of them was words. An inquiry finds what is there to be found: the traces the engine itself keeps of what was
// done (who skimmed, who was paid, what a lease drains, what a works spends on its men), by the same rule as a dossier, across everybody who
// has a hand in the matter. What it finds lies in the inquirer's files on those people, where a prosecution can use it.
import { clamp, rand, news, nextId, quarterLabel } from './util.js';
import { governs } from './polity.js';
import { keptQuiet } from './press.js';
import { isOpen, STATE, firmValue, lawFor, partsOf, inHundred } from './firms.js';

export const INQUIRY_OPS = new Set(['inquire', 'inspect']);
const say = (w, ch, from, text) => { if (ch?.alive) ch.inbox.push({ turn: w.turn, from, text }); };
const r2 = v => Math.round(v * 100) / 100, n = v => Math.round(v);
const auditors = c => clamp((c.institutions || []).filter(i => i.id && (i.powers || []).some(p => ['audit', 'judiciary'].includes(p))).reduce((a, i) => a + (i.strength ?? 0), 0), 0, 1);
const labourInspectors = c => clamp((c.institutions || []).filter(i => i.id && (i.powers || []).includes('industry')).reduce((a, i) => a + (i.strength ?? 0), 0), 0, 1.2);
const OFFICES = { treasury: /treasur|embezz|skim|customs|lease|tax|contract|offer|purse|fund|paid|money/i, army: /army|arsenal|suppl|officer|regiment|contract|pay|rifle|boot|plan|staff/i, police: /police|arrest|file|dossier|bribe|warn/i, customs: /customs|lease|smuggl|duty|tariff/i, courts: /court|judge|bench|trial|tried|verdict|acquit|convict|forge|prosecut|sentence/i };
// The bench as an inquiry finds it: how far it is its own master, and what it has tried of late and how each case went. Nobody's books show
// money reaching a judge: a bench is moved by what is laid before it and by what the government can make it fear, and neither leaves a receipt.
const benchWords = (w, c) => { const k = c.courts ?? 40, tr = (c.trials || []).slice(-6);
  return `The bench stands at ${n(k)} of 100 as its own master: ${k >= 65 ? 'it wants proof, and acquits without it' : k >= 35 ? 'it is open to pressure, and for the rest weighs what is laid before it' : 'it is the government\'s creature and convicts nearly whoever is brought, though not every time'}. ${tr.length ? `Tried of late: ${tr.map(t => `${t.name}, ${t.verdict === 'forged' ? 'acquitted when papers laid against the accused were found to be forged' : t.verdict === 'acquitted' ? 'acquitted' : t.verdict === 'executed' ? 'found guilty and put to death' : `found guilty${t.years ? ` (${t.years} years)` : ''}`} in ${quarterLabel(t.turn)} on ${t.papers ? `${t.papers} paper${t.papers > 1 ? 's' : ''}` : 'no papers, only the charge'}, the case brought by ${w.characters[t.by]?.name ?? 'the government'}`).join('; ')}.` : 'It has tried nobody of note of late.'} Nothing in any book shows money reaching a judge: a verdict here is the bench's own reading of what was laid before it, each paper weighing for something and none of them for everything.`; };

// What the matter is, who has a hand in it, what about it is plain fact, and which traces belong to it.
function matterOf(w, c, into) {
  const said = String(into ?? '').trim(), key = /^(the\s+)?(courts?|bench|judges|judiciary)$/i.test(said) ? 'courts' : said, own = (o, k) => !!o && Object.hasOwn(o, k), people = ids => [...new Set(ids)].map(id => w.characters[id]).filter(x => x?.alive);
  const posts = post => Object.values(w.characters).filter(x => x.alive && x.country === c.id && (x.post === post || x.clerkOf === post)).map(x => x.id);
  if (own(w.firms, key) && w.firms[key].country === c.id) { const f = w.firms[key], law = lawFor(c, f), owner = w.characters[f.owner];
    // The register shows whose name each part stands in; who stands behind a nominee is found, if at all, in what those people have done.
    const parts = partsOf(f), reg = parts.length ? ` The register shows ${parts.map(x => `${inHundred(x.share)} in the name of ${x.to === STATE ? 'the state' : w.characters[x.nominee ?? x.to]?.name ?? 'a holder'}`).join(', ')}.` : '';
    return { kind: 'works', key, name: f.name, persons: people([f.owner, ...parts.flatMap(x => [x.to, x.nominee]).filter(x => x && x !== STATE)]), re: new RegExp(`${f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|safety|wage|strike|disaster|works|mine`, 'i'),
      plain: [`${f.name} belongs to ${f.owner === STATE ? 'the state' : owner?.name ?? 'no one in particular'}; it pays ${r2(f.wage ?? 1)} of the going wage and spends ${r2(f.safety ?? .3)} of 1 on safety${law ? ` (the law requires ${law.wage ? `${r2(law.wage)} and ` : ''}${r2(law.safety)}${(f.safety ?? .3) < law.safety - .001 ? ': it is under the legal floor' : ''})` : ' (no law sets a floor)'}; last quarter it made ${r2(f.lastProfit ?? 0)} after tax and paid ${r2(f.lastTax ?? 0)} in tax; a buyer would give about ${n(firmValue(w, f))} for it${f.disasterAt != null ? `; its last disaster was in ${quarterLabel(f.disasterAt)}${f.lastDisaster ? ` (${f.lastDisaster.what.toLowerCase()}, about ${f.lastDisaster.dead} dead), when it spent ${r2(f.lastDisaster.safety ?? .3)} of 1 on safety` : ''}` : ''}.${reg}`] }; }
  const inst = (c.institutions || []).find(i => i.id === key || String(i.name).toLowerCase() === key.toLowerCase());
  if (inst) return { kind: 'body', key: inst.id, name: inst.name, persons: people([inst.head, ...(inst.members || []), inst.founder]), re: new RegExp(`${String(inst.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|fund|skim|drew|budget`, 'i'),
    plain: [`${inst.name} draws ${r2((inst.budget ?? 0) * 100)} in the hundred of the country's output${inst.amount ? ` and ${n(inst.amount)} a quarter from its founder` : ''}; it is funded to ${n((inst.funding ?? 1) * 100)} in the hundred and stands at ${n((inst.strength ?? 0) * 100)} of 100${inst._quarter?.used?.skim ? `; ${r2(inst._quarter.used.skim)} was drawn out of it by its head this quarter` : ''}.`] };
  const k = (w.contracts || []).find(x => x.id === key && [x.a, x.b].some(id => w.characters[id]?.country === c.id));
  if (k) return { kind: 'contract', key, name: `contract ${k.id}`, persons: people([k.a, k.b]), re: new RegExp(`${k.id}|contract|commission|bribe|offer`, 'i'),
    plain: [`${k.id}, between ${w.characters[k.a]?.name ?? k.a} and ${w.characters[k.b]?.name ?? k.b}, is ${k.status}${k.pay ? `; ${n(k.pay)} a quarter is paid under it${k.purse ? ' out of the treasury' : ''}` : ''}${k.good ? `; ${n(k.amount)} of ${k.good} a quarter is to be delivered${k.delivered != null ? `, and ${n(k.delivered)} was delivered last quarter` : ''}` : ''}. Its terms: ${String(k.terms).slice(0, 300)}`] };
  const o = (w.offers || []).find(x => x.id === key && x.country === c.id);
  if (o) return { kind: 'offer', key, name: `the arrangement ${o.id}`, persons: people([o.from, o.to]), re: /offer|lease|suppl|purse|paid|took/i, plain: [o.status === 'running' ? `${o.id} is in force: ${o.text}.` : `${o.id} is ${o.status}.`] };
  if (own(OFFICES, key)) { const run = (w.offers || []).filter(x => key !== 'courts' && x.status === 'running' && x.country === c.id && (key === 'army' ? x.kind === 'supply' : x.kind === 'lease')), b = c.lastBooks;
    const who = key === 'courts' ? [c.leader, ...posts('police'), ...(c.trials || []).map(t => t.by)] : key === 'army' ? [c.general, ...Object.values(w.units).filter(u => u.country === c.id).map(u => u.commander), ...posts('army')] : key === 'police' ? posts('police') : [...posts('treasury'), ...(key === 'customs' ? [] : [c.leader])];
    const plain = key === 'courts' ? [benchWords(w, c)] : key === 'army' ? [`The forces are paid and supplied to ${n((c.militaryFunding ?? 1) * 100)} in the hundred of what they cost${run.length ? `; the army's stores are bought under ${run.map(x => `${x.id} (from the suppliers of ${w.characters[x.from]?.name}'s house, at about ${n(x.drain)} a quarter over the price)`).join(', ')}` : ''}.`]
      : key === 'police' ? [`The police stand at ${n(c.police ?? 0)} of 100.`]
      : [`${b ? `Of what was assessed last quarter about ${n((b.collect ?? 1) * 100)} in the hundred was collected, and about ${n((b.graft ?? 0) * 100)} in the hundred of what was collected stuck to the hands it passed through. ` : ''}${run.length ? `The customs are leased under ${run.map(x => `${x.id} to the house of ${w.characters[x.from]?.name}, which keeps about ${n(x.drain)} a quarter`).join(', ')}.` : 'No lease or farm of the revenue is in force.'}`];
    return { kind: 'office', key, name: key === 'courts' ? 'the courts' : key === 'army' ? 'the army\'s stores and pay' : key === 'police' ? 'the police' : key === 'customs' ? 'the customs' : 'the treasury', persons: people(who), re: OFFICES[key], plain, leases: run }; }
  const p = own(w.provinces, key) ? w.provinces[key] : null;
  if (p && p.controller === c.id) return { kind: 'province', key, name: `the administration of ${p.name}`, persons: people([p.governor]), re: new RegExp(`${p.name}|governor|tax|levy|bribe`, 'i'), plain: [`${p.name}: unrest ${n(p.unrest)} of 100${p.governor && w.characters[p.governor]?.alive ? `; ${w.characters[p.governor].name} governs it` : '; it has no governor of its own'}.`] };
  const deadKey = key.replace(/^death:/, ''), dead = own(w.characters, deadKey) ? w.characters[deadKey] : null;
  if (dead && !dead.alive && dead.death && dead.country === c.id) { const plot = (w.plots || []).find(x => x.kind === 'assassination' && x.target === dead.id);
    return { kind: 'death', key: dead.id, name: `the death of ${dead.name}`, persons: people(plot ? [plot.leader, ...(plot.members || [])] : []), re: /kill|shot|assassin|murder|poison/i, plot, plain: [`${dead.name} ${dead.death.how ?? 'died'} in ${quarterLabel(dead.death.turn)}.`] }; }
  return null;
}
export const INTO = 'a works (its id, SR...), a body of the state or a foundation (its id or name), a contract (CT...) or an arrangement with a banking house (OF...), an office (treasury, customs, army, police, courts), a province of ours (P...), or a death (death:K...)';

export function inquiryOp(w, actor, c, op, h) {
  const { fail, num } = h, state = governs(w, c, actor);
  if (op.op === 'inspect') {
    if (!state) return fail('The inspectors of works answer to whoever governs. An owner knows his own works (my_companies); anybody else can have a works looked into (inquire).');
    const one = op.id && w.firms && Object.hasOwn(w.firms, op.id) ? w.firms[op.id] : null, all = Object.values(w.firms || {}).filter(f => f.country === c.id && isOpen(f) && (one ? f.id === one.id : op.sector === 'mines' ? f.sector === 'mine' : op.sector === 'works' ? f.sector !== 'mine' : true));
    if (op.id && !one) return fail('No such works.'); if (!all.length) return fail('There is no works of that kind in the country.');
    const sweep = !one && h.allowance(`inspection`, 1, 1) <= 0, anyLaw = !!c.labourLaw, kept = clamp(.3 + c.bureaucracy / 200 + labourInspectors(c) * .4, .2, 1), visit = clamp(kept + .25, .2, 1), lines = [], under = [];
    for (const f of all) { const law = lawFor(c, f), boss = w.characters[f.owner], was = f.safety ?? .3, short = law && f.owner !== STATE && was < law.safety - .001;
      // An inspector standing in the works enforces more than the law does from the capital, once in a quarter.
      if (short && !sweep) { const to = Math.max(was, r2(law.safety * visit)); if (to > was + .001) f.safety = to; under.push(f); if (boss) { (boss.secrets ||= []).push({ turn: w.turn, text: `Was found by the inspectors keeping safety at ${f.name} at ${was}, under the ${law.safety} the law requires.` }); boss.secrets = boss.secrets.slice(-12); const file = actor.dossiers[boss.id] ||= { turn: w.turn, about: boss.name, facts: [] }; file.turn = w.turn; file.facts = [...new Set([...file.facts, boss.secrets.at(-1).text])].slice(-12); say(w, boss, c.name, `The inspectors were at ${f.name}: safety spending stood at ${was}, under the ${law.safety} the law requires${to > was + .001 ? `; they have brought it to ${to}` : ', and they had not the means to move it'}. It is on the government's file.`); } }
      lines.push(`${f.id} ${f.name} (${f.owner === STATE ? 'the state' : boss?.name ?? 'no owner'}): safety ${was}${f.safety !== was ? ` -> ${f.safety}` : ''}, wage ${r2(f.wage ?? 1)}${short ? ', UNDER the legal floor' : ''}${f.strike ? ', the men are out' : ''}`); }
    if (op.public && under.length) { news(w, `${c.name}: the inspectors of works report ${under.length} works under the legal floor on safety: ${under.map(f => `${f.name} (${w.characters[f.owner]?.name ?? 'no owner'})`).join(', ')}.`, { kind: 'economy', countries: [c.id] }); c.mods.push({ key: 'sat.workers', delta: 1, turns: 3, label: 'The inspectors\' report' }); }
    return { ok: true, msg: `The inspectors report on ${all.length} works. ${lines.join('; ')}.${!anyLaw ? ' No law sets a floor under wages or safety (set_labour_law), so there was nothing to hold an owner to.' : under.length ? ` ${under.length} stood under the legal floor; an inspector on the spot holds an owner to about ${n(visit * 100)} in the hundred of what the law requires, and what was found is on your file on each owner (prosecute, fine).` : ' None stood under the legal floor.'}${sweep ? ' The works had been gone through once this quarter already: this time the inspectors only counted.' : ''}` };
  }
  const m = matterOf(w, c, op.into ?? op.id ?? op.matter); if (!m) return fail(`Say what is to be looked into (into): ${INTO}. One person is looked into with gather_dossier.`);
  const list = (w.inquiries ||= []); if (list.some(x => x.by === actor.id && x.key === m.key)) return fail(`An inquiry of yours into ${m.name} is sitting already; it reports when the quarter is out.`);
  const staff = !state && c.general === actor.id && m.key === 'army', owner = m.kind === 'works' && w.firms[m.key].owner === actor.id, sits = !!c.parliament && c.parliament.legislative !== false, house = !state && !staff && sits && h.leads;
  if (!state && !staff && ['office', 'province'].includes(m.kind) && !house) return fail(`The books of ${m.name} are the state's: only whoever governs can have them opened${sits ? ', or the leader of a party that holds seats in the house, by an inquiry of the house (you lead no such party)' : c.parliament ? `; the ${c.parliament.name ?? 'council'} advises and cannot call for the state's books` : ''}.`);
  const fee = state || staff ? h.pays(Math.max(c.gdp, 1) * .0003) : owner || house ? 0 : Math.min(Math.max(actor.wealth, 0), Math.max(1, num(op.amount, 0, 40, 2))); if (!state && !staff && !owner && !house) { if (actor.wealth < 1) return fail('Men who ask questions are paid, and you have nothing to pay them with.'); actor.wealth -= fee; }
  const eye = state ? clamp(.3 + c.bureaucracy / 250 + (c.courts ?? 40) / 400 + auditors(c) * .25, .25, .9) : staff ? .45 : owner ? .7 : house ? clamp(.25 + (c.courts ?? 40) / 300, .2, .6) : clamp(.12 + actor.power / 400 + fee / 60, .1, .5);
  const open = house || op.public === true;
  list.push({ id: nextId(w, 'Q'), by: actor.id, country: c.id, key: m.key, into: op.into ?? op.id ?? op.matter, name: m.name, due: w.turn, eye, public: open, since: w.turn, kind: state ? 'the government\'s' : staff ? 'the staff\'s' : house ? 'the house\'s' : 'a private' });
  // Those it touches hear of it, unless it is kept from them; and may put their papers in order before it sits.
  if (open) for (const x of m.persons) if (x.id !== actor.id) say(w, x, c.name, `An inquiry into ${m.name} has been opened by ${actor.name}, in public. It reports when the quarter is out.`);
  if (open) news(w, `${c.name}: ${actor.name} has opened an inquiry into ${m.name}.`, { kind: 'politics', countries: [c.id] });
  return { ok: true, msg: `The inquiry into ${m.name} sits${fee > .5 ? ` (${n(fee)} was set aside for it)` : ''} and reports when the quarter is out: what is plain from the books, and whatever those with a hand in the matter have done in it that can still be found. What it finds lies in your files on them, where a court can use it.${open ? ' It sits in public: those it touches know of it, and its report is printed.' : ' It sits behind closed doors: its report is for you alone, and those it touches are not told.'}` };
}

// Inquiries report at the end of the quarter in which they were opened.
export function inquiryStep(w) {
  const list = w.inquiries || []; if (!list.length) return;
  for (const q of [...list]) { if (q.due > w.turn) continue; list.splice(list.indexOf(q), 1);
    const by = w.characters[q.by], c = w.countries[q.country]; if (!by?.alive || !c?.alive) continue; const m = matterOf(w, c, q.key === q.into || !matterOf(w, c, q.into) ? q.key : q.into) ?? matterOf(w, c, `death:${q.key}`); if (!m) { say(w, by, 'The inquiry', `The inquiry into ${q.name} found its matter gone.`); continue; }
    const found = [];
    for (const x of m.persons) { if (x.id === by.id) continue; const hits = (x.secrets || []).filter(s => !s.old && !s.published && !keptQuiet(w, s) && w.turn - s.turn <= 16 && m.re.test(s.text) && rand(w) < q.eye).map(s => s.text);
      if (m.kind === 'death' && m.plot && rand(w) < q.eye * .7) hits.push(`Had a hand in the killing of ${w.characters[m.key]?.name}${m.plot.leader === x.id ? ', and was at the head of it' : ''}.`);
      if (!hits.length) continue; const file = by.dossiers[x.id] ||= { turn: w.turn, about: x.name, facts: [] }; file.turn = w.turn; file.facts = [...new Set([...file.facts, ...hits])].slice(-12); found.push(`${x.name} (${x.id}): ${hits.join(' ')}`);
      if (q.public) for (const s of x.secrets || []) if (hits.includes(s.text)) s.published = true; }
    const report = `${q.kind[0].toUpperCase()}${q.kind.slice(1)} inquiry into ${m.name} reports. ${m.plain.join(' ')} ${found.length ? `It also brought this to light: ${found.join('; ')}. It is in your files on those named.` : 'Beyond that it found nothing against anybody that was not known already: either there was nothing, or it was not to be found.'}`;
    say(w, by, 'The inquiry', report);
    if (q.public) { news(w, `${c.name}: the inquiry into ${m.name} has reported. ${found.length ? `It names ${found.map(f => f.split(' (')[0]).join(', ')}.` : 'It found nothing against anybody.'}`, { kind: 'politics', countries: [c.id] });
      // A government that lets its own house be looked into in public gains by it when nothing is found on its people, and pays when something is.
      const hit = m.persons.filter(x => found.some(f => f.startsWith(x.name)) && (x.id === c.leader || x.post || x.id === c.general)).length; c.legitimacy = clamp(c.legitimacy + (hit ? -1.5 * hit : governs(w, c, by) ? .8 : 0), 0, 100); } }
}
export const inquiryWords = (w, ch) => (w.inquiries || []).filter(q => q.by === ch.id).map(q => `Inquiry into ${q.name}, sitting; it reports when the quarter is out.`);
