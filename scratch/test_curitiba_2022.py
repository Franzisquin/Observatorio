import sqlite3
import zipfile
import json
import re

def norm(s):
    if not s: return ''
    s = str(s).strip().upper()
    replacements = {'Á':'A','À':'A','Â':'A','Ã':'A','Ä':'A','É':'E','È':'E','Ê':'E','Ë':'E','Í':'I','Ì':'I','Î':'I','Ï':'I','Ó':'O','Ò':'O','Ô':'O','Õ':'O','Ö':'O','Ú':'U','Ù':'U','Û':'U','Ü':'U','Ç':'C','Ñ':'N'}
    for k, v in replacements.items(): s = s.replace(k, v)
    return re.sub(r'[^A-Z0-9]+', '', s)

def normalize_slug(v):
    return norm(v)

def matches_muni_name(req, cand):
    r_slug = norm(req)
    c_slug = norm(cand)
    return r_slug == c_slug or r_slug in c_slug or c_slug in r_slug

# Load SQLite GPKG 2022 for PR
conn = sqlite3.connect('scratch/locais_votacao_2022.gpkg')
cursor = conn.cursor()
cursor.execute("SELECT sg_uf, cod_localidade_ibge, nr_zona, nr_locvot, nm_localidade, nm_locvot, ds_endereco, ds_bairro, long, lat FROM locais_votacao_2022_ENRIQUECIDO WHERE sg_uf = 'PR'")
rows = cursor.fetchall()

with zipfile.ZipFile('resultados_geo/Censo 2022/censo_2022_PR.zip') as z:
    with z.open('censo_2022_PR.json') as f:
        census_json = json.load(f)

with zipfile.ZipFile('resultados_geo/Majoritarias 2022/senador_2022_t1_PR.zip') as z:
    with z.open('senador_2022_t1_PR.json') as f:
        senador_json = json.load(f)

result_keys = set(senador_json.get('RESULTS', {}).keys())

census_by_city_zone_local = {}
census_by_name_bairro = {}
for fallback_key, row in census_json.get('RESULTS', {}).items():
    if not row: continue
    try:
        zona = int(row['nr_zona'])
        local = int(row['nr_locvot'])
    except: continue
    zl_key = f"{zona}_{local}"
    cidade = norm(row.get('nm_localidade'))
    local_nome = norm(row.get('nm_locvot'))
    bairro = norm(row.get('ds_bairro'))
    local_key = str(row.get('local_key') or fallback_key or '')
    row_copy = dict(row)
    row_copy['id_unico'] = local_key
    if cidade: census_by_city_zone_local[f"{cidade}|{zl_key}"] = row_copy
    if local_nome: census_by_name_bairro[f"{local_nome}|{bairro}"] = row_copy

geojson_features = []
unique_cidades = set()
for r in rows:
    sg_uf, ibge, nr_zona, nr_locvot, nm_localidade, nm_locvot, addr, bairro, long, lat = r
    zl_key = f"{int(nr_zona)}_{int(nr_locvot)}"
    city_zl_key = f"{norm(nm_localidade)}|{zl_key}"
    name_bairro_key = f"{norm(nm_locvot)}|{norm(bairro)}"
    c_props = census_by_city_zone_local.get(city_zl_key) or census_by_name_bairro.get(name_bairro_key)
    local_key = c_props.get('id_unico') if c_props else None
    if local_key and local_key in result_keys:
        props = {
            'nm_localidade': nm_localidade,
            'nm_locvot': nm_locvot,
            'ds_bairro': bairro,
            'id_unico': local_key,
            'local_key': local_key,
            'Total_Votos_Validos 1T': 100 # sample
        }
        feat = {'type':'Feature', 'geometry':{'type':'Point','coordinates':[long, lat]}, 'properties': props}
        geojson_features.append(feat)
        if nm_localidade: unique_cidades.add(nm_localidade)

print("Unique cidades count in JS:", len(unique_cidades))
print("Sample unique cidades:", list(unique_cidades)[:10])

# Simulate clicking on Curitiba in municipios_PR.geojson where NM_MUN = 'Curitiba'
nome = 'Curitiba'
matched_city = next((cand for cand in unique_cidades if matches_muni_name(nome, cand)), nome)
print("matchedCity when clicking 'Curitiba':", repr(matched_city))

current_cidade_filter = matched_city

# Now test filterFeature on geojson_features
def filter_feature(f, current_cidade_filter):
    props = f['properties']
    if current_cidade_filter != 'all':
        city_name = str(props.get('nm_localidade') or '').strip()
        selected_city = str(current_cidade_filter or '').strip()
        same_city = (city_name == selected_city or
                     norm(city_name) == norm(selected_city) or
                     matches_muni_name(selected_city, city_name))
        if not same_city: return False
    return True

visible_features = [f for f in geojson_features if filter_feature(f, current_cidade_filter)]
print("Visible features count for Curitiba:", len(visible_features))
