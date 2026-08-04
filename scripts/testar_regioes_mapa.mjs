/* Harness do MAPA por regiao (modo 'regioes'), fora do browser.
 *
 * Carrega os modulos reais num contexto Node com `document`/`fetch` stubados e
 * verifica a agregacao do summary municipal para regiao, o casamento
 * feature<->entry e o estilo do poligono.
 *
 * O que este teste protege:
 *
 * 1. DUPLA CONTAGEM. Uma entry do summary municipal e apontada por VARIAS
 *    chaves (slug, aliases, ibge7, ibge6) e o objeto ainda carrega a chave
 *    sintetica _maxTotalValid. Somar com Object.values(summary) contaria o mesmo
 *    municipio 4-6 vezes e inflaria os totais da regiao sem quebrar nada
 *    visivelmente — o mapa so ficaria com numeros errados.
 *
 * 2. COLISAO DE CODIGO. CD_RGI tem 6 digitos, igual ao prefixo de 6 digitos que
 *    o site usa para casar municipio (410010 e Regiao Imediata de Curitiba E
 *    prefixo de municipio do PR). Sem o early-return por CD_REG, o poligono de
 *    uma regiao mostraria o resultado de um municipio qualquer.
 *
 *     node scripts/testar_regioes_mapa.mjs
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let falhas = 0;
function ok(cond, nome, detalhe = '') {
  console.log(`${cond ? '  ok   ' : '  FALHA'} ${nome}${detalhe ? '  — ' + detalhe : ''}`);
  if (!cond) falhas++;
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
  'js/globals.js', 'js/utils.js', 'js/data-zip.js',
  'js/data-process.js', 'js/data-municipal.js', 'js/data-loader.js',
  'js/data-geral-2022.js', 'js/ui-helpers.js', 'js/map-render.js',
];

const fonte = PRELUDIO
  + MODULOS.map((f) => `\n/* ===== ${f} ===== */\n` + readFileSync(path.join(RAIZ, f), 'utf8')).join('\n');

const ctx = {
  console: { log() {}, warn() {}, error() {} },
  setTimeout, clearTimeout, Promise,
  // ui-helpers.js registra o init em window na carga
  addEventListener() {}, removeEventListener() {},
  __lerJson: (url) => JSON.parse(readFileSync(path.join(RAIZ, url), 'utf8')),
};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fonte, ctx, { filename: 'bundle.js' });

await vm.runInContext('ensureRegionalFiltersLoaded()', ctx, { filename: 'carregar.js' });
await new Promise((resolve) => setTimeout(resolve, 0));

vm.runInContext(`
  STATE.currentElectionType = 'geral';
  STATE.currentElectionYear = '2022';
  STATE.currentMapMode = 'regioes';
  STATE.currentRegionLevel = 'meso';
  currentRegionFilter = { level: '', code: '' };
  dom.selectUFGeneral = { value: 'PR' };
