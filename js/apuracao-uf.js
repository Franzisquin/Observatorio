/* ===========================================================================
   ElectoMaps — apuração de um estado

   Lê o snapshot municipal daquela UF ({ele}-{cargo}-{uf}.json) e monta o mapa
   por município a partir da malha pré-projetada em resultados_geo/municipios_svg
   (scripts/gerar_malhas_apuracao.py). O snapshot chaveia por código do TSE e
   carrega o código IBGE em `mun`, que é a ponte para a geometria.
   =========================================================================== */
'use strict';

(function () {

  const $ = (id) => document.getElementById(id);

  /* Camadas do mapa, na ordem do controle. `un` nomeia a unidade nos rótulos. */
  const NIVEIS = {
    municipios: { titulo: 'Liderança por município', un: 'municípios' },
    rgint: { titulo: 'Liderança por região intermediária', un: 'regiões' },
    rgi: { titulo: 'Liderança por região imediata', un: 'regiões' }
  };

  const estado = {
    uf: null, dados: null, geo: null, geoNivel: null, chapa: null, timer: null,
    nivel: 'municipios', porChave: {}, total: null, sel: null, topAberto: false,
    /* O que o mapa mostra: 'resultado' (a cor de quem lidera) ou 'margem'
       (círculos do tamanho da vantagem, APUUI.margensNoMapa). */
    modo: 'resultado', dic: {},
    /* Entrada do arquivo de UF do TSE. Vale mais que a soma dos municípios: traz
       a anatomia completa do voto e do eleitorado, e é número publicado em vez de
       conta feita aqui. A soma fica como reserva, para quando a camada alta
       daquele cargo ainda não tiver chegado. */
    ufTSE: null,

    /* O dicionario de candidatos do arquivo de UF. A camada municipal traz uma
       versao reduzida do mesmo candidato: sem `situacao`, e com `eleito` que nao
       acompanha o resultado estadual — em SP os dois que foram ao segundo turno
       constam `eleito=n` no arquivo do municipio e `eleito=s, situacao=2o turno`
       no da UF. Quem manda no selo e o estadual. */
    candTSE: null,

    /* Presidente se elege no país: o arquivo br traz a entrada de onde saem as
       marcas de eleito e de 2º turno (APUUI.marcasDaEleicao). */
    brTSE: null,
    candBR: null,

    /* As cidades deste estado com mapa por zona eleitoral
       (resultados_geo/zonas_svg/indice.json): [{ibge, nm, zonas}]. */
    zonas: null
  };


  function lerUF() {
    const u = (APU.cfg.uf || '').toLowerCase();
    /* O exterior ganhou nome em UF_NOMES para os rótulos das tabelas, mas não
       tem página de estado: não há malha municipal para desenhar. Sem esta
       exclusão, passar a nomeá-lo abriria `?uf=zz` para um mapa inexistente. */
    if (u === APU.EXTERIOR) return '';
    return APU.UF_NOMES[u] ? u : '';
  }

  function nomeDoCargo() {
    return APU.CARGOS[APU.cfg.cargo] || 'Apuração';
  }

  /* Chapa registrada daquela disputa, com todo mundo em zero. Presidente é
     disputa nacional e vem com uf 'BR' no registro: filtrar pelo estado
     esvaziaria a lista e a página do estado cairia no "sem dados". */
  function chapaZerada() {
    return APU.rankingZerado(estado.chapa, APU.cfg.cargo === '0001' ? '' : estado.uf);
  }

  /* Os cinco cargos e a barra de estados, como nas outras páginas da apuração
     (APUUI.seletorDeCargo, APUUI.barraDeUFs): o cargo muda e o estado fica;
     o estado muda e o cargo fica. Deputado leva a apuracao-deputados.html,
     na mesma UF — esta página mostra ranking de candidato, não bloco e vaga. */
  function montarSeletorDeCargo() {
    APUUI.seletorDeCargo('seletorCargo', APU.cfg.cargo, estado.uf);
    APUUI.barraDeUFs('seletorUF', APU.cfg.cargo, estado.uf);
  }

  /* ------------------------------------------------------------------ mapa */

  /* Monta o SVG uma vez, direto da malha pré-projetada. Recolorir a cada
     boletim é só trocar `fill`, sem reconstruir 850 paths.

     Os paths são chaveados por código IBGE, que é o que a malha carrega — o
     código do TSE só existe depois do primeiro boletim, e o mapa precisa estar
     na tela antes disso. */
  async function montarMapa(uf) {
    if (estado.geo && estado.geoNivel === estado.nivel) return estado.geo;

    const malha = await APU.malha(uf, estado.nivel);
    if (!malha || !malha.p || !malha.p.length) return null;

    const svg = $('mapaUF');
    svg.setAttribute('viewBox', `0 0 ${malha.w} ${malha.h}`);
    /* `q`: ilha oceânica desenhada fora do lugar, num quadro (Fernando de
       Noronha, em PE; scripts/gerar_malhas_apuracao.py). Só o fio do quadro:
       o nome aparece no balão, ao passar o mouse na ilha. */
    const quadros = (malha.q || []).map(([x, y, w, h]) =>
      `<rect class="apu-map-quadro" x="${x}" y="${y}" width="${w}" height="${h}"></rect>`).join('');
    svg.innerHTML = malha.p.map(([chave, nome, d]) =>
      `<path data-chave="${APUUI.esc(chave)}" data-nome="${APUUI.esc(nome || '')}" d="${d}"></path>`
    ).join('') + quadros;

    estado.geo = malha;
    estado.geoNivel = estado.nivel;
    return malha;
  }

  /* IBGE -> entrada do boletim, atravessando o código do TSE que o snapshot usa
     para chavear `abr`. */
  function porIbge(dados) {
    const mapa = {};
    Object.entries((dados && dados.mun) || {}).forEach(([cd, m]) => {
      if (m && m.ibge && dados.abr[cd]) mapa[String(m.ibge)] = dados.abr[cd];
    });
    return mapa;
  }

  /* Chave do path -> entrada. No nível municipal é a entrada crua do boletim;
     nos regionais é a soma dos municípios que a própria malha lista em cada
     região — o TSE não totaliza por região, e o índice do IBGE já veio embutido
     na malha justamente para essa soma. */
  function agruparPorChave(dados, malha) {
    const mun = porIbge(dados);
    if (estado.nivel === 'municipios') return mun;

    const mapa = {};
    ((malha && malha.p) || []).forEach(([cd, , , membros]) => {
      mapa[cd] = APU.agregar((membros || []).map((ibge) => mun[ibge]).filter(Boolean));
    });
    return mapa;
  }

  /* ------------------------------------------------------------- seleção */

  /* O card lateral mostra o estado inteiro ou, quando há município escolhido no
     mapa, só ele. Município que ainda não abriu urna cai na chapa zerada, a
     mesma que o estado mostra antes do primeiro boletim. */
  function lateral() {
    const sel = estado.sel;
    const nomeUF = APU.UF_NOMES[estado.uf] || estado.uf.toUpperCase();
    const alvo = sel ? (estado.porChave[sel.chave] || null) : estado.total;
    /* Mesma sobreposicao de pintar(): sem o dicionario da UF por cima, o placar
       perde `situacao` e o selo de eleito some justo quando o TSE o declara. */
    const lista = APU.ranking(alvo, {
      ...((estado.dados && estado.dados.cand) || {}),
      ...(estado.candTSE || {})
    });

    $('voltarMun').hidden = !sel;
    /* Município escolhido que tem mapa por zona: o atalho para a página dele. */
    APUUI.linkDeZonas('linkZonas', estado.zonas, sel && sel.chave, APU.cfg.cargo);
    $('rotuloPlacar').textContent = sel ? sel.nome
      : (estado.dados ? `Resultado em ${nomeUF}` : `Candidaturas em ${nomeUF}`);
    /* Mesmo arranjo da presidencial: a participação abre junto com a lista
       completa de candidaturas, sob o botão único do fim do cartão. */
    /* A chapa inteira, sempre (a lista rola por dentro do cartão), e a
       participação aberta embaixo dela. */
    APUUI.placar(lista.length ? lista : chapaZerada(), 'placar',
      { entrada: alvo, cargo: APU.cfg.cargo, marcas: marcasDaEleicao(), completa: true });
    /* Antes do boletim, o eleitorado de 2026: do estado, ou do município
       escolhido (nas camadas regionais, a soma dos municípios da região). */
    const el = estado.eleitorado || {};
    let eleitores = el.uf ? el.uf[estado.uf] : null;
    if (sel) {
      const membros = estado.nivel === 'municipios' ? [String(sel.chave)]
        : ((((estado.geo && estado.geo.p) || []).find(([cd]) => String(cd) === String(sel.chave)) || [])[3] || []);
      const soma = membros.reduce((s, ibge) => s + ((el.mun || {})[ibge] || 0), 0);
      eleitores = soma || null;
    }
    APUUI.participacao(alvo, 'participacao', { sempre: true, eleitorado: eleitores });
  }

  /* Eleito e 2º turno saem do país (presidente) ou do estado (governador,
     senador), nunca do município escolhido no mapa. */
  const presidente = () => APU.cfg.cargo === '0001';
  const entradaDaEleicao = () => (presidente() ? estado.brTSE : estado.ufTSE);

  function marcasDaEleicao() {
    return APUUI.marcasDaEleicao(entradaDaEleicao(),
      (presidente() ? estado.candBR : estado.candTSE) || {}, APU.cfg.cargo);
  }

  /* Os círculos da margem, quando é o que o mapa mostra. */
  function margens() {
    const itens = APUUI.margensNoMapa($('mapaUF'), (c) => estado.porChave[c] || null,
      estado.dic, estado.modo === 'margem');
    APUUI.legendaMargem('legendaMargem', itens);
  }

  /* O gráfico de como a apuração do estado andou, quando ela chega a 100%. */
  function historico() {
    const ent = estado.ufTSE;
    const serie = estado.hist ? estado.hist[estado.uf] : null;
    const dic = (presidente() ? estado.candBR : estado.candTSE) || {};
    $('historico').hidden = !(ent && Number(ent.pst) >= 100 && serie
      && APUUI.graficoHistorico('historicoGrafico', serie, dic, { largura: 1000, altura: 300, rotulos: 170 }));
    /* Apuração terminada: o gráfico toma o lugar dos municípios com mais votos. */
    if (!$('historico').hidden) $('maisVotos').hidden = true;
  }

  function trocarModo(modo) {
    if (modo === estado.modo) return;
    estado.modo = modo;
    $('modoMapa').querySelectorAll('[data-modo]').forEach((b) => {
      b.classList.toggle('is-on', b.dataset.modo === modo);
      b.setAttribute('aria-pressed', String(b.dataset.modo === modo));
    });
    margens();
  }

  function selecionar(chave, nome) {
    estado.sel = { chave, nome };
    lateral();
  }

  /* -------------------------------------------------------------- camadas */

  /* Trocar de camada troca a malha e a chave dos dados; a seleção morre junto,
     porque código de município não é código de região. */
  function trocarNivel(nivel) {
    if (!NIVEIS[nivel] || nivel === estado.nivel) return;
    estado.nivel = nivel;
    estado.sel = null;
    pintar();
  }

  /* --------------------------------------------------------------- desenho */

  async function pintar() {
    const uf = estado.uf;
    const dados = estado.dados;

    const nomeUF = APU.UF_NOMES[uf] || uf.toUpperCase();
    montarSeletorDeCargo();
    $('tituloUF').textContent = nomeUF;
    $('brandScope').textContent = nomeUF;
    /* Volta à página do cargo no país: o mapa nacional do presidente, os
       governadores, o Senado. */
    APUUI.ligarMenu(APU.cfg.cargo);
    $('voltar').href = APUUI.hrefDoCargo(APU.cfg.cargo, '');
    const rot = $('voltar').querySelector('span');
    if (rot) {
      rot.textContent = { '0003': 'Governadores', '0005': 'Senado' }[APU.cfg.cargo] || 'Apuração nacional';
    }
    document.title = `${nomeUF} — ${nomeDoCargo()} — Apuração — ElectoMaps`;

    $('rotuloMapa').textContent = NIVEIS[estado.nivel].titulo;
    $('niveis').querySelectorAll('[data-nivel]').forEach((b) =>
      b.classList.toggle('is-on', b.dataset.nivel === estado.nivel));

    if (!dados) {
      APUUI.selo(null, null);
      APUUI.progresso(null);

      /* Mesma regra da nacional: sem boletim, a chapa daquela UF com zero voto. */
      const chapa = chapaZerada();
      $('semDados').hidden = chapa.length > 0;
      $('painel').hidden = chapa.length === 0;
      $('municipios').hidden = true;
      $('maisVotos').hidden = chapa.length === 0;

      if (!chapa.length) {
        $('semDadosTexto').textContent = APU.cfg.eleicao
          ? 'A camada municipal entra em cadência mais lenta que a nacional. Se a apuração já começou, ela aparece na próxima atualização.'
          : 'A lista de candidaturas ainda não foi importada. Rode scripts/apuracao/candidatos.py.';
        return;
      }

      $('subtitulo').textContent = '';
      $('subtitulo').hidden = true;
      estado.porChave = {};

      const vazio = await montarMapa(uf);
      $('mapaNota').textContent = vazio
        ? 'aguardando o primeiro boletim'
        : 'Malha indisponível';
      if (vazio) APUUI.pintarMapa($('mapaUF'), () => null, {}, selecionar);
      lateral();
      await maisVotosZerado(uf);
      return;
    }

    $('semDados').hidden = true;
    $('painel').hidden = false;
    $('municipios').hidden = false;
    $('maisVotos').hidden = false;

    /* Municipal como base, estadual por cima: a base garante que nenhum
       candidato da camada municipal fique sem nome, e a sobreposicao traz a
       `situacao` e o `eleito` corretos, que so o arquivo de UF tem. */
    const dicionario = { ...(dados.cand || {}), ...(estado.candTSE || {}) };
    const entradas = Object.values(dados.abr);
    const total = estado.ufTSE || APU.agregar(entradas);
    estado.total = total;

    $('subtitulo').textContent = `${APU.fmt.int(entradas.length)} municípios`;
    $('subtitulo').hidden = false;

    const cabecalho = estado.ufTSE || {
      ...total,
      and: entradas[0] && entradas[0].and,
      dt: entradas[0] && entradas[0].dt,
      ht: entradas[0] && entradas[0].ht
    };
    APUUI.selo(dados.meta, presidente() ? APUUI.comDefinicaoDa(estado.brTSE, cabecalho) : cabecalho);
    APUUI.progresso(cabecalho);
    APUUI.avisos(cabecalho, 'avisos');

    const proj = await montarMapa(uf);
    estado.porChave = agruparPorChave(dados, proj);
    estado.dic = dicionario;
    if (proj) {
      APUUI.pintarMapa($('mapaUF'), (c) => estado.porChave[c] || null, dicionario, selecionar);
      margens();
      const alvos = Object.values(estado.porChave);
      const comApuracao = alvos.filter((e) => e && e.vv > 0).length;
      $('mapaNota').textContent =
        `${comApuracao} de ${alvos.length} ${NIVEIS[estado.nivel].un} com votos`;
    } else {
      $('mapaNota').textContent = 'Malha indisponível';
    }

    lateral();
    historico();
    maisVotados(dados, dicionario);
    tabela(dados, dicionario);
  }

  /* ------------------------------------------- municípios com mais votos */

  /* Quantas linhas a lista mostra antes do "mostrar todos". */
  const TOPO = 6;

  /* Margem do vencedor sobre o segundo colocado, em pontos. Abaixo de um ponto
     o inteiro viraria "+0", então essa faixa sai com uma casa. */
  function margem(m) {
    return '+' + (m >= 1 ? String(Math.round(m)) : m.toFixed(1).replace('.', ','));
  }

  /* Percentual curto, no formato da lista do NYT. Nunca arredonda para cima:
     99,7% de urnas apuradas não é uma apuração fechada. */
  function pctCurto(v) {
    const p = Number(v) || 0;
    if (p >= 100) return '100%';
    if (p >= 1) return Math.floor(p) + '%';
    return p > 0 ? '<1%' : '0%';
  }

  /* Os municípios que mais votos já contabilizaram, com a margem do vencedor.
     Ordena por voto apurado (`tv`), não por eleitorado: no meio da apuração o
     que interessa é onde a contagem já pesa. */
  function maisVotados(dados, dicionario) {
    $('notaMaisVotos').textContent = 'Ordenado por votos apurados';
    const linhas = Object.entries(dados.abr)
      .map(([cd, entrada]) => {
        const r = APU.ranking(entrada, dicionario);
        return {
          nome: (dados.mun && dados.mun[cd] && dados.mun[cd].nm) || cd,
          votos: Number(entrada.tv) || 0,
          pst: entrada.pst || 0,
          lider: r[0] || null,
          /* Sem segundo colocado a margem é a própria votação do líder. */
          dif: r[0] ? (r[1] ? r[0].pct - r[1].pct : r[0].pct) : 0
        };
      })
      .sort((a, b) => b.votos - a.votos);

    desenharMaisVotos(linhas);
  }

  /* Antes do primeiro boletim não há o que ordenar: a lista sai do desenho do
     mapa, em ordem alfabética e com tudo em zero — a mesma regra da chapa
     zerada do placar, onde qualquer outra ordem sugeriria uma disputa que
     ainda não houve. */
  async function maisVotosZerado(uf) {
    const malha = await APU.malha(uf, 'municipios');
    const linhas = ((malha && malha.p) || [])
      .map(([, nome]) => ({ nome: nome || '', votos: 0, pst: 0, lider: null, dif: 0 }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

    $('maisVotos').hidden = !linhas.length;
    $('notaMaisVotos').textContent = 'aguardando o primeiro boletim';
    desenharMaisVotos(linhas);
  }

  function desenharMaisVotos(linhas) {
    $('tabelaMaisVotos').innerHTML = linhas.map((l, i) => {
      const temLider = l.lider && l.votos > 0;
      const cor = temLider ? APU.cor(l.lider.partido) : '';
      return `<tr${i >= TOPO ? ' class="is-extra"' : ''}>
        <td class="apu-top-name">${APUUI.esc(l.nome)}</td>
        <td class="apu-top-margin${temLider ? '' : ' is-vazio'}"${temLider ? ` style="--cor-partido:${cor}"` : ''}>
          ${temLider ? APUUI.esc(l.lider.urna || l.lider.nome) + ' ' + margem(l.dif) : '—'}
        </td>
        <td class="num">${APU.fmt.int(l.votos)}</td>
        <td class="num apu-top-in">${pctCurto(l.pst)}</td>
      </tr>`;
    }).join('');

    $('verTodosMun').hidden = linhas.length <= TOPO;
    aplicarTopo();
  }

  function aplicarTopo() {
    $('topMun').classList.toggle('is-aberto', estado.topAberto);
    $('verTodosMun').innerHTML = estado.topAberto
      ? APUUI.icone('menos', 13) + ' Mostrar menos'
      : APUUI.icone('mais', 13) + ' Mostrar todos';
  }

  /* Município a município, com a margem no mesmo formato da lista dos mais
     votados ("Lula +7", na cor do partido). Com o estado a 100% a coluna de
     apurado sai: seria 100% em todas as linhas. */
  function tabela(dados, dicionario) {
    const linhas = Object.entries(dados.abr)
      .map(([cd, entrada]) => {
        const lider = APU.lider(entrada, dicionario);
        const r = lider ? APU.ranking(entrada, dicionario) : [];
        return {
          cd,
          nome: (dados.mun && dados.mun[cd] && dados.mun[cd].nm) || cd,
          entrada,
          lider,
          /* Sem segundo colocado a margem é a própria votação do líder. */
          dif: lider ? (r[1] ? r[0].pct - r[1].pct : r[0].pct) : 0
        };
      })
      .sort((a, b) => b.entrada.te - a.entrada.te);

    const fechado = !!estado.ufTSE && Number(estado.ufTSE.pst) >= 100;
    $('tabelaMunTab').classList.toggle('is-fechada', fechado);
    $('notaTabela').textContent = 'Ordenado por eleitorado';
    $('tabelaMun').innerHTML = linhas.map(({ nome, entrada, lider, dif }) => `<tr>
        <td>${APUUI.esc(nome)}</td>
        <td class="apu-top-margin${lider ? '' : ' is-vazio'}"${lider ? ` style="--cor-partido:${APU.cor(lider.partido)}"` : ''}>
          ${lider ? APUUI.esc(lider.urna || lider.nome) + ' ' + margem(dif) : '—'}
        </td>
        <td class="num">${lider ? APU.fmt.pct(lider.pct) : '—'}</td>
        <td class="num">${lider ? APU.fmt.int(lider.votos) : '—'}</td>
        <td class="num apu-col-apurado">${APU.fmt.pct(entrada.pst || 0)}</td>
      </tr>`).join('');
  }

  /* --------------------------------------------------------------- ciclo */

  async function atualizar() {
    if (!estado.uf) return;
    if (estado.chapa === null) {
      estado.chapa = await APU.candidaturas();
      await APU.fotosDisponiveis();
      estado.zonas = (await APUUI.cidadesComZonas()).filter((c) => c.uf === estado.uf);
      estado.eleitorado = await APU.eleitorado2026();
    }
    const [d, alto, br] = await Promise.all([APU.snapshot(estado.uf), APU.snapshot('uf'),
      APU.cfg.cargo === '0001' ? APU.snapshot('br') : null]);
    if (d) estado.dados = d;
    if (br && br.abr && br.abr.br) estado.brTSE = br.abr.br;
    if (br && br.cand) estado.candBR = br.cand;
    if (alto && alto.abr && alto.abr[estado.uf]) estado.ufTSE = alto.abr[estado.uf];
    if (alto && alto.cand) estado.candTSE = alto.cand;
    /* O histórico só interessa com o estado fechado (o gráfico do fim). */
    if (estado.ufTSE && Number(estado.ufTSE.pst) >= 100) {
      estado.hist = (await APU.snapshot('hist')) || estado.hist;
    }
    await pintar();
  }

  function agendar() {
    clearTimeout(estado.timer);
    if (document.visibilityState === 'hidden') return;
    /* A camada municipal é a cara de coletar: o plantão a republica em cadência
       bem mais lenta que a nacional, então pedir de 45 em 45s seria desperdício. */
    estado.timer = setTimeout(async () => {
      /* Uma volta que estoura nao pode levar o plantao junto: sem este try, um
         unico snapshot malformado congelaria a pagina no ultimo boletim e so um
         F5 a traria de volta — sem nada na tela dizendo que parou. */
      try {
        await atualizar();
      } catch (e) {
        console.warn('[apuracao] volta falhou, seguindo para a proxima', e);
      }
      agendar();
    }, APU.intervaloDe(4));
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { atualizar().catch(() => {}).then(agendar); }
    else clearTimeout(estado.timer);
  });

  (async function iniciar() {
    $('voltarMun').onclick = () => { estado.sel = null; lateral(); };
    $('verTodosMun').onclick = () => {
      estado.topAberto = !estado.topAberto;
      aplicarTopo();
    };
    $('modoMapa').onclick = (ev) => {
      const b = ev.target.closest('[data-modo]');
      if (b) trocarModo(b.dataset.modo);
    };
    $('niveis').onclick = (ev) => {
      const b = ev.target.closest('[data-nivel]');
      if (b) trocarNivel(b.dataset.nivel);
    };
    estado.uf = lerUF();
    if (!estado.uf) {
      $('painel').hidden = true;
      $('municipios').hidden = true;
      $('maisVotos').hidden = true;
      $('semDados').hidden = false;
      $('semDadosTexto').textContent =
        'Estado não informado ou inválido. Volte à apuração nacional e escolha um estado no mapa.';
      return;
    }
    try {
      await atualizar();
    } catch (e) {
      console.warn('[apuracao] primeira carga falhou', e);
    }
    agendar();
  })();
})();
