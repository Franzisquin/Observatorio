const PRESIDENT_HISTORY_CACHE = new Map();
let PRESIDENT_HISTORY_RENDER_TOKEN = 0;
let SELECTED_MAJOR_HISTORY_CARGO = 'presidente';
let HISTORY_CARGO_USER_SELECTED = false;
let LAST_HISTORY_CONTEXT_CARGO = '';
let PRESIDENT_HISTORY_USER_EXPANDED = false;

const MAJOR_HISTORY_CONFIG = {
  presidente: {
    cargo: 'presidente',
    label: 'Presidente',
    title: 'Histórico presidencial',
    folder: 'Historico Presidente',
    filePrefix: 'historico_presidente',
    cacheVersion: '20260621a'
  },
  governador: {
    cargo: 'governador',
    label: 'Governador',
    title: 'Histórico governador',
    folder: 'Historico Governador',
    filePrefix: 'historico_governador',
    cacheVersion: '20260621a'
  },
  senador: {
    cargo: 'senador',
    label: 'Senador',
    title: 'Histórico senador',
    folder: 'Historico Senador',
    filePrefix: 'historico_senador',
    cacheVersion: '20260621a'
  },
  prefeito: {
    cargo: 'prefeito',
    label: 'Prefeito',
    title: 'Histórico prefeito',
    folder: 'Historico Prefeito',
    filePrefix: 'historico_prefeito',
    cacheVersion: '20260621a',
    municipal: true
  }
};

function normalizeHistoryText(value) {
  const base = String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalizeHistorySchoolTerms(base);
}

function normalizeHistorySchoolTerms(text) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const expanded = [];

  for (let i = 0; i < words.length; i++) {
    const one = words[i];
    const two = words.slice(i, i + 2).join(' ');

    if (one === 'E' && words[i + 1] === 'E') {
      expanded.push('ESCOLA', 'ESTADUAL');
      i += 1;
      continue;
    }

    if (['E', 'EM', 'E M', 'ESC', 'ESCOLA'].includes(one)) {
      if (words[i + 1] && ['M', 'MUN', 'MUNIC', 'MUNICIPAL'].includes(words[i + 1])) {
        expanded.push('ESCOLA', 'MUNICIPAL');
        i += 1;
        continue;
      }
      if (one === 'EM' || one === 'E M') {
        expanded.push('ESCOLA', 'MUNICIPAL');
        continue;
      }
      if (one === 'ESC' || one === 'ESCOLA') {
        expanded.push('ESCOLA');
        continue;
      }
    }

    if (one === 'MUN' || one === 'MUNIC') {
      expanded.push('MUNICIPAL');
    } else if (two === 'ENS FUND') {
      expanded.push('ENSINO', 'FUNDAMENTAL');
      i += 1;
    } else if (one === 'ENS' || one === 'ENSINO') {
      expanded.push('ENSINO');
    } else if (one === 'FUND' || one === 'FUNDAMENTAL') {
      expanded.push('FUNDAMENTAL');
    } else if (one === 'EST' || one === 'ESTAD') {
      expanded.push('ESTADUAL');
    } else if (one === 'PROF' || one === 'PROFA' || one === 'PROFESSORA') {
      expanded.push('PROFESSOR');
    } else if (one === 'DR' || one === 'DOUTOR') {
      expanded.push('DOUTOR');
    } else if (one === 'DRA' || one === 'DOUTORA') {
      expanded.push('DOUTORA');
    } else {
      expanded.push(one);
    }
  }

  return expanded.join(' ');
}

function getHistoryNameCoreTokens(value) {
  const stopwords = new Set([
    'ESCOLA', 'MUNICIPAL', 'ESTADUAL', 'ESTADO', 'ENSINO', 'FUNDAMENTAL',
    'COLEGIO', 'GRUPO', 'CENTRO', 'EDUCACIONAL', 'UNIDADE', 'INTEGRADA',
    'PROFESSOR', 'PROF', 'DOUTOR', 'DOUTORA', 'DR', 'DRA', 'DE', 'DA',
    'DO', 'DAS', 'DOS', 'EM', 'EE', 'EMEF', 'EMEI', 'CMEI', 'CEI',
    'CRECHE', 'INSTITUTO', 'COMPLEXO', 'ANEXO', 'CIEP', 'BRIZOLAO'
  ]);
  return normalizeHistoryText(value)
    .split(' ')
    .filter((token) => token.length > 1 && !stopwords.has(token));
}

