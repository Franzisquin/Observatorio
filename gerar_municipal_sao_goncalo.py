"""
Gera GeoPackage com resultados de eleições municipais (Prefeito)
de São Gonçalo (RJ) de 2000 a 2024, agregados por bairro/região
nas geometrias do arquivo base.
"""

import geopandas as gpd
import pandas as pd
import json
import zipfile
import os
import re
import warnings
from shapely.geometry import Point

warnings.filterwarnings('ignore')

# ===== CONFIGURAÇÃO =====
GEOMETRIAS_PATH = r'E:\Mapas\Municipais por Bairro\RJ - São Gonçalo\Geometrias Base.gpkg'
OUTPUT_PATH = r'E:\Mapas\Municipais por Bairro\RJ - São Gonçalo\Resultados Prefeito.gpkg'
SITE_DIR = r'c:\Users\lixov\OneDrive\Documentos\Observatorio\resultados_geo'
DADOS_DIR = r'E:\Mapas\Dados'

# Anos municipais com GeoJSON no site
GEOJSON_YEARS = [2008, 2012, 2016, 2020, 2024]
# Anos que precisam de processamento especial
SPECIAL_YEARS = [2000, 2004]

MUNICIPIO_FILTER = 'SÃO GONÇALO'

def normalize_party(name):
    """Normaliza nome de partido para uso como coluna."""
    name = name.strip().upper()
    name = name.replace(' ', '_')
    # Remove acentos
    import unicodedata
    name = unicodedata.normalize('NFD', name)
    name = ''.join(c for c in name if unicodedata.category(c) != 'Mn')
    return name

def load_geometrias():
    """Carrega as geometrias base de São Gonçalo."""
    gdf = gpd.read_file(GEOMETRIAS_PATH)
    # Manter apenas colunas essenciais + geometry
    keep_cols = ['NM_BAIRRO', 'geometry']
    extra = [c for c in ['id', 'CD_BAIRRO', 'NM_MUN', 'DISTRICT'] if c in gdf.columns]
    keep_cols = extra + keep_cols
    gdf = gdf[keep_cols].copy()
    # Garantir CRS
    if gdf.crs is None:
        gdf = gdf.set_crs('EPSG:4326')
    elif gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs('EPSG:4326')
    return gdf

def load_2006_locations_rj():
    """Carrega locais de votação de 2006 do site para o RJ."""
    # Encontrar o zip correto
    for i in range(1, 7):
        zf_path = os.path.join(SITE_DIR, f'locais_votacao_2006_{i}.zip')
        if not os.path.exists(zf_path):
            continue
        zf = zipfile.ZipFile(zf_path)
        for name in zf.namelist():
            if 'RJ' in name.upper() and name.endswith('.geojson'):
                data = json.loads(zf.read(name))
                print(f"  Carregado locais 2006 RJ de {zf_path}: {len(data['features'])} locais")
                return data
    raise FileNotFoundError("Não encontrado locais_votacao_2006_RJ.geojson nos zips do site")

def load_section_to_local_map_2006():
    """Constrói mapeamento NR_ZONA+NR_SECAO -> NR_LOCAL_VOTACAO a partir de 2006."""
    print("  Construindo mapeamento seção→local de 2006...")
    path = os.path.join(DADOS_DIR, 'votacao_secao_2006_BR.csv')
    section_to_local = {}
    chunks = pd.read_csv(path, sep=';', encoding='latin-1', chunksize=100000,
                         usecols=['SG_UF', 'NR_ZONA', 'NR_SECAO', 'NR_LOCAL_VOTACAO'])
    for chunk in chunks:
        rj = chunk[chunk['SG_UF'] == 'RJ']
        for _, row in rj.iterrows():
            key = (int(row['NR_ZONA']), int(row['NR_SECAO']))
            section_to_local[key] = int(row['NR_LOCAL_VOTACAO'])
    print(f"  Mapeamento construído: {len(section_to_local)} seções")
    return section_to_local

