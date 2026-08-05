



function updateNeighborhoodProfileUI() {
  if (selectedLocationIDs.size === 0) {
    if (dom.profileRendaVal) dom.profileRendaVal.textContent = '--';
    if (dom.profileRacaChart) dom.profileRacaChart.innerHTML = '';
    if (dom.profileGeneroChart) dom.profileGeneroChart.innerHTML = '';
    if (dom.profileIdadeChart) dom.profileIdadeChart.innerHTML = '';
    if (dom.profileSaneamentoChart) dom.profileSaneamentoChart.innerHTML = '';
    if (document.getElementById('profileEscolaridadeChart')) document.getElementById('profileEscolaridadeChart').innerHTML = '';
    if (document.getElementById('profileEstadoCivilChart')) document.getElementById('profileEstadoCivilChart').innerHTML = '';
    return;
  }

  const geojson = currentDataCollection[currentCargo];
  if (!geojson) return;

  const isLegacy = isLimitedCensusYear2006();

  // --- ACUMULADORES ---
  let count = 0;

  // Renda
  let sumRenda = 0;
  let countRenda = 0;

  // Absolutos
  const abs = {
    Homens: 0, Mulheres: 0,
    Solteiro: 0, Casado: 0, Divorciado: 0, Viuvo: 0, Separado: 0,
    Analfabeto: 0, LeEscreve: 0, FundIncomp: 0, FundComp: 0, MedIncomp: 0, MedComp: 0, SupIncomp: 0, SupComp: 0
  };

  // Idade Buckets
  const ageBucketDefs = window.AGE_BUCKETS_STANDARD || [
    { key: '16-29', min: 16, max: 29 },
    { key: '30-45', min: 30, max: 45 },
    { key: '46-59', min: 46, max: 59 },
    { key: '60+', min: 60, max: 200 }
  ];
  const ageBuckets = Object.fromEntries(ageBucketDefs.map(def => [def.key, 0]));

  // Pct Media (Raça/Saneamento)
  const pctSum = {
    Branca: 0, Preta: 0, Parda: 0, Amarela: 0, Indigena: 0,
    RedeGeral: 0, FossaSeptica: 0, Inadequado: 0
  };

  // Helper robusto para pegar valor numérico de chaves variadas
  const getVal = (props, candidates) => {
    for (const key of candidates) {
      if (props[key] !== undefined) return ensureNumber(props[key]);
      // Fallback para case-insensitive se não achar direto
      const upper = key.toUpperCase();
      for (const k in props) {
        if (k.toUpperCase() === upper) return ensureNumber(props[k]);
      }
    }
    return 0;
  };

  geojson.features.forEach(f => {
    const id = typeof getFeatureSelectionId === 'function'
      ? getFeatureSelectionId(f.properties)
      : String(getProp(f.properties, 'id_unico') || getProp(f.properties, 'local_id') || getProp(f.properties, 'nr_locvot') || '');

    if (selectedLocationIDs.has(id)) {
      count++;
      const p = f.properties;

      // Renda
      const r = ensureNumber(p['Renda Media']);
      if (r > 0) { sumRenda += r; countRenda++; }

      // Raça (Pct)
      pctSum.Branca += getVal(p, ['Pct Branca', 'PCT BRANCA']);
      pctSum.Preta += getVal(p, ['Pct Preta', 'PCT PRETA']);
      pctSum.Parda += getVal(p, ['Pct Parda', 'PCT PARDA']);
      pctSum.Amarela += getVal(p, ['Pct Amarela', 'PCT AMARELA']);
      pctSum.Indigena += getVal(p, ['Pct Indigena', 'PCT INDIGENA']);

      // Saneamento (Pct)
      pctSum.RedeGeral += getVal(p, ['Pct Esgoto Rede Geral']);
      pctSum.FossaSeptica += getVal(p, ['Pct Fossa Septica', 'Pct Fossa Séptica']);
      pctSum.Inadequado += getVal(p, ['Pct Esgoto Inadequado']);

      if (!isLegacy) {
        // --- DADOS ABSOLUTOS ---

        // Gênero
        abs.Homens += getVal(p, ['MASCULINO', 'HOMENS', 'Homens']);
        abs.Mulheres += getVal(p, ['FEMININO', 'MULHERES', 'Mulheres']);

        // Estado Civil
        abs.Solteiro += getVal(p, ['SOLTEIRO', 'Solteiro']);
        abs.Casado += getVal(p, ['CASADO', 'Casado']);
        abs.Divorciado += getVal(p, ['DIVORCIADO', 'Divorciado']);
        abs.Viuvo += getVal(p, ['VIÚVO', 'VIUVO', 'Viúvo', 'Viuvo']);
        abs.Separado += getVal(p, ['SEPARADO JUDICIALMENTE', 'SEPARADO', 'Separado']);

        // Escolaridade
        abs.Analfabeto += getVal(p, ['ANALFABETO', 'Analfabeto']);
        abs.LeEscreve += getVal(p, ['LÊ E ESCREVE', 'LE E ESCREVE', 'Lê e Escreve']);
        abs.FundIncomp += getVal(p, ['ENSINO FUNDAMENTAL INCOMPLETO', 'FUNDAMENTAL INCOMPLETO']);
        abs.FundComp += getVal(p, ['ENSINO FUNDAMENTAL COMPLETO', 'FUNDAMENTAL COMPLETO']);
        abs.MedIncomp += getVal(p, ['ENSINO MÉDIO INCOMPLETO', 'MEDIO INCOMPLETO']);
        abs.MedComp += getVal(p, ['ENSINO MÉDIO COMPLETO', 'MEDIO COMPLETO']);
        abs.SupIncomp += getVal(p, ['ENSINO SUPERIOR INCOMPLETO', 'SUPERIOR INCOMPLETO']);
        abs.SupComp += getVal(p, ['ENSINO SUPERIOR COMPLETO', 'SUPERIOR COMPLETO']);

        const ageAggregate = aggregateAgeBucketsFromProps(p, ageBucketDefs);
        for (const [bucket, value] of Object.entries(ageAggregate.buckets)) {
          ageBuckets[bucket] += value;
        }
      }
    }
  });

  if (count === 0) {
    clearNeighborhoodProfileCharts();
    return;
  }

  renderDemographicProfile({ count, sumRenda, countRenda, pctSum, abs, ageBuckets }, isLegacy);
}

