import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://127.0.0.1:8765/eleicoes.html';
const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=9222', `--user-data-dir=${userDir}`, 'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9222/json/list');
      const list = await r.json();
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome CDP page target nao encontrado');
}

const ws = new WebSocket(await getWsUrl());
let nextId = 1;
const pending = new Map();
const errors = [];
const logs = [];
let loaded = false;

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Page.loadEventFired') loaded = true;
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    errors.push(d.exception?.description || d.text || 'exception');
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    logs.push(msg.params.args.map(a => a.value || a.description || '').join(' '));
  }
});

const send = (method, params = {}) => new Promise((res) => {
  const id = nextId++;
  pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
});

await new Promise((r) => ws.addEventListener('open', r));
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: URL });

for (let i = 0; i < 30 && !loaded; i++) await sleep(200);
await sleep(4000); // deixa scripts/sql.js inicializarem

const probe = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    readyState: document.readyState,
    title: document.title,
    fns: {
      loadMunicipal2000Prefeito: typeof loadMunicipal2000Prefeito,
      loadMunicipal2004Vereador: typeof loadMunicipal2004Vereador,
      loadMunicipalBaseFromGpkg2006: typeof loadMunicipalBaseFromGpkg2006,
      onClickLoadData_Municipal_2004: typeof onClickLoadData_Municipal_2004,
      getGeneral2006Database: typeof getGeneral2006Database,
      buildMunicipal2008Feature: typeof buildMunicipal2008Feature,
      MUNICIPAL_2006_BASE_CACHE: typeof MUNICIPAL_2006_BASE_CACHE
    },
    yearOptions: Array.from(document.querySelectorAll('#selectYearMunicipal option')).map(o=>o.value)
  })`,
  returnByValue: true
});

console.log('=== LOAD CHECKS ===');
console.log(probe.result?.result?.value);

const fnTest = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
  return r.result?.result?.value;
};

// Prefeito Rio 2004: exercita sql.js GPKG 2006 + join + resumo oficial completo
const prefTest = await fnTest(`(async () => {
  const ord1 = await loadPrefeitoJsonEarly('RJ','RIO DE JANEIRO',2004,'ord',1);
  const keys = new Set(Object.keys(ord1.json.RESULTS));
  const geo = await loadMunicipalBaseFromGpkg2006('RJ','RIO DE JANEIRO', ord1.muniCode, keys, 'prefeito');
  applyPrefeitoJsonToGeojson2024(geo, ord1.json, '1T');
  const s = buildEarlyPrefeitoOfficialSummary(ord1.json,'1T');
  const top = Object.entries(s.votesByDisplayKey).sort((a,b)=>b[1]-a[1]).slice(0,3);
  return JSON.stringify({muniCode:ord1.muniCode, baseFeatures: geo.features.length, totalValidos: s.totalValidos, top});
})()`);
console.log('=== PREFEITO RIO 2004 (end-to-end data) ===');
console.log(prefTest);

// Vereador Angra 2000: exercita totais oficiais (QE) + base parcial
const verTest = await fnTest(`(async () => {
  await ensureOfficialTotalsVereadores(2000);
  const vp = await loadVereadorJsonEarly('RJ','ANGRA DOS REIS',2000);
  const keys = new Set(Object.keys(vp.json.RESULTS));
  const geo = await loadMunicipalBaseFromGpkg2006('RJ','ANGRA DOS REIS', vp.muniCode, keys, 'vereador');
  const tot = STATE.officialTotals['vereadores_2000']?.['RJ']?.['ANGRA_DOS_REIS'];
  return JSON.stringify({muniCode:vp.muniCode, baseFeatures: geo.features.length, stats: tot?.stats, topCoal: (tot?.coalitions||[]).slice(0,3).map(c=>[c.raw_comp, c.votes, c.elected])});
})()`);
console.log('=== VEREADOR ANGRA 2000 (end-to-end data) ===');
console.log(verTest);

console.log('=== PAGE EXCEPTIONS ===');
console.log(errors.length ? errors.slice(0, 15).join('\n') : '  (nenhuma)');
console.log('=== CONSOLE ERRORS ===');
console.log(logs.length ? logs.slice(0, 15).join('\n') : '  (nenhum)');

ws.close();
chrome.kill();
process.exit(0);
