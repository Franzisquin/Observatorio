import json
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

official_lookup = {}
for uf, list_cities in official_cities.items():
    official_lookup[uf] = {}
    for city in list_cities:
        official_lookup[uf][clean_str(city)] = city

def find_best_match(uf, gpkg_name):
    gpkg_clean = clean_str(gpkg_name)
    if uf not in official_lookup:
        return None
    state_lookup = official_lookup[uf]
    if gpkg_clean in state_lookup:
        return state_lookup[gpkg_clean]
    gpkg_i = gpkg_clean.replace("Y", "I")
    for clean_off, orig in state_lookup.items():
        clean_off_i = clean_off.replace("Y", "I")
        if gpkg_i == clean_off_i:
            return orig
    matches = []
    for clean_off, orig in state_lookup.items():
        if clean_off.startswith(gpkg_clean) or gpkg_clean.startswith(clean_off):
            matches.append(orig)
    if len(matches) == 1:
        return matches[0]
    gpkg_oeste = gpkg_clean.replace("D OESTE", "DO OESTE").replace("D  OESTE", "DO OESTE")
    for clean_off, orig in state_lookup.items():
        clean_off_oeste = clean_off.replace("D OESTE", "DO OESTE").replace("D  OESTE", "DO OESTE")
        if gpkg_oeste == clean_off_oeste:
            return orig
    if "DEP " in gpkg_clean or "DEP." in gpkg_clean:
        clean_no_dep = gpkg_clean.replace("DEP ", "").replace("DEP.", "").strip()
        for clean_off, orig in state_lookup.items():
            if clean_no_dep in clean_off:
                return orig
    from difflib import SequenceMatcher
    best_ratio = 0
    best_orig = None
    for clean_off, orig in state_lookup.items():
        ratio = SequenceMatcher(None, gpkg_clean, clean_off).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best_orig = orig
    if best_ratio > 0.85:
        return best_orig
    return None

