import { round } from '../engine/util.js';
import { countryProvinces, aliveCountries, atWar, hasTreaty, GOODS, GOOD_LABEL, PLANTS, TECHS, provincePop } from '../engine/world.js';
import { clauseText, leadsParties } from '../engine/polity.js';
import { isOpen, ownerName } from '../engine/firms.js';
import { creditLeft } from '../engine/money.js';
import { upkeepCost } from '../engine/military.js';
import { SUCCESSION_TEXT, successionRule } from '../engine/politics.js';
import { healthText } from '../engine/health.js';

const menIn = (w, p) => Object.values(w.units).filter(u => u.province === p.id && u.country === p.controller).reduce((a, u) => a + u.men, 0);
function budgetText(w, c) {
  const g = Math.max(c.gdp, 1), of = v => `${Math.round(v)} (${pct(v / g)} of GDP)`, bal = c.lastBalance ?? 0, due = (c.lastRevenue ?? 0) - bal;
  return `Treasury ${Math.round(c.treasury)}. Last quarter: revenue ${of(c.lastRevenue ?? 0)}, spending due ${of(due)}, of which interest ${of(c.lastInterest ?? 0)} and standing institutions ${of(c.lastAgencies ?? 0)}; balance ${bal >= 0 ? '+' : ''}${Math.round(bal)}.${c.lastBorrowed > 0 ? ` ${Math.round(c.lastBorrowed)} was borrowed.` : ''}${(c.paidRatio ?? 1) < 1 ? ` Only ${pct(c.paidRatio)} of what was due could be paid; wages are in arrears.` : ''}
Debt ${Math.round(c.debt)} (${pct(c.debt / (g * 4))} of a year's GDP) at ${pct(c.interestRate || 0)} interest per quarter${c.defaulted ? '; the state is in default' : ''}. Lenders would put up about ${Math.round(creditLeft(c))} more this quarter; a deficit and any building, recruiting or shipbuilding the treasury cannot cover are borrowed from them until they refuse. Foreign creditors, in gold: ${Object.entries(c.creditors).filter(([, a]) => a > .5).map(([id, a]) => `${w.countries[id]?.name} ${Math.round(a)}`).join(', ') || 'none'}.
Taxes: income ${pct(c.tax.income)}, land ${pct(c.tax.land)}, business ${pct(c.tax.business)}, tariff ${pct(c.tariff)}. Budget, share of GDP per quarter: ${Object.entries(c.budget).map(([k, v]) => `${k} ${pct(v)}`).join(', ')}. Keeping the armed forces paid and supplied costs about ${pct(upkeepCost(w, c) / g)} of GDP. The administration budget sustains a bureaucracy of about ${Math.round(Math.min(95, 10 + c.budget.administration * 2400))} (now ${Math.round(c.bureaucracy)}), the police budget a force of about ${Math.round(Math.min(95, 5 + c.budget.police * 3200))} (now ${Math.round(c.police)}).`;
}

export const CATALOG = `Topics you can look up (you may pick several):
Your country: economy, money, budget, stocks, production, resources, provinces, province:P12, army, fleet, blocs, parties, parliament, institutions, people, person:K12, plots, technology
World: history, world, rates, country:U3, borders, market, routes, strategic, sea:D5, treaties, wars, news
Defence and building: projects, fortifications. Peoples: culture. Government: governors. Army: commanders. Private deals: contracts.
Yours alone: dossiers (what you have gathered on others), debts (debts you gave and took), my_companies
Country companies: companies`;

