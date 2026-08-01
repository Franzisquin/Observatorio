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

with zipfile.ZipFile('resultados_geo/locais_votacao_2022_gpkg.zip') as z:
    z.extract('locais_votacao_2022.gpkg', 'scratch/')

conn = sqlite3.connect('scratch/locais_votacao_2022.gpkg')
cursor = conn.cursor()
cursor.execute("SELECT sg_uf, cod_localidade_ibge, nr_zona, nr_locvot, nm_localidade, nm_locvot, ds_endereco, ds_bairro, long, lat FROM locais_votacao_2022_ENRIQUECIDO WHERE sg_uf = 'PR'")
rows = cursor.fetchall()
print("SQLite 2022 PR rows:", len(rows))

with zipfile.ZipFile('resultados_geo/Censo 2022/censo_2022_PR.zip') as z:
    with z.open('censo_2022_PR.json') as f:
        census_json = json.load(f)

with zipfile.ZipFile('resultados_geo/Majoritarias 2022/senador_2022_t1_PR.zip') as z:
    with z.open('senador_2022_t1_PR.json') as f:
        senador_json = json.load(f)

result_keys = set(senador_json.get('RESULTS', {}).keys())
print("Senador 2022 PR result_keys count:", len(result_keys))

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

matched_features = []
curitiba_matched = []
for r in rows:
    sg_uf, ibge, nr_zona, nr_locvot, nm_localidade, nm_locvot, addr, bairro, long, lat = r
    zl_key = f"{int(nr_zona)}_{int(nr_locvot)}"
    city_zl_key = f"{norm(nm_localidade)}|{zl_key}"
    name_bairro_key = f"{norm(nm_locvot)}|{norm(bairro)}"
    c_props = census_by_city_zone_local.get(city_zl_key) or census_by_name_bairro.get(name_bairro_key)
    if c_props:
        local_key = c_props.get('id_unico')
        if local_key in result_keys:
            matched_features.append((nm_localidade, zl_key, local_key))
            if norm(nm_localidade) == 'CURITIBA':
                curitiba_matched.append((nm_localidade, zl_key, local_key))

print(f"Total GPKG features matched with Senador results: {len(matched_features)} / {len(rows)}")
print(f"Curitiba features matched: {len(curitiba_matched)}")
