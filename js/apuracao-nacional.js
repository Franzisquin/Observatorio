/* ===========================================================================
   ElectoMaps — apuração nacional

   Lê dois snapshots: o do Brasil (placar nacional) e o das 27 UFs (mapa e
   tabela). Quando o cargo não tem arquivo de abrangência Brasil — governador,
   senador —, o nacional é a soma das UFs, que é aritmética do próprio TSE, não
   estimativa.
   =========================================================================== */
'use strict';

(function () {

  const $ = (id) => document.getElementById(id);

  const estado = { br: null, uf: null, chapa: null, timer: null };

  function nomeDoCargo() {
    return APU.CARGOS[APU.cfg.cargo] || 'Apuração';
  }

  /* ------------------------------------------------------------- desenho */

  function pintar() {
    const dadosUF = estado.uf;
    const dadosBR = estado.br;

    const temAlgo = !!(dadosBR || dadosUF);

    /* Sem boletim, a página não fica vazia: mostra a chapa registrada no
       DivulgaCandContas com zero voto. É o estado normal da página até a
       primeira urna fechar. */
    if (!temAlgo) {
      $('semDados').hidden = !!estado.chapa;
      $('painel').hidden = !estado.chapa;
      $('estados').hidden = true;
      APUUI.selo(null, null);
      APUUI.progresso(null);

      if (!estado.chapa) {
        $('semDadosTexto').textContent =
          'A lista de candidaturas ainda não foi importada. Rode scripts/apuracao/candidatos.py.';
        return;
      }

      $('tituloCargo').textContent = nomeDoCargo();
      $('subtitulo').textContent = 'Brasil — candidaturas registradas';
      $('rotuloPlacar').textContent = 'Candidaturas';
      $('mapaNota').textContent = 'aguardando o primeiro boletim';
      $('legenda').innerHTML = '';
      APUUI.pintarMapa($('mapaBrasil'), () => null, {}, (sigla) => {
        location.href = `apuracao-uf.html?uf=${sigla}${sufixoParams()}`;
      });
      APUUI.placar(APU.rankingZerado(estado.chapa), 'placar');
      APUUI.participacao(null, 'participacao');
      return;
    }

    $('semDados').hidden = true;
    $('painel').hidden = false;
    $('estados').hidden = !dadosUF;

    const meta = (dadosBR && dadosBR.meta) || (dadosUF && dadosUF.meta);
    const dicionario = (dadosBR && dadosBR.cand) || (dadosUF && dadosUF.cand) || {};

    /* Nacional: usa o arquivo br quando existe; senão soma as UFs. */
    const entradasUF = dadosUF ? Object.values(dadosUF.abr) : [];
    const nacional = (dadosBR && dadosBR.abr && dadosBR.abr.br)
      || (entradasUF.length ? APU.agregar(entradasUF) : null);

    $('tituloCargo').textContent = nomeDoCargo();
    $('subtitulo').textContent = dadosBR ? 'Brasil' : 'Brasil — soma das unidades federativas';
    $('rotuloPlacar').textContent = 'Resultado nacional';

    APUUI.selo(meta, nacional);
    APUUI.progresso(nacional);
    APUUI.placar(APU.ranking(nacional, dicionario), 'placar');
    APUUI.participacao(nacional, 'participacao');

    if (!dadosUF) return;

    /* mapa */
    const entradaDe = (sigla) => dadosUF.abr[sigla] || null;
    APUUI.pintarMapa($('mapaBrasil'), entradaDe, dicionario, (sigla) => {
      location.href = `apuracao-uf.html?uf=${sigla}${sufixoParams()}`;
    });

    const comApuracao = entradasUF.filter((e) => e && e.vv > 0);
    $('mapaNota').textContent = `${comApuracao.length} de ${entradasUF.length} unidades com votos`;
    APUUI.legenda(APUUI.lideresDistintos(entradasUF, dicionario), 'legenda');

    tabela(dadosUF, dicionario);
  }

  function sufixoParams() {
    const p = [];
    if (APU.cfg.eleicao) p.push('eleicao=' + encodeURIComponent(APU.cfg.eleicao));
    if (APU.cfg.cargo) p.push('cargo=' + encodeURIComponent(APU.cfg.cargo));
    const dados = new URLSearchParams(location.search).get('dados');
    if (dados) p.push('dados=' + encodeURIComponent(dados));
    return p.length ? '&' + p.join('&') : '';
  }

  function tabela(dadosUF, dicionario) {
    const linhas = Object.entries(dadosUF.abr)
      .map(([sigla, entrada]) => ({ sigla, entrada, lider: APU.lider(entrada, dicionario) }))
      .sort((a, b) => (APU.UF_NOMES[a.sigla] || a.sigla).localeCompare(APU.UF_NOMES[b.sigla] || b.sigla, 'pt-BR'));

    $('tabelaUF').innerHTML = linhas.map(({ sigla, entrada, lider }) => {
      const nome = APU.UF_NOMES[sigla] || sigla.toUpperCase();
      const cor = lider ? APU.cor(lider.partido) : 'var(--line-strong)';
      return `<tr>
        <td><a href="apuracao-uf.html?uf=${sigla}${sufixoParams()}">${APUUI.esc(nome)}</a></td>
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
    if (estado.chapa === null) {
      estado.chapa = await APU.candidaturas();
      await APU.fotosDisponiveis();
    }
    const [br, uf] = await Promise.all([APU.snapshot('br'), APU.snapshot('uf')]);
    /* Não apaga o que já está na tela se uma volta falhar: um boletim antigo
       vale mais que um painel vazio. */
    if (br) estado.br = br;
    if (uf) estado.uf = uf;
    pintar();
  }

  function agendar() {
    clearTimeout(estado.timer);
    /* Aba oculta não precisa de boletim: retoma na volta do foco. */
    if (document.visibilityState === 'hidden') return;
    estado.timer = setTimeout(async () => {
      await atualizar();
      agendar();
    }, APU.cfg.intervalo);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { atualizar().then(agendar); }
    else clearTimeout(estado.timer);
  });

  (async function iniciar() {
    document.title = `${nomeDoCargo()} — Apuração ao vivo — ElectoMaps`;
    await atualizar();
    agendar();
  })();
})();
