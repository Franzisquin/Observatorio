async function onClickLoadData_General_legado() {
  const uf = dom.selectUFGeneral.value;
  const year = STATE.currentElectionYear;

  // Validação básica
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

  // Ativa loading states
  setButtonLoading(dom.btnLoadData, true);
  dom.mapLoader.textContent = `Processando dados de ${ufToLoad} (${year})...`;
  dom.mapLoader.classList.add('visible');

  // === OTIMIZAÇÃO DE MEMÓRIA ===
  clearZipCache(); // Limpa leitores ZIP

  if (currentLayer) {
    currentLayer.clearLayers(); // Limpa camadas internas do Leaflet
    map.removeLayer(currentLayer);
    currentLayer = null;
  }

  // Força o coletor de lixo a liberar dados antigos
  currentDataCollection = null;
  currentDataCollection = {};
  currentDataCollection_2022 = {};
  STATE.spatialIndex2022 = { presidente: null, governador: null, senador: null };

  uniqueCidades.clear();
  uniqueBairros.clear();
  clearSelection(true);

  // === ADICIONAR AQUI ===
  if (currentOffice === 'deputado') {
    clearDeputyData();
  } else {
    // Clear cache for general elections to force re-discovery of candidates
    CANDIDATES_CACHE.clear();
  }
  // ======================
  // ==============================

  currentSubType = 'ord';
  currentCargo = `${currentOffice}_${currentSubType}`;

  try {
    const promises = [];
    const keys = [];

    const queueLoad = (cargo, type) => {
      const key = `${cargo}_${type}`;
      keys.push(key);
      return loadGeoJSON(cargo, ufToLoad, year, type);
    };

    if (ufToLoad === 'BR') {
      promises.push(queueLoad('presidente', 'ord'));
    } else {
      ['presidente', 'governador', 'senador'].forEach(cargo => {
        promises.push(queueLoad(cargo, 'ord'));
        promises.push(queueLoad(cargo, 'sup'));
      });
    }

    const censusIndex = promises.length;
    promises.push(fetchGeoJSON(buildDataPath_Census(ufToLoad, year)).catch(() => null));

    const results = await Promise.all(promises);
    const censusData = results[censusIndex];

    let dataFound = false;
    results.forEach((data, index) => {
      if (index === censusIndex) return;
      if (data) {
        const key = keys[index];
        if (censusData) mergeCensusData(data, censusData);
        currentDataCollection[key] = data;
        processLoadedGeoJSON(data, key);
        dataFound = true;
      }
    });

    if (!dataFound) throw new Error("Nenhum dado encontrado.");

    const preservedMeso = currentMesorregiaoFilter;
    const preservedMicro = currentMicrorregiaoFilter;
    const preservedCidade = currentCidadeFilter;
    const preservedBairro = currentBairroFilter;
    const preservedLocal = currentLocalFilter;
    populateRegionalDropdowns();
    currentMesorregiaoFilter = preservedMeso;
    currentMicrorregiaoFilter = preservedMicro;
    populateCidadeDropdown();
    [dom.filterBox, dom.vizBox].forEach(el => el.classList.remove('section-hidden'));

    if (mesorregiaoCombobox) mesorregiaoCombobox.disable(ufToLoad === 'BR');
    if (microrregiaoCombobox) microrregiaoCombobox.disable(ufToLoad === 'BR');
    if (cidadeCombobox) {
      cidadeCombobox.disable(false);
      cidadeCombobox.setValue("Todos os municípios");
      currentCidadeFilter = preservedCidade;
    }
    if (dom.selectVizColorStyle) dom.selectVizColorStyle.disabled = false;
    if (dom.selectVizSize) dom.selectVizSize.disabled = false;
    dom.btnApplyFilters.disabled = false;
    updateApplyButtonText();
    dom.searchLocal.disabled = false;

    updateElectionTypeUI();

    if (ufToLoad !== 'BR') {
      dom.summaryBoxContainer.classList.remove('section-hidden');
    } else {
      dom.summaryBoxContainer.classList.add('section-hidden');
    }

    const hasAnyInaptos = Object.values(STATE.dataHasInaptos).some(v => v);
    dom.btnToggleInaptos.disabled = !hasAnyInaptos;
    STATE.filterInaptos = false;
    dom.btnToggleInaptos.classList.remove('active');
    dom.btnToggleInaptos.textContent = 'Filtrar Inaptos';

    updateConditionalUI();

    // REDESENHA O MAPA
    applyFiltersAndRedraw();

    // === CORREÇÃO DO PRINT / ZOOM ===
    if (currentLayer) {
      try {
        if (typeof currentLayer.getBounds === 'function') {
          const bounds = currentLayer.getBounds();
          if (bounds && bounds.isValid()) {
            if (typeof applyMapViewportAfterDataLoad === 'function') {
              applyMapViewportAfterDataLoad(bounds, { animate: false, padding: [20, 20] });
            } else {
              map.fitBounds(bounds, { animate: false, padding: [20, 20] });
            }
          }
        }
      } catch (e) {
        console.log("Não foi possível ajustar bounds automaticamente");
      }
    }

    showToast(`Dados de ${ufToLoad} (${year}) carregados!`, 'success');

  } catch (e) {
    console.error(`Falha ao carregar GeoJSON ${year}:`, e);
    showToast(`Erro: ${e.message}`, 'error');
  } finally {
    setButtonLoading(dom.btnLoadData, false);

    // Pequeno delay para garantir que o Leaflet renderizou o zoom correto antes de sumir com o loader
    setTimeout(() => {
      dom.mapLoader.classList.remove('visible');
    }, 300);
  }
}

