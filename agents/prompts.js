import { round, between } from '../engine/util.js';
import { countryProvinces, aliveCountries, TECHS, GOODS } from '../engine/world.js';
import { CATALOG, alarms } from './queries.js';
import { STATE_POWERS, CIVIL_POWERS, DELEGABLE, GATED } from '../engine/polity.js';

const ROLE_TEXT = {
  leader: 'Ülkenin devlet başkanısın. Resmî yetkin geniş; ama ordu, sermaye, halk ve rakiplerin seni devirebilir.',
  general: 'Genelkurmay başkanısın. Orduyla yakın bağın var. Resmî kararları lider verir.',
  opposition: 'Muhalefet liderisin. Resmî yetkin yok; halkla, parti ağınla, yabancılarla ve söylentilerle iş görürsün.',
  oligarch: 'Ülkenin en güçlü iş insanısın. Maden, sanayi ve parayla iş görürsün.'
};

const MANIFESTO = 'Bu senin hayatın. Nasıl biri olacağına kimse karar vermiyor: idealist, korkak, sadık, hain, merhametli, acımasız, tembel veya deli olabilirsin. Hiçbir hedef sana dayatılmıyor; iktidar istemek zorunda değilsin, hiçbir şey yapmamayı da seçebilirsin. Dengeli veya makul davranmak zorunda değilsin. Karar listesi veya menü yok: aklına gelen her şeyi deneyebilir, yeni kurum, yasa, din, parti, şirket, ittifak icat edebilirsin. Dünyadaki herhangi bir kişiye veya ülkeye gizli mesaj atabilirsin. Kararlarını doğal dille, somut biçimde yaz. Sonucu tarafsız hakem ve dünya belirler; başarı garanti değildir.';
const ANSWER_FORMAT = 'Karar verdiğinde yalnızca bu JSON ile yanıt ver:\n{"kimlik":"yalnızca değiştirmek veya ilk kez yazmak istiyorsan","ic_ses":"bu turda gerçekten ne düşünüp hissediyorsun","kararlar":["somut karar; yapmak istemiyorsan boş bırak"],"mesajlar":[{"kime":"K12 veya U3","metin":"gizli mesaj"}],"notlar":"günlüğüne yazacağın satır"}';
const nextStep = final => final ? 'Bakma hakkın bitti, şimdi karar ver.' : 'Önce bir şeylere bakmak istersen {"bak":["ekonomi","eyalet:P12"]} yanıtını ver (en çok 6 konu). Yeterince biliyorsan doğrudan karar ver.';
const seenText = answers => `BAKTIKLARIN:\n${answers.map(a => `[${a.q}]\n${a.a}`).join('\n\n')}`;

// Karakterin oturumu geçmişini taşır; her uyanışta yalnızca o günün raporu yazılır.
export function frontPage(w, ch) {
  const c = w.countries[ch.country];
  const inbox = ch.inbox.map(m => `- [${m.from}] ${m.text}`).join('\n') || '- Yok';
  const news = w.newsLog.filter(n => !n.secret && n.turn >= ch.lastWake).slice(-30).map(n => `- ${n.text}`).join('\n') || '- Kayda değer haber yok.';
  return `Dünya tamamen kurgusal bir oyun simülasyonudur. Sen bir karakteri oynuyorsun. Tarih: ${w.date || 'Başlangıç'} (1 tur = 3 ay).
Adın: ${ch.name} (${ch.id}), ${c.name} (${c.id}). ${ROLE_TEXT[ch.role] || ''}
Yaş ${ch.age}. Servet ${Math.round(ch.wealth)}.
Son uyanışından beri kararlarının sonuçları:
${(ch.newOutcomes ?? []).map(d => `- ${d}`).join('\n') || '- (yok)'}

Acil durumlar: ${alarms(w, ch).join(' ') || 'Bildirilen acil durum yok.'}
Sana gelen gizli mesajlar:
${inbox}
Haber başlıkları:
${news}

${CATALOG}`;
}