function clearNeighborhoodProfileCharts() {
  if (dom.profileRendaVal) dom.profileRendaVal.textContent = '--';
  if (dom.profileRacaChart) dom.profileRacaChart.innerHTML = '';
  if (dom.profileGeneroChart) dom.profileGeneroChart.innerHTML = '';
  if (dom.profileIdadeChart) dom.profileIdadeChart.innerHTML = '';
  if (dom.profileSaneamentoChart) dom.profileSaneamentoChart.innerHTML = '';
  const esc = document.getElementById('profileEscolaridadeChart');
  if (esc) esc.innerHTML = '';
  const civil = document.getElementById('profileEstadoCivilChart');
  if (civil) civil.innerHTML = '';
}

// Metade de RENDERIZACAO do perfil, separada da acumulacao. Recebe os mesmos
// acumuladores que updateNeighborhoodProfileUI monta a partir dos locais
// selecionados — o que permite alimenta-la tambem com o agregado nacional
// pre-calculado (ver scripts/gerar_perfil_nacional.py), que nao tem locais
// carregados para somar.
function renderDemographicProfile(totals, isLegacy = isLimitedCensusYear2006()) {
  const { count, sumRenda, countRenda, pctSum, abs, ageBuckets } = totals;

  // 2006 so tem raca, renda e saneamento: as demais secoes ficam escondidas em
  // vez de aparecerem zeradas. Vive aqui (e nao na acumulacao) porque vale
  // igual para o perfil do recorte selecionado e para o nacional.
  const toggleProfileSection = (chartId, visible) => {
    const chart = document.getElementById(chartId);
    const section = chart?.closest('.profile-section');
    if (section) section.style.display = visible ? '' : 'none';
    if (!visible && chart) chart.innerHTML = '';
  };

  toggleProfileSection('profileRacaChart', true);
  toggleProfileSection('profileSaneamentoChart', true);
  toggleProfileSection('profileGeneroChart', !isLegacy);
  toggleProfileSection('profileIdadeChart', !isLegacy);
  toggleProfileSection('profileEscolaridadeChart', !isLegacy);
  toggleProfileSection('profileEstadoCivilChart', !isLegacy);

  // Render Renda
  const rendaFinal = countRenda > 0 ? sumRenda / countRenda : 0;
  if (dom.profileRendaVal) dom.profileRendaVal.textContent = countRenda > 0 ? rendaFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--';

  // Hide Alfabetização
  const alfa = document.getElementById('profileAlfabetizacaoSection');
  if (alfa) alfa.style.display = 'none';

  // Helper de Renderização
  const render = (id, data, useAbsSum) => {
    const el = document.getElementById(id);
    if (!el) return;

    let total = 0;
    // Se for absoluto, soma todos para achar o 100%
    if (useAbsSum) Object.values(data).forEach(v => total += v);
    // Se for Pct Média (Legacy/Raça), o 'total' conceitual é count * 100 (mas calculamos media direta)

    let html = '';
    for (const [k, v] of Object.entries(data)) {
      let pct = 0;
      let display = '';

      if (useAbsSum) {
        pct = total > 0 ? (v / total * 100) : 0;
        display = fmtInt(v);
      } else {
        // Média de Porcentagem
        pct = v / count;
        display = pct.toFixed(1) + '%';
      }

      html += `
        <div class="bar-chart-row">
           <div class="bar-chart-label" title="${k}">${k}</div>
           <div class="bar-track">
              <div class="bar-fill" style="width: ${Math.min(100, pct)}%;"></div>
           </div>
           <div class="bar-value">${pct.toFixed(1)}%</div>
        </div>`;
    }
    el.innerHTML = html;
  };

  // Render Groups
  render('profileRacaChart', {
    'Branca': pctSum.Branca, 'Preta': pctSum.Preta, 'Parda': pctSum.Parda,
    'Amarela': pctSum.Amarela, 'Indígena': pctSum.Indigena
  }, false); // Pct Media

  if (!isLegacy) {
    render('profileGeneroChart', { 'Mulheres': abs.Mulheres, 'Homens': abs.Homens }, true); // Abs Sum
    render('profileEstadoCivilChart', {
      'Solteiro': abs.Solteiro, 'Casado': abs.Casado, 'Divorciado': abs.Divorciado,
      'Separado': abs.Separado, 'Viúvo': abs.Viuvo
    }, true);
    render('profileEscolaridadeChart', getEscolaridadeGroupedTotals({
      ana: abs.Analfabeto,
      le: abs.LeEscreve,
      fi: abs.FundIncomp,
      fc: abs.FundComp,
      mi: abs.MedIncomp,
      mc: abs.MedComp,
      si: abs.SupIncomp,
      sc: abs.SupComp
    }), true);
    render('profileIdadeChart', ageBuckets, true);
  }

  render('profileSaneamentoChart', {
    'Rede Geral': pctSum.RedeGeral,
    'Fossa Séptica': pctSum.FossaSeptica,
    'Inadequado': pctSum.Inadequado
  }, false);

  // Trigger mobile results reactive notification badge
  if (typeof triggerMobileResultsNotification === 'function') {
    triggerMobileResultsNotification();
  }
}

