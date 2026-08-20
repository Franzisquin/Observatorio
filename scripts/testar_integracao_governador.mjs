/* Integracao ponta a ponta do modo governador, sem browser.
 *
 * Junta as duas metades que os outros harnesses testam separadas: carrega
 * simulador.js com um DOM stubado e um Worker de verdade rodando
 * js/sim_ei_worker.js sobre os pacotes em disco, e percorre o caminho que o
 * usuario percorre — entrar no modo, semear os candidatos de 2022, preencher a
 * migracao, gerar a projecao base e ler o resultado.
 *
 * O que isto pega e o que nenhum dos outros pega: a costura. Nomes de funcao
 * errados, mensagem com formato divergente entre front e worker, indice de
 * coluna trocado entre simColunas() e as origens do pacote.
 *
 *     node scripts/testar_integracao_governador.mjs
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOV = path.join(RAIZ, 'resultados_geo', 'simgov2026');

let falhas = 0;
function ok(cond, nome, detalhe = '') {
  console.log(`${cond ? '  ok  ' : '  FALHA'} ${nome}${detalhe ? '  — ' + detalhe : ''}`);
  if (!cond) falhas++;
}
const perto = (a, b, tol) => Math.abs(a - b) <= tol;

if (!existsSync(path.join(GOV, 'index.json'))) {
  console.error(`Nada em ${GOV}. Rode scripts/gerar_base_governador_2022.py antes.`);
  process.exit(2);
}

// ------------------------------------------------------------- fetch local

const BASE = new URL('file:///' + RAIZ.replace(/\\/g, '/') + '/');

async function fetchLocal(url) {
  const arq = fileURLToPath(new URL(url, BASE));
  let buf;
  try {
    buf = await readFile(arq);
  } catch {
    return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  }
  return {
    ok: true, status: 200,
    json: async () => JSON.parse(buf.toString('utf-8')),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
}

// ------------------------------------------------------- worker de verdade

/* O worker roda no mesmo processo: `postMessage` do front chama o onmessage do
   worker e vice-versa. Assincrono de verdade (o worker faz await em fetch),
   entao o front continua vendo a mesma corrida que veria no browser. */
const fonteWorker = await readFile(path.join(RAIZ, 'js', 'sim_ei_worker.js'), 'utf-8');

function criarWorker() {
  const escopo = { postMessage: null, onmessage: null };
  new Function('self', 'fetch', fonteWorker)(escopo, fetchLocal);
  const lado = {
    onmessage: null,
    postMessage(msg) {
      Promise.resolve()
        .then(() => escopo.onmessage({ data: msg }))
        .catch((e) => { if (lado.onmessage) lado.onmessage({ data: { type: 'error', erro: String(e) } }); });
    },
  };
  escopo.postMessage = (m) => { if (lado.onmessage) lado.onmessage({ data: m }); };
  return lado;
}

// ------------------------------------------------------------- DOM stubado

const noop = () => { };
function elemento(id) {
  const el = {
    id, _filhos: [],
    addEventListener: noop, removeEventListener: noop,
    querySelectorAll: () => [], querySelector: () => null,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    style: {}, dataset: {}, appendChild: noop, click: noop,
    textContent: '', innerHTML: '', hidden: false, value: '', title: '',
    offsetHeight: 0, getContext: () => null,
  };
  return el;
}
const cacheEl = new Map();
const pegar = (id) => {
  if (!cacheEl.has(id)) cacheEl.set(id, elemento(id));
  return cacheEl.get(id);
};

const armazem = new Map();
const localStorageFalso = {
  getItem: (k) => (armazem.has(k) ? armazem.get(k) : null),
  setItem: (k, v) => armazem.set(k, String(v)),
  removeItem: (k) => armazem.delete(k),
};
const janela = {
  addEventListener: noop, localStorage: localStorageFalso,
  confirm: () => true, location: { href: BASE.href },
};
const documento = {
  body: { dataset: {} }, getElementById: pegar, querySelectorAll: () => [],
  querySelector: () => null, createElement: () => elemento(), addEventListener: noop,
};
const MLCompatFalso = {
  buildBasemapStyle: () => ({}), setBasemapTheme: noop, refreshThemeColors: noop,
  augmentMap: noop, fitMapToBounds: noop,
  GeoLayer: function () {
    return { setFeatures: noop, addTo: noop, getBounds: () => ({ isValid: () => false }) };
  },
};

