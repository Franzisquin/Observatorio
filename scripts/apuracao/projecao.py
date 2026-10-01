# -*- coding: utf-8 -*-
"""
Projecao do resultado final durante a apuracao (nowcast).

POR QUE. As urnas nao chegam em ordem aleatoria: Sul, Sudeste e Centro-Oeste
totalizam antes, Norte e Nordeste depois, e dentro de cada cidade tambem ha
bairro que chega primeiro. O placar parcial conta a historia de quem chegou, nao
a do pais. Em 2022, no 2o turno, Bolsonaro liderou o placar ate 67,76% das urnas;
no 1o turno, Lula so assumiu a lideranca perto de 70%.

COMO. Cada municipio ja apurado mostra como cada candidato vai ali, e a eleicao
anterior diz como aquele lugar costuma votar (a "base"). Uma regressao ajustada
nos municipios que ja chegaram liga as duas coisas, com um desvio proprio de cada
UF encolhido para zero enquanto a UF tem pouco dado. Ela estima o que falta: os
municipios ainda sem urna e o resto dos que estao pela metade. Somado ao que ja
foi apurado, sai o resultado final.

A incerteza vem de simulacao: em cada cenario variam, dentro do que o dado
permite, os coeficientes da regressao, o desvio de cada regiao e de cada UF, o
erro de cada municipio e o comparecimento do que falta — e um desvio do pais
inteiro, que nenhum dado da noite mede (TAU_NAC). As faixas sao os percentis 2,5
e 97,5 dos cenarios, e as chances sao a fracao dos cenarios em que a coisa
acontece. Quanto alargar tudo isso (INFLACAO, TAU_NAC) saiu das reencenacoes de
2022 em scripts/apuracao/testar_projecao.py.

Nao altera numero nenhum do TSE: e uma estimativa publicada a parte, rotulada
como tal na pagina, e deixa de ser mostrada quando o TSE declara o resultado.

Entradas de `projetar`:
  unidades   municipios do snapshot municipal: cd, uf, te (eleitorado), st/ts
             (secoes apuradas/total), vv (base dos percentuais: o vvc do TSE) e
             cand {id: votos}
  base       {cd: {lean, terc, rho}} da eleicao anterior (base_projecao.py)

Linha de comando (le os snapshots de uma pasta e grava a projecao ao lado):
  py scripts/apuracao/projecao.py --pasta scratch/apuracao/simulado --eleicao 21270
"""

from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import numpy as np

AQUI = Path(__file__).resolve().parent
BASE_PADRAO = AQUI / 'base_projecao_2022.json'

# Candidatos modelados um a um; os demais viram um so bloco, "outros".
K_MAX = 6

# Municipio entra no ajuste com pelo menos isto de votos apurados: abaixo disso
# o percentual e ruido de urna.
VOTOS_MIN = 40

# Quanto o ja apurado de um municipio manda no que falta dele: peso do observado
# = f / (f + MEIO_PESO). Com 20% das secoes, metade e metade.
MEIO_PESO = 0.2

# Teto do peso de um municipio no ajuste, em multiplos do municipio medio: sem
# ele, a capital apurada decide sozinha a regressao.
PESO_TETO = 30.0

# Desvio a priori (escala logit) de uma regiao inteira e de uma UF dentro da
# regiao, e o piso do da UF: o que ainda nao chegou herda essa incerteza.
TAU_REG = 0.15
TAU_UF = 0.12
TAU_UF_MIN = 0.05

# O mesmo para o comparecimento (escala log da razao hoje/base). Bem menor que o
# do voto: de uma eleicao para outra ele muda pouco, e o maior choque regional
# conhecido e o do 2o turno de 2022, com o Norte 3% abaixo do 1o turno e o
# Nordeste 1% abaixo do Sudeste.
TAU_REG_COMP = 0.06
TAU_UF_COMP = 0.04
TAU_UF_MIN_COMP = 0.02

