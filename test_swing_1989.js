// Trava o swingometro comparando eleicoes ANTIGAS, contra os arquivos reais do
// acervo e a malha municipal real de MG (853 poligonos). Dois cenarios:
//
// 1) Governador 1994 1o x 2o turno — o caso reportado. Os dois lados tem os
//    MESMOS 756 municipios, mas o mapa desenha a malha vigente: 97 poligonos
//    ficam vazios porque sao municipios emancipados depois de 1994. Nao e falha
//    de dado, e o status precisa dizer isso — contando contra a MALHA, ja que a
//    diferenca entre os dois lados aqui e zero.
//
// 2) Presidente 1989 2o turno x 1994 1o turno — 1989 e o unico ano cujo RESULTS
//    ja vem chaveado por IBGE-7 em vez do codigo TSE. buildSwingSideAggregates
//    usava o valor cru como chave de byMuni, mas o poligono e o rollup regional
//    falam TSE: a interseccao dava ZERO e o mapa saia inteiro vazio.
//
//   node test_swing_1989.js

const fs = require('fs');
const vm = require('vm');
const zlib = require('zlib');
const assert = require('assert');

// Os zips majoritarios de 1989/1994 tem UMA entrada, entao o local file header
// esta no offset 0 — nao precisa percorrer o central directory.
function unzipUnico(caminho) {
  const buf = fs.readFileSync(caminho);
  assert.strictEqual(buf.readUInt32LE(0), 0x04034b50, `${caminho}: nao comeca num local file header`);
  const method = buf.readUInt16LE(8);
  const compSize = buf.readUInt32LE(18);
  const start = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28);
  const raw = buf.subarray(start, start + compSize);
  // latin1 preserva os bytes; so usamos chaves e numeros, nao os acentos.
  return JSON.parse((method === 8 ? zlib.inflateRawSync(raw) : raw).toString('latin1'));
}

function loadApp(tseToIbge) {
  const src = ['js/utils.js', 'js/swing-view.js']
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n;\n')
    + `\n;globalThis.__api = {
         SWING, buildSwingSideAggregates, swingRowsForLevel, swingKeyForFeature,
         countSwingBlanks, swingStatusSummary, swingEmptyReason, swingYearLabel,
         swingMeshYear
       };`;

  // TSE_TO_IBGE mora em globals.js, que faz bootstrap de DOM no topo. Injetar a
  // ponte ja pronta e mais barato do que arrastar aquele arquivo para ca.
  const ctx = vm.createContext({ console, TSE_TO_IBGE: tseToIbge, toTitleCase: (s) => String(s || '') });
  vm.runInContext(src, ctx, { filename: 'app-bundle.js' });
  return ctx.__api;
}

