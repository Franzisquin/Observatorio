async function loadCensoJson2012(uf) {
  const ufNorm = String(uf || '').toUpperCase();
  if (!ufNorm) return null;
  if (CENSO_2012_CACHE.has(ufNorm)) return CENSO_2012_CACHE.get(ufNorm);

  const promise = (async () => {
    const zipUrl = `${DATA_BASE_URL}Censo 2012/censo_2012_${ufNorm}.zip`;
    const filename = `censo_2012_${ufNorm}.json`;
    const { data } = await fetchJsonFromZipEntry(zipUrl, filename);
    return data;
  })();

  CENSO_2012_CACHE.set(ufNorm, promise);
  return promise;
}

async function loadCensoJson2008(uf) {
  const ufNorm = String(uf || '').toUpperCase();
  if (!ufNorm) return null;
  if (CENSO_2008_CACHE.has(ufNorm)) return CENSO_2008_CACHE.get(ufNorm);

  const promise = (async () => {
    const zipUrl = `${DATA_BASE_URL}Censo 2008/censo_2008_${ufNorm}.zip`;
    const filename = `censo_2008_${ufNorm}.json`;
    const { data } = await fetchJsonFromZipEntry(zipUrl, filename);
    return data;
  })();

  CENSO_2008_CACHE.set(ufNorm, promise);
  return promise;
}

async function loadCensoJson2016(uf) {
  const ufNorm = String(uf || '').toUpperCase();
  if (!ufNorm) return null;
  if (CENSO_2016_CACHE.has(ufNorm)) return CENSO_2016_CACHE.get(ufNorm);

  const promise = (async () => {
    const zipUrl = `${DATA_BASE_URL}Censo 2016/censo_2016_${ufNorm}.zip`;
    const filename = `censo_2016_${ufNorm}.json`;
    const { data } = await fetchJsonFromZipEntry(zipUrl, filename);
    return data;
  })();

  CENSO_2016_CACHE.set(ufNorm, promise);
  return promise;
}

async function loadCensoJson2020(uf) {
  const ufNorm = String(uf || '').toUpperCase();
  if (!ufNorm) return null;
  if (CENSO_2020_CACHE.has(ufNorm)) return CENSO_2020_CACHE.get(ufNorm);

  const promise = (async () => {
    const zipUrl = `${DATA_BASE_URL}Censo 2020/censo_2020_${ufNorm}.zip`;
    const filename = `censo_2020_${ufNorm}.json`;
    const { data } = await fetchJsonFromZipEntry(zipUrl, filename);
    return data;
  })();

  CENSO_2020_CACHE.set(ufNorm, promise);
  return promise;
}

async function loadCensoJson2024(uf) {
  const ufNorm = String(uf || '').toUpperCase();
  if (!ufNorm) return null;
  if (CENSO_2024_CACHE.has(ufNorm)) return CENSO_2024_CACHE.get(ufNorm);

  const promise = (async () => {
    const zipUrl = `${DATA_BASE_URL}Censo 2024/censo_2024_${ufNorm}.zip`;
    const filename = `censo_2024_${ufNorm}.json`;
    const { data } = await fetchJsonFromZipEntry(zipUrl, filename);
    return data;
  })();

  CENSO_2024_CACHE.set(ufNorm, promise);
  return promise;
}

function mergeCensoJson2024(baseGeo, censusJson, muniCode, municipio) {
  if (!baseGeo?.features?.length || !censusJson?.RESULTS) return;

  const censusIndex = new Map();
  const targetMuniCode = String(muniCode || '').trim();
  const targetMunicipio = normalizeMunicipioSlug(municipio);

  Object.entries(censusJson.RESULTS).forEach(([fallbackKey, row]) => {
    if (!row) return;

    const rowMuniCode = String(row.cd_localidade_tse || '').trim();
    if (targetMuniCode) {
      if (rowMuniCode && rowMuniCode !== targetMuniCode) return;
    } else if (targetMunicipio && normalizeMunicipioSlug(row.nm_localidade) !== targetMunicipio) {
      return;
    }

    const zona = parseInt(row.nr_zona, 10);
    const local = parseInt(row.nr_locvot, 10);
    if (!Number.isFinite(zona) || !Number.isFinite(local)) return;

    const zoneLocalKey = `${zona}_${local}`;
    const localKey = String(row.local_key || fallbackKey || '');
    const enriched = {
      ...row,
      local_id: zoneLocalKey,
      id_unico: localKey,
      ID_UNICO: localKey
    };

    if (localKey) censusIndex.set(localKey, enriched);
    censusIndex.set(zoneLocalKey, enriched);
  });

  let mergedCount = 0;
  baseGeo.features.forEach(feature => {
    const props = feature.properties || {};
    const zoneLocalKey = String(props.local_id || `${parseInt(props.nr_zona, 10)}_${parseInt(props.nr_locvot, 10)}`);
    const fullKey = String(props.id_unico || props.local_key || '');
    const censusProps = censusIndex.get(fullKey) || censusIndex.get(zoneLocalKey);
    if (!censusProps) return;

    Object.entries(censusProps).forEach(([key, value]) => {
      if (value !== undefined) props[key] = value;
    });
    mergedCount++;
  });

  console.log(`[2024] Censo mesclado em ${mergedCount} locais.`);
}

function mergeCensoJson2020(baseGeo, censusJson, muniCode, municipio) {
  if (!baseGeo?.features?.length || !censusJson?.RESULTS) return;

  const censusIndex = new Map();
  const targetMuniCode = String(muniCode || '').trim();
  const targetMunicipio = normalizeMunicipioSlug(municipio);

  Object.entries(censusJson.RESULTS).forEach(([fallbackKey, row]) => {
    if (!row) return;

    const rowMuniCode = String(row.cd_localidade_tse || '').trim();
    if (targetMuniCode) {
      if (rowMuniCode && rowMuniCode !== targetMuniCode) return;
    } else if (targetMunicipio && normalizeMunicipioSlug(row.nm_localidade) !== targetMunicipio) {
      return;
    }

    const zona = parseInt(row.nr_zona, 10);
    const local = parseInt(row.nr_locvot, 10);
    if (!Number.isFinite(zona) || !Number.isFinite(local)) return;

    const zoneLocalKey = `${zona}_${local}`;
    const localKey = String(row.local_key || fallbackKey || '');
    const enriched = {
      ...row,
      local_id: zoneLocalKey,
      id_unico: localKey,
      ID_UNICO: localKey
    };

    if (localKey) censusIndex.set(localKey, enriched);
    censusIndex.set(zoneLocalKey, enriched);
  });

  let mergedCount = 0;
  baseGeo.features.forEach(feature => {
    const props = feature.properties || {};
    const zoneLocalKey = String(props.local_id || `${parseInt(props.nr_zona, 10)}_${parseInt(props.nr_locvot, 10)}`);
    const fullKey = String(props.id_unico || props.local_key || '');
    const censusProps = censusIndex.get(fullKey) || censusIndex.get(zoneLocalKey);
    if (!censusProps) return;

    Object.entries(censusProps).forEach(([key, value]) => {
      if (value !== undefined) props[key] = value;
    });
    mergedCount++;
  });

  console.log(`[2020] Censo mesclado em ${mergedCount} locais.`);
}

