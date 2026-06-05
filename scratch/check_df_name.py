import json
import zipfile
import tempfile
import os
import sqlite3

# Let's inspect the city name in the Parquet or JSON or GPKG for DF
# Let's check what is loaded from the ZIP index or parquet if we can,
# or let's read the list of cities from the general totals if they exist for 2002 or 2006.
# Let's search insideresultados_geo/para details or general totals.
# Wait, let's list files inresultados_geo/ to see if there is any json with totals.
print("Files in resultados_geo:")
for f in os.listdir("resultados_geo"):
    if "totals" in f.lower() or "municip" in f.lower() or "detalhes" in f.lower() or f.endswith(".json"):
        print("  -", f)

# Let's search if there's a JSON file for 2002 or 2006 presidential/general totals
# Or let's inspect the GPKG for DF's cities.
temp_path = os.path.join(tempfile.gettempdir(), "temp_scan_df.gpkg")
zip_path = r"c:\mapas\Observatorio\resultados_geo\locais_votacao_2002_gkpg.zip"
with zipfile.ZipFile(zip_path, 'r') as z:
    gpkg_name = [name for name in z.namelist() if name.lower().endswith('.gpkg')][0]
    with open(temp_path, 'wb') as f:
        f.write(z.read(gpkg_name))
        
try:
    conn = sqlite3.connect(temp_path)
    cursor = conn.cursor()
    cursor.execute("SELECT DISTINCT sg_uf, nm_localidade FROM locais_votacao_2002_padronizado WHERE sg_uf='DF';")
    print("DF in 2002 GPKG:", cursor.fetchall())
    conn.close()
finally:
    if os.path.exists(temp_path):
        os.remove(temp_path)
