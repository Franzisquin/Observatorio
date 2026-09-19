// ============================================================================
// map-render-pt.js — choropleth de freguesias (MapLibre via MLCompat.GeoLayer)
// ============================================================================

// ---------- ESTILO ----------

const MAP_LEVELS = {
  distrito: {
    idProp: 'circulo',
    getVotes: (id) => {
      if (STATE.currentCirculo === 'E1' || STATE.currentCirculo === 'E2') {
        return STATE.data?.COUNTRIES?.[STATE.currentCirculo]?.[id]?.votes;
      }
      if (STATE.currentNuts) {
        const d = STATE.data;
        if (!d) return {};
        const matchingFreguesias = Object.keys(d.RESULTS || {}).filter(code => {
          return code.slice(0, 2) === id && isConcelhoInNuts(code.slice(0, 4));
        });
        const votesSum = {};
        matchingFreguesias.forEach(code => {
          const votes = d.RESULTS[code] || {};
          for (const [p, v] of Object.entries(votes)) {
            votesSum[p] = (votesSum[p] || 0) + v;
          }
        });
        return votesSum;
      }
      return STATE.data?.AGG?.distrito?.[id]?.votes;
    },
    getName: (id) => CIRCULOS.get(id) || id,
    getOfficial: (id) => {
      if (STATE.currentCirculo === 'E1' || STATE.currentCirculo === 'E2') {
        return STATE.data?.COUNTRIES?.[STATE.currentCirculo]?.[id];
      }
      if (STATE.currentNuts) {
        const d = STATE.data;
        if (!d) return null;
        const matchingFreguesias = Object.keys(d.RESULTS || {}).filter(code => {
          return code.slice(0, 2) === id && isConcelhoInNuts(code.slice(0, 4));
        });
        let sumInsc = 0, sumVot = 0, sumBra = 0, sumNul = 0;
        matchingFreguesias.forEach(code => {
          const offVal = d.OFFICIAL_F?.[code];
          if (offVal) {
            sumInsc += offVal[0];
            sumVot += offVal[1];
            sumBra += offVal[2];
            sumNul += offVal[3];
          }
        });
        return {
          inscritos: sumInsc,
          votantes: sumVot,
          brancos: sumBra,
          nulos: sumNul
        };
      }
      return STATE.data?.AGG?.distrito?.[id];
    }
  },
  concelho: {
    idProp: 'dico',
    getVotes: (id) => STATE.data?.AGG?.concelho?.[id]?.votes,
    getName: (id) => getConcelhoNome(id),
    getOfficial: (id) => STATE.data?.AGG?.concelho?.[id]
  },
  freguesia: {
    idProp: 'dicofre',
    getVotes: (id) => STATE.data?.RESULTS?.[id],
    getName: (id) => STATE.data?.NAMES?.[id] || id,
    getOfficial: (id) => {
      const offVal = STATE.data?.OFFICIAL_F?.[id];
      return offVal ? {
        inscritos: offVal[0],
        votantes: offVal[1],
        brancos: offVal[2],
        nulos: offVal[3]
      } : null;
    }
  }
};

const EXTRUSION_SCALE = {
  freguesia: 260,
  concelho: 110,
  distrito: 45
};

function registerStripePattern(color1, color2) {
  if (typeof window === 'undefined' || !window.map) return null;
  const m = window.map;
  
  const c1 = color1.replace('#', '').toLowerCase();
  const c2 = color2.replace('#', '').toLowerCase();
  const patternId = `tie-${c1}-${c2}`;
  
  if (m.hasImage(patternId)) return patternId;
  
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  
  ctx.fillStyle = color1;
  ctx.fillRect(0, 0, 32, 32);
  
  ctx.fillStyle = color2;
  ctx.beginPath();
  ctx.moveTo(0, 32);
  ctx.lineTo(32, 0);
  ctx.lineTo(32, 16);
  ctx.lineTo(16, 32);
  ctx.closePath();
  ctx.fill();
  
  ctx.beginPath();
  ctx.moveTo(0, 16);
  ctx.lineTo(16, 0);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();
  
  try {
    const imgData = ctx.getImageData(0, 0, 32, 32);
    m.addImage(patternId, imgData);
  } catch (err) {
    console.error("Erro ao registrar padrão de empate:", err);
  }
  
  return patternId;
}

function getFeatureFill(level, feature) {
  const cfg = MAP_LEVELS[level];
  const idProp = (level === 'distrito' && (STATE.currentCirculo === 'E1' || STATE.currentCirculo === 'E2')) ? 'nome' : cfg.idProp;
  const id = feature.properties?.[idProp];
  const votes = cfg.getVotes(id);
  
  if (STATE.currentElectionType === 'au' && !votes && level !== 'freguesia') return { fillColor: DEFAULT_SWATCH, pattern: null };
  if (STATE.currentElectionType !== 'au' && (!votes || !Object.keys(votes).length)) return { fillColor: DEFAULT_SWATCH, pattern: null };

  if (currentVizMode === 'desempenho' && STATE.vizParty) {
    const pct = getPartyPct(votes, STATE.vizParty);
    if (pct === null) return { fillColor: DEFAULT_SWATCH, pattern: null };
    const base = getResolvedPartyColor(STATE.vizParty);
    const stats = STATE.performanceStats;
    let color = DEFAULT_SWATCH;
    if (stats && stats.party === STATE.vizParty) {
      color = getRelativeGradientColor(base, pct, stats.minPct, stats.maxPct);
    } else {
      color = getUniversalGradientColor(base, pct);
    }
    return { fillColor: color, pattern: null };
  }

  if (STATE.currentElectionType === 'au') {
    const subType = STATE.auSubtype || 'cm';
    let presidents = null;
    let maiorias = null;
    let mandatos_p = null;
    
    if (level === 'distrito') {
      const entry = STATE.data?.AGG?.distrito?.[id];
      presidents = entry?.presidents || {};
      maiorias = entry?.maiorias || {};
      mandatos_p = entry?.mandatos_p || {};
    } else if (level === 'concelho') {
      const entry = STATE.data?.AGG?.concelho?.[id];
      presidents = entry?.presidents || {};
      maiorias = entry?.maiorias || {};
      mandatos_p = entry?.mandatos_p || {};
    }
    
    const grouped = groupAutarquicasVotes(votes || {}, presidents, maiorias, mandatos_p, level, subType);
    if (!grouped || !grouped.length) return { fillColor: DEFAULT_SWATCH, pattern: null };
    
    const isCM_AF_Agg = (subType === 'cm' && (level === 'national' || level === 'distrito')) ||
                        (subType === 'af' && (level === 'national' || level === 'distrito' || level === 'concelho'));
    
    const metricKey = isCM_AF_Agg ? 'presidents' : (subType === 'am' && (level === 'national' || level === 'distrito') ? 'mandatos' : 'votes');
    
    const winVal = grouped[0]?.[metricKey] || 0;
    const secondVal = grouped[1]?.[metricKey] || 0;
    
    const color1 = getResolvedPartyColor(grouped[0]?.mainParty || grouped[0]?.party);
    
    if (winVal === secondVal && winVal > 0) {
      const color2 = getResolvedPartyColor(grouped[1]?.mainParty || grouped[1]?.party);
      const patternId = registerStripePattern(color1, color2);
      return { fillColor: color1, pattern: patternId };
    }
    
    const totalMetric = grouped.reduce((sum, item) => sum + (item[metricKey] || 0), 0);
    const pct = totalMetric > 0 ? (winVal / totalMetric) * 100 : 0;
    const marginPct = totalMetric > 0 ? ((winVal - secondVal) / totalMetric) * 100 : 0;
    
    const color = getGradientColorForMode(color1, marginPct, pct);
    return { fillColor: color, pattern: null };
  }

  const w = getWinner(votes);
  if (!w) return { fillColor: DEFAULT_SWATCH, pattern: null };
  const base = getResolvedPartyColor(w.party);
  const color = getGradientColorForMode(base, w.marginPct, w.pct);
  return { fillColor: color, pattern: null };
}

