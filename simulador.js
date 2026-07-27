// ============================================================================
// SIMULADOR ELEITORAL 2026
//
// Unidade de simulacao: local de votacao, com o ELEITORADO DE 2026 do TSE
// (perfil por secao, agregado por local em scripts/gerar_eleitorado_2026.py).
//
// A migracao de 2022 e o pilar: a superficie inicial de votos nasce de aplicar
// a matriz de transferencia sobre a composicao de 2022 de cada local. As
// edicoes demograficas sao perturbacoes aditivas sobre esse prior, resolvidas
// por regressao ecologica em js/sim_ei_worker.js.
// ============================================================================

'use strict';

const DATA_BASE_URL = 'resultados_geo/';
const PACK_URL = DATA_BASE_URL + 'sim2026/';

// ---------------------------------------------------------------- constantes

const PARTY_COLORS = new Map(Object.entries({
  'AVANTE': '#36aeba', 'CIDADANIA': '#ec5fa6', 'DC': '#809eff', 'MDB': '#16a250',
  'MISSÃO': '#fdbe21', 'MOBILIZA': '#DD3333', 'NOVO': '#ff6600', 'PCB': '#c40823',
  'PCDOB': '#b4251d', 'PCO': '#8e3d10', 'PDT': '#ffad99', 'PL': '#304091',
  'PMN': '#ff3333', 'PODE': '#23a840', 'PP': '#6391d4', 'PRD': '#007c3c',
  'PRTB': '#1a7e2f', 'PSB': '#edd355', 'PSC': '#2f8e4f', 'PSD': '#eb8100',
  'PSDB': '#0097fd', 'PSOL': '#e95dd2', 'PSTU': '#620411', 'PT': '#ff3859',
  'PV': '#1f9439', 'REDE': '#7dd1d9', 'REPUBLICANOS': '#1f646b',
  'SOLIDARIEDADE': '#ff633d', 'UNIÃO': '#2eccff', 'UP': '#5e5e5e', 'AGIR': '#254d88'
}));

// Eixo esquerda(-1) .. direita(+1). Alimenta os defaults da matriz de
// transferencia e do 2o turno; e sempre editavel por candidato.
const POS_PARTIDO = {
  'PSOL': -1.00, 'PCB': -0.95, 'PCDOB': -0.90, 'PSTU': -0.95, 'UP': -1.00,
  'PT': -0.85, 'PDT': -0.50, 'REDE': -0.40, 'PV': -0.30, 'PSB': -0.30,
  'CIDADANIA': 0.00, 'PMN': 0.10, 'MDB': 0.10, 'SOLIDARIEDADE': 0.20,
  'PSDB': 0.15, 'PSD': 0.25, 'AVANTE': 0.30, 'PODE': 0.30, 'MOBILIZA': 0.10,
  'UNIÃO': 0.40, 'AGIR': 0.40, 'PRD': 0.40, 'PP': 0.45, 'REPUBLICANOS': 0.50,
  'DC': 0.50, 'PSC': 0.60, 'NOVO': 0.70, 'PL': 0.80, 'MISSÃO': 0.85, 'PRTB': 0.90
};

// Dispersao do kernel de transferencia (portado de EUA Proporcional/scripts/16_irv.py).
const TAU = 0.34;

// Posicao das origens de 2022 e quanto de cada uma sobra para candidatos.
const ORIGENS_2022 = {
  lula: { pos: -0.85, rotulo: 'Votou Lula (2T)', paraCand: 0.88, outros: 0.03, nulo: 0.03, abst: 0.06 },
  bolsonaro: { pos: 0.80, rotulo: 'Votou Bolsonaro (2T)', paraCand: 0.86, outros: 0.03, nulo: 0.03, abst: 0.08 },
  nulo_branco: { pos: 0.00, rotulo: 'Nulo ou branco', paraCand: 0.20, outros: 0.05, nulo: 0.50, abst: 0.25 },
  abstencao: { pos: 0.00, rotulo: 'Não compareceu', paraCand: 0.08, outros: 0.02, nulo: 0.02, abst: 0.88 }
};

const UF_MAP = new Map([
  ['AC', 'Acre'], ['AL', 'Alagoas'], ['AP', 'Amapá'], ['AM', 'Amazonas'], ['BA', 'Bahia'],
  ['CE', 'Ceará'], ['DF', 'Distrito Federal'], ['ES', 'Espírito Santo'], ['GO', 'Goiás'],
  ['MA', 'Maranhão'], ['MT', 'Mato Grosso'], ['MS', 'Mato Grosso do Sul'], ['MG', 'Minas Gerais'],
  ['PA', 'Pará'], ['PB', 'Paraíba'], ['PR', 'Paraná'], ['PE', 'Pernambuco'], ['PI', 'Piauí'],
  ['RJ', 'Rio de Janeiro'], ['RN', 'Rio Grande do Norte'], ['RS', 'Rio Grande do Sul'],
  ['RO', 'Rondônia'], ['RR', 'Roraima'], ['SC', 'Santa Catarina'], ['SP', 'São Paulo'],
  ['SE', 'Sergipe'], ['TO', 'Tocantins']
]);

const COR_OUTROS = '#7a8699';
const COR_NULO = '#9aa0a6';
const COR_ABST = '#4a5058';

// ------------------------------------------------------------------- estado

const SIM = {
  indice: null,            // sim2026/index.json
  baselineNacional: null,
  baselineUF: {},          // UF -> baseline
  baselineMuni: {},        // UF -> { ibge: {...} }
  regioes: null,           // regioes_ibge.json
  nomesMuni: {},           // ibge -> nome

  candidatos: [],          // { id, nome, partido, cor, pos }
  proxId: 1,
  transfer: {},            // origem -> { colKey: pct 0..100 }

  ops: new Map(),          // chaveEscopo -> { scope, general, demo }
  escopo: { level: 'nacional' },

  agregado: null,          // ultimo resultado do worker (1T)
  agregado2T: null,
  support: null,           // apoio demografico do escopo ativo
  shares: null,            // composicao do escopo ativo
  tocados: new Set(),      // 'dim|bucket' editados pelo usuario nesta sessao

  turno: 1,
  t2: { finalistas: null, matriz: null, comparecimento: 0 },

  selectedUF: null,
  selectedMuni: null,
  abaSidebar: 'resultado',
  paneAtivo: 'candidatos',

  estadosGeoJSON: null,
  muniGeoCache: {},
  locaisGeoCache: {},
  estadosLayer: null,
  municipiosLayer: null,
  locaisLayer: null,
  calculando: false,
  pendente: false
};

let simMap = null;
let simWorker = null;
let simMapResizeObserver = null;
let simMapRefreshFrame = 0;
let simMapRefreshTimeout = 0;
let simMapLastSize = { width: 0, height: 0 };

// --------------------------------------------------------------------- utils

function escapeHtml(t) {
  if (typeof t !== 'string') return t;
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function fmtInt(n) { return Math.round(n || 0).toLocaleString('pt-BR'); }
function fmtPct(p, d = 1) { return isFinite(p) ? p.toFixed(d).replace('.', ',') + '%' : '–'; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function normalizePartyKey(p) {
  return String(p || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toUpperCase();
}
function getPartyColor(partido) {
  const alvo = normalizePartyKey(partido);
  for (const [k, v] of PARTY_COLORS) if (normalizePartyKey(k) === alvo) return v;
  return null;
}
function getPartyPos(partido) {
  const alvo = normalizePartyKey(partido);
  for (const k in POS_PARTIDO) if (normalizePartyKey(k) === alvo) return POS_PARTIDO[k];
  return 0;
}

function hexToHSL(H) {
  let r = 0, g = 0, b = 0;
  if (H.length === 4) { r = '0x' + H[1] + H[1]; g = '0x' + H[2] + H[2]; b = '0x' + H[3] + H[3]; }
  else if (H.length === 7) { r = '0x' + H[1] + H[2]; g = '0x' + H[3] + H[4]; b = '0x' + H[5] + H[6]; }
  r /= 255; g /= 255; b /= 255;
  const cmin = Math.min(r, g, b), cmax = Math.max(r, g, b), delta = cmax - cmin;
  let h = 0, s = 0, l = (cmax + cmin) / 2;
  if (delta !== 0) {
    if (cmax === r) h = ((g - b) / delta) % 6;
    else if (cmax === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    s = delta / (1 - Math.abs(2 * l - 1));
  }
  h = Math.round(h * 60); if (h < 0) h += 360;
  return { h, s: s * 100, l: l * 100 };
}
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  const f = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return '#' + f(r) + f(g) + f(b);
}
/* Margem 0..50pp -> clareia a cor do vencedor. Mesma rampa do visualizador. */
function getUniversalGradientColor(base, margemPct) {
  if (!base) return '#3a3a3a';
  const { h, s } = hexToHSL(base);
  const t = Math.pow(clamp(margemPct / 40, 0, 1), 1.35);
  const claro = document.body.dataset.theme === 'light';
  const lMax = claro ? 92 : 78, lMin = claro ? 46 : 30;
  return hslToHex(h, Math.max(18, s * (0.45 + 0.55 * t)), lMax - (lMax - lMin) * t);
}

// -------------------------------------------------------- refresh do mapa

function getElementClientSize(el) {
  if (!el) return { width: 0, height: 0 };
  const r = el.getBoundingClientRect();
  return { width: Math.round(r.width), height: Math.round(r.height) };
}
function flushSimMapRefresh(opts = {}) {
  if (!simMap) return;
  const cont = simMap.getContainer && simMap.getContainer();
  const tam = getElementClientSize(cont);
  if (!tam.width || !tam.height) return;
  if (!opts.force && tam.width === simMapLastSize.width && tam.height === simMapLastSize.height) return;
  simMapLastSize = tam;
  try { simMap.resize(); } catch (e) { /* estilo ainda trocando */ }
}
function scheduleSimMapRefresh(opts = {}) {
  if (simMapRefreshFrame) cancelAnimationFrame(simMapRefreshFrame);
  simMapRefreshFrame = requestAnimationFrame(() => {
    simMapRefreshFrame = 0;
    flushSimMapRefresh(opts);
  });
  clearTimeout(simMapRefreshTimeout);
  simMapRefreshTimeout = setTimeout(() => flushSimMapRefresh(opts), 180);
}
function setupSimMapRefreshObservers() {
  const cont = simMap && simMap.getContainer && simMap.getContainer();
  if (!cont || simMapResizeObserver || typeof ResizeObserver === 'undefined') return;
  simMapResizeObserver = new ResizeObserver(() => scheduleSimMapRefresh());
  simMapResizeObserver.observe(cont);
  window.addEventListener('resize', () => scheduleSimMapRefresh());
}

// -------------------------------------------------------------- colunas

/* A ordem definida aqui e a ordem das colunas no vetor de votos do worker.
   Mudar aqui muda o significado de todos os indices — nunca reordenar sem
   recalcular. */
function simColunas() {
  return SIM.candidatos.map(c => ({ key: 'cand_' + c.id, label: c.nome || `Candidato ${c.id}`, cor: c.cor, cand: c }))
    .concat([
      { key: 'outros', label: 'Outros', cor: COR_OUTROS },
      { key: 'nuloBranco', label: 'Nulos e brancos', cor: COR_NULO },
      { key: 'abstencao', label: 'Abstenção', cor: COR_ABST }
    ]);
}
function simColunasValidas() {
  return simColunas().filter(c => c.key !== 'nuloBranco' && c.key !== 'abstencao');
}
function idxColuna(key) { return simColunas().findIndex(c => c.key === key); }

function origensLista() {
  const d = SIM.indice && SIM.indice.dimensions.find(x => x.key === 'voto2022');
  return d ? d.buckets.map(b => b.key) : Object.keys(ORIGENS_2022);
}

// ------------------------------------------------------- candidatos

function simAddCandidato(nome = '', partido = '') {
  const c = {
    id: SIM.proxId++, nome, partido,
    cor: getPartyColor(partido) || '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'),
    pos: getPartyPos(partido)
  };
  SIM.candidatos.push(c);
  return c;
}
function simRemoveCandidato(id) {
  SIM.candidatos = SIM.candidatos.filter(c => c.id !== id);
  const k = 'cand_' + id;
  for (const o in SIM.transfer) delete SIM.transfer[o][k];
  // As ops guardam vetores posicionais; ao mudar o numero de colunas elas
  // deixam de fazer sentido e sao descartadas em vez de reindexadas errado.
  SIM.ops.clear();
  SIM.t2.finalistas = null;
}

// ------------------------------------------------- matriz de transferencia

/* Kernel espacial: quanto mais perto no eixo ideologico, mais voto herda.
   Mesma forma de EUA Proporcional/scripts/16_irv.py (exp(-|dx|/TAU)). */
function pesosKernel(pos, candidatos) {
  if (!candidatos.length) return [];
  const w = candidatos.map(c => Math.exp(-Math.abs(pos - c.pos) / TAU));
  const s = w.reduce((a, b) => a + b, 0);
  return s > 0 ? w.map(v => v / s) : candidatos.map(() => 1 / candidatos.length);
}

function simTransferPadrao() {
  const t = {};
  for (const origem of origensLista()) {
    const cfg = ORIGENS_2022[origem] || ORIGENS_2022.abstencao;
    const linha = {};
    const w = pesosKernel(cfg.pos, SIM.candidatos);
    SIM.candidatos.forEach((c, i) => { linha['cand_' + c.id] = 100 * cfg.paraCand * w[i]; });
    linha.outros = 100 * cfg.outros;
    linha.nuloBranco = 100 * cfg.nulo;
    linha.abstencao = 100 * cfg.abst;
    t[origem] = linha;
  }
  return t;
}

function simTransferMatriz() {
  const cols = simColunas();
  return origensLista().map(o => {
    const linha = SIM.transfer[o] || {};
    return cols.map(c => (linha[c.key] || 0) / 100);
  });
}

function simTransferTotal(origem) {
  const linha = SIM.transfer[origem] || {};
  return simColunas().reduce((s, c) => s + (linha[c.key] || 0), 0);
}

// ------------------------------------------------------------- escopo / ops

function chaveEscopo(e) {
  if (!e || e.level === 'nacional') return 'nacional';
  if (e.level === 'uf') return 'uf:' + e.uf;
  if (e.level === 'regiao') return 'reg:' + e.regiao;
  return 'mun:' + (e.ibges || []).join(',');
}
function rotuloEscopo(e) {
  if (!e || e.level === 'nacional') return 'Brasil';
  if (e.level === 'uf') return UF_MAP.get(e.uf) || e.uf;
  if (e.level === 'regiao') return e.nome || 'Região';
  return SIM.nomesMuni[e.ibges && e.ibges[0]] || 'Município';
}
function opDoEscopo(e, criar = false) {
  const k = chaveEscopo(e);
  let op = SIM.ops.get(k);
  if (!op && criar) { op = { scope: e, general: null, demo: {} }; SIM.ops.set(k, op); }
  return op;
}
function opsArray() {
  return Array.from(SIM.ops.values()).filter(
    o => o.general || (o.demo && Object.keys(o.demo).length));
}

// ------------------------------------------------------------------ worker

function simWorkerInit() {
  simWorker = new Worker('js/sim_ei_worker.js');
  simWorker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === 'progress') return simProgresso(m.value, m.label);
    if (m.type === 'error') {
      console.error('[worker]', m.erro);
      simProgresso(0, null);
      simAvisar('Erro no cálculo: ' + m.erro);
      SIM.calculando = false;
      return;
    }
    const resolver = SIM._aguardando && SIM._aguardando[m.reqId];
    if (resolver) { delete SIM._aguardando[m.reqId]; resolver(m); }
  };
}

