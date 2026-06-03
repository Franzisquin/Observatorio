"""
Gera os arquivos ZIP de resultados legislativos das eleicoes gerais de 2002
(Deputado Federal e Estadual) no mesmo formato usado em 2006-2022.

Saida: resultados_geo/Legislativas 2002/
  - deputados_federal_2002_{UF}.zip
  - deputados_estadual_2002_{UF}.zip
  - detalhes_candidatos_2002.json
  - official_totals_2002.json
"""

import os
import json
import zipfile
import pandas as pd

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'Resultados 2002')
OUT_DIR  = os.path.join(BASE_DIR, 'resultados_geo', 'Legislativas 2002')

ALL_UFS = [
    'AC','AL','AM','AP','BA','CE','DF','ES','GO',
    'MA','MG','MS','MT','PA','PB','PE','PI','PR',
    'RJ','RN','RO','RR','RS','SC','SE','SP','TO',
]

# cd_cargo -> type_key (DF usa CD_CARGO=8 para Deputado Distrital, mapeado como estadual)
CARGO_DEF = {6: 'federal', 7: 'estadual', 8: 'estadual'}


def aggregate_votes_df(df_votes, cd_cargo):
    """Agrega votos por local (NR_TURNO=1 para deputados)."""
    mask = (df_votes['CD_CARGO'] == cd_cargo) & (df_votes['NR_TURNO'] == 1)
    sub = df_votes[mask].copy()
    if sub.empty:
        return {}

    sub['_key'] = (
        sub['NR_ZONA'].astype(int).astype(str) + '_' +
        sub['CD_MUNICIPIO'].astype(int).astype(str) + '_' +
        sub['NR_LOCAL_VOTACAO'].astype(int).astype(str)
    )
    sub['_votavel'] = sub['NR_VOTAVEL'].astype(int).astype(str)

    grouped = sub.groupby(['_key', '_votavel'])['QT_VOTOS'].sum().reset_index()

    results = {}
    for key, grp in grouped.groupby('_key'):
        results[key] = {row['_votavel']: int(row['QT_VOTOS']) for _, row in grp.iterrows()}
    return results


def build_cand_names_df(df_cand, cd_cargo, sg_uf):
    """
    Constroi cand_names para deputados incluindo:
    - candidatos nominais: NR_CANDIDATO (4-5 digitos)
    - votos de legenda: NR_PARTIDO (2 digitos)
    """
    mask = (df_cand['CD_CARGO'] == cd_cargo) & (df_cand['SG_UF'] == sg_uf) & (df_cand['NR_TURNO'] == 1)
    sub = df_cand[mask].copy()

    cand_names = {}

    if not sub.empty:
        sub['_nome'] = sub['NM_URNA_CANDIDATO'].fillna('').str.strip()
        empty_urna = sub['_nome'] == ''
        sub.loc[empty_urna, '_nome'] = sub.loc[empty_urna, 'NM_CANDIDATO'].fillna('').str.strip()

        sub['_status'] = sub['DS_SIT_TOT_TURNO'].fillna('').str.strip()
        sub.loc[sub['_status'].isin(['#NULO#', '']), '_status'] = 'N/D'

        # Candidatos nominais
        for _, row in sub.iterrows():
            nr = str(int(row['NR_CANDIDATO']))
            cand_names[nr] = [
                row['_nome'],
                str(row.get('SG_PARTIDO') or '').strip(),
                row['_status'],
                str(row.get('NM_COLIGACAO') or '').strip(),
                str(row.get('DS_COMPOSICAO_COLIGACAO') or '').strip(),
            ]

        # Votos de legenda: chave = str(NR_PARTIDO) de 2 digitos
        party_groups = sub.groupby('NR_PARTIDO').first().reset_index()
        for _, prow in party_groups.iterrows():
            nr_partido = str(int(prow['NR_PARTIDO']))
            if len(nr_partido) <= 2:
                sigla = str(prow.get('SG_PARTIDO') or nr_partido).strip()
                colig = str(prow.get('NM_COLIGACAO') or '').strip()
                comp  = str(prow.get('DS_COMPOSICAO_COLIGACAO') or '').strip()
                cand_names[nr_partido] = ['', sigla, 'LEGENDA', colig, comp]

    cand_names['95'] = ['VOTO BRANCO', '', 'BRANCO', '', '']
    cand_names['96'] = ['VOTO NULO', '', 'NULO', '', '']
    return cand_names


def write_zip(out_dir, zip_name, json_name, payload):
    os.makedirs(out_dir, exist_ok=True)
    zip_path = os.path.join(out_dir, zip_name)
    content = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(json_name, content)
    return zip_path


def build_detalhes_candidatos(df_cand):
    """Gera detalhes_candidatos_2002.json."""
    mask = df_cand['CD_CARGO'].isin([6, 7]) & (df_cand['NR_TURNO'] == 1)
    sub = df_cand[mask].copy()
    sub['_nome'] = sub['NM_URNA_CANDIDATO'].fillna('').str.strip()
    empty = sub['_nome'] == ''
    sub.loc[empty, '_nome'] = sub.loc[empty, 'NM_CANDIDATO'].fillna('').str.strip()
    sub['_status'] = sub['DS_SIT_TOT_TURNO'].fillna('').str.strip()
    sub.loc[sub['_status'].isin(['#NULO#', '']), '_status'] = 'N/D'

    details = {}
    for _, row in sub.iterrows():
        nr = str(int(row['NR_CANDIDATO']))
        details[nr] = {
            'nome': row['_nome'],
            'partido': str(row.get('SG_PARTIDO') or '').strip(),
            'numero': nr,
            'cargo': str(row.get('DS_CARGO') or '').upper().strip(),
            'situacao': row['_status'],
            'coligacao': str(row.get('NM_COLIGACAO') or '').strip(),
            'composicao': str(row.get('DS_COMPOSICAO_COLIGACAO') or '').strip(),
            'uf': str(row.get('SG_UF') or '').strip(),
        }
    return details


