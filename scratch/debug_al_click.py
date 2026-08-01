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

# Load municipios_AL.geojson
with open('resultados_geo/municipios/municipios_AL.geojson', encoding='utf-8') as f:
    muni_al = json.load(f)

print("Number of municipios in AL:", len(muni_al['features']))

# Load 2022 AL Presidente
with zipfile.ZipFile('resultados_geo/resultados_presidente_nacional_2022.zip') as z:
    with z.open('resultados_presidente_nacional_2022.geojson') as f:
        data_2022 = json.load(f)

al_features = [f for f in data_2022['features'] if f['properties'].get('SG_UF') == 'AL' or f['properties'].get('sg_uf') == 'AL']

# Collect unique nm_localidade from AL point features
unique_cidades_al = set()
for f in al_features:
    c = f['properties'].get('nm_localidade')
    if c: unique_cidades_al.add(c)

print("Unique cidades from point features in AL:", len(unique_cidades_al))

# Now test clicking EVERY municipality polygon in AL!
unmatched = []
for mf in muni_al['features']:
    props = mf['properties']
    nome = props.get('NM_MUN') or props.get('NM_MUNICIP') or props.get('name')
    matched_city = None
    for cand in unique_cidades_al:
        if matches_muni_name(nome, cand):
            matched_city = cand
            break
    
    if not matched_city:
        matched_city = nome
    
    # Check how many point features match matched_city!
    matched_points = []
    for pf in al_features:
        p_cidade = pf['properties'].get('nm_localidade')
        if p_cidade and (p_cidade == matched_city or norm(p_cidade) == norm(matched_city) or matches_muni_name(matched_city, p_cidade)):
            matched_points.append(pf)
    
    print(f"Muni polygon '{nome}' -> matched_city '{matched_city}' -> points matched: {len(matched_points)}")
    if len(matched_points) == 0:
        unmatched.append(nome)

print("\nUnmatched municipalities count:", len(unmatched))
