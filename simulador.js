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
  religiao: { label: 'Religião',  subgrupos: { catolico: 'Católico', evangelico: 'Evangélico', outras: 'Outras', semReligiao: 'Sem Religião' } },
  voto2022: { label: 'Voto 2022 (2T)', subgrupos: { lula: 'Lula (PT)', bolsonaro: 'Bolsonaro (PL)', nuloBranco: 'Nulo/Branco', abstencao: 'Abstenção' } }
};

// ====== STATE ======
const SIM = {
  candidatos: [],
  nextId: 1,
  sliders: {},
  resultadosPorUF: {},
  overridesPorUF: {},
  totalBrasil: {},
  locaisCache: {}, 
  estadosGeoJSON: null,
  estadosLayer: null,
  locaisLayer: null,
  selectedUF: null,
  currentDemoGroup: 'genero'
};

let simMap, simTileLayer;

// ====== UTILS ======
function fmtInt(n) { return (n || 0).toLocaleString('pt-BR'); }
function fmtPct(p) { return isFinite(p) ? p.toFixed(2).replace('.', ',') + '%' : '-'; }

function ensureNumber(v) {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v !== 'string') v = String(v || 0);
  const n = Number(v.replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
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
    });
  }

  // Map
  simMap = L.map('map', { zoomControl: false, minZoom: 3 }).setView([-14, -52], 4);
  simTileLayer = L.tileLayer(MAP_TILES.dark, {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    subdomains: 'abcd', maxZoom: 18
  }).addTo(simMap);
  L.control.zoom({ position: 'bottomright' }).addTo(simMap);

  // Load data
  document.getElementById('mapLoader').classList.add('visible');
  document.getElementById('mapLoader').textContent = 'Carregando dados do simulador...';
  await loadSimuladorData();
  document.getElementById('mapLoader').classList.remove('visible');

  // Init candidates
  simInitDefaultSliders();
  simAddCandidato('Lula', 'PT');
  simAddCandidato('Flávio Bolsonaro', 'PL');
  simAddCandidato('Renan Santos', 'MISSÃO');
  simAddCandidato('Ronaldo Caiado', 'PSD');

  // Populate party datalist
  const dl = document.getElementById('sim-party-list');
  if (dl) PARTY_COLORS.forEach((_, p) => { const o = document.createElement('option'); o.value = p; dl.appendChild(o); });

  // Render UI
  simRenderCandidatos();
  simRenderDemoGroup();

  // Bindings
  document.getElementById('btnAddCand').addEventListener('click', () => { simAddCandidato('', ''); simRenderCandidatos(); simRenderDemoGroup(); });
  document.getElementById('btnAplicarSimModal')?.addEventListener('click', simAplicar);
  
  // Modal handlers
  document.getElementById('btnOpenConfigMain')?.addEventListener('click', () => { document.getElementById('simConfigOverlay').classList.add('visible'); });
  document.getElementById('btnEditSim')?.addEventListener('click', () => { document.getElementById('simConfigOverlay').classList.add('visible'); });
  document.getElementById('btnCloseConfigModal')?.addEventListener('click', () => { document.getElementById('simConfigOverlay').classList.remove('visible'); });
  
  // Start with modal open
  document.getElementById('simConfigOverlay').classList.add('visible');

  document.getElementById('btnVoltarBrasil')?.addEventListener('click', () => { SIM.selectedUF = null; simShowBrasilResults(); });

  // Estado tab buttons
  document.getElementById('btnEstadoResultado')?.addEventListener('click', function() {
    simEstadoTabSwitch(this, 'resultado');
  });
  document.getElementById('btnEstadoAjustar')?.addEventListener('click', function() {
    simEstadoTabSwitch(this, 'ajustar');
  });
  document.getElementById('btnEstadoLocais')?.addEventListener('click', function() {
    simEstadoTabSwitch(this, 'locais');
    if (SIM.selectedUF) simRenderMapaLocais(SIM.selectedUF);
  });
}

