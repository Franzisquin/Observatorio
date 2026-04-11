// ============================================
// SIMULADOR ELEITORAL 2026 — Standalone
// ============================================

const DATA_BASE_URL = 'resultados_geo/';

// CORES / PARTIDOS (subset do app.js principal)
const PARTY_COLORS = new Map(Object.entries({
  'AVANTE': '#2eacb2', 'CIDADANIA': '#ec008c', 'DC': '#c89721', 'DEM': '#8CC63E',
  'MDB': '#009959', 'MISSÃO': '#fcbe26', 'MOBILIZA': '#DD3333', 'NOVO': '#ec671c', 'PAN': '#ffff00',
  'PCB': '#a8231c', 'PCDOB': '#800314', 'PCO': '#9F030A', 'PDT': '#FE8E6D',
  'PL': '#30306C', 'PMN': '#CF7676', 'PODE': '#00d663', 'PP': '#3672c9',
  'PROS': '#f48c24', 'PRTB': '#245ba0', 'PSB': '#FFCC00', 'PSC': '#006f41',
  'PSD': '#89a02c', 'PSDB': '#0096ff', 'PSL': '#054577', 'PSOL': '#68018D',
  'PSTU': '#c92127', 'PT': '#C0122D', 'PTB': '#005533', 'PV': '#01652F',
  'REDE': '#3ca08c', 'REPUBLICANOS': '#005CA9', 'SOLIDARIEDADE': '#f37021',
  'UNIÃO': '#01f6fe', 'UP': '#000000', 'PMDB': '#009959', 'SD': '#f37021',
  'PR': '#30306C', 'PC DO B': '#b4251d'
}));

const PARTY_COLOR_OVERRIDES = new Map(Object.entries({
  'AVANTE': '#36aeba',
  'CIDADANIA': '#ec5fa6',
  'DC': '#809eff',
  'DEM': '#91d364',
  'MDB': '#16a250',
  'MISSAO': '#fdbe21',
  'NOVO': '#ed8f5a',
  'PCB': '#c40823',
  'PCDOB': '#de3e35',
  'PC DO B': '#de3e35',
  'PCO': '#8e3d10',
  'PDS': '#6391d4',
  'PDT': '#ffc2b3',
  'PHS': '#e25850',
  'PL': '#5b6dc8',
  'PMN': '#ff3333',
  'PODE': '#23a840',
  'PODEMOS': '#23a840',
  'PP': '#6391d4',
  'PPL': '#c6a815',
  'PROS': '#e6661e',
  'PRTB': '#1a7e2f',
  'PSC': '#2f8e4f',
  'PSB': '#ffc133',
  'PSD': '#ffaf4c',
  'PSDB': '#24a5ff',
  'PSL': '#5dca53',
  'PSOL': '#e95dd2',
  'PSTU': '#620411',
  'PT': '#ff3859',
  'PTB': '#a1787d',
  'PTC': '#37c884',
  'PTN': '#23a840',
  'PTR': '#1a7e2f',
  'PV': '#67cd8a',
  'PRP': '#ffe099',
  'PRONA': '#0f6c36',
  'PRD': '#007c3c',
  'PFL': '#91d364',
  'PPS': '#ec5fa6',
  'PR': '#30306c',
  'PRB': '#45bdc9',
  'REDE': '#7dd1d9',
  'REPUBLICANOS': '#45bdc9',
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

const SIM_LAYERS = ['macro', 'estado', 'municipio', 'local'];
const CATEGORIES = ['transfer_2022', 'religiao', 'idade', 'escolaridade', 'renda'];

const CAPITAIS_IBGE = {
  'AC': '1200401', 'AL': '2704302', 'AM': '1302603', 'AP': '1600303',
  'BA': '2927408', 'CE': '2304400', 'DF': '5300108', 'ES': '3205309',
  'GO': '5208707', 'MA': '2111300', 'MG': '3106200', 'MS': '5002704',
  'MT': '5103403', 'PA': '1501402', 'PB': '2507507', 'PE': '2611606',
  'PI': '2211001', 'PR': '4106902', 'RJ': '3304557', 'RN': '2408102',
  'RO': '1100205', 'RR': '1400100', 'RS': '4314902', 'SC': '4205407',
  'SE': '2800308', 'SP': '3550308', 'TO': '1721000'
};

const UF_MAP = new Map([
  ['AC','Acre'],['AL','Alagoas'],['AP','Amapá'],['AM','Amazonas'],['BA','Bahia'],
  ['CE','Ceará'],['DF','Distrito Federal'],['ES','Espírito Santo'],['GO','Goiás'],
  ['MA','Maranhão'],['MT','Mato Grosso'],['MS','Mato Grosso do Sul'],['MG','Minas Gerais'],
  ['PA','Pará'],['PB','Paraíba'],['PR','Paraná'],['PE','Pernambuco'],['PI','Piauí'],
  ['RJ','Rio de Janeiro'],['RN','Rio Grande do Norte'],['RS','Rio Grande do Sul'],
  ['RO','Rondônia'],['RR','Roraima'],['SC','Santa Catarina'],['SP','São Paulo'],
  ['SE','Sergipe'],['TO','Tocantins']
]);

const MAP_TILES = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
};

// Grupos demográficos
const DEMO_GROUPS = {
  genero:   { label: 'Gênero',    subgrupos: { M: 'Homem', F: 'Mulher' } },
  idade:    { label: 'Idade',     subgrupos: { '16-29': '16 a 29', '30-45': '30 a 45', '46-59': '46 a 59', '60+': '60+' } },
  educacao: { label: 'Educação',  subgrupos: { fundamental: 'Fundamental', medio: 'Médio', superior: 'Superior' } },
  renda:    { label: 'Renda',     subgrupos: { '0-1k': 'Até R$1.000', '1k-2k': '1 a 2 mil', '2k-3k': '2 a 3 mil', '3k-4k': '3 a 4 mil', '4k-5k': '4 a 5 mil', '5k+': '5 mil+' } },
  religiao: { label: 'Religião',  subgrupos: { catolico: 'Católica', evangelico: 'Evangélica', outras: 'Outras', semReligiao: 'Sem Religião' } },
  voto2022: { label: 'Voto 2022 (2T)', subgrupos: { lula: 'Lula (PT)', bolsonaro: 'Bolsonaro (PL)', nuloBranco: 'Nulo/Branco', abstencao: 'Abstenção' } }
};


// ====== STATE ======
const SIM = {
  modo: 'presidencial', // 'presidencial' ou 'governador'
  estadoAlvo: null,     // null se presidencial, ou sigla UF (ex: 'MG') se governador
  candidatos: [],
  nextId: 1,
  sliders: {},
  resultadosPorUF: {},
  resultadosPorMuni: {},
  overridesPorUF: {},
  overridesPorMuni: {}, // { [muniCode]: { [candKey]: percentage } }
  totalBrasil: {},
  locaisCache: {}, 
  estadosGeoJSON: null,
  estadosLayer: null,
  municipiosLayer: null,
  locaisLayer: null,
  selectedUF: null,
  selectedMuni: null,
  currentDemoGroup: 'genero',
  religiaoMuni: {},
  // Cache para geometrias municipais dinâmicas do IBGE (por UF)
  ibgeMuniGeoCache: {},
  // Regiões IBGE: dados carregados do JSON
  regioesIBGE: null,
  // Sliders regionais: { [código_região]: { cand_1: 50, outros: 20, ... } }
  regionSliders: {},
  // Sliders de macrorregião (presidencial): { '1': { cand_1: 50, ... }, ... }
  macroSliders: {},
  // Seções expandidas (IDs das seções)
  expandedSections: new Set(),
  // Tab atual da sidebar
  currentSidebarTab: 'resultado'
};

let simMap, simTileLayer;
let simMapResizeObserver = null;
let simMapRefreshFrame = 0;
let simMapRefreshTimeout = 0;

// ====== UTILS ======
function fmtInt(n) { return (n || 0).toLocaleString('pt-BR'); }
function fmtPct(p) { return isFinite(p) ? p.toFixed(2).replace('.', ',') + '%' : '-'; }

function ensureNumber(v) {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v !== 'string') v = String(v || 0);
  const n = Number(v.replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function normalizePartyKey(partido) {
  return String(partido || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toUpperCase();
}

function getPartyColor(partido) {
  const cleanParty = normalizePartyKey(partido);
  return PARTY_COLOR_OVERRIDES.get(cleanParty) || PARTY_COLORS.get(cleanParty);
}

function flushSimMapRefresh() {
  if (!simMap) return;

  try {
    simMap.invalidateSize({ pan: false, debounceMoveend: true });
  } catch (e) {
    console.warn('Sim map invalidateSize failed:', e);
  }

  simMap.eachLayer(layer => {
    if (typeof layer.redraw === 'function') {
      try {
        layer.redraw();
      } catch (e) {
        console.warn('Sim layer redraw failed:', e);
      }
    }
  });
}

function scheduleSimMapRefresh() {
  if (!simMap) return;

  if (simMapRefreshFrame) cancelAnimationFrame(simMapRefreshFrame);
  if (simMapRefreshTimeout) clearTimeout(simMapRefreshTimeout);

  let ran = false;
  const run = () => {
    if (ran) return;
    ran = true;
    flushSimMapRefresh();
  };

  simMapRefreshFrame = requestAnimationFrame(() => {
    simMapRefreshFrame = requestAnimationFrame(() => {
      simMapRefreshFrame = 0;
      run();
    });
  });

  simMapRefreshTimeout = setTimeout(() => {
    simMapRefreshTimeout = 0;
    run();
  }, 180);
}

function setupSimMapRefreshObservers() {
  const mapElement = document.getElementById('map');
  if (!mapElement) return;

  window.addEventListener('load', scheduleSimMapRefresh);
  window.addEventListener('resize', scheduleSimMapRefresh);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleSimMapRefresh();
  });

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => scheduleSimMapRefresh()).catch(() => {});
  }

  if (window.ResizeObserver) {
    if (simMapResizeObserver) simMapResizeObserver.disconnect();
    simMapResizeObserver = new ResizeObserver(() => scheduleSimMapRefresh());
    simMapResizeObserver.observe(mapElement);
  }
}


// --- COLOR UTILS (same as visualizer) ---
function hexToHSL(H) {
  let r = 0, g = 0, b = 0;
  if (H.length == 4) {
    r = "0x" + H[1] + H[1]; g = "0x" + H[2] + H[2]; b = "0x" + H[3] + H[3];
  } else if (H.length == 7) {
    r = "0x" + H[1] + H[2]; g = "0x" + H[3] + H[4]; b = "0x" + H[5] + H[6];
  }
  r /= 255; g /= 255; b /= 255;
  let cmin = Math.min(r, g, b), cmax = Math.max(r, g, b), delta = cmax - cmin, h = 0, s = 0, l = 0;
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
  s /= 100; l /= 100;
  let c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (0 <= h && h < 60)   { r = c; g = x; b = 0; }
  else if (60 <= h && h < 120)  { r = x; g = c; b = 0; }
  else if (120 <= h && h < 180) { r = 0; g = c; b = x; }
  else if (180 <= h && h < 240) { r = 0; g = x; b = c; }
  else if (240 <= h && h < 300) { r = x; g = 0; b = c; }
  else if (300 <= h && h < 360) { r = c; g = 0; b = x; }
  r = Math.round((r + m) * 255).toString(16).padStart(2, '0');
  g = Math.round((g + m) * 255).toString(16).padStart(2, '0');
  b = Math.round((b + m) * 255).toString(16).padStart(2, '0');
  return '#' + r + g + b;
}

function getUniversalGradientColor(baseColorHex, pct) {
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  const hsl = hexToHSL(baseColorHex);
  const targetL = 70 - (pct / 100) * 40;
  return hslToHex(hsl.h, hsl.s, targetL);
}
let ZIP_INDEX = null;
let ZIP_READERS = new Map();

async function loadZipIndex() {
  try {
    const res = await fetch(DATA_BASE_URL + 'zip_index.json');
    if (res.ok) {
      ZIP_INDEX = await res.json();
    } else {
      ZIP_INDEX = {};
    }
  } catch (e) {
    ZIP_INDEX = {};
  }
}

async function fetchGeoJSON(path) {
  if (ZIP_INDEX === null) await loadZipIndex();
  let relativePath = path.startsWith(DATA_BASE_URL) ? path.substring(DATA_BASE_URL.length) : path;

  if (ZIP_INDEX && ZIP_INDEX[relativePath]) {
    const entry = ZIP_INDEX[relativePath];
    const zipUrl = DATA_BASE_URL + entry.zip;
    let reader = ZIP_READERS.get(zipUrl);
    if (!reader) {
      reader = await unzipit.unzip(zipUrl);
      ZIP_READERS.set(zipUrl, reader);
    }
    let fileEntry = reader.entries[entry.file];
    if (!fileEntry) {
      const lowerName = entry.file.toLowerCase();
      for (const k in reader.entries) {
        if (k.toLowerCase() === lowerName) { fileEntry = reader.entries[k]; break; }
      }
    }
    if (!fileEntry) throw new Error("File not found in zip");
    const blob = await fileEntry.blob('application/json');
    return JSON.parse(await blob.text());
  }
  const response = await fetch(path);
  return await response.json();
}

// ====== INIT ======
window.addEventListener('DOMContentLoaded', initSimulador);

async function initSimulador() {
  document.body.dataset.theme = 'dark';

  // Theme toggle
  const themeBtn = document.getElementById('themeToggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const isDark = document.body.dataset.theme === 'dark';
      document.body.dataset.theme = isDark ? 'light' : 'dark';
      themeBtn.textContent = 'Tema';
      if (simTileLayer) simTileLayer.setUrl(isDark ? MAP_TILES.light : MAP_TILES.dark);
      if (SIM.estadosLayer) simRenderMapaEstados();
      scheduleSimMapRefresh();
    });
  }

  // Map
  simMap = L.map('map', { zoomControl: false, minZoom: 3 }).setView([-14, -52], 4);
  simTileLayer = L.tileLayer(MAP_TILES.dark, {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    subdomains: 'abcd', maxZoom: 18
  }).addTo(simMap);
  L.control.zoom({ position: 'bottomright' }).addTo(simMap);
  setupSimMapRefreshObservers();
  simMap.whenReady(() => scheduleSimMapRefresh());
  scheduleSimMapRefresh();

  // Load data
  document.getElementById('mapLoader').classList.add('visible');
  document.getElementById('mapLoader').textContent = 'Carregando dados do simulador...';
  await loadSimuladorData();
  document.getElementById('mapLoader').classList.remove('visible');

  // Init default candidates and mode
  simInitDefaultSliders();
  if (SIM.modo === 'presidencial') {
    simAddCandidato('Lula', 'PT');
    simAddCandidato('Flávio Bolsonaro', 'PL');
    simAddCandidato('Renan Santos', 'MISSÃO');
    simAddCandidato('Ronaldo Caiado', 'PSD');
  }

  // Populate party datalist
  const dl = document.getElementById('sim-party-list');
  if (dl) PARTY_COLORS.forEach((_, p) => { const o = document.createElement('option'); o.value = p; dl.appendChild(o); });

  // Render UI
  simRenderAlvoSelector();
  simRenderCandidatos();
  simRenderDemoGroup();

  // Bindings
  document.getElementById('btnAddCand').addEventListener('click', () => { simAddCandidato('', ''); simRenderCandidatos(); simRenderDemoGroup(); });
  document.getElementById('btnAplicarSimModal')?.addEventListener('click', simAplicar);
  
  document.getElementById('btnVoltar')?.addEventListener('click', simVoltarNivel);

  // Modal handlers
  document.getElementById('btnOpenConfigMain')?.addEventListener('click', () => { 
    document.getElementById('simConfigOverlay').classList.add('visible'); 
  });
  
  // New Unified Sidebar Tab Switcher
  document.querySelectorAll('#simPanelResults .chip-button').forEach(btn => {
    btn.addEventListener('click', e => {
      const tab = e.target.dataset.tab;
      simSidebarTabSwitch(tab);
    });
  });

  // Global Edit button (Modal)
  document.getElementById('btnEditSimGlobal')?.addEventListener('click', () => {
    document.getElementById('simConfigOverlay').classList.add('visible');
  });

  // Modal close
  document.getElementById('btnCloseConfigModal')?.addEventListener('click', () => { 
    document.getElementById('simConfigOverlay').classList.remove('visible'); 
  });

  // Start with modal open
  document.getElementById('simConfigOverlay').classList.add('visible');
}