function getFeatureStyle(level, feature) {
  const cfg = MAP_LEVELS[level];
  const idProp = (level === 'distrito' && (STATE.currentCirculo === 'E1' || STATE.currentCirculo === 'E2')) ? 'nome' : cfg.idProp;
  const id = feature.properties?.[idProp];
  
  let isSelected = false;
  if (level === 'freguesia') {
    isSelected = selectedLocationIDs.has(id);
  } else if (level === 'distrito' && (STATE.currentCirculo === 'E1' || STATE.currentCirculo === 'E2')) {
    isSelected = (id === STATE.selectedCountry);
  } else if (level === STATE.scope.level && id === STATE.scope.key) {
    isSelected = true;
  }

  let inFocus = true;
  if (level === 'distrito' && (STATE.currentCirculo === 'E1' || STATE.currentCirculo === 'E2')) {
    if (STATE.selectedCountry) {
      inFocus = (id === STATE.selectedCountry);
    }
  } else if (STATE.scope && STATE.scope.level && STATE.scope.level !== 'national') {
    const activeLevel = STATE.scope.level;
    const activeKey = STATE.scope.key;
    
    if (activeLevel === 'distrito') {
      if (level === 'distrito') {
        inFocus = (id === activeKey);
      } else if (level === 'concelho') {
        const circ = feature.properties?.circulo || id.substring(0, 2);
        inFocus = (circ === activeKey);
      } else if (level === 'freguesia') {
        const circ = feature.properties?.circulo || id.substring(0, 2);
        inFocus = (circ === activeKey);
      }
    } else if (activeLevel === 'concelho') {
      if (level === 'distrito') {
        inFocus = false;
      } else if (level === 'concelho') {
        inFocus = (id === activeKey);
      } else if (level === 'freguesia') {
        const dico = feature.properties?.dico || id.substring(0, 4);
        let allowedActiveKeys = [activeKey];
        if ((STATE.currentYear === '1997' || STATE.currentYear === '1993') && STATE.currentElectionType === 'au') {
          if (activeKey === '1107') {
            allowedActiveKeys.push('1116');
          } else if (activeKey === '0308') {
            allowedActiveKeys.push('0314');
          } else if (activeKey === '1314') {
            allowedActiveKeys.push('1318');
          }
        }
        inFocus = allowedActiveKeys.includes(dico);
      }
    } else if (activeLevel === 'freguesia') {
      if (level === 'distrito') {
        inFocus = false;
      } else if (level === 'concelho') {
        const conc = STATE.scope.concelho || activeKey.substring(0, 4);
        let allowed = [conc];
        if ((STATE.currentYear === '1997' || STATE.currentYear === '1993') && STATE.currentElectionType === 'au') {
          if (conc === '1116') allowed.push('1107');
          if (conc === '0314') allowed.push('0308');
          if (conc === '1318') allowed.push('1314');
        }
        inFocus = allowed.includes(id);
      } else if (level === 'freguesia') {
        inFocus = (id === activeKey);
      }
    }
  }

  const fillInfo = getFeatureFill(level, feature);
  const style = {
    fillColor: typeof fillInfo === 'string' ? fillInfo : fillInfo.fillColor,
    fillOpacity: inFocus ? 0.82 : 0.18,
    color: isSelected ? 'var(--accent)' : 'rgba(255,255,255,0.22)',
    weight: isSelected ? 2.5 : 0.4,
    opacity: isSelected ? 1 : (inFocus ? 0.85 : 0.25)
  };

  if (fillInfo && fillInfo.pattern) {
    style.pattern = fillInfo.pattern;
  }

  if (STATE.extrusionEnabled && level === STATE.mapLevel) {
    const votes = cfg.getVotes(id);
    let total = 0;
    if (votes) {
      for (const v of Object.values(votes)) total += v;
    }
    const scale = EXTRUSION_SCALE[level] || 100;
    style.height = Math.sqrt(total) * scale;
  } else {
    style.height = 0;
  }
  return style;
}

// ---------- TOOLTIP ----------

