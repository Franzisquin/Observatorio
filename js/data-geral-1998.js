// =====================================================================
// ELEICOES GERAIS DE 1998 (Majoritarias: Presidente, Governador, Senador)
// =====================================================================
// Mesma mecanica do fluxo geral de 2002 (js/data-geral-2002.js): os pontos
// do mapa vem da base de locais de 2006 (GPKG) -- "o que bater no GPKG bateu" --,
// os totais por municipio sao lidos direto do JSON (independente de quais locais
// geolocalizaram) e features sinteticas (geometry:null) carregam os votos nao
// cobertos. Como as secoes de 1998 nao tem NR_LOCAL_VOTACAO, a geolocalizacao foi
// feita na geracao (scripts/gerar_majoritarias_1998.py) via mapa secao->local de
// 2006; as secoes que nao geolocalizam recebem chave sintetica "..._S{secao}".
//
// Reutiliza, sem alterar, helpers globais definidos em data-geral-2002.js /
// data-geral-2006.js / data-geral-2022.js:
//   loadGeneralScopeBase2006, loadGeneralStateBaseFromGpkg2006, loadCensoJson2006,
//   buildGeneralCityTotals2002, buildSyntheticMuniFeatures2002,
//   applyGeneralMajoritariaJsonToGeojson2002, mergeGeneralJsonPayloads2002,
//   buildGeneralOfficialSummary, hasGeneralSecondTurnArchive.

// Mapa cd_municipio_tse -> nm_localidade, derivado da base de 2006 (mesma base de
// pontos). Usado apenas para agrupar os totais por municipio. Equivalente a
// A fonte de nomes e o GPKG/censo de 2006.
async function getMuniNameMap1998(uf) {
  const ufNorm = String(uf || '').toUpperCase();
  if (GENERAL_1998_BASE_CACHE.has(ufNorm)) return GENERAL_1998_BASE_CACHE.get(ufNorm);

  const promise = (async () => {
    const map = new Map();

    // Base 2006 (censo-enriquecida): features com local_key = {zona}_{cdMuni}_{local}.
    try {
      const baseGeo = await loadGeneralStateBaseFromGpkg2006(ufNorm);
      (baseGeo?.features || []).forEach((f) => {
        const props = f.properties || {};
        const localKey = String(props.local_key || props.id_unico || '');
        const parts = localKey.split('_');
        if (parts.length < 3) return;
        const cdMuni = parts[1];
        const cityName = String(props.nm_localidade || '').trim();
        if (cdMuni && cityName && !map.has(cdMuni)) map.set(cdMuni, cityName);
      });
    } catch (_) { /* base indisponivel, tenta censo abaixo */ }

    // Suplemento do censo 2006: cobre municipios sem local_key na base.
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
    } catch (_) { /* censo indisponivel, prossegue */ }

    return map;
  })();

  GENERAL_1998_BASE_CACHE.set(ufNorm, promise);
  return promise;
}

async function loadGeneralMajoritariaJson1998(cargo, uf, turno) {
  const ufNorm = String(uf || '').toUpperCase();
  const isSenador = cargo === 'senador';
  const isGovernador = cargo === 'governador';
  const zipUrl = isSenador
    ? `${DATA_BASE_URL}Majoritarias 1998/senador_1998_ord_t${turno}_${ufNorm}.zip`
    : isGovernador
      ? `${DATA_BASE_URL}Majoritarias 1998/governador_1998_ord_t${turno}_${ufNorm}.zip`
      : `${DATA_BASE_URL}Majoritarias 1998/${cargo}_1998_t${turno}_${ufNorm}.zip`;
  const filename = isSenador
    ? `senador_1998_ord_t${turno}_${ufNorm}.json`
    : isGovernador
      ? `governador_1998_ord_t${turno}_${ufNorm}.json`
      : `${cargo}_1998_t${turno}_${ufNorm}.json`;
  const { data } = await fetchJsonFromZipEntry(zipUrl, filename);
  return data;
}

