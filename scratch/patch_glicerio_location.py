import os
import zipfile
import sqlite3
import json
import struct
import tempfile
import shutil

base_dir = r"c:\Users\lixov\OneDrive\Documentos\Observatorio"
resultados_geo = os.path.join(base_dir, "resultados_geo")

CORRECT_LONG = -51.177001
CORRECT_LAT = -30.210617
GEOM_BLOB = b'GP\x00\x01\xe6\x10\x00\x00\x01\x01\x00\x00\x00' + struct.pack('<dd', CORRECT_LONG, CORRECT_LAT)

def matches(nm_locvot, ds_endereco, nm_localidade):
    if not nm_locvot or not ds_endereco or not nm_localidade:
        return False
    if "PORTO ALEGRE" not in nm_localidade.upper():
        return False
    name_match = "GLICERIO" in nm_locvot.upper() or "GLICÉRIO" in nm_locvot.upper()
    addr_match = "EUSTAQUIO" in ds_endereco.upper() or "EUSTÁQUIO" in ds_endereco.upper()
    return name_match or addr_match

def patch_gpkg(gpkg_path):
    print(f"  Patching GPKG database: {gpkg_path}")
    conn = sqlite3.connect(gpkg_path)
    cursor = conn.cursor()
    
    # List tables
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = [r[0] for r in cursor.fetchall() if not r[0].startswith("gpkg_") and not r[0].startswith("rtree_") and r[0] != "sqlite_sequence"]
    
    for tbl in tables:
        cursor.execute(f"PRAGMA table_info({tbl});")
        cols = [c[1] for c in cursor.fetchall()]
        
        # Select all rows to check if any matches
        cursor.execute(f"SELECT * FROM {tbl}")
        rows = cursor.fetchall()
        matching_fids = []
        
        for row in rows:
            row_dict = dict(zip(cols, row))
            nm_locvot = row_dict.get("nm_locvot", "")
            ds_endereco = row_dict.get("ds_endereco", "")
            nm_localidade = row_dict.get("nm_localidade", "")
            if matches(nm_locvot, ds_endereco, nm_localidade):
                fid = row_dict.get('fid') or row_dict.get('rowid') or row.get('id')
                if fid is None:
                    # Let's search if 'fid' or 'rowid' is in columns, else use the first element
                    if 'fid' in cols:
                        fid = row_dict['fid']
                    elif 'rowid' in cols:
                        fid = row_dict['rowid']
                    else:
                        # SQLite rowid is always accessible via select rowid, * from tbl
                        # but let's assume first column is the primary key/id
                        fid = row[0]
                matching_fids.append(fid)
                
        if not matching_fids:
            continue
            
        print(f"    Table {tbl}: found {len(matching_fids)} matching rows.")
        
        # Drop triggers temporarily
        cursor.execute(f"SELECT name, sql FROM sqlite_master WHERE type='trigger' AND tbl_name=?;", (tbl,))
        triggers = cursor.fetchall()
        print(f"    Dropping {len(triggers)} triggers on {tbl}...")
        for name, _ in triggers:
            cursor.execute(f"DROP TRIGGER \"{name}\";")
            
        try:
            # Update columns
            update_clauses = ["long = ?", "lat = ?", "geom = ?"]
            params = [CORRECT_LONG, CORRECT_LAT, sqlite3.Binary(GEOM_BLOB)]
            
            if "pred_long" in cols:
                update_clauses.append("pred_long = ?")
                params.append(CORRECT_LONG)
            if "pred_lat" in cols:
                update_clauses.append("pred_lat = ?")
                params.append(CORRECT_LAT)
            if "tse_long" in cols:
                update_clauses.append("tse_long = ?")
                params.append(CORRECT_LONG)
            if "tse_lat" in cols:
                update_clauses.append("tse_lat = ?")
                params.append(CORRECT_LAT)
            if "pred_dist" in cols:
                update_clauses.append("pred_dist = ?")
                params.append(0.0)
                
            for fid in matching_fids:
                # Find matching column for ID
                id_col = 'fid' if 'fid' in cols else cols[0]
                query = f"UPDATE {tbl} SET " + ", ".join(update_clauses) + f" WHERE {id_col} = ?"
                cursor.execute(query, params + [fid])
                print(f"      Updated row ID {fid} in table {tbl}.")
                
                # Update rtree table if it exists
                rtree_table = f"rtree_{tbl}_geom"
                cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?;", (rtree_table,))
                if cursor.fetchone():
                    cursor.execute(f"UPDATE {rtree_table} SET minx = ?, maxx = ?, miny = ?, maxy = ? WHERE id = ?;", 
                                   (CORRECT_LONG, CORRECT_LONG, CORRECT_LAT, CORRECT_LAT, fid))
                    print(f"      Updated spatial index for row ID {fid} in {rtree_table}.")
                    
            conn.commit()
        except Exception as e:
            conn.rollback()
            print(f"    Error updating table {tbl}: {e}")
            raise
        finally:
            # Recreate triggers
            print(f"    Recreating {len(triggers)} triggers on {tbl}...")
            for name, sql in triggers:
                cursor.execute(sql)
            conn.commit()
            
    conn.close()