# Regiao de cada UF, o nivel acima dela no ajuste. O exterior e uma regiao so.
REGIAO = {
    'pr': 'S', 'sc': 'S', 'rs': 'S',
    'sp': 'SE', 'rj': 'SE', 'mg': 'SE', 'es': 'SE',
    'go': 'CO', 'mt': 'CO', 'ms': 'CO', 'df': 'CO',
    'ba': 'NE', 'se': 'NE', 'al': 'NE', 'pe': 'NE', 'pb': 'NE', 'rn': 'NE', 'ce': 'NE',
    'pi': 'NE', 'ma': 'NE',
    'pa': 'N', 'am': 'N', 'ap': 'N', 'rr': 'N', 'ro': 'N', 'ac': 'N', 'to': 'N',
    'zz': 'ZZ',
}

# Alarga a incerteza alem do que o proprio ajuste mede: o que chega tarde difere
# do que chegou cedo de jeitos que a regressao nao ve. Valor da reencenacao.
INFLACAO = 1.6

# Desvio a priori (escala logit) do voto que falta no pais inteiro, o mesmo para
# todas as UFs. Dentro de cada cidade a secao que chega tarde nao vota como a que
# chegou cedo: no 2o turno de 2022, os primeiros 20% apurados de cada cidade
# davam a Lula 0,85 ponto a menos que a cidade inteira, e a projecao ficou meio
# ponto abaixo dele a noite toda. Nenhum dado da noite mede esse desvio antes de
# a urna chegar, entao ele nao encolhe com a apuracao. Valor da noite real
# (testar_projecao.py --real): o menor que poe o resultado dentro da faixa de 95%
# em todos os 22 marcos; sem ele, so em 8.
TAU_NAC = 0.05

# Minimo para publicar; menos que isso, qualquer numero seria chute.
PCT_MIN = 5.0
UFS_MIN = 15

CENARIOS = 2000
BLOCO = 250


def logit(p):
    return np.log(p) - np.log1p(-p)


def expit(x):
    return 1.0 / (1.0 + np.exp(-x))


def carregar_base(caminho: Path = BASE_PADRAO) -> dict:
    with open(caminho, encoding='utf-8') as f:
        return json.load(f)


def _neff(w):
    s = w.sum()
    return float(s * s / (w * w).sum()) if s > 0 else 0.0


def _completar(valores, g_de, G):
    """Municipio sem base (novo, ou fora da eleicao anterior) herda a media da UF."""
    v = valores.copy()
    geral = np.nanmean(v) if np.isfinite(v).any() else 0.0
    for g in range(G):
        m = g_de == g
        ok = m & np.isfinite(v)
        v[m & ~np.isfinite(v)] = v[ok].mean() if ok.any() else geral
    return v


def _ajustar(X, y, w, g_de, G, r_de_g, R, taus=(TAU_REG, TAU_UF, TAU_UF_MIN)):
    """Regressao ponderada com desvio de cada regiao e de cada UF, encolhidos.

    Dois niveis porque o erro que importa no comeco da noite e regional: o
    Nordeste inteiro chega tarde e se afasta junto do que o Sul mostrou. Com
    um nivel so, cada UF nordestina ainda sem urna seria um erro independente,
    que se cancela na soma — e a faixa sairia estreita justamente quando menos
    se sabe. Com a regiao, a primeira UF do Nordeste a chegar ja informa as
    outras, e uma regiao inteira ainda sem dado carrega um erro so, somado.

    O encolhimento usa o numero efetivo de municipios, e nao o voto: a capital
    apurada nao vale por cem municipios na hora de dizer como o resto vota.

    Devolve coeficientes, covariancia deles, desvio e incerteza de cada regiao
    e de cada UF, e o erro de um municipio (tudo em escala logit)."""
    tau_r, tau_g, tau_min = taus
    ur, ug = np.zeros(R), np.zeros(G)
    ur_sd, ug_sd = np.full(R, tau_r), np.full(G, tau_g)
    s2 = 0.05
    for _ in range(5):
        A = X.T @ (X * w[:, None]) + np.eye(X.shape[1]) * 1e-6
        b = np.linalg.solve(A, X.T @ (w * (y - ur[r_de_g[g_de]] - ug[g_de])))
        res = y - X @ b
        # media do residuo em cada UF, e quantos municipios efetivos a sustentam
        bruto, ne = np.zeros(G), np.zeros(G)
        for g in range(G):
            m = g_de == g
            if m.any():
                bruto[g] = np.sum(w[m] * res[m]) / w[m].sum()
                ne[g] = _neff(w[m])
        tem = ne > 0
        s2 = max(np.sum(w * (res - bruto[g_de]) ** 2) / w.sum(), 1e-4)
        # regiao: media das UFs com dado, cada uma pesada pela propria precisao
        var_g = np.where(tem, s2 / np.maximum(ne, 1e-9) + tau_g ** 2, np.inf)
        for r in range(R):
            m = tem & (r_de_g == r)
            prec = np.sum(1.0 / var_g[m]) if m.any() else 0.0
            ur[r] = (np.sum(bruto[m] / var_g[m]) / (prec + 1.0 / tau_r ** 2)) if m.any() else 0.0
            ur_sd[r] = math.sqrt(1.0 / (prec + 1.0 / tau_r ** 2))
        # UF: o que sobra depois da regiao, encolhido de novo
        dentro = bruto - ur[r_de_g]
        ug = np.where(tem, dentro * ne / (ne + s2 / tau_g ** 2), 0.0)
        ug_sd = np.sqrt(1.0 / (ne / s2 + 1.0 / tau_g ** 2))
        if tem.sum() >= 5:
            t2 = np.mean(dentro[tem] ** 2 - s2 / ne[tem])
            tau_g = max(tau_min, math.sqrt(max(t2, 0.0)))
    Ainv = np.linalg.inv(A)
    cov = s2 * (Ainv @ (X.T @ (X * (w * w)[:, None])) @ Ainv)
    return b, cov, ur, ur_sd, ug, ug_sd, math.sqrt(s2)


