// Checagem do denominador de comparecimento. Rode com:  node scripts/check_eleitorado_aptos.js
//
// O que isto protege (ver analise_eleitorado_denominador.md):
//   - local que herdou o eleitorado do vizinho ('parquet_vizinho') NAO pode virar
//     denominador. Em Balbinos (SP) as duas penitenciarias herdaram 1.442
//     eleitores cada, contra 62 e 50 reais, e o municipio aparecia com 26,2% de
//     comparecimento no lugar de 74,0%;
//   - a soma MASCULINO+FEMININO vem do mesmo vetor copiado, entao tambem nao
//     serve de porta dos fundos;
//   - os 262 locais de 2022 ja corrigidos com o eleitorado oficial do TSE
//     (fonte 'oficial_local_votacao') continuam valendo como denominador;
//   - o acervo Censo 2022 nao voltou a ter eleitorado herdado inflado.
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const zlib = require('zlib');
const ROOT = path.join(__dirname, '..');

const ctx = { console: { log() {}, warn() {}, error() {} }, window: {},
  document: { getElementById: () => null, querySelectorAll: () => [] } };
ctx.STATE = { currentElectionYear: '2022', currentElectionType: 'geral', censusFilters: {} };
vm.createContext(ctx);

const NL = String.fromCharCode(10);
const fonte = ['js/utils.js', 'js/globals.js', 'js/data-zip.js']
  .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join(NL + ';' + NL);
vm.runInContext(fonte + NL + 'globalThis.__t = { getFeatureAptosCount };', ctx,
  { filename: 'bundle.js' });
const { getFeatureAptosCount } = ctx.__t;

let n = 0;
const eq = (a, b, msg) => { assert.strictEqual(a, b, msg); n++; };

// --- 1. o valor herdado do vizinho nao vira denominador -----------------------
const penitenciaria = {
  TOTAL_ELEITORES_PERFIL: 1442, TOTAL_ELEITORES_FONTE: 'parquet_vizinho',
  MASCULINO: 709, FEMININO: 733
};
eq(getFeatureAptosCount(penitenciaria, 38), 0,
  'eleitorado herdado do vizinho nao pode virar denominador');
eq(getFeatureAptosCount(penitenciaria, 0), 0,
  'nem quando nao ha comparecimento para comparar');

// --- 2. o mesmo local depois da correcao oficial vale ------------------------
eq(getFeatureAptosCount({
  TOTAL_ELEITORES_PERFIL: 62, TOTAL_ELEITORES_FONTE: 'oficial_local_votacao',
  MASCULINO: 30, FEMININO: 32
}, 38), 62, 'eleitorado corrigido com o oficial do TSE vale como denominador');

// --- 2b. Eleitores_Aptos oficial do Censo tem prioridade sobre o cadastro -----
// O Censo ganhou um campo Eleitores_Aptos vindo do eleitorado_local_votacao do
// TSE: quantos eleitores VOTAM ali, que nao e o mesmo que quantos estao
// cadastrados ali (secao agregada vota no local principal).
eq(getFeatureAptosCount({
  Eleitores_Aptos: 3800, TOTAL_ELEITORES_PERFIL: 3098,
  TOTAL_ELEITORES_FONTE: 'parquet'
}, 2900), 3800, 'Eleitores_Aptos oficial tem prioridade sobre TOTAL_ELEITORES_PERFIL');

// Local que so existe no cadastro oficial entra sem perfil demografico.
eq(getFeatureAptosCount({
  Eleitores_Aptos: 2610, TOTAL_ELEITORES_PERFIL: null,
  TOTAL_ELEITORES_FONTE: 'ausente_no_censo'
}, 1930), 2610, 'local acrescentado do cadastro oficial vale como denominador');

// --- 3. local normal segue como antes ----------------------------------------
eq(getFeatureAptosCount({
  TOTAL_ELEITORES_PERFIL: 1442, TOTAL_ELEITORES_FONTE: 'parquet',
  MASCULINO: 709, FEMININO: 733
}, 1133), 1442, 'local casado no perfil continua valendo');

// Eleitores_Aptos, quando existe, tem prioridade e nao depende da fonte do Censo.
eq(getFeatureAptosCount({
  'Eleitores_Aptos 1T': 1532, TOTAL_ELEITORES_PERFIL: 1442,
  TOTAL_ELEITORES_FONTE: 'parquet_vizinho'
}, 1133), 1532, 'Eleitores_Aptos do acervo por local continua tendo prioridade');

