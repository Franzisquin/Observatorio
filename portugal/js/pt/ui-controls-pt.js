// ============================================================================
// ui-controls-pt.js — controlos (ano, círculo, modo de visualização, 3D)
// ============================================================================

let firstLoadDone = false;

async function loadCurrentYear() {
  if (STATE.isLoadingDataset) return;
  STATE.isLoadingDataset = true;
  showMapLoading(`A carregar ${STATE.currentYear}...`);
  try {
    const bundle = await loadYearData(STATE.currentYear);
    STATE.data = bundle.data;
    STATE.geo = bundle.geo;
    STATE.originalData = null;
    if (typeof applyCustomBlocksToData === 'function') {
      applyCustomBlocksToData();
    }
    // simulador.html: reescreve os votos segundo o cenário definido pelo
    // utilizador. Inerte no index.html, onde a função não existe.
    if (typeof simOnDataLoaded === 'function') {
      simOnDataLoaded();
    }
    updateCirculoShortcutsForYear();

    // modo desempenho: revalidar o partido no novo ano
    if (currentVizMode === 'desempenho' && STATE.vizParty) {
      if (!STATE.data.METADATA?.parties?.[STATE.vizParty]) {
        STATE.vizParty = null;
        STATE.performanceStats = null;
        currentVizMode = 'vencedor';
        syncVizModeChips();
      } else {
        STATE.performanceStats = computePerformanceStats(STATE.vizParty);
      }
    }

    selectedLocationIDs.clear();
    if (STATE.selectedCountry) {
      const hasCountry = STATE.data.COUNTRIES?.[STATE.scope.key]?.[STATE.selectedCountry];
      if (!hasCountry) {
        STATE.selectedCountry = null;
      }
    }
    // Demote gracioso de scope na troca de ano se a chave não existir
    if (STATE.scope.level === 'freguesia' && (!STATE.data.RESULTS || !STATE.data.RESULTS[STATE.scope.key])) {
      const concKey = STATE.scope.key.slice(0, 4);
      if (STATE.data.AGG?.concelho?.[concKey]) {
        STATE.scope = {
          level: 'concelho',
          key: concKey,
          nome: (typeof getConcelhoNome === 'function') ? getConcelhoNome(concKey) : concKey,
          circulo: circuloFromDicofre(concKey + '00')
        };
      } else {
        const distKey = circuloFromDicofre(STATE.scope.key);
        if (STATE.data.AGG?.distrito?.[distKey]) {
          STATE.scope = { level: 'distrito', key: distKey };
        } else {
          STATE.scope = { level: 'national', key: null };
        }
      }
    }
    if (STATE.scope.level === 'concelho' && (!STATE.data.AGG?.concelho || !STATE.data.AGG.concelho[STATE.scope.key])) {
      const distKey = circuloFromDicofre(STATE.scope.key + '00');
      if (STATE.data.AGG?.distrito?.[distKey]) {
        STATE.scope = { level: 'distrito', key: distKey };
      } else {
        STATE.scope = { level: 'national', key: null };
      }
    }
    if (STATE.scope.level === 'distrito' && (!STATE.data.AGG?.distrito || !STATE.data.AGG.distrito[STATE.scope.key])) {
      STATE.scope = { level: 'national', key: null };
    }

    // Sincronizar o mapLevel (granularidade ativa no mapa) conforme o scope
    if (STATE.scope.level === 'national') {
      STATE.mapLevel = STATE.granularity;
    } else if (STATE.scope.level === 'distrito') {
      // Preserva o nível de detalhe (mapLevel) atual do distrito se for válido
      if (STATE.mapLevel !== 'distrito' && STATE.mapLevel !== 'concelho' && STATE.mapLevel !== 'freguesia') {
        STATE.mapLevel = STATE.granularity;
      }
    } else if (STATE.scope.level === 'concelho') {
      STATE.mapLevel = 'freguesia';
    } else {
      STATE.mapLevel = 'freguesia';
    }

    // Await para carregamento das freguesias se for o mapLevel ativo
    if (STATE.mapLevel === 'freguesia') {
      const bundle = PT_YEAR_CACHE.get(STATE.currentElectionType === 'au' ? `${STATE.currentElectionType}:${STATE.auSubtype}:${STATE.currentYear}` : `${STATE.currentElectionType}:${STATE.currentYear}`);
      if (bundle && !bundle.freguesiasLoaded) {
        showMapLoading("A carregar freguesias em fundo...", 50);
        await bundle.freguesiasReady;
        hideMapLoading();
      }
    }

    buildMapLayers();
    populateCirculoSelect();
    populateVizPartySelect();
    applyFiltersAndRedraw();

    if (!firstLoadDone) {
      firstLoadDone = true;
      focusCountryOnMap(false);
    }
  } catch (e) {
    console.error(e);
    showToast(`Falha ao carregar ${STATE.currentYear}: ${e.message}`, 'error', 4000);
  } finally {
    STATE.isLoadingDataset = false;
    hideMapLoading();
  }
}

