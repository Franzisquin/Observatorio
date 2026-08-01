import sqlite3
import zipfile
import os
import json

with zipfile.ZipFile('resultados_geo/locais_votacao_2002_gkpg.zip') as z:
    gpkg_name = [f for f in z.namelist() if f.endswith('.gpkg')][0]
    z.extract(gpkg_name, 'scratch')

gpkg_path = os.path.join('scratch', gpkg_name)
conn = sqlite3.connect(gpkg_path)
c = conn.cursor()
c.execute("SELECT local_key, nm_localidade FROM locais_votacao_2002_padronizado WHERE sg_uf='PR'")
muni_map = {}
for local_key, nm_localidade in c.fetchall():
    parts = local_key.split('_')
    if len(parts) >= 2 and nm_localidade and parts[1] not in muni_map:
        muni_map[parts[1]] = nm_localidade
conn.close()

print('Unique municipalities in muni_map:', len(muni_map))
print('Sample muni_map:', list(muni_map.items())[:5])

with zipfile.ZipFile('resultados_geo/Majoritarias 2002/presidente_2002_t1_PR.zip') as z:
    with z.open('presidente_2002_t1_PR.json') as f:
        data = json.load(f)

results = data.get('RESULTS', {})
raw_totals_by_city = {}
for k, v_map in results.items():
    parts = k.split('_')
    if len(parts) < 3: continue
    cd_muni = parts[1]
    city_name = muni_map.get(cd_muni)
    if not city_name: continue
    if city_name not in raw_totals_by_city: raw_totals_by_city[city_name] = {}
    for cid, v in v_map.items():
        raw_totals_by_city[city_name][cid] = raw_totals_by_city[city_name].get(cid, 0) + v

print('Cities built in raw_totals_by_city:', len(raw_totals_by_city))
print('Sample city keys:', list(raw_totals_by_city.keys())[:10])