function buildFeatureTooltip(level, feature) {
  const cfg = MAP_LEVELS[level];
  const p = feature.properties || {};
  const idProp = (level === 'distrito' && (STATE.currentCirculo === 'E1' || STATE.currentCirculo === 'E2')) ? 'nome' : cfg.idProp;
  const id = p[idProp];
  const votes = cfg.getVotes(id);
  const nome = (level === 'distrito' && (STATE.currentCirculo === 'E1' || STATE.currentCirculo === 'E2')) ? id : cfg.getName(id);

  let rowsHtml = '';
  let totalLabel = '';
  
  if (STATE.currentElectionType === 'au') {
    const subType = STATE.auSubtype || 'cm';
    let presidents = null;
    let maiorias = null;
    let mandatos_p = null;
    
    if (level === 'distrito') {
      const entry = STATE.data?.AGG?.distrito?.[id];
      presidents = entry?.presidents || {};
      maiorias = entry?.maiorias || {};
      mandatos_p = entry?.mandatos_p || {};
    } else if (level === 'concelho') {
      const entry = STATE.data?.AGG?.concelho?.[id];
      presidents = entry?.presidents || {};
      maiorias = entry?.maiorias || {};
      mandatos_p = entry?.mandatos_p || {};
    }
    
    const yearNum = parseInt(STATE.currentYear || '0', 10);
    const isPlenario = (level === 'freguesia' && subType === 'af' && yearNum <= 2009 && (!votes || !Object.keys(votes).length));

    if (isPlenario) {
      const limit = yearNum <= 1999 ? '300' : '150';
      rowsHtml = `
        <div style="color:var(--accent); font-size:0.8rem; font-weight:700; margin-top:6px; line-height:1.45;">
          Plenário de Cidadãos
        </div>
        <div style="color:var(--text-sec); font-size:0.72rem; margin-top:2px; line-height:1.35; font-weight:500;">
          Dispensa de eleição direta por ter menos de ${limit} eleitores inscritos.
        </div>
      `;
      totalLabel = '';
    } else {
      const grouped = groupAutarquicasVotes(votes || {}, presidents, maiorias, mandatos_p, level, subType);
      if (grouped && grouped.length) {
        const isCM_AF_Agg = (subType === 'cm' && (level === 'national' || level === 'distrito')) ||
                            (subType === 'af' && (level === 'national' || level === 'distrito' || level === 'concelho'));
        const metricKey = isCM_AF_Agg ? 'presidents' : (subType === 'am' && (level === 'national' || level === 'distrito') ? 'mandatos' : 'votes');
        
        const total = grouped.reduce((sum, item) => sum + (item[metricKey] || 0), 0);
        
        rowsHtml = grouped.slice(0, 3).map(item => {
          const v = item[metricKey] || 0;
          const color = getResolvedPartyColor(item.isGroup ? item.mainParty : item.party);
          const pct = total > 0 ? (v / total) : 0;
          
          let label = '';
          if (metricKey === 'presidents') {
            const typeLabel = subType === 'cm' ? (v === 1 ? 'Câmara' : 'Câmaras') : (v === 1 ? 'Junta' : 'Juntas');
            label = `${v} ${typeLabel}`;
          } else if (metricKey === 'mandatos') {
            label = `${v} ${v === 1 ? 'Mandato' : 'Mandatos'}`;
          } else {
            label = `${fmtPct(pct)} <span style="color:var(--muted); font-size:0.7rem; font-weight:400; font-variant-numeric:tabular-nums; margin-left:4px;">(${fmtInt(v)})</span>`;
          }
          
          const pctHtml = (metricKey === 'presidents' || metricKey === 'mandatos') ? ` <span style="color:var(--muted); font-variant-numeric: tabular-nums;">(${fmtPct(pct)})</span>` : '';
          
          return `<div style="display:flex; align-items:center; gap:6px; margin-top:3px;">
            <span style="width:9px; height:9px; border-radius:2px; background:${color}; flex-shrink:0;"></span>
            <span style="flex:1; min-width: 80px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(item.party)}">${escapeHtml(item.party)}</span>
            <strong style="font-variant-numeric: tabular-nums;">${label}</strong>
            ${pctHtml}
          </div>`;
        }).join('');
        
        if (metricKey === 'presidents') {
          const typeLabel = subType === 'cm' ? 'Municípios' : 'Freguesias';
          totalLabel = `<div style="margin-top:6px; color:var(--muted); font-size:0.72rem; border-top:1px solid rgba(255,255,255,0.06); padding-top:4px;">Total: ${total} ${typeLabel}</div>`;
        } else if (metricKey === 'mandatos') {
          totalLabel = `<div style="margin-top:6px; color:var(--muted); font-size:0.72rem; border-top:1px solid rgba(255,255,255,0.06); padding-top:4px;">Total: ${total} Mandatos</div>`;
        } else {
          totalLabel = `<div style="margin-top:6px; color:var(--muted); font-size:0.72rem; border-top:1px solid rgba(255,255,255,0.06); padding-top:4px;">Total: ${fmtInt(total)} Votos Válidos</div>`;
        }
      } else {
        rowsHtml = `<div style="color:var(--muted); margin-top:3px;">Sem dados</div>`;
      }
    }
  } else if (votes && Object.keys(votes).length) {
    const entries = Object.entries(votes).sort((a, b) => b[1] - a[1]);
    let total = 0;
    entries.forEach(([, v]) => { total += v; });
    rowsHtml = entries.slice(0, 3).map(([party, v]) => {
      const color = getResolvedPartyColor(party);
      const pct = total > 0 ? (v / total) : 0;
      return `<div style="display:flex; align-items:center; gap:6px; margin-top:3px;">
        <span style="width:9px; height:9px; border-radius:2px; background:${color}; flex-shrink:0;"></span>
        <span style="flex:1; min-width: 80px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(party)}">${escapeHtml(party)}</span>
        <strong style="font-variant-numeric: tabular-nums;">${fmtPct(pct)}</strong>
        <span style="color:var(--muted); font-variant-numeric: tabular-nums;">${fmtInt(v)}</span>
      </div>`;
    }).join('');
    totalLabel = `<div style="margin-top:6px; color:var(--muted); font-size:0.72rem; border-top:1px solid rgba(255,255,255,0.06); padding-top:4px;">Total: ${fmtInt(total)} Votos Válidos</div>`;
  } else {
    const noElection = (typeof territoryHasNoElection === 'function') && territoryHasNoElection(id);
    rowsHtml = `<div style="color:var(--muted); margin-top:3px;">${noElection ? 'Votação não realizada' : 'Sem dados'}</div>`;
  }

  const parentName = (level === 'distrito' && (STATE.currentCirculo === 'E1' || STATE.currentCirculo === 'E2'))
    ? CIRCULOS.get(STATE.currentCirculo)
    : (level === 'freguesia'
       ? `${escapeHtml(p.concelho || '')}${p.concelho ? ' · ' : ''}${escapeHtml(CIRCULOS.get(p.circulo) || '')}`
       : (level === 'concelho' ? escapeHtml(CIRCULOS.get(p.circulo) || '') : 'Portugal'));

  return `<div style="min-width: 170px;">
    <div style="font-weight:700;">${escapeHtml(nome)}</div>
    <div style="color:var(--muted); font-size:0.75rem;">${parentName}</div>
    ${rowsHtml}
    ${totalLabel}
  </div>`;
}

// ---------- CLIQUE / NAVEGAÇÃO ----------

function onFeatureClick(level, feature, e) {
  const cfg = MAP_LEVELS[level];
  const idProp = (level === 'distrito' && (STATE.currentCirculo === 'E1' || STATE.currentCirculo === 'E2')) ? 'nome' : cfg.idProp;
  const id = feature.properties?.[idProp];
  if (!id) return;

  if (typeof window.isFeatureDisabled === 'function' && window.isFeatureDisabled(level === 'freguesia' ? 'freguesias' : (level === 'concelho' ? 'concelhos' : 'distritos'), feature)) {
    return;
  }

  if (level === 'distrito') {
    if (STATE.currentCirculo === 'E1' || STATE.currentCirculo === 'E2') {
      STATE.selectedCountry = id;
      renderResultsPanel();
      applyFiltersAndRedraw();
      return;
    }
    navigateToDistrito(id, { focus: true });
  } else if (level === 'concelho') {
    navigateToConcelho(id, feature);
  } else if (level === 'freguesia') {
    const shiftKey = !!(e?.originalEvent?.shiftKey);
    if (shiftKey) {
      if (selectedLocationIDs.has(id)) selectedLocationIDs.delete(id);
      else selectedLocationIDs.add(id);
      isDragSelection = false;
      applyFiltersAndRedraw();
      return;
    }
    selectedLocationIDs.clear();
    STATE.scope = {
      level: 'freguesia',
      key: id,
      concelho: id.slice(0, 4),
      circulo: circuloFromDicofre(id)
    };
    applyFiltersAndRedraw();
  }
}