async function loadMajoritariaCargo1998(cargo, uf) {
  const ufs = (cargo === 'presidente' && String(uf).toUpperCase() === 'BR')
    ? ALL_STATE_SIGLAS
    : [String(uf || '').toUpperCase()];

  const turno1Payloads = (await Promise.all(
    ufs.map((sigla) => loadGeneralMajoritariaJson1998(cargo, sigla, 1).catch(() => null))
  )).filter((payload) => payload?.RESULTS);

  if (!turno1Payloads.length) return null;

  const mergedTurno1 = mergeGeneralJsonPayloads2002(turno1Payloads);
  const resultKeys = new Set(Object.keys(mergedTurno1.RESULTS || {}));

  let mergedTurno2 = null;
  if (cargo !== 'senador' && cargo !== 'presidente') {
    const turno2Ufs = ufs.filter((sigla) => (
      typeof hasGeneralSecondTurnArchive === 'function'
        ? hasGeneralSecondTurnArchive(1998, cargo, sigla)
        : true
    ));
    const turno2Payloads = (await Promise.all(
      turno2Ufs.map((sigla) => loadGeneralMajoritariaJson1998(cargo, sigla, 2).catch(() => null))
    )).filter((payload) => payload?.RESULTS);

    if (turno2Payloads.length) {
      mergedTurno2 = mergeGeneralJsonPayloads2002(turno2Payloads);
      Object.keys(mergedTurno2.RESULTS || {}).forEach((key) => resultKeys.add(key));
    }
  }

  // Pontos do mapa: base 2006 (o que bater bateu).
  const geojson = await loadGeneralScopeBase2006(ufs, resultKeys);

  // Compila muniNameMap e muniIbgeMap a partir da base 2006 e Censo 2006
  const muniNameMap = new Map();
  const muniIbgeVotes = new Map();
  const tallyMuniInfo = (key, name, ibge) => {
    const cdMuni = extractMunicipioCodeFromGeneralResultKey(key);
    if (!cdMuni) return;
    const cleanName = String(name || '').trim();
    if (cleanName && !muniNameMap.has(cdMuni)) muniNameMap.set(cdMuni, cleanName);
    const cleanIbge = String(ibge || '').trim();
    if (cleanIbge) {
      let votes = muniIbgeVotes.get(cdMuni);
      if (!votes) { votes = new Map(); muniIbgeVotes.set(cdMuni, votes); }
      votes.set(cleanIbge, (votes.get(cleanIbge) || 0) + 1);
    }
  };

  (geojson.features || []).forEach((f) => {
    const props = f.properties || {};
    const key = String(props.id_unico || props.local_key || '');
    tallyMuniInfo(key, props.nm_localidade, props.cod_localidade_ibge || props.cd_ibge);
  });

  await Promise.all(ufs.map(async (sigla) => {
    try {
      const censusJson = await loadCensoJson2006(sigla);
      Object.entries(censusJson?.RESULTS || {}).forEach(([k, row]) => {
        const key = String(row?.local_key || row?.ID_UNICO || k || '');
        tallyMuniInfo(key, row?.nm_localidade, row?.cod_localidade_ibge || row?.cd_ibge);
      });
    } catch (_) {}
  }));

  const muniIbgeMap = new Map();
  muniIbgeVotes.forEach((votes, cdMuni) => {
    let bestIbge = '', bestCount = -1;
    votes.forEach((count, ibge) => { if (count > bestCount) { bestCount = count; bestIbge = ibge; } });
    if (bestIbge) muniIbgeMap.set(cdMuni, bestIbge);
  });

  applyGeneralMajoritariaJsonToGeojson2002(geojson, mergedTurno1, '1T', muniNameMap);
  if (mergedTurno2) applyGeneralMajoritariaJsonToGeojson2002(geojson, mergedTurno2, '2T', muniNameMap);

  // Chaves dos dots cobertas pela base 2006 (por turno).
  const coveredT1 = new Set();
  const coveredT2 = new Set();
  (geojson.features || []).forEach((f) => {
    const k = String(f.properties?.id_unico || f.properties?.local_key || '');
    if (!k) return;
    if (mergedTurno1.RESULTS[k]) coveredT1.add(k);
    if (mergedTurno2?.RESULTS[k]) coveredT2.add(k);
  });

  // Features sinteticas com votos restantes (total_json - dots), garantindo que
  // a visao geral por municipio use o total real (sum dots + sum sintetica).
  const payloadsForSynthetic = [
    { payload: mergedTurno1, turnoKey: '1T' },
    ...(mergedTurno2 ? [{ payload: mergedTurno2, turnoKey: '2T' }] : []),
  ];
  const syntheticFeatures = buildSyntheticMuniFeatures2002(
    payloadsForSynthetic, muniNameMap, { '1T': coveredT1, '2T': coveredT2 }
  );
  geojson.features.push(...syntheticFeatures);

  const officialCityTotals = {
    '1T': buildGeneralCityTotals2002(mergedTurno1, '1T', muniNameMap, muniIbgeMap),
    ...(mergedTurno2 ? { '2T': buildGeneralCityTotals2002(mergedTurno2, '2T', muniNameMap, muniIbgeMap) } : {})
  };
  await adjustEmancCityTotals(1998, cargo, ufs, muniNameMap, officialCityTotals,
    { '1T': mergedTurno1, '2T': mergedTurno2 });

  return {
    geojson,
    officialTotals: {
      '1T': buildGeneralOfficialSummary(mergedTurno1, '1T'),
      ...(mergedTurno2 ? { '2T': buildGeneralOfficialSummary(mergedTurno2, '2T') } : {})
    },
    officialCityTotals
  };
}

async function onClickLoadData_Geral_1998() {
  const year = STATE.currentElectionYear;

  if (currentOffice === 'deputado') {
    showToast('Deputados de 1998 ainda nao disponiveis no ElectoMaps.', 'info');
    return;
  }

  if (!dom.selectUFGeneral.value && currentOffice !== 'presidente') return;
  if (currentOffice === 'presidente' && !dom.selectUFGeneral.value) dom.selectUFGeneral.value = 'BR';

  const ufToLoad = dom.selectUFGeneral.value || 'BR';

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

    const results = await Promise.all(cargos.map((cargo) => loadMajoritariaCargo1998(cargo, ufToLoad)));
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
      throw new Error('Nenhum dado JSON encontrado para 1998.');
    }

    finalizeGeneralLoadUI(ufToLoad);
    showToast(`Dados de ${ufToLoad} (${year}) carregados!`, 'success');
  } catch (error) {
    console.error('[1998] Falha ao carregar gerais:', error);
    showToast(`Erro: ${error.message}`, 'error');
  } finally {
    setButtonLoading(dom.btnLoadData, false);
    setTimeout(() => { dom.mapLoader.classList.remove('visible'); }, 300);
  }
}
