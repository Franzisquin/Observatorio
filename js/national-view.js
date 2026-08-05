// ===================== ESCOPO NACIONAL (UF = BR) =====================
//
// 'BR' no seletor de UF das gerais deixou de significar "baixa os 27 estados
// inteiros" e passou a ser um escopo proprio: o mapa vira a malha de estados e
// tudo que o painel mostra sai de agregados por UF.
//
// Por que agregados: o detalhe por local de votacao dos 27 estados passa de
// 20 MB por cargo e leva dezenas de segundos so para desenhar um mapa em que
// nenhum ponto e distinguivel no zoom nacional. Os arquivos *_resumo.json que
// ja acompanham cada zip majoritario tem o total por candidato NA UF (algumas
// centenas de bytes) e o official_totals_<ano>.json das legislativas tem
// cadeiras e votos por partido em cada UF — juntos cobrem tudo que a visao
// nacional precisa, em ~2 MB.
//
// A malha de estados reaproveita o caminho de REGIAO que ja existia: as
// features recebem CD_REG/NM_REG e o summary carrega _regionLevel = 'uf', que e
// exatamente o que getMunicipalSummaryEntryForFeature/getMunicipalPolygonStyle
// esperam. Nenhuma rotina de estilo, tooltip ou 3D precisou saber de estados.

const NATIONAL_UF_LEVEL = 'uf';
const NATIONAL_STATES_GEOJSON_URL = `${DATA_BASE_URL}estados_brasil.geojson`;

// Cadeiras dos deputados estaduais nao vem em lugar nenhum como constante: sao
// derivadas do proprio official_totals (qt_vagas por UF).
const NATIONAL_MAJORITARIAN_OFFICES = new Set(['presidente', 'governador', 'senador']);

let NATIONAL_STATES_GEOJSON_PROMISE = null;
const NATIONAL_MAJORITARIA_CACHE = new Map();
const NATIONAL_LEGISLATIVE_CACHE = new Map();
// Nome-base dos zips majoritarios muda de ano para ano (governador_2018_t1_SP
// mas governador_2014_ord_t1_SP). Resolvido uma vez por (ano, cargo, turno) e
// reusado nas 27 UFs, senao seriam 27 pares de 404 a cada troca de cargo.
const NATIONAL_ARCHIVE_PATTERN_CACHE = new Map();

// Estado da visao nacional corrente. Guardado fora do STATE global porque nada
// mais no app le isto — e o painel precisa recompor no clique de turno sem
// refazer a rede.
let nationalView = {
  office: '',
  year: '',
  subtype: 'ord',
  summaryByTurn: null,
  data: null,
  generation: 0
};

function isNationalGeneralScope() {
  return STATE.currentElectionType === 'geral'
    && String(dom.selectUFGeneral?.value || '').toUpperCase() === 'BR';
}

// Cargos que a visao nacional sabe montar no ano selecionado. 1989 so teve
// presidencial; 1998 nao tem legislativas no acervo.
function isOfficeAvailableNationally(office, year = STATE.currentElectionYear) {
  const y = String(year);
  if (office === 'presidente') return true;
  if (y === '1989') return false;
  if (office === 'deputado') return y !== '1998';
  return true;
}

async function fetchNationalStatesGeoJSON() {
  if (NATIONAL_STATES_GEOJSON_PROMISE) return NATIONAL_STATES_GEOJSON_PROMISE;

  NATIONAL_STATES_GEOJSON_PROMISE = (async () => {
    const response = await fetch(NATIONAL_STATES_GEOJSON_URL);
    if (!response.ok) throw new Error('Malha de estados não encontrada.');
    const geojson = await response.json();
    // Clona e reetiqueta: CD_REG/NM_REG e o contrato que o resolver de summary
    // e o tooltip municipal ja falam. Mexer no objeto do cache seria inofensivo
    // aqui, mas o clone evita surpresa se a malha for reusada por outra tela.
    return {
      type: 'FeatureCollection',
      features: (geojson.features || []).map((feature) => {
        const props = feature.properties || {};
        const sigla = String(props.SIGLA_UF || '').toUpperCase();
        return {
          ...feature,
          properties: {
            ...props,
            CD_REG: sigla,
            NM_REG: props.NM_UF || UF_MAP.get(sigla) || sigla
          }
        };
      })
    };
  })();

  NATIONAL_STATES_GEOJSON_PROMISE.catch(() => {
    NATIONAL_STATES_GEOJSON_PROMISE = null;
  });
  return NATIONAL_STATES_GEOJSON_PROMISE;
}

// ===================== MAJORITARIAS: RESUMO POR UF =====================

// Candidatos a nome-base, em ordem de tentativa. Cobre as tres convencoes que
// existem no acervo (com subtipo, sem subtipo, e presidente que nunca tem).
function buildNationalArchiveBasenames(year, office, uf, turno, subtype = 'ord') {
  const ufNorm = String(uf || '').toUpperCase();
  const sub = subtype === 'sup' ? 'sup' : 'ord';
  if (office === 'presidente') {
    return [`presidente_${year}_t${turno}_${ufNorm}`];
  }
  return [
    `${office}_${year}_${sub}_t${turno}_${ufNorm}`,
    `${office}_${year}_t${turno}_${ufNorm}`
  ];
}

async function fetchNationalUfResumo(year, office, uf, turno, subtype, forcedIndex = null) {
  const basenames = buildNationalArchiveBasenames(year, office, uf, turno, subtype);
  const order = (forcedIndex === null)
    ? basenames.map((_, i) => i)
    : [forcedIndex];

  for (const index of order) {
    const basename = basenames[index];
    if (!basename) continue;
    try {
      const { data } = await fetchJsonFromZipEntry(
        `${DATA_BASE_URL}Majoritarias ${year}/${basename}.zip`,
        `${basename}_resumo.json`
      );
      if (data?.TOTALS) return { data, patternIndex: index };
    } catch (error) {
      // Zip inexistente para este padrao/UF/turno: segue para o proximo.
    }
  }
  return null;
}

// Descobre qual padrao de nome vale neste (ano, cargo, turno) sondando algumas
// UFs. Sonda mais de uma porque ha turnos que so existem em parte dos estados
// (2o turno de governador) — falhar em SP nao prova que o padrao esta errado.
async function resolveNationalArchivePattern(year, office, turno, subtype) {
  const cacheKey = `${year}|${office}|${subtype}|${turno}`;
  if (NATIONAL_ARCHIVE_PATTERN_CACHE.has(cacheKey)) {
    return NATIONAL_ARCHIVE_PATTERN_CACHE.get(cacheKey);
  }

  const promise = (async () => {
    for (const uf of ['SP', 'MG', 'RJ', 'BA', 'AC']) {
      const found = await fetchNationalUfResumo(year, office, uf, turno, subtype);
      if (found) return { patternIndex: found.patternIndex, seed: { uf, data: found.data } };
    }
    return null;
  })();

  NATIONAL_ARCHIVE_PATTERN_CACHE.set(cacheKey, promise);
  return promise;
}

