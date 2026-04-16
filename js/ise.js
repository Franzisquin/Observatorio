/**
 * ise.js
 * Extensão do Visualizador Eleitoral para o Índice Socioeconômico (ISE)
 */

const ISE_COLORS = { baixo: '#4a9eff', medio: '#f5c842', alto: '#ff6b4a' };
const ISE_LABELS = { baixo: 'Classe baixa', medio: 'Classe média', alto: 'Classe alta' };
const ISE_TERCIL_ORDER = ['baixo', 'medio', 'alto'];

function isLimitedCensusYear2006() {
    return String(window.STATE?.currentElectionYear || '') === '2006';
}

// Estado do modo de análise (ISE vs Fator Demográfico)
if (!window.ISE_FACTOR_STATE) window.ISE_FACTOR_STATE = {
    analysisMode: 'ise',
    factorGroupId: 'genero',
    factorId: 'mulheres',
};

function _isLegislativeISECargo(cargo) {
    const normalized = String(cargo || '');
    return normalized.startsWith('deputado') || normalized.startsWith('vereador');
}

function _getLegislativeISEConfig(cargo = null) {
    const resolvedCargo = String(cargo || window.ISE_DEP_STATE?.cargo || window.currentCargo || '');
    const STATE = window.STATE || {};
    const isVereador = resolvedCargo.startsWith('vereador');

    return {
        cargo: resolvedCargo,
        isVereador,
        typeKey: isVereador ? 'v' : (resolvedCargo.includes('estadual') ? 'e' : 'f'),
        resultsStore: isVereador ? (STATE.vereadorResults || {}) : (STATE.deputyResults || {}),
        metadataStore: isVereador ? (STATE.vereadorMetadata || {}) : (STATE.deputyMetadata || {}),
        getLocalKey(props) {
            const gp = window.getProp || ((p, k) => p[k]);
            const z = parseInt(gp(props, 'nr_zona'));
            const l = parseInt(gp(props, 'nr_locvot') || gp(props, 'nr_local_votacao'));
            if (isNaN(z) || isNaN(l)) return null;
            if (isVereador) return `${z}_${l}`;
            const m = parseInt(gp(props, 'cd_localidade_tse') || gp(props, 'CD_MUNICIPIO'));
            if (isNaN(m)) return null;
            return `${z}_${m}_${l}`;
        }
    };
}

function getAvailableIseFactorGroups() {
    if (isLimitedCensusYear2006()) {
        return {
            renda: ISE_FACTORS.renda,
            raca: ISE_FACTORS.raca,
            saneamento: ISE_FACTORS.saneamento,
        };
    }
    const { renda, ...rest } = ISE_FACTORS;
    return rest;
}

function enforceIseModeAvailability() {
    const limited2006 = isLimitedCensusYear2006();
    const btnISE = document.getElementById('iseAnalysisModeISE');
    const btnFactor = document.getElementById('iseAnalysisModeFactor');
    const factorBox = document.getElementById('iseFactorSelectorBox');

    if (limited2006) {
        window.ISE_FACTOR_STATE.analysisMode = 'factor';
        if (btnISE) btnISE.style.display = 'none';
        if (btnFactor) btnFactor.style.display = '';
        if (btnFactor) btnFactor.classList.add('active');
        if (factorBox) factorBox.style.display = 'block';
    } else {
        if (btnISE) btnISE.style.display = '';
        if (btnFactor) btnFactor.style.display = '';
    }
}

// Injeta o tooltip no body caso não exista
let iseTooltip = document.getElementById('ise-tooltip');
if (!iseTooltip) {
    iseTooltip = document.createElement('div');
    iseTooltip.id = 'ise-tooltip';
    iseTooltip.style.cssText = 'display:none;position:fixed;z-index:10000;pointer-events:none;background:rgba(18,18,22,0.96);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:0;min-width:220px;max-width:480px;width:max-content;backdrop-filter:blur(12px);box-shadow:0 8px 32px rgba(0,0,0,0.45);font-family:inherit;overflow:hidden;';
    iseTooltip.innerHTML = `
    <div style="padding:12px 14px 8px; border-bottom:1px solid rgba(255,255,255,0.06);">
      <div id="ise-tt-name" style="font-size:13px; font-weight:600; color:#f0f0f0; line-height:1.35; word-wrap:break-word;"></div>
      <div id="ise-tt-location" style="font-size:11px; color:rgba(255,255,255,0.45); margin-top:3px; line-height:1.3;"></div>
    </div>
    <div style="padding:10px 14px; display:flex; gap:12px; align-items:center;">
      <div style="flex:1;">
        <div id="ise-tt-x-label" style="font-size:9px; text-transform:uppercase; letter-spacing:0.8px; color:rgba(255,255,255,0.35); margin-bottom:2px;">Índice ISE</div>
        <div id="ise-tt-idx" style="font-size:18px; font-weight:700; color:#f0f0f0; font-variant-numeric:tabular-nums;"></div>
      </div>
      <div style="width:1px; height:28px; background:rgba(255,255,255,0.08);"></div>
      <div style="flex:1;">
        <div style="font-size:9px; text-transform:uppercase; letter-spacing:0.8px; color:rgba(255,255,255,0.35); margin-bottom:2px;">% Votos</div>
        <div id="ise-tt-pct" style="font-size:18px; font-weight:700; color:#f0f0f0; font-variant-numeric:tabular-nums; white-space:nowrap;"></div>
      </div>
    </div>
    <div style="padding:6px 14px 10px;">
      <div id="ise-tt-faixa" style="display:inline-block; padding:3px 10px; border-radius:4px; font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;"></div>
    </div>
  `;
    document.body.appendChild(iseTooltip);
}

const ttName = document.getElementById('ise-tt-name');
const ttLocation = document.getElementById('ise-tt-location');
const ttIdx = document.getElementById('ise-tt-idx');
const ttPct = document.getElementById('ise-tt-pct');
const ttFaixa = document.getElementById('ise-tt-faixa');

function showIseTT(e, d) {
    ttName.textContent = d.nm || 'Local';
    // Cidade · Bairro (estado inteiro) ou só Bairro (eleição municipal)
    const parts = [d.cidade, d.bairro].filter(Boolean);
    ttLocation.textContent = parts.join(' · ');
    ttLocation.style.display = parts.length ? 'block' : 'none';

    const xLabelEl = document.getElementById('ise-tt-x-label');
    if (xLabelEl) xLabelEl.textContent = 'ÍNDICE ISE';

    ttIdx.textContent = d.x.toFixed(1);
    ttPct.textContent = d.y.toFixed(1) + '%';
    ttFaixa.textContent = ISE_LABELS[d.t] || d.t;
    ttFaixa.style.display = 'inline-block';
    ttPct.style.fontSize = '18px';
    ttPct.style.fontWeight = '700';
    ttPct.style.color = '#f0f0f0';
    // Cores por faixa
    const faixaColors = { baixo: 'rgba(74,158,255,0.15)', medio: 'rgba(245,200,66,0.15)', alto: 'rgba(255,107,74,0.15)' };
    const faixaText = { baixo: '#4a9eff', medio: '#f5c842', alto: '#ff6b4a' };
    ttFaixa.style.background = faixaColors[d.t] || 'rgba(255,255,255,0.08)';
    ttFaixa.style.color = faixaText[d.t] || '#999';
    iseTooltip.style.display = 'block';
    moveIseTT(e);
}
function moveIseTT(e) {
    const x = e.clientX + 14, y = e.clientY - 10;
    const w = iseTooltip.offsetWidth, h = iseTooltip.offsetHeight;
    iseTooltip.style.left = (x + w > window.innerWidth ? x - w - 28 : x) + 'px';
    iseTooltip.style.top = (y + h > window.innerHeight ? y - h : y) + 'px';
}
function hideIseTT() { iseTooltip.style.display = 'none'; }

// Helper para obter valores numéricos considerando diferentes cases e chaves
function getPropVal(props, candidates) {
    for (const key of candidates) {
        if (props[key] !== undefined) return Number(props[key].toString().replace(',', '.')) || 0;
        const upper = key.toUpperCase();
        for (const k in props) {
            if (k.toUpperCase() === upper) return Number(props[k].toString().replace(',', '.')) || 0;
        }
    }
    return 0;
}

// Helper para obter valores de TEXTO (não converte para número)
function getStrProp(props, candidates) {
    for (const key of candidates) {
        if (props[key] !== undefined && props[key] !== null && props[key] !== '') return String(props[key]);
        const upper = key.toUpperCase();
        for (const k in props) {
            if (k.toUpperCase() === upper && props[k] !== null && props[k] !== '') return String(props[k]);
        }
    }
    return '';
}

function getIseSelectionId(props) {
    if (!props) return '';
    if (typeof window.getFeatureSelectionId === 'function') {
        return String(window.getFeatureSelectionId(props) || '');
    }
    const gp = window.getProp || ((p, k) => p[k]);
    return String(gp(props, 'id_unico') || gp(props, 'local_id') || gp(props, 'nr_locvot') || '');
}

// Regression
function linReg(data) {
    const n = data.length; if (n < 2) return { slope: 0, intercept: 0, r2: 0 };
    const mx = data.reduce((s, d) => s + d.x, 0) / n;
    const my = data.reduce((s, d) => s + d.y, 0) / n;
    const num = data.reduce((s, d) => s + (d.x - mx) * (d.y - my), 0);
    const dx = data.reduce((s, d) => s + (d.x - mx) ** 2, 0);
    const dy = data.reduce((s, d) => s + (d.y - my) ** 2, 0);
    const slope = dx ? num / dx : 0;
    return { slope, intercept: my - slope * mx, r2: dx && dy ? (num ** 2) / (dx * dy) : 0 };
}

// Função para processar os dados e calcular o ISE
function processISEData(features, candidatoKey, currentCargo) {
    const isLegacy = false; // Ajustar se precisarmos lidar com legacy 2006
    const dataPoints = [];

    // Usaremos as variáveis clássicas mas em duas etapas:
    // Passo 1: Score absoluto (eixo X) igual para todo o país (0-100)
    // Passo 2: Faixas de cores (Baixa/Média/Alta) por tercis (relativo à seleção atual, para dar contraste local)

    // Variáveis usadas: Renda (0-10000+), Ensino Superior (0-100%), Esgoto (0-100%), % Idade Produtiva (0-100%)
    let minIdade = Infinity, maxIdade = -Infinity;

    // Primeira passada: extrair variaveis brutas
    const rawFeatures = [];

    features.forEach(f => {
        const p = f.properties;

        // Renda
        const renda = getPropVal(p, ['Renda Media', 'RENDA MEDIA', 'renda']);

        // Esgoto (Rede Geral / Total Saneamento)
        const esgGeral = getPropVal(p, ['Pct Esgoto Rede Geral']);
        const esgFossa = getPropVal(p, ['Pct Fossa Septica', 'Pct Fossa Séptica']);
        const esgInad = getPropVal(p, ['Pct Esgoto Inadequado']);
        // FIX Bug 2: esgotoFinal usa proporção correta — considera fossa séptica no denominador
        const esqTotal = esgGeral + esgFossa + esgInad;
        const esgotoFinal = esqTotal > 0 ? (esgGeral / esqTotal) * 100 : (esgGeral > 0 ? esgGeral : 0);

        // Escolaridade Superior (Superior Completo + Incompleto? A metodologia fala "Superior")
        // Vamos usar Superior Completo
        const supComp = getPropVal(p, ['ENSINO SUPERIOR COMPLETO', 'SUPERIOR COMPLETO', 'Superior Completo']);
        const analf = getPropVal(p, ['ANALFABETO', 'Analfabeto']);
        const le = getPropVal(p, ['LÊ E ESCREVE', 'LE E ESCREVE', 'Lê e Escreve']);
        const fi = getPropVal(p, ['ENSINO FUNDAMENTAL INCOMPLETO', 'FUNDAMENTAL INCOMPLETO']);
        const fc = getPropVal(p, ['ENSINO FUNDAMENTAL COMPLETO', 'FUNDAMENTAL COMPLETO']);
        const mi = getPropVal(p, ['ENSINO MÉDIO INCOMPLETO', 'MEDIO INCOMPLETO']);
        const mc = getPropVal(p, ['ENSINO MÉDIO COMPLETO', 'MEDIO COMPLETO']);
        const si = getPropVal(p, ['ENSINO SUPERIOR INCOMPLETO', 'SUPERIOR INCOMPLETO']);
        const totalEsc = supComp + analf + le + fi + fc + mi + mc + si;
        const pctSup = totalEsc > 0 ? (supComp / totalEsc) * 100 : 0;

        // Idade 25 a 59 (retomada no lugar de "Branca" por questão demográfica)
        let idade25_59 = 0;
        let totalIdade = 0;
        for (const key in p) {
            if (key.match(/anos/i) && !key.match(/^Pct/i)) {
                const v = Number(p[key]) || 0;
                const match = key.match(/(\d+)/);
                if (match) {
                    const age = parseInt(match[1]);
                    totalIdade += v;
                    // FIX Bug 1: if interno redundante removido — evita dupla contagem
                    if (age >= 25 && age <= 59) {
                        idade25_59 += v;
                    }
                }
            }
        }
        const pctIdade = totalIdade > 0 ? (idade25_59 / totalIdade) * 100 : 0;

        // Apenas considera se o local possui renda
        if (renda > 0) {
            minIdade = Math.min(minIdade, pctIdade); maxIdade = Math.max(maxIdade, pctIdade);

            // Total de votos válidos para o local
            let votosCandidato = 0;
            let votosValidos = 0;

            // Iterar sobre as colunas para somar os votos dos candidatos
            let validCandidateKeys = [];
            if (window.STATE && window.STATE.candidates && currentCargo) {
                // Usa window.currentTurno (exportado do app.js via getter)
                const t = window.currentTurno || 1;
                const turnoKey = (t === 2 && window.STATE.dataHas2T[currentCargo]) ? '2T' : '1T';
                validCandidateKeys = window.STATE.candidates[currentCargo]?.[turnoKey] || [];
            }

            validCandidateKeys.forEach(k => {
                // Usa o fallback getProp(p, k) robusto do app.js para ignorar case da feature properties
                const propertyVal = window.getProp ? window.getProp(p, k) : (p[k] || p[k.toLowerCase()] || p[k.toUpperCase()]);
                const votos = Number(propertyVal) || 0;
                votosValidos += votos;
                if (k === candidatoKey) {
                    votosCandidato = votos;
                }
            });

            if (votosValidos > 0) {
                const pctVotos = (votosCandidato / votosValidos) * 100;

                // Usa window.getProp do app.js (case-insensitive, comprovado funcional)
                const gp = window.getProp || function (p, k) { return p[k]; };
                const locName = gp(p, 'nm_locvot') || gp(p, 'NM_LOCVOT') || gp(p, 'nm_local_votacao') || gp(p, 'NM_LOCAL_VOTACAO');
                const locStr = locName ? String(locName).toUpperCase() : '';

                // Filtro para excluir locais prisionais e de internação juvenil (cujo demográfico da rua não é o dos eleitores de lá)
                const isPrison = locStr && locStr.match(/PRES[IÍ]DIO|PENITENCI[AÁ]RIA|PENINTENCI[AÁ]RIO|PENINTENCI[AÁ]RIA|COMPLEXO PEN|PRIS[AÃ]O|FUNDA[CÇ][AÃ]O CASA|FUND\.\s*CASA|F\.CASA|INTERNA[CÇ][AÃ]O|INTERNATO|CADEIA|PENAL|DETEN[CÇ][AÃ]O|APAC|UI[\s-]|UNID\.\s*DE\s*INT/i);

                if (!isPrison) {
                    const locBairro = gp(p, 'ds_bairro') || gp(p, 'NM_BAIRRO') || gp(p, 'nm_bairro');
                    const locCidade = gp(p, 'nm_localidade') || gp(p, 'NM_LOCALIDADE') || gp(p, 'nm_municipio');
                    const locId = getIseSelectionId(p);

                    rawFeatures.push({
                        id: String(locId),
                        nm: locName ? String(locName) : ('Local ' + locId),
                        bairro: locBairro ? String(locBairro) : '',
                        cidade: locCidade ? String(locCidade) : '',
                        renda, pctSup, esgotoFinal, pctIdade,
                        y: pctVotos,
                        votosCand: votosCandidato,
                        votosVal: votosValidos
                    });
                }
            }
        }
    });

    if (rawFeatures.length === 0) return [];

    // Cálculo absoluto (0 a 100) para o Eixo X
    // Teto de Renda realista para vizinhanças (setores) no Brasil: R$ 6.000
    // (Média acima disso ganha nota máxima de renda)
    const TETO_RENDA = 6000;
    const iDif = maxIdade - minIdade || 1;

    // FIX Bug 5: new Map() removido daqui — é inicializado uma única vez em updateISEPanel
    rawFeatures.forEach(d => {
        const nRenda = Math.min((d.renda / TETO_RENDA) * 100, 100);
        const nSup = d.pctSup;
        const nEsg = d.esgotoFinal;
        const nIdade = ((d.pctIdade - minIdade) / iDif) * 100;

        d.x = (nRenda * 0.40) + (nSup * 0.40) + (nEsg * 0.15) + (nIdade * 0.05);

        if (d.x <= 30) d.t = 'baixo';
        else if (d.x <= 60) d.t = 'medio';
        else d.t = 'alto';

        if (d.id && window.iseDataMap) window.iseDataMap.set(d.id, d.t);
    });

    return rawFeatures;
}

