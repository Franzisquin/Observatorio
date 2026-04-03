"""
Gera GeoJSONs das eleicoes municipais de 2000 e 2004 para todo o RJ,
no formato identico aos GeoJSONs municipais existentes (2008-2024),
para uso no visualizador do site.

Usa a base de locais de votacao geolocalizada de 2006 do site.
- 2004: join por NR_ZONA + NR_LOCAL_VOTACAO
- 2000: join por NR_ZONA + NR_SECAO -> NR_LOCAL_VOTACAO (via mapeamento 2006)
"""

import pandas as pd
import json
import zipfile
import os
import re
import sys
import warnings

warnings.filterwarnings('ignore')

SITE_DIR = r'c:\Users\lixov\OneDrive\Documentos\Observatorio\resultados_geo'
DADOS_DIR = r'E:\Mapas\Dados'


def load_2006_locations_rj():
    """Carrega locais de votacao 2006 RJ do site."""
    for i in range(1, 7):
        zf_path = os.path.join(SITE_DIR, f'locais_votacao_2006_{i}.zip')
        if not os.path.exists(zf_path):
            continue
        zf = zipfile.ZipFile(zf_path)
        for name in zf.namelist():
            if 'RJ' in name.upper() and name.endswith('.geojson'):
                data = json.loads(zf.read(name))
                print(f"  Locais 2006 RJ: {len(data['features'])} locais de {name}")
                return data
    raise FileNotFoundError("locais_votacao_2006_RJ.geojson nao encontrado")


def load_section_to_local_map():
    """Mapeamento NR_ZONA+NR_SECAO -> NR_LOCAL_VOTACAO via dados de 2006."""
    print("  Construindo mapeamento secao->local de 2006 BR...")
    path = os.path.join(DADOS_DIR, 'votacao_secao_2006_BR.csv')
    section_to_local = {}
    chunks = pd.read_csv(path, sep=';', encoding='latin-1', chunksize=100000,
                         usecols=['SG_UF', 'NR_ZONA', 'NR_SECAO', 'NR_LOCAL_VOTACAO'])
    for chunk in chunks:
        rj = chunk[chunk['SG_UF'] == 'RJ']
        for _, row in rj.iterrows():
            key = (int(row['NR_ZONA']), int(row['NR_SECAO']))
            section_to_local[key] = int(row['NR_LOCAL_VOTACAO'])
    print(f"  Mapeamento: {len(section_to_local)} secoes RJ")
    return section_to_local


def get_party_from_number():
    """Mapeamento numero -> sigla do partido TSE."""
    return {
        10: 'PRB', 11: 'PP', 12: 'PDT', 13: 'PT', 14: 'PTB', 15: 'PMDB',
        16: 'PSTU', 17: 'PSL', 18: 'REDE', 19: 'PODE', 20: 'PSC', 21: 'PCB',
        22: 'PL', 23: 'PPS', 25: 'DEM', 27: 'PSDC', 28: 'PRTB', 29: 'PCO',
        30: 'NOVO', 31: 'PHS', 33: 'PMN', 35: 'PMB', 36: 'PTC', 40: 'PSB',
        43: 'PV', 44: 'PRP', 45: 'PSDB', 50: 'PSOL', 51: 'PEN', 54: 'PPL',
        55: 'PSD', 65: 'PC do B', 70: 'AVANTE', 77: 'SOLIDARIEDADE', 90: 'PROS',
    }


def get_candidate_parties_munzona(year):
    """Carrega mapeamento candidato->partido do votacao_candidato_munzona."""
    parties = {}
    munzona_path = os.path.join(DADOS_DIR, f'votacao_candidato_munzona_{year}.zip')
    if not os.path.exists(munzona_path):
        return parties
    
    zf = zipfile.ZipFile(munzona_path)
    for name in zf.namelist():
        if not (name.endswith('.csv') or name.endswith('.txt')):
            continue
        try:
            df = pd.read_csv(zf.open(name), sep=';', encoding='latin-1', on_bad_lines='skip')
            candidato_col = partido_col = uf_col = cargo_col = None
            for c in df.columns:
                cu = c.upper()
                if 'NM_VOTAVEL' in cu or 'NM_CANDIDATO' in cu:
                    candidato_col = c
                if 'SG_PARTIDO' in cu:
                    partido_col = c
                if 'SG_UF' in cu:
                    uf_col = c
                if 'DS_CARGO' in cu:
                    cargo_col = c
            
            if candidato_col and partido_col:
                if uf_col:
                    df = df[df[uf_col] == 'RJ']
                if cargo_col:
                    df = df[df[cargo_col].str.upper().str.contains('PREFEITO', na=False)]
                for _, row in df.drop_duplicates([candidato_col]).iterrows():
                    parties[row[candidato_col]] = row[partido_col]
                print(f"    Partidos de {name}: {len(parties)} candidatos")
                return parties
        except Exception:
            continue
    return parties


