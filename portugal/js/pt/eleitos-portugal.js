// ============================================================================
// eleitos-portugal.js — listagem dos eleitos (Diário da República)
//
// Dados gerados pelo ETL (etl/build_eleitos_*.py) em dados/eleitos/:
//   index.json                — anos disponíveis por tipo de eleição
//   ar_{ano}.json             — deputados por círculo, ordem das listas do DR
//   ee_{ano}.json             — deputados ao PE (círculo único nacional)
//   au_{cm|am}_{ano}.json     — eleitos por concelho (+ presidente)
//   au_af_{ano}_{dd}.json     — eleitos das assembleias de freguesia, por distrito
//
// A lista abre a partir da tabela principal do painel: o número de mandatos
// de cada partido é um botão (.eleitos-seats-btn) que expande uma linha
// inline (.eleitos-party-row) com os eleitos desse partido no âmbito atual —
// mesmo padrão do "Ver composição" das coligações. Um token de estado
// descarta respostas obsoletas quando o utilizador muda de ano/âmbito antes
// de o fetch terminar.
// ============================================================================

let ELEITOS_INDEX = null;
let eleitosIndexPromise = null;
const ELEITOS_CACHE = (typeof LRUCache === 'function') ? new LRUCache(8) : new Map();

function loadEleitosIndex() {
  if (!eleitosIndexPromise) {
    eleitosIndexPromise = fetch(`${DATA_BASE_URL}eleitos/index.json`)
      .then(r => (r.ok ? r.json() : null))
      .then(idx => { ELEITOS_INDEX = idx; return idx; })
      .catch(() => { ELEITOS_INDEX = null; return null; });
  }
  return eleitosIndexPromise;
}

function eleitosAvailable(elType, year, subtype) {
  const idx = ELEITOS_INDEX;
  if (!idx) return false;
  const y = String(year);
  if (elType === 'ar') return (idx.ar || []).includes(y);
  if (elType === 'ee') return (idx.ee || []).includes(y);
  if (elType === 'au') return ((idx.au || {})[subtype] || []).includes(y);
  return false;
}

function eleitosIsPresidenteOnly(year) {
  return !!ELEITOS_INDEX && (ELEITOS_INDEX.au_presidente_only || []).includes(String(year));
}

async function loadEleitosData(elType, year, subtype, distrito) {
  let file;
  if (elType === 'ar') file = `ar_${year}.json`;
  else if (elType === 'ee') file = `ee_${year}.json`;
  else if (subtype === 'af') file = `au_af_${year}_${distrito}.json`;
  else file = `au_${subtype}_${year}.json`;
  const cached = ELEITOS_CACHE.get(file);
  if (cached) return cached;
  const res = await fetch(`${DATA_BASE_URL}eleitos/${file}`);
  if (!res.ok) throw new Error(`eleitos: falha ao carregar ${file} (${res.status})`);
  const data = await res.json();
  ELEITOS_CACHE.set(file, data);
  return data;
}

// token do estado atual: se mudar entre o pedido e a resposta, descarta-se
function eleitosStateToken() {
  const s = STATE.scope || {};
  return [STATE.currentElectionType, STATE.currentYear, STATE.auSubtype,
    s.level || 'national', s.key || '', STATE.currentNuts || ''].join('|');
}

function eleitosFonte(year) {
  return `Fonte: mapa oficial da eleição, Diário da República (${year}). Ordem dos nomes conforme as listas do mapa oficial.`;
}

// ---------- número de mandatos clicável na tabela principal ----------

// níveis de âmbito com listagem nominal disponível
function eleitosSupportedLevel(elType, subtype, level) {
  if (elType === 'ar') return level === 'national' || level === 'distrito';
  if (elType === 'ee') return level === 'national';
  if (elType === 'au') return subtype === 'af' ? level === 'freguesia' : level === 'concelho';
  return false;
}

// decisão síncrona no render do painel: o número de mandatos é um botão?
// (o índice é pré-carregado no arranque; enquanto não chega, não é clicável
// e o próximo render volta a avaliar)
function eleitosSeatsClickable() {
  const elType = STATE.currentElectionType;
  if (elType !== 'ar' && elType !== 'ee' && elType !== 'au') return false;
  if (!ELEITOS_INDEX) return false;
  if (!eleitosAvailable(elType, STATE.currentYear, STATE.auSubtype)) return false;
  const scope = STATE.scope || {};
  return eleitosSupportedLevel(elType, STATE.auSubtype, scope.level || 'national');
}

// ---------- HTML da expansão por partido ----------

