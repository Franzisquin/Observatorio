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
  demografiaUF: null,
  estadosGeoJSON: null,
  estadosLayer: null,
  selectedUF: null,
  currentDemoGroup: 'genero'
};

let simMap, simTileLayer;

// ====== UTILS ======
function fmtInt(n) { return (n || 0).toLocaleString('pt-BR'); }
function fmtPct(p) { return isFinite(p) ? p.toFixed(2).replace('.', ',') + '%' : '-'; }

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
    if (SIM.selectedUF) window.open(`eleicoes.html`, '_blank');
  });
}

// ====== DATA ======
async function loadSimuladorData() {
  try {
    const [demoRes, geoRes] = await Promise.all([
      fetch(DATA_BASE_URL + 'distribuicao_demografica_estados.json'),
      fetch(DATA_BASE_URL + 'estados_brasil.geojson')
    ]);
    if (!demoRes.ok || !geoRes.ok) throw new Error('Dados não encontrados');
    SIM.demografiaUF = await demoRes.json();
    SIM.estadosGeoJSON = await geoRes.json();
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
      SIM.sliders[cat][sub].outros = 0.88;
      if (cat === 'voto2022') {
        SIM.sliders[cat][sub].nuloBranco = 3.85;
        SIM.sliders[cat][sub].abstencao = 20.58;
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
  if (!SIM.demografiaUF) return;
  SIM.resultadosPorUF = {};
  SIM.totalBrasil = {};

  const allKeys = SIM.candidatos.map(c => `cand_${c.id}`).concat(['outros', 'nuloBranco', 'abstencao']);
  let totalEleitoresBR = 0;
  const totalVotosBR = {};
  allKeys.forEach(k => totalVotosBR[k] = 0);

  for (const uf of Object.keys(SIM.demografiaUF)) {
    const demo = SIM.demografiaUF[uf];

    if (SIM.overridesPorUF[uf]) {
      const ov = SIM.overridesPorUF[uf];
      const ufRes = {};
      allKeys.forEach(k => {
        const pct = ov[k] || 0;
        const votos = Math.round(demo.eleitores * pct / 100);
        ufRes[k] = { pct, votos };
        totalVotosBR[k] += votos;
      });
      SIM.resultadosPorUF[uf] = ufRes;
      totalEleitoresBR += demo.eleitores;
      continue;
    }

    // Média ponderada
    // For non-voto2022 categories, sliders represent % of valid votes.
    // For voto2022, sliders represent % of total electorate (including nulo/branco/abstencao).
    const scores = {};
    allKeys.forEach(k => scores[k] = 0);
    let totalWeight = 0;

    // Separate weights for voto2022 and non-voto2022
    const validScores = {}; // scores from non-voto2022 categories (valid votes only)
    const voto2022Scores = {}; // scores from voto2022 category (includes nulo/branco/abstencao)
    allKeys.forEach(k => { validScores[k] = 0; voto2022Scores[k] = 0; });
    let validWeight = 0;
    let voto2022Weight = 0;

    for (const cat in DEMO_GROUPS) {
      const catKey = cat === 'voto2022' ? 'voto2022_2t' : cat;
      const catData = demo[catKey];
      if (!catData) continue;
      const isVoto2022 = (cat === 'voto2022');

      for (const sub in DEMO_GROUPS[cat].subgrupos) {
        const peso = catData[sub] || 0;
        if (peso <= 0) continue;
        const sliderSub = SIM.sliders[cat]?.[sub];
        if (!sliderSub) continue;

        if (isVoto2022) {
          allKeys.forEach(k => { voto2022Scores[k] += peso * (sliderSub[k] || 0); });
          voto2022Weight += peso;
        } else {
          // Non-voto2022: sliders only have candidates + outros (valid votes)
          const validKeys = SIM.candidatos.map(c => `cand_${c.id}`).concat(['outros']);
          validKeys.forEach(k => { validScores[k] += peso * (sliderSub[k] || 0); });
          validWeight += peso;
        }
      }
    }

    // Normalize voto2022 scores
    if (voto2022Weight > 0) {
      allKeys.forEach(k => voto2022Scores[k] /= voto2022Weight);
    }

    // Normalize valid scores (non-voto2022)
    const validKeys = SIM.candidatos.map(c => `cand_${c.id}`).concat(['outros']);
    if (validWeight > 0) {
      validKeys.forEach(k => validScores[k] /= validWeight);
    }

    // Get nuloBranco and abstencao from voto2022 category only
    const nuloBrancoPct = voto2022Scores.nuloBranco || 0;
    const abstencaoPct = voto2022Scores.abstencao || 0;
    const validFraction = Math.max(0, 100 - nuloBrancoPct - abstencaoPct);

    // Combine: valid vote percentages are scaled to the valid fraction of the electorate
    // The valid scores from non-voto2022 categories represent distribution among valid votes
    // The voto2022 valid scores also contribute
    const combinedValid = {};
    validKeys.forEach(k => combinedValid[k] = 0);

    if (validWeight > 0 && voto2022Weight > 0) {
      // Both contribute - average them together
      const totalCombinedWeight = validWeight + voto2022Weight;
      validKeys.forEach(k => {
        combinedValid[k] = (validScores[k] * validWeight + voto2022Scores[k] * voto2022Weight) / totalCombinedWeight;
      });
    } else if (validWeight > 0) {
      validKeys.forEach(k => combinedValid[k] = validScores[k]);
    } else if (voto2022Weight > 0) {
      validKeys.forEach(k => combinedValid[k] = voto2022Scores[k]);
    }

    // Normalize combinedValid to sum to validFraction
    const sumValid = validKeys.reduce((s, k) => s + combinedValid[k], 0);
    if (sumValid > 0) {
      validKeys.forEach(k => combinedValid[k] = (combinedValid[k] / sumValid) * validFraction);
    }

    // Final percentages (of total electorate)
    const finalPcts = {};
    validKeys.forEach(k => finalPcts[k] = combinedValid[k]);
    finalPcts.nuloBranco = nuloBrancoPct;
    finalPcts.abstencao = abstencaoPct;

    // Normalize to exactly 100%
    const totalPct = allKeys.reduce((s, k) => s + (finalPcts[k] || 0), 0);
    if (totalPct > 0 && Math.abs(totalPct - 100) > 0.01) {
      allKeys.forEach(k => finalPcts[k] = ((finalPcts[k] || 0) / totalPct) * 100);
    }

    const ufRes = {};
    allKeys.forEach(k => {
      const pct = finalPcts[k] || 0;
      const votos = Math.round(demo.eleitores * pct / 100);
      ufRes[k] = { pct, votos };
      totalVotosBR[k] += votos;
    });

    SIM.resultadosPorUF[uf] = ufRes;
    totalEleitoresBR += demo.eleitores;
  }

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

      let op = 0.55;
      if (res && venc?.key) {
        const ks = SIM.candidatos.map(c => `cand_${c.id}`).concat(['outros']);
        const sorted = ks.map(k => res[k]?.votos || 0).sort((a, b) => b - a);
        const validVotos = sorted.reduce((s, v) => s + v, 0);
        const margin = validVotos > 0 ? (sorted[0] - (sorted[1] || 0)) / validVotos : 0;
        op = 0.35 + Math.min(margin * 3.5, 0.6);
      }

      const isSelected = SIM.selectedUF === sigla;

      return {
        fillColor: cor,
        fillOpacity: op,
        color: isSelected ? '#fff' : '#444',
        weight: isSelected ? 2.5 : 1,
        opacity: isSelected ? 1 : 0.6
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

  if (SIM.estadosLayer) simRenderMapaEstados(); // refresh selection highlight

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
