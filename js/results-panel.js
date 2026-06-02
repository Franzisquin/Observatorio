function updateSelectionUI(isFilterAggregation = false) {
  if (typeof invalidateScopedProportionalColorLookup === 'function') {
    invalidateScopedProportionalColorLookup();
  }
  STATE.isFilterAggregationActive = isFilterAggregation;

  const count = selectedLocationIDs.size;
  if (count === 0) {
    clearSelection(false);
    return;
  }

  if (isFilterAggregation) {
    if (currentLayer && currentLayer.resetStyle) currentLayer.resetStyle();
  } else {
    // Also update style for manual selection!
    if (currentLayer && currentLayer.setStyle) currentLayer.setStyle(getFeatureStyle);
  }

  const aggregatedProps = aggregatePropsForSelection(selectedLocationIDs);
  const year = STATE.currentElectionYear;

  if (dom.btnLocateSelection) {
    dom.btnLocateSelection.style.display = 'none';
  }

  // --- LÃƒâ€œGICA DE TÃTULO ATUALIZADA ---
  if (STATE.currentElectionType === 'municipal') {
    if (isFilterAggregation) {
      const censusLabel = getActiveCensusFilterLabel();

      if (censusLabel) {
        dom.resultsTitle.textContent = `Filtro • ${censusLabel}`;
        dom.resultsSubtitle.textContent = `${count} locais encontrados neste perfil`;
      } else {
        let title = dom.selectMunicipio.value;
        if (currentBairroFilter !== 'all') title += ` • ${currentBairroFilter}`;
        dom.resultsTitle.textContent = title;
        dom.resultsSubtitle.textContent = `${count} locais agregados`;
      }
    } else if (count === 1) {
      const props = aggregatedProps[currentCargo];
      const nomeLocal = getProp(props, 'nm_locvot');
      const bairro = getProp(props, 'ds_bairro') || 'Bairro não inf.';
      const zona = getProp(props, 'nr_zona') || 'Zona não inf.';
      dom.resultsTitle.textContent = nomeLocal;
      dom.resultsSubtitle.textContent = `${toTitleCase(bairro)} • Zona: ${zona}`;
    } else {
      dom.resultsTitle.textContent = `${count} locais agregados (${year})`;
      dom.resultsSubtitle.textContent = isDragSelection ? 'Seleção manual com Shift+Arrasta' : 'Seleção manual com Shift+Click';
    }

    // Esconde comparativo em eleições municipais
    dom.summaryBoxContainer.classList.add('section-hidden');

  } else {
    // --- TIPO GERAL (ESTADO/BR) ---
    if (isFilterAggregation) {
      const censusLabel = getActiveCensusFilterLabel();

      if (censusLabel) {
        dom.resultsTitle.textContent = `Filtro • ${censusLabel}`;
        dom.resultsSubtitle.textContent = `${count} locais correspondem ao filtro`;
      } else {
        let title = currentCidadeFilter;
        const regionalLabel = getRegionalFilterSummaryLabel();
        if (title === 'all' && regionalLabel) {
          title = regionalLabel;
        } else if (title === 'all') {
          const uf = dom.selectUFGeneral.value || 'BR';
          title = `Estado Completo (${uf})`;
        }
        if (currentBairroFilter !== 'all') title += ` • ${currentBairroFilter}`;
        dom.resultsTitle.textContent = title;
        dom.resultsSubtitle.textContent = `${count} locais agregados`;
      }
    } else if (count === 1) {
      const props = aggregatedProps[currentCargo];
      const nomeLocal = getProp(props, 'nm_locvot');
      const nomeCidade = getProp(props, 'nm_localidade');
      const bairro = getProp(props, 'ds_bairro') || 'Bairro não inf.';
      const zona = getProp(props, 'nr_zona') || 'Zona não inf.';
      dom.resultsTitle.textContent = nomeLocal;
      dom.resultsSubtitle.textContent = `${toTitleCase(nomeCidade)} • ${toTitleCase(bairro)} • Zona: ${zona}`;
    } else {
      dom.resultsTitle.textContent = `${count} locais agregados (${year})`;
      dom.resultsSubtitle.textContent = isDragSelection ? 'Seleção manual com Shift+Arrasta' : 'Seleção manual com Shift+Click';
    }

    // --- CORREÇÃO: Exibe o container e Atualiza o ANO do título ---
    dom.summaryBoxContainer.classList.add('section-hidden');

    // Atualiza o texto do título (h3) para o ano correto
    if (dom.summaryGrid) dom.summaryGrid.innerHTML = '';
  }

  dom.resultsBox.classList.remove('section-hidden');
  setupTurnTabs(aggregatedProps[currentCargo]);

  renderResultsPanel(aggregatedProps[currentCargo], currentCargo);
  updateNeighborhoodProfileUI();
  if (typeof updatePresidentHistoryPanel === 'function') {
    updatePresidentHistoryPanel(aggregatedProps[currentCargo]);
  }

  // Call ISE Panel update
  if (typeof window.updateISEPanel === 'function') {
    window.updateISEPanel(currentLayer, currentCargo, currentTurno);
  }

  // Update Voltar/Clear Selection button visibility
  if (typeof window.updateClearSelectionButtonVisibility === 'function') {
    window.updateClearSelectionButtonVisibility();
  }
}


function cleanPartyName(value) {
  return value ? value.trim().toUpperCase() : '';
}

function renderSummaryBoxes(aggregatedProps) {
  dom.summaryGrid.innerHTML = '';
  const cargos = ['presidente', 'governador', 'senador'];

  // Configura o listener apenas uma vez
  if (!dom.summaryGrid.dataset.listening) {
    dom.summaryGrid.dataset.listening = "true";
    dom.summaryGrid.addEventListener('click', handleSummaryGridInteraction);
    dom.summaryGrid.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleSummaryGridInteraction(e);
      }
    });
  }

  cargos.forEach(office => {
    let keysToCheck = [`${office}_ord`, `${office}_sup`];
    let props = null;
    let cargoKey = null;

    for (let k of keysToCheck) {
      if (aggregatedProps[k]) {
        props = aggregatedProps[k];
        cargoKey = k;
        break;
      }
    }

    if (!props || Object.keys(props).length === 0) return;

    const turnoKey = (office === 'senador') ? '1T' : (STATE.dataHas2T[cargoKey] && currentTurno === 2) ? '2T' : '1T';
    if (!STATE.candidates[cargoKey]?.[turnoKey]) return;

    const officialSummary = getGeneralOfficialSummaryForScope(cargoKey, turnoKey);
    const inaptosTurno = STATE.inaptos[cargoKey]?.[turnoKey] || [];
    const buildCandidateEntries = (filtrarInaptos = false) => {
      const entries = officialSummary?.votesByDisplayKey
        ? Object.entries(officialSummary.votesByDisplayKey).map(([key, votos]) => ({
          key,
          ...parseCandidateKey(key),
          votos: ensureNumber(votos)
        }))
        : (STATE.candidates[cargoKey][turnoKey] || []).map((key) => ({
          key,
          ...parseCandidateKey(key),
          votos: ensureNumber(getProp(props, key))
        }));

      return entries
        .filter((cand) => !(filtrarInaptos && inaptosTurno.includes(cand.key)))
        .sort((a, b) => b.votos - a.votos);
    };
    const candidatosComInaptos = buildCandidateEntries(false);
    const candidatosSemInaptos = buildCandidateEntries(true);
    const winnerWithInaptos = candidatosComInaptos[0] || { nome: 'N/D', partido: 'N/D', votos: 0, status: 'N/D' };
    const vencedorSemInaptos = candidatosSemInaptos[0] || { nome: 'N/D', partido: 'N/D', votos: 0, status: 'N/D' };
    const totalValidosComInaptos = officialSummary
      ? ensureNumber(officialSummary.totalValidos)
      : getVotosValidos(props, cargoKey, turnoKey, false).totalValidos;
    const totalValidosSemInaptos = officialSummary
      ? candidatosSemInaptos.reduce((sum, cand) => sum + ensureNumber(cand.votos), 0)
      : getVotosValidos(props, cargoKey, turnoKey, true).totalValidos;

    const isInaptoWinner = (winnerWithInaptos.status === 'INAPTO' || winnerWithInaptos.status === 'RENÚNCIA');

    if (isInaptoWinner) {
      const getPct = (v, total) => total > 0 ? v / total : 0;

      const box = document.createElement('div');
      box.className = 'summary-box-dual';

      box.innerHTML = `
                <div class="dual-item" tabindex="0" role="button" 
                     data-cargo="${office}" data-turno="${turnoKey}" data-filter-inaptos="false"
                     data-status="${winnerWithInaptos.status}">
                    <span style="font-size:0.65rem; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px; display:block;">Com Inaptos</span>
                    <h5 style="margin:0; font-size:0.85rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${toTitleCase(winnerWithInaptos.nome)}</h5>
                    <p style="margin:0; font-size:0.75rem; color:var(--muted);">${winnerWithInaptos.partido}</p>
                    <strong style="display:block; margin-top:4px; color:var(--accent-2); font-size:0.8rem;">${fmtPct(getPct(winnerWithInaptos.votos, totalValidosComInaptos))}</strong>
                </div>
                <div class="dual-item" tabindex="0" role="button" 
                     data-cargo="${office}" data-turno="${turnoKey}" data-filter-inaptos="true"
                     data-status="${vencedorSemInaptos.status}">
                    <span style="font-size:0.65rem; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px; display:block;">Sem Inaptos</span>
                    <h5 style="margin:0; font-size:0.85rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${toTitleCase(vencedorSemInaptos.nome)}</h5>
                    <p style="margin:0; font-size:0.75rem; color:var(--muted);">${vencedorSemInaptos.partido}</p>
                    <strong style="display:block; margin-top:4px; color:var(--accent-2); font-size:0.8rem;">${fmtPct(getPct(vencedorSemInaptos.votos, totalValidosSemInaptos))}</strong>
                </div>
            `;
      dom.summaryGrid.appendChild(box);

    } else {
      const segundoColocado = candidatosSemInaptos[1] || { votos: 0 };
      const margemVotos = vencedorSemInaptos.votos - segundoColocado.votos;
      const margemPct = (totalValidosSemInaptos > 0 && vencedorSemInaptos.votos > 0)
        ? (vencedorSemInaptos.votos / totalValidosSemInaptos) - (segundoColocado.votos / totalValidosSemInaptos)
        : 0;

      const box = document.createElement('div');
      box.className = 'summary-box';
      box.tabIndex = 0;
      box.role = 'button';
      box.dataset.cargo = office;
      box.dataset.turno = turnoKey;

      box.innerHTML = `
                <h4 class="cargo-title">${office.charAt(0).toUpperCase() + office.slice(1)} (${turnoKey})</h4>
                <h5>${toTitleCase(vencedorSemInaptos.nome)}</h5>
                <p>${vencedorSemInaptos.partido}</p>
                <span class="margin">+${fmtInt(margemVotos)} (${fmtPct(margemPct)})</span>
            `;
      dom.summaryGrid.appendChild(box);
    }
  });
}





function handleSummaryGridInteraction(e) {
  const target = e.target.closest('[data-cargo]');
  if (!target) return;

  const newCargo = target.dataset.cargo;
  const newTurnoStr = target.dataset.turno;
  const filterInaptosStr = target.dataset.filterInaptos;

  currentOffice = newCargo;
  currentSubType = 'ord';
  currentCargo = `${currentOffice}_${currentSubType}`;

  if (newTurnoStr) {
    currentTurno = (newTurnoStr === '2T') ? 2 : 1;
  }

  if (filterInaptosStr !== undefined) {
    STATE.filterInaptos = (filterInaptosStr === 'true');
    dom.btnToggleInaptos.classList.toggle('active', STATE.filterInaptos);
    dom.btnToggleInaptos.textContent = STATE.filterInaptos ? 'Inaptos Filtrados' : 'Filtrar Inaptos';
  }

  dom.cargoChipsGeneral.querySelectorAll('.chip-button').forEach(b => {
    b.classList.toggle('active', b.dataset.value === newCargo);
  });

  updateElectionTypeUI();
  updateConditionalUI();
  populateCidadeDropdown();
  if (currentCidadeFilter !== 'all' || STATE.currentElectionType === 'municipal') populateBairroDropdown();
  applyFiltersAndRedraw();
  updateSelectionUI(STATE.isFilterAggregationActive);
}

function aggregatePropsForSelection(locationIDs) {
  const aggCollection = {};
  for (const cargo in currentDataCollection) {
    const geojson = currentDataCollection[cargo];
    if (!geojson || !geojson.features) {
      aggCollection[cargo] = null;
      continue;
    }

    let featuresToAgg = [];

    if (STATE.isFilterAggregationActive) {
      featuresToAgg = geojson.features
        .filter(f => filterFeature(f))
        .map(f => f.properties);
    } else {
      geojson.features.forEach(f => {
        const id = getFeatureSelectionId(f.properties);
        if (locationIDs.has(id)) featuresToAgg.push(f.properties);
      });
    }

    aggCollection[cargo] = aggregatePropsList(featuresToAgg);
  }
  return aggCollection;
}

function aggregatePropsList(listOfProps) {
  if (listOfProps.length === 0) return {};
  const agg = { ...listOfProps[0] };
  const textKeys = new Set([
    'local_id', 'ano', 'sg_uf', 'cd_localid', 'cod_locali', 'nr_zona',
    'nr_locvot', 'nr_cep', 'nm_localidade', 'nm_locvot', 'ds_enderec',
    'ds_bairro', 'SG_UF', 'CD_MUNICIPIO', 'NR_ZONA', 'NR_LOCAL_VOTACAO'
  ]);
  for (const k in agg) {
    if (!textKeys.has(k) && !textKeys.has(k.toLowerCase())) {
      const val = ensureNumber(agg[k]);
      if (!isNaN(val)) agg[k] = 0;
    }
  }
  listOfProps.forEach(props => {
    for (const k in props) {
      if (!textKeys.has(k) && !textKeys.has(k.toLowerCase())) {
        const val = ensureNumber(props[k]);
        if (!isNaN(val) && typeof val === 'number') agg[k] = (agg[k] || 0) + val;
      }
    }
  });
  return agg;
}

function setupTurnTabs(props) {
  if (!dom.turnTabs) return;
  dom.turnTabs.innerHTML = '';
  
  const has1T = (STATE.candidates[currentCargo]?.['1T'] || []).length > 0;
  let has2T = STATE.dataHas2T[currentCargo] || false;

  // 1. Hard-coded rules: Legislative offices NEVER have a 2nd turn
  const neverHas2T = (currentCargo.startsWith('senador') || 
                   currentCargo.startsWith('deputado') || 
                   currentCargo.startsWith('vereador'));
  if (neverHas2T) has2T = false;

  // 2. Data-driven verification for majoritarian offices
  if (has2T && props) {
    let totalVotos2T = ensureNumber(getProp(props, 'Total_Votos_Validos 2T'));
    if (totalVotos2T === 0) {
      const { totalValidos } = getVotosValidos(props, currentCargo, '2T', STATE.filterInaptos);
      totalVotos2T = totalValidos;
    }

    if (totalVotos2T === 0) {
      const brancos = ensureNumber(getProp(props, 'Votos_Brancos 2T'));
      const nulos = ensureNumber(getProp(props, 'Votos_Nulos 2T'));
      if ((brancos + nulos) === 0) {
        has2T = false;
      }
    }
  }

  // 3. Hide UI if redundant (only one turn available)
  if (!(has1T && has2T)) {
    dom.turnTabs.style.display = 'none';
    // Still auto-switch turno if needed
    if (currentTurno === 2 && !has2T) currentTurno = 1;
    if (currentTurno === 1 && !has1T && has2T) currentTurno = 2;
    return;
  }
  
  dom.turnTabs.style.display = 'flex';
  
  if (currentTurno === 2 && !has2T) currentTurno = 1;
  if (currentTurno === 1 && !has1T && has2T) currentTurno = 2;
  if (has1T) {
    const tab = document.createElement('div');
    tab.className = 'tab' + (currentTurno === 1 ? ' active' : '');
    tab.textContent = '1º Turno';
    tab.dataset.turno = 1;
    tab.addEventListener('click', () => {
      if (currentTurno === 1) return;
      currentTurno = 1;
      refreshTurnDependentUI();
    });
    dom.turnTabs.appendChild(tab);
  }
  if (has2T) {
    const tab = document.createElement('div');
    tab.className = 'tab' + (currentTurno === 2 ? ' active' : '');
    tab.textContent = '2º Turno';
    tab.dataset.turno = 2;
    tab.addEventListener('click', () => {
      if (currentTurno === 2) return;
      currentTurno = 2;
      refreshTurnDependentUI();
    });
    dom.turnTabs.appendChild(tab);
  }
}

function getStatusBadge(status) {
  status = status.toUpperCase();
  if (status === '2º TURNO') return `<span class="status-badge segundo-turno"><svg><use href="#svg-arrow" /></svg> 2º Turno</span>`;
  if (status === 'NÃO ELEITO') return `<span class="status-badge nao-eleito"><svg><use href="#svg-x" /></svg> Não Eleito</span>`;
  if (status === 'INAPTO') return `<span class="status-badge inapto"><svg><use href="#svg-x" /></svg> Inapto</span>`;
  return '';
}

const CANDIDATE_COLOR_PRESETS = [
  '#1d4ed8', '#0f766e', '#16a34a', '#ca8a04', '#ea580c', '#dc2626',
  '#be123c', '#7c3aed', '#4338ca', '#334155', '#111827', '#a16207'
];

let activeCandidateColorTarget = null;
let candidateColorUIInitialized = false;

function closeCandidateColorPopoverOnViewChange() {
  const popover = document.getElementById('candidateColorPopover');
  if (popover) popover.classList.add('hidden');
  activeCandidateColorTarget = null;
}

function renderCandidateColorControl(nome, partido, color, customizable = true) {
  const safeNome = escapeAttribute(nome || '');
  const safePartido = escapeAttribute(partido || '');

  if (!customizable) {
    return `<div class="swatch" style="background:${color}"></div>`;
  }

  return `
    <button type="button" class="swatch-button"
         data-candidate-name="${safeNome}"
         data-candidate-party="${safePartido}"
         data-current-color="${color}"
         title="Personalizar cor do partido">
      <div class="swatch" style="background:${color}"></div>
    </button>
  `;
}

function ensureCandidateColorPopover() {
  let popover = document.getElementById('candidateColorPopover');
  if (popover) return popover;

  popover = document.createElement('div');
  popover.id = 'candidateColorPopover';
  popover.className = 'candidate-color-popover hidden';
  popover.innerHTML = `
    <div class="candidate-color-card">
      <div class="candidate-color-head">
        <div>
          <div class="candidate-color-kicker">Cor do Partido</div>
          <div class="candidate-color-name" id="candidateColorPopoverName">Candidato</div>
        </div>
        <button type="button" class="candidate-color-close" data-color-action="close" aria-label="Fechar">×</button>
      </div>
      <div class="candidate-color-preview-row">
        <span class="candidate-color-preview" id="candidateColorPreview"></span>
        <div class="candidate-color-meta">
          <span id="candidateColorPopoverParty">Partido</span>
          <strong id="candidateColorPopoverValue">#000000</strong>
        </div>
      </div>
      <div class="candidate-color-presets" id="candidateColorPresets"></div>
      <div class="candidate-color-advanced">
        <button type="button" class="candidate-color-picker-btn" data-color-action="open-native-picker">
          Escolher qualquer cor
        </button>
        <input id="candidateColorNativeInput" type="color" value="#2563EB" tabindex="-1" aria-hidden="true" />
      </div>
      <label class="candidate-color-field">
        <span>Cor do partido</span>
        <input id="candidateColorHexInput" type="text" maxlength="7" placeholder="#2563EB" />
      </label>
      <div class="candidate-color-actions">
        <button type="button" class="button ghost" data-color-action="reset" style="width: 100%;">Cor padrão</button>
      </div>
    </div>
  `;
  document.body.appendChild(popover);

  const presetsEl = popover.querySelector('#candidateColorPresets');
  presetsEl.innerHTML = CANDIDATE_COLOR_PRESETS.map(color => `
    <button type="button" class="candidate-color-chip" data-color="${color}" aria-label="Escolher cor ${color}">
      <span style="background:${color}"></span>
    </button>
  `).join('');

  const hexInput = popover.querySelector('#candidateColorHexInput');
  const nativeInput = popover.querySelector('#candidateColorNativeInput');
  hexInput.addEventListener('input', () => {
    const value = normalizeCandidateHexColor(hexInput.value);
    updateCandidateColorPopoverPreview(value || hexInput.value);
    if (value) {
      applyCandidateColorPopover(false);
    }
  });
  hexInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyCandidateColorPopover(true);
    } else if (e.key === 'Escape') {
      closeCandidateColorPopover();
    }
  });

  nativeInput.addEventListener('input', () => {
    setCandidateColorPopoverValue(nativeInput.value.toUpperCase());
    applyCandidateColorPopover(false);
  });
  nativeInput.addEventListener('change', () => {
    setCandidateColorPopoverValue(nativeInput.value.toUpperCase());
    applyCandidateColorPopover(true);
  });

  initializeCandidateColorUI();

  return popover;
}

function initializeCandidateColorUI() {
  if (candidateColorUIInitialized) return;
  candidateColorUIInitialized = true;

  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('.swatch-button');
    if (trigger) {
      openCandidateColorPopover(
        trigger,
        trigger.dataset.candidateName || '',
        trigger.dataset.candidateParty || '',
        trigger.dataset.currentColor || DEFAULT_SWATCH
      );
      return;
    }

    const popover = document.getElementById('candidateColorPopover');
    if (!popover || popover.classList.contains('hidden')) return;

    if (popover.contains(e.target)) {
      const preset = e.target.closest('.candidate-color-chip');
      if (preset?.dataset.color) {
        setCandidateColorPopoverValue(preset.dataset.color);
        applyCandidateColorPopover(true);
        return;
      }

      const actionEl = e.target.closest('[data-color-action]');
      if (!actionEl) return;

      const action = actionEl.dataset.colorAction;
      if (action === 'close') closeCandidateColorPopover();
      else if (action === 'apply') applyCandidateColorPopover();
      else if (action === 'reset') resetCandidateColorPopover();
      else if (action === 'open-native-picker') openCandidateColorNativePicker();
      return;
    }

    closeCandidateColorPopover();
  });
}

function normalizeCandidateHexColor(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  const withHash = raw.startsWith('#') ? raw : `#${raw}`;
  return /^#[0-9A-F]{6}$/.test(withHash) ? withHash : '';
}

function updateCandidateColorPopoverPreview(colorValue) {
  const popover = ensureCandidateColorPopover();
  const preview = popover.querySelector('#candidateColorPreview');
  const valueEl = popover.querySelector('#candidateColorPopoverValue');
  const normalized = normalizeCandidateHexColor(colorValue);
  preview.style.background = normalized || 'transparent';
  preview.style.borderColor = normalized || 'var(--border)';
  valueEl.textContent = normalized || 'Inválida';

  popover.querySelectorAll('.candidate-color-chip').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.color === normalized);
  });
}

function setCandidateColorPopoverValue(color) {
  const popover = ensureCandidateColorPopover();
  const hexInput = popover.querySelector('#candidateColorHexInput');
  const nativeInput = popover.querySelector('#candidateColorNativeInput');
  hexInput.value = color;
  if (normalizeCandidateHexColor(color)) nativeInput.value = color;
  updateCandidateColorPopoverPreview(color);
}

