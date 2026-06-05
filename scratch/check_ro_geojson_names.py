import json
import os

path = r"c:\mapas\Observatorio\resultados_geo\municipios_hd\municipios_RO.geojson"
if not os.path.exists(path):
    path = r"c:\mapas\Observatorio\resultados_geo\municipios\municipios_RO.geojson"

with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)

for f in data.get("features", []):
    name = f["properties"].get("NM_MUN", "")
    if "ALVORADA" in name.upper():
        print("GeoJSON RO Alvorada name:", repr(name))
