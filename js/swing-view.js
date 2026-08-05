/* ============================================================================
 * VISAO DE SWING
 *
 * Compara DUAS candidaturas majoritarias de anos diferentes no mesmo cargo e
 * pinta o mapa pela variacao (swing) da participacao percentual entre elas:
 * verde para swing positivo, vermelho para negativo, com a intensidade da cor
 * saindo da MESMA funcao de gradiente que o modo normal usa para margens
 * (getUniversalGradientColor).
 *
 * Por que um modulo separado e nao um "terceiro modo" dentro de map-render:
 * o pipeline normal carrega UMA eleicao (currentDataCollection + STATE.candidates
 * + summaries) e o mapa inteiro le desse estado. Swing precisa de duas eleicoes
 * simultaneas, entao ele monta a propria estrutura a partir dos arquivos brutos
 * do acervo e desenha a propria camada. O modo normal continua intocado — quem
 * decide quem manda no mapa e SWING.enabled, checado no topo das rotinas de
 * desenho do pipeline antigo.
 *
 * ---------------------------------------------------------------------------
 * CHAVE DOS RESULTADOS
 * Todo arquivo do acervo majoritario tem RESULTS chaveado por
 *   "{zona}_{cd_municipio_tse}_{nr_locvot}"      (ex.: "1_1023_1015")
 * e, em 1989/1994 (que nao tem local de votacao), por
 *   "{zona}_{cd_municipio_tse}_M"
 *
 * Disso sai TODA a hierarquia sem precisar de mais nenhum arquivo:
 *   local     -> "{muni}|{local}"   (soma as zonas: um mesmo predio pode
 *                                    atender duas zonas no mesmo ano, e zona
 *                                    e renumerada entre eleicoes — o par
 *                                    (municipio, local) e que e a identidade
 *                                    estavel do local de votacao)
 *   municipio -> cd_municipio_tse   -> IBGE7 pela ponte TSE_TO_IBGE
 *   regiao    -> IBGE7              -> REGION_INDEX.muni[ibge7][nivel]
 *   estado    -> a propria UF do arquivo
 * ========================================================================== */

// Bases do gradiente divergente. Saturacao deliberadamente media (~40%): como
// getUniversalGradientColor mexe SO na luminosidade, uma base muito saturada
// vira neon justamente na ponta de swing baixo — que e onde o mapa precisa
// parecer neutro. Com estas, |swing| 0 sai #5eb886/#ca848d e 60 sai
// #234f37/#78333c, uma rampa legivel sobre o basemap claro e o escuro.
const SWING_POS_COLOR = '#3f8f63'; // swing a favor do candidato B (verde)
const SWING_NEG_COLOR = '#b5525f'; // swing contra (vermelho)
const SWING_NO_DATA_COLOR = '#8a8a8a';

const SWING_OFFICE_LABEL = {
  presidente: 'Presidente',
  governador: 'Governador',
  senador: 'Senador',
  prefeito: 'Prefeito'
};

// Anos com acervo majoritario. 1989 so teve presidencial.
const SWING_OFFICE_YEARS = {
  presidente: ['2022', '2018', '2014', '2010', '2006', '2002', '1998', '1994', '1989'],
  governador: ['2022', '2018', '2014', '2010', '2006', '2002', '1998', '1994'],
  senador: ['2022', '2018', '2014', '2010', '2006', '2002', '1998', '1994'],
  prefeito: ['2024', '2020', '2016', '2012', '2008', '2004', '2000']
};

// 1989/1994 agregam por MUNICIPIO na origem: nao ha o que comparar por local.
const SWING_MUNI_ONLY_YEARS = new Set(['1989', '1994']);

// Anos em que existe GPKG com a geolocalizacao dos locais de votacao.
const SWING_GEOMETRY_YEARS = new Set([
  '2006', '2010', '2014', '2018', '2022',      // gerais
  '2008', '2012', '2016', '2020', '2024'       // municipais
]);

const SWING_LEVEL_LABEL = {
  uf: 'Estados',
  municipios: 'Municípios',
  rgint: 'Regiões Intermediárias',
  rgi: 'Regiões Imediatas',
  meso: 'Mesorregiões',
  micro: 'Microrregiões',
  locais: 'Locais de Votação'
};

const SWING_LEVEL_SHORT = {
  uf: 'Estados',
  municipios: 'Municípios',
  rgint: 'Intermediárias',
  rgi: 'Imediatas',
  meso: 'Meso',
  micro: 'Micro',
  locais: 'Locais'
};

const SWING = {
  enabled: false,
  office: 'presidente',
  subtype: 'ord',
  scope: 'BR',          // 'BR' ou sigla da UF
  municipio: '',        // nome do municipio (apenas prefeito)
  level: 'uf',
  A: { year: '2018', turno: 1, candId: '', meta: null, cands: [] },
  B: { year: '2022', turno: 1, candId: '', meta: null, cands: [] },
  dataset: null,        // agregados das duas eleicoes (ver buildSwingDataset)
  rows: null,           // Map<chave do nivel atual, linha de swing>
  layer: null,
  generation: 0,
  loading: false,
  selectedKey: null
};

const SWING_PAYLOAD_CACHE = new Map();
const SWING_META_CACHE = new Map();
const SWING_POLYGON_CACHE = new Map();

/* ==========================================================================
 * 1. ACESSO AO ACERVO
 * ========================================================================== */

function swingIsMunicipalOffice(office = SWING.office) {
  return office === 'prefeito';
}

function swingArchiveCandidates(office, year, subtype, turno, uf) {
  const ufNorm = String(uf || '').toUpperCase();
  if (swingIsMunicipalOffice(office)) {
    const sub = subtype === 'sup' ? 'sup' : 'ord';
    return [{
      zip: `${DATA_BASE_URL}Municipais ${year}/prefeito_${year}_${sub}_t${turno}_${ufNorm}.zip`,
      entry: null
    }];
  }
  // buildNationalArchiveBasenames (national-view.js) ja conhece as tres
  // convencoes de nome que existem no acervo majoritario.
  return buildNationalArchiveBasenames(year, office, ufNorm, turno, subtype)
    .map((basename) => ({
      zip: `${DATA_BASE_URL}Majoritarias ${year}/${basename}.zip`,
      entry: `${basename}.json`
    }));
}

// Matcher da entrada de UM municipio dentro do zip de prefeito da UF.
// As entradas se chamam "{cd_municipio}_{NOME_SEM_ACENTO}.json".
function swingMunicipioEntryMatcher(municipio) {
  const aliases = typeof getMunicipioAliasSlugs === 'function'
    ? getMunicipioAliasSlugs(municipio)
    : [normalizeMunicipioSlug(municipio)];

  return (entryName) => {
    const base = String(entryName || '').split('/').pop().replace(/\.json$/i, '');
    if (/_resumo$/i.test(base)) return false;
    const cut = base.indexOf('_');
    if (cut < 0) return false;
    return aliases.includes(normalizeMunicipioSlug(base.slice(cut + 1)));
  };
}

// { METADATA, RESULTS } de uma (eleicao, UF) — ou de um municipio, no prefeito.
async function loadSwingPayload(office, year, subtype, turno, uf, municipio = '') {
  const cacheKey = [office, year, subtype, turno, uf, normalizeMunicipioSlug(municipio)].join('|');
  if (SWING_PAYLOAD_CACHE.has(cacheKey)) return SWING_PAYLOAD_CACHE.get(cacheKey);

  const promise = (async () => {
    const targets = swingArchiveCandidates(office, year, subtype, turno, uf);
    const matcher = swingIsMunicipalOffice(office) ? swingMunicipioEntryMatcher(municipio) : null;

    for (const target of targets) {
      try {
        const { data } = await fetchJsonFromZipEntryRanged(target.zip, target.entry, matcher);
        if (data?.RESULTS && Object.keys(data.RESULTS).length) return data;
      } catch (error) {
        // Padrao de nome inexistente para este ano/UF: tenta o proximo.
      }
    }
    return null;
  })();

  SWING_PAYLOAD_CACHE.set(cacheKey, promise);
  promise.then((data) => {
    if (!data && SWING_PAYLOAD_CACHE.get(cacheKey) === promise) SWING_PAYLOAD_CACHE.delete(cacheKey);
  }).catch(() => {
    if (SWING_PAYLOAD_CACHE.get(cacheKey) === promise) SWING_PAYLOAD_CACHE.delete(cacheKey);
  });
  return promise;
}

