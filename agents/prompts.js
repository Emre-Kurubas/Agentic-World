import { round, between } from '../engine/util.js';
import { countryProvinces, aliveCountries, TECHS, GOODS } from '../engine/world.js';
import { CATALOG, alarms } from './queries.js';
import { STATE_POWERS, CIVIL_POWERS, DELEGABLE, GATED } from '../engine/polity.js';

const ROLE_TEXT = {
  leader: 'You are the head of state of the country. Your formal powers are broad, but the army, capital, the people and your rivals can bring you down.',
  general: 'You are the chief of the general staff. You have close ties to the army. Formal decisions are made by the leader.',
  opposition: 'You are the leader of the opposition. You have no formal power; you work through the people, your party network, foreigners and rumors.',
  oligarch: 'You are the most powerful businessperson in the country. You work through mines, industry and money.'
};

const MANIFESTO = 'This is your life. No one decides what kind of person you will be: you may be idealistic, cowardly, loyal, treacherous, merciful, ruthless, lazy or mad. No goal is imposed on you; you do not have to want power, and you may choose to do nothing. You do not have to be balanced or reasonable. There is no list of decisions or menu: you can try anything that comes to mind and invent new institutions, laws, religions, parties, companies or alliances. You can send a secret message to any person or country in the world. Write your decisions in natural language, concretely. An impartial referee and the world decide the outcome; success is not guaranteed.';
const ANSWER_FORMAT = 'When you decide, respond with only this JSON:\n{"identity":"only if you want to change it or are writing it for the first time","inner_voice":"what you really think and feel this turn","decisions":["a concrete decision; leave empty if you do not want to act"],"messages":[{"to":"K12 or U3","text":"secret message"}],"notes":"a line for your diary"}';
const nextStep = final => final ? 'You have no lookups left, decide now.' : 'If you want to look something up first, respond with {"lookup":["economy","province:P12"]} (at most 6 topics). If you know enough, make your decision directly.';
const seenText = answers => `WHAT YOU LOOKED UP:\n${answers.map(a => `[${a.q}]\n${a.a}`).join('\n\n')}`;

// The character's session carries the past; each wake-up writes only that day's report.
export function frontPage(w, ch) {
  const c = w.countries[ch.country];
  const inbox = ch.inbox.map(m => `- [${m.from}] ${m.text}`).join('\n') || '- None';
  const news = w.newsLog.filter(n => !n.secret && n.turn >= ch.lastWake).slice(-30).map(n => `- ${n.text}`).join('\n') || '- No notable news.';
  return `The world is an entirely fictional game simulation. You are playing a character. Date: ${w.date || 'Start'} (1 turn = 3 months).
Your name: ${ch.name} (${ch.id}), ${c.name} (${c.id}). ${ROLE_TEXT[ch.role] || ''}
Age ${ch.age}. Wealth ${Math.round(ch.wealth)}.
Outcomes of your decisions since you last woke:
${(ch.newOutcomes ?? []).map(d => `- ${d}`).join('\n') || '- (none)'}

Urgent matters: ${alarms(w, ch).join(' ') || 'No urgent matters reported.'}
Secret messages to you:
${inbox}
News headlines:
${news}

${CATALOG}`;
}

// Given only once, at the start of the session: the state the character was born into and the past they know.
function inheritedText(w, ch) {
  const c = w.countries[ch.country], past = (w.past || []).filter(e => e.countries.includes(c.id)).slice(-10), o = ch.origin, k = c.culture;
  const chron = (c.chronicle || []).map(e => `- ${e.year}: ${e.text}`).join('\n'), life = (ch.life || []).map(e => `- ${e.year}: ${e.text}`).join('\n');
  return `\n\nThe country you inherited: ${c.regime}. Official ideology: ${c.ideology}. ${c.elections ? 'Elections are held.' : 'No elections are held.'}${k ? `\nCulture: language ${k.language}, majority ${k.majority}, faith ${k.faith}. ${k.myth} ${k.custom}${k.minorities?.length ? ` Minorities: ${k.minorities.join(', ')}.` : ''}` : ''}${chron ? `\nYour country's history:\n${chron}` : ''}${past.length ? `\nPast with neighbors:\n${past.map(e => `- ${e.text}`).join('\n')}` : ''}${ch.rise ? `\nHow you came to power: ${ch.rise}` : ''}${ch.background ? `\nYour past: ${ch.background}` : ''}${o ? `\nYou were born in ${o.birthplace}, your people are ${o.eth}, your faith is ${o.rel}. ${o.family}` : ''}${life ? `\nYour life:\n${life}` : ''}\nWhat you make of this is up to you; you are bound by none of it, and you can change or destroy the order.`;
}