async function navigateToNational({ focus = false } = {}) {
  selectedLocationIDs.clear();
  STATE.selectedCountry = null;
  STATE.scope = { level: 'national', key: null };
  STATE.mapLevel = STATE.granularity;
  if (dom.selectCirculo) dom.selectCirculo.value = '';
  STATE.currentCirculo = '';
  
  if (STATE.mapLevel === 'freguesia') {
    const bundle = PT_YEAR_CACHE.get(STATE.currentElectionType === 'au' ? `${STATE.currentElectionType}:${STATE.auSubtype}:${STATE.currentYear}` : `${STATE.currentElectionType}:${STATE.currentYear}`);
    if (bundle && !bundle.freguesiasLoaded) {
      showMapLoading("A carregar freguesias em fundo...", 50);
      await bundle.freguesiasReady;
      hideMapLoading();
    }
  }
  
  syncMapLevel();
  if (focus) {
    if (STATE.currentNuts) {
      focusNutsOnMap(STATE.currentNuts, true);
    } else {
      focusCountryOnMap(true);
    }
  }
  applyFiltersAndRedraw();
}

async function navigateToDistrito(circulo, { focus = false } = {}) {
  selectedLocationIDs.clear();
  STATE.selectedCountry = null;
  STATE.currentCirculo = circulo;

  if (CIRCULOS_SEM_GEOMETRIA.has(circulo)) {
    STATE.scope = { level: 'distrito', key: circulo };
    STATE.mapLevel = 'distrito';
    syncMapLevel();
    if (dom.selectCirculo) dom.selectCirculo.value = circulo;
    if (focus) {
      focusCirculoOnMap(circulo, true);
    }
    applyFiltersAndRedraw();
    return;
  }
  
  STATE.scope = { level: 'distrito', key: circulo };
  if (dom.selectCirculo) dom.selectCirculo.value = circulo;
  
  // Sempre entra em concelhos quando clica/seleciona distrito
  STATE.mapLevel = 'concelho';
  
  syncMapLevel();
  if (focus) {
    focusCirculoOnMap(circulo, true);
  }
  applyFiltersAndRedraw();
}

async function navigateToConcelho(dico, feature = null) {
  selectedLocationIDs.clear();
  STATE.selectedCountry = null;
  const circulo = circuloFromDicofre(dico + '00');
  
  STATE.scope = {
    level: 'concelho',
    key: dico,
    nome: feature?.properties?.concelho || getConcelhoNome(dico),
    circulo: circulo
  };
  
  // Sempre entra em freguesias quando clica/seleciona concelho
  STATE.mapLevel = 'freguesia';
  
  if (dom.selectCirculo) dom.selectCirculo.value = circulo;
  STATE.currentCirculo = circulo;
  
  if (STATE.mapLevel === 'freguesia') {
    const bundle = PT_YEAR_CACHE.get(STATE.currentElectionType === 'au' ? `${STATE.currentElectionType}:${STATE.auSubtype}:${STATE.currentYear}` : `${STATE.currentElectionType}:${STATE.currentYear}`);
    if (bundle && !bundle.freguesiasLoaded) {
      showMapLoading("A carregar freguesias em fundo...", 50);
      await bundle.freguesiasReady;
      hideMapLoading();
    }
  }

  syncMapLevel();
  
  let targetFeature = feature;
  if (!targetFeature && STATE.geo?.concelhos) {
    targetFeature = STATE.geo.concelhos.features.find(f => f.properties?.dico === dico);
  }
  if (targetFeature) {
    const bounds = MLCompat.featureBounds(targetFeature);
    if (bounds) MLCompat.fitMapToBounds(map, bounds, { padding: [40, 40], animate: true });
  }
  applyFiltersAndRedraw();
}

async function navigateToFreguesia(dicofre) {
  const dico = String(dicofre).slice(0, 4);
  await navigateToConcelho(dico);

  selectedLocationIDs.clear();
  STATE.scope = {
    level: 'freguesia',
    key: dicofre,
    concelho: dico,
    circulo: circuloFromDicofre(dicofre)
  };

  const feat = STATE.geo?.freguesias?.features?.find(f => f.properties?.dicofre === dicofre);
  if (feat) {
    const bounds = MLCompat.featureBounds(feat);
    if (bounds) MLCompat.fitMapToBounds(map, bounds, { padding: [60, 60], animate: true });
  }
  applyFiltersAndRedraw();
}

function clearSelection(redraw = true) {
  selectedLocationIDs.clear();
  STATE.selectedCountry = null;
  isDragSelection = false;
  if (STATE.currentCirculo) {
    navigateToDistrito(STATE.currentCirculo, { focus: false });
  } else {
    navigateToNational({ focus: false });
  }
}

function updateClearSelectionButtonVisibility() {
  const btn = dom.btnClearSelection || document.getElementById('btnClearSelection');
  if (btn) {
    const show = selectedLocationIDs.size > 0 || !!STATE.selectedCountry;
    btn.style.display = show ? 'inline-flex' : 'none';
  }
  updateBackLevelButton();
}

// ---------- CAMADAS ----------

function buildMapLayers() {
  const geo = STATE.geo;
  if (!geo) return;

  if (STATE.freguesiasLayer) { STATE.freguesiasLayer.remove(); STATE.freguesiasLayer = null; }
  if (STATE.concelhosLayer) { STATE.concelhosLayer.remove(); STATE.concelhosLayer = null; }
  if (STATE.distritosLayer) { STATE.distritosLayer.remove(); STATE.distritosLayer = null; }
  if (STATE.concelhosOutlineLayer) { STATE.concelhosOutlineLayer.remove(); STATE.concelhosOutlineLayer = null; }
  if (STATE.distritosOutlineLayer) { STATE.distritosOutlineLayer.remove(); STATE.distritosOutlineLayer = null; }

  // 1. Freguesias Fill
  STATE.freguesiasLayer = new MLCompat.GeoLayer(map, {
    id: 'freguesias',
    type: 'polygon',
    styleFn: (feat) => getFeatureStyle('freguesia', feat),
    tooltipFn: (feat) => buildFeatureTooltip('freguesia', feat),
    onClick: (feat, e) => onFeatureClick('freguesia', feat, e),
    hover: true
  }).setFeatures([]).addTo(map);

  // 2. Concelhos Fill
  STATE.concelhosLayer = new MLCompat.GeoLayer(map, {
    id: 'concelhos',
    type: 'polygon',
    styleFn: (feat) => getFeatureStyle('concelho', feat),
    tooltipFn: (feat) => buildFeatureTooltip('concelho', feat),
    onClick: (feat, e) => onFeatureClick('concelho', feat, e),
    hover: true
  }).setFeatures([]).addTo(map);

  // 3. Distritos Fill
  STATE.distritosLayer = new MLCompat.GeoLayer(map, {
    id: 'distritos',
    type: 'polygon',
    styleFn: (feat) => getFeatureStyle('distrito', feat),
    tooltipFn: (feat) => buildFeatureTooltip('distrito', feat),
    onClick: (feat, e) => onFeatureClick('distrito', feat, e),
    hover: true
  }).setFeatures(geo.distritos.features).addTo(map);

  // 4. Concelhos Outline
  STATE.concelhosOutlineLayer = new MLCompat.GeoLayer(map, {
    id: 'concelhos-outline',
    type: 'polygon',
    styleFn: () => ({
      fillColor: '#000000', fillOpacity: 0,
      color: 'rgba(255,255,255,0.55)', weight: 0.9, opacity: 0.7
    })
  }).setFeatures([]).addTo(map);

  // 5. Distritos Outline
  STATE.distritosOutlineLayer = new MLCompat.GeoLayer(map, {
    id: 'distritos-outline',
    type: 'polygon',
    styleFn: () => ({
      fillColor: '#000000', fillOpacity: 0,
      color: 'rgba(255,255,255,0.85)', weight: 1.4, opacity: 0.8
    })
  }).setFeatures([]).addTo(map);

  syncMapLevel();
}

