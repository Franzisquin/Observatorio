
function resolveFeatureSelectionId(properties) {
  if (typeof getFeatureSelectionId === 'function') {
    return getFeatureSelectionId(properties);
  }

  if (typeof window !== 'undefined' && typeof window.getFeatureSelectionId === 'function') {
    return window.getFeatureSelectionId(properties);
  }

  if (!properties) return '';

  const readProp = (key) => {
    if (typeof getProp === 'function') return getProp(properties, key);
    if (typeof window !== 'undefined' && typeof window.getProp === 'function') {
      return window.getProp(properties, key);
    }
    return properties[key] ?? properties[String(key).toLowerCase()] ?? properties[String(key).toUpperCase()] ?? null;
  };

  const explicitId = readProp('id_unico') || readProp('local_id');
  if (explicitId !== null && explicitId !== undefined && String(explicitId).trim() !== '') {
    return String(explicitId).trim();
  }

  const parts = [
    readProp('sg_uf') || readProp('SG_UF') || '',
    readProp('cd_localidade_tse') || readProp('CD_MUNICIPIO') || readProp('cod_localidade_ibge') || '',
    readProp('nr_zona') || readProp('NR_ZONA') || '',
    readProp('nr_locvot') || readProp('nr_local_votacao') || readProp('NR_LOCAL_VOTACAO') || ''
  ].map(part => String(part || '').trim()).filter(Boolean);

  return parts.join('_');
}

function clearVizCandidateSelectionState() {
  if (!dom.selectVizCandidato) return;

  dom.selectVizCandidato.innerHTML = '';
  dom.selectVizCandidato.value = '';
  delete dom.selectVizCandidato.dataset.selectedDeputyId;

  const deputySearchInput = document.getElementById('deputySearchInput');
  const deputySearchResults = document.getElementById('deputySearchResults');
  if (deputySearchInput) deputySearchInput.value = '';
  if (deputySearchResults) {
    deputySearchResults.innerHTML = '';
    deputySearchResults.classList.remove('visible');
  }
}

function formatVizCandidateLabel(candidateData) {
  if (!candidateData) return '';
  if (candidateData.isLegenda) return `Voto de Legenda — ${candidateData.partido}`;
  return `${toTitleCase(candidateData.nome)} (${candidateData.partido}) • Nº ${candidateData.numero}`;
}

function getResolvedVisualizationCandidateId(candidatoKey, cargo = currentCargo) {
  if (typeof resolveVisualizationCandidateId === 'function') {
    return resolveVisualizationCandidateId(candidatoKey, cargo);
  }
  if (typeof window !== 'undefined' && typeof window.resolveVisualizationCandidateId === 'function') {
    return window.resolveVisualizationCandidateId(candidatoKey, cargo);
  }
  return null;
}

function getCandidateVotesForVisualization(votesMap, candidateId) {
  if (typeof getCandidateVotesFromMap === 'function') {
    return getCandidateVotesFromMap(votesMap, candidateId);
  }
  if (typeof window !== 'undefined' && typeof window.getCandidateVotesFromMap === 'function') {
    return window.getCandidateVotesFromMap(votesMap, candidateId);
  }
  if (!votesMap || candidateId === null || candidateId === undefined) return null;
  const rawId = String(candidateId).trim();
  if (Object.prototype.hasOwnProperty.call(votesMap, rawId)) {
    return parseInt(votesMap[rawId], 10) || 0;
  }
  return null;
}

