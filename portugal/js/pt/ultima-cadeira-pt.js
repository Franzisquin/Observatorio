// ============================================================================
// ultima-cadeira-pt.js — a última cadeira de cada círculo (método d'Hondt)
//
// Refaz o d'Hondt do círculo com os votos do painel: a ordem em que os mandatos
// foram atribuídos, quem levou o último, quem ficou mais perto de o tirar e
// quantos votos faltavam a cada partido para mais um deputado, com os votos
// dos outros inalterados. Na vista nacional da AR junta os círculos: os mais
// disputados e, por partido, onde esteve mais perto de mais um deputado.
//
// Os votos do site são os do escrutínio provisório e os mandatos, os oficiais.
// Se o d'Hondt refeito não reproduz os mandatos de um círculo, ele fica sem
// análise (scripts/testar_ultima_cadeira_pt.mjs confere todos os anos: só Fora
// da Europa em 2005 cai nisso). Em 1975 e 1976 os Açores votavam em três
// círculos e o '40' do site é a soma deles: a conta é refeita em cada um.
// ============================================================================

const UC_ANTES = 3;   // últimos eleitos visíveis acima da linha de corte
const UC_FORA = 3;    // primeiros quocientes não eleitos, abaixo dela
const UC_LINHAS = 6;  // linhas visíveis nas listas antes de "Ver todos"

// ---------- cálculo ----------

// Quocientes por ordem de atribuição: os n eleitos e os UC_FORA seguintes.
// Em empate leva a lista menos votada (art. 16.º da Lei Eleitoral da AR).
function ucQuocientes(votes, n) {
  const q = [];
  for (const [party, v] of Object.entries(votes || {})) {
    for (let d = 1; v > 0 && d <= n + UC_FORA; d++) q.push({ party, votes: v, divisor: d, valor: v / d });
  }
  return q.sort((a, b) => b.valor - a.valor || a.votes - b.votes).slice(0, n + UC_FORA);
}

function ucLugares(votes, n) {
  const seats = {};
  for (const q of ucQuocientes(votes, n).slice(0, n)) seats[q.party] = (seats[q.party] || 0) + 1;
  return seats;
}

// Até 1976 os Açores votavam em três círculos, os antigos distritos. Os votos
// saem das freguesias das ilhas de cada um (DICOFRE 41-49), que somam o '40'
// do site; os mandatos e os eleitos, do mapa oficial do Diário da República.
const UC_ACORES_ANTIGOS = [
  { nome: 'Angra do Heroísmo', ilhas: ['43', '44', '45'], mandatos: 2, eleitos: { 1975: { PPD: 2 }, 1976: { PPD: 1, PS: 1 } } },
  { nome: 'Horta', ilhas: ['46', '47', '48', '49'], mandatos: 1, eleitos: { 1975: { PPD: 1 }, 1976: { PPD: 1 } } },
  { nome: 'Ponta Delgada', ilhas: ['41', '42'], mandatos: 3, eleitos: { 1975: { PPD: 2, PS: 1 }, 1976: { PPD: 2, PS: 1 } } },
];

function ucAcoresTresCirculos(ano, key) {
  return key === '40' && Number(ano) <= 1976;
}

// Os três círculos dos Açores num ano até 1976, cada um com a sua análise. Com
// blocos personalizados os partidos do DR deixam de existir nos votos, e o
// d'Hondt refeito passa a ser a referência, como nos outros círculos do site.
function ucAcoresAntigos(ano, results) {
  return UC_ACORES_ANTIGOS.map((c) => {
    const votes = {};
    for (const [cod, v] of Object.entries(results || {})) {
      if (!c.ilhas.includes(cod.slice(0, 2))) continue;
      for (const [p, x] of Object.entries(v)) votes[p] = (votes[p] || 0) + x;
    }
    const oficial = STATE.customBlocks?.length ? ucLugares(votes, c.mandatos) : c.eleitos[ano];
    return { key: '40', sub: c.nome, nome: c.nome, a: ucAnalisar(votes, c.mandatos, oficial) };
  });
}