// { METADATA, TOTALS } de uma UF, sem baixar o zip inteiro.
//
// O swing carrega DUAS eleicoes, entao o custo de rede dobra em relacao a visao
// nacional: aqui vale ir pelo leitor por Range, que le so o diretorio central
// do zip e os bytes do *_resumo.json (~3 KB) em vez do arquivo completo.
// fetchNationalUfResumo continua sendo o fallback — e ele que sabe reconstruir
// o TOTALS somando o RESULTS nos anos ate 2002, que nao tem resumo no acervo.
const SWING_TOTALS_CACHE = new Map();

async function loadSwingUfTotals(office, year, subtype, turno, uf) {
  const cacheKey = [office, year, subtype, turno, uf].join('|');
  if (SWING_TOTALS_CACHE.has(cacheKey)) return SWING_TOTALS_CACHE.get(cacheKey);

  const promise = (async () => {
    for (const basename of buildNationalArchiveBasenames(year, office, uf, turno, subtype)) {
      try {
        const { data } = await fetchJsonFromZipEntryRanged(
          `${DATA_BASE_URL}Majoritarias ${year}/${basename}.zip`,
          `${basename}_resumo.json`
        );
        if (data?.TOTALS && Object.keys(data.TOTALS).length) return data;
      } catch (error) {
        // Sem resumo neste padrao/UF/turno: tenta o proximo.
      }
    }
    const found = await fetchNationalUfResumo(year, office, uf, turno, subtype);
    return found?.data || null;
  })();

  SWING_TOTALS_CACHE.set(cacheKey, promise);
  promise.then((data) => {
    if (!data && SWING_TOTALS_CACHE.get(cacheKey) === promise) SWING_TOTALS_CACHE.delete(cacheKey);
  }).catch(() => {
    if (SWING_TOTALS_CACHE.get(cacheKey) === promise) SWING_TOTALS_CACHE.delete(cacheKey);
  });
  return promise;
}

// Lista de candidatos de uma eleicao, para o dropdown. Le o *_resumo.json
// (poucos KB) quando ele existe; so cai no JSON completo se nao existir.
async function loadSwingCandidateList(office, year, subtype, turno, uf, municipio = '') {
  const cacheKey = [office, year, subtype, turno, uf, normalizeMunicipioSlug(municipio)].join('|');
  if (SWING_META_CACHE.has(cacheKey)) return SWING_META_CACHE.get(cacheKey);

  const promise = (async () => {
    let metadata = null;
    let totals = null;

    if (swingIsMunicipalOffice(office)) {
      const payload = await loadSwingPayload(office, year, subtype, turno, uf, municipio);
      metadata = payload?.METADATA?.cand_names || null;
      totals = payload ? aggregateSwingResults(payload.RESULTS) : null;
    } else {
      const data = await loadSwingUfTotals(office, year, subtype, turno, uf);
      metadata = data?.METADATA?.cand_names || null;
      totals = data?.TOTALS || null;
    }

    if (!metadata) return [];

    const list = Object.entries(metadata)
      .filter(([id]) => id !== '95' && id !== '96')
      .map(([id, meta]) => ({
        id,
        nome: meta?.[0] || `Candidato ${id}`,
        partido: meta?.[1] || '?',
        status: meta?.[2] || 'N/D',
        votos: ensureNumber(totals?.[id])
      }))
      .sort((a, b) => (b.votos - a.votos) || a.nome.localeCompare(b.nome, 'pt-BR'));

    return list;
  })();

  SWING_META_CACHE.set(cacheKey, promise);
  promise.catch(() => {
    if (SWING_META_CACHE.get(cacheKey) === promise) SWING_META_CACHE.delete(cacheKey);
  });
  return promise;
}

function aggregateSwingResults(results) {
  const totals = {};
  Object.values(results || {}).forEach((voteMap) => {
    Object.entries(voteMap || {}).forEach(([id, votes]) => {
      totals[id] = (totals[id] || 0) + ensureNumber(votes);
    });
  });
  return totals;
}

/* ==========================================================================
 * 2. AGREGACAO
 * ========================================================================== */

// "1_1023_1015" -> { muni: '1023', local: '1015' }
function parseSwingResultKey(key) {
  const parts = String(key || '').split('_');
  if (parts.length < 3) return null;
  const muni = String(parts[1] || '').trim();
  if (!/^\d+$/.test(muni)) return null;
  return { muni, local: String(parts[2] || '').trim() };
}

// Percorre o RESULTS de UMA eleicao e devolve os votos do candidato escolhido
// e o total de votos validos, ja agrupados por local, municipio e UF.
function buildSwingSideAggregates(payloadsByUf, candId) {
  const byStation = new Map();
  const byMuni = new Map();
  const byUf = new Map();

  const bump = (store, key, cand, total) => {
    if (!key) return;
    let entry = store.get(key);
    if (!entry) {
      entry = { cand: 0, total: 0 };
      store.set(key, entry);
    }
    entry.cand += cand;
    entry.total += total;
  };

  Object.entries(payloadsByUf || {}).forEach(([uf, payload]) => {
    Object.entries(payload?.RESULTS || {}).forEach(([resultKey, voteMap]) => {
      const parsed = parseSwingResultKey(resultKey);
      if (!parsed) return;

      let total = 0;
      Object.entries(voteMap || {}).forEach(([id, votes]) => {
        if (id === '95' || id === '96') return; // brancos e nulos fora do valido
        total += ensureNumber(votes);
      });
      const cand = ensureNumber(voteMap?.[candId]);

      bump(byStation, `${parsed.muni}|${parsed.local}`, cand, total);
      bump(byMuni, parsed.muni, cand, total);
      bump(byUf, String(uf).toUpperCase(), cand, total);
    });
  });

  return { byStation, byMuni, byUf };
}

// Versao para o escopo nacional, onde so temos os TOTALS por UF (resumo).
function buildSwingSideAggregatesFromTotals(totalsByUf, candId) {
  const byUf = new Map();
  Object.entries(totalsByUf || {}).forEach(([uf, totals]) => {
    let total = 0;
    Object.entries(totals || {}).forEach(([id, votes]) => {
      if (id === '95' || id === '96') return;
      total += ensureNumber(votes);
    });
    byUf.set(String(uf).toUpperCase(), { cand: ensureNumber(totals?.[candId]), total });
  });
  return { byStation: new Map(), byMuni: new Map(), byUf };
}

// Rollup de municipio -> regiao, usando a ponte TSE->IBGE e o indice do IBGE.
function rollupSwingByRegion(byMuni, level) {
  const out = new Map();
  byMuni.forEach((entry, muniTse) => {
    const ibge = TSE_TO_IBGE.get(String(muniTse));
    if (!ibge) return;
    const regionCode = REGION_INDEX.muni?.[ibge]?.[level];
    if (!regionCode) return;
    let acc = out.get(regionCode);
    if (!acc) {
      acc = { cand: 0, total: 0 };
      out.set(regionCode, acc);
    }
    acc.cand += entry.cand;
    acc.total += entry.total;
  });
  return out;
}

function swingPct(entry) {
  if (!entry || !(entry.total > 0)) return null;
  return (entry.cand / entry.total) * 100;
}

