// ============================================================================
// simulador-pt.js — Simulador de cenários nacionais (Assembleia da República)
// ----------------------------------------------------------------------------
// Modelo: SWING PROPORCIONAL. O utilizador define a percentagem nacional de
// cada partido; cada partido é multiplicado pelo mesmo fator em todos os
// territórios. Isso preserva os padrões geográficos reais do ano-base e nunca
// produz votos negativos. Os mandatos são depois recalculados pelo método de
// Hondt em cada um dos 22 círculos, com a magnitude oficial que já vem em
// AGG.distrito[*].mandatos.
//
// Tal como o definidor de blocos (block-definer-pt.js), isto é apenas uma
// reescrita de STATE.data seguida de applyFiltersAndRedraw() — nenhum renderer
// precisa de saber que o simulador existe.
// ============================================================================

// Esta página ignora os blocos personalizados guardados pelo visualizador.
STATE.customBlocks = [];

// Alvos por partido: fração dos votos válidos nacionais, soma 1.
STATE.simTargets = null;

// Partidos que o utilizador já definiu explicitamente. Ficam fixos: a diferença
// é absorvida pelos restantes, para que definir três percentagens seguidas não
// desfaça as duas primeiras.
STATE.simPinned = new Set();

const SIM_EPS = 1e-9;

// ====== HELPERS ======

function simFmtPct(frac) {
  return (frac * 100).toFixed(2).replace('.', ',');
}

function simParsePct(str) {
  const n = parseFloat(String(str).replace(',', '.'));
  return isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}

// Quotas do resultado real do ano-base.
function simRealShares() {
  const votes = STATE.originalData?.METADATA?.global?.votes || {};
  let total = 0;
  for (const v of Object.values(votes)) total += v;
  const shares = {};
  if (total > 0) for (const [p, v] of Object.entries(votes)) shares[p] = v / total;
  return shares;
}

// Chave de dados -> chave de exibição. Em 2025 os Açores concorrem como
// 'AD Açores' nas freguesias/concelhos/círculos, mas o ETL dobra esses votos
// dentro de 'AD' em METADATA.global. PARTY_KEY_ALIASES já conhece a relação
// (AD ACORES -> AD), pelo que reaproveitamos getNormalizedPartyColorKey em vez
// de inventar uma tabela nova.
function simDisplayKeyResolver(base) {
  const globalVotes = base?.METADATA?.global?.votes || {};
  const byNorm = new Map();
  const collided = new Set();
  for (const k of Object.keys(globalVotes)) {
    const norm = getNormalizedPartyColorKey(k);
    if (byNorm.has(norm)) collided.add(norm);
    else byNorm.set(norm, k);
  }
  // Se duas chaves de exibição normalizassem para a mesma coisa, agrupá-las
  // fundiria dois partidos distintos. Nesse caso não agrupamos nenhuma delas.
  collided.forEach((norm) => byNorm.delete(norm));

  return function displayKeyFor(dataKey) {
    if (dataKey in globalVotes) return dataKey;
    return byNorm.get(getNormalizedPartyColorKey(dataKey)) || dataKey;
  };
}

// ====== ALVOS ======

function simSeedTargets() {
  STATE.simTargets = simRealShares();
  STATE.simPinned = new Set();
}

// Define a percentagem de um partido mantendo a soma em 100%. Os partidos já
// definidos pelo utilizador ficam quietos; a diferença é absorvida pelos que
// ele ainda não tocou, proporcionalmente ao que já valiam.
function setSimTarget(party, pctValue) {
  const targets = STATE.simTargets;
  if (!targets || !(party in targets)) return;

  const parsed = simParsePct(pctValue);
  let next = (parsed === null ? 0 : parsed) / 100;

  const pinned = STATE.simPinned;
  const others = Object.keys(targets).filter((p) => p !== party);
  const free = others.filter((p) => !pinned.has(p));
  let pinnedSum = 0;
  for (const p of others) if (pinned.has(p)) pinnedSum += targets[p];

  // Se ainda há partidos livres para absorver, este não pode pedir mais do que
  // o que sobra depois dos que já estão fixos.
  if (free.length) next = Math.min(next, Math.max(0, 1 - pinnedSum));

  // Quando já não há partidos livres, não há alternativa senão mexer nos fixos.
  const rest = free.length ? free : others;
  const restNew = free.length ? (1 - next - pinnedSum) : (1 - next);
  let restOld = 0;
  for (const p of rest) restOld += targets[p];

  if (restOld > SIM_EPS && restNew >= 0) {
    const k = restNew / restOld;
    for (const p of rest) targets[p] *= k;
  } else {
    // Os que iam absorver já estavam a zero: não há proporção para preservar,
    // por isso o que sobra distribui-se pelas quotas do resultado real.
    const real = simRealShares();
    let seed = 0;
    for (const p of rest) seed += real[p] || 0;
    for (const p of rest) {
      targets[p] = seed > SIM_EPS ? (Math.max(0, restNew) * (real[p] || 0)) / seed : 0;
    }
  }

  targets[party] = next;
  pinned.add(party);
}

