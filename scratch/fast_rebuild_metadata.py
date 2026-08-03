import urllib.request
import json
import gzip
import os
import re
import unicodedata

workspace = r"c:\mapas\Observatorio"

def strip_accents(text):
    return ''.join(c for c in unicodedata.normalize('NFD', text) if unicodedata.category(c) != 'Mn')

print("1. Fetching IBGE clean municipality data...")
req = urllib.request.Request('https://servicodados.ibge.gov.br/api/v1/localidades/municipios', headers={'Accept-Encoding': 'gzip'})
resp = urllib.request.urlopen(req)
raw = gzip.decompress(resp.read())
ibge_data = json.loads(raw.decode('utf-8'))
print(f"Fetched {len(ibge_data)} municipalities from IBGE API.")

uf_munis = {}
muni_by_code = {}
muni_lookup = {}

for item in ibge_data:
    code7 = str(item['id'])
    name = item['nome'].strip()
    
    uf = None
    if item.get('microrregiao') and item['microrregiao'].get('mesorregiao') and item['microrregiao']['mesorregiao'].get('UF'):
        uf = item['microrregiao']['mesorregiao']['UF']['sigla']
    elif item.get('regiao-imediata') and item['regiao-imediata'].get('regiao-intermediaria') and item['regiao-imediata']['regiao-intermediaria'].get('UF'):
        uf = item['regiao-imediata']['regiao-intermediaria']['UF']['sigla']
    
    if not uf:
        continue
    
    if uf not in uf_munis:
        uf_munis[uf] = set()
    uf_munis[uf].add(name.upper())
    
    micro_id = str(item['microrregiao']['id']) if item.get('microrregiao') else ""
    meso_id = str(item['microrregiao']['mesorregiao']['id']) if item.get('microrregiao') and item['microrregiao'].get('mesorregiao') else ""
    
    muni_by_code[code7] = {
        'nome': name,
        'uf': uf,
        'mr': micro_id,
        'rgi': meso_id,
        'ri': meso_id
    }

    # Map stripped key to clean name
    clean_key = strip_accents(name.upper())
    muni_lookup[clean_key] = name

# Build clean lista_municipios
lista_clean = {uf: sorted(list(uf_munis[uf])) for uf in sorted(uf_munis.keys())}

# Save root lista_municipios.json
root_path = os.path.join(workspace, 'lista_municipios.json')
with open(root_path, 'w', encoding='utf-8') as f:
    json.dump(lista_clean, f, ensure_ascii=False, indent=2)
print(f"Saved clean {root_path}")

# Save resultados_geo/lista_municipios.json
geo_path = os.path.join(workspace, 'resultados_geo', 'lista_municipios.json')
with open(geo_path, 'w', encoding='utf-8') as f:
    json.dump(lista_clean, f, ensure_ascii=False, indent=2)
print(f"Saved clean {geo_path}")

# 2. Repair regioes_ibge.json
regioes_path = os.path.join(workspace, 'resultados_geo', 'regioes_ibge.json')
if os.path.exists(regioes_path):
    with open(regioes_path, 'r', encoding='utf-8', errors='replace') as f:
        reg_data = json.load(f)
    
    muni_to_region = reg_data.get('muni_to_region', {})
    repaired = 0
    for code, info in muni_to_region.items():
        if code in muni_by_code:
            info['nome'] = muni_by_code[code]['nome']
            repaired += 1
    
    with open(regioes_path, 'w', encoding='utf-8') as f:
        json.dump(reg_data, f, ensure_ascii=False, indent=2)
    print(f"Repaired {repaired} entries in {regioes_path}")

# 3. Repair JSON files with O(1) lookup
def clean_string_fast(s):
    if '\ufffd' not in s and '' not in s:
        return s
    # Strip bad char
    cleaned = s.replace('\ufffd', '').replace('', '').strip()
    norm = strip_accents(cleaned.upper())
    if norm in muni_lookup:
        # Match case style of original (uppercase or title case)
        if s.isupper():
            return muni_lookup[norm].upper()
        return muni_lookup[norm]
    # Fallback to simple regex clean
    return cleaned

for fname in ['municipios_por_mesorregiao.json', 'municipios_por_microrregiao.json', 'emancipacoes_pre2014.json', 'distribuicao_demografica_estados.json']:
    fpath = os.path.join(workspace, 'resultados_geo', fname)
    if os.path.exists(fpath):
        print(f"Processing {fname}...")
        with open(fpath, 'r', encoding='utf-8', errors='replace') as f:
            jdata = json.load(f)
        
        def fix_fast(obj):
            if isinstance(obj, dict):
                return {clean_string_fast(k): fix_fast(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [fix_fast(x) for x in obj]
            elif isinstance(obj, str):
                return clean_string_fast(obj)
            return obj
        
        fixed = fix_fast(jdata)
        with open(fpath, 'w', encoding='utf-8') as f:
            json.dump(fixed, f, ensure_ascii=False, indent=2)
        print(f"Finished {fname}")

print("All metadata JSON files rebuilt cleanly and fast!")
