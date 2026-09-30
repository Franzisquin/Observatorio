// Teste ponta a ponta do comparecimento de um municipio no mapa municipal.
// Rode com:  node scripts/check_sbc_comparecimento.js
//
// POR QUE ESTE TESTE EXISTE
// São Bernardo do Campo aparecia com 475.658 votos e "100,00%" de
// comparecimento em 2024, sobre "120 locais agregados" — de 166 que a eleição
// teve. Nenhum teste de unidade pega isso, porque o erro não está em nenhuma
// função isolada: está na combinação de três coisas que só se encontram no
// caminho real —
//
//   1. o eleitorado sai das FEIÇÕES do mapa (GPKG + Censo), enquanto o
//      comparecimento oficial sai do JSON de resultados, que tem o município
//      inteiro. Se as feições cobrem só parte dos locais, divide-se o voto de
//      166 locais pelo eleitorado de 120;
//   2. mergeCensoJson2024 sobrescreve id_unico da feição com o local_key do
//      Censo, e filterMunicipalFeatures2024 descarta do mapa toda feição cujo
//      id_unico não esteja nos resultados. Um local_key com formato errado no
//      Censo apaga a feição do mapa;
//   3. getTurnoutStatsForSelection troca o comparecimento somado pelo oficial
//      do município quando ele cabe no eleitorado — o que só é válido se as
//      feições cobrirem o município todo.
//
// As fixtures em scripts/fixtures/ são os dados reais de São Bernardo: os 166
// locais do GPKG, o Censo do município e o boletim de prefeito de 2024.
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');

const ctx = {
  console: { log() {}, warn() {}, error() {} },
  window: {},
  document: { getElementById: () => null, querySelectorAll: () => [] }
};
ctx.STATE = {
  currentElectionYear: '2024', currentElectionType: 'municipal',
  censusFilters: {}, isFilterAggregationActive: true
};
vm.createContext(ctx);

const NL = String.fromCharCode(10);
const fonte = ['js/utils.js', 'js/globals.js', 'js/data-zip.js', 'js/data-municipal.js']
  .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join(NL + ';' + NL);
vm.runInContext(fonte + NL + `globalThis.__t = {
  buildMunicipal2024Feature, mergeCensoJson2024, filterMunicipalFeatures2024,
  getTurnoutStatsForSelection, getFeatureAptosCount
};`, ctx, { filename: 'bundle.js' });
const t = ctx.__t;

const ler = (nome) => JSON.parse(fs.readFileSync(path.join(FIX, nome), 'utf8'));
const gpkg = ler('gpkg_sbc_2024.json');
const censo = ler('censo_sbc_2024.json');
const boletim = ler('prefeito_sbc_2024.json');
const MUNI = '70750';

let n = 0;
const eq = (a, b, msg) => { assert.strictEqual(a, b, msg); n++; };

// --- o caminho real: GPKG -> Censo -> filtro pelos resultados ---------------
const base = { type: 'FeatureCollection',
  features: gpkg.map((row) => t.buildMunicipal2024Feature(row, MUNI)) };
eq(base.features.length, 166, 'o GPKG tem os 166 locais de São Bernardo');

t.mergeCensoJson2024(base, censo, MUNI, 'SAO BERNARDO DO CAMPO');

const resultKeys = new Set(Object.keys(boletim.RESULTS));
const filtrado = t.filterMunicipalFeatures2024(base, resultKeys, 'prefeito');
eq(filtrado.features.length, 166,
  'todas as 166 feições sobrevivem ao filtro — se cair para 120, o local_key do '
  + 'Censo voltou a ter formato errado e o mapa perdeu locais');

// --- comparecimento e eleitorado, como o painel calcula ---------------------
let comparecimentoOficial = 0;
Object.values(boletim.RESULTS).forEach((votos) => {
  Object.values(votos).forEach((v) => { comparecimentoOficial += Number(v) || 0; });
});
eq(comparecimentoOficial, 475658, 'comparecimento do boletim de São Bernardo');

const props = filtrado.features.map((f) => f.properties);
props.forEach((p) => {
  // O painel lê o comparecimento da feição dos campos de voto; aqui basta o
  // eleitorado, que é o que estava errado.
  p['Total_Votos_Validos 1T'] = 0;
  p['Votos_Brancos 1T'] = 0;
  p['Votos_Nulos 1T'] = 0;
});
const aptos = props.reduce((s, p) => s + t.getFeatureAptosCount(p, 0, '1T'), 0);
eq(aptos, 643023, 'eleitorado de São Bernardo em 2024 (oficial do TSE)');

const taxa = comparecimentoOficial / aptos * 100;
assert.ok(taxa > 73 && taxa < 75,
  'comparecimento de São Bernardo saiu em ' + taxa.toFixed(2) + '%, fora da faixa dos 74% '
  + '(era 100,43% quando as feições cobriam só 120 dos 166 locais)');
n++;

// --- nenhuma feição pode ficar sem denominador ------------------------------
const semAptos = props.filter((p) => !(t.getFeatureAptosCount(p, 0, '1T') > 0));
eq(semAptos.length, 0,
  semAptos.length + ' locais de São Bernardo sem eleitorado: o voto deles entraria '
  + 'na conta sem denominador por baixo');

console.log('OK - comparecimento de São Bernardo 2024: ' + taxa.toFixed(2) + '%, '
  + filtrado.features.length + ' locais, ' + n + ' checagens passaram');
