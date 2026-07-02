// Local helper to delegate to window.toTitleCase to prevent global scope resolution issues
function safeToTitleCase(str) {
  const fn = window.toTitleCase;
  return fn ? fn(str) : (str || '');
}

// Cache para resolver coligações/federações em loops de renderização (Performance)
const _proportionalGroupCache = new WeakMap();

// Memoização por candidato do resultado de resolveProportionalGroupInfo.
// A resolução é determinística para um dado (metaStore, candidateId) — o
// prefixCache e o metaStore permanecem estáveis durante a sessão e o metaStore
// é substituído por um objeto novo ao trocar federal/estadual ou recarregar
// (mesma premissa de _proportionalGroupCache). Sem cache, esta função (com
// regex/normalização/localeCompare) era reexecutada milhões de vezes por redraw.
const _proportionalGroupInfoCache = new WeakMap(); // metaStore -> Map(candidateId -> info)

// Cache de 2º nível do lookup de cores escopado, chaveado pela REFERÊNCIA do
// resultStore (STATE.deputyResults/vereadorResults). O lookup é determinístico
// sobre os dados carregados + (cargo|tipo|inaptos) e NÃO depende da seleção,
// porém updateSelectionUI/clearSelection invalidam o cache de 1º nível a cada
// seleção — o que forçava um rescan estadual completo (SP inteiro) por operação.
// O resultStore só é substituído por um objeto novo no reload, então este cache
// sobrevive às invalidações de seleção e recomputa apenas quando os dados mudam.
const _scopedColorLookupByStore = new WeakMap(); // resultStore -> Map(cacheKey -> lookup)

// Converte a lista de inaptos (array estável até o reload) em Set para lookup
// O(1). Antes era feito `(...).includes(cand)` por candidato dentro dos loops,
// custo O(inaptos) por candidato. O cache é por referência do array, então não
// realoca a cada redraw.
const _inaptosSetCache = new WeakMap();
const _EMPTY_SET = new Set();
function inaptosArrayToSet(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return _EMPTY_SET;
  let s = _inaptosSetCache.get(arr);
  if (!s) {
    s = new Set(arr);
    _inaptosSetCache.set(arr, s);
  }
  return s;
}

function getResolvedPrefixCacheForMetaStore(metaStore, prefixCache = null) {
  if (prefixCache && Object.keys(prefixCache).length > 0) return prefixCache;

  if (metaStore === STATE.vereadorMetadata) {
    ensurePartyPrefixCache(true);
    return STATE._vereadorPartyPrefixCache || {};
  }

  ensurePartyPrefixCache(false);
  return STATE._partyPrefixCache || {};
}

function isGenericProportionalGroupLabel(value) {
  const normalized = norm(String(value || '')).replace(/\s+/g, '');
  return !normalized || normalized === 'PARTIDOISOLADO' || normalized === 'FEDERACAO' || normalized === 'COLIGACAO';
}