function syncMapLevelChips() {
  const chips = dom.mapLevelChips || document.getElementById('mapLevelChips');
  if (chips) {
    chips.querySelectorAll('.chip-button').forEach((b) => {
      b.classList.toggle('active', b.dataset.value === STATE.mapLevel);
    });
  }
  updateBackLevelButton();
}

// Destino do botão "Voltar" (um nível acima do escopo atual)
function getBackLevelTarget() {
  if (selectedLocationIDs.size > 0 || STATE.selectedCountry) {
    if (STATE.currentCirculo) {
      return { label: CIRCULOS.get(STATE.currentCirculo) || STATE.currentCirculo, action: 'clear' };
    }
    return { label: 'Portugal', action: 'clear' };
  }
  const scope = STATE.scope || {};
  if (scope.level === 'freguesia') {
    const dico = String(scope.key || '').slice(0, 4);
    return { label: getConcelhoNome(dico), action: 'concelho', key: dico };
  }
  if (scope.level === 'concelho') {
    const circ = scope.circulo || circuloFromDicofre(String(scope.key) + '00');
    return { label: CIRCULOS.get(circ) || circ, action: 'distrito', key: circ };
  }
  if (scope.level === 'distrito') {
    return { label: 'Portugal', action: 'national' };
  }
  return null;
}

function updateBackLevelButton() {
  const btn = document.getElementById('btnBackLevel');
  if (!btn) return;
  const target = getBackLevelTarget();
  if (!target) {
    btn.style.display = 'none';
    return;
  }
  btn.style.display = 'inline-flex';
  const labelEl = document.getElementById('btnBackLevelLabel');
  if (labelEl) labelEl.textContent = target.label;
  btn.title = `Voltar para ${target.label}`;
  btn.dataset.backAction = target.action;
  btn.dataset.backKey = target.key || '';
}

function syncMapLevel() {
  const geo = STATE.geo;
  if (!geo) return;

  function filterFeaturesForNuts(feats, level) {
    if (!STATE.currentNuts || STATE.currentElectionType === 'au') return feats;
    if (!feats) return [];
    return feats.filter(f => {
      if (level === 'freguesia') {
        const dicofre = f.properties?.dicofre || f.properties?.id;
        if (!dicofre) return false;
        return window.isConcelhoInNuts && window.isConcelhoInNuts(String(dicofre).slice(0, 4));
      }
      if (level === 'concelho') {
        const dico = f.properties?.dico || f.properties?.id;
        return window.isConcelhoInNuts && window.isConcelhoInNuts(dico);
      }
      if (level === 'distrito') {
        const distCirc = f.properties?.circulo || f.properties?.id;
        if (!distCirc) return false;
        if (typeof NUTS_DATA !== 'undefined') {
          return Object.keys(NUTS_DATA).some(dicoKey => {
            if (dicoKey.slice(0, 2) !== distCirc) return false;
            return window.isConcelhoInNuts && window.isConcelhoInNuts(dicoKey);
          });
        }
        return false;
      }
      return true;
    });
  }

  if (map) {
    try {
      map.setFeatureState({ source: 'distritos-source', id: 0 }, { hover: false });
      map.setFeatureState({ source: 'concelhos-source', id: 0 }, { hover: false });
      map.setFeatureState({ source: 'freguesias-source', id: 0 }, { hover: false });
    } catch (_) {}

    if (STATE.currentCirculo === 'E1' || STATE.currentCirculo === 'E2') {
      map.setMinZoom(1);
    } else {
      map.setMinZoom(4.5);
    }
  }

  // Sincronizar os botões do topo do mapa
  syncMapLevelChips();

  // Se estivermos na visão nacional (nenhum distrito selecionado)
  if (!STATE.currentCirculo) {
    if (STATE.granularity === 'distrito') {
      STATE.distritosLayer?.setData(filterFeaturesForNuts(geo.distritos.features, 'distrito'));
      STATE.concelhosLayer?.setData([]);
      STATE.freguesiasLayer?.setData([]);
      STATE.distritosOutlineLayer?.setData([]);
      STATE.concelhosOutlineLayer?.setData([]);
    } else if (STATE.granularity === 'concelho') {
      STATE.distritosLayer?.setData([]);
      STATE.concelhosLayer?.setData(filterFeaturesForNuts(geo.concelhos.features, 'concelho'));
      STATE.freguesiasLayer?.setData([]);
      STATE.distritosOutlineLayer?.setData(filterFeaturesForNuts(geo.distritos.features.filter(f => f.properties?.circulo !== '30' && f.properties?.circulo !== '40'), 'distrito')); // Contorno do distrito sobre os concelhos (menos ilhas)
      STATE.concelhosOutlineLayer?.setData([]);
    } else if (STATE.granularity === 'freguesia') {
      STATE.distritosLayer?.setData([]);
      STATE.concelhosLayer?.setData([]);
      STATE.freguesiasLayer?.setData(filterFeaturesForNuts(geo.freguesias?.features || [], 'freguesia'));
      STATE.distritosOutlineLayer?.setData(filterFeaturesForNuts(geo.distritos.features.filter(f => f.properties?.circulo !== '30' && f.properties?.circulo !== '40'), 'distrito')); // Contorno do distrito sobre as freguesias (menos ilhas)
      STATE.concelhosOutlineLayer?.setData(filterFeaturesForNuts(geo.concelhos.features, 'concelho')); // Contorno do concelho sobre as freguesias
    }
    return;
  }

  // Se um distrito (ou círculo de emigração) estiver selecionado (Visão de Resolução Mista)
  const selectedConcelhoIdForFreg = (STATE.scope.level === 'concelho' || STATE.scope.level === 'freguesia')
    ? (STATE.scope.level === 'concelho' ? STATE.scope.key : STATE.scope.key.slice(0, 4))
    : null;

  // --- 1. Distritos Layer ---
  let distritoFeatures = [];
  if (STATE.currentCirculo === 'E1') {
    distritoFeatures = geo.estrangeiroEuropa?.features || [];
  } else if (STATE.currentCirculo === 'E2') {
    distritoFeatures = geo.estrangeiroMundo?.features || [];
  } else {
    if (STATE.mapLevel === 'distrito') {
      // Mostra todos os distritos (incluindo o selecionado)
      distritoFeatures = geo.distritos.features;
    } else {
      // Exibimos todos os distritos exceto o selecionado
      distritoFeatures = geo.distritos.features.filter(f => f.properties?.circulo !== STATE.currentCirculo);
    }
  }
  STATE.distritosLayer?.setData(filterFeaturesForNuts(distritoFeatures, 'distrito'));

  // --- 2. Concelhos Layer ---
  let concelhoFeatures = [];
  if (!CIRCULOS_SEM_GEOMETRIA.has(STATE.currentCirculo)) {
    if (STATE.mapLevel === 'concelho') {
      concelhoFeatures = geo.concelhos.features.filter(f => f.properties?.circulo === STATE.currentCirculo);
    } else if (STATE.mapLevel === 'freguesia' && selectedConcelhoIdForFreg) {
      concelhoFeatures = geo.concelhos.features.filter(f => 
        f.properties?.circulo === STATE.currentCirculo && f.properties?.dico !== selectedConcelhoIdForFreg
      );
    }
  }
  STATE.concelhosLayer?.setData(filterFeaturesForNuts(concelhoFeatures, 'concelho'));

  // --- 3. Freguesias Layer ---
  let freguesiaFeatures = [];
  if (STATE.mapLevel === 'freguesia') {
    if (geo.freguesias?.features) {
      if (selectedConcelhoIdForFreg) {
        let allowedDicos = [selectedConcelhoIdForFreg];
        if ((STATE.currentYear === '1997' || STATE.currentYear === '1993') && STATE.currentElectionType === 'au') {
          if (selectedConcelhoIdForFreg === '1107') {
            allowedDicos.push('1116');
          } else if (selectedConcelhoIdForFreg === '0308') {
            allowedDicos.push('0314');
          } else if (selectedConcelhoIdForFreg === '1314') {
            allowedDicos.push('1318');
          }
        }
        freguesiaFeatures = geo.freguesias.features.filter(f => allowedDicos.includes(f.properties?.dicofre?.slice(0, 4)));
      } else {
        freguesiaFeatures = geo.freguesias.features.filter(f => f.properties?.circulo === STATE.currentCirculo);
      }
    }
  }
  STATE.freguesiasLayer?.setData(filterFeaturesForNuts(freguesiaFeatures, 'freguesia'));

  // --- 4. Contornos (Outlines) ---
  let distOutlineFeats = [];
  if (!CIRCULOS_SEM_GEOMETRIA.has(STATE.currentCirculo) && STATE.mapLevel !== 'distrito') {
    if (STATE.currentCirculo !== '30' && STATE.currentCirculo !== '40') {
      // Contorno do distrito selecionado (apenas para distritos do continente!)
      distOutlineFeats = geo.distritos.features.filter(f => f.properties?.circulo === STATE.currentCirculo);
    }
  }
  STATE.distritosOutlineLayer?.setData(filterFeaturesForNuts(distOutlineFeats, 'distrito'));

  let concOutlineFeats = [];
  if (STATE.mapLevel === 'freguesia') {
    if (selectedConcelhoIdForFreg) {
      concOutlineFeats = geo.concelhos.features.filter(f => f.properties?.dico === selectedConcelhoIdForFreg);
    } else {
      concOutlineFeats = geo.concelhos.features.filter(f => f.properties?.circulo === STATE.currentCirculo);
    }
  }
  STATE.concelhosOutlineLayer?.setData(filterFeaturesForNuts(concOutlineFeats, 'concelho'));
}

