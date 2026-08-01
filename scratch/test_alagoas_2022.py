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

# Load AL 2022 Presidente
with zipfile.ZipFile('resultados_geo/resultados_presidente_nacional_2022.zip') as z:
    with z.open('resultados_presidente_nacional_2022.geojson') as f:
        data_2022 = json.load(f)

al_features = [f for f in data_2022['features'] if f['properties'].get('SG_UF') == 'AL' or f['properties'].get('sg_uf') == 'AL']
print("2022 AL features count:", len(al_features))

if al_features:
    f0 = al_features[0]['properties']
    print("AL feature 0 props:", f0.get('nm_localidade'), f0.get('SG_UF'), f0.get('cod_localidade_ibge'))

maceio_features = [f for f in al_features if 'MACEIO' in norm(f['properties'].get('nm_localidade'))]
print("Maceio features count:", len(maceio_features))