def patch_zip_file(zip_path):
    print(f"Processing ZIP: {zip_path}")
    temp_dir = tempfile.mkdtemp()
    temp_zip_path = os.path.join(temp_dir, "temp_archive.zip")
    modified = False
    
    try:
        with zipfile.ZipFile(zip_path, 'r') as z_in:
            with zipfile.ZipFile(temp_zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as z_out:
                for item in z_in.infolist():
                    name = item.filename
                    
                    # 1. GPKG file inside ZIP
                    if name.endswith(".gpkg"):
                        extracted_gpkg = z_in.extract(name, temp_dir)
                        # We patch the extracted GPKG
                        patch_gpkg(extracted_gpkg)
                        # Write it back to the new zip
                        z_out.write(extracted_gpkg, name)
                        modified = True
                        
                    # 2. GeoJSON file inside ZIP
                    elif name.endswith(".geojson") and "RS" in name:
                        content_bytes = z_in.read(name)
                        content = content_bytes.decode("utf-8")
                        
                        if "GLICERIO" in content.upper() or "GLICÉRIO" in content.upper() or "EUSTAQUIO" in content.upper():
                            data = json.loads(content)
                            geojson_modified = False
                            
                            for feat in data.get("features", []):
                                props = feat.get("properties", {})
                                nm_locvot = props.get("nm_locvot", "")
                                ds_endereco = props.get("ds_endereco", "")
                                nm_localidade = props.get("nm_localidade", "")
                                
                                if matches(nm_locvot, ds_endereco, nm_localidade):
                                    # Update geometry coordinates
                                    feat["geometry"]["coordinates"] = [CORRECT_LONG, CORRECT_LAT]
                                    
                                    # Update properties
                                    props["long"] = CORRECT_LONG
                                    props["lat"] = CORRECT_LAT
                                    if "pred_long" in props:
                                        props["pred_long"] = CORRECT_LONG
                                    if "pred_lat" in props:
                                        props["pred_lat"] = CORRECT_LAT
                                    if "tse_long" in props:
                                        props["tse_long"] = CORRECT_LONG
                                    if "tse_lat" in props:
                                        props["tse_lat"] = CORRECT_LAT
                                    if "pred_dist" in props:
                                        props["pred_dist"] = 0.0
                                        
                                    geojson_modified = True
                                    print(f"    GeoJSON {name}: updated Glicerio Alves location.")
                                    
                            if geojson_modified:
                                new_content = json.dumps(data, ensure_ascii=False)
                                z_out.writestr(item, new_content.encode("utf-8"))
                                modified = True
                            else:
                                z_out.writestr(item, content_bytes)
                        else:
                            z_out.writestr(item, content_bytes)
                    else:
                        # Copy other files untouched
                        z_out.writestr(item, z_in.read(name))
                        
        if modified:
            shutil.move(temp_zip_path, zip_path)
            print(f"  Successfully updated ZIP file: {zip_path}")
            
    finally:
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)

# Step 1: Patch direct GPKG files in root folder
for f in os.listdir(resultados_geo):
    if f.endswith(".gpkg"):
        gpkg_path = os.path.join(resultados_geo, f)
        patch_gpkg(gpkg_path)

# Step 2: Patch ZIP files recursively
for root, dirs, files in os.walk(resultados_geo):
    for f in files:
        if f.endswith(".zip"):
            zip_path = os.path.join(root, f)
            patch_zip_file(zip_path)

print("Patching complete!")
