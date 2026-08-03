import os
import zipfile
import json
import re

workspace = r"c:\mapas\Observatorio"
geo_dir = os.path.join(workspace, "resultados_geo")

found_in_zips = []

for root, dirs, files in os.walk(geo_dir):
    for file in files:
        if file.endswith('.zip'):
            zpath = os.path.join(root, file)
            try:
                with zipfile.ZipFile(zpath, 'r') as z:
                    for zname in z.namelist():
                        if zname.endswith('.json'):
                            with z.open(zname) as f:
                                content_bytes = f.read()
                                # Search for \x11 or \x00-\x1f in raw bytes
                                if b'\x11' in content_bytes or b'\x12' in content_bytes or b'\x10' in content_bytes:
                                    print(f"FOUND CONTROL BYTES IN ZIP: {file} -> {zname}")
                                    text = content_bytes.decode('utf-8', errors='replace')
                                    for line in text.splitlines():
                                        if '\x11' in line or '\x12' in line or '\x10' in line:
                                            print(f"  Line: {repr(line[:150])}")
                                
                                # Search for 'Pil' or 'Arcado' or 'BA' in json entries
                                if 'arcado' in zname.lower() or 'pil' in zname.lower():
                                    text = content_bytes.decode('utf-8', errors='replace')
                                    print(f"MATCH filename in zip {file} -> {zname}")
                                    if 'nome' in text.lower():
                                        # Parse JSON if possible
                                        try:
                                            j = json.loads(text)
                                            nome = j.get('nome') or j.get('NM_MUN')
                                            if nome:
                                                print(f"  JSON name: {repr(nome)}")
                                        except Exception:
                                            pass
            except Exception as e:
                pass

print("ZIP scan complete.")
