import os
import zipfile
import pandas as pd

# 1. Define o caminho onde estão os seus arquivos ZIP
caminho_pasta = r'C:\mapas\site eleições\Resultados 2002'

# 2. Cria uma subpasta para guardar os arquivos Parquet (para não misturar)
pasta_destino = os.path.join(caminho_pasta, 'Parquets_Gerados')
os.makedirs(pasta_destino, exist_ok=True)

# 3. Percorre todos os arquivos dentro do diretório
for arquivo in os.listdir(caminho_pasta):
    if arquivo.endswith('.zip'):
        caminho_zip = os.path.join(caminho_pasta, arquivo)
        
        # Abre o arquivo ZIP sem extrair
        with zipfile.ZipFile(caminho_zip, 'r') as z:
            arquivos_no_zip = z.namelist()
            
            # --- NOVA LÓGICA DE SELEÇÃO DE ARQUIVO ---
            if arquivo == 'consulta_cand_2002.zip':
                # Regra específica: se for este zip, pega apenas o CSV do BRASIL
                if 'consulta_cand_2002_BRASIL.csv' in arquivos_no_zip:
                    nome_csv = 'consulta_cand_2002_BRASIL.csv'
                else:
                    nome_csv = None # Se por acaso não existir no zip, ignora
            else:
                # Regra original: lista os CSVs e pega o primeiro
                lista_csv = [f for f in arquivos_no_zip if f.endswith('.csv')]
                nome_csv = lista_csv[0] if lista_csv else None
            # -----------------------------------------
            
            if nome_csv:
                print(f"Lendo o arquivo: {nome_csv} (de dentro do {arquivo})...")
                
                # Abre apenas o CSV na memória
                with z.open(nome_csv) as f:
                    # Lê o CSV. O TSE usa separador ';' e encoding 'latin1'
                    # Em caso de arquivos grandes, o 'low_memory=False' evita alguns avisos do Pandas
                    df = pd.read_csv(f, sep=';', encoding='latin1', low_memory=False)
                    
                    # Define o nome de saída trocando a extensão
                    nome_parquet = nome_csv.replace('.csv', '.parquet')
                    caminho_parquet = os.path.join(pasta_destino, nome_parquet)
                    
                    # Salva como Parquet
                    df.to_parquet(caminho_parquet, index=False)
                    print(f"-> Salvo: {nome_parquet}\n")

print("Conversão finalizada com sucesso!")