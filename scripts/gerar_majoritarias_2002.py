"""
Gera os arquivos ZIP de resultados majoritarios das eleicoes gerais de 2002
(Presidente, Governador, Senador) no mesmo formato usado em 2006-2022.

Saida: resultados_geo/Majoritarias 2002/
  - presidente_2002_t{1,2}_{UF}.zip      (contem .json)
  - governador_2002_ord_t{1,2}_{UF}.zip  (contem .json)
  - senador_2002_ord_t1_{UF}.zip          (contem .json)
"""

import os
import json
import zipfile

import pandas as pd

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'Resultados 2002')
OUT_DIR  = os.path.join(BASE_DIR, 'resultados_geo', 'Majoritarias 2002')

ALL_UFS = [
    'AC','AL','AM','AP','BA','CE','DF','ES','GO',
    'MA','MG','MS','MT','PA','PB','PE','PI','PR',
    'RJ','RN','RO','RR','RS','SC','SE','SP','TO',
]


def build_cand_names_df(df_cand, cd_cargo, sg_uf=None, nr_turno=None):
    """Constroi cand_names a partir de subset do dataframe de candidatos."""
    mask = df_cand['CD_CARGO'] == cd_cargo
    if sg_uf and sg_uf != 'BR':
        mask = mask & (df_cand['SG_UF'] == sg_uf)
    if nr_turno is not None:
        mask = mask & (df_cand['NR_TURNO'] == nr_turno)

    sub = df_cand[mask].copy()
    if sub.empty:
        return {'95': ['VOTO BRANCO', '', 'BRANCO', '', ''],
                '96': ['VOTO NULO', '', 'NULO', '', '']}

    # Usa NM_URNA_CANDIDATO; fallback para NM_CANDIDATO
    sub['_nome'] = sub['NM_URNA_CANDIDATO'].fillna('').str.strip()
    empty_urna = sub['_nome'] == ''
    sub.loc[empty_urna, '_nome'] = sub.loc[empty_urna, 'NM_CANDIDATO'].fillna('').str.strip()

    sub['_status'] = sub['DS_SIT_TOT_TURNO'].fillna('').str.strip()
    sub.loc[sub['_status'].isin(['#NULO#', '']), '_status'] = 'N/D'

    cand_names = {}
    for _, row in sub.iterrows():
        nr = str(int(row['NR_CANDIDATO']))
        cand_names[nr] = [
            row['_nome'],
            str(row.get('SG_PARTIDO') or '').strip(),
            row['_status'],
            str(row.get('NM_COLIGACAO') or '').strip(),
            str(row.get('DS_COMPOSICAO_COLIGACAO') or '').strip(),
        ]

    cand_names['95'] = ['VOTO BRANCO', '', 'BRANCO', '', '']
    cand_names['96'] = ['VOTO NULO', '', 'NULO', '', '']
    return cand_names


def aggregate_votes_df(df_votes, cd_cargo, nr_turno):
    """Agrega votos por local usando groupby (vetorizado)."""
    mask = (df_votes['CD_CARGO'] == cd_cargo) & (df_votes['NR_TURNO'] == nr_turno)
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


def write_zip(out_dir, zip_name, json_name, payload):
    os.makedirs(out_dir, exist_ok=True)
    zip_path = os.path.join(out_dir, zip_name)
    content = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(json_name, content)
    return zip_path


def gerar_presidente(df_cand, df_br):
    print('\n=== PRESIDENTE ===')
    df_pres = df_br[df_br['CD_CARGO'] == 1].copy()

    for turno in [1, 2]:
        df_t = df_pres[df_pres['NR_TURNO'] == turno]
        if df_t.empty:
            print(f'  T{turno}: sem dados, pulando.')
            continue

        cand_names = build_cand_names_df(df_cand, 1, nr_turno=turno)
        ufs = sorted([uf for uf in df_t['SG_UF'].unique() if uf in ALL_UFS])

        for uf in ufs:
            df_uf = df_t[df_t['SG_UF'] == uf]
            results = aggregate_votes_df(df_uf, 1, turno)
            if not results:
                continue
            payload = {
                'METADATA': {'cand_names': cand_names, 'coalition_adjustments': {}},
                'RESULTS': results,
            }
            zip_name  = f'presidente_2002_t{turno}_{uf}.zip'
            json_name = f'presidente_2002_t{turno}_{uf}.json'
            path = write_zip(OUT_DIR, zip_name, json_name, payload)
            print(f'  T{turno} {uf}: {len(results)} locais -> {os.path.basename(path)}')


def gerar_governador(df_cand):
    print('\n=== GOVERNADOR ===')
    for uf in ALL_UFS:
        parquet_path = os.path.join(DATA_DIR, f'votacao_secao_2002_{uf}.parquet')
        if not os.path.exists(parquet_path):
            continue
        df_uf = pd.read_parquet(parquet_path)
        df_gov = df_uf[df_uf['CD_CARGO'] == 3]
        if df_gov.empty:
            continue

        turnos = sorted(df_gov['NR_TURNO'].unique().tolist())
        for turno in turnos:
            cand_names = build_cand_names_df(df_cand, 3, sg_uf=uf, nr_turno=turno)
            results = aggregate_votes_df(df_gov, 3, turno)
            if not results:
                continue
            payload = {
                'METADATA': {'cand_names': cand_names, 'coalition_adjustments': {}},
                'RESULTS': results,
            }
            zip_name  = f'governador_2002_ord_t{turno}_{uf}.zip'
            json_name = f'governador_2002_ord_t{turno}_{uf}.json'
            path = write_zip(OUT_DIR, zip_name, json_name, payload)
            print(f'  {uf} T{turno}: {len(results)} locais -> {os.path.basename(path)}')


def gerar_senador(df_cand):
    print('\n=== SENADOR ===')
    for uf in ALL_UFS:
        parquet_path = os.path.join(DATA_DIR, f'votacao_secao_2002_{uf}.parquet')
        if not os.path.exists(parquet_path):
            continue
        df_uf = pd.read_parquet(parquet_path)
        df_sen = df_uf[df_uf['CD_CARGO'] == 5]
        if df_sen.empty:
            continue

        turno = 1
        cand_names = build_cand_names_df(df_cand, 5, sg_uf=uf, nr_turno=turno)
        results = aggregate_votes_df(df_sen, 5, turno)
        if not results:
            continue
        payload = {
            'METADATA': {'cand_names': cand_names, 'coalition_adjustments': {}},
            'RESULTS': results,
        }
        zip_name  = f'senador_2002_ord_t{turno}_{uf}.zip'
        json_name = f'senador_2002_ord_t{turno}_{uf}.json'
        path = write_zip(OUT_DIR, zip_name, json_name, payload)
        print(f'  {uf}: {len(results)} locais -> {os.path.basename(path)}')


def main():
    print('Carregando metadados de candidatos...')
    df_cand = pd.read_parquet(os.path.join(DATA_DIR, 'consulta_cand_2002_BRASIL.parquet'))

    print('Carregando dados de votacao BR (presidente)...')
    df_br = pd.read_parquet(os.path.join(DATA_DIR, 'votacao_secao_2002_BR.parquet'))

    gerar_presidente(df_cand, df_br)
    gerar_governador(df_cand)
    gerar_senador(df_cand)

    print('\nConcluido! Arquivos em:', OUT_DIR)


if __name__ == '__main__':
    main()
