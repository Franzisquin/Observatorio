"""
Patch para cidades cujas SECOES/LOCAIS foram RENUMERADOS ao ganharem estrutura
eleitoral propria (ex.: Mojui dos Campos-PA). Nesses casos o numero (zona,secao)
e (zona,local) NAO casa entre anos, mas os PREDIOS (nome do local de votacao)
existem sob o municipio-pai nos anos anteriores.

Mecanismo: pega os PREDIOS da cidade num ano em que ela aparece rotulada no GPKG
(ex.: 2010), casa por (zona, NOME do local) -- desambiguando por bairro -- no GPKG
do ano-alvo (ex.: 2006) para achar o numero de local daquele ano, e puxa as SECOES
daquele local no arquivo bruto, somando os votos e atribuindo a cidade (subtraindo
do pai). Presidente vem do arquivo nacional BR.

So funciona em anos com GPKG nominal (2006) e cujo bruto tem NR_LOCAL_VOTACAO
(2006/2010). 1998 (bruto sem local) e 2002 (GPKG sem nome) ficam de fora.

Uso: py scripts/patch_locais_renumerados.py
"""

import csv
import io
import json
import os
import sqlite3
import tempfile
import unicodedata
import zipfile
from collections import defaultdict, Counter

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO = os.path.join(BASE, 'resultados_geo')
TSE = os.path.join(BASE, 'scratch', 'secoes_tse')
EXT = r'E:\Mapas\Dados'
OUT_JSON = os.path.join(GEO, 'emancipacoes_pre2014.json')

# (uf, codigo, nome, gpkg_rotulo) -> anos-alvo a recuperar
# Mojui/PA NAO entra: nomes de predios rurais genericos colidem por toda a area
# de Santarem, bairros divergem entre anos e a geocodificacao de 2006 e imprecisa
# (mais proximo mesmo-nome a ~62km), entao a ponte por nome erra ~30%. Use esta
# ferramenta apenas para cidades com nomes de predio DISTINTIVOS.
RENUMERADAS = []
CARGO_BY_DS = {'PRESIDENTE': 'presidente', 'GOVERNADOR': 'governador',
               'SENADOR': 'senador', 'DEPUTADO FEDERAL': 'deputado_federal',
               'DEPUTADO ESTADUAL': 'deputado_estadual'}


def norm(s):
    s = unicodedata.normalize('NFD', str(s or ''))
    return ' '.join(''.join(c for c in s if unicodedata.category(c) != 'Mn').upper().split())


def gpkg(year):
    zp = os.path.join(GEO, f'locais_votacao_{year}_gkpg.zip')
    z = zipfile.ZipFile(zp)
    m = [n for n in z.namelist() if n.lower().endswith('.gpkg')][0]
    p = os.path.join(tempfile.gettempdir(), f'patchren_{year}.gpkg')
    if not os.path.exists(p):
        open(p, 'wb').write(z.read(m))
    cur = sqlite3.connect(p).cursor()
    T = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
         if r[0].lower().startswith('locais_votacao')
         and ('padroniz' in r[0].lower() or 'enriquec' in r[0].lower())][0]
    return cur, T


def raw_rows(year, uf):
    p = os.path.join(TSE, f'votacao_secao_{year}_{uf}.zip')
    z = zipfile.ZipFile(p)
    m = [n for n in z.namelist() if n.lower().endswith(('.csv', '.txt'))][0]
    rdr = csv.reader(io.StringIO(z.read(m).decode('latin-1')), delimiter=';')
    h = [x.strip().lower() for x in next(rdr)]
    I = {n: i for i, n in enumerate(h)}
    return rdr, I


def br_presidente(year, uf, want_locs):
    """{(zona,secao): cd_mun} alvo nao serve; aqui somamos presidente por (zona,local)."""
    path = None
    for ext in ('csv', 'zip'):
        c = os.path.join(EXT, f'votacao_secao_{year}_BR.{ext}')
        if os.path.exists(c):
            path = c
            break
    if not path:
        return {}
    if path.endswith('.csv'):
        fh = open(path, encoding='latin-1')
        rows = csv.reader(fh, delimiter=';')
    else:
        z = zipfile.ZipFile(path)
        m = [n for n in z.namelist() if n.lower().endswith(('.csv', '.txt'))][0]
        rows = csv.reader(io.StringIO(z.read(m).decode('latin-1')), delimiter=';')
    h = [x.strip().lower() for x in next(rows)]
    I = {n: i for i, n in enumerate(h)}
    out = defaultdict(lambda: defaultdict(int))  # (cd_mun) -> {(turno,votavel):votos} por local
    res = defaultdict(lambda: defaultdict(int))
    for r in rows:
        if r[I['sg_uf']] != uf:
            continue
        try:
            z_ = int(r[I['nr_zona']]); lv = int(r[I['nr_local_votacao']])
        except (ValueError, KeyError):
            continue
        if (z_, lv) not in want_locs:
            continue
        cd = r[I['cd_municipio']].strip(); turno = str(r[I['nr_turno']]).strip()
        votavel = str(r[I['nr_votavel']]).strip(); votos = int(r[I['qt_votos']] or 0)
        res[cd][('presidente', turno, votavel)] += votos
    return res


