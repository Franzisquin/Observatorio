// ============================================================================
// results-panel-pt.js — painel de resultados (partidos, mandatos, breadcrumb)
// ============================================================================

// ---------- BREADCRUMB ----------

function buildBreadcrumbHtml() {
  const scope = STATE.scope;
  const parts = [];
  const link = (label, action) =>
    `<a href="#" class="scope-crumb" data-scope-action="${action}" title="Ir para ${escapeAttribute(label)}">${escapeHtml(label)}</a>`;
  const current = (label) => `<span class="scope-crumb-current">${escapeHtml(label)}</span>`;

  if (selectedLocationIDs.size > 0) {
    parts.push(link('Portugal', 'national'));
    parts.push(current('Seleção manual'));
    return parts.join(' › ');
  }

  if (scope.level === 'national') {
    const elLabel = STATE.currentElectionType === 'pr' ? 'Presidente da República'
      : STATE.currentElectionType === 'ee' ? 'Parlamento Europeu'
        : STATE.currentElectionType === 'au' ? (
          STATE.auSubtype === 'cm' ? 'Câmara Municipal'
            : STATE.auSubtype === 'am' ? 'Assembleia Municipal'
              : 'Assembleia de Freguesia'
        )
          : 'Assembleia da República';
    return `Portugal · ${elLabel}`;
  }

  parts.push(link('Portugal', 'national'));
  const circ = scope.circulo || (scope.level === 'distrito' ? scope.key : null)
    || (scope.key ? circuloFromDicofre(scope.key) : null);
  if (scope.level === 'distrito') {
    if (STATE.selectedCountry && (scope.key === 'E1' || scope.key === 'E2')) {
      parts.push(link(CIRCULOS.get(scope.key) || scope.key, `distrito:${scope.key}`));
      parts.push(current(STATE.selectedCountry));
    } else {
      parts.push(current(CIRCULOS.get(scope.key) || scope.key));
    }
  } else if (circ) {
    parts.push(link(CIRCULOS.get(circ) || circ, `distrito:${circ}`));
  }
  if (scope.level === 'concelho') {
    parts.push(current(scope.nome || scope.key));
  } else if (scope.level === 'freguesia') {
    const dico = scope.key.slice(0, 4);
    const concelhoNome = getConcelhoNome(dico);
    parts.push(link(concelhoNome, `concelho:${dico}`));
    parts.push(current(STATE.data?.NAMES?.[scope.key] || scope.key));
  }
  return parts.join(' › ');
}

function getConcelhoNome(dico) {
  const feat = STATE.geo?.concelhos?.features?.find(f => f.properties?.dico === dico);
  return feat?.properties?.concelho || dico;
}

function handleBreadcrumbClick(e) {
  const el = e.target.closest('.scope-crumb');
  if (!el) return;
  e.preventDefault();
  const action = el.dataset.scopeAction || 'national';
  if (action === 'national') {
    window.navigateToNational({ focus: true });
  } else if (action.startsWith('distrito:')) {
    const key = action.slice(9);
    window.navigateToDistrito(key, { focus: true });
  } else if (action.startsWith('concelho:')) {
    const dico = action.slice(9);
    window.navigateToConcelho(dico);
  }
}

// ---------- PAINEL ----------

// Chip 1.ª/2.ª volta (só aparece para os anos PR com segunda volta: 1986 e 2026)
function updatePrRoundChips() {
  const box = document.getElementById('prRoundChips');
  if (!box) return;
  const base = String(STATE.currentYear || '').replace(/_2$/, '');
  const hasSecondRound = STATE.currentElectionType === 'pr'
    && PR_YEARS.some((y) => y.value === `${base}_2`);
  box.style.display = hasSecondRound ? 'flex' : 'none';
  if (!hasSecondRound) return;
  const activeRound = STATE.currentYear.endsWith('_2') ? '2' : '1';
  box.querySelectorAll('.chip-button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.round === activeRound);
  });
}

