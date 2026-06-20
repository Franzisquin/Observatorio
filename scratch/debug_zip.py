import zipfile
import json

def inspect_city(zip_path, substring):
    with zipfile.ZipFile(zip_path, 'r') as z:
        filenames = [f for f in z.namelist() if substring.upper() in f.upper() and f.endswith('.json')]
        for f in filenames:
            print(f"=== Found {f} in {zip_path} ===")
            data = json.loads(z.read(f))
            print("Keys in JSON:", list(data.keys()))
            metadata = data.get('METADATA', {})
            print("METADATA keys:", list(metadata.keys()))
            print("METADATA details:")
            for k, v in metadata.items():
                if k != 'cand_names':
                    print(f"  {k}: {v}")
                else:
                    print(f"  cand_names count: {len(v)}")
                    print(f"  cand_names sample: {list(v.items())[:3]}")
            results = data.get('RESULTS', {})
            print(f"RESULTS count: {len(results)}")
            if results:
                print("RESULTS sample:")
                for rk, rv in list(results.items())[:3]:
                    print(f"  {rk}: {rv}")

inspect_city('resultados_geo/Municipais 2000/prefeito_2000_ord_t1_BA.zip', 'feira')
inspect_city('resultados_geo/Municipais 2000/prefeito_2000_ord_t1_MA.zip', 'luis')
