/* Ciclo COMPLETO de desenho do mapa, com o MLCompat real, fora do browser.
 *
 * Os outros testes de area chamam buildGeneralApSummary/resolveApDetailFeatures
 * direto. Este roda applyFiltersAndRedraw de verdade e olha a camada que sobra
 * no mapa — que e a unica coisa que o usuario ve.
 *
 * O que ele protege:
 *
 * 1. A SEGUNDA PASSADA. Na primeira vez o indice do ano ainda nao esta em
 *    memoria: resolveApDetailFeatures dispara a carga e devolve null, e o mapa
 *    sai com PONTOS. Quem desenha as areas e o redesenho agendado no .then().
 *    Se esse segundo ciclo nao acontecer, o botao "Areas" simplesmente nao faz
 *    nada — sem erro nenhum. Foi o que aconteceu na eleicao municipal.
 *
 * 2. A ELEICAO MUNICIPAL. Escopo, seletor de UF e chave de voto sao outros; o
 *    caminho de desenho e o mesmo.
 *
 *     node scripts/testar_redraw_areas.mjs
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let falhas = 0;
function ok(cond, nome, detalhe = '') {
  console.log(`${cond ? '  ok   ' : '  FALHA'} ${nome}${detalhe ? '  - ' + detalhe : ''}`);
  if (!cond) falhas++;
}

const lerJson = (rel) => JSON.parse(readFileSync(path.join(RAIZ, rel), 'utf8'));
function lerZipJson(relZip, entrada) {
  const saida = execFileSync('python', ['-c',
    'import sys,zipfile;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',
    path.join(RAIZ, relZip), entrada], { maxBuffer: 1 << 28 });
  return JSON.parse(saida.toString('utf8'));
}

// ------------------------------------------------------------- ambiente

const cache = new Map();
const el = (id) => {
  if (!cache.has(id)) {
    cache.set(id, {
      id, style: {}, dataset: {}, innerHTML: '', textContent: '', value: '', checked: false,
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      querySelector: () => el('q'), querySelectorAll: () => [],
      appendChild() {}, addEventListener() {}, removeEventListener() {},
      setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
      closest: () => null, remove() {}, insertAdjacentHTML() {}, options: [], children: [],
      getBoundingClientRect: () => ({ width: 100, height: 100, top: 0, left: 0 }),
      dispatchEvent() {}
    });
  }
  return cache.get(id);
};

const PRELUDIO = `
  var document = {
    getElementById: (id) => __el(id), querySelector: (s) => __el('q:' + s),
    querySelectorAll: () => [], createElement: () => __el('new:' + Math.random()),
    addEventListener(){}, body: __el('body'), documentElement: __el('html') };
  var localStorage = { getItem: () => null, setItem(){}, removeItem(){} };
  var navigator = { userAgent: 'node' };
  var location = { href: '', search: '' };
  var Event = function (t) { this.type = t; }; var CustomEvent = Event;
  var getComputedStyle = () => ({ getPropertyValue: () => '#888888' });
  var fetch = async (url) => ({ ok: true, json: async () => __lerJson(url) });
`;

const MODULOS = [
  'js/globals.js', 'js/utils.js', 'js/party-numbers.js', 'js/data-zip.js',
  'js/data-process.js', 'js/data-municipal.js', 'js/data-loader.js',
  'js/data-geral-2022.js', 'js/ui-helpers.js', 'js/map-render.js',
  'js/ui-results.js', 'js/results-panel.js', 'js/ui-controls.js',
  'js/maplibre-compat.js',
];

const fonte = PRELUDIO
  + MODULOS.map((f) => `\n/* ===== ${f} ===== */\n` + readFileSync(path.join(RAIZ, f), 'utf8')).join('\n');

const erros = [];
const ctx = {
  console: { log() {}, warn() {}, error(...a) { erros.push(a.map(String).join(' ')); } },
  setTimeout, clearTimeout, Promise,
  addEventListener() {}, removeEventListener() {},
  __lerJson: lerJson, __el: el,
};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fonte, ctx, { filename: 'bundle.js' });

// Mapa falso no formato que o MLCompat real espera. Guardar source e layers
// permite perguntar depois QUAL camada ficou no mapa — que e o ponto do teste.
vm.runInContext(`
  var __src = new Map(), __lay = new Map();
  map = {
    addSource(id, o) { __src.set(id, o); },
    getSource(id) { const o = __src.get(id); return o ? { setData(d) { o.data = d; } } : undefined; },
    removeSource(id) { __src.delete(id); },
    addLayer(spec) { __lay.set(spec.id, spec); },
    getLayer(id) { return __lay.get(id); },
    removeLayer(a) { if (a && typeof a.remove === 'function') return a.remove(); __lay.delete(a); },
    setLayoutProperty() {}, setPaintProperty() {}, setFeatureState() {},
    on() {}, off() {}, once() {},
    getCanvas: () => ({ style: {} }),
    isStyleLoaded: () => true, loaded: () => true, style: { _loaded: true },
    __geoLayers: new Set(),
    __camadas() { return [...__lay.keys()].sort(); },
    __feicoesDe(id) { const s = __src.get(id + '-src'); return s && s.data ? s.data.features.length : -1; }
  };
  maplibregl = {
    Popup: class { setLngLat(){return this;} setHTML(){return this;} addTo(){return this;} remove(){} },
    LngLatBounds: class { extend(){return this;} isEmpty(){return true;} getCenter(){return {lng:0,lat:0};} }
  };