function applyFiltersAndRedraw() {
  if (STATE.distritosLayer) {
    STATE.distritosLayer.setExtrusionEnabled(STATE.extrusionEnabled && STATE.mapLevel === 'distrito');
    STATE.distritosLayer.refresh();
  }
  if (STATE.concelhosLayer) {
    STATE.concelhosLayer.setExtrusionEnabled(STATE.extrusionEnabled && STATE.mapLevel === 'concelho');
    STATE.concelhosLayer.refresh();
  }
  if (STATE.freguesiasLayer) {
    STATE.freguesiasLayer.setExtrusionEnabled(STATE.extrusionEnabled && STATE.mapLevel === 'freguesia');
    STATE.freguesiasLayer.refresh();
  }
  if (typeof renderResultsPanel === 'function') renderResultsPanel();
  updateClearSelectionButtonVisibility();
  if (typeof window.syncShortcutButtons === 'function') {
    window.syncShortcutButtons();
  }
  if (typeof renderSeatMarkers === 'function') {
    renderSeatMarkers();
  }
}

function refreshMapStylesAndTooltips() {
  applyFiltersAndRedraw();
}

// ---------- FOCO / ZOOM ----------

function focusCirculoOnMap(circulo, animate = true) {
  if (!STATE.geo || !circulo) return;
  if (circulo === 'E1') {
    const bounds = MLCompat.featureCollectionBounds(STATE.geo.estrangeiroEuropa?.features || []);
    if (bounds) MLCompat.fitMapToBounds(map, bounds, { padding: [40, 40], animate });
    return;
  }
  if (circulo === 'E2') {
    const bounds = MLCompat.featureCollectionBounds(STATE.geo.estrangeiroMundo?.features || []);
    if (bounds) MLCompat.fitMapToBounds(map, bounds, { padding: [40, 40], animate });
    return;
  }
  if (CIRCULOS_SEM_GEOMETRIA.has(circulo)) return;
  const feature = STATE.geo.distritos.features.find(f => f.properties?.circulo === circulo);
  if (!feature) return;
  const bounds = MLCompat.featureBounds(feature);
  if (bounds) MLCompat.fitMapToBounds(map, bounds, { padding: [40, 40], animate });
}

function focusNutsOnMap(nutsSelector = STATE.currentNuts, animate = true) {
  if (!STATE.geo || !nutsSelector) return;
  const level = STATE.mapLevel;
  let matchingFeatures = [];
  
  if (level === 'freguesia') {
    matchingFeatures = (STATE.geo.freguesias?.features || []).filter(f => {
      const dicofre = f.properties?.dicofre;
      if (!dicofre) return false;
      return window.isConcelhoInNuts && window.isConcelhoInNuts(dicofre.slice(0, 4), nutsSelector);
    });
  } else if (level === 'concelho') {
    matchingFeatures = (STATE.geo.concelhos?.features || []).filter(f => {
      const dico = f.properties?.dico;
      if (!dico) return false;
      return window.isConcelhoInNuts && window.isConcelhoInNuts(dico, nutsSelector);
    });
  } else if (level === 'distrito') {
    matchingFeatures = (STATE.geo.distritos?.features || []).filter(f => {
      const distCirc = f.properties?.circulo;
      if (!distCirc) return false;
      if (typeof NUTS_DATA !== 'undefined') {
        return Object.keys(NUTS_DATA).some(dicoKey => {
          if (dicoKey.slice(0, 2) !== distCirc) return false;
          return window.isConcelhoInNuts && window.isConcelhoInNuts(dicoKey, nutsSelector);
        });
      }
      return false;
    });
  }
  
  if (matchingFeatures.length > 0) {
    const bounds = MLCompat.featureCollectionBounds(matchingFeatures);
    if (bounds) {
      MLCompat.fitMapToBounds(map, bounds, { padding: [40, 40], animate });
    }
  }
}

