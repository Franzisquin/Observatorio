"""
Gera a TABELA DE EMANCIPACOES para as eleicoes nacionais previas a 2014.

Problema
--------
Nas eleicoes nacionais de 1998/2002/2006/2010 varias cidades de hoje ainda nao
existiam: eram distritos de um municipio-pai, e os votos do distrito foram
registrados sob o codigo TSE do pai. No site isso faz a cidade nova aparecer sem
votos e infla o pai.

Mecanismo (decidido com o usuario)
----------------------------------
Identificamos os locais de votacao da cidade nova pelo NOME DO LOCAL + ZONA
ELEITORAL (o numero do local -- nr_locvot -- NAO e estavel: a TSE renumera os
locais quando o distrito emancipa; ja o nome do estabelecimento e a zona se
mantem). A "identidade moderna" de cada local vem do CENSO padronizado do projeto
(resultados_geo/Censo AAAA/censo_AAAA_UF.json), cujas chaves sao
``zona_CDTSE_local`` e cujo ``nm_localidade`` ja e o municipio ATUAL e
``cd_localidade_tse`` o codigo TSE atual da cidade.

Para cada cidade C que existe no censo mas esta AUSENTE na eleicao do ano Y:
  1. Pegamos o "rastro" de C no censo MAIS ANTIGO que a conhece: conjunto de
     ``(zona, nm_locvot_normalizado)``.
  2. Casamos esse rastro com os locais da eleicao Y pela base de locais (GPKG) do
     ano de referencia daquela eleicao (1998->2006, 2006->2006, 2010->2010),
     que da ``(zona, nome) -> [nr_locvot]``.
  3. Descobrimos sob qual codigo-pai a eleicao Y guardou aqueles (zona, local) e
     registramos a reatribuicao para o codigo TSE moderno de C.

2002 fica de fora por ora: a base de locais de 2002 nao tem nome de local
(nm_locvot vazio); sera tratada noutra fonte.

Saidas
------
  resultados_geo/emancipacoes_pre2014.json   (consumida pelo patch da Fase B)
  resultados_geo/emancipacoes_pre2014_revisao.csv  (conferencia humana)

Uso
---
  py scripts/gerar_emancipacoes_pre2014.py
  py scripts/gerar_emancipacoes_pre2014.py --years 2010 --ufs SC,PA
"""

import argparse
import csv
import glob
import json
import os
import sqlite3
import tempfile
import unicodedata
import zipfile
from collections import defaultdict

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO_DIR = os.path.join(BASE_DIR, 'resultados_geo')
OUT_JSON = os.path.join(GEO_DIR, 'emancipacoes_pre2014.json')
OUT_CSV = os.path.join(GEO_DIR, 'emancipacoes_pre2014_revisao.csv')

ALL_UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS',
           'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC',
           'SE', 'SP', 'TO']

# Ano da eleicao -> ano da base de locais (GPKG) usada para nomear os locais.
# A base de 2002 nao tem nome de local (nm_locvot vazio), entao 2002 usa a base de
# 2006 (numeracao de local 2002<->2006 estavel onde nao houve emancipacao no meio).
NAMING_YEAR = {'1998': '2006', '2002': '2006', '2006': '2006', '2010': '2010'}
TARGET_YEARS = ['1998', '2002', '2006', '2010']

# Cargo "canonico" para detectar o conjunto de locais de cada (ano, UF).
# A reatribuicao detectada aqui vale para todos os cargos do ano (mesmos locais);
# o patch (Fase B) aplica a todos os ZIPs.
PRES_ZIP = {
    '1998': 'Majoritarias 1998/presidente_1998_t1_{uf}.zip',
    '2002': 'Majoritarias 2002/presidente_2002_t1_{uf}.zip',
    '2006': 'Majoritarias 2006/presidente_2006_t1_{uf}.zip',
    '2010': 'Majoritarias 2010/presidente_2010_t1_{uf}.zip',
}


def norm(s):
    s = unicodedata.normalize('NFD', str(s or ''))
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return ' '.join(s.upper().split())


# ---------------------------------------------------------------------------
# Censo padronizado: identidade moderna + rastro das cidades
# ---------------------------------------------------------------------------

def census_years():
    ys = []
    for d in glob.glob(os.path.join(GEO_DIR, 'Censo *')):
        if os.path.isdir(d):
            part = os.path.basename(d).split()
            if len(part) == 2 and part[1].isdigit():
                ys.append(part[1])
    return sorted(ys)