function normalizeProportionalPartyToken(value, prefixCache = {}) {
  let token = String(value || '').trim();
  if (!token) return '';

  token = token.replace(/[()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  token = token.replace(/^[\s\-–—]+|[\s\-–—]+$/g, '').trim();
  token = token.replace(/^FEDERA[CÇ][AÃ]O\s+/i, '').trim();
  token = token.replace(/^COLIGA[CÇ][AÃ]O\s+/i, '').trim();

  const genericPartyMatch = token.match(/^PARTIDO\s+(\d{1,2})$/i);
  if (genericPartyMatch) {
    const partyCode = genericPartyMatch[1];
    return normalizePartyAlias(prefixCache?.[partyCode] || token);
  }

  if (/^\d{1,2}$/.test(token)) {
    return normalizePartyAlias(prefixCache?.[token] || token);
  }

  if (isGenericProportionalGroupLabel(token)) return '';
  return normalizePartyAlias(token);
}

function extractProportionalCompositionParts(rawComposition, rawGroupName, prefixCache = {}) {
  const candidates = [rawComposition, rawGroupName];
  let compositionSource = '';

  for (const candidate of candidates) {
    const text = String(candidate || '').trim();
    if (!text) continue;

    const parentheticalMatches = Array.from(text.matchAll(/\(([^()]+)\)/g))
      .map((match) => String(match[1] || '').trim())
      .filter((part) => part.includes('/'));

    if (parentheticalMatches.length) {
      compositionSource = parentheticalMatches[parentheticalMatches.length - 1];
      break;
    }

    if (text.includes('/')) {
      compositionSource = text;
      break;
    }
  }

  const members = (compositionSource || rawComposition || '')
    .split('/')
    .map((part) => normalizeProportionalPartyToken(part, prefixCache))
    .filter(Boolean);

  const uniqueMembers = Array.from(new Set(members));
  const compositionDisplay = uniqueMembers.join('/');
  const compositionKey = uniqueMembers
    .slice()
    .sort((left, right) => left.localeCompare(right, 'pt-BR'))
    .join('/');

  return {
    members: uniqueMembers,
    compositionDisplay,
    compositionKey,
    isGroup: uniqueMembers.length > 1
  };
}

function getPreferredProportionalGroupName(rawGroupName, rawComposition, compositionDisplay) {
  const groupName = String(rawGroupName || '').trim();
  const compositionText = String(rawComposition || '').trim();
  let candidate = !isGenericProportionalGroupLabel(groupName) ? groupName : compositionText;

  if (!candidate) return compositionDisplay;

  if (candidate.includes('(')) {
    candidate = candidate.slice(0, candidate.indexOf('(')).trim();
  }

  candidate = candidate.replace(/^FEDERA[CÇ][AÃ]O\s+/i, '').trim();
  candidate = candidate.replace(/^COLIGA[CÇ][AÃ]O\s+/i, '').trim();
  candidate = candidate.replace(/\s*-\s*$/g, '').trim();

  const candidateUpper = candidate.toUpperCase();
  if (candidateUpper.includes('BRASIL DA ESPERAN')) return 'FE Brasil';
  if (candidateUpper.includes('PSDB CIDADANIA') || candidateUpper.includes('PSDB/CIDADANIA')) return 'PSDB/CIDADANIA';
  if (candidateUpper.includes('PSOL REDE') || candidateUpper.includes('PSOL/REDE')) return 'PSOL/REDE';

  if (!candidate || isGenericProportionalGroupLabel(candidate) || candidate.includes('/')) {
    return compositionDisplay;
  }

  return candidate;
}

function getCachedGroupedProportionalInfo(metaStore) {
  if (!metaStore) return new Map();
  if (_proportionalGroupCache.has(metaStore)) {
    return _proportionalGroupCache.get(metaStore);
  }

  const grouped = new Map(); // Map<SiglaOuComposicao, Info>
  const prefixCache = getResolvedPrefixCacheForMetaStore(metaStore);

  Object.entries(metaStore).forEach(([id, meta]) => {
    // Pula votos de legenda no loop de construção do mapa de grupos
    if (id.length <= 2) return;
    
    const rawComposition = String(meta[4] || '').trim();
    const rawGroupName = String(meta[3] || '').trim();
    const compositionParts = extractProportionalCompositionParts(rawComposition, rawGroupName, prefixCache);
    if (!compositionParts.isGroup || !compositionParts.compositionKey) return;

    const info = {
      key: `group:${norm(compositionParts.compositionKey)}`,
      name: getPreferredProportionalGroupName(rawGroupName, rawComposition, compositionParts.compositionDisplay),
      composition: compositionParts.compositionDisplay,
      isGroup: true
    };

    // Indexa por composição e por sigla dos membros (para lookup de legenda)
    grouped.set(compositionParts.compositionDisplay, info);
    grouped.set(compositionParts.compositionKey, info);
    compositionParts.members.forEach((sigla) => {
      if (!grouped.has(sigla)) grouped.set(sigla, info);
    });
  });

  _proportionalGroupCache.set(metaStore, grouped);
  return grouped;
}

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
  return `${safeToTitleCase(candidateData.nome)} (${candidateData.partido}) • Nº ${candidateData.numero}`;
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

    // Lookup local_id â†’ chave (zona_local para vereador, zona_muni_local para deputado)
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

  // Add placeholder option
  const placeholderOpt = document.createElement('option');
  placeholderOpt.value = '__placeholder__';
  placeholderOpt.textContent = 'Selecione um candidato...';
  placeholderOpt.disabled = true;
  dom.selectVizCandidato.appendChild(placeholderOpt);

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

  // Only pre-select if there was a previous valid selection; otherwise show placeholder
  if (dom.selectVizCandidato.options.length > 1) {
    const hasPrevious = previousValue && previousValue !== '__placeholder__' &&
      Array.from(dom.selectVizCandidato.options).some(opt => opt.value === previousValue);
    dom.selectVizCandidato.value = hasPrevious ? previousValue : '__placeholder__';
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

const MUNICIPAL_POLYGON_CACHE = new Map();

function getMunicipalityFeatureCode(props) {
  if (!props) return '';
  return String(
    props.CD_MUN ||
    props.cd_mun ||
    props.CD_IBGE ||
    props.cd_ibge ||
    props.cod_localidade_ibge ||
    props.CD_LOCALIDADE_IBGE ||
    props.NR_LOCALIDADE_IBGE ||
    props.id ||
    ''
  ).trim();
}

function getMunicipalityFeatureName(props) {
  if (!props) return 'Município';
  return String(
    props.NM_MUN ||
    props.nm_mun ||
    props.municipio ||
    props.nm_localidade ||
    props.NOME ||
    'Município'
  ).trim();
}

function getCurrentMunicipalMapSelection() {
  let selectedName = '';
  let selectedCode = '';

  if (STATE.currentElectionType === 'municipal') {
    selectedName = String(dom.selectMunicipio?.value || '').trim();
    selectedCode = String(STATE.currentMuniCode || '').trim();
  } else if (STATE.currentElectionType === 'geral' && STATE.currentMapMuniUF) {
    selectedName = currentCidadeFilter !== 'all' ? String(currentCidadeFilter || '').trim() : '';
  } else {
    return null;
  }

  if (!selectedName) return null;

  return {
    name: selectedName,
    slug: normalizeMunicipioSlug(selectedName),
    code: selectedCode
  };
}

function isSelectedMunicipalFeature(props, selection = getCurrentMunicipalMapSelection()) {
  if (!props || !selection) return false;

  const featureName = getMunicipalityFeatureName(props);
  if (selection.name && featureName) {
    if (typeof matchesMunicipioName === 'function') {
      if (matchesMunicipioName(selection.name, featureName)) return true;
    }
  }

  const featureSlug = normalizeMunicipioSlug(featureName);
  if (selection.slug && featureSlug) {
    if (featureSlug === selection.slug) return true;
  }

  const featureCode = getMunicipalityFeatureCode(props);
  if (selection.code && featureCode && selection.code === featureCode) {
    return true;
  }

  return false;
}

function findSelectedMunicipalityFeature(selection = getCurrentMunicipalMapSelection()) {
  const features = STATE.municipiosLayer?.fc?.features;
  if (!selection || !Array.isArray(features)) return null;

  return features.find((feature) =>
    feature?.properties && isSelectedMunicipalFeature(feature.properties, selection)
  ) || null;
}

function setPendingMunicipalFocusBounds(feature) {
  const bounds = feature ? MLCompat.featureBounds(feature) : null;
  if (!bounds?.isValid?.()) {
    STATE.pendingMunicipalFocusBounds = null;
    return false;
  }

  const southWest = bounds.getSouthWest();
  const northEast = bounds.getNorthEast();

  STATE.pendingMunicipalFocusBounds = {
    south: southWest.lat,
    west: southWest.lng,
    north: northEast.lat,
    east: northEast.lng
  };

  return true;
}

function focusSelectedMunicipalityOnMap(options = {}) {
  if (!map) return false;

  let bounds = null;
  if (options.preferPending !== true) {
    const feature = findSelectedMunicipalityFeature();
    bounds = feature ? MLCompat.featureBounds(feature) : null;
  }
  if (!bounds?.isValid?.()) {
    const pending = STATE.pendingMunicipalFocusBounds;
    if (pending) {
      bounds = MLCompat.featureCollectionBounds([{
        type: 'Feature',
        geometry: {
          type: 'MultiPoint',
          coordinates: [[pending.west, pending.south], [pending.east, pending.north]]
        }
      }]);
    }
  }
  if (!bounds?.isValid?.()) return false;

  return MLCompat.fitMapToBounds(map, bounds, {
    animate: options.animate ?? true,
    duration: options.duration ?? 0.6,
    padding: options.padding || [36, 36],
    maxZoom: options.maxZoom || 14
  });
}

// A tooltip e a interatividade do município selecionado passam a ser tratadas
// dinamicamente pela GeoLayer (tooltipFn retorna null para o selecionado e o
// onClick ignora cliques no selecionado quando em modo 'locais').

function refreshMunicipalSelectionOverlay({ focus = false } = {}) {
  if (!STATE.municipiosLayer?.refresh) return false;

  // getMunicipalPolygonStyle já reflete a seleção atual, então um refresh
  // (recomputa props + setData) atualiza o destaque do município selecionado.
  STATE.municipiosLayer.refresh();

  if (focus) {
    focusSelectedMunicipalityOnMap();
  }

  return true;
}

function refreshGeneralMunicipalityOverviewLayer({ syncResults = false } = {}) {
  const uf = String(STATE.currentMapMuniUF || dom.selectUFGeneral?.value || '').toUpperCase();
  if (!uf || uf === 'BR' || STATE.currentElectionType !== 'geral') return false;
  if (!STATE.municipiosLayer || !map?.hasLayer?.(STATE.municipiosLayer)) return false;

  STATE.currentMapMuniUF = uf;
  const preservedCidade = currentCidadeFilter;
  const preservedBairro = currentBairroFilter;
  const preservedLocal = currentLocalFilter;
  try {
    currentCidadeFilter = 'all';
    currentBairroFilter = 'all';
    currentLocalFilter = '';
    STATE.currentMapMuniSummary = buildGeneralMunicipalityOverviewSummary(currentCargo);
  } finally {
    currentCidadeFilter = preservedCidade;
    currentBairroFilter = preservedBairro;
    currentLocalFilter = preservedLocal;
  }

  STATE.municipiosLayer.refresh();
  refreshMunicipalSelectionOverlay();

  if (syncResults) {
    renderGeneralStatewideMunicipalityResults(STATE.currentMapMuniSummary, uf);
  }

  return true;
}

const PROPORTIONAL_PARTY_GROUP_CACHE = new WeakMap();

function getGroupedProportionalInfoByParty(metaStore) {
  if (!metaStore || typeof metaStore !== 'object') return new Map();
  if (PROPORTIONAL_PARTY_GROUP_CACHE.has(metaStore)) {
    return PROPORTIONAL_PARTY_GROUP_CACHE.get(metaStore);
  }

  const partyGroups = new Map();

  Object.entries(metaStore).forEach(([candidateId, meta]) => {
    if (String(candidateId || '').trim().length <= 2) return;

    const rawParty = normalizePartyAlias(String(meta?.[1] || '').toUpperCase());
    const rawCoalitionName = String(meta?.[3] || '').trim();
    const rawComposition = String(meta?.[4] || '').trim();
    const normalizedComposition = rawComposition
      .split('/')
      .map((value) => normalizePartyAlias(value.trim().toUpperCase()))
      .filter(Boolean)
      .join('/');

    const hasGroupedComposition = normalizedComposition && normalizedComposition.includes('/');
    const validCoalitionName = rawCoalitionName
      && !/^PARTIDO ISOLADO$/i.test(rawCoalitionName)
      && !/^FEDERACAO$/i.test(norm(rawCoalitionName))
      && !/^COLIGACAO$/i.test(norm(rawCoalitionName));

    if (!rawParty || !hasGroupedComposition || partyGroups.has(rawParty)) return;

    partyGroups.set(rawParty, {
      key: `group:${norm(normalizedComposition)}`,
      name: validCoalitionName ? rawCoalitionName : rawComposition,
      composition: rawComposition,
      party: rawParty,
      isGroup: true
    });
  });

  PROPORTIONAL_PARTY_GROUP_CACHE.set(metaStore, partyGroups);
  return partyGroups;
}

const STATIC_PARTY_FALLBACK = {
  '10': 'REPUBLICANOS', '11': 'PP', '12': 'PDT', '13': 'PT', '14': 'PTB', '15': 'MDB',
  '16': 'PSTU', '17': 'PSL', '18': 'REDE', '19': 'PODE', '20': 'PSC', '21': 'PCB',
  '22': 'PL', '23': 'CIDADANIA', '25': 'DEM', '27': 'DC', '28': 'PRTB', '29': 'PCO',
  '30': 'NOVO', '31': 'PHS', '33': 'PMN', '35': 'PMB', '36': 'AGIR', '40': 'PSB',
  '43': 'PV', '44': 'UNIÃO', '45': 'PSDB', '50': 'PSOL', '51': 'PATRIOTA', '55': 'PSD',
  '65': 'PC DO B', '70': 'AVANTE', '77': 'SOLIDARIEDADE', '80': 'UP', '90': 'PROS'
};

/**
 * Centraliza a construção do cache de siglas de partidos por prefixo (o 'XX' de 'XXYYYY').
 */
function ensurePartyPrefixCache(isVereador = false) {
  const cacheKey = isVereador ? '_vereadorPartyPrefixCache' : '_partyPrefixCache';
  const metaStore = isVereador ? STATE.vereadorMetadata : STATE.deputyMetadata;
  
  if (!STATE[cacheKey]) {
    // Começa com o fallback estático para garantir cobertura mínima
    STATE[cacheKey] = { ...STATIC_PARTY_FALLBACK };
    if (!metaStore) return;
    
    for (const [cid, cmeta] of Object.entries(metaStore)) {
      // Candidatos reais (IDs > 2) costumam ter o partido real no metadado
      if (cid.length > 2 && cmeta && cmeta[1]) {
        const partyName = String(cmeta[1]).toUpperCase().trim();
        // Se o partido no metadado não for um genérico "PARTIDO 11", guardamos a sigla
        if (partyName && !partyName.startsWith('PARTIDO ')) {
          const prefix = cid.substring(0, 2);
          // O metadata dinâmico tem precedência sobre o fallback estático (para anos antigos)
          STATE[cacheKey][prefix] = partyName;
        }
      }
    }
  }
}

function resolveProportionalGroupInfo(candidateId, metaStore, prefixCache) {
  const candidateKey = String(candidateId || '').trim();
  if (!metaStore) {
    return _computeProportionalGroupInfo(candidateKey, metaStore, prefixCache);
  }
  let perStore = _proportionalGroupInfoCache.get(metaStore);
  if (!perStore) {
    perStore = new Map();
    _proportionalGroupInfoCache.set(metaStore, perStore);
  }
  const cached = perStore.get(candidateKey);
  if (cached !== undefined) return cached;
  const info = _computeProportionalGroupInfo(candidateKey, metaStore, prefixCache);
  perStore.set(candidateKey, info);
  return info;
}

function _computeProportionalGroupInfo(candidateKey, metaStore, prefixCache) {
  const meta = metaStore?.[candidateKey] || null;
  const resolvedPrefixCache = getResolvedPrefixCacheForMetaStore(metaStore, prefixCache);

  const tryResolveGenericParty = (name, code) => {
    let p = String(name || '').toUpperCase().trim();
    if (p.startsWith('PARTIDO ') || p.match(/^PARTIDO\d+$/)) {
      const resolved = resolvedPrefixCache?.[code];
      if (resolved) return resolved;
    }
    return p;
  };

  if (candidateKey.length <= 2) {
    const rawLegendName = resolvedPrefixCache?.[candidateKey] || meta?.[1] || candidateKey;
    const legendParty = normalizeProportionalPartyToken(tryResolveGenericParty(rawLegendName, candidateKey), resolvedPrefixCache) || candidateKey;
    const groupedPartyInfo = getCachedGroupedProportionalInfo(metaStore).get(legendParty);
    if (groupedPartyInfo) {
      return {
        ...groupedPartyInfo,
        party: legendParty
      };
    }
    return {
      key: `party:${legendParty}`,
      name: legendParty,
      composition: legendParty,
      party: legendParty,
      isGroup: false
    };
  }

  const rawParty = normalizeProportionalPartyToken(
    tryResolveGenericParty(meta?.[1] || candidateKey.substring(0, 2), candidateKey.substring(0, 2)),
    resolvedPrefixCache
  ) || candidateKey.substring(0, 2);
  const rawCoalitionName = String(meta?.[3] || '').trim();
  const rawComposition = String(meta?.[4] || '').trim();
  const compositionParts = extractProportionalCompositionParts(rawComposition, rawCoalitionName, resolvedPrefixCache);

  if (!compositionParts.isGroup) {
    const globalGroupInfo = getCachedGroupedProportionalInfo(metaStore).get(rawParty);
    if (globalGroupInfo) {
      return {
        ...globalGroupInfo,
        party: rawParty
      };
    }
  }

  if (compositionParts.isGroup) {
    return {
      key: `group:${norm(compositionParts.compositionKey)}`,
      name: getPreferredProportionalGroupName(rawCoalitionName, rawComposition, compositionParts.compositionDisplay),
      composition: compositionParts.compositionDisplay,
      party: rawParty,
      isGroup: true
    };
  }

  return {
    key: `party:${rawParty}`,
    name: rawParty || rawComposition || rawCoalitionName || candidateKey,
    composition: rawParty || rawComposition || rawCoalitionName || candidateKey,
    party: rawParty,
    isGroup: false
  };
}

function aggregateProportionalVotesByList(votesMap, metaStore, prefixCache, options = {}) {
  const resolvedPrefixCache = getResolvedPrefixCacheForMetaStore(metaStore, prefixCache);
  const shouldFilterInaptos = options.filterInaptos === true;
  const inaptosSet = shouldFilterInaptos ? inaptosArrayToSet(options.inaptosList) : null;
  // winnerOnly: no caminho de estilo do mapa só precisamos de votos/cor/% por
  // grupo — a lista ordenada de candidatos (alocação por candidato + sort) nunca
  // é lida ali, então pulamos esse trabalho. Demais consumidores recebem a
  // lista completa como antes.
  const winnerOnly = options.winnerOnly === true;
  const groups = new Map();
  let total = 0;

  Object.entries(votesMap || {}).forEach(([candidateId, rawVotes]) => {
    if (candidateId === '95' || candidateId === '96') return;
    if (inaptosSet && inaptosSet.has(candidateId)) return;
    const votes = ensureNumber(rawVotes);
    if (votes <= 0) return;

    const groupInfo = resolveProportionalGroupInfo(candidateId, metaStore, resolvedPrefixCache);
    const existing = groups.get(groupInfo.key) || {
      ...groupInfo,
      votes: 0,
      parties: new Map(),
      candidates: []
    };

    existing.votes += votes;
    existing.parties.set(groupInfo.party, (existing.parties.get(groupInfo.party) || 0) + votes);

    if (!winnerOnly && candidateId.length > 2) {
      const meta = metaStore?.[candidateId] || null;
      existing.candidates.push({
        id: candidateId,
        nome: meta?.[0] || candidateId,
        partido: groupInfo.party,
        status: meta?.[2] || '',
        votos: votes
      });
    }

    groups.set(groupInfo.key, existing);
    total += votes;
  });

  const results = Array.from(groups.values()).map((group) => {
    let dominantParty = group.party;
    let dominantVotes = -1;
    group.parties.forEach((votes, party) => {
      if (votes > dominantVotes) {
        dominantVotes = votes;
        dominantParty = party;
      }
    });

    if (!winnerOnly) group.candidates.sort((a, b) => b.votos - a.votos);
    const colorPartyKey = options.colorKeyLookup?.get(group.key)
      || getProportionalListColorKey(group.name, group.composition, dominantParty);
    return {
      ...group,
      color: colorForParty(colorPartyKey),
      party: dominantParty,
      colorPartyKey
    };
  }).sort((a, b) => b.votes - a.votes);

  return { groups: results, total };
}

function getWinningProportionalListData(votesMap, type = 'deputado') {
  const isVereadorList = type === 'vereador';
  const metaStore = isVereadorList ? STATE.vereadorMetadata : STATE.deputyMetadata;
  const prefixCache = getResolvedPrefixCacheForMetaStore(
    metaStore,
    isVereadorList ? STATE._vereadorPartyPrefixCache : STATE._partyPrefixCache
  );
  const inaptosList = isVereadorList
    ? (STATE.inaptos['vereador_ord']?.['1T'] || [])
    : (STATE.inaptos[currentCargo]?.['1T'] || []);
  const aggregated = aggregateProportionalVotesByList(
    votesMap,
    metaStore,
    prefixCache,
    {
      colorKeyLookup: getScopedProportionalColorKeyLookup(type, currentCargo),
      filterInaptos: STATE.filterInaptos,
      inaptosList,
      winnerOnly: true
    }
  );
  const winner = aggregated.groups[0] || null;
  if (!winner) return null;
  return {
    ...winner,
    total: aggregated.total,
    pct: aggregated.total > 0 ? (winner.votes / aggregated.total) * 100 : 0,
    marginPct: getWinningMarginPct(aggregated.groups.map((group) => group.votes), aggregated.total)
  };
}

function invalidateScopedProportionalColorLookup() {
  STATE._scopedProportionalColorLookupCache = null;
  STATE._scopedProportionalColorScopeVersion = (STATE._scopedProportionalColorScopeVersion || 0) + 1;
}

function getProportionalResultKeyFromProps(props, isVereador = false) {
  if (!props) return '';

  const zona = parseInt(getProp(props, 'nr_zona'), 10);
  const local = parseInt(getProp(props, 'nr_locvot') || getProp(props, 'nr_local_votacao'), 10);
  if (Number.isNaN(zona) || Number.isNaN(local)) return '';

  if (isVereador) {
    return `${zona}_${local}`;
  }

  const municipio = parseInt(getProp(props, 'cd_localidade_tse') || getProp(props, 'CD_MUNICIPIO'), 10);
  if (Number.isNaN(municipio)) return '';
  return `${zona}_${municipio}_${local}`;
}

function getScopedProportionalColorCacheKey(type = 'deputado', cargoKey = currentCargo) {
  return `${cargoKey}|${type}|${STATE.filterInaptos ? 'inaptos' : 'todos'}`;
}

function getScopedProportionalColorKeyLookup(type = 'deputado', cargoKey = currentCargo) {
  const cacheKey = getScopedProportionalColorCacheKey(type, cargoKey);
  const cached = STATE._scopedProportionalColorLookupCache;
  if (cached?.key === cacheKey && cached.lookup instanceof Map) {
    return cached.lookup;
  }

  const isVereadorList = type === 'vereador' || String(cargoKey || '').startsWith('vereador');
  const resultStore = isVereadorList ? STATE.vereadorResults : STATE.deputyResults;
  const metaStore = isVereadorList ? STATE.vereadorMetadata : STATE.deputyMetadata;

  // Tier 2: reaproveita o lookup já computado para este resultStore+cacheKey,
  // mesmo após invalidações de seleção (que apenas zeram o cache de 1º nível).
  if (resultStore) {
    const perStore = _scopedColorLookupByStore.get(resultStore);
    const hit = perStore && perStore.get(cacheKey);
    if (hit) {
      STATE._scopedProportionalColorLookupCache = { key: cacheKey, lookup: hit };
      return hit;
    }
  }

  const prefixCache = getResolvedPrefixCacheForMetaStore(
    metaStore,
    isVereadorList ? STATE._vereadorPartyPrefixCache : STATE._partyPrefixCache
  );
  const lookup = new Map();

  if (!resultStore || !metaStore) {
    // Não persiste no Tier 2: dados ainda incompletos (ex.: metaStore não pronto).
    STATE._scopedProportionalColorLookupCache = { key: cacheKey, lookup };
    return lookup;
  }

  const inaptos = isVereadorList
    ? (STATE.inaptos['vereador_ord']?.['1T'] || [])
    : (STATE.inaptos[cargoKey]?.['1T'] || []);
  const inaptosSet = STATE.filterInaptos ? inaptosArrayToSet(inaptos) : null;
  const groups = new Map();
  const typeKey = isVereadorList ? 'v' : (String(cargoKey || '').includes('estadual') ? 'e' : 'f');

  // Always compute coalition colors over all loaded results in the entire election (state-wide or city-wide)
  Object.keys(resultStore).forEach((key) => {
    const votesMap = resultStore[key]?.[typeKey];
    if (!votesMap) return;

    Object.entries(votesMap).forEach(([candidateId, rawVotes]) => {
      if (candidateId === '95' || candidateId === '96') return;
      if (inaptosSet && inaptosSet.has(candidateId)) return;

      const votes = ensureNumber(rawVotes);
      if (votes <= 0) return;

      const groupInfo = resolveProportionalGroupInfo(candidateId, metaStore, prefixCache);
      const group = groups.get(groupInfo.key) || {
        ...groupInfo,
        parties: new Map()
      };

      group.parties.set(groupInfo.party, (group.parties.get(groupInfo.party) || 0) + votes);
      groups.set(groupInfo.key, group);
    });
  });

  groups.forEach((group) => {
    let dominantParty = group.party;
    let dominantVotes = -1;
    group.parties.forEach((votes, party) => {
      if (votes > dominantVotes) {
        dominantVotes = votes;
        dominantParty = party;
      }
    });

    const colorPartyKey = getProportionalListColorKey(group.name, group.composition, dominantParty);
    lookup.set(group.key, colorPartyKey);
  });

  STATE._scopedProportionalColorLookupCache = { key: cacheKey, lookup };
  // Persiste no Tier 2 apenas lookups não-vazios: um resultado vazio indica
  // dados ainda não carregados (resultStore recém-criado e populado in place),
  // e cacheá-lo por referência poderia devolver vazio após a carga concluir.
  if (lookup.size > 0) {
    let perStore = _scopedColorLookupByStore.get(resultStore);
    if (!perStore) {
      perStore = new Map();
      _scopedColorLookupByStore.set(resultStore, perStore);
    }
    perStore.set(cacheKey, lookup);
  }
  return lookup;
}

function getWinningMarginPct(voteTotals, totalVotes) {
  const safeTotal = ensureNumber(totalVotes);
  if (safeTotal <= 0) return 20;

  const orderedVotes = (voteTotals || [])
    .map((vote) => ensureNumber(vote))
    .filter((vote) => vote > 0)
    .sort((a, b) => b - a);

  if (!orderedVotes.length) return 20;

  const winnerVotes = orderedVotes[0];
  const runnerUpVotes = orderedVotes[1] || 0;
  return ((winnerVotes - runnerUpVotes) / safeTotal) * 100;
}

function getMajoritarianMarginPct(props, turnoKey, totalValidos) {
  const candidateVotes = Object.entries(props || {})
    .filter(([key]) => key.endsWith(` ${turnoKey}`) && isCandidateVoteKey(key))
    .map(([, value]) => ensureNumber(value));

  return getWinningMarginPct(candidateVotes, totalValidos);
}

function formatTooltipDisplayName(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return safeToTitleCase(text);
}

function formatTooltipCaps(value) {
  return String(value || '').trim().toUpperCase();
}

function buildLocationTooltip(feature) {
  const props = feature.properties || {};
  const nomeLocal = formatTooltipCaps(getProp(props, 'nm_locvot') || 'Local');
  const nomeCidade = formatTooltipDisplayName(getProp(props, 'nm_localidade') || 'Cidade');
  const turnoKey = (currentTurno === 2 && STATE.dataHas2T[currentCargo]) ? '2T' : '1T';
  const turnoLabel = (turnoKey === '2T') ? '2º Turno' : '1º Turno';
  const isProportional = currentCargo.startsWith('deputado') || currentCargo.startsWith('vereador');
  const headerName = isProportional ? 'Partido' : 'Candidato';

  let totalValidos = 0;
  let rowsData = [];

  if (isProportional) {
    const proportionalType = currentCargo.startsWith('vereador') ? 'vereador' : 'deputado';
    const proportionalData = currentCargo.startsWith('vereador')
      ? getVereadorFeatureData(props)
      : getDeputyFeatureData(props);
    const grouped = proportionalData?.votes
      ? aggregateProportionalVotesByList(
        proportionalData.votes,
        currentCargo.startsWith('vereador') ? STATE.vereadorMetadata : STATE.deputyMetadata,
        currentCargo.startsWith('vereador') ? STATE._vereadorPartyPrefixCache : STATE._partyPrefixCache,
        {
          colorKeyLookup: getScopedProportionalColorKeyLookup(proportionalType, currentCargo),
          filterInaptos: STATE.filterInaptos,
          inaptosList: currentCargo.startsWith('vereador')
            ? (STATE.inaptos['vereador_ord']?.['1T'] || [])
            : (STATE.inaptos[currentCargo]?.['1T'] || [])
        }
      )
      : { groups: [], total: 0 };

    totalValidos = grouped.total || 0;
    grouped.groups.slice(0, 4).forEach((group) => {
      const pct = totalValidos > 0 ? (group.votes / totalValidos) * 100 : 0;
      rowsData.push({
        name: formatTooltipCaps(group.name),
        color: group.color,
        votes: group.votes,
        pct: pct
      });
    });
  } else {
    const { totalValidos: votosValidos } = getVotosValidos(props, currentCargo, turnoKey, STATE.filterInaptos);
    totalValidos = votosValidos;
    const candidateRows = Object.keys(props)
      .filter((key) => key.endsWith(` ${turnoKey}`) && isCandidateVoteKey(key))
      .filter((key) => !STATE.filterInaptos || !(STATE.inaptos[currentCargo]?.[turnoKey] || []).includes(key))
      .map((key) => {
        const info = parseCandidateKey(key);
        return {
          key,
          name: info.nome,
          party: info.partido,
          votes: ensureNumber(getProp(props, key))
        };
      })
      .filter((candidate) => candidate.votes > 0)
      .sort((a, b) => b.votes - a.votes)
      .slice(0, 4);

    candidateRows.forEach((candidate) => {
      const pct = totalValidos > 0 ? (candidate.votes / totalValidos) * 100 : 0;
      rowsData.push({
        name: formatTooltipDisplayName(candidate.name),
        color: getColorForCandidate(candidate.name, candidate.party),
        votes: candidate.votes,
        pct: pct
      });
    });
  }

  let rowsHtml = '';
  rowsData.forEach((row) => {
    const cleanName = escapeHtml(row.name);
    const color = row.color || '#cccccc';
    const votesStr = fmtInt(row.votes);
    const pctStr = row.pct.toFixed(1);

    rowsHtml += `
      <tr>
        <td style="padding: 0;">
          <div class="district-nyt-loser-cell" style="border-left-color: ${color};">
            <span style="margin-left: 6px;">${cleanName}</span>
          </div>
        </td>
        <td class="votes-cell">${votesStr}</td>
        <td class="pct-cell">${pctStr}%</td>
      </tr>
    `;
  });

  if (rowsHtml === '') {
    rowsHtml = `<tr><td colspan="3" style="text-align:center;color:#777;padding: 8px;">Sem votos válidos neste local.</td></tr>`;
  }

  return `
    <div class="nyt-tooltip-container" style="font-family: var(--font-main); color: inherit; min-width: 250px;">
      <div class="district-nyt-title">${escapeHtml(nomeLocal)}</div>
      <div style="font-size: 12px; color: #777777; margin-bottom: 6px;">
        ${escapeHtml(nomeCidade)}${turnoLabel ? ` - ${escapeHtml(turnoLabel)}` : ''}
      </div>
      <table class="district-nyt-table">
        <thead>
          <tr>
            <th style="text-align: left;">${headerName}</th>
            <th>Votos</th>
            <th>%</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
      <div style="font-size: 11px; color: #777777; margin-top: 8px;">Votos válidos: ${fmtInt(totalValidos)}</div>
    </div>
  `;
}

function buildMunicipalityTooltip(feature, summary) {
  const nome = formatTooltipDisplayName(getMunicipalityFeatureName(feature?.properties));
  const result = getMunicipalSummaryEntryForFeature(feature?.properties, summary);
  const uf = STATE.currentElectionType === 'municipal'
    ? String(STATE.currentMapMuniUF || dom.selectUFMunicipal?.value || '').toUpperCase()
    : String(STATE.currentMapMuniUF || dom.selectUFGeneral?.value || '').toUpperCase();
  const ufLabel = UF_MAP.get(uf) || uf;

  const isProportional = currentCargo.startsWith('deputado') || currentCargo.startsWith('vereador');
  const scopedColorLookup = isProportional
    ? getScopedProportionalColorKeyLookup(currentCargo.startsWith('vereador') ? 'vereador' : 'deputado', currentCargo)
    : null;
  const headerName = isProportional ? 'Partido' : 'Candidato';

  if (!result) {
    return `
      <div class="nyt-tooltip-container" style="font-family: var(--font-main); color: inherit; min-width: 250px;">
        <div class="district-nyt-title">${escapeHtml(nome)}</div>
        <div style="font-size: 12px; color: #777777; margin-bottom: 2px;">${escapeHtml(ufLabel)}</div>
        <div style="font-size: 11px; color: #777777; margin-bottom: 8px;">Sem resultados resumidos disponíveis.</div>
      </div>
    `;
  }

  let rowsData = [];
  Object.entries(result.votes || {})
    .map(([key, votes]) => {
      let candName = 'N/D';
      let candParty = '';
      let color = '';

      if (key.startsWith('group:') || key.startsWith('party:')) {
        const isVereador = currentCargo.startsWith('vereador');
        const metaStore = isVereador ? STATE.vereadorMetadata : STATE.deputyMetadata;
        const parts = key.split(':');
        const idOrComp = parts[1];
        
        if (key.startsWith('party:')) {
          candName = idOrComp;
          candParty = idOrComp;
          color = colorForParty(
            scopedColorLookup?.get(key)
            || result.groupColorParties?.[key]
            || getProportionalListColorKey(candName, candParty, candParty.split('/')[0].trim())
          );
        } else {
          const groupedInfo = getCachedGroupedProportionalInfo(metaStore);
          const found = groupedInfo.get(idOrComp) || Array.from(groupedInfo.values()).find(info => info.key === key);
          candName = found ? found.name : idOrComp;
          candParty = found ? (found.composition || idOrComp) : idOrComp;
          color = colorForParty(
            scopedColorLookup?.get(key)
            || result.groupColorParties?.[key]
            || getProportionalListColorKey(candName, candParty, candParty.split('/')[0].trim())
          );
        }
      } else {
        const info = parseCandidateKey(key);
        candName = info.nome;
        candParty = info.partido;
        color = getColorForCandidate(candName, candParty);
      }

      return {
        key,
        name: candName,
        party: candParty,
        color: color || getColorForCandidate(candName, candParty),
        votes: ensureNumber(votes)
      };
    })
    .filter((candidate) => candidate.votes > 0)
    .sort((a, b) => b.votes - a.votes)
    .slice(0, 4)
    .forEach((candidate) => {
      const pct = result.totalValid > 0 ? (candidate.votes / result.totalValid) * 100 : 0;
      const rowLabel = (currentCargo.startsWith('deputado') || currentCargo.startsWith('vereador'))
        ? formatTooltipCaps(candidate.name)
        : formatTooltipDisplayName(candidate.name);
      rowsData.push({
        name: rowLabel,
        color: candidate.color,
        votes: candidate.votes,
        pct: pct
      });
    });

  let rowsHtml = '';
  rowsData.forEach((row) => {
    const cleanName = escapeHtml(row.name);
    const color = row.color || '#cccccc';
    const votesStr = fmtInt(row.votes);
    const pctStr = row.pct.toFixed(1);

    rowsHtml += `
      <tr>
        <td style="padding: 0;">
          <div class="district-nyt-loser-cell" style="border-left-color: ${color};">
            <span style="margin-left: 6px;">${cleanName}</span>
          </div>
        </td>
        <td class="votes-cell">${votesStr}</td>
        <td class="pct-cell">${pctStr}%</td>
      </tr>
    `;
  });

  if (rowsHtml === '') {
    rowsHtml = `<tr><td colspan="3" style="text-align:center;color:#777;padding: 8px;">Sem detalhamento disponível.</td></tr>`;
  }

  const showTurn = STATE.dataHas2T?.[currentCargo] || (currentTurno === 2);
  const turnoLabelText = showTurn ? (result.turnoLabel || 'Resultado final') : '';

  return `
    <div class="nyt-tooltip-container" style="font-family: var(--font-main); color: inherit; min-width: 250px;">
      <div class="district-nyt-title">${escapeHtml(nome)}</div>
      <div style="font-size: 12px; color: #777777; margin-bottom: 6px;">
        ${escapeHtml(ufLabel)}${turnoLabelText ? ` - ${escapeHtml(turnoLabelText)}` : ''}
      </div>
      <table class="district-nyt-table">
        <thead>
          <tr>
            <th style="text-align: left;">${headerName}</th>
            <th>Votos</th>
            <th>%</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
      <div style="font-size: 11px; color: #777777; margin-top: 8px;">Votos válidos: ${fmtInt(result.totalValid)}</div>
    </div>
  `;
}

function getMunicipalSummaryEntryForFeature(props, summary) {
  if (!props || !summary) return null;
  const directCode = getMunicipalityFeatureCode(props);
  if (directCode && summary[directCode]) return summary[directCode];

  const nome = getMunicipalityFeatureName(props);
  const aliases = typeof getMunicipioAliasSlugs === 'function'
    ? getMunicipioAliasSlugs(nome)
    : [normalizeMunicipioSlug(nome)];

  return Object.values(summary).find((entry) => {
    const slug = normalizeMunicipioSlug(entry?.nome || '');
    return aliases.includes(slug);
  }) || null;
}

function getActiveTurnoKeyForCurrentCargo(cargoKey = currentCargo) {
  return (currentTurno === 2 && STATE.dataHas2T[cargoKey]) ? '2T' : '1T';
}

function buildDeputyMunicipalSummaryFromRawTotals(rawCityTotals, cargoKey, turnoKey) {
  const metaStore = STATE.deputyMetadata || {};
  const prefixCache = STATE._partyPrefixCache;
  const inaptosTurno = STATE.inaptos?.[cargoKey]?.[turnoKey] || [];
  const turnoLabel = turnoKey === '2T' ? '2º Turno' : '1º Turno';
  const summary = {};

  rawCityTotals.forEach((rawVotes, cityName) => {
    const groupVotes = {};
    let totalValid = 0;

    Object.entries(rawVotes).forEach(([candId, votes]) => {
      if (candId === '95' || candId === '96') return;
      if (STATE.filterInaptos && inaptosTurno.includes(candId)) return;
      const v = ensureNumber(votes);
      if (v <= 0) return;
      const groupInfo = resolveProportionalGroupInfo(candId, metaStore, prefixCache);
      groupVotes[groupInfo.key] = (groupVotes[groupInfo.key] || 0) + v;
      totalValid += v;
    });

    if (totalValid <= 0) return;

    const orderedGroups = Object.entries(groupVotes)
      .sort((a, b) => ensureNumber(b[1]) - ensureNumber(a[1]));
    if (!orderedGroups.length) return;

    const [winnerKey, winnerVotesRaw] = orderedGroups[0];
    const [, secondVotesRaw] = orderedGroups[1] || [null, 0];
    const winnerVotes = ensureNumber(winnerVotesRaw);
    const secondVotes = ensureNumber(secondVotesRaw);

    const winnerParts = winnerKey.split(':');
    const winnerType = winnerParts[0];
    const idOrComp = winnerParts[1];
    let winnerName = idOrComp;
    let winnerParty = '';
    let winnerColorParty = '';

    if (winnerType === 'party') {
      winnerName = idOrComp;
      winnerParty = idOrComp;
      winnerColorParty = getProportionalListColorKey(winnerName, winnerParty, winnerParty);
    } else {
      const groupedInfo = getCachedGroupedProportionalInfo(metaStore);
      const found = groupedInfo.get(idOrComp)
        || Array.from(groupedInfo.values()).find(info => info.key === winnerKey);
      winnerName = found ? found.name : idOrComp;
      winnerParty = found ? found.composition : idOrComp;
      winnerColorParty = getProportionalListColorKey(winnerName, winnerParty, '');
    }

    const slug = normalizeMunicipioSlug(cityName);
    summary[slug] = {
      nome: cityName,
      muniCode: '',
      winnerCode: winnerKey,
      winnerName,
      winnerParty,
      winnerColorParty: winnerColorParty || winnerParty,
      totalValid,
      margin: totalValid > 0 ? ((winnerVotes - secondVotes) / totalValid) * 100 : 0,
      winnerPct: totalValid > 0 ? (winnerVotes / totalValid) * 100 : 0,
      turno: turnoKey,
      turnoLabel,
      votes: groupVotes,
      rawTotals: rawVotes,
      isDetailed: false
    };
  });

  return summary;
}

function buildMunicipalSummaryFromOfficialTotals(officialCityTotals, turnoKey) {
  const turnoLabel = (turnoKey === '2T') ? '2º Turno' : '1º Turno';
  const summary = {};
  const seen = new Set();

  Object.entries(officialCityTotals || {}).forEach(([cityKey, cityData]) => {
    if (!cityData?.votesByDisplayKey) return;
    const slug = normalizeMunicipioSlug(cityKey);
    if (seen.has(slug)) return;
    seen.add(slug);

    const votes = cityData.votesByDisplayKey;
    const totalValid = ensureNumber(cityData.totalValidos) || 0;
    if (totalValid <= 0) return;

    const orderedVotes = Object.entries(votes)
      .filter(([, v]) => ensureNumber(v) > 0)
      .sort((a, b) => ensureNumber(b[1]) - ensureNumber(a[1]));
    if (!orderedVotes.length) return;

    const [winnerKey, winnerVotesRaw] = orderedVotes[0];
    const [, secondVotesRaw] = orderedVotes[1] || [null, 0];
    const winnerVotes = ensureNumber(winnerVotesRaw);
    const secondVotes = ensureNumber(secondVotesRaw);

    const winnerInfo = typeof parseCandidateKey === 'function'
      ? parseCandidateKey(winnerKey)
      : { nome: winnerKey, partido: '' };
    const winnerName = winnerInfo.nome || 'N/D';
    const winnerParty = winnerInfo.partido || '';

    const ibgeCode = cityData.ibge ? String(cityData.ibge) : '';
    const entry = {
      nome: cityKey,
      muniCode: ibgeCode,
      winnerCode: winnerKey,
      winnerName,
      winnerParty,
      winnerColorParty: winnerParty,
      totalValid,
      margin: totalValid > 0 ? ((winnerVotes - secondVotes) / totalValid) * 100 : 0,
      winnerPct: totalValid > 0 ? (winnerVotes / totalValid) * 100 : 0,
      turno: turnoKey,
      turnoLabel,
      votes,
      rawTotals: cityData.rawTotals || {},
      isDetailed: false
    };
    summary[slug] = entry;
    // Indexa tambem pelo codigo IBGE para que o poligono case por codigo (mais
    // robusto que por nome) em getMunicipalSummaryEntryForFeature.
    if (ibgeCode) summary[ibgeCode] = entry;
  });

  return summary;
}

function buildGeneralMunicipalityOverviewSummary(cargoKey = currentCargo) {
  const precomputedSummary = typeof getPrecomputedMunicipalOverviewSummary === 'function'
    ? getPrecomputedMunicipalOverviewSummary(cargoKey)
    : null;
  if (precomputedSummary) {
    return precomputedSummary;
  }

  // For 2002/2006, use JSON-based official city totals (dot coverage is too sparse)
  const year = String(STATE.currentElectionYear);
  if (year === '2002' || year === '2006') {
    const turnoKey = getActiveTurnoKeyForCurrentCargo(cargoKey);
    const officialCityTotals = STATE.generalOfficialTotalsByCity?.[cargoKey]?.[turnoKey];
    if (officialCityTotals && Object.keys(officialCityTotals).length > 0) {
      return buildMunicipalSummaryFromOfficialTotals(officialCityTotals, turnoKey);
    }
    // For deputado 2002: use pre-built raw city totals resolved to groups at render time
    if (year === '2002' && cargoKey.startsWith('deputado')) {
      if (typeof syncDeputyDataForCargo === 'function') syncDeputyDataForCargo(cargoKey);
      const rawCityTotals = STATE.deputyCityTotals?.[cargoKey];
      if (rawCityTotals?.size > 0) {
        return buildDeputyMunicipalSummaryFromRawTotals(rawCityTotals, cargoKey, turnoKey);
      }
    }
  }

  if (cargoKey.startsWith('deputado') && typeof syncDeputyDataForCargo === 'function') {
    syncDeputyDataForCargo(cargoKey);
  }
  const geojson = currentDataCollection[cargoKey];
  if (!geojson?.features?.length) return {};

  const turnoKey = getActiveTurnoKeyForCurrentCargo(cargoKey);
  const turnoLabel = (turnoKey === '2T' || turnoKey === '2t') ? '2º Turno' : '1º Turno';
  const inaptosTurno = STATE.inaptos[cargoKey]?.[turnoKey] || [];
  const grouped = new Map();

  geojson.features.forEach((feature) => {
    if (!filterFeature(feature)) return;

    const props = feature.properties || {};
    const cityName = String(getProp(props, 'nm_localidade') || '').trim();
    if (!cityName) return;

    let entry = grouped.get(cityName);
    if (!entry) {
      entry = {
        nome: cityName,
        muniCode: String(getMunicipalityFeatureCode(props) || '').trim(),
        votes: {},
        groupParties: {},
        rawVotes: {},
        totalValid: 0
      };
      grouped.set(cityName, entry);
    }

    if (cargoKey.startsWith('deputado') || cargoKey.startsWith('vereador')) {
      const isVereador = cargoKey.startsWith('vereador');
      const typeKey = isVereador ? 'v' : (cargoKey === 'deputado_estadual' ? 'e' : 'f');
      const locId = resolveFeatureSelectionId(props);
      
      const resultStore = isVereador ? STATE.vereadorResults : STATE.deputyResults;
      const metaStore = isVereador ? STATE.vereadorMetadata : STATE.deputyMetadata;
      const prefixCache = isVereador ? STATE._vereadorPartyPrefixCache : STATE._partyPrefixCache;
      const lookup = isVereador ? STATE.vereadorLookup : STATE.deputyLookup;

      let key = locId;
      if (lookup) {
        key = lookup.get(locId) || locId;
      }
      
      const data = resultStore?.[key];
      if (!data || !data[typeKey]) return;

      const votes = data[typeKey]; 
      Object.entries(votes).forEach(([candId, count]) => {
        if (candId === '95' || candId === '96') return; 
        if (STATE.filterInaptos && inaptosTurno.includes(candId)) return;

        const v = ensureNumber(count);
        if (v <= 0) return;

        entry.rawVotes[candId] = (entry.rawVotes[candId] || 0) + v;

        const groupInfo = resolveProportionalGroupInfo(candId, metaStore, prefixCache);
        const groupKey = groupInfo.key;

        if (!entry.votes[groupKey]) {
           entry.votes[groupKey] = 0;
        }
        if (!entry.groupParties[groupKey]) {
          entry.groupParties[groupKey] = {};
        }
        entry.votes[groupKey] += v;
        entry.groupParties[groupKey][groupInfo.party] = (entry.groupParties[groupKey][groupInfo.party] || 0) + v;
        entry.totalValid += v;
      });
    } else {
      Object.keys(props).forEach((key) => {
        if (!key.endsWith(` ${turnoKey}`) || !isCandidateVoteKey(key)) return;
        if (STATE.filterInaptos && inaptosTurno.includes(key)) return;

        const votes = ensureNumber(props[key]);
        if (votes <= 0) return;

        entry.votes[key] = (entry.votes[key] || 0) + votes;
        entry.totalValid += votes;
      });
    }
  });

  const summary = {};
  const scopedColorLookup = (cargoKey.startsWith('deputado') || cargoKey.startsWith('vereador'))
    ? getScopedProportionalColorKeyLookup(cargoKey.startsWith('vereador') ? 'vereador' : 'deputado', cargoKey)
    : null;
  grouped.forEach((entry) => {
    const orderedVotes = Object.entries(entry.votes)
      .filter(([, votes]) => ensureNumber(votes) > 0)
      .sort((a, b) => ensureNumber(b[1]) - ensureNumber(a[1]));

    if (!orderedVotes.length || entry.totalValid <= 0) return;

    const [winnerKey, winnerVotesRaw] = orderedVotes[0];
    const [, secondVotesRaw] = orderedVotes[1] || [null, 0];
    let winnerName = 'N/D';
    let winnerParty = '';
    let winnerColorParty = '';

    if (winnerKey.startsWith('group:') || winnerKey.startsWith('party:')) {
      const isVereador = cargoKey.startsWith('vereador');
      const metaStore = isVereador ? STATE.vereadorMetadata : STATE.deputyMetadata;
      const parts = winnerKey.split(':');
      const type = parts[0];
      const idOrComp = parts[1];

      if (type === 'party') {
        winnerName = idOrComp;
        winnerParty = idOrComp;
        winnerColorParty = scopedColorLookup?.get(winnerKey)
          || getProportionalListColorKey(winnerName, winnerParty, winnerParty);
      } else {
        const groupedInfo = getCachedGroupedProportionalInfo(metaStore);
        const found = groupedInfo.get(idOrComp) || Array.from(groupedInfo.values()).find(info => info.key === winnerKey);
        const partyTotals = entry.groupParties[winnerKey] || {};
        let dominantParty = '';
        let dominantVotes = -1;
        Object.entries(partyTotals).forEach(([party, votes]) => {
          const safeVotes = ensureNumber(votes);
          if (safeVotes > dominantVotes) {
            dominantVotes = safeVotes;
            dominantParty = party;
          }
        });
        winnerName = found ? found.name : idOrComp;
        winnerParty = found ? found.composition : idOrComp;
        winnerColorParty = scopedColorLookup?.get(winnerKey)
          || getProportionalListColorKey(winnerName, winnerParty, dominantParty);
      }
    } else {
      const winnerInfo = parseCandidateKey(winnerKey);
      winnerName = winnerInfo.nome || 'N/D';
      winnerParty = winnerInfo.partido || '';
      winnerColorParty = getProportionalListColorKey(winnerParty, winnerParty, winnerParty);
    }
    const winnerVotes = ensureNumber(winnerVotesRaw);
    const secondVotes = ensureNumber(secondVotesRaw);

    const summaryEntry = {
      nome: entry.nome,
      muniCode: entry.muniCode,
      winnerCode: winnerKey,
      winnerName: winnerName,
      winnerParty: winnerParty,
      winnerColorParty: winnerColorParty || winnerParty,
      totalValid: entry.totalValid,
      margin: entry.totalValid > 0 ? ((winnerVotes - secondVotes) / entry.totalValid) * 100 : 0,
      winnerPct: entry.totalValid > 0 ? (winnerVotes / entry.totalValid) * 100 : 0,
      turno: turnoKey,
      turnoLabel,
      votes: entry.votes,
      rawTotals: entry.rawVotes || entry.votes,
      isDetailed: true
    };
    if (entry.muniCode) summary[entry.muniCode] = summaryEntry;
    summary[normalizeMunicipioSlug(entry.nome)] = summaryEntry;
  });

  applyEmancOverlayToSummary(summary, cargoKey, turnoKey);
  return summary;
}

// 1998/2010 montam o coropletico agregando os DOTS do mapa; cidades que ainda
// nao existiam nesses anos nao tem dots, entao nao apareciam. Aqui sobrepomos as
// entradas ja corrigidas (cidade nova + pais com votos subtraidos) calculadas em
// EMANC.adjustCityTotals e guardadas nos totais oficiais por cidade. Casa por
// slug/IBGE, entao a cidade nova passa a colorir seu poligono e o pai reduz.
function applyEmancOverlayToSummary(summary, cargoKey, turnoKey) {
  const year = String(STATE.currentElectionYear);
  if (year !== '1998' && year !== '2010') return; // 2002/2006 ja usam os oficiais
  const oct = STATE.generalOfficialTotalsByCity?.[cargoKey]?.[turnoKey];
  const affected = oct && oct._emancAffected;
  if (!(affected instanceof Set) || affected.size === 0) return;
  const filtered = {};
  affected.forEach((name) => {
    const e = oct[name] || oct[normalizeMunicipioSlug(name)];
    if (e) filtered[name] = e;
  });
  const partial = buildMunicipalSummaryFromOfficialTotals(filtered, turnoKey);
  Object.assign(summary, partial);
}

function renderGeneralStatewideMunicipalityResults(summary, uf) {
  const geojson = currentDataCollection[currentCargo];
  const filteredFeatures = geojson?.features?.filter((feature) => filterFeature(feature)) || [];

  selectedLocationIDs.clear();
  filteredFeatures.forEach((feature) => {
    const id = getFeatureSelectionId(feature?.properties || {});
    if (id) selectedLocationIDs.add(id);
  });

  if (selectedLocationIDs.size > 0) {
    updateSelectionUI(true);
    return;
  }

  const ufName = UF_MAP.get(uf) || uf;
  dom.resultsBox.classList.remove('section-hidden');
  dom.summaryBoxContainer.classList.add('section-hidden');
  if (dom.turnTabs) dom.turnTabs.innerHTML = '';
  dom.resultsTitle.textContent = `Estado Completo (${uf})`;
  dom.resultsSubtitle.textContent = `${ufName} • nenhum local encontrado`;
  dom.resultsContent.innerHTML = '<p style="color:var(--muted)">Nenhum local agregado disponível para este recorte.</p>';
  dom.resultsMetrics.innerHTML = '';
  if (typeof updateNeighborhoodProfileUI === 'function') updateNeighborhoodProfileUI();
}

function shouldRenderGeneralMunicipalityOverview() {
  const uf = String(dom.selectUFGeneral?.value || '').toUpperCase();
  if (STATE.currentElectionType !== 'geral') return false;
  if (!uf || uf === 'BR') return false;
  // if (String(currentCargo || '').startsWith('deputado')) return false; // REMOVED: Allow deputies
  if (STATE.currentMapMode === 'locais') return false;
  if (currentCidadeFilter !== 'all') return false;
  if (currentBairroFilter !== 'all') return false;
  if (currentLocalFilter.trim().length > 2) return false;
  return true;
}

// Cria a camada (MapLibre fill+line) de municípios. onSelectFeature recebe a
// feature ORIGINAL clicada (com geometria/props completas).
function createMunicipiosGeoLayer(geojson, onSelectFeature) {
  const layer = new MLCompat.GeoLayer(map, {
    id: 'muni',
    type: 'polygon',
    hover: true,
    styleFn: (feature) => getMunicipalPolygonStyle(feature, STATE.currentMapMuniSummary),
    tooltipFn: (feature) => (isSelectedMunicipalFeature(feature?.properties)
      ? null
      : buildMunicipalityTooltip(feature, STATE.currentMapMuniSummary)),
    onClick: (feature) => {
      if (isSelectedMunicipalFeature(feature?.properties) && STATE.currentMapMode === 'locais') return;
      onSelectFeature(feature);
    }
  });
  
  if (STATE.extrusion3DEnabled) {
    layer.extrusionEnabled = true;
  }
  
  layer.setFeatures(geojson.features || []);
  return layer;
}


async function showGeneralMunicipalityOverview(uf) {
  const ufNorm = String(uf || '').toUpperCase();
  if (!map || !ufNorm || ufNorm === 'BR' || STATE.currentElectionType !== 'geral') return;

  showMapLoading(`Carregando visão municipal de ${ufNorm}...`);

  try {
    STATE.currentMapMode = 'municipios';
    STATE.currentMapMuniUF = ufNorm;
    STATE.currentMapMuniSummary = buildGeneralMunicipalityOverviewSummary(currentCargo);

    const geojson = await fetchMunicipalPolygonGeoJSON(ufNorm);
    if (!shouldRenderGeneralMunicipalityOverview() || String(dom.selectUFGeneral?.value || '').toUpperCase() !== ufNorm) {
      return;
    }

    if (STATE.municipiosLayer && map.hasLayer(STATE.municipiosLayer)) {
      map.removeLayer(STATE.municipiosLayer);
    }

    STATE.municipiosLayer = createMunicipiosGeoLayer(geojson, (feature) => {
      const nome = getMunicipalityFeatureName(feature.properties);
      const matchedCity = Array.from(uniqueCidades || []).find((candidate) => matchesMunicipioName(nome, candidate)) || nome;
      currentCidadeFilter = matchedCity;
      currentBairroFilter = 'all';
      currentLocalFilter = '';
      selectedLocationIDs.clear();
      STATE.isFilterAggregationActive = false;
      STATE.currentMapMode = 'locais';
      if (cidadeCombobox) cidadeCombobox.setValue(matchedCity);
      if (bairroCombobox) bairroCombobox.setValue('');
      if (dom.searchLocal) dom.searchLocal.value = '';
      setPendingMunicipalFocusBounds(feature);
      focusSelectedMunicipalityOnMap({ animate: true, duration: 0.45, preferPending: true });
      populateBairroDropdown();
      updateApplyButtonText();
      applyFiltersAndRedraw();
    });
    STATE.municipiosLayer.addTo(map);

    const bounds = STATE.municipiosLayer.getBounds();
    MLCompat.fitMapToBounds(map, bounds, { padding: [20, 20], animate: false });

    if (dom.btnMapModeMunicipios) dom.btnMapModeMunicipios.classList.add('active');
    if (dom.btnMapModeLocais) dom.btnMapModeLocais.classList.remove('active');

    renderGeneralStatewideMunicipalityResults(STATE.currentMapMuniSummary, ufNorm);
  } catch (error) {
    console.error('[Geral] Falha ao montar visão municipal:', error);
    showToast(`Erro ao carregar a visão municipal: ${error.message}`, 'error');
  } finally {
    hideMapLoading();
  }
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
    const partyColor = colorForParty(c.partido);

    // Highlight match
    let displayName = safeToTitleCase(c.nome);
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
          displayName = safeToTitleCase(original.substring(0, idx))
            + '<strong>' + safeToTitleCase(original.substring(idx, idx + query.length)) + '</strong>'
            + safeToTitleCase(original.substring(idx + query.length));
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
          : `${safeToTitleCase(candData.nome)} (${candData.partido}) • Nº ${candData.numero}`;
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
  // Resumo estadual municipal: mapa e painel sao geridos por
  // showMunicipalStatewideOverview; redesenhar aqui derrubaria o choropleth
  // e renderizaria locais residuais do ultimo municipio carregado.
  if (STATE.currentElectionType === 'municipal' && !dom.selectMunicipio?.value) return;

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

  // Recalcular estatísticas do candidato se estiver no modo Desempenho
  if (currentVizMode.startsWith('desempenho') && dom.selectVizCandidato?.value) {
    const candidatoKey = dom.selectVizCandidato.value;
    performanceModeStats = calculateCandidateStats(candidatoKey) || {
      candidato: candidatoKey, minPct: 0, maxPct: 100, avgPct: 0, totalLocais: 0
    };
    updatePerformanceStatsUI();
  }

  if (shouldRenderGeneralMunicipalityOverview()) {
    CURRENT_VISIBLE_FEATURES_CACHE = [];
    CURRENT_VISIBLE_PROPS_CACHE = [];
    void showGeneralMunicipalityOverview(dom.selectUFGeneral?.value);
    if (STATE.isLoadingDataset) {
      clearPendingFilterChanges();
    }
    return;
  }

  updateAvailabilityBars(geojson);

  // Precomputa vencedores de vereador se necessário
  if (currentCargo.startsWith('vereador') && STATE.vereadorResults && Object.keys(STATE.vereadorResults).length > 0) {
    precomputeVereadorWinners();
  }

  const isSpecialYearGeral = STATE.currentElectionType === 'geral' &&
    (String(STATE.currentElectionYear) === '2002' || String(STATE.currentElectionYear) === '2006');

  const keepMunicipalOverviewVisible =
    !!STATE.municipiosLayer
    && map.hasLayer(STATE.municipiosLayer)
    && (
      (STATE.currentElectionType === 'municipal' && !!dom.selectMunicipio?.value)
      || (STATE.currentElectionType === 'geral' && !!STATE.currentMapMuniUF && (currentCidadeFilter !== 'all' || isSpecialYearGeral))
    );

  if (!keepMunicipalOverviewVisible && STATE.municipiosLayer && map.hasLayer(STATE.municipiosLayer)) {
    map.removeLayer(STATE.municipiosLayer);
  }

  STATE.currentMapMode = 'locais';
  if (dom.btnMapModeMunicipios) dom.btnMapModeMunicipios.classList.remove('active');
  if (dom.btnMapModeLocais) dom.btnMapModeLocais.classList.add('active');

  const visibleFeatures = (geojson.features || []).filter(filterFeature);

  if (isSpecialYearGeral) {
    if (currentCidadeFilter === 'all' || !STATE.munisWithDots) {
      STATE.munisWithDots = new Set();
      (geojson.features || []).forEach(f => {
        if (f.geometry && f.geometry.type) {
          const nm = String(f.properties?.nm_localidade || '').trim();
          if (nm) STATE.munisWithDots.add(normalizeMunicipioSlug(nm));
        }
      });
    }
  } else {
    STATE.munisWithDots = null;
  }

  let hasRealDots = false;
  if (isSpecialYearGeral && STATE.munisWithDots) {
    const selectedMuniName = getCurrentMunicipalMapSelection()?.name || currentCidadeFilter;
    if (selectedMuniName && selectedMuniName !== 'all') {
      const aliases = typeof getMunicipioAliasSlugs === 'function'
        ? getMunicipioAliasSlugs(selectedMuniName)
        : [normalizeMunicipioSlug(selectedMuniName)];
      hasRealDots = aliases.some(alias => STATE.munisWithDots.has(alias));
    }
  } else {
    hasRealDots = visibleFeatures.some(f => f.geometry !== null && f.geometry !== undefined);
  }
  STATE.currentCityHasNoDots = keepMunicipalOverviewVisible && !hasRealDots;

  currentLayer = new MLCompat.GeoLayer(map, {
    id: 'locais',
    type: 'point',
    styleFn: getFeatureStyle,
    radiusFn: getPointRadiusForFeature,
    tooltipFn: buildLocationTooltip,
    onClick: onFeatureClick,
    sticky: false
  });
  currentLayer.setFeatures(visibleFeatures);
  currentLayer.addTo(map);

  if (keepMunicipalOverviewVisible) {
    if (STATE.currentElectionType === 'geral' && STATE.currentMapMuniUF) {
      refreshGeneralMunicipalityOverviewLayer({ syncResults: STATE.currentMapMode === 'municipios' });
    }
    refreshMunicipalSelectionOverlay();
  }

  CURRENT_VISIBLE_FEATURES_CACHE = visibleFeatures;
  CURRENT_VISIBLE_PROPS_CACHE = visibleFeatures.map((feature) => feature.properties);

  // Call ISE Panel update
  if (typeof window.updateISEPanel === 'function') {
    window.updateISEPanel(currentLayer, currentCargo, currentTurno);
  }

  syncResultsPanelToCurrentView();

  if (STATE.isLoadingDataset) {
    clearPendingFilterChanges();
  }

  // Update Voltar/Clear Selection button visibility
  if (typeof window.updateClearSelectionButtonVisibility === 'function') {
    window.updateClearSelectionButtonVisibility();
  }
}



// --- HELPER FUNCTIONS (Extraídas para reaproveitar nos dois modos) ---

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
  const hasData = !!currentDataCollection[currentCargo];
  const turnoKey = (currentTurno === 2 && STATE.dataHas2T[currentCargo]) ? '2T' : '1T';

  // Turno municipal sem dados por local (ex.: 2o turno de Maceio 2000, ou
  // municipio inteiro do munzona): redesenha o mapa e mostra o resultado geral.
  if (STATE.currentElectionType === 'municipal' && currentCargo.startsWith('prefeito')
      && (STATE.candidates[currentCargo]?.[turnoKey] || []).length === 0
      && STATE.municipalOfficialTotals?.[currentCargo]?.[turnoKey]
      && typeof renderMunicipalOfficialOnlySidebar === 'function') {
    if (currentLayer?.refresh) currentLayer.refresh();
    renderMunicipalOfficialOnlySidebar(currentCargo);
    return;
  }

  if (hasData && currentVizMode.startsWith('desempenho')) {
    populateVizCandidatoDropdown(turnoKey);
    if (dom.selectVizCandidato?.value) {
      const candidatoKey = dom.selectVizCandidato.value;
      performanceModeStats = calculateCandidateStats(candidatoKey) || {
        candidato: candidatoKey, minPct: 0, maxPct: 100, avgPct: 0, totalLocais: 0
      };
      updatePerformanceStatsUI();
    }
  }

  if (STATE.currentMapMode === 'municipios') {
    if (STATE.currentElectionType === 'geral' && shouldRenderGeneralMunicipalityOverview()) {
      void showGeneralMunicipalityOverview(STATE.currentMapMuniUF || dom.selectUFGeneral?.value);
      return;
    }

    if (STATE.currentElectionType === 'municipal') {
      void refreshMunicipalStatewideOverviewForTurn();
      return;
    }
  }

  if (STATE.currentElectionType === 'geral' && STATE.municipiosLayer && map?.hasLayer?.(STATE.municipiosLayer)) {
    refreshGeneralMunicipalityOverviewLayer({ syncResults: false });
  }

  if (STATE.currentElectionType === 'municipal' && STATE.municipiosLayer && map?.hasLayer?.(STATE.municipiosLayer)) {
    void refreshMunicipalStatewideOverviewForTurn();
  }

  if (!hasData) return;

  if (shouldFullRedrawOnTurnChange()) {
    applyFiltersAndRedraw();
    return;
  }

  // Recolore/redimensiona os pontos para o novo turno (recalcula props e setData).
  // Os tooltips são reconstruídos dinamicamente ao passar o mouse.
  if (currentLayer?.refresh) currentLayer.refresh();

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

      num = getEscolaridadeGroupedValue(filterMode, { ana, le, fi, fc, mi, mc, si, sc });

      return (num / den * 100) >= filterVal;
    }

    // Idade
    if (type === 'idade') {
      const ageAggregate = aggregateAgeBucketsFromProps(props, window.AGE_BUCKETS_STANDARD);
      if (ageAggregate.total === 0) return false;

      numerator = ageAggregate.buckets[filterMode] || 0;
      const valCalc = (numerator / ageAggregate.total) * 100;
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

  const inaptosSet = STATE.filterInaptos ? inaptosArrayToSet(STATE.inaptos[currentCargo]?.['1T']) : null;

  for (const [cand, v] of Object.entries(votes)) {
    if (inaptosSet && inaptosSet.has(cand)) {
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
  const shouldRecalculateWithInaptos = STATE.filterInaptos === true;

  if (total === undefined || shouldRecalculateWithInaptos) {
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
    const inaptosSet = STATE.filterInaptos ? inaptosArrayToSet(STATE.inaptos['vereador_ord']?.['1T']) : null;
    for (const [cid, v] of Object.entries(votes)) {
      if (cid === '95' || cid === '96') continue;
      if (inaptosSet && inaptosSet.has(cid)) continue;
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
    const inaptosSet = STATE.filterInaptos ? inaptosArrayToSet(STATE.inaptos['vereador_ord']?.['1T']) : null;

    for (const [cid, v] of Object.entries(votes)) {
      if (cid === '95' || cid === '96') continue;
      if (inaptosSet && inaptosSet.has(cid)) continue;

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

function getTotalVotesForFeature(feature) {
  const props = feature?.properties;
  if (!props) return 0;
  
  const isDeputy = currentCargo.startsWith('deputado');
  const isVereador = currentCargo.startsWith('vereador');
  
  if (isVereador) {
    const depData = typeof getVereadorFeatureData === 'function' ? getVereadorFeatureData(props) : null;
    return depData ? depData.total : 0;
  }
  
  if (isDeputy) {
    const depData = typeof getDeputyFeatureData === 'function' ? getDeputyFeatureData(props) : null;
    return depData ? depData.total : 0;
  }
  
  // Standard majoritarian
  const turnoKey = (currentTurno === 2 && STATE.dataHas2T[currentCargo]) ? '2T' : '1T';
  const valResult = typeof getVotosValidos === 'function' ? getVotosValidos(props, currentCargo, turnoKey, STATE.filterInaptos) : null;
  return valResult ? valResult.totalValidos : 0;
}

function getFeatureStyle(feature) {
  return getFeatureStyleRaw(feature);
}

function getFeatureStyleRaw(feature) {
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
    const { total, winner, winnerVotes } = depData;
    const winningList = getWinningProportionalListData(depData.votes, 'vereador');
    let fillColor = DEFAULT_SWATCH, fillOpacity = DEFAULT_POINT_FILL_OPACITY, pctVal = 0, marginPct = 20;

    if (currentVizMode.startsWith('vencedor')) {
      if (winningList) {
        fillColor = winningList.color;
        pctVal = winningList.pct;
        marginPct = winningList.marginPct;
      } else if (winner) {
        const meta = STATE.vereadorMetadata[winner];
        fillColor = getColorForCandidate(meta ? meta[0] : '', meta ? meta[1] : '');
        pctVal = (total > 0) ? (winnerVotes / total) * 100 : 0;
        marginPct = getWinningMarginPct([winnerVotes], total);
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
      fillColor = getGradientColorForMode(fillColor, marginPct, pctVal);

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

    const { total, winner, winnerVotes } = depData;
    const winningList = getWinningProportionalListData(depData.votes, 'deputado');

    if (currentVizMode.startsWith('vencedor')) {
      if (winningList) {
        fillColor = winningList.color;
        pctVal = winningList.pct;
      } else if (winner) {
        const meta = STATE.deputyMetadata[winner];
        const party = meta ? meta[1] : '';
        const name = meta ? meta[0] : winner;
        fillColor = getColorForCandidate(name, party);
        pctVal = (total > 0) ? (winnerVotes / total) * 100 : 0;
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
      const marginPct = winningList
        ? winningList.marginPct
        : getWinningMarginPct([winnerVotes], total);
      fillColor = getGradientColorForMode(fillColor, marginPct, pctVal);
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
    const marginPct = currentVizMode.startsWith('vencedor')
      ? getMajoritarianMarginPct(props, turnoKey, totalValidos)
      : pctVal;
    fillColor = getGradientColorForMode(fillColor, marginPct, pctVal);
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

function onFeatureClick(feature, e) {
  const props = feature.properties;
  const id = resolveFeatureSelectionId(props);

  const isShiftClick = !!(e && e.originalEvent && e.originalEvent.shiftKey);

  if (!isShiftClick) {
    if (selectedLocationIDs.size === 1 && selectedLocationIDs.has(id)) {
      selectedLocationIDs.clear();
    } else {
      selectedLocationIDs.clear();
      selectedLocationIDs.add(id);
    }
  } else {
    if (STATE.isFilterAggregationActive) {
      selectedLocationIDs.clear();
    }
    if (selectedLocationIDs.has(id)) selectedLocationIDs.delete(id);
    else selectedLocationIDs.add(id);
  }

  if (currentLayer && currentLayer.resetStyle) currentLayer.resetStyle();
  isDragSelection = false; // Is manual click
  updateApplyButtonText();

  const shouldRestoreFilteredAggregation =
    (STATE.currentElectionType === 'municipal' && !!dom.selectMunicipio?.value)
    || currentMesorregiaoFilter !== 'all'
    || currentMicrorregiaoFilter !== 'all'
    || currentCidadeFilter !== 'all'
    || currentBairroFilter !== 'all'
    || String(currentLocalFilter || '').trim().length > 0;

  if (selectedLocationIDs.size === 0 && shouldRestoreFilteredAggregation) {
    syncResultsPanelToCurrentView();
    return;
  }

  updateSelectionUI(false);
}

function clearSelection(updateMap = true) {
  invalidateScopedProportionalColorLookup();
  selectedLocationIDs.clear();
  STATE.isFilterAggregationActive = false;
  if (dom.inputBairro && STATE.currentElectionType === 'geral' && currentCidadeFilter === 'all') {
    dom.inputBairro.disabled = true;
    dom.inputBairro.value = 'all';
  }
  if (dom.resultsContent) dom.resultsContent.innerHTML = '<div style="text-align:center; padding: 20px; color:var(--muted);"><p style="margin-bottom:8px">&#x1F446;</p>Clique no mapa ou use filtros para ver resultados.</div>';
  if (dom.resultsMetrics) dom.resultsMetrics.innerHTML = '';
  if (dom.summaryGrid) dom.summaryGrid.innerHTML = '';
  if (dom.resultsTitle) dom.resultsTitle.textContent = 'Resultados da Seleção';
  if (dom.resultsSubtitle) dom.resultsSubtitle.textContent = '';
  if (dom.btnLocateSelection) dom.btnLocateSelection.style.display = 'none';
  // Reset Unified View
  if (dom.unifiedResultsContainer) dom.unifiedResultsContainer.classList.remove('hidden');
  if (STATE.municipiosLayer?.eachLayer) {
    refreshMunicipalSelectionOverlay();
  }
  updateNeighborhoodProfileUI();
  if (typeof hidePresidentHistoryPanel === 'function') {
    hidePresidentHistoryPanel();
  }

  // Update Voltar/Clear Selection button visibility
  if (typeof window.updateClearSelectionButtonVisibility === 'function') {
    window.updateClearSelectionButtonVisibility();
  }
}

async function fetchMunicipalPolygonGeoJSON(uf) {
  const ufNorm = String(uf || '').toUpperCase();
  if (!ufNorm) return null;
  if (MUNICIPAL_POLYGON_CACHE.has(ufNorm)) {
    return MUNICIPAL_POLYGON_CACHE.get(ufNorm);
  }

  const promise = (async () => {
    const urls = [
      `${DATA_BASE_URL}municipios_hd/municipios_${ufNorm}.geojson`,
      `${DATA_BASE_URL}municipios/municipios_${ufNorm}.geojson`
    ];

    for (const url of urls) {
      try {
        const response = await fetch(url);
        if (!response.ok) continue;
        return await response.json();
      } catch (error) {
        console.warn(`[Municipios] Falha ao carregar ${url}:`, error);
      }
    }

    throw new Error(`Geometria municipal não encontrada para ${ufNorm}.`);
  })();

  MUNICIPAL_POLYGON_CACHE.set(ufNorm, promise);
  // Nao deixa uma promise rejeitada envenenar o cache: sem isto, uma unica
  // falha de rede quebraria o resumo estadual da UF pela sessao inteira.
  promise.catch(() => {
    if (MUNICIPAL_POLYGON_CACHE.get(ufNorm) === promise) MUNICIPAL_POLYGON_CACHE.delete(ufNorm);
  });
  return promise;
}

function getMunicipalPolygonStyle(feature, summary) {
  const result = getMunicipalSummaryEntryForFeature(feature?.properties, summary);
  const selectedMunicipality = getCurrentMunicipalMapSelection();
  const isSelected = isSelectedMunicipalFeature(feature?.properties, selectedMunicipality);

  // 2002/2006 locais mode:
  if (STATE.currentMapMode === 'locais' && STATE.munisWithDots) {
    // Se a visualização for do estado inteiro no modo locais (nenhum município selecionado),
    // toda a malha municipal do estado deve ficar transparente (fillOpacity: 0.02).
    if (!selectedMunicipality) {
      return {
        fillColor: DEFAULT_SWATCH,
        fillOpacity: 0.02,
        color: '#ffffff',
        weight: 0.3,
        opacity: 0.3,
        height: 0
      };
    }
    // Caso contrário (um município específico está selecionado), não aplicamos a transparência
    // geral aqui. Deixamos o fluxo seguir normalmente, o que significa que o selecionado
    // ficará destacado e transparente (ou colorido se não tiver pontos) e os outros municípios
    // ficarão visíveis e coloridos normalmente, seguindo o padrão de 2010 a 2022.
  }

  if (!result) {
    const emptyStyle = {
      fillColor: DEFAULT_SWATCH,
      fillOpacity: 0.25,
      color: '#ffffff',
      weight: 0.6,
      opacity: 0.8
    };

    if (!selectedMunicipality) return emptyStyle;

    if (isSelected) {
      if (STATE.currentCityHasNoDots) return emptyStyle;
      return {
        ...emptyStyle,
        fillOpacity: 0.06,
        color: 'rgba(255, 255, 255, 0.92)',
        weight: 2.2,
        opacity: 1
      };
    }

    return emptyStyle;
  }

  let fillColor = DEFAULT_SWATCH;
  let fillOpacity = 0.78;
  let pctVal = 0;

  const cargoKey = currentCargo;
  const isProportional = typeof cargoKey === 'string' && (cargoKey.startsWith('deputado') || cargoKey.startsWith('vereador'));

  if (currentVizMode.startsWith('desempenho')) {
    const candidatoKey = dom.selectVizCandidato?.value;
    if (candidatoKey && result.votes) {
      if (isProportional) {
        const isVereador = cargoKey.startsWith('vereador');
        const metaStore = isVereador ? STATE.vereadorMetadata : STATE.deputyMetadata;
        const prefixCache = isVereador ? STATE._vereadorPartyPrefixCache : STATE._partyPrefixCache;
        const candId = getResolvedVisualizationCandidateId(candidatoKey, cargoKey);
        if (candId) {
          const groupInfo = resolveProportionalGroupInfo(candId, metaStore, prefixCache);
          const groupKey = groupInfo.key;
          const votesCand = ensureNumber(result.votes[groupKey]);
          pctVal = (result.totalValid > 0) ? (votesCand / result.totalValid) * 100 : 0;

          const isLegendaCand = candId.length <= 2;
          if (isLegendaCand) {
            const partidoReal = prefixCache?.[candId] || '';
            fillColor = colorForParty(normalizePartyAlias(partidoReal.toUpperCase())) || DEFAULT_SWATCH;
          } else {
            const meta = metaStore[candId];
            fillColor = getColorForCandidate(meta ? meta[0] : '', meta ? meta[1] : '');
          }
        }
      } else {
        const votesCand = ensureNumber(result.votes[candidatoKey]);
        pctVal = (result.totalValid > 0) ? (votesCand / result.totalValid) * 100 : 0;

        const match = candidatoKey.match(/\((.*?)\)/);
        fillColor = match ? colorForParty(match[1]) : DEFAULT_SWATCH;
      }

      if (performanceModeStats.candidato) {
        fillColor = getRelativeGradientColor(fillColor, pctVal, performanceModeStats.minPct, performanceModeStats.maxPct);
      }

      if (performanceFilterMinPct > 0 && pctVal < performanceFilterMinPct) {
        fillColor = '#888888';
        fillOpacity = 0.15;
      } else if (pctVal === 0) {
        fillColor = '#888888';
        fillOpacity = 0.15;
      }
    } else {
      fillColor = '#888888';
      fillOpacity = 0.15;
    }
  } else {
    let winnerColorParty = result.winnerColorParty;
    if (isProportional && result.winnerCode) {
      const type = cargoKey.startsWith('vereador') ? 'vereador' : 'deputado';
      const scopedColorLookup = typeof getScopedProportionalColorKeyLookup === 'function'
        ? getScopedProportionalColorKeyLookup(type, cargoKey)
        : null;
      if (scopedColorLookup) {
        const colorPartyKey = scopedColorLookup.get(result.winnerCode);
        if (colorPartyKey) {
          winnerColorParty = colorPartyKey;
        }
      }
    }

    const normalizedParty = normalizePartyAlias(String(winnerColorParty || result.winnerParty || '').toUpperCase());
    const baseColor = getColorForCandidate(result.winnerName, normalizedParty);
    fillColor = getMarginAdjustedColor(baseColor, result.margin, result.winnerPct);
    fillOpacity = 0.78;
  }

  let height = 0;
  if (STATE.extrusion3DEnabled && result) {
    if (currentVizMode.startsWith('desempenho')) {
      height = pctVal * 300; // 0% = 0m, 100% = 30km
    } else {
      if (currentGradientMode === 'winnerPct') {
        height = (result.winnerPct / 100) * 30000;
      } else {
        height = result.margin * 30000; // Default: margin
      }
    }
  }

  const baseStyle = {
    fillColor: fillColor,
    fillOpacity: fillOpacity,
    color: '#ffffff',
    weight: 0.6,
    opacity: 0.8,
    height: height
  };

  if (!selectedMunicipality) {
    return baseStyle;
  }

  if (isSelected) {
    if (STATE.currentCityHasNoDots) {
      return {
        ...baseStyle,
        color: 'rgba(255, 255, 255, 0.96)',
        weight: 2.4,
        opacity: 1
      };
    }
    return {
      ...baseStyle,
      fillOpacity: 0.02,
      color: 'rgba(255, 255, 255, 0.96)',
      weight: 2.4,
      opacity: 1,
      height: height
    };
  }

  return baseStyle;
}

function getMunicipalOverviewSummaryForTurn(summaryByTurn, turnoKey = getActiveTurnoKeyForCurrentCargo()) {
  const preferredTurno = String(turnoKey || '1T').toUpperCase();
  const preferredSummary = summaryByTurn?.[preferredTurno];
  if (preferredSummary && Object.keys(preferredSummary).length) return preferredSummary;
  if (preferredTurno !== '1T' && summaryByTurn?.['1T']) return summaryByTurn['1T'];
  if (summaryByTurn?.['2T']) return summaryByTurn['2T'];
  return {};
}

function getMunicipalOverviewSummaryWithRunoffPriority(summaryByTurn) {
  const combined = {};
  const firstTurn = summaryByTurn?.['1T'] || {};
  const secondTurn = summaryByTurn?.['2T'] || {};
  const muniCodes = new Set([
    ...Object.keys(firstTurn),
    ...Object.keys(secondTurn)
  ]);

  muniCodes.forEach((muniCode) => {
    combined[muniCode] = secondTurn[muniCode] || firstTurn[muniCode];
  });

  return combined;
}

function renderMunicipalOverviewTurnTabs(summaryByTurn) {
  if (!dom.turnTabs) return;

  dom.turnTabs.innerHTML = '';

  const has1T = Object.keys(summaryByTurn?.['1T'] || {}).length > 0;
  const has2T = Object.keys(summaryByTurn?.['2T'] || {}).length > 0;

  if (currentTurno === 2 && !has2T) currentTurno = 1;
  if (currentTurno === 1 && !has1T && has2T) currentTurno = 2;

  if (has1T) {
    const tab = document.createElement('div');
    tab.className = 'tab' + (currentTurno === 1 ? ' active' : '');
    tab.textContent = '1º Turno';
    tab.dataset.turno = 1;
    tab.addEventListener('click', () => {
      if (currentTurno === 1) return;
      currentTurno = 1;
      refreshTurnDependentUI();
    });
    dom.turnTabs.appendChild(tab);
  }

  if (has2T) {
    const tab = document.createElement('div');
    tab.className = 'tab' + (currentTurno === 2 ? ' active' : '');
    tab.textContent = '2º Turno';
    tab.dataset.turno = 2;
    tab.addEventListener('click', () => {
      if (currentTurno === 2) return;
      currentTurno = 2;
      refreshTurnDependentUI();
    });
    dom.turnTabs.appendChild(tab);
  }
}

function resolveMunicipalOverviewWinnerPresentation(result) {
  const partyKey = normalizePartyAlias(String(result?.winnerParty || '').toUpperCase());
  const colorKey = normalizePartyAlias(String(result?.winnerColorParty || result?.winnerParty || '').toUpperCase());
  const candidateName = String(result?.winnerName || '').trim();

  const displayKey = partyKey || normalizePartyAlias(String(candidateName || '').toUpperCase());
  const displayLabel = partyKey || candidateName || displayKey || 'N/D';
  const color = getColorForCandidate(candidateName, colorKey || partyKey || displayKey);

  return {
    key: displayKey,
    label: displayLabel,
    color
  };
}

function renderMunicipalStatewidePartyResults(summary, uf) {
  const ufName = UF_MAP.get(uf) || uf;
  const partyTotals = new Map();

  Object.values(summary || {}).forEach((result) => {
    const presentation = resolveMunicipalOverviewWinnerPresentation(result);
    if (!presentation.key) return;
    if (!partyTotals.has(presentation.key)) {
      partyTotals.set(presentation.key, {
        partido: presentation.label,
        color: presentation.color,
        count: 0
      });
    }
    partyTotals.get(presentation.key).count += 1;
  });

  const results = Array.from(partyTotals.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.partido.localeCompare(b.partido, 'pt-BR');
  });

  dom.resultsBox.classList.remove('section-hidden');
  dom.summaryBoxContainer.classList.add('section-hidden');
  if (dom.turnTabs) {
    dom.turnTabs.innerHTML = '';
    dom.turnTabs.style.display = 'none';
  }
  dom.resultsTitle.textContent = 'Prefeituras por partido';
  dom.resultsSubtitle.textContent = `${ufName} • ${fmtInt(results.reduce((sum, item) => sum + item.count, 0))} municípios`;
  dom.resultsContent.innerHTML = '';

  if (!results.length) {
    dom.resultsContent.innerHTML = '<p style="color:var(--muted)">Nenhum resultado estadual encontrado para esta UF.</p>';
    dom.resultsMetrics.innerHTML = '';
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'grid';
  const totalMunicipios = results.reduce((sum, item) => sum + item.count, 0);

  results.forEach((result) => {
    const pct = totalMunicipios > 0 ? (result.count / totalMunicipios) : 0;
    const div = document.createElement('div');
    div.className = 'cand';
    div.innerHTML = `
      <div class="cand-indicator" style="background:${result.color}"></div>
      <div class="cand-name-wrapper">
        <div class="cand-name" title="${escapeHtml(result.partido)}">
          <span class="scroll-text">${escapeHtml(result.partido)}</span>
        </div>
      </div>
      <div class="cand-bar-wrapper">
        <div class="cand-bar-fill" style="background:${result.color}; width:${pct * 100}%;"></div>
        <div class="cand-votos">${fmtInt(result.count)}</div>
        <div class="cand-pct">${fmtPct(pct)}</div>
      </div>
    `;
    grid.appendChild(div);
  });

  dom.resultsContent.appendChild(grid);
  dom.resultsMetrics.innerHTML = `
    <div class="metrics-grid">
      <div class="metric-item"><span>Partidos vencedores</span><strong>${fmtInt(results.length)}</strong></div>
      <div class="metric-item"><span>Prefeituras computadas</span><strong>${fmtInt(totalMunicipios)}</strong></div>
    </div>
  `;
}

async function refreshMunicipalStatewideOverviewForTurn(options = {}) {
  const forceReload = options.forceReload === true;
  const shouldSyncResults = options.syncResults === true
    || (!dom.selectMunicipio?.value && STATE.currentMapMode === 'municipios');
  const uf = String(STATE.currentMapMuniUF || dom.selectUFMunicipal?.value || '').toUpperCase();
  if (!uf || STATE.currentElectionType !== 'municipal' || !STATE.municipiosLayer || !map?.hasLayer?.(STATE.municipiosLayer)) return false;

  const summaryByTurn = (!forceReload && STATE.currentMapMuniSummaryByTurn)
    ? STATE.currentMapMuniSummaryByTurn
    : (typeof window.loadMunicipalOverviewSummary === 'function'
      ? await window.loadMunicipalOverviewSummary(uf, STATE.currentElectionYear, currentSubType || 'ord')
      : null);

  if (!summaryByTurn) return false;

  STATE.currentMapMuniSummaryByTurn = summaryByTurn;
  STATE.currentMapMuniSummary = getMunicipalOverviewSummaryWithRunoffPriority(summaryByTurn);

  if (STATE.municipiosLayer?.refresh) STATE.municipiosLayer.refresh();

  refreshMunicipalSelectionOverlay();

  if (shouldSyncResults) {
    renderMunicipalStatewidePartyResults(STATE.currentMapMuniSummary, uf);
  }
  return true;
}

async function showMunicipalStatewideOverview(uf, year, subtype = 'ord') {
  if (!map || !uf || STATE.currentElectionType !== 'municipal') return;

  const viewGen = ++MUNICIPAL_VIEW_GENERATION;

  // Um load municipal em andamento esta mutando currentLayer/currentMapMode;
  // adia o overview ate ele terminar, desistindo se algo mais novo chegar.
  if (STATE.isLoadingDataset) {
    let tries = 0;
    const retry = () => {
      if (viewGen !== MUNICIPAL_VIEW_GENERATION) return;
      if (STATE.isLoadingDataset && ++tries < 40) { setTimeout(retry, 150); return; }
      if (!STATE.isLoadingDataset) showMunicipalStatewideOverview(uf, year, subtype);
    };
    setTimeout(retry, 150);
    return;
  }

  showMapLoading(`Carregando resumo estadual de ${uf} (${year})...`);

  try {
    // Busca os dados ANTES de mexer em qualquer camada/estado: se a busca
    // falhar, a visao anterior permanece intacta.
    const [geojson, summary] = await Promise.all([
      fetchMunicipalPolygonGeoJSON(uf),
      (typeof window.loadMunicipalOverviewSummary === 'function'
        ? window.loadMunicipalOverviewSummary(uf, year, subtype)
        : Promise.resolve({}))
    ]);

    // Overview superado por um load municipal ou outro overview mais novo.
    if (viewGen !== MUNICIPAL_VIEW_GENERATION) return;

    clearSelection(true);
    // Ao voltar ao resumo estadual, filtros demograficos ativos sao descartados
    // (eles so operam sobre um municipio selecionado).
    if (typeof window.resetAllCensusFilters === 'function') window.resetAllCensusFilters();
    STATE.pendingMunicipalFocusBounds = null;
    STATE.currentMapMode = 'municipios';
    STATE.currentMapMuniUF = uf;

    if (currentLayer && map.hasLayer(currentLayer)) {
      map.removeLayer(currentLayer);
    }

    STATE.currentMapMuniSummaryByTurn = summary || { '1T': {}, '2T': {} };
    STATE.currentMapMuniSummary = getMunicipalOverviewSummaryWithRunoffPriority(STATE.currentMapMuniSummaryByTurn);

    if (STATE.municipiosLayer && map.hasLayer(STATE.municipiosLayer)) {
      map.removeLayer(STATE.municipiosLayer);
    }

    STATE.municipiosLayer = createMunicipiosGeoLayer(geojson, (feature) => {
      const nome = getMunicipalityFeatureName(feature.properties);
      const matchedOption = Array.from(dom.selectMunicipio?.options || []).find((option) => option.value && matchesMunicipioName(nome, option.value));
      if (matchedOption) {
        dom.selectMunicipio.value = matchedOption.value;
      } else if (dom.selectMunicipio) {
        dom.selectMunicipio.value = nome;
      }
      setPendingMunicipalFocusBounds(feature);
      focusSelectedMunicipalityOnMap({ animate: true, duration: 0.45, preferPending: true });
      dom.selectMunicipio?.dispatchEvent(new Event('change'));
    });
    STATE.municipiosLayer.addTo(map);

    const bounds = STATE.municipiosLayer.getBounds();
    MLCompat.fitMapToBounds(map, bounds, { padding: [20, 20], animate: false });

    if (dom.btnMapModeMunicipios) dom.btnMapModeMunicipios.classList.add('active');
    if (dom.btnMapModeLocais) dom.btnMapModeLocais.classList.remove('active');

    renderMunicipalStatewidePartyResults(STATE.currentMapMuniSummary, uf);
  } catch (error) {
    console.error('[Municipal] Falha ao montar resumo estadual:', error);
    showToast(`Erro ao carregar o resumo estadual: ${error.message}`, 'error');
  } finally {
    hideMapLoading();
  }
}

if (typeof window !== 'undefined') {
  window.getMunicipalityFeatureCode = getMunicipalityFeatureCode;
  window.getMunicipalityFeatureName = getMunicipalityFeatureName;
  window.showMunicipalStatewideOverview = showMunicipalStatewideOverview;
  window.focusSelectedMunicipalityOnMap = focusSelectedMunicipalityOnMap;
  window.refreshMunicipalSelectionOverlay = refreshMunicipalSelectionOverlay;
  window.refreshMunicipalStatewideOverviewForTurn = refreshMunicipalStatewideOverviewForTurn;
  window.resolveProportionalGroupInfo = resolveProportionalGroupInfo;
  window.getCachedGroupedProportionalInfo = getCachedGroupedProportionalInfo;
}

function focusSelectionOnMap(options = {}) {
  if (!map || !currentLayer || !selectedLocationIDs.size) return false;

  const allFeatures = CURRENT_VISIBLE_FEATURES_CACHE || [];
  const selectedFeatures = allFeatures.filter((feature) =>
    selectedLocationIDs.has(resolveFeatureSelectionId(feature?.properties))
  );

  if (!selectedFeatures.length) return false;

  if (selectedFeatures.length === 1) {
    const center = MLCompat.featureCenter(selectedFeatures[0]);
    if (!center) return false;
    const targetZoom = Math.max(map.getZoom() || 0, options.singleZoom || 16);
    map.flyTo({ center, zoom: targetZoom, duration: 600, essential: true });
    return true;
  }

  const bounds = MLCompat.featureCollectionBounds(selectedFeatures);
  return MLCompat.fitMapToBounds(map, bounds, {
    animate: true,
    duration: 0.6,
    padding: options.padding || [32, 32],
    maxZoom: options.maxZoom || 16
  });
}

function focusCurrentLayerOnMap(options = {}) {
  if (!map || !currentLayer) return false;

  const bounds = currentLayer.getBounds();
  return MLCompat.fitMapToBounds(map, bounds, {
    animate: true,
    duration: 0.6,
    padding: options.padding || [32, 32],
    maxZoom: options.maxZoom || 16
  });
}

function showOfficialCityResultPanel(entry, cityName) {
  dom.resultsBox.classList.remove('section-hidden');
  dom.resultsTitle.textContent = toTitleCase(cityName);
  dom.resultsSubtitle.textContent = 'Resultado oficial • sem locais cadastrados';
  if (dom.btnLocateSelection) dom.btnLocateSelection.style.display = 'none';
  dom.summaryGrid.innerHTML = '';

  const isProportional = typeof currentCargo === 'string' && (currentCargo.startsWith('deputado') || currentCargo.startsWith('vereador'));
  const rawVotes = entry.rawTotals || entry.rawVotes;
  if (isProportional && rawVotes) {
    const isVereador = currentCargo.startsWith('vereador');
    const typeKey = isVereador ? 'v' : (currentCargo === 'deputado_federal' ? 'f' : 'e');
    const metaStore = isVereador ? (STATE.vereadorMetadata || {}) : (STATE.deputyMetadataByType?.[typeKey] || STATE.deputyMetadata || {});
    const prefixCache = isVereador ? (STATE._vereadorPartyPrefixCache || {}) : (STATE._partyPrefixCache || {});

    const inaptos = isVereador ? (STATE.inaptos['vereador_ord']?.['1T'] || []) : (STATE.inaptos[currentCargo]?.['1T'] || []);
    const inaptosSet = STATE.filterInaptos ? new Set(inaptos) : null;
    const groups = new Map();
    let totalVotes = 0;
    let brancos = 0;
    let nulos = 0;

    Object.entries(rawVotes || {}).forEach(([candidateId, rawVotesVal]) => {
      const votes = ensureNumber(rawVotesVal);
      if (candidateId === '95') {
        brancos += votes;
        return;
      }
      if (candidateId === '96') {
        nulos += votes;
        return;
      }
      if (inaptosSet && inaptosSet.has(candidateId)) return;

      totalVotes += votes;
      const groupInfo = resolveProportionalGroupInfo(candidateId, metaStore, prefixCache);
      const group = groups.get(groupInfo.key) || {
        ...groupInfo,
        votes: 0,
        dominantParties: new Map(),
        candidates: new Map()
      };

      group.votes += votes;
      group.dominantParties.set(groupInfo.party, (group.dominantParties.get(groupInfo.party) || 0) + votes);

      if (String(candidateId).length > 2) {
        const metadata = metaStore[candidateId] || [];
        const candidate = group.candidates.get(candidateId) || {
          id: candidateId,
          nome: metadata[0] || candidateId,
          partido: groupInfo.party,
          status: metadata[2] || '',
          votos: 0
        };
        candidate.votos += votes;
        group.candidates.set(candidateId, candidate);
      }

      groups.set(groupInfo.key, group);
    });

    const groupsPayload = {
      groups: Array.from(groups.values()),
      totalVotes,
      brancos,
      nulos,
      comparecimento: totalVotes + brancos + nulos
    };

    const turnoutStats = getTurnoutStatsForSelection(null, currentCargo, '1T', groupsPayload.comparecimento);
    dom.resultsSubtitle.textContent = `${(groupsPayload.groups || []).length} listas classificadas`;

    if (typeof window.renderProportionalExpandableList === 'function') {
      window.renderProportionalExpandableList(groupsPayload, {
        extraMetrics: '',
        comparecimento: groupsPayload.comparecimento,
        brancos: groupsPayload.brancos,
        nulos: groupsPayload.nulos,
        ratio: turnoutStats.ratio
      });
    }
    updateNeighborhoodProfileUI();
    return;
  }

  const totalValid = entry.totalValid || 0;
  const sortedVotes = Object.entries(entry.votes || {})
    .filter(([, v]) => ensureNumber(v) > 0)
    .sort((a, b) => ensureNumber(b[1]) - ensureNumber(a[1]))
    .slice(0, 15);

  if (!sortedVotes.length) {
    dom.resultsContent.innerHTML =
      '<div style="text-align:center;padding:20px;color:var(--muted)">Sem dados disponíveis.</div>';
    dom.resultsMetrics.innerHTML = '';
    updateNeighborhoodProfileUI();
    return;
  }

  const formatPct = (val) => {
    if (typeof fmtPct === 'function') return fmtPct(val);
    return (val * 100).toFixed(2) + '%';
  };

  const isEarlyMajoritarianWith2T = (window.STATE?.currentElectionYear === '2000' || window.STATE?.currentElectionYear === '2004')
    && window.currentCargo?.startsWith('prefeito')
    && window.currentTurno === 1
    && window.STATE?.dataHas2T?.[window.currentCargo];

  const tableRows = sortedVotes.map(([key, votesRaw], idx) => {
    const votes = ensureNumber(votesRaw);
    const pctVal = totalValid > 0 ? (votes / totalValid) : 0;
    
    let name = key;
    let party = '';
    let status = '';
    let isSpecial = false;
    
    const match = key.match(/^(.*?)\s*\(([^)]+)\)\s*\(([^)]+)\)(?:\s*(\d+T))?$/);
    if (match) {
      name = match[1].trim();
      party = match[2].trim();
      
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
      
      status = match[3].trim().toUpperCase();
      isSpecial = status === 'ELEITO' || status === '2° TURNO' || status === '2º TURNO';
      if (isEarlyMajoritarianWith2T && idx < 2) {
        isSpecial = true;
      }
    } else {
      let cleanedKey = key.replace(/^(group:|party:)/, '').replace(/_/g, ' ').trim();
      name = cleanedKey;
      party = cleanedKey;
    }
    
    const sw = getColorForCandidate(name, party) || (typeof DEFAULT_SWATCH !== 'undefined' ? DEFAULT_SWATCH : '#888888');
    const checkCircleHtml = isSpecial
      ? `<span class="cand-check-circle" style="background-color: ${sw};">✔</span>`
      : '';

    const nameHtml = `
      <div class="cand-name-container">
        ${checkCircleHtml}
        <span class="cand-name-text">${escapeHtml(toTitleCase(name))}</span>
      </div>
    `;

    return `
      <tr>
        <td class="color-bar-td">
          <button type="button" class="swatch-button cand-color-bar"
               style="background-color: ${sw};"
               data-candidate-name="${escapeHtml(name)}"
               data-candidate-party="${escapeHtml(party)}"
               data-current-color="${sw}"
               title="Cor do candidato"></button>
        </td>
        <td class="align-left">
          ${nameHtml}
          ${party ? `<div style="font-size: 0.65rem; color: var(--muted); margin-top: 2px;">${escapeHtml(party.toUpperCase())}</div>` : ''}
        </td>
        <td class="align-center cand-votes-text">
          ${fmtInt(votes)}
        </td>
        <td class="align-center">
          <div class="pct-bar-container">
            <span class="pct-text">${formatPct(pctVal)}</span>
            <div class="cand-mini-bar-wrap">
              <div class="cand-mini-bar" style="width: ${pctVal * 100}%; background-color: ${sw};"></div>
            </div>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  dom.resultsContent.innerHTML = `
    <table class="cand-table">
      <thead>
        <tr>
          <th class="color-bar-td"></th>
          <th class="align-left">Candidato</th>
          <th class="align-center">Votos</th>
          <th class="align-center">Pct.</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  `;

  // Estatísticas extras
  const rawTotals = entry.rawTotals || {};
  const brancos = ensureNumber(rawTotals['95']) || 0;
  const nulos = ensureNumber(rawTotals['96']) || 0;
  const invalidos = brancos + nulos;
  const comparecimento = totalValid + invalidos;
  const invalidosPct = comparecimento > 0 ? (invalidos / comparecimento) : 0;

  dom.resultsMetrics.innerHTML = `
    <div class="metrics-grid">
      <div class="metric-item">
        <span>Votos válidos</span>
        <strong>${fmtInt(totalValid)}</strong>
      </div>
      <div class="metric-item">
        <span>Comparecimento</span>
        <strong>${fmtInt(comparecimento)}</strong>
      </div>
      <div class="metric-item">
        <span>Votos inválidos</span>
        <strong>${fmtInt(invalidos)} (${formatPct(invalidosPct)})</strong>
      </div>
    </div>
  `;

  updateNeighborhoodProfileUI();
}

function syncResultsPanelToCurrentView() {
  if (!currentDataCollection[currentCargo]) return;

  if (currentCargo.startsWith('deputado') && typeof syncDeputyDataForCargo === 'function') {
    syncDeputyDataForCargo(currentCargo);
  }

  if (selectedLocationIDs.size > 0) {
    updateSelectionUI(STATE.isFilterAggregationActive);
    return;
  }

  // Para eleições gerais de 2002 e 2006, se um município estiver selecionado,
  // nós SEMPRE devemos exibir o resultado consolidado oficial do município (totals do JSON),
  // e nunca a soma parcial dos locais de votação geocodificados.
  const year = String(STATE.currentElectionYear);
  if ((year === '2002' || year === '2006') &&
      currentCidadeFilter !== 'all' &&
      STATE.currentElectionType === 'geral') {
    const slug = normalizeMunicipioSlug(String(currentCidadeFilter));
    let entry = STATE.currentMapMuniSummary?.[slug];

    if (!entry && STATE.generalOfficialTotalsByCity) {
      const turnoKey = getActiveTurnoKeyForCurrentCargo(currentCargo);
      const cityTotals = STATE.generalOfficialTotalsByCity[currentCargo]?.[turnoKey];
      if (cityTotals) {
        const matchKey = Object.keys(cityTotals).find(k => normalizeMunicipioSlug(k) === slug);
        if (matchKey) {
          const raw = cityTotals[matchKey];
          const totalValid = ensureNumber(raw.totalValidos) ||
            Object.values(raw.votesByDisplayKey || {}).reduce((s, v) => s + ensureNumber(v), 0);
          entry = { nome: String(currentCidadeFilter), totalValid, votes: raw.votesByDisplayKey || {} };
        }
      }
    }

    if (!entry && String(currentCargo).startsWith('deputado')) {
      const isEstadual = currentCargo === 'deputado_estadual';
      const typeKey = isEstadual ? 'e' : 'f';
      const metaStore = STATE.deputyMetadataByType?.[typeKey] || STATE.deputyMetadata || {};
      const prefixCache = STATE._partyPrefixCache || {};
      const aliases = typeof getMunicipioAliasSlugs === 'function'
        ? getMunicipioAliasSlugs(currentCidadeFilter)
        : [normalizeMunicipioSlug(currentCidadeFilter)];

      const geojson = currentDataCollection[currentCargo];
      if (geojson && geojson.features && STATE.deputyResults) {
        const groupVotes = {};
        const rawVotesConsolidated = {};
        let totalValid = 0;
        let matchFound = false;

        // Construir o mapa de código TSE para nome do município
        const codToNameMap = new Map();
        geojson.features.forEach((feature) => {
          const props = feature.properties || {};
          const locId = String(props.id_unico || props.local_key || '');
          const cityName = String(props.nm_localidade || '').trim();
          if (locId && cityName) {
            const parts = locId.split('_');
            if (parts.length >= 3) {
              const cdMuni = parts[1];
              if (cdMuni && !codToNameMap.has(cdMuni)) {
                codToNameMap.set(cdMuni, cityName);
              }
            }
          }
        });

        // Somar os votos de todos os locais da base de dados bruta
        Object.entries(STATE.deputyResults).forEach(([locId, typeMap]) => {
          const parts = locId.split('_');
          if (parts.length < 3) return;
          const cdMuni = parts[1];
          const cityName = codToNameMap.get(cdMuni);
          if (!cityName) return;

          const featureSlug = normalizeMunicipioSlug(cityName);
          if (aliases.includes(featureSlug)) {
            const votes = typeMap[typeKey];
            if (votes) {
              matchFound = true;
              Object.entries(votes).forEach(([candId, v]) => {
                const vNum = ensureNumber(v);
                if (vNum <= 0) return;
                rawVotesConsolidated[candId] = (rawVotesConsolidated[candId] || 0) + vNum;
                if (candId === '95' || candId === '96') return;
                const groupInfo = resolveProportionalGroupInfo(candId, metaStore, prefixCache);
                groupVotes[groupInfo.key] = (groupVotes[groupInfo.key] || 0) + vNum;
                totalValid += vNum;
              });
            }
          }
        });

        if (matchFound && totalValid > 0) {
          entry = {
            nome: String(currentCidadeFilter),
            totalValid,
            votes: groupVotes,
            rawVotes: rawVotesConsolidated
          };
        }
      }
    }

    if (entry) {
      showOfficialCityResultPanel(entry, String(currentCidadeFilter));
      return;
    }
  }

  const visibleFeatures = CURRENT_VISIBLE_FEATURES_CACHE || [];
  const hasRealLocations = visibleFeatures.some(f => f.geometry !== null && f.geometry !== undefined);
  if (!visibleFeatures.length || !hasRealLocations) {
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
  // NÃ£o apenas as visÃ­veis no viewport
  const geojson = currentDataCollection[currentCargo];
  if (!geojson || !geojson.features) return [];

  return geojson.features.filter(f => filterFeature(f));
}

// ====== SHIFT+DRAG SELECTION LOGIC ======
function setupBoxSelection() {
  const mapContainer = map.getContainer();

  // Desativa o box-zoom nativo (shift+arrasto) para não conflitar com a seleção
  if (map.boxZoom) map.boxZoom.disable();

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
  if (map.dragPan) map.dragPan.disable();

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
  if (map.dragPan) map.dragPan.enable();

  // Perform Final Selection Logic
  const mapContainer = map.getContainer();
  const rect = mapContainer.getBoundingClientRect();
  const endX = e.clientX - rect.left;
  const endY = e.clientY - rect.top;

  // Se o arrasto foi muito pequeno, trata como clique simples (o handler de
  // clique da layer cuida do shift+clique). Não processamos seleção por bloco.
  const dist = Math.sqrt(Math.pow(endX - startSelectionPoint.x, 2) + Math.pow(endY - startSelectionPoint.y, 2));
  if (dist < 5) return;

  const minX = Math.min(startSelectionPoint.x, endX);
  const maxX = Math.max(startSelectionPoint.x, endX);
  const minY = Math.min(startSelectionPoint.y, endY);
  const maxY = Math.max(startSelectionPoint.y, endY);

  // Identifica features renderizadas dentro do retângulo (coordenadas de tela).
  selectFeaturesInPixelBox([[minX, minY], [maxX, maxY]]);
}

function updateSelectionBox(x, y, w, h) {
  selectionBoxElement.style.left = x + 'px';
  selectionBoxElement.style.top = y + 'px';
  selectionBoxElement.style.width = w + 'px';
  selectionBoxElement.style.height = h + 'px';
}

function selectFeaturesInPixelBox(pixelBox) {
  if (!currentLayer || !map) return;

  const layerId = 'locais-circle';
  if (!map.getLayer(layerId)) return;

  let addedCount = 0;
  if (STATE.isFilterAggregationActive) {
    selectedLocationIDs.clear();
  }

  const found = map.queryRenderedFeatures(pixelBox, { layers: [layerId] });
  found.forEach((feat) => {
    const id = resolveFeatureSelectionId(feat.properties);
    if (id && !selectedLocationIDs.has(id)) {
      selectedLocationIDs.add(id);
      addedCount++;
    }
  });

  if (addedCount > 0) {
    isDragSelection = true;
    updateSelectionUI(false); // Treat as manual selection
    // Atualiza o destaque dos itens recém-selecionados
    if (currentLayer && currentLayer.resetStyle) currentLayer.resetStyle();
  }
}


// FunÃ§Ã£o auxiliar para gerar o texto do tÃ­tulo baseado nos filtros ativos
function getActiveCensusFilterLabel() {
  const f = STATE.censusFilters;

  // 1. Filtro de Renda
  if (f.rendaMin !== null || f.rendaMax !== null) {
    const min = (f.rendaMin || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
    const max = f.rendaMax ? (f.rendaMax).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : 'Máx (+R$ 10k)';
    return `Renda Média: ${min} a ${max}`;
  }

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

/**
 * Atualiza instantaneamente as cores e os tooltips de todas as camadas do mapa
 * para refletir mudanças nos CUSTOM_PARTY_COLORS.
 */
function refreshMapStylesAndTooltips() {
  const summary = STATE.currentMapMuniSummary;

  // Recolore as camadas recomputando as props (cor/opacidade) e re-enviando os
  // dados; os tooltips são reconstruídos dinamicamente ao passar o mouse.
  // 1. Camada de municípios (overview)
  if (STATE.municipiosLayer && map.hasLayer(STATE.municipiosLayer)) {
    STATE.municipiosLayer.refresh();
  }

  // 2. Camada de pontos (locais de votação)
  if (currentLayer && map.hasLayer(currentLayer)) {
    currentLayer.refresh();
  }

  // Sincroniza painéis secundários que dependem da visão atual
  if (typeof syncResultsPanelToCurrentView === 'function') {
    syncResultsPanelToCurrentView();
  }
}

// Exporta para uso global
window.refreshMapStylesAndTooltips = refreshMapStylesAndTooltips;

window.clearSelection = clearSelection;
window.getAllFeaturesForAggregation = getAllFeaturesForAggregation;
window.focusSelectionOnMap = focusSelectionOnMap;
window.focusCurrentLayerOnMap = focusCurrentLayerOnMap;
window.syncResultsPanelToCurrentView = syncResultsPanelToCurrentView;


