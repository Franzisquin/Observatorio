# -*- coding: utf-8 -*-
"""
A noite de verdade do 2o turno de 2022, secao por secao, a partir dos boletins
de urna do TSE — o unico arquivo publico com a hora em que cada boletim chegou
(DT_BU_RECEBIDO). Serve para testar a projecao (testar_projecao.py --real) com a
ordem de chegada que a noite teve, e nao com uma sorteada.

Os boletins (66 MB, 28 zips) nao vao para o repositorio. Baixe-os em
scratch/bweb/ com:

  py scripts/apuracao/noite_2022.py --baixar

O resumo por secao fica em scratch/bweb/noite_2022_2t.npz (hora de chegada em
minutos depois das 17h, UF, municipio, aptos e votos de Lula, Bolsonaro, brancos
e nulos). A virada do placar reconstruida tem de cair em 67,76% das urnas, a hora
em que Lula passou Bolsonaro na noite real.
"""

from __future__ import annotations

import csv
import io
import sys
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path

import numpy as np

RAIZ = Path(__file__).resolve().parent.parent.parent
PASTA = RAIZ / 'scratch' / 'bweb'
RESUMO = PASTA / 'noite_2022_2t.npz'
URL = 'https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes2022/buweb/bweb_2t_{uf}_311020221535.zip'
UFS = ('ac al am ap ba ce df es go ma mg ms mt pa pb pe pi pr rj rn ro rr rs sc se sp to zz').split()
ZERO = datetime(2022, 10, 30, 17, 0, 0)


def baixar() -> None:
    PASTA.mkdir(parents=True, exist_ok=True)
    for uf in UFS:
        destino = PASTA / f'bweb_2t_{uf.upper()}.zip'
        if not destino.exists() or destino.stat().st_size == 0:
            urllib.request.urlretrieve(URL.format(uf=uf.upper()), destino)
            print('baixado', destino.name)


def ler() -> dict:
    """Uma linha por secao: so o cargo de presidente."""
    secoes = {}
    for uf in UFS:
        arq = PASTA / f'bweb_2t_{uf.upper()}.zip'
        with zipfile.ZipFile(arq) as z:
            nome = [n for n in z.namelist() if n.endswith('.csv')][0]
            with z.open(nome) as f:
                for lin in csv.DictReader(io.TextIOWrapper(f, encoding='latin-1'), delimiter=';'):
                    if lin['CD_CARGO_PERGUNTA'] != '1':
                        continue
                    chave = (uf, lin['CD_MUNICIPIO'], lin['NR_ZONA'], lin['NR_SECAO'])
                    s = secoes.get(chave)
                    if s is None:
                        t = datetime.strptime(lin['DT_BU_RECEBIDO'], '%d/%m/%Y %H:%M:%S')
                        s = secoes[chave] = {'t': (t - ZERO).total_seconds() / 60.0,
                                             'aptos': int(lin['QT_APTOS']), 'v': {}}
                    num = lin['NR_VOTAVEL']
                    s['v'][num] = s['v'].get(num, 0) + int(lin['QT_VOTOS'])
        print(f'  {uf}: {len(secoes):,} secoes ate aqui', flush=True)
    return secoes


def gravar_resumo() -> None:
    secoes = ler()
    chaves = list(secoes)
    np.savez_compressed(
        RESUMO,
        uf=np.array([k[0] for k in chaves]),
        muni=np.array([k[1] for k in chaves]),
        zona=np.array([int(k[2]) for k in chaves]),
        t=np.array([secoes[k]['t'] for k in chaves]),
        aptos=np.array([secoes[k]['aptos'] for k in chaves]),
        v13=np.array([secoes[k]['v'].get('13', 0) for k in chaves]),
        v22=np.array([secoes[k]['v'].get('22', 0) for k in chaves]),
        vb=np.array([secoes[k]['v'].get('95', 0) for k in chaves]),
        vn=np.array([secoes[k]['v'].get('96', 0) for k in chaves]),
    )
    print(f'{len(chaves):,} secoes -> {RESUMO}')


def carregar() -> dict:
    d = np.load(RESUMO)
    return {k: d[k] for k in d.files}


def virada(d) -> float:
    """Percentual de urnas em que Lula passa Bolsonaro no placar e nao sai mais."""
    ordem = np.argsort(d['t'], kind='stable')
    a, b = np.cumsum(d['v13'][ordem]), np.cumsum(d['v22'][ordem])
    atras = np.flatnonzero(a <= b)
    i = atras[-1] + 1 if len(atras) else 0
    return 100.0 * (i + 1) / len(ordem), float(d['t'][ordem][min(i, len(ordem) - 1)])


if __name__ == '__main__':
    if '--baixar' in sys.argv:
        baixar()
    if not RESUMO.exists():
        gravar_resumo()
    d = carregar()
    pct, t = virada(d)
    h = ZERO.hour + int(t // 60)
    print(f'{len(d["t"]):,} secoes | virada do placar em {pct:.2f}% das urnas, '
          f'as {h}h{int(t % 60):02d} (real: 67,76%, 18h44)')