function openCandidateColorNativePicker() {
  const popover = ensureCandidateColorPopover();
  const nativeInput = popover.querySelector('#candidateColorNativeInput');
  if (!nativeInput) return;
  nativeInput.click();
}

function openCandidateColorPopover(triggerEl, nome, partido, currentColor) {
  const popover = ensureCandidateColorPopover();
  activeCandidateColorTarget = { nome, partido };

  const kickerEl = popover.querySelector('.candidate-color-kicker');
  if (kickerEl) {
    if (typeof currentCargo === 'string' && currentCargo.startsWith('senador')) {
      kickerEl.textContent = 'Cor do Candidato';
    } else {
      kickerEl.textContent = 'Cor do Partido';
    }
  }

  popover.querySelector('#candidateColorPopoverName').textContent = nome;
  popover.querySelector('#candidateColorPopoverParty').textContent = partido || 'Sem partido';
  setCandidateColorPopoverValue(currentColor);

  popover.classList.remove('hidden');

  const rect = triggerEl.getBoundingClientRect();
  const popRect = popover.getBoundingClientRect();
  const top = Math.min(window.innerHeight - popRect.height - 12, rect.bottom + 10);
  const left = Math.min(window.innerWidth - popRect.width - 12, Math.max(12, rect.left));
  popover.style.top = `${Math.max(12, top)}px`;
  popover.style.left = `${left}px`;
}

function closeCandidateColorPopover() {
  const popover = document.getElementById('candidateColorPopover');
  if (!popover) return;
  popover.classList.add('hidden');
  activeCandidateColorTarget = null;
}

function applyCandidateColorPopover(shouldClose = true) {
  const popover = ensureCandidateColorPopover();
  const hexInput = popover.querySelector('#candidateColorHexInput');
  const color = normalizeCandidateHexColor(hexInput.value);
  if (!color) {
    if (shouldClose) {
      showToast('Digite uma cor hexadecimal válida.', 'warn', 2200);
    }
    return;
  }

  if (typeof currentCargo === 'string' && currentCargo.startsWith('senador')) {
    if (!activeCandidateColorTarget?.nome) return;
    CUSTOM_CANDIDATE_COLORS.set(activeCandidateColorTarget.nome, color);
    updateSelectionUI(STATE.isFilterAggregationActive);
    if (window.refreshMapStylesAndTooltips) {
      window.refreshMapStylesAndTooltips();
    } else if (currentLayer && currentLayer.setStyle) {
      currentLayer.setStyle(getFeatureStyle);
    }
  } else {
    if (!activeCandidateColorTarget?.partido) return;
    setCandidateColor(activeCandidateColorTarget.partido, color);
  }
  if (shouldClose) {
    closeCandidateColorPopover();
  }
}

function resetCandidateColorPopover() {
  if (typeof currentCargo === 'string' && currentCargo.startsWith('senador')) {
    if (!activeCandidateColorTarget?.nome) return;
    CUSTOM_CANDIDATE_COLORS.delete(activeCandidateColorTarget.nome);
  } else {
    if (!activeCandidateColorTarget?.partido) return;
    CUSTOM_PARTY_COLORS.delete(getNormalizedPartyColorKey(activeCandidateColorTarget.partido));
  }
  updateSelectionUI(STATE.isFilterAggregationActive);
  if (window.refreshMapStylesAndTooltips) {
    window.refreshMapStylesAndTooltips();
  } else if (currentLayer && currentLayer.setStyle) {
    currentLayer.setStyle(getFeatureStyle);
  }
  closeCandidateColorPopover();
}

function renderResultsPanel(props, cargo) {
  initializeCandidateColorUI();
  closeCandidateColorPopoverOnViewChange();

  // Botão "Mostrar Regras" só vale para cargos proporcionais; será reexibido por
  // renderProportionalExpandableList quando aplicável.
  if (typeof updateToggleRulesButtonVisibility === 'function') updateToggleRulesButtonVisibility(false);

  // Limpa TODOS os toggles de navegacao ao trocar de cargo (clean slate)
  ['deputy-view-toggle', 'party-view-toggle', 'vereador-view-toggle', 'vereador-party-view-toggle'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });

  if (!props || Object.keys(props).length === 0) {
    dom.resultsContent.innerHTML = `<p style="color:var(--muted)">Sem dados para esta seleÃ§Ã£o.</p>`;
    dom.resultsMetrics.innerHTML = '';
    return;
  }

  if (cargo && cargo.startsWith('deputado')) {
    renderDeputyResults(cargo);
    return;
  }

  if (cargo && cargo.startsWith('vereador')) {
    renderVereadorResults(cargo);
    return;
  }

  const turnoKey = (currentTurno === 2 && STATE.dataHas2T[cargo]) ? '2T' : '1T';
  const candidatos = STATE.candidates[cargo]?.[turnoKey] || [];
  const officialGeneralSummary = getGeneralOfficialSummaryForScope(cargo, turnoKey);
  const officialMunicipalSummary = (cargo.startsWith('prefeito') && shouldUseMunicipalOfficialTotals())
    ? STATE.municipalOfficialTotals?.[cargo]?.[turnoKey]
    : null;
  const officialSummary = officialGeneralSummary || officialMunicipalSummary;

  const { totalValidos, votosInaptos } = officialSummary
    ? {
      totalValidos: Object.entries(officialSummary.votesByDisplayKey || {})
        .filter(([key]) => !(STATE.filterInaptos && (STATE.inaptos[cargo]?.[turnoKey] || []).includes(key)))
        .reduce((sum, [, votes]) => sum + ensureNumber(votes), 0),
      votosInaptos: 0
    }
    : getVotosValidos(props, cargo, turnoKey, STATE.filterInaptos);

  const isEstadoCompleto = !officialGeneralSummary && STATE.isFilterAggregationActive &&
    STATE.currentElectionType === 'geral' &&
    !hasRegionalScopeFilters() &&
    currentCidadeFilter === 'all';

  let totalBase = totalValidos;
  if (isEstadoCompleto) {
    let somaReal = 0;
    candidatos.forEach(key => {
      const cand = parseCandidateKey(key);
      if (STATE.filterInaptos && cand.status === 'INAPTO') return;
      somaReal += ensureNumber(getProp(props, key));
    });
    if (somaReal > 0) totalBase = somaReal;
  }

  let results = [];
  candidatos.forEach(key => {
    const cand = parseCandidateKey(key);
    if (STATE.filterInaptos && cand.status === 'INAPTO') return;

    const votos = officialSummary
      ? ensureNumber(officialSummary.votesByDisplayKey?.[key])
      : ensureNumber(getProp(props, key));
    const percentual = (totalBase > 0) ? (votos / totalBase) : 0;

    results.push({
      ...cand,
      votos,
      pct: percentual
    });
  });

  results.sort((a, b) => b.votos - a.votos);

  dom.resultsContent.innerHTML = '';

  let tableHtml = `
    <table class="cand-table">
      <thead>
        <tr>
          <th class="color-bar-td"></th>
          <th class="align-left">Candidato</th>
          <th class="align-center">Votos</th>
          <th class="align-center">Pct.</th>
        </tr>
      </thead>
      <tbody>
  `;

  results.forEach(r => {
    if (r.votos === 0 && results.length > 2) return;

    const cleanStatus = r.status ? r.status.toUpperCase() : '';
    const sw = getColorForCandidate(r.nome, r.partido);
    const isSpecial = cleanStatus === 'ELEITO' || cleanStatus === '2° TURNO' || cleanStatus === '2º TURNO';
    const isInapto = cleanStatus === 'INAPTO';

    const checkCircleHtml = isSpecial
      ? `<span class="cand-check-circle" style="background-color: ${sw};">✔</span>`
      : '';

    let badgeHtml = '';
    if (isInapto) {
      badgeHtml = `<span class="status-badge-sim inapto" style="margin-left: 6px; font-size: 0.6rem; padding: 1px 4px; border-radius: 2px;">Inapto</span>`;
    }

    const nameHtml = `
      <div class="cand-name-container">
        ${checkCircleHtml}
        <span class="cand-name-text">${toTitleCase(r.nome)}</span>
        ${badgeHtml}
      </div>
    `;

    const safeNome = escapeAttribute(r.nome || '');
    const safePartido = escapeAttribute(r.partido || '');

    tableHtml += `
      <tr class="${cleanStatus ? 'prop-cand-' + cleanStatus.toLowerCase().replace(/º/g, '').replace(/°/g, '').replace(/\s+/g, '-') : ''}" data-status="${r.status}">
        <td class="color-bar-td">
          <button type="button" class="swatch-button cand-color-bar"
               style="background-color: ${sw};"
               data-candidate-name="${safeNome}"
               data-candidate-party="${safePartido}"
               data-current-color="${sw}"
               title="Personalizar cor do candidato"></button>
        </td>
        <td class="align-left">
          ${nameHtml}
          <div style="font-size: 0.65rem; color: var(--muted); margin-top: 2px;">${escapeHtml(r.partido)}</div>
        </td>
        <td class="align-center cand-votes-text">
          ${fmtInt(r.votos)}
        </td>
        <td class="align-center">
          <div class="pct-bar-container">
            <span class="pct-text">${fmtPct(r.pct)}</span>
            <div class="cand-mini-bar-wrap">
              <div class="cand-mini-bar" style="width: ${r.pct * 100}%; background-color: ${sw};"></div>
            </div>
          </div>
        </td>
      </tr>
    `;
  });

  tableHtml += `
      </tbody>
    </table>
  `;

  dom.resultsContent.innerHTML = tableHtml;

  const brancos = officialSummary
    ? ensureNumber(officialSummary.brancos)
    : ensureNumber(getProp(props, `Votos_Brancos ${turnoKey}`));
  const nulos = officialSummary
    ? ensureNumber(officialSummary.nulos)
    : ensureNumber(getProp(props, `Votos_Nulos ${turnoKey}`));
  const comparecimento = officialSummary
    ? ensureNumber(officialSummary.comparecimento)
    : (totalBase + brancos + nulos);
  const turnoutStats = getTurnoutStatsForSelection(
    props,
    cargo,
    turnoKey,
    officialSummary ? officialSummary.comparecimento : null
  );
  const invalidos = brancos + nulos;
  const invalidosPct = comparecimento > 0 ? (invalidos / comparecimento) : 0;

  const avisoHtml = '';

  dom.resultsMetrics.innerHTML = `
    <div class="metrics-grid">
      ${avisoHtml}
      <div class="metric-item">
        <span>Votos válidos</span>
        <strong>${fmtInt(totalBase)}</strong>
      </div>
      <div class="metric-item">
        <span>Comparecimento</span>
        <strong>${fmtInt(comparecimento)}${turnoutStats.ratio !== null ? ` (${fmtPct(turnoutStats.ratio)})` : ''}</strong>
      </div>
      <div class="metric-item">
        <span>Votos inválidos</span>
        <strong>${fmtInt(invalidos)} (${fmtPct(invalidosPct)})</strong>
      </div>
      ${votosInaptos > 0 ? `<div class="metric-item"><span>Inaptos (na soma)</span><strong style="color:var(--err)">${fmtInt(votosInaptos)}</strong></div>` : ''}
    </div>
  `;
}


function loadOfficialTotals(year) {
  if (STATE.officialTotals && STATE.officialTotals[year]) return Promise.resolve(STATE.officialTotals[year]);
  if (OFFICIAL_TOTALS_PROMISE) return OFFICIAL_TOTALS_PROMISE;

  const path = `resultados_geo/Legislativas ${year}/official_totals_${year}.json`;
  OFFICIAL_TOTALS_PROMISE = fetch(path)
    .then(res => {
      if (!res.ok) throw new Error("Falha ao carregar totais");
      return res.json();
    })
    .then(json => {
      if (!STATE.officialTotals) STATE.officialTotals = {};
      STATE.officialTotals[year] = json;
      OFFICIAL_TOTALS_PROMISE = null;
      return json;
    })
    .catch(err => {
      console.error(err);
      OFFICIAL_TOTALS_PROMISE = null;
    });
  return OFFICIAL_TOTALS_PROMISE;
}

