"""
Gera GeoPackage com resultados de eleições municipais (Prefeito)
de Uberlândia, Juiz de Fora, Contagem e Montes Claros (MG)
de 2000 a 2024, agregados por bairro/região nas geometrias do arquivo base.

Estratégia:
- 2008-2024: usa GeoJSONs do site (já geolocalizados por local de votação)
- 2000 e 2004: usa dados por seção do TSE + base de locais de 2006 do site
  - 2004: join direto por (zona + local de votação)
  - 2000: mapeamento (zona + seção) → local, via arquivo votacao_secao_2006_BR.csv
"""

import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import geopandas as gpd
import pandas as pd
import json
import zipfile
import os
import re
import warnings
import unicodedata
from shapely.geometry import Point
from collections import defaultdict

warnings.filterwarnings('ignore')

# ===== CONFIGURAÇÃO =====
GEOMETRIAS_PATH = r'E:\Mapas\Municipais por Bairro\Uberlandia, MC, Contagem e JF Base.gpkg'
OUTPUT_PATH      = r'E:\Mapas\Municipais por Bairro\Uberlandia, MC, Contagem e JF\Resultados Prefeito.gpkg'
SITE_DIR         = r'c:\Users\lixov\OneDrive\Documentos\Observatorio\resultados_geo'
DADOS_DIR        = r'E:\Mapas\Dados'

# Anos municipais com GeoJSON já no site
GEOJSON_YEARS = [2008, 2012, 2016, 2020, 2024]
# Anos que precisam de processamento especial via seção
SPECIAL_YEARS = [2000, 2004]

# Municípios-alvo e seus filtros (uppercase, sem acento, substring match)
MUNICIPIOS = {
    'UBERLÂNDIA': {'filter': 'UBERLANDIA', 'file_filter': ['UBERLÂNDIA', 'UBERLANDIA']},
    'JUIZ DE FORA': {'filter': 'JUIZ DE FORA', 'file_filter': ['JUIZ DE FORA']},
    'CONTAGEM': {'filter': 'CONTAGEM', 'file_filter': ['CONTAGEM']},
    'MONTES CLAROS': {'filter': 'MONTES CLAROS', 'file_filter': ['MONTES CLAROS']},
}

# Nomes internos no arquivo de seção (sem acento)
SECAO_MUN_FILTERS = ['UBERLANDIA', 'UBERLÂNDIA', 'JUIZ DE FORA', 'CONTAGEM', 'MONTES CLAROS']


# ===== UTILITÁRIOS =====

def normalize_str(s):
    """Remove acentos e converte para uppercase."""
    s = unicodedata.normalize('NFD', str(s))
    return ''.join(c for c in s if unicodedata.category(c) != 'Mn').upper()

def normalize_party(name):
    """Normaliza nome de partido para uso como coluna."""
    name = name.strip().upper()
    name = name.replace(' ', '_')
    name = unicodedata.normalize('NFD', name)
    name = ''.join(c for c in name if unicodedata.category(c) != 'Mn')
    return name

def is_target_mun(nm):
    """Verifica se um nome de município é um dos alvos."""
    nm_norm = normalize_str(nm)
    return any(normalize_str(k) in nm_norm or nm_norm in normalize_str(k)
               for k in MUNICIPIOS.keys())

def is_target_file(filename):
    """Verifica se um arquivo geojson é de uma cidade-alvo."""
    fn_norm = normalize_str(filename)
    for mun_info in MUNICIPIOS.values():
        for ff in mun_info['file_filter']:
            if normalize_str(ff) in fn_norm:
                return True
    return False


# ===== CARGA DE GEOMETRIAS =====

def load_geometrias():
    """Carrega as geometrias base do GeoPackage."""
    gdf = gpd.read_file(GEOMETRIAS_PATH)
    print(f"   Geometrias carregadas: {len(gdf)} regiões")
    print(f"   Colunas: {list(gdf.columns)}")
    print(f"   Municípios: {gdf['NM_MUN'].unique() if 'NM_MUN' in gdf.columns else 'n/a'}")
    
    # Garantir CRS EPSG:4326
    if gdf.crs is None:
        gdf = gdf.set_crs('EPSG:4326')
    elif gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs('EPSG:4326')
    
    return gdf


# ===== CARGA DOS LOCAIS DE 2006 =====