// ---------- SELECTS ----------

function populateYearSelect(availableYears) {
  const sel = dom.selectYear;
  if (!sel) return;
  const list = STATE.currentElectionType === 'pr' ? PR_YEARS
    : STATE.currentElectionType === 'ee' ? EE_YEARS
    : STATE.currentElectionType === 'au' ? AU_YEARS
    : AR_YEARS;
  sel.innerHTML = '';
  list.forEach(({ value, label }) => {
    // 2.ª volta (PR) não entra no seletor de Ano — tem chip próprio no painel de resultados
    if (STATE.currentElectionType === 'pr' && value.endsWith('_2')) return;
    if (availableYears && !availableYears.includes(value)) return;
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = STATE.currentElectionType === 'pr' ? label.replace(/ \(1\.ª volta\)$/, '') : label;
    sel.appendChild(opt);
  });
  sel.value = STATE.currentYear;
  if (sel.selectedIndex < 0 && sel.options.length) {
    sel.selectedIndex = 0;
    STATE.currentYear = sel.value;
  }
}

function populateCirculoSelect() {
  const sel = dom.selectCirculo;
  if (!sel) return;
  const oldVal = sel.value || STATE.currentCirculo;
  sel.innerHTML = '<option value="">Portugal (todos os círculos)</option>';
  const is1975AR = (STATE.currentElectionType === 'ar' && STATE.currentYear === '1975');
  CIRCULOS.forEach((nome, key) => {
    if (is1975AR && (key === 'E1' || key === 'E2')) return;
    if (!is1975AR && (key === 'XM' || key === 'XC' || key === 'XE')) return;
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = CIRCULOS_SEM_GEOMETRIA.has(key) ? `${nome} (emigração)` : nome;
    sel.appendChild(opt);
  });
  if (Array.from(sel.options).some(o => o.value === oldVal)) {
    sel.value = oldVal;
    STATE.currentCirculo = oldVal;
  } else {
    sel.value = "";
    STATE.currentCirculo = "";
  }
}

function populateVizPartySelect() {
  const sel = dom.selectVizCandidato;
  if (!sel) return;
  const parties = getYearParties();
  sel.innerHTML = '<option value="" disabled selected>Escolher partido...</option>';
  parties.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p;
    const fullName = PARTY_FULL_NAMES[getNormalizedPartyColorKey(p)];
    opt.textContent = fullName && fullName !== p ? `${p} — ${fullName}` : p;
    sel.appendChild(opt);
  });
  sel.disabled = false;
  if (STATE.vizParty && parties.includes(STATE.vizParty)) sel.value = STATE.vizParty;
}

