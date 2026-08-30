// ===================== ESCOPO DIASPORA (UF = ZZ) =====================
//
// 'ZZ' e o voto no exterior. Como 'BR', e um escopo e nao uma UF: o mapa vira a
// malha do mundo, pintada pelo vencedor em cada pais, com um circulo por
// consulado por cima.
//
// Por que isto e curto: o coropletico do app nao sabe o que e um estado. Ele casa
// feature.properties.CD_REG contra um summary marcado com _regionLevel
// (getMunicipalSummaryEntryForFeature, em js/map-render.js) e pinta com
// getMunicipalPolygonStyle. Trocar a malha de estados pela do mundo e o codigo da
// UF pelo iso3 do pais e tudo que a visao por pais precisa -- nenhuma rotina de
// estilo, tooltip ou 3D precisou saber que a unidade mudou.
//
// O dado vem de resultados_geo/Majoritarias {ano}/presidente_{ano}_t{turno}_ZZ.zip,
// gerado por scripts/gerar_majoritarias_exterior.py:
//   RESULTS[iso3][numero] = votos          -> o coropletico
//   CONSULADOS[] = {cd, nome, iso3, lat, lng, votos} -> os circulos
//   *_resumo.json TOTALS[numero] = votos   -> o painel
// Um zip por ano+turno: o exterior inteiro pesa menos que uma UF sozinha.

const DIASPORA_LEVEL = 'pais';
const DIASPORA_WORLD_URL = `${DATA_BASE_URL}paises_mundo.geojson`;
const DIASPORA_POINTS_LAYER_ID = 'diaspora-consulados';

let DIASPORA_WORLD_PROMISE = null;
const DIASPORA_DATA_CACHE = new Map();

// Mesmo desenho de nationalView: guardado fora do STATE porque nada mais no app
// le isto, e o painel precisa recompor no clique de turno sem refazer a rede.
let diasporaView = {
  year: '',
  byTurn: null,
  generation: 0
};

let diasporaPointsLayer = null;

// O mapa nasce com minZoom 4, que e o zoom em que o Brasil preenche a tela. O
// mundo inteiro nao cabe nesse piso: sem baixa-lo, o fitBounds da malha global e
// clampado e a tela abre em cima do golfo da Guine em vez do planeta. Guardamos
// o valor original em vez de repetir o 4 aqui, para o piso do Brasil continuar
// definido num lugar so (js/ui-helpers.js).
let MIN_ZOOM_ANTES_DA_DIASPORA = null;

function enterDiasporaMapZoom() {
  if (!map) return;
  if (MIN_ZOOM_ANTES_DA_DIASPORA === null) MIN_ZOOM_ANTES_DA_DIASPORA = map.getMinZoom();
  map.setMinZoom(0);
}

function restoreMapZoomAfterDiaspora() {
  if (!map || MIN_ZOOM_ANTES_DA_DIASPORA === null) return;
  // Sair do mundo com o mapa mais afastado que o piso do Brasil deixaria o
  // setMinZoom sem efeito visivel ate o proximo gesto; o fit do escopo novo
  // reenquadra, mas subir o zoom antes evita o quadro vazio no meio do caminho.
  if (map.getZoom() < MIN_ZOOM_ANTES_DA_DIASPORA) map.setZoom(MIN_ZOOM_ANTES_DA_DIASPORA);
  map.setMinZoom(MIN_ZOOM_ANTES_DA_DIASPORA);
  MIN_ZOOM_ANTES_DA_DIASPORA = null;
}

async function fetchDiasporaWorldGeoJSON() {
  if (DIASPORA_WORLD_PROMISE) return DIASPORA_WORLD_PROMISE;

  DIASPORA_WORLD_PROMISE = (async () => {
    const response = await fetch(DIASPORA_WORLD_URL);
    if (!response.ok) throw new Error('Malha de países não encontrada.');
    const geojson = await response.json();
    // CD_REG/NM_REG e o contrato que o resolver de summary e o tooltip municipal
    // ja falam; aqui CD_REG e o iso3.
    return {
      type: 'FeatureCollection',
      features: (geojson.features || []).map((feature) => {
        const props = feature.properties || {};
        const iso3 = String(props.iso3 || '').toUpperCase();
        return {
          ...feature,
          properties: {
            ...props,
            CD_REG: iso3,
            NM_REG: props.nome_pt || props.nome_en || iso3
          }
        };
      })
    };
  })();

  DIASPORA_WORLD_PROMISE.catch(() => {
    DIASPORA_WORLD_PROMISE = null;
  });
  return DIASPORA_WORLD_PROMISE;
}

