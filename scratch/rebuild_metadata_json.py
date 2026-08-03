import urllib.request
import json
import gzip
import os

workspace = r"c:\mapas\Observatorio"

print("1. Fetching clean municipality data from IBGE API...")
req = urllib.request.Request('https://servicodados.ibge.gov.br/api/v1/localidades/municipios', headers={'Accept-Encoding': 'gzip'})
resp = urllib.request.urlopen(req)
raw = gzip.decompress(resp.read())
ibge_data = json.loads(raw.decode('utf-8'))
print(f"Fetched {len(ibge_data)} municipalities from IBGE API.")

# Build dictionary by UF -> list of municipality names (sorted uppercase, clean UTF-8)
uf_munis = {}
# Build dictionary by IBGE 7-digit code -> clean name, UF, mesoregion, microregion, etc.
muni_by_code = {}

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

# Convert uf_munis sets to sorted lists
lista_municipios_clean = {}
for uf in sorted(uf_munis.keys()):
    lista_municipios_clean[uf] = sorted(list(uf_munis[uf]))

# Save root lista_municipios.json
root_lista_path = os.path.join(workspace, 'lista_municipios.json')
with open(root_lista_path, 'w', encoding='utf-8') as f:
    json.dump(lista_municipios_clean, f, ensure_ascii=False, indent=2)
print(f"Updated {root_lista_path}")

# Save resultados_geo/lista_municipios.json
geo_lista_path = os.path.join(workspace, 'resultados_geo', 'lista_municipios.json')
with open(geo_lista_path, 'w', encoding='utf-8') as f:
    json.dump(lista_municipios_clean, f, ensure_ascii=False, indent=2)
print(f"Updated {geo_lista_path}")

# 2. Repair regioes_ibge.json
regioes_path = os.path.join(workspace, 'resultados_geo', 'regioes_ibge.json')
if os.path.exists(regioes_path):
    with open(regioes_path, 'r', encoding='utf-8', errors='replace') as f:
        reg_data = json.load(f)
    
    muni_to_region = reg_data.get('muni_to_region', {})
    repaired_count = 0
    for code, info in muni_to_region.items():
        if code in muni_by_code:
            info['nome'] = muni_by_code[code]['nome']
            repaired_count += 1
    
    with open(regioes_path, 'w', encoding='utf-8') as f:
        json.dump(reg_data, f, ensure_ascii=False, indent=2)
    print(f"Updated {regioes_path} ({repaired_count} entries clean)")

# 3. Repair municipios_por_mesorregiao.json & municipios_por_microrregiao.json
for fname in ['municipios_por_mesorregiao.json', 'municipios_por_microrregiao.json', 'emancipacoes_pre2014.json', 'distribuicao_demografica_estados.json']:
    fpath = os.path.join(workspace, 'resultados_geo', fname)
    if os.path.exists(fpath):
        with open(fpath, 'r', encoding='utf-8', errors='replace') as f:
            jdata = json.load(f)
        
        def fix_obj(obj):
            if isinstance(obj, dict):
                res = {}
                for k, v in obj.items():
                    fixed_k = k
                    if '\ufffd' in k or '' in k:
                        clean_k = k.replace('\ufffd', '').replace('', '').strip().upper()
                        for c_info in muni_by_code.values():
                            if len(clean_k) > 3 and clean_k in c_info['nome'].upper():
                                fixed_k = c_info['nome'].upper()
                                break
                    res[fixed_k] = fix_obj(v)
                return res
            elif isinstance(obj, list):
                return [fix_obj(x) for x in obj]
            elif isinstance(obj, str):
                if ('\ufffd' in obj or '' in obj) and len(obj) < 100:
                    clean_obj = obj.replace('\ufffd', '').replace('', '').strip().upper()
                    for c_info in muni_by_code.values():
                        if len(clean_obj) > 3 and clean_obj in c_info['nome'].upper():
                            return c_info['nome']
                return obj
            return obj
        
        fixed_jdata = fix_obj(jdata)
        with open(fpath, 'w', encoding='utf-8') as f:
            json.dump(fixed_jdata, f, ensure_ascii=False, indent=2)
        print(f"Updated {fpath}")

print("Metadata JSON rebuild complete.")
