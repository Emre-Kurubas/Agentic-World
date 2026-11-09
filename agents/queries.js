import { round } from '../engine/util.js';
import { countryProvinces, aliveCountries, atWar, hasTreaty, GOODS, GOOD_TR, PLANTS, TECHS, provincePop } from '../engine/world.js';
import { clauseText, leadsParties } from '../engine/polity.js';

export const CATALOG = `Bakabileceğin konular (birden çok seçebilirsin):
Kendi ülken: ekonomi, butce, stoklar, uretim, kaynaklar, eyaletler, eyalet:P12, ordu, filo, gruplar, partiler, meclis, kurumlar, kisiler, kisi:K12, komplolar, teknoloji
Dünya: tarih, dunya, ulke:U3, piyasa, rotalar, stratejik, deniz:D5, antlasmalar, savaslar, haberler
Sana özel: dosyalar (başkaları hakkında topladıkların), borclar (verdiğin ve aldığın borçlar)`;

// Her karakter ancak erişebildiği kadarını görür: gerçek rakam, tahmin veya dedikodu.
const INSIDE = { leader: ['ekonomi', 'butce', 'stoklar', 'uretim', 'kaynaklar', 'ordu', 'filo', 'gruplar', 'komplolar', 'teknoloji'], general: ['ordu', 'filo', 'stoklar', 'kaynaklar', 'teknoloji'], oligarch: ['ekonomi', 'uretim', 'kaynaklar', 'stoklar'], opposition: [] };
const can = (ch, t) => (INSIDE[ch.role] || []).includes(t);
const fuzzy = v => { const n = Math.abs(v); if (n >= 1000) return `yaklaşık ${Math.round(v / 500) * 500}`; if (n >= 100) return `yaklaşık ${Math.round(v / 50) * 50}`; return `yaklaşık ${Math.round(v / 5) * 5}`; };
const show = (ch, t, v) => can(ch, t) ? Math.round(v) : fuzzy(v);
const pct = v => `%${round(v * 100, 1)}`;

const provLine = (w, p, ch) => {
  const own = w.countries[ch.country], mine = p.controller === ch.country, intel = own.intel[p.controller] ?? 0;
  const dep = Object.entries(p.deposits).filter(([, d]) => d.known && (mine || intel >= 40)).map(([k, d]) => `${GOOD_TR[k]}${d.mine ? ' (işletiliyor)' : ''}`).join(', ');
  return `${p.id} ${p.name} [${w.countries[p.controller]?.name}] ${p.terrain}, yükseklik ${p.elevation}${p.coast ? `, kıyı (liman ${p.port}, denizler ${p.seas.join(',')})` : ''}${p.river > .1 ? ', nehirli' : ''}${p.dam ? ', barajlı' : ''}, verim ${round(p.fertility, 2)}, demiryolu ${p.rail}, nüfus ${Math.round(provincePop(p))} bin, huzursuzluk ${mine ? Math.round(p.unrest) : fuzzy(p.unrest)}, ${p.eth}/${p.rel}; komşular ${p.neighbors.join(',')}${dep ? `; bilinen yataklar: ${dep}` : ''}`;
};

