import json
import zipfile
import re

def normalize_slug(value):
    s = str(value or '').strip().upper()
    replacements = {'Á':'A','À':'A','Â':'A','Ã':'A','Ä':'A','É':'E','È':'E','Ê':'E','Ë':'E','Í':'I','Ì':'I','Î':'I','Ï':'I','Ó':'O','Ò':'O','Ô':'O','Õ':'O','Ö':'O','Ú':'U','Ù':'U','Û':'U','Ü':'U','Ç':'C','Ñ':'N'}
    for k, v in replacements.items():
        s = s.replace(k, v)
    s = re.sub(r'[^A-Z0-9]+', '_', s)
    return s.strip('_')

ALIASES = {
    'ITAPEJARA_D_OESTE': ['ITAPEJARA_D_OESTE', 'ITAPEJARA_DO_OESTE'],
    'ITAPEJARA_DO_OESTE': ['ITAPEJARA_D_OESTE', 'ITAPEJARA_DO_OESTE'],
    'DIAMANTE_D_OESTE': ['DIAMANTE_D_OESTE', 'DIAMANTE_DO_OESTE'],
    'DIAMANTE_DO_OESTE': ['DIAMANTE_D_OESTE', 'DIAMANTE_DO_OESTE'],
    'MUNHOZ_DE_MELO': ['MUNHOZ_DE_MELO', 'MUNHOZ_DE_MELLO'],
    'MUNHOZ_DE_MELLO': ['MUNHOZ_DE_MELO', 'MUNHOZ_DE_MELLO'],
    'SANTA_CRUZ_DE_MONTE_CASTELO': ['SANTA_CRUZ_DE_MONTE_CASTELO', 'SANTA_CRUZ_DE_MONTE_CASTEL'],
    'SANTA_CRUZ_DE_MONTE_CASTEL': ['SANTA_CRUZ_DE_MONTE_CASTELO', 'SANTA_CRUZ_DE_MONTE_CASTEL']
}

def get_aliases(name):
    norm = normalize_slug(name)
    al = ALIASES.get(norm, [norm])
    return set([norm] + al)

# Load PR geojson
with open('resultados_geo_backup/municipios_hd/municipios_PR.geojson', encoding='utf-8') as f:
    geo = json.load(f)

# Load Censo 2006 PR to simulate muniNameMap and muniIbgeMap
with zipfile.ZipFile('resultados_geo/Censo 2006/censo_2006_PR.zip') as z:
    with z.open('censo_2006_PR.json') as f:
        censo = json.load(f)

muni_name_map = {}
muni_ibge_map = {}
for k, row in censo.get('RESULTS', {}).items():
    parts = k.split('_')
    if len(parts) >= 2:
        cd = parts[1]
        nm = row.get('nm_localidade')
        ibge = row.get('cod_localidade_ibge')
        if cd and nm and cd not in muni_name_map: muni_name_map[cd] = nm
        if cd and ibge and cd not in muni_ibge_map: muni_ibge_map[cd] = str(ibge)

summary = {}
with zipfile.ZipFile('resultados_geo/Majoritarias 2002/presidente_2002_t1_PR.zip') as z:
    with z.open('presidente_2002_t1_PR.json') as f:
        data_2002 = json.load(f)

raw_totals_by_city = {}
ibge_by_city = {}
for k, v_map in data_2002.get('RESULTS', {}).items():
    parts = k.split('_')
    if len(parts) < 3: continue
    cd = parts[1]
    city_name = muni_name_map.get(cd)
    if not city_name: continue
    if city_name not in raw_totals_by_city: raw_totals_by_city[city_name] = {}
    ibge = muni_ibge_map.get(cd)
    if ibge and city_name not in ibge_by_city: ibge_by_city[city_name] = ibge
    for cid, v in v_map.items():
        raw_totals_by_city[city_name][cid] = raw_totals_by_city[city_name].get(cid, 0) + v

for city_name, raw in raw_totals_by_city.items():
    slug = normalize_slug(city_name)
    ibge = ibge_by_city.get(city_name, '')
    entry = {'nome': city_name, 'muniCode': ibge}
    summary[slug] = entry
    summary[city_name] = entry
    if ibge:
        summary[ibge] = entry
        summary[ibge[:6]] = entry

# Test matching for all 399 features in PR geojson
matched_count = 0
unmatched_features = []
for feat in geo['features']:
    props = feat['properties']
    cd_mun = str(props['CD_MUN']).strip()
    nm_mun = str(props['NM_MUN']).strip()
    
    found = None
    if cd_mun and cd_mun in summary:
        found = summary[cd_mun]
    elif cd_mun and cd_mun[:6] in summary:
        found = summary[cd_mun[:6]]
    else:
        for alias_slug in get_aliases(nm_mun):
            if alias_slug in summary:
                found = summary[alias_slug]
                break
    
    if found:
        matched_count += 1
    else:
        unmatched_features.append((cd_mun, nm_mun))

print(f"Total PR Features: {len(geo['features'])}")
print(f"Total Matched: {matched_count} / {len(geo['features'])}")
print(f"Unmatched: {len(unmatched_features)}: {unmatched_features}")
