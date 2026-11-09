import { spawn } from 'node:child_process';
import os from 'node:os';

export class LimitError extends Error {}

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

function callClaude(prompt, model, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    // Kullanım API faturasına değil, Claude aboneliğine yazılsın.
    for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']) delete env[k];
    const args = ['-p', '--model', model, '--output-format', 'json', '--no-session-persistence', '--tools', '""', '--strict-mcp-config', '--disable-slash-commands', '--setting-sources', 'project'];
    const child = spawn('claude', args, { shell: true, cwd: os.tmpdir(), env, windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Ajan zaman aşımına uğradı')); }, timeoutMs);
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      let parsed = null;
      try { parsed = JSON.parse(out); } catch { /* düz metin hata olabilir */ }
      const text = parsed?.result ?? out;
      if (LIMIT_RE.test(`${text}\n${err}`) && (code !== 0 || parsed?.is_error)) return reject(new LimitError(String(text || err).slice(0, 240)));
      if (code !== 0 || parsed?.is_error) return reject(new Error(String(text || err || `claude çıkış kodu ${code}`).slice(0, 400)));
      resolve(String(text));
    });
    child.stdin.end(prompt);
  });
}

export async function checkClaude() {
  const text = await callClaude('Yalnızca şu JSON ile yanıt ver: {"ok":true}', 'haiku', 120000);
  return extractJson(text).ok === true;
}

export function makeBackend(cfg) {
  if (cfg.backend === 'mock') return { kind: 'mock', ask: async () => { throw new Error('mock'); } };
  return {
    kind: 'claude',
    async ask(prompt, model) {
      let last;
      for (let i = 0; i < 2; i++) {
        try { return extractJson(await callClaude(i ? `${prompt}\n\nÖNEMLİ: Önceki yanıtın geçerli JSON değildi. Yalnızca tek bir geçerli JSON nesnesi döndür.` : prompt, model)); }
        catch (e) { if (e instanceof LimitError) throw e; last = e; }
      }
      throw last;
    }
  };
}
