/* Harness do MODO GOVERNADOR do motor, fora do browser.
 *
 * Carrega js/sim_ei_worker.js num contexto Node com `self` e `fetch` stubados e
 * exercita o caminho `loadGov`: pacote lateral por UF, faixa restrita a um
 * estado, hierarquia RGINT -> RGI -> municipio e volta ao presidencial.
 *
 * O teste central e o de FIDELIDADE: com a matriz "cada origem de 2022 vai
 * inteira para o herdeiro dela", o resultado tem de reproduzir a eleicao real de
 * 2022 daquele estado. Se o sidecar estiver desalinhado com locais_<UF>.bin, o
 * total continua batendo mas a geografia nao — e o teste municipal pega isso.
 *
 *     node scripts/testar_sim_gov_worker.mjs
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRES = path.join(RAIZ, 'resultados_geo', 'sim2026');
const GOV = path.join(RAIZ, 'resultados_geo', 'simgov2026');

let falhas = 0;
function ok(cond, nome, detalhe = '') {
  console.log(`${cond ? '  ok  ' : '  FALHA'} ${nome}${detalhe ? '  — ' + detalhe : ''}`);
  if (!cond) falhas++;
}
const perto = (a, b, tol) => Math.abs(a - b) <= tol;

// ------------------------------------------------------------- ambiente

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
new Function('self', 'fetch', fonte)(self, fetchLocal);

async function enviar(msg) {
  fila.length = 0;
  await self.onmessage({ data: msg });
  return fila;
}
const ultimo = (tipo) => [...fila].reverse().find((m) => m.type === tipo);

// ------------------------------------------------------------- pre-check

if (!existsSync(path.join(GOV, 'index.json'))) {
  console.error(`Nada em ${GOV}. Rode scripts/gerar_base_governador_2022.py antes.`);
  process.exit(2);
}
const IDXG = JSON.parse(await readFile(path.join(GOV, 'index.json'), 'utf-8'));
const REG = JSON.parse(await readFile(path.join(RAIZ, 'resultados_geo', 'regioes_ibge.json'), 'utf-8'));

const URL_PRES = new URL('resultados_geo/sim2026/', BASE_PAGINA).href;
const URL_GOV = new URL('resultados_geo/simgov2026/', BASE_PAGINA).href;

console.log(`Pacote de governador: ${Object.keys(IDXG.ufs).length} UFs, `
  + `${Object.values(IDXG.ufs).reduce((a, r) => a + r.locais, 0).toLocaleString('pt-BR')} locais\n`);

await enviar({ type: 'load', baseDir: URL_PRES });
if (!ultimo('loaded')) throw new Error('pacote presidencial nao carregou');

// --------------------------------------------------------- 1) carga do pacote

console.log('Carga do pacote de governador');
{
  await enviar({ type: 'loadGov', baseDir: URL_GOV, uf: 'ZZ' });
  const err = ultimo('error');
  ok(!!err && /ZZ/.test(err.erro), 'UF inexistente da erro legivel',
    err ? err.erro.slice(0, 60) : 'sem erro');

  await enviar({ type: 'loadGov', baseDir: URL_GOV, uf: 'RJ' });
  const g = ultimo('govLoaded');
  ok(!!g && g.uf === 'RJ', 'RJ carrega');
  ok(g && g.locais === IDXG.ufs.RJ.locais, 'contagem de locais bate com o indice',
    g ? `${g.locais}` : '-');
  ok(g && g.origens.length === IDXG.ufs.RJ.nOrigens, 'origens do estado chegam ao front',
    g ? g.origens.map((o) => o.key).join(', ') : '-');
}

// ------------------------------------------------------- 2) faixa restrita

const metaRJ = IDXG.ufs.RJ;
const NP = metaRJ.nOrigens;           // uma coluna por origem: matriz identidade
const KEYS = metaRJ.origens.map((o) => o.key);
const iNulo = KEYS.indexOf('nulo_branco');
const iAbst = KEYS.indexOf('abstencao');
const IDENT = KEYS.map((_, o) => KEYS.map((_, p) => (o === p ? 1 : 0)));

async function rodar(ops = [], escopo = { level: 'uf', uf: 'RJ' }) {
  await enviar({
    type: 'compute', parties: NP, transfer: IDENT, ops, redutos: [],
    iNulo, iAbst, activeScope: escopo,
  });
  const r = ultimo('result');
  if (!r) throw new Error('sem resultado: ' + JSON.stringify(ultimo('error')));
  return r;
}

console.log('\nFaixa restrita ao estado');
const base = await rodar();
{
  const a = base.agregado;
  ok(a.brasil.aptos === a.ufs.RJ.aptos, 'o topo do agregado vale o estado',
    `${a.brasil.aptos.toLocaleString('pt-BR')} aptos`);
  ok(!a.ufs.SP && !a.ufs.MG, 'nenhuma outra UF entra no agregado',
    `${Object.keys(a.ufs).length} UF(s)`);
  const munsForaRJ = Object.keys(a.municipios).filter((c) => !c.startsWith('33'));
  ok(munsForaRJ.length === 0, 'nenhum municipio fora do RJ',
    `${Object.keys(a.municipios).length} municipios`);
  const soma = a.brasil.votos.reduce((s, v) => s + v, 0);
  ok(perto(soma, a.brasil.aptos, 2), 'o eleitorado apto se conserva',
    `${Math.round(soma).toLocaleString('pt-BR')}`);
}

// ------------------------------------------------------- 3) fidelidade 2022

console.log('\nFidelidade ao resultado real de 2022 (migracao identidade)');
{
  const a = base.agregado;
  const nValidos = NP - 2;
  const totalValidos = a.brasil.votos.slice(0, nValidos).reduce((s, v) => s + v, 0);
  for (let p = 0; p < nValidos; p++) {
    const obtido = 100 * a.brasil.votos[p] / totalValidos;
    const esperado = metaRJ.origens[p].pctValidos;
    ok(perto(obtido, esperado, 0.35), `${KEYS[p]} reproduz 2022`,
      `${obtido.toFixed(2)}% vs ${esperado.toFixed(2)}% oficial`);
  }
  const abst = 100 * a.brasil.votos[iAbst] / a.brasil.aptos;
  ok(perto(abst, metaRJ.origens[iAbst].pctAptos, 0.35), 'abstencao reproduz 2022',
    `${abst.toFixed(2)}% vs ${metaRJ.origens[iAbst].pctAptos.toFixed(2)}%`);
}

/* A geografia e o que denuncia desalinhamento: se as linhas do sidecar
   estivessem trocadas entre si, o total do estado continuaria correto e so a
   distribuicao municipal ficaria errada. */