function renderDeputyResults(cargo) {
  initializeCandidateColorUI();
  closeCandidateColorPopoverOnViewChange();

  STATE.deputyViewMode = 'party';
  STATE.deputyPartyViewMode = 'federation';
  renderDeputyPartyResults(cargo);
  return;

  // 0. Toggle Logic
  if (!STATE.deputyViewMode) STATE.deputyViewMode = 'candidate';

  // FIX: Always remove old toggle to ensure event listeners are bound to correct 'cargo' closure
  const existingToggle = document.getElementById('deputy-view-toggle');
  if (existingToggle) existingToggle.remove();

  let toggleContainer = document.createElement('div');
  toggleContainer.id = 'deputy-view-toggle';
  toggleContainer.className = 'nav-tabs';
  toggleContainer.style.marginTop = '10px';
  toggleContainer.innerHTML = `
            <button class="nav-tab-btn ${STATE.deputyViewMode === 'candidate' ? 'active' : ''}" data-mode="candidate">Candidatos</button>
            <button class="nav-tab-btn ${STATE.deputyViewMode === 'party' ? 'active' : ''}" data-mode="party">Partidos</button>
        `;

  // Insert before resultsContent
  dom.resultsContent.parentNode.insertBefore(toggleContainer, dom.resultsContent);

  toggleContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-tab-btn');
    if (!btn) return;

    const mode = btn.dataset.mode;
    if (STATE.deputyViewMode === mode) return;

    STATE.deputyViewMode = mode;

    renderDeputyResults(cargo); // Correct 'cargo' from fresh closure
    applyFiltersAndRedraw();
  });

  // Branching
  if (STATE.deputyViewMode === 'party') {
    renderDeputyPartyResults(cargo);
    return;
  }

  // 1. Aggregate Votes from STATE.deputyResults using selectedLocationIDs
  const typeKey = (cargo === 'deputado_federal') ? 'f' : 'e';
  const agg = {};
  let totalVotes = 0;
  let brancos = 0;
  let nulos = 0;
  const visitedKeys = new Set();

  const geojson = currentDataCollection[cargo];

  const usarResultadosCompletos = shouldUseGeneralDeputyJsonTotals(cargo);

  if (usarResultadosCompletos) {
    for (const [key, locData] of Object.entries(STATE.deputyResults)) {
      const votes = locData[typeKey];
      if (!votes || visitedKeys.has(key)) continue;
      visitedKeys.add(key);
      for (const [cand, v] of Object.entries(votes)) {
        if (STATE.filterInaptos && (STATE.inaptos[cargo]?.['1T'] || []).includes(cand)) continue;
        const vi = parseInt(v) || 0;
        if (cand === '95') brancos += vi;
        else if (cand === '96') nulos += vi;
        else { agg[cand] = (agg[cand] || 0) + vi; totalVotes += vi; }
      }
    }
  } else if (geojson && geojson.features) {
    geojson.features.forEach(f => {
      const p = f.properties;
      const id = getFeatureSelectionId(p);
      if (!selectedLocationIDs.has(id)) return;
      const z = getProp(p, 'nr_zona');
      const l = getProp(p, 'nr_locvot') || getProp(p, 'nr_local_votacao');
      const m = getProp(p, 'cd_localidade_tse') || getProp(p, 'CD_MUNICIPIO');
      if (!z || !l || !m) return;
      const key = `${parseInt(z)}_${parseInt(m)}_${parseInt(l)}`;
      if (visitedKeys.has(key)) return;
      visitedKeys.add(key);
      const res = STATE.deputyResults[key];
      if (res && res[typeKey]) {
        for (const [cand, v] of Object.entries(res[typeKey])) {
          if (STATE.filterInaptos && (STATE.inaptos[cargo]?.['1T'] || []).includes(cand)) continue;
          const vi = parseInt(v);
          if (cand === '95') brancos += vi;
          else if (cand === '96') nulos += vi;
          else { agg[cand] = (agg[cand] || 0) + vi; }
          if (cand !== '95' && cand !== '96') totalVotes += vi;
        }
      }
    });
  }

  const comparecimento = totalVotes + brancos + nulos;
  const totalValidos = totalVotes;
  const isParcialDeputy = STATE.isFilterAggregationActive &&
    STATE.currentElectionType === 'geral' &&
    !hasRegionalScopeFilters() &&
    currentCidadeFilter === 'all' &&
    !usarResultadosCompletos;
  const turnoutStats = getTurnoutStatsForSelection(null, cargo, '1T');
  const participacaoHtml = turnoutStats.ratio !== null
    ? `<div class="metric-item"${isParcialDeputy ? ' style="opacity:0.55;"' : ''}>
          <span>ParticipaÃ§Ã£o${isParcialDeputy ? ' *' : ''}</span>
          <strong>${fmtPct(turnoutStats.ratio)}</strong>
        </div>`
    : '';

  // 2. Convert to Array and Sort
  const results = [];
  for (const [candId, votes] of Object.entries(agg)) {
    // STATE.deputyMetadata key is candidate ID
    const meta = STATE.deputyMetadata[candId] || [candId, '?', '?'];
    const isLegenda = (candId.length === 2);

    results.push({
      id: candId,
      nome: meta[0],
      partido: meta[1],
      status: meta[2],
      votos: votes,
      pct: (totalValidos > 0) ? (votes / totalValidos) : 0,
      isLegenda: isLegenda
    });
  }

  results.sort((a, b) => b.votos - a.votos);

  // 3. Render List 
  dom.resultsContent.innerHTML = '';
  // Carousel Container
  const wrapper = document.createElement('div');
  wrapper.className = 'carousel-wrapper';

  const carousel = document.createElement('div');
  carousel.className = 'results-carousel';

  const nominais = results.filter(r => !r.isLegenda);
  const PAGE_SIZE = 10;
  const totalPages = Math.ceil(nominais.length / PAGE_SIZE);

  // Render Pages
  for (let i = 0; i < totalPages; i++) {
    const pageDiv = document.createElement('div');
    pageDiv.className = 'results-page'; // Grid layout inside

    const batch = nominais.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE);

    batch.forEach(r => {
      const div = document.createElement('div');
      div.className = 'cand';

      let statusHtml = '';
      let simpleStatus = '';
      const st = (r.status || '').toUpperCase();

      if (st.includes('INAPTO')) {
        statusHtml = `<span class="status-badge inapto"><svg><use href="#svg-x" /></svg> INAPTO</span>`;
        simpleStatus = 'INAPTO';
      } else if (st.includes('NÃƒO ELEITO') || st.includes('NAO ELEITO') || st.includes('NÃƒO ELEITO')) {
        statusHtml = `<span class="status-badge nao-eleito"><svg><use href="#svg-x" /></svg> NÃ£o Eleito</span>`;
        simpleStatus = 'NÃƒO ELEITO';
      } else if (st.includes('ELEITO') || st.includes('QP') || st.includes('MÃ‰DIA')) {
        statusHtml = `<span class="status-badge eleito"><svg><use href="#svg-check" /></svg> ${r.status}</span>`;
        simpleStatus = 'ELEITO';
      } else if (st.includes('SUPLENTE')) {
        statusHtml = `<span class="status-badge suplente">Suplente</span>`;
        simpleStatus = 'SUPLENTE';
      }

      const sw = getColorForCandidate(r.nome, r.partido);
      const safeNome = escapeHtml(toTitleCase(r.nome));
      const safePartyAndId = escapeHtml(`${r.partido} â€¢ ${r.id}`);

      div.setAttribute('data-status', simpleStatus);
      if (st.includes('INAPTO')) {
        div.classList.add('inapto-card'); // Adds the dashed red border
      }
      div.innerHTML = `
	                <div class="cand-header">
	                  ${renderCandidateColorControl(r.nome, r.partido, sw, true)}
	                  <div class="cand-info">
	                    <h4 title="${safeNome}">${safeNome}</h4>
	                    <small title="${safePartyAndId}">${safePartyAndId}</small>
	                  </div>
	                </div>
                <div class="cand-stats">
                  <div>
                    <span class="bigPct">${fmtPct(r.pct)}</span>
                    <span class="smallVotos">${fmtInt(r.votos)}</span>
                  </div>
                  ${statusHtml}
                </div>
              `;
      pageDiv.appendChild(div);
    });

    carousel.appendChild(pageDiv);
  }

  // Navigation Arrows
  const prevBtn = document.createElement('div');
  prevBtn.className = 'carousel-arrow prev disabled';
  prevBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>`;

  const nextBtn = document.createElement('div');
  nextBtn.className = 'carousel-arrow next';
  if (totalPages <= 1) nextBtn.classList.add('disabled');
  nextBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;

  // Paginator Text
  const paginator = document.createElement('div');
  paginator.className = 'carousel-paginator';
  paginator.textContent = `PÃ¡gina 1 de ${totalPages} (${nominais.length} candidatos)`;

  // Event Listeners
  const updateNav = () => {
    const scrollLeft = carousel.scrollLeft;
    const width = carousel.offsetWidth;
    const pageIndex = Math.round(scrollLeft / width); // 0-based

    // Update Arrows
    if (pageIndex <= 0) prevBtn.classList.add('disabled');
    else prevBtn.classList.remove('disabled');

    if (pageIndex >= totalPages - 1) nextBtn.classList.add('disabled');
    else nextBtn.classList.remove('disabled');

    // Update Text
    paginator.textContent = `PÃ¡gina ${pageIndex + 1} de ${totalPages} (${nominais.length} candidatos)`;
  };

  carousel.addEventListener('scroll', debounce(updateNav, 50));

  prevBtn.onclick = () => {
    carousel.scrollBy({ left: -carousel.offsetWidth, behavior: 'smooth' });
  };

  nextBtn.onclick = () => {
    carousel.scrollBy({ left: carousel.offsetWidth, behavior: 'smooth' });
  };

  // Drag to Scroll Logic
  let isDown = false;
  let startX;
  let scrollLeftStart;

  carousel.addEventListener('mousedown', (e) => {
    isDown = true;
    carousel.classList.add('grabbing');
    startX = e.pageX - carousel.offsetLeft;
    scrollLeftStart = carousel.scrollLeft;
  });

  carousel.addEventListener('mouseleave', () => {
    isDown = false;
    carousel.classList.remove('grabbing');
  });

  carousel.addEventListener('mouseup', () => {
    isDown = false;
    carousel.classList.remove('grabbing');
    // Snap to nearest page on release is handled by CSS scroll-snap, 
    // but if we dragged, CSS snap kicks in automatically properly?
    // Usually yes.
  });

  carousel.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - carousel.offsetLeft;
    const walk = (x - startX) * 2; // Scroll-fast
    carousel.scrollLeft = scrollLeftStart - walk;
  });


  wrapper.appendChild(carousel);
  wrapper.appendChild(prevBtn);
  wrapper.appendChild(nextBtn);

  dom.resultsContent.appendChild(wrapper);
  dom.resultsContent.appendChild(paginator);

  // 4. Render Metrics
  const avisoDeputyHtml = isParcialDeputy ? `
    <div class="metric-item" style="grid-column:1/-1; border-left:3px solid #f59e0b; background:rgba(245,158,11,0.07); padding:6px 10px; border-radius:4px; margin-bottom:2px;">
      <span style="font-size:0.72rem; color:#f59e0b; line-height:1.4;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; margin-right: 4px; display: inline-block;"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> <strong>Aten&ccedil;&atilde;o:</strong> Totais parciais &mdash; nem todos os locais est&atilde;o mapeados.
      </span>
    </div>` : '';

  const invalidos = brancos + nulos;
  const invalidosPct = comparecimento > 0 ? (invalidos / comparecimento) : 0;

  dom.resultsMetrics.innerHTML = `
      <div class="metrics-grid">
        ${avisoDeputyHtml}
        <div class="metric-item">
          <span>Votos válidos</span>
          <strong>${fmtInt(totalValidos)}</strong>
        </div>
        <div class="metric-item">
          <span>Comparecimento</span>
          <strong>${fmtInt(comparecimento)}${turnoutStats.ratio !== null ? ` (${fmtPct(turnoutStats.ratio)})` : ''}</strong>
        </div>
        <div class="metric-item">
          <span>Votos inválidos</span>
          <strong>${fmtInt(invalidos)} (${fmtPct(invalidosPct)})</strong>
        </div>
      </div>
    `;
}

function setCandidateColor(nome, novaCor) {
  const partyKey = getNormalizedPartyColorKey(nome);
  if (!partyKey) return;
  CUSTOM_PARTY_COLORS.set(partyKey, novaCor);
  updateSelectionUI(STATE.isFilterAggregationActive);
  
  if (window.refreshMapStylesAndTooltips) {
    window.refreshMapStylesAndTooltips();
  } else if (currentLayer && currentLayer.setStyle) {
    currentLayer.setStyle(getFeatureStyle);
  }
}

// ====== VISUAL AVAILABILITY BAR LOGIC ======

function updateAvailabilityBars(geojson) {
  if (!geojson || !geojson.features) return;

  const mRaca = STATE.censusFilters.racaMode;
  const mGenero = STATE.censusFilters.generoMode;
  const mIdade = STATE.censusFilters.idadeMode;
  const mSaneamento = STATE.censusFilters.saneamentoMode;
  const mEscolaridade = STATE.censusFilters.escolaridadeMode;
  const mEstadoCivil = STATE.censusFilters.estadoCivilMode;

  let minRenda = Infinity, maxRenda = -Infinity;
  let minRaca = Infinity, maxRaca = -Infinity;
  let minGenero = Infinity, maxGenero = -Infinity;
  let minIdade = Infinity, maxIdade = -Infinity;
  let minSaneamento = Infinity, maxSaneamento = -Infinity;
  let minEscolaridade = Infinity, maxEscolaridade = -Infinity;
  let minEstadoCivil = Infinity, maxEstadoCivil = -Infinity;

  let hasData = false;
  const features = geojson.features;
  const total = features.length;

  // --- HELPER DE CÃLCULO ---
  const calcPct = (props, type, mode) => {
    // ValidaÃ§Ã£o de chave rigorosa
    const isValidKey = (k, v) => {
      if (typeof v !== 'number') return false;
      const up = k.toUpperCase();
      // Ignora chaves de porcentagem ou totais explÃ­citos para evitar contagem dupla
      if (up.startsWith('PCT') || up.includes('_PCT') || up.includes('PERCENT') || up.includes('(%)')) return false;
      if (up.startsWith('TOTAL') || up.startsWith('SOMA') || up === 'ELEITORES_APTOS') return false;
      return true;
    };

    // 1. Tentar pegar valor direto se for Pct (Legacy/RaÃ§a/Saneamento)
    if (type === 'raca' || type === 'saneamento') {
      if (props[mode] !== undefined) return ensureNumber(props[mode]);
      if (props[mode.toUpperCase()] !== undefined) return ensureNumber(props[mode.toUpperCase()]);
      return null;
    }

    let num = 0, den = 0;

    // --- IDADE (CORRIGIDO) ---
    if (type === 'idade') {
      const ageAggregate = aggregateAgeBucketsFromProps(props, window.AGE_BUCKETS_STANDARD);

      for (const key in {}) {
        if (!isValidKey(key, props[key])) continue;

        const val = ensureNumber(props[key]);
        if (val <= 0) continue;

        // Regex Aprimorado: Pega "16 anos", "21 a 24 anos", "100 anos ou mais"
        const matchRange = key.match(/(\d+)[\s_]*(?:a|A|ate|to|-|_)+[\s_]*(\d+)/);
        const matchSingle = key.match(/(\d+)[\s_]*anos/i);
        const matchPlus = key.match(/(\d+)[\s_]*(?:anos)?[\s_]*(?:ou)?[\s_]*mais/i);

        let startAge = -1;

        if (matchRange) startAge = parseInt(matchRange[1]);
        else if (matchSingle) startAge = parseInt(matchSingle[1]);
        else if (matchPlus) startAge = parseInt(matchPlus[1]);

        // Se detectou uma idade vÃ¡lida (filtro amplo para pegar tudo e somar no total)
        if (startAge >= 10 && startAge < 150) {
          totalAge += val;
          foundAny = true;

          // DistribuiÃ§Ã£o nos buckets
          if (startAge >= 16 && startAge <= 24) buckets['16-24'] += val;
          else if (startAge >= 25 && startAge <= 34) buckets['25-34'] += val;
          else if (startAge >= 35 && startAge <= 44) buckets['35-44'] += val;
          else if (startAge >= 45 && startAge <= 59) buckets['45-59'] += val;
          else if (startAge >= 60 && startAge <= 74) buckets['60-74'] += val;
          else if (startAge >= 75) buckets['75-100'] += val;
        }
      }

      // --- FILTRO DE RUÃDO ESTATÃSTICO ---
      // Se a soma das pessoas for muito baixa (ex: < 15), a porcentagem Ã© irrelevante/ruÃ­do.
      // Isso evita que um local com 1 pessoa de 18 anos gere "100%" e estrague a barra.
      if (!ageAggregate.hasData || ageAggregate.total < 15) return null;

      num = ageAggregate.buckets[mode] || 0;
      den = ageAggregate.total;

      // Auto-correÃ§Ã£o matemÃ¡tica (garante que bucket nunca Ã© maior que total)
      if (num > den) den = num;
    }
    // --- GÃŠNERO ---
    else if (type === 'genero') {
      const h = ensureNumber(props['Homens'] || props['HOMENS'] || props['MASCULINO'] || props['Masculino'] || 0);
      const m = ensureNumber(props['Mulheres'] || props['MULHERES'] || props['FEMININO'] || props['Feminino'] || 0);

      den = h + m;
      if (den < 10) return null; // Filtro de ruÃ­do
      num = (mode.includes('Mulher') || mode.includes('Feminino')) ? m : h;
    }
    // --- ESTADO CIVIL ---
    else if (type === 'estadocivil') {
      let acc = { sol: 0, cas: 0, div: 0, viu: 0, sep: 0 };
      for (const k in props) {
        if (!isValidKey(k, props[k])) continue;
        const v = ensureNumber(props[k]);
        const uk = k.toUpperCase();

        if (uk.includes('SOLTEIRO')) acc.sol += v;
        else if (uk.includes('CASADO')) acc.cas += v;
        else if (uk.includes('DIVORCIADO')) acc.div += v;
        else if (uk.includes('VIUVO') || uk.includes('VIÃšVO')) acc.viu += v;
        else if (uk.includes('SEPARADO')) acc.sep += v;
      }
      den = acc.sol + acc.cas + acc.div + acc.viu + acc.sep;
      if (den < 10) return null; // Filtro de ruÃ­do

      if (mode === 'Solteiro') num = acc.sol;
      else if (mode === 'Casado') num = acc.cas;
      else if (mode === 'Divorciado') num = acc.div;
      else if (mode === 'ViÃºvo') num = acc.viu;
      else num = acc.sep;
    }
    // --- ESCOLARIDADE ---
    else if (type === 'escolaridade') {
      let acc = { ana: 0, le: 0, fi: 0, fc: 0, mi: 0, mc: 0, si: 0, sc: 0 };
      for (const k in props) {
        if (!isValidKey(k, props[k])) continue;
        const v = ensureNumber(props[k]);
        const uk = k.toUpperCase();

        if (uk.includes('ANALFABETO')) acc.ana += v;
        else if (uk.includes('LÃŠ E ESCREVE') || uk.includes('LE E ESCREVE')) acc.le += v;
        else if (uk.includes('FUND') && uk.includes('INCOMP')) acc.fi += v;
        else if (uk.includes('FUND') && uk.includes('COMP')) acc.fc += v;
        else if (uk.includes('MÃ‰DIO') || uk.includes('MEDIO')) {
          if (uk.includes('INCOMP')) acc.mi += v;
          else if (uk.includes('COMP')) acc.mc += v;
        }
        else if (uk.includes('SUPERIOR')) {
          if (uk.includes('INCOMP')) acc.si += v;
          else if (uk.includes('COMP')) acc.sc += v;
        }
      }

      den = Object.values(acc).reduce((a, b) => a + b, 0);
      if (den < 10) return null; // Filtro de ruÃ­do

      num = getEscolaridadeGroupedValue(mode, acc);
    }

    if (den === 0) return 0;

    // Trava matemÃ¡tica final
    if (num > den) den = num;

    return (num / den) * 100;
  };

  // --- LOOP PRINCIPAL ---
  for (let i = 0; i < total; i++) {
    const f = features[i];
    const p = f.properties;

    if (STATE.currentElectionType === 'geral' && currentCidadeFilter !== 'all') {
      const cityName = String(getProp(p, 'nm_localidade') || '').trim();
      const selectedCity = String(currentCidadeFilter || '').trim();
      const sameCity = cityName === selectedCity
        || normalizeMunicipioSlug(cityName) === normalizeMunicipioSlug(selectedCity)
        || (typeof matchesMunicipioName === 'function' && matchesMunicipioName(selectedCity, cityName));
      if (!sameCity) continue;
    }
    if (currentBairroFilter !== 'all') {
      const b = getProp(p, 'ds_bairro');
      if (!b || b.trim() !== currentBairroFilter) continue;
    }

    hasData = true;

    // Renda
    const r = ensureNumber(getProp(p, 'Renda Media'));
    if (r > 0) {
      if (r < minRenda) minRenda = r;
      if (r > maxRenda) maxRenda = r;
    }

    const updatemm = (val, min, max) => {
      // Ignora null (que agora retorna quando a amostra Ã© pequena demais)
      if (val !== null && !isNaN(val)) {
        if (val < min) min = val;
        if (val > max) max = val;
      }
      return [min, max];
    };

    [minRaca, maxRaca] = updatemm(calcPct(p, 'raca', mRaca), minRaca, maxRaca);
    [minGenero, maxGenero] = updatemm(calcPct(p, 'genero', mGenero), minGenero, maxGenero);
    [minSaneamento, maxSaneamento] = updatemm(calcPct(p, 'saneamento', mSaneamento), minSaneamento, maxSaneamento);
    [minIdade, maxIdade] = updatemm(calcPct(p, 'idade', mIdade), minIdade, maxIdade);
    [minEscolaridade, maxEscolaridade] = updatemm(calcPct(p, 'escolaridade', mEscolaridade), minEscolaridade, maxEscolaridade);
    [minEstadoCivil, maxEstadoCivil] = updatemm(calcPct(p, 'estadocivil', mEstadoCivil), minEstadoCivil, maxEstadoCivil);
  }

  if (!hasData) {
    ['availRenda', 'availRaca', 'availIdade', 'availGenero', 'availEscolaridade', 'availEstadoCivil', 'availSaneamento'].forEach(id => setBar(id, 0, 0, 100));
    return;
  }

  // Trava visual (Cap)
  const check = (min, max, cap) => {
    if (min === Infinity || max === -Infinity) return { min: 0, max: 0 };
    if (max > cap) max = cap;
    return (min > max) ? { min: 0, max: 0 } : { min, max };
  };

  const bRenda = check(minRenda, maxRenda, 10000);
  setBar('availRenda', bRenda.min, bRenda.max, 10000);

  const setDemos = (id, min, max) => {
    const b = check(min, max, 100);
    setBar(id, b.min, b.max, 100);
  };

  setDemos('availRaca', minRaca, maxRaca);
  setDemos('availIdade', minIdade, maxIdade);
  setDemos('availGenero', minGenero, maxGenero);
  setDemos('availEscolaridade', minEscolaridade, maxEscolaridade);
  setDemos('availEstadoCivil', minEstadoCivil, maxEstadoCivil);
  setDemos('availSaneamento', minSaneamento, maxSaneamento);
}

function calculateAgeSumForProps(props, mode) {
  const ageAggregate = aggregateAgeBucketsFromProps(props, window.AGE_BUCKETS_STANDARD);
  return ageAggregate.buckets[mode] || 0;
}

function setBar(id, min, max, scale) {
  const el = document.getElementById(id);
  if (!el) return;

  min = Math.max(0, min);
  max = Math.min(scale, max);

  const left = (min / scale) * 100;
  const width = ((max - min) / scale) * 100;

  el.style.left = `${left.toFixed(2)}%`;
  el.style.width = `${width.toFixed(2)}%`;
}

function getCandidateStatusInfo(status) {
  const normalized = String(status || '').toUpperCase().trim();

  // 1. Inaptos primeiro
  if (normalized.includes('INAPTO')) {
    return { label: 'Inapto', badgeClass: 'inapto', rowClass: 'prop-cand-inapto', elected: false };
  }

  // 2. NEGATIVOS: "NÃO ELEITO" e "SUPLENTE" devem ser verificados ANTES de "ELEITO" 
  // para evitar que o substring "ELEITO" em "NÃO ELEITO" cause falsos positivos.
  if (normalized.includes('NAO ELEITO') || normalized.includes('NÃO ELEITO')) {
    return { label: 'Não eleito', badgeClass: 'nao-eleito', rowClass: 'prop-cand-not-elected', elected: false };
  }
  if (normalized.includes('SUPLENTE')) {
    return { label: 'Suplente', badgeClass: 'suplente', rowClass: 'prop-cand-not-elected', elected: false };
  }

  // 3. POSITIVOS
  if (normalized.includes('QP')) {
    return { label: 'Eleito por QP', badgeClass: 'eleito', rowClass: 'prop-cand-elected', elected: true };
  }
  if (normalized.includes('MEDIA') || normalized.includes('MÉDIA')) {
    return { label: 'Eleito por média', badgeClass: 'eleito', rowClass: 'prop-cand-elected', elected: true };
  }
  if (normalized.includes('ELEITO')) {
    return { label: 'Eleito', badgeClass: 'eleito', rowClass: 'prop-cand-elected', elected: true };
  }

  // Fallback padrão
  return { label: 'Não eleito', badgeClass: 'nao-eleito', rowClass: 'prop-cand-not-elected', elected: false };
}

function ensureDeputyLookupForCargo(cargo) {
  if (STATE.deputyLookup && STATE.deputyLookupCargo === cargo) return;
  STATE.deputyLookup = new Map();
  STATE.deputyLookupCargo = cargo;
  const geojson = currentDataCollection[cargo];
  geojson?.features?.forEach((feature) => {
    const props = feature.properties;
    const id = getFeatureSelectionId(props);
    const z = getProp(props, 'nr_zona');
    const l = getProp(props, 'nr_locvot') || getProp(props, 'nr_local_votacao');
    const m = getProp(props, 'cd_localidade_tse') || getProp(props, 'CD_MUNICIPIO');
    if (id && z && l && m) {
      STATE.deputyLookup.set(id, `${parseInt(z, 10)}_${parseInt(m, 10)}_${parseInt(l, 10)}`);
    }
  });
}

function ensureVereadorLookupForCargo(cargo) {
  if (STATE.vereadorLookup && STATE.vereadorLookupCargo === cargo) return;
  STATE.vereadorLookup = new Map();
  STATE.vereadorLookupCargo = cargo;
  const geojson = currentDataCollection[cargo];
  geojson?.features?.forEach((feature) => {
    const props = feature.properties;
    const id = getFeatureSelectionId(props);
    const z = getProp(props, 'nr_zona');
    const l = getProp(props, 'nr_locvot') || getProp(props, 'nr_local_votacao');
    if (id && z && l) {
      STATE.vereadorLookup.set(id, `${parseInt(z, 10)}_${parseInt(l, 10)}`);
    }
  });
}

function aggregateProportionalGroupsForSelection(cargo) {
  const isVereador = cargo.startsWith('vereador');
  if (!isVereador && typeof syncDeputyDataForCargo === 'function') {
    syncDeputyDataForCargo(cargo);
  }

  if (typeof ensurePartyPrefixCache === 'function') {
    ensurePartyPrefixCache(isVereador);
  }

  const typeKey = isVereador ? 'v' : (cargo === 'deputado_federal' ? 'f' : 'e');
  const resultStore = isVereador ? (STATE.vereadorResults || {}) : (STATE.deputyResults || {});
  const metaStore = isVereador ? (STATE.vereadorMetadata || {}) : (STATE.deputyMetadata || {});
  const prefixCache = isVereador ? (STATE._vereadorPartyPrefixCache || {}) : (STATE._partyPrefixCache || {});

  const inaptos = isVereador ? (STATE.inaptos['vereador_ord']?.['1T'] || []) : (STATE.inaptos[cargo]?.['1T'] || []);
  const inaptosSet = STATE.filterInaptos ? new Set(inaptos) : null;
  const groups = new Map();
  let totalVotes = 0;
  let brancos = 0;
  let nulos = 0;

  const addVotesMap = (votesMap) => {
    Object.entries(votesMap || {}).forEach(([candidateId, rawVotes]) => {
      const votes = ensureNumber(rawVotes);
      if (candidateId === '95') {
        brancos += votes;
        return;
      }
      if (candidateId === '96') {
        nulos += votes;
        return;
      }
      if (inaptosSet && inaptosSet.has(candidateId)) return;

      totalVotes += votes;
      const groupInfo = resolveProportionalGroupInfo(candidateId, metaStore, prefixCache);
      const group = groups.get(groupInfo.key) || {
        ...groupInfo,
        votes: 0,
        dominantParties: new Map(),
        candidates: new Map()
      };

      group.votes += votes;
      group.dominantParties.set(groupInfo.party, (group.dominantParties.get(groupInfo.party) || 0) + votes);

      if (String(candidateId).length > 2) {
        const metadata = metaStore[candidateId] || [];
        const candidate = group.candidates.get(candidateId) || {
          id: candidateId,
          nome: metadata[0] || candidateId,
          partido: groupInfo.party,
          status: metadata[2] || '',
          votos: 0
        };
        candidate.votos += votes;
        group.candidates.set(candidateId, candidate);
      }

      groups.set(groupInfo.key, group);
    });
  };

  const precomputedStateScope = (!isVereador && typeof getPrecomputedProportionalStateScope === 'function')
    ? getPrecomputedProportionalStateScope(cargo)
    : null;
  if (precomputedStateScope?.votesById) {
    addVotesMap(precomputedStateScope.votesById);
    return {
      groups: Array.from(groups.values()),
      totalVotes,
      brancos: ensureNumber(precomputedStateScope.brancos),
      nulos: ensureNumber(precomputedStateScope.nulos),
      comparecimento: ensureNumber(precomputedStateScope.comparecimento) || (totalVotes + brancos + nulos)
    };
  }

  if (isVereador && shouldUseMunicipalOfficialTotals()) {
    const officialSummary = STATE.municipalOfficialTotals?.[cargo]?.['1T'];
    if (officialSummary?.votesById) {
      addVotesMap(officialSummary.votesById);
      return {
        groups: Array.from(groups.values()),
        totalVotes,
        brancos: ensureNumber(officialSummary.brancos),
        nulos: ensureNumber(officialSummary.nulos),
        comparecimento: ensureNumber(officialSummary.comparecimento) || (totalVotes + brancos + nulos)
      };
    }
  }

  if (!isVereador && shouldUseGeneralDeputyJsonTotals(cargo)) {
    Object.values(resultStore).forEach((entry) => {
      if (entry?.[typeKey]) addVotesMap(entry[typeKey]);
    });
  } else {
    const processedKeys = new Set();
    if (isVereador) {
      ensureVereadorLookupForCargo(cargo);
      Array.from(selectedLocationIDs).forEach((id) => {
        const key = STATE.vereadorLookup?.get(id);
        if (!key || processedKeys.has(key)) return;
        processedKeys.add(key);
        if (resultStore[key]?.[typeKey]) addVotesMap(resultStore[key][typeKey]);
      });
    } else {
      ensureDeputyLookupForCargo(cargo);
      Array.from(selectedLocationIDs).forEach((id) => {
        const key = STATE.deputyLookup?.get(id);
        if (!key || processedKeys.has(key)) return;
        processedKeys.add(key);
        if (resultStore[key]?.[typeKey]) addVotesMap(resultStore[key][typeKey]);
      });
    }
  }

  return {
    groups: Array.from(groups.values()),
    totalVotes,
    brancos,
    nulos,
    comparecimento: totalVotes + brancos + nulos
  };
}

function renderProportionalExpandableList(groupsPayload, metrics = {}) {
  ensureCustomCandTooltip();
  // Controla a exibição das regras (status QP abaixo do partido + tooltips de regra dos
  // candidatos). Escondidas por padrão; alternadas pelo botão "Mostrar Regras".
  const showRules = STATE.showProportionalRules === true;
  if (typeof updateToggleRulesButtonVisibility === 'function') updateToggleRulesButtonVisibility(true);
  const groups = (groupsPayload.groups || []).map((group) => {
    let dominantParty = group.party;
    let dominantVotes = -1;
    group.dominantParties?.forEach((votes, party) => {
      if (votes > dominantVotes) {
        dominantVotes = votes;
        dominantParty = party;
      }
    });

    const candidates = Array.from(group.candidates?.values?.() || [])
      .sort((a, b) => b.votos - a.votos)
      .map((candidate) => ({
        ...candidate,
        statusInfo: getCandidateStatusInfo(candidate.status)
      }));

    const electedCount = candidates.filter((candidate) => candidate.statusInfo.elected).length;
    const isVereadorList = typeof currentCargo === 'string' && currentCargo.startsWith('vereador');
    const proportionalType = isVereadorList ? 'vereador' : 'deputado';
    const colorKeyLookup = typeof getScopedProportionalColorKeyLookup === 'function'
      ? getScopedProportionalColorKeyLookup(proportionalType, typeof currentCargo === 'string' ? currentCargo : undefined)
      : null;
    const colorPartyKey = colorKeyLookup?.get(group.key)
      || getProportionalListColorKey(group.name, group.composition, dominantParty);
    return {
      ...group,
      color: colorForParty(colorPartyKey),
      dominantParty,
      colorPartyKey,
      candidates,
      electedCount
    };
  }).sort((a, b) => b.votes - a.votes);

  const totalValidos = groupsPayload.totalVotes || 0;
  const totalElected = groups.reduce((sum, g) => sum + (g.electedCount || 0), 0);
  
  // Otimização: calcula QE e outras métricas proporcionais de antemão
  const isEstadual = typeof currentCargo === 'string' && currentCargo.includes('estadual');
  const isVereador = typeof currentCargo === 'string' && currentCargo.startsWith('vereador');
  const proportionalTypeKey = isVereador ? 'v' : (isEstadual ? 'e' : 'f');
  
  const uf_prop = loadedVereadorState.uf || (dom.selectUFGeneral ? dom.selectUFGeneral.value : '');
  const year_prop = STATE.currentElectionYear;
  
  let statsOfficial_prop = null;
  if (isVereador) {
    const totalsKey = `vereadores_${year_prop}`;
    const rawTotals = STATE.officialTotals?.[totalsKey];
    // Usa a mesma resolução de UF/município de renderVereadorPartyResults para que
    // o QE/vagas oficiais sejam encontrados (lookup por currentCidadeFilter falhava).
    const uf_ver = loadedVereadorState.uf || dom.selectUFMunicipal?.value || uf_prop;
    const muniSanitized = loadedVereadorState.muniSanitized || normalizeMunicipioSlug(dom.selectMunicipio?.value || currentCidadeFilter || '');
    statsOfficial_prop = rawTotals?.[uf_ver]?.[muniSanitized]?.stats || rawTotals?.[uf_ver]?.stats || null;
  } else {
    const officialData = STATE.officialTotals?.[year_prop]?.[uf_prop]?.[proportionalTypeKey] || null;
    statsOfficial_prop = officialData?.stats || null;
  }

  // Total de votos válidos no escopo COMPLETO (estado p/ deputado, município p/ vereador).
  // Mantém o QE estimado constante, independentemente da seleção atual no mapa.
  const fullScopeVotesById = isVereador
    ? (STATE.municipalOfficialTotals?.[currentCargo]?.['1T']?.votesById || null)
    : (STATE.precomputedProportionalStateTotals?.[currentCargo]?.state?.votesById || null);
  let fullScopeTotalValidos = 0;
  if (fullScopeVotesById) {
    Object.entries(fullScopeVotesById).forEach(([cid, v]) => {
      if (cid === '95' || cid === '96') return;
      fullScopeTotalValidos += ensureNumber(v);
    });
  }

  const QE_prop = statsOfficial_prop?.vr_qe || 0;
  let estimatedQE_prop = QE_prop;
  if (!estimatedQE_prop) {
    let vagas = statsOfficial_prop?.qt_vagas;
    if (!vagas && typeof currentCargo === 'string') {
      const ufNorm = String(uf_prop || '').toUpperCase().trim();
      const seatsMap = {
        'AC': 8, 'AL': 9, 'AM': 8, 'AP': 8, 'BA': 39, 'CE': 22, 'DF': 8,
        'ES': 10, 'GO': 17, 'MA': 18, 'MG': 53, 'MS': 8, 'MT': 8, 'PA': 17,
        'PB': 12, 'PE': 25, 'PI': 10, 'PR': 30, 'RJ': 46, 'RN': 8, 'RO': 8,
        'RR': 8, 'RS': 31, 'SC': 16, 'SE': 8, 'SP': 70, 'TO': 8
      };
      const fedSeats = seatsMap[ufNorm] || 8;
      if (currentCargo === 'deputado_federal') {
        vagas = fedSeats;
      } else if (currentCargo === 'deputado_estadual' || currentCargo === 'deputado_distrital') {
        vagas = fedSeats <= 12 ? fedSeats * 3 : 36 + (fedSeats - 12);
      }
    }
    // Usa o total do escopo completo (constante) e só recorre à seleção como último recurso.
    const estimateBase = fullScopeTotalValidos > 0 ? fullScopeTotalValidos : totalValidos;
    if (vagas > 0 && estimateBase > 0) {
      estimatedQE_prop = Math.round(estimateBase / vagas);
    }
  }
  
  const qeValue = estimatedQE_prop || 0;
  const qe10 = qeValue ? Math.round(qeValue * 0.1) : 0;
  const qe20 = qeValue ? Math.round(qeValue * 0.2) : 0;
  const qe80 = qeValue ? Math.round(qeValue * 0.8) : 0;

  dom.resultsContent.innerHTML = '';

  if (!groups.length) {
    dom.resultsContent.innerHTML = '<p style="color:var(--muted)">Sem votos válidos para esta seleção.</p>';
    return;
  }

  // --- TOP METRICS BAR & GUIDE TIP BOX ---
  let vagasDisplay = statsOfficial_prop?.qt_vagas;
  if (!vagasDisplay && typeof currentCargo === 'string') {
    const ufNorm = String(uf_prop || '').toUpperCase().trim();
    const seatsMap = {
      'AC': 8, 'AL': 9, 'AM': 8, 'AP': 8, 'BA': 39, 'CE': 22, 'DF': 8,
      'ES': 10, 'GO': 17, 'MA': 18, 'MG': 53, 'MS': 8, 'MT': 8, 'PA': 17,
      'PB': 12, 'PE': 25, 'PI': 10, 'PR': 30, 'RJ': 46, 'RN': 8, 'RO': 8,
      'RR': 8, 'RS': 31, 'SC': 16, 'SE': 8, 'SP': 70, 'TO': 8
    };
    const fedSeats = seatsMap[ufNorm] || 8;
    if (currentCargo === 'deputado_federal') {
      vagasDisplay = fedSeats;
    } else if (currentCargo === 'deputado_estadual' || currentCargo === 'deputado_distrital') {
      vagasDisplay = fedSeats <= 12 ? fedSeats * 3 : 36 + (fedSeats - 12);
    }
  }

  let qeDisplay = statsOfficial_prop?.vr_qe || qeValue;

  if (vagasDisplay > 0 || qeDisplay > 0) {
    let topMetrics = document.createElement('div');
    topMetrics.className = 'proportional-top-bar';
    topMetrics.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px; padding: 6px 8px; background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 0;';

    let vagasHtml = vagasDisplay ? `<div style="text-align: center;"><span style="color:var(--muted); font-size:0.65rem;">Vagas em Jogo</span><br><strong style="font-size:0.9rem; color:var(--text);">${vagasDisplay}</strong></div>` : '';
    let qeHtml = qeDisplay ? `<div style="text-align: center;"><span style="color:var(--muted); font-size:0.65rem;">Quociente Eleitoral (QE)</span><br><strong style="font-size:0.9rem; color:var(--text);">${fmtInt(qeDisplay)}</strong></div>` : '';
    
    topMetrics.innerHTML = vagasHtml + qeHtml;
    dom.resultsContent.appendChild(topMetrics);
  }



  const container = document.createElement('table');
  container.className = 'cand-table prop-table';
  container.innerHTML = `
    <thead>
      <tr>
        <th style="width: 16px; padding: 0;"></th>
        <th class="color-bar-td"></th>
        <th class="align-left">Partido / Coligação</th>
        <th class="align-center">Cadeiras</th>
        <th class="align-center">Votos</th>
        <th class="align-center">Pct.</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = container.querySelector('tbody');

  // --- VOTOS POR GRUPO NO ESCOPO COMPLETO (ESTADO/MUNICÍPIO), CONSTANTES ---
  // Separa os votos de candidatos inaptos/anulados (ex.: Deltan/Podemos-PR 2022) para que
  // o cálculo do Quociente Partidário (QP) os desconsidere, igual ao cálculo de cadeiras.
  const inaptosListForScope = isVereador
    ? (STATE.inaptos['vereador_ord']?.['1T'] || [])
    : (STATE.inaptos[currentCargo]?.['1T'] || []);
  const inaptosScopeSet = new Set(inaptosListForScope);
  const groupScopeVotes = new Map(); // key -> { total, validForQP }
  if (fullScopeVotesById) {
    const metaStore = isVereador ? (STATE.vereadorMetadata || {}) : (STATE.deputyMetadata || {});
    const prefixCache = isVereador ? (STATE._vereadorPartyPrefixCache || {}) : (STATE._partyPrefixCache || {});
    Object.entries(fullScopeVotesById).forEach(([candId, rawV]) => {
      if (candId === '95' || candId === '96') return;
      const v = ensureNumber(rawV);
      const gi = resolveProportionalGroupInfo(candId, metaStore, prefixCache);
      const rec = groupScopeVotes.get(gi.key) || { total: 0, validForQP: 0 };
      rec.total += v;
      if (!inaptosScopeSet.has(candId)) rec.validForQP += v;
      groupScopeVotes.set(gi.key, rec);
    });
  }

  groups.forEach((group) => {
    const pct = totalValidos > 0 ? (group.votes / totalValidos) : 0;

    // --- CÁLCULO DO VOTO ESTADUAL/MUNICIPAL DO GRUPO (STATEWIDE/MUNICIPALITY-WIDE) ---
    // Prioriza o escopo completo (constante) e exclui votos inaptos/anulados para o QP.
    let partyStatewideVotes = group.votes;
    const scopeRec = groupScopeVotes.get(group.key);
    if (scopeRec && scopeRec.validForQP > 0) {
      partyStatewideVotes = scopeRec.validForQP;
    } else if (typeof currentCargo === 'string' && currentCargo.startsWith('deputado')) {
      const yearKey = STATE.currentElectionYear;
      const ufKey = uf_prop;
      const typeKey = currentCargo === 'deputado_federal' ? 'f' : 'e';
      const officialCoalitions = STATE.officialTotals?.[yearKey]?.[ufKey]?.[typeKey]?.coalitions;
      if (officialCoalitions) {
        const matchedCoalition = officialCoalitions.find(c =>
          String(c.id).toUpperCase() === String(group.name).toUpperCase() ||
          String(c.raw_comp).toUpperCase() === String(group.composition || '').toUpperCase()
        );
        if (matchedCoalition) {
          partyStatewideVotes = ensureNumber(matchedCoalition.votes);
        }
      }
    }

    // Calcula desempenho do partido para mostrar na sidebar com base nos votos estaduais/municipais e na época histórica
    const groupQP = qeValue > 0 ? Math.floor(partyStatewideVotes / qeValue) : 0;
    const partyReached80 = qeValue > 0 ? partyStatewideVotes >= qe80 : false;
    
    let propStatusHtml = '';
    if (showRules && qeValue > 0) {
      const electionYearNum = parseInt(year_prop) || 2022;
      if (electionYearNum <= 2016) {
        // Epoch 1 (Até 2016): Modelo Tradicional sem regra 80/20 ou restrições de QE
        if (groupQP > 0) {
          propStatusHtml = `<span style="font-size: 0.65rem; color: var(--accent, #ffbd21); font-weight: 600; display: block; margin-top: 2px;">QP: ${groupQP} direta(s) &bull; Apto p/ Sobra (Legislação Histórica)</span>`;
        } else {
          propStatusHtml = `<span style="font-size: 0.65rem; color: #5fa72f; font-weight: 500; display: block; margin-top: 2px;">Apto p/ Sobra (Sem Exigência Mínima)</span>`;
        }
      } else if (electionYearNum <= 2020) {
        // Epoch 2 (2018-2020): Restrição de 100% QE do partido para disputar sobras
        const reached100 = partyStatewideVotes >= qeValue;
        if (groupQP > 0) {
          propStatusHtml = `<span style="font-size: 0.65rem; color: var(--accent, #ffbd21); font-weight: 600; display: block; margin-top: 2px;">QP: ${groupQP} direta(s) &bull; Apto p/ Sobra (≥100% QE)</span>`;
        } else if (reached100) {
          propStatusHtml = `<span style="font-size: 0.65rem; color: #5fa72f; font-weight: 500; display: block; margin-top: 2px;">Apto p/ Sobra (≥100% QE)</span>`;
        } else {
          propStatusHtml = `<span style="font-size: 0.65rem; color: var(--muted); opacity: 0.8; display: block; margin-top: 2px;">Apto apenas p/ Repescagem (3ª Fase)</span>`;
        }
      } else {
        // Epoch 3 (2022 em Diante): Regra 80/20 com repescagem 3ª fase (STF 2024)
        if (groupQP > 0) {
          propStatusHtml = `<span style="font-size: 0.65rem; color: var(--accent, #ffbd21); font-weight: 600; display: block; margin-top: 2px;">QP: ${groupQP} direta(s)</span>`;
        } else if (partyReached80) {
          propStatusHtml = `<span style="font-size: 0.65rem; color: #5fa72f; font-weight: 500; display: block; margin-top: 2px;">Apto p/ Sobra (≥80%)</span>`;
        } else {
          propStatusHtml = `<span style="font-size: 0.65rem; color: var(--muted); opacity: 0.7; display: block; margin-top: 2px;">Inapto p/ Sobra (&lt;80%) &bull; Apto p/ Sobras das Sobras</span>`;
        }
      }
    }

    const normalizedComposition = String(group.composition || '').replace(/\s+/g, '').toUpperCase();
    const normalizedName = String(group.name || '').replace(/\s+/g, '').toUpperCase();
    const compositionHtml = group.isGroup && normalizedComposition && normalizedComposition !== normalizedName
      ? `<div style="font-size: 0.65rem; color: var(--muted); margin-top: 2px;">${escapeHtml(group.composition)}</div>`
      : '';

    const electedCellHtml = group.electedCount > 0
      ? `<span style="font-weight: 700; color: var(--text); font-size: 0.85rem;">${group.electedCount}</span>`
      : `<span style="color: var(--muted); font-size: 0.85rem; opacity: 0.5;">0</span>`;

    const rowHeader = document.createElement('tr');
    rowHeader.className = 'party-row-header';
    rowHeader.style.cursor = 'pointer';
    rowHeader.innerHTML = `
      <td class="align-center" style="font-size: 0.55rem; color: var(--muted); padding: 8px 0; user-select: none; width: 16px;">&#9654;</td>
      <td class="color-bar-td">
        <div class="cand-color-bar" style="background-color: ${group.color};"></div>
      </td>
      <td class="align-left">
        <span style="font-weight: 600; color: var(--text); font-size: 0.85rem;">${escapeHtml(group.name)}</span>
        ${compositionHtml}
        ${propStatusHtml}
      </td>
      <td class="align-center" style="vertical-align: middle;">
        ${electedCellHtml}
      </td>
      <td class="align-center cand-votes-text" style="font-variant-numeric: tabular-nums; vertical-align: middle;">
        ${fmtInt(group.votes)}
      </td>
      <td class="align-center" style="vertical-align: middle; font-weight: 600; font-size: 0.85rem; font-variant-numeric: tabular-nums;">
        ${fmtPct(pct)}
      </td>
    `;

    const list = document.createElement('div');
    list.className = 'party-candidates';

    let candidatesHtml = `
      <table class="cand-table">
        <tbody>
    `;

    group.candidates.forEach((candidate) => {
      const partyColor = colorForParty(candidate.partido) || group.color || '#777';
      const pctStr = fmtPct(totalValidos > 0 ? candidate.votos / totalValidos : 0);
      const isElected = candidate.statusInfo.elected;
      const isInapto = candidate.statusInfo.badgeClass === 'inapto';

      const checkCircleHtml = isElected
        ? `<span class="cand-check-circle" style="background-color: ${partyColor};">✔</span>`
        : '';

      let badgeHtml = '';
      if (isInapto) {
        badgeHtml = `<span class="status-badge-sim inapto" style="margin-left: 6px; font-size: 0.6rem; padding: 1px 4px; border-radius: 2px;">Inapto</span>`;
      }

      // --- CÁLCULO DAS REGRAS NOMINAIS DO CANDIDATO PARA EXIBIÇÃO NO ACCORDION ---
      const st = String(candidate.status || '').toUpperCase();
      let candLabel = '';
      let badgeClass = '';
      
      if (group.electedCount === 0) {
        candLabel = 'NÃO ELEITO';
        badgeClass = 'nao-eleito';
      } else {
        if (st.includes('NÃO ELEITO') || st.includes('NAO ELEITO')) {
          candLabel = 'NÃO ELEITO';
          badgeClass = 'nao-eleito';
        }
        else if (st.includes('QP')) {
          candLabel = 'ELEITO POR QP';
          badgeClass = 'eleito';
        }
        else if (st.includes('MÉDIA') || st.includes('MEDIA') || st.includes('MÃ‰DIA')) {
          candLabel = 'ELEITO POR MÉDIA';
          badgeClass = 'eleito';
        }
        else if (st.includes('ELEITO')) {
          candLabel = 'ELEITO';
          badgeClass = 'eleito';
        }
        else if (st.includes('SUPLENTE')) {
          candLabel = 'SUPLENTE';
          badgeClass = 'suplente';
        }
        else {
          candLabel = 'NÃO ELEITO';
          badgeClass = 'nao-eleito';
        }
      }

      // --- VOTO NO ESCOPO COMPLETO (ESTADO/MUNICÍPIO), CONSTANTE ---
      // Usa a soma total no estado/município, não a seleção atual no mapa, para que o
      // valor exibido na tooltip não mude ao entrar em municípios/locais.
      let candStatewideVotes = candidate.votos;
      if (fullScopeVotesById && fullScopeVotesById[candidate.id] !== undefined) {
        candStatewideVotes = ensureNumber(fullScopeVotesById[candidate.id]);
      }

      let ruleExplanation = '';
      if (qeValue > 0) {
        const electionYearNum = parseInt(year_prop) || 2022;
        const reached10 = candStatewideVotes >= qe10;
        const reached20 = candStatewideVotes >= qe20;
        const reached100 = partyStatewideVotes >= qeValue;
        const partyReached80 = qeValue > 0 ? partyStatewideVotes >= qe80 : false;
        
        const votesSuffix = typeof currentCargo === 'string' && currentCargo.startsWith('vereador') ? 'votos' : 'votos estaduais';
        
        if (electionYearNum <= 2016) {
          // --- EPOCH 1 (ATÉ 2016): MODELO TRADICIONAL SEM BARREIRAS INDIVIDUAIS (SÓ 10% EM 2016) ---
          const has10PercentRule = (electionYearNum === 2016);
          if (candLabel.includes('QP')) {
            if (has10PercentRule) {
              ruleExplanation = `Eleito(a) por QP: O partido conquistou vaga direta e o candidato superou a barreira nominal de 10% do QE (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}; mínimo exigido: ${fmtInt(qe10)}).`;
            } else {
              ruleExplanation = `Eleito(a) por QP: Vaga direta conquistada pelo Quociente Partidário, preenchida conforme votação interna (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}).`;
            }
          } else if (candLabel.includes('MÉDIA') || candLabel.includes('MEDIA') || candLabel.includes('MÃ‰DIA')) {
            ruleExplanation = `Eleito(a) por Média: Vaga obtida pelo critério de maior média partidária na distribuição das sobras sucessivas (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}).`;
          } else if (candLabel.includes('ELEITO')) {
            ruleExplanation = `Eleito(a): Conquistou a vaga com base na votação nominal da legenda (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}).`;
          } else if (candLabel.includes('SUPLENTE')) {
            ruleExplanation = `Suplente: Posicionado na lista de suplentes da legenda por ordem de votação (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}).`;
          } else {
            ruleExplanation = `Não eleito(a): A legenda não conquistou vagas suficientes nas médias de sobras (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}).`;
          }
        } 
        else if (electionYearNum <= 2020) {
          // --- EPOCH 2 (2018-2020): REGRA 100% QE PARTIDO E 10% INDIVIDUAL ---
          if (candLabel.includes('QP')) {
            ruleExplanation = `Eleito(a) por QP: O partido conquistou vaga direta e o candidato superou a barreira de 10% do QE (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}; mínimo exigido: ${fmtInt(qe10)}).`;
          } else if (candLabel.includes('MÉDIA') || candLabel.includes('MEDIA') || candLabel.includes('MÃ‰DIA')) {
            if (reached100) {
              ruleExplanation = `Eleito(a) por Média: Vaga conquistada nas sobras de 2ª fase. O partido superou 100% do QE e o candidato superou 10% do QE (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}; mínimo exigido: ${fmtInt(qe10)}).`;
            } else {
              ruleExplanation = `Eleito(a) por Média (3ª Fase): Vaga obtida na repescagem final de 3ª fase (sem exigência de 100% do QE para o partido), chamando o candidato mais votado da legenda (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}).`;
            }
          } else if (candLabel.includes('ELEITO')) {
            ruleExplanation = `Eleito(a): Candidato superou os limites e foi eleito por média (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}).`;
          } else if (candLabel.includes('SUPLENTE')) {
            if (reached10) {
              ruleExplanation = `Suplente Apto: Obteve ${fmtInt(candStatewideVotes)} ${votesSuffix} (superou os 10% do QE, que é ${fmtInt(qe10)}), estando apto para assumir vagas na legenda.`;
            } else {
              ruleExplanation = `Suplente Inapto: Ficou abaixo da cláusula de desempenho individual de 10% do QE (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}; mínimo exigido: ${fmtInt(qe10)}).`;
            }
          } else {
            if (!reached100 && reached10) {
              ruleExplanation = `Não eleito(a): O partido não alcançou 100% do QE para disputar as sobras normais, e a sigla não obteve médias suficientes na repescagem de 3ª fase.`;
            } else if (!reached10) {
              ruleExplanation = `Não eleito(a): Não atingiu a cláusula de desempenho individual de 10% do QE (obteve ${fmtInt(candStatewideVotes)} de ${fmtInt(qe10)} ${votesSuffix}).`;
            } else {
              ruleExplanation = `Não eleito(a): Atingiu os mínimos legais, mas a legenda não obteve médias suficientes para conquistar mais vagas.`;
            }
          }
        } 
        else {
          // --- EPOCH 3 (2022 EM DIANTE): REGRA 80/20 E EXCEÇÃO STF ---
          if (candLabel.includes('QP')) {
            ruleExplanation = `Eleito(a) por QP: O partido conquistou vaga direta e o candidato superou a barreira individual de 10% do QE (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}; mínimo exigido: ${fmtInt(qe10)}).`;
          } else if (candLabel.includes('MÉDIA') || candLabel.includes('MEDIA') || candLabel.includes('MÃ‰DIA')) {
            if (candStatewideVotes < qe20) {
              ruleExplanation = `Eleito(a) por Média (Decisão STF): Eleito(a) na terceira fase de partilha de sobras. Segundo o STF, quando esgotados os candidatos com votação nominal mínima, as vagas remanescentes são distribuídas sem a exigência dos 20% do QE individual, beneficiando a maior média partidária (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}; mínimo de 20% do QE seria ${fmtInt(qe20)}).`;
            } else {
              ruleExplanation = `Eleito(a) por Média: A sigla atingiu mais de 80% do QE e o candidato superou 20% do QE individual (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}; mínimo exigido: ${fmtInt(qe20)}).`;
            }
          } else if (candLabel.includes('ELEITO')) {
            ruleExplanation = `Eleito(a) pelas regras proporcionais da legislação eleitoral (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}).`;
          } else if (candLabel.includes('SUPLENTE')) {
            if (reached20) {
              ruleExplanation = `Suplente Apto para Sobra: Obteve ${fmtInt(candStatewideVotes)} ${votesSuffix} (superou os 20% do QE, que é ${fmtInt(qe20)}), estando apto para assumir sobras.`;
            } else if (reached10) {
              ruleExplanation = `Suplente Apto apenas para QP: Obteve ${fmtInt(candStatewideVotes)} ${votesSuffix} (superou 10% do QE, que é ${fmtInt(qe10)}), porém é inapto para disputar sobras por não atingir 20% do QE (${fmtInt(qe20)}).`;
            } else {
              ruleExplanation = `Suplente Inapto: Ficou abaixo dos mínimos individuais (10% do QE para vaga direta: ${fmtInt(qe10)} ${votesSuffix}; 20% para sobras: ${fmtInt(qe20)}).`;
            }
          } else {
            if (!partyReached80) {
              ruleExplanation = `Não eleito(a): Partido não atingiu os 80% do QE necessários para disputar as sobras (obteve ${fmtInt(partyStatewideVotes)} de ${fmtInt(qe80)} ${votesSuffix}).`;
            } else if (!reached20) {
              ruleExplanation = `Não eleito(a): Não atingiu a cláusula de barreira de 20% do QE individual (obteve ${fmtInt(candStatewideVotes)} de ${fmtInt(qe20)} ${votesSuffix}).`;
            } else {
              ruleExplanation = `Não eleito(a): Atingiu todos os mínimos legais, mas a sigla não conquistou mais vagas na partilha de médias.`;
            }
          }
        }
      } else {
        ruleExplanation = `Status oficial: ${candLabel}.`;
      }

      if (candStatewideVotes !== candidate.votos) {
        const areaLabel = typeof currentCargo === 'string' && currentCargo.startsWith('vereador') ? 'município' : 'estado';
        ruleExplanation += ` (Nota: Votos exibidos no hover referem-se à soma total no ${areaLabel}: ${fmtInt(candStatewideVotes)} votos).`;
      }

      const nameHtml = `
        <div class="cand-name-container">
          ${checkCircleHtml}
          <span class="cand-name-text">${escapeHtml(toTitleCase(candidate.nome))}</span>
          ${badgeHtml}
        </div>
      `;

      // A tooltip de regra só é exibida quando as regras estão visíveis (botão "Mostrar Regras").
      const ruleAttrs = showRules
        ? ` cand-row-hoverable" data-explanation="${escapeHtml(ruleExplanation)}" style="cursor: help;"`
        : `"`;

      candidatesHtml += `
        <tr class="${candidate.statusInfo.rowClass}${ruleAttrs}>
          <td class="color-bar-td">
            <div class="cand-color-bar" style="background-color: ${partyColor};"></div>
          </td>
          <td class="align-left" style="padding-top: 6px; padding-bottom: 6px;">
            ${nameHtml}
            <div style="font-size: 0.65rem; color: var(--muted); margin-top: 2px;">
              ${escapeHtml(candidate.partido)}
            </div>
          </td>
          <td class="align-center cand-votes-text" style="vertical-align: middle;">
            ${fmtInt(candidate.votos)}
          </td>
          <td class="align-center" style="font-weight: 600; font-variant-numeric: tabular-nums; vertical-align: middle;">
            ${pctStr}
          </td>
        </tr>
      `;
    });

    candidatesHtml += `
        </tbody>
      </table>
    `;
    list.innerHTML = candidatesHtml;

    const rowCandidates = document.createElement('tr');
    rowCandidates.style.display = 'none';
    const candidatesTd = document.createElement('td');
    candidatesTd.colSpan = 6;
    candidatesTd.style.padding = '0';
    const isLightTheme = document.body.getAttribute('data-theme') === 'light';
    candidatesTd.style.background = isLightTheme ? 'rgba(0, 0, 0, 0.02)' : 'rgba(255, 255, 255, 0.02)';
    candidatesTd.appendChild(list);
    rowCandidates.appendChild(candidatesTd);

    rowHeader.addEventListener('click', () => {
      const isOpen = rowCandidates.style.display !== 'none';
      rowCandidates.style.display = isOpen ? 'none' : 'table-row';
      const arrowCell = rowHeader.cells[0];
      arrowCell.innerHTML = isOpen ? '&#9654;' : '&#9660;';
      arrowCell.style.color = isOpen ? 'var(--muted)' : 'var(--accent)';
    });

    tbody.appendChild(rowHeader);
    tbody.appendChild(rowCandidates);
  });

  dom.resultsContent.appendChild(container);

  const extraMetrics = metrics.extraMetrics || '';
  const comparecimento = metrics.comparecimento ?? (groupsPayload.comparecimento || totalValidos);
  const brancos = metrics.brancos ?? groupsPayload.brancos ?? 0;
  const nulos = metrics.nulos ?? groupsPayload.nulos ?? 0;
  const invalidos = brancos + nulos;
  const invalidosPct = comparecimento > 0 ? (invalidos / comparecimento) : 0;
  const ratioHtml = (metrics.ratio !== null && metrics.ratio !== undefined) ? ` (${fmtPct(metrics.ratio)})` : '';

  dom.resultsMetrics.innerHTML = `
    <div class="metrics-grid">
      ${extraMetrics}
      <div class="metric-item"><span>Votos válidos</span><strong>${fmtInt(totalValidos)}</strong></div>
      <div class="metric-item"><span>Comparecimento</span><strong>${fmtInt(comparecimento)}${ratioHtml}</strong></div>
      <div class="metric-item"><span>Votos inválidos</span><strong>${fmtInt(invalidos)} (${fmtPct(invalidosPct)})</strong></div>
    </div>
  `;
}

