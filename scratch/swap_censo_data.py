import os
import zipfile
import json
import sqlite3
import re
import tempfile
import shutil

base_dir = r"c:\Users\lixov\OneDrive\Documentos\Observatorio\resultados_geo"
target_years = [2016, 2018, 2020, 2024]

# Step 1: Load 2022 Census data mappings
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

# Key normalization helper
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
    # 1. Match by ID_UNICO
    if id_unico and (uf, id_unico) in map_by_id:
        return map_by_id[(uf, id_unico)]
    # 2. Match by (UF, Zone, Loc)
    if nr_zona is not None and nr_locvot is not None and (uf, nr_zona, nr_locvot) in map_by_zone:
        return map_by_zone[(uf, nr_zona, nr_locvot)]
    return None

# Mappings for GeoJSON/GPKG standard properties
key_variants = {
    "Renda Media": ["Renda Media", "Renda Média", "renda_media", "RENDA_MEDIA", "renda", "RENDA MEDIA"],
    "Pct Branca": ["Pct Branca", "pct_branca", "PCT_BRANCA", "PCT BRANCA"],
    "Pct Preta": ["Pct Preta", "pct_preta", "PCT_PRETA", "PCT PRETA"],
    "Pct Parda": ["Pct Parda", "pct_parda", "PCT_PARDA", "PCT PARDA"],
    "Pct Amarela": ["Pct Amarela", "pct_amarela", "PCT_AMARELA", "PCT AMARELA"],
    "Pct Indigena": ["Pct Indigena", "Pct Indígena", "pct_indigena", "PCT_INDIGENA", "PCT INDIGENA"]
}

def patch_properties(props):
    uf = get_uf(props)
    id_unico = props.get("ID_UNICO") or props.get("id_unico")
    nr_zona = get_zone(props)
    nr_locvot = get_loc(props)
    
    matched = lookup_fields(uf, id_unico, nr_zona, nr_locvot)
    if not matched:
        return False
        
    for std_key, val in matched.items():
        if val is None:
            continue
        # Set all variants that exist in properties
        updated = False
        for var in key_variants[std_key]:
            if var in props:
                props[var] = val
                updated = True
        if not updated:
            props[std_key] = val
            
    return True

