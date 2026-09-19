// ============================================================================
// globals.js — Observatório Portugal (Assembleia da República)
// Estado global, círculos eleitorais, cores partidárias e helpers de UI.
// ============================================================================

const DATA_BASE_URL = 'dados/';

// ====== CÍRCULOS ELEITORAIS ======
// Chave = 2 primeiros dígitos do DICOFRE (30/40 agregam Madeira 31-32 e
// Açores 41-49). E1/E2 são os círculos da emigração (sem geometria no mapa).
// XM/XC/XE são os círculos especiais de 1975 (Macau, Moçambique, Emigração),
// substituídos por E1/E2 a partir de 1976.
const CIRCULOS = new Map([
  ['01', 'Aveiro'], ['02', 'Beja'], ['03', 'Braga'], ['04', 'Bragança'],
  ['05', 'Castelo Branco'], ['06', 'Coimbra'], ['07', 'Évora'], ['08', 'Faro'],
  ['09', 'Guarda'], ['10', 'Leiria'], ['11', 'Lisboa'], ['12', 'Portalegre'],
  ['13', 'Porto'], ['14', 'Santarém'], ['15', 'Setúbal'], ['16', 'Viana do Castelo'],
  ['17', 'Vila Real'], ['18', 'Viseu'], ['30', 'Madeira'], ['40', 'Açores'],
  ['E1', 'Europa'], ['E2', 'Fora da Europa'],
  ['XM', 'Macau'], ['XC', 'Moçambique'], ['XE', 'Emigração']
]);
const CIRCULOS_SEM_GEOMETRIA = new Set(['E1', 'E2', 'XM', 'XC', 'XE']);

function circuloFromDicofre(dicofre) {
  const dt = String(dicofre || '').slice(0, 2);
  const n = parseInt(dt, 10);
  if (n >= 1 && n <= 18) return dt;
  if (n === 31 || n === 32) return '30';
  if (n >= 40 && n <= 49) return '40';
  return null;
}

// Anos com dados de Assembleia da República (1975 = Assembleia Constituinte)
const AR_YEARS = [
  { value: '2025', label: '2025' }, { value: '2024', label: '2024' },
  { value: '2022', label: '2022' }, { value: '2019', label: '2019' },
  { value: '2015', label: '2015' }, { value: '2011', label: '2011' },
  { value: '2009', label: '2009' }, { value: '2005', label: '2005' },
  { value: '2002', label: '2002' }, { value: '1999', label: '1999' },
  { value: '1995', label: '1995' }, { value: '1991', label: '1991' },
  { value: '1987', label: '1987' }, { value: '1985', label: '1985' },
  { value: '1983', label: '1983' }, { value: '1980', label: '1980' },
  { value: '1979', label: '1979' }, { value: '1976', label: '1976' },
  { value: '1975', label: '1975 (Constituinte)' }
];

// Anos disponíveis de facto (preenchido a partir de dados/index.json;
// fallback para o piloto se o índice não existir)
let AVAILABLE_YEARS = null;

// ====== ELEIÇÕES PRESIDENCIAIS (PR) ======
// A tag do ano pode ser '1986_2' (2.ª volta). Cada ano PR reutiliza o mapa
// (geojson) do ano AR mais próximo (PR_MAP_YEAR), gerado pelo ETL.
const PR_YEARS = [
  { value: '2026_2', label: '2026 (2.ª volta)' }, { value: '2026', label: '2026 (1.ª volta)' },
  { value: '2021', label: '2021' }, { value: '2016', label: '2016' },
  { value: '2011', label: '2011' }, { value: '2006', label: '2006' },
  { value: '2001', label: '2001' }, { value: '1996', label: '1996' },
  { value: '1991', label: '1991' },
  { value: '1986_2', label: '1986 (2.ª volta)' }, { value: '1986', label: '1986 (1.ª volta)' },
  { value: '1980', label: '1980' }, { value: '1976', label: '1976' }
];
const PR_MAP_YEAR = {
  '1976': '1976', '1980': '1980', '1986': '1985', '1986_2': '1985',
  '1991': '1991', '1996': '1995', '2001': '2002', '2006': '2005',
  '2011': '2011', '2016': '2015', '2021': '2022',
  '2026': '2026', '2026_2': '2026'
};
let AVAILABLE_PR_YEARS = null;