def build_official_totals(qe_csv_path):
    """
    Gera official_totals_2002.json a partir do CSV de quociente eleitoral.
    Formato: {UF: {type_key: {stats: {...}, coalitions: [...]}}}
    """
    df = pd.read_csv(qe_csv_path, sep=';', encoding='latin1', low_memory=False)
    # Normalizar nomes de colunas
    df.columns = [c.strip() for c in df.columns]

    # Mapear colunas do CSV
    col_votos_validos = 'qt_votos_validos_qe'
    col_vagas         = 'qt_vagas_qe'
    col_qe            = 'vr_quociente_eleitoral'
    col_comp          = 'ds_composicao_coligacao'
    col_votos_comp    = [c for c in df.columns if 'votos' in c.lower() and 'composi' in c.lower()][0]
    col_vagas_qp      = 'Vagas QP'
    col_eleitos_qp    = [c for c in df.columns if 'eleitas' in c.lower() and 'qp' in c.lower()][0]
    col_eleitos_avg   = [c for c in df.columns if 'eleitas' in c.lower() and 'm' in c.lower()]
    col_eleitos_avg   = col_eleitos_avg[0] if col_eleitos_avg else None

    totals = {}

    for uf, uf_df in df.groupby('UF'):
        if uf not in ALL_UFS:
            continue
        totals[uf] = {}

        for cd_cargo, type_key in CARGO_DEF.items():
            cargo_df = uf_df[uf_df['cd_cargo'] == cd_cargo]
            if cargo_df.empty:
                continue

            first_row = cargo_df.iloc[0]
            stats = {
                'qt_vagas': int(first_row[col_vagas]),
                'vr_qe': int(first_row[col_qe]),
                'qt_votos_validos': int(first_row[col_votos_validos]),
            }

            coalitions = []
            for _, row in cargo_df.iterrows():
                comp = str(row[col_comp] or '').strip()
                votos = int(row[col_votos_comp] or 0)
                vagas_qp = int(row[col_vagas_qp] or 0)
                eleitos_qp = int(row[col_eleitos_qp] or 0)
                eleitos_avg = int(row[col_eleitos_avg] or 0) if col_eleitos_avg else 0
                # ID normalized
                comp_id = '/'.join(sorted(p.strip() for p in comp.split('/')))
                coalitions.append({
                    'id': comp_id,
                    'raw_comp': comp,
                    'votes': votos,
                    'elected': eleitos_qp + eleitos_avg,
                    'elected_qp': eleitos_qp,
                    'elected_avg': eleitos_avg,
                    'vagas_qp': vagas_qp,
                })

            totals[uf][type_key[0]] = {  # 'f' for federal, 'e' for estadual
                'stats': stats,
                'coalitions': coalitions,
            }

    return totals


def main():
    print('Carregando metadados de candidatos...')
    df_cand = pd.read_parquet(os.path.join(DATA_DIR, 'consulta_cand_2002_BRASIL.parquet'))

    print('Gerando detalhes_candidatos_2002.json...')
    details = build_detalhes_candidatos(df_cand)
    details_path = os.path.join(OUT_DIR, 'detalhes_candidatos_2002.json')
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(details_path, 'w', encoding='utf-8') as f:
        json.dump(details, f, ensure_ascii=False, separators=(',', ':'))
    print(f'  {len(details)} candidatos -> {details_path}')

    print('Gerando official_totals_2002.json...')
    qe_path = os.path.join(DATA_DIR, 'quociente_eleitoral-brasil_2002.csv')
    totals = build_official_totals(qe_path)
    totals_path = os.path.join(OUT_DIR, 'official_totals_2002.json')
    with open(totals_path, 'w', encoding='utf-8') as f:
        json.dump(totals, f, ensure_ascii=False, separators=(',', ':'))
    print(f'  {len(totals)} UFs -> {totals_path}')

    print('\n=== DEPUTADOS ===')
    for uf in ALL_UFS:
        parquet_path = os.path.join(DATA_DIR, f'votacao_secao_2002_{uf}.parquet')
        if not os.path.exists(parquet_path):
            print(f'  {uf}: parquet nao encontrado, pulando.')
            continue
        df_uf = pd.read_parquet(parquet_path)

        for cd_cargo, type_label in CARGO_DEF.items():
            df_cargo = df_uf[df_uf['CD_CARGO'] == cd_cargo]
            if df_cargo.empty:
                continue

            cand_names = build_cand_names_df(df_cand, cd_cargo, uf)
            results = aggregate_votes_df(df_uf, cd_cargo)
            if not results:
                continue

            payload = {
                'METADATA': {'cand_names': cand_names, 'coalition_adjustments': {}},
                'RESULTS': results,
            }
            zip_name  = f'deputados_{type_label}_2002_{uf}.zip'
            json_name = f'deputados_{type_label}_2002_{uf}.json'
            path = write_zip(OUT_DIR, zip_name, json_name, payload)
            print(f'  {uf} {type_label}: {len(results)} locais -> {os.path.basename(path)}')

    print('\nConcluido! Arquivos em:', OUT_DIR)


if __name__ == '__main__':
    main()
