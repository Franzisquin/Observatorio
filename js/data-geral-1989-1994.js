// =====================================================================
// ELEICOES GERAIS SEM DADOS POR LOCAL DE VOTACAO: 1989 e 1994
// =====================================================================
// 1989 (so Presidente, 2 turnos) e 1994 (Presidente, Governador, Senador e
// Deputados) NAO tem dados por local de votacao — o resultado existe apenas por
// MUNICIPIO. Cada municipio e uma chave sintetica "1_{cdMuni}_M" no RESULTS
// (parts[1] = codigo TSE em 1994, IBGE-7 em 1989), gerado por
// scripts/gerar_presidencial_1989.py, scripts/gerar_majoritarias_1994.py e
// scripts/gerar_legislativas_1994.py. No site, TODAS as features desses anos
// sao sinteticas (geometry:null) — nao existe modo "Locais"; o mapa e o
// coropletico da malha municipal historica (resultados_geo/municipios_{ano}/,
// convertida do SVG do ano por scripts/gerar_malha_svg.py).
//
// Os nomes/codigos de municipio vem embutidos no METADATA de cada JSON
// (muni_names / muni_ibge), entao nenhum GPKG e baixado nesses anos.
//
// Reutiliza, sem alterar, helpers de data-geral-2002.js:
//   mergeGeneralJsonPayloads2002, buildSyntheticMuniFeatures2002,
//   buildGeneralCityTotals2002, buildGeneralOfficialSummary,
//   hasGeneralSecondTurnArchive.

function buildMuniMaps1994(payloads) {
  const muniNameMap = new Map();
  const muniIbgeMap = new Map();
  (payloads || []).forEach((payload) => {
    Object.entries(payload?.METADATA?.muni_names || {}).forEach(([cd, nome]) => {
      if (!muniNameMap.has(cd)) muniNameMap.set(cd, nome);
    });
    Object.entries(payload?.METADATA?.muni_ibge || {}).forEach(([cd, ibge]) => {
      if (!muniIbgeMap.has(cd)) muniIbgeMap.set(cd, ibge);
    });
  });
  return { muniNameMap, muniIbgeMap };
}

// Versao 1994 do buildSyntheticMuniFeatures2002: alem dos votos, cada municipio
// recebe id_unico = chave RESULTS e o turnout oficial (comparecimento/aptos) de
// METADATA.muni_turnout — que se perde no merge, por isso recebemos os payloads
// BRUTOS por turno (UFs sao disjuntas, sem dupla contagem).
//
// O codigo IBGE (muniIbgeMap) tambem vai nas props: sem ele o filtro por regiao
// e o join com a malha cairiam no nome, que nem sempre bate (1989/1994 usam a
// grafia da epoca) — por codigo o casamento e exato.
function buildSyntheticMuniFeatures1994(rawPayloadsByTurno, muniNameMap, muniIbgeMap) {
  const featuresByMuni = new Map();

  Object.entries(rawPayloadsByTurno).forEach(([turnoKey, payloads]) => {
    (payloads || []).forEach((payload) => {
      if (!payload?.RESULTS) return;
      const metadata = payload.METADATA?.cand_names || {};
      const turnout = payload.METADATA?.muni_turnout || {};

      Object.entries(payload.RESULTS).forEach(([key, votes]) => {
        const parts = key.split('_');
        if (parts.length < 3) return;
        const cdMuni = parts[1];
        const cityName = muniNameMap.get(cdMuni);
        if (!cityName) return;

        let feature = featuresByMuni.get(cdMuni);
        if (!feature) {
          feature = {
            type: 'Feature',
            geometry: null,
            properties: {
              nm_localidade: cityName,
              cod_localidade_ibge: String(muniIbgeMap?.get(cdMuni) || ''),
              id_unico: key,
              ID_UNICO: key,
              local_key: key,
              local_id: key
            }
          };
          featuresByMuni.set(cdMuni, feature);
        }
        const props = feature.properties;

        applyTurnMetricsFromJsonVotes(props, votes, turnoKey, false);

        Object.entries(votes).forEach(([cid, rawVotes]) => {
          if (cid === '95' || cid === '96') return;
          const meta = metadata[cid];
          if (!meta) return;
          const nome = meta[0] || `Candidato ${cid}`;
          const partido = meta[1] || '?';
          const status = meta[2] || 'N/D';
          props[`${nome} (${partido}) (${status}) ${turnoKey}`] = ensureNumber(rawVotes);
        });

        // Turnout oficial DEPOIS do apply (que zera Abstencoes/Aptos).
        const t = turnout[cdMuni];
        if (t) {
          const aptos = ensureNumber(t[0]);
          const comparecimento = ensureNumber(t[1]);
          if (comparecimento > 0) props[`Comparecimento ${turnoKey}`] = comparecimento;
          if (aptos > 0) props[`Eleitores_Aptos_Municipal ${turnoKey}`] = aptos;
          if (aptos > 0 && comparecimento > 0) {
            props[`Abstenções ${turnoKey}`] = Math.max(0, aptos - comparecimento);
          }
        }
      });
    });
  });

  return Array.from(featuresByMuni.values());
}