// ====== DATA ======
async function loadSimuladorData() {
  try {
    SIM.religiaoMuni = await fetchGeoJSON(DATA_BASE_URL + 'religiao_municipios.json').catch(e => ({}));
    SIM.tseDemographics = await fetchGeoJSON(DATA_BASE_URL + 'tse_demographics_locais.json').catch(e => ({}));
    SIM.disDemograficaEstados = await fetchGeoJSON(DATA_BASE_URL + 'distribuicao_demografica_estados.json').catch(e => ({}));
    SIM.regioesIBGE = await fetchGeoJSON(DATA_BASE_URL + 'regioes_ibge.json').catch(e => null);
    if (!SIM.regioesIBGE) console.warn('regioes_ibge.json não encontrado - sliders regionais desabilitados');
    
    const geoRes = await fetch(DATA_BASE_URL + 'estados_brasil.geojson');
    if (!geoRes.ok) throw new Error('Dados não encontrados');
    SIM.estadosGeoJSON = await geoRes.json();
    
    // Lazy load the states data
    const loader = document.getElementById('mapLoader');
    let loadedCount = 0;
    const CHUNK_SIZE = 5;
    const ufKeys = Array.from(UF_MAP.keys()).filter(k => k !== 'BR');
    
    SIM.municipiosCache = {};

    for (let i = 0; i < ufKeys.length; i += CHUNK_SIZE) {
      const chunk = ufKeys.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map(async (uf) => {
        const presPath = `presidente_por_estado2022/presidente_${uf}_2022.geojson`;
        const govPath = `governador2022/governador_${uf}_2022.geojson`;
        const locPath = `locais_votacao_2022/locais_votacao_2022_${uf}.geojson`;
        const muniPath = `municipios/municipios_${uf}.geojson`;

        try {
          const presData = await fetchGeoJSON(presPath).catch(e=>null);
          const govData = await fetchGeoJSON(govPath).catch(e=>null);
          const locData = await fetchGeoJSON(locPath).catch(e=>null);
          const muniData = await fetchGeoJSON(muniPath).catch(e=>null);
          
          if(muniData) {
            SIM.municipiosCache[uf] = muniData;
          }

          if(!presData) return;
          
          const locaisMap = new Map();
          if (locData && locData.features) {
            locData.features.forEach(f => {
              locaisMap.set(String(f.properties.local_id || f.properties.nr_locvot), f.properties);
            });
          }
          
          const govMap = new Map();
          if (govData && govData.features) {
             govData.features.forEach(f => {
                 // Try match NR_LOCAL_VOTACAO and NR_ZONA
                 const p = f.properties;
                 govMap.set(`${p.NR_ZONA}_${p.NR_LOCAL_VOTACAO}`, p);
             });
          }

          const featuresFinais = [];
          presData.features.forEach(f => {
            let id = String(f.properties.local_id || f.properties.NR_LOCAL_VOTACAO);
            const demoProps = locaisMap.get(id);
            if (demoProps) {
              f.properties = { ...f.properties, ...demoProps };
            }
            
            let govProps = govMap.get(`${f.properties.NR_ZONA}_${f.properties.NR_LOCAL_VOTACAO}`);
            if (govProps) {
                // Prefix gov properties to avoid overlaps except 1T keys which are candidates
                const filteredGovProps = {};
                for (let k in govProps) {
                    if (k.includes('1T') || k.includes('2T') || k.includes('Gov_')) {
                        filteredGovProps[`Gov_${k}`] = govProps[k];
                    }
                }
                f.properties = { ...f.properties, ...filteredGovProps };
            }
            
            if(f.geometry && f.geometry.type === "Point") {
               featuresFinais.push(f);
            }
          });
          SIM.locaisCache[uf] = { type: 'FeatureCollection', features: featuresFinais };
        } catch(e) {
          console.error("Erro no uf:", uf, e);
        }
      }));
      loadedCount += chunk.length;
      loader.textContent = `Carregando locais de votação... (${Math.min(loadedCount, ufKeys.length)}/27 Estados)`;
    }
  } catch (e) {
    console.error('Erro ao carregar dados:', e);
    alert('Erro ao carregar dados do simulador.');
  }
}

// ====== CANDIDATOS ======
function simAddCandidato(nome = '', partido = '') {
  const cor = getPartyColor(partido) || '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6,'0');
  const c = { id: SIM.nextId++, nome, partido, cor };
  SIM.candidatos.push(c);
  for (const cat in DEMO_GROUPS) {
    if (!SIM.sliders[cat]) SIM.sliders[cat] = {};
    for (const sub in DEMO_GROUPS[cat].subgrupos) {
      if (!SIM.sliders[cat][sub]) SIM.sliders[cat][sub] = {};
      SIM.sliders[cat][sub][`cand_${c.id}`] = 0;
    }
  }
  return c;
}

// Helper: returns the list of slider keys for a given category
function simGetKeysForCat(cat) {
  const keys = SIM.candidatos.map(c => `cand_${c.id}`).concat(['outros']);
  if (cat === 'voto2022') {
    keys.push('nuloBranco', 'abstencao');
  }
  return keys;
}

function simRemoveCandidato(id) {
  SIM.candidatos = SIM.candidatos.filter(c => c.id !== id);
  for (const cat in SIM.sliders) for (const sub in SIM.sliders[cat]) delete SIM.sliders[cat][sub][`cand_${id}`];
}

function simInitDefaultSliders() {
  for (const cat in DEMO_GROUPS) {
    if (!SIM.sliders[cat]) SIM.sliders[cat] = {};
    for (const sub in DEMO_GROUPS[cat].subgrupos) {
      if (!SIM.sliders[cat][sub]) SIM.sliders[cat][sub] = {};
      // Iniciar todos os valores puros em 0
      SIM.sliders[cat][sub].outros = 0;
      if (cat === 'voto2022') {
        SIM.sliders[cat][sub].nuloBranco = 0;
        SIM.sliders[cat][sub].abstencao = 0;
      }
    }
  }
}

// ====== RENDER CANDIDATOS (Left Panel) ======
function simRenderAlvoSelector() {
  const container = document.getElementById('simCandList');
  if (!container) return;
  // We'll prepend the selector above the candidates list
  
  let optionsHtml = `<option value="BR" style="background:var(--input-bg); color:var(--text);" ${SIM.modo === 'presidencial' ? 'selected' : ''}>Brasil (Presidencial)</option>`;
  Array.from(UF_MAP.entries()).sort((a,b)=>a[1].localeCompare(b[1])).forEach(([sigla, nome]) => {
     const isSelected = SIM.modo === 'governador' && SIM.estadoAlvo === sigla;
     optionsHtml += `<option value="${sigla}" style="background:var(--input-bg); color:var(--text);" ${isSelected ? 'selected' : ''}>${nome} (Governador)</option>`;
  });

  const selectorHtml = `
    <div style="margin-bottom:20px;">
      <label style="display:block;margin-bottom:8px;font-weight:600;font-size:0.9rem;">Alvo da Simulação</label>
      <select id="simAlvoSelector" class="sim-cand-partido" style="width:100%; border:1px solid var(--border-color); background:var(--input-bg); color:var(--text); padding:8px; border-radius:4px; outline:none;">
        ${optionsHtml}
      </select>
    </div>
  `;
  
  // Insert before the cand list or as the first element if empty
  const wrapper = document.createElement('div');
  wrapper.id = 'simAlvoWrapper';
  wrapper.innerHTML = selectorHtml;
  container.parentElement.insertBefore(wrapper, container);

  document.getElementById('simAlvoSelector').addEventListener('change', async (e) => {
    const val = e.target.value;
    
    // Reset regional sliders on target change
    SIM.regionSliders = {};
    SIM.macroSliders = {};
    
    // Reset overriding maps
    SIM.overridesPorUF = {};
    Object.keys(SIM.resultadosPorUF).forEach(k => delete SIM.resultadosPorUF[k]);
    Object.keys(SIM.resultadosPorMuni).forEach(k => delete SIM.resultadosPorMuni[k]);
    
    document.getElementById('mapLoader').classList.add('visible');
    try {
      if (val === 'BR') {
         SIM.modo = 'presidencial';
         SIM.estadoAlvo = null;
         DEMO_GROUPS.voto2022.label = 'Voto 2022 (2T)';
         DEMO_GROUPS.voto2022.subgrupos = { lula: 'Lula (PT)', bolsonaro: 'Bolsonaro (PL)', nuloBranco: 'Nulo/Branco', abstencao: 'Abstenção' };
         // Reset cands and add default ones
         SIM.candidatos = [];
         SIM.sliders = {};
         simInitDefaultSliders();
         simAddCandidato('Lula', 'PT');
         simAddCandidato('Flávio Bolsonaro', 'PL');
         simAddCandidato('Renan Santos', 'MISSÃO');
         simAddCandidato('Ronaldo Caiado', 'PSD');
      } else {
         SIM.modo = 'governador';
         SIM.estadoAlvo = val;
         DEMO_GROUPS.voto2022.label = `Voto Gov. 2022 1T`;
         
         // Extract candidates dynamically for this UF > 1%
         const geo = SIM.locaisCache[val];
         if(!geo) {
             // Maybe lazy load it here if not loaded yet, though we did load it during initialization.
             throw new Error("Dados do estado ainda não foram carregados");
         }
         
         // Dynamically parse keys
         let testFeature = geo.features.find(f => Object.keys(f.properties).some(k => k.startsWith('Gov_')));
         if (!testFeature) testFeature = geo.features[0];
         
         const keys = Object.keys(testFeature.properties).filter(k => k.includes('1T') && k.startsWith('Gov_'));
         const sums = {};
         geo.features.forEach(f => {
            const p = f.properties;
            keys.forEach(k => sums[k] = (sums[k] || 0) + (Number(p[k]) || 0));
         });
         
         const validTotal = sums['Gov_Total_Votos_Validos 1T'] || 1;
         const subgrupos = {};
         
         // Candidates > 1%
         const candKeys = keys.filter(k => k !== 'Gov_Total_Votos_Validos 1T' && k !== 'Gov_Eleitores_Aptos 1T' && k !== 'Gov_Votos_Brancos 1T' && k !== 'Gov_Votos_Nulos 1T' && k !== 'Gov_Abstenções 1T' && !k.includes('Absten'));
         
         // Start with empty candidate list
         SIM.candidatos = [];
         SIM.sliders = {};
         simInitDefaultSliders();

         candKeys.forEach(k => {
             const pct = sums[k] / validTotal;
             if (pct > 0.01) {
                 // Format name nicely: e.g. "Gov_GLADSON CAMELI (PP) (ELEITO) 1T" -> "Gladson Cameli (PP)"
                 let name = k.replace('Gov_', '').replace(/ \((ELEITO|NÃO ELEITO|NO ELEITO|2.*? TURNO)\)/gi, '').replace(/ 1T$/i, '').trim();
                 
                 // extract party if exists like (PT)
                 let party = '';
                 const partyMatch = name.match(/\(([^)]+)\)$/);
                 if (partyMatch) { party = partyMatch[1]; name = name.replace(partyMatch[0], '').trim(); }
                 
                 name = name.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
                 subgrupos[k] = name;
                 
                 // Add this candidate to the Left Panel (output candidates)
                 simAddCandidato(name, party);
             }
         });
         
         subgrupos['outros'] = 'Outros (Gov < 1%)';
         subgrupos['nuloBranco'] = 'Nulo/Branco';
         subgrupos['abstencao'] = 'Abstenção';
         
         DEMO_GROUPS.voto2022.subgrupos = subgrupos;
      }
      simRenderCandidatos();
      simRenderDemoGroup();
    } catch(err) {
       console.error(err);
       alert("Erro ao trocar alvo da simulação.");
    } finally {
       document.getElementById('mapLoader').classList.remove('visible');
    }
  });
}

function simRenderCandidatos() {
  const container = document.getElementById('simCandList');
  if (!container) return;

  let html = '';
  SIM.candidatos.forEach(c => {
    html += `
      <div class="sim-cand-item" data-id="${c.id}">
        <input type="color" class="sim-cand-color" value="${c.cor}" data-id="${c.id}">
        <input type="text" class="sim-cand-nome" value="${c.nome}" placeholder="Nome" data-id="${c.id}">
        <input type="text" class="sim-cand-partido" value="${c.partido}" placeholder="Partido" data-id="${c.id}" list="sim-party-list">
        <button class="sim-cand-remove" data-id="${c.id}">✕</button>
      </div>`;
  });

  // Perenes
  html += `
    <div class="sim-perene-item"><span class="sim-perene-dot" style="background:#7a8699"></span> Outros (definido nos sliders)</div>
    <div class="sim-perene-item"><span class="sim-perene-dot" style="background:#a0a0a0"></span> Brancos/Nulos (apenas Voto 2022)</div>
    <div class="sim-perene-item"><span class="sim-perene-dot" style="background:#555"></span> Abstenção (apenas Voto 2022)</div>`;

  container.innerHTML = html;

  // Bind events
  container.querySelectorAll('.sim-cand-nome').forEach(el => el.addEventListener('change', e => {
    const c = SIM.candidatos.find(cc => cc.id === +e.target.dataset.id);
    if (c) { c.nome = e.target.value; simRenderDemoGroup(); }
  }));

  container.querySelectorAll('.sim-cand-partido').forEach(el => el.addEventListener('change', e => {
    const c = SIM.candidatos.find(cc => cc.id === +e.target.dataset.id);
    if (c) {
      c.partido = e.target.value;
      const auto = getPartyColor(c.partido);
      if (auto) {
        c.cor = auto;
        const ci = container.querySelector(`.sim-cand-color[data-id="${c.id}"]`);
        if (ci) ci.value = auto;
      }
      simRenderDemoGroup();
    }
  }));

  container.querySelectorAll('.sim-cand-color').forEach(el => el.addEventListener('change', e => {
    const c = SIM.candidatos.find(cc => cc.id === +e.target.dataset.id);
    if (c) { c.cor = e.target.value; simRenderDemoGroup(); }
  }));

  container.querySelectorAll('.sim-cand-remove').forEach(el => el.addEventListener('click', e => {
    simRemoveCandidato(+e.target.dataset.id);
    simRenderCandidatos();
    simRenderDemoGroup();
  }));
}