// { '1T': { UF: {TOTALS, METADATA} }, '2T': {...} } — UFs sem aquele turno
// simplesmente nao aparecem.
async function loadNationalMajoritariaData(office, year, subtype = 'ord', onProgress = null) {
  const cacheKey = `${year}|${office}|${subtype}`;
  if (NATIONAL_MAJORITARIA_CACHE.has(cacheKey)) return NATIONAL_MAJORITARIA_CACHE.get(cacheKey);

  const promise = (async () => {
    const byTurn = { '1T': {}, '2T': {} };
    // Senador nunca tem 2o turno; os demais podem ter em parte das UFs.
    const turnos = (office === 'senador') ? [1] : [1, 2];

    let done = 0;
    const total = turnos.length * ALL_STATE_SIGLAS.length;
    const bump = () => {
      done += 1;
      if (onProgress) onProgress(Math.round((done / total) * 100));
    };

    for (const turno of turnos) {
      const resolved = await resolveNationalArchivePattern(year, office, turno, subtype);
      const turnoKey = `${turno}T`;
      if (!resolved) {
        done += ALL_STATE_SIGLAS.length;
        if (onProgress) onProgress(Math.round((done / total) * 100));
        continue;
      }

      byTurn[turnoKey][resolved.seed.uf] = resolved.seed.data;

      await Promise.all(ALL_STATE_SIGLAS.map(async (uf) => {
        if (uf === resolved.seed.uf) { bump(); return; }
        const found = await fetchNationalUfResumo(year, office, uf, turno, subtype, resolved.patternIndex);
        if (found) byTurn[turnoKey][uf] = found.data;
        bump();
      }));
    }

    if (!Object.keys(byTurn['1T']).length && !Object.keys(byTurn['2T']).length) {
      throw new Error(`Sem dados nacionais de ${office} em ${year}.`);
    }
    return byTurn;
  })();

  NATIONAL_MAJORITARIA_CACHE.set(cacheKey, promise);
  promise.catch(() => {
    if (NATIONAL_MAJORITARIA_CACHE.get(cacheKey) === promise) NATIONAL_MAJORITARIA_CACHE.delete(cacheKey);
  });
  return promise;
}

// Chave de exibicao no formato que parseCandidateKey/renderResultsPanel usam.
function buildNationalCandidateKey(meta, candidateId, turnoKey) {
  return `${meta?.[0] || `Candidato ${candidateId}`} (${meta?.[1] || '?'}) (${meta?.[2] || 'N/D'}) ${turnoKey}`;
}

function isBlankOrNullCandidateId(candidateId) {
  return candidateId === '95' || candidateId === '96';
}

// Soma os totais de uma UF num mapa { chaveDeExibicao: votos } + brancos/nulos.
function summarizeNationalUfPayload(payload, turnoKey) {
  const totals = payload?.TOTALS || {};
  const metadata = payload?.METADATA?.cand_names || {};
  const votes = {};
  let totalValid = 0;
  let brancos = 0;
  let nulos = 0;

  Object.entries(totals).forEach(([candidateId, rawVotes]) => {
    const value = ensureNumber(rawVotes);
    if (candidateId === '95') { brancos += value; return; }
    if (candidateId === '96') { nulos += value; return; }
    const key = buildNationalCandidateKey(metadata[candidateId], candidateId, turnoKey);
    votes[key] = (votes[key] || 0) + value;
    totalValid += value;
  });

  return { votes, totalValid, brancos, nulos, metadata };
}

// Summary por UF no formato que o coropletico ja consome.
function buildNationalMajoritarianStateSummary(byTurn, turnoKey) {
  const summary = {};
  Object.defineProperty(summary, '_regionLevel', { value: NATIONAL_UF_LEVEL });

  const payloads = byTurn?.[turnoKey] || {};
  Object.entries(payloads).forEach(([uf, payload]) => {
    const { votes, totalValid } = summarizeNationalUfPayload(payload, turnoKey);
    const ordenados = Object.entries(votes)
      .filter(([, v]) => ensureNumber(v) > 0)
      .sort((a, b) => ensureNumber(b[1]) - ensureNumber(a[1]));
    if (!ordenados.length || totalValid <= 0) return;

    const [winnerKey, winnerVotesRaw] = ordenados[0];
    const [, secondVotesRaw] = ordenados[1] || [null, 0];
    const winnerVotes = ensureNumber(winnerVotesRaw);
    const secondVotes = ensureNumber(secondVotesRaw);
    const info = parseCandidateKey(winnerKey);

    summary[uf] = {
      nome: UF_MAP.get(uf) || uf,
      muniCode: '',
      winnerCode: '',
      winnerName: info.nome,
      winnerParty: info.partido,
      winnerColorParty: info.partido,
      totalValid,
      margin: ((winnerVotes - secondVotes) / totalValid) * 100,
      winnerPct: (winnerVotes / totalValid) * 100,
      turno: turnoKey,
      turnoLabel: turnoKey === '2T' ? '2º Turno' : '1º Turno',
      votes,
      rawTotals: votes,
      isDetailed: true
    };
  });

  return summary;
}

// Totais do PAIS num turno: soma os 27 resumos.
function buildNationalAggregateTotals(byTurn, turnoKey) {
  const payloads = byTurn?.[turnoKey] || {};
  const votesByDisplayKey = {};
  let totalValidos = 0;
  let brancos = 0;
  let nulos = 0;

  Object.values(payloads).forEach((payload) => {
    const parcial = summarizeNationalUfPayload(payload, turnoKey);
    Object.entries(parcial.votes).forEach(([key, value]) => {
      votesByDisplayKey[key] = (votesByDisplayKey[key] || 0) + ensureNumber(value);
    });
    totalValidos += parcial.totalValid;
    brancos += parcial.brancos;
    nulos += parcial.nulos;
  });

  return {
    votesByDisplayKey,
    totalValidos,
    brancos,
    nulos,
    comparecimento: totalValidos + brancos + nulos,
    ufCount: Object.keys(payloads).length
  };
}

// Vencedor efetivo de cada UF: o 2o turno manda onde ele existe.
function buildNationalWinnersByUf(byTurn) {
  const winners = {};
  const summary1T = buildNationalMajoritarianStateSummary(byTurn, '1T');
  const summary2T = buildNationalMajoritarianStateSummary(byTurn, '2T');
  new Set([...Object.keys(summary1T), ...Object.keys(summary2T)]).forEach((uf) => {
    const entry = summary2T[uf] || summary1T[uf];
    if (entry) winners[uf] = entry;
  });
  return winners;
}

// Senadores eleitos por UF. O acervo marca o status na METADATA, e o numero de
// cadeiras alterna 1/3 e 2/3 do Senado a cada ciclo — contar 'ELEITO' e o unico
// jeito de acertar os dois casos sem tabela fixa.
function buildNationalSenateSeats(byTurn) {
  const payloads = byTurn?.['1T'] || {};
  const seats = [];

  Object.entries(payloads).forEach(([uf, payload]) => {
    const metadata = payload?.METADATA?.cand_names || {};
    const totals = payload?.TOTALS || {};
    const eleitos = Object.entries(metadata)
      .filter(([id, meta]) => !isBlankOrNullCandidateId(id)
        && String(meta?.[2] || '').toUpperCase().startsWith('ELEITO'))
      .map(([id, meta]) => ({
        uf,
        id,
        nome: meta?.[0] || `Candidato ${id}`,
        partido: meta?.[1] || 'N/D',
        votes: ensureNumber(totals[id])
      }))
      .sort((a, b) => b.votes - a.votes);

    // Ha anos em que o status nao vem preenchido; cai no mais votado.
    if (!eleitos.length) {
      const top = Object.entries(totals)
        .filter(([id]) => !isBlankOrNullCandidateId(id))
        .sort((a, b) => ensureNumber(b[1]) - ensureNumber(a[1]))[0];
      if (top) {
        const meta = metadata[top[0]];
        eleitos.push({
          uf,
          id: top[0],
          nome: meta?.[0] || `Candidato ${top[0]}`,
          partido: meta?.[1] || 'N/D',
          votes: ensureNumber(top[1])
        });
      }
    }

    seats.push(...eleitos);
  });

  return seats;
}

