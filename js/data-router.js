async function onClickLoadData_Municipal_2024(uf, municipio, ano) {
  if (currentOffice === 'vereador') {
    await loadMunicipal2024Vereador(uf, municipio, ano);
    return;
  }

  await loadMunicipal2024Prefeito(uf, municipio, ano);
}

async function onClickLoadData_Municipal_2020(uf, municipio, ano) {
  if (currentOffice === 'vereador') {
    await loadMunicipal2020Vereador(uf, municipio, ano);
    return;
  }

  await loadMunicipal2020Prefeito(uf, municipio, ano);
}

async function onClickLoadData_Municipal_2012(uf, municipio, ano) {
  if (currentOffice === 'vereador') {
    await loadMunicipal2012Vereador(uf, municipio, ano);
    return;
  }

  await loadMunicipal2012Prefeito(uf, municipio, ano);
}

async function onClickLoadData_Municipal_2016(uf, municipio, ano) {
  if (currentOffice === 'vereador') {
    await loadMunicipal2016Vereador(uf, municipio, ano);
    return;
  }

  await loadMunicipal2016Prefeito(uf, municipio, ano);
}

async function onClickLoadData_Municipal_2008(uf, municipio, ano) {
  if (currentOffice === 'vereador') {
    await loadMunicipal2008Vereador(uf, municipio, ano);
    return;
  }

  await loadMunicipal2008Prefeito(uf, municipio, ano);
}