// ====== RENDER DEMO GROUP (Left Panel) ======
function simRenderDemoGroup() {
  const container = document.getElementById('simDemoContent');
  if (!container) return;

  let html = '';

  // REGIONAL SLIDERS
  html += simBuildRegionSlidersHTML();

  // VOTO 2022 (TREATED AS PRIMARY FACTOR)
  const catVoto = 'voto2022';
  const groupVoto = DEMO_GROUPS[catVoto];
  const catEntriesVoto = SIM.candidatos.map(c => ({ key: `cand_${c.id}`, label: c.nome || `Cand. ${c.id}`, cor: c.cor }))
    .concat([{ key: 'outros', label: 'Outros', cor: '#7a8699' }, { key: 'nuloBranco', label: 'Nulos/Brancos', cor: '#a0a0a0' }, { key: 'abstencao', label: 'Abstenção', cor: '#555' }]);
  
  const isExpanded = SIM.expandedSections.has('demo_voto2022');

  html += '<div style="margin-bottom: 24px;">';
  html += `<h4 class="sim-region-header" style="margin:0 0 10px 0; border-bottom:1px solid var(--border-color); padding-bottom:6px; color:var(--text); display:flex; justify-content:space-between; align-items:center; cursor:pointer;" data-section-id="demo_voto2022">
    <span>Transferência de votos (Eleição 2022)</span>
    <div class="sim-section-toggle ${isExpanded ? 'open' : ''}"><span class="sim-arrow"></span></div>
  </h4>`;
  
  html += `<div class="sim-section-content ${isExpanded ? '' : 'collapsed'}" id="section_demo_voto2022">`;
  for (const [subKey, subLabel] of Object.entries(groupVoto.subgrupos)) {
    const subData = SIM.sliders[catVoto]?.[subKey] || {};
    const total = catEntriesVoto.reduce((s, e) => s + (subData[e.key] || 0), 0);
    const isValid = Math.abs(total - 100) < 0.5;

    html += `<div class="sim-subgroup" data-cat="${catVoto}" data-sub="${subKey}">`;
    html += `<div class="sim-subgroup-title">${subLabel}</div>`;
    html += `<div class="sim-total-indicator ${isValid ? 'valid' : 'invalid'}">Total: ${total.toFixed(1)}%</div>`;

    catEntriesVoto.forEach(entry => {
      const val = subData[entry.key] || 0;
      html += `
        <div class="sim-slider-row">
          <span class="sim-slider-indicator" style="background:${entry.cor}"></span>
          <span class="sim-slider-label" title="${entry.label}">${entry.label}</span>
          <input type="range" class="sim-slider" min="0" max="100" step="0.5" value="${val}"
                 data-cat="${catVoto}" data-sub="${subKey}" data-entry="${entry.key}">
          <input type="number" class="sim-slider-val" min="0" max="100" step="0.01" value="${val.toFixed(2)}"
                 data-cat="${catVoto}" data-sub="${subKey}" data-entry="${entry.key}">
          <span class="sim-slider-pct">%</span>
        </div>`;
    });
    html += '</div>';
  }
  html += '</div></div>';

  container.innerHTML = html;

  // Bind slider events
  container.querySelectorAll('.sim-subgroup .sim-slider').forEach(sl => {
    sl.addEventListener('input', e => {
      const { cat: c, sub: s, entry: en } = e.target.dataset;
      if (!c || !s) return; // Safeguard against non-demographic sliders
      
      let v = parseFloat(e.target.value);
      if (!SIM.sliders[c]) SIM.sliders[c] = {};
      if (!SIM.sliders[c][s]) SIM.sliders[c][s] = {};

      const subData = SIM.sliders[c][s];
      const keys = simGetKeysForCat(c);
      const otherSum = keys.filter(k => k !== en).reduce((sum, k) => sum + (subData[k] || 0), 0);
      
      if (v + otherSum > 100.01) v = 100 - otherSum;
      if (v < 0) v = 0;

      SIM.sliders[c][s][en] = v;
      e.target.value = v; // update range pos if clamped
      const ni = container.querySelector(`.sim-slider-val[data-cat="${c}"][data-sub="${s}"][data-entry="${en}"]`);
      if (ni) ni.value = v.toFixed(2);
      simUpdateSubTotal(container, c, s);
    });
  });

  container.querySelectorAll('.sim-subgroup .sim-slider-val').forEach(inp => {
    inp.addEventListener('change', e => {
      const { cat: c, sub: s, entry: en } = e.target.dataset;
      if (!c || !s) return; // Safeguard

      let v = parseFloat(e.target.value);
      if (isNaN(v)) v = 0;
      v = Math.max(0, Math.min(100, v));

      if (!SIM.sliders[c]) SIM.sliders[c] = {};
      if (!SIM.sliders[c][s]) SIM.sliders[c][s] = {};

      e.target.value = v.toFixed(2);
      SIM.sliders[c][s][en] = v;
      const ri = container.querySelector(`.sim-slider[data-cat="${c}"][data-sub="${s}"][data-entry="${en}"]`);
      if (ri) ri.value = v;
      simUpdateSubTotal(container, c, s);
    });
  });

  // Bind regional slider events
  simBindRegionSliderEvents(container);
}

function simUpdateSubTotal(container, cat, sub) {
  const subData = SIM.sliders[cat]?.[sub] || {};
  const keys = simGetKeysForCat(cat);
  const total = keys.reduce((s, k) => s + (subData[k] || 0), 0);

  const sgDiv = container.querySelector(`.sim-subgroup[data-cat="${cat}"][data-sub="${sub}"]`);
  if (sgDiv) {
    const ind = sgDiv.querySelector('.sim-total-indicator');
    if (ind) {
      ind.textContent = `Total: ${total.toFixed(1)}%`;
      ind.classList.toggle('valid', Math.abs(total - 100) < 0.5);
      ind.classList.toggle('invalid', Math.abs(total - 100) >= 0.5);
    }
  }
}

// ====== REGIONAL SLIDERS (Build HTML + Bind) ======
function simBuildRegionSlidersHTML() {
  if (!SIM.regioesIBGE) return '';

  const catEntries = SIM.candidatos.map(c => ({ key: `cand_${c.id}`, label: c.nome || `Cand. ${c.id}`, cor: c.cor }))
    .concat([{ key: 'outros', label: 'Outros', cor: '#7a8699' }]);

  let html = '';

  if (SIM.modo === 'presidencial') {
    // Macrorregiões
    const macros = SIM.regioesIBGE.macro;
    const macroKeys = Object.keys(macros).sort();
    const configuredCount = macroKeys.filter(mk => {
      const sl = SIM.macroSliders[mk];
      return sl && catEntries.some(e => (sl[e.key] || 0) > 0);
    }).length;

    const isExpanded = SIM.expandedSections.has('macro_section');

    html += '<div class="sim-region-section" data-region-type="macro">';
    html += `<div class="sim-region-header" style="cursor:pointer;" data-section-id="macro_section">
      <h4>Macrorregião</h4>
      <div class="sim-section-toggle ${isExpanded ? 'open' : ''}"><span class="sim-arrow"></span></div>
    </div>`;
    
    html += `<div class="sim-section-content ${isExpanded ? '' : 'collapsed'}" id="section_macro_section">`;

    macroKeys.forEach(mk => {
      const info = macros[mk];
      const sl = SIM.macroSliders[mk] || {};
      const hasVals = catEntries.some(e => (sl[e.key] || 0) > 0);
      const total = catEntries.reduce((s, e) => s + (sl[e.key] || 0), 0);
      const isValid = Math.abs(total - 100) < 0.5;

      let summary = '';
      if (hasVals) {
        const top = [...catEntries].sort((a, b) => (sl[b.key] || 0) - (sl[a.key] || 0)).filter(e => (sl[e.key] || 0) > 0).slice(0, 2);
        summary = top.map(e => `${e.label}: ${(sl[e.key] || 0).toFixed(0)}%`).join(', ');
      }

      html += `<div class="sim-region-item ${hasVals ? 'has-values' : ''}" data-region-code="${mk}" data-region-type="macro">`;
      html += `<div class="sim-region-item-header">
        <div class="sim-region-item-title">
          <span class="sim-region-arrow">▶</span>
          ${hasVals ? '<span class="sim-region-configured-dot"></span>' : ''}
          ${info.nome}
        </div>
        <span class="sim-region-pct-summary">${summary}</span>
      </div>`;
      html += '<div class="sim-region-item-body">';
      html += `<div class="sim-total-indicator ${isValid ? 'valid' : 'invalid'}" data-region-total="${mk}">Total: ${total.toFixed(1)}%</div>`;

      catEntries.forEach(entry => {
        const val = sl[entry.key] || 0;
        html += `
          <div class="sim-slider-row">
            <span class="sim-slider-indicator" style="background:${entry.cor}"></span>
            <span class="sim-slider-label" title="${entry.label}">${entry.label}</span>
            <input type="range" class="sim-slider" min="0" max="100" step="0.5" value="${val}"
                   data-rtype="macro" data-rcode="${mk}" data-entry="${entry.key}">
            <input type="number" class="sim-slider-val" min="0" max="100" step="0.01" value="${val.toFixed(2)}"
                   data-rtype="macro" data-rcode="${mk}" data-entry="${entry.key}">
            <span class="sim-slider-pct">%</span>
          </div>`;
      });

      html += '</div></div>';
    });
    html += '</div></div>';
  }

  if (SIM.modo === 'governador' && SIM.estadoAlvo) {
    // Regiões intermediárias do estado alvo
    const ufRegions = SIM.regioesIBGE.rgint_by_uf[SIM.estadoAlvo];
    if (ufRegions && ufRegions.length > 0) {
      const configuredCount = ufRegions.filter(r => {
        const sl = SIM.regionSliders[r.cd];
        return sl && catEntries.some(e => (sl[e.key] || 0) > 0);
      }).length;

      const isExpanded = SIM.expandedSections.has('rgint_section');

      html += '<div class="sim-region-section" data-region-type="rgint">';
      html += `<div class="sim-region-header" style="cursor:pointer;" data-section-id="rgint_section">
        <h4>Região Intermediária</h4>
        <div class="sim-section-toggle ${isExpanded ? 'open' : ''}"><span class="sim-arrow"></span></div>
      </div>`;

      html += `<div class="sim-section-content ${isExpanded ? '' : 'collapsed'}" id="section_rgint_section">`;

      // --- CAPITAL SEPARATION ---
      const capitalCode = CAPITAIS_IBGE[SIM.estadoAlvo];
      if (capitalCode) {
        let capitalNome = "Capital";
        const ufCache = SIM.municipiosCache[SIM.estadoAlvo];
        if (ufCache && ufCache.features) {
          const feat = ufCache.features.find(f => String(f.properties.cod_localidade_ibge || f.properties.CD_MUN) === String(capitalCode));
          if (feat) capitalNome = feat.properties.NM_MUN || feat.properties.nome_municipio || feat.properties.NM_MUNICIP || capitalNome;
        }

        const sl = SIM.regionSliders[capitalCode] || {};
        const hasVals = catEntries.some(e => (sl[e.key] || 0) > 0);
        const total = catEntries.reduce((s, e) => s + (sl[e.key] || 0), 0);
        const isValid = Math.abs(total - 100) < 0.5;
        let summary = '';
        if (hasVals) {
          const top = [...catEntries].sort((a, b) => (sl[b.key] || 0) - (sl[a.key] || 0)).filter(e => (sl[e.key] || 0) > 0).slice(0, 2);
          summary = top.map(e => `${e.label}: ${(sl[e.key] || 0).toFixed(0)}%`).join(', ');
        }

        html += `<div class="sim-region-item ${hasVals ? 'has-values' : ''}" data-region-code="${capitalCode}" data-region-type="muni" style="border-left: 4px solid var(--accent); background: rgba(var(--accent-rgb), 0.05);">`;
        html += `<div class="sim-region-item-header">
          <div class="sim-region-item-title">
            <span class="sim-region-arrow">▶</span>
            ${hasVals ? '<span class="sim-region-configured-dot"></span>' : ''}
            <strong>${capitalNome} (Capital)</strong>
          </div>
          <span class="sim-region-pct-summary">${summary}</span>
        </div>`;
        html += '<div class="sim-region-item-body">';
        html += `<div class="sim-total-indicator ${isValid ? 'valid' : 'invalid'}" data-region-total="${capitalCode}">Total: ${total.toFixed(1)}%</div>`;
        catEntries.forEach(entry => {
          const val = sl[entry.key] || 0;
          html += `
            <div class="sim-slider-row">
              <span class="sim-slider-indicator" style="background:${entry.cor}"></span>
              <span class="sim-slider-label" title="${entry.label}">${entry.label}</span>
              <input type="range" class="sim-slider" min="0" max="100" step="0.5" value="${val}"
                     data-rtype="muni" data-rcode="${capitalCode}" data-entry="${entry.key}">
              <input type="number" class="sim-slider-val" min="0" max="100" step="0.01" value="${val.toFixed(2)}"
                     data-rtype="muni" data-rcode="${capitalCode}" data-entry="${entry.key}">
              <span class="sim-slider-pct">%</span>
            </div>`;
        });
        html += '</div></div>';
      }
      // --- END CAPITAL SEPARATION ---

      ufRegions.forEach(r => {
        const sl = SIM.regionSliders[r.cd] || {};
        const hasVals = catEntries.some(e => (sl[e.key] || 0) > 0);
        const total = catEntries.reduce((s, e) => s + (sl[e.key] || 0), 0);
        const isValid = Math.abs(total - 100) < 0.5;

        let summary = '';
        if (hasVals) {
          const top = [...catEntries].sort((a, b) => (sl[b.key] || 0) - (sl[a.key] || 0)).filter(e => (sl[e.key] || 0) > 0).slice(0, 2);
          summary = top.map(e => `${e.label}: ${(sl[e.key] || 0).toFixed(0)}%`).join(', ');
        }

        html += `<div class="sim-region-item ${hasVals ? 'has-values' : ''}" data-region-code="${r.cd}" data-region-type="rgint">`;
        html += `<div class="sim-region-item-header">
          <div class="sim-region-item-title">
            <span class="sim-region-arrow">▶</span>
            ${hasVals ? '<span class="sim-region-configured-dot"></span>' : ''}
            ${r.nome}
          </div>
          <span class="sim-region-pct-summary">${summary}</span>
        </div>`;
        html += '<div class="sim-region-item-body">';
        html += `<div class="sim-total-indicator ${isValid ? 'valid' : 'invalid'}" data-region-total="${r.cd}">Total: ${total.toFixed(1)}%</div>`;

        catEntries.forEach(entry => {
          const val = sl[entry.key] || 0;
          html += `
            <div class="sim-slider-row">
              <span class="sim-slider-indicator" style="background:${entry.cor}"></span>
              <span class="sim-slider-label" title="${entry.label}">${entry.label}</span>
              <input type="range" class="sim-slider" min="0" max="100" step="0.5" value="${val}"
                     data-rtype="rgint" data-rcode="${r.cd}" data-entry="${entry.key}">
              <input type="number" class="sim-slider-val" min="0" max="100" step="0.01" value="${val.toFixed(2)}"
                     data-rtype="rgint" data-rcode="${r.cd}" data-entry="${entry.key}">
              <span class="sim-slider-pct">%</span>
            </div>`;
        });

        html += '</div></div>';
      });
      html += '</div></div>';
    }
  }

  return html;
}