export function answer(w, ch, raw) {
  const q = String(raw || '').trim(), [topic, arg] = q.split(':').map(s => s?.trim());
  const c = w.countries[ch.country], provs = countryProvinces(w, c.id);
  const T = {
    ekonomi: () => `GSYH ${show(ch, 'ekonomi', c.realGdp)}, büyüme ${pct(c.growth || 0)}, enflasyon ${pct(c.inflation)}, işsizlik ${pct(c.unemployment)}, döviz rezervi ${show(ch, 'ekonomi', c.reserves)}, para değeri ${c.fx ?? 100}, banka sağlığı ${show(ch, 'ekonomi', c.bankHealth)}, grev ${c.strike ? 'var' : 'yok'}, doğal kaynak rant payı ${pct(c.rentShare || 0)}, gıda karşılama ${pct(c.foodRatio)}, sanayi girdi karşılama ${pct(c.inputRatio ?? 1)}`,
    butce: () => can(ch, 'butce') ? `Hazine ${Math.round(c.treasury)}, gelir ${Math.round(c.lastRevenue || 0)}, harcama ${Math.round(c.lastSpending || 0)}, borç/GSYH ${pct(c.debt / Math.max(c.gdp * 4, 1))}, faiz ${pct(c.interestRate || 0)}, alacaklılar ${JSON.stringify(c.creditors)}. Vergi: gelir ${pct(c.tax.income)}, toprak ${pct(c.tax.land)}, şirket ${pct(c.tax.business)}, gümrük ${pct(c.tariff)}. Bütçe payları: ${JSON.stringify(c.budget)}` : `Hükümet bütçesinin ayrıntıları sana açık değil. Söylentiye göre hazine ${fuzzy(c.treasury)}, borç oranı ${fuzzy(c.debt / Math.max(c.gdp * 4, 1) * 100)}%.`,
    stoklar: () => GOODS.map(g => `${GOOD_TR[g]} ${show(ch, 'stoklar', c.stock[g] || 0)}`).join(', '),
    uretim: () => can(ch, 'uretim') ? Object.keys(PLANTS).map(k => `${PLANTS[k]}: kapasite ${Math.round(c._cap?.[k] || 0)}, üretim ${Math.round(c._made?.[k] || 0)}`).join('; ') + `. Silah üretim önceliği ${c.armShare}.` : 'Fabrika verilerini görmüyorsun.',
    kaynaklar: () => provs.flatMap(p => Object.entries(p.deposits).filter(([, d]) => d.known).map(([k, d]) => `${p.id} ${p.name}: ${GOOD_TR[k]} (rezerv ${show(ch, 'kaynaklar', d.amount)}, zenginlik ${round(d.rich, 2)}, maden seviyesi ${round(d.mine, 2)}${p.concessions?.[k] ? `, imtiyaz: ${p.concessions[k].holder}` : ''})`)).join('\n') || 'Bilinen yatak yok.',
    eyaletler: () => provs.map(p => `${p.id} ${p.name} ${p.terrain}${p.coast ? ' kıyı' : ''}`).join('; '),
    eyalet: () => { const p = w.provinces[arg]; return p ? provLine(w, p, ch) : `Eyalet bulunamadı: ${arg}`; },
    ordu: () => can(ch, 'ordu') ? Object.values(w.units).filter(u => u.country === c.id).map(u => `${u.id} ${u.kind} ${u.province}: ${Math.round(u.men)} bin, moral ${Math.round(u.morale)}, sadakat ${Math.round(u.loyalty)}, teçhizat ${round(u.equip)}`).join('\n') || 'Birlik yok.' : `Ordunun gücü hakkında genel tahmin: ${fuzzy(Object.values(w.units).filter(u => u.country === c.id).reduce((a, u) => a + u.men, 0))} bin asker.`,
    filo: () => can(ch, 'filo') ? Object.values(w.fleets).filter(f => f.country === c.id).map(f => `${f.id} ${Math.round(f.ships)} gemi, deniz ${f.sea}, moral ${Math.round(f.morale)}`).join('\n') || 'Filo yok.' : 'Filo bilgileri gizli.',
    gruplar: () => Object.entries(c.blocs).map(([k, v]) => `${k}: memnuniyet ${show(ch, 'gruplar', v.sat)}, güç ${Math.round(v.power)}`).join('; ') + `. Meşruiyet ${Math.round(c.legitimacy)}, halk desteği ${Math.round(c.popularity ?? 50)}, huzursuzluk ${Math.round(c.unrest ?? 0)}.`,
    partiler: () => c.parties.map(p => `${p.id} ${p.name}: destek %${Math.round(p.support)}${p.banned ? ' (yasak)' : ''}${p.id === c.rulingParty ? ' (iktidar)' : ''}`).join('; '),
    kurumlar: () => `Rejim: ${c.regime}. İdeoloji: ${c.ideology}. Seçim: ${c.elections ? `tur ${c.nextElection}` : 'yok'}. Basın özgürlüğü ${Math.round(c.pressFreedom)}, mahkeme bağımsızlığı ${Math.round(c.courts)}, sendikalar ${c.unions ? 'serbest' : 'yasak'}, polis ${Math.round(c.police)}, istihbarat ${Math.round(c.intelligence)}, yolsuzluk ${Math.round(c.corruption)}, okuryazarlık %${Math.round(c.literacy)}.\nKurumlar:\n${c.institutions.map(i => `${i.id ?? '-'} ${i.name}: ${i.description}${i.id ? ` [başkan ${w.characters[i.head]?.name ?? 'yok'}, üye ${i.members.length}, ${i.sponsor ? `özel, kurucu ${w.characters[i.sponsor]?.name}` : `bütçe GSYH %${round(i.budget * 100, 2)}`}, güç ${round(i.strength, 2)}${i.powers.length ? `, alanlar ${i.powers.join(',')}` : ''}${i.authority.length ? `, yetkiler ${i.authority.join(',')}` : ''}${i.veto.length ? `, veto ${i.veto.join(',')}` : ''}]` : ''}`).join('\n') || 'yok'}`,
    meclis: () => { const p = c.parliament; if (!p) return `Meclis yok. Yasalar: ${(c.laws || []).slice(-8).map(l => l.title).join('; ') || 'yok'}.`; return `${p.name}, ${p.legislative ? 'yasama yetkili' : 'danışma'}${w.turn < (p.suspendedUntil ?? 0) ? `, tur ${p.suspendedUntil} sonuna dek askıda` : ''}. Sandalyeler: ${c.parties.filter(x => p.seats[x.id]).map(x => `${x.id} ${x.name} ${p.seats[x.id]}${x.id === c.rulingParty ? ' (iktidar)' : ''}`).join(', ')}.\nBekleyen teklifler: ${(c.bills || []).filter(b => b.status === 'bekliyor').map(b => `${b.id} ${b.title} (${b.proposerName}): ${b.text}`).join('\n') || 'yok'}\nSon kararlar: ${(c.bills || []).filter(b => b.status !== 'bekliyor').map(b => `${b.title} ${b.status}`).join('; ') || 'yok'}\nYürürlükteki son yasalar: ${(c.laws || []).slice(-8).map(l => `${l.title}: ${l.text}`).join('; ') || 'yok'}`; },
    kisiler: () => Object.values(w.characters).filter(x => x.country === c.id && x.alive && x.id !== ch.id).map(x => `${x.id} ${x.name}, ${x.role}, yaş ${x.age}, ${x.status}`).join('; '),
    kisi: () => { const x = w.characters[arg]; if (!x) return `Kişi bulunamadı: ${arg}`; const kin = x.name.split(' ').at(-1) === ch.name.split(' ').at(-1) ? ' Seninle aynı aileden olabilir.' : ''; return `${x.name}, ${x.role}, ${w.countries[x.country]?.name}, yaş ${x.age}, durum ${x.status}. Kamuoyundaki kimliği: ${x.persona ? x.persona.slice(0, 200) : 'bilinmiyor'}.${ch.dossiers[x.id] ? ` Elinde dosyası var; servet ${Math.round(x.wealth)}. Dosyada: ${ch.dossiers[x.id].facts?.join(' ') || 'aleyhine bir şey yok'}` : ''}${kin}`; },
    komplolar: () => w.plots.filter(p => p.active && p.country === c.id && ([p.leader, ...p.members].includes(ch.id) || (ch.role === 'leader' && p.exposed))).map(p => `${p.id} ${p.kind}, ilerleme ${Math.round(p.progress)}, ${p.exposed ? 'sızdı' : 'gizli'}, üye ${p.members.length + 1}`).join('; ') || 'Bildiğin bir komplo yok.',
    teknoloji: () => `Sahip: ${Object.keys(c.techs).map(t => TECHS[t].name).join(', ') || 'yok'}. Araştırılan: ${c.research.target ? TECHS[c.research.target].name : 'yok'} (${Math.round(c.research.progress)}). Çalışılabilir: ${Object.entries(TECHS).filter(([k, t]) => !c.techs[k] && t.req.every(r => c.techs[r])).map(([k, t]) => `${k} (${t.name})`).join(', ') || 'yok'}.`,
    dunya: () => aliveCountries(w).filter(o => o.id !== c.id).map(o => `${o.id} ${o.name}, ${o.regime}, ${o.ideology}, lider ${w.characters[o.leader]?.name}${atWar(w, c.id, o.id) ? ', SAVAŞTA' : ''}${w.treaties.filter(t => t.active && t.parties.includes(c.id) && t.parties.includes(o.id)).map(t => `, ${t.kind} antlaşması var`).join('')}${c.embargo.includes(o.id) ? ', ona ambargo uyguluyorsun' : ''}${o.embargo.includes(c.id) ? ', sana ambargo uyguluyor' : ''}`).join('\n'),
    ulke: () => { const o = w.countries[arg]; if (!o?.alive) return `Ülke bulunamadı: ${arg}`; const i = c.intel[o.id] ?? 15, n = v => i >= 60 ? Math.round(v) : fuzzy(v); return `${o.name}: ${o.regime}, ${o.ideology}. GSYH ${n(o.realGdp)}, asker ${n(Object.values(w.units).filter(u => u.country === o.id).reduce((a, u) => a + u.men, 0))} bin, gemi ${n(Object.values(w.fleets).filter(f => f.country === o.id).reduce((a, f) => a + f.ships, 0))}, eyalet ${countryProvinces(w, o.id).length}. Kontrol ettiği stratejik noktalar: ${w.strategic.filter(s => s.controller === o.id).map(s => s.name).join(', ') || 'yok'}. Bilinen teknolojiler: ${i >= 40 ? Object.keys(o.techs).join(', ') || 'yok' : 'bilinmiyor'}. Eyaletleri: ${countryProvinces(w, o.id).map(p => p.id).join(',')}.`; },
    tarih: () => (w.past || []).map(e => `- ${e.text}`).join('\n') || 'Kayıtlı bir geçmiş yok.',
    piyasa: () => GOODS.map(g => `${GOOD_TR[g]} ${round(w.globalPrice[g], 1)}`).join(', '),
    rotalar: () => aliveCountries(w).filter(o => o.id !== c.id).map(o => { const k = c.id < o.id ? `${c.id}|${o.id}` : `${o.id}|${c.id}`, r = w.routes[k]; return `${o.name}: ${r ? `${r.mode} yolu, maliyet çarpanı ${round(r.cost, 2)}${r.tolls.length ? `, geçiş ücretli` : ''}` : 'rota yok'}`; }).join('\n'),
    stratejik: () => w.strategic.map(s => `${s.id} ${s.name} (${s.type}) konum ${s.ref}, kontrol ${w.countries[s.controller]?.name ?? 'kimse'}${s.closed ? ', KAPALI' : ''}${s.toll ? `, geçiş ücreti %${Math.round(s.toll * 100)}` : ''}`).join('\n'),
    deniz: () => { const s = w.seas[arg]; if (!s) return `Deniz bulunamadı: ${arg}`; return `${s.id} ${s.name || 'Adsız deniz'}, komşu denizler ${s.neighbors.join(',')}, kıyı eyaletler ${s.coast.join(',')}, buradaki filolar ${Object.values(w.fleets).filter(f => f.sea === s.id).map(f => `${w.countries[f.country].name} (${fuzzy(f.ships)})`).join(', ') || 'yok'}.`; },
    antlasmalar: () => `${w.treaties.filter(t => t.active && t.parties.includes(c.id)).map(t => `${t.id} ${t.kind}: ${t.parties.join('-')}${t.expires != null ? `, bitiş tur ${t.expires}` : ''}${t.clauses?.length ? `. Maddeler: ${t.clauses.map(x => clauseText(w, x)).join('; ')}` : ''}${t.breaches?.length ? `. İhlaller: ${t.breaches.slice(-3).map(b => b.text).join(' ')}` : ''}`).join('\n') || 'Yürürlükte antlaşma yok.'}\nBekleyen teklifler: ${w.treaties.filter(t => t.pending && t.parties.includes(c.id)).map(t => `${t.id} ${t.kind} ${t.proposer} ${t.terms}${t.clauses?.length ? ` [${t.clauses.map(x => clauseText(w, x)).join('; ')}]` : ''}`).join('\n') || 'yok'}`,
    savaslar: () => w.wars.filter(x => x.active).map(x => `${x.id} ${x.name}, başlangıç tur ${x.start}, taraflar a:${x.a.join(',')} b:${x.b.join(',')}`).join('\n') || 'Savaş yok.',
    haberler: () => w.newsLog.filter(n => !n.secret).slice(-20).map(n => `- ${n.text}`).join('\n') || 'Haber yok.',
    dosyalar: () => Object.entries(ch.dossiers).map(([id, d]) => `${id} ${d.about}: ${d.facts?.join(' ') || 'aleyhine bir şey çıkmadı'}`).join('\n') || 'Dosyan yok.',
    borclar: () => (w.debts || []).filter(d => ['acik', 'gecikmis'].includes(d.status) && [d.creditor, d.debtor].includes(ch.id)).map(d => d.debtor === ch.id ? `${d.id}: ${w.characters[d.creditor]?.name} kişisine borçlusun, ${Math.round(d.owed)}, vade tur ${d.due}${d.status === 'gecikmis' ? ' (GECİKMİŞ)' : ''}. ${d.terms}` : `${d.id}: ${w.characters[d.debtor]?.name} sana borçlu, ${Math.round(d.owed)}, vade tur ${d.due}${d.status === 'gecikmis' ? ' (GECİKMİŞ)' : ''}. ${d.terms}`).join('\n') || 'Açık borcun veya alacağın yok.'
  };
  return T[topic] ? T[topic]() : `"${q}" konusunda bilgi yok. ${CATALOG}`;
}