const fonte = await readFile(path.join(RAIZ, 'simulador.js'), 'utf-8');
const M = new Function(
  'window', 'document', 'localStorage', 'maplibregl', 'MLCompat', 'Worker', 'fetch', 'location', 'confirm',
  fonte + `
  ;return { SIM, simCarregarDados, simWorkerInit, simCarregarWorker, entrarModo,
            candidatosPadraoGov, origensLista, simColunas, simColunasValidas,
            idxColuna, prontoParaBase, simCalcular, opsArray, metaGov, ehGov,
            nivelBase, nivelRefino, listaRegioes, pesosDaRegiao, semearRegioesBase,
            entradasDe, resultadoDoEscopo, escopoTopo, simTransferPadrao,
            simFinalistas, simPrecisaSegundoTurno, simRenderTudo, simEnviar,
            nLocaisEscopo, PACK_GOV_URL };`
)(janela, documento, localStorageFalso, {}, MLCompatFalso, criarWorker, fetchLocal,
  { href: BASE.href }, () => true);

// simRenderTudo toca fundo no DOM; aqui so interessa a aritmetica.
M.SIM.__render = M.simRenderTudo;

console.log('Carga dos pacotes');
M.simWorkerInit();                      // cria o Worker antes de simCarregarDados
await M.simCarregarDados();
ok(!!M.SIM.indice, 'pacote presidencial carregado',
  `${Object.keys(M.SIM.indice.ufs).length} UFs`);
ok(!!M.SIM.indiceGov, 'indice de governador carregado',
  `${Object.keys(M.SIM.indiceGov.ufs).length} UFs`);
ok(!!M.SIM.regioes, 'regioes IBGE carregadas');

// ------------------------------------------------------------ modo governador

console.log('\nEntrar no modo governador (RJ)');
{
  // entrarModo termina em simRenderTudo/abrirModal, que sao DOM puro; o que
  // interessa e o estado que ele deixa montado.
  M.SIM.regioesGov = await (await fetchLocal(M.PACK_GOV_URL + 'regioes_RJ.json')).json();
  const r = await M.simEnviar({
    type: 'loadGov', baseDir: new URL(M.PACK_GOV_URL, BASE.href).href, uf: 'RJ',
  });
  ok(r.type === 'govLoaded', 'o worker aceita o pacote do RJ', r.erro || `${r.locais} locais`);

  M.SIM.modo = 'governador';
  M.SIM.ufGov = 'RJ';
  M.SIM.selectedUF = 'RJ';
  M.SIM.escopo = M.escopoTopo();
  M.SIM.candidatos = [];
  M.SIM.proxId = 1;
  M.SIM._cacheRegioes = {};
  M.candidatosPadraoGov();
  M.SIM.transfer = M.simTransferPadrao();

  ok(M.SIM.candidatos.length === 4,
    'candidatos semeados de 2022', M.SIM.candidatos.map((c) => `${c.nome} (${c.partido})`).join(', '));
  ok(M.origensLista().length === M.metaGov().nOrigens,
    'origens do estado ativas', M.origensLista().join(', '));
  ok(M.nLocaisEscopo() === M.SIM.indiceGov.ufs.RJ.locais, 'escopo conta os locais do RJ');

  const ris = M.listaRegioes('ri');
  const rgis = M.listaRegioes('rgi');
  ok(ris.length === 5, 'as RGINT do RJ aparecem', `${ris.length}: ${ris.map((x) => x.nome).join(', ')}`);
  ok(rgis.length > ris.length && rgis.every((x) => x.uf === 'RJ'),
    'as RGI do RJ aparecem e nenhuma vem de outro estado', `${rgis.length} regiões`);
}