// Mostra/esconde elementos específicos da AR/PR/EE/AU.
function updateElectionUiVisibility() {
  const elType = STATE.currentElectionType;
  const isPr = elType === 'pr';
  const isEe = elType === 'ee';
  const isAu = elType === 'au';
  
  document.body.classList.toggle('pr-mode', isPr);
  document.body.classList.toggle('ee-mode', isEe);
  document.body.classList.toggle('au-mode', isAu);
  
  const dhondt = document.getElementById('btnExplainRules');
  if (dhondt) dhondt.closest('.ctrl').style.display = (elType === 'ar' || isEe) ? '' : 'none';
  
  const seatDonuts = document.getElementById('seatDonutsToggleCtrl');
  if (seatDonuts) seatDonuts.style.display = (elType === 'ar') ? '' : 'none';
  
  const blocksDefiner = document.getElementById('blocksDefinerCtrl');
  if (blocksDefiner) blocksDefiner.style.display = (elType === 'ar' || elType === 'ee') ? '' : 'none';
  
  const auSubtypeCtrl = document.getElementById('auSubtypeCtrl');
  if (auSubtypeCtrl) auSubtypeCtrl.style.display = isAu ? '' : 'none';

  const isDiasporaHidden = isAu || isEe;
  DIASPORA_SHORTCUT_IDS.forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.style.display = isDiasporaHidden ? 'none' : '';
  });
  if (!isDiasporaHidden) updateCirculoShortcutsForYear();

  const nutsFilterCtrl = document.getElementById('nutsFilterCtrl');
  if (nutsFilterCtrl) nutsFilterCtrl.style.display = isAu ? 'none' : '';
}

// Mapa botão -> chave de círculo, para os círculos sem geometria (emigração).
const DIASPORA_SHORTCUT_IDS = ['btnShortcutEuropa', 'btnShortcutMundo',
  'btnShortcutMacau', 'btnShortcutMocambique', 'btnShortcutEmigracao'];
const DIASPORA_SHORTCUT_CIRCULO = {
  btnShortcutEuropa: 'E1', btnShortcutMundo: 'E2',
  btnShortcutMacau: 'XM', btnShortcutMocambique: 'XC', btnShortcutEmigracao: 'XE',
};

// Dentro dos círculos da emigração, só mostra os botões cujo círculo exista nos
// dados do ano carregado (ex.: 1975 só tem XM/XC/XE; 1976+ só tem E1/E2).
function updateCirculoShortcutsForYear() {
  const isDiasporaHidden = STATE.currentElectionType === 'au' || STATE.currentElectionType === 'ee';
  if (isDiasporaHidden) return;
  const distrito = STATE.data?.AGG?.distrito;
  DIASPORA_SHORTCUT_IDS.forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    const circ = DIASPORA_SHORTCUT_CIRCULO[id];
    btn.style.display = distrito?.[circ] ? '' : 'none';
  });
}

function syncVizModeChips() {
  dom.vizModeChips?.querySelectorAll('.chip-button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.value === currentVizMode);
  });
  dom.vizCandidatoBox?.classList.toggle('section-hidden', currentVizMode !== 'desempenho');
  dom.vizGradientModeCtrl?.classList.toggle('section-hidden', currentVizMode !== 'vencedor');
}

// ---------- SETUP ----------

