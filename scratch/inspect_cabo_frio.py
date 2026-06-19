import zipfile
import sqlite3
import json
import os

# 1. Load Cabo Frio 2000 Prefeito JSON RESULTS
zip_json_path = 'resultados_geo/Municipais 2000/prefeito_2000_ord_t1_RJ.zip'
with zipfile.ZipFile(zip_json_path, 'r') as z:
    json_data = json.loads(z.read('58130_CABO_FRIO.json'))

json_results = json_data.get('RESULTS', {})
print(f"Total location keys in JSON: {len(json_results)}")

# 2. Extract and connect to 2006 GPKG database
gpkg_zip_path = 'resultados_geo/locais_votacao_2006_gkpg.zip'
extracted_gpkg = 'resultados_geo/locais_votacao_2006.gpkg'

if not os.path.exists(extracted_gpkg):
    print("Extracting GPKG...")
    with zipfile.ZipFile(gpkg_zip_path, 'r') as z:
        z.extract('locais_votacao_2006.gpkg', 'resultados_geo')

conn = sqlite3.connect(extracted_gpkg)
cursor = conn.cursor()

# Query locations in Cabo Frio (localidades corresponding to Cabo Frio)
cursor.execute("""
    SELECT nr_zona, nr_locvot, nm_locvot, ds_bairro, long, lat 
    FROM locais_votacao_2006_padronizado 
    WHERE sg_uf = 'RJ' AND UPPER(nm_localidade) = 'CABO FRIO'
""")
gpkg_locations = cursor.fetchall()
print(f"Total locations in GPKG for Cabo Frio: {len(gpkg_locations)}")

# Let's see how many JSON keys match GPKG locations
matched = 0
unmatched_json_keys = []
for key in json_results.keys():
    # Key format in 2000 is usually: zona_muni_local
    parts = key.split('_')
    if len(parts) == 3:
        zona = int(parts[0])
        muni = int(parts[1])
        local = int(parts[2])
        # Find in gpkg
        found = False
        for loc in gpkg_locations:
            if int(loc[0]) == zona and int(loc[1]) == local:
                found = True
                break
        if found:
            matched += 1
        else:
            unmatched_json_keys.append(key)
    else:
        unmatched_json_keys.append(key)

print(f"Matched JSON keys to GPKG: {matched} / {len(json_results)}")
print("Unmatched JSON keys:", unmatched_json_keys)

conn.close()
