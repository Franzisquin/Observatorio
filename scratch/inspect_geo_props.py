import zipfile
import json

with zipfile.ZipFile('resultados_geo/resultados_presidente_nacional_2022.zip') as z:
    with z.open('resultados_presidente_nacional_2022.geojson') as f:
        data_2022_geo = json.load(f)

ac_f = [f for f in data_2022_geo['features'] if f['properties'].get('SG_UF') == 'AC' or f['properties'].get('sg_uf') == 'AC']
print("2022 Presidente GeoJSON feature count for AC:", len(ac_f))
if ac_f:
    p = ac_f[0]['properties']
    print("Sample feature properties:")
    for k, v in list(p.items())[:30]:
        print(f"  {k}: {v}")