function processAgeLegacy(p, buckets) {
  const ageAggregate = aggregateAgeBucketsFromProps(p, window.AGE_BUCKETS_STANDARD);
  for (const [bucket, value] of Object.entries(ageAggregate.buckets)) {
    buckets[bucket] = (buckets[bucket] || 0) + value;
  }
}



function updateApplyButtonText() {
  const hasLoadedData = !!currentDataCollection[currentCargo];
  let btnDisabled = true;
  let btnText = 'Filtros automáticos';

  const isGeral = false;
  const isAllCities = false;

  // Texto dinâmico
  if (STATE.currentElectionType === 'municipal') {
    const mun = dom.selectMunicipio.value;
    btnText = 'Filtros automáticos';
    if (currentBairroFilter !== 'all') {
      btnText = 'Filtros automáticos';
    }
  } else {
    // Modo GERAL
    const regionalLabel = getRegionalFilterSummaryLabel();
    if (isAllCities && regionalLabel) {
      btnText = 'Filtros automáticos';
    } else if (isAllCities) {
      const uf = dom.selectUFGeneral.value;
      btnText = 'Filtros automáticos';
    } else {
      // Cidade específica selecionada
      const selectedText = dom.inputCidade ? dom.inputCidade.value : currentCidadeFilter;
      btnText = 'Filtros automáticos';
    }
  }

  if (STATE.hasPendingFilterChanges && hasLoadedData) {
    btnText = `${btnText} • Aplicar`;
  }

  if (!hasLoadedData) {
    btnText = 'Carregue os dados';
  } else if (STATE.hasPendingFilterChanges) {
    btnText = 'Atualizando filtros...';
  }

  if (!dom.btnApplyFilters) return;
  dom.btnApplyFilters.textContent = btnText;
  dom.btnApplyFilters.disabled = btnDisabled;
  dom.btnApplyFilters.classList.toggle('cta-ready', false);
  dom.btnApplyFilters.classList.toggle('pending-action', hasLoadedData && STATE.hasPendingFilterChanges);

  // REMOVIDO O BLOCO QUE CAUSAVA O ERRO (dom.btnShowByBairro)
}

