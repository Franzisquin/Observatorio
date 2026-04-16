
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
  if (candidateData.isLegenda) return `Voto de Legenda â€” ${candidateData.partido}`;
  return `${toTitleCase(candidateData.nome)} (${candidateData.partido}) â€¢ NÂº ${candidateData.numero}`;
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
          nome = `Voto de Legenda â€” ${partido}`;
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
        ? `Buscar entre ${deputySearchCandList.length} candidatos (nome ou nÂº)...`
        : 'Nenhum candidato disponÃ­vel';
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

  // NÃ£o Ã© deputado: esconde search box, mostra select
  dom.selectVizCandidato.style.display = '';
  if (deputySearchBox) deputySearchBox.style.display = 'none';

  // EleiÃ§Ãµes gerais/municipais: comportamento original
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

  // NavegaÃ§Ã£o por teclado
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
  if (!props) return 'MunicÃ­pio';
  return String(
    props.NM_MUN ||
    props.nm_mun ||
    props.municipio ||
    props.nm_localidade ||
    props.NOME ||
    'MunicÃ­pio'
  ).trim();
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

function resolveProportionalGroupInfo(candidateId, metaStore, prefixCache) {
  const candidateKey = String(candidateId || '').trim();
  const meta = metaStore?.[candidateKey] || null;

  if (candidateKey.length <= 2) {
    const legendParty = normalizePartyAlias(String(prefixCache?.[candidateKey] || meta?.[1] || candidateKey).toUpperCase());
    const groupedPartyInfo = getGroupedProportionalInfoByParty(metaStore).get(legendParty);
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

  if (hasGroupedComposition) {
    return {
      key: `group:${norm(normalizedComposition)}`,
      name: validCoalitionName ? rawCoalitionName : rawComposition,
      composition: rawComposition,
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

function aggregateProportionalVotesByList(votesMap, metaStore, prefixCache) {
  const groups = new Map();
  let total = 0;

  Object.entries(votesMap || {}).forEach(([candidateId, rawVotes]) => {
    if (candidateId === '95' || candidateId === '96') return;
    const votes = ensureNumber(rawVotes);
    if (votes <= 0) return;

    const groupInfo = resolveProportionalGroupInfo(candidateId, metaStore, prefixCache);
    const existing = groups.get(groupInfo.key) || {
      ...groupInfo,
      votes: 0,
      parties: new Map(),
      candidates: []
    };

    existing.votes += votes;
    existing.parties.set(groupInfo.party, (existing.parties.get(groupInfo.party) || 0) + votes);

    const meta = metaStore?.[candidateId] || null;
    if (candidateId.length > 2) {
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

    group.candidates.sort((a, b) => b.votos - a.votos);
    return {
      ...group,
      color: colorForParty(dominantParty),
      party: dominantParty
    };
  }).sort((a, b) => b.votes - a.votes);

  return { groups: results, total };
}

function getWinningProportionalListData(votesMap, type = 'deputado') {
  const isVereadorList = type === 'vereador';
  const metaStore = isVereadorList ? STATE.vereadorMetadata : STATE.deputyMetadata;
  const prefixCache = isVereadorList ? STATE._vereadorPartyPrefixCache : STATE._partyPrefixCache;
  const aggregated = aggregateProportionalVotesByList(votesMap, metaStore, prefixCache);
  const winner = aggregated.groups[0] || null;
  if (!winner) return null;
  return {
    ...winner,
    total: aggregated.total,
    pct: aggregated.total > 0 ? (winner.votes / aggregated.total) * 100 : 0,
    marginPct: getWinningMarginPct(aggregated.groups.map((group) => group.votes), aggregated.total)
  };
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
  return typeof toTitleCase === 'function' ? toTitleCase(text) : text;
}

function buildLocationTooltip(feature) {
  const props = feature.properties || {};
  const nomeLocal = formatTooltipDisplayName(getProp(props, 'nm_locvot') || 'Local');
  const nomeCidade = formatTooltipDisplayName(getProp(props, 'nm_localidade') || 'Cidade');
  const turnoKey = (currentTurno === 2 && STATE.dataHas2T[currentCargo]) ? '2T' : '1T';

  let totalValidos = 0;
  let rows = '';

  if (currentCargo.startsWith('deputado') || currentCargo.startsWith('vereador')) {
    const proportionalData = currentCargo.startsWith('vereador')
      ? getVereadorFeatureData(props)
      : getDeputyFeatureData(props);
    const grouped = proportionalData?.votes
      ? aggregateProportionalVotesByList(
        proportionalData.votes,
        currentCargo.startsWith('vereador') ? STATE.vereadorMetadata : STATE.deputyMetadata,
        currentCargo.startsWith('vereador') ? STATE._vereadorPartyPrefixCache : STATE._partyPrefixCache
      )
      : { groups: [], total: 0 };

    totalValidos = grouped.total || 0;
    grouped.groups.slice(0, 4).forEach((group) => {
      const pct = totalValidos > 0 ? (group.votes / totalValidos) * 100 : 0;
      rows += `<div style="display:flex;align-items:center;gap:5px;margin:2px 0;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${group.color};flex-shrink:0;"></span>
        <span style="flex:1;font-size:0.75rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(formatTooltipDisplayName(group.name))}</span>
        <span style="font-size:0.75rem;font-weight:600;white-space:nowrap;">${pct.toFixed(1)}%</span>
        <span style="font-size:0.7rem;color:#aaa;white-space:nowrap;">(${fmtInt(group.votes)})</span>
      </div>`;
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
      rows += `<div style="display:flex;align-items:center;gap:5px;margin:2px 0;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${getColorForCandidate(candidate.name, candidate.party)};flex-shrink:0;"></span>
        <span style="flex:1;font-size:0.75rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(formatTooltipDisplayName(candidate.name))}</span>
        <span style="font-size:0.75rem;font-weight:600;white-space:nowrap;">${pct.toFixed(1)}%</span>
        <span style="font-size:0.7rem;color:#aaa;white-space:nowrap;">(${fmtInt(candidate.votes)})</span>
      </div>`;
    });
  }

  if (!rows) {
    rows = '<div style="font-size:0.7rem;color:#aaa;">Sem votos vÃ¡lidos neste local.</div>';
  }

  return `<div style="min-width:190px;max-width:250px;">
    <div style="font-weight:600;font-size:0.82rem;margin-bottom:2px;">${escapeHtml(nomeLocal)}</div>
    <div style="font-size:0.72rem;color:#aaa;margin-bottom:6px;">${escapeHtml(nomeCidade)}</div>
    <div style="font-size:0.7rem;color:#aaa;margin-bottom:4px;">Votos vÃ¡lidos: ${fmtInt(totalValidos)}</div>
    <hr style="margin:4px 0;border-color:#444;">
    ${rows}
  </div>`;
}

function buildMunicipalityTooltip(feature, summary) {
  const nome = formatTooltipDisplayName(getMunicipalityFeatureName(feature?.properties));
  const result = getMunicipalSummaryEntryForFeature(feature?.properties, summary);
  const uf = dom.selectUFMunicipal?.value || dom.selectUFGeneral?.value || '';
  const ufLabel = UF_MAP.get(uf) || uf;

  if (!result) {
    return `<div style="min-width:180px;max-width:240px;">
      <div style="font-weight:600;font-size:0.82rem;margin-bottom:2px;">${escapeHtml(nome)}</div>
      <div style="font-size:0.72rem;color:#aaa;margin-bottom:6px;">${escapeHtml(ufLabel)}</div>
      <div style="font-size:0.7rem;color:#aaa;">Sem resultados resumidos disponÃ­veis.</div>
    </div>`;
  }

  let rows = '';
  Object.entries(result.votes || {})
    .map(([key, votes]) => {
      const info = parseCandidateKey(key);
      return {
        name: info.nome,
        party: info.partido,
        votes: ensureNumber(votes)
      };
    })
    .filter((candidate) => candidate.votes > 0)
    .sort((a, b) => b.votes - a.votes)
    .slice(0, 4)
    .forEach((candidate) => {
      const pct = result.totalValid > 0 ? (candidate.votes / result.totalValid) * 100 : 0;
      rows += `<div style="display:flex;align-items:center;gap:5px;margin:2px 0;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${getColorForCandidate(candidate.name, candidate.party)};flex-shrink:0;"></span>
        <span style="flex:1;font-size:0.75rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(formatTooltipDisplayName(candidate.name))}</span>
        <span style="font-size:0.75rem;font-weight:600;white-space:nowrap;">${pct.toFixed(1)}%</span>
        <span style="font-size:0.7rem;color:#aaa;white-space:nowrap;">(${fmtInt(candidate.votes)})</span>
      </div>`;
    });

  return `<div style="min-width:190px;max-width:260px;">
    <div style="font-weight:600;font-size:0.82rem;margin-bottom:2px;">${escapeHtml(nome)}</div>
    <div style="font-size:0.72rem;color:#aaa;margin-bottom:4px;">${escapeHtml(ufLabel)}</div>
    <div style="font-size:0.7rem;color:#aaa;margin-bottom:2px;">${escapeHtml(result.turnoLabel || 'Resultado final')}</div>
    <div style="font-size:0.7rem;color:#aaa;margin-bottom:4px;">Votos vÃ¡lidos: ${fmtInt(result.totalValid)}</div>
    <hr style="margin:4px 0;border-color:#444;">
    ${rows || '<div style="font-size:0.7rem;color:#aaa;">Sem detalhamento disponÃ­vel.</div>'}
  </div>`;
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

function buildGeneralMunicipalityOverviewSummary(cargoKey = currentCargo) {
  const geojson = currentDataCollection[cargoKey];
  if (!geojson?.features?.length) return {};

  const turnoKey = getActiveTurnoKeyForCurrentCargo(cargoKey);
  const turnoLabel = turnoKey === '2T' ? '2Âº Turno' : '1Âº Turno';
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
        totalValid: 0
      };
      grouped.set(cityName, entry);
    }

    if (cargoKey.startsWith('deputado')) {
      const isEstadual = cargoKey === 'deputado_estadual';
      const typeKey = isEstadual ? 'e' : 'f';
      const locId = resolveFeatureSelectionId(props);
      const data = STATE.deputyResults?.[locId];
      if (!data || !data[typeKey]) return;

      const votes = data[typeKey]; // { candId: votes }
      Object.entries(votes).forEach(([candId, count]) => {
        if (candId === '95' || candId === '96') return; // Skip brancos/nulos here
        if (STATE.filterInaptos && inaptosTurno.includes(candId)) return;

        const v = ensureNumber(count);
        if (v <= 0) return;

        // Aggregate by Party Name for Tooltips and Municipality Summary
        const meta = STATE.deputyMetadata?.[candId];
        const party = meta ? meta[1] : (candId.length === 2 ? candId : 'N/D');
        const partyKey = `${party} (${party})`;

        entry.votes[partyKey] = (entry.votes[partyKey] || 0) + v;
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
  grouped.forEach((entry) => {
    const orderedVotes = Object.entries(entry.votes)
      .filter(([, votes]) => ensureNumber(votes) > 0)
      .sort((a, b) => ensureNumber(b[1]) - ensureNumber(a[1]));

    if (!orderedVotes.length || entry.totalValid <= 0) return;

    const [winnerKey, winnerVotesRaw] = orderedVotes[0];
    const [, secondVotesRaw] = orderedVotes[1] || [null, 0];
    let winnerInfo;
    if (cargoKey.startsWith('deputado')) {
      // For deputies, the key is already "PARTY (PARTY)"
      winnerInfo = parseCandidateKey(winnerKey);
    } else {
      winnerInfo = parseCandidateKey(winnerKey);
    }
    const winnerVotes = ensureNumber(winnerVotesRaw);
    const secondVotes = ensureNumber(secondVotesRaw);

    const summaryEntry = {
      nome: entry.nome,
      muniCode: entry.muniCode,
      winnerCode: winnerKey,
      winnerName: winnerInfo.nome || 'N/D',
      winnerParty: winnerInfo.partido || '',
      totalValid: entry.totalValid,
      margin: entry.totalValid > 0 ? ((winnerVotes - secondVotes) / entry.totalValid) * 100 : 0,
      turno: turnoKey,
      turnoLabel,
      votes: entry.votes,
      rawTotals: entry.votes,
      isDetailed: true
    };
    if (entry.muniCode) summary[entry.muniCode] = summaryEntry;
    summary[normalizeMunicipioSlug(entry.nome)] = summaryEntry;
  });

  return summary;
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
  dom.resultsSubtitle.textContent = `${ufName} â€¢ nenhum local encontrado`;
  dom.resultsContent.innerHTML = '<p style="color:var(--muted)">Nenhum local agregado disponÃ­vel para este recorte.</p>';
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

async function showGeneralMunicipalityOverview(uf) {
  const ufNorm = String(uf || '').toUpperCase();
  if (!map || !ufNorm || ufNorm === 'BR' || STATE.currentElectionType !== 'geral') return;

  showMapLoading(`Carregando visÃ£o municipal de ${ufNorm}...`);

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

    STATE.municipiosLayer = L.geoJSON(geojson, {
      style: (feature) => getMunicipalPolygonStyle(feature, STATE.currentMapMuniSummary),
      onEachFeature: (feature, layer) => {
        layer.bindTooltip(buildMunicipalityTooltip(feature, STATE.currentMapMuniSummary), {
          className: 'sim-tooltip',
          sticky: true
        });

        layer.on({
          mouseover: () => {
            layer.setStyle({ weight: 1.4, color: '#ffffff' });
          },
          mouseout: () => {
            STATE.municipiosLayer?.resetStyle(layer);
          },
          click: () => {
            const nome = getMunicipalityFeatureName(feature.properties);
            const matchedCity = Array.from(uniqueCidades || []).find((candidate) => matchesMunicipioName(nome, candidate)) || nome;
            currentCidadeFilter = matchedCity;
            currentBairroFilter = 'all';
            currentLocalFilter = '';
            STATE.currentMapMode = 'locais';
            if (cidadeCombobox) cidadeCombobox.setValue(matchedCity);
            if (bairroCombobox) bairroCombobox.setValue('');
            if (dom.searchLocal) dom.searchLocal.value = '';
            populateBairroDropdown();
            updateApplyButtonText();
            applyFiltersAndRedraw();
          }
        });
      }
    }).addTo(map);

    const bounds = STATE.municipiosLayer.getBounds?.();
    if (bounds?.isValid?.()) {
      map.fitBounds(bounds, { padding: [20, 20] });
    }

    if (dom.btnMapModeMunicipios) dom.btnMapModeMunicipios.classList.add('active');
    if (dom.btnMapModeLocais) dom.btnMapModeLocais.classList.remove('active');

    renderGeneralStatewideMunicipalityResults(STATE.currentMapMuniSummary, ufNorm);
  } catch (error) {
    console.error('[Geral] Falha ao montar visÃ£o municipal:', error);
    showToast(`Erro ao carregar a visÃ£o municipal: ${error.message}`, 'error');
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
    // Busca por nÃºmero: exata no inÃ­cio
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
          ? `Voto de Legenda â€” ${candData.partido}`
          : `${toTitleCase(candData.nome)} (${candData.partido}) â€¢ NÂº ${candData.numero}`;
        input.value = label;
      }

      // Fechar dropdown
      container.classList.remove('visible');

      // Disparar evento de mudanÃ§a
      dom.selectVizCandidato.dispatchEvent(new Event('change'));
    });
  });
}

// ====== MAP RENDERING ======

// VariÃ¡vel para guardar o listener de movimento
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

  if (shouldRenderGeneralMunicipalityOverview()) {
    CURRENT_VISIBLE_FEATURES_CACHE = [];
    CURRENT_VISIBLE_PROPS_CACHE = [];
    void showGeneralMunicipalityOverview(dom.selectUFGeneral?.value);
    if (STATE.isLoadingDataset) {
      clearPendingFilterChanges();
    }
    return;
  }

  // O renderer canvas do Leaflet pode ter sido desalojado durante trocas
  // rÃ¡pidas de eleiÃ§Ã£o/cargo. Se ele ficou Ã³rfÃ£o, recriamos antes de renderizar.
  if (!mapCanvasRenderer || mapCanvasRenderer._map !== map) {
    mapCanvasRenderer = L.canvas({ padding: 0.5, tolerance: 10 });
  }

  // Recalcular estatÃ­sticas do candidato se estiver no modo Desempenho
  if (currentVizMode.startsWith('desempenho') && dom.selectVizCandidato?.value) {
    const candidatoKey = dom.selectVizCandidato.value;
    performanceModeStats = calculateCandidateStats(candidatoKey) || {
      candidato: candidatoKey, minPct: 0, maxPct: 100, avgPct: 0, totalLocais: 0
    };
    updatePerformanceStatsUI();
  }

  updateAvailabilityBars(geojson);

  // Precomputa vencedores de vereador se necessÃ¡rio
  if (currentCargo.startsWith('vereador') && STATE.vereadorResults && Object.keys(STATE.vereadorResults).length > 0) {
    precomputeVereadorWinners();
  }

  if (STATE.municipiosLayer && map.hasLayer(STATE.municipiosLayer)) {
    map.removeLayer(STATE.municipiosLayer);
  }

  STATE.currentMapMode = 'locais';
  if (dom.btnMapModeMunicipios) dom.btnMapModeMunicipios.classList.remove('active');
  if (dom.btnMapModeLocais) dom.btnMapModeLocais.classList.add('active');

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



// --- HELPER FUNCTIONS (ExtraÃ­das para reaproveitar nos dois modos) ---

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

  // Filtro de PresÃ­dios/Locais Especiais (ExclusÃ£o Global)
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

  // --- FILTRO DE DESEMPENHO (porcentagem mÃ­nima) ---
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

  // --- FILTROS CENSITÃRIOS ---

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

  // Helper de checagem genÃ©rica Pct ou Absoluto Calculado
  const checkDynamic = (filterVal, filterMode, type) => {
    if (filterVal === null) return true;

    // Se for Modo Legacy (2006) ou se o dado jÃ¡ vier como Pct explÃ­cito:
    // (Ainda precisamos suportar Pct direto para RaÃ§a e Saneamento)

    // RaÃ§a & Saneamento (Sempre Pct)
    if (type === 'raca' || type === 'saneamento') {
      const propVal = ensureNumber(getProp(props, filterMode));
      return propVal >= filterVal;
    }

    // Para GÃªnero, Idade, Escolaridade, Civil: Calcular dinamicamente
    let numerator = 0;
    let denominator = 0;

    // GÃªnero
    if (type === 'genero') {
      const h = getVal(['MASCULINO', 'HOMENS', 'Homens', 'Pct Homens']);
      const m = getVal(['FEMININO', 'MULHERES', 'Mulheres', 'Pct Mulheres']);

      // Fallback para legacy Pct direto se nÃ£o tiver absoluto
      // Se tiver Pct Homens e Pct Mulheres, getVal retornarÃ¡ eles.
      // Se for Pct, a soma deve ser ~100 (ou perto). Se for Absoluto, soma Ã© pop.

      const total = h + m;
      if (total === 0) return false;

      // Se for Pct, total Ã© ~100.
      // filterVal Ã© 0-100.

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
      const v = getVal(['VIÃšVO', 'VIUVO', 'ViÃºvo', 'Pct ViÃºvo']);
      const sep = getVal(['SEPARADO JUDICIALMENTE', 'SEPARADO', 'Separado', 'Pct Separado']);

      // DetecÃ§Ã£o de Modo Percentual (Legacy)
      // Se a soma for significativamente < da populaÃ§Ã£o total esperada (em absolutos) ou se for ~100
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
      else if (filterMode === 'ViÃºvo') num = v;
      else num = sep;

      return (num / den * 100) >= filterVal;
    }
    else if (type === 'escolaridade') {
      const ana = getVal(['ANALFABETO', 'Analfabeto', 'Pct Analfabeto']);
      const le = getVal(['LÃŠ E ESCREVE', 'LE E ESCREVE', 'LÃª e Escreve', 'Pct LÃª e Escreve']);
      const fi = getVal(['ENSINO FUNDAMENTAL INCOMPLETO', 'FUNDAMENTAL INCOMPLETO', 'Pct Fundamental Incompleto']);
      const fc = getVal(['ENSINO FUNDAMENTAL COMPLETO', 'FUNDAMENTAL COMPLETO', 'Pct Fundamental Completo']);
      const mi = getVal(['ENSINO MÃ‰DIO INCOMPLETO', 'MEDIO INCOMPLETO', 'Pct MÃ©dio Incompleto']);
      const mc = getVal(['ENSINO MÃ‰DIO COMPLETO', 'MEDIO COMPLETO', 'Pct MÃ©dio Completo']);
      const si = getVal(['ENSINO SUPERIOR INCOMPLETO', 'SUPERIOR INCOMPLETO', 'Pct Superior Incompleto']);
      const sc = getVal(['ENSINO SUPERIOR COMPLETO', 'SUPERIOR COMPLETO', 'Pct Superior Completo']);

      const isPct = (props['Pct Analfabeto'] !== undefined || props['Pct MÃ©dio Completo'] !== undefined);

      let den;
      let num;

      if (isPct) den = 100;
      else den = ana + le + fi + fc + mi + mc + si + sc;

      if (den === 0) return false;

      if (filterMode.includes('Analfabeto')) num = ana;
      else if (filterMode.includes('LÃª')) num = le;
      else if (filterMode === 'Fund. Incomp.') num = fi;
      else if (filterMode === 'Fund. Completo') num = fc;
      else if (filterMode === 'MÃ©dio Incomp.') num = mi;
      else if (filterMode === 'MÃ©dio Completo') num = mc;
      else if (filterMode === 'Superior Incompleto') num = si;
      else if (filterMode === 'Superior Completo') num = sc;

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
      fillColor = getUniversalGradientColor(fillColor, marginPct);

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
      fillColor = getUniversalGradientColor(fillColor, marginPct);
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
    fillColor = getUniversalGradientColor(fillColor, marginPct);
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
  layer.bindTooltip(buildLocationTooltip(feature), { className: 'sim-tooltip', sticky: false });
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
  if (dom.resultsTitle) dom.resultsTitle.textContent = 'Resultados da SeleÃ§Ã£o';
  if (dom.resultsSubtitle) dom.resultsSubtitle.textContent = '';
  if (dom.btnLocateSelection) dom.btnLocateSelection.style.display = 'none';
  // Reset Unified View
  if (dom.unifiedResultsContainer) dom.unifiedResultsContainer.classList.remove('hidden');
  updateNeighborhoodProfileUI();
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

    throw new Error(`Geometria municipal nÃ£o encontrada para ${ufNorm}.`);
  })();

  MUNICIPAL_POLYGON_CACHE.set(ufNorm, promise);
  return promise;
}

function getMunicipalPolygonStyle(feature, summary) {
  const result = getMunicipalSummaryEntryForFeature(feature?.properties, summary);
  if (!result) {
    return {
      fillColor: DEFAULT_SWATCH,
      fillOpacity: 0.25,
      color: 'rgba(255, 255, 255, 0.28)',
      weight: 0.8,
      opacity: 1
    };
  }

  const normalizedParty = normalizePartyAlias(String(result.winnerParty || '').toUpperCase());
  const baseColor = colorForParty(normalizedParty) || getColorForCandidate(result.winnerName, result.winnerParty);
  return {
    fillColor: getMarginAdjustedColor(baseColor, result.margin),
    fillOpacity: 0.78,
    color: 'rgba(255, 255, 255, 0.28)',
    weight: 0.8,
    opacity: 1
  };
}

function getMunicipalOverviewSummaryForTurn(summaryByTurn, turnoKey = getActiveTurnoKeyForCurrentCargo()) {
  const preferredTurno = String(turnoKey || '1T').toUpperCase();
  const preferredSummary = summaryByTurn?.[preferredTurno];
  if (preferredSummary && Object.keys(preferredSummary).length) return preferredSummary;
  if (preferredTurno !== '1T' && summaryByTurn?.['1T']) return summaryByTurn['1T'];
  if (summaryByTurn?.['2T']) return summaryByTurn['2T'];
  return {};
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
    tab.textContent = '1Âº Turno';
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
    tab.textContent = '2Âº Turno';
    tab.dataset.turno = 2;
    tab.addEventListener('click', () => {
      if (currentTurno === 2) return;
      currentTurno = 2;
      refreshTurnDependentUI();
    });
    dom.turnTabs.appendChild(tab);
  }
}

function renderMunicipalStatewidePartyResults(summary, uf) {
  const ufName = UF_MAP.get(uf) || uf;
  const partyTotals = new Map();

  Object.values(summary || {}).forEach((result) => {
    const partyKey = normalizePartyAlias(String(result?.winnerParty || '').toUpperCase());
    if (!partyKey) return;
    if (!partyTotals.has(partyKey)) {
      partyTotals.set(partyKey, {
        partido: partyKey,
        color: colorForParty(partyKey),
        count: 0
      });
    }
    partyTotals.get(partyKey).count += 1;
  });

  const results = Array.from(partyTotals.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.partido.localeCompare(b.partido, 'pt-BR');
  });

  dom.resultsBox.classList.remove('section-hidden');
  dom.summaryBoxContainer.classList.add('section-hidden');
  renderMunicipalOverviewTurnTabs(STATE.currentMapMuniSummaryByTurn);
  dom.resultsTitle.textContent = 'Prefeituras por partido';
  dom.resultsSubtitle.textContent = `${ufName} â€¢ ${fmtInt(results.reduce((sum, item) => sum + item.count, 0))} municÃ­pios`;
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

async function refreshMunicipalStatewideOverviewForTurn() {
  const uf = String(STATE.currentMapMuniUF || dom.selectUFMunicipal?.value || '').toUpperCase();
  if (!uf || STATE.currentElectionType !== 'municipal' || STATE.currentMapMode !== 'municipios') return false;

  const summaryByTurn = STATE.currentMapMuniSummaryByTurn
    || (typeof window.loadMunicipalOverviewSummary === 'function'
      ? await window.loadMunicipalOverviewSummary(uf, STATE.currentElectionYear, currentSubType || 'ord')
      : null);

  if (!summaryByTurn) return false;

  STATE.currentMapMuniSummaryByTurn = summaryByTurn;
  STATE.currentMapMuniSummary = getMunicipalOverviewSummaryForTurn(summaryByTurn);

  STATE.municipiosLayer?.eachLayer?.((layer) => {
    const feature = layer?.feature;
    if (!feature) return;

    if (typeof layer.setStyle === 'function') {
      layer.setStyle(getMunicipalPolygonStyle(feature, STATE.currentMapMuniSummary));
    }

    if (typeof layer.setTooltipContent === 'function') {
      layer.setTooltipContent(buildMunicipalityTooltip(feature, STATE.currentMapMuniSummary));
    }
  });

  renderMunicipalStatewidePartyResults(STATE.currentMapMuniSummary, uf);
  return true;
}

async function showMunicipalStatewideOverview(uf, year, subtype = 'ord') {
  if (!map || !uf || STATE.currentElectionType !== 'municipal') return;

  showMapLoading(`Carregando resumo estadual de ${uf} (${year})...`);
  clearSelection(true);

  try {
    STATE.currentMapMode = 'municipios';
    STATE.currentMapMuniUF = uf;

    if (currentLayer && map.hasLayer(currentLayer)) {
      map.removeLayer(currentLayer);
    }

    const [geojson, summary] = await Promise.all([
      fetchMunicipalPolygonGeoJSON(uf),
      (typeof window.loadMunicipalOverviewSummary === 'function'
        ? window.loadMunicipalOverviewSummary(uf, year, subtype)
        : Promise.resolve({}))
    ]);

    STATE.currentMapMuniSummaryByTurn = summary || { '1T': {}, '2T': {} };
    STATE.currentMapMuniSummary = getMunicipalOverviewSummaryForTurn(STATE.currentMapMuniSummaryByTurn);

    if (STATE.municipiosLayer && map.hasLayer(STATE.municipiosLayer)) {
      map.removeLayer(STATE.municipiosLayer);
    }

    STATE.municipiosLayer = L.geoJSON(geojson, {
      style: (feature) => getMunicipalPolygonStyle(feature, STATE.currentMapMuniSummary),
      onEachFeature: (feature, layer) => {
        layer.bindTooltip(buildMunicipalityTooltip(feature, STATE.currentMapMuniSummary), {
          className: 'sim-tooltip',
          sticky: true
        });

        layer.on({
          mouseover: () => {
            layer.setStyle({ weight: 1.4, color: '#ffffff' });
          },
          mouseout: () => {
            STATE.municipiosLayer?.resetStyle(layer);
          },
          click: () => {
            const nome = getMunicipalityFeatureName(feature.properties);
            const matchedOption = Array.from(dom.selectMunicipio?.options || []).find((option) => option.value && matchesMunicipioName(nome, option.value));
            if (matchedOption) {
              dom.selectMunicipio.value = matchedOption.value;
            } else if (dom.selectMunicipio) {
              dom.selectMunicipio.value = nome;
            }
            dom.selectMunicipio?.dispatchEvent(new Event('change'));
          }
        });
      }
    }).addTo(map);

    const bounds = STATE.municipiosLayer.getBounds?.();
    if (bounds?.isValid?.()) {
      map.fitBounds(bounds, { padding: [20, 20] });
    }

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
  // NÃ£o apenas as visÃ­veis no viewport
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


// FunÃ§Ã£o auxiliar para gerar o texto do tÃ­tulo baseado nos filtros ativos
function getActiveCensusFilterLabel() {
  const f = STATE.censusFilters;

  // 1. Filtro de Renda
  if (f.rendaMin !== null || f.rendaMax !== null) {
    const min = (f.rendaMin || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
    const max = f.rendaMax ? (f.rendaMax).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : 'MÃ¡x (+R$ 10k)';
    return `Renda MÃ©dia: ${min} a ${max}`;
  }

  // 2. Filtro de RaÃ§a/Cor
  if (f.racaVal > 0) {
    // Remove o "Pct" para ficar mais bonito (ex: "Pct Preta" vira "PopulaÃ§Ã£o Preta")
    const label = f.racaMode.replace('Pct ', 'PopulaÃ§Ã£o ');
    return `${label}: Acima de ${f.racaVal}%`;
  }

  // 3. Filtro de Idade
  if (f.idadeVal > 0) {
    return `Idade ${f.idadeMode}: Acima de ${f.idadeVal}% dos eleitores`;
  }

  // 4. Filtro de GÃªnero
  if (f.generoVal > 0) {
    const label = f.generoMode.replace('Pct ', ''); // "Mulheres" ou "Homens"
    return `GÃªnero (${label}): Acima de ${f.generoVal}%`;
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

  // 1. Atualiza camada de municípios (overview)
  if (STATE.municipiosLayer && map.hasLayer(STATE.municipiosLayer)) {
    STATE.municipiosLayer.eachLayer((layer) => {
      const feature = layer?.feature;
      if (!feature) return;

      // Atualiza o estilo (fillColor)
      if (typeof layer.setStyle === 'function') {
        layer.setStyle(getMunicipalPolygonStyle(feature, summary));
      }

      // Atualiza o conteúdo do tooltip (pois cores em tooltips são strings estáticas no binding)
      if (typeof layer.getTooltip === 'function' && layer.getTooltip()) {
        layer.setTooltipContent(buildMunicipalityTooltip(feature, summary));
      }
    });
  }

  // 2. Atualiza camada de pontos (locais de votação)
  if (currentLayer && map.hasLayer(currentLayer)) {
    currentLayer.eachLayer((layer) => {
      const feature = layer?.feature;
      if (!feature) return;

      // Pontos (circleMarkers)
      if (typeof layer.setStyle === 'function') {
        layer.setStyle(getFeatureStyle(feature));
      }

      // Tooltips dos pontos
      if (typeof layer.getTooltip === 'function' && layer.getTooltip()) {
        if (typeof buildLocationTooltip === 'function') {
           layer.setTooltipContent(buildLocationTooltip(feature));
        }
      }
    });
  }

  // Sincroniza painéis secundários que dependem da visão atual
  if (typeof syncResultsPanelToCurrentView === 'function') {
    syncResultsPanelToCurrentView();
  }
}

// Exporta para uso global
window.refreshMapStylesAndTooltips = refreshMapStylesAndTooltips;