// Cruza os dois lados num unico Map de linhas. So entram chaves presentes nas
// DUAS eleicoes com voto valido — e isso que garante, no nivel de locais, que
// so aparecem os locais de votacao que existiam nas duas.
function joinSwingSides(mapA, mapB) {
  const rows = new Map();
  mapB.forEach((entryB, key) => {
    const entryA = mapA.get(key);
    if (!entryA) return;
    const pctA = swingPct(entryA);
    const pctB = swingPct(entryB);
    if (pctA === null || pctB === null) return;
    rows.set(key, {
      key,
      a: { votes: entryA.cand, total: entryA.total, pct: pctA },
      b: { votes: entryB.cand, total: entryB.total, pct: pctB },
      swing: pctB - pctA
    });
  });
  return rows;
}

function swingRowsForLevel(level) {
  const dataset = SWING.dataset;
  if (!dataset) return new Map();

  if (level === 'uf') return joinSwingSides(dataset.A.byUf, dataset.B.byUf);
  if (level === 'locais') return joinSwingSides(dataset.A.byStation, dataset.B.byStation);
  if (level === 'municipios') return joinSwingSides(dataset.A.byMuni, dataset.B.byMuni);
  return joinSwingSides(
    rollupSwingByRegion(dataset.A.byMuni, level),
    rollupSwingByRegion(dataset.B.byMuni, level)
  );
}

// Agregado do recorte inteiro (o que o painel mostra quando nada esta clicado).
// Soma pelo nivel MUNICIPAL (ou por UF no escopo nacional) para nao depender do
// nivel de desenho escolhido.
function swingScopeTotals() {
  const dataset = SWING.dataset;
  if (!dataset) return null;

  const source = SWING.scope === 'BR' ? 'byUf' : (dataset.A.byMuni.size ? 'byMuni' : 'byUf');
  const acc = { a: { votes: 0, total: 0 }, b: { votes: 0, total: 0 } };

  dataset.A[source].forEach((entry) => { acc.a.votes += entry.cand; acc.a.total += entry.total; });
  dataset.B[source].forEach((entry) => { acc.b.votes += entry.cand; acc.b.total += entry.total; });

  if (!(acc.a.total > 0) || !(acc.b.total > 0)) return null;
  const pctA = (acc.a.votes / acc.a.total) * 100;
  const pctB = (acc.b.votes / acc.b.total) * 100;
  return {
    key: '__scope__',
    a: { ...acc.a, pct: pctA },
    b: { ...acc.b, pct: pctB },
    swing: pctB - pctA
  };
}

/* ==========================================================================
 * 3. CARGA DO CONJUNTO
 * ========================================================================== */

function swingScopeUfs() {
  if (SWING.scope === 'BR') return ALL_STATE_SIGLAS.slice();
  return [String(SWING.scope).toUpperCase()];
}

async function loadSwingSide(side, onProgress) {
  const cfg = SWING[side];
  const office = SWING.office;
  const subtype = SWING.subtype;
  const ufs = swingScopeUfs();

  // Escopo nacional: o resumo por UF (poucos KB cada) basta para o nivel de
  // estados, que e o unico nivel que faz sentido desenhar no pais inteiro.
  // Baixar o JSON completo das 27 UFs so para somar por estado seria dezenas
  // de MB por eleicao — e sao duas.
  if (SWING.scope === 'BR') {
    const totalsByUf = {};
    let done = 0;
    await Promise.all(ufs.map(async (uf) => {
      try {
        const data = await loadSwingUfTotals(office, cfg.year, subtype, cfg.turno, uf);
        if (data?.TOTALS) totalsByUf[uf] = data.TOTALS;
      } catch (error) {
        // UF sem aquele turno: fica de fora do agregado.
      }
      done += 1;
      if (onProgress) onProgress(done / ufs.length);
    }));
    if (!Object.keys(totalsByUf).length) {
      throw new Error(`Sem dados de ${SWING_OFFICE_LABEL[office]} em ${cfg.year} (${cfg.turno}º turno).`);
    }
    return buildSwingSideAggregatesFromTotals(totalsByUf, cfg.candId);
  }

  const payloadsByUf = {};
  let done = 0;
  await Promise.all(ufs.map(async (uf) => {
    const payload = await loadSwingPayload(office, cfg.year, subtype, cfg.turno, uf, SWING.municipio);
    if (payload) payloadsByUf[uf] = payload;
    done += 1;
    if (onProgress) onProgress(done / ufs.length);
  }));

  if (!Object.keys(payloadsByUf).length) {
    throw new Error(`Sem dados de ${SWING_OFFICE_LABEL[office]} em ${cfg.year} (${cfg.turno}º turno).`);
  }
  return buildSwingSideAggregates(payloadsByUf, cfg.candId);
}

async function buildSwingDataset() {
  await Promise.all([
    ensureRegionalFiltersLoaded().catch(() => null),
    ensureTseIbgeLoaded().catch(() => null)
  ]);

  const progress = { A: 0, B: 0 };
  const report = () => {
    const pct = Math.round(((progress.A + progress.B) / 2) * 100);
    updateMapLoading(null, pct);
  };

  const [aggA, aggB] = await Promise.all([
    loadSwingSide('A', (p) => { progress.A = p; report(); }),
    loadSwingSide('B', (p) => { progress.B = p; report(); })
  ]);

  return { A: aggA, B: aggB };
}

/* ==========================================================================
 * 4. GEOMETRIA
 * ========================================================================== */

// Malha municipal ATUAL, sempre. O modo normal troca para a malha historica em
// 1989/1994, mas aqui as duas pontas do swing podem ser de epocas diferentes:
// a unica malha em que as duas cabem e a vigente, que e tambem a que o indice
// de regioes do IBGE descreve.
async function fetchSwingMunicipalPolygons(uf) {
  const ufNorm = String(uf || '').toUpperCase();
  const cacheKey = `muni|${ufNorm}`;
  if (SWING_POLYGON_CACHE.has(cacheKey)) return SWING_POLYGON_CACHE.get(cacheKey);

  const promise = (async () => {
    const urls = [
      `${DATA_BASE_URL}municipios_hd/municipios_${ufNorm}.geojson`,
      `${DATA_BASE_URL}municipios/municipios_${ufNorm}.geojson`
    ];
    for (const url of urls) {
      try {
        const response = await fetch(url);
        if (response.ok) return response.json();
      } catch (error) {
        // tenta a proxima malha
      }
    }
    throw new Error(`Geometria municipal não encontrada para ${ufNorm}.`);
  })();

  SWING_POLYGON_CACHE.set(cacheKey, promise);
  promise.catch(() => {
    if (SWING_POLYGON_CACHE.get(cacheKey) === promise) SWING_POLYGON_CACHE.delete(cacheKey);
  });
  return promise;
}

// Base geolocalizada dos locais de votacao de um ano, se existir GPKG dele.
async function loadSwingStationBase(side, uf) {
  const y = String(SWING[side].year);
  const ufNorm = String(uf || '').toUpperCase();

  const generalLoaders = {
    '2022': typeof loadGeneralStateBaseFromGpkg2022 === 'function' ? loadGeneralStateBaseFromGpkg2022 : null,
    '2018': typeof loadGeneralStateBaseFromGpkg2018 === 'function' ? loadGeneralStateBaseFromGpkg2018 : null,
    '2014': typeof loadGeneralStateBaseFromGpkg2014 === 'function' ? loadGeneralStateBaseFromGpkg2014 : null,
    '2010': typeof loadGeneralStateBaseFromGpkg2010 === 'function' ? loadGeneralStateBaseFromGpkg2010 : null,
    '2006': typeof loadGeneralStateBaseFromGpkg2006 === 'function' ? loadGeneralStateBaseFromGpkg2006 : null
  };
  const municipalLoaders = {
    '2024': typeof loadMunicipalBaseFromGpkg2024 === 'function' ? loadMunicipalBaseFromGpkg2024 : null,
    '2020': typeof loadMunicipalBaseFromGpkg2020 === 'function' ? loadMunicipalBaseFromGpkg2020 : null,
    '2016': typeof loadMunicipalBaseFromGpkg2016 === 'function' ? loadMunicipalBaseFromGpkg2016 : null,
    '2012': typeof loadMunicipalBaseFromGpkg2012 === 'function' ? loadMunicipalBaseFromGpkg2012 : null,
    '2008': typeof loadMunicipalBaseFromGpkg2008 === 'function' ? loadMunicipalBaseFromGpkg2008 : null
  };

  if (swingIsMunicipalOffice()) {
    const loader = municipalLoaders[y];
    if (!loader) return null;
    // O loader municipal filtra pelas chaves que a gente passar; como o join do
    // swing e por (municipio, local), passamos TODAS as chaves do ano e
    // deixamos o cruzamento para depois.
    const payload = await loadSwingPayload(
      'prefeito', y, SWING.subtype, SWING[side].turno, ufNorm, SWING.municipio
    );
    const keys = new Set(Object.keys(payload?.RESULTS || {}));
    if (!keys.size) return null;
    const muniCode = String(payload?.METADATA?.cd_municipio || '').trim();
    return loader(ufNorm, SWING.municipio, muniCode, keys, 'prefeito');
  }

  const loader = generalLoaders[y];
  if (!loader) return null;
  return loader(ufNorm);
}

