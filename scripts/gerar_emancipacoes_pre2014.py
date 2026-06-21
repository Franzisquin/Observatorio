"""
Reatribuicao por SECAO ELEITORAL: nas eleicoes nacionais pre-2014, cidades que
ainda nao existiam tinham os votos sob o municipio-pai. Identificamos as SECOES
ELEITORAIS de cada cidade na ELEICAO MAIS ANTIGA em que ela ja existia (arquivos
brutos de 2000/2004 etc.) e PUXAMOS essas mesmas (zona, secao) do arquivo bruto
do ano-alvo, somando os votos -> resultado da cidade naquele ano. O numero da
secao + zona e o identificador estavel (o nome do local ou o numero do local nao
sao confiaveis).

Exemplo: Arroio do Padre-RS em 2000 tem as secoes da zona 60; em 1998 essas mesmas
(zona 60, secoes) estavam sob Pelotas -> somando-as temos o resultado de Arroio
do Padre em 1998.

Saidas: resultados_geo/emancipacoes_pre2014.json (+ _revisao.csv).

Fontes de dados brutos (votacao por secao):
  1998: ../Resultados 1998/votacao_secao_1998_{UF}.zip  (gov/sen/dep)
        ../Resultados 1998/votacao_secao-municipio_1998_{uf}_presidente.csv.zip
  2000/2004 (identidade): Resultados 2000-2004/votacao_secao_{ano}_{UF}.zip
  2002: Resultados 2002/votacao_secao_2002_{UF}.parquet (+ presidente externo)
  2006/2010: E:/Mapas/Dados/votacao_secao_{ano}_{UF}.(csv|zip)  (faltantes: TSE)

Uso:
  py scripts/gerar_emancipacoes_pre2014.py --years 1998 --ufs RS
  py scripts/gerar_emancipacoes_pre2014.py
"""

import argparse
import csv
import io
import json
import os
import unicodedata
import zipfile
from collections import defaultdict, Counter

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO_DIR = os.path.join(BASE_DIR, 'resultados_geo')
PARENT_DIR = os.path.dirname(BASE_DIR)
RES1998 = os.path.join(PARENT_DIR, 'Resultados 1998')
RES2002 = os.path.join(BASE_DIR, 'Resultados 2002')
RES0004 = os.path.join(BASE_DIR, 'Resultados 2000-2004')
EXT_DIR = r'E:\Mapas\Dados'
OUT_JSON = os.path.join(GEO_DIR, 'emancipacoes_pre2014.json')
OUT_CSV = os.path.join(GEO_DIR, 'emancipacoes_pre2014_revisao.csv')

ALL_UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS',
           'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC',
           'SE', 'SP', 'TO']

# Anos cujas eleicoes recebem a correcao (nacionais pre-2014).
TARGET_YEARS = ['1998', '2002', '2006', '2010']
# Anos brutos usados para descobrir as SECOES de cada cidade (ordem crescente:
# usa-se a eleicao MAIS ANTIGA em que a cidade ja aparece com codigo proprio).
# 2000/2004 (repo) cobrem a onda de 1996-2001; 2008/2012 cobrem criadas ate 2011.
IDENTITY_YEARS = ['2000', '2004', '2008', '2012']

# Casos NAO monotonicos (existiram, sumiram e voltaram). A regra "1a municipal >
# ano-alvo" nao os pega; aqui forcamos a candidatura nos anos em que estavam
# ausentes, usando as secoes do ano de identidade indicado.
# Pinto Bandeira-RS (89540): emancipada 2000, votou em 2002, anulada pela Justica
# (vazia em 2006 e 2010), recriada em 2012.
SPECIAL_NONMONO = {
    ('RS', '89540'): {'force_years': {'2006', '2010'}, 'identity_year': '2012'},
}

CARGO_BY_DS = {
    'PRESIDENTE': 'presidente', 'GOVERNADOR': 'governador', 'SENADOR': 'senador',
    'DEPUTADO FEDERAL': 'deputado_federal', 'DEPUTADO ESTADUAL': 'deputado_estadual',
}


