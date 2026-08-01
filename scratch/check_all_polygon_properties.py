import json
import glob
import os

print("=== Checking property names of all polygon GeoJSON files ===")

files = glob.glob("resultados_geo/municipios_hd/*.geojson") + glob.glob("resultados_geo/municipios/*.geojson") + glob.glob("resultados_geo/municipios_1994/*.geojson")
print(f"Total polygon geojson files found: {len(files)}")

prop_keys_summary = {}

for path in files[:50]:
    try:
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        feats = data.get('features', [])
        if feats:
            p = feats[0]['properties']
            fname = os.path.basename(path)
            keys = tuple(sorted(p.keys()))
            if keys not in prop_keys_summary:
                prop_keys_summary[keys] = []
            prop_keys_summary[keys].append(fname)
    except Exception as e:
        print(f"Error reading {path}: {e}")

for keys, fnames in prop_keys_summary.items():
    print(f"\nKeys: {keys}")
    print(f"Files count: {len(fnames)}, sample: {fnames[:5]}")
