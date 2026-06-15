import json
import sqlite3
import zipfile
import tempfile
import os
import shutil
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

# Manual overrides (clean name key -> correct official name)
manual_overrides_clean = {
    ("AL", "SENADOR TEOTONIO VILELA"): "TEOTÔNIO VILELA",
    ("BA", "GOVERNADOR LOMANTO JUNIOR"): "BARRO PRETO",
    ("CE", "SENADOR CATUNDA"): "CATUNDA",
    ("CE", "TEJUSSUOCA"): "TEJUÇUOCA",
    ("DF", "BRASILIA"): "BRASÍLIA",
    ("MS", "BATAGUACU"): "BATAGUASSU",
    ("PA", "VIZEU"): "VISEU",
    ("PB", "CAMPO DE SANTANA"): "TACIMA",
    ("PB", "SANTAREM"): "JOCA CLAUDINO",
    ("PE", "FERNANDO DE NORONHA"): "FERNANDO DE NORONHA",
    ("PE", "ITAMARACA"): "ILHA DE ITAMARACÁ",
    ("PR", "LUISIANIA"): "LUIZIANA",
    ("PR", "VILA ALTA"): "ALTO PARAÍSO",
    ("RN", "ARES"): "AREZ",
    ("SC", "PICARRAS"): "BALNEÁRIO PIÇARRAS",
    ("SP", "IPAUCU"): "IPAUSSU",
    ("TO", "FORTALEZA DO TABOCAO"): "TABOCÃO",
}

def find_best_match(uf, gpkg_name):
    gpkg_clean = clean_str(gpkg_name)
    if uf not in official_lookup:
        return None
        
    state_lookup = official_lookup[uf]
    
    # Check manual overrides first (using clean representation)
    if (uf, gpkg_clean) in manual_overrides_clean:
        return manual_overrides_clean[(uf, gpkg_clean)]
        
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
    if "DEP " in gpkg_clean or "DEP." in gpkg_clean:
        clean_no_dep = gpkg_clean.replace("DEP ", "").replace("DEP.", "").strip()
        for clean_off, orig in state_lookup.items():
            if clean_no_dep in clean_off:
                return orig
                
    # Rule 6: Levenshtein distance for close typos
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

def update_zip_gpkg_dynamic(zip_path, year, table_name, drop_triggers=False):
    print(f"\n==========================================")
    print(f"Modifying {year} GPKG: {zip_path}")
    print(f"==========================================")
    
    if not os.path.exists(zip_path):
        print(f"Error: {zip_path} not found!")
        return
        
    temp_dir = tempfile.mkdtemp()
    extracted_gpkg_path = None
    
    try:
        # Extract GPKG from zip
        with zipfile.ZipFile(zip_path, 'r') as z_in:
            gpkg_names = [name for name in z_in.namelist() if name.lower().endswith('.gpkg')]
            if not gpkg_names:
                print("No GPKG file found in zip!")
                return
            gpkg_name = gpkg_names[0]
            print(f"Extracting {gpkg_name}...")
            extracted_gpkg_path = z_in.extract(gpkg_name, temp_dir)
            
        print(f"Extracted to: {extracted_gpkg_path}")
        
        # Connect to SQLite
        conn = sqlite3.connect(extracted_gpkg_path)
        cursor = conn.cursor()
        
        # Query distinct cities in GPKG
        cursor.execute(f"SELECT DISTINCT sg_uf, nm_localidade FROM {table_name};")
        db_cities = cursor.fetchall()
        
        # Determine necessary updates
        to_update = []
        for uf, name in db_cities:
            if not uf or not name or name.strip() == "":
                continue
            
            # Check if already exact match
            if uf in official_cities and name in official_cities[uf]:
                continue
                
            # Otherwise search for best match
            match = find_best_match(uf, name)
            if match and match != name:
                to_update.append((uf, name, match))
                
        if not to_update:
            print("No updates needed for this database!")
            conn.close()
            return

        print(f"Found {len(to_update)} names to update in database:")
        for uf, old, new in sorted(to_update):
            print(f"  [{uf}] '{old}' -> '{new}'")

        # Handle triggers
        triggers = []
        try:
            if drop_triggers:
                cursor.execute(f"SELECT name, sql FROM sqlite_master WHERE type='trigger' AND tbl_name=?;", (table_name,))
                triggers = cursor.fetchall()
                print(f"Found {len(triggers)} triggers. Dropping them temporarily...")
                for name, _ in triggers:
                    cursor.execute(f"DROP TRIGGER \"{name}\";")
                print("Triggers dropped.")
                
            # Perform updates
            total_updated = 0
            for uf, old, new in to_update:
                cursor.execute(
                    f"UPDATE {table_name} SET nm_localidade = ? WHERE nm_localidade = ? AND sg_uf = ?;",
                    (new, old, uf)
                )
                total_updated += cursor.rowcount
                
            print(f"Total rows updated: {total_updated}")
            
            if drop_triggers and triggers:
                print("Recreating triggers...")
                for name, sql in triggers:
                    cursor.execute(sql)
                print("Triggers recreated successfully.")
                
            conn.commit()
            print("Database updates committed.")
        except Exception as e:
            conn.rollback()
            print(f"Database operation failed: {e}")
            raise
        finally:
            conn.close()
            print("Database connection closed.")
            
        # Re-pack ZIP
        temp_zip_path = os.path.join(temp_dir, "temp_archive.zip")
        with zipfile.ZipFile(zip_path, 'r') as z_in:
            with zipfile.ZipFile(temp_zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as z_out:
                for item in z_in.infolist():
                    if item.filename == gpkg_name:
                        z_out.write(extracted_gpkg_path, gpkg_name)
                        print(f"Added updated {gpkg_name} to new zip.")
                    else:
                        z_out.writestr(item, z_in.read(item.filename))
                        
        shutil.move(temp_zip_path, zip_path)
        print(f"Swapped original ZIP file with updated one at {zip_path}")
        
    finally:
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
            print("Cleaned up temp directory.")

# Run dynamic updates
update_zip_gpkg_dynamic(r"c:\mapas\Observatorio\resultados_geo\locais_votacao_2002_gkpg.zip", 2002, "locais_votacao_2002_padronizado", drop_triggers=False)
update_zip_gpkg_dynamic(r"c:\mapas\Observatorio\resultados_geo\locais_votacao_2006_gkpg.zip", 2006, "locais_votacao_2006_padronizado", drop_triggers=True)