console.log('\nProjeção base: migração identidade reproduz 2022');
{
  // Cada origem vai inteira para o candidato que a herda.
  const cols = M.simColunas();
  M.origensLista().forEach((o) => {
    const linha = {};
    cols.forEach((c) => { linha[c.key] = 0; });
    const dono = cols.find((c) => c.cand && c.cand.origem === o);
    if (dono) linha[dono.key] = 100;
    else if (o === 'outros') linha.outros = 100;
    else if (o === 'nulo_branco') linha.nuloBranco = 100;
    else if (o === 'abstencao') linha.abstencao = 100;
    M.SIM.transfer[o] = linha;
  });

  M.SIM.pesosRegiao = {};
  M.SIM.regiaoTocada = {};
  M.SIM._assinaturaMigracao = null;
  M.semearRegioesBase();

  const estado = M.prontoParaBase();
  ok(estado.ok, 'a porta da projeção base abre',
    `migração ${estado.migOk}, regiões ${estado.regOk}`);

  const ops = M.opsArray();
  ok(ops.length === 5 && ops.every((o) => o.scope.nivel === 'ri'),
    'as 5 RGINT viram ops, e só elas', `${ops.length} ops`);

  M.SIM.baseGerada = true;
  M.SIM.calculando = false;
  M.simRenderTudo = noop;               // o resto do render é DOM puro
  await M.simCalcular();

  const res = M.resultadoDoEscopo(M.escopoTopo(), M.SIM.agregado);
  ok(!!res && res.aptos > 12e6, 'o estado tem resultado',
    res ? `${Math.round(res.aptos).toLocaleString('pt-BR')} aptos` : '-');

  const ent = M.entradasDe(res).filter((x) => x.key.startsWith('cand_'));
  const meta = M.metaGov();
  ent.forEach((e) => {
    const cand = M.SIM.candidatos.find((c) => 'cand_' + c.id === e.key);
    const oficial = meta.origens.find((o) => o.key === cand.origem);
    ok(perto(e.pctValidos, oficial.pctValidos, 0.6),
      `${cand.nome} reproduz 2022`,
      `${e.pctValidos.toFixed(2)}% vs ${oficial.pctValidos.toFixed(2)}% oficial`);
  });

  const venc = M.entradasDe(res).filter((x) => x.key.startsWith('cand_'))
    .sort((a, b) => b.votos - a.votos)[0];
  ok(venc.label === 'Cláudio Castro', 'o vencedor de 2022 vence a projeção', venc.label);
  ok(M.simPrecisaSegundoTurno() === false,
    'com 58% dos válidos não há segundo turno');
}

console.log('\nMeta numa RG imediata desloca só aquela região');
{
  const rgi = M.listaRegioes('rgi')[0];
  const cols = M.simColunasValidas();
  const antes = M.resultadoDoEscopo({ level: 'regiao', uf: 'RJ', ibges: rgi.munis }, M.SIM.agregado);
  const pctAntes = M.entradasDe(antes).find((x) => x.key === cols[1].key).pctValidos;

  const alvo = {};
  cols.forEach((c) => { alvo[c.key] = 0; });
  alvo[cols[1].key] = 70;
  alvo[cols[0].key] = 30;
  M.SIM.pesosRegiao[`rgi:${rgi.codigo}`] = { validos: alvo, abstencao: 22, nuloBranco: 6 };
  M.SIM.regiaoTocada[`rgi:${rgi.codigo}`] = true;

  await M.simCalcular();
  const dep = M.resultadoDoEscopo({ level: 'regiao', uf: 'RJ', ibges: rgi.munis }, M.SIM.agregado);
  const pctDep = M.entradasDe(dep).find((x) => x.key === cols[1].key).pctValidos;
  ok(perto(pctDep, 70, 0.6), 'a meta da RGI é atingida',
    `${rgi.nome}: ${pctAntes.toFixed(1)}% -> ${pctDep.toFixed(1)}% (alvo 70%)`);

  const forasteiro = M.SIM.agregado.municipios['3500105'] || M.SIM.agregado.municipios['3550308'];
  ok(!forasteiro, 'nenhum município de fora do RJ entrou no agregado');
}

console.log('\nVoltar ao presidencial pelo mesmo worker');
{
  const r = await M.simEnviar({ type: 'loadGov', uf: null });
  ok(r.type === 'govLoaded' && r.uf === null, 'o worker descarrega o pacote');

  M.SIM.modo = 'presidente';
  M.SIM.ufGov = null;
  M.SIM._cacheRegioes = {};
  M.SIM.candidatos = [];
  M.SIM.proxId = 1;
  M.SIM.ops.clear();
  M.SIM.pesosRegiao = {};
  M.SIM.regiaoTocada = {};
  M.SIM._assinaturaMigracao = null;
  M.SIM.escopo = M.escopoTopo();

  ok(M.origensLista().join(',') === 'lula,bolsonaro,outros,nulo_branco,abstencao',
    'as origens voltam a ser as presidenciais');
  ok(M.listaRegioes('mr').length === 5, 'as 5 macrorregiões voltam');
  ok(M.nLocaisEscopo() === 95096, 'o escopo volta a ser o país',
    `${M.nLocaisEscopo().toLocaleString('pt-BR')} locais`);
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo ok');
process.exit(falhas ? 1 : 0);