// ====== O TRANSFORM ======

function applySimulationToData() {
  if (STATE.currentElectionType !== 'ar' || !STATE.data) return;
  if (!STATE.originalData) STATE.originalData = JSON.parse(JSON.stringify(STATE.data));

  // ponytail: clone completo (~650 KB) a cada alteração, tal como o
  // block-definer. Se ficar lento ao nível de freguesia, escalar in-place a
  // partir do snapshot em vez de clonar.
  STATE.data = JSON.parse(JSON.stringify(STATE.originalData));
  if (!STATE.simTargets) return;

  const base = STATE.originalData;
  const d = STATE.data;
  const displayKeyFor = simDisplayKeyResolver(base);

  // A base de cada grupo é a soma sobre os 22 círculos — é aí que vivem as
  // chaves de dados reais, e o total bate certo com METADATA.global.
  const groupBase = {};
  let totalBase = 0;
  for (const entry of Object.values(base.AGG?.distrito || {})) {
    for (const [k, v] of Object.entries(entry.votes || {})) {
      const g = displayKeyFor(k);
      groupBase[g] = (groupBase[g] || 0) + v;
      totalBase += v;
    }
  }
  if (totalBase <= 0) return;

  // f = alvo x totalBase / votosBase. Como todos os níveis usam o mesmo f, a
  // quota nacional resultante é exatamente o alvo e o total de votos válidos
  // mantém-se (os alvos somam 1).
  const factor = {};
  for (const [g, v] of Object.entries(groupBase)) {
    factor[g] = v > 0 ? ((STATE.simTargets[g] || 0) * totalBase) / v : 0;
  }

  const scale = (votes) => {
    if (!votes) return;
    for (const k of Object.keys(votes)) {
      const f = factor[displayKeyFor(k)];
      if (f !== undefined) votes[k] = Math.round(votes[k] * f);
    }
  };

  Object.values(d.RESULTS || {}).forEach(scale);                         // freguesias
  Object.values(d.AGG?.concelho || {}).forEach((e) => scale(e.votes));
  Object.values(d.AGG?.distrito || {}).forEach((e) => scale(e.votes));
  if (d.AGG?.national) scale(d.AGG.national.votes);
  if (d.METADATA?.national) scale(d.METADATA.national.votes);
  if (d.METADATA?.global) scale(d.METADATA.global.votes);
  if (d.METADATA?.estrangeiro) scale(d.METADATA.estrangeiro.votes);
  Object.values(d.COUNTRIES || {}).forEach((circulo) => {                // diáspora
    Object.values(circulo || {}).forEach((pais) => scale(pais.votes));
  });

  // Hondt em cada círculo, com a magnitude oficial que já vem nos dados.
  const seatsGlobal = {};
  const seatsNacional = {};
  const seatsEstrangeiro = {};
  for (const [code, entry] of Object.entries(d.AGG?.distrito || {})) {
    if (!(entry.mandatos > 0) || !entry.votes) continue;
    entry.mandatos_p = calculateDhondt(entry.votes, entry.mandatos);
    const isEmigracao = CIRCULOS_SEM_GEOMETRIA.has(code);
    for (const [p, s] of Object.entries(entry.mandatos_p)) {
      // Dobrar por chave de exibição: os mandatos da 'AD Açores' contam para a
      // linha 'AD' do painel nacional, como no resultado oficial.
      const g = displayKeyFor(p);
      seatsGlobal[g] = (seatsGlobal[g] || 0) + s;
      if (isEmigracao) seatsEstrangeiro[g] = (seatsEstrangeiro[g] || 0) + s;
      else seatsNacional[g] = (seatsNacional[g] || 0) + s;
    }
  }
  if (d.AGG?.national) d.AGG.national.mandatos_p = seatsNacional;
  if (d.METADATA?.national) d.METADATA.national.mandatos_p = seatsNacional;
  if (d.METADATA?.global) d.METADATA.global.mandatos_p = seatsGlobal;
  if (d.METADATA?.estrangeiro) d.METADATA.estrangeiro.mandatos_p = seatsEstrangeiro;
}

// ====== PAINEL ======

