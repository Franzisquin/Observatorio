/* ============================================================================
   SIMULADOR 2026 — motor de inferencia ecologica (Web Worker)

   Portado de "EUA Proporcional/editor_worker.js", com tres adaptacoes ao caso
   brasileiro:

   1. INVARIANTE. No editor americano o total de VOTOS de cada unidade e fixo e
      so o rateio entre partidos se move. Aqui o invariante e o ELEITORADO APTO
      de 2026, e abstencao / nulo-branco sao colunas do vetor como qualquer
      candidato. Com isso toda a algebra (IPF, realocacao aditiva, Hamilton)
      vale sem mudanca — e o comparecimento por grupo demografico passa a ser
      editavel, coisa que o editor original nao faz.

   2. BASE. Nao existe "voto de 2026" gravado em disco. A superficie inicial e
      construida aqui aplicando a matriz de transferencia sobre a composicao de
      2022 de cada local:
          base[i][p] = aptos[i] * SOMA_origem frac2022[i][origem] * transf[origem][p]
      E assim que a migracao de 2022 entra como pilar: ela e o prior, e as
      edicoes demograficas sao perturbacoes aditivas sobre ele.

   3. REGULARIZACAO. A regressao ecologica e mal condicionada (a composicao dos
      locais e muito colinear). Sem encolhimento ela devolve solucoes de canto
      0%/100%, que sao ruido, nao achado. Aplicamos ridge para a media do
      escopo — o mesmo que scripts/gerar_ei_baselines_2026.py faz offline.

   O replay e sempre feito do zero a partir da base pristina, entao a ordem das
   operacoes e deterministica e as edicoes nunca acumulam desvio.
   ========================================================================== */

'use strict';

// ---------------------------------------------------------------- estado

let IDX = null;              // index.json
let NB = 0;                  // total de buckets
let NP = 0;                  // colunas do vetor de voto (candidatos + outros + nulo + abst)
let N = 0;                   // total de locais

let aptosArr = null;         // Float64Array(N)
let fracs = null;            // Uint8Array(N * NB), quantizado 0..QUANT
let codIbge = null;          // Int32Array(N)
let cdMunicipio = null;      // Int32Array(N)
let nrZona = null;           // Int32Array(N)
let nrLocvot = null;         // Int32Array(N)
let flags = null;            // Uint8Array(N) — bit 0: local imputado
let ufDeIdx = null;          // Array(N) de siglas
let fatiaUf = {};            // UF -> [inicio, quantidade]
let dimensoes = [];          // [{key, base, offset, n}]
let idxVoto2022 = null;      // {offset, n}
let QUANT = 255;

let carregado = false;
let ultimoCur = null;        // ultima superficie calculada (p/ pedidos leves)
let ultimoCur2T = null;      // idem, ja transferida para o 2o turno
let ultimoNP = 0;

// ---------------------------------------------------------------- utils

function post(msg) { self.postMessage(msg); }

function progresso(v, rotulo) { post({ type: 'progress', value: v, label: rotulo }); }

/* Arredondamento de maior-resto (Hamilton): garante que a soma inteira das
   colunas seja exatamente `total`, sem perder nem criar eleitor. */
function hamilton(valores, total, saida, np) {
  let piso = 0;
  const resto = [];
  for (let p = 0; p < np; p++) {
    const f = Math.floor(valores[p]);
    saida[p] = f;
    piso += f;
    resto.push([valores[p] - f, p]);
  }
  let sobra = total - piso;
  if (sobra > 0) {
    resto.sort((a, b) => b[0] - a[0]);
    for (let i = 0; i < sobra && i < np; i++) saida[resto[i][1]]++;
  } else if (sobra < 0) {
    resto.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < -sobra && i < np; i++) saida[resto[i][1]] = Math.max(0, saida[resto[i][1]] - 1);
  }
}

// ---------------------------------------------------------------- carga