// Chave "{muni}|{local}" de uma feature de local de votacao.
function swingStationKeyFromProps(props) {
  if (!props) return '';
  const fullKey = String(props.id_unico || props.local_key || props.ID_UNICO || '');
  const parsed = parseSwingResultKey(fullKey);
  if (parsed) return `${parsed.muni}|${parsed.local}`;

  const muni = String(props.cd_localidade_tse || '').trim();
  const local = String(props.nr_locvot ?? '').trim();
  if (muni && local) return `${muni}|${parseInt(local, 10)}`;
  return '';
}

async function buildSwingStationFeatures(rows) {
  const uf = String(SWING.scope).toUpperCase();
  // Prefere a geometria do ano mais RECENTE do par (nao necessariamente o lado
  // B: nada impede o usuario de por a eleicao mais nova em A). Alem de ser a
  // malha mais completa, e a que descreve o local como ele esta hoje.
  const sides = ['A', 'B']
    .filter((side) => SWING_GEOMETRY_YEARS.has(String(SWING[side].year)))
    .sort((s1, s2) => Number(SWING[s2].year) - Number(SWING[s1].year));

  const seen = new Set();
  const features = [];

  for (const side of sides) {
    let base = null;
    try {
      base = await loadSwingStationBase(side, uf);
    } catch (error) {
      console.warn(`[Swing] Geometria de locais de ${SWING[side].year} indisponível:`, error);
    }
    if (!base?.features?.length) continue;

    base.features.forEach((feature) => {
      if (!feature?.geometry) return;
      const key = swingStationKeyFromProps(feature.properties);
      if (!key || seen.has(key) || !rows.has(key)) return;
      seen.add(key);
      features.push({
        type: 'Feature',
        geometry: {
          type: feature.geometry.type,
          coordinates: Array.isArray(feature.geometry.coordinates)
            ? [...feature.geometry.coordinates]
            : feature.geometry.coordinates
        },
        properties: { ...(feature.properties || {}), __swingKey: key }
      });
    });

    // A malha do ano mais novo ja cobriu tudo o que havia para cobrir.
    if (features.length >= rows.size) break;
  }

  return features;
}

/* ==========================================================================
 * 5. CORES E ROTULOS
 * ========================================================================== */

// Mesma logica de intensidade das margens do modo normal: a magnitude do swing
// entra em getUniversalGradientColor, que clareia abaixo de 20 p.p. e escurece
// acima. So o matiz muda — verde no swing positivo, vermelho no negativo.
function swingColor(swingValue) {
  const base = swingValue >= 0 ? SWING_POS_COLOR : SWING_NEG_COLOR;
  return getUniversalGradientColor(base, Math.abs(ensureNumber(swingValue)));
}

function fmtSwing(value) {
  const n = ensureNumber(value);
  const sign = n > 0 ? '+' : (n < 0 ? '−' : '');
  return `${sign}${Math.abs(n).toFixed(1).replace('.', ',')} p.p.`;
}

function fmtPct(value) {
  return `${ensureNumber(value).toFixed(1).replace('.', ',')}%`;
}

function swingCandidateLabel(side) {
  const cfg = SWING[side];
  const cand = (cfg.cands || []).find((c) => c.id === cfg.candId);
  if (!cand) return `Candidato ${cfg.candId || '?'}`;
  return `${toTitleCase(cand.nome)} (${cand.partido})`;
}

function swingCandidateColor(side) {
  const cfg = SWING[side];
  const cand = (cfg.cands || []).find((c) => c.id === cfg.candId);
  if (!cand) return SWING_NO_DATA_COLOR;
  return getColorForCandidate(cand.nome, cand.partido);
}

// Nome legivel da unidade territorial de uma linha, conforme o nivel.
function swingRowLabel(key, props) {
  if (SWING.level === 'uf') return UF_MAP.get(key) || key;
  if (SWING.level === 'municipios') {
    const ibge = TSE_TO_IBGE.get(String(key));
    const nome = ibge ? STATE.muniCodeToNameMap?.get(String(ibge)) : null;
    return nome || String(props?.NM_MUN || props?.nm_mun || key);
  }
  if (SWING.level === 'locais') {
    const nome = props?.nm_locvot ? safeToTitleCase(props.nm_locvot) : `Local ${String(key).split('|')[1] || ''}`;
    return nome;
  }
  return getRegionalEntryLabel(SWING.level, key, SWING.scope) || String(key);
}

function swingRowSubtitle(key, props) {
  if (SWING.level === 'locais') {
    const cidade = props?.nm_localidade ? toTitleCase(props.nm_localidade) : '';
    const bairro = props?.ds_bairro ? toTitleCase(props.ds_bairro) : '';
    return [bairro, cidade].filter(Boolean).join(' • ');
  }
  if (SWING.level === 'municipios') return UF_MAP.get(SWING.scope) || SWING.scope;
  if (SWING.level === 'uf') return 'Brasil';
  return `${SWING_LEVEL_LABEL[SWING.level]} • ${UF_MAP.get(SWING.scope) || SWING.scope}`;
}

/* ==========================================================================
 * 6. MAPA
 * ========================================================================== */

function swingKeyForFeature(feature) {
  const props = feature?.properties || {};
  if (SWING.level === 'locais') return props.__swingKey || swingStationKeyFromProps(props);
  if (SWING.level === 'uf') return String(props.CD_REG || props.SIGLA_UF || '').toUpperCase();
  if (SWING.level === 'municipios') {
    // As linhas municipais sao chaveadas por codigo TSE; o poligono so tem o
    // IBGE. A ponte e resolvida uma vez por render (ver SWING._ibgeToTse).
    const ibge = String(props.CD_MUN || props.cd_mun || props.CD_GEOCMU || '').trim();
    return SWING._ibgeToTse?.get(ibge) || SWING._ibgeToTse?.get(ibge.slice(0, 7)) || '';
  }
  return String(props.CD_REG || '').trim();
}

function swingFeatureStyle(feature) {
  const isPoint = SWING.level === 'locais';
  const row = SWING.rows?.get(swingKeyForFeature(feature));

  if (!row) {
    return isPoint
      ? { stroke: false, fillColor: SWING_NO_DATA_COLOR, fillOpacity: 0.12, opacity: 1 }
      : { fillColor: SWING_NO_DATA_COLOR, fillOpacity: 0.10, color: '#ffffff', weight: 0.12, opacity: 0.45, height: 0 };
  }

  const color = swingColor(row.swing);
  if (isPoint) {
    const isSelected = SWING.selectedKey && SWING.selectedKey === row.key;
    return {
      stroke: !!isSelected,
      fillColor: isSelected ? 'var(--accent)' : color,
      fillOpacity: 0.85,
      color: '#ffffff',
      weight: isSelected ? 1.6 : 0,
      opacity: 1
    };
  }

  const isSelected = SWING.selectedKey && SWING.selectedKey === row.key;
  return {
    fillColor: color,
    fillOpacity: 0.82,
    color: isSelected ? 'rgba(255,255,255,0.95)' : '#ffffff',
    weight: isSelected ? 1.4 : 0.12,
    opacity: isSelected ? 1 : 0.8,
    height: 0
  };
}

