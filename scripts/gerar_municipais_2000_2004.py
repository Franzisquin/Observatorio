"""
Gera os dados das eleicoes MUNICIPAIS de 2000 e 2004 (Prefeito + Vereador) no
mesmo formato JSON-em-ZIP usado pelas municipais de 2008-2024 do site.

Base de geolocalizacao: locais de votacao de 2006 (GPKG nacional). Como as zonas
eleitorais de 2000/2004 diferem das de 2006, parte das secoes nao geolocaliza; por
isso o RESULTADO GERAL do municipio usa os TOTAIS COMPLETOS (soma de TODAS as
secoes do arquivo do TSE, inclusive as que nao geolocalizam) -- mesmo principio dos
totais oficiais de 2002/vereadores.

Legislacao do quociente (vereador): Codigo Eleitoral (Lei 4.737/65), arts. 106-109,
na redacao vigente em 2000/2004 -- coligacoes permitidas no proporcional, SEM
clausula de desempenho individual (criada pela Lei 13.165/2015) e SEM regra 80/20
(Lei 13.488/2017). No site isso corresponde a "Epoch 1" (electionYearNum <= 2016,
sem barreira individual). O QE = votos validos (nominais + legenda) / numero de
vagas, com a fracao >= 0,5 arredondada para cima (art. 106).

Saidas:
  resultados_geo/Municipais {ano}/prefeito_{ano}_ord_t{t}_{UF}.zip
  resultados_geo/Municipais_Legislativas {ano}/vereadores_{ano}_{UF}.zip
  resultados_geo/Municipais_Legislativas {ano}/official_totals_vereadores_{ano}.json
  Resultados 2000-2004/zonas_problematicas_2000_2004.csv

Uso:
  py scripts/gerar_municipais_2000_2004.py --years 2004 --ufs RJ
  py scripts/gerar_municipais_2000_2004.py            (todos os estados, 2000 e 2004)
"""

import argparse
import csv
import json
import os
import re
import unicodedata
import zipfile
from collections import defaultdict

import pandas as pd

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SECOES_DIR = os.path.join(BASE_DIR, 'Resultados 2000-2004')
GEO_DIR = os.path.join(BASE_DIR, 'resultados_geo')
DADOS_DIR = r'E:\Mapas\Dados'
GPKG_PATH = os.path.join(BASE_DIR, 'scratch', 'gpkg2006', 'locais_votacao_2006.gpkg')
GPKG_ZIP = os.path.join(GEO_DIR, 'locais_votacao_2006_gkpg.zip')
REPORT_CSV = os.path.join(SECOES_DIR, 'zonas_problematicas_2000_2004.csv')
GAPS_CSV = os.path.join(SECOES_DIR, 'lacunas_preenchidas_munzona_2000_2004.csv')

ALL_UFS = [
    'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
    'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE',
    'SP', 'TO',
]  # DF nao tem eleicao municipal

CD_PREFEITO = 11
CD_VEREADOR = 13

STATUS_ELEITO = {'ELEITO', 'ELEITO POR QP', 'ELEITO POR MEDIA', 'ELEITO POR MÉDIA',
                 'MEDIA', 'MÉDIA', 'ELEITA', 'ELEITA POR QP', 'ELEITA POR MEDIA'}
STATUS_VOCAB = (STATUS_ELEITO | {
    'NAO ELEITO', 'NÃO ELEITO', 'SUPLENTE', 'INAPTO', '2 TURNO', '2º TURNO',
    'SUBSTITUIDO', 'RENUNCIA', 'RENÚNCIA', '#NULO#', '#NE#',
})
INAPTO_KEYWORDS = ['INAPTO', 'CASSAD', 'INELEG', 'INDEFERIDO', 'FALECIMENTO',
                   'RENUNCIA', 'RENÚNCIA', 'CANCELAD', 'NAO CONHECIMENTO']


# ----------------------------------------------------------------------------
# Utils
# ----------------------------------------------------------------------------

def slugify(value):
    """Replica js normalizeMunicipioSlug: NFD, sem acento, maiusc, [^A-Z0-9]->_ ."""
    s = unicodedata.normalize('NFD', str(value or ''))
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    s = s.upper()
    s = re.sub(r'[^A-Z0-9]+', '_', s)
    return s.strip('_')


