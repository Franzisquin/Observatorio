function buildGeneral2006Feature(row) {
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
      ano: 2006,
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

async function getGeneral2006Database() {
  if (GPKG_2006_DB_PROMISE) return GPKG_2006_DB_PROMISE;

  GPKG_2006_DB_PROMISE = (async () => {
    const SQL = await ensureSqlJsReady();
    const { blob } = await fetchBlobFromZipEntry(
      `${DATA_BASE_URL}locais_votacao_2006_gkpg.zip`,
      null,
      (entryName) => entryName.toLowerCase().endsWith('.gpkg')
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return new SQL.Database(bytes);
  })();

  return GPKG_2006_DB_PROMISE;
}

async function loadCensoJson2006(uf) {
  const ufNorm = String(uf || '').toUpperCase();
  if (!ufNorm) return null;
  if (CENSO_2006_CACHE.has(ufNorm)) return CENSO_2006_CACHE.get(ufNorm);

  const promise = (async () => {
    const zipUrl = `${DATA_BASE_URL}Censo 2006/censo_2006_${ufNorm}.zip`;
    const filename = `censo_2006_${ufNorm}.json`;
    const { data } = await fetchJsonFromZipEntry(zipUrl, filename);
    return data;
  })();

  CENSO_2006_CACHE.set(ufNorm, promise);
  return promise;
}

function mergeGeneralCensoJson2006(baseGeo, censusJson) {
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
    const localKey = String(row.local_key || row.ID_UNICO || fallbackKey || '');
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

  console.log(`[2006] Censo mesclado em ${mergedCount} locais.`);
}

async function loadGeneralStateBaseFromGpkg2006(uf) {
  const ufNorm = String(uf || '').toUpperCase();
  if (!ufNorm) throw new Error('UF 2006 invalida.');
  if (GENERAL_2006_BASE_CACHE.has(ufNorm)) {
    return GENERAL_2006_BASE_CACHE.get(ufNorm);
  }

  const promise = (async () => {
    const db = await getGeneral2006Database();
    const stmt = db.prepare(`
      SELECT sg_uf, cod_localidade_ibge, nr_zona, nr_locvot, nm_localidade, nm_locvot,
             ds_endereco, ds_bairro, long, lat, tipo_match
      FROM locais_votacao_2006_padronizado
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
      features: rows.map((row) => buildGeneral2006Feature(row))
    };

    try {
      const censusJson = await loadCensoJson2006(ufNorm);
      mergeGeneralCensoJson2006(baseGeo, censusJson);
    } catch (error) {
      console.warn(`[2006] Censo nao carregado para ${ufNorm}:`, error);
    }

    return baseGeo;
  })();

  GENERAL_2006_BASE_CACHE.set(ufNorm, promise);
  return promise;
}

function filterGeneralFeatures2006(baseGeo, resultKeys) {
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

async function loadGeneralScopeBase2006(ufs, resultKeys) {
  const collections = await Promise.all((ufs || []).map(async (sigla) => {
    const baseGeo = await loadGeneralStateBaseFromGpkg2006(sigla);
    return filterGeneralFeatures2006(baseGeo, resultKeys);
  }));

  const features = collections.flatMap((collection) => collection.features || []);
  if (!features.length) {
    throw new Error('Nenhum local do GPKG 2006 bateu com os resultados JSON.');
  }

  return { type: 'FeatureCollection', features };
}

async function loadGeneralMajoritariaJson2006(cargo, uf, turno) {
  const ufNorm = String(uf || '').toUpperCase();
  const isSenador = cargo === 'senador';
  const isGovernador = cargo === 'governador';
  const zipUrl = isSenador
    ? `${DATA_BASE_URL}Majoritarias 2006/senador_2006_ord_t${turno}_${ufNorm}.zip`
    : isGovernador
      ? `${DATA_BASE_URL}Majoritarias 2006/governador_2006_ord_t${turno}_${ufNorm}.zip`
      : `${DATA_BASE_URL}Majoritarias 2006/${cargo}_2006_t${turno}_${ufNorm}.zip`;
  const filename = isSenador
    ? `senador_2006_ord_t${turno}_${ufNorm}.json`
    : isGovernador
      ? `governador_2006_ord_t${turno}_${ufNorm}.json`
      : `${cargo}_2006_t${turno}_${ufNorm}.json`;
  const { data } = await fetchJsonFromZipEntry(zipUrl, filename);
  return data;
}

function mergeGeneralJsonPayloads2006(payloads) {
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

function applyGeneralMajoritariaJsonToGeojson2006(geojson, fullJson, turnoKey) {
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

async function loadMajoritariaCargo2006(cargo, uf) {
  const ufs = (cargo === 'presidente' && String(uf).toUpperCase() === 'BR')
    ? ALL_STATE_SIGLAS
    : [String(uf || '').toUpperCase()];

  const turno1Payloads = (await Promise.all(
    ufs.map((sigla) => loadGeneralMajoritariaJson2006(cargo, sigla, 1).catch(() => null))
  )).filter((payload) => payload?.RESULTS);

  if (!turno1Payloads.length) return null;

  const mergedTurno1 = mergeGeneralJsonPayloads2006(turno1Payloads);
  const resultKeys = new Set(Object.keys(mergedTurno1.RESULTS || {}));

  let mergedTurno2 = null;
  if (cargo !== 'senador') {
    const turno2Ufs = ufs.filter((sigla) => {
      if (cargo === 'presidente') return true;
      return typeof hasGeneralSecondTurnArchive === 'function'
        ? hasGeneralSecondTurnArchive(2006, cargo, sigla)
        : true;
    });
    const turno2Payloads = (await Promise.all(
      turno2Ufs.map((sigla) => loadGeneralMajoritariaJson2006(cargo, sigla, 2).catch(() => null))
    )).filter((payload) => payload?.RESULTS);

    if (turno2Payloads.length) {
      mergedTurno2 = mergeGeneralJsonPayloads2006(turno2Payloads);
      Object.keys(mergedTurno2.RESULTS || {}).forEach((key) => resultKeys.add(key));
    }
  }

  const geojson = await loadGeneralScopeBase2006(ufs, resultKeys);
  applyGeneralMajoritariaJsonToGeojson2006(geojson, mergedTurno1, '1T');
  if (mergedTurno2) {
    applyGeneralMajoritariaJsonToGeojson2006(geojson, mergedTurno2, '2T');
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

async function buildDeputyBaseGeojson2006(uf) {
  const resultKeys = collectLoadedDeputyResultKeys();
  const baseGeo = await loadGeneralStateBaseFromGpkg2006(uf);
  return filterGeneralFeatures2006(baseGeo, resultKeys);
}

async function onClickLoadData_Geral_2006() {
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

  currentSubType = 'ord';
  currentCargo = `${currentOffice}_${currentSubType}`;

  try {
    const cargos = (ufToLoad === 'BR')
      ? ['presidente']
      : ['presidente', 'governador', 'senador'];

    const results = await Promise.all(cargos.map((cargo) => loadMajoritariaCargo2006(cargo, ufToLoad)));
    let dataFound = false;

    results.forEach((loaded, index) => {
      const cargo = cargos[index];
      if (!loaded?.geojson?.features?.length) return;

      const cargoKey = `${cargo}_ord`;
      currentDataCollection[cargoKey] = loaded.geojson;
      processLoadedGeoJSON(loaded.geojson, cargoKey);
      STATE.generalOfficialTotals[cargoKey] = loaded.officialTotals || {};
      STATE.generalOfficialTotalsByCity[cargoKey] = loaded.officialCityTotals || {};
      dataFound = true;
    });

    if (!dataFound) {
      throw new Error('Nenhum dado JSON encontrado para 2006.');
    }

    finalizeGeneralLoadUI(ufToLoad);
    showToast(`Dados de ${ufToLoad} (${year}) carregados!`, 'success');
  } catch (error) {
    console.error('[2006] Falha ao carregar gerais:', error);
    showToast(`Erro: ${error.message}`, 'error');
  } finally {
    setButtonLoading(dom.btnLoadData, false);
    setTimeout(() => {
      dom.mapLoader.classList.remove('visible');
    }, 300);
  }
}

async function onClickLoadData_Deputies_2006(uf, year) {
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
      STATE.generalOfficialTotalsByCity = {};
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

      const cargoKey = isEstadual ? 'deputado_estadual' : 'deputado_federal';
      const precomputedTotalsPromise = loadPrecomputedProportionalStateTotals(cargoKey, uf, year).catch(() => null);
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

      ensureDeputyTypeStores();
      STATE.deputyMetadataByType[typeKey] = { ...meta };
      STATE.deputyMetadata = STATE.deputyMetadataByType[typeKey];
      STATE._partyPrefixCache = null;
      deputyNameToIdCache = {};

      if (!STATE.inaptos) STATE.inaptos = {};
      if (!STATE.inaptos[currentCargo]) STATE.inaptos[currentCargo] = { '1T': [], '2T': [] };
      STATE.inaptos[currentCargo]['1T'] = Object.entries(meta)
        .filter(([, cmeta]) => cmeta && cmeta[2] && cmeta[2].toUpperCase().includes('INAPTO'))
        .map(([cid]) => cid);

      if (fullJson.METADATA?.coalition_adjustments) {
        ensureDeputyTypeStores();
        STATE.deputyAdjustmentsByType[typeKey] = { ...fullJson.METADATA.coalition_adjustments };
        STATE.deputyAdjustments = STATE.deputyAdjustmentsByType[typeKey];
      }

      const precomputedTotals = await precomputedTotalsPromise;
      if (precomputedTotals) {
        if (!STATE.precomputedProportionalStateTotals) STATE.precomputedProportionalStateTotals = {};
        STATE.precomputedProportionalStateTotals[cargoKey] = precomputedTotals;
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
    const baseGeo = await buildDeputyBaseGeojson2006(uf);
    if (!baseGeo?.features?.length) {
      throw new Error('Nenhum local de deputado 2006 encontrado no GPKG.');
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
    console.error('[2006] ERRO Deputados:', error);
    alert('Erro ao carregar dados de Deputado: ' + error.message);
  } finally {
    dom.mapLoader.classList.remove('visible');
  }
}