// ===================== LEGISLATIVAS: official_totals =====================

async function loadNationalLegislativeTotals(year) {
  const cacheKey = String(year);
  if (NATIONAL_LEGISLATIVE_CACHE.has(cacheKey)) return NATIONAL_LEGISLATIVE_CACHE.get(cacheKey);

  const promise = (async () => {
    const response = await fetch(`${DATA_BASE_URL}Legislativas ${year}/official_totals_${year}.json`);
    if (!response.ok) throw new Error(`Sem totais legislativos de ${year}.`);
    return response.json();
  })();

  NATIONAL_LEGISLATIVE_CACHE.set(cacheKey, promise);
  promise.catch(() => {
    if (NATIONAL_LEGISLATIVE_CACHE.get(cacheKey) === promise) NATIONAL_LEGISLATIVE_CACHE.delete(cacheKey);
  });
  return promise;
}

function getLegislativeHouseKey(cargo = currentCargo) {
  return String(cargo || '').includes('estadual') ? 'e' : 'f';
}

// Agrega as 27 UFs num quadro por legenda: cadeiras, votos e de onde vieram.
function buildNationalLegislativeAggregate(totalsByUf, houseKey) {
  const parties = new Map();
  let totalSeats = 0;
  let totalValid = 0;
  let ufCount = 0;

  Object.entries(totalsByUf || {}).forEach(([uf, payload]) => {
    const house = payload?.[houseKey];
    if (!house) return;
    ufCount += 1;
    totalValid += ensureNumber(house.stats?.qt_votos_validos);

    (house.coalitions || []).forEach((coalition) => {
      const id = String(coalition?.id || '').trim();
      if (!id) return;
      let entry = parties.get(id);
      if (!entry) {
        entry = {
          id,
          composition: String(coalition?.raw_comp || id),
          seats: 0,
          votes: 0,
          byUf: []
        };
        parties.set(id, entry);
      }
      const seats = ensureNumber(coalition.elected);
      const votes = ensureNumber(coalition.votes);
      entry.seats += seats;
      entry.votes += votes;
      totalSeats += seats;
      if (seats > 0 || votes > 0) entry.byUf.push({ uf, seats, votes });
    });
  });

  const rows = Array.from(parties.values()).map((entry) => ({
    ...entry,
    color: colorForParty(getProportionalListColorKey(
      entry.id,
      entry.composition,
      String(entry.composition || entry.id).split('/')[0].trim()
    )),
    byUf: entry.byUf.sort((a, b) => b.seats - a.seats || b.votes - a.votes)
  })).sort((a, b) => b.seats - a.seats || b.votes - a.votes);

  return { rows, totalSeats, totalValid, ufCount };
}

// Summary por UF para o coropletico: pinta cada estado pela legenda que mais
// elegeu ali (empate desempata por voto).
function buildNationalLegislativeStateSummary(totalsByUf, houseKey) {
  const summary = {};
  Object.defineProperty(summary, '_regionLevel', { value: NATIONAL_UF_LEVEL });

  Object.entries(totalsByUf || {}).forEach(([uf, payload]) => {
    const house = payload?.[houseKey];
    const coalitions = house?.coalitions || [];
    if (!coalitions.length) return;

    const totalValid = ensureNumber(house.stats?.qt_votos_validos)
      || coalitions.reduce((sum, c) => sum + ensureNumber(c.votes), 0);
    if (totalValid <= 0) return;

    const ordenados = coalitions.slice().sort((a, b) =>
      ensureNumber(b.elected) - ensureNumber(a.elected) || ensureNumber(b.votes) - ensureNumber(a.votes));
    const winner = ordenados[0];
    const second = ordenados[1];
    const winnerVotes = ensureNumber(winner.votes);
    const secondVotes = ensureNumber(second?.votes);

    const votes = {};
    coalitions.forEach((coalition) => {
      const label = String(coalition.id || '').trim();
      if (label) votes[`${label} (${label})`] = ensureNumber(coalition.votes);
    });

    const colorKey = getProportionalListColorKey(
      winner.id,
      winner.raw_comp || winner.id,
      String(winner.raw_comp || winner.id).split('/')[0].trim()
    );

    summary[uf] = {
      nome: UF_MAP.get(uf) || uf,
      muniCode: '',
      // Vazio de proposito: com winnerCode preenchido getMunicipalPolygonStyle
      // tentaria resolver a cor pelo lookup de deputado carregado em memoria,
      // que no escopo nacional nao existe.
      winnerCode: '',
      winnerName: String(winner.id || ''),
      winnerParty: colorKey || String(winner.id || ''),
      winnerColorParty: colorKey || String(winner.id || ''),
      totalValid,
      margin: ((winnerVotes - secondVotes) / totalValid) * 100,
      winnerPct: (winnerVotes / totalValid) * 100,
      turno: '1T',
      turnoLabel: '1º Turno',
      seats: ensureNumber(winner.elected),
      vagas: ensureNumber(house.stats?.qt_vagas),
      votes,
      rawTotals: votes,
      isDetailed: true
    };
  });

  return summary;
}

// ===================== MAPA =====================