function mergeCensoJson2016(baseGeo, censusJson, muniCode, municipio) {
  if (!baseGeo?.features?.length || !censusJson?.RESULTS) return;

  const censusIndex = new Map();
  const targetMuniCode = String(muniCode || '').trim();
  const targetMunicipio = normalizeMunicipioSlug(municipio);

  Object.entries(censusJson.RESULTS).forEach(([fallbackKey, row]) => {
    if (!row) return;

    const rowMuniCode = String(row.cd_localidade_tse || '').trim();
    if (targetMuniCode) {
      if (rowMuniCode && rowMuniCode !== targetMuniCode) return;
    } else if (targetMunicipio && normalizeMunicipioSlug(row.nm_localidade) !== targetMunicipio) {
      return;
    }

    const zona = parseInt(row.nr_zona, 10);
    const local = parseInt(row.nr_locvot, 10);
    if (!Number.isFinite(zona) || !Number.isFinite(local)) return;

    const zoneLocalKey = `${zona}_${local}`;
    const localKey = String(row.local_key || fallbackKey || '');
    const enriched = {
      ...row,
      local_id: zoneLocalKey,
      id_unico: localKey,
      ID_UNICO: localKey
    };

    if (localKey) censusIndex.set(localKey, enriched);
    censusIndex.set(zoneLocalKey, enriched);
  });

  let mergedCount = 0;
  baseGeo.features.forEach(feature => {
    const props = feature.properties || {};
    const zoneLocalKey = String(props.local_id || `${parseInt(props.nr_zona, 10)}_${parseInt(props.nr_locvot, 10)}`);
    const fullKey = String(props.id_unico || props.local_key || '');
    const censusProps = censusIndex.get(fullKey) || censusIndex.get(zoneLocalKey);
    if (!censusProps) return;

    Object.entries(censusProps).forEach(([key, value]) => {
      if (value !== undefined) props[key] = value;
    });
    mergedCount++;
  });

  console.log(`[2016] Censo mesclado em ${mergedCount} locais.`);
}

function mergeCensoJson2012(baseGeo, censusJson, muniCode, municipio) {
  if (!baseGeo?.features?.length || !censusJson?.RESULTS) return;

  const censusIndex = new Map();
  const targetMuniCode = String(muniCode || '').trim();
  const targetMunicipio = normalizeMunicipioSlug(municipio);

  Object.entries(censusJson.RESULTS).forEach(([fallbackKey, row]) => {
    if (!row) return;

    const rowMuniCode = String(row.cd_localidade_tse || '').trim();
    if (targetMuniCode) {
      if (rowMuniCode && rowMuniCode !== targetMuniCode) return;
    } else if (targetMunicipio && normalizeMunicipioSlug(row.nm_localidade) !== targetMunicipio) {
      return;
    }

    const zona = parseInt(row.nr_zona, 10);
    const local = parseInt(row.nr_locvot, 10);
    if (!Number.isFinite(zona) || !Number.isFinite(local)) return;

    const zoneLocalKey = `${zona}_${local}`;
    const localKey = String(row.local_key || fallbackKey || '');
    const enriched = {
      ...row,
      local_id: zoneLocalKey,
      id_unico: localKey,
      ID_UNICO: localKey
    };

    if (localKey) censusIndex.set(localKey, enriched);
    censusIndex.set(zoneLocalKey, enriched);
  });

  let mergedCount = 0;
  baseGeo.features.forEach(feature => {
    const props = feature.properties || {};
    const zoneLocalKey = String(props.local_id || `${parseInt(props.nr_zona, 10)}_${parseInt(props.nr_locvot, 10)}`);
    const fullKey = String(props.id_unico || props.local_key || '');
    const censusProps = censusIndex.get(fullKey) || censusIndex.get(zoneLocalKey);
    if (!censusProps) return;

    Object.entries(censusProps).forEach(([key, value]) => {
      if (value !== undefined) props[key] = value;
    });
    mergedCount++;
  });

  console.log(`[2012] Censo mesclado em ${mergedCount} locais.`);
}

function mergeCensoJson2008(baseGeo, censusJson, muniCode, municipio) {
  if (!baseGeo?.features?.length || !censusJson?.RESULTS) return;

  const censusIndex = new Map();
  const targetMuniCode = String(muniCode || '').trim();
  const targetMunicipio = normalizeMunicipioSlug(municipio);

  Object.entries(censusJson.RESULTS).forEach(([fallbackKey, row]) => {
    if (!row) return;

    const rowMuniCode = String(row.cd_localidade_tse || '').trim();
    if (targetMuniCode) {
      if (rowMuniCode && rowMuniCode !== targetMuniCode) return;
    } else if (targetMunicipio && normalizeMunicipioSlug(row.nm_localidade) !== targetMunicipio) {
      return;
    }

    const zona = parseInt(row.nr_zona, 10);
    const local = parseInt(row.nr_locvot, 10);
    if (!Number.isFinite(zona) || !Number.isFinite(local)) return;

    const zoneLocalKey = `${zona}_${local}`;
    const localKey = String(row.local_key || fallbackKey || '');
    const enriched = {
      ...row,
      local_id: zoneLocalKey,
      id_unico: localKey,
      ID_UNICO: localKey
    };

    if (localKey) censusIndex.set(localKey, enriched);
    censusIndex.set(zoneLocalKey, enriched);
  });

  let mergedCount = 0;
  baseGeo.features.forEach(feature => {
    const props = feature.properties || {};
    const zoneLocalKey = String(props.local_id || `${parseInt(props.nr_zona, 10)}_${parseInt(props.nr_locvot, 10)}`);
    const fullKey = String(props.id_unico || props.local_key || '');
    const censusProps = censusIndex.get(fullKey) || censusIndex.get(zoneLocalKey);
    if (!censusProps) return;

    Object.entries(censusProps).forEach(([key, value]) => {
      if (value !== undefined) props[key] = value;
    });
    mergedCount++;
  });

  console.log(`[2008] Censo mesclado em ${mergedCount} locais.`);
}

