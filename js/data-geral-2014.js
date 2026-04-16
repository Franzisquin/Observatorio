function buildGeneral2014Feature(row) {
  const uf = String(row.sg_uf || '').toUpperCase();
  const zona = parseInt(row.nr_zona, 10);
  const local = parseInt(row.nr_locvot, 10);
  const longitude = Number(row.long);
  const latitude = Number(row.lat);
  const zoneLocalKey = `${zona}_${local}`;

  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [longitude, latitude]
    },
    properties: {
      local_id: zoneLocalKey,
      id_unico: null,
      ID_UNICO: null,
      local_key: null,
      ano: 2014,
      sg_uf: uf,
      cd_localidade_tse: null,
      cod_localidade_ibge: row.cod_localidade_ibge ? Number(row.cod_localidade_ibge) : null,
      nr_zona: zona,
      nr_locvot: local,
      nm_localidade: row.nm_localidade,
      nm_locvot: row.nm_locvot,
      ds_endereco: row.ds_endereco,
      ds_enderec: row.ds_endereco,
      ds_bairro: row.ds_bairro,
      long: longitude,
      lat: latitude,
      tipo_match: row.tipo_match || null
    }
  };
}

async function getGeneral2014Database() {
  if (GPKG_2014_DB_PROMISE) return GPKG_2014_DB_PROMISE;

  GPKG_2014_DB_PROMISE = (async () => {
    const SQL = await ensureSqlJsReady();
    const { blob } = await fetchBlobFromZipEntry(
      `${DATA_BASE_URL}locais_votacao_2014_gkpg.zip`,
      null,
      (entryName) => entryName.toLowerCase().endsWith('.gpkg')
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return new SQL.Database(bytes);
  })();

  return GPKG_2014_DB_PROMISE;
}

async function loadCensoJson2014(uf) {
  const ufNorm = String(uf || '').toUpperCase();
  if (!ufNorm) return null;
  if (CENSO_2014_CACHE.has(ufNorm)) return CENSO_2014_CACHE.get(ufNorm);

  const promise = (async () => {
    const zipUrl = `${DATA_BASE_URL}Censo 2014/censo_2014_${ufNorm}.zip`;
    const filename = `censo_2014_${ufNorm}.json`;
    const { data } = await fetchJsonFromZipEntry(zipUrl, filename);
    return data;
  })();

  CENSO_2014_CACHE.set(ufNorm, promise);
  return promise;
}

function mergeGeneralCensoJson2014(baseGeo, censusJson) {
  if (!baseGeo?.features?.length || !censusJson?.RESULTS) return;

  const censusByCityZoneLocal = new Map();
  const censusByNameBairro = new Map();

  Object.entries(censusJson.RESULTS).forEach(([fallbackKey, row]) => {
    if (!row) return;

    const zona = parseInt(row.nr_zona, 10);
    const local = parseInt(row.nr_locvot, 10);
    if (!Number.isFinite(zona) || !Number.isFinite(local)) return;

    const zoneLocalKey = `${zona}_${local}`;
    const cidade = norm(row.nm_localidade);
    const localNome = norm(row.nm_locvot);
    const bairro = norm(row.ds_bairro);
    const localKey = String(row.local_key || fallbackKey || '');
    const enriched = {
      ...row,
      local_id: zoneLocalKey,
      id_unico: localKey,
      ID_UNICO: localKey,
      local_key: localKey
    };

    if (cidade) censusByCityZoneLocal.set(`${cidade}|${zoneLocalKey}`, enriched);
    if (localNome) censusByNameBairro.set(`${localNome}|${bairro}`, enriched);
  });

  let mergedCount = 0;
  baseGeo.features.forEach((feature) => {
    const props = feature.properties || {};
    const zoneLocalKey = String(props.local_id || '');
    const cityZoneLocalKey = `${norm(props.nm_localidade)}|${zoneLocalKey}`;
    const nameBairroKey = `${norm(props.nm_locvot)}|${norm(props.ds_bairro)}`;
    const censusProps = censusByCityZoneLocal.get(cityZoneLocalKey) || censusByNameBairro.get(nameBairroKey);
    if (!censusProps) return;

    Object.entries(censusProps).forEach(([key, value]) => {
      if (value !== undefined) props[key] = value;
    });
    if (props.local_key && !props.id_unico) props.id_unico = props.local_key;
    if (props.id_unico && !props.ID_UNICO) props.ID_UNICO = props.id_unico;
    if (!props.local_id && props.nr_zona && props.nr_locvot) {
      props.local_id = `${parseInt(props.nr_zona, 10)}_${parseInt(props.nr_locvot, 10)}`;
    }
    mergedCount++;
  });

  console.log(`[2014] Censo mesclado em ${mergedCount} locais.`);
}

async function loadGeneralStateBaseFromGpkg2014(uf) {
  const ufNorm = String(uf || '').toUpperCase();
  if (!ufNorm) throw new Error('UF 2014 invalida.');
  if (GENERAL_2014_BASE_CACHE.has(ufNorm)) {
    return GENERAL_2014_BASE_CACHE.get(ufNorm);
  }

  const promise = (async () => {
    const db = await getGeneral2014Database();
    const stmt = db.prepare(`
      SELECT sg_uf, cod_localidade_ibge, nr_zona, nr_locvot, nm_localidade, nm_locvot,
             ds_endereco, ds_bairro, long, lat, tipo_match
      FROM locais_votacao_2014_ENRIQUECIDO
      WHERE sg_uf = ?
    `);

    const rows = [];
    stmt.bind([ufNorm]);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      if (!isValidBrazilCoordinate(Number(row.long), Number(row.lat))) continue;
      rows.push(row);
    }
    stmt.free();

    rows.sort((a, b) => {
      const cidadeDiff = String(a.nm_localidade || '').localeCompare(String(b.nm_localidade || ''), 'pt-BR');
      if (cidadeDiff !== 0) return cidadeDiff;
      const zonaDiff = parseInt(a.nr_zona, 10) - parseInt(b.nr_zona, 10);
      return zonaDiff || (parseInt(a.nr_locvot, 10) - parseInt(b.nr_locvot, 10));
    });

    const baseGeo = {
      type: 'FeatureCollection',
      features: rows.map((row) => buildGeneral2014Feature(row))
    };

    try {
      const censusJson = await loadCensoJson2014(ufNorm);
      mergeGeneralCensoJson2014(baseGeo, censusJson);
    } catch (error) {
      console.warn(`[2014] Censo nao carregado para ${ufNorm}:`, error);
    }

    return baseGeo;
  })();

  GENERAL_2014_BASE_CACHE.set(ufNorm, promise);
  return promise;
}

