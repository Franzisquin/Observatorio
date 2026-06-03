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

# Prioridade para DS_SIT_TOT_TURNO — numero maior = prioridade maior (igual ao 2006)
SIT_PRIORITY = {
    '#NULO':         0,
    '#NULO#':        0,
    '':              1,
    'SUPLENTE':      2,
    'INAPTO':        2,
    'NÃO ELEITO':    3,
    'NAO ELEITO':    3,
    'ELEITO POR QP': 4,
    'ELEITO POR MÉDIA': 4,
    'ELEITO POR MEDIA': 4,
    'ELEITO':        4,
    'MÉDIA':         4,
    'MEDIA':         4,
}

INAPTO_KEYWORDS = [
    'INAPTO', 'CASSADO', 'INELEGÍVEL', 'INELEGIVEL',
    'INDEFERIDO', 'FALECIMENTO', 'RENÚNCIA', 'RENUNCIA',
    'CANCELADO', 'NÃO CONHECIMENTO',
]


def get_sit_priority(sit_str):
    return SIT_PRIORITY.get(str(sit_str).strip().upper(), 1)


def resolve_status(sit_tot, detalhe_sit, sit_cand):
    """Resolve status final detectando inaptos; respeita excecao COM RECURSO."""
    sit_up     = str(sit_tot).strip().upper()
    detalhe_up = str(detalhe_sit).strip().upper()
    sit_cand_up = str(sit_cand).strip().upper()

    inapto = (
        any(k in detalhe_up  for k in INAPTO_KEYWORDS) or
        any(k in sit_up      for k in INAPTO_KEYWORDS) or
        any(k in sit_cand_up for k in INAPTO_KEYWORDS)
    )
    com_recurso = (
        'COM RECURSO' in detalhe_up or
        'COM RECURSO' in sit_up or
        'COM RECURSO' in sit_cand_up
    )
    if inapto and not com_recurso:
        return 'INAPTO'

    return sit_up if sit_up not in ('#NULO#', '#NULO', '') else 'N/D'


