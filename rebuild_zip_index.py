import os
import zipfile
import json
import logging

logging.basicConfig(level=logging.INFO)

SITE_DIR = r'c:\Users\Francisco\OneDrive\Documentos\Observatorio\resultados_geo'

index = {}

def get_correct_filename(info):
    if info.flag_bits & 0x800:
        return info.filename
    else:
        try:
            return info.filename.encode('cp437').decode('utf-8')
        except Exception:
            return info.filename

# 1. Process Municipais
for top_dir in os.listdir(SITE_DIR):
    if top_dir.endswith(' Municipais'):
        top_dir_path = os.path.join(SITE_DIR, top_dir)
        if os.path.isdir(top_dir_path):
            for zip_file in os.listdir(top_dir_path):
                if zip_file.endswith('.zip'):
                    uf = zip_file.replace('.zip', '')
                    zip_path = os.path.join(top_dir_path, zip_file)
                    zip_rel = f'{top_dir}/{zip_file}'
                    with zipfile.ZipFile(zip_path, 'r') as zf:
                        for info in zf.infolist():
                            name = get_correct_filename(info)
                            if name.endswith('.geojson'):
                                base_name = os.path.basename(name)
                                key = f'{top_dir}/{uf}/{base_name}'
                                # Original zip filename must be kept for reading the file from zip
                                index[key] = {'zip': zip_rel, 'file': info.filename}

# 2. Process General Elections
for zip_file in os.listdir(SITE_DIR):
    if zip_file.endswith('.zip'):
        zip_path = os.path.join(SITE_DIR, zip_file)
        zip_rel = zip_file
        
        is_nacional = zip_file.startswith('resultados_presidente_nacional')
        
        if is_nacional:
            with zipfile.ZipFile(zip_path, 'r') as zf:
                for info in zf.infolist():
                    name = get_correct_filename(info)
                    if name.endswith('.geojson'):
                        base_name = os.path.basename(name)
                        key = base_name
                        index[key] = {'zip': zip_rel, 'file': info.filename}
        else:
            prefix = zip_file.rsplit('_', 1)[0]
            with zipfile.ZipFile(zip_path, 'r') as zf:
                for info in zf.infolist():
                    name = get_correct_filename(info)
                    if name.endswith('.geojson'):
                        base_name = os.path.basename(name)
                        key = f'{prefix}/{base_name}'
                        index[key] = {'zip': zip_rel, 'file': info.filename}

index_path = os.path.join(SITE_DIR, 'zip_index.json')
with open(index_path, 'w', encoding='utf-8') as f:
    json.dump(index, f, ensure_ascii=False)

print(f"Generated {len(index)} mappings in {index_path}")
