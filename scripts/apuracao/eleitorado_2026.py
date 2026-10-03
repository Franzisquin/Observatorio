"""Eleitorado de 2026 por Brasil, UF, municipio e zona — dos locais de votacao.

A participacao da lateral (paginas de estado e de zonas) fica a mostra antes
da primeira urna, com o eleitorado e o resto em zero. O arquivo do TSE so traz
o eleitorado com o primeiro boletim; antes disso, ele sai daqui: a soma dos
eleitores aptos (QT_ELEIT) dos locais de votacao de 2026, os com coordenada e os
sem.

    py scripts/apuracao/eleitorado_2026.py

Saida, resultados_geo/eleitorado_2026.json:
    {"br": n, "uf": {"sp": n}, "mun": {"<IBGE>": n},
     "zona": {"<IBGE>": {"0001": n}}}   (zona: so as cidades com mapa por zona)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent.parent
LOCAIS = RAIZ / 'scratch' / 'locais_votacao_2026'
SAIDA = RAIZ / 'resultados_geo' / 'eleitorado_2026.json'
ZONAS = RAIZ / 'resultados_geo' / 'zonas_svg' / 'indice.json'


def main() -> int:
    cols = ['SG_UF', 'CD_IBGE', 'NR_ZONA', 'QT_ELEIT']
    com = gpd.read_file(LOCAIS / 'locais_votacao_2026.gpkg', columns=cols, ignore_geometry=True)
    sem = pd.read_csv(LOCAIS / 'locais_sem_coordenadas_2026.csv', dtype=str, encoding='utf-8-sig')[cols]
    loc = pd.concat([com.astype(str), sem.astype(str)])
    loc['QT_ELEIT'] = pd.to_numeric(loc['QT_ELEIT'], errors='coerce').fillna(0).astype(int)
    loc['NR_ZONA'] = pd.to_numeric(loc['NR_ZONA'], errors='coerce').fillna(0).astype(int)
    loc['SG_UF'] = loc['SG_UF'].str.lower()
    pais = loc[loc['SG_UF'] != 'zz']

    com_zonas = {c['ibge'] for c in json.loads(ZONAS.read_text(encoding='utf-8'))['cidades']}
    zona = {}
    for (ibge, z), n in pais[pais['CD_IBGE'].isin(com_zonas)].groupby(['CD_IBGE', 'NR_ZONA'])['QT_ELEIT'].sum().items():
        zona.setdefault(ibge, {})[f'{int(z):04d}'] = int(n)

    saida = {
        'fonte': 'Locais de votacao de 2026 (TSE), soma de QT_ELEIT',
        'br': int(loc['QT_ELEIT'].sum()),
        'uf': {uf: int(n) for uf, n in loc.groupby('SG_UF')['QT_ELEIT'].sum().items()},
        'mun': {ibge: int(n) for ibge, n in pais.groupby('CD_IBGE')['QT_ELEIT'].sum().items()},
        'zona': zona,
    }
    SAIDA.write_text(json.dumps(saida, separators=(',', ':')), encoding='utf-8')
    print(f"Brasil {saida['br']:,} | {len(saida['uf'])} UFs | {len(saida['mun']):,} municipios | "
          f"{sum(len(v) for v in zona.values())} zonas -> {SAIDA.relative_to(RAIZ)} "
          f"({SAIDA.stat().st_size / 1024:.0f} KB)".replace(',', '.'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
