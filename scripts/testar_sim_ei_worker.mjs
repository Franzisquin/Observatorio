/* Harness de validacao do motor de inferencia ecologica, fora do browser.
 *
 * Carrega js/sim_ei_worker.js num contexto Node com `self` e `fetch` stubados
 * apontando para resultados_geo/sim2026/, e verifica as propriedades que a UI
 * assume verdadeiras. Se qualquer uma quebrar, o simulador mente numeros.
 *
 *     node scripts/testar_sim_ei_worker.mjs
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACOTES = path.join(RAIZ, 'resultados_geo', 'sim2026');

let falhas = 0;
function ok(cond, nome, detalhe = '') {
  console.log(`${cond ? '  ok  ' : '  FALHA'} ${nome}${detalhe ? '  — ' + detalhe : ''}`);
  if (!cond) falhas++;
}
const perto = (a, b, tol) => Math.abs(a - b) <= tol;

// ------------------------------------------------------------- ambiente

async function fetchLocal(url) {
  const arq = path.join(PACOTES, url.replace(/^.*sim2026\//, ''));
  const buf = await readFile(arq);
  return {
    ok: true,
    json: async () => JSON.parse(buf.toString('utf-8')),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
}

const fila = [];
const self = { postMessage: (m) => fila.push(m) };

const fonte = await readFile(path.join(RAIZ, 'js', 'sim_ei_worker.js'), 'utf-8');
// O worker fecha sobre `self` e `fetch`; injetamos ambos e recuperamos as
// funcoes internas que queremos testar isoladamente.
const criar = new Function('self', 'fetch', fonte + '\n;return {nnlsNormal, hamilton};');
const interno = criar(self, fetchLocal);

async function enviar(msg) {
  fila.length = 0;
  await self.onmessage({ data: msg });
  return fila;
}
const ultimo = (tipo) => [...fila].reverse().find((m) => m.type === tipo);

// ------------------------------------------------------------- pre-check

if (!existsSync(path.join(PACOTES, 'index.json'))) {
  console.error(`Nada em ${PACOTES}. Rode scripts/gerar_base_2026.py antes.`);
  process.exit(2);
}
const IDX = JSON.parse(await readFile(path.join(PACOTES, 'index.json'), 'utf-8'));
const UFS = Object.keys(IDX.ufs);
console.log(`Pacotes: ${UFS.join(', ')}  (${Object.values(IDX.ufs).reduce((a, b) => a + b, 0)} locais)\n`);

// ------------------------------------------------------------- 1) NNLS

console.log('NNLS (Lawson-Hanson sobre equacoes normais)');
{
  // Caso com solucao conhecida: A = I, b = [3, -2, 5] -> x = [3, 0, 5].
  const n = 3;
  const G = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const c = new Float64Array([3, -2, 5]);
  const x = interno.nnlsNormal(G, c, n);
  ok(perto(x[0], 3, 1e-8) && perto(x[1], 0, 1e-8) && perto(x[2], 5, 1e-8),
    'restricao de nao-negatividade', `x = [${[...x].map((v) => v.toFixed(4))}]`);

  // Sistema cheio: A = [[1,1],[1,2],[1,3]], b = A @ [2,1] -> x = [2,1].
  const A = [[1, 1], [1, 2], [1, 3]];
  const alvo = [2, 1];
  const b = A.map((r) => r[0] * alvo[0] + r[1] * alvo[1]);
  const G2 = new Float64Array(4), c2 = new Float64Array(2);
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 2; k++) {
      for (let l = 0; l < 2; l++) G2[k * 2 + l] += A[i][k] * A[i][l];
      c2[k] += A[i][k] * b[i];
    }
  }
  const x2 = interno.nnlsNormal(G2, c2, 2);
  ok(perto(x2[0], 2, 1e-6) && perto(x2[1], 1, 1e-6),
    'recupera solucao exata', `x = [${[...x2].map((v) => v.toFixed(4))}]`);
}

// ------------------------------------------------------------- 2) Hamilton

console.log('\nArredondamento de maior-resto');
{
  const saida = new Int32Array(3);
  interno.hamilton(new Float64Array([0.5, 0.5, 0.5]), 2, saida, 3);
  ok(saida[0] + saida[1] + saida[2] === 2, 'soma bate o total', `[${[...saida]}]`);
  const s2 = new Int32Array(4);
  interno.hamilton(new Float64Array([10.4, 20.4, 30.1, 39.1]), 100, s2, 4);
  ok([...s2].reduce((a, b) => a + b, 0) === 100, 'sem perder eleitor', `[${[...s2]}]`);
}

// ------------------------------------------------------------- 3) carga

console.log('\nCarga dos pacotes');
await enviar({ type: 'load', baseDir: 'sim2026/' });
const carregado = ultimo('loaded');
ok(!!carregado, 'pacotes carregados');
const NP = 4; // candA, candB, nulo/branco, abstencao
console.log(`  ${carregado.locais.toLocaleString('pt-BR')} locais, `
  + `${carregado.aptos.toLocaleString('pt-BR')} eleitores, `
  + `${carregado.imputados.toLocaleString('pt-BR')} imputados`);

// Transferencia identidade: cada comportamento de 2022 vira sua propria coluna.
const IDENT = [
  [1, 0, 0, 0],  // lula      -> candA
  [0, 1, 0, 0],  // bolsonaro -> candB
  [0, 0, 1, 0],  // nulo/branco
  [0, 0, 0, 1],  // abstencao
];

async function rodar(ops, escopo = { level: 'nacional' }) {
  await enviar({
    type: 'compute', parties: NP, transfer: IDENT, ops,
    activeScope: escopo, detailUfs: UFS,
  });
  const r = ultimo('result');
  if (!r) throw new Error('sem resultado: ' + JSON.stringify(ultimo('error')));
  return r;
}

// ------------------------------------------------------------- 4) base

console.log('\nSuperficie base (migracao de 2022)');
const base = await rodar([]);
{
  const b = base.agregado.brasil;
  const soma = b.votos.reduce((a, v) => a + v, 0);
  ok(soma === Math.round(b.aptos), 'conservacao nacional: votos == aptos',
    `${soma.toLocaleString('pt-BR')} vs ${b.aptos.toLocaleString('pt-BR')}`);

  let ruins = 0;
  for (const uf of UFS) {
    const loc = base.agregado.locais[uf];
    for (let i = 0; i < loc.length / NP; i++) {
      let s = 0;
      for (let p = 0; p < NP; p++) s += loc[i * NP + p];
      if (s < 0) ruins++;
    }
  }
  ok(ruins === 0, 'nenhum local com voto negativo');

  const val = b.votos[0] + b.votos[1];
  console.log(`  reproducao de 2022: A ${(100 * b.votos[0] / val).toFixed(2)}% / `
    + `B ${(100 * b.votos[1] / val).toFixed(2)}% dos validos, `
    + `abstencao ${(100 * b.votos[3] / b.aptos).toFixed(2)}%`);
}

// ------------------------------------------------------------- 5) determinismo

console.log('\nDeterminismo');
{
  const a = await rodar([]);
  const b = await rodar([]);
  ok(JSON.stringify(a.agregado.brasil) === JSON.stringify(b.agregado.brasil),
    'mesmo conjunto de ops -> mesmo resultado');
}

// ------------------------------------------------------------- 6) controle geral

console.log('\nControle geral (IPF ate o alvo agregado)');
{
  const alvo = 0.45; // 45% dos APTOS para o candidato A
  const r = await rodar([{ scope: { level: 'nacional' }, general: [alvo, null, null, null] }]);
  const b = r.agregado.brasil;
  const obtido = b.votos[0] / b.aptos;
  ok(perto(obtido, alvo, 5e-4), 'alvo nacional atingido',
    `alvo ${(100 * alvo).toFixed(2)}%, obtido ${(100 * obtido).toFixed(2)}%`);
  ok(b.votos.reduce((a, v) => a + v, 0) === Math.round(b.aptos),
    'conservacao apos o geral');

  const uf = UFS[0];
  const r2 = await rodar([{ scope: { level: 'uf', uf }, general: [0.6, null, null, null] }]);
  const u = r2.agregado.ufs[uf];
  ok(perto(u.votos[0] / u.aptos, 0.6, 5e-4), `alvo restrito a ${uf}`,
    `obtido ${(100 * u.votos[0] / u.aptos).toFixed(2)}%`);
  const outras = UFS.slice(1);
  if (outras.length) {
    const antes = base.agregado.ufs[outras[0]].votos[0];
    ok(r2.agregado.ufs[outras[0]].votos[0] === antes,
      'op de UF nao vaza para as outras UFs');
  }
}

// ------------------------------------------------------------- 7) alvo por grupo

console.log('\nEdicao demografica (realocacao aditiva calibrada)');
{
  // A propriedade que a UI promete: mover um bucket para um alvo desloca o
  // agregado daquele bucket em  eleitorado_bucket * (alvo - base_observada).
  const dimAlvo = 'escolaridade';
  const bucket = 5; // medio completo
  const supBase = base.demoSupport[dimAlvo][bucket];
  const alvoA = Math.min(0.95, supBase[0] + 0.10);
  const alvos = [alvoA, supBase[1] - 0.10, supBase[2], supBase[3]];

  const r = await rodar([{ scope: { level: 'nacional' }, demo: { [`${dimAlvo}|${bucket}`]: alvos } }]);
  const b = r.agregado.brasil;
  ok(b.votos.reduce((a, v) => a + v, 0) === Math.round(b.aptos),
    'conservacao apos edicao demografica');

  const dim = IDX.dimensions.find((d) => d.key === dimAlvo);
  const off = IDX.dimensions.slice(0, IDX.dimensions.indexOf(dim))
    .reduce((s, d) => s + d.buckets.length, 0);

  // Eleitorado do bucket, direto dos pacotes.
  let eleitoradoBucket = 0;
  const RB = IDX.recordBytes, HB = IDX.headerBytes;
  for (const uf of UFS) {
    const buf = await readFile(path.join(PACOTES, `locais_${uf}.bin`));
    for (let i = 0; i < IDX.ufs[uf]; i++) {
      const o = i * RB;
      const aptos = buf.readUInt32LE(o + 12);
      eleitoradoBucket += aptos * (buf[o + HB + off + bucket] / IDX.quant);
    }
  }
  const esperado = eleitoradoBucket * (alvoA - supBase[0]);
  const obtido = b.votos[0] - base.agregado.brasil.votos[0];
  ok(perto(obtido, esperado, Math.max(2000, 0.06 * Math.abs(esperado))),
    'deslocamento do agregado = eleitorado_bucket * delta',
    `esperado ${Math.round(esperado).toLocaleString('pt-BR')}, `
    + `obtido ${Math.round(obtido).toLocaleString('pt-BR')}`);

  ok(Math.sign(obtido) === Math.sign(esperado) && Math.abs(obtido) > 0,
    'a edicao move o resultado na direcao certa');
}

// ------------------------------------------------------------- 8) reinferencia

console.log('\nReinferencia dinamica');
{
  const r = await rodar([{
    scope: { level: 'nacional' },
    demo: { 'religiao|1': [0.60, 0.20, 0.10, 0.10] },   // evangelicos -> 60% no A
  }]);
  ok(!!r.demoSupport && !!r.demoSupport.idade,
    'apoio reestimado devolvido para as dimensoes nao editadas');

  const antes = base.demoSupport.religiao[1][0];
  const depois = r.demoSupport.religiao[1][0];
  ok(depois > antes, 'o bucket editado reflete o novo apoio',
    `${(100 * antes).toFixed(1)}% -> ${(100 * depois).toFixed(1)}%`);

  const somaOk = Object.values(r.demoSupport).every((linhas) =>
    linhas.every((l) => perto(l.reduce((a, v) => a + v, 0), 1, 1e-6) || l.every((v) => v === 0)));
  ok(somaOk, 'cada bucket soma 1 entre as colunas');
}

// ------------------------------------------------------------- 9) shares

console.log('\nParticipacoes (previa instantanea da thread principal)');
{
  await enviar({ type: 'shares', scope: { level: 'nacional' } });
  const s = ultimo('shares').shares;
  // A soma pode ficar pouco abaixo de 1: um local sem dado numa dimensao
  // (ex.: sem codigo IBGE, logo sem religiao municipal) contribui zero nela.
  // O que nao pode e passar de 1 nem faltar cobertura relevante.
  const cobertura = Object.fromEntries(IDX.dimensions.map((d) =>
    [d.key, s[d.key].reduce((a, v) => a + v, 0)]));
  const ruins = Object.entries(cobertura).filter(([, v]) => v > 1 + 1e-6 || v < 0.995);
  ok(ruins.length === 0, 'toda dimensao cobre >=99,5% do eleitorado e nao passa de 100%',
    ruins.length ? JSON.stringify(ruins) : Object.entries(cobertura)
      .map(([k, v]) => `${k} ${(100 * v).toFixed(3)}%`).join(' · '));
  const esc = IDX.dimensions.find((d) => d.key === 'escolaridade');
  console.log('  ' + esc.buckets.map((b, i) =>
    `${b.label} ${(100 * s.escolaridade[i]).toFixed(1)}%`).join(' · '));
}

// ------------------------------------------------------- 10) segundo turno

console.log('\nSegundo turno (transferência local a local)');
{
  await rodar([]);   // volta a superfície base
  const iA = 0, iB = 1, iOutros = 2, iNulo = 2, iAbst = 3;
  // NP=4: [A, B, nulo/branco, abstenção]. O único eliminado é nulo/branco.
  const base = ultimo('result').agregado.brasil;

  // Transferência uniforme: metade do nulo/branco vai para A, metade fica nulo.
  await enviar({
    type: 'turno2', finalistas: [iA, iB], iNulo, iAbst,
    matriz: { 2: [0.5, 0, 0.5, 0] },
  });
  const uni = ultimo('turno2').agregado;
  ok(!!uni, 'segundo turno calculado');
  ok(perto(uni.brasil.votos.reduce((a, b) => a + b, 0), base.aptos, 3),
    'eleitorado apto se conserva',
    `${uni.brasil.votos.reduce((a, b) => a + b, 0).toLocaleString('pt-BR')} de ${base.aptos.toLocaleString('pt-BR')}`);
  const ganhoA = uni.brasil.votos[iA] - base.votos[iA];
  ok(perto(ganhoA, 0.5 * base.votos[2], Math.max(50, 0.001 * base.votos[2])),
    'A recebe metade da pilha do eliminado',
    `${Math.round(ganhoA).toLocaleString('pt-BR')} de ${Math.round(0.5 * base.votos[2]).toLocaleString('pt-BR')}`);

  // Diferenciada por religião: evangélicos (bucket 1) mandam tudo para B,
  // os demais buckets seguem a linha global (metade para A).
  await enviar({
    type: 'turno2', finalistas: [iA, iB], iNulo, iAbst,
    matriz: { 2: [0.5, 0, 0.5, 0] },
    porGrupo: { dim: 'religiao', linhas: { 1: { 2: [0, 1, 0, 0] } } },
  });
  const dif = ultimo('turno2').agregado;
  ok(perto(dif.brasil.votos.reduce((a, b) => a + b, 0), base.aptos, 3),
    'conservação também na versão por grupo');
  ok(dif.brasil.votos[iB] > uni.brasil.votos[iB] && dif.brasil.votos[iA] < uni.brasil.votos[iA],
    'diferenciar por grupo desloca o resultado',
    `B ${(dif.brasil.votos[iB] - uni.brasil.votos[iB]).toLocaleString('pt-BR')} votos a mais`);

  // O deslocamento tem de sair do peso real dos evangélicos no eleitorado.
  await enviar({ type: 'shares', scope: { level: 'nacional' } });
  const pesoEvang = ultimo('shares').shares.religiao[1];
  const desloc = (dif.brasil.votos[iB] - uni.brasil.votos[iB]) / base.votos[2];
  ok(perto(desloc, pesoEvang, 0.05),
    'o deslocamento acompanha o peso do grupo no eleitorado',
    `${(100 * desloc).toFixed(1)}% vs peso evangélico ${(100 * pesoEvang).toFixed(1)}%`);

  // Estados mais evangélicos têm de se mover mais que os menos evangélicos.
  const movUF = UFS.map((uf) => ({
    uf, mov: (dif.ufs[uf].votos[iB] - uni.ufs[uf].votos[iB]) / Math.max(1, uni.ufs[uf].aptos),
  })).sort((a, b) => b.mov - a.mov);
  ok(movUF[0].mov > movUF[movUF.length - 1].mov,
    'o efeito varia entre estados conforme a composição',
    `${movUF[0].uf} se move mais que ${movUF[movUF.length - 1].uf}`);
}

console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
