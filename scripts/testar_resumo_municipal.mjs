/* Harness do resumo municipal de DEPUTADO, fora do browser.
 *
 * O que este teste protege: nenhum municipio pode ficar sem entry no resumo.
 *
 * O bug que ele impede de voltar: o coropletico de deputado desenhava o
 * municipio em cinza ("Sem resultados resumidos disponiveis") mesmo havendo
 * votos no JSON. Duas causas somadas —
 *
 *  1. o resumo era montado a partir dos DOTS geolocalizados, entao municipio
 *     sem local geocodificado nunca entrava;
 *  2. quando vinha do JSON (2002/1994), era indexado por NOME, e a grafia
 *     diverge entre os anos (CANINDE DE SAO FRANCISCO em 2002 x CANINDE DO SAO
 *     FRANCISCO em 2006). Os poligonos de municipios_hd so tem CD_MUN, sem
 *     nome, entao o join dependia de uma tabela manual de aliases.
 *
 * Agora o resumo sai do RESULTS agregado por codigo TSE e casa com o poligono
 * pelo IBGE de tse_para_ibge.json. Os numeros abaixo quebram se qualquer uma
 * das duas dependencias voltar.
 *
 *     node scripts/testar_resumo_municipal.mjs
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CANINDE_IBGE = '2801207';   // o municipio do print do usuario
const CANINDE_TSE = '31232';

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
  addEventListener() {}, removeEventListener() {},
  __lerJson: (url) => JSON.parse(readFileSync(path.join(RAIZ, url), 'utf8')),
};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fonte, ctx, { filename: 'bundle.js' });

await vm.runInContext('ensureTseIbgeLoaded()', ctx, { filename: 'ponte.js' });
await new Promise((resolve) => setTimeout(resolve, 0));

const lerJson = (rel) => JSON.parse(readFileSync(path.join(RAIZ, rel), 'utf8'));
const ponte = lerJson('resultados_geo/tse_para_ibge.json');

console.log('Resumo municipal de deputado');

// ------------------------------------------------- a ponte

ok(Object.keys(ponte).length === 5571, 'ponte TSE→IBGE tem 5571 entradas',
  String(Object.keys(ponte).length));
ok(ponte[CANINDE_TSE] === CANINDE_IBGE, `ponte: ${CANINDE_TSE} → ${CANINDE_IBGE}`, ponte[CANINDE_TSE]);
ok(new Set(Object.values(ponte)).size === 5571, 'ponte e bijetiva (nenhum IBGE repetido)');

// ------------------------------------------------- resumo por UF

const ibgePorTse = ponte;
const tsePorIbge = Object.fromEntries(Object.entries(ponte).map(([t, i]) => [i, t]));

// Monta um STATE.deputyResults sintetico cobrindo TODOS os municipios da malha,
// com a chave no formato real do TSE: "{zona}_{cdMuniTSE}_{local}".
function montarCenario(malha) {
  const results = {};
  malha.features.forEach((f, i) => {
    const ibge = String(f.properties.CD_MUN);
    const tse = tsePorIbge[ibge];
    if (!tse) return;
    results[`1_${tse}_${1000 + i}`] = { f: { 10: 100 + i, 20: 50 }, e: { 30: 70 } };
  });
  return results;
}

const CENARIOS = [
  ['SE', 'resultados_geo/municipios_hd/municipios_SE.geojson', 75],
  ['MG', 'resultados_geo/municipios_hd/municipios_MG.geojson', 853],
  ['RR', 'resultados_geo/municipios_hd/municipios_RR.geojson', 15],
  ['SE 1994', 'resultados_geo/municipios_1994/municipios_1994_SE.geojson', 75],
];

const resolver = vm.runInContext('getMunicipalSummaryEntryForFeature', ctx, { filename: 'res.js' });
let summarySE = null;

for (const [rotulo, rel, esperado] of CENARIOS) {
  const malha = lerJson(rel);
  ok(malha.features.length === esperado, `${rotulo}: malha com ${esperado} municipios`,
    String(malha.features.length));

  ctx.__results = montarCenario(malha);
  const summary = vm.runInContext(`
    STATE.currentElectionType = 'geral';
    STATE.currentElectionYear = '2002';
    dom.selectUFGeneral = { value: ${JSON.stringify(rotulo.slice(0, 2))} };
    currentRegionFilter = { level: '', code: '' };
    currentCidadeFilter = 'all'; currentBairroFilter = 'all'; currentLocalFilter = '';
    currentTurno = 1;
    currentCargo = 'deputado_federal';
    STATE.deputyResults = __results;
    STATE.deputyMetadataByType = { f: { 10: ['A', 'AA', 'ELEITO'], 20: ['B', 'BB', 'SUPLENTE'] }, e: {} };
    STATE.deputyMetadata = STATE.deputyMetadataByType.f;
    STATE.inaptos = {};
    buildGeneralMunicipalityOverviewSummary('deputado_federal');
  `, ctx, { filename: 'sum.js' });

  const distintas = new Set(Object.values(summary)).size;
  ok(distintas === esperado, `${rotulo}: ${esperado} entries distintas no resumo`, String(distintas));

  // O assert central: nenhum poligono da malha fica sem entry.
  const semEntry = malha.features.filter((f) => !resolver(f.properties, summary));
  ok(semEntry.length === 0, `${rotulo}: NENHUM poligono sem resultado`,
    semEntry.slice(0, 5).map((f) => f.properties.CD_MUN).join(', '));

  if (rotulo === 'SE') summarySE = summary;
}

// ------------------------------------------------- o caso do print

// A malha entrega CD_MUN como NUMERO; o resumo indexa por string.
const caninde = resolver({ CD_MUN: Number(CANINDE_IBGE) }, summarySE);
ok(!!caninde, 'Canindé resolve com CD_MUN numerico (como vem da malha)');
ok(caninde?.muniCode === CANINDE_IBGE, 'entry de Canindé traz o codigo IBGE', caninde?.muniCode);
ok(/Canind/i.test(caninde?.nome || ''), 'nome da entry vem do IBGE, nao da grafia do ano',
  caninde?.nome);

// ------------------------------------------------- filtro de regiao

await vm.runInContext('ensureRegionalFiltersLoaded()', ctx, { filename: 'reg.js' });
// IIFE: cada runInContext compartilha o escopo lexical global, entao dois
// blocos com o mesmo `const` no topo colidiriam.
const porRegiao = vm.runInContext(`(() => {
  const codigo = Object.keys(REGION_INDEX.niveis.rgint.SE)[0];
  currentRegionFilter = { level: 'rgint', code: codigo };
  const resumo = buildGeneralMunicipalityOverviewSummary('deputado_federal');
  const total = new Set(Object.values(resumo)).size;
  const naRegiao = Object.keys(REGION_INDEX.muni).filter(
    (m) => m.startsWith('28') && REGION_INDEX.muni[m].rgint === codigo).length;
  currentRegionFilter = { level: '', code: '' };
  return { total, naRegiao, codigo };
})()`, ctx, { filename: 'filtro.js' });

ok(porRegiao.total > 0 && porRegiao.total === porRegiao.naRegiao,
  'com regiao filtrada, o resumo traz exatamente os municipios dela',
  `${porRegiao.total} de ${porRegiao.naRegiao} (rgint ${porRegiao.codigo})`);

// ------------------------------------------------- guardas

const semPonte = vm.runInContext(`(() => {
  const guardado = TSE_TO_IBGE;
  TSE_TO_IBGE = new Map();
  const resumo = buildGeneralMunicipalityOverviewSummary('deputado_federal');
  TSE_TO_IBGE = guardado;
  return Object.keys(resumo).length;
})()`, ctx, { filename: 'guarda.js' });
ok(semPonte === 0, 'sem a ponte carregada, o resumo sai vazio em vez de explodir',
  String(semPonte));

ok(vm.runInContext("typeof getPrecomputedMunicipalOverviewSummary", ctx) === 'undefined',
  'a funcao morta com o ReferenceError de entrySlug nao voltou');

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo ok.');
process.exit(falhas ? 1 : 0);
