import os
import zipfile
import sqlite3
import json
import tempfile
import gc
import shutil

workspace = r"c:\mapas\Observatorio"
geo_dir = os.path.join(workspace, "resultados_geo")

# Load official clean IBGE mapping
with open(os.path.join(geo_dir, "regioes_ibge.json"), "r", encoding="utf-8") as f:
    reg_data = json.load(f)

code_to_name = {}
for code7, info in reg_data.get("muni_to_region", {}).items():
    clean_name = info["nome"]
    code_to_name[str(code7).strip()] = clean_name
    code_to_name[str(code7[:6]).strip()] = clean_name

with open(os.path.join(workspace, "lista_municipios.json"), "r", encoding="utf-8") as f:
    lista_munis = json.load(f)

def repair_sqlite_db(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    tables = [t[0] for t in cursor.execute("SELECT name FROM sqlite_master WHERE type='table';").fetchall()]
    total_repaired = 0
    
    for table in tables:
        if table.startswith("gpkg_") or table.startswith("rtree_") or table == "sqlite_sequence":
            continue
        
        try:
            cols = [c[1] for c in cursor.execute(f"PRAGMA table_info('{table}');").fetchall()]
        except Exception:
            continue
        
        target_name_col = None
        for candidate in ['nm_localidade', 'nm_mun', 'NM_MUN', 'municipio', 'NM_MUNICIPIO']:
            if candidate in cols:
                target_name_col = candidate
                break
        
        target_code_col = None
        for candidate in ['cod_localidade_ibge', 'codigo_ibge', 'cd_mun', 'CD_MUN', 'ibge']:
            if candidate in cols:
                target_code_col = candidate
                break
        
        if target_name_col and target_code_col:
            rows = cursor.execute(f"SELECT rowid, {target_code_col}, {target_name_col} FROM '{table}';").fetchall()
            updates = []
            for rowid, code, current_name in rows:
                code_str = str(code or '').strip()
                if not code_str or code_str == 'None':
                    continue
                code6 = code_str[:6]
                clean_name = code_to_name.get(code_str) or code_to_name.get(code6)
                if clean_name and clean_name != current_name:
                    updates.append((clean_name, rowid))
            
            if updates:
                cursor.executemany(f"UPDATE '{table}' SET {target_name_col} = ? WHERE rowid = ?;", updates)
                conn.commit()
                total_repaired += len(updates)
                print(f"  Repaired {len(updates)} rows in table '{table}' of {os.path.basename(db_path)}")
    
    cursor.close()
    conn.close()
    del cursor
    del conn
    gc.collect()
    return total_repaired

# Process .gpkg.zip files
for root, dirs, files in os.walk(geo_dir):
    for f in files:
        if f.endswith('.zip') and ('gpkg' in f.lower() or 'locais_votacao' in f.lower()):
            zpath = os.path.join(root, f)
            try:
                with zipfile.ZipFile(zpath, 'r') as z:
                    gpkg_names = [n for n in z.namelist() if n.endswith('.gpkg')]
                    if not gpkg_names:
                        continue
                
                print(f"Processing GPKG ZIP: {f}")
                tmpdir = tempfile.mkdtemp()
                try:
                    with zipfile.ZipFile(zpath, 'r') as z:
                        z.extractall(tmpdir)
                    
                    repaired_total = 0
                    for gname in gpkg_names:
                        gpath = os.path.join(tmpdir, gname)
                        if os.path.exists(gpath):
                            repaired_total += repair_sqlite_db(gpath)
                    
                    if repaired_total > 0:
                        tmp_zip = os.path.join(tmpdir, "repacked.zip")
                        with zipfile.ZipFile(tmp_zip, 'w', compression=zipfile.ZIP_DEFLATED) as zout:
                            for r_sub, d_sub, f_sub in os.walk(tmpdir):
                                for file_item in f_sub:
                                    if file_item == "repacked.zip":
                                        continue
                                    full_p = os.path.join(r_sub, file_item)
                                    rel_p = os.path.relpath(full_p, tmpdir)
                                    zout.write(full_p, rel_p)
                        
                        shutil.move(tmp_zip, zpath)
                        print(f"Updated {f} with {repaired_total} repaired rows!")
                    else:
                        print(f"No repairs needed for {f}")
                finally:
                    gc.collect()
                    shutil.rmtree(tmpdir, ignore_errors=True)
            except Exception as ex:
                print(f"Error processing ZIP {f}: {ex}")

print("GPKG database repair complete.")