function populateVizCandidatoDropdown(turno) {
  const previousValue = dom.selectVizCandidato.value;
  const previousDeputyId = dom.selectVizCandidato.dataset.selectedDeputyId || '';
  clearVizCandidateSelectionState();

  const deputySearchBox = document.getElementById('deputySearchBox');
  const deputySearchInput = document.getElementById('deputySearchInput');
  const deputySearchResults = document.getElementById('deputySearchResults');

  // Para deputados ou vereadores: usar o campo de busca em vez do select
  if (currentCargo.startsWith('deputado') || currentCargo.startsWith('vereador')) {
    const isVereador = currentCargo.startsWith('vereador');
    const isEstadual = !isVereador && currentCargo.includes('estadual');
    const typeKey = isVereador ? 'v' : (isEstadual ? 'e' : 'f');
    const resultStore = isVereador ? STATE.vereadorResults : STATE.deputyResults;
    const metaStore = isVereador ? STATE.vereadorMetadata : STATE.deputyMetadata;
    const inaptosList = isVereador
      ? (STATE.inaptos['vereador_ord']?.['1T'] || [])
      : (STATE.inaptos[currentCargo]?.['1T'] || []);

    // Lookup local_id → chave (zona_local para vereador, zona_muni_local para deputado)
    const lookupKey = isVereador ? 'vereadorLookup' : 'deputyLookup';
    const lookupCargoKey = isVereador ? 'vereadorLookupCargo' : 'deputyLookupCargo';
    if (!STATE[lookupKey] || STATE[lookupCargoKey] !== currentCargo) {
      const geojsonDep = currentDataCollection[currentCargo];
      if (geojsonDep && geojsonDep.features) {
        STATE[lookupKey] = new Map();
        STATE[lookupCargoKey] = currentCargo;
        geojsonDep.features.forEach(f => {
          const p = f.properties;
          const id = resolveFeatureSelectionId(p);
          const z = getProp(p, 'nr_zona');
          const l = getProp(p, 'nr_locvot') || getProp(p, 'nr_local_votacao');
          const m = getProp(p, 'cd_localidade_tse') || getProp(p, 'CD_MUNICIPIO');
          if (id && z && l) {
            const k = isVereador ? `${parseInt(z)}_${parseInt(l)}` : `${parseInt(z)}_${parseInt(m)}_${parseInt(l)}`;
            STATE[lookupKey].set(id, k);
          }
        });
      }
    }

    // Garante cache de prefixos de partido
    const partyPrefixKey = isVereador ? '_vereadorPartyPrefixCache' : '_partyPrefixCache';
    if (!STATE[partyPrefixKey]) {
      STATE[partyPrefixKey] = {};
      for (const [cid, cmeta] of Object.entries(metaStore || {})) {
        if (cid.length > 2 && cmeta && cmeta[1] && !cmeta[1].toUpperCase().startsWith('PARTIDO ')) {
          const prefix = cid.substring(0, 2);
          if (!STATE[partyPrefixKey][prefix]) STATE[partyPrefixKey][prefix] = cmeta[1];
        }
      }
    }

    const totalVotesByCand = {};
    const processedKeys = new Set();

    const geojsonDep = currentDataCollection[currentCargo];
    const ids = Array.from(selectedLocationIDs);
    const shouldUseFilteredFeatures = ids.length === 0 && geojsonDep?.features?.length;
    const usarTodosVizDeputy = !isVereador && !shouldUseFilteredFeatures && STATE.isFilterAggregationActive &&
      STATE.currentElectionType === 'geral' &&
      currentCidadeFilter === 'all' &&
      ids.length > 100;

    if (usarTodosVizDeputy) {
      for (const [key, locData] of Object.entries(resultStore)) {
        const votes = locData[typeKey];
        if (!votes) continue;
        for (const [cid, v] of Object.entries(votes)) {
          if (cid === '95' || cid === '96') continue;
          totalVotesByCand[cid] = (totalVotesByCand[cid] || 0) + (parseInt(v) || 0);
        }
      }
    } else if (shouldUseFilteredFeatures) {
      const savedPerformanceFilter = performanceFilterMinPct;
      performanceFilterMinPct = 0;

      try {
        geojsonDep.features.forEach((feature) => {
          if (typeof filterFeature === 'function' && !filterFeature(feature)) return;

          const p = feature.properties;
          const z = getProp(p, 'nr_zona');
          const l = getProp(p, 'nr_locvot') || getProp(p, 'nr_local_votacao');
          const m = getProp(p, 'cd_localidade_tse') || getProp(p, 'CD_MUNICIPIO');
          if (!z || !l) return;

          const key = isVereador
            ? `${parseInt(z)}_${parseInt(l)}`
            : `${parseInt(z)}_${parseInt(m)}_${parseInt(l)}`;

          if (!key || processedKeys.has(key)) return;
          processedKeys.add(key);

          const locData = resultStore[key];
          if (!locData) return;
          const votes = locData[typeKey];
          if (!votes) return;

          for (const [cid, v] of Object.entries(votes)) {
            if (cid === '95' || cid === '96') continue;
            totalVotesByCand[cid] = (totalVotesByCand[cid] || 0) + (parseInt(v) || 0);
          }
        });
      } finally {
        performanceFilterMinPct = savedPerformanceFilter;
      }
    } else {
      for (let i = 0; i < ids.length; i++) {
        const key = STATE[lookupKey] ? STATE[lookupKey].get(ids[i]) : null;
        if (!key || processedKeys.has(key)) continue;
        processedKeys.add(key);
        const locData = resultStore[key];
        if (!locData) continue;
        const votes = locData[typeKey];
        if (!votes) continue;
        for (const [cid, v] of Object.entries(votes)) {
          if (cid === '95' || cid === '96') continue;
          totalVotesByCand[cid] = (totalVotesByCand[cid] || 0) + (parseInt(v) || 0);
        }
      }
    }

    deputySearchCandList = Object.entries(metaStore || {})
      .filter(([id]) => totalVotesByCand[id] > 0)
      .filter(([id]) => !(STATE.filterInaptos && inaptosList.includes(id)))
      .map(([id, meta]) => {
        const isLegenda = id.length <= 2;
        let partido = meta[1] || '?';
        let nome = meta[0] || id;
        if (isLegenda) {
          const partidoResolvido = STATE[partyPrefixKey]?.[id];
          if (partidoResolvido) partido = normalizePartyAlias(partidoResolvido.toUpperCase());
          nome = `Voto de Legenda — ${partido}`;
        }
        return { id, nome, partido, status: meta[2] || '', votos: totalVotesByCand[id] || 0, numero: id, isLegenda };
      })
      .sort((a, b) => b.votos - a.votos);

    // Esconde select normal, mostra campo de busca
    dom.selectVizCandidato.style.display = 'none';
    if (deputySearchBox) {
      deputySearchBox.style.display = 'flex';
    }

    // Limpar busca anterior
    if (deputySearchInput) {
      deputySearchInput.value = '';
      deputySearchInput.placeholder = deputySearchCandList.length > 0
        ? `Buscar entre ${deputySearchCandList.length} candidatos (nome ou nº)...`
        : 'Nenhum candidato disponível';
      deputySearchInput.disabled = deputySearchCandList.length === 0;
    }
    if (deputySearchResults) {
      deputySearchResults.innerHTML = '';
      deputySearchResults.classList.remove('visible');
    }

    // Popular o select oculto com o primeiro candidato (fallback)
    if (deputySearchCandList.length > 0) {
      deputySearchCandList.forEach(c => {
        const opt = document.createElement('option');
        opt.value = `${c.nome} (${c.partido})`;
        opt.textContent = `${c.nome} (${c.partido})`;
        opt.dataset.candidateId = c.id;
        dom.selectVizCandidato.appendChild(opt);
      });

      const selectedCandidate = deputySearchCandList.find(c =>
        c.id === previousDeputyId || `${c.nome} (${c.partido})` === previousValue
      ) || deputySearchCandList[0];

      if (selectedCandidate) {
        dom.selectVizCandidato.value = `${selectedCandidate.nome} (${selectedCandidate.partido})`;
        dom.selectVizCandidato.dataset.selectedDeputyId = selectedCandidate.id;
        if (deputySearchInput) deputySearchInput.value = formatVizCandidateLabel(selectedCandidate);
      }
    }

    // Inicializar event listeners para pesquisa (apenas uma vez)
    if (!deputySearchInitialized && deputySearchInput && deputySearchResults) {
      deputySearchInitialized = true;
      setupDeputySearch(deputySearchInput, deputySearchResults);
    }

    return;
  }

  // Não é deputado: esconde search box, mostra select
  dom.selectVizCandidato.style.display = '';
  if (deputySearchBox) deputySearchBox.style.display = 'none';

  // Eleições gerais/municipais: comportamento original
  const candidatos = STATE.candidates[currentCargo]?.[turno] || [];
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

  if (dom.selectVizCandidato.options.length > 0) {
    const hasPrevious = Array.from(dom.selectVizCandidato.options).some(opt => opt.value === previousValue);
    dom.selectVizCandidato.value = hasPrevious ? previousValue : dom.selectVizCandidato.options[0].value;
  }
}

// ====== DEPUTY SEARCH LOGIC ======
function setupDeputySearch(input, resultsContainer) {
  const debouncedSearch = debounce((query) => {
    performDeputySearch(query, resultsContainer);
  }, 150);

  input.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    if (query.length === 0) {
      resultsContainer.innerHTML = '';
      resultsContainer.classList.remove('visible');
      return;
    }
    debouncedSearch(query);
  });

  input.addEventListener('focus', (e) => {
    const query = e.target.value.trim();
    if (query.length === 0) {
      // Mostrar top 15 candidatos mais votados ao focar
      showTopDeputyCandidates(resultsContainer);
    } else {
      performDeputySearch(query, resultsContainer);
    }
  });

  // Fechar resultados ao clicar fora
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#deputySearchBox')) {
      resultsContainer.classList.remove('visible');
    }
  });

  // Navegação por teclado
  input.addEventListener('keydown', (e) => {
    const items = resultsContainer.querySelectorAll('.search-result-item');
    if (items.length === 0) return;

    let currentIdx = -1;
    items.forEach((item, i) => {
      if (item.classList.contains('highlighted')) currentIdx = i;
    });

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items.forEach(i => i.classList.remove('highlighted'));
      const next = currentIdx < items.length - 1 ? currentIdx + 1 : 0;
      items[next].classList.add('highlighted');
      items[next].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items.forEach(i => i.classList.remove('highlighted'));
      const prev = currentIdx > 0 ? currentIdx - 1 : items.length - 1;
      items[prev].classList.add('highlighted');
      items[prev].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const highlighted = resultsContainer.querySelector('.search-result-item.highlighted');
      if (highlighted) {
        highlighted.click();
      } else if (items.length > 0) {
        items[0].click();
      }
    } else if (e.key === 'Escape') {
      resultsContainer.classList.remove('visible');
      input.blur();
    }
  });
}

function showTopDeputyCandidates(resultsContainer) {
  const top = deputySearchCandList.slice(0, 15);
  renderDeputySearchResults(top, resultsContainer, '');
}

function performDeputySearch(query, resultsContainer) {
  if (!query || deputySearchCandList.length === 0) {
    resultsContainer.innerHTML = '';
    resultsContainer.classList.remove('visible');
    return;
  }

  const normalizedQuery = norm(query);
  const isNumericSearch = /^\d+$/.test(query.trim());

  let results;
  if (isNumericSearch) {
    // Busca por número: exata no início
    results = deputySearchCandList.filter(c =>
      c.numero.startsWith(query.trim())
    );
  } else {
    // Busca por nome: normalizada
    results = deputySearchCandList.filter(c => {
      const normalizedName = norm(c.nome);
      const normalizedParty = norm(c.partido);
      return normalizedName.includes(normalizedQuery) || normalizedParty.includes(normalizedQuery);
    });
  }

  // Limitar a 20 resultados
  results = results.slice(0, 20);

  renderDeputySearchResults(results, resultsContainer, query);
}