_CONNECTORS = {'DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'D'}


def loose_slug(value):
    """Slug sem conectores (DE/DA/DO/DOS/DAS/E) p/ casar grafias divergentes."""
    toks = [t for t in slugify(value).split('_') if t and t not in _CONNECTORS]
    return '_'.join(toks)


def strip_accents_upper(value):
    s = unicodedata.normalize('NFD', str(value or ''))
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return s.upper().strip()


def title_name(value):
    s = str(value or '').strip()
    if not s:
        return s
    return s.title()


def party_from_number(nr_votavel):
    """Numero do partido = 2 primeiros digitos do numero do candidato."""
    s = str(nr_votavel).strip()
    return s[:2] if len(s) >= 2 else s


def ensure_gpkg():
    if not os.path.exists(GPKG_PATH):
        os.makedirs(os.path.dirname(GPKG_PATH), exist_ok=True)
        with zipfile.ZipFile(GPKG_ZIP) as zf:
            name = [n for n in zf.namelist() if n.lower().endswith('.gpkg')][0]
            with zf.open(name) as src, open(GPKG_PATH, 'wb') as dst:
                dst.write(src.read())
    return GPKG_PATH


# ----------------------------------------------------------------------------
# Base 2006 (GPKG)
# ----------------------------------------------------------------------------

def load_gpkg_uf(uf):
    """Carrega a base 2006 da UF. Retorna dict com:
       canon_by_slug : {muni_slug: nome_canonico}
       geo_keys      : set((zona, locvot))
       zonas_uf      : set(zona)
       mun_by_zona   : {zona: set(muni_slug)}
       zonas_by_mun  : {muni_slug: set(zona)}
    """
    import sqlite3
    con = sqlite3.connect(ensure_gpkg())
    con.text_factory = lambda b: b.decode('utf-8', 'replace')
    cur = con.cursor()
    canon_by_slug = {}
    canon_by_loose = {}
    geo_keys = set()
    zonas_uf = set()
    mun_by_zona = defaultdict(set)
    zonas_by_mun = defaultdict(set)
    q = ("SELECT nr_zona, nr_locvot, nm_localidade, long, lat "
         "FROM locais_votacao_2006_padronizado WHERE sg_uf=?")
    for zona, locvot, nm, lng, lat in cur.execute(q, (uf,)):
        try:
            zona = int(zona)
            locvot = int(locvot)
        except (TypeError, ValueError):
            continue
        slug = slugify(nm)
        canon_by_slug.setdefault(slug, str(nm).strip())
        canon_by_loose.setdefault(loose_slug(nm), str(nm).strip())
        geo_keys.add((zona, locvot))
        zonas_uf.add(zona)
        mun_by_zona[zona].add(slug)
        zonas_by_mun[slug].add(zona)
    con.close()
    return {
        'canon_by_slug': canon_by_slug,
        'canon_by_loose': canon_by_loose,
        'geo_keys': geo_keys,
        'zonas_uf': zonas_uf,
        'mun_by_zona': mun_by_zona,
        'zonas_by_mun': zonas_by_mun,
    }


# ----------------------------------------------------------------------------
# Mapeamento secao->local de 2006 (apenas para 2000, que nao tem NR_LOCAL_VOTACAO)
# ----------------------------------------------------------------------------

def load_section_to_local_2006(ufs):
    """{(uf, zona, secao): locvot} a partir de votacao_secao_2006_BR.csv."""
    path = os.path.join(DADOS_DIR, 'votacao_secao_2006_BR.csv')
    if not os.path.exists(path):
        print(f'  [AVISO] {path} nao encontrado; 2000 nao tera geolocalizacao.')
        return {}
    target = set(ufs)
    mapping = {}
    cols = ['SG_UF', 'NR_ZONA', 'NR_SECAO', 'NR_LOCAL_VOTACAO']
    reader = pd.read_csv(path, sep=';', encoding='latin-1', dtype=str,
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
# Munzona: nome de urna, status, coligacao/composicao (esquema variavel por UF)
# ----------------------------------------------------------------------------

def _sniff_rows(raw_bytes):
    """Decodifica e devolve linhas como listas de campos, detectando delimitador."""
    text = raw_bytes.decode('latin-1')
    sample = text[:5000]
    delim = ';' if sample.count(';') >= sample.count(',') else ','
    reader = csv.reader(text.splitlines(), delimiter=delim, quotechar='"')
    return list(reader)


def load_modern_name_to_code(uf):
    """{slug_municipio: codigo_tse} a partir da referencia de 2008 (codigos estaveis).
    Usado para resolver o codigo de layouts munzona sem codigo (ex.: PA 2000)."""
    out = {}
    zp = os.path.join(GEO_DIR, 'Municipais 2008', f'prefeito_2008_ord_t1_{uf}.zip')
    if not os.path.exists(zp):
        return out
    with zipfile.ZipFile(zp) as zf:
        for n in zf.namelist():
            if n.endswith('_resumo.json'):
                continue
            m = re.match(r'(\d+)_(.+)\.json$', n)
            if m:
                code, sl = m.group(1), m.group(2)
                out.setdefault(sl, code)
                out.setdefault(loose_slug(sl), code)
    return out


def parse_munzona(uf, year, name_to_code=None):
    """Retorna (meta, votes, names):
       meta  : {(cdmun:int, num:str): {urna, sigla, status, colig, colig_seq}}
       votes : {(cdmun:int, mode): {turno:int: {num:str: votos}}}  (totais municipais)
       names : {cdmun:int: NM_MUNICIPIO}
    Usa ancora DS_CARGO ('PREFEITO'/'VEREADOR') e prefixo fixo do layout legado TSE.
    Os totais por municipio sao usados para preencher lacunas do arquivo de secoes.
    name_to_code: resolve o codigo por nome em layouts sem codigo (ex.: PA 2000, 12 campos).
    """
    name_to_code = name_to_code or {}
    zip_path = os.path.join(DADOS_DIR, f'votacao_candidato_munzona_{year}.zip')
    meta = {}
    votes = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    names = {}
    if not os.path.exists(zip_path):
        print(f'  [AVISO] munzona {year} nao encontrado em {DADOS_DIR}.')
        return meta, votes, names
    with zipfile.ZipFile(zip_path) as zf:
        cand = [n for n in zf.namelist()
                if f'_{uf}.' in n.upper() and (n.lower().endswith('.txt') or n.lower().endswith('.csv'))]
        if not cand:
            print(f'  [AVISO] munzona {year} {uf} nao encontrado no zip.')
            return meta, votes, names
        rows = _sniff_rows(zf.read(cand[0]))

    for row in rows:
        # Layout MIN12 (ex.: PA 2000): nome@1, sem codigo, cargo@8, num@4, votos@11.
        if (len(row) == 12 and strip_accents_upper(row[8]) in ('PREFEITO', 'VEREADOR')
                and not str(row[7]).strip().isdigit()):
            nm = str(row[1]).strip()
            code = name_to_code.get(slugify(nm)) or name_to_code.get(loose_slug(nm))
            if not code:
                continue
            cdmun = int(code)
            mode = 'prefeito' if strip_accents_upper(row[8]) == 'PREFEITO' else 'vereador'
            try:
                num = str(int(row[4]))
            except (TypeError, ValueError):
                continue
            full = str(row[6]).strip()
            urna = str(row[7]).strip()
            sigla = str(row[10]).strip()
            try:
                t = int(row[0]); turno = t if t in (1, 2) else 1
            except (TypeError, ValueError):
                turno = 1
            try:
                qt = int(str(row[11]).strip())
            except (TypeError, ValueError):
                qt = None
            key = (cdmun, num)
            if key not in meta:
                meta[key] = {'urna': urna or full, 'full': full, 'sigla': sigla,
                             'status': '', 'colig': '', 'colig_seq': '', '_turno': turno}
            if qt is not None:
                votes[(cdmun, mode)][turno][num] += qt
            names.setdefault(cdmun, nm)
            continue

        if len(row) < 13:
            continue
        # localiza DS_CARGO
        c = None
        for i in range(10, len(row)):
            up = strip_accents_upper(row[i])
            if up in ('PREFEITO', 'VEREADOR'):
                c = i
                break
        if c is None:
            continue
        mode = 'prefeito' if strip_accents_upper(row[c]) == 'PREFEITO' else 'vereador'
        try:
            cdmun = int(row[7])
            num = str(int(row[11]))
        except (TypeError, ValueError):
            continue

        # nome / urna: urna = c-1; full = c-2 se for textual
        urna = str(row[c - 1]).strip()
        prev = str(row[c - 2]).strip() if c - 2 >= 0 else ''
        full = prev if re.search(r'[A-Za-zÀ-ÿ]', prev) and prev != '-1' else urna

        suffix_len = len(row) - 1 - c
        status, sigla, colig, colig_seq = '', '', '', ''
        if suffix_len >= 12:  # esquema completo
            status = str(row[c + 6]).strip()
            sigla = str(row[c + 8]).strip()
            colig_seq = str(row[c + 10]).strip()
            colig = str(row[c + 11]).strip()
        else:  # esquema reduzido (sem urna/status/coligacao)
            if c + 2 < len(row):
                sigla = str(row[c + 2]).strip()
            full = urna

        if colig_seq in ('', '-1', '#NE#', '-3', '-3.0') or colig in ('#NULO#', 'NULO'):
            colig_seq = ''
            colig = ''
        try:
            turno = int(row[3])
        except (TypeError, ValueError):
            turno = 0
        key = (cdmun, num)
        prev = meta.get(key)
        # mantem o registro do turno mais alto (status final: ELEITO/NAO ELEITO)
        if prev is not None and turno < prev.get('_turno', -1):
            continue
        meta[key] = {
            'urna': urna or full,
            'full': full,
            'sigla': sigla or (prev.get('sigla') if prev else ''),
            'status': normalize_status(status),
            'colig': colig if colig not in ('#NE#', '-1', '#NULO#', 'NULO') else '',
            'colig_seq': colig_seq,
            '_turno': turno,
        }

        # Totais municipais (soma das zonas) por turno, para preencher lacunas
        try:
            qt = int(str(row[-1]).strip())
        except (TypeError, ValueError):
            qt = None
        if qt is not None and turno > 0:
            votes[(cdmun, mode)][turno][num] += qt
        names.setdefault(cdmun, str(row[8]).strip())
    return meta, votes, names


def normalize_status(raw):
    s = strip_accents_upper(raw)
    if not s or s in ('#NULO#', '#NE#', '-1'):
        return ''
    if any(k in s for k in INAPTO_KEYWORDS) and 'COM RECURSO' not in s:
        return 'INAPTO'
    if 'NAO ELEITO' in s:
        return 'NÃO ELEITO'
    if 'ELEITO' in s or s in ('MEDIA', 'MÉDIA'):
        if 'MEDIA' in s:
            return 'ELEITO POR MÉDIA'
        if 'QP' in s or 'QUOCIENTE' in s:
            return 'ELEITO POR QP'
        return 'ELEITO'
    if 'SUPLENTE' in s:
        return 'SUPLENTE'
    if '2' in s and 'TURNO' in s:
        return '2º TURNO'
    return raw.strip()


def normalize_comp(comp):
    if not comp:
        return ''
    parts = [strip_accents_upper(p) for p in comp.split('/') if p.strip()]
    return '/'.join(sorted(parts))


# ----------------------------------------------------------------------------
# Coligacoes e cand_names (compartilhado entre secao e preenchimento de lacuna)
# ----------------------------------------------------------------------------

def build_coalition_maps(munz_meta):
    """Reconstroi composicao por sequencial de coligacao a partir das siglas."""
    comp_by_seq = defaultdict(set)
    name_by_seq = {}
    party_to_seq = {}
    for cnum, inf in munz_meta.items():
        seq = inf.get('colig_seq') or ''
        if not seq:
            continue
        if inf.get('sigla'):
            comp_by_seq[seq].add(strip_accents_upper(inf['sigla']))
        if inf.get('colig'):
            name_by_seq.setdefault(seq, inf['colig'])
        if len(cnum) > 2:
            party_to_seq.setdefault(cnum[:2], seq)
    return comp_by_seq, name_by_seq, party_to_seq


def make_coal_of(munz_meta, party_map, maps):
    comp_by_seq, name_by_seq, party_to_seq = maps

    def coal_of(num):
        num = str(num)
        inf = munz_meta.get(num)
        seq = (inf.get('colig_seq') if inf else '') or ''
        if not seq and len(num) <= 2:
            seq = party_to_seq.get(num, '')
        if seq:
            comp = '/'.join(sorted(comp_by_seq.get(seq, set())))
            return (f'SEQ:{seq}', name_by_seq.get(seq, ''), comp)
        if inf and inf.get('sigla'):
            sig = inf['sigla']
        elif len(num) <= 2:
            sig = party_map.get(num, '')
        else:
            sig = party_map.get(party_from_number(num), '')
        sig = strip_accents_upper(sig)
        return (f'PARTY:{sig}', '', sig)
    return coal_of


def build_candnames_coalmap(num_name_pairs, munz_meta, party_map, mode):
    """num_name_pairs: lista de (num, nm_votavel). Retorna (cand_names, coal_map)."""
    coal_of = make_coal_of(munz_meta, party_map, build_coalition_maps(munz_meta))
    cand_names = {}
    coal_map = {}
    for nr, nm in num_name_pairs:
        num = str(nr)
        entry = cand_entry(nr, nm, munz_meta, party_map, mode)
        if mode == 'vereador' and num not in ('95', '96', '97'):
            ck, cname, comp = coal_of(num)
            coal_map[num] = (ck, cname, comp)
            entry[3] = cname or entry[3]
            entry[4] = comp or entry[4]
        cand_names[num] = entry
    cand_names.setdefault('95', ['VOTO BRANCO', '', 'BRANCO', '', ''])
    cand_names.setdefault('96', ['VOTO NULO', '', 'NULO', '', ''])
    return cand_names, coal_map


def apply_prefeito_status(cand_names, official_by_turno):
    """Status do prefeito computado dos totais quando o munzona nao traz (CE/PA/PR)."""
    if not official_by_turno:
        return
    last_turno = max(official_by_turno)
    nominal = sorted(
        ((cid, v) for cid, v in official_by_turno[last_turno].items()
         if cid not in ('95', '96', '97')),
        key=lambda x: -x[1])
    winner = nominal[0][0] if nominal else None
    for cid, entry in cand_names.items():
        if cid in ('95', '96', '97'):
            continue
        if entry[2] in ('', 'N/D'):
            entry[2] = 'ELEITO' if cid == winner else 'NÃO ELEITO'


# ----------------------------------------------------------------------------
# Leitura das secoes
# ----------------------------------------------------------------------------

def read_section_csv(uf, year):
    zip_path = os.path.join(SECOES_DIR, f'votacao_secao_{year}_{uf}.zip')
    if not os.path.exists(zip_path):
        # variantes de nome (ex.: "..._RN (1).zip")
        cands = [f for f in os.listdir(SECOES_DIR)
                 if f.startswith(f'votacao_secao_{year}_{uf}') and f.endswith('.zip')]
        if not cands:
            return None
        zip_path = os.path.join(SECOES_DIR, cands[0])
    with zipfile.ZipFile(zip_path) as zf:
        name = [n for n in zf.namelist() if n.lower().endswith('.csv')][0]
        usecols = ['NR_TURNO', 'CD_MUNICIPIO', 'NM_MUNICIPIO', 'NR_ZONA', 'NR_SECAO',
                   'CD_CARGO', 'NR_VOTAVEL', 'NM_VOTAVEL', 'QT_VOTOS', 'NR_LOCAL_VOTACAO']
        with zf.open(name) as fh:
            df = pd.read_csv(fh, sep=';', encoding='latin-1', dtype=str,
                             usecols=usecols, on_bad_lines='skip')
    for col in ('NR_TURNO', 'CD_MUNICIPIO', 'NR_ZONA', 'NR_SECAO', 'CD_CARGO',
                'QT_VOTOS', 'NR_LOCAL_VOTACAO'):
        df[col] = pd.to_numeric(df[col], errors='coerce')
    df = df.dropna(subset=['CD_MUNICIPIO', 'NR_ZONA', 'CD_CARGO', 'QT_VOTOS'])
    df['CD_MUNICIPIO'] = df['CD_MUNICIPIO'].astype(int)
    df['NR_ZONA'] = df['NR_ZONA'].astype(int)
    df['CD_CARGO'] = df['CD_CARGO'].astype(int)
    df['QT_VOTOS'] = df['QT_VOTOS'].astype(int)
    df['NR_VOTAVEL'] = df['NR_VOTAVEL'].fillna('').astype(str).str.replace(r'\.0$', '', regex=True)
    return df


# ----------------------------------------------------------------------------
# Construcao de cand_names e totais
# ----------------------------------------------------------------------------

def build_party_map(df_cargo):
    """{nr_partido(2 dig): sigla} a partir das legendas (NR_VOTAVEL de 2 digitos)."""
    pm = {}
    leg = df_cargo[df_cargo['NR_VOTAVEL'].str.len() <= 2]
    for nr, nm in leg[['NR_VOTAVEL', 'NM_VOTAVEL']].drop_duplicates().itertuples(index=False):
        pm[str(nr)] = str(nm).strip()
    return pm


def cand_entry(num, nm_votavel, munz_meta, party_map, mode):
    """Monta entrada cand_names[num] = [nome, sigla, status, colig, comp].
    Coligacao/composicao (idx 3/4) sao preenchidas depois por coal_of (vereador)."""
    num = str(num)
    if num == '95':
        return ['VOTO BRANCO', '', 'BRANCO', '', '']
    if num in ('96', '97'):
        return ['VOTO NULO', '', 'NULO', '', '']
    is_legenda = (mode == 'vereador') and len(num) <= 2
    info = munz_meta.get(num)
    if info and info.get('sigla'):
        sigla = info['sigla']
    elif is_legenda:
        sigla = party_map.get(num, str(nm_votavel).strip())
    else:
        sigla = party_map.get(party_from_number(num), '')
    if is_legenda:
        return ['', sigla, 'LEGENDA', '', '']
    if info:
        nome = info['urna'] or title_name(nm_votavel)
        status = info['status'] or 'N/D'
        if mode == 'prefeito' and status.startswith('ELEITO'):
            status = 'ELEITO'  # majoritaria nao tem QP/media
        return [nome, sigla, status, info.get('colig', ''), '']
    return [title_name(nm_votavel), sigla, 'N/D', '', '']


def summarize(raw_totals, include_legenda):
    total = brancos = nulos = 0
    for cid, v in raw_totals.items():
        v = int(v)
        if cid == '95':
            brancos += v
        elif cid in ('96', '97'):
            nulos += v
        elif not include_legenda and len(str(cid)) <= 2:
            continue
        else:
            total += v
    return {'totalValidos': total, 'brancos': brancos, 'nulos': nulos,
            'comparecimento': total + brancos + nulos}


# ----------------------------------------------------------------------------
# Processamento de um (uf, year)
# ----------------------------------------------------------------------------

def process_uf_year(uf, year, base, sec2local, report_rows, gap_rows):
    df = read_section_csv(uf, year)
    have_sections = df is not None and not df.empty

    canon_by_slug = base['canon_by_slug']
    canon_by_loose = base['canon_by_loose']

    def resolve_canon(nm):
        return canon_by_slug.get(slugify(nm)) or canon_by_loose.get(loose_slug(nm)) or str(nm).strip()

    # munzona: metadados + totais municipais (para preencher lacunas do TSE)
    munz_meta, mz_votes, mz_names = parse_munzona(uf, year, load_modern_name_to_code(uf))
    meta_by_mun = defaultdict(dict)
    for (cdmun, num), info in munz_meta.items():
        meta_by_mun[cdmun][num] = info

    name_by_cdmun = {}
    if have_sections:
        for cd, nm in df[['CD_MUNICIPIO', 'NM_MUNICIPIO']].drop_duplicates().itertuples(index=False):
            name_by_cdmun[int(cd)] = resolve_canon(nm)

        if year == 2000:
            df['LOCAL'] = [
                sec2local.get((uf, int(z), int(s)), -1)
                for z, s in zip(df['NR_ZONA'], df['NR_SECAO'].fillna(-1).astype(int))
            ]
        else:
            df['LOCAL'] = df['NR_LOCAL_VOTACAO'].fillna(-1).astype(int)

        pref = build_cargo(df, CD_PREFEITO, uf, year, base, meta_by_mun, name_by_cdmun, report_rows, mode='prefeito')
        vere = build_cargo(df, CD_VEREADOR, uf, year, base, meta_by_mun, name_by_cdmun, report_rows, mode='vereador')
    else:
        print(f'  {uf} {year}: sem dados de secao; usando apenas totais do munzona.')
        pref, vere = {}, {}

    # ---- Preenchimento de lacunas do TSE a partir dos totais do munzona ----
    fill_gaps_from_munzona(uf, year, pref, vere, mz_votes, mz_names, meta_by_mun,
                           resolve_canon, name_by_cdmun, gap_rows)

    return {'prefeito': pref, 'vereador': vere, 'name_by_cdmun': name_by_cdmun}


def build_gap_payload(cdmun, canon, mode, votes_by_turno, munz_meta):
    """Monta o payload de um municipio sem visao por local (RESULTS vazio),
    apenas com os totais municipais do munzona (resultado geral)."""
    party_map = {}
    for num, inf in munz_meta.items():
        if len(str(num)) <= 2 and inf.get('sigla'):
            party_map[str(num)] = inf['sigla']
    nums = set()
    for turno_votes in votes_by_turno.values():
        nums.update(turno_votes.keys())
    pairs = [(num, (munz_meta.get(num, {}).get('full') or '')) for num in sorted(nums)]
    cand_names, coal_map = build_candnames_coalmap(pairs, munz_meta, party_map, mode)

    official_by_turno = {int(t): dict(v) for t, v in votes_by_turno.items()}
    results_by_turno = {int(t): {} for t in votes_by_turno}  # sem visao por local
    if mode == 'prefeito':
        apply_prefeito_status(cand_names, official_by_turno)

    return {
        'slug': slugify(canon),
        'canon': canon,
        'cand_names': cand_names,
        'results_by_turno': results_by_turno,
        'official_by_turno': official_by_turno,
        'party_map': party_map,
        'munz_meta': munz_meta,
        'coal_map': coal_map,
        'gap': True,
    }


def fill_gaps_from_munzona(uf, year, pref, vere, mz_votes, mz_names, meta_by_mun,
                           resolve_canon, name_by_cdmun, gap_rows):
    """Adiciona municipios/turnos ausentes na secao usando os totais do munzona."""
    for (cdmun, mode), votes_by_turno in mz_votes.items():
        if not votes_by_turno:
            continue
        target = pref if mode == 'prefeito' else vere
        canon = name_by_cdmun.get(cdmun) or resolve_canon(mz_names.get(cdmun, str(cdmun)))
        name_by_cdmun.setdefault(cdmun, canon)
        munz_meta = meta_by_mun.get(cdmun, {})

        if cdmun not in target:
            # municipio inteiro ausente na secao -> cria do zero (sem local)
            target[cdmun] = build_gap_payload(cdmun, canon, mode, votes_by_turno, munz_meta)
            gap_rows.append({'UF': uf, 'Ano': year, 'CD_Municipio': cdmun, 'Municipio': canon,
                             'Cargo': mode, 'Tipo': 'MUNICIPIO_AUSENTE_NA_SECAO',
                             'Detalhe': 'Totais do munzona; sem visao por local'})
        elif mode == 'prefeito':
            # municipio existe mas pode faltar um turno (ex.: 2o turno)
            existing = target[cdmun]
            existing_turnos = set(existing['official_by_turno'])
            for t, tv in votes_by_turno.items():
                if int(t) in existing_turnos or not tv:
                    continue
                existing['official_by_turno'][int(t)] = dict(tv)
                existing['results_by_turno'][int(t)] = {}
                # garante que os candidatos do turno extra estejam em cand_names
                for num in tv:
                    if num not in existing['cand_names']:
                        e = cand_entry(num, munz_meta.get(num, {}).get('full') or '', munz_meta, {}, 'prefeito')
                        existing['cand_names'][num] = e
                apply_prefeito_status(existing['cand_names'], existing['official_by_turno'])
                gap_rows.append({'UF': uf, 'Ano': year, 'CD_Municipio': cdmun, 'Municipio': canon,
                                 'Cargo': mode, 'Tipo': f'TURNO_{int(t)}_AUSENTE_NA_SECAO',
                                 'Detalhe': 'Turno preenchido com totais do munzona; sem visao por local'})


def build_cargo(df, cargo, uf, year, base, meta_by_mun, name_by_cdmun, report_rows, mode):
    dfc = df[df['CD_CARGO'] == cargo].copy()
    if dfc.empty:
        return {}
    party_map_global = build_party_map(dfc)
    geo_keys = base['geo_keys']

    out = {}  # cdmun -> payload dict
    for cdmun, dmun in dfc.groupby('CD_MUNICIPIO'):
        cdmun = int(cdmun)
        canon = name_by_cdmun.get(cdmun, str(cdmun))
        slug = slugify(canon)
        munz_meta = meta_by_mun.get(cdmun, {})
        party_map = build_party_map(dmun) or party_map_global

        # cand_names + coal_map (uniao de todos os numeros do municipio)
        pairs = list(dmun[['NR_VOTAVEL', 'NM_VOTAVEL']].drop_duplicates().itertuples(index=False, name=None))
        cand_names, coal_map = build_candnames_coalmap(pairs, munz_meta, party_map, mode)

        # ---- deteccao de zonas problematicas (uma vez por municipio; so no prefeito p/ nao duplicar)
        if mode == 'prefeito':
            detect_problematic_zones(uf, year, cdmun, canon, slug, dmun, base, report_rows)

        # ---- RESULTS (geolocalizado) por turno
        turnos = sorted(int(t) for t in dmun['NR_TURNO'].dropna().unique())
        payload_by_turno = {}
        official_by_turno = {}
        for turno in turnos:
            dt = dmun[dmun['NR_TURNO'] == turno]
            # RESULTS: so secoes que geolocalizam
            results = defaultdict(lambda: defaultdict(int))
            for zona, local, num, votos in dt[['NR_ZONA', 'LOCAL', 'NR_VOTAVEL', 'QT_VOTOS']].itertuples(index=False):
                if local is None or int(local) < 0:
                    continue
                if (int(zona), int(local)) not in geo_keys:
                    continue
                if mode == 'prefeito':
                    key = f'{int(zona)}_{cdmun}_{int(local)}'
                else:
                    key = f'{int(zona)}_{int(local)}'
                results[key][str(num)] += int(votos)
            results = {k: dict(v) for k, v in results.items()}

            # TOTAIS COMPLETOS (todas as secoes) -> resultado geral
            full = defaultdict(int)
            for num, votos in dt.groupby('NR_VOTAVEL')['QT_VOTOS'].sum().items():
                full[str(num)] += int(votos)
            payload_by_turno[turno] = results
            official_by_turno[turno] = dict(full)

        # Status do prefeito computado dos totais quando o munzona nao traz (CE/PA/PR).
        if mode == 'prefeito':
            apply_prefeito_status(cand_names, official_by_turno)

        out[cdmun] = {
            'slug': slug,
            'canon': canon,
            'cand_names': cand_names,
            'results_by_turno': payload_by_turno,
            'official_by_turno': official_by_turno,
            'party_map': party_map,
            'munz_meta': munz_meta,
            'coal_map': coal_map,
        }
    return out


def detect_problematic_zones(uf, year, cdmun, canon, slug, dmun, base, report_rows):
    """Registra zonas inteiras sem geolocalizacao (nao locais isolados)."""
    geo_keys = base['geo_keys']
    zonas_uf = base['zonas_uf']
    mun_by_zona = base['mun_by_zona']
    zonas_by_mun = base['zonas_by_mun']

    total_mun = int(dmun['QT_VOTOS'].sum()) or 1
    for zona, dz in dmun.groupby('NR_ZONA'):
        zona = int(zona)
        # algum local desta (mun,zona) geolocaliza?
        geoloc = False
        for local in dz['LOCAL'].unique():
            try:
                local = int(local)
            except (TypeError, ValueError):
                continue
            if local >= 0 and (zona, local) in geo_keys:
                geoloc = True
                break
        if geoloc:
            continue  # zona ok (ignora locais isolados criados/extintos)

        votos = int(dz['QT_VOTOS'].sum())
        if zona not in zonas_uf:
            tipo, detalhe = 'ZONA_INEXISTENTE_2006', 'Zona ausente na base 2006 da UF'
        elif slug not in zonas_by_mun:
            tipo = 'MUNICIPIO_INEXISTENTE_2006'
            detalhe = 'Municipio nao encontrado na base 2006 (nome/criacao)'
        else:
            donos = sorted(s for s in mun_by_zona.get(zona, set()) if s != slug)
            if donos:
                tipo = 'ZONA_EM_OUTRO_MUNICIPIO_2006'
                detalhe = 'Zona vinculada em 2006 a: ' + ', '.join(
                    base['canon_by_slug'].get(s, s) for s in donos[:5])
            else:
                tipo = 'MUNICIPIO_SEM_ZONA_2006'
                detalhe = 'Municipio existe em 2006 mas sem esta zona'
        report_rows.append({
            'UF': uf, 'Ano': year, 'CD_Municipio': cdmun, 'Municipio': canon,
            'Zona': zona, 'Tipo_Problema': tipo, 'Detalhe': detalhe,
            'Votos_Afetados': votos,
            'Pct_Votos_Municipio': round(100.0 * votos / total_mun, 2),
        })


# ----------------------------------------------------------------------------
# Escrita: prefeito (zips por turno) e vereador (zip + official_totals)
# ----------------------------------------------------------------------------

def write_prefeito(uf, year, pref):
    out_dir = os.path.join(GEO_DIR, f'Municipais {year}')
    os.makedirs(out_dir, exist_ok=True)
    # agrupa por turno -> lista de (filename, payload)
    by_turno = defaultdict(list)
    for cdmun, info in pref.items():
        for turno, results in info['results_by_turno'].items():
            # official_summary completo
            official = {}
            raw = info['official_by_turno'][turno]
            votes_by_key = {}
            for cid, v in raw.items():
                if cid in ('95', '96', '97'):
                    continue
                m = info['cand_names'].get(cid)
                if not m:
                    continue
                disp = f"{m[0] or ('Candidato ' + cid)} ({m[1] or '?'}) ({m[2] or 'N/D'}) {turno}T"
                votes_by_key[disp] = int(v)
            summ = summarize(raw, include_legenda=True)
            official = {'votesByDisplayKey': votes_by_key, 'rawTotals': raw, **summ}

            payload = {
                'METADATA': {
                    'cand_names': info['cand_names'],
                    'cd_municipio': str(cdmun),
                    'coalition_adjustments': {},
                    'official_summary': {f'{turno}T': official},
                },
                'RESULTS': results,
            }
            fname = f"{cdmun}_{info['slug']}.json"
            by_turno[turno].append((fname, payload))

    for turno, items in by_turno.items():
        zip_path = os.path.join(out_dir, f'prefeito_{year}_ord_t{turno}_{uf}.zip')
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for fname, payload in items:
                zf.writestr(fname, json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
        print(f'    prefeito t{turno} {uf}: {len(items)} municipios -> {os.path.basename(zip_path)}')


def compute_qe(votos_validos, vagas):
    """QE = votos validos / vagas, fracao >= 0,5 arredonda p/ cima (art.106 CE)."""
    if not vagas:
        return 0
    import math
    q = votos_validos / vagas
    frac = q - math.floor(q)
    return int(math.floor(q) + (1 if frac >= 0.5 else 0))


def write_vereador(uf, year, vere, official_totals):
    out_dir = os.path.join(GEO_DIR, f'Municipais_Legislativas {year}')
    os.makedirs(out_dir, exist_ok=True)
    zip_path = os.path.join(out_dir, f'vereadores_{year}_{uf}.zip')

    uf_totals = {}
    count = 0
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for cdmun, info in vere.items():
            results = info['results_by_turno'].get(1, {})
            # Totais COMPLETOS por candidato (todas as secoes/zonas, inclusive sem
            # geolocalizacao) — usados no "resultado geral" da sidebar quando nao
            # ha dados por local (municipios do munzona) ou para corrigir o total.
            official_votes = {str(k): int(v) for k, v in info['official_by_turno'].get(1, {}).items()}
            payload = {
                'METADATA': {
                    'cand_names': info['cand_names'],
                    'cd_municipio': str(cdmun),
                    'coalition_adjustments': {},
                    'official_votes': official_votes,
                },
                'RESULTS': results,
            }
            fname = f"vereadores_{year}_{uf}_{info['slug']}_{cdmun}.json"
            zf.writestr(fname, json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
            count += 1

            uf_totals[info['slug']] = build_vereador_official(info)
    official_totals[uf] = uf_totals
    print(f'    vereador {uf}: {count} municipios -> {os.path.basename(zip_path)}')


def build_vereador_official(info):
    """Totais oficiais completos por coligacao + QE/vagas (art.106-109 CE 2000/04)."""
    raw = info['official_by_turno'].get(1, {})
    cand_names = info['cand_names']
    coal_map = info.get('coal_map', {})

    # votos validos = nominais + legenda (exclui 95/96/97)
    votos_validos = sum(int(v) for cid, v in raw.items() if cid not in ('95', '96', '97'))

    coal_votes = defaultdict(int)
    coal_comp = {}
    coal_elected = defaultdict(int)
    for cid, v in raw.items():
        if cid in ('95', '96', '97'):
            continue
        ck, cname, comp = coal_map.get(cid, (None, '', ''))
        m = cand_names.get(cid, ['', '', '', '', ''])
        if not ck:
            ck = f'PARTY:{strip_accents_upper(m[1])}'
            comp = strip_accents_upper(m[1])
        coal_votes[ck] += int(v)
        coal_comp.setdefault(ck, normalize_comp(comp) or comp or m[1])
        # eleito por candidato nominal com status oficial
        st = strip_accents_upper(m[2])
        if len(str(cid)) > 2 and 'ELEITO' in st and 'NAO' not in st:
            coal_elected[ck] += 1

    qt_vagas = sum(coal_elected.values())  # nº de cadeiras = eleitos oficiais
    vr_qe = compute_qe(votos_validos, qt_vagas) if qt_vagas else 0

    coalitions = []
    for ck, votes in sorted(coal_votes.items(), key=lambda x: -x[1]):
        elected = coal_elected.get(ck, 0)
        vagas_qp = (votes // vr_qe) if vr_qe else 0
        el_qp = min(vagas_qp, elected)
        comp_id = coal_comp.get(ck, ck)
        coalitions.append({
            'id': comp_id,
            'raw_comp': comp_id,
            'votes': int(votes),
            'elected': int(elected),
            'elected_qp': int(el_qp),
            'elected_avg': int(max(0, elected - el_qp)),
            'vagas_qp': int(vagas_qp),
        })

    return {
        'stats': {
            'qt_vagas': int(qt_vagas),
            'vr_qe': int(vr_qe),
            'qt_votos_validos': int(votos_validos),
        },
        'coalitions': coalitions,
    }


# ----------------------------------------------------------------------------
# Indices do site
# ----------------------------------------------------------------------------

def update_lista_municipios(names_by_uf):
    path = os.path.join(BASE_DIR, 'lista_municipios.json')
    lista = {}
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            lista = json.load(f)
    for uf, names in names_by_uf.items():
        cur = set(lista.get(uf, []))
        cur.update(names)
        lista[uf] = sorted(cur)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(lista, f, ensure_ascii=False, indent=2)
    print(f'  lista_municipios.json atualizado.')


def write_report(report_rows):
    cols = ['UF', 'Ano', 'CD_Municipio', 'Municipio', 'Zona', 'Tipo_Problema',
            'Detalhe', 'Votos_Afetados', 'Pct_Votos_Municipio']
    report_rows.sort(key=lambda r: (r['UF'], r['Ano'], r['Municipio'], r['Zona']))
    with open(REPORT_CSV, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(report_rows)
    print(f'\n  Relatorio de zonas problematicas: {len(report_rows)} linhas -> {REPORT_CSV}')


def write_gaps(gap_rows):
    cols = ['UF', 'Ano', 'CD_Municipio', 'Municipio', 'Cargo', 'Tipo', 'Detalhe']
    gap_rows.sort(key=lambda r: (r['UF'], r['Ano'], r['Municipio'], r['Cargo']))
    with open(GAPS_CSV, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(gap_rows)
    print(f'  Lacunas preenchidas via munzona: {len(gap_rows)} linhas -> {GAPS_CSV}')


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--years', default='2000,2004')
    ap.add_argument('--ufs', default=','.join(ALL_UFS))
    args = ap.parse_args()
    years = [int(y) for y in args.years.split(',') if y.strip()]
    ufs = [u.strip().upper() for u in args.ufs.split(',') if u.strip()]

    report_rows = []
    gap_rows = []
    names_by_uf = defaultdict(set)

    for year in years:
        print(f'\n{"="*60}\nANO {year}\n{"="*60}')
        sec2local = load_section_to_local_2006(ufs) if year == 2000 else {}
        official_totals_ver = {}
        for uf in ufs:
            print(f'\n[{uf} {year}]')
            base = load_gpkg_uf(uf)
            data = process_uf_year(uf, year, base, sec2local, report_rows, gap_rows)
            if not data:
                continue
            if data['prefeito']:
                write_prefeito(uf, year, data['prefeito'])
            if data['vereador']:
                write_vereador(uf, year, data['vereador'], official_totals_ver)
            for cd, nm in data['name_by_cdmun'].items():
                names_by_uf[uf].add(nm)

        # official_totals_vereadores_{year}.json
        if official_totals_ver:
            out_dir = os.path.join(GEO_DIR, f'Municipais_Legislativas {year}')
            os.makedirs(out_dir, exist_ok=True)
            with open(os.path.join(out_dir, f'official_totals_vereadores_{year}.json'),
                      'w', encoding='utf-8') as f:
                json.dump(official_totals_ver, f, ensure_ascii=False, separators=(',', ':'))
            print(f'  official_totals_vereadores_{year}.json salvo ({len(official_totals_ver)} UFs).')

    update_lista_municipios(names_by_uf)
    write_report(report_rows)
    write_gaps(gap_rows)
    print('\nCONCLUIDO.')


if __name__ == '__main__':
    main()