// ====== ELEIÇÕES EUROPEIAS (EE — Parlamento Europeu) ======
// Círculo único nacional, proporcional (d'Hondt). Usa partidos (como a AR), pelo
// que reutiliza o sistema de cores de partidos. Cada ano reutiliza o geojson do
// ano AR mais próximo (EE_MAP_YEAR), gerado pelo ETL.
const EE_YEARS = [
  { value: '2024', label: '2024' }, { value: '2019', label: '2019' },
  { value: '2014', label: '2014' }, { value: '2009', label: '2009' },
  { value: '2004', label: '2004' }, { value: '1999', label: '1999' },
  { value: '1994', label: '1994' }, { value: '1989', label: '1989' },
  { value: '1987', label: '1987' }
];
const EE_MAP_YEAR = {
  '1987': '1987', '1989': '1987', '1994': '1995', '1999': '1999', '2004': '2005',
  '2009': '2009', '2014': '2015', '2019': '2019', '2024': '2024'
};
let AVAILABLE_EE_YEARS = null;

// ====== ELEIÇÕES AUTÁRQUICAS (AU) ======
const AU_YEARS = [
  { value: '2025', label: '2025' }, { value: '2021', label: '2021' },
  { value: '2017', label: '2017' }, { value: '2013', label: '2013' },
  { value: '2009', label: '2009' }, { value: '2005', label: '2005' },
  { value: '2001', label: '2001' }, { value: '1997', label: '1997' },
  { value: '1993', label: '1993' }, { value: '1989', label: '1989' },
  { value: '1985', label: '1985' }, { value: '1982', label: '1982' },
  { value: '1979', label: '1979' }, { value: '1976', label: '1976' }
];
const AU_MAP_YEAR = {
  '1976': '1976', '1979': '1979', '1982': '1983', '1985': '1985',
  '1989': '1991', '1993': '1993', '1997': '1997', '2001': '2002',
  '2005': '2005', '2009': '2009', '2013': '2015', '2017': '2019',
  '2021': '2022', '2025': '2026'
};
let AVAILABLE_AU_YEARS = null;

// ====== CORES E PARTIDOS ======
// Cores base por chave normalizada (ver getNormalizedPartyColorKey).
const PARTY_COLORS = new Map(Object.entries({
  'PS': '#e75294',        // Partido Socialista
  'PSD': '#ff8000',       // PPD/PSD
  'AD': '#f2681c',        // Aliança Democrática 2024/25 (1979/80 usa #2950bc, ver getResolvedPartyColor)
  'CH': '#202a5e',        // Chega
  'IL': '#00b6c7',        // Iniciativa Liberal
  'BE': '#b4004e',        // Bloco de Esquerda
  'CDU': '#d40000',       // PCP-PEV / APU / FEPU
  'PCP': '#aa0000',
  'CDS': '#0069b4',       // CDS / CDS-PP
  'PAN': '#0f7d64',
  'L': '#3fbf77',         // Livre
  'L/TDA': '#3FBF77',     // Livre / Tempo de Avançar
  'PPM': '#4040a0',
  'JPP': '#00a0a0',       // Juntos pelo Povo
  'ADN': '#5a6b7a',
  'PRD': '#216b31',
  'FRS': '#ff66ff',       // Frente Republicana e Socialista (1980)
  'UDP': '#7e0f0f',
  'MDP': '#c2543a', 'MDP/CDE': '#c2543a',
  'PSN': '#8a8f3c',
  'PCTP/MRPP': '#8b0000',
  'PSR': '#c81e5a',
  'E': '#333a8c',         // Ergue-te
  'PNR': '#333a8c',
  'NC': '#123e63',        // Nós, Cidadãos!
  'ND': '#1c5c8c',        // Nova Direita
  'MPT': '#3a7d44',
  'VP': '#502379',        // Volt Portugal
  'RIR': '#f9b000',       // Reagir Incluir Reciclar
  'PTP': '#d16ba5',
  'MAS': '#cc0033',
  'A': '#3d7068',         // Alternativa
  'PDR': '#2e6f95',
  'PURP': '#9b2226',
  'POUS': '#a4161a',
  'PDC': '#274c77',
  'FSP': '#bb3e03',
  'MES': '#ae2012',
  'FEC': '#6a040f',
  'LCI': '#9d0208',
  'PUP': '#d00000',
  'FER': '#d62839',
  'PDA': '#5f7470',
  'OCMLP': '#7f1d1d',
  'LST': '#b91c1c',
  'UDPSR': '#8c1c13',
  'BE-UDP': '#b4004e',
  'PH': '#f4a261',
  'PLS': '#6096ba',
  'PAF': '#00549e',
  'ALIANCA ACORES': '#0069b4'
}));