function setupControls() {
  populateCirculoSelect();

  dom.selectYear?.addEventListener('change', () => {
    STATE.currentYear = dom.selectYear.value;
    loadCurrentYear();
  });

  dom.selectElectionType?.addEventListener('change', async () => {
    const val = dom.selectElectionType.value;
    const elType = (val === 'presidenciais') ? 'pr' : (val === 'europeias') ? 'ee' : (val === 'autarquicas') ? 'au' : 'ar';
    if (elType === STATE.currentElectionType) return;
    STATE.currentElectionType = elType;
    // repor âmbito/estado ao trocar de eleição
    STATE.currentCirculo = '';
    STATE.scope = { level: 'national', key: null };
    STATE.vizParty = null;
    STATE.performanceStats = null;
    currentVizMode = 'vencedor';
    
    if (elType === 'au') {
      STATE.auSubtype = 'cm';
      STATE.granularity = 'distrito';
      STATE.mapLevel = 'distrito';
    }
    
    syncVizModeChips();
    const years = elType === 'pr' ? await loadAvailablePrYears()
      : elType === 'ee' ? await loadAvailableEeYears()
      : elType === 'au' ? await loadAvailableAuYears()
      : await loadAvailableYears();
    const pick = (pref) => (years && years.includes(pref)) ? pref : (years && years[0]) || pref;
    STATE.currentYear = elType === 'pr' ? pick('2026')
      : elType === 'ee' ? pick('2024')
      : elType === 'au' ? pick('2025')
      : pick('2025');
    populateYearSelect(years);
    updateElectionUiVisibility();
    loadCurrentYear();
  });

  dom.auSubtypeChips = document.getElementById('auSubtypeChips');
  dom.auSubtypeChips?.querySelectorAll('.chip-button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.value;
      if (val === STATE.auSubtype) return;
      STATE.auSubtype = val;
      dom.auSubtypeChips.querySelectorAll('.chip-button').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      
      if (val === 'cm') {
        STATE.granularity = 'distrito';
        STATE.mapLevel = 'distrito';
        STATE.scope = { level: 'national', key: null };
      } else if (val === 'am') {
        STATE.granularity = 'concelho';
        STATE.mapLevel = 'concelho';
        STATE.scope = { level: 'national', key: null };
      } else if (val === 'af') {
        STATE.granularity = 'freguesia';
        STATE.mapLevel = 'freguesia';
        STATE.scope = { level: 'national', key: null };
      }
      
      if (typeof window.syncMapLevelChips === 'function') {
        window.syncMapLevelChips();
      }
      
      loadCurrentYear();
    });
  });

  document.getElementById('prRoundChips')?.querySelectorAll('.chip-button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const base = String(STATE.currentYear || '').replace(/_2$/, '');
      const target = btn.dataset.round === '2' ? `${base}_2` : base;
      if (target === STATE.currentYear) return;
      STATE.currentYear = target;
      loadCurrentYear();
    });
  });

  dom.selectCirculo?.addEventListener('change', () => {
    const circ = dom.selectCirculo.value;
    if (!circ) {
      window.navigateToNational({ focus: true });
    } else {
      window.navigateToDistrito(circ, { focus: true });
    }
  });

  dom.selectNuts?.addEventListener('change', () => {
    STATE.currentNuts = dom.selectNuts.value;
    window.syncMapLevel();
    if (STATE.currentNuts) {
      window.focusNutsOnMap && window.focusNutsOnMap(STATE.currentNuts, true);
    } else {
      if (STATE.currentCirculo) {
        window.focusCirculoOnMap && window.focusCirculoOnMap(STATE.currentCirculo, true);
      } else {
        window.focusCountryOnMap && window.focusCountryOnMap(true);
      }
    }
    window.applyFiltersAndRedraw();
    window.renderResultsPanel();
  });

  dom.mapLevelChips?.querySelectorAll('.chip-button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.value;
      STATE.granularity = val;
      
      if (STATE.currentCirculo) {
        if (STATE.scope.level === 'freguesia') {
          if (val === 'distrito') {
            window.navigateToDistrito(STATE.scope.circulo, { focus: false });
          } else if (val === 'concelho') {
            STATE.mapLevel = 'concelho';
            STATE.scope = { 
              level: 'concelho', 
              key: STATE.scope.concelho, 
              nome: (typeof getConcelhoNome === 'function') ? getConcelhoNome(STATE.scope.concelho) : STATE.scope.concelho,
              circulo: STATE.scope.circulo
            };
            window.syncMapLevel();
            window.applyFiltersAndRedraw();
          } else if (val === 'freguesia') {
            STATE.mapLevel = 'freguesia';
            window.syncMapLevel();
            window.applyFiltersAndRedraw();
          }
        } else if (STATE.scope.level === 'concelho') {
          if (val === 'distrito') {
            window.navigateToDistrito(STATE.scope.circulo, { focus: false });
          } else if (val === 'concelho') {
            STATE.mapLevel = 'concelho';
            STATE.scope = { level: 'distrito', key: STATE.currentCirculo };
            window.syncMapLevel();
            window.applyFiltersAndRedraw();
          } else if (val === 'freguesia') {
            STATE.mapLevel = 'freguesia';
            window.syncMapLevel();
            window.applyFiltersAndRedraw();
          }
        } else {
          if (val === 'distrito') {
            STATE.mapLevel = 'distrito';
            STATE.scope = { level: 'distrito', key: STATE.currentCirculo };
          } else if (val === 'concelho') {
            STATE.mapLevel = 'concelho';
            STATE.scope = { level: 'distrito', key: STATE.currentCirculo };
          } else if (val === 'freguesia') {
            STATE.mapLevel = 'freguesia';
            STATE.scope = { level: 'distrito', key: STATE.currentCirculo };
          }
          window.syncMapLevel();
          window.applyFiltersAndRedraw();
        }
      } else {
        window.navigateToNational({ focus: true });
      }
    });
  });

  dom.vizModeChips?.querySelectorAll('.chip-button').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentVizMode = btn.dataset.value;
      if (currentVizMode === 'desempenho' && !STATE.vizParty) {
        const parties = getYearParties();
        if (parties.length) {
          STATE.vizParty = parties[0];
          STATE.performanceStats = computePerformanceStats(STATE.vizParty);
          if (dom.selectVizCandidato) dom.selectVizCandidato.value = STATE.vizParty;
        }
      }
      syncVizModeChips();
      applyFiltersAndRedraw();
    });
  });

  dom.selectVizCandidato?.addEventListener('change', () => {
    STATE.vizParty = dom.selectVizCandidato.value || null;
    STATE.performanceStats = STATE.vizParty ? computePerformanceStats(STATE.vizParty) : null;
    if (currentVizMode === 'desempenho') applyFiltersAndRedraw();
  });

  dom.vizGradientModeChips?.querySelectorAll('.chip-button').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentGradientMode = btn.dataset.value;
      dom.vizGradientModeChips.querySelectorAll('.chip-button').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      applyFiltersAndRedraw();
    });
  });

  dom.btnClearSelection?.addEventListener('click', () => {
    clearSelection();
    if (!STATE.currentCirculo) focusCountryOnMap(true);
  });

  // Botão "Voltar" um nível de território (sobre o mapa)
  document.getElementById('btnBackLevel')?.addEventListener('click', () => {
    const btn = document.getElementById('btnBackLevel');
    const action = btn?.dataset.backAction;
    if (action === 'concelho' && btn.dataset.backKey) {
      navigateToConcelho(btn.dataset.backKey);
    } else if (action === 'distrito' && btn.dataset.backKey) {
      navigateToDistrito(btn.dataset.backKey, { focus: true });
    } else if (action === 'national') {
      navigateToNational({ focus: true });
    } else {
      clearSelection();
      if (!STATE.currentCirculo) focusCountryOnMap(true);
    }
  });

  // Modo 3D (perspetiva) + extrusão de altura
  document.getElementById('btnToggle3D')?.addEventListener('click', () => {
    const isPitched = map.getPitch() > 10;
    map.easeTo({ pitch: isPitched ? 0 : 50, duration: 500 });
    if (isPitched && STATE.extrusionEnabled) {
      STATE.extrusionEnabled = false;
      document.getElementById('btnToggleExtrusion')?.classList.remove('active');
      applyFiltersAndRedraw();
    }
  });

  document.getElementById('btnToggleExtrusion')?.addEventListener('click', () => {
    STATE.extrusionEnabled = !STATE.extrusionEnabled;
    document.getElementById('btnToggleExtrusion')?.classList.toggle('active', STATE.extrusionEnabled);
    applyFiltersAndRedraw();
  });

  document.getElementById('btnToggleSeatDonuts')?.addEventListener('click', () => {
    STATE.showSeatDonuts = !STATE.showSeatDonuts;
    document.getElementById('btnToggleSeatDonuts')?.classList.toggle('active', STATE.showSeatDonuts);
    applyFiltersAndRedraw();
  });

  document.querySelectorAll('.inset-shortcut-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.value;
      if (val === 'national') {
        window.navigateToNational({ focus: true });
      } else {
        window.navigateToDistrito(val, { focus: true });
      }
    });
  });

  syncVizModeChips();
  updateElectionUiVisibility();
  setupTerritorySearch();
}

