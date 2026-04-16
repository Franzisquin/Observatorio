function setupControls() {
  // Popular UF Geral
  dom.selectUFGeneral.innerHTML = '<option value="" disabled selected>Selecione UF</option>';
  UF_MAP.forEach((nome, sigla) => {
    const opt = document.createElement('option');
    opt.value = sigla;
    opt.textContent = (sigla === 'BR') ? nome : `${nome} (${sigla})`;
    dom.selectUFGeneral.appendChild(opt);
  });

  // Popular UF Municipal
  dom.selectUFMunicipal.innerHTML = '<option value="" disabled selected>Selecione UF</option>';
  ALL_STATE_SIGLAS.forEach(sigla => {
    const nome = UF_MAP.get(sigla) || sigla;
    const opt = document.createElement('option');
    opt.value = sigla;
    opt.textContent = `${nome} (${sigla})`;
    dom.selectUFMunicipal.appendChild(opt);
  });

  const updateLoadButtonState = () => {
    if (!dom.btnLoadData) return;
    let disabled = false;
    let label = 'Carregar dados';

    dom.btnLoadData.style.display = 'none';

    if (STATE.currentElectionType === 'geral') {
      const year = STATE.currentElectionYear;
      const uf = dom.selectUFGeneral.value;

      if (currentOffice === 'presidente') {
        disabled = !uf;
        label = uf
          ? `Carregar Presidente (${uf}, ${year})`
          : 'Selecione BR ou uma UF para carregar';
      } else if (currentOffice === 'deputado') {
        disabled = !(uf && uf !== 'BR');
        label = uf && uf !== 'BR'
          ? `Carregar ${currentCargo === 'deputado_estadual' ? 'Dep. Estadual' : 'Dep. Federal'} (${uf}, ${year})`
          : 'Selecione uma UF para carregar';
      } else {
        disabled = !(uf && uf !== 'BR');
        label = uf && uf !== 'BR'
          ? `Carregar ${currentOffice} (${uf}, ${year})`
          : 'Selecione uma UF para carregar';
      }
    } else {
      const uf = dom.selectUFMunicipal.value;
      const municipio = dom.selectMunicipio.value;
      const year = STATE.currentElectionYear;
      disabled = !(uf && municipio);
      label = (!uf || !municipio)
        ? 'Selecione UF e município'
        : `Carregar ${currentOffice} (${municipio}/${uf}, ${year})`;
    }

    dom.btnLoadData.textContent = label;
    dom.btnLoadData.disabled = disabled;
    dom.btnLoadData.classList.toggle('cta-ready', !disabled);
  };

  const canInstantLoadCurrentContext = () => {
    if (STATE.currentElectionType === 'geral') {
      const uf = dom.selectUFGeneral?.value;
      if (!uf) return false;
      if (currentOffice === 'presidente') return true;
      return uf !== 'BR';
    }

    return !!(dom.selectUFMunicipal?.value && dom.selectMunicipio?.value);
  };

  const runInstantLoad = async () => {
    if (STATE.isLoadingDataset || !canInstantLoadCurrentContext()) return;
    if (typeof rememberMapViewportForNextLoad === 'function') {
      rememberMapViewportForNextLoad();
    }

    try {
      if (STATE.currentElectionType === 'geral') {
        const uf = dom.selectUFGeneral?.value;
        const year = STATE.currentElectionYear;
        if (currentOffice === 'deputado') {
          await window.onClickLoadData_Deputies(uf, year);
        } else {
          await window.onClickLoadData_General();
        }
      } else {
        await window.onClickLoadData_Municipal();
      }
    } catch (error) {
      console.error('[Auto-Load] Falha no carregamento instantâneo:', error);
      showToast(`Erro ao carregar dados: ${error.message}`, 'error');
    }
  };

  const scheduleInstantLoad = (delay = 90) => {
    if (autoLoadTimer) {
      clearTimeout(autoLoadTimer);
    }
    autoLoadTimer = setTimeout(() => {
      autoLoadTimer = null;
      runInstantLoad();
    }, delay);
  };

  // MUDANÇA DE ELEIÇÃO (ANO/TIPO) via Selects originais
  if (dom.selectElectionLevel) {
    dom.selectElectionLevel.addEventListener('change', (e) => {
      const type = e.target.value;
      if (!type) return;

      STATE.currentElectionType = type;

      // Reset state for new selection
      allDataCache.clear();
      clearZipCache();
      clearSelection(true);
      currentDataCollection = {};
      currentDataCollection_2022 = {};
      STATE.candidates = {};
      STATE.metrics = {};
      STATE.inaptos = {};
      uniqueCidades.clear();
      uniqueBairros.clear();

      [dom.filterBox, dom.vizBox, dom.resultsBox, dom.summaryBoxContainer].forEach(el => el.classList.add('section-hidden'));

      // Mostrar/Esconder boxes correspondentes
      if (type === 'geral') {
        dom.loaderBoxGeneral.classList.remove('section-hidden');
        dom.loaderBoxMunicipal.classList.add('section-hidden');
        STATE.currentElectionYear = dom.selectYearGeneral.value;
        currentTurno = 1;
        currentOffice = 'presidente';
        currentSubType = 'ord';
        // Reset chips
        if (dom.cargoChipsGeneral) {
          dom.cargoChipsGeneral.querySelectorAll('.chip-button').forEach(b => {
            b.classList.toggle('active', b.dataset.value === 'presidente');
          });
        }
      } else if (type === 'municipal') {
        dom.loaderBoxGeneral.classList.add('section-hidden');
        dom.loaderBoxMunicipal.classList.remove('section-hidden');
        STATE.currentElectionYear = dom.selectYearMunicipal.value;
        currentTurno = 1;
        currentOffice = 'prefeito';
        currentSubType = 'ord';
        // Reset chips
        if (dom.officeChipsMunicipal) {
          dom.officeChipsMunicipal.querySelectorAll('.chip-button').forEach(b => {
            b.classList.toggle('active', b.dataset.value === 'prefeito');
          });
        }
      }

      updateLoadButtonState();
      updateElectionTypeUI();

      if (type === 'municipal') {
        const uf = dom.selectUFMunicipal?.value;
        if (uf && !dom.selectMunicipio?.value && typeof window.showMunicipalStatewideOverview === 'function') {
          window.showMunicipalStatewideOverview(uf, STATE.currentElectionYear, currentSubType || 'ord');
        }
      }
    });
  }

  if (dom.selectYearGeneral) {
    dom.selectYearGeneral.addEventListener('change', (e) => {
      STATE.currentElectionYear = e.target.value;
      updateLoadButtonState();
    });
  }

  if (dom.selectYearMunicipal) {
    dom.selectYearMunicipal.addEventListener('change', (e) => {
      STATE.currentElectionYear = e.target.value;
      updateLoadButtonState();
    });
  }

  // BOTÃO CARREGAR
  dom.btnLoadData.addEventListener('click', async () => {
    if (STATE.isLoadingDataset) return;
    if (typeof rememberMapViewportForNextLoad === 'function') {
      rememberMapViewportForNextLoad();
    }
    try {
      if (STATE.currentElectionType === 'geral') {
        await window.onClickLoadData_General();
      } else {
        await window.onClickLoadData_Municipal();
      }
    } catch (error) {
      console.error('Falha no fluxo de carregamento:', error);
      showToast(`Erro ao carregar dados: ${error.message}`, 'error');
    }
  });

  dom.cargoChipsGeneral.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip-button');
    if (!btn) return;

    if (typeof rememberMapViewportForNextLoad === 'function') {
      rememberMapViewportForNextLoad();
    }

    // Extrai o cargo base e subtipo
    let newOffice = btn.dataset.value;
    let newSubType = 'ord'; // padrão
    let isChangingCargo = false;

    // Se for deputado, precisa do subtype específico
    if (newOffice.startsWith('deputado_')) {
      const newDeputyCargo = `deputado_${btn.dataset.subtype || newOffice.split('_')[1]}`;
      isChangingCargo = (currentCargo !== newDeputyCargo);
      currentOffice = 'deputado';
      newSubType = btn.dataset.subtype || newOffice.split('_')[1]; // 'federal' ou 'estadual'
      currentCargo = newDeputyCargo;
    } else {
      // Presidente, Governador, Senador
      isChangingCargo = (newOffice !== currentOffice);
      currentOffice = newOffice;
      currentSubType = 'ord';
      currentCargo = `${currentOffice}_${currentSubType}`;
    }

    // Se não mudou o cargo E já tem dados carregados, apenas redesenha
    applyDefaultVizColorStyleForCurrentCargo();

    if (!isChangingCargo && (currentDataCollection[currentCargo] || currentDataCollection[`${currentOffice}_sup`])) {
      console.log(`[Cargo] ${currentOffice} já está ativo e com dados carregados, apenas redesenhando...`);

      // Atualiza UI com loading visual
      dom.cargoChipsGeneral.querySelectorAll('.chip-button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setChipLoading(btn, true);

      setSectionLoading(dom.resultsBox, true);

      // Força limpeza do mapa antes de redesenhar
      if (currentLayer) {
        try {
          currentLayer.off();
          currentLayer.clearLayers();
          map.removeLayer(currentLayer);
        } catch (e) {
          console.warn("Erro ao limpar camada:", e);
        }
        currentLayer = null;
      }

      setTimeout(() => {
        updateElectionTypeUI();
        populateCidadeDropdown();
        if (currentCidadeFilter !== 'all' || STATE.currentElectionType === 'municipal') populateBairroDropdown();
        updateConditionalUI();
        applyFiltersAndRedraw();
        updateSelectionUI(STATE.isFilterAggregationActive);

        setSectionLoading(dom.resultsBox, false);
        setChipLoading(btn, false);
      }, 150);
      return;
    }

    console.log(`[Cargo] Mudando para ${currentOffice}...`);

    // Atualiza UI com loading visual
    dom.cargoChipsGeneral.querySelectorAll('.chip-button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setChipLoading(btn, true);

    // AUTO-AJUSTA UF SE NECESSÁRIO
    if ((currentOffice !== 'presidente' && currentOffice !== 'deputado') && dom.selectUFGeneral.value === 'BR') {
      dom.selectUFGeneral.value = ''; // Limpa BR para cargos estaduais
    }
    if (currentOffice === 'deputado' && dom.selectUFGeneral.value === 'BR') {
      dom.selectUFGeneral.value = ''; // Deputado precisa de UF
    }

    // Verifica se temos os dados na memória
    // FIX: Para deputados, verificar se os dados de votos do tipo específico (federal/estadual)
    // foram realmente carregados, não apenas o mapa base (GeoJSON compartilhado)
    const hasDeputyVoteData = currentOffice !== 'deputado' ||
      loadedDeputyState.types.has(currentCargo === 'deputado_estadual' ? 'e' : 'f');

    if ((currentDataCollection[currentCargo] || currentDataCollection[`${currentOffice}_sup`]) && hasDeputyVoteData) {
      // DADOS JÁ CARREGADOS - Apenas redesenha
      setSectionLoading(dom.resultsBox, true);

      // Força limpeza do mapa antes de redesenhar
      if (currentLayer) {
        try {
          currentLayer.off();
          currentLayer.clearLayers();
          map.removeLayer(currentLayer);
        } catch (e) {
          console.warn("Erro ao limpar camada:", e);
        }
        currentLayer = null;
      }

      setTimeout(() => {
        updateElectionTypeUI();
        populateCidadeDropdown();
        if (currentCidadeFilter !== 'all' || STATE.currentElectionType === 'municipal') populateBairroDropdown();
        updateConditionalUI();
        applyFiltersAndRedraw();
        updateSelectionUI(STATE.isFilterAggregationActive);

        setSectionLoading(dom.resultsBox, false);
        setChipLoading(btn, false);
      }, 150);
    } else {
      // DADOS NÃO CARREGADOS - Carrega automaticamente se possível
      const uf = dom.selectUFGeneral.value;
      const canLoad = (currentOffice === 'presidente' && !!uf) || (currentOffice === 'deputado' && uf && uf !== 'BR') || (uf && uf !== 'BR');

      if (canLoad) {
        console.log(`[Auto-Load] Carregando ${currentOffice} automaticamente...`);
        const year = STATE.currentElectionYear;
        const autoLoadPromise = (currentOffice === 'deputado')
          ? window.onClickLoadData_Deputies(uf, year)
          : window.onClickLoadData_General();

        Promise.resolve(autoLoadPromise)
          .catch((error) => {
            console.error(`[Auto-Load] Falha ao carregar ${currentOffice}:`, error);
            showToast(`Erro ao carregar dados: ${error.message}`, 'error');
          })
          .finally(() => {
            setChipLoading(btn, false);
            updateLoadButtonState();
          });
      } else {
        setChipLoading(btn, false);
        // Mostra mensagem se não pode carregar
        if (currentOffice === 'presidente' && !uf) {
          showToast('Selecione BR ou uma UF para carregar dados de Presidente', 'info', 2000);
        } else if (currentOffice === 'deputado' && !uf) {
          showToast('Selecione um estado para carregar dados de Deputados', 'info', 2000);
        } else if (!uf) {
          showToast('Selecione um estado para carregar dados', 'info', 2000);
        }
      }
    }

    updateLoadButtonState();
  });

  // LISTENER DE MUDANÇA DE UF - Carrega automaticamente nas eleições gerais
  dom.selectUFGeneral.addEventListener('change', () => {
    currentMesorregiaoFilter = 'all';
    currentMicrorregiaoFilter = 'all';
    currentCidadeFilter = 'all';
    currentBairroFilter = 'all';
    currentLocalFilter = '';
    if (dom.searchLocal) dom.searchLocal.value = '';
    populateRegionalDropdowns();
    updateLoadButtonState();
    if (canInstantLoadCurrentContext()) {
      scheduleInstantLoad();
    }
  });

  dom.selectYearGeneral?.addEventListener('change', () => {
    STATE.currentElectionYear = dom.selectYearGeneral.value;
    updateLoadButtonState();
    clearPendingFilterChanges();
    if (canInstantLoadCurrentContext()) {
      scheduleInstantLoad();
    }
  });

  // SELEÇÃO MUNICIPAL
  dom.selectUFMunicipal.addEventListener('change', () => {
    currentTurno = 1;
    const uf = dom.selectUFMunicipal.value;
    const municipios = MUNICIPAL_DATA_INDEX[uf] || [];

    dom.selectMunicipio.innerHTML = '<option value="" selected>Resumo estadual</option>';
    municipios.sort((a, b) => a.localeCompare(b, 'pt-BR')).forEach(nome => {
      const opt = document.createElement('option');
      opt.value = nome;
      opt.textContent = nome;
      dom.selectMunicipio.appendChild(opt);
    });

    const hasMunis = municipios.length > 0;
    dom.selectMunicipio.disabled = !hasMunis;
    dom.searchMunicipio.disabled = !hasMunis;
    dom.searchMunicipio.value = '';

    if (!hasMunis && uf) {
      dom.selectMunicipio.innerHTML = '<option value="" disabled selected>Dados não indexados</option>';
    }
    updateLoadButtonState();

    if (uf && typeof window.showMunicipalStatewideOverview === 'function') {
      window.showMunicipalStatewideOverview(uf, STATE.currentElectionYear, currentSubType || 'ord');
    }
  });
  dom.selectMunicipio.addEventListener('change', () => {
    currentTurno = 1;
    updateLoadButtonState();
    updateElectionTypeUI();
    updateConditionalUI();
    if (!dom.selectMunicipio.value) {
      const uf = dom.selectUFMunicipal?.value;
      if (uf && typeof window.showMunicipalStatewideOverview === 'function') {
        window.showMunicipalStatewideOverview(uf, STATE.currentElectionYear, currentSubType || 'ord');
      }
      return;
    }
    scheduleInstantLoad();
  });

  dom.selectYearMunicipal?.addEventListener('change', () => {
    currentTurno = 1;
    STATE.currentElectionYear = dom.selectYearMunicipal.value;
    updateLoadButtonState();
    clearPendingFilterChanges();
    const uf = dom.selectUFMunicipal?.value;
    if (!uf) return;
    if (!dom.selectMunicipio?.value) {
      if (typeof window.showMunicipalStatewideOverview === 'function') {
        window.showMunicipalStatewideOverview(uf, STATE.currentElectionYear, currentSubType || 'ord');
      }
      return;
    }
    scheduleInstantLoad();
  });



  // FILTROS
  // INIT COMBOBOXES
  // FILTROS REGIONAIS (RGINT / RGI) via Selects originais
  if (dom.selectRGINT) {
    dom.selectRGINT.addEventListener('change', (e) => {
      currentMesorregiaoFilter = e.target.value || 'all';
      currentMicrorregiaoFilter = 'all';
      if (dom.selectRGI) dom.selectRGI.value = '';
      currentCidadeFilter = 'all';
      currentBairroFilter = 'all';
      clearSelection(false);
      markFiltersDirty();
      populateRegionalDropdowns();
      populateCidadeDropdown();
      populateBairroDropdown();
      updateApplyButtonText();
      debouncedAutoApplyFilters();
    });
  }

  if (dom.selectRGI) {
    dom.selectRGI.addEventListener('change', (e) => {
      currentMesorregiaoFilter = 'all';
      if (dom.selectRGINT) dom.selectRGINT.value = '';
      currentMicrorregiaoFilter = e.target.value || 'all';
      currentCidadeFilter = 'all';
      currentBairroFilter = 'all';
      clearSelection(false);
      markFiltersDirty();
      populateRegionalDropdowns();
      populateCidadeDropdown();
      populateBairroDropdown();
      updateApplyButtonText();
      debouncedAutoApplyFilters();
    });
  }

  cidadeCombobox = createCombobox({
    box: dom.boxCidade,
    input: dom.inputCidade,
    list: dom.listCidade
  }, (val) => {
    // Ao selecionar Cidade
    currentCidadeFilter = val; // val será 'all' ou o nome da cidade
    currentBairroFilter = 'all';
    STATE.currentMapMode = (STATE.currentElectionType === 'geral' && val === 'all') ? 'municipios' : 'locais';

    // Reset da lógica de bairros
    populateBairroDropdown();

    // Se escolheu 'all', desativa a busca por local específico (muito pesado para o estado todo)
    // Se escolheu uma cidade, libera a busca por local
    dom.searchLocal.disabled = false;

    clearSelection(false);
    markFiltersDirty();

    // CORREÇÃO: Chama a nova função de texto que libera o botão
    updateApplyButtonText();
    debouncedAutoApplyFilters();
  });

  if (dom.btnMapModeMunicipios) {
    dom.btnMapModeMunicipios.addEventListener('click', () => {
      if (STATE.currentElectionType === 'geral') {
        const uf = String(dom.selectUFGeneral?.value || '').toUpperCase();
        if (!uf || uf === 'BR') return;

        currentCidadeFilter = 'all';
        currentBairroFilter = 'all';
        currentLocalFilter = '';
        if (cidadeCombobox) cidadeCombobox.setValue('Todos os municípios');
        if (bairroCombobox) bairroCombobox.setValue('');
        if (dom.searchLocal) dom.searchLocal.value = '';

        STATE.currentMapMode = 'municipios';
        clearSelection(true);
        updateApplyButtonText();
        applyFiltersAndRedraw();
        return;
      }

      const uf = dom.selectUFMunicipal?.value;
      if (uf && !dom.selectMunicipio?.value && typeof window.showMunicipalStatewideOverview === 'function') {
        window.showMunicipalStatewideOverview(uf, STATE.currentElectionYear, currentSubType || 'ord');
      }
    });
  }

  if (dom.btnMapModeLocais) {
    dom.btnMapModeLocais.addEventListener('click', () => {
      if (STATE.currentElectionType === 'municipal' && !dom.selectMunicipio?.value) return;

      STATE.currentMapMode = 'locais';
      clearSelection(true);
      updateApplyButtonText();
      applyFiltersAndRedraw();
    });
  }

  bairroCombobox = createCombobox({
    box: dom.boxBairro,
    input: dom.inputBairro,
    list: dom.listBairro
  }, (val) => {
    currentBairroFilter = val;
    clearSelection(false);
    markFiltersDirty();
    updateApplyButtonText();
    debouncedAutoApplyFilters();
  });

  const shouldAutoFrameFilteredArea = () => (
    currentMesorregiaoFilter !== 'all' ||
    currentMicrorregiaoFilter !== 'all' ||
    currentCidadeFilter !== 'all' ||
    currentBairroFilter !== 'all'
  );

  const syncFilteredSelectionAndFrame = () => {
    const geojson = currentDataCollection[currentCargo];
    if (!geojson) return;

    if (!shouldAutoFrameFilteredArea()) {
      if (typeof focusCurrentLayerOnMap === 'function') {
        focusCurrentLayerOnMap();
      }
      return;
    }

    const allFiltered = getAllFeaturesForAggregation();
    if (!allFiltered.length) return;

    selectedLocationIDs.clear();
    allFiltered.forEach((feature) => {
      const id = getFeatureSelectionId(feature.properties);
      if (id) selectedLocationIDs.add(id);
    });

    if (!selectedLocationIDs.size) return;

    updateSelectionUI(true);
    if (typeof focusSelectionOnMap === 'function') {
      focusSelectionOnMap();
    }
  };

  const debouncedAutoApplyFilters = debounce(() => {
    if (!currentDataCollection[currentCargo] || STATE.isLoadingDataset) return;
    applyFiltersAndRedraw();
    syncFilteredSelectionAndFrame();
    clearPendingFilterChanges();
  }, 180);

  const debouncedFilterDirty = debounce(() => markFiltersDirty(), 180);
  dom.searchLocal.addEventListener('input', (e) => {
    currentLocalFilter = norm(e.target.value);
    clearSelection(false);
    debouncedFilterDirty();
    updateApplyButtonText();
    debouncedAutoApplyFilters();
  });

  const addSearchFilter = (inputEl, selectEl) => {
    if (!inputEl || !selectEl) return;
    inputEl.addEventListener('keyup', () => {
      const searchTerm = norm(inputEl.value);
      const options = selectEl.querySelectorAll('option');
      options.forEach(opt => {
        if (opt.value === 'all' || opt.value === '') {
          opt.style.display = '';
          return;
        }
        const optText = norm(opt.textContent);
        opt.style.display = optText.includes(searchTerm) ? '' : 'none';
      });
    });
  };
  // Removed old calls for Cidade/Bairro
  addSearchFilter(dom.searchMunicipio, dom.selectMunicipio);

  if (dom.btnApplyFilters) {
    dom.btnApplyFilters.addEventListener('click', () => {
      if (!currentDataCollection[currentCargo]) return;

    setButtonLoading(dom.btnApplyFilters, true);
    setSectionLoading(dom.resultsBox, true);
    if (dom.resultsContent) showSkeletonCards(dom.resultsContent, 4);
    showMapLoading('Aplicando filtros e atualizando mapa...');

    clearSelection(false);

    if (STATE.currentElectionType === 'municipal') {
      currentCidadeFilter = 'all';
      // CORREÇÃO: Usar combobox em vez de selectCidade direto
      if (cidadeCombobox) cidadeCombobox.setValue('Todos os municípios');
    }

    requestAnimationFrame(() => {
      try {
        applyFiltersAndRedraw();
        syncFilteredSelectionAndFrame();

        clearPendingFilterChanges();
      } finally {
        setSectionLoading(dom.resultsBox, false);
        setButtonLoading(dom.btnApplyFilters, false);
        setTimeout(() => hideMapLoading(), 180);
      }
    });
    });
  }

  if (dom.btnToggleInaptos) {
    dom.btnToggleInaptos.addEventListener('click', () => {
      STATE.filterInaptos = !STATE.filterInaptos;
      dom.btnToggleInaptos.classList.toggle('active', STATE.filterInaptos);
      dom.btnToggleInaptos.textContent = STATE.filterInaptos ? 'Inaptos Filtrados' : 'Filtrar Inaptos';
      applyFiltersAndRedraw();
      if (selectedLocationIDs.size > 0) updateSelectionUI(STATE.isFilterAggregationActive);
    });
  }

  if (dom.vizModeChips) {
    dom.vizModeChips.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip-button');
      if (!btn) return;
      currentVizMode = btn.dataset.value;
      dom.vizModeChips.querySelectorAll('.chip-button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateVizModeUI();
      populateCidadeDropdown();
      if (currentCidadeFilter !== 'all' || STATE.currentElectionType === 'municipal') populateBairroDropdown();
      applyFiltersAndRedraw();
    });
  }
  if (dom.selectVizColorStyle) {
    dom.selectVizColorStyle.addEventListener('change', (e) => {
      currentVizColorStyle = 'gradient';
      e.target.value = 'gradient';
      applyFiltersAndRedraw();
    });
  }
  dom.selectVizSize?.addEventListener('change', (e) => {
    currentVizSize = e.target.value || 'fixo';
    applyFiltersAndRedraw();
  });
  if (dom.selectVizCandidato) {
    dom.selectVizCandidato.addEventListener('change', () => {
    if (currentVizMode.startsWith('desempenho')) {
      // Reset filtro ao trocar de candidato
      performanceFilterMinPct = 0;

      // Recalcula estatísticas do candidato selecionado
      const candidatoKey = dom.selectVizCandidato.value;
      performanceModeStats = calculateCandidateStats(candidatoKey) || {
        candidato: candidatoKey, minPct: 0, maxPct: 100, avgPct: 0, totalLocais: 0
      };
      console.log('📊 Modo Desempenho - Stats:', performanceModeStats);

      // Atualizar UI de estatísticas
      updatePerformanceStatsUI();

      applyFiltersAndRedraw();
    }
    });
  }

  if (dom.btnClearSelection) {
    dom.btnClearSelection.addEventListener('click', () => {
      if (STATE.currentElectionType === 'geral' && currentCidadeFilter !== 'all') {
        currentCidadeFilter = 'all';
        currentBairroFilter = 'all';
        currentLocalFilter = '';
        if (cidadeCombobox) cidadeCombobox.setValue('Todos os municípios');
        if (bairroCombobox) bairroCombobox.setValue('');
        if (dom.searchLocal) dom.searchLocal.value = '';
        
        STATE.currentMapMode = 'municipios';
        clearSelection(true);
        updateApplyButtonText();
        applyFiltersAndRedraw();
        return;
      }

      if (STATE.currentElectionType === 'municipal' && dom.selectMunicipio?.value) {
        currentOffice = 'prefeito';
        currentSubType = 'ord';
        currentCargo = 'prefeito_ord';
        applyDefaultVizColorStyleForCurrentCargo();
        if (dom.officeChipsMunicipal) {
          dom.officeChipsMunicipal.querySelectorAll('.chip-button').forEach((b) => {
            b.classList.toggle('active', b.dataset.value === 'prefeito');
          });
        }
        dom.selectMunicipio.value = '';
        clearSelection(true);
        updateElectionTypeUI();
        updateConditionalUI();
        updateApplyButtonText();
        const uf = dom.selectUFMunicipal?.value;
        if (uf && typeof window.showMunicipalStatewideOverview === 'function') {
          window.showMunicipalStatewideOverview(uf, STATE.currentElectionYear, currentSubType || 'ord');
        }
        return;
      }

      clearSelection(true);
      updateApplyButtonText();
      applyFiltersAndRedraw();
    });
  }

  if (dom.btnLocateSelection) {
    dom.btnLocateSelection.addEventListener('click', () => {
      if (typeof focusSelectionOnMap === 'function') {
        focusSelectionOnMap();
      }
    });
  }

  if (dom.summaryGrid) {
    dom.summaryGrid.addEventListener('click', (e) => {
      if (STATE.currentElectionType !== 'geral') return;
      const box = e.target.closest('.summary-box');
      if (!box || !box.dataset.cargo) return;

      const newCargo = box.dataset.cargo; // ex: presidente, governador, senador
      currentOffice = newCargo;
      currentSubType = 'ord';
      currentCargo = `${currentOffice}_${currentSubType}`;
      applyDefaultVizColorStyleForCurrentCargo();

      dom.cargoChipsGeneral.querySelectorAll('.chip-button').forEach(b => {
        b.classList.toggle('active', b.dataset.value === newCargo);
      });

      if (currentCidadeFilter !== 'all') populateBairroDropdown();
      updateElectionTypeUI();
      updateConditionalUI();
      applyFiltersAndRedraw();
      updateSelectionUI(STATE.isFilterAggregationActive);
    });
  }

  // Listener para Chips de TIPO DE ELEIÇÃO (Ordinária / Suplementar)
  // Reutiliza o elemento que antes era só para municipal
  dom.cargoChipsMunicipal.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip-button');
    if (!btn) return;
    currentTurno = 1;
    currentSubType = btn.dataset.type; // 'ord' ou 'sup'
    currentCargo = `${currentOffice}_${currentSubType}`;

    dom.cargoChipsMunicipal.querySelectorAll('.chip-button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if (currentCidadeFilter !== 'all') populateBairroDropdown();
    updateConditionalUI();
    applyFiltersAndRedraw();
    if (selectedLocationIDs.size > 0) updateSelectionUI(STATE.isFilterAggregationActive);
  });

  // Listener para Chips de CARGO MUNICIPAL (Prefeito / Vereador)
  if (dom.officeChipsMunicipal) {
    dom.officeChipsMunicipal.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip-button');
      if (!btn) return;
      const newOffice = btn.dataset.value; // 'prefeito' ou 'vereador'
      if (newOffice === currentOffice) return;

      if (typeof rememberMapViewportForNextLoad === 'function') {
        rememberMapViewportForNextLoad();
      }

      dom.officeChipsMunicipal.querySelectorAll('.chip-button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      currentOffice = newOffice;
      currentSubType = 'ord';
      currentTurno = 1;
      currentCargo = `${currentOffice}_ord`;
      applyDefaultVizColorStyleForCurrentCargo();

      const hasCurrentMunicipalData = !!currentDataCollection[currentCargo];
      const uf = dom.selectUFMunicipal?.value;
      const municipio = dom.selectMunicipio?.value;
      const canAutoLoad = !!(uf && municipio);

      if (hasCurrentMunicipalData) {
        updateElectionTypeUI();
        updateConditionalUI();
        applyFiltersAndRedraw();
        updateSelectionUI(STATE.isFilterAggregationActive);
        updateLoadButtonState();
        clearPendingFilterChanges();
        return;
      }

      if (canAutoLoad) {
        setChipLoading(btn, true);

        Promise.resolve(window.onClickLoadData_Municipal())
          .catch((error) => {
            console.error(`[Auto-Load] Falha ao carregar ${newOffice}:`, error);
            showToast(`Erro ao carregar dados: ${error.message}`, 'error');
          })
          .finally(() => {
            setChipLoading(btn, false);
            updateLoadButtonState();
          });

        return;
      }

      // Sem município selecionado: apenas prepara a UI para o próximo load manual/automático
      clearSelection(true);
      currentDataCollection = {};
      uniqueCidades.clear();
      uniqueBairros.clear();
      STATE.candidates = {}; STATE.metrics = {}; STATE.inaptos = {};
      STATE.dataHas2T = {}; STATE.dataHasInaptos = {};
      clearVereadorData();
      updateLoadButtonState();
      clearPendingFilterChanges();
    });
  }


  // --- CENSUS LISTENERS ---
  // Info Button Logic
  const uniqueInfoBtn = document.getElementById('btnInfoCensus');
  const uniqueInfoOverlay = document.getElementById('infoOverlay');
  const uniqueInfoClose = document.getElementById('btnCloseInfo');

  if (uniqueInfoBtn && uniqueInfoOverlay && uniqueInfoClose) {
    uniqueInfoBtn.addEventListener('click', () => {
      // Stop blinking forever (in this session)
      uniqueInfoBtn.classList.remove('blinking');
      // Show modal
      uniqueInfoOverlay.classList.add('visible');
    });

    const closeInfo = () => {
      uniqueInfoOverlay.classList.remove('visible');
    };

    uniqueInfoClose.addEventListener('click', closeInfo);
    uniqueInfoOverlay.addEventListener('click', (e) => {
      if (e.target === uniqueInfoOverlay) closeInfo();
    });
  }

  // Toggle logic replaced by Tabs
  // Filter Inputs OLD REMOVED - NOW HANDLED BY setupSliders()

  // --- GUIDE MODAL LISTENERS ---
  const btnAppGuide = document.getElementById('btnAppGuide');
  const guideOverlay = document.getElementById('guideOverlay');
  const btnCloseGuide = document.getElementById('btnCloseGuide');

  if (btnAppGuide && guideOverlay && btnCloseGuide) {
    btnAppGuide.addEventListener('click', () => {
      guideOverlay.classList.add('visible');
    });

    const closeGuide = () => {
      guideOverlay.classList.remove('visible');
    };

    btnCloseGuide.addEventListener('click', closeGuide);
    guideOverlay.addEventListener('click', (e) => {
      if (e.target === guideOverlay) closeGuide();
    });
  }
}