// Global cache tracker to know what we have loaded
let loadedDeputyState = { uf: null, types: new Set(), year: null };

function normalizePartyAlias(s) {
  let p = (s || '').toUpperCase().trim();
  p = p.replace('FEDERAÇÃO ', '');
  if (p === 'PATRI') return 'PATRIOTA';
  if (p === 'PODE') return 'PODEMOS';
  if (p === 'SD') return 'SOLIDARIEDADE';
  if (p === 'PC DO B') return 'PCDOB'; // Often written differently
  return p;
}

function normalizeComp(str) {
  if (!str) return "";
  return str.split('/').map(s => s.trim().toUpperCase()).sort().join('/');
}

async function onClickLoadData_Deputies_legado(uf, year) {
  // Determine Type based on current selection
  const isEstadual = currentCargo === 'deputado_estadual';
  const typeKey = isEstadual ? 'e' : 'f';
  const typeLabel = isEstadual ? 'estadual' : 'federal';

  console.log(`[onClickLoadData_Deputies] Iniciando carga - UF: ${uf}, Ano: ${year}, Tipo: ${typeLabel}`);
  console.log(`[onClickLoadData_Deputies] Estado atual - UF: ${loadedDeputyState.uf}, Ano: ${loadedDeputyState.year}, Types: ${Array.from(loadedDeputyState.types)}`);

  // Check if we need to reload deputy data (votes)
  const shouldReloadDeputyData = (
    loadedDeputyState.uf !== uf ||
    !loadedDeputyState.types.has(typeKey) ||
    loadedDeputyState.year !== year
  );

  // Check if we need to reload base map (geometry)
  const shouldReloadBaseMap = (
    loadedDeputyState.uf !== uf ||
    loadedDeputyState.year !== year
  );

  console.log(`[onClickLoadData_Deputies] shouldReloadDeputyData: ${shouldReloadDeputyData}, shouldReloadBaseMap: ${shouldReloadBaseMap}`);

  if (!shouldReloadDeputyData) {
    console.log(`Deputy data for ${typeLabel} ${uf} (${year}) already in memory.`);
  } else {
    dom.mapLoader.textContent = `Carregando Deputados ${typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1)} ${uf} (${year})...`;
    dom.mapLoader.classList.add('visible');

    // === CORREÇÃO CRÍTICA AQUI ===
    // Verifica se mudou a UF OU se mudou o ANO.
    if (loadedDeputyState.uf !== uf || loadedDeputyState.year !== year) {
      console.log("Detectada mudança de Estado ou Ano. Realizando limpeza completa...");

      clearZipCache();
      if (currentLayer) {
        try {
          currentLayer.off();
          currentLayer.clearLayers();
          map.removeLayer(currentLayer);
        } catch (e) {
          console.warn("Erro ao remover camada:", e);
        }
        currentLayer = null;
      }
      clearSelection(true);

      // Limpa dados geoespaciais antigos para garantir que o mapa base do ano correto seja carregado
      currentDataCollection = {};
      STATE.spatialIndex2022 = { presidente: null, governador: null, senador: null };
      uniqueCidades.clear();
      uniqueBairros.clear();

      clearDeputyData(); // USA A NOVA FUNÇÃO (Isso reseta o loadedDeputyState para nulo/vazio)

      // Reinicializa o rastreador de estado
      loadedDeputyState.uf = uf;
      loadedDeputyState.year = year;
      loadedDeputyState.types.clear(); // CRITICAL: Limpa os tipos também!
    }

    try {
      if (!STATE.officialTotals) STATE.officialTotals = {};

      // 0. Load Official Totals (Once per Year)
      if (['2006', '2010', '2014', '2018', '2022'].includes(year) && !STATE.officialTotals[year]) {
        try {
          const res = await fetch(`resultados_geo/Legislativas ${year}/official_totals_${year}.json`);
          if (res.ok) {
            STATE.officialTotals[year] = await res.json();
            console.log(`Totais Oficiais ${year} carregados.`);
          }
        } catch (e) { console.warn(`Erro ao carregar totais ${year}`, e); }
      }

      // 1. Load the Generated JSON (Specific to Cargo)
      // Path: resultados_geo/Legislativas {year}/deputados_{type}_{year}_{uf}.zip
      const zipPath = `resultados_geo/Legislativas ${year}/deputados_${typeLabel}_${year}_${uf}.zip`;
      const jsonName = `deputados_${typeLabel}_${year}_${uf}.json`;

      let fullJson = null;

      console.log(`[onClickLoadData_Deputies] Carregando ZIP: ${zipPath}`);

      try {
        const { entries } = await unzipit.unzip(zipPath);
        if (entries[jsonName]) {
          fullJson = await entries[jsonName].json();
        } else {
          // Fallback
          const key = Object.keys(entries).find(k => k.endsWith('.json'));
          if (key) fullJson = await entries[key].json();
        }
      } catch (err) {
        console.warn(`Could not load ${typeLabel} zip:`, err);
        // Might not exist yet (e.g. if files not generated).
        throw new Error(`Dados de deputados (${typeLabel}) não encontrados para ${uf}.`);
      }

      if (!fullJson) throw new Error("JSON vazio.");

      console.log(`[onClickLoadData_Deputies] JSON carregado com ${Object.keys(fullJson.RESULTS || {}).length} locais`);

      // Merge Data
      // Incoming: { RESULTS: { 'LOCAL_ID': { cand: votes } }, METADATA: ... }
      // Target STATE.deputyResults: { 'LOCAL_ID': { f: {..}, e: {..} } }

      const results = fullJson.RESULTS;
      const meta = fullJson.METADATA.cand_names;

      // Merge Metrics/Results
      Object.entries(results).forEach(([locId, votes]) => {
        if (!STATE.deputyResults[locId]) STATE.deputyResults[locId] = { f: {}, e: {} };
        STATE.deputyResults[locId][typeKey] = votes;
      });

      // Merge Metadata
      Object.assign(STATE.deputyMetadata, meta);
      deputyNameToIdCache = {}; // Invalidate reverse map cache

      // Populate STATE.inaptos for the current cargo
      if (!STATE.inaptos) STATE.inaptos = {};
      if (!STATE.inaptos[currentCargo]) STATE.inaptos[currentCargo] = { '1T': [], '2T': [] };
      STATE.inaptos[currentCargo]['1T'] = Object.entries(meta)
        .filter(([cid, cmeta]) => cmeta && cmeta[2] && cmeta[2].toUpperCase().includes('INAPTO'))
        .map(([cid]) => cid);

      // Load Coalition Adjustments (Official Totals Difference)
      if (fullJson.METADATA.coalition_adjustments) {
        if (!STATE.deputyAdjustments) STATE.deputyAdjustments = {};
        Object.assign(STATE.deputyAdjustments, fullJson.METADATA.coalition_adjustments);
      }

      // Mark as loaded with correct year
      loadedDeputyState.types.add(typeKey);
      loadedDeputyState.year = year;

      console.log(`[onClickLoadData_Deputies] Dados de deputados carregados. Types: ${Array.from(loadedDeputyState.types)}`);

    } catch (err) {
      dom.mapLoader.classList.remove('visible');
      alert(err.message);
      return;
    }
  }

  // === CRITICAL FIX: SEMPRE recarrega o mapa base se o ano ou UF mudou ===
  try {
    console.log(`[onClickLoadData_Deputies] shouldReloadBaseMap: ${shouldReloadBaseMap}`);

    // SEMPRE carrega o mapa base quando necessário
    if (shouldReloadBaseMap || !currentDataCollection['deputado_federal']) {
      console.log(`[onClickLoadData_Deputies] Carregando mapa base (presidente_ord) para ${uf} ${year}...`);

      // 2. Load Base GeoJSON (Using Presidente 1T as geometry base) AND Census
      // mapped to 'deputado_federal' and 'deputado_estadual'
      const [baseGeo, censusData] = await Promise.all([
        loadGeoJSON('presidente', uf, year, 'ord'),
        fetchGeoJSON(buildDataPath_Census(uf, year)).catch(() => null)
      ]);

      if (!baseGeo) throw new Error("Erro ao carregar mapa base (presidente_ord).");

      console.log(`[onClickLoadData_Deputies] Mapa base carregado com ${baseGeo.features.length} features`);

      // 3. Process Features: Optimized (No Cloning, No Injection)
      // We use dynamic lookup via getDeputyFeatureData during render.

      // Just populate Filters (Cidades/Bairros) ONCE using the base map
      uniqueCidades.clear();
      uniqueBairros.clear();

      baseGeo.features.forEach(f => {
        const p = f.properties;
        const city = getProp(p, 'nm_localidade');
        if (city) uniqueCidades.add(city);
        const bairro = getProp(p, 'ds_bairro');
        if (bairro) uniqueBairros.add(bairro);
      });

      // Merge Census Data (Modifies baseGeo in place, which is fine)
      if (censusData) {
        mergeCensusData(baseGeo, censusData);
      }

      // Store Shared Reference (Zero Copy)
      currentDataCollection['deputado_federal'] = baseGeo;
      currentDataCollection['deputado_estadual'] = baseGeo;

      console.log(`[onClickLoadData_Deputies] currentDataCollection atualizado`);
    } else {
      console.log(`[onClickLoadData_Deputies] Mapa base já carregado, reutilizando`);
    }


    // Initialize View vars BEFORE populating UI
    currentOffice = 'deputado';
    const sub = dom.cargoChipsGeneral.querySelector('.active')?.dataset.subtype || (currentCargo.includes('estadual') ? 'estadual' : 'federal');
    currentSubType = sub;
    currentCargo = `deputado_${sub}`;

    console.log(`[onClickLoadData_Deputies] currentCargo definido como: ${currentCargo}`);

    // Setup UI
    currentMesorregiaoFilter = 'all';
    currentMicrorregiaoFilter = 'all';
    populateRegionalDropdowns();
    populateCidadeDropdown();
    [dom.filterBox, dom.vizBox].forEach(el => el.classList.remove('section-hidden'));

    if (mesorregiaoCombobox) mesorregiaoCombobox.disable(uf === 'BR');
    if (microrregiaoCombobox) microrregiaoCombobox.disable(uf === 'BR');
    if (cidadeCombobox) {
      cidadeCombobox.disable(false);
      cidadeCombobox.setValue("Todos os municípios");
      currentCidadeFilter = 'all';
    }
    if (dom.selectVizColorStyle) dom.selectVizColorStyle.disabled = false;
    if (dom.selectVizSize) dom.selectVizSize.disabled = false;
    dom.btnApplyFilters.disabled = false;
    updateApplyButtonText();
    dom.searchLocal.disabled = false;

    updateElectionTypeUI();
    updateConditionalUI();

    // Força recriação do lookup para o modal funcionar corretamente
    STATE.deputyLookup = null;
    STATE.deputyLookupCargo = null;

    // Recomputa vencedores para o novo estado/ano
    if (currentCargo.startsWith('deputado')) {
      console.log(`[onClickLoadData_Deputies] Precomputando vencedores...`);
      precomputeDeputyWinners();
    }

    // Habilita o botão "Filtrar Inaptos" se houver candidatos inaptos nos dados de deputados
    const hasDeputyInaptos = (STATE.inaptos[currentCargo]?.['1T']?.length || 0) > 0 ||
      (STATE.inaptos[currentCargo]?.['2T']?.length || 0) > 0;
    const hasAnyInaptos = hasDeputyInaptos || Object.values(STATE.dataHasInaptos).some(v => v);
    dom.btnToggleInaptos.disabled = !hasAnyInaptos;
    if (!hasAnyInaptos) {
      STATE.filterInaptos = false;
      dom.btnToggleInaptos.classList.remove('active');
      dom.btnToggleInaptos.textContent = 'Filtrar Inaptos';
    }

    if (currentCidadeFilter === 'all') {
      STATE.currentMapMode = 'municipios';
    } else {
      STATE.currentMapMode = 'locais';
    }

    console.log(`[onClickLoadData_Deputies] Chamando applyFiltersAndRedraw... MapMode: ${STATE.currentMapMode}`);
    applyFiltersAndRedraw();

    if (currentLayer) {
      try {
        if (typeof currentLayer.getBounds === 'function') {
          const bounds = currentLayer.getBounds();
          if (bounds && bounds.isValid()) {
            if (typeof applyMapViewportAfterDataLoad === 'function') {
              applyMapViewportAfterDataLoad(bounds);
            } else {
              map.fitBounds(bounds);
            }
          }
        }
      } catch (e) {
        console.log("Não foi possível ajustar bounds automaticamente");
      }
    }

    console.log(`[onClickLoadData_Deputies] Carregamento completo!`);
    showToast(`Dados de deputados ${typeLabel} ${uf} (${year}) carregados!`, 'success');

  } catch (e) {
    console.error("[onClickLoadData_Deputies] ERRO:", e);
    alert("Erro ao carregar dados de Deputado: " + e.message);
  } finally {
    dom.mapLoader.classList.remove('visible');
  }
}
