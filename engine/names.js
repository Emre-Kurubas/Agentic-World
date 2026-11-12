// Names follow culture and faith, so a Tolgar general and a Ispari merchant do not sound alike.
export const ETHNICITIES = ['Varenic', 'Tolgar', 'Sumerite', 'Hazen', 'Ordalian', 'Keltish', 'Marun', 'Ispari'];
export const FAITHS = ['Path of the Sun', 'Old Hearth', 'Church of the One', 'Way of the Ancestors', 'Silent Order'];

// Twenty given names and twenty family names to a people. (With eight family names, three of the four seats of one state could share a name by
// chance: in world 16 a president took his treasurer for kin because both were Brandts, a prince could not tell two Gokces apart, and a woman
// jailed in one state was taken for the chief of staff of another.)
const CULTURES = {
  Varenic: { first: ['Milos', 'Darya', 'Radomir', 'Vesna', 'Dragan', 'Yelena', 'Bogdan', 'Mirela', 'Stanko', 'Zorya', 'Vuk', 'Ludmila', 'Zdravko', 'Milena', 'Goran', 'Vesela', 'Boris', 'Tatyana', 'Lazar', 'Snezana'], last: ['Vetrov', 'Karadin', 'Dobrev', 'Volkan', 'Zoric', 'Morav', 'Sokolin', 'Belov', 'Dragovic', 'Petran', 'Stoyanov', 'Milovan', 'Kostic', 'Radulov', 'Novak', 'Zelenko', 'Bratimir', 'Vukan', 'Jarovic', 'Orlov'], root: ['Var', 'Dra', 'Vel', 'Mor', 'Zor', 'Bel'], end: ['enia', 'ovia', 'avia', 'ograd', 'ania'] },
  Tolgar: { first: ['Temur', 'Aysu', 'Batur', 'Ilkay', 'Orhan', 'Tomris', 'Kaya', 'Sevda', 'Alpar', 'Nilay', 'Bozkurt', 'Gokce', 'Kutlu', 'Aylin', 'Tarkan', 'Selcen', 'Erdem', 'Bengu', 'Altan', 'Sibel'], last: ['Karabey', 'Tolgan', 'Aksoy', 'Demirhan', 'Yildar', 'Ozkan', 'Sarikan', 'Korkmaz', 'Bayrak', 'Erdemli', 'Turan', 'Kocak', 'Aydar', 'Selcuk', 'Tekin', 'Ulgen', 'Baskan', 'Cakir', 'Dogan', 'Yaman'], root: ['Tol', 'Kar', 'Ak', 'Ord', 'Tem', 'Sar'], end: ['gar', 'istan', 'han', 'ulia', 'dar'] },
  Sumerite: { first: ['Naram', 'Ishara', 'Belshar', 'Ninsun', 'Adad', 'Tiamis', 'Hadar', 'Kubaba', 'Zimri', 'Ashur', 'Ennana', 'Rimush', 'Sargon', 'Nidaba', 'Enlil', 'Shala', 'Gudea', 'Ninlil', 'Lugal', 'Ishtara'], last: ['Ur-Nanna', 'Belsaran', 'Kishar', 'Shamash', 'Ninurta', 'Larsan', 'Eridan', 'Mardukan', 'Lagashan', 'Nippuran', 'Akkadon', 'Sippar', 'Uruk-Sin', 'Elamar', 'Girsun', 'Dilbat', 'Ashnan', 'Kutha', 'Isinar', 'Tukulti'], root: ['Sum', 'Lar', 'Nin', 'Bab', 'Kish', 'Ur'], end: ['era', 'esh', 'ukar', 'atum', 'ana'] },
  Hazen: { first: ['Konrad', 'Helga', 'Ulrich', 'Greta', 'Dietmar', 'Ilse', 'Rainer', 'Hilde', 'Otto', 'Sieglind', 'Bruno', 'Marta', 'Albrecht', 'Gerda', 'Wilhelm', 'Liesel', 'Friedrich', 'Anneliese', 'Gunther', 'Elke'], last: ['Brandt', 'Hazemann', 'Vogelsang', 'Reinhart', 'Steinau', 'Kessler', 'Falken', 'Ostwald', 'Hessel', 'Lindner', 'Waldau', 'Krauss', 'Altdorf', 'Brenner', 'Eichhorn', 'Sturm', 'Zellner', 'Rothe', 'Adler', 'Winkler'], root: ['Haz', 'Stein', 'Wald', 'Falk', 'Ros', 'Brun'], end: ['enya', 'mark', 'heim', 'land', 'burg'] },
  Ordalian: { first: ['Lucan', 'Serena', 'Valerio', 'Aurelia', 'Marcello', 'Livia', 'Dario', 'Fiora', 'Silvano', 'Ottavia', 'Renzo', 'Camilla', 'Cesare', 'Bianca', 'Enzo', 'Giulia', 'Vittorio', 'Lucia', 'Matteo', 'Rosalba'], last: ['Valmora', 'Ordani', 'Castellan', 'Marchetti', 'Solari', 'Bellini', 'Ferrano', 'Tessaro', 'Corvino', 'Albano', 'Dellarosa', 'Montefiore', 'Ravelli', 'Santoro', 'Vescari', 'Lombari', 'Galliano', 'Farnelli', 'Orsolo', 'Pietrasanta'], root: ['Ord', 'Val', 'Cas', 'Sol', 'Mar', 'Ter'], end: ['alia', 'ona', 'ento', 'ara', 'eria'] },
  Keltish: { first: ['Bran', 'Maeve', 'Cormac', 'Niamh', 'Fergal', 'Sorcha', 'Tadhg', 'Eithne', 'Lorcan', 'Deirdre', 'Oisin', 'Grainne', 'Declan', 'Aoife', 'Ruairi', 'Brigid', 'Cathal', 'Sinead', 'Eamon', 'Fionnuala'], last: ['Corvane', 'MacArdan', 'Kelvane', 'OBrannach', 'Tiernan', 'Dunmore', 'Glenarven', 'Ronan', 'Glennie', 'Ferriter', 'Dunleavy', 'Kinsella', 'Mulcahy', 'Brennagh', 'Carrow', 'Lochlann', 'Ardagh', 'Tully', 'Finnerty', 'Doolan'], root: ['Kel', 'Dun', 'Glen', 'Bran', 'Tir', 'Cor'], end: ['timar', 'more', 'wyn', 'ara', 'dale'] },
  Marun: { first: ['Darian', 'Soraya', 'Rostam', 'Parisa', 'Kaveh', 'Shirin', 'Bahram', 'Yasmin', 'Farhad', 'Roxane', 'Jamshid', 'Laleh', 'Arash', 'Mahin', 'Behrouz', 'Nasrin', 'Kourosh', 'Golnar', 'Siavash', 'Azadeh'], last: ['Azhar', 'Maruni', 'Sohrabi', 'Kamran', 'Daryush', 'Golzar', 'Tahmaz', 'Parvan', 'Nadiri', 'Tahir', 'Farrokh', 'Shiravan', 'Behzadi', 'Rostami', 'Zarrin', 'Hormoz', 'Mehran', 'Sepehr', 'Jahangir', 'Ardalan'], root: ['Mar', 'Dar', 'Sohr', 'Kam', 'Gol', 'Par'], end: ['unya', 'estan', 'abad', 'iran', 'oz'] },
  Ispari: { first: ['Teodor', 'Ines', 'Alonso', 'Xenia', 'Nikos', 'Calista', 'Rodrigo', 'Elena', 'Stavros', 'Mencia', 'Vasco', 'Thalia', 'Marco', 'Dafne', 'Leandro', 'Irene', 'Dimitri', 'Olalla', 'Cristo', 'Zoe'], last: ['Kastoros', 'Isparides', 'Montalvo', 'Andrakis', 'Sarmiento', 'Palaios', 'Cordero', 'Vassilis', 'Kastelis', 'Navarro', 'Demetrios', 'Soler', 'Maragall', 'Lykos', 'Vidal', 'Theron', 'Arvanitis', 'Belmonte', 'Caldera', 'Petrakis'], root: ['Isp', 'Kas', 'And', 'Mon', 'Pal', 'Cor'], end: ['aria', 'os', 'alia', 'eia', 'ona'] }
};
const FAITH_NAMES = {
  'Path of the Sun': ['Solan', 'Aurin', 'Heliane', 'Dawnel'],
  'Old Hearth': ['Hearthan', 'Emberly', 'Ashlin', 'Cindric'],
  'Church of the One': ['Benedict', 'Maria', 'Tobias', 'Agnes'],
  'Way of the Ancestors': ['Elder', 'Sagan', 'Yorath', 'Mirren'],
  'Silent Order': ['Quill', 'Tacita', 'Hush', 'Sileas']
};
// Which given names are women's. A person is a man or a woman as the name says, so that those who write of them, the engine among them, need not guess.
const WOMEN = new Set(['Darya', 'Vesna', 'Yelena', 'Mirela', 'Zorya', 'Ludmila', 'Milena', 'Vesela', 'Tatyana', 'Snezana', 'Aysu', 'Ilkay', 'Tomris', 'Sevda', 'Nilay', 'Gokce', 'Aylin', 'Selcen', 'Bengu', 'Sibel', 'Ishara', 'Ninsun', 'Tiamis', 'Kubaba', 'Ennana', 'Nidaba', 'Shala', 'Ninlil', 'Ishtara',
  'Helga', 'Greta', 'Ilse', 'Hilde', 'Sieglind', 'Marta', 'Gerda', 'Liesel', 'Anneliese', 'Elke', 'Serena', 'Aurelia', 'Livia', 'Fiora', 'Ottavia', 'Camilla', 'Bianca', 'Giulia', 'Lucia', 'Rosalba', 'Maeve', 'Niamh', 'Sorcha', 'Eithne', 'Deirdre', 'Grainne', 'Aoife', 'Brigid', 'Sinead', 'Fionnuala',
  'Soraya', 'Parisa', 'Shirin', 'Yasmin', 'Roxane', 'Laleh', 'Mahin', 'Nasrin', 'Golnar', 'Azadeh', 'Ines', 'Xenia', 'Calista', 'Elena', 'Mencia', 'Thalia', 'Dafne', 'Irene', 'Olalla', 'Zoe', 'Aurin', 'Heliane', 'Emberly', 'Ashlin', 'Maria', 'Agnes', 'Mirren', 'Tacita', 'Sileas']);
