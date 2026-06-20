// =====================================================================
// MUNICIPAIS 2000 / 2004 (Prefeito + Vereador)
// Base de geolocalizacao: locais de votacao de 2006 (GPKG nacional).
// Como as zonas de 2000/2004 diferem das de 2006, parte das secoes nao
// geolocaliza; por isso o RESULTADO GERAL usa os totais COMPLETOS
// embutidos em METADATA.official_summary (todas as secoes do TSE) e os
// totais oficiais de vereador de official_totals_vereadores_{ano}.json.
// Espelha o fluxo de 2008, exceto pelo resumo oficial completo.
// =====================================================================

async function loadMunicipalBaseFromGpkg2006(uf, municipio, muniCode, resultKeys, mode) {
  const ufNorm = String(uf || '').toUpperCase();
  const cacheKey = `${ufNorm}|${normalizeMunicipioSlug(municipio)}|${String(muniCode || '')}`;
  let cachedBase = MUNICIPAL_2006_BASE_CACHE.get(cacheKey);

  if (!cachedBase) {
    const db = await getGeneral2006Database();
    const stmt = db.prepare(`
      SELECT sg_uf, cod_localidade_ibge, nr_zona, nr_locvot, nm_localidade, nm_locvot,
             ds_endereco, ds_bairro, long, lat, tipo_match
      FROM locais_votacao_2006_padronizado
      WHERE sg_uf = ?
    `);

    const municipioAliases = getMunicipioAliasSlugs(municipio);
    const rows = [];
    stmt.bind([ufNorm]);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      if (!municipioAliases.includes(normalizeMunicipioSlug(row.nm_localidade))) continue;
      if (!isValidBrazilCoordinate(Number(row.long), Number(row.lat))) continue;
      rows.push(row);
    }
    stmt.free();

    rows.sort((a, b) => {
      const zonaDiff = parseInt(a.nr_zona, 10) - parseInt(b.nr_zona, 10);
      return zonaDiff || (parseInt(a.nr_locvot, 10) - parseInt(b.nr_locvot, 10));
    });

    cachedBase = {
      type: 'FeatureCollection',
      features: rows.map(row => buildMunicipal2008Feature(row, muniCode))
    };
    MUNICIPAL_2006_BASE_CACHE.set(cacheKey, cachedBase);
  }

  // NAO lanca erro quando vazio: municipios cujas zonas mudaram desde 2006
  // (ex.: emancipados) ficam sem mapa, mas o resultado geral continua exibido.
  return filterMunicipalFeatures2008(cachedBase, resultKeys, mode);
}

function buildEarlyPrefeitoOfficialSummary(fullJson, turnoKey) {
  const summary = fullJson?.METADATA?.official_summary?.[turnoKey];
  if (summary && summary.rawTotals) return summary;
  return buildPrefeitoOfficialSummary(fullJson, turnoKey);
}

async function loadPrefeitoJsonEarly(uf, municipio, ano, subtype, turno) {
  const ufNorm = String(uf || '').toUpperCase();
  const municipioAliases = getMunicipioAliasSlugs(municipio);
  const zipUrl = `${DATA_BASE_URL}Municipais ${ano}/prefeito_${ano}_${subtype}_t${turno}_${ufNorm}.zip`;

  const { data, name } = await fetchJsonFromZipEntry(
    zipUrl,
    null,
    (entryName) => entryName.toLowerCase().endsWith('.json')
      && !entryName.toLowerCase().endsWith('_resumo.json')
      && municipioAliases.includes(extractMunicipioSlugFromPrefeitoFile2008(entryName))
  );

  return {
    json: data,
    name,
    muniCode: String(data?.METADATA?.cd_municipio || extractMunicipioCodeFromPrefeitoFile2008(name) || '').trim()
  };
}

async function loadVereadorJsonEarly(uf, municipio, ano) {
  const ufNorm = String(uf || '').toUpperCase();
  const municipioAliases = getMunicipioAliasSlugs(municipio);
  const zipUrl = `${DATA_BASE_URL}Municipais_Legislativas ${ano}/vereadores_${ano}_${ufNorm}.zip`;

  const { data, name } = await fetchJsonFromZipEntry(
    zipUrl,
    null,
    (entryName) => entryName.toLowerCase().endsWith('.json')
      && !entryName.toLowerCase().endsWith('_resumo.json')
      && municipioAliases.includes(extractMunicipioSlugFromVereadorFile(entryName))
  );

  return {
    json: data,
    name,
    muniCode: extractMunicipioCodeFromVereadorFile(name)
  };
}