function simBindRegionSliderEvents(container) {
  // Section toggle logic (click on header or toggle icon)
  container.querySelectorAll('.sim-region-header').forEach(header => {
    header.addEventListener('click', () => {
      const sectionId = header.dataset.sectionId;
      if (!sectionId) return;
      const content = container.querySelector(`#section_${sectionId}`);
      const toggle = header.querySelector('.sim-section-toggle');
      if (content) {
        const isCollapsed = content.classList.contains('collapsed');
        if (isCollapsed) {
          content.classList.remove('collapsed');
          if (toggle) toggle.classList.add('open');
          SIM.expandedSections.add(sectionId);
        } else {
          content.classList.add('collapsed');
          if (toggle) toggle.classList.remove('open');
          SIM.expandedSections.delete(sectionId);
        }
      }
    });
  });

  // Slider events for regional sliders (scoped to .sim-region-item)
  container.querySelectorAll('.sim-region-item .sim-slider').forEach(sl => {
    sl.addEventListener('input', e => {
      const { rtype, rcode, entry: en } = e.target.dataset;
      if (!rtype || !rcode) return;

      let v = parseFloat(e.target.value);
      const store = rtype === 'macro' ? SIM.macroSliders : SIM.regionSliders;
      if (!store[rcode]) store[rcode] = {};
      const slData = store[rcode];
      
      const validKeys = SIM.candidatos.map(c => `cand_${c.id}`).concat(['outros']);
      const otherSum = validKeys.filter(k => k !== en).reduce((sum, k) => sum + (slData[k] || 0), 0);
      
      if (v + otherSum > 100.01) v = Math.max(0, 100 - otherSum);
      if (v < 0) v = 0;

      store[rcode][en] = v;
      e.target.value = v;
      const ni = container.querySelector(`.sim-slider-val[data-rtype="${rtype}"][data-rcode="${rcode}"][data-entry="${en}"]`);
      if (ni) ni.value = v.toFixed(2);
      simUpdateRegionTotal(container, rtype, rcode);
    });
  });

  container.querySelectorAll('.sim-region-item .sim-slider-val').forEach(inp => {
    inp.addEventListener('change', e => {
      const { rtype, rcode, entry: en } = e.target.dataset;
      if (!rtype || !rcode) return;

      let v = parseFloat(e.target.value);
      if (isNaN(v)) v = 0;
      v = Math.max(0, Math.min(100, v));

      const store = rtype === 'macro' ? SIM.macroSliders : SIM.regionSliders;
      if (!store[rcode]) store[rcode] = {};
      const slData = store[rcode];

      const validKeys = SIM.candidatos.map(c => `cand_${c.id}`).concat(['outros']);
      const otherSum = validKeys.filter(k => k !== en).reduce((sum, k) => sum + (slData[k] || 0), 0);

      if (v + otherSum > 100.01) v = Math.max(0, 100 - otherSum);

      e.target.value = v.toFixed(2);
      store[rcode][en] = v;
      const si = container.querySelector(`.sim-slider[data-rtype="${rtype}"][data-rcode="${rcode}"][data-entry="${en}"]`);
      if (si) si.value = v;
      simUpdateRegionTotal(container, rtype, rcode);
    });
  });
}

function simUpdateRegionTotal(container, rtype, rcode) {
  const store = rtype === 'macro' ? SIM.macroSliders : SIM.regionSliders;
  const sl = store[rcode] || {};
  const validKeys = SIM.candidatos.map(c => `cand_${c.id}`).concat(['outros']);
  const total = validKeys.reduce((s, k) => s + (sl[k] || 0), 0);

  const ind = container.querySelector(`[data-region-total="${rcode}"]`);
  if (ind) {
    ind.textContent = `Total: ${total.toFixed(1)}%`;
    ind.classList.toggle('valid', Math.abs(total - 100) < 0.5);
    ind.classList.toggle('invalid', Math.abs(total - 100) >= 0.5);
  }

  // Update has-values class and summary on the item
  const item = container.querySelector(`.sim-region-item[data-region-code="${rcode}"][data-region-type="${rtype}"]`);
  if (item) {
    const catEntries = SIM.candidatos.map(c => ({ key: `cand_${c.id}`, label: c.nome || `Cand. ${c.id}` }))
      .concat([{ key: 'outros', label: 'Outros' }]);
    const hasVals = catEntries.some(e => (sl[e.key] || 0) > 0);
    item.classList.toggle('has-values', hasVals);

    const summaryEl = item.querySelector('.sim-region-pct-summary');
    if (summaryEl) {
      if (hasVals) {
        const top = [...catEntries].sort((a, b) => (sl[b.key] || 0) - (sl[a.key] || 0)).filter(e => (sl[e.key] || 0) > 0).slice(0, 2);
        summaryEl.textContent = top.map(e => `${e.label}: ${(sl[e.key] || 0).toFixed(0)}%`).join(', ');
      } else {
        summaryEl.textContent = '';
      }
    }
  }

  // Update badge count
  const section = container.querySelector(`.sim-region-section[data-region-type="${rtype}"]`);
  if (section) {
    const items = section.querySelectorAll('.sim-region-item');
    let configured = 0;
    items.forEach(it => { if (it.classList.contains('has-values')) configured++; });
    const badge = section.querySelector('.sim-region-badge');
    if (badge) badge.textContent = `${configured}/${items.length} configuradas`;
  }
}

// Helper: get the region slider data for a given municipality code
function simGetRegionOverride(codM) {
  if (!SIM.regioesIBGE || !codM) return null;
  const mapping = SIM.regioesIBGE.muni_to_region[String(codM)];
  if (!mapping) return null;

  const validKeys = SIM.candidatos.map(c => `cand_${c.id}`).concat(['outros']);

  // Check intermediate region first (higher priority)
  if (SIM.modo === 'governador') {
    const riSliders = SIM.regionSliders[mapping.ri];
    if (riSliders) {
      const total = validKeys.reduce((s, k) => s + (riSliders[k] || 0), 0);
      if (total > 0) return riSliders;
    }
  }

  // Check macro-region (presidential mode)
  if (SIM.modo === 'presidencial') {
    // Check intermediate region first (if defined)
    const riSliders = SIM.regionSliders[mapping.ri];
    if (riSliders) {
      const total = validKeys.reduce((s, k) => s + (riSliders[k] || 0), 0);
      if (total > 0) return riSliders;
    }
    // Then check macro-region
    const macroSliders = SIM.macroSliders[mapping.mr];
    if (macroSliders) {
      const total = validKeys.reduce((s, k) => s + (macroSliders[k] || 0), 0);
      if (total > 0) return macroSliders;
    }
  }

  return null;
}

