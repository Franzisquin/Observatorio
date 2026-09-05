function setupControls() {
  // Popular UF Geral (Brasil por padrão)
  dom.selectUFGeneral.innerHTML = '';
  UF_MAP.forEach((nome, sigla) => {
    const opt = document.createElement('option');
    opt.value = sigla;
    opt.textContent = isAggregateScope(sigla) ? nome : `${nome} (${sigla})`;
    if (sigla === 'BR') opt.selected = true;
    dom.selectUFGeneral.appendChild(opt);
  });
  dom.selectUFGeneral.value = 'BR';

  // Popular UF Municipal
  dom.selectUFMunicipal.innerHTML = '';
  ALL_STATE_SIGLAS.forEach(sigla => {
    if (sigla === 'DF') return;
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
      // BR e escopo proprio: qualquer cargo tem visao nacional (agregada).
      return true;
    }

    return !!(dom.selectUFMunicipal?.value && dom.selectMunicipio?.value);
  };

  const runInstantLoad = async () => {
    if (STATE.isLoadingDataset || !canInstantLoadCurrentContext()) return;
    if (typeof rememberMapViewportForNextLoad === 'function') {
      rememberMapViewportForNextLoad();
    }

    // Escopo nacional nao passa pelos loaders por UF: le so os agregados.
    if (typeof isNationalGeneralScope === 'function' && isNationalGeneralScope()) {
      await window.showNationalOverview();
      return;
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
      window.resetAllCensusFilters?.();
      updateCensusControlsForYear();

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
        updateCargoChipsVisibility();
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
      updateCargoChipsVisibility();
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

    // Escopo nacional: todo cargo tem visao nacional e ela nao depende de nada
    // que ja esteja em memoria — remonta direto.
    if (typeof isNationalGeneralScope === 'function' && isNationalGeneralScope()) {
      dom.cargoChipsGeneral.querySelectorAll('.chip-button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setChipLoading(btn, true);
      Promise.resolve(window.showNationalOverview({ keepViewport: true }))
        .finally(() => {
          setChipLoading(btn, false);
          updateLoadButtonState();
        });
      return;
    }

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
        if (currentOffice === 'deputado' && typeof syncDeputyDataForCargo === 'function') {
          syncDeputyDataForCargo(currentCargo);
        }
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

    // BR nao e mais limpo aqui: virou escopo nacional valido para todo cargo, e
    // o caminho nacional acima ja retornou antes de chegar neste ponto.

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
    window.resetAllCensusFilters?.();
    updateCensusControlsForYear();
    currentRegionFilter = { level: '', code: '' };
    currentCidadeFilter = 'all';
    currentBairroFilter = 'all';
    currentLocalFilter = '';
    if (dom.searchLocal) dom.searchLocal.value = '';
    // Sair de um escopo agregado: nem 'uf' nem 'pais' existem dentro de um
    // estado, entao o mapa volta ao coropletico municipal.
    if (STATE.currentRegionLevel === NATIONAL_UF_LEVEL || STATE.currentRegionLevel === 'pais') {
      STATE.currentRegionLevel = '';
      STATE.currentMapMode = 'municipios';
    }
    // Os circulos dos consulados sao uma camada propria da diaspora e nao saem
    // com a troca de malha; so o proprio escopo sabe recolhe-los.
    if (!isDiasporaScope() && typeof leaveDiasporaMapState === 'function') {
      leaveDiasporaMapState();
    }
    populateRegionalDropdowns();
    updateLoadButtonState();
    // O exterior so tem presidente, entao os chips dependem tambem da UF -- nao
    // so do ano, que era o unico gatilho ate aqui.
    updateCargoChipsVisibility();
    if (canInstantLoadCurrentContext()) {
      scheduleInstantLoad();
    }
  });

  dom.selectYearGeneral?.addEventListener('change', () => {
    STATE.currentElectionYear = dom.selectYearGeneral.value;
    window.resetAllCensusFilters?.();
    updateCensusControlsForYear();
    updateLoadButtonState();
    updateCargoChipsVisibility();
    if (canInstantLoadCurrentContext()) {
      scheduleInstantLoad();
    }
  });

  // SELEÇÃO MUNICIPAL
  dom.selectUFMunicipal.addEventListener('change', () => {
    window.resetAllCensusFilters?.();
    updateCensusControlsForYear();
    currentTurno = 1;
    currentBairroFilter = 'all';
    currentLocalFilter = '';
    STATE.currentMuniCode = null;
    STATE.pendingMunicipalFocusBounds = null;
    if (dom.inputBairro) {
      dom.inputBairro.disabled = true;
      dom.inputBairro.value = 'all';
    }
    if (dom.searchLocal) dom.searchLocal.value = '';
    clearSelection(false);
    const uf = dom.selectUFMunicipal.value;
    const municipios = MUNICIPAL_DATA_INDEX[uf] || [];

    dom.selectMunicipio.innerHTML = '<option value="" selected>Resumo estadual</option>';
    municipios.sort((a, b) => a.localeCompare(b, 'pt-BR')).forEach(nome => {
      const opt = document.createElement('option');
      opt.value = nome;
      opt.textContent = toTitleCase(nome);
      dom.selectMunicipio.appendChild(opt);
    });

    const hasMunis = municipios.length > 0;
    dom.selectMunicipio.disabled = !hasMunis;
    dom.searchMunicipio.disabled = !hasMunis;
    dom.searchMunicipio.value = '';

    if (!hasMunis && uf) {
      dom.selectMunicipio.innerHTML = '<option value="" disabled selected>Dados não indexados</option>';
    }
    // Troca de UF: o proximo load municipal deve fazer full clear.
    LAST_MUNICIPAL_GPKG_KEY = null;
    updateLoadButtonState();

    if (uf && typeof window.showMunicipalStatewideOverview === 'function') {
      window.showMunicipalStatewideOverview(uf, STATE.currentElectionYear, currentSubType || 'ord');
    }
  });
  dom.selectMunicipio.addEventListener('change', () => {
    window.resetAllCensusFilters?.();
    updateCensusControlsForYear();
    currentTurno = 1;
    currentBairroFilter = 'all';
    currentLocalFilter = '';
    if (dom.inputBairro) {
      dom.inputBairro.disabled = true;
      dom.inputBairro.value = 'all';
    }
    if (dom.searchLocal) dom.searchLocal.value = '';
    clearSelection(false);
    updateLoadButtonState();
    updateElectionTypeUI();
    updateConditionalUI();
    if (!dom.selectMunicipio.value) {
      STATE.currentMuniCode = null;
      STATE.pendingMunicipalFocusBounds = null;
      const uf = dom.selectUFMunicipal?.value;
      if (uf && typeof window.showMunicipalStatewideOverview === 'function') {
        window.showMunicipalStatewideOverview(uf, STATE.currentElectionYear, currentSubType || 'ord');
      }
      return;
    }

    if (typeof window.refreshMunicipalSelectionOverlay === 'function') {
      window.refreshMunicipalSelectionOverlay({ focus: true });
    }

    scheduleInstantLoad();
  });

  dom.selectYearMunicipal?.addEventListener('change', () => {
    currentTurno = 1;
    STATE.currentElectionYear = dom.selectYearMunicipal.value;
    window.resetAllCensusFilters?.();
    updateCensusControlsForYear();
    clearSelection(false);
    updateLoadButtonState();
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



  // FILTRO REGIONAL — um select so, valor "nivel:codigo" (ver populateRegionalDropdowns).
  if (dom.selectRegiao) {
    dom.selectRegiao.addEventListener('change', (e) => {
      const [level, code] = String(e.target.value || '').split(':');
      // Nivel estado: nao e recorte dentro da UF corrente, e troca de escopo.
      if (level === 'uf' && code) {
        window.enterStateFromNationalView(code);
        return;
      }
      applyRegionSelection(code ? { level, code } : { level: '', code: '' });
    });
  }

  // Botoes de nivel de regiao na barra do mapa (delegado: um handler para os 4).
  if (dom.layerToggleGroup) {
    dom.layerToggleGroup.addEventListener('click', (e) => {
      const level = e.target.closest('[data-region-level]')?.dataset.regionLevel;
      if (!level) return;
      const uf = String(dom.selectUFGeneral?.value || '').toUpperCase();
      if (STATE.currentElectionType !== 'geral' || !uf) return;
      // No escopo nacional so existe o nivel 'uf'; dentro de uma UF ele nao faz
      // sentido (voltar ao pais e escolher "Brasil" no seletor de UF).
      // Nos escopos agregados so existe o nivel proprio do escopo: 'uf' no
      // Brasil, 'pais' no exterior (este sem botao na barra).
      if (isAggregateScope(uf)) {
        if (uf === 'BR' && level === NATIONAL_UF_LEVEL) {
          void window.showNationalOverview({ keepViewport: true });
        }
        return;
      }
      if (level === NATIONAL_UF_LEVEL) return;

      currentRegionFilter = { level: '', code: '' };
      currentCidadeFilter = 'all';
      currentBairroFilter = 'all';
      currentLocalFilter = '';
      if (dom.searchLocal) dom.searchLocal.value = '';
      STATE.currentRegionLevel = level;
      STATE.currentMapMode = 'regioes';
      clearSelection(true);
      populateRegionalDropdowns();
      populateCidadeDropdown();
      populateBairroDropdown();
      applyFiltersAndRedraw();
    });
  }

  // "Areas de Ponderacao": o par de "Locais de Votacao". Nenhum dos dois troca de
  // escopo — sao o detalhe desenhado por cima da malha municipal, que continua
  // la mostrando o resto do estado. Trocar de escopo e com Municipios /
  // Intermediarias / Imediatas.
  if (dom.btnMapModeAp) {
    dom.btnMapModeAp.addEventListener('click', () => {
      if (!apLevelApplies()) return;
      STATE.detalhe = 'areas';
      STATE.currentMapMode = 'locais';
      forgetOverviewFit();
      clearSelection(true);
      applyFiltersAndRedraw();
    });
  }

  // Entrar/sair de uma regiao: usado pelo select, pelo clique no mapa de regioes
  // e pelo botao de voltar. Deixa o mapa no coropletico municipal recortado.
  window.applyRegionSelection = function (regiao) {
    currentRegionFilter = { level: regiao.level || '', code: regiao.code || '' };
    currentCidadeFilter = 'all';
    currentBairroFilter = 'all';
    currentLocalFilter = '';
    if (dom.searchLocal) dom.searchLocal.value = '';
    // Vindo do modo Locais (municipio clicado), sem isto o coropletico some em
    // vez de redesenhar: shouldRenderGeneralMunicipalityOverview() barraria o
    // rebuild e a camada de municipios seria removida.
    // Entrar numa AREA DE PONDERACAO e a excecao: ela e sub-municipal, entao o
    // que ha dentro dela sao locais de votacao, nao municipios — o coropletico
    // municipal recortado por area sairia vazio.
    if (currentRegionFilter.level === 'ap') {
      // Dentro de uma area o que ha sao locais de votacao.
      STATE.detalhe = 'locais';
      STATE.currentMapMode = 'locais';
    } else {
      // Em 2022/presidente o passo abaixo de uma regiao e a AREA DE PONDERACAO.
      // O modo continua 'municipios' para a malha municipal da regiao ser
      // construida — e ela o fundo por cima do qual as areas sao desenhadas;
      // showGeneralMunicipalityOverview passa o detalhe assim que ela existe.
      if (currentRegionFilter.code && apLevelApplies()) STATE.detalhe = 'areas';
      STATE.currentMapMode = 'municipios';
    }
    // Recorta o mapa na regiao ja, sem esperar o rebuild assincrono do
    // coropletico (que nem sempre acontece — ha caminhos que so re-estilizam).
    applyRegionScopeToMunicipiosLayer();
    clearSelection(false);
    populateRegionalDropdowns();
    populateCidadeDropdown();
    populateBairroDropdown();
    debouncedAutoApplyFilters();
  };

  

  if (dom.btnMapModeMunicipios) {
    dom.btnMapModeMunicipios.addEventListener('click', () => {
      if (STATE.currentElectionType === 'geral') {
        const uf = String(dom.selectUFGeneral?.value || '').toUpperCase();
        if (!uf || uf === 'BR') return;

        currentCidadeFilter = 'all';
        currentBairroFilter = 'all';
        currentLocalFilter = '';
        
        if (dom.searchLocal) dom.searchLocal.value = '';

        STATE.currentMapMode = 'municipios';
        clearSelection(true);
        applyFiltersAndRedraw();
        if (typeof window.syncExtrusionButtonVisibility === 'function') {
          window.syncExtrusionButtonVisibility();
        }
        return;
      }

      const uf = dom.selectUFMunicipal?.value;
      if (uf && typeof window.showMunicipalStatewideOverview === 'function') {
        if (dom.selectMunicipio?.value) {
          dom.selectMunicipio.value = '';
          STATE.currentMuniCode = null;
          STATE.pendingMunicipalFocusBounds = null;
        }
        window.showMunicipalStatewideOverview(uf, STATE.currentElectionYear, currentSubType || 'ord');
      }
      if (typeof window.syncExtrusionButtonVisibility === 'function') {
        window.syncExtrusionButtonVisibility();
      }
    });
  }

  if (dom.btnMapModeLocais) {
    dom.btnMapModeLocais.addEventListener('click', () => {
      STATE.detalhe = 'locais';
      STATE.currentMapMode = 'locais';
      forgetOverviewFit();
      if (STATE.municipiosLayer) {
        STATE.municipiosLayer.setExtrusionEnabled(false).refresh();
      }
      clearSelection(true);
      applyFiltersAndRedraw();
      if (typeof window.syncExtrusionButtonVisibility === 'function') {
        window.syncExtrusionButtonVisibility();
      }
    });
  }

  // ====== CONTROLES DO MAPA 3D ======
  STATE.extrusion3DEnabled = false;
  STATE.extrusionMetric = 'votes'; // Fixo por Votos

  function setExtrusionMetric(metric) {
    STATE.extrusionMetric = 'votes';
    if (STATE.municipiosLayer) {
      STATE.municipiosLayer.refresh();
    }
  }
  window.setExtrusionMetric = setExtrusionMetric;

  const btnToggle3D = document.getElementById('btnToggle3D');
  const btnToggleExtrusion = document.getElementById('btnToggleExtrusion');
  const btnToggle3DMetric = document.getElementById('btnToggle3DMetric');
  const viz3DMetricChips = document.getElementById('viz3DMetricChips');

  if (btnToggle3D) {
    btnToggle3D.addEventListener('click', () => {
      const isActive = btnToggle3D.classList.contains('active');
      if (isActive) {
        // Desativar 3D
        map.easeTo({
          pitch: 0,
          bearing: 0,
          duration: 800
        });
      } else {
        // Ativar 3D
        map.easeTo({
          pitch: 55,
          bearing: -15,
          duration: 1000
        });
      }
    });
  }

  if (btnToggleExtrusion) {
    btnToggleExtrusion.addEventListener('click', () => {
      STATE.extrusion3DEnabled = !STATE.extrusion3DEnabled;
      btnToggleExtrusion.classList.toggle('active', STATE.extrusion3DEnabled);
      
      if (map) {
        if (STATE.extrusion3DEnabled) {
          map.easeTo({ pitch: 58, bearing: -20, duration: 800 });
        } else {
          map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
        }
      }

      if (typeof window.syncExtrusionButtonVisibility === 'function') {
        window.syncExtrusionButtonVisibility();
      }

      // Atualizar a camada de municípios com o novo estado de extrusão
      if (STATE.municipiosLayer) {
        STATE.municipiosLayer.setExtrusionEnabled(STATE.extrusion3DEnabled && isPolygonMapMode()).refresh();
      }
    });
  }



  

  const shouldAutoFrameFilteredArea = () => (
    hasRegionalScopeFilters() ||
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
    if (!allFiltered.length) {
      // Municipio sem dados por local (totais do munzona): mostra o resultado geral.
      if (typeof renderMunicipalOfficialOnlySidebar === 'function') {
        renderMunicipalOfficialOnlySidebar();
      }
      return;
    }

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
  }, 180);

  dom.searchLocal.addEventListener('input', (e) => {
    currentLocalFilter = norm(e.target.value);
    clearSelection(false);
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
  
  if (dom.inputBairro) {
    dom.inputBairro.addEventListener('change', (e) => {
      currentBairroFilter = e.target.value;
      clearSelection(false);
      if (typeof applyFiltersAndRedraw === 'function') applyFiltersAndRedraw();
    });
  }
  // Removed old calls for Cidade/Bairro
  addSearchFilter(dom.searchMunicipio, dom.selectMunicipio);


  if (dom.btnToggleInaptos) {
    dom.btnToggleInaptos.addEventListener('click', () => {
      STATE.filterInaptos = !STATE.filterInaptos;
      dom.btnToggleInaptos.classList.toggle('active', STATE.filterInaptos);
      dom.btnToggleInaptos.textContent = STATE.filterInaptos ? 'Inaptos Filtrados' : 'Filtrar Inaptos';

      // No resumo estadual das municipais applyFiltersAndRedraw sai logo na
      // primeira linha (o coropletico e gerido por showMunicipalStatewideOverview),
      // entao o botao nao chegava a repintar o mapa. Aqui o resumo e recomposto
      // a partir do canonico ja em memoria — sem rede, sem reabrir zip.
      if (STATE.currentElectionType === 'municipal' && !dom.selectMunicipio?.value) {
        void window.refreshMunicipalStatewideOverviewForTurn({ syncResults: true });
      } else {
        applyFiltersAndRedraw();
      }

      if (selectedLocationIDs.size > 0) updateSelectionUI(STATE.isFilterAggregationActive);
    });
  }

  if (dom.btnToggleRules) {
    dom.btnToggleRules.addEventListener('click', () => {
      STATE.showProportionalRules = !STATE.showProportionalRules;
      dom.btnToggleRules.classList.toggle('active', STATE.showProportionalRules);
      dom.btnToggleRules.textContent = STATE.showProportionalRules ? 'Ocultar Regras' : 'Mostrar Regras';
      
      if (dom.btnExplainRules) {
        dom.btnExplainRules.style.display = STATE.showProportionalRules ? '' : 'none';
      }

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
      // Only redraw if not switching to desempenho without a candidate
      if (!currentVizMode.startsWith('desempenho') || (dom.selectVizCandidato.value && dom.selectVizCandidato.value !== '__placeholder__')) {
        applyFiltersAndRedraw();
      }
    });
  }
  if (dom.selectVizColorStyle) {
    dom.selectVizColorStyle.addEventListener('change', (e) => {
      currentVizColorStyle = 'gradient';
      e.target.value = 'gradient';
      applyFiltersAndRedraw();
    });
  }
  // Gradient mode chips: Margem vs % do Vencedor
  if (dom.vizGradientModeChips) {
    dom.vizGradientModeChips.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip-button');
      if (!btn || btn.classList.contains('active')) return;
      dom.vizGradientModeChips.querySelectorAll('.chip-button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentGradientMode = btn.dataset.value || 'margin';
      applyFiltersAndRedraw();
    });
  }
  dom.selectVizSize?.addEventListener('change', (e) => {
    currentVizSize = 'comparecimento';
    if (e.target) e.target.value = 'comparecimento';
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
      console.log('[Desempenho] Stats:', performanceModeStats);

      // Atualizar UI de estatísticas
      updatePerformanceStatsUI();

      applyFiltersAndRedraw();
    }
    });
  }

  if (dom.btnClearSelection) {
    dom.btnClearSelection.addEventListener('click', () => {
      // Voltar sobe UM nivel de cada vez: local -> municipio -> regiao -> estado.
      // Sem pilha de historico: o nivel a exibir e o do proprio filtro removido.
      if (STATE.currentElectionType === 'geral'
        && currentCidadeFilter === 'all' && hasRegionalScopeFilters()) {
        STATE.currentRegionLevel = currentRegionFilter.level;
        currentRegionFilter = { level: '', code: '' };
        currentBairroFilter = 'all';
        currentLocalFilter = '';
        if (dom.searchLocal) dom.searchLocal.value = '';
        STATE.currentMapMode = 'regioes';
        clearSelection(true);
        populateRegionalDropdowns();
        populateCidadeDropdown();
        populateBairroDropdown();
        applyFiltersAndRedraw();
        if (typeof window.syncExtrusionButtonVisibility === 'function') {
          window.syncExtrusionButtonVisibility();
        }
        return;
      }

      if (STATE.currentElectionType === 'geral' && currentCidadeFilter !== 'all') {
        currentCidadeFilter = 'all';
        currentBairroFilter = 'all';
        currentLocalFilter = '';
        
        if (dom.searchLocal) dom.searchLocal.value = '';
        
        STATE.currentMapMode = 'municipios';
        if (dom.inputBairro) { 
          dom.inputBairro.disabled = true; 
          dom.inputBairro.value = 'all'; 
        }
        clearSelection(true);
        applyFiltersAndRedraw();
        if (typeof window.syncExtrusionButtonVisibility === 'function') {
          window.syncExtrusionButtonVisibility();
        }
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
        if (dom.inputBairro) { 
          dom.inputBairro.disabled = true; 
          dom.inputBairro.value = 'all'; 
        }
        clearSelection(true);
        updateElectionTypeUI();
        updateConditionalUI();
        const uf = dom.selectUFMunicipal?.value;
        if (uf && typeof window.showMunicipalStatewideOverview === 'function') {
          window.showMunicipalStatewideOverview(uf, STATE.currentElectionYear, currentSubType || 'ord');
        }
        if (typeof window.syncExtrusionButtonVisibility === 'function') {
          window.syncExtrusionButtonVisibility();
        }
        return;
      }

      if (dom.inputBairro) { 
          dom.inputBairro.disabled = true; 
          dom.inputBairro.value = 'all'; 
        }
        clearSelection(true);
      applyFiltersAndRedraw();
      if (typeof window.syncExtrusionButtonVisibility === 'function') {
        window.syncExtrusionButtonVisibility();
      }
    });
  }

  // VOLTAR UM NIVEL DE ABRANGENCIA: municipio/regiao -> estado -> Brasil.
  if (dom.btnScopeBack) {
    dom.btnScopeBack.addEventListener('click', () => {
      const target = window.getScopeBackTarget?.();
      if (!target) return;

      if (target.kind === 'geral-br') {
        // Trocar o seletor basta: o listener de UF ja limpa filtros e o
        // carregamento instantaneo cai em showNationalOverview.
        dom.selectUFGeneral.value = 'BR';
        dom.selectUFGeneral.dispatchEvent(new Event('change'));
        return;
      }

      if (target.kind === 'geral-uf') {
        // Volta ao estado inteiro de uma vez: derruba regiao E municipio no
        // mesmo clique (o ✕ e que sobe de um em um).
        currentRegionFilter = { level: '', code: '' };
        currentCidadeFilter = 'all';
        currentBairroFilter = 'all';
        currentLocalFilter = '';
        STATE.currentRegionLevel = '';
        STATE.currentMapMode = 'municipios';
        if (dom.searchLocal) dom.searchLocal.value = '';
        if (dom.inputBairro) {
          dom.inputBairro.disabled = true;
          dom.inputBairro.value = 'all';
        }
        if (cidadeCombobox) cidadeCombobox.setValue('Todos os municipios');
        clearSelection(true);
        populateRegionalDropdowns();
        populateCidadeDropdown();
        populateBairroDropdown();
        applyFiltersAndRedraw();
        if (typeof window.syncExtrusionButtonVisibility === 'function') {
          window.syncExtrusionButtonVisibility();
        }
        return;
      }

      if (target.kind === 'municipal-uf') {
        currentOffice = 'prefeito';
        currentSubType = 'ord';
        currentCargo = 'prefeito_ord';
        applyDefaultVizColorStyleForCurrentCargo();
        dom.officeChipsMunicipal?.querySelectorAll('.chip-button').forEach((b) => {
          b.classList.toggle('active', b.dataset.value === 'prefeito');
        });
        dom.selectMunicipio.value = '';
        if (dom.inputBairro) {
          dom.inputBairro.disabled = true;
          dom.inputBairro.value = 'all';
        }
        clearSelection(true);
        updateElectionTypeUI();
        updateConditionalUI();
        const uf = dom.selectUFMunicipal?.value;
        if (uf && typeof window.showMunicipalStatewideOverview === 'function') {
          window.showMunicipalStatewideOverview(uf, STATE.currentElectionYear, currentSubType || 'ord');
        }
        if (typeof window.syncExtrusionButtonVisibility === 'function') {
          window.syncExtrusionButtonVisibility();
        }
      }
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

  // Expansao de detalhes do candidato (vice/coligacao) nas linhas majoritarias.
  // Delegado no container (a tabela e re-renderizada a cada redraw).
  if (dom.resultsContent) {
    dom.resultsContent.addEventListener('click', (e) => {
      if (e.target.closest('.swatch-button') || e.target.closest('.cand-details-panel')) return;
      const row = e.target.closest('.cand-table tbody tr[data-cand-nome]');
      if (!row || typeof toggleCandidateDetails !== 'function') return;
      const cell = row.querySelector('td.align-left');
      if (!cell) return;
      toggleCandidateDetails(cell, row.dataset.candNome, row.dataset.candPartido, row.dataset.status || '');
    });
  }

  // Listener para Chips de TIPO DE ELEIÇÃO nas gerais (Ordinária / Suplementar)
  if (dom.cargoChipsGeneralSubtype) {
    dom.cargoChipsGeneralSubtype.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip-button');
      if (!btn || btn.classList.contains('active')) return;
      currentTurno = 1;
      currentSubType = btn.dataset.type; // 'ord' ou 'sup'
      currentCargo = `${currentOffice}_${currentSubType}`;

      dom.cargoChipsGeneralSubtype.querySelectorAll('.chip-button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (currentCidadeFilter !== 'all') populateBairroDropdown();
      updateConditionalUI();
      applyFiltersAndRedraw();
      if (selectedLocationIDs.size > 0) updateSelectionUI(STATE.isFilterAggregationActive);
    });
  }

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
    });
  }


  // Recolher/expandir o perfil demografico. So mexe na classe do container: o
  // display: none de updateElectionTypeUI (que esconde o perfil por contexto)
  // continua valendo por cima, sem conflito.
  const btnToggleProfile = document.getElementById('btnToggleProfile');
  if (btnToggleProfile && dom.neighborhoodProfile) {
    btnToggleProfile.addEventListener('click', () => {
      const recolhido = dom.neighborhoodProfile.classList.toggle('collapsed');
      btnToggleProfile.setAttribute('aria-expanded', String(!recolhido));
      btnToggleProfile.title = recolhido
        ? 'Expandir o perfil demográfico'
        : 'Recolher o perfil demográfico';
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


}

// ====== FILTER TABS LOGIC RESTORED ======
// ====== FILTER TABS LOGIC RESTORED ======
function setupTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  console.log(`Setting up ${tabs.length} tabs.`);

  // Lista explícita dos IDs de conteúdo do Censo
  const censusIds = ['tab-renda', 'tab-raca', 'tab-idade', 'tab-escolaridade', 'tab-saneamento'];
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

// ====== CHIPS DE FILTROS DEMOGRAFICOS ATIVOS ======
//
// O painel mostra uma categoria por vez no <select>, entao configurar Renda,
// trocar para Cor/Raca e configurar tambem deixava OS DOIS filtrando o mapa sem
// nenhuma pista na tela. Estes chips listam tudo que esta ativo e permitem
// desligar um por um.
function descreverFiltrosCenso() {
  const f = STATE.censusFilters;
  const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const chips = [];

  if (f.rendaMin !== null || f.rendaMax !== null) {
    const de = f.rendaMin !== null ? brl(f.rendaMin) : 'mínimo';
    const ate = f.rendaMax !== null ? brl(f.rendaMax) : 'máximo';
    chips.push({ chaves: ['rendaMin', 'rendaMax'], texto: `Renda: ${de} a ${ate}` });
  }
  if (f.racaVal > 0) {
    chips.push({ chaves: ['racaVal'], texto: `${f.racaMode.replace('Pct ', 'População ')}: ${f.racaVal}%+` });
  }
  if (f.idadeVal > 0) {
    chips.push({ chaves: ['idadeVal'], texto: `Idade ${f.idadeMode}: ${f.idadeVal}%+` });
  }
  if (f.escolaridadeVal > 0) {
    chips.push({ chaves: ['escolaridadeVal'], texto: `Escolaridade ${f.escolaridadeMode}: ${f.escolaridadeVal}%+` });
  }
  if (f.saneamentoVal > 0) {
    chips.push({ chaves: ['saneamentoVal'], texto: `${f.saneamentoMode.replace('Pct ', '')}: ${f.saneamentoVal}%+` });
  }
  return chips;
}

function atualizarChipsCenso() {
  const caixa = document.getElementById('censusActiveFilters');
  const lista = document.getElementById('censusActiveChips');
  if (!caixa || !lista) return;

  const chips = descreverFiltrosCenso();
  caixa.style.display = chips.length ? '' : 'none';
  lista.innerHTML = '';

  chips.forEach((chip) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'filtro-chip';
    el.title = `Remover: ${chip.texto}`;
    el.setAttribute('aria-label', `Remover filtro ${chip.texto}`);
    el.innerHTML = `<span>${escapeHtml(chip.texto)}</span><span aria-hidden="true">×</span>`;
    el.addEventListener('click', () => {
      chip.chaves.forEach((chave) => { STATE.censusFilters[chave] = null; });
      // Devolve o controle da categoria removida ao estado neutro.
      window.resetCensusControlVisual?.(chip.chaves);
      atualizarChipsCenso();
      if (currentDataCollection[currentCargo] && !STATE.isLoadingDataset) {
        clearSelection(false);
        applyFiltersAndRedraw();
      }
    });
    lista.appendChild(el);
  });
}

// ====== SLIDERS LOGIC ======
function setupSliders() {
  // Cada filtro registra { chaves, reset } — as chaves de STATE.censusFilters que
  // ele controla e como devolver o proprio controle ao estado neutro. Serve tanto
  // ao "Limpar filtros" quanto ao X de um chip individual.
  const CENSUS_FILTER_RESETTERS = [];

  const debouncedLimparSelecao = debounce(() => {
    clearSelection(false);
  }, 100);
  const debouncedAutoApplyFilters = debounce(() => {
    if (!currentDataCollection[currentCargo] || STATE.isLoadingDataset) return;
    applyFiltersAndRedraw();
  }, 180);

  // 1. DUAL SLIDER (RENDA)
  //
  // O dominio nao e fixo: a renda media por local vai de ~R$ 700 (AC) a
  // ~R$ 22.400 (DF), enquanto a mediana fica perto de R$ 2.800. Uma escala fixa
  // de 0 a 10.000 desperdicava o primeiro decimo da barra (nenhum local ganha
  // menos de R$ 700) e jogava tudo acima de 10k num balde unico — 14% dos locais
  // do DF. setRendaDominio() reescala a barra para o recorte carregado.
  const range = document.getElementById('rendaRange');
  const thumbMin = document.getElementById('rendaThumbMin');
  const thumbMax = document.getElementById('rendaThumbMax');
  const container = document.getElementById('sliderRendaContainer');
  const dispMin = document.getElementById('dispRendaMin');
  const dispMax = document.getElementById('dispRendaMax');
  const dispFaixa = document.getElementById('dispRendaFaixa');

  const RENDA_DOMINIO_PADRAO = { min: 0, max: 10000 };
  let dominio = { ...RENDA_DOMINIO_PADRAO };
  let passo = 50;
  let valMin = dominio.min;
  let valMax = dominio.max;

  const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const faixaDominio = () => Math.max(1, dominio.max - dominio.min);

  // Passo de R$ 50 na escala padrao; em dominios largos cresce para manter ~200
  // paradas ao longo da barra (senao arrastar vira um ajuste fino inutil).
  const calcPasso = () => Math.max(50, Math.round(faixaDominio() / 200 / 50) * 50);

  const snap = (v) => {
    const bruto = dominio.min + Math.round((v - dominio.min) / passo) * passo;
    return Math.max(dominio.min, Math.min(dominio.max, bruto));
  };

  function updateDualVisuals() {
    const pct = (v) => ((v - dominio.min) / faixaDominio()) * 100;
    const pctMin = pct(valMin);
    const pctMax = pct(valMax);

    if (thumbMin) thumbMin.style.left = `${pctMin}%`;
    if (thumbMax) thumbMax.style.left = `${pctMax}%`;
    if (range) {
      range.style.left = `${pctMin}%`;
      range.style.width = `${Math.max(0, pctMax - pctMin)}%`;
    }

    const noMinimo = valMin <= dominio.min;
    const noMaximo = valMax >= dominio.max;
    if (dispMin) dispMin.textContent = brl(valMin);
    // "+" so quando o topo do dominio e o teto padrao (ai ele agrega tudo acima).
    if (dispMax) dispMax.textContent = noMaximo && dominio.max === RENDA_DOMINIO_PADRAO.max
      ? brl(dominio.max) + '+'
      : brl(valMax);

    // Em repouso os dois numeros sao identicos aos extremos da escala; sem este
    // rotulo nao da para saber se ha filtro aplicado ou nao.
    if (dispFaixa) {
      dispFaixa.textContent = (noMinimo && noMaximo) ? 'Sem filtro de renda' : 'Faixa selecionada';
      dispFaixa.classList.toggle('filtro-inativo', noMinimo && noMaximo);
    }

    [[thumbMin, valMin], [thumbMax, valMax]].forEach(([thumb, valor]) => {
      if (!thumb) return;
      thumb.setAttribute('aria-valuemin', String(dominio.min));
      thumb.setAttribute('aria-valuemax', String(dominio.max));
      thumb.setAttribute('aria-valuenow', String(valor));
      thumb.setAttribute('aria-valuetext', brl(valor));
    });
  }

  function updateRendaState() {
    STATE.censusFilters.rendaMin = valMin > dominio.min ? valMin : null;
    STATE.censusFilters.rendaMax = valMax < dominio.max ? valMax : null;
    atualizarChipsCenso();
    debouncedLimparSelecao();
    debouncedAutoApplyFilters();
  }

  const debouncedRenda = debounce(updateRendaState, 200);

  // Fonte unica de escrita dos dois thumbs: mouse, toque e teclado passam por aqui.
  function setValor(isMin, bruto) {
    const v = snap(bruto);
    if (isMin) valMin = Math.min(v, valMax - passo);
    else valMax = Math.max(v, valMin + passo);
    updateDualVisuals();
    debouncedRenda();
  }

  // Pointer Events cobrem mouse, toque e caneta num caminho so — com mousedown/
  // mousemove o filtro de renda era inarrastavel no celular, apesar de o app ter
  // uma aba "Filtros" propria no mobile.
  function initDrag(thumb, isMin) {
    if (!thumb || !container) return;

    thumb.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      thumb.focus();
      try { thumb.setPointerCapture(e.pointerId); } catch (_) { }
      const rect = container.getBoundingClientRect();

      const onMove = (ev) => {
        const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        setValor(isMin, dominio.min + pct * faixaDominio());
      };
      const onUp = (ev) => {
        try { thumb.releasePointerCapture(ev.pointerId); } catch (_) { }
        thumb.removeEventListener('pointermove', onMove);
        thumb.removeEventListener('pointerup', onUp);
        thumb.removeEventListener('pointercancel', onUp);
      };

      thumb.addEventListener('pointermove', onMove);
      thumb.addEventListener('pointerup', onUp);
      thumb.addEventListener('pointercancel', onUp);
    });

    // Os thumbs ja tinham tabindex="0" e recebiam foco, mas nada respondia.
    thumb.addEventListener('keydown', (e) => {
      const atual = isMin ? valMin : valMax;
      const salto = passo * 10;
      let alvo = null;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') alvo = atual - passo;
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') alvo = atual + passo;
      else if (e.key === 'PageDown') alvo = atual - salto;
      else if (e.key === 'PageUp') alvo = atual + salto;
      else if (e.key === 'Home') alvo = dominio.min;
      else if (e.key === 'End') alvo = dominio.max;
      else return;

      e.preventDefault();
      setValor(isMin, alvo);
    });
  }

  initDrag(thumbMin, true);
  initDrag(thumbMax, false);
  updateDualVisuals();

  // Reescala a barra para o recorte carregado. Os thumbs voltam aos extremos:
  // um valor absoluto do recorte anterior nao significa a mesma coisa aqui.
  window.setRendaDominio = function (min, max) {
    const lo = Number.isFinite(min) ? Math.max(0, Math.floor(min / 500) * 500) : RENDA_DOMINIO_PADRAO.min;
    const hi = Number.isFinite(max) ? Math.ceil(max / 500) * 500 : RENDA_DOMINIO_PADRAO.max;
    const novo = (hi - lo >= 500) ? { min: lo, max: hi } : { ...RENDA_DOMINIO_PADRAO };

    // updateAvailabilityBars roda tambem ao so trocar de categoria no dropdown:
    // sem esta saida antecipada, olhar outro filtro apagaria o de renda.
    if (novo.min === dominio.min && novo.max === dominio.max) return dominio;

    dominio = novo;
    passo = calcPasso();
    valMin = dominio.min;
    valMax = dominio.max;
    STATE.censusFilters.rendaMin = null;
    STATE.censusFilters.rendaMax = null;
    updateDualVisuals();
    atualizarChipsCenso();
    return dominio;
  };

  CENSUS_FILTER_RESETTERS.push({
    chaves: ['rendaMin', 'rendaMax'],
    reset: () => {
      valMin = dominio.min;
      valMax = dominio.max;
      updateDualVisuals();
    }
  });

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

    // Uma frase so para os quatro filtros de porcentagem, e fiel ao codigo: a
    // comparacao em filterFeature e >=, nao >. Em 0 o filtro esta desligado
    // (o estado vira null) — dizer "Maior que 0%" fazia parecer que filtrava.
    const rotuloEstado = (val) => val > 0
      ? `Mostra apenas locais com ${val}% ou mais`
      : 'Sem filtro';

    const applyDynamicValue = (rawVal) => {
      const val = Math.max(0, Math.min(100, parseInt(rawVal, 10) || 0));
      slider.value = val;
      if (input) input.value = val;
      if (disp) disp.textContent = `${val}%`;
      if (valDisp) valDisp.textContent = rotuloEstado(val);
      if (valDisp) valDisp.classList.toggle('filtro-inativo', val === 0);

      STATE.censusFilters[stateKeyVal] = val > 0 ? val : null;
      debouncedLimparSelecao();
      debouncedAutoApplyFilters();
      atualizarChipsCenso();
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

    CENSUS_FILTER_RESETTERS.push({
      chaves: [stateKeyVal],
      reset: () => {
        slider.value = 0;
        if (input) input.value = 0;
        if (disp) disp.textContent = '0%';
        if (valDisp) {
          valDisp.textContent = rotuloEstado(0);
          valDisp.classList.add('filtro-inativo');
        }
      }
    });

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
      atualizarChipsCenso();

      if (STATE.censusFilters[stateKeyVal] !== null) {
        debouncedLimparSelecao();
        debouncedAutoApplyFilters();
      } else if (currentDataCollection[currentCargo] && !STATE.isLoadingDataset) {
        clearSelection(false);
        applyFiltersAndRedraw();
      }
    });
  }

  setupDynamicFilter('sliderRaca', 'inputRaca', 'selectRaca', 'dispRaca', 'valDispRaca', 'racaVal', 'racaMode');
  setupDynamicFilter('sliderIdosos', 'inputIdade', 'selectIdade', 'dispIdosos', 'valDispIdosos', 'idadeVal', 'idadeMode');
  setupDynamicFilter('sliderEscolaridade', 'inputEscolaridade', 'selectEscolaridade', 'dispEscolaridade', 'valDispEscolaridade', 'escolaridadeVal', 'escolaridadeMode');
  setupDynamicFilter('sliderSaneamento', 'inputSaneamento', 'selectSaneamento', 'dispSaneamento', 'valDispSaneamento', 'saneamentoVal', 'saneamentoMode');

  const btnLimparCenso = document.getElementById('btnClearCensusFilters');
  if (btnLimparCenso) {
    btnLimparCenso.addEventListener('click', () => {
      window.resetAllCensusFilters?.();
      if (currentDataCollection[currentCargo] && !STATE.isLoadingDataset) {
        clearSelection(false);
        applyFiltersAndRedraw();
      }
    });
  }

  // Zera os valores dos filtros demograficos (mantendo os modos) e restaura o
  // visual dos sliders. Usado ao voltar para o resumo estadual municipal.
  window.resetAllCensusFilters = function () {
    const f = STATE.censusFilters;
    f.rendaMin = null; f.rendaMax = null;
    f.racaVal = null; f.idadeVal = null;
    f.escolaridadeVal = null; f.saneamentoVal = null;
    CENSUS_FILTER_RESETTERS.forEach((r) => { try { r.reset(); } catch (e) { } });
    atualizarChipsCenso();
  };

  // Devolve ao estado neutro so os controles das chaves pedidas (X de um chip).
  window.resetCensusControlVisual = function (chaves) {
    const alvo = new Set(chaves || []);
    CENSUS_FILTER_RESETTERS
      .filter((r) => r.chaves.some((c) => alvo.has(c)))
      .forEach((r) => { try { r.reset(); } catch (e) { } });
  };

  updateCargoChipsVisibility();
}