function filterGeneralFeatures2014(baseGeo, resultKeys) {
  const keys = resultKeys instanceof Set ? resultKeys : new Set(resultKeys || []);
  return {
    type: 'FeatureCollection',
    features: (baseGeo?.features || [])
      .filter((feature) => {
        const props = feature.properties || {};
        const fullKey = String(props.id_unico || props.local_key || '');
        return fullKey && keys.has(fullKey);
      })
      .map((feature) => ({
        type: 'Feature',
        geometry: feature.geometry ? {
          type: feature.geometry.type,
          coordinates: Array.isArray(feature.geometry.coordinates)
            ? [...feature.geometry.coordinates]
            : feature.geometry.coordinates
        } : null,
        properties: { ...(feature.properties || {}) }
      }))
  };
}

async function loadGeneralScopeBase2014(ufs, resultKeys) {
  const collections = await Promise.all((ufs || []).map(async (sigla) => {
    const baseGeo = await loadGeneralStateBaseFromGpkg2014(sigla);
    return filterGeneralFeatures2014(baseGeo, resultKeys);
  }));

  const features = collections.flatMap((collection) => collection.features || []);
  if (!features.length) {
    throw new Error('Nenhum local do GPKG 2014 bateu com os resultados JSON.');
  }

  return { type: 'FeatureCollection', features };
}

function buildGeneralMajoritariaArchiveSpec2014(cargo, uf, turno, subtype = 'ord') {
  const ufNorm = String(uf || '').toUpperCase();
  const isSenador = cargo === 'senador';
  const isGovernador = cargo === 'governador';
  const subtypeNorm = subtype === 'sup' ? 'sup' : 'ord';
  const basename = isSenador
    ? `senador_2014_${subtypeNorm}_t${turno}_${ufNorm}`
    : isGovernador
      ? `governador_2014_${subtypeNorm}_t${turno}_${ufNorm}`
      : `${cargo}_2014_t${turno}_${ufNorm}`;
  return {
    zipUrl: `${DATA_BASE_URL}Majoritarias 2014/${basename}.zip`,
    filename: `${basename}.json`
  };
}