def get_candidate_parties_from_nr(year):
    """Mapeia candidato->partido usando numero do candidato."""
    parties = {}
    zip_path = os.path.join(DADOS_DIR, f'votacao_secao_{year}_RJ.zip')
    if not os.path.exists(zip_path):
        return parties
    
    zf = zipfile.ZipFile(zip_path)
    csv_name = f'votacao_secao_{year}_RJ.csv'
    try:
        df = pd.read_csv(zf.open(csv_name), sep=';', encoding='latin-1',
                        usecols=['NM_VOTAVEL', 'NR_VOTAVEL', 'DS_CARGO'])
        df = df[df['DS_CARGO'] == 'Prefeito']
        nr_to_party = get_party_from_number()
        
        for _, row in df.drop_duplicates('NM_VOTAVEL').iterrows():
            nr = int(row['NR_VOTAVEL'])
            # Primeiros 2 digitos do numero = numero do partido
            nr_partido = nr
            while nr_partido >= 100:
                nr_partido = nr_partido // 10
            if nr_partido < 10:
                nr_partido = nr
            partido = nr_to_party.get(nr_partido, f'P{nr_partido}')
            parties[row['NM_VOTAVEL']] = partido
        
        print(f"    Partidos via numero: {len(parties)} candidatos")
    except Exception as e:
        print(f"    Erro: {e}")
    return parties


