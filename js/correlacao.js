/**
 * correlacao.js
 * Modo "Correlação Cruzada" para o Visualizador Eleitoral
 * Permite correlacionar QUALQUER fator demográfico no eixo X com QUALQUER outro no eixo Y
 * Os pontos são coloridos pelo candidato vencedor ou por um candidato selecionado
 *
 * INTEGRAÇÃO: Inclua este script após ise.js no index.html:
 *   <script src="correlacao.js"></script>
 *
 * Adicione o botão de modo no HTML (dentro do bloco .ise-mode-pills, após o botão "Fator Demog."):
 *   <button class="ise-mode-pill" id="iseAnalysisModeCorr"
 *       onclick="window.setIseAnalysisMode('correlacao')" style="flex:1;">
 *       ⊕ Correlação
 *   </button>
 */

// ─────────────────────────────────────────────────────────────────────────────
//  DEFINIÇÃO DE TODOS OS EIXOS DISPONÍVEIS
//  Estrutura: { id, label, group, groupColor, unit, ... }
// ─────────────────────────────────────────────────────────────────────────────
const CORR_AXES = [
    // ── Renda ──────────────────────────────────────────────────────────────
    { id: 'renda_media', label: 'Renda Média', group: 'Renda', groupColor: '#f5c842', unit: 'R$', isCurrency: true },

    // ── Gênero ─────────────────────────────────────────────────────────────
    { id: 'mulheres',    label: 'Mulheres',    group: 'Gênero', groupColor: '#c084fc', unit: '%' },
    { id: 'homens',      label: 'Homens',      group: 'Gênero', groupColor: '#c084fc', unit: '%' },

    // ── Cor/Raça ───────────────────────────────────────────────────────────
    { id: 'branca',      label: 'Branca',      group: 'Cor/Raça', groupColor: '#fb923c', unit: '%', keys: ['Pct Branca', 'PCT BRANCA'] },
    { id: 'preta',       label: 'Preta',       group: 'Cor/Raça', groupColor: '#fb923c', unit: '%', keys: ['Pct Preta', 'PCT PRETA'] },
    { id: 'parda',       label: 'Parda',       group: 'Cor/Raça', groupColor: '#fb923c', unit: '%', keys: ['Pct Parda', 'PCT PARDA'] },
    { id: 'amarela',     label: 'Amarela',     group: 'Cor/Raça', groupColor: '#fb923c', unit: '%', keys: ['Pct Amarela', 'PCT AMARELA'] },
    { id: 'indigena',    label: 'Indígena',    group: 'Cor/Raça', groupColor: '#fb923c', unit: '%', keys: ['Pct Indigena', 'PCT INDIGENA'] },

    // ── Faixa Etária ───────────────────────────────────────────────────────
    { id: 'idade_16_24', label: '16–24 anos',  group: 'Faixa Etária', groupColor: '#34d399', unit: '%', ageRange: [16, 24] },
    { id: 'idade_25_34', label: '25–34 anos',  group: 'Faixa Etária', groupColor: '#34d399', unit: '%', ageRange: [25, 34] },
    { id: 'idade_35_44', label: '35–44 anos',  group: 'Faixa Etária', groupColor: '#34d399', unit: '%', ageRange: [35, 44] },
    { id: 'idade_45_59', label: '45–59 anos',  group: 'Faixa Etária', groupColor: '#34d399', unit: '%', ageRange: [45, 59] },
    { id: 'idade_60_74', label: '60–74 anos',  group: 'Faixa Etária', groupColor: '#34d399', unit: '%', ageRange: [60, 74] },
    { id: 'idade_75p',   label: '75+ anos',    group: 'Faixa Etária', groupColor: '#34d399', unit: '%', ageRange: [75, 200] },

    // ── Escolaridade ───────────────────────────────────────────────────────
    { id: 'analfabeto',  label: 'Analfabeto',  group: 'Escolaridade', groupColor: '#60a5fa', unit: '%', isAbs: true, keys: ['ANALFABETO', 'Analfabeto'] },
    { id: 'le_escreve',  label: 'Lê/Escreve',  group: 'Escolaridade', groupColor: '#60a5fa', unit: '%', isAbs: true, keys: ['LÊ E ESCREVE', 'LE E ESCREVE', 'Lê e Escreve'] },
    { id: 'fund_incomp', label: 'Fund. Inc.',   group: 'Escolaridade', groupColor: '#60a5fa', unit: '%', isAbs: true, keys: ['ENSINO FUNDAMENTAL INCOMPLETO', 'FUNDAMENTAL INCOMPLETO'] },
    { id: 'fund_comp',   label: 'Fund. Comp.',  group: 'Escolaridade', groupColor: '#60a5fa', unit: '%', isAbs: true, keys: ['ENSINO FUNDAMENTAL COMPLETO', 'FUNDAMENTAL COMPLETO'] },
    { id: 'med_incomp',  label: 'Méd. Inc.',   group: 'Escolaridade', groupColor: '#60a5fa', unit: '%', isAbs: true, keys: ['ENSINO MÉDIO INCOMPLETO', 'MEDIO INCOMPLETO'] },
    { id: 'med_comp',    label: 'Méd. Comp.',  group: 'Escolaridade', groupColor: '#60a5fa', unit: '%', isAbs: true, keys: ['ENSINO MÉDIO COMPLETO', 'MEDIO COMPLETO'] },
    { id: 'sup_incomp',  label: 'Sup. Inc.',   group: 'Escolaridade', groupColor: '#60a5fa', unit: '%', isAbs: true, keys: ['ENSINO SUPERIOR INCOMPLETO', 'SUPERIOR INCOMPLETO'] },
    { id: 'sup_comp',    label: 'Sup. Comp.',  group: 'Escolaridade', groupColor: '#60a5fa', unit: '%', isAbs: true, keys: ['ENSINO SUPERIOR COMPLETO', 'SUPERIOR COMPLETO', 'Superior Completo'] },

    // ── Estado Civil ───────────────────────────────────────────────────────
    { id: 'solteiro',    label: 'Solteiro',    group: 'Estado Civil', groupColor: '#f472b6', unit: '%', isAbs: true, keys: ['SOLTEIRO', 'Solteiro'] },
    { id: 'casado',      label: 'Casado',      group: 'Estado Civil', groupColor: '#f472b6', unit: '%', isAbs: true, keys: ['CASADO', 'Casado'] },
    { id: 'divorciado',  label: 'Divorciado',  group: 'Estado Civil', groupColor: '#f472b6', unit: '%', isAbs: true, keys: ['DIVORCIADO', 'Divorciado'] },
    { id: 'separado',    label: 'Separado',    group: 'Estado Civil', groupColor: '#f472b6', unit: '%', isAbs: true, keys: ['SEPARADO JUDICIALMENTE', 'SEPARADO', 'Separado'] },
    { id: 'viuvo',       label: 'Viúvo',       group: 'Estado Civil', groupColor: '#f472b6', unit: '%', isAbs: true, keys: ['VIÚVO', 'VIUVO', 'Viúvo', 'Viuvo'] },

    // ── Saneamento ─────────────────────────────────────────────────────────
    { id: 'esg_rede',    label: 'Rede Geral',  group: 'Saneamento', groupColor: '#a3e635', unit: '%', keys: ['Pct Esgoto Rede Geral'] },
    { id: 'esg_fossa',   label: 'Fossa Sép.', group: 'Saneamento', groupColor: '#a3e635', unit: '%', keys: ['Pct Fossa Septica', 'Pct Fossa Séptica'] },
    { id: 'esg_inad',    label: 'Esg. Inad.', group: 'Saneamento', groupColor: '#a3e635', unit: '%', keys: ['Pct Esgoto Inadequado'] },

    // ── Desempenho de candidato (eixo Y especial) ──────────────────────────
    { id: '_votos',      label: '% Votos (candidato)', group: 'Eleitoral', groupColor: '#38bdf8', unit: '%', _isVotos: true },
    { id: '_turnout',    label: 'Turnout',       group: 'Eleitoral', groupColor: '#38bdf8', unit: '%', _isTurnout: true },
    { id: '_ise',        label: 'Índice ISE',    group: 'Eleitoral', groupColor: '#f5c842', unit: 'pts', _isISE: true },
];