async function carregar(baseDir) {
  IDX = await (await fetch(baseDir + 'index.json')).json();
  NB = IDX.nBuckets;
  QUANT = IDX.quant || 255;

  let pos = 0;
  dimensoes = IDX.dimensions.map(d => {
    const info = {
      key: d.key, label: d.label, base: d.base,
      ordinal: !!d.ordinal, offset: pos, n: d.buckets.length
    };
    pos += d.buckets.length;
    return info;
  });
  idxVoto2022 = dimensoes.find(d => d.key === 'voto2022') || null;

  const ufs = Object.keys(IDX.ufs);
  N = ufs.reduce((s, uf) => s + IDX.ufs[uf], 0);

  aptosArr = new Float64Array(N);
  fracs = new Uint8Array(N * NB);
  codIbge = new Int32Array(N);
  cdMunicipio = new Int32Array(N);
  nrZona = new Int32Array(N);
  nrLocvot = new Int32Array(N);
  flags = new Uint8Array(N);
  ufDeIdx = new Array(N);

  const RB = IDX.recordBytes, HB = IDX.headerBytes;
  let i = 0;
  for (let u = 0; u < ufs.length; u++) {
    const uf = ufs[u];
    const buf = await (await fetch(baseDir + `locais_${uf}.bin`)).arrayBuffer();
    const dv = new DataView(buf);
    const bytes = new Uint8Array(buf);
    const qtd = IDX.ufs[uf];
    fatiaUf[uf] = [i, qtd];
    for (let r = 0; r < qtd; r++, i++) {
      const o = r * RB;
      cdMunicipio[i] = dv.getUint32(o, true);
      codIbge[i] = dv.getUint32(o + 4, true);
      nrZona[i] = dv.getUint16(o + 8, true);
      nrLocvot[i] = dv.getUint16(o + 10, true);
      aptosArr[i] = dv.getUint32(o + 12, true);
      flags[i] = bytes[o + 16];
      ufDeIdx[i] = uf;
      fracs.set(bytes.subarray(o + HB, o + HB + NB), i * NB);
    }
    progresso(0.05 + 0.9 * (u + 1) / ufs.length, `Carregando ${uf}`);
  }
  carregado = true;
  post({
    type: 'loaded', locais: N, nBuckets: NB,
    ufs: Object.fromEntries(Object.entries(fatiaUf).map(([k, v]) => [k, v[1]])),
    aptos: aptosArr.reduce((s, v) => s + v, 0),
    imputados: flags.reduce((s, v) => s + (v & 1), 0),
  });
}

// ------------------------------------------------------------ escopo

/* Indices afetados por um escopo. 'nacional' devolve null como atalho para
   "todos" — evita materializar um array de 80 mil posicoes no caminho quente. */
function afetados(escopo) {
  if (!escopo || escopo.level === 'nacional') return null;
  const fora = [];
  if (escopo.level === 'uf') {
    const fatia = fatiaUf[escopo.uf];
    if (!fatia) return fora;
    for (let i = fatia[0]; i < fatia[0] + fatia[1]; i++) fora.push(i);
    return fora;
  }
  // 'regiao' e 'municipio' selecionam por codigo IBGE; separa-los so serve para
  // a ordem do replay (regiao antes de municipio, ver `calcular`), de modo que
  // um ajuste municipal sempre vença o da regiao que o contem.
  if (escopo.level === 'municipio' || escopo.level === 'regiao') {
    const alvo = new Set((escopo.ibges || [escopo.ibge]).map(Number));
    const fatia = escopo.uf ? fatiaUf[escopo.uf] : null;
    const ini = fatia ? fatia[0] : 0;
    const fim = fatia ? fatia[0] + fatia[1] : N;
    for (let i = ini; i < fim; i++) if (alvo.has(codIbge[i])) fora.push(i);
    return fora;
  }
  return fora;
}

function iterar(idx, fn) {
  if (idx === null) { for (let i = 0; i < N; i++) fn(i); }
  else { for (let a = 0; a < idx.length; a++) fn(idx[a]); }
}

function tamanho(idx) { return idx === null ? N : idx.length; }

// ------------------------------------------------- base a partir de 2022

/* base[i][p] = aptos[i] * SOMA_origem frac2022[i][origem] * transf[origem][p]

   `transf` e (nOrigens x NP). As linhas devem somar 1; normalizamos por
   seguranca para que o total do local seja exatamente os aptos. */
