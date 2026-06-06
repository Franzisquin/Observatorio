# Auto-generated script to update all unmatched GPKG cities
import sqlite3
import zipfile
import tempfile
import os
import shutil

updates = [
    ('AC', 'MANUEL URBANO', 'MANOEL URBANO'),
    ('AC', 'SANTA ROSA', 'SANTA ROSA DO PURUS'),
    ('AL', 'OLHO DAGUA DAS FLORES', 'OLHO D ÁGUA DAS FLORES'),
    ('AL', 'OLHO DAGUA DO CASADO', 'OLHO D ÁGUA DO CASADO'),
    ('AL', 'OLHO DAGUA GRANDE', 'OLHO D ÁGUA GRANDE'),
    ('AL', 'SENADOR TEOTONIO VILELA', 'TEOTÔNIO VILELA'),
    ('AL', 'TANQUE DARCA', 'TANQUE D ARCA'),
    ('AM', 'BOA VISTA DE RAMOS', 'BOA VISTA DO RAMOS'),
    ('AM', 'NOVO AYRAO', 'NOVO AIRÃO'),
    ('AP', 'AMAPARI', 'PEDRA BRANCA DO AMAPARI'),
    ('BA', 'CAMACAN', 'CAMACÃ'),
    ('BA', 'DIAS DAVILA', 'DIAS D ÁVILA'),
    ('BA', 'GOVERNADOR LOMANTO JUNIOR', 'BARRO PRETO'),
    ('BA', 'PALMAS DO MONTE ALTO', 'PALMAS DE MONTE ALTO'),
    ('BA', 'QUINJINGUE', 'QUIJINGUE'),
    ('BA', 'SANTA CRUZ DE CABRALIA', 'SANTA CRUZ CABRÁLIA'),
    ('BA', 'SANTA TERESINHA', 'SANTA TEREZINHA'),
    ('BA', 'VEREDAS', 'VEREDA'),
    ('BA', 'XIQUE XIQUE', 'XIQUE-XIQUE'),
    ('CE', 'DEP IRAPUAN PINHEIRO', 'DEPUTADO IRAPUAN PINHEIRO'),
    ('CE', 'EUZEBIO', 'EUSÉBIO'),
    ('CE', 'GRANGEIRO', 'GRANJEIRO'),
    ('CE', 'ITAPAGE', 'ITAPAJÉ'),
    ('CE', 'SENADOR CATUNDA', 'CATUNDA'),
    ('CE', 'TEJUSSUOCA', 'TEJUÇUOCA'),
    ('DF', 'BRASILIA', 'BRASÍLIA'),
    ('ES', 'SANTA MARIA DO JETIBA', 'SANTA MARIA DE JETIBÁ'),
    ('ES', 'SAO DOMINGOS', 'SÃO DOMINGOS DO NORTE'),
    ('GO', 'AGUAS LINDAS', 'ÁGUAS LINDAS DE GOIÁS'),
    ('GO', 'ALTO PARAISO', 'ALTO PARAÍSO DE GOIÁS'),
    ('GO', 'BOM JESUS', 'BOM JESUS DE GOIÁS'),
    ('GO', 'MUNDO NOVO DE GOIAS', 'MUNDO NOVO'),
    ('GO', 'SAO JOAO DALIANCA', 'SÃO JOÃO D ALIANÇA'),
    ('GO', 'SITIO DABADIA', 'SÍTIO D ABADIA'),
    ('GO', 'VALPARAISO', 'VALPARAÍSO DE GOIÁS'),
    ('MA', 'AGUA DOCE', 'ÁGUA DOCE DO MARANHÃO'),
    ('MA', 'APICUM ACU', 'APICUM-AÇU'),
    ('MA', 'BELA VISTA', 'BELA VISTA DO MARANHÃO'),
    ('MA', 'CONCEICAO DO LAGO ACU', 'CONCEIÇÃO DO LAGO-AÇU'),
    ('MA', 'GOVERNADOR EDSON LOBAO', 'GOVERNADOR EDISON LOBÃO'),
    ('MA', 'ITAPECURU-MIRIM', 'ITAPECURU MIRIM'),
    ('MA', 'LUIS DOMINGUES DO MARANHAO', 'LUÍS DOMINGUES'),
    ('MA', 'OLHO DAGUA DAS CUNHAS', 'OLHO D ÁGUA DAS CUNHÃS'),
    ('MA', 'PINDARE MIRIM', 'PINDARÉ-MIRIM'),
    ('MA', 'SAO RAIMUNDO DA DOCA BEZERRA', 'SÃO RAIMUNDO DO DOCA BEZERRA'),
    ('MA', 'SENADOR LA ROQUE', 'SENADOR LA ROCQUE'),
    ('MG', 'BRASOPOLIS', 'BRAZÓPOLIS'),
    ('MG', 'CONCEICAO DA PEDRA', 'CONCEIÇÃO DAS PEDRAS'),
    ('MG', 'GOUVEA', 'GOUVEIA'),
    ('MG', 'OLHOS DAGUA', 'OLHOS D ÁGUA'),
    ('MG', 'PINGO DAGUA', 'PINGO D ÁGUA'),
    ('MG', 'SANTA RITA DO IBITIPOCA', 'SANTA RITA DE IBITIPOCA'),
    ('MG', 'SAO TOME DAS LETRAS', 'SÃO THOMÉ DAS LETRAS'),
    ('MG', 'SAPUCAI MIRIM', 'SAPUCAÍ-MIRIM'),
    ('MG', 'SEM-PEIXE', 'SEM PEIXE'),
    ('MS', 'APARECIDA DO TABUADO', 'APARECIDA DO TABOADO'),
    ('MS', 'BATAGUACU', 'BATAGUASSU'),
    ('MS', 'BATAIPORA', 'BATAYPORÃ'),
    ('MS', 'JUTY', 'JUTI'),
    ('MT', 'ALTO DA BOA VISTA', 'ALTO BOA VISTA'),
    ('MT', 'CONQUISTA DOESTE', 'CONQUISTA D OESTE'),
    ('MT', 'FIGUEIROPOLIS DOESTE', 'FIGUEIRÓPOLIS D OESTE'),
    ('MT', 'GLORIA DOESTE', 'GLÓRIA D OESTE'),
    ('MT', 'LAMBARI DOESTE', 'LAMBARI D OESTE'),
    ('MT', 'MIRASSOL DOESTE', 'MIRASSOL D OESTE'),
    ('MT', 'NOVA BANDEIRANTE', 'NOVA BANDEIRANTES'),
    ('MT', 'POXOREO', 'POXORÉU'),
    ('PA', 'ALMERIM', 'ALMEIRIM'),
    ('PA', 'ELDORADO DO CARAJAS', 'ELDORADO DOS CARAJÁS'),
    ('PA', 'IGARAPE ACU', 'IGARAPÉ-AÇU'),
    ('PA', 'PAU DARCO', 'PAU D ARCO'),
    ('PA', 'TOME ACU', 'TOMÉ-AÇU'),
    ('PA', 'VIZEU', 'VISEU'),
    ('PB', 'BARAUNAS', 'BARAÚNA'),
    ('PB', 'CAMPO DE SANTANA', 'TACIMA'),
    ('PB', 'SANTA CECILIA DE UMBUZEIRO', 'SANTA CECÍLIA'),
    ('PB', 'SANTAREM', 'JOCA CLAUDINO'),
    ('PB', 'SAO DOMINGOS DE POMBAL', 'SÃO DOMINGOS'),
    ('PB', 'SAO JOSE DO BREJO CRUZ', 'SÃO JOSÉ DO BREJO DO CRUZ'),
    ('PB', 'SAO SEB. DE LAGOA DE ROCA', 'SÃO SEBASTIÃO DE LAGOA DE ROÇA'),
    ('PE', 'BELEM DE SAO FRANCISCO', 'BELÉM DO SÃO FRANCISCO'),
    ('PE', 'CABO', 'CABO DE SANTO AGOSTINHO'),
    ('PE', 'IGUARACI', 'IGUARACY'),
    ('PE', 'ITAMARACA', 'ILHA DE ITAMARACÁ'),
    ('PE', 'JABOATAO', 'JABOATÃO DOS GUARARAPES'),
    ('PE', 'SAO CAETANO', 'SÃO CAITANO'),
    ('PI', 'ALAGOINHA', 'ALAGOINHA DO PIAUÍ'),
    ('PI', 'BARRA DALCANTARA', 'BARRA D ALCÂNTARA'),
    ('PI', 'OLHO DAGUA DO PIAUI', 'OLHO D ÁGUA DO PIAUÍ'),
    ('PI', 'PAU DARCO DO PIAUI', 'PAU D ARCO DO PIAUÍ'),
    ('PR', 'CONSELHEIRO MAYRINCK', 'CONSELHEIRO MAIRINCK'),
    ('PR', 'DIAMANTE DO OESTE', 'DIAMANTE D OESTE'),
    ('PR', 'ITAGUAGE', 'ITAGUAJÉ'),
    ('PR', 'ITAPEJARA DO OESTE', 'ITAPEJARA D OESTE'),
    ('PR', 'LUISIANIA', 'LUIZIANA'),
    ('PR', 'MOREIRA SALLES', 'MOREIRA SALES'),
    ('PR', 'PEROLA DOESTE', 'PÉROLA'),
    ('PR', 'RANCHO ALEGRE DOESTE', 'RANCHO ALEGRE'),
    ('PR', 'SANTA ANA DO ITARARE', 'SANTANA DO ITARARÉ'),
    ('PR', 'SANTA CRUZ DO MONTE CASTELO', 'SANTA CRUZ DE MONTE CASTELO'),
    ('PR', 'SANTA IZABEL DO IVAI', 'SANTA ISABEL DO IVAÍ'),
    ('PR', 'SAO JORGE DOESTE', 'SÃO JORGE D OESTE'),
    ('PR', 'VILA ALTA', 'ALTO PARAÍSO'),
    ('RJ', 'ARMACAO DE BUZIOS', 'ARMAÇÃO DOS BÚZIOS'),
    ('RJ', 'CAMPOS', 'CAMPOS DOS GOYTACAZES'),
    ('RJ', 'PARATI', 'PARATY'),
    ('RJ', 'PATI DO ALFERES', 'PATY DO ALFERES'),
    ('RJ', 'TRAJANO DE MORAIS', 'TRAJANO DE MORAES'),
    ('RJ', 'VARRE E SAI', 'VARRE-SAI'),
    ('RN', 'ARES', 'AREZ'),
    ('RN', 'CEARA MIRIM', 'CEARÁ-MIRIM'),
    ('RN', 'CERRO-CORA', 'CERRO CORÁ'),
    ('RN', 'FERNANDO PEDROSA', 'FERNANDO PEDROZA'),
    ('RN', 'LAGOA DANTA', 'LAGOA D ANTA'),
    ('RN', 'OLHO DAGUA DO BORGES', 'OLHO D ÁGUA DO BORGES'),
    ('RN', 'SAO JOSE DE CAMPESTRE', 'SÃO JOSÉ DO CAMPESTRE'),
    ('RN', 'SAO MIGUEL DE TOUROS', 'SÃO MIGUEL'),
    ('RN', 'VENHA VER', 'VENHA-VER'),
    ('RO', 'ALTA FLORESTA DO OESTE', 'ALTA FLORESTA D OESTE'),
    ('RO', 'ESPIGAO D OESTE', 'ESPIGÃO DO OESTE'),
    ('RO', 'GUAJARA MIRIM', 'GUAJARÁ-MIRIM'),
    ('RO', 'JI PARANA', 'JI-PARANÁ'),
    ('RO', 'MACHADINHO DO OESTE', 'MACHADINHO D OESTE'),
    ('RO', 'NOVA BRASILANDIA', 'NOVA BRASILÂNDIA D OESTE'),
    ('RO', 'SANTA LUZIA DO OESTE', 'SANTA LUZIA D OESTE'),
    ('RO', 'SAO FELIPE DO OESTE', 'SÃO FELIPE D OESTE'),
    ('RR', 'SAO JOAO DO BALIZA', 'SÃO JOÃO DA BALIZA'),
    ('RR', 'SAO LUIZ DO ANAUA', 'SÃO LUIZ'),
    ('RS', 'CHIAPETA', 'CHIAPETTA'),
    ('RS', 'ENTRE IJUIS', 'ENTRE-IJUÍS'),
    ('RS', 'NAO ME TOQUE', 'NÃO-ME-TOQUE'),
    ('RS', 'SANTANA DO LIVRAMENTO', 'SANT ANA DO LIVRAMENTO'),
    ('RS', 'SAO LUIS GONZAGA', 'SÃO LUIZ GONZAGA'),
    ('SC', 'BALNEARIO DE BARRA DO SUL', 'BALNEÁRIO BARRA DO SUL'),
    ('SC', 'GRAO PARA', 'GRÃO-PARÁ'),
    ('SC', 'HERVAL DO OESTE', 'HERVAL D OESTE'),
    ('SC', 'HERVAL DOESTE', 'HERVAL D OESTE'),
    ('SC', 'LUIS ALVES', 'LUIZ ALVES'),
    ('SC', 'PICARRAS', 'BALNEÁRIO PIÇARRAS'),
    ('SC', 'PRESIDENTE CASTELO BRANCO', 'PRESIDENTE CASTELLO BRANCO'),
    ('SE', 'AMPARO DO SAO FRANCISCO', 'AMPARO DE SÃO FRANCISCO'),
    ('SE', 'CANINDE DO SAO FRANCISCO', 'CANINDÉ DE SÃO FRANCISCO'),
    ('SE', 'ITAPORANGA DAJUDA', 'ITAPORANGA D AJUDA'),
    ('SP', 'APARECIDA DOESTE', 'APARECIDA'),
    ('SP', 'ARCO IRIS', 'ARCO-ÍRIS'),
    ('SP', 'BADY BASSIT', 'BADY BASSITT'),
    ('SP', 'BERNADINO DE CAMPOS', 'BERNARDINO DE CAMPOS'),
    ('SP', 'EMBU', 'EMBU DAS ARTES'),
    ('SP', 'EMBU GUACU', 'EMBU-GUAÇU'),
    ('SP', 'ESTRELA DOESTE', 'ESTRELA D OESTE'),
    ('SP', 'GUARANI DOESTE', 'GUARÁ'),
    ('SP', 'IPAUCU', 'IPAUSSU'),
    ('SP', 'LUISIANIA', 'LUIZIÂNIA'),
    ('SP', 'MOJI GUACU', 'MOGI GUAÇU'),
    ('SP', 'MOJI MIRIM', 'MOGI MIRIM'),
    ('SP', 'MOJI-GUACU', 'MOGI GUAÇU'),
    ('SP', 'MOJI-MIRIM', 'MOGI MIRIM'),
    ('SP', 'PALMEIRA DOESTE', 'PALMEIRA D OESTE'),
    ('SP', 'PIRACUNUNGA', 'PIRASSUNUNGA'),
    ('SP', 'SALMORAO', 'SALMOURÃO'),
    ('SP', 'SANTA BARBARA DOESTE', 'SANTA BÁRBARA D OESTE'),
    ('SP', 'SANTA CLARA DOESTE', 'SANTA CLARA D OESTE'),
    ('SP', 'SANTA RITA DOESTE', 'SANTA RITA D OESTE'),
    ('SP', 'SANTO ANTONIO DA POSSE', 'SANTO ANTÔNIO DE POSSE'),
    ('SP', 'SAO JOAO DO PAU DALHO', 'SÃO JOÃO DO PAU D ALHO'),
    ('SP', 'SUD MENUCCI', 'SUD MENNUCCI'),
    ('SP', 'SUZANOPOLIS', 'SUZANO'),
    ('SP', 'VALPARAIZO', 'VALPARAÍSO'),
    ('TO', 'BANDEIRANTE DO TOCANTINS', 'BANDEIRANTES DO TOCANTINS'),
    ('TO', 'COUTO DE MAGALHAES', 'COUTO MAGALHÃES'),
    ('TO', 'FORTALEZA DO TABOCAO', 'TABOCÃO'),
    ('TO', 'LAGEADO', 'LAJEADO'),
    ('TO', 'MONTE SANTO', 'MONTE SANTO DO TOCANTINS'),
    ('TO', 'PAU DARCO', 'PAU D ARCO'),
    ('TO', 'SAO VALERIO DA NATIVIDADE', 'SÃO VALÉRIO'),
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
update_zip_gpkg(r"c:\mapas\Observatorio\resultados_geo\locais_votacao_2002_gkpg.zip", 2002, "locais_votacao_2002_padronizado", drop_triggers=False)
update_zip_gpkg(r"c:\mapas\Observatorio\resultados_geo\locais_votacao_2006_gkpg.zip", 2006, "locais_votacao_2006_padronizado", drop_triggers=True)
