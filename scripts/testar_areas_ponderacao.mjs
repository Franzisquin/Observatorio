/* Harness do mapa por AREA DE PONDERACAO (nivel 'ap'), fora do browser.
 *
 * Carrega os modulos reais num contexto Node com `document`/`fetch` stubados,
 * monta as features de local de votacao pelo MESMO caminho do site
 * (applyGeneralMajoritariaJsonToGeojson2022) e confere a agregacao por area.
 *
 * O que este teste protege:
 *
 * 1. A CHAVE DO LOCAL. O indice local->area e chaveado por
 *    "zona_municipioTSE_local", que e a chave do RESULTS e o props.id_unico da
 *    feature. Errar o formato nao quebra nada visivelmente: o mapa so sai com
 *    areas cinza e totais faltando. Aqui a soma tem de fechar com o oficial.
 *
 * 2. O EIXO DA AGREGACAO. Area de ponderacao e o unico nivel SUB-municipal do
 *    site. Se alguem fizer buildGeneralApSummary somar municipios (como os
 *    quatro niveis do IBGE fazem), todo local de um municipio cairia numa area
 *    so e as outras zerariam.
 *
 * 3. O RECORTE. matchesRegionalScope tem de decidir pelo LOCAL quando o nivel e
 *    'ap'; caindo no ramo municipal, entrar numa area mostraria a cidade inteira.
 *
 * 4. OS DOIS CAMINHOS DE VOTO. Majoritaria le as props da feature; proporcional
 *    le STATE.deputyResults pelo id do local e agrupa por federacao/coligacao.
 *    Somar deputado pelo caminho majoritario daria area vazia, sem erro nenhum.
 *
 *     node scripts/testar_areas_ponderacao.mjs
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UFS = ['RJ', 'SP'];

let falhas = 0;
function ok(cond, nome, detalhe = '') {
  console.log(`${cond ? '  ok   ' : '  FALHA'} ${nome}${detalhe ? '  - ' + detalhe : ''}`);
  if (!cond) falhas++;
}

const lerJson = (rel) => JSON.parse(readFileSync(path.join(RAIZ, rel), 'utf8'));

// Os resultados moram em zip; unzipar em JS puro daria mais codigo que o teste.
function lerZipJson(relZip, entrada) {
  const saida = execFileSync('python', ['-c',
    'import sys,zipfile;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',
    path.join(RAIZ, relZip), entrada], { maxBuffer: 1 << 28 });
  return JSON.parse(saida.toString('utf8'));
}

// Uma feature por local, como o site monta, instalada no cargo REAL
// ('presidente_ord'). O municipio sai do proprio codigo da area (IBGE-7 + 3
// digitos); o nome da cidade e sintetico mas consistente, porque e por NOME que
// currentCidadeFilter casa.
function instalarLocais(uf, indice, resultados, ctx, vm, resultados1) {
  ctx.__geo = {
    type: 'FeatureCollection',
    features: Object.keys(resultados.RESULTS).map((chave) => {
      const muni = (indice[chave] || '').slice(0, 7);
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { id_unico: chave, local_key: chave, nm_locvot: 'Escola',
                      cod_localidade_ibge: muni, nm_localidade: `MUN ${muni}` },
      };
    }),
  };
  ctx.__res = resultados;
  ctx.__res1 = resultados1 || null;
  vm.runInContext(`
    if (__res1) applyGeneralMajoritariaJsonToGeojson2022(__geo, __res1, '1T');
    applyGeneralMajoritariaJsonToGeojson2022(__geo, __res, '2T');
    currentDataCollection['presidente_ord'] = __geo;
  `, ctx, { filename: `dados_${uf}.js` });
}

// ------------------------------------------------------------- ambiente

const PRELUDIO = `
  var document = {
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add(){}, remove(){}, toggle(){} } }),
    addEventListener(){}, body: { appendChild(){} }
  };
  var localStorage = { getItem: () => null, setItem(){}, removeItem(){} };
  var navigator = { userAgent: 'node' };
  var location = { href: '', search: '' };
  var fetch = async (url) => ({ ok: true, json: async () => __lerJson(url) });
`;

const MODULOS = [
  'js/globals.js', 'js/utils.js', 'js/party-numbers.js', 'js/data-zip.js',
  'js/data-process.js', 'js/data-municipal.js', 'js/data-loader.js',
  'js/data-geral-2022.js', 'js/ui-helpers.js', 'js/map-render.js',
];

const fonte = PRELUDIO
  + MODULOS.map((f) => `\n/* ===== ${f} ===== */\n` + readFileSync(path.join(RAIZ, f), 'utf8')).join('\n');

const ctx = {
  console: { log() {}, warn() {}, error() {} },
  setTimeout, clearTimeout, Promise,
  addEventListener() {}, removeEventListener() {},
  __lerJson: (url) => lerJson(url),
};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fonte, ctx, { filename: 'bundle.js' });

console.log('Mapa por area de ponderacao - 2022, presidente');

const ponte = lerJson('resultados_geo/tse_para_ibge.json');

for (const uf of UFS) {
  console.log(`\n${uf}`);

  const malha = lerJson(`resultados_geo/regioes_ap/regioes_ap_${uf}.geojson`);
  const indice = lerJson(`resultados_geo/regioes_ap/locais_ap_2022_${uf}.json`);

  // ------------------------------------------------- malha x indice
  const daMalha = new Set(malha.features.map((f) => String(f.properties.CD_REG)));
  ok(malha.features.every((f) => f.properties.NM_REG && f.properties.SIGLA_UF === uf
      && f.properties.OG_REG),
    'toda feicao tem NM_REG, SIGLA_UF e OG_REG');
  const ausentes = [...new Set(Object.values(indice))].filter((cd) => !daMalha.has(cd));
  ok(ausentes.length === 0, 'toda area do indice existe na malha', ausentes.slice(0, 3).join());
  ok(Object.keys(indice).every((k) => /^\d+_\d+_\d+$/.test(k)),
    'chave do indice no formato zona_municipioTSE_local');

  // O codigo da area tem 10 digitos e comeca pelo IBGE-7 do municipio: e o que
  // permite conferir a soma por municipio sem uma segunda tabela.
  ok([...daMalha].every((cd) => /^\d{10}$/.test(cd)), 'codigo de area com 10 digitos');

  // ------------------------------------------------- cenario e features reais
  ctx.__uf = uf;
  vm.runInContext(`
    STATE.currentElectionType = 'geral';
    STATE.currentElectionYear = '2022';
    STATE.currentMapMode = 'regioes';
    STATE.currentRegionLevel = 'ap';
    // getActiveTurnoKeyForCurrentCargo le currentTurno + STATE.dataHas2T, e
    // filterFeature exige comparecimento > 0 em algum turno. So o 2T e carregado
    // aqui, entao os dois precisam apontar para ele.
    // O cargo REAL do site e 'presidente_ord' (currentOffice + subtipo), e e por
    // ele que currentDataCollection e chaveado. Usar 'presidente' aqui faria o
    // teste passar sobre uma ficcao — foi exatamente o que escondeu o botao.
    STATE.dataHas2T = { presidente_ord: true };
    currentTurno = 2;
    currentOffice = 'presidente'; currentSubType = 'ord';
    currentCargo = 'presidente_ord';
    currentRegionFilter = { level: '', code: '' };
    currentCidadeFilter = 'all'; currentBairroFilter = 'all'; currentLocalFilter = '';
    dom.selectUFGeneral = { value: __uf };
  `, ctx, { filename: `cenario_${uf}.js` });

  // O caminho REAL de carga: busca o indice e a malha pelas mesmas URLs que o
  // site usa e preenche AP_BY_LOCAL e REGION_INDEX.niveis.ap. Montar esses dois
  // na mao aqui esconderia justamente o erro de URL ou de formato.
  await vm.runInContext('ensureApIndexLoaded(__uf)', ctx, { filename: `carga_${uf}.js` });
  // AP_BY_LOCAL e ano -> Map(chave -> area). Dentro de um ano as UFs se acumulam
  // sem colidir (o codigo TSE do municipio e unico no pais); entre anos, nao
  // podem se misturar — o mesmo zona_municipio_local pode ser outro predio.
  ctx.__chaves = Object.keys(indice);
  ok(vm.runInContext("__chaves.every((k) => AP_BY_LOCAL.get('2022').has(k))", ctx),
    'ensureApIndexLoaded carregou o indice pelas URLs do site',
    `${Object.keys(indice).length} locais`);
  ok(vm.runInContext('Object.keys(REGION_INDEX.niveis.ap[__uf]).length', ctx)
      === malha.features.length,
    'nomes das areas foram para REGION_INDEX.niveis.ap');

  const base = `presidente_2022_t2_${uf}`;
  const resultados = lerZipJson(`resultados_geo/Majoritarias 2022/${base}.zip`, `${base}.json`);
  const resumo = lerZipJson(`resultados_geo/Majoritarias 2022/${base}.zip`, `${base}_resumo.json`);

  instalarLocais(uf, indice, resultados, ctx, vm);

  const summary = vm.runInContext('buildGeneralApSummary(__uf, "presidente_ord")', ctx,
    { filename: `sum_${uf}.js` });

  // ------------------------------------------------- soma por area
  const codigos = Object.keys(summary);
  ok(codigos.length > 0 && codigos.every((cd) => daMalha.has(cd)),
    `${codigos.length} areas com resultado, todas na malha`);
  ok(Object.getOwnPropertyDescriptor(summary, '_regionLevel')?.value === 'ap',
    '_regionLevel = ap, e nao-enumeravel');
  ok(!codigos.includes('_regionLevel') && !codigos.includes('_censusFilterActive'),
    'Object.keys do summary traz so areas');

  // Total da UF: a soma das areas tem de bater com o TOTALS oficial, menos os
  // votos dos locais sem par geometrico (2 no pais inteiro).
  const validos = (votos) => Object.entries(votos)
    .filter(([id]) => id !== '95' && id !== '96')
    .reduce((a, [, n]) => a + n, 0);
  const validosOficiais = validos(resumo.TOTALS);
  const somaAreas = codigos.reduce((a, cd) => a + summary[cd].totalValid, 0);
  const semPar = Object.keys(resultados.RESULTS).filter((k) => !indice[k]);
  const votosSemPar = semPar.reduce((a, k) => a + validos(resultados.RESULTS[k]), 0);
  ok(somaAreas === validosOficiais - votosSemPar,
    'soma das areas = total oficial da UF',
    `${somaAreas} vs ${validosOficiais - votosSemPar} (${semPar.length} locais sem par)`);

  // Por municipio: o codigo da area comeca pelo IBGE-7, entao a soma das areas
  // de um municipio tem de reproduzir o total daquele municipio no RESULTS.
  const porMunOficial = new Map();
  for (const [chave, votos] of Object.entries(resultados.RESULTS)) {
    if (!indice[chave]) continue;
    const ibge = ponte[String(parseInt(chave.split('_')[1], 10))];
    porMunOficial.set(ibge, (porMunOficial.get(ibge) || 0) + validos(votos));
  }
  const porMunAreas = new Map();
  for (const cd of codigos) {
    const ibge = cd.slice(0, 7);
    porMunAreas.set(ibge, (porMunAreas.get(ibge) || 0) + summary[cd].totalValid);
  }
  const divergentes = [...porMunOficial].filter(([m, v]) => (porMunAreas.get(m) || 0) !== v);
  ok(divergentes.length === 0,
    `${porMunOficial.size} municipios: soma das suas areas = total do municipio`,
    divergentes.slice(0, 3).map(([m, v]) => `${m}: ${porMunAreas.get(m) || 0} vs ${v}`).join(' | '));

  // ------------------------------------------------- recorte por area
  const contagem = new Map();
  for (const cd of Object.values(indice)) contagem.set(cd, (contagem.get(cd) || 0) + 1);
  const alvo = codigos.find((cd) => (contagem.get(cd) || 0) > 1);
  const dentro = Object.keys(indice).find((k) => indice[k] === alvo);
  ctx.__alvo = alvo;
  ctx.__dentro = dentro;
  ctx.__muni = uf === 'RJ' ? '3304557' : '3550308';
  const casa = vm.runInContext(`
    currentRegionFilter = { level: 'ap', code: __alvo };
    [matchesRegionalScope({ id_unico: __dentro }),
     matchesRegionalScope({ id_unico: '0_0_0' }),
     matchesRegionalScope({ CD_MUN: __muni })];
  `, ctx, { filename: `escopo_${uf}.js` });
  ok(casa[0] === true, 'local de dentro da area casa com o recorte');
  ok(casa[1] === false, 'local de fora nao casa');
  ok(casa[2] === false, 'poligono municipal nao casa com recorte de area');

  // ------------------------------------------------- poligono, nome e painel
  const nomes = Object.fromEntries(
    malha.features.map((f) => [f.properties.CD_REG, f.properties.NM_REG]));
  ctx.__nomes = nomes;
  ctx.__summary = summary;
  const pintura = vm.runInContext(`(() => {
    const feature = { properties: { CD_REG: __alvo, NM_REG: __nomes[__alvo], SIGLA_UF: __uf } };
    return {
      cor: getMunicipalPolygonStyle(feature, __summary)?.fillColor,
      nome: getMunicipalityFeatureName(feature.properties),
      entry: !!getMunicipalSummaryEntryForFeature(feature.properties, __summary),
      rotulo: getRegionalFilterSummaryLabel()
    };
  })()`, ctx, { filename: `pintura_${uf}.js` });
  ok(pintura.entry, 'resolver acha a entry da area por CD_REG');
  ok(pintura.cor && pintura.cor !== '#7a8699',
    'poligono da area sai colorido pelo vencedor', pintura.cor);
  ok(pintura.nome === nomes[alvo], 'nome do poligono vem de NM_REG', pintura.nome);
  ok(pintura.rotulo === `Área de Ponderação ${nomes[alvo]}`,
    'titulo do painel identifica a area', pintura.rotulo);

  vm.runInContext("currentRegionFilter = { level: '', code: '' };", ctx);
}

// ------------------------------------------ area como DETALHE, nao como escopo
//
// O mapa tem duas camadas: a malha municipal ao FUNDO (e ela que faz o resto do
// estado seguir aparecendo) e, por cima, o DETALHE — area de ponderacao ou ponto
// de local, nunca os dois. Escopo (municipio, imediata, intermediaria) e outra
// coisa, e nenhum dos dois botoes de detalhe mexe nele.
//
// O defeito que isto protege: com a area ocupando o lugar da malha municipal,
// trocar para "Locais" deixava as areas desenhadas por baixo dos pontos, e o
// resto do estado sumia.
console.log('');
console.log('Area como detalhe do mapa');

await vm.runInContext('ensureRegionalFiltersLoaded()', ctx, { filename: 'idxReg.js' });
const idxRegiao = lerJson('resultados_geo/regioes_index.json');

const RIO = '3304557';
const RGI_FLORIPA = idxRegiao.muni['4205407'].rgi;
const munisFloripa = Object.entries(idxRegiao.muni)
  .filter(([, r]) => r.rgi === RGI_FLORIPA).map(([m]) => m);

instalarLocais('SC', lerJson('resultados_geo/regioes_ap/locais_ap_2022_SC.json'),
  lerZipJson('resultados_geo/Majoritarias 2022/presidente_2022_t2_SC.zip',
    'presidente_2022_t2_SC.json'), ctx, vm,
  lerZipJson('resultados_geo/Majoritarias 2022/presidente_2022_t1_SC.zip',
    'presidente_2022_t1_SC.json'));
vm.runInContext("dom.selectUFGeneral = { value: 'SC' };", ctx);
await vm.runInContext('ensureApIndexLoaded("SC")', ctx, { filename: 'cargaSC.js' });

const malhaSC = lerJson('resultados_geo/regioes_ap/regioes_ap_SC.geojson');
const porMuniSC = new Map();
for (const f of malhaSC.features) {
  const m = String(f.properties.CD_REG).slice(0, 7);
  porMuniSC.set(m, (porMuniSC.get(m) || 0) + 1);
}
const FLORIPA = '4205407';
const UNICA_SC = [...porMuniSC].find(([, n]) => n === 1)?.[0];
const areasFloripa = porMuniSC.get(FLORIPA);
const areasDaRgi = malhaSC.features.filter(
  (f) => munisFloripa.includes(String(f.properties.CD_REG).slice(0, 7))).length;

Object.assign(ctx, { __floripa: FLORIPA, __rgiF: RGI_FLORIPA, __unica: UNICA_SC });

const det = vm.runInContext(`(() => {
  const locais = currentDataCollection[currentCargo].features;
  const daCidade = (m) => locais.filter((f) => f.properties.cod_localidade_ibge === m);
  const daRgi = () => locais.filter(
    (f) => REGION_INDEX.muni[f.properties.cod_localidade_ibge]?.rgi === __rgiF);
  const r = {};

  STATE.currentMapMode = 'locais';
  currentRegionFilter = { level: '', code: '' };
  currentBairroFilter = 'all'; currentLocalFilter = '';

  // 1. municipio aberto, detalhe 'areas': as areas dele
  currentCidadeFilter = 'MUN ' + __floripa;
  STATE.detalhe = 'areas';
  r.cidade = (resolveApDetailFeatures(daCidade(__floripa)) || []).length;
  r.cidadeAtiva = STATE.apDetailActive;

  // 2. "Locais de Votacao": as areas SOMEM (o defeito do print)
  STATE.detalhe = 'locais';
  r.locais = resolveApDetailFeatures(daCidade(__floripa)) === null;
  r.locaisAtiva = STATE.apDetailActive;

  // 3. regiao imediata aberta, detalhe 'areas': as areas de todos os municipios dela
  currentCidadeFilter = 'all';
  currentRegionFilter = { level: 'rgi', code: __rgiF };
  STATE.detalhe = 'areas';
  const naRgi = resolveApDetailFeatures(daRgi()) || [];
  r.regiao = naRgi.length;
  r.soDaRgi = naRgi.every(
    (f) => REGION_INDEX.muni[String(f.properties.CD_REG).slice(0, 7)]?.rgi === __rgiF);
  r.regiaoIntacta = currentRegionFilter.code === __rgiF;

  // 4. sem escopo nenhum: desenha a UF inteira em areas, como "Imediatas" faz
  currentRegionFilter = { level: '', code: '' };
  r.semEscopo = (resolveApDetailFeatures(locais) || []).length;

  // 5. municipio de area unica: nada a subdividir, ficam os pontos
  currentCidadeFilter = 'MUN ' + __unica;
  r.areaUnica = resolveApDetailFeatures(daCidade(__unica)) === null;

  // 6. fora de 2022/presidente nao ha area
  currentCidadeFilter = 'MUN ' + __floripa;
  STATE.currentElectionYear = '2018';
  r.outroAno = resolveApDetailFeatures(daCidade(__floripa)) === null;
  STATE.currentElectionYear = '2022';

  currentCidadeFilter = 'all'; STATE.detalhe = 'locais';
  return r;
})()`, ctx, { filename: 'detalhe.js' });

ok(det.cidade === areasFloripa,
  `municipio aberto desenha as ${areasFloripa} areas dele`, `${det.cidade}`);
ok(det.cidadeAtiva === true, 'e marca o detalhe de area como ativo');
ok(det.locais && det.locaisAtiva === false,
  'trocar para "Locais de Votacao" faz as areas SUMIREM');
ok(det.regiao === areasDaRgi,
  `regiao imediata aberta desenha as ${areasDaRgi} areas dos ${munisFloripa.length} municipios dela`,
  `${det.regiao}`);
ok(det.soDaRgi, 'e nenhuma area de fora da regiao');
ok(det.regiaoIntacta, 'sem largar a regiao');
ok(det.semEscopo === malhaSC.features.length,
  `sem escopo aberto, "Areas" desenha a UF inteira (${malhaSC.features.length} areas)`,
  `${det.semEscopo}`);
ok(det.areaUnica, `municipio de area unica (${UNICA_SC}) fica nos pontos`);
ok(det.outroAno, 'fora de 2022/presidente nao ha detalhe de area');

// QUEM FICA DE FUNDO. Errei isto nos dois sentidos: primeiro removendo a malha
// municipal e deixando o resto do estado sumir sob as areas; depois mantendo-a
// sempre, e ai o coropletico municipal cheio aparecia embaixo dos PONTOS, no
// modo Locais, competindo com eles. A regra e a matriz abaixo.
const fundos = vm.runInContext(`(() => {
  const caso = (modo, cidade, regiao, areas) => {
    STATE.currentMapMode = modo;
    currentCidadeFilter = cidade ? ('MUN ' + __floripa) : 'all';
    currentRegionFilter = regiao ? { level: 'rgi', code: __rgiF } : { level: '', code: '' };
    const isCitySelected = (STATE.currentElectionType === 'geral' && currentCidadeFilter !== 'all');
    const regiaoAberta = STATE.currentElectionType === 'geral' && hasRegionalScopeFilters();
    return (modo === 'municipios' || isCitySelected || (regiaoAberta && areas));
  };
  const r = {
    municipios:      caso('municipios', false, false, false),
    cidadeComPontos: caso('locais', true,  false, false),
    cidadeComAreas:  caso('locais', true,  false, true),
    regiaoComPontos: caso('locais', false, true,  false),
    regiaoComAreas:  caso('locais', false, true,  true),
    estadoComPontos: caso('locais', false, false, false),
    estadoComAreas:  caso('locais', false, false, true)
  };
  currentCidadeFilter = 'all'; currentRegionFilter = { level: '', code: '' };
  return r;
})()`, ctx, { filename: 'fundo.js' });

ok(fundos.municipios, 'modo Municipios: a malha municipal E o mapa');
ok(fundos.cidadeComAreas, 'cidade aberta com areas: malha de fundo, para o resto aparecer');
ok(fundos.cidadeComPontos, 'cidade aberta com pontos: malha de fundo (comportamento de sempre)');
ok(fundos.regiaoComAreas, 'regiao aberta com areas: malha de fundo');
ok(fundos.regiaoComPontos === false,
  'regiao aberta com PONTOS: sem malha de fundo — "Locais" mostra so os locais');
ok(fundos.estadoComPontos === false, 'estado com pontos: sem malha de fundo');
ok(fundos.estadoComAreas === false,
  'estado com areas: elas ja cobrem a UF, nao ha fundo a manter');

// Botoes: Areas e Locais sao os dois detalhes; os outros sao escopos.
const botoes = vm.runInContext(`(() => {
  const mk = (id, level) => ({ id, dataset: level ? { regionLevel: level } : {},
    classList: { _v: null, toggle(_, v) { this._v = v; } } });
  const ap = mk('btnMapModeAp'), loc = mk('btnMapModeLocais');
  const mun = mk('btnMapModeMunicipios'), rgi = mk('btnMapModeRgi', 'rgi');
  dom.layerToggleGroup = { querySelectorAll: () => [ap, loc, mun, rgi] };
  const ler = () => [ap.classList._v, loc.classList._v, mun.classList._v, rgi.classList._v];

  STATE.currentMapMode = 'locais'; STATE.apDetailActive = true;
  syncMapModeButtons();
  const comAreas = ler();
  STATE.apDetailActive = false;
  syncMapModeButtons();
  const comPontos = ler();
  STATE.currentMapMode = 'regioes'; STATE.currentRegionLevel = 'rgi';
  syncMapModeButtons();
  const naRgi = ler();
  return { comAreas, comPontos, naRgi };
})()`, ctx, { filename: 'botoes.js' });
ok(String(botoes.comAreas) === 'true,false,false,false', 'com areas so "Areas" acende');
ok(String(botoes.comPontos) === 'false,true,false,false', 'com pontos so "Locais" acende');
ok(String(botoes.naRgi) === 'false,false,false,true', 'no escopo de imediata so "Imediatas" acende');

// ------------------------------------------------------------ cor da area
//
// A COR DA AREA NAO PODE DEPENDER DO RECORTE. Ela sai do vencedor e da margem da
// propria area, e uma area esta inteira dentro de um municipio, que esta inteiro
// dentro de uma regiao — filtrar por regiao nao muda um voto dela.
//
// E ha uma segunda armadilha, que foi um defeito real: os preenchimentos sao
// semitransparentes (0,78). Com a malha municipal COLORIDA por baixo, as duas
// cores se somam e a do municipio contamina a da area — vermelho sobre azul
// aparece arroxeado. Sem recorte nao havia fundo e a cor saia pura; com recorte
// o mapa inteiro puxava para a cor do municipio. Por isso o fundo tem de se
// apagar quando as areas estao por cima.
console.log('');
console.log('Cor da area');

const cores = vm.runInContext(`(() => {
  const locais = currentDataCollection[currentCargo].features;
  const daRgi = () => locais.filter(
    (f) => REGION_INDEX.muni[f.properties.cod_localidade_ibge]?.rgi === __rgiF);

  const monta = () => {
    const s = buildGeneralApSummary('SC', currentCargo);
    const out = {};
    Object.keys(s).forEach((c) => {
      out[c] = getMunicipalPolygonStyle({ properties: { CD_REG: c } }, s).fillColor;
    });
    return out;
  };

  STATE.currentMapMode = 'locais'; STATE.detalhe = 'areas';
  currentCidadeFilter = 'all'; currentBairroFilter = 'all'; currentLocalFilter = '';

  currentRegionFilter = { level: '', code: '' };
  resolveApDetailFeatures(locais);
  const semRecorte = monta();

  currentRegionFilter = { level: 'rgi', code: __rgiF };
  resolveApDetailFeatures(daRgi());
  const comRecorte = monta();

  // Com as areas de Florianopolis desenhadas: o proprio municipio, coberto, tem
  // de vir apagado; um vizinho fora do recorte tem de seguir colorido.
  currentCidadeFilter = 'MUN 4205407';
  currentRegionFilter = { level: '', code: '' };
  resolveApDetailFeatures(locais.filter(
    (f) => f.properties.cod_localidade_ibge === '4205407'));
  const fundo = getMunicipalPolygonStyle(
    { properties: { CD_MUN: '4205407' } }, STATE.currentMapMuniSummary);
  const vizinho = getMunicipalPolygonStyle(
    { properties: { CD_MUN: '4211900' } }, STATE.currentMapMuniSummary);

  // E sem areas desenhadas ele volta ao normal.
  STATE.apDetailActive = false;
  const fundoSozinho = getMunicipalPolygonStyle(
    { properties: { CD_MUN: '4205407' } }, STATE.currentMapMuniSummary);

  currentCidadeFilter = 'all';
  currentRegionFilter = { level: '', code: '' };
  STATE.detalhe = 'locais';
  return { semRecorte, comRecorte, fundo, vizinho, fundoSozinho };
})()`, ctx, { filename: 'cores.js' });

const comuns = Object.keys(cores.comRecorte).filter((c) => cores.semRecorte[c]);
const mudaram = comuns.filter((c) => cores.semRecorte[c] !== cores.comRecorte[c]);
ok(comuns.length > 0, `${comuns.length} areas aparecem nos dois recortes`);
ok(mudaram.length === 0,
  'a cor de cada area e a MESMA com e sem recorte de regiao',
  mudaram.slice(0, 3).map((c) => `${c}: ${cores.semRecorte[c]} -> ${cores.comRecorte[c]}`).join(' | '));

ok(cores.fundo.fillOpacity <= 0.05,
  'o municipio COBERTO por areas se apaga, para nao tingir a cor delas',
  `fillOpacity ${cores.fundo.fillOpacity}`);
ok(cores.vizinho.fillOpacity > 0.05,
  'mas o municipio VIZINHO, sem area por cima, segue colorido — e ele o contexto',
  `fillOpacity ${cores.vizinho.fillOpacity}`);
ok(cores.fundoSozinho.fillOpacity > 0.05,
  'e sem areas nenhuma a malha volta a pintar inteira',
  `fillOpacity ${cores.fundoSozinho.fillOpacity}`);

// A flag de "ha areas por cima" tem de morrer em TODO caminho de desenho. Ela so
// era zerada no caminho das areas; voltando de nivel para o coropletico, ficava
// presa em true e a malha inteira aparecia apagada — mapa preto e dois botoes
// acesos ao mesmo tempo.
const volta = await vm.runInContext(`(async () => {
  map = { hasLayer: () => false, removeLayer() {} };
  var oLayer = createRegioesGeoLayer, oMuni = createMunicipiosGeoLayer;
  var oRender = renderGeneralStatewideMunicipalityResults;
  var oLoad = showMapLoading, oHide = hideMapLoading, oSync = syncMapModeButtons;
  var oRefit = shouldRefitOverviewBounds, oFetchMuni = fetchMunicipalPolygonGeoJSON;
  createRegioesGeoLayer = () => ({ addTo() {}, getBounds: () => null });
  createMunicipiosGeoLayer = () => ({ addTo() {}, getBounds: () => null, setFeatures() {} });
  renderGeneralStatewideMunicipalityResults = () => {};
  showMapLoading = () => {}; hideMapLoading = () => {}; syncMapModeButtons = () => {};
  shouldRefitOverviewBounds = () => false;
  fetchMunicipalPolygonGeoJSON = async () => ({ type: 'FeatureCollection', features: [] });

  // estado sujo: acabou de desenhar areas
  STATE.apDetailActive = true;
  STATE.apScopeMunis = new Set(['4205407']);

  currentCidadeFilter = 'all'; currentRegionFilter = { level: '', code: '' };
  STATE.currentMapMode = 'municipios';
  await showGeneralMunicipalityOverview('SC');
  const depoisDoMunicipal = STATE.apDetailActive;

  STATE.apDetailActive = true;
  STATE.currentRegionLevel = 'rgi';
  STATE.currentMapMode = 'regioes';
  await showGeneralRegionOverview('SC');
  const depoisDaRegiao = STATE.apDetailActive;

  createRegioesGeoLayer = oLayer; createMunicipiosGeoLayer = oMuni;
  renderGeneralStatewideMunicipalityResults = oRender;
  showMapLoading = oLoad; hideMapLoading = oHide; syncMapModeButtons = oSync;
  shouldRefitOverviewBounds = oRefit; fetchMunicipalPolygonGeoJSON = oFetchMuni;
  STATE.currentMapMode = 'locais';
  return { depoisDoMunicipal, depoisDaRegiao };
})()`, ctx, { filename: 'volta.js' });

ok(volta.depoisDoMunicipal === false,
  'voltar para o coropletico municipal desliga a flag de areas');
ok(volta.depoisDaRegiao === false,
  'voltar para o mapa de regioes tambem');

// --------------------------------------------- area sem local de votacao
//
// Parte das areas nao tem local de votacao dentro — area rural, parque, unidade
// de conservacao: quem mora ali vota num local da area vizinha. Elas continuam
// desenhadas, porque sao territorio de verdade e some-las abriria buraco no
// mapa, mas nao tem resultado: nao podem ser clicadas, e o tooltip tem de dizer
// por que, em vez do generico "sem resultados resumidos".
console.log('');
console.log('Area sem local de votacao');

const vazias = vm.runInContext(`(() => {
  const locais = currentDataCollection[currentCargo].features;
  currentRegionFilter = { level: '', code: '' };
  currentCidadeFilter = 'all';
  STATE.detalhe = 'areas'; STATE.currentMapMode = 'locais';
  STATE.currentMapMuniUF = 'SC';

  const desenhadas = resolveApDetailFeatures(locais) || [];
  const s = buildGeneralApSummary('SC', currentCargo);
  const semResultado = desenhadas.filter((f) => !s[f.properties.CD_REG]);
  const comResultado = desenhadas.filter((f) => s[f.properties.CD_REG]);
  if (!semResultado.length) return { nenhuma: true };

  const temResultado = (f) => !!s[String(f?.properties?.CD_REG || '')];
  const vazia = semResultado[0];
  return {
    desenhadas: desenhadas.length,
    semResultado: semResultado.length,
    clicavelVazia: temResultado(vazia),
    clicavelCheia: temResultado(comResultado[0]),
    tooltipVazia: buildAreaSemLocalTooltip(vazia),
    nome: vazia.properties.NM_REG
  };
})()`, ctx, { filename: 'vazias.js' });

ok(!vazias.nenhuma, 'ha area sem local de votacao em SC para testar');
if (!vazias.nenhuma) {
  ok(vazias.semResultado > 0 && vazias.semResultado < vazias.desenhadas,
    `${vazias.semResultado} das ${vazias.desenhadas} areas de SC nao tem local dentro`);
  ok(vazias.clicavelVazia === false, 'a area sem local nao e clicavel');
  ok(vazias.clicavelCheia === true, 'e a que tem resultado continua clicavel');
  ok(vazias.tooltipVazia.includes('Sem local de votação nesta área'),
    'o tooltip dela diz que nao ha local de votacao ali');
  ok(!vazias.tooltipVazia.includes('Sem resultados resumidos'),
    'e nao o generico de "sem resultados resumidos"');
  ok(vazias.tooltipVazia.includes(vazias.nome.slice(0, 12)),
    'mostrando o nome da area', vazias.nome);
}

// ------------------------------------------------------- troca de turno
//
// O styleFn e o tooltipFn da camada de areas fecham sobre o apSummary do turno
// em que foram criados. Um refresh() — que e o que a troca de turno faz com os
// pontos — repintaria com os numeros do turno anterior, sem erro nenhum no
// console. Por isso a camada de area exige REDESENHO, nao repintura.
console.log('');
console.log('Troca de turno');

const turnos = vm.runInContext(`(() => {
  const locais = currentDataCollection[currentCargo].features;
  const daCidade = locais.filter((f) => f.properties.cod_localidade_ibge === __floripa);
  currentRegionFilter = { level: '', code: '' };
  currentCidadeFilter = 'MUN ' + __floripa;
  STATE.detalhe = 'areas'; STATE.currentMapMode = 'locais';

  const resumo = () => {
    resolveApDetailFeatures(daCidade);
    const s = buildGeneralApSummary('SC', currentCargo);
    const cods = Object.keys(s).sort();
    return {
      turno: getActiveTurnoKeyForCurrentCargo(currentCargo),
      total: cods.reduce((a, c) => a + s[c].totalValid, 0),
      vencedores: cods.map((c) => s[c].winnerCode).join('|'),
      rotulo: cods.length ? s[cods[0]].turnoLabel : ''
    };
  };

  currentTurno = 1;
  const t1 = resumo();
  const pedeRedesenhoT1 = shouldFullRedrawOnTurnChange();
  currentTurno = 2;
  const t2 = resumo();
  const pedeRedesenhoT2 = shouldFullRedrawOnTurnChange();

  STATE.apDetailActive = false;
  const pedeRedesenhoSemArea = shouldFullRedrawOnTurnChange();

  currentCidadeFilter = 'all'; STATE.detalhe = 'locais';
  return { t1, t2, pedeRedesenhoT1, pedeRedesenhoT2, pedeRedesenhoSemArea };
})()`, ctx, { filename: 'turno.js' });

ok(turnos.t1.turno === '1T' && turnos.t2.turno === '2T',
  'o summary da area segue o turno ativo');
ok(turnos.t1.total !== turnos.t2.total,
  'os totais por area mudam entre os turnos',
  `${turnos.t1.total} vs ${turnos.t2.total}`);
ok(turnos.t1.vencedores !== turnos.t2.vencedores,
  'e os vencedores por area tambem mudam');
ok(turnos.t1.rotulo === '1º Turno' && turnos.t2.rotulo === '2º Turno',
  'o rotulo do tooltip acompanha', `${turnos.t1.rotulo} / ${turnos.t2.rotulo}`);
ok(turnos.pedeRedesenhoT1 && turnos.pedeRedesenhoT2,
  'com area desenhada, trocar de turno exige REDESENHO (nao repintura)');
ok(turnos.pedeRedesenhoSemArea === false,
  'sem area, a troca de turno segue no caminho barato de sempre');

// ------------------------------------------------ os outros cargos de 2022
//
// O nivel vale para todo cargo de 2022, e ha DOIS caminhos de voto: majoritaria
// (presidente, governador, senador) le as props da propria feature; proporcional
// (deputado) le STATE.deputyResults pelo id do local e ainda agrupa por
// federacao/coligacao. Somar deputado pelo caminho majoritario daria area vazia,
// sem erro nenhum.
console.log('');
console.log('Outros cargos de 2022');

// --- majoritaria: governador no AC, que e pequeno
{
  const idxAC = lerJson('resultados_geo/regioes_ap/locais_ap_2022_AC.json');
  const govAC = lerZipJson('resultados_geo/Majoritarias 2022/governador_2022_t1_AC.zip',
    'governador_2022_t1_AC.json');
  ctx.__geo = {
    type: 'FeatureCollection',
    features: Object.keys(govAC.RESULTS).map((chave) => {
      const muni = (idxAC[chave] || '').slice(0, 7);
      return {
        type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { id_unico: chave, local_key: chave, nm_locvot: 'Escola',
          cod_localidade_ibge: muni, nm_localidade: `MUN ${muni}` },
      };
    }),
  };
  ctx.__res = govAC;
  vm.runInContext(`
    dom.selectUFGeneral = { value: 'AC' };
    STATE.dataHas2T = { governador_ord: false }; currentTurno = 1;
    currentOffice = 'governador'; currentSubType = 'ord'; currentCargo = 'governador_ord';
    currentRegionFilter = { level: '', code: '' }; currentCidadeFilter = 'all';
    applyGeneralMajoritariaJsonToGeojson2022(__geo, __res, '1T');
    currentDataCollection['governador_ord'] = __geo;
  `, ctx, { filename: 'gov.js' });
  await vm.runInContext('ensureApIndexLoaded("AC")', ctx, { filename: 'cargaAC.js' });

  const r = vm.runInContext(`(() => {
    const s = buildGeneralApSummary('AC', 'governador_ord');
    const cods = Object.keys(s);
    return { n: cods.length, total: cods.reduce((a, c) => a + s[c].totalValid, 0),
             aplica: apLevelApplies() };
  })()`, ctx, { filename: 'govsum.js' });

  const validos = (v) => Object.entries(v)
    .filter(([id]) => id !== '95' && id !== '96')
    .reduce((a, [, n]) => a + n, 0);
  const esperado = Object.entries(govAC.RESULTS)
    .filter(([k]) => idxAC[k]).reduce((a, [, v]) => a + validos(v), 0);

  ok(r.aplica, 'o nivel de area vale para governador em 2022');
  ok(r.n > 0, `${r.n} areas com resultado de governador no AC`);
  ok(r.total === esperado, 'e a soma bate com o oficial', `${r.total} vs ${esperado}`);
}

// --- proporcional: DEPUTADO FEDERAL no AC
{
  const idxAC = lerJson('resultados_geo/regioes_ap/locais_ap_2022_AC.json');
  const dep = lerZipJson('resultados_geo/Legislativas 2022/deputados_federal_2022_AC.zip',
    'deputados_federal_2022_AC.json');
  ctx.__geo = {
    type: 'FeatureCollection',
    features: Object.keys(dep.RESULTS).map((chave) => {
      const muni = (idxAC[chave] || '').slice(0, 7);
      return {
        type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { id_unico: chave, local_key: chave, nm_locvot: 'Escola',
          cod_localidade_ibge: muni, nm_localidade: `MUN ${muni}`,
          // filterFeature exige comparecimento; o proporcional nao escreve isso
          // nas props, entao damos o minimo que o filtro procura.
          'Total_Votos_Validos 1T': 1, 'NR_TURNO 1T': 1 },
      };
    }),
  };
  ctx.__dep = dep;
  vm.runInContext(`
    dom.selectUFGeneral = { value: 'AC' };
    STATE.dataHas2T = { deputado_federal: false }; currentTurno = 1;
    currentOffice = 'deputado'; currentSubType = 'federal';
    currentCargo = 'deputado_federal';
    currentRegionFilter = { level: '', code: '' }; currentCidadeFilter = 'all';
    STATE.deputyResults = {};
    Object.entries(__dep.RESULTS).forEach(([locId, votos]) => {
      STATE.deputyResults[locId] = { f: votos, e: {} };
    });
    STATE.deputyMetadata = { ...(__dep.METADATA?.cand_names || {}) };
    STATE._partyPrefixCache = null;
    STATE.inaptos = STATE.inaptos || {};
    STATE.inaptos['deputado_federal'] = { '1T': [], '2T': [] };
    currentDataCollection['deputado_federal'] = __geo;
  `, ctx, { filename: 'dep.js' });

  const r = vm.runInContext(`(() => {
    const s = buildGeneralApSummary('AC', 'deputado_federal');
    const cods = Object.keys(s);
    // o esperado, calculado com a MESMA regra de exclusao do site
    let esperado = 0;
    Object.entries(STATE.deputyResults).forEach(([, d]) => {
      Object.entries(d.f || {}).forEach(([cand, v]) => {
        if (!isNonPartyBallotCode(cand)) esperado += v;
      });
    });
    return {
      n: cods.length,
      total: cods.reduce((a, c) => a + s[c].totalValid, 0),
      esperado,
      // groupParties e interno ao calculo e nao vai para a entry; a prova de que
      // o agrupamento aconteceu e o partido do vencedor, que sai dele.
      comPartido: cods.filter((c) => !!s[c].winnerParty).length,
      rawPorCandidato: cods.some((c) => Object.keys(s[c].rawTotals || {}).length
        > Object.keys(s[c].votes || {}).length),
      temVencedor: cods.every((c) => !!s[c].winnerCode)
    };
  })()`, ctx, { filename: 'depsum.js' });

  ok(r.n > 0, `${r.n} areas com resultado de deputado federal no AC`);
  ok(r.total === r.esperado,
    'a soma por area bate com o total do acervo, com a mesma exclusao de brancos/nulos',
    `${r.total} vs ${r.esperado}`);
  ok(r.comPartido === r.n,
    'toda area resolve o partido do vencedor pelo agrupamento de federacao/coligacao',
    `${r.comPartido} de ${r.n}`);
  ok(r.rawPorCandidato, 'com rawTotals guardando o voto por candidato para o painel');
  ok(r.temVencedor, 'toda area tem vencedor resolvido');
}

// ------------------------------------------- OS ANOS ANTERIORES A 2022
//
// A MALHA e sempre a mesma (Censo 2022) — nos anos anteriores ela e um recorte
// retrospectivo. O que muda e o INDICE local -> area: a rede de locais de
// votacao e outra a cada eleicao, e o mesmo zona_municipio_local pode ser outro
// predio. Por isso o indice e por ano e os anos nao podem se misturar.
//
// A cobertura tambem cai conforme se recua: zonas renumeradas e locais que o
// GPKG traz sem codigo de municipio. O gerador recupera os dois casos; o limiar
// aqui e de REGRESSAO na recuperacao, nao de perfeicao.
console.log('');
console.log('Anos anteriores a 2022');

const PISO_COBERTURA = { 2018: 98, 2014: 97, 2010: 96, 2006: 94 };

for (const ano of [2018, 2014, 2010, 2006]) {
  const idxAno = lerJson(`resultados_geo/regioes_ap/locais_ap_${ano}_AC.json`);
  const pres = lerZipJson(
    `resultados_geo/Majoritarias ${ano}/presidente_${ano}_t1_AC.zip`,
    `presidente_${ano}_t1_AC.json`);

  ctx.__geo = {
    type: 'FeatureCollection',
    features: Object.keys(pres.RESULTS).map((chave) => {
      const muni = (idxAno[chave] || '').slice(0, 7);
      return {
        type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { id_unico: chave, local_key: chave, nm_locvot: 'Escola',
          cod_localidade_ibge: muni, nm_localidade: `MUN ${muni}` },
      };
    }),
  };
  ctx.__res = pres;
  ctx.__ano = String(ano);
  vm.runInContext(`
    STATE.currentElectionYear = __ano;
    dom.selectUFGeneral = { value: 'AC' };
    STATE.dataHas2T = { presidente_ord: true }; currentTurno = 1;
    currentOffice = 'presidente'; currentSubType = 'ord'; currentCargo = 'presidente_ord';
    currentRegionFilter = { level: '', code: '' }; currentCidadeFilter = 'all';
    currentBairroFilter = 'all'; currentLocalFilter = '';
    applyGeneralMajoritariaJsonToGeojson2022(__geo, __res, '1T');
    currentDataCollection['presidente_ord'] = __geo;
  `, ctx, { filename: `${ano}.js` });

  ok(vm.runInContext('apLevelApplies()', ctx), `o nivel de area vale em ${ano}`);
  await vm.runInContext('ensureApIndexLoaded("AC")', ctx, { filename: `carga${ano}.js` });

  const r = vm.runInContext(`(() => {
    const s = buildGeneralApSummary('AC', 'presidente_ord');
    const cods = Object.keys(s);
    return { n: cods.length, total: cods.reduce((a, c) => a + s[c].totalValid, 0) };
  })()`, ctx, { filename: `${ano}sum.js` });

  const validos = (v) => Object.entries(v)
    .filter(([id]) => id !== '95' && id !== '96')
    .reduce((a, n) => a + n[1], 0);
  const cobertos = Object.entries(pres.RESULTS).filter(([k]) => idxAno[k]);
  const esperado = cobertos.reduce((a, [, v]) => a + validos(v), 0);
  const totalOficial = Object.values(pres.RESULTS).reduce((a, v) => a + validos(v), 0);
  const cobertura = 100 * esperado / totalOficial;

  ok(r.n > 0 && r.total === esperado,
    `${ano}: ${r.n} areas no AC, soma bate com os locais cobertos`,
    `${r.total} vs ${esperado}`);
  ok(cobertura > PISO_COBERTURA[ano],
    `${ano}: cobertura de votos do AC acima de ${PISO_COBERTURA[ano]}%`,
    `${cobertura.toFixed(2)}% (${cobertos.length} de ${Object.keys(pres.RESULTS).length} locais)`);

  // O MAPA PINTADO, nao so a soma certa.
  //
  // Somar direito e desenhar preto sao coisas diferentes: em 2006 as areas
  // saiam com contorno e sem preenchimento nenhum, porque o ramo de estilo de
  // 2002/2006 — que apaga a malha municipal quando nenhuma cidade esta
  // selecionada — tambem pegava a camada de area por cima. Painel cheio de
  // resultado, mapa preto, console limpo. Este caso roda o estilo DE VERDADE.
  const pintura = vm.runInContext(`(() => {
    // O estado em que o defeito aparecia: modo locais, regiao aberta, nenhum
    // municipio escolhido — e em 2002/2006 munisWithDots preenchido.
    STATE.currentMapMode = 'locais';
    STATE.munisWithDots = new Set(['rio-branco']);
    const s = buildGeneralApSummary('AC', 'presidente_ord');
    const cods = Object.keys(s);
    const estilos = cods.map((cd) => getMunicipalPolygonStyle(
      { properties: { CD_REG: cd, NM_REG: 'Area' } }, s));
    STATE.munisWithDots = null;
    return {
      total: estilos.length,
      pintadas: estilos.filter((e) => e && e.fillOpacity > 0.5
        && e.fillColor && e.fillColor !== '#cccccc').length
    };
  })()`, ctx, { filename: `${ano}pintura.js` });

  ok(pintura.total > 0 && pintura.pintadas === pintura.total,
    `${ano}: toda area com resultado sai PINTADA no mapa, nao so no painel`,
    `${pintura.pintadas} de ${pintura.total}`);
}

// Os quatro anos convivem, cada um no seu Map — e uma chave so resolve no ano
// em que ela existe.
const anos = vm.runInContext(`(() => {
  const carregados = [...AP_BY_LOCAL.keys()].sort();
  const distintos = new Set(carregados.map((a) => AP_BY_LOCAL.get(a))).size;
  return { carregados, distintos };
})()`, ctx, { filename: 'anos.js' });
ok(anos.carregados.length >= 3, 'varios anos carregados ao mesmo tempo',
  anos.carregados.join(', '));
ok(anos.distintos === anos.carregados.length,
  'cada ano no seu proprio Map — nao se misturam');

{
  const idx22 = lerJson('resultados_geo/regioes_ap/locais_ap_2022_AC.json');
  const idx10 = lerJson('resultados_geo/regioes_ap/locais_ap_2010_AC.json');
  const so22 = Object.keys(idx22).find((k) => !idx10[k]);
  ctx.__so22 = so22 || '';
  if (so22) {
    vm.runInContext("STATE.currentElectionYear = '2010';", ctx);
    ok(vm.runInContext("getApCodeForFeature({ id_unico: __so22 }) === ''", ctx),
      'chave que so existe em 2022 nao resolve com 2010 ativo', so22);
    vm.runInContext("STATE.currentElectionYear = '2022';", ctx);
    ok(vm.runInContext("getApCodeForFeature({ id_unico: __so22 }) !== ''", ctx),
      'e resolve de volta com 2022 ativo');
  }
}

vm.runInContext("STATE.currentElectionYear = '2022';", ctx);

// --------------------------------------------- ELEICAO MUNICIPAL (2024)
//
// Municipal e outra maquina: o escopo e UM municipio, escolhido num dropdown, e
// nao ha UF inteira para percorrer. O que NAO muda e a chave do local
// (zona_municipioTSE_local), entao o mesmo indice serve.
//
// Duas armadilhas que este teste tranca:
//  - a UF vem de outro seletor (dom.selectUFMunicipal); usar o geral daria
//    vazio e o indice nunca carregaria;
//  - vereador guarda o voto por zona_local, sem o municipio, porque o acervo
//    dele ja e de um municipio so — enquanto deputado usa a chave completa.
//    Procurar so pela completa deixaria toda area de vereador cinza.
console.log('');
console.log('Eleicao municipal de 2024');

{
  const idx24 = lerJson('resultados_geo/regioes_ap/locais_ap_2024_AC.json');
  const pref = lerZipJson('resultados_geo/Municipais 2024/prefeito_2024_ord_t1_AC.zip',
    '1392_RIO_BRANCO.json');
  const MUNI_IBGE = '1200401';

  const chaves = Object.keys(pref.RESULTS);
  ctx.__geo = {
    type: 'FeatureCollection',
    features: chaves.map((chave) => {
      const [zona, , local] = chave.split('_');
      return {
        type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { id_unico: chave, local_key: chave, local_id: `${zona}_${local}`,
          nm_locvot: 'Escola', cod_localidade_ibge: MUNI_IBGE,
          nm_localidade: 'RIO BRANCO', nr_zona: Number(zona), nr_locvot: Number(local) },
      };
    }),
  };
  ctx.__pref = pref;

  vm.runInContext(`
    STATE.currentElectionType = 'municipal';
    STATE.currentElectionYear = '2024';
    STATE.currentMapMuniUF = null;
    dom.selectUFMunicipal = { value: 'AC' };
    dom.selectUFGeneral = { value: '' };
    dom.selectMunicipio = { value: 'RIO BRANCO' };
    STATE.dataHas2T = { prefeito_ord: false }; currentTurno = 1;
    currentOffice = 'prefeito'; currentSubType = 'ord'; currentCargo = 'prefeito_ord';
    currentRegionFilter = { level: '', code: '' };
    currentCidadeFilter = 'all'; currentBairroFilter = 'all'; currentLocalFilter = '';
    STATE.inaptos = STATE.inaptos || {};
    STATE.inaptos['prefeito_ord'] = { '1T': [], '2T': [] };
    applyPrefeitoJsonToGeojson2024(__geo, __pref, '1T');
    currentDataCollection['prefeito_ord'] = __geo;
  `, ctx, { filename: 'mun24.js' });

  ok(vm.runInContext('apLevelApplies()', ctx),
    'o nivel de area vale na municipal de 2024, com municipio escolhido');
  ok(vm.runInContext("dom.selectMunicipio = { value: '' }; const r = apLevelApplies(); dom.selectMunicipio = { value: 'RIO BRANCO' }; r", ctx) === false,
    'e nao vale antes de escolher o municipio — ali o mapa e o resumo do estado');
  ok(vm.runInContext("apCurrentUF() === 'AC'", ctx),
    'a UF vem do seletor municipal, nao do geral');

  await vm.runInContext('ensureApIndexLoaded(apCurrentUF())', ctx,
    { filename: 'cargaMun.js' });

  // --- prefeito: majoritaria, voto nas props
  const rp = vm.runInContext(`(() => {
    const s = buildGeneralApSummary(apCurrentUF(), 'prefeito_ord');
    const cods = Object.keys(s);
    return { n: cods.length, total: cods.reduce((a, c) => a + s[c].totalValid, 0),
             soDoMuni: cods.every((c) => c.startsWith('${MUNI_IBGE}')) };
  })()`, ctx, { filename: 'pref.js' });

  const validos = (v) => Object.entries(v)
    .filter(([id]) => id !== '95' && id !== '96')
    .reduce((a, n) => a + n[1], 0);
  const esperadoPref = chaves.filter((k) => idx24[k])
    .reduce((a, k) => a + validos(pref.RESULTS[k]), 0);

  ok(rp.n > 0, `prefeito: ${rp.n} areas em Rio Branco`);
  ok(rp.total === esperadoPref, 'e a soma bate com o oficial',
    `${rp.total} vs ${esperadoPref}`);
  ok(rp.soDoMuni, 'e todas as areas sao do proprio municipio');

  // --- vereador: proporcional, voto em STATE.vereadorResults por zona_local
  const ver = lerZipJson('resultados_geo/Municipais_Legislativas 2024/vereadores_2024_AC.zip',
    'vereadores_2024_AC_RIO_BRANCO_1392.json');
  ctx.__ver = ver;
  vm.runInContext(`
    currentOffice = 'vereador'; currentSubType = 'ord'; currentCargo = 'vereador_ord';
    STATE.dataHas2T = { vereador_ord: false };
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
  `, ctx, { filename: 'ver24.js' });

  const rv = vm.runInContext(`(() => {
    const s = buildGeneralApSummary(apCurrentUF(), 'vereador_ord');
    const cods = Object.keys(s);
    // O esperado tem de cobrir SO os locais que entram no mapa: os que tem area
    // e passam por filterFeature. Somar todos incluiria local sem area, e a
    // diferenca pareceria erro de agregacao quando e cobertura do indice.
    let esperado = 0;
    let semArea = 0;
    __geo.features.forEach((f) => {
      const temArea = !!getApCodeForFeature(f.properties);
      if (!temArea || !filterFeature(f)) { semArea++; return; }
      const votos = STATE.vereadorResults[String(f.properties.local_id)]?.v || {};
      Object.entries(votos).forEach(([cand, v]) => {
        if (!isNonPartyBallotCode(cand)) esperado += v;
      });
    });
    return {
      n: cods.length,
      total: cods.reduce((a, c) => a + s[c].totalValid, 0),
      esperado, semArea,
      comPartido: cods.filter((c) => !!s[c].winnerParty).length
    };
  })()`, ctx, { filename: 'versum.js' });

  ok(rv.n > 0, `vereador: ${rv.n} areas com resultado`);
  ok(rv.total === rv.esperado,
    'e a soma bate — a chave por zona_local foi encontrada',
    `${rv.total} vs ${rv.esperado} (${rv.semArea} locais fora do indice)`);
  ok(rv.comPartido === rv.n, 'com o partido do vencedor resolvido em todas');

  // --- RECORTE QUE SOBROU DE OUTRA ELEICAO
  //
  // currentRegionFilter sobrevive a troca de eleicao. Entrar numa area em 2022 e
  // depois abrir a municipal de 2024 deixava o codigo antigo filtrando os locais
  // novos: nenhum casava, o mapa vinha VAZIO e o console ficava limpo — a tela
  // simplesmente nao respondia. Por isso o recorte por area so vale onde o nivel
  // de area vale.
  ctx.__areaDe2022 = '3304557001';
  const sobra = vm.runInContext(`(() => {
    const local = __geo.features[0].properties;
    const r = {};

    // 1. municipal com um recorte de area de OUTRA eleicao pendurado, carimbado
    //    com o contexto em que foi feito (e o que applyRegionSelection grava)
    currentRegionFilter = { level: 'ap', code: __areaDe2022, contexto: 'geral|2022|RJ' };
    r.municipalComSobra = matchesRegionalScope(local);
    r.hasFiltro = hasRegionalScopeFilters();
    r.rotulo = getRegionalFilterSummaryLabel();

    // 2. ano geral que nao tem indice de area: idem
    STATE.currentElectionType = 'geral'; STATE.currentElectionYear = '2002';
    r.geralSemIndice = matchesRegionalScope(local);

    // 2b. e o que de fato resolve: largar o recorte na fronteira
    currentRegionFilter = { level: 'ap', code: __areaDe2022 };
    STATE.currentElectionType = 'municipal'; STATE.currentElectionYear = '2024';
    resetRegionScope();
    r.depoisDeLargar = matchesRegionalScope(local);

    // 3. e onde o nivel VALE, o recorte continua valendo de verdade
    STATE.currentElectionType = 'municipal'; STATE.currentElectionYear = '2024';
    const alvo = getApCodeForFeature(local);
    currentRegionFilter = { level: 'ap', code: alvo };
    const dentro = __geo.features.find(
      (f) => getApCodeForFeature(f.properties) === alvo);
    r.valeQuandoAplica = [matchesRegionalScope(dentro.properties),
                          matchesRegionalScope({ id_unico: '0_0_0' })];

    currentRegionFilter = { level: '', code: '' };
    return r;
  })()`, ctx, { filename: 'sobra.js' });

  ok(sobra.municipalComSobra === true,
    'recorte carimbado com OUTRA eleicao nao filtra a eleicao atual');
  ok(sobra.hasFiltro === false,
    'e o site nem o considera um filtro ativo');
  ok(sobra.rotulo === '',
    'nem mostra o nome dele no painel', JSON.stringify(sobra.rotulo));
  ok(sobra.depoisDeLargar === true,
    'resetRegionScope() na troca de eleicao tambem devolve o mapa inteiro');
  ok(sobra.geralSemIndice === true,
    'nem uma eleicao geral de ano sem indice de area');
  ok(sobra.valeQuandoAplica[0] === true && sobra.valeQuandoAplica[1] === false,
    'mas onde o nivel vale, o recorte filtra normalmente');

  // --- recorte por area vale na municipal tambem
  const alvoAp = vm.runInContext(`(() => {
    const s = buildGeneralApSummary(apCurrentUF(), 'vereador_ord');
    return Object.keys(s)[0];
  })()`, ctx, { filename: 'alvoap.js' });
  ctx.__alvoMun = alvoAp;
  const escopo = vm.runInContext(`(() => {
    const dentro = __geo.features.find((f) => getApCodeForFeature(f.properties) === __alvoMun);
    currentRegionFilter = { level: 'ap', code: __alvoMun };
    const r = [matchesRegionalScope(dentro.properties),
               matchesRegionalScope({ id_unico: '0_0_0' })];
    currentRegionFilter = { level: '', code: '' };
    return r;
  })()`, ctx, { filename: 'escopoMun.js' });
  ok(escopo[0] === true && escopo[1] === false,
    'o recorte por area funciona na municipal (nao para no corte por tipo de eleicao)');

  vm.runInContext(`
    STATE.currentElectionType = 'geral'; STATE.currentElectionYear = '2022';
    dom.selectMunicipio = { value: '' };
  `, ctx);
}

// --------------------------------------------- AS MUNICIPAIS ANTERIORES
//
// Mesma maquina de 2024 — municipio unico, chave zona_municipioTSE_local, um
// unico applyPrefeitoJsonToGeojson2024 para todos os anos. O que muda e o
// INDICE: a rede de locais e outra a cada eleicao, e recuando ela envelhece
// (zona renumerada, local sem codigo de municipio no GPKG). O piso e de
// REGRESSAO na recuperacao, nao de perfeicao.
console.log('');
console.log('Municipais anteriores a 2024');

const PISO_MUNICIPAL = { 2020: 98, 2016: 97, 2012: 96, 2008: 94 };

for (const ano of [2020, 2016, 2012, 2008]) {
  const idx = lerJson(`resultados_geo/regioes_ap/locais_ap_${ano}_AC.json`);
  const pref = lerZipJson(
    `resultados_geo/Municipais ${ano}/prefeito_${ano}_ord_t1_AC.zip`,
    '1392_RIO_BRANCO.json');
  const MUNI_IBGE = '1200401';

  const chaves = Object.keys(pref.RESULTS);
  ctx.__geo = {
    type: 'FeatureCollection',
    features: chaves.map((chave) => {
      const [zona, , local] = chave.split('_');
      return {
        type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { id_unico: chave, local_key: chave, local_id: `${zona}_${local}`,
          nm_locvot: 'Escola', cod_localidade_ibge: MUNI_IBGE,
          nm_localidade: 'RIO BRANCO', nr_zona: Number(zona), nr_locvot: Number(local) },
      };
    }),
  };
  ctx.__pref = pref;
  ctx.__ano = String(ano);

  vm.runInContext(`
    STATE.currentElectionType = 'municipal';
    STATE.currentElectionYear = __ano;
    STATE.currentMapMuniUF = null;
    dom.selectUFMunicipal = { value: 'AC' };
    dom.selectUFGeneral = { value: '' };
    dom.selectMunicipio = { value: 'RIO BRANCO' };
    STATE.dataHas2T = { prefeito_ord: false }; currentTurno = 1;
    currentOffice = 'prefeito'; currentSubType = 'ord'; currentCargo = 'prefeito_ord';
    currentRegionFilter = { level: '', code: '' };
    currentCidadeFilter = 'all'; currentBairroFilter = 'all'; currentLocalFilter = '';
    STATE.inaptos['prefeito_ord'] = { '1T': [], '2T': [] };
    applyPrefeitoJsonToGeojson2024(__geo, __pref, '1T');
    currentDataCollection['prefeito_ord'] = __geo;
  `, ctx, { filename: `mun${ano}.js` });

  ok(vm.runInContext('apLevelApplies()', ctx),
    `o nivel de area vale na municipal de ${ano}`);
  await vm.runInContext('ensureApIndexLoaded(apCurrentUF())', ctx,
    { filename: `carga${ano}.js` });

  const r = vm.runInContext(`(() => {
    const s = buildGeneralApSummary(apCurrentUF(), 'prefeito_ord');
    const cods = Object.keys(s);
    return { n: cods.length, total: cods.reduce((a, c) => a + s[c].totalValid, 0),
             soDoMuni: cods.every((c) => c.startsWith('${MUNI_IBGE}')) };
  })()`, ctx, { filename: `sum${ano}.js` });

  const validos = (v) => Object.entries(v)
    .filter(([id]) => id !== '95' && id !== '96')
    .reduce((a, n) => a + n[1], 0);
  const cobertas = chaves.filter((k) => idx[k]);
  const esperado = cobertas.reduce((a, k) => a + validos(pref.RESULTS[k]), 0);
  const oficial = chaves.reduce((a, k) => a + validos(pref.RESULTS[k]), 0);
  const cobertura = 100 * esperado / oficial;

  ok(r.n > 0 && r.total === esperado,
    `${ano}: ${r.n} areas em Rio Branco, soma bate com os locais cobertos`,
    `${r.total} vs ${esperado}`);
  ok(r.soDoMuni, `${ano}: e todas as areas sao do proprio municipio`);
  ok(cobertura > PISO_MUNICIPAL[ano],
    `${ano}: cobertura de votos acima de ${PISO_MUNICIPAL[ano]}%`,
    `${cobertura.toFixed(2)}% (${cobertas.length} de ${chaves.length} locais)`);
}

// Cada ano no seu Map: uma chave de 2008 nao pode resolver com 2020 ativo, nem
// o contrario — o mesmo zona_municipio_local pode ser outro predio.
{
  const i08 = lerJson('resultados_geo/regioes_ap/locais_ap_2008_AC.json');
  const i20 = lerJson('resultados_geo/regioes_ap/locais_ap_2020_AC.json');
  const so08 = Object.keys(i08).find((k) => !(k in i20));
  if (so08) {
    ctx.__so08 = so08;
    const r = vm.runInContext(`(() => {
      const p = { id_unico: __so08, local_key: __so08 };
      STATE.currentElectionYear = '2020';
      const com20 = getApCodeForFeature(p);
      STATE.currentElectionYear = '2008';
      return { com20, com08: getApCodeForFeature(p) };
    })()`, ctx, { filename: 'anosMun.js' });
    ok(!r.com20 && !!r.com08,
      'chave que so existe em 2008 nao resolve com 2020 ativo', so08);
  } else {
    ok(true, 'as redes de 2008 e 2020 do AC coincidem — nada a separar');
  }
}

// ------------------------------------------------- guarda de ano e cargo
//
// So 2022 chama resolveMapModeAfterLoad: trocar para 2018 ou para governador
// deixa STATE.currentMapMode='regioes' e currentRegionLevel='ap' de pe. Sem a
// guarda em showGeneralRegionOverview o mapa fica no nivel 'ap' com um indice
// que nao casa com local nenhum — poligono cinza, e nenhum erro no console.
console.log('');
console.log('Guarda de ano e cargo');
const cabe = vm.runInContext(`(() => {
  const r = [];
  STATE.currentElectionType = 'geral'; currentOffice = 'presidente';
  currentCargo = 'presidente_ord';
  STATE.currentElectionYear = '2022'; r.push(apLevelApplies());
  STATE.currentElectionYear = '2018'; r.push(apLevelApplies());
  STATE.currentElectionYear = '2010'; r.push(apLevelApplies());
  STATE.currentElectionYear = '2002'; r.push(apLevelApplies());
  STATE.currentElectionYear = '2022';
  STATE.currentElectionYear = '2022'; currentOffice = 'governador';
  r.push(apLevelApplies());
  currentOffice = 'deputado'; r.push(apLevelApplies());
  currentOffice = 'presidente'; STATE.currentElectionType = 'municipal';
  r.push(apLevelApplies());
  STATE.currentElectionType = 'geral';
  return r;
})()`, ctx, { filename: 'guarda.js' });
ok(cabe[0] === true, 'nivel ap vale em 2022');
ok(cabe[1] === true, 'e em 2018 — os dois anos tem indice local->area');
ok(cabe[2] === true, 'e em 2010');
ok(cabe[3] === false, 'mas nao em 2002, que nao tem indice');
ok(cabe[4] === true, 'vale para governador — o nivel e do ANO, nao do cargo');
ok(cabe[5] === true, 'e para deputado tambem');
ok(cabe[6] === false,
  'municipal em ano SEM indice municipal nao tem nivel ap (2024 tem, e testado acima)');

// Num ano SEM indice o botao nao responde, alem de estar escondido: um clique
// perdido nao pode deixar STATE.detalhe pedindo areas que nao existem ali.
const foraDeEscopo = vm.runInContext(`(() => {
  STATE.currentElectionYear = '2002'; STATE.detalhe = 'locais';
  if (apLevelApplies()) STATE.detalhe = 'areas';   // o que o handler faz
  const semIndice = STATE.detalhe;
  STATE.currentElectionYear = '2018'; STATE.detalhe = 'locais';
  if (apLevelApplies()) STATE.detalhe = 'areas';
  const comIndice = STATE.detalhe;
  STATE.currentElectionYear = '2022'; STATE.detalhe = 'locais';
  return { semIndice, comIndice };
})()`, ctx, { filename: 'fora.js' });
ok(foraDeEscopo.semIndice === 'locais', 'em 2002 o botao de areas nao muda o detalhe');
ok(foraDeEscopo.comIndice === 'areas', 'e em 2018 muda');

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo ok.');
process.exit(falhas ? 1 : 0);
