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
    return PARTY_COLORS.has(clean.toUpperCase());
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
  document.body.dataset.theme = 'light';
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

  dom.selectElectionLevel = document.getElementById('selectElectionLevel');
  dom.selectYearGeneral = document.getElementById('selectYearGeneral');
  dom.selectYearMunicipal = document.getElementById('selectYearMunicipal');
  dom.loaderBoxGeneral = document.getElementById('loaderBoxGeneral');
  dom.loaderBoxMunicipal = document.getElementById('loaderBoxMunicipal');

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
  dom.selectVizColorStyle = document.getElementById('selectVizColorStyle');
  dom.vizModeChips = document.getElementById('vizModeChips');

  dom.resultsBox = document.getElementById('resultsBox');
  dom.resultsTitle = document.getElementById('resultsTitle');
  dom.resultsSubtitle = document.getElementById('resultsSubtitle');
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
  dom.profileAlfabetizacaoBar = document.getElementById('profileAlfabetizacaoBar');
  dom.profileAlfabetizacaoVal = document.getElementById('profileAlfabetizacaoVal');
  dom.profileGeneroChart = document.getElementById('profileGeneroChart');

  // Census Filters DOM

  // Census Filters DOM
  // Census Filters DOM - CLEANUP: Removing references to old ID elements that were replaced by Tabs/Sliders
  // dom.filterRendaMin, etc. are now handled dynamically or inside setupSliders

  map = L.map('map', { zoomControl: false, minZoom: 4 }).setView([-15, -55], 4);

  STATE.mapTileLayer = L.tileLayer(MAP_TILES.light, {
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

  // Init Shift+Drag Selector
  setupBoxSelection();

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
    const inputRendaMin = document.getElementById('inputRendaMin');
    const inputRendaMax = document.getElementById('inputRendaMax');

    const MAX_VAL = 10000;
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
      if (inputRendaMin) inputRendaMin.value = String(valMin);
      if (inputRendaMax) inputRendaMax.value = valMax >= MAX_VAL ? '' : String(valMax);
    };

    const updateRendaState = () => {
      STATE.censusFilters.rendaMin = valMin > 0 ? valMin : null;
      STATE.censusFilters.rendaMax = valMax < MAX_VAL ? valMax : null;
      debouncedRedraw();
    };

    const debouncedRenda = debounce(updateRendaState, 150);

    const setRendaValues = (nextMin, nextMax, redraw = true) => {
      valMin = Math.max(0, Math.min(MAX_VAL, parseInt(nextMin) || 0));
      valMax = Math.max(0, Math.min(MAX_VAL, parseInt(nextMax) || MAX_VAL));
      if (valMax < valMin) [valMin, valMax] = [valMax, valMin];
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
  let sumPct = 0;
  for (const k in props) {
    if (k.startsWith('Pct ') && k.includes('anos')) {
      const match = k.match(/Pct (\d+) a/);
      if (match) {
        const age = parseInt(match[1]);
        let bucket = '';
        if (age >= 16 && age <= 24) bucket = '16-24';
        else if (age >= 25 && age <= 34) bucket = '25-34';
        else if (age >= 35 && age <= 44) bucket = '35-44';
        else if (age >= 45 && age <= 59) bucket = '45-59';
        else if (age >= 60 && age <= 74) bucket = '60-74';
        else if (age >= 75) bucket = '75+';
        if (bucket === mode) sumPct += ensureNumber(props[k]);
      }
    }
  }
  return sumPct;
}
