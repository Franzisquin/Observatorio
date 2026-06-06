import zipfile
import json
import os

zip_path = 'resultados_geo/Legislativas 2006/deputados_federal_2006_RJ.zip'
with zipfile.ZipFile(zip_path, 'r') as z:
    for filename in z.namelist():
        if filename.endswith('.json'):
            print('File found inside zip:', filename)
            with z.open(filename) as f:
                data = json.loads(f.read().decode('utf-8'))
                
                print('METADATA keys:', list(data.get('METADATA', {}).keys()))
                cand_names = data.get('METADATA', {}).get('cand_names', {})
                print('Number of candidates in cand_names:', len(cand_names))
                cand_keys = list(cand_names.keys())
                print('Sample candidates (first 10):', cand_keys[:10])
                for k in cand_keys[:10]:
                    print(f'cand_names[{k}]:', cand_names[k])
                
                coalition = data.get('METADATA', {}).get('coalition_adjustments', {})
                print('Sample coalition_adjustments (first 5):', list(coalition.items())[:5])
                
                results = data.get('RESULTS', {})
                print('Number of results:', len(results))
                result_keys = list(results.keys())
                print('Sample RESULTS keys (first 3):', result_keys[:3])
                for k in result_keys[:3]:
                    print(f'RESULTS[{k}]:', results[k])