function montarBase(transf, np) {
  const cur = new Float64Array(N * np);
  if (!idxVoto2022) return cur;
  const nOrig = idxVoto2022.n, off = idxVoto2022.offset;

  const T = new Float64Array(nOrig * np);
  for (let o = 0; o < nOrig; o++) {
    let s = 0;
    for (let p = 0; p < np; p++) s += Math.max(0, transf[o] ? (transf[o][p] || 0) : 0);
    for (let p = 0; p < np; p++) {
      T[o * np + p] = s > 0 ? Math.max(0, transf[o][p] || 0) / s : (p === np - 1 ? 1 : 0);
    }
  }

  const fv = new Float64Array(np);
  const saida = new Int32Array(np);
  for (let i = 0; i < N; i++) {
    const tot = aptosArr[i], fb = i * NB;
    fv.fill(0);
    for (let o = 0; o < nOrig; o++) {
      const peso = fracs[fb + off + o] / QUANT;
      if (!peso) continue;
      const eleitores = tot * peso;
      for (let p = 0; p < np; p++) fv[p] += eleitores * T[o * np + p];
    }
    hamilton(fv, Math.round(tot), saida, np);
    for (let p = 0; p < np; p++) cur[i * np + p] = saida[p];
  }
  return cur;
}

// -------------------------------------------- regressao ecologica (NNLS)

/* Gauss-Jordan com pivoteamento parcial no subsistema ativo G_PP s_P = c_P. */
function resolverSub(G, c, P, n, s) {
  const idx = [];
  for (let i = 0; i < n; i++) if (P[i]) idx.push(i);
  const m = idx.length;
  s.fill(0);
  if (!m) return;
  const M = new Float64Array(m * (m + 1));
  for (let a = 0; a < m; a++) {
    for (let b = 0; b < m; b++) M[a * (m + 1) + b] = G[idx[a] * n + idx[b]];
    M[a * (m + 1) + m] = c[idx[a]];
  }
  for (let col = 0; col < m; col++) {
    let piv = col, melhor = Math.abs(M[col * (m + 1) + col]);
    for (let r = col + 1; r < m; r++) {
      const v = Math.abs(M[r * (m + 1) + col]);
      if (v > melhor) { melhor = v; piv = r; }
    }
    if (melhor < 1e-12) continue;
    if (piv !== col) {
      for (let b = 0; b <= m; b++) {
        const t = M[col * (m + 1) + b];
        M[col * (m + 1) + b] = M[piv * (m + 1) + b];
        M[piv * (m + 1) + b] = t;
      }
    }
    const d = M[col * (m + 1) + col];
    for (let b = col; b <= m; b++) M[col * (m + 1) + b] /= d;
    for (let r = 0; r < m; r++) {
      if (r === col) continue;
      const f = M[r * (m + 1) + col];
      if (!f) continue;
      for (let b = col; b <= m; b++) M[r * (m + 1) + b] -= f * M[col * (m + 1) + b];
    }
  }
  for (let a = 0; a < m; a++) s[idx[a]] = M[a * (m + 1) + m];
}

/* NNLS de Lawson-Hanson sobre as equacoes normais: min ||Ax-b||, x >= 0,
   dados G = A'A e c = A'b. */
function nnlsNormal(G, c, n) {
  const x = new Float64Array(n);
  const P = new Array(n).fill(false);
  const s = new Float64Array(n);
  const tol = 1e-10;
  for (let fora = 0; fora < 3 * n + 10; fora++) {
    let jmax = -1, wmax = tol;
    for (let i = 0; i < n; i++) {
      if (P[i]) continue;
      let gi = 0;
      for (let k = 0; k < n; k++) gi += G[i * n + k] * x[k];
      const wi = c[i] - gi;
      if (wi > wmax) { wmax = wi; jmax = i; }
    }
    if (jmax < 0) break;
    P[jmax] = true;
    for (let dentro = 0; dentro < 3 * n + 10; dentro++) {
      resolverSub(G, c, P, n, s);
      let minS = Infinity;
      for (let i = 0; i < n; i++) if (P[i] && s[i] < minS) minS = s[i];
      if (minS > tol) {
        for (let i = 0; i < n; i++) x[i] = P[i] ? s[i] : 0;
        break;
      }
      let alpha = Infinity;
      for (let i = 0; i < n; i++) {
        if (P[i] && s[i] <= tol) {
          const den = x[i] - s[i];
          if (den > tol) { const a = x[i] / den; if (a < alpha) alpha = a; }
        }
      }
      if (!isFinite(alpha)) alpha = 0;
      for (let i = 0; i < n; i++) x[i] = x[i] + alpha * ((P[i] ? s[i] : 0) - x[i]);
      for (let i = 0; i < n; i++) if (P[i] && x[i] <= tol) { P[i] = false; x[i] = 0; }
    }
  }
  return x;
}