function main() {
  const ponte = new Map(Object.entries(JSON.parse(
    fs.readFileSync('resultados_geo/tse_para_ibge.json', 'utf8')
  )).map(([tse, ibge]) => [String(tse), String(ibge)]));

  const api = loadApp(ponte);
  const { SWING } = api;

  const geojson = (caminho) => JSON.parse(fs.readFileSync(caminho, 'utf8'));
  // A malha vigente tem os 853 municipios de hoje; a de 1994, os 756 que
  // existiam la — exatamente os que o acervo daquele ano traz.
  const malhaAtual = geojson('resultados_geo/municipios/municipios_MG.geojson');
  const malha1994 = geojson('resultados_geo/municipios_1994/municipios_1994_MG.geojson');
  assert.strictEqual(malhaAtual.features.length, 853);
  assert.strictEqual(malha1994.features.length, 756);

  SWING.metric = 'swing';
  SWING.level = 'municipios';
  SWING.scope = 'MG';

  /* --- 1) o caso do print: 1994 1o turno x 1994 2o turno ------------------ */
  SWING.office = 'governador';
  SWING.A = { year: '1994', turno: 1, candId: '391', meta: null, cands: [] };
  SWING.B = { year: '1994', turno: 2, candId: '391', meta: null, cands: [] };

  const t1 = api.buildSwingSideAggregates(
    { MG: unzipUnico('resultados_geo/Majoritarias 1994/governador_1994_ord_t1_MG.zip') }, '1994');
  const t2 = api.buildSwingSideAggregates(
    { MG: unzipUnico('resultados_geo/Majoritarias 1994/governador_1994_ord_t2_MG.zip') }, '1994');
  assert.strictEqual(t1.byMuni.size, 756);
  assert.strictEqual(t2.byMuni.size, 756);

  SWING.dataset = { A: t1, B: t2, granularity: 'muni' };
  SWING.rows = api.swingRowsForLevel('municipios');
  assert.strictEqual(SWING.rows.size, 756, 'os dois turnos de 1994 tem os mesmos 756 municipios');

  // Na malha vigente sobravam 97 poligonos pretos — municipios criados depois de
  // 1994, sem resultado em NENHUM dos dois turnos. Nao e ausencia de dado: e a
  // malha errada para o par.
  assert.deepStrictEqual({ ...api.countSwingBlanks(malhaAtual.features) },
    { faltaA: 0, faltaB: 0, faltaNosDois: 97 });

  // Com as duas pontas na mesma eleicao antiga, o mapa passa a usar a malha do
  // ano e nao sobra buraco nenhum.
  assert.strictEqual(api.swingMeshYear(), '1994');
  const vazios94 = api.countSwingBlanks(malha1994.features);
  SWING._semDados = vazios94;
  assert.deepStrictEqual({ ...vazios94 }, { faltaA: 0, faltaB: 0, faltaNosDois: 0 });
  assert.strictEqual(api.swingStatusSummary(), '756 municípios em ambas as eleições.');

  // Numeros do painel: Helio Calixto (391) caiu de 48,30% para 41,35%.
  const totais = (store) => [...store.values()].reduce(
    (acc, e) => ({ v: acc.v + (e.votes['391'] || 0), t: acc.t + e.total }), { v: 0, t: 0 });
  const somaA = totais(t1.byMuni);
  const somaB = totais(t2.byMuni);
  assert.strictEqual(somaA.v, 2893594);
  assert.strictEqual(somaB.v, 3081094);
  const swing = (somaB.v / somaB.t - somaA.v / somaA.t) * 100;
  assert.ok(Math.abs(swing + 6.95) < 0.05, `swing estadual fora do esperado: ${swing}`);

  // Sem o turno no rotulo o painel dizia "... em 1994 vs. ... em 1994".
  assert.strictEqual(api.swingYearLabel('A'), '1994 (1º turno)');
  assert.strictEqual(api.swingYearLabel('B', true), '1994 · 2º');

  // Todo poligono da malha de 1994 acha a sua linha.
  assert.ok(malha1994.features.every((f) => SWING.rows.has(api.swingKeyForFeature(f))),
    'poligono de 1994 sem linha de swing');

  /* --- 2) 1989, que saia com o mapa inteiro em branco --------------------- */
  const r89 = unzipUnico('resultados_geo/Majoritarias 1989/presidente_1989_t2_MG.zip');
  const r94 = unzipUnico('resultados_geo/Majoritarias 1994/presidente_1994_t1_MG.zip');

  SWING.office = 'presidente';
  SWING.A = { year: '1989', turno: 2, candId: '13', meta: null, cands: [] };
  SWING.B = { year: '1994', turno: 1, candId: '13', meta: null, cands: [] };

  const b = api.buildSwingSideAggregates({ MG: r94 }, '1994');
  assert.strictEqual(b.byMuni.size, 756);

  // Sem o ano, 1989 entra com as chaves cruas (IBGE) — o estado do bug.
  const cru = api.buildSwingSideAggregates({ MG: r89 });
  SWING.dataset = { A: cru, B: b, granularity: 'muni' };
  const semTraducao = api.swingRowsForLevel('municipios');
  assert.strictEqual(semTraducao.size, 0, 'chave crua de 1989 nao deveria casar com TSE');

  // Com o ano, a chave vira TSE e os 723 municipios de 1989 casam.
  const a = api.buildSwingSideAggregates({ MG: r89 }, '1989');
  assert.strictEqual(a.byMuni.size, 723, '1989 deveria trazer os 723 municipios de MG');
  assert.ok(!a.byMuni.has('3106200'), 'sobrou chave IBGE em byMuni');
  assert.ok(a.byMuni.has('41238'), 'Belo Horizonte deveria estar pelo codigo TSE');

  SWING.dataset = { A: a, B: b, granularity: 'muni' };
  SWING.rows = api.swingRowsForLevel('municipios');
  assert.strictEqual(SWING.rows.size, 723, 'todos os municipios de 1989 deveriam casar com 1994');

  // O poligono da malha vigente (so traz o IBGE) tem de achar a linha.
  const chaveBH = api.swingKeyForFeature({ properties: { CD_MUN: '3106200' } });
  assert.strictEqual(chaveBH, '41238');
  assert.ok(SWING.rows.has(chaveBH), 'Belo Horizonte sumiu do mapa');

  // Anos diferentes: volta para a malha vigente, e ai o vazio e legitimo. Sao
  // 130 poligonos: 33 que 1994 tem e 1989 nao, e 97 que nenhum dos dois tem.
  assert.strictEqual(api.swingMeshYear(), '', 'epocas diferentes nao tem malha comum');
  SWING._semDados = api.countSwingBlanks(malhaAtual.features);
  assert.deepStrictEqual({ ...SWING._semDados }, { faltaA: 33, faltaB: 0, faltaNosDois: 97 });
  const status89 = api.swingStatusSummary();
  assert.strictEqual(status89,
    '723 municípios em ambas as eleições · 33 sem resultado em 1989 · 97 sem resultado nos dois anos.');

  const soEm94 = [...b.byMuni.keys()].find((k) => !a.byMuni.has(k));
  assert.strictEqual(api.swingEmptyReason(soEm94), 'Sem resultado em 1989.');
  assert.strictEqual(api.swingYearLabel('A'), '1989', 'anos diferentes nao levam turno no rotulo');

  console.log('1994 t1 x t2 .............. 756 municipios em ambos');
  console.log('  malha escolhida ......... 1994 (756 poligonos)');
  console.log('  buracos ................. %d', vazios94.faltaNosDois);
  console.log('  swing estadual .......... %s p.p.', swing.toFixed(1));
  console.log('1989 x 1994 join .......... %d antes / %d depois', semTraducao.size, SWING.rows.size);
  console.log('  status .................. %s', status89);
  console.log('\nOK');
}

main();
