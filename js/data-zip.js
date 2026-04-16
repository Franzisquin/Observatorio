function normalizeMunicipioSlug(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function cloneFeatureCollection(geojson) {
  return {
    type: 'FeatureCollection',
    features: (geojson?.features || []).map((feature) => ({
      type: 'Feature',
      geometry: feature?.geometry ? {
        type: feature.geometry.type,
        coordinates: Array.isArray(feature.geometry.coordinates)
          ? [...feature.geometry.coordinates]
          : feature.geometry.coordinates
      } : null,
      properties: { ...(feature?.properties || {}) }
    }))
  };
}

async function getZipReader(zipUrl) {
  let reader = ZIP_READERS.get(zipUrl);
  if (!reader) {
    reader = await unzipit.unzip(zipUrl);
    ZIP_READERS.set(zipUrl, reader);
  }
  return reader;
}

function findZipEntryInReader(reader, filename = null, matcher = null) {
  const entries = reader?.entries || {};

  if (filename) {
    let entry = entries[filename];
    if (!entry) {
      const lowerName = filename.toLowerCase();
      for (const key of Object.keys(entries)) {
        if (key.toLowerCase() === lowerName) {
          entry = entries[key];
          filename = key;
          break;
        }
      }
    }
    if (entry) return { entry, name: filename };
  }

  if (typeof matcher === 'function') {
    for (const key of Object.keys(entries)) {
      if (matcher(key)) {
        return { entry: entries[key], name: key };
      }
    }
  }

  return null;
}

async function fetchBlobFromZipEntry(zipUrl, filename = null, matcher = null) {
  const reader = await getZipReader(zipUrl);
  const found = findZipEntryInReader(reader, filename, matcher);
  if (!found) {
    throw new Error(`Arquivo nao encontrado no zip: ${zipUrl}`);
  }

  return {
    blob: await found.entry.blob(),
    name: found.name
  };
}

async function fetchJsonFromZipEntry(zipUrl, filename = null, matcher = null) {
  const { blob, name } = await fetchBlobFromZipEntry(zipUrl, filename, matcher);
  return {
    data: JSON.parse(await blob.text()),
    name
  };
}

async function ensureSqlJsReady() {
  if (SQL_JS_PROMISE) return SQL_JS_PROMISE;
  if (typeof initSqlJs !== 'function') {
    throw new Error('sql.js nao foi carregado no navegador.');
  }

  SQL_JS_PROMISE = initSqlJs({
    locateFile: (file) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${file}`
  });
  return SQL_JS_PROMISE;
}

async function getMunicipal2020Database() {
  if (GPKG_2020_DB_PROMISE) return GPKG_2020_DB_PROMISE;

  GPKG_2020_DB_PROMISE = (async () => {
    const SQL = await ensureSqlJsReady();
    const { blob } = await fetchBlobFromZipEntry(
      `${DATA_BASE_URL}locais_votacao_2020_gkpg.zip`,
      null,
      (key) => key.toLowerCase().endsWith('.gpkg')
    );
    const buffer = new Uint8Array(await blob.arrayBuffer());
    return new SQL.Database(buffer);
  })();

  return GPKG_2020_DB_PROMISE;
}

async function getMunicipal2016Database() {
  if (GPKG_2016_DB_PROMISE) return GPKG_2016_DB_PROMISE;

  GPKG_2016_DB_PROMISE = (async () => {
    const SQL = await ensureSqlJsReady();
    const { blob } = await fetchBlobFromZipEntry(
      `${DATA_BASE_URL}locais_votacao_2016_gkpg.zip`,
      null,
      (key) => key.toLowerCase().endsWith('.gpkg')
    );
    const buffer = new Uint8Array(await blob.arrayBuffer());
    return new SQL.Database(buffer);
  })();

  return GPKG_2016_DB_PROMISE;
}

async function getMunicipal2012Database() {
  if (GPKG_2012_DB_PROMISE) return GPKG_2012_DB_PROMISE;

  GPKG_2012_DB_PROMISE = (async () => {
    const SQL = await ensureSqlJsReady();
    const { blob } = await fetchBlobFromZipEntry(
      `${DATA_BASE_URL}locais_votacao_2012_gkpg.zip`,
      null,
      (key) => key.toLowerCase().endsWith('.gpkg')
    );
    const buffer = new Uint8Array(await blob.arrayBuffer());
    return new SQL.Database(buffer);
  })();

  return GPKG_2012_DB_PROMISE;
}

async function getMunicipal2008Database() {
  if (GPKG_2008_DB_PROMISE) return GPKG_2008_DB_PROMISE;

  GPKG_2008_DB_PROMISE = (async () => {
    const SQL = await ensureSqlJsReady();
    const { blob } = await fetchBlobFromZipEntry(
      `${DATA_BASE_URL}locais_votacao_2008_gkpg.zip`,
      null,
      (key) => key.toLowerCase().endsWith('.gpkg')
    );
    const buffer = new Uint8Array(await blob.arrayBuffer());
    return new SQL.Database(buffer);
  })();

  return GPKG_2008_DB_PROMISE;
}

async function getMunicipal2024Database() {
  if (GPKG_2024_DB_PROMISE) return GPKG_2024_DB_PROMISE;

  GPKG_2024_DB_PROMISE = (async () => {
    const SQL = await ensureSqlJsReady();
    const { blob } = await fetchBlobFromZipEntry(
      `${DATA_BASE_URL}locais_votacao_2024_gkpg.zip`,
      null,
      (key) => key.toLowerCase().endsWith('.gpkg')
    );
    const buffer = new Uint8Array(await blob.arrayBuffer());
    return new SQL.Database(buffer);
  })();

  return GPKG_2024_DB_PROMISE;
}

function buildMunicipal2016Feature(row, muniCode) {
  const uf = String(row.sg_uf || '').trim().toUpperCase();
  const zona = parseInt(row.nr_zona, 10);
  const local = parseInt(row.nr_locvot, 10);
  const codigoMunicipio = String(muniCode || '').trim();
  const zoneLocalKey = `${zona}_${local}`;
  const fullLocalKey = codigoMunicipio ? `${zona}_${codigoMunicipio}_${local}` : zoneLocalKey;
  const longitude = Number(row.long);
  const latitude = Number(row.lat);

  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [longitude, latitude]
    },
    properties: {
      local_id: zoneLocalKey,
      id_unico: fullLocalKey,
      ID_UNICO: fullLocalKey,
      local_key: fullLocalKey,
      ano: 2016,
      sg_uf: uf,
      cd_localidade_tse: codigoMunicipio,
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

function buildMunicipal2012Feature(row, muniCode) {
  const uf = String(row.sg_uf || '').trim().toUpperCase();
  const zona = parseInt(row.nr_zona, 10);
  const local = parseInt(row.nr_locvot, 10);
  const codigoMunicipio = String(muniCode || '').trim();
  const zoneLocalKey = `${zona}_${local}`;
  const fullLocalKey = codigoMunicipio ? `${zona}_${codigoMunicipio}_${local}` : zoneLocalKey;
  const longitude = Number(row.long);
  const latitude = Number(row.lat);

  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [longitude, latitude]
    },
    properties: {
      local_id: zoneLocalKey,
      id_unico: fullLocalKey,
      ID_UNICO: fullLocalKey,
      local_key: fullLocalKey,
      ano: 2012,
      sg_uf: uf,
      cd_localidade_tse: codigoMunicipio,
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

function buildMunicipal2008Feature(row, muniCode) {
  const uf = String(row.sg_uf || '').trim().toUpperCase();
  const zona = parseInt(row.nr_zona, 10);
  const local = parseInt(row.nr_locvot, 10);
  const codigoMunicipio = String(muniCode || '').trim();
  const zoneLocalKey = `${zona}_${local}`;
  const fullLocalKey = codigoMunicipio ? `${zona}_${codigoMunicipio}_${local}` : zoneLocalKey;
  const longitude = Number(row.long);
  const latitude = Number(row.lat);

  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [longitude, latitude]
    },
    properties: {
      local_id: zoneLocalKey,
      id_unico: fullLocalKey,
      ID_UNICO: fullLocalKey,
      local_key: fullLocalKey,
      ano: 2008,
      sg_uf: uf,
      cd_localidade_tse: codigoMunicipio,
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

function buildMunicipal2020Feature(row, muniCode) {
  const uf = String(row.sg_uf || '').trim().toUpperCase();
  const zona = parseInt(row.nr_zona, 10);
  const local = parseInt(row.nr_locvot, 10);
  const codigoMunicipio = String(muniCode || '').trim();
  const zoneLocalKey = `${zona}_${local}`;
  const fullLocalKey = codigoMunicipio ? `${zona}_${codigoMunicipio}_${local}` : zoneLocalKey;
  const longitude = Number(row.long);
  const latitude = Number(row.lat);

  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [longitude, latitude]
    },
    properties: {
      local_id: zoneLocalKey,
      id_unico: fullLocalKey,
      ID_UNICO: fullLocalKey,
      local_key: fullLocalKey,
      ano: 2020,
      sg_uf: uf,
      cd_localidade_tse: codigoMunicipio,
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

function buildMunicipal2024Feature(row, muniCode) {
  const uf = String(row.sg_uf || '').trim().toUpperCase();
  const zona = parseInt(row.nr_zona, 10);
  const local = parseInt(row.nr_locvot, 10);
  const codigoMunicipio = String(muniCode || '').trim();
  const zoneLocalKey = `${zona}_${local}`;
  const fullLocalKey = codigoMunicipio ? `${zona}_${codigoMunicipio}_${local}` : zoneLocalKey;
  const longitude = Number(row.long);
  const latitude = Number(row.lat);

  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [longitude, latitude]
    },
    properties: {
      local_id: zoneLocalKey,
      id_unico: fullLocalKey,
      ID_UNICO: fullLocalKey,
      local_key: fullLocalKey,
      ano: 2024,
      sg_uf: uf,
      cd_localidade_tse: codigoMunicipio,
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

function isValidBrazilCoordinate(longitude, latitude) {
  if (!isFinite(longitude) || !isFinite(latitude)) return false;
  return longitude >= -76 && longitude <= -28 && latitude >= -35 && latitude <= 6.5;
}

function summarizeRawVoteMap(votesMap, options = {}) {
  const { includeLegenda = true, ignoreCandidateIds = new Set() } = options;
  let totalValidos = 0;
  let brancos = 0;
  let nulos = 0;

  Object.entries(votesMap || {}).forEach(([candidateId, rawVotes]) => {
    const votes = ensureNumber(rawVotes);
    if (candidateId === '95') {
      brancos += votes;
      return;
    }
    if (candidateId === '96') {
      nulos += votes;
      return;
    }
    if (ignoreCandidateIds.has(candidateId)) return;
    if (!includeLegenda && String(candidateId).length <= 2) return;
    totalValidos += votes;
  });

  return {
    totalValidos,
    brancos,
    nulos,
    comparecimento: totalValidos + brancos + nulos
  };
}

function getTurnoutLookupKeys(props) {
  if (!props) return [];

  const keys = [];
  const pushKey = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized || keys.includes(normalized)) return;
    keys.push(normalized);
  };

  pushKey(getProp(props, 'id_unico'));
  pushKey(getProp(props, 'ID_UNICO'));
  pushKey(getProp(props, 'local_key'));
  pushKey(getProp(props, 'local_id'));

  const zona = parseInt(getProp(props, 'nr_zona') || getProp(props, 'NR_ZONA'), 10);
  const local = parseInt(getProp(props, 'nr_locvot') || getProp(props, 'nr_local_votacao') || getProp(props, 'NR_LOCAL_VOTACAO'), 10);
  const municipio = parseInt(getProp(props, 'cd_localidade_tse') || getProp(props, 'CD_MUNICIPIO'), 10);

  if (Number.isFinite(zona) && Number.isFinite(local)) {
    pushKey(`${zona}_${local}`);
  }
  if (Number.isFinite(zona) && Number.isFinite(municipio) && Number.isFinite(local)) {
    pushKey(`${zona}_${municipio}_${local}`);
  }

  return keys;
}

function resetTurnoutReferenceIndexes() {
  TURNOUT_REFERENCE_INDEX_CACHE.clear();
}

function getTurnoutReferenceIndex(referenceCargo) {
  const collection = currentDataCollection?.[referenceCargo];
  if (!collection?.features?.length) return null;

  const cacheKey = `${STATE.currentElectionYear}_${referenceCargo}_${collection.features.length}`;
  const cached = TURNOUT_REFERENCE_INDEX_CACHE.get(referenceCargo);
  if (cached?.cacheKey === cacheKey) {
    return cached.index;
  }

  const index = new Map();
  collection.features.forEach((feature) => {
    const props = feature?.properties || {};
    getTurnoutLookupKeys(props).forEach((key) => {
      if (!index.has(key)) index.set(key, props);
    });
  });

  TURNOUT_REFERENCE_INDEX_CACHE.set(referenceCargo, { cacheKey, index });
  return index;
}

function isDoubleVoteSenadorTurn(cargo, turnoKey) {
  const year = String(STATE.currentElectionYear || '');
  return String(cargo || '').startsWith('senador')
    && turnoKey === '1T'
    && (year === '2010' || year === '2018');
}

function getTurnoutReferenceCargo(cargo) {
  if (!cargo) return null;
  if (String(cargo).startsWith('senador')) return 'presidente_ord';
  return null;
}

function getReferencePropsForTurnout(props, cargo) {
  const referenceCargo = getTurnoutReferenceCargo(cargo);
  if (!referenceCargo || referenceCargo === cargo) return props || null;

  const index = getTurnoutReferenceIndex(referenceCargo);
  if (!index) return props || null;

  for (const key of getTurnoutLookupKeys(props)) {
    const found = index.get(key);
    if (found) return found;
  }

  return props || null;
}

function getDeputyVotesMapForCargo(props, cargo) {
  if (!props || !cargo || !String(cargo).startsWith('deputado')) return null;

  const z = getProp(props, 'nr_zona');
  const l = getProp(props, 'nr_locvot') || getProp(props, 'nr_local_votacao');
  const m = getProp(props, 'cd_localidade_tse') || getProp(props, 'CD_MUNICIPIO');
  if (!z || !l || !m) return null;

  const resultKey = `${parseInt(z, 10)}_${parseInt(m, 10)}_${parseInt(l, 10)}`;
  const allRes = STATE.deputyResults?.[resultKey];
  if (!allRes) return null;

  return allRes[String(cargo).includes('estadual') ? 'e' : 'f'] || null;
}

function getFeatureComparecimentoCount(props, cargo, turnoKey, options = {}) {
  if (!props) return 0;

  const explicitComparecimento = ensureNumber(getProp(props, `Comparecimento ${turnoKey}`))
    || ensureNumber(getProp(props, 'Comparecimento'));
  if (explicitComparecimento > 0) return explicitComparecimento;

  if (String(cargo || '').startsWith('deputado')) {
    const votesMap = getDeputyVotesMapForCargo(props, cargo);
    if (votesMap) {
      return Object.values(votesMap).reduce((sum, rawVotes) => sum + ensureNumber(rawVotes), 0);
    }
  }

  if (!options.skipReferenceFallback && isDoubleVoteSenadorTurn(cargo, turnoKey)) {
    const referenceProps = getReferencePropsForTurnout(props, cargo);
    if (referenceProps && referenceProps !== props) {
      return getFeatureComparecimentoCount(referenceProps, getTurnoutReferenceCargo(cargo), turnoKey, {
        skipReferenceFallback: true
      });
    }
    return 0;
  }

  const totalValidos = ensureNumber(getProp(props, `Total_Votos_Validos ${turnoKey}`));
  const votosBrancos = ensureNumber(getProp(props, `Votos_Brancos ${turnoKey}`));
  const votosNulos = ensureNumber(getProp(props, `Votos_Nulos ${turnoKey}`));
  const derivedComparecimento = totalValidos + votosBrancos + votosNulos;
  return derivedComparecimento > 0 ? derivedComparecimento : 0;
}

function getFeatureAptosCount(props, comparecimento = 0, turnoKey = '1T') {
  if (!props) return 0;

  const candidates = [];
  const pushCandidate = (rawValue) => {
    const value = ensureNumber(rawValue);
    if (!Number.isFinite(value) || value <= 0) return;
    if (!candidates.includes(value)) candidates.push(value);
  };

  pushCandidate(getProp(props, `Eleitores_Aptos ${turnoKey}`));
  pushCandidate(getProp(props, `Eleitores_Aptos_Municipal ${turnoKey}`));
  pushCandidate(getProp(props, 'Eleitores_Aptos'));
  pushCandidate(getProp(props, 'Eleitores_Aptos_Municipal'));
  pushCandidate(getProp(props, 'TOTAL_ELEITORES_PERFIL'));

  const homens = ensureNumber(
    getProp(props, 'MASCULINO')
    || getProp(props, 'HOMENS')
    || getProp(props, 'Homens')
  );
  const mulheres = ensureNumber(
    getProp(props, 'FEMININO')
    || getProp(props, 'MULHERES')
    || getProp(props, 'Mulheres')
  );
  if (homens > 0 || mulheres > 0) {
    pushCandidate(homens + mulheres);
  }

  if (!candidates.length) return 0;

  if (comparecimento > 0) {
    const adequateCandidates = candidates
      .filter((value) => value >= comparecimento)
      .sort((a, b) => a - b);
    if (adequateCandidates.length) return adequateCandidates[0];
    return Math.max(...candidates);
  }

  return candidates[0];
}

function getFeatureTurnoutStats(props, cargo = currentCargo, turnoKey = '1T') {
  if (!props) {
    return {
      comparecimento: 0,
      aptos: 0,
      ratio: null,
      pct: null
    };
  }

  let cargoCache = FEATURE_TURNOUT_CACHE.get(props);
  if (!cargoCache) {
    cargoCache = new Map();
    FEATURE_TURNOUT_CACHE.set(props, cargoCache);
  }

  const cacheKey = `${cargo || ''}|${turnoKey || '1T'}`;
  const cached = cargoCache.get(cacheKey);
  if (cached) return cached;

  const comparecimento = getFeatureComparecimentoCount(props, cargo, turnoKey);
  const aptos = getFeatureAptosCount(props, comparecimento, turnoKey);
  const ratio = aptos > 0 ? Math.max(0, Math.min(1, comparecimento / aptos)) : null;

  const result = {
    comparecimento,
    aptos,
    ratio,
    pct: ratio === null ? null : ratio * 100
  };
  cargoCache.set(cacheKey, result);
  return result;
}

function getFallbackPropsForCurrentSelection(cargo) {
  const collection = currentDataCollection?.[cargo];
  const features = collection?.features || [];
  if (!features.length) return null;

  if (selectedLocationIDs?.size) {
    for (const feature of features) {
      const props = feature?.properties || {};
      const locationId = String(getProp(props, 'local_id') || getProp(props, 'nr_locvot') || '');
      if (locationId && selectedLocationIDs.has(locationId)) {
        return props;
      }
    }
  }

  return features[0]?.properties || null;
}

function getTurnoutStatsForSelection(props, cargo, turnoKey, officialComparecimento = null) {
  let featurePropsList = [];

  if (STATE.isFilterAggregationActive && CURRENT_VISIBLE_PROPS_CACHE.length) {
    featurePropsList = CURRENT_VISIBLE_PROPS_CACHE;
  }

  if (!featurePropsList.length) {
    const fallbackProps = props || getFallbackPropsForCurrentSelection(cargo);
    if (fallbackProps) {
      featurePropsList = [fallbackProps];
    }
  }

  let comparecimento = 0;
  let aptos = 0;
  featurePropsList.forEach((itemProps) => {
    const stats = getFeatureTurnoutStats(itemProps, cargo, turnoKey);
    comparecimento += stats.comparecimento;
    aptos += stats.aptos;
  });

  const official = ensureNumber(officialComparecimento);
  if (official > 0 && aptos > 0 && official <= aptos * 1.02) {
    comparecimento = official;
  }

  const ratio = aptos > 0 ? Math.max(0, Math.min(1, comparecimento / aptos)) : null;
  return {
    comparecimento,
    aptos,
    ratio,
    pct: ratio === null ? null : ratio * 100
  };
}

window.getFeatureTurnoutStats = getFeatureTurnoutStats;
window.getCurrentVisibleFeatures = function () {
  return CURRENT_VISIBLE_FEATURES_CACHE;
};

function aggregateVotesFromResults(resultsByLocation) {
  const totals = {};
  Object.values(resultsByLocation || {}).forEach((voteMap) => {
    Object.entries(voteMap || {}).forEach(([candidateId, rawVotes]) => {
      totals[candidateId] = (totals[candidateId] || 0) + ensureNumber(rawVotes);
    });
  });
  return totals;
}

function shouldUseMunicipalOfficialTotals() {
  const censusFilters = STATE.censusFilters || {};
  const hasActiveCensusFilters = [
    censusFilters.rendaMin,
    censusFilters.rendaMax,
    censusFilters.racaVal,
    censusFilters.idadeVal,
    censusFilters.generoVal,
    censusFilters.escolaridadeVal,
    censusFilters.estadoCivilVal,
    censusFilters.saneamentoVal
  ].some((value) => value !== null && value !== undefined && Number(value) > 0);
  const year = String(STATE.currentElectionYear);
  return (year === '2024' || year === '2020' || year === '2016' || year === '2012' || year === '2008')
    && STATE.currentElectionType === 'municipal'
    && STATE.isFilterAggregationActive
    && !hasActiveCensusFilters
    && currentBairroFilter === 'all'
    && !currentLocalFilter;
}