def norm(s):
    s = unicodedata.normalize('NFD', str(s or ''))
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return ' '.join(s.upper().split())


# ---------------------------------------------------------------------------
# Leitor generico de arquivos de votacao por secao (header-driven, case-insensitive)
# ---------------------------------------------------------------------------

def _csv_rows(text):
    rdr = csv.reader(io.StringIO(text), delimiter=';')
    header = [h.strip().lower() for h in next(rdr)]
    idx = {h: i for i, h in enumerate(header)}
    for row in rdr:
        yield row, idx


def _emit(row, idx):
    """Normaliza uma linha -> dict padrao ou None."""
    def g(*names):
        for n in names:
            i = idx.get(n)
            if i is not None and i < len(row):
                return row[i]
        return ''
    try:
        zona = int(g('nr_zona'))
        secao = int(g('nr_secao'))
    except (TypeError, ValueError):
        return None
    ds = norm(g('ds_cargo'))
    cargo = CARGO_BY_DS.get(ds)
    if cargo is None:
        cd = g('cd_cargo')
        cargo = {'1': 'presidente', '3': 'governador', '5': 'senador',
                 '6': 'deputado_federal', '7': 'deputado_estadual'}.get(cd)
    try:
        votos = int(g('qt_votos') or 0)
    except ValueError:
        votos = 0
    return {
        'cd_mun': str(g('cd_municipio')).strip(),
        'nm_mun': g('nm_municipio'),
        'zona': zona, 'secao': secao, 'cargo': cargo,
        'turno': str(g('nr_turno') or '1').strip(),
        'votavel': str(g('nr_votavel')).strip(),
        'votos': votos,
        'comparecimento': g('qt_comparecimento'),
    }


def _read_zip_csv(path):
    with zipfile.ZipFile(path) as z:
        member = [n for n in z.namelist() if n.lower().endswith(('.csv', '.txt'))][0]
        text = z.read(member).decode('latin-1')
    for row, idx in _csv_rows(text):
        r = _emit(row, idx)
        if r:
            yield r


def _read_plain_csv(path):
    with open(path, encoding='latin-1') as f:
        text = f.read()
    for row, idx in _csv_rows(text):
        r = _emit(row, idx)
        if r:
            yield r


def _read_parquet(path):
    import pandas as pd
    cols = ['CD_MUNICIPIO', 'NM_MUNICIPIO', 'NR_ZONA', 'NR_SECAO', 'DS_CARGO',
            'CD_CARGO', 'NR_TURNO', 'NR_VOTAVEL', 'QT_VOTOS']
    df = pd.read_parquet(path)
    have = [c for c in cols if c in df.columns]
    for t in df[have].itertuples(index=False):
        d = dict(zip(have, t))
        ds = norm(d.get('DS_CARGO'))
        cargo = CARGO_BY_DS.get(ds) or {'1': 'presidente', '3': 'governador',
            '5': 'senador', '6': 'deputado_federal', '7': 'deputado_estadual'}.get(str(d.get('CD_CARGO')))
        try:
            zona = int(d['NR_ZONA']); secao = int(d['NR_SECAO'])
        except (TypeError, ValueError, KeyError):
            continue
        yield {'cd_mun': str(d.get('CD_MUNICIPIO')).strip(),
               'nm_mun': d.get('NM_MUNICIPIO'), 'zona': zona, 'secao': secao,
               'cargo': cargo, 'turno': str(d.get('NR_TURNO') or '1').strip(),
               'votavel': str(d.get('NR_VOTAVEL')).strip(),
               'votos': int(d.get('QT_VOTOS') or 0), 'comparecimento': ''}


def _first_existing(*paths):
    for p in paths:
        if p and os.path.exists(p):
            return p
    return None