function drawIseChart(container, id, data, candidateName, candidateColor) {
    if (!container || !data || !data.length) return;

    const card = document.createElement('div');
    card.className = 'chart-card';
    card.style.position = 'relative';
    card.style.marginBottom = '20px';
    card.style.padding = '16px';
    card.style.background = 'rgba(255,255,255,0.03)';
    card.style.borderRadius = '8px';
    card.style.border = '1px solid var(--border)';

    card.innerHTML = `
    <div class="chart-header" style="margin-bottom:12px;">
      <div class="chart-title">
        <h3 style="display:flex; align-items:center; gap:8px; margin:0; font-size:15px;">
           <span style="display:inline-block; width:12px; height:12px; border-radius:50%; background:${candidateColor};"></span>
           ${candidateName}
        </h3>
        <span style="font-size:12px; color:var(--muted);">Desempenho x ISE</span>
      </div>
    </div>
    <div class="chart-area" id="chart-${id}" style="position:relative; overflow:hidden;"></div>
    <div class="chart-stats" id="stats-${id}" style="display:flex; gap:16px; margin-top:12px; font-size:12px; color:var(--muted); justify-content:center; flex-wrap:wrap; border-top:1px dashed var(--border); padding-top:12px;"></div>
    <div class="chart-legend" id="legend-${id}" style="display:flex; gap:16px; margin-top:12px; font-size:11px; justify-content:center;"></div>
  `;
    container.appendChild(card);

    const cont = document.getElementById('chart-' + id);
    const W = cont.parentElement.clientWidth;
    const H = Math.min(300, Math.max(220, W * 0.52));
    const mg = { top: 10, right: 14, bottom: 36, left: 42 };
    const w = W - mg.left - mg.right;
    const h = H - mg.top - mg.bottom;

    const svg = d3.select(cont).append('svg').attr('width', W).attr('height', H);
    const g = svg.append('g').attr('transform', `translate(${mg.left},${mg.top})`);

    const xe = d3.extent(data, d => d.x);
    const ye = d3.extent(data, d => d.y);
    const xp = (xe[1] - xe[0]) * .04;
    const yp = (ye[1] - ye[0]) * .06;

    const xSc = d3.scaleLinear().domain([Math.max(0, xe[0] - xp), Math.min(100, xe[1] + xp)]).range([0, w]);
    const ySc = d3.scaleLinear().domain([Math.max(0, ye[0] - yp), Math.min(100, ye[1] + yp)]).range([h, 0]);

    // Grid
    g.selectAll('.gx').data(xSc.ticks(6)).enter().append('line')
        .attr('class', 'grid-line').attr('x1', d => xSc(d)).attr('x2', d => xSc(d)).attr('y1', 0).attr('y2', h)
        .attr('stroke', 'rgba(255,255,255,0.05)').attr('stroke-width', 1);
    g.selectAll('.gy').data(ySc.ticks(5)).enter().append('line')
        .attr('class', 'grid-line').attr('x1', 0).attr('x2', w).attr('y1', d => ySc(d)).attr('y2', d => ySc(d))
        .attr('stroke', 'rgba(255,255,255,0.05)').attr('stroke-width', 1);

    // Axes
    g.append('g').attr('transform', `translate(0,${h})`)
        .call(d3.axisBottom(xSc).ticks(6).tickSize(0))
        .call(a => { a.select('.domain').attr('stroke', 'var(--border)'); a.selectAll('.tick text').attr('fill', 'var(--muted)').attr('dy', '1.2em'); });
    g.append('g')
        .call(d3.axisLeft(ySc).ticks(5).tickSize(0))
        .call(a => { a.select('.domain').attr('stroke', 'var(--border)'); a.selectAll('.tick text').attr('fill', 'var(--muted)').attr('dx', '-.4em'); });

    // Labels
    g.append('text').attr('fill', 'var(--muted)').attr('font-size', '11px').attr('x', w / 2).attr('y', h + 30).attr('text-anchor', 'middle').text('Índice Socioeconômico →');
    g.append('text').attr('fill', 'var(--muted)').attr('font-size', '11px').attr('transform', 'rotate(-90)').attr('x', -h / 2).attr('y', -34).attr('text-anchor', 'middle').text('% Votos Válidos →');

    // Trend line
    const reg = linReg(data);
    const x0 = xSc.domain()[0], x1 = xSc.domain()[1];
    const y0c = Math.max(0, Math.min(100, reg.slope * x0 + reg.intercept));
    const y1c = Math.max(0, Math.min(100, reg.slope * x1 + reg.intercept));
    g.append('line')
        .attr('class', 'trend-line')
        .attr('x1', xSc(x0))
        .attr('x2', xSc(x1))
        .attr('y1', ySc(Math.max(0, Math.min(100, y0c))))
        .attr('y2', ySc(Math.max(0, Math.min(100, y1c))))
        .attr('stroke', candidateColor)
        .attr('stroke-width', 2);

    // R² / β
    g.append('text').attr('fill', 'var(--text)').attr('font-size', '12px').attr('font-weight', 'bold').attr('x', w - 4).attr('y', 14).attr('text-anchor', 'end')
        .text(`r²=${reg.r2.toFixed(3)}  β=${reg.slope >= 0 ? '+' : ''}${reg.slope.toFixed(3)}`);

    // Points
    ISE_TERCIL_ORDER.forEach(t => {
        g.selectAll(null).data(data.filter(d => d.t === t)).enter().append('circle')
            .attr('cx', d => xSc(d.x)).attr('cy', d => ySc(d.y))
            .attr('r', 2.8)
            .attr('fill', ISE_COLORS[t]).attr('fill-opacity', .6)
            .attr('stroke', '#000').attr('stroke-width', 0.5).attr('stroke-opacity', 0.4)
            .on('mouseover', (e, d) => showIseTT(e, d))
            .on('mousemove', e => moveIseTT(e))
            .on('mouseout', () => hideIseTT());
    });

    // Legend
    const legEl = document.getElementById('legend-' + id);
    if (legEl) {
        const counts = { baixo: 0, medio: 0, alto: 0 };
        data.forEach(d => counts[d.t]++);

        const currentFilter = window.STATE && window.STATE.iseFilter ? window.STATE.iseFilter : 'all';

        legEl.innerHTML = ISE_TERCIL_ORDER.map(t => {
            const isActive = currentFilter === 'all' || currentFilter === t;
            const opacity = isActive ? '1' : '0.4';
            const fontWeight = currentFilter === t ? 'bold' : 'normal';

            return `<div class="legend-item" 
                 onclick="window.toggleIseFilter('${t}')" 
                 style="display:flex; align-items:center; gap:4px; cursor:pointer; opacity:${opacity}; font-weight:${fontWeight}; padding:4px; border-radius:4px; transition:all 0.2s;"
                 onmouseover="this.style.background='rgba(255,255,255,0.1)'" 
                 onmouseout="this.style.background='transparent'">
                <div class="legend-dot" style="width:10px; height:10px; border-radius:50%; background:${ISE_COLORS[t]}; box-shadow: 0 0 2px rgba(0,0,0,0.5)"></div>
                ${ISE_LABELS[t]} 
                <span class="legend-count" style="color:var(--muted); font-weight:normal;">(${counts[t]})</span>
                </div>`;
        }).join('');
    }

    // Stats
    const stEl = document.getElementById('stats-' + id);
    if (stEl) {
        const means = {};
        ISE_TERCIL_ORDER.forEach(t => {
            const vData = data.filter(d => d.t === t);
            let totalCand = 0;
            let totalVal = 0;
            vData.forEach(d => {
                totalCand += d.votosCand || 0;
                totalVal += d.votosVal || 0;
            });
            means[t] = totalVal > 0 ? ((totalCand / totalVal) * 100).toFixed(1) : '—';
        });
        // Média ponderada pelo índice X (locais com ISE mais alto pesam mais)
        let numW = 0, denW = 0;
        data.forEach(d => {
            const w = (d.votosVal || 0) * (d.x / 100);
            numW += (d.votosCand || 0) * (d.x / 100);
            denW += w;
        });
        const mediaGeral = denW > 0 ? ((numW / denW) * 100).toFixed(1) : '—';

        stEl.innerHTML = `
      <div class="chart-stat">Cl. baixa: <span style="font-weight:700; color:var(--text);">${means.baixo}%</span></div>
      <div class="chart-stat">Cl. média: <span style="font-weight:700; color:var(--text);">${means.medio}%</span></div>
      <div class="chart-stat">Cl. alta: <span style="font-weight:700; color:var(--text);">${means.alto !== '—' ? means.alto + '%' : '—'}</span></div>
      <div class="chart-stat" style="border-left:1px solid var(--border);padding-left:10px;margin-left:4px;" title="Desempenho médio ponderado pelo ISE do local — locais com índice mais alto pesam mais">
        Méd. ponderada: <span style="font-weight:700;color:${candidateColor};">${mediaGeral !== '—' ? mediaGeral + '%' : '—'}</span>
      </div>
      <div class="chart-stat" style="margin-left:auto;">Coef(β): <span style="font-weight:700; color:${reg.slope >= 0 ? '#88c0d0' : '#bf616a'};">${reg.slope >= 0 ? '+' : ''}${reg.slope.toFixed(3)}</span></div>`;
    }
}