def build_bridge(uf, code, ref_year, target_year):
    """{zona: set(local_target)} dos predios da cidade casados por nome+bairro."""
    cref, Tref = gpkg(ref_year)
    ctgt, Ttgt = gpkg(target_year)
    # Predios da cidade no ano em que o GPKG ja a rotula (ex.: 2010).
    pred = [(int(z), norm(nm), norm(b)) for z, nm, b in cref.execute(
        f"SELECT nr_zona,nm_locvot,ds_bairro FROM {Tref} WHERE sg_uf=? AND nm_localidade=?",
        (uf, RENUM_NOME[code]))]
    # indices do ano-alvo
    by_zn = defaultdict(list)      # (zona,nome) -> [(local,bairro,muni)]
    for z, loc, nm, b, muni in ctgt.execute(
            f"SELECT nr_zona,nr_locvot,nm_locvot,ds_bairro,nm_localidade FROM {Ttgt} WHERE sg_uf=?", (uf,)):
        by_zn[(int(z), norm(nm))].append((int(loc), norm(b), norm(muni)))
    locs = defaultdict(set)
    owners = Counter()
    used = 0
    for (z, nm, b) in pred:
        cand = by_zn.get((z, nm), [])
        # Exige casar NOME + BAIRRO (mesmo predio fisico). Nomes genericos
        # ("EMEF SAO RAIMUNDO") se repetem pela area rural de Santarem -- so o
        # bairro garante que e o predio do PLANALTO (Mojui), nao o ribeirinho.
        byb = [c for c in cand if c[1] == b]
        if len(byb) != 1:
            continue
        loc, _, muni = byb[0]
        locs[z].add(loc); owners[muni] += 1; used += 1
    return locs, owners, used, len(pred)


RENUM_NOME = {r['code']: r['nome'] for r in RENUMERADAS}


def patch():
    out = json.load(open(OUT_JSON, encoding='utf-8'))
    for spec in RENUMERADAS:
        uf, code = spec['uf'], spec['code']
        for year in spec['years']:
            locs, owners, used, total = build_bridge(uf, code, spec['ref_gpkg'], year)
            if not locs:
                print(f'{spec["nome"]} {year}: nenhum predio casado.')
                continue
            flat = {(z, lv) for z, s in locs.items() for lv in s}
            # soma gov/sen/dep do bruto por (zona,local) -> por_pai[owner]
            rdr, I = raw_rows(year, uf)
            por_pai = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
            secs = set()
            for r in rdr:
                cargo = CARGO_BY_DS.get(norm(r[I['ds_cargo']]))
                if not cargo:
                    continue
                try:
                    z_ = int(r[I['nr_zona']]); lv = int(r[I['nr_local_votacao']])
                except (ValueError, KeyError):
                    continue
                if (z_, lv) not in flat:
                    continue
                owner = r[I['cd_municipio']].strip(); turno = str(r[I['nr_turno']]).strip()
                votavel = str(r[I['nr_votavel']]).strip(); votos = int(r[I['qt_votos']] or 0)
                por_pai[owner][(cargo, turno)][votavel] += votos
                secs.add((z_, int(r[I['nr_secao']])))
            # presidente (arquivo BR)
            pres = br_presidente(year, uf, flat)
            for owner, kv in pres.items():
                for (cargo, turno, votavel), votos in kv.items():
                    por_pai[owner][(cargo, turno)][votavel] += votos
            # monta resultados/por_pai no formato do JSON
            pp_json = defaultdict(lambda: defaultdict(dict))
            resultados = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
            for owner, kv in por_pai.items():
                for (cargo, turno), vv in kv.items():
                    pp_json[owner].setdefault(cargo, {})[turno] = dict(vv)
                    for v, q in vv.items():
                        resultados[cargo][turno][v] += q
            ibge = None
            mun_path = os.path.join(GEO, 'municipios', f'municipios_{uf}.geojson')
            if os.path.exists(mun_path):
                for f in json.load(open(mun_path, encoding='utf-8'))['features']:
                    if norm(f['properties']['NM_MUN']) == norm(spec['nome']):
                        ibge = f['properties']['CD_MUN']
            entry = {
                'cd_tse': code, 'nome': spec['nome'], 'cd_ibge': ibge,
                'parents': [p for p, _ in owners.most_common()] if owners else sorted(pp_json),
                'revisar': len(pp_json) > 1, 'identidade_ano': spec['ref_gpkg'],
                'metodo': 'bridge_nome_local_gpkg', 'n_secoes': len(secs),
                'n_predios_casados': used, 'n_predios_total': total,
                'resultados': {cg: {t: dict(v) for t, v in tt.items()} for cg, tt in resultados.items()},
                'por_pai': {ow: dict(cg) for ow, cg in pp_json.items()},
            }
            per = out['anos'].setdefault(year, {}).setdefault(uf, [])
            per[:] = [c for c in per if c['cd_tse'] != code] + [entry]
            print(f'{spec["nome"]} {year}: predios {used}/{total} | secoes {len(secs)} | '
                  f'pais {dict(owners)} | gov1T={sum(resultados.get("governador",{}).get("1",{}).values())} '
                  f'pres1T={sum(resultados.get("presidente",{}).get("1",{}).values())}')
    json.dump(out, open(OUT_JSON, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('JSON atualizado.')


if __name__ == '__main__':
    patch()
