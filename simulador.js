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

/* Eixo esquerda(-1) .. direita(+1), derivado exclusivamente do PARTIDO do
   candidato. Alimenta os valores sugeridos da migracao de 2022 e da matriz de
   transferencia do 2o turno. Nao ha controle manual de posicao na interface:
   trocar o partido do candidato e o que reposiciona ele.

   Entre os partidos em disputa a ordem e PT < PSD < NOVO < MISSAO < PL. */
const POS_PARTIDO = {
  'PSOL': -1.00, 'UP': -1.00, 'PCB': -0.95, 'PSTU': -0.95, 'PCDOB': -0.90,
  'PT': -0.85, 'PDT': -0.50, 'REDE': -0.40, 'PV': -0.30, 'PSB': -0.30,
  'CIDADANIA': 0.00, 'MDB': 0.10, 'PMN': 0.10, 'MOBILIZA': 0.10,
  'PSDB': 0.15, 'SOLIDARIEDADE': 0.20, 'PSD': 0.25, 'AVANTE': 0.30,
  'PODE': 0.30, 'UNIÃO': 0.40, 'AGIR': 0.40, 'PRD': 0.40, 'PP': 0.45,
  'REPUBLICANOS': 0.50, 'DC': 0.50, 'PSC': 0.60, 'NOVO': 0.70,
  'MISSÃO': 0.78, 'PL': 0.88, 'PRTB': 0.92
};

// Dispersao do kernel de transferencia (portado de EUA Proporcional/scripts/16_irv.py).
const TAU = 0.34;