function getHistoryLooseNameCoreTokens(value) {
  return getHistoryNameCoreTokens(value).map((token) => token.replace(/Y/g, 'I'));
}

function getHistoryNameCorePairKeys(tokens) {
  if (!tokens || tokens.length < 2 || tokens.length > 6) return [];
  const keys = [];
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j < tokens.length; j++) {
      keys.push(`${tokens[i]}|${tokens[j]}`);
    }
  }
  return keys;
}

function getHistorySchoolNumberTokens(value) {
  return normalizeHistoryText(value)
    .split(' ')
    .filter((token) => /^\d{2,5}$/.test(token));
}

function getPresidentHistoryContainer() {
  let container = document.getElementById('presidentHistoryContainer');
  if (container) return container;

  container = document.createElement('div');
  container.id = 'presidentHistoryContainer';
  container.className = 'president-history hidden';

  const neighborhood = document.getElementById('neighborhoodProfile');
  if (neighborhood?.parentNode) {
    neighborhood.parentNode.insertBefore(container, neighborhood);
  } else if (dom.resultsMetrics?.parentNode) {
    dom.resultsMetrics.parentNode.insertBefore(container, dom.resultsMetrics.nextSibling);
  }
  return container;
}

function hidePresidentHistoryPanel() {
  const container = getPresidentHistoryContainer();
  container.classList.add('hidden');
  container.innerHTML = '';
}

function shouldShowPresidentHistory(props) {
  return (STATE.currentElectionType === 'geral' || STATE.currentElectionType === 'municipal')
    && selectedLocationIDs.size === 1
    && !STATE.isFilterAggregationActive
    && props
    && Object.keys(props).length > 0;
}

function isDistrictFederalHistoryProps(props) {
  const uf = String(getProp(props, 'sg_uf') || getProp(props, 'SG_UF') || '').toUpperCase();
  return uf === 'DF';
}

function getAvailableHistoryConfigs(props = null) {
  return Object.values(MAJOR_HISTORY_CONFIG)
    .filter((config) => !(config.cargo === 'prefeito' && isDistrictFederalHistoryProps(props)));
}

function normalizeSelectedHistoryCargo(props = null) {
  const contextCargo = `${STATE.currentElectionType || ''}:${currentCargo || ''}`;
  const cargoFromContext = getDefaultHistoryCargoFromCurrentCargo();
  if (contextCargo !== LAST_HISTORY_CONTEXT_CARGO) {
    LAST_HISTORY_CONTEXT_CARGO = contextCargo;
    HISTORY_CARGO_USER_SELECTED = false;
  }
  if (!HISTORY_CARGO_USER_SELECTED && cargoFromContext) {
    SELECTED_MAJOR_HISTORY_CARGO = cargoFromContext;
  }

  const available = getAvailableHistoryConfigs(props);
  if (!available.some((config) => config.cargo === SELECTED_MAJOR_HISTORY_CARGO)) {
    SELECTED_MAJOR_HISTORY_CARGO = available[0]?.cargo || 'presidente';
  }
  return SELECTED_MAJOR_HISTORY_CARGO;
}

function getDefaultHistoryCargoFromCurrentCargo() {
  const cargo = String(currentCargo || '').toLowerCase();
  if (cargo.startsWith('governador')) return 'governador';
  if (cargo.startsWith('senador')) return 'senador';
  if (cargo.startsWith('prefeito')) return 'prefeito';
  if (cargo.startsWith('presidente')) return 'presidente';
  return STATE.currentElectionType === 'municipal' ? 'prefeito' : 'presidente';
}

function getMunicipalHistoryCode(props) {
  const directCode = String(
    getProp(props, 'CD_MUNICIPIO')
    || getProp(props, 'cd_localidade_tse')
    || getProp(props, 'cod_localidade_tse')
    || getProp(props, 'cd_municipio')
    || ''
  ).trim();
  if (directCode) return directCode;

  const localKey = String(
    getProp(props, 'id_unico')
    || getProp(props, 'ID_UNICO')
    || getProp(props, 'local_key')
    || ''
  ).trim();
  const parts = localKey.split('_');
  return parts.length >= 3 ? parts[1] : '';
}

