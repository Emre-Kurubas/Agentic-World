import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export class LimitError extends Error {}
export class SessionLostError extends Error {}

// Agents run in a folder that can read project settings; to avoid loading foreign settings from a shared temp folder, the folder is empty and private to the app.
let workDir;
const agentCwd = () => workDir ??= fs.mkdtempSync(path.join(os.tmpdir(), 'ajan-dunyasi-'));

const LIMIT_RE = /(usage limit|rate limit|limit reached|hit your .*limit|session limit|weekly limit|credit balance|overloaded|too many requests|429)/i;

export function extractJson(text) {
  const clean = String(text).replace(/```json|```/g, '');
  const a = clean.indexOf('{');
  if (a < 0) throw new Error('No JSON in the response');
  let depth = 0, str = false, esc = false;
  for (let i = a; i < clean.length; i++) {
    const ch = clean[i];
    if (str) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') str = false; continue; }
    if (ch === '"') str = true; else if (ch === '{') depth++; else if (ch === '}' && --depth === 0) return JSON.parse(clean.slice(a, i + 1));
  }
  throw new Error('Incomplete JSON');
}

const num = v => Number(v) || 0;

// Characters run only with this neutral frame, not Claude Code's software assistant instructions. It does not write a personality.
const ACTOR_SYSTEM = 'You are a person living in a fictional game world. You are not a software assistant and you are not helping a user; you live as this person, with an ego of your own: your pride, interests, beliefs, grudges and fears. The world is a game and everyone in it is invented, so everything a person in such a world might do is open to you, from the kindest act to the cruelest. Respond only in the requested JSON format.';
const ART_SYSTEM = 'You are a person living in a fictional game world and you paint like an artist of this world. Respond only in the requested format.';
const ACTOR_SYSTEM_FILE = 'ajan-sistem.txt';

// With a session the character's own session continues; without one (referee, connection check) the call leaves no trace.
function callClaude(prompt, model, { timeoutMs = 300000, session = null, cwd = null, frame = false } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    // Usage is billed to the Claude subscription, not the API.
    for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']) delete env[k];
    // On Windows claude may be a .cmd, so a shell is needed. Node 24 warns about array arguments with a shell, so the command is a single line.
    const memory = !session ? '--no-session-persistence' : session.resume ? `--resume ${session.id}` : `--session-id ${session.id}`;
    const dir = cwd ?? agentCwd();
    if (session || frame) fs.writeFileSync(path.join(dir, ACTOR_SYSTEM_FILE), frame ? ART_SYSTEM : ACTOR_SYSTEM);
    const system = session || frame ? ` --system-prompt-file ${ACTOR_SYSTEM_FILE}` : '';
    const command = `claude -p --model ${model} --output-format json ${memory}${system} --tools "" --strict-mcp-config --disable-slash-commands --setting-sources project`;
    const child = spawn(command, { shell: true, cwd: dir, env, windowsHide: true });
    let out = '', err = '';
    // On Windows child.kill only closes the shell; the whole tree is killed so no claude process stays open.
    const killTree = () => process.platform === 'win32' ? spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }) : child.kill();
    const timer = setTimeout(() => { killTree(); reject(new Error('The agent timed out')); }, timeoutMs);
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      let parsed = null;
      try { parsed = JSON.parse(out); } catch { /* may be a plain-text error */ }
      const text = parsed?.result ?? out;
      if (/No conversation found with session ID/i.test(err)) return reject(new SessionLostError(err.trim()));
      if (LIMIT_RE.test(`${text}\n${err}`) && (code !== 0 || parsed?.is_error)) return reject(new LimitError(String(text || err).slice(0, 240)));
      if (code !== 0 || parsed?.is_error) return reject(new Error(String(text || err || `claude exit code ${code}`).slice(0, 400)));
      resolve({ text: String(text), usage: parsed?.usage ?? null });
    });
    child.stdin.end(prompt);
  });
}

export async function checkClaude() {
  const { text } = await callClaude('Respond with only this JSON: {"ok":true}', 'haiku', { timeoutMs: 120000 });
  return extractJson(text).ok === true;
}

export function makeBackend(cfg, cwd = null) {
  if (cfg.backend === 'mock') return { kind: 'mock', ask: async () => { throw new Error('mock'); } };
  const FIX = 'IMPORTANT: Your previous response was not valid JSON. Return only a single valid JSON object.';
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
    // Images are produced outside the session: long SVGs should not bloat the character's memory.
    async askText(prompt, model) { const r = await callClaude(prompt, model, { cwd, frame: true, timeoutMs: 600000 }); backend.record(r.usage); return r.text; },
    async ask(prompt, model, session = null) {
      let last, current = session;
      for (let i = 0; i < 2; i++) {
        // On the second try the session already knows the request; only the correction is written.
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