def load_census(year, uf):
    zp = os.path.join(GEO_DIR, f'Censo {year}', f'censo_{year}_{uf}.zip')
    if not os.path.exists(zp):
        return None
    with zipfile.ZipFile(zp) as z:
        name = f'censo_{year}_{uf}.json'
        if name not in z.namelist():
            cand = [n for n in z.namelist() if n.endswith('.json')]
            if not cand:
                return None
            name = cand[0]
        return json.loads(z.read(name)).get('RESULTS', {})


def build_city_footprints(uf, cyears):
    """({cd_tse(str): {...}}, owners_by_year).

    Para cada codigo usa o censo MAIS ANTIGO em que aparece (rastro mais proximo
    da emancipacao). ``foot`` = set((zona, nm_locvot_norm)). ``owners_by_year`` =
    {census_year: {(zona, name): set(codes)}} para detectar nomes ambiguos
    (mesmo nome de local em mais de um municipio na mesma zona -- ex.: "EMEF
    SANTO ANTONIO" no interior). So usamos nomes UNICOS para reatribuir.
    """
    cities = {}
    owners_by_year = {}
    for year in cyears:  # ascendente
        res = load_census(year, uf)
        if not res:
            continue
        foots = defaultdict(set)
        names = defaultdict(lambda: defaultdict(int))
        owners = defaultdict(set)
        for row in res.values():
            code = str(row.get('cd_localidade_tse') or '').strip()
            if not code:
                continue
            zona = row.get('nr_zona')
            nmlv = norm(row.get('nm_locvot'))
            if zona is None or not nmlv:
                continue
            try:
                zona = int(zona)
            except (TypeError, ValueError):
                continue
            foots[code].add((zona, nmlv))
            owners[(zona, nmlv)].add(code)
            names[code][norm(row.get('nm_localidade'))] += 1
        owners_by_year[year] = owners
        for code, foot in foots.items():
            if code in cities:
                continue  # ja registrado num censo mais antigo
            best_name = max(names[code].items(), key=lambda kv: kv[1])[0]
            cities[code] = {'name': best_name, 'census_year': year, 'foot': foot}
    return cities, owners_by_year


# ---------------------------------------------------------------------------
# Base de locais (GPKG) para nomear os locais de votacao de cada eleicao
# ---------------------------------------------------------------------------

_GPKG_CACHE = {}


def _gpkg_cursor(year):
    if year in _GPKG_CACHE:
        return _GPKG_CACHE[year]
    zp = os.path.join(GEO_DIR, f'locais_votacao_{year}_gkpg.zip')
    z = zipfile.ZipFile(zp)
    member = [n for n in z.namelist() if n.lower().endswith('.gpkg')][0]
    path = os.path.join(tempfile.gettempdir(), f'emanc_lv_{year}.gpkg')
    if not os.path.exists(path) or os.path.getsize(path) != z.getinfo(member).file_size:
        with open(path, 'wb') as f:
            f.write(z.read(member))
    con = sqlite3.connect(path)
    cur = con.cursor()
    table = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
             if r[0].lower().startswith('locais_votacao')
             and ('padroniz' in r[0].lower() or 'enriquec' in r[0].lower())][0]
    _GPKG_CACHE[year] = (cur, table)
    return _GPKG_CACHE[year]


_ZNAME_CACHE = {}


def gpkg_zname(year, uf):
    """{(zona, nm_locvot_norm): [nr_locvot,...]} da base de locais do ano/UF."""
    key = (year, uf)
    if key in _ZNAME_CACHE:
        return _ZNAME_CACHE[key]
    cur, table = _gpkg_cursor(year)
    idx = defaultdict(list)
    q = f"SELECT nr_zona, nr_locvot, nm_locvot FROM {table} WHERE sg_uf=?"
    for zona, loc, nmlv in cur.execute(q, (uf,)):
        try:
            zona = int(zona)
            loc = int(loc)
        except (TypeError, ValueError):
            continue
        nm = norm(nmlv)
        if nm:
            idx[(zona, nm)].append(loc)
    _ZNAME_CACHE[key] = idx
    return idx


# ---------------------------------------------------------------------------
# Eleicao: mapa (zona, local) -> codigo e votos (presidente t1 como canonico)
# ---------------------------------------------------------------------------

