function debounce(func, timeout = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { func.apply(this, args); }, timeout);
  };
}

function getAutoLoadSignature() {
  if (STATE.currentElectionType === 'geral') {
    const uf = dom.selectUFGeneral?.value || '';
    const canLoad = (currentOffice === 'presidente')
      || (currentOffice === 'deputado' && uf && uf !== 'BR')
      || (uf && uf !== 'BR');
    if (!canLoad) return '';
    const year = document.getElementById('selectYearGeneral')?.value || STATE.currentElectionYear;
    return ['geral', year, currentOffice, currentSubType, uf].join('|');
  }

  const uf = dom.selectUFMunicipal?.value || '';
  const municipio = dom.selectMunicipio?.value || '';
  if (!uf || !municipio) return '';
  const year = document.getElementById('selectYearMunicipal')?.value || STATE.currentElectionYear;
  return ['municipal', year, currentOffice, currentSubType, uf, municipio].join('|');
}

function scheduleAutoLoadCurrentSelection(delay = 80) {
  if (!STATE.autoLoadEnabled) return;
  clearTimeout(autoLoadTimer);
  const sequence = ++autoLoadSequence;

  autoLoadTimer = setTimeout(async () => {
    if (sequence !== autoLoadSequence) return;
    const signature = getAutoLoadSignature();
    if (!signature) return;

    autoLoadRunningSequence = sequence;

    try {
      if (STATE.currentElectionType === 'geral') {
        if (typeof window.onClickLoadData_General !== 'function') return;
        await window.onClickLoadData_General();
      } else {
        if (typeof window.onClickLoadData_Municipal !== 'function') return;
        await window.onClickLoadData_Municipal();
      }
    } finally {
      if (autoLoadRunningSequence !== autoLoadSequence) {
        scheduleAutoLoadCurrentSelection(60);
      }
    }
  }, delay);
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
  let party = partidoMatch[1];
  const name = coreKey.substring(0, partidoMatch.index).trim();

  // Correct party name confusion
  const isNameConfusion = !party || 
    party.length > 8 || 
    party.toLowerCase() === name.toLowerCase() || 
    (party.includes(' ') && !['PC DO B', 'PT DO B', 'PC DOB', 'P DO B'].includes(party.toUpperCase()));
    
  if (isNameConfusion && typeof window !== 'undefined' && window.CANDIDATE_NAME_TO_PARTY) {
    const cleanNameKey = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const correctParty = window.CANDIDATE_NAME_TO_PARTY.get(cleanNameKey);
    if (correctParty) {
      party = correctParty;
    }
  }

  result.partido = party;
  result.nome = name;

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

// ====== DETALHES DO CANDIDATO (VICE/SUPLENTE) ======
async function ensureCandidateDetails() {
  const year = STATE.currentElectionYear || '2022';

  // Se já temos cache para este ano, retorna cache
  if (CANDIDATE_DETAILS && CANDIDATE_DETAILS.year === year) return CANDIDATE_DETAILS.data;
  // Se já estamos carregando este ano, retorna promise
  if (CANDIDATE_DETAILS_PROMISE && CANDIDATE_DETAILS_PROMISE.year === year) return CANDIDATE_DETAILS_PROMISE.promise;

  const loadPromise = (async () => {
    try {
      const filename = `detalhes_candidatos_${year}`;
      const zipUrl = `resultados_geo/${filename}.zip`;

      const { entries } = await unzipit.unzip(zipUrl);
      const jsonEntry = entries[`${filename}.json`];

      if (jsonEntry) {
        const json = await jsonEntry.json();
        CANDIDATE_DETAILS = { year: year, data: json };
        return json;
      }
    } catch (e) {
      console.warn(`Detalhes não encontrados para ${year}:`, e);
    }
    return null;
  })();

  CANDIDATE_DETAILS_PROMISE = { year: year, promise: loadPromise };
  return loadPromise;
}

function toTitleCase(str) {
  if (!str) return '';
  const exceptions = ['de', 'da', 'do', 'dos', 'das', 'e', 'em', 'com', 'na', 'no', 'nas', 'nos', 'por', 'pra', 'pro', 'para', 'a', 'o', 'as', 'os', 'y'];

  // Helper to check if word is a known party (acronym)
  const isPartyAcronym = (w) => {
    const clean = w.replace(/[^a-zA-Z0-9]/g, ''); // Remove ( ) / etc
    const upperClean = clean.toUpperCase();
    if (['NOVO', 'REDE', 'PATRIOTA', 'CIDADANIA', 'AVANTE', 'SOLIDARIEDADE', 'REPUBLICANOS', 'AGIR', 'PODEMOS', 'MOBILIZA'].includes(upperClean)) {
      return false;
    }
    const normalized = typeof getNormalizedPartyColorKey === 'function'
      ? getNormalizedPartyColorKey(clean)
      : clean.toUpperCase();
    return PARTY_COLOR_OVERRIDES.has(normalized) || PARTY_COLORS.has(normalized);
  };

  return str.split(' ').map((word) => {
    // If the word is a known party acronym
    // or contains slashes (e.g., "PT/PSDB")
    // or is enclosed in parentheses (e.g., "(PT)")
    if (isPartyAcronym(word) || word.includes('/') || (word.startsWith('(') && word.endsWith(')'))) {
      return word; // Keep original casing (usually uppercase for these)
    }

    const lower = word.toLowerCase();
    if (exceptions.includes(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(' ');
}


function toggleCandidateDetails(element, nome, partido, status) {
  // Se já estiver aberto, fecha
  const existingDetails = element.querySelector('.cand-details-panel');
  if (existingDetails) {
    existingDetails.remove();
    element.classList.remove('details-open');
    return;
  }

  // Se não, abre
  element.classList.add('details-open');

  // Loader provisório
  const detailsPanel = document.createElement('div');
  detailsPanel.className = 'cand-details-panel';
  detailsPanel.innerHTML = '<small style="color:var(--muted)">Carregando detalhes...</small>';
  element.appendChild(detailsPanel);

  ensureCandidateDetails().then(data => {
    if (!data) {
      detailsPanel.innerHTML = '<small style="color:var(--err)">Erro ao carregar detalhes.</small>';
      return;
    }

    // Identificar UE (BR para Pres, UF para outros, Code para Municipal)
    let ue = dom.selectUFGeneral.value;
    if (currentOffice === 'presidente') ue = 'BR';
    if (STATE.currentElectionType === 'municipal' && STATE.currentMuniCode) {
      ue = STATE.currentMuniCode;
    }

    // Buscar candidato pelo Nome (Upper)
    const nomeKey = nome.toUpperCase().trim();
    const candData = data[ue] ? data[ue][nomeKey] : null;

    if (!candData) {
      detailsPanel.innerHTML = '<small style="color:var(--muted)">Detalhes não disponíveis.</small>';
      return;
    }

    // Montar HTML
    let html = '<div class="details-content" style="margin-top:8px; font-size:0.85rem; color:var(--text-color); border-top:1px solid var(--border-color); padding-top:6px;">';

    // Vice / Suplentes
    if (candData.vice) {
      html += `<div><strong>Vice:</strong> ${toTitleCase(candData.vice)} <span style="color:var(--muted)">(${candData.vice_partido})</span></div>`;
    }
    if (candData.suplentes) {
      candData.suplentes.forEach((sup, i) => {
        html += `<div><strong>${i + 1}º Suplente:</strong> ${toTitleCase(sup.nome)} <span style="color:var(--muted)">(${sup.partido})</span></div>`;
      });
    }

    // Coligação
    if (candData.coligacao && candData.coligacao !== '#NULO#') {
      html += `<div style="margin-top:4px;"><strong>Coligação:</strong> ${toTitleCase(candData.coligacao)}</div>`;
      html += `<div style="color:var(--muted); font-size: 0.75rem; line-height:1.2;">${toTitleCase(candData.composicao)}</div>`;
    }

    html += '</div>';
    detailsPanel.innerHTML = html;
  });
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
    
    const sunSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="theme-icon"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path></svg>`;
    const moonSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="theme-icon"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></svg>`;
    
    dom.themeToggle.innerHTML = isDark ? sunSvg : moonSvg; // Swap icon SVG

    // Update Basemap tiles (mesmos tiles raster CARTO, dark/light)
    const newTheme = document.body.dataset.theme === 'light' ? 'light' : 'dark';
    MLCompat.setBasemapTheme(map, newTheme);
  });

  dom.selectElectionLevel = document.getElementById('selectElectionLevel');
  dom.selectYearGeneral = document.getElementById('selectYearGeneral');
  dom.selectYearMunicipal = document.getElementById('selectYearMunicipal');
  dom.loaderBoxGeneral = document.getElementById('loaderBoxGeneral');
  dom.loaderBoxMunicipal = document.getElementById('loaderBoxMunicipal');

  dom.electionContextBox = document.getElementById('electionContextBox');
  dom.officeBoxGeneral = document.getElementById('officeBoxGeneral');
  dom.cargoChipsGeneral = document.getElementById('cargoChipsGeneral');
  dom.selectUFGeneral = document.getElementById('selectUFGeneral');

  dom.selectUFMunicipal = document.getElementById('selectUFMunicipal');
  dom.selectMunicipio = document.getElementById('selectMunicipio');
  dom.searchMunicipio = document.getElementById('searchMunicipio');
  dom.cargoBoxMunicipal = document.getElementById('cargoBoxMunicipal'); // Ord/Sup
  dom.cargoChipsMunicipal = document.getElementById('cargoChipsMunicipal');
  dom.officeBoxMunicipal = document.getElementById('officeBoxMunicipal'); // Prefeito/Vereador
  dom.officeChipsMunicipal = document.getElementById('officeChipsMunicipal');

  dom.filterBox = document.getElementById('filterBox');

  // Filtros Regionais (Cargas)
  dom.selectRGINT = document.getElementById('filterRGINT');
  dom.selectRGI = document.getElementById('filterRGI');

  dom.ctrlCidadeFilter = document.getElementById('ctrlCidadeFilter');
  
  dom.inputCidade = document.getElementById('inputCidade');
  

  
  dom.inputBairro = document.getElementById('inputBairro');
  

  dom.searchLocal = document.getElementById('searchLocal');
  dom.btnApplyFilters = document.getElementById('btnApplyFilters') || document.createElement('button');
  dom.btnToggleInaptos = document.getElementById('btnToggleInaptos');
  dom.btnToggleRules = document.getElementById('btnToggleRules');
  dom.btnExplainRules = document.getElementById('btnExplainRules');
  dom.rulesExplainOverlay = document.getElementById('rulesExplainOverlay');
  dom.btnCloseRulesExplain = document.getElementById('btnCloseRulesExplain');

  dom.vizBox = document.getElementById('vizBox');
  dom.vizCandidatoBox = document.getElementById('vizCandidatoBox');
  dom.selectVizCandidato = document.getElementById('selectVizCandidato');
  dom.selectVizSize = document.getElementById('selectVizSize');
  dom.selectVizColorStyle = document.getElementById('selectVizColorStyle');
  dom.vizModeChips = document.getElementById('vizModeChips');
  dom.vizGradientModeChips = document.getElementById('vizGradientModeChips');

  dom.resultsBox = document.getElementById('resultsBox');
  dom.resultsTitle = document.getElementById('resultsTitle');
  dom.resultsSubtitle = document.getElementById('resultsSubtitle');
  dom.btnMapModeMunicipios = document.getElementById('btnMapModeMunicipios');
  dom.btnMapModeLocais = document.getElementById('btnMapModeLocais');
  dom.layerToggleGroup = document.querySelector('.layer-toggle-group');
  dom.btnLocateSelection = document.getElementById('btnLocateSelection');
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
  dom.profileEscolaridadeChart = document.getElementById('profileEscolaridadeChart');
  dom.profileGeneroChart = document.getElementById('profileGeneroChart');

  // Census Filters DOM

  // Census Filters DOM
  // Census Filters DOM - CLEANUP: Removing references to old ID elements that were replaced by Tabs/Sliders
  // dom.filterRendaMin, etc. are now handled dynamically or inside setupSliders

  map = new maplibregl.Map({
    container: 'map',
    style: MLCompat.buildBasemapStyle(document.body.dataset.theme === 'light' ? 'light' : 'dark'),
    center: [-55, -15],
    zoom: 4,
    minZoom: 4,
    dragRotate: false,
    pitchWithRotate: false
  });
  MLCompat.augmentMap(map);
  MLCompat.refreshThemeColors();
  if (map.touchZoomRotate) map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right');

  // Sincronizar o botão do Modo 3D e controles com as mudanças de pitch da câmera
  map.on('pitch', () => {
    const currentPitch = map.getPitch();
    const btn3D = document.getElementById('btnToggle3D');
    
    if (currentPitch > 10) {
      if (btn3D && !btn3D.classList.contains('active')) {
        btn3D.classList.add('active');
        document.body.classList.add('mode-3d');
        map.dragRotate.enable();
        if (map.touchZoomRotate) map.touchZoomRotate.enableRotation();
      }
    } else {
      if (btn3D && btn3D.classList.contains('active')) {
        btn3D.classList.remove('active');
        document.body.classList.remove('mode-3d');
        map.dragRotate.disable();
        if (map.touchZoomRotate) map.touchZoomRotate.disableRotation();
      }
    }
    syncExtrusionButtonVisibility();
  });

  function syncExtrusionButtonVisibility() {
    const btnExtrusion = document.getElementById('btnToggleExtrusion');
    if (!map) return;
    
    const isPitched = map.getPitch() > 10;
    const isMunicipios = STATE.currentMapMode === 'municipios';
    
    // Altura (Municípios)
    if (btnExtrusion) {
      if (isPitched && isMunicipios) {
        btnExtrusion.classList.add('visible-inline');
      } else {
        btnExtrusion.classList.remove('visible-inline');
      }
    }
  }
  window.syncExtrusionButtonVisibility = syncExtrusionButtonVisibility;

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

  // Init Shift+Drag Selector
  setupBoxSelection();

  // Initialize Custom Select Dropdowns
  initCustomDropdowns();

  // Initialize Mobile Tabbed Navigation & Routing
  setupMobileNavigation();

  console.log("App Initialized. Tabs and Sliders setup complete.");
}
function setupTabs() {
  const selectDemo = document.getElementById('selectDemoCategory');
  if (!selectDemo) return;

  const tabContents = document.querySelectorAll('.tab-content');

  selectDemo.addEventListener('change', () => {
    const targetId = selectDemo.value;
    tabContents.forEach(content => {
      content.classList.toggle('hidden', content.id !== targetId);
    });

    // Refresh availability bars for the new active tab if data is loaded
    const geojson = currentDataCollection[currentCargo];
    if (geojson && typeof updateAvailabilityBars === 'function') {
      updateAvailabilityBars(geojson);
    }
  });
}

function setupSliders() {
  const debouncedRedraw = debounce(() => {
    clearSelection(false);
    applyFiltersAndRedraw();
  }, 100);

  const container = document.getElementById('sliderRendaContainer');
  if (container) {
    const range = document.getElementById('rendaRange');
    const thumbMin = document.getElementById('rendaThumbMin');
    const thumbMax = document.getElementById('rendaThumbMax');
    const dispMin = document.getElementById('dispRendaMin');
    const dispMax = document.getElementById('dispRendaMax');

    const MAX_VAL = 10000;
    const STEP = 50;
    let valMin = 0;
    let valMax = MAX_VAL;

    const updateDualVisuals = () => {
      const pctMin = (valMin / MAX_VAL) * 100;
      const pctMax = (valMax / MAX_VAL) * 100;
      if (thumbMin) thumbMin.style.left = `${pctMin}%`;
      if (thumbMax) thumbMax.style.left = `${pctMax}%`;
      if (range) {
        range.style.left = `${pctMin}%`;
        range.style.width = `${Math.max(0, pctMax - pctMin)}%`;
      }
      if (dispMin) dispMin.textContent = valMin.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
      if (dispMax) dispMax.textContent = valMax >= MAX_VAL ? MAX_VAL.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) + "+" : valMax.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
    };

    const updateRendaState = () => {
      STATE.censusFilters.rendaMin = valMin > 0 ? valMin : null;
      STATE.censusFilters.rendaMax = valMax < MAX_VAL ? valMax : null;
      debouncedRedraw();
    };

    const debouncedRenda = debounce(updateRendaState, 150);

    const setRendaValues = (nextMin, nextMax, redraw = true) => {
      valMin = Math.round(Math.max(0, Math.min(MAX_VAL, parseInt(nextMin) || 0)) / STEP) * STEP;
      valMax = Math.round(Math.max(0, Math.min(MAX_VAL, parseInt(nextMax) || MAX_VAL)) / STEP) * STEP;
      if (valMax < valMin + STEP) valMax = Math.min(MAX_VAL, valMin + STEP);
      if (valMin > valMax - STEP) valMin = Math.max(0, valMax - STEP);
      updateDualVisuals();
      if (redraw) debouncedRenda();
    };

    const initDrag = (thumb, isMin) => {
      if (!thumb) return;
      thumb.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        const onMove = (moveE) => {
          let x = moveE.clientX - rect.left;
          let pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
          let val = Math.round((pct / 100) * MAX_VAL);
          if (isMin) setRendaValues(Math.min(val, valMax), valMax);
          else setRendaValues(valMin, Math.max(val, valMin));
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    };

    initDrag(thumbMin, true);
    initDrag(thumbMax, false);
    updateDualVisuals();
  }

  // Setup Dynamic Sliders for Race, Age, Sanitation
  const setupDynamicFilter = (idSlider, idInput, idSelect, idDisp, idValDisp, stateKeyVal, stateKeyMode) => {
    const slider = document.getElementById(idSlider);
    const input = document.getElementById(idInput);
    const select = document.getElementById(idSelect);
    const disp = document.getElementById(idDisp);
    const valDisp = document.getElementById(idValDisp);

    if (!slider) return;

    const update = () => {
      const val = parseInt(slider.value);
      STATE.censusFilters[stateKeyVal] = val;
      if (input) input.value = val;
      if (valDisp) valDisp.textContent = val + '%';
      if (disp) disp.textContent = val + '%';
      debouncedRedraw();
    };

    slider.addEventListener('input', update);
    if (input) input.addEventListener('change', () => {
      slider.value = input.value;
      update();
    });
    if (select) select.addEventListener('change', () => {
      STATE.censusFilters[stateKeyMode] = select.value;
      update();
    });
  };

  setupDynamicFilter('sliderRaca', 'inputRaca', 'selectRacaMode', 'dispRaca', 'valRaca', 'racaVal', 'racaMode');
  setupDynamicFilter('sliderIdade', 'inputIdade', 'selectIdadeMode', 'dispIdade', 'valIdade', 'idadeVal', 'idadeMode');
  setupDynamicFilter('sliderSaneamento', 'inputSaneamento', 'selectSaneamentoMode', 'dispSaneamento', 'valSaneamento', 'saneamentoVal', 'saneamentoMode');
}

function updateAvailabilityBars(geojson) {
  if (!geojson || !geojson.features) return;

  let minRenda = 999999, maxRenda = -1;
  let minRaca = 101, maxRaca = -1;
  let minIdade = 101, maxIdade = -1;
  let minSaneamento = 101, maxSaneamento = -1;

  geojson.features.forEach(f => {
    const p = f.properties;
    if (STATE.currentElectionType === 'geral' && !featureMatchesCurrentGeography(p)) return;

    const r = ensureNumber(getProp(p, 'Renda Media'));
    if (r > 0) {
      minRenda = Math.min(minRenda, r);
      maxRenda = Math.max(maxRenda, r);
    }
    const rac = ensureNumber(getProp(p, STATE.censusFilters.racaMode));
    minRaca = Math.min(minRaca, rac);
    maxRaca = Math.max(maxRaca, rac);

    const san = ensureNumber(getProp(p, STATE.censusFilters.saneamentoMode));
    minSaneamento = Math.min(minSaneamento, san);
    maxSaneamento = Math.max(maxSaneamento, san);

    const idadeSum = calculateAgeSumForProps(p, STATE.censusFilters.idadeMode);
    minIdade = Math.min(minIdade, idadeSum);
    maxIdade = Math.max(maxIdade, idadeSum);
  });

  const setBar = (id, min, max, scale) => {
    const el = document.getElementById(id);
    if (!el) return;
    const left = (Math.max(0, min) / scale) * 100;
    const width = ((Math.min(scale, max) - Math.max(0, min)) / scale) * 100;
    el.style.left = `${left.toFixed(2)}%`;
    el.style.width = `${Math.max(0, width).toFixed(2)}%`;
  };

  setBar('availRenda', minRenda > maxRenda ? 0 : minRenda, maxRenda, 10000);
  setBar('availRaca', minRaca > maxRaca ? 0 : minRaca, maxRaca, 100);
  setBar('availIdade', minIdade > maxIdade ? 0 : minIdade, maxIdade, 100);
  setBar('availSaneamento', minSaneamento > maxSaneamento ? 0 : minSaneamento, maxSaneamento, 100);
}

function calculateAgeSumForProps(props, mode) {
  const ageAggregate = aggregateAgeBucketsFromProps(props, window.AGE_BUCKETS_STANDARD);
  return ageAggregate.buckets[mode] || 0;
}

if (typeof window !== 'undefined') {
  window.toTitleCase = toTitleCase;
}

// ====== CUSTOM SELECT COMPONENT ======
function initCustomDropdowns() {
  const selects = document.querySelectorAll('select.select');
  selects.forEach(enhanceSelectElement);

  // Set up observer to automatically enhance any dynamically added selects
  const bodyObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.tagName === 'SELECT' && node.classList.contains('select')) {
            enhanceSelectElement(node);
          }
          node.querySelectorAll('select.select').forEach(enhanceSelectElement);
        }
      });
    });
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });
}

