"""
Generates a JSON mapping from CD_MUN to intermediate region and macro-region
from the IBGE GeoPackage.
"""
import geopandas as gpd
import json

gdf = gpd.read_file(r'E:\Mapas\Brasil Municipios.gpkg')

# Get unique municipality -> region mapping
rg = gdf[['CD_MUN', 'CD_RGINT', 'NM_RGINT', 'CD_REGIAO', 'NM_REGIAO', 'CD_UF', 'NM_UF']].drop_duplicates(subset=['CD_MUN'])

# Build municipality mapping: CD_MUN -> { rgint_cd, rgint_nm, regiao_cd, regiao_nm }
muni_map = {}
for _, r in rg.iterrows():
    muni_map[str(r['CD_MUN'])] = {
        'ri': str(r['CD_RGINT']),   # região intermediária code
        'mr': str(r['CD_REGIAO'])   # macro-região code
    }

# Build intermediate regions list
regions_df = rg[['CD_RGINT', 'NM_RGINT', 'CD_UF', 'NM_UF', 'CD_REGIAO', 'NM_REGIAO']].drop_duplicates(subset=['CD_RGINT']).sort_values('CD_RGINT')
rgint_list = {}
for _, r in regions_df.iterrows():
    rgint_list[str(r['CD_RGINT'])] = {
        'nome': r['NM_RGINT'],
        'uf': str(r['CD_UF']),
        'uf_nome': r['NM_UF'],
        'macro': str(r['CD_REGIAO']),
        'macro_nome': r['NM_REGIAO']
    }

# Map UF sigla to CD_UF for simulator usage
uf_map = {}
uf_sigla = {
    '12': 'AC', '27': 'AL', '16': 'AP', '13': 'AM', '29': 'BA',
    '23': 'CE', '53': 'DF', '32': 'ES', '52': 'GO', '21': 'MA',
    '51': 'MT', '50': 'MS', '31': 'MG', '15': 'PA', '25': 'PB',
    '41': 'PR', '26': 'PE', '22': 'PI', '33': 'RJ', '24': 'RN',
    '43': 'RS', '11': 'RO', '14': 'RR', '42': 'SC', '35': 'SP',
    '28': 'SE', '17': 'TO'
}

# Build intermediate regions grouped by UF sigla
rgint_by_uf = {}
for cd_rgint, info in rgint_list.items():
    cd_uf = info['uf']
    sigla = uf_sigla.get(cd_uf, cd_uf)
    if sigla not in rgint_by_uf:
        rgint_by_uf[sigla] = []
    rgint_by_uf[sigla].append({
        'cd': cd_rgint,
        'nome': info['nome']
    })

# Sort regions within each UF
for sigla in rgint_by_uf:
    rgint_by_uf[sigla].sort(key=lambda x: x['nome'])

# Macro-region mapping
macro_map = {
    '1': {'nome': 'Norte', 'ufs': ['AC', 'AM', 'AP', 'PA', 'RO', 'RR', 'TO']},
    '2': {'nome': 'Nordeste', 'ufs': ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE']},
    '3': {'nome': 'Sudeste', 'ufs': ['ES', 'MG', 'RJ', 'SP']},
    '4': {'nome': 'Sul', 'ufs': ['PR', 'RS', 'SC']},
    '5': {'nome': 'Centro-Oeste', 'ufs': ['DF', 'GO', 'MS', 'MT']}
}

output = {
    'muni_to_region': muni_map,
    'rgint': rgint_list,
    'rgint_by_uf': rgint_by_uf,
    'macro': macro_map
}

with open(r'resultados_geo/regioes_ibge.json', 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False, separators=(',', ':'))

print(f"Done! {len(muni_map)} municipalities, {len(rgint_list)} intermediate regions")
print(f"Intermediate regions by UF: {dict((k, len(v)) for k, v in rgint_by_uf.items())}")
print(f"File saved to resultados_geo/regioes_ibge.json")
print(f"File size: {len(json.dumps(output, ensure_ascii=False, separators=(',', ':')))} chars")
