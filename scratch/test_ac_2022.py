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

# Load AC 2022 Presidente
with zipfile.ZipFile('resultados_geo/resultados_presidente_nacional_2022.zip') as z:
    with z.open('resultados_presidente_nacional_2022.geojson') as f:
        data_2022 = json.load(f)

ac_features = [f for f in data_2022['features'] if f['properties'].get('SG_UF') == 'AC' or f['properties'].get('sg_uf') == 'AC']
print("2022 AC features count:", len(ac_features))

if ac_features:
    f0 = ac_features[0]['properties']
    print("AC feature 0 sample keys:", list(f0.keys())[:15])
    print("nm_localidade:", f0.get('nm_localidade'))
    print("Comparecimento 1T:", f0.get('Comparecimento 1T'))
    print("Comparecimento:", f0.get('Comparecimento'))
    print("Total_Votos_Validos 1T:", f0.get('Total_Votos_Validos 1T'))
    print("Votos_Brancos 1T:", f0.get('Votos_Brancos 1T'))
    print("Votos_Nulos 1T:", f0.get('Votos_Nulos 1T'))

rio_branco_features = [f for f in ac_features if norm(f['properties'].get('nm_localidade')) == 'RIOBRANCO']
print("Rio Branco features count:", len(rio_branco_features))