function swingPointRadius() {
  return 6;
}

function buildSwingTooltip(feature) {
  const props = feature?.properties || {};
  const key = swingKeyForFeature(feature);
  const row = SWING.rows?.get(key);
  const titulo = escapeHtml(swingRowLabel(key, props));
  const subtitulo = escapeHtml(swingRowSubtitle(key, props));

  if (!row) {
    return `
      <div class="nyt-tooltip-container swing-tooltip" style="min-width: 230px;">
        <div class="district-nyt-title">${titulo}</div>
        <div class="swing-tooltip-sub">${subtitulo}</div>
        <div class="swing-tooltip-empty">Sem resultado nas duas eleições.</div>
      </div>
    `;
  }

  return `
    <div class="nyt-tooltip-container swing-tooltip" style="min-width: 260px;">
      <div class="district-nyt-title">${titulo}</div>
      <div class="swing-tooltip-sub">${subtitulo}</div>
      ${buildSwingComparisonTable(row)}
      <div class="swing-tooltip-foot">
        Válidos: ${fmtInt(row.a.total)} (${escapeHtml(String(SWING.A.year))}) • ${fmtInt(row.b.total)} (${escapeHtml(String(SWING.B.year))})
      </div>
    </div>
  `;
}

// Tabela usada tanto no tooltip quanto na sidebar direita: os dois candidatos,
// seus resultados e a diferenca entre eles.
function buildSwingComparisonTable(row) {
  const rows = [
    { side: 'A', year: SWING.A.year, data: row.a },
    { side: 'B', year: SWING.B.year, data: row.b }
  ];

  const body = rows.map(({ side, year, data }) => `
    <tr>
      <td style="padding:0;">
        <div class="district-nyt-loser-cell" style="border-left-color: ${swingCandidateColor(side)};">
          <span class="swing-cand-name">${escapeHtml(swingCandidateLabel(side))}</span>
          <span class="swing-cand-year">${escapeHtml(String(year))}</span>
        </div>
      </td>
      <td class="votes-cell">${fmtInt(data.votes)}</td>
      <td class="pct-cell">${fmtPct(data.pct)}</td>
    </tr>
  `).join('');

  const cls = row.swing >= 0 ? 'swing-pos' : 'swing-neg';

  return `
    <table class="district-nyt-table swing-table">
      <thead>
        <tr><th style="text-align:left;">Candidatura</th><th>Votos</th><th>%</th></tr>
      </thead>
      <tbody>${body}</tbody>
      <tfoot>
        <tr class="swing-total-row ${cls}">
          <td style="text-align:left;">Swing</td>
          <td class="votes-cell">${fmtSwing(row.swing)}</td>
          <td class="pct-cell"><span class="swing-chip ${cls}" style="background:${swingColor(row.swing)}"></span></td>
        </tr>
      </tfoot>
    </table>
  `;
}

function clearSwingLayer() {
  if (SWING.layer) {
    try {
      if (map && map.hasLayer(SWING.layer)) map.removeLayer(SWING.layer);
      else if (typeof SWING.layer.remove === 'function') SWING.layer.remove();
    } catch (error) {
      console.warn('[Swing] Falha ao remover camada:', error);
    }
    SWING.layer = null;
  }
}

// Tira do mapa o que o pipeline normal desenhou, para as duas visoes nao se
// sobreporem.
function clearNormalLayers() {
  if (typeof currentLayer !== 'undefined' && currentLayer) {
    try {
      currentLayer.off?.();
      if (map.hasLayer(currentLayer)) map.removeLayer(currentLayer);
    } catch (error) { /* noop */ }
    currentLayer = null;
  }
  if (STATE.municipiosLayer) {
    try {
      if (map.hasLayer(STATE.municipiosLayer)) map.removeLayer(STATE.municipiosLayer);
    } catch (error) { /* noop */ }
    STATE.municipiosLayer = null;
  }
  if (typeof clearNationalDotplotMarkers === 'function') clearNationalDotplotMarkers();
  if (typeof removeNationalLeaderLines === 'function') removeNationalLeaderLines();
}

async function renderSwingMap() {
  const generation = ++SWING.generation;
  const level = SWING.level;

  SWING.rows = swingRowsForLevel(level);

  let features = [];
  let layerType = 'polygon';

  if (level === 'locais') {
    layerType = 'point';
    features = await buildSwingStationFeatures(SWING.rows);
    if (generation !== SWING.generation) return;
    if (!features.length) {
      showToast('Nenhum local de votação com geolocalização coincide nas duas eleições.', 'warning', 5000);
    }
  } else if (level === 'uf') {
    const geojson = await fetchNationalStatesGeoJSON();
    if (generation !== SWING.generation) return;
    features = geojson.features || [];
  } else if (level === 'municipios') {
    // Indice IBGE->TSE montado uma vez por render: o poligono so tem o IBGE e
    // as linhas do swing sao chaveadas pelo codigo TSE do acervo.
    SWING._ibgeToTse = new Map();
    TSE_TO_IBGE.forEach((ibge, tse) => SWING._ibgeToTse.set(String(ibge), String(tse)));
    const geojson = await fetchSwingMunicipalPolygons(SWING.scope);
    if (generation !== SWING.generation) return;
    features = geojson.features || [];
  } else {
    const geojson = await fetchRegionPolygonGeoJSON(level, SWING.scope);
    if (generation !== SWING.generation) return;
    features = geojson?.features || [];
  }

  // Indice chave -> properties: o ranking do painel precisa rotular linhas que
  // nao vieram de um clique, e o nome mora na feature, nao na linha de swing.
  SWING._propsByKey = new Map();
  features.forEach((feature) => {
    const key = swingKeyForFeature(feature);
    if (key && !SWING._propsByKey.has(key)) SWING._propsByKey.set(key, feature.properties || {});
  });

  clearSwingLayer();

  SWING.layer = new MLCompat.GeoLayer(map, {
    id: 'swing',
    type: layerType,
    hover: layerType === 'polygon',
    styleFn: swingFeatureStyle,
    radiusFn: layerType === 'point' ? swingPointRadius : null,
    tooltipFn: buildSwingTooltip,
    sticky: false,
    onClick: (feature) => {
      const key = swingKeyForFeature(feature);
      SWING.selectedKey = (SWING.selectedKey === key) ? null : key;
      SWING.layer?.refresh?.();
      renderSwingPanel(feature);
    }
  });
  SWING.layer.setFeatures(features);
  SWING.layer.addTo(map);

  const bounds = SWING.layer.getBounds?.();
  if (bounds?.isValid?.()) {
    MLCompat.fitMapToBounds(map, bounds, { padding: [20, 20], animate: false });
  }
}

/* ==========================================================================
 * 7. PAINEL DIREITO
 * ========================================================================== */

function swingScopeLabel() {
  if (SWING.office === 'prefeito') {
    return `${toTitleCase(SWING.municipio || '')} (${SWING.scope})`;
  }
  return SWING.scope === 'BR' ? 'Brasil' : (UF_MAP.get(SWING.scope) || SWING.scope);
}

