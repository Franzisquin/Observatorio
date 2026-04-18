const DATA_BASE_URL = 'resultados_geo/';

// CACHE SIMPLES PARA CANDIDATOS (VERSÃO SIMPLIFICADA)
let CANDIDATES_CACHE = new Map();

let ZIP_INDEX = null;
let STATE_ZIP_INDEX = null;
let ZIP_READERS = (typeof LRUCache === 'function')
  ? new LRUCache(8)
  : new Map(); // Cache de leitores ZIP: URL -> BlobReader
let OFFICIAL_TOTALS_PROMISE = null; // Promise deduplication for official totals
let SQL_JS_PROMISE = null;
let GPKG_2006_DB_PROMISE = null;
let GPKG_2010_DB_PROMISE = null;
let GPKG_2008_DB_PROMISE = null;
let GPKG_2014_DB_PROMISE = null;
let GPKG_2018_DB_PROMISE = null;
let GPKG_2012_DB_PROMISE = null;
let GPKG_2016_DB_PROMISE = null;
let GPKG_2020_DB_PROMISE = null;
let GPKG_2024_DB_PROMISE = null;
let GPKG_2022_DB_PROMISE = null;
let GENERAL_2006_BASE_CACHE = new Map();
let CENSO_2006_CACHE = new Map();
let GENERAL_2010_BASE_CACHE = new Map();
let CENSO_2010_CACHE = new Map();
let GENERAL_2014_BASE_CACHE = new Map();
let CENSO_2014_CACHE = new Map();
let GENERAL_2018_BASE_CACHE = new Map();
let CENSO_2018_CACHE = new Map();
let MUNICIPAL_2008_BASE_CACHE = new Map();
let CENSO_2008_CACHE = new Map();
let MUNICIPAL_2012_BASE_CACHE = new Map();
let CENSO_2012_CACHE = new Map();
let MUNICIPAL_2016_BASE_CACHE = new Map();
let CENSO_2016_CACHE = new Map();
let MUNICIPAL_2020_BASE_CACHE = new Map();
let CENSO_2020_CACHE = new Map();
let MUNICIPAL_2024_BASE_CACHE = new Map();
let CENSO_2024_CACHE = new Map();
let GENERAL_2022_BASE_CACHE = new Map();
let CENSO_2022_CACHE = new Map();
let TURNOUT_REFERENCE_INDEX_CACHE = new Map();
let FEATURE_TURNOUT_CACHE = new WeakMap();
let CURRENT_VISIBLE_FEATURES_CACHE = [];
let CURRENT_VISIBLE_PROPS_CACHE = [];

function getCacheSize(cacheLike) {
  if (!cacheLike) return 0;
  if (typeof cacheLike.size === 'function') return cacheLike.size();
  return cacheLike.size || 0;
}

function forEachCacheEntry(cacheLike, callback) {
  if (!cacheLike || typeof callback !== 'function') return;
  if (typeof cacheLike.forEach === 'function') {
    cacheLike.forEach(callback);
    return;
  }
  if (cacheLike.cache && typeof cacheLike.cache.forEach === 'function') {
    cacheLike.cache.forEach(callback);
  }
}

