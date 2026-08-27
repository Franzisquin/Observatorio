"""
Gera os dados das eleicoes GERAIS de 1998 (majoritarias: Presidente, Governador,
Senador) no mesmo formato JSON-em-ZIP usado pelas gerais de 2002-2022 do site.

Base de geolocalizacao: locais de votacao de 2006 (GPKG nacional). Os arquivos de
secao de 1998 NAO trazem NR_LOCAL_VOTACAO (vem -3/#NE), entao a geolocalizacao usa o
mapa (UF, zona, secao) -> local derivado de votacao_secao_2006_BR.csv -- mesmo
principio das municipais de 2000. Como as zonas de 1998 diferem das de 2006, parte das
secoes nao geolocaliza; por isso o RESULTS contem TODAS as secoes (geoloc + nao
geoloc), garantindo que os totais por municipio (visao geral / tooltips) sejam reais.
As secoes nao geolocalizadas recebem uma chave sintetica "{zona}_{cdmun}_S{secao}" que
nunca casa no GPKG (parte do local nao-numerica) mas entra no total do municipio.

Metadados (NOME DE URNA, sigla de partido, coligacao e SITUACAO/status) vem de
consulta_cand_1998 (TSE): por UF para Governador/Senador e de consulta_cand_1998_BR.csv
para Presidente. O NM_VOTAVEL das secoes de 1998 traz o NOME COMPLETO, por isso o nome de
urna e a situacao de totalizacao (DS_SIT_TOT_TURNO, ja com "2 TURNO" para quem avancou)
sao lidos do consulta_cand.

Saidas (espelham "Majoritarias 2002/"), em resultados_geo/Majoritarias 1998/:
  presidente_1998_t1_{UF}.zip
  governador_1998_ord_t{1,2}_{UF}.zip
  senador_1998_ord_t1_{UF}.zip

Uso:
  py scripts/gerar_majoritarias_1998.py --ufs AC
  py scripts/gerar_majoritarias_1998.py            (todas as UFs)
"""

import argparse
import json
import os
import zipfile
from collections import defaultdict

import pandas as pd

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _resolve_secoes_dir():
    """Pasta dos brutos de 1998 do TSE. Hoje ela vive em 'Resultados 1998/' dentro
    do projeto (como 'Resultados 2002/'); a primeira geracao a mantinha ao lado do
    repositorio, entao o caminho antigo continua sendo aceito."""
    for base in (BASE_DIR, os.path.dirname(BASE_DIR)):
        caminho = os.path.join(base, 'Resultados 1998')
        if os.path.isdir(caminho):
            return caminho
    return os.path.join(BASE_DIR, 'Resultados 1998')


SECOES_DIR = _resolve_secoes_dir()
GEO_DIR = os.path.join(BASE_DIR, 'resultados_geo')
OUT_DIR = os.path.join(GEO_DIR, 'Majoritarias 1998')
DADOS_DIR = r'E:\Mapas\Dados'
GPKG_PATH = os.path.join(BASE_DIR, 'scratch', 'gpkg2006', 'locais_votacao_2006.gpkg')
GPKG_ZIP = os.path.join(GEO_DIR, 'locais_votacao_2006_gkpg.zip')
SEC2LOCAL_CSV = os.path.join(DADOS_DIR, 'votacao_secao_2006_BR.csv')
CONSULTA_ZIP = os.path.join(SECOES_DIR, 'consulta_cand_1998.zip')

ALL_UFS = [
    'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
    'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
]

CD_PRESIDENTE = 1
CD_GOVERNADOR = 3
CD_SENADOR = 5


# ----------------------------------------------------------------------------
# Base 2006 (GPKG) + mapa secao->local de 2006
# ----------------------------------------------------------------------------

def ensure_gpkg():
    if not os.path.exists(GPKG_PATH):
        os.makedirs(os.path.dirname(GPKG_PATH), exist_ok=True)
        with zipfile.ZipFile(GPKG_ZIP) as zf:
            name = [n for n in zf.namelist() if n.lower().endswith('.gpkg')][0]
            with zf.open(name) as src, open(GPKG_PATH, 'wb') as dst:
                dst.write(src.read())
    return GPKG_PATH


