import shutil
import os

src_dir = r"c:\mapas\Observatorio\resultados_geo"
dst_dir = r"c:\mapas\Observatorio\resultados_geo_backup"

os.makedirs(dst_dir, exist_ok=True)

files_to_backup = [
    "locais_votacao_2002_gkpg.zip",
    "locais_votacao_2006_gkpg.zip"
]

for filename in files_to_backup:
    src_file = os.path.join(src_dir, filename)
    dst_file = os.path.join(dst_dir, filename + ".bak")
    if os.path.exists(src_file):
        shutil.copy2(src_file, dst_file)
        print(f"Backed up {src_file} to {dst_file}")
    else:
        print(f"Source file not found: {src_file}")
