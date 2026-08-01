import zipfile
import json
import re

def norm(s):
    if not s: return ''
    s = str(s).strip().upper()
    replacements = {'Á':'A','À':'A','Â':'A','Ã':'A','Ä':'A','É':'E','È':'E','Ê':'E','Ë':'E','Í':'I','Ì':'I','Î':'I','Ï':'I','Ó':'O','Ò':'O','Ô':'O','Õ':'O','Ö':'O','Ú':'U','Ù':'U','Û':'U','Ü':'U','Ç':'C','Ñ':'N'}
    for k, v in replacements.items(): s = s.replace(k, v)
    return re.sub(r'[^A-Z0-9]+', '', s)

# Load Censo AC 2022
with zipfile.ZipFile('resultados_geo/Censo 2022/censo_2022_AC.zip') as z:
    with z.open('censo_2022_AC.json') as f:
        censo_ac = json.load(f)

censo_keys = list(censo_ac['RESULTS'].keys())
print("Censo AC total entries:", len(censo_keys))
r0 = list(censo_ac['RESULTS'].values())[0]
print("Censo AC entry 0:", r0.get('nm_localidade'), r0.get('nr_zona'), r0.get('nr_locvot'), r0.get('local_key'))

# Load Presidente AC 2022
with zipfile.ZipFile('resultados_geo/resultados_presidente_nacional_2022.zip') as z:
    with z.open('resultados_presidente_nacional_2022.geojson') as f:
        geo_2022 = json.load(f)

ac_geo_features = [f for f in geo_2022['features'] if f['properties'].get('SG_UF') == 'AL' or f['properties'].get('sg_uf') == 'AC' or f['properties'].get('SG_UF') == 'AC']
print("GeoJSON AC features count:", len(ac_geo_features))
gf0 = ac_geo_features[0]['properties']
print("GeoJSON feature 0 props:", gf0.get('nm_localidade'), gf0.get('local_id'), gf0.get('id_unico'), gf0.get('ID_UNICO'))
