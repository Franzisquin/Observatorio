import sqlite3
import os
import json
import zipfile

gpkg_path = os.path.join('scratch', 'locais_votacao_2006.gpkg')
conn = sqlite3.connect(gpkg_path)
c = conn.cursor()

# Get 2002 PR JSON
with zipfile.ZipFile('resultados_geo/Majoritarias 2002/presidente_2002_t1_PR.zip') as z:
    with z.open('presidente_2002_t1_PR.json') as f:
        data_2002 = json.load(f)

# Get 2006 GPKG rows for PR
c.execute("SELECT nr_zona, cod_localidade_ibge, nm_localidade FROM locais_votacao_2006_padronizado WHERE sg_uf='PR'")
rows = c.fetchall()

# In 2002 results, keys are ZONA_CDMUNI_LOCAL
# Let's see how many 2002 keys find a matching TSE muni code in 2006 GPKG or Censo 2006
tse_to_ibge = {}
tse_to_name = {}

# Also load Censo 2006 PR
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

# Now tally IBGE codes from 2006 GPKG:
# Need TSE muni code from 2006 GPKG rows
# In 2006 GPKG, local_key or properties link zona and local.
# Let's inspect 2006 GPKG rows for how to get TSE muni code