async function onClickLoadData_Municipal() {
  const uf = dom.selectUFMunicipal.value;
  const municipio = dom.selectMunicipio.value;
  const ano = STATE.currentElectionYear;
  const isVereador = (currentOffice === 'vereador');

  if (!uf || !municipio) return;

  setButtonLoading(dom.btnLoadData, true);
  dom.mapLoader.textContent = `Carregando ${municipio}/${uf} (${ano})...`;
  dom.mapLoader.classList.add('visible');

  clearZipCache();
  clearSelection(true);
  currentDataCollection = {};
  currentDataCollection_2022 = {};
  uniqueCidades.clear();
  uniqueBairros.clear();
  STATE.candidates = {}; STATE.metrics = {}; STATE.inaptos = {};
  STATE.dataHas2T = {}; STATE.dataHasInaptos = {};
  clearVereadorData();
  STATE.currentMuniCode = null; // reseta para capturar novo

  try {
    // Passo 1 — carrega GeoJSON de prefeito (geometria base para ambos os cargos)
    const dataOrdPromise = loadGeoJSON(municipio, uf, ano, 'Ordinaria');
    const dataSupPromise = loadGeoJSON(municipio, uf, ano, 'Suplementar');
    const censusPromise = fetchGeoJSON(buildDataPath_Census(uf, ano, municipio));

    const [dataOrd, dataSup, censusData] = await Promise.all([
      dataOrdPromise,
      dataSupPromise.catch(() => null),
      censusPromise.catch(() => null)
    ]);

    if (!dataOrd) throw new Error(`GeoJSON não encontrado para ${municipio} (Ordinaria ${ano}).`);

    // Captura código TSE (necessário para vereador encontrar JSON no ZIP)
    if (dataOrd.features && dataOrd.features.length > 0) {
      const props = dataOrd.features[0].properties;
      STATE.currentMuniCode = String(getProp(props, 'CD_MUNICIPIO') || getProp(props, 'cd_localidade_tse') || '');
      console.log(`[Municipal] Código TSE: ${STATE.currentMuniCode}`);
    }

    if (censusData) mergeCensusData(dataOrd, censusData);
    if (dataSup && censusData) mergeCensusData(dataSup, censusData);

    if (isVereador) {
      // Vereador usa o mesmo GeoJSON do prefeito como mapa base (geometria)
      currentDataCollection['vereador_ord'] = dataOrd;
      uniqueCidades.clear(); uniqueBairros.clear();
      dataOrd.features.forEach(f => {
        const p = f.properties;
        const city = getProp(p, 'nm_localidade'); if (city) uniqueCidades.add(city);
        const bairro = getProp(p, 'ds_bairro'); if (bairro) uniqueBairros.add(bairro);
      });

      // Agora chama o loader de votos de vereador (já temos o código TSE)
      await onClickLoadData_Vereadores(uf, municipio, ano, dataOrd);
      return;
    }

    // === PREFEITO ===
    currentOffice = 'prefeito'; currentSubType = 'ord'; currentCargo = 'prefeito_ord';

    currentDataCollection['prefeito_ord'] = dataOrd;
    processLoadedGeoJSON(dataOrd, 'prefeito_ord');

    if (dataSup) {
      currentDataCollection['prefeito_sup'] = dataSup;
      processLoadedGeoJSON(dataSup, 'prefeito_sup');
    }

    updateElectionTypeUI();
    dom.summaryBoxContainer.classList.add('section-hidden');
    [dom.filterBox, dom.vizBox].forEach(el => el.classList.remove('section-hidden'));
    if (mesorregiaoCombobox) { mesorregiaoCombobox.disable(true); mesorregiaoCombobox.setValue(''); }
    if (microrregiaoCombobox) { microrregiaoCombobox.disable(true); microrregiaoCombobox.setValue(''); }
    if (cidadeCombobox) cidadeCombobox.disable(true);
    if (bairroCombobox) bairroCombobox.disable(false);
    [dom.searchLocal, dom.selectVizColorStyle, dom.selectVizSize].forEach(el => el && (el.disabled = false));
    populateBairroDropdown();
    dom.btnApplyFilters.disabled = false;
    dom.btnApplyFilters.textContent = `Analisar/Agregar "${municipio}"`;
    const hasAnyInaptos = Object.values(STATE.dataHasInaptos).some(v => v);
    dom.btnToggleInaptos.disabled = !hasAnyInaptos;
    STATE.filterInaptos = false;
    dom.btnToggleInaptos.classList.remove('active');
    dom.btnToggleInaptos.textContent = 'Filtrar Inaptos';
    updateConditionalUI();
    applyFiltersAndRedraw();
    try {
      const b = currentLayer?.getBounds();
      if (b?.isValid()) {
        if (typeof applyMapViewportAfterDataLoad === 'function') applyMapViewportAfterDataLoad(b);
        else map.fitBounds(b);
      }
    } catch (e) { }
    showToast(`Dados de ${municipio}/${uf} (${ano}) carregados!`, 'success');

  } catch (e) {
    console.error(`Falha ao carregar ${ano}:`, e);
    showToast(`Erro ao carregar os dados de ${ano}: ${e.message}`, 'error');
  } finally {
    dom.mapLoader.classList.remove('visible');
    setButtonLoading(dom.btnLoadData, false);
  }
}

window.onClickLoadData_General = async function () {
  const year = String(STATE.currentElectionYear);
  const uf = dom.selectUFGeneral?.value;

  if (!uf) {
    throw new Error('Selecione BR ou uma UF antes de carregar os dados.');
  }

  if (year === '2022') {
    return onClickLoadData_Geral_2022();
  }
  if (year === '2018') {
    return onClickLoadData_Geral_2018();
  }
  if (year === '2014') {
    return onClickLoadData_Geral_2014();
  }
  if (year === '2010') {
    return onClickLoadData_Geral_2010();
  }
  if (year === '2006') {
    return onClickLoadData_Geral_2006();
  }

  throw new Error(`Fluxo geral ${year} sem suporte no modo JSON + GPKG.`);
};

