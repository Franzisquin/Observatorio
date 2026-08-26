// Checagem dos filtros demograficos do visualizador. Rode com:  node scripts/check_filtros_demograficos.js
//
// Cobre o que quebrou antes e nao aparece em teste de sintaxe:
//   - leitura das chaves ACENTUADAS do acervo ('ENSINO MÉDIO COMPLETO', 'LÊ E ESCREVE'),
//     que literais com mojibake nunca casavam;
//   - o formato "Pct ..." legado, que a barra de disponibilidade descartava enquanto
//     o filtro do mapa aceitava;
//   - quais anos tem censo (1998/2002 nao tem nenhum; 2006 nao tem perfil do TSE);
//   - local sem dado de renda nao pode contar como R$ 0 num filtro de baixa renda.
//
// A fixture reproduz as chaves reais de resultados_geo/Censo <ANO>/censo_<ANO>_<UF>.zip.
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '..');

const ctx = { console: { log() {}, warn() {}, error() {} }, window: {},
  document: { getElementById: () => null, querySelectorAll: () => [] } };
ctx.STATE = { currentElectionYear: '2022', currentElectionType: 'geral', censusFilters: {} };
vm.createContext(ctx);

// No browser os scripts dividem o escopo lexico global (um `const` de utils.js e
// visivel em globals.js). No vm do Node cada script e isolado, entao vao juntos.
const NL = String.fromCharCode(10);
const fonte = ['js/utils.js', 'js/globals.js']
  .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join(NL + ';' + NL);
vm.runInContext(fonte + NL + 'globalThis.__t = { readEscolaridadeAcc, getEscolaridadeGroupedValue,'
  + ' censusCoverageForYear, isLimitedCensusYear2006, ensureNumber };', ctx, { filename: 'bundle.js' });
const { readEscolaridadeAcc, getEscolaridadeGroupedValue,
        censusCoverageForYear, isLimitedCensusYear2006, ensureNumber } = ctx.__t;

// Chaves exatamente como saem do acervo (perfil do eleitorado do TSE, absolutos).
const LOCAL = {
  nm_locvot: 'ESCOLA EXEMPLO', 'Renda Media': 1864.8,
  'ANALFABETO': 12, 'LÊ E ESCREVE': 30,
  'ENSINO FUNDAMENTAL INCOMPLETO': 520, 'ENSINO FUNDAMENTAL COMPLETO': 180,
  'ENSINO MÉDIO INCOMPLETO': 210, 'ENSINO MÉDIO COMPLETO': 690,
  'SUPERIOR INCOMPLETO': 140, 'SUPERIOR COMPLETO': 211,
  'TOTAL_ELEITORES_PERFIL': 1993
};

// 1. Le todos os oito niveis, inclusive os acentuados.
const esc = readEscolaridadeAcc(LOCAL);
assert.strictEqual(esc.isPct, false, 'absolutos nao sao Pct');
assert.strictEqual(esc.acc.mc, 690, "'ENSINO MÉDIO COMPLETO' (acentuado) tem que ser lido");
assert.strictEqual(esc.acc.le, 30, "'LÊ E ESCREVE' (acentuado) tem que ser lido");
assert.strictEqual(esc.acc.sc, 211, "'SUPERIOR COMPLETO' (sem prefixo ENSINO) tem que ser lido");
assert.strictEqual(esc.total, 1993, 'total tem que bater com TOTAL_ELEITORES_PERFIL');

// 2. As quatro faixas particionam o total: nada some, nada conta duas vezes.
const FAIXAS = ['Sem escolaridade', 'Fundamental', 'Médio', 'Superior'];
const soma = FAIXAS.reduce((a, m) => a + getEscolaridadeGroupedValue(m, esc.acc), 0);
assert.strictEqual(soma, esc.total, `faixas somam ${soma}, total e ${esc.total}`);
assert.strictEqual(getEscolaridadeGroupedValue('Superior', esc.acc), 211);
// "Fundamental" e uma FAIXA (incompleto + completo + medio incompleto), nao "quem concluiu".
assert.strictEqual(getEscolaridadeGroupedValue('Fundamental', esc.acc), 520 + 180 + 210);

// 3. Formato Pct legado: denominador 100, nao a soma dos niveis presentes.
const pct = readEscolaridadeAcc({ 'Pct Superior Completo': 30, 'Pct Médio Completo': 20 });
assert.strictEqual(pct.isPct, true, 'chaves "Pct ..." tem que ser reconhecidas');
assert.strictEqual(pct.denominador, 100, 'em Pct o denominador e 100');
assert.strictEqual(getEscolaridadeGroupedValue('Superior', pct.acc), 30);

// 4. Cobertura de censo por ano.
const cob = (ano, tipo) => Array.from(censusCoverageForYear(ano, tipo)).join(',');
assert.strictEqual(cob('1998', 'geral'), '', '1998 tem locais de votacao mas nenhum censo');
assert.strictEqual(cob('2002', 'geral'), '', '2002 tem locais de votacao mas nenhum censo');
assert.strictEqual(cob('2004', 'municipal'), '', '2004 municipal nao tem censo');
assert.ok(!censusCoverageForYear('2006', 'geral').includes('tab-idade'), '2006 nao tem perfil do TSE');
assert.ok(censusCoverageForYear('2006', 'geral').includes('tab-renda'), '2006 tem renda');
assert.ok(censusCoverageForYear('2022', 'geral').includes('tab-escolaridade'), '2022 tem tudo');
assert.strictEqual(isLimitedCensusYear2006('2006', 'geral'), true);
assert.strictEqual(isLimitedCensusYear2006('2022', 'geral'), false);
assert.strictEqual(isLimitedCensusYear2006('1998', 'geral'), false, 'sem censo != censo limitado');

// 5. Local sem dado de renda nao e local de renda zero.
//    Replica das linhas de renda de filterFeature (js/map-render.js).
function passaRenda(props, f) {
  const renda = ensureNumber(props['Renda Media']);
  const tem = f.rendaMin !== null || f.rendaMax !== null;
  if (tem && !(renda > 0)) return false;
  if (f.rendaMin !== null && renda < f.rendaMin) return false;
  if (f.rendaMax !== null && renda > f.rendaMax) return false;
  return true;
}
const SEM_CENSO = { nm_locvot: 'ESCOLA SEM CENSO' };
assert.strictEqual(passaRenda(SEM_CENSO, { rendaMin: null, rendaMax: 2000 }), false,
  'local sem censo entrava como R$ 0 e virava "baixa renda" no mapa');
assert.strictEqual(passaRenda(SEM_CENSO, { rendaMin: null, rendaMax: null }), true,
  'sem filtro de renda, local sem censo continua visivel');
assert.strictEqual(passaRenda(LOCAL, { rendaMin: 1000, rendaMax: 2000 }), true);
assert.strictEqual(passaRenda({ 'Renda Media': 2000 }, { rendaMin: null, rendaMax: 2000 }), true,
  'limite superior inclusivo, como o >= dos demais filtros');
assert.strictEqual(passaRenda({ 'Renda Media': 900 }, { rendaMin: 1000, rendaMax: null }), false);

console.log('OK - filtros demograficos: 24 checagens passaram');