function renderDeputySearchResults(results, container, query) {
  if (results.length === 0) {
    container.innerHTML = '<div class="search-result-item" style="color:var(--muted); cursor:default; justify-content:center;">Nenhum candidato encontrado</div>';
    container.classList.add('visible');
    return;
  }

  const selectedValue = dom.selectVizCandidato.value;
  const normalizedQuery = query ? norm(query) : '';
  const isNumericSearch = query ? /^\d+$/.test(query.trim()) : false;

  container.innerHTML = results.map((c, idx) => {
    const isSelected = selectedValue === `${c.nome} (${c.partido})`;
    const partyColor = PARTY_COLORS.get(c.partido.toUpperCase()) || DEFAULT_SWATCH;

    // Highlight match
    let displayName = toTitleCase(c.nome);
    let displayNumber = c.numero;

    if (query) {
      if (isNumericSearch) {
        // Highlight number match
        const matchLen = query.trim().length;
        displayNumber = `<strong>${c.numero.substring(0, matchLen)}</strong>${c.numero.substring(matchLen)}`;
      } else {
        // Highlight name match
        const nameNorm = norm(c.nome);
        const idx = nameNorm.indexOf(normalizedQuery);
        if (idx !== -1) {
          const original = c.nome;
          displayName = toTitleCase(original.substring(0, idx))
            + '<strong>' + toTitleCase(original.substring(idx, idx + query.length)) + '</strong>'
            + toTitleCase(original.substring(idx + query.length));
        }
      }
    }

    const isLegendaItem = c.isLegenda || (c.id && c.id.length <= 2);
    return `
      <div class="search-result-item ${isSelected ? 'selected' : ''}"
           data-candidate-id="${c.id}"
           style="${isLegendaItem ? `border-left:3px solid ${partyColor};` : ''}">
        <span class="search-result-name" style="${isLegendaItem ? `color:${partyColor}; font-weight:600;` : ''}">${displayName}</span>
        ${!isLegendaItem ? `<span class="search-result-number">${displayNumber}</span>` : ''}
        <span class="search-result-party" style="background:${partyColor}; color:#fff; border:none; font-weight:700; min-width:48px; text-align:center;">${c.partido}</span>
        <span style="font-size:10px; color:var(--muted); white-space:nowrap;">${c.votos.toLocaleString('pt-BR')} v.</span>
      </div>
    `;
  }).join('');

  container.classList.add('visible');

  // Adicionar click listeners
  container.querySelectorAll('.search-result-item[data-candidate-id]').forEach(item => {
    item.addEventListener('click', () => {
      const candId = item.dataset.candidateId;
      if (!candId) return;

      // Encontrar candidato na lista pelo ID
      const candData = deputySearchCandList.find(c => c.id === candId);
      if (!candData) return;

      const selectValue = `${candData.nome} (${candData.partido})`;

      dom.selectVizCandidato.value = selectValue;
      dom.selectVizCandidato.dataset.selectedDeputyId = candData.id;

      const input = document.getElementById('deputySearchInput');
      if (input) {
        const label = candData.isLegenda
          ? `Voto de Legenda — ${candData.partido}`
          : `${toTitleCase(candData.nome)} (${candData.partido}) • Nº ${candData.numero}`;
        input.value = label;
      }

      // Fechar dropdown
      container.classList.remove('visible');

      // Disparar evento de mudança
      dom.selectVizCandidato.dispatchEvent(new Event('change'));
    });
  });
}

// ====== MAP RENDERING ======

// Variável para guardar o listener de movimento
let moveEndListener = null;

function applyFiltersAndRedraw() {
  // Limpeza PROFUNDA das camadas
  if (currentLayer) {
    try {
      // Remove todos os event listeners antes de limpar
      currentLayer.off();
      // Limpa todas as sub-camadas
      currentLayer.clearLayers();
      // Remove do mapa
      map.removeLayer(currentLayer);
    } catch (e) {
      console.warn("Erro ao limpar camada:", e);
    }
    currentLayer = null;
  }

  if (moveEndListener) {
    map.off('moveend', moveEndListener);
    moveEndListener = null;
  }

  const geojson = currentDataCollection[currentCargo];
  if (!geojson) {
    return;
  }

  // O renderer canvas do Leaflet pode ter sido desalojado durante trocas
  // rápidas de eleição/cargo. Se ele ficou órfão, recriamos antes de renderizar.
  if (!mapCanvasRenderer || mapCanvasRenderer._map !== map) {
    mapCanvasRenderer = L.canvas({ padding: 0.5, tolerance: 10 });
  }

  // Recalcular estatísticas do candidato se estiver no modo Desempenho
  if (currentVizMode.startsWith('desempenho') && dom.selectVizCandidato?.value) {
    const candidatoKey = dom.selectVizCandidato.value;
    performanceModeStats = calculateCandidateStats(candidatoKey) || {
      candidato: candidatoKey, minPct: 0, maxPct: 100, avgPct: 0, totalLocais: 0
    };
    updatePerformanceStatsUI();
  }

  updateAvailabilityBars(geojson);

  // Precomputa vencedores de vereador se necessário
  if (currentCargo.startsWith('vereador') && STATE.vereadorResults && Object.keys(STATE.vereadorResults).length > 0) {
    precomputeVereadorWinners();
  }

  currentLayer = L.geoJSON(geojson, {
    renderer: mapCanvasRenderer,
    pointToLayer: createPointLayer,
    style: getFeatureStyle,
    onEachFeature: onEachFeature,
    filter: filterFeature
  }).addTo(map);

  CURRENT_VISIBLE_FEATURES_CACHE = [];
  CURRENT_VISIBLE_PROPS_CACHE = [];
  currentLayer.eachLayer((layer) => {
    const feature = layer?.feature;
    const props = feature?.properties;
    if (!feature || !props) return;
    CURRENT_VISIBLE_FEATURES_CACHE.push(feature);
    CURRENT_VISIBLE_PROPS_CACHE.push(props);
  });

  // Call ISE Panel update
  if (typeof window.updateISEPanel === 'function') {
    window.updateISEPanel(currentLayer, currentCargo, currentTurno);
  }

  syncResultsPanelToCurrentView();

  if (STATE.isLoadingDataset) {
    clearPendingFilterChanges();
  }
}



// --- HELPER FUNCTIONS (Extraídas para reaproveitar nos dois modos) ---

function createPointLayer(feature, latlng) {
  return L.circleMarker(latlng, { radius: getPointRadiusForFeature(feature) });
}

const DEFAULT_POINT_FILL_OPACITY = 0.8;

function getPointRadiusForFeature(feature) {
  let radius = 7;

  if (currentVizSize === 'comparecimento') {
    const turnoKey = (currentTurno === 2 && STATE.dataHas2T[currentCargo]) ? '2T' : '1T';
    let comparecimento = getFeatureComparecimentoCount(feature.properties, currentCargo, turnoKey);

    // Fallback para cargos com 2o turno quando o turno ativo nao tiver comparecimento mapeado.
    if (comparecimento === 0 && STATE.dataHas2T[currentCargo]) {
      const fallbackTurnoKey = turnoKey === '2T' ? '1T' : '2T';
      comparecimento = getFeatureComparecimentoCount(feature.properties, currentCargo, fallbackTurnoKey);
    }

    const logComp = Math.log10(Math.max(1, comparecimento));
    let pctLog = (logComp - 2) / (4 - 2);
    pctLog = Math.max(0, Math.min(1, pctLog));
    radius = 3 + (8 * pctLog);
  }

  return radius;
}

function shouldFullRedrawOnTurnChange() {
  return currentVizMode.startsWith('desempenho') && performanceFilterMinPct > 0;
}

function refreshTurnDependentUI() {
  if (!currentDataCollection[currentCargo]) return;

  const turnoKey = (currentTurno === 2 && STATE.dataHas2T[currentCargo]) ? '2T' : '1T';

  if (currentVizMode.startsWith('desempenho')) {
    populateVizCandidatoDropdown(turnoKey);
  }

  if (shouldFullRedrawOnTurnChange()) {
    applyFiltersAndRedraw();
    return;
  }

  if (currentVizMode.startsWith('desempenho') && dom.selectVizCandidato?.value) {
    const candidatoKey = dom.selectVizCandidato.value;
    performanceModeStats = calculateCandidateStats(candidatoKey) || {
      candidato: candidatoKey, minPct: 0, maxPct: 100, avgPct: 0, totalLocais: 0
    };
    updatePerformanceStatsUI();
  }

  if (currentLayer?.eachLayer) {
    currentLayer.eachLayer((layer) => {
      const feature = layer?.feature;
      if (!feature) return;

      if (typeof layer.setStyle === 'function') {
        layer.setStyle(getFeatureStyle(feature));
      }

      if (typeof layer.setRadius === 'function') {
        layer.setRadius(getPointRadiusForFeature(feature));
      }
    });
  }

  if (typeof window.updateISEPanel === 'function') {
    window.updateISEPanel(currentLayer, currentCargo, currentTurno);
  }

  syncResultsPanelToCurrentView();
}