def load_geo_keys(uf):
    """Conjunto de (zona, local) existentes na base 2006 da UF."""
    import sqlite3
    con = sqlite3.connect(ensure_gpkg())
    cur = con.cursor()
    keys = set()
    q = ("SELECT nr_zona, nr_locvot FROM locais_votacao_2006_padronizado "
         "WHERE sg_uf=?")
    for zona, locvot in cur.execute(q, (uf,)):
        try:
            keys.add((int(zona), int(locvot)))
        except (TypeError, ValueError):
            continue
    con.close()
    return keys


def load_section_to_local_2006(ufs):
    """{(uf, zona, secao): local} a partir de votacao_secao_2006_BR.csv."""
    if not os.path.exists(SEC2LOCAL_CSV):
        print(f'  [AVISO] {SEC2LOCAL_CSV} nao encontrado; 1998 nao tera geolocalizacao.')
        return {}
    target = set(ufs)
    mapping = {}
    cols = ['SG_UF', 'NR_ZONA', 'NR_SECAO', 'NR_LOCAL_VOTACAO']
    reader = pd.read_csv(SEC2LOCAL_CSV, sep=';', encoding='latin-1', dtype=str,
                         usecols=cols, chunksize=200000, on_bad_lines='skip')
    for chunk in reader:
        chunk = chunk[chunk['SG_UF'].isin(target)]
        for uf, z, s, lv in chunk.itertuples(index=False):
            try:
                mapping[(uf, int(z), int(s))] = int(lv)
            except (TypeError, ValueError):
                continue
    print(f'  Mapa secao->local 2006: {len(mapping)} secoes ({",".join(sorted(target))})')
    return mapping


# ----------------------------------------------------------------------------
# Metadados de candidato (consulta_cand_1998): nome de urna, sigla, coligacao, status
# ----------------------------------------------------------------------------

_CONSULTA_COLS = ['CD_CARGO', 'NR_TURNO', 'NR_CANDIDATO', 'NM_CANDIDATO',
                  'NM_URNA_CANDIDATO', 'SG_PARTIDO', 'NM_COLIGACAO',
                  'DS_COMPOSICAO_COLIGACAO', 'DS_SIT_TOT_TURNO']
_NE = ('#NE', '#NE#', '#NULO#', '-3', '-1', '')
_PRESIDENT_META = None  # cache do consulta_cand_1998_BR.csv (presidente, nacional)


def _clean(v):
    s = str(v or '').strip()
    return '' if s in _NE else s


def norm_status(raw):
    """Mantem a situacao do TSE (ELEITO / NAO ELEITO / 2 TURNO / ...);
    valores vazios/nulos viram 'N/D'. O frontend reconhece 'ELEITO' e '2 TURNO'."""
    s = str(raw or '').strip()
    return 'N/D' if s in _NE else s


def _parse_consulta_df(df, only_cargos):
    """DataFrame consulta -> {(cargo:int, turno:int, num:str): [registros]}."""
    meta = defaultdict(list)
    for r in df.itertuples(index=False):
        try:
            cargo = int(r.CD_CARGO)
            if cargo not in only_cargos:
                continue
            turno = int(r.NR_TURNO)
            num = str(int(r.NR_CANDIDATO))
        except (TypeError, ValueError):
            continue
        meta[(cargo, turno, num)].append({
            'full': _clean(r.NM_CANDIDATO),
            'urna': _clean(r.NM_URNA_CANDIDATO),
            'sigla': _clean(r.SG_PARTIDO),
            'colig': _clean(r.NM_COLIGACAO),
            'comp': _clean(r.DS_COMPOSICAO_COLIGACAO),
            'status': norm_status(r.DS_SIT_TOT_TURNO),
        })
    return meta


def _read_consulta_member(member):
    with zipfile.ZipFile(CONSULTA_ZIP) as zf:
        with zf.open(member) as fh:
            return pd.read_csv(fh, sep=';', encoding='latin-1', dtype=str,
                               usecols=_CONSULTA_COLS, on_bad_lines='skip')


def get_president_meta():
    """Metadados de presidente (consulta_cand_1998_BR.csv), cacheados."""
    global _PRESIDENT_META
    if _PRESIDENT_META is not None:
        return _PRESIDENT_META
    _PRESIDENT_META = defaultdict(list)
    if os.path.exists(CONSULTA_ZIP):
        try:
            df = _read_consulta_member('consulta_cand_1998_BR.csv')
            _PRESIDENT_META = _parse_consulta_df(df, {CD_PRESIDENTE})
        except KeyError:
            print('  [AVISO] consulta_cand_1998_BR.csv nao encontrado no zip.')
    else:
        print(f'  [AVISO] {CONSULTA_ZIP} nao encontrado; presidente sem nome de urna/sigla.')
    return _PRESIDENT_META