function buildNationalStateTooltip(feature, summary) {
  const uf = String(feature?.properties?.CD_REG || '').toUpperCase();
  const entry = summary?.[uf];
  const nome = UF_MAP.get(uf) || feature?.properties?.NM_REG || uf;

  if (!entry) {
    return `
      <div class="nyt-tooltip-container" style="font-family: var(--font-main); color: inherit; min-width: 220px;">
        <div class="district-nyt-title">${escapeHtml(nome)}</div>
        <div style="font-size: 11px; color: #777777;">Sem resultados para este estado.</div>
      </div>
    `;
  }

  const isProporcional = String(currentCargo || '').startsWith('deputado');
  const rows = Object.entries(entry.votes || {})
    .map(([key, votes]) => {
      const info = parseCandidateKey(key);
      return {
        nome: isProporcional ? info.nome : toTitleCase(info.nome),
        color: isProporcional
          ? colorForParty(getProportionalListColorKey(info.nome, info.partido, info.partido))
          : getColorForCandidate(info.nome, info.partido),
        votes: ensureNumber(votes)
      };
    })
    .filter((row) => row.votes > 0)
    .sort((a, b) => b.votes - a.votes)
    .slice(0, 4);

  const rowsHtml = rows.length
    ? rows.map((row) => {
      const pct = entry.totalValid > 0 ? (row.votes / entry.totalValid) * 100 : 0;
      return `
        <tr>
          <td style="padding: 0;">
            <div class="district-nyt-loser-cell" style="border-left-color: ${row.color};">
              <span style="margin-left: 6px;">${escapeHtml(row.nome)}</span>
            </div>
          </td>
          <td class="votes-cell">${fmtInt(row.votes)}</td>
          <td class="pct-cell">${pct.toFixed(1)}%</td>
        </tr>
      `;
    }).join('')
    : '<tr><td colspan="3" style="text-align:center;color:#777;padding: 8px;">Sem detalhamento.</td></tr>';

  const vagasHtml = entry.vagas
    ? `<div style="font-size: 11px; color: #777777; margin-top: 4px;">${fmtInt(entry.vagas)} cadeiras em disputa</div>`
    : '';

  return `
    <div class="nyt-tooltip-container" style="font-family: var(--font-main); color: inherit; min-width: 250px;">
      <div class="district-nyt-title">${escapeHtml(nome)}</div>
      <div style="font-size: 12px; color: #777777; margin-bottom: 6px;">${escapeHtml(entry.turnoLabel || '')}</div>
      <table class="district-nyt-table">
        <thead>
          <tr>
            <th style="text-align: left;">${isProporcional ? 'Legenda' : 'Candidato'}</th>
            <th>Votos</th>
            <th>%</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <div style="font-size: 11px; color: #777777; margin-top: 8px;">Votos válidos: ${fmtInt(entry.totalValid)}</div>
      ${vagasHtml}
      <div style="font-size: 11px; color: var(--accent, #777); margin-top: 6px;">Clique para abrir o estado</div>
    </div>
  `;
}

function createNationalStatesLayer(geojson, summary) {
  const layer = new MLCompat.GeoLayer(map, {
    // Mesmo id da camada municipal/regional: mesma pilha, nada novo a limpar.
    id: 'muni',
    type: 'polygon',
    hover: true,
    styleFn: (feature) => getMunicipalPolygonStyle(feature, STATE.currentMapMuniSummary),
    tooltipFn: (feature) => buildNationalStateTooltip(feature, STATE.currentMapMuniSummary),
    onClick: (feature) => {
      const uf = String(feature?.properties?.CD_REG || '').toUpperCase();
      if (uf) enterStateFromNationalView(uf);
    }
  });
  if (STATE.extrusion3DEnabled && isPolygonMapMode()) {
    layer.extrusionEnabled = true;
  }
  layer.__regionLevel = NATIONAL_UF_LEVEL;
  layer.setFeatures(geojson.features || []);
  return layer;
}

// Descer para uma UF: e so trocar o seletor e deixar o fluxo normal das gerais
// carregar o estado (o listener de UF ja faz o load instantaneo).
function enterStateFromNationalView(uf) {
  if (!dom.selectUFGeneral) return;
  const ufNorm = String(uf || '').toUpperCase();
  if (!ufNorm || ufNorm === 'BR') return;
  dom.selectUFGeneral.value = ufNorm;
  dom.selectUFGeneral.dispatchEvent(new Event('change'));
}

// ===================== PAINEL: PRESIDENTE (PAIS) =====================

function renderNationalTurnTabs(hasTurns) {
  if (!dom.turnTabs) return;
  dom.turnTabs.innerHTML = '';
  dom.turnTabs.style.display = '';

  const has1T = !!hasTurns['1T'];
  const has2T = !!hasTurns['2T'];
  if (currentTurno === 2 && !has2T) currentTurno = 1;
  if (currentTurno === 1 && !has1T && has2T) currentTurno = 2;

  if (!has1T && !has2T) { dom.turnTabs.style.display = 'none'; return; }
  if (has1T !== has2T) { dom.turnTabs.style.display = 'none'; return; }

  [[1, '1º Turno'], [2, '2º Turno']].forEach(([turno, label]) => {
    const tab = document.createElement('div');
    tab.className = 'tab' + (currentTurno === turno ? ' active' : '');
    tab.textContent = label;
    tab.addEventListener('click', () => {
      if (currentTurno === turno) return;
      currentTurno = turno;
      refreshNationalViewForTurn();
    });
    dom.turnTabs.appendChild(tab);
  });
}

function renderNationalPresidentialResults(byTurn, turnoKey) {
  if (typeof initializeCandidateColorUI === 'function') initializeCandidateColorUI();

  const aggregate = buildNationalAggregateTotals(byTurn, turnoKey);
  const totalBase = aggregate.totalValidos;

  const results = Object.entries(aggregate.votesByDisplayKey)
    .map(([key, votos]) => ({
      ...parseCandidateKey(key),
      votos: ensureNumber(votos),
      pct: totalBase > 0 ? ensureNumber(votos) / totalBase : 0
    }))
    .filter((r) => !(STATE.filterInaptos && r.status === 'INAPTO'))
    .sort((a, b) => b.votos - a.votos);

  dom.resultsBox.classList.remove('section-hidden');
  dom.summaryBoxContainer.classList.add('section-hidden');
  dom.resultsTitle.textContent = 'Brasil — Presidente';
  dom.resultsSubtitle.textContent =
    `${STATE.currentElectionYear} • ${turnoKey === '2T' ? '2º turno' : '1º turno'} • ${fmtInt(aggregate.ufCount)} estados apurados`;

  let tableHtml = `
    <table class="cand-table">
      <thead>
        <tr>
          <th class="color-bar-td"></th>
          <th class="align-left">Candidato</th>
          <th class="align-center">Votos</th>
          <th class="align-center">Pct.</th>
        </tr>
      </thead>
      <tbody>
  `;

  results.forEach((r) => {
    if (r.votos === 0 && results.length > 2) return;
    const cleanStatus = r.status ? r.status.toUpperCase() : '';
    const sw = getColorForCandidate(r.nome, r.partido);
    const isSpecial = cleanStatus === 'ELEITO' || cleanStatus === '2° TURNO' || cleanStatus === '2º TURNO';
    const safeNome = escapeAttribute(r.nome || '');
    const safePartido = escapeAttribute(r.partido || '');

    tableHtml += `
      <tr class="${cleanStatus ? 'prop-cand-' + cleanStatus.toLowerCase().replace(/º/g, '').replace(/°/g, '').replace(/\s+/g, '-') : ''}" data-status="${r.status}" data-cand-nome="${safeNome}" data-cand-partido="${safePartido}">
        <td class="color-bar-td">
          <button type="button" class="swatch-button cand-color-bar"
               style="background-color: ${sw};"
               data-candidate-name="${safeNome}"
               data-candidate-party="${safePartido}"
               data-current-color="${sw}"
               title="Personalizar cor do candidato"></button>
        </td>
        <td class="align-left">
          <div class="cand-name-container">
            ${isSpecial ? `<span class="cand-check-circle" style="background-color: ${sw};">✔</span>` : ''}
            <span class="cand-name-text">${toTitleCase(r.nome)}</span>
          </div>
          <div class="cand-mini-bar-wrap">
            <div class="cand-mini-bar" style="width: ${Math.min(100, Math.max(0, r.pct * 100))}%; background-color: ${sw};"></div>
          </div>
          ${r.partido ? `<div style="font-size: 0.65rem; color: var(--muted); margin-top: 2px;">${escapeHtml(r.partido)}</div>` : ''}
        </td>
        <td class="align-center cand-votes-text">${fmtInt(r.votos)}</td>
        <td class="align-center pct-text">${fmtPct(r.pct)}</td>
      </tr>
    `;
  });

  tableHtml += '</tbody></table>';
  dom.resultsContent.innerHTML = tableHtml;

  const invalidos = aggregate.brancos + aggregate.nulos;
  const invalidosPct = aggregate.comparecimento > 0 ? (invalidos / aggregate.comparecimento) : 0;
  const estadosVencidos = Object.values(buildNationalMajoritarianStateSummary(byTurn, turnoKey));
  const lider = results[0];
  const estadosDoLider = lider
    ? estadosVencidos.filter((entry) => entry.winnerName === lider.nome).length
    : 0;

  dom.resultsMetrics.innerHTML = `
    <div class="metrics-grid">
      <div class="metric-item"><span>Votos válidos</span><strong>${fmtInt(totalBase)}</strong></div>
      <div class="metric-item"><span>Comparecimento</span><strong>${fmtInt(aggregate.comparecimento)}</strong></div>
      <div class="metric-item"><span>Votos inválidos</span><strong>${fmtInt(invalidos)} (${fmtPct(invalidosPct)})</strong></div>
      <div class="metric-item"><span>Estados vencidos (1º)</span><strong>${fmtInt(estadosDoLider)} de ${fmtInt(estadosVencidos.length)}</strong></div>
    </div>
  `;
}

