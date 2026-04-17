const fs = require('fs');

let content = fs.readFileSync('js/map-render.js', 'utf8');

// 1. Update shouldRenderGeneralMunicipalityOverview
const oldShouldRender = /function shouldRenderGeneralMunicipalityOverview\(\) \{[\s\S]*?return true;\n\}/;
const newShouldRender = `function shouldRenderGeneralMunicipalityOverview() {
  const uf = String(dom.selectUFGeneral?.value || '').toUpperCase();
  if (STATE.currentElectionType !== 'geral') return false;
  if (!uf || uf === 'BR') return false;
  if (STATE.currentMapMode === 'locais' && currentCidadeFilter === 'all') return false;
  if (currentBairroFilter !== 'all') return false;
  if (currentLocalFilter.trim().length > 2) return false;
  return true;
}`;
content = content.replace(oldShouldRender, newShouldRender);

// 2. Add fitBounds to click handler and capturing state bounds
const oldClick = /click: \(\) => \{[\s\S]*?applyFiltersAndRedraw\(\);\n\s+\}/;
const newClick = `click: () => {
            const nome = getMunicipalityFeatureName(feature.properties);
            const matchedCity = Array.from(uniqueCidades || []).find((candidate) => matchesMunicipioName(nome, candidate)) || nome;
            
            // Auto-frame city on click
            if (layer.getBounds) {
              map.fitBounds(layer.getBounds(), { padding: [40, 40], maxZoom: 13 });
            }

            currentCidadeFilter = matchedCity;
            currentBairroFilter = 'all';
            currentLocalFilter = '';
            STATE.currentMapMode = 'locais';
            if (cidadeCombobox) cidadeCombobox.setValue(matchedCity);
            if (bairroCombobox) bairroCombobox.setValue('');
            if (dom.searchLocal) dom.searchLocal.value = '';
            populateBairroDropdown();
            updateApplyButtonText();
            applyFiltersAndRedraw();
          }`;
content = content.replace(oldClick, newClick);

// 3. Save state bounds when loading
const oldBoundsFit = /const bounds = STATE.municipiosLayer.getBounds\?\.\(\);\n\s+if \(bounds\?\.isValid\?\.(\(\)\)) \{[\s\S]*?map.fitBounds\(bounds, \{ padding: \[20, 20\] \}\);\n\s+\}/;
const newBoundsFit = `const bounds = STATE.municipiosLayer.getBounds?.();
    if (bounds?.isValid?.()) {
      STATE.currentStateBounds = bounds; // Save state bounds for reset
      map.fitBounds(bounds, { padding: [20, 20] });
    }`;
content = content.replace(oldBoundsFit, newBoundsFit);

// 4. Update clearSelection for auto-zoom out
const oldClearSelection = /function clearSelection\(updateMap = true\) \{([\s\S]*?)updateNeighborhoodProfileUI\(\);\n\}/;
const newClearSelection = `function clearSelection(updateMap = true) {
$1
  // Auto-Zoom out to statewide when clearing Geral selection
  if (updateMap && STATE.currentElectionType === 'geral' && STATE.currentStateBounds) {
    map.fitBounds(STATE.currentStateBounds, { padding: [20, 20] });
  }

  updateNeighborhoodProfileUI();
}`;
content = content.replace(oldClearSelection, newClearSelection);

fs.writeFileSync('js/map-render.js', content, 'utf8');
console.log('Successfully patched js/map-render.js');
