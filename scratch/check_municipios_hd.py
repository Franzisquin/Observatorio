import os
import zipfile
import json
import re

workspace = r"c:\mapas\Observatorio"

for file in os.listdir(workspace):
    if file.startswith('municipios_hd_') and file.endswith('.zip'):
        zpath = os.path.join(workspace, file)
        try:
            with zipfile.ZipFile(zpath, 'r') as z:
                for zname in z.namelist():
                    if 'ba.geojson' in zname.lower() or 'ba' in zname.lower():
                        print(f"Found {zname} in {file}")
                        with z.open(zname) as f:
                            data_bytes = f.read()
                            try:
                                j = json.loads(data_bytes.decode('utf-8'))
                                for feat in j.get('features', []):
                                    props = feat.get('properties', {})
                                    name = props.get('NM_MUN') or props.get('nm_mun') or props.get('NOME') or props.get('municipio') or ''
                                    code = props.get('CD_MUN') or props.get('cd_mun') or ''
                                    if 'PIL' in str(name).upper() or 'ARCADO' in str(name).upper() or str(code).startswith('292480'):
                                        print(f"  FEATURE: Code={code}, Name={repr(name)}, Raw Bytes={repr(name.encode('utf-8') if isinstance(name, str) else name)}")
                            except Exception as ex:
                                print(f"  Error reading json: {ex}")
        except Exception as e:
            pass
