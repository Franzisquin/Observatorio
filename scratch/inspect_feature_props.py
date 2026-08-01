import zipfile
import json

# Check 2022 PR Presidente
with zipfile.ZipFile('resultados_geo/resultados_presidente_nacional_2022.zip') as z:
    with z.open('presidente_2022_BR.json') as f:
        data = json.load(f)

print('2022 BR features count:', len(data.get('features', [])))
if data.get('features'):
    props = data['features'][0]['properties']
    print('2022 sample props:', list(props.keys())[:15])
    print('nm_localidade:', props.get('nm_localidade'))
    print('cd_localidade_tse:', props.get('cd_localidade_tse'))

# Check 2002 PR Presidente in Majoritarias 2002
with zipfile.ZipFile('resultados_geo/Majoritarias 2002/presidente_2002_t1_PR.zip') as z:
    with z.open('presidente_2002_t1_PR.json') as f:
        data_2002 = json.load(f)

# In 2002, loaded.geojson comes from loadGeneralScopeBase2006
with zipfile.ZipFile('resultados_geo/locais_votacao_2006_gkpg.zip') as z:
    print('2006 gkpg zip contents:', z.namelist())
