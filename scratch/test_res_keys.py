import zipfile
import json

with zipfile.ZipFile('resultados_geo/resultados_presidente_nacional_2022.zip') as z:
    for name in z.namelist():
        if name.endswith('.json'):
            with z.open(name) as f:
                data = json.load(f)
                keys = list(data.get('RESULTS', {}).keys())
                print("JSON file:", name, "total RESULTS keys:", len(keys))
                print("Sample RESULTS keys:", keys[:5])