function updateVizModeUI() {
  if (currentVizMode.startsWith('desempenho')) {
    const turno = (currentTurno === 2 && STATE.dataHas2T[currentCargo]) ? '2T' : '1T';
    populateVizCandidatoDropdown(turno);
    dom.vizCandidatoBox.classList.remove('section-hidden');
    dom.selectVizCandidato.disabled = false;

    // Don't auto-select a candidate — wait for user to choose
    // If there's already a selected value (from a previous interaction), keep it
    const candidatoKey = dom.selectVizCandidato.value;
    if (candidatoKey && candidatoKey !== '__placeholder__') {
      performanceModeStats = calculateCandidateStats(candidatoKey) || {
        candidato: candidatoKey, minPct: 0, maxPct: 100, avgPct: 0, totalLocais: 0
      };
      updatePerformanceStatsUI();
    } else {
      // No candidate selected yet — show empty state
      performanceModeStats = { candidato: null, minPct: 0, maxPct: 0, avgPct: 0, totalLocais: 0 };
      updatePerformanceStatsUI();
    }
  } else {
    dom.vizCandidatoBox.classList.add('section-hidden');
    dom.selectVizCandidato.disabled = true;
    dom.selectVizCandidato.style.display = '';

    // Esconder campo de busca de deputados
    const deputySearchBox = document.getElementById('deputySearchBox');
    if (deputySearchBox) deputySearchBox.style.display = 'none';

    // Limpar estatísticas e UI ao sair do modo desempenho
    performanceModeStats = { candidato: null, minPct: 0, maxPct: 0, avgPct: 0, totalLocais: 0 };
    updatePerformanceStatsUI();
  }
}

function getDefaultVizColorStyleForOffice(office = currentOffice) {
  return 'gradient';
}

function isGradientVizBlockedForCurrentCargo() {
  return false;
}

function syncVizColorStyleControl() {
  if (dom.selectVizColorStyle) {
    currentVizColorStyle = 'gradient';
    dom.selectVizColorStyle.value = 'gradient';
    dom.selectVizColorStyle.disabled = true;
  }
  const colorStyleCtrl = document.getElementById('vizColorStyleCtrl');
  if (colorStyleCtrl) colorStyleCtrl.classList.add('section-hidden');

  // Gradient mode toggle (Margem vs % do Vencedor)
  const gradientModeCtrl = document.getElementById('vizGradientModeCtrl');
  if (gradientModeCtrl) {
    const showGradientMode = currentVizMode.startsWith('vencedor');
    gradientModeCtrl.classList.toggle('section-hidden', !showGradientMode);
  }
}

function applyDefaultVizColorStyleForCurrentCargo() {
  currentVizColorStyle = getDefaultVizColorStyleForOffice(currentOffice);
  currentGradientMode = 'margin';
  // Sync chip UI
  if (dom.vizGradientModeChips) {
    dom.vizGradientModeChips.querySelectorAll('.chip-button').forEach(b => {
      b.classList.toggle('active', b.dataset.value === 'margin');
    });
  }
  syncVizColorStyleControl();
}

