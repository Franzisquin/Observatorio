// GPKG 2006 e' usado como malha de pontos para 2002.
// O que bater bateu, o que nao bater segue a vida.
// Para totais de municipio usamos o JSON direto (via mapa TSE-codigo->nome do GPKG 2002).

async function getGeneral2002Database() {
  if (GPKG_2002_DB_PROMISE) return GPKG_2002_DB_PROMISE;

  GPKG_2002_DB_PROMISE = (async () => {
    const SQL = await ensureSqlJsReady();
    const { blob } = await fetchBlobFromZipEntry(
      `${DATA_BASE_URL}locais_votacao_2002_gkpg.zip`,
      null,
      (entryName) => entryName.toLowerCase().endsWith('.gpkg')
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return new SQL.Database(bytes);
  })();

  return GPKG_2002_DB_PROMISE;
}

// Retorna Map: str(cd_municipio_tse) -> nm_localidade
// Usado apenas para construir totais por municipio a partir do JSON.
async function getMuniNameMap2002(uf) {
  const ufNorm = String(uf || '').toUpperCase();
  if (GENERAL_2002_BASE_CACHE.has(ufNorm)) return GENERAL_2002_BASE_CACHE.get(ufNorm);

  const promise = (async () => {
    const db = await getGeneral2002Database();
    const stmt = db.prepare(
      'SELECT local_key, nm_localidade FROM locais_votacao_2002_padronizado WHERE sg_uf = ?'
    );
    const map = new Map();
    stmt.bind([ufNorm]);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const parts = String(row.local_key || '').split('_');
      if (parts.length >= 2 && row.nm_localidade && !map.has(parts[1])) {
        map.set(parts[1], row.nm_localidade);
      }
    }
    stmt.free();

    // Municípios ausentes do GPKG 2002 (sem local geocodificado) ficam fora
    // do mapa e seus votos são descartados em buildGeneralCityTotals2002.
    // O censo 2006 cobre esses municípios com local_key={zona}_{cdMuni}_{local}
    // e os códigos TSE são estáveis entre eleições — seguro usar 2006 para 2002.
    // loadCensoJson2006 usa CENSO_2006_CACHE: custo de rede zero quando
    // loadGeneralStateBaseFromGpkg2006 já iniciou o download em paralelo.
    try {
      const censusJson = await loadCensoJson2006(ufNorm);
      Object.entries(censusJson?.RESULTS || {}).forEach(([fallbackKey, row]) => {
        const localKey = String(row?.local_key || row?.ID_UNICO || fallbackKey || '');
        const parts = localKey.split('_');
        if (parts.length < 3) return;
        const cdMuni = parts[1];
        const cityName = String(row?.nm_localidade || '').trim();
        if (cdMuni && cityName && !map.has(cdMuni)) map.set(cdMuni, cityName);
      });
    } catch (_) { /* censo indisponível, prossegue sem suplemento */ }

    return map;
  })();

  GENERAL_2002_BASE_CACHE.set(ufNorm, promise);
  return promise;
}

// Totais por municipio lidos direto do JSON (independente de quais locais bateram no GPKG).
function buildGeneralCityTotals2002(fullJson, turnoKey, muniNameMap, muniIbgeMap = null) {
  const metadata = fullJson?.METADATA?.cand_names || {};
  const rawTotalsByCity = new Map();
  const ibgeByCity = new Map();

  Object.entries(fullJson?.RESULTS || {}).forEach(([resultKey, voteMap]) => {
    const parts = resultKey.split('_');
    if (parts.length < 3) return;
    const cdMuni = parts[1];
    const cityName = muniNameMap.get(cdMuni);
    if (!cityName) return;

    let rawTotals = rawTotalsByCity.get(cityName);
    if (!rawTotals) { rawTotals = {}; rawTotalsByCity.set(cityName, rawTotals); }
    Object.entries(voteMap || {}).forEach(([cid, v]) => {
      rawTotals[cid] = (rawTotals[cid] || 0) + ensureNumber(v);
    });

    // Codigo IBGE (CD_MUN da malha municipal) para casar o municipio por codigo,
    // e nao apenas por nome — alguns municipios usam grafias divergentes entre
    // o GPKG/censo e a malha (ex.: "Sao Caetano" vs "Sao Caitano"), o que deixava
    // o poligono "sem votos" mesmo com resultados carregados.
    if (muniIbgeMap && !ibgeByCity.has(cityName)) {
      const ibge = muniIbgeMap.get(cdMuni);
      if (ibge) ibgeByCity.set(cityName, String(ibge));
    }
  });

  const summaries = {};
  rawTotalsByCity.forEach((rawTotals, cityName) => {
    const summary = buildGeneralOfficialSummaryFromRawTotals(rawTotals, metadata, turnoKey);
    const ibge = ibgeByCity.get(cityName);
    if (ibge) summary.ibge = ibge;
    summaries[cityName] = summary;
    summaries[norm(cityName)] = summary;
  });
  return summaries;
}

