function updateSelectionUI(isFilterAggregation = false) {
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

  // --- LÃ“GICA DE TÍTULO ATUALIZADA ---
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
      dom.resultsSubtitle.textContent = `${bairro} • Zona: ${zona}`;
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
      dom.resultsSubtitle.textContent = `${nomeCidade} • ${bairro} • Zona: ${zona}`;
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

  // Call ISE Panel update
  if (typeof window.updateISEPanel === 'function') {
    window.updateISEPanel(currentLayer, currentCargo, currentTurno);
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
                    <h5 style="margin:0; font-size:0.85rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${winnerWithInaptos.nome}</h5>
                    <p style="margin:0; font-size:0.75rem; color:var(--muted);">${winnerWithInaptos.partido}</p>
                    <strong style="display:block; margin-top:4px; color:var(--accent-2); font-size:0.8rem;">${fmtPct(getPct(winnerWithInaptos.votos, totalValidosComInaptos))}</strong>
                </div>
                <div class="dual-item" tabindex="0" role="button" 
                     data-cargo="${office}" data-turno="${turnoKey}" data-filter-inaptos="true"
                     data-status="${vencedorSemInaptos.status}">
                    <span style="font-size:0.65rem; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px; display:block;">Sem Inaptos</span>
                    <h5 style="margin:0; font-size:0.85rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${vencedorSemInaptos.nome}</h5>
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
                <h5>${vencedorSemInaptos.nome}</h5>
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
  dom.turnTabs.innerHTML = '';
  if (STATE.currentElectionType === 'geral' && STATE.currentMapMode === 'municipios') return;
  const has1T = (STATE.candidates[currentCargo]?.['1T'] || []).length > 0;
  let has2T = STATE.dataHas2T[currentCargo] || false;

  // CORREÇÃO AQUI: Verificação mais robusta para o 2º Turno
  if (has2T && props) {
    // 1. Tenta pegar o total explícito do arquivo
    let totalVotos2T = ensureNumber(getProp(props, 'Total_Votos_Validos 2T'));

    // 2. Se for zero (ou não existir), calcula somando os candidatos manualmente
    if (totalVotos2T === 0) {
      const { totalValidos } = getVotosValidos(props, currentCargo, '2T', STATE.filterInaptos);
      totalVotos2T = totalValidos;
    }

    // 3. Se ainda assim for zero, aí sim escondemos a aba
    if (totalVotos2T === 0) {
      // Verificação extra: se tiver brancos ou nulos no 2T, mostra a aba mesmo sem votos válidos nominais
      const brancos = ensureNumber(getProp(props, 'Votos_Brancos 2T'));
      const nulos = ensureNumber(getProp(props, 'Votos_Nulos 2T'));
      if ((brancos + nulos) === 0) {
        has2T = false;
      }
    }
  }

  // Lógica de troca automática de aba
  if (currentTurno === 2 && !has2T) currentTurno = 1;
  // Se não tem 1T (ex: eleição que só tem dados de 2T, raro mas possível) forçamos 2
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
  if (status === '2° TURNO' || status === '2º TURNO') return `<span class="status-badge segundo-turno"><svg><use href="#svg-arrow" /></svg> 2º Turno</span>`;
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
        <button type="button" class="button ghost" data-color-action="reset">Cor padrão</button>
        <button type="button" class="button primary" data-color-action="apply">Aplicar</button>
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
  });
  hexInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyCandidateColorPopover();
    } else if (e.key === 'Escape') {
      closeCandidateColorPopover();
    }
  });

  nativeInput.addEventListener('input', () => {
    setCandidateColorPopoverValue(nativeInput.value.toUpperCase());
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

function applyCandidateColorPopover() {
  const popover = ensureCandidateColorPopover();
  const hexInput = popover.querySelector('#candidateColorHexInput');
  const color = normalizeCandidateHexColor(hexInput.value);
  if (!color || !activeCandidateColorTarget?.partido) {
    showToast('Digite uma cor hexadecimal válida.', 'warn', 2200);
    return;
  }
  setCandidateColor(activeCandidateColorTarget.partido, color);
  closeCandidateColorPopover();
}

function resetCandidateColorPopover() {
  if (!activeCandidateColorTarget?.partido) return;
  CUSTOM_PARTY_COLORS.delete(getNormalizedPartyColorKey(activeCandidateColorTarget.partido));
  updateSelectionUI(STATE.isFilterAggregationActive);
  if (currentLayer) currentLayer.setStyle(getFeatureStyle);
  closeCandidateColorPopover();
}

function renderResultsPanel(props, cargo) {
  initializeCandidateColorUI();
  closeCandidateColorPopoverOnViewChange();

  // Limpa TODOS os toggles de navegacao ao trocar de cargo (clean slate)
  ['deputy-view-toggle', 'party-view-toggle', 'vereador-view-toggle', 'vereador-party-view-toggle'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });

  if (!props || Object.keys(props).length === 0) {
    dom.resultsContent.innerHTML = `<p style="color:var(--muted)">Sem dados para esta seleção.</p>`;
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
  const grid = document.createElement('div');
  grid.className = 'grid';

  results.forEach(r => {
    if (r.votos === 0 && results.length > 2) return;

    const div = document.createElement('div');
    div.className = 'cand';
    div.dataset.status = r.status;

    const sw = getColorForCandidate(r.nome, r.partido);
    const safeNome = escapeHtml(r.nome);
    const safePartido = escapeHtml(r.partido);
    div.innerHTML = `
      <div class="cand-indicator-wrapper">
        ${renderCandidateColorControl(r.nome, r.partido, sw, true)}
      </div>
      <div class="cand-name-wrapper cand-name-wrapper-stack">
        <div class="cand-name" title="${safeNome}">${safeNome}</div>
        <div class="cand-party" title="${safePartido}">${safePartido}</div>
        <div class="cand-status-row">
          ${getStatusBadge(r.status)}
        </div>
      </div>
      <div class="cand-bar-wrapper cand-bar-wrapper-major">
        <div class="cand-bar-fill" style="background:${sw}; width:${Math.max(0, Math.min(100, r.pct * 100))}%;"></div>
        <div class="cand-votos">${fmtInt(r.votos)}</div>
        <div class="cand-pct">${fmtPct(r.pct)}</div>
      </div>
    `;
    grid.appendChild(div);
  });
  dom.resultsContent.appendChild(grid);

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
  const participacaoHtml = turnoutStats.ratio !== null
    ? `<div class="metric-item"${isEstadoCompleto ? ' style="opacity:0.55;"' : ''}>
        <span>Participação${isEstadoCompleto ? ' *' : ''}</span>
        <strong>${fmtPct(turnoutStats.ratio)}</strong>
      </div>`
    : '';

  const avisoHtml = isEstadoCompleto ? `
    <div class="metric-item" style="grid-column:1/-1; border-left:3px solid #f59e0b; background:rgba(245,158,11,0.07); padding:6px 10px; border-radius:4px; margin-bottom:2px;">
      <span style="font-size:0.72rem; color:#f59e0b; line-height:1.4;">
        &#9888;&#65039; <strong>Aten&ccedil;&atilde;o:</strong> Os votos por candidato refletem o total real (${fmtInt(totalBase)} nominais). Comparecimento, brancos e nulos s&atilde;o parciais &mdash; nem todos os locais est&atilde;o mapeados.
      </span>
    </div>` : '';

  dom.resultsMetrics.innerHTML = `
    <div class="metrics-grid">
      ${avisoHtml}
      <div class="metric-item"${isEstadoCompleto ? ' style="border-left:3px solid var(--accent);"' : ''}>
        <span>Votos Válidos (Nominais)</span>
        <strong>${fmtInt(totalBase)}</strong>
      </div>
      <div class="metric-item"${isEstadoCompleto ? ' style="opacity:0.55;"' : ''}>
        <span>Comparecimento${isEstadoCompleto ? ' *' : ''}</span>
        <strong>${fmtInt(comparecimento)}</strong>
      </div>
      <div class="metric-item"${isEstadoCompleto ? ' style="opacity:0.55;"' : ''}>
        <span>Brancos${isEstadoCompleto ? ' *' : ''}</span>
        <strong>${fmtInt(brancos)} (${fmtPct(comparecimento > 0 ? brancos / comparecimento : 0)})</strong>
      </div>
      <div class="metric-item"${isEstadoCompleto ? ' style="opacity:0.55;"' : ''}>
        <span>Nulos${isEstadoCompleto ? ' *' : ''}</span>
        <strong>${fmtInt(nulos)} (${fmtPct(comparecimento > 0 ? nulos / comparecimento : 0)})</strong>
      </div>
      ${participacaoHtml}
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

  const usarResultadosCompletos = shouldUseGeneralDeputyJsonTotals(cargo) || (
    STATE.isFilterAggregationActive &&
    STATE.currentElectionType === 'geral' &&
    !hasRegionalScopeFilters() &&
    currentCidadeFilter === 'all' &&
    selectedLocationIDs.size > 100
  );

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
          <span>Participação${isParcialDeputy ? ' *' : ''}</span>
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
      } else if (st.includes('NÃO ELEITO') || st.includes('NAO ELEITO') || st.includes('NÃO ELEITO')) {
        statusHtml = `<span class="status-badge nao-eleito"><svg><use href="#svg-x" /></svg> Não Eleito</span>`;
        simpleStatus = 'NÃO ELEITO';
      } else if (st.includes('ELEITO') || st.includes('QP') || st.includes('MÉDIA')) {
        statusHtml = `<span class="status-badge eleito"><svg><use href="#svg-check" /></svg> ${r.status}</span>`;
        simpleStatus = 'ELEITO';
      } else if (st.includes('SUPLENTE')) {
        statusHtml = `<span class="status-badge suplente">Suplente</span>`;
        simpleStatus = 'SUPLENTE';
      }

      const sw = getColorForCandidate(r.nome, r.partido);
      const safeNome = escapeHtml(r.nome);
      const safePartyAndId = escapeHtml(`${r.partido} • ${r.id}`);

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
  paginator.textContent = `Página 1 de ${totalPages} (${nominais.length} candidatos)`;

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
    paginator.textContent = `Página ${pageIndex + 1} de ${totalPages} (${nominais.length} candidatos)`;
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
        &#9888;&#65039; <strong>Aten&ccedil;&atilde;o:</strong> Totais parciais &mdash; nem todos os locais est&atilde;o mapeados.
      </span>
    </div>` : '';

  dom.resultsMetrics.innerHTML = `
      <div class="metrics-grid">
        ${avisoDeputyHtml}
        <div class="metric-item"${usarResultadosCompletos ? ' style="border-left:3px solid var(--accent);"' : ''}>
          <span>Votos Válidos (Soma)</span>
          <strong>${fmtInt(totalValidos)}</strong>
        </div>
        <div class="metric-item"${isParcialDeputy ? ' style="opacity:0.55;"' : ''}>
          <span>Comparecimento${isParcialDeputy ? ' *' : ''}</span>
          <strong>${fmtInt(comparecimento)}</strong>
        </div>
        <div class="metric-item"${isParcialDeputy ? ' style="opacity:0.55;"' : ''}>
          <span>Brancos${isParcialDeputy ? ' *' : ''}</span>
          <strong>${fmtInt(brancos)}</strong>
        </div>
        <div class="metric-item"${isParcialDeputy ? ' style="opacity:0.55;"' : ''}>
          <span>Nulos${isParcialDeputy ? ' *' : ''}</span>
          <strong>${fmtInt(nulos)}</strong>
        </div>
        ${participacaoHtml}
      </div>
    `;
}

function setCandidateColor(nome, novaCor) {
  const partyKey = getNormalizedPartyColorKey(nome);
  if (!partyKey) return;
  CUSTOM_PARTY_COLORS.set(partyKey, novaCor);
  updateSelectionUI(STATE.isFilterAggregationActive);
  if (currentLayer) currentLayer.setStyle(getFeatureStyle);
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

  // --- HELPER DE CÁLCULO ---
  const calcPct = (props, type, mode) => {
    // Validação de chave rigorosa
    const isValidKey = (k, v) => {
      if (typeof v !== 'number') return false;
      const up = k.toUpperCase();
      // Ignora chaves de porcentagem ou totais explícitos para evitar contagem dupla
      if (up.startsWith('PCT') || up.includes('_PCT') || up.includes('PERCENT') || up.includes('(%)')) return false;
      if (up.startsWith('TOTAL') || up.startsWith('SOMA') || up === 'ELEITORES_APTOS') return false;
      return true;
    };

    // 1. Tentar pegar valor direto se for Pct (Legacy/Raça/Saneamento)
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

        // Se detectou uma idade válida (filtro amplo para pegar tudo e somar no total)
        if (startAge >= 10 && startAge < 150) {
          totalAge += val;
          foundAny = true;

          // Distribuição nos buckets
          if (startAge >= 16 && startAge <= 24) buckets['16-24'] += val;
          else if (startAge >= 25 && startAge <= 34) buckets['25-34'] += val;
          else if (startAge >= 35 && startAge <= 44) buckets['35-44'] += val;
          else if (startAge >= 45 && startAge <= 59) buckets['45-59'] += val;
          else if (startAge >= 60 && startAge <= 74) buckets['60-74'] += val;
          else if (startAge >= 75) buckets['75-100'] += val;
        }
      }

      // --- FILTRO DE RUÍDO ESTATÍSTICO ---
      // Se a soma das pessoas for muito baixa (ex: < 15), a porcentagem é irrelevante/ruído.
      // Isso evita que um local com 1 pessoa de 18 anos gere "100%" e estrague a barra.
      if (!ageAggregate.hasData || ageAggregate.total < 15) return null;

      num = ageAggregate.buckets[mode] || 0;
      den = ageAggregate.total;

      // Auto-correção matemática (garante que bucket nunca é maior que total)
      if (num > den) den = num;
    }
    // --- GÊNERO ---
    else if (type === 'genero') {
      const h = ensureNumber(props['Homens'] || props['HOMENS'] || props['MASCULINO'] || props['Masculino'] || 0);
      const m = ensureNumber(props['Mulheres'] || props['MULHERES'] || props['FEMININO'] || props['Feminino'] || 0);

      den = h + m;
      if (den < 10) return null; // Filtro de ruído
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
        else if (uk.includes('VIUVO') || uk.includes('VIÚVO')) acc.viu += v;
        else if (uk.includes('SEPARADO')) acc.sep += v;
      }
      den = acc.sol + acc.cas + acc.div + acc.viu + acc.sep;
      if (den < 10) return null; // Filtro de ruído

      if (mode === 'Solteiro') num = acc.sol;
      else if (mode === 'Casado') num = acc.cas;
      else if (mode === 'Divorciado') num = acc.div;
      else if (mode === 'Viúvo') num = acc.viu;
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
        else if (uk.includes('LÊ E ESCREVE') || uk.includes('LE E ESCREVE')) acc.le += v;
        else if (uk.includes('FUND') && uk.includes('INCOMP')) acc.fi += v;
        else if (uk.includes('FUND') && uk.includes('COMP')) acc.fc += v;
        else if (uk.includes('MÉDIO') || uk.includes('MEDIO')) {
          if (uk.includes('INCOMP')) acc.mi += v;
          else if (uk.includes('COMP')) acc.mc += v;
        }
        else if (uk.includes('SUPERIOR')) {
          if (uk.includes('INCOMP')) acc.si += v;
          else if (uk.includes('COMP')) acc.sc += v;
        }
      }

      den = Object.values(acc).reduce((a, b) => a + b, 0);
      if (den < 10) return null; // Filtro de ruído

      if (mode.includes('Analfabeto')) num = acc.ana;
      else if (mode.includes('Lê')) num = acc.le;
      else if (mode.includes('Fund. Incomp')) num = acc.fi;
      else if (mode.includes('Fund. Completo')) num = acc.fc;
      else if (mode.includes('Médio Incomp')) num = acc.mi;
      else if (mode.includes('Médio Completo')) num = acc.mc;
      else if (mode.includes('Superior Incompleto')) num = acc.si;
      else if (mode.includes('Superior Completo')) num = acc.sc;
    }

    if (den === 0) return 0;

    // Trava matemática final
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
      // Ignora null (que agora retorna quando a amostra é pequena demais)
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
  const normalized = String(status || '').toUpperCase();
  if (normalized.includes('INAPTO')) return { label: 'Inapto', badgeClass: 'inapto', rowClass: 'prop-cand-inapto', elected: false };
  if (normalized.includes('NÃO ELEITO') || normalized.includes('NAO ELEITO')) return { label: 'Não eleito', badgeClass: 'nao-eleito', rowClass: 'prop-cand-not-elected', elected: false };
  if (normalized.includes('QP')) return { label: 'Eleito por QP', badgeClass: 'eleito', rowClass: 'prop-cand-elected', elected: true };
  if (normalized.includes('MÉDIA') || normalized.includes('MEDIA')) return { label: 'Eleito por média', badgeClass: 'eleito', rowClass: 'prop-cand-elected', elected: true };
  if (normalized.includes('ELEITO')) return { label: 'Eleito', badgeClass: 'eleito', rowClass: 'prop-cand-elected', elected: true };
  if (normalized.includes('SUPLENTE')) return { label: 'Suplente', badgeClass: 'suplente', rowClass: 'prop-cand-not-elected', elected: false };
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
  const typeKey = isVereador ? 'v' : (cargo === 'deputado_federal' ? 'f' : 'e');
  const resultStore = isVereador ? (STATE.vereadorResults || {}) : (STATE.deputyResults || {});
  const metaStore = isVereador ? (STATE.vereadorMetadata || {}) : (STATE.deputyMetadata || {});
  const prefixCache = isVereador ? (STATE._vereadorPartyPrefixCache || {}) : (STATE._partyPrefixCache || {});
  const inaptos = isVereador ? (STATE.inaptos['vereador_ord']?.['1T'] || []) : (STATE.inaptos[cargo]?.['1T'] || []);
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
      if (STATE.filterInaptos && inaptos.includes(candidateId)) return;

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

  if (!isVereador && (shouldUseGeneralDeputyJsonTotals(cargo) || (
    STATE.isFilterAggregationActive &&
    STATE.currentElectionType === 'geral' &&
    !hasRegionalScopeFilters() &&
    currentCidadeFilter === 'all' &&
    selectedLocationIDs.size > 100
  ))) {
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
    return {
      ...group,
      color: colorForParty(dominantParty),
      dominantParty,
      candidates,
      electedCount
    };
  }).sort((a, b) => b.votes - a.votes);

  const totalValidos = groupsPayload.totalVotes || 0;
  dom.resultsContent.innerHTML = '';

  if (!groups.length) {
    dom.resultsContent.innerHTML = '<p style="color:var(--muted)">Sem votos válidos para esta seleção.</p>';
    return;
  }

  const container = document.createElement('div');
  container.className = 'prop-results-container';

  groups.forEach((group) => {
    const pct = totalValidos > 0 ? (group.votes / totalValidos) : 0;
    const item = document.createElement('div');
    item.className = 'party-group';

    const normalizedComposition = String(group.composition || '').replace(/\s+/g, '').toUpperCase();
    const normalizedName = String(group.name || '').replace(/\s+/g, '').toUpperCase();
    const compositionHtml = group.isGroup && normalizedComposition && normalizedComposition !== normalizedName
      ? `<div class="party-result-subtitle">${escapeHtml(group.composition)}</div>`
      : '';
    const electedBadge = group.electedCount > 0
      ? `<span class="party-mandate-badge">${group.electedCount} eleito${group.electedCount > 1 ? 's' : ''}</span>`
      : '';

    const header = document.createElement('div');
    header.className = 'party-header';
    header.innerHTML = `
      <div class="party-header-left">
        <span class="party-header-arrow">▶</span>
        <div class="cand-indicator" style="background:${group.color}"></div>
        <div class="party-header-info">
          <span class="party-header-name" title="${escapeHtml(group.name)}">${escapeHtml(group.name)}</span>
          ${compositionHtml}
          ${electedBadge}
        </div>
      </div>
      <div class="party-header-right">
        <div class="cand-bar-wrapper">
          <div class="cand-bar-fill" style="background:${group.color}; width:${pct * 100}%;"></div>
          <div class="cand-votos">${fmtInt(group.votes)}</div>
          <div class="cand-pct">${fmtPct(pct)}</div>
        </div>
      </div>
    `;

    const list = document.createElement('div');
    list.className = 'party-candidates';
    list.style.display = 'none';

    group.candidates.forEach((candidate) => {
      const row = document.createElement('div');
      row.className = `prop-cand ${candidate.statusInfo.rowClass}`;
      row.innerHTML = `
        <span class="prop-cand-name" title="${escapeHtml(candidate.nome)}">${escapeHtml(candidate.nome)}</span>
        <span class="prop-cand-votes">${fmtInt(candidate.votos)}</span>
        <span class="prop-cand-pct">${fmtPct(totalValidos > 0 ? candidate.votos / totalValidos : 0)}</span>
        <span class="status-badge ${candidate.statusInfo.badgeClass}">${candidate.statusInfo.label}</span>
      `;
      list.appendChild(row);
    });

    header.addEventListener('click', () => {
      const isOpen = list.style.display !== 'none';
      list.style.display = isOpen ? 'none' : 'block';
      item.classList.toggle('party-group-open', !isOpen);
      const arrow = header.querySelector('.party-header-arrow');
      if (arrow) arrow.textContent = isOpen ? '▶' : '▼';
    });

    item.appendChild(header);
    item.appendChild(list);
    container.appendChild(item);
  });

  dom.resultsContent.appendChild(container);

  const extraMetrics = metrics.extraMetrics || '';
  const comparecimento = metrics.comparecimento ?? (groupsPayload.comparecimento || totalValidos);
  const brancos = metrics.brancos ?? groupsPayload.brancos ?? 0;
  const nulos = metrics.nulos ?? groupsPayload.nulos ?? 0;
  dom.resultsMetrics.innerHTML = `
    <div class="metrics-grid">
      ${extraMetrics}
      <div class="metric-item"><span>Votos válidos</span><strong>${fmtInt(totalValidos)}</strong></div>
      <div class="metric-item"><span>Comparecimento</span><strong>${fmtInt(comparecimento)}</strong></div>
      <div class="metric-item"><span>Brancos</span><strong>${fmtInt(brancos)}</strong></div>
      <div class="metric-item"><span>Nulos</span><strong>${fmtInt(nulos)}</strong></div>
    </div>
  `;
}

