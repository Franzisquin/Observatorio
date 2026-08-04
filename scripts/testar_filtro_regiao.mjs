/* Harness do filtro por regiao (4 niveis do IBGE), fora do browser.
 *
 * Carrega os modulos reais num contexto Node com `document` e `fetch` stubados
 * sobre os JSONs em disco, e verifica `matchesRegionalScope` contra as malhas
 * municipais REAIS.
 *
 * O que este teste protege: o casamento municipio<->regiao tem de ser por
 * CODIGO IBGE, nunca por nome. A fonte antiga (municipios_por_mesorregiao.json)
 * tinha 595 dos 5571 nomes trocados por homonimos de outra UF (4104907 vinha
 * como "Placido de Castro" em vez de Castro/PR) — se o predicado voltar a casar
 * por nome, os municipios de borda somem do mapa e os numeros abaixo quebram.
 *
 * Protege tambem a colisao de codigo entre niveis: CD_MESO e CD_RGINT tem
 * ambos 4 digitos, entao 4102 existe nos dois — comparar codigo sem o nivel
 * junto misturaria regioes diferentes.
 *
 *     node scripts/testar_filtro_regiao.mjs
 */

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const REGIAO = { level: 'meso', code: '4105' };  // Centro Oriental Paranaense
const CASTRO = '4104907';    // nome vinha corrompido ("Placido de Castro")
const PALMEIRA = '4117701';  // idem ("Palmeiras do Tocantins")

let falhas = 0;
function ok(cond, nome, detalhe = '') {
  console.log(`${cond ? '  ok   ' : '  FALHA'} ${nome}${detalhe ? '  — ' + detalhe : ''}`);
  if (!cond) falhas++;
}


/* Leitor de ZIP minimo: os arquivos do site tem UMA entrada, ZIP_DEFLATED sem
 * descritor de dados, entao basta o local file header. */
function lerZipEntrada(zipPath) {
  const buf = readFileSync(zipPath);
  const metodo = buf.readUInt16LE(8);
  const inicio = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28);
  const bruto = buf.subarray(inicio, inicio + buf.readUInt32LE(18));
  return JSON.parse((metodo === 0 ? bruto : inflateRawSync(bruto)).toString('utf8'));
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
  // fetch le do disco: assim o initMuniCodeToNameMap de globals.js (que roda na
  // carga e popula os nomes a partir de regioes_ibge.json) executa de verdade.
  var fetch = async (url) => ({ ok: true, json: async () => __lerJson(url) });
`;

// map-render.js entra pelo applyRegionScopeToMunicipiosLayer (e arrasta
// data-process/data-municipal como dependencias de carga).
const MODULOS = [
  'js/globals.js', 'js/utils.js', 'js/data-zip.js',
  'js/data-process.js', 'js/data-municipal.js', 'js/data-loader.js',
  'js/ui-helpers.js', 'js/map-render.js', 'js/data-geral-1989-1994.js',
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
// Deixa o initMuniCodeToNameMap (disparado na carga de globals.js) terminar.
await new Promise((resolve) => setTimeout(resolve, 0));

// dom.selectUFGeneral e lido por getCurrentGeneralRegionalUF().
const cenario = (eleicao, regiao) => vm.runInContext(`
  STATE.currentElectionType = ${JSON.stringify(eleicao)};
  dom.selectUFGeneral = { value: 'PR' };
  currentRegionFilter = ${JSON.stringify(regiao || { level: '', code: '' })};
