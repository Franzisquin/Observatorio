import sqlite3
import os
import zipfile
import json

base_dir = r"c:\Users\lixov\OneDrive\Documentos\Observatorio"
gpkg_path = os.path.join(base_dir, "resultados_geo", "locais_votacao_2006.gpkg")

print("Checking GPKG:", gpkg_path)
if os.path.exists(gpkg_path):
    conn = sqlite3.connect(gpkg_path)
    cursor = conn.cursor()
    # Let's list tables first
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = cursor.fetchall()
    print("Tables:", tables)
    
    # Search for GLICERIO in all tables and columns
    for table_tuple in tables:
        table = table_tuple[0]
        cursor.execute(f"PRAGMA table_info({table});")
        cols = [c[1] for c in cursor.fetchall()]
        
        # Build query to search in all text columns
        where_clauses = []
        for col in cols:
            where_clauses.append(f"CAST({col} AS TEXT) LIKE '%GLICERIO%'")
            where_clauses.append(f"CAST({col} AS TEXT) LIKE '%GLICÉRIO%'")
        
        query = f"SELECT * FROM {table} WHERE " + " OR ".join(where_clauses)
        try:
            cursor.execute(query)
            rows = cursor.fetchall()
            if rows:
                print(f"Found in {table}: {len(rows)} rows")
                for r in rows[:5]:
                    print(r)
        except Exception as e:
            # print(f"Error searching {table}: {e}")
            pass
    conn.close()

# Also let's search in the zip files
locais_dir = os.path.join(base_dir, "resultados_geo")
for f in os.listdir(locais_dir):
    if f.startswith("locais_votacao_") and f.endswith(".zip"):
        zip_path = os.path.join(locais_dir, f)
        with zipfile.ZipFile(zip_path) as zf:
            for name in zf.namelist():
                if name.endswith(".geojson"):
                    try:
                        content = zf.read(name).decode("utf-8")
                        if "GLICERIO" in content.upper():
                            print(f"Found in zip {f}, file {name}")
                            data = json.loads(content)
                            for feat in data.get("features", []):
                                props = feat.get("properties", {})
                                for k, v in props.items():
                                    if "GLICERIO" in str(v).upper():
                                        print("Feature properties:", props)
                                        print("Geometry:", feat.get("geometry"))
                    except Exception as e:
                        pass