// { '1T': payload|null, '2T': payload|null }. Ano sem exterior devolve os dois
// nulos, e showDiasporaOverview trata isso como "sem dados" em vez de erro.
async function loadDiasporaData(year) {
  const chave = String(year);
  if (DIASPORA_DATA_CACHE.has(chave)) return DIASPORA_DATA_CACHE.get(chave);

  const promise = (async () => {
    const turnos = await Promise.all([1, 2].map(async (turno) => {
      const base = `presidente_${chave}_t${turno}_ZZ`;
      try {
        const { data } = await fetchJsonFromZipEntry(
          `${DATA_BASE_URL}Majoritarias ${chave}/${base}.zip`, `${base}.json`);
        return data?.RESULTS ? data : null;
      } catch (error) {
        return null;
      }
    }));
    return { '1T': turnos[0], '2T': turnos[1] };
  })();

  DIASPORA_DATA_CACHE.set(chave, promise);
  promise.catch(() => {
    if (DIASPORA_DATA_CACHE.get(chave) === promise) DIASPORA_DATA_CACHE.delete(chave);
  });
  return promise;
}

// Um mapa { numero: votos } vira { chaveDeExibicao: votos } + brancos/nulos, no
// formato que parseCandidateKey/renderResultsPanel usam. Mesma regra de
// summarizeNationalUfPayload -- 95 e branco, 96 e nulo, o resto e candidato.
function summarizeDiasporaVotes(voteMap, metadata, turnoKey) {
  const votes = {};
  let totalValid = 0;
  let brancos = 0;
  let nulos = 0;

  Object.entries(voteMap || {}).forEach(([candidateId, rawVotes]) => {
    const value = ensureNumber(rawVotes);
    if (candidateId === '95') { brancos += value; return; }
    if (candidateId === '96') { nulos += value; return; }
    const key = buildNationalCandidateKey(metadata[candidateId], candidateId, turnoKey);
    votes[key] = (votes[key] || 0) + value;
    totalValid += value;
  });

  return { votes, totalValid, brancos, nulos };
}

// Uma entrada do summary no formato que o coropletico e o tooltip ja consomem.
function buildDiasporaEntry(nome, voteMap, metadata, turnoKey) {
  const { votes, totalValid } = summarizeDiasporaVotes(voteMap, metadata, turnoKey);
  const ordenados = Object.entries(votes)
    .filter(([, v]) => ensureNumber(v) > 0)
    .sort((a, b) => ensureNumber(b[1]) - ensureNumber(a[1]));
  if (!ordenados.length || totalValid <= 0) return null;

  const winnerVotes = ensureNumber(ordenados[0][1]);
  const secondVotes = ensureNumber(ordenados[1]?.[1] || 0);
  const info = parseCandidateKey(ordenados[0][0]);

  return {
    nome,
    muniCode: '',
    winnerCode: '',
    winnerName: info.nome,
    winnerParty: info.partido,
    winnerColorParty: info.partido,
    totalValid,
    margin: ((winnerVotes - secondVotes) / totalValid) * 100,
    winnerPct: (winnerVotes / totalValid) * 100,
    turno: turnoKey,
    turnoLabel: turnoKey === '2T' ? '2º Turno' : '1º Turno',
    votes,
    rawTotals: votes,
    isDetailed: true
  };
}

// Summary por PAIS, marcado com _regionLevel para casar com CD_REG = iso3.
function buildDiasporaCountrySummary(byTurn, turnoKey) {
  const summary = {};
  Object.defineProperty(summary, '_regionLevel', { value: DIASPORA_LEVEL });

  const payload = byTurn?.[turnoKey];
  const metadata = payload?.METADATA?.cand_names || {};
  const nomes = diasporaCountryNames();

  Object.entries(payload?.RESULTS || {}).forEach(([iso3, voteMap]) => {
    const entry = buildDiasporaEntry(nomes.get(iso3) || iso3, voteMap, metadata, turnoKey);
    if (entry) summary[iso3] = entry;
  });

  return summary;
}

