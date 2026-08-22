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
      tipo_match: row.tipo_match || null,
      hist_id: row.hist_id ?? null
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

// Distância de edição (Levenshtein) para nomes curtos de município.
function general2006EditDistance(a, b) {
  const m = a.length, n = b.length;
  const prev = Array.from({ length: n + 1 }, (_, j) => j);
  const curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

// Similaridade de nomes municipais (0..1), tolerante a variantes (plural, letra
// dobrada, grafia antiga) que aparecem entre GPKG e censo de 2006.
function general2006NameSim(a, b) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.startsWith(nb) || nb.startsWith(na)) return 0.85;
  if (general2006EditDistance(na, nb) <= 2) return 0.7;
  if (na.includes(nb) || nb.includes(na)) return 0.6;
  return 0;
}

// Alguns municípios pequenos nunca recebem `local_key` pelo censo porque o nome
// no GPKG e no censo divergem (ex.: "SANTA ROSA DO PURUS" vs "SANTA ROSA",
// "MANOEL URBANO" vs "MANUEL URBANO", "BADY BASSITT" vs "BADY BASSIT") — e a
// chave (zona, local) sozinha é ambígua porque o número do local se repete entre
// municípios da mesma zona. Sem identidade, esses locais são descartados na
// filtragem e o município fica "sem votos" apenas em 2006.
//
// Aqui derivamos o código TSE do município a partir do "rastro" de locais
// (conjunto de pares zona_local) de cada município no GPKG (por IBGE) versus no
// censo (por TSE), combinando sobreposição (Jaccard) com similaridade de nome.
// Com o TSE, reconstruímos a chave de resultado `zona_TSE_local` e, de quebra,
// anexamos os dados censitários do local correspondente. Só toca em locais que o
// censo não casou — não altera municípios que já funcionam nem outros anos.
function applyGeneral2006FootprintFallback(baseGeo, censusJson) {
  const needy = baseGeo.features.filter((f) => {
    const p = f.properties || {};
    return !p.local_key && !p.id_unico;
  });
  if (!needy.length) return 0;

  // Censo: rastro e nome por TSE, e índice por chave completa (p/ enriquecer).
  const censusFootByTse = new Map();   // tse -> Set('zona_local')
  const censusNameByTse = new Map();   // tse -> nm_localidade
  const censusRowByFullKey = new Map(); // 'zona_tse_local' -> row
  Object.values(censusJson.RESULTS).forEach((row) => {
    if (!row) return;
    const tse = row.cd_localidade_tse;
    const zona = parseInt(row.nr_zona, 10);
    const local = parseInt(row.nr_locvot, 10);
    if (tse == null || !Number.isFinite(zona) || !Number.isFinite(local)) return;
    const zl = `${zona}_${local}`;
    let set = censusFootByTse.get(tse);
    if (!set) { set = new Set(); censusFootByTse.set(tse, set); }
    set.add(zl);
    if (!censusNameByTse.has(tse)) censusNameByTse.set(tse, row.nm_localidade);
    censusRowByFullKey.set(`${zona}_${tse}_${local}`, row);
  });

  // GPKG: rastro e nome por IBGE, restrito aos municípios "needy".
  const needyIbges = new Set(
    needy.map((f) => String(f.properties.cod_localidade_ibge || '')).filter(Boolean)
  );
  const gpkgFootByIbge = new Map();
  const gpkgNameByIbge = new Map();
  baseGeo.features.forEach((f) => {
    const p = f.properties || {};
    const ib = String(p.cod_localidade_ibge || '');
    if (!ib || !needyIbges.has(ib)) return;
    const zona = parseInt(p.nr_zona, 10);
    const local = parseInt(p.nr_locvot, 10);
    if (!Number.isFinite(zona) || !Number.isFinite(local)) return;
    const zl = `${zona}_${local}`;
    let set = gpkgFootByIbge.get(ib);
    if (!set) { set = new Set(); gpkgFootByIbge.set(ib, set); }
    set.add(zl);
    if (!gpkgNameByIbge.has(ib)) gpkgNameByIbge.set(ib, p.nm_localidade);
  });

  // Deriva IBGE -> TSE pelo melhor escore (Jaccard + nome).
  const ibgeToTse = new Map();
  gpkgFootByIbge.forEach((gSet, ib) => {
    let bestTse = null, bestScore = 0;
    censusFootByTse.forEach((cSet, tse) => {
      let inter = 0;
      gSet.forEach((zl) => { if (cSet.has(zl)) inter++; });
      if (inter === 0) return;
      const jaccard = inter / (gSet.size + cSet.size - inter);
      const score = jaccard + 0.5 * general2006NameSim(gpkgNameByIbge.get(ib), censusNameByTse.get(tse));
      if (score > bestScore) { bestScore = score; bestTse = tse; }
    });
    // Limiar de confiança: exige rastro + nome minimamente coerentes.
    if (bestTse != null && bestScore >= 0.3) ibgeToTse.set(ib, bestTse);
  });

  // Atribui identidade (e dados censitários) aos locais recuperados.
  let recovered = 0;
  needy.forEach((f) => {
    const p = f.properties;
    const ib = String(p.cod_localidade_ibge || '');
    const tse = ibgeToTse.get(ib);
    if (tse == null) return;
    const zona = parseInt(p.nr_zona, 10);
    const local = parseInt(p.nr_locvot, 10);
    if (!Number.isFinite(zona) || !Number.isFinite(local)) return;
    const fullKey = `${zona}_${tse}_${local}`;

    const crow = censusRowByFullKey.get(fullKey);
    if (crow) {
      Object.entries(crow).forEach(([key, value]) => {
        // Preserva o nome canônico do GPKG (moderno) — o censo às vezes traz a
        // grafia antiga/variante (ex.: "AMAPARI", "SUD MENUCCI") que não casa com
        // a geometria municipal nem com os outros anos.
        if (key === 'nm_localidade') return;
        if (value !== undefined) p[key] = value;
      });
    }
    p.local_key = fullKey;
    p.id_unico = fullKey;
    p.ID_UNICO = fullKey;
    if (!p.local_id) p.local_id = `${zona}_${local}`;
    recovered++;
  });

  return recovered;
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

  // Recupera municípios cujo nome diverge entre GPKG e censo (sem votos só em 2006).
  const recovered = applyGeneral2006FootprintFallback(baseGeo, censusJson);

  console.log(`[2006] Censo mesclado em ${mergedCount} locais.` + (recovered ? ` (+${recovered} recuperados por rastro/nome)` : ''));
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
             ds_endereco, ds_bairro, long, lat, tipo_match, hist_id
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

// Some municipios tiveram suas zonas eleitorais renumeradas depois de 2006
// (em 2006 eram administrados por uma zona vizinha e so depois ganharam zona
// propria). O censo/GPKG "padronizado" carrega a zona moderna, enquanto os
// resultados de 2006 usam a zona da epoca, entao a chave completa
// `zona_cd_locvot` nao casa e o municipio fica sem votos. Este indice mapeia a
// chave "frouxa" `cd_locvot` (codigo TSE do municipio + numero do local, sem a
// zona) para a chave de resultado, apenas quando ela e inequivoca -- locais
// ambiguos (mesmo local em zonas diferentes, comum em capitais) sao
// descartados do fallback porque ja casam pela chave exata.
function getGeneral2006LooseKey(fullKey) {
  const parts = String(fullKey || '').split('_');
  return parts.length >= 3 ? parts.slice(1).join('_') : '';
}

function buildGeneral2006LooseResultIndex(resultKeys) {
  const keys = resultKeys instanceof Set ? resultKeys : new Set(resultKeys || []);
  const byLoose = new Map();
  const ambiguous = new Set();
  keys.forEach((key) => {
    const loose = getGeneral2006LooseKey(key);
    if (!loose) return;
    if (byLoose.has(loose)) {
      ambiguous.add(loose);
    } else {
      byLoose.set(loose, key);
    }
  });
  ambiguous.forEach((loose) => byLoose.delete(loose));
  return byLoose;
}

function buildFilteredGeneralFeature2006(feature, props, matchedKey) {
  const newProps = { ...props };
  const fullKey = String(props.id_unico || props.local_key || '');
  if (matchedKey !== fullKey) {
    // Realinha a identidade do local com a zona usada nos resultados de 2006
    newProps.id_unico = matchedKey;
    newProps.ID_UNICO = matchedKey;
    newProps.local_key = matchedKey;
    const parts = matchedKey.split('_');
    const matchedZona = parseInt(parts[0], 10);
    const matchedLocal = parseInt(parts[parts.length - 1], 10);
    if (Number.isFinite(matchedZona)) newProps.nr_zona = matchedZona;
    if (Number.isFinite(matchedZona) && Number.isFinite(matchedLocal)) {
      newProps.local_id = `${matchedZona}_${matchedLocal}`;
    }
  }
  return {
    type: 'Feature',
    geometry: feature.geometry ? {
      type: feature.geometry.type,
      coordinates: Array.isArray(feature.geometry.coordinates)
        ? [...feature.geometry.coordinates]
        : feature.geometry.coordinates
    } : null,
    properties: newProps
  };
}

function filterGeneralFeatures2006(baseGeo, resultKeys, looseIndex = null) {
  const keys = resultKeys instanceof Set ? resultKeys : new Set(resultKeys || []);
  const loose = looseIndex || buildGeneral2006LooseResultIndex(keys);
  const features = [];

  // Cada chave de resultado e atribuida a no maximo UM local. A correspondencia
  // exata (zona_cdMuni_local) tem prioridade; o fallback "frouxo" (cdMuni_local,
  // sem zona) so vale para chaves ainda nao reivindicadas. Sem isso, em capitais
  // dois locais fisicos distintos em zonas diferentes com o mesmo numero de local
  // herdavam a mesma chave/id_unico -> votos duplicados e selecao conjunta.
  const claimed = new Set();
  const pending = [];

  (baseGeo?.features || []).forEach((feature) => {
    const props = feature.properties || {};
    const fullKey = String(props.id_unico || props.local_key || '');
    if (!fullKey) return;
    if (keys.has(fullKey)) {
      if (claimed.has(fullKey)) return; // dedupe de locais com identidade repetida
      claimed.add(fullKey);
      features.push(buildFilteredGeneralFeature2006(feature, props, fullKey));
    } else {
      pending.push({ feature, props, fullKey });
    }
  });

  pending.forEach(({ feature, props, fullKey }) => {
    const looseKey = getGeneral2006LooseKey(fullKey);
    if (!looseKey || !loose.has(looseKey)) return;
    const matchedKey = loose.get(looseKey);
    if (claimed.has(matchedKey)) return; // ja reivindicada (exata ou outro frouxo)
    claimed.add(matchedKey);
    features.push(buildFilteredGeneralFeature2006(feature, props, matchedKey));
  });

  return { type: 'FeatureCollection', features };
}

async function loadGeneralScopeBase2006(ufs, resultKeys) {
  const looseIndex = buildGeneral2006LooseResultIndex(resultKeys);
  const collections = await Promise.all((ufs || []).map(async (sigla) => {
    const baseGeo = await loadGeneralStateBaseFromGpkg2006(sigla);
    return filterGeneralFeatures2006(baseGeo, resultKeys, looseIndex);
  }));

  const features = collections.flatMap((collection) => collection.features || []);
  if (!features.length) {
    throw new Error('Nenhum local do GPKG 2006 bateu com os resultados JSON.');
  }

  return { type: 'FeatureCollection', features };
}

// Suplemento da RM de Sao Paulo para 1998 e 2002, gerado por
// scripts/gerar_suplemento_rmsp.py a partir dos dados do CEM (Centro de Estudos da
// Metropole), casados com os resultados do TSE pela assinatura de votos.
//
// Por que existe: 1998 e 2002 nao tem malha propria e tomam emprestada a de 2006.
// Como o zoneamento mudou, urna antiga sem par em 2006 fica sem ponto -- em 2002 na
// RMSP eram 573 de 2.581 (só na capital, 386). O suplemento devolve a coordenada
// medida no ano da eleicao.
let RMSP_SUPLEMENTO_PROMISE = null;

async function loadRmspSupplement() {
  if (!RMSP_SUPLEMENTO_PROMISE) {
    RMSP_SUPLEMENTO_PROMISE = fetchJsonFromZipEntry(
      `${DATA_BASE_URL}locais_suplemento_rmsp.zip`, 'locais_suplemento_rmsp.json'
    ).then(({ data }) => data).catch(() => ({}));
  }
  return RMSP_SUPLEMENTO_PROMISE;
}

// Sobrepoe o suplemento na base emprestada de 2006. Duas situacoes:
//   - chave ja desenhada: troca SO a coordenada (o nome segue o da malha de 2006);
//   - chave sem ponto: cria a feature, e ai nome/endereco/bairro vem do CEM, unica
//     fonte que existe para ela.
// As chaves que o suplemento nao cobre ficam exatamente como estavam.
async function applyRmspSupplement(geojson, ano, resultKeys) {
  const supl = (await loadRmspSupplement())?.[String(ano)]?.locais;
  if (!supl || !geojson?.features) return geojson;

  const chaves = resultKeys instanceof Set ? resultKeys : new Set(resultKeys || []);
  const jaTem = new Set();
  geojson.features.forEach((f) => {
    const props = f.properties || {};
    const key = String(props.id_unico || props.local_key || '');
    const reg = supl[key];
    if (!reg) return;
    jaTem.add(key);
    f.geometry = { type: 'Point', coordinates: [reg.long, reg.lat] };
    props.long = reg.long;
    props.lat = reg.lat;
    if (reg.hist_id != null) props.hist_id = reg.hist_id;
  });

  let novas = 0;
  Object.entries(supl).forEach(([key, reg]) => {
    if (jaTem.has(key) || !chaves.has(key)) return;
    const partes = key.split('_');
    const zona = parseInt(partes[0], 10);
    const local = parseInt(partes[2], 10);
    geojson.features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [reg.long, reg.lat] },
      properties: {
        local_id: `${zona}_${local}`,
        id_unico: key,
        ID_UNICO: key,
        local_key: key,
        ano,
        sg_uf: 'SP',
        cd_localidade_tse: partes[1],
        cod_localidade_ibge: reg.cod_localidade_ibge || null,
        nr_zona: zona,
        nr_locvot: local,
        nm_localidade: reg.nm_localidade || '',
        nm_locvot: reg.nm_locvot || '',
        ds_endereco: reg.ds_endereco || '',
        ds_enderec: reg.ds_endereco || '',
        ds_bairro: reg.ds_bairro || '',
        long: reg.long,
        lat: reg.lat,
        tipo_match: 'CEM (RMSP)',
        hist_id: reg.hist_id != null ? reg.hist_id : null
      }
    });
    novas++;
  });

  console.log(`[${ano}] Suplemento RMSP: ${jaTem.size} coordenadas trocadas, ${novas} locais novos.`);
  return geojson;
}

