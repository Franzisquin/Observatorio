
const DATA_BASE_URL = 'resultados_geo/';

let ZIP_INDEX = null;
let ZIP_READERS = new Map(); // Cache for ZipReaders
let MUNICIPAL_DATA_INDEX = {};

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
  'PRD': '#007c3c', 'SD': '#f37021', 'PRONA': '#34b233', 'PRP': '#006db8', 'PMB': '#8e2a4e', 'Agir': '#9370db'
}));

const CUSTOM_CANDIDATE_COLORS = new Map();

function getColorForCandidate(nome, partido) {
  if (CUSTOM_CANDIDATE_COLORS.has(nome)) {
    return CUSTOM_CANDIDATE_COLORS.get(nome);
  }
  return PARTY_COLORS.get((partido || '').toUpperCase()) || DEFAULT_SWATCH;
}

const DEFAULT_SWATCH = "#7a8699";

const UF_MAP = new Map([
  ['BR', 'Brasil (Nacional)'], ['AC', 'Acre'], ['AL', 'Alagoas'], ['AP', 'Amapá'],
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
let currentOffice = 'presidente';
let currentSubType = 'ord';
let currentVizMode = 'vencedor';
let currentVizSize = 'fixo';
let currentVizColorStyle = 'static'; // 'static' or 'gradient'
let currentCidadeFilter = 'all';
let currentBairroFilter = 'all';
let currentLocalFilter = '';

const STATE = {
  mapTileLayer: null,
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
  censusFilters: {
    rendaMin: null,
    rendaMax: null,

    // Raça
    racaVal: null,
    racaMode: 'Pct Preta',

    // Idade
    idadeVal: null,
    idadeMode: 'Idosos (60+)',

    // Gênero
    generoVal: null,
    generoMode: 'Pct Mulheres',

    // Saneamento
    saneamentoVal: null,
    saneamentoMode: 'Pct Esgoto Inadequado'
  }
};

let uniqueCidades = new Set();
let uniqueBairros = new Set();
let dom = {};

// ====== UTILS ======
function getProp(properties, key) {
  if (!properties) return null;
  if (properties[key] !== undefined) return properties[key];
  const lowerKey = String(key).toLowerCase();
  if (properties[lowerKey] !== undefined) return properties[lowerKey];
  const upperKey = String(key).toUpperCase();
  if (properties[upperKey] !== undefined) return properties[upperKey];
  for (const k in properties) {
    if (String(k).toLowerCase() === lowerKey) return properties[k];
  }
  return null;
}
const norm = s => (s || "").normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/'/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
function colorForParty(sg) { return PARTY_COLORS.get((sg || '').toUpperCase()) || DEFAULT_SWATCH; }
function fmtPct(x) { return isFinite(x) ? (x * 100).toFixed(2).replace('.', ',') + "%" : "-"; }
function fmtInt(n) { return (n || 0).toLocaleString('pt-BR'); }
function ensureNumber(v) {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v !== 'string') v = String(v || 0);
  const n = Number(v.replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

// --- COLOR UTILS (UNIVERSAL GRADIENT) ---
function hexToHSL(H) {
  // Convert hex to RGB first
  let r = 0, g = 0, b = 0;
  if (H.length == 4) {
    r = "0x" + H[1] + H[1];
    g = "0x" + H[2] + H[2];
    b = "0x" + H[3] + H[3];
  } else if (H.length == 7) {
    r = "0x" + H[1] + H[2];
    g = "0x" + H[3] + H[4];
    b = "0x" + H[5] + H[6];
  }
  // Then to HSL
  r /= 255; g /= 255; b /= 255;
  let cmin = Math.min(r, g, b),
    cmax = Math.max(r, g, b),
    delta = cmax - cmin,
    h = 0,
    s = 0,
    l = 0;

  if (delta == 0) h = 0;
  else if (cmax == r) h = ((g - b) / delta) % 6;
  else if (cmax == g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;

  h = Math.round(h * 60);
  if (h < 0) h += 360;

  l = (cmax + cmin) / 2;
  s = delta == 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  s = +(s * 100).toFixed(1);
  l = +(l * 100).toFixed(1);

  return { h, s, l };
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;

  let c = (1 - Math.abs(2 * l - 1)) * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = l - c / 2,
    r = 0,
    g = 0,
    b = 0;

  if (0 <= h && h < 60) { r = c; g = x; b = 0; }
  else if (60 <= h && h < 120) { r = x; g = c; b = 0; }
  else if (120 <= h && h < 180) { r = 0; g = c; b = x; }
  else if (180 <= h && h < 240) { r = 0; g = x; b = c; }
  else if (240 <= h && h < 300) { r = x; g = 0; b = c; }
  else if (300 <= h && h < 360) { r = c; g = 0; b = x; }

  r = Math.round((r + m) * 255).toString(16);
  g = Math.round((g + m) * 255).toString(16);
  b = Math.round((b + m) * 255).toString(16);

  if (r.length == 1) r = "0" + r;
  if (g.length == 1) g = "0" + g;
  if (b.length == 1) b = "0" + b;

  return "#" + r + g + b;
}

function getUniversalGradientColor(baseColorHex, pct) {
  // pct is 0 to 100
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;

  const hsl = hexToHSL(baseColorHex);

  // Universal 9-step gradient
  // Standard (Light Mode): 10% (L=90) -> 100% (L=15) [Darker is stronger]
  // Dark Mode: 10% (L=15?) -> 100% (L=90) [Lighter is stronger]

  // We determine the "Index" of intensity (0 to 9)
  let idx = Math.floor(pct / 10);
  if (idx > 9) idx = 9;

  // Base Luminosity Map (Decreasing L for higher intensity)
  // This works well on White Background (Ink metaphor)
  const lMap = [90, 80, 70, 60, 50, 40, 30, 20, 15, 10];

  let targetL;

  targetL = lMap[idx];

  return hslToHex(hsl.h, hsl.s, targetL);
}

function debounce(func, timeout = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { func.apply(this, args); }, timeout);
  };
}

function parseCandidateKey(key) {
  const result = { nome: 'N/D', partido: 'N/D', status: 'N/D', key: key };
  const turnoMatch = key.match(/ (1T|2T)$/);
  const coreKey = key.replace(/ (1T|2T)$/, '');

  const statusMatches = Array.from(coreKey.matchAll(/\((.*?)\)/g));

  if (statusMatches.length === 0) {
    result.nome = coreKey;
    return result;
  }

  const partidoMatch = statusMatches[0];
  result.partido = partidoMatch[1];
  result.nome = coreKey.substring(0, partidoMatch.index).trim();

  const allStatus = statusMatches.slice(1).map(m => m[1].toUpperCase());

  if (allStatus.includes('INAPTO')) {
    result.status = 'INAPTO';
  } else if (allStatus.includes('2° TURNO') || allStatus.includes('2º TURNO')) {
    result.status = '2° TURNO';
  } else if (allStatus.some(s => s.startsWith('ELEITO'))) {
    result.status = 'ELEITO';
  } else if (allStatus.includes('NÃO ELEITO')) {
    result.status = 'NÃO ELEITO';
  } else if (allStatus.length > 0) {
    result.status = allStatus[0];
  }

  return result;
}

// ====== INIT & CONTROLS ======
window.addEventListener('DOMContentLoaded', init);

async function loadMunicipalIndex() {
  try {
    const response = await fetch('lista_municipios.json');
    if (!response.ok) throw new Error("Não encontrei o arquivo lista_municipios.json");
    MUNICIPAL_DATA_INDEX = await response.json();
  } catch (e) {
    console.error(e);
    alert("ATENÇÃO: Para ver os municípios (exceto 2022 Geral), é ideal ter o 'lista_municipios.json' gerado.");
  }
}

async function init() {
  document.body.dataset.theme = 'dark';
  mapCanvasRenderer = L.canvas({ padding: 0.5, tolerance: 10 });

  await loadMunicipalIndex();

  dom.mapLoader = document.getElementById('mapLoader');
  dom.btnLoadData = document.getElementById('btnLoadData');
  dom.mapLoader = document.getElementById('mapLoader');
  dom.btnLoadData = document.getElementById('btnLoadData');
  dom.themeToggle = document.getElementById('themeToggle');
  dom.themeToggle.addEventListener('click', () => {
    // Toggle logic handled by inline script or simple handler, but we must redraw map
    const isDark = document.body.dataset.theme === 'dark';
    document.body.dataset.theme = isDark ? 'light' : 'dark';
    dom.themeToggle.textContent = isDark ? '☀️' : '🌙'; // Swap icon

    // Update Tile Layer
    if (STATE.mapTileLayer) {
      STATE.mapTileLayer.setUrl(isDark ? MAP_TILES.light : MAP_TILES.dark);
      // Note: isDark was the OLD state, so if it WAS dark, we are now Light -> MAP_TILES.light
    }
    applyFiltersAndRedraw();
  });

  dom.electionChips = document.getElementById('electionChips');
  dom.loaderBoxGeneral = document.getElementById('loaderBoxGeneral');
  dom.loaderBoxMunicipal = document.getElementById('loaderBoxMunicipal');

  dom.cargoChipsGeneral = document.getElementById('cargoChipsGeneral');
  dom.selectUFGeneral = document.getElementById('selectUFGeneral');

  dom.selectUFMunicipal = document.getElementById('selectUFMunicipal');
  dom.selectMunicipio = document.getElementById('selectMunicipio');
  dom.searchMunicipio = document.getElementById('searchMunicipio');
  dom.cargoBoxMunicipal = document.getElementById('cargoBoxMunicipal'); // Agora usado para tipo de eleição (Ord/Sup)
  dom.cargoChipsMunicipal = document.getElementById('cargoChipsMunicipal'); // Chips de tipo

  dom.filterBox = document.getElementById('filterBox');

  // Combobox DOM
  dom.boxCidade = document.getElementById('boxCidade');
  dom.inputCidade = document.getElementById('inputCidade');
  dom.listCidade = document.getElementById('listCidade');

  dom.boxBairro = document.getElementById('boxBairro');
  dom.inputBairro = document.getElementById('inputBairro');
  dom.listBairro = document.getElementById('listBairro');

  dom.searchLocal = document.getElementById('searchLocal');
  dom.btnApplyFilters = document.getElementById('btnApplyFilters');
  dom.btnToggleInaptos = document.getElementById('btnToggleInaptos');

  dom.vizBox = document.getElementById('vizBox');
  dom.vizCandidatoBox = document.getElementById('vizCandidatoBox');
  dom.selectVizCandidato = document.getElementById('selectVizCandidato');
  dom.selectVizSize = document.getElementById('selectVizSize');
  dom.selectVizColorStyle = document.getElementById('selectVizColorStyle'); // NEW
  dom.vizModeChips = document.getElementById('vizModeChips');

  dom.resultsBox = document.getElementById('resultsBox');
  dom.resultsTitle = document.getElementById('resultsTitle');
  dom.resultsSubtitle = document.getElementById('resultsSubtitle');
  dom.btnClearSelection = document.getElementById('btnClearSelection');
  dom.turnTabs = document.getElementById('turnTabs');
  dom.resultsContent = document.getElementById('resultsContent');
  dom.resultsMetrics = document.getElementById('resultsMetrics');
  dom.summaryBoxContainer = document.getElementById('summaryBoxContainer');
  dom.summaryGrid = document.getElementById('summaryGrid');

  dom.unifiedResultsContainer = document.getElementById('unifiedResultsContainer');

  // Census DOM (updated)
  dom.neighborhoodProfile = document.getElementById('neighborhoodProfile');
  dom.profileRendaVal = document.getElementById('profileRendaVal');
  dom.profileRacaChart = document.getElementById('profileRacaChart');
  dom.profileIdadeChart = document.getElementById('profileIdadeChart');
  dom.profileSaneamentoChart = document.getElementById('profileSaneamentoChart');
  dom.profileAlfabetizacaoBar = document.getElementById('profileAlfabetizacaoBar');
  dom.profileAlfabetizacaoVal = document.getElementById('profileAlfabetizacaoVal');
  dom.profileGeneroChart = document.getElementById('profileGeneroChart');

  // Census Filters DOM

  // Census Filters DOM
  // Census Filters DOM - CLEANUP: Removing references to old ID elements that were replaced by Tabs/Sliders
  // dom.filterRendaMin, etc. are now handled dynamically or inside setupSliders

  map = L.map('map', { zoomControl: false, minZoom: 4 }).setView([-15, -55], 4);

  STATE.mapTileLayer = L.tileLayer(MAP_TILES.dark, {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    subdomains: 'abcd', maxZoom: 20
  }).addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  try {
    setupControls();
  } catch (e) {
    console.error("Error in setupControls:", e);
  }

  try {
    setupTabs();
  } catch (e) {
    console.error("Error in setupTabs:", e);
  }

  try {
    setupSliders();
  } catch (e) {
    console.error("Error in setupSliders:", e);
  }

  console.log("App Initialized. Tabs and Sliders setup complete.");
}

function setupControls() {
  // Popular UF Geral
  dom.selectUFGeneral.innerHTML = '<option value="" disabled selected>Selecione UF</option>';
  UF_MAP.forEach((nome, sigla) => {
    const opt = document.createElement('option');
    opt.value = sigla;
    opt.textContent = (sigla === 'BR') ? nome : `${nome} (${sigla})`;
    dom.selectUFGeneral.appendChild(opt);
  });

  // Popular UF Municipal
  dom.selectUFMunicipal.innerHTML = '<option value="" disabled selected>Selecione UF</option>';
  ALL_STATE_SIGLAS.forEach(sigla => {
    const nome = UF_MAP.get(sigla) || sigla;
    const opt = document.createElement('option');
    opt.value = sigla;
    opt.textContent = `${nome} (${sigla})`;
    dom.selectUFMunicipal.appendChild(opt);
  });

  const updateLoadButtonState = () => {
    let disabled = true;
    if (STATE.currentElectionType === 'geral') {
      const uf = dom.selectUFGeneral.value;
      const cargo = currentOffice;
      disabled = !(cargo === 'presidente' || (uf && uf !== 'BR'));
      if (cargo === 'presidente' && uf === '') dom.selectUFGeneral.value = 'BR';
      if (cargo !== 'presidente' && uf === 'BR') dom.selectUFGeneral.value = '';
    } else {
      const uf = dom.selectUFMunicipal.value;
      const municipio = dom.selectMunicipio.value;
      disabled = !(uf && municipio);
    }
    dom.btnLoadData.disabled = disabled;
  };

  // MUDANÇA DE ELEIÇÃO (ANO/TIPO)
  dom.electionChips.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip-button');
    if (!btn) return;

    STATE.currentElectionYear = btn.dataset.value;
    STATE.currentElectionType = btn.dataset.type;

    dom.electionChips.querySelectorAll('.chip-button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // --- FIX: LIMPEZA DE MEMÓRIA PESADA ---
    allDataCache.clear();
    // Limpar camadas do mapa
    if (map) {
      map.eachLayer((layer) => {
        if (layer !== STATE.mapTileLayer) map.removeLayer(layer);
      });
    }
    currentLayer = null;
    // ---------------------------------------

    clearSelection(true);
    currentDataCollection = {};
    currentDataCollection_2022 = {};
    STATE.spatialIndex2022 = { presidente: null, governador: null, senador: null };

    [dom.filterBox, dom.vizBox, dom.resultsBox, dom.summaryBoxContainer].forEach(el => el.classList.add('section-hidden'));

    if (STATE.currentElectionType === 'geral') {
      dom.loaderBoxGeneral.classList.remove('section-hidden');
      dom.loaderBoxMunicipal.classList.add('section-hidden');
      currentOffice = dom.cargoChipsGeneral.querySelector('.active').dataset.value;
      currentSubType = 'ord';
      currentCargo = `${currentOffice}_ord`;
      dom.cargoBoxMunicipal.classList.add('section-hidden');
      dom.summaryBoxContainer.classList.add('section-hidden');
    } else {
      dom.loaderBoxGeneral.classList.add('section-hidden');
      dom.loaderBoxMunicipal.classList.remove('section-hidden');
      currentOffice = 'prefeito';
      currentSubType = 'ord';
      currentCargo = 'prefeito_ord';
      dom.summaryBoxContainer.classList.remove('section-hidden');
    }
    updateLoadButtonState();
  });

  // BOTÃO CARREGAR
  dom.btnLoadData.addEventListener('click', () => {
    if (STATE.currentElectionType === 'geral') {
      onClickLoadData_General();
    } else {
      onClickLoadData_Municipal();
    }
  });

  // CHIPS CARGO GERAL (Presidente, Governador, Senador)
  dom.cargoChipsGeneral.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip-button');
    if (!btn) return;

    if (btn.dataset.value === currentOffice) return;

    // Atualiza UI
    dom.cargoChipsGeneral.querySelectorAll('.chip-button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Atualiza Estado
    currentOffice = btn.dataset.value;
    currentSubType = 'ord'; // Reseta para ordinária ao trocar cargo
    currentCargo = `${currentOffice}_${currentSubType}`;

    // Verifica se temos os dados na memória (carregados no passo anterior)
    if (currentDataCollection[currentCargo] || currentDataCollection[`${currentOffice}_sup`]) {
      // Apenas atualiza a interface, sem loading
      updateElectionTypeUI();
      populateCidadeDropdown();
      if (currentCidadeFilter !== 'all') populateBairroDropdown();
      updateConditionalUI();
      applyFiltersAndRedraw();
      updateSelectionUI(STATE.isFilterAggregationActive);
    } else {
      // Se por acaso os dados não estiverem lá (ex: usuário trocou de BR para Estado sem carregar), forçamos load
      // Mas no fluxo normal de "Selecionar Estado -> Carregar", isso não acontece.
      if (!dom.btnLoadData.disabled && !dom.loaderBoxGeneral.classList.contains('section-hidden')) {
        onClickLoadData_General();
      }
    }

    updateLoadButtonState();
  });
  dom.selectUFGeneral.addEventListener('change', updateLoadButtonState);

  // SELEÇÃO MUNICIPAL
  dom.selectUFMunicipal.addEventListener('change', () => {
    const uf = dom.selectUFMunicipal.value;
    const municipios = MUNICIPAL_DATA_INDEX[uf] || [];

    dom.selectMunicipio.innerHTML = '<option value="" disabled selected>Selecione Município</option>';
    municipios.sort((a, b) => a.localeCompare(b, 'pt-BR')).forEach(nome => {
      const opt = document.createElement('option');
      opt.value = nome;
      opt.textContent = nome;
      dom.selectMunicipio.appendChild(opt);
    });

    const hasMunis = municipios.length > 0;
    dom.selectMunicipio.disabled = !hasMunis;
    dom.searchMunicipio.disabled = !hasMunis;
    dom.searchMunicipio.value = '';

    if (!hasMunis && uf) {
      dom.selectMunicipio.innerHTML = '<option value="" disabled selected>Dados não indexados</option>';
    }
    updateLoadButtonState();
  });
  dom.selectMunicipio.addEventListener('change', updateLoadButtonState);



  // FILTROS
  // INIT COMBOBOXES
  cidadeCombobox = createCombobox({
    box: dom.boxCidade,
    input: dom.inputCidade,
    list: dom.listCidade
  }, (val) => {
    // Ao selecionar Cidade
    currentCidadeFilter = val; // val será 'all' ou o nome da cidade
    currentBairroFilter = 'all';

    // Reset da lógica de bairros
    populateBairroDropdown();

    // Se escolheu 'all', desativa a busca por local específico (muito pesado para o estado todo)
    // Se escolheu uma cidade, libera a busca por local
    dom.searchLocal.disabled = (STATE.currentElectionType === 'geral' && currentCidadeFilter === 'all');

    clearSelection(false);
    applyFiltersAndRedraw();

    // CORREÇÃO: Chama a nova função de texto que libera o botão
    updateApplyButtonText();
  });

  bairroCombobox = createCombobox({
    box: dom.boxBairro,
    input: dom.inputBairro,
    list: dom.listBairro
  }, (val) => {
    currentBairroFilter = val;
    clearSelection(false);
    applyFiltersAndRedraw();
    updateApplyButtonText();
  });

  const debouncedRedraw = debounce(() => applyFiltersAndRedraw(), 250);
  dom.searchLocal.addEventListener('keyup', (e) => {
    currentLocalFilter = norm(e.target.value);
    clearSelection(false);
    debouncedRedraw();
    updateApplyButtonText();
  });

  const addSearchFilter = (inputEl, selectEl) => {
    if (!inputEl || !selectEl) return;
    inputEl.addEventListener('keyup', () => {
      const searchTerm = norm(inputEl.value);
      const options = selectEl.querySelectorAll('option');
      options.forEach(opt => {
        if (opt.value === 'all' || opt.value === '') {
          opt.style.display = '';
          return;
        }
        const optText = norm(opt.textContent);
        opt.style.display = optText.includes(searchTerm) ? '' : 'none';
      });
    });
  };
  // Removed old calls for Cidade/Bairro
  addSearchFilter(dom.searchMunicipio, dom.selectMunicipio);

  dom.btnApplyFilters.addEventListener('click', () => {
    clearSelection(false);
    currentLocalFilter = '';
    if (dom.searchLocal) dom.searchLocal.value = '';

    if (STATE.currentElectionType === 'municipal') {
      currentCidadeFilter = 'all';
      // CORREÇÃO: Usar combobox em vez de selectCidade direto
      if (cidadeCombobox) cidadeCombobox.setValue('Todos os municípios');
    }

    applyFiltersAndRedraw();

    // Aguarda um ciclo para garantir que o mapa atualizou
    setTimeout(() => {
      if (!currentLayer) return;

      const layers = currentLayer.getLayers();
      const locationIDs = layers.map(layer =>
        String(getProp(layer.feature.properties, 'local_id') || getProp(layer.feature.properties, 'nr_locvot'))
      );

      selectedLocationIDs = new Set(locationIDs);
      updateSelectionUI(true);
    }, 10);
  });

  dom.btnToggleInaptos.addEventListener('click', () => {
    STATE.filterInaptos = !STATE.filterInaptos;
    dom.btnToggleInaptos.classList.toggle('active', STATE.filterInaptos);
    dom.btnToggleInaptos.textContent = STATE.filterInaptos ? 'Inaptos Filtrados' : 'Filtrar Inaptos';
    applyFiltersAndRedraw();
    if (selectedLocationIDs.size > 0) updateSelectionUI(STATE.isFilterAggregationActive);
  });

  dom.vizModeChips.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip-button');
    if (!btn) return;
    currentVizMode = btn.dataset.value;
    dom.vizModeChips.querySelectorAll('.chip-button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateVizModeUI();
    populateCidadeDropdown();
    if (currentCidadeFilter !== 'all') populateBairroDropdown();
    applyFiltersAndRedraw();
  });
  dom.selectVizSize.addEventListener('change', (e) => {
    currentVizSize = e.target.value;
    applyFiltersAndRedraw();
  });
  dom.selectVizColorStyle.addEventListener('change', (e) => {
    currentVizColorStyle = e.target.value;
    applyFiltersAndRedraw();
  });
  dom.selectVizCandidato.addEventListener('change', () => {
    if (currentVizMode.startsWith('desempenho')) applyFiltersAndRedraw();
  });

  dom.btnClearSelection.addEventListener('click', () => {
    clearSelection(true);

    if (STATE.currentElectionType === 'geral') {
      currentCidadeFilter = 'all';
      if (cidadeCombobox) {
        cidadeCombobox.setValue("Todos os municípios");
      }
      dom.searchLocal.disabled = true;
      dom.btnApplyFilters.textContent = 'Analisar/Agregar';
      dom.btnApplyFilters.disabled = true;
    } else {
      currentCidadeFilter = 'all';
      if (cidadeCombobox) cidadeCombobox.setValue("Todos os municípios");
      dom.searchLocal.disabled = false;
      updateApplyButtonText();
    }

    currentBairroFilter = 'all';
    currentLocalFilter = '';
    dom.searchLocal.value = '';

    if (bairroCombobox) bairroCombobox.setValue("Todos os bairros");

    populateBairroDropdown();
    applyFiltersAndRedraw();
  });

  dom.summaryGrid.addEventListener('click', (e) => {
    if (STATE.currentElectionType !== 'geral') return;
    const box = e.target.closest('.summary-box');
    if (!box || !box.dataset.cargo) return;

    const newCargo = box.dataset.cargo; // ex: presidente, governador, senador
    currentOffice = newCargo;
    currentSubType = 'ord';
    currentCargo = `${currentOffice}_${currentSubType}`;

    dom.cargoChipsGeneral.querySelectorAll('.chip-button').forEach(b => {
      b.classList.toggle('active', b.dataset.value === newCargo);
    });

    if (currentCidadeFilter !== 'all') populateBairroDropdown();
    updateElectionTypeUI();
    updateConditionalUI();
    applyFiltersAndRedraw();
    updateSelectionUI(STATE.isFilterAggregationActive);
  });

  // Listener para Chips de TIPO DE ELEIÇÃO (Ordinária / Suplementar)
  // Reutiliza o elemento que antes era só para municipal
  dom.cargoChipsMunicipal.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip-button');
    if (!btn) return;
    currentSubType = btn.dataset.type; // 'ord' ou 'sup'
    currentCargo = `${currentOffice}_${currentSubType}`;

    dom.cargoChipsMunicipal.querySelectorAll('.chip-button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if (currentCidadeFilter !== 'all') populateBairroDropdown();
    updateConditionalUI();
    applyFiltersAndRedraw();
    if (selectedLocationIDs.size > 0) updateSelectionUI(STATE.isFilterAggregationActive);
  });


  // --- CENSUS LISTENERS ---
  // Info Button Logic
  const uniqueInfoBtn = document.getElementById('btnInfoCensus');
  const uniqueInfoOverlay = document.getElementById('infoOverlay');
  const uniqueInfoClose = document.getElementById('btnCloseInfo');

  if (uniqueInfoBtn && uniqueInfoOverlay && uniqueInfoClose) {
    uniqueInfoBtn.addEventListener('click', () => {
      // Stop blinking forever (in this session)
      uniqueInfoBtn.classList.remove('blinking');
      // Show modal
      uniqueInfoOverlay.classList.add('visible');
    });

    const closeInfo = () => {
      uniqueInfoOverlay.classList.remove('visible');
    };

    uniqueInfoClose.addEventListener('click', closeInfo);
    uniqueInfoOverlay.addEventListener('click', (e) => {
      if (e.target === uniqueInfoOverlay) closeInfo();
    });
  }

  // Toggle logic replaced by Tabs
  // Filter Inputs OLD REMOVED - NOW HANDLED BY setupSliders()
}