// Each character sees only what they can access: a real figure, an estimate or gossip.
const INSIDE = { leader: ['economy', 'budget', 'stocks', 'production', 'resources', 'army', 'fleet', 'blocs', 'plots', 'technology'], general: ['army', 'fleet', 'stocks', 'resources', 'technology'], oligarch: ['economy', 'production', 'resources', 'stocks'], opposition: [] };
const fuzzy = v => { const n = Math.abs(v); if (n >= 1000) return `about ${Math.round(v / 500) * 500}`; if (n >= 100) return `about ${Math.round(v / 50) * 50}`; return `about ${Math.round(v / 5) * 5}`; };
const pct = v => `${round(v * 100, 1)}%`;
// The papers of an office are open to whoever sits in it today, not to someone who once did.
const inOffice = (w, ch) => w.countries[ch.country]?.[ch.role] === ch.id && ch.status === 'free';
// What reaches a reader. News of their own country comes first. Where the press is gagged, risings, famines and epidemics in the provinces are not printed:
// at home only the ruler, the chief of staff and the opposition's own network hear of them; abroad they are known to neighbours and to states with eyes there.
// A prisoner hears only what the jail lets in; an exile reads the foreign press.
export function newsFor(w, ch, since = -1, limit = 30) {
  const c = w.countries[ch.country], away = ch.status === 'exiled', informed = !away && inOffice(w, ch) && ['leader', 'general', 'opposition'].includes(ch.role);
  const near = new Set(countryProvinces(w, c.id).flatMap(p => p.neighbors.map(n => w.provinces[n].controller)));
  const printed = id => { const o = w.countries[id]; return !o || o.pressFreedom >= 35; };
  const sees = n => {
    if (n.secret || n.turn < since) return false;
    const about = n.countries || [], home = about.includes(c.id);
    if (ch.status === 'imprisoned') return home && !n.hush;
    if (!n.hush) return true;
    if (home && !away) return informed || printed(c.id);
    return about.some(id => printed(id) || near.has(id) || (c.intel[id] ?? 0) >= 40);
  };
  const all = w.newsLog.filter(sees), own = all.filter(n => (n.countries || []).includes(c.id)).slice(-Math.ceil(limit * .6)), rest = all.filter(n => !(n.countries || []).includes(c.id));
  return [...own, ...rest.slice(-(limit - own.length))].sort((a, b) => a.turn - b.turn).slice(ch.status === 'imprisoned' ? -8 : -limit);
}
// What others can know of someone's health: a wound or grave illness shows, and so does whatever the papers printed.
const seenHealth = x => x.condition && (x.condition.announced || x.condition.kind === 'wound' || x.condition.severity >= 3) ? `, ${healthText(x)}` : '';

const provLine = (w, p, ch) => {
  const own = w.countries[ch.country], mine = p.controller === ch.country, intel = own.intel[p.controller] ?? 0;
  const dep = Object.entries(p.deposits).filter(([, d]) => d.known && (mine || intel >= 40)).map(([k, d]) => `${GOOD_LABEL[k]}${d.mine ? ' (being mined)' : ''}`).join(', ');
  const garrison = menIn(w, p);
  return `${p.id} ${p.name} [${w.countries[p.controller]?.name}] ${p.terrain}, elevation ${p.elevation}${p.coast ? `, coast (port ${p.port}, seas ${p.seas.join(',')})` : ''}${p.river > .1 ? ', on a river' : ''}${p.dam ? ', dammed' : ''}, fertility ${round(p.fertility, 2)}, railway ${p.rail}, population ${Math.round(provincePop(p))}k, unrest ${mine ? Math.round(p.unrest) : fuzzy(p.unrest)}${mine || intel >= 40 ? `, garrison ${Math.round(garrison)}k${mine && garrison ? ' (troops stationed here hold down open unrest)' : ''}` : ''}, ${p.eth}/${p.rel}; neighbors ${p.neighbors.join(',')}${dep ? `; known deposits: ${dep}` : ''}`;
};

