/* ===========================================================================
   ElectoMaps — apuração nacional

   Lê dois snapshots: o do Brasil (placar nacional) e o das 27 UFs (mapa e
   tabela). Quando o cargo não tem arquivo de abrangência Brasil — governador,
   senador —, o nacional é a soma das UFs, que é aritmética do próprio TSE, não
   estimativa.

   O mapa é MapLibre sobre vector tiles da malha municipal HD do IBGE, gerados
   por scripts/gerar_tiles_apuracao.py: estados e municípios do país inteiro
   numa fonte só. O navegador baixa apenas os tiles do que está à vista — no
   zoom nacional são poucos —, e no zoom máximo a malha vem sem simplificação.

   Clicar num estado abre os municípios dele nesta mesma tela; a camada
   "Municípios" mostra o país inteiro. Nenhuma das duas baixa malha: os
   municípios chegam nos mesmos tiles dos estados. Camada, estado aberto,
   esmaecimento, cursor e a cor de cada boletim são `feature-state`, que não faz
   o worker refazer tile — a tela responde no quadro seguinte.

   Os municípios leem a camada municipal ({ele}-{cargo}-{uf}.json) só das UFs
   desenhadas, e na cadência dela, mais lenta que a da camada alta.
   =========================================================================== */
'use strict';