function renderResultsPanel() {
  if (!dom.resultsContent || !STATE.data) return;
  initializeCandidateColorUI();
  closeCandidateColorPopoverOnViewChange();

  // Injetar estilos de tooltip customizados para evitar o delay do "title" padrão do navegador
  if (!document.getElementById('viz-tooltip-styles')) {
    const style = document.createElement('style');
    style.id = 'viz-tooltip-styles';
    style.textContent = `
      .viz-tooltip-wrap {
        position: relative;
        cursor: help;
        border-bottom: 1px dotted var(--muted);
        display: inline-block;
      }
      .viz-tooltip-wrap::after {
        content: attr(data-tooltip);
        position: absolute;
        bottom: 125%;
        left: 50%;
        transform: translateX(-50%);
        background-color: var(--card);
        color: var(--text-sec);
        text-align: left;
        padding: 8px 12px;
        border-radius: var(--radius-lg);
        font-size: 0.68rem;
        white-space: normal;
        width: 220px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        border: 1px solid var(--border-color);
        z-index: 9999;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.15s, visibility 0.15s;
        pointer-events: none;
        line-height: 1.35;
        font-weight: 500;
      }
      .viz-tooltip-wrap:hover::after {
        opacity: 1;
        visibility: visible;
      }
    `;
    document.head.appendChild(style);
  }

  const scopeData = getScopeData();
  if (!scopeData) return;

  if (typeof updateMobileFilterSummary === 'function') updateMobileFilterSummary();
  updatePrRoundChips();
  // Perfil do território (censo INE) desativado por agora — dados e código mantidos.
  // Para reativar: descomentar a linha abaixo (dados em dados/censo/, ETL em etl/build_censo.py).
  // renderTerritoryProfile(STATE.scope);

  if (STATE.currentElectionType === 'au') {
    renderAutarquicasPanel(scopeData);
    return;
  }

  dom.resultsBox?.classList.remove('section-hidden');
  document.getElementById('resultsEmpty')?.classList.add('hidden');

  if (dom.resultsTitle) dom.resultsTitle.textContent = scopeData.nome;

  const votes = scopeData.votes || {};
  const official = scopeData.official;

  if (dom.resultsSubtitle) {
    dom.resultsSubtitle.innerHTML = buildBreadcrumbHtml();
  }

  const mandatosP = official?.mandatos_p || null;
  const showMandatos = !!(mandatosP && Object.keys(mandatosP).length);

  let total = 0;
  Object.values(votes).forEach(v => { total += v; });

  const parties = Object.keys(votes).sort((a, b) => votes[b] - votes[a]);

  if (!parties.length) {
    const noElection = (typeof territoryHasNoElection === 'function') && territoryHasNoElection(scopeData.key);
    dom.resultsContent.innerHTML = `<p style="color:var(--muted)">${noElection ? 'Votação não realizada neste território.' : 'Sem dados para esta seleção.'}</p>`;
    dom.resultsMetrics.innerHTML = '';
    return;
  }

  let html = `
    <table class="cand-table" style="width: 100%; border-collapse: collapse; table-layout: auto;">
      <thead>
        <tr>
          <th class="color-bar-td" style="width: 16px;"></th>
          <th class="align-left">${STATE.currentElectionType === 'pr' ? 'Candidato' : 'Partido'}</th>
          ${showMandatos ? '<th class="align-center" style="width: 45px;" title="Mandatos">Dep.</th>' : ''}
          <th class="align-right" style="width: 85px; padding-right: 8px;">Votos (%)</th>
        </tr>
      </thead>
      <tbody>
  `;

  parties.forEach((party) => {
    const v = votes[party];
    if (!v) return;
    const pct = total > 0 ? v / total : 0;
    const sw = getResolvedPartyColor(party);
    const safeParty = escapeAttribute(party);
    const seats = showMandatos ? (mandatosP[party] || 0) : null;
    let seatsHtml = seats ? fmtInt(seats) : '—';
    if (STATE.currentYear === '2022' && mandatosP) {
      if (party === 'PPD/PSD') {
        const isGlobal = !!official?.isGlobal;
        const basePSDSeats = isGlobal ? 72 : (mandatosP['PPD/PSD'] || 0); // Correção do círculo da Europa pós-repetição
        const mpPSDSeats = mandatosP['Madeira Primeiro'] || 0; // 3
        const adaPSDSeats = mandatosP['AD Açores'] || 0; // 2
        const totalPSDSeats = basePSDSeats + mpPSDSeats + adaPSDSeats; // 77 no global, 76 no nacional
        seatsHtml = `<span class="viz-tooltip-wrap" data-tooltip="Inclui ${mpPSDSeats} deputados eleitos pela coligação Madeira Primeiro e ${adaPSDSeats} pela coligação AD Açores, todos filiados ao PSD.">${totalPSDSeats}*</span>`;
      } else if (party === 'PS' && official?.isGlobal) {
        seatsHtml = '120'; // Correção do círculo da Europa pós-repetição para o PS
      }
    }

    let fullName = (STATE.currentElectionType === 'pr')
      ? (STATE.data?.METADATA?.parties?.[party]?.partido || '')
      : (PARTY_FULL_NAMES[getNormalizedPartyColorKey(party)] || '');
    if (STATE.currentElectionType !== 'pr' && STATE.currentYear === '2015' && party === 'Aliança Açores') {
      fullName = 'CDS-PP.PPM';
    } else if (STATE.currentYear === '2022') {
      if (party === 'Madeira Primeiro') {
        fullName = 'PSD-CDS';
      } else if (party === 'AD Açores') {
        fullName = 'PSD-CDS-PPM';
      }
    } else if (STATE.currentYear === '2025') {
      if (party === 'AD') {
        fullName = 'AD – Coligação PSD/CDS';
      } else if (party === 'AD Açores') {
        fullName = 'PSD-CDS-PPM';
      }
    }

    let breakdownHtml = '';
    let breakdownRowHtml = '';
    if (STATE.currentYear === '2015' && party === 'PàF' && STATE.scope.level === 'national') {
      try {
        const d30 = STATE.data?.AGG?.distrito?.['30'];
        const d40 = STATE.data?.AGG?.distrito?.['40'];

        const psdMadeiraV = d30?.votes?.['PPD/PSD'] || 0;
        const psdMadeiraS = showMandatos ? (d30?.mandatos_p?.['PPD/PSD'] || 0) : 0;

        const psdAcoresV = d40?.votes?.['PPD/PSD'] || 0;
        const psdAcoresS = showMandatos ? (d40?.mandatos_p?.['PPD/PSD'] || 0) : 0;

        const cdsMadeiraV = d30?.votes?.['CDS-PP'] || 0;
        const cdsMadeiraS = showMandatos ? (d30?.mandatos_p?.['CDS-PP'] || 0) : 0;

        const psdTotalV = psdMadeiraV + psdAcoresV;
        const psdTotalS = psdMadeiraS + psdAcoresS;

        const coalitionV = v - psdTotalV - cdsMadeiraV;
        const coalitionS = (seats || 0) - psdTotalS - cdsMadeiraS;

        breakdownRowHtml = `
          <tr class="paf-breakdown-row" style="display: none; background: rgba(0,0,0,0.15);">
            <td colspan="${showMandatos ? 4 : 3}" style="padding: 8px 12px; border-bottom: 1px solid var(--border);">
              <div style="display: flex; flex-direction: column; gap: 8px;">
                <div style="font-size: 0.7rem; font-weight: 700; color: var(--muted); letter-spacing: 0.5px; text-transform: uppercase;">
                  Composição dos Resultados (PàF + Ilhas)
                </div>
                <div style="display: grid; grid-template-columns: 2.2fr 1fr 1.2fr 1fr; gap: 8px; font-size: 0.72rem; align-items: center; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 6px;">
                  <!-- Coligação -->
                  <span style="font-weight: 600; color: var(--text-sec);">Coligação PàF (Continente + Emigração)</span>
                  <span style="text-align: center; color: var(--text-main); font-weight: 700;">${fmtInt(coalitionS)} dep.</span>
                  <span style="text-align: right; color: var(--text-main);">${fmtInt(coalitionV)} votos</span>
                  <span style="text-align: right; color: var(--muted); font-size: 0.65rem;">${fmtPct(coalitionV / total)}</span>
                  
                  <!-- PSD Ilhas -->
                  <span style="font-weight: 600; color: var(--text-sec);">PSD (Açores e Madeira)</span>
                  <span style="text-align: center; color: var(--text-main); font-weight: 700;">${fmtInt(psdTotalS)} dep.</span>
                  <span style="text-align: right; color: var(--text-main);">${fmtInt(psdTotalV)} votos</span>
                  <span style="text-align: right; color: var(--muted); font-size: 0.65rem;">${fmtPct(psdTotalV / total)}</span>
                  
                  <!-- CDS Madeira -->
                  <span style="font-weight: 600; color: var(--text-sec);">CDS-PP (Madeira)</span>
                  <span style="text-align: center; color: var(--text-main); font-weight: 700;">${fmtInt(cdsMadeiraS)} dep.</span>
                  <span style="text-align: right; color: var(--text-main);">${fmtInt(cdsMadeiraV)} votos</span>
                  <span style="text-align: right; color: var(--muted); font-size: 0.65rem;">${fmtPct(cdsMadeiraV / total)}</span>
                </div>
              </div>
            </td>
          </tr>
        `;

        breakdownHtml = `
          <div class="paf-breakdown-toggle" style="margin-top: 4px; font-size: 0.65rem; color: var(--accent); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; font-weight: 600; user-select: none; transition: color 0.2s;">
            <span>Ver composição</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="paf-chevron" style="transition: transform 0.2s;"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        `;
      } catch (err) {
        console.error("Error calculating PàF breakdown:", err);
      }
    }

    if (STATE.currentElectionType === 'ar' && STATE.currentYear === '2024' && party === 'AD' && STATE.scope.level === 'national') {
      try {
        const votes30 = typeof MAP_LEVELS !== 'undefined' ? MAP_LEVELS.distrito.getVotes('30') : {};
        const official30 = typeof MAP_LEVELS !== 'undefined' ? MAP_LEVELS.distrito.getOfficial('30') : {};

        const mpVotes = votes30?.['Madeira Primeiro'] || 0;
        const mpSeats = showMandatos ? (official30?.mandatos_p?.['Madeira Primeiro'] || 0) : 0;

        const ppmVotes = votes30?.['PPM'] || 0;
        const ppmSeats = showMandatos ? (official30?.mandatos_p?.['PPM'] || 0) : 0;

        const coalitionV = v - mpVotes - ppmVotes;
        const coalitionS = (seats || 0) - mpSeats - ppmSeats;

        breakdownRowHtml = `
          <tr class="paf-breakdown-row" style="display: none; background: rgba(0,0,0,0.15);">
            <td colspan="${showMandatos ? 4 : 3}" style="padding: 8px 12px; border-bottom: 1px solid var(--border);">
              <div style="display: flex; flex-direction: column; gap: 8px;">
                <div style="font-size: 0.7rem; font-weight: 700; color: var(--muted); letter-spacing: 0.5px; text-transform: uppercase;">
                  Composição dos Resultados (AD + Madeira Primeiro + PPM)
                </div>
                <div style="display: grid; grid-template-columns: 2.2fr 1fr 1.2fr 1fr; gap: 8px; font-size: 0.72rem; align-items: center; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 6px;">
                  <!-- Coligação AD -->
                  <span style="font-weight: 600; color: var(--text-sec);">Aliança Democrática (AD) (Continente + Açores + Emigração)</span>
                  <span style="text-align: center; color: var(--text-main); font-weight: 700;">${fmtInt(coalitionS)} dep.</span>
                  <span style="text-align: right; color: var(--text-main);">${fmtInt(coalitionV)} votos</span>
                  <span style="text-align: right; color: var(--muted); font-size: 0.65rem;">${fmtPct(coalitionV / total)}</span>
                  
                  <!-- Madeira Primeiro -->
                  <span style="font-weight: 600; color: var(--text-sec);">Madeira Primeiro (Madeira)</span>
                  <span style="text-align: center; color: var(--text-main); font-weight: 700;">${fmtInt(mpSeats)} dep.</span>
                  <span style="text-align: right; color: var(--text-main);">${fmtInt(mpVotes)} votos</span>
                  <span style="text-align: right; color: var(--muted); font-size: 0.65rem;">${fmtPct(mpVotes / total)}</span>

                  <!-- PPM Madeira -->
                  <span style="font-weight: 600; color: var(--text-sec);">PPM (Madeira)</span>
                  <span style="text-align: center; color: var(--text-main); font-weight: 700;">${ppmSeats ? `${fmtInt(ppmSeats)} dep.` : '—'}</span>
                  <span style="text-align: right; color: var(--text-main);">${fmtInt(ppmVotes)} votos</span>
                  <span style="text-align: right; color: var(--muted); font-size: 0.65rem;">${fmtPct(ppmVotes / total)}</span>
                </div>
              </div>
            </td>
          </tr>
        `;

        breakdownHtml = `
          <div class="paf-breakdown-toggle" style="margin-top: 4px; font-size: 0.65rem; color: var(--accent); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; font-weight: 600; user-select: none; transition: color 0.2s;">
            <span>Ver composição</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="paf-chevron" style="transition: transform 0.2s;"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        `;
      } catch (err) {
        console.error("Error calculating AD breakdown:", err);
      }
    }

    if (STATE.currentYear === '2025' && party === 'AD' && STATE.scope.level === 'national') {
      try {
        const votes40 = typeof MAP_LEVELS !== 'undefined' ? MAP_LEVELS.distrito.getVotes('40') : {};
        const official40 = typeof MAP_LEVELS !== 'undefined' ? MAP_LEVELS.distrito.getOfficial('40') : {};

        const adaVotes = votes40?.['AD Açores'] || 0;
        const adaSeats = showMandatos ? (official40?.mandatos_p?.['AD Açores'] || 0) : 0;

        const coalitionV = v - adaVotes;
        const coalitionS = (seats || 0) - adaSeats;

        breakdownRowHtml = `
          <tr class="paf-breakdown-row" style="display: none; background: rgba(0,0,0,0.15);">
            <td colspan="${showMandatos ? 4 : 3}" style="padding: 8px 12px; border-bottom: 1px solid var(--border);">
              <div style="display: flex; flex-direction: column; gap: 8px;">
                <div style="font-size: 0.7rem; font-weight: 700; color: var(--muted); letter-spacing: 0.5px; text-transform: uppercase;">
                  Composição dos Resultados (AD + AD Açores)
                </div>
                <div style="display: grid; grid-template-columns: 2.2fr 1fr 1.2fr 1fr; gap: 8px; font-size: 0.72rem; align-items: center; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 6px;">
                  <!-- Coligação AD -->
                  <span style="font-weight: 600; color: var(--text-sec);">AD – Coligação PSD/CDS (Continente + Madeira + Emigração)</span>
                  <span style="text-align: center; color: var(--text-main); font-weight: 700;">${fmtInt(coalitionS)} dep.</span>
                  <span style="text-align: right; color: var(--text-main);">${fmtInt(coalitionV)} votos</span>
                  <span style="text-align: right; color: var(--muted); font-size: 0.65rem;">${fmtPct(coalitionV / total)}</span>
                  
                  <!-- AD Açores -->
                  <span style="font-weight: 600; color: var(--text-sec);">AD Açores (Açores)</span>
                  <span style="text-align: center; color: var(--text-main); font-weight: 700;">${fmtInt(adaSeats)} dep.</span>
                  <span style="text-align: right; color: var(--text-main);">${fmtInt(adaVotes)} votos</span>
                  <span style="text-align: right; color: var(--muted); font-size: 0.65rem;">${fmtPct(adaVotes / total)}</span>
                </div>
              </div>
            </td>
          </tr>
        `;

        breakdownHtml = `
          <div class="paf-breakdown-toggle" style="margin-top: 4px; font-size: 0.65rem; color: var(--accent); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; font-weight: 600; user-select: none; transition: color 0.2s;">
            <span>Ver composição</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="paf-chevron" style="transition: transform 0.2s;"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        `;
      } catch (err) {
        console.error("Error calculating 2025 AD breakdown:", err);
      }
    }

    if ((STATE.currentYear === '1979' || STATE.currentYear === '1980') && party === 'AD' && STATE.scope.level === 'national') {
      try {
        const d30 = STATE.data?.AGG?.distrito?.['30'];
        const d40 = STATE.data?.AGG?.distrito?.['40'];

        const psdIlhasV = (d30?.votes?.['PPD/PSD'] || 0) + (d40?.votes?.['PPD/PSD'] || 0);
        const psdIlhasS = showMandatos ? ((d30?.mandatos_p?.['PPD/PSD'] || 0) + (d40?.mandatos_p?.['PPD/PSD'] || 0)) : 0;

        const cdsIlhasV = (d30?.votes?.['CDS'] || 0) + (d40?.votes?.['CDS'] || 0);
        const cdsIlhasS = showMandatos ? ((d30?.mandatos_p?.['CDS'] || 0) + (d40?.mandatos_p?.['CDS'] || 0)) : 0;

        // O valor nacional da AD já inclui as ilhas (fundido no ETL); subtrai-se
        // para obter o Continente, tal como o breakdown do PàF em 2015.
        const coalitionV = v - psdIlhasV - cdsIlhasV;
        const coalitionS = (seats || 0) - psdIlhasS - cdsIlhasS;

        breakdownRowHtml = `
          <tr class="paf-breakdown-row" style="display: none; background: rgba(0,0,0,0.15);">
            <td colspan="${showMandatos ? 4 : 3}" style="padding: 8px 12px; border-bottom: 1px solid var(--border);">
              <div style="display: flex; flex-direction: column; gap: 8px;">
                <div style="font-size: 0.7rem; font-weight: 700; color: var(--muted); letter-spacing: 0.5px; text-transform: uppercase;">
                  Composição dos Resultados (AD + Ilhas)
                </div>
                <div style="display: grid; grid-template-columns: 2.2fr 1fr 1.2fr 1fr; gap: 8px; font-size: 0.72rem; align-items: center; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 6px;">
                  <!-- Coligação AD -->
                  <span style="font-weight: 600; color: var(--text-sec);">AD – Coligação (Continente)</span>
                  <span style="text-align: center; color: var(--text-main); font-weight: 700;">${fmtInt(coalitionS)} dep.</span>
                  <span style="text-align: right; color: var(--text-main);">${fmtInt(coalitionV)} votos</span>
                  <span style="text-align: right; color: var(--muted); font-size: 0.65rem;">${fmtPct(coalitionV / total)}</span>

                  <!-- PPD/PSD Ilhas -->
                  <span style="font-weight: 600; color: var(--text-sec);">PPD/PSD (Açores e Madeira)</span>
                  <span style="text-align: center; color: var(--text-main); font-weight: 700;">${psdIlhasS ? `${fmtInt(psdIlhasS)} dep.` : '—'}</span>
                  <span style="text-align: right; color: var(--text-main);">${fmtInt(psdIlhasV)} votos</span>
                  <span style="text-align: right; color: var(--muted); font-size: 0.65rem;">${fmtPct(psdIlhasV / total)}</span>

                  <!-- CDS Ilhas -->
                  <span style="font-weight: 600; color: var(--text-sec);">CDS (Açores e Madeira)</span>
                  <span style="text-align: center; color: var(--text-main); font-weight: 700;">${cdsIlhasS ? `${fmtInt(cdsIlhasS)} dep.` : '—'}</span>
                  <span style="text-align: right; color: var(--text-main);">${fmtInt(cdsIlhasV)} votos</span>
                  <span style="text-align: right; color: var(--muted); font-size: 0.65rem;">${fmtPct(cdsIlhasV / total)}</span>
                </div>
                <div style="font-size: 0.65rem; color: var(--muted); font-style: italic; line-height: 1.35;">PPD/PSD e CDS concorreram separadamente nos Açores e na Madeira.</div>
              </div>
            </td>
          </tr>
        `;

        breakdownHtml = `
          <div class="paf-breakdown-toggle" style="margin-top: 4px; font-size: 0.65rem; color: var(--accent); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; font-weight: 600; user-select: none; transition: color 0.2s;">
            <span>Ver composição</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="paf-chevron" style="transition: transform 0.2s;"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        `;
      } catch (err) {
        console.error("Error calculating 1980 AD breakdown:", err);
      }
    }

    if (STATE.currentYear === '1980' && party === 'FRS' && STATE.scope.level === 'national') {
      try {
        const d30 = STATE.data?.AGG?.distrito?.['30'];
        const d40 = STATE.data?.AGG?.distrito?.['40'];

        const psIlhasV = (d30?.votes?.['PS'] || 0) + (d40?.votes?.['PS'] || 0);
        const psIlhasS = showMandatos ? ((d30?.mandatos_p?.['PS'] || 0) + (d40?.mandatos_p?.['PS'] || 0)) : 0;

        // O valor nacional da FRS já inclui as ilhas (fundido no ETL); subtrai-se
        // o PS das ilhas para obter o Continente.
        const coalitionV = v - psIlhasV;
        const coalitionS = (seats || 0) - psIlhasS;

        breakdownRowHtml = `
          <tr class="paf-breakdown-row" style="display: none; background: rgba(0,0,0,0.15);">
            <td colspan="${showMandatos ? 4 : 3}" style="padding: 8px 12px; border-bottom: 1px solid var(--border);">
              <div style="display: flex; flex-direction: column; gap: 8px;">
                <div style="font-size: 0.7rem; font-weight: 700; color: var(--muted); letter-spacing: 0.5px; text-transform: uppercase;">
                  Composição dos Resultados (FRS + Ilhas)
                </div>
                <div style="display: grid; grid-template-columns: 2.2fr 1fr 1.2fr 1fr; gap: 8px; font-size: 0.72rem; align-items: center; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 6px;">
                  <!-- Coligação FRS -->
                  <span style="font-weight: 600; color: var(--text-sec);">FRS – Coligação (Continente)</span>
                  <span style="text-align: center; color: var(--text-main); font-weight: 700;">${fmtInt(coalitionS)} dep.</span>
                  <span style="text-align: right; color: var(--text-main);">${fmtInt(coalitionV)} votos</span>
                  <span style="text-align: right; color: var(--muted); font-size: 0.65rem;">${fmtPct(coalitionV / total)}</span>

                  <!-- PS Ilhas -->
                  <span style="font-weight: 600; color: var(--text-sec);">PS (Açores e Madeira)</span>
                  <span style="text-align: center; color: var(--text-main); font-weight: 700;">${psIlhasS ? `${fmtInt(psIlhasS)} dep.` : '—'}</span>
                  <span style="text-align: right; color: var(--text-main);">${fmtInt(psIlhasV)} votos</span>
                  <span style="text-align: right; color: var(--muted); font-size: 0.65rem;">${fmtPct(psIlhasV / total)}</span>
                </div>
                <div style="font-size: 0.65rem; color: var(--muted); font-style: italic; line-height: 1.35;">O PS concorreu sozinho nos Açores e na Madeira.</div>
              </div>
            </td>
          </tr>
        `;

        breakdownHtml = `
          <div class="paf-breakdown-toggle" style="margin-top: 4px; font-size: 0.65rem; color: var(--accent); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; font-weight: 600; user-select: none; transition: color 0.2s;">
            <span>Ver composição</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="paf-chevron" style="transition: transform 0.2s;"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        `;
      } catch (err) {
        console.error("Error calculating 1980 FRS breakdown:", err);
      }
    }

    html += `
      <tr data-cand-partido="${safeParty}">
        <td class="color-bar-td">
          <button type="button" class="swatch-button cand-color-bar"
               style="background-color: ${sw};"
               data-candidate-name="${safeParty}"
               data-candidate-party="${escapeAttribute(STATE.currentElectionType === 'pr' ? fullName : party)}"
               data-current-color="${sw}"
               title="Personalizar cor do partido"></button>
        </td>
        <td class="align-left">
          <div style="display: flex; flex-direction: column; gap: 2px; align-items: flex-start; justify-content: center; min-width: 0;">
            <span class="cand-name-text" style="font-size: 0.88rem; font-weight: 600; color: var(--text); line-height: 1.25; word-break: break-word;">${escapeHtml(party)}</span>
            ${fullName ? `<span style="font-size: 0.72rem; color: var(--muted); line-height: 1.2; margin-top: 1px;">${escapeHtml(fullName)}</span>` : ''}
            ${breakdownHtml}
          </div>
        </td>
        ${showMandatos ? `<td class="align-center cand-votes-text" style="text-align: center; font-variant-numeric: tabular-nums; font-size: 0.88rem; font-weight: 600; vertical-align: middle;">${(seats && typeof eleitosSeatsClickable === 'function' && eleitosSeatsClickable())
          ? `<button type="button" class="eleitos-seats-btn" data-party="${safeParty}" title="Ver os eleitos de ${safeParty}">${seatsHtml}</button>`
          : seatsHtml
        }</td>` : ''}
        <td class="align-right">
          <div style="display: flex; flex-direction: column; align-items: flex-end; justify-content: center; gap: 1px;">
            <span class="cand-votes-text" style="font-size: 0.88rem; font-variant-numeric: tabular-nums; font-weight: 600; color: var(--text-sec);">${fmtInt(v)}</span>
            <span style="font-size: 0.72rem; color: var(--muted); font-weight: 500; font-variant-numeric: tabular-nums;">${fmtPct(pct)}</span>
          </div>
        </td>
      </tr>
      ${breakdownRowHtml}
    `;
  });

  html += '</tbody></table>';
  dom.resultsContent.innerHTML = html;

  // métricas oficiais (inscritos/votantes/brancos/nulos) quando existirem
  let metricsHtml = `
    <div class="metrics-grid">
      <div class="metric-item">
        <span>Votos válidos</span>
        <strong>${fmtInt(total)}</strong>
      </div>
  `;
  if (official) {
    const inscritos = ensureNumber(official.inscritos);
    const votantes = ensureNumber(official.votantes);
    const brancos = ensureNumber(official.brancos);
    const nulos = ensureNumber(official.nulos);
    const abst = inscritos > 0 ? (inscritos - votantes) / inscritos : null;
    metricsHtml += `
      <div class="metric-item">
        <span>Inscritos</span>
        <strong>${fmtInt(inscritos)}</strong>
      </div>
      <div class="metric-item">
        <span>Votantes</span>
        <strong>${fmtInt(votantes)}${inscritos > 0 ? ` <span style="font-size: 0.72rem; color: var(--muted); font-weight: 500; display: inline-block; margin-left: 2px;">(${fmtPct(votantes / inscritos)})</span>` : ''}</strong>
      </div>
      <div class="metric-item">
        <span>Abstenção</span>
        <strong>${abst !== null ? fmtPct(abst) : '—'}</strong>
      </div>
      <div class="metric-item">
        <span>Brancos</span>
        <strong>${fmtInt(brancos)}${votantes > 0 ? ` <span style="font-size: 0.72rem; color: var(--muted); font-weight: 500; display: inline-block; margin-left: 2px;">(${fmtPct(brancos / votantes)})</span>` : ''}</strong>
      </div>
      <div class="metric-item">
        <span>Nulos</span>
        <strong>${fmtInt(nulos)}${votantes > 0 ? ` <span style="font-size: 0.72rem; color: var(--muted); font-weight: 500; display: inline-block; margin-left: 2px;">(${fmtPct(nulos / votantes)})</span>` : ''}</strong>
      </div>
    `;
    if (official.mandatos) {
      metricsHtml += `
      <div class="metric-item">
        <span>Total Mandatos</span>
        <strong>${fmtInt(ensureNumber(official.mandatos))}</strong>
      </div>`;
    }
  }
  metricsHtml += '</div>';

  const scope = STATE.scope;
  console.log("DEBUG: renderResultsPanel, scope:", scope, "selectedCountry:", STATE.selectedCountry, "COUNTRIES exist:", !!STATE.data?.COUNTRIES);
  if (scope.level === 'distrito' && (scope.key === 'E1' || scope.key === 'E2') && !STATE.selectedCountry) {
    const countries = STATE.data?.COUNTRIES?.[scope.key];
    console.log("DEBUG: countries lookup result for key", scope.key, "is:", countries);
    if (countries && Object.keys(countries).length) {
      let countriesHtml = `
        <div class="countries-breakdown-section" style="margin-top: 20px; border-top: 1px solid var(--border); padding-top: 15px;">
          <h4 style="margin: 0 0 10px 0; font-size: 0.85rem; font-weight: 700; color: var(--text-main);">Resultados por País</h4>
          <div style="display: flex; flex-direction: column; gap: 8px;">
      `;

      const sortedCountries = Object.entries(countries).map(([cName, cData]) => {
        let cTotal = 0;
        Object.values(cData.votes || {}).forEach(v => { cTotal += v; });
        return { name: cName, data: cData, totalVotes: cTotal };
      }).sort((a, b) => b.totalVotes - a.totalVotes);

      sortedCountries.forEach(({ name: cName, data: cData, totalVotes: cTotal }) => {
        const cVotes = cData.votes || {};
        const cParties = Object.keys(cVotes).sort((x, y) => cVotes[y] - cVotes[x]);
        const winner = cParties[0] || '—';
        const winnerColor = winner !== '—' ? getResolvedPartyColor(winner) : 'var(--muted)';

        countriesHtml += `
          <div class="country-row-item" data-country-name="${escapeAttribute(cName)}" style="display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: var(--radius-lg); cursor: pointer; transition: background 0.2s ease, border-color 0.2s ease;">
            <div style="display: flex; flex-direction: column; gap: 2px;">
              <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-sec);">${escapeHtml(cName)}</span>
              <span style="font-size: 0.65rem; color: var(--muted);">${fmtInt(cTotal)} votos</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 0.72rem; font-weight: 700; color: #fff; background: ${winnerColor}; padding: 2px 6px; border-radius: 4px;">${escapeHtml(winner)}</span>
            </div>
          </div>
        `;
      });

      countriesHtml += `
          </div>
        </div>
      `;
      metricsHtml += countriesHtml;
    }
  }

  dom.resultsMetrics.innerHTML = metricsHtml;

  // listagem dos eleitos (Diário da República), injetada assincronamente
  // a listagem dos eleitos abre a partir do número de mandatos na tabela
  // (eleitos-portugal.js: .eleitos-seats-btn -> toggleEleitosPartyRow)

  if (typeof updateMobileFilterSummary === 'function') updateMobileFilterSummary();
}