// ===================== PAINEL: GOVERNADOR (RESUMO POR PARTIDO) =====================

// Mesmo card do resumo estadual de prefeitos: uma linha por partido, contando
// quantos executivos ele levou.
function renderNationalWinnerCountByParty(entries, options) {
  const partyTotals = new Map();

  entries.forEach((entry) => {
    const partyKey = normalizePartyAlias(String(entry.partido || '').toUpperCase())
      || normalizePartyAlias(String(entry.nome || '').toUpperCase());
    if (!partyKey) return;
    if (!partyTotals.has(partyKey)) {
      partyTotals.set(partyKey, {
        partido: entry.partido || partyKey,
        color: getColorForCandidate(entry.nome, entry.partido),
        count: 0,
        ufs: []
      });
    }
    const acc = partyTotals.get(partyKey);
    acc.count += 1;
    acc.ufs.push(entry.uf);
  });

  const results = Array.from(partyTotals.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.partido.localeCompare(b.partido, 'pt-BR');
  });

  dom.resultsBox.classList.remove('section-hidden');
  dom.summaryBoxContainer.classList.add('section-hidden');
  dom.resultsTitle.textContent = options.title;
  dom.resultsSubtitle.textContent = options.subtitle;
  dom.resultsContent.innerHTML = '';

  if (!results.length) {
    dom.resultsContent.innerHTML = '<p style="color:var(--muted)">Nenhum resultado nacional encontrado.</p>';
    dom.resultsMetrics.innerHTML = '';
    return;
  }

  const total = results.reduce((sum, item) => sum + item.count, 0);
  const grid = document.createElement('div');
  grid.className = 'grid';

  results.forEach((result) => {
    const pct = total > 0 ? (result.count / total) : 0;
    const div = document.createElement('div');
    div.className = 'cand';
    div.title = result.ufs.slice().sort().join(', ');
    div.innerHTML = `
      <div class="cand-indicator" style="background:${result.color}"></div>
      <div class="cand-name-wrapper">
        <div class="cand-name" title="${escapeHtml(result.partido)}">
          <span class="scroll-text">${escapeHtml(result.partido)}</span>
        </div>
      </div>
      <div class="cand-bar-wrapper">
        <div class="cand-bar-fill" style="background:${result.color}; width:${pct * 100}%;"></div>
        <div class="cand-votos">${fmtInt(result.count)}</div>
        <div class="cand-pct">${fmtPct(pct)}</div>
      </div>
    `;
    grid.appendChild(div);
  });

  dom.resultsContent.appendChild(grid);
  dom.resultsMetrics.innerHTML = `
    <div class="metrics-grid">
      <div class="metric-item"><span>Partidos vencedores</span><strong>${fmtInt(results.length)}</strong></div>
      <div class="metric-item"><span>${escapeHtml(options.countLabel)}</span><strong>${fmtInt(total)}</strong></div>
    </div>
  `;
}

function renderNationalGovernorResults(byTurn) {
  const winners = buildNationalWinnersByUf(byTurn);
  const entries = Object.entries(winners).map(([uf, entry]) => ({
    uf,
    nome: entry.winnerName,
    partido: entry.winnerParty
  }));

  if (dom.turnTabs) {
    dom.turnTabs.innerHTML = '';
    dom.turnTabs.style.display = 'none';
  }

  renderNationalWinnerCountByParty(entries, {
    title: 'Governos estaduais por partido',
    subtitle: `Brasil • ${STATE.currentElectionYear} • ${fmtInt(entries.length)} estados`,
    countLabel: 'Governos computados'
  });
}

// ===================== PAINEL: HEMICICLO (SENADO / LEGISLATIVAS) =====================

// Assentos em semicirculo, no mesmo desenho do simulador proporcional dos EUA:
// K aneis, raio interno que abre conforme a casa cresce, e um arco arredondado
// por cadeira. Depende de d3.arc (ja carregado na pagina).
function buildSemicircleSeatPaths(total) {
  if (total <= 0 || typeof d3 === 'undefined' || typeof d3.arc !== 'function') return [];

  let K = 9;
  if (total <= 10) K = 1; else if (total <= 30) K = 2; else if (total <= 60) K = 3;
  else if (total <= 120) K = 4; else if (total <= 200) K = 5; else if (total <= 350) K = 6; else K = 7;

  let Rmin = 195;
  if (total <= 10) Rmin = 260; else if (total <= 30) Rmin = 245; else if (total <= 60) Rmin = 230;
  else if (total <= 120) Rmin = 220; else if (total <= 200) Rmin = 210; else if (total <= 350) Rmin = 200;
  const Rmax = 285;

  const radii = [];
  if (K === 1) radii.push((Rmin + Rmax) / 2);
  else for (let r = 0; r < K; r++) radii.push(Rmin + r * (Rmax - Rmin) / (K - 1));

  const weightSum = radii.reduce((sum, r) => sum + r, 0);
  const seatCounts = radii.map((r) => Math.round(total * r / weightSum));
  let alloc = seatCounts.reduce((sum, v) => sum + v, 0);
  let diff = total - alloc;
  let idx = K - 1;
  while (diff !== 0) {
    if (diff > 0) { seatCounts[idx] += 1; diff -= 1; }
    else if (seatCounts[idx] > 1) { seatCounts[idx] -= 1; diff += 1; }
    idx = (idx - 1 + K) % K;
  }

  const thetaMargin = 0.06;
  const thetaSpan = Math.PI - 2 * thetaMargin;
  const step = K === 1 ? (Rmax - Rmin) : (Rmax - Rmin) / (K - 1);
  const thickness = step * 0.88;
  const cornerRadius = Math.max(1.2, Math.min(3.5, thickness * 0.2));
  const arcGen = d3.arc();
  const seats = [];

  for (let row = 0; row < K; row++) {
    const count = seatCounts[row];
    const rRing = radii[row];
    const thetaStep = count > 1 ? thetaSpan / (count - 1) : 0;
    const r1 = rRing - thickness / 2;
    const r2 = rRing + thickness / 2;
    for (let s = 0; s < count; s++) {
      const theta = count === 1 ? Math.PI / 2 : (Math.PI - thetaMargin - s * thetaStep);
      const dTheta = (thetaSpan / count) * 0.93;
      seats.push({
        d: arcGen({
          innerRadius: r1,
          outerRadius: r2,
          startAngle: Math.PI / 2 - (theta + dTheta / 2),
          endAngle: Math.PI / 2 - (theta - dTheta / 2),
          cornerRadius
        }),
        theta
      });
    }
  }

  seats.sort((a, b) => b.theta - a.theta);
  return seats;
}