function focusCountryOnMap(animate = false) {
  if (!STATE.geo) return;
  const level = STATE.mapLevel;
  const list = (level === 'freguesia') ? (STATE.geo.freguesias?.features || [])
             : (level === 'concelho' ? STATE.geo.concelhos.features
             : STATE.geo.distritos.features);
             
  const cont = list.filter(f => {
    const circ = f.properties?.circulo || (level === 'distrito' ? f.properties?.circulo : circuloFromDicofre(f.properties?.dico + '00'));
    return circ && circ <= '18';
  });
  
  const bounds = cont.length
    ? MLCompat.featureCollectionBounds(cont)
    : (level === 'freguesia' && STATE.freguesiasLayer ? STATE.freguesiasLayer.getBounds()
       : (level === 'concelho' && STATE.concelhosLayer ? STATE.concelhosLayer.getBounds()
       : STATE.distritosLayer?.getBounds()));
       
  if (bounds) MLCompat.fitMapToBounds(map, bounds, { padding: [24, 24], animate });
}

// ---------- SELEÇÃO POR ARRASTO (Shift+drag) ----------

function setupBoxSelection() {
  const mapContainer = map.getContainer();
  if (map.boxZoom) map.boxZoom.disable();

  selectionBoxElement = document.createElement('div');
  selectionBoxElement.classList.add('selection-box');
  mapContainer.appendChild(selectionBoxElement);

  mapContainer.addEventListener('mousedown', handleBoxSelectMouseDown);
  window.addEventListener('mousemove', handleBoxSelectMouseMove);
  window.addEventListener('mouseup', handleBoxSelectMouseUp);
}

function handleBoxSelectMouseDown(e) {
  if (!e.shiftKey || e.button !== 0) return;
  isSelectorsActive = true;
  if (map.dragPan) map.dragPan.disable();

  const rect = map.getContainer().getBoundingClientRect();
  startSelectionPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  updateSelectionBox(startSelectionPoint.x, startSelectionPoint.y, 0, 0);
  selectionBoxElement.style.display = 'block';
  e.preventDefault();
}

function handleBoxSelectMouseMove(e) {
  if (!isSelectorsActive) return;
  const rect = map.getContainer().getBoundingClientRect();
  const currentX = e.clientX - rect.left;
  const currentY = e.clientY - rect.top;
  updateSelectionBox(
    Math.min(startSelectionPoint.x, currentX),
    Math.min(startSelectionPoint.y, currentY),
    Math.abs(currentX - startSelectionPoint.x),
    Math.abs(currentY - startSelectionPoint.y)
  );
}

function handleBoxSelectMouseUp(e) {
  if (!isSelectorsActive) return;
  isSelectorsActive = false;
  selectionBoxElement.style.display = 'none';
  if (map.dragPan) map.dragPan.enable();

  const rect = map.getContainer().getBoundingClientRect();
  const endX = e.clientX - rect.left;
  const endY = e.clientY - rect.top;
  const dist = Math.hypot(endX - startSelectionPoint.x, endY - startSelectionPoint.y);
  if (dist < 5) return;

  const minX = Math.min(startSelectionPoint.x, endX);
  const maxX = Math.max(startSelectionPoint.x, endX);
  const minY = Math.min(startSelectionPoint.y, endY);
  const maxY = Math.max(startSelectionPoint.y, endY);
  selectFreguesiasInPixelBox([[minX, minY], [maxX, maxY]]);
}

function updateSelectionBox(x, y, w, h) {
  selectionBoxElement.style.left = x + 'px';
  selectionBoxElement.style.top = y + 'px';
  selectionBoxElement.style.width = w + 'px';
  selectionBoxElement.style.height = h + 'px';
}

function selectFreguesiasInPixelBox(pixelBox) {
  if (STATE.mapLevel !== 'freguesia') return;
  if (!map.getLayer('freguesias-fill')) return;
  let added = 0;
  const found = map.queryRenderedFeatures(pixelBox, { layers: ['freguesias-fill'] });
  found.forEach((feat) => {
    const dicofre = feat.properties?.dicofre;
    if (dicofre && !selectedLocationIDs.has(dicofre)) {
      selectedLocationIDs.add(dicofre);
      added++;
    }
  });
  if (added > 0) {
    isDragSelection = true;
    applyFiltersAndRedraw();
  }
}

// ---------- MODO PROPORCIONAL (SEAT DONUTS) ----------
let activeSeatMarkers = [];

const DISTRICT_ACRONYMS = {
  "01": "AVR", "02": "BJA", "03": "BRG", "04": "BGC",
  "05": "CBA", "06": "CBR", "07": "EVR", "08": "FAR",
  "09": "GRD", "10": "LRA", "11": "LIS", "12": "PTG",
  "13": "PRT", "14": "STR", "15": "STB", "16": "VCT",
  "17": "VRL", "18": "VIS", "30": "MAD", "40": "AZR"
};

function clearSeatMarkers() {
  activeSeatMarkers.forEach(m => m.remove());
  activeSeatMarkers = [];
}

function getFeatureCentroid(feature) {
  if (!feature || !feature.geometry) return null;
  let totalX = 0, totalY = 0, count = 0;
  function processCoords(coords) {
    if (Array.isArray(coords[0])) {
      coords.forEach(processCoords);
    } else {
      totalX += coords[0];
      totalY += coords[1];
      count++;
    }
  }
  processCoords(feature.geometry.coordinates);
  if (count > 0) {
    return [totalX / count, totalY / count];
  }
  return null;
}

function getSeatMarkerCoordinate(code, feature) {
  const manualCentroids = {
    "01": [-8.60, 40.64], // Aveiro
    "02": [-7.95, 38.01], // Beja
    "03": [-8.15, 41.56], // Braga
    "04": [-6.95, 41.45], // Bragança
    "05": [-7.75, 39.70], // Castelo Branco
    "06": [-8.41, 40.21], // Coimbra
    "07": [-7.91, 38.57], // Évora
    "08": [-7.93, 37.15], // Faro
    "09": [-7.27, 40.54], // Guarda
    "10": [-8.75, 39.74], // Leiria
    "11": [-9.15, 38.95], // Lisboa
    "12": [-7.43, 39.29], // Portalegre
    "13": [-8.35, 41.20], // Porto
    "14": [-8.48, 39.40], // Santarém
    "15": [-8.60, 38.20], // Setúbal
    "16": [-8.58, 41.70], // Viana do Castelo
    "17": [-7.65, 41.35], // Vila Real
    "18": [-7.90, 40.80], // Viseu
    "30": [-16.96, 32.72], // Madeira
    "40": [-27.22, 38.57], // Açores
  };
  if (manualCentroids[code]) {
    return manualCentroids[code];
  }
  return getFeatureCentroid(feature);
}

