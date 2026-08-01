import json

with open('lista_municipios.json', encoding='utf-8') as f:
    data = json.load(f)

print("Type of lista_municipios.json:", type(data))
if isinstance(data, list):
    print("Count:", len(data))
    print("First 3 items:", data[:3])
elif isinstance(data, dict):
    print("Keys count:", len(data))
    first_keys = list(data.keys())[:3]
    print("First 3 keys and values:", {k: data[k] for k in first_keys})
