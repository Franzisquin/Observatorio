import json
with open(r"c:\mapas\Observatorio\lista_municipios.json", "r", encoding="utf-8-sig") as f:
    official = json.load(f)
rj_cities = official.get("RJ", [])
for city in rj_cities:
    if any(x in city.upper() for x in ["CAMPOS", "BUZIOS", "PARATY", "PARATI", "PATY", "TRAJANO", "VARRE"]):
        print(city)