async function loadGeneralMajoritariaJson2002(cargo, uf, turno) {
  const ufNorm = String(uf || '').toUpperCase();
  const isSenador = cargo === 'senador';
  const isGovernador = cargo === 'governador';
  const zipUrl = isSenador
    ? `${DATA_BASE_URL}Majoritarias 2002/senador_2002_ord_t${turno}_${ufNorm}.zip`
    : isGovernador
      ? `${DATA_BASE_URL}Majoritarias 2002/governador_2002_ord_t${turno}_${ufNorm}.zip`
      : `${DATA_BASE_URL}Majoritarias 2002/${cargo}_2002_t${turno}_${ufNorm}.zip`;
  const filename = isSenador
    ? `senador_2002_ord_t${turno}_${ufNorm}.json`
    : isGovernador
      ? `governador_2002_ord_t${turno}_${ufNorm}.json`
      : `${cargo}_2002_t${turno}_${ufNorm}.json`;
  const { data } = await fetchJsonFromZipEntry(zipUrl, filename);
  return data;
}

function mergeGeneralJsonPayloads2002(payloads) {
  const merged = { METADATA: { cand_names: {}, coalition_adjustments: {} }, RESULTS: {} };
  (payloads || []).forEach((payload) => {
    if (!payload) return;
    Object.assign(merged.METADATA.cand_names, payload.METADATA?.cand_names || {});
    Object.assign(merged.METADATA.coalition_adjustments, payload.METADATA?.coalition_adjustments || {});
    Object.entries(payload.RESULTS || {}).forEach(([key, value]) => { merged.RESULTS[key] = value; });
  });
  return merged;
}

function applyGeneralMajoritariaJsonToGeojson2002(geojson, fullJson, turnoKey, muniNameMap) {
  if (!geojson?.features?.length || !fullJson?.RESULTS) return;
  const metadata = fullJson.METADATA?.cand_names || {};

  geojson.features.forEach((feature) => {
    const props = feature.properties || {};
    const resultKey = String(props.id_unico || props.local_key || '');
    const votes = fullJson.RESULTS[resultKey];
    if (!votes) return;

    // Corrige nm_localidade usando o cd_municipio TSE da chave do resultado.
    // O GPKG 2006 pode rotular um local como "MANAUS" geograficamente, mas o
    // resultado de 2002 pode pertencer a outro municipio (fronteira de zona).
    // Sobrescrever garante agrupamento correto em buildGeneralMunicipalityOverviewSummary.
    if (muniNameMap) {
      const parts = resultKey.split('_');
      if (parts.length >= 3) {
        const cityName = muniNameMap.get(parts[1]);
        if (cityName) props.nm_localidade = cityName;
      }
    }

    applyTurnMetricsFromJsonVotes(props, votes, turnoKey, false);

    Object.entries(votes).forEach(([candidateId, rawVotes]) => {
      if (candidateId === '95' || candidateId === '96') return;
      const candidateMeta = metadata[candidateId];
      if (!candidateMeta) return;
      const nome = candidateMeta[0] || `Candidato ${candidateId}`;
      const partido = candidateMeta[1] || '?';
      const status = candidateMeta[2] || 'N/D';
      props[`${nome} (${partido}) (${status}) ${turnoKey}`] = ensureNumber(rawVotes);
    });
  });
}

