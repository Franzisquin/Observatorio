import os
import zipfile
import sqlite3
import json

base_dir = r"c:\Users\lixov\OneDrive\Documentos\Observatorio"
resultados_geo = os.path.join(base_dir, "resultados_geo")

# We will search for:
# 1. School name containing "GLICERIO" or "GLICÉRIO" AND located in "PORTO ALEGRE"
# 2. Address containing "EUSTAQUIO" or "EUSTÁQUIO"

def matches(nm_locvot, ds_endereco, nm_localidade):
    if not nm_locvot or not ds_endereco or not nm_localidade:
        return False
    # Check if Porto Alegre
    if "PORTO ALEGRE" not in nm_localidade.upper():
        return False
    # Check if school name or address matches
    name_match = "GLICERIO" in nm_locvot.upper() or "GLICÉRIO" in nm_locvot.upper()
    addr_match = "EUSTAQUIO" in ds_endereco.upper() or "EUSTÁQUIO" in ds_endereco.upper()
    return name_match or addr_match

print("Searching recursively for GPKGs and ZIP files...")

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
                            print(f"  FOUND in GPKG: {rel_path} -> table {tbl}")
                            print(f"    row: id={row_dict.get('fid') or row_dict.get('local_id') or row_dict.get('ID_UNICO')}, nm={nm_locvot}, addr={ds_endereco}, coordinates=({row_dict.get('long') or row_dict.get('pred_long')}, {row_dict.get('lat') or row_dict.get('pred_lat')})")
                conn.close()
            except Exception as e:
                print(f"  Error checking GPKG {rel_path}: {e}")
                
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
                                        geom = feat.get("geometry", {})
                                        coords = geom.get("coordinates", [])
                                        print(f"  FOUND in GeoJSON Zip: {rel_path} -> {name}")
                                        print(f"    properties: ano={props.get('ano')}, ID_UNICO={props.get('ID_UNICO')}, local_id={props.get('local_id')}, name={nm_locvot}, addr={ds_endereco}, coords={coords}")
                                        
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
                                            print(f"  FOUND in GPKG Zip: {rel_path} -> {name} -> {tbl}")
                                            print(f"    row: id={row_dict.get('fid') or row_dict.get('local_id') or row_dict.get('ID_UNICO')}, nm={nm_locvot}, addr={ds_endereco}, coordinates=({row_dict.get('long') or row_dict.get('pred_long')}, {row_dict.get('lat') or row_dict.get('pred_lat')})")
                                conn.close()
            except Exception as e:
                # Some zip files may fail or have different structure, which is fine to ignore
                pass
