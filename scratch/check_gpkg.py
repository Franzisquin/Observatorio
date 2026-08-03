import sqlite3
import os

filepath = r"resultados_geo\locais_votacao_2022.gpkg"
if os.path.exists(filepath):
    conn = sqlite3.connect(filepath)
    cursor = conn.cursor()
    tables = [t[0] for t in cursor.execute("SELECT name FROM sqlite_master WHERE type='table';").fetchall()]
    print("GPKG tables:", tables)
    for t in tables:
        if t not in ['gpkg_spatial_ref_sys', 'gpkg_contents', 'gpkg_geometry_columns', 'sqlite_sequence']:
            cols = [c[1] for c in cursor.execute(f"PRAGMA table_info('{t}')").fetchall()]
            print(f"Table {t} cols:", cols)
            rows = cursor.execute(f"SELECT * FROM '{t}' LIMIT 2").fetchall()
            print(f"Table {t} sample:", rows)
    conn.close()
else:
    print("File not found")