// ====== DATA ======
async function loadSimuladorData() {
  try {
    const geoRes = await fetch(DATA_BASE_URL + 'estados_brasil.geojson');
    if (!geoRes.ok) throw new Error('Dados não encontrados');
    SIM.estadosGeoJSON = await geoRes.json();
    
    // Lazy load the states data
    const loader = document.getElementById('mapLoader');
    let loadedCount = 0;
    const CHUNK_SIZE = 5;
    const ufKeys = Array.from(UF_MAP.keys()).filter(k => k !== 'BR');
    
    for (let i = 0; i < ufKeys.length; i += CHUNK_SIZE) {
      const chunk = ufKeys.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map(async (uf) => {
        const presPath = `presidente_por_estado2022/presidente_${uf}_2022.geojson`;
        const locPath = `locais_votacao_2022/locais_votacao_2022_${uf}.geojson`;
        
        try {
          const presData = await fetchGeoJSON(presPath).catch(e=>null);
          const locData = await fetchGeoJSON(locPath).catch(e=>null);
          if(!presData) return;
          
          const locaisMap = new Map();
          if (locData && locData.features) {
            locData.features.forEach(f => {
              locaisMap.set(String(f.properties.local_id || f.properties.nr_locvot), f.properties);
            });
          }

          const featuresFinais = [];
          presData.features.forEach(f => {
            let id = String(f.properties.local_id || f.properties.NR_LOCAL_VOTACAO);
            const demoProps = locaisMap.get(id);
            if (demoProps) {
              f.properties = { ...f.properties, ...demoProps };
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
  const cor = PARTY_COLORS.get(partido.toUpperCase()) || '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6,'0');
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
      const auto = PARTY_COLORS.get(c.partido.toUpperCase());
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
  for (const cat in DEMO_GROUPS) {
    const group = DEMO_GROUPS[cat];
    const isVoto2022 = (cat === 'voto2022');

    // Build entries list based on category
    const catEntries = SIM.candidatos.map(c => ({ key: `cand_${c.id}`, label: c.nome || `Cand. ${c.id}`, cor: c.cor }))
      .concat([{ key: 'outros', label: 'Outros', cor: '#7a8699' }]);
    if (isVoto2022) {
      catEntries.push({ key: 'nuloBranco', label: 'Nulos/Brancos', cor: '#a0a0a0' });
      catEntries.push({ key: 'abstencao', label: 'Abstenção', cor: '#555' });
    }

    html += '<div style="margin-bottom: 24px;">';
    html += `<h4 style="margin:0 0 10px 0; border-bottom:1px solid var(--border-color); padding-bottom:6px; color:var(--text);">${group.label}${!isVoto2022 ? ' <small style="color:var(--text-secondary);font-weight:normal;">(votos válidos)</small>' : ''}</h4>`;

    for (const [subKey, subLabel] of Object.entries(group.subgrupos)) {
      const subData = SIM.sliders[cat]?.[subKey] || {};
      const total = catEntries.reduce((s, e) => s + (subData[e.key] || 0), 0);
      const isValid = Math.abs(total - 100) < 0.5;

      html += `<div class="sim-subgroup" data-cat="${cat}" data-sub="${subKey}">`;
      html += `<div class="sim-subgroup-title">${subLabel}</div>`;
      html += `<div class="sim-total-indicator ${isValid ? 'valid' : 'invalid'}">Total: ${total.toFixed(1)}%</div>`;

      catEntries.forEach(entry => {
        const val = subData[entry.key] || 0;
        html += `
          <div class="sim-slider-row">
            <span class="sim-slider-indicator" style="background:${entry.cor}"></span>
            <span class="sim-slider-label" title="${entry.label}">${entry.label}</span>
            <input type="range" class="sim-slider" min="0" max="100" step="0.5" value="${val}"
                   data-cat="${cat}" data-sub="${subKey}" data-entry="${entry.key}">
            <input type="number" class="sim-slider-val" min="0" max="100" step="0.01" value="${val.toFixed(2)}"
                   data-cat="${cat}" data-sub="${subKey}" data-entry="${entry.key}">
            <span class="sim-slider-pct">%</span>
          </div>`;
      });

      html += '</div>';
    }
    html += '</div>';
  }

  container.innerHTML = html;

  // Bind slider events
  container.querySelectorAll('.sim-slider').forEach(sl => {
    sl.addEventListener('input', e => {
      const { cat: c, sub: s, entry: en } = e.target.dataset;
      let v = parseFloat(e.target.value);
      if (!SIM.sliders[c]) SIM.sliders[c] = {};
      if (!SIM.sliders[c][s]) SIM.sliders[c][s] = {};

      // Enforce 100% cap
      const keys = simGetKeysForCat(c);
      const otherTotal = keys.filter(k => k !== en).reduce((sum, k) => sum + (SIM.sliders[c][s][k] || 0), 0);
      const maxAllowed = Math.max(0, 100 - otherTotal);
      v = Math.min(v, maxAllowed);
      e.target.value = v;

      SIM.sliders[c][s][en] = v;
      const ni = container.querySelector(`.sim-slider-val[data-cat="${c}"][data-sub="${s}"][data-entry="${en}"]`);
      if (ni) ni.value = v.toFixed(2);
      simUpdateSubTotal(container, c, s);
    });
  });

  container.querySelectorAll('.sim-slider-val').forEach(inp => {
    inp.addEventListener('change', e => {
      const { cat: c, sub: s, entry: en } = e.target.dataset;
      let v = parseFloat(e.target.value);
      if (isNaN(v)) v = 0;
      v = Math.max(0, Math.min(100, v));
      if (!SIM.sliders[c]) SIM.sliders[c] = {};
      if (!SIM.sliders[c][s]) SIM.sliders[c][s] = {};

      // Enforce 100% cap
      const keys = simGetKeysForCat(c);
      const otherTotal = keys.filter(k => k !== en).reduce((sum, k) => sum + (SIM.sliders[c][s][k] || 0), 0);
      const maxAllowed = Math.max(0, 100 - otherTotal);
      v = Math.min(v, maxAllowed);

      e.target.value = v.toFixed(2);
      SIM.sliders[c][s][en] = v;
      const ri = container.querySelector(`.sim-slider[data-cat="${c}"][data-sub="${s}"][data-entry="${en}"]`);
      if (ri) ri.value = v;
      simUpdateSubTotal(container, c, s);
    });
  });
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

// ====== PROJEÇÃO ======
function simCalcularProjecao() {
  SIM.resultadosPorUF = {};
  SIM.totalBrasil = {};

  const allKeys = SIM.candidatos.map(c => `cand_${c.id}`).concat(['outros', 'nuloBranco', 'abstencao']);
  let totalEleitoresBR = 0;
  const totalVotosBR = {};
  allKeys.forEach(k => totalVotosBR[k] = 0);

  Object.keys(SIM.locaisCache).forEach(uf => {
    const geo = SIM.locaisCache[uf];
    if (!geo) return;

    let totalEleitoresUF = 0;
    const ufRes = {};
    allKeys.forEach(k => ufRes[k] = { votos: 0, pct: 0 });

    geo.features.forEach(f => {
      const p = f.properties;
      const aptos = ensureNumber(p['Eleitores_Aptos 1T']) || ensureNumber(p['Eleitores_Aptos 2T']) || 0;
      if(aptos === 0) return;

      const pM = (ensureNumber(p['Pct Mulheres']) || 0)/100;
      const pH = (ensureNumber(p['Pct Homens']) || 0)/100;
      
      const p16_29 = (ensureNumber(p['Pct 15 a 19 anos']) + ensureNumber(p['Pct 20 a 24 anos']) + ensureNumber(p['Pct 25 a 29 anos']))/100;
      const p30_45 = (ensureNumber(p['Pct 30 a 34 anos']) + ensureNumber(p['Pct 35 a 39 anos']) + ensureNumber(p['Pct 40 a 44 anos']))/100;
      const p46_59 = (ensureNumber(p['Pct 45 a 49 anos']) + ensureNumber(p['Pct 50 a 54 anos']) + ensureNumber(p['Pct 55 a 59 anos']))/100;
      const p60_plus = 1 - (p16_29 + p30_45 + p46_59); 

      const vLula = ensureNumber(p['LULA (PT) (ELEITO) 2T']) || ensureNumber(p['LULA (PT) (2° TURNO) 1T']);  
      const vBolso = ensureNumber(p['JAIR BOLSONARO (PL) (NÃO ELEITO) 2T']) || ensureNumber(p['JAIR BOLSONARO (PL) (2° TURNO) 1T']);
      const abs_nulo_branco = Math.max(0, aptos - vLula - vBolso);

      let pLula = vLula / aptos || 0;
      let pBolso = vBolso / aptos || 0;
      let pOts = abs_nulo_branco / aptos || 0;
      const rMedia = ensureNumber(p['Renda Media']) || 0;
      let r_bucket = '0-1k';
      if (rMedia > 5000) r_bucket = '5k+';
      else if (rMedia > 4000) r_bucket = '4k-5k';
      else if (rMedia > 3000) r_bucket = '3k-4k';
      else if (rMedia > 2000) r_bucket = '2k-3k';
      else if (rMedia > 1000) r_bucket = '1k-2k';

      // Distribuir os votos deste local
      const localVotes = {};
      allKeys.forEach(k => localVotes[k] = 0);
      
      let validWeight = 0;
      let voto2022Weight = 0;
      const validScores = {}; 
      const voto2022Scores = {};
      allKeys.forEach(k => { validScores[k] = 0; voto2022Scores[k] = 0; });
      
      const validKeys = SIM.candidatos.map(c => `cand_${c.id}`).concat(['outros']);
      
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
      calcGroupScore('voto2022', { lula: pLula, bolsonaro: pBolso, abstencao: pOts });
      
      const rWeights = { '0-1k':0, '1k-2k':0, '2k-3k':0, '3k-4k':0, '4k-5k':0, '5k+':0 };
      rWeights[r_bucket] = 1.0;
      calcGroupScore('renda', rWeights);

      if (voto2022Weight > 0) allKeys.forEach(k => voto2022Scores[k] /= voto2022Weight);
      if (validWeight > 0) validKeys.forEach(k => validScores[k] /= validWeight);

      const nuloBrancoPct = voto2022Scores.nuloBranco || 0;
      const abstencaoPct = voto2022Scores.abstencao || 0;
      const validFraction = Math.max(0, 100 - nuloBrancoPct - abstencaoPct);

      const combinedValid = {};
      validKeys.forEach(k => combinedValid[k] = 0);
      if (validWeight > 0 && voto2022Weight > 0) {
        const totalW = validWeight + voto2022Weight;
        validKeys.forEach(k => combinedValid[k] = (validScores[k] * validWeight + voto2022Scores[k] * voto2022Weight) / totalW);
      } else if (validWeight > 0) {
        validKeys.forEach(k => combinedValid[k] = validScores[k]);
      } else if (voto2022Weight > 0) {
        validKeys.forEach(k => combinedValid[k] = voto2022Scores[k]);
      }

      const sumValid = validKeys.reduce((s, k) => s + combinedValid[k], 0);
      if (sumValid > 0) {
        validKeys.forEach(k => combinedValid[k] = (combinedValid[k] / sumValid) * validFraction);
      }

      const finalPcts = {};
      validKeys.forEach(k => finalPcts[k] = combinedValid[k]);
      finalPcts.nuloBranco = nuloBrancoPct;
      finalPcts.abstencao = abstencaoPct;

      const totalPct = allKeys.reduce((s, k) => s + (finalPcts[k] || 0), 0);
      if (totalPct > 0 && Math.abs(totalPct - 100) > 0.01) {
        allKeys.forEach(k => finalPcts[k] = ((finalPcts[k] || 0) / totalPct) * 100);
      }

      allKeys.forEach(k => {
        const votos = Math.round(aptos * (finalPcts[k] || 0) / 100);
        ufRes[k].votos += votos;
        totalVotosBR[k] += votos;
      });

      totalEleitoresUF += aptos;

      // Armazenamos resultados no point para usar no mapa de locais posteriormente
      f.properties._sim = { votosCand: {}, totalAptos: aptos };
      allKeys.forEach(k => f.properties._sim.votosCand[k] = Math.round(aptos * (finalPcts[k] || 0) / 100));
    });

    // Calcular pct por uf
    allKeys.forEach(k => {
      ufRes[k].pct = totalEleitoresUF > 0 ? (ufRes[k].votos / totalEleitoresUF) * 100 : 0;
    });

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

// ====== APLICAR ======
function simAplicar() {
  document.getElementById('simConfigOverlay').classList.remove('visible');
  simCalcularProjecao();
  simRenderMapaEstados();
  simShowBrasilResults();
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

      return {
        fillColor: fillCol,
        fillOpacity: 0.85,
        color: isSelected ? '#fff' : '#333',
        weight: isSelected ? 2.5 : 1,
        opacity: isSelected ? 1 : 0.7
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
}

// ====== RESULTADOS BRASIL (Right Panel) ======
function simShowBrasilResults() {
  SIM.selectedUF = null;
  document.getElementById('simEmptyState').style.display = 'none';
  document.getElementById('simBrasilResults').style.display = '';
  document.getElementById('simEstadoResults').style.display = 'none';
  document.getElementById('simPanelTitle').textContent = 'Resultados';

  // Remove locais layer and restore states layer
  if (SIM.locaisLayer) { simMap.removeLayer(SIM.locaisLayer); SIM.locaisLayer = null; }
  simRenderMapaEstados(); // re-render states with no selection highlight

  const total = SIM.totalBrasil;
  document.getElementById('simBrasilEleitores').textContent = `${fmtInt(total._totalEleitores || 0)} eleitores`;

  simRenderBarsInto('simBrasilBars', total);

  // Metrics
  const votosValidos = SIM.candidatos.reduce((s, c) => s + (total[`cand_${c.id}`]?.votos || 0), 0) + (total.outros?.votos || 0);
  const nb = total.nuloBranco?.votos || 0;
  const ab = total.abstencao?.votos || 0;

  document.getElementById('simBrasilMetrics').innerHTML = `
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
  document.getElementById('simEmptyState').style.display = 'none';
  document.getElementById('simBrasilResults').style.display = 'none';
  document.getElementById('simEstadoResults').style.display = '';
  document.getElementById('simPanelTitle').textContent = UF_MAP.get(sigla) || sigla;

  document.getElementById('simEstadoTitle').textContent = `${UF_MAP.get(sigla)} (${sigla})`;
  const demo = SIM.demografiaUF?.[sigla];
  document.getElementById('simEstadoSub').textContent = demo ? `${fmtInt(demo.eleitores)} eleitores` : '';

  if (SIM.overridesPorUF[sigla]) {
    document.getElementById('simEstadoSub').textContent += ' • Editado manualmente';
  }

  // Show resultado tab
  const tabs = document.querySelectorAll('#simEstadoResults .chip-button');
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === 'resultado'));
  document.getElementById('simEstadoTabResultado').style.display = '';
  document.getElementById('simEstadoTabAjustar').style.display = 'none';

  simRenderEstadoResultado(sigla);
  simRenderEstadoAjuste(sigla);

  if (SIM.estadosLayer) simRenderMapaEstados(); // refresh highlight
}

function simEstadoTabSwitch(btn, tab) {
  const parent = document.getElementById('simEstadoResults');
  parent.querySelectorAll('.chip-button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('simEstadoTabResultado').style.display = tab === 'resultado' ? '' : 'none';
  document.getElementById('simEstadoTabAjustar').style.display = tab === 'ajustar' ? '' : 'none';
}

function simRenderEstadoResultado(sigla) {
  const res = SIM.resultadosPorUF[sigla];
  if (!res) return;

  const container = document.getElementById('simEstadoTabResultado');
  simRenderBarsGenericInto(container, res);
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

// ====== AJUSTE DE ESTADO ======
function simRenderEstadoAjuste(sigla) {
  const res = SIM.resultadosPorUF[sigla];
  if (!res) return;

  const container = document.getElementById('simEstadoTabAjustar');
  const allEntries = SIM.candidatos.map(c => ({ key: `cand_${c.id}`, label: c.nome || 'S/N', cor: c.cor }))
    .concat([
      { key: 'outros', label: 'Outros', cor: '#7a8699' },
      { key: 'nuloBranco', label: 'Nulos/Brancos', cor: '#a0a0a0' },
      { key: 'abstencao', label: 'Abstenção', cor: '#555' }
    ]);

  let html = '<div class="sim-ajuste-section">';
  html += '<div class="sim-total-indicator valid" id="simAjusteTotal">Total: 100.0%</div>';

  allEntries.forEach(e => {
    const pct = res[e.key]?.pct || 0;
    html += `
      <div class="sim-slider-row">
        <span class="sim-slider-indicator" style="background:${e.cor}"></span>
        <span class="sim-slider-label">${e.label}</span>
        <input type="range" class="sim-ajuste-slider" min="0" max="100" step="0.01" value="${pct.toFixed(2)}" data-uf="${sigla}" data-entry="${e.key}">
        <input type="number" class="sim-ajuste-val" min="0" max="100" step="0.01" value="${pct.toFixed(2)}" data-uf="${sigla}" data-entry="${e.key}">
        <span class="sim-slider-pct">%</span>
      </div>`;
  });

  html += '</div>';
  html += `<div class="sim-actions-row">
    <button class="sim-btn sim-btn-apply" id="btnAplicarAjuste">Aplicar Ajuste</button>
    <button class="sim-btn" id="btnResetAjuste">Resetar</button>
  </div>`;

  container.innerHTML = html;

  // Bind
  container.querySelectorAll('.sim-ajuste-slider').forEach(sl => {
    sl.addEventListener('input', e => simOnAjSlider(e, sigla, allEntries));
  });

  container.querySelectorAll('.sim-ajuste-val').forEach(inp => {
    inp.addEventListener('change', e => simOnAjVal(e, sigla, allEntries));
  });

  document.getElementById('btnAplicarAjuste')?.addEventListener('click', () => simApplyOverride(sigla));
  document.getElementById('btnResetAjuste')?.addEventListener('click', () => simResetOverride(sigla));
}

function simOnAjSlider(e, sigla) {
  const entry = e.target.dataset.entry;
  const val = parseFloat(e.target.value);
  const ni = document.querySelector(`.sim-ajuste-val[data-uf="${sigla}"][data-entry="${entry}"]`);
  if (ni) ni.value = val.toFixed(2);
  simEnforceAjusteTotal(sigla, entry, val);
}

function simOnAjVal(e, sigla) {
  const entry = e.target.dataset.entry;
  let val = parseFloat(e.target.value);
  if (isNaN(val)) val = 0;
  val = Math.max(0, Math.min(100, val));
  e.target.value = val.toFixed(2);
  const si = document.querySelector(`.sim-ajuste-slider[data-uf="${sigla}"][data-entry="${entry}"]`);
  if (si) si.value = val;
  simEnforceAjusteTotal(sigla, entry, val);
}

function simEnforceAjusteTotal(sigla, changedEntry, newVal) {
  const allKeys = SIM.candidatos.map(c => `cand_${c.id}`).concat(['outros', 'nuloBranco', 'abstencao']);
  const values = {};
  allKeys.forEach(k => {
    const inp = document.querySelector(`.sim-ajuste-val[data-uf="${sigla}"][data-entry="${k}"]`);
    values[k] = inp ? parseFloat(inp.value) || 0 : 0;
  });
  values[changedEntry] = newVal;

  const total = Object.values(values).reduce((s, v) => s + v, 0);

  if (total > 100.01) {
    const excess = total - 100;
    const eligible = allKeys.filter(k =>
      k !== changedEntry && k !== 'nuloBranco' && k !== 'abstencao' && values[k] > 5
    );
    if (eligible.length > 0) {
      const totalEl = eligible.reduce((s, k) => s + values[k], 0);
      eligible.forEach(k => { values[k] = Math.max(0, values[k] - (values[k] / totalEl) * excess); });
    }
  }

  let nt = 0;
  allKeys.forEach(k => {
    const v = Math.max(0, values[k]);
    nt += v;
    const sl = document.querySelector(`.sim-ajuste-slider[data-uf="${sigla}"][data-entry="${k}"]`);
    const ni = document.querySelector(`.sim-ajuste-val[data-uf="${sigla}"][data-entry="${k}"]`);
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

function simApplyOverride(sigla) {
  const allKeys = SIM.candidatos.map(c => `cand_${c.id}`).concat(['outros', 'nuloBranco', 'abstencao']);
  const override = {};
  allKeys.forEach(k => {
    const inp = document.querySelector(`.sim-ajuste-val[data-uf="${sigla}"][data-entry="${k}"]`);
    override[k] = inp ? parseFloat(inp.value) || 0 : 0;
  });
  SIM.overridesPorUF[sigla] = override;

  simCalcularProjecao();
  simRenderMapaEstados();
  simOnClickEstado(sigla); // refresh
}

function simResetOverride(sigla) {
  delete SIM.overridesPorUF[sigla];
  simCalcularProjecao();
  simRenderMapaEstados();
  simOnClickEstado(sigla);
}

function simReaplicarBase() {
  SIM.overridesPorUF = {};
  simCalcularProjecao();
  simRenderMapaEstados();
  simShowBrasilResults();
}


// ====== LOCAIS DE VOTACAO ====== 
function simRenderMapaLocais(uf) {
  // Remove existing layers
  if (SIM.estadosLayer) { simMap.removeLayer(SIM.estadosLayer); SIM.estadosLayer = null; }
  if (SIM.locaisLayer) { simMap.removeLayer(SIM.locaisLayer); SIM.locaisLayer = null; }

  const geo = SIM.locaisCache[uf];
  if (!geo) return;

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

  simMap.fitBounds(SIM.locaisLayer.getBounds(), { padding: [20, 20] });
}