async function loadMajorHistoryUf(cargo, uf) {
  const config = MAJOR_HISTORY_CONFIG[cargo] || MAJOR_HISTORY_CONFIG.presidente;
  const ufNorm = String(uf || '').toUpperCase();
  if (!ufNorm) return null;
  const cacheKey = `${config.cargo}:${ufNorm}`;
  if (PRESIDENT_HISTORY_CACHE.has(cacheKey)) return PRESIDENT_HISTORY_CACHE.get(cacheKey);

  const jsonName = `${config.filePrefix}_${ufNorm}.json`;
  const zipUrl = `${DATA_BASE_URL}${config.folder}/${config.filePrefix}_${ufNorm}.zip?v=${config.cacheVersion}`;
  const jsonUrl = `${DATA_BASE_URL}${config.folder}/${jsonName}?v=${config.cacheVersion}`;
  const promise = (async () => {
    if (typeof fetchJsonFromZipEntry === 'function') {
      try {
        const { data } = await fetchJsonFromZipEntry(zipUrl, jsonName);
        return data;
      } catch (error) {
        console.warn(`[Histórico] Falha ao carregar ZIP ${config.cargo} ${ufNorm}, tentando JSON solto:`, error);
      }
    }

    const res = await fetch(jsonUrl);
    if (!res.ok) throw new Error(`${config.title} indisponível para ${ufNorm}`);
    return res.json();
  })();
  PRESIDENT_HISTORY_CACHE.set(cacheKey, promise);
  return promise;
}

async function loadMajorHistoryForProps(cargo, props) {
  const config = MAJOR_HISTORY_CONFIG[cargo] || MAJOR_HISTORY_CONFIG.presidente;
  const uf = String(getProp(props, 'sg_uf') || getProp(props, 'SG_UF') || '').toUpperCase();
  if (!config.municipal) return loadMajorHistoryUf(cargo, uf);

  const municipioCode = getMunicipalHistoryCode(props);
  if (!uf || !municipioCode) throw new Error('Histórico de prefeito sem código municipal');
  const cacheKey = `${config.cargo}:${uf}:${municipioCode}`;
  if (PRESIDENT_HISTORY_CACHE.has(cacheKey)) return PRESIDENT_HISTORY_CACHE.get(cacheKey);

  const jsonName = `${config.filePrefix}_${municipioCode}.json`;
  const outerZipUrl = `${DATA_BASE_URL}${config.folder}/${config.filePrefix}_${uf}.zip?v=${config.cacheVersion}`;
  const innerZipName = `${config.filePrefix}_${municipioCode}.zip`;
  const promise = (async () => {
    if (typeof fetchBlobFromZipEntry === 'function' && typeof unzipit !== 'undefined') {
      return fetchJsonFromNestedZipEntry(outerZipUrl, innerZipName, jsonName);
    }
    throw new Error('Leitor de ZIP indisponível para histórico de prefeito');
  })();
  PRESIDENT_HISTORY_CACHE.set(cacheKey, promise);
  return promise;
}

async function fetchJsonFromNestedZipEntry(outerZipUrl, innerZipName, jsonName) {
  const { blob: innerZipBlob } = await fetchBlobFromZipEntry(outerZipUrl, innerZipName);
  const innerReader = await unzipit.unzip(innerZipBlob);
  const found = findZipEntryInReader(innerReader, jsonName);
  if (!found) throw new Error(`JSON ${jsonName} não encontrado em ${innerZipName}`);
  const jsonBlob = await found.entry.blob();
  return JSON.parse(await jsonBlob.text());
}

async function loadPresidentHistoryUf(uf) {
  return loadMajorHistoryUf('presidente', uf);
}

function getPresidentRunoffShiftSide(turn) {
  const party = String(turn?.partido || '').toUpperCase();
  const name = normalizeHistoryText(turn?.vencedor || '');
  if (party === 'PT' || ['LULA', 'DILMA', 'FERNANDO HADDAD'].some((token) => name.includes(token))) {
    return 'left';
  }
  if (['PSDB', 'PSL', 'PL'].includes(party)
    || ['GERALDO ALCKMIN', 'JOSE SERRA', 'AECIO NEVES', 'JAIR BOLSONARO'].some((token) => name.includes(token))) {
    return 'right';
  }
  return '';
}

