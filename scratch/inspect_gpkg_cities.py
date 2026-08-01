import json
with open('resultados_geo/municipios_hd/municipios_AL.geojson', encoding='utf-8') as f:
    poly_geo = json.load(f)
print("First feature properties in municipios_AL.geojson:")
print(poly_geo['features'][0]['properties'])