// Ranking dos maiores swings do recorte, para dar leitura ao mapa sem exigir
// clique em cada unidade.
function buildSwingRanking() {
  if (!SWING.rows?.size) return '';

  const entries = Array.from(SWING.rows.values())
    .filter((row) => row.a.total > 0 && row.b.total > 0);
  if (entries.length < 2) return '';

  const labelFor = (row) => swingRowLabel(row.key, SWING._propsByKey?.get(row.key));
  const sorted = entries.slice().sort((a, b) => b.swing - a.swing);
  const top = sorted.slice(0, 5);
  const bottom = sorted.slice(-5).reverse();

  const renderList = (list) => list.map((row) => `
    <li>
      <span class="swing-rank-name">${escapeHtml(labelFor(row))}</span>
      <span class="swing-rank-value ${row.swing >= 0 ? 'swing-pos' : 'swing-neg'}">${fmtSwing(row.swing)}</span>
    </li>
  `).join('');

  return `
    <div class="swing-ranking">
      <div class="swing-ranking-col">
        <h4>Maiores ganhos</h4>
        <ul>${renderList(top)}</ul>
      </div>
      <div class="swing-ranking-col">
        <h4>Maiores perdas</h4>
        <ul>${renderList(bottom)}</ul>
      </div>
    </div>
  `;
}

function renderSwingPanel(feature = null) {
  if (!dom.resultsBox) return;

  dom.resultsBox.classList.remove('section-hidden');
  dom.summaryBoxContainer?.classList.add('section-hidden');
  if (dom.turnTabs) dom.turnTabs.innerHTML = '';
  if (dom.neighborhoodProfile) dom.neighborhoodProfile.style.display = 'none';
  if (dom.btnToggleInaptos) dom.btnToggleInaptos.style.display = 'none';
  if (dom.btnToggleRules) dom.btnToggleRules.style.display = 'none';
  if (dom.btnExplainRules) dom.btnExplainRules.style.display = 'none';

  const props = feature?.properties || null;
  const key = feature ? swingKeyForFeature(feature) : null;
  const row = key ? SWING.rows?.get(key) : null;
  const scopeRow = swingScopeTotals();

  if (!SWING.dataset) {
    dom.resultsTitle.textContent = 'Swing';
    dom.resultsSubtitle.textContent = 'Escolha as duas candidaturas na barra lateral.';
    dom.resultsContent.innerHTML = `
      <div class="swing-empty">
        Selecione o cargo, o recorte e uma candidatura em cada ano para ver a comparação.
      </div>`;
    dom.resultsMetrics.innerHTML = '';
    return;
  }

  const titulo = row ? swingRowLabel(key, props) : swingScopeLabel();
  const subtitulo = row
    ? swingRowSubtitle(key, props)
    : `${SWING_OFFICE_LABEL[SWING.office]} • ${SWING.A.year} → ${SWING.B.year}`;

  dom.resultsTitle.textContent = titulo;
  dom.resultsSubtitle.textContent = subtitulo;

  const active = row || scopeRow;
  if (!active) {
    dom.resultsContent.innerHTML = `
      <div class="swing-empty">Sem votos válidos nas duas eleições para este recorte.</div>`;
    dom.resultsMetrics.innerHTML = '';
    return;
  }

  const cls = active.swing >= 0 ? 'swing-pos' : 'swing-neg';
  const comparativo = row && scopeRow
    ? `<div class="swing-context">Swing no recorte inteiro: <strong class="${scopeRow.swing >= 0 ? 'swing-pos' : 'swing-neg'}">${fmtSwing(scopeRow.swing)}</strong></div>`
    : '';

  dom.resultsContent.innerHTML = `
    <div class="swing-headline ${cls}" style="border-color:${swingColor(active.swing)}">
      <div class="swing-headline-value" style="color:${swingColor(active.swing)}">${fmtSwing(active.swing)}</div>
      <div class="swing-headline-label">
        ${escapeHtml(swingCandidateLabel('B'))} em ${escapeHtml(String(SWING.B.year))}
        vs. ${escapeHtml(swingCandidateLabel('A'))} em ${escapeHtml(String(SWING.A.year))}
      </div>
    </div>
    ${buildSwingComparisonTable(active)}
    ${comparativo}
    ${row ? '' : buildSwingRanking()}
  `;

  const deltaVotos = active.b.votes - active.a.votes;
  dom.resultsMetrics.innerHTML = `
    <div class="swing-metrics">
      <span>Votos ${escapeHtml(String(SWING.A.year))}: <strong>${fmtInt(active.a.votes)}</strong></span>
      <span>Votos ${escapeHtml(String(SWING.B.year))}: <strong>${fmtInt(active.b.votes)}</strong></span>
      <span>Diferença: <strong class="${deltaVotos >= 0 ? 'swing-pos' : 'swing-neg'}">${deltaVotos >= 0 ? '+' : '−'}${fmtInt(Math.abs(deltaVotos))}</strong></span>
      <span>Unidades comparadas: <strong>${fmtInt(SWING.rows?.size || 0)}</strong></span>
    </div>
  `;
}

/* ==========================================================================
 * 8. CONTROLES (SIDEBAR ESQUERDA)
 * ========================================================================== */

const swingDom = {};

function cacheSwingDom() {
  swingDom.box = document.getElementById('swingBox');
  swingDom.officeChips = document.getElementById('swingOfficeChips');
  swingDom.scopeCtrl = document.getElementById('swingScopeCtrl');
  swingDom.selectScope = document.getElementById('swingSelectScope');
  swingDom.muniCtrl = document.getElementById('swingMuniCtrl');
  swingDom.selectMuni = document.getElementById('swingSelectMuni');
  swingDom.searchMuni = document.getElementById('swingSearchMuni');
  swingDom.selectYearA = document.getElementById('swingYearA');
  swingDom.selectYearB = document.getElementById('swingYearB');
  swingDom.turnoChipsA = document.getElementById('swingTurnoA');
  swingDom.turnoChipsB = document.getElementById('swingTurnoB');
  swingDom.selectCandA = document.getElementById('swingCandA');
  swingDom.selectCandB = document.getElementById('swingCandB');
  swingDom.levelChips = document.getElementById('swingLevelChips');
  swingDom.status = document.getElementById('swingStatus');
  swingDom.legend = document.getElementById('swingLegend');
  swingDom.appModeChips = document.getElementById('appModeChips');
}

function populateSwingScopeSelect() {
  if (!swingDom.selectScope) return;
  const current = SWING.scope;
  const allowNational = SWING.office === 'presidente';

  swingDom.selectScope.innerHTML = '';
  if (allowNational) {
    const opt = document.createElement('option');
    opt.value = 'BR';
    opt.textContent = 'Brasil (Nacional)';
    swingDom.selectScope.appendChild(opt);
  }
  ALL_STATE_SIGLAS.slice().sort((a, b) => a.localeCompare(b)).forEach((sigla) => {
    const opt = document.createElement('option');
    opt.value = sigla;
    opt.textContent = `${UF_MAP.get(sigla)} (${sigla})`;
    swingDom.selectScope.appendChild(opt);
  });

  const stillValid = Array.from(swingDom.selectScope.options).some((o) => o.value === current);
  SWING.scope = stillValid ? current : (allowNational ? 'BR' : 'SP');
  swingDom.selectScope.value = SWING.scope;
}

function populateSwingMunicipioSelect() {
  if (!swingDom.selectMuni) return;
  const municipios = (MUNICIPAL_DATA_INDEX[SWING.scope] || []).slice()
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));

  swingDom.selectMuni.innerHTML = '';
  municipios.forEach((nome) => {
    const opt = document.createElement('option');
    opt.value = nome;
    opt.textContent = toTitleCase(nome);
    swingDom.selectMuni.appendChild(opt);
  });

  if (!municipios.includes(SWING.municipio)) {
    SWING.municipio = municipios[0] || '';
  }
  swingDom.selectMuni.value = SWING.municipio;
  swingDom.selectMuni.disabled = !municipios.length;
}