function getPresidentRunoffSideForCandidate(name, party) {
  const partyNorm = String(party || '').toUpperCase();
  const nameNorm = normalizeHistoryText(name || '');
  if (partyNorm === 'PT' || ['LULA', 'DILMA', 'FERNANDO HADDAD'].some((token) => nameNorm.includes(token))) {
    return 'left';
  }
  if (['PSDB', 'PSL', 'PL'].includes(partyNorm)
    || ['GERALDO ALCKMIN', 'JOSE SERRA', 'AECIO NEVES', 'JAIR BOLSONARO'].some((token) => nameNorm.includes(token))) {
    return 'right';
  }
  return '';
}

function getPresidentRunoffSignedMargin(record) {
  const turn = (record?.turnos || []).find((item) => String(item.turno || '').toUpperCase() === '2T');
  if (!turn) return null;
  const winnerSide = getPresidentRunoffShiftSide(turn);
  if (!winnerSide) return null;

  const winnerPct = Math.max(0, ensureNumber(turn.pct));
  const runnerSide = getPresidentRunoffSideForCandidate(turn.segundo, turn.segundo_partido);
  const runnerPct = Math.max(0, ensureNumber(turn.segundo_pct));

  if (winnerSide === 'left') {
    return winnerPct - (runnerSide === 'right' ? runnerPct : 0);
  }
  return (runnerSide === 'left' ? runnerPct : 0) - winnerPct;
}

function getPresidentRunoffRecordByYear(records, props, year) {
  const displayRecords = getPresidentHistoryDisplayRecords(records, props);
  return displayRecords.find((record) => String(record.ano) === String(year)) || null;
}

async function resolvePresidentRunoffShiftForProps(props, currentYear, previousYear) {
  if (!props || !currentYear || !previousYear) return null;
  const history = await loadMajorHistoryForProps('presidente', props);
  const resolved = resolvePresidentHistoryIdentity(history, props);
  if (!resolved?.identity?.records?.length) return null;

  const currentRecord = getPresidentRunoffRecordByYear(resolved.identity.records, props, currentYear);
  const previousRecord = getPresidentRunoffRecordByYear(resolved.identity.records, props, previousYear);
  const currentMargin = getPresidentRunoffSignedMargin(currentRecord);
  const previousMargin = getPresidentRunoffSignedMargin(previousRecord);
  if (!Number.isFinite(currentMargin) || !Number.isFinite(previousMargin)) return null;

  const currentTurn = (currentRecord?.turnos || []).find((item) => String(item.turno || '').toUpperCase() === '2T') || null;
  const previousTurn = (previousRecord?.turnos || []).find((item) => String(item.turno || '').toUpperCase() === '2T') || null;

  return {
    shift: currentMargin - previousMargin,
    currentMargin,
    previousMargin,
    currentYear: String(currentYear),
    previousYear: String(previousYear),
    currentTurn,
    previousTurn,
    match: resolved.match
  };
}

