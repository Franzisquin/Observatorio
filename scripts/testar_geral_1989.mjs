/* Harness de validacao do fluxo das gerais de 1989, fora do browser.
 *
 * Carrega os modulos reais do site (globals/utils/data-zip/data-municipal/
 * data-geral-2002/data-geral-2022/data-geral-1989-1994) num contexto Node com
 * `document` e `fetchJsonFromZipEntry` stubados sobre os zips de
 * resultados_geo/Majoritarias 1989/, e verifica o que a UI assume verdadeiro:
 * uma feature sintetica por municipio, os dois turnos, as chaves de exibicao no
 * formato que parseCandidateKey espera, e o join do choropleth com a malha 1989
 * (todo poligono precisa achar seu resumo, senao o mapa fica cinza).
 *
 *     node scripts/testar_geral_1989.mjs
 */

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ZIPS = path.join(RAIZ, 'resultados_geo', 'Majoritarias 1989');
const MALHA = path.join(RAIZ, 'resultados_geo', 'municipios_1989');

let falhas = 0;
function ok(cond, nome, detalhe = '') {
  console.log(`${cond ? '  ok   ' : '  FALHA'} ${nome}${detalhe ? '  — ' + detalhe : ''}`);
  if (!cond) falhas++;
}

/* Leitor de ZIP minimo: os arquivos do site tem UMA entrada, gravada com
 * ZIP_DEFLATED sem descritor de dados, entao basta o local file header. */
function lerZipEntrada(zipPath) {
  const buf = readFileSync(zipPath);
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('nao e ZIP: ' + zipPath);
  const metodo = buf.readUInt16LE(8);
  const tamComprimido = buf.readUInt32LE(18);
  const inicio = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28);
  const bruto = buf.subarray(inicio, inicio + tamComprimido);
  const conteudo = metodo === 0 ? bruto : inflateRawSync(bruto);
  return JSON.parse(conteudo.toString('utf8'));
}

// ------------------------------------------------------------- ambiente

const PRELUDIO = `
  var document = {
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add(){}, remove(){}, toggle(){} } }),
    addEventListener(){}, body: { appendChild(){} }
  };
  var fetch = () => Promise.reject(new Error('sem rede no harness'));
  var localStorage = { getItem: () => null, setItem(){}, removeItem(){} };
  var navigator = { userAgent: 'node' };
  var location = { href: '', search: '' };
`;

const MODULOS = [
  'js/globals.js',
  'js/utils.js',
  'js/data-zip.js',
  'js/data-municipal.js',
  'js/data-geral-2002.js',
  'js/data-geral-2022.js',
  'js/data-geral-1989-1994.js',
];

/* Por ultimo: sobrescreve o fetchJsonFromZipEntry real (que depende de unzipit
 * e de rede) pela leitura direta dos zips em disco. */
const STUB = `
  async function fetchJsonFromZipEntry(zipUrl, entryName) {
    return { data: __lerZip(entryName) };
  }
`;

const fonte = PRELUDIO
  + MODULOS.map((f) => `\n/* ===== ${f} ===== */\n` + readFileSync(path.join(RAIZ, f), 'utf8')).join('\n')
  + STUB;

const ctx = {
  console: { log() {}, warn() {}, error() {} },
  setTimeout, clearTimeout, Promise,
  __lerZip: (entryName) => lerZipEntrada(path.join(ZIPS, entryName.replace(/\.json$/, '.zip'))),
};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fonte, ctx, { filename: 'bundle.js' });

// ------------------------------------------------------------- verificacoes

const carregar = (uf) => vm.runInContext(`
  STATE.currentElectionYear = '1989';
  STATE.currentElectionType = 'geral';
  loadMajoritariaCargo1994('1989', 'presidente', '${uf}');
`, ctx, { filename: 'carregar.js' });

const malhaDe = (uf) => JSON.parse(
  readFileSync(path.join(MALHA, `municipios_1989_${uf}.geojson`), 'utf8'));

console.log('Gerais de 1989 (presidente, dois turnos)');

for (const uf of ['RJ', 'AC', 'SP']) {
  const dados = await carregar(uf);
  const malha = malhaDe(uf);

  // Uma feature sintetica por municipio, e nenhuma sobra/falta contra a malha.
  ok(dados?.geojson?.features?.length === malha.features.length,
    `${uf}: uma feature por municipio`,
    `${dados?.geojson?.features?.length} features vs ${malha.features.length} polígonos`);

  // Os dois turnos (1989 foi decidido no 2o turno, em todo o pais).
  const turnos = Array.from(Object.keys(dados.officialTotals)).join('+');
  ok(turnos === '1T+2T', `${uf}: turnos carregados`, turnos);

  // Chaves de exibicao no formato "Nome (Partido) (Situacao) 1T".
  const chaves1T = Object.keys(dados.officialTotals['1T'].votesByDisplayKey);
  const chaves2T = Object.keys(dados.officialTotals['2T'].votesByDisplayKey);
  ok(chaves1T.includes('Collor (PRN) (2º TURNO) 1T'), `${uf}: chave do 1º turno`);
  ok(chaves2T.includes('Collor (PRN) (ELEITO) 2T'), `${uf}: chave do 2º turno`);
  ok(chaves2T.length === 2, `${uf}: só Collor e Lula no 2º turno`, `${chaves2T.length} chaves`);

  // Turnout oficial preservado nas features sinteticas.
  const props = dados.geojson.features[0].properties;
  ok(props['Comparecimento 1T'] > 0 && props['Eleitores_Aptos_Municipal 1T'] > 0,
    `${uf}: comparecimento/aptos oficiais`);

  // Join do choropleth: todo poligono da malha acha seu resumo (por nome, e o
  // resumo carrega o IBGE para o casamento por codigo).
  const totais = dados.officialCityTotals['1T'];
  const semResumo = malha.features.filter((f) => !totais[f.properties.NM_MUN]);
  ok(semResumo.length === 0, `${uf}: todo polígono tem resumo`,
    semResumo.slice(0, 5).map((f) => f.properties.NM_MUN).join(', '));
  const semIbge = malha.features.filter((f) => totais[f.properties.NM_MUN]?.ibge !== f.properties.CD_MUN);
  ok(semIbge.length === 0, `${uf}: resumo casa por código IBGE`,
    semIbge.slice(0, 5).map((f) => f.properties.NM_MUN).join(', '));
}

// Resultado historico por UF: Brizola venceu o 1o turno no RJ, Lula o 2o;
// Collor venceu os dois turnos em SP.
const topo = (m) => Object.entries(m).sort((a, b) => b[1] - a[1])[0][0];
const rj = await carregar('RJ');
const sp = await carregar('SP');
ok(topo(rj.officialTotals['1T'].votesByDisplayKey).startsWith('Brizola'), 'RJ 1º turno: Brizola');
ok(topo(rj.officialTotals['2T'].votesByDisplayKey).startsWith('Lula'), 'RJ 2º turno: Lula');
ok(topo(sp.officialTotals['1T'].votesByDisplayKey).startsWith('Collor'), 'SP 1º turno: Collor');
ok(topo(sp.officialTotals['2T'].votesByDisplayKey).startsWith('Collor'), 'SP 2º turno: Collor');

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo ok.');
process.exit(falhas ? 1 : 0);