def projetar(unidades: list[dict], base: dict, cenarios: int = CENARIOS,
             semente: int = 0, inflacao: float = INFLACAO,
             vagas: int = 1, maioria: bool = True) -> dict:
    """Projeta o resultado final. Devolve um dicionario pronto para JSON.

    `vagas` e o numero de cadeiras (Senado de 2026: 2). `maioria` diz se o
    cargo tem segundo turno — presidente e governador, sim; senador, nao."""
    rng = np.random.default_rng(semente)
    n = len(unidades)

    # ---------------------------------------------------------------- arranjo
    todos = {}
    for u in unidades:
        for c, v in (u.get('cand') or {}).items():
            todos[c] = todos.get(c, 0) + v
    ordem = sorted(todos, key=lambda c: -todos[c])
    modelados = ordem[:K_MAX]
    agrupa = len(ordem) > K_MAX
    nomes = modelados + (['outros'] if agrupa else [])
    K = len(nomes)
    if n == 0 or K < 2:
        return {'suficiente': False, 'motivo': 'sem voto apurado'}

    grupos = sorted({u['uf'] for u in unidades})
    G = len(grupos)
    g_de = np.array([grupos.index(u['uf']) for u in unidades])
    # regiao de cada UF; UF fora do mapa (ex.: cargo estadual) e a propria regiao
    regioes = sorted({REGIAO.get(g, g) for g in grupos})
    R_ = len(regioes)
    r_de_g = np.array([regioes.index(REGIAO.get(g, g)) for g in grupos])
    te = np.array([float(u.get('te') or 0) for u in unidades])
    st = np.array([float(u.get('st') or 0) for u in unidades])
    ts = np.array([float(u.get('ts') or 0) for u in unidades])
    f = np.where(ts > 0, np.clip(st / np.maximum(ts, 1), 0, 1), 0.0)

    V = np.zeros((n, K))
    for i, u in enumerate(unidades):
        cand = u.get('cand') or {}
        for k, c in enumerate(modelados):
            V[i, k] = cand.get(c, 0)
        if agrupa:
            V[i, K - 1] = sum(v for c, v in cand.items() if c not in modelados)
    vv = V.sum(axis=1)
    apurado = V.sum(axis=0)
    pct_apurado = 100.0 * st.sum() / max(ts.sum(), 1)
    rep = vv >= VOTOS_MIN
    ufs_com_dados = len({unidades[i]['uf'] for i in np.flatnonzero(rep)})
    if rep.sum() < 10:
        return {'suficiente': False, 'motivo': 'poucos municipios apurados',
                'pct_apurado': round(pct_apurado, 3)}

    # Base: inclinacao entre os dois polos da eleicao anterior (logit), peso da
    # terceira via (logit) e votos validos por eleitor.
    def da_base(chave):
        saida = np.full(n, np.nan)
        for i, u in enumerate(unidades):
            v = (base.get(str(u['cd'])) or {}).get(chave)
            if v is not None:
                saida[i] = v
        return saida
    lean = _completar(da_base('lean'), g_de, G)
    terc = _completar(da_base('terc'), g_de, G)
    rho0 = da_base('rho')

    # ------------------------------------------ comparecimento do que falta
    # Votos validos por eleitor: o observado onde ja ha urna; onde nao ha, o da
    # pela mesma regressao do voto: inclinacao politica, terceira via e desvio da
    # regiao e da UF. Com base de comparecimento, o modelado e a razao hoje/base;
    # sem ela, o proprio nivel. A razao nao e a mesma no pais inteiro: no 2o
    # turno de 2022 o comparecimento subiu mais nas areas bolsonaristas, e aplicar
    # ao Nordeste ainda sem urna a razao do Sul inflava o voto de Lula em ~1 ponto.
    X = np.column_stack([np.ones(n), lean, terc])
    elei_ap = te * f
    rho_obs = np.where(rep & (elei_ap > 0), vv / np.maximum(elei_ap, 1), np.nan)
    com_base = np.isfinite(rho0) & (rho0 > 0)
    rho_ref = (_completar(np.where(com_base, rho0, np.nan), g_de, G)
               if com_base.mean() > 0.5 else np.ones(n))
    alvo = np.log(np.clip(rho_obs / rho_ref, 0.05, 20.0))
    rep_t = rep & np.isfinite(alvo)
    wt = np.minimum(elei_ap / elei_ap[rep_t].mean(), PESO_TETO)
    ajuste_t = _ajustar(X[rep_t], alvo[rep_t], wt[rep_t], g_de[rep_t], G, r_de_g, R_,
                        (TAU_REG_COMP, TAU_UF_COMP, TAU_UF_MIN_COMP))
    b_t, _, ur_t, _, ug_t, _, _ = ajuste_t
    rho_prev = rho_ref * np.exp(X @ b_t + ur_t[r_de_g[g_de]] + ug_t[g_de])
    peso_obs = np.where(rep, f / (f + MEIO_PESO), 0.0)
    rho_obs0 = np.nan_to_num(rho_obs)
    rho_hat = peso_obs * rho_obs0 + (1 - peso_obs) * rho_prev
    R = te * (1 - f) * rho_hat                               # votos que faltam

    # ------------------------------------------------ o voto do que falta
    q = (V + 0.5) / (vv[:, None] + 0.5 * K)
    y = logit(q)
    w = np.minimum(vv / vv[rep].mean(), PESO_TETO)
    Xr, wr_, gr = X[rep], w[rep], g_de[rep]
    ajuste = [_ajustar(Xr, y[rep, k], wr_, gr, G, r_de_g, R_) for k in range(K)]

    # ---------------------------------------------------------- cenarios
    # So entra quem ainda tem voto a contar; o resto ja e numero do TSE.
    vivos = np.flatnonzero(R > 0.5)
    Xv, gv = X[vivos], g_de[vivos]
    obs_v = (V[vivos] / np.maximum(vv[vivos], 1)[:, None]).astype(np.float32)
    wobs = peso_obs[vivos]
    wobs_v = wobs.astype(np.float32)[None, :, None]
    falta_elei = (te * (1 - f))[vivos]
    base_uf = np.zeros((G, K))
    for g in range(G):
        base_uf[g] = V[g_de == g].sum(axis=0)
    final_uf = np.zeros((cenarios, G, K))

    def sortear(aj, S, tau_nac=0.0):
        """Preditor linear das unidades vivas em S cenarios: coeficientes, desvio
        do pais (`tau_nac`), da regiao (o mesmo para todas as UFs dela), da UF e
        de cada municipio."""
        b, cov, ur, ur_sd, ug, ug_sd, sig = aj
        try:
            C = np.linalg.cholesky(cov + np.eye(len(b)) * 1e-10)
        except np.linalg.LinAlgError:
            C = np.diag(np.sqrt(np.clip(np.diag(cov), 0, None)))
        bk = b[None, :] + inflacao * (rng.standard_normal((S, len(b))) @ C.T)
        rk = ur[None, :] + inflacao * rng.standard_normal((S, R_)) * ur_sd[None, :]
        uk = ug[None, :] + inflacao * rng.standard_normal((S, G)) * ug_sd[None, :] + rk[:, r_de_g]
        eta = (bk @ Xv.T + uk[:, gv]).astype(np.float32)
        eta += (inflacao * sig) * rng.standard_normal((S, len(vivos))).astype(np.float32)
        if tau_nac:
            eta += (inflacao * tau_nac) * rng.standard_normal((S, 1)).astype(np.float32)
        return eta

    for ini in range(0, cenarios, BLOCO):
        S = min(BLOCO, cenarios - ini)
        eta = np.empty((S, len(vivos), K), dtype=np.float32)
        for k, aj in enumerate(ajuste):
            eta[:, :, k] = sortear(aj, S, TAU_NAC)
        p = expit(eta)
        p /= p.sum(axis=2, keepdims=True)
        s = wobs_v * obs_v[None, :, :] + (1 - wobs_v) * p
        rho_s = wobs[None, :] * rho_obs0[vivos][None, :] + \
            (1 - wobs[None, :]) * rho_ref[vivos][None, :] * np.exp(sortear(ajuste_t, S))
        falta = (falta_elei[None, :] * rho_s)[:, :, None] * s             # S x vivos x K
        for g in range(G):
            m = gv == g
            final_uf[ini:ini + S, g, :] = base_uf[g][None, :] + falta[:, m, :].sum(axis=1)
    final = final_uf.sum(axis=1)
    share = final / final.sum(axis=1, keepdims=True)

    # ----------------------------------------------------------- resumo
    # "outros" e um bloco de candidatos, nao um candidato: tem faixa, mas nao
    # entra em ranking, em chance de vencer nem em par de segundo turno.
    agora = apurado / max(apurado.sum(), 1)
    kc = len(modelados)
    ordem_s = np.argsort(-share[:, :kc], axis=1)
    primeiro = ordem_s[:, 0]
    cand_saida = {}
    for k, c in enumerate(nomes):
        sk = share[:, k]
        cand_saida[c] = {
            'media': round(float(sk.mean()), 5),
            'p025': round(float(np.percentile(sk, 2.5)), 5),
            'p975': round(float(np.percentile(sk, 97.5)), 5),
            'apurado': round(float(agora[k]), 5),
        }
        if k < kc:
            cand_saida[c]['p_primeiro'] = round(float(np.mean(primeiro == k)), 4)
            cand_saida[c]['p_vaga'] = round(float(np.mean((ordem_s[:, :vagas] == k).any(axis=1))), 4)
            if maioria:
                cand_saida[c]['p_maioria'] = round(float(np.mean(sk > 0.5)), 4)
                # vai ao 2o turno: ninguem passou de 50% e ele esta entre os dois
                sem_maioria = share[:, :kc].max(axis=1) <= 0.5
                cand_saida[c]['p_segundo_turno'] = round(float(np.mean(
                    sem_maioria & (ordem_s[:, :2] == k).any(axis=1))), 4)

    desfecho = {}
    if maioria and vagas == 1:
        venceu = share[:, :kc].max(axis=1) > 0.5
        desfecho['p_decidido'] = round(float(venceu.mean()), 4)
        pares = {}
        for a, b in ordem_s[~venceu, :2]:
            chave = tuple(sorted((nomes[a], nomes[b])))
            pares[chave] = pares.get(chave, 0) + 1
        desfecho['segundo_turno'] = [{'par': list(par), 'p': round(cont / cenarios, 4)}
                                     for par, cont in sorted(pares.items(), key=lambda kv: -kv[1])[:4]]

    por_uf = {}
    for g, uf in enumerate(grupos):
        sh = final_uf[:, g, :] / np.maximum(final_uf[:, g, :].sum(axis=1, keepdims=True), 1)
        cont = np.bincount(np.argmax(sh[:, :kc], axis=1), minlength=kc)
        k = int(np.argmax(cont))
        m = g_de == g
        por_uf[uf] = {
            'lider': nomes[k],
            'p': round(float(cont[k] / cenarios), 4),
            'media': {nomes[j]: round(float(sh[:, j].mean()), 4)
                      for j in np.argsort(-sh[:, :kc].mean(axis=0))[:3]},
            'pct_apurado': round(float(100.0 * st[m].sum() / max(ts[m].sum(), 1)), 2),
        }

    return {
        'suficiente': bool(pct_apurado >= PCT_MIN and ufs_com_dados >= min(UFS_MIN, G)),
        'pct_apurado': round(pct_apurado, 3),
        'ufs_com_dados': ufs_com_dados,
        'cenarios': cenarios,
        'cand': cand_saida,
        'desfecho': desfecho,
        'uf': por_uf,
    }