let _reqId = 0;
function simEnviar(msg) {
  return new Promise((resolve) => {
    const id = ++_reqId;
    SIM._aguardando = SIM._aguardando || {};
    SIM._aguardando[id] = resolve;
    simWorker.postMessage(Object.assign({ reqId: id }, msg));
  });
}
function simCarregarWorker() {
  return new Promise((resolve, reject) => {
    const antes = simWorker.onmessage;
    simWorker.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === 'progress') return simProgresso(m.value, m.label);
      if (m.type === 'loaded') { simWorker.onmessage = antes; return resolve(m); }
      if (m.type === 'error') { simWorker.onmessage = antes; return reject(new Error(m.erro)); }
    };
    simWorker.postMessage({ type: 'load', baseDir: PACK_URL });
  });
}

function simProgresso(v, rotulo) {
  const box = document.getElementById('simProgress');
  const fill = document.getElementById('simProgressFill');
  const lab = document.getElementById('simProgressLabel');
  if (!box) return;
  if (v <= 0 || v >= 1) { box.hidden = true; return; }
  box.hidden = false;
  fill.style.width = Math.round(v * 100) + '%';
  lab.textContent = rotulo || '';
}

function simAvisar(txt) {
  const el = document.getElementById('simNavFoot');
  if (el) el.innerHTML = `<div class="sim-warn">${escapeHtml(txt)}</div>`;
}

/* Recalcula tudo. O worker refaz o replay do zero a cada chamada, entao nao ha
   estado acumulado para invalidar. Chamadas concorrentes sao coalescidas. */
async function simCalcular() {
  if (SIM.calculando) { SIM.pendente = true; return; }
  SIM.calculando = true;
  try {
    const r = await simEnviar({
      type: 'compute',
      parties: simColunas().length,
      transfer: simTransferMatriz(),
      ops: opsArray(),
      activeScope: SIM.escopo
    });
    if (r.type !== 'result') throw new Error('resposta inesperada');
    SIM.agregado = r.agregado;
    SIM._seloCalculo = (SIM._seloCalculo || 0) + 1;   // invalida o cache de detalhe
    if (r.demoSupport) simAplicarSupport(r.demoSupport);
    await simCalcular2T();
    simRenderTudo();
  } catch (e) {
    console.error(e);
    simAvisar('Falha no cálculo: ' + e.message);
  } finally {
    SIM.calculando = false;
    if (SIM.pendente) { SIM.pendente = false; simCalcular(); }
  }
}

/* As dimensoes NAO editadas passam a refletir o apoio observado depois da
   redistribuicao (editar religiao move os sliders de escolaridade, etc.).
   Buckets que o usuario tocou nesta sessao ficam intactos. */
function simAplicarSupport(novo) {
  if (!SIM.support) { SIM.support = novo; return; }
  for (const dim in novo) {
    if (!SIM.support[dim]) { SIM.support[dim] = novo[dim]; continue; }
    novo[dim].forEach((linha, i) => {
      if (!SIM.tocados.has(dim + '|' + i)) SIM.support[dim][i] = linha;
    });
  }
}

// ------------------------------------------------------------------ dados

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' — HTTP ' + r.status);
  return r.json();
}

async function simCarregarDados() {
  const loader = document.getElementById('mapLoader');
  const diz = t => { if (loader) loader.textContent = t; };

  diz('Carregando eleitorado de 2026…');
  SIM.indice = await fetchJSON(PACK_URL + 'index.json');

  diz('Carregando estimativas demográficas…');
  SIM.baselineNacional = await fetchJSON(PACK_URL + 'baselines/nacional.json').catch(() => null);
  SIM.shares = SIM.baselineNacional ? SIM.baselineNacional.shares : null;
  SIM.qualidade = await fetchJSON(PACK_URL + 'baselines/qualidade.json').catch(() => null);

  diz('Carregando geografia…');
  SIM.estadosGeoJSON = await fetchJSON(DATA_BASE_URL + 'estados_brasil.geojson').catch(() => null);
  SIM.regioes = await fetchJSON(DATA_BASE_URL + 'regioes_ibge.json').catch(() => null);

  // Os nomes dos municipios saem do proprio regioes_ibge.json, que ja e
  // indexado por codigo IBGE. lista_municipios.json e {UF: [nomes]}, sem
  // codigo, e por isso nao serve aqui.
  if (SIM.regioes && SIM.regioes.muni_to_region) {
    for (const ibge in SIM.regioes.muni_to_region) {
      const nome = SIM.regioes.muni_to_region[ibge].nome;
      if (nome) SIM.nomesMuni[Number(ibge)] = nome;
    }
  }

  diz('Carregando pacotes por estado…');
  await simCarregarWorker();
}

async function baselineDaUF(uf) {
  if (!SIM.baselineUF[uf]) {
    SIM.baselineUF[uf] = await fetchJSON(PACK_URL + `baselines/uf/${uf}.json`).catch(() => null);
  }
  return SIM.baselineUF[uf];
}
async function baselineDosMunis(uf) {
  if (!SIM.baselineMuni[uf]) {
    SIM.baselineMuni[uf] = await fetchJSON(PACK_URL + `baselines/muni/${uf}.json`).catch(() => ({}));
  }
  return SIM.baselineMuni[uf];
}

/* Composicao do escopo ativo: alimenta a previa instantanea (produto escalar
   participacao . apoio) enquanto o slider e arrastado, sem ir ao worker. */
async function simAtualizarShares() {
  const e = SIM.escopo;
  if (e.level === 'nacional') {
    SIM.shares = SIM.baselineNacional ? SIM.baselineNacional.shares : null;
  } else if (e.level === 'uf') {
    const b = await baselineDaUF(e.uf);
    SIM.shares = b ? b.shares : null;
  } else if (e.level === 'municipio' && e.uf) {
    const m = await baselineDosMunis(e.uf);
    const r = m[String(e.ibges[0])];
    SIM.shares = r ? r.shares : null;
  } else {
    const r = await simEnviar({ type: 'shares', scope: e });
    SIM.shares = r.shares;
  }
}

// ------------------------------------------------------- leitura de resultado

function resultadoDoEscopo(e, agregado) {
  const ag = agregado || SIM.agregado;
  if (!ag) return null;
  if (!e || e.level === 'nacional') return ag.brasil;
  if (e.level === 'uf') return ag.ufs[e.uf] || null;
  if (e.level === 'municipio' || e.level === 'regiao') {
    const alvo = e.ibges || [];
    const cols = simColunas().length;
    const acc = { aptos: 0, votos: new Array(cols).fill(0) };
    alvo.forEach(ib => {
      const m = ag.municipios[String(ib)];
      if (!m) return;
      acc.aptos += m.aptos;
      for (let p = 0; p < cols; p++) acc.votos[p] += m.votos[p];
    });
    return acc;
  }
  return null;
}

function entradasDe(res) {
  if (!res || !res.votos) return [];
  const cols = simColunas();
  // O vetor pode estar defasado por um instante logo apos mexer nos candidatos,
  // entre a edicao e o recalculo — le-se com fallback em vez de estourar.
  const v = i => res.votos[i] || 0;
  const validos = cols.reduce((s, c, i) =>
    (c.key === 'nuloBranco' || c.key === 'abstencao') ? s : s + v(i), 0);
  return cols.map((c, i) => ({
    key: c.key, label: c.label, cor: c.cor, votos: v(i),
    pctValidos: validos > 0 && c.key !== 'nuloBranco' && c.key !== 'abstencao'
      ? 100 * v(i) / validos : 0,
    pctAptos: res.aptos > 0 ? 100 * v(i) / res.aptos : 0
  }));
}
function vencedorDe(res) {
  const e = entradasDe(res).filter(x => x.key !== 'nuloBranco' && x.key !== 'abstencao');
  e.sort((a, b) => b.votos - a.votos);
  return e[0] || null;
}
function margemDe(res) {
  const e = entradasDe(res).filter(x => x.key !== 'nuloBranco' && x.key !== 'abstencao')
    .sort((a, b) => b.votos - a.votos);
  return e.length > 1 ? (e[0].pctValidos - e[1].pctValidos) : (e.length ? 100 : 0);
}

// ============================================================================
// SEGUNDO TURNO
// ============================================================================

/* O 2o turno reusa a maquina inteira: aplica a matriz de transferencia sobre o
   resultado do 1o turno, por local, e reagrega. Cada eliminado distribui sua
   pilha entre os dois finalistas, nulo/branco e abstencao.

   Como o worker devolve o detalhe por local so das UFs abertas, o 2o turno e
   calculado sobre os agregados (Brasil, UF, municipio) — que e a granularidade
   em que ele e exibido. As linhas da matriz podem ser abertas por grupo
   demografico, e ai a transferencia usa o apoio estimado do grupo. */
function simFinalistas() {
  if (SIM.t2.finalistas && SIM.t2.finalistas.length === 2) return SIM.t2.finalistas;
  const e = entradasDe(SIM.agregado && SIM.agregado.brasil)
    .filter(x => x.key.startsWith('cand_'))
    .sort((a, b) => b.votos - a.votos);
  return e.slice(0, 2).map(x => x.key);
}

