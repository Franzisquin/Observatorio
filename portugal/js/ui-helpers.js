// ============================================================================
// ui-helpers.js — bootstrap da app, mapa, dropdowns custom e navegação móvel
// ============================================================================

function debounce(func, timeout = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { func.apply(this, args); }, timeout);
  };
}

function toTitleCase(str) {
  if (!str) return '';
  const exceptions = ['de', 'da', 'do', 'dos', 'das', 'e', 'em', 'com', 'na', 'no', 'nas', 'nos', 'por', 'para', 'a', 'o', 'as', 'os'];
  return String(str).split(' ').map((word, i) => {
    const lower = word.toLowerCase();
    if (i > 0 && exceptions.includes(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(' ');
}

// ====== INIT ======
window.addEventListener('DOMContentLoaded', init);

async function init() {
  document.body.dataset.theme = 'dark';

  dom.mapLoader = document.getElementById('mapLoader');
  dom.themeToggle = document.getElementById('themeToggle');

  dom.selectYear = document.getElementById('selectYear');
  dom.selectCirculo = document.getElementById('selectCirculo');
  dom.selectNuts = document.getElementById('selectNuts');
  dom.selectElectionType = document.getElementById('selectElectionType');

  dom.vizBox = document.getElementById('vizBox');
  dom.vizCandidatoBox = document.getElementById('vizCandidatoBox');
  dom.selectVizCandidato = document.getElementById('selectVizCandidato');
  dom.vizModeChips = document.getElementById('vizModeChips');
  dom.vizGradientModeChips = document.getElementById('vizGradientModeChips');
  dom.vizGradientModeCtrl = document.getElementById('vizGradientModeCtrl');
  dom.mapLevelChips = document.getElementById('mapLevelChips');
  dom.auSubtypeChips = document.getElementById('auSubtypeChips');

  dom.resultsBox = document.getElementById('resultsBox');
  dom.resultsTitle = document.getElementById('resultsTitle');
  dom.resultsSubtitle = document.getElementById('resultsSubtitle');
  dom.resultsContent = document.getElementById('resultsContent');
  dom.resultsMetrics = document.getElementById('resultsMetrics');
  dom.btnClearSelection = document.getElementById('btnClearSelection');

  dom.themeToggle?.addEventListener('click', () => {
    const isDark = document.body.dataset.theme === 'dark';
    document.body.dataset.theme = isDark ? 'light' : 'dark';

    const sunSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="theme-icon"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path></svg>`;
    const moonSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="theme-icon"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></svg>`;
    dom.themeToggle.innerHTML = isDark ? sunSvg : moonSvg;

    const newTheme = document.body.dataset.theme === 'light' ? 'light' : 'dark';
    MLCompat.setBasemapTheme(map, newTheme);
  });


  map = new maplibregl.Map({
    container: 'map',
    style: MLCompat.buildBasemapStyle(document.body.dataset.theme === 'light' ? 'light' : 'dark'),
    center: MAP_DEFAULT_CENTER,
    zoom: MAP_DEFAULT_ZOOM,
    minZoom: 4.5,
    dragRotate: false,
    pitchWithRotate: false
  });
  window.map = map;
  MLCompat.augmentMap(map);
  MLCompat.refreshThemeColors();

  // Mantém o canvas do mapa colado ao tamanho do contentor (mobile/desktop)
  if (typeof ResizeObserver !== 'undefined') {
    const mapContainer = document.getElementById('map');
    if (mapContainer) {
      new ResizeObserver(() => {
        requestAnimationFrame(() => map.resize());
      }).observe(mapContainer);
    }
  }
  if (map.touchZoomRotate) map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right');

  // Sincroniza o botão do Modo 3D com o pitch da câmara
  map.on('pitch', () => {
    const currentPitch = map.getPitch();
    const btn3D = document.getElementById('btnToggle3D');
    if (currentPitch > 10) {
      if (btn3D && !btn3D.classList.contains('active')) {
        btn3D.classList.add('active');
        document.body.classList.add('mode-3d');
        map.dragRotate.enable();
        if (map.touchZoomRotate) map.touchZoomRotate.enableRotation();
      }
    } else {
      if (btn3D && btn3D.classList.contains('active')) {
        btn3D.classList.remove('active');
        document.body.classList.remove('mode-3d');
        map.dragRotate.disable();
        if (map.touchZoomRotate) map.touchZoomRotate.disableRotation();
      }
    }
    syncExtrusionButtonVisibility();
  });

  function syncExtrusionButtonVisibility() {
    const btnExtrusion = document.getElementById('btnToggleExtrusion');
    if (!btnExtrusion || !map) return;
    btnExtrusion.classList.toggle('visible-inline', map.getPitch() > 10);
  }
  window.syncExtrusionButtonVisibility = syncExtrusionButtonVisibility;

  try {
    setupControls();
  } catch (e) {
    console.error('Erro em setupControls:', e);
  }

  setupBoxSelection();
  initCustomDropdowns();
  setupMobileSheets();

  // Carrega automaticamente o ano mais recente disponível
  bootstrapData();
}

// ====== CUSTOM SELECT COMPONENT ======
function initCustomDropdowns() {
  const selects = document.querySelectorAll('select.select');
  selects.forEach(enhanceSelectElement);

  const bodyObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.tagName === 'SELECT' && node.classList.contains('select')) {
            enhanceSelectElement(node);
          }
          node.querySelectorAll('select.select').forEach(enhanceSelectElement);
        }
      });
    });
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });
}

