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
  overridesPorUF: {},
  totalBrasil: {},
  locaisCache: {}, 
  estadosGeoJSON: null,
  estadosLayer: null,
  municipiosLayer: null,
  locaisLayer: null,
  selectedUF: null,
  selectedMuni: null,
  currentDemoGroup: 'genero',
  religiaoMuni: {}
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
  
  // Modal handlers
  document.getElementById('btnOpenConfigMain')?.addEventListener('click', () => { document.getElementById('simConfigOverlay').classList.add('visible'); });
  document.getElementById('btnEditSim')?.addEventListener('click', () => { document.getElementById('simConfigOverlay').classList.add('visible'); });
  document.getElementById('btnCloseConfigModal')?.addEventListener('click', () => { document.getElementById('simConfigOverlay').classList.remove('visible'); });
  
  // Start with modal open
  document.getElementById('simConfigOverlay').classList.add('visible');

  document.getElementById('btnVoltarBrasil')?.addEventListener('click', () => { SIM.selectedUF = null; simShowBrasilResults(); });

  document.getElementById('btnEstadoResultado')?.addEventListener('click', function(e) {
    simEstadoTabSwitch(e.currentTarget, 'resultado');
  });
  document.getElementById('btnEstadoAjustar')?.addEventListener('click', function(e) {
    simEstadoTabSwitch(e.currentTarget, 'ajustar');
  });
}