function drawNationalChamber(rows, totalSeats, seatWord = 'CADEIRAS') {
  const svg = document.getElementById('nationalChamberSvg');
  const tooltip = document.getElementById('nationalChamberTooltip');
  if (!svg) return;

  const NS = 'http://www.w3.org/2000/svg';
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const seatOwners = [];
  rows.filter((row) => row.seats > 0).forEach((row) => {
    for (let i = 0; i < row.seats; i++) seatOwners.push(row);
  });

  const seatPaths = buildSemicircleSeatPaths(totalSeats);
  const group = document.createElementNS(NS, 'g');
  group.setAttribute('transform', 'translate(300,360)');

  seatPaths.forEach((seat, i) => {
    const owner = seatOwners[i];
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', seat.d);
    path.setAttribute('fill', owner ? owner.color : 'var(--border-color)');
    path.setAttribute('class', 'chamber-seat');
    group.appendChild(path);
  });
  svg.appendChild(group);

  const mk = (tag, attrs, text) => {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    if (text != null) el.textContent = text;
    return el;
  };
  svg.appendChild(mk('text', {
    x: 300, y: 332, 'text-anchor': 'middle', 'font-family': 'var(--font-title)',
    'font-size': 36, 'font-weight': 700, fill: 'var(--text)'
  }, fmtInt(totalSeats)));
  svg.appendChild(mk('text', {
    x: 300, y: 354, 'text-anchor': 'middle', 'font-size': 11,
    'font-weight': 600, fill: 'var(--muted)', 'letter-spacing': 1
  }, seatWord));

  if (!tooltip) return;
  const paths = group.querySelectorAll('path');
  const totalVotes = rows.reduce((sum, row) => sum + row.votes, 0);

  paths.forEach((path, i) => {
    const owner = seatOwners[i];
    if (!owner) return;
    path.addEventListener('mouseover', () => {
      paths.forEach((other, j) => {
        other.style.opacity = (seatOwners[j] && seatOwners[j].id === owner.id) ? '1' : '0.25';
      });
      const seatPct = totalSeats > 0 ? (owner.seats / totalSeats * 100).toFixed(1) : '0.0';
      const votePct = totalVotes > 0 ? (owner.votes / totalVotes * 100).toFixed(1) : '0.0';
      tooltip.innerHTML = `
        <div class="tooltip-header"><span class="tooltip-badge" style="background:${owner.color}"></span><strong>${escapeHtml(owner.label)}</strong></div>
        <div class="tooltip-row"><span>Cadeiras</span><span>${fmtInt(owner.seats)} (${seatPct}%)</span></div>
        <div class="tooltip-row"><span>Votos</span><span>${fmtInt(owner.votes)} (${votePct}%)</span></div>`;
      tooltip.classList.remove('hidden');
    });
    path.addEventListener('mousemove', (event) => {
      const box = document.getElementById('nationalChamberContainer')?.getBoundingClientRect();
      if (!box) return;
      let left = event.clientX - box.left + 12;
      let top = event.clientY - box.top + 12;
      if (event.clientX + 12 + tooltip.offsetWidth > window.innerWidth - 10) {
        left = event.clientX - box.left - tooltip.offsetWidth - 12;
      }
      if (event.clientY + 12 + tooltip.offsetHeight > window.innerHeight - 10) {
        top = event.clientY - box.top - tooltip.offsetHeight - 12;
      }
      tooltip.style.left = `${Math.max(0, left)}px`;
      tooltip.style.top = `${Math.max(0, top)}px`;
    });
    path.addEventListener('mouseout', () => {
      paths.forEach((other) => { other.style.opacity = '1'; });
      tooltip.classList.add('hidden');
    });
  });
}

// Tabela de bancadas no formato do simulador dos EUA: legenda, cadeiras,
// % de votos com barrinha, votos — e o detalhamento por UF no acordeao.
function renderNationalChamberTable(rows, totalSeats, totalVotes, breakdownLabel) {
  const headerHtml = `
    <div class="chamber-table-header">
      <div style="flex:1; text-align:left;">Legenda</div>
      <div style="width:56px; text-align:right;">Cadeiras</div>
      <div style="width:104px; text-align:right; padding-right:8px;">% Votos</div>
      <div style="width:88px; text-align:right;">Votos</div>
    </div>
  `;

  let bodyHtml = '';
  rows.forEach((row) => {
    const pct = totalVotes > 0 ? (row.votes / totalVotes * 100) : 0;
    const pctStr = pct.toFixed(1);
    const hasBreakdown = row.byUf && row.byUf.length > 0;

    bodyHtml += `
      <tr class="party-row-header" data-party="${escapeAttribute(row.id)}" style="border-bottom:1px solid var(--border-color); cursor:${hasBreakdown ? 'pointer' : 'default'}; ${row.seats === 0 ? 'opacity:0.55;' : ''}">
        <td style="text-align:left; padding:8px 6px; border-left:4px solid ${row.color};">
          <span style="font-weight:600; margin-left:4px; font-size:0.8rem;" title="${escapeAttribute(row.composition || row.id)}">${escapeHtml(row.label)}</span>
        </td>
        <td style="padding:8px 6px; text-align:right; font-weight:700; font-size:0.8rem; width:56px;">${fmtInt(row.seats)}</td>
        <td style="padding:8px 6px; text-align:right; width:104px;">
          <div style="display:flex; align-items:center; gap:6px; justify-content:flex-end;">
            <span style="font-weight:700; min-width:34px; font-size:0.68rem; text-align:right;">${pctStr}%</span>
            <div style="width:40px; height:6px; background:var(--border-color); overflow:hidden; flex-shrink:0;">
              <div style="width:${pctStr}%; height:100%; background:${row.color};"></div>
            </div>
          </div>
        </td>
        <td style="padding:8px 6px; text-align:right; color:var(--muted); font-size:0.68rem; width:88px;">${fmtInt(row.votes)}</td>
      </tr>
    `;

    if (hasBreakdown) {
      const detailHtml = row.byUf.map((item) => `
        <div class="cand-row" style="border-left:3px solid ${row.color};">
          <div class="cand-name-row"><span class="cand-sim-name">${escapeHtml(UF_MAP.get(item.uf) || item.uf)}</span></div>
          <div class="cand-meta-row">
            <span class="cand-sim-detail">${fmtInt(item.votes)} votos</span>
            <div class="cand-meta-right">
              <span class="cand-sim-votes">${fmtInt(item.seats)} ${item.seats === 1 ? breakdownLabel.singular : breakdownLabel.plural}</span>
            </div>
          </div>
        </div>
      `).join('');

      bodyHtml += `
        <tr class="party-candidates-row" data-party="${escapeAttribute(row.id)}" style="display:none;">
          <td colspan="4" style="padding:0; border:none;">
            <div class="party-candidates" style="display:block; border-top:1px solid var(--border-color); background:var(--input-bg); padding:4px 0;">
              ${detailHtml}
            </div>
          </td>
        </tr>
      `;
    }
  });

  dom.resultsContent.innerHTML = `
    <div id="nationalChamberContainer" class="chamber-container">
      <svg id="nationalChamberSvg" viewBox="0 65 600 305" width="100%" preserveAspectRatio="xMidYMin meet"></svg>
      <div id="nationalChamberTooltip" class="chamber-tooltip hidden"></div>
    </div>
    ${headerHtml}
    <table class="chamber-party-table" style="border-collapse:collapse; width:100%;">
      <tbody>${bodyHtml}</tbody>
    </table>
  `;

  dom.resultsContent.querySelectorAll('.party-row-header').forEach((headerRow) => {
    const party = headerRow.dataset.party;
    const detailRow = dom.resultsContent.querySelector(`.party-candidates-row[data-party="${CSS.escape(party)}"]`);
    if (!detailRow) return;
    headerRow.addEventListener('click', () => {
      const isVisible = detailRow.style.display !== 'none';
      dom.resultsContent.querySelectorAll('.party-candidates-row').forEach((el) => { el.style.display = 'none'; });
      dom.resultsContent.querySelectorAll('.party-row-header').forEach((el) => el.classList.remove('party-group-open'));
      if (!isVisible) {
        detailRow.style.display = 'table-row';
        headerRow.classList.add('party-group-open');
      }
    });
  });

  drawNationalChamber(rows, totalSeats);
}

