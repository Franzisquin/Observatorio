// Trava a identidade do local de votacao no swingometro, contra os arquivos
// reais do acervo (SP capital, Prefeito 2020 x 2024).
//
// O bug que isto pega: agregar os locais por "{municipio}|{local}" descarta a
// zona, e nr_locvot e numerado DENTRO da zona — os 2.062 locais de Sao Paulo
// colapsavam em 149 baldes e a intersecao caia para 147.
//
//   node test_swing_locais.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const assert = require('assert');
const { DatabaseSync } = require('node:sqlite');

const MUNI_SP = '71072';
const IBGE_SP = '3550308';
const ENTRY_SP = '71072_SAO_PAULO.json';

/* -------------------------------------------------------------------------
 * Leitor de zip minimo: percorre o central directory e infla a entrada pedida.
 * Evita dependencia so para ler dois arquivos.
 * ---------------------------------------------------------------------- */
function zipEntries(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  assert.ok(eocd >= 0, 'zip sem end-of-central-directory');

  const entries = new Map();
  let p = buf.readUInt32LE(eocd + 16);
  const total = buf.readUInt16LE(eocd + 10);

  for (let i = 0; i < total; i++) {
    assert.strictEqual(buf.readUInt32LE(p), 0x02014b50, 'central directory corrompido');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    entries.set(name, () => {
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const raw = buf.subarray(start, start + compSize);
      return method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    });

    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/* -------------------------------------------------------------------------
 * Carrega o codigo REAL do app num contexto isolado. utils.js e swing-view.js
 * viram um script so, para o epilogo enxergar os `const` lexicais (SWING mora
 * num const, nao no objeto global). Sem `window`, os blocos de bootstrap dos
 * dois arquivos nao rodam.
 * ---------------------------------------------------------------------- */
function loadApp() {
  const src = ['js/utils.js', 'js/swing-view.js']
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n;\n')
    + `\n;globalThis.__api = {
         SWING, buildSwingSideAggregates, swingRowsForLevel,
         ensureSwingStationAliases, aliasStationMap,
         swingLocalNameKey, swingStationKeyFromProps
       };`;

  const ctx = vm.createContext({ console });
  vm.runInContext(src, ctx, { filename: 'app-bundle.js' });
  return { api: ctx.__api, ctx };
}

/* ------------------------------------------------------------------------- */
function lerResults(ano) {
  const zip = zipEntries(fs.readFileSync(`resultados_geo/Municipais ${ano}/prefeito_${ano}_ord_t1_SP.zip`));
  // latin1 preserva os bytes; so usamos chaves e numeros, nao os acentos.
  return JSON.parse(zip.get(ENTRY_SP)().toString('latin1'));
}

// Reproduz o que o loader municipal entrega: coordenada valida e, em 2020,
// sem as linhas repetidas do GPKG.
function lerGeometria(ano, tabela) {
  const zip = zipEntries(fs.readFileSync(`resultados_geo/locais_votacao_${ano}_gkpg.zip`));
  const nome = [...zip.keys()].find((n) => n.endsWith('.gpkg'));
  const tmp = path.join(os.tmpdir(), `swing_test_${ano}_${process.pid}.gpkg`);
  fs.writeFileSync(tmp, zip.get(nome)());

  let linhas;
  const db = new DatabaseSync(tmp);
  try {
    linhas = db.prepare(`
      SELECT nr_zona, nr_locvot, nm_locvot, lat, long
      FROM ${tabela} WHERE sg_uf = 'SP' AND cod_localidade_ibge = ?
    `).all(IBGE_SP);
  } finally {
    db.close();
    fs.unlinkSync(tmp);
  }

  const vistos = new Set();
  const features = [];
  for (const row of linhas) {
    const long = Number(row.long);
    const lat = Number(row.lat);
    if (!isFinite(long) || !isFinite(lat)) continue;
    if (!(long >= -76 && long <= -28 && lat >= -35 && lat <= 6.5)) continue;
    const zona = parseInt(row.nr_zona, 10);
    const local = parseInt(row.nr_locvot, 10);
    const chave = `${zona}_${MUNI_SP}_${local}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    features.push({
      geometry: { type: 'Point', coordinates: [long, lat] },
      properties: {
        id_unico: chave, local_key: chave, nr_zona: zona, nr_locvot: local,
        cd_localidade_tse: MUNI_SP, nm_locvot: row.nm_locvot
      }
    });
  }
  return { type: 'FeatureCollection', features };
}

/* ------------------------------------------------------------------------- */
async function main() {
  const { api, ctx } = loadApp();
  const { SWING } = api;

  const r2020 = lerResults(2020);
  const r2024 = lerResults(2024);
  const agg = (payload) => api.buildSwingSideAggregates({ SP: payload });

  // 1. A zona faz parte da identidade do local.
  const a = agg(r2020);
  const b = agg(r2024);
  assert.strictEqual(a.byStation.size, 2062, 'byStation de 2020 deveria ter um balde por local');
  assert.strictEqual(b.byStation.size, 2062, 'byStation de 2024 deveria ter um balde por local');
  assert.ok(a.byStation.has('1_71072_1015'), 'a chave do byStation e a propria chave do RESULTS');
  assert.strictEqual(a.byMuni.size, 1, 'byMuni continua agregando o municipio inteiro');

  // 2. Join so pela chave.
  Object.assign(SWING, {
    office: 'prefeito', subtype: 'ord', scope: 'SP', municipio: 'SÃO PAULO',
    level: 'locais', metric: 'swing',
    A: { ...SWING.A, year: '2020', turno: 1, candId: '50', cands: [] },
    B: { ...SWING.B, year: '2024', turno: 1, candId: '50', cands: [] },
    dataset: { A: a, B: b }
  });
  SWING._stationAlias = null;
  SWING._stationAliasPromise = null;

  const semAlias = api.swingRowsForLevel('locais');
  assert.strictEqual(semAlias.size, 1841, 'intersecao pela chave cheia');

  // 3. Join + resgate dos predios renumerados pelo nome.
  const geo = {
    2020: lerGeometria(2020, 'locais_votacao_2020_ENRIQUECIDO'),
    2024: lerGeometria(2024, 'locais_votacao_2024_atualizado_2')
  };
  ctx.loadSwingStationBase = async (side) => geo[Number(SWING[side].year)];

  const alias = await api.ensureSwingStationAliases();
  assert.strictEqual(alias.size, 152, 'predios renumerados casados pelo nome');
  // O alias vai sempre do ano ANTIGO para o NOVO: e a geometria mais nova que
  // buildSwingStationFeatures prefere desenhar.
  assert.ok(alias.has('4_71072_1295') && alias.get('4_71072_1295') === '3_71072_1562',
    'Colegio Agostiniano Sao Jose: 2020 z4/1295 -> 2024 z3/1562');

  const comAlias = api.swingRowsForLevel('locais');
  assert.strictEqual(comAlias.size, 1993, 'total de locais comparaveis');
  assert.ok([...comAlias.keys()].every((k) => b.byStation.has(k)),
    'toda linha deve estar chaveada pelo lado novo, que e o que tem geometria');

  // 4. O alias nunca pode canibalizar uma chave que existe de verdade.
  const real = new Map([['1_9_1', { total: 10 }], ['2_9_2', { total: 20 }]]);
  const forcado = api.aliasStationMap(real, new Map([['1_9_1', '2_9_2']]));
  assert.strictEqual(forcado.size, 2, 'nao pode fundir duas unidades reais');
  assert.strictEqual(forcado.get('1_9_1').total, 10);

  console.log('byStation 2020/2024 ....... %d / %d locais', a.byStation.size, b.byStation.size);
  console.log('join so pela chave ........ %d', semAlias.size);
  console.log('renumerados resgatados .... %d', alias.size);
  console.log('join final ................ %d de 2062 (%s%%)',
    comAlias.size, (comAlias.size / 2062 * 100).toFixed(1));
  console.log('\nOK');
}

main().catch((error) => { console.error(error); process.exit(1); });
