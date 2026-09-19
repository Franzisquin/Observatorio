// ============================================================================
// block-definer-pt.js — Custom Coalition / Block Definer for AR and Europeias (ee)
// ============================================================================

// Initialize from localStorage cache if present
try {
  const modifiedFlag = localStorage.getItem('observatorio_custom_blocks_modified');
  if (modifiedFlag === 'true') {
    const saved = localStorage.getItem('observatorio_custom_blocks');
    STATE.customBlocks = saved ? JSON.parse(saved) : [];
  } else {
    // Default to empty (no blocks) if null or false
    STATE.customBlocks = [];
  }
} catch (e) {
  console.error("Error loading custom blocks cache", e);
  STATE.customBlocks = [];
}

let modalCustomBlocksBackup = null;

function openBlockDefinerModal() {
  if (!STATE.originalData) {
    STATE.originalData = JSON.parse(JSON.stringify(STATE.data));
  }
  
  // Backup blocks in case they close/cancel without applying
  modalCustomBlocksBackup = JSON.parse(JSON.stringify(STATE.customBlocks));
  document.getElementById('blockDefinerOverlay')?.classList.add('visible');
  renderBlockDefinerList();
}

function closeBlockDefinerModal(e) {
  if (e && e.target !== e.currentTarget && !e.target.classList.contains('info-close')) {
    return;
  }
  // Restore from backup
  if (modalCustomBlocksBackup !== null) {
    STATE.customBlocks = modalCustomBlocksBackup;
    modalCustomBlocksBackup = null;
  }
  document.getElementById('blockDefinerOverlay')?.classList.remove('visible');
}

