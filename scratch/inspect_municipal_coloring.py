import json
import zipfile
import glob

# 1. Load AC GeoJSON properties
with open('resultados_geo/municipios_hd/municipios_ac.geojson', 'r', encoding='utf-8') as f:
    ac_geojson = json.load(f)

print("AC Polygon features count:", len(ac_geojson['features']))
sample_props = ac_geojson['features'][0]['properties']
print("Sample Polygon properties:", sample_props)

# 2. Inspect zip file for Municipais 2024 AC prefeitos
zip_path = 'resultados_geo/Municipais 2024/prefeito_2024_ord_t1_AC.zip'
try:
    with zipfile.ZipFile(zip_path, 'r') as z:
        namelist = z.namelist()
        print("Total files in zip:", len(namelist))
        resumo_files = [f for f in namelist if f.endswith('_resumo.json')]
        print("Resumo files count:", len(resumo_files))
        if resumo_files:
            sample_resumo = json.loads(z.read(resumo_files[0]).decode('utf-8'))
            print("Sample resumo file:", resumo_files[0])
            print("Sample resumo top level:", {k: sample_resumo[k] for k in list(sample_resumo.keys())[:10]})
except Exception as e:
    print("Error reading zip:", e)
