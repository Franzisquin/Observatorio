/* ===========================================================================
   ElectoMaps — apuração de um estado

   Lê o snapshot municipal daquela UF ({ele}-{cargo}-{uf}.json) e monta o mapa
   por município a partir da malha do IBGE que já vive no repositório. O
   snapshot chaveia por código do TSE e carrega o código IBGE em `mun`, que é a
   ponte para a geometria.
   =========================================================================== */
'use strict';

(function () {

  const $ = (id) => document.getElementById(id);

  const estado = { uf: null, dados: null, geo: null, chapa: null, timer: null };

  function lerUF() {
    const u = (APU.cfg.uf || '').toLowerCase();
    return APU.UF_NOMES[u] ? u : '';
  }

  function nomeDoCargo() {
    return APU.CARGOS[APU.cfg.cargo] || 'Apuração';
  }

  function sufixoParams() {
    const p = [];
    if (APU.cfg.eleicao) p.push('eleicao=' + encodeURIComponent(APU.cfg.eleicao));
    if (APU.cfg.cargo) p.push('cargo=' + encodeURIComponent(APU.cfg.cargo));
    const dados = new URLSearchParams(location.search).get('dados');
    if (dados) p.push('dados=' + encodeURIComponent(dados));
    return p.length ? '?' + p.join('&') : '';
  }

  /* ------------------------------------------------------------------ mapa */

  /* Monta o SVG uma vez. Recolorir a cada boletim é só trocar `fill`, sem
     reconstruir 850 paths. */
  async function montarMapa(uf, dados) {
    if (estado.geo) return estado.geo;

    const malha = await APU.malha(uf);
    if (!malha) return null;

    /* IBGE -> código do TSE, para casar geometria com resultado. */
    const porIbge = {};
    Object.entries(dados.mun || {}).forEach(([cd, m]) => {
      if (m && m.ibge) porIbge[String(m.ibge)] = cd;
    });

    const proj = APU.projetar(malha, (f) => {
      const ibge = String((f.properties && f.properties.CD_MUN) || '');
      return porIbge[ibge] || ('ibge:' + ibge);
    });
    if (!proj) return null;

    const svg = $('mapaUF');
    svg.setAttribute('viewBox', `0 0 ${proj.w} ${proj.h}`);
    svg.innerHTML = proj.paths.map((p) =>
      `<path data-chave="${APUUI.esc(p.chave)}" data-nome="${APUUI.esc(p.nome || '')}" d="${p.d}"></path>`
    ).join('');

    estado.geo = proj;
    return proj;
  }

  /* --------------------------------------------------------------- desenho */

  async function pintar() {
    const uf = estado.uf;
    const dados = estado.dados;

    const nomeUF = APU.UF_NOMES[uf] || uf.toUpperCase();
    $('tituloUF').textContent = nomeUF;
    $('brandScope').textContent = nomeUF;
    $('navNacional').href = 'apuracao.html' + sufixoParams();
    $('voltar').href = 'apuracao.html' + sufixoParams();
    document.title = `${nomeUF} — ${nomeDoCargo()} — Apuração — ElectoMaps`;

    if (!dados) {
      APUUI.selo(null, null);
      APUUI.progresso(null);

      /* Mesma regra da nacional: sem boletim, a chapa daquela UF com zero voto. */
      const chapa = APU.rankingZerado(estado.chapa, uf);
      $('semDados').hidden = chapa.length > 0;
      $('painel').hidden = chapa.length === 0;
      $('municipios').hidden = true;

      if (!chapa.length) {
        $('semDadosTexto').textContent = APU.cfg.eleicao
          ? 'A camada municipal entra em cadência mais lenta que a nacional. Se a apuração já começou, ela aparece na próxima atualização.'
          : 'A lista de candidaturas ainda não foi importada. Rode scripts/apuracao/candidatos.py.';
        return;
      }

      $('subtitulo').textContent = `${nomeDoCargo()} — candidaturas registradas`;
      $('rotuloPlacar').textContent = `Candidaturas em ${nomeUF}`;
      $('mapaNota').textContent = 'aguardando o primeiro boletim';
      $('legenda').innerHTML = '';
      APUUI.placar(chapa, 'placar');
      APUUI.participacao(null, 'participacao');
      return;
    }

    $('semDados').hidden = true;
    $('painel').hidden = false;
    $('municipios').hidden = false;

    const dicionario = dados.cand || {};
    const entradas = Object.values(dados.abr);
    const total = APU.agregar(entradas);

    $('subtitulo').textContent = `${nomeDoCargo()} · ${APU.fmt.int(entradas.length)} municípios`;
    $('rotuloPlacar').textContent = `Resultado em ${nomeUF}`;

    APUUI.selo(dados.meta, { ...total, and: entradas[0] && entradas[0].and, dt: entradas[0] && entradas[0].dt, ht: entradas[0] && entradas[0].ht });
    APUUI.progresso(total);
    APUUI.placar(APU.ranking(total, dicionario), 'placar');
    APUUI.participacao(total, 'participacao');

    const proj = await montarMapa(uf, dados);
    if (proj) {
      APUUI.pintarMapa($('mapaUF'), (cd) => dados.abr[cd] || null, dicionario, null);
      const comApuracao = entradas.filter((e) => e && e.vv > 0).length;
      $('mapaNota').textContent = `${comApuracao} de ${entradas.length} municípios com votos`;
      APUUI.legenda(APUUI.lideresDistintos(entradas, dicionario), 'legenda');
    } else {
      $('mapaNota').textContent = 'Malha municipal indisponível';
    }

    tabela(dados, dicionario);
  }

  function tabela(dados, dicionario) {
    const linhas = Object.entries(dados.abr)
      .map(([cd, entrada]) => ({
        cd,
        nome: (dados.mun && dados.mun[cd] && dados.mun[cd].nm) || cd,
        entrada,
        lider: APU.lider(entrada, dicionario)
      }))
      .sort((a, b) => b.entrada.te - a.entrada.te);

    $('notaTabela').textContent = 'Ordenado por eleitorado';
    $('tabelaMun').innerHTML = linhas.map(({ nome, entrada, lider }) => {
      const cor = lider ? APU.cor(lider.partido) : 'var(--line-strong)';
      return `<tr>
        <td>${APUUI.esc(nome)}</td>
        <td>
          <span class="apu-lead-cell">
            <span class="apu-swatch" style="background:${cor}"></span>
            <span class="apu-lead-name">${lider ? APUUI.esc(lider.urna || lider.nome) : '—'}</span>
          </span>
        </td>
        <td class="num">${lider ? APU.fmt.pct(lider.pct) : '—'}</td>
        <td class="num">${lider ? APU.fmt.int(lider.votos) : '—'}</td>
        <td class="num">
          <span class="apu-mini"><span style="width:${Math.min(100, entrada.pst || 0)}%;background:var(--ink)"></span></span>
          ${APU.fmt.pct(entrada.pst || 0)}
        </td>
      </tr>`;
    }).join('');
  }

  /* --------------------------------------------------------------- ciclo */

  async function atualizar() {
    if (!estado.uf) return;
    if (estado.chapa === null) {
      estado.chapa = await APU.candidaturas();
      await APU.fotosDisponiveis();
    }
    const d = await APU.snapshot(estado.uf);
    if (d) estado.dados = d;
    await pintar();
  }

  function agendar() {
    clearTimeout(estado.timer);
    if (document.visibilityState === 'hidden') return;
    /* A camada municipal é a cara de coletar: o plantão a republica em cadência
       bem mais lenta que a nacional, então pedir de 45 em 45s seria desperdício. */
    estado.timer = setTimeout(async () => {
      await atualizar();
      agendar();
    }, APU.cfg.intervalo * 4);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { atualizar().then(agendar); }
    else clearTimeout(estado.timer);
  });

  (async function iniciar() {
    estado.uf = lerUF();
    if (!estado.uf) {
      $('painel').hidden = true;
      $('municipios').hidden = true;
      $('semDados').hidden = false;
      $('semDadosTexto').textContent =
        'Estado não informado ou inválido. Volte à apuração nacional e escolha um estado no mapa.';
      return;
    }
    await atualizar();
    agendar();
  })();
})();
