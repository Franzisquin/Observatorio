import os
import zipfile
import json
import sqlite3

base_dir = r"c:\Users\lixov\OneDrive\Documentos\Observatorio\resultados_geo"
target_years = [2016, 2018, 2020, 2024]

# Step 1: Load 2022 Census mapping
map_by_id = {}
map_by_zone = {}

censo_22_dir = os.path.join(base_dir, "Censo 2022")
print("Loading 2022 Census mappings for verification...")
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

# Key helpers
def get_uf(props):
    for k in ["sg_uf", "SG_UF", "uf", "UF"]:
        if k in props and props[k]:
            return str(props[k]).strip().upper()
    return None

def get_zone(props):
    for k in ["nr_zona", "NR_ZONA"]:
        if k in props and props[k] is not None:
            return int(float(props[k]))
    return None

def get_loc(props):
    for k in ["nr_locvot", "NR_LOCVOT", "nr_loc_vot", "NR_LOCAL_VOTACAO"]:
        if k in props and props[k] is not None:
            return int(float(props[k]))
    return None

def lookup_fields(uf, id_unico, nr_zona, nr_locvot):
    if not uf:
        return None
    if id_unico and (uf, id_unico) in map_by_id:
        return map_by_id[(uf, id_unico)]
    if nr_zona is not None and nr_locvot is not None and (uf, nr_zona, nr_locvot) in map_by_zone:
        return map_by_zone[(uf, nr_zona, nr_locvot)]
    return None

key_variants = {
    "Renda Media": ["Renda Media", "Renda Média", "renda_media", "RENDA_MEDIA", "renda", "RENDA MEDIA"],
    "Pct Branca": ["Pct Branca", "pct_branca", "PCT_BRANCA", "PCT BRANCA"],
    "Pct Preta": ["Pct Preta", "pct_preta", "PCT_PRETA", "PCT PRETA"],
    "Pct Parda": ["Pct Parda", "pct_parda", "PCT_PARDA", "PCT PARDA"],
    "Pct Amarela": ["Pct Amarela", "pct_amarela", "PCT_AMARELA", "PCT AMARELA"],
    "Pct Indigena": ["Pct Indigena", "Pct Indígena", "pct_indigena", "PCT_INDIGENA", "PCT INDIGENA"]
}

def verify_properties(props, source_desc):
    uf = get_uf(props)
    id_unico = props.get("ID_UNICO") or props.get("id_unico")
    nr_zona = get_zone(props)
    nr_locvot = get_loc(props)
    
    matched = lookup_fields(uf, id_unico, nr_zona, nr_locvot)
    if not matched:
        # Not in 2022 Census data, so we don't assert it was matched
        return True, "not_in_2022"
        
    for std_key, val in matched.items():
        if val is None:
            continue
        # Find which key exists in props
        found_key = None
        for var in key_variants[std_key]:
            if var in props:
                found_key = var
                break
        if not found_key:
            continue
            
        prop_val = props[found_key]
        if prop_val is None or abs(float(prop_val) - float(val)) > 0.02:
            return False, f"{source_desc}: value mismatch for {std_key} ({props.get('nm_locvot')}). Expected {val}, found {prop_val}"
            
    return True, "ok"

errors = []
verified_count = 0

# Check some Censo ZIPs
print("\nVerifying Censo ZIP files...")
for year in target_years:
    # Test AC, AL, AM
    for uf in ["AC", "AL", "AM"]:
        path = os.path.join(base_dir, f"Censo {year}", f"censo_{year}_{uf}.zip")
        if not os.path.exists(path):
            continue
        with zipfile.ZipFile(path, 'r') as zf:
            jname = f"censo_{year}_{uf}.json"
            data = json.loads(zf.read(jname).decode("utf-8"))
            
            # Check Metadata
            md = data.get("METADATA", {})
            if md.get("race_source") != "ibge_censo2022_cor_ou_raca_setores_kernel_vizinhanca":
                errors.append(f"Censo {year} {uf} has wrong race_source: {md.get('race_source')}")
            if md.get("income_source") != "ibge_censo2022_renda_responsavel_setores_kernel_vizinhanca":
                errors.append(f"Censo {year} {uf} has wrong income_source: {md.get('income_source')}")
                
            results = data.get("RESULTS", {})
            # Check first 5 entries
            for k in list(results.keys())[:5]:
                v = results[k]
                v["uf"] = uf
                ok, err = verify_properties(v, f"Censo {year} {uf} result {k}")
                if not ok:
                    errors.append(err)
                elif err == "ok":
                    verified_count += 1

# Check some GeoJSON ZIPs
print("Verifying GeoJSON ZIP files...")
for year in target_years:
    # check locais_votacao_YYYY_1.zip
    path = os.path.join(base_dir, f"locais_votacao_{year}_1.zip")
    if not os.path.exists(path):
        continue
    with zipfile.ZipFile(path, 'r') as zf:
        for name in zf.namelist():
            if name.endswith(".geojson"):
                data = json.loads(zf.read(name).decode("utf-8"))
                for feat in data.get("features", [])[:5]:
                    props = feat.get("properties", {})
                    ok, err = verify_properties(props, f"GeoJSON Zip {year} -> {name}")
                    if not ok:
                        errors.append(err)
                    elif err == "ok":
                        verified_count += 1

# Check some GPKG databases inside ZIP
print("Verifying GPKG ZIP databases...")
for year in target_years:
    path = os.path.join(base_dir, f"locais_votacao_{year}_gkpg.zip")
    if not os.path.exists(path):
        path = os.path.join(base_dir, f"locais_votacao_{year}_gpkg.zip")
    if not os.path.exists(path):
        continue
        
    import tempfile
    with zipfile.ZipFile(path, 'r') as zf:
        gpkg_names = [name for name in zf.namelist() if name.lower().endswith('.gpkg')]
        if gpkg_names:
            gpkg_name = gpkg_names[0]
            with tempfile.TemporaryDirectory() as temp_dir:
                extracted = zf.extract(gpkg_name, temp_dir)
                conn = sqlite3.connect(extracted)
                cursor = conn.cursor()
                cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
                tables = [r[0] for r in cursor.fetchall() if not r[0].startswith("gpkg_") and not r[0].startswith("rtree_") and r[0] != "sqlite_sequence"]
                for tbl in tables:
                    cursor.execute(f"PRAGMA table_info({tbl});")
                    cols = [c[1] for c in cursor.fetchall()]
                    cursor.execute(f"SELECT * FROM {tbl} LIMIT 5")
                    for row in cursor.fetchall():
                        row_dict = dict(zip(cols, row))
                        ok, err = verify_properties(row_dict, f"GPKG {year} -> {tbl}")
                        if not ok:
                            errors.append(err)
                        elif err == "ok":
                            verified_count += 1
                conn.close()

print("\n================ Verification Summary ================")
print(f"Total elements verified matching 2022 Census data: {verified_count}")
if errors:
    print(f"Errors/Mismatches found: {len(errors)}")
    for e in errors[:10]:
        print("  -", e)
    if len(errors) > 10:
        print("  ... and more")
else:
    print("Verification complete: ALL checked elements are successfully swapped with Census 2022 data!")
print("======================================================")
