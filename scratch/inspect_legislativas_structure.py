import json

path = r"c:\mapas\Observatorio\resultados_geo\Legislativas 2002\official_totals_2002.json"
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)

# Let's inspect the RO (Rondonia) data in official_totals_2002.json
if "RO" in data:
    ro_data = data["RO"]
    print("RO inner keys (cargos):", list(ro_data.keys()))
    if "f" in ro_data:
        f_data = ro_data["f"]
        print("RO cargo 'f' keys:", list(f_data.keys()))
        # Let's print some details about one of the keys under 'f'
        # to understand the structure of the data!
        for k in list(f_data.keys())[:3]:
            print(f"Key: {k}, type: {type(f_data[k])}")
            if isinstance(f_data[k], dict):
                print(f"  Keys inside: {list(f_data[k].keys())}")
                # Print a small subset of the data inside
                print(f"  Sample: {str(f_data[k])[:300]}")
else:
    print("RO key not found in data")
