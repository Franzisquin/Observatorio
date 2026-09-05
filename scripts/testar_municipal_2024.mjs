// Dirige o carregador municipal REAL (loadMunicipal2024Prefeito) nos 22
// municipios do Acre. Só rede (unzipit) e sql.js sao substituidos; todo o resto
// e o codigo do site.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const RAIZ = 'C:/mapas/Observatorio';
const UF = process.argv[2] || 'AC';
const lerJson = (rel) => JSON.parse(readFileSync(path.join(RAIZ, rel), 'utf8'));

function py(code, ...args) {
  return execFileSync('python', ['-c', code, ...args], { maxBuffer: 1 << 28 });
}

// --- zips locais -------------------------------------------------------
const LISTAR = `
import sys, zipfile, json
z = zipfile.ZipFile(sys.argv[1])
sys.stdout.buffer.write(json.dumps(z.namelist(), ensure_ascii=False).encode('utf-8'))
`;
const LER = `
import sys, zipfile
sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))
`;
const listaCache = new Map();
import { existsSync } from 'node:fs';
function entradasDoZip(rel) {
  if (!existsSync(path.join(RAIZ, rel))) throw new Error('zip ausente: ' + rel);
  if (!listaCache.has(rel)) {
    listaCache.set(rel, JSON.parse(py(LISTAR, path.join(RAIZ, rel)).toString('utf8')));
  }
  return listaCache.get(rel);
}
function lerEntrada(rel, nome) {
  return py(LER, path.join(RAIZ, rel), nome).toString('utf8');
}

// --- linhas do GPKG ----------------------------------------------------
const GPKG = `
import sys, zipfile, sqlite3, tempfile, os, json
tmp = tempfile.mkdtemp()
with zipfile.ZipFile(sys.argv[1]) as z:
    n = [x for x in z.namelist() if x.endswith('.gpkg')][0]
    z.extract(n, tmp)
c = sqlite3.connect(os.path.join(tmp, n))
cols = 'sg_uf,cod_localidade_ibge,nr_zona,nr_locvot,nm_localidade,nm_locvot,ds_endereco,ds_bairro,long,lat,tipo_match,hist_id'
rows = [dict(zip(cols.split(','), r)) for r in
        c.execute('select %s from "%s" where sg_uf = ?' % (cols, sys.argv[2]), (sys.argv[3],))]
sys.stdout.buffer.write(json.dumps(rows, ensure_ascii=False).encode('utf-8'))
`;
const linhasGpkg = JSON.parse(
  py(GPKG, path.join(RAIZ, 'resultados_geo/locais_votacao_2024_gkpg.zip'),
     'locais_votacao_2024_atualizado_2', UF).toString('utf8'));

// --- ambiente ----------------------------------------------------------
const cache = new Map();
const el = (id) => {
  if (!cache.has(id)) cache.set(id, {
    id, style: {}, dataset: {}, innerHTML: '', textContent: '', value: '', checked: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    querySelector: () => el('q'), querySelectorAll: () => [], appendChild() {},
    addEventListener() {}, removeEventListener() {}, setAttribute() {},
    removeAttribute() {}, getAttribute: () => null, closest: () => null, remove() {},
    insertAdjacentHTML() {}, options: [], children: [], dispatchEvent() {},
    getBoundingClientRect: () => ({ width: 100, height: 100, top: 0, left: 0 })
  });
  return cache.get(id);
};

const PRELUDIO = `
  var document = {
    getElementById: (id) => __el(id), querySelector: (s) => __el('q:' + s),
    querySelectorAll: () => [], createElement: () => __el('n:' + Math.random()),
    addEventListener(){}, body: __el('body'), documentElement: __el('html') };
  var localStorage = { getItem: () => null, setItem(){}, removeItem(){} };
  var navigator = { userAgent: 'node' };
  var location = { href: '', search: '' };
  var Event = function (t) { this.type = t; }; var CustomEvent = Event;
  var getComputedStyle = () => ({ getPropertyValue: () => '#888888' });
  var fetch = async (url) => {
    try { return { ok: true, json: async () => __lerJson(url) }; }
    catch (e) { return { ok: false, status: 404, json: async () => null }; }
  };
`;

const MODULOS = [
  'js/globals.js', 'js/utils.js', 'js/party-numbers.js', 'js/data-zip.js',
  'js/data-process.js', 'js/data-municipal.js', 'js/municipal-aliases-2000-2004.js',
  'js/data-loader.js', 'js/data-geral-2022.js', 'js/ui-helpers.js',
  'js/map-render.js', 'js/ui-results.js', 'js/results-panel.js', 'js/ui-controls.js',
  'js/maplibre-compat.js', 'js/data-router.js',
];
const fonte = PRELUDIO
  + MODULOS.map((f) => readFileSync(path.join(RAIZ, f), 'utf8')).join('\n');

