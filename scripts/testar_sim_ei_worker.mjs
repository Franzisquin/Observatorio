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
const dp = (xs) => {
  const mu = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / xs.length);
};

// ------------------------------------------------------------- ambiente

/* Stub de fetch que se comporta como o browser: resolve a URL de verdade e
 * devolve 404 quando o arquivo nao existe.
 *
 * A versao anterior normalizava o caminho com um regex, o que escondia um bug
 * real — dentro de um Worker as URLs relativas resolvem contra o script do
 * worker (js/), nao contra a pagina, entao 'resultados_geo/sim2026/index.json'
 * virava 'js/resultados_geo/...' e batia em 404. O stub tem de ser tao rigoroso
 * quanto o browser, senao o teste passa e a pagina quebra. */
const BASE_PAGINA = new URL('file:///' + RAIZ.replace(/\\/g, '/') + '/');

async function fetchLocal(url) {
  const arq = fileURLToPath(new URL(url, BASE_PAGINA));
  let buf;
  try {
    buf = await readFile(arq);
  } catch {
    const html = '<!DOCTYPE html><html><body>404</body></html>';
    return {
      ok: false, status: 404,
      json: async () => JSON.parse(html),
      arrayBuffer: async () => new TextEncoder().encode(html).buffer,
    };
  }
  return {
    ok: true, status: 200,
    json: async () => JSON.parse(buf.toString('utf-8')),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
}

const fila = [];
const self = { postMessage: (m) => fila.push(m) };

const fonte = await readFile(path.join(RAIZ, 'js', 'sim_ei_worker.js'), 'utf-8');
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
console.log(`Pacotes: ${UFS.length} UFs, ${Object.values(IDX.ufs).reduce((a, b) => a + b, 0)} locais, `
  + `registro ${IDX.recordBytes}B\n`);

// ------------------------------------------------------------- 1) NNLS

console.log('NNLS (Lawson-Hanson sobre equacoes normais)');
{
  const G = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const c = new Float64Array([3, -2, 5]);
  const x = interno.nnlsNormal(G, c, 3);
  ok(perto(x[0], 3, 1e-8) && perto(x[1], 0, 1e-8) && perto(x[2], 5, 1e-8),
    'restricao de nao-negatividade', `x = [${[...x].map((v) => v.toFixed(4))}]`);

  const A = [[1, 1], [1, 2], [1, 3]];
  const b = A.map((r) => r[0] * 2 + r[1] * 1);
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
  const s1 = new Int32Array(3);
  interno.hamilton(new Float64Array([0.5, 0.5, 0.5]), 2, s1, 3);
  ok(s1[0] + s1[1] + s1[2] === 2, 'soma bate o total', `[${[...s1]}]`);
  const s2 = new Int32Array(4);
  interno.hamilton(new Float64Array([10.4, 20.4, 30.1, 39.1]), 100, s2, 4);
  ok([...s2].reduce((a, b) => a + b, 0) === 100, 'sem perder eleitor', `[${[...s2]}]`);
}

// ------------------------------------------------------------- 3) carga

console.log('\nCarga dos pacotes');
{
  // Dentro de um Worker as URLs relativas resolvem contra o script do worker,
  // nao contra a pagina — por isso simulador.js passa baseDir absoluto.
  await enviar({ type: 'load', baseDir: 'nao/existe/' });
  const err = ultimo('error');
  ok(!!err && /HTTP 404/.test(err.erro), 'caminho errado falha com erro legivel',
    err ? err.erro.split('\n')[0] : 'sem erro');
}
await enviar({ type: 'load', baseDir: new URL('resultados_geo/sim2026/', BASE_PAGINA).href });
const carregado = ultimo('loaded');
ok(!!carregado, 'pacotes carregados');
console.log(`  ${carregado.locais.toLocaleString('pt-BR')} locais, `
  + `${carregado.aptos.toLocaleString('pt-BR')} eleitores, `
  + `${carregado.imputados.toLocaleString('pt-BR')} imputados`);

// Colunas: [A, B, outros, nulo/branco, abstencao]. Transferencia identidade a
// partir das 5 origens do 1o turno de 2022.
const NP5 = 5, iOutros = 2, iNulo = 3, iAbst = 4;
const IDENT = [
  [1, 0, 0, 0, 0],
  [0, 1, 0, 0, 0],
  [0, 0, 1, 0, 0],
  [0, 0, 0, 1, 0],
  [0, 0, 0, 0, 1],
];

async function rodar(ops, escopo = { level: 'nacional' }, redutos = null) {
  await enviar({
    type: 'compute', parties: NP5, transfer: IDENT, ops, redutos,
    iNulo, iAbst, activeScope: escopo,
  });
  const r = ultimo('result');
  if (!r) throw new Error('sem resultado: ' + JSON.stringify(ultimo('error')));
  return r;
}
async function detalhe(uf, turno = 1) {
  await enviar({ type: 'detail', uf, turno });
  return ultimo('detail').votos;
}

// ------------------------------------------------------------- 4) base

console.log('\nSuperficie base (migracao do 1o turno de 2022)');
const base = await rodar([]);
{
  const b = base.agregado.brasil;
  ok(b.votos.reduce((a, v) => a + v, 0) === Math.round(b.aptos),
    'conservacao nacional: votos == aptos',
    `${b.votos.reduce((a, v) => a + v, 0).toLocaleString('pt-BR')}`);

  const loc = await detalhe(UFS[0]);
  ok(loc.every((v) => v >= 0), 'nenhum local com voto negativo');

  const val = b.votos[0] + b.votos[1] + b.votos[iOutros];
  console.log(`  1o turno de 2022: Lula ${(100 * b.votos[0] / val).toFixed(2)}%`
    + ` / Bolsonaro ${(100 * b.votos[1] / val).toFixed(2)}%`
    + ` / outros ${(100 * b.votos[iOutros] / val).toFixed(2)}% dos validos`);
  console.log(`  abstencao ${(100 * b.votos[iAbst] / b.aptos).toFixed(2)}%`
    + `, nulos e brancos ${(100 * b.votos[iNulo] / b.aptos).toFixed(2)}% dos aptos`);
}

// ------------------------------------------------------- 5) determinismo

console.log('\nDeterminismo');
{
  const a = await rodar([]);
  const b = await rodar([]);
  ok(JSON.stringify(a.agregado.brasil) === JSON.stringify(b.agregado.brasil),
    'mesmo conjunto de ops -> mesmo resultado');
}

// -------------------------------------- 6) turnout independente e nuances

console.log('\nAbstencao e nulos: alvos independentes dos candidatos');
{
  const r = await rodar([{ scope: { level: 'nacional' }, abstencao: 0.28, nuloBranco: 0.06 }]);
  const b = r.agregado.brasil;
  ok(perto(b.votos[iAbst] / b.aptos, 0.28, 1e-3), 'alvo de abstencao atingido',
    `${(100 * b.votos[iAbst] / b.aptos).toFixed(2)}%`);
  ok(perto(b.votos[iNulo] / b.aptos, 0.06, 1e-3), 'alvo de nulos atingido',
    `${(100 * b.votos[iNulo] / b.aptos).toFixed(2)}%`);
  ok(b.votos.reduce((a, v) => a + v, 0) === Math.round(b.aptos), 'conservacao');

  const a0 = base.agregado.brasil;
  const va = a0.votos[0] + a0.votos[1] + a0.votos[iOutros];
  const vd = b.votos[0] + b.votos[1] + b.votos[iOutros];
  ok(perto(b.votos[0] / vd, a0.votos[0] / va, 3e-3),
    'a divisao entre candidatos fica preservada',
    `${(100 * a0.votos[0] / va).toFixed(2)}% -> ${(100 * b.votos[0] / vd).toFixed(2)}%`);

  // O ponto central do pedido: a nuance municipal do turnout tem de sobreviver.
  const chaves = Object.entries(base.agregado.municipios)
    .filter(([, m]) => m.aptos > 5000).map(([k]) => k);
  const antes = chaves.map((k) => base.agregado.municipios[k].votos[iAbst] / base.agregado.municipios[k].aptos);
  const depois = chaves.map((k) => r.agregado.municipios[k].votos[iAbst] / r.agregado.municipios[k].aptos);
  const cv = (xs) => dp(xs) / (xs.reduce((a, b2) => a + b2, 0) / xs.length);
  ok(cv(depois) > 0.7 * cv(antes),
    'a variacao municipal de abstencao NAO foi homogeneizada',
    `dispersao relativa ${(100 * cv(antes)).toFixed(1)}% -> ${(100 * cv(depois)).toFixed(1)}%`
    + ` em ${chaves.length} municipios`);
  ok(dp(depois) > 0.02, 'ainda ha espalhamento real entre municipios',
    `desvio-padrao ${(100 * dp(depois)).toFixed(2)}pp`);
}

// ------------------------------------------- 7) divisao entre candidatos

console.log('\nDivisao dos validos entre candidatos');
{
  const r = await rodar([{ scope: { level: 'nacional' }, validos: [0.45, 0.35, 0.20, null, null] }]);
  const b = r.agregado.brasil;
  const val = b.votos[0] + b.votos[1] + b.votos[iOutros];
  ok(perto(b.votos[0] / val, 0.45, 1e-3) && perto(b.votos[1] / val, 0.35, 1e-3),
    'alvos nacionais atingidos sobre os validos',
    `${(100 * b.votos[0] / val).toFixed(2)}% / ${(100 * b.votos[1] / val).toFixed(2)}%`);
  ok(b.votos.reduce((a, v) => a + v, 0) === Math.round(b.aptos), 'conservacao');
  const a0 = base.agregado.brasil;
  ok(perto(b.votos[iAbst] / b.aptos, a0.votos[iAbst] / a0.aptos, 3e-3),
    'a abstencao nao se mexe quando so os validos sao alvo');

  const uf = UFS[0];
  const r2 = await rodar([{ scope: { level: 'uf', uf }, validos: [0.60, 0.25, 0.15, null, null] }]);
  const u = r2.agregado.ufs[uf];
  const vu = u.votos[0] + u.votos[1] + u.votos[iOutros];
  ok(perto(u.votos[0] / vu, 0.60, 1e-3), `alvo restrito a ${uf}`,
    `${(100 * u.votos[0] / vu).toFixed(2)}%`);
  const outra = UFS.find((x) => x !== uf);
  ok(r2.agregado.ufs[outra].votos[0] === base.agregado.ufs[outra].votos[0],
    'op de UF nao vaza para as outras UFs');
}

// ------------------------------------- 8) macrorregiao antes de RGINT

console.log('\nOrdem de aplicacao: macrorregiao -> regiao intermediaria');
{
  const reg = JSON.parse(await readFile(path.join(PACOTES, 'baselines', 'regioes.json'), 'utf-8'));
  const mapa = JSON.parse(await readFile(path.join(RAIZ, 'resultados_geo', 'regioes_ibge.json'), 'utf-8'));
  const munsDe = (nivel, cod) => Object.entries(mapa.muni_to_region)
    .filter(([, v]) => String(v[nivel]) === String(cod)).map(([k]) => Number(k));

  const mr = Object.values(reg.regioes).find((x) => x.nivel === 'mr');
  const ri = Object.values(reg.regioes).find((x) => x.nivel === 'ri'
    && munsDe('ri', x.codigo).some((ib) => String(mapa.muni_to_region[ib].mr) === String(mr.codigo)));
  ok(!!mr && !!ri, 'agregados regionais disponiveis',
    mr && ri ? `macro ${mr.codigo} contem RGINT ${ri.codigo}` : '');

  const opMR = {
    scope: { level: 'regiao', nivel: 'mr', regiao: mr.codigo, ibges: munsDe('mr', mr.codigo) },
    validos: [0.70, 0.20, 0.10, null, null],
  };
  const opRI = {
    scope: { level: 'regiao', nivel: 'ri', regiao: ri.codigo, ibges: munsDe('ri', ri.codigo) },
    validos: [0.20, 0.70, 0.10, null, null],
  };
  // Passados na ordem inversa de proposito: o worker tem de reordenar sozinho.
  const r = await rodar([opRI, opMR]);
  const acc = new Array(NP5).fill(0);
  opRI.scope.ibges.forEach((ib) => {
    const m = r.agregado.municipios[String(ib)];
    if (m) for (let p = 0; p < NP5; p++) acc[p] += m.votos[p];
  });
  const vRI = acc[0] + acc[1] + acc[iOutros];
  ok(perto(acc[0] / vRI, 0.20, 8e-3),
    'a RGINT vence a macrorregiao que a contem',
    `${(100 * acc[0] / vRI).toFixed(2)}% (alvo 20%; a macro pedia 70%)`);
}

// ------------------------------------------------------------ 9) redutos

console.log('\nRedutos pessoais de governador');
{
  const redutos = IDX.redutos || [];
  ok(redutos.length > 0, 'pacote traz colunas de reduto',
    redutos.map((r) => `${r.key}/${r.uf}`).join(', '));

  if (redutos.some((r) => r.key === 'zema') && UFS.includes('MG')) {
    const sem = await rodar([]);
    const com = await rodar([], { level: 'nacional' },
      [{ coluna: iOutros, reduto: 'zema', forca: 1 }]);
    const a = sem.agregado.ufs.MG, d = com.agregado.ufs.MG;

    ok(Math.abs(d.votos[iOutros] - a.votos[iOutros]) < 0.005 * a.votos[iOutros],
      'o total do candidato no estado se conserva',
      `${a.votos[iOutros].toLocaleString('pt-BR')} -> ${d.votos[iOutros].toLocaleString('pt-BR')}`);
    ok(d.votos.reduce((x, y) => x + y, 0) === a.votos.reduce((x, y) => x + y, 0),
      'o eleitorado apto de MG nao muda');
    ok(Math.abs(d.votos[iAbst] - a.votos[iAbst]) <= 2,
      'abstencao intacta — o delta sai so dos outros candidatos');

    const muns = Object.entries(com.agregado.municipios)
      .filter(([, m]) => m.uf === 'MG').map(([k]) => k);
    const share = (ag, k) => {
      const m = ag.agregado.municipios[k];
      const v = m.votos[0] + m.votos[1] + m.votos[iOutros];
      return v > 0 ? m.votos[iOutros] / v : 0;
    };

    /* A prova nao e a dispersao — o padrao anterior (Ciro/Tebet) tem magnitude
       parecida — e sim o PADRAO ESPACIAL: a votacao tem de passar a acompanhar
       o desempenho do politico para governador, municipio a municipio. */
    const govPorMuni = new Map();
    const bufMG = await readFile(path.join(PACOTES, 'locais_MG.bin'));
    const rZema = IDX.redutos.findIndex((x) => x.key === 'zema');
    for (let i = 0; i < IDX.ufs.MG; i++) {
      const o = i * IDX.recordBytes;
      const ibge = bufMG.readUInt32LE(o + 4), aptos = bufMG.readUInt32LE(o + 12);
      const g = govPorMuni.get(ibge) || { v: 0, a: 0 };
      g.v += (bufMG[o + IDX.redutosOffset + rZema] / IDX.quant) * aptos;
      g.a += aptos;
      govPorMuni.set(ibge, g);
    }
    const corr = (xs, ys) => {
      const mx = xs.reduce((p, q) => p + q, 0) / xs.length;
      const my = ys.reduce((p, q) => p + q, 0) / ys.length;
      let sxy = 0, sxx = 0, syy = 0;
      for (let i = 0; i < xs.length; i++) {
        sxy += (xs[i] - mx) * (ys[i] - my);
        sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2;
      }
      return sxy / Math.sqrt(sxx * syy);
    };
    const gov = muns.map((k) => {
      const g = govPorMuni.get(Number(k));
      return g && g.a > 0 ? g.v / g.a : 0;
    });
    const cA = corr(muns.map((k) => share(sem, k)), gov);
    const cD = corr(muns.map((k) => share(com, k)), gov);
    ok(cD > 0.9 && cD > cA + 0.3,
      'o voto passa a vir dos municipios onde foi bem para governador',
      `correlacao municipal ${cA.toFixed(3)} -> ${cD.toFixed(3)} em ${muns.length} municipios`);

    const fora = UFS.find((u) => u !== 'MG');
    ok(com.agregado.ufs[fora].votos[iOutros] === sem.agregado.ufs[fora].votos[iOutros],
      'nenhum efeito fora do estado do reduto');
  }
}

// --------------------------------------------------- 10) demografia + EI

console.log('\nEdicao demografica (realocacao aditiva calibrada)');
{
  const dimAlvo = 'escolaridade', bucket = 5;
  const sup = base.demoSupport[dimAlvo][bucket];
  const alvoA = Math.min(0.95, sup[0] + 0.10);
  const alvos = [alvoA, Math.max(0, sup[1] - 0.10), sup[2], sup[3], sup[4]];

  const r = await rodar([{ scope: { level: 'nacional' }, demo: { [`${dimAlvo}|${bucket}`]: alvos } }]);
  const b = r.agregado.brasil;
  ok(b.votos.reduce((a, v) => a + v, 0) === Math.round(b.aptos), 'conservacao');

  const dim = IDX.dimensions.find((d) => d.key === dimAlvo);
  const off = IDX.dimensions.slice(0, IDX.dimensions.indexOf(dim))
    .reduce((s, d) => s + d.buckets.length, 0);
  let eleitorado = 0;
  const RB = IDX.recordBytes, HB = IDX.headerBytes;
  for (const uf of UFS) {
    const buf = await readFile(path.join(PACOTES, `locais_${uf}.bin`));
    for (let i = 0; i < IDX.ufs[uf]; i++) {
      const o = i * RB;
      eleitorado += buf.readUInt32LE(o + 12) * (buf[o + HB + off + bucket] / IDX.quant);
    }
  }
  const esperado = eleitorado * (alvoA - sup[0]);
  const obtido = b.votos[0] - base.agregado.brasil.votos[0];
  ok(perto(obtido, esperado, Math.max(5000, 0.10 * Math.abs(esperado))),
    'deslocamento = eleitorado_bucket * delta',
    `esperado ${Math.round(esperado).toLocaleString('pt-BR')}, `
    + `obtido ${Math.round(obtido).toLocaleString('pt-BR')}`);

  ok(!!r.demoSupport && !!r.demoSupport.idade, 'apoio reestimado nas dimensoes nao editadas');
  ok(Object.values(r.demoSupport).every((ls) =>
    ls.every((l) => perto(l.reduce((a, v) => a + v, 0), 1, 1e-6) || l.every((v) => v === 0))),
  'cada bucket soma 1 entre as colunas');
}

// ------------------------------------------------------------ 11) shares

console.log('\nParticipacoes (previa instantanea da thread principal)');
{
  await enviar({ type: 'shares', scope: { level: 'nacional' } });
  const s = ultimo('shares').shares;
  const cob = Object.fromEntries(IDX.dimensions.map((d) => [d.key, s[d.key].reduce((a, v) => a + v, 0)]));
  const ruins = Object.entries(cob).filter(([, v]) => v > 1 + 1e-6 || v < 0.995);
  ok(ruins.length === 0, 'toda dimensao cobre >=99,5% e nao passa de 100%',
    ruins.length ? JSON.stringify(ruins) : 'ok');
}

// ------------------------------------------------------- 12) segundo turno

console.log('\nSegundo turno (transferencia local a local)');
{
  await rodar([]);
  const b0 = ultimo('result').agregado.brasil;

  const msgUni = { type: 'turno2', finalistas: [0, 1], iNulo, iAbst, matriz: {} };
  msgUni.matriz[iOutros] = [0.5, 0.5, 0, 0];
  await enviar(msgUni);
  const uni = ultimo('turno2').agregado;
  ok(!!uni, 'segundo turno calculado');
  ok(perto(uni.brasil.votos.reduce((a, b) => a + b, 0), b0.aptos, 5),
    'eleitorado apto se conserva');
  ok(perto(uni.brasil.votos[0] - b0.votos[0], 0.5 * b0.votos[iOutros], 3000),
    'metade da pilha do eliminado vai para o finalista A');

  const msgG = {
    type: 'turno2', finalistas: [0, 1], iNulo, iAbst, matriz: {},
    porGrupo: { dim: 'religiao', linhas: { 1: {} } },
  };
  msgG.matriz[iOutros] = [0.5, 0.5, 0, 0];
  msgG.porGrupo.linhas[1][iOutros] = [0, 1, 0, 0];
  await enviar(msgG);
  const dif = ultimo('turno2').agregado;
  ok(dif.brasil.votos[1] > uni.brasil.votos[1], 'diferenciar por grupo desloca o resultado',
    `B ${(dif.brasil.votos[1] - uni.brasil.votos[1]).toLocaleString('pt-BR')} votos a mais`);

  await enviar({ type: 'shares', scope: { level: 'nacional' } });
  const pesoEv = ultimo('shares').shares.religiao[1];
  const desloc = (dif.brasil.votos[1] - uni.brasil.votos[1]) / (0.5 * b0.votos[iOutros]);
  ok(perto(desloc, pesoEv, 0.06), 'o deslocamento acompanha o peso do grupo',
    `${(100 * desloc).toFixed(1)}% vs peso ${(100 * pesoEv).toFixed(1)}%`);
}

console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