// ===================== TABELA PADRAO DAS SIDEBARS DE RESULTADO =====================
//
// Padrao unico do app, tirado da sidebar de presidente do resumo nacional (a
// mesma de governador/senador no estadual e de prefeito): faixa de cor a
// esquerda, nome com a barra de porcentagem LOGO ABAIXO dele, e as colunas
// numericas na ordem Cadeiras -> Votos -> Pct.
//
// Cadeiras e Votos so aparecem se alguma linha tiver o valor, entao a mesma
// funcao serve para eleicao majoritaria (votos + pct), contagem de vencedores
// (contagem + pct) e legislativa (cadeiras + votos + pct).
//
// rows: [{ label, sublabel, color, seats, votes, pct, highlight, title,
//          rowClass, rowAttrs, colorPicker: {name, party} }]
function buildStandardResultsTable(rows, options = {}) {
  const lista = Array.isArray(rows) ? rows : [];
  const temCadeiras = lista.some((r) => r.seats !== undefined && r.seats !== null);
  const temVotos = lista.some((r) => r.votes !== undefined && r.votes !== null);

  const cabecalho = [
    '<th class="color-bar-td"></th>',
    `<th class="align-left">${escapeHtml(options.labelHeader || 'Candidato')}</th>`,
    temCadeiras ? `<th class="align-center">${escapeHtml(options.seatsHeader || 'Cadeiras')}</th>` : '',
    temVotos ? `<th class="align-center">${escapeHtml(options.votesHeader || 'Votos')}</th>` : '',
    '<th class="align-center">Pct.</th>'
  ].join('');

  const corpo = lista.map((row) => {
    const cor = row.color || DEFAULT_SWATCH;
    const pct = Math.min(100, Math.max(0, ensureNumber(row.pct) * 100));

    // Candidato tem seletor de cor (a faixa vira botao); partido/legenda nao,
    // e entao a mesma faixa sai como span — o CSS so da cursor/hover ao button.
    const faixa = row.colorPicker
      ? `<button type="button" class="swatch-button cand-color-bar"
             style="background-color: ${cor};"
             data-candidate-name="${escapeAttribute(row.colorPicker.name || '')}"
             data-candidate-party="${escapeAttribute(row.colorPicker.party || '')}"
             data-current-color="${cor}"
             title="Personalizar cor do candidato"></button>`
      : `<span class="cand-color-bar" style="background-color: ${cor};"></span>`;

    const celulas = [
      `<td class="color-bar-td">${faixa}</td>`,
      `<td class="align-left">
        <div class="cand-name-container">
          ${row.highlight ? `<span class="cand-check-circle" style="background-color: ${cor};">✔</span>` : ''}
          <span class="cand-name-text">${escapeHtml(row.label || '')}</span>
        </div>
        <div class="cand-mini-bar-wrap">
          <div class="cand-mini-bar" style="width: ${pct}%; background-color: ${cor};"></div>
        </div>
        ${row.sublabel ? `<div style="font-size: 0.65rem; color: var(--muted); margin-top: 2px;">${escapeHtml(row.sublabel)}</div>` : ''}
      </td>`,
      temCadeiras ? `<td class="align-center cand-votes-text">${row.seats === undefined || row.seats === null ? '—' : fmtInt(row.seats)}</td>` : '',
      temVotos ? `<td class="align-center cand-votes-text">${row.votes === undefined || row.votes === null ? '—' : fmtInt(row.votes)}</td>` : '',
      `<td class="align-center pct-text">${fmtPct(ensureNumber(row.pct))}</td>`
    ].join('');

    return `<tr class="${row.rowClass || ''}"${row.title ? ` title="${escapeAttribute(row.title)}"` : ''}${row.rowAttrs || ''}>${celulas}</tr>`;
  }).join('');

  return `<table class="cand-table"><thead><tr>${cabecalho}</tr></thead><tbody>${corpo}</tbody></table>`;
}

if (typeof window !== 'undefined') {
  window.buildStandardResultsTable = buildStandardResultsTable;
}

function isLimitedCensusYear2006() {
  return String(STATE.currentElectionYear) === '2006';
}

// ===================== PERFIL DEMOGRAFICO DO BRASIL =====================
//
// No escopo nacional nao ha locais de votacao carregados para somar — o mapa e
// por estado. O agregado vem pronto de resultados_geo/Censo <ANO>/, gerado por
// scripts/gerar_perfil_nacional.py com exatamente a mesma conta que
// updateNeighborhoodProfileUI faz sobre o recorte selecionado.
//
// Cada eleicao le o censo do seu proprio ano, entao o perfil acompanha a
// eleicao escolhida. 1989/1994/1998/2002 nao tem censo no acervo: nesses anos
// o painel some, em vez de mostrar um perfil de outra epoca.
const NATIONAL_PROFILE_CACHE = new Map();

