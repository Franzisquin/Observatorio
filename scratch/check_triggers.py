import sqlite3
import zipfile
import tempfile
import os

zip_path = r"c:\mapas\Observatorio\resultados_geo\locais_votacao_2006_gkpg.zip"

with zipfile.ZipFile(zip_path, 'r') as z:
    gpkg_names = [name for name in z.namelist() if name.lower().endswith('.gpkg')]
    gpkg_name = gpkg_names[0]
    temp_dir = tempfile.gettempdir()
    temp_path = os.path.join(temp_dir, "temp_trig.gpkg")
    with open(temp_path, 'wb') as f:
        f.write(z.read(gpkg_name))
        
    try:
        conn = sqlite3.connect(temp_path)
        cursor = conn.cursor()
        
        cursor.execute("SELECT name, sql FROM sqlite_master WHERE type='trigger' AND tbl_name='locais_votacao_2006_padronizado';")
        triggers = cursor.fetchall()
        print(f"Triggers associated with locais_votacao_2006_padronizado:")
        for name, sql in triggers:
            print(f"\nTrigger Name: {name}\nSQL: {sql}")
            
        conn.close()
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)