def normalize_comp(comp_str):
    if not isinstance(comp_str, str) or not comp_str.strip():
        return ''
    return '/'.join(sorted(p.strip().upper() for p in comp_str.split('/')))


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
    Constroi cand_names para deputados com:
    - Deduplicacao por prioridade de status (igual ao 2006)
    - Deteccao de inaptos (CASSADO, INDEFERIDO, etc.) com excecao COM RECURSO
    - Candidatos nominais e votos de legenda
    """
    mask = (df_cand['CD_CARGO'] == cd_cargo) & (df_cand['SG_UF'] == sg_uf) & (df_cand['NR_TURNO'] == 1)
    sub = df_cand[mask].copy()

    cand_names = {}
    priority_map = {}

    if not sub.empty:
        sub['_nome'] = sub['NM_URNA_CANDIDATO'].fillna('').str.strip()
        empty_urna = sub['_nome'] == ''
        sub.loc[empty_urna, '_nome'] = sub.loc[empty_urna, 'NM_CANDIDATO'].fillna('').str.strip()

        for _, row in sub.iterrows():
            nr = str(int(row['NR_CANDIDATO']))

            sit_tot  = str(row.get('DS_SIT_TOT_TURNO', '')         or '')
            detalhe  = str(row.get('DS_DETALHE_SITUACAO_CAND', '') or '')
            sit_cand = str(row.get('DS_SITUACAO_CANDIDATURA', '')   or '')

            status  = resolve_status(sit_tot, detalhe, sit_cand)
            new_pri = get_sit_priority(sit_tot)

            entry = [
                row['_nome'],
                str(row.get('SG_PARTIDO') or '').strip(),
                status,
                str(row.get('NM_COLIGACAO') or '').strip(),
                str(row.get('DS_COMPOSICAO_COLIGACAO') or '').strip(),
            ]

            if new_pri > priority_map.get(nr, -1):
                cand_names[nr] = entry
                priority_map[nr] = new_pri

        # Votos de legenda: chave = str(NR_PARTIDO) de ate 2 digitos
        party_groups = sub.groupby('NR_PARTIDO').first().reset_index()
        for _, prow in party_groups.iterrows():
            nr_partido = str(int(prow['NR_PARTIDO']))
            if len(nr_partido) <= 2:
                sigla = str(prow.get('SG_PARTIDO') or nr_partido).strip()
                colig = str(prow.get('NM_COLIGACAO') or '').strip()
                comp  = str(prow.get('DS_COMPOSICAO_COLIGACAO') or '').strip()
                cand_names[nr_partido] = ['', sigla, 'LEGENDA', colig, comp]

    cand_names['95'] = ['VOTO BRANCO', '', 'BRANCO', '', '']
    cand_names['96'] = ['VOTO NULO',   '', 'NULO',   '', '']
    return cand_names


def verify_and_fix_names(cand_names, df_votes, cd_cargo):
    """
    Extrai nomes de candidatos do arquivo de votos (NM_VOTAVEL)
    para candidatos nao encontrados no cadastro — mesmo padrao do 2006.
    """
    if 'NM_VOTAVEL' not in df_votes.columns:
        return

    mask = df_votes['CD_CARGO'] == cd_cargo
    pairs = df_votes[mask][['NR_VOTAVEL', 'NM_VOTAVEL']].drop_duplicates()

    for _, row in pairs.iterrows():
        num = str(int(row['NR_VOTAVEL']))
        if num in cand_names or len(num) <= 2 or num in ('95', '96', '97'):
            continue
        prefix = num[:2]
        party = next(
            (d[1] for k, d in cand_names.items() if len(str(k)) <= 2 and str(k) == prefix),
            prefix,
        )
        cand_names[num] = [str(row['NM_VOTAVEL']).strip(), party, 'EXTRAÍDO', '', '']


def write_zip(out_dir, zip_name, json_name, payload):
    os.makedirs(out_dir, exist_ok=True)
    zip_path = os.path.join(out_dir, zip_name)
    content = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(json_name, content)
    return zip_path


def build_detalhes_candidatos(df_cand):
    """Gera detalhes_candidatos_2002.json com deteccao de inaptos e deduplicacao."""
    mask = df_cand['CD_CARGO'].isin([6, 7, 8]) & (df_cand['NR_TURNO'] == 1)
    sub = df_cand[mask].copy()
    sub['_nome'] = sub['NM_URNA_CANDIDATO'].fillna('').str.strip()
    empty = sub['_nome'] == ''
    sub.loc[empty, '_nome'] = sub.loc[empty, 'NM_CANDIDATO'].fillna('').str.strip()

    details = {}
    priority_map = {}

    for _, row in sub.iterrows():
        nr = str(int(row['NR_CANDIDATO']))

        sit_tot  = str(row.get('DS_SIT_TOT_TURNO', '')         or '')
        detalhe  = str(row.get('DS_DETALHE_SITUACAO_CAND', '') or '')
        sit_cand = str(row.get('DS_SITUACAO_CANDIDATURA', '')   or '')

        status  = resolve_status(sit_tot, detalhe, sit_cand)
        new_pri = get_sit_priority(sit_tot)

        if new_pri > priority_map.get(nr, -1):
            details[nr] = {
                'nome':       row['_nome'],
                'partido':    str(row.get('SG_PARTIDO') or '').strip(),
                'numero':     nr,
                'cargo':      str(row.get('DS_CARGO') or '').upper().strip(),
                'situacao':   status,
                'coligacao':  str(row.get('NM_COLIGACAO') or '').strip(),
                'composicao': str(row.get('DS_COMPOSICAO_COLIGACAO') or '').strip(),
                'uf':         str(row.get('SG_UF') or '').strip(),
            }
            priority_map[nr] = new_pri

    return details


def build_official_totals(qe_csv_path):
    """
    Gera official_totals_2002.json a partir do CSV de quociente eleitoral.
    Formato: {UF: {type_key: {stats: {...}, coalitions: [...]}}}
    """
    df = pd.read_csv(qe_csv_path, sep=';', encoding='latin1', low_memory=False)
    df.columns = [c.strip() for c in df.columns]
    col_map = {c.upper(): c for c in df.columns}

    def col(name):
        return col_map.get(name.upper(), name)

    # Detectar coluna de votos por composicao
    votes_col = next(
        (c for c in df.columns if 'votos' in c.lower() and 'composi' in c.lower()),
        next((c for c in df.columns if 'votos' in c.lower() and 'válid' in c.lower()), None),
    )
    vagas_qp_col    = col('Vagas QP')
    eleitos_qp_col  = next((c for c in df.columns if 'eleita' in c.lower() and 'qp' in c.lower()), None)
    eleitos_avg_col = next(
        (c for c in df.columns if 'eleita' in c.lower() and ('méd' in c.lower() or 'med' in c.lower())),
        None,
    )
    comp_col = col('DS_COMPOSICAO_COLIGACAO')
    uf_col   = col('UF')

    totals = {}

    for uf, uf_df in df.groupby(uf_col):
        uf = str(uf).strip()
        if uf not in ALL_UFS:
            continue
        totals[uf] = {}

        for cd_cargo, type_label in CARGO_DEF.items():
            # Filtrar por codigo numerico ou por texto do cargo
            cd_col = col('CD_CARGO')
            if cd_col in df.columns:
                cargo_df = uf_df[uf_df[cd_col] == cd_cargo]
            else:
                kw_map = {6: 'FEDERAL', 7: 'ESTADUAL', 8: 'DISTRITAL'}
                ds_col = col('DS_CARGO')
                cargo_df = uf_df[uf_df[ds_col].str.upper().str.contains(kw_map[cd_cargo], na=False)]

            if cargo_df.empty:
                continue

            first_row = cargo_df.iloc[0]

            def safe_int(key):
                v = first_row.get(col(key), 0)
                return int(v) if pd.notnull(v) and v != '' else 0

            stats = {
                'qt_vagas':          safe_int('qt_vagas_qe'),
                'vr_qe':             safe_int('vr_quociente_eleitoral'),
                'qt_votos_validos':  safe_int('qt_votos_validos_qe'),
            }

            coalitions = []
            for _, row in cargo_df.iterrows():
                def sv(c):
                    if c is None or c not in row.index:
                        return 0
                    v = row[c]
                    return int(v) if pd.notnull(v) and v != '' else 0

                comp    = str(row.get(comp_col, '') or '').strip()
                votos   = sv(votes_col)
                vqp     = sv(vagas_qp_col)
                el_qp   = sv(eleitos_qp_col)
                el_avg  = sv(eleitos_avg_col)

                coalitions.append({
                    'id':          normalize_comp(comp),
                    'raw_comp':    comp,
                    'votes':       votos,
                    'elected':     el_qp + el_avg,
                    'elected_qp':  el_qp,
                    'elected_avg': el_avg,
                    'vagas_qp':    vqp,
                })

            coalitions.sort(key=lambda x: x['votes'], reverse=True)
            key_char = type_label[0]  # 'f' ou 'e'
            # Nao sobrescreve 'e' se ja foi preenchido por cargo 7 com cargo 8
            if key_char not in totals[uf]:
                totals[uf][key_char] = {'stats': stats, 'coalitions': coalitions}

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
            verify_and_fix_names(cand_names, df_uf, cd_cargo)
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