// Devem casar com scripts/gerar_ei_baselines_2026.py — se mudar aqui, mude la.
const ALFA_RIDGE = 0.15;   // encolhimento para a media do escopo
const ALFA_SUAVE = 0.60;   // primeira diferenca, so em dimensoes ordinais

/* Apoio de cada bucket, por dimensao, via regressao ecologica ponderada.

   Modelo:  participacao_ip ~= SOMA_k frac_ik * apoio_kp,  apoio >= 0

   Monta as equacoes normais numa unica passada pelos locais — G e c ficam
   nb x nb e nb x np, entao o NNLS roda num sistema minusculo mesmo com 80 mil
   locais. O peso e o eleitorado (a variancia de uma proporcao cai com o n),
   o que corresponde a  G[k][l] += frac_k*frac_l*aptos  e  c[k][p] += frac_k*votos_p.

   `alvoDims` (opcional) restringe o calculo as dimensoes que contem algum dos
   buckets pedidos — e o caminho quente durante a edicao. */
function apoioDemografico(idx, cur, np, alvoDims) {
  const n = tamanho(idx);
  if (!n) return null;
  const fora = {};

  // Media do escopo: alvo do encolhimento ridge.
  const media = new Float64Array(np);
  let totalAptos = 0;
  iterar(idx, i => {
    totalAptos += aptosArr[i];
    for (let p = 0; p < np; p++) media[p] += cur[i * np + p];
  });
  if (totalAptos > 0) for (let p = 0; p < np; p++) media[p] /= totalAptos;

  for (const dim of dimensoes) {
    if (dim.key === 'voto2022') continue;              // e a propria resposta
    if (alvoDims && !alvoDims.has(dim.key)) continue;
    const nb = dim.n, off = dim.offset;
    const G = new Float64Array(nb * nb);
    const c = new Float64Array(nb * np);
    const fa = new Float64Array(nb);

    iterar(idx, i => {
      const fb = i * NB, vb = i * np, tot = aptosArr[i];
      if (tot <= 0) return;
      let algum = false;
      for (let k = 0; k < nb; k++) {
        const f = fracs[fb + off + k] / QUANT;
        fa[k] = f;
        if (f) algum = true;
      }
      if (!algum) return;
      for (let k = 0; k < nb; k++) {
        const fk = fa[k];
        if (!fk) continue;
        const gk = k * nb, ck = k * np;
        for (let l = 0; l < nb; l++) G[gk + l] += fk * fa[l] * tot;
        for (let p = 0; p < np; p++) c[ck + p] += fk * cur[vb + p];
      }
    });

    // Regularizacao, direto nas equacoes normais.
    //
    // Ridge, sempre:      (A'A + lamR I) x = A'b + lamR * media
    // Suavidade, ordinais: soma lamS * D'D, com D a primeira diferenca entre
    //   buckets vizinhos. D'D e tridiagonal: 2 na diagonal (1 nas pontas) e -1
    //   fora. O alvo e diferenca zero, entao `c` nao muda. Sem isso o ajuste
    //   zigueizagueia entre categorias adjacentes, que sao quase colineares.
    let traco = 0;
    for (let k = 0; k < nb; k++) traco += G[k * nb + k];
    const escala = traco / Math.max(nb, 1);
    const lamR = ALFA_RIDGE * escala;
    for (let k = 0; k < nb; k++) {
      G[k * nb + k] += lamR;
      for (let p = 0; p < np; p++) c[k * np + p] += lamR * media[p];
    }
    if (dim.ordinal && nb > 2) {
      const lamS = ALFA_SUAVE * escala;
      for (let k = 0; k < nb; k++) {
        const vizinhos = (k === 0 || k === nb - 1) ? 1 : 2;
        G[k * nb + k] += lamS * vizinhos;
        if (k + 1 < nb) {
          G[k * nb + (k + 1)] -= lamS;
          G[(k + 1) * nb + k] -= lamS;
        }
      }
    }

    const cp = new Float64Array(nb);
    const sup = [];
    for (let k = 0; k < nb; k++) sup.push(new Float64Array(np));
    for (let p = 0; p < np; p++) {
      for (let k = 0; k < nb; k++) cp[k] = c[k * np + p];
      const x = nnlsNormal(G, cp, nb);
      for (let k = 0; k < nb; k++) sup[k][p] = x[k];
    }
    // Normaliza por bucket: o apoio soma 1 entre as colunas.
    const linhas = [];
    for (let k = 0; k < nb; k++) {
      let s = 0;
      for (let p = 0; p < np; p++) s += sup[k][p];
      const arr = new Array(np);
      for (let p = 0; p < np; p++) arr[p] = s > 0 ? sup[k][p] / s : 0;
      linhas.push(arr);
    }
    fora[dim.key] = linhas;
  }
  return fora;
}