function buildPresidentHistoryAliases(props) {
  const aliases = [];
  const pushAlias = (kind, value) => {
    const clean = String(value || '').trim();
    if (!clean) return;
    const alias = `${kind}:${clean}`;
    if (!aliases.includes(alias)) aliases.push(alias);
  };

  const uf = String(getProp(props, 'sg_uf') || getProp(props, 'SG_UF') || '').toUpperCase();
  const localKey = getProp(props, 'id_unico') || getProp(props, 'ID_UNICO') || getProp(props, 'local_key');
  const zona = parseInt(getProp(props, 'nr_zona') || getProp(props, 'NR_ZONA'), 10);
  const local = parseInt(getProp(props, 'nr_locvot') || getProp(props, 'nr_local_votacao') || getProp(props, 'NR_LOCAL_VOTACAO'), 10);
  const city = normalizeHistoryText(getProp(props, 'nm_localidade'));
  const name = normalizeHistoryText(getProp(props, 'nm_locvot'));
  const coreTokens = getHistoryNameCoreTokens(getProp(props, 'nm_locvot'));
  const core = coreTokens.join(' ');
  const looseCoreTokens = getHistoryLooseNameCoreTokens(getProp(props, 'nm_locvot'));
  const looseCore = looseCoreTokens.join(' ');
  const schoolNumbers = getHistorySchoolNumberTokens(getProp(props, 'nm_locvot'));
  const bairro = normalizeHistoryText(getProp(props, 'ds_bairro'));
  const address = normalizeHistoryText(getProp(props, 'ds_endereco') || getProp(props, 'ds_enderec'));
  const lat = Number(getProp(props, 'lat'));
  const lon = Number(getProp(props, 'long'));

  // Identidade calculada offline (scripts/gerar_identidade_historico.py) e gravada
  // tanto no GPKG quanto nos arquivos de historico. Quando existe, e busca exata e
  // dispensa toda a escada abaixo — que continua ai para os locais sem hist_id.
  pushAlias('hist_id', getProp(props, 'hist_id'));

  pushAlias('local_key', localKey);
  if (uf && city && Number.isFinite(zona) && Number.isFinite(local)) {
    pushAlias('city_zone_local', `${uf}|${city}|${zona}_${local}`);
  }
  if (uf && city && name && bairro) {
    pushAlias('name_bairro', `${uf}|${city}|${name}|${bairro}`);
  }
  if (uf && city && name && name.length >= 10) {
    pushAlias('name_city', `${uf}|${city}|${name}`);
  }
  if (uf && city && bairro && core && core.length >= 6) {
    pushAlias('name_core_bairro', `${uf}|${city}|${bairro}|${core}`);
    getHistoryNameCorePairKeys(coreTokens).forEach((pairKey) => {
      pushAlias('name_core_pair_bairro', `${uf}|${city}|${bairro}|${pairKey}`);
    });
  }
  if (uf && city && looseCore && looseCoreTokens.length >= 3 && looseCore.length >= 14) {
    pushAlias('name_core_city_loose', `${uf}|${city}|${looseCore}`);
  }
  schoolNumbers.forEach((numberToken) => {
    if (uf && city && bairro) {
      pushAlias('school_number_bairro', `${uf}|${city}|${bairro}|${numberToken}`);
    }
  });
  if (uf && city && address && bairro) {
    pushAlias('address_bairro', `${uf}|${city}|${address}|${bairro}`);
  }
  if (uf && Number.isFinite(lat) && Number.isFinite(lon)) {
    pushAlias('coord', `${uf}|${lat.toFixed(5)}|${lon.toFixed(5)}`);
  }

  return aliases;
}

function resolvePresidentHistoryIdentity(history, props) {
  const aliases = buildPresidentHistoryAliases(props);
  let best = null;

  aliases.forEach((alias) => {
    const found = history.aliases?.[alias];
    if (!found) return;

    let normalizedFound = null;
    if (Array.isArray(found)) {
      const match = history.match_types?.[found[1]] || 'local_key';
      const confidenceByMatch = {
        // Acima de local_key: o hist_id ja sabe que a escola trocou de zona/local
        // entre eleicoes, e que o TSE as vezes reusa um numero de local para outro
        // predio. Quando ele existe, tem de ganhar de qualquer heuristica.
        hist_id: 1.2,
        local_key: 1,
        city_zone_local: 0.8,
        name_bairro: 0.65,
        name_city: 0.6,
        name_core_bairro: 0.58,
        name_core_pair_bairro: 0.52,
        name_core_city_loose: 0.54,
        school_number_bairro: 0.56,
        address_bairro: 0.65,
        coord: 0.4
      };
      normalizedFound = {
        identity_id: found[0],
        match,
        confidence: confidenceByMatch[match] || 0.4
      };
    } else if (found.identity_id) {
      normalizedFound = found;
    }

    if (!normalizedFound) return;
    if (!best || ensureNumber(normalizedFound.confidence) > ensureNumber(best.confidence)) {
      best = { ...normalizedFound, alias };
    }
  });

  if (!best) return null;
  const rawIdentity = history.identities?.[best.identity_id];
  const identity = normalizePresidentHistoryIdentity(rawIdentity);
  if (!identity?.records?.length) return null;
  return { identity, match: best };
}