// ====== LOADING HELPERS ======
function setButtonLoading(btn, isLoading) {
  if (!btn) return;
  if (dom.btnLoadData && btn === dom.btnLoadData) {
    STATE.isLoadingDataset = !!isLoading;
  }
  if (isLoading) {
    btn.classList.add('loading');
    btn.disabled = true;
  } else {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

function setChipLoading(chip, isLoading) {
  if (!chip) return;
  if (isLoading) {
    chip.classList.add('loading');
  } else {
    chip.classList.remove('loading');
  }
}

function setSectionLoading(section, isLoading) {
  if (!section) return;
  if (isLoading) {
    section.classList.add('loading');
  } else {
    section.classList.remove('loading');
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

function showSkeletonCards(container, count = 4) {
  if (!container) return;
  let html = '<div class="grid">';
  for (let i = 0; i < count; i++) {
    html += '<div class="skeleton-card"></div>';
  }
  html += '</div>';
  container.innerHTML = html;
}

function showToast(message, type = 'info', duration = 3000) {
  // Remove existing toasts
  document.querySelectorAll('.toast').forEach(t => t.remove());

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add('visible');
  });

  // Auto remove
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function showMapLoading(message = 'Carregando dados...', progress = null) {
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

function updateMapLoading(message, progress = null) {
  if (!dom.mapLoader) return;
  if (message) dom.mapLoader.textContent = message;
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

function markFiltersDirty() {
  STATE.hasPendingFilterChanges = true;
  if (typeof updateApplyButtonText === 'function') {
    updateApplyButtonText();
  }
}

function clearPendingFilterChanges() {
  STATE.hasPendingFilterChanges = false;
  if (typeof updateApplyButtonText === 'function') {
    updateApplyButtonText();
  }
}

function clearZipCache() {
  resetTurnoutReferenceIndexes();
  FEATURE_TURNOUT_CACHE = new WeakMap();
  CURRENT_VISIBLE_FEATURES_CACHE = [];
  CURRENT_VISIBLE_PROPS_CACHE = [];
  // Limpeza profunda de leitores de ZIP
  const readerCount = getCacheSize(ZIP_READERS);
  if (readerCount > 0) {
    console.log(`Cleaning ${readerCount} cached ZIP readers...`);
    forEachCacheEntry(ZIP_READERS, (reader) => {
      // Tenta fechar streams abertos (importante para Blobs/HTTPRange)
      if (reader && typeof reader.close === 'function') {
        try { reader.close(); } catch (e) { console.warn("Erro ao fechar reader:", e); }
      }
    });
    ZIP_READERS.clear();
  }

  // Limpa também detalhes de candidatos que podem ser pesados
  CANDIDATE_DETAILS = null;
  CANDIDATE_DETAILS_PROMISE = null;
  GENERAL_2006_BASE_CACHE.clear();
  CENSO_2006_CACHE.clear();
  GENERAL_2010_BASE_CACHE.clear();
  CENSO_2010_CACHE.clear();
  GENERAL_2014_BASE_CACHE.clear();
  CENSO_2014_CACHE.clear();
  GENERAL_2018_BASE_CACHE.clear();
  CENSO_2018_CACHE.clear();
  MUNICIPAL_2008_BASE_CACHE.clear();
  CENSO_2008_CACHE.clear();
  MUNICIPAL_2012_BASE_CACHE.clear();
  CENSO_2012_CACHE.clear();
  MUNICIPAL_2020_BASE_CACHE.clear();
  CENSO_2020_CACHE.clear();
  MUNICIPAL_2016_BASE_CACHE.clear();
  CENSO_2016_CACHE.clear();
  MUNICIPAL_2024_BASE_CACHE.clear();
  CENSO_2024_CACHE.clear();
  GENERAL_2022_BASE_CACHE.clear();
  CENSO_2022_CACHE.clear();

  if (GPKG_2006_DB_PROMISE) {
    GPKG_2006_DB_PROMISE.then((db) => {
      if (db && typeof db.close === 'function') {
        try { db.close(); } catch (e) { console.warn("Erro ao fechar DB 2006:", e); }
      }
    }).catch(() => { });
    GPKG_2006_DB_PROMISE = null;
  }

  if (GPKG_2010_DB_PROMISE) {
    GPKG_2010_DB_PROMISE.then((db) => {
      if (db && typeof db.close === 'function') {
        try { db.close(); } catch (e) { console.warn("Erro ao fechar DB 2010:", e); }
      }
    }).catch(() => { });
    GPKG_2010_DB_PROMISE = null;
  }

  if (GPKG_2008_DB_PROMISE) {
    GPKG_2008_DB_PROMISE.then((db) => {
      if (db && typeof db.close === 'function') {
        try { db.close(); } catch (e) { console.warn("Erro ao fechar DB 2008:", e); }
      }
    }).catch(() => { });
    GPKG_2008_DB_PROMISE = null;
  }

  if (GPKG_2018_DB_PROMISE) {
    GPKG_2018_DB_PROMISE.then((db) => {
      if (db && typeof db.close === 'function') {
        try { db.close(); } catch (e) { console.warn("Erro ao fechar DB 2018:", e); }
      }
    }).catch(() => { });
    GPKG_2018_DB_PROMISE = null;
  }

  if (GPKG_2014_DB_PROMISE) {
    GPKG_2014_DB_PROMISE.then((db) => {
      if (db && typeof db.close === 'function') {
        try { db.close(); } catch (e) { console.warn("Erro ao fechar DB 2014:", e); }
      }
    }).catch(() => { });
    GPKG_2014_DB_PROMISE = null;
  }

  if (GPKG_2012_DB_PROMISE) {
    GPKG_2012_DB_PROMISE.then((db) => {
      if (db && typeof db.close === 'function') {
        try { db.close(); } catch (e) { console.warn("Erro ao fechar DB 2012:", e); }
      }
    }).catch(() => { });
    GPKG_2012_DB_PROMISE = null;
  }

  if (GPKG_2020_DB_PROMISE) {
    GPKG_2020_DB_PROMISE.then((db) => {
      if (db && typeof db.close === 'function') {
        try { db.close(); } catch (e) { console.warn("Erro ao fechar DB 2020:", e); }
      }
    }).catch(() => { });
    GPKG_2020_DB_PROMISE = null;
  }

  if (GPKG_2016_DB_PROMISE) {
    GPKG_2016_DB_PROMISE.then((db) => {
      if (db && typeof db.close === 'function') {
        try { db.close(); } catch (e) { console.warn("Erro ao fechar DB 2016:", e); }
      }
    }).catch(() => { });
    GPKG_2016_DB_PROMISE = null;
  }

  if (GPKG_2024_DB_PROMISE) {
    GPKG_2024_DB_PROMISE.then((db) => {
      if (db && typeof db.close === 'function') {
        try { db.close(); } catch (e) { console.warn("Erro ao fechar DB 2024:", e); }
      }
    }).catch(() => { });
    GPKG_2024_DB_PROMISE = null;
  }

  if (GPKG_2022_DB_PROMISE) {
    GPKG_2022_DB_PROMISE.then((db) => {
      if (db && typeof db.close === 'function') {
        try { db.close(); } catch (e) { console.warn("Erro ao fechar DB 2022:", e); }
      }
    }).catch(() => { });
    GPKG_2022_DB_PROMISE = null;
  }

  // Força coleta de lixo se possível (indireto)
  console.log("Memory cleanup executed.");
}
let MUNICIPAL_DATA_INDEX = {};
let CANDIDATE_DETAILS = null; // Cache dos detalhes (JSON)
let CANDIDATE_DETAILS_PROMISE = null; // Promise do carregamento



// CORES E PARTIDOS
const PARTY_COLORS = new Map(Object.entries({
  'AVANTE': '#2eacb2', 'CIDADANIA': '#ec008c', 'DC': '#c89721', 'DEM': '#8CC63E',
  'MDB': '#009959', 'MOBILIZA': '#DD3333', 'NOVO': '#ec671c', 'PAN': '#ffff00',
  'PASART': '#0000FF', 'PCB': '#a8231c', 'PCDOB': '#800314', 'PCO': '#9F030A',
  'PDS': '#0067A5', 'PDT': '#FE8E6D', 'PEN': '#4AA561', 'PGT': '#006600',
  'PH': '#FF8511', 'PHS': '#8A191E', 'PJ': '#01369E', 'PL': '#30306C',
  'PMN': '#CF7676', 'PN': '#008000', 'PODE': '#00d663', 'PP': '#3672c9',
  'PPL': '#9ACD32', 'PROS': '#f48c24', 'PRTB': '#245ba0', 'PSB': '#FFCC00',
  'PSC': '#006f41', 'PSD': '#ffa400', 'PSDB': '#0096ff', 'PSL': '#054577',
  'PSOL': '#68018D', 'PST': '#9370DB', 'PSTU': '#c92127', 'PT': '#C0122D',
  'PTB': '#005533', 'PTC': '#01369eff', 'PTN': '#00d663', 'PTR': '#0047AB',
  'PV': '#01652F', 'REDE': '#3ca08c', 'REPUBLICANOS': '#005CA9', 'SOLIDARIEDADE': '#f37021',
  'UNIÃO': '#01f6fe', 'UP': '#000000', 'ARENA': '#4034B2', 'PMDB': '#009959',
  'PRB': '#005CA9', 'PT DO B': '#2eacb2', 'PFL': '#8CC63E', 'PSP46': '#533e40',
  'MISSÃO': '#FCBD27', 'PATRIOTA': '#316635', 'TOSSUP': '#cbd5e1', 'PPS': '#ec008c', 'PR': '#30306C', 'PC DO B': '#b4251d', 'PSDC': '#c89721',
  'PRD': '#007c3c', 'SD': '#f37021', 'PRONA': '#34b233', 'PRP': '#006db8', 'PMB': '#8e2a4e', 'Agir': '#9370db', 'AGIR': '#9370db'
}));

const PARTY_COLOR_OVERRIDES = new Map(Object.entries({
  'AVANTE': '#36aeba',
  'CIDADANIA': '#ec5fa6',
  'DC': '#809eff',
  'DEM': '#6dbf36',
  'MDB': '#16a250',
  'MISSAO': '#fdbe21',
  'NOVO': '#ff6600',
  'PCB': '#c40823',
  'PCDOB': '#b4251d',
  'PC DO B': '#b4251d',
  'PCO': '#8e3d10',
  'PDS': '#6391d4',
  'PDT': '#ffad99',
  'PHS': '#e25850',
  'PL': '#304091',
  'PMN': '#ff3333',
  'PODE': '#23a840',
  'PODEMOS': '#23a840',
  'PP': '#6391d4',
  'PPB': '#6391d4',
  'PPL': '#c6a815',
  'PROS': '#e6661e',
  'PRTB': '#1a7e2f',
  'PSC': '#2f8e4f',
  'PSB': '#edd355',
  'PSD': '#eb8100',
  'PSDB': '#0097fd',
  'PSL': '#5dca53',
  'PSOL': '#e95dd2',
  'PSTU': '#620411',
  'PT': '#ff3859',
  'PTB': '#71def4',
  'PTC': '#37c884',
  'PTN': '#23a840',
  'PTR': '#1a7e2f',
  'PV': '#1f9439',
  'PRP': '#ffe099',
  'PRONA': '#0f6c36',
  'PRD': '#007c3c',
  'PFL': '#6dbf36',
  'PPS': '#ec5fa6',
  'PR': '#304091',
  'PRB': '#45bdc9',
  'REDE': '#7dd1d9',
  'REPUBLICANOS': '#1f646b',
  'SOLIDARIEDADE': '#ff633d',
  'SD': '#ff633d',
  'PATRIOTA': '#5fa72f',
  'PATRI': '#5fa72f',
  'PMDB': '#16a250',
  'PMB': '#384ba8',
  'PSDC': '#809eff',
  'AGIR': '#254d88',
  'UNIAO': '#2eccff',
  'UNIAO BRASIL': '#2eccff',
  'UP': '#5e5e5e',
  'OUTROS': '#7a8699'
}));

const CUSTOM_PARTY_COLORS = new Map();
const CUSTOM_CANDIDATE_COLORS = new Map();

function getNormalizedPartyColorKey(partido) {
  let cleanParty = String(partido || '').trim().toUpperCase();
  if (!cleanParty) return '';
  cleanParty = cleanParty.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  cleanParty = cleanParty.replace(/\s+/g, ' ').trim();
  cleanParty = cleanParty.replace(/^FEDERACAO /, '');

  if (cleanParty === 'PATRI') return 'PATRIOTA';
  if (cleanParty === 'PODE') return 'PODEMOS';
  if (cleanParty === 'SD') return 'SOLIDARIEDADE';
  if (cleanParty === 'PC DO B') return 'PCDOB';

  return cleanParty;
}

function getFederationColorPartyKey(partido) {
  const raw = String(partido || '').trim();
  if (!raw) return '';

  const normalizedRaw = raw
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (normalizedRaw.includes('BRASIL DA ESPERANCA')) return 'PT';
  if (normalizedRaw.includes('PSOL/REDE') || normalizedRaw.includes('PSOL REDE')) return 'PSOL';
  if (normalizedRaw.includes('PSDB/CIDADANIA') || normalizedRaw.includes('PSDB CIDADANIA')) return 'PSDB';

  const compositionSource = (() => {
    const matches = Array.from(normalizedRaw.matchAll(/\(([^()]+)\)/g))
      .map((match) => String(match[1] || '').trim())
      .filter((value) => value.includes('/'));
    if (matches.length) return matches[matches.length - 1];
    return normalizedRaw.includes('/') ? normalizedRaw : '';
  })();

  if (!compositionSource) return '';

  const normalizedParts = compositionSource
    .split('/')
    .map((part) => {
      let token = part.trim();
      token = token.replace(/^FEDERACAO\s+/, '');
      token = token.replace(/^COLIGACAO\s+/, '');
      return getNormalizedPartyColorKey(token);
    })
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const signature = normalizedParts.join('/');
  if (signature === 'PCDOB/PT/PV') return 'PT';
  if (signature === 'PSOL/REDE') return 'PSOL';
  if (signature === 'CIDADANIA/PSDB') return 'PSDB';
  return '';
}

function getProportionalListColorKey(groupName, composition, dominantParty = '') {
  return getFederationColorPartyKey(groupName)
    || getFederationColorPartyKey(composition)
    || getNormalizedPartyColorKey(dominantParty)
    || getNormalizedPartyColorKey(composition)
    || getNormalizedPartyColorKey(groupName);
}

function getResolvedPartyColor(partido) {
  const cleanParty = getFederationColorPartyKey(partido) || getNormalizedPartyColorKey(partido);
  return CUSTOM_PARTY_COLORS.get(cleanParty)
    || PARTY_COLOR_OVERRIDES.get(cleanParty)
    || PARTY_COLORS.get(cleanParty)
    || DEFAULT_SWATCH;
}

function getColorForCandidate(nome, partido) {
  if (CUSTOM_CANDIDATE_COLORS.has(nome)) {
    return CUSTOM_CANDIDATE_COLORS.get(nome);
  }
  return getResolvedPartyColor(partido);
}

const DEFAULT_SWATCH = "#7a8699";

const UF_MAP = new Map([
  ['AC', 'Acre'], ['AL', 'Alagoas'], ['AP', 'Amapá'],
  ['AM', 'Amazonas'], ['BA', 'Bahia'], ['CE', 'Ceará'], ['DF', 'Distrito Federal'],
  ['ES', 'Espírito Santo'], ['GO', 'Goiás'], ['MA', 'Maranhão'], ['MT', 'Mato Grosso'],
  ['MS', 'Mato Grosso do Sul'], ['MG', 'Minas Gerais'], ['PA', 'Pará'], ['PB', 'Paraíba'],
  ['PR', 'Paraná'], ['PE', 'Pernambuco'], ['PI', 'Piauí'], ['RJ', 'Rio de Janeiro'],
  ['RN', 'Rio Grande do Norte'], ['RS', 'Rio Grande do Sul'], ['RO', 'Rondônia'],
  ['RR', 'Roraima'], ['SC', 'Santa Catarina'], ['SP', 'São Paulo'], ['SE', 'Sergipe'],
  ['TO', 'Tocantins']
]);
const ALL_STATE_SIGLAS = Array.from(UF_MAP.keys()).filter(k => k !== 'BR');

const MAP_TILES = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
};

// ====== STATE ======
let map, currentLayer, mapCanvasRenderer;
let allDataCache = new Map();
let currentDataCollection = {};
let currentDataCollection_2022 = {};
let selectedLocationIDs = new Set();
let currentTurno = 1;
let currentCargo = 'presidente_ord';
let currentOffice = 'presidente'; // 'presidente', 'governador', 'senador', 'deputado', 'prefeito'
let currentSubType = 'ord'; // 'ord' (Federal/Ord) or 'est' (Estadual) or 'sup'

let currentVizMode = 'vencedor';
// Cache: nome_upper → id, rebuilt when cargo/data changes
let deputyNameToIdCache = {};

function getDeputyIdByName(nome) {
  const key = nome.toUpperCase().trim();
  if (deputyNameToIdCache[key] !== undefined) return deputyNameToIdCache[key] || null;
  // Build cache on first miss
  deputyNameToIdCache = {};
  for (const [id, meta] of Object.entries(STATE.deputyMetadata || {})) {
    if (meta[0]) deputyNameToIdCache[meta[0].toUpperCase().trim()] = id;
  }
  return deputyNameToIdCache[key] || null;
}

let currentVizSize = 'comparecimento';
let currentVizColorStyle = 'gradient'; // 'static' or 'gradient'

// Estatísticas do candidato para modo Desempenho (calculadas ao mudar candidato)
let performanceModeStats = {
  candidato: null,
  minPct: 0,
  maxPct: 0,
  avgPct: 0,
  totalLocais: 0
};
// Filtro de porcentagem mínima para modo Desempenho
let performanceFilterMinPct = 0;
let currentMesorregiaoFilter = 'all';
let currentMicrorregiaoFilter = 'all';
let currentCidadeFilter = 'all';
let currentBairroFilter = 'all';
let currentLocalFilter = '';
let autoLoadTimer = null;
let autoLoadSequence = 0;
let autoLoadRunningSequence = 0;
let pendingMapViewportRestore = null;

function rememberMapViewportForNextLoad(force = false) {
  if (!map || typeof map.getCenter !== 'function' || typeof map.getZoom !== 'function') return;
  const zoom = map.getZoom();
  if (!force && zoom <= 7) return;

  const center = map.getCenter();
  if (!center) return;

  pendingMapViewportRestore = {
    center: { lat: center.lat, lng: center.lng },
    zoom
  };
}

function applyMapViewportAfterDataLoad(bounds, fitBoundsOptions = { animate: false, padding: [20, 20] }) {
  if (!map) return;

  const pending = pendingMapViewportRestore;
  pendingMapViewportRestore = null;

  if (pending?.center && Number.isFinite(pending.zoom)) {
    const nextCenter = L.latLng(pending.center.lat, pending.center.lng);
    if (!bounds || !bounds.isValid || !bounds.isValid() || bounds.contains(nextCenter)) {
      map.setView(nextCenter, pending.zoom, { animate: false });
      return;
    }
  }

  if (bounds?.isValid?.()) {
    map.fitBounds(bounds, fitBoundsOptions);
  }
}

const STATE = {
  mapTileLayer: null,
  autoLoadEnabled: false,
  hasPendingFilterChanges: false,
  isLoadingDataset: false,
  filterInaptos: false,
  isFilterAggregationActive: false,
  dataHas2T: {},
  dataHasInaptos: {},
  candidates: {},
  metrics: {},
  inaptos: {},
  currentElectionYear: '2022',
  currentElectionType: 'geral', // 'geral' ou 'municipal'
  spatialIndex2022: {
    presidente: null,
    governador: null,
    senador: null
  },
  currentMapMode: 'locais',
  currentMapMuniUF: null,
  currentMapMuniSummary: null,
  currentMapMuniSummaryByTurn: null,
  municipiosLayer: null,
  currentMuniCode: null,
  generalOfficialTotals: {},
  generalOfficialTotalsByCity: {},
  municipalOfficialTotals: {},
  censusFilters: {
    rendaMin: null,
    rendaMax: null,

    // Raça
    racaVal: null,
    racaMode: 'Pct Preta',

    // Idade
    idadeVal: null,
    idadeMode: '16-29',

    // Gênero
    generoVal: null,
    generoMode: 'Pct Mulheres',

    // Escolaridade (Novo)
    escolaridadeVal: null,
    escolaridadeMode: 'Superior Completo',

    // Estado Civil (Novo)
    estadoCivilVal: null,
    estadoCivilMode: 'Solteiro',

    // Saneamento
    saneamentoVal: null,
    saneamentoMode: 'Pct Esgoto Inadequado'
  }
};

if (typeof window !== 'undefined') {
  window.rememberMapViewportForNextLoad = rememberMapViewportForNextLoad;
  window.applyMapViewportAfterDataLoad = applyMapViewportAfterDataLoad;
}

let uniqueCidades = new Set();
let uniqueBairros = new Set();
let dom = {};
let REGIONAL_FILTERS_PROMISE = null;
let REGIONAL_FILTERS_INDEX = {
  mesoByUf: new Map(),
  microByUf: new Map()
};

function getCurrentGeneralRegionalUF() {
  const uf = String(dom.selectUFGeneral?.value || '').toUpperCase();
  return (STATE.currentElectionType === 'geral' && uf && uf !== 'BR') ? uf : '';
}

function getFeatureMunicipioIdentity(props) {
  return {
    code: String(
      getProp(props, 'cod_localidade_ibge')
      || getProp(props, 'codigo_ibge')
      || getProp(props, 'COD_LOCALIDADE_IBGE')
      || ''
    ).trim(),
    slug: normalizeMunicipioSlug(getProp(props, 'nm_localidade'))
  };
}

function buildRegionalFilterIndex(rawByUf = {}) {
  const index = new Map();
  Object.entries(rawByUf || {}).forEach(([uf, regions]) => {
    const regionEntries = [];
    Object.entries(regions || {}).forEach(([regionName, municipios]) => {
      const municipioCodes = new Set();
      const municipioSlugs = new Set();
      (municipios || []).forEach((municipio) => {
        const code = String(municipio?.codigo_ibge || '').trim();
        const slug = normalizeMunicipioSlug(municipio?.nome_municipio);
        if (code) municipioCodes.add(code);
        if (slug) municipioSlugs.add(slug);
      });
      regionEntries.push({
        label: regionName,
        key: norm(regionName),
        municipioCodes,
        municipioSlugs
      });
    });
    index.set(String(uf || '').toUpperCase(), regionEntries.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')));
  });
  return index;
}

async function ensureRegionalFiltersLoaded() {
  if (REGIONAL_FILTERS_INDEX.mesoByUf.size && REGIONAL_FILTERS_INDEX.microByUf.size) return REGIONAL_FILTERS_INDEX;
  if (REGIONAL_FILTERS_PROMISE) return REGIONAL_FILTERS_PROMISE;

  REGIONAL_FILTERS_PROMISE = Promise.all([
    fetch('resultados_geo/municipios_por_mesorregiao.json').then((res) => {
      if (!res.ok) throw new Error('Falha ao carregar mesorregiões');
      return res.json();
    }),
    fetch('resultados_geo/municipios_por_microrregiao.json').then((res) => {
      if (!res.ok) throw new Error('Falha ao carregar microrregiões');
      return res.json();
    })
  ]).then(([mesoJson, microJson]) => {
    REGIONAL_FILTERS_INDEX = {
      mesoByUf: buildRegionalFilterIndex(mesoJson),
      microByUf: buildRegionalFilterIndex(microJson)
    };
    return REGIONAL_FILTERS_INDEX;
  });

  return REGIONAL_FILTERS_PROMISE;
}

function getRegionalEntries(kind, uf = getCurrentGeneralRegionalUF()) {
  const source = kind === 'micro' ? REGIONAL_FILTERS_INDEX.microByUf : REGIONAL_FILTERS_INDEX.mesoByUf;
  return source.get(String(uf || '').toUpperCase()) || [];
}

function getSelectedRegionalEntry(kind, uf = getCurrentGeneralRegionalUF()) {
  const filterValue = kind === 'micro' ? currentMicrorregiaoFilter : currentMesorregiaoFilter;
  if (filterValue === 'all') return null;
  return getRegionalEntries(kind, uf).find((entry) => entry.label === filterValue || entry.key === norm(filterValue)) || null;
}

function hasRegionalScopeFilters() {
  return currentMesorregiaoFilter !== 'all' || currentMicrorregiaoFilter !== 'all';
}

function matchesRegionalScope(props) {
  if (STATE.currentElectionType !== 'geral') return true;
  if (!hasRegionalScopeFilters()) return true;
  const uf = getCurrentGeneralRegionalUF();
  if (!uf) return false;

  const { code, slug } = getFeatureMunicipioIdentity(props);
  const mesoEntry = getSelectedRegionalEntry('meso', uf);
  if (mesoEntry) {
    const matchMeso = (code && mesoEntry.municipioCodes.has(code)) || (slug && mesoEntry.municipioSlugs.has(slug));
    if (!matchMeso) return false;
  }
  const microEntry = getSelectedRegionalEntry('micro', uf);
  if (microEntry) {
    const matchMicro = (code && microEntry.municipioCodes.has(code)) || (slug && microEntry.municipioSlugs.has(slug));
    if (!matchMicro) return false;
  }
  return true;
}

function matchesLocationFilters(props, options = {}) {
  const { ignoreCidade = false, ignoreBairro = false, ignoreLocal = false } = options;
  if (!matchesRegionalScope(props)) return false;
  if (!ignoreCidade && STATE.currentElectionType === 'geral' && currentCidadeFilter !== 'all') {
    const cityName = String(getProp(props, 'nm_localidade') || '').trim();
    const selectedCity = String(currentCidadeFilter || '').trim();
    const sameCity = cityName === selectedCity
      || normalizeMunicipioSlug(cityName) === normalizeMunicipioSlug(selectedCity)
      || (typeof matchesMunicipioName === 'function' && matchesMunicipioName(selectedCity, cityName));
    if (!sameCity) return false;
  }
  if (!ignoreBairro && currentBairroFilter !== 'all') {
    const bairro = getProp(props, 'ds_bairro');
    if (!bairro || bairro.trim() !== currentBairroFilter) return false;
  }
  if (!ignoreLocal) {
    const searchTxt = currentLocalFilter.trim();
    if (searchTxt.length > 2) {
      const nomeLocal = norm(getProp(props, 'nm_locvot'));
      if (!nomeLocal.includes(searchTxt)) return false;
    }
  }
  return true;
}

function getRegionalFilterSummaryLabel() {
  const parts = [];
  if (currentMesorregiaoFilter !== 'all') parts.push(`Mesorregião ${currentMesorregiaoFilter}`);
  if (currentMicrorregiaoFilter !== 'all') parts.push(`Microrregião ${currentMicrorregiaoFilter}`);
  return parts.join(' • ');
}

// ====== MULTI-SELECTION GLOBALS ======
let isSelectorsActive = false;
let startSelectionPoint = null;
let selectionBoxElement = null; // DOM Element for the box
let isDragSelection = false; // Flag to track if last selection was drag

// ====== FUNÇÃO DE LIMPEZA COMPLETA DE DEPUTADOS ======
function clearDeputyData() {
  STATE.deputyResults = {};
  STATE.deputyMetadata = {};
  STATE.deputyMetadataByType = { f: {}, e: {} };
  STATE.deputyAdjustments = {};
  STATE.deputyAdjustmentsByType = { f: {}, e: {} };
  STATE.deputyCache = {};
  STATE.deputyLookup = null;
  STATE.deputyLookupCargo = null;
  STATE._partyPrefixCache = null; // Invalidate party prefix cache
  loadedDeputyState = { uf: null, types: new Set(), year: null };

  console.log('✓ Dados de deputados completamente limpos');
}

function ensureDeputyTypeStores() {
  if (!STATE.deputyMetadataByType) STATE.deputyMetadataByType = { f: {}, e: {} };
  if (!STATE.deputyAdjustmentsByType) STATE.deputyAdjustmentsByType = { f: {}, e: {} };
}

function getDeputyTypeKeyForCargo(cargo = currentCargo) {
  return String(cargo || '').includes('estadual') ? 'e' : 'f';
}

function syncDeputyDataForCargo(cargo = currentCargo) {
  ensureDeputyTypeStores();
  const typeKey = getDeputyTypeKeyForCargo(cargo);
  STATE.deputyMetadata = STATE.deputyMetadataByType[typeKey] || {};
  STATE.deputyAdjustments = STATE.deputyAdjustmentsByType[typeKey] || {};
  STATE._partyPrefixCache = null;
  deputyNameToIdCache = {};
  return typeKey;
}

// ====== ESTADO E LIMPEZA DE VEREADORES ======
// Estrutura paralela à de deputados, mas chaveada por município
// STATE.vereadorResults[zona_local]  = { v: { candId: votes } }
// STATE.vereadorMetadata             = { candId: [nome, partido, status, colig, comp] }
// STATE.vereadorAdjustments          = { norm_comp: diff }
let loadedVereadorState = { uf: null, muniCode: null, year: null };

function clearVereadorData() {
  STATE.vereadorResults = {};
  STATE.vereadorMetadata = {};
  STATE.vereadorAdjustments = {};
  STATE.vereadorLookup = null;
  STATE._vereadorPartyPrefixCache = null;
  loadedVereadorState = { uf: null, muniCode: null, year: null };
  console.log('✓ Dados de vereadores completamente limpos');
}
