/* Harness do MLCompat.GeoLayer, fora do browser.
 *
 * Um mapa falso registra addSource/addLayer/removeLayer, e o teste confere o
 * que a camada monta. O que ele protege e o CUSTO POR TILE, que nao aparece em
 * nenhum teste funcional e so se manifesta como mapa arrastado:
 *
 * 1. OPCOES DA FONTE. tolerance e buffer estiveram em 0,1 e 256 sem motivo
 *    registrado. tolerance 0,1 guarda cinco vezes mais vertices por tile que os
 *    0,5 de agora; buffer 256 duplicava o dobro de geometria na margem de cada
 *    tile que o padrao 128. Os dois pesam ao arrastar e dar zoom.
 *
 * 2. CAMADA 3D SEMPRE CRIADA. A fill-extrusion nascia junto com toda camada de
 *    poligono, escondida. Mesmo invisivel ela faz cada tile montar um terceiro
 *    bucket — um terco a mais de trabalho por tile em todo mapa do site, para
 *    um recurso que fica desligado a maior parte do tempo.
 *
 *     node scripts/testar_maplibre_compat.mjs
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let falhas = 0;
function ok(cond, nome, detalhe = '') {
  console.log(`${cond ? '  ok   ' : '  FALHA'} ${nome}${detalhe ? '  - ' + detalhe : ''}`);
  if (!cond) falhas++;
}

// ------------------------------------------------------------- mapa falso

function novoMapa() {
  const sources = new Map();
  const layers = new Map();
  return {
    sources,
    layers,
    addSource(id, opts) { sources.set(id, opts); },
    getSource(id) {
      const o = sources.get(id);
      return o ? { setData(d) { o.data = d; } } : undefined;
    },
    removeSource(id) { sources.delete(id); },
    addLayer(spec) { layers.set(spec.id, spec); },
    getLayer(id) { return layers.get(id); },
    removeLayer(id) { layers.delete(id); },
    setLayoutProperty(id, k, v) { const l = layers.get(id); if (l) l.layout[k] = v; },
    setFeatureState() {},
    handlers: {},
    canvas: { style: {} },
    on(tipo, _camada, fn) { this.handlers[tipo] = fn || _camada; },
    off() {},
    getCanvas() { return this.canvas; },
    loaded: () => true, isStyleLoaded: () => true,
    __geoLayers: new Set()
  };
}

const ctx = {
  console: { log() {}, warn() {}, error() {} },
  setTimeout, clearTimeout,
  document: {
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }),
    documentElement: { style: { getPropertyValue: () => '#888888' } }
  },
  getComputedStyle: () => ({ getPropertyValue: () => '#888888' })
};
ctx.window = ctx;
ctx.globalThis = ctx;
ctx.maplibregl = { Popup: class { setLngLat() { return this; } setHTML() { return this; } addTo() { return this; } remove() {} } };
vm.createContext(ctx);
vm.runInContext(readFileSync(path.join(RAIZ, 'js/maplibre-compat.js'), 'utf8'), ctx,
  { filename: 'maplibre-compat.js' });

const { GeoLayer } = ctx.MLCompat;
const poligono = (i) => ({
  type: 'Feature',
  properties: { CD_REG: String(i) },
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }
});

console.log('MLCompat.GeoLayer');

// ------------------------------------------------- opcoes da fonte
{
  const m = novoMapa();
  const l = new GeoLayer(m, { id: 'areas', type: 'polygon', styleFn: () => ({}) });
  l.setFeatures([poligono(1)]);
  l.addTo(m);
  const src = m.sources.get('areas-src');
  ok(!!src, 'a fonte e criada');
  ok(src.tolerance === 0.5,
    'poligono simplifica a 0,5 por tile (era 0,1)', String(src.tolerance));
  ok(src.buffer === undefined,
    'buffer fica no padrao (128), nao em 256', String(src.buffer));
  ok(src.promoteId === '__id', 'promoteId segue, e o que faz o hover por feature-state');
}

// ------------------------------------------------- camada 3D sob demanda
{
  const m = novoMapa();
  const l = new GeoLayer(m, { id: 'areas', type: 'polygon', styleFn: () => ({}) });
  l.setFeatures([poligono(1), poligono(2)]);
  l.addTo(m);

  ok(m.getLayer('areas-fill') && m.getLayer('areas-line'),
    'poligono monta fill e line');
  ok(!m.getLayer('areas-extrusion'),
    'e NAO monta a camada 3D com a extrusao desligada');
  ok(l.layerIds.length === 2, 'layerIds reflete as duas camadas', String(l.layerIds));

  l.setExtrusionEnabled(true);
  ok(!!m.getLayer('areas-extrusion'), 'ligar a extrusao cria a camada 3D');
  ok(m.getLayer('areas-extrusion').layout.visibility === 'visible', 'e a torna visivel');
  ok(m.getLayer('areas-fill').layout.visibility === 'none', 'escondendo o fill 2D');
  ok(l.layerIds.length === 3, 'e ela entra em layerIds, para o remove alcanca-la');

  l.setExtrusionEnabled(false);
  ok(m.getLayer('areas-extrusion').layout.visibility === 'none', 'desligar esconde a 3D');
  ok(m.getLayer('areas-fill').layout.visibility === 'visible', 'e devolve o fill 2D');

  // Ligar duas vezes nao pode duplicar a camada nem a entrada em layerIds.
  l.setExtrusionEnabled(true);
  l.setExtrusionEnabled(true);
  ok(l.layerIds.filter((id) => id === 'areas-extrusion').length === 1,
    'ligar de novo nao duplica a camada 3D');

  l.remove();
  ok(m.layers.size === 0 && m.sources.size === 0,
    'remove() limpa as tres camadas e a fonte', `${m.layers.size} camadas`);
}

// ------------------------------------------------- ponto nao tem 3D
{
  const m = novoMapa();
  const l = new GeoLayer(m, { id: 'locais', type: 'point', styleFn: () => ({}) });
  l.setFeatures([{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }]);
  l.addTo(m);
  ok(!!m.getLayer('locais-circle') && l.layerIds.length === 1, 'ponto monta so o circle');
  ok(m.sources.get('locais-src').tolerance === undefined,
    'e ponto nao leva tolerance: nao ha o que simplificar');
  l.setExtrusionEnabled(true);
  ok(!m.getLayer('locais-extrusion'), 'e nunca ganha camada 3D');
}

// ------------------------------------------------- ids distintos nao colidem
//
// Area e local coexistem como camadas de detalhe alternativas. Se
// compartilhassem o id, a fonte seria reaproveitada e a camada antiga (do outro
// tipo) continuaria desenhada — foi assim que as areas ficaram por baixo dos
// pontos.
{
  const m = novoMapa();
  const areas = new GeoLayer(m, { id: 'areas', type: 'polygon', styleFn: () => ({}) });
  areas.setFeatures([poligono(1)]);
  areas.addTo(m);
  areas.remove();

  const locais = new GeoLayer(m, { id: 'locais', type: 'point', styleFn: () => ({}) });
  locais.setFeatures([{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }]);
  locais.addTo(m);

  ok(!m.getLayer('areas-fill') && !!m.getLayer('locais-circle'),
    'trocar area por local nao deixa a camada anterior no mapa');
  ok(m.sources.size === 1, 'e nem a fonte anterior', `${m.sources.size} fontes`);
}

// ------------------------------------------------- feicao nao-clicavel
//
// Area de ponderacao sem local de votacao dentro nao pode receber clique: entrar
// nela daria um recorte vazio. Ela continua desenhada e com tooltip — o que muda
// e o clique e o cursor, que nao pode prometer uma acao que nao existe.
{
  const m = novoMapa();
  const cliques = [];
  const l = new GeoLayer(m, {
    id: 'areas', type: 'polygon', styleFn: () => ({}),
    clickable: (f) => f.properties.CD_REG !== '2',
    onClick: (f) => cliques.push(f.properties.CD_REG)
  });
  l.setFeatures([poligono(1), poligono(2)]);
  l.addTo(m);

  // Reproduz o que o mapa faz: o handler resolve a feature pelo __id.
  const evento = (i) => ({ features: [{ properties: { __id: i } }] });
  const mover = m.handlers.mousemove;
  const clicar = m.handlers.click;

  clicar(evento(0));
  ok(cliques.join() === '1', 'feicao com resultado recebe o clique', cliques.join());
  clicar(evento(1));
  ok(cliques.join() === '1', 'feicao sem resultado NAO recebe o clique', cliques.join());

  mover(evento(0));
  ok(m.canvas.style.cursor === 'pointer', 'e o cursor vira mao sobre a clicavel');
  mover(evento(1));
  ok(m.canvas.style.cursor === '', 'mas nao sobre a que nao responde',
    JSON.stringify(m.canvas.style.cursor));
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo ok.');
process.exit(falhas ? 1 : 0);