def raw_section_rows(year, uf):
    """Itera as linhas de votacao por secao de (year, uf), de todas as fontes."""
    uf = uf.upper()
    if year == '1998':
        main = os.path.join(RES1998, f'votacao_secao_1998_{uf}.zip')
        if os.path.exists(main):
            yield from _read_zip_csv(main)
        pres = os.path.join(RES1998, f'votacao_secao-municipio_1998_{uf.lower()}_presidente.csv.zip')
        if os.path.exists(pres):
            yield from _read_zip_csv(pres)
        return
    if year in ('2000', '2004'):
        p = os.path.join(RES0004, f'votacao_secao_{year}_{uf}.zip')
        if os.path.exists(p):
            yield from _read_zip_csv(p)
        return
    if year == '2002':
        # gov/sen/dep do parquet do repo. PRESIDENTE 2002 nao esta nos arquivos
        # por UF (e nacional, arquivo BR) -> preenchido depois por fill_2002_presidente.
        p = os.path.join(RES2002, f'votacao_secao_2002_{uf}.parquet')
        if os.path.exists(p):
            yield from _read_parquet(p)
        return
    # 2006, 2008, 2010, 2012, 2014 -> fonte externa (E:) ou TSE (cache scratch)
    ext = _first_existing(os.path.join(EXT_DIR, f'votacao_secao_{year}_{uf}.csv'),
                          os.path.join(EXT_DIR, f'votacao_secao_{year}_{uf}.zip'))
    if ext:
        yield from (_read_plain_csv(ext) if ext.endswith('.csv') else _read_zip_csv(ext))
        return
    tse = _ensure_tse(year, uf)
    if tse:
        yield from _read_zip_csv(tse)


_TSE_DIR = os.path.join(BASE_DIR, 'scratch', 'secoes_tse')


def _ensure_tse(year, uf):
    """Baixa votacao_secao_{ano}_{UF}.zip do CDN do TSE (cache em scratch)."""
    os.makedirs(_TSE_DIR, exist_ok=True)
    dest = os.path.join(_TSE_DIR, f'votacao_secao_{year}_{uf}.zip')
    if os.path.exists(dest):
        return dest
    import urllib.request
    url = (f'https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_secao/'
           f'votacao_secao_{year}_{uf}.zip')
    try:
        print(f'    baixando TSE {year} {uf} ...')
        urllib.request.urlretrieve(url, dest)
        return dest
    except Exception as e:
        print(f'    [FALHA TSE {year} {uf}] {e}')
        if os.path.exists(dest):
            os.remove(dest)
        return None


# ---------------------------------------------------------------------------
# Identidade: codigo do municipio -> conjunto de (zona, secao)
# ---------------------------------------------------------------------------

_IDENT_CACHE = {}


def build_section_identity(uf, id_years=None):
    """{cd_mun: {'secs': set((zona,secao)), 'nome', 'ano'}} pela eleicao mais antiga."""
    id_years = id_years or IDENTITY_YEARS
    ck = (uf, tuple(id_years))
    if ck in _IDENT_CACHE:
        return _IDENT_CACHE[ck]
    ident = {}
    for year in id_years:
        rows_seen = False
        secs = defaultdict(set)
        names = {}
        for r in raw_section_rows(year, uf):
            rows_seen = True
            if not r['cd_mun']:
                continue
            secs[r['cd_mun']].add((r['zona'], r['secao']))
            names.setdefault(r['cd_mun'], r['nm_mun'])
        if not rows_seen:
            continue
        for cd, ss in secs.items():
            e = ident.get(cd)
            if e is None:
                e = {'secs': ss, 'nome': names.get(cd, ''), 'ano': year,
                     'secs_by_year': {}}
                ident[cd] = e
            e['secs_by_year'][year] = ss
    _IDENT_CACHE[ck] = ident
    return ident


# ---------------------------------------------------------------------------
# Indexacao do ano-alvo: por (zona, secao) -> municipio dono + votos por cargo
# ---------------------------------------------------------------------------