function filterMunicipalFeatures2024(baseGeo, resultKeys, mode) {
  const filteredFeatures = (baseGeo?.features || []).filter(feature => {
    const props = feature.properties || {};
    const key = mode === 'prefeito'
      ? String(props.id_unico || props.local_key || '')
      : String(props.local_id || `${parseInt(props.nr_zona, 10)}_${parseInt(props.nr_locvot, 10)}`);
    return resultKeys.has(key);
  });

  return {
    type: 'FeatureCollection',
    features: filteredFeatures.map(feature => ({
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

function filterMunicipalFeatures2016(baseGeo, resultKeys, mode) {
  const filteredFeatures = (baseGeo?.features || []).filter(feature => {
    const props = feature.properties || {};
    const key = mode === 'prefeito'
      ? String(props.id_unico || props.local_key || '')
      : String(props.local_id || `${parseInt(props.nr_zona, 10)}_${parseInt(props.nr_locvot, 10)}`);
    return resultKeys.has(key);
  });

  return {
    type: 'FeatureCollection',
    features: filteredFeatures.map(feature => ({
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

function filterMunicipalFeatures2012(baseGeo, resultKeys, mode) {
  const filteredFeatures = (baseGeo?.features || []).filter(feature => {
    const props = feature.properties || {};
    const key = mode === 'prefeito'
      ? String(props.id_unico || props.local_key || '')
      : String(props.local_id || `${parseInt(props.nr_zona, 10)}_${parseInt(props.nr_locvot, 10)}`);
    return resultKeys.has(key);
  });

  return {
    type: 'FeatureCollection',
    features: filteredFeatures.map(feature => ({
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

function filterMunicipalFeatures2008(baseGeo, resultKeys, mode) {
  const filteredFeatures = (baseGeo?.features || []).filter(feature => {
    const props = feature.properties || {};
    const key = mode === 'prefeito'
      ? String(props.id_unico || props.local_key || '')
      : String(props.local_id || `${parseInt(props.nr_zona, 10)}_${parseInt(props.nr_locvot, 10)}`);
    return resultKeys.has(key);
  });

  return {
    type: 'FeatureCollection',
    features: filteredFeatures.map(feature => ({
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

function filterMunicipalFeatures2020(baseGeo, resultKeys, mode) {
  const filteredFeatures = (baseGeo?.features || []).filter(feature => {
    const props = feature.properties || {};
    const key = mode === 'prefeito'
      ? String(props.id_unico || props.local_key || '')
      : String(props.local_id || `${parseInt(props.nr_zona, 10)}_${parseInt(props.nr_locvot, 10)}`);
    return resultKeys.has(key);
  });

  return {
    type: 'FeatureCollection',
    features: filteredFeatures.map(feature => ({
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

async function loadMunicipalBaseFromGpkg2016(uf, municipio, muniCode, resultKeys, mode) {
  const ufNorm = String(uf || '').toUpperCase();
  const cacheKey = `${ufNorm}|${normalizeMunicipioSlug(municipio)}|${String(muniCode || '')}`;
  let cachedBase = MUNICIPAL_2016_BASE_CACHE.get(cacheKey);

  if (!cachedBase) {
    const db = await getMunicipal2016Database();
    const stmt = db.prepare(`
      SELECT sg_uf, cod_localidade_ibge, nr_zona, nr_locvot, nm_localidade, nm_locvot,
             ds_endereco, ds_bairro, long, lat, tipo_match
      FROM locais_votacao_2016_ENRIQUECIDO
      WHERE sg_uf = ?
    `);

    const municipioNorm = normalizeMunicipioSlug(municipio);
    const rows = [];
    stmt.bind([ufNorm]);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      if (normalizeMunicipioSlug(row.nm_localidade) !== municipioNorm) continue;
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
      features: rows.map(row => buildMunicipal2016Feature(row, muniCode))
    };

    try {
      const censusJson = await loadCensoJson2016(ufNorm);
      mergeCensoJson2016(cachedBase, censusJson, muniCode, municipio);
    } catch (error) {
      console.warn(`[2016] Censo nao carregado para ${municipio}/${ufNorm}:`, error);
    }

    MUNICIPAL_2016_BASE_CACHE.set(cacheKey, cachedBase);
  }

  const filtered = filterMunicipalFeatures2016(cachedBase, resultKeys, mode);
  if (!filtered.features.length) {
    throw new Error(`Nenhum local do GPKG 2016 bateu com os resultados de ${municipio}/${ufNorm}.`);
  }

  return filtered;
}

async function loadMunicipalBaseFromGpkg2012(uf, municipio, muniCode, resultKeys, mode) {
  const ufNorm = String(uf || '').toUpperCase();
  const cacheKey = `${ufNorm}|${normalizeMunicipioSlug(municipio)}|${String(muniCode || '')}`;
  let cachedBase = MUNICIPAL_2012_BASE_CACHE.get(cacheKey);

  if (!cachedBase) {
    const db = await getMunicipal2012Database();
    const stmt = db.prepare(`
      SELECT sg_uf, cod_localidade_ibge, nr_zona, nr_locvot, nm_localidade, nm_locvot,
             ds_endereco, ds_bairro, long, lat, tipo_match
      FROM locais_votacao_2012_ENRIQUECIDO
      WHERE sg_uf = ?
    `);

    const municipioNorm = normalizeMunicipioSlug(municipio);
    const rows = [];
    stmt.bind([ufNorm]);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      if (normalizeMunicipioSlug(row.nm_localidade) !== municipioNorm) continue;
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
      features: rows.map(row => buildMunicipal2012Feature(row, muniCode))
    };

    try {
      const censusJson = await loadCensoJson2012(ufNorm);
      mergeCensoJson2012(cachedBase, censusJson, muniCode, municipio);
    } catch (error) {
      console.warn(`[2012] Censo nao carregado para ${municipio}/${ufNorm}:`, error);
    }

    MUNICIPAL_2012_BASE_CACHE.set(cacheKey, cachedBase);
  }

  const filtered = filterMunicipalFeatures2012(cachedBase, resultKeys, mode);
  if (!filtered.features.length) {
    throw new Error(`Nenhum local do GPKG 2012 bateu com os resultados de ${municipio}/${ufNorm}.`);
  }

  return filtered;
}

async function loadMunicipalBaseFromGpkg2008(uf, municipio, muniCode, resultKeys, mode) {
  const ufNorm = String(uf || '').toUpperCase();
  const cacheKey = `${ufNorm}|${normalizeMunicipioSlug(municipio)}|${String(muniCode || '')}`;
  let cachedBase = MUNICIPAL_2008_BASE_CACHE.get(cacheKey);

  if (!cachedBase) {
    const db = await getMunicipal2008Database();
    const stmt = db.prepare(`
      SELECT sg_uf, cod_localidade_ibge, nr_zona, nr_locvot, nm_localidade, nm_locvot,
             ds_endereco, ds_bairro, long, lat, tipo_match
      FROM locais_votacao_2008_padronizado
      WHERE sg_uf = ?
    `);

    const municipioNorm = normalizeMunicipioSlug(municipio);
    const rows = [];
    stmt.bind([ufNorm]);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      if (normalizeMunicipioSlug(row.nm_localidade) !== municipioNorm) continue;
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

    try {
      const censusJson = await loadCensoJson2008(ufNorm);
      mergeCensoJson2008(cachedBase, censusJson, muniCode, municipio);
    } catch (error) {
      console.warn(`[2008] Censo nao carregado para ${municipio}/${ufNorm}:`, error);
    }

    MUNICIPAL_2008_BASE_CACHE.set(cacheKey, cachedBase);
  }

  const filtered = filterMunicipalFeatures2008(cachedBase, resultKeys, mode);
  if (!filtered.features.length) {
    throw new Error(`Nenhum local do GPKG 2008 bateu com os resultados de ${municipio}/${ufNorm}.`);
  }

  return filtered;
}

async function loadMunicipalBaseFromGpkg2020(uf, municipio, muniCode, resultKeys, mode) {
  const ufNorm = String(uf || '').toUpperCase();
  const cacheKey = `${ufNorm}|${normalizeMunicipioSlug(municipio)}|${String(muniCode || '')}`;
  let cachedBase = MUNICIPAL_2020_BASE_CACHE.get(cacheKey);

  if (!cachedBase) {
    const db = await getMunicipal2020Database();
    const stmt = db.prepare(`
      SELECT sg_uf, cod_localidade_ibge, nr_zona, nr_locvot, nm_localidade, nm_locvot,
             ds_endereco, ds_bairro, long, lat, tipo_match
      FROM locais_votacao_2020_ENRIQUECIDO
      WHERE sg_uf = ?
    `);

    const municipioNorm = normalizeMunicipioSlug(municipio);
    const rows = [];
    stmt.bind([ufNorm]);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      if (normalizeMunicipioSlug(row.nm_localidade) !== municipioNorm) continue;
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
      features: rows.map(row => buildMunicipal2020Feature(row, muniCode))
    };

    try {
      const censusJson = await loadCensoJson2020(ufNorm);
      mergeCensoJson2020(cachedBase, censusJson, muniCode, municipio);
    } catch (error) {
      console.warn(`[2020] Censo nao carregado para ${municipio}/${ufNorm}:`, error);
    }

    MUNICIPAL_2020_BASE_CACHE.set(cacheKey, cachedBase);
  }

  const filtered = filterMunicipalFeatures2020(cachedBase, resultKeys, mode);
  if (!filtered.features.length) {
    throw new Error(`Nenhum local do GPKG 2020 bateu com os resultados de ${municipio}/${ufNorm}.`);
  }

  return filtered;
}

async function loadMunicipalBaseFromGpkg2024(uf, municipio, muniCode, resultKeys, mode) {
  const ufNorm = String(uf || '').toUpperCase();
  const cacheKey = `${ufNorm}|${normalizeMunicipioSlug(municipio)}|${String(muniCode || '')}`;
  let cachedBase = MUNICIPAL_2024_BASE_CACHE.get(cacheKey);

  if (!cachedBase) {
    const db = await getMunicipal2024Database();
    const stmt = db.prepare(`
      SELECT sg_uf, cod_localidade_ibge, nr_zona, nr_locvot, nm_localidade, nm_locvot,
             ds_endereco, ds_bairro, long, lat, tipo_match
      FROM locais_votacao_2024_atualizado_2
      WHERE sg_uf = ?
    `);

    const municipioNorm = normalizeMunicipioSlug(municipio);
    const rows = [];
    stmt.bind([ufNorm]);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      if (normalizeMunicipioSlug(row.nm_localidade) !== municipioNorm) continue;
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
      features: rows.map(row => buildMunicipal2024Feature(row, muniCode))
    };

    try {
      const censusJson = await loadCensoJson2024(ufNorm);
      mergeCensoJson2024(cachedBase, censusJson, muniCode, municipio);
    } catch (error) {
      console.warn(`[2024] Censo nao carregado para ${municipio}/${ufNorm}:`, error);
    }

    MUNICIPAL_2024_BASE_CACHE.set(cacheKey, cachedBase);
  }

  const filtered = filterMunicipalFeatures2024(cachedBase, resultKeys, mode);
  if (!filtered.features.length) {
    throw new Error(`Nenhum local do GPKG 2024 bateu com os resultados de ${municipio}/${ufNorm}.`);
  }

  return filtered;
}

function applyTurnMetricsFromJsonVotes(props, votes, turnoKey, includeLegenda) {
  let totalValidos = 0;
  let votosBrancos = 0;
  let votosNulos = 0;
  let votosLegenda = 0;

  Object.entries(votes || {}).forEach(([candidateId, rawVotes]) => {
    const currentVotes = ensureNumber(rawVotes);
    if (candidateId === '95') {
      votosBrancos += currentVotes;
      return;
    }
    if (candidateId === '96') {
      votosNulos += currentVotes;
      return;
    }

    totalValidos += currentVotes;
    if (includeLegenda && String(candidateId).length <= 2) {
      votosLegenda += currentVotes;
    }
  });

  props[`NR_TURNO ${turnoKey}`] = turnoKey === '2T' ? 2 : 1;
  props[`Total_Votos_Validos ${turnoKey}`] = totalValidos;
  props[`Votos_Brancos ${turnoKey}`] = votosBrancos;
  props[`Votos_Nulos ${turnoKey}`] = votosNulos;
  props[`Votos_Legenda ${turnoKey}`] = includeLegenda ? votosLegenda : 0;
  props[`Abstenções ${turnoKey}`] = 0;
  props[`Eleitores_Aptos_Municipal ${turnoKey}`] = 0;
}

function applyPrefeitoJsonToGeojson2024(geojson, fullJson, turnoKey) {
  if (!geojson?.features?.length || !fullJson?.RESULTS) return;
  const metadata = fullJson.METADATA?.cand_names || {};

  geojson.features.forEach(feature => {
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

function applyVereadorMetricsToGeojson2024(geojson, fullJson) {
  if (!geojson?.features?.length || !fullJson?.RESULTS) return;

  geojson.features.forEach(feature => {
    const props = feature.properties || {};
    const resultKey = String(props.local_id || `${parseInt(props.nr_zona, 10)}_${parseInt(props.nr_locvot, 10)}`);
    const votes = fullJson.RESULTS[resultKey];
    if (!votes) return;
    applyTurnMetricsFromJsonVotes(props, votes, '1T', true);
  });
}

function buildPrefeitoOfficialSummary(fullJson, turnoKey) {
  const rawTotals = aggregateVotesFromResults(fullJson?.RESULTS || {});
  const metadata = fullJson?.METADATA?.cand_names || {};
  const votesByDisplayKey = {};

  Object.entries(rawTotals).forEach(([candidateId, votes]) => {
    if (candidateId === '95' || candidateId === '96') return;
    const meta = metadata[candidateId];
    if (!meta) return;
    const candidateKey = `${meta[0] || `Candidato ${candidateId}`} (${meta[1] || '?'}) (${meta[2] || 'N/D'}) ${turnoKey}`;
    votesByDisplayKey[candidateKey] = ensureNumber(votes);
  });

  return {
    votesByDisplayKey,
    rawTotals,
    ...summarizeRawVoteMap(rawTotals, { includeLegenda: true })
  };
}

function buildVereadorOfficialSummary(fullJson) {
  const rawTotals = aggregateVotesFromResults(fullJson?.RESULTS || {});
  return {
    votesById: rawTotals,
    ...summarizeRawVoteMap(rawTotals, { includeLegenda: false })
  };
}

function extractMunicipioSlugFromPrefeitoFile(filename) {
  const baseName = String(filename || '').replace(/\.json$/i, '');
  const parts = baseName.split('_');
  return normalizeMunicipioSlug(parts.slice(1).join('_'));
}

function extractMunicipioSlugFromPrefeitoFile2008(filename) {
  const baseName = String(filename || '').replace(/\.json$/i, '');
  const parts = baseName.split('_');
  return normalizeMunicipioSlug(parts.slice(1).join('_'));
}

function extractMunicipioCodeFromPrefeitoFile2008(filename) {
  const match = String(filename || '').match(/^(\d+)_/i);
  return match ? match[1] : '';
}

function extractMunicipioSlugFromVereadorFile(filename) {
  const baseName = String(filename || '').replace(/\.json$/i, '');
  const parts = baseName.split('_');
  return normalizeMunicipioSlug(parts.slice(3, -1).join('_'));
}

function extractMunicipioCodeFromVereadorFile(filename) {
  const match = String(filename || '').match(/_(\d+)\.json$/i);
  return match ? match[1] : '';
}

async function loadPrefeitoJson2024(uf, municipio, subtype, turno) {
  const ufNorm = String(uf || '').toUpperCase();
  const municipioNorm = normalizeMunicipioSlug(municipio);
  const zipUrl = `${DATA_BASE_URL}Municipais 2024/prefeito_2024_${subtype}_t${turno}_${ufNorm}.zip`;

  const { data, name } = await fetchJsonFromZipEntry(
    zipUrl,
    null,
    (entryName) => entryName.toLowerCase().endsWith('.json')
      && !entryName.toLowerCase().endsWith('_resumo.json')
      && extractMunicipioSlugFromPrefeitoFile(entryName) === municipioNorm
  );

  return {
    json: data,
    name,
    muniCode: String(data?.METADATA?.cd_municipio || '').trim()
  };
}

async function loadPrefeitoJson2020(uf, municipio, subtype, turno) {
  const ufNorm = String(uf || '').toUpperCase();
  const municipioNorm = normalizeMunicipioSlug(municipio);
  const zipUrl = `${DATA_BASE_URL}Municipais 2020/prefeito_2020_${subtype}_t${turno}_${ufNorm}.zip`;

  const { data, name } = await fetchJsonFromZipEntry(
    zipUrl,
    null,
    (entryName) => entryName.toLowerCase().endsWith('.json')
      && !entryName.toLowerCase().endsWith('_resumo.json')
      && extractMunicipioSlugFromPrefeitoFile(entryName) === municipioNorm
  );

  return {
    json: data,
    name,
    muniCode: String(data?.METADATA?.cd_municipio || '').trim()
  };
}

async function loadPrefeitoJson2016(uf, municipio, subtype, turno) {
  const ufNorm = String(uf || '').toUpperCase();
  const municipioNorm = normalizeMunicipioSlug(municipio);
  const zipUrl = `${DATA_BASE_URL}Municipais 2016/prefeito_2016_${subtype}_t${turno}_${ufNorm}.zip`;

  const { data, name } = await fetchJsonFromZipEntry(
    zipUrl,
    null,
    (entryName) => entryName.toLowerCase().endsWith('.json')
      && !entryName.toLowerCase().endsWith('_resumo.json')
      && extractMunicipioSlugFromPrefeitoFile(entryName) === municipioNorm
  );

  return {
    json: data,
    name,
    muniCode: String(data?.METADATA?.cd_municipio || '').trim()
  };
}

async function loadPrefeitoJson2012(uf, municipio, subtype, turno) {
  const ufNorm = String(uf || '').toUpperCase();
  const municipioNorm = normalizeMunicipioSlug(municipio);
  const zipUrl = `${DATA_BASE_URL}Municipais 2012/prefeito_2012_${subtype}_t${turno}_${ufNorm}.zip`;

  const { data, name } = await fetchJsonFromZipEntry(
    zipUrl,
    null,
    (entryName) => entryName.toLowerCase().endsWith('.json')
      && !entryName.toLowerCase().endsWith('_resumo.json')
      && extractMunicipioSlugFromPrefeitoFile(entryName) === municipioNorm
  );

  return {
    json: data,
    name,
    muniCode: String(data?.METADATA?.cd_municipio || '').trim()
  };
}

async function loadPrefeitoJson2008(uf, municipio, subtype, turno) {
  const ufNorm = String(uf || '').toUpperCase();
  const municipioNorm = normalizeMunicipioSlug(municipio);
  const zipUrl = `${DATA_BASE_URL}Municipais 2008/prefeito_2008_${subtype}_t${turno}_${ufNorm}.zip`;

  const { data, name } = await fetchJsonFromZipEntry(
    zipUrl,
    null,
    (entryName) => entryName.toLowerCase().endsWith('.json')
      && !entryName.toLowerCase().endsWith('_resumo.json')
      && extractMunicipioSlugFromPrefeitoFile2008(entryName) === municipioNorm
  );

  return {
    json: data,
    name,
    muniCode: String(data?.METADATA?.cd_municipio || extractMunicipioCodeFromPrefeitoFile2008(name) || '').trim()
  };
}

async function loadVereadorJson2024(uf, municipio) {
  const ufNorm = String(uf || '').toUpperCase();
  const municipioNorm = normalizeMunicipioSlug(municipio);
  const zipUrl = `${DATA_BASE_URL}Municipais_Legislativas 2024/vereadores_2024_${ufNorm}.zip`;

  const { data, name } = await fetchJsonFromZipEntry(
    zipUrl,
    null,
    (entryName) => entryName.toLowerCase().endsWith('.json')
      && !entryName.toLowerCase().endsWith('_resumo.json')
      && extractMunicipioSlugFromVereadorFile(entryName) === municipioNorm
  );

  return {
    json: data,
    name,
    muniCode: extractMunicipioCodeFromVereadorFile(name)
  };
}

async function loadVereadorJson2012(uf, municipio) {
  const ufNorm = String(uf || '').toUpperCase();
  const municipioNorm = normalizeMunicipioSlug(municipio);
  const zipUrl = `${DATA_BASE_URL}Municipais_Legislativas 2012/vereadores_2012_${ufNorm}.zip`;

  const { data, name } = await fetchJsonFromZipEntry(
    zipUrl,
    null,
    (entryName) => entryName.toLowerCase().endsWith('.json')
      && !entryName.toLowerCase().endsWith('_resumo.json')
      && extractMunicipioSlugFromVereadorFile(entryName) === municipioNorm
  );

  return {
    json: data,
    name,
    muniCode: extractMunicipioCodeFromVereadorFile(name)
  };
}

async function loadVereadorJson2016(uf, municipio) {
  const ufNorm = String(uf || '').toUpperCase();
  const municipioNorm = normalizeMunicipioSlug(municipio);
  const zipUrl = `${DATA_BASE_URL}Municipais_Legislativas 2016/vereadores_2016_${ufNorm}.zip`;

  const { data, name } = await fetchJsonFromZipEntry(
    zipUrl,
    null,
    (entryName) => entryName.toLowerCase().endsWith('.json')
      && !entryName.toLowerCase().endsWith('_resumo.json')
      && extractMunicipioSlugFromVereadorFile(entryName) === municipioNorm
  );

  return {
    json: data,
    name,
    muniCode: extractMunicipioCodeFromVereadorFile(name)
  };
}

async function loadVereadorJson2020(uf, municipio) {
  const ufNorm = String(uf || '').toUpperCase();
  const municipioNorm = normalizeMunicipioSlug(municipio);
  const zipUrl = `${DATA_BASE_URL}Municipais_Legislativas 2020/vereadores_2020_${ufNorm}.zip`;

  const { data, name } = await fetchJsonFromZipEntry(
    zipUrl,
    null,
    (entryName) => entryName.toLowerCase().endsWith('.json')
      && !entryName.toLowerCase().endsWith('_resumo.json')
      && extractMunicipioSlugFromVereadorFile(entryName) === municipioNorm
  );

  return {
    json: data,
    name,
    muniCode: extractMunicipioCodeFromVereadorFile(name)
  };
}

async function loadVereadorJson2008(uf, municipio) {
  const ufNorm = String(uf || '').toUpperCase();
  const municipioNorm = normalizeMunicipioSlug(municipio);
  const zipUrl = `${DATA_BASE_URL}Municipais_Legislativas 2008/vereadores_2008_${ufNorm}.zip`;

  const { data, name } = await fetchJsonFromZipEntry(
    zipUrl,
    null,
    (entryName) => entryName.toLowerCase().endsWith('.json')
      && !entryName.toLowerCase().endsWith('_resumo.json')
      && extractMunicipioSlugFromVereadorFile(entryName) === municipioNorm
  );

  return {
    json: data,
    name,
    muniCode: extractMunicipioCodeFromVereadorFile(name)
  };
}

async function ensureOfficialTotalsVereadores(ano) {
  if (!STATE.officialTotals) STATE.officialTotals = {};
  const totalsKey = `vereadores_${ano}`;
  if (STATE.officialTotals[totalsKey]) return;

  try {
    const res = await fetch(`resultados_geo/Municipais_Legislativas ${ano}/official_totals_vereadores_${ano}.json`);
    if (res.ok) {
      STATE.officialTotals[totalsKey] = await res.json();
      console.log(`[Vereadores] Totais oficiais ${ano} carregados.`);
    }
  } catch (error) {
    console.warn(`[Vereadores] Totais oficiais ${ano} nao encontrados:`, error);
  }
}

function finalizeMunicipalLoadUI(municipio, isVereador) {
  currentCidadeFilter = 'all';
  currentBairroFilter = 'all';
  currentLocalFilter = '';

  updateElectionTypeUI();
  dom.summaryBoxContainer.classList.add('section-hidden');
  [dom.filterBox, dom.vizBox].forEach(el => el.classList.remove('section-hidden'));

  if (cidadeCombobox) {
    cidadeCombobox.disable(true);
    if (isVereador) {
      cidadeCombobox.setValue("Todos os municipios");
      currentCidadeFilter = 'all';
    }
  }

  if (bairroCombobox) bairroCombobox.disable(false);
  if (dom.selectVizColorStyle) dom.selectVizColorStyle.disabled = false;
  if (dom.selectVizSize) dom.selectVizSize.disabled = false;
  dom.searchLocal.disabled = false;
  dom.searchLocal.value = '';
  if (bairroCombobox) bairroCombobox.setValue("Todos os bairros");
  populateBairroDropdown();
  dom.btnApplyFilters.disabled = false;
  dom.btnApplyFilters.textContent = `Analisar/Agregar "${municipio}"`;

  const inaptosKey = isVereador ? 'vereador_ord' : currentCargo;
  const hasInaptos = Object.values(STATE.dataHasInaptos).some(v => v)
    || ((STATE.inaptos[inaptosKey]?.['1T']?.length || 0) > 0);

  dom.btnToggleInaptos.disabled = !hasInaptos;
  STATE.filterInaptos = false;
  dom.btnToggleInaptos.classList.remove('active');
  dom.btnToggleInaptos.textContent = 'Filtrar Inaptos';

  updateConditionalUI();
  applyFiltersAndRedraw();
  try {
    const bounds = currentLayer?.getBounds();
    if (bounds?.isValid()) {
      if (typeof applyMapViewportAfterDataLoad === 'function') applyMapViewportAfterDataLoad(bounds);
      else map.fitBounds(bounds);
    }
  } catch (error) { }
}

async function loadMunicipal2024Prefeito(uf, municipio, ano) {
  STATE.municipalOfficialTotals['prefeito_ord'] = {};
  delete STATE.municipalOfficialTotals['prefeito_sup'];

  const ord1 = await loadPrefeitoJson2024(uf, municipio, 'ord', 1);
  if (!ord1?.json?.RESULTS) {
    throw new Error(`JSON de prefeito nao encontrado para ${municipio}/${uf} (${ano}).`);
  }

  const muniCode = String(ord1.muniCode || '').trim();
  STATE.currentMuniCode = muniCode;

  const ord2 = await loadPrefeitoJson2024(uf, municipio, 'ord', 2).catch(() => null);
  const sup1 = await loadPrefeitoJson2024(uf, municipio, 'sup', 1).catch(() => null);

  const ordKeys = new Set(Object.keys(ord1.json.RESULTS || {}));
  if (ord2?.json?.RESULTS) {
    Object.keys(ord2.json.RESULTS).forEach(key => ordKeys.add(key));
  }

  const ordGeo = await loadMunicipalBaseFromGpkg2024(uf, municipio, muniCode, ordKeys, 'prefeito');
  applyPrefeitoJsonToGeojson2024(ordGeo, ord1.json, '1T');
  STATE.municipalOfficialTotals['prefeito_ord']['1T'] = buildPrefeitoOfficialSummary(ord1.json, '1T');
  if (ord2?.json?.RESULTS) {
    applyPrefeitoJsonToGeojson2024(ordGeo, ord2.json, '2T');
    STATE.municipalOfficialTotals['prefeito_ord']['2T'] = buildPrefeitoOfficialSummary(ord2.json, '2T');
  }

  currentOffice = 'prefeito';
  currentSubType = 'ord';
  currentCargo = 'prefeito_ord';
  currentDataCollection['prefeito_ord'] = ordGeo;
  processLoadedGeoJSON(ordGeo, 'prefeito_ord');

  if (sup1?.json?.RESULTS) {
    const supKeys = new Set(Object.keys(sup1.json.RESULTS));
    const supGeo = await loadMunicipalBaseFromGpkg2024(uf, municipio, muniCode, supKeys, 'prefeito');
    applyPrefeitoJsonToGeojson2024(supGeo, sup1.json, '1T');
    STATE.municipalOfficialTotals['prefeito_sup'] = {
      '1T': buildPrefeitoOfficialSummary(sup1.json, '1T')
    };
    currentDataCollection['prefeito_sup'] = supGeo;
    processLoadedGeoJSON(supGeo, 'prefeito_sup');
  }

  finalizeMunicipalLoadUI(municipio, false);
  showToast(`Dados de ${municipio}/${uf} (${ano}) carregados!`, 'success');
}

async function loadMunicipal2024Vereador(uf, municipio, ano) {
  await ensureOfficialTotalsVereadores(ano);
  STATE.municipalOfficialTotals['vereador_ord'] = {};

  const vereadorPayload = await loadVereadorJson2024(uf, municipio);
  if (!vereadorPayload?.json?.RESULTS) {
    throw new Error(`JSON de vereadores nao encontrado para ${municipio}/${uf} (${ano}).`);
  }

  const muniCode = String(vereadorPayload.muniCode || '').trim();
  STATE.currentMuniCode = muniCode;

  const resultKeys = new Set(Object.keys(vereadorPayload.json.RESULTS || {}));
  const baseGeo = await loadMunicipalBaseFromGpkg2024(uf, municipio, muniCode, resultKeys, 'vereador');
  applyVereadorMetricsToGeojson2024(baseGeo, vereadorPayload.json);
  STATE.municipalOfficialTotals['vereador_ord']['1T'] = buildVereadorOfficialSummary(vereadorPayload.json);

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
  showToast(`Vereadores de ${municipio}/${uf} (${ano}) carregados!`, 'success');
}

async function loadMunicipal2020Prefeito(uf, municipio, ano) {
  STATE.municipalOfficialTotals['prefeito_ord'] = {};
  delete STATE.municipalOfficialTotals['prefeito_sup'];

  const ord1 = await loadPrefeitoJson2020(uf, municipio, 'ord', 1);
  if (!ord1?.json?.RESULTS) {
    throw new Error(`JSON de prefeito nao encontrado para ${municipio}/${uf} (${ano}).`);
  }

  const muniCode = String(ord1.muniCode || '').trim();
  STATE.currentMuniCode = muniCode;

  const ord2 = await loadPrefeitoJson2020(uf, municipio, 'ord', 2).catch(() => null);
  const sup1 = await loadPrefeitoJson2020(uf, municipio, 'sup', 1).catch(() => null);

  const ordKeys = new Set(Object.keys(ord1.json.RESULTS || {}));
  if (ord2?.json?.RESULTS) {
    Object.keys(ord2.json.RESULTS).forEach(key => ordKeys.add(key));
  }

  const ordGeo = await loadMunicipalBaseFromGpkg2020(uf, municipio, muniCode, ordKeys, 'prefeito');
  applyPrefeitoJsonToGeojson2024(ordGeo, ord1.json, '1T');
  STATE.municipalOfficialTotals['prefeito_ord']['1T'] = buildPrefeitoOfficialSummary(ord1.json, '1T');
  if (ord2?.json?.RESULTS) {
    applyPrefeitoJsonToGeojson2024(ordGeo, ord2.json, '2T');
    STATE.municipalOfficialTotals['prefeito_ord']['2T'] = buildPrefeitoOfficialSummary(ord2.json, '2T');
  }

  currentOffice = 'prefeito';
  currentSubType = 'ord';
  currentCargo = 'prefeito_ord';
  currentDataCollection['prefeito_ord'] = ordGeo;
  processLoadedGeoJSON(ordGeo, 'prefeito_ord');

  if (sup1?.json?.RESULTS) {
    const supKeys = new Set(Object.keys(sup1.json.RESULTS));
    const supGeo = await loadMunicipalBaseFromGpkg2020(uf, municipio, muniCode, supKeys, 'prefeito');
    applyPrefeitoJsonToGeojson2024(supGeo, sup1.json, '1T');
    STATE.municipalOfficialTotals['prefeito_sup'] = {
      '1T': buildPrefeitoOfficialSummary(sup1.json, '1T')
    };
    currentDataCollection['prefeito_sup'] = supGeo;
    processLoadedGeoJSON(supGeo, 'prefeito_sup');
  }

  finalizeMunicipalLoadUI(municipio, false);
  showToast(`Dados de ${municipio}/${uf} (${ano}) carregados!`, 'success');
}

async function loadMunicipal2020Vereador(uf, municipio, ano) {
  await ensureOfficialTotalsVereadores(ano);
  STATE.municipalOfficialTotals['vereador_ord'] = {};

  const vereadorPayload = await loadVereadorJson2020(uf, municipio);
  if (!vereadorPayload?.json?.RESULTS) {
    throw new Error(`JSON de vereadores nao encontrado para ${municipio}/${uf} (${ano}).`);
  }

  const muniCode = String(vereadorPayload.muniCode || '').trim();
  STATE.currentMuniCode = muniCode;

  const resultKeys = new Set(Object.keys(vereadorPayload.json.RESULTS || {}));
  const baseGeo = await loadMunicipalBaseFromGpkg2020(uf, municipio, muniCode, resultKeys, 'vereador');
  applyVereadorMetricsToGeojson2024(baseGeo, vereadorPayload.json);
  STATE.municipalOfficialTotals['vereador_ord']['1T'] = buildVereadorOfficialSummary(vereadorPayload.json);

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
  showToast(`Vereadores de ${municipio}/${uf} (${ano}) carregados!`, 'success');
}

async function loadMunicipal2016Prefeito(uf, municipio, ano) {
  STATE.municipalOfficialTotals['prefeito_ord'] = {};
  delete STATE.municipalOfficialTotals['prefeito_sup'];

  const ord1 = await loadPrefeitoJson2016(uf, municipio, 'ord', 1);
  if (!ord1?.json?.RESULTS) {
    throw new Error(`JSON de prefeito nao encontrado para ${municipio}/${uf} (${ano}).`);
  }

  const muniCode = String(ord1.muniCode || '').trim();
  STATE.currentMuniCode = muniCode;

  const ord2 = await loadPrefeitoJson2016(uf, municipio, 'ord', 2).catch(() => null);
  const sup1 = await loadPrefeitoJson2016(uf, municipio, 'sup', 1).catch(() => null);

  const ordKeys = new Set(Object.keys(ord1.json.RESULTS || {}));
  if (ord2?.json?.RESULTS) {
    Object.keys(ord2.json.RESULTS).forEach(key => ordKeys.add(key));
  }

  const ordGeo = await loadMunicipalBaseFromGpkg2016(uf, municipio, muniCode, ordKeys, 'prefeito');
  applyPrefeitoJsonToGeojson2024(ordGeo, ord1.json, '1T');
  STATE.municipalOfficialTotals['prefeito_ord']['1T'] = buildPrefeitoOfficialSummary(ord1.json, '1T');
  if (ord2?.json?.RESULTS) {
    applyPrefeitoJsonToGeojson2024(ordGeo, ord2.json, '2T');
    STATE.municipalOfficialTotals['prefeito_ord']['2T'] = buildPrefeitoOfficialSummary(ord2.json, '2T');
  }

  currentOffice = 'prefeito';
  currentSubType = 'ord';
  currentCargo = 'prefeito_ord';
  currentDataCollection['prefeito_ord'] = ordGeo;
  processLoadedGeoJSON(ordGeo, 'prefeito_ord');

  if (sup1?.json?.RESULTS) {
    const supKeys = new Set(Object.keys(sup1.json.RESULTS));
    const supGeo = await loadMunicipalBaseFromGpkg2016(uf, municipio, muniCode, supKeys, 'prefeito');
    applyPrefeitoJsonToGeojson2024(supGeo, sup1.json, '1T');
    STATE.municipalOfficialTotals['prefeito_sup'] = {
      '1T': buildPrefeitoOfficialSummary(sup1.json, '1T')
    };
    currentDataCollection['prefeito_sup'] = supGeo;
    processLoadedGeoJSON(supGeo, 'prefeito_sup');
  }

  finalizeMunicipalLoadUI(municipio, false);
  showToast(`Dados de ${municipio}/${uf} (${ano}) carregados!`, 'success');
}

async function loadMunicipal2016Vereador(uf, municipio, ano) {
  await ensureOfficialTotalsVereadores(ano);
  STATE.municipalOfficialTotals['vereador_ord'] = {};

  const vereadorPayload = await loadVereadorJson2016(uf, municipio);
  if (!vereadorPayload?.json?.RESULTS) {
    throw new Error(`JSON de vereadores nao encontrado para ${municipio}/${uf} (${ano}).`);
  }

  const muniCode = String(vereadorPayload.muniCode || '').trim();
  STATE.currentMuniCode = muniCode;

  const resultKeys = new Set(Object.keys(vereadorPayload.json.RESULTS || {}));
  const baseGeo = await loadMunicipalBaseFromGpkg2016(uf, municipio, muniCode, resultKeys, 'vereador');
  applyVereadorMetricsToGeojson2024(baseGeo, vereadorPayload.json);
  STATE.municipalOfficialTotals['vereador_ord']['1T'] = buildVereadorOfficialSummary(vereadorPayload.json);

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
  showToast(`Vereadores de ${municipio}/${uf} (${ano}) carregados!`, 'success');
}

async function loadMunicipal2012Prefeito(uf, municipio, ano) {
  STATE.municipalOfficialTotals['prefeito_ord'] = {};
  delete STATE.municipalOfficialTotals['prefeito_sup'];

  const ord1 = await loadPrefeitoJson2012(uf, municipio, 'ord', 1);
  if (!ord1?.json?.RESULTS) {
    throw new Error(`JSON de prefeito nao encontrado para ${municipio}/${uf} (${ano}).`);
  }

  const muniCode = String(ord1.muniCode || '').trim();
  STATE.currentMuniCode = muniCode;

  const ord2 = await loadPrefeitoJson2012(uf, municipio, 'ord', 2).catch(() => null);
  const sup1 = await loadPrefeitoJson2012(uf, municipio, 'sup', 1).catch(() => null);

  const ordKeys = new Set(Object.keys(ord1.json.RESULTS || {}));
  if (ord2?.json?.RESULTS) {
    Object.keys(ord2.json.RESULTS).forEach(key => ordKeys.add(key));
  }

  const ordGeo = await loadMunicipalBaseFromGpkg2012(uf, municipio, muniCode, ordKeys, 'prefeito');
  applyPrefeitoJsonToGeojson2024(ordGeo, ord1.json, '1T');
  STATE.municipalOfficialTotals['prefeito_ord']['1T'] = buildPrefeitoOfficialSummary(ord1.json, '1T');
  if (ord2?.json?.RESULTS) {
    applyPrefeitoJsonToGeojson2024(ordGeo, ord2.json, '2T');
    STATE.municipalOfficialTotals['prefeito_ord']['2T'] = buildPrefeitoOfficialSummary(ord2.json, '2T');
  }

  currentOffice = 'prefeito';
  currentSubType = 'ord';
  currentCargo = 'prefeito_ord';
  currentDataCollection['prefeito_ord'] = ordGeo;
  processLoadedGeoJSON(ordGeo, 'prefeito_ord');

  if (sup1?.json?.RESULTS) {
    const supKeys = new Set(Object.keys(sup1.json.RESULTS));
    const supGeo = await loadMunicipalBaseFromGpkg2012(uf, municipio, muniCode, supKeys, 'prefeito');
    applyPrefeitoJsonToGeojson2024(supGeo, sup1.json, '1T');
    STATE.municipalOfficialTotals['prefeito_sup'] = {
      '1T': buildPrefeitoOfficialSummary(sup1.json, '1T')
    };
    currentDataCollection['prefeito_sup'] = supGeo;
    processLoadedGeoJSON(supGeo, 'prefeito_sup');
  }

  finalizeMunicipalLoadUI(municipio, false);
  showToast(`Dados de ${municipio}/${uf} (${ano}) carregados!`, 'success');
}

async function loadMunicipal2012Vereador(uf, municipio, ano) {
  await ensureOfficialTotalsVereadores(ano);
  STATE.municipalOfficialTotals['vereador_ord'] = {};

  const vereadorPayload = await loadVereadorJson2012(uf, municipio);
  if (!vereadorPayload?.json?.RESULTS) {
    throw new Error(`JSON de vereadores nao encontrado para ${municipio}/${uf} (${ano}).`);
  }

  const muniCode = String(vereadorPayload.muniCode || '').trim();
  STATE.currentMuniCode = muniCode;

  const resultKeys = new Set(Object.keys(vereadorPayload.json.RESULTS || {}));
  const baseGeo = await loadMunicipalBaseFromGpkg2012(uf, municipio, muniCode, resultKeys, 'vereador');
  applyVereadorMetricsToGeojson2024(baseGeo, vereadorPayload.json);
  STATE.municipalOfficialTotals['vereador_ord']['1T'] = buildVereadorOfficialSummary(vereadorPayload.json);

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
  showToast(`Vereadores de ${municipio}/${uf} (${ano}) carregados!`, 'success');
}

async function loadMunicipal2008Prefeito(uf, municipio, ano) {
  STATE.municipalOfficialTotals['prefeito_ord'] = {};
  delete STATE.municipalOfficialTotals['prefeito_sup'];

  const ord1 = await loadPrefeitoJson2008(uf, municipio, 'ord', 1);
  if (!ord1?.json?.RESULTS) {
    throw new Error(`JSON de prefeito nao encontrado para ${municipio}/${uf} (${ano}).`);
  }

  const muniCode = String(ord1.muniCode || '').trim();
  STATE.currentMuniCode = muniCode;

  const ord2 = await loadPrefeitoJson2008(uf, municipio, 'ord', 2).catch(() => null);
  const sup1 = await loadPrefeitoJson2008(uf, municipio, 'sup', 1).catch(() => null);

  const ordKeys = new Set(Object.keys(ord1.json.RESULTS || {}));
  if (ord2?.json?.RESULTS) {
    Object.keys(ord2.json.RESULTS).forEach(key => ordKeys.add(key));
  }

  const ordGeo = await loadMunicipalBaseFromGpkg2008(uf, municipio, muniCode, ordKeys, 'prefeito');
  applyPrefeitoJsonToGeojson2024(ordGeo, ord1.json, '1T');
  STATE.municipalOfficialTotals['prefeito_ord']['1T'] = buildPrefeitoOfficialSummary(ord1.json, '1T');
  if (ord2?.json?.RESULTS) {
    applyPrefeitoJsonToGeojson2024(ordGeo, ord2.json, '2T');
    STATE.municipalOfficialTotals['prefeito_ord']['2T'] = buildPrefeitoOfficialSummary(ord2.json, '2T');
  }

  currentOffice = 'prefeito';
  currentSubType = 'ord';
  currentCargo = 'prefeito_ord';
  currentDataCollection['prefeito_ord'] = ordGeo;
  processLoadedGeoJSON(ordGeo, 'prefeito_ord');

  if (sup1?.json?.RESULTS) {
    const supKeys = new Set(Object.keys(sup1.json.RESULTS));
    const supGeo = await loadMunicipalBaseFromGpkg2008(uf, municipio, muniCode, supKeys, 'prefeito');
    applyPrefeitoJsonToGeojson2024(supGeo, sup1.json, '1T');
    STATE.municipalOfficialTotals['prefeito_sup'] = {
      '1T': buildPrefeitoOfficialSummary(sup1.json, '1T')
    };
    currentDataCollection['prefeito_sup'] = supGeo;
    processLoadedGeoJSON(supGeo, 'prefeito_sup');
  }

  finalizeMunicipalLoadUI(municipio, false);
  showToast(`Dados de ${municipio}/${uf} (${ano}) carregados!`, 'success');
}

async function loadMunicipal2008Vereador(uf, municipio, ano) {
  await ensureOfficialTotalsVereadores(ano);
  STATE.municipalOfficialTotals['vereador_ord'] = {};

  const vereadorPayload = await loadVereadorJson2008(uf, municipio);
  if (!vereadorPayload?.json?.RESULTS) {
    throw new Error(`JSON de vereadores nao encontrado para ${municipio}/${uf} (${ano}).`);
  }

  const muniCode = String(vereadorPayload.muniCode || '').trim();
  STATE.currentMuniCode = muniCode;

  const resultKeys = new Set(Object.keys(vereadorPayload.json.RESULTS || {}));
  const baseGeo = await loadMunicipalBaseFromGpkg2008(uf, municipio, muniCode, resultKeys, 'vereador');
  applyVereadorMetricsToGeojson2024(baseGeo, vereadorPayload.json);
  STATE.municipalOfficialTotals['vereador_ord']['1T'] = buildVereadorOfficialSummary(vereadorPayload.json);

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
  showToast(`Vereadores de ${municipio}/${uf} (${ano}) carregados!`, 'success');
}
