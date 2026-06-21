import os
import zipfile
import sqlite3
import tempfile

base_dir = r"c:\Users\lixov\OneDrive\Documentos\Observatorio"
resultados_geo = os.path.join(base_dir, "resultados_geo")

for f in sorted(os.listdir(resultados_geo)):
    if f.endswith(".zip") and ("gpkg" in f.lower() or "gkpg" in f.lower()):
        zip_path = os.path.join(resultados_geo, f)
        print(f"\n==========================================")
        print(f"Zip: {f}")
        try:
            with zipfile.ZipFile(zip_path, 'r') as zf:
                gpkg_names = [name for name in zf.namelist() if name.lower().endswith('.gpkg')]
                if not gpkg_names:
                    print("  No GPKG found!")
                    continue
                gpkg_name = gpkg_names[0]
                print(f"  GPKG: {gpkg_name}")
                with tempfile.TemporaryDirectory() as temp_dir:
                    extracted = zf.extract(gpkg_name, temp_dir)
                    conn = sqlite3.connect(extracted)
                    cursor = conn.cursor()
                    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
                    tables = [r[0] for r in cursor.fetchall()]
                    print(f"  Tables: {tables}")
                    for tbl in tables:
                        if tbl.startswith("gpkg_") or tbl.startswith("rtree_") or tbl == "sqlite_sequence":
                            continue
                        cursor.execute(f"PRAGMA table_info({tbl});")
                        cols = [c[1] for c in cursor.fetchall()]
                        cursor.execute(f"SELECT * FROM {tbl}")
                        for row in cursor.fetchall():
                            row_dict = dict(zip(cols, row))
                            nm_locvot = str(row_dict.get("nm_locvot", ""))
                            ds_endereco = str(row_dict.get("ds_endereco", ""))
                            nm_localidade = str(row_dict.get("nm_localidade", ""))
                            
                            # check if it matches Glicerio / Eustaquio in Porto Alegre
                            if "PORTO ALEGRE" in nm_localidade.upper():
                                if "GLICERIO" in nm_locvot.upper() or "GLICÉRIO" in nm_locvot.upper() or \
                                   "EUSTAQUIO" in ds_endereco.upper() or "EUSTÁQUIO" in ds_endereco.upper():
                                    print(f"    FOUND in table {tbl}:")
                                    print(f"      {row_dict}")
                    conn.close()
        except Exception as e:
            print(f"  Error: {e}")
