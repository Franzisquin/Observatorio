const fs = require('fs');
const path = require('path');

const projectRoot = 'c:/Users/lixov/OneDrive/Documentos/Observatorio';

function patchFile(relPath, fn) {
    const fullPath = path.join(projectRoot, relPath);
    let content = fs.readFileSync(fullPath, 'utf8');
    content = fn(content);
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`Patched: ${relPath}`);
}

// 1. data-process.js
patchFile('js/data-process.js', content => {
    // Replace populateBairroDropdown
    const startMarker = 'function populateBairroDropdown() {';
    const startIndex = content.indexOf(startMarker);
    if (startIndex === -1) return content;
    
    // Find matching closing brace for function (approximate or just replace the known block)
    // We know it ends with bairroCombobox.disable(items.length === 0);\n}
    const endMarker = /bairroCombobox\.disable\(items\.length === 0\);\s*}/;
    const newFunc = `function populateBairroDropdown() {
  const select = dom.inputBairro;
  if (!select) return;
  uniqueBairros.clear();

  if (STATE.currentElectionType === 'geral' && currentCidadeFilter === 'all') {
    select.disabled = true;
    select.value = 'all';
    return;
  }

  const geojson = currentDataCollection[currentCargo];
  if (!geojson || !geojson.features) return;

  const bairroGroups = {};
  geojson.features.forEach(f => {
    const props = f.properties;
    if (matchesRegionalScope(props)) {
       const bairro = (getProp(props, 'ds_bairro') || 'Bairro não inf.').trim();
       if (bairro && bairro.toUpperCase() !== 'N/D') {
         uniqueBairros.add(bairro);
         if (!bairroGroups[bairro]) bairroGroups[bairro] = [];
         bairroGroups[bairro].push(props);
       }
    }
  });

  const bairros = Array.from(uniqueBairros).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  
  select.innerHTML = '<option value="all">Todos os bairros</option>';
  bairros.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b;
    opt.textContent = b;
    select.appendChild(opt);
  });

  select.disabled = (bairros.length === 0);
  select.value = currentBairroFilter || 'all';
}`;
    return content.replace(/function populateBairroDropdown\(\) \{[\s\S]*?bairroCombobox\.disable\(items\.length === 0\);\s*\}/, newFunc);
});

// 2. ui-controls.js
patchFile('js/ui-controls.js', content => {
    // Remove cidadeCombobox/bairroCombobox setup
    content = content.replace(/cidadeCombobox = createCombobox\([\s\S]*?\}\);/g, '');
    content = content.replace(/bairroCombobox = createCombobox\([\s\S]*?\}\);/g, '');
    
    // Remove calls to .setValue
    content = content.replace(/if \(cidadeCombobox\) cidadeCombobox\.setValue\([\s\S]*?\);/g, '');
    content = content.replace(/if \(bairroCombobox\) bairroCombobox\.setValue\([\s\S]*?\);/g, '');
    
    // Add neighborhood select listener
    const insertPoint = '// Removed old calls for Cidade/Bairro';
    const listener = `
  if (dom.inputBairro) {
    dom.inputBairro.addEventListener('change', (e) => {
      currentBairroFilter = e.target.value;
      clearSelection(false);
      markFiltersDirty();
      updateApplyButtonText();
      if (typeof applyFiltersAndRedraw === 'function') applyFiltersAndRedraw();
    });
  }
  ${insertPoint}`;
    content = content.replace(insertPoint, listener);
    
    return content;
});

// 3. ui-helpers.js
patchFile('js/ui-helpers.js', content => {
    // Clean up DOM refs
    content = content.replace(/dom\.listCidade = [\s\S]*?;/g, '');
    content = content.replace(/dom\.boxCidade = [\s\S]*?;/g, '');
    content = content.replace(/dom\.listBairro = [\s\S]*?;/g, '');
    content = content.replace(/dom\.boxBairro = [\s\S]*?;/g, '');
    return content;
});