def load_2006_locations_mg():
    """Carrega locais de votação de 2006 do site para MG."""
    for i in range(1, 10):
        zf_path = os.path.join(SITE_DIR, f'locais_votacao_2006_{i}.zip')
        if not os.path.exists(zf_path):
            continue
        zf = zipfile.ZipFile(zf_path)
        for name in zf.namelist():
            if 'MG' in name.upper() and name.endswith('.geojson'):
                data = json.loads(zf.read(name))
                print(f"   Locais 2006 MG: {len(data['features'])} locais de {name}")
                return data
    raise FileNotFoundError("locais_votacao_2006_MG.geojson não encontrado nos zips do site")


def build_loc_index_2006(locations_2006):
    """Constrói índice (zona, local) → Point para locais das cidades-alvo."""
    loc_index = {}
    for feat in locations_2006['features']:
        props = feat['properties']
        nm = str(props.get('nm_localidade', '')).upper()
        if not is_target_mun(nm):
            continue
        try:
            zone = int(float(props['NR_ZONA']))
            local = int(float(props['nr_locvot']))
        except (ValueError, TypeError, KeyError):
            continue
        lon = props.get('long') or props.get('pred_long')
        lat = props.get('lat') or props.get('pred_lat')
        if lon and lat:
            try:
                lon, lat = float(lon), float(lat)
                if lon != 0 and lat != 0 and lon != -1 and lat != -1:
                    loc_index[(zone, local)] = Point(lon, lat)
            except (ValueError, TypeError):
                pass
    print(f"   Locais 2006 com geometria (cidades-alvo): {len(loc_index)}")
    return loc_index


# ===== MAPEAMENTO SEÇÃO → LOCAL PARA 2000 =====

def load_section_to_local_map_mg():
    """Constrói mapeamento (NR_ZONA, NR_SECAO) → NR_LOCAL_VOTACAO a partir do CSV de 2006 BR."""
    print("   Construindo mapeamento seção→local de 2006 para MG...")
    path = os.path.join(DADOS_DIR, 'votacao_secao_2006_BR.csv')
    if not os.path.exists(path):
        print("   AVISO: votacao_secao_2006_BR.csv não encontrado!")
        return {}
    
    section_to_local = {}
    chunks = pd.read_csv(path, sep=';', encoding='latin-1', chunksize=100000,
                         usecols=['SG_UF', 'NR_ZONA', 'NR_SECAO', 'NR_LOCAL_VOTACAO'])
    for chunk in chunks:
        mg = chunk[chunk['SG_UF'] == 'MG']
        for _, row in mg.iterrows():
            key = (int(row['NR_ZONA']), int(row['NR_SECAO']))
            section_to_local[key] = int(row['NR_LOCAL_VOTACAO'])
    
    print(f"   Mapeamento MG: {len(section_to_local)} seções")
    return section_to_local


# ===== PARTIDOS DOS CANDIDATOS =====

def get_party_from_number():
    """Mapeamento número de partido/candidato → sigla TSE."""
    return {
        10: 'PRB', 11: 'PP', 12: 'PDT', 13: 'PT', 14: 'PTB', 15: 'PMDB',
        16: 'PSTU', 17: 'PSL', 18: 'REDE', 19: 'PODE', 20: 'PSC', 21: 'PCB',
        22: 'PL', 23: 'PPS', 25: 'DEM', 27: 'PSDC', 28: 'PRTB', 29: 'PCO',
        30: 'NOVO', 31: 'PHS', 33: 'PMN', 35: 'PMB', 36: 'PTC', 40: 'PSB',
        43: 'PV', 44: 'PRP', 45: 'PSDB', 50: 'PSOL', 51: 'PEN', 54: 'PPL',
        55: 'PSD', 65: 'PCDOB', 70: 'AVANTE', 77: 'SOLIDARIEDADE', 90: 'PROS',
    }


def get_candidate_parties_munzona(year, uf='MG'):
    """Carrega mapeamento candidato→partido e nome de urna do arquivo munzona."""
    parties = {}
    munzona_path = os.path.join(DADOS_DIR, f'votacao_candidato_munzona_{year}.zip')
    if not os.path.exists(munzona_path):
        print(f"   AVISO: {munzona_path} não encontrado")
        return parties
    
    zf = zipfile.ZipFile(munzona_path)
    for name in zf.namelist():
        if not (name.endswith('.csv') or name.endswith('.txt')):
            continue
        if uf and uf not in name.upper():
            continue
        try:
            # Arquivos antigos: sem header
            # col 13=NomeCompleto, 14=NomeUrna, 15=Cargo, 23=SiglaPartido
            df = pd.read_csv(zf.open(name), sep=';', encoding='latin-1',
                             header=None, on_bad_lines='skip', dtype=str)
            df_pref = df[df[15].str.upper().str.contains('PREFEITO', na=False)]
            for _, row in df_pref.drop_duplicates([13]).iterrows():
                full_name = str(row[13]).strip()
                urn_name  = str(row[14]).strip() if pd.notna(row[14]) else full_name
                partido   = str(row[23]).strip()
                parties[full_name] = {'urna': urn_name, 'partido': partido}
            print(f"   Partidos/Urna de {name}: {len(parties)} candidatos Prefeito")
            return parties
        except Exception as e:
            print(f"   Erro lendo {name}: {e}")
            continue
    return parties


