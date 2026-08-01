import zipfile
import json
import sqlite3
import re

def norm(s):
    if not s: return ''
    s = str(s).strip().upper()
    replacements = {'Á':'A','À':'A','Â':'A','Ã':'A','Ä':'A','É':'E','È':'E','Ê':'E','Ë':'E','Í':'I','Ì':'I','Î':'I','Ï':'I','Ó':'O','Ò':'O','Ô':'O','Õ':'O','Ö':'O','Ú':'U','Ù':'U','Û':'U','Ü':'U','Ç':'C','Ñ':'N'}
    for k, v in replacements.items(): s = s.replace(k, v)
    return re.sub(r'[^A-Z0-9]+', '', s)

def matches_muni_name(req, cand):
    r_slug = norm(req)
    c_slug = norm(cand)
    return r_slug == c_slug or r_slug in c_slug or c_slug in r_slug

# Test 2022 PR Presidente
with zipfile.ZipFile('resultados_geo/resultados_presidente_nacional_2022.zip') as z:
    with z.open('resultados_presidente_nacional_2022.geojson') as f:
        data_2022 = json.load(f)

pr_2022_features = [f for f in data_2022['features'] if f['properties'].get('SG_UF') == 'PR' or f['properties'].get('sg_uf') == 'PR']
print("2022 PR Presidente features count:", len(pr_2022_features))

# Test filtering for Curitiba
curitiba_2022 = [f for f in pr_2022_features if norm(f['properties'].get('nm_localidade') or f['properties'].get('NM_LOCALIDADE')) == 'CURITIBA']
print("2022 Curitiba features count:", len(curitiba_2022))

# Test 2018 PR Presidente
with zipfile.ZipFile('resultados_geo/Majoritarias 2018/presidente_2018_t1_PR.zip') as z:
    with z.open('presidente_2018_t1_PR.json') as f:
        data_2018_json = json.load(f)

print("2018 PR Presidente JSON results count:", len(data_2018_json.get('RESULTS', {})))

# Test 2002 PR Presidente
with zipfile.ZipFile('resultados_geo/Majoritarias 2002/presidente_2002_t1_PR.zip') as z:
    with z.open('presidente_2002_t1_PR.json') as f:
        data_2002_json = json.load(f)

print("2002 PR Presidente JSON results count:", len(data_2002_json.get('RESULTS', {})))
