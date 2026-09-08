// O suplemento do CEM cobre so' a RM de Sao Paulo. Sem trava de UF, as 295
// estacoes entravam no geojson de qualquer estado e os votos paulistas eram
// relidos com a metadata do estado carregado -- no 2o turno de 1998 o numero 45
// (Covas, em SP) virava "ALMIR GABRIEL" e somava 678.959 votos ao Para.
//
//   node test_rmsp_secoes_1998.js

const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync('js/data-geral-2006.js', 'utf8');
const start = src.indexOf('async function applyRmspSecoes1998');
assert.ok(start >= 0, 'applyRmspSecoes1998 nao encontrada');
let depth = 0, i = src.indexOf('{', start);
const open = i;
do { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; i++; } while (depth > 0);
const fonte = src.slice(start, i);
assert.ok(open < i, 'corpo da funcao nao delimitado');

const ESTACAO = {
  chave: '1_71072_S1', long: -46.6, lat: -23.5, nm_locvot: 'ESCOLA SP',
  nm_localidade: 'SAO PAULO', cd_localidade_tse: '71072', nr_zona: 1,
  votos: { governador: { '2T': { '45': 1011, '11': 866, '95': 41, '96': 108 } } }
};

const ctx = {
  console,
  loadRmspSupplement: async () => ({ 1998: { estacoes: [ESTACAO], secoes_cobertas: ['1_71072_S1'] } }),
  applyTurnMetricsFromJsonVotes: () => {},
  ensureNumber: (v) => Number(v) || 0
};
vm.createContext(ctx);
vm.runInContext(`${fonte}; this.applyRmspSecoes1998 = applyRmspSecoes1998;`, ctx);

// metadata do PA: o numero 45 la' e' Almir Gabriel, nao Covas.
const mergedPA = { METADATA: { cand_names: { 45: ['ALMIR GABRIEL', 'PSDB', 'ELEITO'] } }, RESULTS: { '9_4014_1': {} } };
const geo = (uf) => ({ features: [{ properties: { id_unico: '9_4014_1', sg_uf: uf } }] });

(async () => {
  const fora = geo('PA');
  const cobertasFora = await ctx.applyRmspSecoes1998(fora, 'governador', mergedPA, '2T', new Map(), ['PA']);
  assert.strictEqual(fora.features.length, 1, 'estacao de SP vazou para o geojson do PA');
  assert.strictEqual(cobertasFora.size, 0, 'secoes cobertas de SP vazaram para o PA');
  assert.ok(
    !('ALMIR GABRIEL (PSDB) (ELEITO) 2T' in fora.features[0].properties),
    'votos de SP foram rotulados com candidato do PA'
  );

  const dentro = geo('SP');
  const cobertasDentro = await ctx.applyRmspSecoes1998(dentro, 'governador', mergedPA, '2T', new Map(), ['SP']);
  assert.strictEqual(dentro.features.length, 2, 'estacao do CEM nao entrou no proprio SP');
  assert.strictEqual(cobertasDentro.size, 1, 'secoes cobertas nao voltaram em SP');

  // presidente/BR carrega todas as UFs: SP tem de continuar valendo.
  const brasil = geo('SP');
  await ctx.applyRmspSecoes1998(brasil, 'governador', mergedPA, '2T', new Map(), ['PA', 'SP', 'RJ']);
  assert.strictEqual(brasil.features.length, 2, 'escopo nacional perdeu as estacoes de SP');

  console.log('ok');
})();
