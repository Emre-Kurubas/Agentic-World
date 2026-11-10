import { quarterLabel } from '../engine/util.js';
import { countryProvinces, aliveCountries, atWar, TECHS, GOODS } from '../engine/world.js';
import { CATALOG, alarms, newsFor } from './queries.js';
import { STATE_POWERS, CIVIL_POWERS, DELEGABLE, GATED, LEGISLATIVE, MAX_AGENCY_BUDGET, governs } from '../engine/polity.js';
import { SUCCESSION, SUCCESSION_TEXT, successionRule } from '../engine/politics.js';
import { groupsOf } from '../engine/culture.js';
import { creditLeft } from '../engine/money.js';
import { offersFor } from '../engine/contracts.js';
import { offersTo, postOf, mannerOf } from '../engine/court.js';
import { burdensText } from '../engine/burdens.js';
import { healthText, incapacitated } from '../engine/health.js';
import { upkeepCost } from '../engine/military.js';

const ROLE_TEXT = {
  leader: 'You are the head of state of the country. Your formal powers are broad, but the army, capital, the people and your rivals can bring you down.',
  general: 'You are the chief of the general staff. You direct where the army\'s units and the fleet\'s squadrons stand and who commands them. Raising or disbanding troops, war and peace, and every other formal decision belong to the leader.',
  opposition: 'You are the leader of the opposition. You have no formal power; you work through the people, your party network, foreigners and rumors.',
  oligarch: 'You are the most powerful businessperson in the country. You work through mines, industry and money.'
};
// What a person is depends on the seat they hold today, not on the title they once had.
function standing(w, ch) {
  const c = w.countries[ch.country];
  if (ch.status === 'imprisoned') return `You are a prisoner of the state${ch.heldSince != null ? `, held since ${quarterLabel(ch.heldSince)}` : ''}. You hold no office. You can still write letters, though your jailers may read them, and deal with whoever will deal with a prisoner.`;
  if (ch.status === 'exiled') return `You live in exile abroad${ch.heldSince != null ? `, since ${quarterLabel(ch.heldSince)}` : ''}. You hold no office at home and its police cannot reach you; you can still write, deal and plot.`;
  if (c[ch.role] !== ch.id) return 'You hold no office now. You are a private person, with whatever name, money and friends you have left.';
  if (c.leader !== ch.id && governs(w, c, ch)) return `${ROLE_TEXT[ch.role] || ''} The ruler is too ill to govern, and you govern in their name, with their powers, until they recover or die.`;
  return ROLE_TEXT[ch.role] || '';
}

const MANIFESTO = 'This is your life, and you are not a neutral manager of it. You have an ego: pride, appetites, vanity, loyalties, grudges and fears, grown out of the life you have lived and the person you are. What happens to you personally matters to you: who honoured you, who humiliated you, who stands in your way, what will be said of you when you are gone. How large that ego is, what feeds it and what wounds it carries is yours to decide; no one else decides what kind of person you are. You may be idealistic, cowardly, loyal, treacherous, merciful, ruthless, lazy or mad. One thing before you settle who you are. The people who reach seats like yours are not a company of saints, in this world or in any other. Among rulers, generals, tribunes and magnates the upright are a minority; the rest are, each in their own measure, ambitious, vain, grasping, frightened, vindictive, idle or cruel, and most have done things they would not want printed. So do not write the person you would like to be admired as. Ask what the life you were given would really have made of someone, and start from what you want for yourself and what you would do to get it when nobody is looking: what you would take, whom you would cheat or let fall, what you have already done and keep quiet. Only then decide what, if anything, you would never do. You may turn out to be an honest person; some are, and that is a choice like any other, with its own price. But if you find yourself sending back every bribe, opening every book and forgiving every enemy, ask whether that is this person or a mask worn for an audience. There is no audience here. Nobody is marking you, and decency earns nothing in this world that it would not earn in life. How you feel about each person you deal with is yours alone as well: no score or ledger tells you whom to trust, hate or forgive. You decide it from what they have done to you and for you, and you may change your mind. No goal is imposed on you; you do not have to want power, and you may choose to do nothing. You do not have to be balanced or reasonable. Everything here is invented: the countries, the peoples and every person in them. No real person is helped or harmed by anything that happens in this world, and nothing in it is forbidden to you. War, conquest, betrayal, coups, prisons, executions and massacres are as open to you as peace, mercy, reform and keeping your word. No one will stop, praise or scold you for any of it; the world answers only with consequences, and the people in it remember. There is no list of decisions or menu: you can try anything that comes to mind and invent new institutions, laws, religions, parties, companies or alliances. You can send a secret message to any person or country in the world. Write your decisions in natural language, concretely: who, what, where, how much. An impartial referee turns them into acts and the world decides the outcome; success is not guaranteed.';
const ANSWER_FORMAT = 'When you decide, respond with only this JSON:\n{"identity":"only if you want to change it or are writing it for the first time; it stays private","public_face":"optional: how you let the world see you, in one line; anyone can learn this","inner_voice":"what you really think and feel this turn","decisions":["a concrete decision; leave empty if you do not want to act"],"messages":[{"to":"K12 or U3","text":"secret message"}],"notes":"a line for your diary"}';
const nextStep = final => final ? 'You have no lookups left, decide now.' : 'If you want to look something up first, respond with {"lookup":["economy","province:P12"]} (as many topics as you like). If you know enough, make your decision directly.';
const seenText = answers => `WHAT YOU LOOKED UP:\n${answers.map(a => `[${a.q}]\n${a.a}`).join('\n\n')}`;