def load_election_locmap(year, uf):
    """((zona,local)->code, set(codes), (zona,local)->total_votos)."""
    rel = PRES_ZIP[year].format(uf=uf)
    zp = os.path.join(GEO_DIR, rel)
    if not os.path.exists(zp):
        return None, None, None
    with zipfile.ZipFile(zp) as z:
        main = [n for n in z.namelist() if not n.endswith('_resumo.json')][0]
        res = json.loads(z.read(main)).get('RESULTS', {})
    loc2code = {}
    votes = {}
    codes = set()
    for k, cand in res.items():
        p = k.split('_')
        if len(p) < 3:
            continue
        zona, code, loc = p[0], p[1], p[2]
        codes.add(code)
        if loc.startswith('S'):
            continue  # sintetica (1998): sem nr_locvot -> nao casa por nome
        try:
            zl = (int(zona), int(loc))
        except ValueError:
            continue
        loc2code[zl] = code
        votes[zl] = sum(v for v in cand.values() if isinstance(v, int))
    return loc2code, codes, votes


# ---------------------------------------------------------------------------
# Deteccao das reatribuicoes
# ---------------------------------------------------------------------------

def detect(years, ufs):
    cyears = census_years()
    # Estrutura de saida: por ano -> por uf -> lista de cidades reatribuidas.
    out = {'_meta': {'mecanismo': 'nome do local + zona; identidade pelo censo padronizado',
                     'naming_year': NAMING_YEAR, 'census_years': cyears},
           'anos': {}}
    csv_rows = []
    dropped_total = 0
    for uf in ufs:
        cities, owners_by_year = build_city_footprints(uf, cyears)
        if not cities:
            continue
        muni_ibge = load_muni_ibge(uf)
        code_names = load_code_names(uf, cyears)
        for year in years:
            if year not in NAMING_YEAR:
                continue
            loc2code, present, votes = load_election_locmap(year, uf)
            if loc2code is None:
                continue
            zname = gpkg_zname(NAMING_YEAR[year], uf)
            for code, info in cities.items():
                if code in present:
                    continue  # cidade ja existe nessa eleicao
                owners = owners_by_year.get(info['census_year'], {})
                # casa o rastro da cidade com os locais do ano Y, por NOME UNICO.
                matched = defaultdict(dict)   # zona -> {local: parent_code}
                namebyloc = {}
                dropped = 0
                for (zona, nm) in info['foot']:
                    # 1) nome precisa ser UNICO da cidade naquele censo (sem
                    #    colisao com outro municipio na mesma zona).
                    if owners.get((zona, nm), set()) != {code}:
                        dropped += 1
                        continue
                    locs = zname.get((zona, nm), [])
                    if not locs:
                        continue
                    # 2) na eleicao, todos os locais desse nome devem estar sob
                    #    UM unico codigo-pai (!= cidade). Caso contrario o nome
                    #    casou lugares de municipios diferentes -> descarta.
                    par = {loc2code.get((zona, loc)) for loc in locs}
                    par.discard(None)
                    par.discard(code)
                    if len(par) != 1:
                        dropped += 1
                        continue
                    parent = next(iter(par))
                    for loc in locs:
                        if loc2code.get((zona, loc)) == parent:
                            matched[zona][loc] = parent
                            namebyloc[(zona, loc)] = nm
                dropped_total += dropped
                if not matched:
                    continue
                locs = []
                parents = set()
                tot_votes = 0
                for zona, lz in matched.items():
                    for loc, parent in lz.items():
                        parents.add(parent)
                        tot_votes += votes.get((zona, loc), 0)
                        locs.append({'zona': zona, 'local': loc, 'parent': parent,
                                     'nm_locvot': namebyloc[(zona, loc)]})
                parents_nomes = {p: code_names.get(p, '?') for p in sorted(parents)}
                revisar = len(parents) > 1
                entry = {
                    'cd_tse': code,
                    'nome': info['name'],
                    'cd_ibge': muni_ibge.get(info['name']),
                    'parents': sorted(parents),
                    'parents_nomes': parents_nomes,
                    'revisar': revisar,
                    'census_year': info['census_year'],
                    'naming_year': NAMING_YEAR[year],
                    'n_locais': len(locs),
                    'n_nomes_descartados_ambiguos': dropped,
                    'votos_presidente_t1': tot_votes,
                    'locais': sorted(locs, key=lambda x: (x['zona'], x['local'])),
                }
                out['anos'].setdefault(year, {}).setdefault(uf, []).append(entry)
        # libera caches de UF grandes
        _ZNAME_CACHE.clear()

    # Um local fisico so pode pertencer a UMA cidade. Se duas cidades novas
    # reivindicam o mesmo (zona, pai, local) -- colisao de nomes genericos entre
    # vizinhas -- removemos de ambas (ambiguo) e recomputamos as entradas.
    _drop_cross_city_collisions(out)

    csv_rows = _build_csv_rows(out, ufs)
    return out, csv_rows