def process_geojson_year(year, geometrias):
    """Processa anos com GeoJSON já existente (2008-2024)."""
    print(f"\n=== Processando {year} (GeoJSON) ===")
    
    zf_path = os.path.join(SITE_DIR, f'{year} Municipais', 'RJ.zip')
    if not os.path.exists(zf_path):
        print(f"  AVISO: {zf_path} não encontrado, pulando")
        return {}
    
    zf = zipfile.ZipFile(zf_path)
    results = {}
    
    for name in zf.namelist():
        if 'GON' not in name.upper():
            continue
        
        # Determinar turno e tipo
        is_ordinaria = 'Ordinaria' in name
        is_suplementar = 'Suplementar' in name
        if not is_ordinaria and not is_suplementar:
            continue
        
        data = json.loads(zf.read(name))
        print(f"  Arquivo: {name} ({len(data['features'])} locais)")
        
        # Extrair candidatos e criar pontos
        points_data = []
        for feat in data['features']:
            props = feat['properties']
            lon = props.get('long') or props.get('pred_long')
            lat = props.get('lat') or props.get('pred_lat')
            if lon is None or lat is None:
                continue
            try:
                lon, lat = float(lon), float(lat)
            except (ValueError, TypeError):
                continue
            if lon == 0 or lat == 0 or lon == -1 or lat == -1:
                continue
            
            point_data = {'geometry': Point(lon, lat)}
            
            # Extrair votos dos candidatos
            for key, value in props.items():
                turno_match = re.search(r'\s+(1T|2T)$', key)
                if not turno_match:
                    continue
                turno = turno_match.group(1)
                core = key[:turno_match.start()].strip()
                
                # Pular métricas
                if any(core.upper().startswith(m) for m in ['TOTAL_VOTOS', 'VOTOS_BRANCOS', 'VOTOS_NULOS', 
                        'ELEITORES_APTOS', 'ABSTENÇÕES', 'ABSTENCOES', 'COMPARECIMENTO', 'VOTOS_LEGENDA', 'NR_TURNO']):
                    continue
                
                # Extrair partido do candidato
                partido_match = re.search(r'\(([^)]+)\)', core)
                if not partido_match:
                    continue
                partido = normalize_party(partido_match.group(1))
                
                col_name = f"{partido}_{year}_{turno}"
                try:
                    val = float(value) if value is not None else 0
                except (ValueError, TypeError):
                    val = 0
                # Accumulate if same party appears multiple times (coligação)
                point_data[col_name] = point_data.get(col_name, 0) + val
            
            points_data.append(point_data)
        
        if not points_data:
            continue
        
        points_gdf = gpd.GeoDataFrame(points_data, crs='EPSG:4326')
        
        # Spatial join
        joined = gpd.sjoin(points_gdf, geometrias, how='inner', predicate='within')
        
        # Agregar votos por região
        vote_cols = [c for c in joined.columns if re.match(r'^[A-Z_]+_\d{4}_(1T|2T)$', c)]
        if vote_cols:
            agg_dict = {c: 'sum' for c in vote_cols}
            aggregated = joined.groupby('index_right').agg(agg_dict)
            
            for col in vote_cols:
                for idx in geometrias.index:
                    if idx in aggregated.index:
                        results[(idx, col)] = aggregated.loc[idx, col]
                    else:
                        results[(idx, col)] = 0
        
        print(f"  Locais matched: {len(joined)}, Colunas: {len(vote_cols)}")
    
    return results