`, ctx, { filename: 'cenario.js' });

const lerJson = (rel) => JSON.parse(readFileSync(path.join(RAIZ, rel), 'utf8'));
const indice = lerJson('resultados_geo/regioes_index.json');

console.log('Mapa por regiao — PR');

// ------------------------------------------------- malha x indice

for (const [level, esperado] of [['meso', 10], ['micro', 39], ['rgint', 6], ['rgi', 29]]) {
  const malha = lerJson(`resultados_geo/regioes_${level}/regioes_${level}_PR.geojson`);
  const doIndice = Object.keys(indice.niveis[level].PR);
  ok(malha.features.length === esperado, `${level}: ${esperado} poligonos no PR`,
    `${malha.features.length}`);
  ok(doIndice.length === esperado, `${level}: ${esperado} regioes no indice`, `${doIndice.length}`);

  const daMalha = malha.features.map((f) => String(f.properties.CD_REG)).sort();
  ok(JSON.stringify(daMalha) === JSON.stringify(doIndice.slice().sort()),
    `${level}: codigos da malha batem com o indice`);
  ok(malha.features.every((f) => f.properties.NM_REG && f.properties.SIGLA_UF === 'PR'),
    `${level}: toda feature tem NM_REG e SIGLA_UF`);
}

// O indice guarda so codigos de regiao, nunca nome de municipio (a fonte antiga
// de nomes tinha 595 trocados — nada dela pode ter sobrado aqui).
const amostraMuni = indice.muni['4104907'];
ok(JSON.stringify(Object.keys(amostraMuni).sort()) === JSON.stringify(['meso', 'micro', 'rgi', 'rgint']),
  'indice.muni tem os 4 niveis por municipio', JSON.stringify(amostraMuni));
ok(!JSON.stringify(indice.muni).includes('Castro'), 'indice.muni nao carrega nome de municipio');

// ------------------------------------------------- agregacao sem dupla contagem

// Summary municipal sintetico no formato REAL: a MESMA entry apontada por slug,
// ibge7 e ibge6, mais a chave sintetica _maxTotalValid. Se a agregacao iterar as
// chaves em vez do indice, os totais saem multiplicados.
const municipiosPR = Object.entries(indice.muni)
  .filter(([code]) => code.startsWith('41'))
  .map(([code, regs]) => ({ code, regs }));

const muniSummary = { _maxTotalValid: 999999 };
municipiosPR.forEach(({ code }, i) => {
  const entry = {
    nome: `Municipio ${code}`,
    muniCode: code,
    votes: { 'Alfa (AAA) (ELEITO) 1T': 100 + i, 'Beta (BBB) (NAO ELEITO) 1T': 50 },
    totalValid: 150 + i,
    isDetailed: true
  };
  muniSummary[code] = entry;                    // ibge7
  muniSummary[code.slice(0, 6)] = entry;        // ibge6
  muniSummary[`municipio_${code}`] = entry;     // slug
});

const totalMunicipal = municipiosPR.reduce((acc, _m, i) => acc + 150 + i, 0);

const buildRegion = vm.runInContext('buildGeneralRegionSummary', ctx, { filename: 'agg.js' });
const regionSummary = buildRegion('meso', 'PR', muniSummary, 'presidente_ord');

const totalRegional = Object.values(regionSummary)
  .reduce((acc, e) => acc + e.totalValid, 0);

ok(Object.keys(regionSummary).length === 10, 'summary de regiao tem 10 mesorregioes',
  `${Object.keys(regionSummary).length}`);
ok(totalRegional === totalMunicipal,
  'soma da regiao == soma do municipal (sem dupla contagem)',
  `regiao ${totalRegional} vs municipal ${totalMunicipal}`);
ok(Object.values(regionSummary).every((e) => e.winnerName === 'Alfa'),
  'vencedor resolvido a partir da chave de candidato');
ok(Object.values(regionSummary).every((e) => e.nome && !e.nome.startsWith('Municipio')),
  'entry da regiao usa o nome da regiao, nao do municipio');

// ------------------------------------------------- feature -> entry

const resolver = vm.runInContext('getMunicipalSummaryEntryForFeature', ctx, { filename: 'res.js' });
const umaRegiao = Object.keys(regionSummary)[0];
ok(resolver({ CD_REG: umaRegiao }, regionSummary)?.nome === regionSummary[umaRegiao].nome,
  'poligono de regiao acha sua entry por CD_REG');

// A colisao real: 410010 e Regiao Imediata de Curitiba e tambem prefixo de 6
// digitos de municipio do PR. Com CD_REG presente, nao pode vazar para o municipal.
ok(resolver({ CD_REG: '410010' }, muniSummary) === null,
  'CD_REG nao vaza para entry municipal (colisao de 6 digitos)');
ok(resolver({ CD_MUN: '4104907' }, muniSummary)?.muniCode === '4104907',
  'poligono municipal continua casando por CD_MUN');

// ------------------------------------------------- estilo e nome

const estilo = vm.runInContext('getMunicipalPolygonStyle', ctx, { filename: 'sty.js' });
const st = estilo({ properties: { CD_REG: umaRegiao, NM_REG: 'X' } }, regionSummary);
ok(st && st.fillColor && st.fillColor !== '#7a8699',
  'poligono de regiao sai colorido pelo vencedor', st?.fillColor);
ok(!st.height, 'sem altura quando a extrusao esta desligada', String(st?.height));

// 3D no mapa de regioes: a altura era calculada so em currentMapMode
// 'municipios', entao o modo regiao saia sempre plano.
vm.runInContext('STATE.extrusion3DEnabled = true; STATE.extrusionMetric = "votes";', ctx);
const stAlto = estilo({ properties: { CD_REG: umaRegiao, NM_REG: 'X' } }, regionSummary);
ok(stAlto.height > 0, 'regiao ganha altura com extrusao ligada', String(Math.round(stAlto.height)));

vm.runInContext('STATE.currentMapMode = "locais";', ctx);
ok(!estilo({ properties: { CD_REG: umaRegiao, NM_REG: 'X' } }, regionSummary).height,
  'modo locais continua sem altura (sao pontos)');
vm.runInContext('STATE.currentMapMode = "regioes"; STATE.extrusion3DEnabled = false;', ctx);

// "por Votos" e "por Margem" tem de usar a MESMA escala. A margem normalizava
// por 100 fixo com teto proprio de 80.000 (contra 180.000 dos votos) e sem piso,
// entao o mapa saia visivelmente mais achatado so por trocar a metrica.
const alturasPorMetrica = vm.runInContext(`
  STATE.extrusion3DEnabled = true;
  STATE.currentMapMode = 'municipios';
  currentVizMode = 'vencedor';
  currentGradientMode = 'margin';
  const mk = (tv, mg) => ({
    nome: 'X', totalValid: tv, margin: mg, winnerPct: 50 + mg / 2,
    votes: { 'A (AA) (ELEITO) 1T': tv }, winnerCode: 'A (AA) (ELEITO) 1T',
    winnerParty: 'AA', winnerColorParty: 'AA'
  });
  const s = { a: mk(1000, 40), b: mk(500, 20), c: mk(50, 2) };
  const medir = (metrica) => {
    STATE.extrusionMetric = metrica;
    return ['a', 'b', 'c'].map((k) =>
      Math.round(getMunicipalPolygonStyle({ properties: { CD_MUN: k } }, s).height));
  };
  ({ votos: medir('votes'), margem: medir('margin') });
