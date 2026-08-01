import zipfile
import json

with zipfile.ZipFile('resultados_geo/resultados_presidente_nacional_2022.zip') as z:
    with z.open('resultados_presidente_nacional_2022.geojson') as f:
        data_2022_geo = json.load(f)

# Inspect feature properties
f0 = data_2022_geo['features'][0]['properties']
print("GeoJSON feature 0 props:", f0.get('id_unico'), f0.get('local_key'), f0.get('local_id'), f0.get('nr_zona'), f0.get('nr_locvot'))

# Inspect JSON RESULTS keys in majoritaria 2022
with zipfile.ZipFile('resultados_geo/resultados_presidente_nacional_2022.zip') as z:
    for name in z.namelist():
        if name.endswith('.json'):
            with z.open(name) as f:
                res_json = json.load(f)
                keys = list(res_json.get('RESULTS', {}).keys())
                print(f"JSON '{name}' sample RESULTS keys:", keys[:5])
                break