def process_special_year(year, geometrias, locations_2006, section_to_local=None):
    """Processa anos 2000 e 2004 usando dados de seção + base 2006."""
    print(f"\n=== Processando {year} (Seção) ===")
    
    zip_path = os.path.join(DADOS_DIR, f'votacao_secao_{year}_RJ.zip')
    if not os.path.exists(zip_path):
        print(f"  AVISO: {zip_path} não encontrado, pulando")
        return {}
    
    zf = zipfile.ZipFile(zip_path)
    csv_name = f'votacao_secao_{year}_RJ.csv'
    df = pd.read_csv(zf.open(csv_name), sep=';', encoding='latin-1')
    
    # Filtrar apenas Prefeito de São Gonçalo
    df_sg = df[
        (df['NM_MUNICIPIO'].str.upper().str.contains('GON', na=False)) &
        (df['DS_CARGO'] == 'Prefeito')
    ].copy()
    
    print(f"  Registros São Gonçalo Prefeito: {len(df_sg)}")
    
    # Filtrar votos inválidos (brancos, nulos) - manter apenas candidatos
    df_sg = df_sg[~df_sg['NM_VOTAVEL'].isin(['VOTO BRANCO', 'VOTO NULO', 'VOTO ANULADO'])].copy()
    
    # Para 2000, mapear seção → local via 2006
    if year == 2000 and section_to_local is not None:
        df_sg['NR_LOCAL_MAPPED'] = df_sg.apply(
            lambda row: section_to_local.get((int(row['NR_ZONA']), int(row['NR_SECAO'])), -1), axis=1
        )
        unmapped = (df_sg['NR_LOCAL_MAPPED'] == -1).sum()
        total = len(df_sg)
        print(f"  Seções mapeadas: {total - unmapped}/{total} ({(total-unmapped)/total*100:.1f}%)")
        df_sg = df_sg[df_sg['NR_LOCAL_MAPPED'] != -1]
        local_col = 'NR_LOCAL_MAPPED'
    else:
        local_col = 'NR_LOCAL_VOTACAO'
    
    # Construir índice de locais 2006 (zona + local -> Point)
    loc_index = {}
    for feat in locations_2006['features']:
        props = feat['properties']
        nm_loc = str(props.get('nm_localidade', '')).upper()
        if 'GON' not in nm_loc:
            continue
        zone = int(props['NR_ZONA'])
        local = int(props['nr_locvot'])
        lon = props.get('long') or props.get('pred_long')
        lat = props.get('lat') or props.get('pred_lat')
        if lon and lat:
            try:
                lon, lat = float(lon), float(lat)
                if lon != 0 and lat != 0 and lon != -1 and lat != -1:
                    loc_index[(zone, local)] = Point(lon, lat)
            except (ValueError, TypeError):
                pass
    
    print(f"  Locais 2006 com geometria: {len(loc_index)}")
    
    # Processar por turno
    results = {}
    for turno in sorted(df_sg['NR_TURNO'].unique()):
        turno_label = f"{turno}T"
        df_turno = df_sg[df_sg['NR_TURNO'] == turno]
        
        # Extrair partido do candidato
        # No TSE antigo, NR_VOTAVEL é o número do candidato
        # Precisamos encontrar o partido - vamos usar NM_VOTAVEL como chave
        # Agrupar votos por local + candidato
        grouped = df_turno.groupby(['NR_ZONA', local_col, 'NM_VOTAVEL'])['QT_VOTOS'].sum().reset_index()
        
        # Descobrir partidos dos candidatos
        # No dados antigos, não tem SG_PARTIDO diretamente, vamos usar NR_VOTAVEL
        # para mapear para partidos via os dados munzona
        # Alternativa: usar o formato candidato_munzona do TSE
        # Vamos tentar carregar os dados de candidato_munzona para obter partidos
        candidate_parties = get_candidate_parties(year, 'RJ')
        
        # Agrupar por local
        local_votes = {}
        for _, row in grouped.iterrows():
            zone = int(row['NR_ZONA'])
            local = int(row[local_col])
            candidato = row['NM_VOTAVEL']
            votos = int(row['QT_VOTOS'])
            
            key = (zone, local)
            if key not in local_votes:
                local_votes[key] = {}
            
            # Tentar encontrar partido
            partido = candidate_parties.get(candidato, 'OUTROS')
            partido = normalize_party(partido)
            
            col_name = f"{partido}_{year}_{turno_label}"
            if col_name not in local_votes[key]:
                local_votes[key][col_name] = 0
            local_votes[key][col_name] += votos
        
        # Criar GeoDataFrame dos pontos
        points_data = []
        for (zone, local), votes in local_votes.items():
            if (zone, local) not in loc_index:
                continue
            point_data = {'geometry': loc_index[(zone, local)]}
            point_data.update(votes)
            points_data.append(point_data)
        
        if not points_data:
            print(f"  Turno {turno}: nenhum ponto com geometria")
            continue
        
        points_gdf = gpd.GeoDataFrame(points_data, crs='EPSG:4326')
        
        # Spatial join
        joined = gpd.sjoin(points_gdf, geometrias, how='inner', predicate='within')
        
        # Agregar
        vote_cols = [c for c in joined.columns if re.match(r'^[A-Z_]+_\d{4}_(1T|2T)$', c)]
        if vote_cols:
            agg_dict = {c: 'sum' for c in vote_cols}
            aggregated = joined.groupby('index_right').agg(agg_dict)
            
            for col in vote_cols:
                for idx in geometrias.index:
                    if idx in aggregated.index:
                        results[(idx, col)] = aggregated.loc[idx, col]
                    else:
                        results[(idx, col)] = 0
        
        print(f"  Turno {turno}: {len(joined)} locais matched, {len(vote_cols)} colunas")
    
    return results