// ---------------------------------------------------- aplicacao de uma op

/* Ordem importa: o CONTROLE GERAL (IPF) entra primeiro, definindo o ponto de
   partida do escopo; as edicoes demograficas entram por cima. Se o geral
   viesse por ultimo ele reimporia o agregado exato e anularia o efeito dos
   sliders demograficos.

   As edicoes demograficas sao uma REALOCACAO ADITIVA CALIBRADA:
       voto_p += aptos * frac_bucket * (alvo_p - apoioObservado_bucket_p)
   ancorada no apoio OBSERVADO (reestimado agora, pos-geral), nao num baseline
   estatico. A versao multiplicativa (alvo/base) explodia grupos concentrados e
   roubava votos das outras dimensoes. */
function aplicarOp(cur, op, np) {
  const idx = afetados(op.scope);
  if (idx !== null && !idx.length) return;

  const demo = [];
  if (op.demo) {
    for (const chave in op.demo) {
      const [dk, bi] = chave.split('|');
      const dim = dimensoes.find(d => d.key === dk);
      if (!dim) continue;
      const b = parseInt(bi, 10);
      if (!(b >= 0 && b < dim.n)) continue;
      demo.push({ g: dim.offset + b, dim: dk, alvos: op.demo[chave] });
    }
  }
  const geral = op.general || null;

  const fv = new Float64Array(np);
  const saida = new Int32Array(np);

  // --- 1) controle geral: IPF biproporcional ate bater o agregado do escopo
  const K = new Float64Array(np).fill(1);
  if (geral) {
    let totalUnidade = 0;
    iterar(idx, i => { totalUnidade += aptosArr[i]; });
    for (let iter = 0; iter < 40; iter++) {
      const agg = new Float64Array(np);
      iterar(idx, i => {
        let s = 0;
        for (let p = 0; p < np; p++) { fv[p] = cur[i * np + p] * K[p]; s += fv[p]; }
        const inv = s > 0 ? aptosArr[i] / s : 0;   // escala de linha: aptos fixos
        for (let p = 0; p < np; p++) agg[p] += fv[p] * inv;
      });
      let erro = 0;
      for (let p = 0; p < np; p++) {
        if (geral[p] == null) continue;
        const quer = geral[p] * totalUnidade;
        if (agg[p] > 1e-9) {
          const r = quer / agg[p];
          K[p] *= r;
          erro = Math.max(erro, Math.abs(r - 1));
        }
      }
      if (erro < 1e-4) break;
    }
    iterar(idx, i => {
      let s = 0;
      for (let p = 0; p < np; p++) { fv[p] = cur[i * np + p] * K[p]; s += fv[p]; }
      const inv = s > 0 ? aptosArr[i] / s : 0;
      for (let p = 0; p < np; p++) cur[i * np + p] = fv[p] * inv;
    });
  }

  // --- 2) edicoes demograficas sobre o resultado do geral
  if (demo.length) {
    const dims = new Set(demo.map(e => e.dim));
    const apoio = apoioDemografico(idx, cur, np, dims);
    // Resolve o apoio de cada bucket editado UMA vez, fora do laco por local.
    const edicoes = demo.map(e => {
      const dim = dimensoes.find(d => d.key === e.dim);
      const base = (apoio && apoio[e.dim] && dim) ? apoio[e.dim][e.g - dim.offset] : null;
      return base ? { g: e.g, alvos: e.alvos, base } : null;
    }).filter(Boolean);

    iterar(idx, i => {
      const fb = i * NB, vb = i * np, tot = aptosArr[i];
      for (let p = 0; p < np; p++) fv[p] = cur[vb + p];
      for (let e = 0; e < edicoes.length; e++) {
        const frac = fracs[fb + edicoes[e].g] / QUANT;
        if (!frac) continue;
        const base = edicoes[e].base, alvo = edicoes[e].alvos;
        for (let p = 0; p < np; p++) {
          if (alvo[p] == null) continue;
          fv[p] += tot * frac * (alvo[p] - base[p]);
        }
      }
      let s = 0;
      for (let p = 0; p < np; p++) { if (fv[p] < 0) fv[p] = 0; s += fv[p]; }
      const inv = s > 0 ? tot / s : 0;
      for (let p = 0; p < np; p++) fv[p] *= inv;
      hamilton(fv, Math.round(tot), saida, np);
      for (let p = 0; p < np; p++) cur[vb + p] = saida[p];
    });
  } else if (geral) {
    iterar(idx, i => {
      const vb = i * np, tot = aptosArr[i];
      for (let p = 0; p < np; p++) fv[p] = cur[vb + p];
      hamilton(fv, Math.round(tot), saida, np);
      for (let p = 0; p < np; p++) cur[vb + p] = saida[p];
    });
  }
}