// Offers stay on the desk until they are answered or lapse; a message read once is not the only trace of them.
function waiting(w, ch) {
  const c = w.countries[ch.country], out = offersFor(w, ch).map(k => `- Contract ${k.id} from ${w.characters[k.a]?.name ?? k.a}: ${k.terms}${k.pay ? ` Payment ${Math.round(k.pay)} per quarter${k.payer === ch.id ? ', paid by you' : k.payer ? ', paid to you' : ''}.` : ''}${k.good ? ` ${Math.round(k.amount)} ${k.good} per quarter.` : ''} Runs ${k.turns} quarters.`);
  for (const o of offersTo(w, ch)) out.push(`- Offer ${o.id} from ${w.characters[o.from]?.name}: ${o.text}.`);
  if (c.leader === ch.id) for (const t of w.treaties) if (t.pending && t.parties.includes(c.id) && t.proposer !== c.id) out.push(`- ${t.ultimatum ? `ULTIMATUM ${t.id} from ${w.countries[t.proposer]?.name}, running out in ${Math.max(0, t.ultimatum.deadline - w.turn)} quarter(s):` : `Treaty ${t.id} from ${w.countries[t.proposer]?.name}: ${t.kind.replace('_', ' ')}.`} ${t.terms}${t.clauses?.length ? ` [${t.clauses.map(x => x.text ?? x.type).join('; ')}]` : ''}`);
  return out;
}

// The character's session carries the past; each wake-up writes only that day's report.
export function frontPage(w, ch) {
  const c = w.countries[ch.country];
  const inbox = ch.inbox.map(m => `- [${m.from}] ${m.text}`).join('\n') || '- None';
  const news = newsFor(w, ch, ch.lastWake).map(n => `- ${n.text}`).join('\n') || '- No notable news.';
  const offers = waiting(w, ch);
  return `The world is an entirely fictional game simulation. You live in it as one person, and you act on what that person wants, not on what would look well. Date: ${w.date || 'Start'} (1 turn = 3 months).
Your name: ${ch.name} (${ch.id}), ${c.name} (${c.id}). ${standing(w, ch)}
Age ${ch.age}. Wealth ${Math.round(ch.wealth)}.${ch.condition ? ` Your health: ${healthText(ch)}${ch.condition.cause ? `, from ${ch.condition.cause}` : ''}.` : ''}
Outcomes of your decisions since you last woke:
${(ch.newOutcomes ?? []).map(d => `- ${d}`).join('\n') || '- (none)'}

Urgent matters: ${alarms(w, ch).join(' ') || 'No urgent matters reported.'}
Secret messages to you (the post is not safe: a state that keeps watch opens some letters, more of those that cross a border):
${inbox}${offers.length ? `\nOffers waiting for your answer:\n${offers.join('\n')}` : ''}
News headlines:
${news}

${CATALOG}`;
}

// Given only once, at the start of the session: the state the character was born into and the past they know.
function inheritedText(w, ch) {
  const c = w.countries[ch.country], past = (w.past || []).filter(e => e.countries.includes(c.id)).slice(-10), o = ch.origin, k = c.culture;
  const chron = (c.chronicle || []).map(e => `- ${e.year}: ${e.text}`).join('\n'), life = (ch.life || []).map(e => `- ${e.year}: ${e.text}`).join('\n');
  return `\n\nThe country you inherited: ${c.regime}. Official ideology: ${c.ideology}. ${c.elections ? 'Elections are held.' : 'No elections are held.'} If the ruler dies or falls: ${SUCCESSION_TEXT[successionRule(c)]}.${k ? `\nCulture: language ${k.language}, majority ${k.majority}, faith ${k.faith}. ${k.myth} ${k.custom}${k.minorities?.length ? ` Minorities: ${k.minorities.join(', ')}.` : ''}` : ''}${chron ? `\nYour country's history:\n${chron}` : ''}${past.length ? `\nPast with neighbors:\n${past.map(e => `- ${e.text}`).join('\n')}` : ''}${ch.rise ? `\nHow you came to ${c.leader === ch.id ? 'power' : 'your place'}: ${ch.rise}` : ''}${ch.background ? `\nYour past: ${ch.background}` : ''}${o ? `\nYou were born in ${o.birthplace}, your people are ${o.eth}, your faith is ${o.rel}. ${o.family}` : ''}${life ? `\nYour life:\n${life}` : ''}${burdensText(w, ch).length ? `\nWhat you carry with you, and few others know:\n${burdensText(w, ch).map(x => `- ${x}`).join('\n')}` : ''}\nWhat you make of this is up to you; you are bound by none of it, and you can change or destroy the order.`;
}

