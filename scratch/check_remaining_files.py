import os
import zipfile
import json
import sqlite3
import re

base_dir = r"c:\Users\lixov\OneDrive\Documentos\Observatorio\resultados_geo"
target_years = [2016, 2018, 2020, 2024]

# Load 2022 Census mappings
map_by_id = {}
map_by_zone = {}

censo_22_dir = os.path.join(base_dir, "Censo 2022")
print("Loading 2022 Census mappings...")
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
                        map_by_id[(uf, id_unico)] = fields
                    if nr_zona is not None and nr_locvot is not None:
                        map_by_zone[(uf, int(nr_zona), int(nr_locvot))] = fields

print(f"Loaded {len(map_by_id)} entries by (UF, ID_UNICO) and {len(map_by_zone)} entries by (UF, Zone, Loc).")

# Key variants
key_variants = {
    "Renda Media": ["Renda Media", "Renda Média", "renda_media", "RENDA_MEDIA", "renda", "RENDA MEDIA"],
    "Pct Branca": ["Pct Branca", "pct_branca", "PCT_BRANCA", "PCT BRANCA"],
    "Pct Preta": ["Pct Preta", "pct_preta", "PCT_PRETA", "PCT PRETA"],
    "Pct Parda": ["Pct Parda", "pct_parda", "PCT_PARDA", "PCT PARDA"],
    "Pct Amarela": ["Pct Amarela", "pct_amarela", "PCT_AMARELA", "PCT AMARELA"],
    "Pct Indigena": ["Pct Indigena", "Pct Indígena", "pct_indigena", "PCT_INDIGENA", "PCT INDIGENA"]
}

def get_uf(props):
    for k in ["sg_uf", "SG_UF", "uf", "UF"]:
        if k in props and props[k]:
            return str(props[k]).strip().upper()
    return None

def get_zone(props):
    for k in ["nr_zona", "NR_ZONA"]:
        if k in props and props[k] is not None:
            try:
                return int(float(props[k]))
            except ValueError:
                pass
    return None

def get_loc(props):
    for k in ["nr_locvot", "NR_LOCVOT", "nr_loc_vot", "NR_LOCAL_VOTACAO"]:
        if k in props and props[k] is not None:
            try:
                return int(float(props[k]))
            except ValueError:
                pass
    return None

def lookup_fields(uf, id_unico, nr_zona, nr_locvot):
    if not uf:
        return None
    if id_unico and (uf, id_unico) in map_by_id:
        return map_by_id[(uf, id_unico)]
    if nr_zona is not None and nr_locvot is not None and (uf, nr_zona, nr_locvot) in map_by_zone:
        return map_by_zone[(uf, nr_zona, nr_locvot)]
    return None

# Check file contents
unchecked_files_with_census_fields = []
mismatched_files = []

for root, dirs, files in os.walk(base_dir):
    dir_match = re.search(r"(2016|2018|2020|2024)", root)
    for f in files:
        file_path = os.path.join(root, f)
        rel_path = os.path.relpath(file_path, base_dir)
        file_match = re.search(r"(2016|2018|2020|2024)", f)
        if not dir_match and not file_match:
            continue
        
        # Determine year
        year = int((dir_match or file_match).group(1))
        
        if f.endswith(".zip"):
            # Let's inspect the ZIP
            try:
                with zipfile.ZipFile(file_path, 'r') as zf:
                    for name in zf.namelist():
                        if name.endswith(".geojson") or name.endswith(".json"):
                            content = zf.read(name).decode("utf-8", errors="ignore")
                            if any(x in content for x in ["Renda Media", "Renda Média", "renda_media", "Pct Branca", "pct_branca"]):
                                # It has census fields. Let's load it and check if it matches 2022 Census
                                data = json.loads(content)
                                if name.endswith(".geojson"):
                                    features = data.get("features", [])
                                    # check some features
                                    sample_checked = 0
                                    sample_matched = 0
                                    for feat in features[:10]:
                                        props = feat.get("properties", {})
                                        uf = get_uf(props)
                                        id_unico = props.get("ID_UNICO") or props.get("id_unico")
                                        nr_zona = get_zone(props)
                                        nr_locvot = get_loc(props)
                                        matched = lookup_fields(uf, id_unico, nr_zona, nr_locvot)
                                        if matched:
                                            sample_checked += 1
                                            is_ok = True
                                            for std_key, val in matched.items():
                                                if val is None:
                                                    continue
                                                found_var = None
                                                for var in key_variants[std_key]:
                                                    if var in props:
                                                        found_var = var
                                                        break
                                                if found_var:
                                                    p_val = props[found_var]
                                                    if p_val is None or abs(float(p_val) - float(val)) > 0.02:
                                                        is_ok = False
                                                        break
                                            if is_ok:
                                                sample_matched += 1
                                    
                                    if sample_checked > 0:
                                        pct = sample_matched / sample_checked
                                        if pct < 0.9:
                                            mismatched_files.append((rel_path, name, f"GeoJSON: {sample_matched}/{sample_checked} matched"))
                                elif name.endswith(".json") and "censo" in name:
                                    results = data.get("RESULTS", {})
                                    sample_checked = 0
                                    sample_matched = 0
                                    uf = name.split("_")[2].split(".")[0]
                                    for k, v in list(results.items())[:10]:
                                        id_unico = v.get("ID_UNICO")
                                        nr_zona = v.get("nr_zona")
                                        nr_locvot = v.get("nr_locvot")
                                        matched = lookup_fields(uf, id_unico, nr_zona, nr_locvot)
                                        if matched:
                                            sample_checked += 1
                                            is_ok = True
                                            for std_key, val in matched.items():
                                                if val is None:
                                                    continue
                                                if std_key in v:
                                                    p_val = v[std_key]
                                                    if p_val is None or abs(float(p_val) - float(val)) > 0.02:
                                                        is_ok = False
                                                        break
                                            if is_ok:
                                                sample_matched += 1
                                    if sample_checked > 0:
                                        pct = sample_matched / sample_checked
                                        if pct < 0.9:
                                            mismatched_files.append((rel_path, name, f"Censo JSON: {sample_matched}/{sample_checked} matched"))
            except Exception as e:
                print(f"Error reading zip {rel_path}: {e}")

print("\n--- Mismatched or Unpatched Files ---")
if mismatched_files:
    for rel_path, name, info in mismatched_files:
        print(f"File: {rel_path} -> {name}: {info}")
else:
    print("None! All scanned files match the 2022 Census data.")