function simPrecisaSegundoTurno() {
  const e = entradasDe(SIM.agregado && SIM.agregado.brasil)
    .filter(x => x.key !== 'nuloBranco' && x.key !== 'abstencao')
    .sort((a, b) => b.votos - a.votos);
  return e.length > 1 && e[0].pctValidos < 50;
}

function simMatriz2TPadrao(finalistas) {
  const cols = simColunas();
  const fin = finalistas.map(k => cols.find(c => c.key === k)).filter(Boolean);
  if (fin.length < 2) return {};
  const posFin = fin.map(f => (f.cand ? f.cand.pos : 0));
  const m = {};
  cols.forEach(c => {
    if (finalistas.includes(c.key)) return;
    let pos, retencao;
    if (c.key === 'abstencao') { pos = 0; retencao = 0.22; }
    else if (c.key === 'nuloBranco') { pos = 0; retencao = 0.45; }
    else if (c.key === 'outros') { pos = 0.1; retencao = 0.72; }
    else { pos = c.cand ? c.cand.pos : 0; retencao = 0.78; }

    const w = posFin.map(p => Math.exp(-Math.abs(pos - p) / TAU));
    const s = w.reduce((a, b) => a + b, 0) || 1;
    const linha = {};
    fin.forEach((f, i) => { linha[f.key] = 100 * retencao * w[i] / s; });
    // O que nao vai para nenhum finalista se divide entre nulo e abstencao —
    // no 2o turno a rejeicao aos dois nomes vira voto branco ou ausencia.
    const sobra = 100 * (1 - retencao);
    linha.nuloBranco = sobra * (c.key === 'abstencao' ? 0.15 : 0.45);
    linha.abstencao = sobra * (c.key === 'abstencao' ? 0.85 : 0.55);
    m[c.key] = linha;
  });
  return m;
}

/* Aplica a matriz de transferencia a um resultado de 1o turno. Linear, entao
   vale igual para o Brasil, uma UF, um municipio ou um local isolado. */
function transformar2T(res) {
  if (!res || !SIM.t2.matriz || !SIM.t2.finalistasAtivos) return null;
  const finalistas = SIM.t2.finalistasAtivos;
  const cols = simColunas();
  const nCol = cols.length;
  const iA = idxColuna(finalistas[0]), iB = idxColuna(finalistas[1]);
  const iNulo = idxColuna('nuloBranco'), iAbst = idxColuna('abstencao');
  if (iA < 0 || iB < 0) return null;

  const saida = new Array(nCol).fill(0);
  saida[iA] = res.votos[iA];
  saida[iB] = res.votos[iB];
  for (let p = 0; p < nCol; p++) {
    if (p === iA || p === iB) continue;
    const v = res.votos[p];
    if (!v) continue;
    const linha = SIM.t2.matriz[cols[p].key];
    if (!linha) { saida[iAbst] += v; continue; }
    const tot = Object.values(linha).reduce((a, b) => a + b, 0);
    if (tot <= 0) { saida[iAbst] += v; continue; }
    saida[iA] += v * (linha[finalistas[0]] || 0) / tot;
    saida[iB] += v * (linha[finalistas[1]] || 0) / tot;
    saida[iNulo] += v * (linha.nuloBranco || 0) / tot;
    saida[iAbst] += v * (linha.abstencao || 0) / tot;
  }
  return { aptos: res.aptos, votos: saida.map(x => Math.round(x)) };
}

/* O 2o turno e calculado no worker, local a local. Fazer isso sobre o agregado
   nacional daria o mesmo numero apenas quando a transferencia e uniforme; local
   a local ela pode variar por grupo demografico (SIM.t2.porGrupo), que e onde a
   inferencia ecologica paga. `transformar2T` fica como fallback sincrono para o
   caso de o worker ainda nao ter respondido. */
async function simCalcular2T() {
  if (!SIM.agregado) { SIM.agregado2T = null; return; }
  const finalistas = simFinalistas();
  if (finalistas.length < 2) { SIM.agregado2T = null; SIM.t2.finalistasAtivos = null; return; }
  SIM.t2.finalistasAtivos = finalistas;

  const assinatura = finalistas.join('|') + ':' + SIM.candidatos.map(c => c.id).join(',');
  if (!SIM.t2.matriz || SIM.t2.chaveMatriz !== assinatura) {
    SIM.t2.matriz = simMatriz2TPadrao(finalistas);
    SIM.t2.chaveMatriz = assinatura;
    SIM.t2.porGrupo = null;
  }

  const cols = simColunas();
  const iA = idxColuna(finalistas[0]), iB = idxColuna(finalistas[1]);
  const iNulo = idxColuna('nuloBranco'), iAbst = idxColuna('abstencao');

  const paraVetor = (linha) => [
    (linha[finalistas[0]] || 0) / 100, (linha[finalistas[1]] || 0) / 100,
    (linha.nuloBranco || 0) / 100, (linha.abstencao || 0) / 100];

  const matriz = {};
  cols.forEach((c, p) => {
    if (p === iA || p === iB) return;
    matriz[p] = paraVetor(SIM.t2.matriz[c.key] || {});
  });

  let porGrupo = null;
  const pg = SIM.t2.porGrupo;
  if (pg && pg.dim && pg.linhas && Object.keys(pg.linhas).length) {
    const linhas = {};
    for (const bi in pg.linhas) {
      linhas[bi] = {};
      for (const colKey in pg.linhas[bi]) {
        linhas[bi][idxColuna(colKey)] = paraVetor(pg.linhas[bi][colKey]);
      }
    }
    porGrupo = { dim: pg.dim, linhas };
  }

  const r = await simEnviar({
    type: 'turno2', finalistas: [iA, iB], iNulo, iAbst, matriz, porGrupo
  });
  SIM.agregado2T = (r && r.agregado) || null;
  SIM._selo2T = (SIM._selo2T || 0) + 1;
}

/* Votos por local de uma UF, servidos da ultima superficie do worker. Nao
   dispara replay: abrir um estado nao pode custar um recalculo inteiro. */
async function detalheDaUF(uf) {
  const turno = SIM.turno === 2 && SIM.agregado2T ? 2 : 1;
  const selo = `${SIM._seloCalculo || 0}:${SIM._selo2T || 0}:${turno}`;
  SIM._detalhe = SIM._detalhe || {};
  if (SIM._detalhe.uf === uf && SIM._detalhe.selo === selo) return SIM._detalhe.votos;
  const r = await simEnviar({ type: 'detail', uf, turno });
  SIM._detalhe = { uf, votos: r && r.votos, selo };
  return SIM._detalhe.votos;
}

function agregadoAtivo() {
  return (SIM.turno === 2 && SIM.agregado2T) ? SIM.agregado2T : SIM.agregado;
}

// ============================================================================
// UI — MODAL
// ============================================================================

function abrirModal(pane) {
  if (pane) SIM.paneAtivo = pane;
  document.getElementById('simConfigOverlay').classList.add('visible');
  simRenderModal();
}
function fecharModal() {
  document.getElementById('simConfigOverlay').classList.remove('visible');
}

function simRenderModal() {
  document.querySelectorAll('#simModalNav .sim-nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.pane === SIM.paneAtivo);
  });
  ['candidatos', 'cenario', 'demografia', 'regioes', 'turno2'].forEach(p => {
    const el = document.getElementById('simPane' + p.charAt(0).toUpperCase() + p.slice(1));
    if (el) el.hidden = (p !== SIM.paneAtivo);
  });
  const hint = document.getElementById('simModalScopeHint');
  if (hint) {
    const n = SIM.indice ? Object.values(SIM.indice.ufs).reduce((a, b) => a + b, 0) : 0;
    hint.textContent = `${rotuloEscopo(SIM.escopo)} — ${fmtInt(n)} locais de votação, eleitorado de 2026`;
  }
  if (SIM.paneAtivo === 'candidatos') renderPaneCandidatos();
  if (SIM.paneAtivo === 'cenario') renderPaneCenario();
  if (SIM.paneAtivo === 'demografia') renderPaneDemografia();
  if (SIM.paneAtivo === 'regioes') renderPaneRegioes();
  if (SIM.paneAtivo === 'turno2') renderPaneTurno2();
  renderNavFoot();
}

function renderNavFoot() {
  const el = document.getElementById('simNavFoot');
  if (!el) return;
  const res = SIM.agregado && SIM.agregado.brasil;
  if (!res) { el.innerHTML = ''; return; }
  const ent = entradasDe(res).filter(x => x.key.startsWith('cand_') || x.key === 'outros')
    .sort((a, b) => b.votos - a.votos).slice(0, 3);
  el.innerHTML = `<div class="sim-nav-preview">
      <span class="sim-nav-preview-tit">Prévia nacional</span>
      ${ent.map(e => `<div class="sim-mini-row">
        <i style="background:${e.cor}"></i>
        <span>${escapeHtml(e.label)}</span>
        <b>${fmtPct(e.pctValidos)}</b>
      </div>`).join('')}
      ${SIM.ops.size ? `<div class="sim-nav-ops">${SIM.ops.size} ajuste(s) ativo(s)</div>` : ''}
    </div>`;
}

// ------------------------------------------------------ pane: candidatos

function renderPaneCandidatos() {
  const el = document.getElementById('simPaneCandidatos');
  el.innerHTML = `
    <header class="sim-pane-head">
      <h4>Candidatos</h4>
      <p>Quem disputa o primeiro turno. A posição no eixo esquerda–direita
         define os valores iniciais da migração de 2022 e da transferência de
         segundo turno — os dois continuam editáveis depois.</p>
    </header>
    <div class="sim-cand-list" id="simCandList">
      ${SIM.candidatos.map(c => `
        <div class="sim-cand-item" data-id="${c.id}">
          <input type="color" class="sim-cand-color" value="${c.cor}" data-id="${c.id}" title="Cor">
          <input type="text" class="sim-cand-nome" value="${escapeHtml(c.nome)}" placeholder="Nome" data-id="${c.id}">
          <input type="text" class="sim-cand-partido" value="${escapeHtml(c.partido)}" placeholder="Partido"
                 list="sim-party-list" data-id="${c.id}">
          <label class="sim-cand-pos" title="Posição no eixo esquerda (-1) a direita (+1)">
            <input type="range" min="-1" max="1" step="0.05" value="${c.pos}" data-id="${c.id}">
            <span>${c.pos > 0 ? '+' : ''}${c.pos.toFixed(2)}</span>
          </label>
          <button class="sim-cand-remove" data-id="${c.id}" title="Remover">✕</button>
        </div>`).join('')}
    </div>
    <button class="sim-btn sim-btn-add" id="btnAddCand">+ Adicionar candidato</button>
    <div class="sim-perene-group">
      <div class="sim-perene-item"><i class="sim-perene-dot" style="background:${COR_OUTROS}"></i>
        Outros — candidaturas menores, sempre presentes</div>
      <div class="sim-perene-item"><i class="sim-perene-dot" style="background:${COR_NULO}"></i>
        Nulos e brancos</div>
      <div class="sim-perene-item"><i class="sim-perene-dot" style="background:${COR_ABST}"></i>
        Abstenção — o eleitorado apto de 2026 é o total fixo</div>
    </div>`;

  el.querySelectorAll('.sim-cand-nome').forEach(i => i.addEventListener('input', e => {
    const c = SIM.candidatos.find(x => x.id === +e.target.dataset.id);
    if (c) { c.nome = e.target.value; renderNavFoot(); }
  }));
  el.querySelectorAll('.sim-cand-partido').forEach(i => i.addEventListener('change', e => {
    const c = SIM.candidatos.find(x => x.id === +e.target.dataset.id);
    if (!c) return;
    c.partido = e.target.value;
    const cor = getPartyColor(c.partido);
    if (cor) c.cor = cor;
    c.pos = getPartyPos(c.partido);
    SIM.transfer = simTransferPadrao();
    renderPaneCandidatos();
  }));
  el.querySelectorAll('.sim-cand-color').forEach(i => i.addEventListener('input', e => {
    const c = SIM.candidatos.find(x => x.id === +e.target.dataset.id);
    if (c) c.cor = e.target.value;
  }));
  el.querySelectorAll('.sim-cand-pos input').forEach(i => i.addEventListener('input', e => {
    const c = SIM.candidatos.find(x => x.id === +e.target.dataset.id);
    if (!c) return;
    c.pos = parseFloat(e.target.value);
    e.target.nextElementSibling.textContent = (c.pos > 0 ? '+' : '') + c.pos.toFixed(2);
  }));
  el.querySelectorAll('.sim-cand-pos input').forEach(i => i.addEventListener('change', () => {
    SIM.transfer = simTransferPadrao();
    SIM.t2.chaveMatriz = null;
  }));
  el.querySelectorAll('.sim-cand-remove').forEach(b => b.addEventListener('click', e => {
    simRemoveCandidato(+e.target.dataset.id);
    SIM.transfer = simTransferPadrao();
    renderPaneCandidatos();
  }));
  document.getElementById('btnAddCand').addEventListener('click', () => {
    simAddCandidato('', '');
    SIM.transfer = simTransferPadrao();
    SIM.ops.clear();
    renderPaneCandidatos();
  });
}

