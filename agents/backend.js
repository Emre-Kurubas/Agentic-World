import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export class LimitError extends Error {}
export class SessionLostError extends Error {}

// Ajanlar proje ayarı okuyabilecek klasörde çalışır; paylaşılan geçici klasördeki yabancı ayarlar yüklenmesin diye klasör uygulamaya özel ve boştur.
let workDir;
const agentCwd = () => workDir ??= fs.mkdtempSync(path.join(os.tmpdir(), 'ajan-dunyasi-'));

const LIMIT_RE = /(usage limit|rate limit|limit reached|hit your .*limit|session limit|weekly limit|credit balance|overloaded|too many requests|429)/i;

export function extractJson(text) {
  const clean = String(text).replace(/```json|```/g, '');
  const a = clean.indexOf('{');
  if (a < 0) throw new Error('Yanıtta JSON yok');
  let depth = 0, str = false, esc = false;
  for (let i = a; i < clean.length; i++) {
    const ch = clean[i];
    if (str) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') str = false; continue; }
    if (ch === '"') str = true; else if (ch === '{') depth++; else if (ch === '}' && --depth === 0) return JSON.parse(clean.slice(a, i + 1));
  }
  throw new Error('JSON tamamlanmamış');
}

const num = v => Number(v) || 0;

// Karakterler Claude Code'un yazılım asistanı talimatıyla değil, yalnızca bu tarafsız çerçeveyle çalışır. Kişilik yazmaz.
const ACTOR_SYSTEM = 'Kurgusal bir oyun dünyasında yaşayan bir insansın. Yazılım asistanı değilsin ve kullanıcıya yardım etmiyorsun; yalnızca bu kişi olarak kendi çıkarına, inancına veya korkusuna göre yaşıyorsun. Yanıtını yalnızca istenen JSON biçiminde ver.';
const ART_SYSTEM = 'Kurgusal bir oyun dünyasında yaşayan bir insansın ve bu dünyanın ressamı gibi çiziyorsun. Yalnızca istenen biçimde yanıt ver.';
const ACTOR_SYSTEM_FILE = 'ajan-sistem.txt';

// session verilirse karakterin kendi oturumu sürer; verilmezse (hakem, bağlantı denemesi) çağrı iz bırakmaz.
function callClaude(prompt, model, { timeoutMs = 300000, session = null, cwd = null, frame = false } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    // Kullanım API faturasına değil, Claude aboneliğine yazılsın.
    for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']) delete env[k];
    // Windows'ta claude bir .cmd olabilir; kabuk gerekir. Node 24 kabukla dizi argümanı uyarı verdiği için komut tek satır.
    const memory = !session ? '--no-session-persistence' : session.resume ? `--resume ${session.id}` : `--session-id ${session.id}`;
    const dir = cwd ?? agentCwd();
    if (session || frame) fs.writeFileSync(path.join(dir, ACTOR_SYSTEM_FILE), frame ? ART_SYSTEM : ACTOR_SYSTEM);
    const system = session || frame ? ` --system-prompt-file ${ACTOR_SYSTEM_FILE}` : '';
    const command = `claude -p --model ${model} --output-format json ${memory}${system} --tools "" --strict-mcp-config --disable-slash-commands --setting-sources project`;
    const child = spawn(command, { shell: true, cwd: dir, env, windowsHide: true });
    let out = '', err = '';
    // Windows'ta child.kill yalnızca kabuğu kapatır; claude süreci açık kalmasın diye tüm ağaç kapatılır.
    const killTree = () => process.platform === 'win32' ? spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }) : child.kill();
    const timer = setTimeout(() => { killTree(); reject(new Error('Ajan zaman aşımına uğradı')); }, timeoutMs);
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      let parsed = null;
      try { parsed = JSON.parse(out); } catch { /* düz metin hata olabilir */ }
      const text = parsed?.result ?? out;
      if (/No conversation found with session ID/i.test(err)) return reject(new SessionLostError(err.trim()));
      if (LIMIT_RE.test(`${text}\n${err}`) && (code !== 0 || parsed?.is_error)) return reject(new LimitError(String(text || err).slice(0, 240)));
      if (code !== 0 || parsed?.is_error) return reject(new Error(String(text || err || `claude çıkış kodu ${code}`).slice(0, 400)));
      resolve({ text: String(text), usage: parsed?.usage ?? null });
    });
    child.stdin.end(prompt);
  });
}

export async function checkClaude() {
  const { text } = await callClaude('Yalnızca şu JSON ile yanıt ver: {"ok":true}', 'haiku', { timeoutMs: 120000 });
  return extractJson(text).ok === true;
}

export function makeBackend(cfg, cwd = null) {
  if (cfg.backend === 'mock') return { kind: 'mock', ask: async () => { throw new Error('mock'); } };
  const FIX = 'ÖNEMLİ: Önceki yanıtın geçerli JSON değildi. Yalnızca tek bir geçerli JSON nesnesi döndür.';
  const blank = () => ({ calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, largest: 0 });
  const backend = {
    kind: 'claude',
    usage: blank(),
    resetUsage() { const u = backend.usage; backend.usage = blank(); return u; },
    record(u) {
      if (!u) return;
      const t = backend.usage, input = num(u.input_tokens), read = num(u.cache_read_input_tokens), write = num(u.cache_creation_input_tokens);
      t.calls++; t.input += input; t.cacheRead += read; t.cacheWrite += write; t.output += num(u.output_tokens); t.largest = Math.max(t.largest, input + read + write);
    },
    // Görseller oturum dışında üretilir: uzun SVG karakterin hafızasını şişirmesin.
    async askText(prompt, model) { const r = await callClaude(prompt, model, { cwd, frame: true, timeoutMs: 600000 }); backend.record(r.usage); return r.text; },
    async ask(prompt, model, session = null) {
      let last, current = session;
      for (let i = 0; i < 2; i++) {
        // İkinci denemede oturum isteği zaten biliyor; yalnızca düzeltme yazılır.
        const text = i ? (session ? FIX : `${prompt}\n\n${FIX}`) : prompt;
        try {
          const r = await callClaude(text, model, { session: current, cwd });
          backend.record(r.usage);
          return extractJson(r.text);
        } catch (e) {
          if (e instanceof LimitError || e instanceof SessionLostError) throw e;
          last = e;
        }
        if (session) current = { ...session, resume: true };
      }
      throw last;
    }
  };
  return backend;
}