function renderSimPanel() {
  const list = document.getElementById('simPartyList');
  if (!list || !STATE.simTargets) return;

  const real = simRealShares();
  const parties = Object.keys(STATE.simTargets)
    .sort((a, b) => (real[b] || 0) - (real[a] || 0));

  list.innerHTML = '';
  parties.forEach((party) => {
    const fullName = PARTY_FULL_NAMES[getNormalizedPartyColorKey(party)] || party;
    const row = document.createElement('div');
    row.className = 'sim-row';
    row.dataset.party = party;
    row.innerHTML = `
      <button type="button" class="sim-swatch" style="background:${escapeAttribute(getResolvedPartyColor(party))}"
        title="Fixar ou libertar ${escapeAttribute(party)}. Partidos fixos não são mexidos quando ajustas os outros."></button>
      <span class="sim-name" title="${escapeAttribute(fullName)}">${escapeHtml(party)}</span>
      <span class="sim-delta"></span>
      <input type="text" class="sim-pct-input" inputmode="decimal" aria-label="Percentagem de ${escapeAttribute(party)}" />
      <input type="range" class="sim-slider" min="0" max="100" step="0.1" aria-label="Ajustar ${escapeAttribute(party)}" />
    `;
    list.appendChild(row);

    const slider = row.querySelector('.sim-slider');
    const box = row.querySelector('.sim-pct-input');

    slider.addEventListener('input', () => {
      setSimTarget(party, slider.value);
      simSyncRows(slider);
      simApplyDebounced();
    });
    box.addEventListener('change', () => {
      if (simParsePct(box.value) === null) { simSyncRows(); return; }
      setSimTarget(party, box.value);
      simSyncRows();
      simApplyDebounced();
    });
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter') box.blur(); });

    row.querySelector('.sim-swatch').addEventListener('click', () => {
      if (STATE.simPinned.has(party)) STATE.simPinned.delete(party);
      else STATE.simPinned.add(party);
      simSyncRows();
    });
  });

  simSyncRows();
}

// Atualiza os valores no sítio (não reconstrói o DOM, para não partir o
// arrasto do slider que está a ser mexido).
function simSyncRows(activeSlider) {
  const targets = STATE.simTargets;
  if (!targets) return;
  const real = simRealShares();
  let total = 0;

  document.querySelectorAll('#simPartyList .sim-row').forEach((row) => {
    const party = row.dataset.party;
    const t = targets[party] || 0;
    total += t;

    row.classList.toggle('pinned', STATE.simPinned.has(party));

    // Não mexer no controlo que o utilizador tem debaixo do dedo.
    const box = row.querySelector('.sim-pct-input');
    const slider = row.querySelector('.sim-slider');
    if (box && document.activeElement !== box) box.value = simFmtPct(t);
    if (slider && slider !== activeSlider && document.activeElement !== slider) {
      slider.value = (t * 100).toFixed(1);
    }

    const deltaEl = row.querySelector('.sim-delta');
    if (!deltaEl) return;
    const delta = (t - (real[party] || 0)) * 100;
    if (Math.abs(delta) < 0.005) {
      deltaEl.textContent = '–';
      deltaEl.className = 'sim-delta';
    } else {
      deltaEl.textContent = (delta > 0 ? '+' : '−') + Math.abs(delta).toFixed(2).replace('.', ',');
      deltaEl.className = 'sim-delta ' + (delta > 0 ? 'up' : 'down');
    }
  });

  const totalEl = document.getElementById('simTotal');
  if (totalEl) totalEl.textContent = simFmtPct(total) + '%';
}

// ====== APLICAR ======

function simApplyAndRedraw() {
  // Sincronizar aqui garante que o painel nunca fica a mostrar números
  // diferentes dos que estão no mapa, seja qual for o caminho que mexeu nos
  // alvos. simSyncRows() não toca no controlo que está a ser arrastado.
  simSyncRows();
  applySimulationToData();
  if (currentVizMode === 'desempenho' && STATE.vizParty) {
    STATE.performanceStats = computePerformanceStats(STATE.vizParty);
  }
  applyFiltersAndRedraw();
}

// debounce() vive em ui-helpers.js, que carrega depois deste ficheiro — daí a
// construção preguiçosa.
let _simApplyDebounced = null;
function simApplyDebounced() {
  if (!_simApplyDebounced) _simApplyDebounced = debounce(simApplyAndRedraw, 140);
  _simApplyDebounced();
}

function resetSimulation() {
  simSeedTargets();
  simSyncRows();
  simApplyAndRedraw();
  if (typeof showToast === 'function') {
    showToast('Reposto o resultado real de ' + STATE.currentYear, 'info', 2000);
  }
}

// Chamado por loadCurrentYear() logo depois de os dados do ano chegarem.
function simOnDataLoaded() {
  if (STATE.currentElectionType !== 'ar') return;
  if (!STATE.originalData) STATE.originalData = JSON.parse(JSON.stringify(STATE.data));
  if (!STATE.simTargets) simSeedTargets();
  renderSimPanel();
  applySimulationToData();
}

