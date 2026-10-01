# -*- coding: utf-8 -*-
"""
A noite de 2022 do comeco ao fim, para ver a projecao trabalhando.

Grava scratch/nowcast-2022/noite.json, que scratch/nowcast-2022/index.html toca
dentro da pagina da apuracao presidencial de verdade (apuracao-presidente.html):
a pagina pede os snapshots de sempre, e o tocador responde com os da noite
naquele instante, montados em memoria. Nada vai para o disco alem deste arquivo.

  1o turno  ordem de chegada sorteada e calibrada (testar_projecao.py); base, o
            1o turno de 2018 — como em 2026 a base sera o 1o turno de 2022
  2o turno  ordem de chegada real, a hora em que cada boletim de urna chegou ao
            TSE (noite_2022.py); base, o 1o turno de 2022, a de producao

Por marco: o que mudou em cada municipio desde o marco anterior (secoes e votos)
e a projecao rodada sobre o acumulado, com os mesmos municipios e as mesmas
secoes que a pagina mostra.

Uso: py scripts/apuracao/replay_2022.py [--cenarios 2000]
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
from projecao import CENARIOS, carregar_base, projetar  # noqa: E402
from testar_projecao import RAIZ, ordem_de_chegada  # noqa: E402

SNAP = RAIZ / 'scratch' / 'apuracao' / '2022'
DESTINO = RAIZ / 'scratch' / 'nowcast-2022' / 'noite.json'

# Em % das secoes: fino no comeco, quando a projecao mais se mexe.
MARCOS = [0, 0.25, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5] + list(range(5, 100)) + [99.5, 100]


def snapshot(ele: str, abr: str) -> dict:
    return json.loads((SNAP / f'{ele}-0001-{abr}.json').read_text(encoding='utf-8'))


def ibge_de(ele: str) -> dict:
    """Codigo TSE (com zero a esquerda) -> IBGE, dos snapshots municipais."""
    saida = {}
    for arq in SNAP.glob(f'{ele}-0001-*.json'):
        uf = arq.stem.rsplit('-', 1)[1]
        if len(uf) == 2 and uf not in ('br', 'uf'):
            for cd, m in (json.loads(arq.read_text(encoding='utf-8')).get('mun') or {}).items():
                saida[cd] = m.get('ibge') or ''
    return saida


def primeiro_turno():
    """Locais de 2022 numa ordem sorteada. As secoes de cada municipio (do
    snapshot) sao repartidas entre os locais pelo voto; no exterior, que vem por
    pais, as do exterior inteiro."""
    locais = votos_por_local(2022, 1)
    chaves = list(locais)
    ufs = np.array([k[0] for k in chaves])
    munis = np.array([k[1] for k in chaves])
    nums = sorted({n for v in locais.values() for n in v},
                  key=lambda n: -sum(v.get(n, 0) for v in locais.values()))
    V = np.array([[locais[k].get(n, 0) for n in nums] for k in chaves], dtype=float)
    ordem = ordem_de_chegada(ufs, munis, V, nums, np.random.default_rng(1000), 0.0)

    cds, mi = np.unique(munis, return_inverse=True)
    uf_de = dict(zip(munis, ufs))
    tot = np.bincount(mi, weights=V.sum(axis=1), minlength=len(cds))
    abr = {}
    for arq in SNAP.glob('544-0001-*.json'):
        uf = arq.stem.rsplit('-', 1)[1]
        if len(uf) == 2 and uf not in ('br', 'uf', 'zz'):
            abr.update(json.loads(arq.read_text(encoding='utf-8'))['abr'])
    zz = snapshot('544', 'uf')['abr']['zz']
    tot_zz = tot[[uf_de[c] == 'zz' for c in cds]].sum()
    ibge = ibge_de('544')
    mun = []
    for j, cd in enumerate(cds):
        if uf_de[cd] == 'zz':
            ts, te = max(round(zz['ts'] * tot[j] / tot_zz), 1), zz['te'] * tot[j] / tot_zz
        else:
            e = abr[cd.zfill(5)]
            ts, te = e['ts'], e['te']
        # cd sem o zero: e a chave da base de 2018 (base_projecao.de_locais)
        mun.append({'cd': cd, 'uf': uf_de[cd], 'ibge': ibge.get(cd.zfill(5), ''), 'ts': ts, 'te': te})
    # local sem voto valido (pais em que os poucos eleitores anularam) ainda tem
    # secao: sem isto ela nunca chegava, e a noite nao fechava em 100%
    n_loc = np.bincount(mi, minlength=len(cds))
    parte = np.where(tot[mi] > 0, V.sum(axis=1) / np.maximum(tot[mi], 1), 1.0 / n_loc[mi])
    sec = np.array([mun[j]['ts'] for j in mi]) * parte
    return {'ele': '544', 'nums': nums, 'mun': mun, 'mi': mi, 'sec': sec, 'V': V,
            'ordem': ordem, 't': None, 'base': de_locais(2018, 1, ('13', '17'))}


def segundo_turno():
    """Urnas do 2o turno de 2022 na ordem em que os boletins chegaram ao TSE."""
    from noite_2022 import carregar as carregar_noite

    d = carregar_noite()
    munis = np.char.zfill(d['muni'], 5)
    cds, mi = np.unique(munis, return_inverse=True)
    uf_de = dict(zip(munis, d['uf']))
    ts = np.bincount(mi, minlength=len(cds))
    te = np.bincount(mi, weights=d['aptos'], minlength=len(cds))
    ibge = ibge_de('545')
    mun = [{'cd': cd, 'uf': str(uf_de[cd]), 'ibge': ibge.get(cd, ''), 'ts': int(ts[j]), 'te': float(te[j])}
           for j, cd in enumerate(cds)]
    V = np.column_stack([d['v13'], d['v22']]).astype(float)
    return {'ele': '545', 'nums': ['13', '22'], 'mun': mun, 'mi': mi, 'sec': np.ones(len(mi)), 'V': V,
            'ordem': np.argsort(d['t'], kind='stable'), 't': np.maximum(d['t'], 0.0), 'base': carregar_base()}


def noite(turno: int, cenarios: int) -> dict:
    n = primeiro_turno() if turno == 1 else segundo_turno()
    ele, nums, mun, mi, V, ordem = n['ele'], n['nums'], n['mun'], n['mi'], n['V'], n['ordem']
    M, K = len(mun), len(nums)
    acum = np.cumsum(n['sec'][ordem])
    sec_m = np.zeros(M)
    vot_m = np.zeros((M, K))
    st_ant = np.zeros(M, dtype=int)
    vot_ant = np.zeros((M, K), dtype=int)
    ts_m = np.array([m['ts'] for m in mun])
    feito = 0
    marcos = []
    t0 = time.time()
    for i, pct in enumerate(MARCOS):
        corte = len(ordem) if pct >= 100 else int(np.searchsorted(acum, pct / 100 * acum[-1]))
        novos = ordem[feito:corte]
        np.add.at(sec_m, mi[novos], n['sec'][novos])
        np.add.at(vot_m, mi[novos], V[novos])
        feito = corte
        # o municipio inteiro chegou so quando chegou o ultimo local dele
        st = np.minimum(np.round(sec_m).astype(int), np.round(ts_m).astype(int))
        vot = np.round(vot_m).astype(int)
        mudou = np.flatnonzero((st != st_ant) | (vot != vot_ant).any(axis=1))
        delta = np.column_stack([mudou, st[mudou] - st_ant[mudou], vot[mudou] - vot_ant[mudou]])
        st_ant, vot_ant = st, vot

        marco = {'pct': pct, 'd': delta.tolist()}
        if n['t'] is not None and corte:
            marco['min'] = round(float(n['t'][ordem[corte - 1]]), 1)
        if corte:
            unid = [{'cd': m['cd'], 'uf': m['uf'], 'te': m['te'], 'st': int(st[j]), 'ts': m['ts'],
                     'vv': float(vot[j].sum()), 'cand': {c: float(v) for c, v in zip(nums, vot[j]) if v}}
                    for j, m in enumerate(mun)]
            r = projetar(unid, n['base'], cenarios=cenarios, semente=i)
            r.pop('uf', None)
            r.pop('cenarios', None)
            marco['proj'] = r
        marcos.append(marco)
        print(f'  {turno}o turno {pct:5.1f}%  ({time.time() - t0:4.0f} s)', flush=True)

    br = snapshot(ele, 'br')
    uf = snapshot(ele, 'uf')['abr']
    total = V.sum(axis=0)
    return {
        'ele': ele, 'turno': turno, 'data': br['abr']['br']['dt'],
        'nums': nums,
        'dic': {c: br['cand'][c] for c in nums},
        'final': [round(float(v / total.sum()), 5) for v in total],
        'ufs': sorted({m['uf'] for m in mun}),
        # comparecimento, brancos e nulos por voto valido, da UF no fim da noite:
        # a pagina tira deles a participacao de cada instante
        'razao': {u: [round(e['comp'] / e['vv'], 5), round(e['vb'] / e['vv'], 5), round(e['vn'] / e['vv'], 5)]
                  for u, e in uf.items()},
        'mun': [[m['uf'], m['ibge'], round(m['ts'], 2), round(m['te'])] for m in mun],
        'marcos': marcos,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--cenarios', type=int, default=CENARIOS)
    ap.add_argument('--turno', type=int, choices=[1, 2])
    args = ap.parse_args()
    saida = json.loads(DESTINO.read_text(encoding='utf-8')) if DESTINO.exists() else {}
    for turno in ([args.turno] if args.turno else [1, 2]):
        saida[str(turno)] = noite(turno, args.cenarios)
    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    DESTINO.write_text(json.dumps(saida, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{DESTINO} ({DESTINO.stat().st_size / 1e6:.1f} MB)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