const avisos = [];
const ctx = {
  console: {
    log() {}, warn(...a) { avisos.push('WARN ' + a.map(String).join(' ')); },
    error(...a) { avisos.push('ERR  ' + a.map(String).join(' ')); }
  },
  setTimeout, clearTimeout, Promise,
  addEventListener() {}, removeEventListener() {},
  __el: el,
  __lerJson: (url) => lerJson(url),
  __entradas: (rel) => entradasDoZip(rel),
  __lerEntrada: (rel, nome) => lerEntrada(rel, nome),
  __gpkgRows: linhasGpkg,
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fonte, ctx, { filename: 'bundle.js' });

// Substitui SO os dois pontos que dependem de rede/WASM.
vm.runInContext(`
  fetchJsonFromZipEntry = async function (zipUrl, filename, matcher) {
    const rel = decodeURIComponent(String(zipUrl));
    const nomes = __entradas(rel);
    const alvo = filename
      ? nomes.find((n) => n === filename)
      : nomes.find((n) => (matcher ? matcher(n) : n.endsWith('.json')));
    if (!alvo) throw new Error('entrada nao encontrada em ' + rel);
    return { data: JSON.parse(__lerEntrada(rel, alvo)), name: alvo };
  };
  getMunicipal2024Database = async function () {
    return {
      prepare(sql) {
        let i = 0, ligado = null;
        return {
          bind(args) { ligado = args; i = 0; return true; },
          step() { return i < __gpkgRows.length; },
          getAsObject() { return __gpkgRows[i++]; },
          free() { return true; }
        };
      }
    };
  };
  map = {
    addSource(){}, getSource: () => null, removeSource(){}, addLayer(){},
    getLayer: () => null, removeLayer(a) { if (a && a.remove) a.remove(); },
    setLayoutProperty(){}, setPaintProperty(){}, setFeatureState(){},
    on(){}, off(){}, once(){}, getCanvas: () => ({ style: {} }),
    isStyleLoaded: () => true, loaded: () => true, style: { _loaded: true },
    hasLayer: () => false, __geoLayers: new Set()
  };
  maplibregl = {
    Popup: class { setLngLat(){return this;} setHTML(){return this;} addTo(){return this;} remove(){} },
    LngLatBounds: class { extend(){return this;} isEmpty(){return true;} getCenter(){return {lng:0,lat:0};} }
  };
  showToast = function () {};
  dom = new Proxy({}, {
    get(a, k) { if (!(k in a)) a[k] = __el('dom:' + String(k)); return a[k]; },
    set(a, k, v) { a[k] = v; return true; }
  });
`, ctx);

const municipios = (lerJson('lista_municipios.json')[UF] || []).slice().sort();
console.log(`${UF}: ${municipios.length} municipios, ${linhasGpkg.length} linhas no GPKG\n`);

let falhas = 0;
for (const municipio of municipios) {
  ctx.__muni = municipio;
  avisos.length = 0;
  const r = await vm.runInContext(`(async () => {
    STATE.currentElectionType = 'municipal';
    STATE.currentElectionYear = '2024';
    currentOffice = 'prefeito'; currentSubType = 'ord'; currentCargo = 'prefeito_ord';
    currentTurno = 1;
    currentDataCollection = {}; STATE.municipalOfficialTotals = {};
    STATE.inaptos = {}; STATE.dataHas2T = {};
    currentRegionFilter = { level: '', code: '' };
    currentCidadeFilter = 'all'; currentBairroFilter = 'all'; currentLocalFilter = '';
    STATE.detalhe = 'locais';
    dom.selectMunicipio = { value: __muni, options: [] };
    dom.selectUFMunicipal = { value: '${UF}' };
    MUNICIPAL_2024_BASE_CACHE.clear();
    try {
      await loadMunicipal2024Prefeito('${UF}', __muni, 2024);
      const g = currentDataCollection['prefeito_ord'];
      return 'ok | ' + (g ? g.features.length : 0) + ' locais';
    } catch (e) { return 'FALHOU | ' + e.message; }
  })()`, ctx, { filename: 'carga.js' });

  if (r.startsWith('FALHOU')) {
    falhas++;
    console.log(`  ${municipio.padEnd(24)} ${r}`);
    avisos.slice(0, 2).forEach((a) => console.log(`      ${a.slice(0, 150)}`));
  } else {
    console.log(`  ${municipio.padEnd(24)} ${r}`);
  }
}
console.log(falhas ? `\n${falhas} municipio(s) falharam.` : '\nTodos carregaram.');