// Análise de um círculo, ou null se o d'Hondt refeito não dá mandatosP.
function ucAnalisar(votes, n, mandatosP) {
  if (!(n > 0)) return null;
  const ordem = ucQuocientes(votes, n);
  if (ordem.length < n) return null;
  const seats = ucLugares(votes, n);
  const oficial = Object.entries(mandatosP || {}).filter(([, s]) => s > 0);
  if (oficial.length !== Object.keys(seats).length || oficial.some(([p, s]) => seats[p] !== s)) return null;

  // Para eleger mais um, o próximo quociente do partido, V/(s+1), tem de passar
  // o último quociente eleito de outro partido: V > Vo·(s+1)/so. No empate
  // exato leva a lista menos votada, então basta igualar se V ficar abaixo de Vo.
  // Com votos também iguais a lei não decide; aí conta-se um voto a mais.
  const partidos = Object.entries(votes)
    .filter(([, v]) => v > 0)
    .map(([party, v]) => {
      const s = seats[party] || 0;
      let alvo = Infinity;
      for (const [o, so] of Object.entries(seats)) {
        if (o === party) continue;
        const t = votes[o] * (s + 1);
        alvo = Math.min(alvo, t % so === 0 && t / so < votes[o] ? t / so : Math.floor(t / so) + 1);
      }
      return { party, votes: v, seats: s, faltam: alvo === Infinity ? null : alvo - v };
    })
    .sort((a, b) => (a.faltam ?? Infinity) - (b.faltam ?? Infinity) || b.votes - a.votes);

  const ultimo = ordem[n - 1];
  const desafiante = partidos.find((p) => p.party !== ultimo.party && p.faltam !== null) || null;
  return { n, ordem, seats, partidos, ultimo, desafiante };
}

// Vista nacional da AR: a análise de cada círculo e, por partido, o círculo
// onde lhe faltaram menos votos para mais um deputado. Cada círculo é
// { key, sub, nome, a }: `sub` é o círculo antigo dos Açores (até 1976).
function ucNacional(distritos, ano, results) {
  const circulos = [];
  const semAnalise = [];
  const porPartido = {};
  for (const [key, d] of Object.entries(distritos || {})) {
    if (!d?.mandatos) continue;
    const lista = ucAcoresTresCirculos(ano, key)
      ? ucAcoresAntigos(ano, results)
      : [{ key, sub: '', nome: CIRCULOS.get(key) || key, a: ucAnalisar(d.votes, d.mandatos, d.mandatos_p) }];
    for (const c of lista) {
      if (!c.a) {
        semAnalise.push(c);
        continue;
      }
      circulos.push(c);
      for (const p of c.a.partidos) {
        const melhor = porPartido[p.party];
        if (p.faltam !== null && (!melhor || p.faltam < melhor.faltam)) {
          porPartido[p.party] = { party: p.party, faltam: p.faltam, key: c.key, sub: c.sub, nome: c.nome };
        }
      }
    }
  }
  circulos.sort((x, y) => (x.a.desafiante?.faltam ?? Infinity) - (y.a.desafiante?.faltam ?? Infinity));
  return { circulos, semAnalise, porPartido };
}

// ---------- painel ----------

// Secção "Última cadeira" do painel de resultados, ou '' quando não se aplica:
// AR num círculo e na vista nacional; europeias na vista nacional (círculo
// único). Uma parte de círculo (seleção de freguesias, filtro NUTS, país da
// emigração) não tem d'Hondt próprio.
function buildUltimaCadeiraHtml(scopeData) {
  const el = STATE.currentElectionType;
  const scope = STATE.scope || {};
  if ((el !== 'ar' && el !== 'ee') || selectedLocationIDs.size || STATE.currentNuts || STATE.selectedCountry) return '';
  if (el === 'ar' && scope.level === 'national') {
    const corpo = ucNacionalHtml(scopeData);
    return corpo && ucSecao(corpo);
  }

  const circulo = el === 'ar' ? (scope.level === 'distrito' && scope.key) : scope.level === 'national';
  const off = scopeData?.official;
  if (!circulo || !off?.mandatos) return '';
  if (el === 'ar' && ucAcoresTresCirculos(STATE.currentYear, scope.key)) return ucSecao(ucAcoresHtml(STATE.currentYear));
  const a = ucAnalisar(scopeData.votes, off.mandatos, off.mandatos_p);
  return ucSecao(a ? ucCirculoHtml(a) : ucAviso(UC_DIVERGE));
}

const UC_DIVERGE = 'Refeito com os votos do escrutínio provisório, o d\'Hondt deste círculo não dá os mandatos '
  + 'oficiais, por isso a última cadeira não é mostrada.';

let ucSubAtivo = '';  // círculo antigo dos Açores aberto nos chips (1975 e 1976)