console.log('\nGeografia municipal (o teste que pega desalinhamento)');
{
  const regRJ = JSON.parse(await readFile(path.join(GOV, 'regioes_RJ.json'), 'utf-8'));
  const nValidos = NP - 2;
  const munisDe = (nivel, cod) => Object.keys(REG.muni_to_region)
    .filter((ib) => String(REG.muni_to_region[ib][nivel === 'ri' ? 'ri' : 'rgi']) === String(cod));

  let pior = 0, ondePior = '';
  for (const chave of Object.keys(regRJ.regioes)) {
    if (!chave.startsWith('ri:')) continue;
    const cod = chave.slice(3);
    const alvo = regRJ.regioes[chave].pct_validos;
    const ibges = new Set(munisDe('ri', cod).map(Number));
    const votos = new Array(NP).fill(0);
    for (const [cm, m] of Object.entries(base.agregado.municipios)) {
      if (!ibges.has(Number(cm))) continue;
      for (let p = 0; p < NP; p++) votos[p] += m.votos[p];
    }
    const val = votos.slice(0, nValidos).reduce((s, v) => s + v, 0);
    for (let p = 0; p < nValidos; p++) {
      const d = Math.abs(100 * votos[p] / val - alvo[KEYS[p]]);
      if (d > pior) { pior = d; ondePior = `${chave}/${KEYS[p]}`; }
    }
  }
  ok(pior < 1.0, 'cada RGINT reproduz a sua propria votacao de 2022',
    `pior desvio ${pior.toFixed(2)} p.p. em ${ondePior}`);
}

// --------------------------------------------------- 4) hierarquia RGINT/RGI