def load_consulta_cand(uf):
    """{(cargo, turno, num): [registros]} para Governador/Senador (UF) + Presidente (BR)."""
    meta = defaultdict(list)
    if os.path.exists(CONSULTA_ZIP):
        try:
            df = _read_consulta_member(f'consulta_cand_1998_{uf}.csv')
            meta = _parse_consulta_df(df, {CD_GOVERNADOR, CD_SENADOR})
        except KeyError:
            print(f'  [AVISO] consulta_cand_1998_{uf}.csv nao encontrado no zip.')
    else:
        print(f'  [AVISO] {CONSULTA_ZIP} nao encontrado; gov/sen sem nome de urna/sigla.')
    for key, rows in get_president_meta().items():
        meta[key].extend(rows)
    return meta


def pick_consulta_row(rows, section_full):
    """Escolhe o registro do consulta que casa com o nome completo da secao
    (desambigua numeros repetidos); senao, o primeiro com nome de urna/status valido."""
    if not rows:
        return None
    if len(rows) == 1:
        return rows[0]
    target = _norm(section_full)
    for r in rows:
        if target and _norm(r['full']) == target:
            return r
    for r in rows:
        if r['urna'] and r['status'] not in ('N/D', ''):
            return r
    return rows[0]


def _norm(s):
    import unicodedata
    s = unicodedata.normalize('NFD', str(s or ''))
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return s.upper().strip()


# ----------------------------------------------------------------------------
# Leitura das secoes (dois schemas: presidente minusculo / demais maiusculo)
# ----------------------------------------------------------------------------

def _read_csv_from_zip(zip_path, rename, usecols_src):
    with zipfile.ZipFile(zip_path) as zf:
        name = [n for n in zf.namelist() if n.lower().endswith('.csv')][0]
        with zf.open(name) as fh:
            df = pd.read_csv(fh, sep=';', encoding='latin-1', dtype=str,
                             usecols=usecols_src, on_bad_lines='skip')
    df = df.rename(columns=rename)
    return df


def read_governador_senador(uf):
    """votacao_secao_1998_{UF}.csv -> df padronizado (cargos 3 e 5)."""
    zip_path = os.path.join(SECOES_DIR, f'votacao_secao_1998_{uf}.zip')
    if not os.path.exists(zip_path):
        cands = [f for f in os.listdir(SECOES_DIR)
                 if f.startswith(f'votacao_secao_1998_{uf}') and f.endswith('.zip')]
        if not cands:
            return None
        zip_path = os.path.join(SECOES_DIR, cands[0])
    cols = ['NR_TURNO', 'CD_MUNICIPIO', 'NM_MUNICIPIO', 'NR_ZONA', 'NR_SECAO',
            'CD_CARGO', 'NR_VOTAVEL', 'NM_VOTAVEL', 'QT_VOTOS']
    rename = {'NR_TURNO': 'TURNO', 'CD_MUNICIPIO': 'CDMUN', 'NM_MUNICIPIO': 'NMMUN',
              'NR_ZONA': 'ZONA', 'NR_SECAO': 'SECAO', 'CD_CARGO': 'CARGO',
              'NR_VOTAVEL': 'NUM', 'NM_VOTAVEL': 'NOME', 'QT_VOTOS': 'VOTOS'}
    df = _read_csv_from_zip(zip_path, rename, cols)
    return _coerce(df)


def read_presidente(uf):
    """votacao_secao-municipio_*_presidente_*_{uf}.csv -> df padronizado (cargo 1)."""
    uf_l = uf.lower()
    patterns = [
        f'votacao_secao-municipio_presidente_1998_{uf_l}',
        f'votacao_secao-municipio_1998_{uf_l}_presidente',
    ]
    zip_path = None
    for pat in patterns:
        for f in os.listdir(SECOES_DIR):
            if f.lower().startswith(pat) and f.endswith('.zip'):
                zip_path = os.path.join(SECOES_DIR, f)
                break
        if zip_path:
            break
    if not zip_path:
        return None
    cols = ['nr_turno', 'cd_municipio', 'nm_municipio', 'nr_zona', 'nr_secao',
            'nr_votavel', 'nm_votavel', 'qt_votos']
    rename = {'nr_turno': 'TURNO', 'cd_municipio': 'CDMUN', 'nm_municipio': 'NMMUN',
              'nr_zona': 'ZONA', 'nr_secao': 'SECAO',
              'nr_votavel': 'NUM', 'nm_votavel': 'NOME', 'qt_votos': 'VOTOS'}
    df = _read_csv_from_zip(zip_path, rename, cols)
    df['CARGO'] = CD_PRESIDENTE
    return _coerce(df)