// Ajustes finos usados antes da cor base (mantido por compatibilidade com
// colorForParty/getResolvedPartyColor; vazio por omissão — as cores base já
// foram escolhidas para o mapa).
const PARTY_COLOR_OVERRIDES = new Map();

const CUSTOM_PARTY_COLORS = new Map();
const CUSTOM_CANDIDATE_COLORS = new Map();
const DEFAULT_SWATCH = '#7a8699';

let randomColorOffset = Math.floor(Math.random() * 360);

function getAcronymHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

function hslToHex(h, s, l) {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function getDynamicPartyColor(key) {
  if (!key) return DEFAULT_SWATCH;
  const hash = getAcronymHash(key);
  const hue = (hash + randomColorOffset) % 360;
  // Dynamic color with 75% saturation and 45% lightness
  return hslToHex(hue, 75, 45);
}

// Nomes por extenso (tooltip/painel; opcional)
const PARTY_FULL_NAMES = new Proxy({
  'PS': 'Partido Socialista',
  'PSD': 'Partido Social Democrata',
  'AD': 'Aliança Democrática',
  'CH': 'Chega',
  'IL': 'Iniciativa Liberal',
  'BE': 'Bloco de Esquerda',
  'CDU': 'CDU (PCP-PEV)',
  'PCP': 'Partido Comunista Português',
  'CDS': 'CDS – Partido Popular',
  'PAN': 'Pessoas–Animais–Natureza',
  'L': 'LIVRE',
  'PPM': 'Partido Popular Monárquico',
  'JPP': 'Juntos pelo Povo',
  'PRD': 'Partido Renovador Democrático',
  'UDP': 'União Democrática Popular',
  'A': 'Aliança',
  'ADN': 'Alternativa Democrática Nacional',
  'AOC': 'Associação Operária Cultural',
  'APU': 'Aliança Povo Unido',
  'BE-UDP': 'Bloco de Esquerda - União Democrática Popular',
  'E': 'Ergue-te',
  'FEC': 'Frente Eleitoral de Comunistas',
  'FER': 'Frente de Esquerda Revolucionária',
  'FRS': 'Frente Republicana e Socialista',
  'FSP': 'Frente Socialista Popular',
  'L/TDA': 'LIVRE/Tempo de Avançar',
  'LCI': 'Liga Comunista Internacionalista',
  'LST': 'Liga Socialista dos Trabalhadores',
  'MAS': 'Movimento Alternativa Socialista',
  'MDP': 'Movimento Democrático Português / CDE',
  'MDP/CDE': 'Movimento Democrático Português / CDE',
  'MEP': 'Movimento Esperança Portugal',
  'MES': 'Movimento de Esquerda Socialista',
  'MMS': 'Movimento Mérito e Sociedade',
  'MPT': 'Partido da Terra',
  'MPT-P.H.': 'MPT-P.H. (Partido da Terra / Partido Humanista)',
  'MPT.A': 'MPT-Aliança',
  'MRPP': 'Movimento Reorganizativo do Partido do Proletariado',
  'MUT': 'Movimento de Unidade dos Trabalhadores',
  'NC': 'Nós, Cidadãos!',
  'ND': 'Nova Direita',
  'OCMLP': 'Organização Comunista Marxista-Leninista Portuguesa',
  'PH': 'Partido Humanista',
  'P.H.': 'Partido Humanista',
  'P.N.R.': 'Partido Nacional Renovador',
  'PCP-PEV': 'CDU (PCP-PEV)',
  'PCPML': 'Partido Comunista Português (Marxista-Leninista)',
  'PCR': 'Partido Comunista Reconstruído',
  'PCTP/MRPP': 'PCTP/MRPP (Partido Comunista dos Trabalhadores Portugueses)',
  'PDA': 'Partido Democrático do Atlântico',
  'PDC': 'Partido da Democracia Cristã',
  'PDR': 'Partido Democrático Republicano',
  'PG': 'Partido da Gente',
  'PLS': 'Partido Liberal Social',
  'PND': 'Partido da Nova Democracia',
  'PNR': 'Partido Nacional Renovador',
  'POUS': 'Partido Operário de Unidade Socialista',
  'PPD': 'Partido Popular Democrático',
  'PPD/PSD': 'Partido Social Democrata',
  'PPD/PSD.CDS-PP': 'Aliança Democrática',
  'PPM-MPT': 'PPM-MPT (Monárquicos / Terra)',
  'PPV': 'Portugal pro Vida',
  'PPV/CDC': 'PPV/CDC (Portugal pro Vida / Cidadania e Democracia Cristã)',
  'PRT': 'Partido Revolucionário dos Trabalhadores',
  'PSN': 'Partido de Solidariedade Nacional',
  'PSR': 'Partido Socialista Revolucionário',
  'PT': 'Partido Trabalhista',
  'PTP': 'Partido Trabalhista Português',
  'PTP-MAS': 'PTP-MAS (Trabalhistas / Alternativa Socialista)',
  'PUP': 'Partido de Unidade Popular',
  'PURP': 'Partido Unido dos Reformados e Pensionistas',
  'PàF': 'Portugal à Frente',
  'RIR': 'Reagir Incluir Reciclar',
  'UDPSR': 'UDP-PSR (União Democrática Popular / Socialista Revolucionário)',
  'UEDS': 'União da Esquerda para a Democracia Socialista',
  'VP': 'Volt Portugal',
  'ALIANCA ACORES': 'Aliança Açores',
  'PAF': 'Portugal à Frente',
  'CDS-PP.PPM': 'Aliança Açores',
  'FORCA PORTUGAL': 'Força Portugal',
  'ALIANCA PORTUGAL': 'Aliança Portugal'
}, {
  get: function(target, prop) {
    if (typeof prop === 'string') {
      const year = String(STATE.currentYear || '');
      const election = String(STATE.currentElectionType || '');
      if (election === 'ee') {
        if (year === '2004') {
          if (prop === 'AD' || prop === 'PPD/PSD.CDS-PP') {
            return 'Força Portugal';
          }
        } else if (year === '2014') {
          if (prop === 'AD' || prop === 'PPD/PSD.CDS-PP') {
            return 'Aliança Portugal';
          }
        }
      }
      if (year === '1975' || year === '1976') {
        if (prop === 'PSD' || prop === 'PPD' || prop === 'PPD/PSD') {
          return 'Partido Popular Democrático';
        }
        if (prop === 'CDS') {
          return 'Partido do Centro Democrático Social';
        }
      }
    }
    return target[prop] || prop || '';
  }
});

// Normaliza uma sigla para a chave de cor: remove acentos, aplica aliases de
// coligações/afins e só depois remove pontos (B.E. -> BE, R.I.R. -> RIR).
const PARTY_KEY_ALIASES = new Map(Object.entries({
  'PPD': 'PSD',
  'PPD/PSD': 'PSD',
  'PPD/PSD.CDS-PP': 'AD',
  'PPD/PSD.CDS-PP.PPM': 'AD',
  'PPD/PSD-CDS-PP': 'AD',
  'MADEIRA PRIMEIRO': 'AD',
  'AD ACORES': 'AD',
  'PAF': 'AD',
  'FORCA PORTUGAL': 'AD',
  'ALIANCA PORTUGAL': 'AD',
  'PCP-PEV': 'CDU',
  'APU': 'CDU',
  'FEPU': 'CDU',
  'CDS-PP': 'CDS',
  'B.E.': 'BE',
  'BE': 'BE',
  'B.E.-UDP': 'BE-UDP',
  'R.I.R.': 'RIR',
  'MDP/CDE': 'MDP',
  'CDS-PP.PPM': 'ALIANCA ACORES',
  'ALIANCA ACORES': 'ALIANCA ACORES'
}));

function getNormalizedPartyColorKey(partido) {
  let clean = String(partido || '').trim().toUpperCase();
  if (!clean) return '';
  clean = clean.normalize('NFD').replace(/[̀-ͯ]/g, '');
  clean = clean.replace(/\s+/g, ' ').trim();
  
  if (STATE.currentYear === '2015') {
    if (clean === 'PAF' || clean === 'PPD/PSD.CDS-PP' || clean === 'PAF' || clean === 'PAF' || clean === 'PPD/PSD.CDS-PP' || clean === 'PAF' || clean === 'PA F' || clean === 'PPD/PSD.CDS-PP') {
      return 'PAF';
    }
  }

  if (PARTY_KEY_ALIASES.has(clean)) return PARTY_KEY_ALIASES.get(clean);
  const noDots = clean.replace(/\.(?=\S)/g, '').replace(/\.$/, '');
  if (PARTY_KEY_ALIASES.has(noDots)) return PARTY_KEY_ALIASES.get(noDots);

  if (STATE.currentElectionType === 'au') {
    if (clean.includes('.')) {
      const leader = clean.split('.')[0];
      const leaderKey = getNormalizedPartyColorKey(leader);
      if (PARTY_COLORS.has(leaderKey)) return leaderKey;
    }
    if (clean.includes('-')) {
      const leader = clean.split('-')[0];
      const leaderKey = getNormalizedPartyColorKey(leader);
      if (PARTY_COLORS.has(leaderKey)) return leaderKey;
    }
  }

  return noDots;
}

// Mantido por compatibilidade (coligações já são resolvidas pelos aliases)
function getFederationColorPartyKey() { return ''; }

function getResolvedPartyColor(partido) {
  if (STATE.customBlocks) {
    const block = STATE.customBlocks.find(b => b.name === partido);
    if (block) return block.color;
  }
  // Presidenciais: a "chave" é o nome canónico do candidato; a cor (herdada do
  // partido de apoio) vem da METADATA do ano, com override de cor personalizada.
  if (STATE.currentElectionType === 'pr') {
    if (CUSTOM_CANDIDATE_COLORS.has(partido)) return CUSTOM_CANDIDATE_COLORS.get(partido);
    const cor = STATE.data?.METADATA?.parties?.[partido]?.cor;
    return cor || getDynamicPartyColor(partido);
  }
  const key = getNormalizedPartyColorKey(partido);
  if (CUSTOM_PARTY_COLORS.has(key)) return CUSTOM_PARTY_COLORS.get(key);
  if (PARTY_COLOR_OVERRIDES.has(key)) return PARTY_COLOR_OVERRIDES.get(key);
  // A AD de 1979/1980 (coligação PSD/CDS/PPM) usa cor distinta da AD de 2024/25.
  if (key === 'AD' && (STATE.currentYear === '1979' || STATE.currentYear === '1980')) {
    return '#2950bc';
  }
  const officialColor = PARTY_COLORS.get(key);
  if (officialColor) return officialColor;
  
  return getDynamicPartyColor(key);
}

function getColorForCandidate(nome, partido) {
  if (CUSTOM_CANDIDATE_COLORS.has(nome)) return CUSTOM_CANDIDATE_COLORS.get(nome);
  return getResolvedPartyColor(partido);
}

// ====== MAPA ======
const MAP_DEFAULT_CENTER = [-9.5, 39.6];
const MAP_DEFAULT_ZOOM = 6;

// ====== ESTADO ======
let map;
let selectedLocationIDs = new Set();   // dicofres selecionados (Shift+clique/arrasto)
let currentVizMode = 'vencedor';       // 'vencedor' | 'desempenho'
let currentGradientMode = 'margin';    // 'margin' | 'winnerPct' (lido por utils.js)
let autoLoadTimer = null;

const NATIONAL_SCOPE_MODE = 'global';

const STATE = {
  currentElectionType: 'ar',           // 'ar' (Assembleia da República) | 'pr' (Presidenciais)
  auSubtype: 'cm',                     // 'cm' | 'am' | 'af'
  currentYear: '2025',
  currentCirculo: '',                  // '' = Portugal inteiro
  currentNuts: '',                     // '' = sem filtro regional. Ex: 'n2:Norte', 'am:AML'
  scope: { level: 'national', key: null },  // national|distrito|concelho|freguesia
  mapLevel: 'distrito',                // 'distrito' | 'concelho' | 'freguesia'
  granularity: 'distrito',             // 'distrito' | 'concelho' | 'freguesia'
  vizParty: null,                      // partido no modo desempenho
  performanceStats: null,              // { minPct, maxPct } do partido no ano
  extrusionEnabled: false,
  showSeatDonuts: false,
  isLoadingDataset: false,
  isFilterAggregationActive: false,
  data: null,                          // ar_{ano}.json carregado
  geo: null,                           // { freguesias, concelhos, distritos }
  freguesiasLayer: null,
  concelhosLayer: null,
  distritosLayer: null,
  concelhosOutlineLayer: null,
  distritosOutlineLayer: null
};

let dom = {};

// ====== LOADING HELPERS ======
function setButtonLoading(btn, isLoading) {
  if (!btn) return;
  if (isLoading) {
    btn.classList.add('loading');
    btn.disabled = true;
  } else {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

function fadeContent(element, callback) {
  if (!element) {
    if (callback) callback();
    return;
  }
  element.classList.add('fading');
  setTimeout(() => {
    if (callback) callback();
    element.classList.remove('fading');
  }, 200);
}

function showToast(message, type = 'info', duration = 3000) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function showMapLoading(message = 'A carregar dados...', progress = null) {
  if (!dom.mapLoader) return;
  dom.mapLoader.textContent = message;
  dom.mapLoader.classList.add('visible');
  if (progress === null || progress === undefined) {
    dom.mapLoader.dataset.progressMode = 'indeterminate';
    dom.mapLoader.style.removeProperty('--loader-progress');
    return;
  }
  const safeProgress = Math.max(0, Math.min(100, Number(progress) || 0));
  dom.mapLoader.dataset.progressMode = 'determinate';
  dom.mapLoader.style.setProperty('--loader-progress', `${safeProgress}%`);
}

function hideMapLoading() {
  if (!dom.mapLoader) return;
  dom.mapLoader.classList.remove('visible');
  dom.mapLoader.dataset.progressMode = 'indeterminate';
  dom.mapLoader.style.removeProperty('--loader-progress');
}

// ====== MULTI-SELEÇÃO (Shift+arrasto) ======
let isSelectorsActive = false;
let startSelectionPoint = null;
let selectionBoxElement = null;
let isDragSelection = false;

function cleanPartyAcronym(party) {
  let clean = String(party || '').trim().toUpperCase();
  clean = clean.normalize('NFD').replace(/[̀-ͯ]/g, '');
  
  // 1. Replace PPD/PSD with PSD
  clean = clean.replace(/PPD\/PSD/g, 'PSD');
  
  // 2. Remove abbreviation dots
  clean = clean.replace(/B\.E\./g, 'BE').replace(/B\.E/g, 'BE');
  clean = clean.replace(/R\.I\.R\./g, 'RIR').replace(/R\.I\.R/g, 'RIR');
  clean = clean.replace(/P\.S\./g, 'PS').replace(/P\.S/g, 'PS');
  clean = clean.replace(/P\.N\.R\./g, 'PNR').replace(/P\.N\.R/g, 'PNR');
  
  return clean;
}

function getCoalitionLeader(party) {
  const clean = cleanPartyAcronym(party);
  
  // Split by standard separators: ., -, +, /
  const parts = clean.split(/[\.\-\+\/]/);
  const leader = parts[0] || clean;
  
  const normalized = getNormalizedPartyColorKey(leader);
  return normalized || leader;
}

function isRealCoalition(party) {
  const clean = cleanPartyAcronym(party);
  if (clean === "PSD" || clean === "PS" || clean === "CDS-PP" || clean === "CDS" || clean === "PCP" || clean === "CH" || clean === "IL" || clean === "BE" || clean === "PAN" || clean === "L") {
    return false;
  }
  if (clean.includes('.') || clean.includes('+')) return true;
  if (clean.includes('/')) return true;
  if (clean.includes('-') && clean !== 'CDS-PP' && clean !== 'PCP-PEV' && clean !== 'BE-UDP' && clean !== 'MPT-P.H.' && clean !== 'PTP-MAS') return true;
  
  return false;
}

function groupAutarquicasVotes(votes, presidents, maiorias, mandatos_p, level, subType) {
  if (level === 'concelho' || level === 'freguesia') {
    const isCM_AF_Agg = (subType === 'cm' && (level === 'national' || level === 'distrito')) ||
                        (subType === 'af' && (level === 'national' || level === 'distrito' || level === 'concelho'));
    const finalItems = Object.keys(votes).map(party => {
      const v = votes[party] || 0;
      const mSeats = mandatos_p?.[party] || 0;
      const pCount = presidents?.[party] || 0;
      const mCount = maiorias?.[party] || 0;
      return {
        party,
        isGroup: false,
        votes: v,
        mandatos: mSeats,
        presidents: pCount,
        maiorias: mCount
      };
    });
    finalItems.sort((a, b) => {
      if (isCM_AF_Agg) {
        if (b.presidents !== a.presidents) return b.presidents - a.presidents;
      }
      return b.votes - a.votes;
    });
    return finalItems;
  }

  const groups = new Map();
  const others = [];
  
  Object.keys(votes).forEach(party => {
    const v = votes[party] || 0;
    const pCount = presidents?.[party] || 0;
    const mCount = maiorias?.[party] || 0;
    const mSeats = mandatos_p?.[party] || 0;
    
    const member = {
      party,
      votes: v,
      presidents: pCount,
      maiorias: mCount,
      mandatos: mSeats
    };
    
    const leaderKey = getCoalitionLeader(party);
    
    if (leaderKey) {
      if (!groups.has(leaderKey)) {
        groups.set(leaderKey, {
          mainParty: leaderKey,
          votes: 0,
          presidents: 0,
          maiorias: 0,
          mandatos: 0,
          members: []
        });
      }
      const g = groups.get(leaderKey);
      g.votes += v;
      g.presidents += pCount;
      g.maiorias += mCount;
      g.mandatos += mSeats;
      g.members.push(member);
    } else {
      others.push({
        party,
        isGroup: false,
        votes: v,
        presidents: pCount,
        maiorias: mCount,
        mandatos: mSeats
      });
    }
  });
  
  const finalItems = [];
  
  groups.forEach((g, leaderKey) => {
    g.members.sort((a, b) => b.votes - a.votes);
    
    const hasCoalitions = g.members.length > 1 || (g.members.length === 1 && isRealCoalition(g.members[0].party));
    
    if (hasCoalitions) {
      finalItems.push({
        party: `${leaderKey} e Coligações`,
        isGroup: true,
        mainParty: leaderKey,
        votes: g.votes,
        presidents: g.presidents,
        maiorias: g.maiorias,
        mandatos: g.mandatos,
        members: g.members
      });
    } else if (g.members.length === 1) {
      finalItems.push({
        party: g.members[0].party,
        isGroup: false,
        votes: g.votes,
        presidents: g.presidents,
        maiorias: g.maiorias,
        mandatos: g.mandatos
      });
    }
  });
  
  finalItems.push(...others);
  
  const isCM_AF_Agg = (subType === 'cm' && (level === 'national' || level === 'distrito')) ||
                      (subType === 'af' && (level === 'national' || level === 'distrito' || level === 'concelho'));
  
  finalItems.sort((a, b) => {
    if (isCM_AF_Agg) {
      if (b.presidents !== a.presidents) return b.presidents - a.presidents;
    } else if (subType === 'am' && (level === 'national' || level === 'distrito')) {
      if (b.mandatos !== a.mandatos) return b.mandatos - a.mandatos;
    }
    return b.votes - a.votes;
  });
  
  return finalItems;
}

window.isFeatureDisabled = function(layerId, feature) {
  if (STATE.currentNuts && STATE.currentElectionType !== 'au') {
    let dico = null;
    if (layerId === 'freguesias') {
      const dicofre = feature.properties?.dicofre || feature.properties?.id;
      if (dicofre) dico = String(dicofre).slice(0, 4);
    } else if (layerId === 'concelhos') {
      dico = feature.properties?.dico || feature.properties?.id;
    } else if (layerId === 'distritos') {
      const distCirc = feature.properties?.circulo || feature.properties?.id;
      if (distCirc && typeof NUTS_DATA !== 'undefined') {
        const hasMatch = Object.keys(NUTS_DATA).some(dicoKey => {
          if (dicoKey.slice(0, 2) !== distCirc) return false;
          return window.isConcelhoInNuts && window.isConcelhoInNuts(dicoKey);
        });
        if (!hasMatch) return true;
      }
    }
    
    if (dico && window.isConcelhoInNuts && !window.isConcelhoInNuts(dico)) {
      return true;
    }
  }

  if (layerId === 'freguesias' && STATE.currentElectionType === 'au' && STATE.auSubtype === 'af') {
    const yearNum = parseInt(STATE.currentYear || '0', 10);
    if (yearNum <= 2009) {
      const id = feature.properties?.dicofre || feature.properties?.freguesia;
      if (id) {
        const votes = STATE.data?.RESULTS?.[id];
        if (!votes || !Object.keys(votes).length) {
          return true;
        }
      }
    }
  }
  return false;
};

function isConcelhoInNuts(dico, nutsSelector = STATE.currentNuts) {
  if (STATE.currentElectionType === 'au') return true; // Ignorar filtros em eleições autárquicas
  if (!nutsSelector) return true;
  const parts = nutsSelector.split(':');
  if (parts.length < 2) return true;
  const filterType = parts[0];
  const filterVal = parts[1];
  
  const dicoStr = String(dico || '').padStart(4, '0');
  const info = typeof NUTS_DATA !== 'undefined' ? NUTS_DATA[dicoStr] : null;
  if (!info) return false;
  
  if (filterType === 'n1') return info.n1 === filterVal;
  if (filterType === 'n2') return info.n2 === filterVal;
  if (filterType === 'n3') return info.n3 === filterVal;
  if (filterType === 'am') return info.am === filterVal;
  return true;
}

window.isConcelhoInNuts = isConcelhoInNuts;
