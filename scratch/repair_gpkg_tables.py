import os
import sqlite3
import json
import zipfile
import tempfile
import shutil

workspace = r"c:\mapas\Observatorio"
geo_dir = os.path.join(workspace, "resultados_geo")

# Load official clean IBGE mapping
with open(os.path.join(geo_dir, "regioes_ibge.json"), "r", encoding="utf-8") as f:
    reg_data = json.load(f)

code_to_name = {}
for code7, info in reg_data.get("muni_to_region", {}).items():
    code_to_name[str(code7).strip()] = info["nome"]
    code_to_name[str(code7[:6]).strip()] = info["nome"]

def clean_db_file(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Drop any spatial validation triggers that crash on UPDATE if Spatialite is missing
    triggers = cursor.execute("SELECT name FROM sqlite_master WHERE type='trigger';").fetchall()
    for tr in triggers:
        try:
            cursor.execute(f"DROP TRIGGER IF EXISTS '{tr[0]}';")
        except Exception:
            pass
    conn.commit()

    tables = [t[0] for t in cursor.execute("SELECT name FROM sqlite_master WHERE type='table';").fetchall()]
    total_repaired = 0

    for table in tables:
        if table.startswith("gpkg_") or table.startswith("rtree_") or table == "sqlite_sequence":
            continue
        
        try:
            cols = [c[1] for c in cursor.execute(f"PRAGMA table_info('{table}');").fetchall()]
        except Exception:
            continue

        if 'cod_localidade_ibge' in cols and 'nm_localidade' in cols:
            rows = cursor.execute(f"SELECT rowid, cod_localidade_ibge, nm_localidade FROM '{table}';").fetchall()
            updates = []
            for rowid, code, current_name in rows:
                code_str = str(code or '').strip()
                clean_name = code_to_name.get(code_str) or code_to_name.get(code_str[:6])
                if clean_name and clean_name != current_name:
                    updates.append((clean_name, rowid))
            
            if updates:
                cursor.executemany(f"UPDATE '{table}' SET nm_localidade = ? WHERE rowid = ?;", updates)
                conn.commit()
                total_repaired += len(updates)
                print(f"  Repaired {len(updates)} rows in table '{table}' of {os.path.basename(db_path)}")

    cursor.close()
    conn.close()
    return total_repaired

# Process GPKG zip files
for root, dirs, files in os.walk(geo_dir):
    for f in files:
        if f.endswith('.zip') and ('gpkg' in f.lower() or 'locais_votacao' in f.lower()):
            zpath = os.path.join(root, f)
            try:
                print(f"Processing GPKG ZIP: {f}")
                tmpdir = tempfile.mkdtemp()
                try:
                    with zipfile.ZipFile(zpath, 'r') as z:
                        z.extractall(tmpdir)
                    
                    repaired_total = 0
                    for r_sub, d_sub, f_sub in os.walk(tmpdir):
                        for file_item in f_sub:
                            if file_item.endswith('.gpkg'):
                                gpath = os.path.join(r_sub, file_item)
                                repaired_total += clean_db_file(gpath)
                    
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
                    shutil.rmtree(tmpdir, ignore_errors=True)
            except Exception as ex:
                print(f"Error processing ZIP {f}: {ex}")

print("GPKG database repair complete.")