`, ctx, { filename: 'alt.js' });

ok(Array.from(alturasPorMetrica.votos).join() === Array.from(alturasPorMetrica.margem).join(),
  'por Votos e por Margem usam a mesma escala de altura',
  `votos ${Array.from(alturasPorMetrica.votos).join('/')} vs margem ${Array.from(alturasPorMetrica.margem).join('/')}`);
ok(Array.from(alturasPorMetrica.margem)[0] === 180000,
  'a maior margem alcanca o teto de 180.000 m (antes parava em 32.000)',
  String(Array.from(alturasPorMetrica.margem)[0]));
ok(Array.from(alturasPorMetrica.margem)[2] >= 2000,
  'territorio de margem minima ainda tem piso visivel',
  String(Array.from(alturasPorMetrica.margem)[2]));

vm.runInContext('STATE.currentMapMode = "regioes"; STATE.extrusion3DEnabled = false;', ctx);

const nomeFeature = vm.runInContext('getMunicipalityFeatureName', ctx, { filename: 'nm.js' });
ok(nomeFeature({ CD_REG: '410010', NM_REG: 'Curitiba' }) === 'Curitiba',
  'nome do poligono de regiao vem de NM_REG');

// ------------------------------------------------- tooltip x painel
// O tooltip do mapa lia os totais oficiais por municipio e o painel somava as
// FEATURES visiveis (locais de votacao geolocalizados). Em varios anos parte dos
// votos de um municipio nao esta em nenhum local geocodificado, entao o painel
// vinha MENOR que o tooltip da mesma regiao. As duas leituras tem de sair da
// mesma fonte — o JSON oficial.

// officialCityTotals no formato REAL: a mesma entry apontada pelo nome e pelo
// slug (e assim que buildGeneralCityTotals2002 indexa).
const cityTotals = {};
let esperadoNaRegiao = 0;
const REGIAO_ALVO = { level: 'meso', code: '4105' };
municipiosPR.forEach(({ code, regs }, i) => {
  const votos = 1000 + i;
  const entry = {
    ibge: code,
    votesByDisplayKey: { 'Alfa (AAA) (ELEITO) 1T': votos, 'Beta (BBB) (NAO ELEITO) 1T': 500 },
    rawTotals: { 11: votos, 22: 500 },
    totalValidos: votos + 500
  };
  cityTotals[`Cidade ${code}`] = entry;
  cityTotals[`cidade_${code}`] = entry;
  if (regs[REGIAO_ALVO.level] === REGIAO_ALVO.code) esperadoNaRegiao += votos + 500;
});

ctx.__cityTotals = cityTotals;
vm.runInContext(`
  STATE.generalOfficialTotalsByCity = { presidente_ord: { '1T': __cityTotals } };
  STATE.isFilterAggregationActive = true;
  currentCidadeFilter = 'all';
  currentBairroFilter = 'all';
  currentLocalFilter = '';
  currentTurno = 1;
  currentCargo = 'presidente_ord';
  currentRegionFilter = ${JSON.stringify(REGIAO_ALVO)};
`, ctx, { filename: 'oficial.js' });

const deveUsar = vm.runInContext('shouldUseGeneralRegionOfficialTotals', ctx, { filename: 'usa.js' });
ok(deveUsar('presidente_ord') === true, 'painel usa totais oficiais quando ha regiao filtrada');

const painel = vm.runInContext('buildGeneralRegionOfficialSummary', ctx, { filename: 'pan.js' })('presidente_ord', '1T');
ok(painel && painel.totalValidos === esperadoNaRegiao,
  'painel: total oficial da regiao (sem dupla contagem por nome+slug)',
  `${painel?.totalValidos} vs esperado ${esperadoNaRegiao}`);

// O tooltip: mesma fonte, por outro caminho (summary municipal -> summary de regiao).
const somarOficiais = vm.runInContext('buildMunicipalSummaryFromOfficialTotals', ctx, { filename: 'mun.js' });
const muniOficial = somarOficiais(cityTotals, '1T');
const tooltip = buildRegion(REGIAO_ALVO.level, 'PR', muniOficial, 'presidente_ord');
const totalTooltip = tooltip[REGIAO_ALVO.code]?.totalValid;

ok(totalTooltip === painel.totalValidos,
  'tooltip e painel batem no mesmo total',
  `tooltip ${totalTooltip} vs painel ${painel.totalValidos}`);

// ------------------------------------------------- guarda da camada

const aplicarRecorte = vm.runInContext('applyRegionScopeToMunicipiosLayer', ctx, { filename: 'rec.js' });
ok(aplicarRecorte({ __regionLevel: 'meso', __ufFeatures: [], setFeatures() {} }) === false,
  'camada de regiao nao e recortada por municipio');

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo ok.');
process.exit(falhas ? 1 : 0);