// ====== FILTER TABS LOGIC RESTORED ======
// ====== FILTER TABS LOGIC RESTORED ======
function setupTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  console.log(`Setting up ${tabs.length} tabs.`);

  // Lista explícita dos IDs de conteúdo do Censo
  const censusIds = ['tab-renda', 'tab-raca', 'tab-idade', 'tab-genero', 'tab-saneamento', 'tab-escolaridade', 'tab-estadocivil'];
  const refreshCensusAvailabilityBars = () => {
    const geojson = currentDataCollection[currentCargo];
    if (!geojson || typeof updateAvailabilityBars !== 'function') return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        updateAvailabilityBars(geojson);
      });
    });
  };
  const enhanceScrollableTabStrip = (container) => {
    if (!container || container.dataset.dragScrollReady === 'true') return;
    container.dataset.dragScrollReady = 'true';

    let pointerDown = false;
    let dragging = false;
    let startX = 0;
    let startScrollLeft = 0;
    let suppressClick = false;

    container.addEventListener('wheel', (e) => {
      const canScroll = container.scrollWidth > container.clientWidth + 4;
      if (!canScroll) return;
      const dominantDelta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (dominantDelta === 0) return;
      container.scrollLeft += dominantDelta;
      e.preventDefault();
    }, { passive: false });

    container.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      pointerDown = true;
      dragging = false;
      startX = e.clientX;
      startScrollLeft = container.scrollLeft;
      suppressClick = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (!pointerDown) return;
      const deltaX = e.clientX - startX;
      if (!dragging && Math.abs(deltaX) > 6) {
        dragging = true;
        suppressClick = true;
        container.classList.add('dragging-tabs');
      }
      if (!dragging) return;
      container.scrollLeft = startScrollLeft - deltaX;
      e.preventDefault();
    });

    window.addEventListener('mouseup', () => {
      pointerDown = false;
      dragging = false;
      container.classList.remove('dragging-tabs');
      setTimeout(() => { suppressClick = false; }, 0);
    });

    container.addEventListener('click', (e) => {
      if (!suppressClick) return;
      e.preventDefault();
      e.stopPropagation();
    }, true);
  };

  document.querySelectorAll('.filter-tabs').forEach(enhanceScrollableTabStrip);

  const selectDemo = document.getElementById('selectDemoCategory');
  if (selectDemo) {
    const syncCensusTabVisibility = (targetId) => {
      censusIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle('hidden', id !== targetId);
        if (id === targetId) el.classList.remove('section-hidden');
      });
      refreshCensusAvailabilityBars();
    };

    syncCensusTabVisibility(selectDemo.value || 'tab-renda');
    selectDemo.addEventListener('change', () => {
      syncCensusTabVisibility(selectDemo.value);
    });
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.dataset.tab;
      console.log(`Tab clicked: ${targetId}`);

      // 1. Update Active State
      const parent = tab.closest('.filter-tabs') || tab.closest('.tabs') || tab.parentElement;
      if (parent) {
        parent.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        if (parent.classList.contains('filter-tabs')) {
          tab.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
        }
      }

      if (!targetId) return;

      // 2. Switch Content
      if (censusIds.includes(targetId)) {
        censusIds.forEach(id => {
          const el = document.getElementById(id);
          if (el) {
            if (id === targetId) {
              el.classList.remove('hidden', 'section-hidden');
              // For animation restart if desired
              el.style.animation = 'none';
              el.offsetHeight; /* trigger reflow */
              el.style.animation = null;
            } else {
              el.classList.add('hidden');
            }
          } else {
            console.warn(`Tab content element not found: ${id}`);
          }
        });
        refreshCensusAvailabilityBars();
      } else {
        const content = document.getElementById(targetId);
        if (content) content.classList.remove('hidden');
      }
    });
  });
}

