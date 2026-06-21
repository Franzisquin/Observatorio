import os
import zipfile
import sqlite3
import json
import struct

base_dir = r"c:\Users\lixov\OneDrive\Documentos\Observatorio"
resultados_geo = os.path.join(base_dir, "resultados_geo")

CORRECT_LONG = -51.177001
CORRECT_LAT = -30.210617

def matches(nm_locvot, ds_endereco, nm_localidade):
    if not nm_locvot or not ds_endereco or not nm_localidade:
        return False
    if "PORTO ALEGRE" not in nm_localidade.upper():
        return False
    name_match = "GLICERIO" in nm_locvot.upper() or "GLICÉRIO" in nm_locvot.upper()
    addr_match = "EUSTAQUIO" in ds_endereco.upper() or "EUSTÁQUIO" in ds_endereco.upper()
    return name_match or addr_match

print("Running verification...")
discrepancies = []
total_found = 0

for root, dirs, files in os.walk(resultados_geo):
    for f in files:
        file_path = os.path.join(root, f)
        rel_path = os.path.relpath(file_path, resultados_geo)
        
        # 1. Check unzipped GPKG files
        if f.endswith(".gpkg"):
            try:
                conn = sqlite3.connect(file_path)
                cursor = conn.cursor()
                cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
                tables = [r[0] for r in cursor.fetchall() if not r[0].startswith("gpkg_") and not r[0].startswith("rtree_") and r[0] != "sqlite_sequence"]
                for tbl in tables:
                    cursor.execute(f"PRAGMA table_info({tbl});")
                    cols = [c[1] for c in cursor.fetchall()]
                    cursor.execute(f"SELECT * FROM {tbl}")
                    for row in cursor.fetchall():
                        row_dict = dict(zip(cols, row))
                        nm_locvot = row_dict.get("nm_locvot", "")
                        ds_endereco = row_dict.get("ds_endereco", "")
                        nm_localidade = row_dict.get("nm_localidade", "")
                        if matches(nm_locvot, ds_endereco, nm_localidade):
                            total_found += 1
                            lon = row_dict.get("long")
                            lat = row_dict.get("lat")
                            geom = row_dict.get("geom")
                            
                            # unpack geom
                            geom_coords = None
                            if geom:
                                try:
                                    geom_coords = struct.unpack('<dd', geom[13:29])
                                except Exception as e:
                                    geom_coords = f"Error: {e}"
                                    
                            is_correct = (lon == CORRECT_LONG) and (lat == CORRECT_LAT)
                            if geom_coords:
                                is_correct = is_correct and (abs(geom_coords[0] - CORRECT_LONG) < 1e-5) and (abs(geom_coords[1] - CORRECT_LAT) < 1e-5)
                                
                            if not is_correct:
                                discrepancies.append(f"GPKG: {rel_path} -> table {tbl} has coords ({lon}, {lat}) and geom_coords {geom_coords}")
                            else:
                                print(f"  [OK] GPKG: {rel_path} -> table {tbl} -> row ID {row_dict.get('fid') or row_dict.get('rowid') or row[0]}")
                conn.close()
            except Exception as e:
                discrepancies.append(f"GPKG Error on {rel_path}: {e}")
                
        # 2. Check ZIP files
        elif f.endswith(".zip"):
            try:
                with zipfile.ZipFile(file_path, 'r') as zf:
                    for name in zf.namelist():
                        # GeoJSON files inside ZIP
                        if name.endswith(".geojson") and "RS" in name:
                            content = zf.read(name).decode("utf-8")
                            if "GLICERIO" in content.upper() or "GLICÉRIO" in content.upper() or "EUSTAQUIO" in content.upper():
                                data = json.loads(content)
                                for feat in data.get("features", []):
                                    props = feat.get("properties", {})
                                    nm_locvot = props.get("nm_locvot", "")
                                    ds_endereco = props.get("ds_endereco", "")
                                    nm_localidade = props.get("nm_localidade", "")
                                    if matches(nm_locvot, ds_endereco, nm_localidade):
                                        total_found += 1
                                        geom = feat.get("geometry", {})
                                        coords = geom.get("coordinates", [])
                                        lon = props.get("long")
                                        lat = props.get("lat")
                                        
                                        is_correct = (len(coords) == 2 and abs(coords[0] - CORRECT_LONG) < 1e-5 and abs(coords[1] - CORRECT_LAT) < 1e-5)
                                        is_correct = is_correct and (lon == CORRECT_LONG) and (lat == CORRECT_LAT)
                                        
                                        if not is_correct:
                                            discrepancies.append(f"GeoJSON Zip: {rel_path} -> {name} has coords={coords}, prop_long={lon}, prop_lat={lat}")
                                        else:
                                            print(f"  [OK] GeoJSON Zip: {rel_path} -> {name}")
                                        
                        # GPKG files inside ZIP
                        elif name.endswith(".gpkg"):
                            import tempfile
                            with tempfile.TemporaryDirectory() as temp_dir:
                                extracted = zf.extract(name, temp_dir)
                                conn = sqlite3.connect(extracted)
                                cursor = conn.cursor()
                                cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
                                tables = [r[0] for r in cursor.fetchall() if not r[0].startswith("gpkg_") and not r[0].startswith("rtree_") and r[0] != "sqlite_sequence"]
                                for tbl in tables:
                                    cursor.execute(f"PRAGMA table_info({tbl});")
                                    cols = [c[1] for c in cursor.fetchall()]
                                    cursor.execute(f"SELECT * FROM {tbl}")
                                    for row in cursor.fetchall():
                                        row_dict = dict(zip(cols, row))
                                        nm_locvot = row_dict.get("nm_locvot", "")
                                        ds_endereco = row_dict.get("ds_endereco", "")
                                        nm_localidade = row_dict.get("nm_localidade", "")
                                        if matches(nm_locvot, ds_endereco, nm_localidade):
                                            total_found += 1
                                            lon = row_dict.get("long")
                                            lat = row_dict.get("lat")
                                            geom = row_dict.get("geom")
                                            
                                            geom_coords = None
                                            if geom:
                                                try:
                                                    geom_coords = struct.unpack('<dd', geom[13:29])
                                                except Exception as e:
                                                    geom_coords = f"Error: {e}"
                                                    
                                            is_correct = (lon == CORRECT_LONG) and (lat == CORRECT_LAT)
                                            if geom_coords:
                                                is_correct = is_correct and (abs(geom_coords[0] - CORRECT_LONG) < 1e-5) and (abs(geom_coords[1] - CORRECT_LAT) < 1e-5)
                                                
                                            if not is_correct:
                                                discrepancies.append(f"GPKG Zip: {rel_path} -> {name} -> {tbl} has coords ({lon}, {lat}) and geom_coords {geom_coords}")
                                            else:
                                                print(f"  [OK] GPKG Zip: {rel_path} -> {name} -> {tbl} -> row ID {row_dict.get('fid') or row_dict.get('rowid') or row[0]}")
                                conn.close()
            except Exception as e:
                # pass on zips that are not of interest
                pass

print("\n================ Verification Summary ================")
print(f"Total matching elements checked: {total_found}")
if discrepancies:
    print(f"Discrepancies found: {len(discrepancies)}")
    for d in discrepancies:
        print("  -", d)
else:
    print("Verification complete: ALL files successfully patched with correct coordinates!")
print("======================================================")