# Manual overrides for unresolved:
manual_overrides = {
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

# Also existing hardcoded updates in update_gpkg.py:
existing_updates = [
    ("RJ", "CAMPOS", "CAMPOS DOS GOYTACAZES"),
    ("RJ", "ARMACAO DE BUZIOS", "ARMAÇÃO DOS BÚZIOS"),
    ("RJ", "PARATI", "PARATY"),
    ("RJ", "PATI DO ALFERES", "PATY DO ALFERES"),
    ("RJ", "TRAJANO DE MORAIS", "TRAJANO DE MORAES"),
    ("RJ", "VARRE E SAI", "VARRE-SAI"),
    ("AC", "SANTA ROSA", "SANTA ROSA DO PURUS"),
    ("AP", "AMAPARI", "PEDRA BRANCA DO AMAPARI"),
    ("ES", "SAO DOMINGOS", "SÃO DOMINGOS DO NORTE"),
    ("PE", "CABO", "CABO DE SANTO AGOSTINHO"),
    ("PE", "JABOATAO", "JABOATÃO DOS GUARARAPES"),
    ("SP", "EMBU", "EMBU DAS ARTES"),
    ("TO", "MONTE SANTO", "MONTE SANTO DO TOCANTINS"),
    ("RO", "NOVA BRASILANDIA", "NOVA BRASILÂNDIA D OESTE"),
    ("RR", "SAO LUIZ DO ANAUA", "SÃO LUIZ")
]

# Read unmatched list and resolve them
unmatched_cities = []
with open(r"c:\mapas\Observatorio\scratch\unmatched_gpkg_cities.txt", "r", encoding="utf-8") as f:
    for line in f:
        # e.g.:   UF: AC | GPKG Name: 'MANUEL URBANO' | Candidates: []
        if "UF:" in line and "GPKG Name:" in line:
            parts = line.split("|")
            uf = parts[0].replace("UF:", "").strip()
            gpkg_name = parts[1].replace("GPKG Name:", "").replace("'", "").strip()
            unmatched_cities.append((uf, gpkg_name))

# Combine all:
resolved_map = {}
for uf, gpkg_name in unmatched_cities:
    key = (uf, gpkg_name)
    if key in resolved_map:
        continue
    # 1. Try manual override
    if key in manual_overrides:
        resolved_map[key] = manual_overrides[key]
    # 2. Try existing updates
    else:
        found_existing = False
        for ex_uf, ex_old, ex_new in existing_updates:
            if ex_uf == uf and clean_str(ex_old) == clean_str(gpkg_name):
                resolved_map[key] = ex_new
                found_existing = True
                break
        if not found_existing:
            # 3. Try automatic match
            match = find_best_match(uf, gpkg_name)
            if match:
                resolved_map[key] = match
            else:
                print(f"STILL UNRESOLVED: {uf} - {gpkg_name}")

print(f"\nTotal resolved mappings: {len(resolved_map)}")
print("Sample mappings:")
for k, v in list(resolved_map.items())[:10]:
    print(f"  {k} -> {v}")

# Write to a Python file update_gpkg_all.py which applies all these updates!
with open(r"c:\mapas\Observatorio\scratch\update_gpkg_all.py", "w", encoding="utf-8") as f:
    f.write('''# Auto-generated script to update all unmatched GPKG cities
import sqlite3
import zipfile
import tempfile
import os
import shutil

updates = [
''')
    # Let's add all of them, including existing ones to be completely safe and thorough
    all_updates = []
    # Add existing ones first, just in case
    for uf, old, new in existing_updates:
        all_updates.append((uf, old, new))
    
    # Add newly resolved ones
    for (uf, old), new in resolved_map.items():
        # Check if already added
        if not any(x[0] == uf and x[1] == old for x in all_updates):
            all_updates.append((uf, old, new))
            
    for uf, old, new in sorted(all_updates):
        f.write(f'    ({repr(uf)}, {repr(old)}, {repr(new)}),\n')
        
    f.write(''']

def update_zip_gpkg(zip_path, year, table_name, drop_triggers=False):
    print(f"\\n==========================================")
    print(f"Modifying {year} GPKG: {zip_path}")
    print(f"==========================================")
    
    if not os.path.exists(zip_path):
        print(f"Error: {zip_path} not found!")
        return
        
    temp_dir = tempfile.mkdtemp()
    extracted_gpkg_path = None
    
    try:
        # Find the .gpkg file inside the zip and extract it
        with zipfile.ZipFile(zip_path, 'r') as z_in:
            gpkg_names = [name for name in z_in.namelist() if name.lower().endswith('.gpkg')]
            if not gpkg_names:
                print("No GPKG file found in zip!")
                return
            gpkg_name = gpkg_names[0]
            print(f"Extracting {gpkg_name}...")
            extracted_gpkg_path = z_in.extract(gpkg_name, temp_dir)
            
        print(f"Extracted to: {extracted_gpkg_path}")
        
        # Connect to GPKG
        conn = sqlite3.connect(extracted_gpkg_path)
        cursor = conn.cursor()
        
        triggers = []
        try:
            if drop_triggers:
                # 1. Fetch triggers
                cursor.execute(f"SELECT name, sql FROM sqlite_master WHERE type='trigger' AND tbl_name=?;", (table_name,))
                triggers = cursor.fetchall()
                print(f"Found {len(triggers)} triggers. Dropping them temporarily...")
                
                # 2. Drop triggers
                for name, _ in triggers:
                    cursor.execute(f"DROP TRIGGER \\"{name}\\";")
                print("Triggers dropped.")
                
            # 3. Execute updates
            updated_count = 0
            for uf, old_name, new_name in updates:
                query = f"UPDATE {table_name} SET nm_localidade = ? WHERE nm_localidade = ? AND sg_uf = ?;"
                cursor.execute(query, (new_name, old_name, uf))
                rows_affected = cursor.rowcount
                if rows_affected > 0:
                    print(f"  [{uf}] '{old_name}' -> '{new_name}': updated {rows_affected} rows.")
                    updated_count += rows_affected
                    
            print(f"Total rows updated: {updated_count}")
            
            if drop_triggers and triggers:
                # 4. Recreate triggers
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
        
        # Re-pack the ZIP file: create a new temp zip and swap it with the original
        temp_zip_path = os.path.join(temp_dir, "temp_archive.zip")
        
        with zipfile.ZipFile(zip_path, 'r') as z_in:
            with zipfile.ZipFile(temp_zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as z_out:
                for item in z_in.infolist():
                    if item.filename == gpkg_name:
                        # Write the modified GPKG file instead of the original
                        z_out.write(extracted_gpkg_path, gpkg_name)
                        print(f"Added updated {gpkg_name} to new zip.")
                    else:
                        # Copy other files untouched
                        z_out.writestr(item, z_in.read(item.filename))
                        
        # Replace original zip with the updated zip
        shutil.move(temp_zip_path, zip_path)
        print(f"Swapped original ZIP file with updated one at {zip_path}")
        
    finally:
        # Clean up temporary directory
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
            print("Cleaned up temp directory.")

# Run updates
update_zip_gpkg(r"c:\\mapas\\Observatorio\\resultados_geo\\locais_votacao_2002_gkpg.zip", 2002, "locais_votacao_2002_padronizado", drop_triggers=False)
update_zip_gpkg(r"c:\\mapas\\Observatorio\\resultados_geo\\locais_votacao_2006_gkpg.zip", 2006, "locais_votacao_2006_padronizado", drop_triggers=True)
''')
print("Successfully generated c:\\mapas\\Observatorio\\scratch\\update_gpkg_all.py")
