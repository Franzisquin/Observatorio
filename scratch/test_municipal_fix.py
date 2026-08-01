import json
import zipfile
import sqlite3
import os

# 1. Load AC polygon features
with open('resultados_geo/municipios_hd/municipios_ac.geojson', 'r', encoding='utf-8') as f:
    ac_geo = json.load(f)

# 2. Load TSE resumo zip for AC 2024
tse_summary = {}
zip_path = 'resultados_geo/Municipais 2024/prefeito_2024_ord_t1_AC.zip'
with zipfile.ZipFile(zip_path, 'r') as z:
    for name in z.namelist():
        if name.endswith('_resumo.json'):
            data = json.loads(z.read(name).decode('utf-8'))
            meta = data.get('METADATA', {})
            cd_tse = meta.get('cd_municipio')
            nm = meta.get('nm_municipio')
            tse_summary[cd_tse] = {'tse': cd_tse, 'nome': nm}

print("TSE Summary items:", len(tse_summary))

# 3. Connect to GPKG
db_path = os.path.join('scratch', 'locais_votacao_2022.gpkg')
conn = sqlite3.connect(db_path)
c = conn.cursor()
c.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [t[0] for t in c.fetchall()]
table_name = [t for t in tables if not t.startswith('gpkg_') and not t.startswith('sqlite_')][0]

c.execute(f"PRAGMA table_info({table_name})")
cols = [row[1] for row in c.fetchall()]
print("Columns in table:", cols)

# Search for TSE code, city name, IBGE code columns
c.execute(f"SELECT * FROM {table_name} LIMIT 1")
row_sample = c.fetchone()
print("Sample row:", dict(zip(cols, row_sample)))
conn.close()
