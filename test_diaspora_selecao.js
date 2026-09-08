// Clique no pais / na urna do exterior: o painel tem de trocar de recorte, o
// segundo clique no mesmo alvo tem de voltar ao exterior inteiro, e um recorte
// que nao existe no turno aberto tem de cair no agregado em vez de mostrar zero.
//
//   node test_diaspora_selecao.js

const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const ctx = {
  console,
  DATA_BASE_URL: '',
  STATE: {},
  window: {},
  map: null,
  ensureNumber: (v) => Number(v) || 0,
  fmtInt: (v) => String(v),
  norm: (s) => String(s || '').trim().toUpperCase(),
  toTitleCase: (s) => String(s || ''),
  isDiasporaScope: () => true
};
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync('js/diaspora-view.js', 'utf8')
  + `; this.api = {
       set nomes(m) { DIASPORA_COUNTRY_NAMES = m; },
       get selecao() { return diasporaSelection; },
       diasporaPanelScope, setDiasporaSelection, clearDiasporaSelection,
       diasporaConsulateKey, diasporaClickHitConsulate
     };`,
  ctx
);
const api = ctx.api;
api.nomes = new Map([['PRT', 'Portugal'], ['JPN', 'Japão']]);

const byTurn = {
  '1T': {
    METADATA: { cand_names: { 13: ['LULA', 'PT', 'ELEITO'], 22: ['JAIR BOLSONARO', 'PL', 'N/D'] } },
    RESULTS: {
      PRT: { 13: 100, 22: 60, 95: 2, 96: 3 },
      JPN: { 13: 10, 22: 40 }
    },
    CONSULADOS: [
      { cd: '1', nome: 'Lisboa', iso3: 'PRT', votos: { 13: 70, 22: 30 } },
      { cd: '2', nome: 'Porto', iso3: 'PRT', votos: { 13: 30, 22: 30 } },
      { cd: '3', nome: 'Tóquio', iso3: 'JPN', votos: { 13: 10, 22: 40 } }
    ]
  },
  // 2o turno so em Portugal: o Japao selecionado tem de cair no agregado.
  '2T': {
    METADATA: { cand_names: { 13: ['LULA', 'PT', 'ELEITO'], 22: ['JAIR BOLSONARO', 'PL', 'N/D'] } },
    RESULTS: { PRT: { 13: 120, 22: 80 } },
    CONSULADOS: [{ cd: '1', nome: 'Lisboa', iso3: 'PRT', votos: { 13: 120, 22: 80 } }]
  }
};

// Sem selecao o painel e o exterior inteiro.
assert.strictEqual(api.diasporaPanelScope(byTurn, '1T'), null);

// Clique no pais.
api.setDiasporaSelection('pais', 'PRT');
let scope = api.diasporaPanelScope(byTurn, '1T');
assert.strictEqual(scope.titulo, 'Portugal');
assert.strictEqual(scope.escopo, '2 urnas', 'contagem de urnas do pais');
assert.deepStrictEqual(scope.votos, { 13: 100, 22: 60, 95: 2, 96: 3 });

// Clique de novo no mesmo pais volta ao exterior inteiro.
api.setDiasporaSelection('pais', 'PRT');
assert.strictEqual(api.selecao, null, 'segundo clique nao desfez a selecao');

// Clique na urna: votos da urna, e o pais vira o subtitulo.
api.setDiasporaSelection('urna', '2');
scope = api.diasporaPanelScope(byTurn, '1T');
assert.strictEqual(scope.titulo, 'Porto');
assert.strictEqual(scope.escopo, 'Portugal');
assert.deepStrictEqual(scope.votos, { 13: 30, 22: 30 });

// Urna que nao abriu no 2o turno: painel volta ao agregado.
assert.strictEqual(api.diasporaPanelScope(byTurn, '2T'), null, 'urna ausente no 2T deveria cair no agregado');

// Pais sem 2o turno idem.
api.setDiasporaSelection('pais', 'JPN');
assert.ok(api.diasporaPanelScope(byTurn, '1T'), 'Japao existe no 1T');
assert.strictEqual(api.diasporaPanelScope(byTurn, '2T'), null, 'pais ausente no 2T deveria cair no agregado');

api.clearDiasporaSelection();
assert.strictEqual(api.selecao, null);

// 1989/1994 nao tem codigo de urna: a chave e o iso3, senao todos os pontos do
// mundo colapsam na mesma entrada.
assert.strictEqual(api.diasporaConsulateKey({ cd: '7', iso3: 'PRT' }), '7');
assert.strictEqual(api.diasporaConsulateKey({ iso3: 'PRT' }), 'PRT');

// O circulo por cima cala o poligono de baixo no mesmo clique.
ctx.map = { getLayer: () => ({}), queryRenderedFeatures: () => [{}] };
assert.strictEqual(api.diasporaClickHitConsulate({ point: { x: 1, y: 1 } }), true);
ctx.map.queryRenderedFeatures = () => [];
assert.strictEqual(api.diasporaClickHitConsulate({ point: { x: 1, y: 1 } }), false);

console.log('ok');