function normalizePresidentHistoryIdentity(rawIdentity) {
  if (!rawIdentity) return null;
  if (rawIdentity.records) return rawIdentity;

  if (!Array.isArray(rawIdentity)) return null;
  return {
    records: rawIdentity.map((record) => ({
      ano: record[0],
      municipio: record[1],
      nome: record[2],
      bairro: record[3],
      zona: record[4],
      local: record[5],
      local_id: record[6],
      turnos: (record[7] || []).map((turn) => ({
        turno: turn[0],
        vencedor: turn[1],
        partido: turn[2],
        status: turn[3],
        votos: turn[4],
        pct: turn[5],
        segundo: turn[6],
        segundo_partido: turn[7],
        segundo_votos: turn[8],
        segundo_pct: turn[9],
        margem_votos: turn[10],
        margem_pct: turn[11],
        total_validos: turn[12],
        brancos: turn[13],
        nulos: turn[14],
        comparecimento: turn[15]
      }))
    }))
  };
}

function getHistoryMatchLabel(match) {
  const kind = match?.match || '';
  if (kind === 'local_key') return 'match exato';
  if (kind === 'city_zone_local') return 'provável por zona/local';
  if (kind === 'name_bairro') return 'provável por nome/bairro';
  if (kind === 'name_city') return 'provável por nome';
  if (kind === 'name_core_bairro') return 'provável por nome';
  if (kind === 'name_core_pair_bairro') return 'possível por nome';
  if (kind === 'school_number_bairro') return 'provável por código/nome';
  if (kind === 'address_bairro') return 'provável por endereço';
  if (kind === 'coord') return 'possível por coordenada';
  return 'vínculo histórico';
}

function getHistoryMatchClass(match) {
  const confidence = ensureNumber(match?.confidence);
  if (confidence >= 1) return 'strong';
  if (confidence >= 0.65) return 'probable';
  return 'weak';
}

function getPresidentHistoryRecordScore(record, props) {
  let score = 0;

  const selectedLocalKey = String(getProp(props, 'id_unico') || getProp(props, 'ID_UNICO') || getProp(props, 'local_key') || '').trim();
  const selectedZona = parseInt(getProp(props, 'nr_zona') || getProp(props, 'NR_ZONA'), 10);
  const selectedLocal = parseInt(getProp(props, 'nr_locvot') || getProp(props, 'nr_local_votacao') || getProp(props, 'NR_LOCAL_VOTACAO'), 10);
  const selectedLocalId = Number.isFinite(selectedZona) && Number.isFinite(selectedLocal)
    ? `${selectedZona}_${selectedLocal}`
    : '';
  const selectedCity = normalizeHistoryText(getProp(props, 'nm_localidade'));
  const selectedName = normalizeHistoryText(getProp(props, 'nm_locvot'));
  const selectedBairro = normalizeHistoryText(getProp(props, 'ds_bairro'));
  const selectedAddress = normalizeHistoryText(getProp(props, 'ds_endereco') || getProp(props, 'ds_enderec'));
  const selectedLat = Number(getProp(props, 'lat'));
  const selectedLon = Number(getProp(props, 'long'));

  if (selectedLocalKey && record.local_key === selectedLocalKey) score += 120;
  if (selectedLocalId && record.local_id === selectedLocalId) score += 80;
  if (selectedCity && normalizeHistoryText(record.municipio) === selectedCity) score += 16;
  if (selectedName && normalizeHistoryText(record.nome) === selectedName) score += 14;
  if (selectedBairro && normalizeHistoryText(record.bairro) === selectedBairro) score += 8;
  if (selectedAddress && normalizeHistoryText(record.endereco) === selectedAddress) score += 10;

  const lat = Number(record.lat);
  const lon = Number(record.lon);
  if (Number.isFinite(selectedLat) && Number.isFinite(selectedLon) && Number.isFinite(lat) && Number.isFinite(lon)) {
    const distanceScore = Math.max(0, 8 - ((Math.abs(selectedLat - lat) + Math.abs(selectedLon - lon)) * 10000));
    score += distanceScore;
  }

  return score;
}

function getPresidentHistoryDisplayRecords(records, props) {
  const byYear = new Map();

  (records || []).forEach((record, index) => {
    const year = String(record.ano || '');
    if (!year) return;

    const candidate = {
      record,
      score: getPresidentHistoryRecordScore(record, props),
      index
    };
    const previous = byYear.get(year);
    if (!previous || candidate.score > previous.score || (candidate.score === previous.score && candidate.index < previous.index)) {
      byYear.set(year, candidate);
    }
  });

  return Array.from(byYear.values())
    .map((entry) => entry.record)
    .sort((a, b) => getHistoryYearSortValue(b.ano) - getHistoryYearSortValue(a.ano)); // Descending (newest first)
}