// Features geometry:null com os votos do JSON NAO cobertos pelos dots reais.
// Garante: sum(dots com nm_localidade TSE correto) + sum(sintetica) = total JSON.
function buildSyntheticMuniFeatures2002(payloads, muniNameMap, coveredKeysByTurno) {
  const fullByMuni = new Map();
  const covByMuni  = new Map();

  payloads.forEach(({ payload, turnoKey }) => {
    if (!payload?.RESULTS) return;
    const metadata  = payload.METADATA?.cand_names || {};
    const coveredKs = coveredKeysByTurno[turnoKey] || new Set();

    Object.entries(payload.RESULTS).forEach(([key, votes]) => {
      const parts = key.split('_');
      if (parts.length < 3) return;
      const cdMuni = parts[1];
      if (!muniNameMap.has(cdMuni)) return;

      if (!fullByMuni.has(cdMuni)) fullByMuni.set(cdMuni, {});
      const fT = fullByMuni.get(cdMuni);
      if (!fT[turnoKey]) fT[turnoKey] = { raw: {}, metadata };
      Object.entries(votes).forEach(([cid, v]) => {
        fT[turnoKey].raw[cid] = (fT[turnoKey].raw[cid] || 0) + ensureNumber(v);
      });

      if (coveredKs.has(key)) {
        if (!covByMuni.has(cdMuni)) covByMuni.set(cdMuni, {});
        const cT = covByMuni.get(cdMuni);
        if (!cT[turnoKey]) cT[turnoKey] = {};
        Object.entries(votes).forEach(([cid, v]) => {
          cT[turnoKey][cid] = (cT[turnoKey][cid] || 0) + ensureNumber(v);
        });
      }
    });
  });

  const features = [];
  fullByMuni.forEach((fByT, cdMuni) => {
    const cityName = muniNameMap.get(cdMuni);
    if (!cityName) return;
    const props = { nm_localidade: cityName, id_unico: null, local_id: null };

    Object.entries(fByT).forEach(([turnoKey, { raw: fullRaw, metadata }]) => {
      const covRaw = covByMuni.get(cdMuni)?.[turnoKey] || {};
      const remaining = {};
      Object.entries(fullRaw).forEach(([cid, v]) => {
        const r = v - ensureNumber(covRaw[cid]);
        if (r > 0) remaining[cid] = r;
      });

      applyTurnMetricsFromJsonVotes(props, remaining, turnoKey, false);
      Object.entries(remaining).forEach(([cid, total]) => {
        if (cid === '95' || cid === '96') return;
        const meta = metadata[cid];
        if (!meta) return;
        const nome = meta[0] || `Candidato ${cid}`;
        const partido = meta[1] || '?';
        const status = meta[2] || 'N/D';
        props[`${nome} (${partido}) (${status}) ${turnoKey}`] = total;
      });
    });

    features.push({ type: 'Feature', geometry: null, properties: props });
  });

  return features;
}

async function loadMajoritariaCargo2002(cargo, uf) {
  const ufs = (cargo === 'presidente' && String(uf).toUpperCase() === 'BR')
    ? ALL_STATE_SIGLAS
    : [String(uf || '').toUpperCase()];

  const turno1Payloads = (await Promise.all(
    ufs.map((sigla) => loadGeneralMajoritariaJson2002(cargo, sigla, 1).catch(() => null))
  )).filter((payload) => payload?.RESULTS);

  if (!turno1Payloads.length) return null;

  const mergedTurno1 = mergeGeneralJsonPayloads2002(turno1Payloads);
  const resultKeys = new Set(Object.keys(mergedTurno1.RESULTS || {}));

  let mergedTurno2 = null;
  if (cargo !== 'senador') {
    const turno2Ufs = ufs.filter((sigla) => {
      if (cargo === 'presidente') return true;
      return typeof hasGeneralSecondTurnArchive === 'function'
        ? hasGeneralSecondTurnArchive(2002, cargo, sigla)
        : true;
    });
    const turno2Payloads = (await Promise.all(
      turno2Ufs.map((sigla) => loadGeneralMajoritariaJson2002(cargo, sigla, 2).catch(() => null))
    )).filter((payload) => payload?.RESULTS);

    if (turno2Payloads.length) {
      mergedTurno2 = mergeGeneralJsonPayloads2002(turno2Payloads);
      Object.keys(mergedTurno2.RESULTS || {}).forEach((key) => resultKeys.add(key));
    }
  }

  // Mapa de nomes do GPKG 2002: cd_municipio_tse → nm_municipio
  const muniNameMaps = await Promise.all(ufs.map((s) => getMuniNameMap2002(s).catch(() => new Map())));
  const muniNameMap = new Map();
  muniNameMaps.forEach((m) => m.forEach((v, k) => muniNameMap.set(k, v)));

  // Mapa de pontos: GPKG 2006 (o que bater bateu).
  // applyGeneralMajoritariaJsonToGeojson2002 tambem corrige nm_localidade dos dots
  // usando o cd_municipio TSE da chave do resultado (evita agrupamento errado).
  const geojson = await loadGeneralScopeBase2006(ufs, resultKeys);

  // Reatribui votos de cidades que ainda nao existiam em 2002 (distritos do pai)
  // para o codigo TSE moderno da cidade — antes de aplicar/agrupar.
  if (window.EMANC) {
    await window.EMANC.ensureLoaded();
    window.EMANC.apply(2002, {
      resultsObjects: [mergedTurno1.RESULTS, mergedTurno2 && mergedTurno2.RESULTS].filter(Boolean),
      features: geojson.features,
      muniNameMap: muniNameMap,
    });
  }

  applyGeneralMajoritariaJsonToGeojson2002(geojson, mergedTurno1, '1T', muniNameMap);
  if (mergedTurno2) applyGeneralMajoritariaJsonToGeojson2002(geojson, mergedTurno2, '2T', muniNameMap);

  // Chaves dos dots cobertas pelo GPKG 2006 (por turno)
  const coveredT1 = new Set();
  const coveredT2 = new Set();
  (geojson.features || []).forEach((f) => {
    const k = String(f.properties?.id_unico || f.properties?.local_key || '');
    if (!k) return;
    if (mergedTurno1.RESULTS[k]) coveredT1.add(k);
    if (mergedTurno2?.RESULTS[k]) coveredT2.add(k);
  });

  // Features sinteticas (geometry:null) com votos restantes (total_json - dots).
  // sum(dots com nm_localidade correto) + sum(sintetica) = total JSON por municipio.
  const payloadsForSynthetic = [
    { payload: mergedTurno1, turnoKey: '1T' },
    ...(mergedTurno2 ? [{ payload: mergedTurno2, turnoKey: '2T' }] : []),
  ];
  const syntheticFeatures = buildSyntheticMuniFeatures2002(
    payloadsForSynthetic, muniNameMap, { '1T': coveredT1, '2T': coveredT2 }
  );
  geojson.features.push(...syntheticFeatures);

  return {
    geojson,
    officialTotals: {
      '1T': buildGeneralOfficialSummary(mergedTurno1, '1T'),
      ...(mergedTurno2 ? { '2T': buildGeneralOfficialSummary(mergedTurno2, '2T') } : {})
    },
    officialCityTotals: {
      '1T': buildGeneralCityTotals2002(mergedTurno1, '1T', muniNameMap),
      ...(mergedTurno2 ? { '2T': buildGeneralCityTotals2002(mergedTurno2, '2T', muniNameMap) } : {})
    }
  };
}

