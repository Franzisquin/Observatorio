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
const PACK_GOV_URL = DATA_BASE_URL + 'simgov2026/';

// ---------------------------------------------------------------- constantes

const PARTY_COLORS = new Map(Object.entries({
  'AVANTE': '#36aeba', 'CIDADANIA': '#ec5fa6', 'DC': '#809eff', 'MDB': '#16a250',
  'MISSÃO': '#fdbe21', 'MOBILIZA': '#DD3333', 'NOVO': '#ff6600', 'PCB': '#c40823',
  'PCDOB': '#b4251d', 'PCO': '#8e3d10', 'PDT': '#ffad99', 'PL': '#304091',
  'PMN': '#ff3333', 'PODE': '#23a840', 'PP': '#6391d4', 'PRD': '#007c3c',
  'PRTB': '#1a7e2f', 'PSB': '#edd355', 'PSC': '#2f8e4f', 'PSD': '#eb8100',
  'PSDB': '#0097fd', 'PSOL': '#e95dd2', 'PSTU': '#620411', 'PT': '#ff3859',
  'PV': '#1f9439', 'REDE': '#7dd1d9', 'REPUBLICANOS': '#1f646b',
  'SOLIDARIEDADE': '#ff633d', 'UNIÃO': '#2eccff', 'UP': '#5e5e5e', 'AGIR': '#254d88',
  // So aparecem nos campos estaduais de 2022, quando o modo governador semeia
  // os candidatos a partir do resultado real do estado.
  'PATRIOTA': '#1c6b3c', 'PMB': '#0f9b6c', 'PTB': '#1f4e9c', 'PROS': '#ff8f1f'
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
  'MISSÃO': 0.78, 'PL': 0.88, 'PRTB': 0.92,
  'PROS': 0.20, 'PTB': 0.45, 'PMB': 0.45, 'PATRIOTA': 0.70
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

/* Nome de cada recorte territorial na tela. O codigo usa as siglas curtas
   ('mr', 'ri', 'rgi'), que sao as mesmas de regioes_ibge.json. */
const NOME_NIVEL = {
  mr: 'Macrorregiões',
  ri: 'Regiões intermediárias',
  rgi: 'Regiões imediatas'
};
const NOME_NIVEL_SING = {
  mr: 'macrorregião',
  ri: 'região intermediária',
  rgi: 'região imediata'
};

const COR_OUTROS = '#7a8699';
const COR_NULO = '#9aa0a6';
const COR_ABST = '#4a5058';

// ------------------------------------------------------------------- estado

const SIM = {
  /* Cargo simulado. O presidencial e uma eleicao nacional com candidatos fixos;
     o de governador sao 27 disputas separadas, entao ele roda um estado por vez
     (SIM.ufGov) e a etapa territorial obrigatoria passa a ser a REGIAO
     INTERMEDIARIA, no lugar da macrorregiao. Ver nivelBase()/nivelRefino(). */
  modo: 'presidente',      // 'presidente' | 'governador'
  ufGov: null,             // UF simulada no modo governador
  indiceGov: null,         // simgov2026/index.json
  regioesGov: null,        // simgov2026/regioes_<UF>.json (da UF corrente)

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

// ------------------------------------------------------------------ modo

function ehGov() { return SIM.modo === 'governador'; }

/* Metadados da UF simulada no modo governador (simgov2026/index.json). */
function metaGov() {
  return (ehGov() && SIM.indiceGov && SIM.indiceGov.ufs
    && SIM.indiceGov.ufs[SIM.ufGov]) || null;
}

/* Os dois recortes territoriais do assistente, por modo.

   Presidencial: a macrorregiao e a etapa OBRIGATORIA (e sobre ela que a
   projecao base se apoia) e a regiao intermediaria e o refinamento.

   Governador: como a simulacao ja esta confinada a um estado, a macrorregiao
   nao diz nada — quem faz o papel de recorte base e a REGIAO INTERMEDIARIA, e o
   refinamento desce para a REGIAO IMEDIATA. */
function nivelBase() { return ehGov() ? 'ri' : 'mr'; }
function nivelRefino() { return ehGov() ? 'rgi' : 'ri'; }

/* Escopo do topo da hierarquia: o pais no presidencial, o estado no governador.
   E o que substitui os testes literais por level === 'nacional'. */
function escopoTopo() {
  return ehGov() ? { level: 'uf', uf: SIM.ufGov } : { level: 'nacional' };
}
function noTopo(e) {
  return chaveEscopo(e || SIM.escopo) === chaveEscopo(escopoTopo());
}

/* Origens da migracao de 2022. Fixas no presidencial (dimensao voto2022 do
   pacote global); por estado no governador, porque a lista de candidatos muda
   de uma UF para outra. */
function origensLista() {
  if (ehGov()) {
    const m = metaGov();
    return m ? m.origens.map(o => o.key) : [];
  }
  const d = SIM.indice && SIM.indice.dimensions.find(x => x.key === 'voto2022');
  return d ? d.buckets.map(b => b.key) : Object.keys(ORIGENS_2022);
}

/* Rotulo e posicao ideologica de cada origem, na forma de ORIGENS_2022.
   No governador a posicao sai do PARTIDO do candidato de 2022, pela mesma
   tabela POS_PARTIDO que posiciona os candidatos de 2026. */
function origensInfo() {
  if (!ehGov()) return ORIGENS_2022;
  const m = metaGov();
  const fora = {};
  (m ? m.origens : []).forEach(o => {
    fora[o.key] = ORIGENS_2022[o.key] || {
      pos: getPartyPos(o.partido),
      rotulo: `Votou ${o.rotulo}${o.partido ? ' (' + o.partido + ')' : ''}`
    };
  });
  return fora;
}

/* Peso de cada origem no eleitorado, para a tela de migracao. No governador sai
   do agregado estadual ja gravado em regioes_<UF>.json — nao precisa de ida ao
   worker. */
function pesoOrigem(origem) {
  if (!ehGov()) {
    const sh = SIM.baselineNacional && SIM.baselineNacional.shares;
    const d = SIM.indice && SIM.indice.dimensions.find(x => x.key === 'voto2022');
    if (!sh || !sh.voto2022 || !d) return null;
    const i = d.buckets.findIndex(b => b.key === origem);
    return i >= 0 ? 100 * sh.voto2022[i] : null;
  }
  const reg = SIM.regioesGov && SIM.regioesGov.regioes
    && SIM.regioesGov.regioes['uf:' + SIM.ufGov];
  return reg && reg.pct_aptos ? (reg.pct_aptos[origem] || 0) : null;
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
  return opsRegionais(nivelBase(), 'base')
    .concat(opsRegionais(nivelRefino(), 'refino'))
    .concat(manuais);
}

/* Vinculos de reduto ativos, no formato do worker. */
function vinculosReduto() {
  // No modo governador o candidato ja E uma origem de 2022, com a geografia
  // real da votacao dele — o reduto duplicaria a mesma concentracao.
  if (ehGov()) return [];
  return SIM.candidatos
    .filter(c => c.reduto)
    .map(c => ({ coluna: idxColuna('cand_' + c.id), reduto: c.reduto, forca: 1 }))
    .filter(v => v.coluna >= 0);
}

/* A simulacao so pode rodar depois dos dois inputs obrigatorios. */
function prontoParaBase() {
  const migOk = origensLista().every(o => simTransferTotal(o) >= 0 && simTransferTotal(o) <= 100.5);
  const nb = nivelBase();
  const regs = listaRegioes(nb);
  regs.forEach(r => pesosDaRegiao(`${nb}:${r.codigo}`));  // recalcula se a migracao mudou
  const regOk = regs.length > 0 && regs.every(r => {
    const p = SIM.pesosRegiao[`${nb}:${r.codigo}`];
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

  /* Indice do pacote de governador. Opcional de proposito: sem ele a pagina
     abre normalmente, so sem o modo governador — quem nao rodou
     gerar_base_governador_2022.py nao pode ficar sem o simulador presidencial. */
  SIM.indiceGov = await fetchJSON(PACK_GOV_URL + 'index.json').catch(() => null);

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
  // Os baselines demograficos descrevem o ELEITORADO de 2026, nao o pleito:
  // valem igual nos dois modos.
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
/* Uniao das etapas dos dois modos — serve para esconder TODAS as secoes menos a
   ativa. Quem decide o que aparece na navegacao e panes(), logo abaixo. */
const PANES = ['candidatos', 'cenario', 'regioes', 'rgint', 'rgi', 'demografia', 'turno2'];

/* As seis etapas de cada modo, na ordem em que aparecem na navegacao. A
   diferenca esta so nos dois recortes territoriais: o presidencial vai de
   macrorregiao para regiao intermediaria, o de governador de regiao
   intermediaria para regiao imediata. */
function panes() {
  return ehGov()
    ? ['candidatos', 'cenario', 'rgint', 'rgi', 'demografia', 'turno2']
    : ['candidatos', 'cenario', 'regioes', 'rgint', 'demografia', 'turno2'];
}
/* Etapas que so abrem depois da projecao base existir: tudo que vem DEPOIS do
   recorte obrigatorio. */
function panesPosteriores() {
  return new Set(ehGov()
    ? ['rgi', 'demografia', 'turno2']
    : ['rgint', 'demografia', 'turno2']);
}
/* Qual pane carrega o recorte obrigatorio no modo corrente. */
function paneBase() { return ehGov() ? 'rgint' : 'regioes'; }

/* Rotulos da navegacao, por etapa e por modo. */
function rotuloPane(p) {
  const comum = {
    candidatos: ['Candidatos', 'Quem disputa'],
    cenario: ['Migração 2022', 'Para onde vai cada voto'],
    demografia: ['Demografia', 'Voto por grupo'],
    turno2: ['Segundo turno', 'Transferência de votos']
  };
  if (comum[p]) return comum[p];
  if (p === 'regioes') return ['Macrorregiões', 'Peso de cada região'];
  if (p === 'rgint') {
    return ['Regiões interm.', ehGov() ? 'Peso de cada região' : 'Ajuste fino territorial'];
  }
  return ['Regiões imediatas', 'Ajuste fino territorial'];
}

function simRenderModal() {
  const estado = prontoParaBase();
  simRenderSeletorCargo();

  const doModo = panes();
  const posteriores = panesPosteriores();
  // Etapa ativa que nao existe neste modo (sobra de uma troca de cargo)
  // deixaria o modal em branco.
  if (!doModo.includes(SIM.paneAtivo)) SIM.paneAtivo = 'candidatos';

  /* A divisoria "Refinamentos" acompanha o modo. No presidencial ela cai antes
     da RGINT; no governador a RGINT E a etapa obrigatoria, entao a divisoria
     desce para antes da RG imediata. Sem isto o assistente diria que o recorte
     obrigatorio e um refinamento — que e o oposto do que ele e. */
  const divisoria = document.getElementById('simNavGrupoRefino');
  const primeiroRefino = doModo.find(p => posteriores.has(p));
  if (divisoria && primeiroRefino) {
    const alvo = document.querySelector(`#simModalNav .sim-nav-item[data-pane="${primeiroRefino}"]`);
    if (alvo && alvo.previousElementSibling !== divisoria) {
      alvo.parentNode.insertBefore(divisoria, alvo);
    }
  }
  document.querySelectorAll('#simModalNav .sim-nav-item').forEach(b => {
    const p = b.dataset.pane;
    const usado = doModo.indexOf(p);
    b.hidden = usado < 0;
    if (usado < 0) return;
    const travado = posteriores.has(p) && !SIM.baseGerada;
    b.classList.toggle('active', p === SIM.paneAtivo);
    b.classList.toggle('travado', travado);
    b.disabled = travado;
    b.title = travado ? 'Disponível depois de gerar a projeção base' : '';
    const rot = rotuloPane(p);
    const forte = b.querySelector('strong');
    const legenda = b.querySelector('em');
    if (forte) forte.textContent = rot[0];
    if (legenda) legenda.textContent = rot[1];
    const marca = b.querySelector('.sim-nav-num');
    if (marca) {
      marca.textContent = String(usado + 1);
      const feito = (p === 'cenario' && estado.migOk) || (p === paneBase() && estado.regOk);
      b.classList.toggle('feito', feito);
    }
  });
  PANES.forEach(p => {
    const el = document.getElementById('simPane' + p.charAt(0).toUpperCase() + p.slice(1));
    if (el) el.hidden = (p !== SIM.paneAtivo);
  });

  const hint = document.getElementById('simModalScopeHint');
  if (hint) {
    const n = nLocaisEscopo();
    const cargo = ehGov() ? `Governador — ${UF_MAP.get(SIM.ufGov) || SIM.ufGov} · ` : '';
    const recorte = (NOME_NIVEL[nivelBase()] || '').toLowerCase();
    hint.textContent = SIM.baseGerada
      ? `${cargo}${rotuloEscopo(SIM.escopo)} — ${fmtInt(n)} locais de votação, eleitorado de 2026`
      : `${cargo}${fmtInt(n)} locais de votação · configure a migração e as ${recorte} para gerar a projeção`;
  }

  if (SIM.paneAtivo === 'candidatos') renderPaneCandidatos();
  if (SIM.paneAtivo === 'cenario') renderPaneCenario();
  if (SIM.paneAtivo === 'regioes') renderPaneRegioes();
  if (SIM.paneAtivo === 'rgint') renderPaneRgint();
  if (SIM.paneAtivo === 'rgi') renderPaneRgi();
  if (SIM.paneAtivo === 'demografia') renderPaneDemografia();
  if (SIM.paneAtivo === 'turno2') renderPaneTurno2();

  // O botao principal muda de papel conforme a etapa.
  const btn = document.getElementById('btnAplicarSimModal');
  if (btn) {
    btn.textContent = SIM.baseGerada ? 'Aplicar alterações' : 'Gerar projeção base';
    btn.disabled = !estado.ok;
    btn.title = estado.ok ? ''
      : (!estado.migOk ? 'Cada linha da migração precisa somar 100%'
        : `Configure todas as ${(NOME_NIVEL[nivelBase()] || '').toLowerCase()}`);
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
          <i>${e.regOk ? '✓' : '2'}</i> Pesos por ${NOME_NIVEL_SING[nivelBase()]}</div>
      </div>`;
    return;
  }
  const ent = entradasDe(res).filter(x => x.key.startsWith('cand_') || x.key === 'outros')
    .sort((a, b) => b.votos - a.votos).slice(0, 3);
  el.innerHTML = `<div class="sim-nav-preview">
      <span class="sim-nav-preview-tit">${ehGov() ? 'Prévia estadual' : 'Prévia nacional'}</span>
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
/* Locais de votacao dentro do escopo do modo: o pais no presidencial, o
   estado no governador. */
function nLocaisEscopo() {
  if (ehGov()) { const m = metaGov(); return m ? m.locais : 0; }
  return SIM.indice ? Object.values(SIM.indice.ufs).reduce((a, b) => a + b, 0) : 0;
}

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
  const redutos = ehGov() ? [] : redutosDisponiveis();
  el.innerHTML = `
    <header class="sim-pane-head">
      <h4>Candidatos${ehGov() ? ` ao governo de ${escapeHtml(UF_MAP.get(SIM.ufGov) || SIM.ufGov || '')}` : ''}</h4>
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

    ${ehGov() ? `<div class="sim-note" style="margin-top:14px">
      <strong>Reedição de 2022.</strong> A lista já vem preenchida com quem
      disputou o governo de ${escapeHtml(UF_MAP.get(SIM.ufGov) || SIM.ufGov || '')}
      em 2022 e teve pelo menos ${fmtPct(SIM.indiceGov ? SIM.indiceGov.limiarOrigem : 1.5, 1)}
      dos votos válidos. Troque nomes e partidos à vontade — quem amarra cada
      candidato ao resultado real é a <strong>migração de 2022</strong>, na
      etapa seguinte, já preenchida com cada candidatura indo para si mesma.
    </div>` : ''}

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
    /* Mexer nos candidatos muda o numero de colunas: as metas guardadas viram
       vetores posicionais sem sentido e a projecao precisa ser refeita.

       A migracao e PODADA, nao zerada: ela e indexada por chave de coluna, nao
       por posicao, entao o que sobrevive continua valendo. Zerar destruia a
       matriz inteira so porque o usuario corrigiu um partido — e, no modo
       governador, levaria junto a identidade semeada, deixando todos os pesos
       territoriais em zero. */
    const chaves = new Set(simColunas().map(c => c.key));
    origensLista().forEach(o => {
      const linha = SIM.transfer[o] || {};
      Object.keys(linha).forEach(k => { if (!chaves.has(k)) delete linha[k]; });
      SIM.transfer[o] = linha;
    });
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
    const cfg = origensInfo()[origem] || { rotulo: origem };
    const total = simTransferTotal(origem);
    const ok = total >= 0 && total <= 100.5;
    const linha = SIM.transfer[origem] || {};
    // No presidencial o peso vem do escopo ja carregado no worker; no
    // governador ele esta no agregado estadual de simgov2026.
    const peso = pesoOrigem(origem);
    return `
      <div class="sim-block" data-origem="${origem}">
        <div class="sim-block-head">
          <div>
            <strong>${escapeHtml(cfg.rotulo || origem)}</strong>
            ${peso != null ? `<small>${fmtPct(peso)} do eleitorado</small>` : ''}
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

  /* prontoParaBase() chama isto a cada render do modal, e varrer os 5.571
     municipios de novo a cada tecla e desperdicio — ainda mais no modo
     governador, onde so um estado interessa. O cache cai sozinho ao trocar de
     modo ou de UF, que e quando o recorte muda. */
  const selo = `${SIM.modo}|${SIM.ufGov || ''}|${nivel}`;
  SIM._cacheRegioes = SIM._cacheRegioes || {};
  if (SIM._cacheRegioes[selo]) return SIM._cacheRegioes[selo];

  const nomesRI = {};
  const ufDaRI = {};
  const porUf = (SIM.regioes && SIM.regioes.rgint_by_uf) || {};
  for (const uf in porUf) {
    (porUf[uf] || []).forEach(r => { nomesRI[String(r.cd)] = r.nome; ufDaRI[String(r.cd)] = uf; });
  }
  const infoRGI = (SIM.regioes && SIM.regioes.rgi) || {};

  const codigoDe = (r) => (nivel === 'rgi' ? r.rgi : nivel === 'ri' ? r.ri : r.mr);
  const ufFiltro = ehGov() ? SIM.ufGov : null;

  const grupos = new Map();
  for (const ibge in mm) {
    const r = mm[ibge];
    const cod = codigoDe(r);
    if (cod == null) continue;
    const chave = String(cod);
    // A RG imediata herda a UF da intermediaria que a contem: nem uma nem outra
    // cruza fronteira estadual.
    const paiRI = nivel === 'rgi'
      ? String((infoRGI[chave] && infoRGI[chave].rgint) || r.ri || '')
      : chave;
    const uf = nivel === 'mr' ? '' : (ufDaRI[paiRI] || '');
    if (ufFiltro && uf !== ufFiltro) continue;
    if (!grupos.has(chave)) {
      const macro = SIM.regioes.macro && SIM.regioes.macro[chave];
      grupos.set(chave, {
        codigo: chave,
        nome: nivel === 'rgi'
          ? ((infoRGI[chave] && infoRGI[chave].nome) || 'Região ' + chave)
          : nivel === 'ri'
            ? (nomesRI[chave] || 'Região ' + chave)
            : ((macro && macro.nome) || 'Macrorregião ' + chave),
        uf,
        rgint: nivel === 'rgi' ? paiRI : '',
        munis: []
      });
    }
    grupos.get(chave).munis.push(Number(ibge));
  }
  const fora = Array.from(grupos.values()).sort((a, b) =>
    (a.uf || '').localeCompare(b.uf || '') || a.nome.localeCompare(b.nome, 'pt-BR'));
  SIM._cacheRegioes[selo] = fora;
  return fora;
}

/* Valores sugeridos de uma regiao: a migracao de 2022 aplicada a composicao
   REAL daquela regiao no 1o turno. Com a matriz padrao isso devolve, na
   pratica, o percentual de Lula em Lula e o de Bolsonaro no candidato do PL —
   e ja distribui os demais candidatos de forma coerente.

   Abstencao e nulos vem diretos de 2022, sem passar pela transferencia: sao
   grandezas independentes da divisao entre candidatos. */
function pesosRegionaisPadrao(chaveRegiao) {
  if (ehGov()) return pesosRegionaisPadraoGov(chaveRegiao);
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

/* Mesmo contrato do ramo presidencial, sem nome chumbado.

   Duas grandezas INDEPENDENTES, e essa separacao e o ponto:

     - abstencao e nulo/branco vem DIRETO de pct_aptos de 2022, sem passar pela
       migracao. Sao percentuais do eleitorado apto, nao divisao entre
       candidatos — exatamente como no presidencial. Rotea-los pela matriz era
       um erro: uma linha de migracao ainda vazia empurrava o eleitorado todo
       para a abstencao e a regiao aparecia com 94% de abstencao.

     - a divisao entre candidatos e o pct_validos REAL da regiao em 2022,
       roteado pela matriz de migracao. E ela que diz qual candidato de 2026
       recebe a votacao de cada candidatura de 2022 — o papel que no
       presidencial cabe ao atalho "PT herda Lula, PL herda Bolsonaro". Por isso
       nao existe um campo "herda de" no candidato.

   Como a migracao ja nasce semeada com a identidade (ver candidatosPadraoGov),
   a etapa abre com o resultado real do estado, igual a macrorregiao no
   presidencial. Os alvos NAO sao renormalizados para 100: com a identidade eles
   somam 100 sozinhos, e se o usuario zerar uma linha o total cai — o que e a
   leitura honesta de "essa votacao de 2022 nao foi para ninguem", igual ao
   presidencial, onde a fatia de "outros" fica sem dono. */
function pesosRegionaisPadraoGov(chaveRegiao) {
  const reg = SIM.regioesGov && SIM.regioesGov.regioes && SIM.regioesGov.regioes[chaveRegiao];
  if (!reg) return null;
  const validas = simColunasValidas();
  const pv = reg.pct_validos || {};
  const pa = reg.pct_aptos || {};

  const alvos = {};
  validas.forEach(c => { alvos[c.key] = 0; });

  origensLista().forEach(origem => {
    const peso = pv[origem];        // so candidaturas e 'outros' tem pct_validos
    if (!peso) return;
    const linha = SIM.transfer[origem] || {};
    // So as colunas de candidato: o que a linha manda para abstencao ou nulos
    // nao entra nesta divisao, que e entre validos.
    const soma = validas.reduce((a, c) => a + Math.max(0, linha[c.key] || 0), 0);
    if (soma <= 0) return;          // origem sem destino: fica sem dono
    validas.forEach(c => {
      alvos[c.key] += peso * Math.max(0, linha[c.key] || 0) / soma;
    });
  });

  return {
    validos: alvos,
    abstencao: pa.abstencao || 0,
    nuloBranco: pa.nulo_branco || 0
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
function pesosParaPainel(nivel, regiao, papel) {
  const chave = `${nivel}:${regiao.codigo}`;
  if (papel !== 'refino') return pesosDaRegiao(chave);
  if (SIM.regiaoTocada[chave] && SIM.pesosRegiao[chave]) return SIM.pesosRegiao[chave];
  return pesosSimuladosDaRegiao(regiao);
}

/* Materializa o derivado em SIM.pesosRegiao na primeira edicao — a partir dai a
   regiao para de acompanhar a simulacao e passa a ser meta do usuario. */
function pesosParaEdicao(nivel, regiao, papel) {
  const chave = `${nivel}:${regiao.codigo}`;
  if (papel !== 'refino') return pesosDaRegiao(chave);
  if (!SIM.pesosRegiao[chave]) {
    const p = pesosSimuladosDaRegiao(regiao);
    if (!p) return null;
    SIM.pesosRegiao[chave] = { validos: p.validos, abstencao: p.abstencao, nuloBranco: p.nuloBranco };
  }
  return SIM.pesosRegiao[chave];
}

/* Cada modo usa dois dos tres recortes, e o painel e o mesmo nos dois papeis:

     presidente   base = macrorregiao   refinamento = RG intermediaria
     governador   base = RG intermediaria   refinamento = RG imediata

   O painel de RGINT e reaproveitado nos dois modos, mudando so de papel — no
   presidencial ele e refinamento, no governador e a etapa obrigatoria. */
function renderPaneRegioes() {
  return renderRegioes('simPaneRegioes', 'mr', 'base');
}
function renderPaneRgint() {
  return renderRegioes('simPaneRgint', 'ri', ehGov() ? 'base' : 'refino');
}
function renderPaneRgi() {
  return renderRegioes('simPaneRgi', 'rgi', 'refino');
}

/* Painel de metas territoriais, usado nos dois niveis.

   'mr' (macrorregiao) e etapa OBRIGATORIA: e sobre ela que a projecao base e
   construida, junto com a migracao — e por isso parte dos numeros de 2022.
   'ri' (regiao intermediaria) e refinamento posterior, so abre depois da base
   pronta e parte da simulacao corrente.

   Os candidatos somam 100% ENTRE SI (divisao dos votos validos). Abstencao e
   nulos ficam fora dessa soma, cada um como percentual do eleitorado apto —
   e o que define quanto do eleitorado chega a ser distribuido. */
function renderRegioes(idPane, nivel, papel) {
  const el = document.getElementById(idPane);
  if (!el) return;
  const todas = listaRegioes(nivel);
  const validas = simColunasValidas();
  const rotuloNivel = NOME_NIVEL[nivel] || 'Regiões';

  const temReferencia = papel !== 'base'
    || (ehGov() ? !!SIM.regioesGov : !!SIM.regioes2022);
  if (!todas.length || !temReferencia) {
    const arq = ehGov()
      ? `<code>simgov2026/regioes_${SIM.ufGov || 'UF'}.json</code>`
      : '<code>baselines/regioes.json</code>';
    const script = ehGov()
      ? '<code>scripts/gerar_base_governador_2022.py</code>'
      : '<code>scripts/gerar_base_2026.py</code>';
    el.innerHTML = `<header class="sim-pane-head"><h4>${rotuloNivel}</h4></header>
      <div class="sim-note">Agregados regionais de 2022 indisponíveis
        (${arq}). Rode ${script}.</div>`;
    return;
  }
  if (papel === 'refino' && !SIM.agregado) {
    el.innerHTML = `<header class="sim-pane-head"><h4>${rotuloNivel}</h4></header>
      <div class="sim-note">Gere a projeção base antes: os valores desta etapa saem
        da simulação já calculada, não de 2022.</div>`;
    return;
  }

  // O seletor de UF so existe no presidencial: no governador a simulacao ja
  // esta confinada a um estado e todas as regioes da lista sao dele.
  const ufFiltro = (!ehGov() && papel === 'refino')
    ? (SIM._ufRegiao || SIM.selectedUF || 'SP') : null;
  const regs = ufFiltro ? todas.filter(r => r.uf === ufFiltro) : todas;

  // O DF tem uma RGINT e uma RGI só: a meta ali vale para o estado inteiro, e
  // sem a nota o painel parece incompleto.
  const ufDaNota = regs.length === 1 ? (regs[0].uf || SIM.ufGov) : null;
  const nota = ufDaNota
    ? `<p class="sim-note">${escapeHtml(UF_MAP.get(ufDaNota) || ufDaNota)}
         tem uma região só neste recorte, então a meta aqui vale para o estado
         inteiro.</p>` : '';

  const cabecalho = papel === 'base' ? `
    <header class="sim-pane-head">
      <h4>Pesos por ${escapeHtml(rotuloNivel.toLowerCase())}
        <span class="sim-req">obrigatório</span></h4>
      <p>Os valores já vêm carregados com o resultado <strong>real do 1º turno
         de 2022</strong>${ehGov() ? ' para o governo do estado' : ''} em cada
         região, passado pela migração que você definiu na etapa anterior.
         Ajuste o que quiser: é sobre esta base que a inferência ecológica
         distribui o resto.</p>
      ${nota}
    </header>` : `
    <header class="sim-pane-head">
      <h4>${escapeHtml(rotuloNivel)}</h4>
      <p>Refinamento opcional sobre a projeção já criada. Os valores mostrados são
         os da <strong>simulação atual</strong> em cada região — migração,
         ${escapeHtml((NOME_NIVEL[nivelBase()] || '').toLowerCase())} e demografias
         já aplicadas — e acompanham sozinhos qualquer mudança nessas etapas, até
         você editá-los. Uma meta aqui tem prioridade sobre a região maior que
         contém esta.</p>
      ${nota}
    </header>
    <div class="sim-final-pick">
      ${ufFiltro ? `<label>Estado
        <select id="simUfRegiao">
          ${Array.from(UF_MAP.entries()).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
      .map(([s, n]) => `<option value="${s}" ${s === ufFiltro ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}
        </select>
      </label>` : ''}
      <button class="sim-btn sim-btn-ghost" id="btnZerarRgint">${ufFiltro ? 'Limpar as desta UF' : 'Limpar todas'}</button>
    </div>`;

  el.innerHTML = cabecalho + regs.map(r => {
    const chave = `${nivel}:${r.codigo}`;
    const p = pesosParaPainel(nivel, r, papel);
    if (!p) return '';
    const total = validas.reduce((s, c) => s + (p.validos[c.key] || 0), 0);
    const tocado = !!SIM.regiaoTocada[chave];
    const fonteRef = ehGov() ? SIM.regioesGov : SIM.regioes2022;
    const ref = fonteRef && fonteRef.regioes && fonteRef.regioes[chave];
    const aptos = p.aptos != null ? p.aptos : (ref ? ref.aptos : null);
    const origem = tocado ? ' · ajustado'
      : (papel === 'refino' ? ' · valores da simulação' : ' · valores de 2022');
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
            <button class="sim-btn sim-btn-mini sim-btn-ghost" data-reset-reg="${chave}">${papel === 'refino' ? 'Voltar ao simulado' : 'Voltar a 2022'}</button>
          </div>
        </div>
      </div>`;
  }).join('');

  const porChave = new Map(regs.map(r => [`${nivel}:${r.codigo}`, r]));

  // Trava de 100% (travar100): o slider de um candidato nunca passa do que sobra
  // dos outros.
  const setarValido = (chave, col, v) => {
    const p = pesosParaEdicao(nivel, porChave.get(chave), papel);
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
    const p = pesosParaEdicao(nivel, porChave.get(chave), papel);
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
    renderRegioes(idPane, nivel, papel);
  }));
  const selUf = document.getElementById('simUfRegiao');
  if (selUf) selUf.addEventListener('change', e => {
    SIM._ufRegiao = e.target.value;
    renderRegioes(idPane, nivel, papel);
  });
  const zerar = document.getElementById('btnZerarRgint');
  if (zerar) zerar.addEventListener('click', () => {
    regs.forEach(r => {
      delete SIM.pesosRegiao[`${nivel}:${r.codigo}`];
      delete SIM.regiaoTocada[`${nivel}:${r.codigo}`];
    });
    simCalcular();
    renderRegioes(idPane, nivel, papel);
  });
}

/* Converte os pesos regionais nas ops que o worker entende. So entram as
   regioes efetivamente configuradas neste nivel. */
function opsRegionais(nivel, papel) {
  sincronizarPesosRegionais();
  const fora = [];
  listaRegioes(nivel).forEach(r => {
    const chave = `${nivel}:${r.codigo}`;
    const p = papel === 'base' ? pesosDaRegiao(chave) : SIM.pesosRegiao[chave];
    if (!p) return;
    // O refinamento so vira meta depois de editado a mao; enquanto nao for, ele
    // apenas ACOMPANHA a simulacao e nao deve virar op nenhuma.
    if (papel === 'refino' && !SIM.regiaoTocada[chave]) return;
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
        : `Configure a migração de 2022 e os pesos das ${(NOME_NIVEL[nivelBase()] || '').toLowerCase()} para gerar a projeção.`;
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
          <div class="cand-mini-bar-wrap">
            <div class="cand-mini-bar" style="width: ${Math.min(100, Math.max(0, e.pctValidos))}%; background-color: ${e.cor};"></div>
          </div>
          ${partido ? `<div class="cand-partido-text">${escapeHtml(partido)}</div>` : ''}
        </td>
        <td class="align-center cand-votes-text">
          ${fmtInt(e.votos)}
        </td>
        <td class="align-center pct-text">
          ${fmtPct(e.pctValidos)}
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
  if (SIM.turno === 1 && noTopo()) {
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
  if (noTopo()) {
    const recorte = (NOME_NIVEL[nivelBase()] || '').toLowerCase();
    const alvo = ehGov() ? 'estaduais' : 'nacionais';
    el.innerHTML = `<p class="sim-hint">As metas ${alvo} ficam no editor de cenário,
        nas etapas de migração e ${escapeHtml(recorte)}.</p>
      <button class="sim-btn sim-btn-apply" id="btnAjNacional">Abrir metas por ${escapeHtml(NOME_NIVEL_SING[nivelBase()])}</button>`;
    document.getElementById('btnAjNacional').addEventListener('click', () => abrirModal(paneBase()));
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
  const modo = SIM.modoMapa || (ehGov() ? 'ri' : 'estado');
  document.querySelectorAll('#simModeSwitch .sim-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === modo);
  });

  /* No modo governador nao ha mapa nacional: os recortes disponiveis sao os
     mesmos do assistente (RG intermediaria e imediata) mais o municipal. */
  if (ehGov()) {
    if (!SIM.ufGov) return;
    if (SIM.selectedMuni) return simRenderMapaLocais(SIM.ufGov, SIM.selectedMuni);
    if (modo === 'ri' || modo === 'rgi') return simRenderMapaRegioes(SIM.ufGov, modo);
    return simRenderMapaMunicipios(SIM.ufGov);
  }

  if (modo === 'municipio') {
    if (SIM.selectedUF) return simRenderMapaMunicipios(SIM.selectedUF);
    return simRenderMapaTodosMunicipios();
  }

  if (SIM.selectedUF) return simRenderMapaMunicipios(SIM.selectedUF);
  return simRenderMapaEstados();
}

/* Botoes de recorte do mapa, reescritos conforme o cargo. No presidencial sao
   Estado/Municipio; no governador, os dois recortes do assistente mais o
   municipal — que e onde o usuario desce para ajustar caso a caso. */
function simRenderModoMapa() {
  const box = document.getElementById('simModeSwitch');
  if (!box) return;
  const opcoes = ehGov()
    ? [['ri', 'RG interm.'], ['rgi', 'RG imediatas'], ['municipio', 'Municípios']]
    : [['estado', 'Estado'], ['municipio', 'Município']];
  if (!opcoes.some(([v]) => v === SIM.modoMapa)) SIM.modoMapa = opcoes[0][0];
  box.innerHTML = opcoes.map(([v, rot]) =>
    `<button class="sim-mode-btn ${v === SIM.modoMapa ? 'active' : ''}" data-mode="${v}"
      >${rot}</button>`).join('');
  box.querySelectorAll('.sim-mode-btn').forEach(b => b.addEventListener('click', () => {
    SIM.modoMapa = b.dataset.mode;
    // Trocar de recorte volta ao topo: um municipio selecionado nao faz sentido
    // com o mapa mostrando regioes.
    if (SIM.modoMapa !== 'municipio') SIM.selectedMuni = null;
    simRenderMapa();
    simRenderBreadcrumb();
  }));
}

/* Coropletico por recorte regional (RG intermediaria ou imediata) de uma UF.

   Clone estrutural de simRenderMapaMunicipios: as malhas de regioes_rgint/ e
   regioes_rgi/ ja trazem CD_REG/NM_REG, e o resultado de cada regiao sai do
   mesmo resultadoDoEscopo que o painel de metas usa — assim o mapa e os
   sliders nunca podem divergir. */
async function simRenderMapaRegioes(uf, nivel) {
  const ag = agregadoAtivo();
  const pasta = nivel === 'rgi' ? 'regioes_rgi' : 'regioes_rgint';
  const selo = `${nivel}:${uf}`;
  SIM.regiaoGeoCache = SIM.regiaoGeoCache || {};
  if (!SIM.regiaoGeoCache[selo]) {
    SIM.regiaoGeoCache[selo] = await fetchJSON(
      DATA_BASE_URL + `${pasta}/${pasta}_${uf}.geojson`).catch(() => null);
  }
  const geo = SIM.regiaoGeoCache[selo];
  if (!geo) return simRenderMapaMunicipios(uf);

  // codigo da regiao -> municipios dela, para agregar o resultado.
  const porCodigo = new Map(listaRegioes(nivel).map(r => [String(r.codigo), r]));
  const resDe = (cd) => {
    const reg = porCodigo.get(String(cd));
    if (!reg || !ag) return null;
    return resultadoDoEscopo({ level: 'regiao', uf, ibges: reg.munis }, ag);
  };

  limparCamadas('regioesLayer');
  if (SIM.regioesLayer) { simMap.removeLayer(SIM.regioesLayer); SIM.regioesLayer = null; }

  SIM.regioesLayer = new MLCompat.GeoLayer(simMap, {
    id: 'sim-regioes', type: 'polygon', tooltipClass: 'district-nyt-tooltip',
    styleFn: f => {
      const cd = String(f.properties.CD_REG);
      const res = resDe(cd);
      const sel = String(SIM.regiaoSel || '') === cd;
      return {
        fillColor: corDoResultado(res),
        fillOpacity: sel ? 0.88 : (res && res.aptos > 0 ? 0.78 : 0.25),
        color: '#ffffff',
        weight: sel ? 1.2 : 0.4,
        opacity: sel ? 1.0 : 0.85
      };
    },
    tooltipFn: f => tooltipResultado(f.properties.NM_REG || 'Região',
      resDe(String(f.properties.CD_REG))),
    onClick: f => simSelecionarRegiao(nivel, String(f.properties.CD_REG))
  });
  SIM.regioesLayer.setFeatures(geo.features || []);
  SIM.regioesLayer.addTo(simMap);
  const b = SIM.regioesLayer.getBounds();
  if (b.isValid()) MLCompat.fitMapToBounds(simMap, b, { animate: false });
  simRenderLegenda();
  scheduleSimMapRefresh();
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
  ['estadosLayer', 'municipiosLayer', 'locaisLayer', 'regioesLayer'].forEach(k => {
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
  const res = resultadoDoEscopo(escopoTopo(), agregadoAtivo());
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
  // O topo e o pais no presidencial e o estado no governador.
  const partes = ehGov()
    ? [`<button data-nivel="topo">${escapeHtml(UF_MAP.get(SIM.ufGov) || SIM.ufGov || '')}</button>`]
    : [`<button data-nivel="topo">Brasil</button>`];
  if (!ehGov() && SIM.selectedUF) {
    partes.push(`<button data-nivel="uf">${escapeHtml(UF_MAP.get(SIM.selectedUF) || SIM.selectedUF)}</button>`);
  }
  if (ehGov() && SIM.regiaoSel && !SIM.selectedMuni) {
    const reg = listaRegioes(SIM.nivelSel || 'ri').find(r => String(r.codigo) === String(SIM.regiaoSel));
    if (reg) partes.push(`<span>${escapeHtml(reg.nome)}</span>`);
  }
  if (SIM.selectedMuni) partes.push(`<span>${escapeHtml(SIM.nomesMuni[SIM.selectedMuni] || 'Município')}</span>`);
  el.innerHTML = partes.join('<em>›</em>');
  el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.nivel === 'topo') simSelecionarTopo();
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
/* Volta ao topo da hierarquia do modo: o pais, ou o estado no governador. */
function simSelecionarTopo() {
  if (!ehGov()) return simSelecionarBrasil();
  SIM.selectedMuni = null; SIM.regiaoSel = null; SIM.nivelSel = null;
  trocarEscopo(escopoTopo());
}
/* Uma regiao (RGINT ou RGI) vira escopo do painel lateral, como o municipio. */
function simSelecionarRegiao(nivel, codigo) {
  const reg = listaRegioes(nivel).find(r => String(r.codigo) === String(codigo));
  if (!reg) return;
  SIM.regiaoSel = String(codigo);
  SIM.nivelSel = nivel;
  SIM.selectedMuni = null;
  if (SIM.abaSidebar === 'demografia') SIM.abaSidebar = 'resultado';
  trocarEscopo({
    level: 'regiao', nivel, regiao: reg.codigo, nome: reg.nome,
    uf: reg.uf || SIM.ufGov, ibges: reg.munis
  });
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
  if (ehGov()) {
    if (SIM.selectedMuni && SIM.regiaoSel) return simSelecionarRegiao(SIM.nivelSel, SIM.regiaoSel);
    return simSelecionarTopo();
  }
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
// v6: o cenario passou a valer para um cargo (e, no governador, para uma UF).
// Um v5 restaurado no modo governador traria candidatos presidenciais e uma
// matriz de migracao com origens de outro pleito.
// v7: no governador a migracao passou a nascer semeada com a identidade (cada
// candidatura de 2022 indo para si mesma), e os pesos territoriais derivam
// dela. Um v6 restaura a matriz vazia que se usava antes e abre a etapa
// obrigatoria inteira em zero.
const CENARIO_VERSAO = 7;

/* Cada cargo — e cada estado, no governador — guarda o seu proprio cenario.
   Sem isto, abrir SP por cima do RJ restauraria candidatos e migracao do RJ com
   as origens erradas. A chave do presidencial e a antiga, para nao invalidar os
   cenarios ja salvos por quem usa a pagina. */
function chaveArmazenamento() {
  return ehGov() ? `simgov2026_cenario_${SIM.ufGov}` : 'sim2026_cenario';
}

function cenarioSerializado() {
  return {
    versao: CENARIO_VERSAO,
    modo: SIM.modo,
    uf: SIM.ufGov,
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
  if (ehGov() && !SIM.ufGov) return;
  try { localStorage.setItem(chaveArmazenamento(), JSON.stringify(cenarioSerializado())); }
  catch (e) { /* cota cheia: o cenario continua na memoria */ }
}
function descartarCenario(motivo) {
  try { localStorage.removeItem(chaveArmazenamento()); } catch (e) { /* ok */ }
  console.info('[sim2026] cenário salvo descartado: ' + motivo);
  return false;
}

function restaurarLocal() {
  let bruto = null;
  try { bruto = localStorage.getItem(chaveArmazenamento()); } catch (e) { return false; }
  if (!bruto) return false;

  let c;
  try { c = JSON.parse(bruto); } catch (e) { return descartarCenario('JSON inválido'); }
  if (!c || !c.candidatos || !c.candidatos.length) return descartarCenario('sem candidatos');

  // Cenário de uma versão anterior do esquema: descartar em vez de misturar.
  if (c.versao !== CENARIO_VERSAO) {
    return descartarCenario(`versão ${c.versao} != ${CENARIO_VERSAO}`);
  }
  // Cargo e estado têm de ser os mesmos: as colunas e as origens dependem deles.
  if ((c.modo || 'presidente') !== SIM.modo || (c.uf || null) !== SIM.ufGov) {
    return descartarCenario(`cenário de ${c.modo || 'presidente'}${c.uf ? '/' + c.uf : ''}`);
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
  if ((c.modo || 'presidente') !== SIM.modo || (c.uf || null) !== SIM.ufGov) {
    const de = c.modo === 'governador' ? `governador de ${c.uf}` : 'presidente';
    const para = ehGov() ? `governador de ${SIM.ufGov}` : 'presidente';
    simAvisar(`Arquivo JSON é de ${de} e a tela está em ${para}.`);
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
  a.download = ehGov() ? `cenario_gov_2026_${SIM.ufGov}.json` : 'cenario_2026.json';
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

/* O estado abre com a reedicao de 2022: cada candidatura que virou origem entra
   como candidato, e a MIGRACAO ja nasce mandando cada candidatura de 2022
   inteira para si mesma.

   E o ponto de partida com significado — a projecao base sai igual a eleicao
   real do estado — e, principalmente, e onde a "heranca" mora. Nao ha um campo
   separado ligando candidato a candidatura de 2022: essa ligacao E a matriz de
   migracao, que o usuario edita na etapa 2 como bem entender.

   O presidencial continua abrindo com a matriz zerada de propósito: la os
   candidatos de 2026 nao sao os de 2022, entao nao existe identidade para
   assumir. */
/* Cenario inicial do modo corrente: candidatos e migracao juntos.

   Os dois vem em par de proposito. No governador a migracao inicial e a
   identidade sobre os candidatos recem-criados; separar as duas coisas fazia o
   chamador zerar a matriz logo depois de monta-la. */
function semearCenarioPadrao() {
  if (ehGov()) return candidatosPadraoGov();
  candidatosPadrao();
  SIM.transfer = simTransferPadrao();
}

function candidatosPadraoGov() {
  const m = metaGov();
  if (!m) return;
  SIM.transfer = simTransferPadrao();
  m.origens.forEach(o => {
    const linha = SIM.transfer[o.key];
    if (!linha) return;
    if (o.key === 'nulo_branco') { linha.nuloBranco = 100; return; }
    if (o.key === 'abstencao') { linha.abstencao = 100; return; }
    if (o.key === 'outros') { linha.outros = 100; return; }
    const c = simAddCandidato(o.rotulo, o.partido);
    linha['cand_' + c.id] = 100;
  });
}

/* Troca de cargo (e de estado, no modo governador).

   Muda tudo que e posicional de uma vez: as COLUNAS (candidatos) e as LINHAS
   (origens de 2022) da matriz de migracao. Qualquer meta guardada vira um vetor
   sem significado, entao o estado inteiro e zerado — mesma razao documentada em
   esquecerEdicoesPosicionais. */
async function entrarModo(modo, uf) {
  if (modo === SIM.modo && (modo !== 'governador' || uf === SIM.ufGov)) return;
  if (SIM.baseGerada && !window.confirm(
    'Trocar de cargo ou de estado descarta o cenário aberto nesta tela. Continuar?')) {
    simRenderSeletorCargo();
    return;
  }
  salvarLocal();                      // guarda o cenario que esta saindo

  SIM.modo = modo;
  SIM.ufGov = modo === 'governador' ? uf : null;
  SIM.candidatos = [];
  SIM.proxId = 1;
  esquecerEdicoesPosicionais();       // ops + demoEdit
  SIM.pesosRegiao = {};
  SIM.regiaoTocada = {};
  SIM._assinaturaMigracao = null;
  SIM._cacheRegioes = {};
  SIM.agregado = SIM.agregado2T = SIM.support = SIM.shares = null;
  SIM.t2 = { finalistas: null, matriz: null, chaveMatriz: null, porGrupo: null, comparecimento: 0 };
  SIM.baseGerada = false;
  SIM.turno = 1;
  SIM.selectedMuni = null;
  SIM.regiaoSel = null;

  document.getElementById('mapLoader').classList.add('visible');
  try {
    if (modo === 'governador') {
      SIM.regioesGov = await fetchJSON(PACK_GOV_URL + `regioes_${uf}.json`);
      const r = await simEnviar({
        type: 'loadGov', baseDir: new URL(PACK_GOV_URL, location.href).href, uf
      });
      if (r.type !== 'govLoaded') throw new Error(r.erro || 'falha ao carregar o pacote');
      SIM.selectedUF = uf;
      SIM.modoMapa = 'ri';
    } else {
      SIM.regioesGov = null;
      await simEnviar({ type: 'loadGov', uf: null });
      SIM.selectedUF = null;
      SIM.modoMapa = 'estado';
    }
  } catch (e) {
    console.error(e);
    simAvisar('Não foi possível carregar o pacote: ' + e.message);
    document.getElementById('mapLoader').classList.remove('visible');
    return;
  }
  document.getElementById('mapLoader').classList.remove('visible');

  SIM.escopo = escopoTopo();
  try { localStorage.setItem('sim2026_modo', JSON.stringify({ modo, uf: SIM.ufGov })); }
  catch (e) { /* ok */ }

  if (!restaurarLocal()) semearCenarioPadrao();
  semearRegioesBase();
  simRenderSeletorCargo();
  simRenderModoMapa();
  if (SIM.baseGerada) await simCalcular();
  simRenderTudo();
  abrirModal('candidatos');
}

/* Os pesos do recorte obrigatorio ja nascem com o resultado real de 2022; a
   etapa continua obrigatoria porque o usuario precisa revisar e confirmar. */
function semearRegioesBase() {
  const nb = nivelBase();
  listaRegioes(nb).forEach(r => pesosDaRegiao(`${nb}:${r.codigo}`));
}

/* Faixa de cargo do modal, logo acima das etapas.

   Fica aqui e nao na barra do mapa porque o cargo nao e um recorte de
   visualizacao: e o que define quais candidatos existem, quais sao as origens
   de 2022 e qual recorte territorial e o obrigatorio. Trocar o cargo refaz as
   seis etapas. */
function simRenderSeletorCargo() {
  document.querySelectorAll('#simEleicaoSwitch .sim-mode-btn').forEach(b => {
    const gov = b.dataset.cargo === 'governador';
    b.classList.toggle('active', b.dataset.cargo === SIM.modo);
    // Sem o pacote de governador em disco a opcao simplesmente nao existe.
    b.disabled = gov && !(SIM.indiceGov && SIM.indiceGov.ufs);
    b.title = b.disabled
      ? 'Rode scripts/gerar_base_governador_2022.py para habilitar' : '';
  });
  const wrap = document.getElementById('simUfGovWrap');
  if (wrap) wrap.hidden = !ehGov();
  const sel = document.getElementById('simUfGov');
  if (sel && ehGov()) sel.value = SIM.ufGov || '';

  const nota = document.getElementById('simCargoNota');
  if (nota) {
    nota.textContent = ehGov()
      ? 'Uma eleição por estado: candidatos e pesos são os do estado escolhido.'
      : 'Eleição nacional, com o eleitorado das 27 unidades da federação.';
  }
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

  // Popula o seletor de estado e liga a barra de cargo antes de qualquer
  // restauracao: e ela que decide QUAL cenario restaurar.
  const selUfGov = document.getElementById('simUfGov');
  if (selUfGov) {
    const disp = SIM.indiceGov ? SIM.indiceGov.ufs : {};
    selUfGov.innerHTML = Array.from(UF_MAP.entries())
      .filter(([sg]) => disp[sg])
      .sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
      .map(([sg, nome]) => `<option value="${sg}">${escapeHtml(nome)}</option>`).join('');
    selUfGov.addEventListener('change', e => entrarModo('governador', e.target.value));
  }
  document.querySelectorAll('#simEleicaoSwitch .sim-mode-btn').forEach(b =>
    b.addEventListener('click', () => {
      const cargo = b.dataset.cargo;
      entrarModo(cargo, cargo === 'governador'
        ? (SIM.ufGov || (selUfGov && selUfGov.value) || 'SP') : null);
    }));

  /* Cargo da ultima sessao. So mexe em SIM.modo/ufGov e carrega o pacote — a
     restauracao do cenario e o resto do boot seguem o caminho normal logo
     abaixo, agora ja no modo certo. Se o pacote de governador nao existir,
     cai no presidencial sem reclamar: a pagina tem de abrir de qualquer jeito. */
  let ultimo = null;
  try { ultimo = JSON.parse(localStorage.getItem('sim2026_modo') || 'null'); }
  catch (e) { /* ok */ }
  if (ultimo && ultimo.modo === 'governador' && ultimo.uf
    && SIM.indiceGov && SIM.indiceGov.ufs[ultimo.uf]) {
    try {
      SIM.regioesGov = await fetchJSON(PACK_GOV_URL + `regioes_${ultimo.uf}.json`);
      const r = await simEnviar({
        type: 'loadGov', baseDir: new URL(PACK_GOV_URL, location.href).href, uf: ultimo.uf
      });
      if (r.type === 'govLoaded') {
        SIM.modo = 'governador';
        SIM.ufGov = ultimo.uf;
        SIM.selectedUF = ultimo.uf;
        SIM.modoMapa = 'ri';
        SIM.escopo = escopoTopo();
      }
    } catch (e) {
      console.warn('[simgov2026] não foi possível retomar o modo governador:', e.message);
      SIM.regioesGov = null;
    }
  }

  const primeiraVisita = !restaurarLocal();
  if (primeiraVisita) semearCenarioPadrao();
  // Sugere o reduto pelo nome (Zema -> MG, Caiado -> GO); continua editavel.
  SIM.candidatos.forEach(c => { if (c.reduto === undefined) c.reduto = redutoSugerido(c) || null; });
  semearRegioesBase();
  simRenderSeletorCargo();

  // Ligacoes de UI
  const btnAbrir = document.getElementById('btnAbrirConfig');
  if (btnAbrir) btnAbrir.addEventListener('click', () => abrirModal());
  document.getElementById('btnEditSimGlobal')?.addEventListener('click', () => abrirModal());
  document.getElementById('btnEditSimGlobalLeft').addEventListener('click', () => abrirModal());
  document.getElementById('btnEmptyConfigLeft').addEventListener('click', () => {
    const e = prontoParaBase();
    abrirModal(e.migOk ? paneBase() : 'cenario');
  });
  document.getElementById('btnEmptyConfig').addEventListener('click', () => {
    const e = prontoParaBase();
    abrirModal(e.migOk ? paneBase() : 'cenario');
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
    semearCenarioPadrao();
    SIM.candidatos.forEach(c => { if (c.reduto === undefined) c.reduto = redutoSugerido(c) || null; });
    SIM.migracaoTocada = false;
    SIM.pesosRegiao = {};
    SIM.regiaoTocada = {};
    SIM._assinaturaMigracao = null;
    SIM._cacheRegioes = {};
    SIM.ops.clear();
    SIM.demoEdit = {};
    SIM.baseGerada = false;
    SIM.agregado = null;
    SIM.agregado2T = null;
    SIM.support = null;
    SIM.shares = null;
    SIM.t2 = { finalistas: null, matriz: null, porGrupo: null, comparecimento: 0, chaveMatriz: null };
    SIM.escopo = escopoTopo();
    SIM.selectedUF = ehGov() ? SIM.ufGov : null;
    SIM.selectedMuni = null;
    SIM.regiaoSel = null;
    SIM.paneAtivo = 'candidatos';
    try { localStorage.removeItem(chaveArmazenamento()); } catch (e) { /* ok */ }
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

  // Os botoes de recorte do mapa sao reescritos por modo, entao quem os liga e
  // simRenderModoMapa — ligar aqui perderia o handler no primeiro re-render.
  simRenderModoMapa();

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
