import sqlite3
import zipfile
import tempfile
import os
import shutil

updates = [
    # RJ
    ("RJ", "CAMPOS", "CAMPOS DOS GOYTACAZES"),
    ("RJ", "ARMACAO DE BUZIOS", "ARMAÇÃO DOS BÚZIOS"),
    ("RJ", "PARATI", "PARATY"),
    ("RJ", "PATI DO ALFERES", "PATY DO ALFERES"),
    ("RJ", "TRAJANO DE MORAIS", "TRAJANO DE MORAES"),
    ("RJ", "VARRE E SAI", "VARRE-SAI"),
    # Outros estados
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

def update_zip_gpkg(zip_path, year, table_name, drop_triggers=False):
    print(f"\n==========================================")
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
                    cursor.execute(f"DROP TRIGGER \"{name}\";")
                print("Triggers dropped.")
                
            # 3. Execute updates
            for uf, old_name, new_name in updates:
                query = f"UPDATE {table_name} SET nm_localidade = ? WHERE nm_localidade = ? AND sg_uf = ?;"
                cursor.execute(query, (new_name, old_name, uf))
                rows_affected = cursor.rowcount
                if rows_affected > 0:
                    print(f"  [{uf}] '{old_name}' -> '{new_name}': updated {rows_affected} rows.")
                    
            if drop_triggers and triggers:
                # 4. Recreate triggers
                print("Recreating triggers...")
                for name, sql in triggers:
                    # SQLite stores trigger SQL in sqlite_master
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

# Run update for 2002 (no spatial triggers)
update_zip_gpkg(r"c:\mapas\Observatorio\resultados_geo\locais_votacao_2002_gkpg.zip", 2002, "locais_votacao_2002_padronizado", drop_triggers=False)

# Run update for 2006 (requires dropping triggers because of ST_IsEmpty)
update_zip_gpkg(r"c:\mapas\Observatorio\resultados_geo\locais_votacao_2006_gkpg.zip", 2006, "locais_votacao_2006_padronizado", drop_triggers=True)