// ====== PROJEÇÃO ======
function simCalcularProjecao() {
  SIM.resultadosPorUF = {};
  SIM.totalBrasil = {};
  SIM.resultadosPorMuni = {};

  const allKeys = SIM.candidatos.map(c => `cand_${c.id}`).concat(['outros', 'nuloBranco', 'abstencao']);
  const validKeys = SIM.candidatos.map(c => `cand_${c.id}`).concat(['outros']);
  
  let totalEleitoresBR = 0;
  const totalVotosBR = {};
  allKeys.forEach(k => totalVotosBR[k] = 0);

  const cacheKeys = (SIM.modo === 'governador' && SIM.estadoAlvo) ? [SIM.estadoAlvo] : Object.keys(SIM.locaisCache);

  // --- ESTRUTURAS PARA AGREGAÇÃO REGIONAL ---
  const regionRawAggregation = {}; // { [rCode]: { [candKey]: totalWeightedVal, _totalValidWeight: 0 } }

  // --- PHASE 1: CÁLCULO RAW (MIGRAÇÃO + DEMOGRAFIA) & AGREGAÇÃO REGIONAL ---
  cacheKeys.forEach(uf => {
    const geo = SIM.locaisCache[uf];
    if (!geo) return;

    geo.features.forEach(f => {
      const p = f.properties;
      const aptos = ensureNumber(p['Eleitores_Aptos 1T']) || ensureNumber(p['Eleitores_Aptos 2T']) || 0;
      if(aptos === 0) return;

      const tseKey = p.sg_uf + '_' + parseInt(p.NR_ZONA) + '_' + (p.nm_locvot || '').trim().toUpperCase();
      const tse = SIM.tseDemographics[tseKey];

      const pM = tse ? (tse.tse_pct_feminino || 0)/100 : (ensureNumber(p['Pct Mulheres']) || 0)/100;
      const pH = tse ? (tse.tse_pct_masculino || 0)/100 : (ensureNumber(p['Pct Homens']) || 0)/100;
      
      const p16_29 = tse ? (tse.tse_pct_16_29 || 0)/100 : (ensureNumber(p['Pct 15 a 19 anos']) + ensureNumber(p['Pct 20 a 24 anos']) + ensureNumber(p['Pct 25 a 29 anos']))/100;
      const p30_45 = tse ? (tse.tse_pct_30_45 || 0)/100 : (ensureNumber(p['Pct 30 a 34 anos']) + ensureNumber(p['Pct 35 a 39 anos']) + ensureNumber(p['Pct 40 a 44 anos']))/100;
      const p46_59 = tse ? (tse.tse_pct_46_59 || 0)/100 : (ensureNumber(p['Pct 45 a 49 anos']) + ensureNumber(p['Pct 50 a 54 anos']) + ensureNumber(p['Pct 55 a 59 anos']))/100;
      const p60_plus = tse ? (tse.tse_pct_60_plus || 0)/100 : Math.max(0, 1 - (p16_29 + p30_45 + p46_59)); 

      const pFund = tse ? (tse.tse_pct_fundamental || 0)/100 : 0.4;
      const pMed = tse ? (tse.tse_pct_medio || 0)/100 : 0.4;
      const pSup = tse ? (tse.tse_pct_superior || 0)/100 : 0.2;

      const voto2022Proxy = {};
      
      if (SIM.modo === 'presidencial') {
         const vLula = ensureNumber(p['LULA (PT) (ELEITO) 2T']) || ensureNumber(p['LULA (PT) (2° TURNO) 1T']);  
         const vBolso = ensureNumber(p['JAIR BOLSONARO (PL) (NÃO ELEITO) 2T']) || ensureNumber(p['JAIR BOLSONARO (PL) (2° TURNO) 1T']);
         const abs_nulo_branco = Math.max(0, aptos - vLula - vBolso);
         voto2022Proxy.lula = vLula / aptos || 0;
         voto2022Proxy.bolsonaro = vBolso / aptos || 0;
         voto2022Proxy.abstencao = abs_nulo_branco / aptos || 0;
      } else {
         let subgrupos = DEMO_GROUPS.voto2022.subgrupos;
         let usedKeysVotos = 0;
         for (let govKey in subgrupos) {
            if (govKey !== 'nuloBranco' && govKey !== 'abstencao' && govKey !== 'outros') {
               const v = ensureNumber(p[govKey]) || 0;
               voto2022Proxy[govKey] = v / aptos || 0;
               usedKeysVotos += v;
            }
         }
         const validos = ensureNumber(p['Gov_Total_Votos_Validos 1T']) || 0;
         const brancos = ensureNumber(p['Gov_Votos_Brancos 1T']) || 0;
         const nulos = ensureNumber(p['Gov_Votos_Nulos 1T']) || 0;
         const absten = ensureNumber(p['Gov_Abstenções 1T']) || 0;
         const outros = Math.max(0, validos - usedKeysVotos);
         voto2022Proxy['outros'] = outros / aptos || 0;
         voto2022Proxy['nuloBranco'] = (brancos + nulos) / aptos || 0;
         voto2022Proxy['abstencao'] = absten / aptos || 0;
      }

      const rMedia = ensureNumber(p['Renda Media']) || 0;
      let r_bucket = '0-1k';
      if (rMedia > 5000) r_bucket = '5k+';
      else if (rMedia > 4000) r_bucket = '4k-5k';
      else if (rMedia > 3000) r_bucket = '3k-4k';
      else if (rMedia > 2000) r_bucket = '2k-3k';
      else if (rMedia > 1000) r_bucket = '1k-2k';

      const validScores = {}; 
      const voto2022Scores = {};
      allKeys.forEach(k => { validScores[k] = 0; voto2022Scores[k] = 0; });
      
      let validWeight = 0;
      let voto2022Weight = 0;

      const calcGroupScore = (cat, weightsMap) => {
        if(!SIM.sliders[cat]) return;
        const subgrupos = DEMO_GROUPS[cat].subgrupos;
        for(const subKey in subgrupos) {
          const w = weightsMap[subKey] || 0;
          if(w <= 0) continue;
          const slds = SIM.sliders[cat][subKey];
          if(!slds) continue;
          
          if(cat === 'voto2022') {
             allKeys.forEach(k => { voto2022Scores[k] += w * (slds[k] || 0); });
             voto2022Weight += w;
          } else {
             validKeys.forEach(k => { validScores[k] += w * (slds[k] || 0); });
             validWeight += w;
          }
        }
      };

      calcGroupScore('genero', { M: pH, F: pM });
      calcGroupScore('idade', { '16-29': p16_29, '30-45': p30_45, '46-59': p46_59, '60+': p60_plus });
      calcGroupScore('educacao', { fundamental: pFund, medio: pMed, superior: pSup });
      calcGroupScore('voto2022', voto2022Proxy);
      
      const rWeights = { '0-1k':0, '1k-2k':0, '2k-3k':0, '3k-4k':0, '4k-5k':0, '5k+':0 };
      rWeights[r_bucket] = 1.0;
      calcGroupScore('renda', rWeights);

      const codM = p.cod_localidade_ibge || p.CD_MUN;
      const rel = codM && SIM.religiaoMuni[codM] ? SIM.religiaoMuni[codM] : {};
      calcGroupScore('religiao', { 
        catolico: (rel.pct_rel_catolica || 0)/100, 
        evangelico: (rel.pct_rel_evangelica || 0)/100, 
        outras: (rel.pct_rel_outras || 0)/100, 
        semReligiao: (rel.pct_rel_sem_religiao || 0)/100 
      });

      if (voto2022Weight > 0) allKeys.forEach(k => voto2022Scores[k] /= voto2022Weight);
      if (validWeight > 0) validKeys.forEach(k => validScores[k] /= validWeight);

      const nuloBrancoPct = voto2022Scores.nuloBranco || 0;
      const abstencaoPct = voto2022Scores.abstencao || 0;
      const validFraction = Math.max(0, 100 - nuloBrancoPct - abstencaoPct);

      // Raw valid distribution: weighted average of Migratoria (10x) and Demografia (1x)
      const rawPcts = {};
      const migW = 10;
      const demoW = validWeight > 0 ? 1 : 0;
      const totalW = migW + demoW;
      
      validKeys.forEach(k => {
        rawPcts[k] = (voto2022Scores[k] * migW + (validScores[k] || 0) * demoW) / totalW;
      });

      // Normalize raw to sum=1 (within the valid fraction context)
      const sumRaw = validKeys.reduce((s, k) => s + rawPcts[k], 0);
      if (sumRaw > 0) {
        validKeys.forEach(k => rawPcts[k] = (rawPcts[k] / sumRaw));
      } else {
        // Fallback if everyone is 0
        rawPcts['outros'] = 1.0;
      }
      
      // Store raw pcts (as fraction of valid votes 0..1)
      f.properties._rawPcts = rawPcts;
      f.properties._invalid = { nb: nuloBrancoPct, ab: abstencaoPct, vf: validFraction };

      // Agregação regional (usa aptos * validFraction como peso)
      const rMapping = SIM.regioesIBGE?.muni_to_region[String(codM)];
      if (rMapping || (SIM.modo === 'governador' && CAPITAIS_IBGE[SIM.estadoAlvo] === String(codM))) {
          const weightedPop = aptos * (validFraction / 100);
          let tracks = [];
          
          const isCapital = SIM.modo === 'governador' && CAPITAIS_IBGE[SIM.estadoAlvo] === String(codM);
          
          if (isCapital) {
            // Capital é tratada como sua própria "região" e separada das demais
            tracks.push({ code: String(codM), type: 'muni' });
          } else if (rMapping) {
            if (rMapping.mr) tracks.push({ code: rMapping.mr, type: 'macro' });
            if (rMapping.ri) tracks.push({ code: rMapping.ri, type: 'ri' });
          }
          
          tracks.forEach(t => {
              if (!regionRawAggregation[t.code]) {
                  regionRawAggregation[t.code] = { _totalValidWeight: 0 };
                  validKeys.forEach(k => regionRawAggregation[t.code][k] = 0);
              }
              regionRawAggregation[t.code]._totalValidWeight += weightedPop;
              validKeys.forEach(k => {
                  regionRawAggregation[t.code][k] += rawPcts[k] * weightedPop;
              });
          });
      }
    });
  });

  // --- PHASE 2: CÁLCULO DE FATORES DE ESCALONAMENTO POR REGIÃO ---
  const regionScalingFactors = {}; // { [rCode]: { [candKey]: factor } }
  
  if (SIM.regioesIBGE) {
      Object.keys(regionRawAggregation).forEach(rc => {
          const agg = regionRawAggregation[rc];
          if (agg._totalValidWeight <= 0) return;
          
          // Get slider target for this region
          let targetSliders = null;
          if (SIM.regionSliders[rc]) targetSliders = SIM.regionSliders[rc];
          else if (SIM.macroSliders[rc]) targetSliders = SIM.macroSliders[rc];
          
          if (targetSliders) {
              const sliderTotal = validKeys.reduce((s, k) => s + (targetSliders[k] || 0), 0);
              if (sliderTotal > 0) {
                  const factors = {};
                  validKeys.forEach(k => {
                      const rawPct = (agg[k] / agg._totalValidWeight); // 0..1
                      const targetPct = (targetSliders[k] || 0) / 100; // 0..1
                      // Factor = Target / Raw. (Protect against div by zero)
                      factors[k] = rawPct > 0 ? (targetPct / rawPct) : 0;
                  });
                  regionScalingFactors[rc] = factors;
              }
          }
      });
  }

  // --- PHASE 3: APLICAÇÃO FINAL & TOTALIZAÇÃO ---
  cacheKeys.forEach(uf => {
    const geo = SIM.locaisCache[uf];
    if (!geo) return;

    let totalEleitoresUF = 0;
    const ufRes = {};
    allKeys.forEach(k => ufRes[k] = { votos: 0, pct: 0 });

    geo.features.forEach(f => {
      const p = f.properties;
      const aptos = ensureNumber(p['Eleitores_Aptos 1T']) || ensureNumber(p['Eleitores_Aptos 2T']) || 0;
      if(aptos === 0) return;
      
      const codM = p.cod_localidade_ibge || p.CD_MUN;
      const rMapping = SIM.regioesIBGE?.muni_to_region[String(codM)];
      
      // Meso/RI priority over Macro/MR. Capitals have absolute priority and no fallback in governor mode.
      let factors = null;
      const isCapital = SIM.modo === 'governador' && String(codM) === CAPITAIS_IBGE[SIM.estadoAlvo];

      if (isCapital) {
          if (regionScalingFactors[String(codM)]) factors = regionScalingFactors[String(codM)];
      } else if (rMapping) {
          if (regionScalingFactors[rMapping.ri]) factors = regionScalingFactors[rMapping.ri];
          else if (regionScalingFactors[rMapping.mr]) factors = regionScalingFactors[rMapping.mr];
      }

      const rawPcts = f.properties._rawPcts; 
      const inv = f.properties._invalid;
      
      const finalValidPcts = {};
      validKeys.forEach(k => {
          finalValidPcts[k] = rawPcts[k] * (factors ? (factors[k] || 0) : 1);
      });

      // Normalize finalValidPcts to sum to validFraction
      const sumFinalVal = validKeys.reduce((s, k) => s + finalValidPcts[k], 0);
      if (sumFinalVal > 0) {
          validKeys.forEach(k => finalValidPcts[k] = (finalValidPcts[k] / sumFinalVal) * inv.vf);
      } else {
          validKeys.forEach(k => finalValidPcts[k] = rawPcts[k] * inv.vf);
      }

      const finalPcts = { ...finalValidPcts };
      finalPcts.nuloBranco = inv.nb;
      finalPcts.abstencao = inv.ab;

      // Final normalization
      const totalPct = allKeys.reduce((s, k) => s + (finalPcts[k] || 0), 0);
      if (totalPct > 0 && Math.abs(totalPct - 100) > 0.05) {
        allKeys.forEach(k => finalPcts[k] = ((finalPcts[k] || 0) / totalPct) * 100);
      }

      allKeys.forEach(k => {
        const votos = Math.round(aptos * (finalPcts[k] || 0) / 100);
        ufRes[k].votos += votos;
        totalVotosBR[k] += votos;
        
        if (codM) {
            if (!SIM.resultadosPorMuni[uf]) SIM.resultadosPorMuni[uf] = {};
            if (!SIM.resultadosPorMuni[uf][codM]) {
                SIM.resultadosPorMuni[uf][codM] = { _totalEleitores: 0 };
                allKeys.forEach(ak => SIM.resultadosPorMuni[uf][codM][ak] = { votos: 0, pct: 0 });
            }
            SIM.resultadosPorMuni[uf][codM][k].votos += votos;
        }
      });
      if (codM) SIM.resultadosPorMuni[uf][codM]._totalEleitores += aptos;

      totalEleitoresUF += aptos;
      f.properties._sim = { votosCand: {}, totalAptos: aptos };
      allKeys.forEach(k => f.properties._sim.votosCand[k] = Math.round(aptos * (finalPcts[k] || 0) / 100));
    });

    allKeys.forEach(k => {
      ufRes[k].pct = totalEleitoresUF > 0 ? (ufRes[k].votos / totalEleitoresUF) * 100 : 0;
    });
    if (SIM.resultadosPorMuni[uf]) {
        Object.values(SIM.resultadosPorMuni[uf]).forEach(mRes => {
            allKeys.forEach(k => mRes[k].pct = mRes._totalEleitores > 0 ? (mRes[k].votos / mRes._totalEleitores) * 100 : 0);
        });
    }

    if (SIM.overridesPorUF[uf]) {
        const oRes = SIM.overridesPorUF[uf];
        allKeys.forEach(k => {
           const oldVotosUF = ufRes[k].votos;
           const newVotosUF = Math.round(totalEleitoresUF * (oRes[k] || 0) / 100);
           const ratio = oldVotosUF > 0 ? (newVotosUF / oldVotosUF) : 0;
           
           if (SIM.resultadosPorMuni[uf]) {
               Object.values(SIM.resultadosPorMuni[uf]).forEach(mRes => {
                   mRes[k].votos = oldVotosUF > 0 ? Math.round(mRes[k].votos * ratio) : Math.round(newVotosUF * (mRes._totalEleitores / totalEleitoresUF));
                   mRes[k].pct = mRes._totalEleitores > 0 ? (mRes[k].votos / mRes._totalEleitores) * 100 : 0;
               });
           }
           geo.features.forEach(f => {
               if(f.properties._sim) {
                   f.properties._sim.votosCand[k] = oldVotosUF > 0 ? Math.round((f.properties._sim.votosCand[k] || 0) * ratio) : Math.round(newVotosUF * (f.properties._sim.totalAptos / totalEleitoresUF));
               }
           });
           totalVotosBR[k] += (newVotosUF - oldVotosUF);
           ufRes[k].votos = newVotosUF;
           ufRes[k].pct = oRes[k] || 0;
        });
    }

    // --- MANUAL MUNICIPAL OVERRIDES ---
    if (SIM.resultadosPorMuni[uf]) {
        Object.entries(SIM.resultadosPorMuni[uf]).forEach(([codM, mRes]) => {
            const oMuni = SIM.overridesPorMuni[codM];
            if (!oMuni) return;

            allKeys.forEach(k => {
                const oldVotosMuni = mRes[k].votos;
                const newVotosMuni = Math.round(mRes._totalEleitores * (oMuni[k] || 0) / 100);
                const delta = newVotosMuni - oldVotosMuni;

                mRes[k].votos = newVotosMuni;
                mRes[k].pct = oMuni[k] || 0;
                
                // Propagate to State and national totals
                ufRes[k].votos += delta;
                totalVotosBR[k] += delta;

                // Distribute delta among polling locations within this municipality
                const ratio = oldVotosMuni > 0 ? (newVotosMuni / oldVotosMuni) : 0;
                geo.features.forEach(f => {
                    const fCodM = f.properties.cod_localidade_ibge || f.properties.CD_MUN;
                    if (String(fCodM) === String(codM) && f.properties._sim) {
                        if (oldVotosMuni > 0) {
                            f.properties._sim.votosCand[k] = Math.round((f.properties._sim.votosCand[k] || 0) * ratio);
                        } else {
                            f.properties._sim.votosCand[k] = Math.round(newVotosMuni * (f.properties._sim.totalAptos / mRes._totalEleitores));
                        }
                    }
                });
            });
        });

        // Final check: Update state percentages after all deltas
        allKeys.forEach(k => {
           ufRes[k].pct = totalEleitoresUF > 0 ? (ufRes[k].votos / totalEleitoresUF) * 100 : 0;
        });
    }

    ufRes._totalEleitores = totalEleitoresUF;
    SIM.resultadosPorUF[uf] = ufRes;
    totalEleitoresBR += totalEleitoresUF;
  });

  allKeys.forEach(k => {
    SIM.totalBrasil[k] = {
      votos: totalVotosBR[k],
      pct: totalEleitoresBR > 0 ? (totalVotosBR[k] / totalEleitoresBR) * 100 : 0
    };
  });
  SIM.totalBrasil._totalEleitores = totalEleitoresBR;
}

// ====== ESTIMATIVA DEMOGRÁFICA REVERSA ======
function simUpdateDemographicEstimates() {
  // 1. Calcular a projeção atual com os sliders primários
  simCalcularProjecao();

  const cacheKeys = (SIM.modo === 'governador' && SIM.estadoAlvo) ? [SIM.estadoAlvo] : Object.keys(SIM.locaisCache);
  const validKeys = SIM.candidatos.map(c => `cand_${c.id}`).concat(['outros']);

  // Estrutura para acum  // Estrutura para acumular pesos e votos por subgrupo
  // agg[cat][sub] = { [candKey]: totalWeightedVotes, _totalWeight: 0 }
  const agg = {};

  cacheKeys.forEach(uf => {
    const geo = SIM.locaisCache[uf];
    if (!geo) return;

    const stateDemo = SIM.disDemograficaEstados ? SIM.disDemograficaEstados[uf] : null;

    geo.features.forEach(f => {
      const p = f.properties;
      if (!p._sim) return;

      const tseKey = p.sg_uf + '_' + parseInt(p.NR_ZONA) + '_' + (p.nm_locvot || '').trim().toUpperCase();
      const tse = SIM.tseDemographics ? SIM.tseDemographics[tseKey] : null;
      
      // Check if TSE data is valid (not just zeros)
      const isTseValid = tse && (tse.tse_pct_masculino > 0 || tse.tse_pct_feminino > 0);

      // Get demographic weights for this location
      const weights = {};
      
      // Gênero
      if (isTseValid) {
        weights.genero = { M: (tse.tse_pct_masculino || 0)/100, F: (tse.tse_pct_feminino || 0)/100 };
      } else if (stateDemo && stateDemo.genero) {
        weights.genero = { ...stateDemo.genero };
      } else {
        const pM = (ensureNumber(p['Pct Mulheres']) || 0)/100;
        const pH = (ensureNumber(p['Pct Homens']) || 0)/100;
        weights.genero = { M: (pH||0.5), F: (pM||0.5) };
      }

      // Idade
      if (isTseValid) {
        const p16_29 = (tse.tse_pct_16_29 || 0)/100;
        const p30_45 = (tse.tse_pct_30_45 || 0)/100;
        const p46_59 = (tse.tse_pct_46_59 || 0)/100;
        const p60_plus = Math.max(0, 1 - (p16_29 + p30_45 + p46_59));
        weights.idade = { '16-29': p16_29, '30-45': p30_45, '46-59': p46_59, '60+': p60_plus };
      } else if (stateDemo && stateDemo.idade) {
        weights.idade = { ...stateDemo.idade };
      } else {
        const p16_29 = (ensureNumber(p['Pct 15 a 19 anos']) + ensureNumber(p['Pct 20 a 24 anos']) + ensureNumber(p['Pct 25 a 29 anos']))/100 || 0.25;
        const p30_45 = (ensureNumber(p['Pct 30 a 34 anos']) + ensureNumber(p['Pct 35 a 39 anos']) + ensureNumber(p['Pct 40 a 44 anos']))/100 || 0.30;
        const p46_59 = (ensureNumber(p['Pct 45 a 49 anos']) + ensureNumber(p['Pct 50 a 54 anos']) + ensureNumber(p['Pct 55 a 59 anos']))/100 || 0.25;
        const p60_plus = Math.max(0, 1 - (p16_29 + p30_45 + p46_59)) || 0.20;
        weights.idade = { '16-29': p16_29, '30-45': p30_45, '46-59': p46_59, '60+': p60_plus };
      }

      // Educação
      if (isTseValid) {
        weights.educacao = { fundamental: (tse.tse_pct_fundamental || 0)/100, medio: (tse.tse_pct_medio || 0)/100, superior: (tse.tse_pct_superior || 0)/100 };
      } else if (stateDemo && stateDemo.educacao) {
        weights.educacao = { ...stateDemo.educacao };
      } else {
        weights.educacao = { fundamental: 0.45, medio: 0.40, superior: 0.15 };
      }

      // Renda - Smoother distribution based on Mean Income
      const rMedia = ensureNumber(p['Renda Media']) || (stateDemo?.renda_media) || 2000;
      if (rMedia < 1500) {
        weights.renda = { '0-1k': 0.60, '1k-2k': 0.30, '2k-3k': 0.05, '3k-4k': 0.03, '4k-5k': 0.01, '5k+': 0.01 };
      } else if (rMedia < 3000) {
        weights.renda = { '0-1k': 0.15, '1k-2k': 0.45, '2k-3k': 0.25, '3k-4k': 0.10, '4k-5k': 0.03, '5k+': 0.02 };
      } else if (rMedia < 5000) {
        weights.renda = { '0-1k': 0.05, '1k-2k': 0.15, '2k-3k': 0.30, '3k-4k': 0.30, '4k-5k': 0.15, '5k+': 0.05 };
      } else {
        weights.renda = { '0-1k': 0.01, '1k-2k': 0.04, '2k-3k': 0.15, '3k-4k': 0.30, '4k-5k': 0.30, '5k+': 0.20 };
      }

      // Religião
      const codM = p.cod_localidade_ibge || p.CD_MUN;
      const rel = codM && SIM.religiaoMuni[codM] ? SIM.religiaoMuni[codM] : null;
      if (rel) {
        weights.religiao = { 
          catolico: (rel.pct_rel_catolica || 60)/100, 
          evangelico: (rel.pct_rel_evangelica || 25)/100, 
          outras: (rel.pct_rel_outras || 5)/100, 
          semReligiao: (rel.pct_rel_sem_religiao || 10)/100 
        };
      } else if (stateDemo && stateDemo.religiao) {
        weights.religiao = { ...stateDemo.religiao };
      } else {
        weights.religiao = { catolico: 0.60, evangelico: 0.25, outras: 0.05, semReligiao: 0.10 };
      }

      const validVotesLoc = validKeys.reduce((s, k) => s + (p._sim.votosCand[k] || 0), 0);
      if (validVotesLoc <= 0) return;

      // Acumular
      for (const cat in weights) {
        if (!agg[cat]) agg[cat] = {};
        for (const sub in weights[cat]) {
          const w = weights[cat][sub];
          if (w <= 0) continue;
          if (!agg[cat][sub]) {
            agg[cat][sub] = { _totalWeight: 0 };
            validKeys.forEach(k => agg[cat][sub][k] = 0);
          }
          const weightedPop = validVotesLoc * w;
          agg[cat][sub]._totalWeight += weightedPop;
          validKeys.forEach(k => {
            agg[cat][sub][k] += (p._sim.votosCand[k] || 0) * w;
          });
        }
      }
    });
  });

  // 2. Converter acumulados em porcentagens e atualizar SIM.sliders
  for (const cat in agg) {
    if (!SIM.sliders[cat]) SIM.sliders[cat] = {};
    for (const sub in agg[cat]) {
      if (!SIM.sliders[cat][sub]) SIM.sliders[cat][sub] = {};
      const totalW = agg[cat][sub]._totalWeight;
      if (totalW > 0) {
        validKeys.forEach(k => {
          SIM.sliders[cat][sub][k] = (agg[cat][sub][k] / totalW) * 100;
        });
      }
    }
  }

  console.log("Estimativa demográfica atualizada com sucesso.");
}


