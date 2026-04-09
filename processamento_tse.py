import zipfile
import os
import pandas as pd
import json

base_dir = r'C:\Users\lixov\OneDrive\Ambiente de Trabalho\Dados Eleitorado'

files = {
    'idade': 'eleitorado-idade.zip',
    'genero': 'eleitorado-genero.zip',
    'edu': 'eleitorado-escolaridade.zip'
}

data = {}

def get_key(row):
    nm = str(row['nm_local_votacao']).strip().upper()
    uf = str(row['UF']).upper()
    zona = int(row['nr_zona'])
    return f"{uf}_{zona}_{nm}"

# IDADE
print('Processing IDADE...')
with zipfile.ZipFile(os.path.join(base_dir, files['idade']), 'r') as zf:
    name = zf.namelist()[0]
    with zf.open(name) as f:
        for chunk in pd.read_csv(f, sep=';', encoding='latin1', chunksize=250000):
            for _, row in chunk.iterrows():
                k = get_key(row)
                if k not in data: data[k] = {'t': 0, 'g':{}, 'e':{}, 'i':{}}
                
                faixa = str(row['Faixa etria']).strip() if 'Faixa etria' in row else str(row.get('Faixa etria', '')).strip()
                votos = int(row['Eleitorado'])
                data[k]['t'] += votos
                
                group = 'outros'
                if faixa in ['16 anos', '17 anos', '18 anos', '19 anos', '20 anos', '21 a 24 anos', '25 a 29 anos']:
                    group = '16-29'
                elif faixa in ['30 a 34 anos', '35 a 39 anos', '40 a 44 anos']:
                    group = '30-45'
                elif faixa in ['45 a 49 anos', '50 a 54 anos', '55 a 59 anos']:
                    group = '46-59'
                elif faixa in ['60 a 64 anos', '65 a 69 anos', '70 a 74 anos', '75 a 79 anos', '80 a 84 anos', '85 a 89 anos', '90 a 94 anos', '95 a 99 anos', '100 anos ou mais']:
                    group = '60+'
                
                data[k]['i'][group] = data[k]['i'].get(group, 0) + votos

# GENERO
print('Processing GENERO...')
with zipfile.ZipFile(os.path.join(base_dir, files['genero']), 'r') as zf:
    name = zf.namelist()[0]
    with zf.open(name) as f:
        for chunk in pd.read_csv(f, sep=';', encoding='latin1', chunksize=250000):
            for _, row in chunk.iterrows():
                k = get_key(row)
                if k not in data: data[k] = {'t': 0, 'g':{}, 'e':{}, 'i':{}}
                
                g_col = str(row['Gnero']).strip().upper() if 'Gnero' in row else str(row.get('Gnero', '')).strip().upper()
                votos = int(row['Eleitorado'])
                if g_col == 'FEMININO': g_idx = 'F'
                elif g_col == 'MASCULINO': g_idx = 'M'
                else: g_idx = 'NI'
                
                data[k]['g'][g_idx] = data[k]['g'].get(g_idx, 0) + votos

# EDUCAÇÃO
print('Processing EDUCACAO...')
with zipfile.ZipFile(os.path.join(base_dir, files['edu']), 'r') as zf:
    name = zf.namelist()[0]
    with zf.open(name) as f:
        for chunk in pd.read_csv(f, sep=';', encoding='latin1', chunksize=250000):
            for _, row in chunk.iterrows():
                k = get_key(row)
                if k not in data: data[k] = {'t': 0, 'g':{}, 'e':{}, 'i':{}}
                
                edu = str(row['Grau de instruo']).strip().upper() if 'Grau de instruo' in row else str(row.get('Grau de instruo', '')).strip().upper()
                votos = int(row['Eleitorado'])
                
                if 'SUPERIOR' in edu: group = 'superior'
                elif 'MDIO' in edu or 'MEDIO' in edu or 'MDIO' in edu: group = 'medio'
                elif 'FUNDAMENTAL' in edu or 'ANALFABETO' in edu or 'ESCREVE' in edu: group = 'fundamental'
                else: group = 'outros'
                
                data[k]['e'][group] = data[k]['e'].get(group, 0) + votos

# AGGREGATE
result = {}
for k, v in data.items():
    sum_i = sum(v['i'].values())
    sum_g = sum(v['g'].values())
    sum_e = sum(v['e'].values())
    
    res_loc = {}
    if sum_i > 0:
        res_loc['tse_pct_16_29'] = v['i'].get('16-29', 0) / sum_i * 100
        res_loc['tse_pct_30_45'] = v['i'].get('30-45', 0) / sum_i * 100
        res_loc['tse_pct_46_59'] = v['i'].get('46-59', 0) / sum_i * 100
        res_loc['tse_pct_60_plus'] = v['i'].get('60+', 0) / sum_i * 100
    
    if sum_g > 0:
        res_loc['tse_pct_masculino'] = v['g'].get('M', 0) / sum_g * 100
        res_loc['tse_pct_feminino'] = v['g'].get('F', 0) / sum_g * 100
        
    if sum_e > 0:
        res_loc['tse_pct_fundamental'] = v['e'].get('fundamental', 0) / sum_e * 100
        res_loc['tse_pct_medio'] = v['e'].get('medio', 0) / sum_e * 100
        res_loc['tse_pct_superior'] = v['e'].get('superior', 0) / sum_e * 100
        
    if len(res_loc) > 0:
        result[k] = res_loc

with open('resultados_geo/tse_demographics_locais.json', 'w', encoding='utf-8') as f:
    json.dump(result, f)

print(f'Done! Dumped {len(result)} records into JSON.')
