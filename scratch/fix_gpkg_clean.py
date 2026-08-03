import os
import sqlite3
import json
import zipfile
import tempfile
import gc

workspace = r"c:\mapas\Observatorio"
geo_dir = os.path.join(workspace, "resultados_geo")

with open(os.path.join(geo_dir, "regioes_ibge.json"), "r", encoding="utf-8") as f:
    reg_data = json.load(f)

code_to_name = {}
for code7, info in reg_data.get("muni_to_region", {}).items():
    code_to_name[str(code7).strip()] = info["nome"]
    code_to_name[str(code7[:6]).strip()] = info["nome"]

def repair_db_file(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Disable triggers temporarily if possible
    tables = [t[0] for t in cursor.execute("SELECT name FROM sqlite_master WHERE type='table';").fetchall()]
    
    repaired_total = 0
    for table in ['locais_votacao_2022_ENRIQUECIDO', 'locais_votacao', 'locais_votacao_2006', 'locais_votacao_2002', 'locais_votacao_2008', 'locais_votacao_2010', 'locais_votacao_2012', 'locais_votacao_2014', 'locais_votacao_2016', 'locais_votacao_2018', 'locais_votacao_2020', 'locais_votacao_2024']:
        if table in tables:
            cols = [c[1] for c in cursor.execute(f"PRAGMA table_info('{table}');").fetchall()]
            if 'cod_localidade_ibge' in cols and 'nm_localidade' in cols:
                rows = cursor.execute(f"SELECT rowid, cod_localidade_ibge, nm_localidade FROM '{table}';").fetchall()
                updates = []
                for rowid, code, current_name in rows:
                    code_str = str(code or '').strip()
                    if not code_str or code_str == 'None':
                        continue
                    clean_name = code_to_name.get(code_str) or code_to_name.get(code_str[:6])
                    if clean_name and clean_name != current_name:
                        updates.append((clean_name, rowid))
                
                if updates:
                    print(f"Updating {len(updates)} rows in {table} of {os.path.basename(db_path)}...")
                    # Update in batches using raw SQL without spatial trigger if possible
                    cursor.executemany(f"UPDATE '{table}' SET nm_localidade = ? WHERE rowid = ?;", updates)
                    conn.commit()
                    repaired_total += len(updates)
    
    cursor.close()
    conn.close()
    return repaired_total

# Fix loose .gpkg files
for f in os.listdir(geo_dir):
    if f.endswith('.gpkg'):
        gpath = os.path.join(geo_dir, f)
        try:
            r = repair_db_file(gpath)
            print(f"Loose GPKG {f}: repaired {r} rows")
        except Exception as e:
            print(f"Loose GPKG {f} error: {e}")

print("GPKG direct repair script complete.")