function populateSwingYearSelects() {
  const years = SWING_OFFICE_YEARS[SWING.office] || [];
  [['A', swingDom.selectYearA], ['B', swingDom.selectYearB]].forEach(([side, select]) => {
    if (!select) return;
    select.innerHTML = '';
    years.forEach((year) => {
      const opt = document.createElement('option');
      opt.value = year;
      opt.textContent = year;
      select.appendChild(opt);
    });
    if (!years.includes(String(SWING[side].year))) {
      // A = eleicao mais antiga do par por padrao, B = a mais recente.
      SWING[side].year = side === 'A' ? (years[1] || years[0]) : years[0];
    }
    select.value = SWING[side].year;
  });
}

function swingAvailableLevels() {
  if (SWING.office === 'prefeito') return ['locais'];
  if (SWING.scope === 'BR') return ['uf'];

  const levels = ['municipios', 'rgint', 'rgi', 'meso', 'micro'];
  if (swingSupportsStationLevel()) levels.push('locais');
  return levels;
}

// Locais so existem se as DUAS eleicoes tiverem resultado por local e ao menos
// uma delas tiver GPKG com as coordenadas.
function swingSupportsStationLevel() {
  const a = String(SWING.A.year);
  const b = String(SWING.B.year);
  if (SWING_MUNI_ONLY_YEARS.has(a) || SWING_MUNI_ONLY_YEARS.has(b)) return false;
  return SWING_GEOMETRY_YEARS.has(a) || SWING_GEOMETRY_YEARS.has(b);
}

function renderSwingLevelChips() {
  if (!swingDom.levelChips) return;
  const levels = swingAvailableLevels();
  if (!levels.includes(SWING.level)) SWING.level = levels[0];

  swingDom.levelChips.innerHTML = levels.map((level) => `
    <button class="chip-button${level === SWING.level ? ' active' : ''}" data-value="${level}"
      title="${escapeAttribute(SWING_LEVEL_LABEL[level])}">${escapeHtml(SWING_LEVEL_SHORT[level])}</button>
  `).join('');
}

function renderSwingTurnoChips(side) {
  const container = side === 'A' ? swingDom.turnoChipsA : swingDom.turnoChipsB;
  if (!container) return;
  const turno = SWING[side].turno;
  container.querySelectorAll('.chip-button').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.value) === Number(turno));
  });
}

function renderSwingLegend() {
  if (!swingDom.legend) return;
  const steps = [-40, -25, -12, -4, 4, 12, 25, 40];
  const swatches = steps.map((value) => `
    <span class="swing-legend-swatch" style="background:${swingColor(value)}"
      title="${value > 0 ? '+' : '−'}${Math.abs(value)} p.p."></span>
  `).join('');

  swingDom.legend.innerHTML = `
    <div class="swing-legend-scale">${swatches}</div>
    <div class="swing-legend-labels">
      <span>Perda</span><span>0</span><span>Ganho</span>
    </div>
  `;
}

function setSwingStatus(message, kind = 'info') {
  if (!swingDom.status) return;
  swingDom.status.textContent = message || '';
  swingDom.status.className = `swing-status swing-status-${kind}`;
  swingDom.status.style.display = message ? '' : 'none';
}

async function refreshSwingCandidateSelect(side) {
  const select = side === 'A' ? swingDom.selectCandA : swingDom.selectCandB;
  if (!select) return;

  const cfg = SWING[side];
  select.disabled = true;
  select.innerHTML = '<option value="">Carregando…</option>';

  if (SWING.office === 'prefeito' && !SWING.municipio) {
    select.innerHTML = '<option value="">Escolha um município</option>';
    cfg.cands = [];
    return;
  }

  // No escopo nacional a lista presidencial e a mesma em qualquer UF: uma
  // sondagem basta para montar o dropdown.
  const uf = SWING.scope === 'BR' ? 'SP' : SWING.scope;

  try {
    const cands = await loadSwingCandidateList(
      SWING.office, cfg.year, SWING.subtype, cfg.turno, uf, SWING.municipio
    );
    cfg.cands = cands;

    if (!cands.length) {
      select.innerHTML = '<option value="">Sem candidatos neste turno</option>';
      cfg.candId = '';
      return;
    }

    select.innerHTML = cands.map((cand) => `
      <option value="${escapeAttribute(cand.id)}">${escapeHtml(toTitleCase(cand.nome))} (${escapeHtml(cand.partido)})</option>
    `).join('');

    if (!cands.some((c) => c.id === cfg.candId)) {
      cfg.candId = cands[0].id;
    }
    select.value = cfg.candId;
    select.disabled = false;
  } catch (error) {
    console.warn(`[Swing] Falha ao listar candidatos (${side}):`, error);
    select.innerHTML = '<option value="">Indisponível</option>';
    cfg.cands = [];
    cfg.candId = '';
  }
}

async function refreshSwingCandidateSelects() {
  await Promise.all([
    refreshSwingCandidateSelect('A'),
    refreshSwingCandidateSelect('B')
  ]);
}

/* ==========================================================================
 * 9. ORQUESTRACAO
 * ========================================================================== */

let swingApplyTimer = null;

function scheduleSwingApply(delay = 120) {
  clearTimeout(swingApplyTimer);
  swingApplyTimer = setTimeout(() => { void applySwing(); }, delay);
}

// Recarrega os dados das duas eleicoes e redesenha. Trocar apenas o NIVEL nao
// passa por aqui: os agregados por municipio ja permitem todos os rollups.
async function applySwing({ reloadData = true } = {}) {
  if (!SWING.enabled) return;
  const vazio = ['A', 'B'].find((side) => !SWING[side].candId);
  if (vazio) {
    // Sem candidato normalmente significa turno inexistente naquele ano/UF —
    // e o caso comum de escolher 2º turno onde a eleicao acabou no primeiro.
    const semTurno = !(SWING[vazio].cands || []).length;
    setSwingStatus(
      semTurno
        ? `${SWING[vazio].year} não teve ${SWING[vazio].turno}º turno neste recorte.`
        : `Escolha a candidatura da eleição ${vazio}.`,
      semTurno ? 'warn' : 'info'
    );
    renderSwingPanel();
    return;
  }
  // Mesmo ano SO faz sentido entre turnos diferentes (1o x 2o turno da mesma
  // eleicao e uma comparacao legitima); mesmo ano E mesmo turno seria o
  // candidato contra ele mesmo.
  if (String(SWING.A.year) === String(SWING.B.year)
    && Number(SWING.A.turno) === Number(SWING.B.turno)) {
    setSwingStatus('Escolha anos (ou turnos) diferentes para comparar.', 'warn');
    return;
  }

  SWING.loading = true;
  setSwingStatus('Carregando as duas eleições…', 'info');
  showMapLoading('Montando a comparação…', 0);

  try {
    if (reloadData || !SWING.dataset) {
      SWING.dataset = await buildSwingDataset();
    }
    SWING.selectedKey = null;
    await renderSwingMap();
    renderSwingPanel();

    const comparadas = SWING.rows?.size || 0;
    if (!comparadas) {
      setSwingStatus('Nenhuma unidade aparece nas duas eleições.', 'warn');
    } else {
      setSwingStatus(`${fmtInt(comparadas)} ${SWING_LEVEL_SHORT[SWING.level].toLowerCase()} em ambas as eleições.`, 'ok');
    }
  } catch (error) {
    console.error('[Swing] Falha ao montar comparação:', error);
    setSwingStatus(error.message || 'Falha ao carregar os dados.', 'warn');
    showToast(`Swing: ${error.message}`, 'error', 5000);
  } finally {
    SWING.loading = false;
    hideMapLoading();
  }
}

// Troca de nivel: so redesenha (os agregados ja estao em memoria).
async function applySwingLevel() {
  if (!SWING.dataset) return;
  showMapLoading('Redesenhando…');
  try {
    SWING.selectedKey = null;
    await renderSwingMap();
    renderSwingPanel();
    const comparadas = SWING.rows?.size || 0;
    setSwingStatus(`${fmtInt(comparadas)} ${SWING_LEVEL_SHORT[SWING.level].toLowerCase()} em ambas as eleições.`, 'ok');
  } catch (error) {
    console.error('[Swing] Falha ao trocar de nível:', error);
    showToast(`Swing: ${error.message}`, 'error', 4000);
  } finally {
    hideMapLoading();
  }
}

