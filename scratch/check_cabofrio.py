import zipfile
import json
import os

zip_path = r"c:\Users\lixov\OneDrive\Documentos\Observatorio\resultados_geo\2000 Municipais\RJ.zip"
if os.path.exists(zip_path):
    with zipfile.ZipFile(zip_path, 'r') as z:
        names = z.namelist()
        matching = [n for n in names if 'CABO' in n.upper()]
        print("Matching files:", matching)
        if matching:
            content = z.read(matching[0])
            data = json.loads(content)
            print("Total features:", len(data.get('features', [])))
            if data.get('features'):
                # Inspect some features
                for i, feat in enumerate(data['features'][:3]):
                    print(f"\nFeature {i} properties:")
                    for k, v in list(feat['properties'].items()):
                        # Print candidate keys and total keys
                        if '(' in k or 'voto' in k.lower() or 'total' in k.lower() or 'valido' in k.lower():
                            print(f"  {k}: {v}")
else:
    print("Zip path does not exist!")