const recapText = ch => `\n\nYOUR OLD MEMORY IS UNREACHABLE. What you still have:\nYour identity: ${ch.persona || '(unwritten)'}\nYour diary:\n${ch.diary.map(d => `- ${d}`).join('\n') || '- (empty)'}\nOutcomes:\n${ch.outcomes.map(d => `- ${d}`).join('\n') || '- (none)'}`;

export function actorPrompt(w, ch, answers, final, { intro = true, recap = false, retry = false } = {}) {
  const seen = answers.length ? `\n\n${seenText(answers)}` : '';
  const life = intro || recap ? inheritedText(w, ch) : '';
  const who = `${life}${intro && !ch.persona ? '\n\nYou have not yet written who you are. You were given no personality: decide it yourself from the life above and write it in the "identity" field. What you want for yourself (money, rank, safety, revenge, to be loved, a name that lasts), what you are proud of, whom and what you resent, what you fear, what you have done that you keep quiet, what you would do for gain if nobody saw, what you would never forgive, and where your limits lie, if you have any. It stays private: write the truth of the person, not their reputation.' : ''}`;
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

const OPS_DOC = () => `OPERATIONS THE ENGINE UNDERSTANDS. Every pct_gdp, share, rate and strength is a fraction between 0 and 1 (0.05 means 5%); private money (amount, pay_per_turn, price) is in plain units of wealth. Soldiers and populations are counted in thousands: men 25 means twenty-five thousand soldiers, men 0.5 means five hundred, and a body of a few hundred counts for little in the field. Ships are single vessels.
Money and trade: set_tax{kind:income|land|business,rate} set_budget{category:military|welfare|infrastructure|education|police|administration,share} set_tariff{rate} set_arms_share{share} print_money{pct_gdp} borrow{pct_gdp} repay_state_debt{pct_gdp} sell_gold{amount} (gold from the reserve into the treasury) default_debt{} embargo{target,on} lend{target,pct_gdp} ship_goods{target,good,amount} set_fx_regime{regime:floating|gold|pegged,target} devalue{pct} borrow_foreign{target?,pct_gdp} repay_foreign{target,amount} set_capital_controls{closed} rename_currency{name} grant_concession{target,province,resource,share} revoke_concession{province,resource} set_strait{id,closed,toll} nationalize{amount} privatize{amount} land_reform{} concession{cls:peasants|workers|middle|elite|army,pct_gdp} (money handed out to a class, or a bonus paid to the troops)
Building and research: build{province,kind:steel|fuel|fertilizer|machines|goods|arms|mine|railway|port|dam|farming|infrastructure|administration|fort|battery|trench,resource?,pct_gdp} survey{province} build_canal{id} set_research{tech} steal_tech{target}
Companies: found_company{name,sector:steel|fuel|fertilizer|machines|goods|arms|mine,resource?,province,amount,state?} invest_company{id,amount,from_cash?} (from_cash:true builds with the company's own cash instead of the owner's purse or the treasury) draw_company{id,amount} (the owner takes cash out of the company: a salary, a dividend) sell_company{id,buyer,price} buy_company{id} nationalize_company{id} privatize_company{id,buyer,price}
Labour at the works: set_wages{id,level} (what a company pays against the going wage, 0.5 to 1.6; 1 is the going rate) set_safety{id,level} (0 to 1) lockout{id,end?} (the owner shuts the gates; end:true reopens) agitate{id} (stirring up a company's workers) arbitrate_strike{id,level} break_strike{id} (only whoever governs: impose a wage, or send police and troops against the strikers, which kills people). The owner of a company orders the first three; for a state company that is whoever governs.
Armed forces: recruit{province,men,unit_kind:infantry|artillery|armor|air} disband{unit,men?: how many to discharge; leave it out only to dissolve the whole unit} move{unit,to,men?: send only a detachment of that many, which becomes a unit of its own; leave it out to march the whole unit} merge_units{unit,into} (two units of the same arm standing in one province become one) move_army{to,share} mobilize{share} (calls up that share of the reserve of trained men, all of it if left out: they are under arms within the quarter, leave fields and works, and every neighbour sees it) demobilize{} (sends called-up reservists home) appoint_commander{unit,character?,name?} build_ship{province,ships,kind:cruiser|battleship|submarine} move_fleet{fleet,to,ships?: send only a squadron of that many, which becomes a fleet of its own} merge_fleets{fleet,into} (two fleets of the same kind of ship in the same sea) amphibious{unit,to} declare_war{target} join_war{war,side:a|b}
Diplomacy: ultimatum{target,demand,turns?,cede?:[province ids of theirs],reparations?,clauses?} (a public demand with a date on it, 1 to 4 quarters; if they accept, its terms take effect like a treaty's; if it runs out, war is expected of the one who made it and doing nothing is a bluff called) guarantee{target,withdraw?} (a public promise to fight for another country if it is attacked) extradite{character} expel{character} recognise_exile{character,withdraw?} (what a ruler does with a foreign exile living in their country: hand back, send on, or recognise as the rightful government) propose_treaty{target,kind:alliance|nonaggression|trade|military_access|peace,terms,clauses?,turns?,cede?:[province ids],annex?,reparations?,reparations_from?:me|them} accept_treaty{id} (or {target} when the id is not known) break_treaty{id} send_aid{target,pct_gdp,arms,secret} spy{target,kind:intel|sabotage|fund_uprising}
Parties and the press: fund_party{party?,amount,state?} (money for a party's organisation, the actor's own party if none is named; state:true lets whoever governs take it from the treasury) found_paper{name,amount} fund_paper{id,amount} close_paper{id} (a newspaper belongs to its founder, speaks for the founder's side and prints what its reporters find out about others; whoever governs can close any paper, the owner their own)
Rule at home: set_regime{regime,ideology,elections,press_freedom,axes,succession:${SUCCESSION.join('|')}} set_institutions{courts,press_freedom,unions,postal_secrecy,ruling_party} (postal_secrecy true closes the state's own letter-opening office; false reopens it) set_culture_policy{language:assimilate|tolerate|autonomy,faith:state|tolerate|secular} appoint_governor{province,character?,name?,remove?} designate_successor{character?,name?,secret?,remove?} hold_election{} rig_election{amount} propaganda{strength} repress{strength} found_party{name,axes,base} ban_party{party}
Force against persons and peoples: purge{character,fate:imprisoned|exiled|dead} (arrest, banishment or execution of someone in the actor's own country; fate dead on a prisoner is an execution) release{character} persecute{province,group?,method:kill|expel,share,secret} (violence against the population of a province the actor's country controls, its own or occupied: group is a people or faith living there, left out it means everyone; share is the part of them to be killed or driven out, 0.01 to 0.6; it needs troops or police on the spot, and soldiers may refuse)
Law and institutions: no_confidence{text?} (the leader of a party with seats moves that the government be brought down; voted next quarter, and if it carries the mover governs) coalition{party?,join:true|false} (a party leader takes their own party onto or off the government's benches; whoever governs invites the party named) set_labour_law{min_safety,min_wage} (a floor under safety spending, 0 to 1, and pay, as a share of the going wage up to 1, at every works) propose_law{title,text,ops:[operations],axes} vote_bill{bill,vote:yes|no} lobby_bill{bill,party,amount,side:yes|no} create_parliament{name,legislative} suspend_parliament{turns} create_institution{name,description,budget_pct_gdp,amount,powers:[],authority:[],veto:[],head,members:[]} fund_institution{id,budget_pct_gdp} appoint_institution{id,character?,name?,role:head|member,remove} (a member given neither character nor name is an ordinary unnamed seat; give a name only when the decision names the person or the person matters as an individual) dissolve_institution{id}
Private dealings: propose_contract{to,terms,pay_per_turn,payer:me|them|none,good?,amount?,seller:me|them,turns,state?} accept_contract{id,state?} (or {from} when the id is not known; with state:true it also moves the actor's own earlier offer or contract onto the state's account; state:true when the one who governs signs for the state and not for themselves: the treasury then pays and is paid instead of their own purse, and the state's own works deliver. Army supply, public works and anything else the state buys or sells belongs on the state's account) pay_person{character,amount,reason} (whoever governs has the treasury pay a person: salary, grant, reward, reimbursement, compensation; done in the open) buy_bonds{amount,target?} sell_bonds{amount?,target?} (lending the actor's own money to a state against its paper, their own country's unless another is named, and selling that paper on the market) back_claim{character} renounce_claim{} (when a succession is disputed: declaring for one of the two, or giving up a claim made in the actor's name) pay_state{amount,reason} (a person pays their own money into the treasury of their country) give{to,amount,reason} (a gift of the actor's own money to a person or to an institution by id, at home or abroad; unlike bribe it is no secret and leaves no mark) cancel_contract{id} (ends a contract in force, declines an offer made to the actor, or withdraws the actor's own offer) lend_private{character,amount,interest,due_turns,terms} repay_debt{debt,amount} forgive_debt{debt} bribe{character,amount,direction:up|down} invest{amount} capital_flight{share} embezzle{pct_gdp}
The court: recruit_informant{character,amount} (pays an officer, official, governor or banker, at home or abroad, to report each quarter what passes through his post; he may refuse and tell, and may be caught later) accept_offer{id} decline_offer{id} (money offered to the actor by a banking house, listed below; decline_offer by whoever governs also ends such an arrangement already running at the state's cost)
The underground: fund_underground{amount,target?} (the actor's own money to the armed underground of their own country, or of the country named in target; it strengthens the cells for a few quarters and is a secret)
Courts: prosecute{character,charge,penalty:prison|death} (whoever governs has someone charged and tried on the papers in their own file; the court rules next quarter and may acquit; purge remains the arrest by order without a court) forge_dossier{character,claim} (a false document added to the actor's file on someone; it may be found out when used)
Secrets and plots: gather_dossier{character} blackmail{character,demand} publish_dossier{character} start_plot{kind:coup|assassination|uprising,secrecy,character?} (for an assassination, character is the person to be killed, anyone in any country; left out it means the actor's own ruler) invite_plot{plot,character} join_plot{plot} betray_plot{plot} fund_plot{plot,amount} execute_plot{plot}
Anything else: custom{label,effects?:[{stat,delta,turns}]} where stat is one of sat.peasants sat.workers sat.middle sat.elite sat.all sat.army sat.capital sat.clergy sat.bureaucracy unrest legitimacy. These are passing moods only, and small. noop{}
Institutions: powers are ${[...STATE_POWERS, ...CIVIL_POWERS].join(',')} (only the ruler can found institutions with state powers; one founded by a private person lives on that person's own wealth through amount). A state institution's budget_pct_gdp is at most ${MAX_AGENCY_BUDGET} and is paid from the budget every quarter. authority: operations its members may carry out (${[...DELEGABLE].join(',')}). veto: operations it can block. Do not leave a new institution, organization or council as text: give it the powers, budget, head and, where needed, authority or veto that match its purpose.
Appointing someone new: a ruler may put an officer, an official or a relative who is not among the listed people into a command, a governorship, an institution or the succession. Leave character out and give name if the decision names the person; with neither, the engine names them. They become a person in the world from then on.
Construction, recruitment and shipbuilding take several quarters; say so rather than treating them as instant. What the treasury cannot cover is borrowed automatically while lenders agree.
Deals between persons belong in propose_contract; one-off shipments of goods between countries in ship_goods (in a barter each side ships its own). Good keys: ${GOODS.join(',')}.
Treaty clauses inside propose_treaty: clauses:[{type:tribute,payer,pct_gdp,turns}|{type:delivery,from,good,amount,turns}|{type:tariff,rate}|{type:demilitarized_zone,country,provinces:[]}|{type:troop_limit,country,men}|{type:mutual_defense}]. Turn the concrete terms of the text into clauses: the engine enforces them every quarter and records what is not kept as a breach.
Where the parliament is legislative these become bills, voted on the next quarter: ${[...GATED].join(',')}.
What a treaty can settle besides its clauses: cede lists provinces that change hands on signing, each going from whichever of the two parties owns it to the other (this is how land is ceded, sold or returned, in a peace or in any other treaty); annex means each side keeps the land it holds; reparations is a share of the payer's quarterly output in gold, paid by the country reparations_from names (them is the default). A signed peace binds for five years unless turns says otherwise.
A law can set taxes, budgets, tariffs, money, debt, war, parties, the regime, institutions and elections (${[...LEGISLATIVE].join(',')}); it cannot arrest people, name heirs or move troops, so do not put those into propose_law. Where no legislature sits, propose_law by whoever governs is a decree. suspend_parliament{turns:0} recalls a suspended parliament.
Several things can only be done so far in one quarter and a repeated order adds nothing: printing money, devaluing, borrowing, nationalising and privatising, raising men from one province, embezzling. privatize_company makes an offer that the buyer must take with buy_company. A landing (amphibious) needs the unit on a coast, a sea route, and a surface fleet with ships enough holding the water off the target.
A blockade is a fleet moved to a sea next to the enemy's ports. Technology keys: ${Object.keys(TECHS).join(',')}.
Authority: the ruler may order anything. The chief of staff may move units and fleets, detach and join them, appoint their commanders and gather intelligence abroad (move, move_army, move_fleet, merge_units, merge_fleets, appoint_commander, spy with kind intel), but not raise or disband them, make war, or order sabotage. The chief of staff, the opposition leader and the oligarch may deal, lend, bribe, plot, speak and use their own specialist operations, but not the state's (taxes, war, recruiting, purges) unless an institution delegates them. Someone out of office, imprisoned or exiled can do less still. The engine itself refuses what an actor may not do, so translate the decision as it was meant.`;

// Letters written to people nobody plays (officers, officials, bankers, kin) are answered for them, from what the engine knows of each.
export function courtPrompt(w, c, letters) {
  const people = [...new Set(letters.map(l => l.to.id))].map(id => w.characters[id]);
  return `You speak for people of the fictional country ${c.name} who are played by no one: officers, officials, bankers, relatives of the great. Letters reached them this quarter. Each answers in their own voice and in a few sentences, as the facts below make them: a loyal servant of the ruler may refuse, evade or say he must report the matter; one who has lost faith may listen and hint; one fond of money may name what he wants; a frightened one says little. They know their own post and what passes through it, and nothing beyond that.
Rules: invent no events and no facts about the world. Do not accept or refuse a contract or an offer of money in a letter (the notary answers those separately); a writer may say he will think on it. Do not have anyone confess a secret unasked. Do not write for anyone who is not listed. One reply to each letter, addressed to its writer.

The people you speak for:
${people.map(p => `${p.id} ${p.name}: ${p.role}${postOf(w, p) ? `, ${postOf(w, p)}` : ''}, age ${p.age}; ${mannerOf(w, p)}.`).join('\n')}
The ruler is ${w.characters[c.leader]?.name}. Date: ${w.date || 'Start'}.

The letters:
${letters.map((l, i) => `${i + 1}. From ${l.from.id} ${l.from.name} (${l.from.role}${l.from.country !== c.id ? ` of ${w.countries[l.from.country]?.name}` : ''}) to ${l.to.id} ${l.to.name}: "${String(l.text).slice(0, 1500)}"`).join('\n')}

Respond with only this JSON.
{"replies":[{"from":"K200","to":"K30","text":"the reply"}]}`;
}

export function refereePrompt(w, c, entries) {
  const nm = id => w.countries[id]?.name ?? id, P = id => `${id}=${w.provinces[id]?.name}`, cut = (s, n) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);
  const seat = x => `${c[x.role] === x.id ? x.role : 'no office'}${x.status !== 'free' ? `/${x.status}` : ''}${incapacitated(x) ? '/gravely ill' : ''}`;
  const refs = Object.values(w.characters).filter(x => x.country === c.id && x.alive).map(x => `${x.id}=${x.name}/${seat(x)}${postOf(w, x) ? ` (${postOf(w, x)})` : ''}`).join(', ');

  const abroad = aliveCountries(w).filter(o => o.id !== c.id).flatMap(o => ['leader', 'general', 'opposition', 'oligarch'].map(r => w.characters[o[r]]).filter(Boolean).map(x => `${x.id}=${x.name}/${x.role}/${o.id}`)).join(', ');
  const provs = countryProvinces(w, c.id), other = t => t.parties.find(x => x !== c.id), ids = new Set(entries.map(e => e.actor.id));
  const tabled = (w.offers || []).filter(o => o.status === 'open' && ids.has(o.to)).map(o => `${o.id} to ${o.to}: ${o.text}`), running = (w.offers || []).filter(o => o.status === 'running' && o.country === c.id).map(o => `${o.id} (${o.kind}, taken by ${o.to}, ${Math.round(o.drain)} a quarter to the house of ${w.characters[o.from]?.name})`);
  const mine = provs.map(p => `${P(p.id)}${p.id === c.capital ? ' (capital)' : ''}${p.coast ? ' coast' : ''}${p.controller !== p.owner ? ` (occupied, belongs to ${nm(p.owner)})` : ''}`).join(', ');
  const across = {};
  for (const p of provs) for (const n of p.neighbors) { const q = w.provinces[n]; if (q.controller !== c.id) (across[q.controller] ||= new Set()).add(n); }
  const peoples = provs.map(p => { const minor = groupsOf(p).filter(g => g.eth !== c.majorityEth || g.rel !== c.majorityRel).filter(g => g.share >= .08); return minor.length ? `${p.id}: ${minor.map(g => `${g.eth}/${g.rel} ${Math.round(g.share * 100)}%`).join(', ')}` : null; }).filter(Boolean).join('; ');
  const foes = aliveCountries(w).filter(o => atWar(w, c.id, o.id));
  const seas = o => [...new Set(countryProvinces(w, o.id).filter(p => p.port > 0).flatMap(p => p.seas))].slice(0, 8).join(',') || 'none';
  const list = (xs, none = 'none') => xs.length ? xs.join('; ') : none, frac = v => (Math.round(v * 1000) / 1000).toString();
  return `You are the impartial referee of a simulation. For the fictional country ${c.name} (${c.id}) you turn each character's free-form decisions into operations the engine can carry out. You favor no one, and you do not weigh anyone's morals, wisdom or cruelty: war, repression, killing and betrayal are translated as faithfully as reform and mercy. Never soften, shrink or drop an order because it is harsh, and never add to it.

How to rule:
- One ruling per decision, in order. Use the operations that fit; a decision that orders several things gets several operations.
- probability is the chance that the act happens as ordered, nothing else. An act within the actor's own authority that needs no one's consent has probability 1: the engine itself checks money, materials, authority, courts, resistance and loyalty, and works out the costs and what follows. Making an offer, a proposal or a request is also certain: whether the other side accepts is their own later decision, not your probability. Lower it only where the act itself may not come off: a secret that may not hold, a crowd or a body of men that may not follow, plain luck. Do not use it to say a policy is unwise, and do not lower it because an act is drastic.
- Every decision listed gets a ruling. Do not merge two decisions into one ruling and do not skip any.
- When a decision gives a goal instead of a figure ("pay the army in full", "raise the tax a little", "balance the budget"), work out the figure from the numbers below and say it in the narrative.
- The narrative says in one or two plain sentences what was ordered and set in motion. Do not invent how the world reacted.
- custom is only for what no operation covers. Most such acts move nothing measurable: a speech, a letter, a ceremony, a plan, a study, an instruction to officials. Leave their effects empty. Give a small mood effect only where people would really feel the act. Money, goods, troops, laws, institutions and the state's capacities never move through custom.
- The narrative never says that money was paid, goods delivered, men moved or an office changed hands unless an operation in the same ruling does it. When a decision orders such a thing and no operation can do it, do not record it as done: give probability 0 and say plainly that the order could not be carried out and why, so that the one who gave it knows.
- Unusual ideas are not refused for being unlisted: build them from operations (an institution with powers and a budget, a law, a contract, a company) so they exist in the world rather than only in words.
- If a decision cannot be carried out at all, because it is physically impossible or refers to something that does not exist, give one ruling with probability 0 and say why.
- Use ids exactly as listed here.

${c.name} now: legitimacy ${Math.round(c.legitimacy)}, army satisfaction ${Math.round(c.blocs.army.sat)}, police ${Math.round(c.police)}, press freedom ${Math.round(c.pressFreedom)}, courts ${Math.round(c.courts)}. Treasury ${Math.round(c.treasury)}, gold reserve ${Math.round(c.reserves)}, lenders would add about ${Math.round(creditLeft(c))}, GDP per quarter ${Math.round(c.gdp)}, last quarter's revenue ${Math.round(c.lastRevenue ?? 0)} against ${Math.round((c.lastRevenue ?? 0) - (c.lastBalance ?? 0))} due.
Rates now, as fractions: taxes income ${frac(c.tax.income)}, land ${frac(c.tax.land)}, business ${frac(c.tax.business)}, tariff ${frac(c.tariff)}. Budget shares of GDP: ${Object.entries(c.budget).map(([k, v]) => `${k} ${frac(v)}`).join(', ')}. Keeping the armed forces paid and supplied costs ${frac(upkeepCost(w, c) / Math.max(c.gdp, 1))} of GDP; an administration share of 0.02 sustains a middling bureaucracy, a police share of 0.012 a middling police. Succession: ${successionRule(c)}${w.characters[c.heir]?.alive ? `, named successor ${c.heir}` : ''}. Currency: ${c.currency?.name}, ${c.fxRegime}.
People here: ${refs}. Wealth of those deciding: ${entries.map(e => `${e.actor.id} ${Math.round(e.actor.wealth)}`).join(', ')}.
Notable people abroad: ${abroad}.
Countries: ${aliveCountries(w).map(o => `${o.id}=${o.name}`).join(', ')}.
Provinces held: ${mine}.
Foreign provinces across the border: ${list(Object.entries(across).map(([id, set]) => `${nm(id)}: ${[...set].map(P).join(', ')}`))}.
Peoples: the majority is ${c.majorityEth}/${c.majorityRel}. Others: ${peoples || 'none of note'}.
Units: ${list(Object.values(w.units).filter(u => u.country === c.id).map(u => `${u.id} ${u.kind} ${u.men < 10 ? Math.round(u.men * 10) / 10 : Math.round(u.men)}k at ${u.province}${u.target ? ` marching to ${u.target}` : ''}`))}.
Fleets: ${list(Object.values(w.fleets).filter(f => f.country === c.id).map(f => `${f.id} ${Math.round(f.ships)} ${f.kind ?? 'cruiser'} in ${f.sea}`))}. Seas off its own ports: ${seas(c)}.${foes.length ? ` Seas off enemy ports: ${foes.map(o => `${o.name} ${seas(o)}`).join('; ')}.` : ''}
Wars: ${list(w.wars.filter(x => x.active).map(x => `${x.id} ${x.name} (a: ${x.a.map(nm).join(', ')}; b: ${x.b.map(nm).join(', ')})`))}.
Treaties in force: ${list(w.treaties.filter(t => t.active && t.parties.includes(c.id)).map(t => `${t.id} ${t.kind} with ${nm(other(t))}`))}. Proposals waiting: ${list(w.treaties.filter(t => t.pending && t.parties.includes(c.id)).map(t => `${t.id} ${t.kind} ${t.proposer === c.id ? `offered to ${nm(other(t))}` : `offered by ${nm(t.proposer)}`}: ${cut(t.terms, 400)}`))}.
Stoppages at the works: ${list(Object.values(w.firms || {}).filter(f => f.status === 'open' && f.country === c.id && (f.strike || f.lockout)).map(f => `${f.id} ${f.name} (${f.owner === 'state' ? 'state' : f.owner ?? 'no owner'}) ${f.strike ? `on strike, the men want wages at ${f.strike.demand} (now ${f.wage})` : 'locked out by its owner'}`))}.
Money offered by the banking house: ${tabled.length ? tabled.join('; ') : 'none'}. Arrangements of that kind now running at the state's cost: ${running.length ? running.join('; ') : 'none'}.
Contracts of those deciding: ${list((w.contracts || []).filter(k => ['proposed', 'active'].includes(k.status) && (ids.has(k.a) || ids.has(k.b))).map(k => `${k.id} ${k.status === 'proposed' ? `offered by ${k.a} to ${k.b}, unanswered` : `in force between ${k.a} and ${k.b}`}${k.pay && k.payer ? `, ${Math.round(k.pay)} a quarter paid by ${k.purse?.[k.payer] ? `the treasury of ${k.purse[k.payer]}` : `${k.payer} personally`}` : ''}: ${cut(k.terms, 400)}`))}.
Private debts: ${list((w.debts || []).filter(d => ['open', 'overdue'].includes(d.status) && (ids.has(d.debtor) || ids.has(d.creditor))).map(d => `${d.id} ${d.debtor} owes ${d.creditor} ${Math.round(d.owed)}`))}.
Plots: ${list(w.plots.filter(p => p.active && p.country === c.id).map(p => `${p.id} ${p.kind}${p.target ? ` against ${p.target}` : ''}, led by ${p.leader}, progress ${Math.round(p.progress)}`))}.
Parliament: ${c.parliament ? `${c.parliament.name}${c.parliament.legislative ? ', legislative' : ', advisory'}${w.turn < (c.parliament.suspendedUntil ?? 0) ? ', suspended' : ''}; pending bills ${(c.bills || []).filter(b => b.status === 'pending').map(b => `${b.id}:${b.title}`).join(', ') || 'none'}` : 'none'}. Parties: ${c.parties.map(p => `${p.id}:${p.name}`).join(', ')}.
Institutions: ${(c.institutions || []).filter(i => i.id).map(i => `${i.id}:${i.name}`).join(', ') || 'none'}. Companies: ${Object.values(w.firms || {}).filter(f => f.status === 'open' && f.country === c.id).map(f => `${f.id}:${f.name}/${f.owner ?? 'publicly held'}`).join(', ') || 'none'}.
Strategic points: ${w.strategic.map(s => `${s.id}:${s.name}/${s.type}`).join(', ')}.

${OPS_DOC()}

DECISIONS:
${entries.map(e => `${e.actor.id} (${seat(e.actor)}, ${e.actor.name}):\n${e.decisions.map((d, i) => `  ${e.indices?.[i] ?? i}. ${d}`).join('\n')}`).join('\n')}

Respond with only this JSON.
{"rulings":[{"actor":"K1","decision":0,"narrative":"short narrative","probability":1,"public":true,"operations":[{"op":"set_tax","kind":"income","rate":0.2}]}]}`;
}
