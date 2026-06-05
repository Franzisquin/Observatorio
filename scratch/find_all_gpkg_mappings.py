import json
import sqlite3
import zipfile
import tempfile
import os
import unicodedata

# 1. Load official cities
with open(r"c:\mapas\Observatorio\lista_municipios.json", "r", encoding="utf-8-sig") as f:
    official_cities = json.load(f)

# Normalize string helper
def clean_str(s):
    if not s:
        return ""
    s = unicodedata.normalize('NFD', s)
    s = "".join([c for c in s if unicodedata.category(c) != 'Mn'])
    s = s.upper().replace("-", " ").replace("'", " ").replace("`", " ")
    return " ".join(s.split())

# Create lookup
official_lookup = {}
for uf, list_cities in official_cities.items():
    official_lookup[uf] = {}
    for city in list_cities:
        official_lookup[uf][clean_str(city)] = city

# Try to find a match automatically
def find_best_match(uf, gpkg_name):
    gpkg_clean = clean_str(gpkg_name)
    if uf not in official_lookup:
        return None
        
    state_lookup = official_lookup[uf]
    
    # Rule 1: Exact clean match
    if gpkg_clean in state_lookup:
        return state_lookup[gpkg_clean]
        
    # Rule 2: Try replacing Y with I (e.g. AYRAO -> AIRAO, PARATI -> PARATY, etc.)
    gpkg_i = gpkg_clean.replace("Y", "I")
    for clean_off, orig in state_lookup.items():
        clean_off_i = clean_off.replace("Y", "I")
        if gpkg_i == clean_off_i:
            return orig
            
    # Rule 3: Prefix/Suffix checks (e.g. CAMPOS -> CAMPOS DOS GOYTACAZES, SANTA ROSA -> SANTA ROSA DO PURUS)
    matches = []
    for clean_off, orig in state_lookup.items():
        if clean_off.startswith(gpkg_clean) or gpkg_clean.startswith(clean_off):
            matches.append(orig)
            
    if len(matches) == 1:
        return matches[0]
        
    # Rule 4: Match with D'OESTE or DO OESTE or D OESTE differences
    # E.g. ESPIGAO D OESTE -> ESPIGÃO D'OESTE
    gpkg_oeste = gpkg_clean.replace("D OESTE", "DO OESTE").replace("D  OESTE", "DO OESTE")
    for clean_off, orig in state_lookup.items():
        clean_off_oeste = clean_off.replace("D OESTE", "DO OESTE").replace("D  OESTE", "DO OESTE")
        if gpkg_oeste == clean_off_oeste:
            return orig

    # Rule 5: Substring matching for known abbreviations
    # E.g. "DEP IRAPUAN PINHEIRO" -> "DEPUTADO IRAPUAN PINHEIRO"
    if "DEP " in gpkg_clean or "DEP." in gpkg_clean:
        clean_no_dep = gpkg_clean.replace("DEP ", "").replace("DEP.", "").strip()
        for clean_off, orig in state_lookup.items():
            if clean_no_dep in clean_off:
                return orig
                
    # Rule 6: Common prefix differences (e.g., "GOVERNADOR LOMANTO JUNIOR" in BA -> "BARRO PRETO"?? No, that is a renamed city!)
    # Let's check Levenshtein distance for close typos
    # E.g. "QUINJINGUE" -> "QUIJINGUE", "BERNADINO DE CAMPOS" -> "BERNARDINO DE CAMPOS", "VALPARAIZO" -> "VALPARAÍSO"
    from difflib import SequenceMatcher
    best_ratio = 0
    best_orig = None
    for clean_off, orig in state_lookup.items():
        ratio = SequenceMatcher(None, gpkg_clean, clean_off).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best_orig = orig
            
    if best_ratio > 0.85: # Threshold of 85% similarity
        return best_orig
        
    return None

def scan_gpkg(zip_path, year, table_name):
    print(f"\nScanning GPKG {year} from {zip_path}...")
    with zipfile.ZipFile(zip_path, 'r') as z:
        gpkg_name = [name for name in z.namelist() if name.lower().endswith('.gpkg')][0]
        temp_dir = tempfile.gettempdir()
        temp_path = os.path.join(temp_dir, f"temp_scan_{year}.gpkg")
        
        with open(temp_path, 'wb') as f:
            f.write(z.read(gpkg_name))
            
        try:
            conn = sqlite3.connect(temp_path)
            cursor = conn.cursor()
            cursor.execute(f"SELECT DISTINCT sg_uf, nm_localidade FROM {table_name} ORDER BY sg_uf, nm_localidade;")
            rows = cursor.fetchall()
            
            mappings = []
            unresolved = []
            for uf, name in rows:
                if not uf or not name or name.strip() == "":
                    continue
                
                clean_gpkg = clean_str(name)
                # Check if it's already matching
                if uf in official_lookup and clean_gpkg in official_lookup[uf]:
                    continue
                    
                match = find_best_match(uf, name)
                if match:
                    mappings.append((uf, name, match))
                else:
                    unresolved.append((uf, name))
                    
            print(f"For {year}, found {len(mappings)} automatic mappings and {len(unresolved)} unresolved:")
            print("Proposed Mappings:")
            for uf, old, new in sorted(mappings):
                print(f"  {uf}: '{old}' -> '{new}'")
            print("Unresolved:")
            for uf, old in sorted(unresolved):
                print(f"  {uf}: '{old}'")
                
            conn.close()
            return mappings, unresolved
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

scan_gpkg(r"c:\mapas\Observatorio\resultados_geo\locais_votacao_2002_gkpg.zip", 2002, "locais_votacao_2002_padronizado")
scan_gpkg(r"c:\mapas\Observatorio\resultados_geo\locais_votacao_2006_gkpg.zip", 2006, "locais_votacao_2006_padronizado")