// ====== PESQUISA DE CONCELHOS E FREGUESIAS ======
function setupTerritorySearch() {
  const input = document.getElementById('territorySearch');
  const resultsBox = document.getElementById('territorySearchResults');
  if (!input || !resultsBox) return;

  const normalize = (s) => String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

  function collectMatches(query) {
    const q = normalize(query);
    if (q.length < 2) return [];
    const starts = [];
    const contains = [];
    const push = (item, nome) => {
      const n = normalize(nome);
      if (n.startsWith(q)) starts.push(item);
      else if (n.includes(q)) contains.push(item);
    };

    for (const f of (STATE.geo?.concelhos?.features || [])) {
      const dico = f.properties?.dico;
      const nome = f.properties?.concelho;
      if (dico && nome) push({ type: 'concelho', key: dico, nome }, nome);
    }

    const names = STATE.data?.NAMES || {};
    for (const [dicofre, nome] of Object.entries(names)) {
      if (String(dicofre).length < 6) continue;
      push({ type: 'freguesia', key: dicofre, nome }, nome);
    }

    return [...starts, ...contains].slice(0, 10);
  }

  function hideResults() {
    resultsBox.classList.add('hidden');
    resultsBox.innerHTML = '';
  }

  async function goTo(item) {
    hideResults();
    input.value = '';
    input.blur();
    if (typeof openMobileFilters === 'function') openMobileFilters(false);
    if (item.type === 'concelho') {
      await window.navigateToConcelho(item.key);
    } else {
      await window.navigateToFreguesia(item.key);
    }
  }

  function renderResults(matches) {
    if (!matches.length) {
      hideResults();
      return;
    }
    resultsBox.innerHTML = matches.map((m, i) => {
      const meta = m.type === 'concelho'
        ? `Concelho · ${CIRCULOS.get(circuloFromDicofre(m.key + '00')) || ''}`
        : `Freguesia · ${getConcelhoNome(String(m.key).slice(0, 4))}`;
      return `<button type="button" class="search-result-item" data-idx="${i}" role="option">
          <strong>${escapeHtml(m.nome)}</strong>
          <small>${escapeHtml(meta)}</small>
        </button>`;
    }).join('');
    resultsBox.classList.remove('hidden');
    resultsBox.querySelectorAll('.search-result-item').forEach((btn) => {
      btn.addEventListener('click', () => goTo(matches[Number(btn.dataset.idx)]));
    });
  }

  let lastMatches = [];
  input.addEventListener('input', () => {
    lastMatches = collectMatches(input.value);
    renderResults(lastMatches);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && lastMatches.length) {
      e.preventDefault();
      goTo(lastMatches[0]);
    } else if (e.key === 'Escape') {
      hideResults();
      input.blur();
    }
  });

  input.addEventListener('focus', () => {
    if (input.value) renderResults(lastMatches = collectMatches(input.value));
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#territorySearchCtrl')) hideResults();
  });
}

// arranque: descobrir anos disponíveis e carregar o mais recente
async function bootstrapData() {
  const years = await loadAvailableYears();
  populateYearSelect(years);

  // Sincronizar o estado dos chips de granularidade no arranque
  if (typeof window.syncMapLevelChips === 'function') {
    window.syncMapLevelChips();
  }

  await loadCurrentYear();
}

window.syncShortcutButtons = function() {
  const scope = STATE.scope;
  const currentCirc = STATE.currentCirculo;
  
  document.querySelectorAll('.inset-shortcut-btn').forEach((btn) => {
    const val = btn.dataset.value;
    let active = false;
    if (val === 'national') {
      active = (scope.level === 'national');
    } else {
      active = (currentCirc === val);
    }
    btn.classList.toggle('active', active);
  });
};