// Lookup rápido por id
const CORR_AXIS_MAP = Object.fromEntries(CORR_AXES.map(a => [a.id, a]));

// ─────────────────────────────────────────────────────────────────────────────
//  ESTADO GLOBAL do modo Correlação
// ─────────────────────────────────────────────────────────────────────────────
if (!window.CORR_STATE) window.CORR_STATE = {
    axisX: 'mulheres',
    axisY: 'sup_comp',
    colorBy: 'winner',   // 'winner' | 'candidate' | fator (ex: 'renda_media')
    colorCandKey: null,  // chave do candidato quando colorBy==='candidate'
};

// ─────────────────────────────────────────────────────────────────────────────
//  EXTRAÇÃO DE VALOR DE EIXO
// ─────────────────────────────────────────────────────────────────────────────
function _getCorrAxisValue(props, axisDef, currentCargo, candKey) {
    if (!axisDef) return -1;

    // ── Valor de votos de um candidato ────────────────────────────────────
    if (axisDef._isVotos) {
        if (!candKey || !currentCargo) return -1;
        let votosValidos = 0, votosCand = 0;
        const t = window.currentTurno || 1;
        const turnoKey = (t === 2 && window.STATE?.dataHas2T?.[currentCargo]) ? '2T' : '1T';
        const keys = window.STATE?.candidates?.[currentCargo]?.[turnoKey] || [];
        keys.forEach(k => {
            const v = Number(window.getProp ? window.getProp(props, k) : props[k]) || 0;
            votosValidos += v;
            if (k === candKey) votosCand = v;
        });
        return votosValidos > 0 ? (votosCand / votosValidos) * 100 : -1;
    }

    // ── Turnout ───────────────────────────────────────────────────────────
    if (axisDef._isTurnout) {
        const t = window.currentTurno || 1;
        const turnoKey = (t === 2 && window.STATE?.dataHas2T?.[currentCargo]) ? '2T' : '1T';
        const stats = window.getFeatureTurnoutStats?.(props, currentCargo, turnoKey);
        return stats?.pct ?? -1;
    }

    // ── ISE composto ──────────────────────────────────────────────────────
    if (axisDef._isISE) {
        // Recalcula o ISE inline (mesmo algoritmo do processISEData)
        const gp = window.getPropVal || function(p, keys) {
            for (const k of keys) {
                if (p[k] !== undefined) return Number(String(p[k]).replace(',','.')) || 0;
            }
            return 0;
        };
        const renda = gp(props, ['Renda Media', 'RENDA MEDIA', 'renda']);
        if (renda <= 0) return -1;
        const sc = gp(props, ['ENSINO SUPERIOR COMPLETO', 'SUPERIOR COMPLETO', 'Superior Completo']);
        const totalEsc = ['ANALFABETO','LÊ E ESCREVE','LE E ESCREVE','ENSINO FUNDAMENTAL INCOMPLETO',
            'ENSINO FUNDAMENTAL COMPLETO','ENSINO MÉDIO INCOMPLETO','ENSINO MÉDIO COMPLETO',
            'ENSINO SUPERIOR INCOMPLETO'].reduce((s, k) => s + (Number(props[k]) || 0), 0) + sc;
        const pctSup = totalEsc > 0 ? (sc / totalEsc) * 100 : 0;
        const esgGeral = gp(props, ['Pct Esgoto Rede Geral']);
        const esgFossa = gp(props, ['Pct Fossa Septica','Pct Fossa Séptica']);
        const esgInad  = gp(props, ['Pct Esgoto Inadequado']);
        const esqTotal = esgGeral + esgFossa + esgInad;
        const esgFinal = esqTotal > 0 ? (esgGeral / esqTotal) * 100 : esgGeral;
        const nRenda = Math.min((renda / 6000) * 100, 100);
        return (nRenda * 0.40) + (pctSup * 0.40) + (esgFinal * 0.15);
    }

    // ── Renda ─────────────────────────────────────────────────────────────
    if (axisDef.id === 'renda_media') {
        const v = typeof getPropVal === 'function'
            ? getPropVal(props, ['Renda Media', 'RENDA MEDIA', 'renda'])
            : (Number(props['Renda Media']) || Number(props['RENDA MEDIA']) || 0);
        return v > 0 ? v : -1;
    }

    // ── Demais fatores: delega para _getFactorValue do ise.js ─────────────
    if (typeof _getFactorValue === 'function') {
        return _getFactorValue(props, axisDef);
    }

    return -1;
}