def build_geojson_for_year(year, locations_2006, section_to_local=None):
    """Gera GeoJSONs municipais para um ano."""
    print(f"\n{'='*60}")
    print(f"PROCESSANDO {year}")
    print(f"{'='*60}")
    
    zip_path = os.path.join(DADOS_DIR, f'votacao_secao_{year}_RJ.zip')
    csv_name = f'votacao_secao_{year}_RJ.csv'
    
    print(f"  Lendo {csv_name}...")
    zf = zipfile.ZipFile(zip_path)
    df = pd.read_csv(zf.open(csv_name), sep=';', encoding='latin-1')
    
    # Apenas Prefeito
    df = df[df['DS_CARGO'] == 'Prefeito'].copy()
    print(f"  Registros Prefeito: {len(df)}")
    
    # Obter mapeamento candidato->partido
    candidate_parties = get_candidate_parties_munzona(year)
    if not candidate_parties:
        candidate_parties = get_candidate_parties_from_nr(year)
    
    # Para 2000, mapear secao->local
    if year == 2000 and section_to_local:
        df['NR_LOCAL_MAPPED'] = df.apply(
            lambda row: section_to_local.get((int(row['NR_ZONA']), int(row['NR_SECAO'])), -1), axis=1
        )
        unmapped_rows = (df['NR_LOCAL_MAPPED'] == -1).sum()
        print(f"  Secoes mapeadas: {len(df) - unmapped_rows}/{len(df)} ({(len(df)-unmapped_rows)/len(df)*100:.1f}%)")
        df = df[df['NR_LOCAL_MAPPED'] != -1]
        local_col = 'NR_LOCAL_MAPPED'
    else:
        local_col = 'NR_LOCAL_VOTACAO'
    
    # Index locations by zone+local
    loc_by_key = {}
    for feat in locations_2006['features']:
        p = feat['properties']
        z = int(p['NR_ZONA'])
        lv = int(p['nr_locvot'])
        loc_by_key[(z, lv)] = feat
    
    # Agrupar por municipio
    municipios = df['NM_MUNICIPIO'].unique()
    print(f"  Municipios com dados: {len(municipios)}")
    
    output_dir = os.path.join(SITE_DIR, f'{year} Municipais', 'RJ')
    os.makedirs(output_dir, exist_ok=True)
    
    saved = 0
    for municipio in sorted(municipios):
        df_mun = df[df['NM_MUNICIPIO'] == municipio]
        
        # Processar por turno
        turnos_data = {}  # turno -> {(zone,local): {candidate_key: votes, ...}}
        
        for turno in sorted(df_mun['NR_TURNO'].unique()):
            turno_label = f"{turno}T"
            df_t = df_mun[df_mun['NR_TURNO'] == turno]
            
            # Group by local + candidato
            grouped = df_t.groupby(['NR_ZONA', local_col, 'NM_VOTAVEL', 'NR_VOTAVEL'])['QT_VOTOS'].sum().reset_index()
            
            local_data = {}
            for _, row in grouped.iterrows():
                zone = int(row['NR_ZONA'])
                local = int(row[local_col])
                nm_votavel = row['NM_VOTAVEL']
                nr_votavel = int(row['NR_VOTAVEL'])
                votos = int(row['QT_VOTOS'])
                
                key = (zone, local)
                if key not in local_data:
                    local_data[key] = {'candidates': {}, 'brancos': 0, 'nulos': 0, 'total_validos': 0}
                
                if nm_votavel in ('VOTO BRANCO',):
                    local_data[key]['brancos'] += votos
                elif nm_votavel in ('VOTO NULO', 'VOTO ANULADO'):
                    local_data[key]['nulos'] += votos
                else:
                    # Get partido
                    partido = candidate_parties.get(nm_votavel, None)
                    if not partido:
                        # Derive from number
                        nr_p = nr_votavel
                        while nr_p >= 100:
                            nr_p = nr_p // 10
                        partido = get_party_from_number().get(nr_p, f'P{nr_p}')
                    
                    # Build candidate display key: "NOME (PARTIDO) (STATUS) {turno_label}"
                    # Status = ELEITO, NAO ELEITO, 2 TURNO - we don't know from section data
                    # So we'll use a simpler format
                    cand_key = f"{nm_votavel} ({partido})"
                    
                    if cand_key not in local_data[key]['candidates']:
                        local_data[key]['candidates'][cand_key] = 0
                    local_data[key]['candidates'][cand_key] += votos
                    local_data[key]['total_validos'] += votos
            
            turnos_data[turno] = local_data
        
        # Build GeoJSON features
        # We need to determine election status (ELEITO, NAO ELEITO, 2 TURNO)
        # For this, we aggregate all votes across the municipality
        has_2t = 2 in turnos_data
        
        for turno_nr, local_data in turnos_data.items():
            turno_label = f"{turno_nr}T"
            
            # Calculate municipality-wide totals to determine winner
            mun_totals = {}
            for key, ld in local_data.items():
                for cand, votos in ld['candidates'].items():
                    mun_totals[cand] = mun_totals.get(cand, 0) + votos
            
            # Determine status
            sorted_cands = sorted(mun_totals.items(), key=lambda x: -x[1])
            cand_status = {}
            if turno_nr == 1:
                if has_2t:
                    # Top 2 go to 2nd round
                    for i, (cand, _) in enumerate(sorted_cands):
                        if i < 2:
                            cand_status[cand] = '2\u00b0 TURNO'
                        else:
                            cand_status[cand] = 'N\u00c3O ELEITO'
                else:
                    # Winner elected in 1st round
                    for i, (cand, _) in enumerate(sorted_cands):
                        if i == 0:
                            cand_status[cand] = 'ELEITO'
                        else:
                            cand_status[cand] = 'N\u00c3O ELEITO'
            else:
                # 2nd round
                for i, (cand, _) in enumerate(sorted_cands):
                    if i == 0:
                        cand_status[cand] = 'ELEITO'
                    else:
                        cand_status[cand] = 'N\u00c3O ELEITO'
        
        # Now build the features
        features = []
        
        # Merge all turnos into one feature per location
        all_local_keys = set()
        for turno_nr, local_data in turnos_data.items():
            all_local_keys.update(local_data.keys())
        
        for loc_key in all_local_keys:
            if loc_key not in loc_by_key:
                continue
            
            loc_feat = loc_by_key[loc_key]
            loc_props = loc_feat['properties']
            
            # Check if this local has any votes
            has_votes = False
            for turno_nr, local_data in turnos_data.items():
                if loc_key in local_data and local_data[loc_key]['total_validos'] > 0:
                    has_votes = True
                    break
            
            if not has_votes:
                continue
            
            # Build properties
            props = {
                'local_id': loc_props.get('local_id'),
                'ano': year,
                'sg_uf': 'RJ',
                'cd_localidade_tse': loc_props.get('cd_localidade_tse'),
                'cod_localidade_ibge': loc_props.get('cod_localidade_ibge'),
                'nr_zona': int(float(loc_props.get('NR_ZONA', 0))),
                'nr_locvot': int(float(loc_props.get('nr_locvot', 0))),
                'nr_cep': loc_props.get('nr_cep'),
                'nm_localidade': loc_props.get('nm_localidade'),
                'nm_locvot': loc_props.get('nm_locvot'),
                'ds_endereco': loc_props.get('ds_endereco'),
                'ds_bairro': loc_props.get('ds_bairro'),
                'pred_long': loc_props.get('pred_long'),
                'pred_lat': loc_props.get('pred_lat'),
                'pred_dist': loc_props.get('pred_dist'),
                'tse_long': loc_props.get('tse_long'),
                'tse_lat': loc_props.get('tse_lat'),
                'long': loc_props.get('long'),
                'lat': loc_props.get('lat'),
                'ID_UNICO': loc_props.get('ID_UNICO'),
            }
            
            for turno_nr, local_data in sorted(turnos_data.items()):
                turno_label = f"{turno_nr}T"
                if loc_key not in local_data:
                    continue
                
                ld = local_data[loc_key]
                
                # Recalculate status for this turno
                mun_totals_t = {}
                for k2, ld2 in turnos_data[turno_nr].items():
                    for c, v in ld2['candidates'].items():
                        mun_totals_t[c] = mun_totals_t.get(c, 0) + v
                sorted_c = sorted(mun_totals_t.items(), key=lambda x: -x[1])
                
                cand_status_t = {}
                if turno_nr == 1 and has_2t:
                    for i, (c, _) in enumerate(sorted_c):
                        cand_status_t[c] = '2\u00b0 TURNO' if i < 2 else 'N\u00c3O ELEITO'
                elif turno_nr == 2:
                    for i, (c, _) in enumerate(sorted_c):
                        cand_status_t[c] = 'ELEITO' if i == 0 else 'N\u00c3O ELEITO'
                else:
                    for i, (c, _) in enumerate(sorted_c):
                        cand_status_t[c] = 'ELEITO' if i == 0 else 'N\u00c3O ELEITO'
                
                # Add candidate votes
                for cand, votos in ld['candidates'].items():
                    status = cand_status_t.get(cand, 'N\u00c3O ELEITO')
                    full_key = f"{cand} ({status}) {turno_label}"
                    props[full_key] = int(votos)
                
                props[f'NR_TURNO {turno_label}'] = int(turno_nr)
                props[f'Total_Votos_Validos {turno_label}'] = int(ld['total_validos'])
                props[f'Votos_Brancos {turno_label}'] = int(ld['brancos'])
                props[f'Votos_Nulos {turno_label}'] = int(ld['nulos'])
            
            feature = {
                'type': 'Feature',
                'geometry': loc_feat['geometry'],
                'properties': props
            }
            features.append(feature)
        
        if not features:
            continue
        
        geojson = {
            'type': 'FeatureCollection',
            'features': features
        }
        
        # Save
        mun_name = municipio.replace('/', '-').replace('\\', '-')
        
        # Determine if we need 2T suffix or just Ordinaria
        filename = f"{mun_name}_Ordinaria_{year}.geojson"
        filepath = os.path.join(output_dir, filename)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(geojson, f, ensure_ascii=False)
        
        saved += 1
    
    print(f"\n  Salvos: {saved} municipios em {output_dir}")
    return saved