function eleitosOlHtml(nomes, opts = {}) {
  let items = '';
  nomes.forEach((nome, i) => {
    const isPres = opts.presidenteIdx === i;
    items += `
      <li style="padding: 3px 0; font-size: 0.78rem; color: var(--text-sec); line-height: 1.35;">
        ${escapeHtml(nome)}${isPres ? ` <span style="background: rgba(245, 158, 11, 0.12); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.55rem; padding: 1px 5px; border-radius: 4px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; margin-left: 4px; white-space: nowrap;">${escapeHtml(opts.presidenteLabel || 'Presidente')}</span>` : ''}
      </li>`;
  });
  return `<ol style="margin: 2px 0 6px 0; padding-left: 24px;">${items}</ol>`;
}

function eleitosExpansionShell(titulo, bodyHtml, year) {
  return `
    <div style="font-size: 0.7rem; font-weight: 700; color: var(--muted); letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 6px; text-align: left;">${escapeHtml(titulo)}</div>
    <div class="eleitos-scroll">${bodyHtml}</div>
    <div style="font-size: 0.62rem; color: var(--muted); font-style: italic; margin-top: 8px; text-align: left;">${escapeHtml(eleitosFonte(year))}</div>`;
}

function getMatchingSiglasForParty(party, year) {
  const y = Number(year);
  const siglas = [party];
  if (party === 'AD') {
    if (y === 2024 || y === 2025) {
      siglas.push('AD Açores', 'PSD-CDS-PPM', 'PSD-CDS', 'Madeira Primeiro', 'PPD/PSD-CDS-PP');
    } else if (y === 1979 || y === 1980) {
      siglas.push('PPD/PSD', 'PSD', 'PPD', 'CDS');
    }
  } else if (party === 'PPD/PSD' || party === 'PSD') {
    if (y === 2022) {
      siglas.push('Madeira Primeiro', 'AD Açores', 'PSD-CDS-PPM', 'PSD-CDS');
    } else if (y === 2015) {
      siglas.push('PàF', 'Aliança Açores', 'CDS-PP.PPM');
    }
  } else if (party === 'PàF') {
    if (y === 2015) {
      siglas.push('PPD/PSD', 'PSD', 'CDS-PP', 'Aliança Açores', 'CDS-PP.PPM');
    }
  } else if (party === 'FRS') {
    if (y === 1980) {
      siglas.push('PS');
    }
  }
  return siglas;
}

// HTML interno da linha expandida com os eleitos do partido no âmbito atual;
// devolve null quando não há lista para este partido/âmbito
function buildEleitosPartyHtml(party, data, elType, subtype, scope) {
  const level = scope?.level || 'national';

  if (elType === 'ar' && level === 'national') {
    // secções por círculo, respeitando o filtro NUTS ativo (códigos numéricos)
    let body = '';
    let totalNomes = 0;
    const matchingSiglas = getMatchingSiglasForParty(party, data.year);
    Object.keys(data.circulos).forEach(code => {
      if (STATE.currentNuts && window.isConcelhoInNuts && /^\d+$/.test(code)) {
        if (!window.isConcelhoInNuts(code + '00')) return;
      }
      const c = data.circulos[code];
      const matchingListas = (c.listas || []).filter(l => matchingSiglas.includes(l.sigla));
      if (!matchingListas.length) return;

      let circleEleitos = [];
      matchingListas.forEach(l => {
        circleEleitos = circleEleitos.concat(l.eleitos || []);
      });
      if (!circleEleitos.length) return;

      totalNomes += circleEleitos.length;
      body += `
        <div style="margin-bottom: 4px;">
          <div style="display: flex; align-items: baseline; gap: 8px; padding: 4px 0 1px;">
            <span style="font-size: 0.75rem; font-weight: 600; color: var(--text-sec);">${escapeHtml(c.nome)}</span>
            <span style="margin-left: auto; font-size: 0.68rem; color: var(--muted); font-variant-numeric: tabular-nums;">${circleEleitos.length}</span>
          </div>
          ${eleitosOlHtml(circleEleitos)}
        </div>`;
    });
    if (!body) return null;
    return eleitosExpansionShell(`Deputados eleitos — ${party} (${totalNomes})`, body, data.year);
  }

  if (elType === 'ar' && level === 'distrito' && scope.key) {
    const c = data.circulos[scope.key];
    const lista = c && (c.listas || []).find(l => l.sigla === party);
    if (!lista || !lista.eleitos.length) return null;
    return eleitosExpansionShell(
      `Deputados eleitos — ${party} · Círculo de ${c.nome}`,
      eleitosOlHtml(lista.eleitos), data.year);
  }

  if (elType === 'ee') {
    const lista = (data.national?.listas || []).find(l => l.sigla === party);
    if (!lista || !lista.eleitos.length) return null;
    return eleitosExpansionShell(
      `Deputados eleitos ao Parlamento Europeu — ${party}`,
      eleitosOlHtml(lista.eleitos), data.year);
  }

  if (elType === 'au' && scope.key) {
    const o = data.orgaos?.[scope.key];
    if (!o) return null;

    if (data.presidente_only) {
      const p = o.presidente;
      if (!p || p.sigla !== party) return null;
      const sw = (typeof getResolvedPartyColor === 'function')
        ? getResolvedPartyColor(p.sigla) : 'var(--muted)';
      const body = `
        <div style="display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: var(--radius-lg);">
          <span style="width: 5px; height: 30px; background: ${sw}; border-radius: 2px; flex: 0 0 auto;"></span>
          <div style="min-width: 0; text-align: left;">
            <div style="font-size: 0.82rem; font-weight: 700; color: var(--text);">${escapeHtml(p.nome)}</div>
            <div style="font-size: 0.68rem; color: var(--muted);">${escapeHtml(p.sigla)} — Presidente da Câmara Municipal eleito</div>
          </div>
        </div>
        <div style="font-size: 0.62rem; color: var(--muted); font-style: italic; margin-top: 8px; text-align: left;">Fonte: CNE / Diário da República (${escapeHtml(String(data.year))}). O mapa oficial deste ano identifica apenas o presidente eleito.</div>`;
      return body;
    }

    const lista = (o.listas || []).find(l => l.sigla === party);
    if (!lista || !lista.eleitos.length) return null;
    const presLabel = subtype === 'cm' ? 'Presidente da Câmara'
      : subtype === 'af' ? 'Presidente da Junta' : null;
    const presidenteIdx = (presLabel && o.presidente && o.presidente.sigla === party) ? 0 : -1;
    const orgao = subtype === 'cm' ? 'Câmara Municipal'
      : subtype === 'am' ? 'Assembleia Municipal' : 'Assembleia de Freguesia';
    return eleitosExpansionShell(
      `${orgao} — eleitos ${party}`,
      eleitosOlHtml(lista.eleitos, { presidenteIdx, presidenteLabel: presLabel }),
      data.year);
  }

  return null;
}

