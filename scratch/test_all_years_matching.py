import json
import sqlite3
import zipfile
import os
import re

def norm(text):
    if not text: return ""
    text = text.upper()
    # remove accents
    replacements = {
        'Á':'A', 'À':'A', 'Â':'A', 'Ã':'A', 'Ä':'A',
        'É':'E', 'È':'E', 'Ê':'E', 'Ë':'E',
        'Í':'I', 'Ì':'I', 'Î':'I', 'Ï':'I',
        'Ó':'O', 'Ò':'O', 'Ô':'O', 'Õ':'O', 'Ö':'O',
        'Ú':'U', 'Ù':'U', 'Û':'U', 'Ü':'U',
        'Ç':'C', 'Ñ':'N'
    }
    for k, v in replacements.items():
        text = text.replace(k, v)
    text = re.sub(r'[^A-Z0-9]', '', text)
    return text

# Load PR GeoJSON cities
with open('resultados_geo_backup/municipios_hd/municipios_PR.geojson', encoding='utf-8') as f:
    geo = json.load(f)

geo_cities = []
for feat in geo['features']:
    props = feat['properties']
    geo_cities.append({
        'name': props['NM_MUN'],
        'norm': norm(props['NM_MUN']),
        'ibge': str(props['CD_MUN'])
    })

print(f"Loaded {len(geo_cities)} municipalities from PR GeoJSON")

# 1. Check 2002 GPKG table
with zipfile.ZipFile('resultados_geo/locais_votacao_2002_gkpg.zip') as z:
    gpkg_name = [f for f in z.namelist() if f.endswith('.gpkg')][0]
    z.extract(gpkg_name, 'scratch')

gpkg_path = os.path.join('scratch', gpkg_name)
conn = sqlite3.connect(gpkg_path)
c = conn.cursor()
c.execute("SELECT local_key, nm_localidade FROM locais_votacao_2002_padronizado WHERE sg_uf='PR'")
muni_2002 = {}
for lkey, name in c.fetchall():
    parts = lkey.split('_')
    if len(parts) >= 2 and parts[1] not in muni_2002:
        muni_2002[parts[1]] = name
conn.close()

unmatched_2002 = 0
for cd_tse, name in muni_2002.items():
    n = norm(name)
    matched = any(g['norm'] == n for g in geo_cities)
    if not matched:
        unmatched_2002 += 1
        if unmatched_2002 <= 10:
            print(f"2002 Unmatched TSE {cd_tse}: '{name}' (norm: '{n}')")

print(f"2002 total unmatched cities: {unmatched_2002} / {len(muni_2002)}")
