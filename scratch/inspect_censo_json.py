import zipfile
import json
import os

base_dir = r"c:\Users\lixov\OneDrive\Documentos\Observatorio\resultados_geo"

def inspect_censo(year):
    path = os.path.join(base_dir, f"Censo {year}", f"censo_{year}_AC.zip")
    print(f"\n--- Censo {year} (AC) ---")
    if not os.path.exists(path):
        print(f"Path {path} does not exist!")
        return
    with zipfile.ZipFile(path, 'r') as zf:
        print("Files in zip:", zf.namelist())
        jname = f"censo_{year}_AC.json"
        if jname in zf.namelist():
            data = json.loads(zf.read(jname).decode("utf-8"))
            print("Keys in JSON:", list(data.keys()))
            if "METADATA" in data:
                print("METADATA:", data["METADATA"])
            results = data.get("RESULTS", {})
            print("Total entries in RESULTS:", len(results))
            # print first entry
            if results:
                first_key = list(results.keys())[0]
                print(f"Sample entry ({first_key}):", results[first_key])

inspect_censo(2022)
inspect_censo(2016)
