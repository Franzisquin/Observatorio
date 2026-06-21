import zipfile
import json
import sqlite3
import os

# 1. Load results keys from 1998 presidente AC
res_zip = 'resultados_geo/Majoritarias 1998/presidente_1998_t1_AC.zip'
with zipfile.ZipFile(res_zip) as z:
    name = z.namelist()[0]
    data = json.loads(z.read(name).decode('utf-8'))
    results_keys = list(data['RESULTS'].keys())

print('Total 1998 results keys:', len(results_keys))
geolocated_keys = [k for k in results_keys if '_S' not in k]
print('Geolocated 1998 keys:', len(geolocated_keys))

# 2. Connect to 2006 locales gpkg
conn = sqlite3.connect('scratch/locais_votacao_2006.gpkg')
cursor = conn.cursor()

# Load all 2006 locales for AC
cursor.execute("SELECT nr_zona, nr_locvot, nm_locvot FROM locais_votacao_2006_padronizado WHERE sg_uf='AC'")
locales_2006 = {}
for nr_zona, nr_locvot, nm_locvot in cursor.fetchall():
    try:
        locales_2006[(int(nr_zona), int(nr_locvot))] = nm_locvot
    except ValueError:
        pass

conn.close()
print('Total locales in 2006 for AC:', len(locales_2006))

# Match
matched = 0
for key in geolocated_keys:
    parts = key.split('_')
    if len(parts) == 3:
        z, c, l = int(parts[0]), int(parts[1]), int(parts[2])
        if (z, l) in locales_2006:
            matched += 1
        else:
            if matched < 5:
                print('Unmatched key:', key, '-> (z, l) =', (z, l))

print('Matched keys:', matched, 'out of', len(geolocated_keys), f'({matched/len(geolocated_keys)*100:.2f}%)')