function renderDeputyPartyResults(cargo) {
  initializeCandidateColorUI();
  closeCandidateColorPopoverOnViewChange();

  // --- CONFIGURAÇÃO E CONSTANTES ---
  const FEDERATION_COLORS = {
    'FE BRASIL': '#C0122D',
    'FEDERAÇÃO BRASIL DA ESPERANÇA - FE BRASIL(PT/PC DO B/PV)': '#C0122D',
    'PSDB-CIDADANIA': '#0096ff',
    'Federação PSDB Cidadania(PSDB/CIDADANIA)': '#0096ff',
    'FEDERAÇÃO PSDB CIDADANIA(PSDB/CIDADANIA)': '#0096ff',
    'PSOL-REDE': '#68018D',
    'Federação PSOL REDE(PSOL/REDE)': '#68018D',
    'FEDERAÇÃO PSOL REDE(PSOL/REDE)': '#68018D'
  };

  // 1. Alternador de Visualização
  const isFederationYear = (STATE.currentElectionYear >= 2022);
  const groupLabel = isFederationYear ? "Agrupar Federações" : "Agrupar Coligações";

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

  // === OTIMIZAÃ‡ÃO: LOOP RÁPIDO ===
  // Se não tem seleção (estado todo), usamos OfficialTotals para renderizar rápido
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

        if (cand.length > 2) {
          const meta = STATE.deputyMetadata[cand];
          if (meta) {
            const status = (meta[2] || '').toUpperCase();
            if ((status.includes('ELEITO') || status.includes('QP') || status.includes('MÉDIA')) && !status.includes('NÃO')) {
              aggParty[partyName].electedSet.add(cand);
            }
          }
        }
      }
    }
  } else if (geojson && geojson.features) {
    // Garante índice de lookup
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

    // Loop apenas na seleção
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
              // Aqui usamos lógica simples apenas para saber se TEM eleito na sigla
              if ((status.includes('ELEITO') || status.includes('QP') || status.includes('MÉDIA')) && !status.includes('NÃO')) {
                aggParty[partyName].electedSet.add(cand);
              }
            }
          }
        }
      }
    }
  }

  // --- RENDERIZAÇÃO ---
  let results = [];
  let totalValidosDisplay = 0;
  let subtitleText = "";
  let statsOfficial = null;

  // CASO 1: MODO AGRUPADO (FEDERAÇÃO/COLIGAÇÃO)
  if (STATE.deputyPartyViewMode === 'federation') {
    if (!officialData) {
      dom.resultsContent.innerHTML += `<div style="padding:20px; text-align:center; color:var(--muted)">Dados não encontrados.</div>`;
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
          const pData = aggParty[sigla];
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
      if (rawCompNorm2 === finalNameNorm2) {
        finalName = off.raw_comp; // Uses the spaced-out version
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
    for (const [partyName, data] of Object.entries(aggParty)) {
      if (data.votes > 0) {
        results.push({
          name: partyName,
          votes: data.votes,
          pct: (totalValidosDisplay > 0) ? (data.votes / totalValidosDisplay) : 0,
          elected: data.electedSet.size,
          color: colorForParty(partyName),
          isGroup: false,
          composition: partyName
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
        // Passa r.elected para tratar "NÃO ELEITO" geral
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

      div.innerHTML = `
        <div class="cand-header party-result-header">
            <div class="cand-info party-result-info">
             <h4 class="party-result-title" style="${headerStyle}">${r.name}</h4>
             ${subtitleHtml}
            </div>
             ${electedHtml}
        </div>
        <div class="cand-stats party-result-stats">
          <div class="party-result-votes">
            <span class="bigPct">${fmtPct(r.pct)}</span>
            <span class="smallVotos">${fmtInt(r.votes)}</span>
          </div>
          <div class="party-result-action">Ver lista -&gt;</div>
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
  paginator.textContent = `Página 1 de ${totalPages} (${results.length} registros)`;

  subtitleText = `${results.length} ${STATE.deputyPartyViewMode === 'federation' ? 'coligações/federações' : 'partidos'} listados`;
  dom.resultsSubtitle.innerHTML = subtitleText;

  const updateNav = () => {
    const scrollLeft = carousel.scrollLeft;
    const width = carousel.offsetWidth;
    const pageIndex = (width > 0) ? Math.round(scrollLeft / width) : 0;

    if (pageIndex <= 0) prevBtn.classList.add('disabled');
    else prevBtn.classList.remove('disabled');

    if (pageIndex >= totalPages - 1) nextBtn.classList.add('disabled');
    else nextBtn.classList.remove('disabled');

    paginator.textContent = `Página ${pageIndex + 1} de ${totalPages} (${results.length} registros)`;
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
    ? `<div class="metric-item"><span>Participação</span><strong>${fmtPct(turnoutStats.ratio)}</strong></div>`
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
      else if (st.includes('NÃO ELEITO') || st.includes('NAO ELEITO') || st === 'NÃO ELEITO' || st === 'NAO ELEITO') { statusHtml = `<span class="status-badge nao-eleito"><svg><use href="#svg-x"/></svg> Não Eleito</span>`; simpleStatus = 'NÃO ELEITO'; }
      else if (st.includes('ELEITO') || st.includes('QP') || st.includes('MEDIA') || st.includes('MÉDIA')) { statusHtml = `<span class="status-badge eleito"><svg><use href="#svg-check"/></svg> ${escapeHtml(r.status)}</span>`; simpleStatus = 'ELEITO'; }
      else if (st.includes('SUPLENTE')) { statusHtml = `<span class="status-badge suplente">Suplente</span>`; simpleStatus = 'SUPLENTE'; }
      div.setAttribute('data-status', simpleStatus);
      const sw = getColorForCandidate(r.nome, r.partido);
      const safeNome = escapeHtml(r.nome);
      const safePartyAndId = escapeHtml(`${r.partido} • ${r.id}`);
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

  dom.resultsMetrics.innerHTML = `
    <div class="metrics-grid">
      <div class="metric-item"><span>Votos Validos (Nominais)</span><strong>${fmtInt(totalVotes)}</strong></div>
      <div class="metric-item"><span>Comparecimento</span><strong>${fmtInt(comparecimento)}</strong></div>
      <div class="metric-item"><span>Brancos</span><strong>${fmtInt(brancos)} (${fmtPct(comparecimento > 0 ? brancos / comparecimento : 0)})</strong></div>
      <div class="metric-item"><span>Nulos</span><strong>${fmtInt(nulos)} (${fmtPct(comparecimento > 0 ? nulos / comparecimento : 0)})</strong></div>
      ${participacaoHtml}
    </div>`;
}

function renderVereadorPartyResults(cargo) {
  initializeCandidateColorUI();
  closeCandidateColorPopoverOnViewChange();

  const useOfficialMunicipalTotals = shouldUseMunicipalOfficialTotals();
  const officialSummary = useOfficialMunicipalTotals ? STATE.municipalOfficialTotals?.[cargo]?.['1T'] : null;
  // --- CONFIGURAÇÃO E CONSTANTES ---
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
    : (String(vYear) >= '2022' ? 'Agrupar Federações (Oficial)' : 'Agrupar Coligações (Oficial)');

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

  dom.resultsContent.innerHTML = '';
  dom.resultsContent.appendChild(subToggle);

  subToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-tab-btn');
    if (!btn) return;
    const mode = btn.dataset.mode;
    if (STATE.vereadorPartyViewMode === mode) return;
    STATE.vereadorPartyViewMode = mode;
    renderVereadorPartyResults(cargo);
    applyFiltersAndRedraw();
  });

  // --- PREPARAÇÃO DOS DADOS (loop no mapa selecionado) ---
  const aggParty = {};
  let totalVotesMap = 0;
  const visitedKeys = new Set();

  // Cache siglas → nome de partido
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
          if ((status.includes('ELEITO') || status.includes('QP') || status.includes('MÉDIA') || status.includes('MEDIA')) && !status.includes('NÃO') && !status.includes('NAO')) {
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
              if ((status.includes('ELEITO') || status.includes('QP') || status.includes('MÉDIA') || status.includes('MEDIA')) && !status.includes('NÃO') && !status.includes('NAO')) {
                aggParty[partyName].electedSet.add(cand);
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

  // JSON structure: data["('UF',)"]['DESCONHECIDO'] — keyed by UF tuple string, all munis merged per state
  const rawTotals = STATE.officialTotals?.[totalsKey];
  // Estrutura: data['UF']['MUNI_SANITIZADO'] = { stats, coalitions }
  const muniSanitized = loadedVereadorState.muniSanitized || '';
  const ufBlock = rawTotals?.[uf]?.[muniSanitized] ?? null;

  // MODO COLIGAÇÕES/PARTIDOS (dados oficiais por município)
  if (STATE.vereadorPartyViewMode === 'coalition') {
    if (!ufBlock) {
      dom.resultsContent.innerHTML += `<div style="padding:20px; text-align:center; color:var(--muted)">Dados oficiais não disponíveis para este município.</div>`;
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
        const v = aggParty[sigla]?.votes || aggParty[Object.keys(aggParty).find(k => k.toUpperCase() === sigla)]?.votes || 0;
        if (v > maxV) { maxV = v; bestColor = colorForParty(sigla); }
      });

      // Tenta achar nome da coligação no metadata
      let coalitionName = null;
      if (members.length > 1) {
        const offNorm = off.raw_comp.split('/').map(normalizePartyAlias).join('').replace(/\s/g, '');
        for (const meta of Object.values(STATE.vereadorMetadata || {})) {
          if (meta && meta.length > 4 && meta[3] && meta[4]) {
            const metaNorm = (meta[4] || '').split('/').map(normalizePartyAlias).join('').replace(/\s/g, '');
            if (metaNorm === offNorm) {
              const n = meta[3];
              if (n && n.toUpperCase() !== 'PARTIDO ISOLADO') { coalitionName = n; break; }
            }
          }
        }
      }

      const finalName = coalitionName || off.raw_comp;

      results.push({
        name: finalName,
        votes: off.votes,
        pct: totalValidosDisplay > 0 ? off.votes / totalValidosDisplay : 0,
        elected: off.elected || 0,
        color: bestColor,
        isGroup: members.length > 1,
        composition: off.raw_comp
      });
    });

  } else {
    // MODO PARTIDOS INDIVIDUAIS
    totalValidosDisplay = officialSummary ? ensureNumber(officialSummary.totalValidos) : totalVotesMap;
    if (ufBlock) statsOfficial = ufBlock.stats;

    for (const [partyName, data] of Object.entries(aggParty)) {
      if (data.votes > 0) {
        results.push({
          name: partyName,
          votes: data.votes,
          pct: totalValidosDisplay > 0 ? data.votes / totalValidosDisplay : 0,
          elected: data.electedSet.size,
          color: colorForParty(partyName),
          isGroup: false,
          composition: partyName
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

      div.innerHTML = `
        <div class="cand-header party-result-header">
          <div class="cand-info party-result-info">
            <h4 class="party-result-title" style="${headerStyle}">${r.name}</h4>
            ${subtitleHtml}
          </div>
          ${electedHtml}
        </div>
        <div class="cand-stats party-result-stats">
          <div class="party-result-votes">
            <span class="bigPct">${fmtPct(r.pct)}</span>
            <span class="smallVotos">${fmtInt(r.votes)}</span>
          </div>
          <div class="party-result-action">Ver lista -&gt;</div>
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
  paginator.textContent = `Página 1 de ${totalPages} (${results.length} registros)`;

  subtitleText = `${results.length} ${STATE.vereadorPartyViewMode === 'coalition' ? 'coligações/partidos' : 'partidos'} listados`;
  dom.resultsSubtitle.innerHTML = subtitleText;

  const updateNav = () => {
    const pageIndex = carousel.offsetWidth > 0 ? Math.round(carousel.scrollLeft / carousel.offsetWidth) : 0;
    prevBtn.classList.toggle('disabled', pageIndex <= 0);
    nextBtn.classList.toggle('disabled', pageIndex >= totalPages - 1);
    paginator.textContent = `Página ${pageIndex + 1} de ${totalPages} (${results.length} registros)`;
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
    </div>`;
}

// Modal de candidatos do partido/coligação para VEREADOR
function openVereadorCoalitionModal(composition, titleName, color, cargo, electedCount, isGroup = false) {
  let targetParties = composition.split('/').map(s => normalizePartyAlias(s.trim().toUpperCase()));

  // Fallback: se vier nome de coligação com parênteses, extrai composição
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

  let modalOverlay = document.getElementById('coalition-modal-overlay');
  if (!modalOverlay) {
    modalOverlay = document.createElement('div');
    modalOverlay.id = 'coalition-modal-overlay';
    modalOverlay.className = 'info-overlay';
    modalOverlay.style.zIndex = '10000';
    document.body.appendChild(modalOverlay);
  }

  let listHtml = candidateList.map((c, idx) => {
    const st = c.status.toUpperCase();
    let label = '', badgeClass = '';
    if (forceNotElected) { label = 'NÃO ELEITO'; badgeClass = 'nao-eleito'; }
    else if (st.includes('NÃO ELEITO') || st.includes('NAO ELEITO')) { label = 'NÃO ELEITO'; badgeClass = 'nao-eleito'; }
    else if (st.includes('QP')) { label = 'ELEITO POR QP'; badgeClass = 'eleito'; }
    else if (st.includes('MÉDIA') || st.includes('MEDIA')) { label = 'ELEITO POR MÉDIA'; badgeClass = 'eleito'; }
    else if (st.includes('ELEITO')) { label = 'ELEITO'; badgeClass = 'eleito'; }
    else if (st.includes('SUPLENTE')) { label = 'SUPLENTE'; badgeClass = 'suplente'; }
    else { label = 'NÃO ELEITO'; badgeClass = 'nao-eleito'; }

    const statusBadge = `<span class="status-badge ${badgeClass}" style="font-size:0.65rem; padding:2px 5px;">${label}</span>`;
    const partyColor = colorForParty(c.partido);
    return `
      <div style="display:flex; align-items:center; padding:6px 0 6px 8px; border-bottom:1px solid var(--border); font-size:0.85rem; border-left: 3px solid ${partyColor}; box-sizing:border-box; min-width:0;">
        <span style="color:var(--muted); font-size:0.75rem; width:24px; flex-shrink:0;">${idx + 1}°</span>
        <div style="flex:1; margin-right:8px; overflow:hidden;">
          <div style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${c.nome}</div>
          <div style="font-size:0.7rem; color:var(--muted); margin-top:1px;">${c.partido}</div>
        </div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:2px;">
          <div style="font-weight:700;">${fmtInt(c.votos)}</div>
          ${statusBadge}
        </div>
      </div>`;
  }).join('');

  if (candidateList.length === 0 && totalLegendVotes === 0) listHtml = '<div style="padding:20px; text-align:center; color:var(--muted); font-size:0.85rem;">Nenhum voto registrado.</div>';

  let legendHtml = '';
  if (!isGroup && totalLegendVotes > 0) {
    legendHtml = `
      <div style="margin-top:10px; padding:8px 10px; background:var(--surface-2, #f5f5f5); border-radius:6px; border-left:3px solid ${color};">
        <div style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.5px; color:var(--muted); margin-bottom:4px;">Votos de Legenda</div>
        <div style="font-size:1.1rem; font-weight:700;">${fmtInt(totalLegendVotes)}</div>
      </div>`;
  }

  modalOverlay.innerHTML = `
    <div class="info-modal wide-modal" style="max-width:450px; max-height:85vh; display:flex; flex-direction:column; padding:20px; overflow:hidden;">
      <button class="info-close" onclick="document.getElementById('coalition-modal-overlay').classList.remove('visible')">✕</button>
      <div style="border-bottom: 2px solid ${color}; padding-bottom:10px; margin-bottom:10px;">
        <h3 style="margin:0; font-size:1rem; text-transform:uppercase; letter-spacing:0.5px;">${titleName}</h3>
      </div>
      <div style="flex:1; overflow-y:auto; padding-right:8px; padding-bottom:8px; scrollbar-gutter:stable;">
        ${listHtml}
        ${legendHtml}
      </div>
    </div>`;

  modalOverlay.classList.add('visible');
  modalOverlay.onclick = (e) => { if (e.target === modalOverlay) modalOverlay.classList.remove('visible'); };
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


// =========================================================
// 2. MODAL OTIMIZADO COM CORREÇÃO DE STATUS (RESOLVIDO)
// =========================================================

function openCoalitionModal(composition, titleName, color, cargo, electedCount, isGroup = false) {
  // 1. TRATAMENTO DE FEDERAÇÕES E PARSING
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

  // 2. AGREGAR CANDIDATOS (Realizado sob demanda para não travar o mapa)
  const typeKey = (cargo === 'deputado_federal') ? 'f' : 'e';
  const aggCandidates = {};
  const processedKeys = new Set();

  // Garante que o lookup existe (caso o modal seja aberto sem passar pelo render anterior, o que é raro mas possível)
  if (!STATE.deputyLookup || STATE.deputyLookupCargo !== cargo) {
    // Fallback rápido se não existir o cache
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

  // 3. CONSTRUÇÃO DO HTML (COM A CORREÇÃO DE LÓGICA DO STATUS)
  let modalOverlay = document.getElementById('coalition-modal-overlay');
  if (!modalOverlay) {
    modalOverlay = document.createElement('div');
    modalOverlay.id = 'coalition-modal-overlay';
    modalOverlay.className = 'info-overlay';
    modalOverlay.style.zIndex = '10000';
    document.body.appendChild(modalOverlay);
  }

  // Regra Global: Se a coligação não fez eleitos (card zerado), todo mundo vira NÃO ELEITO
  const forceNotElected = (electedCount === 0);

  let listHtml = candidateList.map((c, idx) => {
    let statusBadge = '';
    const st = c.status.toUpperCase();

    let label = '';
    let badgeClass = '';

    if (forceNotElected) {
      label = 'NÃO ELEITO';
      badgeClass = 'nao-eleito';
    } else {
      // === LÓGICA DE STATUS CORRIGIDA E DETALHADA ===
      // Verifica o NEGATIVO primeiro para evitar que "NÃO ELEITO" case com "ELEITO"

      if (st.includes('NÃO ELEITO') || st.includes('NÃO ELEITO')) {
        label = 'NÃO ELEITO';
        badgeClass = 'nao-eleito';
      }
      else if (st.includes('QP')) {
        label = 'ELEITO POR QP';
        badgeClass = 'eleito';
      }
      else if (st.includes('MÉDIA') || st.includes('MEDIA')) {
        label = 'ELEITO POR MÉDIA';
        badgeClass = 'eleito';
      }
      else if (st.includes('ELEITO')) {
        // Caso genérico se não tiver QP/Média explicito
        label = 'ELEITO';
        badgeClass = 'eleito';
      }
      else if (st.includes('SUPLENTE')) {
        label = 'SUPLENTE';
        badgeClass = 'suplente';
      }
      else {
        // Default fallback
        label = 'NÃO ELEITO';
        badgeClass = 'nao-eleito';
      }
    }

    statusBadge = `<span class="status-badge ${badgeClass}" style="font-size:0.65rem; padding:2px 5px;">${label}</span>`;
    const partyColor = colorForParty(c.partido);

    return `
            <div style="display:flex; align-items:center; padding:6px 0 6px 8px; border-bottom:1px solid var(--border); font-size:0.85rem; border-left: 3px solid ${partyColor}; box-sizing:border-box; min-width:0;">
                <span style="color:var(--muted); font-size:0.75rem; width:24px; flex-shrink:0;">${idx + 1}°</span>
                <div style="flex:1; margin-right:8px; overflow:hidden;">
                    <div style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${c.nome}</div>
                    <div style="font-size:0.7rem; color:var(--muted); margin-top:1px;">${c.partido}</div>
                </div>
                <div style="display:flex; flex-direction:column; align-items:flex-end; gap:2px;">
                    <div style="font-weight:700;">${fmtInt(c.votos)}</div>
                    ${statusBadge}
                </div>
            </div>
        `;
  }).join('');

  if (candidateList.length === 0 && totalLegendVotes === 0) listHtml = '<div style="padding:20px; text-align:center; color:var(--muted); font-size:0.85rem;">Nenhum voto registrado.</div>';

  // Legend votes section
  let legendHtml = '';
  if (!isGroup && totalLegendVotes > 0) {
    legendHtml = `
      <div style="margin-top:10px; padding:8px 10px; background:var(--surface-2, #f5f5f5); border-radius:6px; border-left:3px solid ${color};">
        <div style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.5px; color:var(--muted); margin-bottom:4px;">Votos de Legenda</div>
        <div style="font-size:1.1rem; font-weight:700;">${fmtInt(totalLegendVotes)}</div>
      </div>
    `;
  }
  const headerStyle = `border-bottom: 2px solid ${color}; padding-bottom:10px; margin-bottom:10px;`;

  modalOverlay.innerHTML = `
        <div class="info-modal wide-modal" style="max-width:450px; max-height:85vh; display:flex; flex-direction:column; padding:20px; overflow:hidden;">
            <button class="info-close" onclick="document.getElementById('coalition-modal-overlay').classList.remove('visible')">✕</button>
            <div style="${headerStyle}">
                <h3 style="margin:0; font-size:1rem; text-transform:uppercase; letter-spacing:0.5px;">${titleName}</h3>
            </div>
            <div style="flex:1; overflow-y:auto; padding-right:8px; padding-bottom:8px; scrollbar-gutter:stable;">
                ${listHtml}
            </div>
            ${legendHtml}
        </div>
    `;

  setTimeout(() => modalOverlay.classList.add('visible'), 10);
}

// --- OTIMIZAÇÃO: CACHE DE VENCEDORES ---
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

      let maxV = -1;
      let winner = null;
      let total = 0;

      const partyVotes = {};
      let maxPartyV = -1;
      let winningParty = null;

      // Loop único para achar vencedor e somar partidos
      for (const [cand, v] of Object.entries(votes)) {
        const vi = parseInt(v);

        // Ignora brancos (95) e nulos (96) para cálculo de vitória nominal
        if (cand !== '95' && cand !== '96') {
          total += vi;

          // Vencedor Individual
          if (vi > maxV) {
            maxV = vi;
            winner = cand;
          }

          // Soma por Partido
          const meta = STATE.deputyMetadata[cand];
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
        votesMap: votes // Guarda referência para uso futuro se precisar
      };
    });
  }

  console.timeEnd("Precompute Winners");
}

// ====== EXPORTAÇÕES PARA ISE.JS ======
// const/let/function não criam propriedades em window automaticamente.
// ise.js precisa acessar estes objetos para renderizar os gráficos do ISE.
function renderDeputyResults(cargo) {
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

  const payload = aggregateProportionalGroupsForSelection(cargo);
  const typeKey = cargo === 'deputado_federal' ? 'f' : 'e';
  const officialData = STATE.officialTotals?.[STATE.currentElectionYear]?.[dom.selectUFGeneral?.value || '']?.[typeKey] || null;
  const extraMetrics = officialData?.stats
    ? `
      ${officialData.stats.qt_vagas ? `<div class="metric-item"><span>Vagas em jogo</span><strong>${fmtInt(officialData.stats.qt_vagas)}</strong></div>` : ''}
      ${officialData.stats.vr_qe ? `<div class="metric-item"><span>Quociente eleitoral</span><strong>${fmtInt(officialData.stats.vr_qe)}</strong></div>` : ''}
    `
    : '';

  dom.resultsSubtitle.textContent = `${(payload.groups || []).length} listas classificadas`;
  renderProportionalExpandableList(payload, {
    extraMetrics,
    comparecimento: payload.comparecimento,
    brancos: payload.brancos,
    nulos: payload.nulos
  });
}

function renderVereadorPartyResults(cargo) {
  initializeCandidateColorUI();
  closeCandidateColorPopoverOnViewChange();

  const payload = aggregateProportionalGroupsForSelection(cargo);
  const totalsKey = `vereadores_${STATE.currentElectionYear}`;
  const uf = loadedVereadorState.uf || dom.selectUFMunicipal?.value || '';
  const muniSanitized = loadedVereadorState.muniSanitized || normalizeMunicipioSlug(dom.selectMunicipio?.value || '');
  const officialStats = STATE.officialTotals?.[totalsKey]?.[uf]?.[muniSanitized]?.stats || null;
  const extraMetrics = officialStats
    ? `
      ${officialStats.qt_vagas ? `<div class="metric-item"><span>Vagas em jogo</span><strong>${fmtInt(officialStats.qt_vagas)}</strong></div>` : ''}
      ${officialStats.vr_qe ? `<div class="metric-item"><span>Quociente eleitoral</span><strong>${fmtInt(officialStats.vr_qe)}</strong></div>` : ''}
    `
    : '';

  dom.resultsSubtitle.textContent = `${(payload.groups || []).length} listas classificadas`;
  renderProportionalExpandableList(payload, {
    extraMetrics,
    comparecimento: payload.comparecimento,
    brancos: payload.brancos,
    nulos: payload.nulos
  });
}

window.STATE = STATE;
window.getProp = getProp;
window.parseCandidateKey = parseCandidateKey;
window.selectedLocationIDs = selectedLocationIDs;
window.getColorForCandidate = typeof getColorForCandidate === 'function' ? getColorForCandidate : null;
window.PARTY_COLORS = PARTY_COLORS;
window.PARTY_COLOR_OVERRIDES = PARTY_COLOR_OVERRIDES;
// Expor currentTurno como getter para sempre pegar o valor atualizado
Object.defineProperty(window, 'currentTurno', { get() { return currentTurno; }, configurable: true });
Object.defineProperty(window, 'currentCargo', { get() { return currentCargo; }, configurable: true });
