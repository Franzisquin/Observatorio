/* ===========================================================================
   ElectoMaps — locais de votação

   Um estado por vez, de propósito: são 82.052 locais e 500 mil seções no país, e
   carregar tudo numa tela só é o caminho curto para travar o navegador. Roraima
   são 347 locais e 199 KB; São Paulo, 7.668.

   Dois formatos de arquivo, gerados por scripts diferentes:

     <uf>-<ano>.json      só eleitorado, de gerar_locais_votacao.py
     <uf>-<eleicao>.json  com votação, de coletar_locais.py

   O segundo vem dos boletins de urna. A divulgação (EA20) desce até a zona
   eleitoral e para — resultado por seção só existe no boletim, e é de lá que sai
   também o número do local de votação, no `identificacaoSecao`. O cadastro de
   eleitorado entra só para dar nome, endereço e coordenada.

   Paleta partidária, formatação e capitalização vêm de apuracao-dados.js: é a
   mesma tela de apuração, num recorte diferente.
   =========================================================================== */
'use strict';

(function () {

  const $ = (id) => document.getElementById(id);
  const P = new URLSearchParams(location.search);

  const UFS = {
    ac: 'Acre', al: 'Alagoas', am: 'Amazonas', ap: 'Amapá', ba: 'Bahia',
    ce: 'Ceará', df: 'Distrito Federal', es: 'Espírito Santo', go: 'Goiás',
    ma: 'Maranhão', mg: 'Minas Gerais', ms: 'Mato Grosso do Sul',
    mt: 'Mato Grosso', pa: 'Pará', pb: 'Paraíba', pe: 'Pernambuco',
    pi: 'Piauí', pr: 'Paraná', rj: 'Rio de Janeiro', rn: 'Rio Grande do Norte',
    ro: 'Rondônia', rr: 'Roraima', rs: 'Rio Grande do Sul',
    sc: 'Santa Catarina', se: 'Sergipe', sp: 'São Paulo', to: 'Tocantins'
  };

  const cfg = {
    uf: (P.get('uf') || 'rr').toLowerCase(),
    eleicao: P.get('eleicao') || '',
    arquivo: P.get('conjunto') || '',
    ano: P.get('ano') || '2022'
  };

  const estado = { mapa: null, dados: null, sel: null, sec: null, filtro: '' };

  const int = (v) => APU.fmt.int(v);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ------------------------------------------------------------------ dados */

  /* Os dois formatos viram a mesma coisa aqui, para o resto da tela não precisar
     saber de qual arquivo veio. `com` diz se há votação. */
  function normalizar(bruto) {
    const comVotacao = Array.isArray(bruto.locais) && bruto.locais.some((l) => l.v);
    const locais = bruto.locais.map((l, i) => ({
      idx: i,
      mun: l.mun, n: l.n,
      nmun: APU.nomeProprio(l.nmun || ''),
      nm: APU.nomeProprio(l.nm || ''),
      end: APU.nomeProprio(l.end || ''),
      bairro: APU.nomeProprio(l.bairro || ''),
      lat: l.lat == null ? null : Number(l.lat),
      lon: l.lon == null ? null : Number(l.lon),
      el: l.el || 0,
      comp: l.comp || 0,
      v: l.v || null,
      br: l.br || 0,
      nu: l.nu || 0,
      sec: (l.sec || []).map((s) => ({
        z: s.z, s: s.s, el: s.el || 0, comp: s.comp || 0,
        v: s.v || null, br: s.br || 0, nu: s.nu || 0, p: s.p || ''
      }))
    }));
    locais.forEach((l) => {
      l.busca = `${l.nm} ${l.nmun} ${l.bairro} ${l.end}`
        .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    });
    return {
      uf: bruto.uf, com: comVotacao,
      titulo: bruto.nm || '',
      cargo: bruto.cargo || '',
      ano: bruto.ano || '', turno: bruto.turno || '',
      cand: bruto.cand || {},
      locais
    };
  }

  /* O índice diz o que existe na pasta. Sem ele, abrir a página sem `?eleicao=`
     carregava o arquivo só de eleitorado e a votação não aparecia — sem nada na
     tela dizendo que ela existia ao lado. Agora o padrão é o conjunto COM
     votação, e os demais ficam no seletor. */
  let _indice = null;

  async function indice() {
    if (_indice) return _indice;
    try {
      const r = await fetch('resultados_geo/locais_votacao/index.json');
      _indice = r.ok ? (await r.json()).conjuntos || [] : [];
    } catch (e) {
      _indice = [];
    }
    return _indice;
  }

  function conjuntosDa(uf) {
    return (_indice || []).filter((c) => c.uf === uf)
      .sort((a, b) => (b.votacao ? 1 : 0) - (a.votacao ? 1 : 0));
  }

  function escolherConjunto(uf) {
    const lista = conjuntosDa(uf);
    if (cfg.arquivo) {
      const pedido = lista.find((c) => c.arquivo === cfg.arquivo);
      if (pedido) return pedido.arquivo;
    }
    if (cfg.eleicao) {
      const porEleicao = lista.find((c) => String(c.eleicao) === String(cfg.eleicao));
      if (porEleicao) return porEleicao.arquivo;
    }
    return lista.length ? lista[0].arquivo : `${uf}-${cfg.ano}`;
  }

  async function carregar(uf) {
    await indice();
    const nome = escolherConjunto(uf);
    cfg.arquivo = nome;
    const r = await fetch(`resultados_geo/locais_votacao/${nome}.json`);
    if (!r.ok) throw new Error(`sem dados em ${nome}.json`);
    return normalizar(await r.json());
  }

  function montarSeletorConjunto(uf) {
    const el = $('seletorConjunto');
    if (!el) return;
    const lista = conjuntosDa(uf);
    el.hidden = lista.length < 2;
    el.innerHTML = lista.map((c) =>
      `<option value="${c.arquivo}"${c.arquivo === cfg.arquivo ? ' selected' : ''}>`
      + `${c.rotulo}${c.votacao ? '' : ' (só eleitorado)'}</option>`).join('');
  }

  /* ---------------------------------------------------- votação de um ponto */

  /* Ranking de um local ou de uma seção. O percentual é sobre os votos a
     votáveis, que é a base do boletim de urna — a mesma do pvap do TSE. */
  function ranking(alvo) {
    if (!alvo || !alvo.v) return [];
    const base = Object.values(alvo.v).reduce((t, n) => t + n, 0);
    return Object.entries(alvo.v).map(([numero, votos]) => {
      const c = estado.dados.cand[numero] || {};
      return {
        numero,
        urna: APU.nomeProprio(c.urna || c.nome || '') || `Nº ${numero}`,
        partido: c.partido || '',
        situacao: c.situacao || '',
        votos,
        pct: APU.fmt.parte(votos, base)
      };
    }).sort((a, b) => b.votos - a.votos);
  }

  const lider = (alvo) => ranking(alvo)[0] || null;

  /* Soma de um conjunto de locais num alvo só, no mesmo formato de um local.
     É o que o painel mostra antes de qualquer clique: sem isso a tela abre com
     um convite a clicar em vez do resultado, que é a primeira coisa que alguém
     quer ver ao chegar. Respeita a busca — filtrou, o total é do que sobrou. */
  function agregar(lista) {
    const total = { v: {}, br: 0, nu: 0, comp: 0, el: 0, sec: [] };
    lista.forEach((l) => {
      Object.entries(l.v || {}).forEach(([n, q]) => {
        total.v[n] = (total.v[n] || 0) + q;
      });
      total.br += l.br || 0;
      total.nu += l.nu || 0;
      total.comp += l.comp || 0;
      total.el += l.el || 0;
      total.sec.push(...l.sec);
    });
    if (!Object.keys(total.v).length) total.v = null;
    return total;
  }

  /* O balão é o mesmo do visualizador: APUUI.conteudoDoBalao monta a marcação
     .district-nyt-*, e o CSS vem de style.css. Em vez de reescrever um parecido,
     o alvo daqui é traduzido para o formato que aquela função espera —
     `cand` chaveado pelo votável e a base do percentual. */
  function comoSnapshot(alvo) {
    if (!alvo || !alvo.v) return null;
    const base = Object.values(alvo.v).reduce((t, n) => t + n, 0);
    return { cand: alvo.v, vvc: base, vv: base };
  }

  /* O dicionário que o balão usa: chaveado pelo número do votável, como o
     snapshot da apuração é pelo sqcand. */
  function dicionario() {
    const saida = {};
    Object.entries(estado.dados.cand || {}).forEach(([numero, c]) => {
      saida[numero] = {
        nome: c.nome || '', urna: c.urna || c.nome || '',
        numero, partido: c.partido || ''
      };
    });
    return saida;
  }

  /* ------------------------------------------------------------------ mapa */

  function montarMapa() {
    const mapa = new maplibregl.Map({
      container: 'map',
      style: MLCompat.buildBasemapStyle(document.body.dataset.theme === 'light' ? 'light' : 'dark'),
      center: [-61.3, 2.2], zoom: 6, minZoom: 3,
      dragRotate: false, pitchWithRotate: false, attributionControl: false
    });
    MLCompat.augmentMap(mapa);
    MLCompat.refreshThemeColors();
    if (mapa.touchZoomRotate) mapa.touchZoomRotate.disableRotation();
    mapa.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    mapa.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    return mapa;
  }

  /* Mesmas regras do visualizador eleitoral (js/map-render.js): raio logarítmico
     de 3 a 11 sobre o comparecimento, preenchimento a 0,8, sem contorno, e a cor
     do partido do mais votado escurecida ou clareada pela margem —
     `getUniversalGradientColor`, de js/utils.js, a mesma função. Assim um local
     tem a mesma cor nas duas telas. */
  const OPACIDADE = 0.8;

  function raioDe(comparecimento) {
    const log = Math.log10(Math.max(1, comparecimento));
    const p = Math.max(0, Math.min(1, (log - 2) / 2));
    return 3 + 8 * p;
  }

  function corDe(local) {
    const lista = ranking(local);
    if (!lista.length) return '#7a8699';
    const base = APU.cor(lista[0].partido);
    const margem = lista.length > 1 ? lista[0].pct - lista[1].pct : lista[0].pct;
    return typeof getUniversalGradientColor === 'function'
      ? getUniversalGradientColor(base, margem)
      : base;
  }

  function paraGeoJson(locais) {
    const com = estado.dados.com;
    return {
      type: 'FeatureCollection',
      features: locais.filter((l) => l.lat != null && l.lon != null).map((l) => {
        const l1 = com ? lider(l) : null;
        const peso = com ? (l.comp || l.el) : l.el;
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [l.lon, l.lat] },
          properties: {
            idx: l.idx, nm: l.nm, nmun: l.nmun, peso, sec: l.sec.length,
            raio: raioDe(peso),
            cor: com ? corDe(l) : '#3aa3ff',
            lider: l1 ? `${l1.urna} · ${APU.fmt.pct(l1.pct)}` : ''
          }
        };
      })
    };
  }

  function desenhar() {
    const mapa = estado.mapa;
    const dados = paraGeoJson(visiveis());
    if (mapa.getSource('locais')) { mapa.getSource('locais').setData(dados); return; }

    mapa.addSource('locais', { type: 'geojson', data: dados });
    /* O raio cresce um pouco com o zoom, como no visualizador: o valor por
       feição é a base, e a interpolação por zoom só o acompanha. */
    const raioPorZoom = (escala) => [
      'interpolate', ['linear'], ['zoom'],
      5, ['*', ['get', 'raio'], escala * 0.75],
      12, ['*', ['get', 'raio'], escala * 1.9]
    ];

    mapa.addLayer({
      id: 'locais-circulo', type: 'circle', source: 'locais',
      paint: {
        'circle-radius': raioPorZoom(1),
        'circle-color': ['get', 'cor'],
        'circle-opacity': OPACIDADE,
        'circle-stroke-width': 0
      }
    });
    mapa.addLayer({
      id: 'locais-selecionado', type: 'circle', source: 'locais',
      filter: ['==', ['get', 'idx'], -1],
      paint: {
        'circle-radius': raioPorZoom(1.25),
        'circle-color': ['get', 'cor'],
        'circle-opacity': 1,
        'circle-stroke-width': 2.5,
        'circle-stroke-color': '#ffd166'
      }
    });

    mapa.on('click', 'locais-circulo', (ev) => {
      const f = ev.features && ev.features[0];
      if (f) selecionar(f.properties.idx);
    });
    /* O mesmo balão das telas de apuração: ele mede a própria caixa e vira de
       lado ao encostar na borda. Posicionar na mão com `ev.point` estava errado
       de duas formas — é coordenada do canvas, e o elemento é `position: fixed`,
       então o cabeçalho da página deslocava tudo para baixo. */
    const tip = APUUI.balao();
    mapa.on('mouseenter', 'locais-circulo', () => { mapa.getCanvas().style.cursor = 'pointer'; });
    mapa.on('mouseleave', 'locais-circulo', () => {
      mapa.getCanvas().style.cursor = '';
      tip.esconder();
    });
    mapa.on('mousemove', 'locais-circulo', (ev) => {
      const f = ev.features && ev.features[0];
      if (!f) return;
      const l = estado.dados.locais[f.properties.idx];
      const sub = `${l.nmun}${l.bairro ? ' · ' + l.bairro : ''}`
        + (estado.dados.turno ? ` · ${estado.dados.turno}º Turno` : '');
      const html = estado.dados.com
        ? APUUI.conteudoDoBalao(l.nm, sub, comoSnapshot(l), dicionario())
        : `<div class="nyt-tooltip-container">`
          + `<div class="district-nyt-title">${esc(l.nm)}</div>`
          + `<div class="district-nyt-sub">${esc(sub)}</div>`
          + `<div class="district-nyt-nota">${int(l.el)} eleitores em `
          + `${int(l.sec.length)} seções</div></div>`;
      tip.mostrar(html, ev.originalEvent);
    });
  }

  function enquadrar(locais) {
    const com = locais.filter((l) => l.lat != null && l.lon != null);
    if (!com.length) return;
    const lons = com.map((l) => l.lon);
    const lats = com.map((l) => l.lat);
    estado.mapa.fitBounds(
      [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      { padding: 48, duration: 0, maxZoom: 12 });
  }

  /* ---------------------------------------------------------------- filtro */

  function visiveis() {
    if (!estado.filtro) return estado.dados.locais;
    return estado.dados.locais.filter((l) => l.busca.includes(estado.filtro));
  }

  /* --------------------------------------------------------------- painel */

  function pintarResumo() {
    const lista = visiveis();
    const secoes = lista.reduce((t, l) => t + l.sec.length, 0);
    const semCoord = lista.filter((l) => l.lat == null).length;
    const cel = (v, r) => `<div><div class="loc-num">${v}</div><div class="loc-lab">${r}</div></div>`;

    $('resumo').innerHTML = [
      cel(int(lista.length), 'Locais'),
      cel(int(secoes), 'Seções'),
      estado.dados.com
        ? cel(int(lista.reduce((t, l) => t + l.comp, 0)), 'Votos')
        : cel(int(lista.reduce((t, l) => t + l.el, 0)), 'Eleitores')
    ].join('') + (semCoord
      ? `<div class="loc-aviso">${int(semCoord)} sem coordenada válida: aparecem na lista, não no mapa.</div>`
      : '');
  }

  /* Tabela de candidatos na marcação do visualizador (js/results-panel.js):
     .cand-table, a barra de cor, o círculo de eleito e a minibarra por
     percentual. O CSS inteiro já vem de style.css — nada de classe nova aqui,
     senão as duas telas divergem no primeiro ajuste de estilo. */
  function tabelaCandidatos(lista) {
    if (!lista.length) return '<p class="loc-nota">Sem votação nesta abrangência.</p>';
    const linhas = lista.map((c) => {
      const cor = APU.cor(c.partido);
      const st = String(c.situacao || '').toUpperCase();
      const destaque = st.startsWith('ELEIT') || st.includes('TURNO');
      const circulo = destaque
        ? `<span class="cand-check-circle" style="background-color:${cor};">&#10004;</span>`
        : '';
      return `
        <tr>
          <td class="color-bar-td">
            <span class="cand-color-bar" style="background-color:${cor};"></span>
          </td>
          <td class="align-left">
            <div class="cand-name-container">${circulo}
              <span class="cand-name-text">${esc(c.urna)}</span></div>
            <div class="cand-mini-bar-wrap">
              <div class="cand-mini-bar" style="width:${Math.min(100, Math.max(0, c.pct))}%;
                background-color:${cor};"></div>
            </div>
            ${c.partido ? `<div class="cand-partido-text">${esc(c.partido)}</div>` : ''}
          </td>
          <td class="align-center cand-votes-text">${int(c.votos)}</td>
          <td class="align-center pct-text">${APU.fmt.pct(c.pct)}</td>
        </tr>`;
    }).join('');

    return `<table class="cand-table">
        <thead><tr>
          <th class="color-bar-td"></th>
          <th class="align-left">Candidato</th>
          <th class="align-center">Votos</th>
          <th class="align-center">Pct.</th>
        </tr></thead>
        <tbody>${linhas}</tbody>
      </table>`;
  }

  /* Rodapé de números, igual ao do visualizador: válidos, comparecimento com o
     percentual sobre o eleitorado, e inválidos. */
  function metricas(alvo, eleitorado) {
    const validos = alvo.v ? Object.values(alvo.v).reduce((t, n) => t + n, 0) : 0;
    const invalidos = (alvo.br || 0) + (alvo.nu || 0);
    const comparecimento = alvo.comp || (validos + invalidos);
    return `<div class="metrics-grid">
        <div class="metric-item"><span>Votos válidos</span>
          <strong>${int(validos)}</strong></div>
        <div class="metric-item"><span>Comparecimento</span>
          <strong>${int(comparecimento)}${eleitorado
            ? ` (${APU.fmt.pct(APU.fmt.parte(comparecimento, eleitorado))})` : ''}</strong></div>
        <div class="metric-item"><span>Votos inválidos</span>
          <strong>${int(invalidos)} (${APU.fmt.pct(
            APU.fmt.parte(invalidos, comparecimento))})</strong></div>
      </div>`;
  }

  function pintarLista() {
    const lista = visiveis().slice()
      .sort((a, b) => (estado.dados.com ? b.comp - a.comp : b.el - a.el)).slice(0, 40);
    $('lista').innerHTML = lista.map((l) => {
      const l1 = estado.dados.com ? lider(l) : null;
      return `<li class="loc-item${estado.sel === l.idx ? ' is-sel' : ''}" data-idx="${l.idx}">
        <span class="loc-item-nm">${esc(l.nm)}</span>
        <span class="loc-item-mun">${esc(l.nmun)}${l1
          ? ` · <span style="color:${APU.cor(l1.partido)}">${esc(l1.urna)}</span>` : ''}</span>
        <span class="loc-item-el">${int(estado.dados.com ? l.comp : l.el)}</span>
      </li>`;
    }).join('');
  }

  function pintarSecao() {
    const l = estado.dados.locais[estado.sel];
    const s = l && estado.sec != null ? l.sec[estado.sec] : null;
    if (!s) return '';
    return `
      <div class="loc-secao">
        <div class="loc-secao-topo">
          <h3 class="loc-rot">Zona ${esc(s.z)} · Seção ${esc(s.s)}</h3>
          <button class="loc-botao loc-voltar" type="button" id="voltarLocal">Voltar ao local</button>
        </div>
        ${s.v ? tabelaCandidatos(ranking(s)) + metricas(s, s.el)
          : '<p class="loc-nota">Sem boletim de urna para esta seção.</p>'}
      </div>`;
  }

  /* Estado inteiro, ou o recorte da busca. Mesma tabela e mesmas métricas de um
     local: quem chega vê o resultado, e o clique num ponto troca a abrangência
     em vez de revelar a informação. */
  function pintarTotal() {
    const lista = visiveis();
    const total = agregar(lista);
    const recorte = estado.filtro
      ? `${int(lista.length)} locais no filtro`
      : `${int(lista.length)} locais agregados`;

    $('corpo').innerHTML = `
      <div class="loc-ficha">
        <h2 class="loc-ficha-nm">Estado completo (${esc(estado.dados.uf)})</h2>
        <p class="loc-ficha-mun">${recorte} · ${int(total.sec.length)} seções</p>
        ${estado.dados.com
          ? tabelaCandidatos(ranking(total)) + metricas(total, total.el)
          : `<div class="loc-ficha-nums">
               <div><div class="loc-num">${int(total.el)}</div>
                 <div class="loc-lab">Eleitores</div></div>
               <div><div class="loc-num">${int(total.sec.length)}</div>
                 <div class="loc-lab">Seções</div></div>
             </div>`}
        <p class="loc-nota">Clique num ponto do mapa, ou num local da lista, para
          ver o resultado daquele local e o de cada seção.</p>
      </div>`;
  }

  function pintarSelecionado() {
    const l = estado.dados.locais[estado.sel];
    if (!l) { pintarTotal(); return; }

    if (estado.sec != null) { $('corpo').innerHTML = pintarSecao(); ligarVoltar(); return; }

    const agregadas = l.sec.filter((s) => s.p).length;
    const com = estado.dados.com;

    $('corpo').innerHTML = `
      <div class="loc-ficha">
        <h2 class="loc-ficha-nm">${esc(l.nm)}</h2>
        <p class="loc-ficha-mun">${esc(l.nmun)}${l.bairro ? ' · ' + esc(l.bairro) : ''}
          · Zona: ${esc([...new Set(l.sec.map((s) => String(Number(s.z))))].join(', '))}</p>
        <p class="loc-ficha-end">${esc(l.end)}</p>

        ${com ? tabelaCandidatos(ranking(l)) + metricas(l, l.el) : `
          <div class="loc-ficha-nums">
            <div><div class="loc-num">${int(l.el)}</div><div class="loc-lab">Eleitores</div></div>
            <div><div class="loc-num">${int(l.sec.length)}</div><div class="loc-lab">Seções</div></div>
          </div>`}

        <h3 class="loc-rot">Seções que votam aqui${com ? ' — clique para abrir' : ''}</h3>
        <table class="loc-secoes">
          <thead><tr><th>Zona</th><th>Seção</th>
            ${com ? '<th>Mais votado</th>' : ''}
            <th class="num">${com ? 'Votos' : 'Eleitores'}</th></tr></thead>
          <tbody>
            ${l.sec.map((s, i) => {
              const s1 = com && s.v ? ranking(s)[0] : null;
              return `<tr class="${com ? 'is-click' : ''}${s.p ? ' is-agregada' : ''}"
                          data-sec="${i}">
                <td>${esc(s.z)}</td>
                <td>${esc(s.s)}${s.p ? ` <span class="loc-tag">agregada à ${esc(s.p)}</span>` : ''}</td>
                ${com ? `<td>${s1
                  ? `<span class="loc-swatch" style="background:${APU.cor(s1.partido)}"></span>`
                    + esc(s1.urna) : '—'}</td>` : ''}
                <td class="num">${int(com ? s.comp : s.el)}</td></tr>`;
            }).join('')}
          </tbody>
        </table>
        ${agregadas ? `<p class="loc-nota">${int(agregadas)} seção(ões) agregada(s): votam na
          urna da principal, e a votação delas aparece somada lá.</p>` : ''}
      </div>`;

    if (com) {
      $('corpo').querySelectorAll('tr[data-sec]').forEach((tr) => {
        tr.onclick = () => { estado.sec = Number(tr.dataset.sec); pintarSelecionado(); };
      });
    }
  }

  function ligarVoltar() {
    const b = $('voltarLocal');
    if (b) b.onclick = () => { estado.sec = null; pintarSelecionado(); };
  }

  function selecionar(idx) {
    estado.sel = idx;
    estado.sec = null;
    estado.mapa.setFilter('locais-selecionado', ['==', ['get', 'idx'], idx]);
    pintarSelecionado();
    pintarLista();
    const l = estado.dados.locais[idx];
    if (l && l.lat != null) {
      estado.mapa.easeTo({ center: [l.lon, l.lat], zoom: Math.max(estado.mapa.getZoom(), 13) });
    }
  }

  /* ---------------------------------------------------------------- ciclo */

  async function trocarUF(uf) {
    cfg.uf = uf;
    $('subPainel').textContent = 'Carregando…';
    try {
      const dados = await carregar(uf);
      estado.dados = dados;
      estado.sel = null;
      estado.sec = null;

      const nomeUF = UFS[uf] || uf.toUpperCase();
      document.title = `Locais de votação — ${nomeUF} — ElectoMaps`;
      $('tituloPainel').textContent = nomeUF;
      $('subPainel').textContent = dados.com
        ? `${dados.titulo}${dados.cargo ? ' · ' + (APU.CARGOS[dados.cargo] || '') : ''}`
        : `Eleitorado de ${dados.ano}, ${dados.turno}º turno`;

      montarSeletorConjunto(uf);
      desenhar();
      enquadrar(dados.locais);
      estado.mapa.setFilter('locais-selecionado', ['==', ['get', 'idx'], -1]);
      pintarResumo();
      pintarLista();
      pintarSelecionado();

      const q = new URLSearchParams(location.search);
      q.set('uf', uf);
      q.set('conjunto', cfg.arquivo);
      q.delete('eleicao'); q.delete('ano');
      history.replaceState(null, '', '?' + q.toString());
    } catch (e) {
      $('subPainel').textContent = e.message;
      $('corpo').innerHTML = `<p class="loc-dica">Gere os dados com<br>
        <code>python scripts/apuracao/coletar_locais.py --eleicao ${esc(cfg.eleicao || '6278')} --uf ${esc(uf)}</code>
        <br>ou, só com eleitorado,<br>
        <code>python scripts/gerar_locais_votacao.py --uf ${esc(uf)} --ano ${esc(cfg.ano)}</code></p>`;
      $('resumo').innerHTML = '';
      $('lista').innerHTML = '';
    }
  }

  (function iniciar() {
    $('seletorUF').innerHTML = Object.entries(UFS)
      .sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
      .map(([sigla, nome]) =>
        `<option value="${sigla}"${sigla === cfg.uf ? ' selected' : ''}>${nome}</option>`).join('');

    estado.mapa = montarMapa();
    $('seletorUF').onchange = (ev) => { cfg.arquivo = ''; trocarUF(ev.target.value); };
    $('seletorConjunto').onchange = (ev) => {
      cfg.arquivo = ev.target.value;
      trocarUF(cfg.uf);
    };

    let temporizador = null;
    $('busca').oninput = (ev) => {
      clearTimeout(temporizador);
      temporizador = setTimeout(() => {
        estado.filtro = ev.target.value.trim().toLowerCase()
          .normalize('NFD').replace(/[̀-ͯ]/g, '');
        if (!estado.dados) return;
        desenhar();
        pintarResumo();
        pintarLista();
        if (estado.sel === null) pintarTotal();
      }, 160);
    };

    $('lista').onclick = (ev) => {
      const item = ev.target.closest('[data-idx]');
      if (item) selecionar(Number(item.dataset.idx));
    };

    $('alternarTema').onclick = () => {
      const claro = document.body.dataset.theme === 'light';
      document.body.dataset.theme = claro ? 'dark' : 'light';
      MLCompat.setBasemapTheme(estado.mapa, document.body.dataset.theme);
    };

    estado.mapa.on('load', () => trocarUF(cfg.uf));
  })();
})();