def update_lista_municipios(years):
    """Atualiza lista_municipios.json com os novos anos."""
    lista_path = os.path.join(os.path.dirname(SITE_DIR), 'lista_municipios.json')
    if not os.path.exists(lista_path):
        lista_path = os.path.join(SITE_DIR, 'lista_municipios.json')
    
    if os.path.exists(lista_path):
        with open(lista_path, 'r', encoding='utf-8') as f:
            lista = json.load(f)
    else:
        lista = {}
    
    # Check if RJ already has municipalities listed
    # The format is {UF: [municipio1, municipio2, ...]}
    # We need to ensure all municipalities from the new GeoJSONs are listed
    for year in years:
        geojson_dir = os.path.join(SITE_DIR, f'{year} Municipais', 'RJ')
        if not os.path.exists(geojson_dir):
            continue
        for filename in os.listdir(geojson_dir):
            if not filename.endswith('.geojson'):
                continue
            mun_name = filename.replace(f'_Ordinaria_{year}.geojson', '').replace(f'_Suplementar_{year}.geojson', '')
            if 'RJ' not in lista:
                lista['RJ'] = []
            if mun_name not in lista['RJ']:
                lista['RJ'].append(mun_name)
    
    if 'RJ' in lista:
        lista['RJ'] = sorted(set(lista['RJ']))
    
    with open(lista_path, 'w', encoding='utf-8') as f:
        json.dump(lista, f, ensure_ascii=False, indent=2)
    print(f"\n  lista_municipios.json atualizado ({len(lista.get('RJ', []))} municipios RJ)")