// iso3 -> nome em portugues, lido da malha ja carregada. So existe depois do
// fetch; antes disso o proprio iso3 serve de rotulo.
let DIASPORA_COUNTRY_NAMES = new Map();
function diasporaCountryNames() {
  return DIASPORA_COUNTRY_NAMES;
}

// Totais do exterior inteiro num turno.
function buildDiasporaAggregate(byTurn, turnoKey) {
  const payload = byTurn?.[turnoKey];
  const metadata = payload?.METADATA?.cand_names || {};
  const totais = {};

  Object.values(payload?.RESULTS || {}).forEach((voteMap) => {
    Object.entries(voteMap || {}).forEach(([candidateId, rawVotes]) => {
      totais[candidateId] = (totais[candidateId] || 0) + ensureNumber(rawVotes);
    });
  });

  const { votes, totalValid, brancos, nulos } = summarizeDiasporaVotes(totais, metadata, turnoKey);
  return {
    votesByDisplayKey: votes,
    totalValidos: totalValid,
    brancos,
    nulos,
    comparecimento: totalValid + brancos + nulos,
    // Conta so quem tem voto valido, que e exatamente o que o mapa desenha: uma
    // urna com apenas branco e nulo nao tem vencedor para pintar nem para
    // colorir o circulo, e sairia da contagem do painel sem sair do subtitulo.
    paisCount: Object.values(payload?.RESULTS || {}).filter(temVotoValido).length,
    consuladoCount: (payload?.CONSULADOS || []).filter((c) => temVotoValido(c.votos)).length
  };
}

function temVotoValido(voteMap) {
  return Object.entries(voteMap || {})
    .some(([id, votos]) => id !== '95' && id !== '96' && ensureNumber(votos) > 0);
}

// ===================== CAMADAS =====================

function createDiasporaCountriesLayer(geojson) {
  const layer = new MLCompat.GeoLayer(map, {
    // Mesmo id da camada municipal/regional: mesma pilha, nada novo a limpar.
    id: 'muni',
    type: 'polygon',
    hover: true,
    styleFn: (feature) => getMunicipalPolygonStyle(feature, STATE.currentMapMuniSummary),
    tooltipClass: 'district-nyt-tooltip',
    // A MESMA tooltip dos mapas municipal e de regiao. Delegar em vez de
    // reproduzir o markup garante que sao a mesma coisa, e nao duas parecidas.
    tooltipFn: (feature) => buildMunicipalityTooltip(feature, STATE.currentMapMuniSummary)
  });
  if (STATE.extrusion3DEnabled && isPolygonMapMode()) {
    layer.extrusionEnabled = true;
  }
  layer.__regionLevel = DIASPORA_LEVEL;
  layer.setFeatures(geojson.features || []);
  return layer;
}

// Os circulos usam a MESMA maquina do coropletico: CD_REG na feature + um summary
// marcado com _regionLevel. E o que faz o tooltip do consulado sair identico ao do
// pais -- os dois passam por buildMunicipalityTooltip -- em vez de virar um segundo
// layout parecido que envelhece sozinho.
function buildDiasporaConsulateData(byTurn, turnoKey) {
  const payload = byTurn?.[turnoKey];
  const metadata = payload?.METADATA?.cand_names || {};
  const nomes = diasporaCountryNames();

  const summary = {};
  Object.defineProperty(summary, '_regionLevel', { value: DIASPORA_LEVEL });
  const features = [];

  (payload?.CONSULADOS || []).forEach((consulado) => {
    const entry = buildDiasporaEntry(consulado.nome, consulado.votos, metadata, turnoKey);
    if (!entry) return;

    // Chave do ponto no summary. Em 1989 e 1994 o boletim agrega por PAIS e nao
    // ha codigo de urna: a chave e o iso3. Usar o cd nesses anos punha todos os
    // pontos do mundo na mesma entrada, e o mapa inteiro passava a mostrar o
    // resultado do ultimo pais lido.
    const chave = consulado.cd ? String(consulado.cd) : consulado.iso3;
    const pais = nomes.get(consulado.iso3) || consulado.iso3;
    // Segunda linha do tooltip: o pais onde o consulado fica. Quando o ponto E o
    // pais, repeti-lo seria "Portugal / Portugal"; ali vale o rotulo do escopo.
    if (norm(consulado.nome) !== norm(pais)) entry.scopeLabel = pais;

    summary[chave] = entry;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [consulado.lng, consulado.lat] },
      properties: { CD_REG: chave, NM_REG: consulado.nome, iso3: consulado.iso3, entry }
    });
  });

  return { features, summary };
}

