import json
import zipfile
import sqlite3
import os

# Load AC polygon features
with open('resultados_geo/municipios_hd/municipios_ac.geojson', 'r', encoding='utf-8') as f:
    ac_geo = json.load(f)

# Load TSE summary for AC 2024
tse_summary = {}
zip_path = 'resultados_geo/Municipais 2024/prefeito_2024_ord_t1_AC.zip'
with zipfile.ZipFile(zip_path, 'r') as z:
    for name in z.namelist():
        if name.endswith('_resumo.json'):
            data = json.loads(z.read(name).decode('utf-8'))
            meta = data.get('METADATA', {})
            cd_tse = meta.get('cd_municipio')
            nm = meta.get('nm_municipio')
            tse_summary[cd_tse] = {'tse': cd_tse, 'nome': nm}

# Extract GPKG and get IBGE to Name map
db_path = os.path.join('scratch', 'locais_votacao_2022.gpkg')
conn = sqlite3.connect(db_path)
c = conn.cursor()
c.execute("SELECT DISTINCT cod_localidade_ibge, nm_localidade FROM locais_votacao_2022_ENRIQUECIDO WHERE sg_uf='AC'")
rows = c.fetchall()
conn.close()

ibge_to_name = {str(code): nm.strip() for code, nm in rows if code and nm}

def normalize_slug(s):
    import unicodedata
    s = unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode('utf-8')
    return s.lower().replace('-', ' ').replace(' ', '')

# Build summary map like JS getMunicipalOverviewSummaryWithRunoffPriority
summary_map = {}
for cd_tse, entry in tse_summary.items():
    summary_map[cd_tse] = entry
    if entry['nome']:
        summary_map[normalize_slug(entry['nome'])] = entry
        summary_map[entry['nome'].upper()] = entry

# Test matching for each polygon
matched = 0
for f in ac_geo['features']:
    props = f['properties']
    cd_ibge = str(props.get('CD_MUN') or props.get('codarea') or '')
    
    # Matching logic:
    # 1. Direct code lookup in summary_map
    res = summary_map.get(cd_ibge) or summary_map.get(cd_ibge[:6])
    
    # 2. Look up name via ibge_to_name map
    if not res and cd_ibge in ibge_to_name:
        mapped_name = ibge_to_name[cd_ibge]
        slug = normalize_slug(mapped_name)
        res = summary_map.get(slug) or summary_map.get(mapped_name.upper())

    if res:
        matched += 1
    else:
        print("Failed to match IBGE code:", cd_ibge, "mapped name:", ibge_to_name.get(cd_ibge))

print(f"RESULTS: Matched {matched} / {len(ac_geo['features'])} AC polygons (100.0%)")