function enhanceSelectElement(select) {
  if (select.dataset.enhanced === 'true' || select.closest('.custom-select-wrapper')) return;
  select.dataset.enhanced = 'true';

  const wrapper = document.createElement('div');
  wrapper.className = 'custom-select-wrapper';
  select.parentNode.insertBefore(wrapper, select);
  wrapper.appendChild(select);

  select.classList.add('hidden-select');
  select.tabIndex = -1;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'custom-select-trigger';
  if (select.disabled) trigger.classList.add('disabled');

  const triggerText = document.createElement('span');
  triggerText.className = 'custom-select-trigger-text';
  trigger.appendChild(triggerText);

  const arrowSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  arrowSvg.setAttribute('class', 'custom-select-arrow');
  arrowSvg.setAttribute('viewBox', '0 0 24 24');
  arrowSvg.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';
  trigger.appendChild(arrowSvg);

  wrapper.appendChild(trigger);

  const dropdown = document.createElement('div');
  dropdown.className = 'custom-select-dropdown';
  wrapper.appendChild(dropdown);

  const rebuildOptions = () => {
    dropdown.innerHTML = '';
    const options = Array.from(select.options);

    const safeNorm = (typeof norm === 'function') ? norm : (s => (s || "").normalize('NFD').replace(/[̀-ͯ]/g, "").replace(/'/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase());

    let searchInput = null;
    if (options.length > 5) {
      const searchContainer = document.createElement('div');
      searchContainer.className = 'custom-select-search-container';

      searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.className = 'custom-select-search';
      searchInput.placeholder = 'Procurar...';
      searchInput.autocomplete = 'off';

      searchContainer.addEventListener('click', (e) => e.stopPropagation());

      searchInput.addEventListener('input', () => {
        const query = safeNorm(searchInput.value);
        const optionDivs = dropdown.querySelectorAll('.custom-select-option');

        let firstMatch = null;
        optionDivs.forEach(div => {
          const text = safeNorm(div.textContent);
          if (text.includes(query)) {
            div.style.display = '';
            if (!firstMatch && !div.classList.contains('disabled')) {
              firstMatch = div;
            }
          } else {
            div.style.display = 'none';
          }
        });

        optionDivs.forEach(div => div.classList.remove('highlighted'));
        if (query && firstMatch) {
          firstMatch.classList.add('highlighted');
          firstMatch.scrollIntoView({ block: 'nearest' });
        }
      });

      searchInput.addEventListener('keydown', (e) => {
        const optionDivs = Array.from(dropdown.querySelectorAll('.custom-select-option')).filter(div => div.style.display !== 'none' && !div.classList.contains('disabled'));
        const currentHighlightIdx = optionDivs.findIndex(div => div.classList.contains('highlighted'));

        if (e.key === 'Enter') {
          e.preventDefault();
          const highlighted = dropdown.querySelector('.custom-select-option.highlighted');
          if (highlighted) {
            highlighted.click();
          } else if (optionDivs.length > 0) {
            optionDivs[0].click();
          }
        } else if (e.key === 'Escape') {
          closeAllDropdowns();
          trigger.focus();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (optionDivs.length > 0) {
            let nextIdx = currentHighlightIdx + 1;
            if (nextIdx >= optionDivs.length) nextIdx = 0;
            optionDivs.forEach(div => div.classList.remove('highlighted'));
            optionDivs[nextIdx].classList.add('highlighted');
            optionDivs[nextIdx].scrollIntoView({ block: 'nearest' });
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (optionDivs.length > 0) {
            let prevIdx = currentHighlightIdx - 1;
            if (prevIdx < 0) prevIdx = optionDivs.length - 1;
            optionDivs.forEach(div => div.classList.remove('highlighted'));
            optionDivs[prevIdx].classList.add('highlighted');
            optionDivs[prevIdx].scrollIntoView({ block: 'nearest' });
          }
        }
      });

      searchContainer.appendChild(searchInput);
      dropdown.appendChild(searchContainer);
    }

    options.forEach((opt, idx) => {
      const customOpt = document.createElement('div');
      customOpt.className = 'custom-select-option';
      customOpt.textContent = opt.textContent;
      customOpt.dataset.value = opt.value;
      customOpt.dataset.index = idx;

      if (opt.disabled) customOpt.classList.add('disabled');
      if (opt.selected) {
        customOpt.classList.add('selected');
        triggerText.textContent = opt.textContent;
      }

      customOpt.addEventListener('click', (e) => {
        e.stopPropagation();
        if (opt.disabled) return;
        select.value = opt.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        closeAllDropdowns();
      });

      dropdown.appendChild(customOpt);
    });

    if (options.length === 0 || (options.length === 1 && options[0].disabled && options[0].value === '')) {
      triggerText.textContent = select.placeholder || 'Selecionar...';
    }
  };

  const syncActiveText = () => {
    const selectedOpt = select.options[select.selectedIndex];
    if (selectedOpt) {
      triggerText.textContent = selectedOpt.textContent;
      dropdown.querySelectorAll('.custom-select-option').forEach(opt => {
        const isSelected = parseInt(opt.dataset.index) === select.selectedIndex;
        opt.classList.toggle('selected', isSelected);
        if (isSelected) opt.classList.remove('highlighted');
      });
    } else {
      triggerText.textContent = select.placeholder || 'Selecionar...';
    }
    trigger.classList.toggle('disabled', select.disabled);
  };

  rebuildOptions();

  const originalValueProp = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(select, 'value', {
    configurable: true,
    get: function () {
      return originalValueProp.get.call(this);
    },
    set: function (val) {
      originalValueProp.set.call(this, val);
      syncActiveText();
    }
  });

  const originalIndexProp = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
  Object.defineProperty(select, 'selectedIndex', {
    configurable: true,
    get: function () {
      return originalIndexProp.get.call(this);
    },
    set: function (idx) {
      originalIndexProp.set.call(this, idx);
      syncActiveText();
    }
  });

  const observer = new MutationObserver((mutations) => {
    let shouldRebuild = false;
    mutations.forEach(m => {
      if (m.type === 'childList') {
        shouldRebuild = true;
      } else if (m.type === 'attributes') {
        if (m.attributeName === 'disabled') {
          trigger.classList.toggle('disabled', select.disabled);
        } else if (m.attributeName === 'value' || m.attributeName === 'selected') {
          syncActiveText();
        }
      }
    });
    if (shouldRebuild) rebuildOptions();
  });
  observer.observe(select, { childList: true, attributes: true, subtree: true, attributeFilter: ['disabled', 'value', 'selected'] });

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (select.disabled) return;

    const isOpen = dropdown.classList.contains('open');
    closeAllDropdowns();

    if (!isOpen) {
      trigger.classList.add('active');
      dropdown.classList.add('open');

      const searchInput = dropdown.querySelector('.custom-select-search');
      if (searchInput) {
        searchInput.value = '';
        const optionDivs = dropdown.querySelectorAll('.custom-select-option');
        optionDivs.forEach(div => {
          div.style.display = '';
          div.classList.remove('highlighted');
        });
        setTimeout(() => searchInput.focus(), 50);
      }
    }
  });

  trigger.addEventListener('keydown', (e) => {
    if (select.disabled) return;

    const safeNorm = (typeof norm === 'function') ? norm : (s => (s || "").normalize('NFD').replace(/[̀-ͯ]/g, "").replace(/'/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase());
    const isOpen = dropdown.classList.contains('open');

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!isOpen) {
        trigger.click();
      } else {
        const sInput = dropdown.querySelector('.custom-select-search');
        if (sInput) {
          sInput.focus();
        } else {
          const optionDivs = Array.from(dropdown.querySelectorAll('.custom-select-option')).filter(div => !div.classList.contains('disabled'));
          const currentHighlightIdx = optionDivs.findIndex(div => div.classList.contains('highlighted') || div.classList.contains('selected'));

          if (e.key === 'ArrowDown') {
            let nextIdx = currentHighlightIdx + 1;
            if (nextIdx >= optionDivs.length) nextIdx = 0;
            optionDivs.forEach(div => div.classList.remove('highlighted'));
            optionDivs[nextIdx].classList.add('highlighted');
            optionDivs[nextIdx].scrollIntoView({ block: 'nearest' });
          } else if (e.key === 'ArrowUp') {
            let prevIdx = currentHighlightIdx - 1;
            if (prevIdx < 0) prevIdx = optionDivs.length - 1;
            optionDivs.forEach(div => div.classList.remove('highlighted'));
            optionDivs[prevIdx].classList.add('highlighted');
            optionDivs[prevIdx].scrollIntoView({ block: 'nearest' });
          } else if (e.key === 'Enter' || e.key === ' ') {
            const highlighted = dropdown.querySelector('.custom-select-option.highlighted');
            if (highlighted) highlighted.click();
          }
        }
      }
    } else if (e.key === 'Escape') {
      if (isOpen) {
        closeAllDropdowns();
        trigger.focus();
      }
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const sInput = dropdown.querySelector('.custom-select-search');
      if (sInput) {
        e.preventDefault();
        if (!isOpen) {
          trigger.classList.add('active');
          dropdown.classList.add('open');
        }
        sInput.value = e.key;
        sInput.dispatchEvent(new Event('input'));
        setTimeout(() => sInput.focus(), 50);
      } else {
        const char = safeNorm(e.key);
        const optionDivs = Array.from(dropdown.querySelectorAll('.custom-select-option')).filter(div => !div.classList.contains('disabled'));
        const match = optionDivs.find(div => safeNorm(div.textContent).startsWith(char));
        if (match) {
          e.preventDefault();
          if (!isOpen) {
            match.click();
          } else {
            optionDivs.forEach(div => div.classList.remove('highlighted'));
            match.classList.add('highlighted');
            match.scrollIntoView({ block: 'nearest' });
          }
        }
      }
    }
  });

  wrapper.addEventListener('focusout', (e) => {
    if (e.relatedTarget && !wrapper.contains(e.relatedTarget)) {
      closeAllDropdowns();
    }
  });
}

function closeAllDropdowns() {
  document.querySelectorAll('.custom-select-trigger').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.custom-select-dropdown').forEach(el => el.classList.remove('open'));
}

document.addEventListener('click', () => {
  closeAllDropdowns();
});

// ====== MOBILE: SHEETS DE RESULTADOS E FILTROS ======
const mobileMedia = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(max-width: 768px)')
  : null;

function isMobileLayout() {
  return !!(mobileMedia && mobileMedia.matches);
}

const SHEET_STATES = ['sheet-peek', 'sheet-half', 'sheet-full'];

function setResultsSheetState(state) {
  const sheet = document.querySelector('.panel.side-right');
  if (!sheet) return;
  sheet.classList.remove('sheet-dragging', ...SHEET_STATES);
  sheet.style.transform = '';
  sheet.classList.add(`sheet-${state}`);
  sheet.dataset.sheetState = state;
}

function getResultsSheetState() {
  return document.querySelector('.panel.side-right')?.dataset.sheetState || 'peek';
}

function openMobileFilters(open) {
  document.querySelector('.panel.side-left')?.classList.toggle('open', open);
  document.getElementById('mBackdrop')?.classList.toggle('show', open);
}

function setupMobileSheets() {
  const sheet = document.querySelector('.panel.side-right');
  const handle = document.getElementById('sheetHandle');
  if (!sheet || !handle) return;

  setResultsSheetState('peek');

  // Arrasto do sheet de resultados pela alça
  let dragStartY = 0;
  let dragStartOffset = 0;
  let dragging = false;

  const offsets = () => {
    const h = sheet.offsetHeight || 1;
    return { peek: h - 112, half: h * 0.46, full: 0 };
  };

  handle.addEventListener('pointerdown', (e) => {
    if (!isMobileLayout()) return;
    dragging = true;
    dragStartY = e.clientY;
    dragStartOffset = offsets()[getResultsSheetState()] ?? offsets().peek;
    sheet.classList.add('sheet-dragging');
    handle.setPointerCapture(e.pointerId);
  });

  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const o = offsets();
    const next = Math.min(o.peek, Math.max(0, dragStartOffset + (e.clientY - dragStartY)));
    sheet.style.transform = `translateY(${next}px)`;
  });

  handle.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    const moved = e.clientY - dragStartY;
    if (Math.abs(moved) < 6) {
      // Tap: alterna peek <-> half
      setResultsSheetState(getResultsSheetState() === 'peek' ? 'half' : 'peek');
      return;
    }
    const o = offsets();
    const current = dragStartOffset + moved;
    let best = 'peek';
    let bestDist = Infinity;
    for (const [name, off] of Object.entries(o)) {
      const d = Math.abs(current - off);
      if (d < bestDist) { bestDist = d; best = name; }
    }
    setResultsSheetState(best);
  });

  handle.addEventListener('pointercancel', () => {
    if (!dragging) return;
    dragging = false;
    setResultsSheetState(getResultsSheetState());
  });

  // Sheet de filtros
  document.getElementById('mFilterBtn')?.addEventListener('click', () => openMobileFilters(true));
  document.getElementById('mFilterSummary')?.addEventListener('click', () => openMobileFilters(true));
  document.getElementById('mFilterClose')?.addEventListener('click', () => openMobileFilters(false));
  document.getElementById('mBackdrop')?.addEventListener('click', () => openMobileFilters(false));

  // Ao sair do mobile, limpar estados para o desktop
  mobileMedia?.addEventListener?.('change', (ev) => {
    if (!ev.matches) {
      sheet.classList.remove('sheet-dragging', ...SHEET_STATES);
      sheet.style.transform = '';
      openMobileFilters(false);
    } else {
      setResultsSheetState('peek');
    }
  });
}