// Area proporcional ao voto (raio pela raiz), com piso para o consulado pequeno
// continuar clicavel. Escala pelo MAIOR do conjunto, e nao por valor absoluto:
// e o que mantem a leitura comparavel entre anos, em que o exterior cresceu de
// 22 mil votos (1998) para 614 mil (2022).
function diasporaConsulateRadius(feature, maxVotos) {
  const votos = ensureNumber(feature?.properties?.entry?.totalValid);
  if (!(maxVotos > 0) || votos <= 0) return 3;
  return 3 + 13 * Math.sqrt(votos / maxVotos);
}

function createDiasporaConsulatesLayer(features, summary) {
  const maxVotos = features.reduce(
    (maior, f) => Math.max(maior, ensureNumber(f.properties.entry.totalValid)), 0);

  const layer = new MLCompat.GeoLayer(map, {
    id: DIASPORA_POINTS_LAYER_ID,
    type: 'point',
    hover: true,
    styleFn: (feature) => {
      const entry = feature?.properties?.entry;
      return {
        fillColor: getColorForCandidate(entry?.winnerName, entry?.winnerParty),
        fillOpacity: 0.92,
        color: '#ffffff',
        weight: 1,
        opacity: 0.9
      };
    },
    radiusFn: (feature) => diasporaConsulateRadius(feature, maxVotos),
    tooltipClass: 'district-nyt-tooltip',
    tooltipFn: (feature) => buildMunicipalityTooltip(feature, summary)
  });
  layer.setFeatures(features);
  return layer;
}

function removeDiasporaConsulatesLayer() {
  if (!diasporaPointsLayer) return;
  try { diasporaPointsLayer.remove(); } catch (error) { /* camada ja fora do mapa */ }
  diasporaPointsLayer = null;
}

// Tudo que a diaspora deixa no mapa e que o proximo escopo nao limparia sozinho:
// os circulos dos consulados e o piso de zoom rebaixado. Chamada de quem SAI do
// escopo (o listener de UF e showNationalOverview) -- e nao do redesenho de
// turno, que troca os circulos mas continua no mundo.
function leaveDiasporaMapState() {
  removeDiasporaConsulatesLayer();
  restoreMapZoomAfterDiaspora();
}

// ===================== PAINEL =====================