# Step 2: Recursive patching
for root, dirs, files in os.walk(base_dir):
    # Determine if directory belongs to a target year
    dir_match = re.search(r"(2016|2018|2020|2024)", root)
    
    for f in files:
        file_path = os.path.join(root, f)
        rel_path = os.path.relpath(file_path, base_dir)
        
        file_match = re.search(r"(2016|2018|2020|2024)", f)
        if not dir_match and not file_match:
            continue
            
        year = int((dir_match or file_match).group(1))
        
        # A. Censo JSON zip file
        if f.endswith(".zip") and f.startswith(f"censo_{year}_"):
            print(f"Patching Censo ZIP: {rel_path}")
            temp_dir = tempfile.mkdtemp()
            temp_zip_path = os.path.join(temp_dir, "temp.zip")
            uf = f.split("_")[2].split(".")[0]
            jname = f"censo_{year}_{uf}.json"
            resumo_name = f"censo_{year}_{uf}_resumo.json"
            
            try:
                with zipfile.ZipFile(file_path, 'r') as z_in:
                    with zipfile.ZipFile(temp_zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as z_out:
                        for item in z_in.infolist():
                            if item.filename == jname:
                                doc = json.loads(z_in.read(jname).decode("utf-8"))
                                results = doc.get("RESULTS", {})
                                for k, v in results.items():
                                    id_unico = v.get("ID_UNICO")
                                    nr_zona = v.get("nr_zona")
                                    nr_locvot = v.get("nr_locvot")
                                    matched = lookup_fields(uf, id_unico, nr_zona, nr_locvot)
                                    if matched:
                                        for std_key, val in matched.items():
                                            if val is not None:
                                                v[std_key] = val
                                # Update Metadata
                                md = doc.setdefault("METADATA", {})
                                md["race_source"] = "ibge_censo2022_cor_ou_raca_setores_kernel_vizinhanca"
                                md["income_source"] = "ibge_censo2022_renda_responsavel_setores_kernel_vizinhanca"
                                z_out.writestr(jname, json.dumps(doc, ensure_ascii=False))
                            elif item.filename == resumo_name:
                                resumo = json.loads(z_in.read(resumo_name).decode("utf-8"))
                                md = resumo.setdefault("METADATA", {})
                                md["race_source"] = "ibge_censo2022_cor_ou_raca_setores_kernel_vizinhanca"
                                md["income_source"] = "ibge_censo2022_renda_responsavel_setores_kernel_vizinhanca"
                                z_out.writestr(resumo_name, json.dumps(resumo, ensure_ascii=False))
                            else:
                                z_out.writestr(item, z_in.read(item.filename))
                shutil.move(temp_zip_path, file_path)
            finally:
                if os.path.exists(temp_dir):
                    shutil.rmtree(temp_dir)
                    
        # B. GPKG database zip file
        elif f.endswith(".zip") and ("gpkg" in f.lower() or "gkpg" in f.lower()):
            print(f"Patching GPKG ZIP: {rel_path}")
            temp_dir = tempfile.mkdtemp()
            temp_zip_path = os.path.join(temp_dir, "temp.zip")
            
            try:
                with zipfile.ZipFile(file_path, 'r') as z_in:
                    gpkg_names = [name for name in z_in.namelist() if name.lower().endswith('.gpkg')]
                    if not gpkg_names:
                        continue
                    gpkg_name = gpkg_names[0]
                    extracted_gpkg = z_in.extract(gpkg_name, temp_dir)
                    
                    # Update GPKG
                    conn = sqlite3.connect(extracted_gpkg)
                    cursor = conn.cursor()
                    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
                    tables = [r[0] for r in cursor.fetchall() if not r[0].startswith("gpkg_") and not r[0].startswith("rtree_") and r[0] != "sqlite_sequence"]
                    
                    for tbl in tables:
                        cursor.execute(f"PRAGMA table_info({tbl});")
                        cols = [c[1] for c in cursor.fetchall()]
                        
                        cursor.execute(f"SELECT * FROM {tbl}")
                        rows = cursor.fetchall()
                        
                        # Drop triggers
                        cursor.execute(f"SELECT name, sql FROM sqlite_master WHERE type='trigger' AND tbl_name=?;", (tbl,))
                        triggers = cursor.fetchall()
                        for t_name, _ in triggers:
                            cursor.execute(f"DROP TRIGGER \"{t_name}\";")
                            
                        try:
                            for row in rows:
                                row_dict = dict(zip(cols, row))
                                uf = get_uf(row_dict)
                                id_unico = row_dict.get("ID_UNICO") or row_dict.get("id_unico")
                                nr_zona = get_zone(row_dict)
                                nr_locvot = get_loc(row_dict)
                                
                                matched = lookup_fields(uf, id_unico, nr_zona, nr_locvot)
                                if not matched:
                                    continue
                                    
                                updates = {}
                                for std_key, val in matched.items():
                                    if val is None:
                                        continue
                                    for var in key_variants[std_key]:
                                        if var in cols:
                                            updates[var] = val
                                            
                                if updates:
                                    id_col = 'fid' if 'fid' in cols else ('rowid' if 'rowid' in cols else cols[0])
                                    fid = row_dict.get(id_col) or row[0]
                                    clauses = [f'"{k}" = ?' for k in updates.keys()]
                                    cursor.execute(f'UPDATE "{tbl}" SET ' + ", ".join(clauses) + f' WHERE "{id_col}" = ?', 
                                                   list(updates.values()) + [fid])
                            conn.commit()
                        finally:
                            # Recreate triggers
                            for t_name, sql in triggers:
                                cursor.execute(sql)
                            conn.commit()
                    conn.close()
                    
                    # Write updated GPKG to zip
                    with zipfile.ZipFile(temp_zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as z_out:
                        for item in z_in.infolist():
                            if item.filename == gpkg_name:
                                z_out.write(extracted_gpkg, gpkg_name)
                            else:
                                z_out.writestr(item, z_in.read(item.filename))
                shutil.move(temp_zip_path, file_path)
            finally:
                if os.path.exists(temp_dir):
                    shutil.rmtree(temp_dir)
                    
        # C. GeoJSON zip files (excluding censo/gpkg ones)
        elif f.endswith(".zip") and not f.startswith("censo_") and not ("gpkg" in f.lower() or "gkpg" in f.lower()):
            temp_dir = tempfile.mkdtemp()
            temp_zip_path = os.path.join(temp_dir, "temp.zip")
            modified = False
            
            try:
                with zipfile.ZipFile(file_path, 'r') as z_in:
                    with zipfile.ZipFile(temp_zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as z_out:
                        for item in z_in.infolist():
                            name = item.filename
                            if name.endswith(".geojson"):  # We can check RS or other states, wait!
                                # Wait! Should we update ALL states, not just RS?
                                # Yes, our 2022 censo mapping contains ALL states!
                                # So any *.geojson inside the zip can be updated.
                                # Let's update all .geojson files!
                                content_bytes = z_in.read(name)
                                content = content_bytes.decode("utf-8")
                                
                                # Quick precheck: if any variants are in text, parse it
                                if any(x in content for x in ["Renda Media", "Renda Média", "renda_media", "Pct Branca", "pct_branca"]):
                                    data = json.loads(content)
                                    geojson_modified = False
                                    for feat in data.get("features", []):
                                        props = feat.get("properties", {})
                                        if patch_properties(props):
                                            geojson_modified = True
                                            
                                    if geojson_modified:
                                        new_content = json.dumps(data, ensure_ascii=False)
                                        z_out.writestr(item, new_content.encode("utf-8"))
                                        modified = True
                                    else:
                                        z_out.writestr(item, content_bytes)
                                else:
                                    z_out.writestr(item, content_bytes)
                            else:
                                z_out.writestr(item, z_in.read(name))
                if modified:
                    shutil.move(temp_zip_path, file_path)
                    print(f"Patched GeoJSON ZIP: {rel_path}")
            finally:
                if os.path.exists(temp_dir):
                    shutil.rmtree(temp_dir)

print("Census data swap complete!")
