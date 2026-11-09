// Kısayolun çağırdığı başlatıcı: oyunu arka planda açar, paneli adres çubuğu olmayan kendi penceresinde gösterir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const extra = process.argv.slice(2), portArg = extra.indexOf('--port');
const url = `http://localhost:${portArg >= 0 ? extra[portArg + 1] : cfg.port}`;
const home = cfg.saveDir || path.join(os.homedir(), 'ajan-dunyasi-kayitlar');
fs.mkdirSync(home, { recursive: true });

const isUp = async () => {
  try { return (await fetch(`${url}/api/meta`, { signal: AbortSignal.timeout(900) })).ok; }
  catch { return false; }
};

async function startGame() {
  if (await isUp()) return;
  const log = fs.openSync(path.join(home, 'oyun.log'), 'a');
  spawn(process.execPath, [path.join(root, 'run.js'), '--pencere', ...extra], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log, log] }).unref();
  for (let i = 0; i < 80; i++) {
    if (await isUp()) return;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Oyun başlamadı. Ayrıntı: ${path.join(home, 'oyun.log')}`);
}

function browser() {
  const { ProgramFiles: pf, 'ProgramFiles(x86)': pf86, LOCALAPPDATA: local } = process.env;
  return [[pf86, 'Microsoft/Edge/Application/msedge.exe'], [pf, 'Microsoft/Edge/Application/msedge.exe'], [pf, 'Google/Chrome/Application/chrome.exe'], [pf86, 'Google/Chrome/Application/chrome.exe'], [local, 'Google/Chrome/Application/chrome.exe']]
    .filter(([base]) => base).map(([base, rel]) => path.join(base, rel)).find(p => fs.existsSync(p));
}

await startGame();
const exe = browser();
if (exe) spawn(exe, [`--app=${url}`, `--user-data-dir=${path.join(home, 'pencere')}`, '--window-size=1500,920', '--no-first-run', '--no-default-browser-check'], { detached: true, stdio: 'ignore' }).unref();
else spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
