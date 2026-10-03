# -*- coding: utf-8 -*-
"""
Reencenacao da apuracao presidencial de 2022 para testar e calibrar a projecao
(scripts/apuracao/projecao.py).

A ordem de chegada de verdade (a hora em que cada boletim chegou ao TSE) nao
esta no repositorio. Aqui ela e sorteada, local de votacao por local, com o que
se sabe da noite: Sul, Sudeste e Centro-Oeste antes, Nordeste e Norte depois, o
exterior por ultimo, e cada cidade chegando aos poucos. O sorteio e calibrado
para reproduzir a virada que a noite real teve: no 1o turno Lula so assumiu a
lideranca do placar perto de 70% das urnas, e no 2o turno, as 18h44, com 67,76%.

  1o turno de 2022  base: 1o turno de 2018 (Haddad x Bolsonaro)
  2o turno de 2022  base: 1o turno de 2022 — o que a projeção do 2o turno de
                    2026 vai usar, com o 1o turno de 2026 no lugar

`--vies` acrescenta um vies que o modelo nao enxerga: dentro de cada cidade, os
locais mais petistas chegam mais tarde (em minutos por desvio-padrao). E o teste
de estresse: a faixa de 95% tem de continuar honesta.

`--gravar PCT` grava a noite reencenada naquele percentual, no formato do
coletor (indice, snapshots Brasil, UF e municipais) e com a serie da projecao ate
ali: a pagina da apuracao roda inteira em cima dela. Os snapshots saem marcados
como simulado, e a pagina mostra o selo.

Uso:
  py scripts/apuracao/testar_projecao.py                 (2 turnos, 8 sorteios)
  py scripts/apuracao/testar_projecao.py --turno 2 --sorteios 20 --vies 3
  py scripts/apuracao/testar_projecao.py --turno 2 --gravar 20 \\
      --destino scratch/apuracao/reencenacao
      apuracao-presidente.html?dados=scratch/apuracao/reencenacao/
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))
from base_projecao import de_locais, votos_por_local  # noqa: E402
from projecao import INFLACAO, REGIAO, carregar_base, projetar  # noqa: E402

RAIZ = AQUI.parent.parent

# Atraso medio de cada regiao, em minutos depois das 17h, e o espalhamento das
# UFs dentro dela. Calibrado para a virada real (ver docstring).
ATRASO = {'S': 4.0, 'SE': 9.0, 'CO': 9.0, 'NE': 24.0, 'N': 27.0, 'ZZ': 40.0}
JITTER_UF = 5.0
JITTER_MUN = 7.0
ESPERA_LOCAL = 9.0

MARCOS = [3, 5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90]


def carregar(turno: int):
    """Locais de 2022 do turno, com eleitorado por municipio do snapshot do coletor."""
    locais = votos_por_local(2022, turno)
    eleicao = '544' if turno == 1 else '545'
    te = {}
    for arq in (RAIZ / 'scratch' / 'apuracao' / '2022').glob(f'{eleicao}-0001-*.json'):
        uf = arq.stem.rsplit('-', 1)[1]
        if len(uf) == 2 and uf not in ('br', 'uf'):
            for cd, e in json.loads(arq.read_text(encoding='utf-8'))['abr'].items():
                te[cd] = e.get('te', 0)
    chaves = list(locais)
    ufs = np.array([k[0] for k in chaves])
    munis = np.array([k[1] for k in chaves])
    numeros = sorted({n for v in locais.values() for n in v})
    M = np.array([[locais[k].get(n, 0) for n in numeros] for k in chaves], dtype=float)
    return ufs, munis, numeros, M, te


def ordem_de_chegada(ufs, munis, M, numeros, rng, vies: float):
    # sorted: a ordem de um set de strings muda a cada processo, e a mesma
    # semente sortearia noites diferentes
    atraso_uf = {uf: ATRASO[REGIAO[uf]] + rng.normal(0, JITTER_UF) for uf in sorted(set(ufs))}
    atraso_mun = {m: rng.normal(0, JITTER_MUN) for m in sorted(set(munis))}
    t = np.array([atraso_uf[u] for u in ufs]) + np.array([atraso_mun[m] for m in munis])
    t += rng.exponential(ESPERA_LOCAL, len(ufs))
    if vies:
        pt = M[:, numeros.index('13')] / np.maximum(M.sum(axis=1), 1)
        # desvio de cada local em relacao a media da propria cidade
        media = {}
        for m in set(munis):
            sel = munis == m
            media[m] = pt[sel].mean()
        z = pt - np.array([media[m] for m in munis])
        t += vies * z / max(z.std(), 1e-6)
    return np.argsort(t)


def unidades_em(frac, ordem, ufs, munis, M, numeros, te):
    """Snapshot municipal no instante em que `frac` dos votos ja chegou. As
    secoes (st/ts) sao aproximadas por blocos de 250 votos."""
    acum = np.cumsum(M[ordem].sum(axis=1))
    corte = int(np.searchsorted(acum, frac * acum[-1]))
    chegou = np.zeros(len(ufs), dtype=bool)
    chegou[ordem[:corte + 1]] = True
    cds, idx = np.unique(munis, return_inverse=True)
    uf_de = dict(zip(munis, ufs))
    tot = np.bincount(idx, weights=M.sum(axis=1), minlength=len(cds))
    ap = np.zeros((len(cds), len(numeros)))
    np.add.at(ap, idx[chegou], M[chegou])
    saida = []
    for j, cd in enumerate(cds):
        ts = int(tot[j] // 250) + 1
        vv = float(ap[j].sum())
        saida.append({'cd': cd, 'uf': uf_de[cd], 'te': te.get(cd) or tot[j] / 0.78,
                      'st': round(ts * vv / max(tot[j], 1)), 'ts': ts, 'vv': vv,
                      'cand': {n: float(v) for n, v in zip(numeros, ap[j]) if v > 0}})
    return saida


def virada(ordem, M, numeros):
    """Percentual apurado em que o 13 passa o 22 no placar e nao sai mais da frente."""
    a = np.cumsum(M[ordem, numeros.index('13')])
    b = np.cumsum(M[ordem, numeros.index('22')])
    tot = np.cumsum(M[ordem].sum(axis=1))
    atras = np.flatnonzero(a <= b)
    return 100.0 * tot[atras[-1]] / tot[-1] if len(atras) else 0.0


def base_da_noite(turno: int) -> dict:
    """A base com que a noite real e projetada. 1o turno: o 1o turno de 2018, como
    no domingo sera o de 2022. 2o turno: a de producao, o 1o turno de 2022."""
    return de_locais(2018, 1, ('13', '17')) if turno == 1 else carregar_base()


def casar_chaves(cds, base: dict) -> list:
    """O codigo do municipio como a base o guarda: a de producao (snapshots do
    coletor) com o zero a esquerda, a de 2018 (base_projecao.de_locais) sem ele.
    Errar isto deixa todo municipio sem base, e o teste passa sem medir nada."""
    com = sum(c in base for c in cds)
    sem = sum(c.lstrip('0') in base for c in cds)
    return list(cds) if com >= sem else [c.lstrip('0') for c in cds]


def noite_de_verdade(turno: int, base: dict):
    """(em, real): em(pct) da os municipios da noite real de 2022 com `pct` por
    cento das urnas chegadas, e a hora; real e o % final de cada numero."""
    from noite_2022 import carregar as carregar_noite

    d = carregar_noite(str(turno))
    ordem = np.argsort(d['t'], kind='stable')
    cds, idx = np.unique(d['muni'], return_inverse=True)
    chaves = casar_chaves(cds, base)
    uf_de = dict(zip(d['muni'], d['uf']))
    ts = np.bincount(idx)
    te = np.bincount(idx, weights=d['aptos'])
    nums, V = d['numeros'], d['V']

    def em(pct):
        chegou = ordem[:int(len(ordem) * pct / 100)]
        st = np.bincount(idx[chegou], minlength=len(cds))
        ap = np.zeros((len(cds), len(nums)))
        np.add.at(ap, idx[chegou], V[chegou])
        unid = [{'cd': chaves[j], 'uf': uf_de[cd], 'te': te[j], 'st': int(st[j]), 'ts': int(ts[j]),
                 'vv': float(ap[j].sum()), 'cand': {n: float(v) for n, v in zip(nums, ap[j]) if v}}
                for j, cd in enumerate(cds)]
        return unid, float(d['t'][ordem[max(len(chegou) - 1, 0)]])

    total = V.sum(axis=0)
    return em, {n: float(v / total.sum()) for n, v in zip(nums, total)}


def gravar(turno: int, pct: float, destino: Path, sorteio: int = 0, real: bool = False) -> None:
    """A noite de 2022 em `pct` por cento, no formato do coletor, com a serie da
    projecao rodada nos marcos ate ali. `real`: a ordem de chegada de verdade do
    2o turno, em vez de uma sorteada."""
    from projecao import carregar_base, rodada

    if real:
        turno = 2
        em, _ = noite_de_verdade(2, carregar_base())
        fonte = lambda p: em(p)[0]  # noqa: E731
    else:
        ufs, munis, numeros, M, te = carregar(turno)
        ordem = ordem_de_chegada(ufs, munis, M, numeros, np.random.default_rng(1000 + sorteio), 0.0)
        fonte = lambda p: unidades_em(p / 100, ordem, ufs, munis, M, numeros, te)  # noqa: E731
    eleicao = '544' if turno == 1 else '545'
    real = RAIZ / 'scratch' / 'apuracao' / '2022'
    br_real = json.loads((real / f'{eleicao}-0001-br.json').read_text(encoding='utf-8'))
    dic = br_real['cand']
    sq_de = {str(c['numero']): sq for sq, c in dic.items()}
    meta = {'ele': eleicao, 't': str(turno), 'f': 's', 'cargo': '0001', 'reencenacao': True}

    def entrada(st, ts, te_, cand):
        vv = sum(cand.values())
        comp = round(vv / 0.95)
        return {'and': 'f' if st >= ts else ('p' if st else 'n'), 'dv': 's', 'st': st, 'ts': ts,
                'pst': round(100.0 * st / max(ts, 1), 2), 'te': round(te_), 'comp': comp,
                'abst': max(round(te_ * st / max(ts, 1)) - comp, 0), 'tv': comp, 'vvc': vv, 'vv': vv,
                'vb': round(comp * 0.02), 'vn': comp - vv - round(comp * 0.02), 'cand': cand}

    def somar(entradas):
        cand, st, ts, te_ = {}, 0, 0, 0
        for e in entradas:
            st += e['st']; ts += e['ts']; te_ += e['te']
            for k, v in e['cand'].items():
                cand[k] = cand.get(k, 0) + v
        return entrada(st, ts, te_, cand)

    destino.mkdir(parents=True, exist_ok=True)
    base = (carregar_base() if turno == 2 else de_locais(2018, 1, ('13', '17')))
    for marco in [m for m in MARCOS if m < pct] + [pct]:
        unid = fonte(marco)
        por_uf = {}
        for u in unid:
            cand = {sq_de.get(n, n): round(v) for n, v in u['cand'].items()}
            por_uf.setdefault(u['uf'], {})[u['cd']] = entrada(u['st'], u['ts'], u['te'], cand)
        for uf, abr in por_uf.items():
            arq = real / f'{eleicao}-0001-{uf}.json'
            mun = json.loads(arq.read_text(encoding='utf-8')).get('mun', {}) if arq.exists() else {}
            (destino / f'{eleicao}-0001-{uf}.json').write_text(json.dumps({
                'meta': meta, 'abr': abr, 'cand': dic,
                'mun': {cd: mun.get(cd, {'nm': cd, 'ibge': ''}) for cd in abr}},
                ensure_ascii=False), encoding='utf-8')
        ufs_abr = {uf: somar(abr.values()) for uf, abr in por_uf.items()}
        (destino / f'{eleicao}-0001-uf.json').write_text(json.dumps(
            {'meta': meta, 'abr': ufs_abr, 'cand': dic}, ensure_ascii=False), encoding='utf-8')
        (destino / f'{eleicao}-0001-br.json').write_text(json.dumps(
            {'meta': meta, 'abr': {'br': somar(ufs_abr.values())}, 'cand': dic},
            ensure_ascii=False), encoding='utf-8')
        r = rodada(destino, eleicao, '0001', base, semente=sorteio)
        print(f'  {marco:5.1f}% -> projecao com {r.get("pct_apurado", 0):.1f}% das secoes')
    (destino / 'indice.json').write_text(json.dumps({
        'cargos': {'0001': eleicao},
        'eleicoes': {eleicao: {'t': str(turno), 't2': '', 'cargos': ['0001'],
                               'nm': f'Reencenacao de 2022, {turno}o turno'}}}), encoding='utf-8')
    print(f'gravado em {destino}')


NOMES = {'13': 'Lula', '22': 'Bolsonaro', '15': 'Tebet', '12': 'Ciro'}


def noite_real(turno: int, inflacao: float, cenarios: int, sementes: int = 1) -> None:
    """A projecao na ordem de chegada de verdade de 2022 (os boletins de urna do
    TSE, ver noite_2022.py). Cada linha: o placar, a projecao e a faixa de 95% de
    cada candidato — com ! quando a faixa nao contem o resultado final."""
    base = base_da_noite(turno)
    em, real = noite_de_verdade(turno, base)
    alvos = sorted(real, key=lambda n: -real[n])[:4 if turno == 1 else 2]
    print(f'\n=== noite real do {turno}o turno de 2022 | base {"2018 1T" if turno == 1 else "2022 1T"}'
          f' | inflacao {inflacao}')
    print('verdade: ' + '  '.join(f'{NOMES.get(n, n)} {100 * real[n]:.2f}%' for n in alvos))
    print(' apurado |  hora | ' + ' | '.join(f'{NOMES.get(n, n):>9}: placar  projecao (faixa)  '
                                              for n in alvos)
          + '| ' + ('P(2T Lula x Bolsonaro)' if turno == 1 else 'P(Lula > 50%)'))
    cobre, linhas = {n: 0 for n in alvos}, 0
    for p in MARCOS:
        unid, hora = em(p)
        for s in range(sementes):
            r = projetar(unid, base, cenarios=cenarios, semente=s, inflacao=inflacao)
            if not r.get('cand'):
                continue
            linhas += 1
            celulas = []
            for n in alvos:
                c = r['cand'][n]
                dentro = c['p025'] <= real[n] <= c['p975']
                cobre[n] += dentro
                celulas.append(f'{" " * (len(NOMES.get(n, n)) - 2)}{100 * c["apurado"]:6.2f}  {100 * c["media"]:6.2f} '
                               f'({100 * c["p025"]:5.2f}-{100 * c["p975"]:5.2f}){" " if dentro else "!"}')
            if turno == 1:
                par = (r.get('desfecho') or {}).get('segundo_turno') or []
                chance = next((x['p'] for x in par if sorted(x['par']) == ['13', '22']), 0)
            else:
                chance = r['cand']['13'].get('p_maioria', 0)
            h = max(hora, 0)
            print(f'  {p:>4}%  | {17 + int(h // 60)}h{int(h % 60):02d} | ' + ' | '.join(celulas)
                  + f' | {100 * chance:5.1f}%' + ('' if r.get('suficiente') else '  (nao publica ainda)'))
    print('a faixa de 95% contem o resultado final: '
          + ', '.join(f'{NOMES.get(n, n)} {cobre[n]} de {linhas}' for n in alvos))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--real', action='store_true',
                    help='a noite de verdade de 2022 (precisa de sequencia_2022.py --converter)')
    ap.add_argument('--turno', type=int, choices=[1, 2])
    ap.add_argument('--sorteios', type=int, default=8)
    ap.add_argument('--vies', type=float, default=0.0)
    ap.add_argument('--inflacao', type=float, default=INFLACAO)
    ap.add_argument('--cenarios', type=int, default=600)
    ap.add_argument('--gravar', type=float)
    ap.add_argument('--destino', type=Path, default=RAIZ / 'scratch' / 'apuracao' / 'reencenacao')
    args = ap.parse_args()

    if args.gravar:
        gravar(args.turno or 2, args.gravar, args.destino, real=args.real)
        return 0
    if args.real:
        for turno in ([args.turno] if args.turno else [1, 2]):
            noite_real(turno, args.inflacao, args.cenarios)
        return 0

    for turno in ([args.turno] if args.turno else [1, 2]):
        t0 = time.time()
        ufs, munis, numeros, M, te = carregar(turno)
        # 2o turno: a base de producao (1o turno de 2022, com comparecimento), a
        # mesma forma da que o 2o turno de 2026 vai usar. 1o turno: 2018 nao tem
        # eleitorado por municipio no repositorio, entao sai sem comparecimento.
        base = de_locais(2018, 1, ('13', '17')) if turno == 1 else carregar_base()
        verdade = M.sum(axis=0) / M.sum()
        alvos = [n for n in np.array(numeros)[np.argsort(-verdade)][:3]]
        print(f'\n=== 2022, {turno}o turno | base {"2018 1T" if turno == 1 else "2022 1T"} | '
              f'{len(ufs)} locais | vies {args.vies} | inflacao {args.inflacao}')
        print('verdade: ' + '  '.join(f'{n}={100 * verdade[numeros.index(n)]:.2f}%' for n in alvos))

        stats = {p: {'erro': [], 'ingenuo': [], 'cobre': [], 'largura': [], 'lider': [], 'desf': [], 'vies': []}
                 for p in MARCOS}
        viradas = []
        for s in range(args.sorteios):
            rng = np.random.default_rng(1000 + s)
            ordem = ordem_de_chegada(ufs, munis, M, numeros, rng, args.vies)
            viradas.append(virada(ordem, M, numeros))
            for p in MARCOS:
                unid = unidades_em(p / 100, ordem, ufs, munis, M, numeros, te)
                r = projetar(unid, base, cenarios=args.cenarios, semente=s, inflacao=args.inflacao)
                if not r.get('cand'):
                    continue
                st = stats[p]
                for n in alvos[:2]:
                    c = r['cand'].get(n)
                    if not c:
                        continue
                    real = verdade[numeros.index(n)]
                    st['erro'].append(abs(c['media'] - real))
                    st['ingenuo'].append(abs(c['apurado'] - real))
                    st['cobre'].append(c['p025'] <= real <= c['p975'])
                    st['largura'].append(c['p975'] - c['p025'])
                    if n == '13':
                        st['vies'].append(c['media'] - real)
                st['lider'].append(r['cand'].get('13', {}).get('p_primeiro', 0))
                if turno == 1:
                    par = (r.get('desfecho') or {}).get('segundo_turno') or []
                    st['desf'].append(next((x['p'] for x in par if sorted(x['par']) == ['13', '22']), 0))
                else:
                    st['desf'].append(r['cand'].get('13', {}).get('p_maioria', 0))
        print(f'virada do placar nos sorteios: {np.mean(viradas):.1f}% (de {min(viradas):.1f} a {max(viradas):.1f}); '
              f'real: {"~70" if turno == 1 else "67,76"}%')
        print(' apurado | erro projecao | vies Lula | erro placar | faixa 95% cobre | largura | P(Lula 1o) | '
              + ('P(2T Lula x Bolsonaro)' if turno == 1 else 'P(Lula > 50%)'))
        for p in MARCOS:
            st = stats[p]
            if not st['erro']:
                continue
            print(f'  {p:>4}%  |   {100 * np.mean(st["erro"]):5.2f} pp   | {100 * np.mean(st["vies"]):+5.2f} pp |'
                  f'  {100 * np.mean(st["ingenuo"]):5.2f} pp  |'
                  f'     {100 * np.mean(st["cobre"]):5.1f}%      | {100 * np.mean(st["largura"]):5.2f} pp |'
                  f'  {100 * np.mean(st["lider"]):5.1f}%   |  {100 * np.mean(st["desf"]):5.1f}%')
        print(f'({time.time() - t0:.0f} s)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
