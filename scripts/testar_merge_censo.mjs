/* Casamento GPKG <-> Censo nas eleicoes gerais, fora do browser.
 *
 * Cada local do GeoPackage precisa receber o `local_key` do Censo daquele ano —
 * e essa chave que amarra o ponto ao resultado. Quem nao recebe e DESCARTADO do
 * mapa (filterGeneralFeatures*), sem erro nenhum: o local simplesmente nao
 * aparece, e o municipio fica com metade dos pontos.
 *
 * O que este teste protege:
 *
 * 1. MUNICIPIO RENOMEADO. O casamento era por NOME, e o GPKG traz o nome de
 *    hoje enquanto o Censo traz o da epoca. Embu das Artes, renomeado em 2011,
 *    e "Embu das Artes" no GPKG e "EMBU" no Censo 2010: 40 dos seus 59 locais
 *    sumiam. O join passou a ser por CODIGO do municipio (tse_para_ibge.json),
 *    com o nome so como fallback.
 *
 * 2. NENHUMA PERDA. O codigo entra ANTES dos dois casamentos por nome, que
 *    continuam la. Nada que casava antes pode deixar de casar.
 *
 *     node scripts/testar_merge_censo.mjs
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let falhas = 0;
function ok(cond, nome, detalhe = '') {
  console.log(`${cond ? '  ok   ' : '  FALHA'} ${nome}${detalhe ? '  - ' + detalhe : ''}`);
  if (!cond) falhas++;
}

const lerJson = (rel) => JSON.parse(readFileSync(path.join(RAIZ, rel), 'utf8'));

function lerZipJson(relZip, entrada) {
  const saida = execFileSync('python', ['-c',
    'import sys,zipfile;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',
    path.join(RAIZ, relZip), entrada], { maxBuffer: 1 << 28 });
  return JSON.parse(saida.toString('utf8'));
}

// Linhas do GeoPackage de um ano, como o loader monta a feature.
function lerGpkg(ano, nomeZip, tabela, uf) {
  const saida = execFileSync('python', ['-c', `
import sys, zipfile, sqlite3, tempfile, os, json
tmp = tempfile.mkdtemp()
with zipfile.ZipFile(sys.argv[1]) as z:
    n = [x for x in z.namelist() if x.endswith('.gpkg')][0]
    z.extract(n, tmp)
c = sqlite3.connect(os.path.join(tmp, n))
cols = 'sg_uf,cod_localidade_ibge,nr_zona,nr_locvot,nm_localidade,nm_locvot,ds_endereco,ds_bairro,long,lat'
rows = [dict(zip(cols.split(','), r)) for r in
        c.execute('select %s from "%s" where sg_uf = ?' % (cols, sys.argv[2]), (sys.argv[3],))]
sys.stdout.write(json.dumps(rows))
`, path.join(RAIZ, 'resultados_geo', nomeZip), tabela, uf], { maxBuffer: 1 << 28 });
  return JSON.parse(saida.toString('utf8'));
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
  'js/globals.js', 'js/utils.js', 'js/party-numbers.js', 'js/data-zip.js',
  'js/data-process.js', 'js/data-municipal.js', 'js/data-loader.js',
  'js/data-geral-2010.js', 'js/data-geral-2014.js', 'js/data-geral-2018.js',
  'js/data-geral-2022.js', 'js/ui-helpers.js', 'js/map-render.js',
];

const fonte = PRELUDIO
  + MODULOS.map((f) => `\n/* ===== ${f} ===== */\n` + readFileSync(path.join(RAIZ, f), 'utf8')).join('\n');

const ctx = {
  console: { log() {}, warn() {}, error() {} },
  setTimeout, clearTimeout, Promise,
  addEventListener() {}, removeEventListener() {},
  __lerJson: (url) => lerJson(url),
};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fonte, ctx, { filename: 'bundle.js' });
await vm.runInContext('ensureTseIbgeLoaded()', ctx, { filename: 'ponte.js' });

console.log('Casamento GPKG x Censo');

const ANOS = [
  [2010, 'locais_votacao_2010_gkpg.zip', 'locais_votacao_2010_ENRIQUECIDO', 'buildGeneral2010Feature', 'mergeGeneralCensoJson2010'],
  [2014, 'locais_votacao_2014_gkpg.zip', 'locais_votacao_2014_ENRIQUECIDO', 'buildGeneral2014Feature', 'mergeGeneralCensoJson2014'],
  [2018, 'locais_votacao_2018_gkpg.zip', 'locais_votacao_2018_ENRIQUECIDO', 'buildGeneral2018Feature', 'mergeGeneralCensoJson2018'],
];

// Embu das Artes: renomeado em 2011, e o caso que motivou a correcao.
const EMBU = '3515004';

for (const [ano, zipNome, tabela, construtor, merge] of ANOS) {
  console.log(`\n${ano}`);
  const linhas = lerGpkg(ano, zipNome, tabela, 'SP');
  const censo = lerZipJson(`resultados_geo/Censo ${ano}/censo_${ano}_SP.zip`,
    `censo_${ano}_SP.json`);

  ctx.__linhas = linhas;
  ctx.__censo = censo;
  ctx.__construtor = construtor;
  ctx.__merge = merge;
  ctx.__embu = EMBU;

  const r = vm.runInContext(`(() => {
    const geo = { type: 'FeatureCollection',
      features: __linhas.map((row) => globalThis[__construtor](row)) };
    globalThis[__merge](geo, __censo);
    const comChave = geo.features.filter((f) => !!f.properties.local_key);
    const embu = geo.features.filter(
      (f) => String(f.properties.cod_localidade_ibge) === __embu);
    return {
      total: geo.features.length,
      comChave: comChave.length,
      embuTotal: embu.length,
      embuComChave: embu.filter((f) => !!f.properties.local_key).length
    };
  })()`, ctx, { filename: `merge${ano}.js` });

  ok(r.comChave / r.total > 0.98,
    `${ano}: mais de 98% dos locais de SP recebem local_key`,
    `${r.comChave} de ${r.total} (${(100 * r.comChave / r.total).toFixed(2)}%)`);

  if (ano === 2010) {
    // O caso do bug: 59 locais no GPKG, so 19 casavam por nome.
    ok(r.embuTotal > 50, 'Embu das Artes tem os locais no GPKG de 2010', `${r.embuTotal}`);
    ok(r.embuComChave === r.embuTotal,
      'e TODOS recebem local_key (por nome, so 19 recebiam)',
      `${r.embuComChave} de ${r.embuTotal}`);
  } else {
    ok(r.embuComChave === r.embuTotal,
      `${ano}: Embu das Artes casa inteiro`, `${r.embuComChave} de ${r.embuTotal}`);
  }
}

// O codigo entra ANTES do nome, mas o nome continua atendendo quem so casa por
// ele — e o que garante que a correcao nao tira nada.
const fonte2010 = readFileSync(path.join(RAIZ, 'js/data-geral-2010.js'), 'utf8');
ok(fonte2010.includes('censusByCodeZoneLocal.get(codeZoneLocalKey)')
  && fonte2010.includes('|| censusByCityZoneLocal.get(cityZoneLocalKey)')
  && fonte2010.includes('|| censusByNameBairro.get(nameBairroKey)'),
  'os dois casamentos por nome seguem como fallback do codigo');

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo ok.');
process.exit(falhas ? 1 : 0);
