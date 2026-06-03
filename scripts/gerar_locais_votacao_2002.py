"""
Gera locais_votacao_2002_gkpg.zip contendo um banco SQLite (GeoPackage)
com as localizacoes aproximadas dos locais de votacao de 2002.

Como nao existem coordenadas reais para 2002, cada local de votacao e
posicionado no centroide do seu municipio (granularidade municipal).

A tabela segue o mesmo esquema usado em locais_votacao_2006_padronizado,
com o campo extra `local_key` pre-calculado.

Saida: resultados_geo/locais_votacao_2002_gkpg.zip
"""

import os
import json
import zipfile
import sqlite3
import tempfile
import unicodedata
import re

import pandas as pd

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'Resultados 2002')
GEO_DIR  = os.path.join(BASE_DIR, 'resultados_geo')
OUT_ZIP  = os.path.join(GEO_DIR, 'locais_votacao_2002_gkpg.zip')

ALL_UFS = [
    'AC','AL','AM','AP','BA','CE','DF','ES','GO',
    'MA','MG','MS','MT','PA','PB','PE','PI','PR',
    'RJ','RN','RO','RR','RS','SC','SE','SP','TO',
]


def strip_accents(s):
    return ''.join(
        c for c in unicodedata.normalize('NFD', str(s or ''))
        if unicodedata.category(c) != 'Mn'
    )


def norm_name(s):
    return re.sub(r'\s+', ' ', strip_accents(str(s or '')).upper()).strip()


def load_municipality_centroids():
    """
    Carrega centroides de todos os municipios a partir dos GeoJSONs de municipios_hd.
    Retorna dict: norm_name(NM_MUN) -> (long, lat)
    """
    muni_dir = os.path.join(GEO_DIR, 'municipios_hd')
    centroids = {}  # norm_name -> (long, lat)

    for fn in os.listdir(muni_dir):
        if not fn.startswith('municipios_') or not fn.endswith('.geojson'):
            continue
        fpath = os.path.join(muni_dir, fn)
        with open(fpath, 'r', encoding='utf-8') as f:
            data = json.load(f)

        for feat in data.get('features', []):
            nm = feat['properties'].get('NM_MUN', '')
            geom = feat.get('geometry', {})
            if not geom or not nm:
                continue

            lon, lat = compute_centroid(geom)
            if lon is None:
                continue

            key = norm_name(nm)
            # Em caso de duplicata, mantem o primeiro encontrado
            if key not in centroids:
                centroids[key] = (lon, lat)

    print(f'  Centroides de municipios carregados: {len(centroids)}')
    return centroids


def compute_centroid(geom):
    """Calcula centroide simples de Polygon ou MultiPolygon."""
    gtype = geom.get('type', '')
    coords = geom.get('coordinates', [])

    all_points = []

    if gtype == 'Polygon':
        ring = coords[0] if coords else []
        all_points = ring
    elif gtype == 'MultiPolygon':
        for poly in coords:
            ring = poly[0] if poly else []
            all_points.extend(ring)
    else:
        return None, None

    if not all_points:
        return None, None

    lons = [p[0] for p in all_points]
    lats = [p[1] for p in all_points]
    return sum(lons) / len(lons), sum(lats) / len(lats)


def collect_voting_locals():
    """
    Extrai combinacoes unicas de (SG_UF, NR_ZONA, CD_MUNICIPIO, NM_MUNICIPIO, NR_LOCAL_VOTACAO)
    dos parquets de secao.
    """
    records = []

    for uf in ALL_UFS:
        parquet_path = os.path.join(DATA_DIR, f'votacao_secao_2002_{uf}.parquet')
        if not os.path.exists(parquet_path):
            continue

        df = pd.read_parquet(parquet_path, columns=[
            'SG_UF', 'NR_ZONA', 'CD_MUNICIPIO', 'NM_MUNICIPIO', 'NR_LOCAL_VOTACAO'
        ])

        uniq = df.drop_duplicates().copy()
        uniq['NR_ZONA'] = uniq['NR_ZONA'].astype(int)
        uniq['CD_MUNICIPIO'] = uniq['CD_MUNICIPIO'].astype(int)
        uniq['NR_LOCAL_VOTACAO'] = uniq['NR_LOCAL_VOTACAO'].astype(int)
        records.append(uniq)
        print(f'  {uf}: {len(uniq)} locais unicos')

    if not records:
        return pd.DataFrame()

    return pd.concat(records, ignore_index=True).drop_duplicates()