function filterFeature(feature) {
  const props = feature.properties;

  // Filtro de Presídios/Locais Especiais (Exclusão Global)
  const nomeLocalForExclusion = norm(getProp(props, 'nm_locvot'));
  const exclusoes = ['PRISAO', 'PENITENCIARIA', 'PENINTENCIARI', 'DETENCAO', 'INTERNATO', 'CDP ', 'PRESIDIO', 'FUNDACAO CASA', 'FUND. CASA', 'UI-', 'UNID. DE INT', 'PENAL'];
  for (let kw of exclusoes) {
    if (nomeLocalForExclusion.includes(kw)) {
      return false;
    }
  }

  // Filtro de 2T Vazio
  // Filtro de 2T Vazio
  let comparecimento_1t = 0;

  comparecimento_1t = getFeatureComparecimentoCount(props, currentCargo, '1T');

  if (comparecimento_1t === 0) {
    if (STATE.dataHas2T[currentCargo] && !currentCargo.startsWith('deputado')) {
      const comparecimento_2t = getFeatureComparecimentoCount(props, currentCargo, '2T');
      if (comparecimento_2t === 0) return false;
    } else {
      return false;
    }
  }

  if (!matchesLocationFilters(props)) return false;

  // --- FILTRO DE DESEMPENHO (porcentagem mínima) ---
  if (currentVizMode.startsWith('desempenho') && performanceFilterMinPct > 0) {
    const candidatoKey = dom.selectVizCandidato?.value;
    if (candidatoKey) {
      if (currentCargo.startsWith('deputado') || currentCargo.startsWith('vereador')) {
        const isVereador = currentCargo.startsWith('vereador');
        const typeKey = isVereador ? 'v' : (currentCargo.includes('estadual') ? 'e' : 'f');
        const candId = getResolvedVisualizationCandidateId(candidatoKey, currentCargo);
        if (candId) {
          const z = parseInt(getProp(props, 'nr_zona'));
          const l = parseInt(getProp(props, 'nr_locvot') || getProp(props, 'nr_local_votacao'));
          const m = parseInt(getProp(props, 'cd_localidade_tse') || getProp(props, 'CD_MUNICIPIO'));
          const hasValidKey = !isNaN(z) && !isNaN(l) && (isVereador || !isNaN(m));
          if (hasValidKey) {
            const resultKey = isVereador ? `${z}_${l}` : `${z}_${m}_${l}`;
            const resultStore = isVereador ? STATE.vereadorResults : STATE.deputyResults;
            const allRes = resultStore[resultKey];
            const votes = allRes?.[typeKey];
            if (votes) {
              let total = 0;
              for (const [cid, v] of Object.entries(votes)) {
                if (cid !== '95' && cid !== '96') total += parseInt(v) || 0;
              }
              if (total > 0) {
                const candidateVotes = getCandidateVotesForVisualization(votes, candId) || 0;
                const pctCand = (candidateVotes / total) * 100;
                if (pctCand < performanceFilterMinPct) return false;
              }
            }
          }
        }
      } else {
        const turnoKey = (currentTurno === 2 && STATE.dataHas2T[currentCargo]) ? '2T' : '1T';
        const { totalValidos } = getVotosValidos(props, currentCargo, turnoKey, STATE.filterInaptos);
        if (totalValidos > 0) {
          const votosCand = ensureNumber(getProp(props, candidatoKey));
          const pctCand = (votosCand / totalValidos) * 100;
          if (pctCand < performanceFilterMinPct) return false;
        }
      }
    }
  }

  // --- FILTROS CENSITÁRIOS ---

  // 1. Renda (Direto)
  const renda = ensureNumber(getProp(props, 'Renda Media'));
  if (STATE.censusFilters.rendaMin !== null && renda < STATE.censusFilters.rendaMin) return false;
  if (STATE.censusFilters.rendaMax !== null && renda > STATE.censusFilters.rendaMax) return false;


  // Helper para somar chaves variadas
  const getVal = (candidates) => {
    for (const key of candidates) {
      if (props[key] !== undefined) return ensureNumber(props[key]);

      const upperKey = String(key).toUpperCase();
      for (const propKey in props) {
        if (String(propKey).toUpperCase() === upperKey) {
          return ensureNumber(props[propKey]);
        }
      }
    }

    return 0;
  };

  // Helper de checagem genérica Pct ou Absoluto Calculado
  const checkDynamic = (filterVal, filterMode, type) => {
    if (filterVal === null) return true;

    // Se for Modo Legacy (2006) ou se o dado já vier como Pct explícito:
    // (Ainda precisamos suportar Pct direto para Raça e Saneamento)

    // Raça & Saneamento (Sempre Pct)
    if (type === 'raca' || type === 'saneamento') {
      const propVal = ensureNumber(getProp(props, filterMode));
      return propVal >= filterVal;
    }

    // Para Gênero, Idade, Escolaridade, Civil: Calcular dinamicamente
    let numerator = 0;
    let denominator = 0;

    // Gênero
    if (type === 'genero') {
      const h = getVal(['MASCULINO', 'HOMENS', 'Homens', 'Pct Homens']);
      const m = getVal(['FEMININO', 'MULHERES', 'Mulheres', 'Pct Mulheres']);

      // Fallback para legacy Pct direto se não tiver absoluto
      // Se tiver Pct Homens e Pct Mulheres, getVal retornará eles.
      // Se for Pct, a soma deve ser ~100 (ou perto). Se for Absoluto, soma é pop.

      const total = h + m;
      if (total === 0) return false;

      // Se for Pct, total é ~100.
      // filterVal é 0-100.

      // 'Pct Mulheres' vs 'Pct Homens'
      if (filterMode === 'Pct Mulheres') numerator = m;
      else numerator = h;

      const pct = (numerator / total) * 100;
      return pct >= filterVal;
    }

    // Estado Civil
    else if (type === 'estadocivil') {
      const s = getVal(['SOLTEIRO', 'Solteiro', 'Pct Solteiro']);
      const c = getVal(['CASADO', 'Casado', 'Pct Casado']);
      const d = getVal(['DIVORCIADO', 'Divorciado', 'Pct Divorciado']);
      const v = getVal(['VIÚVO', 'VIUVO', 'Viúvo', 'Pct Viúvo']);
      const sep = getVal(['SEPARADO JUDICIALMENTE', 'SEPARADO', 'Separado', 'Pct Separado']);

      // Detecção de Modo Percentual (Legacy)
      // Se a soma for significativamente < da população total esperada (em absolutos) ou se for ~100
      // Mas melhor: verificar se usamos keys de Pct
      const isPct = (props['Pct Solteiro'] !== undefined || props['Pct Casado'] !== undefined);

      let den;
      let num;

      if (isPct) den = 100;
      else den = s + c + d + v + sep;

      if (den === 0) return false;

      if (filterMode === 'Solteiro') num = s;
      else if (filterMode === 'Casado') num = c;
      else if (filterMode === 'Divorciado') num = d;
      else if (filterMode === 'Viúvo') num = v;
      else num = sep;

      return (num / den * 100) >= filterVal;
    }
    else if (type === 'escolaridade') {
      const ana = getVal(['ANALFABETO', 'Analfabeto', 'Pct Analfabeto']);
      const le = getVal(['LÊ E ESCREVE', 'LE E ESCREVE', 'Lê e Escreve', 'Pct Lê e Escreve']);
      const fi = getVal(['ENSINO FUNDAMENTAL INCOMPLETO', 'FUNDAMENTAL INCOMPLETO', 'Pct Fundamental Incompleto']);
      const fc = getVal(['ENSINO FUNDAMENTAL COMPLETO', 'FUNDAMENTAL COMPLETO', 'Pct Fundamental Completo']);
      const mi = getVal(['ENSINO MÉDIO INCOMPLETO', 'MEDIO INCOMPLETO', 'Pct Médio Incompleto']);
      const mc = getVal(['ENSINO MÉDIO COMPLETO', 'MEDIO COMPLETO', 'Pct Médio Completo']);
      const si = getVal(['ENSINO SUPERIOR INCOMPLETO', 'SUPERIOR INCOMPLETO', 'Pct Superior Incompleto']);
      const sc = getVal(['ENSINO SUPERIOR COMPLETO', 'SUPERIOR COMPLETO', 'Pct Superior Completo']);

      const isPct = (props['Pct Analfabeto'] !== undefined || props['Pct Médio Completo'] !== undefined);

      let den;
      let num;

      if (isPct) den = 100;
      else den = ana + le + fi + fc + mi + mc + si + sc;

      if (den === 0) return false;

      if (filterMode.includes('Analfabeto')) num = ana;
      else if (filterMode.includes('Lê')) num = le;
      else if (filterMode === 'Fund. Incomp.') num = fi;
      else if (filterMode === 'Fund. Completo') num = fc;
      else if (filterMode === 'Médio Incomp.') num = mi;
      else if (filterMode === 'Médio Completo') num = mc;
      else if (filterMode === 'Superior Incompleto') num = si;
      else if (filterMode === 'Superior Completo') num = sc;

      return (num / den * 100) >= filterVal;
    }

    // Idade
    if (type === 'idade') {
      // Calcular buckets
      let buckets = { '16-24': 0, '25-34': 0, '35-44': 0, '45-59': 0, '60-74': 0, '75-100': 0 };
      let totalAge = 0;

      // Varredura para montar buckets desta feature
      for (const key in props) {
        if (key.match(/anos/i) && !key.match(/^Pct/i)) {
          const v = ensureNumber(props[key]);
          if (v === 0) continue;
          const match = key.match(/(\d+)/);
          if (match) {
            const age = parseInt(match[1]);
            totalAge += v;
            if (age >= 16 && age <= 24) buckets['16-24'] += v;
            else if (age >= 25 && age <= 34) buckets['25-34'] += v;
            else if (age >= 35 && age <= 44) buckets['35-44'] += v;
            else if (age >= 45 && age <= 59) buckets['45-59'] += v;
            else if (age >= 60 && age <= 74) buckets['60-74'] += v;
            else if (age >= 75) buckets['75-100'] += v;
          }
        } else if (key.startsWith('Pct ') && key.includes('anos')) {
          // Tratamento Legacy Pct
          // Se cair aqui, totalAge será soma de PCTS (~100).
          // filterMode será comparado com a soma das PCTs do bucket.
          const val = ensureNumber(props[key]);
          const match = key.match(/(\d+)/);
          if (match) {
            const age = parseInt(match[1]);
            // buckets... (simplificado, mas ok se assumirmos que ou tem absoluto ou tem pct)
            totalAge += val; // Isso vai dar ~100
            if (age >= 16 && age <= 24) buckets['16-24'] += val;
            else if (age >= 25 && age <= 34) buckets['25-34'] += val;
            else if (age >= 35 && age <= 44) buckets['35-44'] += val;
            else if (age >= 45 && age <= 59) buckets['45-59'] += val;
            else if (age >= 60 && age <= 74) buckets['60-74'] += val;
            else if (age >= 75) buckets['75-100'] += val;
          }
        }
      }

      if (totalAge === 0) return false;
      numerator = buckets[filterMode] || 0;
      const valCalc = (numerator / totalAge) * 100;
      return valCalc >= filterVal;
    }

    return true;
  };

  if (!checkDynamic(STATE.censusFilters.racaVal, STATE.censusFilters.racaMode, 'raca')) return false;
  if (!checkDynamic(STATE.censusFilters.generoVal, STATE.censusFilters.generoMode, 'genero')) return false;
  if (!checkDynamic(STATE.censusFilters.saneamentoVal, STATE.censusFilters.saneamentoMode, 'saneamento')) return false;

  if (!checkDynamic(STATE.censusFilters.idadeVal, STATE.censusFilters.idadeMode, 'idade')) return false;
  if (!checkDynamic(STATE.censusFilters.escolaridadeVal, STATE.censusFilters.escolaridadeMode, 'escolaridade')) return false;
  if (!checkDynamic(STATE.censusFilters.estadoCivilVal, STATE.censusFilters.estadoCivilMode, 'estadocivil')) return false;

  return true;
}


