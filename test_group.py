import zipfile
import json

z = zipfile.ZipFile('resultados_geo/Legislativas 2006/deputados_estadual_2006_RJ.zip')
d = json.load(z.open('deputados_estadual_2006_RJ.json'))
metaStore = d['METADATA']['cand_names']
results = d['RESULTS']

print("Chaves de deputados estaduais de 2006 (primeiras 15):")
print(list(metaStore.keys())[:15])