// Yalnızca bir kez, oturumun başında verilir: karakterin içine doğduğu devlet ve bildiği geçmiş.
function inheritedText(w, ch) {
  const c = w.countries[ch.country], past = (w.past || []).filter(e => e.countries.includes(c.id)).slice(-10);
  return `\n\nDevraldığın ülke: ${c.regime}. Resmî ideoloji: ${c.ideology}. ${c.elections ? 'Seçim yapılıyor.' : 'Seçim yapılmıyor.'}${ch.rise ? `\nİktidara gelişin: ${ch.rise}` : ''}${ch.background ? `\nGeçmişin: ${ch.background}` : ''}${past.length ? `\nBildiğin geçmiş:\n${past.map(e => `- ${e.text}`).join('\n')}` : ''}\nBunlardan ne çıkardığın sana kalmış; hiçbirine bağlı değilsin, düzeni değiştirebilir veya yıkabilirsin.`;
}

const recapText = ch => `\n\nESKİ HAFIZANA ULAŞILAMIYOR. Elinde kalanlar:\nKimliğin: ${ch.persona || '(yazılmamış)'}\nGünlüğün:\n${ch.diary.map(d => `- ${d}`).join('\n') || '- (boş)'}\nSonuçlar:\n${ch.outcomes.map(d => `- ${d}`).join('\n') || '- (yok)'}`;

export function actorPrompt(w, ch, answers, final, { intro = true, recap = false, retry = false } = {}) {
  const seen = answers.length ? `\n\n${seenText(answers)}` : '';
  const life = intro || recap ? inheritedText(w, ch) : '';
  const who = `${life}${intro && !ch.persona ? '\n\nHenüz kim olduğunu yazmadın. Sana kişilik verilmedi: inançlarını, korkularını, sınırlarını sen belirle ve "kimlik" alanına yaz.' : ''}`;
  return `${frontPage(w, ch)}${seen}${recap ? recapText(ch) : ''}${who}${intro ? `\n\n${MANIFESTO}` : ''}

${nextStep(final)}
${ANSWER_FORMAT}${retry ? '\n\nNot: Bu sabah için verdiğin yanıt sisteme ulaşmadı, hiçbir şey uygulanmadı. Aynı sabah için yeniden yanıt ver.' : ''}`;
}

export const lookupReply = (answers, final) => `${seenText(answers)}\n\n${nextStep(final)}\n${ANSWER_FORMAT}`;

// Aynı çeyrek içinde gelen mesajlar: karakter cevap yazabilir ve kararını değiştirebilir.
export const talkText = (items, last) => `AYNI ÇEYREK İÇİNDE SANA YENİ MESAJLAR GELDİ:
${items.map(i => `- [${i.from}] ${i.text}`).join('\n')}

Cevap yazabilir, yeni kişilere yazabilir veya kararlarını değiştirebilirsin. "kararlar" alanını yazarsan önceki listenin tamamının yerine geçer, boş liste hepsini iptal eder; alanı hiç yazmazsan önceki kararların geçerli kalır. Bakma hakkın yok, şimdi karar ver.${last ? ' Bu çeyrekte artık yazacağın mesajlar karşı tarafa ancak gelecek çeyrekte ulaşır.' : ''}
Yalnızca bu JSON ile yanıt ver:
{"ic_ses":"şu an ne düşünüyorsun","kararlar":["yalnızca değiştireceksen"],"mesajlar":[{"kime":"K12 veya U3","metin":"gizli mesaj"}],"notlar":"günlüğüne yazacağın satır"}`;

