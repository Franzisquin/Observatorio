/* Testa a logica eleitoral pura de simulador.js (matriz de transferencia,
 * kernel ideologico, apuracao e segundo turno) sem browser.
 *
 * O arquivo e carregado com `window` e `document` stubados; so as funcoes que
 * nao tocam o DOM sao exercitadas.
 *
 *     node scripts/testar_logica_simulador.mjs
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let falhas = 0;
function ok(cond, nome, detalhe = '') {
  console.log(`${cond ? '  ok  ' : '  FALHA'} ${nome}${detalhe ? '  — ' + detalhe : ''}`);
  if (!cond) falhas++;
}
const perto = (a, b, tol) => Math.abs(a - b) <= tol;

const noop = () => { };
const elemento = () => ({
  addEventListener: noop, querySelectorAll: () => [], querySelector: () => null,
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  style: {}, dataset: {}, appendChild: noop, textContent: '', innerHTML: '', hidden: false
});
const armazem = new Map();
const localStorageFalso = {
  getItem: (k) => (armazem.has(k) ? armazem.get(k) : null),
  setItem: (k, v) => armazem.set(k, String(v)),
  removeItem: (k) => armazem.delete(k),
};
const janela = { addEventListener: noop, localStorage: localStorageFalso };
const documento = {
  body: { dataset: {} }, getElementById: elemento, querySelectorAll: () => [],
  querySelector: () => null, createElement: elemento, addEventListener: noop
};

const fonte = await readFile(path.join(RAIZ, 'simulador.js'), 'utf-8');
const criar = new Function(
  'window', 'document', 'localStorage', 'maplibregl', 'MLCompat', 'Worker', 'fetch',
  fonte + `
  ;return { SIM, simAddCandidato, simTransferPadrao, simTransferMatriz, simTransferTotal,
            simColunas, simColunasValidas, idxColuna, entradasDe, vencedorDe, margemDe,
            simMatriz2TPadrao, transformar2T, simFinalistas, simPrecisaSegundoTurno,
            simCalcular2T, getPartyColor, getPartyPos, origensLista,
            restaurarLocal, cenarioSerializado, CENARIO_VERSAO,
            pesosDaRegiao, sincronizarPesosRegionais, assinaturaMigracao };`
);
const M = criar(janela, documento, localStorageFalso, {}, {}, function () { }, () => { });

// O indice normalmente vem de sim2026/index.json; aqui so precisamos das origens.
M.SIM.indice = {
  ufs: { AC: 679 },
  redutos: [{ key: 'zema', uf: 'MG', nome: 'Romeu Zema' },
    { key: 'caiado', uf: 'GO', nome: 'Ronaldo Caiado' }],
  dimensions: [{
    key: 'voto2022', label: 'Voto 2022 (1o turno)', base: 'elec',
    buckets: [{ key: 'lula' }, { key: 'bolsonaro' }, { key: 'outros' },
      { key: 'nulo_branco' }, { key: 'abstencao' }]
  }]
};

console.log('Partidos e eixo ideologico');
{
  ok(M.getPartyColor('PT') === '#ff3859', 'cor por partido');
  ok(M.getPartyColor('UNIÃO') === M.getPartyColor('UNIAO'), 'acento nao muda o partido');
  ok(M.getPartyPos('PT') < -0.5 && M.getPartyPos('PL') > 0.5, 'PT a esquerda, PL a direita',
    `PT ${M.getPartyPos('PT')}, PL ${M.getPartyPos('PL')}`);

  // A ordem pedida entre os partidos em disputa. Nao ha controle manual de
  // posicao: e o partido que posiciona o candidato.
  const ordem = ['PT', 'PSD', 'NOVO', 'MISSÃO', 'PL'];
  const pos = ordem.map((p) => M.getPartyPos(p));
  ok(pos.every((v, i) => i === 0 || v > pos[i - 1]),
    'ordem ideologica dos partidos: ' + ordem.join(' < '),
    pos.map((v, i) => `${ordem[i]} ${v > 0 ? '+' : ''}${v.toFixed(2)}`).join('  '));
}

console.log('\nCandidatos e colunas');
M.simAddCandidato('Lula', 'PT');
M.simAddCandidato('Flávio Bolsonaro', 'PL');
M.simAddCandidato('Ronaldo Caiado', 'PSD');
{
  const cols = M.simColunas();
  ok(cols.length === 6, 'colunas = candidatos + outros + nulo + abstencao', `${cols.length}`);
  ok(cols[cols.length - 1].key === 'abstencao', 'abstencao e a ultima coluna');
  ok(M.simColunasValidas().length === 4, 'validas excluem nulo e abstencao');
  ok(M.idxColuna('outros') === 3, 'indice de outros');
}

console.log('\nMatriz de migracao 2022');
M.SIM.transfer = M.simTransferPadrao();
{
  for (const o of M.origensLista()) {
    ok(perto(M.simTransferTotal(o), 100, 0.01), `linha "${o}" soma 100%`,
      M.simTransferTotal(o).toFixed(3) + '%');
  }
  const t = M.SIM.transfer;
  const lulaId = 'cand_' + M.SIM.candidatos[0].id;
  const flavioId = 'cand_' + M.SIM.candidatos[1].id;
  ok(t.lula[lulaId] > t.lula[flavioId],
    'quem votou Lula vai mais para o candidato de esquerda',
    `${t.lula[lulaId].toFixed(1)}% vs ${t.lula[flavioId].toFixed(1)}%`);
  ok(t.bolsonaro[flavioId] > t.bolsonaro[lulaId],
    'quem votou Bolsonaro vai mais para o candidato de direita',
    `${t.bolsonaro[flavioId].toFixed(1)}% vs ${t.bolsonaro[lulaId].toFixed(1)}%`);
  ok(t.abstencao.abstencao > 80, 'quem nao compareceu tende a nao comparecer de novo',
    `${t.abstencao.abstencao.toFixed(1)}%`);

  ok(t.outros && t.outros[lulaId] > 0 && t.outros[flavioId] > 0,
    'a origem "outros" (Ciro/Tebet) distribui de fato entre os candidatos',
    `${t.outros[lulaId].toFixed(1)}% / ${t.outros[flavioId].toFixed(1)}%`);
  ok(t.outros.abstencao < 20,
    'eleitor de outro candidato nao vira abstencao em massa',
    `${t.outros.abstencao.toFixed(1)}%`);

  const m = M.simTransferMatriz();
  ok(m.length === 5 && m[0].length === 6, 'matriz no formato do worker (5 origens x 6 colunas)',
    `${m.length}x${m[0].length}`);
  ok(m.every(l => perto(l.reduce((a, b) => a + b, 0), 1, 1e-6)), 'linhas em fracao somam 1');
}

console.log('\nApuracao');
// 100 eleitores: 30 Lula, 25 Flavio, 10 Caiado, 5 outros, 10 nulos, 20 abstencao
const res1 = { aptos: 100, votos: [30, 25, 10, 5, 10, 20] };
{
  const ent = M.entradasDe(res1);
  const validos = 30 + 25 + 10 + 5;
  ok(perto(ent[0].pctValidos, 100 * 30 / validos, 1e-9), '% sobre validos exclui nulo e abstencao',
    ent[0].pctValidos.toFixed(2) + '%');
  ok(perto(ent[5].pctAptos, 20, 1e-9), '% de abstencao e sobre os aptos');
  ok(M.vencedorDe(res1).label === 'Lula', 'vencedor');
  ok(perto(M.margemDe(res1), 100 * (30 - 25) / validos, 1e-9), 'margem entre 1o e 2o');
  ok(ent.filter(x => x.key !== 'nuloBranco' && x.key !== 'abstencao')
    .reduce((s, x) => s + x.pctValidos, 0) > 99.99, 'validos somam 100%');
}

console.log('\nSegundo turno');
M.SIM.agregado = { brasil: res1, ufs: {}, municipios: {} };
{
  const fin = M.simFinalistas();
  // simCalcular2T() e assincrono e roda no worker (transferencia local a
  // local, para permitir diferenciacao por grupo). Aqui exercitamos as pecas
  // puras: a matriz sugerida e a transformacao de um resultado agregado.
  M.SIM.t2.finalistasAtivos = fin;
  M.SIM.t2.matriz = M.simMatriz2TPadrao(fin);
  M.SIM.agregado2T = { brasil: M.transformar2T(res1), ufs: {}, municipios: {} };
  ok(fin.length === 2, 'dois finalistas');
  ok(fin[0] === 'cand_1' && fin[1] === 'cand_2', 'os dois mais votados',
    fin.join(' x '));
  ok(M.simPrecisaSegundoTurno() === true, 'lider abaixo de 50% dos validos vai a 2o turno');

  for (const k in M.SIM.t2.matriz) {
    const linha = M.SIM.t2.matriz[k];
    const soma = Object.values(linha).reduce((a, b) => a + b, 0);
    ok(perto(soma, 100, 0.01), `transferencia de "${k}" soma 100%`, soma.toFixed(3) + '%');
  }

  const r2 = M.SIM.agregado2T.brasil;
  ok(r2.votos.reduce((a, b) => a + b, 0) <= res1.aptos + 2
    && r2.votos.reduce((a, b) => a + b, 0) >= res1.aptos - 2,
    'o eleitorado apto se conserva no 2o turno',
    `${r2.votos.reduce((a, b) => a + b, 0)} de ${res1.aptos}`);

  const iA = M.idxColuna('cand_1'), iB = M.idxColuna('cand_2');
  ok(r2.votos[iA] >= res1.votos[iA] && r2.votos[iB] >= res1.votos[iB],
    'os finalistas so podem ganhar votos no 2o turno');
  ok(r2.votos[M.idxColuna('cand_3')] === 0, 'o eliminado zera');

  // Caiado (direita, pos 0.25) deve mandar mais votos para o candidato do PL
  // do que para o do PT.
  const linhaCaiado = M.SIM.t2.matriz['cand_3'];
  ok(linhaCaiado['cand_2'] > linhaCaiado['cand_1'],
    'eliminado de direita transfere mais para o finalista de direita',
    `${linhaCaiado['cand_2'].toFixed(1)}% vs ${linhaCaiado['cand_1'].toFixed(1)}%`);

  const ent2 = M.entradasDe(r2).filter(x => x.key === 'cand_1' || x.key === 'cand_2');
  ok(perto(ent2[0].pctValidos + ent2[1].pctValidos, 100, 0.01),
    'no 2o turno os dois finalistas somam 100% dos validos');
}

console.log('\nVitoria no primeiro turno');
{
  M.SIM.agregado = { brasil: { aptos: 100, votos: [55, 15, 5, 5, 5, 15] }, ufs: {}, municipios: {} };
  ok(M.simPrecisaSegundoTurno() === false, 'lider acima de 50% dos validos nao vai a 2o turno');
}

console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