// ====== APLICAR ======
function simAplicar() {
  document.getElementById('simConfigOverlay').classList.remove('visible');
  simCalcularProjecao();
  
  // Instant Sync
  simUpdateDemographicEstimates();

  if (SIM.modo === 'governador' && SIM.estadoAlvo) {
     simOnClickEstado(SIM.estadoAlvo);
  } else {
     simRenderMapaEstados();
     simShowBrasilResults();
  }
}

// ====== MAPA ======
function simGetVencedorUF(uf) {

  const res = SIM.resultadosPorUF[uf];
  if (!res) return null;
  let mx = -1, wk = null;
  SIM.candidatos.forEach(c => { const k = `cand_${c.id}`; if (res[k] && res[k].votos > mx) { mx = res[k].votos; wk = k; } });
  if (res.outros && res.outros.votos > mx) { wk = 'outros'; mx = res.outros.votos; }
  return { key: wk, votos: mx };
}

function simGetVencedorMuni(uf, codM) {
  const ufRes = SIM.resultadosPorMuni[uf];
  if (!ufRes) return null;
  const res = ufRes[codM];
  if (!res) return null;
  let mx = -1, wk = null;
  SIM.candidatos.forEach(c => { const k = `cand_${c.id}`; if (res[k] && res[k].votos > mx) { mx = res[k].votos; wk = k; } });
  if (res.outros && res.outros.votos > mx) { wk = 'outros'; mx = res.outros.votos; }
  return { key: wk, votos: mx };
}

function simGetCorKey(key) {
  if (!key || key === 'outros') return '#7a8699';
  const cid = parseInt(key.replace('cand_', ''));
  const c = SIM.candidatos.find(cc => cc.id === cid);
  return c ? c.cor : '#7a8699';
}

function simRenderMapaEstados() {
  if (SIM.estadosLayer) { simMap.removeLayer(SIM.estadosLayer); SIM.estadosLayer = null; }
  if (!SIM.estadosGeoJSON) return;

  SIM.estadosLayer = L.geoJSON(SIM.estadosGeoJSON, {
    style: f => {
      const sigla = f.properties.SIGLA_UF;
      const cor = simGetCorKey(simGetVencedorUF(sigla)?.key);
      const res = SIM.resultadosPorUF[sigla];
      const venc = simGetVencedorUF(sigla);

      // Gradient coloring: same logic as the visualizer (margin 0-50% -> gradient 0-100%)
      let marginPct = 0;
      if (res && venc?.key) {
        const ks = SIM.candidatos.map(c => `cand_${c.id}`).concat(['outros']);
        const sorted = ks.map(k => res[k]?.votos || 0).sort((a, b) => b - a);
        const validVotos = sorted.reduce((s, v) => s + v, 0);
        marginPct = validVotos > 0 ? ((sorted[0] - (sorted[1] || 0)) / validVotos) * 100 : 0;
      }
      const marginIntensity = Math.max(0, Math.min(50, marginPct));
      const fixedRelativePct = (marginIntensity / 50) * 100;
      const fillCol = getUniversalGradientColor(cor, fixedRelativePct);

      const isSelected = SIM.selectedUF === sigla;
      const isFaded = SIM.selectedUF && !isSelected;

      return {
        fillColor: fillCol,
        fillOpacity: isFaded ? 0.3 : 0.85,
        color: isSelected ? '#fff' : '#333',
        weight: isSelected ? 2.5 : 1,
        opacity: isFaded ? 0.3 : (isSelected ? 1 : 0.7)
      };
    },
    onEachFeature: (f, layer) => {
      const sigla = f.properties.SIGLA_UF;
      const nome = f.properties.NM_UF;
      const res = SIM.resultadosPorUF[sigla];
      const venc = simGetVencedorUF(sigla);

      let tt = `<b>${nome} (${sigla})</b>`;
      if (venc?.key) {
        const ks = SIM.candidatos.map(c => `cand_${c.id}`).concat(['outros']);
        const validVotos = ks.reduce((s, k) => s + (res[k]?.votos || 0), 0);
        const pctObj = validVotos > 0 ? ((res[venc.key]?.votos || 0) / validVotos) * 100 : 0;

        const c = SIM.candidatos.find(cc => cc.id === parseInt((venc.key || '').replace('cand_', '')));
        if (c) tt += `<br>${c.nome}: ${pctObj.toFixed(1)}%`;
        else if (venc.key === 'outros') tt += `<br>Outros: ${pctObj.toFixed(1)}%`;
      }
      layer.bindTooltip(tt, { sticky: true });
      layer.on('click', () => simOnClickEstado(sigla));
    }
  }).addTo(simMap);

  if (SIM.estadosLayer.getBounds().isValid()) simMap.fitBounds(SIM.estadosLayer.getBounds());
  scheduleSimMapRefresh();
}

// ====== RESULTADOS BRASIL (Right Panel) ======
function simShowBrasilResults() {
  SIM.selectedUF = null;
  SIM.selectedMuni = null;
  
  document.getElementById('simEmptyState').style.display = 'none';
  document.getElementById('simPanelResults').style.display = 'block';
  
  document.getElementById('simPanelAreaTitle').textContent = 'Brasil — Total';
  simAtualizarBtnVoltar();

  // Remove locais layer and restore states layer
  if (SIM.locaisLayer) { simMap.removeLayer(SIM.locaisLayer); SIM.locaisLayer = null; }
  if (SIM.municipiosLayer) { simMap.removeLayer(SIM.municipiosLayer); SIM.municipiosLayer = null; }
  
  if (SIM.modo === 'governador') {
     document.getElementById('simPanelResults').style.display = 'none';
     document.getElementById('simConfigOverlay').classList.add('visible');
     return;
  }
  
  simRenderMapaEstados(); 
  simRefreshSidebar();
}

function simRefreshSidebar() {
  const tab = SIM.currentSidebarTab || 'resultado';
  simSidebarTabSwitch(tab);
}

function simSidebarTabSwitch(tab) {
  SIM.currentSidebarTab = tab;
  
  // Update buttons
  document.querySelectorAll('#simPanelResults .chip-button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  
  // Update tabs
  const tabs = {
    resultado: document.getElementById('simTabResultado'),
    ajustar: document.getElementById('simTabAjustar'),
    demografia: document.getElementById('simTabDemografia')
  };
  
  for (let k in tabs) {
    if (tabs[k]) tabs[k].style.display = (k === tab ? 'block' : 'none');
  }
  
  if (tab === 'resultado') {
    if (!SIM.selectedUF) {
       document.getElementById('simPanelAreaSub').textContent = `${fmtInt(SIM.totalBrasil._totalEleitores || 0)} eleitores`;
       simRenderBarsInto('simBarsContainer', SIM.totalBrasil);
       simRenderMetricsBrasil();
    } else if (SIM.selectedMuni) {
       simRenderMuniResultado(SIM.selectedUF, SIM.selectedMuni);
    } else {
       simRenderEstadoResultado(SIM.selectedUF);
    }
  } else if (tab === 'ajustar') {
    simRenderAjusteTab(SIM.selectedUF, SIM.selectedMuni);
  } else if (tab === 'demografia') {
    simRenderDemografiaTab();
  }
}

function simRenderMetricsBrasil() {
  const total = SIM.totalBrasil;
  const votosValidos = SIM.candidatos.reduce((s, c) => s + (total[`cand_${c.id}`]?.votos || 0), 0) + (total.outros?.votos || 0);
  const nb = total.nuloBranco?.votos || 0;
  const ab = total.abstencao?.votos || 0;

  document.getElementById('simMetricsContainer').innerHTML = `
    <div class="sim-metrics-grid">
      <div class="sim-metric-item"><span>Votos Válidos</span><strong>${fmtInt(votosValidos)}</strong></div>
      <div class="sim-metric-item"><span>Nulos/Brancos</span><strong>${fmtInt(nb)} (${fmtPct(total.nuloBranco?.pct || 0)})</strong></div>
      <div class="sim-metric-item"><span>Abstenção</span><strong>${fmtInt(ab)} (${fmtPct(total.abstencao?.pct || 0)})</strong></div>
      <div class="sim-metric-item"><span>Comparecimento</span><strong>${fmtPct(100 - (total.abstencao?.pct || 0))}</strong></div>
    </div>
    <div class="sim-actions-row">
      <button class="sim-btn" onclick="simReaplicarBase()">Reaplicar Base</button>
    </div>`;
}

function simRenderDemografiaTab() {
  const container = document.getElementById('simTabDemografia');
  if (!container) return;

  let html = `
    <div style="margin-bottom:16px;">
      <p style="font-size:0.75rem; color:var(--muted); margin-bottom:10px;">
        Ajuste global como cada grupo demográfico vota. Sincronize com base nos fatores principais (Regional + Transferência).
      </p>
      <button class="sim-btn sim-btn-sync" id="btnSyncDemoSidebar" style="width:100%;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>
        Sincronizar Estimativa
      </button>
    </div>
  `;

  for (const cat in DEMO_GROUPS) {
    if (cat === 'voto2022') continue; 
    const group = DEMO_GROUPS[cat];
    const catEntries = SIM.candidatos.map(c => ({ key: `cand_${c.id}`, label: c.nome || `Cand. ${c.id}`, cor: c.cor }))
      .concat([{ key: 'outros', label: 'Outros', cor: '#7a8699' }]);

    const isExpanded = SIM.expandedSections.has(`side_demo_${cat}`);

    html += `<div style="margin-bottom: 12px;">
      <h4 class="sim-region-header" style="cursor:pointer; font-size:0.85rem;" data-side-section-id="${cat}">
        <span>${group.label}</span>
        <div class="sim-section-toggle ${isExpanded ? 'open' : ''}"><span class="sim-arrow"></span></div>
      </h4>
      <div class="sim-section-content ${isExpanded ? '' : 'collapsed'}" id="side_section_${cat}">`;
    
    for (const [subKey, subLabel] of Object.entries(group.subgrupos)) {
      const subData = SIM.sliders[cat]?.[subKey] || {};
      const total = catEntries.reduce((s, e) => s + (subData[e.key] || 0), 0);
      const isValid = Math.abs(total - 100) < 0.5;

      html += `<div class="sim-subgroup" style="padding:4px 6px; margin-bottom:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
           <span style="font-size:0.7rem; font-weight:600;">${subLabel}</span>
           <span class="sim-total-indicator ${isValid ? 'valid' : 'invalid'}" style="margin:0; padding:1px 4px; font-size:0.6rem;">${total.toFixed(0)}%</span>
        </div>`;

      catEntries.forEach(entry => {
        const val = subData[entry.key] || 0;
        html += `
          <div class="sim-slider-row">
            <span class="sim-slider-label" style="width:65px; font-size:0.65rem;">${entry.label}</span>
            <input type="range" class="sim-slider" min="0" max="100" step="1" value="${val}"
                   data-cat="${cat}" data-sub="${subKey}" data-entry="${entry.key}">
            <input type="number" class="sim-slider-val" style="width:38px; font-size:0.62rem;" value="${val.toFixed(1)}"
                   data-cat="${cat}" data-sub="${subKey}" data-entry="${entry.key}">
          </div>`;
      });
      html += '</div>';
    }
    html += '</div></div>';
  }

  container.innerHTML = html;

  // Bind Switcher
  container.querySelectorAll('.sim-region-header').forEach(h => {
    h.addEventListener('click', () => {
      const cat = h.dataset.sideSectionId;
      const sectionId = `side_demo_${cat}`;
      if (SIM.expandedSections.has(sectionId)) SIM.expandedSections.delete(sectionId);
      else SIM.expandedSections.add(sectionId);
      simRenderDemografiaTab();
    });
  });

  // Bind Sliders
  container.querySelectorAll('.sim-slider').forEach(sl => {
    sl.addEventListener('input', e => {
      const { cat, sub, entry } = e.target.dataset;
      let v = parseFloat(e.target.value);
      if (!SIM.sliders[cat]) SIM.sliders[cat] = {};
      if (!SIM.sliders[cat][sub]) SIM.sliders[cat][sub] = {};
      const subData = SIM.sliders[cat][sub];
      
      const keys = simGetKeysForCat(cat);
      const otherSum = keys.filter(k => k !== entry).reduce((sum, k) => sum + (subData[k] || 0), 0);
      
      if (v + otherSum > 100.01) v = 100 - otherSum;
      if (v < 0) v = 0;

      SIM.sliders[cat][sub][entry] = v;
      e.target.value = v;
      const valInp = container.querySelector(`.sim-slider-val[data-cat="${cat}"][data-sub="${sub}"][data-entry="${entry}"]`);
      if (valInp) valInp.value = v.toFixed(1);
      simUpdateSubTotal(container, cat, sub);

      // FIX: Real-time update
      simCalcularProjecao();
      simRefreshSidebar(); 
      if (SIM.selectedUF) {
         if (SIM.selectedMuni) simRenderMapaLocais(SIM.selectedUF, SIM.selectedMuni);
         else simRenderMapaMunicipios(SIM.selectedUF);
      } else {
         simRenderMapaEstados();
      }
    });
  });

  container.querySelectorAll('.sim-slider-val').forEach(inp => {
    inp.addEventListener('change', e => {
      const { cat, sub, entry } = e.target.dataset;
      let v = parseFloat(e.target.value) || 0;
      v = Math.max(0, Math.min(100, v));
      
      if (!SIM.sliders[cat]) SIM.sliders[cat] = {};
      if (!SIM.sliders[cat][sub]) SIM.sliders[cat][sub] = {};
      const subData = SIM.sliders[cat][sub];
      const keys = simGetKeysForCat(cat);
      const otherSum = keys.filter(k => k !== entry).reduce((sum, k) => sum + (subData[k] || 0), 0);
      
      if (v + otherSum > 100.01) v = 100 - otherSum;
      if (v < 0) v = 0;

      SIM.sliders[cat][sub][entry] = v;
      
      // FIX: Real-time update
      simCalcularProjecao();
      simRefreshSidebar();
      if (SIM.selectedUF) {
         if (SIM.selectedMuni) simRenderMapaLocais(SIM.selectedUF, SIM.selectedMuni);
         else simRenderMapaMunicipios(SIM.selectedUF);
      } else {
         simRenderMapaEstados();
      }
      simRenderDemografiaTab(); 
    });
  });

  document.getElementById('btnSyncDemoSidebar')?.addEventListener('click', () => {
     simUpdateDemographicEstimates();
     simRenderDemografiaTab();
  });
}

function simRenderBarsInto(containerId, data) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const validKeys = SIM.candidatos.map(c => `cand_${c.id}`).concat(['outros']);
  const validVotos = validKeys.reduce((s, k) => s + (data[k]?.votos || 0), 0);

  const entries = SIM.candidatos.map(c => ({
    key: `cand_${c.id}`, label: c.nome || 'S/N', partido: c.partido, cor: c.cor,
    votos: data[`cand_${c.id}`]?.votos || 0,
    pct: validVotos > 0 ? ((data[`cand_${c.id}`]?.votos || 0) / validVotos) * 100 : 0
  })).concat([
    { key: 'outros', label: 'Outros', partido: '', cor: '#7a8699', votos: data.outros?.votos || 0, pct: validVotos > 0 ? ((data.outros?.votos || 0) / validVotos) * 100 : 0 }
  ]).sort((a, b) => b.votos - a.votos);

  const invalidEntries = [
    { key: 'nuloBranco', label: 'Nulos/Brancos', partido: '', cor: '#a0a0a0', votos: data.nuloBranco?.votos || 0, pct: data.nuloBranco?.pct || 0 },
    { key: 'abstencao', label: 'Abstenção', partido: '', cor: '#555', votos: data.abstencao?.votos || 0, pct: data.abstencao?.pct || 0 }
  ];

  let html = '<div class="sim-results-bars">';
  entries.forEach(e => {
    if (e.votos <= 0 && e.key !== 'outros') return;
    html += `
      <div class="sim-result-row">
        <div class="sim-result-indicator" style="background:${e.cor}"></div>
        <div class="sim-result-name"><span>${e.label}</span>${e.partido ? `<small>${e.partido}</small>` : ''}</div>
        <div class="sim-result-bar-wrap"><div class="sim-result-bar" style="width:${Math.min(e.pct,100)}%;background:${e.cor};"></div></div>
        <div class="sim-result-numbers"><span class="sim-result-votos">${fmtInt(e.votos)}</span><span class="sim-result-pct">${fmtPct(e.pct)}</span></div>
      </div>`;
  });

  html += '<div style="height:1px;background:var(--border-color);margin:16px 0;"></div>';

  invalidEntries.forEach(e => {
    if (e.votos <= 0) return;
    html += `
      <div class="sim-result-row" style="opacity:0.8;">
        <div class="sim-result-indicator" style="background:${e.cor}"></div>
        <div class="sim-result-name"><span>${e.label}</span></div>
        <div class="sim-result-bar-wrap"><div class="sim-result-bar" style="width:${Math.min(e.pct,100)}%;background:${e.cor};"></div></div>
        <div class="sim-result-numbers"><span class="sim-result-votos">${fmtInt(e.votos)}</span><span class="sim-result-pct">${fmtPct(e.pct)}</span></div>
      </div>`;
  });

  html += '</div>';
  container.innerHTML = html;
}

