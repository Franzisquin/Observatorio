import sqlite3
import zipfile
import tempfile
import os

zip_path = r"c:\mapas\Observatorio\resultados_geo\locais_votacao_2002_gkpg.zip"
temp_gpkg_path = os.path.join(tempfile.gettempdir(), "temp_cols_2002.gpkg")

with zipfile.ZipFile(zip_path, 'r') as z:
    gpkg_name = [name for name in z.namelist() if name.lower().endswith('.gpkg')][0]
    with open(temp_gpkg_path, 'wb') as f:
        f.write(z.read(gpkg_name))
        
try:
    conn = sqlite3.connect(temp_gpkg_path)
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(locais_votacao_2002_padronizado);")
    cols = cursor.fetchall()
    print("Columns in 2002 GPKG:")
    for c in cols:
        print(f"  - {c[1]} ({c[2]})")
    conn.close()
finally:
    if os.path.exists(temp_gpkg_path):
        try:
            os.remove(temp_gpkg_path)
        except Exception:
            pass