(function () {

  const $ = (id) => document.getElementById(id);

  const estado = {
    br: null, uf: null, chapa: null, timer: null, volta: 0,
    /* Projeção do resultado final ({ele}-{cargo}-proj.json), que o plantão
       grava a cada camada municipal (scripts/apuracao/projecao.py). */
    proj: null,
    /* Camada municipal por UF: o snapshot (null = pedido, ainda sem arquivo) e
       o mesmo boletim indexado pelo código IBGE, que é o id da malha. */
    mun: {}, porIbge: {},
    /* 'uf' pinta estados; 'mun', os municípios do país inteiro. */
    camada: 'uf',
    /* Abrangência aberta: null (Brasil), a sigla de uma UF ou o exterior. */
    foco: null,
    /* Município escolhido no mapa: { uf, ibge, nome }. */
    sel: null
  };

  function nomeDoCargo() {
    return APU.CARGOS[APU.cfg.cargo] || 'Apuração';
  }

  /* O exterior abre no painel como uma UF, mas não tem território para
     enquadrar nem município para desenhar. */
  const ufReal = (sigla) => (sigla && sigla !== APU.EXTERIOR ? sigla : null);

  function dicionario() {
    return (estado.br && estado.br.cand) || (estado.uf && estado.uf.cand) || {};
  }

  /* Municipal como base, nacional por cima: a base garante nome a quem só a
     camada municipal traz, e a de cima traz a situação completa do candidato. */
  function dicionarioMun(uf) {
    return { ...((estado.mun[uf] && estado.mun[uf].cand) || {}), ...dicionario() };
  }

  /* ------------------------------------------------------------------ mapa */

  /* Caixa do continente, sem as ilhas oceânicas: com Trindade o país sairia
     encostado à esquerda do quadro. */
  const BRASIL = [[-74.0, -33.8], [-34.7, 5.3]];

  /* Folga do enquadramento; a de cima deixa o seletor de camada livre. */
  const MOLDURA = { top: 56, bottom: 28, left: 28, right: 28 };

  /* O globo do exterior fica a oeste de Rondônia, onde ele estava no SVG. */
  const EXTERIOR_EM = [-66.5, -19.5];

  /* Os tiles e o que o gerador sabe de cada UF. MALHA_MAX e MALHA_CAIXA são os
     Z_MAX e CAIXA de scripts/gerar_tiles_apuracao.py: acima do último nível o
     MapLibre amplia os tiles dele, e fora da caixa não pede tile. */
  const MALHA = 'resultados_geo/malha_apuracao/';
  const MALHA_MAX = 9;
  const MALHA_CAIXA = [-74.5, -34.5, -28.0, 6.0];

  const mapa = {
    gl: null,
    ufs: [],               // siglas com território (o exterior fica fora)
    meta: {},              // sigla -> { cd, caixa, mun: [IBGE] }, de ufs.json
    desenhadas: new Set(), // UFs com os municípios à mostra
    fora: new Set(),       // UFs esmaecidas, fora do estado aberto
    hover: null,           // alvo de feature-state sob o cursor
    sel: null              // IBGE com o contorno aceso
  };

  /* Os tons do mapa são os do palco, e mudam com o botão de tema. O contorno é
     o `--map-contorno` de apuracao.css: cinza-escuro no claro e, no escuro, vazio
     — aí a divisa é o próprio fundo, como no SVG. */
  function cores() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    const fundo = v('--paper-2');
    return { fundo, contorno: v('--map-contorno') || fundo,
      vazio: v('--map-vazio') || v('--paper-3'), tinta: v('--ink') };
  }

  const noEstado = (sigla) => ({ source: 'malha', sourceLayer: 'estados', id: mapa.meta[sigla].cd });
  const noMun = (id) => ({ source: 'malha', sourceLayer: 'municipios', id });

  /* Cor do líder, posta em `feature-state` a cada boletim; sem voto, o cinza
     neutro do palco. */
  const corDe = (c) => ['to-color', ['feature-state', 'cor'], c.vazio];
  const liga = (chave, sim, nao) => ['case', ['boolean', ['feature-state', chave], false], sim, nao];

  /* Opacidade: a da margem (`op`), mais clara sob o cursor como o `:hover` do
     SVG, e esmaecida fora do estado aberto (`fora`). O estado some (`oculto`)
     onde os municípios estão à mostra — por baixo da transparência deles, ele
     mudaria a cor que se lê. O município só aparece com `mostra`: sem isso ele
     está no tile, mas transparente. */
  const OPACIDADE_UF = ['*', ['number', ['feature-state', 'op'], 1],
    liga('hover', 0.72, 1), liga('oculto', 0, 1), liga('fora', 0.35, 1)];
  const OPACIDADE_MUN = ['*', ['number', ['feature-state', 'op'], 1],
    liga('hover', 0.72, 1), liga('mostra', 1, 0), liga('fora', 0.35, 1)];

  const LARGURA_MUN = ['interpolate', ['linear'], ['zoom'], 4, 0.1, 7, 0.5, 10, 1.1];
  const LARGURA_UF = ['interpolate', ['linear'], ['zoom'], 3, 0.8, 7, 1.6];

  const semMovimento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function criarMapa() {
    const c = cores();
    const gl = new maplibregl.Map({
      container: 'mapaBrasil',
      /* Sem mapa de base: o palco é o papel da página, como era no SVG. */
      style: {
        version: 8, sources: {},
        layers: [{ id: 'fundo', type: 'background', paint: { 'background-color': c.fundo } }]
      },
      bounds: BRASIL,
      fitBoundsOptions: { padding: MOLDURA },
      minZoom: 2,
      maxZoom: 12,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      renderWorldCopies: false,
      attributionControl: false,
      /* No toque, um dedo rola a página e dois movem o mapa: ele ocupa quase a
         tela inteira do celular, e prenderia a rolagem. */
      cooperativeGestures: matchMedia('(pointer: coarse)').matches,
      locale: {
        'Map.Title': 'Mapa da apuração',
        'NavigationControl.ZoomIn': 'Aproximar',
        'NavigationControl.ZoomOut': 'Afastar',
        'CooperativeGesturesHandler.WindowsHelpText': 'Use Ctrl + rolagem para aproximar o mapa',
        'CooperativeGesturesHandler.MacHelpText': 'Use ⌘ + rolagem para aproximar o mapa',
        'CooperativeGesturesHandler.MobileHelpText': 'Use dois dedos para mover o mapa'
      }
    });
    gl.touchZoomRotate.disableRotation();
    gl.keyboard.disableRotation();
    gl.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    mapa.gl = gl;

    return Promise.all([
      new Promise((ok) => gl.once('load', ok)),
      fetch(MALHA + 'ufs.json').then((r) => {
        if (!r.ok) throw new Error('ufs.json: HTTP ' + r.status);
        return r.json();
      })
    ]).then(([, meta]) => {
      mapa.meta = meta;
      mapa.ufs = Object.keys(meta);

      gl.addSource('malha', {
        type: 'vector',
        /* O worker não resolve caminho relativo: a URL vai inteira. */
        tiles: [new URL(MALHA, document.baseURI).href + '{z}/{x}/{y}.pbf'],
        minzoom: 2,
        maxzoom: MALHA_MAX,
        bounds: MALHA_CAIXA,
        promoteId: 'cd'
      });

      /* De baixo para cima: estados, municípios, bordas municipais, divisa
         estadual e o contorno do município escolhido. A divisa sai da mesma
         malha dos municípios, então casa com eles em qualquer zoom. */
      const est = { source: 'malha', 'source-layer': 'estados' };
      const mun = { source: 'malha', 'source-layer': 'municipios' };
      const redondo = { 'line-join': 'round' };
      gl.addLayer({ id: 'uf-fill', type: 'fill', ...est,
        paint: { 'fill-color': corDe(c), 'fill-opacity': OPACIDADE_UF,
          'fill-outline-color': 'rgba(0,0,0,0)' } });
      gl.addLayer({ id: 'mun-fill', type: 'fill', ...mun,
        paint: { 'fill-color': corDe(c), 'fill-opacity': OPACIDADE_MUN,
          'fill-outline-color': 'rgba(0,0,0,0)' } });
      gl.addLayer({ id: 'mun-line', type: 'line', ...mun, layout: redondo,
        paint: { 'line-color': c.contorno, 'line-width': LARGURA_MUN,
          'line-opacity': liga('mostra', 1, 0) } });
      gl.addLayer({ id: 'uf-line', type: 'line', ...est, layout: redondo,
        paint: { 'line-color': c.contorno, 'line-width': LARGURA_UF } });
      gl.addLayer({ id: 'mun-sel', type: 'line', ...mun, layout: redondo,
        paint: { 'line-color': c.tinta, 'line-width': 2, 'line-opacity': liga('sel', 1, 0) } });

      ligarEventos();
      ligarExterior();
    });
  }

  function ligarExterior() {
    const el = $('exterior');
    new maplibregl.Marker({ element: el }).setLngLat(EXTERIOR_EM).addTo(mapa.gl);
    el.hidden = false;
  }

  function aplicarTema() {
    const gl = mapa.gl;
    const c = cores();
    gl.setPaintProperty('fundo', 'background-color', c.fundo);
    gl.setPaintProperty('uf-fill', 'fill-color', corDe(c));
    gl.setPaintProperty('mun-fill', 'fill-color', corDe(c));
    gl.setPaintProperty('mun-line', 'line-color', c.contorno);
    gl.setPaintProperty('uf-line', 'line-color', c.contorno);
    gl.setPaintProperty('mun-sel', 'line-color', c.tinta);
  }

  /* Quais UFs têm os municípios desenhados. */
  function ufsDesenhadas() {
    if (estado.camada === 'mun') return mapa.ufs.slice();
    const uf = ufReal(estado.foco);
    return uf ? [uf] : [];
  }

  /* Dá o mesmo estado a todos os municípios de cada UF de `querem`, e tira das
     que saíram. Só passa pelas UFs que mudaram: é um feature-state por
     município, e o país tem 5.571. */
  function marcar(conjunto, querem, chaveMun, chaveUF) {
    const gl = mapa.gl;
    mapa.ufs.forEach((uf) => {
      const sim = querem.includes(uf);
      if (sim === conjunto.has(uf)) return;
      if (sim) conjunto.add(uf);
      else conjunto.delete(uf);
      gl.setFeatureState(noEstado(uf), { [chaveUF]: sim });
      mapa.meta[uf].mun.forEach((id) => gl.setFeatureState(noMun(id), { [chaveMun]: sim }));
    });
  }

  function realcarSel() {
    const id = estado.sel ? estado.sel.ibge : null;
    if (id === mapa.sel) return;
    if (mapa.sel !== null) mapa.gl.setFeatureState(noMun(mapa.sel), { sel: false });
    if (id !== null) mapa.gl.setFeatureState(noMun(id), { sel: true });
    mapa.sel = id;
  }

  /* ---------------------------------------------------------- pintura */

  function pintarUFs() {
    if (!mapa.ufs.length) return;
    const d = estado.uf;
    const dic = dicionario();
    const entradaDe = (sigla) => (d && d.abr && d.abr[sigla]) || null;
    mapa.ufs.forEach((sigla) => {
      const t = APUUI.tinta(entradaDe(sigla), dic);
      mapa.gl.setFeatureState(noEstado(sigla), { cor: t ? t.cor : null, op: t ? t.op : 1 });
    });
    /* O globo é SVG: o mesmo pintor das páginas estaduais e da central. */
    APUUI.pintarMapa($('exterior').querySelector('svg'), entradaDe, dic, (chave) => abrir(chave));
    legenda();
  }

  /* Legenda das faixas: uma régua de tons para cada candidato que lidera em
     algum território à mostra — estados e, onde estão desenhados, municípios.
     Na ordem do placar nacional, para não trocar de lugar a cada boletim. */
  function legenda() {
    const lideres = new Map();
    const anotar = (e, dic) => {
      const t = e && e.vv ? APU.ranking(e, dic)[0] : null;
      if (t && !lideres.has(t.chave)) lideres.set(t.chave, t);
    };
    const dic = dicionario();
    Object.values((estado.uf && estado.uf.abr) || {}).forEach((e) => anotar(e, dic));
    ufsDesenhadas().forEach((uf) => {
      const d = dicionarioMun(uf);
      Object.values(estado.porIbge[uf] || {}).forEach((e) => anotar(e, d));
    });
    const nacional = entradaNacional();
    const ordem = nacional ? APU.ranking(nacional, dic).map((c) => c.chave) : [];
    const lista = Array.from(lideres.values())
      .sort((a, b) => (ordem.indexOf(a.chave) + 1 || 99) - (ordem.indexOf(b.chave) + 1 || 99))
      .slice(0, 4)
      .map((c) => ({ nome: c.urna || c.nome, cor: APU.cor(c.partido) }));
    APUUI.legendaFaixas('legendaFaixas', lista);
  }

  /* O Brasil, qualquer que seja o recorte aberto no mapa: é o que a projeção
     projeta. Arquivo br quando existe; senão a soma das UFs. */
  function entradaNacional() {
    if (estado.br && estado.br.abr && estado.br.abr.br) return estado.br.abr.br;
    const entradas = estado.uf ? Object.values(estado.uf.abr) : [];
    return entradas.length ? APU.agregar(entradas) : null;
  }

  /* O feature-state fica guardado na fonte e vale para o tile quando ele
     chegar: pintar não espera a malha. */
  function pintarMun(uf) {
    const indice = estado.porIbge[uf];
    if (!indice || !mapa.ufs.length) return;
    const dic = dicionarioMun(uf);
    Object.entries(indice).forEach(([id, e]) => {
      const t = APUUI.tinta(e, dic);
      mapa.gl.setFeatureState(noMun(Number(id)), { cor: t ? t.cor : null, op: t ? t.op : 1 });
    });
    legenda();
  }

  /* ------------------------------------------------------ cursor e clique */

  /* A camada de cima que está à mostra: o município desenhado, senão o estado.
     Município fora das UFs desenhadas também está no tile, só que
     transparente, e não responde. */
  function alvoEm(ponto) {
    return mapa.gl.queryRenderedFeatures(ponto, { layers: ['mun-fill', 'uf-fill'] })
      .find((f) => f.sourceLayer === 'estados' || mapa.desenhadas.has(f.properties.uf)) || null;
  }

  function balaoDe(f) {
    const apurado = (e) => (e && e.vv ? APU.fmt.pct(e.pst || 0) + ' apurado' : 'Sem apuração');
    const uf = f.properties.uf;
    if (f.sourceLayer === 'estados') {
      const e = (estado.uf && estado.uf.abr && estado.uf.abr[uf]) || null;
      return APUUI.conteudoDoBalao(APU.UF_NOMES[uf] || uf, apurado(e), e, dicionario());
    }
    const e = (estado.porIbge[uf] || {})[f.id] || null;
    return APUUI.conteudoDoBalao(f.properties.nm || 'Município',
      `${APU.UF_NOMES[uf]} · ${apurado(e)}`, e, dicionarioMun(uf));
  }

  function realcar(f) {
    const novo = f ? { source: 'malha', sourceLayer: f.sourceLayer, id: f.id } : null;
    const h = mapa.hover;
    if (h && novo && h.sourceLayer === novo.sourceLayer && h.id === novo.id) return;
    if (h) mapa.gl.setFeatureState(h, { hover: false });
    if (novo) mapa.gl.setFeatureState(novo, { hover: true });
    mapa.hover = novo;
  }

  function ligarEventos() {
    const gl = mapa.gl;
    const tip = APUUI.balao();

    gl.on('mousemove', (e) => {
      /* O globo do exterior é um marcador por cima do mapa e tem o balão dele;
         sem esta saída o mapa, que não acha nada ali, o apagaria. */
      if (e.originalEvent.target.closest('#exterior')) return;
      const f = alvoEm(e.point);
      realcar(f);
      gl.getCanvas().style.cursor = f ? 'pointer' : '';
      if (f) tip.mostrar(balaoDe(f), e.originalEvent);
      else tip.esconder();
    });
    gl.on('mouseout', () => { realcar(null); tip.esconder(); });

    gl.on('click', (e) => {
      if (e.originalEvent.target.closest('#exterior')) return;
      const f = alvoEm(e.point);
      if (!f) return;
      tip.esconder();
      if (f.sourceLayer === 'estados') abrir(f.properties.uf);
      else escolherMun(f.properties.uf, f.id, f.properties.nm);
    });
  }

  /* ------------------------------------------------------------- seleção */

  function enquadrar() {
    const uf = ufReal(estado.foco);
    mapa.gl.fitBounds(uf ? mapa.meta[uf].caixa : BRASIL,
      { padding: MOLDURA, duration: semMovimento() ? 0 : 700 });
  }

  /* Tudo o que uma troca de seleção ou de camada muda: o painel, e no mapa o
     que está à mostra, o esmaecimento, o contorno e o boletim municipal que
     ainda não foi lido. */
  function redesenhar() {
    painel();
    redesenharMapa();
  }

  function redesenharMapa() {
    if (!mapa.ufs.length) return;
    const foco = ufReal(estado.foco);
    const desenhadas = ufsDesenhadas();
    marcar(mapa.desenhadas, desenhadas, 'mostra', 'oculto');
    marcar(mapa.fora, foco ? mapa.ufs.filter((uf) => uf !== foco) : [], 'fora', 'fora');
    realcarSel();
    const faltam = desenhadas.filter((uf) => !(uf in estado.mun));
    if (faltam.length) {
      Promise.all(faltam.map(buscarMun)).then(() => {
        faltam.forEach(pintarMun);
        painel();
      });
    }
  }

  /* Clique num estado, ou no globo do exterior. */
  function abrir(sigla) {
    if (sigla === estado.foco && !estado.sel) return;
    const mudou = sigla !== estado.foco;
    estado.foco = sigla;
    estado.sel = null;
    redesenhar();
    if (mudou) enquadrar();
  }

  function escolherMun(uf, ibge, nome) {
    estado.sel = { uf, ibge, nome };
    redesenhar();
  }

  /* Um nível acima: do município ao estado, do estado ao Brasil. */
  function voltar() {
    if (estado.sel) {
      estado.sel = null;
      redesenhar();
      return;
    }
    estado.foco = null;
    redesenhar();
    enquadrar();
  }

  function trocarCamada(camada) {
    if (camada === estado.camada) return;
    estado.camada = camada;
    document.querySelectorAll('#camadas [data-camada]').forEach((b) => {
      const on = b.dataset.camada === camada;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    /* Município que deixou de estar desenhado não fica escolhido no painel. */
    if (estado.sel && !ufsDesenhadas().includes(estado.sel.uf)) estado.sel = null;
    redesenhar();
  }

  function carga(texto) {
    const el = $('mapaCarga');
    el.textContent = texto || '';
    el.hidden = !texto;
  }

  /* --------------------------------------------------------------- painel */

  /* O que o painel mostra: o município escolhido; senão o estado aberto (ou o
     exterior); senão o Brasil. */
  function abrangencia() {
    const dadosBR = estado.br;
    const dadosUF = estado.uf;

    if (estado.sel) {
      const { uf, ibge } = estado.sel;
      const nome = estado.sel.nome || 'Município';
      return {
        entrada: (estado.porIbge[uf] || {})[ibge] || null,
        dic: dicionarioMun(uf),
        sub: `${nome} — ${APU.UF_NOMES[uf]}`,
        rotulo: 'Resultado em ' + nome
      };
    }

    if (estado.foco) {
      const nome = APU.UF_NOMES[estado.foco] || estado.foco.toUpperCase();
      return {
        entrada: (dadosUF && dadosUF.abr && dadosUF.abr[estado.foco]) || null,
        dic: dicionario(),
        sub: nome,
        rotulo: estado.foco === APU.EXTERIOR ? 'Resultado no exterior' : 'Resultado em ' + nome
      };
    }

    const entradasUF = dadosUF ? Object.values(dadosUF.abr) : [];
    return {
      /* Nacional: usa o arquivo br quando existe; senão soma as UFs. */
      entrada: (dadosBR && dadosBR.abr && dadosBR.abr.br)
        || (entradasUF.length ? APU.agregar(entradasUF) : null),
      dic: dicionario(),
      sub: dadosBR ? 'Brasil'
        : (dadosUF ? 'Brasil — soma das unidades federativas' : 'Brasil — candidaturas registradas'),
      rotulo: 'Resultado nacional'
    };
  }

  function painel() {
    const meta = (estado.br && estado.br.meta) || (estado.uf && estado.uf.meta);
    const { entrada, dic, sub, rotulo } = abrangencia();
    const lista = entrada ? APU.ranking(entrada, dic) : [];

    $('subtitulo').textContent = sub;
    $('rotuloPlacar').textContent = lista.length ? rotulo : 'Candidaturas';

    const voltarEl = $('voltar');
    voltarEl.hidden = !(estado.sel || estado.foco);
    voltarEl.textContent = estado.sel && ufReal(estado.foco) ? 'Voltar ao estado' : 'Voltar ao Brasil';

    const foco = ufReal(estado.foco);
    const link = $('linkUF');
    link.hidden = !foco;
    if (foco) {
      link.href = `apuracao-uf.html?uf=${foco}${sufixoParams()}`;
      link.textContent = 'Abrir a página do estado';
    }

    APUUI.selo(meta, entrada);
    APUUI.progresso(entrada);
    APUUI.avisos(entrada, 'avisos');
    /* Um botão só para os dois blocos: a participação segue a abertura do
       placar, e o redesenho dela é o que o `aoAlternar` do botão dispara. */
    const verParticipacao = () =>
      APUUI.participacao(entrada, 'participacao', { seguir: 'placar' });
    APUUI.placar(lista.length ? lista : APU.rankingZerado(estado.chapa), 'placar',
      { entrada, cargo: APU.cfg.cargo, botao: 'maisResultado', aoAlternar: verParticipacao });
    verParticipacao();
    /* A projeção é nacional e tem painel próprio: continua à mostra com um
       estado aberto no mapa. */
    projecao(entradaNacional());

    $('mapaNota').textContent = nota();
  }

  /* ------------------------------------------------------------ projeção */

  /* Abre ou fecha a coluna da projeção, à esquerda do mapa. O mapa muda de
     largura junto, e o MapLibre só redesenha no tamanho novo se for avisado. */
  function mostrarPainelProj(sim) {
    const painel = $('painelProj');
    if (painel.hidden === !sim) return;
    painel.hidden = !sim;
    painel.closest('.apu-stage').classList.toggle('com-proj', sim);
    if (mapa.gl) requestAnimationFrame(() => mapa.gl.resize());
  }

  const pct1 = (v) => (100 * v).toFixed(1).replace('.', ',');

  /* A projeção do resultado final, na visão do Brasil. Não aparece antes da
     primeira urna, nem depois que o TSE declara o resultado — aí ela não tem
     mais nada a dizer. Abaixo do mínimo de urnas o bloco diz por que ainda não
     há número, em vez de sumir.

     A ordem é a das perguntas da noite: a eleição acaba no 1º turno ou vai ao
     2º, e com quem; quem termina em primeiro; e, por último, os votos. */
  function projecao(nacional) {
    const pr = estado.proj;
    const decidido = !!(nacional && (APU.definicao(nacional) || nacional.tf === 's'));
    $('projecao').hidden = !nacional || !(nacional.st > 0) || decidido;
    mostrarPainelProj(!$('projecao').hidden);
    if ($('projecao').hidden) return;

    const pronta = !!(pr && pr.suficiente && pr.cand);
    ['projLegenda', 'projSubVotos', 'projChances', 'projDesfecho'].forEach((id) => {
      $(id).hidden = !pronta;
    });
    if (!pronta) {
      $('projQuando').textContent = '';
      $('projFrase').innerHTML = 'A projeção aparece a partir de 5% das urnas apuradas, '
        + 'com votos de pelo menos 15 estados.<small>Antes disso, qualquer número seria chute.</small>';
      $('projLista').innerHTML = '';
      return;
    }

    const dic = dicionario();
    const esc = APUUI.esc;
    const nome = (id) => (id === 'outros' ? 'Outros'
      : APU.nomeProprio((dic[id] && (dic[id].urna || dic[id].nome)) || id));
    const sigla = (id) => (id === 'outros' ? '' : ((dic[id] && dic[id].partido) || ''));
    const cor = (id) => (id === 'outros' ? 'var(--muted)' : APU.cor(sigla(id)));
    const cands = Object.entries(pr.cand).map(([id, c]) => ({ id, ...c }))
      .sort((a, b) => (a.id === 'outros') - (b.id === 'outros') || b.media - a.media);
    const reais = cands.filter((c) => c.id !== 'outros');
    const lider = reais[0];
    const d = pr.desfecho || {};
    const segundoTurno = reais.length === 2;
    $('projQuando').textContent = `com ${APU.fmt.pct(pr.pct_apurado)} das urnas`;

    /* A pergunta de cima: termina no 1º turno ou vai ao 2º. */
    if (segundoTurno) {
      $('projFrase').innerHTML = `Projeção indica vitória de ${esc(nome(lider.id))}`
        + `<small>${APUUI.chance(lider.p_maioria)}</small>`;
      $('projDesfecho').hidden = true;
    } else {
      const p1 = d.p_decidido || 0;
      const vence = reais.filter((c) => (c.p_maioria || 0) >= 0.01);
      $('projFrase').innerHTML = p1 >= 0.5
        ? `Projeção indica vitória de ${esc(nome(lider.id))} no 1º turno<small>${APUUI.chance(lider.p_maioria)}</small>`
        : `Projeção indica 2º turno<small>${APUUI.chance(1 - p1)}</small>`;
      const par = (d.segundo_turno || [])[0];
      /* As duas partes somam 100: arredondadas em separado, 93,5 e 6,5 dariam
         94% e 7%. */
      const r2 = Math.round(100 * (1 - p1));
      const [t2, t1] = (1 - p1) > 0.99 ? ['>99%', '<1%'] : (1 - p1) < 0.01 ? ['<1%', '>99%']
        : [`${r2}%`, `${100 - r2}%`];
      $('projDesfecho').innerHTML = `
        <div class="apu-proj-split" role="img"
          aria-label="Vai ao 2º turno ${APUUI.chance(1 - p1)}; termina no 1º turno ${APUUI.chance(p1)}">
          <span class="is-2t" style="width:${(100 * (1 - p1)).toFixed(1)}%"></span>
          <span class="is-1t" style="width:${(100 * p1).toFixed(1)}%"></span>
        </div>
        <div class="apu-proj-split-rot">
          <span><b>${t2}</b> vai ao 2º turno</span>
          <span><b>${t1}</b> termina no 1º turno</span>
        </div>`
        + (par ? `<p class="apu-proj-par">2º turno mais provável:
          <b>${esc(nome(par.par[0]))} × ${esc(nome(par.par[1]))}</b>
          <span>${APUUI.chancePct(par.p)}</span></p>` : '')
        /* Com um só candidato capaz de vencer no 1º turno, a chance dele e a da
           barra são o mesmo número, e têm de sair iguais depois de arredondar. */
        + (vence.length ? `<p class="apu-proj-par">Vitória no 1º turno: ${vence.map((c) =>
          `<b>${esc(nome(c.id))}</b> <span>${vence.length === 1 ? t1 : APUUI.chancePct(c.p_maioria)}</span>`
        ).join(', ')}</p>` : '');
    }

    /* Chances por candidato. Só entra quem tem ao menos 1% em alguma coluna, ou
       os três primeiros; os demais viram uma linha só. */
    const colunas = segundoTurno
      ? [['p_maioria', 'Vence']]
      : [['p_primeiro', 'Mais votado'], ['p_segundo_turno', 'Vai ao 2º turno']];
    const mostrar = reais.filter((c, i) => i < 3 || colunas.some(([k]) => (c[k] || 0) >= 0.01));
    const resto = reais.length - mostrar.length;
    const celula = (c, k) => `<td class="num"><span class="apu-proj-medidor" aria-hidden="true">`
      + `<span style="width:${(100 * (c[k] || 0)).toFixed(1)}%;background:${cor(c.id)}"></span></span>`
      + `${APUUI.chancePct(c[k] || 0)}</td>`;
    $('projChances').innerHTML = `<thead><tr><th scope="col">Chance de</th>`
      + colunas.map(([, rot]) => `<th scope="col" class="num">${rot}</th>`).join('') + '</tr></thead>'
      + '<tbody>' + mostrar.map((c) => `<tr><th scope="row">${esc(nome(c.id))}<small>${esc(sigla(c.id))}</small></th>`
        + colunas.map(([k]) => celula(c, k)).join('') + '</tr>').join('')
      + (resto > 0 ? `<tr class="is-resto"><th scope="row">Demais ${resto} candidatos</th>`
        + colunas.map(() => '<td class="num">&lt;1%</td>').join('') + '</tr>' : '')
      + '</tbody>';

    /* Escala comum a todas as linhas, enquadrando so o trecho que importa: numa
       disputa de dois colados em 50%, a partir do zero a faixa e a distancia
       entre o apurado e a projecao virariam poucos pixels. Com candidato
       pequeno na lista, o trecho ja comeca perto do zero. */
    const ext = cands.flatMap((c) => [c.p025, c.p975, c.apurado]);
    let lo = Math.min(...ext);
    let hi = Math.max(...ext);
    const folga = (hi - lo) * 0.15 + 0.005;
    lo = Math.max(0, lo - folga);
    hi = Math.min(1, hi + folga);
    const x = (v) => `${((100 * (v - lo)) / (hi - lo)).toFixed(2)}%`;
    $('projLista').innerHTML = cands.map((c) => `<div class="apu-proj-linha">
        <span class="apu-proj-nome">${esc(nome(c.id))}<small>${esc(sigla(c.id))}</small></span>
        <span class="apu-proj-trilho" aria-hidden="true">
          <span class="apu-proj-faixa" style="left:${x(c.p025)};width:calc(${x(c.p975)} - ${x(c.p025)});background:${cor(c.id)}"></span>
          <span class="apu-proj-apurado" style="left:${x(c.apurado)}"></span>
          <span class="apu-proj-ponto" style="left:${x(c.media)};background:${cor(c.id)}"></span>
        </span>
        <span class="apu-proj-num"><b>${pct1(c.media)}%</b><small>${pct1(c.p025)} a ${pct1(c.p975)}</small></span>
      </div>`).join('');
  }

  /* Quantas unidades — ou municípios, com eles desenhados — já têm voto. */
  function nota() {
    const desenhadas = ufsDesenhadas();
    if (desenhadas.length) {
      const lidas = desenhadas.filter((uf) => estado.mun[uf]);
      if (!lidas.length) return 'aguardando o primeiro boletim municipal';
      const comVotos = lidas.reduce((n, uf) =>
        n + Object.values(estado.porIbge[uf]).filter((e) => e.vv > 0).length, 0);
      const total = desenhadas.reduce((n, uf) => n + mapa.meta[uf].mun.length, 0);
      return `${APU.fmt.int(comVotos)} de ${APU.fmt.int(total)} municípios com votos`;
    }
    if (!estado.uf) return 'aguardando o primeiro boletim';
    /* `abr` alimenta o agregado nacional e precisa do exterior; a contagem de
       unidades, não — o exterior não é unidade da Federação. */
    const unidades = Object.entries(estado.uf.abr)
      .filter(([sigla]) => sigla !== APU.EXTERIOR)
      .map(([, e]) => e);
    const comApuracao = unidades.filter((e) => e && e.vv > 0);
    return `${comApuracao.length} de ${unidades.length} unidades com votos`;
  }

  /* ------------------------------------------------------------- desenho */

  function pintar() {
    const temAlgo = !!(estado.br || estado.uf);

    /* Sem boletim, a página não fica vazia: mostra a chapa registrada no
       DivulgaCandContas com zero voto. É o estado normal da página até a
       primeira urna fechar. */
    $('semDados').hidden = temAlgo || !!estado.chapa;
    $('painel').hidden = !temAlgo && !estado.chapa;
    $('estados').hidden = !estado.uf;

    if (!temAlgo && !estado.chapa) {
      APUUI.selo(null, null);
      APUUI.progresso(null);
      APUUI.avisos(null, 'avisos');
      $('semDadosTexto').textContent =
        'A lista de candidaturas ainda não foi importada. Rode scripts/apuracao/candidatos.py.';
      return;
    }

    $('tituloCargo').textContent = nomeDoCargo();
    painel();
    pintarUFs();
    if (estado.uf) tabela(estado.uf, dicionario());
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
        <td class="num">${APU.fmt.pct(entrada.pst || 0)}</td>
      </tr>`;
    }).join('');
  }

  /* --------------------------------------------------------------- ciclo */

  async function buscarMun(uf) {
    const s = await APU.snapshot(uf);
    if (!s) {
      /* Marca o pedido: a próxima tentativa fica com a cadência municipal, e
         não com cada clique. */
      if (!(uf in estado.mun)) estado.mun[uf] = null;
      return;
    }
    const indice = {};
    Object.entries(s.mun || {}).forEach(([cd, m]) => {
      if (m && m.ibge && s.abr[cd]) indice[Number(m.ibge)] = s.abr[cd];
    });
    estado.mun[uf] = s;
    estado.porIbge[uf] = indice;
  }

  async function atualizar() {
    if (estado.chapa === null) {
      estado.chapa = await APU.candidaturas();
      await APU.fotosDisponiveis();
    }
    /* A camada municipal é republicada bem mais devagar que a alta (~4 min no
       plantão): relê-la a cada volta seria pedir o mesmo arquivo. */
    const municipal = estado.volta++ % 4 === 0 ? ufsDesenhadas() : [];
    const [br, uf, proj] = await Promise.all([
      APU.snapshot('br'), APU.snapshot('uf'), APU.snapshot('proj'), ...municipal.map(buscarMun)
    ]);
    /* Não apaga o que já está na tela se uma volta falhar: um boletim antigo
       vale mais que um painel vazio. */
    if (br) estado.br = br;
    if (uf) estado.uf = uf;
    if (proj) estado.proj = proj;
    pintar();
    municipal.forEach(pintarMun);
  }

  function agendar() {
    clearTimeout(estado.timer);
    /* Aba oculta não precisa de boletim: retoma na volta do foco. */
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
    if (document.visibilityState === 'visible') { atualizar().catch(() => {}).then(agendar); }
    else clearTimeout(estado.timer);
  });

  (async function iniciar() {
    document.title = `${nomeDoCargo()} — Apuração ao vivo — ElectoMaps`;
    APUUI.ligarMenu('0001');

    $('voltar').onclick = voltar;
    $('camadas').onclick = (ev) => {
      const b = ev.target.closest('[data-camada]');
      if (b) trocarCamada(b.dataset.camada);
    };

    /* O mapa não segura o resto da página: sem WebGL, ou com o MapLibre fora do
       ar, o placar e a tabela seguem funcionando. */
    try {
      criarMapa()
        .then(() => {
          /* Disparado por js/apuracao-tema.js quando o leitor troca o tema. */
          window.addEventListener('apu-tema', aplicarTema);
          pintarUFs();
          /* Camada ou estado escolhidos antes de o mapa ficar pronto. */
          redesenharMapa();
          ufsDesenhadas().forEach(pintarMun);
        })
        .catch((e) => {
          console.warn('[apuracao] mapa indisponível', e);
          carga('Mapa indisponível');
        });
    } catch (e) {
      console.warn('[apuracao] mapa indisponível', e);
      carga('Mapa indisponível');
    }

    try {
      await atualizar();
    } catch (e) {
      console.warn('[apuracao] primeira carga falhou', e);
    }
    agendar();
  })();
})();