// --- 4. o acervo de 2022 nao tem mais eleitorado herdado inflado --------------
// Le censo_2022_SP.zip direto (deflate cru dentro do zip) e confere Balbinos.
function lerZip(arquivo, alvo) {
  const buf = fs.readFileSync(arquivo);
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) !== 0x06054b50) continue;
    let off = buf.readUInt32LE(i + 16);
    const total = buf.readUInt16LE(i + 10);
    for (let k = 0; k < total; k++) {
      const nLen = buf.readUInt16LE(off + 28), mLen = buf.readUInt16LE(off + 30);
      const cLen = buf.readUInt16LE(off + 32), metodo = buf.readUInt16LE(off + 10);
      const nome = buf.toString('utf8', off + 46, off + 46 + nLen);
      const local = buf.readUInt32LE(off + 42);
      if (nome === alvo) {
        const lnLen = buf.readUInt16LE(local + 26), lmLen = buf.readUInt16LE(local + 28);
        const ini = local + 30 + lnLen + lmLen;
        const bruto = buf.subarray(ini, ini + buf.readUInt32LE(off + 20));
        return metodo === 0 ? bruto : zlib.inflateRawSync(bruto);
      }
      off += 46 + nLen + mLen + cLen;
    }
  }
  throw new Error('entrada nao encontrada: ' + alvo);
}

const sp = JSON.parse(lerZip(
  path.join(ROOT, 'resultados_geo', 'Censo 2022', 'censo_2022_SP.zip'),
  'censo_2022_SP.json').toString('utf8'));

const balbinos = Object.values(sp.RESULTS)
  .filter((r) => Number(r.cd_localidade_tse) === 61930);
eq(balbinos.length, 3, 'Balbinos (SP) tem 3 locais de votacao');
const totalBalbinos = balbinos.reduce((s, r) => s + Number(r.TOTAL_ELEITORES_PERFIL || 0), 0);
assert.ok(totalBalbinos < 1800,
  'eleitorado de Balbinos voltou a inflar: ' + totalBalbinos + ' (oficial: 1.532)');
n++;

const herdadosInflados = Object.values(sp.RESULTS).filter(
  (r) => r.TOTAL_ELEITORES_FONTE === 'parquet_vizinho'
    && Number(r.TOTAL_ELEITORES_PERFIL || 0) > 500);
eq(herdadosInflados.length, 0,
  'ha local em SP com eleitorado herdado acima de 500 — rode scripts/corrigir_eleitorado_censo_2022.py');

// --- 5. Eleitores_Aptos de 2018 nao voltou ao valor inflado -------------------
// A coluna somava 31,0 milhoes em MG contra 15,68 milhoes reais — o dobro. Se
// presidente_por_estado2018_*.zip for regerado sem passar por
// scripts/corrigir_aptos_presidente_por_estado.py, isto pega.
const mg = JSON.parse(lerZip(
  path.join(ROOT, 'resultados_geo', 'presidente_por_estado2018_4.zip'),
  'presidente_MG_2018.geojson').toString('utf8'));

const aptosMG = mg.features.reduce(
  (s, f) => s + (Number(f.properties['Eleitores_Aptos 1T']) || 0), 0);
assert.ok(aptosMG > 14e6 && aptosMG < 17e6,
  'eleitorado apto de MG em 2018 fora da faixa plausivel: ' + aptosMG
  + ' (real: ~15,68 milhoes; o valor inflado do acervo era 31,0 milhoes)');
n++;

// Cada turno tem o seu eleitorado nos anos reconstruidos — nao e copia do 1T.
const difTurnos = mg.features.some((f) => {
  const a1 = f.properties['Eleitores_Aptos 1T'], a2 = f.properties['Eleitores_Aptos 2T'];
  return a1 != null && a2 != null && a1 !== a2;
});
assert.ok(difTurnos, 'Eleitores_Aptos 2T de 2018 virou copia literal do 1T');
n++;

// --- 6. Sao Bernardo do Campo 2024 -------------------------------------------
// O Censo tinha 45 locais extintos e nao tinha os 46 que funcionaram: o
// municipio aparecia com 100,4% de comparecimento, porque os votos desses 46
// entravam sem denominador. scripts/gerar_eleitorado_apto_oficial.py acerta o
// cadastro pelo arquivo do TSE.
const sp24 = JSON.parse(lerZip(
  path.join(ROOT, 'resultados_geo', 'Censo 2024', 'censo_2024_SP.zip'),
  'censo_2024_SP.json').toString('utf8'));

const sbc = Object.values(sp24.RESULTS)
  .filter((r) => Number(r.cd_localidade_tse) === 70750);
eq(sbc.length, 166, 'Sao Bernardo do Campo tem 166 locais de votacao em 2024');

const aptosSBC = sbc.reduce((s, r) => s + (Number(r.Eleitores_Aptos) || 0), 0);
eq(aptosSBC, 643023, 'eleitorado apto de Sao Bernardo em 2024 (oficial do TSE)');
// 475.658 votos: comparecimento tem de cair na faixa dos 74%, nao em 100%.
const compSBC = 475658 / aptosSBC * 100;
assert.ok(compSBC > 70 && compSBC < 78,
  'comparecimento de Sao Bernardo em 2024 fora da faixa: ' + compSBC.toFixed(2) + '%');
n++;

console.log('OK - denominador de comparecimento: ' + n + ' checagens passaram');