// --------------------------------------------------------- pane: cenario

function renderPaneCenario() {
  const el = document.getElementById('simPaneCenario');
  const cols = simColunas();
  el.innerHTML = `
    <header class="sim-pane-head">
      <h4>Migração de 2022</h4>
      <p>Este é o pilar do simulador. Cada linha é um comportamento no segundo
         turno de 2022, medido em cada local de votação; os controles definem
         para onde esse eleitorado vai em 2026. O eleitorado é o de 2026, então
         quem entrou no cadastro desde então aparece diluído em todas as linhas.</p>
    </header>
    ${origensLista().map(origem => {
    const cfg = ORIGENS_2022[origem] || { rotulo: origem };
    const total = simTransferTotal(origem);
    const ok = Math.abs(total - 100) < 0.5;
    const linha = SIM.transfer[origem] || {};
    const peso = SIM.shares && SIM.shares.voto2022
      ? SIM.shares.voto2022[origensLista().indexOf(origem)] : null;
    return `
      <div class="sim-block" data-origem="${origem}">
        <div class="sim-block-head">
          <div>
            <strong>${escapeHtml(cfg.rotulo || origem)}</strong>
            ${peso != null ? `<small>${fmtPct(100 * peso)} do eleitorado</small>` : ''}
          </div>
          <span class="sim-total ${ok ? 'ok' : 'bad'}">${fmtPct(total)}</span>
        </div>
        <div class="sim-block-body">
          ${cols.map(c => `
            <div class="sim-slider-row">
              <i class="sim-chip" style="background:${c.cor}"></i>
              <span class="sim-slider-label" title="${escapeHtml(c.label)}">${escapeHtml(c.label)}</span>
              <input type="range" class="sim-slider" min="0" max="100" step="0.5"
                     value="${linha[c.key] || 0}" data-origem="${origem}" data-col="${c.key}">
              <input type="number" class="sim-slider-val" min="0" max="100" step="0.1"
                     value="${(linha[c.key] || 0).toFixed(1)}" data-origem="${origem}" data-col="${c.key}">
              <span class="sim-unit">%</span>
            </div>`).join('')}
        </div>
      </div>`;
  }).join('')}
    <button class="sim-btn sim-btn-ghost" id="btnResetTransfer">Restaurar valores sugeridos</button>`;

  const atualiza = (origem, col, v) => {
    v = clamp(v, 0, 100);
    SIM.transfer[origem] = SIM.transfer[origem] || {};
    SIM.transfer[origem][col] = v;
    const bloco = el.querySelector(`.sim-block[data-origem="${origem}"]`);
    const total = simTransferTotal(origem);
    const badge = bloco.querySelector('.sim-total');
    badge.textContent = fmtPct(total);
    badge.classList.toggle('ok', Math.abs(total - 100) < 0.5);
    badge.classList.toggle('bad', Math.abs(total - 100) >= 0.5);
    const r = bloco.querySelector(`.sim-slider[data-col="${col}"]`);
    const n = bloco.querySelector(`.sim-slider-val[data-col="${col}"]`);
    if (r) r.value = v;
    if (n) n.value = v.toFixed(1);
  };
  el.querySelectorAll('.sim-slider').forEach(s => s.addEventListener('input', e =>
    atualiza(e.target.dataset.origem, e.target.dataset.col, parseFloat(e.target.value))));
  el.querySelectorAll('.sim-slider-val').forEach(s => s.addEventListener('change', e =>
    atualiza(e.target.dataset.origem, e.target.dataset.col, parseFloat(e.target.value) || 0)));
  document.getElementById('btnResetTransfer').addEventListener('click', () => {
    SIM.transfer = simTransferPadrao();
    renderPaneCenario();
  });
}

// ------------------------------------------------------ pane: demografia

/* Previa instantanea do agregado: produto escalar entre a participacao de cada
   bucket no eleitorado do escopo e o apoio configurado. Roda na thread
   principal a cada movimento de slider — sem round-trip ao worker. */
function projecaoDemografica(dimKey) {
  if (!SIM.shares || !SIM.support || !SIM.support[dimKey]) return null;
  const share = SIM.shares[dimKey];
  if (!share) return null;
  const nCol = simColunas().length;
  const fora = new Array(nCol).fill(0);
  SIM.support[dimKey].forEach((linha, i) => {
    for (let p = 0; p < nCol; p++) fora[p] += (share[i] || 0) * (linha[p] || 0);
  });
  return fora;
}

/* Quanto a dimensao explica da variacao do voto entre locais, comparada ao
   modelo trivial (a media do escopo). Uma dimensao sem sinal nao pode ser
   apresentada com a mesma autoridade de uma que separa de verdade — o editor
   continua permitindo edita-la, mas avisa que a estimativa e so a media. */
function seloQualidade(dimKey) {
  const q = SIM.qualidade && (SIM.qualidade[SIM.selectedUF] || SIM.qualidade.BR);
  const g = q && q[dimKey] ? q[dimKey].ganho : null;
  if (g == null) return '';
  if (g < 0.02) return '<small class="sim-selo fraco" title="A composição deste grupo quase não varia entre locais de votação, então a regressão não consegue separá-lo: os valores ficam próximos da média geral.">sem poder explicativo</small>';
  return `<small class="sim-selo" title="Redução do erro em relação a usar a média do escopo para todos os locais.">explica ${fmtPct(100 * g, 0)} da variação</small>`;
}

function renderPaneDemografia() {
  const el = document.getElementById('simPaneDemografia');
  if (!SIM.support) {
    el.innerHTML = `<header class="sim-pane-head"><h4>Demografia</h4></header>
      <div class="sim-note">Aplique a simulação uma vez para estimar o voto por grupo.</div>`;
    return;
  }
  const cols = simColunas();
  const dims = SIM.indice.dimensions.filter(d => d.key !== 'voto2022' && SIM.support[d.key]);

  el.innerHTML = `
    <header class="sim-pane-head">
      <h4>Voto por grupo demográfico</h4>
      <p>Os valores partem de uma <strong>regressão ecológica</strong> sobre os
         ${fmtInt(SIM.indice ? Object.values(SIM.indice.ufs).reduce((a, b) => a + b, 0) : 0)}
         locais de votação: o quanto cada grupo explica a variação do voto entre
         locais. Ao mover um grupo, os demais são reestimados sobre o novo
         resultado — só os que você editar ficam fixos.
         Escopo atual: <strong>${escapeHtml(rotuloEscopo(SIM.escopo))}</strong>.</p>
    </header>
    <div class="sim-previa" id="simPreviaDemo"></div>
    ${dims.map(d => {
    const aberto = SIM._dimAberta === d.key;
    return `
      <div class="sim-dim ${aberto ? '' : 'collapsed'}" data-dim="${d.key}">
        <button class="sim-dim-head" data-dim="${d.key}">
          <span>${escapeHtml(d.label)}</span>
          ${seloQualidade(d.key)}
          <small>${d.base === 'pop' ? 'estimado pelo Censo' : 'eleitorado TSE 2026'}</small>
          <i class="sim-chev"></i>
        </button>
        <div class="sim-dim-body">
          ${d.buckets.map((b, bi) => {
      const sup = SIM.support[d.key][bi] || [];
      const share = SIM.shares && SIM.shares[d.key] ? SIM.shares[d.key][bi] : null;
      const tocado = SIM.tocados.has(d.key + '|' + bi);
      return `
            <div class="sim-bucket ${tocado ? 'tocado' : ''}" data-dim="${d.key}" data-bi="${bi}">
              <div class="sim-bucket-head">
                <span class="sim-bucket-name">${escapeHtml(b.label)}</span>
                <span class="sim-bucket-share">${share != null ? fmtPct(100 * share) + ' do eleitorado' : ''}</span>
              </div>
              ${cols.map((c, p) => `
                <div class="sim-slider-row">
                  <i class="sim-chip" style="background:${c.cor}"></i>
                  <span class="sim-slider-label" title="${escapeHtml(c.label)}">${escapeHtml(c.label)}</span>
                  <input type="range" class="sim-slider" min="0" max="100" step="0.5"
                         value="${(100 * (sup[p] || 0)).toFixed(1)}"
                         data-dim="${d.key}" data-bi="${bi}" data-p="${p}">
                  <input type="number" class="sim-slider-val" min="0" max="100" step="0.1"
                         value="${(100 * (sup[p] || 0)).toFixed(1)}"
                         data-dim="${d.key}" data-bi="${bi}" data-p="${p}">
                  <span class="sim-unit">%</span>
                </div>`).join('')}
              <div class="sim-bucket-foot">
                <span class="sim-total ok" data-total="${d.key}|${bi}">100,0%</span>
                <button class="sim-btn sim-btn-mini" data-aplicar="${d.key}|${bi}">Aplicar este grupo</button>
                ${tocado ? `<button class="sim-btn sim-btn-mini sim-btn-ghost" data-soltar="${d.key}|${bi}">Soltar</button>` : ''}
              </div>
            </div>`;
    }).join('')}
        </div>
      </div>`;
  }).join('')}`;

  el.querySelectorAll('.sim-dim-head').forEach(h => h.addEventListener('click', e => {
    const k = e.currentTarget.dataset.dim;
    SIM._dimAberta = (SIM._dimAberta === k) ? null : k;
    renderPaneDemografia();
  }));

  const totalBucket = (dim, bi) => {
    const sup = SIM.support[dim][bi] || [];
    return 100 * sup.reduce((a, b) => a + (b || 0), 0);
  };
  const repinta = (dim, bi) => {
    const badge = el.querySelector(`[data-total="${dim}|${bi}"]`);
    if (!badge) return;
    const t = totalBucket(dim, bi);
    badge.textContent = fmtPct(t);
    badge.classList.toggle('ok', Math.abs(t - 100) < 0.5);
    badge.classList.toggle('bad', Math.abs(t - 100) >= 0.5);
  };
  /* Previa instantanea: produto escalar entre a composicao do escopo e o apoio
     configurado, na thread principal. Da a leitura imediata do agregado
     implicado pela dimensao aberta, sem esperar o worker — que so entra quando
     o usuario clica em "Aplicar este grupo". */
  const previa = (dim) => {
    const box = document.getElementById('simPreviaDemo');
    if (!box) return;
    const proj = projecaoDemografica(dim);
    if (!proj) { box.innerHTML = ''; return; }
    const validos = cols.reduce((s, c, p) =>
      (c.key === 'nuloBranco' || c.key === 'abstencao') ? s : s + proj[p], 0);
    const nome = (SIM.indice.dimensions.find(x => x.key === dim) || {}).label || dim;
    box.innerHTML = `<span class="sim-previa-tit">Implicado por ${escapeHtml(nome)}</span>`
      + cols.filter(c => c.key !== 'nuloBranco' && c.key !== 'abstencao')
        .map(c => {
          const p = idxColuna(c.key);
          return `<span class="sim-previa-item"><i style="background:${c.cor}"></i>${escapeHtml(c.label)}
            <b>${validos > 0 ? fmtPct(100 * proj[p] / validos) : '–'}</b></span>`;
        }).join('')
      + `<span class="sim-previa-item"><i style="background:${COR_ABST}"></i>Abstenção
          <b>${fmtPct(100 * proj[idxColuna('abstencao')])}</b></span>`;
  };
  if (SIM._dimAberta) previa(SIM._dimAberta);

  const setar = (dim, bi, p, v) => {
    v = clamp(v, 0, 100) / 100;
    SIM.support[dim][bi][p] = v;
    const cx = el.querySelector(`.sim-slider[data-dim="${dim}"][data-bi="${bi}"][data-p="${p}"]`);
    const nx = el.querySelector(`.sim-slider-val[data-dim="${dim}"][data-bi="${bi}"][data-p="${p}"]`);
    if (cx) cx.value = (100 * v).toFixed(1);
    if (nx) nx.value = (100 * v).toFixed(1);
    repinta(dim, bi);
    previa(dim);
  };
  el.querySelectorAll('.sim-slider').forEach(s => s.addEventListener('input', e =>
    setar(e.target.dataset.dim, +e.target.dataset.bi, +e.target.dataset.p, parseFloat(e.target.value))));
  el.querySelectorAll('.sim-slider-val').forEach(s => s.addEventListener('change', e =>
    setar(e.target.dataset.dim, +e.target.dataset.bi, +e.target.dataset.p, parseFloat(e.target.value) || 0)));
  el.querySelectorAll('.sim-dim .sim-bucket').forEach(b => {
    repinta(b.dataset.dim, +b.dataset.bi);
  });

  el.querySelectorAll('[data-aplicar]').forEach(b => b.addEventListener('click', async e => {
    const [dim, bi] = e.target.dataset.aplicar.split('|');
    const sup = SIM.support[dim][+bi];
    const soma = sup.reduce((a, v) => a + (v || 0), 0);
    if (soma <= 0) return;
    const alvos = sup.map(v => (v || 0) / soma);      // normaliza antes de virar alvo
    const op = opDoEscopo(SIM.escopo, true);
    op.demo[dim + '|' + bi] = alvos;
    SIM.tocados.add(dim + '|' + bi);
    await simCalcular();
    renderPaneDemografia();
  }));
  el.querySelectorAll('[data-soltar]').forEach(b => b.addEventListener('click', async e => {
    const chave = e.target.dataset.soltar;
    const op = opDoEscopo(SIM.escopo);
    if (op) delete op.demo[chave];
    SIM.tocados.delete(chave);
    await simCalcular();
    renderPaneDemografia();
  }));
}