function renderDeputyPartyResults(cargo) {
  initializeCandidateColorUI();
  closeCandidateColorPopoverOnViewChange();

  // --- CONFIGURAÃ‡ÃƒO E CONSTANTES ---
  const FEDERATION_COLORS = {
    'FE Brasil (PT/PCdoB/PV)': '#C0122D',
    'PSDB/CIDADANIA': '#0097fd',
    'PSOL/REDE': '#68018D'
  };

  // 1. Alternador de VisualizaÃ§Ã£o
  const isFederationYear = (STATE.currentElectionYear >= 2022);
  const groupLabel = isFederationYear ? "Agrupar FederaÃ§Ãµes" : "Agrupar ColigaÃ§Ãµes";

  if (!STATE.deputyPartyViewMode) STATE.deputyPartyViewMode = 'party';

  const existingToggle = document.getElementById('party-view-toggle');
  if (existingToggle) existingToggle.remove();

  let toggleContainer = document.createElement('div');
  toggleContainer.id = 'party-view-toggle';
  toggleContainer.className = 'nav-tabs';
  toggleContainer.style.marginTop = '5px';
  toggleContainer.style.marginBottom = '10px';
  toggleContainer.style.fontSize = '0.8rem';
  toggleContainer.innerHTML = `
            <button class="nav-tab-btn ${STATE.deputyPartyViewMode === 'party' ? 'active' : ''}" data-mode="party">Partidos Individuais</button>
            <button class="nav-tab-btn ${STATE.deputyPartyViewMode === 'federation' ? 'active' : ''}" data-mode="federation">${groupLabel} (Oficial)</button>
        `;

  dom.resultsContent.innerHTML = '';
  dom.resultsContent.appendChild(toggleContainer);

  if (statsOfficial) {
    let topMetrics = document.createElement('div');
    topMetrics.className = 'proportional-top-bar';
    topMetrics.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; margin-bottom: 8px; padding: 10px; background: rgba(255, 189, 33, 0.05); border: 1px solid rgba(255, 189, 33, 0.15); border-radius: 8px;';
    
    let vagasHtml = statsOfficial.qt_vagas ? `<div style="text-align: center;"><span style="color:var(--muted); font-size:0.75rem;">Vagas em Jogo</span><br><strong style="font-size:1.1rem; color:var(--text);">${statsOfficial.qt_vagas}</strong></div>` : '';
    let qeHtml = statsOfficial.vr_qe ? `<div style="text-align: center;"><span style="color:var(--muted); font-size:0.75rem;">Quociente Eleitoral (QE)</span><br><strong style="font-size:1.1rem; color:var(--text);">${fmtInt(statsOfficial.vr_qe)}</strong></div>` : '';
    
    topMetrics.innerHTML = vagasHtml + qeHtml;
    dom.resultsContent.appendChild(topMetrics);
  }

  toggleContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-tab-btn');
    if (!btn) return;
    const mode = btn.dataset.mode;
    if (STATE.deputyPartyViewMode === mode) return;
    STATE.deputyPartyViewMode = mode;
    renderDeputyPartyResults(cargo);
    applyFiltersAndRedraw();
  });


  // --- PREPARAÇÃO DOS DADOS ---
  const typeKey = (cargo === 'deputado_federal') ? 'f' : 'e';
  const aggParty = {};
  const processedKeys = new Set();
  let totalVotesMap = 0;
  const usarResultadosCompletos = shouldUseGeneralDeputyJsonTotals(cargo);
  const uf = dom.selectUFGeneral.value;
  const year = STATE.currentElectionYear;
  const officialData = STATE.officialTotals?.[year]?.[uf]?.[typeKey] || null;

  // Cache simples de siglas
  const partyNumMap = {};
  if (STATE.deputyMetadata) {
    for (const [id, meta] of Object.entries(STATE.deputyMetadata)) {
      if (id && meta[1]) {
        const num = id.substring(0, 2);
        const name = cleanPartyName(meta[1]);
        const isGeneric = name.startsWith('PARTIDO ') || name.match(/^PARTIDO\d+$/);
        if (!isGeneric) partyNumMap[num] = name;
      }
    }
  }

  const geojson = currentDataCollection[cargo];

  // === OTIMIZAÃƒâ€¡ÃƒO: LOOP RÃPIDO ===
  // Se nÃ£o tem seleÃ§Ã£o (estado todo), usamos OfficialTotals para renderizar rÃ¡pido
  // Mas precisamos do aggParty para as CORES (quem teve mais voto).
  // Faremos um loop otimizado apenas nos IDs selecionados.

  if (usarResultadosCompletos) {
    for (const [, res] of Object.entries(STATE.deputyResults || {})) {
      if (!res || !res[typeKey]) continue;
      for (const cand in res[typeKey]) {
        if (STATE.filterInaptos && (STATE.inaptos[cargo]?.['1T'] || []).includes(cand)) {
          continue;
        }
        if (cand === '95' || cand === '96') continue;
        const v = parseInt(res[typeKey][cand]) || 0;

        const groupInfo = resolveProportionalGroupInfo(cand, STATE.deputyMetadata, STATE._partyPrefixCache);
        const groupKey = groupInfo.key; 
        const groupName = groupInfo.name;

        if (!aggParty[groupKey]) {
          aggParty[groupKey] = { 
            votes: 0, 
            electedSet: new Set(),
            name: groupName,
            composition: groupInfo.composition,
            isGroup: groupInfo.isGroup,
            dominantParty: groupInfo.party // Para cores
          };
        }
        aggParty[groupKey].votes += v;
        totalVotesMap += v;

        if (cand.length > 2) {
          const meta = STATE.deputyMetadata[cand];
          if (meta) {
            const status = (meta[2] || '').toUpperCase();
            if ((status.includes('ELEITO') || status.includes('QP') || status.includes('MÃ‰DIA')) && !status.includes('NÃƒO')) {
              aggParty[groupKey].electedSet.add(cand);
            }
          }
        }
      }
    }
  } else if (geojson && geojson.features) {
    // Garante Ã­ndice de lookup
    if (!STATE.deputyLookup || STATE.deputyLookupCargo !== cargo) {
      STATE.deputyLookup = new Map();
      STATE.deputyLookupCargo = cargo;
      const feats = geojson.features;
      for (let i = 0; i < feats.length; i++) {
        const p = feats[i].properties;
        const id = getFeatureSelectionId(p);
        const z = getProp(p, 'nr_zona');
        const l = getProp(p, 'nr_locvot') || getProp(p, 'nr_local_votacao');
        const m = getProp(p, 'cd_localidade_tse') || getProp(p, 'CD_MUNICIPIO');
        if (id && z && l && m) {
          STATE.deputyLookup.set(id, `${parseInt(z)}_${parseInt(m)}_${parseInt(l)}`);
        }
      }
    }

    // Loop apenas na seleÃ§Ã£o
    const ids = Array.from(selectedLocationIDs);
    const processedKeys = new Set();

    for (let i = 0; i < ids.length; i++) {
      const key = STATE.deputyLookup.get(ids[i]);
      if (!key || processedKeys.has(key)) continue;
      processedKeys.add(key);

      const res = STATE.deputyResults[key];
      if (res && res[typeKey]) {
        for (const cand in res[typeKey]) {
          if (STATE.filterInaptos && (STATE.inaptos[cargo]?.['1T'] || []).includes(cand)) {
            continue;
          }
          if (cand === '95' || cand === '96') continue;
          const v = parseInt(res[typeKey][cand]);

          const partyCode = cand.substring(0, 2);
          let partyName = partyNumMap[partyCode];
          if (!partyName) {
            const meta = STATE.deputyMetadata[cand];
            if (meta && meta[1]) {
              const n = meta[1].toUpperCase();
              if (!n.startsWith('PARTIDO ')) partyName = n;
            }
          }
          if (!partyName) partyName = `PARTIDO ${partyCode}`;

          if (!aggParty[partyName]) {
            aggParty[partyName] = { votes: 0, electedSet: new Set() };
          }
          aggParty[partyName].votes += v;
          totalVotesMap += v;

          // Checagem de eleito (para badge interno)
          if (cand.length > 2) {
            const meta = STATE.deputyMetadata[cand];
            if (meta) {
              const status = (meta[2] || '').toUpperCase();
              // Aqui usamos lÃ³gica simples apenas para saber se TEM eleito na sigla
              if ((status.includes('ELEITO') || status.includes('QP') || status.includes('MÃ‰DIA')) && !status.includes('NÃƒO')) {
                aggParty[partyName].electedSet.add(cand);
              }
            }
          }
        }
      }
    }
  }

  // --- RENDERIZAÃ‡ÃƒO ---
  let results = [];
  let totalValidosDisplay = 0;
  let subtitleText = "";
  let statsOfficial = null;

  // CASO 1: MODO AGRUPADO (FEDERAÃ‡ÃƒO/COLIGAÃ‡ÃƒO)
  if (STATE.deputyPartyViewMode === 'federation') {
    if (!officialData) {
      dom.resultsContent.innerHTML += `<div style="padding:20px; text-align:center; color:var(--muted)">Dados nÃ£o encontrados.</div>`;
      return;
    }

    statsOfficial = officialData.stats;
    totalValidosDisplay = statsOfficial.qt_votos_validos || 0;

    officialData.coalitions.forEach(off => {
      if (off.votes <= 0) return;

      const members = off.raw_comp.split('/').map(s => s.trim().toUpperCase());
      let bestColor = '#888888';
      let maxVotesInGroup = -1;
      let dominantParty = null;

      if (FEDERATION_COLORS[off.raw_comp] || FEDERATION_COLORS[off.party]) {
        bestColor = FEDERATION_COLORS[off.raw_comp] || FEDERATION_COLORS[off.party];
      } else {
        // Tenta achar o dominante nos votos do mapa
        members.forEach(sigla => {
          const pData = aggParty[`party:${sigla}`];
          const votes = pData ? pData.votes : 0;
          if (votes > maxVotesInGroup) {
            maxVotesInGroup = votes;
            dominantParty = sigla;
          }
        });
        if (dominantParty) bestColor = colorForParty(dominantParty);
        else bestColor = colorForParty(members[0]);
      }

      let coalitionName = off.name && off.name !== 'N/A' ? off.name : null;
      if (!coalitionName) {
        // Find the real coalition name from candidates metadata
        const offCompNorm = off.raw_comp.split('/').map(normalizePartyAlias).join('').replace(/\s/g, '');
        for (const meta of Object.values(STATE.deputyMetadata || {})) {
          if (meta && meta.length > 4 && meta[4] && meta[4].split('/').map(normalizePartyAlias).join('').replace(/\s/g, '') === offCompNorm) {
            const potentialName = meta[3];
            if (potentialName && potentialName.toUpperCase() !== 'PARTIDO ISOLADO') {
              coalitionName = potentialName;
            }
            break;
          }
        }
      }

      let finalName = coalitionName || off.id || off.raw_comp;

      const rawCompNorm2 = off.raw_comp.replace(/\s/g, '').toUpperCase();
      const finalNameNorm2 = finalName.replace(/\s/g, '').toUpperCase();
      // SE o nome da coligação for igual à sua composição (ex: FE BRASIL (PT/PCdoB/PV)), 
      // ou se o nome já contiver a composição, evitamos a redundância.
      if (rawCompNorm2 === finalNameNorm2 || finalNameNorm2.includes(rawCompNorm2)) {
        finalName = off.raw_comp; 
      }

      results.push({
        name: finalName,
        votes: off.votes,
        pct: (totalValidosDisplay > 0) ? (off.votes / totalValidosDisplay) : 0,
        elected: off.elected,
        color: bestColor,
        isGroup: true,
        composition: off.raw_comp
      });
    });

  }

  // CASO 2: MODO INDIVIDUAL
  else {
    totalValidosDisplay = usarResultadosCompletos
      ? (officialData?.stats?.qt_votos_validos || totalVotesMap)
      : totalVotesMap;
    for (const [groupKey, data] of Object.entries(aggParty)) {
      if (data.votes > 0) { 
        results.push({
          name: data.name,
          votes: data.votes,
          pct: (totalValidosDisplay > 0) ? (data.votes / totalValidosDisplay) : 0,
          elected: data.electedSet.size,
          color: colorForParty(data.dominantParty) || DEFAULT_SWATCH,
          isGroup: data.isGroup,
          composition: data.composition
        });
      }
    }
  }

  results.sort((a, b) => b.votes - a.votes);

  // --- HTML E CARROSSEL ---
  const wrapper = document.createElement('div');
  wrapper.className = 'carousel-wrapper';

  const carousel = document.createElement('div');
  carousel.className = 'results-carousel';

  const PAGE_SIZE = 10;
  const totalPages = Math.ceil(results.length / PAGE_SIZE);

  for (let i = 0; i < totalPages; i++) {
    const pageDiv = document.createElement('div');
    pageDiv.className = 'results-page party-results-page';

    const batch = results.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE);

    batch.forEach(r => {
      const div = document.createElement('div');
      div.className = 'cand party-result-card';
      div.style.borderLeft = `4px solid ${r.color}`;

      div.style.cursor = 'pointer';
      div.title = "Clique para ver lista de candidatos";
      div.onclick = () => {
        // Passa r.elected para tratar "NÃƒO ELEITO" geral
        openCoalitionModal(r.composition, r.name, r.color, cargo, r.elected, r.isGroup);
      };

      const electedHtml = (r.elected > 0)
        ? `<span class="status-badge eleito party-result-badge">
             <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></svg>
             ${r.elected} Eleito(s)</span>`
        : '';

      let headerStyle = '';
      if (r.name.length > 70) headerStyle = 'font-size: 0.75rem; line-height: 1.1;';
      else if (r.name.length > 50) headerStyle = 'font-size: 0.8rem; line-height: 1.15;';
      else if (r.name.length > 30) headerStyle = 'font-size: 0.9rem; line-height: 1.2;';

      const normComp = r.composition ? r.composition.replace(/\s/g, '').toUpperCase() : '';
      const normName = r.name.replace(/\s/g, '').toUpperCase();
      const showCompositionSubtitle = r.isGroup && r.composition && normComp !== normName;

      const subtitleHtml = showCompositionSubtitle
        ? `<div class="party-result-subtitle">${r.composition}</div>`
        : '';

      let propStatusHtml = '';
      if (statsOfficial && statsOfficial.vr_qe) {
        const QE = statsOfficial.vr_qe;
        const QP = Math.floor(r.votes / QE);
        if (QP > 0) {
          propStatusHtml = `<div style="font-size: 0.7rem; color: var(--accent, #ffbd21); font-weight: 600; margin-top: 2px;">QP: ${QP} direta(s)</div>`;
        } else if (r.votes >= QE * 0.8) {
          propStatusHtml = `<div style="font-size: 0.7rem; color: #5fa72f; font-weight: 500; margin-top: 2px;">Apto p/ Sobra (≥80%)</div>`;
        } else {
          propStatusHtml = `<div style="font-size: 0.7rem; color: var(--muted); opacity: 0.8; margin-top: 2px;">Inapto p/ Sobra (&lt;80%)</div>`;
        }
      }

      div.innerHTML = `
        <div class="cand-header party-result-header">
            <div class="cand-info party-result-info">
             <h4 class="party-result-title" style="${headerStyle}">${r.name}</h4>
             ${subtitleHtml}
            </div>
             ${electedHtml}
        </div>
        <div class="cand-stats party-result-stats" style="margin-top: 4px;">
          <div class="party-result-votes" style="display:flex; flex-direction:column; gap:2px; align-items:flex-start;">
            <div>
              <span class="bigPct">${fmtPct(r.pct)}</span>
              <span class="smallVotos">${fmtInt(r.votes)}</span>
            </div>
            ${propStatusHtml}
          </div>
          <div class="party-result-action" style="align-self: flex-end;">Ver lista -&gt;</div>
        </div>
      `;
      pageDiv.appendChild(div);
    });
    carousel.appendChild(pageDiv);
  }

  // Controles
  const prevBtn = document.createElement('div');
  prevBtn.className = 'carousel-arrow prev disabled';
  prevBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>`;

  const nextBtn = document.createElement('div');
  nextBtn.className = 'carousel-arrow next';
  if (totalPages <= 1) nextBtn.classList.add('disabled');
  nextBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;

  const paginator = document.createElement('div');
  paginator.className = 'carousel-paginator';
  paginator.textContent = `PÃ¡gina 1 de ${totalPages} (${results.length} registros)`;

  subtitleText = `${results.length} ${STATE.deputyPartyViewMode === 'federation' ? 'coligaÃ§Ãµes/federaÃ§Ãµes' : 'partidos'} listados`;
  dom.resultsSubtitle.innerHTML = subtitleText;

  const updateNav = () => {
    const scrollLeft = carousel.scrollLeft;
    const width = carousel.offsetWidth;
    const pageIndex = (width > 0) ? Math.round(scrollLeft / width) : 0;

    if (pageIndex <= 0) prevBtn.classList.add('disabled');
    else prevBtn.classList.remove('disabled');

    if (pageIndex >= totalPages - 1) nextBtn.classList.add('disabled');
    else nextBtn.classList.remove('disabled');

    paginator.textContent = `PÃ¡gina ${pageIndex + 1} de ${totalPages} (${results.length} registros)`;
  };

  carousel.addEventListener('scroll', debounce(updateNav, 50));
  prevBtn.onclick = () => carousel.scrollBy({ left: -carousel.offsetWidth, behavior: 'smooth' });
  nextBtn.onclick = () => carousel.scrollBy({ left: carousel.offsetWidth, behavior: 'smooth' });

  wrapper.appendChild(carousel);
  wrapper.appendChild(prevBtn);
  wrapper.appendChild(nextBtn);
  dom.resultsContent.appendChild(wrapper);
  dom.resultsContent.appendChild(paginator);

  let extraMetrics = '';
  if (statsOfficial) {
    if (statsOfficial.qt_vagas) extraMetrics += `<div class="metric-item" style="border-left: 3px solid var(--accent);"><span>Vagas em Jogo</span><strong>${statsOfficial.qt_vagas}</strong></div>`;
    if (statsOfficial.vr_qe) extraMetrics += `<div class="metric-item" style="border-left: 3px solid var(--accent);"><span>Quociente Eleitoral</span><strong>${fmtInt(statsOfficial.vr_qe)}</strong></div>`;
  }
  const deputyPartyTurnoutStats = getTurnoutStatsForSelection(null, cargo, '1T');
  const deputyPartyTurnoutHtml = deputyPartyTurnoutStats.ratio !== null
    ? `<div class="metric-item"><span>Participação</span><strong>${fmtPct(deputyPartyTurnoutStats.ratio)}</strong></div>`
    : '';

  dom.resultsMetrics.innerHTML = `
      <div class="metrics-grid">
        ${extraMetrics}
        <div class="metric-item"><span>Votos Válidos (Total)</span><strong>${fmtInt(totalValidosDisplay)}</strong></div>
        ${deputyPartyTurnoutHtml}
      </div>
      <div class="proportional-info-card" style="margin-top:12px; padding:10px; background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:6px; font-size:0.75rem; color:var(--muted); line-height:1.45;">
        <div style="font-weight:600; display:flex; align-items:center; gap:6px; color:var(--text); margin-bottom:4px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          Regras do Sistema Proporcional
        </div>
        Vagas diretas são distribuídas via <strong>Quociente Partidário (QP)</strong> (exige candidato com ≥10% do QE). Sobras são distribuídas pelas médias entre partidos com ≥80% do QE e candidatos com ≥20% do QE (<strong>Regra 80/20</strong>). Clique em um partido/federação para ver a lista detalhada e a regra aplicada a cada candidato.
      </div>
    `;
}

// ====== RENDERIZACAO DE VEREADORES ======
// Estrutura identica a renderDeputyResults, mas usando STATE.vereadorResults / Metadata
// typeKey fixo = 'v'

function renderVereadorResults(cargo) {
  initializeCandidateColorUI();
  closeCandidateColorPopoverOnViewChange();

  STATE.vereadorViewMode = 'party';
  STATE.vereadorPartyViewMode = 'coalition';
  renderVereadorPartyResults(cargo);
  return;

  // Toggle Candidatos / Partidos (igual ao de deputados)
  const existingToggle = document.getElementById('vereador-view-toggle');
  if (existingToggle) existingToggle.remove();

  if (!STATE.vereadorViewMode) STATE.vereadorViewMode = 'candidate';

  const toggleContainer = document.createElement('div');
  toggleContainer.id = 'vereador-view-toggle';
  toggleContainer.className = 'nav-tabs';
  toggleContainer.style.marginTop = '10px';
  toggleContainer.innerHTML = `
    <button class="nav-tab-btn ${STATE.vereadorViewMode === 'candidate' ? 'active' : ''}" data-mode="candidate">Candidatos</button>
    <button class="nav-tab-btn ${STATE.vereadorViewMode === 'party' ? 'active' : ''}" data-mode="party">Partidos</button>`;
  dom.resultsContent.parentNode.insertBefore(toggleContainer, dom.resultsContent);

  toggleContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-tab-btn');
    if (!btn) return;
    const mode = btn.dataset.mode;
    if (STATE.vereadorViewMode === mode) return;
    STATE.vereadorViewMode = mode;
    renderVereadorResults(cargo);
    applyFiltersAndRedraw();
    populateCidadeDropdown();
    populateBairroDropdown();
  });

  if (STATE.vereadorViewMode === 'party') {
    renderVereadorPartyResults(cargo);
    return;
  }

  // --- Agrega votos por candidato ---
  const TYPE_KEY = 'v';
  const agg = {};
  let totalVotes = 0, brancos = 0, nulos = 0;
  const visitedKeys = new Set();
  const useOfficialMunicipalTotals = shouldUseMunicipalOfficialTotals();
  const officialSummary = useOfficialMunicipalTotals ? STATE.municipalOfficialTotals?.[cargo]?.['1T'] : null;

  if (officialSummary) {
    brancos = ensureNumber(officialSummary.brancos);
    nulos = ensureNumber(officialSummary.nulos);
    Object.entries(officialSummary.votesById || {}).forEach(([cand, rawVotes]) => {
      if (cand === '95' || cand === '96') return;
      if (STATE.filterInaptos && (STATE.inaptos['vereador_ord']?.['1T'] || []).includes(cand)) return;
      if (String(cand).length <= 2) return;
      const vi = ensureNumber(rawVotes);
      agg[cand] = (agg[cand] || 0) + vi;
      totalVotes += vi;
    });
  } else {
    const geojson = currentDataCollection[cargo];
    if (geojson && geojson.features) {
      geojson.features.forEach(f => {
        const p = f.properties;
        const id = getFeatureSelectionId(p);
        if (!selectedLocationIDs.has(id)) return;
        const z = getProp(p, 'nr_zona');
        const l = getProp(p, 'nr_locvot') || getProp(p, 'nr_local_votacao');
        if (!z || !l) return;
        const key = `${parseInt(z)}_${parseInt(l)}`;
        if (visitedKeys.has(key)) return;
        visitedKeys.add(key);
        const res = STATE.vereadorResults[key];
        if (res && res[TYPE_KEY]) {
          for (const [cand, v] of Object.entries(res[TYPE_KEY])) {
            if (STATE.filterInaptos && (STATE.inaptos['vereador_ord']?.['1T'] || []).includes(cand)) continue;
            const vi = parseInt(v) || 0;
            if (cand === '95') brancos += vi;
            else if (cand === '96') nulos += vi;
            else { agg[cand] = (agg[cand] || 0) + vi; totalVotes += vi; }
          }
        }
      });
    }
  }

  const comparecimento = officialSummary
    ? ensureNumber(officialSummary.comparecimento)
    : (totalVotes + brancos + nulos);
  const turnoutStats = getTurnoutStatsForSelection(
    null,
    cargo,
    '1T',
    officialSummary ? officialSummary.comparecimento : null
  );
  const participacaoHtml = turnoutStats.ratio !== null
    ? `<div class="metric-item"><span>ParticipaÃ§Ã£o</span><strong>${fmtPct(turnoutStats.ratio)}</strong></div>`
    : '';

  const results = [];
  for (const [candId, votes] of Object.entries(agg)) {
    const meta = STATE.vereadorMetadata[candId] || [candId, '?', '?'];
    results.push({
      id: candId, nome: meta[0], partido: meta[1], status: meta[2],
      votos: votes, pct: (totalVotes > 0) ? votes / totalVotes : 0, isLegenda: (candId.length === 2)
    });
  }
  results.sort((a, b) => b.votos - a.votos);

  dom.resultsContent.innerHTML = '';
  const wrapper = document.createElement('div'); wrapper.className = 'carousel-wrapper';
  const carousel = document.createElement('div'); carousel.className = 'results-carousel';

  const nominais = results.filter(r => !r.isLegenda);
  const PAGE_SIZE = 10;
  const totalPages = Math.ceil(nominais.length / PAGE_SIZE);

  for (let i = 0; i < totalPages; i++) {
    const pageDiv = document.createElement('div');
    pageDiv.className = 'results-page';
    nominais.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE).forEach(r => {
      const div = document.createElement('div');
      div.className = 'cand';
      let statusHtml = '', simpleStatus = '';
      const st = (r.status || '').toUpperCase();
      if (st.includes('INAPTO')) { statusHtml = `<span class="status-badge inapto"><svg><use href="#svg-x"/></svg> INAPTO</span>`; simpleStatus = 'INAPTO'; div.classList.add('inapto-card'); }
      else if (st.includes('NÃƒO ELEITO') || st.includes('NAO ELEITO') || st === 'NÃƒO ELEITO' || st === 'NAO ELEITO') { statusHtml = `<span class="status-badge nao-eleito"><svg><use href="#svg-x"/></svg> NÃ£o Eleito</span>`; simpleStatus = 'NÃƒO ELEITO'; }
      else if (st.includes('ELEITO') || st.includes('QP') || st.includes('MEDIA') || st.includes('MÃ‰DIA')) { statusHtml = `<span class="status-badge eleito"><svg><use href="#svg-check"/></svg> ${escapeHtml(r.status)}</span>`; simpleStatus = 'ELEITO'; }
      else if (st.includes('SUPLENTE')) { statusHtml = `<span class="status-badge suplente">Suplente</span>`; simpleStatus = 'SUPLENTE'; }
      div.setAttribute('data-status', simpleStatus);
      const sw = getColorForCandidate(r.nome, r.partido);
      const safeNome = escapeHtml(toTitleCase(r.nome));
      const safePartyAndId = escapeHtml(`${r.partido} â€¢ ${r.id}`);
      div.innerHTML = `
        <div class="cand-header">
          ${renderCandidateColorControl(r.nome, r.partido, sw, true)}
          <div class="cand-info"><h4 title="${safeNome}">${safeNome}</h4><small title="${safePartyAndId}">${safePartyAndId}</small></div>
        </div>
        <div class="cand-stats">
          <div><span class="bigPct">${fmtPct(r.pct)}</span><span class="smallVotos">${fmtInt(r.votos)}</span></div>
          ${statusHtml}
        </div>`;
      pageDiv.appendChild(div);
    });
    carousel.appendChild(pageDiv);
  }

  const prevBtn = document.createElement('div'); prevBtn.className = 'carousel-arrow prev disabled';
  prevBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>`;
  const nextBtn = document.createElement('div'); nextBtn.className = 'carousel-arrow next' + (totalPages <= 1 ? ' disabled' : '');
  nextBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
  const paginator = document.createElement('div'); paginator.className = 'carousel-paginator';
  paginator.textContent = `Pagina 1 de ${totalPages} (${nominais.length} candidatos)`;

  const updateNav = () => {
    const pi = Math.round(carousel.scrollLeft / carousel.offsetWidth);
    prevBtn.classList.toggle('disabled', pi <= 0);
    nextBtn.classList.toggle('disabled', pi >= totalPages - 1);
    paginator.textContent = `Pagina ${pi + 1} de ${totalPages} (${nominais.length} candidatos)`;
  };
  carousel.addEventListener('scroll', debounce(updateNav, 50));
  prevBtn.onclick = () => carousel.scrollBy({ left: -carousel.offsetWidth, behavior: 'smooth' });
  nextBtn.onclick = () => carousel.scrollBy({ left: carousel.offsetWidth, behavior: 'smooth' });

  wrapper.append(carousel, prevBtn, nextBtn);
  dom.resultsContent.append(wrapper, paginator);

  const invalidos = brancos + nulos;
  const invalidosPct = comparecimento > 0 ? (invalidos / comparecimento) : 0;

  dom.resultsMetrics.innerHTML = `
    <div class="metrics-grid">
      <div class="metric-item"><span>Votos válidos</span><strong>${fmtInt(totalVotes)}</strong></div>
      <div class="metric-item"><span>Comparecimento</span><strong>${fmtInt(comparecimento)}${turnoutStats.ratio !== null ? ` (${fmtPct(turnoutStats.ratio)})` : ''}</strong></div>
      <div class="metric-item"><span>Votos inválidos</span><strong>${fmtInt(invalidos)} (${fmtPct(invalidosPct)})</strong></div>
    </div>`;
}