// ====== CLICK ESTADO ======
function simOnClickEstado(sigla) {
  SIM.selectedUF = sigla;
  SIM.selectedMuni = null;

  document.getElementById('simEmptyState').style.display = 'none';
  document.getElementById('simPanelResults').style.display = 'block';

  document.getElementById('simPanelAreaTitle').textContent = `${UF_MAP.get(sigla)} (${sigla})`;
  
  simAtualizarBtnVoltar();
  simRefreshSidebar();

  if (SIM.modo === 'governador') {
     if (SIM.estadosLayer) { simMap.removeLayer(SIM.estadosLayer); SIM.estadosLayer = null; }
  } else {
     if (SIM.estadosLayer) simRenderMapaEstados(); 
  }
  
  simRenderMapaMunicipios(sigla);
}

// ====== NAVEGAÇÃO HIERÁRQUICA ======
function simAtualizarBtnVoltar() {
  const btn = document.getElementById('btnVoltar');
  if (!btn) return;

  // nível locais (município selecionado com locais ativos)
  if (SIM.locaisLayer && SIM.selectedMuni) {
    btn.style.display = '';
    btn.textContent = '\u2190 ' + (SIM.selectedUF || 'Estado');
    btn.title = 'Voltar para municípios';
  // nível municípios (estado selecionado)
  } else if (SIM.selectedUF) {
    if (SIM.modo === 'governador') {
      btn.style.display = 'none';
    } else {
      btn.style.display = '';
      btn.textContent = '\u2190 Brasil';
      btn.title = 'Voltar para Brasil';
    }
  } else {
    btn.style.display = 'none';
  }
}

function simVoltarNivel() {
  // vindo de locais → volta para municípios (desseleciona município)
  if (SIM.locaisLayer && SIM.selectedMuni) {
    if (SIM.locaisLayer) { simMap.removeLayer(SIM.locaisLayer); SIM.locaisLayer = null; }
    SIM.selectedMuni = null;
    simRenderMapaMunicipios(SIM.selectedUF);
    simRenderEstadoResultado(SIM.selectedUF);
    simRenderAjusteTab(SIM.selectedUF, null);
    // restore title
    document.getElementById('simEstadoTitle').textContent = `${UF_MAP.get(SIM.selectedUF)} (${SIM.selectedUF})`;
    document.getElementById('simEstadoSub').textContent = `${fmtInt(SIM.resultadosPorUF[SIM.selectedUF]?._totalEleitores)} eleitores`;
    if (SIM.overridesPorUF[SIM.selectedUF]) {
      document.getElementById('simEstadoSub').textContent += ' • Editado manualmente';
    }
    simAtualizarBtnVoltar();
  // vindo de municípios → volta para Brasil
  } else if (SIM.selectedUF) {
    SIM.selectedUF = null;
    simShowBrasilResults();
  }
}

async function simRenderMapaMunicipios(uf) {
  if (SIM.municipiosLayer) { simMap.removeLayer(SIM.municipiosLayer); SIM.municipiosLayer = null; }
  if (SIM.locaisLayer) { simMap.removeLayer(SIM.locaisLayer); SIM.locaisLayer = null; }

  // Tenta buscar geometria HD local (gerada a partir do GPKG sem generalização)
  let geo = null;

  if (SIM.ibgeMuniGeoCache[uf]) {
    // Usa geometria HD já carregada em cache
    geo = SIM.ibgeMuniGeoCache[uf];
  } else {
    // Carrega GeoJSON HD do arquivo local (municipios_hd/)
    const hdPath = DATA_BASE_URL + `municipios_hd/municipios_${uf}.geojson`;

    // Mostra loader enquanto busca geometria HD
    const loader = document.getElementById('mapLoader');
    if (loader) { loader.textContent = 'Carregando geometria municipal HD...'; loader.classList.add('visible'); }

    try {
      const hdGeo = await fetchGeoJSON(hdPath);
      if (hdGeo && hdGeo.features && hdGeo.features.length > 0) {
        SIM.ibgeMuniGeoCache[uf] = hdGeo;
        geo = hdGeo;
      }
    } catch (e) {
      console.warn('GeoJSON HD não encontrado, usando geometria simplificada:', e);
    } finally {
      if (loader) loader.classList.remove('visible');
    }
  }

  // Fallback para geometria local simplificada
  if (!geo) {
    geo = SIM.municipiosCache[uf];
  }
  if (!geo) return;

  SIM.municipiosLayer = L.geoJSON(geo, {
    style: f => {
      const codM = f.properties.CD_MUN;
      const res = SIM.resultadosPorMuni[uf]?.[codM];
      const venc = simGetVencedorMuni(uf, codM);
      const cor = simGetCorKey(venc?.key);

      let marginPct = 0;
      if (res && venc?.key) {
        const ks = SIM.candidatos.map(c => `cand_${c.id}`).concat(['outros']);
        const sorted = ks.map(k => res[k]?.votos || 0).sort((a, b) => b - a);
        const validVotos = sorted.reduce((s, v) => s + v, 0);
        marginPct = validVotos > 0 ? ((sorted[0] - (sorted[1] || 0)) / validVotos) * 100 : 0;
      }
      const marginIntensity = Math.max(0, Math.min(50, marginPct));
      const fixedRelativePct = (marginIntensity / 50) * 100;
      const fillCol = getUniversalGradientColor(cor, fixedRelativePct);

      const isSelected = SIM.selectedMuni === codM;
      const isFaded = SIM.selectedMuni && !isSelected;

      return {
        fillColor: fillCol,
        fillOpacity: isSelected ? 0 : (isFaded ? 0.3 : 0.9),
        color: isSelected ? 'transparent' : 'rgba(255, 255, 255, 0.4)',
        weight: isSelected ? 0 : 0.6,
        opacity: isSelected ? 0 : (isFaded ? 0.3 : 0.8)
      };
    },
    onEachFeature: (f, layer) => {
      const nome = f.properties.NM_MUN;
      const codM = f.properties.CD_MUN;
      const res = SIM.resultadosPorMuni[uf]?.[codM];
      const venc = simGetVencedorMuni(uf, codM);

      let rows = '';
      let validTotal = 0;
      if (res) {
         const keysObj = SIM.candidatos.map(c => 'cand_' + c.id).concat(['outros']);
         validTotal = keysObj.reduce((s, k) => s + (res[k]?.votos || 0), 0);
         const sortedKeys = [...keysObj].sort((a, b) => (res[b]?.votos || 0) - (res[a]?.votos || 0));
         sortedKeys.forEach(k => {
            const v = res[k]?.votos || 0;
            if (v <= 0) return;
            const label = k === 'outros' ? 'Outros' : (SIM.candidatos.find(c => c.id === parseInt(k.replace('cand_', '')))?.nome || k);
            const cor = simGetCorKey(k);
            const pct = validTotal > 0 ? (v / validTotal) * 100 : 0;
            rows += `<div style="display:flex;align-items:center;gap:5px;margin:2px 0;">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${cor};flex-shrink:0;"></span>
              <span style="flex:1;font-size:0.75rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${label}</span>
              <span style="font-size:0.75rem;font-weight:600;white-space:nowrap;">${pct.toFixed(1)}%</span>
              <span style="font-size:0.7rem;color:#aaa;white-space:nowrap;">(${fmtInt(v)})</span>
            </div>`;
         });
      }

      const tt = `<div style="min-width:180px;max-width:240px;">
        <div style="font-weight:600;font-size:0.82rem;margin-bottom:2px;">${nome}</div>
        <div style="font-size:0.72rem;color:#aaa;margin-bottom:6px;">${UF_MAP.get(uf) || uf}</div>
        <div style="font-size:0.7rem;color:#aaa;margin-bottom:4px;">Votos válidos: ${fmtInt(validTotal)}</div>
        <hr style="margin:4px 0;border-color:#444;">
        ${rows}
      </div>`;
      layer.bindTooltip(tt, { className: 'sim-tooltip', sticky: true });
      layer.on('click', () => {
          SIM.selectedMuni = codM;
          simRenderMapaMunicipios(uf);
          simRenderMapaLocais(uf, codM);
          simRenderMuniResultado(uf, codM);
          simRenderAjusteTab(uf, codM);
          simAtualizarBtnVoltar();
      });
    }
  }).addTo(simMap);

  if (SIM.municipiosLayer.getBounds().isValid()) simMap.fitBounds(SIM.municipiosLayer.getBounds());
  scheduleSimMapRefresh();
}

function simRenderMuniResultado(uf, codM) {
  const ufGeo = SIM.ibgeMuniGeoCache[uf] || SIM.municipiosCache[uf];
  let muniName = codM;
  if (ufGeo && ufGeo.features) {
    const f = ufGeo.features.find(x => String(x.properties.CD_MUN) === String(codM));
    if (f) muniName = f.properties.NM_MUN;
  }
  const res = SIM.resultadosPorMuni[uf]?.[codM];
  if (!res) return;

  document.getElementById('simPanelAreaTitle').textContent = `${muniName} (${uf})`;
  document.getElementById('simPanelAreaSub').textContent = `${fmtInt(res._totalEleitores)} eleitores`;
  
  simRenderBarsGenericInto(document.getElementById('simBarsContainer'), res);
}

function simRenderEstadoResultado(sigla) {
  const res = SIM.resultadosPorUF[sigla];
  if (!res) return;

  document.getElementById('simPanelAreaSub').textContent = `${fmtInt(res._totalEleitores)} eleitores`;
  if (SIM.overridesPorUF[sigla]) {
    document.getElementById('simPanelAreaSub').textContent += ' • Editado manualmente';
  }

  simRenderBarsGenericInto(document.getElementById('simBarsContainer'), res);
}

function simRenderBarsGenericInto(container, res) {
  const validKeys = SIM.candidatos.map(c => `cand_${c.id}`).concat(['outros']);
  const validVotos = validKeys.reduce((s, k) => s + (res[k]?.votos || 0), 0);

  const entries = SIM.candidatos.map(c => ({
    key: `cand_${c.id}`, label: c.nome || 'S/N', partido: c.partido, cor: c.cor,
    votos: res[`cand_${c.id}`]?.votos || 0, 
    pct: validVotos > 0 ? ((res[`cand_${c.id}`]?.votos || 0) / validVotos) * 100 : 0
  })).concat([
    { key: 'outros', label: 'Outros', partido: '', cor: '#7a8699', votos: res.outros?.votos || 0, pct: validVotos > 0 ? ((res.outros?.votos || 0) / validVotos) * 100 : 0 }
  ]).sort((a, b) => b.votos - a.votos);

  const invalidEntries = [
    { key: 'nuloBranco', label: 'Nulos/Brancos', partido: '', cor: '#a0a0a0', votos: res.nuloBranco?.votos || 0, pct: res.nuloBranco?.pct || 0 },
    { key: 'abstencao', label: 'Abstenção', partido: '', cor: '#555', votos: res.abstencao?.votos || 0, pct: res.abstencao?.pct || 0 }
  ];

  let html = '<div class="sim-results-bars">';
  entries.forEach(e => {
    if (e.votos <= 0 && e.key !== 'outros') return;
    html += `
      <div class="sim-result-row">
        <div class="sim-result-indicator" style="background:${e.cor}"></div>
        <div class="sim-result-name"><span>${e.label}</span>${e.partido ? `<small>${e.partido}</small>` : ''}</div>
        <div class="sim-result-bar-wrap"><div class="sim-result-bar" style="width:${Math.min(e.pct,100)}%;background:${e.cor};"></div></div>
        <div class="sim-result-numbers"><span class="sim-result-votos">${fmtInt(e.votos)}</span><span class="sim-result-pct">${fmtPct(e.pct)}</span></div>
      </div>`;
  });

  html += '<div style="height:1px;background:var(--border-color);margin:16px 0;"></div>';

  invalidEntries.forEach(e => {
    if (e.votos <= 0) return;
    html += `
      <div class="sim-result-row" style="opacity:0.8;">
        <div class="sim-result-indicator" style="background:${e.cor}"></div>
        <div class="sim-result-name"><span>${e.label}</span></div>
        <div class="sim-result-bar-wrap"><div class="sim-result-bar" style="width:${Math.min(e.pct,100)}%;background:${e.cor};"></div></div>
        <div class="sim-result-numbers"><span class="sim-result-votos">${fmtInt(e.votos)}</span><span class="sim-result-pct">${fmtPct(e.pct)}</span></div>
      </div>`;
  });

  html += '</div>';
  container.innerHTML = html;
}

