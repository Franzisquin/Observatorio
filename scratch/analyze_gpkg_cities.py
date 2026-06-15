import sqlite3
import zipfile
import tempfile
import os
import json
import unicodedata

def normalize(s):
    if not s:
        return ""
    # Remove accents and convert to uppercase
    s = unicodedata.normalize('NFD', s)
    s = "".join([c for c in s if unicodedata.category(c) != 'Mn'])
    return s.strip().upper()

# Load official city names
with open(r"c:\mapas\Observatorio\lista_municipios.json", "r", encoding="utf-8-sig") as f:
    official_cities = json.load(f)

# Build a normalized set of official cities: (uf, norm_name) -> original_official_name
official_norm = {}
for uf, cities in official_cities.items():
    for city in cities:
        official_norm[(uf, normalize(city))] = city

def analyze_gpkg(zip_path, year):
    print(f"\n==========================================")
    print(f"Analyzing {year} GPKG: {zip_path}")
    print(f"==========================================")
    
    with zipfile.ZipFile(zip_path, 'r') as z:
        gpkg_names = [name for name in z.namelist() if name.lower().endswith('.gpkg')]
        if not gpkg_names:
            print("No GPKG file found in zip!")
            return
        gpkg_name = gpkg_names[0]
        
        temp_dir = tempfile.gettempdir()
        temp_gpkg_path = os.path.join(temp_dir, f"temp_anal_{year}.gpkg")
        
        with open(temp_gpkg_path, 'wb') as f:
            f.write(z.read(gpkg_name))
            
        try:
            conn = sqlite3.connect(temp_gpkg_path)
            cursor = conn.cursor()
            
            # Find the main locations table name
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'locais_votacao%';")
            tables = [r[0] for r in cursor.fetchall()]
            if not tables:
                print("No locations table found!")
                return
            
            # We will use the padronizado table
            table = [t for t in tables if 'padronizado' in t][0]
            print(f"Reading from table: {table}")
            
            cursor.execute(f"SELECT DISTINCT sg_uf, nm_localidade FROM {table} ORDER BY sg_uf, nm_localidade;")
            gpkg_cities = cursor.fetchall()
            
            unmatched = []
            for uf, gpkg_city in gpkg_cities:
                if not uf or not gpkg_city:
                    continue
                
                # Special cases or empty
                if gpkg_city.strip() == "":
                    continue
                    
                norm_gpkg = normalize(gpkg_city)
                if (uf, norm_gpkg) not in official_norm:
                    # Let's see if we can find a substring match or similar match in that UF
                    candidates = []
                    for (cand_uf, cand_norm), cand_orig in official_norm.items():
                        if cand_uf == uf:
                            # If the gpkg name is a prefix of the official name (e.g. CAMPOS -> CAMPOS DOS GOYTACAZES)
                            if cand_norm.startswith(norm_gpkg) or norm_gpkg.startswith(cand_norm):
                                candidates.append(cand_orig)
                    
                    unmatched.append({
                        'uf': uf,
                        'gpkg_city': gpkg_city,
                        'candidates': candidates
                    })
            
            print(f"Found {len(unmatched)} unmatched cities in {year} GPKG:")
            for item in unmatched:
                print(f"  UF: {item['uf']} | GPKG Name: '{item['gpkg_city']}' | Candidates: {item['candidates']}")
                
            conn.close()
        finally:
            if os.path.exists(temp_gpkg_path):
                os.remove(temp_gpkg_path)

analyze_gpkg(r"c:\mapas\Observatorio\resultados_geo\locais_votacao_2002_gkpg.zip", 2002)
analyze_gpkg(r"c:\mapas\Observatorio\resultados_geo\locais_votacao_2006_gkpg.zip", 2006)
