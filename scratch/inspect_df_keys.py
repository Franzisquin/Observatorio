import json
import os

paths = [
    r"c:\mapas\Observatorio\resultados_geo\Legislativas 2002\official_totals_2002.json",
    r"c:\mapas\Observatorio\resultados_geo\Legislativas 2006\official_totals_2006.json"
]

for p in paths:
    if os.path.exists(p):
        print(f"\nFile: {p}")
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        if "DF" in data:
            print("  DF key exists!")
            df_data = data["DF"]
            print("  DF inner keys (cargos):", list(df_data.keys()))
            # Let's see if there is any city name or if DF has no city-level totals
            # because DF is just one electoral unit or has no municipalities
        else:
            print("  DF key does NOT exist!")
    else:
        print(f"Path not found: {p}")
