import os
import zipfile
import json

base_dir = r"c:\Users\lixov\OneDrive\Documentos\Observatorio\resultados_geo"
censo_22_dir = os.path.join(base_dir, "Censo 2022")

map_by_id = {}
map_by_zone = {}

for f in sorted(os.listdir(censo_22_dir)):
    if f.endswith(".zip") and f.startswith("censo_2022_"):
        uf = f.split("_")[2].split(".")[0]
        zip_path = os.path.join(censo_22_dir, f)
        with zipfile.ZipFile(zip_path, 'r') as zf:
            jname = f"censo_2022_{uf}.json"
            if jname in zf.namelist():
                data = json.loads(zf.read(jname).decode("utf-8"))
                results = data.get("RESULTS", {})
                for k, v in results.items():
                    id_unico = v.get("ID_UNICO")
                    nr_zona = v.get("nr_zona")
                    nr_locvot = v.get("nr_locvot")
                    
                    fields = {
                        "Renda Media": v.get("Renda Media"),
                        "Pct Branca": v.get("Pct Branca"),
                        "Pct Preta": v.get("Pct Preta"),
                        "Pct Parda": v.get("Pct Parda"),
                        "Pct Amarela": v.get("Pct Amarela"),
                        "Pct Indigena": v.get("Pct Indigena")
                    }
                    
                    if id_unico:
                        map_by_id[id_unico] = fields
                    if nr_zona is not None and nr_locvot is not None:
                        map_by_zone[(uf, int(nr_zona), int(nr_locvot))] = fields

print(f"Loaded {len(map_by_id)} entries by ID_UNICO.")
print(f"Loaded {len(map_by_zone)} entries by (UF, Zone, Loc).")
