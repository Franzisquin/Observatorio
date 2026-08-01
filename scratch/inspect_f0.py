import zipfile
import json

with zipfile.ZipFile('resultados_geo/resultados_presidente_nacional_2022.zip') as z:
    with z.open('resultados_presidente_nacional_2022.geojson') as f:
        data_2022 = json.load(f)

f0 = data_2022['features'][0]['properties']
print("Feature 0 props keys:", list(f0.keys()))
print("Feature 0 sample values:", f0)
