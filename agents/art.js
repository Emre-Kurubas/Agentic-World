// Portraits and event paintings. Since Claude produces text the drawing is SVG; a description is also kept for a real image model.
const PAINTABLE = /War began|Leader changed|collapsed|civil war|assassinat|\bcoup\b|famine .* lives|hunger is spreading|default|cannot pay|broke from its peg|lost its capital|suspended/i;
export const isPaintable = e => (e.k === 'state' || e.k === 'news') && !e.x?.secret && PAINTABLE.test(e.text ?? '');

const OUTPUT = (kind) => `Your output must consist of exactly these three parts and nothing else:
1) A single <svg viewBox="0 0 600 800" xmlns="http://www.w3.org/2000/svg"> ... </svg> block. Use at least 40 shapes; use paths, gradients and filters. Do not use scripts, external links or image files.
2) On a new line, one detailed paragraph in English for an image generation model, starting with DESCRIPTION: (${kind}).
3) On a new line, a one-sentence caption starting with CAPTION:.`;

export function portraitPrompt(w, ch) {
  const c = w.countries[ch.country], o = ch.origin ?? {};
  return `You live in a fictional world in the year 1900. You are ${ch.name}, a ${ch.role} in ${c.name}. You are ${ch.age} years old.
Your identity: ${ch.persona || '(unwritten)'}
Your past: ${ch.background ?? ''} ${ch.rise ?? ''} ${o.eth ? `Born in ${o.birthplace}, of the ${o.eth} people, faith ${o.rel}.` : ''}
Paint your own official portrait, like the studio photographs of the 1900s: a single figure, chest up, sepia tones, dark background, serious pose, with your clothing and rank visible. Decide your own face; let it reflect who you are.
${OUTPUT('sepia 1900s studio portrait photograph, describe face, age, clothing, insignia')}`;
}

export function paintingPrompt(w, ch, e) {
  const c = w.countries[ch.country];
  return `You are in a fictional world, at ${e.d}. You are ${ch.name}, in ${c?.name ?? ''}. Your identity: ${ch.persona || ch.background || '(unwritten)'}
You witnessed this event: ${e.text}
Paint this event as a great Renaissance-style oil painting: dramatic light and shadow, crowded figures, deep perspective, warm and dark tones. Interpret the event as you saw it; you decide who was right.
${OUTPUT('Renaissance oil painting of the event, composition, figures, lighting')}`;
}

export function parseArt(text) {
  const t = String(text), m = /<svg[\s\S]*?<\/svg>/i.exec(t); if (!m) return null;
  const line = key => new RegExp(`${key}:\\s*(.+)`, 'i').exec(t.slice(m.index + m[0].length))?.[1]?.trim() ?? '';
  const svg = sanitizeSvg(m[0]);
  return svg ? { svg, prompt: line('DESCRIPTION').slice(0, 2000), caption: line('CAPTION').slice(0, 300) } : null;
}

export function sanitizeSvg(raw) {
  let s = String(raw);
  if (!/^<svg[\s>]/i.test(s) || s.length > 220000) return null;
  s = s.replace(/<script[\s\S]*?<\/script\s*>/gi, '').replace(/<script[^>]*\/?>/gi, '').replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '').replace(/<(image|iframe|embed|object|audio|video|animate|set)\b[^>]*\/?>/gi, '');
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/\s(xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, '').replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, 'none').replace(/javascript:/gi, '');
  return s;
}

export function witnessFor(w, e, isAI) {
  const people = Object.values(w.characters).filter(ch => ch.alive && ch.status === 'free' && w.countries[ch.country]?.alive);
  const local = people.filter(ch => (e.c || []).includes(ch.country)), bystanders = local.filter(ch => !(e.a || []).includes(ch.id));
  const rank = list => list.filter(isAI).concat(list.filter(ch => !isAI(ch)));
  return rank(bystanders)[0] ?? rank(local)[0] ?? rank(people)[0] ?? null;
}