def create_gpkg(df_locals, centroids, gpkg_path):
    """Cria o arquivo SQLite/GPKG."""
    conn = sqlite3.connect(gpkg_path)
    cur = conn.cursor()

    cur.execute('''
        CREATE TABLE locais_votacao_2002_padronizado (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            sg_uf      TEXT,
            nr_zona    INTEGER,
            nr_locvot  INTEGER,
            nm_localidade TEXT,
            nm_locvot  TEXT,
            ds_endereco TEXT,
            ds_bairro  TEXT,
            long       REAL,
            lat        REAL,
            local_key  TEXT,
            tipo_match TEXT
        )
    ''')
    cur.execute('CREATE INDEX idx_uf ON locais_votacao_2002_padronizado (sg_uf)')
    cur.execute('CREATE INDEX idx_lk ON locais_votacao_2002_padronizado (local_key)')

    matched = 0
    unmatched_munis = set()

    rows_to_insert = []
    for _, row in df_locals.iterrows():
        sg_uf = str(row['SG_UF'])
        nr_zona = int(row['NR_ZONA'])
        cd_muni = int(row['CD_MUNICIPIO'])
        nm_muni = str(row['NM_MUNICIPIO'])
        nr_locvot = int(row['NR_LOCAL_VOTACAO'])

        local_key = f'{nr_zona}_{cd_muni}_{nr_locvot}'

        # Procura centroide pelo nome normalizado
        key = norm_name(nm_muni)
        coord = centroids.get(key)

        if coord is None:
            unmatched_munis.add((sg_uf, nm_muni))
            lon, lat = None, None
        else:
            lon, lat = coord
            matched += 1

        rows_to_insert.append((
            sg_uf, nr_zona, nr_locvot,
            nm_muni, '',  # nm_locvot vazio
            '', '',       # ds_endereco, ds_bairro
            lon, lat, local_key, 'municipality_centroid'
        ))

    cur.executemany('''
        INSERT INTO locais_votacao_2002_padronizado
        (sg_uf, nr_zona, nr_locvot, nm_localidade, nm_locvot,
         ds_endereco, ds_bairro, long, lat, local_key, tipo_match)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', rows_to_insert)

    conn.commit()
    conn.close()

    total = len(rows_to_insert)
    print(f'  {matched}/{total} locais com coordenadas.')
    if unmatched_munis:
        print(f'  {len(unmatched_munis)} municipios sem centroide:')
        for uf, nm in sorted(unmatched_munis)[:20]:
            print(f'    {uf}: {nm}')
        if len(unmatched_munis) > 20:
            print(f'    ... e mais {len(unmatched_munis)-20}')


def main():
    print('Coletando locais de votacao dos parquets...')
    df_locals = collect_voting_locals()
    print(f'Total de locais unicos: {len(df_locals)}')

    print('\nCarregando centroides de municipios...')
    centroids = load_municipality_centroids()

    print('\nCriando banco SQLite...')
    with tempfile.NamedTemporaryFile(suffix='.gpkg', delete=False) as tmp:
        gpkg_path = tmp.name

    create_gpkg(df_locals, centroids, gpkg_path)

    print(f'\nEmpacotando em {OUT_ZIP}...')
    with zipfile.ZipFile(OUT_ZIP, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.write(gpkg_path, 'locais_votacao_2002.gpkg')

    os.unlink(gpkg_path)
    print('Concluido!')


if __name__ == '__main__':
    main()
