import zipfile
import json

zip_path = 'resultados_geo/Municipais 2000/prefeito_2000_ord_t1_MA.zip'
json_name = '9210_SAO_LUIS.json'

with zipfile.ZipFile(zip_path, 'r') as z:
    data = json.loads(z.read(json_name))

print("cand_names:")
print(data.get("METADATA", {}).get("cand_names", {}))
