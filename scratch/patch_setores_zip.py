import os
import json
import zipfile
import math
import time

def sanitize_nan(obj, stats):
    if isinstance(obj, float):
        if math.isnan(obj):
            stats["nan_count"] += 1
            return None
        if math.isinf(obj):
            stats["inf_count"] += 1
            return None
        return obj
    elif isinstance(obj, dict):
        return {k: sanitize_nan(v, stats) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [sanitize_nan(x, stats) for x in obj]
    return obj

def main():
    t0 = time.time()
    zip_path = r"c:/mapas/Observatorio/resultados_geo/Setores 2022/setores_presidente_2022_SC.zip"
    json_filename = "setores_presidente_2022_SC.json"
    
    if not os.path.exists(zip_path):
        print(f"Error: Zip file not found at {zip_path}")
        return
        
    print(f"Reading {zip_path}...")
    with zipfile.ZipFile(zip_path, "r") as z:
        with z.open(json_filename) as f:
            data_bytes = f.read()
            
    print("Decoding and parsing JSON...")
    # Python's json.loads will happily parse NaN by default
    data_str = data_bytes.decode("utf-8")
    data = json.loads(data_str)
    
    print("Sanitizing NaN and Infinity values...")
    stats = {"nan_count": 0, "inf_count": 0}
    sanitized_data = sanitize_nan(data, stats)
    print(f"Found and replaced {stats['nan_count']} NaN values and {stats['inf_count']} Infinity values.")
    
    if stats["nan_count"] == 0 and stats["inf_count"] == 0:
        print("No invalid values found. Zip file is already clean.")
        return
        
    print("Encoding sanitized data back to JSON...")
    new_payload = json.dumps(sanitized_data, ensure_ascii=False)
    
    temp_zip_path = zip_path + ".tmp"
    print(f"Writing to temporary zip {temp_zip_path}...")
    with zipfile.ZipFile(temp_zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        z.writestr(json_filename, new_payload)
        
    print("Replacing original zip file...")
    if os.path.exists(zip_path):
        os.remove(zip_path)
    os.rename(temp_zip_path, zip_path)
    
    mb = os.path.getsize(zip_path) / 1e6
    print(f"Success! {zip_path} patched. Size: {mb:.2f} MB. Took {time.time() - t0:.2f}s.")

if __name__ == "__main__":
    main()
