// Global cache tracker to know what we have loaded
let loadedDeputyState = { uf: null, types: new Set(), year: null };

function normalizePartyAlias(s) {
  let p = (s || '').toUpperCase().trim();
  
  // Normalização de Federações conhecidas (Brasil 2022+)
  if (p.includes('BRASIL DA ESPERANÇA') || p.includes('(FE BRASIL)') || p.includes('PT/PC DO B/PV')) return 'FE Brasil (PT/PCdoB/PV)';
  if (p.includes('PSDB CIDADANIA') || p.includes('PSDB/CIDADANIA')) return 'PSDB/CIDADANIA';
  if (p.includes('PSOL REDE') || p.includes('PSOL/REDE')) return 'PSOL/REDE';
  
  p = p.replace('FEDERAÇÃO ', '');
  p = p.replace('FEDERACAO ', '');
  
  if (p === 'PATRI') return 'PATRIOTA';
  if (p === 'PODE') return 'PODEMOS';
  if (p === 'SD') return 'SOLIDARIEDADE';
  if (p === 'PC DO B' || p === 'PC DO B' || p === 'PCDOB') return 'PC DO B';
  
  return p;
}

function normalizeComp(str) {
  if (!str) return "";
  // Resolve cada item da composição e ordena alfabeticamente
  return str.split('/')
    .map(s => normalizePartyAlias(s))
    .filter(Boolean)
    .sort()
    .join('/');
}

const PRECOMPUTED_PROPORTIONAL_STATE_TOTALS_CACHE = new Map();
const PRECOMPUTED_PROPORTIONAL_MUNICIPAL_TOTALS_CACHE = new Map();

function hasActivePrecomputedScopeBlockingFilters() {
  return (
    STATE.censusFilters.rendaMin !== null ||
    STATE.censusFilters.rendaMax !== null ||
    STATE.censusFilters.racaVal !== null ||
    STATE.censusFilters.idadeVal !== null ||
    STATE.censusFilters.escolaridadeVal !== null ||
    STATE.censusFilters.saneamentoVal !== null
  );
}

function getPrecomputedProportionalKindForCargo(cargo = currentCargo, year = STATE.currentElectionYear) {
  if (String(cargo || '').startsWith('vereador')) {
    return {
      folder: `Municipais_Legislativas ${year}`,
      stateFile: (targetYear, uf) => `precomputed_totals_vereadores_${targetYear}_${uf}.json`,
      municipalZip: (targetYear, uf) => `precomputed_totals_vereadores_${targetYear}_${uf}_municipios.zip`
    };
  }

  if (String(cargo || '').startsWith('deputado')) {
    const office = String(cargo || '').includes('estadual') ? 'estadual' : 'federal';
    return {
      folder: `Legislativas ${year}`,
      stateFile: (targetYear, uf) => `precomputed_totals_deputados_${office}_${targetYear}_${uf}.json`,
      municipalZip: (targetYear, uf) => `precomputed_totals_deputados_${office}_${targetYear}_${uf}_municipios.zip`
    };
  }

  return null;
}

async function loadPrecomputedProportionalStateTotals(cargo, uf, year = STATE.currentElectionYear) {
  const targetYear = String(year || STATE.currentElectionYear);
  const ufNorm = String(uf || '').toUpperCase();
  const config = getPrecomputedProportionalKindForCargo(cargo, targetYear);
  if (!config || !ufNorm) return null;

  const cacheKey = `${cargo}|${targetYear}|${ufNorm}|state`;
  if (PRECOMPUTED_PROPORTIONAL_STATE_TOTALS_CACHE.has(cacheKey)) {
    return PRECOMPUTED_PROPORTIONAL_STATE_TOTALS_CACHE.get(cacheKey);
  }

  const promise = (async () => {
    const response = await fetch(`${DATA_BASE_URL}${config.folder}/${config.stateFile(targetYear, ufNorm)}`).catch(() => null);
    if (!response || !response.ok) return null;
    return response.json();
  })();

  PRECOMPUTED_PROPORTIONAL_STATE_TOTALS_CACHE.set(cacheKey, promise);
  return promise;
}

async function loadPrecomputedProportionalMunicipalityTotals(cargo, uf, municipio, muniCode = '', year = STATE.currentElectionYear) {
  const targetYear = String(year || STATE.currentElectionYear);
  const ufNorm = String(uf || '').toUpperCase();
  const slug = normalizeMunicipioSlug(municipio);
  const code = String(muniCode || '').trim();
  const config = getPrecomputedProportionalKindForCargo(cargo, targetYear);
  if (!config || !ufNorm || (!slug && !code)) return null;

  const cacheKey = `${cargo}|${targetYear}|${ufNorm}|${code || slug}|municipio`;
  if (PRECOMPUTED_PROPORTIONAL_MUNICIPAL_TOTALS_CACHE.has(cacheKey)) {
    return PRECOMPUTED_PROPORTIONAL_MUNICIPAL_TOTALS_CACHE.get(cacheKey);
  }

  const promise = fetchJsonFromZipEntry(
    `${DATA_BASE_URL}${config.folder}/${config.municipalZip(targetYear, ufNorm)}`,
    null,
    (entryName) => {
      if (!entryName.toLowerCase().endsWith('.json')) return false;
      const upperName = String(entryName || '').toUpperCase();
      if (code && upperName.startsWith(`${code}_`)) return true;
      return !!slug && upperName.includes(`_${slug}.JSON`);
    }
  ).then(({ data }) => data || null).catch(() => null);

  PRECOMPUTED_PROPORTIONAL_MUNICIPAL_TOTALS_CACHE.set(cacheKey, promise);
  return promise;
}

function shouldUsePrecomputedProportionalStateScope(cargo = currentCargo) {
  return String(cargo || '').startsWith('deputado')
    && STATE.currentElectionType === 'geral'
    && STATE.isFilterAggregationActive
    && !hasRegionalScopeFilters()
    && currentCidadeFilter === 'all'
    && currentBairroFilter === 'all'
    && !String(currentLocalFilter || '').trim()
    && !hasActivePrecomputedScopeBlockingFilters();
}

function getPrecomputedProportionalStateScope(cargo = currentCargo) {
  if (!shouldUsePrecomputedProportionalStateScope(cargo)) return null;
  return STATE.precomputedProportionalStateTotals?.[cargo]?.state || null;
}

// getPrecomputedMunicipalOverviewSummary saiu daqui: os arquivos
// precomputed_totals_deputados_* nunca existiram em resultados_geo, ela
// chaveava por codigo TSE (que nenhum poligono tem) e carregava um
// ReferenceError latente. O resumo municipal de deputado agora vem de
// buildDeputyMunicipalSummaryFromResults. getPrecomputedProportionalStateScope,
// que e outra coisa (totais estaduais), continua valendo.