function renderDiasporaResults(byTurn, turnoKey) {
  if (typeof initializeCandidateColorUI === 'function') initializeCandidateColorUI();

  const aggregate = buildDiasporaAggregate(byTurn, turnoKey);
  const totalBase = aggregate.totalValidos;

  const results = Object.entries(aggregate.votesByDisplayKey)
    .map(([key, votos]) => ({
      ...parseCandidateKey(key),
      votos: ensureNumber(votos),
      pct: totalBase > 0 ? ensureNumber(votos) / totalBase : 0
    }))
    .filter((r) => !(STATE.filterInaptos && r.status === 'INAPTO'))
    .sort((a, b) => b.votos - a.votos);

  dom.resultsBox.classList.remove('section-hidden');
  dom.summaryBoxContainer.classList.add('section-hidden');
  dom.resultsTitle.textContent = 'Exterior — Presidente';
  // Ate 1994 o boletim agrega por PAIS: nao ha urna consular para contar, e o
  // subtitulo nao inventa uma.
  const escopo = aggregate.consuladoCount
    ? `${fmtInt(aggregate.consuladoCount)} urnas em ${fmtInt(aggregate.paisCount)} países`
    : `${fmtInt(aggregate.paisCount)} países`;
  dom.resultsSubtitle.textContent =
    `${STATE.currentElectionYear} • ${turnoKey === '2T' ? '2º turno' : '1º turno'} • ${escopo}`;

  // Mesmo construtor de tabela das demais sidebars, para nao poderem divergir.
  dom.resultsContent.innerHTML = buildStandardResultsTable(
    results
      .filter((r) => !(r.votos === 0 && results.length > 2))
      .map((r) => {
        const cleanStatus = r.status ? r.status.toUpperCase() : '';
        const isSpecial = cleanStatus === 'ELEITO' || cleanStatus === '2° TURNO' || cleanStatus === '2º TURNO';
        return {
          label: toTitleCase(r.nome),
          sublabel: r.partido || '',
          color: getColorForCandidate(r.nome, r.partido),
          votes: r.votos,
          pct: r.pct,
          highlight: isSpecial,
          colorPicker: { name: r.nome || '', party: r.partido || '' },
          rowClass: cleanStatus
            ? 'prop-cand-' + cleanStatus.toLowerCase().replace(/º/g, '').replace(/°/g, '').replace(/\s+/g, '-')
            : '',
          rowAttrs: ` data-status="${escapeAttribute(r.status || '')}"`
            + ` data-cand-nome="${escapeAttribute(r.nome || '')}"`
            + ` data-cand-partido="${escapeAttribute(r.partido || '')}"`
        };
      }),
    { labelHeader: 'Candidato' }
  );

  const invalidos = aggregate.brancos + aggregate.nulos;
  const invalidosPct = aggregate.comparecimento > 0 ? (invalidos / aggregate.comparecimento) : 0;
  const paisesVencidos = Object.values(buildDiasporaCountrySummary(byTurn, turnoKey));
  const lider = results[0];
  const paisesDoLider = lider
    ? paisesVencidos.filter((entry) => entry.winnerName === lider.nome).length
    : 0;

  dom.resultsMetrics.innerHTML = `
    <div class="metrics-grid">
      <div class="metric-item"><span>Votos válidos</span><strong>${fmtInt(totalBase)}</strong></div>
      <div class="metric-item"><span>Comparecimento</span><strong>${fmtInt(aggregate.comparecimento)}</strong></div>
      <div class="metric-item"><span>Votos inválidos</span><strong>${fmtInt(invalidos)} (${fmtPct(invalidosPct)})</strong></div>
      <div class="metric-item"><span>Países vencidos (1º)</span><strong>${fmtInt(paisesDoLider)} de ${fmtInt(paisesVencidos.length)}</strong></div>
    </div>
  `;
}

// ===================== ORQUESTRACAO =====================

function diasporaTurnoKey(byTurn) {
  return (currentTurno === 2 && byTurn?.['2T']) ? '2T' : '1T';
}

function drawDiasporaTurn(byTurn, turnoKey) {
  STATE.currentMapMuniSummary = buildDiasporaCountrySummary(byTurn, turnoKey);
  if (STATE.municipiosLayer?.refresh) STATE.municipiosLayer.refresh();

  removeDiasporaConsulatesLayer();
  const { features, summary } = buildDiasporaConsulateData(byTurn, turnoKey);
  if (features.length) {
    // Adicionada DEPOIS da malha para ficar por cima dela.
    diasporaPointsLayer = createDiasporaConsulatesLayer(features, summary);
    diasporaPointsLayer.addTo(map);
  }
}

async function refreshDiasporaViewForTurn() {
  if (!isDiasporaScope() || !diasporaView.byTurn) return;
  const byTurn = diasporaView.byTurn;
  const turnoKey = diasporaTurnoKey(byTurn);

  drawDiasporaTurn(byTurn, turnoKey);
  renderNationalTurnTabs({ '1T': !!byTurn['1T'], '2T': !!byTurn['2T'] });
  renderDiasporaResults(byTurn, turnoKey);
}

// Ano sem exterior no acervo: avisa e volta ao Brasil, em vez de deixar o mapa
// vazio. O change do seletor reentra sozinho no fluxo nacional.
function leaveDiasporaScope(year) {
  leaveDiasporaMapState();
  showToast(`Sem dados do exterior para ${year}.`, 'error');
  if (!dom.selectUFGeneral) return;
  dom.selectUFGeneral.value = 'BR';
  dom.selectUFGeneral.dispatchEvent(new Event('change'));
}

