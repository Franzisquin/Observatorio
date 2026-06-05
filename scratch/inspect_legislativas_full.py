import json

path = r"c:\mapas\Observatorio\resultados_geo\Legislativas 2002\official_totals_2002.json"
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)

if "RO" in data:
    ro = data["RO"]
    print("Keys in RO:", list(ro.keys()))
    for cargo in ro:
        print(f"\nCargo: {cargo}")
        c_data = ro[cargo]
        print("Keys:", list(c_data.keys()))
        if "stats" in c_data:
            print("Stats keys:", list(c_data["stats"].keys()))
        if "coalitions" in c_data:
            print(f"Number of coalitions: {len(c_data['coalitions'])}")
            if len(c_data['coalitions']) > 0:
                print("First coalition keys:", list(c_data['coalitions'][0].keys()))
                print("First coalition candidate list length:", len(c_data['coalitions'][0].get("candidates", [])))
                if len(c_data['coalitions'][0].get("candidates", [])) > 0:
                    print("First candidate sample:", c_data['coalitions'][0]["candidates"][0])
else:
    print("RO not in data")