function setupSimulatorControls() {
  document.getElementById('btnSimReset')?.addEventListener('click', resetSimulation);
  document.querySelectorAll('.sim-base-year').forEach((el) => {
    el.textContent = STATE.currentYear;
  });

  // No telemóvel, a barra compacta é o rótulo mais visível por cima do mapa, e
  // a versão partilhada escreveria "Assembleia da República · 2025" — o que num
  // cenário inventado seria enganador. Declarações de função ficam no objeto
  // global, por isso substituí-la aqui também intercepta as chamadas do painel.
  if (typeof updateMobileFilterSummary === 'function') {
    const original = updateMobileFilterSummary;
    window.updateMobileFilterSummary = function () {
      original.apply(this, arguments);
      const el = document.getElementById('mFilterSummary');
      if (el) el.textContent = 'Simulação · ' + (STATE.currentYear || '');
    };
  }
}
window.addEventListener('DOMContentLoaded', setupSimulatorControls);

// ====== AUTO-TESTE ======
// Correr window.simSelfCheck() na consola do browser.
function simSelfCheck() {
  const fails = [];
  const ok = (cond, msg) => { if (!cond) fails.push(msg); };
  if (!STATE.originalData) {
    console.error('simSelfCheck: dados base ainda não carregados');
    return false;
  }

  const saved = JSON.parse(JSON.stringify(STATE.simTargets));
  const displayKeyFor = simDisplayKeyResolver(STATE.originalData);
  const sumOf = (votes) => Object.values(votes || {}).reduce((a, b) => a + b, 0);
  const baseTotal = sumOf(STATE.originalData.METADATA.global.votes);

  // --- 1. Com os alvos = resultado real, reproduzir os mandatos oficiais.
  simSeedTargets();
  applySimulationToData();
  const oficial = STATE.originalData.METADATA.global.mandatos_p || {};
  const obtido = STATE.data.METADATA.global.mandatos_p || {};
  for (const p of new Set(Object.keys(oficial).concat(Object.keys(obtido)))) {
    ok((oficial[p] || 0) === (obtido[p] || 0),
      `mandatos de ${p} com o resultado real: oficial ${oficial[p] || 0}, obtido ${obtido[p] || 0}`);
  }

  // --- 2. Um cenário inventado atinge exatamente os alvos.
  setSimTarget('CH', 30);
  setSimTarget('PS', 25);
  applySimulationToData();

  const simVotes = STATE.data.METADATA.global.votes;
  const simTotal = sumOf(simVotes);
  ok(Math.abs(simTotal - baseTotal) <= 20,
    `total de votos válidos deslocou-se: ${simTotal} vs ${baseTotal}`);

  for (const [p, target] of Object.entries(STATE.simTargets)) {
    const got = ((simVotes[p] || 0) / simTotal) * 100;
    ok(Math.abs(got - target * 100) < 0.01,
      `quota de ${p}: alvo ${(target * 100).toFixed(2)}%, obtido ${got.toFixed(2)}%`);
  }

  // --- 3. Os 230 mandatos continuam todos distribuídos.
  let seatsDistritos = 0;
  for (const e of Object.values(STATE.data.AGG.distrito)) seatsDistritos += sumOf(e.mandatos_p);
  const seatsGlobal = sumOf(STATE.data.METADATA.global.mandatos_p);
  ok(seatsDistritos === 230, `soma dos mandatos por círculo = ${seatsDistritos}, esperado 230`);
  ok(seatsGlobal === 230, `soma dos mandatos nacionais = ${seatsGlobal}, esperado 230`);

  // --- 4. Freguesias e concelhos continuam coerentes entre si.
  const byLevel = (obj, pick) => {
    const acc = {};
    for (const e of Object.values(obj)) {
      for (const [k, v] of Object.entries(pick(e) || {})) {
        const g = displayKeyFor(k);
        acc[g] = (acc[g] || 0) + v;
      }
    }
    return acc;
  };
  const fregs = byLevel(STATE.data.RESULTS, (e) => e);
  const concs = byLevel(STATE.data.AGG.concelho, (e) => e.votes);
  for (const p of Object.keys(concs)) {
    ok(Math.abs((fregs[p] || 0) - concs[p]) <= 500,
      `${p}: soma das freguesias ${fregs[p] || 0} vs concelhos ${concs[p]}`);
  }

  // Repor o cenário que o utilizador tinha.
  STATE.simTargets = saved;
  simSyncRows();
  simApplyAndRedraw();

  if (fails.length) {
    console.error(`simSelfCheck: ${fails.length} falha(s)`);
    fails.forEach((f) => console.error('  x ' + f));
    return false;
  }
  console.log('simSelfCheck: tudo ok (mandatos oficiais, alvos exatos, 230 mandatos, níveis coerentes)');
  return true;
}
window.simSelfCheck = simSelfCheck;