// --------------------------------------------------------- pane: regioes

/* Dois recortes territoriais, ambos vindos de regioes_ibge.json:
     'mr' — as 5 macrorregioes (Norte, Nordeste, ...)
     'ri' — as ~130 regioes intermediarias, agrupadas por UF na tela
   O nivel escolhido vira o escopo das metas. */
function listaRegioes(nivel) {
  const mm = SIM.regioes && SIM.regioes.muni_to_region;
  if (!mm) return [];

  const nomesRI = {};
  const ufDaRI = {};
  const porUf = (SIM.regioes && SIM.regioes.rgint_by_uf) || {};
  for (const uf in porUf) {
    (porUf[uf] || []).forEach(r => { nomesRI[String(r.cd)] = r.nome; ufDaRI[String(r.cd)] = uf; });
  }

  const grupos = new Map();
  for (const ibge in mm) {
    const r = mm[ibge];
    const cod = nivel === 'ri' ? r.ri : r.mr;
    if (cod == null) continue;
    const chave = String(cod);
    if (!grupos.has(chave)) {
      const macro = SIM.regioes.macro && SIM.regioes.macro[chave];
      grupos.set(chave, {
        codigo: chave,
        nome: nivel === 'ri'
          ? (nomesRI[chave] || 'Região ' + chave)
          : ((macro && macro.nome) || 'Macrorregião ' + chave),
        uf: nivel === 'ri' ? (ufDaRI[chave] || '') : '',
        munis: []
      });
    }
    grupos.get(chave).munis.push(Number(ibge));
  }
  return Array.from(grupos.values()).sort((a, b) =>
    (a.uf || '').localeCompare(b.uf || '') || a.nome.localeCompare(b.nome, 'pt-BR'));
}

