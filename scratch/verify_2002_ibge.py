import json
import sqlite3
import os
import zipfile

# Load PR GeoJSON features
with open('resultados_geo_backup/municipios_hd/municipios_PR.geojson', encoding='utf-8') as f:
    geo = json.load(f)

geo_by_ibge = {}
for feat in geo['features']:
    props = feat['properties']
    ibge = str(props['CD_MUN'])
    geo_by_ibge[ibge] = props['NM_MUN']
    geo_by_ibge[ibge[:6]] = props['NM_MUN']

# Get 2006 GPKG rows for PR to build tse -> ibge map
gpkg_path = os.path.join('scratch', 'locais_votacao_2006.gpkg')
conn = sqlite3.connect(gpkg_path)
c = conn.cursor()
c.execute("SELECT nr_zona, cod_localidade_ibge, nm_localidade FROM locais_votacao_2006_padronizado WHERE sg_uf='PR'")

tse_to_ibge = {}
tse_to_name = {}

# In 2006 GPKG, local_key is formed from zona and local. But we can also read censo 2006
with zipfile.ZipFile('resultados_geo/Censo 2006/censo_2006_PR.zip') as z:
    with z.open('censo_2006_PR.json') as f:
        censo_2006 = json.load(f)

for k, v in censo_2006.get('RESULTS', {}).items():
    parts = k.split('_')
    if len(parts) >= 2:
        cd_tse = parts[1]
        name = v.get('nm_localidade')
        if cd_tse and name and cd_tse not in tse_to_name:
            tse_to_name[cd_tse] = name

# Now read 2006 GPKG rows and tally IBGE for each TSE code
# In 2006 GPKG:
c.execute("SELECT nr_zona, cod_localidade_ibge, nm_localidade FROM locais_votacao_2006_padronizado WHERE sg_uf='PR'")
for row in c.fetchall():
    ibge = str(row[1]) if row[1] else ""
    name = row[2]
    # match name with censo to find TSE code or match directly
    if ibge and name:
        # find cd_tse in tse_to_name matching name
        for cd, nm in tse_to_name.items():
            if nm == name:
                tse_to_ibge[cd] = ibge
                break

conn.close()

# Now check 2002 PR JSON results
with zipfile.ZipFile('resultados_geo/Majoritarias 2002/presidente_2002_t1_PR.zip') as z:
    with z.open('presidente_2002_t1_PR.json') as f:
        data_2002 = json.load(f)

city_tse_codes = set()
for k in data_2002.get('RESULTS', {}).keys():
    parts = k.split('_')
    if len(parts) >= 3:
        city_tse_codes.add(parts[1])

matched_ibge = 0
unmatched = []
for cd in city_tse_codes:
    ibge = tse_to_ibge.get(cd, "")
    if ibge and (ibge in geo_by_ibge or ibge[:6] in geo_by_ibge):
        matched_ibge += 1
    else:
        unmatched.append((cd, tse_to_name.get(cd)))

print(f"2002 PR Total TSE cities: {len(city_tse_codes)}")
print(f"2002 PR Matched by IBGE: {matched_ibge} / {len(city_tse_codes)}")
print(f"Unmatched: {len(unmatched)}: {unmatched[:5]}")