function renderNationalChamberMetrics(rows, totalSeats, totalVotes, extraLabel) {
  const comSeats = rows.filter((row) => row.seats > 0);
  const maior = comSeats[0];
  const maioria = Math.floor(totalSeats / 2) + 1;
  dom.resultsMetrics.innerHTML = `
    <div class="metrics-grid">
      <div class="metric-item"><span>Votos válidos</span><strong>${fmtInt(totalVotes)}</strong></div>
      <div class="metric-item"><span>Maior bancada${maior ? ` (${escapeHtml(maior.label)})` : ''}</span><strong>${fmtInt(maior ? maior.seats : 0)}</strong></div>
      <div class="metric-item"><span>Legendas com cadeira</span><strong>${fmtInt(comSeats.length)}</strong></div>
      <div class="metric-item"><span>${escapeHtml(extraLabel)}</span><strong>${fmtInt(maioria)}</strong></div>
    </div>
  `;
}

function renderNationalLegislativeResults(totalsByUf, houseKey) {
  const aggregate = buildNationalLegislativeAggregate(totalsByUf, houseKey);
  const rows = aggregate.rows.map((row) => ({
    ...row,
    label: shortenNationalLegendLabel(row.id)
  }));

  if (dom.turnTabs) {
    dom.turnTabs.innerHTML = '';
    dom.turnTabs.style.display = 'none';
  }

  const casaLabel = houseKey === 'e' ? 'Assembleias Legislativas' : 'Câmara dos Deputados';
  dom.resultsBox.classList.remove('section-hidden');
  dom.summaryBoxContainer.classList.add('section-hidden');
  dom.resultsTitle.textContent = `Brasil — ${casaLabel}`;
  dom.resultsSubtitle.textContent = houseKey === 'e'
    ? `${STATE.currentElectionYear} • ${fmtInt(aggregate.totalSeats)} cadeiras somadas em ${fmtInt(aggregate.ufCount)} assembleias`
    : `${STATE.currentElectionYear} • ${fmtInt(aggregate.totalSeats)} cadeiras em ${fmtInt(aggregate.ufCount)} estados`;

  if (!rows.length || aggregate.totalSeats <= 0) {
    dom.resultsContent.innerHTML = '<p style="color:var(--muted)">Sem totais legislativos para este ano.</p>';
    dom.resultsMetrics.innerHTML = '';
    return;
  }

  renderNationalChamberTable(rows, aggregate.totalSeats, aggregate.totalValid, {
    singular: 'cadeira',
    plural: 'cadeiras'
  });
  renderNationalChamberMetrics(rows, aggregate.totalSeats, aggregate.totalValid, 'Maioria absoluta');
}

function renderNationalSenateResults(byTurn) {
  const seats = buildNationalSenateSeats(byTurn);
  const byParty = new Map();
  let totalVotes = 0;

  // Votos por partido saem do total da UF, nao so do eleito: e a leitura
  // comparavel com a das legislativas (voto na legenda, nao no assento).
  Object.entries(byTurn?.['1T'] || {}).forEach(([, payload]) => {
    const metadata = payload?.METADATA?.cand_names || {};
    Object.entries(payload?.TOTALS || {}).forEach(([id, rawVotes]) => {
      if (isBlankOrNullCandidateId(id)) return;
      const partido = normalizePartyAlias(String(metadata[id]?.[1] || '').toUpperCase());
      if (!partido) return;
      const votes = ensureNumber(rawVotes);
      totalVotes += votes;
      const entry = byParty.get(partido) || { id: partido, label: partido, seats: 0, votes: 0, byUf: [], color: colorForParty(partido) };
      entry.votes += votes;
      byParty.set(partido, entry);
    });
  });

  seats.forEach((seat) => {
    const partido = normalizePartyAlias(String(seat.partido || '').toUpperCase()) || 'N/D';
    const entry = byParty.get(partido) || { id: partido, label: partido, seats: 0, votes: 0, byUf: [], color: colorForParty(partido) };
    entry.seats += 1;
    entry.byUf.push({ uf: seat.uf, seats: 1, votes: seat.votes });
    byParty.set(partido, entry);
  });

  const rows = Array.from(byParty.values())
    .map((row) => ({ ...row, byUf: row.byUf.sort((a, b) => b.votes - a.votes) }))
    .sort((a, b) => b.seats - a.seats || b.votes - a.votes);

  if (dom.turnTabs) {
    dom.turnTabs.innerHTML = '';
    dom.turnTabs.style.display = 'none';
  }

  dom.resultsBox.classList.remove('section-hidden');
  dom.summaryBoxContainer.classList.add('section-hidden');
  dom.resultsTitle.textContent = 'Brasil — Senado Federal';
  dom.resultsSubtitle.textContent = `${STATE.currentElectionYear} • ${fmtInt(seats.length)} cadeiras em disputa`;

  if (!seats.length) {
    dom.resultsContent.innerHTML = '<p style="color:var(--muted)">Sem resultados de senador para este ano.</p>';
    dom.resultsMetrics.innerHTML = '';
    return;
  }

  renderNationalChamberTable(rows, seats.length, totalVotes, {
    singular: 'senador',
    plural: 'senadores'
  });
  renderNationalChamberMetrics(rows, seats.length, totalVotes, 'Maioria das vagas em jogo');
}