function getHistoryYearSortValue(value) {
  const text = String(value || '');
  const match = text.match(/\d{4}/);
  const base = match ? parseInt(match[0], 10) : 0;
  return base + (/sup/i.test(text) ? 0.2 : 0);
}

function renderPresidentHistoryRows(records) {
  const rows = [];
  records
    .slice()
    .sort((a, b) => getHistoryYearSortValue(b.ano) - getHistoryYearSortValue(a.ano)) // Descending
    .forEach((record) => {
      const turns = (record.turnos || []).slice().sort((a, b) => String(a.turno).localeCompare(String(b.turno)));
      const turnRows = turns.map((turn) => {
        const partyColor = colorForParty(turn.partido);
        return `
          <div class="president-history-row">
            <span class="history-turn-pill">${escapeHtml(turn.turno)}</span>
            <div class="history-winner">
              <span class="history-party-bar" style="background:${partyColor}"></span>
              <div class="history-winner-info">
                <span class="history-winner-name">${escapeHtml(toTitleCase(turn.vencedor))}</span>
                <span class="history-winner-party">${escapeHtml(turn.partido || 'Sem partido')}</span>
              </div>
            </div>
            <div class="history-stats">
              <span class="history-stats-pct">${fmtPct(turn.pct)}</span>
              <span class="history-stats-margin">+${fmtPct(turn.margem_pct)}</span>
            </div>
          </div>
        `;
      }).join('');

      rows.push(`
        <div class="president-history-year-group">
          <div class="history-year-label">${escapeHtml(record.ano)}</div>
          <div class="history-year-rows">${turnRows}</div>
        </div>
      `);
    });
  return rows.join('');
}

function renderPresidentHistoryCard(container, resolved, props, cargo = SELECTED_MAJOR_HISTORY_CARGO) {
  const config = MAJOR_HISTORY_CONFIG[cargo] || MAJOR_HISTORY_CONFIG.presidente;
  const allRecords = resolved.identity.records || [];
  const records = getPresidentHistoryDisplayRecords(allRecords, props);
  const first = records[0] || {};
  const last = records[records.length - 1] || {};
  const title = getProp(props, 'nm_locvot') || last.nome || first.nome || 'Local de votação';
  const subtitle = toTitleCase(last.municipio || first.municipio || '');
  const isCollapsed = !PRESIDENT_HISTORY_USER_EXPANDED;

  container.classList.remove('hidden');
  container.innerHTML = `
    <div class="president-history-card ${isCollapsed ? 'collapsed' : ''}">
      <div class="profile-header history-header" style="cursor: pointer;">
        <h3>Histórico</h3>
        <div class="history-toggle-actions">
          <span class="history-toggle-icon">${isCollapsed ? '▼' : '▲'}</span>
        </div>
      </div>
      
      <div class="president-history-body" style="display: ${isCollapsed ? 'none' : 'block'};">
        <div class="history-place">
          <strong>${escapeHtml(title)}</strong>
          <small>${escapeHtml(subtitle)}</small>
        </div>
        <div class="president-history-list">
          ${renderPresidentHistoryRows(records)}
        </div>
      </div>
    </div>
  `;

  const card = container.querySelector('.president-history-card');
  const header = container.querySelector('.history-header');
  const body = container.querySelector('.president-history-body');
  const toggleIcon = container.querySelector('.history-toggle-icon');
  
  
  header.addEventListener('click', () => {
    const currentlyCollapsed = card.classList.toggle('collapsed');
    PRESIDENT_HISTORY_USER_EXPANDED = !currentlyCollapsed;
    body.style.display = currentlyCollapsed ? 'none' : 'block';
    toggleIcon.textContent = currentlyCollapsed ? '▼' : '▲';
  });
}

