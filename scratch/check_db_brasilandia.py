import sqlite3
import zipfile
import tempfile
import os

zip_path = r"c:\mapas\Observatorio\resultados_geo\locais_votacao_2002_gkpg.zip"
temp_gpkg_path = os.path.join(tempfile.gettempdir(), "temp_bra_2002.gpkg")

with zipfile.ZipFile(zip_path, 'r') as z:
    gpkg_name = [name for name in z.namelist() if name.lower().endswith('.gpkg')][0]
    with open(temp_gpkg_path, 'wb') as f:
        f.write(z.read(gpkg_name))
        
try:
    conn = sqlite3.connect(temp_gpkg_path)
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM locais_votacao_2002_padronizado WHERE sg_uf='RO' AND nm_localidade LIKE '%BRASILANDIA%';")
    print("RO Brasililandia row count in 2002 GPKG:", cursor.fetchone()[0])
    cursor.execute("SELECT DISTINCT nm_localidade FROM locais_votacao_2002_padronizado WHERE sg_uf='RO' AND nm_localidade LIKE '%BRASILANDIA%';")
    print("RO Brasililandia distinct names in 2002 GPKG:", cursor.fetchall())
    conn.close()
finally:
    if os.path.exists(temp_gpkg_path):
        try:
            os.remove(temp_gpkg_path)
        except Exception:
            pass
