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
    timer: null
  };

  /* Um snapshot de cargo diferente do configurado na URL: a central mostra os
     três ao mesmo tempo, então não dá para depender de APU.cfg.cargo. */
  async function snapshotDe(cargo, sufixo) {
    if (!APU.cfg.eleicao) return null;
    const url = `${APU.cfg.base}${APU.cfg.eleicao}-${cargo}-${sufixo}.json`;
    try {
      const r = await fetch(url + (url.includes('?') ? '&' : '?') + '_=' + Date.now(),
        { cache: 'no-store' });
      return r.ok ? await r.json() : null;
    } catch (e) {
      return null;
    }
  }

  function params(extra) {
    const p = [];
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
    APUUI.placar(lista, 'placarPresidente', { limite: 4 });

    pintarMapaNacional();
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

    const entradas = pacote && pacote.abr ? Object.values(pacote.abr) : [];
    const comVotos = entradas.filter((e) => e && e.vv > 0).length;
    $('notaMapa').textContent = comVotos
      ? comVotos + ' de ' + entradas.length + ' unidades com votos'
      : 'Liderança por estado — aguardando o primeiro boletim';
  }

  /* ------------------------------------------------------------- estados */

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
    const lista = (comVotos ? APU.ranking(entrada, dicionario) : APU.rankingZerado(chapa, uf))
      .slice(0, 2);
    const pst = entrada ? (entrada.pst || 0) : 0;

    if (!lista.length) {
      return '<a class="apu-estado is-vazio" href="' + href + '">'
        + '<div class="apu-estado-head"><span class="apu-estado-uf">' + APUUI.esc(nome) + '</span></div>'
        + '<p class="apu-estado-vazio">sem lista importada</p></a>';
    }

    const lider = comVotos ? APU.cor(lista[0].partido) : 'var(--line-strong)';
    const linhas = lista.map((c, i) =>
      '<div class="apu-estado-linha ' + (i === 0 && comVotos ? 'is-lead' : '') + '"'
      + ' style="--cor-linha:' + APU.cor(c.partido) + '">'
      + '<span class="apu-estado-nome">' + APUUI.esc(c.urna) + '</span>'
      + '<span class="apu-estado-pct">' + APU.fmt.pct(c.pct) + '</span></div>').join('');

    return '<a class="apu-estado" href="' + href + '" style="--cor:' + lider + '">'
      + '<div class="apu-estado-head"><span class="apu-estado-uf">' + APUUI.esc(nome) + '</span></div>'
      + linhas
      + '<div class="apu-estado-pe">'
      + '<div class="apu-mini"><span style="width:' + Math.min(100, pst) + '%;background:var(--ink)"></span></div>'
      + '<span class="apu-estado-apurado">' + APU.fmt.pct(pst) + ' apurado</span>'
      + '</div></a>';
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

    const [br, ufPres, gov, sen] = await Promise.all([
      snapshotDe('0001', 'br'), snapshotDe('0001', 'uf'),
      snapshotDe(CARGO_GOV, 'uf'), snapshotDe(CARGO_SEN, 'uf')
    ]);
    /* Boletim antigo vale mais que painel vazio: só substitui o que chegou. */
    if (br) estado.br = br;
    if (ufPres) estado.ufPres = ufPres;
    if (gov) estado.gov = gov;
    if (sen) estado.sen = sen;

    $('linkPresidente').href = 'apuracao-presidente.html' + params({ cargo: '0001' });
    pintarPresidente();
    pintarEstados();
  }

  function agendar() {
    clearTimeout(estado.timer);
    if (document.visibilityState === 'hidden') return;
    estado.timer = setTimeout(async () => {
      await atualizar();
      agendar();
    }, APU.cfg.intervalo);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') atualizar().then(agendar);
    else clearTimeout(estado.timer);
  });

  (async function iniciar() {
    await atualizar();
    agendar();
  })();
})();