// alias herdado do visualizador original (chamado pelo popover de cores)
function updateSelectionUI() { renderResultsPanel(); }

// ---------- PERFIL DO TERRITÓRIO (CENSO INE) ----------

let territoryProfileToken = 0;

async function renderTerritoryProfile(scope) {
  const el = document.getElementById('territoryProfile');
  if (!el) return;
  if (!scope || (scope.level !== 'freguesia' && scope.level !== 'concelho')) {
    el.innerHTML = '';
    return;
  }
  const token = ++territoryProfileToken;
  const vintage = censoVintageForYear(STATE.currentYear);
  const key = String(scope.key);
  const branch = scope.level === 'freguesia' ? 'FREG' : 'CONC';

  el.innerHTML = '<div style="color: var(--muted); font-size: 0.72rem; padding: 8px 0;">A carregar perfil do território…</div>';
  let censo = null;
  let renda = null;
  try {
    censo = await loadCensoVintage(vintage);
  } catch (_) { /* sem dados de censo */ }
  if (vintage === 2021) {
    try {
      const r = await loadRenda();
      const serie = r?.[branch]?.[key];
      if (serie) {
        const anos = Object.keys(serie).sort();
        const ano = anos[anos.length - 1];
        renda = { ano, valor: serie[ano] };
      }
    } catch (_) { /* sem renda */ }
  }
  if (token !== territoryProfileToken) return; // navegação mudou entretanto

  const rec = censo?.[branch]?.[key];
  if (!rec) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = buildTerritoryProfileHtml(rec, renda, vintage);
}