// ====== DATA ======
async function loadSimuladorData() {
  try {
    SIM.religiaoMuni = await fetchGeoJSON(DATA_BASE_URL + 'religiao_municipios.json').catch(e => ({}));
    SIM.tseDemographics = await fetchGeoJSON(DATA_BASE_URL + 'tse_demographics_locais.json').catch(e => ({}));
    
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
function simRenderAlvoSelector() {
  const container = document.getElementById('simCandList');
  if (!container) return;
  // We'll prepend the selector above the candidates list
  
  let optionsHtml = `<option value="BR" ${SIM.modo === 'presidencial' ? 'selected' : ''}>Brasil (Presidencial)</option>`;
  Array.from(UF_MAP.entries()).sort((a,b)=>a[1].localeCompare(b[1])).forEach(([sigla, nome]) => {
     const isSelected = SIM.modo === 'governador' && SIM.estadoAlvo === sigla;
     optionsHtml += `<option value="${sigla}" ${isSelected ? 'selected' : ''}>${nome} (Governador)</option>`;
  });

  const selectorHtml = `
    <div style="margin-bottom:20px;">
      <label style="display:block;margin-bottom:8px;font-weight:600;font-size:0.9rem;">Alvo da Simulação</label>
      <select id="simAlvoSelector" class="sim-cand-partido" style="width:100%; border:1px solid var(--border-color); background:var(--bg-panel); color:var(--text); padding:8px; border-radius:4px;">
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
         const keys = Object.keys(geo.features[0].properties).filter(k => k.includes('1T') && k.startsWith('Gov_'));
         const sums = {};
         geo.features.forEach(f => {
            const p = f.properties;
            keys.forEach(k => sums[k] = (sums[k] || 0) + (Number(p[k]) || 0));
         });
         
         const validTotal = sums['Gov_Total_Votos_Validos 1T'] || 1;
         const subgrupos = {};
         
         // Candidates > 1%
         const candKeys = keys.filter(k => k !== 'Gov_Total_Votos_Validos 1T' && k !== 'Gov_Eleitores_Aptos 1T' && k !== 'Gov_Votos_Brancos 1T' && k !== 'Gov_Votos_Nulos 1T' && k !== 'Gov_Abstenções 1T' && !k.includes('Absten'));
         candKeys.forEach(k => {
             const pct = sums[k] / validTotal;
             if (pct > 0.01) {
                 // Format name nicely: e.g. "Gov_GLADSON CAMELI (PP) (ELEITO) 1T" -> "Gladson Cameli (PP)"
                 let name = k.replace('Gov_', '').replace(' (ELEITO) 1T', '').replace(' (NÃO ELEITO) 1T', '').replace(' (NO ELEITO) 1T', '');
                 name = name.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
                 subgrupos[k] = name;
             }
         });
         
         subgrupos['nuloBranco'] = 'Nulo/Branco';
         subgrupos['abstencao'] = 'Abstenção';
         
         DEMO_GROUPS.voto2022.subgrupos = subgrupos;
         
         // Start with empty candidate list
         SIM.candidatos = [];
         SIM.sliders = {};
         simInitDefaultSliders();
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
  SIM.resultadosPorMuni = {};

  const allKeys = SIM.candidatos.map(c => `cand_${c.id}`).concat(['outros', 'nuloBranco', 'abstencao']);
  let totalEleitoresBR = 0;
  const totalVotosBR = {};
  allKeys.forEach(k => totalVotosBR[k] = 0);
  
  // Clean all overriding effects first
  allKeys.forEach(k => totalVotosBR[k] = 0);

    const cacheKeys = SIM.modo === 'governador' && SIM.estadoAlvo ? [SIM.estadoAlvo] : Object.keys(SIM.locaisCache);

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

      let pOts = 0;
      const voto2022Proxy = {};
      
      if (SIM.modo === 'presidencial') {
         const vLula = ensureNumber(p['LULA (PT) (ELEITO) 2T']) || ensureNumber(p['LULA (PT) (2° TURNO) 1T']);  
         const vBolso = ensureNumber(p['JAIR BOLSONARO (PL) (NÃO ELEITO) 2T']) || ensureNumber(p['JAIR BOLSONARO (PL) (2° TURNO) 1T']);
         const abs_nulo_branco = Math.max(0, aptos - vLula - vBolso);
         voto2022Proxy.lula = vLula / aptos || 0;
         voto2022Proxy.bolsonaro = vBolso / aptos || 0;
         pOts = abs_nulo_branco / aptos || 0;
      } else {
         let subgrupos = DEMO_GROUPS.voto2022.subgrupos;
         let usedKeysVotos = 0;
         for (let govKey in subgrupos) {
            if (govKey !== 'nuloBranco' && govKey !== 'abstencao') {
               const v = ensureNumber(p[`Gov_${govKey}`]) || ensureNumber(p[govKey]) || 0;
               voto2022Proxy[govKey] = v / aptos || 0;
               usedKeysVotos += v;
            }
         }
         const abs_nulo_branco = Math.max(0, aptos - usedKeysVotos);
         pOts = abs_nulo_branco / aptos || 0;
      }

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
      calcGroupScore('educacao', { fundamental: pFund, medio: pMed, superior: pSup });
      calcGroupScore('voto2022', { ...voto2022Proxy, abstencao: pOts });
      
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

      const combinedValid = {};
      validKeys.forEach(k => combinedValid[k] = 0);
      if (validWeight > 0 && voto2022Weight > 0) {
        const adjusted2022W = validWeight * 3;
        const totalW = validWeight + adjusted2022W;
        validKeys.forEach(k => combinedValid[k] = (validScores[k] * validWeight + voto2022Scores[k] * adjusted2022W) / totalW);
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
      
      if (codM) {
        if (!SIM.resultadosPorMuni[uf]) SIM.resultadosPorMuni[uf] = {};
        if (!SIM.resultadosPorMuni[uf][codM]) {
          SIM.resultadosPorMuni[uf][codM] = {};
          allKeys.forEach(k => SIM.resultadosPorMuni[uf][codM][k] = { votos: 0, pct: 0 });
          SIM.resultadosPorMuni[uf][codM]._totalEleitores = 0;
        }
        allKeys.forEach(k => {
           const votos = Math.round(aptos * (finalPcts[k] || 0) / 100);
           SIM.resultadosPorMuni[uf][codM][k].votos += votos;
        });
        SIM.resultadosPorMuni[uf][codM]._totalEleitores += aptos;
      }

      // Armazenamos resultados no point para usar no mapa de locais posteriormente
      f.properties._sim = { votosCand: {}, totalAptos: aptos };
      allKeys.forEach(k => f.properties._sim.votosCand[k] = Math.round(aptos * (finalPcts[k] || 0) / 100));
    });

    // Calcular pct por uf
    allKeys.forEach(k => {
      ufRes[k].pct = totalEleitoresUF > 0 ? (ufRes[k].votos / totalEleitoresUF) * 100 : 0;
    });

    if (SIM.resultadosPorMuni[uf]) {
        Object.keys(SIM.resultadosPorMuni[uf]).forEach(codM => {
            const mRes = SIM.resultadosPorMuni[uf][codM];
            allKeys.forEach(k => {
                mRes[k].pct = mRes._totalEleitores > 0 ? (mRes[k].votos / mRes._totalEleitores) * 100 : 0;
            });
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

           // update totalVotosBR by subtracting old ones and adding new ones
           totalVotosBR[k] -= oldVotosUF; 
           ufRes[k].pct = oRes[k] || 0;
           ufRes[k].votos = newVotosUF;
           totalVotosBR[k] += ufRes[k].votos;
        });
    }

    // Set totalEleitores
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

// ====== APLICAR ======
function simAplicar() {
  document.getElementById('simConfigOverlay').classList.remove('visible');
  simCalcularProjecao();
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
  if (SIM.municipiosLayer) { simMap.removeLayer(SIM.municipiosLayer); SIM.municipiosLayer = null; }
  
  if (SIM.modo === 'governador') {
     // If governor mode, don't show Brasil view. Hide and go back to config overlay.
     document.getElementById('simBrasilResults').style.display = 'none';
     document.getElementById('simConfigOverlay').classList.add('visible');
     return;
  }
  
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
  document.getElementById('simEstadoSub').textContent = `${fmtInt(SIM.resultadosPorUF[sigla]?._totalEleitores)} eleitores`;

  if (SIM.overridesPorUF[sigla]) {
    document.getElementById('simEstadoSub').textContent += ' • Editado manualmente';
  }

  // Adjust go-back button state based on Mode
  const btnVoltar = document.getElementById('btnVoltarBrasil');
  if (btnVoltar) {
     if (SIM.modo === 'governador') {
        btnVoltar.style.display = 'none'; // Governors don't have a 'Brasil' view to go back to cleanly
     } else {
        btnVoltar.style.display = '';
     }
  }

  SIM.selectedMuni = null;

  // Show resultado tab
  const tabs = document.querySelectorAll('#simEstadoResults .chip-button');
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === 'resultado'));
  document.getElementById('simEstadoTabResultado').style.display = '';
  document.getElementById('simEstadoTabAjustar').style.display = 'none';

  simRenderEstadoResultado(sigla);
  simRenderEstadoAjuste(sigla);

  if (SIM.modo === 'governador') {
     if (SIM.estadosLayer) { simMap.removeLayer(SIM.estadosLayer); SIM.estadosLayer = null; }
  } else {
     if (SIM.estadosLayer) simRenderMapaEstados(); // refresh highlight
  }
  
  simRenderMapaMunicipios(sigla);
}

function simRenderMapaMunicipios(uf) {
  if (SIM.municipiosLayer) { simMap.removeLayer(SIM.municipiosLayer); SIM.municipiosLayer = null; }
  if (SIM.locaisLayer) { simMap.removeLayer(SIM.locaisLayer); SIM.locaisLayer = null; }

  const geo = SIM.municipiosCache[uf];
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

      return {
        fillColor: fillCol,
        fillOpacity: 0.9,
        color: isSelected ? '#fff' : '#444',
        weight: isSelected ? 3 : 1,
        opacity: isSelected ? 1 : 0.8
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
         if (SIM.municipiosLayer) simMap.removeLayer(SIM.municipiosLayer);
         simRenderMapaLocais(uf, codM);
         simRenderMuniResultado(uf, codM);
      });
    }
  }).addTo(simMap);

  if (SIM.municipiosLayer.getBounds().isValid()) simMap.fitBounds(SIM.municipiosLayer.getBounds());
}

function simEstadoTabSwitch(btn, tab) {
  const parent = document.getElementById('simEstadoResults');
  parent.querySelectorAll('.chip-button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('simEstadoTabResultado').style.display = tab === 'resultado' ? '' : 'none';
  document.getElementById('simEstadoTabAjustar').style.display = tab === 'ajustar' ? '' : 'none';
}

function simRenderMuniResultado(uf, codM) {
  const ufGeo = SIM.municipiosCache[uf];
  let muniName = codM;
  if (ufGeo && ufGeo.features) {
    const f = ufGeo.features.find(x => String(x.properties.CD_MUN) === String(codM));
    if (f) muniName = f.properties.NM_MUN;
  }
  const res = SIM.resultadosPorMuni[uf]?.[codM];
  if (!res) return;

  document.getElementById('simEstadoTitle').textContent = `${muniName} (${uf})`;
  document.getElementById('simEstadoSub').textContent = `${fmtInt(res._totalEleitores)} eleitores`;
  
  const container = document.getElementById('simEstadoTabResultado');
  simRenderBarsGenericInto(container, res);
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
      { key: 'outros', label: 'Outros', cor: '#7a8699' }
    ]);

  let validVotos = 0;
  allEntries.forEach(e => { validVotos += res[e.key]?.votos || 0; });

  let html = '<div class="sim-ajuste-section">';
  html += '<div class="sim-total-indicator valid" id="simAjusteTotal">Total: 100.0%</div>';

  allEntries.forEach(e => {
    const pct = validVotos > 0 ? ((res[e.key]?.votos || 0) / validVotos) * 100 : 0;
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
  const allKeys = SIM.candidatos.map(c => `cand_${c.id}`).concat(['outros']);
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
      k !== changedEntry && values[k] > 5
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
  const overridesKeys = SIM.candidatos.map(c => `cand_${c.id}`).concat(['outros']);
  const allKeys = overridesKeys.concat(['nuloBranco', 'abstencao']);
  const override = {};
  
  let validTotalPct = 0;
  overridesKeys.forEach(k => {
    const inp = document.querySelector(`.sim-ajuste-val[data-uf="${sigla}"][data-entry="${k}"]`);
    override[k] = inp ? parseFloat(inp.value) || 0 : 0;
    validTotalPct += override[k];
  });
  
  // Retain the old invalid vote percentages
  const oldRes = SIM.resultadosPorUF[sigla] || {};
  const nb = oldRes.nuloBranco?.pct || 0;
  const ab = oldRes.abstencao?.pct || 0;
  
  // Make sure they fit along with nulo/branco by possibly redistributing them, or keep total scale matching.
  // Actually, since the slider is 0-100 of valid votes? Wait!
  // If the slider totals 100% of ALL people, but nulos/brancos are removed, then adjusting to 100% means we're ignoring abstenção!
  // Wait, if we enforce 100% among the valid keys, we should scale them to (100 - nb - ab)!
  // So the override dict saves the PCT over TOTAL.
  
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
  if (SIM.modo === 'governador' && SIM.estadoAlvo) {
     simOnClickEstado(SIM.estadoAlvo);
  } else {
     simRenderMapaEstados();
     simShowBrasilResults();
  }
}


// ====== LOCAIS DE VOTACAO ====== 
function simRenderMapaLocais(uf, codM = null) {
  // Remove existing layers
  if (SIM.estadosLayer) { simMap.removeLayer(SIM.estadosLayer); SIM.estadosLayer = null; }
  if (SIM.locaisLayer) { simMap.removeLayer(SIM.locaisLayer); SIM.locaisLayer = null; }
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
}