def get_partido_from_nr(nr_votavel):
    """Extrai número de partido dos primeiros dígitos do número do candidato."""
    nr_to_party = get_party_from_number()
    nr_p = int(nr_votavel)
    while nr_p >= 100:
        nr_p = nr_p // 10
    return nr_to_party.get(nr_p, f'P{nr_p}')


# ===== PROCESSAMENTO ANOS COM GEOJSON (2008-2024) =====

def process_geojson_year(year, geometrias):
    """Processa anos com GeoJSON já existente no site (2008-2024)."""
    print(f"\n=== Processando {year} (GeoJSON) ===")
    
    zf_path = os.path.join(SITE_DIR, f'{year} Municipais', 'MG.zip')
    if not os.path.exists(zf_path):
        print(f"   AVISO: {zf_path} não encontrado, pulando")
        return {}
    
    zf = zipfile.ZipFile(zf_path)
    results = {}
    
    for name in zf.namelist():
        if not is_target_file(name):
            continue
        if not (name.endswith('.geojson')):
            continue
        # Apenas Ordinaria e Suplementar (eleições municipais de prefeito)
        is_ordinaria   = 'Ordinaria' in name or 'Ordinária' in name
        is_suplementar = 'Suplementar' in name
        if not is_ordinaria and not is_suplementar:
            continue
        
        data = json.loads(zf.read(name))
        print(f"   Arquivo: {name} ({len(data['features'])} locais)")
        
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
                if any(core.upper().startswith(m) for m in [
                    'TOTAL_VOTOS', 'VOTOS_BRANCOS', 'VOTOS_NULOS', 'ELEITORES_APTOS',
                    'ABSTENÇÕES', 'ABSTENCOES', 'COMPARECIMENTO', 'VOTOS_LEGENDA', 'NR_TURNO',
                    'TOTAL VOTOS', 'VOTOS BRANCOS', 'VOTOS NULOS',
                ]):
                    continue
                
                # Extrair partido
                partido_match = re.search(r'\(([^)]+)\)', core)
                if not partido_match:
                    continue
                partido = normalize_party(partido_match.group(1))
                
                col_name = f"{partido}_{year}_{turno}"
                try:
                    val = float(value) if value is not None else 0
                except (ValueError, TypeError):
                    val = 0
                point_data[col_name] = point_data.get(col_name, 0) + val
            
            points_data.append(point_data)
        
        if not points_data:
            print(f"   AVISO: nenhum ponto com geometria em {name}")
            continue
        
        points_gdf = gpd.GeoDataFrame(points_data, crs='EPSG:4326')
        points_gdf = points_gdf.to_crs(geometrias.crs)
        
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
                    elif (idx, col) not in results:
                        results[(idx, col)] = 0
        
        print(f"   Locais matched: {len(joined)}, Colunas de votos: {len(vote_cols)}")
    
    return results


# ===== PROCESSAMENTO ANOS ESPECIAIS (2000 E 2004) =====

