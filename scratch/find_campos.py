import sqlite3
import zipfile
import tempfile
import os

def check_gpkg(zip_path, year):
    print(f"\n--- Checking {year} GPKG: {zip_path} ---")
    if not os.path.exists(zip_path):
        print("Zip file does not exist!")
        return

    with zipfile.ZipFile(zip_path, 'r') as z:
        # Find the .gpkg file inside the zip
        gpkg_names = [name for name in z.namelist() if name.lower().endswith('.gpkg')]
        if not gpkg_names:
            print("No .gpkg file found in zip!")
            return
        
        gpkg_name = gpkg_names[0]
        print(f"Found GPKG file: {gpkg_name}")
        
        # Extract to a temp file
        temp_dir = tempfile.gettempdir()
        temp_gpkg_path = os.path.join(temp_dir, f"temp_{year}.gpkg")
        
        with open(temp_gpkg_path, 'wb') as f:
            f.write(z.read(gpkg_name))
            
        try:
            conn = sqlite3.connect(temp_gpkg_path)
            cursor = conn.cursor()
            
            # List tables
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
            tables = [r[0] for r in cursor.fetchall()]
            print(f"Tables in database: {tables}")
            
            for table in tables:
                if 'locais_votacao' in table:
                    # Let's inspect columns of this table
                    cursor.execute(f"PRAGMA table_info({table});")
                    cols = [c[1] for c in cursor.fetchall()]
                    print(f"Table '{table}' columns: {cols}")
                    
                    # Search for nm_localidade containing 'campos' (case-insensitive) or 'CAMPOS'
                    # and see what values exist in RJ (sg_uf = 'RJ')
                    if 'nm_localidade' in cols:
                        cursor.execute(f"SELECT DISTINCT nm_localidade FROM {table} WHERE sg_uf = 'RJ' AND (nm_localidade LIKE '%campos%' OR nm_localidade = 'CAMPOS');")
                        matches = cursor.fetchall()
                        print(f"Matches for 'campos' in RJ in '{table}': {matches}")
                        
                        # Let's count total rows per localidade in RJ to see if any is just 'CAMPOS' or 'CAMPOS DOS GOYTACAZES'
                        cursor.execute(f"SELECT nm_localidade, COUNT(*) FROM {table} WHERE sg_uf = 'RJ' GROUP BY nm_localidade;")
                        all_rj = cursor.fetchall()
                        print(f"All RJ localidades in '{table}':")
                        for name, cnt in sorted(all_rj):
                            if 'CAMPOS' in name or name == 'CAMPOS':
                                print(f"  * {name}: {cnt} locations")
                            else:
                                print(f"    {name}: {cnt} locations")
            conn.close()
        finally:
            if os.path.exists(temp_gpkg_path):
                os.remove(temp_gpkg_path)

check_gpkg(r"c:\mapas\Observatorio\resultados_geo\locais_votacao_2002_gkpg.zip", 2002)
check_gpkg(r"c:\mapas\Observatorio\resultados_geo\locais_votacao_2006_gkpg.zip", 2006)