// ─────────────────────────────────────────────────────────────────────────────
//  COLETA DE DADOS para o scatter
// ─────────────────────────────────────────────────────────────────────────────
function _buildCorrData(features, currentCargo, axisXDef, axisYDef, colorBy, colorCandKey) {
    const gp = window.getProp || ((p,k) => p[k]);
    const t = window.currentTurno || 1;
    const turnoKey = (t === 2 && window.STATE?.dataHas2T?.[currentCargo]) ? '2T' : '1T';
    const validKeys = window.STATE?.candidates?.[currentCargo]?.[turnoKey] || [];

    const points = [];

    features.forEach(f => {
        const p = f.properties;

        // Filtra prisões
        const locName = String(gp(p, 'nm_locvot') || gp(p, 'NM_LOCVOT') || '').toUpperCase();
        if (locName.match(/PRES[IÍ]DIO|PENITENCI|COMPLEXO PEN|CADEIA|PENAL|DETEN[CÇ]/i)) return;

        // Localização selecionada
        const locId = typeof getIseSelectionId === 'function' ? getIseSelectionId(p) : '';
        if (window.selectedLocationIDs?.size > 0 && !window.selectedLocationIDs.has(String(locId))) return;

        const xVal = _getCorrAxisValue(p, axisXDef, currentCargo, colorCandKey);
        const yVal = _getCorrAxisValue(p, axisYDef, currentCargo, colorCandKey);
        if (xVal < 0 || yVal < 0) return;

        // Cor por candidato vencedor ou candidato específico
        let color = 'rgba(180,180,180,0.6)';
        let label = '';

        if (colorBy === 'winner' || colorBy === 'candidate') {
            let votosValidos = 0;
            let winnerKey = null, winnerVotos = 0;
            const watchKey = colorBy === 'candidate' ? colorCandKey : null;
            let watchVotos = 0;

            validKeys.forEach(k => {
                const v = Number(window.getProp ? window.getProp(p, k) : p[k]) || 0;
                votosValidos += v;
                if (v > winnerVotos) { winnerVotos = v; winnerKey = k; }
                if (k === watchKey) watchVotos = v;
            });

            if (votosValidos === 0) return;

            if (colorBy === 'winner' && winnerKey) {
                let meta = null;
                if (typeof window.parseCandidateKey === 'function') meta = window.parseCandidateKey(winnerKey);
                if (meta && window.getColorForCandidate) {
                    color = window.getColorForCandidate(meta.nome, meta.partido);
                    label = meta.nome;
                } else {
                    color = '#888';
                }
            } else if (colorBy === 'candidate' && colorCandKey) {
                let meta = null;
                if (typeof window.parseCandidateKey === 'function') meta = window.parseCandidateKey(colorCandKey);
                if (meta && window.getColorForCandidate) {
                    color = window.getColorForCandidate(meta.nome, meta.partido);
                    label = meta.nome;
                }
                // Intensidade proporcional ao % de votos
                const pct = votosValidos > 0 ? watchVotos / votosValidos : 0;
                // Armazena pct para uso posterior na opacidade
                points.push({
                    x: axisXDef.isCurrency ? xVal : Math.min(100, Math.max(0, xVal)),
                    y: axisYDef.isCurrency ? yVal : Math.min(100, Math.max(0, yVal)),
                    color,
                    alpha: 0.2 + pct * 0.75,
                    nm: gp(p, 'nm_locvot') || gp(p, 'NM_LOCVOT') || ('Local ' + locId),
                    bairro: String(gp(p, 'ds_bairro') || gp(p, 'NM_BAIRRO') || ''),
                    cidade: String(gp(p, 'nm_localidade') || gp(p, 'NM_LOCALIDADE') || gp(p, 'nm_municipio') || ''),
                    votosVal: votosValidos,
                    label,
                    pct,
                });
                return;
            }
        }

        points.push({
            x: axisXDef.isCurrency ? xVal : Math.min(100, Math.max(0, xVal)),
            y: axisYDef.isCurrency ? yVal : Math.min(100, Math.max(0, yVal)),
            color,
            alpha: 0.65,
            nm: gp(p, 'nm_locvot') || gp(p, 'NM_LOCVOT') || ('Local ' + locId),
            bairro: String(gp(p, 'ds_bairro') || gp(p, 'NM_BAIRRO') || ''),
            cidade: String(gp(p, 'nm_localidade') || gp(p, 'NM_LOCALIDADE') || gp(p, 'nm_municipio') || ''),
            votosVal: 0,
            label,
            pct: 0,
        });
    });

    return points;
}