def process_special_year(year, geometrias, loc_index_2006, section_to_local=None):
    """Processa 2000 e 2004 usando dados de seção + base de locais 2006."""
    print(f"\n=== Processando {year} (Seção + Locais 2006) ===")
    
    zip_path = os.path.join(DADOS_DIR, f'votacao_secao_{year}_MG.zip')
    if not os.path.exists(zip_path):
        print(f"   AVISO: {zip_path} não encontrado, pulando")
        return {}
    
    zf = zipfile.ZipFile(zip_path)
    csv_name = f'votacao_secao_{year}_MG.csv'
    df = pd.read_csv(zf.open(csv_name), sep=';', encoding='latin-1')
    
    # Filtrar apenas Prefeito nas cidades-alvo
    df_target = df[
        (df['DS_CARGO'] == 'Prefeito') &
        (df['NM_MUNICIPIO'].apply(lambda x: is_target_mun(str(x))))
    ].copy()
    
    print(f"   Registros Prefeito (cidades-alvo): {len(df_target)}")
    
    # Remover votos em branco/nulos
    df_target = df_target[~df_target['NM_VOTAVEL'].isin([
        'VOTO BRANCO', 'VOTO NULO', 'VOTO ANULADO'
    ])].copy()
    
    # Para 2000: mapear seção → local via 2006
    if year == 2000 and section_to_local:
        df_target['NR_LOCAL_MAPPED'] = df_target.apply(
            lambda row: section_to_local.get((int(row['NR_ZONA']), int(row['NR_SECAO'])), -1), axis=1
        )
        total = len(df_target)
        mapped = (df_target['NR_LOCAL_MAPPED'] != -1).sum()
        print(f"   Seções mapeadas para local: {mapped}/{total} ({mapped/total*100:.1f}%)")
        df_target = df_target[df_target['NR_LOCAL_MAPPED'] != -1]
        local_col = 'NR_LOCAL_MAPPED'
    else:
        local_col = 'NR_LOCAL_VOTACAO'
    
    # Carregar partidos
    candidate_parties = get_candidate_parties_munzona(year, 'MG')
    
    results = {}
    
    for turno in sorted(df_target['NR_TURNO'].unique()):
        turno_label = f"{turno}T"
        df_turno = df_target[df_target['NR_TURNO'] == turno]
        
        # Agrupar votos por (zona, local, candidato)
        grouped = df_turno.groupby(
            ['NR_ZONA', local_col, 'NM_VOTAVEL', 'NR_VOTAVEL']
        )['QT_VOTOS'].sum().reset_index()
        
        # Construir dict (zona, local) → {col_name: votos}
        local_votes = defaultdict(dict)
        
        for _, row in grouped.iterrows():
            zone  = int(row['NR_ZONA'])
            local = int(row[local_col])
            nm_votavel  = row['NM_VOTAVEL']
            nr_votavel  = int(row['NR_VOTAVEL'])
            votos = int(row['QT_VOTOS'])
            
            key = (zone, local)
            
            # Determinar partido
            partido_info = candidate_parties.get(nm_votavel)
            if partido_info:
                partido = normalize_party(partido_info['partido'])
            else:
                partido = normalize_party(get_partido_from_nr(nr_votavel))
            
            col_name = f"{partido}_{year}_{turno_label}"
            local_votes[key][col_name] = local_votes[key].get(col_name, 0) + votos
        
        # Criar GeoDataFrame com pontos dos locais
        points_data = []
        for (zone, local), votes in local_votes.items():
            if (zone, local) not in loc_index_2006:
                continue
            point_data = {'geometry': loc_index_2006[(zone, local)]}
            point_data.update(votes)
            points_data.append(point_data)
        
        if not points_data:
            print(f"   Turno {turno}: nenhum ponto com geometria na base 2006")
            continue
        
        points_gdf = gpd.GeoDataFrame(points_data, crs='EPSG:4326')
        points_gdf = points_gdf.to_crs(geometrias.crs)
        
        # Spatial join
        joined = gpd.sjoin(points_gdf, geometrias, how='inner', predicate='within')
        
        vote_cols = [c for c in joined.columns if re.match(r'^[A-Z_]+_\d{4}_(1T|2T)$', c)]
        if vote_cols:
            agg_dict = {c: 'sum' for c in vote_cols}
            aggregated = joined.groupby('index_right').agg(agg_dict)
            
            for col in vote_cols:
                for idx in geometrias.index:
                    if idx in aggregated.index:
                        results[(idx, col)] = aggregated.loc[idx, col]
                    elif (idx, col) not in results:
                        results[(idx, col)] = 0
        
        print(f"   Turno {turno}: {len(joined)} locais matched, {len(vote_cols)} colunas de votos")
    
    return results


# ===== CÁLCULO DE VENCEDOR E MARGEM =====

def compute_winner_and_margin(gdf, all_vote_cols):
    """Calcula colunas VENCEDOR_AAAA_TT e MV_AAAA_TT para cada eleição."""
    elections = defaultdict(list)
    for col in all_vote_cols:
        match = re.match(r'^(.+?)_(\d{4})_(1T|2T)$', col)
        if match:
            partido, ano, turno = match.groups()
            elections[f"{ano}_{turno}"].append((col, partido))
    
    for election_key, cols_info in sorted(elections.items()):
        winner_col = f"VENCEDOR_{election_key}"
        mv_col     = f"MV_{election_key}"
        
        winners = []
        margins  = []
        
        for idx in gdf.index:
            party_votes = []
            for col, partido in cols_info:
                v = gdf.loc[idx, col]
                if pd.notna(v) and v > 0:
                    party_votes.append((partido, float(v)))
            
            if not party_votes:
                winners.append(None)
                margins.append(None)
                continue
            
            party_votes.sort(key=lambda x: -x[1])
            total = sum(v for _, v in party_votes)
            
            winners.append(party_votes[0][0])
            
            if len(party_votes) >= 2 and total > 0:
                pct1 = (party_votes[0][1] / total) * 100
                pct2 = (party_votes[1][1] / total) * 100
                margins.append(round(pct1 - pct2, 2))
            elif total > 0:
                margins.append(100.0)
            else:
                margins.append(None)
        
        gdf[winner_col] = winners
        gdf[mv_col]     = margins
        print(f"   {election_key}: vencedor calculado para {sum(w is not None for w in winners)} regiões")
    
    return gdf