// Posicao das origens de 2022 e quanto de cada uma sobra para candidatos.
const ORIGENS_2022 = {
  lula: { pos: -0.85, rotulo: 'Votou Lula', paraCand: 0.88, outros: 0.03, nulo: 0.03, abst: 0.06 },
  bolsonaro: { pos: 0.80, rotulo: 'Votou Bolsonaro', paraCand: 0.86, outros: 0.03, nulo: 0.03, abst: 0.08 },
  // Ciro, Tebet e os demais do 1o turno: eleitorado de centro, o mais
  // disputado de 2026 e o que mais se move entre candidaturas.
  outros: { pos: 0.00, rotulo: 'Votou em outro candidato', paraCand: 0.85, outros: 0.05, nulo: 0.05, abst: 0.05 },
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

  ops: new Map(),          // chaveEscopo -> { scope, validos, abstencao, nuloBranco, demo }
  escopo: { level: 'nacional' },

  // Assistente: a projecao base so existe depois que migracao e macrorregioes
  // estao configuradas. Antes disso nao ha simulacao nenhuma na tela.
  baseGerada: false,
  regioes2022: null,       // baselines/regioes.json
  pesosRegiao: {},         // 'mr:3' -> { validos:{...}, abstencao, nuloBranco }
  regiaoTocada: {},        // marca o que o usuario mexeu de fato
  migracaoTocada: false,

  agregado: null,          // ultimo resultado do worker (1T)
  agregado2T: null,
  support: null,           // apoio demografico do escopo ativo (estimativa do worker)
  shares: null,            // composicao do escopo ativo
  // Edicoes demograficas do usuario, POR ESCOPO — mesma chave de SIM.ops, para
  // que os dois nunca divirjam:
  //   chaveEscopo -> { 'dim|bucket': { validos:{colKey:pct}, abstencao, nuloBranco } }
  demoEdit: {},

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
function fmtPct(p, d = 2) { return isFinite(p) ? p.toFixed(d).replace('.', ',') + '%' : '–'; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/* Trava de 100%: um slider nunca passa do que sobra dos outros da mesma soma.
   Para dar mais a alguem e preciso liberar de outro antes — sem renormalizacao
   automatica pelas costas do usuario. Usada nos cinco editores (migracao,
   macrorregiao, regiao intermediaria, demografia e 2o turno). */
function travar100(v, somaDosOutros) {
  return clamp(v || 0, 0, Math.max(0, 100 - (somaDosOutros || 0)));
}

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
function getUniversalGradientColor(baseColorHex, marginPct) {
  if (!baseColorHex) return '#888888';
  const BASE_MARGIN = 20;
  const MIN_MARGIN = 0;
  const MAX_MARGIN = 60;
  const MAX_LIGHTEN = 14;
  const MAX_DARKEN = 18;
  const EASING_EXPONENT = 1.35;

  const numericMargin = Number.isFinite(marginPct) ? marginPct : BASE_MARGIN;
  const clampedMargin = Math.max(MIN_MARGIN, Math.min(MAX_MARGIN, numericMargin));
  const hsl = hexToHSL(baseColorHex);
  let targetL = hsl.l;

  if (clampedMargin < BASE_MARGIN) {
    const progress = Math.pow((BASE_MARGIN - clampedMargin) / (BASE_MARGIN - MIN_MARGIN), EASING_EXPONENT);
    targetL = hsl.l + (MAX_LIGHTEN * progress);
  } else if (clampedMargin > BASE_MARGIN) {
    const progress = Math.pow((clampedMargin - BASE_MARGIN) / (MAX_MARGIN - BASE_MARGIN), EASING_EXPONENT);
    targetL = hsl.l - (MAX_DARKEN * progress);
  }

  return hslToHex(hsl.h, hsl.s, Math.max(8, Math.min(92, targetL)));
}

function getWinnerPctGradientColor(baseColorHex, winnerPct) {
  if (!baseColorHex) return '#888888';
  const hsl = hexToHSL(baseColorHex);
  const pct = Number.isFinite(winnerPct) ? winnerPct : 50;

  if (pct >= 80) {
    const targetL = Math.max(10, hsl.l - 24);
    const targetS = Math.min(100, hsl.s * 1.12);
    return hslToHex(hsl.h, targetS, targetL);
  } else if (pct >= 70) {
    const targetL = Math.max(16, hsl.l - 16);
    const targetS = Math.min(100, hsl.s * 1.06);
    return hslToHex(hsl.h, targetS, targetL);
  } else if (pct >= 60) {
    const targetL = Math.max(22, hsl.l - 8);
    return hslToHex(hsl.h, hsl.s, targetL);
  } else if (pct >= 50) {
    // Nível dos 50% (50% a 60%): Cor base predefinida
    return baseColorHex;
  } else if (pct >= 40) {
    const targetS = Math.max(44, hsl.s * 0.9);
    const targetL = Math.min(78, hsl.l + 8);
    return hslToHex(hsl.h, targetS, targetL);
  } else if (pct >= 30) {
    const targetS = Math.max(35, hsl.s * 0.8);
    const targetL = Math.min(86, hsl.l + 16);
    return hslToHex(hsl.h, targetS, targetL);
  } else {
    // Piso de porcentagem (< 30%)
    const targetS = Math.max(25, hsl.s * 0.7);
    const targetL = Math.min(92, hsl.l + 24);
    return hslToHex(hsl.h, targetS, targetL);
  }
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

/* Duas leituras do mesmo bucket demografico.

   O worker consome um VETOR POSICIONAL sobre o eleitorado APTO do grupo, com
   todas as colunas somando 1 — abstencao e nulos sao colunas como qualquer
   outra (js/sim_ei_worker.js, cabecalho).

   O editor mostra a mesma coisa separada em duas grandezas independentes, como
   renderRegioes ja faz por territorio: candidatos como % dos VALIDOS daquele
   grupo (somando 100 entre si) e abstencao/nulos como % dos aptos, fora dessa
   soma. Sem a separacao, subir um candidato exigiria antes baixar a abstencao. */
function vetorParaEditor(vet) {
  const v = vet || [];
  const validas = simColunasValidas();
  const soma = validas.reduce((s, c) => s + (v[idxColuna(c.key)] || 0), 0);
  const validos = {};
  validas.forEach(c => {
    validos[c.key] = soma > 0 ? 100 * (v[idxColuna(c.key)] || 0) / soma : 0;
  });
  return {
    validos,
    abstencao: 100 * (v[idxColuna('abstencao')] || 0),
    nuloBranco: 100 * (v[idxColuna('nuloBranco')] || 0)
  };
}

/* Volta para o vetor do worker. Os validos sao renormalizados dentro do pool
   que sobra do comparecimento (pool = 1 - abstencao - nulos), reproduzindo a
   recomposicao que o worker faz em aplicarOp — e o que garante que o vetor
   sempre soma 1, mesmo quando o bloco de validos na tela esta em 92%. Mesma
   divisao de trabalho de opsRegionais: a UI trava, a exportacao normaliza. */
function editorParaVetor(ed) {
  const vet = new Array(simColunas().length).fill(0);
  if (!ed) return vet;
  const abst = clamp(ed.abstencao || 0, 0, 100) / 100;
  const nulo = clamp(ed.nuloBranco || 0, 0, 100) / 100;
  const pool = Math.max(0, 1 - abst - nulo);
  const validas = simColunasValidas();
  const soma = validas.reduce((s, c) => s + ((ed.validos || {})[c.key] || 0), 0);
  if (soma > 0) {
    validas.forEach(c => {
      vet[idxColuna(c.key)] = pool * ((ed.validos || {})[c.key] || 0) / soma;
    });
  }
  vet[idxColuna('abstencao')] = abst;
  vet[idxColuna('nuloBranco')] = nulo;
  return vet;
}

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
  // Um candidato novo entra ANTES de 'outros', deslocando todos os indices
  // seguintes: os vetores posicionais ja guardados passariam a significar outra
  // coisa. Descartar e a unica leitura honesta — mesma razao de simRemoveCandidato.
  esquecerEdicoesPosicionais();
  return c;
}
function simRemoveCandidato(id) {
  SIM.candidatos = SIM.candidatos.filter(c => c.id !== id);
  const k = 'cand_' + id;
  for (const o in SIM.transfer) delete SIM.transfer[o][k];
  esquecerEdicoesPosicionais();
  SIM.t2.finalistas = null;
}

/* As ops guardam vetores posicionais; ao mudar o numero de colunas elas deixam
   de fazer sentido e sao descartadas em vez de reindexadas errado. As edicoes
   demograficas em aberto vao junto: sao a origem dessas mesmas ops. */
function esquecerEdicoesPosicionais() {
  SIM.ops.clear();
  SIM.demoEdit = {};
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
  const origens = origensLista();
  const cols = simColunas();

  origens.forEach(origem => {
    const linha = {};
    cols.forEach(c => { linha[c.key] = 0; });
    t[origem] = linha;
  });
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
/* Ordem de construcao da simulacao:
     1. migracao de 2022  (montarBase, no worker)
     2. redutos pessoais  (aplicarRedutos, no worker)
     3. metas por macrorregiao          <- obrigatoria
     4. metas por regiao intermediaria  <- refinamento
     5. ajustes por UF / municipio e edicoes demograficas
   O worker reordena por rank, mas montamos na ordem certa para facilitar a
   leitura de quem for depurar. */
function opsArray() {
  const manuais = Array.from(SIM.ops.values()).filter(
    o => o.validos || o.abstencao != null || o.nuloBranco != null
      || (o.demo && Object.keys(o.demo).length));
  return opsRegionais('mr').concat(opsRegionais('ri')).concat(manuais);
}

/* Vinculos de reduto ativos, no formato do worker. */
function vinculosReduto() {
  return SIM.candidatos
    .filter(c => c.reduto)
    .map(c => ({ coluna: idxColuna('cand_' + c.id), reduto: c.reduto, forca: 1 }))
    .filter(v => v.coluna >= 0);
}

/* A simulacao so pode rodar depois dos dois inputs obrigatorios. */
function prontoParaBase() {
  const migOk = origensLista().every(o => simTransferTotal(o) >= 0 && simTransferTotal(o) <= 100.5);
  const regs = listaRegioes('mr');
  regs.forEach(r => pesosDaRegiao(`mr:${r.codigo}`));   // recalcula se a migracao mudou
  const regOk = regs.length > 0 && regs.every(r => {
    const p = SIM.pesosRegiao[`mr:${r.codigo}`];
    if (!p) return false;
    const s = simColunasValidas().reduce((a, c) => a + (p.validos[c.key] || 0), 0);
    return s > 0;
  });
  return { migOk, regOk, ok: migOk && regOk };
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
    // URL absoluta: dentro de um Worker as relativas resolvem contra o script
    // do proprio worker (js/), nao contra a pagina.
    simWorker.postMessage({ type: 'load', baseDir: new URL(PACK_URL, location.href).href });
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
  if (!SIM.baseGerada) return;                 // nada de simulacao pre-gerada
  if (SIM.calculando) { SIM.pendente = true; return; }
  SIM.calculando = true;
  try {
    const r = await simEnviar({
      type: 'compute',
      parties: simColunas().length,
      iNulo: idxColuna('nuloBranco'),
      iAbst: idxColuna('abstencao'),
      transfer: simTransferMatriz(),
      redutos: vinculosReduto(),
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

/* Buckets com meta aplicada NO ESCOPO ATIVO. Derivado das ops em vez de
   guardado a parte: SIM.support e por escopo, e um conjunto global de "tocados"
   divergia dele — um bucket fixado no Brasil aparecia fixado tambem em SP, onde
   nao ha meta nenhuma. */
function bucketsFixados(escopo) {
  const op = opDoEscopo(escopo || SIM.escopo);
  return new Set(op && op.demo ? Object.keys(op.demo) : []);
}

/* As dimensoes NAO fixadas passam a refletir o apoio observado depois da
   redistribuicao (editar religiao move os sliders de escolaridade, etc.), e e o
   que faz os sliders acompanharem migracao, macrorregioes e ajustes por
   UF/municipio. Buckets com meta ficam intactos. */
function simAplicarSupport(novo) {
  if (!novo) return;
  if (!SIM.support) SIM.support = {};
  const op = opDoEscopo(SIM.escopo);
  const metas = (op && op.demo) || {};
  for (const dim in novo) {
    // Onde ha meta, o valor exibido e a propria meta e nao a reestimativa: a
    // realocacao aditiva, o corte de negativos e o arredondamento do worker
    // devolvem algo proximo mas nao identico, e o usuario nao deve ver o numero
    // que digitou derivar sozinho.
    SIM.support[dim] = novo[dim].map((linha, i) => {
      const meta = metas[dim + '|' + i];
      return meta ? meta.slice() : linha;
    });
  }
}

/* Edicoes demograficas em aberto no escopo ativo. */
function demoEditsDoEscopo(criar = false, escopo) {
  const k = chaveEscopo(escopo || SIM.escopo);
  if (!SIM.demoEdit[k] && criar) SIM.demoEdit[k] = {};
  return SIM.demoEdit[k] || null;
}

/* Leitura de um bucket na forma do editor: a edicao do usuario quando existe,
   senao a estimativa mais recente do worker. */
function edicaoDoBucket(dim, bi, criar = false) {
  const chave = dim + '|' + bi;
  const eds = demoEditsDoEscopo(criar);
  if (eds && eds[chave]) return eds[chave];
  const base = vetorParaEditor(SIM.support && SIM.support[dim] ? SIM.support[dim][bi] : null);
  if (criar) eds[chave] = base;
  return base;
}

/* SIM.support com as edicoes em aberto por cima — o que a previa instantanea e
   o badge precisam ler para refletir o que esta na tela. */
function supportEfetivo(dim) {
  if (!SIM.support || !SIM.support[dim]) return null;
  const eds = demoEditsDoEscopo() || {};
  return SIM.support[dim].map((linha, i) => {
    const ed = eds[dim + '|' + i];
    return ed ? editorParaVetor(ed) : linha;
  });
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
  SIM.regioes2022 = await fetchJSON(PACK_URL + 'baselines/regioes.json').catch(() => null);

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

// Etapas 4-6 só abrem depois da projeção base existir.
const PANES = ['candidatos', 'cenario', 'regioes', 'rgint', 'demografia', 'turno2'];
const PANES_POSTERIORES = new Set(['rgint', 'demografia', 'turno2']);

function simRenderModal() {
  const estado = prontoParaBase();

  document.querySelectorAll('#simModalNav .sim-nav-item').forEach(b => {
    const p = b.dataset.pane;
    const travado = PANES_POSTERIORES.has(p) && !SIM.baseGerada;
    b.classList.toggle('active', p === SIM.paneAtivo);
    b.classList.toggle('travado', travado);
    b.disabled = travado;
    b.title = travado ? 'Disponível depois de gerar a projeção base' : '';
    const marca = b.querySelector('.sim-nav-num');
    if (marca) {
      const feito = (p === 'cenario' && estado.migOk) || (p === 'regioes' && estado.regOk);
      b.classList.toggle('feito', feito);
    }
  });
  PANES.forEach(p => {
    const el = document.getElementById('simPane' + p.charAt(0).toUpperCase() + p.slice(1));
    if (el) el.hidden = (p !== SIM.paneAtivo);
  });

  const hint = document.getElementById('simModalScopeHint');
  if (hint) {
    const n = SIM.indice ? Object.values(SIM.indice.ufs).reduce((a, b) => a + b, 0) : 0;
    hint.textContent = SIM.baseGerada
      ? `${rotuloEscopo(SIM.escopo)} — ${fmtInt(n)} locais de votação, eleitorado de 2026`
      : `${fmtInt(n)} locais de votação · configure a migração e as macrorregiões para gerar a projeção`;
  }

  if (SIM.paneAtivo === 'candidatos') renderPaneCandidatos();
  if (SIM.paneAtivo === 'cenario') renderPaneCenario();
  if (SIM.paneAtivo === 'regioes') renderPaneRegioes();
  if (SIM.paneAtivo === 'rgint') renderPaneRgint();
  if (SIM.paneAtivo === 'demografia') renderPaneDemografia();
  if (SIM.paneAtivo === 'turno2') renderPaneTurno2();

  // O botao principal muda de papel conforme a etapa.
  const btn = document.getElementById('btnAplicarSimModal');
  if (btn) {
    btn.textContent = SIM.baseGerada ? 'Aplicar alterações' : 'Gerar projeção base';
    btn.disabled = !estado.ok;
    btn.title = estado.ok ? ''
      : (!estado.migOk ? 'Cada linha da migração precisa somar 100%'
        : 'Configure todas as macrorregiões');
  }
  renderNavFoot();
}

function renderNavFoot() {
  const el = document.getElementById('simNavFoot');
  if (!el) return;
  const res = SIM.agregado && SIM.agregado.brasil;
  if (!res) {
    const e = prontoParaBase();
    el.innerHTML = `<div class="sim-nav-preview">
        <span class="sim-nav-preview-tit">Para gerar a projeção</span>
        <div class="sim-check-item ${e.migOk ? 'ok' : ''}">
          <i>${e.migOk ? '✓' : '1'}</i> Migração de 2022</div>
        <div class="sim-check-item ${e.regOk ? 'ok' : ''}">
          <i>${e.regOk ? '✓' : '2'}</i> Pesos por macrorregião</div>
      </div>`;
    return;
  }
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

/* Redutos disponiveis no pacote (governadores de 2022 que disputam 2026).
   O vinculo e sugerido pelo nome do candidato e pode ser trocado a mao. */
function redutosDisponiveis() {
  return (SIM.indice && SIM.indice.redutos) || [];
}
function redutoSugerido(cand) {
  const nome = cand && cand.nome ? cand.nome.trim() : '';
  if (nome !== 'Ronaldo Caiado' && nome !== 'Romeu Zema') return '';
  const n = normalizePartyKey(nome);
  if (!n) return '';
  const achado = redutosDisponiveis().find(r => {
    const alvo = normalizePartyKey(r.nome);
    return alvo && (n === alvo || n.includes(alvo.split(' ').pop()));
  });
  return achado ? achado.key : '';
}

function renderPaneCandidatos() {
  const el = document.getElementById('simPaneCandidatos');
  const redutos = redutosDisponiveis();
  el.innerHTML = `
    <header class="sim-pane-head">
      <h4>Candidatos</h4>
      <p>A ordem aqui é a ordem em que aparecem no resultado. O
         <strong>partido</strong> posiciona o candidato no eixo
         esquerda–direita, e é isso que gera os valores sugeridos da migração de
         2022 e da transferência de segundo turno — ambos editáveis depois.</p>
    </header>
    <div class="sim-cand-list" id="simCandList">
      ${SIM.candidatos.map(c => {
        const nomeLimpo = c.nome ? c.nome.trim() : '';
        const podeTerReduto = (nomeLimpo === 'Ronaldo Caiado' || nomeLimpo === 'Romeu Zema');
        if (!podeTerReduto) c.reduto = null;
        return `
        <div class="sim-cand-item" data-id="${c.id}">
          <input type="color" class="sim-cand-color" value="${c.cor}" data-id="${c.id}" title="Cor">
          <input type="text" class="sim-cand-nome" value="${escapeHtml(c.nome)}" placeholder="Nome" data-id="${c.id}">
          <input type="text" class="sim-cand-partido" value="${escapeHtml(c.partido)}" placeholder="Partido"
                 list="sim-party-list" data-id="${c.id}">
          ${(redutos.length && podeTerReduto) ? `
          <select class="sim-cand-reduto" data-id="${c.id}"
                  title="Concentra a votação do candidato onde ele foi bem para governador em 2022">
            <option value="">sem reduto</option>
            ${redutos.map(r => `<option value="${r.key}" ${c.reduto === r.key ? 'selected' : ''}
              >base em ${r.uf}</option>`).join('')}
          </select>` : ''}
          <button class="sim-cand-remove" data-id="${c.id}" title="Remover">✕</button>
        </div>`;
      }).join('')}
    </div>
    <button class="sim-btn sim-btn-add" id="btnAddCand">+ Adicionar candidato</button>

    ${redutos.length ? `<div class="sim-note" style="margin-top:14px">
      <strong>Reduto pessoal.</strong> ${redutos.map(r => escapeHtml(r.nome) + ' (' + r.uf + ')').join(' e ')}
      foram governadores em 2022. Com o reduto ligado, a votação do candidato
      <em>dentro do estado</em> passa a seguir o mapa de onde ele foi bem para o
      governo, em vez de se espalhar de forma uniforme. O total dele no estado
      não muda — muda de onde vem.
    </div>` : ''}

    <div class="sim-perene-group">
      <div class="sim-perene-item"><i class="sim-perene-dot" style="background:${COR_OUTROS}"></i>
        Outros — candidaturas menores, sempre presentes</div>
      <div class="sim-perene-item"><i class="sim-perene-dot" style="background:${COR_NULO}"></i>
        Nulos e brancos — definidos à parte, fora da soma dos candidatos</div>
      <div class="sim-perene-item"><i class="sim-perene-dot" style="background:${COR_ABST}"></i>
        Abstenção — idem; o eleitorado apto de 2026 é o total fixo</div>
    </div>`;

  const invalidar = () => {
    // Mexer nos candidatos muda o numero de colunas: as metas guardadas viram
    // vetores posicionais sem sentido e a projecao precisa ser refeita.
    SIM.transfer = simTransferPadrao();
    SIM.t2.chaveMatriz = null;
    SIM.baseGerada = false;
  };

  el.querySelectorAll('.sim-cand-nome').forEach(i => {
    i.addEventListener('input', e => {
      const c = SIM.candidatos.find(x => x.id === +e.target.dataset.id);
      if (c) { c.nome = e.target.value; renderNavFoot(); }
    });
    i.addEventListener('change', e => {
      const c = SIM.candidatos.find(x => x.id === +e.target.dataset.id);
      if (c) {
        c.nome = e.target.value;
        const nomeLimpo = c.nome ? c.nome.trim() : '';
        if (nomeLimpo !== 'Ronaldo Caiado' && nomeLimpo !== 'Romeu Zema') {
          c.reduto = null;
        } else if (!c.reduto) {
          c.reduto = redutoSugerido(c) || null;
        }
        renderPaneCandidatos();
      }
    });
  });
  el.querySelectorAll('.sim-cand-partido').forEach(i => i.addEventListener('change', e => {
    const c = SIM.candidatos.find(x => x.id === +e.target.dataset.id);
    if (!c) return;
    c.partido = e.target.value;
    const cor = getPartyColor(c.partido);
    if (cor) c.cor = cor;
    c.pos = getPartyPos(c.partido);
    invalidar();
    renderPaneCandidatos();
  }));
  el.querySelectorAll('.sim-cand-color').forEach(i => i.addEventListener('input', e => {
    const c = SIM.candidatos.find(x => x.id === +e.target.dataset.id);
    if (c) c.cor = e.target.value;
  }));
  el.querySelectorAll('.sim-cand-reduto').forEach(s => s.addEventListener('change', e => {
    const c = SIM.candidatos.find(x => x.id === +e.target.dataset.id);
    if (c) { c.reduto = e.target.value || null; SIM.baseGerada = false; }
  }));
  el.querySelectorAll('.sim-cand-remove').forEach(b => b.addEventListener('click', e => {
    simRemoveCandidato(+e.target.dataset.id);
    invalidar();
    renderPaneCandidatos();
  }));
  document.getElementById('btnAddCand').addEventListener('click', () => {
    const c = simAddCandidato('', '');
    c.reduto = null;
    invalidar();
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
      <h4>Migração do 1º turno de 2022 <span class="sim-req">obrigatório</span></h4>
      <p>Este é o pilar do simulador. Cada linha é um comportamento no
         <strong>primeiro turno de 2022</strong>, medido local de votação a local
         de votação; os controles definem para onde esse eleitorado vai em 2026.
         Usamos o 1º turno justamente por causa da linha
         <em>“votou em outro candidato”</em> (Ciro, Tebet e demais): esse
         eleitorado de centro some no 2º turno, diluído em Lula e Bolsonaro, e é
         o mais disputado em 2026. O eleitorado é o de 2026, então quem entrou no
         cadastro desde então aparece diluído em todas as linhas.</p>
    </header>
    ${origensLista().map(origem => {
    const cfg = ORIGENS_2022[origem] || { rotulo: origem };
    const total = simTransferTotal(origem);
    const ok = total >= 0 && total <= 100.5;
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

  // Trava de 100% por linha (travar100): um destino nunca passa do que sobra
  // dos outros.
  const atualiza = (origem, col, v) => {
    SIM.transfer[origem] = SIM.transfer[origem] || {};
    const linha = SIM.transfer[origem];
    v = travar100(v, simColunas().filter(c => c.key !== col)
      .reduce((s, c) => s + (linha[c.key] || 0), 0));
    linha[col] = v;
    SIM.migracaoTocada = true;
    SIM.baseGerada = false;
    const bloco = el.querySelector(`.sim-block[data-origem="${origem}"]`);
    const total = simTransferTotal(origem);
    const badge = bloco.querySelector('.sim-total');
    badge.textContent = fmtPct(total);
    badge.classList.toggle('ok', total >= 0 && total <= 100.5);
    badge.classList.toggle('bad', total < 0 || total > 100.5);
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
  const linhas = supportEfetivo(dimKey);
  if (!linhas) return null;
  const nCol = simColunas().length;
  const fora = new Array(nCol).fill(0);
  linhas.forEach((linha, i) => {
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

/* Editor de voto por grupo demografico.

   Mesmo contrato de renderRegioes, so que o recorte e demografico em vez de
   territorial: os candidatos somam 100% ENTRE SI (divisao dos validos daquele
   grupo) e abstencao/nulos ficam fora dessa soma, cada um como percentual do
   eleitorado apto do grupo. O vetor que o worker consome — todas as colunas
   somando 1 sobre os aptos — e reconstruido por editorParaVetor na aplicacao.

   Os valores exibidos sao sempre a estimativa mais recente da regressao, com as
   edicoes em aberto do escopo por cima; entao mexer em migracao, macrorregiao,
   UF/municipio ou em outra dimensao move estes sliders sozinho. So os buckets
   com meta aplicada (op.demo) ficam fixos. */
function renderPaneDemografia() {
  const el = document.getElementById('simPaneDemografia');
  if (!SIM.support) {
    el.innerHTML = `<header class="sim-pane-head"><h4>Demografia</h4></header>
      <div class="sim-note">Aplique a simulação uma vez para estimar o voto por grupo.</div>`;
    return;
  }
  const cols = simColunas();
  const validas = simColunasValidas();
  const dims = SIM.indice.dimensions.filter(d => d.key !== 'voto2022' && SIM.support[d.key]);
  const fixados = bucketsFixados();
  const emAberto = demoEditsDoEscopo() || {};
  const temEdicao = (dimKey) => Object.keys(emAberto).some(k => k.startsWith(dimKey + '|'));
  const temMeta = (dimKey) => Array.from(fixados).some(k => k.startsWith(dimKey + '|'));

  el.innerHTML = `
    <header class="sim-pane-head">
      <h4>Voto por grupo demográfico</h4>
      <p>Os valores partem de uma <strong>regressão ecológica</strong> sobre os
         ${fmtInt(SIM.indice ? Object.values(SIM.indice.ufs).reduce((a, b) => a + b, 0) : 0)}
         locais de votação: o quanto cada grupo explica a variação do voto entre
         locais. Os candidatos dividem 100% dos válidos do grupo; abstenção e
         nulos são definidos à parte, sobre o eleitorado apto. Ao aplicar uma
         dimensão, as demais são reestimadas sobre o novo resultado — só o que
         você aplicar fica fixo.
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
          ${temMeta(d.key) ? '<small class="sim-selo">com metas</small>' : ''}
          <i class="sim-chev"></i>
        </button>
        <div class="sim-dim-body">
          <div class="sim-dim-actions">
            <button class="sim-btn sim-btn-apply sim-btn-mini" data-aplicar-dim="${d.key}"
                    ${temEdicao(d.key) ? '' : 'disabled'}>Aplicar ${escapeHtml(d.label)}</button>
            <button class="sim-btn sim-btn-mini sim-btn-ghost" data-soltar-dim="${d.key}"
                    ${temMeta(d.key) || temEdicao(d.key) ? '' : 'disabled'}>Soltar todos</button>
            <small>Aplica de uma vez todos os grupos editados desta dimensão.</small>
          </div>
          ${d.buckets.map((b, bi) => {
      const ed = edicaoDoBucket(d.key, bi);
      const share = SIM.shares && SIM.shares[d.key] ? SIM.shares[d.key][bi] : null;
      const fixado = fixados.has(d.key + '|' + bi);
      const editado = !!emAberto[d.key + '|' + bi];
      const total = validas.reduce((s, c) => s + (ed.validos[c.key] || 0), 0);
      return `
            <div class="sim-bucket ${fixado || editado ? 'tocado' : ''}" data-dim="${d.key}" data-bi="${bi}">
              <div class="sim-bucket-head">
                <span class="sim-bucket-name">${escapeHtml(b.label)}</span>
                <span class="sim-bucket-share">${share != null ? fmtPct(100 * share) + ' do eleitorado' : ''}</span>
              </div>
              ${validas.map(c => `
                <div class="sim-slider-row">
                  <i class="sim-chip" style="background:${c.cor}"></i>
                  <span class="sim-slider-label" title="${escapeHtml(c.label)}">${escapeHtml(c.label)}</span>
                  <input type="range" class="sim-slider" min="0" max="100" step="0.5"
                         value="${(ed.validos[c.key] || 0).toFixed(1)}"
                         data-dim="${d.key}" data-bi="${bi}" data-col="${c.key}">
                  <input type="number" class="sim-slider-val" min="0" max="100" step="0.1"
                         value="${(ed.validos[c.key] || 0).toFixed(1)}"
                         data-dim="${d.key}" data-bi="${bi}" data-col="${c.key}">
                  <span class="sim-unit">%</span>
                </div>`).join('')}
              <div class="sim-sep">do eleitorado apto — independente da divisão acima</div>
              ${[['abstencao', 'Abstenção', COR_ABST], ['nuloBranco', 'Nulos e brancos', COR_NULO]].map(([k, rot, cor]) => `
                <div class="sim-slider-row">
                  <i class="sim-chip" style="background:${cor}"></i>
                  <span class="sim-slider-label">${rot}</span>
                  <input type="range" class="sim-slider" min="0" max="70" step="0.1"
                         value="${(ed[k] || 0).toFixed(1)}"
                         data-dim="${d.key}" data-bi="${bi}" data-tn="${k}">
                  <input type="number" class="sim-slider-val" min="0" max="70" step="0.1"
                         value="${(ed[k] || 0).toFixed(1)}"
                         data-dim="${d.key}" data-bi="${bi}" data-tn="${k}">
                  <span class="sim-unit">%</span>
                </div>`).join('')}
              <div class="sim-bucket-foot">
                <span class="sim-total ${Math.abs(total - 100) < 0.5 ? 'ok' : 'bad'}"
                      data-total="${d.key}|${bi}">${fmtPct(total)}</span>
                <small data-comp="${d.key}|${bi}">Comparecimento projetado: ${fmtPct(100 - (ed.abstencao || 0))}</small>
                <button class="sim-btn sim-btn-mini sim-btn-ghost" data-soltar="${d.key}|${bi}"
                        ${fixado || editado ? '' : 'disabled'}>Soltar</button>
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

  const caixa = (dim, bi) => el.querySelector(`.sim-bucket[data-dim="${dim}"][data-bi="${bi}"]`);
  const repinta = (dim, bi) => {
    const ed = edicaoDoBucket(dim, bi);
    const badge = el.querySelector(`[data-total="${dim}|${bi}"]`);
    if (badge) {
      const t = validas.reduce((s, c) => s + (ed.validos[c.key] || 0), 0);
      badge.textContent = fmtPct(t);
      badge.classList.toggle('ok', Math.abs(t - 100) < 0.5);
      badge.classList.toggle('bad', Math.abs(t - 100) >= 0.5);
    }
    const comp = el.querySelector(`[data-comp="${dim}|${bi}"]`);
    if (comp) comp.textContent = `Comparecimento projetado: ${fmtPct(100 - (ed.abstencao || 0))}`;
  };
  /* Previa instantanea: produto escalar entre a composicao do escopo e o apoio
     configurado, na thread principal. Da a leitura imediata do agregado
     implicado pela dimensao aberta, sem esperar o worker — que so entra quando
     o usuario aplica a dimensao. */
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

  // Os botoes nascem desabilitados quando nao ha nada editado nem aplicado; a
  // primeira mexida num bucket ja os libera, sem redesenhar o painel — se
  // dependessem do proximo render, o usuario nao teria como desfazer o que
  // acabou de mexer.
  const liberarAplicar = (dim, bi) => {
    [`[data-aplicar-dim="${dim}"]`, `[data-soltar-dim="${dim}"]`, `[data-soltar="${dim}|${bi}"]`]
      .forEach(sel => {
        const b = el.querySelector(sel);
        if (b) b.disabled = false;
      });
  };

  // Trava de 100% entre os candidatos, identica a das regioes: o slider nunca
  // passa do que sobra dos outros.
  const setarValido = (dim, bi, col, v) => {
    const ed = edicaoDoBucket(dim, bi, true);
    v = travar100(v, validas.filter(c => c.key !== col)
      .reduce((s, c) => s + (ed.validos[c.key] || 0), 0));
    ed.validos[col] = v;
    const box = caixa(dim, bi);
    if (box) {
      const r = box.querySelector(`.sim-slider[data-col="${col}"]`);
      const n = box.querySelector(`.sim-slider-val[data-col="${col}"]`);
      if (r) r.value = v;
      if (n) n.value = v.toFixed(1);
      box.classList.add('tocado');
    }
    repinta(dim, bi);
    liberarAplicar(dim, bi);
    previa(dim);
  };
  // Comparecimento: abstencao e nulos travam um contra o outro em 95% dos
  // aptos, deixando sempre folga para voto valido.
  const setarTurnout = (dim, bi, campo, v) => {
    const ed = edicaoDoBucket(dim, bi, true);
    const outro = campo === 'abstencao' ? (ed.nuloBranco || 0) : (ed.abstencao || 0);
    ed[campo] = clamp(v || 0, 0, Math.max(0, 95 - outro));
    const box = caixa(dim, bi);
    if (box) {
      const r = box.querySelector(`.sim-slider[data-tn="${campo}"]`);
      const n = box.querySelector(`.sim-slider-val[data-tn="${campo}"]`);
      if (r) r.value = ed[campo];
      if (n) n.value = ed[campo].toFixed(1);
      box.classList.add('tocado');
    }
    repinta(dim, bi);
    liberarAplicar(dim, bi);
    previa(dim);
  };

  el.querySelectorAll('.sim-slider[data-col], .sim-slider-val[data-col]').forEach(s =>
    s.addEventListener(s.type === 'range' ? 'input' : 'change', e =>
      setarValido(e.target.dataset.dim, +e.target.dataset.bi, e.target.dataset.col,
        parseFloat(e.target.value) || 0)));
  el.querySelectorAll('.sim-slider[data-tn], .sim-slider-val[data-tn]').forEach(s =>
    s.addEventListener(s.type === 'range' ? 'input' : 'change', e =>
      setarTurnout(e.target.dataset.dim, +e.target.dataset.bi, e.target.dataset.tn,
        parseFloat(e.target.value) || 0)));

  /* Aplica a dimensao inteira num unico recalculo. Cada bucket vira um alvo em
     op.demo; as demais dimensoes sao reestimadas sobre o resultado e voltam
     redesenhadas por simAplicarSupport. */
  el.querySelectorAll('[data-aplicar-dim]').forEach(b => b.addEventListener('click', async e => {
    const dim = e.currentTarget.dataset.aplicarDim;
    const eds = demoEditsDoEscopo() || {};
    const chaves = Object.keys(eds).filter(k => k.startsWith(dim + '|'));
    if (!chaves.length) return;
    const op = opDoEscopo(SIM.escopo, true);
    chaves.forEach(k => { op.demo[k] = editorParaVetor(eds[k]); });
    await simCalcular();
    renderPaneDemografia();
  }));
  /* Solta os grupos: some a edicao em aberto e a meta. So vale a pena recalcular
     se havia mesmo uma meta valendo — descartar edicao nao aplicada nao mudou
     nada na simulacao. */
  const soltar = async (chaves) => {
    const op = opDoEscopo(SIM.escopo);
    const eds = demoEditsDoEscopo() || {};
    let tinhaMeta = false;
    chaves.forEach(k => {
      delete eds[k];
      if (op && op.demo && op.demo[k]) { delete op.demo[k]; tinhaMeta = true; }
    });
    if (tinhaMeta) await simCalcular();
    renderPaneDemografia();
  };
  el.querySelectorAll('[data-soltar-dim]').forEach(b => b.addEventListener('click', e => {
    const dim = e.currentTarget.dataset.soltarDim;
    const op = opDoEscopo(SIM.escopo);
    const chaves = new Set(Object.keys(demoEditsDoEscopo() || {})
      .concat(Object.keys((op && op.demo) || {}))
      .filter(k => k.startsWith(dim + '|')));
    soltar(Array.from(chaves));
  }));
  el.querySelectorAll('[data-soltar]').forEach(b => b.addEventListener('click', e =>
    soltar([e.currentTarget.dataset.soltar])));
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

/* Valores sugeridos de uma regiao: a migracao de 2022 aplicada a composicao
   REAL daquela regiao no 1o turno. Com a matriz padrao isso devolve, na
   pratica, o percentual de Lula em Lula e o de Bolsonaro no candidato do PL —
   e ja distribui os demais candidatos de forma coerente.

   Abstencao e nulos vem diretos de 2022, sem passar pela transferencia: sao
   grandezas independentes da divisao entre candidatos. */
function pesosRegionaisPadrao(chaveRegiao) {
  const reg = SIM.regioes2022 && SIM.regioes2022.regioes && SIM.regioes2022.regioes[chaveRegiao];
  if (!reg) return null;
  const cols = simColunas();
  const validas = simColunasValidas();

  const alvos = {};
  validas.forEach(c => { alvos[c.key] = 0; });

  cols.forEach(c => {
    if (c.cand) {
      const nome = (c.cand.nome || '').trim();
      const partido = (c.cand.partido || '').trim();
      if (nome === 'Lula' || partido === 'PT') {
        alvos[c.key] = reg.pct_validos ? (reg.pct_validos.lula || 0) : 0;
      } else if (nome.includes('Bolsonaro') || partido === 'PL') {
        alvos[c.key] = reg.pct_validos ? (reg.pct_validos.bolsonaro || 0) : 0;
      }
    }
  });

  return {
    validos: alvos,
    abstencao: reg.pct_aptos ? (reg.pct_aptos.abstencao || 0) : 0,
    nuloBranco: reg.pct_aptos ? (reg.pct_aptos.nulo_branco || 0) : 0
  };
}

/* Assinatura do que os pesos regionais dependem: a matriz de migracao e o
   conjunto de candidatos. Mudou qualquer um dos dois, os valores sugeridos
   precisam ser recalculados. */
function assinaturaMigracao() {
  return SIM.candidatos.map(c => c.id).join(',') + '|'
    + origensLista().map(o => {
      const l = SIM.transfer[o] || {};
      return simColunas().map(c => (l[c.key] || 0).toFixed(2)).join(',');
    }).join(';');
}

/* Os pesos regionais SAO derivados da migracao ("migração de 2022 com o
   cálculo dos pesos regionais sobre a mesma"). Se a migracao muda, toda regiao
   que o usuario nao editou a mao volta a ser recalculada — sem isto os valores
   sugeridos ficariam congelados na primeira migracao vista. */
function sincronizarPesosRegionais() {
  const assin = assinaturaMigracao();
  if (SIM._assinaturaMigracao === assin) return;
  SIM._assinaturaMigracao = assin;
  Object.keys(SIM.pesosRegiao).forEach(chave => {
    if (!SIM.regiaoTocada[chave]) delete SIM.pesosRegiao[chave];
  });
}

function pesosDaRegiao(chaveRegiao) {
  sincronizarPesosRegionais();
  if (!SIM.pesosRegiao[chaveRegiao]) {
    const p = pesosRegionaisPadrao(chaveRegiao);
    if (p) SIM.pesosRegiao[chaveRegiao] = p;
  }
  return SIM.pesosRegiao[chaveRegiao];
}

/* Valores sugeridos de uma regiao intermediaria: o resultado JA SIMULADO
   naquele recorte — migracao, macrorregioes, demografias, tudo que veio antes.

   A macrorregiao e o caso oposto e por isso continua em pesosRegionaisPadrao:
   ela e INPUT da base, e ler a simulacao ali seria circular. A RI e refinamento
   POSTERIOR, entao partir de 2022 aqui mostraria numeros que a simulacao ja
   abandonou — e, pior, zerava todo candidato que nao fosse do PT ou do PL.

   Nao ha cache: recalcular a cada render e o que faz a RI acompanhar sozinha
   qualquer mudanca nas camadas anteriores. Mesmo padrao de leitura que
   renderAbaAjustar usa para UF e municipio. */
function pesosSimuladosDaRegiao(regiao) {
  if (!SIM.agregado || !regiao) return null;
  const res = resultadoDoEscopo({ level: 'regiao', ibges: regiao.munis }, SIM.agregado);
  if (!res || !res.aptos) return null;
  const ent = entradasDe(res);
  const validos = {};
  simColunasValidas().forEach(c => {
    const e = ent.find(x => x.key === c.key);
    validos[c.key] = e ? e.pctValidos : 0;
  });
  return {
    validos,
    abstencao: (ent.find(x => x.key === 'abstencao') || {}).pctAptos || 0,
    nuloBranco: (ent.find(x => x.key === 'nuloBranco') || {}).pctAptos || 0,
    aptos: res.aptos
  };
}

/* Pesos que o painel exibe. Editado pelo usuario sempre vence; senao, a
   macrorregiao parte de 2022 e a regiao intermediaria parte da simulacao. */
function pesosParaPainel(nivel, regiao) {
  const chave = `${nivel}:${regiao.codigo}`;
  if (nivel !== 'ri') return pesosDaRegiao(chave);
  if (SIM.regiaoTocada[chave] && SIM.pesosRegiao[chave]) return SIM.pesosRegiao[chave];
  return pesosSimuladosDaRegiao(regiao);
}

/* Materializa o derivado em SIM.pesosRegiao na primeira edicao — a partir dai a
   regiao para de acompanhar a simulacao e passa a ser meta do usuario. */
function pesosParaEdicao(nivel, regiao) {
  const chave = `${nivel}:${regiao.codigo}`;
  if (nivel !== 'ri') return pesosDaRegiao(chave);
  if (!SIM.pesosRegiao[chave]) {
    const p = pesosSimuladosDaRegiao(regiao);
    if (!p) return null;
    SIM.pesosRegiao[chave] = { validos: p.validos, abstencao: p.abstencao, nuloBranco: p.nuloBranco };
  }
  return SIM.pesosRegiao[chave];
}

function renderPaneRegioes() {
  return renderRegioes('simPaneRegioes', 'mr');
}
function renderPaneRgint() {
  return renderRegioes('simPaneRgint', 'ri');
}

/* Painel de metas territoriais, usado nos dois niveis.

   'mr' (macrorregiao) e etapa OBRIGATORIA: e sobre ela que a projecao base e
   construida, junto com a migracao — e por isso parte dos numeros de 2022.
   'ri' (regiao intermediaria) e refinamento posterior, so abre depois da base
   pronta e parte da simulacao corrente.

   Os candidatos somam 100% ENTRE SI (divisao dos votos validos). Abstencao e
   nulos ficam fora dessa soma, cada um como percentual do eleitorado apto —
   e o que define quanto do eleitorado chega a ser distribuido. */
function renderRegioes(idPane, nivel) {
  const el = document.getElementById(idPane);
  const todas = listaRegioes(nivel);
  const validas = simColunasValidas();

  if (!todas.length || (nivel === 'mr' && !SIM.regioes2022)) {
    el.innerHTML = `<header class="sim-pane-head"><h4>Regiões</h4></header>
      <div class="sim-note">Agregados regionais de 2022 indisponíveis
        (<code>baselines/regioes.json</code>). Rode <code>scripts/gerar_base_2026.py</code>.</div>`;
    return;
  }
  if (nivel === 'ri' && !SIM.agregado) {
    el.innerHTML = `<header class="sim-pane-head"><h4>Regiões intermediárias</h4></header>
      <div class="sim-note">Gere a projeção base antes: os valores desta etapa saem
        da simulação já calculada, não de 2022.</div>`;
    return;
  }

  const ufFiltro = nivel === 'ri' ? (SIM._ufRegiao || SIM.selectedUF || 'SP') : null;
  const regs = nivel === 'ri' ? todas.filter(r => r.uf === ufFiltro) : todas;

  const cabecalho = nivel === 'mr' ? `
    <header class="sim-pane-head">
      <h4>Pesos por macrorregião <span class="sim-req">obrigatório</span></h4>
      <p>Os valores já vêm carregados com o resultado <strong>real do 1º turno
         de 2022</strong> em cada região, passado pela migração que você
         definiu na etapa anterior. Ajuste o que quiser: é sobre esta base que a
         inferência ecológica distribui o resto.</p>
    </header>` : `
    <header class="sim-pane-head">
      <h4>Regiões intermediárias</h4>
      <p>Refinamento opcional sobre a projeção já criada. Os valores mostrados são
         os da <strong>simulação atual</strong> em cada região — migração,
         macrorregiões e demografias já aplicadas — e acompanham sozinhos qualquer
         mudança nessas etapas, até você editá-los. Uma meta aqui tem prioridade
         sobre a macrorregião que contém a região.</p>
    </header>
    <div class="sim-final-pick">
      <label>Estado
        <select id="simUfRegiao">
          ${Array.from(UF_MAP.entries()).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
      .map(([s, n]) => `<option value="${s}" ${s === ufFiltro ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}
        </select>
      </label>
      <button class="sim-btn sim-btn-ghost" id="btnZerarRgint">Limpar as desta UF</button>
    </div>`;

  el.innerHTML = cabecalho + regs.map(r => {
    const chave = `${nivel}:${r.codigo}`;
    const p = pesosParaPainel(nivel, r);
    if (!p) return '';
    const total = validas.reduce((s, c) => s + (p.validos[c.key] || 0), 0);
    const tocado = !!SIM.regiaoTocada[chave];
    const ref = SIM.regioes2022 && SIM.regioes2022.regioes[chave];
    const aptos = p.aptos != null ? p.aptos : (ref ? ref.aptos : null);
    const origem = tocado ? ' · ajustado'
      : (nivel === 'ri' ? ' · valores da simulação' : ' · valores de 2022');
    return `
      <div class="sim-block ${tocado ? 'ativo' : ''}" data-reg="${chave}">
        <div class="sim-block-head">
          <div>
            <strong>${escapeHtml(r.nome)}</strong>
            <small>${fmtInt(r.munis.length)} municípios · ${aptos != null ? fmtInt(aptos) : '–'} eleitores
              ${origem}</small>
          </div>
          <span class="sim-total ${total > 0 && total <= 100.5 ? 'ok' : 'bad'}">${fmtPct(total)}</span>
        </div>
        <div class="sim-block-body">
          ${validas.map(c => `
            <div class="sim-slider-row">
              <i class="sim-chip" style="background:${c.cor}"></i>
              <span class="sim-slider-label" title="${escapeHtml(c.label)}">${escapeHtml(c.label)}</span>
              <input type="range" class="sim-slider" min="0" max="100" step="0.1"
                     value="${p.validos[c.key] || 0}" data-reg="${chave}" data-col="${c.key}">
              <input type="number" class="sim-slider-val" min="0" max="100" step="0.1"
                     value="${(p.validos[c.key] || 0).toFixed(1)}" data-reg="${chave}" data-col="${c.key}">
              <span class="sim-unit">%</span>
            </div>`).join('')}
          <div class="sim-sep">do eleitorado apto — independente da divisão acima</div>
          ${[['abstencao', 'Abstenção', COR_ABST], ['nuloBranco', 'Nulos e brancos', COR_NULO]].map(([k, rot, cor]) => `
            <div class="sim-slider-row">
              <i class="sim-chip" style="background:${cor}"></i>
              <span class="sim-slider-label">${rot}</span>
              <input type="range" class="sim-slider" min="0" max="70" step="0.1"
                     value="${p[k] || 0}" data-reg="${chave}" data-tn="${k}">
              <input type="number" class="sim-slider-val" min="0" max="70" step="0.1"
                     value="${(p[k] || 0).toFixed(1)}" data-reg="${chave}" data-tn="${k}">
              <span class="sim-unit">%</span>
            </div>`).join('')}
          <div class="sim-bucket-foot">
            <small>Comparecimento projetado: ${fmtPct(100 - (p.abstencao || 0))}</small>
            <button class="sim-btn sim-btn-mini sim-btn-ghost" data-reset-reg="${chave}">${nivel === 'ri' ? 'Voltar ao simulado' : 'Voltar a 2022'}</button>
          </div>
        </div>
      </div>`;
  }).join('');

  const porChave = new Map(regs.map(r => [`${nivel}:${r.codigo}`, r]));

  // Trava de 100% (travar100): o slider de um candidato nunca passa do que sobra
  // dos outros.
  const setarValido = (chave, col, v) => {
    const p = pesosParaEdicao(nivel, porChave.get(chave));
    if (!p) return;
    v = travar100(v, validas.filter(c => c.key !== col)
      .reduce((s, c) => s + (p.validos[c.key] || 0), 0));
    p.validos[col] = v;
    SIM.regiaoTocada[chave] = true;
    SIM.baseGerada = false;
    const box = el.querySelector(`.sim-block[data-reg="${chave}"]`);
    const r = box.querySelector(`.sim-slider[data-col="${col}"]`);
    const n = box.querySelector(`.sim-slider-val[data-col="${col}"]`);
    if (r) r.value = v;
    if (n) n.value = v.toFixed(1);
    const total = validas.reduce((s, c) => s + (p.validos[c.key] || 0), 0);
    const badge = box.querySelector('.sim-total');
    badge.textContent = fmtPct(total);
    badge.classList.toggle('ok', Math.abs(total - 100) < 0.5);
    badge.classList.toggle('bad', Math.abs(total - 100) >= 0.5);
    box.classList.add('ativo');
  };
  const setarTurnout = (chave, campo, v) => {
    const p = pesosParaEdicao(nivel, porChave.get(chave));
    if (!p) return;
    const outro = campo === 'abstencao' ? (p.nuloBranco || 0) : (p.abstencao || 0);
    p[campo] = clamp(v, 0, Math.max(0, 95 - outro));
    SIM.regiaoTocada[chave] = true;
    SIM.baseGerada = false;
    const box = el.querySelector(`.sim-block[data-reg="${chave}"]`);
    const r = box.querySelector(`.sim-slider[data-tn="${campo}"]`);
    const n = box.querySelector(`.sim-slider-val[data-tn="${campo}"]`);
    if (r) r.value = p[campo];
    if (n) n.value = p[campo].toFixed(1);
    const pe = box.querySelector('.sim-bucket-foot small');
    if (pe) pe.textContent = `Comparecimento projetado: ${fmtPct(100 - (p.abstencao || 0))}`;
    box.classList.add('ativo');
  };

  el.querySelectorAll('.sim-slider[data-col], .sim-slider-val[data-col]').forEach(s =>
    s.addEventListener(s.type === 'range' ? 'input' : 'change', e =>
      setarValido(e.target.dataset.reg, e.target.dataset.col, parseFloat(e.target.value) || 0)));
  el.querySelectorAll('.sim-slider[data-tn], .sim-slider-val[data-tn]').forEach(s =>
    s.addEventListener(s.type === 'range' ? 'input' : 'change', e =>
      setarTurnout(e.target.dataset.reg, e.target.dataset.tn, parseFloat(e.target.value) || 0)));

  el.querySelectorAll('[data-reset-reg]').forEach(b => b.addEventListener('click', e => {
    const chave = e.target.dataset.resetReg;
    delete SIM.pesosRegiao[chave];
    delete SIM.regiaoTocada[chave];
    SIM.baseGerada = false;
    renderRegioes(idPane, nivel);
  }));
  const selUf = document.getElementById('simUfRegiao');
  if (selUf) selUf.addEventListener('change', e => {
    SIM._ufRegiao = e.target.value;
    renderRegioes(idPane, nivel);
  });
  const zerar = document.getElementById('btnZerarRgint');
  if (zerar) zerar.addEventListener('click', () => {
    regs.forEach(r => {
      delete SIM.pesosRegiao[`ri:${r.codigo}`];
      delete SIM.regiaoTocada[`ri:${r.codigo}`];
    });
    simCalcular();
    renderRegioes(idPane, nivel);
  });
}

/* Converte os pesos regionais nas ops que o worker entende. So entram as
   regioes efetivamente configuradas neste nivel. */
function opsRegionais(nivel) {
  sincronizarPesosRegionais();
  const fora = [];
  listaRegioes(nivel).forEach(r => {
    const chave = `${nivel}:${r.codigo}`;
    const p = nivel === 'mr' ? pesosDaRegiao(chave) : SIM.pesosRegiao[chave];
    if (!p) return;
    if (nivel === 'ri' && !SIM.regiaoTocada[chave]) return;  // RGINT so se editada
    const validos = new Array(simColunas().length).fill(null);
    const soma = simColunasValidas().reduce((s, c) => s + (p.validos[c.key] || 0), 0);
    if (soma > 0) {
      simColunasValidas().forEach(c => {
        validos[idxColuna(c.key)] = (p.validos[c.key] || 0) / soma;
      });
    }
    fora.push({
      scope: { level: 'regiao', nivel, regiao: r.codigo, nome: r.nome, ibges: r.munis },
      validos,
      abstencao: p.abstencao != null ? p.abstencao / 100 : null,
      nuloBranco: p.nuloBranco != null ? p.nuloBranco / 100 : null
    });
  });
  return fora;
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

  // Os quatro destinos de qualquer linha, global ou por grupo. Aqui nulos e
  // abstencao NAO sao separados do resto: a linha inteira e uma unica soma de
  // 100%, porque o que se reparte e o eleitorado de um eliminado, nao a divisao
  // dos validos de um recorte.
  const destinos2T = [finalistas[0], finalistas[1], 'nuloBranco', 'abstencao'];
  const somaLinha = (linha) => destinos2T.reduce((s, d) => s + ((linha || {})[d] || 0), 0);

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
      const total = somaLinha(linha);
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
          ${destinos2T.map(d => `
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
              <span class="sim-total ${Math.abs(somaLinha(lg) - 100) < 0.5 ? 'ok' : 'bad'}"
                    data-total-grupo="${c.key}|${bi}"
                    title="Soma da linha, incluindo nulos e abstenção herdados da linha global">${fmtPct(somaLinha(lg))}</span>
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

  const repintaBadge = (badge, total) => {
    if (!badge) return;
    badge.textContent = fmtPct(total);
    badge.classList.toggle('ok', Math.abs(total - 100) < 0.5);
    badge.classList.toggle('bad', Math.abs(total - 100) >= 0.5);
  };

  /* Trava de 100% por linha (travar100), como nos demais editores: um destino
     nunca passa do que sobra dos outros tres. Sem isto uma linha somando 140%
     era aceita e renormalizada duas vezes — em transformar2T e no norm() do
     worker — pelas costas do usuario. */
  const setar = (origem, dest, v) => {
    SIM.t2.matriz[origem] = SIM.t2.matriz[origem] || {};
    const linha = SIM.t2.matriz[origem];
    v = travar100(v, destinos2T.filter(d => d !== dest)
      .reduce((s, d) => s + (linha[d] || 0), 0));
    linha[dest] = v;
    const box = el.querySelector(`.sim-block[data-t2="${origem}"]`);
    const r = box.querySelector(`.sim-linha-global .sim-slider[data-dest="${dest}"]`);
    const n = box.querySelector(`.sim-linha-global .sim-slider-val[data-dest="${dest}"]`);
    if (r) r.value = v;
    if (n) n.value = v.toFixed(1);
    repintaBadge(box.querySelector('.sim-block-head .sim-total'), somaLinha(linha));
    clearTimeout(SIM._t2Timer);
    SIM._t2Timer = setTimeout(recalcular, 260);
  };

  /* Linhas por grupo demografico: a transferencia de um eliminado pode variar
     conforme a composicao do local (evangelico vs sem religiao, por exemplo).

     So os dois finalistas sao editaveis aqui; nulos e abstencao vem clonados da
     linha global. A trava e a mesma, contando os herdados: teto =
     100 - outro finalista - nulos - abstencao. Por isso o badge da linha mostra
     a soma dos QUATRO destinos — dois deles nao estao na tela, e sem o badge o
     teto seria invisivel. */
  const setarGrupo = (origem, bi, dest, v) => {
    const pg = SIM.t2.porGrupo;
    if (!pg) return;
    pg.linhas[bi] = pg.linhas[bi] || {};
    pg.linhas[bi][origem] = pg.linhas[bi][origem]
      || Object.assign({}, SIM.t2.matriz[origem]);
    const linha = pg.linhas[bi][origem];
    v = travar100(v, destinos2T.filter(d => d !== dest)
      .reduce((s, d) => s + (linha[d] || 0), 0));
    linha[dest] = v;
    const box = el.querySelector(`.sim-grupo-row[data-t2="${origem}"][data-bi="${bi}"]`);
    if (box) {
      const r = box.querySelector(`.sim-slider[data-dest="${dest}"]`);
      const n = box.querySelector(`.sim-slider-val[data-dest="${dest}"]`);
      if (r) r.value = v;
      if (n) n.value = v.toFixed(1);
      box.classList.add('dif');
      repintaBadge(box.querySelector('.sim-total'), somaLinha(linha));
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
  if (!SIM.agregado) {
    vazio.hidden = false;
    box.hidden = true;
    const msg = document.getElementById('simEmptyMsg');
    const btn = document.getElementById('btnEmptyConfig');
    if (msg && SIM.indice) {
      const e = prontoParaBase();
      msg.textContent = e.ok
        ? 'Cenário pronto. Gere a projeção base para ver os resultados.'
        : 'Configure a migração de 2022 e os pesos das macrorregiões para gerar a projeção.';
      if (btn) {
        btn.hidden = false;
        btn.textContent = e.ok ? 'Gerar projeção base' : 'Configurar simulação';
      }
      const btnImp = document.getElementById('btnEmptyImportJSON');
      if (btnImp) btnImp.hidden = false;
    }
    return;
  }
  vazio.hidden = true;
  box.hidden = false;

  // Sidebar esquerda: mostrar controles, ocultar placeholder
  const leftEmpty    = document.getElementById('simLeftEmpty');
  const leftControls = document.getElementById('simLeftControls');
  if (leftEmpty)    leftEmpty.style.display    = 'none';
  if (leftControls) leftControls.hidden = false;

  const res = resultadoDoEscopo(SIM.escopo, agregadoAtivo());
  document.getElementById('simPanelAreaTitle').textContent = rotuloEscopo(SIM.escopo);
  document.getElementById('simPanelAreaSub').textContent =
    res ? `${fmtInt(res.aptos)} eleitores aptos (2026)` : '';

  const badge = document.getElementById('simScopeBadge');
  const op = SIM.ops.get(chaveEscopo(SIM.escopo));
  const nAjustes = op
    ? ((op.validos || op.abstencao != null || op.nuloBranco != null ? 1 : 0)
      + Object.keys(op.demo || {}).length)
    : 0;
  badge.hidden = !nAjustes;
  badge.textContent = nAjustes ? `${nAjustes} ajuste(s)` : '';

  document.getElementById('btnVoltar').hidden = !(SIM.selectedUF || SIM.selectedMuni);
  document.getElementById('simTurnoSwitch').hidden = !SIM.agregado2T;

  document.querySelectorAll('#simPanelResults .sim-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === SIM.abaSidebar);
  });
  ['resultado', 'demografia'].forEach(t => {
    document.getElementById('simTab' + t.charAt(0).toUpperCase() + t.slice(1)).hidden =
      (t !== SIM.abaSidebar);
  });

  if (SIM.abaSidebar === 'resultado') renderAbaResultado(res);
  if (SIM.abaSidebar === 'demografia') renderAbaDemografia();
  // Ajustar agora fica fixo na sidebar esquerda, sempre renderizado
  renderAbaAjustar(res);

  document.querySelectorAll('#simGradientModeSwitch .sim-color-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.value === (SIM.modoColorizacao || 'margin'));
  });
}

function renderAbaResultado(res) {
  const alvo = document.getElementById('simBarsContainer');
  if (!res) { alvo.innerHTML = '<div class="sim-note">Sem dados neste recorte.</div>'; return; }

  const ent = entradasDe(res);
  const comVotos = ent.filter(x => x.key !== 'nuloBranco' && x.key !== 'abstencao' && x.votos > 0);
  const candsNormais = comVotos.filter(x => x.key !== 'outros').sort((a, b) => b.votos - a.votos);
  const itemOutros = comVotos.find(x => x.key === 'outros');
  const validas = itemOutros ? [...candsNormais, itemOutros] : candsNormais;

  if (!validas.length) {
    alvo.innerHTML = '<div class="sim-note">Nenhum candidato com votos neste recorte.</div>';
    document.getElementById('simMetricsContainer').innerHTML = '';
    document.getElementById('simRunoffCallout').innerHTML = '';
    return;
  }

  const eleito = new Set();
  if (candsNormais.length) {
    eleito.add(candsNormais[0].key);
    if (SIM.turno === 1 && candsNormais[0].pctValidos < 50 && candsNormais[1]) {
      eleito.add(candsNormais[1].key);
    }
  }

  const cols = simColunas();

  let tableHtml = `
    <table class="cand-table">
      <thead>
        <tr>
          <th class="color-bar-td"></th>
          <th class="align-left">Candidato</th>
          <th class="align-center">Votos</th>
          <th class="align-center">Pct.</th>
        </tr>
      </thead>
      <tbody>
  `;

  validas.forEach(e => {
    const colInfo = cols.find(c => c.key === e.key);
    const partido = colInfo && colInfo.cand ? colInfo.cand.partido : '';
    const isEleito = eleito.has(e.key);
    const checkCircleHtml = isEleito
      ? `<span class="cand-check-circle" style="background-color: ${e.cor};">✔</span>`
      : '';

    tableHtml += `
      <tr>
        <td class="color-bar-td">
          <span class="cand-color-bar" style="background-color: ${e.cor};"></span>
        </td>
        <td class="align-left">
          <div class="cand-name-container">
            ${checkCircleHtml}
            <span class="cand-name-text">${escapeHtml(e.label)}</span>
          </div>
          ${partido ? `<div style="font-size: 0.65rem; color: var(--muted); margin-top: 2px;">${escapeHtml(partido)}</div>` : ''}
        </td>
        <td class="align-center cand-votes-text">
          ${fmtInt(e.votos)}
        </td>
        <td class="align-center">
          <div class="pct-bar-container">
            <span class="pct-text">${fmtPct(e.pctValidos)}</span>
            <div class="cand-mini-bar-wrap">
              <div class="cand-mini-bar" style="width: ${Math.min(100, Math.max(0, e.pctValidos))}%; background-color: ${e.cor};"></div>
            </div>
          </div>
        </td>
      </tr>
    `;
  });

  tableHtml += `
      </tbody>
    </table>
  `;

  alvo.innerHTML = tableHtml;

  // Mesmas tres metricas do visualizador, com a mesma formatacao.
  const nb = ent.find(x => x.key === 'nuloBranco');
  const ab = ent.find(x => x.key === 'abstencao');
  const validos = validas.reduce((s, e) => s + e.votos, 0);
  const comparecimento = res.aptos - ab.votos;
  const turnout = res.aptos > 0 ? 100 * comparecimento / res.aptos : 0;
  const invalidosPct = comparecimento > 0 ? 100 * nb.votos / comparecimento : 0;

  document.getElementById('simMetricsContainer').innerHTML = `
    <div class="metrics-grid" style="margin-top: 14px;">
      <div class="metric-item"><span>Votos válidos</span><strong>${fmtInt(validos)}</strong></div>
      <div class="metric-item"><span>Comparecimento</span><strong>${fmtInt(comparecimento)} (${fmtPct(turnout)})</strong></div>
      <div class="metric-item"><span>Votos inválidos</span><strong>${fmtInt(nb.votos)} (${fmtPct(invalidosPct)})</strong></div>
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
    el.innerHTML = `<p class="sim-hint">As metas nacionais ficam no editor de cenário,
        nas etapas de migração e macrorregiões.</p>
      <button class="sim-btn sim-btn-apply" id="btnAjNacional">Abrir metas por macrorregião</button>`;
    document.getElementById('btnAjNacional').addEventListener('click', () => abrirModal('regioes'));
    return;
  }
  const validas = simColunasValidas();
  const ent = entradasDe(res);
  const op = SIM.ops.get(chaveEscopo(SIM.escopo));
  const temOp = !!(op && (op.validos || op.abstencao != null || op.nuloBranco != null));

  const validosTot = validas.reduce((s, c) => {
    const e = ent.find(x => x.key === c.key);
    return s + (e ? e.votos : 0);
  }, 0);
  const pctValido = (c) => {
    if (op && op.validos && op.validos[idxColuna(c.key)] != null) return 100 * op.validos[idxColuna(c.key)];
    const e = ent.find(x => x.key === c.key);
    return validosTot > 0 && e ? 100 * e.votos / validosTot : 0;
  };
  const abst = op && op.abstencao != null ? 100 * op.abstencao
    : (ent.find(x => x.key === 'abstencao') || {}).pctAptos || 0;
  const nulo = op && op.nuloBranco != null ? 100 * op.nuloBranco
    : (ent.find(x => x.key === 'nuloBranco') || {}).pctAptos || 0;

  el.innerHTML = `
    <p class="sim-hint">Meta para <strong>${escapeHtml(rotuloEscopo(SIM.escopo))}</strong>.
       Os candidatos dividem 100% dos votos válidos; abstenção e nulos são
       definidos à parte, sobre o eleitorado apto. Dentro do recorte, os locais
       de votação são reescalonados proporcionalmente — as diferenças entre eles
       são preservadas.</p>
    ${validas.map(c => `
      <div class="sim-slider-row">
        <i class="sim-chip" style="background:${c.cor}"></i>
        <span class="sim-slider-label" title="${escapeHtml(c.label)}">${escapeHtml(c.label)}</span>
        <input type="range" class="sim-slider" min="0" max="100" step="0.1"
               value="${pctValido(c)}" data-col="${c.key}">
        <input type="number" class="sim-slider-val" min="0" max="100" step="0.1"
               value="${pctValido(c).toFixed(1)}" data-col="${c.key}">
        <span class="sim-unit">%</span>
      </div>`).join('')}
    <div class="sim-tot-linha"><span>Total dos candidatos</span>
      <span class="sim-total ok" id="simAjTotal">100,0%</span></div>

    <div class="sim-sep">do eleitorado apto</div>
    ${[['abstencao', 'Abstenção', COR_ABST, abst], ['nuloBranco', 'Nulos e brancos', COR_NULO, nulo]]
    .map(([k, rot, cor, val]) => `
      <div class="sim-slider-row">
        <i class="sim-chip" style="background:${cor}"></i>
        <span class="sim-slider-label">${rot}</span>
        <input type="range" class="sim-slider" min="0" max="70" step="0.1" value="${val}" data-tn="${k}">
        <input type="number" class="sim-slider-val" min="0" max="70" step="0.1"
               value="${val.toFixed(1)}" data-tn="${k}">
        <span class="sim-unit">%</span>
      </div>`).join('')}

    <div class="sim-actions-row">
      <button class="sim-btn sim-btn-apply" id="btnAplicarAjuste">Aplicar</button>
      ${temOp ? '<button class="sim-btn sim-btn-ghost" id="btnLimparAjuste">Limpar</button>' : ''}
    </div>`;

  const totalEl = document.getElementById('simAjTotal');
  const somaValidos = () => validas.reduce((s, c) => {
    const n = el.querySelector(`.sim-slider-val[data-col="${c.key}"]`);
    return s + (parseFloat(n.value) || 0);
  }, 0);
  const repinta = () => {
    const t = somaValidos();
    totalEl.textContent = fmtPct(t);
    totalEl.classList.toggle('ok', Math.abs(t - 100) < 0.5);
    totalEl.classList.toggle('bad', Math.abs(t - 100) >= 0.5);
  };
  // Trava de 100% (travar100): para dar mais a um candidato e preciso liberar
  // de outro.
  const setar = (col, v) => {
    v = travar100(v, validas.filter(c => c.key !== col).reduce((s, c) => {
      const n = el.querySelector(`.sim-slider-val[data-col="${c.key}"]`);
      return s + (parseFloat(n.value) || 0);
    }, 0));
    el.querySelector(`.sim-slider[data-col="${col}"]`).value = v;
    el.querySelector(`.sim-slider-val[data-col="${col}"]`).value = v.toFixed(1);
    repinta();
  };
  el.querySelectorAll('.sim-slider[data-col], .sim-slider-val[data-col]').forEach(s =>
    s.addEventListener(s.type === 'range' ? 'input' : 'change', e =>
      setar(e.target.dataset.col, parseFloat(e.target.value) || 0)));
  el.querySelectorAll('.sim-slider[data-tn], .sim-slider-val[data-tn]').forEach(s =>
    s.addEventListener(s.type === 'range' ? 'input' : 'change', e => {
      const k = e.target.dataset.tn;
      const v = clamp(parseFloat(e.target.value) || 0, 0, 70);
      el.querySelector(`.sim-slider[data-tn="${k}"]`).value = v;
      el.querySelector(`.sim-slider-val[data-tn="${k}"]`).value = v.toFixed(1);
    }));
  repinta();

  document.getElementById('btnAplicarAjuste').addEventListener('click', async () => {
    const o = opDoEscopo(SIM.escopo, true);
    const soma = somaValidos();
    const vet = new Array(simColunas().length).fill(null);
    if (soma > 0) {
      validas.forEach(c => {
        const n = el.querySelector(`.sim-slider-val[data-col="${c.key}"]`);
        vet[idxColuna(c.key)] = (parseFloat(n.value) || 0) / 100 / (soma / 100);
      });
    }
    o.validos = vet;
    o.abstencao = (parseFloat(el.querySelector('.sim-slider-val[data-tn="abstencao"]').value) || 0) / 100;
    o.nuloBranco = (parseFloat(el.querySelector('.sim-slider-val[data-tn="nuloBranco"]').value) || 0) / 100;
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
  if (!v || !res || !res.aptos || v.votos === 0) return '#888888';
  const modo = SIM.modoColorizacao || 'margin';
  if (modo === 'winnerPct') {
    return getWinnerPctGradientColor(v.cor, v.pctValidos);
  }
  return getUniversalGradientColor(v.cor, margemDe(res));
}

function tooltipResultado(titulo, res, rodape) {
  const comVotos = entradasDe(res).filter(x => x.key !== 'nuloBranco' && x.key !== 'abstencao' && x.votos > 0);
  const candsNormais = comVotos.filter(x => x.key !== 'outros').sort((a, b) => b.votos - a.votos);
  const itemOutros = comVotos.find(x => x.key === 'outros');
  const ent = itemOutros ? [...candsNormais, itemOutros] : candsNormais;

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

const ALL_UFS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
  'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
];

function simRenderMapa() {
  const modo = SIM.modoMapa || 'estado';
  document.querySelectorAll('#simModeSwitch .sim-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === modo);
  });

  if (modo === 'municipio') {
    if (SIM.selectedUF) return simRenderMapaMunicipios(SIM.selectedUF);
    return simRenderMapaTodosMunicipios();
  }

  if (SIM.selectedUF) return simRenderMapaMunicipios(SIM.selectedUF);
  return simRenderMapaEstados();
}

async function simRenderMapaTodosMunicipios() {
  const ag = agregadoAtivo();
  const loader = document.getElementById('mapLoader');
  if (loader) {
    loader.textContent = 'Carregando todos os municípios do Brasil...';
    loader.classList.add('visible');
  }

  await Promise.all(ALL_UFS.map(async uf => {
    if (!SIM.muniGeoCache[uf]) {
      SIM.muniGeoCache[uf] = await fetchJSON(DATA_BASE_URL + `municipios_hd/municipios_${uf}.geojson`)
        .catch(() => null);
    }
  }));

  if (loader) loader.classList.remove('visible');

  limparCamadas('municipiosLayer');
  if (SIM.municipiosLayer) { simMap.removeLayer(SIM.municipiosLayer); SIM.municipiosLayer = null; }

  const codDe = p => Number(p.CD_MUN || p.cod_ibge || p.codigo_ibge || p.CD_GEOCMU || p.GEOCODIGO);
  const nomeDe = p => p.NM_MUN || p.nome || p.NM_MUNICIP || SIM.nomesMuni[codDe(p)] || '';

  const ehLagoaOperacional = p => {
    const cd = codDe(p);
    return cd === 4300001 || cd === 4300002;
  };

  const todasFeatures = [];
  ALL_UFS.forEach(uf => {
    const geo = SIM.muniGeoCache[uf];
    if (geo && geo.features) {
      geo.features.forEach(f => {
        if (!ehLagoaOperacional(f.properties)) {
          f.properties._UF = uf;
          todasFeatures.push(f);
        }
      });
    }
  });

  SIM.municipiosLayer = new MLCompat.GeoLayer(simMap, {
    id: 'sim-municipios-br', type: 'polygon', tooltipClass: 'district-nyt-tooltip',
    styleFn: f => {
      const cod = codDe(f.properties);
      const res = ag && ag.municipios[String(cod)];
      const sel = SIM.selectedMuni === cod;
      const hasData = res && res.aptos > 0;
      const exibirContorno = SIM.exibirContornoMuni !== false;
      return {
        fillColor: corDoResultado(res),
        fillOpacity: sel ? 0.85 : (hasData ? 0.78 : 0.25),
        color: '#ffffff',
        weight: sel ? 0.8 : (exibirContorno ? 0.12 : 0),
        opacity: sel ? 1.0 : (exibirContorno ? 0.8 : 0)
      };
    },
    tooltipFn: f => {
      const uf = f.properties._UF || f.properties.SIGLA_UF || SIM.ufDeMuni[codDe(f.properties)];
      const nm = nomeDe(f.properties);
      const rot = uf ? `${nm} (${uf})` : nm;
      return tooltipResultado(rot, ag && ag.municipios[String(codDe(f.properties))]);
    },
    onClick: f => {
      const uf = f.properties._UF || f.properties.SIGLA_UF || SIM.ufDeMuni[codDe(f.properties)];
      simSelecionarMuni(uf, codDe(f.properties));
    }
  });

  SIM.municipiosLayer.setFeatures(todasFeatures);
  SIM.municipiosLayer.addTo(simMap);
  simRenderLegenda();
  scheduleSimMapRefresh();
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
      const hasData = res && res.aptos > 0;
      return {
        fillColor: corDoResultado(res),
        fillOpacity: hasData ? 0.78 : 0.25,
        color: '#ffffff',
        weight: 0.12,
        opacity: 0.8
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
    SIM.muniGeoCache[uf] = await fetchJSON(DATA_BASE_URL + `municipios_hd/municipios_${uf}.geojson`)
      .catch(() => null);
  }
  const geo = SIM.muniGeoCache[uf];
  if (!geo) return simRenderMapaEstados();
  limparCamadas('municipiosLayer');
  if (SIM.municipiosLayer) { simMap.removeLayer(SIM.municipiosLayer); SIM.municipiosLayer = null; }

  const codDe = p => Number(p.CD_MUN || p.cod_ibge || p.codigo_ibge || p.CD_GEOCMU || p.GEOCODIGO);
  const nomeDe = p => p.NM_MUN || p.nome || p.NM_MUNICIP || SIM.nomesMuni[codDe(p)] || '';

  const ehLagoaOperacional = p => {
    const cd = codDe(p);
    return cd === 4300001 || cd === 4300002;
  };

  const featuresValidas = (geo.features || []).filter(f => !ehLagoaOperacional(f.properties));

  SIM.municipiosLayer = new MLCompat.GeoLayer(simMap, {
    id: 'sim-municipios', type: 'polygon', tooltipClass: 'district-nyt-tooltip',
    styleFn: f => {
      const cod = codDe(f.properties);
      const res = ag && ag.municipios[String(cod)];
      const sel = SIM.selectedMuni === cod;
      const hasData = res && res.aptos > 0;
      const exibirContorno = SIM.exibirContornoMuni !== false;
      return {
        fillColor: corDoResultado(res),
        fillOpacity: sel ? 0.85 : (hasData ? 0.78 : 0.25),
        color: '#ffffff',
        weight: sel ? 0.8 : (exibirContorno ? 0.12 : 0),
        opacity: sel ? 1.0 : (exibirContorno ? 0.8 : 0)
      };
    },
    tooltipFn: f => tooltipResultado(nomeDe(f.properties),
      ag && ag.municipios[String(codDe(f.properties))]),
    onClick: f => simSelecionarMuni(uf, codDe(f.properties))
  });
  SIM.municipiosLayer.setFeatures(featuresValidas);
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
        weight: f.properties.imp ? 0.8 : 0.12, opacity: 0.9
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
  if (!el) return;
  const res = resultadoDoEscopo({ level: 'nacional' }, agregadoAtivo());
  if (!res) { el.innerHTML = ''; return; }

  const ent = entradasDe(res).filter(x => x.key !== 'nuloBranco' && x.key !== 'abstencao' && x.key !== 'outros' && x.label.toLowerCase() !== 'outros')
    .sort((a, b) => b.votos - a.votos).filter(x => x.pctValidos > 0.5);

  if (SIM.modoColorizacao === 'winnerPct') {
    const passos = [
      { label: '<30%', pct: 25 },
      { label: '30%', pct: 35 },
      { label: '40%', pct: 45 },
      { label: '50%', pct: 55 },
      { label: '60%', pct: 65 },
      { label: '70%', pct: 75 },
      { label: '≥80%', pct: 85 }
    ];

    el.innerHTML = `
      <div class="sim-nyt-legend-grid">
        ${ent.map(e => `
          <div class="sim-nyt-cand-row">
            <div class="sim-nyt-cand-head">
              <span>${escapeHtml(e.label)}</span>
            </div>
            <div class="sim-nyt-ramp-wrap">
              <div class="sim-nyt-blocks">
                ${passos.map(p => `
                  <div class="sim-nyt-block" style="background:${getWinnerPctGradientColor(e.cor, p.pct)};" title="${escapeHtml(e.label)}: ${p.label}"></div>
                `).join('')}
              </div>
              <div class="sim-nyt-ticks">
                <span>&lt;30</span>
                <span>30</span>
                <span>40</span>
                <span>50%</span>
                <span>60</span>
                <span>70</span>
                <span>80%+</span>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    simAjustarZoomOffset();
    return;
  }

  const candsHtml = `<div class="sim-leg-cands-row" style="display:flex; flex-wrap:wrap; gap:4px 12px; align-items:center;">` +
    ent.map(e => `<span class="sim-leg"><i style="background:${e.cor}"></i>${escapeHtml(e.label)}</span>`).join('') +
    `</div>`;
  el.innerHTML = candsHtml;
  simAjustarZoomOffset();
}

/* Mantém o controle de zoom justo acima da legenda de cores. */
function simAjustarZoomOffset() {
  const legend = document.getElementById('simMapLegend');
  const ctrl   = document.querySelector('#map .maplibregl-ctrl-bottom-right');
  if (!legend || !ctrl) return;
  // Usa rAF para medir depois do paint (legend já tem altura real)
  requestAnimationFrame(() => {
    const legendH = legend.offsetHeight;
    const legendBottom = 30; // valor CSS bottom da legenda
    const gap = 8;
    ctrl.style.bottom = (legendBottom + legendH + gap) + 'px';
  });
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
  // simAplicarSupport e nao atribuicao direta: o novo escopo pode ter metas
  // proprias em op.demo, e elas nao podem ser atropeladas pela reestimativa.
  if (r && r.support) simAplicarSupport(r.support);
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

/* Versao do formato do cenario salvo. BUMPAR sempre que mudar o significado
   de algo persistido — origens da migracao, colunas, formato das ops. Um
   cenario gravado com esquema antigo restaurado por cima do novo produz numeros
   silenciosamente errados: foi o que aconteceu quando a migracao passou do 2o
   para o 1o turno e a matriz salva ficou sem a linha "outros", desmontando
   tambem os pesos regionais, que derivam dela. */
// v5: 'tocados' (Set global de buckets) deu lugar a 'demoEdit' (edicoes por
// escopo). Restaurar um v4 aqui marcaria buckets como fixos sem valor nenhum
// para exibir — descartar e o comportamento correto.
const CENARIO_VERSAO = 5;

function cenarioSerializado() {
  return {
    versao: CENARIO_VERSAO,
    origens: origensLista(),          // conferido na restauracao
    candidatos: SIM.candidatos,
    proxId: SIM.proxId,
    transfer: SIM.transfer,
    ops: Array.from(SIM.ops.values()),
    pesosRegiao: SIM.pesosRegiao,
    regiaoTocada: SIM.regiaoTocada,
    baseGerada: SIM.baseGerada,
    demoEdit: SIM.demoEdit,
    // chaveMatriz vai junto: sem ela simCalcular2T ve a assinatura como mudada,
    // regenera a matriz sugerida e descarta porGrupo logo na restauracao.
    t2: {
      finalistas: SIM.t2.finalistas, matriz: SIM.t2.matriz,
      chaveMatriz: SIM.t2.chaveMatriz, porGrupo: SIM.t2.porGrupo
    }
  };
}
function salvarLocal() {
  try { localStorage.setItem('sim2026_cenario', JSON.stringify(cenarioSerializado())); }
  catch (e) { /* cota cheia: o cenario continua na memoria */ }
}
function descartarCenario(motivo) {
  try { localStorage.removeItem('sim2026_cenario'); } catch (e) { /* ok */ }
  console.info('[sim2026] cenário salvo descartado: ' + motivo);
  return false;
}

function restaurarLocal() {
  let bruto = null;
  try { bruto = localStorage.getItem('sim2026_cenario'); } catch (e) { return false; }
  if (!bruto) return false;

  let c;
  try { c = JSON.parse(bruto); } catch (e) { return descartarCenario('JSON inválido'); }
  if (!c || !c.candidatos || !c.candidatos.length) return descartarCenario('sem candidatos');

  // Cenário de uma versão anterior do esquema: descartar em vez de misturar.
  if (c.versao !== CENARIO_VERSAO) {
    return descartarCenario(`versão ${c.versao} != ${CENARIO_VERSAO}`);
  }
  // Mesmo na versão certa, as origens têm de bater com o pacote carregado.
  const origens = origensLista();
  const salvas = c.origens || Object.keys(c.transfer || {});
  if (salvas.length !== origens.length || !origens.every(o => salvas.includes(o))) {
    return descartarCenario(`origens divergentes (${salvas.join(',')})`);
  }

  SIM.candidatos = c.candidatos;
  SIM.proxId = c.proxId || (Math.max(...c.candidatos.map(x => x.id)) + 1);
  SIM.transfer = c.transfer || simTransferPadrao();
  // Toda origem precisa existir na matriz, senão os pesos regionais — que são
  // derivados dela — saem errados sem nenhum aviso.
  if (!origens.every(o => SIM.transfer[o])) SIM.transfer = simTransferPadrao();

  SIM.ops = new Map((c.ops || []).map(o => [chaveEscopo(o.scope), o]));
  SIM.pesosRegiao = c.pesosRegiao || {};
  SIM.regiaoTocada = c.regiaoTocada || {};
  SIM.baseGerada = !!c.baseGerada;
  SIM.demoEdit = c.demoEdit || {};
  if (c.t2) {
    SIM.t2.finalistas = c.t2.finalistas;
    SIM.t2.matriz = c.t2.matriz;
    SIM.t2.chaveMatriz = c.t2.chaveMatriz || null;
    SIM.t2.porGrupo = c.t2.porGrupo || null;
  }
  return true;
}
function carregarCenarioJSON(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const c = JSON.parse(e.target.result);
      importarObjetoCenario(c);
    } catch (err) {
      simAvisar('Erro ao ler arquivo JSON: ' + err.message);
    }
  };
  reader.readAsText(file);
}

function importarObjetoCenario(c) {
  if (!c || !c.candidatos || !Array.isArray(c.candidatos) || !c.candidatos.length) {
    simAvisar('Arquivo JSON inválido: nenhum candidato encontrado.');
    return false;
  }
  const origens = origensLista();
  const salvas = c.origens || Object.keys(c.transfer || {});
  if (salvas.length !== origens.length || !origens.every(o => salvas.includes(o))) {
    simAvisar('Arquivo JSON incompatível: origens de migração divergentes.');
    return false;
  }

  SIM.candidatos = c.candidatos;
  SIM.proxId = c.proxId || (Math.max(...c.candidatos.map(x => x.id)) + 1);
  SIM.transfer = c.transfer || simTransferPadrao();
  if (!origens.every(o => SIM.transfer[o])) SIM.transfer = simTransferPadrao();

  SIM.ops = new Map((c.ops || []).map(o => [chaveEscopo(o.scope), o]));
  SIM.pesosRegiao = c.pesosRegiao || {};
  SIM.regiaoTocada = c.regiaoTocada || {};
  SIM.baseGerada = true;
  SIM.demoEdit = c.demoEdit || {};
  if (c.t2) {
    SIM.t2.finalistas = c.t2.finalistas;
    SIM.t2.matriz = c.t2.matriz;
    SIM.t2.chaveMatriz = c.t2.chaveMatriz || null;
    SIM.t2.porGrupo = c.t2.porGrupo || null;
  }

  salvarLocal();
  simCalcular().then(() => {
    simRenderTudo();
    fecharModal();
    simAvisar('Cenário JSON importado com sucesso!');
  });
  return true;
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
  simAddCandidato('Renan Santos', 'MISSÃO');
  simAddCandidato('Ronaldo Caiado', 'PSD');
  simAddCandidato('Romeu Zema', 'NOVO');
}

async function initSimulador() {
  // localStorage pode estar bloqueado (modo anônimo, cookies de terceiros).
  let temaSalvo = null;
  try { temaSalvo = localStorage.getItem('sim2026_tema'); } catch (e) { /* segue no padrão */ }
  document.body.dataset.theme = temaSalvo || 'dark';

  simMap = new maplibregl.Map({
    container: 'map',
    style: MLCompat.buildBasemapStyle(document.body.dataset.theme === 'light' ? 'light' : 'dark'),
    center: [-52, -14], zoom: 3.6, minZoom: 3, dragRotate: false, pitchWithRotate: false,
    attributionControl: false
  });
  MLCompat.augmentMap(simMap);
  MLCompat.refreshThemeColors();
  if (simMap.touchZoomRotate) simMap.touchZoomRotate.disableRotation();
  simMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  simMap.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
  setupSimMapRefreshObservers();
  simMap.on('load', () => scheduleSimMapRefresh({ force: true }));

  document.getElementById('themeToggle').addEventListener('click', () => {
    const claro = document.body.dataset.theme === 'light';
    document.body.dataset.theme = claro ? 'dark' : 'light';
    try { localStorage.setItem('sim2026_tema', document.body.dataset.theme); } catch (e) { /* ok */ }
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
  // Sugere o reduto pelo nome (Zema -> MG, Caiado -> GO); continua editavel.
  SIM.candidatos.forEach(c => { if (c.reduto === undefined) c.reduto = redutoSugerido(c) || null; });
  // As macrorregioes ja nascem com o resultado real de 2022 carregado; a etapa
  // continua obrigatoria porque o usuario precisa revisar e confirmar.
  listaRegioes('mr').forEach(r => pesosDaRegiao(`mr:${r.codigo}`));

  // Ligacoes de UI
  const btnAbrir = document.getElementById('btnAbrirConfig');
  if (btnAbrir) btnAbrir.addEventListener('click', () => abrirModal());
  document.getElementById('btnEditSimGlobal')?.addEventListener('click', () => abrirModal());
  document.getElementById('btnEditSimGlobalLeft').addEventListener('click', () => abrirModal());
  document.getElementById('btnEmptyConfigLeft').addEventListener('click', () => {
    const e = prontoParaBase();
    abrirModal(e.ok ? 'regioes' : (e.migOk ? 'regioes' : 'cenario'));
  });
  document.getElementById('btnEmptyConfig').addEventListener('click', () => {
    const e = prontoParaBase();
    abrirModal(e.ok ? 'regioes' : (e.migOk ? 'regioes' : 'cenario'));
  });

  // Sync left sidebar mode switches with the main (right-side) ones
  function syncColorSwitch(fromId, toId) {
    document.querySelectorAll(`#${fromId} .sim-color-btn`).forEach(b => b.addEventListener('click', () => {
      const val = b.dataset.value;
      document.querySelectorAll(`#${toId} .sim-color-btn`).forEach(x =>
        x.classList.toggle('active', x.dataset.value === val));
    }));
  }
  // Left -> Right sync
  document.querySelectorAll('#simGradientModeSwitchLeft .sim-color-btn').forEach(b => b.addEventListener('click', () => {
    SIM.modoColorizacao = b.dataset.value;
    document.querySelectorAll('#simGradientModeSwitchLeft .sim-color-btn').forEach(x =>
      x.classList.toggle('active', x === b));
    simRenderMapa();
    simRenderLegenda();
  }));
  document.querySelectorAll('#simBorderModeSwitchLeft .sim-color-btn').forEach(b => b.addEventListener('click', () => {
    SIM.exibirContornoMuni = b.dataset.value !== 'off';
    document.querySelectorAll('#simBorderModeSwitchLeft .sim-color-btn').forEach(x =>
      x.classList.toggle('active', x === b));
    simRenderMapa();
  }));
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
    if (!prontoParaBase().ok) return;
    const primeira = !SIM.baseGerada;
    SIM.baseGerada = true;
    fecharModal();
    await simCalcular();
    salvarLocal();
    // Depois de gerar a base, as etapas de refinamento passam a valer.
    if (primeira) simRenderModal();
  });
  document.getElementById('btnSalvarCenario').addEventListener('click', baixarCenario);

  const triggerImportJSON = () => {
    const input = document.getElementById('simFileInputJSON');
    if (input) { input.value = ''; input.click(); }
  };
  const btnImpModal = document.getElementById('btnCarregarCenario');
  if (btnImpModal) btnImpModal.addEventListener('click', triggerImportJSON);
  const btnImpEmpty = document.getElementById('btnEmptyImportJSON');
  if (btnImpEmpty) btnImpEmpty.addEventListener('click', triggerImportJSON);

  const fileInput = document.getElementById('simFileInputJSON');
  if (fileInput) fileInput.addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (f) carregarCenarioJSON(f);
  });
  document.getElementById('btnResetSim').addEventListener('click', async () => {
    SIM.candidatos = []; SIM.proxId = 1;
    candidatosPadrao();
    SIM.candidatos.forEach(c => { if (c.reduto === undefined) c.reduto = redutoSugerido(c) || null; });
    SIM.transfer = simTransferPadrao();
    SIM.migracaoTocada = false;
    SIM.pesosRegiao = {};
    SIM.regiaoTocada = {};
    SIM._assinaturaMigracao = null;
    SIM.ops.clear();
    SIM.demoEdit = {};
    SIM.baseGerada = false;
    SIM.agregado = null;
    SIM.agregado2T = null;
    SIM.support = null;
    SIM.shares = null;
    SIM.t2 = { finalistas: null, matriz: null, porGrupo: null, comparecimento: 0, chaveMatriz: null };
    SIM.escopo = { level: 'nacional' };
    SIM.selectedUF = null;
    SIM.selectedMuni = null;
    SIM.paneAtivo = 'candidatos';
    try { localStorage.removeItem('sim2026_cenario'); } catch (e) { /* ok */ }
    simRenderTudo();
    simRenderBreadcrumb();
    abrirModal('candidatos');
  });

  document.querySelectorAll('#simPanelResults .sim-tab').forEach(b =>
    b.addEventListener('click', () => { SIM.abaSidebar = b.dataset.tab; simRenderSidebar(); }));
  document.getElementById('btnVoltar').addEventListener('click', simVoltar);
  document.querySelectorAll('.sim-turno-switch .sim-turno-btn').forEach(b => b.addEventListener('click', () => {
    SIM.turno = +b.dataset.turno;
    document.querySelectorAll('.sim-turno-switch .sim-turno-btn').forEach(x =>
      x.classList.toggle('active', x === b));
    simRenderTudo();
  }));

  document.querySelectorAll('#simModeSwitch .sim-mode-btn').forEach(b => b.addEventListener('click', () => {
    SIM.modoMapa = b.dataset.mode;
    document.querySelectorAll('#simModeSwitch .sim-mode-btn').forEach(x =>
      x.classList.toggle('active', x === b));
    simRenderMapa();
  }));

  document.querySelectorAll('#simGradientModeSwitch .sim-color-btn').forEach(b => b.addEventListener('click', () => {
    SIM.modoColorizacao = b.dataset.value;
    document.querySelectorAll('#simGradientModeSwitch .sim-color-btn').forEach(x =>
      x.classList.toggle('active', x === b));
    simRenderMapa();
    simRenderLegenda();
  }));

  document.querySelectorAll('#simBorderModeSwitch .sim-color-btn').forEach(b => b.addEventListener('click', () => {
    SIM.exibirContornoMuni = b.dataset.value !== 'off';
    document.querySelectorAll('#simBorderModeSwitch .sim-color-btn').forEach(x =>
      x.classList.toggle('active', x === b));
    simRenderMapa();
  }));

  // Nada e simulado antes de o usuario configurar: se ja ha um cenario salvo
  // com a base gerada, ele volta; senao o modal abre no passo 1.
  if (SIM.baseGerada) {
    await simCalcular();
  } else {
    simRenderSidebar();
    simRenderMapa();
    simRenderBreadcrumb();
    abrirModal('candidatos');
  }
  salvarLocal();
}

window.addEventListener('DOMContentLoaded', initSimulador);