function getDeputyFeatureData(props) {
  const z = getProp(props, 'nr_zona');
  const l = getProp(props, 'nr_locvot') || getProp(props, 'nr_local_votacao');
  const m = getProp(props, 'cd_localidade_tse') || getProp(props, 'CD_MUNICIPIO'); // New part of key

  if (!z || !l || !m) return null;

  // FIX: Convert to int to avoid float-to-string mismatch (e.g. NR_ZONA=9.0 -> "9.0" vs "9")
  const id = `${parseInt(z)}_${parseInt(m)}_${parseInt(l)}`;
  const allRes = STATE.deputyResults[id];
  if (!allRes) return null;

  const isEstadual = currentCargo.includes('estadual');
  const typeKey = isEstadual ? 'e' : 'f';

  const votes = allRes[typeKey];
  if (!votes) return null;

  // Build cached map: 2-digit prefix -> real party acronym (e.g., '45' -> 'PSDB')
  // This resolves legend vote party names like 'PARTIDO 45' to actual acronyms
  if (!STATE._partyPrefixCache) {
    STATE._partyPrefixCache = {};
    for (const [cid, cmeta] of Object.entries(STATE.deputyMetadata || {})) {
      if (cid.length > 2 && cmeta && cmeta[1] && !cmeta[1].toUpperCase().startsWith('PARTIDO ')) {
        const prefix = cid.substring(0, 2);
        if (!STATE._partyPrefixCache[prefix]) {
          STATE._partyPrefixCache[prefix] = cmeta[1];
        }
      }
    }
  }

  let maxV = -1;
  let winner = null;
  let total = 0;

  // Party
  const partyVotes = {};
  let maxPartyV = -1;
  let winningParty = null;

  for (const [cand, v] of Object.entries(votes)) {
    if (STATE.filterInaptos && (STATE.inaptos[currentCargo]?.['1T'] || []).includes(cand)) {
      continue; // Filter out inactive candidates
    }

    const vi = parseInt(v);
    if (cand === '95' || cand === '96') {
      // blank/null
    } else {
      total += vi;

      // Only real candidates (IDs > 2 digits) compete for winner
      // Legend votes (2-digit IDs like '45') are excluded from candidate winner
      if (cand.length > 2 && vi > maxV) {
        maxV = vi;
        winner = cand;
      }

      const meta = STATE.deputyMetadata[cand];
      if (meta) {
        let party = meta[1];
        // Resolve generic party names ('PARTIDO XX') to actual acronyms for party aggregation
        if (party && party.toUpperCase().startsWith('PARTIDO ')) {
          const prefix = cand.substring(0, 2);
          if (STATE._partyPrefixCache[prefix]) {
            party = STATE._partyPrefixCache[prefix];
          }
        }
        partyVotes[party] = (partyVotes[party] || 0) + vi;
      }
    }
  }

  for (const [party, v] of Object.entries(partyVotes)) {
    if (v > maxPartyV) {
      maxPartyV = v;
      winningParty = party;
    }
  }

  return { total, winner, winnerVotes: maxV, winningParty, votes };
}