# ===== MAIN =====

def main():
    print("=" * 60)
    print("GERAÇÃO DE RESULTADOS MUNICIPAIS - MG")
    print("Uberlândia | Juiz de Fora | Contagem | Montes Claros")
    print("=" * 60)
    
    # Criar diretório de saída se não existir
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    
    # 1. Carregar geometrias
    print("\n1. Carregando geometrias base...")
    geometrias = load_geometrias()
    
    # 2. Carregar locais 2006 MG
    print("\n2. Carregando locais de votação 2006 MG...")
    locations_2006 = load_2006_locations_mg()
    loc_index_2006 = build_loc_index_2006(locations_2006)
    
    # 3. Mapeamento seção→local para 2000
    print("\n3. Construindo mapeamento seção→local (para 2000)...")
    section_to_local = load_section_to_local_map_mg()
    
    # 4. Processar todas as eleições
    all_results = {}
    
    # 4a. Anos especiais (2000, 2004)
    for year in SPECIAL_YEARS:
        stl = section_to_local if year == 2000 else None
        results = process_special_year(year, geometrias, loc_index_2006, stl)
        all_results.update(results)
    
    # 4b. Anos com GeoJSON (2008-2024)
    for year in GEOJSON_YEARS:
        results = process_geojson_year(year, geometrias)
        all_results.update(results)
    
    # 5. Montar DataFrame final
    print("\n\n=== Montando resultado final ===")
    
    all_cols = set(col for (_, col) in all_results.keys())
    
    # Ordenar colunas por ano e turno
    sorted_cols = sorted(all_cols, key=lambda c: (
        int(re.search(r'_(\d{4})_', c).group(1)),
        c.split('_')[-1],  # 1T antes de 2T
        c
    ))
    
    # Adicionar colunas ao GeoDataFrame
    output_gdf = geometrias.copy()
    for col in sorted_cols:
        output_gdf[col] = 0.0
        for idx in output_gdf.index:
            if (idx, col) in all_results:
                output_gdf.loc[idx, col] = all_results[(idx, col)]
    
    # 6. Calcular VENCEDOR e MV
    print("\nCalculando vencedores e margens percentuais...")
    output_gdf = compute_winner_and_margin(output_gdf, sorted_cols)
    
    # 7. Reorganizar colunas: base + votos por eleição + vencedores + margens
    base_cols   = [c for c in output_gdf.columns
                   if not re.match(r'^[A-Z_]+_\d{4}_(1T|2T)$', c)
                   and not c.startswith('VENCEDOR_')
                   and not c.startswith('MV_')]
    vote_cols   = [c for c in output_gdf.columns if re.match(r'^[A-Z_]+_\d{4}_(1T|2T)$', c)]
    winner_cols = sorted([c for c in output_gdf.columns if c.startswith('VENCEDOR_')])
    mv_cols     = sorted([c for c in output_gdf.columns if c.startswith('MV_')])
    
    final_order = base_cols + vote_cols + winner_cols + mv_cols
    output_gdf  = output_gdf[[c for c in final_order if c in output_gdf.columns]]
    
    # 8. Remover colunas duplicadas
    output_gdf = output_gdf.loc[:, ~output_gdf.columns.duplicated()]
    
    # 9. Salvar
    print(f"\nSalvando em: {OUTPUT_PATH}")
    output_gdf.to_file(OUTPUT_PATH, driver='GPKG')
    
    # Resumo
    print(f"\n{'=' * 60}")
    print("RESUMO FINAL:")
    print(f"  Regiões: {len(output_gdf)}")
    print(f"  Colunas de votos: {len(vote_cols)}")
    print(f"  Eleições processadas: {len(winner_cols)}")
    print(f"  Colunas totais: {len(output_gdf.columns)}")
    print("\nEleições:")
    for wc in winner_cols:
        election = wc.replace('VENCEDOR_', '')
        n = output_gdf[wc].notna().sum()
        print(f"  {election}: {n} regiões com dados")
    print(f"\nArquivo salvo: {OUTPUT_PATH}")


if __name__ == '__main__':
    main()