function renderVereadorPartyResults(cargo) {
  initializeCandidateColorUI();
  closeCandidateColorPopoverOnViewChange();

  const useOfficialMunicipalTotals = shouldUseMunicipalOfficialTotals();
  const officialSummary = useOfficialMunicipalTotals ? STATE.municipalOfficialTotals?.[cargo]?.['1T'] : null;
  // --- CONFIGURAÃ‡ÃƒO E CONSTANTES ---
  const TYPE_KEY = 'v';
  // Sub-toggle Partidos Individuais / Modo Oficial
  // Em 2020 nao havia coligacoes para vereador (proibidas), so partidos isolados
  const vYear = STATE.currentElectionYear;
  const isVer2020 = (String(vYear) === '2020');

  // Labels dos botoes
  const partyBtnLabel = isVer2020
    ? 'Partidos Individuais<span style="display:block;font-size:0.65rem;opacity:0.65;font-weight:400">com chapas impugnadas</span>'
    : 'Partidos Individuais';
  const officialBtnLabel = isVer2020
    ? 'Modo Oficial<span style="display:block;font-size:0.65rem;opacity:0.65;font-weight:400">sem chapas impugnadas</span>'
    : (String(vYear) >= '2022' ? 'Agrupar FederaÃ§Ãµes (Oficial)' : 'Agrupar ColigaÃ§Ãµes (Oficial)');

  if (!STATE.vereadorPartyViewMode) STATE.vereadorPartyViewMode = 'party';

  const existingSubToggle = document.getElementById('vereador-party-view-toggle');
  if (existingSubToggle) existingSubToggle.remove();

  const subToggle = document.createElement('div');
  subToggle.id = 'vereador-party-view-toggle';
  subToggle.className = 'nav-tabs';
  subToggle.style.marginTop = '5px';
  subToggle.style.marginBottom = '10px';
  subToggle.style.fontSize = '0.8rem';
  subToggle.innerHTML = `
    <button class="nav-tab-btn ${STATE.vereadorPartyViewMode === 'party' ? 'active' : ''}" data-mode="party" style="line-height:1.2">${partyBtnLabel}</button>
    <button class="nav-tab-btn ${STATE.vereadorPartyViewMode === 'coalition' ? 'active' : ''}" data-mode="coalition" style="line-height:1.2">${officialBtnLabel}</button>
  `;

  // Compute statsOfficial early
  const uf_ver = loadedVereadorState.uf || (dom.selectUFGeneral ? dom.selectUFGeneral.value : null);
  const year_ver = STATE.currentElectionYear;
  const totalsKey_ver = `vereadores_${year_ver}`;
  const rawTotals_ver = STATE.officialTotals?.[totalsKey_ver];
  const muniSanitized_ver = String(currentCidadeFilter || '').trim().toUpperCase();
  const statsOfficial_ver = rawTotals_ver?.[uf_ver]?.[muniSanitized_ver]?.stats || rawTotals_ver?.[uf_ver]?.stats || null;

  dom.resultsContent.innerHTML = '';
  dom.resultsContent.appendChild(subToggle);

  if (statsOfficial_ver) {
    let topMetrics = document.createElement('div');
    topMetrics.className = 'proportional-top-bar';
    topMetrics.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; margin-bottom: 8px; padding: 10px; background: rgba(255, 189, 33, 0.05); border: 1px solid rgba(255, 189, 33, 0.15); border-radius: 8px;';
    
    let vagasHtml = statsOfficial_ver.qt_vagas ? `<div style="text-align: center;"><span style="color:var(--muted); font-size:0.75rem;">Vagas em Jogo</span><br><strong style="font-size:1.1rem; color:var(--text);">${statsOfficial_ver.qt_vagas}</strong></div>` : '';
    let qeHtml = statsOfficial_ver.vr_qe ? `<div style="text-align: center;"><span style="color:var(--muted); font-size:0.75rem;">Quociente Eleitoral (QE)</span><br><strong style="font-size:1.1rem; color:var(--text);">${fmtInt(statsOfficial_ver.vr_qe)}</strong></div>` : '';
    
    topMetrics.innerHTML = vagasHtml + qeHtml;
    dom.resultsContent.appendChild(topMetrics);
  }

  subToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-tab-btn');
    if (!btn) return;
    const mode = btn.dataset.mode;
    if (STATE.vereadorPartyViewMode === mode) return;
    STATE.vereadorPartyViewMode = mode;
    renderVereadorPartyResults(cargo);
    applyFiltersAndRedraw();
  });

  // --- PREPARAÃ‡ÃƒO DOS DADOS (loop no mapa selecionado) ---
  const aggParty = {};
  let totalVotesMap = 0;
  const visitedKeys = new Set();

  // Cache siglas â†’ nome de partido
  const partyNumMap = {};
  if (STATE.vereadorMetadata) {
    for (const [id, meta] of Object.entries(STATE.vereadorMetadata)) {
      if (id && meta[1]) {
        const num = id.substring(0, 2);
        const name = cleanPartyName(meta[1]);
        const isGeneric = name.startsWith('PARTIDO ') || name.match(/^PARTIDO\d+$/);
        if (!isGeneric) partyNumMap[num] = name;
      }
    }
  }

  const geojson = currentDataCollection[cargo];
  if (officialSummary) {
    for (const [cand, rawVotes] of Object.entries(officialSummary.votesById || {})) {
      if (cand === '95' || cand === '96') continue;
      if (STATE.filterInaptos && (STATE.inaptos['vereador_ord']?.['1T'] || []).includes(cand)) continue;
      const v = ensureNumber(rawVotes);

      const partyCode = cand.substring(0, 2);
      let partyName = partyNumMap[partyCode];
      if (!partyName) {
        const meta = STATE.vereadorMetadata[cand];
        if (meta && meta[1]) {
          const n = meta[1].toUpperCase();
          if (!n.startsWith('PARTIDO ')) partyName = n;
        }
      }
      if (!partyName) partyName = `PARTIDO ${partyCode}`;

      if (!aggParty[partyName]) aggParty[partyName] = { votes: 0, electedSet: new Set() };
      aggParty[partyName].votes += v;
      totalVotesMap += v;

      if (cand.length > 2) {
        const meta = STATE.vereadorMetadata[cand];
        if (meta) {
          const status = (meta[2] || '').toUpperCase();
          if ((status.includes('ELEITO') || status.includes('QP') || status.includes('MÃ‰DIA') || status.includes('MEDIA')) && !status.includes('NÃƒO') && !status.includes('NAO')) {
            aggParty[partyName].electedSet.add(cand);
          }
        }
      }
    }
  } else if (geojson && geojson.features) {
    // Garante lookup vereador
    if (!STATE.vereadorLookup) {
      STATE.vereadorLookup = new Map();
      geojson.features.forEach(f => {
        const p = f.properties;
        const id = getFeatureSelectionId(p);
        const z = getProp(p, 'nr_zona');
        const l = getProp(p, 'nr_locvot') || getProp(p, 'nr_local_votacao');
        if (id && z && l) STATE.vereadorLookup.set(id, `${parseInt(z)}_${parseInt(l)}`);
      });
    }

    for (const id of selectedLocationIDs) {
      const key = STATE.vereadorLookup.get(id);
      if (!key || visitedKeys.has(key)) continue;
      visitedKeys.add(key);

      const res = STATE.vereadorResults[key];
      if (res && res[TYPE_KEY]) {
        for (const cand in res[TYPE_KEY]) {
          if (cand === '95' || cand === '96') continue;
          if (STATE.filterInaptos && (STATE.inaptos['vereador_ord']?.['1T'] || []).includes(cand)) continue;
          const v = parseInt(res[TYPE_KEY][cand]) || 0;
          if (v <= 0) continue; // Pula candidatos sem voto nesta seleção local

          const groupInfo = window.resolveProportionalGroupInfo(cand, STATE.vereadorMetadata, STATE._vereadorPartyPrefixCache);
          const groupKey = groupInfo.key;

          if (!aggParty[groupKey]) {
            aggParty[groupKey] = { 
              votes: 0, 
              electedSet: new Set(),
              name: groupInfo.name,
              composition: groupInfo.composition,
              isGroup: groupInfo.isGroup,
              dominantParty: groupInfo.party
            };
          }
          aggParty[groupKey].votes += v;
          totalVotesMap += v;

          if (cand.length > 2) {
            const meta = STATE.vereadorMetadata[cand];
            if (meta) {
              const status = (meta[2] || '').toUpperCase();
              if ((status.includes('ELEITO') || status.includes('QP') || status.includes('MÃ‰DIA') || status.includes('MEDIA')) && !status.includes('NÃƒO') && !status.includes('NAO')) {
                aggParty[groupKey].electedSet.add(cand);
              }
            }
          }
        }
      }
    }
  }

  // --- MONTAR RESULTADOS ---
  let results = [];
  let totalValidosDisplay = 0;
  let subtitleText = '';
  let statsOfficial = null;

  const uf = loadedVereadorState.uf || (dom.selectUFGeneral ? dom.selectUFGeneral.value : null);
  const year = STATE.currentElectionYear;
  const totalsKey = `vereadores_${year}`;

  // JSON structure: data["('UF',)"]['DESCONHECIDO'] â€” keyed by UF tuple string, all munis merged per state
  const rawTotals = STATE.officialTotals?.[totalsKey];
  // Estrutura: data['UF']['MUNI_SANITIZADO'] = { stats, coalitions }
  const muniSanitized = loadedVereadorState.muniSanitized || '';
  const ufBlock = rawTotals?.[uf]?.[muniSanitized] ?? null;

  // MODO COLIGAÃ‡Ã•ES/PARTIDOS (dados oficiais por municÃ­pio)
  if (STATE.vereadorPartyViewMode === 'coalition') {
    if (!ufBlock) {
      dom.resultsContent.innerHTML += `<div style="padding:20px; text-align:center; color:var(--muted)">Dados oficiais nÃ£o disponÃ­veis para este municÃ­pio.</div>`;
      return;
    }

    statsOfficial = ufBlock.stats;
    totalValidosDisplay = statsOfficial?.qt_votos_validos || totalVotesMap;

    (ufBlock.coalitions || []).forEach(off => {
      if (off.votes <= 0) return;

      const members = off.raw_comp.split('/').map(s => s.trim().toUpperCase());

      // Cor pelo partido dominante nos votos do mapa
      let bestColor = colorForParty(members[0]);
      let maxV = -1;
      members.forEach(sigla => {
        const pData = aggParty[`party:${sigla}`];
        if (pData && pData.votes > maxV) { maxV = pData.votes; bestColor = colorForParty(sigla); }
      });

      // Tenta achar nome da coligação no metadata
      let coalitionName = null;
      if (members.length > 1) {
        const offNorm = off.raw_comp.split('/').map(normalizePartyAlias).join('').replace(/\s/g, '');
        for (const meta of Object.values(STATE.vereadorMetadata || {})) {
          if (meta && meta.length > 4 && meta[3] && meta[4]) {
            const metaNorm = (meta[4] || '').split('/').map(normalizePartyAlias).join('').replace(/\s/g, '');
            if (metaNorm === offNorm) {
              const potName = meta[3];
              if (potName && potName.toUpperCase() !== 'PARTIDO ISOLADO') {
                coalitionName = potName;
                break;
              }
            }
          }
        }
      }

      let finalName = coalitionName || off.id || off.raw_comp;
      const rawCompNorm = off.raw_comp.replace(/\s/g, '').toUpperCase();
      const finalNameNorm = finalName.replace(/\s/g, '').toUpperCase();
      
      // Ajuste de redundância
      if (rawCompNorm === finalNameNorm || finalNameNorm.includes(rawCompNorm)) {
        finalName = off.raw_comp;
      }

      results.push({
        name: finalName,
        votes: off.votes,
        pct: (totalValidosDisplay > 0) ? (off.votes / totalValidosDisplay) : 0,
        elected: off.elected,
        color: bestColor,
        isGroup: true,
        composition: off.raw_comp
      });
    });
  } else {
    // MODO PARTIDOS INDIVIDUAIS
    totalValidosDisplay = officialSummary ? ensureNumber(officialSummary.totalValidos) : totalVotesMap;
    if (ufBlock) statsOfficial = ufBlock.stats;

    for (const [groupKey, data] of Object.entries(aggParty)) {
      if (data.votes > 0) {
        results.push({
          name: data.name,
          votes: data.votes,
          pct: totalValidosDisplay > 0 ? data.votes / totalValidosDisplay : 0,
          elected: data.electedSet.size,
          color: colorForParty(data.dominantParty) || DEFAULT_SWATCH,
          isGroup: data.isGroup,
          composition: data.composition
        });
      }
    }
  }

  results.sort((a, b) => b.votes - a.votes);

  // --- CARROSSEL ---
  const wrapper = document.createElement('div');
  wrapper.className = 'carousel-wrapper';
  const carousel = document.createElement('div');
  carousel.className = 'results-carousel';

  const PAGE_SIZE = 10;
  const totalPages = Math.ceil(results.length / PAGE_SIZE);

  for (let i = 0; i < totalPages; i++) {
    const pageDiv = document.createElement('div');
    pageDiv.className = 'results-page party-results-page';

    results.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE).forEach(r => {
      const div = document.createElement('div');
      div.className = 'cand party-result-card';
      div.style.borderLeft = `4px solid ${r.color}`;
      div.style.cursor = 'pointer';
      div.title = 'Clique para ver lista de candidatos';
      div.onclick = () => openVereadorCoalitionModal(r.composition, r.name, r.color, cargo, r.elected, r.isGroup);

      const electedHtml = (r.elected > 0)
        ? `<span class="status-badge eleito party-result-badge">
             <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></svg>
             ${r.elected} Eleito(s)</span>`
        : '';

      let headerStyle = '';
      if (r.name.length > 70) headerStyle = 'font-size: 0.75rem; line-height: 1.1;';
      else if (r.name.length > 50) headerStyle = 'font-size: 0.8rem; line-height: 1.15;';
      else if (r.name.length > 30) headerStyle = 'font-size: 0.9rem; line-height: 1.2;';

      const normComp = r.composition ? r.composition.replace(/\s/g, '').toUpperCase() : '';
      const normName = r.name.replace(/\s/g, '').toUpperCase();
      const showCompositionSubtitle = r.isGroup && r.composition && normComp !== normName;
      const subtitleHtml = showCompositionSubtitle
        ? `<div class="party-result-subtitle">${r.composition}</div>`
        : '';

      let propStatusHtml = '';
      if (statsOfficial && statsOfficial.vr_qe) {
        const QE = statsOfficial.vr_qe;
        const QP = Math.floor(r.votes / QE);
        if (QP > 0) {
          propStatusHtml = `<div style="font-size: 0.7rem; color: var(--accent, #ffbd21); font-weight: 600; margin-top: 2px;">QP: ${QP} direta(s)</div>`;
        } else if (r.votes >= QE * 0.8) {
          propStatusHtml = `<div style="font-size: 0.7rem; color: #5fa72f; font-weight: 500; margin-top: 2px;">Apto p/ Sobra (≥80%)</div>`;
        } else {
          propStatusHtml = `<div style="font-size: 0.7rem; color: var(--muted); opacity: 0.8; margin-top: 2px;">Inapto p/ Sobra (&lt;80%)</div>`;
        }
      }

      div.innerHTML = `
        <div class="cand-header party-result-header">
          <div class="cand-info party-result-info">
            <h4 class="party-result-title" style="${headerStyle}">${r.name}</h4>
            ${subtitleHtml}
          </div>
          ${electedHtml}
        </div>
        <div class="cand-stats party-result-stats" style="margin-top: 4px;">
          <div class="party-result-votes" style="display:flex; flex-direction:column; gap:2px; align-items:flex-start;">
            <div>
              <span class="bigPct">${fmtPct(r.pct)}</span>
              <span class="smallVotos">${fmtInt(r.votes)}</span>
            </div>
            ${propStatusHtml}
          </div>
          <div class="party-result-action" style="align-self: flex-end;">Ver lista -&gt;</div>
        </div>
      `;
      pageDiv.appendChild(div);
    });
    carousel.appendChild(pageDiv);
  }

  const prevBtn = document.createElement('div');
  prevBtn.className = 'carousel-arrow prev disabled';
  prevBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>`;

  const nextBtn = document.createElement('div');
  nextBtn.className = 'carousel-arrow next' + (totalPages <= 1 ? ' disabled' : '');
  nextBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;

  const paginator = document.createElement('div');
  paginator.className = 'carousel-paginator';
  paginator.textContent = `PÃ¡gina 1 de ${totalPages} (${results.length} registros)`;

  subtitleText = `${results.length} ${STATE.vereadorPartyViewMode === 'coalition' ? 'coligaÃ§Ãµes/partidos' : 'partidos'} listados`;
  dom.resultsSubtitle.innerHTML = subtitleText;

  const updateNav = () => {
    const pageIndex = carousel.offsetWidth > 0 ? Math.round(carousel.scrollLeft / carousel.offsetWidth) : 0;
    prevBtn.classList.toggle('disabled', pageIndex <= 0);
    nextBtn.classList.toggle('disabled', pageIndex >= totalPages - 1);
    paginator.textContent = `PÃ¡gina ${pageIndex + 1} de ${totalPages} (${results.length} registros)`;
  };
  carousel.addEventListener('scroll', debounce(updateNav, 50));
  prevBtn.onclick = () => carousel.scrollBy({ left: -carousel.offsetWidth, behavior: 'smooth' });
  nextBtn.onclick = () => carousel.scrollBy({ left: carousel.offsetWidth, behavior: 'smooth' });

  wrapper.appendChild(carousel);
  wrapper.appendChild(prevBtn);
  wrapper.appendChild(nextBtn);
  dom.resultsContent.appendChild(wrapper);
  dom.resultsContent.appendChild(paginator);

  let extraMetrics = '';
  if (statsOfficial) {
    if (statsOfficial.qt_vagas) extraMetrics += `<div class="metric-item" style="border-left: 3px solid var(--accent);"><span>Vagas em Jogo</span><strong>${statsOfficial.qt_vagas}</strong></div>`;
    if (statsOfficial.vr_qe) extraMetrics += `<div class="metric-item" style="border-left: 3px solid var(--accent);"><span>Quociente Eleitoral</span><strong>${fmtInt(statsOfficial.vr_qe)}</strong></div>`;
  }
  const vereadorPartyTurnoutStats = getTurnoutStatsForSelection(
    null,
    cargo,
    '1T',
    officialSummary ? officialSummary.comparecimento : null
  );
  const vereadorPartyTurnoutHtml = vereadorPartyTurnoutStats.ratio !== null
    ? `<div class="metric-item"><span>Participação</span><strong>${fmtPct(vereadorPartyTurnoutStats.ratio)}</strong></div>`
    : '';
  dom.resultsMetrics.innerHTML = `
    <div class="metrics-grid">
      ${extraMetrics}
      <div class="metric-item"><span>Votos Válidos (Nominais)</span><strong>${fmtInt(totalValidosDisplay)}</strong></div>
      ${vereadorPartyTurnoutHtml}
    </div>
    <div class="proportional-info-card" style="margin-top:12px; padding:10px; background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:6px; font-size:0.75rem; color:var(--muted); line-height:1.45;">
      <div style="font-weight:600; display:flex; align-items:center; gap:6px; color:var(--text); margin-bottom:4px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        Regras do Sistema Proporcional
      </div>
      Vagas diretas são distribuídas via <strong>Quociente Partidário (QP)</strong> (exige candidato com ≥10% do QE). Sobras são distribuídas pelas médias entre partidos com ≥80% do QE e candidatos com ≥20% do QE (<strong>Regra 80/20</strong>). Clique em um partido/coligação para ver a lista detalhada e a regra aplicada a cada candidato.
    </div>`;
}

// Modal de candidatos do partido/coligaÃ§Ã£o para VEREADOR
function openVereadorCoalitionModal(composition, titleName, color, cargo, electedCount, isGroup = false) {
  let targetParties = composition.split('/').map(s => normalizePartyAlias(s.trim().toUpperCase()));

  // Fallback: se vier nome de coligaÃ§Ã£o com parÃªnteses, extrai composiÃ§Ã£o
  const matchParenthesis = composition.match(/\((.*?)\)/);
  if (matchParenthesis) {
    targetParties = matchParenthesis[1].split('/').map(s => normalizePartyAlias(s.trim().toUpperCase()));
  }

  const aggCandidates = {};
  const visitedKeys = new Set();

  const geojson = currentDataCollection[cargo];
  if (geojson && geojson.features) {
    if (!STATE.vereadorLookup) {
      STATE.vereadorLookup = new Map();
      geojson.features.forEach(f => {
        const p = f.properties;
        const id = getFeatureSelectionId(p);
        const z = getProp(p, 'nr_zona');
        const l = getProp(p, 'nr_locvot') || getProp(p, 'nr_local_votacao');
        if (id && z && l) STATE.vereadorLookup.set(id, `${parseInt(z)}_${parseInt(l)}`);
      });
    }
  }

  for (const id of selectedLocationIDs) {
    const key = STATE.vereadorLookup ? STATE.vereadorLookup.get(id) : null;
    if (!key || visitedKeys.has(key)) continue;
    visitedKeys.add(key);

    const res = STATE.vereadorResults[key];
    if (res && res['v']) {
      for (const [candId, v] of Object.entries(res['v'])) {
        if (candId === '95' || candId === '96') continue;
        const meta = STATE.vereadorMetadata[candId];
        if (!meta) continue;

        let candParty = normalizePartyAlias((meta[1] || '').toUpperCase());
        if (candParty.startsWith('PARTIDO ') && STATE._vereadorPartyPrefixCache) {
          const prefix = candId.substring(0, 2);
          candParty = normalizePartyAlias((STATE._vereadorPartyPrefixCache[prefix] || candParty).toUpperCase());
        }

        if (!isGroup || targetParties.includes(candParty)) {
          if (!isGroup && !targetParties.includes(candParty)) continue;
          const vi = typeof v === 'string' ? parseInt(v.replace(/\./g, ''), 10) : parseInt(v);
          if (!aggCandidates[candId]) {
            aggCandidates[candId] = { nome: meta[0], partido: candParty, status: meta[2] || '', votos: 0, isLegenda: candId.length <= 2 };
          }
          aggCandidates[candId].votos += vi;
        }
      }
    }
  }

  const legendVotes = [];
  const realCandidates = [];
  Object.values(aggCandidates).forEach(c => { if (c.isLegenda) legendVotes.push(c); else realCandidates.push(c); });
  const candidateList = realCandidates.sort((a, b) => b.votos - a.votos);
  const totalLegendVotes = legendVotes.reduce((sum, l) => sum + l.votos, 0);
  const forceNotElected = (electedCount === 0);

  renderProportionalModalUI(
    composition,
    titleName,
    color,
    cargo,
    electedCount,
    isGroup,
    targetParties,
    legendVotes,
    candidateList,
    totalLegendVotes,
    forceNotElected
  );
}

function precomputeVereadorWinners() {
  // Igual a precomputeDeputyWinners mas para vereadores
  const TYPE_KEY = 'v';
  const geojson = currentDataCollection['vereador_ord'];
  if (!geojson || !geojson.features) return;

  geojson.features.forEach(f => {
    const p = f.properties;
    const z = getProp(p, 'nr_zona'), l = getProp(p, 'nr_locvot') || getProp(p, 'nr_local_votacao');
    if (!z || !l) return;
    const key = `${parseInt(z)}_${parseInt(l)}`;
    const locData = STATE.vereadorResults[key];
    if (!locData || !locData[TYPE_KEY]) return;

    let winner = null, winnerVotes = -1, total = 0;
    for (const [cid, v] of Object.entries(locData[TYPE_KEY])) {
      if (cid === '95' || cid === '96') continue;
      const vi = parseInt(v) || 0;
      total += vi;
      if (vi > winnerVotes) { winnerVotes = vi; winner = cid; }
    }
    // Injeta no properties para getFeatureStyle funcionar via getVereadorFeatureData
    p['_VTOTAL_'] = total;
    p['_VWINNER_'] = winner;
    p['_VWVOTES_'] = winnerVotes;
  });
}


function renderProportionalModalUI(composition, titleName, color, cargo, electedCount, isGroup, targetParties, legendVotes, candidateList, totalLegendVotes, forceNotElected) {
  ensureCustomCandTooltip();
  const isEstadual = (cargo === 'deputado_estadual');
  const isVereador = String(cargo || '').startsWith('vereador');
  const typeKey = isVereador ? 'v' : (isEstadual ? 'e' : 'f');
  
  const uf = loadedVereadorState.uf || (dom.selectUFGeneral ? dom.selectUFGeneral.value : '');
  const year = STATE.currentElectionYear;
  
  let statsOfficial = null;
  let totalValidosDisplay = 0;
  
  if (isVereador) {
    const totalsKey = `vereadores_${year}`;
    const rawTotals = STATE.officialTotals?.[totalsKey];
    const muniSanitized = String(currentCidadeFilter || '').trim().toUpperCase();
    statsOfficial = rawTotals?.[uf]?.[muniSanitized]?.stats || rawTotals?.[uf]?.stats || null;
  } else {
    const officialData = STATE.officialTotals?.[year]?.[uf]?.[typeKey] || null;
    statsOfficial = officialData?.stats || null;
  }
  
  totalValidosDisplay = statsOfficial?.qt_votos_validos || 0;
  if (!totalValidosDisplay) {
    let totalVotesMap = 0;
    const resultsStore = isVereador ? STATE.vereadorResults : STATE.deputyResults;
    if (resultsStore) {
      for (const [, res] of Object.entries(resultsStore)) {
        if (res && res[typeKey]) {
          for (const cand in res[typeKey]) {
            if (cand !== '95' && cand !== '96') {
              totalVotesMap += parseInt(res[typeKey][cand]) || 0;
            }
          }
        }
      }
    }
    totalValidosDisplay = totalVotesMap;
  }  const totalCandVotes = candidateList.reduce((sum, c) => sum + c.votos, 0);
  const totalPartyVotes = totalCandVotes + totalLegendVotes;

  // --- CÁLCULO DO VOTO ESTADUAL/MUNICIPAL DO GRUPO (STATEWIDE/MUNICIPALITY-WIDE) ---
  let totalPartyStatewideVotes = totalPartyVotes;
  if (!isVereador && typeof cargo === 'string' && cargo.startsWith('deputado')) {
    const yearKey = STATE.currentElectionYear;
    const ufKey = uf;
    const typeKey = cargo === 'deputado_federal' ? 'f' : 'e';
    const officialCoalitions = STATE.officialTotals?.[yearKey]?.[ufKey]?.[typeKey]?.coalitions;
    if (officialCoalitions) {
      const matchedCoalition = officialCoalitions.find(col => 
        String(col.id).toUpperCase() === String(titleName).toUpperCase() || 
        String(col.raw_comp).toUpperCase() === String(composition || '').toUpperCase()
      );
      if (matchedCoalition) {
        totalPartyStatewideVotes = ensureNumber(matchedCoalition.votes);
      }
    }
  } else if (isVereador) {
    const muniScope = STATE.municipalOfficialTotals?.[cargo]?.['1T'];
    if (muniScope?.votesById) {
      let sum = 0;
      const metaStore = STATE.vereadorMetadata || {};
      const prefixCache = STATE._vereadorPartyPrefixCache || {};
      Object.entries(muniScope.votesById).forEach(([candId, rawV]) => {
        if (candId === '95' || candId === '96') return;
        const groupInfo = resolveProportionalGroupInfo(candId, metaStore, prefixCache);
        if (targetParties.includes(normalizePartyAlias(groupInfo.party))) {
          sum += ensureNumber(rawV);
        }
      });
      if (sum > 0) {
        totalPartyStatewideVotes = sum;
      }
    }
  }

  const QP = qeValue > 0 ? Math.floor(totalPartyStatewideVotes / qeValue) : 0;
  
  let qeExplanationHtml = '';
  if (qeValue > 0) {
    const reached80 = totalPartyStatewideVotes >= qe80;
    const qeProgress = ((totalPartyStatewideVotes / qeValue) * 100).toFixed(1);
    
    qeExplanationHtml = `
      <div style="margin-top:6px; display:flex; flex-direction:column; gap:4px; font-size:0.75rem;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="color:var(--muted);">Percentual do QE atingido pela sigla:</span>
          <strong style="color:var(--text);">${qeProgress}%</strong>
        </div>
        <div style="background:rgba(255,255,255,0.1); height:6px; border-radius:3px; overflow:hidden; margin:2px 0;">
          <div style="background:${totalPartyStatewideVotes >= qeValue ? 'var(--accent, #ffbd21)' : 'var(--muted, #888)'}; width:${Math.min(100, (totalPartyStatewideVotes / qeValue) * 100)}%; height:100%; border-radius:3px;"></div>
        </div>
        <div style="margin-top:4px; color:var(--text);">
          <strong>Quociente Partidário (QP):</strong> ${QP > 0 ? `A sigla conquistou <strong>${QP}</strong> vaga(s) direta(s) (votos ≥ QE)` : `A sigla obteve <strong>0</strong> vagas diretas (não atingiu os ${fmtInt(qeValue)} votos do QE)`}.
        </div>
        <div style="margin-top:2px; color:var(--text);">
          <strong>Disputa de Sobras (Média):</strong> ${reached80 ? `🟢 <strong>APTA</strong> (atingiu ${fmtInt(totalPartyStatewideVotes)} de ${fmtInt(qe80)} votos exigidos, ou seja, ≥ 80% do QE).` : `🔴 <strong>INAPTA</strong> (não atingiu 80% do QE: obteve ${fmtInt(totalPartyStatewideVotes)} de ${fmtInt(qe80)} necessários para as médias).`}
        </div>
      </div>
    `;
  } else {
    qeExplanationHtml = `
      <div style="color:var(--muted); font-size:0.75rem;">
        Quociente Eleitoral indisponível para cálculo nesta seleção local.
      </div>
    `;
  }
  
  let listHtml = candidateList.map((c, idx) => {
    let statusBadge = '';
    const st = c.status.toUpperCase();
    let label = '';
    let badgeClass = '';
    
    if (forceNotElected) {
      label = 'NÃO ELEITO';
      badgeClass = 'nao-eleito';
    } else {
      if (st.includes('NÃO ELEITO') || st.includes('NAO ELEITO')) {
        label = 'NÃO ELEITO';
        badgeClass = 'nao-eleito';
      }
      else if (st.includes('QP')) {
        label = 'ELEITO POR QP';
        badgeClass = 'eleito';
      }
      else if (st.includes('MÉDIA') || st.includes('MEDIA') || st.includes('MÃ‰DIA')) {
        label = 'ELEITO POR MÉDIA';
        badgeClass = 'eleito';
      }
      else if (st.includes('ELEITO')) {
        label = 'ELEITO';
        badgeClass = 'eleito';
      }
      else if (st.includes('SUPLENTE')) {
        label = 'SUPLENTE';
        badgeClass = 'suplente';
      }
      else {
        label = 'NÃO ELEITO';
        badgeClass = 'nao-eleito';
      }
    }
    
    statusBadge = `<span class="status-badge ${badgeClass}" style="font-size:0.65rem; padding:2px 5px;">${label}</span>`;
    const partyColor = colorForParty(c.partido);
    
    // --- CÁLCULO DO VOTO ESTADUAL/MUNICIPAL INDIVIDUAL NO FILTRO ---
    let candStatewideVotes = c.votos;
    if (!isVereador && typeof cargo === 'string' && cargo.startsWith('deputado')) {
      const stateScope = STATE.precomputedProportionalStateTotals?.[cargo]?.state;
      if (stateScope?.votesById && stateScope.votesById[c.id] !== undefined) {
        candStatewideVotes = ensureNumber(stateScope.votesById[c.id]);
      }
    } else if (isVereador) {
      const muniScope = STATE.municipalOfficialTotals?.[cargo]?.['1T'];
      if (muniScope?.votesById && muniScope.votesById[c.id] !== undefined) {
        candStatewideVotes = ensureNumber(muniScope.votesById[c.id]);
      }
    }

    let ruleExplanation = '';
    if (qeValue > 0) {
      const electionYearNum = parseInt(year) || 2022;
      const reached10 = candStatewideVotes >= qe10;
      const reached20 = candStatewideVotes >= qe20;
      const reached100 = totalPartyStatewideVotes >= qeValue;
      const partyReached80 = totalPartyStatewideVotes >= qe80;
      
      const votesSuffix = isVereador ? 'votos' : 'votos estaduais';
      
      if (electionYearNum <= 2016) {
        // --- EPOCH 1 (ATÉ 2016): MODELO TRADICIONAL ---
        const has10PercentRule = (electionYearNum === 2016);
        if (label.includes('QP')) {
          if (has10PercentRule) {
            ruleExplanation = `Eleito(a) diretamente (Vaga por QP): O partido conquistou vaga direta e o candidato superou a cláusula de barreira de 10% do QE (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}; mínimo exigido: ${fmtInt(qe10)}).`;
          } else {
            ruleExplanation = `Eleito(a) diretamente (Vaga por QP): Vaga direta conquistada pelo Quociente Partidário, preenchida conforme votação interna (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}).`;
          }
        } else if (label.includes('MÉDIA') || label.includes('MEDIA') || label.includes('MÃ‰DIA')) {
          ruleExplanation = `Eleito(a) por Média: Vaga obtida pelo critério de maior média partidária na distribuição das sobras sucessivas (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}).`;
        } else if (label.includes('ELEITO')) {
          ruleExplanation = `Eleito(a): Conquistou a vaga com base na votação nominal da legenda (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}).`;
        } else if (label.includes('SUPLENTE')) {
          ruleExplanation = `Suplente: Posicionado na lista de suplentes da legenda por ordem de votação (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}).`;
        } else {
          ruleExplanation = `Não eleito(a): A legenda não conquistou vagas suficientes nas médias de sobras (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}).`;
        }
      }
      else if (electionYearNum <= 2020) {
        // --- EPOCH 2 (2018-2020): 100% DO QE E 10% INDIVIDUAL ---
        if (label.includes('QP')) {
          ruleExplanation = `Eleito(a) diretamente (Vaga por QP): O partido conquistou vaga direta e o candidato superou a cláusula de barreira de 10% do QE (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}; mínimo exigido: ${fmtInt(qe10)}).`;
        } else if (label.includes('MÉDIA') || label.includes('MEDIA') || label.includes('MÃ‰DIA')) {
          if (reached100) {
            ruleExplanation = `Eleito(a) por Média: Vaga conquistada nas sobras de 2ª fase. O partido superou 100% do QE e o candidato superou 10% do QE (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}; mínimo exigido: ${fmtInt(qe10)}).`;
          } else {
            ruleExplanation = `Eleito(a) por Média (3ª Fase): Vaga obtida na repescagem final de 3ª fase (sem exigência de 100% do QE para o partido), chamando o candidato mais votado da legenda (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}).`;
          }
        } else if (label.includes('ELEITO')) {
          ruleExplanation = `Eleito(a): Candidato superou os limites e foi eleito por média (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}).`;
        } else if (label.includes('SUPLENTE')) {
          if (reached10) {
            ruleExplanation = `Suplente Apto: Obteve ${fmtInt(candStatewideVotes)} ${votesSuffix} (superou os 10% do QE, que é ${fmtInt(qe10)}), estando apto a assumir vagas na legenda.`;
          } else {
            ruleExplanation = `Suplente Inapto para assumir vaga imediata: Ficou abaixo do mínimo individual de 10% do QE (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}; mínimo exigido: ${fmtInt(qe10)}).`;
          }
        } else {
          if (!reached100 && reached10) {
            ruleExplanation = `Não eleito(a): O partido não alcançou 100% do QE para disputar as sobras normais, e a sigla não obteve médias suficientes na repescagem de 3ª fase.`;
          } else if (!reached10) {
            ruleExplanation = `Não eleito(a): Não atingiu a cláusula de desempenho individual de 10% do QE (obteve ${fmtInt(candStatewideVotes)} de ${fmtInt(qe10)} ${votesSuffix}).`;
          } else {
            ruleExplanation = `Não eleito(a): Atingiu os requisitos mínimos do partido, mas a legenda não obteve médias suficientes para conquistar mais vagas.`;
          }
        }
      }
      else {
        // --- EPOCH 3 (2022 EM DIANTE): REGRA 80/20 E EXCEÇÃO STF ---
        if (label.includes('QP')) {
          ruleExplanation = `Eleito(a) diretamente (Vaga por QP): O partido conquistou vaga direta e o candidato superou a cláusula de barreira individual de 10% do Quociente Eleitoral (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}; mínimo exigido: ${fmtInt(qe10)}).`;
        } else if (label.includes('MÉDIA') || label.includes('MEDIA') || label.includes('MÃ‰DIA')) {
          if (candStatewideVotes < qe20) {
            ruleExplanation = `Eleito(a) por Média (Decisão STF): Eleito(a) na terceira fase de partilha de sobras (sobras das sobras). Segundo o STF, quando esgotados os candidatos com votação nominal mínima, as vagas remanescentes são distribuídas sem a exigência dos 20% do QE individual, beneficiando a maior média partidária (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}; mínimo de 20% do QE seria ${fmtInt(qe20)}).`;
          } else {
            ruleExplanation = `Eleito(a) por Média (Sobras - Regra 80/20): O partido atingiu mais de 80% do QE (${fmtInt(totalPartyStatewideVotes)} ${votesSuffix}) e o candidato superou os 20% do QE individual (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}; mínimo exigido: ${fmtInt(qe20)}).`;
          }
        } else if (label.includes('ELEITO')) {
          ruleExplanation = `Eleito(a): Candidato obteve ${fmtInt(candStatewideVotes)} ${votesSuffix} e foi eleito pelas regras proporcionais da legislação eleitoral.`;
        } else if (label.includes('SUPLENTE')) {
          if (reached20) {
            ruleExplanation = `Suplente Apto(a) para Sobras: Obteve ${fmtInt(candStatewideVotes)} ${votesSuffix} (superou os 20% do QE, que é ${fmtInt(qe20)}), estando plenamente apto a assumir vaga direta ou sobra, mas ficou na suplência pela ordem de votação interna.`;
          } else if (reached10) {
            ruleExplanation = `Suplente Apto(a) apenas para QP: Obteve ${fmtInt(candStatewideVotes)} ${votesSuffix} (superou os 10% do QE, que é ${fmtInt(qe10)}), porém é inapto para disputar vagas de sobra por não alcançar os 20% do QE (${fmtInt(qe20)}).`;
          } else {
            ruleExplanation = `Suplente Inapto(a) para assumir vaga imediata: Obteve ${fmtInt(candStatewideVotes)} ${votesSuffix}, ficando abaixo dos mínimos individuais previstos em lei (10% do QE para vaga direta, ou seja, ${fmtInt(qe10)} ${votesSuffix}, e 20% para sobras, ou seja, ${fmtInt(qe20)}).`;
          }
        } else {
          if (!partyReached80) {
            ruleExplanation = `Não eleito(a): O partido não alcançou os 80% do Quociente Eleitoral necessários para disputar as vagas remanescentes (obteve ${fmtInt(totalPartyStatewideVotes)} de ${fmtInt(qe80)} ${votesSuffix} exigidos).`;
          } else if (!reached20) {
            ruleExplanation = `Não eleito(a): Não atingiu a barreira de 20% do Quociente Eleitoral individual exigida para disputar as sobras (obteve ${fmtInt(candStatewideVotes)} ${votesSuffix} de ${fmtInt(qe20)} mínimos).`;
          } else {
            ruleExplanation = `Não eleito(a): Atingiu os requisitos mínimos do partido (≥80% QE) e individuais (≥20% QE com ${fmtInt(candStatewideVotes)} ${votesSuffix}), mas a sigla não obteve vagas adicionais suficientes na distribuição de médias.`;
          }
        }
      }
    } else {
      ruleExplanation = `Votos obtidos: ${fmtInt(candStatewideVotes)}. Status oficial: ${label}.`;
    }

    if (candStatewideVotes !== c.votos) {
      const scopeName = isVereador ? 'município' : 'estado';
      ruleExplanation += ` (Nota: Votos exibidos no hover referem-se à soma total no ${scopeName}: ${fmtInt(candStatewideVotes)} votos).`;
    }

    const cleanExplanation = ruleExplanation.replace(/<[^>]*>/g, '');
    
    return `
      <div class="cand-details-card cand-row-hoverable" data-explanation="${escapeHtml(ruleExplanation)}" style="border-bottom:1px solid var(--border); border-left:3px solid ${partyColor}; display:flex; align-items:center; padding:8px 8px; font-size:0.85rem; cursor:help; min-width:0; background:transparent;">
        <span style="color:var(--muted); font-size:0.75rem; width:24px; flex-shrink:0;">${idx + 1}°</span>
        <div style="flex:1; margin-right:8px; overflow:hidden; display:flex; flex-direction:column;">
          <span style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--text);">${toTitleCase(c.nome)}</span>
          <span style="font-size:0.7rem; color:var(--muted); margin-top:1px;">${c.partido}</span>
        </div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:2px; flex-shrink:0;">
          <span style="font-weight:700; color:var(--text);">${fmtInt(c.votos)}</span>
          ${statusBadge}
        </div>
      </div>
    `;
  }).join('');
  
  if (candidateList.length === 0 && totalLegendVotes === 0) {
    listHtml = '<div style="padding:20px; text-align:center; color:var(--muted); font-size:0.85rem;">Nenhum voto registrado nesta seleção.</div>';
  }
  
  let legendHtml = '';
  if (!isGroup && totalLegendVotes > 0) {
    legendHtml = `
      <div style="margin-top:10px; padding:8px 10px; background:var(--surface-2, rgba(255,255,255,0.02)); border-radius:6px; border-left:3px solid ${color}; border:1px solid var(--border);">
        <div style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.5px; color:var(--muted); margin-bottom:4px;">Votos de Legenda</div>
        <div style="font-size:1.1rem; font-weight:700; color:var(--text);">${fmtInt(totalLegendVotes)}</div>
      </div>
    `;
  }
  
  const headerStyle = `border-bottom: 2px solid ${color}; padding-bottom:10px; margin-bottom:10px;`;
  
  let modalOverlay = document.getElementById('coalition-modal-overlay');
  if (!modalOverlay) {
    modalOverlay = document.createElement('div');
    modalOverlay.id = 'coalition-modal-overlay';
    modalOverlay.className = 'info-overlay';
    modalOverlay.style.zIndex = '10000';
    document.body.appendChild(modalOverlay);
  }
  
  modalOverlay.innerHTML = `
    <style>
      #coalition-modal-overlay details summary::-webkit-details-marker {
        display: none !important;
      }
      #coalition-modal-overlay details summary {
        list-style: none !important;
      }
      #coalition-modal-overlay details[open] summary {
        background: rgba(255,255,255,0.03) !important;
      }
    </style>
    <div class="info-modal wide-modal" style="max-width:450px; max-height:85vh; display:flex; flex-direction:column; padding:20px; overflow:hidden; background:var(--surface, #1e1e1e); border:1px solid var(--border); border-radius:12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
      <button class="info-close" style="color:var(--text); background:transparent; border:none; font-size:1.2rem; cursor:pointer;" onclick="document.getElementById('coalition-modal-overlay').classList.remove('visible')">✕</button>
      <div style="${headerStyle}">
        <h3 style="margin:0; font-size:1rem; text-transform:uppercase; letter-spacing:0.5px; color:var(--text);">${titleName}</h3>
      </div>
      
      <div class="proportional-rules-summary" style="margin-bottom:15px; padding:12px; background:var(--surface-2, rgba(255,255,255,0.02)); border-radius:8px; border:1px solid var(--border); font-size:0.8rem; flex-shrink:0;">
        <div style="font-weight:700; font-size:0.85rem; margin-bottom:8px; display:flex; align-items:center; gap:6px; color:var(--accent);">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          Desempenho da Sigla e Regras Proporcionais
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:10px;">
          <div>
            <span style="color:var(--muted);">Votos Totais da Sigla:</span><br>
            <strong style="color:var(--text);">${fmtInt(totalPartyVotes)}</strong> <span style="font-size:0.7rem; color:var(--muted);">(${fmtPct(totalPartyVotes / totalValidosDisplay)})</span>
          </div>
          <div>
            <span style="color:var(--muted);">Quociente Eleitoral (QE):</span><br>
            <strong style="color:var(--text);">${qeValue > 0 ? fmtInt(qeValue) : 'N/A'}</strong>
          </div>
        </div>
        <div style="border-top:1px solid var(--border); padding-top:8px; font-size:0.75rem; display:flex; flex-direction:column; gap:4px;">
          ${qeExplanationHtml}
        </div>
      </div>
      
      <div style="font-size:0.75rem; color:var(--muted); margin-bottom:6px; text-transform:uppercase; letter-spacing:0.5px; font-weight:600; flex-shrink:0;">Candidatos (passe o cursor para ver a regra individual)</div>
      <div style="flex:1; overflow-y:auto; padding-right:4px; padding-bottom:8px; scrollbar-gutter:stable;">
        ${listHtml}
      </div>
      ${legendHtml}
    </div>
  `;
  
  setTimeout(() => modalOverlay.classList.add('visible'), 10);
  modalOverlay.onclick = (e) => {
    if (e.target === modalOverlay) modalOverlay.classList.remove('visible');
  };
}

// =========================================================
// 2. MODAL OTIMIZADO COM CORREÃ‡ÃƒO DE STATUS (RESOLVIDO)
// =========================================================

function openCoalitionModal(composition, titleName, color, cargo, electedCount, isGroup = false) {
  // 1. TRATAMENTO DE FEDERAÃ‡Ã•ES E PARSING
  let targetParties = [];
  const compUpper = composition.toUpperCase();

  const matchParenthesis = composition.match(/\((.*?)\)/);
  if (matchParenthesis) {
    targetParties = matchParenthesis[1].split('/').map(s => s.trim().toUpperCase());
  } else if (STATE.currentElectionYear === '2022') {
    if (compUpper.includes('FE BRASIL') || compUpper.includes('BRASIL DA ESPERANÇA')) {
      targetParties = ['PT', 'PC DO B', 'PV', 'PCDOB'];
    } else if (compUpper.includes('PSDB') && compUpper.includes('CIDADANIA')) {
      targetParties = ['PSDB', 'CIDADANIA'];
    } else if (compUpper.includes('PSOL') && compUpper.includes('REDE')) {
      targetParties = ['PSOL', 'REDE'];
    } else {
      targetParties = composition.split('/').map(s => s.trim().toUpperCase());
    }
  } else {
    targetParties = composition.split('/').map(s => s.trim().toUpperCase());
  }
  targetParties = targetParties.map(p => normalizePartyAlias(p));

  // 2. AGREGAR CANDIDATOS (Realizado sob demanda para nÃ£o travar o mapa)
  const typeKey = (cargo === 'deputado_federal') ? 'f' : 'e';
  const aggCandidates = {};
  const processedKeys = new Set();

  // Garante que o lookup existe (caso o modal seja aberto sem passar pelo render anterior, o que Ã© raro mas possÃ­vel)
  if (!STATE.deputyLookup || STATE.deputyLookupCargo !== cargo) {
    // Fallback rÃ¡pido se nÃ£o existir o cache
    const geojson = currentDataCollection[cargo];
    if (geojson && geojson.features) {
      STATE.deputyLookup = new Map();
      STATE.deputyLookupCargo = cargo;
      geojson.features.forEach(f => {
        const p = f.properties;
        const id = getFeatureSelectionId(p);
        const z = getProp(p, 'nr_zona');
        const l = getProp(p, 'nr_locvot') || getProp(p, 'nr_local_votacao');
        const m = getProp(p, 'cd_localidade_tse') || getProp(p, 'CD_MUNICIPIO');
        if (id && z && l && m) STATE.deputyLookup.set(id, `${parseInt(z)}_${parseInt(m)}_${parseInt(l)}`);
      });
    }
  }

  const ids = Array.from(selectedLocationIDs);
  for (let i = 0; i < ids.length; i++) {
    const key = STATE.deputyLookup ? STATE.deputyLookup.get(ids[i]) : null;
    if (!key || processedKeys.has(key)) continue;
    processedKeys.add(key);

    const res = STATE.deputyResults[key];
    if (res && res[typeKey]) {
      for (const [candId, v] of Object.entries(res[typeKey])) {
        if (candId === '95' || candId === '96') continue;

        const meta = STATE.deputyMetadata[candId];
        if (!meta) continue;

        const candName = meta[0];
        let candParty = meta[1] ? meta[1].toUpperCase() : '';
        candParty = normalizePartyAlias(candParty);
        const candStatus = meta[2] || '';

        // Resolve generic party names for legend votes
        if (candParty.startsWith('PARTIDO ') && STATE._partyPrefixCache) {
          const prefix = candId.substring(0, 2);
          candParty = (STATE._partyPrefixCache[prefix] || candParty).toUpperCase();
          candParty = normalizePartyAlias(candParty);
        }

        if (targetParties.includes(candParty)) {
          const vi = typeof v === 'string' ? parseInt(v.replace(/\./g, ''), 10) : parseInt(v);
          if (!aggCandidates[candId]) {
            aggCandidates[candId] = {
              nome: candName,
              partido: candParty,
              status: candStatus,
              votos: 0,
              isLegenda: candId.length <= 2
            };
          }
          aggCandidates[candId].votos += vi;
        }
      }
    }
  }

  // Separate legend votes from real candidates
  const legendVotes = [];
  const realCandidates = [];
  Object.values(aggCandidates).forEach(c => {
    if (c.isLegenda) legendVotes.push(c);
    else realCandidates.push(c);
  });

  const candidateList = realCandidates.sort((a, b) => {
    const diff = b.votos - a.votos;
    if (diff !== 0) return diff;
    return a.nome.localeCompare(b.nome);
  });

  const totalLegendVotes = legendVotes.reduce((sum, l) => sum + l.votos, 0);
  const forceNotElected = (electedCount === 0);

  renderProportionalModalUI(
    composition,
    titleName,
    color,
    cargo,
    electedCount,
    isGroup,
    targetParties,
    legendVotes,
    candidateList,
    totalLegendVotes,
    forceNotElected
  );
}

// --- OTIMIZAÃ‡ÃƒO: CACHE DE VENCEDORES ---
function precomputeDeputyWinners() {
  // Limpa cache anterior
  STATE.deputyCache = {};

  console.time("Precompute Winners");

  // Itera sobre todos os locais carregados em STATE.deputyResults
  for (const [locId, data] of Object.entries(STATE.deputyResults)) {
    // Processa Federal ('f') e Estadual ('e')
    ['f', 'e'].forEach(typeKey => {
      const votes = data[typeKey];
      if (!votes) return;
      const metaStore = STATE.deputyMetadataByType?.[typeKey] || STATE.deputyMetadata || {};

      let maxV = -1;
      let winner = null;
      let total = 0;

      const partyVotes = {};
      let maxPartyV = -1;
      let winningParty = null;

      // Loop Ãºnico para achar vencedor e somar partidos
      for (const [cand, v] of Object.entries(votes)) {
        const vi = parseInt(v);

        // Ignora brancos (95) e nulos (96) para cÃ¡lculo de vitÃ³ria nominal
        if (cand !== '95' && cand !== '96') {
          total += vi;

          // Vencedor Individual
          if (vi > maxV) {
            maxV = vi;
            winner = cand;
          }

          // Soma por Partido
          const meta = metaStore[cand];
          if (meta) {
            const party = meta[1]; // Sigla do partido
            partyVotes[party] = (partyVotes[party] || 0) + vi;
          }
        }
      }

      // Descobre Partido Vencedor
      for (const [party, v] of Object.entries(partyVotes)) {
        if (v > maxPartyV) {
          maxPartyV = v;
          winningParty = party;
        }
      }

      // Salva no Cache Global
      // Chave ex: "123_456_789_f" (zona_mun_loc_tipo)
      const cacheKey = `${locId}_${typeKey}`;
      STATE.deputyCache[cacheKey] = {
        total: total,
        winner: winner,
        winnerVotes: maxV,
        winningParty: winningParty,
        votesMap: votes // Guarda referÃªncia para uso futuro se precisar
      };
    });
  }

  console.timeEnd("Precompute Winners");
}

// ====== EXPORTAÃ‡Ã•ES PARA ISE.JS ======
// const/let/function nÃ£o criam propriedades em window automaticamente.
// ise.js precisa acessar estes objetos para renderizar os grÃ¡ficos do ISE.
function renderDeputyResults(cargo) {
  if (typeof syncDeputyDataForCargo === 'function') {
    syncDeputyDataForCargo(cargo);
  }
  STATE.deputyViewMode = 'party';
  STATE.deputyPartyViewMode = 'federation';
  renderDeputyPartyResults(cargo);
}

function renderVereadorResults(cargo) {
  STATE.vereadorViewMode = 'party';
  STATE.vereadorPartyViewMode = 'coalition';
  renderVereadorPartyResults(cargo);
}

function renderDeputyPartyResults(cargo) {
  initializeCandidateColorUI();
  closeCandidateColorPopoverOnViewChange();
  if (typeof syncDeputyDataForCargo === 'function') {
    syncDeputyDataForCargo(cargo);
  }

  const payload = aggregateProportionalGroupsForSelection(cargo);
  // Vagas em jogo e Quociente eleitoral foram removidos daqui por serem
  // redundantes com o container superior (proportional-top-bar) acima dos resultados.
  const extraMetrics = '';

  const turnoutStats = getTurnoutStatsForSelection(null, cargo, '1T', payload.comparecimento);
  dom.resultsSubtitle.textContent = `${(payload.groups || []).length} listas classificadas`;
  renderProportionalExpandableList(payload, {
    extraMetrics,
    comparecimento: payload.comparecimento,
    brancos: payload.brancos,
    nulos: payload.nulos,
    ratio: turnoutStats.ratio
  });
}

function renderVereadorPartyResults(cargo) {
  initializeCandidateColorUI();
  closeCandidateColorPopoverOnViewChange();

  const payload = aggregateProportionalGroupsForSelection(cargo);
  // Vagas em jogo e Quociente eleitoral foram removidos daqui por serem
  // redundantes com o container superior (proportional-top-bar) acima dos resultados.
  const extraMetrics = '';

  const turnoutStats = getTurnoutStatsForSelection(null, cargo, '1T', payload.comparecimento);
  dom.resultsSubtitle.textContent = `${(payload.groups || []).length} listas classificadas`;
  renderProportionalExpandableList(payload, {
    extraMetrics,
    comparecimento: payload.comparecimento,
    brancos: payload.brancos,
    nulos: payload.nulos,
    ratio: turnoutStats.ratio
  });
}

// Mostra/esconde o botão "Mostrar Regras" e sincroniza seu rótulo/estado com STATE.showProportionalRules.
function updateToggleRulesButtonVisibility(visible) {
  if (!dom.btnToggleRules) return;
  dom.btnToggleRules.style.display = visible ? '' : 'none';
  if (!visible) return;
  const active = STATE.showProportionalRules === true;
  dom.btnToggleRules.classList.toggle('active', active);
  dom.btnToggleRules.textContent = active ? 'Ocultar Regras' : 'Mostrar Regras';
}

// --- SISTEMA DE TOOLTIP CUSTOMIZADO E INTEGRADO ---
function ensureCustomCandTooltip() {
  let tooltip = document.getElementById('cand-custom-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'cand-custom-tooltip';
    tooltip.style.cssText = `
      position: fixed;
      display: none;
      pointer-events: none;
      z-index: 100000;
      background: rgba(24, 24, 27, 0.95);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 0px;
      padding: 10px 12px;
      max-width: 320px;
      color: #f4f4f5;
      font-family: 'Libre Franklin', system-ui, -apple-system, sans-serif;
      font-size: 0.75rem;
      line-height: 1.45;
      box-shadow: none;
      transition: opacity 0.12s cubic-bezier(0.4, 0, 0.2, 1), transform 0.12s cubic-bezier(0.4, 0, 0.2, 1);
      opacity: 0;
      transform: scale(0.96);
    `;
    document.body.appendChild(tooltip);
    
    // Add global event delegation listeners
    document.addEventListener('mouseover', (e) => {
      const el = e.target.closest('.cand-row-hoverable');
      if (!el) return;
      
      const exp = el.getAttribute('data-explanation');
      if (!exp) return;
      
      tooltip.innerHTML = formatTooltipText(exp);
      tooltip.style.display = 'block';
      
      // Force reflow
      tooltip.offsetHeight;
      tooltip.style.opacity = '1';
      tooltip.style.transform = 'scale(1)';
      
      positionTooltip(e, tooltip);
    });
    
    document.addEventListener('mousemove', (e) => {
      const el = e.target.closest('.cand-row-hoverable');
      if (!el) {
        if (tooltip.style.opacity === '1') {
          tooltip.style.opacity = '0';
          tooltip.style.transform = 'scale(0.96)';
          setTimeout(() => {
            if (tooltip.style.opacity === '0') tooltip.style.display = 'none';
          }, 120);
        }
        return;
      }
      positionTooltip(e, tooltip);
    });
    
    document.addEventListener('mouseout', (e) => {
      const el = e.target.closest('.cand-row-hoverable');
      if (!el) return;
      
      const related = e.relatedTarget;
      if (related && related.closest('.cand-row-hoverable') === el) return;
      
      tooltip.style.opacity = '0';
      tooltip.style.transform = 'scale(0.96)';
      setTimeout(() => {
        if (tooltip.style.opacity === '0') tooltip.style.display = 'none';
      }, 120);
    });
  }
}

function formatTooltipText(exp) {
  const colonIdx = exp.indexOf(':');
  if (colonIdx === -1) {
    return `<div style="font-weight: 500; color: #fff;">${exp}</div>`;
  }
  
  const title = exp.substring(0, colonIdx).trim();
  const desc = exp.substring(colonIdx + 1).trim();
  
  const normalized = exp.toUpperCase();
  let isElected = false;
  if (normalized.includes('INAPTO') || normalized.includes('NAO ELEITO') || normalized.includes('NÃO ELEITO') || normalized.includes('SUPLENTE')) {
    isElected = false;
  } else if (normalized.includes('QP') || normalized.includes('MEDIA') || normalized.includes('MÉDIA') || normalized.includes('ELEITO') || normalized.includes('ELEITA') || normalized.includes('ELEITO(A)')) {
    isElected = true;
  }
  
  const badgeColor = isElected ? 'var(--ok, #22c55e)' : 'var(--err, #ef4444)';
  
  let mainDesc = desc;
  let noteHtml = '';
  const noteIdx = desc.indexOf('(Nota:');
  if (noteIdx !== -1) {
    mainDesc = desc.substring(0, noteIdx).trim();
    const noteText = desc.substring(noteIdx).replace(/[()]/g, '').trim();
    noteHtml = `
      <div style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed rgba(255, 255, 255, 0.08); font-size: 0.65rem; color: #a1a1aa; font-style: italic;">
        ${noteText}
      </div>
    `;
  }
  
  return `
    <div style="display: flex; flex-direction: column; gap: 4px;">
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="font-weight: 700; font-size: 0.72rem; color: ${badgeColor};">
          ${title}
        </span>
      </div>
      <div style="font-size: 0.72rem; color: #e4e4e7; font-weight: 400; line-height: 1.4;">
        ${mainDesc}
      </div>
      ${noteHtml}
    </div>
  `;
}

function positionTooltip(e, tooltip) {
  const gap = 14;
  let x = e.clientX + gap;
  let y = e.clientY + gap;
  
  const tooltipWidth = tooltip.offsetWidth;
  const tooltipHeight = tooltip.offsetHeight;
  const winWidth = window.innerWidth;
  const winHeight = window.innerHeight;
  
  if (x + tooltipWidth > winWidth - 10) {
    x = e.clientX - tooltipWidth - gap;
  }
  if (y + tooltipHeight > winHeight - 10) {
    y = e.clientY - tooltipHeight - gap;
  }
  
  x = Math.max(10, x);
  y = Math.max(10, y);
  
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
}

window.STATE = STATE;
window.getProp = getProp;
window.parseCandidateKey = parseCandidateKey;
window.selectedLocationIDs = selectedLocationIDs;
window.getColorForCandidate = typeof getColorForCandidate === 'function' ? getColorForCandidate : null;
window.PARTY_COLORS = PARTY_COLORS;
window.PARTY_COLOR_OVERRIDES = PARTY_COLOR_OVERRIDES;
Object.defineProperty(window, 'currentTurno', { get() { return currentTurno; }, configurable: true });
Object.defineProperty(window, 'currentCargo', { get() { return currentCargo; }, configurable: true });
window.updateSelectionUI = updateSelectionUI;
