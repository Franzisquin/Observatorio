import json
import sqlite3
import os
import zipfile

# Load PR GeoJSON features
with open('resultados_geo_backup/municipios_hd/municipios_PR.geojson', encoding='utf-8') as f:
    geo = json.load(f)

geo_by_ibge = {}
geo_by_name = {}
for feat in geo['features']:
    props = feat['properties']
    ibge = str(props['CD_MUN'])
    geo_by_ibge[ibge] = props['NM_MUN']
    geo_by_ibge[ibge[:6]] = props['NM_MUN']
    geo_by_name[props['NM_MUN'].upper()] = ibge

gpkg_path = os.path.join('scratch', 'locais_votacao_2006.gpkg')
conn = sqlite3.connect(gpkg_path)
c = conn.cursor()

tse_to_ibge = {}
tse_to_name = {}

# In 2006 GPKG, let's see how local_key or zona/muni is stored
c.execute("SELECT nr_zona, cod_localidade_ibge, nm_localidade FROM locais_votacao_2006_padronizado WHERE sg_uf='PR'")
# Let's check how many cities are matched by IBGE or by Name
for row in c.fetchall():
    ibge = str(row[1]) if row[1] else ""
    name = row[2]
    # We can match name to GeoJSON directly
    if name and name.upper() in geo_by_name:
        matched_ibge = geo_by_name[name.upper()]

# Load 2002 PR JSON results
with zipfile.ZipFile('resultados_geo/Majoritarias 2002/presidente_2002_t1_PR.zip') as z:
    with z.open('presidente_2002_t1_PR.json') as f:
        data_2002 = json.load(f)

city_tse_codes = set()
for k in data_2002.get('RESULTS', {}).keys():
    parts = k.split('_')
    if len(parts) >= 3:
        city_tse_codes.add(parts[1])

print(f"2002 PR Total TSE cities: {len(city_tse_codes)}")