// Açores até 1976: um chip por círculo antigo e a análise de cada um por baixo.
function ucAcoresHtml(ano) {
  const circulos = ucAcoresAntigos(ano, STATE.data?.RESULTS);
  const ativo = circulos.some((c) => c.sub === ucSubAtivo) ? ucSubAtivo : circulos[0].sub;
  let html = `<p class="uc-intro">Em ${escapeHtml(ano)} os Açores votavam em três círculos, os antigos distritos,
    cada um com o seu d'Hondt. Os votos de cada um somam as freguesias das suas ilhas.</p>
    <div class="chip-group uc-subs">`;
  for (const c of circulos) {
    html += `<button type="button" class="chip-button${c.sub === ativo ? ' active' : ''}" data-uc-sub="${escapeAttribute(c.sub)}">${escapeHtml(c.sub)}</button>`;
  }
  html += '</div>';
  for (const c of circulos) {
    html += `<div data-uc-painel="${escapeAttribute(c.sub)}"${c.sub === ativo ? '' : ' hidden'}>${c.a ? ucCirculoHtml(c.a) : ucAviso(UC_DIVERGE)}</div>`;
  }
  return html;
}

function ucSecao(corpo) {
  return `
    <div class="neighborhood-profile uc">
      <div class="profile-header">
        <h3>Última cadeira</h3>
        <button type="button" class="info-button" onclick="openProportionalRulesModal()"
          title="Como funciona o método d'Hondt" aria-label="Como funciona o método d'Hondt">
          <svg class="info-icon" aria-hidden="true"><use href="#svg-info"></use></svg>
        </button>
      </div>
      ${corpo}
    </div>`;
}

// Linha das listas: barra da cor, nome e detalhe à esquerda, número à direita.
// Com `circulo`, a linha é um botão que abre esse círculo (e, nos Açores até
// 1976, o chip `sub`). `detalhe` já vem escapado (pode levar a bolinha de cor).
function ucLinha(cor, nome, detalhe, valor, unidade, { extra = false, circulo = '', sub = '' } = {}) {
  const tag = circulo ? 'button' : 'div';
  const attrs = circulo
    ? ` type="button" data-uc-circulo="${escapeAttribute(circulo)}"${sub ? ` data-uc-ir="${escapeAttribute(sub)}"` : ''}`
      + ` title="Ver o círculo de ${escapeAttribute(sub || CIRCULOS.get(circulo) || circulo)}"`
    : '';
  return `
    <${tag} class="uc-row${extra ? ' uc-extra' : ''}"${attrs}>
      ${cor ? `<span class="uc-bar" style="background:${cor}"></span>` : ''}
      <span class="uc-name"><strong>${escapeHtml(nome)}</strong>${detalhe ? `<small>${detalhe}</small>` : ''}</span>
      <span class="uc-num"><strong>${valor}</strong>${unidade ? `<small>${unidade}</small>` : ''}</span>
    </${tag}>`;
}

function ucPonto(party) {
  return `<i class="uc-dot" style="background:${getResolvedPartyColor(party)}"></i>${escapeHtml(party)}`;
}

function ucAviso(texto) {
  return `<div class="profile-section"><p class="uc-aviso">${texto}</p></div>`;
}

function ucToggle(rotulo) {
  return `<button type="button" class="uc-toggle" data-rotulo="${escapeAttribute(rotulo)}">${escapeHtml(rotulo)}</button>`;
}

const ucVotos = (n) => `+${fmtInt(n)}`;