def _coerce(df):
    for col in ('TURNO', 'CDMUN', 'ZONA', 'SECAO', 'CARGO', 'VOTOS'):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
    df = df.dropna(subset=['CDMUN', 'ZONA', 'SECAO', 'VOTOS'])
    for col in ('TURNO', 'CDMUN', 'ZONA', 'SECAO', 'CARGO', 'VOTOS'):
        if col in df.columns:
            df[col] = df[col].astype(int)
    df['NUM'] = df['NUM'].fillna('').astype(str).str.replace(r'\.0$', '', regex=True).str.strip()
    df['NOME'] = df['NOME'].fillna('').astype(str).str.strip()
    df['NMMUN'] = df['NMMUN'].fillna('').astype(str).str.strip()
    return df


# ----------------------------------------------------------------------------
# Construcao de cand_names + RESULTS por (cargo, turno)
# ----------------------------------------------------------------------------

def _is_invalid(num):
    return num in ('95', '96', '97')


def build_cand_names(df_turno, cargo, turno, consulta_meta, fallback_status):
    """cand_names[num] = [nome_urna, sigla, status, colig_nome, composicao].
    Nome de urna / sigla / coligacao / status vem do consulta_cand; quando o numero
    nao esta no consulta (raro) usa o nome completo da secao + status derivado."""
    cand_names = {}
    pairs = df_turno[['NUM', 'NOME']].drop_duplicates()
    for num, nome in pairs.itertuples(index=False):
        num = str(num)
        if not num:
            continue
        if num == '95':
            cand_names[num] = ['VOTO BRANCO', '', 'BRANCO', '', '']
            continue
        if num in ('96', '97'):
            cand_names[num] = ['VOTO NULO', '', 'NULO', '', '']
            continue
        row = pick_consulta_row(consulta_meta.get((cargo, turno, num), []), nome)
        if row:
            cand_names[num] = [
                row['urna'] or row['full'] or nome or f'Candidato {num}',
                row['sigla'], row['status'] or fallback_status.get(num, 'N/D'),
                row['colig'], row['comp'],
            ]
        else:
            cand_names[num] = [nome or f'Candidato {num}', '',
                               fallback_status.get(num, 'N/D'), '', '']
    cand_names.setdefault('95', ['VOTO BRANCO', '', 'BRANCO', '', ''])
    cand_names.setdefault('96', ['VOTO NULO', '', 'NULO', '', ''])
    return cand_names


def aggregate_results(df_turno, uf, sec2local, geo_keys):
    """RESULTS{chave: {num: votos}} com TODAS as secoes (geoloc + sintetica)."""
    results = defaultdict(lambda: defaultdict(int))
    for cdmun, zona, secao, num, votos in df_turno[
            ['CDMUN', 'ZONA', 'SECAO', 'NUM', 'VOTOS']].itertuples(index=False):
        num = str(num)
        if not num:
            continue
        local = sec2local.get((uf, int(zona), int(secao)))
        if local is not None and (int(zona), int(local)) in geo_keys:
            key = f'{int(zona)}_{int(cdmun)}_{int(local)}'
        else:
            key = f'{int(zona)}_{int(cdmun)}_S{int(secao)}'
        results[key][num] += int(votos)
    return {k: dict(v) for k, v in results.items()}


def nominal_totals(df_turno):
    """{num: total_votos} apenas nominais (exclui 95/96/97)."""
    tot = defaultdict(int)
    for num, votos in df_turno.groupby('NUM')['VOTOS'].sum().items():
        num = str(num)
        if num and not _is_invalid(num):
            tot[num] += int(votos)
    return tot


