import json
import zipfile
import sqlite3
import os

z = zipfile.ZipFile('resultados_geo/locais_votacao_2022_gpkg.zip')
z.extract('locais_votacao_2022.gpkg', 'scratch')
db_path = os.path.join('scratch', 'locais_votacao_2022.gpkg')

conn = sqlite3.connect(db_path)
c = conn.cursor()
c.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [r[0] for r in c.fetchall()]
print("Tables in GPKG 2022:", tables)

table_name = [t for t in tables if not t.startswith('gpkg_') and not t.startswith('sqlite_')][0]
print("Using table:", table_name)

ufs = ['SP', 'RJ', 'MG', 'PR', 'RS', 'BA', 'PE', 'CE', 'AL']

for uf in ufs:
    poly_path = f'resultados_geo/municipios_hd/municipios_{uf}.geojson'
    if not os.path.exists(poly_path):
        poly_path = f'resultados_geo/municipios/municipios_{uf}.geojson'

    with open(poly_path, encoding='utf-8') as f:
        poly_geo = json.load(f)

    c.execute(f"SELECT cod_localidade_ibge, nm_localidade FROM {table_name} WHERE sg_uf=?", (uf,))
    rows = c.fetchall()

    code_map = {}
    for ibge, city in rows:
        if ibge and city:
            code_str = str(ibge).strip()
            code_map[code_str] = city
            if len(code_str) > 6:
                code_map[code_str[:6]] = city

    resolved = 0
    for feat in poly_geo['features']:
        props = feat['properties']
        cd_mun = str(props.get('CD_MUN') or props.get('codarea') or '').strip()
        name = code_map.get(cd_mun) or code_map.get(cd_mun[:6])
        if name:
            resolved += 1

    print(f"UF {uf}: Resolved {resolved} / {len(poly_geo['features'])} polygon names ({resolved/len(poly_geo['features'])*100:.1f}%)")

conn.close()
