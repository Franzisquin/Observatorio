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
            bucketsFixados, opDoEscopo, pesosSimuladosDaRegiao, resultadoDoEscopo,
            ehGov, metaGov, nivelBase, nivelRefino, escopoTopo, noTopo,
            origensInfo, pesoOrigem, origemSugerida, pesosRegionaisPadrao,
            listaRegioes, opsRegionais, opsArray, prontoParaBase, panes,
            panesPosteriores, paneBase, rotuloPane, chaveArmazenamento,
            candidatosPadraoGov, chaveEscopo, nLocaisEscopo };`
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

// ============================================================================
// MODO GOVERNADOR
// ============================================================================

/* Estado do RJ em 2022, com os numeros reais do pacote (simgov2026). E o
   estado de teste do harness do worker, entao os dois casam. */
const IDX_GOV = {
  limiarOrigem: 1.5,
  ufs: {
    RJ: {
      uf: 'RJ', locais: 5050, nOrigens: 7, recordBytes: 16,
      origens: [
        { key: 'claudio_castro', rotulo: 'Cláudio Castro', partido: 'PL', pctValidos: 58.64, pctAptos: 41.02 },
        { key: 'marcelo_freixo', rotulo: 'Marcelo Freixo', partido: 'PSB', pctValidos: 27.37, pctAptos: 19.15 },
        { key: 'rodrigo_neves', rotulo: 'Rodrigo Neves', partido: 'PDT', pctValidos: 8.00, pctAptos: 5.60 },
        { key: 'paulo_ganime', rotulo: 'Paulo Ganime', partido: 'NOVO', pctValidos: 5.31, pctAptos: 3.71 },
        { key: 'outros', rotulo: 'Outros candidatos', pctValidos: 0.68, pctAptos: 0.47 },
        { key: 'nulo_branco', rotulo: 'Nulo ou branco', pctAptos: 5.90 },
        { key: 'abstencao', rotulo: 'Não compareceu', pctAptos: 22.87 }
      ]
    }
  }
};
const REG_GOV = {
  uf: 'RJ',
  origens: ['claudio_castro', 'marcelo_freixo', 'rodrigo_neves', 'paulo_ganime',
    'outros', 'nulo_branco', 'abstencao'],
  regioes: {
    'uf:RJ': {
      nivel: 'uf', codigo: 'RJ', aptos: 12857000,
      pct_aptos: { claudio_castro: 41.02, marcelo_freixo: 19.15, rodrigo_neves: 5.60, paulo_ganime: 3.71, outros: 0.47, nulo_branco: 5.90, abstencao: 22.87 },
      pct_validos: { claudio_castro: 58.64, marcelo_freixo: 27.37, rodrigo_neves: 8.00, paulo_ganime: 5.31, outros: 0.68 }
    },
    'ri:3301': {
      nivel: 'ri', codigo: '3301', nome: 'Rio de Janeiro', aptos: 9000000,
      pct_aptos: { claudio_castro: 39.0, marcelo_freixo: 21.0, rodrigo_neves: 5.5, paulo_ganime: 4.0, outros: 0.5, nulo_branco: 6.1, abstencao: 23.5 },
      pct_validos: { claudio_castro: 56.5, marcelo_freixo: 30.4, rodrigo_neves: 8.0, paulo_ganime: 4.4, outros: 0.7 }
    },
    'rgi:330001': {
      nivel: 'rgi', codigo: '330001', nome: 'Rio de Janeiro', rgint: '3301', aptos: 7000000,
      pct_aptos: { claudio_castro: 38.0, marcelo_freixo: 22.0, rodrigo_neves: 5.0, paulo_ganime: 4.2, outros: 0.5, nulo_branco: 6.2, abstencao: 23.6 },
      pct_validos: { claudio_castro: 55.0, marcelo_freixo: 31.9, rodrigo_neves: 7.2, paulo_ganime: 5.2, outros: 0.7 }
    }
  }
};

function entrarGovNoTeste() {
  M.SIM.modo = 'governador';
  M.SIM.ufGov = 'RJ';
  M.SIM.indiceGov = IDX_GOV;
  M.SIM.regioesGov = REG_GOV;
  M.SIM.candidatos = [];
  M.SIM.proxId = 1;
  M.SIM.pesosRegiao = {};
  M.SIM.regiaoTocada = {};
  M.SIM._assinaturaMigracao = null;
  M.SIM._cacheRegioes = {};
  M.SIM.ops.clear();
  M.SIM.regioes = {
    muni_to_region: {
      3300100: { ri: '3301', rgi: '330001', mr: '3', nome: 'Angra dos Reis' },
      3300209: { ri: '3301', rgi: '330001', mr: '3', nome: 'Aperibé' },
      3300308: { ri: '3301', rgi: '330002', mr: '3', nome: 'Araruama' },
      3500100: { ri: '3501', rgi: '350001', mr: '3', nome: 'Adamantina' }
    },
    rgint_by_uf: { RJ: [{ cd: '3301', nome: 'Rio de Janeiro' }], SP: [{ cd: '3501', nome: 'São Paulo' }] },
    rgi: {
      330001: { nome: 'Rio de Janeiro', rgint: '3301' },
      330002: { nome: 'Araruama', rgint: '3301' },
      350001: { nome: 'São Paulo', rgint: '3501' }
    },
    macro: { 3: { nome: 'Sudeste' } }
  };
  M.SIM.escopo = M.escopoTopo();
}

console.log('\nModo governador: origens e niveis');
{
  entrarGovNoTeste();
  ok(M.ehGov(), 'o modo fica ativo');
  ok(M.origensLista().join(',') === REG_GOV.origens.join(','),
    'as origens sao as do estado', `${M.origensLista().length} origens`);
  ok(M.nivelBase() === 'ri' && M.nivelRefino() === 'rgi',
    'RGINT vira a etapa obrigatoria e RGI o refinamento');
  ok(M.escopoTopo().level === 'uf' && M.escopoTopo().uf === 'RJ',
    'o topo da hierarquia e o estado');
  ok(M.nLocaisEscopo() === 5050, 'conta os locais do estado, nao do pais');
  ok(M.chaveArmazenamento() === 'simgov2026_cenario_RJ',
    'cada estado guarda o proprio cenario', M.chaveArmazenamento());

  const info = M.origensInfo();
  ok(info.claudio_castro.pos === M.getPartyPos('PL'),
    'a posicao da origem sai do partido dela em 2022');
  ok(perto(M.pesoOrigem('claudio_castro'), 41.02, 0.01),
    'o peso da origem sai do agregado estadual', `${M.pesoOrigem('claudio_castro')}%`);
}

console.log('\nModo governador: etapas do assistente');
{
  ok(!M.panes().includes('regioes'), 'nao ha etapa de macrorregiao');
  ok(M.panes().join(',') === 'candidatos,cenario,rgint,rgi,demografia,turno2',
    'as seis etapas na ordem certa', M.panes().join(' > '));
  ok(M.paneBase() === 'rgint', 'a etapa obrigatoria e a de RGINT');
  ok(M.panesPosteriores().has('rgi') && !M.panesPosteriores().has('rgint'),
    'RGINT abre de cara; RGI so depois da projecao base');
  ok(M.rotuloPane('rgint')[1] === 'Peso de cada região',
    'a RGINT e apresentada como peso, nao como ajuste fino');
}

console.log('\nModo governador: heranca de 2022');
{
  entrarGovNoTeste();
  M.candidatosPadraoGov();
  ok(M.SIM.candidatos.length === 4,
    'o estado abre com os candidatos de 2022', M.SIM.candidatos.map(c => c.nome).join(', '));
  ok(M.SIM.candidatos[0].origem === 'claudio_castro',
    'cada candidato ja vem vinculado a propria candidatura de 2022');
  ok(M.SIM.candidatos[0].partido === 'PL' && M.SIM.candidatos[0].cor === M.getPartyColor('PL'),
    'partido e cor vem do dado real');

  const p = M.pesosRegionaisPadrao('ri:3301');
  const cols = M.simColunas();
  const idxCastro = cols.findIndex(c => c.cand && c.cand.origem === 'claudio_castro');
  const idxFreixo = cols.findIndex(c => c.cand && c.cand.origem === 'marcelo_freixo');
  ok(perto(p.validos[cols[idxCastro].key], 56.5, 0.01),
    'o candidato herda o percentual da regiao', `${p.validos[cols[idxCastro].key]}%`);
  ok(perto(p.validos[cols[idxFreixo].key], 30.4, 0.01), 'idem para o segundo colocado');
  ok(perto(p.abstencao, 23.5, 0.01) && perto(p.nuloBranco, 6.1, 0.01),
    'abstencao e nulos vem direto de 2022, sem passar pela migracao');

  // Sem heranca o candidato nao puxa percentual nenhum — e o que permite
  // simular um nome novo, sem passado no estado.
  const novo = M.simAddCandidato('Candidata Nova', 'PSOL');
  const p2 = M.pesosRegionaisPadrao('ri:3301');
  ok((p2.validos['cand_' + novo.id] || 0) === 0,
    'candidato sem heranca comeca zerado');

  ok(M.origemSugerida({ nome: 'Marcelo Freixo', partido: '' }) === 'marcelo_freixo',
    'a heranca e sugerida pelo nome');
  ok(M.origemSugerida({ nome: 'Outro Nome', partido: 'PDT' }) === 'rodrigo_neves',
    'e, na falta do nome, pelo partido');
  ok(M.origemSugerida({ nome: 'Outro Nome', partido: 'PSOL' }) === '',
    'quem nao casa com ninguem fica sem heranca');
}

console.log('\nModo governador: assinatura e ops');
{
  entrarGovNoTeste();
  M.candidatosPadraoGov();
  const antes = M.assinaturaMigracao();
  M.SIM.candidatos[0].origem = 'marcelo_freixo';
  ok(M.assinaturaMigracao() !== antes,
    'trocar a heranca muda a assinatura da migracao');

  entrarGovNoTeste();
  M.candidatosPadraoGov();
  M.listaRegioes('ri').forEach(r => M.pesosDaRegiao(`ri:${r.codigo}`));
  const opsBase = M.opsRegionais('ri', 'base');
  ok(opsBase.length === 1 && opsBase[0].scope.nivel === 'ri',
    'a etapa obrigatoria emite op mesmo sem edicao', `${opsBase.length} op(s)`);
  ok(M.opsRegionais('rgi', 'refino').length === 0,
    'o refinamento so emite op depois de editado');

  M.SIM.pesosRegiao['rgi:330001'] = {
    validos: { [M.simColunas()[0].key]: 100 }, abstencao: 20, nuloBranco: 5
  };
  M.SIM.regiaoTocada['rgi:330001'] = true;
  const ops = M.opsArray();
  const ordem = ops.filter(o => o.scope.level === 'regiao').map(o => o.scope.nivel);
  ok(ordem.join(',') === 'ri,rgi',
    'RGINT vem antes da RGI, para a mais especifica vencer', ordem.join(' > '));
  ok(ops.some(o => o.scope.nivel === 'rgi'), 'a RGI editada vira op');
}

console.log('\nModo governador: porta de entrada da projecao');
{
  entrarGovNoTeste();
  M.candidatosPadraoGov();
  M.SIM.transfer = M.simTransferPadrao();
  // Migracao vazia: cada linha soma 0, o que e valido (<=100), mas as regioes
  // ainda nao tem divisao nenhuma entre candidatos.
  M.SIM.pesosRegiao = {};
  M.SIM._assinaturaMigracao = null;
  const e1 = M.prontoParaBase();
  ok(e1.regOk === true,
    'as RGINT ja nascem preenchidas com 2022, entao a porta abre');

  M.SIM.pesosRegiao['ri:3301'] = { validos: {}, abstencao: 20, nuloBranco: 5 };
  M.SIM.regiaoTocada['ri:3301'] = true;
  ok(M.prontoParaBase().regOk === false,
    'zerar todos os candidatos de uma RGINT fecha a porta');
}

console.log('\nModo governador: separacao dos cenarios salvos');
{
  entrarGovNoTeste();
  M.candidatosPadraoGov();
  const cen = M.cenarioSerializado();
  ok(cen.modo === 'governador' && cen.uf === 'RJ',
    'o cenario grava cargo e estado');

  armazem.set('simgov2026_cenario_RJ', JSON.stringify(
    Object.assign({}, cen, { modo: 'presidente', uf: null })));
  ok(M.restaurarLocal() === false,
    'cenario de outro cargo e descartado, nao misturado');

  armazem.set('simgov2026_cenario_RJ', JSON.stringify(
    Object.assign({}, cen, { uf: 'SP' })));
  ok(M.restaurarLocal() === false, 'cenario de outro estado tambem');

  armazem.set('simgov2026_cenario_RJ', JSON.stringify(cen));
  ok(M.restaurarLocal() === true, 'o cenario do proprio estado volta');
}

console.log('\nVolta ao modo presidencial');
{
  M.SIM.modo = 'presidente';
  M.SIM.ufGov = null;
  M.SIM._cacheRegioes = {};
  ok(!M.ehGov() && M.nivelBase() === 'mr' && M.nivelRefino() === 'ri',
    'os niveis voltam a macrorregiao e RGINT');
  ok(M.origensLista().join(',') === 'lula,bolsonaro,outros,nulo_branco,abstencao',
    'as origens voltam a ser as presidenciais');
  ok(M.chaveArmazenamento() === 'sim2026_cenario',
    'a chave do presidencial continua a antiga');
  ok(M.escopoTopo().level === 'nacional', 'o topo volta a ser o pais');
  ok(M.panes().includes('regioes') && !M.panes().includes('rgi'),
    'a etapa de macrorregiao volta e a de RGI some');
}

console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