async function loadGeneralMajoritariaJson2014(cargo, uf, turno, subtype = 'ord') {
  const { zipUrl, filename } = buildGeneralMajoritariaArchiveSpec2014(cargo, uf, turno, subtype);
  const { data } = await fetchJsonFromZipEntry(zipUrl, filename);
  return data;
}

function mergeGeneralJsonPayloads2014(payloads) {
  const merged = {
    METADATA: {
      cand_names: {},
      coalition_adjustments: {}
    },
    RESULTS: {}
  };

  (payloads || []).forEach((payload) => {
    if (!payload) return;
    Object.assign(merged.METADATA.cand_names, payload.METADATA?.cand_names || {});
    Object.assign(merged.METADATA.coalition_adjustments, payload.METADATA?.coalition_adjustments || {});
    Object.entries(payload.RESULTS || {}).forEach(([key, value]) => {
      merged.RESULTS[key] = value;
    });
  });

  return merged;
}

function applyGeneralMajoritariaJsonToGeojson2014(geojson, fullJson, turnoKey) {
  if (!geojson?.features?.length || !fullJson?.RESULTS) return;
  const metadata = fullJson.METADATA?.cand_names || {};

  geojson.features.forEach((feature) => {
    const props = feature.properties || {};
    const resultKey = String(props.id_unico || props.local_key || '');
    const votes = fullJson.RESULTS[resultKey];
    if (!votes) return;

    applyTurnMetricsFromJsonVotes(props, votes, turnoKey, false);

    Object.entries(votes).forEach(([candidateId, rawVotes]) => {
      if (candidateId === '95' || candidateId === '96') return;
      const candidateMeta = metadata[candidateId];
      if (!candidateMeta) return;

      const nome = candidateMeta[0] || `Candidato ${candidateId}`;
      const partido = candidateMeta[1] || '?';
      const status = candidateMeta[2] || 'N/D';
      const candidateKey = `${nome} (${partido}) (${status}) ${turnoKey}`;
      props[candidateKey] = ensureNumber(rawVotes);
    });
  });
}

async function loadMajoritariaCargo2014(cargo, uf, subtype = 'ord') {
  const ufs = (cargo === 'presidente' && String(uf).toUpperCase() === 'BR')
    ? ALL_STATE_SIGLAS
    : [String(uf || '').toUpperCase()];

  const turno1Payloads = (await Promise.all(
    ufs.map((sigla) => loadGeneralMajoritariaJson2014(cargo, sigla, 1, subtype).catch(() => null))
  )).filter((payload) => payload?.RESULTS);

  if (!turno1Payloads.length) return null;

  const mergedTurno1 = mergeGeneralJsonPayloads2014(turno1Payloads);
  const resultKeys = new Set(Object.keys(mergedTurno1.RESULTS || {}));

  let mergedTurno2 = null;
  if (cargo !== 'senador') {
    const turno2Ufs = ufs.filter((sigla) => {
      if (cargo === 'presidente') return true;
      return typeof hasGeneralSecondTurnArchive === 'function'
        ? hasGeneralSecondTurnArchive(2014, cargo, sigla, subtype)
        : true;
    });
    const turno2Payloads = (await Promise.all(
      turno2Ufs.map((sigla) => loadGeneralMajoritariaJson2014(cargo, sigla, 2, subtype).catch(() => null))
    )).filter((payload) => payload?.RESULTS);

    if (turno2Payloads.length) {
      mergedTurno2 = mergeGeneralJsonPayloads2014(turno2Payloads);
      Object.keys(mergedTurno2.RESULTS || {}).forEach((key) => resultKeys.add(key));
    }
  }

  const geojson = await loadGeneralScopeBase2014(ufs, resultKeys);
  applyGeneralMajoritariaJsonToGeojson2014(geojson, mergedTurno1, '1T');
  if (mergedTurno2) {
    applyGeneralMajoritariaJsonToGeojson2014(geojson, mergedTurno2, '2T');
  }

  return {
    geojson,
    officialTotals: {
      '1T': buildGeneralOfficialSummary(mergedTurno1, '1T'),
      ...(mergedTurno2 ? { '2T': buildGeneralOfficialSummary(mergedTurno2, '2T') } : {})
    },
    officialCityTotals: {
      '1T': buildGeneralOfficialSummariesByCity(mergedTurno1, '1T', geojson),
      ...(mergedTurno2 ? { '2T': buildGeneralOfficialSummariesByCity(mergedTurno2, '2T', geojson) } : {})
    }
  };
}