// ====== AJUSTE CONTEXTUAL (ESTADO OU MUNICÍPIO) ======
function simRenderAjusteTab(uf, muniCode = null) {
  const isMuni = muniCode !== null;
  const res = isMuni ? SIM.resultadosPorMuni[uf]?.[muniCode] : SIM.resultadosPorUF[uf];
  if (!res) return;

  let areaNome = isMuni ? muniCode : (UF_MAP.get(uf) || uf);
  if (isMuni) {
    const ufGeo = SIM.ibgeMuniGeoCache[uf] || SIM.municipiosCache[uf];
    if (ufGeo && ufGeo.features) {
      const f = ufGeo.features.find(x => String(x.properties.CD_MUN) === String(muniCode));
      if (f) areaNome = f.properties.NM_MUN;
    }
  }

  const container = document.getElementById('simTabAjustar');
  if (!container) return;
  const allEntries = SIM.candidatos.map(c => ({ key: `cand_${c.id}`, label: c.nome || 'S/N', cor: c.cor }))
    .concat([{ key: 'outros', label: 'Outros', cor: '#7a8699' }]);

  let validVotos = 0;
  allEntries.forEach(e => { validVotos += res[e.key]?.votos || 0; });

  let html = `<div class="sim-ajuste-header" style="margin-bottom:12px; font-weight:600; color:var(--accent);">Ajustar: ${areaNome}</div>`;
  html += '<div class="sim-ajuste-section">';
  html += '<div class="sim-total-indicator valid" id="simAjusteTotal" style="margin-bottom:10px;">Total: 100.0%</div>';

  allEntries.forEach(e => {
    const pct = validVotos > 0 ? ((res[e.key]?.votos || 0) / validVotos) * 100 : 0;
    const scopeId = isMuni ? muniCode : uf || 'BR';
    html += `
      <div class="sim-slider-row">
        <span class="sim-slider-label" style="width:75px;">${e.label}</span>
        <input type="range" class="sim-ajuste-slider" min="0" max="100" step="0.01" value="${pct.toFixed(2)}" 
               data-uf="${uf||''}" data-muni="${muniCode || ''}" data-scope="${scopeId}" data-entry="${e.key}">
        <input type="number" class="sim-ajuste-val" style="width:45px;" step="0.01" value="${pct.toFixed(2)}" 
               data-uf="${uf||''}" data-muni="${muniCode || ''}" data-scope="${scopeId}" data-entry="${e.key}">
      </div>`;
  });

  html += '</div>';
  html += `<div class="sim-actions-row">
    <button class="sim-btn sim-btn-apply" id="btnAplicarAjuste" style="font-size:0.75rem;">Aplicar Ajuste</button>
    <button class="sim-btn" id="btnResetAjuste" style="font-size:0.75rem;">Resetar</button>
  </div>`;

  container.innerHTML = html;

  // Bind
  container.querySelectorAll('.sim-ajuste-slider').forEach(sl => {
    sl.addEventListener('input', e => simOnAjSlider(e, isMuni ? muniCode : uf));
  });
  container.querySelectorAll('.sim-ajuste-val').forEach(inp => {
    inp.addEventListener('change', e => simOnAjVal(e, isMuni ? muniCode : uf));
  });

  document.getElementById('btnAplicarAjuste')?.addEventListener('click', () => simApplyOverride(uf, muniCode));
  document.getElementById('btnResetAjuste')?.addEventListener('click', () => simResetOverride(uf, muniCode));
}

function simOnAjSlider(e, scopeId) {
  const entry = e.target.dataset.entry;
  const val = parseFloat(e.target.value);
  const ni = document.querySelector(`.sim-ajuste-val[data-scope="${scopeId}"][data-entry="${entry}"]`);
  if (ni) ni.value = val.toFixed(2);
  simEnforceAjusteTotal(scopeId, entry, val);
}

function simOnAjVal(e, scopeId) {
  const entry = e.target.dataset.entry;
  let val = parseFloat(e.target.value);
  if (isNaN(val)) val = 0;
  val = Math.max(0, Math.min(100, val));
  e.target.value = val.toFixed(2);
  const si = document.querySelector(`.sim-ajuste-slider[data-scope="${scopeId}"][data-entry="${entry}"]`);
  if (si) si.value = val;
  simEnforceAjusteTotal(scopeId, entry, val);
}

function simEnforceAjusteTotal(scopeId, changedEntry, newVal) {
  const allKeys = SIM.candidatos.map(c => `cand_${c.id}`).concat(['outros']);
  const values = {};
  allKeys.forEach(k => {
    const inp = document.querySelector(`.sim-ajuste-val[data-scope="${scopeId}"][data-entry="${k}"]`);
    values[k] = inp ? parseFloat(inp.value) || 0 : 0;
  });
  values[changedEntry] = newVal;

  const total = Object.values(values).reduce((s, v) => s + v, 0);

  if (total > 100.01) {
    const excess = total - 100;
    const eligible = allKeys.filter(k => k !== changedEntry && values[k] > 5);
    if (eligible.length > 0) {
      const totalEl = eligible.reduce((s, k) => s + values[k], 0);
      eligible.forEach(k => { values[k] = Math.max(0, values[k] - (values[k] / totalEl) * excess); });
    }
  }

  let nt = 0;
  allKeys.forEach(k => {
    const v = Math.max(0, values[k]);
    nt += v;
    const sl = document.querySelector(`.sim-ajuste-slider[data-scope="${scopeId}"][data-entry="${k}"]`);
    const ni = document.querySelector(`.sim-ajuste-val[data-scope="${scopeId}"][data-entry="${k}"]`);
    if (sl) sl.value = v.toFixed(2);
    if (ni) ni.value = v.toFixed(2);
  });

  const ind = document.getElementById('simAjusteTotal');
  if (ind) {
    ind.textContent = `Total: ${nt.toFixed(1)}%`;
    ind.classList.toggle('valid', Math.abs(nt - 100) < 0.5);
    ind.classList.toggle('invalid', Math.abs(nt - 100) >= 0.5);
  }
}

function simApplyOverride(sigla, muniCode = null) {
  const isMuni = muniCode !== null;
  const scopeId = isMuni ? muniCode : sigla;
  const overridesKeys = SIM.candidatos.map(c => `cand_${c.id}`).concat(['outros']);
  const allKeys = overridesKeys.concat(['nuloBranco', 'abstencao']);
  const override = {};
  
  // Get manual percentages (of valid votes)
  overridesKeys.forEach(k => {
    const inp = document.querySelector(`.sim-ajuste-val[data-scope="${scopeId}"][data-entry="${k}"]`);
    override[k] = inp ? parseFloat(inp.value) || 0 : 0;
  });
  
  // Retain the baseline invalid percentages
  const oldRes = isMuni ? (SIM.resultadosPorMuni[sigla]?.[muniCode] || {}) : (SIM.resultadosPorUF[sigla] || {});
  const nb = oldRes.nuloBranco?.pct || 0;
  const ab = oldRes.abstencao?.pct || 0;
  
  // Convert pct-of-valid to pct-of-total
  const validTotalPct = Object.values(override).reduce((s,v) => s+v, 0);
  const targetValidFrac = Math.max(0, 100 - nb - ab);
  
  overridesKeys.forEach(k => {
     if(validTotalPct > 0) {
        override[k] = (override[k] / validTotalPct) * targetValidFrac;
     } else {
        override[k] = 0;
     }
  });

  override['nuloBranco'] = nb;
  override['abstencao'] = ab;

  if (isMuni) {
    SIM.overridesPorMuni[muniCode] = override;
  } else {
    SIM.overridesPorUF[sigla] = override;
  }

  simCalcularProjecao();
  if (isMuni) {
    simRenderMuniResultado(sigla, muniCode);
    simRenderAjusteTab(sigla, muniCode);
  } else {
    simRenderMapaEstados();
    simOnClickEstado(sigla);
  }
}

function simResetOverride(sigla, muniCode = null) {
  if (muniCode !== null) {
    delete SIM.overridesPorMuni[muniCode];
  } else {
    delete SIM.overridesPorUF[sigla];
  }
  simCalcularProjecao();
  if (muniCode !== null) {
    simRenderMuniResultado(sigla, muniCode);
    simRenderAjusteTab(sigla, muniCode);
  } else {
    simRenderMapaEstados();
    simOnClickEstado(sigla);
  }
}

function simReaplicarBase() {
  SIM.overridesPorUF = {};
  SIM.overridesPorMuni = {};
  simCalcularProjecao();
  if (SIM.modo === 'governador' && SIM.estadoAlvo) {
     simOnClickEstado(SIM.estadoAlvo);
  } else {
     simRenderMapaEstados();
     simShowBrasilResults();
  }
}


// ====== LOCAIS DE VOTACAO ====== 
function simRenderMapaLocais(uf, codM = null) {
  if (SIM.estadosLayer) { simMap.removeLayer(SIM.estadosLayer); SIM.estadosLayer = null; }
  if (SIM.locaisLayer) { simMap.removeLayer(SIM.locaisLayer); SIM.locaisLayer = null; }
  // We keep the municipalities layer if a codM is provided to show the background
  if (SIM.municipiosLayer && !codM) { simMap.removeLayer(SIM.municipiosLayer); SIM.municipiosLayer = null; }

  let geo = SIM.locaisCache[uf];
  if (!geo) return;

  if (codM) {
    geo = {
        type: 'FeatureCollection',
        features: geo.features.filter(f => String(f.properties.cod_localidade_ibge || f.properties.CD_MUN || '') === String(codM))
    };
  }

  // Pre-compute min/max margin across all locations for normalisation
  const keys = SIM.candidatos.map(c => 'cand_' + c.id).concat(['outros']);
  let globalMaxMargin = 0;
  geo.features.forEach(f => {
    if (!f.properties._sim) return;
    const votes = keys.map(k => f.properties._sim.votosCand[k] || 0).sort((a, b) => b - a);
    const validTotal = votes.reduce((s, v) => s + v, 0);
    if (validTotal > 0) {
      const margin = ((votes[0] || 0) - (votes[1] || 0)) / validTotal * 100;
      if (margin > globalMaxMargin) globalMaxMargin = margin;
    }
  });
  if (globalMaxMargin === 0) globalMaxMargin = 50;

  SIM.locaisLayer = L.geoJSON(geo, {
    pointToLayer: (f, latlng) => {
      const p = f.properties;
      let maxVotos = -1, vencKey = null;
      if (p._sim && p._sim.votosCand) {
        keys.forEach(k => {
          if ((p._sim.votosCand[k] || 0) > maxVotos) { maxVotos = p._sim.votosCand[k]; vencKey = k; }
        });
      }
      const baseCor = simGetCorKey(vencKey);

      // Calculate margin for gradient (same logic as visualizer: 0-50% → gradient 0-100%)
      let marginPct = 0;
      if (p._sim && p._sim.totalAptos > 0) {
        const sortedVotes = keys.map(k => p._sim.votosCand[k] || 0).sort((a, b) => b - a);
        const validTotal = sortedVotes.reduce((s, v) => s + v, 0);
        if (validTotal > 0) {
          marginPct = ((sortedVotes[0] || 0) - (sortedVotes[1] || 0)) / validTotal * 100;
        }
      }
      let marginIntensity = Math.max(0, Math.min(50, marginPct));
      const fixedRelativePct = (marginIntensity / 50) * 100;
      const cor = getUniversalGradientColor(baseCor, fixedRelativePct);

      // Radius based on log scale of valid voters (same logic as visualizer)
      const aptos = p._sim ? p._sim.totalAptos : 0;
      const logComp = Math.log10(Math.max(1, aptos));
      let pctLog = (logComp - 2) / (4 - 2);
      pctLog = Math.max(0, Math.min(1, pctLog));
      const radius = 2 + (7 * pctLog);

      return L.circleMarker(latlng, {
        radius: radius,
        fillColor: cor,
        color: 'transparent',
        weight: 0,
        fillOpacity: 0.8,
        opacity: 0
      });
    },
    onEachFeature: (f, layer) => {
      const p = f.properties;
      if (!p._sim) return;

      // Calculate valid votes (excluding nuloBranco and abstencao)
      const validTotal = keys.reduce((s, k) => s + (p._sim.votosCand[k] || 0), 0);

      const sortedKeys = [...keys].sort((a, b) => (p._sim.votosCand[b] || 0) - (p._sim.votosCand[a] || 0));

      let rows = '';
      sortedKeys.forEach(k => {
        const v = p._sim.votosCand[k] || 0;
        if (v <= 0) return;
        const label = k === 'outros' ? 'Outros' : (SIM.candidatos.find(c => c.id === parseInt(k.replace('cand_', '')))?.nome || k);
        const cor = simGetCorKey(k);
        const pct = validTotal > 0 ? (v / validTotal) * 100 : 0;
        rows += `<div style="display:flex;align-items:center;gap:5px;margin:2px 0;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${cor};flex-shrink:0;"></span>
          <span style="flex:1;font-size:0.75rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${label}</span>
          <span style="font-size:0.75rem;font-weight:600;white-space:nowrap;">${pct.toFixed(1)}%</span>
          <span style="font-size:0.7rem;color:#aaa;white-space:nowrap;">(${fmtInt(v)})</span>
        </div>`;
      });

      const tt = `<div style="min-width:180px;max-width:240px;">
        <div style="font-weight:600;font-size:0.82rem;margin-bottom:2px;">${p.nm_locvot || 'Local'}</div>
        <div style="font-size:0.72rem;color:#aaa;margin-bottom:6px;">${p.nm_localidade || ''}</div>
        <div style="font-size:0.7rem;color:#aaa;margin-bottom:4px;">Votos válidos: ${fmtInt(validTotal)}</div>
        <hr style="margin:4px 0;border-color:#444;">
        ${rows}
      </div>`;

      layer.bindTooltip(tt, { className: 'sim-tooltip', sticky: false });
    }
  }).addTo(simMap);

  if (SIM.locaisLayer.getBounds().isValid()) {
    simMap.fitBounds(SIM.locaisLayer.getBounds(), { padding: [20, 20] });
  }
  scheduleSimMapRefresh();
}