// ─────────────────────────────────────────────────────────────────────────────
//  TOOLTIP reutilizado
// ─────────────────────────────────────────────────────────────────────────────
let _corrTooltip = null;
function _getCorrTooltip() {
    if (_corrTooltip) return _corrTooltip;
    _corrTooltip = document.createElement('div');
    _corrTooltip.id = 'corr-tooltip';
    _corrTooltip.style.cssText = 'display:none;position:fixed;z-index:10001;pointer-events:none;'+
        'background:rgba(18,18,22,0.96);border:1px solid rgba(255,255,255,0.1);border-radius:10px;'+
        'padding:10px 14px;min-width:200px;max-width:320px;width:max-content;'+
        'backdrop-filter:blur(12px);box-shadow:0 8px 32px rgba(0,0,0,0.45);font-family:inherit;font-size:13px;color:#f0f0f0;';
    document.body.appendChild(_corrTooltip);
    return _corrTooltip;
}
function _showCorrTT(e, d, axX, axY) {
    const tt = _getCorrTooltip();
    const xFmt = axX.isCurrency ? `R$ ${d.x.toLocaleString('pt-BR',{maximumFractionDigits:0})}` : `${d.x.toFixed(1)}%`;
    const yFmt = axY.isCurrency ? `R$ ${d.y.toLocaleString('pt-BR',{maximumFractionDigits:0})}` : `${d.y.toFixed(1)}%`;
    const pctStr = d.pct > 0 ? `<div style="margin-top:4px;font-size:11px;color:rgba(255,255,255,0.5);">% votos: <strong style="color:#f0f0f0">${(d.pct*100).toFixed(1)}%</strong></div>` : '';
    tt.innerHTML = `
        <div style="font-weight:600;margin-bottom:6px;line-height:1.3;">${d.nm}</div>
        ${(d.cidade||d.bairro) ? `<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:6px;">${[d.cidade,d.bairro].filter(Boolean).join(' · ')}</div>` : ''}
        <div style="display:flex;gap:12px;">
            <div><div style="font-size:9px;text-transform:uppercase;letter-spacing:0.8px;color:rgba(255,255,255,0.35);margin-bottom:2px;">${axX.label}</div><div style="font-size:16px;font-weight:700;">${xFmt}</div></div>
            <div style="width:1px;background:rgba(255,255,255,0.1);"></div>
            <div><div style="font-size:9px;text-transform:uppercase;letter-spacing:0.8px;color:rgba(255,255,255,0.35);margin-bottom:2px;">${axY.label}</div><div style="font-size:16px;font-weight:700;">${yFmt}</div></div>
        </div>
        ${pctStr}
    `;
    tt.style.display = 'block';
    _moveCorrTT(e);
}
function _moveCorrTT(e) {
    const tt = _getCorrTooltip();
    const x = e.clientX + 14, y = e.clientY - 10;
    const w = tt.offsetWidth, h = tt.offsetHeight;
    tt.style.left = (x + w > window.innerWidth ? x - w - 28 : x) + 'px';
    tt.style.top = (y + h > window.innerHeight ? y - h : y) + 'px';
}
function _hideCorrTT() { _getCorrTooltip().style.display = 'none'; }

// ─────────────────────────────────────────────────────────────────────────────
//  DESENHO DO SCATTER
// ─────────────────────────────────────────────────────────────────────────────
function _drawCorrScatter(container, points, axisXDef, axisYDef) {
    container.innerHTML = '';
    if (!points || points.length < 3) {
        container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);font-size:13px;">Dados insuficientes para a combinação selecionada.</div>';
        return;
    }

    const W = Math.max(container.clientWidth || 400, 300);
    const H = Math.min(360, Math.max(240, W * 0.60));
    const mg = { top: 14, right: 18, bottom: 48, left: axisYDef.isCurrency ? 70 : 46 };
    const w = W - mg.left - mg.right;
    const h = H - mg.top - mg.bottom;

    const xExt = d3.extent(points, d => d.x);
    const yExt = d3.extent(points, d => d.y);
    const xPad = (xExt[1] - xExt[0]) * 0.04 || 1;
    const yPad = (yExt[1] - yExt[0]) * 0.06 || 1;

    const xSc = d3.scaleLinear()
        .domain([Math.max(0, xExt[0] - xPad), xExt[1] + xPad])
        .range([0, w]);
    const ySc = d3.scaleLinear()
        .domain([Math.max(0, yExt[0] - yPad), yExt[1] + yPad])
        .range([h, 0]);

    const svg = d3.select(container).append('svg').attr('width', W).attr('height', H);
    const g   = svg.append('g').attr('transform', `translate(${mg.left},${mg.top})`);

    // Grid
    g.selectAll('.cgx').data(xSc.ticks(6)).enter().append('line')
        .attr('x1', d => xSc(d)).attr('x2', d => xSc(d)).attr('y1', 0).attr('y2', h)
        .attr('stroke','rgba(255,255,255,0.05)').attr('stroke-width', 1);
    g.selectAll('.cgy').data(ySc.ticks(5)).enter().append('line')
        .attr('x1', 0).attr('x2', w).attr('y1', d => ySc(d)).attr('y2', d => ySc(d))
        .attr('stroke','rgba(255,255,255,0.05)').attr('stroke-width', 1);

    // Axes
    const xTickFmt = axisXDef.isCurrency
        ? d => `R$${(d/1000).toFixed(0)}k`
        : d => d + '%';
    const yTickFmt = axisYDef.isCurrency
        ? d => `R$${(d/1000).toFixed(0)}k`
        : d => d + '%';

    g.append('g').attr('transform', `translate(0,${h})`)
        .call(d3.axisBottom(xSc).ticks(6).tickSize(0).tickFormat(xTickFmt))
        .call(a => { a.select('.domain').attr('stroke','var(--border)'); a.selectAll('.tick text').attr('fill','var(--muted)').attr('dy','1.2em').style('font-size','10px'); });
    g.append('g')
        .call(d3.axisLeft(ySc).ticks(5).tickSize(0).tickFormat(yTickFmt))
        .call(a => { a.select('.domain').attr('stroke','var(--border)'); a.selectAll('.tick text').attr('fill','var(--muted)').attr('dx','-.3em').style('font-size','10px'); });

    // Axis labels
    g.append('text').attr('fill','var(--muted)').attr('font-size','11px')
        .attr('x', w/2).attr('y', h + 38).attr('text-anchor','middle')
        .text(axisXDef.label + ' →');
    g.append('text').attr('fill','var(--muted)').attr('font-size','11px')
        .attr('transform','rotate(-90)').attr('x',-h/2).attr('y', -(mg.left - 12))
        .attr('text-anchor','middle')
        .text('← ' + axisYDef.label + ' →');

    // Linha de regressão
    const reg = typeof linReg === 'function' ? linReg(points) : { slope: 0, intercept: 0, r2: 0 };
    const x0d = xSc.domain()[0], x1d = xSc.domain()[1];
    g.append('line')
        .attr('x1', xSc(x0d)).attr('x2', xSc(x1d))
        .attr('y1', ySc(Math.max(ySc.domain()[0], Math.min(ySc.domain()[1], reg.slope * x0d + reg.intercept))))
        .attr('y2', ySc(Math.max(ySc.domain()[0], Math.min(ySc.domain()[1], reg.slope * x1d + reg.intercept))))
        .attr('stroke','rgba(255,255,255,0.4)').attr('stroke-width', 2).attr('stroke-dasharray','5,3');

    // R² / β badge
    g.append('text').attr('fill','var(--text)').attr('font-size','11px').attr('font-weight','bold')
        .attr('x', w - 4).attr('y', 14).attr('text-anchor','end')
        .text(`r²=${reg.r2.toFixed(3)}  β=${reg.slope >= 0 ? '+' : ''}${reg.slope.toFixed(3)}`);

    // Pontos — ordenados para os menos opacos ficarem atrás
    const sorted = [...points].sort((a,b) => (a.alpha||0.65) - (b.alpha||0.65));
    g.selectAll('.corr-pt').data(sorted).enter().append('circle')
        .attr('class','corr-pt')
        .attr('cx', d => xSc(d.x))
        .attr('cy', d => ySc(d.y))
        .attr('r', 3)
        .attr('fill', d => d.color)
        .attr('fill-opacity', d => d.alpha || 0.65)
        .attr('stroke','#000').attr('stroke-width', 0.5).attr('stroke-opacity', 0.3)
        .on('mouseover', (e, d) => _showCorrTT(e, d, axisXDef, axisYDef))
        .on('mousemove', e => _moveCorrTT(e))
        .on('mouseout', () => _hideCorrTT());

    // Stats rodapé
    const statEl = document.createElement('div');
    statEl.style.cssText = 'display:flex;gap:16px;margin-top:10px;font-size:11px;color:var(--muted);justify-content:center;flex-wrap:wrap;border-top:1px dashed var(--border);padding-top:8px;';
    const n = points.length;
    const meanX = points.reduce((s,d)=>s+d.x,0)/n;
    const meanY = points.reduce((s,d)=>s+d.y,0)/n;
    const fmtX = axisXDef.isCurrency ? `R$ ${meanX.toLocaleString('pt-BR',{maximumFractionDigits:0})}` : `${meanX.toFixed(1)}%`;
    const fmtY = axisYDef.isCurrency ? `R$ ${meanY.toLocaleString('pt-BR',{maximumFractionDigits:0})}` : `${meanY.toFixed(1)}%`;
    statEl.innerHTML = `<span>n = ${n} locais</span>
        <span>Média ${axisXDef.label}: <strong style="color:var(--text)">${fmtX}</strong></span>
        <span>Média ${axisYDef.label}: <strong style="color:var(--text)">${fmtY}</strong></span>
        <span style="margin-left:auto;">Coef(β): <strong style="color:${reg.slope>=0?'#88c0d0':'#bf616a'}">${reg.slope>=0?'+':''}${reg.slope.toFixed(3)}</strong></span>`;
    container.appendChild(statEl);
}

// ─────────────────────────────────────────────────────────────────────────────
//  RENDERIZA SELETOR DE EIXO (dropdown agrupado)
// ─────────────────────────────────────────────────────────────────────────────
function _renderAxisDropdown(selectId, labelText, selectedId, onChange, excludeId) {
    const groups = {};
    CORR_AXES.forEach(a => {
        if (a.id === excludeId) return;
        if (!groups[a.group]) groups[a.group] = [];
        groups[a.group].push(a);
    });

    let html = `<div style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:120px;">
        <label style="font-size:10px;text-transform:uppercase;letter-spacing:0.6px;color:var(--muted);margin-bottom:2px;">${labelText}</label>
        <select id="${selectId}" style="background:var(--bg-secondary,rgba(255,255,255,0.07));color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:12px;cursor:pointer;width:100%;">`;
    Object.entries(groups).forEach(([groupName, axes]) => {
        html += `<optgroup label="${groupName}">`;
        axes.forEach(a => {
            html += `<option value="${a.id}" ${a.id === selectedId ? 'selected' : ''}>${a.label}</option>`;
        });
        html += `</optgroup>`;
    });
    html += `</select></div>`;
    return html;
}

// ─────────────────────────────────────────────────────────────────────────────
//  RENDERIZA SELETOR DE COLORAÇÃO
// ─────────────────────────────────────────────────────────────────────────────
function _buildColorBySelector(allKeys, candMetas) {
    const s = window.CORR_STATE;
    let html = `<div style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:130px;">
        <label style="font-size:10px;text-transform:uppercase;letter-spacing:0.6px;color:var(--muted);margin-bottom:2px;">Colorir por</label>
        <select id="corrColorBy" style="background:var(--bg-secondary,rgba(255,255,255,0.07));color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:12px;cursor:pointer;width:100%;">
            <option value="winner" ${s.colorBy==='winner'?'selected':''}>Vencedor local</option>`;
    allKeys.forEach(k => {
        const { name } = candMetas[k] || { name: k };
        html += `<option value="cand_${k}" ${s.colorBy==='candidate'&&s.colorCandKey===k?'selected':''}>% votos: ${name}</option>`;
    });
    html += `</select></div>`;
    return html;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PONTO DE ENTRADA PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
window.renderCorrPanel = function(chartsContainer, features, allKeys, candMetas, currentCargo) {
    if (!chartsContainer) return;
    chartsContainer.innerHTML = '';

    if (!features || features.length < 5) {
        chartsContainer.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px;">Dados insuficientes para correlação.</div>';
        return;
    }

    const s = window.CORR_STATE;

    // ── Cabeçalho de controles ────────────────────────────────────────────
    const controls = document.createElement('div');
    controls.style.cssText = 'padding:0 16px 14px;display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;';

    controls.innerHTML =
        _renderAxisDropdown('corrAxisX', 'Eixo X', s.axisX, null, null) +
        '<div style="align-self:flex-end;padding-bottom:8px;font-size:18px;color:var(--muted);">×</div>' +
        _renderAxisDropdown('corrAxisY', 'Eixo Y', s.axisY, null, s.axisX) +
        _buildColorBySelector(allKeys, candMetas);

    chartsContainer.appendChild(controls);

    // ── Legenda de coloração (por vencedor) ───────────────────────────────
    const legendEl = document.createElement('div');
    legendEl.id = 'corrLegend';
    legendEl.style.cssText = 'padding:0 16px 10px;display:flex;flex-wrap:wrap;gap:8px;font-size:11px;';
    chartsContainer.appendChild(legendEl);

    // ── Área do gráfico ───────────────────────────────────────────────────
    const chartArea = document.createElement('div');
    chartArea.id = 'corrChartArea';
    chartArea.style.cssText = 'padding:0 16px;';
    chartsContainer.appendChild(chartArea);

    // ── Nota metodológica ─────────────────────────────────────────────────
    const nota = document.createElement('div');
    nota.style.cssText = 'padding:12px 16px 4px;font-size:10px;color:var(--muted);line-height:1.5;border-top:1px dashed var(--border);margin-top:8px;';
    nota.innerHTML = `<em>Correlação cruzada entre fatores demográficos. Cada ponto = um local de votação. A linha de tendência (regressão linear) mostra a direção e força da correlação. r² próximo de 1 = forte correlação. β = inclinação da reta (mudança em Y por unidade de X).</em>`;
    chartsContainer.appendChild(nota);

    // ── Render inicial ────────────────────────────────────────────────────
    function _render() {
        const axX = CORR_AXIS_MAP[s.axisX];
        const axY = CORR_AXIS_MAP[s.axisY];
        if (!axX || !axY) return;

        let colorCandKey = null;
        if (s.colorBy === 'candidate') colorCandKey = s.colorCandKey;

        const points = _buildCorrData(features, currentCargo, axX, axY, s.colorBy, colorCandKey);

        _drawCorrScatter(chartArea, points, axX, axY);

        // Legenda por vencedor
        legendEl.innerHTML = '';
        if (s.colorBy === 'winner') {
            const seenColors = new Map(); // color → name
            points.forEach(d => {
                if (d.label && !seenColors.has(d.color)) seenColors.set(d.color, d.label);
            });
            // Conta quantos pontos por candidato
            const counts = {};
            points.forEach(d => { if (d.label) counts[d.label] = (counts[d.label]||0)+1; });
            const sorted = [...seenColors.entries()].sort((a,b) => (counts[b[1]]||0)-(counts[a[1]]||0));
            sorted.slice(0, 8).forEach(([color, name]) => {
                const item = document.createElement('div');
                item.style.cssText = 'display:flex;align-items:center;gap:4px;';
                item.innerHTML = `<div style="width:9px;height:9px;border-radius:50%;background:${color};flex-shrink:0;"></div><span style="color:var(--muted)">${name} <span style="color:rgba(255,255,255,0.3)">(${counts[name]||0})</span></span>`;
                legendEl.appendChild(item);
            });
        } else if (s.colorBy === 'candidate' && colorCandKey) {
            const meta = candMetas[colorCandKey];
            if (meta) {
                legendEl.innerHTML = `<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);">
                    <div style="width:9px;height:9px;border-radius:50%;background:${meta.color};"></div>
                    <span>Opacidade proporcional ao <strong style="color:${meta.color}">% votos ${meta.name}</strong></span>
                </div>`;
            }
        }
    }

    _render();

    // ── Event listeners dos controles ─────────────────────────────────────
    function _setupListeners() {
        const selX = document.getElementById('corrAxisX');
        const selY = document.getElementById('corrAxisY');
        const selColor = document.getElementById('corrColorBy');
        if (!selX || !selY || !selColor) return;

        selX.onchange = () => {
            s.axisX = selX.value;
            // Evita eixos iguais
            if (s.axisX === s.axisY) {
                const alt = CORR_AXES.find(a => a.id !== s.axisX);
                s.axisY = alt ? alt.id : s.axisY;
            }
            window.renderCorrPanel(chartsContainer, features, allKeys, candMetas, currentCargo);
        };

        selY.onchange = () => {
            s.axisY = selY.value;
            if (s.axisX === s.axisY) {
                const alt = CORR_AXES.find(a => a.id !== s.axisY);
                s.axisX = alt ? alt.id : s.axisX;
            }
            window.renderCorrPanel(chartsContainer, features, allKeys, candMetas, currentCargo);
        };

        selColor.onchange = () => {
            const val = selColor.value;
            if (val === 'winner') {
                s.colorBy = 'winner';
                s.colorCandKey = null;
            } else if (val.startsWith('cand_')) {
                s.colorBy = 'candidate';
                s.colorCandKey = val.replace('cand_', '');
            }
            _render(); // só re-renderiza o gráfico, não reconstrói os controles
        };
    }

    _setupListeners();
};

// ─────────────────────────────────────────────────────────────────────────────
//  INTEGRAÇÃO com updateISEPanel — intercepta o modo 'correlacao'
// ─────────────────────────────────────────────────────────────────────────────
const _origUpdateISEPanel = window.updateISEPanel;
window.updateISEPanel = function(currentLayer, currentCargo, currentTurno = 1) {
    // Salva args para re-render
    window._isePendingArgs = { currentLayer, currentCargo, currentTurno };

    const analysisMode = window.ISE_FACTOR_STATE?.analysisMode || 'ise';
    if (analysisMode !== 'correlacao') {
        return _origUpdateISEPanel(currentLayer, currentCargo, currentTurno);
    }

    // ── Modo Correlação ───────────────────────────────────────────────────
    const chartsContainer = document.getElementById('iseChartsContent');
    const tabsContainer   = document.getElementById('iseTurnTabs');
    if (!chartsContainer) return;

    // Painel colapsado: não renderiza
    const iseBox = document.getElementById('iseBoxContainer');
    if (iseBox?.classList.contains('collapsed')) return;

    if (!currentLayer) {
        chartsContainer.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px;">Realize uma análise no mapa.</div>';
        if (tabsContainer) tabsContainer.innerHTML = '';
        return;
    }

    // Sincroniza botões de modo
    ['iseAnalysisModeISE','iseAnalysisModeFactor','iseAnalysisModeCorr'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('active',
            id === 'iseAnalysisModeISE'   ? analysisMode === 'ise' :
            id === 'iseAnalysisModeFactor' ? analysisMode === 'factor' :
            analysisMode === 'correlacao');
    });
    const factorBox = document.getElementById('iseFactorSelectorBox');
    if (factorBox) factorBox.style.display = 'none';
    if (tabsContainer) tabsContainer.innerHTML = '';

    // Coleta features (reutiliza lógica do ise.js)
    const baseFeatures = (typeof window.getCurrentVisibleFeatures === 'function' && currentLayer === window.currentLayer)
        ? (window.getCurrentVisibleFeatures() || [])
        : [];
    const features = [];
    const addF = (f) => {
        if (!f?.properties) return;
        let hasCensus = false;
        for (const k in f.properties) {
            const kl = k.toLowerCase();
            if ((kl === 'renda media' || kl === 'renda média' || kl === 'renda') && f.properties[k] > 0) { hasCensus = true; break; }
            // Aceita também dados do TSE (gênero, escolaridade etc)
            if (kl === 'feminino' || kl === 'masculino' || kl === 'solteiro' || kl === 'analfabeto') { hasCensus = true; break; }
        }
        if (hasCensus) features.push(f);
    };
    if (baseFeatures.length) baseFeatures.forEach(addF);
    else currentLayer.eachLayer(l => addF(l.feature));

    if (features.length < 5) {
        chartsContainer.innerHTML = `<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px;">Sem dados suficientes (${features.length} locais com dados censitários).</div>`;
        return;
    }

    // Resolve candidatos
    const t = currentTurno || 1;
    const turnoKey = (t === 2 && window.STATE?.dataHas2T?.[currentCargo]) ? '2T' : '1T';
    const validKeys = window.STATE?.candidates?.[currentCargo]?.[turnoKey] || [];
    const candidatosTotals = {};
    features.forEach(f => {
        const p = f.properties;
        validKeys.forEach(key => {
            const v = Number(window.getProp ? window.getProp(p, key) : p[key]) || 0;
            if (v > 0) candidatosTotals[key] = (candidatosTotals[key] || 0) + v;
        });
    });
    const allKeys = Object.keys(candidatosTotals).sort((a,b) => candidatosTotals[b]-candidatosTotals[a]);
    const candMetas = {};
    allKeys.forEach(key => {
        let name = key.replace(/votos_/i,'').toUpperCase(), color = '#777';
        const meta = typeof window.parseCandidateKey === 'function' ? window.parseCandidateKey(key) : null;
        if (meta) {
            name = meta.nome;
            color = window.getColorForCandidate ? window.getColorForCandidate(meta.nome, meta.partido) : color;
        }
        candMetas[key] = { name, color };
    });

    // Garante que colorCandKey existe
    if (window.CORR_STATE.colorBy === 'candidate' && !window.CORR_STATE.colorCandKey && allKeys.length > 0) {
        window.CORR_STATE.colorCandKey = allKeys[0];
    }

    window.renderCorrPanel(chartsContainer, features, allKeys, candMetas, currentCargo);
};

