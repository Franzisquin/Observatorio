import zipfile
import json

# Check 2022 PR Censo or GPKG features
with zipfile.ZipFile('resultados_geo/resultados_presidente_nacional_2022.zip') as z:
    with z.open('resultados_presidente_nacional_2022.geojson') as f:
        data_2022 = json.load(f)

print("2022 total features:", len(data_2022.get('features', [])))

# Filter features where sg_uf == 'PR'
pr_features = [f for f in data_2022['features'] if f['properties'].get('sg_uf') == 'PR']
print("2022 PR features:", len(pr_features))

# Print unique cities in 2022 PR
cities = set(f['properties'].get('nm_localidade') for f in pr_features)
print("PR Cities sample:", list(cities)[:10])

# Check Curitiba features
curitiba_features = [f for f in pr_features if 'CURITIBA' in str(f['properties'].get('nm_localidade')).upper()]
print("Curitiba features count:", len(curitiba_features))

if curitiba_features:
    sample_props = curitiba_features[0]['properties']
    print("\nCuritiba feature 0 keys:", list(sample_props.keys())[:20])
    print("nm_localidade:", sample_props.get('nm_localidade'))
    print("id_unico:", sample_props.get('id_unico'))
    print("local_id:", sample_props.get('local_id'))
    print("Comparecimento 1T:", sample_props.get('Comparecimento 1T'))
    print("Comparecimento:", sample_props.get('Comparecimento'))
    print("Total_Votos_Validos 1T:", sample_props.get('Total_Votos_Validos 1T'))
