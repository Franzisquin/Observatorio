import zipfile
import json
import os

zip_path = r"c:\Users\lixov\OneDrive\Documentos\Observatorio\resultados_geo\Municipais 2000\prefeito_2000_ord_t1_RJ.zip"
with zipfile.ZipFile(zip_path, 'r') as z:
    content = z.read('58130_CABO_FRIO.json')
    data = json.loads(content)
    results = data.get('RESULTS', {})
    for k, v in results.items():
        if v.get('45') == 1094 or v.get('12') == 528:
            print(f"Match found in results key {k}: {v}")
