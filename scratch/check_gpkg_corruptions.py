import os
import zipfile
import sqlite3
import tempfile
import json
import unicodedata

workspace = r"c:\mapas\Observatorio"
gpkg_zip = os.path.join(workspace, "resultados_geo", "locais_votacao_2022_gpkg.zip")
lista_json = os.path.join(workspace, "lista_municipios.json")

# Load clean IBGE names by IBGE code or name matching
with open(os.path.join(workspace, "resultados_geo", "regioes_ibge.json"), "r", encoding="utf-8") as f:
    reg_data = json.load(f)

code_to_clean_name = {}
for code, info in reg_data.get("muni_to_region", {}).items():
    code_to_clean_name[code] = info["nome"]
    code_to_clean_name[code[:6]] = info["nome"]

print(f"Loaded {len(code_to_clean_name)} clean code-to-name mappings.")

if os.path.exists(gpkg_zip):
    with tempfile.TemporaryDirectory() as tmpdir:
        with zipfile.ZipFile(gpkg_zip, 'r') as z:
            zname = [n for n in z.namelist() if n.endswith('.gpkg')][0]
            gpath = z.extract(zname, tmpdir)
        
        conn = sqlite3.connect(gpath)
        cursor = conn.cursor()
        
        # Check corruptions in nm_localidade
        rows = cursor.execute("SELECT rowid, cod_localidade_ibge, nm_localidade FROM locais_votacao_2022_ENRIQUECIDO WHERE nm_localidade LIKE '%\ufffd%' OR nm_localidade LIKE '%\x11%' OR nm_localidade LIKE '%?%' OR nm_localidade LIKE '%~%';").fetchall()
        print(f"Found {len(rows)} corrupted rows in GPKG table locais_votacao_2022_ENRIQUECIDO.")
        if rows:
            print("Sample corrupt rows:", rows[:5])
        
        # Count total rows
        total = cursor.execute("SELECT count(*) FROM locais_votacao_2022_ENRIQUECIDO;").fetchone()[0]
        print(f"Total rows in locais_votacao_2022_ENRIQUECIDO: {total}")
        
        conn.close()