`, ctx);

console.log('Ciclo de desenho do mapa');

// ------------------------------------------------- cenario: Rio Branco 2024

const MUNI_IBGE = '1200401';
const pref = lerZipJson('resultados_geo/Municipais 2024/prefeito_2024_ord_t1_AC.zip',
  '1392_RIO_BRANCO.json');
const idx24 = lerJson('resultados_geo/regioes_ap/locais_ap_2024_AC.json');
const malhaAC = lerJson('resultados_geo/regioes_ap/regioes_ap_AC.geojson');
const areasDoMuni = malhaAC.features.filter(
  (f) => String(f.properties.CD_REG).startsWith(MUNI_IBGE)).length;

// Feature como buildMunicipal2024Feature monta: cod_localidade_ibge e NUMERO.
ctx.__geo = {
  type: 'FeatureCollection',
  features: Object.keys(pref.RESULTS).map((chave) => {
    const [zona, , local] = chave.split('_');
    return {
      type: 'Feature', geometry: { type: 'Point', coordinates: [-67.8, -9.97] },
      properties: {
        id_unico: chave, local_key: chave, local_id: `${zona}_${local}`,
        nm_locvot: 'Escola', cod_localidade_ibge: Number(MUNI_IBGE),
        nm_localidade: 'RIO BRANCO', nr_zona: Number(zona), nr_locvot: Number(local)
      },
    };
  }),
};
ctx.__pref = pref;
ctx.__ibge = MUNI_IBGE;

// `dom` auto-preenchido: o redesenho toca dezenas de elementos do painel, e o
// que este teste observa e a CAMADA do mapa, nao o HTML.
vm.runInContext(`
  dom = new Proxy({}, {
    get(a, k) {
      if (k === 'selectMunicipio') return { value: 'RIO BRANCO', options: [] };
      if (k === 'selectUFMunicipal') return { value: 'AC' };
      if (k === 'selectUFGeneral') return { value: '' };
      if (!(k in a)) a[k] = __el('dom:' + String(k));
      return a[k];
    },
    set(a, k, v) { a[k] = v; return true; }
  });
  STATE.currentElectionType = 'municipal';
  STATE.currentElectionYear = '2024';
  STATE.currentMapMuniUF = null;
  currentOffice = 'prefeito'; currentSubType = 'ord'; currentCargo = 'prefeito_ord';
  currentTurno = 1; STATE.dataHas2T = { prefeito_ord: false };
  STATE.inaptos = { prefeito_ord: { '1T': [], '2T': [] } };
  currentCidadeFilter = 'all'; currentBairroFilter = 'all'; currentLocalFilter = '';
  currentRegionFilter = { level: '', code: '' };
  STATE.currentMapMode = 'locais';
  STATE.municipiosLayer = null; currentLayer = null;
  applyPrefeitoJsonToGeojson2024(__geo, __pref, '1T');
  currentDataCollection['prefeito_ord'] = __geo;