function profileAgeBarsHtml(rec) {
  let grupos;
  if (rec.idade_dec) {
    const d = rec.idade_dec;
    grupos = [
      ['0–9', d.d0_9], ['10–19', d.d10_19], ['20–29', d.d20_29],
      ['30–39', d.d30_39], ['40–49', d.d40_49], ['50–59', d.d50_59],
      ['60–69', d.d60_69], ['70–79', d.d70_79], ['80+', d.d80],
    ];
  } else {
    grupos = [
      ['0–14', rec.i0_14],
      ['15–24', rec.i15_24],
      ['25–64', rec.i25_64],
      ['65+', rec.i65],
    ];
  }
  const total = grupos.reduce((s, [, v]) => s + (v || 0), 0);
  if (!total) return '';
  const maxPct = Math.max(...grupos.map(([, v]) => (v || 0) / total));
  return grupos.map(([label, v]) => {
    const pct = (v || 0) / total * 100;
    const w = maxPct ? (pct / (maxPct * 100)) * 100 : 0;
    return `<div style="display: flex; align-items: center; gap: 8px; margin: 3px 0;">
        <span style="flex: 0 0 44px; font-size: 0.7rem; color: var(--text-sec);">${label}</span>
        <div style="flex: 1; height: 8px; background: rgba(125,125,125,0.12);">
          <div style="width: ${w.toFixed(1)}%; height: 100%; background: var(--accent-2); opacity: 0.85;"></div>
        </div>
        <span style="flex: 0 0 42px; text-align: right; font-size: 0.7rem; font-variant-numeric: tabular-nums; color: var(--text-sec);">${pct.toFixed(1)}%</span>
      </div>`;
  }).join('');
}