// ====== FILTER TABS LOGIC RESTORED ======
// ====== FILTER TABS LOGIC RESTORED ======
function setupTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  console.log(`Setting up ${tabs.length} tabs.`);

  // Lista explícita dos IDs de conteúdo do Censo
  const censusIds = ['tab-renda', 'tab-raca', 'tab-idade', 'tab-genero', 'tab-saneamento'];

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.dataset.tab;
      console.log(`Tab clicked: ${targetId}`);

      // 1. Update Active State
      const parent = tab.closest('.filter-tabs') || tab.closest('.tabs') || tab.parentElement;
      if (parent) {
        parent.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
      }

      if (!targetId) return;

      // 2. Switch Content
      if (censusIds.includes(targetId)) {
        censusIds.forEach(id => {
          const el = document.getElementById(id);
          if (el) {
            if (id === targetId) {
              el.classList.remove('hidden', 'section-hidden');
              // For animation restart if desired
              el.style.animation = 'none';
              el.offsetHeight; /* trigger reflow */
              el.style.animation = null;
            } else {
              el.classList.add('hidden');
            }
          } else {
            console.warn(`Tab content element not found: ${id}`);
          }
        });
      } else {
        const content = document.getElementById(targetId);
        if (content) content.classList.remove('hidden');
      }
    });
  });
}

