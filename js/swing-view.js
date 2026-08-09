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
 *   local     -> a propria chave    (nr_locvot e numerado DENTRO da zona, nao
 *                                    do municipio: em SP o local 1090 existe
 *                                    em 50 zonas — sao 50 predios diferentes.
 *                                    A identidade do local e a tripla inteira.
 *                                    Predio renumerado entre as eleicoes e
 *                                    recuperado pelo nome, em
 *                                    ensureSwingStationAliases.)
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
  metric: 'swing',      // 'swing' (duas candidaturas) ou 'virada' (trocou o vencedor)
  flipBy: 'partido',    // criterio de "mesmo vencedor": 'partido' ou 'candidato'
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

// Percorre o RESULTS de UMA eleicao e agrupa a distribuicao COMPLETA de votos
// por local, municipio e UF.
//
// Guardar o mapa inteiro (e nao so os votos de um candidato) e o que permite os
// dois modos saírem do mesmo carregamento: o modo Swing le a chave do candidato
// escolhido, o modo Virada tira o vencedor por argmax. Trocar de candidato ou de
// modo vira redesenho, nao recarga. O custo e baixo porque eleicao majoritaria
// tem poucos candidatos (~10): sao ~10 numeros por unidade.
function buildSwingSideAggregates(payloadsByUf) {
  const byStation = new Map();
  const byMuni = new Map();
  const byUf = new Map();

  const bump = (store, key, voteMap) => {
    if (!key) return;
    let entry = store.get(key);
    if (!entry) {
      entry = { votes: {}, total: 0 };
      store.set(key, entry);
    }
    Object.entries(voteMap || {}).forEach(([id, votes]) => {
      if (id === '95' || id === '96') return; // brancos e nulos fora do valido
      const value = ensureNumber(votes);
      entry.votes[id] = (entry.votes[id] || 0) + value;
      entry.total += value;
    });
  };

  Object.entries(payloadsByUf || {}).forEach(([uf, payload]) => {
    const ufKey = String(uf).toUpperCase();
    Object.entries(payload?.RESULTS || {}).forEach(([resultKey, voteMap]) => {
      const parsed = parseSwingResultKey(resultKey);
      if (!parsed) return;
      bump(byStation, resultKey, voteMap);
      bump(byMuni, parsed.muni, voteMap);
      bump(byUf, ufKey, voteMap);
    });
  });

  return { byStation, byMuni, byUf };
}

// Versao para o escopo nacional, onde so temos os TOTALS por UF (resumo).
function buildSwingSideAggregatesFromTotals(totalsByUf) {
  const byUf = new Map();
  Object.entries(totalsByUf || {}).forEach(([uf, totals]) => {
    const entry = { votes: {}, total: 0 };
    Object.entries(totals || {}).forEach(([id, votes]) => {
      if (id === '95' || id === '96') return;
      const value = ensureNumber(votes);
      entry.votes[id] = (entry.votes[id] || 0) + value;
      entry.total += value;
    });
    byUf.set(String(uf).toUpperCase(), entry);
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
      acc = { votes: {}, total: 0 };
      out.set(regionCode, acc);
    }
    Object.entries(entry.votes).forEach(([id, votes]) => {
      acc.votes[id] = (acc.votes[id] || 0) + votes;
    });
    acc.total += entry.total;
  });
  return out;
}

// Vencedor de uma unidade + margem para o 2o colocado. Cacheado no proprio
// entry: a mesma unidade e lida pelo estilo, pelo tooltip e pelo painel.
function swingUnitWinner(entry) {
  if (!entry || !(entry.total > 0)) return null;
  if (entry.__winner !== undefined) return entry.__winner;

  let winnerId = null;
  let winnerVotes = -1;
  let secondVotes = -1;
  Object.entries(entry.votes).forEach(([id, votes]) => {
    if (votes > winnerVotes) {
      secondVotes = winnerVotes;
      winnerId = id;
      winnerVotes = votes;
    } else if (votes > secondVotes) {
      secondVotes = votes;
    }
  });

  const winner = (winnerId === null) ? null : {
    id: winnerId,
    votes: Math.max(0, winnerVotes),
    secondVotes: Math.max(0, secondVotes),
    pct: (Math.max(0, winnerVotes) / entry.total) * 100,
    margin: ((Math.max(0, winnerVotes) - Math.max(0, secondVotes)) / entry.total) * 100
  };

  Object.defineProperty(entry, '__winner', { value: winner, configurable: true });
  return winner;
}

function swingCandVotes(entry, candId) {
  return ensureNumber(entry?.votes?.[candId]);
}

/* --------------------------------------------------------------------------
 * IDENTIDADE DO VENCEDOR ENTRE DOIS ANOS
 *
 * "Mudou o ganhador" so tem resposta depois de dizer o que conta como MESMO
 * ganhador em eleicoes diferentes, e as duas leituras possiveis discordam em
 * casos reais:
 *
 *   - Por CANDIDATO: Bolsonaro 2018 (PSL) e Bolsonaro 2022 (PL) sao o mesmo
 *     ganhador; PT de Dilma 2014 e PT de Haddad 2018 sao ganhadores distintos.
 *   - Por PARTIDO: o inverso nos dois casos.
 *
 * Nenhuma das duas e "a certa", entao o criterio e do usuario (chips na
 * lateral). O padrao e partido, que e o sentido usual de um mapa de virada —
 * por nome, toda eleicao em que a legenda troca de candidato viraria o mapa
 * inteiro e nao sobraria informacao.
 * -------------------------------------------------------------------------- */