function buildTerritoryProfileHtml(rec, renda, vintage) {
  const fmt = (n) => (typeof fmtInt === 'function' ? fmtInt(n) : Number(n).toLocaleString('pt-PT'));
  const stat = (label, value) => `
    <div style="display: flex; justify-content: space-between; gap: 8px; padding: 2px 0;">
      <span style="font-size: 0.74rem; color: var(--text-sec);">${label}</span>
      <span style="font-size: 0.74rem; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--text);">${value}</span>
    </div>`;

  let html = `<div class="neighborhood-profile">
    <div class="profile-header">
      <h3>Perfil do território</h3>
      <span style="font-size: 0.66rem; color: var(--muted);">Censos ${vintage}</span>
    </div>`;

  // População
  let popHtml = stat('População residente', fmt(rec.pop));
  if (rec.agregados) popHtml += stat('Agregados domésticos', fmt(rec.agregados));
  html += `<div class="profile-section"><h4>População</h4>${popHtml}</div>`;

  // Faixas etárias
  const ages = profileAgeBarsHtml(rec);
  if (ages) html += `<div class="profile-section"><h4>Faixas etárias</h4>${ages}</div>`;

  // Rendimento
  if (renda) {
    html += `<div class="profile-section"><h4>Rendimento mediano por agregado fiscal (${renda.ano})</h4>
      <div class="profile-renda-display" title="Rendimento bruto declarado deduzido do IRS liquidado — mediana">
        <span class="renda-amount">${fmt(renda.valor)}</span>
        <span class="renda-currency">€ / ano</span>
      </div></div>`;
  } else if (vintage === 2021) {
    html += `<div class="profile-section"><h4>Rendimento</h4>
      <div style="font-size: 0.72rem; color: var(--muted);" title="O INE só divulga rendimento para territórios com 2000 ou mais sujeitos passivos">Sem dados divulgados pelo INE para este território</div></div>`;
  }

  // Emprego
  let trab = '';
  if (rec.tx_desemprego != null) trab += stat('Taxa de desemprego', `${rec.tx_desemprego.toLocaleString('pt-PT')}%`);
  if (rec.tx_atividade != null) trab += stat('Taxa de atividade', `${rec.tx_atividade.toLocaleString('pt-PT')}%`);
  if (trab) html += `<div class="profile-section"><h4>Emprego</h4>${trab}</div>`;

  // Escolaridade (proporções da população residente; "sem nível" tem base 15+)
  let esc = '';
  if (rec.pct_ens_superior != null) esc += stat('Ensino superior completo', `${rec.pct_ens_superior.toLocaleString('pt-PT')}%`);
  if (rec.esc_sec != null) esc += stat('Pelo menos o secundário (12º ano)', `${rec.esc_sec.toLocaleString('pt-PT')}%`);
  if (rec.esc_3ciclo != null) esc += stat('Pelo menos o 3º ciclo (9º ano)', `${rec.esc_3ciclo.toLocaleString('pt-PT')}%`);
  if (rec.esc_sem != null) esc += stat('Sem nível de escolaridade (15+)', `${rec.esc_sem.toLocaleString('pt-PT')}%`);
  if (esc) html += `<div class="profile-section"><h4>Escolaridade</h4>${esc}</div>`;

  // Habitação
  let hab = '';
  if (rec.aloj) hab += stat('Alojamentos familiares', fmt(rec.aloj));
  if (rec.aloj_prop && rec.aloj_rhab) hab += stat('Residências próprias', `${(100 * rec.aloj_prop / rec.aloj_rhab).toFixed(0)}%`);
  if (rec.aloj_arren && rec.aloj_rhab) hab += stat('Residências arrendadas', `${(100 * rec.aloj_arren / rec.aloj_rhab).toFixed(0)}%`);
  if (hab) html += `<div class="profile-section"><h4>Habitação</h4>${hab}</div>`;

  html += `<div style="font-size: 0.62rem; color: var(--muted); margin-top: 4px;">Fonte: INE — Censos ${vintage}${renda ? ` · Estatísticas do Rendimento ao Nível Local ${renda.ano}` : ''}</div>`;
  html += '</div>';
  return html;
}

// ---------- POPOVER DE COR DO PARTIDO ----------

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
          <div class="candidate-color-name" id="candidateColorPopoverName">Partido</div>
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
    if (value) applyCandidateColorPopover(false);
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
  popover.querySelector('#candidateColorNativeInput')?.click();
}

function openCandidateColorPopover(triggerEl, nome, partido, currentColor) {
  const popover = ensureCandidateColorPopover();
  activeCandidateColorTarget = { nome, partido };

  popover.querySelector('#candidateColorPopoverName').textContent = nome;
  popover.querySelector('#candidateColorPopoverParty').textContent =
    PARTY_FULL_NAMES[getNormalizedPartyColorKey(partido)] || partido || 'Partido';
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
    if (shouldClose) showToast('Digite uma cor hexadecimal válida.', 'warn', 2200);
    return;
  }
  if (!activeCandidateColorTarget?.nome) return;
  if (STATE.currentElectionType === 'pr') {
    CUSTOM_CANDIDATE_COLORS.set(activeCandidateColorTarget.nome, color);
  } else {
    CUSTOM_PARTY_COLORS.set(getNormalizedPartyColorKey(activeCandidateColorTarget.partido), color);
  }
  refreshMapStylesAndTooltips();
  if (shouldClose) closeCandidateColorPopover();
}

function resetCandidateColorPopover() {
  if (!activeCandidateColorTarget?.nome) return;
  if (STATE.currentElectionType === 'pr') {
    CUSTOM_CANDIDATE_COLORS.delete(activeCandidateColorTarget.nome);
  } else {
    CUSTOM_PARTY_COLORS.delete(getNormalizedPartyColorKey(activeCandidateColorTarget.partido));
  }
  refreshMapStylesAndTooltips();
  closeCandidateColorPopover();
}

// breadcrumb: delegação de eventos
document.addEventListener('click', handleBreadcrumbClick);

// delegação de eventos para a lista de países
document.addEventListener('click', (e) => {
  const countryRow = e.target.closest('.country-row-item');
  if (countryRow) {
    const countryName = countryRow.dataset.countryName;
    if (countryName) {
      STATE.selectedCountry = countryName;
      renderResultsPanel();
    }
  }
});

// delegação de eventos para a composição da coligação PàF (2015)
document.addEventListener('click', (e) => {
  const seatsBtn = e.target.closest('.eleitos-seats-btn');
  if (seatsBtn && typeof toggleEleitosPartyRow === 'function') {
    toggleEleitosPartyRow(seatsBtn);
    return;
  }
  const toggleBtn = e.target.closest('.paf-breakdown-toggle');
  if (toggleBtn) {
    const row = toggleBtn.closest('tr');
    const breakdownRow = row?.nextElementSibling;
    if (breakdownRow && breakdownRow.classList.contains('paf-breakdown-row')) {
      const isHidden = breakdownRow.style.display === 'none';
      breakdownRow.style.display = isHidden ? 'table-row' : 'none';

      const span = toggleBtn.querySelector('span');
      if (span) {
        if (STATE.currentElectionType === 'au') {
          span.textContent = isHidden ? 'Ocultar coligações' : 'Ver coligações';
        } else {
          span.textContent = isHidden ? 'Ocultar composição' : 'Ver composição';
        }
      }

      const chevron = toggleBtn.querySelector('.paf-chevron');
      if (chevron) {
        chevron.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
      }
    }
  }
});