export function answer(w, ch, raw) {
  const q = String(raw || '').trim(), [topic, arg] = q.split(':').map(s => s?.trim());
  const c = w.countries[ch.country], provs = countryProvinces(w, c.id), office = inOffice(w, ch);
  const regent = c.heir === ch.id && ch.status === 'free' && w.characters[c.leader]?.condition?.severity >= 3;
  const can = (_, t) => (office && (INSIDE[ch.role] || []).includes(t)) || (regent && INSIDE.leader.includes(t)), show = (_, t, v) => can(_, t) ? Math.round(v) : fuzzy(v);
  const T = {
    borders: () => {
      const intel = id => c.intel[id] ?? 15, seenMen = q => { const m = Object.values(w.units).filter(u => u.province === q.id && u.country === q.controller).reduce((a, u) => a + u.men, 0); return m <= 0 ? 'no troops seen' : `${intel(q.controller) >= 60 ? Math.round(m) : fuzzy(m)}k troops`; };
      const lines = [];
      for (const o of aliveCountries(w)) {
        if (o.id === c.id) continue;
        const theirs = countryProvinces(w, o.id).filter(q => q.neighbors.some(n => w.provinces[n].controller === c.id));
        if (theirs.length) lines.push(`${o.name} (${o.id})${atWar(w, c.id, o.id) ? ', AT WAR' : ''}:\n${theirs.map(q => `  ${q.id} ${q.name}, ${q.terrain}${q.fort ? `, fort ${Math.round(q.fort * 10) / 10}` : ''}${q.trench ? `, trenches ${q.trench}` : ''}, ${seenMen(q)}; touches your ${q.neighbors.filter(n => w.provinces[n].controller === c.id).join(', ')}`).join('\n')}`);
      }
      return lines.join('\n') || 'You share no land border with anyone.';
    },
    money: () => `Currency: ${c.currency.name}, ${c.fxRegime === 'gold' ? 'pegged to gold' : c.fxRegime === 'pegged' ? `pegged to ${w.countries[c.pegTo]?.currency.name}` : 'floating'}. One gold = ${round(c.rate, 3)} local units. Capital ${c.capitalClosed ? 'restricted' : 'free'}. ${can(ch, 'economy') ? `Gold reserves ${Math.round(c.reserves)}, real exchange rate ${round(c.rer ?? 1, 2)} (above 1 your currency is dear and imports are cheap).` : ''} External debt: ${can(ch, 'budget') ? `${Object.entries(c.creditors).map(([id, a]) => `${w.countries[id]?.name} ${Math.round(a)}`).join(', ') || 'none'}, interest ${round((c.foreignRate ?? 0) * 100, 1)}%` : 'details are not open to you'}.`,
    companies: () => Object.values(w.firms || {}).filter(f => isOpen(f) && f.country === c.id).map(f => `${f.id} ${f.name} (${w.provinces[f.province].name}), owner ${ownerName(w, f)}, last profit ${f.owner === ch.id || ch.role === 'leader' ? round(f.lastProfit, 1) : fuzzy(f.lastProfit)}`).join('\n') || 'No registered companies.',
    my_companies: () => Object.values(w.firms || {}).filter(f => isOpen(f) && f.owner === ch.id).map(f => `${f.id} ${f.name}, ${w.countries[f.country]?.name}, cash ${Math.round(f.cash)}, last profit ${round(f.lastProfit, 1)}${f.offer ? `, offer ${Math.round(f.offer.price)}` : ''}`).join('\n') || 'You own no companies.',
    projects: () => (w.projects || []).filter(x => x.country === c.id && !x.status).map(x => `${x.label ?? x.kind} at ${w.provinces[x.province]?.name}: ${x.turnsLeft} quarters left`).join('\n') || 'Nothing under construction.',
    fortifications: () => provs.filter(p => p.fort || p.battery || p.trench || p.siege).map(p => `${p.id} ${p.name}: fort ${Math.round((p.fort || 0) * 10) / 10}, battery ${p.battery || 0}, trenches ${p.trench || 0}${p.siege ? `, BESIEGED by ${w.countries[p.siege.by]?.name}` : ''}`).join('\n') || 'No fortifications.',
    culture: () => `Language policy ${c.languagePolicy ?? 'tolerate'}, faith policy ${c.faithPolicy ?? 'tolerate'}.\n${provs.map(p => `${p.name}: ${(p.groups ?? [{ eth: p.eth, rel: p.rel, share: 1 }]).map(g => `${Math.round(g.share * 100)}% ${g.eth}/${g.rel}`).join(', ')}`).join('\n')}`,
    governors: () => provs.map(p => `${p.id} ${p.name}: reach ${Math.round((p.admin ?? .5) * 100)}%, governor ${w.characters[p.governor]?.name ?? 'none'}`).join('\n'),
    commanders: () => Object.values(w.characters).filter(x => x.country === c.id && x.alive && x.record).map(x => `${x.id} ${x.name}: ${x.record.won} battles won, ${x.record.lost} lost`).join('\n') || 'No one in your country has commanded in battle yet.',
    contracts: () => (w.contracts || []).filter(k => [k.a, k.b].includes(ch.id) && ['proposed', 'active'].includes(k.status)).map(k => `${k.id} ${k.status}: ${k.terms}${k.pay ? `, pay ${Math.round(k.pay)}` : ''}${k.good ? `, ${Math.round(k.amount)} ${k.good}` : ''}${k.until ? `, until turn ${k.until}` : ''}`).join('\n') || 'You have no contracts.',
    rates: () => aliveCountries(w).map(o => `${o.name}: ${o.currency.name}, one gold = ${round(o.rate, 3)}, ${o.fxRegime}`).join('\n'),
    economy: () => `GDP ${show(ch, 'economy', c.realGdp)}, growth ${pct(c.growth || 0)}, inflation ${pct(c.inflation)}, unemployment ${pct(c.unemployment)}, gold reserves ${show(ch, 'economy', c.reserves)}, currency value ${c.fx ?? 100}, bank health ${show(ch, 'economy', c.bankHealth)}, strike ${c.strike ? 'yes' : 'no'}, natural resource rent share ${pct(c.rentShare || 0)}, food coverage ${pct(c.foodRatio)}, industrial input coverage ${pct(c.inputRatio ?? 1)}`,
    budget: () => can(ch, 'budget') ? budgetText(w, c) : `The details of the government budget are not open to you. Rumor puts the treasury at ${fuzzy(c.treasury)} and the debt at ${fuzzy(c.debt / Math.max(c.gdp * 4, 1) * 100)}% of a year's GDP${c.defaulted ? '; the state is known to be in default' : ''}${(c.lastBalance ?? 0) < -c.gdp * .02 ? '; it is said to be running a deficit' : ''}.`,
    stocks: () => GOODS.map(g => `${GOOD_LABEL[g]} ${show(ch, 'stocks', c.stock[g] || 0)}`).join(', '),
    production: () => can(ch, 'production') ? Object.keys(PLANTS).map(k => `${PLANTS[k]}: capacity ${Math.round(c._cap?.[k] || 0)}, output ${Math.round(c._made?.[k] || 0)}`).join('; ') + `. Arms production priority ${c.armShare}.` : 'You do not see factory data.',
    resources: () => provs.flatMap(p => Object.entries(p.deposits).filter(([, d]) => d.known).map(([k, d]) => `${p.id} ${p.name}: ${GOOD_LABEL[k]} (reserve ${show(ch, 'resources', d.amount)}, richness ${round(d.rich, 2)}, mine level ${round(d.mine, 2)}${p.concessions?.[k] ? `, concession: ${p.concessions[k].holder}` : ''})`)).join('\n') || 'No known deposits.',
    provinces: () => provs.map(p => `${p.id} ${p.name} ${p.terrain}${p.coast ? ' coast' : ''}`).join('; '),
    province: () => { const p = w.provinces[arg]; return p ? provLine(w, p, ch) : `Province not found: ${arg}`; },
    army: () => can(ch, 'army') ? `${Object.values(w.units).filter(u => u.country === c.id).map(u => `${u.id} ${u.kind} at ${u.province} ${w.provinces[u.province]?.name}${u.target ? `, marching to ${u.target}` : ''}: ${Math.round(u.men)}k, morale ${Math.round(u.morale)}, loyalty ${Math.round(u.loyalty)}, equipment ${round(u.equip)}${w.characters[u.commander]?.alive ? `, commander ${w.characters[u.commander].name}` : ''}`).join('\n') || 'No units.'}\nThe military budget covers ${pct(c.militaryFunding ?? 1)} of what the forces cost; below about 85% morale and loyalty wear away.` : `General estimate of army strength: ${fuzzy(Object.values(w.units).filter(u => u.country === c.id).reduce((a, u) => a + u.men, 0))}k soldiers.`,
    fleet: () => can(ch, 'fleet') ? Object.values(w.fleets).filter(f => f.country === c.id).map(f => `${f.id} ${Math.round(f.ships)} ships, sea ${f.sea}, morale ${Math.round(f.morale)}`).join('\n') || 'No fleet.' : 'Fleet details are secret.',
    blocs: () => Object.entries(c.blocs).map(([k, v]) => `${k}: satisfaction ${show(ch, 'blocs', v.sat)}, power ${Math.round(v.power)}`).join('; ') + `. Legitimacy ${Math.round(c.legitimacy)}, popular support ${Math.round(c.popularity ?? 50)}, unrest ${Math.round(c.unrest ?? 0)}.`,
    parties: () => c.parties.map(p => `${p.id} ${p.name}: support ${Math.round(p.support)}%${p.banned ? ' (banned)' : ''}${p.id === c.rulingParty ? ' (ruling)' : ''}`).join('; '),
    institutions: () => `Regime: ${c.regime}. Ideology: ${c.ideology}. Elections: ${c.elections ? `turn ${c.nextElection}` : 'none'}. If the ruler dies or falls: ${SUCCESSION_TEXT[successionRule(c)]}${w.characters[c.heir]?.alive && (office || !c._heirSecret) ? `; the named successor is ${w.characters[c.heir].name}` : ''}. Press freedom ${Math.round(c.pressFreedom)}, court independence ${Math.round(c.courts)}, unions ${c.unions ? 'free' : 'banned'}, police ${Math.round(c.police)}, intelligence ${Math.round(c.intelligence)}, corruption ${Math.round(c.corruption)}, literacy ${Math.round(c.literacy)}%.\nInstitutions:\n${c.institutions.map(i => `${i.id ?? '-'} ${i.name}: ${i.description}${i.id ? ` [head ${w.characters[i.head]?.name ?? 'none'}, members ${i.members.length}, ${i.sponsor ? `private, founder ${w.characters[i.sponsor]?.name}` : `budget ${round(i.budget * 100, 2)}% of GDP`}, strength ${round(i.strength, 2)}${i.powers.length ? `, fields ${i.powers.join(',')}` : ''}${i.authority.length ? `, authority ${i.authority.join(',')}` : ''}${i.veto.length ? `, veto ${i.veto.join(',')}` : ''}]` : ''}`).join('\n') || 'none'}`,
    parliament: () => { const p = c.parliament; if (!p) return `No parliament. Laws: ${(c.laws || []).slice(-8).map(l => l.title).join('; ') || 'none'}.`; return `${p.name}, ${p.legislative ? 'legislative' : 'advisory'}${w.turn < (p.suspendedUntil ?? 0) ? `, suspended until the end of turn ${p.suspendedUntil}` : ''}. Seats: ${c.parties.filter(x => p.seats[x.id]).map(x => `${x.id} ${x.name} ${p.seats[x.id]}${x.id === c.rulingParty ? ' (ruling)' : ''}`).join(', ')}.\nPending bills: ${(c.bills || []).filter(b => b.status === 'pending').map(b => `${b.id} ${b.title} (${b.proposerName}): ${b.text}`).join('\n') || 'none'}\nRecent decisions: ${(c.bills || []).filter(b => b.status !== 'pending').map(b => `${b.title} ${b.status}`).join('; ') || 'none'}\nLatest laws in force: ${(c.laws || []).slice(-8).map(l => `${l.title}: ${l.text}`).join('; ') || 'none'}`; },
    people: () => Object.values(w.characters).filter(x => x.country === c.id && x.alive && x.id !== ch.id).map(x => `${x.id} ${x.name}, ${c[x.role] === x.id ? x.role : `no office (once ${x.role.replace('_', ' ')})`}, age ${x.age}, ${x.status}${seenHealth(x)}`).join('; '),
    person: () => { const x = w.characters[arg]; if (!x) return `Person not found: ${arg}`; const home = w.countries[x.country], kin = x.name.split(' ').at(-1) === ch.name.split(' ').at(-1) ? ' May be from the same family as you.' : ''; return `${x.name}, ${home?.[x.role] === x.id ? x.role : `no office (once ${x.role.replace('_', ' ')})`}, ${home?.name}, age ${x.age}, ${x.alive ? `status ${x.status}${seenHealth(x)}` : `dead${x.death ? `: ${x.death.how}` : ''}`}. What is said of them: ${x.publicFace || 'nothing in particular'}.${ch.dossiers[x.id] ? ` You hold a dossier on them; wealth ${Math.round(x.wealth)}. In the dossier: ${ch.dossiers[x.id].facts?.join(' ') || 'nothing incriminating'}` : ''}${kin}`; },
    plots: () => w.plots.filter(p => p.active && ([p.leader, ...p.members].includes(ch.id) || (p.country === c.id && c.leader === ch.id && p.exposed))).map(p => `${p.id} ${p.kind}${p.target && w.characters[p.target] ? ` against ${w.characters[p.target].name}` : ''}, progress ${Math.round(p.progress)}, ${p.exposed ? 'leaked' : 'secret'}, members ${p.members.length + 1}`).join('; ') || 'You know of no plots.',
    technology: () => `Owned: ${Object.keys(c.techs).map(t => TECHS[t].name).join(', ') || 'none'}. Researching: ${c.research.target ? TECHS[c.research.target].name : 'none'} (${Math.round(c.research.progress)}). Available: ${Object.entries(TECHS).filter(([k, t]) => !c.techs[k] && t.req.every(r => c.techs[r])).map(([k, t]) => `${k} (${t.name})`).join(', ') || 'none'}.`,
    world: () => aliveCountries(w).filter(o => o.id !== c.id).map(o => `${o.id} ${o.name}, ${o.regime}, ${o.ideology}, leader ${w.characters[o.leader]?.name}${atWar(w, c.id, o.id) ? ', AT WAR' : ''}${w.treaties.filter(t => t.active && t.parties.includes(c.id) && t.parties.includes(o.id)).map(t => `, treaty in force: ${t.kind}`).join('')}${c.embargo.includes(o.id) ? ', you embargo them' : ''}${o.embargo.includes(c.id) ? ', they embargo you' : ''}`).join('\n'),
    country: () => { const o = w.countries[arg]; if (!o?.alive) return `Country not found: ${arg}`; const i = c.intel[o.id] ?? 15, n = v => i >= 60 ? Math.round(v) : fuzzy(v); return `${o.name}: ${o.regime}, ${o.ideology}. GDP ${n(o.realGdp)}, soldiers ${n(Object.values(w.units).filter(u => u.country === o.id).reduce((a, u) => a + u.men, 0))}k, ships ${n(Object.values(w.fleets).filter(f => f.country === o.id).reduce((a, f) => a + f.ships, 0))}, provinces ${countryProvinces(w, o.id).length}. Strategic points it controls: ${w.strategic.filter(s => s.controller === o.id).map(s => s.name).join(', ') || 'none'}. Known technologies: ${i >= 40 ? Object.keys(o.techs).join(', ') || 'none' : 'unknown'}. Its provinces: ${countryProvinces(w, o.id).map(p => p.id).join(',')}.`; },
    history: () => [...(c.chronicle || []).map(e => `- ${e.year}: ${e.text}`), ...(w.past || []).map(e => `- ${e.text}`), ...aliveCountries(w).flatMap(o => (o.atrocities || []).filter(a => a.known).map(a => `- ${1900 + Math.floor(a.turn / 4)}: ${a.text}`))].join('\n') || 'No recorded past.',
    market: () => GOODS.map(g => `${GOOD_LABEL[g]} ${round(w.globalPrice[g], 1)}`).join(', '),
    routes: () => aliveCountries(w).filter(o => o.id !== c.id).map(o => { const k = c.id < o.id ? `${c.id}|${o.id}` : `${o.id}|${c.id}`, r = w.routes[k]; return `${o.name}: ${r ? `${r.mode} route, cost multiplier ${round(r.cost, 2)}${r.tolls.length ? `, tolled` : ''}` : 'no route'}`; }).join('\n'),
    strategic: () => w.strategic.map(s => `${s.id} ${s.name} (${s.type}) location ${s.ref}, controlled by ${w.countries[s.controller]?.name ?? 'no one'}${s.closed ? ', CLOSED' : ''}${s.toll ? `, toll ${Math.round(s.toll * 100)}%` : ''}`).join('\n'),
    sea: () => { const s = w.seas[arg]; if (!s) return `Sea not found: ${arg}`; return `${s.id} ${s.name || 'Unnamed sea'}, adjacent seas ${s.neighbors.join(',')}, coastal provinces ${s.coast.join(',')}, fleets here ${Object.values(w.fleets).filter(f => f.sea === s.id).map(f => `${w.countries[f.country].name} (${fuzzy(f.ships)})`).join(', ') || 'none'}.`; },
    treaties: () => `${w.treaties.filter(t => t.active && t.parties.includes(c.id)).map(t => `${t.id} ${t.kind}: ${t.parties.join('-')}${t.expires != null ? `, ends turn ${t.expires}` : ''}${t.clauses?.length ? `. Clauses: ${t.clauses.map(x => clauseText(w, x)).join('; ')}` : ''}${t.breaches?.length ? `. Breaches: ${t.breaches.slice(-3).map(b => b.text).join(' ')}` : ''}`).join('\n') || 'No treaties in force.'}\nPending proposals: ${w.treaties.filter(t => t.pending && t.parties.includes(c.id)).map(t => `${t.id} ${t.kind} ${t.proposer} ${t.terms}${t.clauses?.length ? ` [${t.clauses.map(x => clauseText(w, x)).join('; ')}]` : ''}`).join('\n') || 'none'}`,
    wars: () => w.wars.filter(x => x.active).map(x => `${x.id} ${x.name}, started turn ${x.start}, sides a:${x.a.join(',')} b:${x.b.join(',')}`).join('\n') || 'No wars.',
    news: () => newsFor(w, ch, w.turn - 8, 24).map(n => `- ${n.text}`).join('\n') || 'No news.',
    dossiers: () => Object.entries(ch.dossiers).map(([id, d]) => `${id} ${d.about}: ${d.facts?.join(' ') || 'nothing incriminating found'}`).join('\n') || 'You hold no dossiers.',
    debts: () => (w.debts || []).filter(d => ['open', 'overdue'].includes(d.status) && [d.creditor, d.debtor].includes(ch.id)).map(d => d.debtor === ch.id ? `${d.id}: you owe ${w.characters[d.creditor]?.name} ${Math.round(d.owed)}, due turn ${d.due}${d.status === 'overdue' ? ' (OVERDUE)' : ''}. ${d.terms}` : `${d.id}: ${w.characters[d.debtor]?.name} owes you ${Math.round(d.owed)}, due turn ${d.due}${d.status === 'overdue' ? ' (OVERDUE)' : ''}. ${d.terms}`).join('\n') || 'You have no open debts or claims.'
  };
  return T[topic] ? T[topic]() : `No information on "${q}". ${CATALOG}`;
}