// Expõe a função para ser chamada pelo app.js
window.updateISEPanel = function (currentLayer, currentCargo, currentTurno = 1) {
    const chartsContainer = document.getElementById('iseChartsContent');
    const tabsContainer = document.getElementById('iseTurnTabs');
    if (!chartsContainer) return;

    // Sempre salva os últimos args para poder re-renderizar ao abrir o painel
    window._isePendingArgs = { currentLayer, currentCargo, currentTurno };

    // Se o painel ISE está colapsado, não renderiza agora (D3 não consegue medir width=0)
    // O onclick do header vai chamar updateISEPanel novamente ao expandir
    const iseBox = document.getElementById('iseBoxContainer');
    if (iseBox && iseBox.classList.contains('collapsed')) {
        return;
    }

    // Pegar features a partir do layer atual ativo no mapa (que já passou pelos filtros!)
    if (!currentLayer) {
        chartsContainer.innerHTML = '<div style="text-align:center; padding:20px; color:var(--muted); font-size:13px;">Realize uma análise (Geral ou Municipal) no mapa.</div>';
        if (tabsContainer) tabsContainer.innerHTML = '';
        return;
    }

    // Deputados têm estrutura de dados completamente diferente — delega para função própria
    if (_isLegislativeISECargo(currentCargo)) {
        _updateISEPanelDeputy(chartsContainer, tabsContainer, currentCargo);
        return;
    }

    const baseFeatures = (typeof window.getCurrentVisibleFeatures === 'function' && currentLayer === window.currentLayer)
        ? (window.getCurrentVisibleFeatures() || [])
        : [];
    const features = [];
    const pushFeatureIfEligible = (f) => {
        if (!f) return;
        const p = f.properties;
        if (!p) return;

        const gp = window.getProp || function (p, k) { return p[k]; };
        const localId = getIseSelectionId(p);
        const isSelected = window.selectedLocationIDs && window.selectedLocationIDs.size > 0
            ? window.selectedLocationIDs.has(String(localId))
            : true;
        if (!isSelected) return;

        const locName = gp(p, 'nm_locvot') || gp(p, 'NM_LOCVOT') || gp(p, 'nm_local_votacao') || '';
        const locStr = locName ? String(locName).toUpperCase() : '';
        const isPrison = locStr && locStr.match(/PRES[IÍ]DIO|PENITENCI[AÁ]RIA|PENINTENCI[AÁ]RIO|PENINTENCI[AÁ]RIA|COMPLEXO PEN|PRIS[AÃ]O|FUNDA[CÇ][AÃ]O CASA|FUND\.\s*CASA|F\.CASA|INTERNA[CÇ][AÃ]O|INTERNATO|CADEIA|PENAL|DETEN[CÇ][AÃ]O|APAC|UI[\s-]|UNID\.\s*DE\s*INT/i);
        if (isPrison) return;

        let possessesCensus = false;
        for (const k in p) {
            if (k.toLowerCase() === 'renda media' || k.toLowerCase() === 'renda média' || k.toLowerCase() === 'renda') {
                if (p[k] > 0) possessesCensus = true;
            }
        }
        if (possessesCensus) features.push(f);
    };

    if (baseFeatures.length) {
        baseFeatures.forEach(pushFeatureIfEligible);
    } else {
        currentLayer.eachLayer(layer => pushFeatureIfEligible(layer.feature));
    }

    if (features.length < 5) {
        chartsContainer.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted); font-size:13px;">Sem dados socioeconômicos suficientes para a região selecionada (${features.length} locais de votação com dados censitários).</div>`;
        if (tabsContainer) tabsContainer.innerHTML = '';
        return;
    }

    // Obter candidatos válidos do app.js (STATE)
    let validCandidateKeys = [];
    if (window.STATE && window.STATE.candidates && currentCargo) {
        // currentTurno vem do app.js agora (1 ou 2)
        const turnoKey = (currentTurno === 2 && window.STATE.dataHas2T[currentCargo]) ? '2T' : '1T';
        validCandidateKeys = window.STATE.candidates[currentCargo]?.[turnoKey] || [];

        // Opcional: Filtrar inaptos se necessário
        if (window.STATE.filterInaptos && window.STATE.inaptos[currentCargo]?.[turnoKey]) {
            validCandidateKeys = validCandidateKeys.filter(k => !window.STATE.inaptos[currentCargo][turnoKey].includes(k));
        }
    }

    // Identificar os candidatos presentes baseados na lista oficial
    const candidatosTotals = {};
    features.forEach(f => {
        const p = f.properties;
        validCandidateKeys.forEach(key => {
            // Usa getProp robusto
            const val = window.getProp ? window.getProp(p, key) : (p[key] || p[key.toLowerCase()] || p[key.toUpperCase()]);
            const votos = Number(val) || 0;
            if (votos > 0) {
                if (!candidatosTotals[key]) candidatosTotals[key] = 0;
                candidatosTotals[key] += votos;
            }
        });
    });

    // --- Inicializa estado do filtro de candidatos ISE ---
    if (!window.ISE_CAND_STATE) window.ISE_CAND_STATE = {};

    // Todos os candidatos com votos (para busca de extras), ordenados por votos
    const allKeys = Object.keys(candidatosTotals)
        .sort((a, b) => candidatosTotals[b] - candidatosTotals[a]);

    if (allKeys.length === 0) {
        chartsContainer.innerHTML = '<div style="text-align:center; padding:20px; color:var(--muted); font-size:13px;">Nenhum candidato com votos na seleção.</div>';
        if (tabsContainer) tabsContainer.innerHTML = '';
        return;
    }

    // Top 5 para exibição padrão (referência interna, não mais usado em keysToRender)
    const topKeys = allKeys.slice(0, 5);

    // Resolve metadata para TODOS os candidatos com votos (necessário para busca)
    const candMetas = {};
    allKeys.forEach(key => {
        let name = key.replace(/votos_/i, '').toUpperCase();
        let color = '#777777';
        let candMeta = null;
        if (typeof window.parseCandidateKey === 'function') candMeta = window.parseCandidateKey(key);
        if (candMeta) {
            name = candMeta.nome;
            if (window.getColorForCandidate) color = window.getColorForCandidate(candMeta.nome, candMeta.partido);
            else if (window.PARTY_COLORS && window.PARTY_COLORS[candMeta.partido]) color = window.PARTY_COLORS[candMeta.partido];
        } else if (window.candidatesMetadata && window.candidatesMetadata[key]) {
            if (window.candidatesMetadata[key].urna) name = window.candidatesMetadata[key].urna;
            if (window.candidatesMetadata[key].color) color = window.candidatesMetadata[key].color;
        } else if (window.PARTY_COLORS) {
            const words = name.split(' ');
            const firstWord = words[0], lastWord = words[words.length - 1];
            if (window.PARTY_COLORS[firstWord]) color = window.PARTY_COLORS[firstWord];
            else if (window.PARTY_COLORS[lastWord]) color = window.PARTY_COLORS[lastWord];
        }
        candMetas[key] = { name, color };
    });

    // Signature baseia-se em TODOS os candidatos para detectar mudança de eleição/turno
    const keysSignature = allKeys.join(',');
    if (window.ISE_CAND_STATE.signature !== keysSignature) {
        // Padrão: modo 'select', ativos = os 3 primeiros
        const defaultActive = new Set(allKeys.slice(0, 3));
        window.ISE_CAND_STATE = {
            signature: keysSignature,
            allKeys,
            mode: 'select',
            active: defaultActive,
            vsVsPair: [allKeys[0], allKeys[1] || allKeys[0]]
        };
    } else {
        // Mantém o estado mas atualiza allKeys caso a lista tenha crescido
        window.ISE_CAND_STATE.allKeys = allKeys;
    }

    // Atualiza pills de modo (apenas Select e ManoaMano)
    const modeMap = { iseModeSelect: 'select', iseModeVsVs: 'vsVs' };
    Object.keys(modeMap).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('active', window.ISE_CAND_STATE.mode === modeMap[id]);
    });

    // Renderiza chips de candidatos
    const chipsEl = document.getElementById('iseCandidateChips');
    const filterEl = document.getElementById('iseCandidateFilter');
    const addCandBox = document.getElementById('iseAddCandBox');
    if (filterEl) filterEl.style.display = allKeys.length > 1 ? 'flex' : 'none';

    if (chipsEl) {
        const mode = window.ISE_CAND_STATE.mode;
        chipsEl.innerHTML = '';

        if (mode === 'select') {
            // Chips de todos os candidatos ativos (active set — pode incluir candidatos além do top5)
            const activeKeys = allKeys.filter(k => window.ISE_CAND_STATE.active.has(k));
            activeKeys.forEach(key => {
                const { name, color } = candMetas[key];
                const chip = document.createElement('div');
                chip.className = 'ise-cand-chip';
                chip.style.cssText = `border-color:${color}; color:${color}; background:${color}25; cursor:pointer;`;
                chip.innerHTML = `${name} <span class="chip-x" title="Remover">✕</span>`;
                chip.querySelector('.chip-x').onclick = (e) => {
                    e.stopPropagation();
                    if (window.ISE_CAND_STATE.active.size > 1) {
                        window.ISE_CAND_STATE.active.delete(key);
                        const _p = window._isePendingArgs || {}; window.updateISEPanel(_p.currentLayer || window.currentLayer, _p.currentCargo || window.currentCargo, _p.currentTurno || window.currentTurno || 1);
                    }
                };
                chipsEl.appendChild(chip);
            });

            // Botão "+" para abrir busca de candidato extra
            if (allKeys.length > activeKeys.length) {
                const addBtn = document.createElement('div');
                addBtn.className = 'ise-cand-chip';
                addBtn.style.cssText = 'border-color:var(--border); color:var(--muted); background:transparent; cursor:pointer; font-size:18px; padding:2px 10px; line-height:1;';
                addBtn.title = 'Adicionar candidato';
                addBtn.textContent = '+';
                addBtn.onclick = () => {
                    if (addCandBox) {
                        addCandBox.style.display = addCandBox.style.display === 'none' ? 'block' : 'none';
                        const inp = document.getElementById('iseAddCandInput');
                        if (inp) { inp.value = ''; inp.focus(); }
                    }
                };
                chipsEl.appendChild(addBtn);
            }

            // Mostra/esconde campo de busca de extras
            if (addCandBox) addCandBox.style.display = 'none';

            // Configura busca de candidato extra
            _setupIseAddCandSearch(allKeys, candMetas);

        } else if (mode === 'vsVs') {
            // Chips de todos os candidatos com votos (allKeys), com labels A/B
            const [selA, selB] = window.ISE_CAND_STATE.vsVsPair;
            if (addCandBox) addCandBox.style.display = 'none';
            allKeys.forEach(key => {
                const { name, color } = candMetas[key];
                const isA = key === selA, isB = key === selB;
                const label = isA ? 'A' : isB ? 'B' : '';
                const chip = document.createElement('div');
                chip.className = 'ise-cand-chip' + (!isA && !isB ? ' inactive' : '');
                chip.style.cssText = `border-color:${color}; color:${color}; background:${(isA || isB) ? color + '25' : 'transparent'}; cursor:pointer;`;
                chip.innerHTML = `${label ? `<span class="ise-mano-badge">${label}</span> ` : ''}${name}`;
                chip.onclick = () => {
                    let [a, b] = window.ISE_CAND_STATE.vsVsPair;
                    if (key === a) { a = b; b = allKeys.find(k => k !== a) || a; }
                    else if (key === b) { b = allKeys.find(k => k !== a) || a; }
                    else { b = a; a = key; }
                    window.ISE_CAND_STATE.vsVsPair = [a, b];
                    const _p = window._isePendingArgs || {}; window.updateISEPanel(_p.currentLayer || window.currentLayer, _p.currentCargo || window.currentCargo, _p.currentTurno || window.currentTurno || 1);
                };
                chipsEl.appendChild(chip);
            });
        }
    }

    // Determina quais candidatos renderizar com base no modo
    let keysToRender;
    if (window.ISE_CAND_STATE.mode === 'select') {
        keysToRender = allKeys.filter(k => window.ISE_CAND_STATE.active.has(k));
    } else if (window.ISE_CAND_STATE.mode === 'vsVs') {
        const [a, b] = window.ISE_CAND_STATE.vsVsPair;
        keysToRender = a === b ? [a] : [a, b];
    } else {
        keysToRender = allKeys.slice(0, 5);
    }

    // FIX Bug 5 (parte 1): iseDataMap inicializado UMA VEZ aqui, antes do loop de candidatos.
    window.iseDataMap = new Map();

    chartsContainer.innerHTML = '';

    // ── Sincroniza botões de modo de análise ──────────────────────────────────
    enforceIseModeAvailability();
    const analysisMode = window.ISE_FACTOR_STATE?.analysisMode || 'ise';
    const btnISEEl = document.getElementById('iseAnalysisModeISE');
    const btnFactorEl = document.getElementById('iseAnalysisModeFactor');
    const factorBox = document.getElementById('iseFactorSelectorBox');
    if (btnISEEl) btnISEEl.classList.toggle('active', analysisMode === 'ise');
    if (btnFactorEl) btnFactorEl.classList.toggle('active', analysisMode === 'factor');
    if (factorBox) factorBox.style.display = analysisMode === 'factor' ? 'block' : 'none';

    // ── Modo Fator Demográfico ────────────────────────────────────────────────
    if (analysisMode === 'factor') {
        _renderFactorSelector();
        _renderFactorCharts(chartsContainer, features, allKeys, candMetas, currentCargo);
        if (tabsContainer) tabsContainer.innerHTML = '';
        return;
    }

    // ── Modo ISE (padrão) ─────────────────────────────────────────────────────
    keysToRender.forEach((key, index) => {
        const { name, color } = candMetas[key];
        const data = processISEData(features, key, currentCargo);
        if (data.length > 2) {
            drawIseChart(chartsContainer, 'ise-' + index, data, name, color);
        }
    });

    // Mano a mano: renderiza gráfico de diferença se modo vsVs com 2 candidatos distintos
    if (window.ISE_CAND_STATE.mode === 'vsVs') {
        const [keyA, keyB] = window.ISE_CAND_STATE.vsVsPair;
        if (keyA !== keyB) {
            drawIseDiffChart(chartsContainer, features, keyA, keyB, candMetas[keyA], candMetas[keyB], currentCargo);
        }
    }

    if (tabsContainer) {
        tabsContainer.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:11px; color:var(--muted); margin-bottom:8px; display:inline-block;">Desempenho Real nas Classes (% do candidato sobre os votos válidos deste grupo):</span>
            ${(window.STATE && window.STATE.iseFilter && window.STATE.iseFilter !== 'all') ?
                `<button onclick="window.toggleIseFilter('all')" style="background:transparent; border:1px solid var(--border); color:var(--muted); font-size:10px; padding:2px 6px; border-radius:4px; cursor:pointer; margin-bottom:8px;">Limpar Filtro Mapa</button>` : ''}
            </div>`;
    }
};

// ============================================================
//  ISE PARA DEPUTADOS (Federal / Estadual)
//  Estrutura completamente diferente: dados em STATE.deputyResults
// ============================================================

// Estado separado para o painel ISE de deputados
if (!window.ISE_DEP_STATE) window.ISE_DEP_STATE = {
    mode: 'candidate',   // 'candidate' | 'party'
    subMode: 'select',   // 'select' | 'vsVs'
    // Modo candidato
    activeCands: [],     // até 5 candidateIds
    vsPair: [null, null],
    // Modo partido
    activeParties: [],   // até 5 siglas
    vsPartyPair: [null, null],
    // Contexto da última análise
    cargo: null,
    searchQuery: '',
};

function _updateISEPanelDeputy(chartsContainer, tabsContainer, cargo) {
    const cfg = _getLegislativeISEConfig(cargo);
    const STATE = window.STATE;
    if (!Object.keys(cfg.resultsStore || {}).length || !Object.keys(cfg.metadataStore || {}).length) {
        chartsContainer.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px;">Dados de deputados não carregados ainda.</div>';
        return;
    }

    const typeKey = cfg.typeKey;
    const s = window.ISE_DEP_STATE;

    // Reseta estado se mudou o cargo
    if (s.cargo !== cargo) {
        s.cargo = cargo;
        s.activeCands = [];
        s.vsPair = [null, null];
        s.activeParties = [];
        s.vsPartyPair = [null, null];
    }

    // ── Sincroniza botões de modo de análise ──────────────────────────────────
    enforceIseModeAvailability();
    const analysisMode = window.ISE_FACTOR_STATE?.analysisMode || 'ise';
    const btnISEEl = document.getElementById('iseAnalysisModeISE');
    const btnFactorEl = document.getElementById('iseAnalysisModeFactor');
    const factorBox = document.getElementById('iseFactorSelectorBox');
    if (btnISEEl) btnISEEl.classList.toggle('active', analysisMode === 'ise');
    if (btnFactorEl) btnFactorEl.classList.toggle('active', analysisMode === 'factor');
    if (factorBox) factorBox.style.display = analysisMode === 'factor' ? 'block' : 'none';

    // Renderiza UI de controles do painel de deputados
    _renderDeputyISEControls(chartsContainer, tabsContainer, cargo, typeKey, analysisMode);
}

function _getDeputyLocalKey(props) {
    return _getLegislativeISEConfig().getLocalKey(props);
}

// Coleta votos por candidato individual para cada feature (local de votação)
// Retorna array de { locKey, props, candVotes: {id: votes}, totalVotes }
function _collectDeputyFeatureVotes(currentLayer, typeKey) {
    const cfg = _getLegislativeISEConfig();
    const rows = [];
    const baseFeatures = (typeof window.getCurrentVisibleFeatures === 'function' && currentLayer === window.currentLayer)
        ? (window.getCurrentVisibleFeatures() || [])
        : null;
    const iterate = (callback) => {
        if (baseFeatures && baseFeatures.length) {
            baseFeatures.forEach(callback);
        } else {
            currentLayer.eachLayer(layer => callback(layer.feature));
        }
    };
    iterate((feature) => {
        if (!feature) return;
        const p = feature.properties;
        const key = cfg.getLocalKey(p);
        if (!key) return;
        const res = cfg.resultsStore[key];
        if (!res || !res[typeKey]) return;
        const gp = window.getProp || ((p, k) => p[k]);
        const locId = getIseSelectionId(p);
        // Verifica seleção
        if (window.selectedLocationIDs && window.selectedLocationIDs.size > 0) {
            if (!window.selectedLocationIDs.has(locId)) return;
        }
        const candVotes = res[typeKey];
        let total = 0;
        for (const [cand, v] of Object.entries(candVotes)) {
            if (cand !== '95' && cand !== '96') total += parseInt(v) || 0;
        }
        if (total > 0) rows.push({ key, props: p, candVotes, totalVotes: total });
    });
    return rows;
}

// Agrega votos por partido por feature
function _buildPartyVotesPerFeature(rows, typeKey) {
    const cfg = _getLegislativeISEConfig();
    const result = []; // { key, props, partyVotes: {sigla: votes}, totalVotes }
    rows.forEach(({ key, props, candVotes, totalVotes }) => {
        const partyVotes = {};
        for (const [cand, v] of Object.entries(candVotes)) {
            if (cand === '95' || cand === '96') continue;
            const meta = cfg.metadataStore[cand];
            const party = meta ? (meta[1] || 'N/D').toUpperCase() : 'N/D';
            partyVotes[party] = (partyVotes[party] || 0) + (parseInt(v) || 0);
        }
        result.push({ key, props, partyVotes, totalVotes });
    });
    return result;
}

// Calcula ISE para uma série de pontos: recebe features array e uma função getVotes(props) -> {votos_cand, votos_total}
function _buildISEDataDeputy(currentLayer, getVotesFn) {
    const STATE = window.STATE;
    const gp = window.getProp || ((p, k) => p[k]);
    const rawFeatures = [];
    let minIdade = Infinity, maxIdade = -Infinity;
    const baseFeatures = (typeof window.getCurrentVisibleFeatures === 'function' && currentLayer === window.currentLayer)
        ? (window.getCurrentVisibleFeatures() || [])
        : null;
    const iterate = (callback) => {
        if (baseFeatures && baseFeatures.length) {
            baseFeatures.forEach(callback);
        } else {
            currentLayer.eachLayer(layer => callback(layer.feature));
        }
    };

    iterate((feature) => {
        if (!feature) return;
        const p = feature.properties;
        const locId = getIseSelectionId(p);
        if (window.selectedLocationIDs && window.selectedLocationIDs.size > 0) {
            if (!window.selectedLocationIDs.has(locId)) return;
        }

        const renda = getPropVal(p, ['Renda Media', 'RENDA MEDIA', 'renda']);
        if (renda <= 0) return;

        const { votosCand, votosTotal } = getVotesFn(p);
        if (votosTotal <= 0) return;

        const locName = gp(p, 'nm_locvot') || gp(p, 'NM_LOCVOT') || '';
        const locStr = String(locName).toUpperCase();
        const isPrison = locStr.match(/PRES[IÍ]DIO|PENITENCI[AÁ]RIA|COMPLEXO PEN|PRIS[AÃ]O|FUNDA[CÇ][AÃ]O CASA|CADEIA|PENAL|DETEN[CÇ][AÃ]O/i);
        if (isPrison) return;

        const esgGeral = getPropVal(p, ['Pct Esgoto Rede Geral']);
        const esgFossa = getPropVal(p, ['Pct Fossa Septica', 'Pct Fossa Séptica']);
        const esgInad = getPropVal(p, ['Pct Esgoto Inadequado']);
        const esqTotal = esgGeral + esgFossa + esgInad;
        const esgotoFinal = esqTotal > 0 ? (esgGeral / esqTotal) * 100 : (esgGeral > 0 ? esgGeral : 0);

        const supComp = getPropVal(p, ['ENSINO SUPERIOR COMPLETO', 'SUPERIOR COMPLETO', 'Superior Completo']);
        const analf = getPropVal(p, ['ANALFABETO', 'Analfabeto']);
        const le = getPropVal(p, ['LÊ E ESCREVE', 'LE E ESCREVE']);
        const fi = getPropVal(p, ['ENSINO FUNDAMENTAL INCOMPLETO', 'FUNDAMENTAL INCOMPLETO']);
        const fc = getPropVal(p, ['ENSINO FUNDAMENTAL COMPLETO', 'FUNDAMENTAL COMPLETO']);
        const mi = getPropVal(p, ['ENSINO MÉDIO INCOMPLETO', 'MEDIO INCOMPLETO']);
        const mc = getPropVal(p, ['ENSINO MÉDIO COMPLETO', 'MEDIO COMPLETO']);
        const si = getPropVal(p, ['ENSINO SUPERIOR INCOMPLETO', 'SUPERIOR INCOMPLETO']);
        const totalEsc = supComp + analf + le + fi + fc + mi + mc + si;
        const pctSup = totalEsc > 0 ? (supComp / totalEsc) * 100 : 0;

        let idade25_59 = 0, totalIdade = 0;
        for (const key in p) {
            if (key.match(/anos/i) && !key.match(/^Pct/i)) {
                const v = Number(p[key]) || 0;
                const match = key.match(/(\d+)/);
                if (match) {
                    const age = parseInt(match[1]);
                    totalIdade += v;
                    if (age >= 25 && age <= 59) idade25_59 += v;
                }
            }
        }
        const pctIdade = totalIdade > 0 ? (idade25_59 / totalIdade) * 100 : 0;
        minIdade = Math.min(minIdade, pctIdade);
        maxIdade = Math.max(maxIdade, pctIdade);

        rawFeatures.push({
            id: locId,
            nm: locName ? String(locName) : ('Local ' + locId),
            bairro: String(gp(p, 'ds_bairro') || gp(p, 'NM_BAIRRO') || ''),
            cidade: String(gp(p, 'nm_localidade') || gp(p, 'NM_LOCALIDADE') || gp(p, 'nm_municipio') || ''),
            renda, pctSup, esgotoFinal, pctIdade,
            y: (votosCand / votosTotal) * 100,
            votosCand, votosVal: votosTotal
        });
    });

    if (rawFeatures.length === 0) return [];

    const TETO_RENDA = 6000;
    const iDif = maxIdade - minIdade || 1;
    rawFeatures.forEach(d => {
        const nRenda = Math.min((d.renda / TETO_RENDA) * 100, 100);
        d.x = (nRenda * 0.40) + (d.pctSup * 0.40) + (d.esgotoFinal * 0.15) + (((d.pctIdade - minIdade) / iDif) * 100 * 0.05);
        if (d.x <= 30) d.t = 'baixo';
        else if (d.x <= 60) d.t = 'medio';
        else d.t = 'alto';
        if (d.id && window.iseDataMap) window.iseDataMap.set(d.id, d.t);
    });
    return rawFeatures;
}

// Renderiza os controles do painel ISE para deputados
function _renderDeputyISEControls(chartsContainer, tabsContainer, cargo, typeKey, analysisMode) {
    const STATE = window.STATE;
    const s = window.ISE_DEP_STATE;
    const cfg = _getLegislativeISEConfig(cargo);
    const p = window._isePendingArgs || {};
    const currentLayer = p.currentLayer || window.currentLayer;
    if (!currentLayer) return;

    // ---- TABS modo candidato / partido ----
    const filterEl = document.getElementById('iseCandidateFilter');
    if (filterEl) filterEl.style.display = 'none'; // esconde o filtro padrão

    // Usa tabsContainer para os controles de deputado
    if (tabsContainer) {
        tabsContainer.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:4px;">
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <div class="ise-mode-pills" style="flex-shrink:0;">
              <button class="ise-mode-pill ${s.mode === 'candidate' ? 'active' : ''}" onclick="window._setDepISEMode('candidate')">Candidatos</button>
              <button class="ise-mode-pill ${s.mode === 'party' ? 'active' : ''}" onclick="window._setDepISEMode('party')">Partidos</button>
            </div>
            <div class="ise-mode-pills" style="flex-shrink:0;">
              <button class="ise-mode-pill ${s.subMode === 'select' ? 'active' : ''}" onclick="window._setDepISESubMode('select')">Selecionar</button>
              <button class="ise-mode-pill ${s.subMode === 'vsVs' ? 'active' : ''}" onclick="window._setDepISESubMode('vsVs')">Mano a Mano</button>
            </div>
          </div>
          ${s.mode === 'candidate' ? _renderCandChipsHTML(typeKey) : _renderPartyChipsHTML(typeKey)}
        </div>`;
    }

    if (tabsContainer) {
        if (s.mode === 'candidate') _setupDepCandSearch(typeKey);
        else _setupDepPartySearch(typeKey);
    }

    // ---- Renderiza gráficos ----
    chartsContainer.innerHTML = '';
    window.iseDataMap = new Map();

    // ── Modo Fator Demográfico ────────────────────────────────────────────────
    if (analysisMode === 'factor') {
        if (typeof _renderFactorSelector === 'function') _renderFactorSelector();
        _renderDeputyFactorCharts(chartsContainer, currentLayer, typeKey, cargo);
        return;
    }

    if (s.mode === 'candidate') {
        const keysToRender = s.subMode === 'vsVs'
            ? (s.vsPair[0] && s.vsPair[1] && s.vsPair[0] !== s.vsPair[1] ? s.vsPair : [s.vsPair[0]].filter(Boolean))
            : s.activeCands;

        if (keysToRender.length === 0) {
            chartsContainer.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px;">Busque e adicione candidatos para visualizar o gráfico ISE.</div>';
            return;
        }

        keysToRender.forEach((candId, idx) => {
            const meta = cfg.metadataStore[candId] || [candId, '?', '?'];
            const name = meta[0] ? String(meta[0]).split('|')[0].trim() : candId;
            const party = (meta[1] || '').toUpperCase();
            const color = window.colorForParty ? window.colorForParty(party) : (window.PARTY_COLORS?.get(party) || '#777');

            const data = _buildISEDataDeputy(currentLayer, (props) => {
                const key = cfg.getLocalKey(props);
                if (!key) return { votosCand: 0, votosTotal: 0 };
                const res = cfg.resultsStore[key];
                if (!res || !res[typeKey]) return { votosCand: 0, votosTotal: 0 };
                let votosCand = 0, votosTotal = 0;
                for (const [cand, v] of Object.entries(res[typeKey])) {
                    if (cand === '95' || cand === '96') continue;
                    const vi = parseInt(v) || 0;
                    votosTotal += vi;
                    if (cand === candId) votosCand = vi;
                }
                return { votosCand, votosTotal };
            });

            if (data.length > 2) drawIseChart(chartsContainer, `dep-${idx}`, data, name, color);
        });

        if (s.subMode === 'vsVs' && s.vsPair[0] && s.vsPair[1] && s.vsPair[0] !== s.vsPair[1]) {
            const [idA, idB] = s.vsPair;
            const metaA = cfg.metadataStore[idA] || [idA, '?'];
            const metaB = cfg.metadataStore[idB] || [idB, '?'];
            const nameA = String(metaA[0]).split('|')[0].trim();
            const nameB = String(metaB[0]).split('|')[0].trim();
            const colorA = window.colorForParty ? window.colorForParty(metaA[1]) : '#4a9eff';
            const colorB = window.colorForParty ? window.colorForParty(metaB[1]) : '#ff6b4a';
            drawIseDiffChart(chartsContainer, null, idA, idB,
                { name: nameA, color: colorA }, { name: nameB, color: colorB }, cargo,
                // override: passa getVotesFn via closure
                (feat, candId) => {
                    const key = cfg.getLocalKey(feat.properties);
                    if (!key) return { votosCand: 0, votosTotal: 0 };
                    const res = cfg.resultsStore[key];
                    if (!res || !res[typeKey]) return { votosCand: 0, votosTotal: 0 };
                    let votosCand = 0, votosTotal = 0;
                    for (const [cand, v] of Object.entries(res[typeKey])) {
                        if (cand === '95' || cand === '96') continue;
                        const vi = parseInt(v) || 0;
                        votosTotal += vi;
                        if (cand === candId) votosCand = vi;
                    }
                    return { votosCand, votosTotal };
                }
            );
        }

    } else {
        // Modo Partido
        const keysToRender = s.subMode === 'vsVs'
            ? (s.vsPartyPair[0] && s.vsPartyPair[1] && s.vsPartyPair[0] !== s.vsPartyPair[1] ? s.vsPartyPair : [s.vsPartyPair[0]].filter(Boolean))
            : s.activeParties;

        if (keysToRender.length === 0) {
            chartsContainer.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px;">Adicione partidos para visualizar o gráfico ISE.</div>';
            return;
        }

        keysToRender.forEach((party, idx) => {
            const color = window.colorForParty ? window.colorForParty(party) : (window.PARTY_COLORS?.get(party) || '#777');

            const data = _buildISEDataDeputy(currentLayer, (props) => {
                const key = cfg.getLocalKey(props);
                if (!key) return { votosCand: 0, votosTotal: 0 };
                const res = cfg.resultsStore[key];
                if (!res || !res[typeKey]) return { votosCand: 0, votosTotal: 0 };
                let votosCand = 0, votosTotal = 0;
                for (const [cand, v] of Object.entries(res[typeKey])) {
                    if (cand === '95' || cand === '96') continue;
                    const vi = parseInt(v) || 0;
                    votosTotal += vi;
                    const meta = cfg.metadataStore[cand];
                    if (meta && (meta[1] || '').toUpperCase() === party) votosCand += vi;
                }
                return { votosCand, votosTotal };
            });

            if (data.length > 2) drawIseChart(chartsContainer, `dep-party-${idx}`, data, party, color);
        });

        if (s.subMode === 'vsVs' && s.vsPartyPair[0] && s.vsPartyPair[1] && s.vsPartyPair[0] !== s.vsPartyPair[1]) {
            const [pA, pB] = s.vsPartyPair;
            const colorA = window.colorForParty ? window.colorForParty(pA) : '#4a9eff';
            const colorB = window.colorForParty ? window.colorForParty(pB) : '#ff6b4a';
            drawIseDiffChart(chartsContainer, null, pA, pB,
                { name: pA, color: colorA }, { name: pB, color: colorB }, cargo,
                (feat, party) => {
                    const key = cfg.getLocalKey(feat.properties);
                    if (!key) return { votosCand: 0, votosTotal: 0 };
                    const res = cfg.resultsStore[key];
                    if (!res || !res[typeKey]) return { votosCand: 0, votosTotal: 0 };
                    let votosCand = 0, votosTotal = 0;
                    for (const [cand, v] of Object.entries(res[typeKey])) {
                        if (cand === '95' || cand === '96') continue;
                        const vi = parseInt(v) || 0;
                        votosTotal += vi;
                        const meta = cfg.metadataStore[cand];
                        if (meta && (meta[1] || '').toUpperCase() === party) votosCand += vi;
                    }
                    return { votosCand, votosTotal };
                }
            );
        }
    }
}

