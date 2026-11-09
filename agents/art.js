// Portre ve olay tabloları. Claude metin ürettiği için çizim SVG'dir; gerçek görsel için ayrıca bir betimleme saklanır.
const PAINTABLE = /Savaş başladı|Lider değişti|yıkıldı|iç savaş|suikast|darbe|kıtlık .* can aldı|açlık yayılıyor|temerrüt|ödeyemeyeceğini|kurdan koptu|başkentini kaybetti|askıya alındı/i;
export const isPaintable = e => (e.k === 'durum' || e.k === 'haber') && !e.x?.secret && PAINTABLE.test(e.text ?? '');

const OUTPUT = (kind) => `Çıktın tam olarak şu üç bölümden oluşsun, başka hiçbir şey yazma:
1) Tek bir <svg viewBox="0 0 600 800" xmlns="http://www.w3.org/2000/svg"> ... </svg> bloğu. En az 40 şekilden oluşsun; path, gradient ve filtre kullan. Script, dış bağlantı ve resim dosyası kullanma.
2) Yeni satırda BETIMLEME: ile başlayan, bir görüntü üretim modeli için İngilizce, ayrıntılı tek paragraf (${kind}).
3) Yeni satırda ALTYAZI: ile başlayan, Türkçe tek cümlelik altyazı.`;

export function portraitPrompt(w, ch) {
  const c = w.countries[ch.country], o = ch.origin ?? {};
  return `Kurgusal bir dünyada, 1900 yılında yaşıyorsun. Sen ${ch.name}, ${c.name} ülkesinde ${ch.role}. ${ch.age} yaşındasın.
Kimliğin: ${ch.persona || '(yazılmamış)'}
Geçmişin: ${ch.background ?? ''} ${ch.rise ?? ''} ${o.eth ? `${o.birthplace} doğumlusun, ${o.eth} halkındansın, inancın ${o.rel}.` : ''}
Kendi resmî portreni çiz. 1900'lerin stüdyo fotoğrafları gibi: tek figür, göğüsten yukarı, sepya tonları, koyu fon, ciddi duruş, kıyafetin ve mevkin görünür olsun. Yüzünü kendin belirle; kim olduğunu yansıtsın.
${OUTPUT('sepia 1900s studio portrait photograph, describe face, age, clothing, insignia')}`;
}

export function paintingPrompt(w, ch, e) {
  const c = w.countries[ch.country];
  return `Kurgusal bir dünyada ${e.d} tarihindesin. Sen ${ch.name}, ${c?.name ?? ''} ülkesindesin. Kimliğin: ${ch.persona || ch.background || '(yazılmamış)'}
Şu olaya tanık oldun: ${e.text}
Bu olayı Rönesans tarzı büyük bir yağlı boya tablo olarak çiz: dramatik ışık gölge, kalabalık figürler, derin perspektif, sıcak ve koyu tonlar. Olayı kendi gördüğün gibi yorumla; kimin haklı olduğuna sen karar veriyorsun.
${OUTPUT('Renaissance oil painting of the event, composition, figures, lighting')}`;
}

export function parseArt(text) {
  const t = String(text), m = /<svg[\s\S]*?<\/svg>/i.exec(t); if (!m) return null;
  const line = key => new RegExp(`${key}:\\s*(.+)`, 'i').exec(t.slice(m.index + m[0].length))?.[1]?.trim() ?? '';
  const svg = sanitizeSvg(m[0]);
  return svg ? { svg, prompt: line('BETIMLEME').slice(0, 2000), caption: line('ALTYAZI').slice(0, 300) } : null;
}

export function sanitizeSvg(raw) {
  let s = String(raw);
  if (!/^<svg[\s>]/i.test(s) || s.length > 220000) return null;
  s = s.replace(/<script[\s\S]*?<\/script\s*>/gi, '').replace(/<script[^>]*\/?>/gi, '').replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '').replace(/<(image|iframe|embed|object|audio|video|animate|set)\b[^>]*\/?>/gi, '');
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/\s(xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, '').replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, 'none').replace(/javascript:/gi, '');
  return s;
}

export function witnessFor(w, e, isAI) {
  const people = Object.values(w.characters).filter(ch => ch.alive && ch.status === 'serbest' && w.countries[ch.country]?.alive);
  const local = people.filter(ch => (e.c || []).includes(ch.country)), bystanders = local.filter(ch => !(e.a || []).includes(ch.id));
  const rank = list => list.filter(isAI).concat(list.filter(ch => !isAI(ch)));
  return rank(bystanders)[0] ?? rank(local)[0] ?? rank(people)[0] ?? null;
}
