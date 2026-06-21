import zipfile
import sqlite3
import os

zip_path = 'resultados_geo/locais_votacao_2006_gkpg.zip'
with zipfile.ZipFile(zip_path) as z:
    names = [n for n in z.namelist() if n.lower().endswith('.gpkg')]
    if not names:
        print("No .gpkg file found in zip")
    else:
        name = names[0]
        z.extract(name, 'scratch')
        db_path = os.path.join('scratch', name)
        conn = sqlite3.connect(db_path)
        tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        print('Tables in 2006 gpkg:', [t[0] for t in tables])
        
        # also print first row of locais_votacao_2006_padronizado if it exists
        pad = [t[0] for t in tables if 'padronizado' in t[0] or 'enriquecido' in t[0].lower() or 'locais' in t[0].lower()]
        if pad:
            print('Columns of', pad[0])
            cursor = conn.cursor()
            cursor.execute(f"PRAGMA table_info({pad[0]})")
            print([col[1] for col in cursor.fetchall()])
            cursor.execute(f"SELECT * FROM {pad[0]} LIMIT 1")
            print('Row:', cursor.fetchone())
        conn.close()