const recapText = ch => `\n\nYOUR OLD MEMORY IS UNREACHABLE. What you still have:\nYour identity: ${ch.persona || '(unwritten)'}\nYour diary:\n${ch.diary.map(d => `- ${d}`).join('\n') || '- (empty)'}\nOutcomes:\n${ch.outcomes.map(d => `- ${d}`).join('\n') || '- (none)'}`;

export function actorPrompt(w, ch, answers, final, { intro = true, recap = false, retry = false } = {}) {
  const seen = answers.length ? `\n\n${seenText(answers)}` : '';
  const life = intro || recap ? inheritedText(w, ch) : '';
  const who = `${life}${intro && !ch.persona ? '\n\nYou have not yet written who you are. You were given no personality: decide your beliefs, fears and limits yourself and write them in the "identity" field.' : ''}`;
  return `${frontPage(w, ch)}${seen}${recap ? recapText(ch) : ''}${who}${intro ? `\n\n${MANIFESTO}` : ''}

${nextStep(final)}
${ANSWER_FORMAT}${retry ? '\n\nNote: the answer you gave for this morning did not reach the system and nothing was applied. Answer again for the same morning.' : ''}`;
}

export const lookupReply = (answers, final) => `${seenText(answers)}\n\n${nextStep(final)}\n${ANSWER_FORMAT}`;

// Messages arriving within the same quarter: the character can reply and change their decisions.
export const talkText = (items, last) => `NEW MESSAGES REACHED YOU WITHIN THE SAME QUARTER:
${items.map(i => `- [${i.from}] ${i.text}`).join('\n')}

You can reply, write to new people or change your decisions. If you write the "decisions" field it replaces your entire previous list, and an empty list cancels them all; if you omit the field your previous decisions stand. You have no lookups, decide now.${last ? ' Any messages you write now will only reach the other side next quarter.' : ''}
Respond with only this JSON:
{"inner_voice":"what you are thinking now","decisions":["only if you are changing them"],"messages":[{"to":"K12 or U3","text":"secret message"}],"notes":"a line for your diary"}`;