function updateCargoChipsVisibility() {
  if (!dom.cargoChipsGeneral) return;
  const year = String(dom.selectYearGeneral?.value || STATE.currentElectionYear);
  // 1989 so teve eleicao presidencial. 1994 em diante tem todos os cargos --
  // 1998 passou a ter deputados quando os arquivos por secao do TSE entraram no
  // acervo (resultados_geo/Legislativas 1998/).
  const is1989 = (year === '1989');
  // No exterior so ha uma urna: presidente. Nao existe governador, senador nem
  // bancada eleita pela diaspora.
  const soPresidente = is1989
    || (typeof isDiasporaScope === 'function' && isDiasporaScope());

  const hiddenCargos = soPresidente
    ? ['governador', 'senador', 'deputado_federal', 'deputado_estadual']
    : [];

  // Classe, nao style inline: as abas do painel direito trazem
  // `display: inline-flex !important`, que ganhava do inline sem prioridade e
  // deixava os cargos indisponiveis visiveis mesmo com a regra por ano correta.
  dom.cargoChipsGeneral.querySelectorAll('.chip-button').forEach((btn) => {
    btn.classList.toggle('hidden', hiddenCargos.includes(btn.dataset.value));
  });

  const currentHidden = hiddenCargos.some((value) => value.startsWith(currentOffice));
  if (currentHidden) {
    // Cargo indisponivel no ano selecionado: volta para presidente.
    currentOffice = 'presidente';
    currentSubType = 'ord';
    currentCargo = 'presidente_ord';

    // Atualiza classes nos chips
    dom.cargoChipsGeneral.querySelectorAll('.chip-button').forEach(b => {
      b.classList.toggle('active', b.dataset.value === 'presidente');
    });

    if (typeof updateElectionTypeUI === 'function') {
      updateElectionTypeUI();
    }
  }
}

