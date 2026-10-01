/* ===========================================================================
   ElectoMaps — central de apuração

   Porta de entrada da noite: presidente em destaque no topo, e as disputas de
   governador e senador nos maiores colégios eleitorais logo abaixo. Cada
   estado leva para a sua própria página, onde está o mapa por município.

   Lê três camadas altas ({ele}-0001-br, -0003-uf, -0005-uf) e nada da camada
   municipal, que é a cara de coletar e aqui não é usada.
   =========================================================================== */
'use strict';

(function () {

  const $ = (id) => document.getElementById(id);

  /* As 27 unidades, ordenadas por tamanho do eleitorado (TSE, 2022) — não é
     ranking de importância política, é onde mais gente vota. */
  const UFS = ['sp', 'mg', 'rj', 'ba', 'rs', 'pr', 'pe', 'ce', 'pa', 'sc', 'go', 'ma',
    'am', 'es', 'pb', 'rn', 'mt', 'al', 'pi', 'df', 'ms', 'se', 'ro', 'to', 'ac', 'ap', 'rr'];

  const CARGO_GOV = '0003';
  const CARGO_SEN = '0005';

  const estado = {
    br: null, ufPres: null,
    gov: null, sen: null,
    chapaPres: null, chapaGov: null, chapaSen: null,
    ab: null,
    /* Projeção do resultado presidencial ({ele}-0001-proj.json). */
    proj: null,
    timer: null
  };

  /* A central mostra três cargos ao mesmo tempo, e em 2026 eles não vivem na
     mesma eleição: presidente está na federal, governador e senador na estadual.
     APU.snapshot resolve o código de cada um pelo índice do coletor. */
  const snapshotDe = (cargo, sufixo) => APU.snapshot(sufixo, cargo);

  function params(extra) {
    const p = [];
    /* O cargo de destino decide a eleição; o índice faz a tradução do outro lado,
       então basta repassar o que veio na URL. */
    if (APU.cfg.eleicao) p.push('eleicao=' + encodeURIComponent(APU.cfg.eleicao));
    Object.entries(extra || {}).forEach(([k, v]) => p.push(`${k}=${encodeURIComponent(v)}`));
    const dados = new URLSearchParams(location.search).get('dados');
    if (dados) p.push('dados=' + encodeURIComponent(dados));
    return p.length ? '?' + p.join('&') : '';
  }

  /* ---------------------------------------------------------- presidente */

  function pintarPresidente() {
    const dados = estado.br;
    const nacional = dados && dados.abr && dados.abr.br;
    const dicionario = (dados && dados.cand) || {};

    APUUI.selo(dados && dados.meta, nacional);
    APUUI.progresso(nacional);

    const lista = nacional
      ? APU.ranking(nacional, dicionario)
      : APU.rankingZerado(estado.chapaPres);
    APUUI.placar(lista, 'placarPresidente',
      { limite: 4, entrada: nacional, cargo: '0001' });
    APUUI.avisos(nacional, 'avisos');
    resumoProjecao(nacional, dicionario);

    pintarMapaNacional();
  }

  /* A projeção do resultado final em uma linha, com o link para a página
     presidencial, onde ela está inteira. Some antes do mínimo de urnas e depois
     que o TSE declara o resultado, como lá. */
  function resumoProjecao(nacional, dicionario) {
    const el = $('projResumo');
    const pr = estado.proj;
    const decidido = !!(nacional && (APU.definicao(nacional) || nacional.tf === 's'));
    el.hidden = !(pr && pr.suficiente && pr.cand) || !nacional || decidido;
    if (el.hidden) return;
    el.href = 'apuracao-presidente.html' + params({ cargo: '0001' });

    const nome = (id) => APU.nomeProprio((dicionario[id] && (dicionario[id].urna || dicionario[id].nome)) || id);
    const reais = Object.entries(pr.cand).filter(([id]) => id !== 'outros')
      .sort((a, b) => b[1].media - a[1].media);
    const [lid, lider] = reais[0];
    const d = pr.desfecho || {};
    let txt;
    if (reais.length === 2) {
      txt = `Vitória de ${nome(lid)} ${APUUI.chance(lider.p_maioria)}.`;
    } else if ((d.p_decidido || 0) >= 0.5) {
      txt = `Vitória de ${nome(lid)} no 1º turno ${APUUI.chance(lider.p_maioria)}.`;
    } else {
      const par = (d.segundo_turno || [])[0];
      txt = `2º turno ${APUUI.chance(1 - (d.p_decidido || 0))}`
        + (par ? `, mais provável entre ${nome(par.par[0])} e ${nome(par.par[1])}` : '')
        + `. Mais votado no 1º turno: ${nome(lid)} (${APUUI.chancePct(lider.p_primeiro)}).`;
    }
    $('projResumoTexto').textContent = `${txt} Com ${APU.fmt.pct(pr.pct_apurado)} das urnas.`;
  }

  /* Mapa presidencial por UF, ao lado do placar. Sai do mesmo snapshot de UF
     que a página presidencial usa. */
  function pintarMapaNacional() {
    const pacote = estado.ufPres;
    const dicionario = (pacote && pacote.cand) || {};
    const entradaDe = (uf) => (pacote && pacote.abr && pacote.abr[uf]) || null;

    APUUI.pintarMapa($('mapaNacional'), entradaDe, dicionario, (uf) => {
      location.href = 'apuracao-uf.html' + params({ uf: uf, cargo: '0001' });
    });

    /* O exterior vota para presidente e entra no total do país, mas não é
       unidade da Federação: fica fora desta contagem. */
    const entradas = pacote && pacote.abr
      ? Object.entries(pacote.abr)
        .filter(([sigla]) => sigla !== APU.EXTERIOR)
        .map(([, e]) => e)
      : [];
    const comVotos = entradas.filter((e) => e && e.vv > 0).length;
    $('notaMapa').textContent = comVotos
      ? comVotos + ' de ' + entradas.length + ' unidades com votos'
      : 'Liderança por estado — aguardando o primeiro boletim';
  }

  /* ------------------------------------------------------------- estados */

  /* Ordem das células em bandeiras-estados.png. É a mesma que
     scripts/gerar_bandeiras_estados.py imprime ao gerar o sprite — se aquele
     script mudar de ordem, esta linha muda junto, ou cada estado passa a exibir
     a bandeira do vizinho. Fora da lista (o exterior, `zz`) fica sem chip. */
  const ORDEM_BANDEIRAS = ('ac al am ap ba ce df es go ma mg ms mt pa pb pe pi '
    + 'pr rj rn ro rr rs sc se sp to').split(' ');

  /* Decorativa: o nome do estado está ao lado, então o leitor de tela não ganha
     nada repetindo "bandeira de São Paulo" antes dele. */
  function bandeira(uf) {
    const i = ORDEM_BANDEIRAS.indexOf(uf);
    return i < 0 ? ''
      : '<span class="apu-estado-bandeira" style="--bandeira:' + i + '" aria-hidden="true"></span>';
  }

  /* Um cartão por estado. Com boletim mostra quem lidera; sem boletim, quantas
     candidaturas estão em disputa ali. */
  function cartao(uf, cargo, pacote, chapa) {
    const nome = APU.UF_NOMES[uf] || uf.toUpperCase();
    const entrada = pacote && pacote.abr && pacote.abr[uf];
    const dicionario = (pacote && pacote.cand) || {};
    const href = 'apuracao-uf.html' + params({ uf: uf, cargo: cargo });
    const comVotos = !!(entrada && entrada.vv > 0);

    /* Com voto, os dois primeiros de verdade. Sem voto, os dois primeiros da
       chapa registrada — todos em 0,00%, então nenhum aparece à frente do
       outro, porque nada foi apurado. */
    /* A marca sai da lista inteira, não do recorte: quem ocupa a segunda vaga do
       Senado é o segundo da UF, e cortar antes de marcar mudaria o índice. */
    const completa = comVotos ? APU.ranking(entrada, dicionario) : APU.rankingZerado(chapa, uf);
    if (comVotos) APU.marcar(completa, entrada, cargo);
    /* Duas linhas porque o Senado de 2026 tem duas vagas por estado e a
       majoritária de vaga única precisa mostrar o segundo para dar a margem. */
    const lista = completa.slice(0, 2);
    const pst = entrada ? (entrada.pst || 0) : 0;

    if (!lista.length) {
      return '<a class="apu-estado is-vazio" href="' + href + '">'
        + '<div class="apu-estado-head">' + bandeira(uf)
        + '<span class="apu-estado-uf">' + APUUI.esc(nome) + '</span></div>'
        + '<p class="apu-estado-vazio">sem lista importada</p></a>';
    }

    const lider = comVotos ? APU.cor(lista[0].partido) : 'var(--line-strong)';
    const linhas = lista.map((c, i) => {
      /* Check sólido quando é certo — declarado pelo TSE ou matematicamente
         definido: verde para eleito, azul para quem vai ao 2º turno.
         Tracejado quando ainda é leitura. */
      const marca = c.marca
        ? '<span class="apu-tique is-' + c.marca + (APUUI.firme(c) ? '' : ' is-previsto')
          + '" title="' + APUUI.esc(APUUI.tituloDaMarca(c))
          + '">' + APUUI.icone('tique', 11) + '</span>'
        : '';
      return '<div class="apu-estado-linha ' + (i === 0 && comVotos ? 'is-lead' : '') + '"'
        + ' style="--cor-linha:' + APU.cor(c.partido) + '">'
        + '<span class="apu-estado-nome">' + APUUI.esc(c.urna) + marca + '</span>'
        + '<span class="apu-estado-pct">' + APU.fmt.pct(c.pct) + '</span></div>';
    }).join('');

    return '<a class="apu-estado" href="' + href + '" style="--cor:' + lider + '">'
      + '<div class="apu-estado-head">' + bandeira(uf)
      + '<span class="apu-estado-uf">' + APUUI.esc(nome) + '</span></div>'
      + linhas
      + '<div class="apu-estado-pe">'
      + '<div class="apu-mini"><span style="width:' + Math.min(100, pst) + '%;background:var(--ink)"></span></div>'
      + '<span class="apu-estado-apurado">' + APU.fmt.pct(pst) + ' apurado</span>'
      + '</div></a>';
  }

  /* --------------------------------------------------- andamento (EA14) */

  /* Onde ainda se está contando, com os contadores que o próprio TSE publica no
     arquivo de acompanhamento: estágio da UF e quantos dos seus municípios já
     finalizaram. É a leitura que fica interessante justamente quando o mapa de
     quem ganha já saturou. */
  function pintarAndamento() {
    const secao = $('andamento');
    const corpo = $('tabelaAndamento');
    if (!secao || !corpo) return;

    const ab = estado.ab;
    if (!ab || !ab.uf || !Object.keys(ab.uf).length) { secao.hidden = true; return; }
    secao.hidden = false;

    const br = ab.br || {};
    /* Os contadores do EA14 somam todas as abrangências, exterior incluído.
       Aqui a frase é sobre unidades da Federação, então ele sai dos dois lados:
       do total e, se já tiver finalizado, também do numerador. */
    const ext = ab.uf[APU.EXTERIOR];
    const fora = ext ? 1 : 0;
    const foraFinalizada = ext && ext.and === 'f' ? 1 : 0;
    $('notaAndamento').textContent = br.pst != null
      ? `${APU.fmt.pct(br.pst)} das seções do país · `
        + `${APU.fmt.int(br.uff - foraFinalizada)} de `
        + `${APU.fmt.int(br.uff + br.ufpt + br.ufnr - fora)} unidades finalizadas`
      : '';

    const linhas = Object.values(ab.uf)
      .sort((a, b) => (b.pst || 0) - (a.pst || 0)
        || (APU.UF_NOMES[a.cd] || a.cd).localeCompare(APU.UF_NOMES[b.cd] || b.cd, 'pt-BR'));

    corpo.innerHTML = linhas.map((u) => {
      const nome = APU.UF_NOMES[u.cd] || u.cd.toUpperCase();
      const total = u.muf + u.mupt + u.munr;
      return `<tr>
        <td><a href="apuracao-uf.html${params({ uf: u.cd, cargo: '0001' })}">${APUUI.esc(nome)}</a></td>
        <td><span class="apu-estagio is-${u.and}">${APUUI.esc(APU.ESTAGIOS[u.and] || u.and)}</span></td>
        <td class="num">${APU.fmt.pct(u.pst || 0)}</td>
        <td class="num">${APU.fmt.int(u.snt)}</td>
        <td class="num">${APU.fmt.int(u.esnt)}</td>
        <td class="num">${total ? APU.fmt.int(u.muf) + ' / ' + APU.fmt.int(total) : '—'}</td>
      </tr>`;
    }).join('');
  }

  /* As marcas de todos os cartões de um cargo, para a legenda saber se há selo
     oficial, deduzido, ou os dois na tela. */
  function marcasDe(pacote, cargo) {
    if (!pacote || !pacote.abr) return [];
    const dicionario = pacote.cand || {};
    return UFS.flatMap((uf) => {
      const entrada = pacote.abr[uf];
      if (!entrada || !(entrada.vv > 0)) return [];
      return APU.marcar(APU.ranking(entrada, dicionario), entrada, cargo).slice(0, 2);
    });
  }

  function pintarEstados() {
    $('gradeGov').innerHTML = UFS
      .map((uf) => cartao(uf, CARGO_GOV, estado.gov, estado.chapaGov)).join('');
    $('gradeSen').innerHTML = UFS
      .map((uf) => cartao(uf, CARGO_SEN, estado.sen, estado.chapaSen)).join('');

    const comDados = (p) => p && p.abr
      ? UFS.filter((uf) => p.abr[uf] && p.abr[uf].vv > 0).length : 0;
    const nota = (p) => comDados(p)
      ? comDados(p) + ' de ' + UFS.length + ' unidades com votos'
      : UFS.length + ' unidades federativas';
    $('notaGov').textContent = nota(estado.gov);
    $('notaSen').textContent = nota(estado.sen);
  }

  /* --------------------------------------------------------------- ciclo */

  async function atualizar() {
    if (estado.chapaPres === null) {
      const [p, g, s] = await Promise.all([
        APU.candidaturas('0001'), APU.candidaturas(CARGO_GOV), APU.candidaturas(CARGO_SEN)
      ]);
      estado.chapaPres = p; estado.chapaGov = g; estado.chapaSen = s;
      await APU.fotosDisponiveis();
    }

    const [br, ufPres, gov, sen, ab, proj] = await Promise.all([
      snapshotDe('0001', 'br'), snapshotDe('0001', 'uf'),
      snapshotDe(CARGO_GOV, 'uf'), snapshotDe(CARGO_SEN, 'uf'),
      APU.acompanhamento('0001'), snapshotDe('0001', 'proj')
    ]);
    /* Boletim antigo vale mais que painel vazio: só substitui o que chegou. */
    if (br) estado.br = br;
    if (ufPres) estado.ufPres = ufPres;
    if (gov) estado.gov = gov;
    if (sen) estado.sen = sen;
    if (ab) estado.ab = ab;
    if (proj) estado.proj = proj;

    $('linkPresidente').href = 'apuracao-presidente.html' + params({ cargo: '0001' });
    APUUI.ligarMenu('');
    pintarPresidente();
    pintarEstados();
    pintarAndamento();
  }

  function agendar() {
    clearTimeout(estado.timer);
    if (document.visibilityState === 'hidden') return;
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
    }, APU.cfg.intervalo);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') atualizar().catch(() => {}).then(agendar);
    else clearTimeout(estado.timer);
  });

  (async function iniciar() {
    try {
      await atualizar();
    } catch (e) {
      console.warn('[apuracao] primeira carga falhou', e);
    }
    agendar();
  })();
})();