async function loadGeneralMajoritariaJson1994(year, cargo, uf, turno) {
  const ufNorm = String(uf || '').toUpperCase();
  const isSenador = cargo === 'senador';
  const isGovernador = cargo === 'governador';
  const basename = isSenador
    ? `senador_${year}_ord_t${turno}_${ufNorm}`
    : isGovernador
      ? `governador_${year}_ord_t${turno}_${ufNorm}`
      : `${cargo}_${year}_t${turno}_${ufNorm}`;
  const { data } = await fetchJsonFromZipEntry(
    `${DATA_BASE_URL}Majoritarias ${year}/${basename}.zip`, `${basename}.json`);
  return data;
}

async function loadMajoritariaCargo1994(year, cargo, uf) {
  const ufs = (cargo === 'presidente' && String(uf).toUpperCase() === 'BR')
    ? ALL_STATE_SIGLAS
    : [String(uf || '').toUpperCase()];

  const turno1Payloads = (await Promise.all(
    ufs.map((sigla) => loadGeneralMajoritariaJson1994(year, cargo, sigla, 1).catch(() => null))
  )).filter((payload) => payload?.RESULTS);

  if (!turno1Payloads.length) return null;

  const mergedTurno1 = mergeGeneralJsonPayloads2002(turno1Payloads);

  // Quem tem 2o turno vem de GENERAL_SECOND_TURN_AVAILABILITY (presidente 1989
  // teve; presidente 1994 nao, e senador nunca tem).
  let mergedTurno2 = null;
  let turno2Payloads = [];
  if (cargo !== 'senador') {
    const turno2Ufs = ufs.filter((sigla) => (
      typeof hasGeneralSecondTurnArchive === 'function'
        ? hasGeneralSecondTurnArchive(year, cargo, sigla)
        : true
    ));
    turno2Payloads = (await Promise.all(
      turno2Ufs.map((sigla) => loadGeneralMajoritariaJson1994(year, cargo, sigla, 2).catch(() => null))
    )).filter((payload) => payload?.RESULTS);

    if (turno2Payloads.length) {
      mergedTurno2 = mergeGeneralJsonPayloads2002(turno2Payloads);
    }
  }

  const { muniNameMap, muniIbgeMap } = buildMuniMaps1994(
    turno1Payloads.concat(turno2Payloads));

  // Sem locais: nenhum dot, tudo vira feature sintetica por municipio,
  // com id = chave RESULTS e turnout oficial (comparecimento/aptos) do detalhe.
  const geojson = { type: 'FeatureCollection', features: [] };
  const syntheticFeatures = buildSyntheticMuniFeatures1994({
    '1T': turno1Payloads,
    ...(turno2Payloads.length ? { '2T': turno2Payloads } : {})
  }, muniNameMap, muniIbgeMap);
  geojson.features.push(...syntheticFeatures);

  const officialCityTotals = {
    '1T': buildGeneralCityTotals2002(mergedTurno1, '1T', muniNameMap, muniIbgeMap),
    ...(mergedTurno2 ? { '2T': buildGeneralCityTotals2002(mergedTurno2, '2T', muniNameMap, muniIbgeMap) } : {})
  };

  return {
    geojson,
    officialTotals: {
      '1T': buildGeneralOfficialSummary(mergedTurno1, '1T'),
      ...(mergedTurno2 ? { '2T': buildGeneralOfficialSummary(mergedTurno2, '2T') } : {})
    },
    officialCityTotals
  };
}