const OPS_DOC = () => `İZİN VERİLEN İŞLEMLER (engine'in anladıkları):
set_tax{kind:income|land|business,rate} set_budget{category:military|welfare|infrastructure|education|police|administration,share} set_tariff{rate} set_arms_share{share}
print_money{pct_gdp} borrow{pct_gdp} embargo{target,on} build{province,kind:steel|fuel|fertilizer|machines|goods|arms|maden|demiryolu|liman|baraj|tarim|altyapi,resource?,pct_gdp} survey{province} set_research{tech} steal_tech{target} grant_concession{target,province,resource,share,fee_pct_gdp} revoke_concession{province,resource} lend{target,pct_gdp} ship_goods{target,good,amount} set_fx_regime{regime:serbest|altin|bagli,target} devalue{pct} borrow_foreign{target?,pct_gdp} repay_foreign{target,amount} set_capital_controls{closed} rename_currency{name} found_company{name,sector:steel|fuel|fertilizer|machines|goods|arms|maden,resource?,province,amount,state?} invest_company{id,amount} sell_company{id,buyer,price} buy_company{id} nationalize_company{id} privatize_company{id,buyer,price} nationalize{amount} privatize{amount} land_reform{}
recruit{province,men,unit_kind:piyade|topcu|zirhli|hava} disband{unit} move{unit,to} move_army{to,share} declare_war{target} join_war{war,side:a|b}
propose_treaty{target,kind:ittifak|saldirmazlik|ticaret|askeri_gecis|baris,terms,annex,reparations} accept_treaty{id} break_treaty{id} send_aid{target,pct_gdp,arms,secret}
spy{target,kind:bilgi|sabotaj|isyan_fonla} propaganda{strength} repress{strength} concession{cls:koylu|isci|orta|elit,pct_gdp} purge{character,fate:hapis|surgun|olu}
propose_law{title,text,ops:[işlemler],axes} vote_bill{bill,vote:evet|hayir} lobby_bill{bill,party,amount,side:evet|hayir} create_parliament{name,legislative} suspend_parliament{turns}
fund_institution{id,budget_pct_gdp} appoint_institution{id,character,role:head|member,remove} dissolve_institution{id}
set_regime{regime,ideology,elections,press_freedom,axes} hold_election{} rig_election{amount}
lend_private{character,amount,interest,due_turns,terms} repay_debt{debt,amount} forgive_debt{debt} publish_dossier{character}
start_plot{kind:darbe|suikast|isyan,secrecy} invite_plot{plot,character} join_plot{plot} betray_plot{plot} execute_plot{plot} fund_plot{plot,amount} bribe{character,amount,direction:up|down} capital_flight{share} invest{amount} embezzle{pct_gdp} set_strait{id,closed,toll} build_canal{id} build_ship{province,ships} move_fleet{fleet,to} amphibious{unit,to} found_party{name,axes,base} ban_party{party} set_institutions{courts,unions,ruling_party} gather_dossier{character} blackmail{character,demand} create_institution{name,description,budget_pct_gdp,amount,powers:[],authority:[],veto:[],head,members:[],effects}
custom{label,effects:[{target?,stat,delta,turns}],turns} stat: legitimacy corruption bureaucracy police intelligence pressFreedom warExhaustion repress sat.koylu sat.isci sat.orta sat.elit sat.all sat.ordu sat.sermaye sat.din sat.burokrasi unrest
Kurum powers: ${[...STATE_POWERS, ...CIVIL_POWERS].join(',')} (devlet yetkileri yalnızca lider kurabilir; kişilerin kurduğu kurumu amount ile kendi serveti besler). authority: kurum üyelerinin yapabileceği işlem adları (${[...DELEGABLE].join(',')}). veto: kurumun engelleyebileceği işlem adları. Yeni bir kurum, örgüt veya konsey kararını metin olarak bırakma: amacına uyan powers, budget_pct_gdp, head ve gerekiyorsa authority/veto ver.
Şirket kurma, yatırım, satış ve devletleştirme kararlarını yukarıdaki şirket işlemleriyle yap; para rejimi, devalüasyon ve dış borç kararlarını kendi işlemleriyle yap, custom kullanma.
Bir ülkeye tek seferlik mal göndermeyi veya takası ship_goods ile yap; iki taraflı takasta her taraf kendi gönderimini yapar. Mal ve para hareketini custom ile temsil etme. Mal anahtarları: ${GOODS.join(',')}.
Antlaşma maddeleri: propose_treaty içine clauses:[{type:harac,payer,pct_gdp,turns}|{type:teslimat,from,good,amount,turns}|{type:gumruk,rate}|{type:silahsiz_bolge,country,provinces:[]}|{type:asker_limit,country,men}|{type:yardim}] ve isteğe bağlı turns (süre). Metindeki somut şartları bu maddelere çevir; bunlar her tur kodla uygulanır, tutulmayan ihlal olarak kaydolur.
Meclis yasama yetkisine sahipse şu işlemler kendiliğinden yasa teklifine dönüşür ve bir sonraki çeyrekte oylanır: ${[...GATED].join(',')}.
Abluka için düşman limanlarına komşu denize filo gönderilir (move_fleet). Teknoloji anahtarları: ${Object.keys(TECHS).join(',')}.
Yetki: liderler her işlemi yapabilir. general, opposition ve oligarch yalnızca plot işlemleri, bribe, propaganda, custom ve kendi uzmanlık işlemlerini yapabilir; resmî devlet işlemi (vergi, savaş ilanı, birlik emri) yapamazlar.`;