`, ctx, { filename: 'cenario.js' });

const matches = vm.runInContext('matchesRegionalScope', ctx, { filename: 'pred.js' });

const malha = (rel) => JSON.parse(readFileSync(path.join(RAIZ, rel), 'utf8')).features;
const dentro = (feats) => feats.filter((f) => matches(f.properties));

const MALHAS = [
  ['atual (municipios_hd)', 'resultados_geo/municipios_hd/municipios_PR.geojson', 399, 14],
  ['1989', 'resultados_geo/municipios_1989/municipios_1989_PR.geojson', 318, 11],
  ['1994', 'resultados_geo/municipios_1994/municipios_1994_PR.geojson', 371, 12],
];

// ------------------------------------------------------------- verificacoes

console.log(`Filtro por regiao — PR, ${REGIAO.level}:${REGIAO.code}`);

const codigosPorMalha = {};
for (const [rotulo, rel, total, esperado] of MALHAS) {
  const feats = malha(rel);
  ok(feats.length === total, `${rotulo}: malha completa`, `${feats.length} municipios`);

  cenario('geral', REGIAO);
  const sel = dentro(feats);
  ok(sel.length === esperado, `${rotulo}: so os municipios da regiao`,
    `${sel.length} de ${feats.length} (esperado ${esperado})`);
  codigosPorMalha[rotulo] = new Set(sel.map((f) => String(f.properties.CD_MUN)));

  // Guarda do no-op: sem regiao, nada e escondido.
  cenario('geral', null);
  ok(dentro(feats).length === feats.length, `${rotulo}: sem filtro passa tudo`);

  // Guarda das eleicoes municipais: o filtro nao vale la, nem com estado sujo.
  cenario('municipal', REGIAO);
  ok(dentro(feats).length === feats.length, `${rotulo}: municipal e no-op`);
}

// Prova de que o casamento e por codigo, nao por nome: estes dois municipios
// estao com o nome trocado no JSON de mesorregiao e cairiam fora por slug.
cenario('geral', REGIAO);
const c1989 = codigosPorMalha['1989'];
ok(c1989.has(CASTRO), `Castro (${CASTRO}) dentro da regiao em 1989`);
ok(c1989.has(PALMEIRA), `Palmeira (${PALMEIRA}) dentro da regiao em 1989`);

// CD_MUN vem numero em municipios_hd e string nas malhas historicas: o subconjunto
// de 1989 tem de estar contido no atual, sem nenhum codigo perdido na conversao.
const cHd = codigosPorMalha['atual (municipios_hd)'];
const foraDoAtual = [...c1989].filter((c) => !cHd.has(c));
ok(foraDoAtual.length === 0, 'int (hd) e string (1989) produzem os mesmos codigos',
  foraDoAtual.join(', '));

// O mapa codigo->nome tem de vir de regioes_ibge.json (correto), e nao ser
// sobrescrito pelos nomes corrompidos do JSON de mesorregiao.
const nomeCastro = vm.runInContext(
  `String(STATE.muniCodeToNameMap?.get(${JSON.stringify(CASTRO)}) || '')`, ctx, { filename: 'nome.js' });
ok(nomeCastro === 'Castro', `muniCodeToNameMap[${CASTRO}] = "Castro"`, `valor: ${nomeCastro || '(vazio)'}`);

// ---------------------------------------------- features sinteticas de 1994
// 1989/1994 nao tem locais de votacao: as features sao sinteticas, uma por
// municipio. Como o filtro casa SO por codigo IBGE, elas precisam carregar
// cod_localidade_ibge — sem isso nenhuma passa no recorte e o painel de
// resultados fica vazio ao filtrar uma regiao (foi o que aconteceu com
// deputado federal/estadual de 1994).
const buildDeputyBase = vm.runInContext('buildDeputyBaseGeojson1994', ctx, { filename: 'dep.js' });
const payloadPE = lerZipEntrada(
  path.join(RAIZ, 'resultados_geo/Legislativas 1994/deputados_federal_1994_PE.zip'));
const metaPE = payloadPE.METADATA;
const basePE = buildDeputyBase(
  payloadPE.RESULTS,
  new Map(Object.entries(metaPE.muni_names || {})),
  metaPE.muni_turnout,
  new Map(Object.entries(metaPE.muni_ibge || {})));

ok(basePE.features.length === 177, 'deputados 1994 PE: 177 municipios sinteticos',
  `${basePE.features.length}`);
ok(basePE.features.every((f) => /^\d{7}$/.test(String(f.properties.cod_localidade_ibge || ''))),
  'toda feature sintetica de deputado carrega o codigo IBGE');

// Com uma regiao de PE filtrada, o painel agrega um subconjunto NAO VAZIO.
const umaRegiaoPE = Object.keys(
  JSON.parse(readFileSync(path.join(RAIZ, 'resultados_geo/regioes_index.json'), 'utf8'))
    .niveis.rgint.PE)[0];
vm.runInContext(`
  STATE.currentElectionType = 'geral';
  dom.selectUFGeneral = { value: 'PE' };
  currentRegionFilter = { level: 'rgint', code: ${JSON.stringify(umaRegiaoPE)} };
