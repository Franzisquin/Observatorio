/* ===========================================================================
   ElectoMaps — apuração dos governadores

   Os 27 governos estaduais numa página: no topo, os governadores eleitos por
   partido — só entra quem tem a eleição declarada, pelo TSE ou
   matematicamente (APU.governos) —; no mapa, a cor do partido de quem lidera
   em cada estado: cheia quando eleito, clara enquanto só está à frente, e com
   riscos diagonais onde a disputa vai ao 2º turno. Embaixo, um cartão por
   estado, que leva ao mapa por município.

   Lê a camada alta de governador ({ele}-0003-uf.json) e nada da municipal.
   =========================================================================== */
'use strict';

(function () {

  const $ = (id) => document.getElementById(id);
  const esc = APUUI.esc;
  const CARGO = '0003';
  const UFS = APUUI.UFS_POR_ELEITORADO;
  const NS = 'http://www.w3.org/2000/svg';

  const estado = { gov: null, chapa: null, timer: null };

  const hrefDaUF = (uf) => 'apuracao-uf.html' + APUUI.paramsDeFonte({ uf, cargo: CARGO });

  /* ----------------------------------------------------------- placar */

  /* Os partidos com governador eleito, e quantos estados ainda faltam. */
  function placar(g) {
    const partidos = g.porPartido;
    $('tituloPlacarGov').textContent = g.eleitos
      ? `Governadores eleitos por partido · ${g.eleitos} de 27`
      : 'Governadores eleitos por partido';

    /* A lista só tem partido com governador eleito. Antes do primeiro, uma
       linha dizendo quantos estados faltam. */
    const pendentes = 27 - g.eleitos - g.segundo;
    const resumo = [g.segundo ? `${g.segundo} ${g.segundo === 1 ? 'vai' : 'vão'} ao 2º turno` : '',
      pendentes ? `${pendentes} a definir` : ''].filter(Boolean).join(' · ');
    $('partidosGov').innerHTML = partidos.map((p) => `<li class="apu-gov-partido" style="--cor:${p.cor}">`
      + `<span class="apu-swatch" style="background:${p.cor}"></span>`
      + `<span class="apu-gov-partido-sigla">${esc(p.sigla)}</span>`
      + `<b class="apu-gov-partido-n">${p.eleitos}</b>`
      + `<span class="apu-gov-partido-ufs">${p.ufs.map((u) => u.toUpperCase()).join(' ')}</span></li>`).join('')
      + (resumo ? `<li class="apu-gov-resto">${esc(resumo)}</li>` : '');
  }

  /* ------------------------------------------------------------- mapa */

  /* Riscos de 2º turno: um <pattern> por cor, com o fundo na cor de quem
     lidera e as listras claras por cima. Criado sob demanda no <defs>. */
  function riscos(svg, cor) {
    let defs = svg.querySelector('defs');
    if (!defs) { defs = document.createElementNS(NS, 'defs'); svg.insertBefore(defs, svg.firstChild); }
    const id = 'riscos-' + cor.replace(/[^0-9a-z]/gi, '');
    if (!svg.querySelector('#' + id)) {
      const p = document.createElementNS(NS, 'pattern');
      p.setAttribute('id', id);
      p.setAttribute('patternUnits', 'userSpaceOnUse');
      p.setAttribute('width', '9');
      p.setAttribute('height', '9');
      p.setAttribute('patternTransform', 'rotate(45)');
      const fundo = document.createElementNS(NS, 'rect');
      fundo.setAttribute('width', '9');
      fundo.setAttribute('height', '9');
      fundo.setAttribute('fill', cor);
      const risco = document.createElementNS(NS, 'rect');
      risco.setAttribute('width', '3.4');
      risco.setAttribute('height', '9');
      risco.setAttribute('class', 'apu-gov-risco');
      p.appendChild(fundo);
      p.appendChild(risco);
      defs.appendChild(p);
    }
    return `url(#${id})`;
  }

  function mapa(g) {
    const svg = $('mapaGov');
    const pacote = estado.gov;
    const dic = (pacote && pacote.cand) || {};
    /* Balão e clique vêm do mapa comum; a cor é a desta página. */
    APUUI.pintarMapa(svg, (uf) => (pacote && pacote.abr && pacote.abr[uf]) || null, dic,
      (uf) => { location.href = hrefDaUF(uf); });
    svg.querySelectorAll('path[data-chave]').forEach((p) => {
      const u = g.porUF[p.getAttribute('data-chave')];
      if (!u || u.estado === 'vazio' || !u.lider) return;
      const cor = APU.cor(u.lider.partido);
      p.style.fillOpacity = '1';
      p.style.fill = u.estado === 'eleito' ? APUUI.tom(cor, 5)
        : (u.estado === 'segundo' ? riscos(svg, APUUI.tom(cor, 5)) : APUUI.tom(cor, 2));
    });
  }

  /* ---------------------------------------------------------- estados */

  function estados() {
    const pacote = estado.gov;
    $('gradeEstados').innerHTML = UFS
      .map((uf) => APUUI.cartaoEstado(uf, CARGO, pacote, estado.chapa, hrefDaUF(uf))).join('');
    const comVoto = pacote && pacote.abr
      ? UFS.filter((uf) => pacote.abr[uf] && pacote.abr[uf].vv > 0).length : 0;
    $('notaEstados').textContent = comVoto
      ? `${comVoto} de ${UFS.length} unidades com votos` : `${UFS.length} unidades federativas`;
  }

  /* ------------------------------------------------------------ ciclo */

  function pintar() {
    const pacote = estado.gov;
    const cab = APU.cabecalhoDe(pacote && pacote.abr);
    APUUI.seletorDeCargo('seletorCargo', CARGO, '');
    APUUI.barraDeUFs('seletorUF', CARGO, '');
    APUUI.ligarMenu(CARGO);
    APUUI.selo(pacote && pacote.meta, cab);
    APUUI.progresso(cab && cab.ts ? cab : null);

    const g = APU.governos(pacote);
    $('subtitulo').textContent = g.eleitos || g.segundo
      ? `27 estados · ${g.eleitos} ${g.eleitos === 1 ? 'eleito' : 'eleitos'}`
        + (g.segundo ? ` · ${g.segundo} no 2º turno` : '')
      : '27 estados';
    placar(g);
    mapa(g);
    estados();
  }

  async function atualizar() {
    if (estado.chapa === null) estado.chapa = await APU.candidaturas(CARGO);
    const gov = await APU.snapshot('uf', CARGO);
    /* Boletim antigo vale mais que painel vazio: só substitui o que chegou. */
    if (gov) estado.gov = gov;
    pintar();
  }

  function agendar() {
    clearTimeout(estado.timer);
    if (document.visibilityState === 'hidden') return;
    estado.timer = setTimeout(async () => {
      try {
        await atualizar();
      } catch (e) {
        console.warn('[apuracao] volta falhou, seguindo para a próxima', e);
      }
      agendar();
    }, APU.intervaloDe(1));
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') atualizar().catch(() => {}).then(agendar);
    else clearTimeout(estado.timer);
  });

  (async function iniciar() {
    pintar();
    try {
      await atualizar();
    } catch (e) {
      console.warn('[apuracao] primeira carga falhou', e);
    }
    agendar();
  })();
})();