function getVereadorFeatureData(props) {
  if (!STATE._vereadorPartyPrefixCache) {
    STATE._vereadorPartyPrefixCache = {};
    for (const [cid, cmeta] of Object.entries(STATE.vereadorMetadata || {})) {
      if (cid.length > 2 && cmeta && cmeta[1] && !cmeta[1].toUpperCase().startsWith('PARTIDO ')) {
        const prefix = cid.substring(0, 2);
        if (!STATE._vereadorPartyPrefixCache[prefix]) {
          STATE._vereadorPartyPrefixCache[prefix] = cmeta[1];
        }
      }
    }
  }

  // Usa valores precomputados por precomputeVereadorWinners
  const total = props['_VTOTAL_'] !== undefined ? parseInt(props['_VTOTAL_']) : undefined;
  const winner = props['_VWINNER_'] !== undefined ? props['_VWINNER_'] : undefined;
  const winnerVotes = props['_VWVOTES_'] !== undefined ? parseInt(props['_VWVOTES_']) : -1;

  if (total === undefined) {
    // Fallback: calcula na hora se precompute ainda nao rodou
    const TYPE_KEY = 'v';
    const z = getProp(props, 'nr_zona');
    const l = getProp(props, 'nr_locvot') || getProp(props, 'nr_local_votacao');
    if (!z || !l) return null;
    const key = `${parseInt(z)}_${parseInt(l)}`;
    const locData = STATE.vereadorResults[key];
    if (!locData || !locData[TYPE_KEY]) return null;
    const votes = locData[TYPE_KEY];
    let tot = 0, win = null, winV = -1;
    const partyVotes = {};
    let maxPartyV = -1;
    let winningParty = null;
    for (const [cid, v] of Object.entries(votes)) {
      if (cid === '95' || cid === '96') continue;
      if (STATE.filterInaptos && (STATE.inaptos['vereador_ord']?.['1T'] || []).includes(cid)) continue;
      const vi = parseInt(v) || 0;
      tot += vi;
      if (cid.length > 2 && vi > winV) { winV = vi; win = cid; }

      const meta = STATE.vereadorMetadata[cid];
      if (meta) {
        let party = meta[1];
        if (party && party.toUpperCase().startsWith('PARTIDO ')) {
          const prefix = cid.substring(0, 2);
          if (STATE._vereadorPartyPrefixCache[prefix]) {
            party = STATE._vereadorPartyPrefixCache[prefix];
          }
        }
        partyVotes[party] = (partyVotes[party] || 0) + vi;
      }
    }

    for (const [party, v] of Object.entries(partyVotes)) {
      if (v > maxPartyV) {
        maxPartyV = v;
        winningParty = party;
      }
    }
    return { total: tot, winner: win, winnerVotes: winV, winningParty, votes };
  }

  // Recupera votes map para modo desempenho
  const z = getProp(props, 'nr_zona');
  const l = getProp(props, 'nr_locvot') || getProp(props, 'nr_local_votacao');
  let votes = null;
  if (z && l) {
    const key = `${parseInt(z)}_${parseInt(l)}`;
    const locData = STATE.vereadorResults[key];
    if (locData && locData['v']) votes = locData['v'];
  }

  let winningParty = null;
  if (votes) {
    const partyVotes = {};
    let maxPartyV = -1;

    for (const [cid, v] of Object.entries(votes)) {
      if (cid === '95' || cid === '96') continue;
      if (STATE.filterInaptos && (STATE.inaptos['vereador_ord']?.['1T'] || []).includes(cid)) continue;

      const meta = STATE.vereadorMetadata[cid];
      if (!meta) continue;

      let party = meta[1];
      if (party && party.toUpperCase().startsWith('PARTIDO ')) {
        const prefix = cid.substring(0, 2);
        if (STATE._vereadorPartyPrefixCache[prefix]) {
          party = STATE._vereadorPartyPrefixCache[prefix];
        }
      }

      partyVotes[party] = (partyVotes[party] || 0) + (parseInt(v) || 0);
    }

    for (const [party, v] of Object.entries(partyVotes)) {
      if (v > maxPartyV) {
        maxPartyV = v;
        winningParty = party;
      }
    }
  }

  return { total, winner, winnerVotes, winningParty, votes };
}