`, ctx, { filename: 'pe.js' });
const dentroPE = basePE.features.filter((f) => matches(f.properties));
ok(dentroPE.length > 0 && dentroPE.length < basePE.features.length,
  'deputado 1994: regiao de PE agrega um subconjunto proprio',
  `${dentroPE.length} de ${basePE.features.length}`);

// ---------------------------------------------- colisao de codigo entre niveis
// CD_MESO e CD_RGINT tem ambos 4 digitos e 122 codigos existem nos DOIS niveis
// (4102 e mesorregiao "Centro Ocidental Paranaense" e tambem regiao
// intermediaria "Ponta Grossa"). Se o filtro comparar codigo sem o nivel junto,
// selecionaria a regiao errada em silencio.
const featsHd = malha('resultados_geo/municipios_hd/municipios_PR.geojson');
cenario('geral', { level: 'meso', code: '4102' });
const porMeso = dentro(featsHd).map((f) => String(f.properties.CD_MUN)).sort();
cenario('geral', { level: 'rgint', code: '4102' });
const porRgint = dentro(featsHd).map((f) => String(f.properties.CD_MUN)).sort();

ok(porMeso.length > 0 && porRgint.length > 0, 'codigo 4102 existe em meso e rgint',
  `meso ${porMeso.length} municipios, rgint ${porRgint.length}`);
ok(JSON.stringify(porMeso) !== JSON.stringify(porRgint),
  'mesmo codigo em niveis diferentes seleciona municipios diferentes');

// ---------------------------------------------- contagens do indice
const indice = JSON.parse(readFileSync(path.join(RAIZ, 'resultados_geo/regioes_index.json'), 'utf8'));
[['meso', 10], ['micro', 39], ['rgint', 6], ['rgi', 29]].forEach(([level, esperado]) => {
  const n = Object.keys(indice.niveis[level].PR || {}).length;
  ok(n === esperado, `indice: PR tem ${esperado} de ${level}`, `${n}`);
});

// ---------------------------------------------- recorte da camada do mapa
// O predicado estar certo nao basta: o filtro so chega ao mapa se as features
// da camada forem REPOSTAS. Era essa a metade que faltava — todos os caminhos
// que nao recriam a camada (refresh de estilo, troca de turno, toggle 3D) so
// re-estilizam, e o mapa ficava com o estado inteiro desenhado.

const aplicar = vm.runInContext('applyRegionScopeToMunicipiosLayer', ctx, { filename: 'aplicar.js' });
const feats1989 = malha('resultados_geo/municipios_1989/municipios_1989_PR.geojson');

// Camada de mentira com a mesma interface que a GeoLayer expoe aqui.
const camadaFalsa = () => ({
  __ufFeatures: feats1989,
  fc: { features: feats1989 },
  setFeatures(f) { this.fc = { type: 'FeatureCollection', features: f }; return this; }
});

cenario('geral', REGIAO);
const camada = camadaFalsa();
ok(aplicar(camada) === true, 'camada: recorte aplicado');
ok(camada.fc.features.length === 11, 'camada: fica so com a regiao',
  `${camada.fc.features.length} features`);

// A regressao de verdade: trocar de regiao numa camada JA existente.
cenario('geral', 'all');
aplicar(camada);
ok(camada.fc.features.length === feats1989.length,
  'camada: volta ao estado inteiro ao limpar a regiao', `${camada.fc.features.length} features`);

cenario('geral', REGIAO);
aplicar(camada);
ok(camada.fc.features.length === 11, 'camada: reaplica o recorte sem recriar');

ok(aplicar({ setFeatures() {} }) === false, 'camada sem __ufFeatures e ignorada');
ok(aplicar(null) === false, 'camada ausente e ignorada');

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo ok.');
process.exit(falhas ? 1 : 0);