def index_target_year(year, uf):
    """((zona,secao) -> {cd_mun: {(cargo,turno): {votavel: votos}}}, present_codes)."""
    by_sec = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: defaultdict(int))))
    present = set()
    for r in raw_section_rows(year, uf):
        if not r['cargo'] or not r['cd_mun']:
            continue
        present.add(r['cd_mun'])
        by_sec[(r['zona'], r['secao'])][r['cd_mun']][(r['cargo'], r['turno'])][r['votavel']] += r['votos']
    return by_sec, present


_MUNI_IBGE_CACHE = {}


def load_muni_ibge(uf):
    if uf in _MUNI_IBGE_CACHE:
        return _MUNI_IBGE_CACHE[uf]
    path = os.path.join(GEO_DIR, 'municipios', f'municipios_{uf}.geojson')
    mapping = {}
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        for feat in data.get('features', []):
            pr = feat.get('properties', {})
            mapping[norm(pr.get('NM_MUN'))] = pr.get('CD_MUN')
    _MUNI_IBGE_CACHE[uf] = mapping
    return mapping


# ---------------------------------------------------------------------------
# Deteccao + soma
# ---------------------------------------------------------------------------

def detect(years, ufs):
    out = {'_meta': {'mecanismo': 'soma das SECOES ELEITORAIS da cidade (identidade pela eleicao mais antiga) puxadas do arquivo bruto do ano-alvo'},
           'anos': {}}
    csv_rows = []
    catalog = []  # cidades AUSENTES por ano (existam ou nao secoes p/ reatribuir)
    for uf in ufs:
        ident = build_section_identity(uf)
        if not ident:
            continue
        ibge_map = load_muni_ibge(uf)
        for year in years:
            if year not in TARGET_YEARS:
                continue
            # So PODE estar ausente em 'year' a cidade cuja PRIMEIRA eleicao
            # municipal (ano de identidade) e POSTERIOR a 'year'. Se nenhuma
            # cidade da UF se enquadra, nao ha o que corrigir nesse ano -> NAO
            # baixa/processa o arquivo bruto desse ano (ex.: UF com municipios
            # ausentes apenas em 1998 nao toca 2002/2006/2010).
            yi = int(year)
            candidatas = {cd: info for cd, info in ident.items() if int(info['ano']) > yi}
            # Casos nao monotonicos (ex.: Pinto Bandeira anulada): forca candidatura
            # nos anos de ausencia usando as secoes do ano de identidade indicado.
            for (suf, scode), spec in SPECIAL_NONMONO.items():
                if suf != uf or year not in spec['force_years']:
                    continue
                info = ident.get(scode)
                if not info:
                    continue
                secs = info.get('secs_by_year', {}).get(spec['identity_year'])
                if secs:
                    candidatas[scode] = dict(info, secs=secs, ano=spec['identity_year'])
            if not candidatas:
                continue
            by_sec, present = index_target_year(year, uf)
            if not by_sec:
                continue
            for cd, info in candidatas.items():
                if cd in present:
                    continue  # existia mesmo (instalada entre a municipal e a geral)
                nome = info['nome'] or ''
                cd_ibge = ibge_map.get(norm(nome))
                # secoes da cidade que existem no ano-alvo
                sec_hits = [s for s in info['secs'] if s in by_sec]
                if not sec_hits:
                    catalog.append([year, uf, cd, nome, cd_ibge, info['ano'],
                                    'AUSENTE_SEM_SECOES', 0])
                    continue
                # por_pai[owner][cargo][turno][votavel] = votos (para subtrair do pai)
                por_pai = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: defaultdict(int))))
                parents = Counter()
                used_secs = []
                ambiguous = 0
                for (zona, secao) in sec_hits:
                    owners = by_sec[(zona, secao)]
                    # (zona, secao) deve pertencer a UM unico municipio no ano-alvo.
                    # Numeros de secao se repetem entre municipios da mesma zona;
                    # quando ha mais de um dono, e ambiguo -> descarta (nao atribui).
                    if len(owners) != 1:
                        ambiguous += 1
                        continue
                    owner = next(iter(owners))
                    parents[owner] += 1
                    used_secs.append((zona, secao, owner))
                    for (cargo, turno), votos in owners[owner].items():
                        for votavel, q in votos.items():
                            por_pai[owner][cargo][turno][votavel] += q
                if not por_pai:
                    catalog.append([year, uf, cd, nome, cd_ibge, info['ano'],
                                    'AUSENTE_SO_AMBIGUAS', 0])
                    continue
                # total da cidade (soma dos pais) por cargo/turno
                resultados = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
                for owner, cgs in por_pai.items():
                    for cargo, turnos in cgs.items():
                        for turno, vv in turnos.items():
                            for votavel, q in vv.items():
                                resultados[cargo][turno][votavel] += q
                catalog.append([year, uf, cd, nome, cd_ibge, info['ano'],
                                'REATRIBUIDO', len(used_secs)])
                parents_sorted = [p for p, _ in parents.most_common()]
                entry = {
                    'cd_tse': cd, 'nome': nome, 'cd_ibge': cd_ibge,
                    'parents': parents_sorted,
                    'revisar': len(parents_sorted) > 1,
                    'identidade_ano': info['ano'],
                    'n_secoes': len(used_secs),
                    'n_secoes_ambiguas': ambiguous,
                    'secoes': sorted([[z, s] for z, s, _ in used_secs]),
                    'resultados': {cg: {t: dict(v) for t, v in turnos.items()}
                                   for cg, turnos in resultados.items()},
                    'por_pai': {ow: {cg: {t: dict(v) for t, v in turnos.items()}
                                     for cg, turnos in cgs.items()}
                                for ow, cgs in por_pai.items()},
                }
                out['anos'].setdefault(year, {}).setdefault(uf, []).append(entry)
                pres = entry['resultados'].get('presidente', {}).get('1', {})
                csv_rows.append([year, uf, nome, cd, cd_ibge,
                                 ';'.join(parents_sorted), len(used_secs),
                                 sum(pres.values()), info['ano'],
                                 'SIM' if entry['revisar'] else ''])
            print(f'  {year} {uf}: {len(out["anos"].get(year, {}).get(uf, []))} cidades')
    return out, csv_rows, catalog


