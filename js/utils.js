// ====== UTILS ======
function getProp(properties, key) {
  if (!properties) return null;
  if (properties[key] !== undefined) return properties[key];
  const lowerKey = String(key).toLowerCase();
  if (properties[lowerKey] !== undefined) return properties[lowerKey];
  const upperKey = String(key).toUpperCase();
  if (properties[upperKey] !== undefined) return properties[upperKey];
  for (const k in properties) {
    if (String(k).toLowerCase() === lowerKey) return properties[k];
  }
  return null;
}

function getFeatureSelectionId(properties) {
  if (!properties) return '';

  const explicitId = getProp(properties, 'id_unico')
    || getProp(properties, 'local_id');
  if (explicitId !== null && explicitId !== undefined && String(explicitId).trim() !== '') {
    return String(explicitId).trim();
  }

  const uf = getProp(properties, 'sg_uf') || getProp(properties, 'SG_UF') || '';
  const municipio = getProp(properties, 'cd_localidade_tse')
    || getProp(properties, 'CD_MUNICIPIO')
    || getProp(properties, 'cod_localidade_ibge')
    || '';
  const zona = getProp(properties, 'nr_zona') || getProp(properties, 'NR_ZONA') || '';
  const local = getProp(properties, 'nr_locvot')
    || getProp(properties, 'nr_local_votacao')
    || getProp(properties, 'NR_LOCAL_VOTACAO')
    || '';

  const parts = [uf, municipio, zona, local]
    .map(part => String(part || '').trim())
    .filter(Boolean);

  if (parts.length > 0) return parts.join('_');
  return '';
}

if (typeof window !== 'undefined') {
  window.getProp = getProp;
  window.getFeatureSelectionId = getFeatureSelectionId;
}

