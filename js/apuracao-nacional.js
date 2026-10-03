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
    sel: null,
    /* 'resultado' pinta o líder; 'variacao' deixa o mapa neutro e desenha a
       seta de cada unidade contra 2022 (comparação, abaixo). */
    modo: 'resultado',
    /* Base do 1º turno de 2022 (scripts/apuracao/comparacao_2022.py). */
    base2022: null,
    /* Como o 1º turno de 2022 estava a cada 0,5% das seções apuradas, no Brasil
       e em cada UF (scripts/apuracao/sequencia_2022.py --curva), e contra qual
       2022 a comparação mede: 'final' ou 'ponto' (o mesmo % apurado de agora). */
    curva2022: null,
    compModo: 'final',
    /* Acompanhamento do TSE (EA14): onde ainda se está contando. */
    ab: null,
    /* Cidades com mapa por zona eleitoral (APUUI.cidadesComZonas): clicada uma
       delas no mapa, o painel leva à página das zonas. */
    zonas: []
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
      /* Margem em círculos (pintarMargens): um ponto por unidade, no mesmo
         lugar de onde saem as setas, com a área proporcional à vantagem em
         votos de quem lidera. O raio dobra a cada nível de zoom, como o mapa:
         o círculo cobre sempre o mesmo pedaço do território. Os grandes
         embaixo (circle-sort-key), para o pequeno não sumir sob eles. */
      gl.addSource('margens', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      gl.addLayer({ id: 'margens', type: 'circle', source: 'margens',
        layout: { 'circle-sort-key': ['-', 0, ['get', 'm']], visibility: 'none' },
        paint: {
          /* O zoom só pode entrar no interpolate de cima: o raio é a raiz da
             margem vezes um fator que dobra a cada nível. */
          'circle-radius': ['interpolate', ['exponential', 2], ['zoom'],
            2, ['*', ['sqrt', ['get', 'm']], MARGEM_K / 4],
            12, ['*', ['sqrt', ['get', 'm']], MARGEM_K * 256]],
          'circle-color': ['get', 'cor'], 'circle-opacity': 0.32,
          'circle-stroke-color': ['get', 'cor'], 'circle-stroke-width': 1, 'circle-stroke-opacity': 0.95
        } });
      /* Setas da variação desde 2022, por cima de tudo (pintarSetas). */
      gl.addSource('setas', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      /* A de município encolhe com o país inteiro à vista e cresce ao aproximar,
         como no NYT: no tamanho cheio, 5.570 setas no zoom do Brasil viram uma
         mancha. A de estado fica do mesmo tamanho. */
      const porNivel = (s) => ['case', ['==', ['get', 'nivel'], 'uf'], 1, s];
      gl.addLayer({ id: 'setas', type: 'symbol', source: 'setas',
        layout: { 'icon-image': ['get', 'img'], 'icon-anchor': ['get', 'ancora'],
          'icon-offset': ['get', 'desloc'],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 3, porNivel(0.5), 5, porNivel(0.7), 7, porNivel(0.9), 9, 1],
          'icon-allow-overlap': true, 'icon-ignore-placement': true, visibility: 'none' },
        /* Um pouco transparentes, como no NYT: onde muitas se cruzam, a cor
           adensa e mostra a tendência da região. */
        paint: { 'icon-opacity': 0.82 } });

      ligarEventos();
      ligarExterior();
    });
  }

  function ligarExterior() {
    const el = $('exterior');
    new maplibregl.Marker({ element: el }).setLngLat(EXTERIOR_EM).addTo(mapa.gl);
    el.hidden = false;
  }

  /* Na variação desde 2022 o mapa fica neutro, sem a margem do líder no tom: o
     que se lê são as setas. A malha continua, para situar cada uma. */
  const OPACIDADE_UF_NEUTRA = ['*', liga('hover', 0.72, 1), liga('oculto', 0, 1), liga('fora', 0.35, 1)];
  const OPACIDADE_MUN_NEUTRA = ['*', liga('hover', 0.72, 1), liga('mostra', 1, 0), liga('fora', 0.35, 1)];

  function aplicarTema() {
    const gl = mapa.gl;
    const c = cores();
    const neutro = estado.modo === 'variacao' || estado.modo === 'margem';
    gl.setPaintProperty('fundo', 'background-color', c.fundo);
    gl.setPaintProperty('uf-fill', 'fill-color', neutro ? c.vazio : corDe(c));
    gl.setPaintProperty('mun-fill', 'fill-color', neutro ? c.vazio : corDe(c));
    gl.setPaintProperty('uf-fill', 'fill-opacity', neutro ? OPACIDADE_UF_NEUTRA : OPACIDADE_UF);
    gl.setPaintProperty('mun-fill', 'fill-opacity', neutro ? OPACIDADE_MUN_NEUTRA : OPACIDADE_MUN);
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
    pintarSetas();
    pintarMargens();
  }

  /* Legenda das faixas: uma régua de tons para cada candidato que lidera em
     algum território à mostra — estados e, onde estão desenhados, municípios.
     Na ordem do placar nacional, para não trocar de lugar a cada boletim. */
  function legenda() {
    legendaSetas();
    if (estado.modo !== 'margem') APUUI.legendaMargem('legendaMargem', null);
    if (!$('legendaSetas').hidden || estado.modo === 'margem') {
      $('legendaFaixas').hidden = true;
      return;
    }
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
    pintarSetas();
    pintarMargens();
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
    /* Com a variação ligada, o balão compara com 2022 em vez de dar o placar. */
    const variacao = estado.modo === 'variacao' && comparavel();
    const uf = f.properties.uf;
    if (f.sourceLayer === 'estados') {
      const e = (estado.uf && estado.uf.abr && estado.uf.abr[uf]) || null;
      const nome = APU.UF_NOMES[uf] || uf;
      return variacao ? balaoComparacao(nome, apurado(e), e, dicionario(), linha2022(uf, null))
        : APUUI.conteudoDoBalao(nome, apurado(e), e, dicionario());
    }
    const e = (estado.porIbge[uf] || {})[f.id] || null;
    const nome = f.properties.nm || 'Município';
    const sub = `${APU.UF_NOMES[uf]} · ${apurado(e)}`;
    return variacao ? balaoComparacao(nome, sub, e, dicionarioMun(uf), linha2022(null, f.id))
      : APUUI.conteudoDoBalao(nome, sub, e, dicionarioMun(uf));
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
    pintarSetas();
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

  /* --------------------------------------------------- comparação com 2022 */

  /* 2026 contra o 1º turno de 2022, pelo mesmo número de urna: Lula (13) com
     Lula, Flávio Bolsonaro (22) com Jair. A base tem o 1º turno por município,
     UF e Brasil, e o ponto de onde sai a seta de cada unidade
     (scripts/apuracao/comparacao_2022.py). Só presidente e só 1º turno: contra
     o 2º turno de 2026 a conta seria outra. */
  const BASE_2022 = 'resultados_geo/comparacao/presidente_2022_t1.json';
  const CURVA_2022 = 'resultados_geo/comparacao/presidente_2022_t1_curva.json';
  const NOME_2022 = { 13: 'Lula', 22: 'Jair Bolsonaro' };
  const pontos = (x) => Math.abs(x).toLocaleString('pt-BR',
    { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  function comparavel() {
    const meta = (estado.br && estado.br.meta) || (estado.uf && estado.uf.meta) || {};
    return APU.cfg.cargo === '0001' && !!estado.base2022 && meta.t !== '2';
  }

  /* A linha de 2022 de uma unidade: o município (IBGE), a UF (ou o exterior) ou
     o Brasil. */
  function linha2022(uf, ibge) {
    const b = estado.base2022;
    if (ibge != null) return b.mun[String(ibge)] || null;
    return uf ? (b.uf[uf] || null) : b.br;
  }

  /* 2022 no mesmo ponto da apuração: o acumulado da curva em `pst` % das
     seções daquela unidade (o Brasil ou uma UF), interpolado entre os pontos de
     0,5% em 0,5%. Município não tem curva: null. */
  function linhaNoPonto(uf, pst) {
    const c = estado.curva2022;
    const serie = c && (uf ? c.uf[uf] : c.br);
    if (!serie) return null;
    const f = Math.max(0, Math.min(100, Number(pst) || 0)) / c.passo;
    const i = Math.min(serie.length - 1, Math.floor(f));
    const j = Math.min(serie.length - 1, i + 1);
    const t = f - i;
    return serie[i].map((v, k) => v + (serie[j][k] - v) * t);
  }

  /* O Brasil no mesmo ponto: a soma de cada UF de 2022 no % apurado que ESSA
     UF tem agora. O ritmo da apuração muda de uma eleição para outra (um estado
     que em 2022 já tinha fechado pode estar no meio agora), e a curva nacional
     de 2022 juntaria estados em proporções que não são as de agora. Sem o
     andamento das UFs (antes do arquivo de UF), cai na curva nacional. */
  function brasilNoPonto(pstBrasil) {
    const c = estado.curva2022;
    const abr = estado.uf && estado.uf.abr;
    if (!c || !abr || !Object.keys(abr).length) return linhaNoPonto(null, pstBrasil);
    const soma = [0, 0, 0];
    Object.keys(c.uf).forEach((uf) => {
      const e = abr[uf];
      const l = linhaNoPonto(uf, e ? e.pst : 0);
      if (l) l.forEach((v, k) => { soma[k] += v; });
    });
    return soma;
  }

  /* Nome e partido de um dos dois números: do placar, se ele já tem voto; senão
     do dicionário ou da chapa registrada; e o de 2022, em último caso. */
  function candidatoDe(par, dic) {
    if (par.c) return { nome: par.c.urna || par.c.nome, partido: par.c.partido };
    const d = Object.values(dic || {}).find((x) => String(x.numero) === par.numero)
      || Object.values(estado.chapa || {}).find((x) => String(x.numero) === par.numero);
    return d ? { nome: APU.nomeProprio(d.urna || d.nome), partido: d.partido }
      : { nome: NOME_2022[par.numero] || par.numero, partido: '' };
  }

  /* O que a lateral e o balão dizem de uma comparação: as duas linhas e a
     frase da diferença, com a cor e o lado da seta. */
  function resumoDe(comp, dic, quando) {
    const quem = comp.pares.map((p) => ({ ...p, ...candidatoDe(p, dic) }));
    const [a, b] = quem;
    const linhas = quem.map((p) => ({
      nome: p.nome, cor: APU.cor(p.partido),
      antes2022: NOME_2022[p.numero] !== p.nome ? NOME_2022[p.numero] : '',
      antes: APU.fmt.pct(p.antes),
      agora: p.agora === null ? '—' : APU.fmt.pct(p.agora),
      varia: p.agora === null ? '' : (p.agora - p.antes >= 0 ? '+' : '−') + pontos(p.agora - p.antes)
    }));
    const lider = (m, x, y) => `${m >= 0 ? x : y} +${pontos(m)}`;
    const m22 = a.antes - b.antes;
    const d = comp.desvio;
    let frase;
    if (d === null) frase = 'A variação aparece com o primeiro boletim daqui.';
    else if (Math.abs(d) < 0.05) frase = 'A diferença entre os dois está igual à de 2022.';
    else {
      frase = `A diferença andou ${pontos(d)} ${Math.abs(d) >= 1.95 ? 'pontos' : 'ponto'} para `
        + `${d > 0 ? b.nome : a.nome} desde 2022: ${lider(m22, a.nome, NOME_2022[b.numero])} ${quando || 'em 2022'}, `
        + `${lider(a.agora - b.agora, a.nome, b.nome)} agora.`;
    }
    return { linhas, frase, desvio: d, lado: d === null ? null : (d > 0 ? linhas[1] : linhas[0]) };
  }

  /* Seta do estilo NYT, em SVG, para a lateral e a legenda: 30° acima da
     horizontal, para a direita (2º número) ou para a esquerda (1º). */
  /* Geometria da seta, a mesma no mapa e no SVG, como a do NYT: 35° acima da
     horizontal, traço de 3 px e ponta de 9 px. O rabo fica no canto de baixo —
     é ele que encosta no ponto da unidade. */
  const SETA_ANG = (35 * Math.PI) / 180;

  function geometriaSeta(comprimento, direita) {
    const cab = 9;
    const meia = 5;
    const folga = 3;
    const w = Math.ceil(comprimento * Math.cos(SETA_ANG) + meia + 2 * folga);
    const h = Math.ceil(comprimento * Math.sin(SETA_ANG) + meia + 2 * folga);
    const ux = Math.cos(SETA_ANG) * (direita ? 1 : -1);
    const uy = -Math.sin(SETA_ANG);
    const x0 = direita ? folga : w - folga;
    const y0 = h - folga;
    const x1 = x0 + ux * comprimento;
    const y1 = y0 + uy * comprimento;
    const bx = x1 - ux * cab;
    const by = y1 - uy * cab;
    return { w, h, rabo: [x0, y0], base: [bx, by],
      ponta: [[x1, y1], [bx - uy * meia, by + ux * meia], [bx + uy * meia, by - ux * meia]] };
  }

  function setaSVG(cor, direita, comprimento) {
    const g = geometriaSeta(comprimento || 26, direita);
    const n = (v) => v.toFixed(1);
    return `<svg class="apu-comp-seta" width="${g.w}" height="${g.h}" viewBox="0 0 ${g.w} ${g.h}" aria-hidden="true">`
      + `<line x1="${n(g.rabo[0])}" y1="${n(g.rabo[1])}" x2="${n(g.base[0])}" y2="${n(g.base[1])}"`
      + ` stroke="${cor}" stroke-width="3" stroke-linecap="round"/>`
      + `<path d="M${g.ponta.map((p) => p.map(n).join(' ')).join('L')}Z" fill="${cor}"/></svg>`;
  }

  /* O bloco da lateral, no recorte aberto. */
  function comparacao(entrada, dic) {
    const sec = $('comparacao');
    sec.hidden = !comparavel();
    /* Resultado e Margem existem sempre; a Variação, só com 2022 para comparar. */
    $('modoMapa').querySelector('[data-modo="variacao"]').hidden = sec.hidden;
    if (sec.hidden && estado.modo === 'variacao') trocarModo('resultado');
    if (sec.hidden) return;
    /* Contra o resultado final de 2022 ou contra 2022 no mesmo ponto da
       apuração (o % apurado do recorte agora). O ponto só existe para o Brasil e
       para as UFs: com um município aberto, a comparação é com o final. */
    const temPonto = !estado.sel && !!linhaNoPonto(estado.foco, 0);
    const noPonto = temPonto && estado.compModo === 'ponto';
    const pst = entrada ? Number(entrada.pst) || 0 : 0;
    const botoes = temPonto
      ? '<div class="apu-levels apu-comp-modo" role="group" aria-label="Comparar com qual 2022">'
        + [['final', 'Resultado final'], ['ponto', 'Mesmo % apurado']].map(([m, rot]) =>
          `<button class="apu-level${estado.compModo === m ? ' is-on' : ''}" type="button" data-comp="${m}"`
          + ` aria-pressed="${estado.compModo === m}">${rot}</button>`).join('') + '</div>'
      : '';
    const linha = noPonto ? (estado.foco ? linhaNoPonto(estado.foco, pst) : brasilNoPonto(pst))
      : (estado.sel ? linha2022(null, estado.sel.ibge) : linha2022(estado.foco, null));
    const comp = APU.comparar(entrada, dic, linha, estado.base2022.numeros);
    if (!comp) {
      $('comparacaoCorpo').innerHTML = botoes + '<p class="apu-progress-lab">' + (noPonto
        ? 'A comparação no mesmo ponto aparece com o primeiro boletim.'
        : 'Sem 2022 para comparar: o município foi instalado depois da eleição.') + '</p>';
      return;
    }
    /* No Brasil, o ponto é o de cada estado (brasilNoPonto): a frase diz isso. */
    const quando = !noPonto ? 'em 2022'
      : (estado.foco ? `em 2022 com ${APU.fmt.pct(pst)} apurado` : 'em 2022 com cada estado no ponto de agora');
    const r = resumoDe(comp, dic, quando);
    $('comparacaoCorpo').innerHTML = botoes + '<table class="apu-proj-tab apu-comp-tab"><thead><tr>'
      + '<th scope="col"></th><th scope="col" class="num">'
      + (noPonto ? `2022 <small>${estado.foco ? APU.fmt.pct(pst) : 'mesmo ponto'}</small>` : '2022') + '</th>'
      + '<th scope="col" class="num">2026</th>'
      + '<th scope="col" class="num">Var.</th></tr></thead><tbody>'
      + r.linhas.map((l) => `<tr><th scope="row"><span class="apu-swatch" style="background:${l.cor}"></span>`
        + `${APUUI.esc(l.nome)}${l.antes2022 ? `<small>2022: ${APUUI.esc(l.antes2022)}</small>` : ''}</th>`
        + `<td class="num">${l.antes}</td><td class="num">${l.agora}</td>`
        + `<td class="num">${l.varia || '—'}</td></tr>`).join('')
      + '</tbody></table>'
      + `<p class="apu-comp-frase">${r.lado ? setaSVG(r.lado.cor, r.desvio > 0) : ''}`
      + `<span>${APUUI.esc(r.frase)}</span></p>`;
  }

  /* Balão de uma unidade no mapa, com a variação ligada. */
  function balaoComparacao(nome, sub, entrada, dic, linha) {
    const comp = APU.comparar(entrada, dic, linha, estado.base2022.numeros);
    if (!comp) {
      return `<div class="nyt-tooltip-container"><div class="district-nyt-title">${APUUI.esc(nome)}</div>`
        + `<div class="district-nyt-sub">${APUUI.esc(sub)}</div><div class="district-nyt-nota">`
        + 'Sem 2022 para comparar.</div></div>';
    }
    const r = resumoDe(comp, dic);
    return `<div class="nyt-tooltip-container"><div class="district-nyt-title">${APUUI.esc(nome)}</div>`
      + `<div class="district-nyt-sub">${APUUI.esc(sub)}</div>`
      + '<table class="district-nyt-table"><thead><tr><th></th><th>2022</th><th>Agora</th></tr></thead><tbody>'
      + r.linhas.map((l) => `<tr><td><span class="apu-swatch" style="background:${l.cor};margin-right:6px"></span>`
        + `${APUUI.esc(l.nome)}</td><td class="votes-cell">${l.antes}</td>`
        + `<td class="pct-cell">${l.agora}</td></tr>`).join('')
      + `</tbody></table><div class="district-nyt-nota">${APUUI.esc(r.frase)}</div></div>`;
  }

  /* Setas do mapa no estilo do NYT: uma por unidade à mostra, saindo do ponto
     dela para a esquerda (cor do 1º número, Lula) ou para a direita (cor do 2º,
     Flávio), mais longa quanto mais a diferença entre os dois andou desde 2022.
     As imagens são desenhadas uma vez, em faixas de comprimento, com o traço da
     mesma espessura em todas, como no original. */
  const SETA_PASSO = 2.5;   // pontos por faixa de comprimento
  const SETA_FAIXAS = 12;   // a última junta tudo acima de 27,5 pontos

  function imagemSeta(comprimento, cor, direita) {
    const r = 2;
    const g = geometriaSeta(comprimento, direita);
    const tela = document.createElement('canvas');
    tela.width = g.w * r;
    tela.height = g.h * r;
    const ctx = tela.getContext('2d');
    ctx.scale(r, r);
    ctx.strokeStyle = cor;
    ctx.fillStyle = cor;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(...g.rabo);
    ctx.lineTo(...g.base);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(...g.ponta[0]);
    ctx.lineTo(...g.ponta[1]);
    ctx.lineTo(...g.ponta[2]);
    ctx.closePath();
    ctx.fill();
    return ctx.getImageData(0, 0, tela.width, tela.height);
  }

  /* As cores são as dos partidos dos dois números em 2026; na primeira vez que
     há chapa ou boletim para saber quais são. */
  function prepararSetas(dic) {
    const gl = mapa.gl;
    if (!gl || !estado.base2022 || gl.hasImage('seta-a-1')) return;
    const [a, b] = estado.base2022.numeros.map((n) => candidatoDe({ numero: n, c: null }, dic));
    if (!a.partido || !b.partido) return;
    for (let k = 1; k <= SETA_FAIXAS; k++) {
      const comprimento = 6 + k * 4.5;
      gl.addImage(`seta-a-${k}`, imagemSeta(comprimento, APU.cor(a.partido), false), { pixelRatio: 2 });
      gl.addImage(`seta-b-${k}`, imagemSeta(comprimento, APU.cor(b.partido), true), { pixelRatio: 2 });
    }
  }

  /* Uma seta por unidade à mostra: os municípios das UFs desenhadas, ou os
     estados quando nenhum município está à mostra. Só com voto em 2026. */
  /* Uma pintura por quadro: ao chegar a camada municipal, pintarMun chama isto
     uma vez por UF, e 27 trocas seguidas de 5.570 pontos travavam a tela. E nada
     de trocar os dados da fonte se as setas são as mesmas da vez anterior: cada
     troca faz o MapLibre reprocessar todas. */
  let setasNoQuadro = 0;
  let setasAntes = '';

  function pintarSetas() {
    if (!setasNoQuadro) {
      setasNoQuadro = requestAnimationFrame(() => {
        setasNoQuadro = 0;
        desenharSetas();
      });
    }
  }

  function desenharSetas() {
    const gl = mapa.gl;
    if (!gl || !gl.getSource('setas')) return;
    const ligado = estado.modo === 'variacao' && comparavel();
    gl.setLayoutProperty('setas', 'visibility', ligado ? 'visible' : 'none');
    if (!ligado) return;
    prepararSetas(dicionario());
    const base = estado.base2022;
    const setas = [];
    const incluir = (linha, entrada, dic, nivel) => {
      const comp = linha && linha.length >= 5 ? APU.comparar(entrada, dic, linha, base.numeros) : null;
      if (!comp || comp.desvio === null || Math.abs(comp.desvio) < 0.05) return;
      const k = Math.min(SETA_FAIXAS, Math.max(1, Math.ceil(Math.abs(comp.desvio) / SETA_PASSO)));
      const direita = comp.desvio > 0;
      setas.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [linha[3], linha[4]] },
        properties: { img: `seta-${direita ? 'b' : 'a'}-${k}`, nivel,
          ancora: direita ? 'bottom-left' : 'bottom-right',
          /* O rabo fica 3 px para dentro do canto da imagem (geometriaSeta):
             o deslocamento o põe em cima do ponto da unidade. */
          desloc: direita ? [-3, 3] : [3, 3] } });
    };
    const desenhadas = ufsDesenhadas();
    if (desenhadas.length) {
      desenhadas.forEach((uf) => {
        const dic = dicionarioMun(uf);
        Object.entries(estado.porIbge[uf] || {}).forEach(([ibge, e]) => incluir(base.mun[ibge], e, dic, 'mun'));
      });
    } else {
      const abr = (estado.uf && estado.uf.abr) || {};
      mapa.ufs.forEach((uf) => incluir(base.uf[uf], abr[uf], dicionario(), 'uf'));
    }
    const assinatura = setas.map((f) => f.geometry.coordinates.join() + f.properties.img).join('|');
    if (assinatura === setasAntes) return;
    setasAntes = assinatura;
    gl.getSource('setas').setData({ type: 'FeatureCollection', features: setas });
  }

  /* Raio do círculo de margem em px, por raiz de voto, no zoom 4 (o Brasil
     inteiro à vista): São Paulo com 1,6 milhão de votos de vantagem dá uns 30 px. */
  const MARGEM_K = 0.023;
  let margensNoQuadro = 0;
  let margensAntes = '';

  function pintarMargens() {
    if (!margensNoQuadro) {
      margensNoQuadro = requestAnimationFrame(() => {
        margensNoQuadro = 0;
        desenharMargens();
      });
    }
  }

  /* As mesmas unidades das setas: os municípios das UFs desenhadas, ou os
     estados quando nenhum município está à mostra. O ponto de cada uma é o de
     onde sai a seta (a base de 2022: centroide, ou um ponto de dentro). */
  function desenharMargens() {
    const gl = mapa.gl;
    if (!gl || !gl.getSource('margens') || !gl.getLayer('margens')) return;
    const ligado = estado.modo === 'margem';
    gl.setLayoutProperty('margens', 'visibility', ligado ? 'visible' : 'none');
    if (!ligado) return;
    const base = estado.base2022;
    const pontos = [];
    const incluir = (ponto, entrada, dic, nivel) => {
      const mg = ponto && ponto.length >= 5 ? APUUI.margemDe(entrada, dic) : null;
      if (!mg) return;
      pontos.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [ponto[3], ponto[4]] },
        properties: { m: mg.m, cor: mg.cor, nome: mg.nome, chave: mg.chave, nivel } });
    };
    if (base) {
      const desenhadas = ufsDesenhadas();
      if (desenhadas.length) {
        desenhadas.forEach((uf) => {
          const dic = dicionarioMun(uf);
          Object.entries(estado.porIbge[uf] || {}).forEach(([ibge, e]) => incluir(base.mun[ibge], e, dic, 'mun'));
        });
      } else {
        const abr = (estado.uf && estado.uf.abr) || {};
        mapa.ufs.forEach((uf) => incluir(base.uf[uf], abr[uf], dicionario(), 'uf'));
      }
    }
    APUUI.legendaMargem('legendaMargem', pontos.map((f) => f.properties));
    const assinatura = pontos.map((f) => f.properties.chave + f.properties.m).join('|');
    if (assinatura === margensAntes) return;
    margensAntes = assinatura;
    gl.getSource('margens').setData({ type: 'FeatureCollection', features: pontos });
  }

  function legendaSetas() {
    const el = $('legendaSetas');
    el.hidden = !(estado.modo === 'variacao' && comparavel());
    if (el.hidden) return;
    /* Como a "Shift in margin" do NYT: as duas setas saindo do mesmo ponto, em
       V, cada uma com o lado embaixo, e uma nota curta. */
    const [a, b] = estado.base2022.numeros.map((n) => candidatoDe({ numero: n, c: null }, dicionario()));
    const lado = (c, direita) => `<span class="apu-setas-item">${setaSVG(APU.cor(c.partido), direita, 30)}`
      + `<small>Mais ${APUUI.esc(String(c.nome).split(' ')[0])}</small></span>`;
    el.innerHTML = '<p class="apu-faixas-tit">Variação na diferença</p>'
      + `<div class="apu-setas-par">${lado(a, false)}${lado(b, true)}</div>`
      + '<p class="apu-setas-nota">Comparado com o 1º turno de 2022. Quanto mais longa a seta, '
      + 'mais pontos a diferença andou.</p>';
  }

  function trocarModo(modo) {
    if (modo === estado.modo) return;
    estado.modo = modo;
    $('modoMapa').querySelectorAll('[data-modo]').forEach((b) => {
      const on = b.dataset.modo === modo;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    if (mapa.gl) aplicarTema();
    pintarSetas();
    pintarMargens();
    legenda();
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
    /* Município escolhido que tem mapa por zona: o atalho para a página dele. */
    APUUI.linkDeZonas('linkZonas', estado.zonas, estado.sel && estado.sel.ibge, APU.cfg.cargo);

    /* Com um estado ou município aberto, o selo de definido e as marcas de
       eleito continuam sendo do país: presidente se elege no Brasil inteiro. */
    const nacional = entradaNacional();
    APUUI.selo(meta, APUUI.comDefinicaoDa(nacional, entrada));
    APUUI.progresso(entrada);
    APUUI.avisos(entrada, 'avisos');
    /* Um botão só para os dois blocos: a participação segue a abertura do
       placar, e o redesenho dela é o que o `aoAlternar` do botão dispara. */
    const verParticipacao = () =>
      APUUI.participacao(entrada, 'participacao', { seguir: 'placar' });
    APUUI.placar(lista.length ? lista : APU.rankingZerado(estado.chapa), 'placar',
      { entrada, cargo: APU.cfg.cargo, marcas: APUUI.marcasDaEleicao(nacional, dicionario(), APU.cfg.cargo),
        botao: 'maisResultado', aoAlternar: verParticipacao });
    verParticipacao();
    /* A projeção é nacional e tem painel próprio: continua à mostra com um
       estado aberto no mapa. */
    projecao(entradaNacional());
    historico();
    comparacao(entrada, dic);

    $('mapaNota').textContent = nota();
  }

  /* ---------------------------------------------- curva da apuração */

  /* A curva do Brasil, ao vivo: uma linha por candidato, um ponto por
     totalização do TSE (APUUI.graficoHistorico), redesenhada a cada boletim.
     Fica na lateral com qualquer recorte aberto no mapa; a de cada estado está
     na página dele. Antes de dois boletins, o aviso no lugar. */
  function historico() {
    const desenhou = APUUI.graficoHistorico('historicoGrafico', estado.hist, dicionario(),
      { largura: 380, altura: 230, rotulos: 112 });
    $('historicoVazio').hidden = desenhou;
  }

  /* ------------------------------------------------------------ projeção */

  /* Minimiza ou abre a coluna da projeção, à esquerda do mapa. Minimizada, ela
     vira uma faixa estreita, que é o botão de abrir de novo. O mapa muda de
     largura junto, e o MapLibre só redesenha no tamanho novo se for avisado. A
     escolha fica no navegador de quem lê; sem armazenamento, a coluna abre. */
  const CHAVE_PROJ_MIN = 'electomaps-proj-min';

  function minimizarProj(sim, guardar) {
    $('painelProj').classList.toggle('is-min', sim);
    $('painelProj').closest('.apu-stage').classList.toggle('proj-min', sim);
    $('projCorpo').hidden = sim;
    $('projMin').hidden = sim;
    $('projAbrir').hidden = !sim;
    $('projMin').setAttribute('aria-expanded', String(!sim));
    $('projAbrir').setAttribute('aria-expanded', String(!sim));
    if (guardar) {
      try { localStorage.setItem(CHAVE_PROJ_MIN, sim ? '1' : '0'); } catch (e) { /* sem armazenamento */ }
    }
    if (mapa.gl) requestAnimationFrame(() => mapa.gl.resize());
  }

  function ligarMinimizarProj() {
    let min = false;
    try { min = localStorage.getItem(CHAVE_PROJ_MIN) === '1'; } catch (e) { /* abre */ }
    minimizarProj(min, false);
    $('projMin').onclick = () => { minimizarProj(true, true); $('projAbrir').focus(); };
    $('projAbrir').onclick = () => { minimizarProj(false, true); $('projMin').focus(); };
  }

  const pct1 = (v) => (100 * v).toFixed(1).replace('.', ',');

  /* A projeção do resultado final, na visão do Brasil. Fica à mostra a noite
     inteira, com os mesmos blocos: antes de 5% das urnas, o título diz que ela
     começa ali e as candidaturas de 2026 aparecem com o lugar de cada número
     vazio; depois que o TSE declara o resultado, a última projeção. (O motor
     também pede voto de 15 estados, projecao.UFS_MIN, mas nas duas noites de
     2022 os 27 já tinham voto com 3% apurado: quem decide é o 5%.)

     A ordem é a das perguntas da noite: a eleição acaba no 1º turno ou vai ao
     2º, e com quem; quem termina em primeiro; e, por último, os votos. */
  function projecao(nacional) {
    const pr = estado.proj;
    const esc = APUUI.esc;
    const pronta = !!(pr && pr.suficiente && pr.cand);
    $('projLegenda').hidden = !pronta;
    $('projDesfecho').hidden = false;
    $('projChances').hidden = false;
    if (!pronta) {
      const vazio = '<span class="apu-proj-medidor" aria-hidden="true"></span>—';
      const chapa = APU.rankingZerado(estado.chapa);
      $('projQuando').textContent = `com ${APU.fmt.pct(nacional && nacional.st > 0 ? nacional.pst : 0)} das urnas`;
      $('projFrase').textContent = 'A projeção começa com 5% das urnas apuradas';
      $('projDesfecho').innerHTML = `
        <div class="apu-proj-split" aria-hidden="true"></div>
        <div class="apu-proj-split-rot">
          <span><b>—</b> vai ao 2º turno</span>
          <span><b>—</b> termina no 1º turno</span>
        </div>
        <p class="apu-proj-par">2º turno mais provável: <b>—</b></p>`;
      $('projChances').innerHTML = '<thead><tr><th scope="col">Chance de</th>'
        + '<th scope="col" class="num">Mais votado</th><th scope="col" class="num">Vai ao 2º turno</th></tr></thead>'
        + '<tbody>' + chapa.map((c) => `<tr><th scope="row">${esc(c.urna)}<small>${esc(c.partido)}</small></th>`
          + `<td class="num">${vazio}</td><td class="num">${vazio}</td></tr>`).join('') + '</tbody>';
      $('projLista').innerHTML = chapa.map((c) => `<div class="apu-proj-linha is-vazia">
          <span class="apu-proj-nome">${esc(c.urna)}<small>${esc(c.partido)}</small></span>
          <span class="apu-proj-trilho" aria-hidden="true"></span>
          <span class="apu-proj-num"><b>—</b></span>
        </div>`).join('');
      return;
    }

    const dic = dicionario();
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
      /* O exterior não tem página de estado: fica sem link. */
      const rotulo = u.cd === APU.EXTERIOR ? APUUI.esc(nome)
        : `<a href="apuracao-uf.html?uf=${u.cd}${sufixoParams()}">${APUUI.esc(nome)}</a>`;
      return `<tr>
        <td>${rotulo}</td>
        <td><span class="apu-estagio is-${u.and}">${APUUI.esc(APU.ESTAGIOS[u.and] || u.and)}</span></td>
        <td class="num">${APU.fmt.pct(u.pst || 0)}</td>
        <td class="num">${APU.fmt.int(u.snt)}</td>
        <td class="num">${APU.fmt.int(u.esnt)}</td>
        <td class="num">${total ? APU.fmt.int(u.muf) + ' / ' + APU.fmt.int(total) : '—'}</td>
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
      estado.zonas = await APUUI.cidadesComZonas();
      /* A base de 2022 não muda: lida uma vez. Sem ela a página segue, só sem
         a comparação. */
      if (APU.cfg.cargo === '0001') {
        [estado.base2022, estado.curva2022] = await Promise.all([BASE_2022, CURVA_2022].map((u) =>
          fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
      }
    }
    /* A camada municipal é republicada bem mais devagar que a alta (~4 min no
       plantão): relê-la a cada volta seria pedir o mesmo arquivo. */
    const municipal = estado.volta++ % 4 === 0 ? ufsDesenhadas() : [];
    const [br, uf, proj, ab] = await Promise.all([
      APU.snapshot('br'), APU.snapshot('uf'), APU.snapshot('proj'), APU.acompanhamento('0001'),
      ...municipal.map(buscarMun)
    ]);
    /* Não apaga o que já está na tela se uma volta falhar: um boletim antigo
       vale mais que um painel vazio. */
    if (br) estado.br = br;
    if (uf) estado.uf = uf;
    if (proj) estado.proj = proj;
    /* A curva do Brasil (hist-br), relida a cada boletim desde o primeiro voto
       no país até o ponto de 100%. Antes do voto ela não existe: pedi-la seria
       só 404. */
    const pais = estado.br && estado.br.abr && estado.br.abr.br;
    if (pais && Number(pais.vvc || pais.vv) > 0 && !APUUI.historicoCompleto(estado.hist)) {
      estado.hist = (await APU.snapshot('hist-br')) || estado.hist;
    }
    if (ab) estado.ab = ab;
    pintar();
    pintarAndamento();
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
    }, APU.intervaloDe(1));
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { atualizar().catch(() => {}).then(agendar); }
    else clearTimeout(estado.timer);
  });

  (async function iniciar() {
    document.title = `${nomeDoCargo()} — Apuração ao vivo — ElectoMaps`;
    APUUI.ligarMenu('0001');
    /* Antes do mapa: a coluna nasce aberta ou minimizada, sem pular depois. */
    ligarMinimizarProj();

    $('voltar').onclick = voltar;
    $('comparacaoCorpo').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-comp]');
      if (!b || b.dataset.comp === estado.compModo) return;
      estado.compModo = b.dataset.comp;
      painel();
    });
    $('camadas').onclick = (ev) => {
      const b = ev.target.closest('[data-camada]');
      if (b) trocarCamada(b.dataset.camada);
    };
    $('modoMapa').onclick = (ev) => {
      const b = ev.target.closest('[data-modo]');
      if (b) trocarModo(b.dataset.modo);
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