// Versão para deputados do processFactorData — lê votos de STATE.deputyResults
function _processDeputyFactorData(currentLayer, typeKey, getVotesFn, factorDef) {
    const gp = window.getProp || ((p, k) => p[k]);
    const rawPoints = [];
    const baseFeatures = (typeof window.getCurrentVisibleFeatures === 'function' && currentLayer === window.currentLayer)
        ? (window.getCurrentVisibleFeatures() || [])
        : null;
    const iterate = (callback) => {
        if (baseFeatures && baseFeatures.length) {
            baseFeatures.forEach(callback);
        } else {
            currentLayer.eachLayer(layer => callback(layer.feature));
        }
    };

    iterate((feature) => {
        if (!feature) return;
        const p = feature.properties;
        const locId = getIseSelectionId(p);

        // Filtro de seleção
        if (window.selectedLocationIDs && window.selectedLocationIDs.size > 0) {
            if (!window.selectedLocationIDs.has(locId)) return;
        }

        // Prisões
        const locName = gp(p, 'nm_locvot') || gp(p, 'NM_LOCVOT') || '';
        if (String(locName).toUpperCase().match(/PRES[IÍ]DIO|PENITENCI[AÁ]RIA|COMPLEXO PEN|CADEIA|PENAL|DETEN[CÇ][AÃ]O/i)) return;

        // Valor do fator demográfico
        const factorVal = _getFactorValue(p, factorDef);
        if (factorVal < 0) return;

        // Votos via closure
        const { votosCand, votosTotal } = getVotesFn(p);
        if (votosTotal <= 0) return;

        rawPoints.push({
            id: locId,
            nm: locName ? String(locName) : ('Local ' + locId),
            bairro: String(gp(p, 'ds_bairro') || gp(p, 'NM_BAIRRO') || ''),
            cidade: String(gp(p, 'nm_localidade') || gp(p, 'NM_LOCALIDADE') || gp(p, 'nm_municipio') || ''),
            x: Math.min(100, Math.max(0, factorVal)),
            y: (votosCand / votosTotal) * 100,
            votosCand, votosVal: votosTotal,
        });
    });

    if (rawPoints.length === 0) return [];

    // Tercis pelo valor do fator
    const sorted = [...rawPoints].sort((a, b) => a.x - b.x);
    const n = sorted.length;
    const t1 = sorted[Math.floor(n / 3)].x;
    const t2 = sorted[Math.floor((2 * n) / 3)].x;
    rawPoints.forEach(d => {
        d.t = d.x <= t1 ? 'baixo' : d.x <= t2 ? 'medio' : 'alto';
    });
    return rawPoints;
}

// Renderiza gráficos de Fator Demográfico para deputados (candidatos ou partidos)
function _renderDeputyFactorCharts(chartsContainer, currentLayer, typeKey, cargo) {
    const STATE = window.STATE;
    const cfg = _getLegislativeISEConfig(cargo);
    const s = window.ISE_DEP_STATE;
    const fs = window.ISE_FACTOR_STATE;
    const groupDef = ISE_FACTORS[fs.factorGroupId];
    if (!groupDef) return;
    const factorDef = groupDef.factors.find(f => f.id === fs.factorId);
    if (!factorDef) return;

    const xLabel = factorDef.isCurrency ? 'Renda Média (R$) →' : `${factorDef.label} (%) →`;

    // Função de votos por candidato
    const makeVotesFnCand = (candId) => (props) => {
        const key = cfg.getLocalKey(props);
        if (!key) return { votosCand: 0, votosTotal: 0 };
        const res = cfg.resultsStore[key];
        if (!res || !res[typeKey]) return { votosCand: 0, votosTotal: 0 };
        let votosCand = 0, votosTotal = 0;
        for (const [cand, v] of Object.entries(res[typeKey])) {
            if (cand === '95' || cand === '96') continue;
            const vi = parseInt(v) || 0;
            votosTotal += vi;
            if (cand === candId) votosCand = vi;
        }
        return { votosCand, votosTotal };
    };

    // Função de votos por partido
    const makeVotesFnParty = (party) => (props) => {
        const key = cfg.getLocalKey(props);
        if (!key) return { votosCand: 0, votosTotal: 0 };
        const res = cfg.resultsStore[key];
        if (!res || !res[typeKey]) return { votosCand: 0, votosTotal: 0 };
        let votosCand = 0, votosTotal = 0;
        for (const [cand, v] of Object.entries(res[typeKey])) {
            if (cand === '95' || cand === '96') continue;
            const vi = parseInt(v) || 0;
            votosTotal += vi;
            const meta = cfg.metadataStore[cand];
            if (meta && (meta[1] || '').toUpperCase() === party) votosCand += vi;
        }
        return { votosCand, votosTotal };
    };

    if (s.mode === 'candidate') {
        const keysToRender = s.subMode === 'vsVs'
            ? (s.vsPair[0] && s.vsPair[1] && s.vsPair[0] !== s.vsPair[1] ? s.vsPair : [s.vsPair[0]].filter(Boolean))
            : s.activeCands;

        if (keysToRender.length === 0) {
            chartsContainer.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px;">Busque e adicione candidatos para visualizar.</div>';
            return;
        }

        keysToRender.forEach((candId, idx) => {
            const meta = cfg.metadataStore[candId] || [candId, '?', '?'];
            const name = String(meta[0]).split('|')[0].trim();
            const party = (meta[1] || '').toUpperCase();
            const color = window.colorForParty ? window.colorForParty(party) : '#777';
            const data = _processDeputyFactorData(currentLayer, typeKey, makeVotesFnCand(candId), factorDef);
            if (data.length > 2) drawFactorChart(chartsContainer, `dep-f-${idx}`, data, name, color, xLabel, factorDef.label, groupDef.color, factorDef);
        });

        // Mano a Mano diff
        if (s.subMode === 'vsVs' && s.vsPair[0] && s.vsPair[1] && s.vsPair[0] !== s.vsPair[1]) {
            const [idA, idB] = s.vsPair;
            const metaA = cfg.metadataStore[idA] || [idA, '?'];
            const metaB = cfg.metadataStore[idB] || [idB, '?'];
            const nameA = String(metaA[0]).split('|')[0].trim();
            const nameB = String(metaB[0]).split('|')[0].trim();
            const colorA = window.colorForParty ? window.colorForParty(metaA[1]) : '#4a9eff';
            const colorB = window.colorForParty ? window.colorForParty(metaB[1]) : '#ff6b4a';
            _drawDeputyFactorDiffChart(chartsContainer, currentLayer, typeKey, factorDef, xLabel,
                idA, idB, { name: nameA, color: colorA }, { name: nameB, color: colorB },
                makeVotesFnCand);
        }

    } else {
        // Modo partido
        const keysToRender = s.subMode === 'vsVs'
            ? (s.vsPartyPair[0] && s.vsPartyPair[1] && s.vsPartyPair[0] !== s.vsPartyPair[1] ? s.vsPartyPair : [s.vsPartyPair[0]].filter(Boolean))
            : s.activeParties;

        if (keysToRender.length === 0) {
            chartsContainer.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px;">Adicione partidos para visualizar.</div>';
            return;
        }

        keysToRender.forEach((party, idx) => {
            const color = window.colorForParty ? window.colorForParty(party) : '#777';
            const data = _processDeputyFactorData(currentLayer, typeKey, makeVotesFnParty(party), factorDef);
            if (data.length > 2) drawFactorChart(chartsContainer, `dep-fp-${idx}`, data, party, color, xLabel, factorDef.label, groupDef.color, factorDef);
        });

        if (s.subMode === 'vsVs' && s.vsPartyPair[0] && s.vsPartyPair[1] && s.vsPartyPair[0] !== s.vsPartyPair[1]) {
            const [pA, pB] = s.vsPartyPair;
            const colorA = window.colorForParty ? window.colorForParty(pA) : '#4a9eff';
            const colorB = window.colorForParty ? window.colorForParty(pB) : '#ff6b4a';
            _drawDeputyFactorDiffChart(chartsContainer, currentLayer, typeKey, factorDef, xLabel,
                pA, pB, { name: pA, color: colorA }, { name: pB, color: colorB },
                makeVotesFnParty);
        }
    }

    if (chartsContainer.innerHTML === '') {
        chartsContainer.innerHTML = `<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px;">Nenhum dado disponível para "${factorDef.label}".</div>`;
    }
}