const norm = s => (s || "").normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/'/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeAttribute(value) {
  return escapeHtml(value);
}
function colorForParty(sg) {
  if (typeof getResolvedPartyColor === 'function') {
    return getResolvedPartyColor(sg);
  }
  const cleanParty = typeof getNormalizedPartyColorKey === 'function'
    ? getNormalizedPartyColorKey(sg)
    : String(sg || '').trim().toUpperCase();
  return PARTY_COLOR_OVERRIDES.get(cleanParty) || PARTY_COLORS.get(cleanParty) || DEFAULT_SWATCH;
}
function fmtPct(x) { return isFinite(x) ? (x * 100).toFixed(2).replace('.', ',') + "%" : "-"; }
function fmtInt(n) { return (n || 0).toLocaleString('pt-BR'); }
function ensureNumber(v) {
  // 1. Se já for número válido, retorna direto
  if (typeof v === 'number' && isFinite(v)) return v;

  // 2. Se for nulo ou indefinido, retorna 0
  if (v === null || v === undefined) return 0;

  // 3. Converte para string e limpa espaços
  let s = String(v).trim();
  if (s === '') return 0;

  // 4. LÓGICA DE DETECÇÃO DE FORMATO:
  // Se a string contém vírgula, assumimos formato Brasileiro (ex: "1.200,50" ou "8,5").
  // Nesse caso, removemos os pontos (milhar) e trocamos a vírgula por ponto (decimal).
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  // Se NÃO contém vírgula, assumimos formato Padrão/JSON (ex: "8.61" ou "100").
  // Nesse caso, NÃO removemos o ponto, pois ele é o separador decimal correto.

  // 5. Converte para número final
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

const AGE_BUCKETS_STANDARD = [
  { key: '16-29', label: '16 a 29 anos', min: 16, max: 29 },
  { key: '30-45', label: '30 a 45 anos', min: 30, max: 45 },
  { key: '46-59', label: '46 a 59 anos', min: 46, max: 59 },
  { key: '60+', label: '60+ anos', min: 60, max: 200 }
];

function parseAgeRangeFromKey(key) {
  const raw = String(key || '');
  if (!/anos/i.test(raw)) return null;

  const matchRange = raw.match(/(\d+)\s*(?:a|A|ate|ate|to|-|_)\s*(\d+)/i);
  if (matchRange) {
    return [parseInt(matchRange[1], 10), parseInt(matchRange[2], 10)];
  }

  const matchPlus = raw.match(/(\d+)\s*(?:anos)?\s*(?:ou)?\s*mais/i);
  if (matchPlus) {
    const start = parseInt(matchPlus[1], 10);
    return [start, 200];
  }

  const matchSingle = raw.match(/(\d+)\s*anos/i);
  if (matchSingle) {
    const age = parseInt(matchSingle[1], 10);
    return [age, age];
  }

  return null;
}

function getAgeRangeOverlapRatio(sourceRange, targetRange) {
  const [sourceStart, sourceEnd] = sourceRange;
  const [targetStart, targetEnd] = targetRange;
  const overlapStart = Math.max(sourceStart, targetStart);
  const overlapEnd = Math.min(sourceEnd, targetEnd);

  if (overlapEnd < overlapStart) return 0;

  const sourceSpan = Math.max(1, sourceEnd - sourceStart + 1);
  const overlapSpan = overlapEnd - overlapStart + 1;
  return overlapSpan / sourceSpan;
}

function getAgeEntriesFromProps(props) {
  const absoluteEntries = [];
  const pctEntries = [];

  for (const key in (props || {})) {
    if (!/anos/i.test(key)) continue;

    const value = ensureNumber(props[key]);
    if (value <= 0) continue;

    const range = parseAgeRangeFromKey(key);
    if (!range) continue;

    const entry = { key, range, value, isPct: /^Pct/i.test(key) };
    if (entry.isPct) pctEntries.push(entry);
    else absoluteEntries.push(entry);
  }

  return absoluteEntries.length > 0 ? absoluteEntries : pctEntries;
}

function aggregateAgeBucketsFromProps(props, bucketDefs = AGE_BUCKETS_STANDARD) {
  const defs = Array.isArray(bucketDefs) && bucketDefs.length > 0 ? bucketDefs : AGE_BUCKETS_STANDARD;
  const buckets = Object.fromEntries(defs.map(def => [def.key, 0]));
  const entries = getAgeEntriesFromProps(props);
  let total = 0;

  entries.forEach(entry => {
    total += entry.value;

    defs.forEach(def => {
      const ratio = getAgeRangeOverlapRatio(entry.range, [def.min, def.max]);
      if (ratio > 0) buckets[def.key] += entry.value * ratio;
    });
  });

  return {
    buckets,
    total,
    hasData: entries.length > 0,
    sourceType: entries.length > 0 && entries[0].isPct ? 'pct' : 'absolute'
  };
}

if (typeof window !== 'undefined') {
  window.AGE_BUCKETS_STANDARD = AGE_BUCKETS_STANDARD;
  window.parseAgeRangeFromKey = parseAgeRangeFromKey;
  window.getAgeEntriesFromProps = getAgeEntriesFromProps;
  window.aggregateAgeBucketsFromProps = aggregateAgeBucketsFromProps;
}

const GENERAL_METRIC_NAMES = new Set([
  'TOTAL_VOTOS_VALIDOS',
  'VOTOS_BRANCOS',
  'VOTOS_NULOS',
  'ELEITORES_APTOS',
  'ELEITORES_APTOS_MUNICIPAL',
  'ABSTENCOES',
  'COMPARECIMENTO',
  'VOTOS_LEGENDA',
  'NR_TURNO'
]);

function isCandidateVoteKey(key) {
  const rawKey = String(key || '').trim();
  const turnoMatch = rawKey.match(/ (1T|2T)$/);
  if (!turnoMatch) return false;

  const coreKey = rawKey.replace(/ (1T|2T)$/, '');
  const normalizedCore = norm(coreKey)
    .replace(/[()]/g, '')
    .replace(/\s+/g, '_');

  return !GENERAL_METRIC_NAMES.has(normalizedCore);
}

const GENERAL_SECOND_TURN_AVAILABILITY = {
  '2022': {
    presidente: 'ALL',
    governador: { ord: ['AL', 'AM', 'BA', 'ES', 'MS', 'PB', 'PE', 'RO', 'RS', 'SC', 'SE', 'SP'] },
    senador: { ord: [] }
  },
  '2018': {
    presidente: 'ALL',
    governador: { ord: ['AM', 'AP', 'DF', 'MG', 'MS', 'PA', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP'] },
    senador: { ord: [], sup: [] }
  },
  '2014': {
    presidente: 'ALL',
    governador: { ord: ['AC', 'AM', 'AP', 'CE', 'DF', 'GO', 'MS', 'PA', 'PB', 'RJ', 'RN', 'RO', 'RR', 'RS'], sup: ['AM'] },
    senador: { ord: [], sup: [] }
  },
  '2010': {
    presidente: 'ALL',
    governador: { ord: ['AL', 'AP', 'DF', 'GO', 'PA', 'PB', 'PI', 'RO', 'RR'] },
    senador: { ord: [] }
  },
  '2006': {
    presidente: 'ALL',
    governador: { ord: ['GO', 'MA', 'PA', 'PB', 'PE', 'PR', 'RJ', 'RN', 'RS', 'SC'] },
    senador: { ord: [] }
  },
  '2002': {
    presidente: 'ALL',
    governador: { ord: ['AP', 'CE', 'DF', 'MS', 'PA', 'PB', 'PR', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP'] },
    senador: { ord: [] }
  },
  '1998': {
    // Presidente 1998: FHC reeleito em 1o turno -> sem 2o turno.
    presidente: { ord: [] },
    governador: { ord: ['AP', 'DF', 'GO', 'MG', 'MS', 'PA', 'PI', 'RJ', 'RO', 'RR', 'RS', 'SE', 'SP'] },
    senador: { ord: [] }
  },
  '1994': {
    // Presidente 1994: FHC eleito em 1o turno -> sem 2o turno.
    presidente: { ord: [] },
    governador: { ord: ['AC', 'AP', 'BA', 'DF', 'ES', 'GO', 'MA', 'MG', 'PA', 'PB', 'PI', 'RJ', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP'] },
    senador: { ord: [] }
  }
};

function hasGeneralSecondTurnArchive(year, cargo, uf, subtype = 'ord') {
  const yearKey = String(year || '').trim();
  const cargoKey = String(cargo || '').trim().toLowerCase();
  const ufKey = String(uf || '').trim().toUpperCase();
  const subtypeKey = String(subtype || 'ord').trim().toLowerCase() === 'sup' ? 'sup' : 'ord';

  if (!yearKey || !cargoKey || !ufKey) return false;

  const yearAvailability = GENERAL_SECOND_TURN_AVAILABILITY[yearKey];
  const cargoAvailability = yearAvailability?.[cargoKey];
  if (!cargoAvailability) return false;
  if (cargoAvailability === 'ALL') return true;

  const availableUfs = cargoAvailability[subtypeKey] || cargoAvailability.ord || [];
  return availableUfs.includes(ufKey);
}

const MUNICIPAL_SECOND_TURN_AVAILABILITY = {
  '2024': { ord: ['AM', 'BA', 'CE', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PR', 'RJ', 'RN', 'RO', 'RS', 'SE', 'SP', 'TO'] },
  '2020': { ord: ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'ES', 'GO', 'MA', 'MG', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP'] },
  '2016': { ord: ['AL', 'AM', 'AP', 'BA', 'CE', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PE', 'PR', 'RJ', 'RO', 'RS', 'SC', 'SE', 'SP'] },
  '2012': { ord: ['AC', 'AM', 'AP', 'BA', 'CE', 'ES', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RS', 'SC', 'SP'] },
  '2008': { ord: ['AM', 'AP', 'BA', 'ES', 'GO', 'MA', 'MG', 'MT', 'PA', 'PB', 'PR', 'RJ', 'RS', 'SC', 'SP'] },
  '2004': { ord: ['AL', 'AM', 'BA', 'CE', 'ES', 'GO', 'MG', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RS', 'SC', 'SP'] },
  '2000': { ord: ['AL', 'AM', 'CE', 'GO', 'MG', 'PA', 'PE', 'PR', 'RJ', 'RS', 'SP'] }
};

function hasMunicipalSecondTurnArchive(year, uf, subtype = 'ord') {
  const yearKey = String(year || '').trim();
  const ufKey = String(uf || '').trim().toUpperCase();
  const subtypeKey = String(subtype || 'ord').trim().toLowerCase() === 'sup' ? 'sup' : 'ord';
  if (!yearKey || !ufKey) return false;
  const availableUfs = MUNICIPAL_SECOND_TURN_AVAILABILITY[yearKey]?.[subtypeKey] || [];
  return availableUfs.includes(ufKey);
}

if (typeof window !== 'undefined') {
  window.isCandidateVoteKey = isCandidateVoteKey;
  window.hasGeneralSecondTurnArchive = hasGeneralSecondTurnArchive;
  window.hasMunicipalSecondTurnArchive = hasMunicipalSecondTurnArchive;
}

// --- COLOR UTILS (UNIVERSAL GRADIENT) ---
function hexToHSL(H) {
  // Convert hex to RGB first
  let r = 0, g = 0, b = 0;
  if (H.length == 4) {
    r = "0x" + H[1] + H[1];
    g = "0x" + H[2] + H[2];
    b = "0x" + H[3] + H[3];
  } else if (H.length == 7) {
    r = "0x" + H[1] + H[2];
    g = "0x" + H[3] + H[4];
    b = "0x" + H[5] + H[6];
  }
  // Then to HSL
  r /= 255; g /= 255; b /= 255;
  let cmin = Math.min(r, g, b),
    cmax = Math.max(r, g, b),
    delta = cmax - cmin,
    h = 0,
    s = 0,
    l = 0;

  if (delta == 0) h = 0;
  else if (cmax == r) h = ((g - b) / delta) % 6;
  else if (cmax == g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;

  h = Math.round(h * 60);
  if (h < 0) h += 360;

  l = (cmax + cmin) / 2;
  s = delta == 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  s = +(s * 100).toFixed(1);
  l = +(l * 100).toFixed(1);

  return { h, s, l };
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;

  let c = (1 - Math.abs(2 * l - 1)) * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = l - c / 2,
    r = 0,
    g = 0,
    b = 0;

  if (0 <= h && h < 60) { r = c; g = x; b = 0; }
  else if (60 <= h && h < 120) { r = x; g = c; b = 0; }
  else if (120 <= h && h < 180) { r = 0; g = c; b = x; }
  else if (180 <= h && h < 240) { r = 0; g = x; b = c; }
  else if (240 <= h && h < 300) { r = x; g = 0; b = c; }
  else if (300 <= h && h < 360) { r = c; g = 0; b = x; }

  r = Math.round((r + m) * 255).toString(16);
  g = Math.round((g + m) * 255).toString(16);
  b = Math.round((b + m) * 255).toString(16);

  if (r.length == 1) r = "0" + r;
  if (g.length == 1) g = "0" + g;
  if (b.length == 1) b = "0" + b;

  return "#" + r + g + b;
}

function getUniversalGradientColor(baseColorHex, marginPct) {
  const BASE_MARGIN = 20;
  const MIN_MARGIN = 0;
  const MAX_MARGIN = 60;
  const MAX_LIGHTEN = 14;
  const MAX_DARKEN = 18;
  const EASING_EXPONENT = 1.35;

  const numericMargin = Number.isFinite(marginPct) ? marginPct : BASE_MARGIN;
  const clampedMargin = Math.max(MIN_MARGIN, Math.min(MAX_MARGIN, numericMargin));
  const hsl = hexToHSL(baseColorHex);
  let targetL = hsl.l;

  if (clampedMargin < BASE_MARGIN) {
    const progress = Math.pow((BASE_MARGIN - clampedMargin) / (BASE_MARGIN - MIN_MARGIN), EASING_EXPONENT);
    targetL = hsl.l + (MAX_LIGHTEN * progress);
  } else if (clampedMargin > BASE_MARGIN) {
    const progress = Math.pow((clampedMargin - BASE_MARGIN) / (MAX_MARGIN - BASE_MARGIN), EASING_EXPONENT);
    targetL = hsl.l - (MAX_DARKEN * progress);
  }

  return hslToHex(hsl.h, hsl.s, Math.max(8, Math.min(92, targetL)));
}

// Calcula min/max/média de votos para o candidato selecionado no modo Desempenho
// IMPORTANTE: Ignora o filtro de desempenho para calcular stats de TODOS os locais
function resolveVisualizationCandidateId(candidatoKey, cargo = currentCargo) {
  if (!candidatoKey) return null;

  const isVereador = String(cargo || '').startsWith('vereador');
  const metaStore = isVereador ? (STATE.vereadorMetadata || {}) : (STATE.deputyMetadata || {});
  const prefixCache = isVereador ? (STATE._vereadorPartyPrefixCache || {}) : (STATE._partyPrefixCache || {});

  const selectedOption = dom.selectVizCandidato?.selectedOptions?.[0];
  const optionCandidateId = selectedOption?.dataset?.candidateId;
  if (optionCandidateId && Object.prototype.hasOwnProperty.call(metaStore, optionCandidateId)) return optionCandidateId;

  const optionByValue = Array.from(dom.selectVizCandidato?.options || []).find((opt) => opt.value === candidatoKey);
  const optionByValueCandidateId = optionByValue?.dataset?.candidateId;
  if (optionByValueCandidateId && Object.prototype.hasOwnProperty.call(metaStore, optionByValueCandidateId)) {
    return optionByValueCandidateId;
  }

  const selectedDatasetId = dom.selectVizCandidato?.dataset?.selectedDeputyId;
  if (selectedDatasetId && Object.prototype.hasOwnProperty.call(metaStore, selectedDatasetId)) return selectedDatasetId;

  const parsed = parseCandidateKey(candidatoKey);
  const normalizedName = norm(parsed.nome);
  const normalizedValue = norm(candidatoKey);

  for (const [id, meta] of Object.entries(metaStore)) {
    if (norm(meta?.[0] || id) === normalizedName) return id;
    if (id.length <= 2) {
      const resolvedParty = normalizePartyAlias((prefixCache[id] || meta?.[1] || '').toUpperCase());
      const legendLabel = norm(`Voto de Legenda — ${resolvedParty}`);
      if (legendLabel === normalizedName || legendLabel === normalizedValue) return id;
    }
  }

  if (!isVereador) {
    const byDeputyName = getDeputyIdByName(parsed.nome.toUpperCase().trim());
    if (byDeputyName && metaStore[byDeputyName]) return byDeputyName;
  }

  return null;
}

function resolveCandidateVoteKey(votesMap, candidateId) {
  if (!votesMap || candidateId === null || candidateId === undefined) return null;

  const rawId = String(candidateId).trim();
  if (!rawId) return null;

  if (Object.prototype.hasOwnProperty.call(votesMap, rawId)) return rawId;

  const parsedRawId = parseInt(rawId, 10);
  const numericId = Number.isFinite(parsedRawId) ? String(parsedRawId) : null;
  if (numericId && Object.prototype.hasOwnProperty.call(votesMap, numericId)) return numericId;

  for (const key of Object.keys(votesMap)) {
    const trimmedKey = String(key).trim();
    if (trimmedKey === rawId) return key;

    const parsedKey = parseInt(trimmedKey, 10);
    if (numericId && Number.isFinite(parsedKey) && String(parsedKey) === numericId) return key;
  }

  return null;
}

function getCandidateVotesFromMap(votesMap, candidateId) {
  const resolvedKey = resolveCandidateVoteKey(votesMap, candidateId);
  if (!resolvedKey) return null;
  return parseInt(votesMap[resolvedKey], 10) || 0;
}

function calculateCandidateStats(candidatoKey) {
  const geojson = currentDataCollection[currentCargo];
  if (!geojson || !candidatoKey) return null;

  const turnoKey = (currentTurno === 2 && STATE.dataHas2T[currentCargo]) ? '2T' : '1T';
  let minPct = Infinity, maxPct = -Infinity, totalPct = 0, count = 0;

  const savedFilter = performanceFilterMinPct;
  performanceFilterMinPct = 0;

  if (currentCargo.startsWith('deputado') || currentCargo.startsWith('vereador')) {
    const isVer = currentCargo.startsWith('vereador');
    const typeKey = isVer ? 'v' : (currentCargo.includes('estadual') ? 'e' : 'f');
    const resultStore = isVer ? STATE.vereadorResults : STATE.deputyResults;
    const candId = resolveVisualizationCandidateId(candidatoKey, currentCargo);

    if (candId) {
      geojson.features.forEach(f => {
        if (typeof filterFeature === 'function' && !filterFeature(f)) return;
        const props = f.properties;
        const z = getProp(props, 'nr_zona');
        const l = getProp(props, 'nr_locvot') || getProp(props, 'nr_local_votacao');
        const m = getProp(props, 'cd_localidade_tse') || getProp(props, 'CD_MUNICIPIO');
        if (!z || !l) return;
        const resKey = isVer ? `${parseInt(z)}_${parseInt(l)}` : `${parseInt(z)}_${parseInt(m)}_${parseInt(l)}`;
        const allRes = resultStore[resKey];
        if (!allRes) return;
        const votes = allRes[typeKey];
        if (!votes) return;
        let total = 0;
        for (const [cid, v] of Object.entries(votes)) {
          if (cid !== '95' && cid !== '96') total += parseInt(v) || 0;
        }
        if (total === 0) return;
        const candidateVotes = getCandidateVotesFromMap(votes, candId) || 0;
        const pct = (candidateVotes / total) * 100;
        if (pct < minPct) minPct = pct;
        if (pct > maxPct) maxPct = pct;
        totalPct += pct;
        count++;
      });
    }
  } else {
    geojson.features.forEach(f => {
      if (typeof filterFeature === 'function' && !filterFeature(f)) return;
      const props = f.properties;
      const { totalValidos } = getVotosValidos(props, currentCargo, turnoKey, STATE.filterInaptos);
      if (totalValidos === 0) return;
      const votosCand = ensureNumber(getProp(props, candidatoKey));
      const pct = (votosCand / totalValidos) * 100;
      if (pct < minPct) minPct = pct;
      if (pct > maxPct) maxPct = pct;
      totalPct += pct;
      count++;
    });
  }

  performanceFilterMinPct = savedFilter;
  if (count === 0) return null;

  return {
    candidato: candidatoKey,
    minPct: minPct === Infinity ? 0 : minPct,
    maxPct: maxPct === -Infinity ? 0 : maxPct,
    avgPct: totalPct / count,
    totalLocais: count
  };
}

// Converte porcentagem absoluta para escala relativa (0-100) baseada em min/max do candidato
function getRelativeGradientColor(baseColorHex, absolutePct, minPct, maxPct) {
  const range = maxPct - minPct;
  let normalizedPct;

  if (range <= 0.01) {
    normalizedPct = 50; // Valor médio se não houver variação significativa
  } else {
    normalizedPct = ((absolutePct - minPct) / range) * 100;
  }

  // Clamp entre 0 e 100
  if (normalizedPct < 0) normalizedPct = 0;
  if (normalizedPct > 100) normalizedPct = 100;

  // Usa a função de gradiente existente com o valor normalizado
  return getUniversalGradientColor(baseColorHex, normalizedPct);
}

// Atualiza a UI de estatísticas do modo Desempenho
// Usa cache para evitar reconstruir DOM desnecessariamente
let lastStatsRender = { candidato: null, minPct: null, maxPct: null };

function updatePerformanceStatsUI() {
  let statsContainer = document.getElementById('performanceStats');

  if (!currentVizMode.startsWith('desempenho') || !performanceModeStats.candidato) {
    if (statsContainer) statsContainer.style.display = 'none';
    performanceFilterMinPct = 0; // Reset filter ao sair
    lastStatsRender = { candidato: null, minPct: null, maxPct: null };
    return;
  }

  if (!statsContainer) {
    statsContainer = document.createElement('div');
    statsContainer.id = 'performanceStats';
    statsContainer.className = 'performance-stats-box';
    if (dom.vizCandidatoBox) {
      dom.vizCandidatoBox.appendChild(statsContainer);
    }
  }

  const { minPct, maxPct, avgPct, totalLocais } = performanceModeStats;
  const candidato = dom.selectVizCandidato?.value || '';

  // Clamp o filtro para estar dentro do range válido
  if (performanceFilterMinPct < minPct) performanceFilterMinPct = minPct;
  if (performanceFilterMinPct > maxPct) performanceFilterMinPct = maxPct;

  // Verifica se precisa reconstruir o DOM (candidato ou range mudou)
  const needsRebuild = lastStatsRender.candidato !== candidato ||
    lastStatsRender.minPct !== minPct ||
    lastStatsRender.maxPct !== maxPct;

  const candParsed = parseCandidateKey(candidato);
  const baseColor = getColorForCandidate(candParsed.nome, candParsed.partido);
  const gradientStops = [10, 30, 50, 70, 90]
    .map((pct) => `${getUniversalGradientColor(baseColor, pct)} ${Math.round(pct)}%`)
    .join(', ');
  const range = maxPct - minPct;
  const sliderPos = range > 0 ? ((performanceFilterMinPct - minPct) / range) * 100 : 0;

  if (needsRebuild) {
    // Reconstruir DOM completo
    lastStatsRender = { candidato, minPct, maxPct };

    statsContainer.style.display = 'block';
    statsContainer.innerHTML = `
      <div class="stats-legend">
        <div class="legend-gradient-wrapper">
          <div class="legend-gradient" style="background: linear-gradient(to right, ${gradientStops});"></div>
          <input type="range" id="performanceSlider" class="performance-slider" 
                 min="${minPct.toFixed(1)}" max="${maxPct.toFixed(1)}" step="0.1" 
                 value="${performanceFilterMinPct.toFixed(1)}">
          <div class="slider-indicator" id="sliderIndicator" style="left: ${sliderPos}%;"></div>
        </div>
        <div class="legend-labels">
          <span class="legend-min">▼ ${minPct.toFixed(1)}%</span>
          <span class="legend-filter" id="filterValueLabel">
            ${performanceFilterMinPct > minPct ? `Filtro: ≥${performanceFilterMinPct.toFixed(1)}%` : ''}
          </span>
          <span class="legend-max">${maxPct.toFixed(1)}% ▲</span>
        </div>
      </div>
      <div class="stats-summary">
        <small>Média: ${avgPct.toFixed(2)}% • ${totalLocais.toLocaleString('pt-BR')} locais</small>
        ${performanceFilterMinPct > minPct ? `<button id="btnResetFilter" class="reset-filter-btn">Limpar Filtro</button>` : ''}
      </div>
    `;

    // Adicionar event listeners
    const slider = document.getElementById('performanceSlider');
    const indicator = document.getElementById('sliderIndicator');
    const filterLabel = document.getElementById('filterValueLabel');

    if (slider) {
      slider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        const pos = range > 0 ? ((val - minPct) / range) * 100 : 0;
        if (indicator) indicator.style.left = pos + '%';
        if (filterLabel) {
          filterLabel.textContent = val > minPct ? `Filtro: ≥${val.toFixed(1)}%` : '';
        }
      });

      slider.addEventListener('change', (e) => {
        performanceFilterMinPct = parseFloat(e.target.value);
        console.log('[Desempenho] Filtro:', performanceFilterMinPct.toFixed(1) + '%');
        applyFiltersAndRedraw();
      });
    }
  } else {
    // Apenas atualizar elementos que mudam (indicator, label, button, stats)
    const indicator = document.getElementById('sliderIndicator');
    const filterLabel = document.getElementById('filterValueLabel');
    const slider = document.getElementById('performanceSlider');
    const statsSummary = statsContainer.querySelector('.stats-summary');

    if (indicator) indicator.style.left = sliderPos + '%';
    if (filterLabel) {
      filterLabel.textContent = performanceFilterMinPct > minPct ? `Filtro: ≥${performanceFilterMinPct.toFixed(1)}%` : '';
    }
    if (slider) slider.value = performanceFilterMinPct.toFixed(1);
    if (statsSummary) {
      statsSummary.innerHTML = `
        <small>Média: ${avgPct.toFixed(2)}% • ${totalLocais.toLocaleString('pt-BR')} locais</small>
        ${performanceFilterMinPct > minPct ? `<button id="btnResetFilter" class="reset-filter-btn">Limpar Filtro</button>` : ''}
      `;
    }
  }

  // Reset button listener (needs to be re-attached after possible innerHTML change)
  const resetBtn = document.getElementById('btnResetFilter');
  if (resetBtn && !resetBtn.dataset.listenerAttached) {
    resetBtn.dataset.listenerAttached = 'true';
    resetBtn.addEventListener('click', () => {
      performanceFilterMinPct = minPct;
      updatePerformanceStatsUI();
      applyFiltersAndRedraw();
    });
  }
}

if (typeof window !== 'undefined') {
  window.getProp = getProp;
  window.escapeHtml = escapeHtml;
  window.escapeAttribute = escapeAttribute;
  window.resolveVisualizationCandidateId = resolveVisualizationCandidateId;
  window.resolveCandidateVoteKey = resolveCandidateVoteKey;
  window.getCandidateVotesFromMap = getCandidateVotesFromMap;
}

// ====== BOX SELECTION LOGIC ======

function isBoxSelectionEnabledForCurrentMap() {
  if (STATE.currentMapMode === 'municipios') return true;
  return true; // Usually enabled for polling stations too
}

// NOTA: A lógica de box-selection (setupBoxSelection/updateSelectionBox/
// selectFeaturesInPixelBox) vive em map-render.js, já migrada para MapLibre
// (queryRenderedFeatures). As versões antigas baseadas em Leaflet que existiam
// aqui foram removidas.

function isMunicipalityVisibleInCurrentContext(codM) {
  const code = String(codM || '').trim();
  if (!code) return false;

  const summary = STATE.currentMapMuniSummary;
  if (!summary) return true;
  if (summary[code]) return true;

  return Object.values(summary).some((entry) => String(entry?.muniCode || '').trim() === code);
}

function getMarginAdjustedColor(baseColorHex, marginPct, winnerPct) {
  if (typeof currentGradientMode !== 'undefined' && currentGradientMode === 'winnerPct') {
    const safePct = Number.isFinite(winnerPct) ? winnerPct : 50;
    return getWinnerPctGradientColor(baseColorHex, safePct);
  }
  const safeMargin = Math.max(0, Math.min(100, ensureNumber(marginPct)));
  return getUniversalGradientColor(baseColorHex, safeMargin);
}

// Gradiente baseado na porcentagem absoluta do vencedor (lógica do Simulador Parlamentar)
// Faixas: >=70% cor pura, 60-70% pastel médio-escuro, 50-60% pastel intermediário, <50% pastel claro
function getWinnerPctGradientColor(baseColorHex, winnerPct) {
  const hsl = hexToHSL(baseColorHex);
  const pct = Number.isFinite(winnerPct) ? winnerPct : 50;

  if (pct >= 70) {
    return baseColorHex;
  } else if (pct >= 60) {
    const targetS = Math.max(50, hsl.s * 0.9);
    const targetL = 68;
    return hslToHex(hsl.h, targetS, targetL);
  } else if (pct >= 50) {
    const targetS = Math.max(45, hsl.s * 0.825);
    const targetL = 76;
    return hslToHex(hsl.h, targetS, targetL);
  } else {
    const targetS = Math.max(40, hsl.s * 0.75);
    const targetL = 84;
    return hslToHex(hsl.h, targetS, targetL);
  }
}

// Wrapper: escolhe entre gradiente por margem ou por porcentagem do vencedor
function getGradientColorForMode(baseColorHex, marginPct, winnerPct) {
  if (typeof currentGradientMode !== 'undefined' && currentGradientMode === 'winnerPct') {
    return getWinnerPctGradientColor(baseColorHex, winnerPct);
  }
  return getUniversalGradientColor(baseColorHex, marginPct);
}

if (typeof window !== 'undefined') {
  window.isMunicipalityVisibleInCurrentContext = isMunicipalityVisibleInCurrentContext;
  window.getMarginAdjustedColor = getMarginAdjustedColor;
  window.getWinnerPctGradientColor = getWinnerPctGradientColor;
  window.getGradientColorForMode = getGradientColorForMode;
}

function updateClearSelectionButtonVisibility() {
  const btn = document.getElementById('btnClearSelection') || (typeof dom !== 'undefined' ? dom.btnClearSelection : null);
  if (!btn) return;

  let showButton = false;
  if (typeof STATE !== 'undefined') {
    if (STATE.currentElectionType === 'geral') {
      const hasRegionalFilter = 
        (typeof currentMesorregiaoFilter !== 'undefined' && currentMesorregiaoFilter !== 'all') ||
        (typeof currentMicrorregiaoFilter !== 'undefined' && currentMicrorregiaoFilter !== 'all') ||
        (typeof currentCidadeFilter !== 'undefined' && currentCidadeFilter !== 'all') ||
        (typeof currentBairroFilter !== 'undefined' && currentBairroFilter !== 'all') ||
        (typeof currentLocalFilter !== 'undefined' && currentLocalFilter !== '');
      
      const hasManualSelection = 
        !STATE.isFilterAggregationActive && 
        (typeof selectedLocationIDs !== 'undefined' && selectedLocationIDs.size > 0);
        
      showButton = hasRegionalFilter || hasManualSelection;
    } else if (STATE.currentElectionType === 'municipal') {
      const muniSelected = !!(typeof dom !== 'undefined' && dom.selectMunicipio?.value);
      const hasManualSelection = 
        !STATE.isFilterAggregationActive && 
        (typeof selectedLocationIDs !== 'undefined' && selectedLocationIDs.size > 0);
        
      showButton = muniSelected || hasManualSelection;
    }
  }

  if (showButton) {
    btn.classList.remove('hidden');
  } else {
    btn.classList.add('hidden');
  }
}

if (typeof window !== 'undefined') {
  window.updateClearSelectionButtonVisibility = updateClearSelectionButtonVisibility;
}

if (typeof window !== 'undefined') {
  if (!window.CANDIDATE_NAME_TO_PARTY) {
    window.CANDIDATE_NAME_TO_PARTY = new Map();
  }
}

function cleanCandNamesMetadata(data, yearOrZipUrl) {
  if (!data) return;
  
  let candNames = null;
  if (data.METADATA && data.METADATA.cand_names) {
    candNames = data.METADATA.cand_names;
  } else if (data.cand_names) {
    candNames = data.cand_names;
  }
  
  if (!candNames) return;

  let year = '';
  if (yearOrZipUrl) {
    const yearMatch = String(yearOrZipUrl).match(/\b(2000|2004)\b/);
    if (yearMatch) {
      year = yearMatch[1];
    } else if (String(yearOrZipUrl) === '2000' || String(yearOrZipUrl) === '2004') {
      year = String(yearOrZipUrl);
    }
  }
  
  if (!year && data.METADATA && data.METADATA.ano) {
    if (String(data.METADATA.ano) === '2000' || String(data.METADATA.ano) === '2004') {
      year = String(data.METADATA.ano);
    }
  }
  
  if (!year && typeof STATE !== 'undefined' && STATE.currentElectionYear) {
    if (STATE.currentElectionYear === '2000' || STATE.currentElectionYear === '2004') {
      year = STATE.currentElectionYear;
    }
  }

  if (year !== '2000' && year !== '2004') return;

  const mapping = {
    10: 'PRB',
    11: year === '2000' ? 'PPB' : 'PP',
    12: 'PDT',
    13: 'PT',
    14: 'PTB',
    15: 'PMDB',
    16: 'PSTU',
    17: 'PSL',
    18: 'REDE',
    19: 'PODE',
    20: 'PSC',
    21: 'PCB',
    22: 'PL',
    23: 'PPS',
    24: 'PAN',
    25: 'PFL',
    26: 'PAN',
    27: 'PSDC',
    28: 'PRTB',
    29: 'PCO',
    30: 'NOVO',
    31: 'PHS',
    33: 'PMN',
    35: 'PMB',
    36: 'PTC',
    40: 'PSB',
    43: 'PV',
    44: 'PRP',
    45: 'PSDB',
    50: 'PSOL',
    51: 'PEN',
    54: 'PPL',
    55: 'PSD',
    56: 'PRONA',
    65: 'PC do B',
    70: 'AVANTE',
    77: 'SOLIDARIEDADE',
    90: 'PROS'
  };

  Object.entries(candNames).forEach(([candId, meta]) => {
    if (!meta || !Array.isArray(meta) || meta.length < 2) return;
    const candName = String(meta[0] || '').trim();
    let party = String(meta[1] || '').trim();
    
    const isNameConfusion = !party || 
      party.length > 8 || 
      party.toLowerCase() === candName.toLowerCase() || 
      (party.includes(' ') && !['PC DO B', 'PT DO B', 'PC DOB', 'P DO B'].includes(party.toUpperCase()));
      
    if (isNameConfusion) {
      const pNum = parseInt(String(candId).substring(0, 2), 10);
      const correctParty = mapping[pNum] || `P${pNum}`;
      meta[1] = correctParty;
      party = correctParty;
    }
    
    if (typeof window !== 'undefined' && window.CANDIDATE_NAME_TO_PARTY) {
      const cleanNameKey = candName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (cleanNameKey) {
        window.CANDIDATE_NAME_TO_PARTY.set(cleanNameKey, party);
      }
    }
  });

  if (data.METADATA && data.METADATA.official_summary) {
    Object.values(data.METADATA.official_summary).forEach((summary) => {
      if (summary && summary.votesByDisplayKey) {
        const cleanedVotes = {};
        Object.entries(summary.votesByDisplayKey).forEach(([oldKey, votes]) => {
          const match = oldKey.match(/^(.*?)\s*\(([^)]+)\)\s*\(([^)]+)\)(?:\s*(\d+T))?$/);
          if (match) {
            const name = match[1].trim();
            const party = match[2].trim();
            const status = match[3].trim();
            const turno = match[4] || '';
            
            const isNameConfusion = !party || 
              party.length > 8 || 
              party.toLowerCase() === name.toLowerCase() || 
              (party.includes(' ') && !['PC DO B', 'PT DO B', 'PC DOB', 'P DO B'].includes(party.toUpperCase()));
              
            if (isNameConfusion) {
              let candId = '';
              for (const [id, cmeta] of Object.entries(candNames)) {
                if (cmeta && cmeta[0] && cmeta[0].trim().toLowerCase() === name.toLowerCase()) {
                  candId = id;
                  break;
                }
              }
              if (candId) {
                const pNum = parseInt(String(candId).substring(0, 2), 10);
                const correctParty = mapping[pNum] || `P${pNum}`;
                const newKey = `${name} (${correctParty}) (${status}) ${turno}`.trim();
                cleanedVotes[newKey] = votes;
                return;
              }
            }
          }
          cleanedVotes[oldKey] = votes;
        });
        summary.votesByDisplayKey = cleanedVotes;
      }
    });
  }
}

if (typeof window !== 'undefined') {
  window.cleanCandNamesMetadata = cleanCandNamesMetadata;
}

async function readBlobAsText(blob) {
  if (!blob) return '';
  const textUtf8 = await blob.text();
  if (textUtf8.includes('\uFFFD')) {
    try {
      const buffer = await blob.arrayBuffer();
      const decoder = new TextDecoder('windows-1252');
      return decoder.decode(buffer);
    } catch (e) {
      console.warn("Failed to decode text as windows-1252, using default:", e);
    }
  }
  return textUtf8;
}

if (typeof window !== 'undefined') {
  window.readBlobAsText = readBlobAsText;
}