// 1998 na RMSP tem 2.754 chaves {zona}_{municipio}_S{n} -- voto por SECAO, sem
// local de votacao nenhum, 1.252.081 votos que o mapa nao consegue desenhar e que
// caem inteiros no balde sintetico do municipio (1.779 dessas chaves so na capital,
// contra 953 locais de verdade).
//
// Nao da para saber qual secao pertence a qual predio, e nao e preciso: o CEM ja
// apurou o total POR PREDIO. Entao o par (zona, municipio) e tratado como um todo --
// as estacoes do CEM entram no mapa com os votos que o CEM apurou nelas, e as
// chaves de secao daquele par sao devolvidas como "cobertas" para sairem do balde.
// O gerador so libera um par depois de conferir que
//   soma(estacoes CEM) == soma(chaves S)
// bate exatamente em presidente, governador e senador.
async function applyRmspSecoes1998(geojson, cargo, merged, turnoKey, muniNameMap) {
  const dados = (await loadRmspSupplement())?.['1998'];
  if (!dados?.estacoes?.length || !merged?.RESULTS || !geojson?.features) {
    return new Set();
  }
  const metadata = merged.METADATA?.cand_names || {};
  const porChave = new Map();
  geojson.features.forEach((f) => {
    const k = String(f.properties?.id_unico || f.properties?.local_key || '');
    if (k) porChave.set(k, f);
  });

  let criadas = 0;
  dados.estacoes.forEach((e) => {
    const votos = e.votos?.[cargo]?.[turnoKey];
    if (!votos) return;

    let feature = porChave.get(e.chave);
    if (!feature) {
      const cidade = muniNameMap?.get(String(e.cd_localidade_tse)) || e.nm_localidade || '';
      feature = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [e.long, e.lat] },
        properties: {
          local_id: null,
          id_unico: e.chave,
          ID_UNICO: e.chave,
          local_key: e.chave,
          ano: 1998,
          sg_uf: 'SP',
          cd_localidade_tse: String(e.cd_localidade_tse),
          cod_localidade_ibge: e.cod_localidade_ibge || null,
          nr_zona: e.nr_zona,
          nr_locvot: null,
          nm_localidade: cidade,
          nm_locvot: e.nm_locvot || '',
          ds_endereco: e.ds_endereco || '',
          ds_enderec: e.ds_endereco || '',
          ds_bairro: e.ds_bairro || '',
          long: e.long,
          lat: e.lat,
          tipo_match: 'CEM (RMSP, secoes)',
          hist_id: e.hist_id != null ? e.hist_id : null
        }
      };
      geojson.features.push(feature);
      porChave.set(e.chave, feature);
      criadas++;
    }

    const props = feature.properties;
    applyTurnMetricsFromJsonVotes(props, votos, turnoKey, false);
    Object.entries(votos).forEach(([candidateId, rawVotes]) => {
      if (candidateId === '95' || candidateId === '96') return;
      const meta = metadata[candidateId];
      if (!meta) return;
      const nome = meta[0] || `Candidato ${candidateId}`;
      const partido = meta[1] || '?';
      const status = meta[2] || 'N/D';
      props[`${nome} (${partido}) (${status}) ${turnoKey}`] = ensureNumber(rawVotes);
    });
  });

  const cobertas = new Set(dados.secoes_cobertas || []);
  if (criadas) {
    console.log(`[1998] Secoes sem local: ${criadas} estacoes do CEM, `
      + `${cobertas.size} chaves de secao saem do balde sintetico.`);
  }
  return cobertas;
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

  // Build muniNameMap from census-enriched base geo (cached, no extra network cost).
  // Features with census match have local_key = {zona}_{cdMuni}_{local}.
  // Also use matched dots (id_unico = result key) to maximize coverage.
  const baseGeos = await Promise.all(ufs.map((s) => loadGeneralStateBaseFromGpkg2006(s).catch(() => null)));
  const muniNameMap = new Map();
  // Codigo TSE do municipio -> codigo IBGE (CD_MUN), por voto de maioria entre os
  // locais daquele municipio. Permite casar o poligono da malha por codigo (e nao
  // so por nome), corrigindo municipios cuja grafia diverge entre GPKG/censo e a
  // malha municipal (que ficavam "sem votos" so em 2006).
  const muniIbgeVotes = new Map(); // cdMuni(TSE) -> Map(ibge -> contagem)
  const tallyIbge = (resultKey, ibgeRaw) => {
    const cdMuni = extractMunicipioCodeFromGeneralResultKey(resultKey);
    const ibge = String(ibgeRaw || '').trim();
    if (!cdMuni || !ibge) return;
    let votes = muniIbgeVotes.get(cdMuni);
    if (!votes) { votes = new Map(); muniIbgeVotes.set(cdMuni, votes); }
    votes.set(ibge, (votes.get(ibge) || 0) + 1);
  };
  baseGeos.forEach((baseGeo) => {
    (baseGeo?.features || []).forEach((f) => {
      const props = f.properties || {};
      const localKey = String(props.local_key || '');
      const cdMuni = extractMunicipioCodeFromGeneralResultKey(localKey);
      const cityName = String(props.nm_localidade || '').trim();
      if (cdMuni && cityName && !muniNameMap.has(cdMuni)) muniNameMap.set(cdMuni, cityName);
      tallyIbge(localKey, props.cod_localidade_ibge);
    });
  });
  geojson.features.forEach((f) => {
    const props = f.properties || {};
    const idUnico = String(props.id_unico || '');
    const cdMuni = extractMunicipioCodeFromGeneralResultKey(idUnico);
    const cityName = String(props.nm_localidade || '').trim();
    if (cdMuni && cityName && !muniNameMap.has(cdMuni)) muniNameMap.set(cdMuni, cityName);
    tallyIbge(idUnico, props.cod_localidade_ibge);
  });
  const muniIbgeMap = new Map();
  muniIbgeVotes.forEach((votes, cdMuni) => {
    let bestIbge = '', bestCount = -1;
    votes.forEach((count, ibge) => { if (count > bestCount) { bestCount = count; bestIbge = ibge; } });
    if (bestIbge) muniIbgeMap.set(cdMuni, bestIbge);
  });

  const officialCityTotals = {
    '1T': buildGeneralCityTotals2002(mergedTurno1, '1T', muniNameMap, muniIbgeMap),
    ...(mergedTurno2 ? { '2T': buildGeneralCityTotals2002(mergedTurno2, '2T', muniNameMap, muniIbgeMap) } : {})
  };
  await adjustEmancCityTotals(2006, cargo, ufs, muniNameMap, officialCityTotals,
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

      // Reatribui locais de cidades que ainda nao existiam em 2006 (distritos do pai).
      if (window.EMANC) {
        await window.EMANC.ensureLoaded();
        window.EMANC.apply(2006, { resultsObjects: [results] });
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

    if (window.EMANC) {
      await window.EMANC.ensureLoaded();
      window.EMANC.apply(2006, { features: baseGeo.features });
    }

    if (shouldReloadBaseState || !currentDataCollection['deputado_federal']) {
      uniqueCidades.clear();
      uniqueBairros.clear();
    }

    baseGeo.features.forEach((feature) => {
      const props = feature.properties || {};
      if (typeof registerCityCodeAndName === 'function') registerCityCodeAndName(props);
      else {
        const city = getProp(props, 'nm_localidade');
        if (city) uniqueCidades.add(city);
      }
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