// ====== RESULTS TABS REMOVED ======

// --- PROPORTIONAL RULES MODAL GLOBAL HANDLERS ---
window.openProportionalRulesModal = function() {
  const overlay = document.getElementById('rulesExplainOverlay');
  if (!overlay) return;

  // Pre-select correct tab based on current election year
  const year = parseInt(window.STATE?.currentElectionYear) || 2022;
  let activeTarget = 'panel-epoch3'; // Default: 2022 em Diante
  if (year === 1994) {
    activeTarget = 'panel-epoch1994';
  } else if (year <= 2016) {
    activeTarget = 'panel-epoch1';
  } else if (year === 2018 || year === 2020) {
    activeTarget = 'panel-epoch2';
  }

  // Update active classes on buttons
  const tabBtns = overlay.querySelectorAll('.rules-tab-btn');
  tabBtns.forEach(btn => {
    const isTarget = btn.getAttribute('data-target') === activeTarget;
    btn.classList.toggle('active', isTarget);
  });

  // Update active classes on panels
  const panels = overlay.querySelectorAll('.rules-tab-panel');
  panels.forEach(panel => {
    const isTarget = panel.id === activeTarget;
    panel.classList.toggle('active', isTarget);
  });

  // Show overlay
  overlay.classList.add('visible');
};

window.closeProportionalRulesModal = function() {
  const overlay = document.getElementById('rulesExplainOverlay');
  if (overlay) {
    overlay.classList.remove('visible');
  }
};

window.selectRulesTab = function(btn) {
  const targetId = btn.getAttribute('data-target');
  const overlay = document.getElementById('rulesExplainOverlay');
  if (!overlay) return;

  const tabBtns = overlay.querySelectorAll('.rules-tab-btn');
  const panels = overlay.querySelectorAll('.rules-tab-panel');

  tabBtns.forEach(b => b.classList.toggle('active', b === btn));
  panels.forEach(p => p.classList.toggle('active', p.id === targetId));
};
