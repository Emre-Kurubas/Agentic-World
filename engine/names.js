// Names follow culture and faith, so a Tolgar general and a Ispari merchant do not sound alike.
export const ETHNICITIES = ['Varenic', 'Tolgar', 'Sumerite', 'Hazen', 'Ordalian', 'Keltish', 'Marun', 'Ispari'];
export const FAITHS = ['Path of the Sun', 'Old Hearth', 'Church of the One', 'Way of the Ancestors', 'Silent Order'];

const CULTURES = {
  Varenic: { first: ['Milos', 'Darya', 'Radomir', 'Vesna', 'Dragan', 'Yelena', 'Bogdan', 'Mirela', 'Stanko', 'Zorya', 'Vuk', 'Ludmila'], last: ['Vetrov', 'Karadin', 'Dobrev', 'Volkan', 'Zoric', 'Morav', 'Sokolin', 'Belov'], root: ['Var', 'Dra', 'Vel', 'Mor', 'Zor', 'Bel'], end: ['enia', 'ovia', 'avia', 'ograd', 'ania'] },
  Tolgar: { first: ['Temur', 'Aysu', 'Batur', 'Ilkay', 'Orhan', 'Tomris', 'Kaya', 'Sevda', 'Alpar', 'Nilay', 'Bozkurt', 'Gokce'], last: ['Karabey', 'Tolgan', 'Aksoy', 'Demirhan', 'Yildar', 'Ozkan', 'Sarikan', 'Korkmaz'], root: ['Tol', 'Kar', 'Ak', 'Ord', 'Tem', 'Sar'], end: ['gar', 'istan', 'han', 'ulia', 'dar'] },
  Sumerite: { first: ['Naram', 'Ishara', 'Belshar', 'Ninsun', 'Adad', 'Tiamis', 'Hadar', 'Kubaba', 'Zimri', 'Ashur', 'Ennana', 'Rimush'], last: ['Ur-Nanna', 'Belsaran', 'Kishar', 'Shamash', 'Ninurta', 'Larsan', 'Eridan', 'Mardukan'], root: ['Sum', 'Lar', 'Nin', 'Bab', 'Kish', 'Ur'], end: ['era', 'esh', 'ukar', 'atum', 'ana'] },
  Hazen: { first: ['Konrad', 'Helga', 'Ulrich', 'Greta', 'Dietmar', 'Ilse', 'Rainer', 'Hilde', 'Otto', 'Sieglind', 'Bruno', 'Marta'], last: ['Brandt', 'Hazemann', 'Vogelsang', 'Reinhart', 'Steinau', 'Kessler', 'Falken', 'Ostwald'], root: ['Haz', 'Stein', 'Wald', 'Falk', 'Ros', 'Brun'], end: ['enya', 'mark', 'heim', 'land', 'burg'] },
  Ordalian: { first: ['Lucan', 'Serena', 'Valerio', 'Aurelia', 'Marcello', 'Livia', 'Dario', 'Fiora', 'Silvano', 'Ottavia', 'Renzo', 'Camilla'], last: ['Valmora', 'Ordani', 'Castellan', 'Marchetti', 'Solari', 'Bellini', 'Ferrano', 'Tessaro'], root: ['Ord', 'Val', 'Cas', 'Sol', 'Mar', 'Ter'], end: ['alia', 'ona', 'ento', 'ara', 'eria'] },
  Keltish: { first: ['Bran', 'Maeve', 'Cormac', 'Niamh', 'Fergal', 'Sorcha', 'Tadhg', 'Eithne', 'Lorcan', 'Deirdre', 'Oisin', 'Grainne'], last: ['Corvane', 'MacArdan', 'Kelvane', 'OBrannach', 'Tiernan', 'Dunmore', 'Glenarven', 'Ronan'], root: ['Kel', 'Dun', 'Glen', 'Bran', 'Tir', 'Cor'], end: ['timar', 'more', 'wyn', 'ara', 'dale'] },
  Marun: { first: ['Darian', 'Soraya', 'Rostam', 'Parisa', 'Kaveh', 'Shirin', 'Bahram', 'Yasmin', 'Farhad', 'Roxane', 'Jamshid', 'Laleh'], last: ['Azhar', 'Maruni', 'Sohrabi', 'Kamran', 'Daryush', 'Golzar', 'Tahmaz', 'Parvan'], root: ['Mar', 'Dar', 'Sohr', 'Kam', 'Gol', 'Par'], end: ['unya', 'estan', 'abad', 'iran', 'oz'] },
  Ispari: { first: ['Teodor', 'Ines', 'Alonso', 'Xenia', 'Nikos', 'Calista', 'Rodrigo', 'Elena', 'Stavros', 'Mencia', 'Vasco', 'Thalia'], last: ['Kastoros', 'Isparides', 'Montalvo', 'Andrakis', 'Sarmiento', 'Palaios', 'Cordero', 'Vassilis'], root: ['Isp', 'Kas', 'And', 'Mon', 'Pal', 'Cor'], end: ['aria', 'os', 'alia', 'eia', 'ona'] }
};
const FAITH_NAMES = {
  'Path of the Sun': ['Solan', 'Aurin', 'Heliane', 'Dawnel'],
  'Old Hearth': ['Hearthan', 'Emberly', 'Ashlin', 'Cindric'],
  'Church of the One': ['Benedict', 'Maria', 'Tobias', 'Agnes'],
  'Way of the Ancestors': ['Elder', 'Sagan', 'Yorath', 'Mirren'],
  'Silent Order': ['Quill', 'Tacita', 'Hush', 'Sileas']
};

const cultureOf = eth => CULTURES[eth] ?? CULTURES.Varenic;
export const givenNames = (eth, rel) => { const c = cultureOf(eth), f = FAITH_NAMES[rel]; return f ? [...c.first, ...c.first, ...f] : c.first; };
export const familyNames = eth => cultureOf(eth).last;

export function hashOf(key) { let h = 2166136261; for (const ch of String(key)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; }
const at = (list, n) => list[n % list.length];

// Place and country names do not consume the world's random stream, so renaming never changes the simulation.
export function placeName(eth, key) { const c = cultureOf(eth), h = hashOf(key), base = `${at(c.root, h)}${at(c.end, h >>> 8)}`, tail = at(['', '', 'a', 'on', 'ir'], h >>> 16); return /[aeiou]$/.test(base) && /^[aeiou]/.test(tail) ? base : `${base}${tail}`; }
export function countryRoot(eth, key) { const c = cultureOf(eth), h = hashOf(key); return `${at(c.root, h)}${at(c.end, h >>> 8)}`; }
export function personName(eth, rel, key) { const h = hashOf(key); return `${at(givenNames(eth, rel), h)} ${at(familyNames(eth), h >>> 11)}`; }