window.onClickLoadData_Deputies = async function (uf, year) {
  const targetYear = String(year || STATE.currentElectionYear);
  if (targetYear === '2022') {
    return onClickLoadData_Deputies_2022(uf, targetYear);
  }
  if (targetYear === '2018') {
    return onClickLoadData_Deputies_2018(uf, targetYear);
  }
  if (targetYear === '2014') {
    return onClickLoadData_Deputies_2014(uf, targetYear);
  }
  if (targetYear === '2010') {
    return onClickLoadData_Deputies_2010(uf, targetYear);
  }
  if (targetYear === '2006') {
    return onClickLoadData_Deputies_2006(uf, targetYear);
  }

  throw new Error(`Fluxo de deputados ${targetYear} sem suporte no modo JSON + GPKG.`);
};

window.onClickLoadData_Municipal = async function () {
  const uf = dom.selectUFMunicipal.value;
  const municipio = dom.selectMunicipio.value;
  const ano = STATE.currentElectionYear;

  if (String(ano) !== '2024' && String(ano) !== '2020' && String(ano) !== '2016' && String(ano) !== '2012' && String(ano) !== '2008') {
    throw new Error(`Fluxo municipal ${ano} sem suporte no modo JSON + GPKG.`);
  }

  if (!uf || !municipio) return;

  setButtonLoading(dom.btnLoadData, true);
  dom.mapLoader.textContent = `Carregando ${municipio}/${uf} (${ano})...`;
  dom.mapLoader.classList.add('visible');

  clearZipCache();
  clearSelection(true);
  currentDataCollection = {};
  currentDataCollection_2022 = {};
  uniqueCidades.clear();
  uniqueBairros.clear();
  STATE.candidates = {};
  STATE.metrics = {};
  STATE.inaptos = {};
  STATE.dataHas2T = {};
  STATE.dataHasInaptos = {};
  STATE.municipalOfficialTotals = {};
  clearVereadorData();
  STATE.currentMuniCode = null;

  try {
    if (String(ano) === '2024') {
      await onClickLoadData_Municipal_2024(uf, municipio, ano);
    } else if (String(ano) === '2020') {
      await onClickLoadData_Municipal_2020(uf, municipio, ano);
    } else if (String(ano) === '2016') {
      await onClickLoadData_Municipal_2016(uf, municipio, ano);
    } else if (String(ano) === '2012') {
      await onClickLoadData_Municipal_2012(uf, municipio, ano);
    } else {
      await onClickLoadData_Municipal_2008(uf, municipio, ano);
    }
  } catch (error) {
    console.error(`[Municipal ${ano}] Falha ao carregar ${ano}:`, error);
    showToast(`Erro ao carregar os dados de ${ano}: ${error.message}`, 'error');
  } finally {
    dom.mapLoader.classList.remove('visible');
    setButtonLoading(dom.btnLoadData, false);
  }
};


// ====== VEREADORES ======
// ZIP por estado: resultados_geo/Municipais {ano}/vereadores_{ano}_{UF}.zip
// JSON dentro do ZIP: vereadores_{ano}_{UF}_{NOME_SANITIZADO}_{CODIGO}.json
// Estrutura JSON identica a deputados:
//   { METADATA: { cand_names, coalition_adjustments }, RESULTS: { "zona_local": { candId: votos } } }
// STATE.vereadorResults[zona_local] = { v: { candId: votos } }   (typeKey fixo 'v')