// ====== SLIDERS LOGIC ======
function setupSliders() {
  // Definimos a função de redesenho PRIMEIRO para evitar erros de referência
  const debouncedMarkDirty = debounce(() => {
    clearSelection(false);
    markFiltersDirty();
  }, 100);
  const debouncedAutoApplyFilters = debounce(() => {
    if (!currentDataCollection[currentCargo] || STATE.isLoadingDataset) return;
    applyFiltersAndRedraw();
    clearPendingFilterChanges();
  }, 180);

  // 1. DUAL SLIDER (RENDA)
  const track = document.querySelector('.dual-track');
  const range = document.getElementById('rendaRange');
  const thumbMin = document.getElementById('rendaThumbMin');
  const thumbMax = document.getElementById('rendaThumbMax');
  const container = document.getElementById('sliderRendaContainer');
  const dispMin = document.getElementById('dispRendaMin');
  const dispMax = document.getElementById('dispRendaMax');

  const MAX_VAL = 10000; // R$ 10k
  let valMin = 0;
  let valMax = MAX_VAL;

  function updateDualVisuals() {
    const pctMin = (valMin / MAX_VAL) * 100;
    const pctMax = (valMax / MAX_VAL) * 100;

    if (thumbMin) thumbMin.style.left = `${pctMin}%`;
    if (thumbMax) thumbMax.style.left = `${pctMax}%`;
    if (range) {
      range.style.left = `${pctMin}%`;
      range.style.width = `${pctMax - pctMin}%`;
    }

    if (dispMin) dispMin.textContent = valMin.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
    if (dispMax) dispMax.textContent = valMax >= MAX_VAL ?
      MAX_VAL.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) + "+" :
      valMax.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  }

  function updateRendaState() {
    STATE.censusFilters.rendaMin = valMin > 0 ? valMin : null;
    STATE.censusFilters.rendaMax = valMax < MAX_VAL ? valMax : null;
    debouncedMarkDirty();
    updateApplyButtonText();
    debouncedAutoApplyFilters();
  }

  const debouncedRenda = debounce(updateRendaState, 200);

  // Drag Logic
  function initDrag(thumb, isMin) {
    if (!thumb) return;
    thumb.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const containerRect = container.getBoundingClientRect();

      function onMove(moveE) {
        let x = moveE.clientX - containerRect.left;
        let pct = Math.max(0, Math.min(100, (x / containerRect.width) * 100));
        let val = Math.round((pct / 100) * MAX_VAL);

        if (isMin) {
          val = Math.min(val, valMax - 100);
          valMin = val;
        } else {
          val = Math.max(val, valMin + 100);
          valMax = val;
        }

        updateDualVisuals();
        debouncedRenda();
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  initDrag(thumbMin, true);
  initDrag(thumbMax, false);

  // 2. SIMPLE SLIDERS (DYNAMIC)
  // Helper para configurar o par Slider + Select
  function setupDynamicFilter(idSlider, idInput, idSelect, idDisp, idValDisp, stateKeyVal, stateKeyMode) {
    const slider = document.getElementById(idSlider);
    const input = document.getElementById(idInput);
    const select = document.getElementById(idSelect);
    const disp = document.getElementById(idDisp);
    const valDisp = document.getElementById(idValDisp);

    if (!slider || !select) return;

    const validModes = Array.from(select.options).map(option => option.value);
    const initialMode = validModes.includes(STATE.censusFilters[stateKeyMode])
      ? STATE.censusFilters[stateKeyMode]
      : select.value;
    select.value = initialMode;
    STATE.censusFilters[stateKeyMode] = initialMode;
    const initialVal = parseInt(slider.value, 10) || 0;
    if (input) input.value = initialVal;
    if (disp) disp.textContent = `${initialVal}%`;
    if (valDisp) valDisp.textContent = `${initialVal}%`;

    const applyDynamicValue = (rawVal) => {
      const val = Math.max(0, Math.min(100, parseInt(rawVal, 10) || 0));
      slider.value = val;
      if (input) input.value = val;
      if (disp) disp.textContent = `${val}%`;
      if (valDisp) valDisp.textContent = `${val}%`;

      STATE.censusFilters[stateKeyVal] = val > 0 ? val : null;
      debouncedMarkDirty();
      updateApplyButtonText();
      debouncedAutoApplyFilters();
    };

    // Atualiza Estado e UI quando o slider move
    slider.addEventListener('input', () => {
      applyDynamicValue(slider.value);
    });

    if (input) {
      input.addEventListener('input', () => {
        applyDynamicValue(input.value);
      });
      input.addEventListener('change', () => {
        applyDynamicValue(input.value);
      });
    }

    // Atualiza Estado e UI quando o select muda
    select.addEventListener('change', () => {
      const mode = select.value;
      STATE.censusFilters[stateKeyMode] = mode;

      // Atualização imediata visual (barra listrada)
      const geojson = currentDataCollection[currentCargo];
      if (geojson) {
        // Se a função updateAvailabilityBars estiver disponível globalmente (deve estar)
        updateAvailabilityBars(geojson);
      }

      // Se houver valor de filtro aplicado, redesenha o mapa
      if (STATE.censusFilters[stateKeyVal] !== null) {
        debouncedMarkDirty();
        debouncedAutoApplyFilters();
      } else if (currentDataCollection[currentCargo] && !STATE.isLoadingDataset) {
        clearSelection(false);
        applyFiltersAndRedraw();
        clearPendingFilterChanges();
      }
    });
  }

  setupDynamicFilter('sliderRaca', 'inputRaca', 'selectRaca', 'dispRaca', 'valDispRaca', 'racaVal', 'racaMode');
  setupDynamicFilter('sliderIdosos', 'inputIdade', 'selectIdade', 'dispIdosos', 'valDispIdosos', 'idadeVal', 'idadeMode');
  setupDynamicFilter('sliderGenero', 'inputGenero', 'selectGenero', 'dispGenero', 'valDispGenero', 'generoVal', 'generoMode');
  setupDynamicFilter('sliderEscolaridade', 'inputEscolaridade', 'selectEscolaridade', 'dispEscolaridade', 'valDispEscolaridade', 'escolaridadeVal', 'escolaridadeMode');
  setupDynamicFilter('sliderEstadoCivil', 'inputEstadoCivil', 'selectEstadoCivil', 'dispEstadoCivil', 'valDispEstadoCivil', 'estadoCivilVal', 'estadoCivilMode');
  setupDynamicFilter('sliderSaneamento', 'inputSaneamento', 'selectSaneamento', 'dispSaneamento', 'valDispSaneamento', 'saneamentoVal', 'saneamentoMode');
}

// ====== RESULTS TABS REMOVED ======