function renderBlockDefinerList() {
  const container = document.getElementById('blockDefinerList');
  if (!container) return;

  if (STATE.customBlocks.length === 0) {
    container.innerHTML = `
      <div style="color: var(--muted); text-align: center; padding: 25px; border: 1px dashed var(--border-color); border-radius: var(--radius-lg); font-size: 0.95rem;">
        Nenhum bloco personalizado criado. Clique em "+ Novo Bloco" para começar!
      </div>
    `;
    return;
  }

  // Get original parties to display in the checkbox list
  const originalParties = Object.keys(STATE.originalData?.METADATA?.parties || {})
    .sort((a, b) => {
      const votes = STATE.originalData?.METADATA?.national?.votes || {};
      return (votes[b] || 0) - (votes[a] || 0);
    });

  let html = '';
  STATE.customBlocks.forEach((block, idx) => {
    // Generate checkboxes for each party
    let partiesHtml = '';
    originalParties.forEach(p => {
      const checked = block.parties.includes(p) ? 'checked' : '';
      let disabled = '';
      const otherBlock = STATE.customBlocks.find((b, bIdx) => bIdx !== idx && b.parties.includes(p));
      if (otherBlock) {
        disabled = 'disabled title="Já selecionado no bloco ' + otherBlock.name + '"';
      }

      partiesHtml += `
        <label class="party-checkbox-pill" style="margin-right: 6px; margin-bottom: 6px; display: inline-flex; align-items: center; background: rgba(255,255,255,0.05); padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border-color); font-size: 0.82rem; cursor: ${disabled ? 'not-allowed' : 'pointer'}; opacity: ${disabled ? '0.4' : '1'}; transition: background 0.15s;">
          <input type="checkbox" ${checked} ${disabled} onchange="togglePartyInBlock(${idx}, '${p}', this.checked)" style="margin-right: 6px; cursor: inherit;" />
          ${p}
        </label>
      `;
    });

    html += `
      <div class="block-card" style="border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 14px; margin-bottom: 12px; background: rgba(255,255,255,0.02); transition: border-color 0.2s;">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap;">
          <input type="text" value="${block.name || ''}" class="select" style="max-width: 220px; height: 32px; padding: 4px 8px; display: inline-block; font-size: 0.9rem;" placeholder="Nome do Bloco (ex: Esquerda)" onchange="updateBlockName(${idx}, this.value)" />
          <input type="color" value="${block.color || '#ff007f'}" onchange="updateBlockColor(${idx}, this.value)" style="width: 40px; height: 32px; border: 1px solid var(--border-color); background: none; cursor: pointer; border-radius: 4px; padding: 0;" title="Cor do Bloco" />
          
          <button onclick="deleteCustomBlock(${idx})" class="btn-toggle-inaptos" style="border-color: #ff3366; color: #ff3366; padding: 4px 10px; font-size: 0.85rem; margin-left: auto;">
            Remover
          </button>
        </div>
        <div style="margin-top: 10px;">
          <label style="display: block; font-size: 0.8rem; color: var(--muted); margin-bottom: 6px; font-weight: 500;">Selecione os partidos integrantes:</label>
          <div style="display: flex; flex-wrap: wrap; gap: 2px;">
            ${partiesHtml}
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function addNewCustomBlock() {
  const defaultColors = ['#ff007f', '#00e5ff', '#ff9f00', '#7ed321', '#bd10e0', '#f8e71c', '#9013fe'];
  const nextColor = defaultColors[STATE.customBlocks.length % defaultColors.length];
  
  STATE.customBlocks.push({
    name: 'Bloco ' + (STATE.customBlocks.length + 1),
    color: nextColor,
    parties: []
  });
  renderBlockDefinerList();
}

function updateBlockName(idx, name) {
  if (STATE.customBlocks[idx]) {
    STATE.customBlocks[idx].name = name.trim();
  }
}

function updateBlockColor(idx, color) {
  if (STATE.customBlocks[idx]) {
    STATE.customBlocks[idx].color = color;
  }
}

function togglePartyInBlock(idx, party, isChecked) {
  if (!STATE.customBlocks[idx]) return;
  const block = STATE.customBlocks[idx];
  if (isChecked) {
    if (!block.parties.includes(party)) {
      block.parties.push(party);
    }
  } else {
    block.parties = block.parties.filter(p => p !== party);
  }
  renderBlockDefinerList();
}

function deleteCustomBlock(idx) {
  STATE.customBlocks.splice(idx, 1);
  renderBlockDefinerList();
}

function applyCustomBlocks() {
  const names = new Set();
  for (let i = 0; i < STATE.customBlocks.length; i++) {
    const block = STATE.customBlocks[i];
    if (!block.name || block.name.trim() === '') {
      alert('Por favor, defina um nome para todos os blocos.');
      return;
    }
    if (names.has(block.name)) {
      alert('Os nomes dos blocos devem ser únicos (duplicado: ' + block.name + ').');
      return;
    }
    names.add(block.name);
  }

  // Save to localStorage and set modified flag to true
  try {
    localStorage.setItem('observatorio_custom_blocks_modified', 'true');
    localStorage.setItem('observatorio_custom_blocks', JSON.stringify(STATE.customBlocks));
  } catch (e) {
    console.error("Error saving custom blocks to cache", e);
  }

  modalCustomBlocksBackup = null; // Prevent revert on close
  applyCustomBlocksToData();
  applyFiltersAndRedraw();
  
  if (typeof populateVizPartySelect === 'function') {
    populateVizPartySelect();
  }

  document.getElementById('blockDefinerOverlay')?.classList.remove('visible');
}

function clearCustomBlocks() {
  STATE.customBlocks = [];
  modalCustomBlocksBackup = null;

  try {
    localStorage.setItem('observatorio_custom_blocks_modified', 'false');
    localStorage.removeItem('observatorio_custom_blocks');
  } catch (e) {
    console.error("Error clearing custom blocks cache", e);
  }

  applyCustomBlocksToData();
  applyFiltersAndRedraw();
  
  if (typeof populateVizPartySelect === 'function') {
    populateVizPartySelect();
  }
  
  document.getElementById('blockDefinerOverlay')?.classList.remove('visible');
}

function calculateDhondt(votes, numSeats) {
  if (numSeats <= 0) return {};
  const quotients = [];
  const seats = {};
  
  Object.entries(votes).forEach(([party, v]) => {
    if (v > 0) {
      seats[party] = 0;
      for (let i = 1; i <= numSeats; i++) {
        quotients.push({ party, val: v / i });
      }
    }
  });
  
  quotients.sort((a, b) => b.val - a.val);
  
  for (let i = 0; i < Math.min(numSeats, quotients.length); i++) {
    const q = quotients[i];
    seats[q.party] = (seats[q.party] || 0) + 1;
  }
  
  Object.keys(seats).forEach(p => {
    if (seats[p] === 0) delete seats[p];
  });
  
  return seats;
}

function applyCustomBlocksToData() {
  if (STATE.currentElectionType !== 'ar' && STATE.currentElectionType !== 'ee') {
    return;
  }
  
  if (!STATE.originalData) {
    STATE.originalData = JSON.parse(JSON.stringify(STATE.data));
  }
  
  // If not modified yet, default to empty (no blocks)
  const modifiedFlag = localStorage.getItem('observatorio_custom_blocks_modified');
  if (modifiedFlag === null) {
    STATE.customBlocks = [];
  }
  
  STATE.data = JSON.parse(JSON.stringify(STATE.originalData));
  
  if (!STATE.customBlocks || STATE.customBlocks.length === 0) {
    return;
  }
  
  const blocks = STATE.customBlocks;
  
  function mergeVotes(votes) {
    if (!votes) return;
    blocks.forEach(block => {
      let blockVotes = 0;
      block.parties.forEach(p => {
        if (votes[p] !== undefined) {
          blockVotes += votes[p];
          delete votes[p];
        }
      });
      if (blockVotes > 0) {
        votes[block.name] = (votes[block.name] || 0) + blockVotes;
      }
    });
  }
  
  // 1. RESULTS (freguesias or concelhos depending on year)
  if (STATE.data.RESULTS) {
    Object.values(STATE.data.RESULTS).forEach(mergeVotes);
  }
  
  // 2. AGG.concelho
  if (STATE.data.AGG && STATE.data.AGG.concelho) {
    Object.values(STATE.data.AGG.concelho).forEach(entry => {
      mergeVotes(entry.votes);
    });
  }
  
  // 3. AGG.distrito
  if (STATE.data.AGG && STATE.data.AGG.distrito) {
    Object.entries(STATE.data.AGG.distrito).forEach(([code, entry]) => {
      mergeVotes(entry.votes);
      if (entry.mandatos > 0 && entry.votes) {
        entry.mandatos_p = calculateDhondt(entry.votes, entry.mandatos);
      }
    });
  }
  
  // 4. AGG.national
  if (STATE.data.AGG && STATE.data.AGG.national) {
    mergeVotes(STATE.data.AGG.national.votes);
  }
  
  // 5. METADATA.national
  if (STATE.data.METADATA && STATE.data.METADATA.national) {
    mergeVotes(STATE.data.METADATA.national.votes);
  }
  
  // 6. METADATA.global
  if (STATE.data.METADATA && STATE.data.METADATA.global) {
    mergeVotes(STATE.data.METADATA.global.votes);
  }
  
  // 7. Recalculate national/global seat distribution (sum of districts)
  const nationalMandatosP = {};
  if (STATE.data.AGG && STATE.data.AGG.distrito) {
    Object.values(STATE.data.AGG.distrito).forEach(d => {
      Object.entries(d.mandatos_p || {}).forEach(([p, s]) => {
        nationalMandatosP[p] = (nationalMandatosP[p] || 0) + s;
      });
    });
  }
  
  if (STATE.data.AGG && STATE.data.AGG.national) {
    STATE.data.AGG.national.mandatos_p = nationalMandatosP;
  }
  if (STATE.data.METADATA && STATE.data.METADATA.national) {
    STATE.data.METADATA.national.mandatos_p = nationalMandatosP;
  }
  if (STATE.data.METADATA && STATE.data.METADATA.global) {
    STATE.data.METADATA.global.mandatos_p = nationalMandatosP;
  }
  
  // 8. METADATA.parties
  if (STATE.data.METADATA && STATE.data.METADATA.parties) {
    blocks.forEach(block => {
      STATE.data.METADATA.parties[block.name] = block.name;
    });
  }
}