function hasNationalDemographicProfile(year = STATE.currentElectionYear) {
  return Number(year) >= 2006;
}

async function loadNationalDemographicProfile(year) {
  const chave = String(year);
  if (NATIONAL_PROFILE_CACHE.has(chave)) return NATIONAL_PROFILE_CACHE.get(chave);

  const promise = fetch(`${DATA_BASE_URL}Censo ${chave}/perfil_nacional_${chave}.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`Sem perfil nacional para ${chave}`);
      return res.json();
    });

  NATIONAL_PROFILE_CACHE.set(chave, promise);
  promise.catch(() => {
    if (NATIONAL_PROFILE_CACHE.get(chave) === promise) NATIONAL_PROFILE_CACHE.delete(chave);
  });
  return promise;
}

async function showNationalDemographicProfile(year = STATE.currentElectionYear) {
  if (!dom.neighborhoodProfile) return;

  if (!hasNationalDemographicProfile(year)) {
    dom.neighborhoodProfile.style.display = 'none';
    return;
  }

  try {
    const totals = await loadNationalDemographicProfile(year);
    // Troca de ano/escopo enquanto o fetch corria: o painel ja e de outra coisa.
    if (String(STATE.currentElectionYear) !== String(year)) return;
    if (typeof isNationalGeneralScope === 'function' && !isNationalGeneralScope()) return;

    dom.neighborhoodProfile.style.display = '';
    renderDemographicProfile(totals, String(year) === '2006');

    const titulo = dom.neighborhoodProfile.querySelector('.profile-header h3');
    if (titulo) titulo.textContent = `Perfil Demográfico — Brasil (${year})`;
  } catch (error) {
    console.warn('[Nacional] Perfil demográfico indisponível:', error);
    clearNeighborhoodProfileCharts();
    dom.neighborhoodProfile.style.display = 'none';
  }
}

// O titulo vira "Perfil Demografico — Brasil (ANO)" no escopo nacional; ao
// descer para um estado ou municipio tem que voltar ao rotulo original.
function resetDemographicProfileTitle() {
  const titulo = dom.neighborhoodProfile?.querySelector('.profile-header h3');
  if (titulo) titulo.textContent = 'Perfil Demográfico';
}

if (typeof window !== 'undefined') {
  window.showNationalDemographicProfile = showNationalDemographicProfile;
  window.resetDemographicProfileTitle = resetDemographicProfileTitle;
  window.renderDemographicProfile = renderDemographicProfile;
  window.clearNeighborhoodProfileCharts = clearNeighborhoodProfileCharts;
}

function resetUnavailableCensusFiltersForYear() {
  if (!isLimitedCensusYear2006()) return;

  STATE.censusFilters.generoVal = null;
  STATE.censusFilters.idadeVal = null;
  STATE.censusFilters.escolaridadeVal = null;
  STATE.censusFilters.estadoCivilVal = null;
}

function updateCensusControlsForYear() {
  resetUnavailableCensusFiltersForYear();

  const limited2006 = isLimitedCensusYear2006();
  const allowedTabs = new Set(limited2006
    ? ['tab-renda', 'tab-raca', 'tab-saneamento']
    : ['tab-renda', 'tab-raca', 'tab-idade', 'tab-genero', 'tab-escolaridade', 'tab-estadocivil', 'tab-saneamento']);

  document.querySelectorAll('#demographicFilters .filter-tabs .tab-btn').forEach((btn) => {
    const tabId = btn.dataset.tab;
    const visible = allowedTabs.has(tabId);
    btn.style.display = visible ? '' : 'none';
    btn.disabled = !visible;
    if (!visible) btn.classList.remove('active');
  });

  document.querySelectorAll('#demographicFilters .tab-content').forEach((content) => {
    const visible = allowedTabs.has(content.id);
    content.style.display = visible ? '' : 'none';
    if (!visible) content.classList.add('hidden');
  });

  const activeBtn = document.querySelector('#demographicFilters .filter-tabs .tab-btn.active');
  if (!activeBtn || !allowedTabs.has(activeBtn.dataset.tab)) {
    const fallbackBtn = document.querySelector('#demographicFilters .filter-tabs .tab-btn[data-tab="tab-renda"]');
    if (fallbackBtn) {
      document.querySelectorAll('#demographicFilters .filter-tabs .tab-btn').forEach((btn) => btn.classList.remove('active'));
      fallbackBtn.classList.add('active');
      document.querySelectorAll('#demographicFilters .tab-content').forEach((content) => {
        content.classList.toggle('hidden', content.id !== 'tab-renda' || !allowedTabs.has(content.id));
      });
    }
  }
}

function updateConditionalUI() {
  const show2T = STATE.dataHas2T[currentCargo] || false;
  updateCensusControlsForYear();
  syncVizColorStyleControl();
  if (currentVizMode.startsWith('desempenho')) updateVizModeUI();
  // Turn visibility is handled by setupTurnTabs now.
}

function updateElectionTypeUI() {
  const isMunicipal = STATE.currentElectionType === 'municipal';
  const hasMunicipalSelection = !!(dom.selectMunicipio?.value);
  const showElectionContext = !isMunicipal || hasMunicipalSelection;
  if (dom.electionContextBox) dom.electionContextBox.classList.toggle('section-hidden', !showElectionContext);
  if (dom.ctrlCidadeFilter) dom.ctrlCidadeFilter.classList.toggle('section-hidden', isMunicipal);
  if (dom.officeBoxGeneral) dom.officeBoxGeneral.classList.toggle('section-hidden', isMunicipal);
  if (dom.officeBoxMunicipal) dom.officeBoxMunicipal.classList.toggle('section-hidden', !isMunicipal || !hasMunicipalSelection);
  if (!isMunicipal) {
    dom.cargoChipsMunicipal.innerHTML = '';
    dom.cargoBoxMunicipal.classList.add('section-hidden');
  } else if (dom.cargoBoxGeneral) {
    dom.cargoChipsGeneralSubtype.innerHTML = '';
    dom.cargoBoxGeneral.classList.add('section-hidden');
  }

  // 1989/1994 (gerais) nao tem locais de votacao nem censo: o mapa e sempre o
  // coropletico municipal e os filtros demograficos ficam ocultos.
  const isMuniOnlyGeral = !isMunicipal && isMuniOnlyGeneralYear();

  // --- MUNICIPAL UI REFINEMENTS ---
  // A barra de modos so some nas municipais. Em 1989/1994 some apenas o botao
  // "Locais de Votacao" (nao ha locais nesses anos), mas municipios e regioes
  // funcionam: todo municipio historico cai em exatamente uma regiao moderna.
  if (dom.layerToggleGroup) {
      dom.layerToggleGroup.style.display = isMunicipal ? 'none' : '';
  }
  // A segunda linha (Perspectiva/Altura) acompanha a primeira: nas municipais a
  // barra inteira some, como antes de ela ser dividida em duas.
  if (dom.mapRenderControls) {
      dom.mapRenderControls.style.display = isMunicipal ? 'none' : '';
  }
  // No escopo nacional o unico recorte possivel e o estado: municipios e locais
  // do pais inteiro nao cabem no mapa nem no navegador, e os quatro niveis do
  // IBGE sao particoes de UMA UF. Fora dele, "Estados" e que nao se aplica.
  const isNacional = typeof isNationalGeneralScope === 'function' && isNationalGeneralScope();
  if (dom.btnMapModeEstados) {
      dom.btnMapModeEstados.style.display = (!isMunicipal && isNacional) ? '' : 'none';
  }
  if (dom.btnMapModeMunicipios) {
      dom.btnMapModeMunicipios.style.display = isNacional ? 'none' : '';
  }
  dom.layerToggleGroup?.querySelectorAll('[data-region-level]').forEach((btn) => {
      if (btn.dataset.regionLevel === 'uf') return;
      btn.style.display = isNacional ? 'none' : '';
  });
  if (dom.btnMapModeLocais) {
      dom.btnMapModeLocais.style.display = (isMuniOnlyGeral || isNacional) ? 'none' : '';
  }

  // Filtros demograficos so fazem sentido com um municipio selecionado;
  // no resumo estadual eles operariam sobre dados residuais do ultimo municipio.
  const demoBox = document.getElementById('demographicFilters');
  if (demoBox) demoBox.classList.toggle('section-hidden', (isMunicipal && !hasMunicipalSelection) || isMuniOnlyGeral);

  // Hide neighborhood profile in statewide overview (if isMunicipal and no city selected)
  // e em 1994 (sem censo, o perfil ficaria todo zerado)
  if (dom.neighborhoodProfile) {
      // No escopo nacional o perfil e do pais inteiro, e vem pre-calculado —
      // quem decide exibir e showNationalDemographicProfile, que so mostra o
      // painel se houver censo para o ano da eleicao.
      const shouldShowProfile = isNacional
        ? hasNationalDemographicProfile()
        : (!isMunicipal || hasMunicipalSelection) && !isMuniOnlyGeral;
      dom.neighborhoodProfile.style.display = shouldShowProfile ? '' : 'none';
      if (!isNacional) resetDemographicProfileTitle();
  }

  if (!isMunicipal) {
    updateGeneralSubtypeChips();
    return;
  }

  if (!hasMunicipalSelection) {
    dom.cargoChipsMunicipal.innerHTML = '';
    dom.cargoBoxMunicipal.classList.add('section-hidden');
    return;
  }

  dom.cargoChipsMunicipal.innerHTML = '';

  // Vereador não tem suplementar — esconde a caixa de ord/sup
  if (currentOffice === 'vereador') {
    dom.cargoBoxMunicipal.classList.add('section-hidden');
    return;
  }

  // Verifica se existe ordinaria
  if (currentDataCollection[`${currentOffice}_ord`]) {
    const btnOrd = document.createElement('button');
    btnOrd.className = 'chip-button' + (currentSubType === 'ord' ? ' active' : '');
    btnOrd.dataset.type = 'ord';
    btnOrd.textContent = 'Ordinária';
    dom.cargoChipsMunicipal.appendChild(btnOrd);
  }

  // Verifica se existe suplementar
  if (currentDataCollection[`${currentOffice}_sup`]) {
    const btnSup = document.createElement('button');
    btnSup.className = 'chip-button' + (currentSubType === 'sup' ? ' active' : '');
    btnSup.dataset.type = 'sup';
    btnSup.textContent = 'Suplementar';
    dom.cargoChipsMunicipal.appendChild(btnSup);

    // ESTA LINHA É CRUCIAL: Faz a caixa aparecer
    dom.cargoBoxMunicipal.classList.remove('section-hidden');
  } else {
    // Se só tem ordinária, esconde a caixa
    dom.cargoBoxMunicipal.classList.add('section-hidden');
    if (currentSubType === 'sup') {
      currentSubType = 'ord';
      currentCargo = `${currentOffice}_ord`;
    }
  }
}

// Rotulo do chip suplementar nas gerais, por ano do ciclo (a suplementar do
// governador do AM do ciclo 2014 ocorreu em 2017).
const GENERAL_SUP_CHIP_LABELS = { '2014': 'Suplementar (2017)' };

function updateGeneralSubtypeChips() {
  if (!dom.cargoBoxGeneral || !dom.cargoChipsGeneralSubtype) return;

  dom.cargoChipsGeneralSubtype.innerHTML = '';

  const hasSup = currentOffice !== 'deputado' && !!currentDataCollection[`${currentOffice}_sup`];
  if (!hasSup) {
    dom.cargoBoxGeneral.classList.add('section-hidden');
    if (currentSubType === 'sup' && currentOffice !== 'deputado') {
      currentSubType = 'ord';
      currentCargo = `${currentOffice}_ord`;
    }
    return;
  }

  if (currentDataCollection[`${currentOffice}_ord`]) {
    const btnOrd = document.createElement('button');
    btnOrd.className = 'chip-button' + (currentSubType === 'ord' ? ' active' : '');
    btnOrd.dataset.type = 'ord';
    btnOrd.textContent = 'Ordinária';
    dom.cargoChipsGeneralSubtype.appendChild(btnOrd);
  }

  const btnSup = document.createElement('button');
  btnSup.className = 'chip-button' + (currentSubType === 'sup' ? ' active' : '');
  btnSup.dataset.type = 'sup';
  btnSup.textContent = GENERAL_SUP_CHIP_LABELS[String(STATE.currentElectionYear)] || 'Suplementar';
  dom.cargoChipsGeneralSubtype.appendChild(btnSup);

  dom.cargoBoxGeneral.classList.remove('section-hidden');
}