// Gráfico de diferença A−B para deputados no modo fator
function _drawDeputyFactorDiffChart(container, currentLayer, typeKey, factorDef, xLabel, keyA, keyB, metaA, metaB, makeVotesFn) {
    const dataA = _processDeputyFactorData(currentLayer, typeKey, makeVotesFn(keyA), factorDef);
    const dataB = _processDeputyFactorData(currentLayer, typeKey, makeVotesFn(keyB), factorDef);
    if (dataA.length < 3 || dataB.length < 3) return;

    const bMap = new Map();
    dataB.forEach(d => bMap.set(d.id, d));

    const diff = [];
    dataA.forEach(dA => {
        const dB = bMap.get(dA.id);
        if (dB) diff.push({ x: dA.x, y: dA.y - dB.y, t: dA.t, nm: dA.nm, bairro: dA.bairro, cidade: dA.cidade, yA: dA.y, yB: dB.y });
    });
    if (diff.length < 3) return;

    // Reutiliza drawIseDiffChart mas passando diff diretamente — precisa de um mini wrapper
    // que cria o gráfico de diferença com eixo X = fator
    _drawGenericDiffChart(container, diff, metaA, metaB, xLabel);
}

// Gráfico de diferença genérico (eixo X customizável)
function _drawGenericDiffChart(container, diff, metaA, metaB, xLabel) {
    const card = document.createElement('div');
    card.className = 'chart-card';
    card.style.cssText = 'position:relative;margin-bottom:20px;padding:16px;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid var(--border);';

    card.innerHTML = `
    <div style="margin-bottom:12px;">
      <h3 style="display:flex;align-items:center;gap:8px;margin:0;font-size:14px;">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${metaA.color};"></span>${metaA.name}
        <span style="color:var(--muted);font-size:12px;">vs</span>
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${metaB.color};"></span>${metaB.name}
      </h3>
      <span style="font-size:12px;color:var(--muted);">Diferença A − B por ${xLabel.replace(' →', '')}</span>
    </div>
    <div id="diff-dep-f-chart" style="position:relative;overflow:hidden;"></div>
    <div id="diff-dep-f-stats" style="display:flex;gap:12px;margin-top:10px;font-size:11px;color:var(--muted);justify-content:center;flex-wrap:wrap;border-top:1px dashed var(--border);padding-top:10px;"></div>`;

    container.appendChild(card);

    const cont = card.querySelector('#diff-dep-f-chart');
    const W = cont.parentElement.clientWidth;
    const H = Math.min(280, Math.max(200, W * 0.45));
    const mg = { top: 14, right: 14, bottom: 36, left: 46 };
    const w = W - mg.left - mg.right;
    const h = H - mg.top - mg.bottom;

    const svg = d3.select(cont).append('svg').attr('width', W).attr('height', H);
    const g = svg.append('g').attr('transform', `translate(${mg.left},${mg.top})`);

    const xe = d3.extent(diff, d => d.x);
    const ye = d3.extent(diff, d => d.y);
    const xp = Math.max((xe[1] - xe[0]) * .04, 1), yp = Math.max((ye[1] - ye[0]) * .06, 1);
    const xSc = d3.scaleLinear().domain([Math.max(0, xe[0] - xp), Math.min(100, xe[1] + xp)]).range([0, w]);
    const ySc = d3.scaleLinear().domain([ye[0] - yp, ye[1] + yp]).range([h, 0]);

    // Zero line
    const y0 = ySc(0);
    g.append('line').attr('x1', 0).attr('x2', w).attr('y1', y0).attr('y2', y0)
        .attr('stroke', 'rgba(255,255,255,0.15)').attr('stroke-width', 1).attr('stroke-dasharray', '4,3');

    // Grid
    g.selectAll('.gx').data(xSc.ticks(6)).enter().append('line')
        .attr('x1', d => xSc(d)).attr('x2', d => xSc(d)).attr('y1', 0).attr('y2', h)
        .attr('stroke', 'rgba(255,255,255,0.04)').attr('stroke-width', 1);

    // Axes
    g.append('g').attr('transform', `translate(0,${h})`)
        .call(d3.axisBottom(xSc).ticks(6).tickSize(0).tickFormat(d => d + '%'))
        .call(a => { a.select('.domain').attr('stroke', 'var(--border)'); a.selectAll('.tick text').attr('fill', 'var(--muted)').attr('dy', '1.2em'); });
    g.append('g')
        .call(d3.axisLeft(ySc).ticks(5).tickSize(0).tickFormat(d => (d > 0 ? '+' : '') + d.toFixed(1) + '%'))
        .call(a => { a.select('.domain').attr('stroke', 'var(--border)'); a.selectAll('.tick text').attr('fill', 'var(--muted)').attr('dx', '-.4em'); });

    g.append('text').attr('fill', 'var(--muted)').attr('font-size', '11px').attr('x', w / 2).attr('y', h + 30).attr('text-anchor', 'middle').text(xLabel);
    g.append('text').attr('fill', 'var(--muted)').attr('font-size', '11px').attr('transform', 'rotate(-90)').attr('x', -h / 2).attr('y', -38).attr('text-anchor', 'middle').text('Diferença % (A − B)');

    // Labels A lidera / B lidera
    g.append('text').attr('fill', metaA.color).attr('font-size', '10px').attr('x', 4).attr('y', 12).text(`↑ ${metaA.name} lidera`);
    g.append('text').attr('fill', metaB.color).attr('font-size', '10px').attr('x', 4).attr('y', h - 4).text(`↓ ${metaB.name} lidera`);

    // Pontos
    diff.forEach(d => {
        const col = d.y >= 0 ? metaA.color : metaB.color;
        g.append('circle')
            .attr('cx', xSc(d.x)).attr('cy', ySc(d.y)).attr('r', 2.5)
            .attr('fill', col).attr('fill-opacity', .65)
            .attr('stroke', '#000').attr('stroke-width', .5).attr('stroke-opacity', .3)
            .on('mouseover', (e) => {
                ttName.textContent = d.nm || 'Local';
                const parts = [d.cidade, d.bairro].filter(Boolean);
                ttLocation.textContent = parts.join(' · '); ttLocation.style.display = parts.length ? 'block' : 'none';
                ttIdx.textContent = (d.y >= 0 ? '+' : '') + d.y.toFixed(1) + 'pp';
                ttPct.textContent = `${metaA.name}: ${d.yA.toFixed(1)}% | ${metaB.name}: ${d.yB.toFixed(1)}%`;
                ttFaixa.textContent = `${xLabel.replace(' →', '')}: ${d.x.toFixed(1)}%`;
                ttFaixa.style.color = 'var(--accent)';
                ttFaixa.style.display = 'none';
                iseTooltip.style.display = 'block'; moveIseTT(e);
            })
            .on('mousemove', e => moveIseTT(e)).on('mouseout', () => hideIseTT());
    });

    // Stats
    const statsEl = card.querySelector('#diff-dep-f-stats');
    if (statsEl) {
        const above = diff.filter(d => d.y > 0), below = diff.filter(d => d.y < 0);
        const avgA = above.length ? (above.reduce((s, d) => s + d.y, 0) / above.length).toFixed(1) : '—';
        const avgB = below.length ? (Math.abs(below.reduce((s, d) => s + d.y, 0) / below.length)).toFixed(1) : '—';
        statsEl.innerHTML = `
            <div><span style="color:${metaA.color}">↑ ${metaA.name}</span>: ${above.length} locais (média +${avgA}pp)</div>
            <div><span style="color:${metaB.color}">↓ ${metaB.name}</span>: ${below.length} locais (média -${avgB}pp)</div>`;
    }
}

function _renderCandChipsHTML(typeKey) {
    const s = window.ISE_DEP_STATE;
    const cfg = _getLegislativeISEConfig(s.cargo);
    if (!Object.keys(cfg.metadataStore || {}).length) return '';
    const mode = s.subMode;

    const chips = (mode === 'vsVs' ? s.vsPair.filter(Boolean) : s.activeCands).map((candId, i) => {
        const meta = cfg.metadataStore[candId] || [candId, '?'];
        const name = String(meta[0]).split('|')[0].trim();
        const party = (meta[1] || '').toUpperCase();
        const color = window.colorForParty ? window.colorForParty(party) : '#777';
        if (mode === 'vsVs') {
            const label = i === 0 ? 'A' : 'B';
            return `<div class="ise-cand-chip" style="border-color:${color};color:${color};background:${color}25;cursor:pointer;"
                onclick="window._depVsCandSwap('${candId}')">
                <span class="ise-mano-badge">${label}</span> ${name} <span style="font-size:10px;opacity:0.6">${party}</span>
            </div>`;
        }
        return `<div class="ise-cand-chip" style="border-color:${color};color:${color};background:${color}25;">
            ${name} <span style="font-size:10px;opacity:0.6">${party}</span>
            <span class="chip-x" onclick="window._depRemoveCand('${candId}')">✕</span>
        </div>`;
    }).join('');

    const showAdd = mode === 'select' && s.activeCands.length < 5;
    const addBtn = showAdd ? `<div class="ise-cand-chip" style="border-color:var(--border);color:var(--muted);background:transparent;cursor:pointer;font-size:18px;padding:2px 10px;line-height:1;"
        onclick="document.getElementById('iseDepCandSearchBox').style.display='block';document.getElementById('iseDepCandInput').focus()">+</div>` : '';

    const searchBox = `<div id="iseDepCandSearchBox" style="display:none;position:relative;margin-top:4px;">
        <input id="iseDepCandInput" class="search-input" placeholder="Buscar candidato por nome ou número..." autocomplete="off" style="font-size:12px;padding:6px 10px;">
        <div id="iseDepCandResults" class="search-results"></div>
    </div>`;

    return `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">${chips}${addBtn}</div>${searchBox}`;
}

function _renderPartyChipsHTML(typeKey) {
    const s = window.ISE_DEP_STATE;
    const mode = s.subMode;

    const chips = (mode === 'vsVs' ? s.vsPartyPair.filter(Boolean) : s.activeParties).map((party, i) => {
        const color = window.colorForParty ? window.colorForParty(party) : '#777';
        if (mode === 'vsVs') {
            const label = i === 0 ? 'A' : 'B';
            return `<div class="ise-cand-chip" style="border-color:${color};color:${color};background:${color}25;cursor:pointer;"
                onclick="window._depVsPartySwap('${party}')">
                <span class="ise-mano-badge">${label}</span> ${party}
            </div>`;
        }
        return `<div class="ise-cand-chip" style="border-color:${color};color:${color};background:${color}25;">
            ${party}
            <span class="chip-x" onclick="window._depRemoveParty('${party}')">✕</span>
        </div>`;
    }).join('');

    const showAdd = mode === 'select' && s.activeParties.length < 5;
    const addBtn = showAdd ? `<div class="ise-cand-chip" style="border-color:var(--border);color:var(--muted);background:transparent;cursor:pointer;font-size:18px;padding:2px 10px;line-height:1;"
        onclick="document.getElementById('iseDepPartySearchBox').style.display='block';document.getElementById('iseDepPartyInput').focus()">+</div>` : '';

    const searchBox = `<div id="iseDepPartySearchBox" style="display:none;position:relative;margin-top:4px;">
        <input id="iseDepPartyInput" class="search-input" placeholder="Buscar partido..." autocomplete="off" style="font-size:12px;padding:6px 10px;">
        <div id="iseDepPartyResults" class="search-results"></div>
    </div>`;

    return `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">${chips}${addBtn}</div>${searchBox}`;
}

// Helpers de busca de candidatos de deputado
function _setupDepCandSearch(typeKey) {
    const input = document.getElementById('iseDepCandInput');
    const results = document.getElementById('iseDepCandResults');
    if (!input || !results) return;

    const s = window.ISE_DEP_STATE;
    const cfg = _getLegislativeISEConfig(s.cargo);

    // Build lookup list from metadata
    const allCands = Object.entries(cfg.metadataStore || {}).map(([id, meta]) => ({
        id, name: String(meta[0] || id).split('|')[0].trim(), party: (meta[1] || '').toUpperCase()
    })).filter(c => c.name && c.name.length > 1);

    function search(q) {
        const used = s.subMode === 'vsVs' ? s.vsPair : s.activeCands;
        const qUp = q.toUpperCase();
        return allCands
            .filter(c => !used.includes(c.id))
            .filter(c => !q || c.name.toUpperCase().includes(qUp) || c.id.startsWith(q))
            .slice(0, 10);
    }

    function render(q) {
        const hits = search(q);
        if (!hits.length) {
            results.innerHTML = '<div style="padding:8px 12px;color:var(--muted);font-size:12px;">Nenhum resultado</div>';
        } else {
            results.innerHTML = hits.map(c => {
                const color = window.colorForParty ? window.colorForParty(c.party) : '#777';
                return `<div class="search-result-item" data-id="${c.id}">
                    <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:6px;flex-shrink:0;"></span>
                    <span class="search-result-name">${c.name}</span>
                    <span class="search-result-party">${c.party}</span>
                    <span class="search-result-number">${c.id}</span>
                </div>`;
            }).join('');
        }
        results.classList.add('visible');
        results.querySelectorAll('.search-result-item').forEach(item => {
            item.onclick = () => {
                const id = item.dataset.id;
                if (s.subMode === 'vsVs') {
                    if (!s.vsPair[0]) s.vsPair[0] = id;
                    else if (!s.vsPair[1]) s.vsPair[1] = id;
                    else s.vsPair = [id, s.vsPair[1]];
                } else {
                    if (!s.activeCands.includes(id) && s.activeCands.length < 5) s.activeCands.push(id);
                }
                results.classList.remove('visible');
                document.getElementById('iseDepCandSearchBox').style.display = 'none';
                _triggerDepISERedraw();
            };
        });
    }

    input.oninput = () => render(input.value);
    input.onfocus = () => render(input.value);
    document.addEventListener('click', e => {
        if (!e.target.closest('#iseDepCandSearchBox')) results.classList.remove('visible');
    });
}

