import sqlite3
import zipfile
import json
import os

# Connect to GPKG
gpkg_path = 'resultados_geo/locais_votacao_2006.gpkg'
if not os.path.exists(gpkg_path):
    print("Extracting GPKG...")
    with zipfile.ZipFile('resultados_geo/locais_votacao_2006_gkpg.zip', 'r') as z:
        z.extract('locais_votacao_2006.gpkg', 'resultados_geo')

conn = sqlite3.connect(gpkg_path)
cursor = conn.cursor()

def check_mismatch(zip_path, json_name, state, city_name, muni_code):
    print(f"\n=== Checking {city_name} ({state}) ===")
    # Load JSON results
    with zipfile.ZipFile(zip_path, 'r') as z:
        data = json.loads(z.read(json_name))
    results_keys = list(data.get('RESULTS', {}).keys())
    print(f"JSON results keys count: {len(results_keys)}")
    if results_keys:
        print("Sample JSON keys:", results_keys[:5])

    # Query GPKG
    cursor.execute("""
        SELECT nr_zona, nr_locvot, nm_localidade, cod_localidade_ibge
        FROM locais_votacao_2006_padronizado 
        WHERE sg_uf = ? AND UPPER(nm_localidade) = ?
    """, (state, city_name.upper()))
    gpkg_rows = cursor.fetchall()
    print(f"GPKG rows found: {len(gpkg_rows)}")
    
    # Let's see what fullLocalKey format looks like
    gpkg_keys = []
    for r in gpkg_rows:
        zona = int(r[0])
        local = int(r[1])
        # fullLocalKey uses muni_code
        key = f"{zona}_{muni_code}_{local}"
        gpkg_keys.append(key)
    
    if gpkg_keys:
        print("Sample GPKG keys:", gpkg_keys[:5])
        
    # Check intersection
    intersect = set(results_keys).intersection(set(gpkg_keys))
    print(f"Intersection count: {len(intersect)}")
    
    # What are some unmatched keys?
    unmatched_json = set(results_keys) - set(gpkg_keys)
    unmatched_gpkg = set(gpkg_keys) - set(results_keys)
    print(f"Unmatched JSON keys count: {len(unmatched_json)}")
    if unmatched_json:
        print("Sample unmatched JSON keys:", list(unmatched_json)[:5])
    print(f"Unmatched GPKG keys count: {len(unmatched_gpkg)}")
    if unmatched_gpkg:
        print("Sample unmatched GPKG keys:", list(unmatched_gpkg)[:5])

check_mismatch('resultados_geo/Municipais 2000/prefeito_2000_ord_t1_BA.zip', '35157_FEIRA_DE_SANTANA.json', 'BA', 'Feira de Santana', '35157')
check_mismatch('resultados_geo/Municipais 2000/prefeito_2000_ord_t1_MA.zip', '9210_SAO_LUIS.json', 'MA', 'São Luís', '9210')

conn.close()