// Sucessoes e renomeacoes de legendas que apareceram em disputas majoritarias
// de 1989 para ca. Sem isto, PMDB (ate 2017) x MDB (2018+) contaria como virada
// em todo municipio do pais. Resolvida transitivamente (PFL -> DEM -> UNIAO).
const SWING_PARTY_LINEAGE = {
  PMDB: 'MDB',
  PFL: 'DEM', DEM: 'UNIAO', PSL: 'UNIAO', 'UNIÃO': 'UNIAO', 'UNIAO BRASIL': 'UNIAO',
  ARENA: 'PP', PDS: 'PP', PPR: 'PP', PPB: 'PP', PP: 'PP',
  PRB: 'REPUBLICANOS',
  PRONA: 'PL', PR: 'PL',
  PPS: 'CIDADANIA',
  PTN: 'PODEMOS', PODE: 'PODEMOS', PHS: 'PODEMOS',
  'PT DO B': 'AVANTE', PTDOB: 'AVANTE',
  PSDC: 'DC',
  PEN: 'PATRIOTA', PATRI: 'PATRIOTA', PRP: 'PATRIOTA',
  PTC: 'AGIR',
  PPL: 'PC DO B', PCDOB: 'PC DO B',
  SD: 'SOLIDARIEDADE'
};

// Linhagem ajustada exclusivamente para eleição presidencial
const SWING_PRESIDENTIAL_PARTY_LINEAGE = {
  ...SWING_PARTY_LINEAGE,
  PSL: 'PL',
  PRN: 'PL',
  PSDB: 'PL'
};

function resolvePartyLineage(sigla, office = SWING.office) {
  let current = String(sigla || '').toUpperCase().trim();
  if (!current) return '';
  const lineageMap = office === 'presidente' ? SWING_PRESIDENTIAL_PARTY_LINEAGE : SWING_PARTY_LINEAGE;
  // Cadeia curta e conhecida; o teto so protege contra um ciclo introduzido por
  // engano na tabela acima.
  for (let hop = 0; hop < 6; hop++) {
    const next = lineageMap[current];
    if (!next || next === current) break;
    current = next;
  }
  return current;
}

function swingCandMeta(side, candId) {
  return (SWING[side].cands || []).find((cand) => cand.id === String(candId)) || null;
}

// Chave de comparacao do vencedor, no criterio escolhido. String vazia quando a
// metadata do ano nao conhece o id — melhor "nao sei" do que uma falsa virada.
function swingWinnerIdentity(side, candId) {
  const meta = swingCandMeta(side, candId);
  if (!meta) return '';
  if (SWING.flipBy === 'candidato') return norm(meta.nome);
  const sigla = typeof normalizePartyAlias === 'function'
    ? normalizePartyAlias(String(meta.partido || '').toUpperCase())
    : String(meta.partido || '').toUpperCase();
  return resolvePartyLineage(sigla);
}

// Rotulo do vencedor de uma unidade, como aparece no tooltip e no painel.
function swingWinnerLabel(side, candId) {
  const meta = swingCandMeta(side, candId);
  if (!meta) return `Candidato ${candId}`;
  return `${toTitleCase(meta.nome)} (${meta.partido})`;
}

function swingWinnerColor(side, candId) {
  const meta = swingCandMeta(side, candId);
  if (!meta) return SWING_NO_DATA_COLOR;
  return getColorForCandidate(meta.nome, meta.partido);
}

// Cruza os dois lados num unico Map de linhas. So entram chaves presentes nas
// DUAS eleicoes com voto valido — e isso que garante, no nivel de locais, que
// so aparecem os locais de votacao que existiam nas duas.
//
// A linha carrega os dois modos ao mesmo tempo: os votos das candidaturas
// escolhidas (Swing) e os vencedores de cada ano (Virada).
function joinSwingSides(mapA, mapB) {
  const rows = new Map();
  const candA = SWING.A.candId;
  const candB = SWING.B.candId;

  mapB.forEach((entryB, key) => {
    const entryA = mapA.get(key);
    if (!entryA) return;
    if (!(entryA.total > 0) || !(entryB.total > 0)) return;

    const votesA = swingCandVotes(entryA, candA);
    const votesB = swingCandVotes(entryB, candB);
    const pctA = (votesA / entryA.total) * 100;
    const pctB = (votesB / entryB.total) * 100;

    const winnerA = swingUnitWinner(entryA);
    const winnerB = swingUnitWinner(entryB);
    const identA = winnerA ? swingWinnerIdentity('A', winnerA.id) : '';
    const identB = winnerB ? swingWinnerIdentity('B', winnerB.id) : '';

    rows.set(key, {
      key,
      a: { votes: votesA, total: entryA.total, pct: pctA, winner: winnerA, identity: identA },
      b: { votes: votesB, total: entryB.total, pct: pctB, winner: winnerB, identity: identB },
      swing: pctB - pctA,
      // Sem identidade nos dois lados nao da para afirmar virada nem manutencao.
      flipped: (identA && identB) ? (identA !== identB) : null
    });
  });
  return rows;
}