// Resumo da barra compacta + título do sheet (chamado a cada render dos resultados)
function updateMobileFilterSummary() {
  const summaryEl = document.getElementById('mFilterSummary');
  const titleEl = document.getElementById('sheetTitle');
  if (!summaryEl && !titleEl) return;
  try {
    const elLabel = STATE.currentElectionType === 'pr' ? 'Presidente da República'
      : STATE.currentElectionType === 'ee' ? 'Parlamento Europeu'
      : STATE.currentElectionType === 'au' ? (
          STATE.auSubtype === 'cm' ? 'Autárquicas · Câmara'
          : STATE.auSubtype === 'am' ? 'Autárquicas · Assembleia M.'
          : 'Autárquicas · Freguesia'
        )
      : 'Assembleia da República';
    if (summaryEl) summaryEl.textContent = `${elLabel} · ${STATE.currentYear || ''}`;
    if (titleEl) {
      const scope = STATE.scope || {};
      let name = 'Portugal';
      if (scope.level === 'distrito') name = (typeof CIRCULOS !== 'undefined' && CIRCULOS.get(scope.key)) || scope.key;
      else if (scope.level === 'concelho') name = scope.nome || scope.key;
      else if (scope.level === 'freguesia') name = STATE.data?.NAMES?.[scope.key] || scope.key;
      titleEl.textContent = `Resultados — ${name}`;
    }
  } catch (_) { /* estado ainda não pronto */ }
}

if (typeof window !== 'undefined') {
  window.updateMobileFilterSummary = updateMobileFilterSummary;
}

if (typeof window !== 'undefined') {
  window.toTitleCase = toTitleCase;
}
