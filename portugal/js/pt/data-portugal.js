// ============================================================================
// data-portugal.js — carregamento e agregação dos dados eleitorais portugueses
//
// Fontes (geradas pelo ETL em etl/):
//   dados/resultados/ar_{ano}.json  — votos por freguesia + agregados + oficiais
//   dados/mapas/freguesias_{ano}.geojson / concelhos_{ano} / distritos_{ano}
// ============================================================================

const PT_YEAR_CACHE = (typeof LRUCache === 'function') ? new LRUCache(4) : new Map();

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao carregar ${url} (${res.status})`);
  return res.json();
}

async function loadAvailableYears() {
  if (AVAILABLE_YEARS) return AVAILABLE_YEARS;
  try {
    const idx = await fetchJson(`${DATA_BASE_URL}index.json`);
    AVAILABLE_YEARS = (idx.years || []).map(String);
  } catch (_) {
    AVAILABLE_YEARS = ['2025', '2022']; // piloto
  }
  return AVAILABLE_YEARS;
}

// Anos disponíveis das presidenciais (dados/pr_index.json).
async function loadAvailablePrYears() {
  if (AVAILABLE_PR_YEARS) return AVAILABLE_PR_YEARS;
  try {
    const idx = await fetchJson(`${DATA_BASE_URL}pr_index.json`);
    AVAILABLE_PR_YEARS = (idx.years || []).map(String);
  } catch (_) {
    AVAILABLE_PR_YEARS = PR_YEARS.map(y => y.value);
  }
  return AVAILABLE_PR_YEARS;
}

// Anos disponíveis das europeias (dados/ee_index.json).
async function loadAvailableEeYears() {
  if (AVAILABLE_EE_YEARS) return AVAILABLE_EE_YEARS;
  try {
    const idx = await fetchJson(`${DATA_BASE_URL}ee_index.json`);
    AVAILABLE_EE_YEARS = (idx.years || []).map(String);
  } catch (_) {
    AVAILABLE_EE_YEARS = EE_YEARS.map(y => y.value);
  }
  return AVAILABLE_EE_YEARS;
}

// Anos disponíveis das autárquicas (dados/au_index.json).
async function loadAvailableAuYears() {
  if (AVAILABLE_AU_YEARS) return AVAILABLE_AU_YEARS;
  try {
    const idx = await fetchJson(`${DATA_BASE_URL}au_index.json`);
    AVAILABLE_AU_YEARS = (idx.years || []).map(String);
  } catch (_) {
    AVAILABLE_AU_YEARS = AU_YEARS.map(y => y.value);
  }
  return AVAILABLE_AU_YEARS;
}

let staticDistritosPromise = null;
function loadStaticDistritos() {
  if (!staticDistritosPromise) {
    staticDistritosPromise = fetchJson(`${DATA_BASE_URL}mapas/distritos.geojson`);
  }
  return staticDistritosPromise;
}

function fixSwappedIslandsGeoJSON(geojson) {
  return geojson;
}

// ====== CENSO / PERFIL DO TERRITÓRIO (INE) ======
// Independente da eleição: cache própria, sem cache-buster (ficheiros estáticos).
const CENSO_CACHE = new Map();
let rendaPromise = null;

// Vintage do censo mais próximo do ano da eleição em visualização.
function censoVintageForYear(year) {
  const y = Number(year) || 2021;
  if (y >= 2016) return 2021;
  if (y >= 2006) return 2011;
  return 2001;
}

function loadCensoVintage(vintage) {
  if (!CENSO_CACHE.has(vintage)) {
    const p = fetchJson(`${DATA_BASE_URL}censo/censo_${vintage}.json`)
      .catch((e) => { CENSO_CACHE.delete(vintage); throw e; });
    CENSO_CACHE.set(vintage, p);
  }
  return CENSO_CACHE.get(vintage);
}

function loadRenda() {
  if (!rendaPromise) {
    rendaPromise = fetchJson(`${DATA_BASE_URL}censo/renda.json`)
      .catch((e) => { rendaPromise = null; throw e; });
  }
  return rendaPromise;
}

// Carrega (com cache) resultados + geometria de um ano (carregamento progressivo).
// As presidenciais (elType='pr') carregam pr_{tag}.json mas reutilizam a geometria
// do ano AR mais próximo (PR_MAP_YEAR).
async function loadYearData(year, elType = STATE.currentElectionType) {
  const tag = String(year);
  const key = elType === 'au' ? `${elType}:${STATE.auSubtype}:${tag}` : `${elType}:${tag}`;
  const cached = PT_YEAR_CACHE.get(key);
  if (cached) return cached;

  let prefix;
  let mapYear;
  if (elType === 'au') {
    prefix = `au_${STATE.auSubtype}`;
    mapYear = AU_MAP_YEAR[tag] || tag;
  } else {
    prefix = { pr: 'pr', ee: 'ee' }[elType] || 'ar';
    mapYear = elType === 'pr' ? (PR_MAP_YEAR[tag] || tag)
      : elType === 'ee' ? (EE_MAP_YEAR[tag] || tag) : tag;
  }

  showMapLoading(`A carregar ${tag}...`, 15);
  const [data, distritosRaw, concelhosRaw, estrangeiroEuropa, estrangeiroMundo] = await Promise.all([
    fetchJson(`${DATA_BASE_URL}resultados/${prefix}_${tag}.json?v=${Date.now()}`),
    loadStaticDistritos(),
    fetchJson(`${DATA_BASE_URL}mapas/concelhos_${mapYear}.geojson`),
    fetchJson(`${DATA_BASE_URL}mapas/estrangeiro_europa.geojson`),
    fetchJson(`${DATA_BASE_URL}mapas/estrangeiro_mundo.geojson`)
  ]);

  const distritos = fixSwappedIslandsGeoJSON(JSON.parse(JSON.stringify(distritosRaw)));
  const concelhos = fixSwappedIslandsGeoJSON(concelhosRaw);

  const bundle = {
    data,
    geo: {
      distritos,
      concelhos,
      estrangeiroEuropa,
      estrangeiroMundo,
      freguesias: null
    },
    freguesiasLoaded: false
  };

  // Carregar freguesias em fundo
  bundle.freguesiasReady = (async () => {
    try {
      const freguesias = await fetchJson(`${DATA_BASE_URL}mapas/freguesias_${mapYear}.geojson`);
      bundle.geo.freguesias = fixSwappedIslandsGeoJSON(freguesias);
      bundle.freguesiasLoaded = true;
      return bundle.geo.freguesias;
    } catch (e) {
      console.error(`Erro ao carregar freguesias em fundo para o ano ${key}:`, e);
      throw e;
    }
  })();

  PT_YEAR_CACHE.set(key, bundle);
  return bundle;
}

// ====== AGREGAÇÃO / CONSULTA ======

function sumVotesMaps(list) {
  const out = {};
  for (const votes of list) {
    if (!votes) continue;
    for (const [p, v] of Object.entries(votes)) out[p] = (out[p] || 0) + v;
  }
  return out;
}

function sumFreguesias(dicofreSet) {
  const results = STATE.data?.RESULTS || {};
  const list = [];
  dicofreSet.forEach((code) => { if (results[code]) list.push(results[code]); });
  return sumVotesMaps(list);
}

function getNationalEntry() {
  const d = STATE.data;
  if (!d) return null;
  if (NATIONAL_SCOPE_MODE === 'global' && d.METADATA?.global) {
    return Object.assign({ isGlobal: true }, d.METADATA.global);
  }
  return d.METADATA?.national || {};
}

// Devolve { votes, official, nome } para o âmbito atual.
// official = { inscritos, votantes, brancos, nulos, mandatos, mandatos_p } quando existir.
function getScopeData(scope = STATE.scope) {
  const d = STATE.data;
  if (!d) return null;

  if (selectedLocationIDs.size > 0) {
    let sumInsc = 0, sumVot = 0, sumBra = 0, sumNul = 0;
    let allOfficialExist = true;
    selectedLocationIDs.forEach((code) => {
      const offVal = d.OFFICIAL_F?.[code];
      if (offVal) {
        sumInsc += offVal[0];
        sumVot += offVal[1];
        sumBra += offVal[2];
        sumNul += offVal[3];
      } else {
        allOfficialExist = false;
      }
    });
    return {
      votes: sumFreguesias(selectedLocationIDs),
      official: allOfficialExist ? {
        inscritos: sumInsc,
        votantes: sumVot,
        brancos: sumBra,
        nulos: sumNul
      } : null,
      nome: `${selectedLocationIDs.size} freguesias selecionadas`,
      level: 'selecao'
    };
  }

  if (STATE.currentNuts) {
    const level = scope?.level || 'national';
    let matchingFreguesias = [];
    let scopeName = '';
    
    if (level === 'freguesia' && scope.key) {
      const dico = scope.key.slice(0, 4);
      if (window.isConcelhoInNuts && window.isConcelhoInNuts(dico)) {
        const offVal = d.OFFICIAL_F?.[scope.key];
        const official = offVal ? {
          inscritos: offVal[0],
          votantes: offVal[1],
          brancos: offVal[2],
          nulos: offVal[3],
          mandatos: offVal[4],
          mandatos_p: offVal[5]
        } : null;
        return {
          votes: d.RESULTS[scope.key] || {},
          official,
          nome: d.NAMES?.[scope.key] || scope.key,
          level
        };
      } else {
        return {
          votes: {},
          official: null,
          nome: d.NAMES?.[scope.key] || scope.key,
          level
        };
      }
    }
    
    if (level === 'concelho' && scope.key) {
      if (window.isConcelhoInNuts && window.isConcelhoInNuts(scope.key)) {
        const entry = d.AGG?.concelho?.[scope.key];
        return {
          votes: entry?.votes || {},
          official: (entry && 'inscritos' in entry) ? entry : null,
          nome: scope.nome || scope.key,
          level
        };
      } else {
        return {
          votes: {},
          official: null,
          nome: scope.nome || scope.key,
          level
        };
      }
    }
    
    if (level === 'distrito' && scope.key) {
      matchingFreguesias = Object.keys(d.RESULTS || {}).filter(code => {
        const circ = code.slice(0, 2);
        if (circ !== scope.key) return false;
        const dico = code.slice(0, 4);
        return window.isConcelhoInNuts && window.isConcelhoInNuts(dico);
      });
      scopeName = CIRCULOS.get(scope.key) || scope.key;
    } else if (level === 'national') {
      matchingFreguesias = Object.keys(d.RESULTS || {}).filter(code => {
        const dico = code.slice(0, 4);
        return window.isConcelhoInNuts && window.isConcelhoInNuts(dico);
      });
      scopeName = 'Portugal';
    }
    
    if (matchingFreguesias.length > 0) {
      let sumInsc = 0, sumVot = 0, sumBra = 0, sumNul = 0;
      matchingFreguesias.forEach(code => {
        const offVal = d.OFFICIAL_F?.[code];
        if (offVal) {
          sumInsc += offVal[0];
          sumVot += offVal[1];
          sumBra += offVal[2];
          sumNul += offVal[3];
        }
      });
      
      // Agregar mandatos e mandatos_p para distritos ativos que pertençam ao filtro NUTS
      let sumMandatos = 0;
      const sumMandatosP = {};
      const activeDistricts = new Set();
      
      if (typeof NUTS_DATA !== 'undefined') {
        Object.keys(NUTS_DATA).forEach(dicoKey => {
          if (window.isConcelhoInNuts && window.isConcelhoInNuts(dicoKey)) {
            activeDistricts.add(dicoKey.slice(0, 2));
          }
        });
      }
      
      if (level === 'distrito' && scope.key) {
        // Se estamos focados num distrito específico sob o filtro NUTS, apenas contamos os mandatos desse distrito
        const distEntry = d.AGG?.distrito?.[scope.key];
        if (distEntry) {
          if (typeof distEntry.mandatos === 'number') sumMandatos = distEntry.mandatos;
          if (distEntry.mandatos_p) {
            for (const [p, s] of Object.entries(distEntry.mandatos_p)) {
              sumMandatosP[p] = s;
            }
          }
        }
      } else {
        activeDistricts.forEach(distId => {
          const distEntry = d.AGG?.distrito?.[distId];
          if (distEntry) {
            if (typeof distEntry.mandatos === 'number') {
              sumMandatos += distEntry.mandatos;
            }
            if (distEntry.mandatos_p) {
              for (const [p, s] of Object.entries(distEntry.mandatos_p)) {
                sumMandatosP[p] = (sumMandatosP[p] || 0) + s;
              }
            }
          }
        });
      }
      
      const filterLabel = document.getElementById('selectNuts')?.options[document.getElementById('selectNuts').selectedIndex]?.text || 'Região';
      
      return {
        votes: sumFreguesias(new Set(matchingFreguesias)),
        official: {
          inscritos: sumInsc,
          votantes: sumVot,
          brancos: sumBra,
          nulos: sumNul,
          mandatos: sumMandatos,
          mandatos_p: sumMandatosP
        },
        nome: `${scopeName} (${filterLabel})`,
        level
      };
    } else {
      return {
        votes: {},
        official: null,
        nome: scopeName,
        level
      };
    }
  }

  const level = scope?.level || 'national';
  if (level === 'freguesia' && scope.key) {
    const offVal = d.OFFICIAL_F?.[scope.key];
    const official = offVal ? {
      inscritos: offVal[0],
      votantes: offVal[1],
      brancos: offVal[2],
      nulos: offVal[3],
      mandatos: offVal[4],
      mandatos_p: offVal[5]
    } : null;
    return {
      votes: d.RESULTS[scope.key] || {},
      official: official,
      nome: d.NAMES?.[scope.key] || scope.key,
      level
    };
  }
  if (level === 'concelho' && scope.key) {
    const entry = d.AGG?.concelho?.[scope.key];
    return {
      votes: entry?.votes || {},
      official: (entry && 'inscritos' in entry) ? entry : null,
      nome: scope.nome || scope.key,
      level
    };
  }
  if (level === 'distrito' && scope.key) {
    if (STATE.selectedCountry && (scope.key === 'E1' || scope.key === 'E2')) {
      const cData = d.COUNTRIES?.[scope.key]?.[STATE.selectedCountry];
      if (cData) {
        return {
          votes: cData.votes || {},
          official: cData,
          nome: STATE.selectedCountry,
          level
        };
      }
    }
    const entry = d.AGG?.distrito?.[scope.key];
    return {
      votes: entry?.votes || {},
      official: (entry && 'inscritos' in entry) ? entry : null,
      nome: CIRCULOS.get(scope.key) || scope.key,
      level
    };
  }
  const nat = getNationalEntry() || {};
  return {
    votes: nat.votes || {},
    official: ('inscritos' in nat) ? nat : null,
    nome: 'Portugal',
    level: 'national'
  };
}

// Território onde NÃO houve votação (registo explícito no ETL, METADATA.no_election)
// — ex.: concelho de Murça e suas freguesias nas Europeias de 2014. Não confundir
// com falta de dados/cobertura (freguesias soltas em falta noutros anos).
function territoryHasNoElection(id) {
  const list = STATE.data?.METADATA?.no_election;
  return Array.isArray(list) && id != null && list.includes(String(id));
}

// ====== HELPERS PUROS ======

function getWinner(votes) {
  let winner = null, best = -1, second = -1, total = 0;
  for (const [p, v] of Object.entries(votes || {})) {
    total += v;
    if (v > best) { second = best; best = v; winner = p; }
    else if (v > second) { second = v; }
  }
  if (!winner || total <= 0) return null;
  return {
    party: winner,
    votes: best,
    pct: (best / total) * 100,
    marginPct: ((best - Math.max(0, second)) / total) * 100,
    total
  };
}

function getPartyPct(votes, party) {
  if (!votes || !party) return null;
  let total = 0;
  for (const v of Object.values(votes)) total += v;
  if (total <= 0) return null;
  return ((votes[party] || 0) / total) * 100;
}

// Estatísticas nacionais do partido para o modo desempenho (min/max % por freguesia)
function computePerformanceStats(party) {
  const results = STATE.data?.RESULTS || {};
  let minPct = Infinity, maxPct = -Infinity, count = 0;
  for (const votes of Object.values(results)) {
    const pct = getPartyPct(votes, party);
    if (pct === null) continue;
    if (pct < minPct) minPct = pct;
    if (pct > maxPct) maxPct = pct;
    count++;
  }
  if (!count || !isFinite(minPct)) return null;
  return { party, minPct, maxPct, count };
}

// Lista de partidos do ano corrente, ordenada por votos nacionais.
function getYearParties() {
  const d = STATE.data;
  if (!d) return [];
  const national = d.METADATA?.national?.votes || {};
  return Object.keys(d.METADATA?.parties || {})
    .sort((a, b) => (national[b] || 0) - (national[a] || 0));
}

function auWinnerKey(level, id) {
  const d = STATE.data;
  if (!d) return null;
  if (STATE.currentElectionType !== 'au') return null;

  if (STATE.auSubtype === 'cm' && level === 'distrito') {
    const pres = d.AGG?.distrito?.[id]?.presidents;
    if (!pres || !Object.keys(pres).length) return null;
    let bestParty = null, maxP = -1;
    for (const [p, v] of Object.entries(pres)) {
      if (v > maxP) { maxP = v; bestParty = p; }
    }
    return bestParty;
  }
  
  let votes = null;
  if (level === 'freguesia') {
    votes = d.RESULTS?.[id];
  } else if (level === 'concelho') {
    votes = d.AGG?.concelho?.[id]?.votes;
  } else if (level === 'distrito') {
    votes = d.AGG?.distrito?.[id]?.votes;
  }
  
  if (!votes || !Object.keys(votes).length) return null;
  let winner = null, best = -1;
  for (const [p, v] of Object.entries(votes)) {
    if (v > best) { best = v; winner = p; }
  }
  return winner;
}
