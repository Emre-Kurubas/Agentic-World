// Country chronicles and character lives. Only events are recorded; who feels what is never written.
// Uses local randomness; does not affect world generation or the engine.
import { countryProvinces, aliveCountries, GOOD_LABEL } from './world.js';
import { givenNames, familyNames, personName } from './names.js';

function seeded(key) {
  let h = 2166136261; for (const ch of key) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return () => { h = (h + 0x6D2B79F5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pickOf = (r, list) => list[Math.floor(r() * list.length)];
const between = (r, a, b) => a + Math.floor(r() * (b - a + 1));
const person = (r, eth, rel) => `${pickOf(r, givenNames(eth, rel))} ${pickOf(r, familyNames(eth))}`;

const ARCS = {
  junta: (x) => [[x.y(1790, 1830), `In the lands of ${x.name}, scattered principalities united into a single army around ${x.cap}.`], [x.y(1845, 1870), `An officers' school opened in ${x.cap}; most civil servants began to be drawn from the army.`], [x.y(1872, 1888), `The civilian government under ${x.past1} failed to pay soldiers' wages for two years.`], [x.y(1889, 1896), `The garrisons rose up, ${x.past1} fled the country and parliament was shut down.`]],
  merchant: (x) => [[x.y(1700, 1760), `Merchant guilds founded in the port of ${x.cap} launched their first joint fleets.`], [x.y(1775, 1820), `The guilds liquidated noble rule with the debt notes they had bought up.`], [x.y(1830, 1865), `The bank of the ${x.past1} family became the state's largest creditor.`], [x.y(1870, 1895), `The vote was limited to those above a certain wealth; a dockers' strike was broken by the army.`]],
  monarchy: (x) => [[x.y(1610, 1680), `The ${x.past1} dynasty took the throne of ${x.cap}.`], [x.y(1720, 1790), `${x.past2} issued the great edict that distributed land to the nobles.`], [x.y(1820, 1860), `Students demanding a constitution were shot in the capital, and the edict was reaffirmed.`], [x.y(1875, 1895), `A succession crisis between two cousins lasted nine months.`]],
  republic: (x) => [[x.y(1790, 1840), `The constituent assembly convened in ${x.cap} abolished the monarchy.`], [x.y(1845, 1870), `Universal male suffrage was granted and the first party lists entered elections.`], [x.y(1872, 1888), `The government of ${x.past1} fell over a railway bribery case.`], [x.y(1889, 1897), `Trade unions were legalized; the law passed parliament by one vote.`]],
  revolutionary: (x) => [[x.y(1800, 1850), `In the lands of ${x.name}, the absolute rule of the landlords continued.`], [x.y(1855, 1875), `The first peasant uprising, led by ${x.past1}, was put down and its leaders hanged.`], [x.y(1880, 1892), `Factory workers and peasant unions set up a revolutionary committee in ${x.cap}.`], [x.y(1893, 1898), `The old order was overthrown; land and large factories were seized and church property was expropriated.`]],
  agrarian: (x) => [[x.y(1650, 1740), `The landlord families around ${x.cap} began the custom of choosing a ruler from among themselves.`], [x.y(1770, 1830), `Irrigation canals were placed under the landlords' control and peasants were bound to the land.`], [x.y(1840, 1875), `${x.past1} took the first loan from foreign banks, pledging customs revenue in return.`], [x.y(1880, 1896), `Tax collection in the provinces was handed over to the landlords.`]],
  federation: (x) => [[x.y(1760, 1810), `Independent provinces formed a customs union by the ${x.cap} agreement.`], [x.y(1820, 1860), `A proposal for a federal army was rejected three times in the provincial assemblies.`], [x.y(1865, 1885), `${x.past1} won the provinces' right of secession before the High Court.`], [x.y(1888, 1897), `The railway network was laid with different track gauges at provincial borders.`]],
  theocracy: (x) => [[x.y(1500, 1650), `The first temple of the ${x.faith} faith was founded in ${x.cap}.`], [x.y(1680, 1760), `An assembly of clergy assumed religious oversight of the laws.`], [x.y(1800, 1850), `${x.past1} had the doctrine rewritten, and the dissenting sect was sent into exile.`], [x.y(1870, 1896), `An attempt to open secular schools was stopped by a ruling of the high office.`]]
};
const MYTHS = ['It is believed to have been founded where the founders arrived after marching three days and nights.', 'On the national holiday, every household shares bread made from the first harvest.', 'Schools teach the epic of the tailors who defended the city in an old siege.', 'The colors of its flag commemorate an old river war.', 'A folk legend tells of the return of dead rulers.',
  'Every child learns the names of the seven who refused to open the gate.', 'The oldest song of the country is a lament for a fleet that did not come home.', 'Its people say the land was won from the marsh, dyke by dyke, by a vow nobody remembers making.', 'A bell that was hidden from an invader is said to ring by itself before a war.', 'The founding is dated from a winter when the passes closed and the garrison ate its horses.',
  'It is told that the first ruler was chosen because his plough turned up a sword.', 'The country counts its years from a plague that the capital alone was spared.', 'Shepherds are said to have carried the old charter over the mountains sewn into a coat.', 'A saint of the country is honoured for burning the tax rolls.', 'The great river is said to have changed its bed on the night the old kingdom fell.', 'Every town keeps the stone on which its men were counted for the first levy.'];
const CUSTOMS = ['Lamps are lit for forty days for the dead.', 'Marriage contracts are read out in the village square.', 'Every young person works a year with another family.', 'Debts are counted in public at the end of the harvest.', 'A meeting does not begin until the elders have spoken.',
  'No bargain is held to bind until bread has been broken over it.', 'A guest may not be asked his business before the third day.', 'Land is never sold out of a village without the consent of its neighbours.', 'The eldest daughter inherits the house and the eldest son the debts.', 'On one day in the year masters wait on their servants at table.',
  'Feuds are closed by fostering a child of the other house.', 'An oath sworn on the threshold stone cannot be released by a priest.', 'The dead are carried round the bounds of the parish before burial.', 'Nobody may be arrested between the first and the last sheaf of the harvest.', 'Every trade keeps a chest from which its widows are paid.', 'A man who has not planted a tree may not speak in the village meeting.'];
// A legend and a custom belong to one country: within a world none is told of two.
const unused = (r, list, taken) => { const free = list.filter(x => !taken.has(x)), pick = pickOf(r, free.length ? free : list); taken.add(pick); return pick; };
const LANGUAGE_END = [' tongue', ' speech', ' dialect', ' vernacular'];

export function writeChronicles(w) {
  const told = new Set();
  for (const c of aliveCountries(w)) {
    const r = seeded(`${c.id}|${c.name}`), provs = countryProvinces(w, c.id), root = c.rootName ?? c.name.split(' ')[0];
    const x = { name: c.rootName ?? c.name, cap: w.provinces[c.capital]?.name ?? root, faith: c.majorityRel, y: (a, b) => between(r, a, b), past1: person(r, c.majorityEth, c.majorityRel), past2: person(r, c.majorityEth, c.majorityRel) };
    const minorities = [...new Set(provs.filter(p => p.eth !== c.majorityEth).map(p => p.eth))], faiths = [...new Set(provs.filter(p => p.rel !== c.majorityRel).map(p => p.rel))];
    const deposits = [...new Set(provs.flatMap(p => Object.entries(p.deposits).filter(([, d]) => d.known && d.mine > 0).map(([k]) => GOOD_LABEL[k])))];
    const events = (ARCS[c.archetype] ?? ARCS.republic)(x).map(([year, text]) => ({ year, text }));
    events.push({ year: x.y(1850, 1890), text: deposits.length ? `${deposits.slice(0, 3).join(', ')} pits were opened; miners migrated from the coastal and plains provinces.` : 'No major mine was found; the country had to buy its fuel and metal abroad.' });
    // What the past says of the peoples and faiths of the country is what its law says today: the policy and the disabilities it was handed over with.
    const barred = k => Object.entries(c.status || {}).filter(([, s]) => s[k] === false).map(([name]) => name), taxed = Object.entries(c.status || {}).filter(([, s]) => s.levy > 0).map(([name]) => name);
    if (minorities.length) events.push({ year: x.y(1860, 1897), text: c.languagePolicy === 'assimilate' ? `The ${minorities.join(', ')} provinces were required to use ${c.majorityEth} as the school language.` : c.languagePolicy === 'autonomy' ? `The ${minorities.join(', ')} provinces were confirmed in their own schools, courts and tongue by the union's charter.` : `A school law let the ${minorities.join(', ')} provinces teach in their own tongue beside ${c.majorityEth}.` });
    if (barred('arms').length) events.push({ year: x.y(1875, 1897), text: `After a rising on the frontier the ${barred('arms').join(', ')} were struck off the army rolls and forbidden to keep arms.` });
    if (barred('office').length) events.push({ year: x.y(1840, 1897), text: `${barred('office').map(n => faiths.includes(n) ? `Followers of ${n}` : `The ${n}`).join(' and ')} were barred from the civil service${taxed.length ? `, and a yearly levy was laid on ${taxed.map(n => faiths.includes(n) ? `followers of ${n}` : `the ${n}`).join(' and ')}` : ''}.` });
    else if (faiths.length) events.push({ year: x.y(1840, 1897), text: c.faithPolicy === 'secular' ? `The schools and the registers were taken from every church alike; followers of ${faiths.join(', ')} stand before the law as everyone else.` : `The civil service was opened to followers of ${faiths.join(', ')}.` });
    c.chronicle = events.sort((a, b) => a.year - b.year);
    c.culture = { language: `${root}${pickOf(r, LANGUAGE_END)}`, majority: c.majorityEth, faith: c.majorityRel, myth: unused(r, MYTHS, told), custom: unused(r, CUSTOMS, told), minorities, faiths };
  }
  w.lifeReady = true;
}

const PARENTS = { leader: ['a provincial clerk', 'a smallholder', 'an officer', 'a judge'], general: ['a village sergeant', 'an officer', 'a blacksmith', 'a cavalry farmer'], opposition: ['a printer', 'a schoolteacher', 'a factory foreman', 'a village preacher'], oligarch: ['a grain merchant', 'a shipowner', 'a mine foreman', 'a moneychanger'] };
const SCHOOL = { general: 'the war college', opposition: 'teachers\' college', oligarch: 'commercial school' };
// A ruler's schooling and career follow the kind of state that produced them.
const RULER_PATH = {
  junta: { school: ['the war college', 'the cavalry academy', 'the artillery school'], career: [p => `Commanded the ${p} garrison.`, () => 'Served as chief of staff of an army corps.', p => `Put down a mutiny at ${p}.`] },
  merchant: { school: ['commercial school', 'a shipping house as an apprentice', 'a banking house as a clerk'], career: [p => `Ran a trading house in ${p}.`, () => 'Chaired the merchants\' guild for six years.', p => `Financed the harbour works at ${p}.`] },
  monarchy: { school: ['the court school under private tutors', 'the royal cadet corps', 'the palace seminary'], career: [p => `Held ${p} as a royal fief.`, () => 'Commanded a regiment of the royal guard.', () => 'Served as a chamberlain at court.'] },
  republic: { school: ['law school', 'medical school', 'the engineering college', 'teachers\' college'], career: [p => `Served as mayor of ${p}.`, () => 'Sat in parliament for twelve years.', () => 'Served as a minister in two cabinets.'] },
  revolutionary: { school: ['night classes at a factory school', 'a seminary, leaving before ordination', 'a printing shop as an apprentice'], career: [p => `Organized the party cell in ${p}.`, () => 'Spent six years in the old regime\'s prisons.', p => `Led the strike committee at ${p}.`] },
  agrarian: { school: ['a village school', 'private tutors on the family estate', 'a provincial seminary'], career: [p => `Managed large estates around ${p}.`, () => 'Arbitrated land disputes among the great families.', p => `Raised a private levy in ${p}.`] },
  federation: { school: ['law school', 'the engineering college', 'commercial school'], career: [p => `Served as governor of ${p}.`, () => 'Sat on the federal railway commission.', p => `Represented ${p} in the federal assembly.`] },
  theocracy: { school: ['the great seminary', 'a monastery school', 'the school of sacred law'], career: [p => `Served as high priest of ${p}.`, () => 'Sat on the council of doctrine for a decade.', p => `Ran the charitable foundations of ${p}.`] }
};
const CAREER = {
  leader: [p => `Became deputy governor of ${p}.`, p => `Served as mayor of ${p}.`, () => 'Served ten years as an undersecretary in a ministry.'],
  general: [p => `Became a company commander at the ${p} garrison.`, () => 'Taught at the artillery school.', p => `Served as a staff officer on the ${p} border.`],
  opposition: [p => `Published a newspaper in ${p} that was shut down twice.`, p => `Founded village schools in ${p}.`, () => 'Represented strikers as a lawyer in court.'],
  oligarch: [p => `Rented a first warehouse in the port of ${p}.`, p => `Became a partner in the ${p} mine.`, () => 'Won a state grain supply tender.']
};
const FAMILY = ['Widowed, with two children.', 'Married with four children; the eldest is in the army.', 'Never married.', 'Their spouse comes from a leading family of another province.', 'Their only child is studying abroad.', 'Lost a child to an epidemic.'];

export function writeLife(w, ch) {
  const c = w.countries[ch.country]; if (!c) return;
  const r = seeded(`${ch.id}|${ch.name}`), provs = countryProvinces(w, c.id); if (!provs.length) return;
  const now = 1900 + Math.floor(w.turn / 4), born = now - ch.age, home = pickOf(r, provs), role = ch.role in PARENTS ? ch.role : 'leader', parent = pickOf(r, PARENTS[role]);
  const year = age => born + age, life = [];
  life.push({ year: born, text: `Born in ${home.name}, the child of ${parent}.` });
  const ruler = role === 'leader' ? RULER_PATH[c.archetype] : null;
  life.push({ year: year(between(r, 17, 23)), text: `Educated at ${ruler ? pickOf(r, ruler.school) : role === 'leader' ? 'law school' : SCHOOL[role]}.` });
  life.push({ year: year(between(r, 26, Math.max(27, ch.age - 8))), text: pickOf(r, ruler?.career ?? CAREER[role])(pickOf(r, provs).name) });
  const shared = [...(w.past || []).filter(e => e.countries.includes(c.id)), ...(c.chronicle || [])].filter(e => e.year >= born + 16 && e.year <= now);
  if (shared.length) { const e = pickOf(r, shared); life.push({ year: e.year, text: `At age ${e.year - born}, this happened in the country: ${e.text}` }); }
  const peers = Object.values(w.characters).filter(o => o.id !== ch.id && o.country === c.id && o.alive);
  if (peers.length) {
    const other = pickOf(r, peers), y = Math.min(now - 1, year(between(r, 30, Math.max(31, ch.age - 2))));
    life.push({ year: y, text: pickOf(r, [`Faced ${other.name} in a court case; the case ended in favor of ${r() < .5 ? ch.name : other.name}.`, `Served on the same commission as ${other.name}.`, `${other.name} put up an important bond for ${ch.name}.`, `${other.name} blocked one of their appointments at the last moment.`]) });
  }
  if (home.eth !== c.majorityEth) ch.name = personName(home.eth, home.rel, ch.id);
  ch.origin = { birthplace: home.name, born, eth: home.eth, rel: home.rel, family: pickOf(r, FAMILY) };
  ch.life = life.sort((a, b) => a.year - b.year);
}

export function writeLives(w) { for (const ch of Object.values(w.characters)) if (ch.alive) writeLife(w, ch); }
