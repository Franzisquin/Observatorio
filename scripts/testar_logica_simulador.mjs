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
            pesosDaRegiao, sincronizarPesosRegionais, assinaturaMigracao,
            travar100, vetorParaEditor, editorParaVetor, simAplicarSupport,
            bucketsFixados, opDoEscopo, pesosSimuladosDaRegiao, resultadoDoEscopo };`
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
    ok(perto(M.simTransferTotal(o), 0, 0.01), `linha "${o}" inicia zerada (0%)`,
      M.simTransferTotal(o).toFixed(3) + '%');
  }
  const m = M.simTransferMatriz();
  ok(m.length === 5 && m[0].length === 6, 'matriz no formato do worker (5 origens x 6 colunas)',
    `${m.length}x${m[0].length}`);
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

console.log('\nTrava de 100%');
{
  ok(M.travar100(80, 70) === 30, 'o slider para no que sobra dos outros',
    String(M.travar100(80, 70)));
  ok(M.travar100(50, 120) === 0, 'teto negativo vira 0 em vez de valor negativo');
  ok(M.travar100(40, 30) === 40, 'dentro da folga o valor passa intacto');
  ok(M.travar100(-5, 0) === 0, 'nao aceita negativo');

  // Linha de 2o turno ja em 100%: subir um destino nao pode passar de 100.
  const linha = { cand_1: 40, cand_2: 30, nuloBranco: 12, abstencao: 18 };
  const destinos = ['cand_1', 'cand_2', 'nuloBranco', 'abstencao'];
  const novo = M.travar100(90, destinos.filter(d => d !== 'cand_1')
    .reduce((s, d) => s + linha[d], 0));
  linha.cand_1 = novo;
  const soma = destinos.reduce((s, d) => s + linha[d], 0);
  ok(perto(soma, 100, 1e-9), 'linha de 2o turno em 100% nao ultrapassa 100',
    `cand_1 travou em ${novo}, soma ${soma}`);
}

console.log('\nDemografia: vetor do worker <-> editor');
{
  // 6 colunas: cand_1, cand_2, cand_3, outros, nuloBranco, abstencao.
  const vet = [0.30, 0.25, 0.10, 0.05, 0.06, 0.24];   // soma 1 sobre os aptos
  const ed = M.vetorParaEditor(vet);

  const somaValidos = M.simColunasValidas().reduce((s, c) => s + ed.validos[c.key], 0);
  ok(perto(somaValidos, 100, 1e-9), 'no editor os validos somam 100% entre si',
    somaValidos.toFixed(4) + '%');
  ok(perto(ed.abstencao, 24, 1e-9), 'abstencao sobrevive como % dos aptos',
    ed.abstencao.toFixed(2) + '%');
  ok(perto(ed.nuloBranco, 6, 1e-9), 'nulos sobrevivem como % dos aptos');
  ok(perto(ed.validos.cand_1, 100 * 0.30 / 0.70, 1e-9),
    'candidato vira % dos validos do grupo', ed.validos.cand_1.toFixed(2) + '%');

  const volta = M.editorParaVetor(ed);
  ok(vet.every((v, i) => perto(volta[i], v, 1e-9)), 'ida e volta preserva o vetor',
    volta.map(x => x.toFixed(4)).join(' '));

  // Com o bloco de validos em 92% (usuario ainda ajustando), o vetor exportado
  // continua somando 1 — a normalizacao acontece na exportacao, como em
  // opsRegionais.
  const parcial = {
    validos: { cand_1: 40, cand_2: 30, cand_3: 12, outros: 10 },  // 92%
    abstencao: 24, nuloBranco: 6
  };
  const vp = M.editorParaVetor(parcial);
  ok(perto(vp.reduce((a, b) => a + b, 0), 1, 1e-9),
    'bloco de validos em 92% ainda exporta vetor somando 1',
    vp.reduce((a, b) => a + b, 0).toFixed(6));
  ok(perto(vp[M.idxColuna('abstencao')], 0.24, 1e-9),
    'a normalizacao dos validos nao mexe no comparecimento');
  ok(perto(vp[M.idxColuna('cand_1')] / vp[M.idxColuna('cand_2')], 40 / 30, 1e-9),
    'a proporcao entre candidatos e preservada');

  // Comparecimento no limite: 95% fora dos validos deixa 5% de pool.
  const semPool = M.editorParaVetor({
    validos: { cand_1: 50, cand_2: 50 }, abstencao: 70, nuloBranco: 30
  });
  ok(semPool.every(x => x >= 0) && perto(semPool.reduce((a, b) => a + b, 0), 1, 1e-9),
    'abstencao + nulos em 100% nao produz voto valido negativo',
    semPool.map(x => x.toFixed(3)).join(' '));
}

console.log('\nDemografia: o que fica fixo e o que se reestima');
{
  M.SIM.escopo = { level: 'nacional' };
  M.SIM.ops.clear();
  M.SIM.support = { religiao: [[0.3, 0.2, 0.1, 0.05, 0.05, 0.3], [0.1, 0.4, 0.1, 0.05, 0.05, 0.3]] };

  ok(M.bucketsFixados().size === 0, 'sem ops nenhum bucket esta fixo');

  const op = M.opDoEscopo(M.SIM.escopo, true);
  op.demo['religiao|0'] = [0.3, 0.2, 0.1, 0.05, 0.05, 0.3];
  ok(M.bucketsFixados().has('religiao|0'), 'bucket com meta em op.demo conta como fixo');

  // A reestimativa do worker chega e so pode mexer no bucket sem meta.
  M.simAplicarSupport({ religiao: [[9, 9, 9, 9, 9, 9], [8, 8, 8, 8, 8, 8]] });
  ok(M.SIM.support.religiao[0][0] === 0.3, 'bucket com meta nao e sobrescrito');
  ok(M.SIM.support.religiao[1][0] === 8, 'bucket sem meta acompanha a reestimativa');

  // O conjunto e por escopo: em SP nao ha meta nenhuma, entao tudo se reestima.
  M.SIM.escopo = { level: 'uf', uf: 'SP' };
  ok(M.bucketsFixados().size === 0, 'meta nacional nao vaza para o escopo da UF');
  M.simAplicarSupport({ religiao: [[7, 7, 7, 7, 7, 7], [7, 7, 7, 7, 7, 7]] });
  ok(M.SIM.support.religiao[0][0] === 7, 'no escopo sem meta o bucket volta a se reestimar');
  M.SIM.escopo = { level: 'nacional' };
  M.SIM.ops.clear();
}

console.log('\nRegioes intermediarias saem da simulacao, nao de 2022');
{
  // Dois municipios da regiao, com resultados bem diferentes de 2022.
  M.SIM.agregado = {
    brasil: res1, ufs: {},
    municipios: {
      '1100015': { aptos: 100, votos: [40, 20, 10, 5, 5, 20] },
      '1100023': { aptos: 100, votos: [20, 40, 10, 5, 5, 20] }
    }
  };
  const p = M.pesosSimuladosDaRegiao({ codigo: '1101', munis: [1100015, 1100023] });
  const validos = 60 + 60 + 20 + 10;   // soma dos validos das duas cidades
  ok(p != null, 'a regiao tem pesos derivados da simulacao');
  ok(perto(p.validos.cand_1, 100 * 60 / validos, 1e-9),
    'candidato vem do agregado simulado da regiao', p.validos.cand_1.toFixed(2) + '%');
  ok(perto(p.validos.cand_1, p.validos.cand_2, 1e-9),
    'os dois municipios se compensam, como manda a agregacao');
  ok(perto(p.abstencao, 20, 1e-9), 'abstencao em % dos aptos da regiao');
  ok(perto(p.nuloBranco, 5, 1e-9), 'nulos em % dos aptos da regiao');
  ok(p.aptos === 200, 'eleitorado da regiao e a soma dos municipios');

  const somaV = M.simColunasValidas().reduce((s, c) => s + p.validos[c.key], 0);
  ok(perto(somaV, 100, 1e-9), 'os validos da regiao somam 100%', somaV.toFixed(4) + '%');

  // Nenhum candidato e zerado por nao ser do PT nem do PL — era o que a leitura
  // de 2022 fazia com todo mundo fora esses dois.
  ok(p.validos.cand_3 > 0, 'candidato fora de PT/PL nao e zerado');

  ok(M.pesosSimuladosDaRegiao({ codigo: '9999', munis: [999999] }) === null,
    'regiao sem municipio na simulacao devolve null em vez de zeros');
}

console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