// ------------------------------------------------------------ agregacao

function agregar(cur, np, detalheUfs) {
  const brasil = new Float64Array(np);
  const porUf = {};
  const porMuni = {};
  let aptosBR = 0;

  for (const uf in fatiaUf) porUf[uf] = { aptos: 0, votos: new Float64Array(np) };

  for (let i = 0; i < N; i++) {
    const uf = ufDeIdx[i], vb = i * np, tot = aptosArr[i];
    aptosBR += tot;
    const u = porUf[uf];
    u.aptos += tot;
    const cod = codIbge[i];
    let m = porMuni[cod];
    if (!m) { m = porMuni[cod] = { uf, aptos: 0, votos: new Float64Array(np) }; }
    m.aptos += tot;
    for (let p = 0; p < np; p++) {
      const v = cur[vb + p];
      brasil[p] += v;
      u.votos[p] += v;
      m.votos[p] += v;
    }
  }

  const paraArr = o => ({ aptos: o.aptos, votos: Array.from(o.votos) });
  const saida = {
    brasil: { aptos: aptosBR, votos: Array.from(brasil) },
    ufs: Object.fromEntries(Object.entries(porUf).map(([k, v]) => [k, paraArr(v)])),
    municipios: Object.fromEntries(Object.entries(porMuni).map(([k, v]) => [k, paraArr(v)])),
  };

  // Detalhe por local so das UFs abertas no mapa — o payload do postMessage
  // com os 80 mil locais nao compensa quando so um estado esta visivel.
  if (detalheUfs && detalheUfs.length) {
    const detalhe = {};
    for (const uf of detalheUfs) {
      const fatia = fatiaUf[uf];
      if (!fatia) continue;
      const [ini, qtd] = fatia;
      detalhe[uf] = Array.from(cur.subarray(ini * np, (ini + qtd) * np));
    }
    saida.locais = detalhe;
  }
  return saida;
}

// ------------------------------------------------------------ segundo turno