function enhanceSelectElement(select) {
  if (select.dataset.enhanced === 'true' || select.closest('.custom-select-wrapper')) return;
  select.dataset.enhanced = 'true';

  // 1. Create Wrapper
  const wrapper = document.createElement('div');
  wrapper.className = 'custom-select-wrapper';
  select.parentNode.insertBefore(wrapper, select);
  wrapper.appendChild(select);

  // Hide the native select visually but keep it in the DOM and focusable
  select.classList.add('hidden-select');
  select.tabIndex = -1; // Prevent double tabbing

  // 2. Create Custom Trigger
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'custom-select-trigger';
  if (select.disabled) trigger.classList.add('disabled');

  const triggerText = document.createElement('span');
  triggerText.className = 'custom-select-trigger-text';
  trigger.appendChild(triggerText);

  // Create Chevron Arrow
  const arrowSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  arrowSvg.setAttribute('class', 'custom-select-arrow');
  arrowSvg.setAttribute('viewBox', '0 0 24 24');
  arrowSvg.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';
  trigger.appendChild(arrowSvg);

  wrapper.appendChild(trigger);

  // 3. Create Custom Dropdown Box
  const dropdown = document.createElement('div');
  dropdown.className = 'custom-select-dropdown';
  wrapper.appendChild(dropdown);

  // Function to rebuild options list
  const rebuildOptions = () => {
    dropdown.innerHTML = '';
    const options = Array.from(select.options);
    
    // safeNorm helper for accent-insensitive matching
    const safeNorm = (typeof norm === 'function') ? norm : (s => (s || "").normalize('NFD').replace(/[\u0300-\u036f]/g, "").replace(/'/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase());

    // Create search input if there are more than 5 options
    let searchInput = null;
    if (options.length > 5) {
      const searchContainer = document.createElement('div');
      searchContainer.className = 'custom-select-search-container';
      
      searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.className = 'custom-select-search';
      searchInput.placeholder = 'Buscar...';
      searchInput.autocomplete = 'off';
      
      searchContainer.addEventListener('click', (e) => e.stopPropagation());
      
      searchInput.addEventListener('input', () => {
        const query = safeNorm(searchInput.value);
        const optionDivs = dropdown.querySelectorAll('.custom-select-option');
        
        let firstMatch = null;
        optionDivs.forEach(div => {
          const text = safeNorm(div.textContent);
          if (text.includes(query)) {
            div.style.display = '';
            if (!firstMatch && !div.classList.contains('disabled')) {
              firstMatch = div;
            }
          } else {
            div.style.display = 'none';
          }
        });
        
        // Highlight the first visible matching option (or remove highlights if query is empty)
        optionDivs.forEach(div => div.classList.remove('highlighted'));
        if (query && firstMatch) {
          firstMatch.classList.add('highlighted');
          firstMatch.scrollIntoView({ block: 'nearest' });
        }
      });

      searchInput.addEventListener('keydown', (e) => {
        const optionDivs = Array.from(dropdown.querySelectorAll('.custom-select-option')).filter(div => div.style.display !== 'none' && !div.classList.contains('disabled'));
        const currentHighlightIdx = optionDivs.findIndex(div => div.classList.contains('highlighted'));
        
        if (e.key === 'Enter') {
          e.preventDefault();
          const highlighted = dropdown.querySelector('.custom-select-option.highlighted');
          if (highlighted) {
            highlighted.click();
          } else if (optionDivs.length > 0) {
            optionDivs[0].click();
          }
        } else if (e.key === 'Escape') {
          closeAllDropdowns();
          trigger.focus();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (optionDivs.length > 0) {
            let nextIdx = currentHighlightIdx + 1;
            if (nextIdx >= optionDivs.length) nextIdx = 0;
            optionDivs.forEach(div => div.classList.remove('highlighted'));
            optionDivs[nextIdx].classList.add('highlighted');
            optionDivs[nextIdx].scrollIntoView({ block: 'nearest' });
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (optionDivs.length > 0) {
            let prevIdx = currentHighlightIdx - 1;
            if (prevIdx < 0) prevIdx = optionDivs.length - 1;
            optionDivs.forEach(div => div.classList.remove('highlighted'));
            optionDivs[prevIdx].classList.add('highlighted');
            optionDivs[prevIdx].scrollIntoView({ block: 'nearest' });
          }
        }
      });
      
      searchContainer.appendChild(searchInput);
      dropdown.appendChild(searchContainer);
    }

    options.forEach((opt, idx) => {
      const customOpt = document.createElement('div');
      customOpt.className = 'custom-select-option';
      customOpt.textContent = opt.textContent;
      customOpt.dataset.value = opt.value;
      customOpt.dataset.index = idx;

      if (opt.disabled) customOpt.classList.add('disabled');
      if (opt.selected) {
        customOpt.classList.add('selected');
        triggerText.textContent = opt.textContent;
      }

      customOpt.addEventListener('click', (e) => {
        e.stopPropagation();
        if (opt.disabled) return;

        // Set value on native select
        select.value = opt.value;
        // Dispatch native change event
        select.dispatchEvent(new Event('change', { bubbles: true }));

        // Close dropdown
        closeAllDropdowns();
      });

      dropdown.appendChild(customOpt);
    });

    if (options.length === 0 || (options.length === 1 && options[0].disabled && options[0].value === '')) {
      triggerText.textContent = select.placeholder || 'Selecione...';
    }
  };

  // Function to sync custom trigger text with native select active option
  const syncActiveText = () => {
    const selectedOpt = select.options[select.selectedIndex];
    if (selectedOpt) {
      triggerText.textContent = selectedOpt.textContent;
      // Update selected class in option list
      dropdown.querySelectorAll('.custom-select-option').forEach(opt => {
        const isSelected = parseInt(opt.dataset.index) === select.selectedIndex;
        opt.classList.toggle('selected', isSelected);
        if (isSelected) opt.classList.remove('highlighted');
      });
    } else {
      triggerText.textContent = select.placeholder || 'Selecione...';
    }
    trigger.classList.toggle('disabled', select.disabled);
  };

  // Initial build
  rebuildOptions();

  // 4. Overwrite native prototype value & selectedIndex properties on the select instance!
  // This captures any programmatic writes (e.g. select.value = 'x')
  const originalValueProp = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(select, 'value', {
    configurable: true,
    get: function() {
      return originalValueProp.get.call(this);
    },
    set: function(val) {
      originalValueProp.set.call(this, val);
      syncActiveText();
    }
  });

  const originalIndexProp = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
  Object.defineProperty(select, 'selectedIndex', {
    configurable: true,
    get: function() {
      return originalIndexProp.get.call(this);
    },
    set: function(idx) {
      originalIndexProp.set.call(this, idx);
      syncActiveText();
    }
  });

  // 5. Watch for dynamic DOM changes on options or disabled attribute
  const observer = new MutationObserver((mutations) => {
    let shouldRebuild = false;
    mutations.forEach(m => {
      if (m.type === 'childList') {
        shouldRebuild = true;
      } else if (m.type === 'attributes') {
        if (m.attributeName === 'disabled') {
          trigger.classList.toggle('disabled', select.disabled);
        } else if (m.attributeName === 'value' || m.attributeName === 'selected') {
          syncActiveText();
        }
      }
    });

    if (shouldRebuild) {
      rebuildOptions();
    }
  });
  observer.observe(select, { childList: true, attributes: true, subtree: true, attributeFilter: ['disabled', 'value', 'selected'] });

  // 6. Trigger Click Event
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (select.disabled) return;

    const isOpen = dropdown.classList.contains('open');
    closeAllDropdowns();

    if (!isOpen) {
      trigger.classList.add('active');
      dropdown.classList.add('open');

      // Auto-focus and reset search input if it exists
      const searchInput = dropdown.querySelector('.custom-select-search');
      if (searchInput) {
        searchInput.value = '';
        const optionDivs = dropdown.querySelectorAll('.custom-select-option');
        optionDivs.forEach(div => {
          div.style.display = '';
          div.classList.remove('highlighted');
        });
        setTimeout(() => {
          searchInput.focus();
        }, 50);
      }
    }
  });

  // Handle keydown on the trigger button
  trigger.addEventListener('keydown', (e) => {
    if (select.disabled) return;

    const safeNorm = (typeof norm === 'function') ? norm : (s => (s || "").normalize('NFD').replace(/[\u0300-\u036f]/g, "").replace(/'/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase());
    const isOpen = dropdown.classList.contains('open');

    // Navigation keys
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!isOpen) {
        // Open the dropdown
        trigger.click();
      } else {
        const sInput = dropdown.querySelector('.custom-select-search');
        if (sInput) {
          sInput.focus();
        } else {
          // If no search input, navigate options directly
          const optionDivs = Array.from(dropdown.querySelectorAll('.custom-select-option')).filter(div => !div.classList.contains('disabled'));
          const currentHighlightIdx = optionDivs.findIndex(div => div.classList.contains('highlighted') || div.classList.contains('selected'));
          
          if (e.key === 'ArrowDown') {
            let nextIdx = currentHighlightIdx + 1;
            if (nextIdx >= optionDivs.length) nextIdx = 0;
            optionDivs.forEach(div => div.classList.remove('highlighted'));
            optionDivs[nextIdx].classList.add('highlighted');
            optionDivs[nextIdx].scrollIntoView({ block: 'nearest' });
          } else if (e.key === 'ArrowUp') {
            let prevIdx = currentHighlightIdx - 1;
            if (prevIdx < 0) prevIdx = optionDivs.length - 1;
            optionDivs.forEach(div => div.classList.remove('highlighted'));
            optionDivs[prevIdx].classList.add('highlighted');
            optionDivs[prevIdx].scrollIntoView({ block: 'nearest' });
          } else if (e.key === 'Enter' || e.key === ' ') {
            const highlighted = dropdown.querySelector('.custom-select-option.highlighted');
            if (highlighted) {
              highlighted.click();
            }
          }
        }
      }
    } else if (e.key === 'Escape') {
      if (isOpen) {
        closeAllDropdowns();
        trigger.focus();
      }
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Typing standard characters opens dropdown and focuses search input, passing the character
      const sInput = dropdown.querySelector('.custom-select-search');
      if (sInput) {
        e.preventDefault();
        if (!isOpen) {
          trigger.classList.add('active');
          dropdown.classList.add('open');
        }
        sInput.value = e.key;
        sInput.dispatchEvent(new Event('input'));
        setTimeout(() => {
          sInput.focus();
        }, 50);
      } else {
        // Simple typeahead for small lists
        const char = safeNorm(e.key);
        const optionDivs = Array.from(dropdown.querySelectorAll('.custom-select-option')).filter(div => !div.classList.contains('disabled'));
        const match = optionDivs.find(div => safeNorm(div.textContent).startsWith(char));
        if (match) {
          e.preventDefault();
          if (!isOpen) {
            match.click();
          } else {
            optionDivs.forEach(div => div.classList.remove('highlighted'));
            match.classList.add('highlighted');
            match.scrollIntoView({ block: 'nearest' });
          }
        }
      }
    }
  });

  // Auto-close on Focusout
  wrapper.addEventListener('focusout', (e) => {
    if (e.relatedTarget && !wrapper.contains(e.relatedTarget)) {
      closeAllDropdowns();
    }
  });
}

function closeAllDropdowns() {
  document.querySelectorAll('.custom-select-trigger').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.custom-select-dropdown').forEach(el => el.classList.remove('open'));
}

// Close when clicking outside
document.addEventListener('click', () => {
  closeAllDropdowns();
});

// ====== MOBILE NAVIGATION & ROUTING ======
function setupMobileNavigation() {
  const mobileButtons = document.querySelectorAll('.mobile-nav-btn');
  const panelLeft = document.querySelector('.panel.side-left');
  const panelRes = document.querySelector('.panel.side-res');
  const panelRight = document.querySelector('.panel.side-right');

  if (!panelLeft || !panelRes || !panelRight) return;

  const panels = {
    mapa: panelRes,
    filtros: panelLeft,
    resultados: panelRight
  };

  mobileButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;
      if (!panels[targetTab]) return;

      // 1. Update Active Nav Button
      mobileButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // If opening results, clear notification badge
      if (targetTab === 'resultados') {
        btn.classList.remove('has-update');
      }

      // 2. Toggle Panel Display Classes
      Object.entries(panels).forEach(([tabKey, panelEl]) => {
        if (tabKey === targetTab) {
          panelEl.classList.add('mobile-active');
        } else {
          panelEl.classList.remove('mobile-active');
        }
      });

      // Toggle split layout class on app container for results
      const appContainer = document.querySelector('.app');
      if (appContainer) {
        if (targetTab === 'resultados') {
          appContainer.classList.add('split-active');
        } else {
          appContainer.classList.remove('split-active');
        }
      }

      // 3. GIS Engineering: Resize MapLibre Map
      if ((targetTab === 'mapa' || targetTab === 'resultados') && window.map) {
        // Run on next animation frame so CSS layout settles first
        requestAnimationFrame(() => {
          window.map.resize();
        });
      }
    });
  });

  // Watch for the "Carregar Dados" button trigger or filter changes
  // If user clicks apply/load, automatically route them to the Map tab so they see results load
  const loadBtn = document.getElementById('btnLoadData');
  if (loadBtn) {
    loadBtn.addEventListener('click', () => {
      const isMobile = window.innerWidth <= 768;
      if (isMobile) {
        const mapBtn = document.querySelector('.mobile-nav-btn[data-tab="mapa"]');
        if (mapBtn) mapBtn.click(); // programmatically switch to map tab
      }
    });
  }
}

// Function to trigger reactive update badge on mobile Resultados tab
function triggerMobileResultsNotification() {
  const isMobile = window.innerWidth <= 768;
  if (!isMobile) return;

  const btnResultados = document.getElementById('btnMobileNavResultados');
  const rightPanel = document.querySelector('.panel.side-right');
  const resultsPanelActive = rightPanel ? rightPanel.classList.contains('mobile-active') : false;
  
  if (btnResultados && !resultsPanelActive) {
    btnResultados.classList.add('has-update');
  }
}
