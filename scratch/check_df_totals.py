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
        # Check keys or search for Brasília
        # Struct of data is usually: {cargo: {turno: {city: totals}}}
        # Let's look for DF or Brasilia in the inner dicts
        found = False
        for cargo, c_data in data.items():
            for turno, t_data in c_data.items():
                # t_data keys are city names or codes?
                # Let's inspect some keys:
                cities = list(t_data.keys())
                df_cities = [c for c in cities if "BRASILIA" in c.upper() or "BRASÍLIA" in c.upper() or "DF" in c.upper()]
                if df_cities:
                    print(f"  Cargo: {cargo}, Turno: {turno}")
                    print(f"  Matching keys: {df_cities[:10]}")
                    found = True
                    break
            if found:
                break
    else:
        print(f"Path not found: {p}")