function getFeatureStyle(feature) {
  const props = feature.properties;
  let fillColor = DEFAULT_SWATCH;
  let fillOpacity = DEFAULT_POINT_FILL_OPACITY;
  let pctVal = 0;

  // SPECIAL HANDLING FOR DEPUTIES AND VEREADORES
  const isDeputy = currentCargo.startsWith('deputado');
  const isVereador = currentCargo.startsWith('vereador');

  if (isVereador) {
    const depData = getVereadorFeatureData(props);
    if (!depData || depData.total === 0) {
      return { stroke: false, fillColor: '#888888', fillOpacity: 0.2, opacity: 1 };
    }
    const { total, winner, winnerVotes, winningParty } = depData;
    let fillColor = DEFAULT_SWATCH, fillOpacity = DEFAULT_POINT_FILL_OPACITY, pctVal = 0;

    if (currentVizMode.startsWith('vencedor')) {
      if (STATE.vereadorViewMode === 'party') {
        if (winningParty) {
          fillColor = colorForParty(winningParty);
          pctVal = 100;
        }
      } else if (winner) {
        const meta = STATE.vereadorMetadata[winner];
        fillColor = getColorForCandidate(meta ? meta[0] : '', meta ? meta[1] : '');
        pctVal = (total > 0) ? (winnerVotes / total) * 100 : 0;
      }
    } else if (currentVizMode.startsWith('desempenho')) {
      const candidatoKey = dom.selectVizCandidato.value;
      if (candidatoKey && depData.votes) {
        const candId = getResolvedVisualizationCandidateId(candidatoKey, currentCargo);
        const cv = candId ? getCandidateVotesForVisualization(depData.votes, candId) : null;
        if (candId && cv !== null) {
          pctVal = (total > 0) ? (cv / total) * 100 : 0;
          const isLegendaCand = candId.length <= 2;
          if (isLegendaCand) {
            const partidoReal = STATE._vereadorPartyPrefixCache?.[candId] || '';
            fillColor = colorForParty(normalizePartyAlias(partidoReal.toUpperCase())) || DEFAULT_SWATCH;
          } else {
            const meta = STATE.vereadorMetadata[candId];
            fillColor = getColorForCandidate(meta ? meta[0] : '', meta ? meta[1] : '');
          }
          if (performanceModeStats.candidato) {
            fillColor = getRelativeGradientColor(fillColor, pctVal, performanceModeStats.minPct, performanceModeStats.maxPct);
            fillOpacity = cv > 0 ? 1 : 0.1;
          } else { fillOpacity = cv > 0 ? 1 : 0.1; }
        } else { fillColor = '#888888'; fillOpacity = 0.15; }
      }
    }
    if (currentVizColorStyle === 'gradient' && currentVizMode.startsWith('vencedor'))
      fillColor = getUniversalGradientColor(fillColor, pctVal);

    const localId = resolveFeatureSelectionId(props);
    if (selectedLocationIDs.has(localId) && !STATE.isFilterAggregationActive)
      return { stroke: false, fillColor: 'var(--accent)', fillOpacity: DEFAULT_POINT_FILL_OPACITY, opacity: 1 };
    return { stroke: false, fillColor, fillOpacity, opacity: 1 };
  }

  if (isDeputy || currentCargo.startsWith('deputado')) {
    const depData = getDeputyFeatureData(props);
    if (!depData || depData.total === 0) {
      // No data or 0 votes
      return {
        stroke: false,
        fillColor: '#888888',
        fillOpacity: 0.2, // Dim
        opacity: 1
      };
    }

    const { total, winner, winnerVotes, winningParty } = depData;

    if (currentVizMode.startsWith('vencedor')) {
      if (STATE.deputyViewMode === 'party') {
        if (winningParty) {
          fillColor = colorForParty(winningParty);
          pctVal = 100; // Solid party color
        }
      } else {
        // Candidate Mode - winner is always a real candidate (legend votes excluded)
        if (winner) {
          const meta = STATE.deputyMetadata[winner];
          const party = meta ? meta[1] : '';
          const name = meta ? meta[0] : winner;
          fillColor = getColorForCandidate(name, party);
          pctVal = (total > 0) ? (winnerVotes / total) * 100 : 0;
        }
      }
    } else if (currentVizMode.startsWith('desempenho')) {
      const candidatoKey = dom.selectVizCandidato.value;
      if (candidatoKey && depData.votes) {
        const candId = getResolvedVisualizationCandidateId(candidatoKey, currentCargo);
        const candVotes = candId ? getCandidateVotesForVisualization(depData.votes, candId) : null;

        if (candId && candVotes !== null) {
          pctVal = (depData.total > 0) ? (candVotes / depData.total) * 100 : 0;

          const isLegendaCand = candId.length <= 2;
          if (isLegendaCand) {
            const partidoReal = STATE._partyPrefixCache?.[candId] || '';
            fillColor = colorForParty(normalizePartyAlias(partidoReal.toUpperCase())) || DEFAULT_SWATCH;
          } else {
            const meta = STATE.deputyMetadata[candId];
            fillColor = getColorForCandidate(meta ? meta[0] : '', meta ? meta[1] : '');
          }

          if (performanceModeStats.candidato) {
            fillColor = getRelativeGradientColor(fillColor, pctVal, performanceModeStats.minPct, performanceModeStats.maxPct);
            fillOpacity = candVotes > 0 ? 1 : 0.1;
          } else {
            fillOpacity = candVotes > 0 ? 1 : 0.1;
          }
        } else {
          fillColor = '#888888';
          fillOpacity = 0.15;
        }
      }
    }

    // Gradient Logic (only for vencedor mode; desempenho applies its own gradient above)
    if (currentVizColorStyle === 'gradient' && currentVizMode.startsWith('vencedor')) {
      fillColor = getUniversalGradientColor(fillColor, pctVal);
    }

    const localId = resolveFeatureSelectionId(props);
    if (selectedLocationIDs.has(localId) && !STATE.isFilterAggregationActive) {
      return { stroke: false, fillColor: 'var(--accent)', fillOpacity: DEFAULT_POINT_FILL_OPACITY, opacity: 1 };
    }

    return { stroke: false, fillColor: fillColor, fillOpacity: fillOpacity, opacity: 1 };
  }

  // --- STANDARD LOGIC FOR GENERAL ELECTIONS ---
  const turnoKey = (currentTurno === 2 && STATE.dataHas2T[currentCargo]) ? '2T' : '1T';
  const { totalValidos } = getVotosValidos(props, currentCargo, turnoKey, STATE.filterInaptos);

  // 1. Determine Base Color and Percentage based on Mode
  if (currentVizMode.startsWith('vencedor')) {
    const { nome, partido, votos } = getVencedor(props, currentCargo, turnoKey, STATE.filterInaptos);
    fillColor = getColorForCandidate(nome, partido);
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
  // No modo Desempenho, SEMPRE usar escala adaptativa baseada em min/max do candidato
  if (currentVizMode.startsWith('desempenho') && performanceModeStats.candidato) {
    fillColor = getRelativeGradientColor(
      fillColor,
      pctVal,
      performanceModeStats.minPct,
      performanceModeStats.maxPct
    );
    fillOpacity = DEFAULT_POINT_FILL_OPACITY;
  } else if (currentVizColorStyle === 'gradient') {
    fillColor = getUniversalGradientColor(fillColor, pctVal);
    fillOpacity = DEFAULT_POINT_FILL_OPACITY;
  } else {
    fillOpacity = DEFAULT_POINT_FILL_OPACITY;
    if (currentVizMode.startsWith('desempenho') && pctVal === 0) {
      fillOpacity = 0.1;
    }
  }

  const localId = resolveFeatureSelectionId(props);

  if (selectedLocationIDs.has(localId) && !STATE.isFilterAggregationActive) {
    return {
      stroke: false,
      fillColor: 'var(--accent)',
      fillOpacity: DEFAULT_POINT_FILL_OPACITY,
      opacity: 1
    };
  }

  return {
    stroke: false,
    fillColor: fillColor,
    fillOpacity: fillOpacity,
    opacity: 1
  };
}

function getVotosValidos(props, cargo, turno, filtrarInaptos) {
  if (!props) return { totalValidos: 0, votosInaptos: 0 };

  if (cargo && cargo.startsWith('deputado')) {
    return { totalValidos: ensureNumber(props['_TOTAL_']), votosInaptos: 0 };
  }

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
  if (cargo && cargo.startsWith('deputado')) {
    return {
      nome: props['VENCEDOR'] || 'N/D',
      partido: props['PARTIDO_VENCEDOR'] || 'N/D',
      votos: ensureNumber(props['_WINNER_VOTES_']),
      status: 'N/D'
    };
  }

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
  const id = resolveFeatureSelectionId(props);

  const isShiftClick = e.originalEvent.shiftKey;

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
  isDragSelection = false; // Is manual click
  updateApplyButtonText();
  updateSelectionUI(false);
}

function clearSelection(updateMap = true) {
  selectedLocationIDs.clear();
  STATE.isFilterAggregationActive = false;

  if (updateMap && currentLayer && currentLayer.resetStyle) currentLayer.resetStyle();
  if (dom.resultsBox) dom.resultsBox.classList.add('section-hidden');
  if (dom.resultsContent) dom.resultsContent.innerHTML = '<div style="text-align:center; padding: 20px; color:var(--muted);"><p style="margin-bottom:8px">&#x1F446;</p>Clique no mapa ou use filtros para ver resultados.</div>';
  if (dom.resultsMetrics) dom.resultsMetrics.innerHTML = '';
  if (dom.summaryGrid) dom.summaryGrid.innerHTML = '';
  if (dom.resultsTitle) dom.resultsTitle.textContent = 'Resultados da Seleção';
  if (dom.resultsSubtitle) dom.resultsSubtitle.textContent = '';
  if (dom.btnLocateSelection) dom.btnLocateSelection.style.display = 'none';
  // Reset Unified View
  if (dom.unifiedResultsContainer) dom.unifiedResultsContainer.classList.remove('hidden');
  updateNeighborhoodProfileUI();
}

function focusSelectionOnMap(options = {}) {
  if (!map || !currentLayer || !selectedLocationIDs.size) return false;

  const selectedLayers = [];
  currentLayer.eachLayer?.((layer) => {
    const props = layer?.feature?.properties;
    if (!props) return;
    const id = resolveFeatureSelectionId(props);
    if (selectedLocationIDs.has(id)) selectedLayers.push(layer);
  });

  if (!selectedLayers.length) return false;

  const singleLayer = selectedLayers.length === 1 ? selectedLayers[0] : null;
  if (singleLayer && typeof singleLayer.getLatLng === 'function') {
    const latlng = singleLayer.getLatLng();
    if (!latlng) return false;
    const targetZoom = Math.max(map.getZoom() || 0, options.singleZoom || 16);
    map.flyTo(latlng, targetZoom, { animate: true, duration: 0.6 });
    if (typeof singleLayer.openTooltip === 'function') singleLayer.openTooltip();
    return true;
  }

  const bounds = L.latLngBounds([]);
  selectedLayers.forEach((layer) => {
    if (typeof layer.getBounds === 'function') {
      bounds.extend(layer.getBounds());
    } else if (typeof layer.getLatLng === 'function') {
      bounds.extend(layer.getLatLng());
    }
  });

  if (!bounds.isValid()) return false;

  map.flyToBounds(bounds, {
    animate: true,
    duration: 0.6,
    padding: options.padding || [32, 32],
    maxZoom: options.maxZoom || 16
  });
  return true;
}

function focusCurrentLayerOnMap(options = {}) {
  if (!map || !currentLayer) return false;

  const bounds = currentLayer.getBounds?.();
  if (!bounds?.isValid?.()) return false;

  map.flyToBounds(bounds, {
    animate: true,
    duration: 0.6,
    padding: options.padding || [32, 32],
    maxZoom: options.maxZoom || 16
  });
  return true;
}

function syncResultsPanelToCurrentView() {
  if (!currentDataCollection[currentCargo]) return;

  if (selectedLocationIDs.size > 0) {
    updateSelectionUI(STATE.isFilterAggregationActive);
    return;
  }

  const visibleFeatures = CURRENT_VISIBLE_FEATURES_CACHE || [];
  if (!visibleFeatures.length) {
    dom.resultsBox.classList.remove('section-hidden');
    dom.resultsTitle.textContent = 'Sem resultados';
    dom.resultsSubtitle.textContent = 'Nenhum local corresponde ao estado atual dos filtros';
    if (dom.btnLocateSelection) dom.btnLocateSelection.style.display = 'none';
    dom.resultsContent.innerHTML = '<div style="text-align:center; padding:20px; color:var(--muted);">Nenhum local encontrado.</div>';
    dom.resultsMetrics.innerHTML = '';
    dom.summaryGrid.innerHTML = '';
    updateNeighborhoodProfileUI();
    return;
  }

  selectedLocationIDs.clear();
  visibleFeatures.forEach((feature) => {
    const id = resolveFeatureSelectionId(feature.properties);
    if (id) selectedLocationIDs.add(id);
  });

  updateSelectionUI(true);
}

function getAllFeaturesForAggregation() {
  // Retorna TODAS as features que passam pelos filtros atuais
  // Não apenas as visíveis no viewport
  const geojson = currentDataCollection[currentCargo];
  if (!geojson || !geojson.features) return [];

  return geojson.features.filter(f => filterFeature(f));
}

// ====== SHIFT+DRAG SELECTION LOGIC ======
function setupBoxSelection() {
  const mapContainer = map.getContainer();

  // Create Visual Box Element
  selectionBoxElement = document.createElement('div');
  selectionBoxElement.classList.add('selection-box');
  mapContainer.appendChild(selectionBoxElement);

  // Note: We use the map container for events to capture drags over the map
  mapContainer.addEventListener('mousedown', handleMouseDown);
  window.addEventListener('mousemove', handleMouseMove); // Window to catch drags outside map
  window.addEventListener('mouseup', handleMouseUp);
}

function handleMouseDown(e) {
  // Only activate if SHIFT is pressed
  if (!e.shiftKey) return;

  // Only Left Click
  if (e.button !== 0) return;

  isSelectorsActive = true;

  // Disable Map Dragging while selecting to avoid conflicts
  map.dragging.disable();
  if (map.boxZoom) map.boxZoom.disable();

  // Get start point relative to container
  const mapContainer = map.getContainer();
  const rect = mapContainer.getBoundingClientRect();

  startSelectionPoint = {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  };

  // Reset and Show Box
  updateSelectionBox(startSelectionPoint.x, startSelectionPoint.y, 0, 0);
  selectionBoxElement.style.display = 'block';

  // Prevent default text selection
  e.preventDefault();
}

function handleMouseMove(e) {
  if (!isSelectorsActive) return;

  const mapContainer = map.getContainer();
  const rect = mapContainer.getBoundingClientRect();

  const currentX = e.clientX - rect.left;
  const currentY = e.clientY - rect.top;

  // Calculate box geometry
  const x = Math.min(startSelectionPoint.x, currentX);
  const y = Math.min(startSelectionPoint.y, currentY);
  const width = Math.abs(currentX - startSelectionPoint.x);
  const height = Math.abs(currentY - startSelectionPoint.y);

  updateSelectionBox(x, y, width, height);
}

function handleMouseUp(e) {
  if (!isSelectorsActive) return;

  isSelectorsActive = false;
  selectionBoxElement.style.display = 'none';

  // Re-enable Map Dragging
  map.dragging.enable();
  if (map.boxZoom) map.boxZoom.enable();

  // Perform Final Selection Logic
  const mapContainer = map.getContainer();
  const rect = mapContainer.getBoundingClientRect();
  const endX = e.clientX - rect.left;
  const endY = e.clientY - rect.top;

  // If drag was very small, treat as click and let standard Shift+Click handler work? 
  // Standard Shift+Click is handled by Leaflet layer click.
  // We should only process BLOCK selection if distance > threshold.
  const dist = Math.sqrt(Math.pow(endX - startSelectionPoint.x, 2) + Math.pow(endY - startSelectionPoint.y, 2));

  if (dist < 5) {
    // It was just a click. Leaflet's 'click' event on the layer will handle it.
    // We do nothing here to avoid double-processing or clearing.
    // But wait: mousedown preventDefault() might have blocked it?
    // No, we only prevented default text selection. Leaflet events usually fire.
    return;
  }

  // Convert pixel Bounds to LatLng Bounds
  const b = selectionBoxElement.getBoundingClientRect();
  // Relative to viewport, but we need points relative to map container for containerPointToLatLng.
  // Actually, easier: use the start/end points we tracked relative to container.

  const minX = Math.min(startSelectionPoint.x, endX);
  const maxX = Math.max(startSelectionPoint.x, endX);
  const minY = Math.min(startSelectionPoint.y, endY);
  const maxY = Math.max(startSelectionPoint.y, endY);

  const p1 = L.point(minX, minY);
  const p2 = L.point(maxX, maxY);

  const bounds = L.latLngBounds(
    map.containerPointToLatLng(p1),
    map.containerPointToLatLng(p2)
  );

  // Identify features inside bounds
  selectFeaturesInBounds(bounds);
}

function updateSelectionBox(x, y, w, h) {
  selectionBoxElement.style.left = x + 'px';
  selectionBoxElement.style.top = y + 'px';
  selectionBoxElement.style.width = w + 'px';
  selectionBoxElement.style.height = h + 'px';
}

function selectFeaturesInBounds(bounds) {
  if (!currentLayer) return;

  let addedCount = 0;

  // Recursive helper to find features in bounds
  const findInBounds = (layerNode) => {
    if (!layerNode) return;

    // If it's a marker/point with position
    if (layerNode.getLatLng) {
      if (bounds.contains(layerNode.getLatLng())) {
        const props = layerNode.feature && layerNode.feature.properties;
        if (props) {
          const id = resolveFeatureSelectionId(props);
          if (id) {
            selectedLocationIDs.add(id);
            addedCount++;
          }
        }
      }
    }
    // If it's a group (LayerGroup or GeoJSON)
    else if (layerNode.eachLayer) {
      layerNode.eachLayer(child => findInBounds(child));
    }
  };

  findInBounds(currentLayer);

  if (addedCount > 0) {
    isDragSelection = true;
    updateSelectionUI(false); // Treat as manual selection
    // Force style update for newly selected items
    if (currentLayer && currentLayer.resetStyle) currentLayer.resetStyle();
  }
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
    return `Idade ${f.idadeMode}: Acima de ${f.idadeVal}% dos eleitores`;
  }

  // 4. Filtro de Gênero
  if (f.generoVal > 0) {
    const label = f.generoMode.replace('Pct ', ''); // "Mulheres" ou "Homens"
    return `Gênero (${label}): Acima de ${f.generoVal}%`;
  }

  // 5. Filtro de Escolaridade
  if (f.escolaridadeVal > 0) {
    return `Escolaridade (${f.escolaridadeMode}): Acima de ${f.escolaridadeVal}%`;
  }

  // 6. Filtro de Estado Civil
  if (f.estadoCivilVal > 0) {
    return `Estado Civil (${f.estadoCivilMode}): Acima de ${f.estadoCivilVal}%`;
  }

  // 7. Filtro de Saneamento
  if (f.saneamentoVal > 0) {
    const label = f.saneamentoMode.replace('Pct ', '');
    return `Saneamento (${label}): Acima de ${f.saneamentoVal}%`;
  }

  return null; // Nenhum filtro censitário ativo
}
