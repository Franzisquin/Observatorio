/* ===========================================================================
   ElectoMaps — apuração por zona eleitoral

   Uma cidade por vez, no desenho da página de estado: o mapa pinta cada zona
   eleitoral com a cor de quem lidera ali, o cartão ao lado mostra a cidade
   inteira ou a zona clicada, e a tabela traz zona a zona. Só os majoritários —
   presidente, governador e senador.

   Lê {ele}-{cargo}-zonas-{ibge}.json (coleta.camada_zonas: o município em
   `total` e cada zona em `abr`) e a malha pré-projetada da cidade,
   resultados_geo/zonas_svg/zonas_{ibge}.json (scripts/gerar_malhas_zonas.py).
   Sem `mun` na URL, a página lista as cidades que têm mapa por zona.

   Quem está eleito ou no 2º turno se decide no estado (governador, senador) ou
   no país (presidente), nunca na cidade: as marcas do placar vêm da camada alta
   ({ele}-{cargo}-uf.json ou -br.json), e não da conta feita com o voto da
   cidade ou da zona — que daria eleito quem só lidera ali.
   =========================================================================== */
'use strict';

(function () {

  const $ = (id) => document.getElementById(id);
  const esc = APUUI.esc;

  const CARGOS = [['0001', 'Presidente'], ['0003', 'Governador'], ['0005', 'Senador']];
  /* Deputado não tem página de zona: qualquer outro cargo vira presidente.
     O cfg muda junto, porque APU.ranking lê dele se a disputa é proporcional. */
  if (!CARGOS.some(([cd]) => cd === APU.cfg.cargo)) APU.cfg.cargo = '0001';
  const CARGO = APU.cfg.cargo;

  const estado = {
    indice: null, cidade: null, malha: null, nomes: {},
    dados: null, sup: null, chapa: null, marcas: new Map(),
    sel: null, timer: null
  };

  const hrefZonas = (ibge, cargo) => 'apuracao-zonas.html'
    + APUUI.paramsDeFonte(ibge ? { mun: ibge, cargo } : { cargo });

  /* Só o número: "Zona 1". */
  const rotuloZona = (z) => `Zona ${Number(z)}`;

  /* ------------------------------------------------------------ carga */

  async function json(url) {
    try {
      /* `no-cache` revalida a cada carga (304 quando nada mudou): o índice e as
         malhas são regerados por scripts/gerar_malhas_zonas.py, e sem isto o
         navegador seguia mostrando a lista de cidades antiga. */
      const r = await fetch(url, { cache: 'no-cache' });
      return r.ok ? await r.json() : null;
    } catch (e) {
      return null;
    }
  }

  /* ---------------------------------------------------------- cabeçalho */

  function cabecalho() {
    const c = estado.cidade;
    APUUI.ligarMenu(CARGO);
    $('seletorCargo').innerHTML = CARGOS.map(([cd, rotulo]) => {
      const ativo = cd === CARGO;
      return `<a class="apu-cargo${ativo ? ' is-ativo' : ''}"` + (ativo ? ' aria-current="page"' : '')
        + ` href="${esc(hrefZonas(c && c.ibge, cd))}">${rotulo}</a>`;
    }).join('');

    /* As cidades por estado, na ordem do nome do estado. */
    const cidades = (estado.indice && estado.indice.cidades) || [];
    const porUF = new Map();
    cidades.forEach((x) => { if (!porUF.has(x.uf)) porUF.set(x.uf, []); porUF.get(x.uf).push(x); });
    const ufs = Array.from(porUF.keys())
      .sort((a, b) => (APU.UF_NOMES[a] || a).localeCompare(APU.UF_NOMES[b] || b, 'pt-BR'));
    $('seletorCidade').innerHTML = (c ? '' : '<option value="" selected>Zonas eleitorais</option>')
      + ufs.map((uf) => `<optgroup label="${esc(APU.UF_NOMES[uf] || uf.toUpperCase())}">`
        + porUF.get(uf).slice().sort((a, b) => a.nm.localeCompare(b.nm, 'pt-BR'))
          .map((x) => `<option value="${esc(x.ibge)}"${c && c.ibge === x.ibge ? ' selected' : ''}>`
            + `${esc(x.nm)}</option>`).join('')
        + '</optgroup>').join('');

    ajustarSeletor();
    /* Medido antes de a fonte do título chegar, o nome sai com a largura da
       fonte de reserva, mais estreita, e a Playfair o cortava em "São Pa…". */
    if (document.fonts) document.fonts.ready.then(ajustarSeletor);

    if (c) {
      const nomeUF = APU.UF_NOMES[c.uf] || c.uf.toUpperCase();
      $('brandScope').textContent = c.nm;
      $('voltar').href = APUUI.hrefDoCargo(CARGO, c.uf);
      $('voltarRotulo').textContent = nomeUF;
      /* Quantas zonas o TSE publica para a cidade, quando já há boletim; antes,
         as do desenho. As duas contas só diferem se o zoneamento mudou. */
      const n = estado.dados && estado.dados.abr ? Object.keys(estado.dados.abr).length : c.zonas;
      $('subtitulo').textContent = `${nomeUF} · ${n} zonas eleitorais`;
      document.title = `${c.nm} por zona eleitoral — ${CARGOS.find(([cd]) => cd === CARGO)[1]} — ElectoMaps`;
    } else {
      $('brandScope').textContent = 'Zonas eleitorais';
      $('voltar').href = APUUI.hrefDoCargo(CARGO, '');
      $('voltarRotulo').textContent = 'Apuração nacional';
      $('subtitulo').textContent = `${cidades.length} cidades com mapa por zona`;
      /* A lista não tem apuração: sem selo de andamento e sem barra. */
      $('progresso').hidden = true;
      document.querySelector('.apu-kicker').hidden = true;
    }
  }

  /* O seletor tem a largura do nome escolhido, e não a do maior nome da
     lista: medido com a mesma fonte do título, mais o espaço da seta. */
  function ajustarSeletor() {
    const sel = $('seletorCidade');
    const opcao = sel.options[sel.selectedIndex];
    const medida = document.createElement('span');
    medida.className = 'apu-zonas-medida';
    medida.textContent = opcao ? opcao.text : '';
    sel.parentElement.appendChild(medida);
    sel.style.width = Math.ceil(medida.getBoundingClientRect().width) + 'px';
    medida.remove();
  }

  /* ------------------------------------------------- sem cidade: a lista */

  function indice() {
    const cidades = (estado.indice && estado.indice.cidades) || [];
    $('indice').hidden = false;
    $('notaIndice').textContent = `${cidades.length} cidades · `
      + `${APU.fmt.int(cidades.reduce((s, c) => s + c.zonas, 0))} zonas`;
    const porUF = new Map();
    cidades.forEach((x) => { if (!porUF.has(x.uf)) porUF.set(x.uf, []); porUF.get(x.uf).push(x); });
    $('listaCidades').innerHTML = Array.from(porUF.keys())
      .sort((a, b) => (APU.UF_NOMES[a] || a).localeCompare(APU.UF_NOMES[b] || b, 'pt-BR'))
      .map((uf) => `<div class="apu-zonas-uf"><h3>${APUUI.bandeira(uf)}${esc(APU.UF_NOMES[uf] || uf)}</h3><ul>`
        + porUF.get(uf).slice().sort((a, b) => a.nm.localeCompare(b.nm, 'pt-BR'))
          .map((x) => `<li><a href="${esc(hrefZonas(x.ibge, CARGO))}">${esc(x.nm)}`
            + `<span>${x.zonas} zonas</span></a></li>`).join('')
        + '</ul></div>').join('');
  }

  /* --------------------------------------------------------------- mapa */

  function montarMapa() {
    const m = estado.malha;
    const svg = $('mapaZonas');
    if (!m || svg.dataset.cidade === estado.cidade.ibge) return;
    svg.dataset.cidade = estado.cidade.ibge;
    svg.setAttribute('viewBox', `0 0 ${m.w} ${m.h}`);
    svg.innerHTML = m.p.map(([z, , d]) =>
      `<path data-chave="${esc(z)}" data-nome="${esc(rotuloZona(z))}" d="${d}"></path>`).join('');
  }

  /* A zona escolhida ganha contorno, e vai para o fim do desenho: no SVG quem
     vem depois fica por cima, e o contorno das vizinhas cobriria o dela. */
  function destacar() {
    const svg = $('mapaZonas');
    svg.querySelectorAll('path[data-chave]').forEach((p) => {
      const eh = !!estado.sel && p.dataset.chave === estado.sel.chave;
      p.classList.toggle('is-sel', eh);
      if (eh) svg.appendChild(p);
    });
  }

  /* ---------------------------------------------------------- marcas */

  /* Eleito e 2º turno, decididos onde a eleição se decide: no estado ou no país. */
  const entradaDaEleicao = () => {
    const sup = estado.sup;
    return (sup && sup.abr && (CARGO === '0001' ? sup.abr.br : sup.abr[estado.cidade.uf])) || null;
  };

  function marcasDaEleicao() {
    return APUUI.marcasDaEleicao(entradaDaEleicao(), (estado.sup && estado.sup.cand) || {}, CARGO);
  }

  const dicionario = () => ({ ...((estado.dados && estado.dados.cand) || {}),
    ...((estado.sup && estado.sup.cand) || {}) });

  const totalDaCidade = () => {
    const d = estado.dados;
    if (!d) return null;
    return d.total || APU.agregar(Object.values(d.abr || {}));
  };

  /* ------------------------------------------------------ cartão lateral */

  function lateral() {
    const c = estado.cidade;
    const sel = estado.sel;
    const d = estado.dados;
    const alvo = sel ? ((d && d.abr && d.abr[sel.chave]) || null) : totalDaCidade();
    /* Zona que ainda não abriu urna fica com a chapa zerada, em ordem de
       nome: ordenar zeros pelo voto poria qualquer um na frente. */
    const lista = alvo && alvo.vv > 0 ? APU.ranking(alvo, dicionario()) : [];
    const zerada = APU.rankingZerado(estado.chapa, CARGO === '0001' ? '' : c.uf);

    $('voltarZona').hidden = !sel;
    $('rotuloPlacar').textContent = sel ? rotuloZona(sel.chave)
      : (d ? `Resultado em ${c.nm}` : `Candidaturas em ${c.nm}`);
    const verParticipacao = () => APUUI.participacao(alvo, 'participacao', { seguir: 'placar' });
    APUUI.placar(lista.length ? lista : zerada, 'placar', {
      entrada: alvo, cargo: CARGO, marcas: estado.marcas,
      botao: 'maisResultado', aoAlternar: verParticipacao
    });
    verParticipacao();
    destacar();
  }

  function selecionar(chave) {
    estado.sel = chave ? { chave } : null;
    lateral();
    tabela();
  }

  /* -------------------------------------------------------------- tabela */

  function margem(m) {
    return '+' + (m >= 1 ? String(Math.round(m)) : m.toFixed(1).replace('.', ','));
  }

  /* Todas as zonas: as do boletim e as do desenho. Zona que só existe num dos
     dois (criada ou extinta entre a malha e a eleição) aparece igual. */
  function tabela() {
    const d = estado.dados;
    const dic = dicionario();
    const zonas = new Set([...Object.keys((d && d.abr) || {}),
      ...((estado.malha && estado.malha.p) || []).map(([z]) => z)]);
    const linhas = Array.from(zonas).sort((a, b) => Number(a) - Number(b)).map((z) => {
      const e = d && d.abr ? d.abr[z] : null;
      const r = e && e.vv > 0 ? APU.ranking(e, dic) : [];
      return { z, e, lider: r[0] || null, dif: r[0] ? (r[1] ? r[0].pct - r[1].pct : r[0].pct) : 0 };
    });
    $('zonas').hidden = false;
    $('notaTabela').textContent = 'Clique numa zona para ver o resultado dela';
    $('tabelaZonas').innerHTML = linhas.map(({ z, e, lider, dif }) => {
      const cor = lider ? APU.cor(lider.partido) : 'var(--line-strong)';
      return `<tr class="is-click${estado.sel && estado.sel.chave === z ? ' is-sel' : ''}" data-zona="${esc(z)}">
        <td><span class="apu-zonas-num">${rotuloZona(z)}</span>`
        + (estado.malha && !(z in estado.nomes)
          ? '<span class="apu-zonas-nome">sem desenho no mapa</span>' : '') + `</td>
        <td>
          <span class="apu-lead-cell">
            <span class="apu-swatch" style="background:${cor}"></span>
            <span class="apu-lead-name">${lider ? esc(lider.urna || lider.nome) : '—'}</span>
          </span>
        </td>
        <td class="num">${lider ? APU.fmt.pct(lider.pct) : '—'}</td>
        <td class="num">${lider ? margem(dif) : '—'}</td>
        <td class="num">${e ? APU.fmt.int(e.tv || 0) : '—'}</td>
        <td class="num">${APU.fmt.pct((e && e.pst) || 0)}</td>
      </tr>`;
    }).join('');
  }

  /* -------------------------------------------------------------- desenho */

  function pintar() {
    cabecalho();
    const d = estado.dados;
    const total = totalDaCidade();
    estado.marcas = marcasDaEleicao();
    montarMapa();

    $('semDados').hidden = !!(d || estado.malha);
    if (!estado.malha) $('semDadosTexto').textContent = 'O mapa desta cidade não foi encontrado.';

    APUUI.selo(d && d.meta, APUUI.comDefinicaoDa(entradaDaEleicao(), total));
    APUUI.progresso(total && total.ts ? total : null);
    APUUI.avisos(total, 'avisos');

    const svg = $('mapaZonas');
    if (d) {
      APUUI.pintarMapa(svg, (z) => (d.abr && d.abr[z]) || null, dicionario(), selecionar);
      const zonas = Object.values(d.abr || {});
      $('mapaNota').textContent = `${zonas.filter((e) => e && e.vv > 0).length} de `
        + `${zonas.length} zonas com votos`;
    } else {
      APUUI.pintarMapa(svg, () => null, {}, selecionar);
      $('mapaNota').textContent = 'aguardando o primeiro boletim';
    }
    lateral();
    tabela();
  }

  /* --------------------------------------------------------------- ciclo */

  async function atualizar() {
    if (!estado.cidade) return;
    if (estado.chapa === null) estado.chapa = await APU.candidaturas(CARGO);
    const [d, sup] = await Promise.all([
      APU.snapshot('zonas-' + estado.cidade.ibge, CARGO),
      APU.snapshot(CARGO === '0001' ? 'br' : 'uf', CARGO)
    ]);
    /* Boletim antigo vale mais que tela vazia: só substitui o que chegou. */
    if (d) estado.dados = d;
    if (sup) estado.sup = sup;
    pintar();
  }

  function agendar() {
    clearTimeout(estado.timer);
    if (document.visibilityState === 'hidden') return;
    /* As zonas andam na cadência da camada municipal do plantão. */
    estado.timer = setTimeout(async () => {
      try {
        await atualizar();
      } catch (e) {
        console.warn('[apuracao] volta falhou, seguindo para a próxima', e);
      }
      agendar();
    }, APU.intervaloDe(4));
  }

  document.addEventListener('visibilitychange', () => {
    if (!estado.cidade) return;
    if (document.visibilityState === 'visible') atualizar().catch(() => {}).then(agendar);
    else clearTimeout(estado.timer);
  });

  (async function iniciar() {
    estado.indice = await json('resultados_geo/zonas_svg/indice.json');
    const pedida = new URLSearchParams(location.search).get('mun') || '';
    const cidades = (estado.indice && estado.indice.cidades) || [];
    estado.cidade = cidades.find((c) => c.ibge === pedida || c.tse === pedida) || null;

    $('seletorCidade').addEventListener('change', (ev) => {
      if (ev.target.value) location.href = hrefZonas(ev.target.value, CARGO);
    });
    $('voltarZona').onclick = () => selecionar(null);
    $('tabelaZonas').addEventListener('click', (ev) => {
      const tr = ev.target.closest('tr[data-zona]');
      if (!tr) return;
      selecionar(tr.dataset.zona);
      $('painel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    if (!estado.cidade) {
      cabecalho();
      indice();
      return;
    }
    $('palcoCidade').hidden = false;
    estado.malha = await json(`resultados_geo/zonas_svg/zonas_${estado.cidade.ibge}.json`);
    estado.nomes = Object.fromEntries(((estado.malha && estado.malha.p) || []).map(([z, nome]) => [z, nome]));
    try {
      await atualizar();
    } catch (e) {
      console.warn('[apuracao] primeira carga falhou', e);
      pintar();
    }
    agendar();
  })();
})();
