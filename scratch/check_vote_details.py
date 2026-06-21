import zipfile
import json

# 1. Load presidential history for AC
with zipfile.ZipFile('resultados_geo/Historico Presidente/historico_presidente_AC.zip') as z:
    data_hist = json.loads(z.read('historico_presidente_AC.json').decode('utf-8'))

# Let's find an identity that has 2022 records
target_local_id = '1_1015' # PORTO ACRE, ESCOLA JOSE PLACIDO DE CASTRO
hist_record_2022 = None
for identity in data_hist['identities']:
    for record in identity:
        if record[0] == 2022 and record[6] == target_local_id:
            hist_record_2022 = record
            break
    if hist_record_2022:
        break

print('History 2022 record for 1_1015:')
print(hist_record_2022)

# Now load 2022 results for AC, Porto Acre is cdmun 1007, local 1015
# So key in 2022 results is '1_1007_1015'
t1_zip = 'resultados_geo/Majoritarias 2022/presidente_2022_t1_AC.zip'
t2_zip = 'resultados_geo/Majoritarias 2022/presidente_2022_t2_AC.zip'

def get_votes_for_key(zip_path, key):
    with zipfile.ZipFile(zip_path) as z:
        name = z.namelist()[0]
        data = json.loads(z.read(name).decode('utf-8'))
        cand_names = data['METADATA']['cand_names']
        votes = data['RESULTS'].get(key, {})
        return cand_names, votes

cand_t1, votes_t1 = get_votes_for_key(t1_zip, '1_1023_1015')
cand_t2, votes_t2 = get_votes_for_key(t2_zip, '1_1023_1015')

print('\nVotes T1:')
print(votes_t1)
print('Candidates T1:')
for k, v in cand_t1.items():
    if k in votes_t1:
        print(f'  {k}: {v} -> {votes_t1[k]}')

print('\nVotes T2:')
print(votes_t2)
print('Candidates T2:')
for k, v in cand_t2.items():
    if k in votes_t2:
        print(f'  {k}: {v} -> {votes_t2[k]}')