export const alarms = (w, ch) => {
  const c = w.countries[ch.country], out = [], role = inOffice(w, ch) ? ch.role : 'none';
  if (c.foodRatio < .95) out.push('There is a food shortage in the country.');
  const sick = w.characters[c.leader];
  if (sick?.alive && sick.id !== ch.id && sick.condition?.severity >= 3) out.push(`${sick.name} is ${sick.condition.kind === 'wound' ? 'gravely wounded' : 'gravely ill'} and is not governing.`);
  if (c.arrears > .5 && ['leader', 'general'].includes(role)) out.push('Wages are in arrears.');
  if (role === 'leader' && (c.lastBalance ?? 0) < -c.gdp * .015) out.push(`The budget ran a deficit of ${Math.round(-c.lastBalance)} last quarter${c.lastBorrowed > 0 ? ', covered by borrowing' : ''}.`);
  if (role === 'leader' && (c.lastBalance ?? 0) < 0 && creditLeft(c) < -c.lastBalance * 4) out.push('Lenders are close to refusing the state any more credit.');
  if (c.defaulted && ['leader', 'oligarch'].includes(role)) out.push('The state is in default and lenders keep away.');
  if ((c.militaryFunding ?? 1) < .8 && ['leader', 'general'].includes(role)) out.push('The army is not being paid and supplied in full.');
  if (c.bankCrisis) out.push('There is a banking crisis.');
  if (c.strike) out.push('A general strike is under way.');
  if (w.wars.some(x => x.active && (x.a.includes(c.id) || x.b.includes(c.id)))) out.push('The country is at war.');
  if (role === 'leader' && w.treaties.some(t => t.pending && t.parties.includes(c.id) && t.proposer !== c.id)) out.push('A treaty proposal awaits your reply.');
  if ((c.bills || []).some(b => b.status === 'pending') && leadsParties(w, c, ch).length) out.push('A bill is up for a vote in parliament; you can set your party\'s vote.');
  if (w.treaties.some(t => t.active && t.parties.includes(c.id) && t.breaches?.at(-1)?.turn >= w.turn - 1) && role === 'leader') out.push('A treaty has just been breached.');
  if ((w.debts || []).some(d => d.status === 'overdue' && d.debtor === ch.id)) out.push('You have an overdue debt.');
  if ((w.debts || []).some(d => d.status === 'overdue' && d.creditor === ch.id)) out.push('You are owed an overdue debt.');
  if (w.epidemics.some(e => e.active && Object.keys(e.provinces).some(id => w.provinces[id].controller === c.id))) out.push('There is an epidemic in the country.');
  return out;
};