function syncSwingControlsVisibility() {
  const isPrefeito = SWING.office === 'prefeito';
  swingDom.muniCtrl?.classList.toggle('section-hidden', !isPrefeito);
  if (swingDom.scopeCtrl) {
    const label = swingDom.scopeCtrl.querySelector('label');
    if (label) label.textContent = isPrefeito ? 'Estado (UF)' : 'Abrangência';
  }
}

async function onSwingOfficeChange(office) {
  SWING.office = office;
  SWING.subtype = 'ord';
  SWING.dataset = null;
  // Senador nunca tem 2o turno, e o ano do outro cargo pode nem ter tido:
  // voltar ao 1o turno evita cair num dropdown de candidatos vazio na troca.
  SWING.A.turno = 1;
  SWING.B.turno = 1;
  populateSwingScopeSelect();
  syncSwingControlsVisibility();
  if (office === 'prefeito') populateSwingMunicipioSelect();
  populateSwingYearSelects();
  renderSwingTurnoChips('A');
  renderSwingTurnoChips('B');
  renderSwingLevelChips();
  await refreshSwingCandidateSelects();
  scheduleSwingApply();
}

function setupSwingControls() {
  cacheSwingDom();
  if (!swingDom.box) return;

  populateSwingScopeSelect();
  syncSwingControlsVisibility();
  populateSwingYearSelects();
  renderSwingLevelChips();
  renderSwingLegend();

  swingDom.officeChips?.addEventListener('click', (event) => {
    const btn = event.target.closest('.chip-button');
    if (!btn || btn.classList.contains('active')) return;
    swingDom.officeChips.querySelectorAll('.chip-button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    void onSwingOfficeChange(btn.dataset.value);
  });

  swingDom.selectScope?.addEventListener('change', async (event) => {
    SWING.scope = String(event.target.value || 'BR').toUpperCase();
    SWING.dataset = null;
    if (SWING.office === 'prefeito') populateSwingMunicipioSelect();
    renderSwingLevelChips();
    await refreshSwingCandidateSelects();
    scheduleSwingApply();
  });

  swingDom.selectMuni?.addEventListener('change', async (event) => {
    SWING.municipio = String(event.target.value || '');
    SWING.dataset = null;
    await refreshSwingCandidateSelects();
    scheduleSwingApply();
  });

  swingDom.searchMuni?.addEventListener('input', (event) => {
    const query = norm(event.target.value || '');
    if (!query) return;
    const match = Array.from(swingDom.selectMuni?.options || [])
      .find((opt) => norm(opt.textContent).includes(query));
    if (match) {
      swingDom.selectMuni.value = match.value;
      swingDom.selectMuni.dispatchEvent(new Event('change'));
    }
  });

  [['A', swingDom.selectYearA], ['B', swingDom.selectYearB]].forEach(([side, select]) => {
    select?.addEventListener('change', async (event) => {
      SWING[side].year = String(event.target.value);
      SWING[side].turno = 1;
      SWING.dataset = null;
      renderSwingTurnoChips(side);
      renderSwingLevelChips();
      await refreshSwingCandidateSelect(side);
      scheduleSwingApply();
    });
  });

  [['A', swingDom.turnoChipsA], ['B', swingDom.turnoChipsB]].forEach(([side, chips]) => {
    chips?.addEventListener('click', async (event) => {
      const btn = event.target.closest('.chip-button');
      if (!btn || btn.classList.contains('active')) return;
      SWING[side].turno = Number(btn.dataset.value) || 1;
      SWING.dataset = null;
      renderSwingTurnoChips(side);
      await refreshSwingCandidateSelect(side);
      scheduleSwingApply();
    });
  });

  [['A', swingDom.selectCandA], ['B', swingDom.selectCandB]].forEach(([side, select]) => {
    select?.addEventListener('change', (event) => {
      SWING[side].candId = String(event.target.value || '');
      SWING.dataset = null;
      scheduleSwingApply();
    });
  });

  swingDom.levelChips?.addEventListener('click', (event) => {
    const btn = event.target.closest('.chip-button');
    if (!btn || btn.classList.contains('active')) return;
    SWING.level = btn.dataset.value;
    renderSwingLevelChips();
    void applySwingLevel();
  });

  swingDom.appModeChips?.addEventListener('click', (event) => {
    const btn = event.target.closest('.chip-button');
    if (!btn || btn.classList.contains('active')) return;
    swingDom.appModeChips.querySelectorAll('.chip-button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    void setSwingModeEnabled(btn.dataset.value === 'swing');
  });
}

/* ==========================================================================
 * 10. ENTRADA E SAIDA DO MODO
 * ========================================================================== */

// Secoes do modo normal que ficam escondidas enquanto o swing manda no mapa.
// Quem decide a visibilidade delas no modo normal e o proprio pipeline
// (updateElectionTypeUI, showNationalOverview...), entao guardamos o estado em
// que estavam e devolvemos igual na saida em vez de mostrar tudo.
const SWING_HIDDEN_SECTIONS = ['loaderBox', 'filterBox', 'vizBox', 'electionContextBox'];
let swingPreviousSectionState = null;

async function setSwingModeEnabled(enabled) {
  if (SWING.enabled === enabled) return;
  SWING.enabled = enabled;
  STATE.swingEnabled = enabled;

  if (enabled) {
    swingPreviousSectionState = {};
    SWING_HIDDEN_SECTIONS.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      swingPreviousSectionState[id] = el.classList.contains('section-hidden');
      el.classList.add('section-hidden');
    });
  } else {
    SWING_HIDDEN_SECTIONS.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('section-hidden', !!swingPreviousSectionState?.[id]);
    });
    swingPreviousSectionState = null;
  }

  swingDom.box?.classList.toggle('section-hidden', !enabled);

  // A barra de modos do mapa pilota o pipeline normal; no swing quem escolhe o
  // nivel sao os chips da sidebar esquerda.
  if (dom.layerToggleGroup) dom.layerToggleGroup.style.display = enabled ? 'none' : '';
  if (dom.mapRenderControls) dom.mapRenderControls.style.display = enabled ? 'none' : '';

  if (enabled) {
    document.getElementById('btnClearSelection')?.classList.add('hidden');
    document.getElementById('btnScopeBack')?.classList.add('hidden');
    clearNormalLayers();
    if (typeof selectedLocationIDs !== 'undefined') selectedLocationIDs.clear();
    if (dom.neighborhoodProfile) dom.neighborhoodProfile.style.display = 'none';
    renderSwingPanel();
    await refreshSwingCandidateSelects();
    await applySwing();
    return;
  }

  // Saindo: devolve o mapa ao pipeline normal.
  clearSwingLayer();
  SWING.rows = null;
  SWING.selectedKey = null;
  if (dom.neighborhoodProfile) dom.neighborhoodProfile.style.display = '';
  if (dom.btnToggleInaptos) dom.btnToggleInaptos.style.display = '';
  if (typeof updateElectionTypeUI === 'function') updateElectionTypeUI();
  if (typeof window.updateClearSelectionButtonVisibility === 'function') {
    window.updateClearSelectionButtonVisibility();
  }

  if (typeof isNationalGeneralScope === 'function' && isNationalGeneralScope()) {
    if (typeof showNationalOverview === 'function') await showNationalOverview();
  } else if (typeof scheduleAutoLoadCurrentSelection === 'function') {
    scheduleAutoLoadCurrentSelection(0);
  }
}

if (typeof window !== 'undefined') {
  window.SWING = SWING;
  window.setupSwingControls = setupSwingControls;
  window.setSwingModeEnabled = setSwingModeEnabled;
  window.applySwing = applySwing;
  window.isSwingModeActive = () => !!SWING.enabled;
}