/* Redistribui a superficie do 1o turno entre os dois finalistas, local a local.

   Aplicar a matriz sobre o agregado nacional daria o mesmo total so quando a
   transferencia e uniforme. Fazendo local a local, e possivel diferenciar por
   GRUPO DEMOGRAFICO: cada linha da matriz pode ter uma versao por bucket de uma
   dimensao (ex.: o evangelico que votou no candidato X vai mais para o
   finalista Y do que o eleitor sem religiao que votou no mesmo X). A linha
   efetiva de cada local e a media das linhas dos buckets, ponderada pela
   composicao daquele local — que e exatamente o que a inferencia ecologica
   estimou.

   msg: { finalistas:[iA,iB], iNulo, iAbst,
          matriz:   { [coluna]: [fA,fB,fNulo,fAbst] },        // global, fracoes
          porGrupo: { dim, linhas: { [bucket]: { [coluna]: [...] } } } | null } */
function turno2(msg) {
  if (!ultimoCur || !ultimoNP) return null;
  const np = ultimoNP;
  const [iA, iB] = msg.finalistas;
  const iNulo = msg.iNulo, iAbst = msg.iAbst;

  const norm = (l) => {
    const s = (l[0] || 0) + (l[1] || 0) + (l[2] || 0) + (l[3] || 0);
    return s > 0 ? [l[0] / s, l[1] / s, l[2] / s, l[3] / s] : [0, 0, 0, 1];
  };
  const global = {};
  for (const p in msg.matriz) global[p] = norm(msg.matriz[p]);

  const dim = msg.porGrupo ? dimensoes.find(d => d.key === msg.porGrupo.dim) : null;
  const porBucket = {};   // coluna -> Array(nb) de linhas
  if (dim && msg.porGrupo.linhas) {
    for (const bi in msg.porGrupo.linhas) {
      for (const p in msg.porGrupo.linhas[bi]) {
        if (!porBucket[p]) porBucket[p] = new Array(dim.n).fill(null);
        porBucket[p][bi] = norm(msg.porGrupo.linhas[bi][p]);
      }
    }
  }

  const brasil = new Float64Array(np);
  const porUf = {}, porMuni = {};
  for (const uf in fatiaUf) porUf[uf] = { aptos: 0, votos: new Float64Array(np) };

  const saida = new Float64Array(np);
  const linha = new Float64Array(4);
  let aptosBR = 0;
  // Guarda a superficie do 2o turno por local, para o mapa de locais poder
  // mostrar o 2o turno com a mesma transferencia diferenciada por grupo.
  ultimoCur2T = new Float64Array(N * np);

  for (let i = 0; i < N; i++) {
    const vb = i * np, fb = i * NB, tot = aptosArr[i];
    saida.fill(0);
    saida[iA] = ultimoCur[vb + iA];
    saida[iB] = ultimoCur[vb + iB];

    for (let p = 0; p < np; p++) {
      if (p === iA || p === iB) continue;
      const v = ultimoCur[vb + p];
      if (!v) continue;

      const g = global[p];
      const bl = porBucket[p];
      if (bl && dim) {
        // Media das linhas dos buckets ponderada pela composicao do local.
        linha.fill(0);
        let peso = 0;
        for (let k = 0; k < dim.n; k++) {
          const f = fracs[fb + dim.offset + k] / QUANT;
          if (!f) continue;
          const alvo = bl[k] || g;
          if (!alvo) continue;
          for (let d = 0; d < 4; d++) linha[d] += f * alvo[d];
          peso += f;
        }
        if (peso > 0) {
          saida[iA] += v * linha[0] / peso;
          saida[iB] += v * linha[1] / peso;
          saida[iNulo] += v * linha[2] / peso;
          saida[iAbst] += v * linha[3] / peso;
          continue;
        }
      }
      if (!g) { saida[iAbst] += v; continue; }
      saida[iA] += v * g[0];
      saida[iB] += v * g[1];
      saida[iNulo] += v * g[2];
      saida[iAbst] += v * g[3];
    }

    const uf = ufDeIdx[i], cod = codIbge[i];
    const u = porUf[uf];
    u.aptos += tot;
    aptosBR += tot;
    let m = porMuni[cod];
    if (!m) m = porMuni[cod] = { uf, aptos: 0, votos: new Float64Array(np) };
    m.aptos += tot;
    for (let p = 0; p < np; p++) {
      brasil[p] += saida[p];
      u.votos[p] += saida[p];
      m.votos[p] += saida[p];
      ultimoCur2T[vb + p] = saida[p];
    }
  }

  const arr = o => ({ aptos: o.aptos, votos: Array.from(o.votos, v => Math.round(v)) });
  return {
    brasil: { aptos: aptosBR, votos: Array.from(brasil, v => Math.round(v)) },
    ufs: Object.fromEntries(Object.entries(porUf).map(([k, v]) => [k, arr(v)])),
    municipios: Object.fromEntries(Object.entries(porMuni).map(([k, v]) => [k, arr(v)]))
  };
}