async function buildDeputyBaseGeojson2002(uf) {
  // Pontos: GPKG 2006 (o que bater bateu)
  const resultKeys = collectLoadedDeputyResultKeys();
  const baseGeo = await loadGeneralStateBaseFromGpkg2006(uf);
  return filterGeneralFeatures2006(baseGeo, resultKeys);
}

async function onClickLoadData_Geral_2002() {
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

    const results = await Promise.all(cargos.map((cargo) => loadMajoritariaCargo2002(cargo, ufToLoad)));
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
      throw new Error('Nenhum dado JSON encontrado para 2002.');
    }

    finalizeGeneralLoadUI(ufToLoad);
    showToast(`Dados de ${ufToLoad} (${year}) carregados!`, 'success');
  } catch (error) {
    console.error('[2002] Falha ao carregar gerais:', error);
    showToast(`Erro: ${error.message}`, 'error');
  } finally {
    setButtonLoading(dom.btnLoadData, false);
    setTimeout(() => { dom.mapLoader.classList.remove('visible'); }, 300);
  }
}

async function onClickLoadData_Deputies_2002(uf, year) {
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
      STATE.deputyCityTotals = {};
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

      // Reatribui locais de cidades que ainda nao existiam em 2002 (distritos do pai).
      if (window.EMANC) {
        await window.EMANC.ensureLoaded();
        window.EMANC.apply(2002, { resultsObjects: [results] });
      }

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
      } else {
        // Build city-level vote totals from JSON (covers municipalities with no GPKG dot)
        const muniNameMap = await getMuniNameMap2002(uf).catch(() => new Map());
        const rawCityTotals = new Map();
        Object.entries(results).forEach(([locId, voteMap]) => {
          const parts = locId.split('_');
          if (parts.length < 3) return;
          const cdMuni = parts[1];
          const cityName = muniNameMap.get(cdMuni);
          if (!cityName) return;
          let cityVotes = rawCityTotals.get(cityName);
          if (!cityVotes) { cityVotes = {}; rawCityTotals.set(cityName, cityVotes); }
          Object.entries(voteMap || {}).forEach(([cid, v]) => {
            cityVotes[cid] = (cityVotes[cid] || 0) + ensureNumber(v);
          });
        });
        if (!STATE.deputyCityTotals) STATE.deputyCityTotals = {};
        STATE.deputyCityTotals[cargoKey] = rawCityTotals;
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
    const baseGeo = await buildDeputyBaseGeojson2002(uf);
    if (!baseGeo?.features?.length) {
      throw new Error('Nenhum local de deputado 2002 encontrado no GPKG 2006.');
    }

    if (window.EMANC) {
      await window.EMANC.ensureLoaded();
      window.EMANC.apply(2002, { features: baseGeo.features });
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
    console.error('[2002] ERRO Deputados:', error);
    alert('Erro ao carregar dados de Deputado: ' + error.message);
  } finally {
    dom.mapLoader.classList.remove('visible');
  }
}