// ====== SLIDERS LOGIC ======
function setupSliders() {
  // Definimos a função de redesenho PRIMEIRO para evitar erros de referência
  const debouncedRedraw = debounce(() => {
    clearSelection(false);
    applyFiltersAndRedraw();
  }, 100);

  // 1. DUAL SLIDER (RENDA)
  const track = document.querySelector('.dual-track');
  const range = document.getElementById('rendaRange');
  const thumbMin = document.getElementById('rendaThumbMin');
  const thumbMax = document.getElementById('rendaThumbMax');
  const container = document.getElementById('sliderRendaContainer');
  const dispMin = document.getElementById('dispRendaMin');
  const dispMax = document.getElementById('dispRendaMax');

  const MAX_VAL = 10000; // R$ 10k
  let valMin = 0;
  let valMax = MAX_VAL;

  function updateDualVisuals() {
    const pctMin = (valMin / MAX_VAL) * 100;
    const pctMax = (valMax / MAX_VAL) * 100;

    if (thumbMin) thumbMin.style.left = `${pctMin}%`;
    if (thumbMax) thumbMax.style.left = `${pctMax}%`;
    if (range) {
      range.style.left = `${pctMin}%`;
      range.style.width = `${pctMax - pctMin}%`;
    }

    if (dispMin) dispMin.textContent = valMin.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
    if (dispMax) dispMax.textContent = valMax >= MAX_VAL ?
      MAX_VAL.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) + "+" :
      valMax.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  }

  function updateRendaState() {
    STATE.censusFilters.rendaMin = valMin > 0 ? valMin : null;
    STATE.censusFilters.rendaMax = valMax < MAX_VAL ? valMax : null;
    debouncedRedraw(); // Agora funciona pois debouncedRedraw foi definido no topo
    updateApplyButtonText();
  }

  const debouncedRenda = debounce(updateRendaState, 200);

  // Drag Logic
  function initDrag(thumb, isMin) {
    if (!thumb) return;
    thumb.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const containerRect = container.getBoundingClientRect();

      function onMove(moveE) {
        let x = moveE.clientX - containerRect.left;
        let pct = Math.max(0, Math.min(100, (x / containerRect.width) * 100));
        let val = Math.round((pct / 100) * MAX_VAL);

        if (isMin) {
          val = Math.min(val, valMax - 100);
          valMin = val;
        } else {
          val = Math.max(val, valMin + 100);
          valMax = val;
        }

        updateDualVisuals();
        debouncedRenda();
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  initDrag(thumbMin, true);
  initDrag(thumbMax, false);

  // 2. SIMPLE SLIDERS (DYNAMIC)
  // Helper para configurar o par Slider + Select
  function setupDynamicFilter(idSlider, idSelect, idDisp, idValDisp, stateKeyVal, stateKeyMode) {
    const slider = document.getElementById(idSlider);
    const select = document.getElementById(idSelect);
    const disp = document.getElementById(idDisp);
    const valDisp = document.getElementById(idValDisp);

    if (!slider || !select) return;

    // Atualiza Estado e UI quando o slider move
    slider.addEventListener('input', () => {
      const val = parseInt(slider.value);
      if (disp) disp.textContent = `${val}%`;
      if (valDisp) valDisp.textContent = `${val}%`;

      STATE.censusFilters[stateKeyVal] = val > 0 ? val : null;
      debouncedRedraw();
      updateApplyButtonText();
    });

    // Atualiza Estado e UI quando o select muda
    select.addEventListener('change', () => {
      const mode = select.value;
      STATE.censusFilters[stateKeyMode] = mode;

      // Atualização imediata visual (barra listrada)
      const geojson = currentDataCollection[currentCargo];
      if (geojson) {
        // Se a função updateAvailabilityBars estiver disponível globalmente (deve estar)
        updateAvailabilityBars(geojson);
      }

      // Se houver valor de filtro aplicado, redesenha o mapa
      if (STATE.censusFilters[stateKeyVal] !== null) {
        debouncedRedraw();
      }
    });
  }

  setupDynamicFilter('sliderRaca', 'selectRaca', 'dispRaca', 'valDispRaca', 'racaVal', 'racaMode');
  setupDynamicFilter('sliderIdosos', 'selectIdade', 'dispIdosos', 'valDispIdosos', 'idadeVal', 'idadeMode');
  setupDynamicFilter('sliderGenero', 'selectGenero', 'dispGenero', 'valDispGenero', 'generoVal', 'generoMode');
  setupDynamicFilter('sliderSaneamento', 'selectSaneamento', 'dispSaneamento', 'valDispSaneamento', 'saneamentoVal', 'saneamentoMode');
}

// ====== RESULTS TABS REMOVED ======

function updateNeighborhoodProfileUI() {
  if (selectedLocationIDs.size === 0) {
    dom.profileRendaVal.textContent = "Selecione um local";
    dom.profileRacaChart.innerHTML = "";
    dom.profileIdadeChart.innerHTML = "";
    dom.profileSaneamentoChart.innerHTML = "";
    dom.profileGeneroChart.innerHTML = "";
    dom.neighborhoodProfile.style.display = 'block';
    return;
  }

  dom.neighborhoodProfile.style.display = 'block';

  // Aggrega dados censitários da seleção
  // Pega do geojson atual
  const geojson = currentDataCollection[currentCargo];
  if (!geojson) return;

  let count = 0;
  let sumRenda = 0;
  let countRenda = 0;

  let sumAlfabetizados = 0;
  let countAlfabetizados = 0; // base populacional aprox? (usaremos média simples das porcentagens por enquanto, ideal seria ponderado mas não temos pop total fácil)

  // Média de porcentagens
  const sums = {
    'Pct Branca': 0, 'Pct Preta': 0, 'Pct Parda': 0, 'Pct Amarela': 0, 'Pct Indigena': 0,
    'Pct Esgoto Rede Geral': 0, 'Pct Fossa Septica': 0, 'Pct Esgoto Inadequado': 0,
    'Pct Homens': 0, 'Pct Mulheres': 0
    // Idades vamos somar tudo que startsWith Pct X a Y anos
  };
  const ageSums = {
    '16 - 24': 0, '25 - 34': 0, '35 - 44': 0, '45 - 59': 0,
    '60 - 74': 0, '75 - 100': 0
  };

  geojson.features.forEach(f => {
    const id = String(getProp(f.properties, 'local_id') || getProp(f.properties, 'nr_locvot'));
    if (selectedLocationIDs.has(id)) {
      count++;
      const p = f.properties;

      const renda = ensureNumber(p['Renda Media']);
      if (renda > 0) {
        sumRenda += renda;
        countRenda++;
      }

      const alfa = ensureNumber(p['Pct Alfabetizados']);
      if (alfa > 0 || p['Pct Alfabetizados'] !== undefined) {
        sumAlfabetizados += alfa;
        countAlfabetizados++;
      }

      // Somas simples das porcentagens
      for (const k in sums) {
        sums[k] += ensureNumber(p[k]);
      }

      // Idades (Novas Faixas: 16-24, 25-34, 35-44, 45-59, 60-74, 75-100)
      for (const k in p) {
        if (k.startsWith('Pct ') && k.includes('anos')) {
          const val = ensureNumber(p[k]);
          // Formato esperado: "Pct 20 a 24 anos" ou "Pct 15 a 19 anos"
          const match = k.match(/Pct (\d+) a/);
          if (match) {
            const age = parseInt(match[1]);
            // Ajuste para buckets personalizados
            if (age >= 15 && age <= 24) ageSums['16 - 24'] += val;
            else if (age >= 25 && age <= 34) ageSums['25 - 34'] += val;
            else if (age >= 35 && age <= 44) ageSums['35 - 44'] += val;
            else if (age >= 45 && age <= 59) ageSums['45 - 59'] += val;
            else if (age >= 60 && age <= 74) ageSums['60 - 74'] += val;
            else if (age >= 75) ageSums['75 - 100'] += val;
          } else if (k.includes('95 a 99') || k.includes('100') || k.includes('mais')) {
            ageSums['75 - 100'] += val;
          }
        }
      }
    }
  });

  if (count === 0) return;

  // Render Renda
  const rendaMedia = countRenda > 0 ? (sumRenda / countRenda) : 0;
  dom.profileRendaVal.textContent = rendaMedia > 0 ?
    rendaMedia.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'N/D';

  // Render Alfabetização
  const alfaMedia = countAlfabetizados > 0 ? (sumAlfabetizados / countAlfabetizados) : 0;
  dom.profileAlfabetizacaoBar.style.width = `${Math.min(100, alfaMedia)}%`;
  dom.profileAlfabetizacaoVal.textContent = `${alfaMedia.toFixed(1)}%`;

  // Render Raça Bar Chart
  const renderBar = (label, val, total) => {
    const pct = (val / total);
    const media = val / count;

    return `
          <div class="bar-chart-row">
             <div class="bar-chart-label" title="${label}">${label}</div>
             <div class="bar-track">
                <div class="bar-fill" style="width: ${Math.min(100, media)}%; background: var(--accent);"></div>
             </div>
             <div class="bar-value">${media.toFixed(1)}%</div>
          </div>`;
  };

  dom.profileRacaChart.innerHTML = `
          ${renderBar('Branca', sums['Pct Branca'], count)}
          ${renderBar('Parda', sums['Pct Parda'], count)}
          ${renderBar('Preta', sums['Pct Preta'], count)}
          ${renderBar('Amarela', sums['Pct Amarela'], count)}
          ${renderBar('Indígena', sums['Pct Indigena'], count)}
       `;

  // Render Gender
  dom.profileGeneroChart.innerHTML = `
          ${renderBar('Homens', sums['Pct Homens'], count)}
          ${renderBar('Mulheres', sums['Pct Mulheres'], count)}
       `;

  // Render Idade (Novas Faixas)
  dom.profileIdadeChart.innerHTML = `
          ${renderBar('16 - 24', ageSums['16 - 24'], count)}
          ${renderBar('25 - 34', ageSums['25 - 34'], count)}
          ${renderBar('35 - 44', ageSums['35 - 44'], count)}
          ${renderBar('45 - 59', ageSums['45 - 59'], count)}
          ${renderBar('60 - 74', ageSums['60 - 74'], count)}
          ${renderBar('75 - 100', ageSums['75 - 100'], count)}
       `;

  // Render Saneamento Boxes
  const renderSanBox = (label, val, color) => {
    const media = val / count;
    return `
          <div class="saneamento-item" style="border-top: 3px solid ${color}">
             <span class="saneamento-val" style="color:${color}">${media.toFixed(1)}%</span>
             <span class="saneamento-lbl">${label}</span>
          </div>`;
  };

  dom.profileSaneamentoChart.innerHTML = `
          ${renderSanBox('Rede Geral', sums['Pct Esgoto Rede Geral'], 'var(--ok)')}
          ${renderSanBox('Fossa Séptica', sums['Pct Fossa Septica'], 'var(--warn)')}
          ${renderSanBox('Inadequado', sums['Pct Esgoto Inadequado'], 'var(--err)')}
       `;
}

function updateApplyButtonText() {
  let btnDisabled = false;
  let btnText = 'Analisar/Agregar';

  const isGeral = (STATE.currentElectionType === 'geral');
  const isAllCities = (currentCidadeFilter === 'all');

  // Texto dinâmico
  if (STATE.currentElectionType === 'municipal') {
    const mun = dom.selectMunicipio.value;
    btnText = `Analisar "${mun}"`;
    if (currentBairroFilter !== 'all') {
      btnText += ` (Bairro)`;
    }
  } else {
    // Modo GERAL
    if (isAllCities) {
      const uf = dom.selectUFGeneral.value;
      btnText = `Filtrar Estado (${uf || 'BR'})`;
    } else {
      // Cidade específica selecionada
      const selectedText = dom.inputCidade ? dom.inputCidade.value : currentCidadeFilter;
      btnText = `Analisar "${selectedText}"`;
    }
  }

  dom.btnApplyFilters.textContent = btnText;
  dom.btnApplyFilters.disabled = btnDisabled;

  // REMOVIDO O BLOCO QUE CAUSAVA O ERRO (dom.btnShowByBairro)
}

function updateVizModeUI() {
  if (currentVizMode.startsWith('desempenho')) {
    const turno = (currentVizMode.endsWith('_2t') && STATE.dataHas2T[currentCargo]) ? '2T' : '1T';
    populateVizCandidatoDropdown(turno);
    dom.vizCandidatoBox.classList.remove('section-hidden');
    dom.selectVizCandidato.disabled = false;
  } else {
    dom.vizCandidatoBox.classList.add('section-hidden');
    dom.selectVizCandidato.disabled = true;
  }
}

function updateConditionalUI() {
  const show2T = STATE.dataHas2T[currentCargo] || false;
  dom.vizModeChips.querySelector('[data-value="vencedor_2t"]').classList.toggle('hidden', !show2T);
  dom.vizModeChips.querySelector('[data-value="desempenho_2t"]').classList.toggle('hidden', !show2T);
  if (!show2T && (currentVizMode === 'vencedor_2t' || currentVizMode === 'desempenho_2t')) {
    currentVizMode = 'vencedor';
    dom.vizModeChips.querySelectorAll('.chip-button').forEach(b => b.classList.remove('active'));
    dom.vizModeChips.querySelector('[data-value="vencedor"]').classList.add('active');
  }
}

function updateElectionTypeUI() {
  dom.cargoChipsMunicipal.innerHTML = '';

  // Verifica se existe ordinaria
  if (currentDataCollection[`${currentOffice}_ord`]) {
    const btnOrd = document.createElement('button');
    btnOrd.className = 'chip-button' + (currentSubType === 'ord' ? ' active' : '');
    btnOrd.dataset.type = 'ord';
    btnOrd.textContent = 'Ordinária';
    dom.cargoChipsMunicipal.appendChild(btnOrd);
  }

  // Verifica se existe suplementar
  if (currentDataCollection[`${currentOffice}_sup`]) {
    const btnSup = document.createElement('button');
    btnSup.className = 'chip-button' + (currentSubType === 'sup' ? ' active' : '');
    btnSup.dataset.type = 'sup';
    btnSup.textContent = 'Suplementar';
    dom.cargoChipsMunicipal.appendChild(btnSup);

    // ESTA LINHA É CRUCIAL: Faz a caixa aparecer
    dom.cargoBoxMunicipal.classList.remove('section-hidden');
  } else {
    // Se só tem ordinária, esconde a caixa
    dom.cargoBoxMunicipal.classList.add('section-hidden');
    if (currentSubType === 'sup') {
      currentSubType = 'ord';
      currentCargo = `${currentOffice}_ord`;
    }
  }
}
async function onClickLoadData_General() {
  const uf = dom.selectUFGeneral.value;
  const year = STATE.currentElectionYear;

  // Validação básica
  if (!uf && currentOffice !== 'presidente') return;
  if (currentOffice === 'presidente' && !uf) dom.selectUFGeneral.value = 'BR';

  const ufToLoad = dom.selectUFGeneral.value || 'BR';

  dom.mapLoader.textContent = `Carregando dados de ${ufToLoad} (${year})...`;
  dom.mapLoader.classList.add('visible');

  // --- LIMPEZA DE MEMÓRIA (Ao trocar de estado, limpa o anterior) ---
  if (currentLayer) {
    map.removeLayer(currentLayer);
    currentLayer = null;
  }
  clearSelection(true);
  currentDataCollection = {}; // Zera tudo do estado anterior
  currentDataCollection_2022 = {};
  STATE.spatialIndex2022 = { presidente: null, governador: null, senador: null };
  uniqueCidades.clear();
  uniqueBairros.clear();
  // ------------------------------------------------------------------

  // Atualiza variáveis de estado
  currentSubType = 'ord';
  currentCargo = `${currentOffice}_${currentSubType}`;

  try {
    const promises = [];
    const keys = [];

    // Função auxiliar para preparar o carregamento
    const queueLoad = (cargo, type) => {
      const key = `${cargo}_${type}`;
      keys.push(key);
      // loadGeoJSON retorna null se der erro, não quebra o Promise.all
      return loadGeoJSON(cargo, ufToLoad, year, type);
    };

    // LÓGICA DE CARREGAMENTO EM LOTE
    if (ufToLoad === 'BR') {
      // Se for Brasil, carrega apenas Presidente (Gov/Sen pesariam demais)
      promises.push(queueLoad('presidente', 'ord'));
      // promises.push(queueLoad('presidente', 'sup')); // Descomente se tiver pres suplementar
    } else {
      // Se for Estado Específico (ex: MT), carrega O PACOTE COMPLETO
      // Presidente + Governador + Senador (Ordinária e Suplementar)
      ['presidente', 'governador', 'senador'].forEach(cargo => {
        promises.push(queueLoad(cargo, 'ord'));
        promises.push(queueLoad(cargo, 'sup'));
      });
    }

    // Carrega Censo em paralelo também
    const censusIndex = promises.length; // Guarda o índice onde o censo vai estar
    promises.push(fetchGeoJSON(buildDataPath_Census(ufToLoad, year)).catch(() => null));

    // EXECUTA TUDO SIMULTANEAMENTE
    const results = await Promise.all(promises);

    // Separa o Censo dos dados eleitorais
    const censusData = results[censusIndex];

    // Processa os dados eleitorais
    let dataFound = false;
    results.forEach((data, index) => {
      if (index === censusIndex) return; // Pula o censo no loop de eleição

      if (data) {
        const key = keys[index]; // Recupera a chave (ex: 'governador_ord')
        if (censusData) mergeCensusData(data, censusData); // Aplica censo
        currentDataCollection[key] = data; // Guarda na RAM
        processLoadedGeoJSON(data, key);
        dataFound = true;
      }
    });

    if (!dataFound) {
      throw new Error("Nenhum dado encontrado para os critérios selecionados.");
    }

    // --- Configuração da Interface ---
    populateCidadeDropdown();
    [dom.filterBox, dom.vizBox].forEach(el => el.classList.remove('section-hidden'));

    if (cidadeCombobox) {
      cidadeCombobox.disable(false);
      cidadeCombobox.setValue("Todos os municípios");
      currentCidadeFilter = 'all';
    }

    dom.selectVizSize.disabled = false;
    // Enable Color Style Select
    if (dom.selectVizColorStyle) dom.selectVizColorStyle.disabled = false;

    dom.btnApplyFilters.disabled = false;
    updateApplyButtonText();
    dom.searchLocal.disabled = true;

    updateElectionTypeUI();

    // Agora podemos mostrar o comparativo, pois temos os 3 dados carregados!
    if (ufToLoad !== 'BR') {
      dom.summaryBoxContainer.classList.remove('section-hidden');
    } else {
      dom.summaryBoxContainer.classList.add('section-hidden');
    }

    const hasAnyInaptos = Object.values(STATE.dataHasInaptos).some(v => v);
    dom.btnToggleInaptos.disabled = !hasAnyInaptos;
    STATE.filterInaptos = false;
    dom.btnToggleInaptos.classList.remove('active');
    dom.btnToggleInaptos.textContent = 'Filtrar Inaptos';

    updateConditionalUI();
    applyFiltersAndRedraw();

    if (currentLayer && currentLayer.getBounds().isValid()) {
      map.fitBounds(currentLayer.getBounds());
    }

  } catch (e) {
    console.error(`Falha ao carregar GeoJSON ${year}:`, e);
    alert(`Erro ao carregar dados: ${e.message}`);
  } finally {
    dom.mapLoader.classList.remove('visible');
  }
}

async function onClickLoadData_Municipal() {
  const uf = dom.selectUFMunicipal.value;
  const municipio = dom.selectMunicipio.value;
  const ano = STATE.currentElectionYear;

  if (!uf || !municipio) return;

  dom.mapLoader.textContent = `Carregando ${municipio}/${uf} (${ano})...`;
  dom.mapLoader.classList.add('visible');

  clearSelection(true);
  currentDataCollection = {};
  currentDataCollection_2022 = {};
  uniqueCidades.clear();
  uniqueBairros.clear();

  STATE.candidates = {}; STATE.metrics = {}; STATE.inaptos = {};
  STATE.dataHas2T = {}; STATE.dataHasInaptos = {};

  try {
    currentOffice = 'prefeito';
    currentSubType = 'ord';
    currentCargo = 'prefeito_ord';

    const dataOrdPromise = loadGeoJSON(municipio, uf, ano, 'Ordinaria'); // Mapeia para 'ord' interno
    const dataSupPromise = loadGeoJSON(municipio, uf, ano, 'Suplementar'); // Mapeia para 'sup' interno
    const censusPromise = fetchGeoJSON(buildDataPath_Census(uf, ano, municipio));

    const [dataOrd, dataSup, censusData] = await Promise.all([dataOrdPromise, dataSupPromise, censusPromise.catch(() => null)]);

    if (!dataOrd) {
      throw new Error(`Não foi possível carregar dados para ${municipio} (Ordinaria ${ano}).`);
    }

    if (censusData) mergeCensusData(dataOrd, censusData);
    currentDataCollection['prefeito_ord'] = dataOrd;
    processLoadedGeoJSON(dataOrd, 'prefeito_ord');

    if (dataSup) {
      if (censusData) mergeCensusData(dataSup, censusData);
      currentDataCollection['prefeito_sup'] = dataSup;
      processLoadedGeoJSON(dataSup, 'prefeito_sup');
    }

    // Atualiza UI de chips (Ordinária/Suplementar)
    updateElectionTypeUI();

    dom.summaryBoxContainer.classList.add('section-hidden');

    [dom.filterBox, dom.vizBox].forEach(el => el.classList.remove('section-hidden'));
    if (cidadeCombobox) cidadeCombobox.disable(true);
    if (bairroCombobox) bairroCombobox.disable(false);

    [dom.searchLocal, dom.selectVizSize, dom.selectVizColorStyle].forEach(el => el.disabled = false);

    populateBairroDropdown();

    dom.btnApplyFilters.disabled = false;
    dom.btnApplyFilters.textContent = `Analisar/Agregar "${municipio}"`;

    // Força exibição do botão de bairros para municipal

    const hasAnyInaptos = Object.values(STATE.dataHasInaptos).some(v => v);
    dom.btnToggleInaptos.disabled = !hasAnyInaptos;
    STATE.filterInaptos = false;
    dom.btnToggleInaptos.classList.remove('active');
    dom.btnToggleInaptos.textContent = 'Filtrar Inaptos';

    updateConditionalUI();
    applyFiltersAndRedraw();

    if (currentLayer && currentLayer.getBounds().isValid()) {
      map.fitBounds(currentLayer.getBounds());
    }

  } catch (e) {
    console.error(`Falha ao carregar GeoJSON ${ano}:`, e);
    alert(`Erro ao carregar os dados de ${ano}.\n${e.message}`);
  } finally {
    dom.mapLoader.classList.remove('visible');
  }
}

// Helper central para carregar
async function loadGeoJSON(id, uf, ano, type) {
  // type pode ser 'ord', 'sup', 'Ordinaria', 'Suplementar'
  let normalizedType = 'ord';
  if (type === 'sup' || type === 'Suplementar') normalizedType = 'sup';

  let dataPath;
  if (STATE.currentElectionType === 'geral') {
    // id = cargo (presidente, etc)
    dataPath = buildDataPath_General(id, uf, ano, normalizedType);
  } else {
    // id = municipio, type passed is explicit 'Ordinaria'/'Suplementar' for file path construction
    // but let's standardize on buildDataPath_Municipal accepting the type string
    dataPath = buildDataPath_Municipal(id, uf, ano, type);
  }

  if (!dataPath) return null;
  return await fetchGeoJSON(dataPath).catch(e => null);
}

async function loadAllStatesAndMerge_General(cargo, year, type) {
  const allFeatures = [];
  const promises = [];

  for (const sigla of ALL_STATE_SIGLAS) {
    const path = buildDataPath_General(cargo, sigla, year, type);
    promises.push(fetchGeoJSON(path).catch(e => {
      return null;
    }));
  }

  const results = await Promise.all(promises);

  let foundAny = false;
  results.forEach((geojson) => {
    if (geojson && geojson.features) {
      allFeatures.push(...geojson.features);
      foundAny = true;
    }
  });

  if (!foundAny) return null;

  return { type: "FeatureCollection", features: allFeatures };
}

// === CONSTRUTORES DE CAMINHO ===

function buildDataPath_General(cargo, uf, year, type) {
  const ufNorm = (uf || 'BR').toUpperCase();

  // --- ALTERAÇÃO: Lógica Específica para Nacional (BR) ---
  if (ufNorm === 'BR' && cargo === 'presidente') {
    // Padrão do print: resultados_presidente_nacional_2022.geojson
    // Assumindo que estão na raiz da pasta resultados_geo/
    return `${DATA_BASE_URL}resultados_presidente_nacional_${year}.geojson`;
  }
  // -------------------------------------------------------

  // Lógica antiga para Estados
  let filename = `${cargo}_${ufNorm}`;
  if (type === 'sup') {
    filename += `_Suplementar`;
  }
  filename += `_${year}.geojson`;

  if (cargo === 'presidente') {
    return `${DATA_BASE_URL}presidente_por_estado${year}/${filename}`;
  }

  if (!uf || uf === 'BR') return null; // Governador/Senador não tem BR

  if (cargo === 'governador') {
    return `${DATA_BASE_URL}governador${year}/${filename}`;
  }
  if (cargo === 'senador') {
    return `${DATA_BASE_URL}senador${year}/${filename}`;
  }
  return null;
}

function buildDataPath_Municipal(municipio, uf, ano, tipo) {
  if (!municipio || !uf || !tipo) return null;
  const nomeSeguro = municipio.replace(/[\/\\]/g, '-');
  // tipo vem como 'Ordinaria' ou 'Suplementar' aqui
  return `${DATA_BASE_URL}${ano} Municipais/${uf.toUpperCase()}/${nomeSeguro}_${tipo}_${ano}.geojson`;
}

function buildDataPath_Census(uf, year, municipio = null) {
  const ufNorm = (uf || 'BR').toUpperCase();

  // Se tivermos UF e não for BR, buscamos o arquivo específico do estado/ano
  if (ufNorm !== 'BR' && ufNorm !== '') {
    // Ex: resultados_geo/locais_votacao_2022/locais_votacao_2022_SP.geojson
    return `${DATA_BASE_URL}locais_votacao_${year}/locais_votacao_${year}_${ufNorm}.geojson`;
  }

  // Fallback para arquivo nacional (se existir) ou caso de erro
  return `${DATA_BASE_URL}locais_votacao_${year}_dados_censo.geojson`;
}

// let allDataCache = new Map(); // REMOVIDO: Não usamos mais cache global para economizar RAM

// ====== DATA PROCESSING ======

async function loadZipIndex() {
  try {
    const res = await fetch(DATA_BASE_URL + 'zip_index.json');
    if (res.ok) {
      ZIP_INDEX = await res.json();
      console.log("ZIP Index loaded with " + Object.keys(ZIP_INDEX).length + " entries.");
    } else {
      console.warn("zip_index.json not found. Fallback to direct fetch.");
      ZIP_INDEX = {};
    }
  } catch (e) {
    console.error("Error loading zip_index.json:", e);
    ZIP_INDEX = {};
  }
}

// Substitua a função fetchGeoJSON antiga por esta:
async function fetchGeoJSON(path) {
  // Ensure index is loaded (if we haven't tried yet)
  if (ZIP_INDEX === null) {
    await loadZipIndex();
  }

  // 1. Determine relative key for index lookup
  // path is like "resultados_geo/2022 Municipais/SP/bauru.geojson"
  // index key is "2022 Municipais/SP/bauru.geojson"
  let relativePath = path;
  if (path.startsWith(DATA_BASE_URL)) {
    relativePath = path.substring(DATA_BASE_URL.length);
  }

  // 2. Check Index
  if (ZIP_INDEX && ZIP_INDEX[relativePath]) {
    const entry = ZIP_INDEX[relativePath];
    const zipUrl = DATA_BASE_URL + entry.zip;
    const innerFile = entry.file;

    try {
      return await fetchFromZip(zipUrl, innerFile);
    } catch (e) {
      console.error(`Failed to load ${innerFile} from ${zipUrl}:`, e);
      throw e;
    }
  }

  // 3. Fallback: Direct Fetch (regular file)
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Arquivo não encontrado: ${path}`);
  return await response.json();
}

async function fetchFromZip(zipUrl, filename) {
  let reader = ZIP_READERS.get(zipUrl);

  if (!reader) {
    // Create new reader
    // unzipit.HTTPRangeReader allows fetching only parts of the zip
    // We assume the server supports Range requests (most do, including python http.server and live server)
    reader = await unzipit.unzip(zipUrl);
    ZIP_READERS.set(zipUrl, reader);
  }

  // reader is { entries: { 'filename': BlobReader, ... }, ... }
  const entries = reader.entries;
  let entry = entries[filename];

  // Logic to find case-insensitive if needed (GeoJSONs can be messy)
  if (!entry) {
    const lowerName = filename.toLowerCase();
    for (const k in entries) {
      if (k.toLowerCase() === lowerName) {
        entry = entries[k];
        break;
      }
    }
  }

  if (!entry) {
    throw new Error(`File ${filename} not found in zip ${zipUrl}`);
  }

  const blob = await entry.blob();
  const text = await blob.text();
  return JSON.parse(text);
}

// ====== DATA PROCESSING ======

function discoverCandidatesAndMetrics(geojson) {
  const localState = {
    candidates: { '1T': [], '2T': [] },
    metrics: { '1T': [], '2T': [] },
    inaptos: { '1T': [], '2T': [] },
    dataHas2T: false,
    dataHasInaptos: false
  };

  const allKeys = new Set();
  const sampleSize = Math.min(geojson.features.length, 1000);
  for (let i = 0; i < sampleSize; i++) {
    const props = geojson.features[i]?.properties;
    if (props) {
      for (const key in props) allKeys.add(key);
    }
  }

  const METRIC_NAMES = [
    'Total_Votos_Validos', 'Votos_Brancos', 'Votos_Nulos',
    'Eleitores_Aptos', 'Eleitores_Aptos_Municipal',
    'Abstenções', 'Comparecimento', 'Votos_Legenda', 'NR_TURNO'
  ];

  allKeys.forEach(key => {
    const turnoMatch = key.match(/ (1T|2T)$/);
    if (!turnoMatch) return;

    const turno = turnoMatch[1];
    if (turno === '2T') localState.dataHas2T = true;

    const coreKey = key.replace(/ (1T|2T)$/, '');
    const isMetric = METRIC_NAMES.some(name => coreKey.toUpperCase() === name.toUpperCase());

    if (isMetric) {
      localState.metrics[turno].push(key);
    } else {
      localState.candidates[turno].push(key);
      const cand = parseCandidateKey(key);
      if (cand.status === 'INAPTO') {
        localState.inaptos[turno].push(key);
        localState.dataHasInaptos = true;
      }
    }
  });

  localState.candidates['1T'].sort();
  localState.candidates['2T'].sort();
  return localState;
}

function mergeCensusData(electionData, censusData) {
  if (!electionData || !censusData || !censusData.features) return;

  // Cria índice do censo
  const censusIndex = new Map();

  censusData.features.forEach(f => {
    const p = f.properties;
    // Tenta ID primeiro
    const id = p.id_unico || p.local_id || p.nr_locvot;

    if (id) censusIndex.set(String(id), p);

    // Fallback: Nome + Bairro
    const nome = norm(p.nm_locvot);
    const bairro = norm(p.ds_bairro);
    if (nome) {
      censusIndex.set(`${nome}|${bairro}`, p);
    }
  });

  // Merge
  let mergedCount = 0;
  electionData.features.forEach(f => {
    const p = f.properties;
    const id = String(p.id_unico || p.local_id || p.nr_locvot); // ID_UNICO may be the key

    let censusProps = censusIndex.get(id);

    // Tenta fallback por nome
    if (!censusProps) {
      const nome = norm(p.nm_locvot);
      const bairro = norm(p.ds_bairro);
      censusProps = censusIndex.get(`${nome}|${bairro}`);
    }

    if (censusProps) {
      // Mesclar chaves específicas
      const keysToMerge = [
        'Renda Media', 'Pct Alfabetizados',
        'Pct Esgoto Rede Geral', 'Pct Fossa Septica', 'Pct Esgoto Inadequado',
        'Pct Branca', 'Pct Preta', 'Pct Parda', 'Pct Amarela', 'Pct Indigena',
        'Pct Homens', 'Pct Mulheres'
      ];
      // Idades: Pct X a Y anos
      for (const k in censusProps) {
        if (k.startsWith('Pct ') && k.includes('anos')) keysToMerge.push(k);
      }

      keysToMerge.forEach(k => {
        if (censusProps[k] !== undefined) {
          p[k] = censusProps[k];
        }
      });
      mergedCount++;
    }
  });
  console.log(`Merge Census: ${mergedCount} features enriched.`);
}

function processLoadedGeoJSON(geojson, cargoKey) {
  if (!geojson || !geojson.features || !geojson.features.length) {
    STATE.candidates[cargoKey] = { '1T': [], '2T': [] };
    STATE.metrics[cargoKey] = { '1T': [], '2T': [] };
    STATE.inaptos[cargoKey] = { '1T': [], '2T': [] };
    STATE.dataHas2T[cargoKey] = false;
    STATE.dataHasInaptos[cargoKey] = false;
    return;
  }

  const { candidates, metrics, inaptos, dataHas2T, dataHasInaptos } = discoverCandidatesAndMetrics(geojson);

  STATE.candidates[cargoKey] = candidates;
  STATE.metrics[cargoKey] = metrics;
  STATE.inaptos[cargoKey] = inaptos;
  STATE.dataHas2T[cargoKey] = dataHas2T;
  STATE.dataHasInaptos[cargoKey] = dataHasInaptos;

  if (STATE.currentElectionType === 'geral') {
    // Se for geral, adiciona cidades à lista única
    geojson.features.forEach(f => {
      const cidade = getProp(f.properties, 'nm_localidade');
      if (cidade) uniqueCidades.add(cidade);
    });
  }
}

function createCombobox(elements, onSelect) {
  const { box, input, list } = elements;
  let items = []; // Holds objects: { label: string, info: string, color: string } or strings
  let allLabel = "Todos";

  function render(filterText = '') {
    list.innerHTML = '';
    const normFilter = norm(filterText);
    let count = 0;
    const max = 150;

    // "Todos" option
    if (filterText === '' || norm(allLabel).includes(normFilter)) {
      const li = document.createElement('div');
      li.className = 'combobox-item';
      li.style.fontStyle = 'italic';
      li.style.color = 'var(--accent)';
      li.innerHTML = `<span>${allLabel}</span>`;
      li.onclick = () => selectItem('all', allLabel);
      list.appendChild(li);
    }

    for (const item of items) {
      if (count > max) break;
      // Support both string items and object items
      const label = typeof item === 'object' ? item.label : item;
      const info = typeof item === 'object' ? item.info : '';
      const color = typeof item === 'object' ? item.color : '';

      if (norm(label).includes(normFilter)) {
        const li = document.createElement('div');
        li.className = 'combobox-item';

        if (info) {
          li.innerHTML = `<span>${label}</span><span class="item-meta" style="color:${color}">${info}</span>`;
        } else {
          li.textContent = label;
        }

        li.onclick = () => selectItem(label, label); // Use label as value
        list.appendChild(li);
        count++;
      }
    }

    if (list.children.length === 0) {
      const div = document.createElement('div');
      div.className = 'combobox-empty';
      div.textContent = 'Sem resultados';
      list.appendChild(div);
    }
  }

  function selectItem(value, label) {
    input.value = label;
    list.classList.remove('active');
    onSelect(value);
  }

  input.addEventListener('click', () => {
    if (input.disabled) return;
    list.classList.toggle('active');
    if (list.classList.contains('active')) {
      const val = input.value;
      render((val === allLabel || val === '') ? '' : val);
    }
  });

  input.addEventListener('input', () => {
    if (input.disabled) return;
    list.classList.add('active');
    render(input.value);
  });

  document.addEventListener('click', (e) => {
    if (!box.contains(e.target)) list.classList.remove('active');
  });

  return {
    setItems: (newItems, labelAll = "Todos os municípios") => {
      items = newItems; // Expecting array of objects or strings
      allLabel = labelAll;
    },
    clear: () => {
      input.value = '';
      items = [];
      list.innerHTML = '';
    },
    setValue: (val) => { input.value = val; },
    disable: (bool) => { input.disabled = bool; if (bool) list.classList.remove('active'); }
  };
}

let cidadeCombobox = null;
let bairroCombobox = null;

function populateCidadeDropdown() {
  if (!cidadeCombobox) {
    console.warn("Combobox not initialized yet");
    return;
  }

  const geojson = currentDataCollection[currentCargo];
  if (!geojson || !geojson.features) return;

  // Group features by City
  const cityGroups = {};
  geojson.features.forEach(f => {
    const cidade = getProp(f.properties, 'nm_localidade');
    if (cidade) {
      if (!cityGroups[cidade]) cityGroups[cidade] = [];
      cityGroups[cidade].push(f.properties);
    }
  });

  const items = [];
  const cidadeNames = Object.keys(cityGroups).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  cidadeNames.forEach(cidade => {
    const propsList = cityGroups[cidade];
    const aggProps = aggregatePropsList(propsList);
    const stats = calculateWinnerStats(aggProps);
    items.push({
      label: cidade,
      info: stats.text,
      color: stats.color
    });
  });

  cidadeCombobox.setItems(items, "Todos os municípios");

  // If valid logic exists to keep selection, do it, else reset
  // For now, reset to All or keep if matches
  if (currentCidadeFilter === 'all') {
    cidadeCombobox.setValue("Todos os municípios");
  } else {
    cidadeCombobox.setValue(currentCidadeFilter);
  }

  cidadeCombobox.disable(false);
}

function populateBairroDropdown() {
  // 1. Identify Bairros
  uniqueBairros.clear();

  if (!bairroCombobox) return;

  if (STATE.currentElectionType === 'geral' && currentCidadeFilter === 'all') {
    bairroCombobox.disable(true);
    bairroCombobox.setValue("");
    return;
  }

  const geojson = currentDataCollection[currentCargo];
  if (!geojson || !geojson.features) return;

  // Group by Bairro
  const bairroGroups = {};

  geojson.features.forEach(f => {
    const props = f.properties;
    let adicionar = false;

    if (STATE.currentElectionType === 'geral') {
      if (getProp(props, 'nm_localidade') === currentCidadeFilter) adicionar = true;
    } else {
      adicionar = true;
    }

    if (adicionar) {
      const bairro = (getProp(props, 'ds_bairro') || 'Bairro não inf.').trim();
      if (bairro && bairro.toUpperCase() !== 'N/D') {
        uniqueBairros.add(bairro);
        if (!bairroGroups[bairro]) bairroGroups[bairro] = [];
        bairroGroups[bairro].push(props);
      }
    }
  });

  const bairros = Array.from(uniqueBairros).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const items = [];

  bairros.forEach(bairro => {
    const propsList = bairroGroups[bairro];
    const aggProps = aggregatePropsList(propsList);
    const stats = calculateWinnerStats(aggProps);
    items.push({
      label: bairro,
      info: stats.text,
      color: stats.color
    });
  });

  bairroCombobox.setItems(items, "Todos os bairros");

  if (currentBairroFilter === 'all') {
    bairroCombobox.setValue("Todos os bairros");
  } else {
    bairroCombobox.setValue(currentBairroFilter);
  }

  bairroCombobox.disable(items.length === 0);
}

function calculateWinnerStats(props) {
  const cargo = currentCargo;
  const turnoKey = (currentVizMode.endsWith('_2t') && STATE.dataHas2T[cargo]) ? '2T' : ((currentTurno === 2 && STATE.dataHas2T[cargo]) ? '2T' : '1T');

  const vencedor = getVencedor(props, cargo, turnoKey, STATE.filterInaptos);
  const { totalValidos } = getVotosValidos(props, cargo, turnoKey, STATE.filterInaptos);

  // Calcular margem
  const candidatosValidos = (STATE.candidates[cargo]?.[turnoKey] || [])
    .filter(key => !(STATE.inaptos[cargo]?.[turnoKey] || []).includes(key))
    .map(key => ({ ...parseCandidateKey(key), votos: ensureNumber(getProp(props, key)) }))
    .sort((a, b) => b.votos - a.votos);

  const segundo = candidatosValidos[1] || { votos: 0 };
  const margemPct = (totalValidos > 0 && vencedor.votos > 0)
    ? (vencedor.votos / totalValidos) - (segundo.votos / totalValidos)
    : 0;

  const winnerColor = getColorForCandidate(vencedor.nome, vencedor.partido);

  return {
    winner: vencedor.nome,
    margin: margemPct,
    color: winnerColor,
    text: `${vencedor.nome} (+${fmtPct(margemPct)})`
  };
}

function populateVizCandidatoDropdown(turno) {
  const candidatos = STATE.candidates[currentCargo]?.[turno] || [];
  dom.selectVizCandidato.innerHTML = '';
  candidatos.forEach(key => {
    if (STATE.filterInaptos && (STATE.inaptos[currentCargo]?.[turno] || []).includes(key)) {
      return;
    }
    const cand = parseCandidateKey(key);
    const opt = document.createElement('option');
    opt.value = cand.key;
    opt.textContent = `${cand.nome} (${cand.partido})`;
    dom.selectVizCandidato.appendChild(opt);
  });
}

// ====== MAP RENDERING ======

// Variável para guardar o listener de movimento
let moveEndListener = null;

function applyFiltersAndRedraw() {
  // 1. Limpa camada e listeners antigos
  if (currentLayer) {
    map.removeLayer(currentLayer);
    currentLayer = null;
  }
  if (moveEndListener) {
    map.off('moveend', moveEndListener);
    moveEndListener = null;
  }

  const geojson = currentDataCollection[currentCargo];
  if (!geojson) return;

  // VISUAL IMPROVEMENT: Atualiza as barras de disponibilidade com base nos dados locais
  updateAvailabilityBars(geojson);

  // 2. Verifica se é um dataset GIGANTE (Tipo Nacional BR)
  // Se tiver mais de 50.000 pontos, ativamos o modo "Enquadramento"
  const isHeavyData = geojson.features.length > 50000;

  if (isHeavyData) {
    console.log("Modo de Alta Performance Ativado: Renderizando por Enquadramento.");

    // Cria uma camada vazia inicialmente
    currentLayer = L.layerGroup().addTo(map);

    // Função que desenha APENAS o que está na tela
    const updateView = () => redrawVisibleFeatures(geojson);

    // Adiciona listener para atualizar quando mexer no mapa
    moveEndListener = debounce(() => updateView(), 250); // Delay de 250ms para não travar enquanto arrasta
    map.on('moveend', moveEndListener);

    // Primeira renderização
    updateView();

  } else {
    // --- MODO PADRÃO (Para Cidades ou Estados pequenos) ---
    // Usa a lógica antiga que carrega tudo de uma vez
    currentLayer = L.geoJSON(geojson, {
      renderer: mapCanvasRenderer,
      pointToLayer: createPointLayer, // Função extraída abaixo
      style: getFeatureStyle,
      onEachFeature: onEachFeature,
      filter: filterFeature // Função extraída abaixo
    }).addTo(map);
  }
}

// --- NOVA FUNÇÃO DE OTIMIZAÇÃO ---
function redrawVisibleFeatures(fullGeoJSON) {
  if (!currentLayer) return;
  currentLayer.clearLayers(); // Limpa o que estava na tela

  const bounds = map.getBounds();
  const zoom = map.getZoom();

  // Se o zoom for muito longe (ex: vendo o país todo), renderizar 500k pontos trava.
  // Limitamos a visualização ou mostramos um aviso/amostragem.
  // AVISO: Se quiser ver TUDO de longe, vai travar. 
  // Solução: Só renderiza se zoom > 5 ou limita a quantidade.

  const visibleFeatures = [];
  const features = fullGeoJSON.features;
  const limit = 3000; // Renderiza no máx 3000 pontos por vez para ficar liso

  let count = 0;

  // Itera sobre os dados (Isso é rápido em JS puro)
  for (let i = 0; i < features.length; i++) {
    const f = features[i];

    // 1. Filtra pelos sliders/inputs primeiro (mais rápido)
    if (!filterFeature(f)) continue;

    // 2. Verifica se está dentro da tela (BBox)
    // Nota: GeoJSON é [lon, lat], Leaflet é [lat, lon]
    const lat = f.geometry.coordinates[1];
    const lng = f.geometry.coordinates[0];

    if (bounds.contains([lat, lng])) {
      visibleFeatures.push(f);
      count++;
    }

    // Opcional: Limite de segurança para não explodir a memória visual
    // Se quiser ver todos, remova esse if, mas vai pesar.
    // if (count > 5000) break; 
  }

  // Cria a camada GeoJSON leve apenas com os visíveis
  const viewLayer = L.geoJSON({ type: 'FeatureCollection', features: visibleFeatures }, {
    renderer: mapCanvasRenderer,
    pointToLayer: createPointLayer,
    style: getFeatureStyle,
    onEachFeature: onEachFeature
  });

  currentLayer.addLayer(viewLayer);

  // Atualiza contadores visuais
  const displayCount = visibleFeatures.length;
  const totalText = features.length.toLocaleString();
  dom.resultsSubtitle.textContent = `Visualizando ${displayCount} locais (Zoom na área para ver mais)`;
}

// --- HELPER FUNCTIONS (Extraídas para reaproveitar nos dois modos) ---

function createPointLayer(feature, latlng) {
  let radius = 6; // Tamanho fixo consistente (como pedido)
  // REMOVIDO: Ajuste de zoom (if map.getZoom() < 7 radius = 3)

  if (currentVizSize === 'comparecimento') {
    const validos = ensureNumber(getProp(feature.properties, 'Total_Votos_Validos 1T'));
    const brancos = ensureNumber(getProp(feature.properties, 'Votos_Brancos 1T'));
    const nulos = ensureNumber(getProp(feature.properties, 'Votos_Nulos 1T'));
    const comparecimento = validos + brancos + nulos;
    radius = Math.max(2, Math.log(comparecimento || 1) * 1.5);
  }
  return L.circleMarker(latlng, { radius: radius });
}

function filterFeature(feature) {
  const props = feature.properties;

  // Filtro de 2T Vazio
  const validos_1t = ensureNumber(getProp(props, 'Total_Votos_Validos 1T'));
  const brancos_1t = ensureNumber(getProp(props, 'Votos_Brancos 1T'));
  const nulos_1t = ensureNumber(getProp(props, 'Votos_Nulos 1T'));
  const comparecimento_1t = validos_1t + brancos_1t + nulos_1t;

  if (comparecimento_1t === 0) {
    if (STATE.dataHas2T[currentCargo]) {
      const validos_2t = ensureNumber(getProp(props, 'Total_Votos_Validos 2T'));
      const brancos_2t = ensureNumber(getProp(props, 'Votos_Brancos 2T'));
      const nulos_2t = ensureNumber(getProp(props, 'Votos_Nulos 2T'));
      const comparecimento_2t = validos_2t + brancos_2t + nulos_2t;
      if (comparecimento_2t === 0) return false;
    } else {
      return false;
    }
  }

  // Filtros de Texto
  if (STATE.currentElectionType === 'geral' && currentCidadeFilter !== 'all') {
    if (getProp(props, 'nm_localidade') !== currentCidadeFilter) return false;
  }

  if (currentBairroFilter !== 'all') {
    const bairro = getProp(props, 'ds_bairro');
    if (!bairro || bairro.trim() !== currentBairroFilter) return false;
  }

  const searchTxt = currentLocalFilter.trim();
  if (searchTxt.length > 2) {
    const nomeLocal = norm(getProp(props, 'nm_locvot'));
    if (!nomeLocal.includes(searchTxt)) return false;
  }

  // FILTROS CENSITÁRIOS (Copiar lógica exata que já existia no seu código)
  const renda = ensureNumber(getProp(props, 'Renda Media'));
  if (STATE.censusFilters.rendaMin !== null && renda < STATE.censusFilters.rendaMin) return false;
  if (STATE.censusFilters.rendaMax !== null && renda > STATE.censusFilters.rendaMax) return false;

  const checkSimple = (val, mode) => {
    if (val !== null) {
      const propVal = ensureNumber(getProp(props, mode));
      if (propVal < val) return false;
    }
    return true;
  };

  if (!checkSimple(STATE.censusFilters.racaVal, STATE.censusFilters.racaMode)) return false;
  if (!checkSimple(STATE.censusFilters.generoVal, STATE.censusFilters.generoMode)) return false;
  if (!checkSimple(STATE.censusFilters.saneamentoVal, STATE.censusFilters.saneamentoMode)) return false;

  if (STATE.censusFilters.idadeVal !== null) {
    let sumPct = 0;
    const mode = STATE.censusFilters.idadeMode;
    for (const k in props) {
      if (k.startsWith('Pct ') && k.includes('anos')) {
        const match = k.match(/Pct (\d+) a/);
        if (match) {
          const age = parseInt(match[1]);
          // Map census bucket to our filter modes
          let bucketKey = null;
          if (age >= 15 && age <= 24) bucketKey = '16-24';
          else if (age >= 25 && age <= 34) bucketKey = '25-34';
          else if (age >= 35 && age <= 44) bucketKey = '35-44';
          else if (age >= 45 && age <= 59) bucketKey = '45-59';
          else if (age >= 60 && age <= 74) bucketKey = '60-74';
          else if (age >= 75) bucketKey = '75-100';

          if (bucketKey === mode) {
            sumPct += ensureNumber(props[k]);
          }
        } else if ((k.includes('95 a 99') || k.includes('100') || k.includes('mais'))) {
          if (mode === '75-100') sumPct += ensureNumber(props[k]);
        }
      }
    }
    if (sumPct < STATE.censusFilters.idadeVal) return false;
  }

  return true;
}

function getFeatureStyle(feature) {
  const props = feature.properties;
  let fillColor = DEFAULT_SWATCH;
  let fillOpacity = 1; // Default to solid opacity for Universal Gradient and Static
  let pctVal = 0;      // Value used for gradient calc

  const turnoKey = (currentVizMode.endsWith('_2t') && STATE.dataHas2T[currentCargo]) ? '2T' : '1T';
  const { totalValidos } = getVotosValidos(props, currentCargo, turnoKey, STATE.filterInaptos);

  // 1. Determine Base Color and Percentage based on Mode
  if (currentVizMode.startsWith('vencedor')) {
    const { nome, partido, votos } = getVencedor(props, currentCargo, turnoKey, STATE.filterInaptos);
    fillColor = getColorForCandidate(nome, partido);

    // For winner, percentage is their share of valid votes
    pctVal = (totalValidos > 0) ? (votos / totalValidos) * 100 : 0;

  } else if (currentVizMode.startsWith('desempenho')) {
    const candidato = dom.selectVizCandidato.value;
    if (candidato) {
      const votosCand = ensureNumber(getProp(props, candidato));
      pctVal = (totalValidos > 0) ? (votosCand / totalValidos) * 100 : 0;

      const match = candidato.match(/\((.*?)\)/);
      fillColor = match ? colorForParty(match[1]) : DEFAULT_SWATCH;
    }
  }

  // 2. Apply Style Logic (Static vs Gradient)
  if (currentVizColorStyle === 'gradient') {
    // Apply Universal Gradient Logic
    // REMOVIDO: Check Theme (User asked for consistent gradient on dark mode too)
    fillColor = getUniversalGradientColor(fillColor, pctVal);
    fillOpacity = 1; // Gradient is solid color variation
  } else {
    // Static Mode
    // Just use the base fillColor determined above
    // If it's Desempenho mode, we might want to hide points with 0 votes?
    // Current logic: Show everything with base color.
    fillOpacity = 1;

    // Optional: Maintain old behavior of transparency for Desempenho if desired? 
    // User requested "Cor Estática" -> "cor sólida do partido". 
    // Usually implies full opacity.

    // However, for Desempenho, showing ALL points as solid blue is confusing. 
    // Let's filter out 0 votes visually or keep them?
    if (currentVizMode.startsWith('desempenho') && pctVal === 0) {
      fillOpacity = 0.1; // Dim points with 0 votes slightly or fully?
    }
  }

  const localId = getProp(props, 'local_id') || getProp(props, 'nr_locvot');

  // Highlight selection
  if (selectedLocationIDs.has(String(localId)) && !STATE.isFilterAggregationActive) {
    return {
      color: '#ffffff',     // White border for selection too? Or accent?
      weight: 3,            // Thicker border
      fillColor: 'var(--accent)', // Highlight color
      fillOpacity: 1,
      opacity: 1,
      radius: 8
    };
  }

  // Standard Style
  return {
    color: '#ffffff',       // Always White Border as requested
    weight: 1,              // Short/Thin border
    fillColor: fillColor,
    fillOpacity: fillOpacity,
    opacity: 1              // Border opacity
  };
}

function getVotosValidos(props, cargo, turno, filtrarInaptos) {
  if (!props) return { totalValidos: 0, votosInaptos: 0 };

  const candidatos = STATE.candidates[cargo]?.[turno] || [];
  let somaVotosCandidatos = 0;
  let votosInaptos = 0;

  candidatos.forEach(key => {
    const votos = ensureNumber(getProp(props, key));
    somaVotosCandidatos += votos;
    if (filtrarInaptos && (STATE.inaptos[cargo]?.[turno] || []).includes(key)) {
      votosInaptos += votos;
    }
  });

  const totalValidos = filtrarInaptos ? (somaVotosCandidatos - votosInaptos) : somaVotosCandidatos;
  return { totalValidos: totalValidos, votosInaptos: votosInaptos };
}

function getVencedor(props, cargo, turno, filtrarInaptos) {
  const candidatos = STATE.candidates[cargo]?.[turno];
  if (!candidatos) return { nome: 'N/D', partido: 'N/D', votos: 0, status: 'N/D' };

  let maxVotos = -1;
  let vencedorKey = null;

  candidatos.forEach(key => {
    if (filtrarInaptos && (STATE.inaptos[cargo]?.[turno] || []).includes(key)) {
      return;
    }
    const votos = ensureNumber(getProp(props, key));
    if (votos > maxVotos) {
      maxVotos = votos;
      vencedorKey = key;
    }
  });

  if (vencedorKey) {
    const cand = parseCandidateKey(vencedorKey);
    return { ...cand, votos: maxVotos };
  }
  return { nome: 'N/D', partido: 'N/D', votos: 0, status: 'N/D' };
}

// ====== MAP INTERACTION ======

function onEachFeature(feature, layer) {
  const props = feature.properties;
  const nomeLocal = getProp(props, 'nm_locvot') || 'Local';
  const nomeCidade = getProp(props, 'nm_localidade') || 'Cidade';
  layer.bindTooltip(`<b>${nomeLocal}</b><br>${nomeCidade}`, { sticky: true });
  layer.on('click', onFeatureClick);
}

function onFeatureClick(e) {
  const layer = e.target;
  const props = layer.feature.properties;
  const id = String(getProp(props, 'local_id') || getProp(props, 'nr_locvot'));

  const isShiftClick = e.originalEvent.shiftKey;

  if (STATE.currentElectionType === 'geral') {
    currentCidadeFilter = 'all';

    // CORREÇÃO: Usar o combobox correto em vez de dom.selectCidade/dom.searchCidade
    if (cidadeCombobox) {
      cidadeCombobox.setValue("Todos os municípios");
    }

    dom.searchLocal.disabled = true;
    updateApplyButtonText();
  } else {
    const mun = dom.selectMunicipio.value;
    dom.btnApplyFilters.textContent = `Analisar/Agregar "${mun}"`;
    dom.btnApplyFilters.disabled = false;
  }

  currentBairroFilter = 'all';
  currentLocalFilter = '';

  // CORREÇÃO: Usar o combobox correto em vez de dom.searchBairro
  if (bairroCombobox) {
    bairroCombobox.setValue("Todos os bairros");
  }

  dom.searchLocal.value = '';
  populateBairroDropdown();

  if (!isShiftClick) {
    if (selectedLocationIDs.size === 1 && selectedLocationIDs.has(id)) {
      selectedLocationIDs.clear();
    } else {
      selectedLocationIDs.clear();
      selectedLocationIDs.add(id);
    }
  } else {
    if (selectedLocationIDs.has(id)) selectedLocationIDs.delete(id);
    else selectedLocationIDs.add(id);
  }

  if (currentLayer && currentLayer.resetStyle) currentLayer.resetStyle();
  updateSelectionUI(false);
}

function clearSelection(updateMap = true) {
  selectedLocationIDs.clear();
  STATE.isFilterAggregationActive = false;

  if (updateMap && currentLayer && currentLayer.resetStyle) currentLayer.resetStyle();
  dom.resultsBox.classList.add('section-hidden');
  dom.resultsContent.innerHTML = '<div style="text-align:center; padding: 20px; color:var(--muted);"><p style="margin-bottom:8px">👆</p>Clique no mapa ou use filtros para ver resultados.</div>';
  dom.resultsMetrics.innerHTML = '';
  dom.summaryGrid.innerHTML = '';
  dom.resultsTitle.textContent = 'Resultados da Seleção';
  dom.resultsSubtitle.textContent = '';
  // Reset Unified View
  dom.unifiedResultsContainer.classList.remove('hidden');
  updateNeighborhoodProfileUI();

}

// Função auxiliar para gerar o texto do título baseado nos filtros ativos
function getActiveCensusFilterLabel() {
  const f = STATE.censusFilters;

  // 1. Filtro de Renda
  if (f.rendaMin !== null || f.rendaMax !== null) {
    const min = (f.rendaMin || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
    const max = f.rendaMax ? (f.rendaMax).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : 'Máx (+R$ 10k)';
    return `Renda Média: ${min} a ${max}`;
  }

  // 2. Filtro de Raça/Cor
  if (f.racaVal > 0) {
    // Remove o "Pct" para ficar mais bonito (ex: "Pct Preta" vira "População Preta")
    const label = f.racaMode.replace('Pct ', 'População ');
    return `${label}: Acima de ${f.racaVal}%`;
  }

  // 3. Filtro de Idade
  if (f.idadeVal > 0) {
    return `Idade ${f.idadeMode}: Acima de ${f.idadeVal}% dos moradores`;
  }

  // 4. Filtro de Gênero
  if (f.generoVal > 0) {
    const label = f.generoMode.replace('Pct ', ''); // "Mulheres" ou "Homens"
    return `Gênero (${label}): Acima de ${f.generoVal}%`;
  }

  // 5. Filtro de Saneamento
  if (f.saneamentoVal > 0) {
    const label = f.saneamentoMode.replace('Pct ', '');
    return `Saneamento (${label}): Acima de ${f.saneamentoVal}%`;
  }

  return null; // Nenhum filtro censitário ativo
}

function updateSelectionUI(isFilterAggregation = false) {
  STATE.isFilterAggregationActive = isFilterAggregation;

  const count = selectedLocationIDs.size;
  if (count === 0) {
    clearSelection(false);
    return;
  }

  if (isFilterAggregation) {
    if (currentLayer && currentLayer.resetStyle) currentLayer.resetStyle();
  }

  const aggregatedProps = aggregatePropsForSelection(selectedLocationIDs);
  const year = STATE.currentElectionYear;

  // --- LÓGICA DE TÍTULO ATUALIZADA ---
  if (STATE.currentElectionType === 'municipal') {
    if (isFilterAggregation) {
      const censusLabel = getActiveCensusFilterLabel();

      if (censusLabel) {
        dom.resultsTitle.textContent = `Filtro • ${censusLabel}`;
        dom.resultsSubtitle.textContent = `${count} locais encontrados neste perfil`;
      } else {
        let title = dom.selectMunicipio.value;
        if (currentBairroFilter !== 'all') title += ` • ${currentBairroFilter}`;
        dom.resultsTitle.textContent = title;
        dom.resultsSubtitle.textContent = `${count} locais agregados`;
      }
    } else if (count === 1) {
      const props = aggregatedProps[currentCargo];
      const nomeLocal = getProp(props, 'nm_locvot');
      const bairro = getProp(props, 'ds_bairro') || 'Bairro não inf.';
      const zona = getProp(props, 'nr_zona') || 'Zona não inf.';
      dom.resultsTitle.textContent = nomeLocal;
      dom.resultsSubtitle.textContent = `${bairro} • Zona: ${zona}`;
    } else {
      dom.resultsTitle.textContent = `${count} locais agregados (${year})`;
      dom.resultsSubtitle.textContent = 'Seleção manual com Shift+Click';
    }

    // Esconde comparativo em eleições municipais
    dom.summaryBoxContainer.classList.add('section-hidden');

  } else {
    // --- TIPO GERAL (ESTADO/BR) ---
    if (isFilterAggregation) {
      const censusLabel = getActiveCensusFilterLabel();

      if (censusLabel) {
        dom.resultsTitle.textContent = `Filtro • ${censusLabel}`;
        dom.resultsSubtitle.textContent = `${count} locais correspondem ao filtro`;
      } else {
        let title = currentCidadeFilter;
        if (title === 'all') {
          const uf = dom.selectUFGeneral.value || 'BR';
          title = `Estado Completo (${uf})`;
        }
        if (currentBairroFilter !== 'all') title += ` • ${currentBairroFilter}`;
        dom.resultsTitle.textContent = title;
        dom.resultsSubtitle.textContent = `${count} locais agregados`;
      }
    } else if (count === 1) {
      const props = aggregatedProps[currentCargo];
      const nomeLocal = getProp(props, 'nm_locvot');
      const nomeCidade = getProp(props, 'nm_localidade');
      const bairro = getProp(props, 'ds_bairro') || 'Bairro não inf.';
      const zona = getProp(props, 'nr_zona') || 'Zona não inf.';
      dom.resultsTitle.textContent = nomeLocal;
      dom.resultsSubtitle.textContent = `${nomeCidade} • ${bairro} • Zona: ${zona}`;
    } else {
      dom.resultsTitle.textContent = `${count} locais agregados (${year})`;
      dom.resultsSubtitle.textContent = 'Seleção manual com Shift+Click';
    }

    // --- CORREÇÃO: Exibe o container e Atualiza o ANO do título ---
    dom.summaryBoxContainer.classList.remove('section-hidden');

    // Atualiza o texto do título (h3) para o ano correto
    const titleEl = dom.summaryBoxContainer.querySelector('h3');
    if (titleEl) titleEl.textContent = `Comparativo ${year}`;

    renderSummaryBoxes(aggregatedProps);
  }

  dom.resultsBox.classList.remove('section-hidden');
  setupTurnTabs(aggregatedProps[currentCargo]);

  renderResultsPanel(aggregatedProps[currentCargo], currentCargo);
  updateNeighborhoodProfileUI();
}

function renderSummaryBoxes(aggregatedProps) {
  dom.summaryGrid.innerHTML = '';
  const cargos = ['presidente', 'governador', 'senador'];

  // Configura o listener apenas uma vez
  if (!dom.summaryGrid.dataset.listening) {
    dom.summaryGrid.dataset.listening = "true";
    dom.summaryGrid.addEventListener('click', handleSummaryGridInteraction);
    dom.summaryGrid.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleSummaryGridInteraction(e);
      }
    });
  }

  cargos.forEach(office => {
    let keysToCheck = [`${office}_ord`, `${office}_sup`];
    let props = null;
    let cargoKey = null;

    for (let k of keysToCheck) {
      if (aggregatedProps[k]) {
        props = aggregatedProps[k];
        cargoKey = k;
        break;
      }
    }

    if (!props || Object.keys(props).length === 0) return;

    const turnoKey = (office === 'senador') ? '1T' : (STATE.dataHas2T[cargoKey] && currentTurno === 2) ? '2T' : '1T';
    if (!STATE.candidates[cargoKey]?.[turnoKey]) return;

    // --- CORREÇÃO LÓGICA DE INAPTOS ---
    // 1. Descobrimos quem ganha SE contarmos os inaptos
    const winnerWithInaptos = getVencedor(props, cargoKey, turnoKey, false);

    // 2. A caixa dupla só aparece SE o vencedor for de fato INAPTO ou RENÚNCIA
    const isInaptoWinner = (winnerWithInaptos.status === 'INAPTO' || winnerWithInaptos.status === 'RENÚNCIA');

    if (isInaptoWinner) {
      // Caso Especial: O vencedor é inapto -> Mostra Visão Dupla
      const { totalValidos: tvCom } = getVotosValidos(props, cargoKey, turnoKey, false);

      const vencSemInaptos = getVencedor(props, cargoKey, turnoKey, true);
      const { totalValidos: tvSem } = getVotosValidos(props, cargoKey, turnoKey, true);

      const getPct = (v, total) => total > 0 ? v / total : 0;

      const box = document.createElement('div');
      box.className = 'summary-box-dual';

      box.innerHTML = `
                <div class="dual-item" tabindex="0" role="button" 
                     data-cargo="${office}" data-turno="${turnoKey}" data-filter-inaptos="false"
                     data-status="${winnerWithInaptos.status}">
                    <span style="font-size:0.65rem; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px; display:block;">Com Inaptos</span>
                    <h5 style="margin:0; font-size:0.85rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${winnerWithInaptos.nome}</h5>
                    <p style="margin:0; font-size:0.75rem; color:var(--muted);">${winnerWithInaptos.partido}</p>
                    <strong style="display:block; margin-top:4px; color:var(--accent-2); font-size:0.8rem;">${fmtPct(getPct(winnerWithInaptos.votos, tvCom))}</strong>
                </div>
                <div class="dual-item" tabindex="0" role="button" 
                     data-cargo="${office}" data-turno="${turnoKey}" data-filter-inaptos="true"
                     data-status="${vencSemInaptos.status}">
                    <span style="font-size:0.65rem; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px; display:block;">Sem Inaptos</span>
                    <h5 style="margin:0; font-size:0.85rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${vencSemInaptos.nome}</h5>
                    <p style="margin:0; font-size:0.75rem; color:var(--muted);">${vencSemInaptos.partido}</p>
                    <strong style="display:block; margin-top:4px; color:var(--accent-2); font-size:0.8rem;">${fmtPct(getPct(vencSemInaptos.votos, tvSem))}</strong>
                </div>
            `;
      dom.summaryGrid.appendChild(box);

    } else {
      // Caso Padrão: O vencedor é regular (ou não há inaptos vencendo) -> Box Único
      const vencedorSemInaptos = getVencedor(props, cargoKey, turnoKey, true);
      const { totalValidos } = getVotosValidos(props, cargoKey, turnoKey, true);
      const candidatosValidos = (STATE.candidates[cargoKey][turnoKey] || [])
        .filter(key => !(STATE.inaptos[cargoKey]?.[turnoKey] || []).includes(key))
        .map(key => ({ ...parseCandidateKey(key), votos: ensureNumber(getProp(props, key)) }))
        .sort((a, b) => b.votos - a.votos);

      const segundoColocado = candidatosValidos[1] || { votos: 0 };
      const margemVotos = vencedorSemInaptos.votos - segundoColocado.votos;
      const margemPct = (totalValidos > 0 && vencedorSemInaptos.votos > 0) ? (vencedorSemInaptos.votos / totalValidos) - (segundoColocado.votos / totalValidos) : 0;

      const box = document.createElement('div');
      box.className = 'summary-box';
      box.tabIndex = 0;
      box.role = 'button';
      box.dataset.cargo = office;
      box.dataset.turno = turnoKey;

      box.innerHTML = `
                <h4 class="cargo-title">${office.charAt(0).toUpperCase() + office.slice(1)} (${turnoKey})</h4>
                <h5>${vencedorSemInaptos.nome}</h5>
                <p>${vencedorSemInaptos.partido}</p>
                <span class="margin">+${fmtInt(margemVotos)} (${fmtPct(margemPct)})</span>
            `;
      dom.summaryGrid.appendChild(box);
    }
  });
}
cargos.forEach(office => {
  let keysToCheck = [`${office}_ord`, `${office}_sup`];
  let props = null;
  let cargoKey = null;

  for (let k of keysToCheck) {
    if (aggregatedProps[k]) {
      props = aggregatedProps[k];
      cargoKey = k;
      break;
    }
  }

  if (!props || Object.keys(props).length === 0) return;

  const turnoKey = (office === 'senador') ? '1T' : (STATE.dataHas2T[cargoKey] && currentTurno === 2) ? '2T' : '1T';
  if (!STATE.candidates[cargoKey]?.[turnoKey]) return;

  // Verifica se há votos em candidatos marcados como INAPTO
  const hasInaptosInLocal = STATE.dataHasInaptos[cargoKey] &&
    (STATE.inaptos[cargoKey]?.[turnoKey] || []).some(k => ensureNumber(getProp(props, k)) > 0);

  if (hasInaptosInLocal) {
    // Visão Dupla (Com e Sem Inaptos)
    const vencComInaptos = getVencedor(props, cargoKey, turnoKey, false);
    const { totalValidos: tvCom } = getVotosValidos(props, cargoKey, turnoKey, false);

    const vencSemInaptos = getVencedor(props, cargoKey, turnoKey, true);
    const { totalValidos: tvSem } = getVotosValidos(props, cargoKey, turnoKey, true);

    const getPct = (v, total) => total > 0 ? v / total : 0;

    const box = document.createElement('div');
    box.className = 'summary-box-dual';

    box.innerHTML = `
                <div class="dual-item" tabindex="0" role="button" 
                     data-cargo="${office}" data-turno="${turnoKey}" data-filter-inaptos="false"
                     data-status="${vencComInaptos.status}">
                    <span style="font-size:0.65rem; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px; display:block;">Com Inaptos</span>
                    <h5 style="margin:0; font-size:0.85rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${vencComInaptos.nome}</h5>
                    <p style="margin:0; font-size:0.75rem; color:var(--muted);">${vencComInaptos.partido}</p>
                    <strong style="display:block; margin-top:4px; color:var(--accent-2); font-size:0.8rem;">${fmtPct(getPct(vencComInaptos.votos, tvCom))}</strong>
                </div>
                <div class="dual-item" tabindex="0" role="button" 
                     data-cargo="${office}" data-turno="${turnoKey}" data-filter-inaptos="true"
                     data-status="${vencSemInaptos.status}">
                    <span style="font-size:0.65rem; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px; display:block;">Sem Inaptos</span>
                    <h5 style="margin:0; font-size:0.85rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${vencSemInaptos.nome}</h5>
                    <p style="margin:0; font-size:0.75rem; color:var(--muted);">${vencSemInaptos.partido}</p>
                    <strong style="display:block; margin-top:4px; color:var(--accent-2); font-size:0.8rem;">${fmtPct(getPct(vencSemInaptos.votos, tvSem))}</strong>
                </div>
            `;
    dom.summaryGrid.appendChild(box);

  } else {
    // Visão Padrão (Box Único)
    const vencedorSemInaptos = getVencedor(props, cargoKey, turnoKey, true);
    const { totalValidos } = getVotosValidos(props, cargoKey, turnoKey, true);
    const candidatosValidos = (STATE.candidates[cargoKey][turnoKey] || [])
      .filter(key => !(STATE.inaptos[cargoKey]?.[turnoKey] || []).includes(key))
      .map(key => ({ ...parseCandidateKey(key), votos: ensureNumber(getProp(props, key)) }))
      .sort((a, b) => b.votos - a.votos);

    const segundoColocado = candidatosValidos[1] || { votos: 0 };
    const margemVotos = vencedorSemInaptos.votos - segundoColocado.votos;
    const margemPct = (totalValidos > 0 && vencedorSemInaptos.votos > 0) ? (vencedorSemInaptos.votos / totalValidos) - (segundoColocado.votos / totalValidos) : 0;

    const box = document.createElement('div');
    box.className = 'summary-box';
    box.tabIndex = 0;
    box.role = 'button';
    box.dataset.cargo = office;
    box.dataset.turno = turnoKey;

    box.innerHTML = `
                <h4 class="cargo-title">${office.charAt(0).toUpperCase() + office.slice(1)} (${turnoKey})</h4>
                <h5>${vencedorSemInaptos.nome}</h5>
                <p>${vencedorSemInaptos.partido}</p>
                <span class="margin">+${fmtInt(margemVotos)} (${fmtPct(margemPct)})</span>
            `;
    dom.summaryGrid.appendChild(box);
  }
});


function handleSummaryGridInteraction(e) {
  const target = e.target.closest('[data-cargo]');
  if (!target) return;

  const newCargo = target.dataset.cargo;
  const newTurnoStr = target.dataset.turno;
  const filterInaptosStr = target.dataset.filterInaptos;

  currentOffice = newCargo;
  currentSubType = 'ord';
  currentCargo = `${currentOffice}_${currentSubType}`;

  if (newTurnoStr) {
    currentTurno = (newTurnoStr === '2T') ? 2 : 1;
  }

  if (filterInaptosStr !== undefined) {
    STATE.filterInaptos = (filterInaptosStr === 'true');
    dom.btnToggleInaptos.classList.toggle('active', STATE.filterInaptos);
    dom.btnToggleInaptos.textContent = STATE.filterInaptos ? 'Inaptos Filtrados' : 'Filtrar Inaptos';
  }

  dom.cargoChipsGeneral.querySelectorAll('.chip-button').forEach(b => {
    b.classList.toggle('active', b.dataset.value === newCargo);
  });

  updateElectionTypeUI();
  updateConditionalUI();
  populateCidadeDropdown();
  if (currentCidadeFilter !== 'all') populateBairroDropdown();
  applyFiltersAndRedraw();
  updateSelectionUI(STATE.isFilterAggregationActive);
}

function aggregatePropsForSelection(locationIDs) {
  const aggCollection = {};
  for (const cargo in currentDataCollection) {
    const geojson = currentDataCollection[cargo];
    if (!geojson || !geojson.features) {
      aggCollection[cargo] = null;
      continue;
    }
    const featuresToAgg = [];
    geojson.features.forEach(f => {
      const id = String(getProp(f.properties, 'local_id') || getProp(f.properties, 'nr_locvot'));
      if (locationIDs.has(id)) featuresToAgg.push(f.properties);
    });
    aggCollection[cargo] = aggregatePropsList(featuresToAgg);
  }
  return aggCollection;
}

function aggregatePropsList(listOfProps) {
  if (listOfProps.length === 0) return {};
  const agg = { ...listOfProps[0] };
  const textKeys = new Set([
    'local_id', 'ano', 'sg_uf', 'cd_localid', 'cod_locali', 'nr_zona',
    'nr_locvot', 'nr_cep', 'nm_localidade', 'nm_locvot', 'ds_enderec',
    'ds_bairro', 'SG_UF', 'CD_MUNICIPIO', 'NR_ZONA', 'NR_LOCAL_VOTACAO'
  ]);
  for (const k in agg) {
    if (!textKeys.has(k) && !textKeys.has(k.toLowerCase())) {
      const val = ensureNumber(agg[k]);
      if (!isNaN(val)) agg[k] = 0;
    }
  }
  listOfProps.forEach(props => {
    for (const k in props) {
      if (!textKeys.has(k) && !textKeys.has(k.toLowerCase())) {
        const val = ensureNumber(props[k]);
        if (!isNaN(val) && typeof val === 'number') agg[k] = (agg[k] || 0) + val;
      }
    }
  });
  return agg;
}

function setupTurnTabs(props) {
  dom.turnTabs.innerHTML = '';
  const has1T = (STATE.candidates[currentCargo]?.['1T'] || []).length > 0;
  let has2T = STATE.dataHas2T[currentCargo] || false;

  // CORREÇÃO AQUI: Verificação mais robusta para o 2º Turno
  if (has2T && props) {
    // 1. Tenta pegar o total explícito do arquivo
    let totalVotos2T = ensureNumber(getProp(props, 'Total_Votos_Validos 2T'));

    // 2. Se for zero (ou não existir), calcula somando os candidatos manualmente
    if (totalVotos2T === 0) {
      const { totalValidos } = getVotosValidos(props, currentCargo, '2T', STATE.filterInaptos);
      totalVotos2T = totalValidos;
    }

    // 3. Se ainda assim for zero, aí sim escondemos a aba
    if (totalVotos2T === 0) {
      // Verificação extra: se tiver brancos ou nulos no 2T, mostra a aba mesmo sem votos válidos nominais
      const brancos = ensureNumber(getProp(props, 'Votos_Brancos 2T'));
      const nulos = ensureNumber(getProp(props, 'Votos_Nulos 2T'));
      if ((brancos + nulos) === 0) {
        has2T = false;
      }
    }
  }

  // Lógica de troca automática de aba
  if (currentTurno === 2 && !has2T) currentTurno = 1;
  // Se não tem 1T (ex: eleição que só tem dados de 2T, raro mas possível) forçamos 2
  if (currentTurno === 1 && !has1T && has2T) currentTurno = 2;

  if (has1T) {
    const tab = document.createElement('div');
    tab.className = 'tab' + (currentTurno === 1 ? ' active' : '');
    tab.textContent = '1º Turno';
    tab.dataset.turno = 1;
    tab.addEventListener('click', () => {
      currentTurno = 1;
      updateSelectionUI(STATE.isFilterAggregationActive);
      populateCidadeDropdown();
      populateBairroDropdown();
    });
    dom.turnTabs.appendChild(tab);
  }
  if (has2T) {
    const tab = document.createElement('div');
    tab.className = 'tab' + (currentTurno === 2 ? ' active' : '');
    tab.textContent = '2º Turno';
    tab.dataset.turno = 2;
    tab.addEventListener('click', () => {
      currentTurno = 2;
      updateSelectionUI(STATE.isFilterAggregationActive);
      populateCidadeDropdown();
      populateBairroDropdown();
    });
    dom.turnTabs.appendChild(tab);
  }
}

function getStatusBadge(status) {
  status = status.toUpperCase();
  if (status.startsWith('ELEITO')) return `<span class="status-badge eleito"><svg><use href="#svg-check" /></svg> Eleito</span>`;
  if (status === '2° TURNO' || status === '2º TURNO') return `<span class="status-badge segundo-turno"><svg><use href="#svg-arrow" /></svg> 2º Turno</span>`;
  if (status === 'NÃO ELEITO') return `<span class="status-badge nao-eleito"><svg><use href="#svg-x" /></svg> Não Eleito</span>`;
  if (status === 'INAPTO') return `<span class="status-badge inapto"><svg><use href="#svg-x" /></svg> Inapto</span>`;
  return '';
}

function renderResultsPanel(props, cargo) {
  if (!props || Object.keys(props).length === 0) {
    dom.resultsContent.innerHTML = `<p style="color:var(--muted)">Sem dados para esta seleção.</p>`;
    dom.resultsMetrics.innerHTML = '';
    return;
  }

  const turnoKey = (currentTurno === 2 && STATE.dataHas2T[cargo]) ? '2T' : '1T';
  const candidatos = STATE.candidates[cargo]?.[turnoKey] || [];

  const { totalValidos, votosInaptos } = getVotosValidos(props, cargo, turnoKey, STATE.filterInaptos);

  let results = [];
  candidatos.forEach(key => {
    const cand = parseCandidateKey(key);
    if (STATE.filterInaptos && cand.status === 'INAPTO') return;

    const votos = ensureNumber(getProp(props, key));
    const percentual = (totalValidos > 0) ? (votos / totalValidos) : 0;

    results.push({
      ...cand,
      votos,
      pct: percentual
    });
  });

  results.sort((a, b) => b.votos - a.votos);

  dom.resultsContent.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'grid';

  results.forEach(r => {
    if (r.votos === 0 && results.length > 2) return;

    const div = document.createElement('div');
    div.className = 'cand';
    div.dataset.status = r.status;

    const sw = getColorForCandidate(r.nome, r.partido);
    const safeId = 'color-' + btoa(unescape(encodeURIComponent(r.nome))).replace(/=/g, '');

    div.innerHTML = `
      <div class="cand-header">
        <div class="swatch" style="background:${sw}" 
             onclick="document.getElementById('${safeId}').click()"
             title="Alterar cor"></div>
        <input type="color" id="${safeId}" value="${sw}" style="display:none" 
               onchange="setCandidateColor('${r.nome.replace(/'/g, "\\'")}', this.value)">
        <div class="cand-info">
          <h4 title="${r.nome}">${r.nome}</h4>
          <small title="${r.partido}">${r.partido}</small>
        </div>
      </div>
      <div class="cand-stats">
        <div>
          <span class="bigPct">${fmtPct(r.pct)}</span>
          <span class="smallVotos">${fmtInt(r.votos)}</span>
        </div>
        ${getStatusBadge(r.status)}
      </div>
    `;
    grid.appendChild(div);
  });
  dom.resultsContent.appendChild(grid);

  const brancos = ensureNumber(getProp(props, `Votos_Brancos ${turnoKey}`));
  const nulos = ensureNumber(getProp(props, `Votos_Nulos ${turnoKey}`));
  const comparecimento = totalValidos + brancos + nulos;

  dom.resultsMetrics.innerHTML = `
    <div class="metrics-grid">
      <div class="metric-item"><span>Comparecimento</span><strong>${fmtInt(comparecimento)}</strong></div>
      <div class="metric-item"><span>Votos Válidos (Nominais)</span><strong>${fmtInt(totalValidos)}</strong></div>
      <div class="metric-item"><span>Brancos</span><strong>${fmtInt(brancos)} (${fmtPct(comparecimento > 0 ? brancos / comparecimento : 0)})</strong></div>
      <div class="metric-item"><span>Nulos</span><strong>${fmtInt(nulos)} (${fmtPct(comparecimento > 0 ? nulos / comparecimento : 0)})</strong></div>
      ${votosInaptos > 0 ? `<div class="metric-item"><span>Inaptos (na soma)</span><strong style="color:var(--err)">${fmtInt(votosInaptos)}</strong></div>` : ''}
    </div>
  `;
}

function setCandidateColor(nome, novaCor) {
  CUSTOM_CANDIDATE_COLORS.set(nome, novaCor);
  updateSelectionUI(STATE.isFilterAggregationActive);
  if (currentLayer) currentLayer.setStyle(getFeatureStyle);
}

// ====== VISUAL AVAILABILITY BAR LOGIC ======
function updateAvailabilityBars(geojson) {
  if (!geojson || !geojson.features) return;

  // Initial Limits (Inverted for Min/Max finding)
  let minRenda = 999999, maxRenda = -1;
  let minRaca = 101, maxRaca = -1;
  let minIdade = 101, maxIdade = -1;
  let minGenero = 101, maxGenero = -1;
  let minSaneamento = 101, maxSaneamento = -1;

  let hasData = false;

  const features = geojson.features;
  const total = features.length;

  // Optimization: Sample data if dataset is huge and not filtered by specific city
  // This prevents freezing the UI during calculations on "Whole Country" views
  const isBroadView = (STATE.currentElectionType === 'geral' && currentCidadeFilter === 'all');
  const step = (total > 25000 && isBroadView) ? 20 : 1;

  // Capture current modes once
  const mRaca = STATE.censusFilters.racaMode;
  const mGenero = STATE.censusFilters.generoMode;
  const mSaneamento = STATE.censusFilters.saneamentoMode;
  const mIdade = STATE.censusFilters.idadeMode;

  for (let i = 0; i < total; i += step) {
    const f = features[i];
    const p = f.properties;

    // 1. Check Geographic Base Filters (City/Bairro)
    // We only want availability for the GEOGRAPHICALLY selected area
    if (STATE.currentElectionType === 'geral' && currentCidadeFilter !== 'all') {
      if (getProp(p, 'nm_localidade') !== currentCidadeFilter) continue;
    }
    if (currentBairroFilter !== 'all') {
      const b = getProp(p, 'ds_bairro');
      if (!b || b.trim() !== currentBairroFilter) continue;
    }

    hasData = true;

    // Renda
    const r = ensureNumber(getProp(p, 'Renda Media'));
    if (r > 0) {
      if (r < minRenda) minRenda = r;
      if (r > maxRenda) maxRenda = r;
    }

    // Raça
    const rac = ensureNumber(getProp(p, mRaca));
    if (rac < minRaca) minRaca = rac;
    if (rac > maxRaca) maxRaca = rac;

    // Gênero
    const gen = ensureNumber(getProp(p, mGenero));
    if (gen < minGenero) minGenero = gen;
    if (gen > maxGenero) maxGenero = gen;

    // Saneamento
    const san = ensureNumber(getProp(p, mSaneamento));
    if (san < minSaneamento) minSaneamento = san;
    if (san > maxSaneamento) maxSaneamento = san;

    // Idade (Calculated)
    const idadeSum = calculateAgeSumForProps(p, mIdade);
    if (idadeSum < minIdade) minIdade = idadeSum;
    if (idadeSum > maxIdade) maxIdade = idadeSum;
  }

  // Handle No Data Case
  if (!hasData) {
    setBar('availRenda', 0, 0, 10000);
    setBar('availRaca', 0, 0, 100);
    setBar('availIdade', 0, 0, 100);
    setBar('availGenero', 0, 0, 100);
    setBar('availSaneamento', 0, 0, 100);
    return;
  }

  // Fix infinite bounds if only 0s found
  if (minRenda > maxRenda) { minRenda = 0; maxRenda = 0; }
  if (minRaca > maxRaca) { minRaca = 0; maxRaca = 0; }
  if (minIdade > maxIdade) { minIdade = 0; maxIdade = 0; }
  if (minGenero > maxGenero) { minGenero = 0; maxGenero = 0; }
  if (minSaneamento > maxSaneamento) { minSaneamento = 0; maxSaneamento = 0; }

  // Update Bars
  setBar('availRenda', minRenda, maxRenda, 10000);
  setBar('availRaca', minRaca, maxRaca, 100);
  setBar('availIdade', minIdade, maxIdade, 100);
  setBar('availGenero', minGenero, maxGenero, 100);
  setBar('availSaneamento', minSaneamento, maxSaneamento, 100);
}

function calculateAgeSumForProps(props, mode) {
  let sumPct = 0;
  for (const k in props) {
    if (k.startsWith('Pct ') && k.includes('anos')) {
      const match = k.match(/Pct (\d+) a/);
      if (match) {
        const age = parseInt(match[1]);
        let bucket = null;
        // Updated Buckets logic matching the rest of the app
        if (age >= 15 && age <= 24) bucket = '16-24';
        else if (age >= 25 && age <= 34) bucket = '25-34';
        else if (age >= 35 && age <= 44) bucket = '35-44';
        else if (age >= 45 && age <= 59) bucket = '45-59';
        else if (age >= 60 && age <= 74) bucket = '60-74';
        else if (age >= 75) bucket = '75-100';

        if (bucket === mode) sumPct += ensureNumber(props[k]);
      } else if ((k.includes('95 a 99') || k.includes('100') || k.includes('mais'))) {
        if (mode === '75-100') sumPct += ensureNumber(props[k]);
      }
    }
  }
  return sumPct;
}

function setBar(id, min, max, scale) {
  const el = document.getElementById(id);
  if (!el) return;

  // Clamping
  min = Math.max(0, min);
  max = Math.min(scale, max);

  const left = (min / scale) * 100;
  const width = ((max - min) / scale) * 100;

  el.style.left = `${left.toFixed(2)}%`;
  el.style.width = `${width.toFixed(2)}%`;
}
