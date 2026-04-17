const fs = require('fs');

// Patch js/ui-controls.js
let controls = fs.readFileSync('js/ui-controls.js', 'utf8');

// Find the btnClearSelection listener and update its behavior
// We'll target the clearSelection(true) calls inside btnClearSelection handler
const clearSelectionCall = 'clearSelection(true);';
const secureClearSelection = `if (dom.inputBairro) { 
          dom.inputBairro.disabled = true; 
          dom.inputBairro.value = 'all'; 
        }
        clearSelection(true);`;

// Only replace inside the btnClearSelection block to be safe
const btnClearRegex = /if \(dom.btnClearSelection\) \{[\s\S]*?\n  \}/;
controls = controls.replace(btnClearRegex, (match) => {
    return match.replace(/clearSelection\(true\);/g, secureClearSelection);
});

fs.writeFileSync('js/ui-controls.js', controls, 'utf8');
console.log('Patched js/ui-controls.js');

// Also update js/map-render.js clearSelection to be absolute
let mapRender = fs.readFileSync('js/map-render.js', 'utf8');
const clearSelectionStart = 'function clearSelection(updateMap = true) {';
const clearSelectionFix = `function clearSelection(updateMap = true) {
  if (dom.inputBairro && STATE.currentElectionType === 'geral' && currentCidadeFilter === 'all') {
    dom.inputBairro.disabled = true;
    dom.inputBairro.value = 'all';
  }
`;
mapRender = mapRender.replace(clearSelectionStart, clearSelectionFix);
fs.writeFileSync('js/map-render.js', mapRender, 'utf8');
console.log('Patched js/map-render.js');
