import zipfile
import json

zip_path = 'resultados_geo/Municipais 2000/prefeito_2000_ord_t1_BA.zip'
json_name = '35157_FEIRA_DE_SANTANA.json'

with zipfile.ZipFile(zip_path, 'r') as z:
    data = json.loads(z.read(json_name))

print("Keys in JSON:", list(data.keys()))
print("\nMETADATA keys:", list(data.get("METADATA", {}).keys()))
if "official_summary" in data.get("METADATA", {}):
    print("\nofficial_summary 1T:", data["METADATA"]["official_summary"].get("1T", {}).get("votesByDisplayKey", {}))
else:
    print("\nNo official_summary in METADATA")

print("\ncand_names:")
print(data.get("METADATA", {}).get("cand_names", {}))