async function updatePresidentHistoryPanel(props) {
  const token = ++PRESIDENT_HISTORY_RENDER_TOKEN;
  const activeCargo = normalizeSelectedHistoryCargo(props);
  const config = MAJOR_HISTORY_CONFIG[activeCargo] || MAJOR_HISTORY_CONFIG.presidente;

  if (!shouldShowPresidentHistory(props)) {
    hidePresidentHistoryPanel();
    return;
  }

  const container = getPresidentHistoryContainer();
  container.classList.remove('hidden');
  
  const isCollapsed = !PRESIDENT_HISTORY_USER_EXPANDED;
  
  container.innerHTML = `
    <div class="president-history-card ${isCollapsed ? 'collapsed' : ''}">
      <div class="profile-header history-header" style="cursor: pointer;">
        <h3>Histórico</h3>
        <div class="history-toggle-actions">
          <span class="history-toggle-icon">${isCollapsed ? '▼' : '▲'}</span>
        </div>
      </div>
      <div class="president-history-body" style="display: ${isCollapsed ? 'none' : 'block'}; padding: 12px 0; text-align: center; color: var(--muted); font-size: 0.8rem;">
        Carregando histórico...
      </div>
    </div>
  `;

  const card = container.querySelector('.president-history-card');
  const header = container.querySelector('.history-header');
  const body = container.querySelector('.president-history-body');
  const toggleIcon = container.querySelector('.history-toggle-icon');
  
  
  header.addEventListener('click', () => {
    const currentlyCollapsed = card.classList.toggle('collapsed');
    PRESIDENT_HISTORY_USER_EXPANDED = !currentlyCollapsed;
    body.style.display = currentlyCollapsed ? 'none' : 'block';
    toggleIcon.textContent = currentlyCollapsed ? '▼' : '▲';
  });

  try {
    const history = await loadMajorHistoryForProps(config.cargo, props);
    if (token !== PRESIDENT_HISTORY_RENDER_TOKEN) return;

    const resolved = resolvePresidentHistoryIdentity(history, props);
    if (!resolved) {
      container.innerHTML = `
        <div class="president-history-card collapsed">
          <div class="profile-header history-header" style="cursor: pointer;">
            <h3>Histórico</h3>
            <div class="history-toggle-actions">
              <span class="history-toggle-icon">▼</span>
            </div>
          </div>
          <div class="president-history-body" style="display: none;">
            <div style="padding: 12px 0; text-align: center; color: var(--muted); font-size: 0.8rem;">
              Sem vínculo histórico encontrado para este local.
            </div>
          </div>
        </div>
      `;
      
      const card = container.querySelector('.president-history-card');
      const header = container.querySelector('.history-header');
      const body = container.querySelector('.president-history-body');
      const toggleIcon = container.querySelector('.history-toggle-icon');
      
      
      header.addEventListener('click', () => {
        const currentlyCollapsed = card.classList.toggle('collapsed');
        PRESIDENT_HISTORY_USER_EXPANDED = !currentlyCollapsed;
        body.style.display = currentlyCollapsed ? 'none' : 'block';
        toggleIcon.textContent = currentlyCollapsed ? '▼' : '▲';
      });
      return;
    }

    renderPresidentHistoryCard(container, resolved, props, config.cargo);
  } catch (error) {
    if (token !== PRESIDENT_HISTORY_RENDER_TOKEN) return;
    container.innerHTML = `
      <div class="president-history-card collapsed">
        <div class="profile-header history-header" style="cursor: pointer;">
          <h3>Histórico</h3>
          <div class="history-toggle-actions">
            <span class="history-toggle-icon">▼</span>
          </div>
        </div>
        <div class="president-history-body" style="display: none;">
          <div style="padding: 12px 0; text-align: center; color: var(--muted); font-size: 0.8rem;">
            Erro: ${escapeHtml(error.message || 'Histórico indisponível')}
          </div>
        </div>
      </div>
    `;
    
    const card = container.querySelector('.president-history-card');
    const header = container.querySelector('.history-header');
    const body = container.querySelector('.president-history-body');
    const toggleIcon = container.querySelector('.history-toggle-icon');
    
    
    header.addEventListener('click', () => {
      const currentlyCollapsed = card.classList.toggle('collapsed');
      PRESIDENT_HISTORY_USER_EXPANDED = !currentlyCollapsed;
      body.style.display = currentlyCollapsed ? 'none' : 'block';
      toggleIcon.textContent = currentlyCollapsed ? '▼' : '▲';
    });
  }
}

if (typeof window !== 'undefined') {
  window.updatePresidentHistoryPanel = updatePresidentHistoryPanel;
  window.resolvePresidentRunoffShiftForProps = resolvePresidentRunoffShiftForProps;
}

