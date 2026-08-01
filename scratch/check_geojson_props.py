import json
import sqlite3
import zipfile
import os
import glob

# Find municipios_PR.geojson
pr_geojson = None
for root, dirs, files in os.walk('.'):
    for f in files:
        if f == 'municipios_PR.geojson':
            pr_geojson = os.path.join(root, f)
            break

if not pr_geojson:
    # check inside zip files in resultados_geo
    for zpath in glob.glob('resultados_geo/municipios_hd_*.zip'):
        with zipfile.ZipFile(zpath) as z:
            if 'municipios_PR.geojson' in z.namelist():
                z.extract('municipios_PR.geojson', 'scratch')
                pr_geojson = os.path.join('scratch', 'municipios_PR.geojson')
                break

print('PR GeoJSON path:', pr_geojson)
if pr_geojson:
    with open(pr_geojson, encoding='utf-8') as f:
        geo = json.load(f)
    print('GeoJSON features count:', len(geo['features']))
    first_props = geo['features'][0]['properties']
    print('First feature properties:', first_props)
