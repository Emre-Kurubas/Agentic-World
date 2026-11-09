// Ülke kronikleri ve karakter hayatları. Yalnızca olay yazılır; kimin ne hissedeceği yazılmaz.
// Yerel rastgelelik kullanır, dünya üretimini ve motoru etkilemez.
import { countryProvinces, aliveCountries, GOOD_TR } from './world.js';
import { givenNames, familyNames, personName } from './names.js';

function seeded(key) {
  let h = 2166136261; for (const ch of key) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return () => { h = (h + 0x6D2B79F5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pickOf = (r, list) => list[Math.floor(r() * list.length)];
const between = (r, a, b) => a + Math.floor(r() * (b - a + 1));
const person = (r, eth, rel) => `${pickOf(r, givenNames(eth, rel))} ${pickOf(r, familyNames(eth))}`;

const ARCS = {
  cunta: (x) => [[x.y(1790, 1830), `${x.name} topraklarında dağınık beylikler ${x.cap} çevresinde tek orduda birleşti.`], [x.y(1845, 1870), `Subay okulu ${x.cap} kentinde açıldı; devlet memurlarının çoğu ordudan alınmaya başlandı.`], [x.y(1872, 1888), `${x.past1} yönetimindeki sivil hükümet asker maaşlarını iki yıl ödemedi.`], [x.y(1889, 1896), `Garnizonlar ayaklandı, ${x.past1} ülkeyi terk etti ve meclis kapatıldı.`]],
  tacir: (x) => [[x.y(1700, 1760), `${x.cap} limanında kurulan tacir loncaları ilk ortak filolarını denize indirdi.`], [x.y(1775, 1820), `Loncalar soylu yönetimi satın aldıkları borç senetleriyle tasfiye etti.`], [x.y(1830, 1865), `${x.past1} ailesinin bankası devletin en büyük alacaklısı oldu.`], [x.y(1870, 1895), `Oy hakkı belirli bir servetin üzerindekilerle sınırlandırıldı; liman işçilerinin grevi askerle dağıtıldı.`]],
  monarsi: (x) => [[x.y(1610, 1680), `${x.past1} hanedanı ${x.cap} tahtına oturdu.`], [x.y(1720, 1790), `${x.past2} toprakları soylulara dağıtan büyük fermanı yayımladı.`], [x.y(1820, 1860), `Başkentte anayasa isteyen öğrenciler kurşuna dizildi, ferman yeniden onaylandı.`], [x.y(1875, 1895), `Taht için iki kuzen arasında dokuz ay süren veraset krizi yaşandı.`]],
  cumhuriyet: (x) => [[x.y(1790, 1840), `${x.cap} kentinde toplanan kurucu meclis krallığı kaldırdı.`], [x.y(1845, 1870), `Genel oy hakkı erkeklere tanındı, ilk parti listeleri seçime girdi.`], [x.y(1872, 1888), `${x.past1} hükümeti demiryolu rüşvet davası yüzünden düştü.`], [x.y(1889, 1897), `Sendikalar yasal tanındı; bu yasa meclisten tek oy farkla geçti.`]],
  devrim: (x) => [[x.y(1800, 1850), `${x.name} topraklarında toprak ağalarının mutlak yönetimi sürüyordu.`], [x.y(1855, 1875), `${x.past1} önderliğindeki ilk köylü ayaklanması bastırıldı, önderleri asıldı.`], [x.y(1880, 1892), `Fabrika işçileri ve köylü birlikleri ${x.cap} kentinde devrim komitesi kurdu.`], [x.y(1893, 1898), `Eski yönetim devrildi; topraklara ve büyük fabrikalara el kondu, kilise mülkleri kamulaştırıldı.`]],
  tarim: (x) => [[x.y(1650, 1740), `${x.cap} çevresindeki ağa aileleri kendi aralarından bir hükümdar seçme geleneği başlattı.`], [x.y(1770, 1830), `Sulama kanalları ağaların denetimine verildi, köylüler toprağa bağlandı.`], [x.y(1840, 1875), `${x.past1} yabancı bankalardan ilk borcu aldı; karşılığında gümrük gelirleri rehin verildi.`], [x.y(1880, 1896), `Vergi tahsilatı eyaletlerde ağalara devredildi.`]],
  federasyon: (x) => [[x.y(1760, 1810), `Birbirinden bağımsız eyaletler ${x.cap} anlaşmasıyla gümrük birliği kurdu.`], [x.y(1820, 1860), `Federal ordu kurma önerisi eyalet meclislerinde üç kez reddedildi.`], [x.y(1865, 1885), `${x.past1} eyaletlerin ayrılma hakkını Yüksek Divan önünde kazandı.`], [x.y(1888, 1897), `Demiryolu ağı eyalet sınırlarında farklı ray genişlikleriyle döşendi.`]],
  teokrasi: (x) => [[x.y(1500, 1650), `${x.faith} inancının ilk tapınağı ${x.cap} kentinde kuruldu.`], [x.y(1680, 1760), `Din adamları meclisi yasaların dinî denetimini üstlendi.`], [x.y(1800, 1850), `${x.past1} öğretiyi yeniden yazdırdı, karşı çıkan mezhep sürgüne gönderildi.`], [x.y(1870, 1896), `Laik okul açma girişimi yüce makamın fetvasıyla durduruldu.`]]
};
const MYTHS = ['Kurucuların üç gün üç gece yürüyerek ulaştığı yerde kurulduğuna inanılır.', 'Ulusal bayramda her evde ilk hasattan yapılan ekmek bölüşülür.', 'Okullarda eski bir kuşatmada şehri savunan terzilerin destanı okutulur.', 'Bayrağındaki renkler eski bir nehir savaşının anısını taşır.', 'Halk arasında ölü hükümdarların dönüşüne dair bir söylence anlatılır.'];
const CUSTOMS = ['Ölüler için kırk gün lamba yakılır.', 'Evlilik sözleşmeleri köy meydanında okunur.', 'Her genç bir yıl başka bir ailenin yanında çalışır.', 'Hasat sonunda borçlar halka açık sayılır.', 'Yaşlılar konuşmadan toplantı başlamaz.'];
const LANGUAGE_END = ['ca', 'ce', 'ça', 'çe'];

export function writeChronicles(w) {
  for (const c of aliveCountries(w)) {
    const r = seeded(`${c.id}|${c.name}`), provs = countryProvinces(w, c.id), root = c.rootName ?? c.name.split(' ')[0];
    const x = { name: c.name, cap: w.provinces[c.capital]?.name ?? root, faith: c.majorityRel, y: (a, b) => between(r, a, b), past1: person(r, c.majorityEth, c.majorityRel), past2: person(r, c.majorityEth, c.majorityRel) };
    const minorities = [...new Set(provs.filter(p => p.eth !== c.majorityEth).map(p => p.eth))], faiths = [...new Set(provs.filter(p => p.rel !== c.majorityRel).map(p => p.rel))];
    const deposits = [...new Set(provs.flatMap(p => Object.entries(p.deposits).filter(([, d]) => d.known && d.mine > 0).map(([k]) => GOOD_TR[k])))];
    const events = (ARCS[c.archetype] ?? ARCS.cumhuriyet)(x).map(([year, text]) => ({ year, text }));
    events.push({ year: x.y(1850, 1890), text: deposits.length ? `${deposits.slice(0, 3).join(', ')} ocakları açıldı; madenciler kıyı ve ova eyaletlerinden göç etti.` : 'Büyük bir maden bulunamadı; ülke yakıtını ve metalini dışarıdan almak zorunda kaldı.' });
    if (minorities.length) events.push({ year: x.y(1860, 1897), text: `${minorities.join(', ')} halkının yaşadığı eyaletlerde okul dilinin ${c.majorityEth} olması zorunlu kılındı.` });
    if (faiths.length) events.push({ year: x.y(1840, 1897), text: `${faiths.join(', ')} inancından olanlar devlet memurluğuna alınmadı.` });
    c.chronicle = events.sort((a, b) => a.year - b.year);
    c.culture = { language: `${root}${pickOf(r, LANGUAGE_END)}`, majority: c.majorityEth, faith: c.majorityRel, myth: pickOf(r, MYTHS), custom: pickOf(r, CUSTOMS), minorities, faiths };
  }
  w.lifeReady = true;
}

const PARENTS = { leader: ['bir eyalet memurunun', 'küçük bir toprak sahibinin', 'bir subayın', 'bir yargıcın'], general: ['bir köy çavuşunun', 'bir subayın', 'bir demircinin', 'bir süvari çiftçisinin'], opposition: ['bir matbaacının', 'bir okul öğretmeninin', 'bir fabrika ustasının', 'bir köy imamının'], oligarch: ['bir tahıl tüccarının', 'bir armatörün', 'bir maden ustasının', 'bir sarrafın'] };
const SCHOOL = { leader: 'hukuk', general: 'harp', opposition: 'öğretmen', oligarch: 'ticaret' };
const CAREER = {
  leader: [p => `${p} eyaletinde vali yardımcısı oldu.`, p => `${p} kentinde belediye başkanlığı yaptı.`, () => 'Bakanlıkta on yıl müsteşarlık yaptı.'],
  general: [p => `${p} garnizonunda bölük komutanı oldu.`, () => 'Topçu okulunda öğretmenlik yaptı.', p => `${p} sınırında kurmay subay olarak görev aldı.`],
  opposition: [p => `${p} kentinde gazete çıkardı, iki kez kapatıldı.`, p => `${p} eyaletinde köy okulları kurdu.`, () => 'Mahkemelerde grevcilerin avukatlığını yaptı.'],
  oligarch: [p => `${p} limanında ilk ambarını kiraladı.`, p => `${p} madenine ortak oldu.`, () => 'Devlete tahıl tedarik ihalesi kazandı.']
};
const FAMILY = ['Eşi öldü, iki çocuğu var.', 'Evli, dört çocuğu var; en büyüğü askerde.', 'Hiç evlenmedi.', 'Eşi başka bir eyaletin ileri gelen ailesinden.', 'Tek çocuğu yurt dışında okuyor.', 'Bir çocuğunu salgında kaybetti.'];

export function writeLife(w, ch) {
  const c = w.countries[ch.country]; if (!c) return;
  const r = seeded(`${ch.id}|${ch.name}`), provs = countryProvinces(w, c.id); if (!provs.length) return;
  const now = 1900 + Math.floor(w.turn / 4), born = now - ch.age, home = pickOf(r, provs), role = ch.role in PARENTS ? ch.role : 'leader', parent = pickOf(r, PARENTS[role]);
  const year = age => born + age, life = [];
  life.push({ year: born, text: `${home.name} eyaletinde ${parent} çocuğu olarak doğdu.` });
  life.push({ year: year(between(r, 17, 23)), text: `${SCHOOL[role]} okulunu bitirdi.` });
  life.push({ year: year(between(r, 26, Math.max(27, ch.age - 8))), text: pickOf(r, CAREER[role])(pickOf(r, provs).name) });
  const shared = [...(w.past || []).filter(e => e.countries.includes(c.id)), ...(c.chronicle || [])].filter(e => e.year >= born + 16 && e.year <= now);
  if (shared.length) { const e = pickOf(r, shared); life.push({ year: e.year, text: `${e.year - born} yaşındayken ülkede şu olay yaşandı: ${e.text}` }); }
  const peers = Object.values(w.characters).filter(o => o.id !== ch.id && o.country === c.id && o.alive);
  if (peers.length) {
    const other = pickOf(r, peers), y = Math.min(now - 1, year(between(r, 30, Math.max(31, ch.age - 2))));
    life.push({ year: y, text: pickOf(r, [`${other.name} ile bir mahkeme davasında karşı karşıya geldi; dava ${r() < .5 ? ch.name : other.name} lehine bitti.`, `${other.name} ile aynı komisyonda çalıştı.`, `${other.name}, ${ch.name} için önemli bir kefalet verdi.`, `${other.name}, onun bir atamasını son anda engelledi.`]) });
  }
  if (home.eth !== c.majorityEth) ch.name = personName(home.eth, home.rel, ch.id);
  ch.origin = { birthplace: home.name, born, eth: home.eth, rel: home.rel, family: pickOf(r, FAMILY) };
  ch.life = life.sort((a, b) => a.year - b.year);
}

export function writeLives(w) { for (const ch of Object.values(w.characters)) if (ch.alive) writeLife(w, ch); }