function getSectorPath(x, y, rIn, rOut, startAngle, endAngle) {
  const x1_out = (x + rOut * Math.cos(startAngle)).toFixed(3);
  const y1_out = (y + rOut * Math.sin(startAngle)).toFixed(3);
  const x2_out = (x + rOut * Math.cos(endAngle)).toFixed(3);
  const y2_out = (y + rOut * Math.sin(endAngle)).toFixed(3);
  
  const x1_in = (x + rIn * Math.cos(startAngle)).toFixed(3);
  const y1_in = (y + rIn * Math.sin(startAngle)).toFixed(3);
  const x2_in = (x + rIn * Math.cos(endAngle)).toFixed(3);
  const y2_in = (y + rIn * Math.sin(endAngle)).toFixed(3);
  
  return `M ${x1_out} ${y1_out} ` +
         `A ${rOut} ${rOut} 0 0 1 ${x2_out} ${y2_out} ` +
         `L ${x2_in} ${y2_in} ` +
         `A ${rIn} ${rIn} 0 0 0 ${x1_in} ${y1_in} ` +
         `Z`;
}

function createSeatDonutSVG(code, totalSeats, mandatos_p) {
  const sortedParties = Object.entries(mandatos_p)
    .filter(([party, seats]) => seats > 0)
    .sort((a, b) => b[1] - a[1]);
  
  const colors = [];
  sortedParties.forEach(([party, seats]) => {
    const color = getResolvedPartyColor(party) || '#999';
    for (let i = 0; i < seats; i++) {
      colors.push(color);
    }
  });

  const N = colors.length;
  if (N <= 0) return null;

  let rings = [];
  if (N <= 8) {
    rings = [ { rIn: 17.5, rOut: 25, count: N } ];
  } else if (N <= 19) {
    const r1 = Math.round(N * 0.4);
    rings = [
      { rIn: 17.5, rOut: 23, count: r1 },
      { rIn: 25.5, rOut: 31, count: N - r1 }
    ];
  } else if (N <= 40) {
    const r1 = Math.round(N * 0.22);
    const r2 = Math.round(N * 0.35);
    rings = [
      { rIn: 17.5, rOut: 23, count: r1 },
      { rIn: 25.5, rOut: 31, count: r2 },
      { rIn: 33.5, rOut: 39, count: N - r1 - r2 }
    ];
  } else {
    const r1 = Math.round(N * 0.15);
    const r2 = Math.round(N * 0.24);
    const r3 = Math.round(N * 0.28);
    rings = [
      { rIn: 17.5, rOut: 23, count: r1 },
      { rIn: 25.5, rOut: 31, count: r2 },
      { rIn: 33.5, rOut: 39, count: r3 },
      { rIn: 41.5, rOut: 47, count: N - r1 - r2 - r3 }
    ];
  }

  let svgContent = '';
  let colorIdx = 0;
  
  rings.forEach(ring => {
    const M = ring.count;
    const rIn = ring.rIn;
    const rOut = ring.rOut;
    const dTheta = (2 * Math.PI) / M;
    
    for (let j = 0; j < M; j++) {
      const color = colors[colorIdx++] || '#999';
      const startAngle = j * dTheta - Math.PI / 2;
      const endAngle = (j + 1) * dTheta - Math.PI / 2;
      
      const pathData = getSectorPath(55, 55, rIn, rOut, startAngle, endAngle);
      svgContent += `<path d="${pathData}" fill="${color}" stroke="#15151b" stroke-width="0.8" />`;
    }
  });

  const acronym = DISTRICT_ACRONYMS[code] || code;
  svgContent += `
    <circle cx="55" cy="55" r="15" fill="#15151b" stroke="rgba(255,255,255,0.2)" stroke-width="0.8" />
    <text x="55" y="52" text-anchor="middle" font-size="9.5px" font-family="sans-serif" font-weight="700" fill="#ffffff" dominant-baseline="middle">${acronym}</text>
    <text x="55" y="63" text-anchor="middle" font-size="8.5px" font-family="sans-serif" font-weight="600" fill="#9999aa" dominant-baseline="middle">${N}</text>
  `;

  const div = document.createElement('div');
  div.className = 'seat-donut-marker';
  div.style.width = '110px';
  div.style.height = '110px';
  div.style.cursor = 'pointer';
  div.innerHTML = `
    <svg width="110" height="110" viewBox="0 0 110 110" xmlns="http://www.w3.org/2000/svg">
      ${svgContent}
    </svg>
  `;

  div.addEventListener('click', (e) => {
    e.stopPropagation();
    window.navigateToDistrito(code, { focus: true });
  });

  return div;
}

function renderSeatMarkers() {
  clearSeatMarkers();
  if (!STATE.showSeatDonuts) return;
  if (STATE.currentElectionType !== 'ar') return;
  if (STATE.mapLevel !== 'distrito' && STATE.scope.level !== 'national') return;
  if (!STATE.geo || !STATE.geo.distritos) return;
  
  STATE.geo.distritos.features.forEach(feature => {
    const code = feature.properties?.circulo;
    if (!code) return;
    if (code === 'E1' || code === 'E2') return;
    
    const coord = getSeatMarkerCoordinate(code, feature);
    if (!coord) return;
    
    const votesEntry = STATE.data?.AGG?.distrito?.[code];
    if (!votesEntry) return;
    
    const mandatos_p = votesEntry.mandatos_p || {};
    const totalMandatos = votesEntry.mandatos || 0;
    if (totalMandatos <= 0) return;
    
    const el = createSeatDonutSVG(code, totalMandatos, mandatos_p);
    if (!el) return;
    
    const marker = new maplibregl.Marker({ element: el })
      .setLngLat(coord)
      .addTo(map);
      
    activeSeatMarkers.push(marker);
  });
}

// Exports globais
window.applyFiltersAndRedraw = applyFiltersAndRedraw;
window.refreshMapStylesAndTooltips = refreshMapStylesAndTooltips;
window.clearSelection = clearSelection;
window.updateClearSelectionButtonVisibility = updateClearSelectionButtonVisibility;

window.navigateToNational = navigateToNational;
window.navigateToDistrito = navigateToDistrito;
window.navigateToConcelho = navigateToConcelho;
window.navigateToFreguesia = navigateToFreguesia;
window.focusCountryOnMap = focusCountryOnMap;
window.focusCirculoOnMap = focusCirculoOnMap;
window.focusNutsOnMap = focusNutsOnMap;
window.syncMapLevel = syncMapLevel;
window.syncMapLevelChips = syncMapLevelChips;
window.renderSeatMarkers = renderSeatMarkers;
window.clearSeatMarkers = clearSeatMarkers;
