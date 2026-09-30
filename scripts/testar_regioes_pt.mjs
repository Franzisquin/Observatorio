/* Testa o modo Regiões do mapa de Portugal: dados, seletor e malha falam das
 * mesmas regiões, e o mapa pinta com os mesmos votos que o painel mostra.
 *
 *   - js/pt/nuts-data.js, as opções de <select id="selectNuts"> no
 *     eleicoes_pt.html e dados/mapas/regioes.geojson (scripts/gerar_regioes_pt.py)
 *     têm exatamente as mesmas regiões: o clique numa região escolhe a opção
 *     de mesmo valor, e uma opção que falte limparia o filtro em silêncio;
 *   - as contagens são as das NUTS 2024 (3 NUTS I, 9 NUTS II, 26 NUTS III) mais
 *     as 2 áreas metropolitanas;
 *   - getRegiaoVotes (cor do mapa) soma o mesmo que getScopeData com o filtro
 *     regional (painel), e cada nível NUTS reparte o país sem sobra nem falta.
 *
 *     node scripts/testar_regioes_pt.mjs
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PT = path.join(RAIZ, 'portugal');

let falhas = 0;
function ok(cond, nome, detalhe = '') {
  console.log(`${cond ? '  ok   ' : '  FALHA'} ${nome}${detalhe ? '  — ' + detalhe : ''}`);
  if (!cond) falhas++;
}

const ctx = vm.createContext({ console, document: { addEventListener() { }, getElementById: () => null } });
ctx.window = ctx;
for (const f of ['js/globals.js', 'js/pt/nuts-data.js', 'js/pt/data-portugal.js']) {
  vm.runInContext(readFileSync(path.join(PT, f), 'utf-8'), ctx, { filename: f });
}
const run = (expr) => vm.runInContext(expr, ctx);
const NUTS = run('NUTS_DATA');

const dosDados = new Set();
for (const info of Object.values(NUTS)) {
  for (const nivel of ['n1', 'n2', 'n3', 'am']) if (info[nivel]) dosDados.add(`${nivel}:${info[nivel]}`);
}
const malha = JSON.parse(readFileSync(path.join(PT, 'dados', 'mapas', 'regioes.geojson'), 'utf-8'));
const daMalha = new Set(malha.features.map((f) => f.properties.id));
const html = readFileSync(path.join(PT, 'eleicoes_pt.html'), 'utf-8');
const select = html.slice(html.indexOf('<select id="selectNuts"'), html.indexOf('</select>', html.indexOf('<select id="selectNuts"')));
const doSeletor = new Set([...select.matchAll(/<option value="((?:n1|n2|n3|am):[^"]+)"/g)].map((m) => m[1]));

console.log('Regiões');
const diferenca = (a, b) => [...a].filter((x) => !b.has(x));
ok(diferenca(dosDados, daMalha).length === 0 && diferenca(daMalha, dosDados).length === 0,
  `malha e nuts-data.js: as mesmas ${dosDados.size} regiões`,
  `só nos dados: ${diferenca(dosDados, daMalha)} | só na malha: ${diferenca(daMalha, dosDados)}`);
ok(diferenca(dosDados, doSeletor).length === 0 && diferenca(doSeletor, dosDados).length === 0,
  'seletor e nuts-data.js: uma opção para cada região, nenhuma a mais',
  `sem opção: ${diferenca(dosDados, doSeletor)} | opção sem região: ${diferenca(doSeletor, dosDados)}`);
const conta = (nivel) => [...dosDados].filter((id) => id.startsWith(nivel + ':')).length;
ok(conta('n1') === 3 && conta('n2') === 9 && conta('n3') === 26 && conta('am') === 2,
  'NUTS 2024: 3 NUTS I, 9 NUTS II, 26 NUTS III, e 2 áreas metropolitanas',
  `${conta('n1')}/${conta('n2')}/${conta('n3')}/${conta('am')}`);
ok(Object.keys(NUTS).length === 308, 'os 308 concelhos têm região');

console.log('Votos (legislativas 2025)');
ctx.__dados = JSON.parse(readFileSync(path.join(PT, 'dados', 'resultados', 'ar_2025.json'), 'utf-8'));
run('STATE.data = __dados; STATE.currentElectionType = "ar"; STATE.scope = { level: "national", key: null };');
const total = (votos) => Object.values(votos || {}).reduce((t, v) => t + v, 0);
const pais = Object.values(ctx.__dados.RESULTS).reduce((t, v) => t + total(v), 0);
for (const nivel of ['n1', 'n2', 'n3']) {
  const soma = [...dosDados].filter((id) => id.startsWith(nivel + ':')).reduce((t, id) => t + total(ctx.getRegiaoVotes(id)), 0);
  ok(soma === pais, `${nivel}: as regiões somam os votos do país`, `${soma} vs ${pais}`);
}
const diverge = [];
for (const id of dosDados) {
  ctx.__id = id;
  const painel = run('STATE.currentNuts = __id; getScopeData().votes');
  const mapa = ctx.getRegiaoVotes(id) || {};
  if (JSON.stringify(Object.entries(painel).sort()) !== JSON.stringify(Object.entries(mapa).sort())) diverge.push(id);
}
run('STATE.currentNuts = ""');
ok(diverge.length === 0, 'cada região: o mapa soma os mesmos votos que o painel com o filtro', diverge.join(', '));

console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo ok');
process.exit(falhas ? 1 : 0);