// --------------------------------------------------------------- mensagens

function calcular(msg) {
  const np = msg.parties;
  NP = np;
  const cur = montarBase(msg.transfer, np);

  // Replay determinista: nacional -> UF -> municipio, do estado pristino.
  const rank = { nacional: 0, uf: 1, regiao: 2, municipio: 3 };
  const ops = (msg.ops || []).slice().sort(
    (a, b) => (rank[a.scope?.level] ?? 9) - (rank[b.scope?.level] ?? 9));
  for (let o = 0; o < ops.length; o++) {
    aplicarOp(cur, ops[o], np);
    progresso(0.2 + 0.6 * (o + 1) / ops.length, 'Aplicando ajustes');
  }

  progresso(0.85, 'Agregando');
  const agregado = agregar(cur, np, msg.detailUfs);

  ultimoCur = cur;
  ultimoNP = np;
  const apoio = msg.activeScope ? apoioDemografico(afetados(msg.activeScope), cur, np) : null;

  progresso(1, 'Pronto');
  post({ type: 'result', reqId: msg.reqId, agregado, demoSupport: apoio, parties: np });
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === 'load') {
      await carregar(msg.baseDir);
    } else if (msg.type === 'compute') {
      if (!carregado) { post({ type: 'error', erro: 'pacotes ainda nao carregados' }); return; }
      calcular(msg);
    } else if (msg.type === 'demoSupport') {
      // Pedido leve: reestima o apoio de outro escopo a partir da ultima
      // superficie, sem refazer o replay das operacoes.
      const apoio = (carregado && ultimoCur && msg.scope)
        ? apoioDemografico(afetados(msg.scope), ultimoCur, ultimoNP) : null;
      post({ type: 'demoSupport', reqId: msg.reqId, support: apoio });
    } else if (msg.type === 'shares') {
      post({ type: 'shares', reqId: msg.reqId, shares: participacoes(afetados(msg.scope)) });
    } else if (msg.type === 'turno2') {
      post({ type: 'turno2', reqId: msg.reqId, agregado: carregado ? turno2(msg) : null });
    } else if (msg.type === 'detail') {
      // Detalhe por local de uma UF, servido da ultima superficie calculada.
      // Evita refazer o replay inteiro so porque o usuario abriu um estado.
      const fatia = fatiaUf[msg.uf];
      const fonte = msg.turno === 2 ? ultimoCur2T : ultimoCur;
      let votos = null;
      if (carregado && fonte && fatia) {
        const [ini, qtd] = fatia;
        votos = Array.from(fonte.subarray(ini * ultimoNP, (ini + qtd) * ultimoNP),
          v => Math.round(v));
      }
      post({ type: 'detail', reqId: msg.reqId, uf: msg.uf, turno: msg.turno || 1, votos });
    }
  } catch (err) {
    post({ type: 'error', reqId: msg && msg.reqId, erro: String(err && err.stack || err) });
  }
};

/* Peso de cada bucket no eleitorado do escopo — usado pela previa instantanea
   da thread principal (produto escalar shares . apoio) enquanto o slider e
   arrastado, sem round-trip ao worker. */
function participacoes(idx) {
  const fora = {};
  let total = 0;
  iterar(idx, i => { total += aptosArr[i]; });
  for (const dim of dimensoes) {
    const acc = new Float64Array(dim.n);
    iterar(idx, i => {
      const fb = i * NB, tot = aptosArr[i];
      for (let k = 0; k < dim.n; k++) acc[k] += (fracs[fb + dim.offset + k] / QUANT) * tot;
    });
    fora[dim.key] = Array.from(acc, v => (total > 0 ? v / total : 0));
  }
  return fora;
}
