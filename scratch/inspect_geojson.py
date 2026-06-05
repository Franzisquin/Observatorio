import json
import os

path = r"c:\mapas\Observatorio\resultados_geo\municipios_hd\municipios_RO.geojson"
if not os.path.exists(path):
    path = r"c:\mapas\Observatorio\resultados_geo\municipios\municipios_RO.geojson"

if os.path.exists(path):
    print("GeoJSON found at:", path)
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    features = data.get("features", [])
    if features:
        print("First feature properties:", list(features[0]["properties"].keys()))
        print("First feature properties content:", features[0]["properties"])
    else:
        print("No features found in GeoJSON")
else:
    print("GeoJSON not found")
