import { round, between } from '../engine/util.js';
import { countryProvinces, aliveCountries, TECHS, PLANTS } from '../engine/world.js';
import { CATALOG, alarms } from './queries.js';

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

const recapText = ch => `\n\nESKİ HAFIZANA ULAŞILAMIYOR. Elinde kalanlar:\nKimliğin: ${ch.persona || '(yazılmamış)'}\nGünlüğün:\n${ch.diary.map(d => `- ${d}`).join('\n') || '- (boş)'}\nSonuçlar:\n${ch.outcomes.map(d => `- ${d}`).join('\n') || '- (yok)'}`;

export function actorPrompt(w, ch, answers, final, { intro = true, recap = false, retry = false } = {}) {
  const seen = answers.length ? `\n\n${seenText(answers)}` : '';
  const who = intro && !ch.persona ? '\n\nHenüz kim olduğunu yazmadın. Sana kişilik verilmedi: inançlarını, korkularını, sınırlarını sen belirle ve "kimlik" alanına yaz.' : '';
  return `${frontPage(w, ch)}${seen}${recap ? recapText(ch) : ''}${who}${intro ? `\n\n${MANIFESTO}` : ''}

${nextStep(final)}
${ANSWER_FORMAT}${retry ? '\n\nNot: Bu sabah için verdiğin yanıt sisteme ulaşmadı, hiçbir şey uygulanmadı. Aynı sabah için yeniden yanıt ver.' : ''}`;
}

export const lookupReply = (answers, final) => `${seenText(answers)}\n\n${nextStep(final)}\n${ANSWER_FORMAT}`;

export function foundingPrompt(w, c, ch) {
  const provs = countryProvinces(w, c.id);
  const totals = { farm: provs.reduce((a, p) => a + p.fertility, 0) };
  return `Kurgusal bir dünyada yeni kurulan bir ülkenin kurucu lideri ${ch.name} karakterini oynuyorsun. Ülkenin adı, rejimi, ideolojisi ve senin kim olduğun tamamen senin kararın. Hazır bir kalıbı seçmek zorunda değilsin; hiç görülmemiş bir düzen de kurabilirsin.
${provs.length} eyalet. Ortalama toprak verimi ${round(totals.farm / provs.length)}. Bilinen yataklar: ${[...new Set(provs.flatMap(p => Object.entries(p.deposits).filter(([, d]) => d.known).map(([k]) => k)))].join(', ') || 'yok'}. Araziler: ${[...new Set(provs.map(p => p.terrain))].join(', ')}. Çoğunluk: ${c.majorityEth}, inanç: ${c.majorityRel}. 
Bugünün dünyasındaki gerçek ülke, kişi veya parti adlarını kullanma. Özgün bir devlet düşün. Eksenler -100..100: econ (sol-sağ), auth (özgürlükçü-otoriter), nation (enternasyonal-milliyetçi), faith (seküler-dindar).
Yalnızca bu JSON ile yanıt ver:
{"name":"ülke adı","ideology":"ideoloji adı","regime":"rejim adı","elections":true,"press_freedom":0,"axes":{"econ":0,"auth":0,"nation":0,"faith":0},"motto":"kısa slogan","colors":["#rrggbb","#rrggbb"],"kimlik":"sen kimsin, neye inanıyorsun, nelerden korkuyorsun","ic_ses":"neden bu yolu seçtin"}`;
}

