


// Função auxiliar para Tooltip Minimalista
function showHoverTooltip(e, text) {
  let tooltip = document.getElementById('hoverInfoTooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'hoverInfoTooltip';
    tooltip.className = 'hover-info-tooltip';
    document.body.appendChild(tooltip);
  }
  tooltip.textContent = text;
  tooltip.classList.add('visible');
  moveHoverTooltip(e);
}

function moveHoverTooltip(e) {
  const tooltip = document.getElementById('hoverInfoTooltip');
  if (tooltip && tooltip.classList.contains('visible')) {
    tooltip.style.left = (e.clientX + 12) + 'px';
    tooltip.style.top = (e.clientY + 12) + 'px';
  }
}

function hideHoverTooltip() {
  const tooltip = document.getElementById('hoverInfoTooltip');
  if (tooltip) tooltip.classList.remove('visible');
}


function updateNeighborhoodProfileUI() {
  if (selectedLocationIDs.size === 0) {
    if (dom.profileRendaVal) dom.profileRendaVal.textContent = 'R$ --';
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
    if (dom.profileRendaVal) dom.profileRendaVal.textContent = 'R$ --';
    if (dom.profileRacaChart) dom.profileRacaChart.innerHTML = '';
    if (dom.profileGeneroChart) dom.profileGeneroChart.innerHTML = '';
    if (dom.profileIdadeChart) dom.profileIdadeChart.innerHTML = '';
    if (dom.profileSaneamentoChart) dom.profileSaneamentoChart.innerHTML = '';
    if (document.getElementById('profileEscolaridadeChart')) document.getElementById('profileEscolaridadeChart').innerHTML = '';
    if (document.getElementById('profileEstadoCivilChart')) document.getElementById('profileEstadoCivilChart').innerHTML = '';
    return;
  }

  // Render Renda
  const rendaFinal = countRenda > 0 ? sumRenda / countRenda : 0;
  if (dom.profileRendaVal) dom.profileRendaVal.textContent = rendaFinal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

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
        <div class="bar-chart-row" onmousemove="showHoverTooltip(event, '${k}: ${display}')" onmouseleave="hideHoverTooltip()">
           <div class="bar-chart-label" title="${k}">${k}</div>
           <div class="bar-track">
              <div class="bar-fill" style="width: ${Math.min(100, pct)}%; background: var(--accent);"></div>
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
    render('profileEscolaridadeChart', {
      'Analfabeto': abs.Analfabeto, 'Lê e Escreve': abs.LeEscreve,
      'Fund. Incomp.': abs.FundIncomp, 'Fund. Comp.': abs.FundComp,
      'Médio Incomp.': abs.MedIncomp, 'Médio Comp.': abs.MedComp,
      'Sup. Incomp.': abs.SupIncomp, 'Sup. Comp.': abs.SupComp
    }, true);
    render('profileIdadeChart', ageBuckets, true);
  }

  // Saneamento Special Render
  const sanDiv = document.getElementById('profileSaneamentoChart');
  if (sanDiv) {
    const s = pctSum;
    const r = s.RedeGeral / count;
    const f = s.FossaSeptica / count;
    const i = s.Inadequado / count;

    const item = (l, v, c) => `
      <div class="saneamento-item" style="border-top: 3px solid ${c}"
           onmousemove="showHoverTooltip(event, '${l}: ${v.toFixed(1)}%')"
           onmouseleave="hideHoverTooltip()">
         <span class="saneamento-val" style="color:${c}">${v.toFixed(1)}%</span>
         <span class="saneamento-lbl">${l}</span>
      </div>`;

    sanDiv.innerHTML = item('Rede Geral', r, 'var(--ok)') +
      item('Fossa Séptica', f, 'var(--warn)') +
      item('Inadequado', i, 'var(--err)');
  }
  render('profileSaneamentoChart', {
    'Rede Geral': pctSum.RedeGeral,
    'Fossa SÃ©ptica': pctSum.FossaSeptica,
    'Inadequado': pctSum.Inadequado
  }, false);
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

    // Auto-calcular estatísticas para o primeiro candidato selecionado
    const candidatoKey = dom.selectVizCandidato.value;
    if (candidatoKey) {
      performanceModeStats = calculateCandidateStats(candidatoKey) || {
        candidato: candidatoKey, minPct: 0, maxPct: 100, avgPct: 0, totalLocais: 0
      };
      console.log('📊 Modo Desempenho ativado - Stats:', performanceModeStats);
      updatePerformanceStatsUI();
    } else {
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
  if (!dom.selectVizColorStyle) return;

  currentVizColorStyle = 'gradient';
  dom.selectVizColorStyle.value = 'gradient';
  dom.selectVizColorStyle.disabled = true;
  const colorStyleCtrl = document.getElementById('vizColorStyleCtrl');
  if (colorStyleCtrl) colorStyleCtrl.classList.add('section-hidden');
}

function applyDefaultVizColorStyleForCurrentCargo() {
  currentVizColorStyle = getDefaultVizColorStyleForOffice(currentOffice);
  syncVizColorStyleControl();
}

function isLimitedCensusYear2006() {
  return String(STATE.currentElectionYear) === '2006';
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
  if (typeof syncRegionalFilterVisibility === 'function') syncRegionalFilterVisibility();
  syncVizColorStyleControl();
  if (currentVizMode.startsWith('desempenho')) updateVizModeUI();
  // Turn visibility is handled by setupTurnTabs now.
}

function updateElectionTypeUI() {
  const isMunicipal = STATE.currentElectionType === 'municipal';
  const hasMunicipalSelection = !!(dom.selectMunicipio?.value);
  if (dom.ctrlCidadeFilter) dom.ctrlCidadeFilter.classList.toggle('section-hidden', isMunicipal);
  if (dom.officeBoxGeneral) dom.officeBoxGeneral.classList.toggle('section-hidden', isMunicipal);
  if (dom.officeBoxMunicipal) dom.officeBoxMunicipal.classList.toggle('section-hidden', !isMunicipal || !hasMunicipalSelection);
  if (!isMunicipal) {
    dom.cargoChipsMunicipal.innerHTML = '';
    dom.cargoBoxMunicipal.classList.add('section-hidden');
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