function renderAutarquicasPanel(scopeData) {
  if (!dom.resultsContent || !STATE.data) return;

  const votes = scopeData.votes || {};
  const official = scopeData.official;

  dom.resultsBox?.classList.remove('section-hidden');
  document.getElementById('resultsEmpty')?.classList.add('hidden');

  if (dom.resultsTitle) dom.resultsTitle.textContent = scopeData.nome;

  if (dom.resultsSubtitle) {
    let sub = buildBreadcrumbHtml();
    dom.resultsSubtitle.innerHTML = sub;
  }

  let total = 0;
  Object.values(votes).forEach(v => { total += v; });

  const parties = Object.keys(votes);
  if (!parties.length) {
    dom.resultsContent.innerHTML = `<p style="color:var(--muted)">Sem dados para esta seleção.</p>`;
    dom.resultsMetrics.innerHTML = '';
    return;
  }

  const subType = STATE.auSubtype || 'cm';
  const level = scopeData.level; // 'national' | 'distrito' | 'concelho' | 'freguesia'

  let html = '';

  const isCM_Aggregate = (subType === 'cm' && (level === 'national' || level === 'distrito'));
  const isAF_Aggregate = (subType === 'af' && (level === 'national' || level === 'distrito' || level === 'concelho'));
  const isAM_Aggregate = (subType === 'am' && (level === 'national' || level === 'distrito'));

  if (isCM_Aggregate || isAF_Aggregate) {
    const typeLabel = subType === 'cm' ? 'Câm. (M.A.)' : 'Jun. (M.A.)';
    html += `
      <table class="cand-table" style="width: 100%; border-collapse: collapse; margin-top: 8px; table-layout: auto;">
        <thead>
          <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
            <th class="color-bar-td" style="width: 16px;"></th>
            <th class="align-left" style="text-align: left; font-size: 0.7rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; padding-bottom: 8px;">Partido / Coligação</th>
            <th class="align-center" style="text-align: center; font-size: 0.7rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; padding-bottom: 8px; width: 68px;" title="Câmaras/Juntas conquistadas (e com Maioria Absoluta)">${typeLabel}</th>
            <th class="align-center" style="text-align: center; font-size: 0.7rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; padding-bottom: 8px; width: 45px;" title="Mandatos">Mand.</th>
            <th class="align-right" style="text-align: right; font-size: 0.7rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; padding-bottom: 8px; width: 85px; padding-right: 8px;">Votos (%)</th>
          </tr>
        </thead>
        <tbody>
    `;

    let presidents = null;
    let maiorias = null;
    let mandatos_p = null;

    if (level === 'national') {
      presidents = {};
      maiorias = {};
      mandatos_p = {};
      const partiesMeta = STATE.data?.METADATA?.national?.parties || {};
      for (const [p, meta] of Object.entries(partiesMeta)) {
        presidents[p] = meta.presidentes || 0;
        maiorias[p] = meta.maiorias || 0;
        mandatos_p[p] = meta.mandatos || 0;
      }
    } else {
      const entry = level === 'distrito' ? STATE.data?.AGG?.distrito?.[STATE.scope.key] : STATE.data?.AGG?.concelho?.[STATE.scope.key];
      presidents = entry?.presidents || {};
      maiorias = entry?.maiorias || {};
      mandatos_p = entry?.mandatos_p || {};
    }

    const sortedParties = groupAutarquicasVotes(votes, presidents, maiorias, mandatos_p, level, subType);

    sortedParties.forEach((item) => {
      const v = item.votes;
      const pct = total > 0 ? v / total : 0;
      const pCount = item.presidents;
      const mCount = item.maiorias;
      const mSeats = item.mandatos;
      const sw = getResolvedPartyColor(item.isGroup ? item.mainParty : item.party);
      const safeParty = escapeAttribute(item.isGroup ? item.mainParty : item.party);
      const fullName = item.isGroup ? '' : (PARTY_FULL_NAMES[getNormalizedPartyColorKey(item.party)] || '');

      const toggleHtml = item.isGroup ? `
        <div class="paf-breakdown-toggle" style="margin-top: 4px; font-size: 0.65rem; color: var(--accent); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; font-weight: 600; user-select: none; transition: color 0.2s;">
          <span>Ver coligações</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="paf-chevron" style="transition: transform 0.2s;"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </div>
      ` : '';

      html += `
        <tr>
          <td class="color-bar-td">
            <button type="button" class="swatch-button cand-color-bar"
                 style="background-color: ${sw};"
                 data-candidate-name="${safeParty}"
                 data-candidate-party="${escapeAttribute(item.party)}"
                 data-current-color="${sw}"
                 title="Personalizar cor do partido"></button>
          </td>
          <td class="align-left">
            <div style="display: flex; flex-direction: column; gap: 2px; align-items: flex-start; justify-content: center; min-width: 0;">
              <span class="cand-name-text" style="font-size: 0.88rem; font-weight: 600; color: var(--text); line-height: 1.25; word-break: break-word;">${escapeHtml(item.party)}</span>
              ${toggleHtml}
              ${fullName ? `<span style="font-size: 0.72rem; color: var(--muted); line-height: 1.2; margin-top: 1px;">${escapeHtml(fullName)}</span>` : ''}
            </div>
          </td>
          <td class="align-center cand-votes-text" style="text-align: center; font-variant-numeric: tabular-nums; font-size: 0.88rem; font-weight: 600; vertical-align: middle;">
            ${pCount}<span style="font-size: 0.72rem; color: var(--muted); font-weight: 400; margin-left: 2px;">(${mCount})</span>
          </td>
          <td class="align-center cand-votes-text" style="text-align: center; font-variant-numeric: tabular-nums; font-size: 0.88rem; font-weight: 600; vertical-align: middle;">${fmtInt(mSeats)}</td>
          <td class="align-right">
            <div style="display: flex; flex-direction: column; align-items: flex-end; justify-content: center; gap: 1px;">
              <span class="cand-votes-text" style="font-size: 0.88rem; font-variant-numeric: tabular-nums; font-weight: 600; color: var(--text-sec);">${fmtInt(v)}</span>
              <span style="font-size: 0.72rem; color: var(--muted); font-weight: 500; font-variant-numeric: tabular-nums;">${fmtPct(pct)}</span>
            </div>
          </td>
        </tr>
      `;

      if (item.isGroup) {
        let membersRows = '';
        item.members.forEach(member => {
          const memberPct = total > 0 ? member.votes / total : 0;
          const memberSw = getResolvedPartyColor(member.party);
          const memberFullName = PARTY_FULL_NAMES[getNormalizedPartyColorKey(member.party)] || '';
          membersRows += `
            <tr style="border-bottom: 1px dotted rgba(255,255,255,0.04);">
              <td style="padding: 6px 8px; vertical-align: middle; text-align: left;">
                <span style="display: inline-block; width: 4px; height: 16px; background-color: ${memberSw}; border-radius: 2px; margin-right: 8px; vertical-align: middle;"></span>
                <span style="font-weight: 600; color: var(--text); font-size: 0.8rem; vertical-align: middle;">${escapeHtml(member.party)}</span>
                ${memberFullName ? `<div style="font-size: 0.7rem; color: var(--muted); padding-left: 12px; margin-top: 1px;">${escapeHtml(memberFullName)}</div>` : ''}
              </td>
              <td style="text-align: center; font-variant-numeric: tabular-nums; font-size: 0.8rem; font-weight: 500; color: var(--text-sec); vertical-align: middle;">
                ${member.presidents}<span style="font-size: 0.7rem; color: var(--muted); font-weight: 400; margin-left: 2px;">(${member.maiorias})</span>
              </td>
              <td style="text-align: center; font-variant-numeric: tabular-nums; font-size: 0.8rem; font-weight: 500; color: var(--text-sec); vertical-align: middle;">${fmtInt(member.mandatos)}</td>
              <td style="text-align: right; vertical-align: middle;">
                <div style="display: flex; flex-direction: column; align-items: flex-end; justify-content: center; gap: 1px;">
                  <span style="font-size: 0.8rem; font-variant-numeric: tabular-nums; font-weight: 500; color: var(--text-sec);">${fmtInt(member.votes)}</span>
                  <span style="font-size: 0.7rem; color: var(--muted); font-variant-numeric: tabular-nums; font-weight: 500;">${fmtPct(memberPct)}</span>
                </div>
              </td>
            </tr>
          `;
        });

        html += `
          <tr class="paf-breakdown-row" style="display: none; background: rgba(255,255,255,0.015);">
            <td colspan="5" style="padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.04);">
              <div style="font-size: 0.68rem; color: var(--muted); margin-bottom: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; text-align: left;">Composição da Votação:</div>
              <table style="width: 100%; border-collapse: collapse;">
                <tbody>
                  ${membersRows}
                </tbody>
              </table>
            </td>
          </tr>
        `;
      }
    });

    html += '</tbody></table>';

  } else if (isAM_Aggregate) {
    html += `
      <table class="cand-table" style="width: 100%; border-collapse: collapse; margin-top: 8px; table-layout: auto;">
        <thead>
          <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
            <th class="color-bar-td" style="width: 16px;"></th>
            <th class="align-left" style="text-align: left; font-size: 0.7rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; padding-bottom: 8px;">Partido / Coligação</th>
            <th class="align-center" style="text-align: center; font-size: 0.7rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; padding-bottom: 8px; width: 75px;">Mandatos</th>
            <th class="align-right" style="text-align: right; font-size: 0.7rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; padding-bottom: 8px; width: 85px; padding-right: 8px;">Votos (%)</th>
          </tr>
        </thead>
        <tbody>
    `;

    let mandatos_p = null;
    if (level === 'national') {
      mandatos_p = {};
      const partiesMeta = STATE.data?.METADATA?.national?.parties || {};
      for (const [p, meta] of Object.entries(partiesMeta)) {
        mandatos_p[p] = meta.mandatos || 0;
      }
    } else {
      const entry = STATE.data?.AGG?.distrito?.[STATE.scope.key];
      mandatos_p = entry?.mandatos_p || {};
    }

    const sortedParties = groupAutarquicasVotes(votes, null, null, mandatos_p, level, subType);

    sortedParties.forEach((item) => {
      const v = item.votes;
      const pct = total > 0 ? v / total : 0;
      const mSeats = item.mandatos;
      const sw = getResolvedPartyColor(item.isGroup ? item.mainParty : item.party);
      const safeParty = escapeAttribute(item.isGroup ? item.mainParty : item.party);
      const fullName = item.isGroup ? '' : (PARTY_FULL_NAMES[getNormalizedPartyColorKey(item.party)] || '');

      const toggleHtml = item.isGroup ? `
        <div class="paf-breakdown-toggle" style="margin-top: 4px; font-size: 0.65rem; color: var(--accent); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; font-weight: 600; user-select: none; transition: color 0.2s;">
          <span>Ver coligações</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="paf-chevron" style="transition: transform 0.2s;"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </div>
      ` : '';

      html += `
        <tr>
          <td class="color-bar-td">
            <button type="button" class="swatch-button cand-color-bar"
                 style="background-color: ${sw};"
                 data-candidate-name="${safeParty}"
                 data-candidate-party="${escapeAttribute(item.party)}"
                 data-current-color="${sw}"
                 title="Personalizar cor do partido"></button>
          </td>
          <td class="align-left">
            <div style="display: flex; flex-direction: column; gap: 2px; align-items: flex-start; justify-content: center; min-width: 0;">
              <span class="cand-name-text" style="font-size: 0.88rem; font-weight: 600; color: var(--text); line-height: 1.25; word-break: break-word;">${escapeHtml(item.party)}</span>
              ${toggleHtml}
              ${fullName ? `<span style="font-size: 0.72rem; color: var(--muted); line-height: 1.2; margin-top: 1px;">${escapeHtml(fullName)}</span>` : ''}
            </div>
          </td>
          <td class="align-center cand-votes-text" style="text-align: center; font-variant-numeric: tabular-nums; font-size: 0.88rem; font-weight: 600; vertical-align: middle;">${fmtInt(mSeats)}</td>
          <td class="align-right">
            <div style="display: flex; flex-direction: column; align-items: flex-end; justify-content: center; gap: 1px;">
              <span class="cand-votes-text" style="font-size: 0.88rem; font-variant-numeric: tabular-nums; font-weight: 600; color: var(--text-sec);">${fmtInt(v)}</span>
              <span style="font-size: 0.72rem; color: var(--muted); font-weight: 500; font-variant-numeric: tabular-nums;">${fmtPct(pct)}</span>
            </div>
          </td>
        </tr>
      `;

      if (item.isGroup) {
        let membersRows = '';
        item.members.forEach(member => {
          const memberPct = total > 0 ? member.votes / total : 0;
          const memberSw = getResolvedPartyColor(member.party);
          const memberFullName = PARTY_FULL_NAMES[getNormalizedPartyColorKey(member.party)] || '';
          membersRows += `
            <tr style="border-bottom: 1px dotted rgba(255,255,255,0.04);">
              <td style="padding: 6px 8px; vertical-align: middle; text-align: left;">
                <span style="display: inline-block; width: 4px; height: 16px; background-color: ${memberSw}; border-radius: 2px; margin-right: 8px; vertical-align: middle;"></span>
                <span style="font-weight: 600; color: var(--text); font-size: 0.8rem; vertical-align: middle;">${escapeHtml(member.party)}</span>
                ${memberFullName ? `<div style="font-size: 0.7rem; color: var(--muted); padding-left: 12px; margin-top: 1px;">${escapeHtml(memberFullName)}</div>` : ''}
              </td>
              <td style="text-align: center; font-variant-numeric: tabular-nums; font-size: 0.8rem; font-weight: 500; color: var(--text-sec); vertical-align: middle;">${fmtInt(member.mandatos)}</td>
              <td style="text-align: right; vertical-align: middle;">
                <div style="display: flex; flex-direction: column; align-items: flex-end; justify-content: center; gap: 1px;">
                  <span style="font-size: 0.8rem; font-variant-numeric: tabular-nums; font-weight: 500; color: var(--text-sec);">${fmtInt(member.votes)}</span>
                  <span style="font-size: 0.7rem; color: var(--muted); font-variant-numeric: tabular-nums; font-weight: 500;">${fmtPct(memberPct)}</span>
                </div>
              </td>
            </tr>
          `;
        });

        html += `
          <tr class="paf-breakdown-row" style="display: none; background: rgba(255,255,255,0.015);">
            <td colspan="4" style="padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.04);">
              <div style="font-size: 0.68rem; color: var(--muted); margin-bottom: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; text-align: left;">Composição da Votação:</div>
              <table style="width: 100%; border-collapse: collapse;">
                <tbody>
                  ${membersRows}
                </tbody>
              </table>
            </td>
          </tr>
        `;
      }
    });

    html += '</tbody></table>';

  } else {
    const mandatosP = official?.mandatos_p || null;
    const showMandatos = !!(mandatosP && Object.keys(mandatosP).length);
    const typeLabel = subType === 'cm' ? 'Vereadores' : (subType === 'am' ? 'Deputados' : 'Mandatos');

    html += `
      <table class="cand-table" style="width: 100%; border-collapse: collapse; margin-top: 8px; table-layout: auto;">
        <thead>
          <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
            <th class="color-bar-td" style="width: 16px;"></th>
            <th class="align-left" style="text-align: left; font-size: 0.7rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; padding-bottom: 8px;">Partido / Coligação</th>
            ${showMandatos ? `<th class="align-center" style="text-align: center; font-size: 0.7rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; padding-bottom: 8px; width: 75px;">${typeLabel}</th>` : ''}
            <th class="align-right" style="text-align: right; font-size: 0.7rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; padding-bottom: 8px; width: 85px; padding-right: 8px;">Votos (%)</th>
          </tr>
        </thead>
        <tbody>
    `;

    const sortedParties = groupAutarquicasVotes(votes, null, null, mandatosP, level, subType);

    sortedParties.forEach((item, idx) => {
      const v = item.votes;
      if (!v) return;
      const pct = total > 0 ? v / total : 0;
      const sw = getResolvedPartyColor(item.isGroup ? item.mainParty : item.party);
      const safeParty = escapeAttribute(item.isGroup ? item.mainParty : item.party);
      const seats = showMandatos ? (item.mandatos || 0) : null;
      let seatsHtml = seats ? fmtInt(seats) : '—';

      const isWinner = (idx === 0);
      // em anos sem coluna de mandatos, o badge do vencedor serve de
      // acesso à listagem de eleitos (quando disponível)
      const badgeClickable = isWinner && !item.isGroup &&
        typeof eleitosSeatsClickable === 'function' && eleitosSeatsClickable();
      const badgeAttrs = badgeClickable
        ? ` role="button" tabindex="0" data-party="${escapeAttribute(item.party)}" title="Ver os eleitos de ${escapeAttribute(item.party)}"`
        : '';
      const badgeCursor = badgeClickable ? ' cursor: pointer;' : '';
      let badgeHtml = '';
      if (isWinner) {
        if (subType === 'cm' && level === 'concelho') {
          badgeHtml = `<span class="badge winner-badge${badgeClickable ? ' eleitos-seats-btn' : ''}"${badgeAttrs} style="background: rgba(245, 158, 11, 0.12); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.58rem; padding: 2px 6px; border-radius: 4px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; margin-top: 3px; display: inline-block;${badgeCursor}">Presidente da Câmara</span>`;
        } else if (subType === 'af' && level === 'freguesia') {
          badgeHtml = `<span class="badge winner-badge${badgeClickable ? ' eleitos-seats-btn' : ''}"${badgeAttrs} style="background: rgba(16, 185, 129, 0.12); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 0.58rem; padding: 2px 6px; border-radius: 4px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; margin-top: 3px; display: inline-block;${badgeCursor}">Presidente da Junta</span>`;
        }
      }

      const fullName = item.isGroup ? '' : (PARTY_FULL_NAMES[getNormalizedPartyColorKey(item.party)] || '');

      const toggleHtml = item.isGroup ? `
        <div class="paf-breakdown-toggle" style="margin-top: 4px; font-size: 0.65rem; color: var(--accent); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; font-weight: 600; user-select: none; transition: color 0.2s;">
          <span>Ver coligações</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="paf-chevron" style="transition: transform 0.2s;"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </div>
      ` : '';

      html += `
        <tr>
          <td class="color-bar-td">
            <button type="button" class="swatch-button cand-color-bar"
                 style="background-color: ${sw};"
                 data-candidate-name="${safeParty}"
                 data-candidate-party="${escapeAttribute(item.party)}"
                 data-current-color="${sw}"
                 title="Personalizar cor do partido"></button>
          </td>
          <td class="align-left">
            <div style="display: flex; flex-direction: column; gap: 3px; align-items: flex-start; justify-content: center; min-width: 0;">
              <span class="cand-name-text" style="font-size: 0.88rem; font-weight: 600; color: var(--text); line-height: 1.25; word-break: break-word;">${escapeHtml(item.party)}</span>
              ${badgeHtml}
              ${toggleHtml}
              ${fullName ? `<span style="font-size: 0.72rem; color: var(--muted); line-height: 1.2; margin-top: 1px;">${escapeHtml(fullName)}</span>` : ''}
            </div>
          </td>
          ${showMandatos ? `<td class="align-center cand-votes-text" style="text-align: center; font-variant-numeric: tabular-nums; font-size: 0.88rem; font-weight: 600; vertical-align: middle;">${(seats && !item.isGroup && typeof eleitosSeatsClickable === 'function' && eleitosSeatsClickable())
            ? `<button type="button" class="eleitos-seats-btn" data-party="${escapeAttribute(item.party)}" title="Ver os eleitos de ${escapeAttribute(item.party)}">${seatsHtml}</button>`
            : seatsHtml
          }</td>` : ''}
          <td class="align-right">
            <div style="display: flex; flex-direction: column; align-items: flex-end; justify-content: center; gap: 1px;">
              <span class="cand-votes-text" style="font-size: 0.88rem; font-variant-numeric: tabular-nums; font-weight: 600; color: var(--text-sec);">${fmtInt(v)}</span>
              <span style="font-size: 0.72rem; color: var(--muted); font-weight: 500; font-variant-numeric: tabular-nums;">${fmtPct(pct)}</span>
            </div>
          </td>
        </tr>
      `;

      if (item.isGroup) {
        let membersRows = '';
        item.members.forEach(member => {
          const memberPct = total > 0 ? member.votes / total : 0;
          const memberSw = getResolvedPartyColor(member.party);
          const memberFullName = PARTY_FULL_NAMES[getNormalizedPartyColorKey(member.party)] || '';
          membersRows += `
            <tr style="border-bottom: 1px dotted rgba(255,255,255,0.04);">
              <td style="padding: 6px 8px; vertical-align: middle; text-align: left;">
                <span style="display: inline-block; width: 4px; height: 16px; background-color: ${memberSw}; border-radius: 2px; margin-right: 8px; vertical-align: middle;"></span>
                <span style="font-weight: 600; color: var(--text); font-size: 0.8rem; vertical-align: middle;">${escapeHtml(member.party)}</span>
                ${memberFullName ? `<div style="font-size: 0.7rem; color: var(--muted); padding-left: 12px; margin-top: 1px;">${escapeHtml(memberFullName)}</div>` : ''}
              </td>
              ${showMandatos ? `
                <td style="text-align: center; font-variant-numeric: tabular-nums; font-size: 0.8rem; font-weight: 500; color: var(--text-sec); vertical-align: middle;">${fmtInt(member.mandatos)}</td>
              ` : ''}
              <td style="text-align: right; vertical-align: middle;">
                <div style="display: flex; flex-direction: column; align-items: flex-end; justify-content: center; gap: 1px;">
                  <span style="font-size: 0.8rem; font-variant-numeric: tabular-nums; font-weight: 500; color: var(--text-sec);">${fmtInt(member.votes)}</span>
                  <span style="font-size: 0.7rem; color: var(--muted); font-variant-numeric: tabular-nums; font-weight: 500;">${fmtPct(memberPct)}</span>
                </div>
              </td>
            </tr>
          `;
        });

        html += `
          <tr class="paf-breakdown-row" style="display: none; background: rgba(255,255,255,0.015);">
            <td colspan="${showMandatos ? 4 : 3}" style="padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.04);">
              <div style="font-size: 0.68rem; color: var(--muted); margin-bottom: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; text-align: left;">Composição da Votação:</div>
              <table style="width: 100%; border-collapse: collapse;">
                <tbody>
                  ${membersRows}
                </tbody>
              </table>
            </td>
          </tr>
        `;
      }
    });

    html += '</tbody></table>';

    if (subType === 'cm' && level === 'concelho') {
      html += `
        <div style="margin-top: 16px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 16px; display: flex; justify-content: center;">
          <button id="btnGoToAM" class="button primary" title="Ver os resultados da Assembleia Municipal deste concelho" style="font-size: 0.72rem; padding: 8px 16px; border-radius: var(--radius-lg); cursor: pointer; background: rgba(255, 255, 255, 0.05); color: var(--text); border: 1px solid rgba(255,255,255,0.1); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; transition: background 0.2s, border-color 0.2s, color 0.2s; display: inline-flex; align-items: center; gap: 6px;">
            <span>Ver Assembleia Municipal</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </button>
        </div>
      `;
    } else if (subType === 'am' && level === 'concelho') {
      html += `
        <div style="margin-top: 16px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 16px; display: flex; justify-content: center;">
          <button id="btnGoToCM" class="button primary" title="Ver os resultados da Câmara Municipal deste concelho" style="font-size: 0.72rem; padding: 8px 16px; border-radius: var(--radius-lg); cursor: pointer; background: rgba(255, 255, 255, 0.05); color: var(--text); border: 1px solid rgba(255,255,255,0.1); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; transition: background 0.2s, border-color 0.2s, color 0.2s; display: inline-flex; align-items: center; gap: 6px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            <span>Ver Câmara Municipal</span>
          </button>
        </div>
      `;
    }
  }

  dom.resultsContent.innerHTML = html;

  if (subType === 'cm' && level === 'concelho') {
    document.getElementById('btnGoToAM')?.addEventListener('click', () => {
      STATE.auSubtype = 'am';
      if (dom.auSubtypeChips) {
        dom.auSubtypeChips.querySelectorAll('.chip-button').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.value === 'am');
        });
      }
      loadCurrentYear();
    });
  } else if (subType === 'am' && level === 'concelho') {
    document.getElementById('btnGoToCM')?.addEventListener('click', () => {
      STATE.auSubtype = 'cm';
      if (dom.auSubtypeChips) {
        dom.auSubtypeChips.querySelectorAll('.chip-button').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.value === 'cm');
        });
      }
      loadCurrentYear();
    });
  }

  // Custom dashboard styled metrics template using stylesheet classes
  let metricsHtml = '<div class="metrics-grid">';

  // Card Helper
  const makeCard = (label, val) => `
    <div class="metric-item">
      <span>${label}</span>
      <strong>${val}</strong>
    </div>
  `;

  metricsHtml += makeCard('Votos Válidos', fmtInt(total));

  if (official) {
    const inscritos = ensureNumber(official.inscritos);
    const votantes = ensureNumber(official.votantes);
    const brancos = ensureNumber(official.brancos);
    const nulos = ensureNumber(official.nulos);
    const abst = inscritos > 0 ? (inscritos - votantes) / inscritos : null;

    metricsHtml += makeCard('Inscritos', fmtInt(inscritos));
    metricsHtml += makeCard('Votantes', `${fmtInt(votantes)}${inscritos > 0 ? ` <span style="font-size: 0.72rem; color: var(--muted); font-weight: 500; display: inline-block; margin-left: 2px;">(${fmtPct(votantes / inscritos)})</span>` : ''}`);
    metricsHtml += makeCard('Abstenção', abst !== null ? fmtPct(abst) : '—');
    metricsHtml += makeCard('Brancos', `${fmtInt(brancos)}${votantes > 0 ? ` <span style="font-size: 0.72rem; color: var(--muted); font-weight: 500; display: inline-block; margin-left: 2px;">(${fmtPct(brancos / votantes)})</span>` : ''}`);
    metricsHtml += makeCard('Nulos', `${fmtInt(nulos)}${votantes > 0 ? ` <span style="font-size: 0.72rem; color: var(--muted); font-weight: 500; display: inline-block; margin-left: 2px;">(${fmtPct(nulos / votantes)})</span>` : ''}`);

    const mandatosTotal = official.mandatos;

    if (mandatosTotal) {
      metricsHtml += makeCard('Total Mandatos', fmtInt(ensureNumber(mandatosTotal)));
    }
  }

  metricsHtml += '</div>';
  dom.resultsMetrics.innerHTML = metricsHtml;

  // listagem dos eleitos autárquicos (Diário da República), injetada assincronamente
  // a listagem dos eleitos abre a partir do número de mandatos na tabela
  // (eleitos-portugal.js: .eleitos-seats-btn -> toggleEleitosPartyRow)
}