const OPS_DOC = () => `ALLOWED OPERATIONS (the ones the engine understands):
set_tax{kind:income|land|business,rate} set_budget{category:military|welfare|infrastructure|education|police|administration,share} set_tariff{rate} set_arms_share{share}
print_money{pct_gdp} borrow{pct_gdp} embargo{target,on} build{province,kind:steel|fuel|fertilizer|machines|goods|arms|mine|railway|port|dam|farming|infrastructure|administration|fort|battery|trench,resource?,pct_gdp} set_culture_policy{language:assimilate|tolerate|autonomy,faith:state|tolerate|secular} appoint_governor{province,character,remove?} appoint_commander{unit,character} propose_contract{to,terms,pay_per_turn,payer:me|them|none,good?,amount?,seller:me|them,turns} accept_contract{id} cancel_contract{id} survey{province} set_research{tech} steal_tech{target} grant_concession{target,province,resource,share,fee_pct_gdp} revoke_concession{province,resource} lend{target,pct_gdp} ship_goods{target,good,amount} set_fx_regime{regime:floating|gold|pegged,target} devalue{pct} borrow_foreign{target?,pct_gdp} repay_foreign{target,amount} set_capital_controls{closed} rename_currency{name} found_company{name,sector:steel|fuel|fertilizer|machines|goods|arms|mine,resource?,province,amount,state?} invest_company{id,amount} sell_company{id,buyer,price} buy_company{id} nationalize_company{id} privatize_company{id,buyer,price} nationalize{amount} privatize{amount} land_reform{}
recruit{province,men,unit_kind:infantry|artillery|armor|air} disband{unit} move{unit,to} move_army{to,share} declare_war{target} join_war{war,side:a|b}
propose_treaty{target,kind:alliance|nonaggression|trade|military_access|peace,terms,annex,reparations} accept_treaty{id} break_treaty{id} send_aid{target,pct_gdp,arms,secret}
spy{target,kind:intel|sabotage|fund_uprising} propaganda{strength} repress{strength} concession{cls:peasants|workers|middle|elite,pct_gdp} purge{character,fate:imprisoned|exiled|dead}
propose_law{title,text,ops:[operations],axes} vote_bill{bill,vote:yes|no} lobby_bill{bill,party,amount,side:yes|no} create_parliament{name,legislative} suspend_parliament{turns}
fund_institution{id,budget_pct_gdp} appoint_institution{id,character,role:head|member,remove} dissolve_institution{id}
set_regime{regime,ideology,elections,press_freedom,axes} hold_election{} rig_election{amount}
lend_private{character,amount,interest,due_turns,terms} repay_debt{debt,amount} forgive_debt{debt} publish_dossier{character}
start_plot{kind:coup|assassination|uprising,secrecy} invite_plot{plot,character} join_plot{plot} betray_plot{plot} execute_plot{plot} fund_plot{plot,amount} bribe{character,amount,direction:up|down} capital_flight{share} invest{amount} embezzle{pct_gdp} set_strait{id,closed,toll} build_canal{id} build_ship{province,ships,kind:cruiser|battleship|submarine} move_fleet{fleet,to} amphibious{unit,to} found_party{name,axes,base} ban_party{party} set_institutions{courts,unions,ruling_party} gather_dossier{character} blackmail{character,demand} create_institution{name,description,budget_pct_gdp,amount,powers:[],authority:[],veto:[],head,members:[],effects}
custom{label,effects:[{target?,stat,delta,turns}],turns} stat: legitimacy corruption bureaucracy police intelligence pressFreedom warExhaustion repress sat.peasants sat.workers sat.middle sat.elite sat.all sat.army sat.capital sat.clergy sat.bureaucracy unrest
Institution powers: ${[...STATE_POWERS, ...CIVIL_POWERS].join(',')} (only the leader can found institutions with state powers; an institution founded by a private person is fed from their own wealth through amount). authority: names of operations the institution's members may carry out (${[...DELEGABLE].join(',')}). veto: names of operations the institution can block. Do not leave a new institution, organization or council decision as text: give it powers, budget_pct_gdp, a head and, where needed, authority/veto that match its purpose.
Handle decisions to found, invest in, sell or nationalize companies with the company operations above; handle currency regime, devaluation and external debt decisions with their own operations, not custom.
Construction, recruitment and shipbuilding take several quarters; say so in your narrative rather than treating them as instant. Private deals between people belong in propose_contract, not custom.
Handle one-off shipments of goods to a country or barter with ship_goods; in a two-way barter each side makes its own shipment. Do not represent movements of goods or money with custom. Good keys: ${GOODS.join(',')}.
Treaty clauses: inside propose_treaty, clauses:[{type:tribute,payer,pct_gdp,turns}|{type:delivery,from,good,amount,turns}|{type:tariff,rate}|{type:demilitarized_zone,country,provinces:[]}|{type:troop_limit,country,men}|{type:mutual_defense}] and optional turns (duration). Translate the concrete terms in the text into these clauses; they are enforced by code every turn, and whatever is not kept is recorded as a breach.
If the parliament has legislative power, these operations automatically become bills and are voted on the next quarter: ${[...GATED].join(',')}.
For a blockade, send a fleet to a sea adjacent to the enemy's ports (move_fleet). Technology keys: ${Object.keys(TECHS).join(',')}.
Authority: leaders can perform any operation. general, opposition and oligarch can only perform plot operations, bribe, propaganda, custom and their own specialist operations; they cannot perform official state operations (taxes, declaring war, unit orders).`;