function ucCirculoHtml(a) {
  const { n, ordem, ultimo, desafiante, partidos } = a;

  let html = `
    <div class="profile-section">
      <h4>O ${n}.º e último mandato</h4>
      ${ucLinha(getResolvedPartyColor(ultimo.party), ultimo.party,
        `${ultimo.divisor}.º deputado · ${fmtInt(ultimo.votes)} ÷ ${ultimo.divisor}`,
        fmtInt(Math.round(ultimo.valor)), 'quociente')}
      ${desafiante ? ucLinha(getResolvedPartyColor(desafiante.party), desafiante.party,
        `mais perto: seria o ${desafiante.seats + 1}.º deputado`, ucVotos(desafiante.faltam), 'votos') : ''}
    </div>`;

  // Ordem de atribuição à volta da linha de corte; "Ver os n mandatos" abre o resto.
  const inicio = Math.max(0, n - UC_ANTES);
  html += '<div class="profile-section"><h4>Ordem de atribuição</h4>';
  ordem.forEach((q, i) => {
    html += `
      <div class="uc-row uc-q${i < inicio ? ' uc-extra' : ''}${i >= n ? ' uc-fora' : ''}">
        <span class="uc-pos">${i + 1}.º</span>
        <span class="uc-bar" style="background:${getResolvedPartyColor(q.party)}"></span>
        <span class="uc-name"><strong>${escapeHtml(q.party)}</strong></span>
        <span class="uc-div">÷${q.divisor}</span>
        <span class="uc-num"><strong>${fmtInt(Math.round(q.valor))}</strong></span>
      </div>`;
    if (i === n - 1) html += '<div class="uc-corte">linha de corte</div>';
  });
  if (inicio > 0) html += ucToggle(`Ver os ${n} mandatos`);
  html += '</div>';

  // Pela ordem dos votos, como a tabela de cima; quem ficou mais perto já está no primeiro cartão.
  html += '<div class="profile-section"><h4>Votos para mais um deputado</h4>';
  [...partidos].sort((x, y) => y.votes - x.votes).forEach((p, i) => {
    html += ucLinha(getResolvedPartyColor(p.party), p.party,
      p.seats ? `${p.seats} ${p.seats === 1 ? 'deputado' : 'deputados'}` : 'sem deputados',
      p.faltam === null ? '—' : ucVotos(p.faltam), p.faltam === null ? 'todos os mandatos' : 'votos',
      { extra: i >= UC_LINHAS });
  });
  if (partidos.length > UC_LINHAS) html += ucToggle(`Ver os ${partidos.length} partidos`);
  html += '<div class="uc-nota">Votos a mais que cada partido precisaria, com os dos outros inalterados.</div></div>';
  return html;
}

function ucNacionalHtml(scopeData) {
  const ano = STATE.currentYear;
  const { circulos, semAnalise, porPartido } = ucNacional(STATE.data?.AGG?.distrito, ano, STATE.data?.RESULTS);
  if (!circulos.length) return '';

  let html = '<div class="profile-section"><h4>Os círculos mais disputados</h4>';
  circulos.forEach((c, i) => {
    const d = c.a.desafiante;
    html += ucLinha(null, c.nome,
      `último: ${ucPonto(c.a.ultimo.party)}${d ? ` · mais perto: ${ucPonto(d.party)}` : ''}`,
      d ? ucVotos(d.faltam) : '—', 'votos', { extra: i >= UC_LINHAS, circulo: c.key, sub: c.sub });
  });
  if (circulos.length > UC_LINHAS) html += ucToggle(`Ver os ${circulos.length} círculos`);
  html += '</div>';

  // Partidos pela ordem dos votos nacionais.
  const nat = scopeData?.votes || {};
  const lista = Object.values(porPartido).sort((x, y) => (nat[y.party] || 0) - (nat[x.party] || 0));
  html += '<div class="profile-section"><h4>Mais perto de mais um deputado</h4>';
  lista.forEach((p, i) => {
    html += ucLinha(getResolvedPartyColor(p.party), p.party, `em ${escapeHtml(p.nome)}`,
      ucVotos(p.faltam), 'votos', { extra: i >= UC_LINHAS, circulo: p.key, sub: p.sub });
  });
  if (lista.length > UC_LINHAS) html += ucToggle(`Ver os ${lista.length} partidos`);
  html += '<div class="uc-nota">Votos a mais que cada partido precisaria no círculo, com os dos outros inalterados.';
  if (semAnalise.length) {
    html += ` Sem análise: ${semAnalise.map((c) => escapeHtml(c.nome)).join(', ')}, onde os votos provisórios não dão os mandatos oficiais.`;
  }
  html += '</div></div>';
  return html;
}

// "Ver todos" das listas, chips dos Açores e linhas que abrem um círculo.
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('.uc-toggle');
  if (toggle) {
    const aberto = toggle.parentElement.classList.toggle('is-open');
    toggle.textContent = aberto ? 'Ver menos' : toggle.dataset.rotulo;
    return;
  }
  const chip = e.target.closest('[data-uc-sub]');
  if (chip) {
    ucSubAtivo = chip.dataset.ucSub;
    const secao = chip.closest('.uc');
    secao.querySelectorAll('[data-uc-sub]').forEach((b) => b.classList.toggle('active', b === chip));
    secao.querySelectorAll('[data-uc-painel]').forEach((el) => { el.hidden = el.dataset.ucPainel !== ucSubAtivo; });
    return;
  }
  const linha = e.target.closest('[data-uc-circulo]');
  if (linha && typeof window.navigateToDistrito === 'function') {
    if (linha.dataset.ucIr) ucSubAtivo = linha.dataset.ucIr;
    window.navigateToDistrito(linha.dataset.ucCirculo, { focus: true });
  }
});