async function loadMunicipalEarlyPrefeito(uf, municipio, ano) {
  STATE.municipalOfficialTotals['prefeito_ord'] = {};
  delete STATE.municipalOfficialTotals['prefeito_sup'];

  const ord1 = await loadPrefeitoJsonEarly(uf, municipio, ano, 'ord', 1);
  if (!ord1?.json?.RESULTS) {
    throw new Error(`JSON de prefeito nao encontrado para ${municipio}/${uf} (${ano}).`);
  }

  const muniCode = String(ord1.muniCode || '').trim();
  STATE.currentMuniCode = muniCode;

  const ord2 = await loadPrefeitoJsonEarly(uf, municipio, ano, 'ord', 2).catch(() => null);

  const ordKeys = new Set(Object.keys(ord1.json.RESULTS || {}));
  if (ord2?.json?.RESULTS) {
    Object.keys(ord2.json.RESULTS).forEach(key => ordKeys.add(key));
  }

  const ordGeo = await loadMunicipalBaseFromGpkg2006(uf, municipio, muniCode, ordKeys, 'prefeito');
  applyPrefeitoJsonToGeojson2024(ordGeo, ord1.json, '1T');
  STATE.municipalOfficialTotals['prefeito_ord']['1T'] = buildEarlyPrefeitoOfficialSummary(ord1.json, '1T');
  if (ord2?.json?.RESULTS) {
    applyPrefeitoJsonToGeojson2024(ordGeo, ord2.json, '2T');
    STATE.municipalOfficialTotals['prefeito_ord']['2T'] = buildEarlyPrefeitoOfficialSummary(ord2.json, '2T');
  }

  currentOffice = 'prefeito';
  currentSubType = 'ord';
  currentCargo = 'prefeito_ord';
  currentDataCollection['prefeito_ord'] = ordGeo;
  processLoadedGeoJSON(ordGeo, 'prefeito_ord');

  // 2o turno pode existir so nos totais oficiais (sem dados por local, ex.: Maceio 2000)
  const off2T = STATE.municipalOfficialTotals['prefeito_ord']?.['2T']?.votesByDisplayKey;
  if (off2T && Object.keys(off2T).length) STATE.dataHas2T['prefeito_ord'] = true;

  finalizeMunicipalLoadUI(municipio, false);
  if (!ordGeo.features.length) {
    if (typeof renderMunicipalOfficialOnlySidebar === 'function') renderMunicipalOfficialOnlySidebar('prefeito_ord');
    showToast(`${municipio}/${uf} (${ano}): resultado geral exibido; mapa indisponivel (zonas alteradas desde 2006).`, 'info');
  } else {
    showToast(`Dados de ${municipio}/${uf} (${ano}) carregados!`, 'success');
  }
}

async function loadMunicipalEarlyVereador(uf, municipio, ano) {
  await ensureOfficialTotalsVereadores(ano);
  STATE.municipalOfficialTotals['vereador_ord'] = {};

  const vereadorPayload = await loadVereadorJsonEarly(uf, municipio, ano);
  if (!vereadorPayload?.json?.RESULTS) {
    throw new Error(`JSON de vereadores nao encontrado para ${municipio}/${uf} (${ano}).`);
  }

  const muniCode = String(vereadorPayload.muniCode || '').trim();
  STATE.currentMuniCode = muniCode;

  const resultKeys = new Set(Object.keys(vereadorPayload.json.RESULTS || {}));
  const baseGeo = await loadMunicipalBaseFromGpkg2006(uf, municipio, muniCode, resultKeys, 'vereador');
  applyVereadorMetricsToGeojson2024(baseGeo, vereadorPayload.json);
  STATE.municipalOfficialTotals['vereador_ord']['1T'] = await getVereadorOfficialSummaryForMunicipality(uf, municipio, ano, muniCode, vereadorPayload.json);

  const TYPE_KEY = 'v';
  STATE.vereadorResults = {};
  STATE.vereadorMetadata = {};
  STATE.vereadorAdjustments = {};

  Object.entries(vereadorPayload.json.RESULTS).forEach(([locId, votes]) => {
    STATE.vereadorResults[locId] = { [TYPE_KEY]: votes };
  });
  Object.assign(STATE.vereadorMetadata, vereadorPayload.json.METADATA?.cand_names || {});
  if (vereadorPayload.json.METADATA?.coalition_adjustments) {
    Object.assign(STATE.vereadorAdjustments, vereadorPayload.json.METADATA.coalition_adjustments);
  }

  if (!STATE.inaptos) STATE.inaptos = {};
  STATE.inaptos['vereador_ord'] = { '1T': [], '2T': [] };
  STATE.inaptos['vereador_ord']['1T'] = Object.entries(STATE.vereadorMetadata)
    .filter(([, metadata]) => metadata && metadata[2] && metadata[2].toUpperCase().includes('INAPTO'))
    .map(([candidateId]) => candidateId);

  const muniSanitized = normalizeMunicipioSlug(municipio);
  loadedVereadorState = { uf, muniCode, muniSanitized, year: ano };

  currentOffice = 'vereador';
  currentSubType = 'ord';
  currentCargo = 'vereador_ord';
  currentDataCollection['vereador_ord'] = baseGeo;
  STATE.vereadorLookup = null;

  finalizeMunicipalLoadUI(municipio, true);
  if (!baseGeo.features.length && typeof renderMunicipalOfficialOnlySidebar === 'function') {
    renderMunicipalOfficialOnlySidebar('vereador_ord');
  }
  showToast(`Vereadores de ${municipio}/${uf} (${ano}) carregados!`, 'success');
}

async function loadMunicipal2000Prefeito(uf, municipio, ano) { return loadMunicipalEarlyPrefeito(uf, municipio, ano); }
async function loadMunicipal2000Vereador(uf, municipio, ano) { return loadMunicipalEarlyVereador(uf, municipio, ano); }
async function loadMunicipal2004Prefeito(uf, municipio, ano) { return loadMunicipalEarlyPrefeito(uf, municipio, ano); }
async function loadMunicipal2004Vereador(uf, municipio, ano) { return loadMunicipalEarlyVereador(uf, municipio, ano); }