export const sexOf = name => WOMEN.has(String(name ?? '').split(' ')[0]) ? 'f' : 'm';
// The words for a person, by what they are (a record made before people had a sex is read from the name).
const isWoman = ch => (ch?.sex ?? sexOf(ch?.name)) === 'f';
export const he = ch => isWoman(ch) ? 'she' : 'he', him = ch => isWoman(ch) ? 'her' : 'him', his = ch => isWoman(ch) ? 'her' : 'his', himself = ch => isWoman(ch) ? 'herself' : 'himself';
export const He = ch => isWoman(ch) ? 'She' : 'He', His = ch => isWoman(ch) ? 'Her' : 'His';

const cultureOf = eth => CULTURES[eth] ?? CULTURES.Varenic;
export const givenNames = (eth, rel) => { const c = cultureOf(eth), f = FAITH_NAMES[rel]; return f ? [...c.first, ...c.first, ...f] : c.first; };
export const familyNames = eth => cultureOf(eth).last;
// A family name that nobody of note in the country bears yet, starting from the one that was drawn: so that people who share a name are, as a
// rule, kin who were given it on purpose.
export const freeFamily = (eth, drawn, taken) => { const list = familyNames(eth), at0 = Math.max(0, list.indexOf(drawn)); for (let i = 0; i < list.length; i++) { const x = list[(at0 + i) % list.length]; if (!taken.has(x)) return x; } return drawn; };

export function hashOf(key) { let h = 2166136261; for (const ch of String(key)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; }
const at = (list, n) => list[n % list.length];

// Place and country names do not consume the world's random stream, so renaming never changes the simulation.
export function placeName(eth, key) { const c = cultureOf(eth), h = hashOf(key), base = `${at(c.root, h)}${at(c.end, h >>> 8)}`, tail = at(['', '', 'a', 'on', 'ir'], h >>> 16); return /[aeiou]$/.test(base) && /^[aeiou]/.test(tail) ? base : `${base}${tail}`; }
export function countryRoot(eth, key) { const c = cultureOf(eth), h = hashOf(key); return `${at(c.root, h)}${at(c.end, h >>> 8)}`; }
export function personName(eth, rel, key) { const h = hashOf(key); return `${at(givenNames(eth, rel), h)} ${at(familyNames(eth), h >>> 11)}`; }