function swingRowsForLevel(level) {
  const dataset = SWING.dataset;
  if (!dataset) return new Map();

  if (level === 'uf') return joinSwingSides(dataset.A.byUf, dataset.B.byUf);
  if (level === 'locais') {
    // O lado mais antigo entra com as chaves dos predios renumerados ja
    // reescritas para as do lado mais novo (ver ensureSwingStationAliases).
    const antigo = swingGeometrySidesNewestFirst()[1] || null;
    const byStation = (side) => (side === antigo
      ? aliasStationMap(dataset[side].byStation, SWING._stationAlias)
      : dataset[side].byStation);
    return joinSwingSides(byStation('A'), byStation('B'));
  }
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

  // Soma as distribuicoes completas para poder responder aos dois modos: a
  // candidatura escolhida (Swing) e o vencedor do recorte inteiro (Virada).
  const fold = (store) => {
    const acc = { votes: {}, total: 0 };
    store.forEach((entry) => {
      Object.entries(entry.votes).forEach(([id, votes]) => {
        acc.votes[id] = (acc.votes[id] || 0) + votes;
      });
      acc.total += entry.total;
    });
    return acc;
  };

  const accA = fold(dataset.A[source]);
  const accB = fold(dataset.B[source]);
  if (!(accA.total > 0) || !(accB.total > 0)) return null;

  const votesA = swingCandVotes(accA, SWING.A.candId);
  const votesB = swingCandVotes(accB, SWING.B.candId);
  const pctA = (votesA / accA.total) * 100;
  const pctB = (votesB / accB.total) * 100;
  const winnerA = swingUnitWinner(accA);
  const winnerB = swingUnitWinner(accB);
  const identA = winnerA ? swingWinnerIdentity('A', winnerA.id) : '';
  const identB = winnerB ? swingWinnerIdentity('B', winnerB.id) : '';

  return {
    key: '__scope__',
    a: { votes: votesA, total: accA.total, pct: pctA, winner: winnerA, identity: identA },
    b: { votes: votesB, total: accB.total, pct: pctB, winner: winnerB, identity: identB },
    swing: pctB - pctA,
    flipped: (identA && identB) ? (identA !== identB) : null
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
    return buildSwingSideAggregatesFromTotals(totalsByUf);
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
  return buildSwingSideAggregates(payloadsByUf);
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

// Chave "{zona}_{muni}_{local}" de uma feature de local — a mesma do RESULTS.
// parseSwingResultKey entra aqui so como VALIDADOR: o ID_UNICO dos GeoJSON
// antigos e "LOC_######" (id de predio, nao de local) e nao parseia, caindo no
// fallback abaixo.
function swingStationKeyFromProps(props) {
  if (!props) return '';
  const fullKey = String(props.id_unico || props.local_key || props.ID_UNICO || '');
  if (parseSwingResultKey(fullKey)) return fullKey;

  const zona = parseInt(props.nr_zona, 10);
  const local = parseInt(props.nr_locvot, 10);
  const muni = String(props.cd_localidade_tse || '').trim();
  if (muni && Number.isFinite(zona) && Number.isFinite(local)) return `${zona}_${muni}_${local}`;
  return '';
}

// Prefere a geometria do ano mais RECENTE do par (nao necessariamente o lado B:
// nada impede o usuario de por a eleicao mais nova em A). Alem de ser a malha
// mais completa, e a que descreve o local como ele esta hoje.
function swingGeometrySidesNewestFirst() {
  return ['A', 'B']
    .filter((side) => SWING_GEOMETRY_YEARS.has(String(SWING[side].year)))
    .sort((s1, s2) => Number(SWING[s2].year) - Number(SWING[s1].year));
}

// Nome do predio reduzido ao que sobrevive a mudanca de grafia entre os anos:
// "E.E. Prof. Joao XXIII" e "EE PROF JOAO XXIII" viram a mesma chave.
const swingLocalNameKey = (nome) => norm(nome).replace(/[^A-Z0-9]/g, '');

// Locais que existem nas duas eleicoes mas foram RENUMERADOS (mudou a zona e/ou
// o numero) nao casam pela chave. Este passo os recupera pelo NOME do predio —
// que so existe na geometria, e por isso ela precisa carregar antes do join.
//
// So aceita nome que aparece UMA UNICA vez em cada lado entre as chaves que
// sobraram sem par: nome repetido (um "EMEF JARDIM SAO PAULO" em cada ponta da
// cidade) casaria predio errado, e um par errado e pior que um local a menos.
async function buildSwingStationAliases() {
  const alias = new Map();
  const dataset = SWING.dataset;
  const sides = swingGeometrySidesNewestFirst();
  if (!dataset || sides.length < 2) return alias;

  const [novo, antigo] = sides; // sides vem do mais novo para o mais antigo
  const uf = String(SWING.scope).toUpperCase();

  const nomesPorLado = {};
  for (const side of sides) {
    let base = null;
    try {
      base = await loadSwingStationBase(side, uf);
    } catch (error) {
      console.warn(`[Swing] Sem geometria de ${SWING[side].year} para casar renumerados:`, error);
    }
    const porChave = new Map();
    (base?.features || []).forEach((feature) => {
      const key = swingStationKeyFromProps(feature?.properties);
      const nome = swingLocalNameKey(feature?.properties?.nm_locvot);
      if (key && nome) porChave.set(key, nome);
    });
    nomesPorLado[side] = porChave;
  }

  // nome -> chave, guardando null quando o nome se repete (ambiguo, descartado).
  const indexarUnicos = (side, outro) => {
    const nomes = nomesPorLado[side] || new Map();
    const outroKeys = dataset[outro].byStation;
    const porNome = new Map();
    dataset[side].byStation.forEach((_entry, key) => {
      if (outroKeys.has(key)) return; // ja casou pela chave
      const nome = nomes.get(key);
      if (!nome) return;
      porNome.set(nome, porNome.has(nome) ? null : key);
    });
    return porNome;
  };

  const novosSemPar = indexarUnicos(novo, antigo);
  indexarUnicos(antigo, novo).forEach((keyAntiga, nome) => {
    const keyNova = novosSemPar.get(nome);
    if (keyAntiga && keyNova) alias.set(keyAntiga, keyNova);
  });

  return alias;
}

// Memoiza a PROMISE, nao o resultado: renderSwingMap pode ser chamado de novo
// antes do primeiro await terminar, e duas montagens em paralelo leriam o GPKG
// duas vezes e a segunda enxergaria um alias ainda vazio.
async function ensureSwingStationAliases() {
  if (!SWING._stationAliasPromise) {
    SWING._stationAliasPromise = buildSwingStationAliases();
  }
  SWING._stationAlias = await SWING._stationAliasPromise;
  return SWING._stationAlias;
}

// Copia do byStation do lado mais antigo com as chaves renumeradas reescritas
// para a chave do lado novo, para o join enxergar as duas como a mesma unidade.
function aliasStationMap(map, alias) {
  if (!alias?.size) return map;
  const out = new Map(map);
  alias.forEach((destino, origem) => {
    const entry = out.get(origem);
    if (!entry || out.has(destino)) return; // nunca sobrescreve uma chave real
    out.delete(origem);
    out.set(destino, entry);
  });
  return out;
}

async function buildSwingStationFeatures(rows) {
  const uf = String(SWING.scope).toUpperCase();
  const sides = swingGeometrySidesNewestFirst();

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

// NAO se chama fmtPct de proposito: utils.js ja tem uma fmtPct global, e ela
// recebe FRACAO (0-1) e multiplica por 100. Como este arquivo carrega por
// ultimo, uma declaracao homonima aqui sobrescreveria a do app inteiro e todo
// percentual dos paineis sairia dividido por 100. Aqui a entrada e 0-100.
function fmtSwingPct(value) {
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
    const nome = props?.nm_locvot ? safeToTitleCase(props.nm_locvot) : `Local ${String(key).split('_')[2] || ''}`;
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

// Função para clarear uma cor hexadecimal mantendo a tonalidade (estilo mapa dos EUA)
function getLightenedPartyColor(baseColorHex) {
  if (!baseColorHex || baseColorHex === SWING_NO_DATA_COLOR) return SWING_NO_DATA_COLOR;
  let hex = String(baseColorHex).trim();
  if (!hex.startsWith('#')) {
    if (hex.length === 3 || hex.length === 6) hex = '#' + hex;
    else return baseColorHex;
  }
  if (typeof hexToHSL !== 'function' || typeof hslToHex !== 'function') return baseColorHex;
  try {
    const hsl = hexToHSL(hex);
    if (!hsl || typeof hsl.l !== 'number') return baseColorHex;
    // Eleva a luminosidade para um tom pastel elegante (~72-82%) e suaviza a saturação
    const targetL = Math.max(72, Math.min(82, hsl.l + (100 - hsl.l) * 0.58));
    const targetS = Math.min(hsl.s, 72);
    return hslToHex(hsl.h, targetS, targetL);
  } catch (e) {
    return baseColorHex;
  }
}

// No modo Virada:
// - Quem virou recebe a cor padrão (sem variação de margem/gradiente)
// - Quem manteve recebe uma versão clareada (pastel) da cor padrão
function swingFillFor(row) {
  if (SWING.metric === 'virada') {
    const winnerB = row.b.winner;
    if (!winnerB) return { color: SWING_NO_DATA_COLOR, opacity: 0.12 };
    const base = swingWinnerColor('B', winnerB.id);
    if (row.flipped === true) {
      return { color: base, opacity: 0.9 };
    }
    if (row.flipped === false) {
      return { color: getLightenedPartyColor(base), opacity: SWING.level === 'locais' ? 0.85 : 0.82 };
    }
    return { color: base, opacity: 0.12 };
  }
  return { color: swingColor(row.swing), opacity: SWING.level === 'locais' ? 0.85 : 0.82 };
}

function swingFeatureStyle(feature) {
  const isPoint = SWING.level === 'locais';
  const row = SWING.rows?.get(swingKeyForFeature(feature));

  if (!row) {
    return isPoint
      ? { stroke: false, fillColor: SWING_NO_DATA_COLOR, fillOpacity: 0.12, opacity: 1 }
      : { fillColor: SWING_NO_DATA_COLOR, fillOpacity: 0.10, color: '#ffffff', weight: 0.12, opacity: 0.45, height: 0 };
  }

  const isSelected = SWING.selectedKey && SWING.selectedKey === row.key;
  const fill = swingFillFor(row);

  if (isPoint) {
    return {
      stroke: !!isSelected,
      fillColor: isSelected ? 'var(--accent)' : fill.color,
      fillOpacity: fill.opacity,
      color: '#ffffff',
      weight: isSelected ? 1.6 : 0,
      opacity: 1
    };
  }

  return {
    fillColor: fill.color,
    fillOpacity: fill.opacity,
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

// Rotulo curto do desfecho de uma unidade no modo Virada.
function swingFlipVerdict(row) {
  if (row.flipped === null) return { texto: 'Indeterminado', cls: '' };
  if (!row.flipped) return { texto: 'Manteve', cls: 'swing-held' };
  return { texto: 'Virou', cls: 'swing-flip' };
}

// Tabela usada tanto no tooltip quanto na sidebar direita. Em qualquer um dos
// dois modos ela mostra DUAS candidaturas — as escolhidas, no Swing; as
// vencedoras de cada ano, na Virada — com votos, % e a diferenca entre elas.
function buildSwingComparisonTable(row) {
  const isFlip = SWING.metric === 'virada';

  const linhas = ['A', 'B'].map((side) => {
    const data = row[side.toLowerCase()];
    const winnerId = data.winner?.id;
    return {
      side,
      year: SWING[side].year,
      data,
      label: isFlip
        ? (winnerId ? swingWinnerLabel(side, winnerId) : 'Sem vencedor')
        : swingCandidateLabel(side),
      color: isFlip
        ? (winnerId ? swingWinnerColor(side, winnerId) : SWING_NO_DATA_COLOR)
        : swingCandidateColor(side),
      votes: isFlip ? (data.winner?.votes ?? 0) : data.votes,
      pct: isFlip ? (data.winner?.pct ?? 0) : data.pct
    };
  });

  const body = linhas.map((linha) => `
    <tr>
      <td style="padding:0;">
        <div class="district-nyt-loser-cell" style="border-left-color: ${linha.color};">
          <span class="swing-cand-name">${escapeHtml(linha.label)}</span>
          <span class="swing-cand-year">${escapeHtml(String(linha.year))}</span>
        </div>
      </td>
      <td class="votes-cell">${fmtInt(linha.votes)}</td>
      <td class="pct-cell">${fmtSwingPct(linha.pct)}</td>
    </tr>
  `).join('');

  if (isFlip) {
    const verdict = swingFlipVerdict(row);
    const delta = linhas[1].pct - linhas[0].pct;
    return `
      <table class="district-nyt-table swing-table">
        <thead>
          <tr><th style="text-align:left;">Vencedor</th><th>Votos</th><th>%</th></tr>
        </thead>
        <tbody>${body}</tbody>
        <tfoot>
          <tr class="swing-total-row ${verdict.cls}">
            <td style="text-align:left;">${escapeHtml(verdict.texto)}</td>
            <td class="votes-cell">${fmtSwing(delta)}</td>
            <td class="pct-cell"><span class="swing-chip" style="background:${swingFillFor(row).color}"></span></td>
          </tr>
        </tfoot>
      </table>
    `;
  }

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

  // O casamento dos locais renumerados sai do nome do predio, que so existe na
  // geometria — entao ela carrega ANTES do join, so neste nivel.
  if (level === 'locais') {
    await ensureSwingStationAliases();
    if (generation !== SWING.generation) return;
  }

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

// Unidades do ranking. Nas municipais o mapa e sempre por LOCAL, mas ranquear
// local produz uma lista de escolas — e um predio nao e um territorio: os
// extremos acabam sendo sempre as unidades minusculas (presidio, internato),
// onde uma duzia de votos vira dezenas de p.p. Por bairro a leitura e da cidade.
//
// So vale para cargo municipal: numa eleicao estadual por local, "CENTRO" e
// bairro de dezenas de municipios ao mesmo tempo e a soma nao significaria nada.
//
// O swing do bairro sai da SOMA dos votos, nao da media dos swings dos locais —
// media daria o mesmo peso a um colegio de 300 e a um de 4.000 eleitores.
function swingRankingEntries() {
  const rows = Array.from(SWING.rows.values())
    .filter((row) => row.a.total > 0 && row.b.total > 0);

  if (!swingIsMunicipalOffice() || SWING.level !== 'locais') {
    return rows.map((row) => ({
      label: swingRowLabel(row.key, SWING._propsByKey?.get(row.key)),
      swing: row.swing
    }));
  }

  const porBairro = new Map();
  rows.forEach((row) => {
    const bairro = String(SWING._propsByKey?.get(row.key)?.ds_bairro || '').trim();
    if (!bairro) return;
    const chave = norm(bairro); // funde variacao de caixa/acento entre os anos
    let acc = porBairro.get(chave);
    if (!acc) {
      acc = { label: toTitleCase(bairro), aVotes: 0, aTotal: 0, bVotes: 0, bTotal: 0 };
      porBairro.set(chave, acc);
    }
    acc.aVotes += row.a.votes;
    acc.aTotal += row.a.total;
    acc.bVotes += row.b.votes;
    acc.bTotal += row.b.total;
  });

  return Array.from(porBairro.values())
    .filter((acc) => acc.aTotal > 0 && acc.bTotal > 0)
    .map((acc) => ({
      label: acc.label,
      swing: (acc.bVotes / acc.bTotal - acc.aVotes / acc.aTotal) * 100
    }));
}

// Ranking dos maiores swings do recorte, para dar leitura ao mapa sem exigir
// clique em cada unidade.
function buildSwingRanking() {
  if (!SWING.rows?.size) return '';

  const entries = swingRankingEntries();
  if (entries.length < 2) return '';

  const sorted = entries.slice().sort((a, b) => b.swing - a.swing);
  const top = sorted.slice(0, 5);
  const bottom = sorted.slice(-5).reverse();

  const renderList = (list) => list.map((item) => `
    <li>
      <span class="swing-rank-name">${escapeHtml(item.label)}</span>
      <span class="swing-rank-value ${item.swing >= 0 ? 'swing-pos' : 'swing-neg'}">${fmtSwing(item.swing)}</span>
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
        ${SWING.metric === 'virada'
          ? 'Selecione o cargo, o recorte e as duas eleições para ver onde o vencedor mudou.'
          : 'Selecione o cargo, o recorte e uma candidatura em cada ano para ver a comparação.'}
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

  const isFlip = SWING.metric === 'virada';
  const headline = isFlip ? buildSwingFlipHeadline(active) : buildSwingSwingHeadline(active);

  const comparativo = (row && scopeRow)
    ? (isFlip
      ? `<div class="swing-context">No recorte inteiro: <strong>${escapeHtml(swingFlipVerdict(scopeRow).texto.toLowerCase())}</strong>${scopeRow.b.winner ? ` — venceu ${escapeHtml(swingWinnerLabel('B', scopeRow.b.winner.id))} em ${escapeHtml(String(SWING.B.year))}` : ''}</div>`
      : `<div class="swing-context">Swing no recorte inteiro: <strong class="${scopeRow.swing >= 0 ? 'swing-pos' : 'swing-neg'}">${fmtSwing(scopeRow.swing)}</strong></div>`)
    : '';

  const agregado = row ? '' : (isFlip ? buildSwingFlipBreakdown() : buildSwingRanking());

  dom.resultsContent.innerHTML = `
    ${headline}
    ${buildSwingComparisonTable(active)}
    ${comparativo}
    ${agregado}
  `;

  dom.resultsMetrics.innerHTML = isFlip
    ? buildSwingFlipMetrics(active)
    : buildSwingSwingMetrics(active);
}

function buildSwingSwingHeadline(active) {
  const cls = active.swing >= 0 ? 'swing-pos' : 'swing-neg';
  return `
    <div class="swing-headline ${cls}" style="border-color:${swingColor(active.swing)}">
      <div class="swing-headline-value" style="color:${swingColor(active.swing)}">${fmtSwing(active.swing)}</div>
      <div class="swing-headline-label">
        ${escapeHtml(swingCandidateLabel('B'))} em ${escapeHtml(String(SWING.B.year))}
        vs. ${escapeHtml(swingCandidateLabel('A'))} em ${escapeHtml(String(SWING.A.year))}
      </div>
    </div>
  `;
}

function buildSwingFlipHeadline(active) {
  const verdict = swingFlipVerdict(active);
  const cor = swingFillFor(active).color;
  const de = active.a.winner ? swingWinnerLabel('A', active.a.winner.id) : '—';
  const para = active.b.winner ? swingWinnerLabel('B', active.b.winner.id) : '—';

  return `
    <div class="swing-headline ${verdict.cls}" style="border-color:${cor}">
      <div class="swing-headline-value" style="color:${cor}; font-size:1.25rem;">${escapeHtml(verdict.texto)}</div>
      <div class="swing-headline-label">
        ${active.flipped === false
          ? `${escapeHtml(para)} venceu nos dois anos`
          : `${escapeHtml(de)} (${escapeHtml(String(SWING.A.year))}) → ${escapeHtml(para)} (${escapeHtml(String(SWING.B.year))})`}
      </div>
    </div>
  `;
}

function buildSwingSwingMetrics(active) {
  const deltaVotos = active.b.votes - active.a.votes;
  return `
    <div class="swing-metrics">
      <span>Votos ${escapeHtml(String(SWING.A.year))}: <strong>${fmtInt(active.a.votes)}</strong></span>
      <span>Votos ${escapeHtml(String(SWING.B.year))}: <strong>${fmtInt(active.b.votes)}</strong></span>
      <span>Diferença: <strong class="${deltaVotos >= 0 ? 'swing-pos' : 'swing-neg'}">${deltaVotos >= 0 ? '+' : '−'}${fmtInt(Math.abs(deltaVotos))}</strong></span>
      <span>Unidades comparadas: <strong>${fmtInt(SWING.rows?.size || 0)}</strong></span>
    </div>
  `;
}

function buildSwingFlipMetrics(active) {
  const stats = swingFlipStats();
  return `
    <div class="swing-metrics">
      <span>Margem ${escapeHtml(String(SWING.A.year))}: <strong>${fmtSwingPct(active.a.winner?.margin || 0)}</strong></span>
      <span>Margem ${escapeHtml(String(SWING.B.year))}: <strong>${fmtSwingPct(active.b.winner?.margin || 0)}</strong></span>
      <span>Viraram: <strong class="swing-flip">${fmtInt(stats.flipped)}</strong> de ${fmtInt(stats.total)}</span>
      <span>Critério: <strong>${SWING.flipBy === 'candidato' ? 'candidato' : 'partido'}</strong></span>
    </div>
  `;
}

// Contagem de viradas do recorte e, dentro delas, o fluxo de-para. E o resumo
// que responde "onde mudou o ganhador" sem exigir clique em cada unidade.
function swingFlipStats() {
  const stats = { total: 0, flipped: 0, held: 0, unknown: 0, fluxos: new Map() };
  if (!SWING.rows) return stats;

  SWING.rows.forEach((row) => {
    stats.total += 1;
    if (row.flipped === null) { stats.unknown += 1; return; }
    if (!row.flipped) { stats.held += 1; return; }
    stats.flipped += 1;

    const de = row.a.winner ? swingWinnerLabel('A', row.a.winner.id) : '—';
    const para = row.b.winner ? swingWinnerLabel('B', row.b.winner.id) : '—';
    const chave = `${de}>>${para}`;
    const fluxo = stats.fluxos.get(chave) || {
      de,
      para,
      corDe: row.a.winner ? swingWinnerColor('A', row.a.winner.id) : SWING_NO_DATA_COLOR,
      corPara: row.b.winner ? swingWinnerColor('B', row.b.winner.id) : SWING_NO_DATA_COLOR,
      n: 0,
      votos: 0
    };
    fluxo.n += 1;
    fluxo.votos += row.b.total;
    stats.fluxos.set(chave, fluxo);
  });

  return stats;
}

function buildSwingFlipBreakdown() {
  const stats = swingFlipStats();
  if (!stats.total) return '';

  const unidade = SWING_LEVEL_SHORT[SWING.level].toLowerCase();
  const pctFlip = stats.total > 0 ? (stats.flipped / stats.total) * 100 : 0;

  if (!stats.flipped) {
    return `
      <div class="swing-flip-summary">
        <div class="swing-flip-count">Nenhuma virada</div>
        <div class="swing-flip-sub">O vencedor se manteve nas ${fmtInt(stats.held)} ${escapeHtml(unidade)} comparadas.</div>
      </div>
    `;
  }

  const fluxos = Array.from(stats.fluxos.values()).sort((a, b) => b.n - a.n).slice(0, 8);
  const linhas = fluxos.map((fluxo) => `
    <li>
      <span class="swing-flow-arrow">
        <span class="swing-chip" style="background:${fluxo.corDe}"></span>
        <span class="swing-flow-sep">→</span>
        <span class="swing-chip" style="background:${fluxo.corPara}"></span>
      </span>
      <span class="swing-flow-name">${escapeHtml(fluxo.de)} → ${escapeHtml(fluxo.para)}</span>
      <span class="swing-flow-count">${fmtInt(fluxo.n)}</span>
    </li>
  `).join('');

  return `
    <div class="swing-flip-summary">
      <div class="swing-flip-count"><strong class="swing-flip">${fmtInt(stats.flipped)}</strong> de ${fmtInt(stats.total)} ${escapeHtml(unidade)} viraram <span class="swing-flip-pct">(${fmtSwingPct(pctFlip)})</span></div>
      <div class="swing-flip-sub">${fmtInt(stats.held)} mantiveram o vencedor${stats.unknown ? ` • ${fmtInt(stats.unknown)} sem identificação` : ''}</div>
    </div>
    <div class="swing-flows">
      <h4>Viradas por direção</h4>
      <ul>${linhas}</ul>
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
  swingDom.metricChips = document.getElementById('swingMetricChips');
  swingDom.flipByCtrl = document.getElementById('swingFlipByCtrl');
  swingDom.flipByChips = document.getElementById('swingFlipByChips');
  swingDom.cardA = document.getElementById('swingCardA');
  swingDom.cardB = document.getElementById('swingCardB');
}

// Na Virada nao se escolhe candidatura: o vencedor sai dos dados. Os selects
// somem (os anos e turnos continuam, porque definem QUAIS eleicoes comparar) e
// entra o criterio de "mesmo vencedor".
function syncSwingMetricUI() {
  const isFlip = SWING.metric === 'virada';
  swingDom.flipByCtrl?.classList.toggle('section-hidden', !isFlip);
  [swingDom.cardA, swingDom.cardB].forEach((card) => {
    card?.classList.toggle('swing-card-no-cand', isFlip);
  });
  [swingDom.selectCandA, swingDom.selectCandB].forEach((select) => {
    const wrapper = select?.closest('.custom-select-wrapper') || select;
    if (wrapper) wrapper.style.display = isFlip ? 'none' : '';
  });
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

  // Na Virada a cor sai da legenda partidaria do novo vencedor, entao a rampa
  // divergente nao se aplica: o que a legenda precisa explicar e a diferenca
  // entre "virou" (cheio) e "manteve" (apagado).
  if (SWING.metric === 'virada') {
    swingDom.legend.innerHTML = `
      <div class="swing-legend-flip">
        <span><span class="swing-legend-box swing-legend-box-full"></span>Virou (cor padrão do vencedor)</span>
        <span><span class="swing-legend-box swing-legend-box-faded"></span>Manteve (cor clareada)</span>
      </div>
    `;
    return;
  }

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

  // A Virada dispensa escolher candidatura — o vencedor de cada ano sai dos
  // proprios dados. Mas a metadata do ano PRECISA ter carregado, porque e dela
  // que sai o nome/partido usado para dizer se o vencedor e o mesmo.
  const semMetadata = ['A', 'B'].find((side) => !(SWING[side].cands || []).length);
  if (semMetadata) {
    setSwingStatus(`${SWING[semMetadata].year} não teve ${SWING[semMetadata].turno}º turno neste recorte.`, 'warn');
    renderSwingPanel();
    return;
  }

  const vazio = (SWING.metric === 'swing')
    ? ['A', 'B'].find((side) => !SWING[side].candId)
    : null;
  if (vazio) {
    setSwingStatus(`Escolha a candidatura da eleição ${vazio}.`, 'info');
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
      SWING._stationAlias = null;
      SWING._stationAliasPromise = null;
    }
    SWING.selectedKey = null;
    await renderSwingMap();
    renderSwingPanel();

    if (!SWING.rows?.size) {
      setSwingStatus('Nenhuma unidade aparece nas duas eleições.', 'warn');
    } else {
      setSwingStatus(swingStatusSummary(), 'ok');
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

// Redesenho sem recarga. Serve para tudo que so muda a LEITURA dos agregados
// que ja estao em memoria: nivel do mapa, modo (swing/virada), criterio de
// virada e ate a candidatura escolhida — desde a refatoracao que guarda a
// distribuicao completa de votos, nenhum desses depende de ir a rede.
async function swingRedraw(mensagem = 'Redesenhando…') {
  if (!SWING.dataset) return;
  showMapLoading(mensagem);
  try {
    SWING.selectedKey = null;
    await renderSwingMap();
    renderSwingPanel();
    setSwingStatus(swingStatusSummary(), 'ok');
  } catch (error) {
    console.error('[Swing] Falha ao redesenhar:', error);
    showToast(`Swing: ${error.message}`, 'error', 4000);
  } finally {
    hideMapLoading();
  }
}

function swingStatusSummary() {
  const comparadas = SWING.rows?.size || 0;
  const unidade = SWING_LEVEL_SHORT[SWING.level].toLowerCase();
  if (SWING.metric === 'virada') {
    const stats = swingFlipStats();
    return `${fmtInt(stats.flipped)} de ${fmtInt(stats.total)} ${unidade} viraram.`;
  }
  return `${fmtInt(comparadas)} ${unidade} em ambas as eleições.`;
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
  syncSwingMetricUI();
  populateSwingYearSelects();
  renderSwingLevelChips();
  renderSwingLegend();

  swingDom.metricChips?.addEventListener('click', (event) => {
    const btn = event.target.closest('.chip-button');
    if (!btn || btn.classList.contains('active')) return;
    swingDom.metricChips.querySelectorAll('.chip-button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    SWING.metric = btn.dataset.value === 'virada' ? 'virada' : 'swing';
    syncSwingMetricUI();
    renderSwingLegend();
    // Os dois modos saem do MESMO dataset: trocar de modo nao vai a rede.
    if (SWING.dataset) void swingRedraw();
    else scheduleSwingApply();
  });

  swingDom.flipByChips?.addEventListener('click', (event) => {
    const btn = event.target.closest('.chip-button');
    if (!btn || btn.classList.contains('active')) return;
    swingDom.flipByChips.querySelectorAll('.chip-button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    SWING.flipBy = btn.dataset.value === 'candidato' ? 'candidato' : 'partido';
    if (SWING.dataset) void swingRedraw();
  });

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
      // O dataset guarda a distribuicao inteira, entao trocar de candidatura e
      // so reler o mesmo agregado — nada de rede.
      if (SWING.dataset) void swingRedraw();
      else scheduleSwingApply();
    });
  });

  swingDom.levelChips?.addEventListener('click', (event) => {
    const btn = event.target.closest('.chip-button');
    if (!btn || btn.classList.contains('active')) return;
    SWING.level = btn.dataset.value;
    renderSwingLevelChips();
    void swingRedraw();
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