def get_candidate_parties(year, uf):
    """Obtém mapeamento candidato->partido dos dados do TSE."""
    parties = {}
    
    # Tentar votacao_candidato_munzona
    munzona_path = os.path.join(DADOS_DIR, f'votacao_candidato_munzona_{year}.zip')
    if os.path.exists(munzona_path):
        try:
            zf = zipfile.ZipFile(munzona_path)
            for name in zf.namelist():
                if not (name.endswith('.csv') or name.endswith('.txt')):
                    continue
                if uf and f'_{uf}.' not in name.upper() and not name.upper().startswith(uf):
                    if uf == 'RJ' and 'RJ' not in name.upper():
                        continue
                try:
                    df = pd.read_csv(zf.open(name), sep=';', encoding='latin-1', header=None, on_bad_lines='skip', dtype=str)
                    df_pref = df[df[15].str.upper().str.contains('PREFEITO', na=False)]
                    for _, row in df_pref.drop_duplicates([13]).iterrows():
                        full_name = str(row[13]).strip()
                        partido = str(row[23]).strip()
                        parties[full_name] = partido
                    print(f"    Partidos carregados de {name}: {len(parties)} candidatos")
                    return parties
                except Exception as e:
                    continue
        except Exception as e:
            print(f"    Erro lendo {munzona_path}: {e}")
    
    # Fallback: tentar extrair do próprio arquivo de seção
    zip_path = os.path.join(DADOS_DIR, f'votacao_secao_{year}_RJ.zip')
    if os.path.exists(zip_path):
        zf = zipfile.ZipFile(zip_path)
        csv_name = f'votacao_secao_{year}_RJ.csv'
        try:
            df = pd.read_csv(zf.open(csv_name), sep=';', encoding='latin-1',
                            usecols=['NM_VOTAVEL', 'NR_VOTAVEL', 'DS_CARGO'])
            df = df[df['DS_CARGO'] == 'Prefeito']
            # Sem coluna de partido direto, usar o número do candidato
            # e mapear via votacao_partido_munzona ou candidato_munzona
            # Como fallback final, derivar do número (primeiros 2 dígitos = partido)
            nr_to_party = get_party_from_number(year)
            for _, row in df.drop_duplicates('NM_VOTAVEL').iterrows():
                nr = int(row['NR_VOTAVEL'])
                partido = nr_to_party.get(nr, nr_to_party.get(nr // 100 * 100, nr_to_party.get(nr % 100, 'IND')))
                # Na verdade, os dois primeiros dígitos do número = número do partido
                nr_partido = nr
                while nr_partido >= 100:
                    nr_partido = nr_partido // 10
                if nr_partido < 10:
                    nr_partido = nr  # número de 2 dígitos já é o partido
                partido_from_nr = nr_to_party.get(nr_partido, None)
                if partido_from_nr:
                    parties[row['NM_VOTAVEL']] = partido_from_nr
                elif nr < 100:
                    # O próprio número é o número do partido
                    partido_from_nr = nr_to_party.get(nr, 'IND')
                    parties[row['NM_VOTAVEL']] = partido_from_nr
            if parties:
                print(f"    Partidos via número: {len(parties)} candidatos")
        except Exception as e:
            print(f"    Erro extraindo partidos: {e}")
    
    return parties

def get_party_from_number(year):
    """Mapeamento número de partido -> sigla do partido."""
    # Mapeamento padrão do TSE (números de legenda)
    return {
        10: 'PRB', 11: 'PP', 12: 'PDT', 13: 'PT', 14: 'PTB', 15: 'PMDB',
        16: 'PSTU', 17: 'PSL', 18: 'REDE', 19: 'PODE', 20: 'PSC', 21: 'PCB',
        22: 'PL', 23: 'PPS', 25: 'DEM', 27: 'PSDC', 28: 'PRTB', 29: 'PCO',
        30: 'NOVO', 31: 'PHS', 33: 'PMN', 35: 'PMB', 36: 'PTC', 40: 'PSB',
        43: 'PV', 44: 'PRP', 45: 'PSDB', 50: 'PSOL', 51: 'PEN', 54: 'PPL',
        55: 'PSD', 65: 'PCDOB', 70: 'AVANTE', 77: 'SOLIDARIEDADE', 90: 'PROS',
        # Aliases por período
    }

def compute_winner_and_margin(gdf, all_vote_cols):
    """Calcula VENCEDOR e MV para cada eleição/turno."""
    # Agrupar colunas por eleição (ano_turno)
    elections = {}
    for col in all_vote_cols:
        match = re.match(r'^(.+)_(\d{4})_(1T|2T)$', col)
        if match:
            partido, ano, turno = match.groups()
            key = f"{ano}_{turno}"
            if key not in elections:
                elections[key] = []
            elections[key].append((col, partido))
    
    for election_key, cols_info in sorted(elections.items()):
        winner_col = f"VENCEDOR_{election_key}"
        mv_col = f"MV_{election_key}"
        
        winners = []
        margins = []
        
        for idx in gdf.index:
            # Obter votos de cada partido nesta região
            party_votes = []
            for col, partido in cols_info:
                votos = gdf.loc[idx, col]
                if pd.notna(votos) and votos > 0:
                    party_votes.append((partido, float(votos)))
            
            if not party_votes:
                winners.append(None)
                margins.append(None)
                continue
            
            # Ordenar por votos
            party_votes.sort(key=lambda x: -x[1])
            total = sum(v for _, v in party_votes)
            
            winner = party_votes[0][0]
            winners.append(winner)
            
            if len(party_votes) >= 2 and total > 0:
                pct1 = (party_votes[0][1] / total) * 100
                pct2 = (party_votes[1][1] / total) * 100
                margin = pct1 - pct2
                margins.append(round(margin, 2))
            elif total > 0:
                margins.append(100.0)
            else:
                margins.append(None)
        
        gdf[winner_col] = winners
        gdf[mv_col] = margins
    
    return gdf

def main():
    print("=" * 60)
    print("GERAÇÃO DE RESULTADOS MUNICIPAIS - SÃO GONÇALO (RJ)")
    print("=" * 60)
    
    # 1. Carregar geometrias
    print("\n1. Carregando geometrias base...")
    geometrias = load_geometrias()
    print(f"   {len(geometrias)} regiões carregadas")
    
    # 2. Carregar locais 2006
    print("\n2. Carregando locais de votação 2006 RJ...")
    locations_2006 = load_2006_locations_rj()
    
    # 3. Construir mapeamento seção→local para 2000
    print("\n3. Construindo mapeamento secao->local...")
    section_to_local = load_section_to_local_map_2006()
    
    # 4. Processar todas as eleições
    all_results = {}
    
    # 4a. Anos especiais (2000, 2004)
    for year in SPECIAL_YEARS:
        results = process_special_year(year, geometrias, locations_2006, section_to_local)
        all_results.update(results)
    
    # 4b. Anos com GeoJSON (2008-2024)
    for year in GEOJSON_YEARS:
        results = process_geojson_year(year, geometrias)
        all_results.update(results)
    
    # 5. Montar DataFrame final
    print("\n\n=== Montando resultado final ===")
    
    # Descobrir todas as colunas de votos
    all_cols = set()
    for (idx, col) in all_results.keys():
        all_cols.add(col)
    
    # Ordenar colunas por ano e turno
    sorted_cols = sorted(all_cols, key=lambda c: (
        int(re.search(r'_(\d{4})_', c).group(1)),
        c.split('_')[-1],
        c
    ))
    
    # Adicionar colunas ao GeoDataFrame
    output_gdf = geometrias.copy()
    for col in sorted_cols:
        output_gdf[col] = 0
        for idx in output_gdf.index:
            if (idx, col) in all_results:
                output_gdf.loc[idx, col] = all_results[(idx, col)]
    
    # 6. Calcular VENCEDOR e MV
    print("Calculando vencedores e margens...")
    output_gdf = compute_winner_and_margin(output_gdf, sorted_cols)
    
    # 7. Reorganizar colunas: agrupar por eleição
    base_cols = [c for c in output_gdf.columns if not re.match(r'^[A-Z_]+_\d{4}_(1T|2T)$', c) 
                 and not c.startswith('VENCEDOR_') and not c.startswith('MV_')]
    vote_cols = [c for c in output_gdf.columns if re.match(r'^[A-Z_]+_\d{4}_(1T|2T)$', c)]
    winner_cols = sorted([c for c in output_gdf.columns if c.startswith('VENCEDOR_')])
    mv_cols = sorted([c for c in output_gdf.columns if c.startswith('MV_')])
    
    # Ordenar: base + votos por eleição + vencedores + margens
    final_order = base_cols + vote_cols + winner_cols + mv_cols
    output_gdf = output_gdf[[c for c in final_order if c in output_gdf.columns]]
    
    # 8. Remove any duplicate columns
    output_gdf = output_gdf.loc[:, ~output_gdf.columns.duplicated()]
    
    # 9. Salvar
    print(f"\nSalvando em: {OUTPUT_PATH}")
    output_gdf.to_file(OUTPUT_PATH, driver='GPKG')
    
    # Summary
    print(f"\n{'=' * 60}")
    print(f"RESUMO:")
    print(f"  Regiões: {len(output_gdf)}")
    print(f"  Colunas de votos: {len(vote_cols)}")
    print(f"  Eleições: {len(winner_cols)}")
    print(f"  Colunas totais: {len(output_gdf.columns)}")
    print(f"\nEleições processadas:")
    for wc in winner_cols:
        election = wc.replace('VENCEDOR_', '')
        print(f"  {election}: {output_gdf[wc].notna().sum()} regiões com dados")
    print(f"\nArquivo salvo: {OUTPUT_PATH}")

if __name__ == '__main__':
    main()