console.log('\nHierarquia RG intermediaria -> RG imediata');
{
  const regRJ = JSON.parse(await readFile(path.join(GOV, 'regioes_RJ.json'), 'utf-8'));
  const codRi = Object.keys(regRJ.regioes).find((k) => k.startsWith('ri:')).slice(3);
  const codRgi = Object.keys(regRJ.regioes)
    .filter((k) => k.startsWith('rgi:'))
    .find((k) => regRJ.regioes[k].rgint === codRi).slice(4);

  const ibgesRi = Object.keys(REG.muni_to_region)
    .filter((ib) => String(REG.muni_to_region[ib].ri) === codRi).map(Number);
  const ibgesRgi = Object.keys(REG.muni_to_region)
    .filter((ib) => String(REG.muni_to_region[ib].rgi) === codRgi).map(Number);
  const foraRgi = ibgesRi.filter((ib) => !ibgesRgi.includes(ib));

  ok(ibgesRgi.length > 0 && foraRgi.length > 0,
    'ha uma RGI dentro da RGINT e municipios fora dela',
    `RGINT ${codRi}: ${ibgesRi.length} munis, RGI ${codRgi}: ${ibgesRgi.length}`);

  /* Metas realistas de proposito. O IPF e multiplicativo, entao uma meta de 0%
     numa etapa zera a coluna e nenhuma etapa seguinte consegue recupera-la
     (o motor cai no rateio uniforme). Vale igual no caminho presidencial
     macrorregiao -> RGINT, e a interface nunca produz isso: os valores da etapa
     de refinamento sao semeados a partir da simulacao corrente, nunca zerados. */
  const alvoRi = new Array(NP).fill(null);
  const alvoRgi = new Array(NP).fill(null);
  const resto = 0.10 / Math.max(1, NP - 4);
  for (let p = 2; p < NP - 2; p++) { alvoRi[p] = resto; alvoRgi[p] = resto; }
  alvoRi[0] = 0.70; alvoRi[1] = 0.20;    // RGINT: 70/20 entre os dois primeiros
  alvoRgi[0] = 0.25; alvoRgi[1] = 0.65;  // RGI: inverte para 25/65

  const opRi = { scope: { level: 'regiao', nivel: 'ri', regiao: codRi, ibges: ibgesRi }, validos: alvoRi };
  const opRgi = { scope: { level: 'regiao', nivel: 'rgi', regiao: codRgi, ibges: ibgesRgi }, validos: alvoRgi };
  const soRi = await rodar([opRi]);
  const ambas = await rodar([opRi, opRgi]);

  const pctEm = (res, ibges, p) => {
    const somar = (q) => ibges.reduce(
      (s, ib) => s + ((res.agregado.municipios[ib] || { votos: [] }).votos[q] || 0), 0);
    let val = 0;
    for (let q = 0; q < NP - 2; q++) val += somar(q);
    return val > 0 ? 100 * somar(p) / val : 0;
  };

  ok(perto(pctEm(soRi, ibgesRi, 1), 20, 0.3), 'a meta da RGINT vale no agregado dela',
    `${KEYS[1]} = ${pctEm(soRi, ibgesRi, 1).toFixed(2)}% na RGINT (alvo 20%)`);
  ok(perto(pctEm(ambas, ibgesRgi, 1), 65, 0.5), 'a RGI vence a RGINT que a contem',
    `${KEYS[1]} = ${pctEm(ambas, ibgesRgi, 1).toFixed(2)}% dentro da RGI (alvo 65%)`);
  /* A meta da RGINT e um agregado: dentro dela a geografia relativa e
     preservada, entao um pedaco isolado nao vale 20% exatos. O que a
     precedencia exige e que a op da RGI nao encoste em quem esta fora dela. */
  ok(perto(pctEm(ambas, foraRgi, 1), pctEm(soRi, foraRgi, 1), 0.01),
    'a op da RGI nao mexe nos municipios fora dela',
    `${pctEm(ambas, foraRgi, 1).toFixed(2)}% com a RGI vs `
    + `${pctEm(soRi, foraRgi, 1).toFixed(2)}% sem ela`);
}

// ---------------------------------------------------------- 5) determinismo

console.log('\nDeterminismo e escopo');
{
  const a = await rodar();
  const b = await rodar();
  ok(a.agregado.brasil.votos.every((v, i) => v === b.agregado.brasil.votos[i]),
    'dois calculos identicos dao o mesmo resultado');

  const r = await rodar([], { level: 'uf', uf: 'SP' });
  ok(r.agregado.brasil.aptos === a.agregado.brasil.aptos,
    'pedir escopo de outra UF nao muda a simulacao do estado');
}

// ------------------------------------------------------ 6) volta ao presidencial

console.log('\nVolta ao modo presidencial');
{
  const IDXP = JSON.parse(await readFile(path.join(PRES, 'index.json'), 'utf-8'));
  await enviar({ type: 'loadGov', baseDir: URL_GOV, uf: null });
  ok(!!ultimo('govLoaded'), 'loadGov(null) descarrega o pacote');

  const nOrig = IDXP.dimensions.find((d) => d.key === 'voto2022').buckets.length;
  const ident = Array.from({ length: nOrig }, (_, o) =>
    Array.from({ length: nOrig }, (_, p) => (o === p ? 1 : 0)));
  await enviar({
    type: 'compute', parties: nOrig, transfer: ident, ops: [], redutos: [],
    iNulo: nOrig - 2, iAbst: nOrig - 1, activeScope: { level: 'nacional' },
  });
  const r = ultimo('result');
  const totalPres = Object.values(IDXP.ufs).reduce((a, b) => a + b, 0);
  ok(!!r && Object.keys(r.agregado.ufs).length === Object.keys(IDXP.ufs).length,
    'o agregado volta a cobrir as 27 UFs',
    r ? `${Object.keys(r.agregado.ufs).length} UFs` : '-');
  ok(!!r && r.agregado.brasil.aptos > 150e6,
    'o eleitorado volta a ser o nacional',
    r ? `${r.agregado.brasil.aptos.toLocaleString('pt-BR')} de ${totalPres} locais` : '-');
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo ok');
process.exit(falhas ? 1 : 0);