def _orig_key(L):
    return f"{L['zona']}_{L['parent']}_{L['local']}"


def _drop_cross_city_collisions(out):
    for year, per_uf in out['anos'].items():
        claims = defaultdict(set)  # orig_key -> set(cd_tse)
        for cities in per_uf.values():
            for c in cities:
                for L in c['locais']:
                    claims[_orig_key(L)].add(c['cd_tse'])
        bad = {k for k, s in claims.items() if len(s) > 1}
        if not bad:
            continue
        for uf, cities in list(per_uf.items()):
            kept_cities = []
            for c in cities:
                locs = [L for L in c['locais'] if _orig_key(L) not in bad]
                if not locs:
                    continue  # cidade ficou sem locais -> remove
                c['locais'] = locs
                c['n_locais'] = len(locs)
                parents = sorted({L['parent'] for L in locs})
                c['parents'] = parents
                c['parents_nomes'] = {p: c['parents_nomes'].get(p, '?') for p in parents}
                c['revisar'] = len(parents) > 1
                kept_cities.append(c)
            if kept_cities:
                per_uf[uf] = kept_cities
            else:
                del per_uf[uf]


def _build_csv_rows(out, ufs):
    rows = []
    for year, per_uf in out['anos'].items():
        for uf, cities in per_uf.items():
            for c in cities:
                for L in c['locais']:
                    rows.append([year, uf, c['nome'], c['cd_tse'], c['cd_ibge'],
                                 L['parent'], c['parents_nomes'].get(L['parent'], '?'),
                                 L['zona'], L['local'], L['nm_locvot'],
                                 c['census_year'], 'SIM' if c['revisar'] else ''])
    return rows


_CODE_NAMES_CACHE = {}


def load_code_names(uf, cyears):
    """{cd_tse(str): nm_localidade} a partir do censo mais recente da UF."""
    if uf in _CODE_NAMES_CACHE:
        return _CODE_NAMES_CACHE[uf]
    mapping = {}
    for year in reversed(cyears):  # mais recente primeiro
        res = load_census(year, uf)
        if not res:
            continue
        counts = defaultdict(lambda: defaultdict(int))
        for row in res.values():
            code = str(row.get('cd_localidade_tse') or '').strip()
            if code:
                counts[code][norm(row.get('nm_localidade'))] += 1
        for code, c in counts.items():
            if code not in mapping:
                mapping[code] = max(c.items(), key=lambda kv: kv[1])[0]
    _CODE_NAMES_CACHE[uf] = mapping
    return mapping


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--years', help='ex.: 1998,2006,2010')
    ap.add_argument('--ufs', help='ex.: SC,PA')
    args = ap.parse_args()
    years = [y.strip() for y in args.years.split(',')] if args.years else list(TARGET_YEARS)
    ufs = [u.strip().upper() for u in args.ufs.split(',')] if args.ufs else list(ALL_UFS)

    out, csv_rows = detect(years, ufs)

    with open(OUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    with open(OUT_CSV, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['Ano', 'UF', 'Cidade', 'CD_TSE', 'CD_IBGE', 'Parent_TSE',
                    'Parent_Nome', 'Zona', 'Local', 'Nome_Local', 'Censo_Fonte',
                    'Revisar'])
        w.writerows(sorted(csv_rows))

    # resumo
    n_city = sum(len(v) for yr in out['anos'].values() for v in yr.values())
    print(f'OK -> {OUT_JSON}')
    print(f'     {OUT_CSV} ({len(csv_rows)} locais)')
    for year in sorted(out['anos']):
        per = out['anos'][year]
        nc = sum(len(v) for v in per.values())
        nl = sum(len(c['locais']) for v in per.values() for c in v)
        print(f'  {year}: {nc} cidades reatribuidas em {len(per)} UFs, {nl} locais')


if __name__ == '__main__':
    main()