function _setupDepPartySearch(typeKey) {
    const input = document.getElementById('iseDepPartyInput');
    const results = document.getElementById('iseDepPartyResults');
    if (!input || !results) return;

    const s = window.ISE_DEP_STATE;
    const cfg = _getLegislativeISEConfig(s.cargo);

    // Build unique party list from metadata
    const partySet = new Set();
    Object.values(cfg.metadataStore || {}).forEach(meta => {
        if (meta[1]) partySet.add(meta[1].toUpperCase());
    });
    const allParties = Array.from(partySet).sort();

    function render(q) {
        const used = s.subMode === 'vsVs' ? s.vsPartyPair : s.activeParties;
        const qUp = q.toUpperCase();
        const hits = allParties.filter(p => !used.includes(p) && (!q || p.includes(qUp))).slice(0, 12);
        if (!hits.length) {
            results.innerHTML = '<div style="padding:8px 12px;color:var(--muted);font-size:12px;">Nenhum partido encontrado</div>';
        } else {
            results.innerHTML = hits.map(party => {
                const color = window.colorForParty ? window.colorForParty(party) : '#777';
                return `<div class="search-result-item" data-party="${party}">
                    <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:6px;flex-shrink:0;"></span>
                    <span class="search-result-name">${party}</span>
                </div>`;
            }).join('');
        }
        results.classList.add('visible');
        results.querySelectorAll('.search-result-item').forEach(item => {
            item.onclick = () => {
                const party = item.dataset.party;
                if (s.subMode === 'vsVs') {
                    if (!s.vsPartyPair[0]) s.vsPartyPair[0] = party;
                    else if (!s.vsPartyPair[1]) s.vsPartyPair[1] = party;
                    else s.vsPartyPair = [party, s.vsPartyPair[1]];
                } else {
                    if (!s.activeParties.includes(party) && s.activeParties.length < 5) s.activeParties.push(party);
                }
                results.classList.remove('visible');
                document.getElementById('iseDepPartySearchBox').style.display = 'none';
                _triggerDepISERedraw();
            };
        });
    }

    input.oninput = () => render(input.value);
    input.onfocus = () => render(input.value);
    document.addEventListener('click', e => {
        if (!e.target.closest('#iseDepPartySearchBox')) results.classList.remove('visible');
    });
}

function _triggerDepISERedraw() {
    const p = window._isePendingArgs || {};
    const cl = p.currentLayer || window.currentLayer;
    const cargo = p.currentCargo || window.currentCargo;
    if (cl && cargo) window.updateISEPanel(cl, cargo, p.currentTurno || window.currentTurno || 1);
}

// Globais expostos para onclick inline
window._setDepISEMode = function (mode) {
    window.ISE_DEP_STATE.mode = mode;
    _triggerDepISERedraw();
};
window._setDepISESubMode = function (sub) {
    window.ISE_DEP_STATE.subMode = sub;
    _triggerDepISERedraw();
};
window._depRemoveCand = function (id) {
    window.ISE_DEP_STATE.activeCands = window.ISE_DEP_STATE.activeCands.filter(c => c !== id);
    _triggerDepISERedraw();
};
window._depRemoveParty = function (party) {
    window.ISE_DEP_STATE.activeParties = window.ISE_DEP_STATE.activeParties.filter(p => p !== party);
    _triggerDepISERedraw();
};
window._depVsCandSwap = function (id) {
    const s = window.ISE_DEP_STATE;
    if (s.vsPair[0] === id) s.vsPair = [s.vsPair[1], null];
    else if (s.vsPair[1] === id) s.vsPair[1] = null;
    else if (!s.vsPair[0]) s.vsPair[0] = id;
    else s.vsPair[1] = id;
    _triggerDepISERedraw();
};
window._depVsPartySwap = function (party) {
    const s = window.ISE_DEP_STATE;
    if (s.vsPartyPair[0] === party) s.vsPartyPair = [s.vsPartyPair[1], null];
    else if (s.vsPartyPair[1] === party) s.vsPartyPair[1] = null;
    else if (!s.vsPartyPair[0]) s.vsPartyPair[0] = party;
    else s.vsPartyPair[1] = party;
    _triggerDepISERedraw();
};

// ============================================================
//  FIM ISE DEPUTADOS
// ============================================================

// ============================================================
//  ISE — MODO FATOR DEMOGRÁFICO
//  O eixo X é simplesmente o % do fator no local (0–100)
//  O eixo Y é o % de votos do candidato/partido
// ============================================================

// Catálogo de fatores disponíveis, organizados por grupo
const ISE_FACTORS = {
    renda: {
        label: 'Renda',
        color: '#22c55e',
        factors: [
            { id: 'renda_media', label: 'Renda Media', keys: ['Renda Media', 'RENDA MEDIA', 'renda'], isCurrency: true, weightNormalizer: 10000 }
        ]
    },
    genero: {
        label: 'Gênero',
        color: '#c084fc',
        factors: [
            { id: 'mulheres', label: 'Mulheres', keys: ['Pct Mulheres', 'FEMININO', 'MULHERES', 'Mulheres'], isAbs: true },
            { id: 'homens', label: 'Homens', keys: ['Pct Homens', 'MASCULINO', 'HOMENS', 'Homens'], isAbs: true },
        ]
    },
    raca: {
        label: 'Cor/Raça',
        color: '#fb923c',
        factors: [
            { id: 'branca', label: 'Branca', keys: ['Pct Branca', 'PCT BRANCA'] },
            { id: 'preta', label: 'Preta', keys: ['Pct Preta', 'PCT PRETA'] },
            { id: 'parda', label: 'Parda', keys: ['Pct Parda', 'PCT PARDA'] },
            { id: 'amarela', label: 'Amarela', keys: ['Pct Amarela', 'PCT AMARELA'] },
            { id: 'indigena', label: 'Indígena', keys: ['Pct Indigena', 'PCT INDIGENA'] },
        ]
    },
    idade: {
        label: 'Faixa Etária',
        color: '#34d399',
        factors: [
            { id: 'idade_16_24', label: '16–24', ageRange: [16, 24] },
            { id: 'idade_25_34', label: '25–34', ageRange: [25, 34] },
            { id: 'idade_35_44', label: '35–44', ageRange: [35, 44] },
            { id: 'idade_45_59', label: '45–59', ageRange: [45, 59] },
            { id: 'idade_60_74', label: '60–74', ageRange: [60, 74] },
            { id: 'idade_75', label: '75+', ageRange: [75, 200] },
        ]
    },
    escolaridade: {
        label: 'Escolaridade',
        color: '#60a5fa',
        factors: [
            { id: 'analfabeto', label: 'Analfabeto', keys: ['ANALFABETO', 'Analfabeto'], isAbs: true },
            { id: 'le_escreve', label: 'Lê/Escreve', keys: ['LÊ E ESCREVE', 'LE E ESCREVE', 'Lê e Escreve'], isAbs: true },
            { id: 'fund_incomp', label: 'Fund. Inc.', keys: ['ENSINO FUNDAMENTAL INCOMPLETO', 'FUNDAMENTAL INCOMPLETO'], isAbs: true },
            { id: 'fund_comp', label: 'Fund. Comp.', keys: ['ENSINO FUNDAMENTAL COMPLETO', 'FUNDAMENTAL COMPLETO'], isAbs: true },
            { id: 'med_incomp', label: 'Méd. Inc.', keys: ['ENSINO MÉDIO INCOMPLETO', 'MEDIO INCOMPLETO'], isAbs: true },
            { id: 'med_comp', label: 'Méd. Comp.', keys: ['ENSINO MÉDIO COMPLETO', 'MEDIO COMPLETO'], isAbs: true },
            { id: 'sup_incomp', label: 'Sup. Inc.', keys: ['ENSINO SUPERIOR INCOMPLETO', 'SUPERIOR INCOMPLETO'], isAbs: true },
            { id: 'sup_comp', label: 'Sup. Comp.', keys: ['ENSINO SUPERIOR COMPLETO', 'SUPERIOR COMPLETO', 'Superior Completo'], isAbs: true },
        ]
    },
    estado_civil: {
        label: 'Estado Civil',
        color: '#f472b6',
        factors: [
            { id: 'solteiro', label: 'Solteiro', keys: ['SOLTEIRO', 'Solteiro'], isAbs: true },
            { id: 'casado', label: 'Casado', keys: ['CASADO', 'Casado'], isAbs: true },
            { id: 'divorciado', label: 'Divorciado', keys: ['DIVORCIADO', 'Divorciado'], isAbs: true },
            { id: 'separado', label: 'Separado', keys: ['SEPARADO JUDICIALMENTE', 'SEPARADO', 'Separado'], isAbs: true },
            { id: 'viuvo', label: 'Viúvo', keys: ['VIÚVO', 'VIUVO', 'Viúvo', 'Viuvo'], isAbs: true },
        ]
    },
    saneamento: {
        label: 'Saneamento',
        color: '#a3e635',
        factors: [
            { id: 'esg_rede', label: 'Rede Geral', keys: ['Pct Esgoto Rede Geral'] },
            { id: 'esg_fossa', label: 'Fossa Sép.', keys: ['Pct Fossa Septica', 'Pct Fossa Séptica'] },
            { id: 'esg_inad', label: 'Esg. Inad.', keys: ['Pct Esgoto Inadequado'] },
        ]
    },
    participacao: {
        label: 'Participação',
        color: '#38bdf8',
        factors: [
            { id: 'turnout', label: 'Turnout' }
        ]
    },
};

// Retorna o valor 0-100 do fator para uma feature
// Espelha EXATAMENTE a lógica do app.js (getColorForNeighborhood / renderFilterPanel)
function _getFactorValue(props, factorDef) {
    if (factorDef.id === 'renda_media') {
        const renda = getPropVal(props, factorDef.keys || ['Renda Media', 'RENDA MEDIA', 'renda']);
        return renda > 0 ? renda : -1;
    }

    if (factorDef.id === 'turnout') {
        const cargoKey = window.currentCargo || null;
        const turnoKey = (window.currentTurno === 2 && window.STATE?.dataHas2T?.[cargoKey]) ? '2T' : '1T';
        const turnoutStats = window.getFeatureTurnoutStats
            ? window.getFeatureTurnoutStats(props, cargoKey, turnoKey)
            : null;
        return turnoutStats && turnoutStats.pct !== null ? turnoutStats.pct : -1;
    }

    // ── Faixa Etária ─────────────────────────────────────────────────────────
    if (factorDef.ageRange) {
        const [minAge, maxAge] = factorDef.ageRange;
        let sumInRange = 0, totalAge = 0;

        // Tenta absolutos primeiro (chaves com "anos" mas sem "Pct")
        for (const key in props) {
            if (!key.match(/anos/i) || key.match(/^Pct/i)) continue;
            const v = Number(props[key]) || 0;
            if (v === 0) continue;
            const m = key.match(/(\d+)/);
            if (!m) continue;
            const age = parseInt(m[1]);
            totalAge += v;
            if (age >= minAge && age <= maxAge) sumInRange += v;
        }

        // Fallback legacy: "Pct X a Y anos"
        if (totalAge === 0) {
            for (const key in props) {
                if (!key.startsWith('Pct ') || !key.includes('anos')) continue;
                const v = Number(props[key]) || 0;
                if (v === 0) continue;
                const m = key.match(/(\d+)/);
                if (!m) continue;
                const age = parseInt(m[1]);
                totalAge += v;
                if (age >= minAge && age <= maxAge) sumInRange += v;
            }
        }

        return totalAge > 0 ? (sumInRange / totalAge) * 100 : -1;
    }

    // ── Gênero ────────────────────────────────────────────────────────────────
    if (factorDef.id === 'mulheres' || factorDef.id === 'homens') {
        // Tenta absolutos (MASCULINO/FEMININO) primeiro
        const h = getPropVal(props, ['MASCULINO', 'HOMENS', 'Homens']);
        const m = getPropVal(props, ['FEMININO', 'MULHERES', 'Mulheres']);
        let total = h + m;

        if (total > 0) {
            // Tem absolutos — calcula pct diretamente
            const num = factorDef.id === 'mulheres' ? m : h;
            return (num / total) * 100;
        }

        // Fallback: tenta Pct direto (legacy)
        const hPct = getPropVal(props, ['Pct Homens']);
        const mPct = getPropVal(props, ['Pct Mulheres']);
        const totalPct = hPct + mPct;
        if (totalPct > 0) {
            const num = factorDef.id === 'mulheres' ? mPct : hPct;
            return (num / totalPct) * 100;
        }

        return -1; // sem dado
    }

    // ── Estado Civil ──────────────────────────────────────────────────────────
    if (factorDef.id === 'solteiro' || factorDef.id === 'casado' ||
        factorDef.id === 'divorciado' || factorDef.id === 'separado' || factorDef.id === 'viuvo') {

        const s = getPropVal(props, ['SOLTEIRO', 'Solteiro']);
        const c = getPropVal(props, ['CASADO', 'Casado']);
        const d = getPropVal(props, ['DIVORCIADO', 'Divorciado']);
        const v = getPropVal(props, ['VIÚVO', 'VIUVO', 'Viúvo', 'Viuvo']);
        const sep = getPropVal(props, ['SEPARADO JUDICIALMENTE', 'SEPARADO', 'Separado']);

        // Detecta se é Pct (legacy) — igual ao app.js
        const isPct = (props['Pct Solteiro'] !== undefined || props['Pct Casado'] !== undefined);
        const den = isPct ? 100 : (s + c + d + v + sep);
        if (den === 0) return -1;

        const valueMap = { solteiro: s, casado: c, divorciado: d, separado: sep, viuvo: v };
        return (valueMap[factorDef.id] / den) * 100;
    }

    // ── Escolaridade ──────────────────────────────────────────────────────────
    if (['analfabeto', 'le_escreve', 'fund_incomp', 'fund_comp', 'med_incomp', 'med_comp', 'sup_incomp', 'sup_comp'].includes(factorDef.id)) {
        const ana = getPropVal(props, ['ANALFABETO', 'Analfabeto']);
        const le = getPropVal(props, ['LÊ E ESCREVE', 'LE E ESCREVE', 'Lê e Escreve']);
        const fi = getPropVal(props, ['ENSINO FUNDAMENTAL INCOMPLETO', 'FUNDAMENTAL INCOMPLETO']);
        const fc = getPropVal(props, ['ENSINO FUNDAMENTAL COMPLETO', 'FUNDAMENTAL COMPLETO']);
        const mi = getPropVal(props, ['ENSINO MÉDIO INCOMPLETO', 'MEDIO INCOMPLETO']);
        const mc = getPropVal(props, ['ENSINO MÉDIO COMPLETO', 'MEDIO COMPLETO']);
        const si = getPropVal(props, ['ENSINO SUPERIOR INCOMPLETO', 'SUPERIOR INCOMPLETO']);
        const sc = getPropVal(props, ['ENSINO SUPERIOR COMPLETO', 'SUPERIOR COMPLETO', 'Superior Completo']);

        // Detecta Pct legacy
        const isPct = (props['Pct Analfabeto'] !== undefined || props['Pct Médio Completo'] !== undefined);
        const den = isPct ? 100 : (ana + le + fi + fc + mi + mc + si + sc);
        if (den === 0) return -1;

        const valueMap = {
            analfabeto: ana, le_escreve: le, fund_incomp: fi, fund_comp: fc,
            med_incomp: mi, med_comp: mc, sup_incomp: si, sup_comp: sc
        };
        return (valueMap[factorDef.id] / den) * 100;
    }

    // ── Cor/Raça — já vem como Pct (0–100) ───────────────────────────────────
    if (['branca', 'preta', 'parda', 'amarela', 'indigena'].includes(factorDef.id)) {
        const v = getPropVal(props, factorDef.keys);
        return v > 0 ? v : -1;
    }

    // ── Saneamento — já vem como Pct (0–100) ─────────────────────────────────
    if (['esg_rede', 'esg_fossa', 'esg_inad'].includes(factorDef.id)) {
        const v = getPropVal(props, factorDef.keys);
        return v >= 0 ? v : -1;
    }

    return -1;
}