`, ctx);

// ------------------------------------------------- o PADRAO ao abrir a cidade
//
// Abrir um municipio na eleicao municipal ja tem de cair em areas, como clicar
// num municipio na geral: escolher a cidade e o gesto de querer ver por dentro
// dela. Sem isto o usuario abre a cidade, ve pontos, e o botao "Areas" fica
// parecendo o unico caminho — foi o que aconteceu.
{
  const r = vm.runInContext(`(() => {
    STATE.detalhe = 'locais';
    finalizeMunicipalLoadUI('RIO BRANCO', false);
    return { detalhe: STATE.detalhe, aplica: apLevelApplies() };
  })()`, ctx, { filename: 'padrao.js' });
  ok(r.aplica === true, 'o nivel de area vale nesta cidade');
  ok(r.detalhe === 'areas',
    'abrir o municipio ja pede as areas, sem apertar botao', r.detalhe);

  // 2004: das municipais, as de 2000 e 2004 sao as que ficaram sem indice —
  // dali para tras nao ha GeoPackage de locais para casar com a malha.
  const semIndice = vm.runInContext(`(() => {
    STATE.currentElectionYear = '2004';
    STATE.detalhe = 'locais';
    finalizeMunicipalLoadUI('RIO BRANCO', false);
    const d = STATE.detalhe;
    STATE.currentElectionYear = '2024';
    return d;
  })()`, ctx, { filename: 'padrao2020.js' });
  ok(semIndice === 'locais',
    'e num ano municipal sem indice de area continua nos pontos', semIndice);
}

// ------------------------------------------------- detalhe 'locais'
{
  vm.runInContext(`STATE.detalhe = 'locais'; applyFiltersAndRedraw();`, ctx);
  const r = vm.runInContext(`({ camada: currentLayer && currentLayer.id,
    n: map.__feicoesDe('locais'), layers: map.__camadas().join(',') })`, ctx);
  ok(r.camada === 'locais' && r.n > 0,
    'detalhe "locais": desenha os pontos', `${r.n} feicoes, layers=${r.layers}`);
}

// ------------------------------------------------- detalhe 'areas'
{
  // Primeira passada: o indice do ano ainda nao esta em memoria.
  vm.runInContext(`STATE.detalhe = 'areas'; applyFiltersAndRedraw();`, ctx);
  const p1 = vm.runInContext(`({ camada: currentLayer && currentLayer.id,
    pronto: apIndexPronto(apCurrentUF()) })`, ctx);
  ok(p1.camada === 'locais' && p1.pronto === false,
    'primeira passada cai nos pontos e agenda a carga do indice', p1.camada);

  // Espera a carga e deixa o .then() rodar o redesenho.
  await vm.runInContext(`ensureApIndexLoaded(apCurrentUF())`, ctx);
  await new Promise((r) => setTimeout(r, 50));

  const p2 = vm.runInContext(`({ camada: currentLayer && currentLayer.id,
    pronto: apIndexPronto(apCurrentUF()),
    n: map.__feicoesDe('areas'),
    ativo: !!STATE.apDetailActive,
    layers: map.__camadas().join(','),
    uf: apCurrentUF() })`, ctx);

  ok(p2.pronto === true, 'o indice do ano fica pronto', `UF=${p2.uf}`);
  ok(p2.camada === 'areas',
    'SEGUNDA passada troca a camada para as areas', `camada=${p2.camada}`);
  ok(p2.n === areasDoMuni,
    `desenha as ${areasDoMuni} areas de Rio Branco`, `${p2.n}`);
  ok(p2.ativo === true, 'e marca o detalhe de area como ativo');
  ok(!p2.layers.includes('locais-circle'),
    'sem deixar a camada de pontos no mapa', p2.layers);
}

// ------------------------------------------------- voltar para os pontos
{
  vm.runInContext(`STATE.detalhe = 'locais'; applyFiltersAndRedraw();`, ctx);
  const r = vm.runInContext(`({ camada: currentLayer && currentLayer.id,
    layers: map.__camadas().join(',') })`, ctx);
  ok(r.camada === 'locais' && !r.layers.includes('areas-fill'),
    'voltar para "locais" tira as areas do mapa', r.layers);
}

// ------------------------------------------------- VEREADOR
//
// Na municipal os dois cargos passam pelo mesmo desenho, mas o voto vem de
// lugares diferentes: prefeito nas props da feature, vereador em
// STATE.vereadorResults chaveado por zona_local (sem o municipio, porque o
// acervo dele ja e de um municipio so). Desenhar area de vereador pelo caminho
// do prefeito daria area cinza, sem erro nenhum.
{
  const ver = lerZipJson(
    'resultados_geo/Municipais_Legislativas 2024/vereadores_2024_AC.zip',
    'vereadores_2024_AC_RIO_BRANCO_1392.json');
  ctx.__ver = ver;

  vm.runInContext(`
    currentOffice = 'vereador'; currentSubType = 'ord'; currentCargo = 'vereador_ord';
    STATE.dataHas2T = { vereador_ord: false }; currentTurno = 1;
    STATE.inaptos['vereador_ord'] = { '1T': [], '2T': [] };
    STATE.vereadorResults = {};
    Object.entries(__ver.RESULTS).forEach(([locId, votos]) => {
      STATE.vereadorResults[locId] = { v: votos };
    });
    STATE.vereadorMetadata = { ...(__ver.METADATA?.cand_names || {}) };
    STATE.vereadorAdjustments = {};
    STATE.vereadorLookup = null;
    STATE._vereadorPartyPrefixCache = null;
    applyVereadorMetricsToGeojson2024(__geo, __ver);
    currentDataCollection['vereador_ord'] = __geo;
    STATE.detalhe = 'areas';
    currentLayer = null;
    applyFiltersAndRedraw();
  `, ctx);

  const r = vm.runInContext(`(() => {
    const s = buildGeneralApSummary(apCurrentUF(), 'vereador_ord');
    const cods = Object.keys(s);
    return {
      camada: currentLayer && currentLayer.id,
      n: map.__feicoesDe('areas'),
      ativo: !!STATE.apDetailActive,
      areas: cods.length,
      comPartido: cods.filter((c) => !!s[c].winnerParty).length,
      soDoMuni: cods.every((c) => c.startsWith(__ibge))
    };
  })()`, ctx, { filename: 'ver.js' });

  ok(r.camada === 'areas', 'vereador tambem desenha a camada de areas', r.camada);
  ok(r.n === areasDoMuni, `com as ${areasDoMuni} areas de Rio Branco`, `${r.n}`);
  ok(r.ativo === true, 'e o detalhe de area fica ativo');
  ok(r.areas > 0 && r.comPartido === r.areas,
    'toda area resolve o partido vencedor pelo agrupamento proporcional',
    `${r.comPartido} de ${r.areas}`);
  ok(r.soDoMuni, 'e so areas do proprio municipio — cada cidade com a sua');

  // Voltar para prefeito no mesmo municipio nao pode arrastar o resultado do
  // vereador: sao summaries distintos sobre a MESMA malha.
  const trocaCargo = vm.runInContext(`(() => {
    const ver = buildGeneralApSummary(apCurrentUF(), 'vereador_ord');
    currentOffice = 'prefeito'; currentSubType = 'ord'; currentCargo = 'prefeito_ord';
    applyFiltersAndRedraw();
    const pref = buildGeneralApSummary(apCurrentUF(), 'prefeito_ord');
    const c = Object.keys(pref)[0];
    return {
      camada: currentLayer && currentLayer.id,
      mesmasAreas: Object.keys(ver).sort().join() === Object.keys(pref).sort().join(),
      totaisDiferentes: ver[c] && pref[c] && ver[c].totalValid !== pref[c].totalValid
    };
  })()`, ctx, { filename: 'troca.js' });

  ok(trocaCargo.camada === 'areas', 'trocar de cargo mantem o mapa em areas');
  ok(trocaCargo.mesmasAreas, 'sobre as mesmas areas');
  ok(trocaCargo.totaisDiferentes,
    'mas com os numeros do cargo escolhido, nao os do anterior');
}

// ------------------------------------------------- ENTRAR NUMA AREA
//
// Clicar numa area e o passo seguinte: o mapa desce para os locais DAQUELA
// area, dentro do proprio municipio. Na municipal isso precisa passar pelo
// matchesRegionalScope sem esbarrar no corte por tipo de eleicao — os niveis do
// IBGE sao acima do municipio e param ali, a area de ponderacao nao.
{
  const alvoAp = vm.runInContext(`(() => {
    STATE.detalhe = 'areas';
    currentOffice = 'prefeito'; currentCargo = 'prefeito_ord';
    applyFiltersAndRedraw();
    const s = buildGeneralApSummary(apCurrentUF(), 'prefeito_ord');
    // uma area com mais de um local, para o recorte ter o que mostrar
    const porArea = {};
    __geo.features.forEach((f) => {
      const c = getApCodeForFeature(f.properties);
      if (c) porArea[c] = (porArea[c] || 0) + 1;
    });
    return Object.keys(s).find((c) => porArea[c] > 1) || Object.keys(s)[0];
  })()`, ctx, { filename: 'alvo.js' });

  ctx.__alvoAp = alvoAp;
  const dentro = vm.runInContext(`(() => {
    const esperados = __geo.features.filter(
      (f) => getApCodeForFeature(f.properties) === __alvoAp).length;

    // Mesma transicao de estado que applyRegionSelection faz ao clicar no
    // poligono (ela vive dentro de setupControls, que precisa do DOM real).
    STATE.apEscopoAnterior = { cidade: currentCidadeFilter,
      regiao: { ...currentRegionFilter }, contexto: regionScopeContext(),
      label: rotuloDoEscopoAtual() };
    currentRegionFilter = { level: 'ap', code: __alvoAp, contexto: regionScopeContext() };
    currentBairroFilter = 'all'; currentLocalFilter = '';
    STATE.detalhe = 'locais';
    STATE.currentMapMode = 'locais';
    applyFiltersAndRedraw();

    return {
      esperados,
      camada: currentLayer && currentLayer.id,
      desenhados: map.__feicoesDe('locais'),
      rotulo: getRegionalFilterSummaryLabel(),
      filtroAtivo: hasRegionalScopeFilters()
    };
  })()`, ctx, { filename: 'entrar.js' });

  ok(dentro.camada === 'locais',
    'entrar numa area desce para os locais dela', dentro.camada);
  ok(dentro.desenhados === dentro.esperados && dentro.esperados > 0,
    `desenha so os ${dentro.esperados} locais daquela area`, `${dentro.desenhados}`);
  ok(dentro.filtroAtivo === true, 'o recorte fica ativo');
  ok(/^Área de Ponderação /.test(dentro.rotulo),
    'e o painel identifica a area pelo nome', dentro.rotulo);

  // ---------------------------------------- SUBIR DE VOLTA PARA O MUNICIPIO
  //
  // Dois defeitos que nasciam do MESMO recorte teimoso:
  //
  //  1. o botao de voltar, de dentro de uma area, ia para o ESTADO. A area e
  //     sub-municipal: o degrau de cima e o municipio.
  //  2. pedir de novo o mapa de areas com o recorte ainda de pe deixava so a
  //     area clicada pintada — buildGeneralApSummary so soma local aprovado por
  //     filterFeature — e todas as outras do municipio apagadas.
  const alvoVolta = vm.runInContext("getScopeBackTarget()", ctx, { filename: 'alvoVolta.js' });
  ok(alvoVolta && alvoVolta.kind === 'ap-escopo',
    'de dentro da area o botao de voltar sobe para o municipio, nao para o estado',
    alvoVolta ? `${alvoVolta.kind} (${alvoVolta.label})` : 'nenhum');
  ok(!!alvoVolta && /Rio Branco/i.test(alvoVolta.label || ''),
    'e o rotulo nomeia a cidade de onde se entrou', alvoVolta && alvoVolta.label);

  // O degrau acima so existe se applyRegionSelection o guardar ANTES de zerar o
  // filtro de cidade — ela vive dentro de setupControls e nao roda aqui, entao
  // o que se garante e que a gravacao esta la.
  {
    const fonte = readFileSync(path.join(RAIZ, 'js/ui-controls.js'), 'utf8');
    const trecho = fonte.slice(fonte.indexOf('window.applyRegionSelection = function'),
      fonte.indexOf("currentCidadeFilter = 'all';",
        fonte.indexOf('window.applyRegionSelection = function')));
    ok(/STATE\.apEscopoAnterior = \{/.test(trecho),
      'e applyRegionSelection guarda esse degrau ao entrar na area');
  }

  const reAreas = vm.runInContext(`(() => {
    // exatamente o que o botao "Areas" faz
    STATE.detalhe = 'areas';
    STATE.currentMapMode = 'locais';
    applyFiltersAndRedraw();
    const s = buildGeneralApSummary(apCurrentUF(), 'prefeito_ord');
    return {
      camada: currentLayer && currentLayer.id,
      desenhadas: map.__feicoesDe('areas'),
      comResultado: Object.keys(s).length,
      recorte: activeRegionFilter().level,
      cidade: currentCidadeFilter
    };
  })()`, ctx, { filename: 'reareas.js' });

  ok(reAreas.recorte !== 'ap',
    'pedir o mapa de areas larga o recorte da area — nao da para estar dentro e fora dela',
    reAreas.recorte || '(nenhum)');
  ok(reAreas.camada === 'areas' && reAreas.desenhadas === areasDoMuni,
    `desenha as ${areasDoMuni} areas de novo`, `${reAreas.desenhadas}`);
  ok(reAreas.comResultado === areasDoMuni,
    'e TODAS voltam a ter resultado — nao so a que foi clicada',
    `${reAreas.comResultado} de ${areasDoMuni}`);

  // Sair do recorte devolve a cidade inteira.
  const fora = vm.runInContext(`(() => {
    currentRegionFilter = { level: '', code: '' };
    STATE.detalhe = 'locais';
    applyFiltersAndRedraw();
    return { n: map.__feicoesDe('locais'), filtro: hasRegionalScopeFilters() };
  })()`, ctx, { filename: 'sair.js' });
  ok(fora.filtro === false && fora.n > dentro.desenhados,
    'e sair do recorte devolve o municipio inteiro',
    `${fora.n} locais`);
}

// ------------------------------------------- VOLTAR AO ESTADO
//
// O municipio coberto por areas e desenhado APAGADO, para nao tingir a cor
// delas. Ao voltar para o mapa do estado nao ha mais areas por cima — se a
// flag nao for zerada, aquele municipio continua apagado e SOME do meio dos
// vizinhos coloridos. Todos os caminhos que trocam o mapa precisam zera-la.
{
  const r = vm.runInContext(`(() => {
    // estado tipico de quem estava vendo as areas de uma cidade
    STATE.detalhe = 'areas';
    STATE.currentMapMode = 'locais';
    applyFiltersAndRedraw();
    const antes = {
      ativo: !!STATE.apDetailActive,
      apagado: getMunicipalPolygonStyle(
        { properties: { CD_MUN: __ibge } }, STATE.currentMapMuniSummary).fillOpacity
    };

    // e agora o botao de voltar ao estado
    const orig = createMunicipiosGeoLayer;
    createMunicipiosGeoLayer = () => ({ addTo() {}, getBounds: () => null, setFeatures() {} });
    STATE.apDetailActive = false; STATE.apScopeMunis = null;   // o que o overview faz
    const depois = {
      ativo: !!STATE.apDetailActive,
      apagado: getMunicipalPolygonStyle(
        { properties: { CD_MUN: __ibge } }, STATE.currentMapMuniSummary).fillOpacity
    };
    createMunicipiosGeoLayer = orig;
    return { antes, depois };
  })()`, ctx, { filename: 'voltar.js' });

  ok(r.antes.ativo === true && r.antes.apagado <= 0.05,
    'com areas por cima, o municipio fica apagado (para nao tingir a cor delas)',
    `fillOpacity ${r.antes.apagado}`);
  ok(r.depois.apagado > 0.05,
    'ao voltar ao estado ele volta a ser pintado — nao pode sumir',
    `fillOpacity ${r.depois.apagado}`);

  // A garantia real: o overview do estado zera a flag por conta propria.
  const fonteMap = readFileSync(path.join(RAIZ, 'js/map-render.js'), 'utf8');
  const trecho = fonteMap.slice(fonteMap.indexOf('async function showMunicipalStatewideOverview'));
  ok(/STATE\.apDetailActive = false/.test(trecho.slice(0, 900)),
    'e showMunicipalStatewideOverview zera a flag ao entrar');
}

// ------------------------------------------------- mapa vazio se explica
//
// Mapa que fica vazio tendo dados foi o defeito mais caro desta sessao: nada
// aparece e nada e registrado. O aviso tem de NOMEAR a guarda que zerou.
{
  const casos = vm.runInContext(`(() => {
    const r = {};
    const base = { level: '', code: '' };

    currentRegionFilter = { level: 'ap', code: '9999999999' };
    r.recorte = diagnosticarFiltroVazio(__geo);

    // Na municipal o filtro de cidade nao esta em vigor: nao pode ser acusado.
    currentRegionFilter = base;
    currentCidadeFilter = 'CIDADE QUE NAO EXISTE';
    r.cidadeMunicipal = diagnosticarFiltroVazio(__geo);
    // Na geral ele vale, e ai sim deve ser nomeado.
    STATE.currentElectionType = 'geral';
    r.cidadeGeral = diagnosticarFiltroVazio(__geo);
    STATE.currentElectionType = 'municipal';

    currentCidadeFilter = 'all';
    currentBairroFilter = 'BAIRRO INEXISTENTE';
    r.bairro = diagnosticarFiltroVazio(__geo);

    currentBairroFilter = 'all';
    r.nenhum = diagnosticarFiltroVazio(__geo);
    return r;
  })()`, ctx, { filename: 'diag.js' });

  ok(/recorte ap=9999999999/.test(casos.recorte),
    'o aviso nomeia o recorte que nao casa', casos.recorte);
  ok(!/CIDADE QUE NAO EXISTE/.test(casos.cidadeMunicipal),
    'na municipal NAO acusa a cidade — ali esse filtro nem esta em vigor',
    casos.cidadeMunicipal);
  ok(/CIDADE QUE NAO EXISTE/.test(casos.cidadeGeral),
    'mas na geral nomeia a cidade que nao casa', casos.cidadeGeral);
  ok(/BAIRRO INEXISTENTE/.test(casos.bairro),
    'nomeia o bairro', casos.bairro);
  ok(/locais no acervo/.test(casos.nenhum),
    'e sem filtro nenhum diz quantos locais havia', casos.nenhum);
}

if (erros.length) {
  console.log('\nconsole.error durante o teste:');
  erros.slice(0, 5).forEach((e) => console.log('   ' + e.slice(0, 160)));
}
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo ok.');
process.exit(falhas ? 1 : 0);