# ---------------------------------------------------------------- snapshots

def unidades_do_snapshot(pasta: Path, eleicao: str, cargo: str,
                         ufs: list[str] | None = None) -> list[dict]:
    """Municipios de todas as UFs publicadas, no formato de `projetar`."""
    unid = []
    for arq in sorted(pasta.glob(f'{eleicao}-{cargo}-*.json')):
        uf = arq.stem.rsplit('-', 1)[1]
        if len(uf) != 2 or uf in ('br', 'uf', 'ab') or (ufs and uf not in ufs):
            continue
        d = json.loads(arq.read_text(encoding='utf-8'))
        for cd, e in (d.get('abr') or {}).items():
            unid.append({'cd': cd, 'uf': uf, 'te': e.get('te', 0), 'st': e.get('st', 0),
                         'ts': e.get('ts', 0), 'vv': e.get('vvc', e.get('vv', 0)),
                         'cand': e.get('cand') or {}})
    return unid


def rodada(pasta: Path, eleicao: str, cargo: str, base: dict, abrangencia: str = 'br',
           vagas: int = 1, maioria: bool = True, semente: int | None = None) -> dict:
    """Uma rodada: projeta, anexa a serie historica e grava {eleicao}-{cargo}-proj.json
    (-proj-{uf}.json para cargo estadual), por troca de nome, como os snapshots."""
    ufs = None if abrangencia == 'br' else [abrangencia]
    unid = unidades_do_snapshot(pasta, eleicao, cargo, ufs)
    r = projetar(unid, base, semente=int(time.time()) if semente is None else semente,
                 vagas=vagas, maioria=maioria)
    r['gerado'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    r['abrangencia'] = abrangencia

    sufixo = 'proj' if abrangencia == 'br' else f'proj-{abrangencia}'
    destino = pasta / f'{eleicao}-{cargo}-{sufixo}.json'
    serie = []
    if destino.exists():
        try:
            serie = json.loads(destino.read_text(encoding='utf-8')).get('serie', [])
        except (ValueError, OSError):
            serie = []
    if r.get('cand') and r.get('suficiente'):
        ponto = {'t': r['gerado'], 'pct': r['pct_apurado'],
                 'c': {c: [v['media'], v['p025'], v['p975'], v['apurado']] for c, v in r['cand'].items()}}
        if not serie or serie[-1]['pct'] != ponto['pct']:
            serie.append(ponto)
    r['serie'] = serie
    tmp = destino.with_suffix('.tmp')
    tmp.write_text(json.dumps(r, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    tmp.replace(destino)
    return r


def main() -> int:
    ap = argparse.ArgumentParser(description='Projecao do resultado final durante a apuracao.')
    ap.add_argument('--pasta', type=Path, required=True)
    ap.add_argument('--eleicao', required=True)
    ap.add_argument('--cargo', default='0001')
    ap.add_argument('--base', type=Path, default=BASE_PADRAO)
    ap.add_argument('--abrangencia', default='br')
    args = ap.parse_args()
    t0 = time.time()
    r = rodada(args.pasta, args.eleicao, args.cargo, carregar_base(args.base), args.abrangencia)
    print(f"{r.get('pct_apurado', 0):.1f}% apurado, suficiente={r['suficiente']} ({time.time() - t0:.1f} s)")
    for c, v in sorted((r.get('cand') or {}).items(), key=lambda kv: -kv[1]['media']):
        print(f"  {c:>10}  {100 * v['media']:5.1f}%  [{100 * v['p025']:5.1f} a {100 * v['p975']:5.1f}]"
              f"  apurado {100 * v['apurado']:5.1f}%  primeiro {100 * v.get('p_primeiro', 0):5.1f}%")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