// Constrói pontos ISE com eixo X = % do fator (em vez do score ISE composto)
function processFactorData(features, candidatoKey, currentCargo, factorDef) {
    const gp = window.getProp || ((p, k) => p[k]);
    const rawPoints = [];

    features.forEach(f => {
        const p = f.properties;

        const factorVal = _getFactorValue(p, factorDef);
        // -1 = sem dado para este fator; descarta
        if (factorVal < 0) return;

        // Votos válidos
        let votosCandidato = 0, votosValidos = 0;
        let validCandidateKeys = [];
        if (window.STATE && window.STATE.candidates && currentCargo) {
            const t = window.currentTurno || 1;
            const turnoKey = (t === 2 && window.STATE.dataHas2T?.[currentCargo]) ? '2T' : '1T';
            validCandidateKeys = window.STATE.candidates[currentCargo]?.[turnoKey] || [];
        }
        validCandidateKeys.forEach(k => {
            const val = window.getProp ? window.getProp(p, k) : (p[k] || p[k.toLowerCase()]);
            const votos = Number(val) || 0;
            votosValidos += votos;
            if (k === candidatoKey) votosCandidato = votos;
        });

        if (votosValidos <= 0) return;

        const locId = getIseSelectionId(p);
        const locName = gp(p, 'nm_locvot') || gp(p, 'NM_LOCVOT') || '';
        const isPrison = String(locName).toUpperCase().match(/PRES[IÍ]DIO|PENITENCI[AÁ]RIA|COMPLEXO PEN|CADEIA|PENAL|DETEN[CÇ][AÃ]O/i);
        if (isPrison) return;

        const clampedFactorVal = factorDef.isCurrency
            ? Math.max(0, factorVal)
            : Math.min(100, Math.max(0, factorVal));

        rawPoints.push({
            id: locId,
            nm: locName ? String(locName) : ('Local ' + locId),
            bairro: String(gp(p, 'ds_bairro') || gp(p, 'NM_BAIRRO') || ''),
            cidade: String(gp(p, 'nm_localidade') || gp(p, 'NM_LOCALIDADE') || gp(p, 'nm_municipio') || ''),
            x: clampedFactorVal,
            y: (votosCandidato / votosValidos) * 100,
            votosCand: votosCandidato,
            votosVal: votosValidos,
        });
    });

    // Classifica em 3 faixas. Para renda em 2006, usa cortes fixos por salário mínimo.
    if (rawPoints.length === 0) return [];
    if (factorDef.isCurrency && String(window.STATE?.currentElectionYear || '') === '2006') {
        rawPoints.forEach(d => {
            d.t = classifyIncomeBand2006(d.x);
        });
    } else {
        const sorted = [...rawPoints].sort((a, b) => a.x - b.x);
        const n = sorted.length;
        const t1 = sorted[Math.floor(n / 3)].x;
        const t2 = sorted[Math.floor((2 * n) / 3)].x;
        rawPoints.forEach(d => {
            if (d.x <= t1) d.t = 'baixo';
            else if (d.x <= t2) d.t = 'medio';
            else d.t = 'alto';
        });
    }
    return rawPoints;
}

// Renderiza o seletor de fatores no HTML
function _renderFactorSelector() {
    const box = document.getElementById('iseFactorGroups');
    if (!box) return;
    const s = window.ISE_FACTOR_STATE;
    const availableGroups = getAvailableIseFactorGroups();
    const availableEntries = Object.entries(availableGroups);
    if (!availableGroups[s.factorGroupId]) {
        const [firstGroupId, firstGroup] = availableEntries[0] || [];
        s.factorGroupId = firstGroupId || 'raca';
        s.factorId = firstGroup?.factors?.[0]?.id || 'preta';
    }

    box.innerHTML = availableEntries.map(([groupId, group]) => {
        const chipsHtml = group.factors.map(f => {
            const isActive = s.factorGroupId === groupId && s.factorId === f.id;
            return `<button class="ise-factor-chip${isActive ? ' active' : ''}"
                onclick="window.setIseFactor('${groupId}','${f.id}')">${f.label}</button>`;
        }).join('');
        return `<div class="ise-factor-group">
            <div class="ise-factor-group-label" style="color:${group.color}">${group.label}</div>
            <div class="ise-factor-chips">${chipsHtml}</div>
        </div>`;
    }).join('');
}

// Renderiza gráficos no modo fator
function _renderFactorCharts(chartsContainer, features, allKeys, candMetas, currentCargo) {
    const s = window.ISE_FACTOR_STATE;
    const groupDef = getAvailableIseFactorGroups()[s.factorGroupId];
    if (!groupDef) return;
    const factorDef = groupDef.factors.find(f => f.id === s.factorId);
    if (!factorDef) return;

    // Usa o mesmo estado de candidatos do modo ISE
    const ISE_CS = window.ISE_CAND_STATE;
    let keysToRender = allKeys.slice(0, 3);
    if (ISE_CS) {
        if (ISE_CS.mode === 'select') keysToRender = allKeys.filter(k => ISE_CS.active.has(k));
        else if (ISE_CS.mode === 'vsVs') {
            const [a, b] = ISE_CS.vsVsPair;
            keysToRender = a === b ? [a] : [a, b].filter(Boolean);
        }
    }

    chartsContainer.innerHTML = '';

    // Label do eixo X
    const xLabel = factorDef.isCurrency ? 'Renda Média (R$) →' : `${factorDef.label} (%) →`;

    keysToRender.forEach((key, index) => {
        const { name, color } = candMetas[key] || { name: key, color: '#777' };
        const data = processFactorData(features, key, currentCargo, factorDef);
        if (data.length > 2) {
            drawFactorChart(chartsContainer, `factor-${index}`, data, name, color, xLabel, factorDef.label, groupDef.color, factorDef);
        }
    });

    // Mano a mano — usa gráfico de diferença por fator, NÃO por ISE
    if (ISE_CS && ISE_CS.mode === 'vsVs') {
        const [keyA, keyB] = ISE_CS.vsVsPair;
        if (keyA && keyB && keyA !== keyB) {
            const dataA = processFactorData(features, keyA, currentCargo, factorDef);
            const dataB = processFactorData(features, keyB, currentCargo, factorDef);
            if (dataA.length > 2 && dataB.length > 2) {
                const bMap = new Map();
                dataB.forEach(d => bMap.set(d.id, d));
                const diff = [];
                dataA.forEach(dA => {
                    const dB = bMap.get(dA.id);
                    if (dB) diff.push({ x: dA.x, y: dA.y - dB.y, t: dA.t, nm: dA.nm, bairro: dA.bairro, cidade: dA.cidade, yA: dA.y, yB: dB.y });
                });
                if (diff.length >= 3) {
                    _drawGenericDiffChart(chartsContainer, diff, candMetas[keyA], candMetas[keyB], xLabel);
                }
            }
        }
    }

    if (chartsContainer.innerHTML === '') {
        chartsContainer.innerHTML = `<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px;">
            Nenhum dado disponível para "${factorDef.label}" na seleção atual.</div>`;
    }
}

// Desenha o gráfico de scatter com eixo X = % do fator (igual ao drawIseChart mas com label customizado)
function formatBRLShort(value) {
    const num = Number(value) || 0;
    if (num >= 1000) return `R$ ${(num / 1000).toFixed(1)}k`;
    return `R$ ${Math.round(num)}`;
}

function formatBRLFull(value) {
    return (Number(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function classifyIncomeBand2006(value) {
    const renda = Number(value) || 0;
    const salarioMinimo2006 = 360;
    if (renda <= salarioMinimo2006 * 2) return 'baixo';
    if (renda <= salarioMinimo2006 * 5) return 'medio';
    return 'alto';
}

function drawFactorChart(container, id, data, candidateName, candidateColor, xLabel, factorLabel, accentColor, factorDef = {}) {
    if (!container || !data || !data.length) return;

    const card = document.createElement('div');
    card.className = 'chart-card';
    card.style.cssText = 'position:relative;margin-bottom:20px;padding:16px;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid var(--border);';

    card.innerHTML = `
    <div style="margin-bottom:12px;">
      <h3 style="display:flex;align-items:center;gap:8px;margin:0;font-size:15px;">
        <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${candidateColor};"></span>
        ${candidateName}
      </h3>
      <span style="font-size:12px;color:var(--muted);">Desempenho × ${factorLabel}</span>
    </div>
    <div id="chart-${id}" style="position:relative;overflow:hidden;"></div>
    <div id="stats-${id}" style="display:flex;gap:16px;margin-top:12px;font-size:12px;color:var(--muted);justify-content:center;flex-wrap:wrap;border-top:1px dashed var(--border);padding-top:12px;"></div>
    <div id="legend-${id}" style="display:flex;gap:16px;margin-top:12px;font-size:11px;justify-content:center;"></div>`;

    container.appendChild(card);

    const cont = document.getElementById('chart-' + id);
    const W = cont.parentElement.clientWidth;
    const H = Math.min(300, Math.max(220, W * 0.52));
    const mg = { top: 10, right: 14, bottom: 36, left: 42 };
    const w = W - mg.left - mg.right;
    const h = H - mg.top - mg.bottom;

    const svg = d3.select(cont).append('svg').attr('width', W).attr('height', H);
    const g = svg.append('g').attr('transform', `translate(${mg.left},${mg.top})`);

    const xe = d3.extent(data, d => d.x);
    const ye = d3.extent(data, d => d.y);
    const xp = Math.max((xe[1] - xe[0]) * .04, 1);
    const yp = Math.max((ye[1] - ye[0]) * .06, 1);

    const xDomainMax = factorDef.isCurrency ? (xe[1] + xp) : Math.min(100, xe[1] + xp);
    const xSc = d3.scaleLinear().domain([Math.max(0, xe[0] - xp), xDomainMax]).range([0, w]);
    const ySc = d3.scaleLinear().domain([Math.max(0, ye[0] - yp), Math.min(100, ye[1] + yp)]).range([h, 0]);

    // Grid
    g.selectAll('.gx').data(xSc.ticks(6)).enter().append('line')
        .attr('x1', d => xSc(d)).attr('x2', d => xSc(d)).attr('y1', 0).attr('y2', h)
        .attr('stroke', 'rgba(255,255,255,0.05)').attr('stroke-width', 1);
    g.selectAll('.gy').data(ySc.ticks(5)).enter().append('line')
        .attr('x1', 0).attr('x2', w).attr('y1', d => ySc(d)).attr('y2', d => ySc(d))
        .attr('stroke', 'rgba(255,255,255,0.05)').attr('stroke-width', 1);

    // Axes
    g.append('g').attr('transform', `translate(0,${h})`)
        .call(d3.axisBottom(xSc).ticks(6).tickSize(0).tickFormat(d => factorDef.isCurrency ? formatBRLShort(d) : d + '%'))
        .call(a => { a.select('.domain').attr('stroke', 'var(--border)'); a.selectAll('.tick text').attr('fill', 'var(--muted)').attr('dy', '1.2em'); });
    g.append('g')
        .call(d3.axisLeft(ySc).ticks(5).tickSize(0))
        .call(a => { a.select('.domain').attr('stroke', 'var(--border)'); a.selectAll('.tick text').attr('fill', 'var(--muted)').attr('dx', '-.4em'); });

    // Labels
    g.append('text').attr('fill', 'var(--muted)').attr('font-size', '11px').attr('x', w / 2).attr('y', h + 30).attr('text-anchor', 'middle').text(xLabel || `${factorLabel} % →`);
    g.append('text').attr('fill', 'var(--muted)').attr('font-size', '11px').attr('transform', 'rotate(-90)').attr('x', -h / 2).attr('y', -34).attr('text-anchor', 'middle').text('% Votos Válidos →');

    // Trend line
    const reg = linReg(data);
    const xExtent = d3.extent(data, d => d.x);
    const x0 = xExtent[0];
    const x1 = xExtent[1];

    const y0c = reg.slope * x0 + reg.intercept;
    const y1c = reg.slope * x1 + reg.intercept;
    g.append('line').attr('x1', xSc(x0)).attr('x2', xSc(x1)).attr('y1', ySc(y0c)).attr('y2', ySc(y1c))
        .attr('stroke', candidateColor).attr('stroke-width', 2);

    // r² / β
    g.append('text').attr('fill', 'var(--text)').attr('font-size', '12px').attr('font-weight', 'bold').attr('x', w - 4).attr('y', 14).attr('text-anchor', 'end')
        .text(`r²=${reg.r2.toFixed(3)}  β=${reg.slope >= 0 ? '+' : ''}${reg.slope.toFixed(3)}`);

    // Cores dos pontos: usa a cor do acento do grupo para colorir os tercis
    // baixo = opaco 40%, medio = 70%, alto = 100% da cor do fator
    const tercilColors = {
        baixo: accentColor + '66',
        medio: accentColor + 'aa',
        alto: accentColor,
    };

    ISE_TERCIL_ORDER.forEach(t => {
        g.selectAll(null).data(data.filter(d => d.t === t)).enter().append('circle')
            .attr('cx', d => xSc(d.x)).attr('cy', d => ySc(d.y))
            .attr('r', 2.8)
            .attr('fill', tercilColors[t] || accentColor)
            .attr('fill-opacity', .7)
            .attr('stroke', '#000').attr('stroke-width', 0.5).attr('stroke-opacity', 0.4)
            .on('mouseover', (e, d) => {
                ttName.textContent = d.nm || 'Local';
                const parts = [d.cidade, d.bairro].filter(Boolean);
                ttLocation.textContent = parts.join(' · ');
                ttLocation.style.display = parts.length ? 'block' : 'none';

                const xLabelEl = document.getElementById('ise-tt-x-label');
                if (xLabelEl) xLabelEl.textContent = factorDef.isCurrency ? 'Renda Média (R$)' : factorLabel + ' (%)';

                ttIdx.textContent = factorDef.isCurrency ? formatBRLFull(d.x) : d.x.toFixed(1) + '%';
                ttPct.textContent = d.y.toFixed(1) + '%';
                ttFaixa.textContent = factorDef.isCurrency ? `Renda: ${formatBRLFull(d.x)}` : `${factorLabel}: ${d.x.toFixed(1)}%`;
                ttFaixa.style.background = 'rgba(255,255,255,0.08)';
                ttFaixa.style.color = accentColor;
                ttFaixa.style.display = 'none';
                iseTooltip.style.display = 'block';
                moveIseTT(e);
            })
            .on('mousemove', e => moveIseTT(e))
            .on('mouseout', () => hideIseTT());
    });

    // Stats por tercil
    const stEl = document.getElementById('stats-' + id);
    if (stEl) {
        const means = {};
        ISE_TERCIL_ORDER.forEach(t => {
            const vData = data.filter(d => d.t === t);
            let totalCand = 0, totalVal = 0;
            vData.forEach(d => { totalCand += d.votosCand || 0; totalVal += d.votosVal || 0; });
            means[t] = totalVal > 0 ? ((totalCand / totalVal) * 100).toFixed(1) : '—';
        });
        // Média ponderada pelo valor do fator (locais com mais % do fator pesam mais)
        let numW = 0, denW = 0;
        const weightNormalizer = factorDef.isCurrency ? (factorDef.weightNormalizer || 10000) : 100;
        data.forEach(d => {
            const factorWeight = d.x / weightNormalizer;
            const w = (d.votosVal || 0) * factorWeight;
            numW += (d.votosCand || 0) * factorWeight;
            denW += w;
        });
        const mediaGeral = denW > 0 ? ((numW / denW) * 100).toFixed(1) : '—';

        const labels = (factorDef.isCurrency && String(window.STATE?.currentElectionYear || '') === '2006')
            ? { baixo: '↓ Renda Baixa', medio: '~ Renda Média', alto: '↑ Renda Alta' }
            : { baixo: `↓ ${factorLabel}`, medio: `~ ${factorLabel}`, alto: `↑ ${factorLabel}` };
        stEl.innerHTML = ISE_TERCIL_ORDER.map(t =>
            `<div>${labels[t]}: <span style="font-weight:700;color:var(--text);">${means[t] !== '—' ? means[t] + '%' : '—'}</span></div>`
        ).join('') +
            `<div style="border-left:1px solid var(--border);padding-left:10px;margin-left:4px;" title="Desempenho médio ponderado pela prevalência do fator — locais onde ${factorLabel} é mais frequente pesam mais">
            Méd. pond.: <span style="font-weight:700;color:${candidateColor};">${mediaGeral !== '—' ? mediaGeral + '%' : '—'}</span>
         </div>` +
            `<div style="margin-left:auto;">Coef(β): <span style="font-weight:700;color:${reg.slope >= 0 ? '#88c0d0' : '#bf616a'};">${reg.slope >= 0 ? '+' : ''}${reg.slope.toFixed(3)}</span></div>`;
    }
}


// Expõe globalmente
// ── Muda modo Selecionar / Mano a Mano (candidatos normais) ──────────────────
window.setIseMode = function (mode) {
    if (!window.ISE_CAND_STATE) return;
    window.ISE_CAND_STATE.mode = mode;
    // Se voltando para select sem candidatos ativos, restaura os 3 primeiros
    if (mode === 'select' && window.ISE_CAND_STATE.active.size === 0) {
        const keys = window.ISE_CAND_STATE.allKeys || [];
        window.ISE_CAND_STATE.active = new Set(keys.slice(0, 3));
    }
    // Atualiza visual dos botões imediatamente
    const btnSel = document.getElementById('iseModeSelect');
    const btnVsVs = document.getElementById('iseModeVsVs');
    if (btnSel) btnSel.classList.toggle('active', mode === 'select');
    if (btnVsVs) btnVsVs.classList.toggle('active', mode === 'vsVs');
    _triggerISERedraw();
};

window.setIseAnalysisMode = function (mode) {
    if (isLimitedCensusYear2006() && mode === 'ise') mode = 'factor';
    window.ISE_FACTOR_STATE.analysisMode = mode;
    const btnISE = document.getElementById('iseAnalysisModeISE');
    const btnFactor = document.getElementById('iseAnalysisModeFactor');
    const factorBox = document.getElementById('iseFactorSelectorBox');
    if (btnISE) btnISE.classList.toggle('active', mode === 'ise');
    if (btnFactor) btnFactor.classList.toggle('active', mode === 'factor');
    if (factorBox) factorBox.style.display = mode === 'factor' ? 'block' : 'none';
    if (mode === 'factor') _renderFactorSelector();
    _triggerISERedraw();
};

window.setIseFactor = function (groupId, factorId) {
    window.ISE_FACTOR_STATE.factorGroupId = groupId;
    window.ISE_FACTOR_STATE.factorId = factorId;
    _renderFactorSelector();
    _triggerISERedraw();
};

function _triggerISERedraw() {
    const p = window._isePendingArgs || {};
    const cl = p.currentLayer || window.currentLayer;
    const cargo = p.currentCargo || window.currentCargo;
    if (cl && cargo) window.updateISEPanel(cl, cargo, p.currentTurno || window.currentTurno || 1);
}

// ============================================================
//  FIM ISE FATOR DEMOGRÁFICO
// ============================================================


function _setupIseAddCandSearch(allKeys, candMetas) {
    const input = document.getElementById('iseAddCandInput');
    const results = document.getElementById('iseAddCandResults');
    if (!input || !results) return;

    // Remove listeners antigos clonando o elemento
    const newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);

    // Candidatos ainda não ativos (disponíveis para adicionar)
    function getAvailable(query) {
        return allKeys
            .filter(k => !window.ISE_CAND_STATE.active.has(k))
            .filter(k => {
                if (!query) return true;
                const name = (candMetas[k]?.name || k).toLowerCase();
                return name.includes(query.toLowerCase());
            });
    }

    function renderResults(query) {
        const available = getAvailable(query);
        if (available.length === 0) {
            results.innerHTML = '<div style="padding:8px 12px; color:var(--muted); font-size:12px;">Nenhum candidato disponível</div>';
            results.classList.add('visible');
            return;
        }
        results.innerHTML = available.slice(0, 8).map(k => {
            const { name, color } = candMetas[k] || { name: k, color: '#777' };
            return `<div class="search-result-item" data-key="${k}">
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:6px;flex-shrink:0;"></span>
                <span class="search-result-name">${name}</span>
            </div>`;
        }).join('');
        results.classList.add('visible');

        results.querySelectorAll('.search-result-item').forEach(item => {
            item.onclick = () => {
                const key = item.dataset.key;
                if (key) {
                    window.ISE_CAND_STATE.active.add(key);
                    results.classList.remove('visible');
                    const addCandBox = document.getElementById('iseAddCandBox');
                    if (addCandBox) addCandBox.style.display = 'none';
                    const _p = window._isePendingArgs || {}; window.updateISEPanel(_p.currentLayer || window.currentLayer, _p.currentCargo || window.currentCargo, _p.currentTurno || window.currentTurno || 1);
                }
            };
        });
    }

    newInput.addEventListener('input', () => renderResults(newInput.value));
    newInput.addEventListener('focus', () => renderResults(newInput.value));
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#iseAddCandBox')) results.classList.remove('visible');
    }, { once: false });
}

