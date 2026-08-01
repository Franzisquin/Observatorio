import zipfile
import json
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

# Load 2022 AL Presidente
with zipfile.ZipFile('resultados_geo/resultados_presidente_nacional_2022.zip') as z:
    with z.open('resultados_presidente_nacional_2022.geojson') as f:
        data_2022 = json.load(f)

al_features = [f for f in data_2022['features'] if f['properties'].get('SG_UF') == 'AL' or f['properties'].get('sg_uf') == 'AL']

def get_comparecimento(props, cargo, turno):
    c1 = props.get(f'Comparecimento {turno}') or props.get('Comparecimento')
    if c1 is not None:
        try: return float(c1)
        except: pass
    v = props.get(f'Total_Votos_Validos {turno}') or 0
    b = props.get(f'Votos_Brancos {turno}') or 0
    n = props.get(f'Votos_Nulos {turno}') or 0
    try: return float(v) + float(b) + float(n)
    except: return 0.0

current_cidade_filter = "MACEIO"

def matches_location_filters(props):
    city_name = str(props.get('nm_localidade') or '').strip()
    selected_city = str(current_cidade_filter).strip()
    same_city = city_name == selected_city or norm(city_name) == norm(selected_city) or matches_muni_name(selected_city, city_name)
    return same_city

def filter_feature(f):
    props = f['properties']
    c1 = get_comparecimento(props, 'presidente_ord', '1T')
    if c1 == 0:
        c2 = get_comparecimento(props, 'presidente_ord', '2T')
        if c2 == 0: return False
    return matches_location_filters(props)

filtered = [f for f in al_features if filter_feature(f)]
print("Total AL features:", len(al_features))
print("Filtered for MACEIO:", len(filtered))