def write_zip(zip_name, json_name, payload):
    os.makedirs(OUT_DIR, exist_ok=True)
    zip_path = os.path.join(OUT_DIR, zip_name)
    content = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(json_name, content)
    return zip_path


def derive_fallback_status(df_cargo, turnos):
    """Status derivado dos totais (so usado quando o consulta nao traz o candidato)."""
    t2_nums = set(nominal_totals(df_cargo[df_cargo['TURNO'] == 2])) if 2 in turnos else set()
    by_turno = {}
    for turno in turnos:
        tot = nominal_totals(df_cargo[df_cargo['TURNO'] == turno])
        sb = {}
        if turno == 1 and t2_nums:
            for num in tot:
                sb[num] = '2º TURNO' if num in t2_nums else 'NÃO ELEITO'
        else:
            ranked = sorted(tot.items(), key=lambda x: -x[1])
            for i, (num, _) in enumerate(ranked):
                sb[num] = 'ELEITO' if i == 0 else 'NÃO ELEITO'
        by_turno[turno] = sb
    return by_turno


def emit_cargo(uf, cargo, df_cargo, sec2local, geo_keys, consulta_meta,
               zip_prefix, json_prefix, t2_states):
    """Gera os ZIPs de um cargo majoritario para a UF. Nome de urna/sigla/coligacao/
    status vem do consulta_cand; o 2o turno e classificado pela situacao do TSE."""
    if df_cargo is None or df_cargo.empty:
        return
    turnos = sorted(int(t) for t in df_cargo['TURNO'].dropna().unique())
    if 2 in turnos:
        t2_states.add(uf)
    fallback_by_turno = derive_fallback_status(df_cargo, turnos)

    for turno in turnos:
        dt = df_cargo[df_cargo['TURNO'] == turno]
        if dt.empty:
            continue
        cand_names = build_cand_names(dt, cargo, turno, consulta_meta,
                                      fallback_by_turno.get(turno, {}))
        results = aggregate_results(dt, uf, sec2local, geo_keys)
        if not results:
            continue
        payload = {
            'METADATA': {'cand_names': cand_names, 'coalition_adjustments': {}},
            'RESULTS': results,
        }
        zip_name = f'{zip_prefix}_t{turno}_{uf}.zip'
        json_name = f'{json_prefix}_t{turno}_{uf}.json'
        write_zip(zip_name, json_name, payload)
        n_geo = sum(1 for k in results if '_S' not in k)
        n_syn = len(results) - n_geo
        print(f'    {zip_prefix} t{turno} {uf}: {len(results)} chaves '
              f'({n_geo} geoloc / {n_syn} sinteticas) -> {zip_name}')


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ufs', default=','.join(ALL_UFS))
    args = ap.parse_args()
    ufs = [u.strip().upper() for u in args.ufs.split(',') if u.strip()]

    sec2local = load_section_to_local_2006(ufs)
    t2_states = set()

    for uf in ufs:
        print(f'\n[{uf} 1998]')
        geo_keys = load_geo_keys(uf)
        consulta_meta = load_consulta_cand(uf)

        # Governador + Senador (mesmo arquivo)
        df_gs = read_governador_senador(uf)
        if df_gs is not None and not df_gs.empty:
            emit_cargo(uf, CD_GOVERNADOR, df_gs[df_gs['CARGO'] == CD_GOVERNADOR],
                       sec2local, geo_keys, consulta_meta,
                       'governador_1998_ord', 'governador_1998_ord', t2_states)
            emit_cargo(uf, CD_SENADOR, df_gs[df_gs['CARGO'] == CD_SENADOR],
                       sec2local, geo_keys, consulta_meta,
                       'senador_1998_ord', 'senador_1998_ord', t2_states)
        else:
            print(f'  [AVISO] sem arquivo de secao (gov/sen) para {uf}.')

        # Presidente (arquivo proprio)
        df_pres = read_presidente(uf)
        if df_pres is not None and not df_pres.empty:
            emit_cargo(uf, CD_PRESIDENTE, df_pres, sec2local, geo_keys, consulta_meta,
                       'presidente_1998', 'presidente_1998', set())
        else:
            print(f'  [AVISO] sem arquivo de presidente para {uf}.')

    print('\nUFs com 2o turno de governador:', ','.join(sorted(t2_states)) or '(nenhuma)')
    print('Concluido! Arquivos em:', OUT_DIR)


if __name__ == '__main__':
    main()