async function buildDeputyBaseGeojson2014(uf) {
  const resultKeys = collectLoadedDeputyResultKeys();
  const baseGeo = await loadGeneralStateBaseFromGpkg2014(uf);
  return filterGeneralFeatures2014(baseGeo, resultKeys);
}

function areGeneralOfficialSummariesEqual(a, b) {
  const normalizeSummary = (summary) => JSON.stringify({
    totalValidos: ensureNumber(summary?.totalValidos),
    brancos: ensureNumber(summary?.brancos),
    nulos: ensureNumber(summary?.nulos),
    comparecimento: ensureNumber(summary?.comparecimento),
    votesById: Object.entries(summary?.votesById || {}).sort(([ka], [kb]) => ka.localeCompare(kb)),
    votesByDisplayKey: Object.entries(summary?.votesByDisplayKey || {}).sort(([ka], [kb]) => ka.localeCompare(kb))
  });
  return normalizeSummary(a?.['1T']) === normalizeSummary(b?.['1T'])
    && normalizeSummary(a?.['2T']) === normalizeSummary(b?.['2T']);
}

async function onClickLoadData_Geral_2014() {
  const uf = dom.selectUFGeneral.value;
  const year = STATE.currentElectionYear;

  if (!uf && currentOffice !== 'presidente') return;
  if (currentOffice === 'presidente' && !uf) dom.selectUFGeneral.value = 'BR';
  if (currentOffice === 'deputado' && !uf) return;

  const ufToLoad = dom.selectUFGeneral.value || 'BR';

  if (currentOffice === 'deputado') {
    setButtonLoading(dom.btnLoadData, true);
    await window.onClickLoadData_Deputies(ufToLoad, year);
    setButtonLoading(dom.btnLoadData, false);
    return;
  }

  setButtonLoading(dom.btnLoadData, true);
  dom.mapLoader.textContent = `Processando dados de ${ufToLoad} (${year})...`;
  dom.mapLoader.classList.add('visible');

  clearZipCache();

  if (currentLayer) {
    currentLayer.clearLayers();
    map.removeLayer(currentLayer);
    currentLayer = null;
  }

  currentDataCollection = {};
  currentDataCollection_2022 = {};
  STATE.spatialIndex2022 = { presidente: null, governador: null, senador: null };
  STATE.generalOfficialTotals = {};
  STATE.generalOfficialTotalsByCity = {};
  uniqueCidades.clear();
  uniqueBairros.clear();
  clearSelection(true);
  CANDIDATES_CACHE.clear();

  const requestedSubType = currentSubType;

  try {
    const loadPlans = (ufToLoad === 'BR')
      ? [{ cargo: 'presidente', subtype: 'ord' }]
      : [
          { cargo: 'presidente', subtype: 'ord' },
          { cargo: 'governador', subtype: 'ord' },
          { cargo: 'senador', subtype: 'ord' },
          { cargo: 'governador', subtype: 'sup' },
          { cargo: 'senador', subtype: 'sup' }
        ];

    const results = await Promise.all(
      loadPlans.map(({ cargo, subtype }) => loadMajoritariaCargo2014(cargo, ufToLoad, subtype))
    );
    let dataFound = false;

    results.forEach((loaded, index) => {
      const { cargo, subtype } = loadPlans[index];
      if (!loaded?.geojson?.features?.length) return;

      const cargoKey = `${cargo}_${subtype}`;
      if (subtype === 'sup') {
        const ordCargoKey = `${cargo}_ord`;
        const ordLoaded = currentDataCollection[ordCargoKey];
        const ordOfficialTotals = STATE.generalOfficialTotals[ordCargoKey];
        if (ordLoaded && ordOfficialTotals && areGeneralOfficialSummariesEqual(ordOfficialTotals, loaded.officialTotals || {})) {
          return;
        }
      }

      currentDataCollection[cargoKey] = loaded.geojson;
      processLoadedGeoJSON(loaded.geojson, cargoKey);
      STATE.generalOfficialTotals[cargoKey] = loaded.officialTotals || {};
      STATE.generalOfficialTotalsByCity[cargoKey] = loaded.officialCityTotals || {};
      dataFound = true;
    });

    if (!dataFound) {
      throw new Error('Nenhum dado JSON encontrado para 2014.');
    }

    const requestedCargoKey = `${currentOffice}_${requestedSubType}`;
    const ordCargoKey = `${currentOffice}_ord`;
    const supCargoKey = `${currentOffice}_sup`;
    currentSubType = currentDataCollection[requestedCargoKey]
      ? requestedSubType
      : currentDataCollection[ordCargoKey]
        ? 'ord'
        : currentDataCollection[supCargoKey]
          ? 'sup'
          : 'ord';
    currentCargo = `${currentOffice}_${currentSubType}`;

    finalizeGeneralLoadUI(ufToLoad);
    showToast(`Dados de ${ufToLoad} (${year}) carregados!`, 'success');
  } catch (error) {
    console.error('[2014] Falha ao carregar gerais:', error);
    showToast(`Erro: ${error.message}`, 'error');
  } finally {
    setButtonLoading(dom.btnLoadData, false);
    setTimeout(() => {
      dom.mapLoader.classList.remove('visible');
    }, 300);
  }
}

