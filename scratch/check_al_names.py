import json

with open(r"c:\mapas\Observatorio\lista_municipios.json", "r", encoding="utf-8-sig") as f:
    official_cities = json.load(f)

for c in official_cities.get("AL", []):
    if "OLHO" in c.upper() or "TANQUE" in c.upper():
        print("Official AL:", repr(c))