// Federacoes vem com o nome inteiro ("FEDERAÇÃO BRASIL DA ESPERANÇA - FE
// BRASIL(PT/PC DO B/PV)"), que estoura a coluna. Mostra a composicao entre
// parenteses, que e o que identifica a legenda de relance.
function shortenNationalLegendLabel(id) {
  const raw = String(id || '').trim();
  const match = raw.match(/\(([^()]*\/[^()]*)\)/);
  if (match) return match[1].replace(/\s*\/\s*/g, '/');
  return raw.length > 28 ? `${raw.slice(0, 27)}…` : raw;
}

// ===================== ORQUESTRACAO =====================

function clearNationalResultsPanel() {
  if (dom.turnTabs) {
    dom.turnTabs.innerHTML = '';
    dom.turnTabs.style.display = '';
  }
}

async function refreshNationalViewForTurn() {
  if (!isNationalGeneralScope() || !nationalView.summaryByTurn) return;
  const turnoKey = (currentTurno === 2 && Object.keys(nationalView.summaryByTurn['2T'] || {}).length) ? '2T' : '1T';

  STATE.currentMapMuniSummary = buildNationalMajoritarianStateSummary(nationalView.data, turnoKey);
  if (STATE.municipiosLayer?.refresh) STATE.municipiosLayer.refresh();

  renderNationalTurnTabs({
    '1T': Object.keys(nationalView.data?.['1T'] || {}).length > 0,
    '2T': Object.keys(nationalView.data?.['2T'] || {}).length > 0
  });
  renderNationalPresidentialResults(nationalView.data, turnoKey);
}

// Entrada unica da visao nacional: carrega o agregado do cargo corrente,
// desenha a malha de estados e monta o painel conforme o cargo.
async function showNationalOverview(options = {}) {
  if (!map || !isNationalGeneralScope()) return;

  const generation = ++nationalView.generation;
  const year = String(STATE.currentElectionYear);
  const office = currentOffice;
  const subtype = currentSubType === 'sup' ? 'sup' : 'ord';

  // Cargo indisponivel no ano (1989 so teve presidencial, 1998 nao tem
  // legislativas no acervo): cai para presidente em vez de estourar um erro de
  // rede. updateCargoChipsVisibility ja escondeu o chip; aqui so alinhamos o
  // estado antes de montar a visao.
  if (!isOfficeAvailableNationally(office, year)) {
    currentOffice = 'presidente';
    currentSubType = 'ord';
    currentCargo = 'presidente_ord';
    dom.cargoChipsGeneral?.querySelectorAll('.chip-button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.value === 'presidente');
    });
    nationalView.generation -= 1;
    return showNationalOverview(options);
  }

  STATE.currentElectionType = 'geral';
  STATE.currentMapMode = 'regioes';
  STATE.currentRegionLevel = NATIONAL_UF_LEVEL;
  STATE.currentMapMuniUF = 'BR';
  currentRegionFilter = { level: '', code: '' };
  currentCidadeFilter = 'all';
  currentBairroFilter = 'all';
  currentLocalFilter = '';
  // Desempenho depende do dropdown de candidato, que so existe com dados por
  // local carregados; no escopo nacional o mapa e sempre por vencedor.
  currentVizMode = 'vencedor';

  showMapLoading(`Carregando resultados nacionais de ${year}...`, 0);

  try {
    const geojsonPromise = fetchNationalStatesGeoJSON();
    let summary;

    if (office === 'deputado') {
      const totals = await loadNationalLegislativeTotals(year);
      if (generation !== nationalView.generation) return;
      const houseKey = getLegislativeHouseKey(currentCargo);
      summary = buildNationalLegislativeStateSummary(totals, houseKey);
      nationalView = { ...nationalView, office, year, subtype, data: totals, summaryByTurn: null, generation };
    } else {
      const byTurn = await loadNationalMajoritariaData(office, year, subtype, (pct) => {
        if (generation === nationalView.generation) updateMapLoading(null, pct);
      });
      if (generation !== nationalView.generation) return;
      const turnoKey = (currentTurno === 2 && Object.keys(byTurn['2T'] || {}).length) ? '2T' : '1T';
      summary = (office === 'presidente')
        ? buildNationalMajoritarianStateSummary(byTurn, turnoKey)
        : (() => {
          const winners = buildNationalWinnersByUf(byTurn);
          Object.defineProperty(winners, '_regionLevel', { value: NATIONAL_UF_LEVEL });
          return winners;
        })();
      nationalView = { ...nationalView, office, year, subtype, data: byTurn, summaryByTurn: byTurn, generation };
    }

    const geojson = await geojsonPromise;
    if (generation !== nationalView.generation || !isNationalGeneralScope()) return;

    STATE.currentMapMuniSummary = summary;

    if (currentLayer && map.hasLayer(currentLayer)) {
      map.removeLayer(currentLayer);
      currentLayer = null;
    }
    if (STATE.municipiosLayer && map.hasLayer(STATE.municipiosLayer)) {
      map.removeLayer(STATE.municipiosLayer);
    }

    STATE.municipiosLayer = createNationalStatesLayer(geojson, summary);
    STATE.municipiosLayer.addTo(map);

    if (options.keepViewport !== true) {
      MLCompat.fitMapToBounds(map, STATE.municipiosLayer.getBounds(), { padding: [20, 20], animate: false });
    }

    selectedLocationIDs.clear();
    STATE.isFilterAggregationActive = false;
    if (typeof syncMapModeButtons === 'function') syncMapModeButtons();
    if (typeof updateElectionTypeUI === 'function') updateElectionTypeUI();
    if (typeof updateConditionalUI === 'function') updateConditionalUI();
    populateRegionalDropdowns();

    clearNationalResultsPanel();
    dom.filterBox?.classList.add('section-hidden');
    dom.vizBox?.classList.add('section-hidden');
    if (dom.btnToggleInaptos) dom.btnToggleInaptos.disabled = true;

    if (office === 'presidente') {
      const turnoKey = (currentTurno === 2 && Object.keys(nationalView.data['2T'] || {}).length) ? '2T' : '1T';
      renderNationalTurnTabs({
        '1T': Object.keys(nationalView.data['1T'] || {}).length > 0,
        '2T': Object.keys(nationalView.data['2T'] || {}).length > 0
      });
      renderNationalPresidentialResults(nationalView.data, turnoKey);
    } else if (office === 'governador') {
      renderNationalGovernorResults(nationalView.data);
    } else if (office === 'senador') {
      renderNationalSenateResults(nationalView.data);
    } else {
      renderNationalLegislativeResults(nationalView.data, getLegislativeHouseKey(currentCargo));
    }
  } catch (error) {
    console.error('[Nacional] Falha ao montar a visão nacional:', error);
    showToast(`Erro ao carregar a visão nacional: ${error.message}`, 'error');
  } finally {
    if (generation === nationalView.generation) hideMapLoading();
  }
}

if (typeof window !== 'undefined') {
  window.isNationalGeneralScope = isNationalGeneralScope;
  window.isOfficeAvailableNationally = isOfficeAvailableNationally;
  window.showNationalOverview = showNationalOverview;
  window.refreshNationalViewForTurn = refreshNationalViewForTurn;
  window.enterStateFromNationalView = enterStateFromNationalView;
}