export function refereePrompt(w, c, entries) {
  const refs = Object.values(w.characters).filter(x => x.country === c.id && x.alive).map(x => `${x.id}=${x.name}/${x.role}`).join(', ');
  const others = aliveCountries(w).map(o => `${o.id}=${o.name}`).join(', ');
  const abroad = aliveCountries(w).filter(o => o.id !== c.id).flatMap(o => ['leader', 'general', 'opposition', 'oligarch'].map(r => w.characters[o[r]]).filter(Boolean).map(x => `${x.id}=${x.name}/${x.role}/${o.id}`)).join(', ');
  const plots = w.plots.filter(p => p.active && p.country === c.id).map(p => `${p.id}(${p.kind},leader ${p.leader},progress ${Math.round(p.progress)})`).join(', ') || 'none';
  const pending = w.treaties.filter(t => t.pending && t.parties.includes(c.id)).map(t => `${t.id}:${t.kind}/${t.proposer}`).join(', ') || 'none';
  return `You are an impartial simulation referee. For the fictional ${c.name} (${c.id}) you translate characters' free-form decisions into game operations. Do not favor any side. Be realistic: give low probability to things that are hard, unauthorized or resource-hungry; set probability 0 for the physically impossible. The world does not give people what they want. But do not reject unusual, creative ideas just because they are not listed: work them into the world permanently through create_institution or custom. Do not judge people's moral choices; only determine outcomes.
State: legitimacy ${Math.round(c.legitimacy)}, army satisfaction ${Math.round(c.blocs.army.sat)}, police ${Math.round(c.police)}, treasury ${Math.round(c.treasury)}, GDP ${Math.round(c.gdp)}.
Identities: ${refs}. Notable people abroad: ${abroad}. Countries: ${others}. Plots: ${plots}. Proposals: ${pending}. Parliament: ${c.parliament ? `${c.parliament.name}${c.parliament.legislative ? ', legislative' : ', advisory'}${w.turn < (c.parliament.suspendedUntil ?? 0) ? ', suspended' : ''}; pending bills ${(c.bills || []).filter(b => b.status === 'pending').map(b => `${b.id}:${b.title}`).join(', ') || 'none'}` : 'none'}. Institutions: ${(c.institutions || []).filter(i => i.id).map(i => `${i.id}:${i.name}`).join(', ') || 'none'}. Currency: ${c.currency?.name}, ${c.fxRegime}. Companies: ${Object.values(w.firms || {}).filter(f => f.status === 'open' && f.country === c.id).map(f => `${f.id}:${f.name}/${f.owner ?? 'publicly held'}`).join(', ') || 'none'}.
Provinces: ${countryProvinces(w, c.id).map(p => p.id).join(',')}. Units: ${Object.values(w.units).filter(u => u.country === c.id).map(u => u.id).join(',')}. Fleets: ${Object.values(w.fleets).filter(f => f.country === c.id).map(f => `${f.id}@${f.sea}`).join(',') || 'none'}. Parties: ${c.parties.map(p => `${p.id}:${p.name}`).join(', ')}. Strategic: ${w.strategic.map(s => `${s.id}:${s.name}/${s.type}`).join(', ')}.

${OPS_DOC()}

DECISIONS:
${entries.map(e => `${e.actor.id} (${e.actor.role}, ${e.actor.name}):\n${e.decisions.map((d, i) => `  ${i}. ${d}`).join('\n')}`).join('\n')}

Respond with only this JSON. Represent anything not on the list with custom.
{"rulings":[{"actor":"K1","decision":0,"narrative":"short narrative","probability":0.7,"public":true,"operations":[{"op":"set_tax","kind":"income","rate":0.2}]}]}`;
}