// ─────────────────────────────────────────────────────────────────────────────
//  HOOK em setIseAnalysisMode para reconhecer 'correlacao'
// ─────────────────────────────────────────────────────────────────────────────
const _origSetMode = window.setIseAnalysisMode;
window.setIseAnalysisMode = function(mode) {
    if (!window.ISE_FACTOR_STATE) window.ISE_FACTOR_STATE = {};
    window.ISE_FACTOR_STATE.analysisMode = mode;

    // Sincroniza visual do botão corr
    const btnCorr = document.getElementById('iseAnalysisModeCorr');
    if (btnCorr) btnCorr.classList.toggle('active', mode === 'correlacao');
    const factorBox = document.getElementById('iseFactorSelectorBox');
    if (factorBox) factorBox.style.display = mode === 'factor' ? 'block' : 'none';

    if (mode === 'correlacao') {
        // Esconde chips de candidatos ISE (não se aplica aqui)
        const filterEl = document.getElementById('iseCandidateFilter');
        if (filterEl) filterEl.style.display = 'none';

        const p = window._isePendingArgs || {};
        window.updateISEPanel(p.currentLayer || window.currentLayer, p.currentCargo || window.currentCargo, p.currentTurno || window.currentTurno || 1);
        return;
    }

    if (typeof _origSetMode === 'function') {
        _origSetMode(mode);
    } else {
        // Fallback: re-trigger updateISEPanel com novo modo
        const p = window._isePendingArgs || {};
        window.updateISEPanel(p.currentLayer || window.currentLayer, p.currentCargo || window.currentCargo, p.currentTurno || window.currentTurno || 1);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
//  INJEÇÃO DO BOTÃO NO HTML (roda ao carregar o script)
// ─────────────────────────────────────────────────────────────────────────────
(function _injectCorrButton() {
    function tryInject() {
        const pillsContainer = document.querySelector('.ise-mode-pills');
        if (!pillsContainer) { setTimeout(tryInject, 300); return; }
        if (document.getElementById('iseAnalysisModeCorr')) return; // já existe

        const btn = document.createElement('button');
        btn.className = 'ise-mode-pill';
        btn.id = 'iseAnalysisModeCorr';
        btn.style.flex = '1';
        btn.onclick = () => window.setIseAnalysisMode('correlacao');
        btn.innerHTML = '⊕ Correlação';
        btn.title = 'Correlacionar dois fatores demográficos entre si';
        pillsContainer.appendChild(btn);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryInject);
    } else {
        tryInject();
    }
})();
