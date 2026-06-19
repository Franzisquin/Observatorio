import zipfile
import json
import os

zip_path = r"c:\Users\lixov\OneDrive\Documentos\Observatorio\resultados_geo\2000 Municipais\RJ.zip"
if os.path.exists(zip_path):
    with zipfile.ZipFile(zip_path, 'r') as z:
        content = z.read('CABO FRIO_Ordinaria_2000.geojson')
        data = json.loads(content)
        print("Total features:", len(data.get('features', [])))
        if data.get('features'):
            # Let's see how many features have votes
            has_votes = 0
            for i, feat in enumerate(data['features']):
                props = feat['properties']
                # Check candidate/vote keys
                vote_keys = [k for k in props.keys() if '(' in k or 'voto' in k.lower() or 'total' in k.lower()]
                if vote_keys:
                    has_votes += 1
                if i < 3:
                    print(f"\nFeature {i} properties:")
                    for k, v in props.items():
                        if '(' in k or 'voto' in k.lower() or 'total' in k.lower() or 'valido' in k.lower():
                            print(f"  {k}: {v}")
            print(f"\nFeatures with vote keys: {has_votes} / {len(data['features'])}")
else:
    print("Zip path does not exist!")