// Gráfico de diferença (Mano a Mano): A - B por ponto ISE
function drawIseDiffChart(container, features, keyA, keyB, metaA, metaB, currentCargo, getVotesFn) {
    let dataA, dataB;

    if (getVotesFn) {
        // Modo deputado: usa _buildISEDataDeputy com closure de votos por candidato/partido
        const p = window._isePendingArgs || {};
        const currentLayer = p.currentLayer || window.currentLayer;
        if (!currentLayer) return;
        dataA = _buildISEDataDeputy(currentLayer, (props) => getVotesFn({ properties: props }, keyA));
        dataB = _buildISEDataDeputy(currentLayer, (props) => getVotesFn({ properties: props }, keyB));
    } else {
        dataA = processISEData(features, keyA, currentCargo);
        dataB = processISEData(features, keyB, currentCargo);
    }

    // Indexa B por id
    const bMap = new Map();
    dataB.forEach(d => bMap.set(d.id, d));

    // Pontos com ambos os candidatos
    const diff = [];
    dataA.forEach(dA => {
        const dB = bMap.get(dA.id);
        if (dB) diff.push({ x: dA.x, y: dA.y - dB.y, t: dA.t, nm: dA.nm, bairro: dA.bairro, cidade: dA.cidade, yA: dA.y, yB: dB.y });
    });

    if (diff.length < 3) return;

    const card = document.createElement('div');
    card.className = 'chart-card';
    card.style.cssText = 'position:relative;margin-bottom:20px;padding:16px;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid var(--border);';

    card.innerHTML = `
    <div style="margin-bottom:12px;">
      <h3 style="display:flex;align-items:center;gap:8px;margin:0;font-size:15px;">
        <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${metaA.color};"></span>
        ${metaA.name}
        <span style="color:var(--muted);font-size:13px;font-weight:400;">vs</span>
        <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${metaB.color};"></span>
        ${metaB.name}
      </h3>
      <span style="font-size:12px;color:var(--muted);">Diferença de pontos por ISE (A − B)</span>
    </div>
    <div id="chart-ise-diff" style="position:relative;overflow:hidden;"></div>
    <div id="stats-ise-diff" style="display:flex;gap:16px;margin-top:12px;font-size:12px;color:var(--muted);justify-content:center;flex-wrap:wrap;border-top:1px dashed var(--border);padding-top:12px;"></div>
  `;
    container.appendChild(card);

    const cont = document.getElementById('chart-ise-diff');
    const W = cont.parentElement.clientWidth;
    const H = Math.min(260, Math.max(200, W * 0.45));
    const mg = { top: 14, right: 14, bottom: 36, left: 46 };
    const w = W - mg.left - mg.right;
    const h = H - mg.top - mg.bottom;

    const svg = d3.select(cont).append('svg').attr('width', W).attr('height', H);
    const g = svg.append('g').attr('transform', `translate(${mg.left},${mg.top})`);

    const xe = d3.extent(diff, d => d.x);
    const ye = d3.extent(diff, d => d.y);
    const xp = (xe[1] - xe[0]) * .04 || 1;
    const yp = Math.max(Math.abs(ye[0]), Math.abs(ye[1])) * 0.1 || 1;
    const yAbs = Math.max(Math.abs(ye[0]), Math.abs(ye[1])) + yp;

    const xSc = d3.scaleLinear().domain([Math.max(0, xe[0] - xp), Math.min(100, xe[1] + xp)]).range([0, w]);
    const ySc = d3.scaleLinear().domain([-yAbs, yAbs]).range([h, 0]);

    // Zero line
    g.append('line').attr('x1', 0).attr('x2', w).attr('y1', ySc(0)).attr('y2', ySc(0))
        .attr('stroke', 'rgba(255,255,255,0.15)').attr('stroke-width', 1).attr('stroke-dasharray', '4,3');

    // Grid
    g.selectAll('.gx').data(xSc.ticks(6)).enter().append('line')
        .attr('x1', d => xSc(d)).attr('x2', d => xSc(d)).attr('y1', 0).attr('y2', h)
        .attr('stroke', 'rgba(255,255,255,0.05)').attr('stroke-width', 1);
    g.selectAll('.gy').data(ySc.ticks(5)).enter().append('line')
        .attr('x1', 0).attr('x2', w).attr('y1', d => ySc(d)).attr('y2', d => ySc(d))
        .attr('stroke', 'rgba(255,255,255,0.05)').attr('stroke-width', 1);

    // Axes
    g.append('g').attr('transform', `translate(0,${h})`)
        .call(d3.axisBottom(xSc).ticks(6).tickSize(0))
        .call(a => { a.select('.domain').attr('stroke', 'var(--border)'); a.selectAll('.tick text').attr('fill', 'var(--muted)').attr('dy', '1.2em'); });
    g.append('g')
        .call(d3.axisLeft(ySc).ticks(5).tickSize(0))
        .call(a => { a.select('.domain').attr('stroke', 'var(--border)'); a.selectAll('.tick text').attr('fill', 'var(--muted)').attr('dx', '-.4em'); });

    // Labels
    g.append('text').attr('fill', 'var(--muted)').attr('font-size', '11px').attr('x', w / 2).attr('y', h + 30).attr('text-anchor', 'middle').text('Índice Socioeconômico →');
    g.append('text').attr('fill', 'var(--muted)').attr('font-size', '11px').attr('transform', 'rotate(-90)').attr('x', -h / 2).attr('y', -38).attr('text-anchor', 'middle').text('Diferença % (A − B) →');

    // Trend line
    const reg = linReg(diff);
    const x0 = xSc.domain()[0], x1 = xSc.domain()[1];
    const y0c = reg.slope * x0 + reg.intercept;
    const y1c = reg.slope * x1 + reg.intercept;
    g.append('line').attr('x1', xSc(x0)).attr('x2', xSc(x1)).attr('y1', ySc(y0c)).attr('y2', ySc(y1c))
        .attr('stroke', 'rgba(255,255,255,0.5)').attr('stroke-width', 2).attr('stroke-dasharray', '5,3');

    // r² badge
    g.append('text').attr('fill', 'var(--text)').attr('font-size', '12px').attr('font-weight', 'bold').attr('x', w - 4).attr('y', 14).attr('text-anchor', 'end')
        .text(`r²=${reg.r2.toFixed(3)}  β=${reg.slope >= 0 ? '+' : ''}${reg.slope.toFixed(3)}`);

    // Points — cor: acima de zero → cor de A, abaixo → cor de B
    ISE_TERCIL_ORDER.forEach(t => {
        g.selectAll(null).data(diff.filter(d => d.t === t)).enter().append('circle')
            .attr('cx', d => xSc(d.x)).attr('cy', d => ySc(d.y))
            .attr('r', 2.8)
            .attr('fill', d => d.y >= 0 ? metaA.color : metaB.color)
            .attr('fill-opacity', 0.65)
            .attr('stroke', '#000').attr('stroke-width', 0.5).attr('stroke-opacity', 0.4)
            .on('mouseover', (e, d) => {
                ttName.textContent = d.nm || 'Local';
                const parts = [d.cidade, d.bairro].filter(Boolean);
                ttLocation.textContent = parts.join(' · ');
                ttLocation.style.display = parts.length ? 'block' : 'none';
                ttIdx.textContent = d.x.toFixed(1);
                ttPct.style.fontSize = '12px';
                ttPct.style.fontWeight = '500';
                ttPct.style.color = 'rgba(255,255,255,0.75)';
                ttPct.textContent = `${metaA.name}: ${d.yA.toFixed(1)}%  ·  ${metaB.name}: ${d.yB.toFixed(1)}%  ·  Δ${d.y >= 0 ? '+' : ''}${d.y.toFixed(1)}pp`;
                ttFaixa.style.display = 'none';
                iseTooltip.style.display = 'block';
                moveIseTT(e);
            })
            .on('mousemove', e => moveIseTT(e))
            .on('mouseout', () => hideIseTT());
    });

    // Label "A lidera" / "B lidera"
    if (yAbs > 0) {
        g.append('text').attr('fill', metaA.color).attr('font-size', '10px').attr('opacity', 0.7)
            .attr('x', w - 4).attr('y', ySc(yAbs * 0.7)).attr('text-anchor', 'end').text(`↑ ${metaA.name} lidera`);
        g.append('text').attr('fill', metaB.color).attr('font-size', '10px').attr('opacity', 0.7)
            .attr('x', w - 4).attr('y', ySc(-yAbs * 0.7)).attr('text-anchor', 'end').text(`↓ ${metaB.name} lidera`);
    }

    // Stats por classe
    const stEl = document.getElementById('stats-ise-diff');
    if (stEl) {
        const means = {};
        ISE_TERCIL_ORDER.forEach(t => {
            const vData = diff.filter(d => d.t === t);
            means[t] = vData.length ? (vData.reduce((s, d) => s + d.y, 0) / vData.length).toFixed(1) : '—';
        });
        stEl.innerHTML = `
      <div>Cl. baixa: <span style="font-weight:700;color:var(--text);">${means.baixo !== '—' ? (means.baixo >= 0 ? '+' : '') + means.baixo + '%' : '—'}</span></div>
      <div>Cl. média: <span style="font-weight:700;color:var(--text);">${means.medio !== '—' ? (means.medio >= 0 ? '+' : '') + means.medio + '%' : '—'}</span></div>
      <div>Cl. alta: <span style="font-weight:700;color:var(--text);">${means.alto !== '—' ? (means.alto >= 0 ? '+' : '') + means.alto + '%' : '—'}</span></div>
      <div style="margin-left:auto;">Δ Coef(β): <span style="font-weight:700;color:${reg.slope >= 0 ? '#88c0d0' : '#bf616a'};">${reg.slope >= 0 ? '+' : ''}${reg.slope.toFixed(3)}</span></div>`;
    }
}

// Global toggle logic
window.toggleIseFilter = function (tercil) {
    if (!window.STATE) window.STATE = {};

    if (window.STATE.iseFilter === tercil) {
        // Se clicar no que já tá ativo, limpa (volta pro all)
        window.STATE.iseFilter = 'all';
    } else {
        window.STATE.iseFilter = tercil;
    }

    // FIX Bug 4: fallback explícito para evitar undefined quando app.js não exporta currentTurno
    if (typeof window.updateISEPanel === 'function' && window.currentLayer) {
        const p = window._isePendingArgs || {};
        window.updateISEPanel(
            p.currentLayer || window.currentLayer,
            p.currentCargo || window.currentCargo,
            p.currentTurno || window.currentTurno || 1
        );
    }

    // Dispara a ocultação visual não-destrutiva via Canvas
    if (typeof window.applyIseMapFilter === 'function') {
        window.applyIseMapFilter();
    }
};

// Canvas Filter (Non-Destructive)
window.applyIseMapFilter = function () {
    if (!window.currentLayer || !window.iseDataMap) return;

    const filter = window.STATE?.iseFilter || 'all';

    window.currentLayer.eachLayer(layer => {
        if (!layer.feature || !layer.feature.properties) return;

        // Guarda o raio original se ainda não tiver guardado (aplica para circleMarkers)
        if (layer.options && layer.options.originalRadius === undefined) {
            layer.options.originalRadius = layer.options.radius || 6;
        }

        let isVisible = true;

        if (filter !== 'all') {
            const props = layer.feature.properties;
            const gp = window.getProp || function (p, k) { return p[k]; };
            const locId = getIseSelectionId(props);
            const classData = window.iseDataMap.get(locId);
            if (classData !== filter) {
                isVisible = false;
            }
        }

        if (typeof layer.setStyle === 'function') {
            if (isVisible) {
                // Restaura estilo original (chamando getFeatureStyle do app.js se existir)
                if (typeof window.getFeatureStyle === 'function') {
                    layer.setStyle(window.getFeatureStyle(layer.feature));
                } else {
                    layer.setStyle({ opacity: 1, fillOpacity: 0.8 });
                }

                // Restaura o raio original se possível
                if (typeof layer.setRadius === 'function' && layer.options.originalRadius) {
                    layer.setRadius(layer.options.originalRadius);
                }
            } else {
                // Esconde de forma segura para Canvas (opacidade 0 e sem borda)
                layer.setStyle({ opacity: 0, fillOpacity: 0, stroke: false });

                // Zera o raio para evitar que o ponto intercepte tooltips invisíveis
                if (typeof layer.setRadius === 'function') {
                    layer.setRadius(0);
                }
            }
        }
    });
};