export const alarms = (w, ch) => {
  const c = w.countries[ch.country], out = [];
  if (c.foodRatio < .95) out.push('Ülkede gıda kıtlığı var.');
  if (c.arrears > .5 && ['leader', 'general'].includes(ch.role)) out.push('Maaşlar gecikiyor.');
  if (c.bankCrisis) out.push('Bankacılık krizi var.');
  if (c.strike) out.push('Genel grev sürüyor.');
  if (w.wars.some(x => x.active && (x.a.includes(c.id) || x.b.includes(c.id)))) out.push('Ülke savaşta.');
  if (ch.role === 'leader' && w.treaties.some(t => t.pending && t.parties.includes(c.id) && t.proposer !== c.id)) out.push('Yanıt bekleyen antlaşma teklifi var.');
  if ((c.bills || []).some(b => b.status === 'bekliyor') && leadsParties(w, c, ch).length) out.push('Mecliste oylanacak teklif var; partinin oyunu belirleyebilirsin.');
  if (w.treaties.some(t => t.active && t.parties.includes(c.id) && t.breaches?.at(-1)?.turn >= w.turn - 1) && ch.role === 'leader') out.push('Bir antlaşma yeni ihlal edildi.');
  if ((w.debts || []).some(d => d.status === 'gecikmis' && d.debtor === ch.id)) out.push('Vadesi geçmiş borcun var.');
  if ((w.debts || []).some(d => d.status === 'gecikmis' && d.creditor === ch.id)) out.push('Vadesi geçmiş bir alacağın var.');
  if (w.epidemics.some(e => e.active && Object.keys(e.provinces).some(id => w.provinces[id].controller === c.id))) out.push('Ülkede salgın var.');
  return out;
};