// Entrada unica da visao da diaspora, despachada por showNationalOverview.
async function showDiasporaOverview(options = {}) {
  if (STATE.swingEnabled) return;
  if (!map || !isDiasporaScope()) return;

  const generation = ++diasporaView.generation;
  const year = String(STATE.currentElectionYear);

  // No exterior so se vota para presidente. updateCargoChipsVisibility ja
  // escondeu os outros chips; aqui so alinhamos o estado.
  currentOffice = 'presidente';
  currentSubType = 'ord';
  currentCargo = 'presidente_ord';
  STATE.currentElectionType = 'geral';
  STATE.currentMapMode = 'regioes';
  STATE.currentRegionLevel = DIASPORA_LEVEL;
  STATE.currentMapMuniUF = 'ZZ';
  currentRegionFilter = { level: '', code: '' };
  currentCidadeFilter = 'all';
  currentBairroFilter = 'all';
  currentLocalFilter = '';
  currentVizMode = 'vencedor';

  enterDiasporaMapZoom();
  showMapLoading(`Carregando o voto no exterior em ${year}...`);

  try {
    const geojsonPromise = fetchDiasporaWorldGeoJSON();
    const byTurn = await loadDiasporaData(year);
    if (generation !== diasporaView.generation) return;

    if (!byTurn['1T'] && !byTurn['2T']) {
      leaveDiasporaScope(year);
      return;
    }

    const geojson = await geojsonPromise;
    if (generation !== diasporaView.generation || !isDiasporaScope()) return;

    DIASPORA_COUNTRY_NAMES = new Map(
      (geojson.features || []).map((f) => [f.properties.CD_REG, f.properties.NM_REG]));
    diasporaView = { year, byTurn, generation };

    if (currentLayer && map.hasLayer(currentLayer)) {
      map.removeLayer(currentLayer);
      currentLayer = null;
    }
    if (STATE.municipiosLayer && map.hasLayer(STATE.municipiosLayer)) {
      map.removeLayer(STATE.municipiosLayer);
    }
    if (typeof clearNationalDotplotMarkers === 'function') clearNationalDotplotMarkers();

    const turnoKey = diasporaTurnoKey(byTurn);
    STATE.currentMapMuniSummary = buildDiasporaCountrySummary(byTurn, turnoKey);
    STATE.municipiosLayer = createDiasporaCountriesLayer(geojson);
    STATE.municipiosLayer.addTo(map);
    drawDiasporaTurn(byTurn, turnoKey);

    if (options.keepViewport !== true) {
      MLCompat.fitMapToBounds(map, STATE.municipiosLayer.getBounds(),
        { padding: [20, 20], animate: false });
    }

    selectedLocationIDs.clear();
    STATE.isFilterAggregationActive = false;
    if (typeof window.updateClearSelectionButtonVisibility === 'function') {
      window.updateClearSelectionButtonVisibility();
    }
    if (typeof syncMapModeButtons === 'function') syncMapModeButtons();
    if (typeof updateElectionTypeUI === 'function') updateElectionTypeUI();
    if (typeof updateConditionalUI === 'function') updateConditionalUI();

    // Os filtros de local, bairro, regiao e Censo sao todos do territorio
    // brasileiro: nao ha o que oferecer aqui.
    dom.filterBox?.classList.add('section-hidden');
    dom.vizBox?.classList.add('section-hidden');
    if (dom.btnToggleInaptos) {
      dom.btnToggleInaptos.style.display = 'none';
      dom.btnToggleInaptos.disabled = true;
    }

    renderNationalTurnTabs({ '1T': !!byTurn['1T'], '2T': !!byTurn['2T'] });
    renderDiasporaResults(byTurn, turnoKey);
  } catch (error) {
    console.error('[Diáspora] Falha ao montar a visão do exterior:', error);
    showToast(`Erro ao carregar o voto no exterior: ${error.message}`, 'error');
  } finally {
    if (generation === diasporaView.generation) hideMapLoading();
  }
}

if (typeof window !== 'undefined') {
  window.showDiasporaOverview = showDiasporaOverview;
  window.leaveDiasporaMapState = leaveDiasporaMapState;
  window.refreshDiasporaViewForTurn = refreshDiasporaViewForTurn;
}