def create_zip_files(years):
    """Cria arquivos ZIP para os GeoJSONs gerados."""
    for year in years:
        geojson_dir = os.path.join(SITE_DIR, f'{year} Municipais', 'RJ')
        if not os.path.exists(geojson_dir):
            continue
        
        zip_path = os.path.join(SITE_DIR, f'{year} Municipais', 'RJ.zip')
        print(f"  Criando {zip_path}...")
        
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for filename in sorted(os.listdir(geojson_dir)):
                if filename.endswith('.geojson'):
                    filepath = os.path.join(geojson_dir, filename)
                    zf.write(filepath, filename)
        
        size_mb = os.path.getsize(zip_path) / 1024 / 1024
        print(f"    Criado: {zip_path} ({size_mb:.1f} MB)")


def update_zip_index(years):
    """Atualiza zip_index.json com os novos arquivos."""
    index_path = os.path.join(SITE_DIR, 'zip_index.json')
    
    if os.path.exists(index_path):
        with open(index_path, 'r', encoding='utf-8') as f:
            index = json.load(f)
    else:
        index = {}
    
    for year in years:
        zip_rel = f'{year} Municipais/RJ.zip'
        zip_path = os.path.join(SITE_DIR, f'{year} Municipais', 'RJ.zip')
        
        if not os.path.exists(zip_path):
            continue
        
        zf = zipfile.ZipFile(zip_path)
        for name in zf.namelist():
            if name.endswith('.geojson'):
                key = f'{year} Municipais/RJ/{name}'
                index[key] = {
                    'zip': zip_rel,
                    'file': name
                }
    
    with open(index_path, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False)
    print(f"  zip_index.json atualizado ({len(index)} entradas totais)")


def main():
    print("="*60)
    print("GERACAO DE GEOJSONS MUNICIPAIS 2000/2004 - RJ")
    print("="*60)
    
    # 1. Load locations
    print("\n1. Carregando base de locais 2006...")
    locations_2006 = load_2006_locations_rj()
    
    # 2. Load section-to-local mapping for 2000
    print("\n2. Carregando mapeamento secao->local...")
    section_to_local = load_section_to_local_map()
    
    # 3. Process years
    years = [2000, 2004]
    for year in years:
        if year == 2000:
            build_geojson_for_year(year, locations_2006, section_to_local)
        else:
            build_geojson_for_year(year, locations_2006)
    
    # 4. Create ZIP files
    print("\n\n4. Criando ZIPs...")
    create_zip_files(years)
    
    # 5. Update index
    print("\n5. Atualizando indices...")
    update_zip_index(years)
    
    print("\n" + "="*60)
    print("CONCLUIDO!")
    print("="*60)


if __name__ == '__main__':
    main()
