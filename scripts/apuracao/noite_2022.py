# -*- coding: utf-8 -*-
"""
A noite de verdade de 2022, secao por secao, a partir dos boletins de urna do
TSE — o unico arquivo publico com a hora em que cada boletim chegou
(DT_BU_RECEBIDO). Serve para testar a projecao (testar_projecao.py --real) e
para o replay (replay_2022.py) com a ordem de chegada que a noite teve, e nao
com uma sorteada.

Le os parquets de `sequencia_2022.py --converter` (scratch/bweb/2022_t{1,2}/):
uma secao por linha, com a hora de chegada, os aptos e os votos nominais de
presidente de cada numero. A virada do placar reconstruida tem de cair onde a
noite real a teve: perto de 68% das urnas nos dois turnos (no 2o, 67,76%, as
18h44).

  py scripts/apuracao/noite_2022.py --turno 1
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sequencia_2022 import ZERO, banco, minutos_desde, parquet  # noqa: E402


def carregar(turno: str = '2') -> dict:
    """Uma secao por linha: t (minutos depois das 17h), uf, muni (codigo TSE com
    5 digitos, como nos snapshots), aptos e V, os votos nominais de presidente de
    cada numero de `numeros`, do mais ao menos votado."""
    turno = str(turno)
    con = banco()
    votos = parquet(turno, 'votos')
    nums = [r[0] for r in con.execute(f"""
        SELECT votavel FROM read_parquet('{votos}') WHERE cargo = 1 AND tipo = 1
        GROUP BY votavel ORDER BY sum(votos) DESC""").fetchall()]
    colunas = ', '.join(f'sum(votos) FILTER (WHERE votavel = {n}) AS v{n}' for n in nums)
    d = con.execute(f"""
        WITH v AS (SELECT mun, zona, secao, {colunas} FROM read_parquet('{votos}')
                   WHERE cargo = 1 AND tipo = 1 GROUP BY mun, zona, secao)
        SELECT lower(s.uf) AS uf, lpad(CAST(s.mun AS VARCHAR), 5, '0') AS muni,
               {minutos_desde(turno, 's.recebido')} AS t, s.aptos,
               {', '.join(f'coalesce(v.v{n}, 0) AS v{n}' for n in nums)}
        FROM read_parquet('{parquet(turno, 'secoes')}') s LEFT JOIN v USING (mun, zona, secao)
        WHERE s.recebido IS NOT NULL
        ORDER BY s.uf, s.mun, s.zona, s.secao""").fetchnumpy()
    saida = {'uf': np.asarray(d['uf'], dtype=str), 'muni': np.asarray(d['muni'], dtype=str),
             't': np.asarray(d['t'], dtype=float), 'aptos': np.asarray(d['aptos'], dtype=float),
             'numeros': [str(n) for n in nums],
             'V': np.column_stack([np.asarray(d[f'v{n}'], dtype=float) for n in nums])}
    for n in ('13', '22'):
        saida[f'v{n}'] = saida['V'][:, saida['numeros'].index(n)]
    return saida


def virada(d) -> tuple[float, float]:
    """Percentual de urnas em que Lula passa Bolsonaro no placar e nao sai mais,
    e o minuto (depois das 17h) em que isso aconteceu."""
    ordem = np.argsort(d['t'], kind='stable')
    a, b = np.cumsum(d['v13'][ordem]), np.cumsum(d['v22'][ordem])
    atras = np.flatnonzero(a <= b)
    i = atras[-1] + 1 if len(atras) else 0
    return 100.0 * (i + 1) / len(ordem), float(d['t'][ordem][min(i, len(ordem) - 1)])


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--turno', choices=['1', '2'], default='2')
    turno = ap.parse_args().turno
    d = carregar(turno)
    pct, t = virada(d)
    h = ZERO[turno].hour + int(t // 60)
    print(f'{turno}o turno: {len(d["t"]):,} secoes, {len(d["numeros"])} numeros | virada do placar '
          f'em {pct:.2f}% das urnas, as {h}h{int(t % 60):02d}'.replace(',', '.'))
