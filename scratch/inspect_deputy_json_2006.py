import json
import zipfile
import os

zip_path = r"c:\mapas\Observatorio\resultados_geo\Legislativas 2006\deputados_federal_2006_RO.zip"
if os.path.exists(zip_path):
    with zipfile.ZipFile(zip_path, 'r') as z:
        for name in z.namelist():
            if name.endswith('.json'):
                print("JSON file name:", name)
                with z.open(name) as f:
                    data = json.load(f)
                results = data.get("RESULTS", {})
                print("Number of results:", len(results))
                print("First 10 keys in RESULTS:")
                for k in list(results.keys())[:10]:
                    print("  -", k)
                break
else:
    print("ZIP path not found:", zip_path)
