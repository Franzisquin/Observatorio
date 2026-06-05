import json
import os

path = r"c:\mapas\Observatorio\resultados_geo\Legislativas 2002\official_totals_2002.json"
if os.path.exists(path):
    with open(path, "r", encoding="utf-8") as f:
        content = f.read(1000)
    print("Beginning of official_totals_2002.json:")
    print(content)
else:
    print(f"Path not found: {path}")