def fill_national_presidente(out, year):
    """Preenche o PRESIDENTE de 2002/2006/2010 (arquivo nacional BR, presidente-only)
    nas cidades detectadas, com UMA varredura dirigida apenas as secoes alvo.
    (1998 tem presidente em arquivo proprio por UF; nao precisa disto.)"""
    per = out['anos'].get(year)
    if not per:
        return
    br = _first_existing(os.path.join(EXT_DIR, f'votacao_secao_{year}_BR.csv'),
                         os.path.join(EXT_DIR, f'votacao_secao_{year}_BR.zip'))
    if not br:
        br = _ensure_tse(year, 'BR')  # ~700-800MB; ultimo recurso
    if not br:
        print(f'  [AVISO] presidente {year} indisponivel (sem arquivo BR).')
        return
    want = defaultdict(lambda: defaultdict(list))  # uf -> (zona,secao) -> [entries]
    secset = defaultdict(set)
    for uf, cs in per.items():
        for c in cs:
            for z, s in c['secoes']:
                want[uf][(z, s)].append(c)
                secset[uf].add((z, s))
    import csv as _csv
    import io as _io
    if br.endswith('.csv'):
        fh = open(br, encoding='latin-1')
        rows = _csv.reader(fh, delimiter=';')
    else:
        z = zipfile.ZipFile(br); m = [n for n in z.namelist() if n.lower().endswith(('.csv', '.txt'))][0]
        rows = _csv.reader(_io.StringIO(z.read(m).decode('latin-1')), delimiter=';')
    h = [x.strip().lower() for x in next(rows)]
    I = {n: i for i, n in enumerate(h)}
    for r in rows:
        uf = r[I['sg_uf']]
        if uf not in secset:
            continue
        try:
            z = int(r[I['nr_zona']]); s = int(r[I['nr_secao']])
        except (ValueError, KeyError):
            continue
        if (z, s) not in secset[uf]:
            continue
        cd = r[I['cd_municipio']].strip(); turno = str(r[I['nr_turno']]).strip()
        votavel = str(r[I['nr_votavel']]).strip(); votos = int(r[I['qt_votos']] or 0)
        for c in want[uf][(z, s)]:
            if cd in c['por_pai']:
                pp = c['por_pai'][cd].setdefault('presidente', {}).setdefault(turno, {})
                pp[votavel] = pp.get(votavel, 0) + votos
    # reconstroi resultados.presidente (soma dos pais)
    for uf, cs in per.items():
        for c in cs:
            agg = defaultdict(lambda: defaultdict(int))
            for p, cgs in c['por_pai'].items():
                for t, vv in cgs.get('presidente', {}).items():
                    for v, q in vv.items():
                        agg[t][v] += q
            if agg:
                c['resultados']['presidente'] = {t: dict(v) for t, v in agg.items()}
    print(f'  presidente {year} preenchido (varredura dirigida do arquivo BR).')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--years')
    ap.add_argument('--ufs')
    ap.add_argument('--idyears', help='anos de identidade (default 2000,2004,2008,2012)')
    ap.add_argument('--merge', action='store_true',
                    help='preserva anos nao rodados do JSON existente')
    args = ap.parse_args()
    years = [y.strip() for y in args.years.split(',')] if args.years else list(TARGET_YEARS)
    ufs = [u.strip().upper() for u in args.ufs.split(',')] if args.ufs else list(ALL_UFS)
    global IDENTITY_YEARS
    if args.idyears:
        IDENTITY_YEARS = [y.strip() for y in args.idyears.split(',')]

    ap_merge = args.merge
    out, csv_rows, catalog = detect(years, ufs)
    for y in ('2002', '2006', '2010'):
        if y in years:
            fill_national_presidente(out, y)
    if ap_merge and os.path.exists(OUT_JSON):
        # Preserva (ano, UF) que NAO foram rodados agora (ex.: rodar so PA,SC sem
        # refazer os demais estados nem 1998 dos ja existentes).
        prev = json.load(open(OUT_JSON, encoding='utf-8'))
        run_ufs = set(ufs)
        kept = 0
        for y, per in (prev.get('anos') or {}).items():
            dst = out['anos'].setdefault(y, {})
            for uf, cs in per.items():
                if (y not in years or uf not in run_ufs) and uf not in dst:
                    dst[uf] = cs
                    kept += 1
        print(f'  (merge) {kept} blocos (ano,UF) preservados do JSON anterior')
    with open(OUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    with open(OUT_CSV, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['Ano', 'UF', 'Cidade', 'CD_TSE', 'CD_IBGE', 'Parents',
                    'N_Secoes', 'Votos_Pres_1T', 'Identidade_Ano', 'Revisar'])
        w.writerows(sorted(csv_rows))
    cat_path = os.path.join(GEO_DIR, 'cidades_ausentes_por_ano.csv')
    with open(cat_path, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['Ano', 'UF', 'CD_TSE', 'Cidade', 'CD_IBGE', 'Identidade_Ano',
                    'Status', 'N_Secoes'])
        w.writerows(sorted(catalog))
    nc = sum(len(v) for yr in out['anos'].values() for v in yr.values())
    print(f'\nOK -> {OUT_JSON}  ({nc} cidades-ano, {len(csv_rows)} linhas CSV)')
    print(f'     {cat_path}  ({len(catalog)} cidades ausentes catalogadas)')


if __name__ == '__main__':
    main()