// ---------- toggle da linha expandida (clique no número de mandatos) ----------

async function toggleEleitosPartyRow(btn) {
  const tr = btn.closest('tr');
  if (!tr) return;

  // já criada: só alterna a visibilidade
  const existing = tr._eleitosRow;
  if (existing && existing.isConnected) {
    const isHidden = existing.style.display === 'none';
    existing.style.display = isHidden ? 'table-row' : 'none';
    btn.classList.toggle('open', isHidden);
    return;
  }

  const party = btn.dataset.party || '';
  const token = eleitosStateToken();
  const colspan = tr.children.length;

  const row = document.createElement('tr');
  row.className = 'eleitos-party-row';
  row.innerHTML = `
    <td colspan="${colspan}" style="padding: 10px 12px 12px; background: rgba(0,0,0,0.15); border-bottom: 1px solid var(--border);">
      <div style="font-size: 0.7rem; color: var(--muted); text-align: left;">A carregar a lista de eleitos…</div>
    </td>`;
  // insere depois da eventual linha de composição do próprio partido
  let anchor = tr;
  if (anchor.nextElementSibling && anchor.nextElementSibling.classList.contains('paf-breakdown-row')) {
    anchor = anchor.nextElementSibling;
  }
  anchor.after(row);
  tr._eleitosRow = row;
  btn.classList.add('open');

  try {
    const elType = STATE.currentElectionType;
    const subtype = STATE.auSubtype;
    const scope = STATE.scope || {};
    const distrito = (elType === 'au' && subtype === 'af' && scope.key)
      ? circuloFromDicofre(scope.key) : null;
    const data = await loadEleitosData(elType, STATE.currentYear, subtype, distrito);
    if (eleitosStateToken() !== token || !row.isConnected) return;
    const html = buildEleitosPartyHtml(party, data, elType, subtype, scope);
    row.firstElementChild.innerHTML = html
      || `<div style="font-size: 0.72rem; color: var(--muted); text-align: left;">Sem listagem nominal disponível para ${escapeHtml(party)} neste âmbito.</div>`;
  } catch (err) {
    console.warn('eleitos: lista não carregada —', err.message || err);
    if (row.isConnected) {
      row.firstElementChild.innerHTML = '<div style="font-size: 0.72rem; color: var(--muted); text-align: left;">Não foi possível carregar a lista de eleitos.</div>';
    }
  }
}

// dicofre (6) -> código de círculo/distrito usado nos ficheiros de AF
function circuloFromDicofre(dicofre) {
  const dt = String(dicofre).slice(0, 2);
  const n = parseInt(dt, 10);
  if (n >= 1 && n <= 18) return dt;
  if (n === 31 || n === 32) return '30';
  if (n >= 40 && n <= 49) return '40';
  return dt;
}

// pré-carrega o índice para a primeira renderização já saber a disponibilidade
loadEleitosIndex();