function renderPaneRegioes() {
  const el = document.getElementById('simPaneRegioes');
  const nivel = SIM._nivelRegiao || 'mr';
  const todas = listaRegioes(nivel);
  const cols = simColunasValidas();

  if (!todas.length) {
    el.innerHTML = `<header class="sim-pane-head"><h4>Regiões</h4></header>
      <div class="sim-note">regioes_ibge.json não encontrado — metas regionais indisponíveis.</div>`;
    return;
  }

  // Com ~130 regioes intermediarias, renderizar todas de uma vez trava a tela;
  // filtra-se por UF, com o estado aberto no mapa como padrao.
  const ufFiltro = nivel === 'ri' ? (SIM._ufRegiao || SIM.selectedUF || 'SP') : null;
  const regs = nivel === 'ri' ? todas.filter(r => r.uf === ufFiltro) : todas;

  const cabecalho = `
    <header class="sim-pane-head">
      <h4>Metas por região</h4>
      <p>Define o resultado agregado de um recorte territorial. Os locais dentro
         dele são reescalonados proporcionalmente até bater a meta, preservando
         as diferenças internas. Ajustes municipais feitos depois têm prioridade
         sobre a meta regional.</p>
    </header>
    <div class="sim-final-pick">
      <label>Recorte
        <select id="simNivelRegiao">
          <option value="mr" ${nivel === 'mr' ? 'selected' : ''}>Macrorregião (5)</option>
          <option value="ri" ${nivel === 'ri' ? 'selected' : ''}>Região intermediária (${todas.length > 10 ? listaRegioes('ri').length : '~130'})</option>
        </select>
      </label>
      ${nivel === 'ri' ? `<label>Estado
        <select id="simUfRegiao">
          ${Array.from(UF_MAP.entries()).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
      .map(([s, n]) => `<option value="${s}" ${s === ufFiltro ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}
        </select></label>` : ''}
    </div>`;

  el.innerHTML = cabecalho + `
    ${regs.map(r => {
    const esc = { level: 'regiao', regiao: r.codigo, nome: r.nome, ibges: r.munis };
    const op = SIM.ops.get(chaveEscopo(esc));
    const res = resultadoDoEscopo(esc);
    const ent = entradasDe(res).filter(x => x.key !== 'nuloBranco' && x.key !== 'abstencao');
    return `
      <div class="sim-block ${op && op.general ? 'ativo' : ''}" data-reg="${r.codigo}">
        <div class="sim-block-head">
          <div>
            <strong>${escapeHtml(r.nome)}</strong>
            <small>${fmtInt(r.munis.length)} municípios · ${res ? fmtInt(res.aptos) : '–'} eleitores</small>
          </div>
          ${op && op.general ? '<span class="sim-badge">meta ativa</span>' : ''}
        </div>
        <div class="sim-block-body">
          ${cols.map(c => {
      const cur = ent.find(x => x.key === c.key);
      const alvo = op && op.general && op.general[idxColuna(c.key)] != null
        ? 100 * op.general[idxColuna(c.key)] : null;
      return `
            <div class="sim-slider-row">
              <i class="sim-chip" style="background:${c.cor}"></i>
              <span class="sim-slider-label">${escapeHtml(c.label)}</span>
              <input type="range" class="sim-slider" min="0" max="100" step="0.5"
                     value="${alvo != null ? alvo : (cur ? cur.pctAptos : 0)}"
                     data-reg="${r.codigo}" data-col="${c.key}">
              <input type="number" class="sim-slider-val" min="0" max="100" step="0.1"
                     value="${(alvo != null ? alvo : (cur ? cur.pctAptos : 0)).toFixed(1)}"
                     data-reg="${r.codigo}" data-col="${c.key}">
              <span class="sim-unit">%</span>
            </div>`;
    }).join('')}
          <div class="sim-bucket-foot">
            <small>% sobre o eleitorado apto da região</small>
            <button class="sim-btn sim-btn-mini" data-aplicar-reg="${r.codigo}">Aplicar meta</button>
            ${op && op.general ? `<button class="sim-btn sim-btn-mini sim-btn-ghost" data-limpar-reg="${r.codigo}">Limpar</button>` : ''}
          </div>
        </div>
      </div>`;
  }).join('')}`;

  const selNivel = document.getElementById('simNivelRegiao');
  if (selNivel) selNivel.addEventListener('change', e => {
    SIM._nivelRegiao = e.target.value;
    renderPaneRegioes();
  });
  const selUf = document.getElementById('simUfRegiao');
  if (selUf) selUf.addEventListener('change', e => {
    SIM._ufRegiao = e.target.value;
    renderPaneRegioes();
  });

  el.querySelectorAll('.sim-slider').forEach(s => s.addEventListener('input', e => {
    const box = e.target.closest('.sim-block');
    const n = box.querySelector(`.sim-slider-val[data-col="${e.target.dataset.col}"]`);
    if (n) n.value = parseFloat(e.target.value).toFixed(1);
  }));
  el.querySelectorAll('.sim-slider-val').forEach(s => s.addEventListener('change', e => {
    const box = e.target.closest('.sim-block');
    const r = box.querySelector(`.sim-slider[data-col="${e.target.dataset.col}"]`);
    if (r) r.value = e.target.value;
  }));

  el.querySelectorAll('[data-aplicar-reg]').forEach(b => b.addEventListener('click', async e => {
    const cod = e.target.dataset.aplicarReg;
    const reg = regs.find(x => x.codigo === cod);
    const esc = { level: 'regiao', regiao: cod, nome: reg.nome, ibges: reg.munis };
    const op = opDoEscopo(esc, true);
    const geral = new Array(simColunas().length).fill(null);
    el.querySelectorAll(`.sim-slider-val[data-reg="${cod}"]`).forEach(inp => {
      geral[idxColuna(inp.dataset.col)] = (parseFloat(inp.value) || 0) / 100;
    });
    op.general = geral;
    await simCalcular();
    renderPaneRegioes();
  }));
  el.querySelectorAll('[data-limpar-reg]').forEach(b => b.addEventListener('click', async e => {
    const cod = e.target.dataset.limparReg;
    const reg = regs.find(x => x.codigo === cod);
    SIM.ops.delete(chaveEscopo({ level: 'regiao', regiao: cod, ibges: reg.munis }));
    await simCalcular();
    renderPaneRegioes();
  }));
}

// --------------------------------------------------------- pane: 2o turno

function renderPaneTurno2() {
  const el = document.getElementById('simPaneTurno2');
  if (!SIM.agregado) {
    el.innerHTML = `<header class="sim-pane-head"><h4>Segundo turno</h4></header>
      <div class="sim-note">Aplique a simulação do primeiro turno primeiro.</div>`;
    return;
  }
  const cols = simColunas();
  const finalistas = simFinalistas();
  const nomeDe = k => (cols.find(c => c.key === k) || {}).label || k;
  const corDe = k => (cols.find(c => c.key === k) || {}).cor || '#888';
  const precisa = simPrecisaSegundoTurno();
  const res1 = entradasDe(SIM.agregado.brasil).filter(x => x.key !== 'nuloBranco' && x.key !== 'abstencao')
    .sort((a, b) => b.votos - a.votos);
  const res2 = SIM.agregado2T ? entradasDe(SIM.agregado2T.brasil) : [];

  if (finalistas.length < 2 || !res1.length) {
    el.innerHTML = `<header class="sim-pane-head"><h4>Segundo turno</h4></header>
      <div class="sim-note">É preciso ao menos dois candidatos para simular o segundo turno.</div>`;
    return;
  }

  // Só faz sentido diferenciar por dimensões que a inferência ecológica
  // consegue separar; as sem poder explicativo ficariam iguais à média.
  const dimsDisponiveis = (SIM.indice.dimensions || []).filter(d => {
    if (d.key === 'voto2022') return false;
    const q = SIM.qualidade && (SIM.qualidade.BR || {})[d.key];
    return !q || q.ganho >= 0.02;
  });
  const grupoAtivo = SIM.t2.porGrupo ? SIM.t2.porGrupo.dim : '';

  el.innerHTML = `
    <header class="sim-pane-head">
      <h4>Segundo turno</h4>
      <p>${precisa
      ? `Com <strong>${fmtPct(res1[0].pctValidos)}</strong> dos válidos, ${escapeHtml(res1[0].label)} não vence no primeiro turno.`
      : `No cenário atual ${escapeHtml(res1[0].label)} já vence no primeiro turno com ${fmtPct(res1[0].pctValidos)}. A simulação abaixo é hipotética.`}
         Cada eliminado distribui sua votação entre os dois finalistas, nulos e abstenção.</p>
    </header>

    <div class="sim-final-pick">
      <label>Finalistas
        <select id="sim2TA">${cols.filter(c => c.key.startsWith('cand_') || c.key === 'outros')
      .map(c => `<option value="${c.key}" ${c.key === finalistas[0] ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}</select>
        <span>×</span>
        <select id="sim2TB">${cols.filter(c => c.key.startsWith('cand_') || c.key === 'outros')
      .map(c => `<option value="${c.key}" ${c.key === finalistas[1] ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}</select>
      </label>
      <button class="sim-btn sim-btn-ghost" id="btnReset2T">Recalcular sugestão</button>
    </div>

    ${res2.length ? `
    <div class="sim-t2-result">
      ${res2.filter(x => finalistas.includes(x.key)).sort((a, b) => b.votos - a.votos).map(x => `
        <div class="sim-t2-card ${x.pctValidos > 50 ? 'vence' : ''}">
          <i style="background:${x.cor}"></i>
          <strong>${escapeHtml(x.label)}</strong>
          <b>${fmtPct(x.pctValidos)}</b>
          <small>${fmtInt(x.votos)} votos</small>
        </div>`).join('')}
      <div class="sim-t2-meta">
        Abstenção ${fmtPct((res2.find(x => x.key === 'abstencao') || {}).pctAptos || 0)} ·
        Nulos e brancos ${fmtPct((res2.find(x => x.key === 'nuloBranco') || {}).pctAptos || 0)}
      </div>
    </div>` : ''}

    <h5 class="sim-sub">Matriz de transferência</h5>
    <p class="sim-hint">Cada linha soma 100%: para onde vai o eleitorado de quem
       não está no segundo turno. Os valores sugeridos vêm da distância
       ideológica entre os candidatos.</p>

    <div class="sim-final-pick">
      <label>Diferenciar por grupo
        <select id="sim2TGrupo">
          <option value="">Não diferenciar</option>
          ${dimsDisponiveis.map(d => `<option value="${d.key}"
            ${grupoAtivo === d.key ? 'selected' : ''}>${escapeHtml(d.label)}</option>`).join('')}
        </select>
      </label>
      <small class="sim-hint" style="margin:0">${grupoAtivo
      ? 'A transferência é aplicada local a local, ponderada pela composição de cada um.'
      : 'A mesma linha vale para todo o país.'}</small>
    </div>

    ${cols.filter(c => !finalistas.includes(c.key)).map(c => {
      const linha = (SIM.t2.matriz && SIM.t2.matriz[c.key]) || {};
      const destinos = [finalistas[0], finalistas[1], 'nuloBranco', 'abstencao'];
      const total = destinos.reduce((s, d) => s + (linha[d] || 0), 0);
      const origemVotos = (res1.find(x => x.key === c.key) || {}).votos
        || (entradasDe(SIM.agregado.brasil).find(x => x.key === c.key) || {}).votos || 0;
      const dimObj = grupoAtivo
        ? SIM.indice.dimensions.find(d => d.key === grupoAtivo) : null;
      return `
      <div class="sim-block" data-t2="${c.key}">
        <div class="sim-block-head">
          <div><strong><i class="sim-chip" style="background:${c.cor}"></i> ${escapeHtml(c.label)}</strong>
            <small>${fmtInt(origemVotos)} eleitores a redistribuir</small></div>
          <span class="sim-total ${Math.abs(total - 100) < 0.5 ? 'ok' : 'bad'}">${fmtPct(total)}</span>
        </div>
        <div class="sim-block-body sim-linha-global">
          ${destinos.map(d => `
            <div class="sim-slider-row">
              <i class="sim-chip" style="background:${corDe(d)}"></i>
              <span class="sim-slider-label">${escapeHtml(nomeDe(d))}</span>
              <input type="range" class="sim-slider" min="0" max="100" step="0.5"
                     value="${linha[d] || 0}" data-t2="${c.key}" data-dest="${d}">
              <input type="number" class="sim-slider-val" min="0" max="100" step="0.1"
                     value="${(linha[d] || 0).toFixed(1)}" data-t2="${c.key}" data-dest="${d}">
              <span class="sim-unit">%</span>
            </div>`).join('')}
        </div>
        ${dimObj ? `<div class="sim-grupo-wrap">
          ${dimObj.buckets.map((b, bi) => {
        const pg = SIM.t2.porGrupo;
        const lg = (pg && pg.linhas[bi] && pg.linhas[bi][c.key]) || linha;
        const dif = !!(pg && pg.linhas[bi] && pg.linhas[bi][c.key]);
        const share = SIM.shares && SIM.shares[grupoAtivo] ? SIM.shares[grupoAtivo][bi] : null;
        return `
          <div class="sim-grupo-row ${dif ? 'dif' : ''}" data-t2="${c.key}" data-bi="${bi}">
            <div class="sim-grupo-head">
              <span>${escapeHtml(b.label)}</span>
              <small>${share != null ? fmtPct(100 * share) + ' do eleitorado' : ''}</small>
            </div>
            ${[finalistas[0], finalistas[1]].map(d => `
              <div class="sim-slider-row">
                <i class="sim-chip" style="background:${corDe(d)}"></i>
                <span class="sim-slider-label">${escapeHtml(nomeDe(d))}</span>
                <input type="range" class="sim-slider" min="0" max="100" step="0.5"
                       value="${lg[d] || 0}" data-t2="${c.key}" data-bi="${bi}" data-dest="${d}">
                <input type="number" class="sim-slider-val" min="0" max="100" step="0.1"
                       value="${(lg[d] || 0).toFixed(1)}" data-t2="${c.key}" data-bi="${bi}" data-dest="${d}">
                <span class="sim-unit">%</span>
              </div>`).join('')}
          </div>`;
      }).join('')}
        </div>` : ''}
      </div>`;
    }).join('')}`;

  const recalcular = async () => {
    await simCalcular2T();
    renderPaneTurno2();
    simRenderSidebar();
    simRenderMapa();
  };
  const trocaFinalista = () => {
    const a = document.getElementById('sim2TA').value;
    const b = document.getElementById('sim2TB').value;
    if (a === b) return;
    SIM.t2.finalistas = [a, b];
    SIM.t2.chaveMatriz = null;
    recalcular();
  };
  document.getElementById('sim2TA').addEventListener('change', trocaFinalista);
  document.getElementById('sim2TB').addEventListener('change', trocaFinalista);
  document.getElementById('btnReset2T').addEventListener('click', () => {
    SIM.t2.chaveMatriz = null;
    SIM.t2.porGrupo = null;
    recalcular();
  });

  const selGrupo = document.getElementById('sim2TGrupo');
  if (selGrupo) selGrupo.addEventListener('change', e => {
    const dim = e.target.value;
    // Ao trocar de dimensao as linhas por bucket partem da linha global, para
    // que ligar o recorte nao mude o resultado sozinho — so quando o usuario
    // efetivamente diferenciar algum grupo.
    SIM.t2.porGrupo = dim ? { dim, linhas: {} } : null;
    recalcular();
  });

  const setar = (origem, dest, v) => {
    v = clamp(v, 0, 100);
    SIM.t2.matriz[origem] = SIM.t2.matriz[origem] || {};
    SIM.t2.matriz[origem][dest] = v;
    const box = el.querySelector(`.sim-block[data-t2="${origem}"]`);
    const r = box.querySelector(`.sim-slider[data-dest="${dest}"]`);
    const n = box.querySelector(`.sim-slider-val[data-dest="${dest}"]`);
    if (r) r.value = v;
    if (n) n.value = v.toFixed(1);
    const destinos = [finalistas[0], finalistas[1], 'nuloBranco', 'abstencao'];
    const total = destinos.reduce((s, d) => s + (SIM.t2.matriz[origem][d] || 0), 0);
    const badge = box.querySelector('.sim-total');
    badge.textContent = fmtPct(total);
    badge.classList.toggle('ok', Math.abs(total - 100) < 0.5);
    badge.classList.toggle('bad', Math.abs(total - 100) >= 0.5);
    clearTimeout(SIM._t2Timer);
    SIM._t2Timer = setTimeout(recalcular, 260);
  };

  // Linhas por grupo demografico: a transferencia de um eliminado pode variar
  // conforme a composicao do local (evangelico vs sem religiao, por exemplo).
  const setarGrupo = (origem, bi, dest, v) => {
    v = clamp(v, 0, 100);
    const pg = SIM.t2.porGrupo;
    if (!pg) return;
    pg.linhas[bi] = pg.linhas[bi] || {};
    pg.linhas[bi][origem] = pg.linhas[bi][origem]
      || Object.assign({}, SIM.t2.matriz[origem]);
    pg.linhas[bi][origem][dest] = v;
    const box = el.querySelector(`.sim-grupo-row[data-t2="${origem}"][data-bi="${bi}"]`);
    if (box) {
      const r = box.querySelector(`.sim-slider[data-dest="${dest}"]`);
      const n = box.querySelector(`.sim-slider-val[data-dest="${dest}"]`);
      if (r) r.value = v;
      if (n) n.value = v.toFixed(1);
    }
    clearTimeout(SIM._t2Timer);
    SIM._t2Timer = setTimeout(recalcular, 260);
  };
  el.querySelectorAll('.sim-grupo-row .sim-slider').forEach(s => s.addEventListener('input', e =>
    setarGrupo(e.target.dataset.t2, e.target.dataset.bi, e.target.dataset.dest,
      parseFloat(e.target.value))));
  el.querySelectorAll('.sim-grupo-row .sim-slider-val').forEach(s => s.addEventListener('change', e =>
    setarGrupo(e.target.dataset.t2, e.target.dataset.bi, e.target.dataset.dest,
      parseFloat(e.target.value) || 0)));
  el.querySelectorAll('.sim-linha-global .sim-slider').forEach(s => s.addEventListener('input', e =>
    setar(e.target.dataset.t2, e.target.dataset.dest, parseFloat(e.target.value))));
  el.querySelectorAll('.sim-linha-global .sim-slider-val').forEach(s => s.addEventListener('change', e =>
    setar(e.target.dataset.t2, e.target.dataset.dest, parseFloat(e.target.value) || 0)));
}

// ============================================================================
// UI — SIDEBAR
// ============================================================================

function simRenderTudo() {
  simRenderSidebar();
  simRenderMapa();
  simRenderBreadcrumb();
  renderNavFoot();
  if (document.getElementById('simConfigOverlay').classList.contains('visible')) simRenderModal();
}

function simRenderSidebar() {
  const vazio = document.getElementById('simEmptyState');
  const box = document.getElementById('simPanelResults');
  if (!SIM.agregado) { vazio.hidden = false; box.hidden = true; return; }
  vazio.hidden = true;
  box.hidden = false;

  const res = resultadoDoEscopo(SIM.escopo, agregadoAtivo());
  document.getElementById('simPanelAreaTitle').textContent = rotuloEscopo(SIM.escopo);
  document.getElementById('simPanelAreaSub').textContent =
    res ? `${fmtInt(res.aptos)} eleitores aptos (2026)` : '';

  const badge = document.getElementById('simScopeBadge');
  const op = SIM.ops.get(chaveEscopo(SIM.escopo));
  const nAjustes = op ? ((op.general ? 1 : 0) + Object.keys(op.demo || {}).length) : 0;
  badge.hidden = !nAjustes;
  badge.textContent = nAjustes ? `${nAjustes} ajuste(s)` : '';

  document.getElementById('btnVoltar').hidden = !(SIM.selectedUF || SIM.selectedMuni);
  document.getElementById('simTurnoSwitch').hidden = !SIM.agregado2T;

  document.querySelectorAll('#simPanelResults .sim-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === SIM.abaSidebar);
  });
  ['resultado', 'ajustar', 'demografia'].forEach(t => {
    document.getElementById('simTab' + t.charAt(0).toUpperCase() + t.slice(1)).hidden =
      (t !== SIM.abaSidebar);
  });

  if (SIM.abaSidebar === 'resultado') renderAbaResultado(res);
  if (SIM.abaSidebar === 'ajustar') renderAbaAjustar(res);
  if (SIM.abaSidebar === 'demografia') renderAbaDemografia();
}

function renderAbaResultado(res) {
  const alvo = document.getElementById('simBarsContainer');
  if (!res) { alvo.innerHTML = '<div class="sim-note">Sem dados neste recorte.</div>'; return; }

  const ent = entradasDe(res);
  const validas = ent.filter(x => x.key !== 'nuloBranco' && x.key !== 'abstencao')
    .sort((a, b) => b.votos - a.votos);
  if (!validas.length) {
    alvo.innerHTML = '<div class="sim-note">Nenhum candidato configurado.</div>';
    document.getElementById('simMetricsContainer').innerHTML = '';
    document.getElementById('simRunoffCallout').innerHTML = '';
    return;
  }
  const maior = validas[0] ? validas[0].pctValidos : 100;
  const eleito = new Set();
  if (validas.length) {
    eleito.add(validas[0].key);
    if (SIM.turno === 1 && validas[0].pctValidos < 50 && validas[1]) eleito.add(validas[1].key);
  }

  alvo.innerHTML = `<div class="sim-results-bars">
    ${validas.map(e => `
      <div class="sim-result-row">
        <i class="sim-result-indicator" style="background:${e.cor}"></i>
        <div class="sim-result-name">
          <span>${escapeHtml(e.label)}${eleito.has(e.key) ? ' <em class="sim-check">✔</em>' : ''}</span>
          <small>${fmtInt(e.votos)}</small>
        </div>
        <div class="sim-result-bar-wrap">
          <div class="sim-result-bar" style="width:${maior > 0 ? (100 * e.pctValidos / maior) : 0}%;background:${e.cor}"></div>
        </div>
        <div class="sim-result-numbers"><span class="sim-result-pct">${fmtPct(e.pctValidos)}</span></div>
      </div>`).join('')}
  </div>`;

  const nb = ent.find(x => x.key === 'nuloBranco');
  const ab = ent.find(x => x.key === 'abstencao');
  const comparecimento = res.aptos > 0 ? 100 * (res.aptos - ab.votos) / res.aptos : 0;
  document.getElementById('simMetricsContainer').innerHTML = `
    <div class="sim-metrics-grid">
      <div class="sim-metric"><span>Comparecimento</span><strong>${fmtPct(comparecimento)}</strong></div>
      <div class="sim-metric"><span>Abstenção</span><strong>${fmtPct(ab.pctAptos)}</strong></div>
      <div class="sim-metric"><span>Nulos e brancos</span><strong>${fmtPct(nb.pctAptos)}</strong></div>
      <div class="sim-metric"><span>Margem</span><strong>${fmtPct(margemDe(res))}</strong></div>
    </div>`;

  const callout = document.getElementById('simRunoffCallout');
  if (SIM.turno === 1 && SIM.escopo.level === 'nacional') {
    callout.innerHTML = simPrecisaSegundoTurno()
      ? `<div class="sim-callout">
           <strong>Vai a segundo turno.</strong>
           ${escapeHtml(validas[0].label)} tem ${fmtPct(validas[0].pctValidos)} dos válidos.
           <button class="sim-btn sim-btn-mini" id="btnIr2T">Simular segundo turno</button>
         </div>`
      : `<div class="sim-callout ok">
           <strong>Vitória no primeiro turno.</strong>
           ${escapeHtml(validas[0].label)} com ${fmtPct(validas[0].pctValidos)} dos válidos.
         </div>`;
    const b = document.getElementById('btnIr2T');
    if (b) b.addEventListener('click', () => { SIM.turno = 2; simRenderTudo(); });
  } else callout.innerHTML = '';
}

function renderAbaAjustar(res) {
  const el = document.getElementById('simTabAjustar');
  if (SIM.escopo.level === 'nacional') {
    el.innerHTML = `<p class="sim-hint">Metas nacionais e regionais ficam no editor de cenário.</p>
      <button class="sim-btn sim-btn-apply" id="btnAjNacional">Abrir metas por região</button>`;
    document.getElementById('btnAjNacional').addEventListener('click', () => abrirModal('regioes'));
    return;
  }
  const cols = simColunasValidas();
  const ent = entradasDe(res);
  const op = SIM.ops.get(chaveEscopo(SIM.escopo));

  el.innerHTML = `
    <p class="sim-hint">Define o resultado de <strong>${escapeHtml(rotuloEscopo(SIM.escopo))}</strong>
       em % do eleitorado apto. Os locais de votação são reescalonados até bater a meta.</p>
    ${cols.map(c => {
    const cur = ent.find(x => x.key === c.key);
    const alvo = op && op.general && op.general[idxColuna(c.key)] != null
      ? 100 * op.general[idxColuna(c.key)] : (cur ? cur.pctAptos : 0);
    return `
      <div class="sim-slider-row">
        <i class="sim-chip" style="background:${c.cor}"></i>
        <span class="sim-slider-label">${escapeHtml(c.label)}</span>
        <input type="range" class="sim-slider" min="0" max="100" step="0.5" value="${alvo}" data-col="${c.key}">
        <input type="number" class="sim-slider-val" min="0" max="100" step="0.1" value="${alvo.toFixed(1)}" data-col="${c.key}">
        <span class="sim-unit">%</span>
      </div>`;
  }).join('')}
    <div class="sim-actions-row">
      <button class="sim-btn sim-btn-apply" id="btnAplicarAjuste">Aplicar</button>
      ${op && op.general ? '<button class="sim-btn sim-btn-ghost" id="btnLimparAjuste">Limpar</button>' : ''}
    </div>`;

  el.querySelectorAll('.sim-slider').forEach(s => s.addEventListener('input', e => {
    el.querySelector(`.sim-slider-val[data-col="${e.target.dataset.col}"]`).value =
      parseFloat(e.target.value).toFixed(1);
  }));
  el.querySelectorAll('.sim-slider-val').forEach(s => s.addEventListener('change', e => {
    el.querySelector(`.sim-slider[data-col="${e.target.dataset.col}"]`).value = e.target.value;
  }));
  document.getElementById('btnAplicarAjuste').addEventListener('click', async () => {
    const op2 = opDoEscopo(SIM.escopo, true);
    const geral = new Array(simColunas().length).fill(null);
    el.querySelectorAll('.sim-slider-val').forEach(i => {
      geral[idxColuna(i.dataset.col)] = (parseFloat(i.value) || 0) / 100;
    });
    op2.general = geral;
    await simCalcular();
  });
  const lb = document.getElementById('btnLimparAjuste');
  if (lb) lb.addEventListener('click', async () => {
    SIM.ops.delete(chaveEscopo(SIM.escopo));
    await simCalcular();
  });
}

function renderAbaDemografia() {
  const el = document.getElementById('simTabDemografia');
  if (!SIM.support || !SIM.shares) {
    el.innerHTML = '<div class="sim-note">Estimativa ainda não calculada.</div>';
    return;
  }
  const cols = simColunasValidas();
  const dims = SIM.indice.dimensions.filter(d => d.key !== 'voto2022' && SIM.support[d.key]);
  el.innerHTML = `
    <p class="sim-hint">Voto estimado por grupo em <strong>${escapeHtml(rotuloEscopo(SIM.escopo))}</strong>,
       por regressão ecológica sobre os locais de votação.</p>
    ${dims.map(d => `
      <div class="sim-readout">
        <h6>${escapeHtml(d.label)}</h6>
        ${d.buckets.map((b, bi) => {
    const sup = SIM.support[d.key][bi] || [];
    const share = SIM.shares[d.key] ? SIM.shares[d.key][bi] : 0;
    const validos = cols.reduce((s, c) => s + (sup[idxColuna(c.key)] || 0), 0) || 1;
    return `
          <div class="sim-readout-row">
            <div class="sim-readout-head">
              <span>${escapeHtml(b.label)}</span><small>${fmtPct(100 * share)}</small>
            </div>
            <div class="sim-readout-bar">
              ${cols.map(c => {
      const v = (sup[idxColuna(c.key)] || 0) / validos;
      return v > 0.005 ? `<i style="width:${100 * v}%;background:${c.cor}"
                    title="${escapeHtml(c.label)} ${fmtPct(100 * v)}"></i>` : '';
    }).join('')}
            </div>
          </div>`;
  }).join('')}
      </div>`).join('')}
    <button class="sim-btn sim-btn-apply" id="btnAbrirEditorDemo">Editar voto por grupo</button>`;
  document.getElementById('btnAbrirEditorDemo').addEventListener('click', () => abrirModal('demografia'));
}

// ============================================================================
// MAPA
// ============================================================================

function corDoResultado(res) {
  const v = vencedorDe(res);
  if (!v || !res || !res.aptos) return '#3a3a3a';
  return getUniversalGradientColor(v.cor, margemDe(res));
}

function tooltipResultado(titulo, res, rodape) {
  const ent = entradasDe(res).filter(x => x.key !== 'nuloBranco' && x.key !== 'abstencao')
    .sort((a, b) => b.votos - a.votos).filter(x => x.votos > 0);
  const validos = ent.reduce((s, x) => s + x.votos, 0);
  const linhas = ent.length ? ent.map(e => `
      <tr>
        <td style="padding:0">
          <div class="district-nyt-loser-cell" style="border-left-color:${e.cor}">
            <span style="margin-left:6px">${escapeHtml(e.label)}</span>
          </div>
        </td>
        <td class="votes-cell">${fmtInt(e.votos)}</td>
        <td class="pct-cell">${fmtPct(e.pctValidos)}</td>
      </tr>`).join('')
    : '<tr><td colspan="3" style="text-align:center;color:#777;padding:8px">Sem votos válidos.</td></tr>';
  return `<div class="nyt-tooltip-container" style="font-family:var(--font-main);min-width:250px">
      <div class="district-nyt-title">${escapeHtml(titulo)}</div>
      <table class="district-nyt-table">
        <thead><tr><th style="text-align:left">Candidato</th><th>Votos</th><th>%</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
      <div style="font-size:11px;color:#777;margin-top:8px">Válidos: ${fmtInt(validos)}</div>
      ${rodape ? `<div class="sim-tip-foot">${escapeHtml(rodape)}</div>` : ''}
    </div>`;
}

function simRenderMapa() {
  if (SIM.selectedMuni) return simRenderMapaLocais(SIM.selectedUF, SIM.selectedMuni);
  if (SIM.selectedUF) return simRenderMapaMunicipios(SIM.selectedUF);
  return simRenderMapaEstados();
}

function limparCamadas(exceto) {
  ['estadosLayer', 'municipiosLayer', 'locaisLayer'].forEach(k => {
    if (k !== exceto && SIM[k]) { simMap.removeLayer(SIM[k]); SIM[k] = null; }
  });
}

function simRenderMapaEstados() {
  limparCamadas('estadosLayer');
  if (!SIM.estadosGeoJSON) return;
  const ag = agregadoAtivo();
  if (SIM.estadosLayer) { simMap.removeLayer(SIM.estadosLayer); SIM.estadosLayer = null; }

  SIM.estadosLayer = new MLCompat.GeoLayer(simMap, {
    id: 'sim-estados', type: 'polygon', tooltipClass: 'district-nyt-tooltip',
    styleFn: f => {
      const uf = f.properties.SIGLA_UF;
      const res = ag && ag.ufs[uf];
      return {
        fillColor: corDoResultado(res), fillOpacity: 0.88,
        color: '#ffffff', weight: 0.8, opacity: 0.65
      };
    },
    tooltipFn: f => tooltipResultado(f.properties.NM_UF || f.properties.SIGLA_UF,
      ag && ag.ufs[f.properties.SIGLA_UF]),
    onClick: f => simSelecionarUF(f.properties.SIGLA_UF)
  });
  SIM.estadosLayer.setFeatures(SIM.estadosGeoJSON.features || []);
  SIM.estadosLayer.addTo(simMap);
  const b = SIM.estadosLayer.getBounds();
  if (b.isValid()) MLCompat.fitMapToBounds(simMap, b, { animate: false });
  simRenderLegenda();
  scheduleSimMapRefresh();
}

async function simRenderMapaMunicipios(uf) {
  const ag = agregadoAtivo();
  if (!SIM.muniGeoCache[uf]) {
    SIM.muniGeoCache[uf] = await fetchJSON(DATA_BASE_URL + `municipios/municipios_${uf}.geojson`)
      .catch(() => null);
  }
  const geo = SIM.muniGeoCache[uf];
  if (!geo) return simRenderMapaEstados();
  limparCamadas('municipiosLayer');
  if (SIM.municipiosLayer) { simMap.removeLayer(SIM.municipiosLayer); SIM.municipiosLayer = null; }

  const codDe = p => Number(p.CD_MUN || p.cod_ibge || p.codigo_ibge || p.CD_GEOCMU || p.GEOCODIGO);
  const nomeDe = p => p.NM_MUN || p.nome || p.NM_MUNICIP || SIM.nomesMuni[codDe(p)] || '';

  SIM.municipiosLayer = new MLCompat.GeoLayer(simMap, {
    id: 'sim-municipios', type: 'polygon', tooltipClass: 'district-nyt-tooltip',
    styleFn: f => {
      const res = ag && ag.municipios[String(codDe(f.properties))];
      const sel = SIM.selectedMuni === codDe(f.properties);
      return {
        fillColor: corDoResultado(res), fillOpacity: 0.9,
        color: sel ? 'var(--accent)' : '#ffffff', weight: sel ? 2 : 0.4, opacity: 0.6
      };
    },
    tooltipFn: f => tooltipResultado(nomeDe(f.properties),
      ag && ag.municipios[String(codDe(f.properties))]),
    onClick: f => simSelecionarMuni(uf, codDe(f.properties))
  });
  SIM.municipiosLayer.setFeatures(geo.features || []);
  SIM.municipiosLayer.addTo(simMap);
  const b = SIM.municipiosLayer.getBounds();
  if (b.isValid()) MLCompat.fitMapToBounds(simMap, b, { animate: false });
  simRenderLegenda();
  scheduleSimMapRefresh();
}

async function simRenderMapaLocais(uf, ibge) {
  if (!SIM.locaisGeoCache[uf]) {
    SIM.locaisGeoCache[uf] = await fetchJSON(PACK_URL + `locais_${uf}.geojson`).catch(() => null);
  }
  const geo = SIM.locaisGeoCache[uf];
  if (!geo) return simRenderMapaMunicipios(uf);

  const det = await detalheDaUF(uf);
  limparCamadas('locaisLayer');
  if (SIM.locaisLayer) { simMap.removeLayer(SIM.locaisLayer); SIM.locaisLayer = null; }

  const cols = simColunas();
  const nCol = cols.length;
  const feats = (geo.features || []).filter(f => f.properties.ibge === ibge);

  const resDoLocal = (i) => {
    if (!det) return null;
    // `det` ja vem do turno correto (ver detalheDaUF), inclusive com a
    // transferencia diferenciada por grupo aplicada local a local.
    const votos = [];
    for (let p = 0; p < nCol; p++) votos.push(det[i * nCol + p]);
    return { aptos: votos.reduce((a, b) => a + b, 0), votos };
  };

  SIM.locaisLayer = new MLCompat.GeoLayer(simMap, {
    id: 'sim-locais', type: 'point', tooltipClass: 'district-nyt-tooltip',
    radiusFn: f => {
      const a = f.properties.aptos || 0;
      return clamp(3 + Math.sqrt(a) / 12, 3.5, 18);
    },
    styleFn: f => {
      const res = resDoLocal(f.properties.i);
      return {
        fillColor: corDoResultado(res), fillOpacity: 0.9,
        color: f.properties.imp ? 'var(--warn)' : '#ffffff',
        weight: f.properties.imp ? 1.6 : 0.7, opacity: 0.9
      };
    },
    tooltipFn: f => tooltipResultado(
      f.properties.nm || 'Local de votação', resDoLocal(f.properties.i),
      f.properties.imp
        ? 'Local novo em 2026 — base estimada por locais de perfil demográfico semelhante.'
        : `${fmtInt(f.properties.aptos)} eleitores aptos · zona ${f.properties.z}`)
  });
  SIM.locaisLayer.setFeatures(feats);
  SIM.locaisLayer.addTo(simMap);
  const b = SIM.locaisLayer.getBounds();
  if (b.isValid()) MLCompat.fitMapToBounds(simMap, b, { padding: [30, 30], animate: false });
  simRenderLegenda();
  scheduleSimMapRefresh();
}

function simRenderLegenda() {
  const el = document.getElementById('simMapLegend');
  const res = resultadoDoEscopo({ level: 'nacional' }, agregadoAtivo());
  if (!res) { el.innerHTML = ''; return; }
  const ent = entradasDe(res).filter(x => x.key !== 'nuloBranco' && x.key !== 'abstencao')
    .sort((a, b) => b.votos - a.votos).filter(x => x.pctValidos > 0.5);
  el.innerHTML = ent.map(e =>
    `<span class="sim-leg"><i style="background:${e.cor}"></i>${escapeHtml(e.label)}</span>`).join('');
}

function simRenderBreadcrumb() {
  const el = document.getElementById('simBreadcrumb');
  const partes = [`<button data-nivel="br">Brasil</button>`];
  if (SIM.selectedUF) partes.push(`<button data-nivel="uf">${escapeHtml(UF_MAP.get(SIM.selectedUF) || SIM.selectedUF)}</button>`);
  if (SIM.selectedMuni) partes.push(`<span>${escapeHtml(SIM.nomesMuni[SIM.selectedMuni] || 'Município')}</span>`);
  el.innerHTML = partes.join('<em>›</em>');
  el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.nivel === 'br') simSelecionarBrasil();
    else simSelecionarUF(SIM.selectedUF);
  }));
}

// ------------------------------------------------------------- navegacao

async function trocarEscopo(novo) {
  SIM.escopo = novo;
  await simAtualizarShares();
  const r = await simEnviar({ type: 'demoSupport', scope: novo });
  if (r && r.support) { SIM.support = r.support; }
  simRenderTudo();
}

function simSelecionarBrasil() {
  SIM.selectedUF = null; SIM.selectedMuni = null;
  trocarEscopo({ level: 'nacional' });
}
function simSelecionarUF(uf) {
  if (!uf) return simSelecionarBrasil();
  SIM.selectedUF = uf; SIM.selectedMuni = null;
  if (SIM.abaSidebar === 'demografia') SIM.abaSidebar = 'resultado';
  trocarEscopo({ level: 'uf', uf });
}
function simSelecionarMuni(uf, ibge) {
  SIM.selectedUF = uf; SIM.selectedMuni = ibge;
  trocarEscopo({ level: 'municipio', uf, ibges: [ibge] });
}
function simVoltar() {
  if (SIM.selectedMuni) return simSelecionarUF(SIM.selectedUF);
  if (SIM.selectedUF) return simSelecionarBrasil();
}

// ============================================================================
// PERSISTENCIA
// ============================================================================

function cenarioSerializado() {
  return {
    versao: 1,
    candidatos: SIM.candidatos,
    proxId: SIM.proxId,
    transfer: SIM.transfer,
    ops: Array.from(SIM.ops.values()),
    tocados: Array.from(SIM.tocados),
    t2: { finalistas: SIM.t2.finalistas, matriz: SIM.t2.matriz }
  };
}
function salvarLocal() {
  try { localStorage.setItem('sim2026_cenario', JSON.stringify(cenarioSerializado())); }
  catch (e) { /* cota cheia: o cenario continua na memoria */ }
}
function restaurarLocal() {
  try {
    const bruto = localStorage.getItem('sim2026_cenario');
    if (!bruto) return false;
    const c = JSON.parse(bruto);
    if (!c.candidatos || !c.candidatos.length) return false;
    SIM.candidatos = c.candidatos;
    SIM.proxId = c.proxId || (Math.max(...c.candidatos.map(x => x.id)) + 1);
    SIM.transfer = c.transfer || simTransferPadrao();
    SIM.ops = new Map((c.ops || []).map(o => [chaveEscopo(o.scope), o]));
    SIM.tocados = new Set(c.tocados || []);
    if (c.t2) { SIM.t2.finalistas = c.t2.finalistas; SIM.t2.matriz = c.t2.matriz; }
    return true;
  } catch (e) { return false; }
}
function baixarCenario() {
  const blob = new Blob([JSON.stringify(cenarioSerializado(), null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cenario_2026.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ============================================================================
// INIT
// ============================================================================

function candidatosPadrao() {
  simAddCandidato('Lula', 'PT');
  simAddCandidato('Flávio Bolsonaro', 'PL');
  simAddCandidato('Ronaldo Caiado', 'PSD');
  simAddCandidato('Romeu Zema', 'NOVO');
  simAddCandidato('Renan Santos', 'MISSÃO');
}

async function initSimulador() {
  const temaSalvo = localStorage.getItem('sim2026_tema');
  document.body.dataset.theme = temaSalvo || 'dark';

  simMap = new maplibregl.Map({
    container: 'map',
    style: MLCompat.buildBasemapStyle(document.body.dataset.theme === 'light' ? 'light' : 'dark'),
    center: [-52, -14], zoom: 3.6, minZoom: 3, dragRotate: false, pitchWithRotate: false
  });
  MLCompat.augmentMap(simMap);
  MLCompat.refreshThemeColors();
  if (simMap.touchZoomRotate) simMap.touchZoomRotate.disableRotation();
  simMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  setupSimMapRefreshObservers();
  simMap.on('load', () => scheduleSimMapRefresh({ force: true }));

  document.getElementById('themeToggle').addEventListener('click', () => {
    const claro = document.body.dataset.theme === 'light';
    document.body.dataset.theme = claro ? 'dark' : 'light';
    localStorage.setItem('sim2026_tema', document.body.dataset.theme);
    MLCompat.setBasemapTheme(simMap, document.body.dataset.theme);
    scheduleSimMapRefresh();
    simRenderMapa();
  });

  const dl = document.getElementById('sim-party-list');
  PARTY_COLORS.forEach((_, p) => {
    const o = document.createElement('option'); o.value = p; dl.appendChild(o);
  });

  document.getElementById('mapLoader').classList.add('visible');
  simWorkerInit();
  try {
    await simCarregarDados();
  } catch (e) {
    console.error(e);
    document.getElementById('mapLoader').innerHTML =
      `<div class="sim-load-fail"><strong>Não foi possível carregar os dados de 2026.</strong>
       <span>${escapeHtml(e.message)}</span>
       <span>Rode <code>scripts/gerar_base_2026.py</code> para gerar <code>resultados_geo/sim2026/</code>.</span></div>`;
    return;
  }
  document.getElementById('mapLoader').classList.remove('visible');

  const primeiraVisita = !restaurarLocal();
  if (primeiraVisita) {
    candidatosPadrao();
    SIM.transfer = simTransferPadrao();
  }

  // Ligacoes de UI
  document.getElementById('btnAbrirConfig').addEventListener('click', () => abrirModal());
  document.getElementById('btnEditSimGlobal').addEventListener('click', () => abrirModal());
  document.getElementById('btnCloseConfigModal').addEventListener('click', fecharModal);
  document.getElementById('simConfigOverlay').addEventListener('click', e => {
    if (e.target.id === 'simConfigOverlay') fecharModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') fecharModal();
  });
  document.querySelectorAll('#simModalNav .sim-nav-item').forEach(b =>
    b.addEventListener('click', () => { SIM.paneAtivo = b.dataset.pane; simRenderModal(); }));

  document.getElementById('btnAplicarSimModal').addEventListener('click', async () => {
    fecharModal();
    await simCalcular();
    salvarLocal();
  });
  document.getElementById('btnSalvarCenario').addEventListener('click', baixarCenario);
  document.getElementById('btnResetSim').addEventListener('click', async () => {
    SIM.candidatos = []; SIM.proxId = 1;
    candidatosPadrao();
    SIM.transfer = simTransferPadrao();
    SIM.ops.clear(); SIM.tocados.clear();
    SIM.t2 = { finalistas: null, matriz: null, comparecimento: 0 };
    localStorage.removeItem('sim2026_cenario');
    await simCalcular();
    simRenderModal();
  });

  document.querySelectorAll('#simPanelResults .sim-tab').forEach(b =>
    b.addEventListener('click', () => { SIM.abaSidebar = b.dataset.tab; simRenderSidebar(); }));
  document.getElementById('btnVoltar').addEventListener('click', simVoltar);
  document.querySelectorAll('.sim-turno-btn').forEach(b => b.addEventListener('click', () => {
    SIM.turno = +b.dataset.turno;
    document.querySelectorAll('.sim-turno-btn').forEach(x =>
      x.classList.toggle('active', x === b));
    simRenderTudo();
  }));

  await simCalcular();
  salvarLocal();

  // Na primeira visita o modal abre sozinho, porque o editor e o produto — sem
  // isso ele fica escondido atras de um botao. Em visitas seguintes o cenario
  // salvo ja e o que interessa, entao o mapa aparece direto.
  if (primeiraVisita) abrirModal('candidatos');
}

window.addEventListener('DOMContentLoaded', initSimulador);