async function onClickLoadData_Vereadores(uf, municipio, ano, baseGeoProvided = null) {
  const muniCode = String(STATE.currentMuniCode || '');
  console.log(`[Vereadores] Carregando ${municipio} (${muniCode}) / ${uf} / ${ano}`);
  dom.mapLoader.textContent = `Carregando Vereadores de ${municipio}/${uf} (${ano})...`;
  dom.mapLoader.classList.add('visible');

  try {
    // 1. Totais oficiais (uma vez por ano)
    if (!STATE.officialTotals) STATE.officialTotals = {};
    const totalsKey = `vereadores_${ano}`;
    if (!STATE.officialTotals[totalsKey]) {
      try {
        const res = await fetch(`resultados_geo/Municipais_Legislativas ${ano}/official_totals_vereadores_${ano}.json`);
        if (res.ok) { STATE.officialTotals[totalsKey] = await res.json(); console.log(`[Vereadores] Totais oficiais ${ano} carregados.`); }
      } catch (e) { console.warn(`[Vereadores] Totais nao encontrados:`, e); }
    }

    // 2. Abre ZIP do estado
    const zipPath = `resultados_geo/Municipais_Legislativas ${ano}/vereadores_${ano}_${uf}.zip`;
    console.log(`[Vereadores] Abrindo ZIP: ${zipPath}`);
    let stateZip;
    try { stateZip = await unzipit.unzip(zipPath); }
    catch (err) { throw new Error(`ZIP de vereadores nao encontrado: ${zipPath}`); }

    const entries = stateZip.entries;

    // 3. Localiza JSON do municipio no ZIP
    let jsonEntry = null, jsonName = null;

    // Por codigo TSE
    if (muniCode) {
      for (const key of Object.keys(entries)) {
        if (key.endsWith('.json') && !key.endsWith('_resumo.json') && key.includes(`_${muniCode}.json`)) {
          jsonEntry = entries[key]; jsonName = key; break;
        }
      }
    }

    // Por nome sanitizado
    if (!jsonEntry) {
      const muniNorm = municipio.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
      for (const key of Object.keys(entries)) {
        if (key.endsWith('.json') && !key.endsWith('_resumo.json')) {
          const keyUp = key.toUpperCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
          if (keyUp.includes(muniNorm)) { jsonEntry = entries[key]; jsonName = key; break; }
        }
      }
    }

    if (!jsonEntry) {
      const avail = Object.keys(entries).filter(k => k.endsWith('.json') && !k.endsWith('_resumo.json')).slice(0, 5);
      throw new Error(`Municipio "${municipio}" nao encontrado no ZIP. Exemplos: ${avail.join(', ')}`);
    }
    console.log(`[Vereadores] JSON: ${jsonName}`);

    const blob = await jsonEntry.blob();
    const text = await blob.text();
    const fullJson = JSON.parse(text);
    if (!fullJson || !fullJson.RESULTS) throw new Error('JSON de vereadores invalido.');

    // 4. Popula STATE.vereador*
    const TYPE_KEY = 'v';
    STATE.vereadorResults = {}; STATE.vereadorMetadata = {}; STATE.vereadorAdjustments = {};

    Object.entries(fullJson.RESULTS).forEach(([locId, votes]) => {
      STATE.vereadorResults[locId] = { [TYPE_KEY]: votes };
    });
    const meta = fullJson.METADATA.cand_names || {};
    Object.assign(STATE.vereadorMetadata, meta);
    if (fullJson.METADATA.coalition_adjustments)
      Object.assign(STATE.vereadorAdjustments, fullJson.METADATA.coalition_adjustments);

    if (!STATE.inaptos) STATE.inaptos = {};
    STATE.inaptos['vereador_ord'] = { '1T': [], '2T': [] };
    STATE.inaptos['vereador_ord']['1T'] = Object.entries(meta)
      .filter(([, cm]) => cm && cm[2] && cm[2].toUpperCase().includes('INAPTO'))
      .map(([cid]) => cid);

    // Sanitiza nome do municipio para usar como chave no official_totals_vereadores
    const muniSanitized = municipio.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
    loadedVereadorState = { uf, muniCode, muniSanitized, year: ano };

    // 5. Mapa base (geometria do prefeito — já carregado por onClickLoadData_Municipal)
    const baseGeo = baseGeoProvided || currentDataCollection['vereador_ord'];
    if (!baseGeo) throw new Error(`Mapa base nao encontrado para ${municipio}. Carregue os dados do prefeito primeiro.`);

    // Garante que o mapa base está registrado
    currentDataCollection['vereador_ord'] = baseGeo;

    // Popula cidades/bairros se ainda nao foi feito
    if (uniqueCidades.size === 0) {
      baseGeo.features.forEach(f => {
        const p = f.properties;
        const city = getProp(p, 'nm_localidade'); if (city) uniqueCidades.add(city);
        const bairro = getProp(p, 'ds_bairro'); if (bairro) uniqueBairros.add(bairro);
      });
    }

    // 6. Configura UI
    currentOffice = 'vereador'; currentSubType = 'ord'; currentCargo = 'vereador_ord';
    STATE.vereadorLookup = null;

    updateElectionTypeUI();
    dom.summaryBoxContainer.classList.add('section-hidden');
    [dom.filterBox, dom.vizBox].forEach(el => el.classList.remove('section-hidden'));
    if (mesorregiaoCombobox) { mesorregiaoCombobox.disable(true); mesorregiaoCombobox.setValue(''); }
    if (microrregiaoCombobox) { microrregiaoCombobox.disable(true); microrregiaoCombobox.setValue(''); }
    if (cidadeCombobox) { cidadeCombobox.disable(true); cidadeCombobox.setValue("Todos os municipios"); currentCidadeFilter = 'all'; }
    if (bairroCombobox) bairroCombobox.disable(false);
    if (dom.selectVizColorStyle) dom.selectVizColorStyle.disabled = false;
    if (dom.selectVizSize) dom.selectVizSize.disabled = false;
    dom.searchLocal.disabled = false;
    populateBairroDropdown();
    dom.btnApplyFilters.disabled = false;
    dom.btnApplyFilters.textContent = `Analisar/Agregar "${municipio}"`;

    const hasInaptos = (STATE.inaptos['vereador_ord']?.['1T']?.length || 0) > 0;
    dom.btnToggleInaptos.disabled = !hasInaptos;
    STATE.filterInaptos = false;
    dom.btnToggleInaptos.classList.remove('active');
    dom.btnToggleInaptos.textContent = 'Filtrar Inaptos';

    applyFiltersAndRedraw();
    try {
      const b = currentLayer?.getBounds();
      if (b?.isValid()) {
        if (typeof applyMapViewportAfterDataLoad === 'function') applyMapViewportAfterDataLoad(b);
        else map.fitBounds(b);
      }
    } catch (e) { }
    showToast(`Vereadores de ${municipio}/${uf} (${ano}) carregados!`, 'success');

  } catch (e) {
    console.error('[Vereadores] ERRO:', e);
    showToast(`Erro ao carregar vereadores: ${e.message}`, 'error');
  } finally {
    dom.mapLoader.classList.remove('visible');
    setButtonLoading(dom.btnLoadData, false);
  }
}

// Helper central para carregar
function createGeoJsonLegacyDisabledError() {
  return new Error('Fluxo GeoJSON legado desativado. Use apenas JSON + GPKG.');
}

async function loadGeoJSON() {
  throw createGeoJsonLegacyDisabledError();
}

async function loadAllStatesAndMerge_General() {
  throw createGeoJsonLegacyDisabledError();
}

// === CONSTRUTORES DE CAMINHO ===

function buildDataPath_General() {
  throw createGeoJsonLegacyDisabledError();
}

function buildDataPath_Municipal() {
  throw createGeoJsonLegacyDisabledError();
}

function buildDataPath_Census() {
  throw createGeoJsonLegacyDisabledError();
}

// let allDataCache = new Map(); // REMOVIDO: Não usamos mais cache global para economizar RAM

// ====== DATA PROCESSING ======

async function loadZipIndex() {
  throw createGeoJsonLegacyDisabledError();
}

// Substitua a função fetchGeoJSON antiga por esta:
async function fetchGeoJSON() {
  throw createGeoJsonLegacyDisabledError();
}

// (Função removida: tryFindInElectionZips)

async function fetchFromZip() {
  throw createGeoJsonLegacyDisabledError();
}

// ====== DATA PROCESSING ======