export function refereePrompt(w, c, entries) {
  const refs = Object.values(w.characters).filter(x => x.country === c.id && x.alive).map(x => `${x.id}=${x.name}/${x.role}`).join(', ');
  const others = aliveCountries(w).map(o => `${o.id}=${o.name}`).join(', ');
  const plots = w.plots.filter(p => p.active && p.country === c.id).map(p => `${p.id}(${p.kind},lider ${p.leader},ilerleme ${Math.round(p.progress)})`).join(', ') || 'yok';
  const pending = w.treaties.filter(t => t.pending && t.parties.includes(c.id)).map(t => `${t.id}:${t.kind}/${t.proposer}`).join(', ') || 'yok';
  return `Tarafsız bir simülasyon hakemisin. Kurgusal ${c.name} (${c.id}) için karakterlerin serbest kararlarını oyun işlemlerine çeviriyorsun. Tek tarafın lehine yorum yapma. Gerçekçi ol: zor, yetkisiz veya kaynak gerektiren işlere düşük olasılık ver; fiziksel olarak olanaksız işleri olasılık 0 yap. Dünya istediğini vermez. Ama alışılmadık, yaratıcı fikirleri listede yok diye reddetme: create_institution veya custom ile dünyaya kalıcı biçimde işle. Kişilerin ahlaki tercihlerini yargılama; yalnızca sonuçları belirle.
Durum: meşruiyet ${Math.round(c.legitimacy)}, ordu memnuniyeti ${Math.round(c.blocs.ordu.sat)}, polis ${Math.round(c.police)}, hazine ${Math.round(c.treasury)}, GSYH ${Math.round(c.gdp)}.
Kimlikler: ${refs}. Ülkeler: ${others}. Komplolar: ${plots}. Teklifler: ${pending}. Meclis: ${c.parliament ? `${c.parliament.name}${c.parliament.legislative ? ', yasama yetkili' : ', danışma'}${w.turn < (c.parliament.suspendedUntil ?? 0) ? ', askıda' : ''}; bekleyen tasarılar ${(c.bills || []).filter(b => b.status === 'bekliyor').map(b => `${b.id}:${b.title}`).join(', ') || 'yok'}` : 'yok'}. Kurumlar: ${(c.institutions || []).filter(i => i.id).map(i => `${i.id}:${i.name}`).join(', ') || 'yok'}. Para: ${c.currency?.name}, ${c.fxRegime}. Şirketler: ${Object.values(w.firms || {}).filter(f => f.status === 'acik' && f.country === c.id).map(f => `${f.id}:${f.name}/${f.owner ?? 'halka açık'}`).join(', ') || 'yok'}.
Eyaletler: ${countryProvinces(w, c.id).map(p => p.id).join(',')}. Birlikler: ${Object.values(w.units).filter(u => u.country === c.id).map(u => u.id).join(',')}. Filolar: ${Object.values(w.fleets).filter(f => f.country === c.id).map(f => `${f.id}@${f.sea}`).join(',') || 'yok'}. Partiler: ${c.parties.map(p => `${p.id}:${p.name}`).join(', ')}. Stratejik: ${w.strategic.map(s => `${s.id}:${s.name}/${s.type}`).join(', ')}.

${OPS_DOC()}

KARARLAR:
${entries.map(e => `${e.actor.id} (${e.actor.role}, ${e.actor.name}):\n${e.decisions.map((d, i) => `  ${i}. ${d}`).join('\n')}`).join('\n')}

Yalnızca bu JSON ile yanıt ver. Listede olmayan işleri custom ile temsil et.
{"hukumler":[{"aktor":"K1","karar":0,"aciklama":"kısa anlatı","olasilik":0.7,"kamuya_acik":true,"islemler":[{"op":"set_tax","kind":"income","rate":0.2}]}]}`;
}