async function onClickLoadData_Geral_1994() {
  const year = STATE.currentElectionYear;

  if (currentOffice === 'deputado') {
    if (!dom.selectUFGeneral.value) return;
    setButtonLoading(dom.btnLoadData, true);
    await window.onClickLoadData_Deputies(dom.selectUFGeneral.value, year);
    setButtonLoading(dom.btnLoadData, false);
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
    // Em 1989 so houve eleicao presidencial.
    const cargos = (ufToLoad === 'BR' || String(year) === '1989')
      ? ['presidente']
      : ['presidente', 'governador', 'senador'];

    const results = await Promise.all(cargos.map((cargo) => loadMajoritariaCargo1994(year, cargo, ufToLoad)));
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
      throw new Error(`Nenhum dado JSON encontrado para ${year}.`);
    }

    finalizeGeneralLoadUI(ufToLoad);
    if (ufToLoad === 'BR') {
      showToast(`Mapa nacional indisponível para ${year}; selecione uma UF para ver o mapa.`, 'info');
    }
    showToast(`Dados de ${ufToLoad} (${year}) carregados!`, 'success');
  } catch (error) {
    console.error(`[${year}] Falha ao carregar gerais:`, error);
    showToast(`Erro: ${error.message}`, 'error');
  } finally {
    setButtonLoading(dom.btnLoadData, false);
    setTimeout(() => { dom.mapLoader.classList.remove('visible'); }, 300);
  }
}

// Base sintetica de deputados: uma feature geometry:null por municipio, com
// id_unico = chave RESULTS ("1_{cdMuni}_M") para o lookup em STATE.deputyResults,
// e o turnout oficial (comparecimento/aptos) do detalhe de votacao.
//
// O codigo IBGE e obrigatorio, nao decorativo: o filtro por regiao casa
// municipio<->regiao SO por codigo, entao sem ele nenhuma feature de deputado
// passaria no recorte e o painel de resultados ficaria vazio ao filtrar regiao.
function buildDeputyBaseGeojson1994(results, muniNameMap, muniTurnout, muniIbgeMap) {
  const turnout = muniTurnout || {};
  const features = Object.keys(results || {}).map((key) => {
    const parts = key.split('_');
    const cdMuni = parts.length >= 2 ? parts[1] : '';
    const props = {
      id_unico: key,
      ID_UNICO: key,
      local_key: key,
      local_id: key,
      cod_localidade_ibge: String(muniIbgeMap?.get(cdMuni) || ''),
      nm_localidade: muniNameMap.get(cdMuni) || `Município ${cdMuni}`
    };
    const t = turnout[cdMuni];
    if (t) {
      const aptos = ensureNumber(t[0]);
      const comparecimento = ensureNumber(t[1]);
      if (comparecimento > 0) props['Comparecimento 1T'] = comparecimento;
      if (aptos > 0) props['Eleitores_Aptos_Municipal 1T'] = aptos;
    }
    return { type: 'Feature', geometry: null, properties: props };
  });
  return { type: 'FeatureCollection', features };
}

async function onClickLoadData_Deputies_1994(uf, year) {
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
      // Vagas em Jogo oficiais (consulta_vagas) + totais por partido.
      if (!STATE.officialTotals) STATE.officialTotals = {};
      if (!STATE.officialTotals[year]) {
        const res = await fetch(`resultados_geo/Legislativas ${year}/official_totals_${year}.json`);
        if (res.ok) {
          STATE.officialTotals[year] = await res.json();
        }
      }

      const cargoKey = isEstadual ? 'deputado_estadual' : 'deputado_federal';
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

      // O resumo municipal sai de buildDeputyMunicipalSummaryFromResults, que
      // agrega o RESULTS por codigo — nao ha mais mapa por nome aqui.
      const { muniNameMap, muniIbgeMap } = buildMuniMaps1994([fullJson]);

      // Guarda a base sintetica para reuso pelos dois tipos (f/e).
      STATE._deputyBase1994 = buildDeputyBaseGeojson1994(
        results, muniNameMap, fullJson.METADATA?.muni_turnout, muniIbgeMap);

      loadedDeputyState.types.add(typeKey);
      loadedDeputyState.year = year;
    } catch (error) {
      dom.mapLoader.classList.remove('visible');
      showToast('Erro ao carregar dados de Deputado: ' + error.message, 'error');
      return;
    }
  }

  try {
    const baseGeo = STATE._deputyBase1994;
    if (!baseGeo?.features?.length) {
      throw new Error('Nenhum municipio de deputado 1994 encontrado.');
    }

    if (shouldReloadBaseState || !currentDataCollection['deputado_federal']) {
      uniqueCidades.clear();
      uniqueBairros.clear();
    }

    baseGeo.features.forEach((feature) => {
      const city = getProp(feature.properties || {}, 'nm_localidade');
      if (city) uniqueCidades.add(city);
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

    showToast(`Dados de deputados ${typeLabel} ${uf} (${year}) carregados!`, 'success');
  } catch (error) {
    console.error('[1994] ERRO Deputados:', error);
    showToast('Erro ao carregar dados de Deputado: ' + error.message, 'error');
  } finally {
    dom.mapLoader.classList.remove('visible');
  }
}