const OPS_DOC = () => `İZİN VERİLEN İŞLEMLER (engine'in anladıkları):
set_tax{kind:income|land|business,rate} set_budget{category:military|welfare|infrastructure|education|police|administration,share} set_tariff{rate} set_arms_share{share}
print_money{pct_gdp} borrow{pct_gdp} embargo{target,on} build{province,kind:steel|fuel|fertilizer|machines|goods|arms|maden|demiryolu|liman|baraj|tarim|altyapi,resource?,pct_gdp} survey{province} set_research{tech} steal_tech{target} grant_concession{target,province,resource,share,fee_pct_gdp} revoke_concession{province,resource} lend{target,pct_gdp} nationalize{amount} privatize{amount} land_reform{}
recruit{province,men,unit_kind:piyade|topcu|zirhli|hava} disband{unit} move{unit,to} move_army{to,share} declare_war{target} join_war{war,side:a|b}
propose_treaty{target,kind:ittifak|saldirmazlik|ticaret|askeri_gecis|baris,terms,annex,reparations} accept_treaty{id} break_treaty{id} send_aid{target,pct_gdp,arms,secret}
spy{target,kind:bilgi|sabotaj|isyan_fonla} propaganda{strength} repress{strength} concession{cls:koylu|isci|orta|elit,pct_gdp} purge{character,fate:hapis|surgun|olu}
set_regime{regime,ideology,elections,press_freedom,axes} hold_election{} rig_election{amount}
start_plot{kind:darbe|suikast|isyan,secrecy} invite_plot{plot,character} join_plot{plot} betray_plot{plot} execute_plot{plot} fund_plot{plot,amount} bribe{character,amount,direction:up|down} capital_flight{share} invest{amount} embezzle{pct_gdp} set_strait{id,closed,toll} build_canal{id} build_ship{province,ships} move_fleet{fleet,to} amphibious{unit,to} found_party{name,axes,base} ban_party{party} set_institutions{courts,unions,ruling_party} gather_dossier{character} blackmail{character,demand} create_institution{name,description,effects}
custom{label,effects:[{target?,stat,delta,turns}],turns} stat: legitimacy corruption bureaucracy police intelligence pressFreedom warExhaustion repress sat.koylu sat.isci sat.orta sat.elit sat.all sat.ordu sat.sermaye sat.din sat.burokrasi unrest
Abluka için düşman limanlarına komşu denize filo gönderilir (move_fleet). Teknoloji anahtarları: ${Object.keys(TECHS).join(',')}.
Yetki: liderler her işlemi yapabilir. general, opposition ve oligarch yalnızca plot işlemleri, bribe, propaganda, custom ve kendi uzmanlık işlemlerini yapabilir; resmî devlet işlemi (vergi, savaş ilanı, birlik emri) yapamazlar.`;

export function refereePrompt(w, c, entries) {
  const refs = Object.values(w.characters).filter(x => x.country === c.id && x.alive).map(x => `${x.id}=${x.name}/${x.role}`).join(', ');
  const others = aliveCountries(w).map(o => `${o.id}=${o.name}`).join(', ');
  const plots = w.plots.filter(p => p.active && p.country === c.id).map(p => `${p.id}(${p.kind},lider ${p.leader},ilerleme ${Math.round(p.progress)})`).join(', ') || 'yok';
  const pending = w.treaties.filter(t => t.pending && t.parties.includes(c.id)).map(t => `${t.id}:${t.kind}/${t.proposer}`).join(', ') || 'yok';
  return `Tarafsız bir simülasyon hakemisin. Kurgusal ${c.name} (${c.id}) için karakterlerin serbest kararlarını oyun işlemlerine çeviriyorsun. Tek tarafın lehine yorum yapma. Gerçekçi ol: zor, yetkisiz veya kaynak gerektiren işlere düşük olasılık ver; fiziksel olarak olanaksız işleri olasılık 0 yap. Dünya istediğini vermez. Ama alışılmadık, yaratıcı fikirleri listede yok diye reddetme: create_institution veya custom ile dünyaya kalıcı biçimde işle. Kişilerin ahlaki tercihlerini yargılama; yalnızca sonuçları belirle.
Durum: meşruiyet ${Math.round(c.legitimacy)}, ordu memnuniyeti ${Math.round(c.blocs.ordu.sat)}, polis ${Math.round(c.police)}, hazine ${Math.round(c.treasury)}, GSYH ${Math.round(c.gdp)}.
Kimlikler: ${refs}. Ülkeler: ${others}. Komplolar: ${plots}. Teklifler: ${pending}.
Eyaletler: ${countryProvinces(w, c.id).map(p => p.id).join(',')}. Birlikler: ${Object.values(w.units).filter(u => u.country === c.id).map(u => u.id).join(',')}. Filolar: ${Object.values(w.fleets).filter(f => f.country === c.id).map(f => `${f.id}@${f.sea}`).join(',') || 'yok'}. Partiler: ${c.parties.map(p => `${p.id}:${p.name}`).join(', ')}. Stratejik: ${w.strategic.map(s => `${s.id}:${s.name}/${s.type}`).join(', ')}.

${OPS_DOC()}

KARARLAR:
${entries.map(e => `${e.actor.id} (${e.actor.role}, ${e.actor.name}):\n${e.decisions.map((d, i) => `  ${i}. ${d}`).join('\n')}`).join('\n')}

Yalnızca bu JSON ile yanıt ver. Listede olmayan işleri custom ile temsil et.
{"hukumler":[{"aktor":"K1","karar":0,"aciklama":"kısa anlatı","olasilik":0.7,"kamuya_acik":true,"islemler":[{"op":"set_tax","kind":"income","rate":0.2}]}]}`;
}