async function onClickLoadData_Deputies_2014(uf, year) {
  const isEstadual = currentCargo === 'deputado_estadual';
  const typeKey = isEstadual ? 'e' : 'f';
  const typeLabel = isEstadual ? 'estadual' : 'federal';

  const shouldReloadDeputyData = (
    loadedDeputyState.uf !== uf ||
    !loadedDeputyState.types.has(typeKey) ||
    loadedDeputyState.year !== year
  );

  const shouldReloadBaseState = (
    loadedDeputyState.uf !== uf ||
    loadedDeputyState.year !== year
  );

  if (!shouldReloadDeputyData) {
    console.log(`Deputy data for ${typeLabel} ${uf} (${year}) already in memory.`);
  } else {
    dom.mapLoader.textContent = `Carregando Deputados ${typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1)} ${uf} (${year})...`;
    dom.mapLoader.classList.add('visible');

    if (loadedDeputyState.uf !== uf || loadedDeputyState.year !== year) {
      clearZipCache();
      if (currentLayer) {
        try {
          currentLayer.off();
          currentLayer.clearLayers();
          map.removeLayer(currentLayer);
        } catch (error) {
          console.warn('Erro ao remover camada:', error);
        }
        currentLayer = null;
      }

      clearSelection(true);
      currentDataCollection = {};
      STATE.spatialIndex2022 = { presidente: null, governador: null, senador: null };
      STATE.generalOfficialTotals = {};
      uniqueCidades.clear();
      uniqueBairros.clear();

      clearDeputyData();
      loadedDeputyState.uf = uf;
      loadedDeputyState.year = year;
      loadedDeputyState.types.clear();
    }

    try {
      if (!STATE.officialTotals) STATE.officialTotals = {};
      if (!STATE.officialTotals[year]) {
        const res = await fetch(`resultados_geo/Legislativas ${year}/official_totals_${year}.json`);
        if (res.ok) {
          STATE.officialTotals[year] = await res.json();
        }
      }

      const zipPath = `resultados_geo/Legislativas ${year}/deputados_${typeLabel}_${year}_${uf}.zip`;
      const jsonName = `deputados_${typeLabel}_${year}_${uf}.json`;
      const { data: fullJson } = await fetchJsonFromZipEntry(zipPath, jsonName);
      if (!fullJson?.RESULTS) throw new Error('JSON de deputados vazio.');

      const results = fullJson.RESULTS || {};
      const meta = fullJson.METADATA?.cand_names || {};

      Object.entries(results).forEach(([locId, votes]) => {
        if (!STATE.deputyResults[locId]) STATE.deputyResults[locId] = { f: {}, e: {} };
        STATE.deputyResults[locId][typeKey] = votes;
      });

      Object.assign(STATE.deputyMetadata, meta);
      deputyNameToIdCache = {};

      if (!STATE.inaptos) STATE.inaptos = {};
      if (!STATE.inaptos[currentCargo]) STATE.inaptos[currentCargo] = { '1T': [], '2T': [] };
      STATE.inaptos[currentCargo]['1T'] = Object.entries(meta)
        .filter(([, cmeta]) => cmeta && cmeta[2] && cmeta[2].toUpperCase().includes('INAPTO'))
        .map(([cid]) => cid);

      if (fullJson.METADATA?.coalition_adjustments) {
        if (!STATE.deputyAdjustments) STATE.deputyAdjustments = {};
        Object.assign(STATE.deputyAdjustments, fullJson.METADATA.coalition_adjustments);
      }

      loadedDeputyState.types.add(typeKey);
      loadedDeputyState.year = year;
    } catch (error) {
      dom.mapLoader.classList.remove('visible');
      alert(error.message);
      return;
    }
  }

  try {
    const baseGeo = await buildDeputyBaseGeojson2014(uf);
    if (!baseGeo?.features?.length) {
      throw new Error('Nenhum local de deputado 2014 encontrado no GPKG.');
    }

    if (shouldReloadBaseState || !currentDataCollection['deputado_federal']) {
      uniqueCidades.clear();
      uniqueBairros.clear();
    }

    baseGeo.features.forEach((feature) => {
      const props = feature.properties || {};
      const city = getProp(props, 'nm_localidade');
      if (city) uniqueCidades.add(city);
      const bairro = getProp(props, 'ds_bairro');
      if (bairro) uniqueBairros.add(bairro);
    });

    currentDataCollection['deputado_federal'] = baseGeo;
    currentDataCollection['deputado_estadual'] = baseGeo;

    currentOffice = 'deputado';
    const sub = dom.cargoChipsGeneral.querySelector('.active')?.dataset.subtype || (currentCargo.includes('estadual') ? 'estadual' : 'federal');
    currentSubType = sub;
    currentCargo = `deputado_${sub}`;

    populateCidadeDropdown();
    [dom.filterBox, dom.vizBox].forEach((el) => el.classList.remove('section-hidden'));

    if (cidadeCombobox) {
      cidadeCombobox.disable(false);
      cidadeCombobox.setValue('Todos os municipios');
      currentCidadeFilter = 'all';
    }
    if (bairroCombobox) {
      bairroCombobox.disable(true);
      bairroCombobox.setValue('');
    }
    if (dom.selectVizColorStyle) dom.selectVizColorStyle.disabled = false;
    if (dom.selectVizSize) dom.selectVizSize.disabled = false;
    dom.btnApplyFilters.disabled = false;
    updateApplyButtonText();
    dom.searchLocal.disabled = false;
    dom.searchLocal.value = '';

    updateElectionTypeUI();
    updateConditionalUI();

    STATE.deputyLookup = null;
    STATE.deputyLookupCargo = null;

    if (currentCargo.startsWith('deputado')) {
      precomputeDeputyWinners();
    }

    const hasDeputyInaptos = (STATE.inaptos[currentCargo]?.['1T']?.length || 0) > 0
      || (STATE.inaptos[currentCargo]?.['2T']?.length || 0) > 0;
    const hasAnyInaptos = hasDeputyInaptos || Object.values(STATE.dataHasInaptos).some((value) => value);
    dom.btnToggleInaptos.disabled = !hasAnyInaptos;
    if (!hasAnyInaptos) {
      STATE.filterInaptos = false;
      dom.btnToggleInaptos.classList.remove('active');
      dom.btnToggleInaptos.textContent = 'Filtrar Inaptos';
    }

    applyFiltersAndRedraw();

    if (currentLayer) {
      try {
        const bounds = currentLayer.getBounds?.();
        if (bounds?.isValid()) {
          if (typeof applyMapViewportAfterDataLoad === 'function') applyMapViewportAfterDataLoad(bounds);
          else map.fitBounds(bounds);
        }
      } catch (error) {
        console.log('Nao foi possivel ajustar bounds automaticamente');
      }
    }

    showToast(`Dados de deputados ${typeLabel} ${uf} (${year}) carregados!`, 'success');
  } catch (error) {
    console.error('[2014] ERRO Deputados:', error);
    alert('Erro ao carregar dados de Deputado: ' + error.message);
  } finally {
    dom.mapLoader.classList.remove('visible');
  }
}
