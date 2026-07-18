# -*- coding: utf-8 -*-
"""
Gera os dados das eleicoes GERAIS de 1994 (majoritarias: Presidente, Governador,
Senador) no formato JSON-em-ZIP das gerais 1998-2022 do site.

Diferenca central: 1994 NAO tem dados por secao/local (NR_ZONA = -3 no re-export
do TSE) — os votos vem por MUNICIPIO (votacao_candidato_munzona_1994). Cada
municipio vira UMA chave sintetica de RESULTS no formato "1_{cdMuniTSE}_M"
(3 partes, parts[1] = codigo TSE, exigido pelos helpers 2002 do site; sufixo
nao-numerico nunca colide com um local real). No site, todas as features de
1994 sao sinteticas (geometry:null) e o mapa e o coropletico da malha 1994.

METADATA de cada JSON:
  cand_names[nr] = [NM_URNA, SG_PARTIDO, DS_SIT_TOT_TURNO, NM_COLIGACAO, COMPOSICAO]
  muni_names     = {cdMuniTSE: NM_MUNICIPIO}
  muni_ibge      = {cdMuniTSE: ibge7}  (join por nome+UF com a malha 1994 do SVG)

Saidas em resultados_geo/Majoritarias 1994/:
  presidente_1994_t1_{UF}.zip          (do votacao_candidato_munzona_1994_BR.csv)
  governador_1994_ord_t{1,2}_{UF}.zip  (t2 so onde houve)
  senador_1994_ord_t1_{UF}.zip

Cross-check: totais de presidente t1 por municipio vs 1994/resultado1994.1.json.

Uso:
  py scripts/gerar_majoritarias_1994.py
"""

import csv
import io
import json
import os
import re
import sys
import unicodedata
import zipfile
from collections import defaultdict

from coligacoes_1994 import parse_coligacoes, norm_sigla


def norm_key(nome):
    """Chave do detalhes_candidatos: como o JS (nome.toUpperCase().trim())."""
    return str(nome or '').strip().upper()

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_DIR = os.path.join(BASE_DIR, '1994', 'votacao_candidato_munzona_1994')
DETALHE_DIR = os.path.join(BASE_DIR, '1994')
OUT_DIR = os.path.join(BASE_DIR, 'resultados_geo', 'Majoritarias 1994')
INDEX_1994 = os.path.join(BASE_DIR, 'scratch', 'malha1994', 'index_1994.json')
RESULTADO_1994 = os.path.join(BASE_DIR, '1994', 'resultado1994.1.json')

ALL_UFS = [
    'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
    'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
]

CD_PRESIDENTE = '1'
CD_GOVERNADOR = '3'
CD_SENADOR = '5'


def norm(s):
    s = unicodedata.normalize('NFD', str(s or ''))
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    s = re.sub(r"[^A-Za-z0-9 ]", ' ', s)
    return re.sub(r'\s+', ' ', s).strip().upper()


def clean(v):
    v = str(v or '').strip()
    return '' if v in ('#NE', '#NULO', '-1', '-3') else v


def read_rows(path):
    with io.open(path, encoding='latin-1', newline='') as f:
        reader = csv.DictReader(f, delimiter=';')
        for row in reader:
            yield row


# Renomeacoes/grafias 1994 (TSE) -> nome na malha (norm), casos que o fuzzy
# nao resolve. Chave: (norm(nome_tse), uf).
NAME_ALIASES = {
    ('SANTA ROSA', 'AC'): 'SANTA ROSA DO PURUS',
    ('CAMPOS', 'RJ'): 'CAMPOS DOS GOYTACAZES',
    ('CAMPO GRANDE', 'RN'): 'AUGUSTO SEVERO',
    ('ASSU', 'RN'): 'ACU',
    ('SAO MIGUEL DE TOUROS', 'RN'): 'SAO MIGUEL DO GOSTOSO',
    ('PRESIDENTE JUSCELINO', 'RN'): 'SERRA CAIADA',
    ('JABOATAO', 'PE'): 'JABOATAO DOS GUARARAPES',
    ('CABO', 'PE'): 'CABO DE SANTO AGOSTINHO',
    ('ITAMARACA', 'PE'): 'ILHA DE ITAMARACA',
    ('SAO CAETANO', 'PE'): 'SAO CAITANO',
    ('SENADOR CATUNDA', 'CE'): 'CATUNDA',
    ('DEP IRAPUAN PINHEIRO', 'CE'): 'DEPUTADO IRAPUAN PINHEIRO',
    ('ITABIRINHA DE MANTENA', 'MG'): 'ITABIRINHA',
    ('CONCEICAO DA PEDRA', 'MG'): 'CONCEICAO DAS PEDRAS',
    ('PIUM I', 'MG'): 'PIUMHI',
    ('QUATRO MARCOS', 'MT'): 'SAO JOSE DOS QUATRO MARCOS',
    ('VILA BELA STSSMA TRINDADE', 'MT'): 'VILA BELA DA SANTISSIMA TRINDADE',
    ('ALTO DA BOA VISTA', 'MT'): 'ALTO BOA VISTA',
    ('JAMARI', 'RO'): 'ITAPUA DO OESTE',
    ('TRINDADE', 'RS'): 'TRINDADE DO SUL',
    ('ERVAL', 'RS'): 'HERVAL',
    ('AMAPARI', 'AP'): 'PEDRA BRANCA DO AMAPARI',
    ('VILA ALTA', 'PR'): 'ALTO PARAISO',
    ('TUNAS', 'PR'): 'TUNAS DO PARANA',
    ('VILA BRANCA', 'PR'): '',  # sem correspondente conhecido; revisar
    ('SANTA ANA DO ITARARE', 'PR'): 'SANTANA DO ITARARE',
    ('COUTO DE MAGALHAES', 'TO'): 'COUTO MAGALHAES',
    ('SAO VALERIO DA NATIVIDADE', 'TO'): 'SAO VALERIO',
    ('PINDORAMA DE GOIAS', 'TO'): 'PINDORAMA DO TOCANTINS',
    ('MOSQUITO', 'TO'): 'PALMEIRAS DO TOCANTINS',
    ('DIVINOPOLIS', 'TO'): 'DIVINOPOLIS DO TOCANTINS',
    ('LAGEADO', 'TO'): 'LAJEADO',
    ('BALNEARIO DE CAMBORIU', 'SC'): 'BALNEARIO CAMBORIU',
    ('BALNEARIO DE BARRA DO SUL', 'SC'): 'BALNEARIO BARRA DO SUL',
    ('LAGEADO GRANDE', 'SC'): 'LAJEADO GRANDE',
    ('HERVAL DO OESTE', 'SC'): 'HERVAL D OESTE',
    ('PICARRAS', 'SC'): 'BALNEARIO PICARRAS',
    ('MUNDO NOVO DE GOIAS', 'GO'): 'MUNDO NOVO',
    ('CESARINA', 'GO'): 'CEZARINA',
    ('TEREZINHA DE GOIAS', 'GO'): 'TERESINA DE GOIAS',
    ('SAO LUIS DOS MONTES BELOS', 'GO'): 'SAO LUIS DE MONTES BELOS',
    # OURO BRANCO / AGUA QUENTE / ANSELMO DA FONSECA (BA) e PETRONIO PORTELA
    # (PI) eram municipios proprios em 1994 (criacoes depois anuladas) e NAO
    # existem na malha de 1994 — ficam sem poligono de proposito.
    ('OURO BRANCO', 'BA'): '',
    ('AGUA QUENTE', 'BA'): '',
    ('ANSELMO DA FONSECA', 'BA'): '',
    ('GOVERNADOR LOMANTO JUNIOR', 'BA'): 'BARRO PRETO',
    ('SANTA TERESINHA', 'BA'): 'SANTA TEREZINHA',
    ('SENADOR TEOTONIO VILELA', 'AL'): 'TEOTONIO VILELA',
    ('SAO DOMINGOS', 'ES'): 'SAO DOMINGOS DO NORTE',
    ('CAMPOS', 'GO'): 'CAMPOS BELOS',
    ('SAO LUIZ DO ANAUA', 'RR'): 'SAO LUIZ',
    ('LUIS DOMINGUES DO MARANHAO', 'MA'): 'LUIS DOMINGUES',
    ('PETRONIO PORTELA', 'PI'): '',
    ('ALAGOINHA', 'PI'): 'ALAGOINHA DO PIAUI',
    ('SAO SEB DE LAGOA DE ROCA', 'PB'): 'SAO SEBASTIAO DE LAGOA DE ROCA',
    ('OLHO D AGUA', 'PB'): 'OLHO D AGUA',
    ('CAMPOS', 'SP'): '',
    ('BROCHIER DO MARATA', 'RS'): 'BROCHIER',
    ('SAO LUIS GONZAGA', 'RS'): 'SAO LUIZ GONZAGA',
    ('SANTANA DO LIVRAMENTO', 'RS'): 'SANT ANA DO LIVRAMENTO',
    ('LUISIANIA', 'PR'): 'LUIZIANA',
    ('ALTO PARAISO', 'GO'): 'ALTO PARAISO DE GOIAS',
    ('SAO MANOEL', 'PR'): 'SAO MANOEL DO PARANA',
    ('PARATI', 'RJ'): 'PARATY',
    ('NOVA BRASILANDIA', 'RO'): 'NOVA BRASILANDIA D OESTE',
    ('VILA NOVA DO MAMORE', 'RO'): 'NOVA MAMORE',
    ('IPAUCU', 'SP'): 'IPAUSSU',
    ('BRODOSQUI', 'SP'): 'BRODOWSKI',
    ('EMBU', 'SP'): 'EMBU DAS ARTES',
}


def _lev(a, b, maxd=2):
    """Levenshtein com corte (retorna maxd+1 se exceder)."""
    if abs(len(a) - len(b)) > maxd:
        return maxd + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        best = i
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[-1] + 1, prev[j - 1] + (ca != cb)))
            best = min(best, cur[-1])
        if best > maxd:
            return maxd + 1
        prev = cur
    return prev[-1]


def build_tse_to_ibge():
    """(norm(nome), uf) -> ibge7, com fallback fuzzy dentro da UF."""
    with open(INDEX_1994, encoding='utf-8') as f:
        index = json.load(f)
    by_name_uf = {}
    names_by_uf = defaultdict(list)
    for ibge, info in index.items():
        key = (norm(info['nome']), info['uf'])
        by_name_uf[key] = ibge
        names_by_uf[info['uf']].append((norm(info['nome']), ibge))

    resolved_cache = {}

    def lookup(nome_norm, uf):
        key = (nome_norm, uf)
        if key in by_name_uf:
            return by_name_uf[key]
        if key in resolved_cache:
            return resolved_cache[key]
        result = None
        if key in NAME_ALIASES:
            # Alias '' = municipio sem poligono na malha 1994 (nao tentar fuzzy).
            alias = NAME_ALIASES[key]
            result = by_name_uf.get((alias, uf)) if alias else None
        else:
            # fuzzy: unico candidato na UF com Levenshtein <= 2
            cands = [ibge for name, ibge in names_by_uf[uf] if _lev(nome_norm, name) <= 2]
            if len(set(cands)) == 1:
                result = cands[0]
        resolved_cache[key] = result
        return result

    return lookup


def norm_cd(value):
    """Codigo TSE de municipio sem zero-padding (detalhe vem '02003', munzona '2003')."""
    v = clean(value)
    try:
        return str(int(v))
    except (TypeError, ValueError):
        return ''


class CargoAccumulator(object):
    def __init__(self):
        # votos[(uf, turno)][cdMuni][nr] = votos
        self.votes = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
        # cand[(uf, turno)][nr] = [nome, partido, status, coligacao, composicao]
        self.cand = defaultdict(dict)
        # muni[(uf)][cdMuni] = nome
        self.muni = defaultdict(dict)
        # turnout[(uf, turno)][cdMuni] = [aptos, comparecimento, brancos, nulos, nominais_detalhe]
        self.turnout = defaultdict(lambda: defaultdict(lambda: [0, 0, 0, 0, 0]))

    def add_detalhe(self, uf, turno, row):
        cd = norm_cd(row['CD_MUNICIPIO'])
        if not cd:
            return
        t = self.turnout[(uf, turno)][cd]
        for i, col in enumerate(['QT_APTOS', 'QT_COMPARECIMENTO', 'QT_VOTOS_BRANCOS',
                                 'QT_VOTOS_NULOS', 'QT_VOTOS_NOMINAIS_VALIDOS']):
            try:
                v = int(row[col])
            except (TypeError, ValueError):
                v = 0
            if v > 0:
                t[i] += v

    def add(self, uf, turno, row):
        cd = norm_cd(row['CD_MUNICIPIO'])
        nr = clean(row['NR_CANDIDATO'])
        if not cd or not nr:
            return
        try:
            v = int(row['QT_VOTOS_NOMINAIS'])
        except (TypeError, ValueError):
            return
        if v < 0:
            return
        self.votes[(uf, turno)][cd][nr] += v
        nome_mun = clean(row['NM_MUNICIPIO'])
        if nome_mun and cd not in self.muni[uf]:
            self.muni[uf][cd] = nome_mun
        if nr not in self.cand[(uf, turno)]:
            # NM_URNA do re-export de 1994 e apenas o nome completo truncado em
            # 30 chars (#NE no banco da epoca) — o NM_CANDIDATO integral e melhor.
            nome = clean(row['NM_CANDIDATO']) or clean(row['NM_URNA_CANDIDATO'])
            partido = clean(row['SG_PARTIDO'])
            status = clean(row['DS_SIT_TOT_TURNO']).upper()
            if '2' in status and 'TURNO' in status:
                status = '2º TURNO'
            colig = clean(row['NM_COLIGACAO']) or 'PARTIDO ISOLADO'
            comp = clean(row['DS_COMPOSICAO_COLIGACAO']) or partido
            self.cand[(uf, turno)][nr] = [nome, partido, status, colig, comp]


def write_zip(out_dir, basename, payload):
    os.makedirs(out_dir, exist_ok=True)
    zip_path = os.path.join(out_dir, basename + '.zip')
    data = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(basename + '.json', data)
    return zip_path


def emit(acc, cargo_slug, tse_to_ibge, turnos=('1', '2')):
    """Escreve os zips de um cargo; retorna UFs por turno emitidas."""
    emitted = defaultdict(list)
    for (uf, turno), by_mun in sorted(acc.votes.items()):
        if turno not in turnos or not by_mun:
            continue
        turnout = acc.turnout.get((uf, turno), {})
        results = {}
        muni_turnout = {}
        detalhe_nom = 0
        for cd, by_nr in by_mun.items():
            votes = dict(sorted(by_nr.items()))
            t = turnout.get(cd)
            if t:
                if t[2] > 0:
                    votes['95'] = t[2]
                if t[3] > 0:
                    votes['96'] = t[3]
                muni_turnout[cd] = [t[0], t[1]]
                detalhe_nom += t[4]
            results['1_%s_M' % cd] = votes
        # Cross-check: nominais do munzona vs detalhe (por UF/cargo/turno).
        munzona_nom = sum(sum(by_nr.values()) for by_nr in by_mun.values())
        if turnout and detalhe_nom and munzona_nom != detalhe_nom:
            print('  [DIVERGENCIA detalhe] %s %s t%s: munzona %d vs detalhe %d'
                  % (cargo_slug, uf, turno, munzona_nom, detalhe_nom))
        muni_names = {cd: nome for cd, nome in acc.muni[uf].items() if cd in by_mun}
        muni_ibge = {}
        for cd, nome in muni_names.items():
            ibge = tse_to_ibge(norm(nome), uf)
            if ibge:
                muni_ibge[cd] = ibge
        payload = {
            'METADATA': {
                'tipo_eleicao': 'Ordinaria',
                'cand_names': acc.cand[(uf, turno)],
                'coalition_adjustments': {},
                'muni_names': muni_names,
                'muni_ibge': muni_ibge,
                'muni_turnout': muni_turnout,
            },
            'RESULTS': results,
        }
        if cargo_slug == 'presidente':
            basename = 'presidente_1994_t%s_%s' % (turno, uf)
        else:
            basename = '%s_1994_ord_t%s_%s' % (cargo_slug, turno, uf)
        write_zip(OUT_DIR, basename, payload)
        emitted[turno].append(uf)
        missing = len(muni_names) - len(muni_ibge)
        if missing:
            faltantes = [n for c, n in muni_names.items() if c not in muni_ibge]
            print('  [AVISO] %s %s t%s: %d municipios sem IBGE: %s'
                  % (cargo_slug, uf, turno, missing, ', '.join(faltantes[:8])))
    return emitted


def crosscheck_presidente(acc, tse_to_ibge):
    print('Cross-check presidente t1 vs resultado1994.1.json...')
    with open(RESULTADO_1994, encoding='utf-8') as f:
        ref = json.load(f)

    ours_by_ibge = defaultdict(dict)
    national = defaultdict(int)
    for (uf, turno), by_mun in acc.votes.items():
        if turno != '1':
            continue
        for cd, by_nr in by_mun.items():
            nome = acc.muni[uf].get(cd, '')
            ibge = tse_to_ibge(norm(nome), uf)
            for nr, v in by_nr.items():
                national[nr] += v
                if ibge:
                    ours_by_ibge[ibge][nr] = ours_by_ibge[ibge].get(nr, 0) + v

    total = sum(national.values())
    print('  Total nacional de votos nominais: %s' % format(total, ',d'))
    for nr, v in sorted(national.items(), key=lambda kv: -kv[1])[:4]:
        print('    cand %s: %s (%.2f%%)' % (nr, format(v, ',d'), 100.0 * v / total))

    matched = diverg = 0
    for ibge, entry in ref.items():
        ref_votes = {str(c['numero']): int(c['votos']) for c in entry.get('list_cand', [])}
        ours = ours_by_ibge.get(ibge)
        if ours is None:
            continue
        matched += 1
        diffs = {nr: (ref_votes.get(nr, 0), v) for nr, v in ours.items()
                 if ref_votes.get(nr, 0) != v}
        if diffs:
            diverg += 1
            print('    [DIVERGENCIA] ibge %s: %s' % (ibge, diffs))
    print('  Municipios casados por IBGE: %d/%d; com divergencia de votos: %d'
          % (matched, len(ref), diverg))


def main():
    tse_to_ibge = build_tse_to_ibge()

    pres = CargoAccumulator()
    gov = CargoAccumulator()
    sen = CargoAccumulator()

    print('Lendo presidente (_BR.csv)...')
    for row in read_rows(os.path.join(CSV_DIR, 'votacao_candidato_munzona_1994_BR.csv')):
        if clean(row['CD_CARGO']) != CD_PRESIDENTE:
            continue
        uf = clean(row['SG_UF'])
        if uf not in ALL_UFS:
            continue
        pres.add(uf, clean(row['NR_TURNO']), row)

    # Nomes de urna dos presidenciaveis (curados em 1994/cand1994.json) — o TSE
    # nao registrou nome de urna em 1994.
    with open(os.path.join(BASE_DIR, '1994', 'cand1994.json'), encoding='utf-8') as f:
        cand_pres = json.load(f)
    urna_by_nr = {str(nr): info.get('nome_urna') for nr, info in cand_pres.items() if info.get('nome_urna')}
    for key, cand_map in pres.cand.items():
        for nr, entry in cand_map.items():
            if urna_by_nr.get(nr):
                entry[0] = urna_by_nr[nr]
    print('  Nomes de urna aplicados ao presidente: %s' % ', '.join(sorted(urna_by_nr.values())))

    for uf in ALL_UFS:
        path = os.path.join(CSV_DIR, 'votacao_candidato_munzona_1994_%s.csv' % uf)
        if not os.path.exists(path):
            print('  [AVISO] CSV ausente: %s' % path)
            continue
        print('Lendo %s...' % uf)
        for row in read_rows(path):
            cargo = clean(row['CD_CARGO'])
            if cargo == CD_GOVERNADOR:
                gov.add(uf, clean(row['NR_TURNO']), row)
            elif cargo == CD_SENADOR:
                sen.add(uf, clean(row['NR_TURNO']), row)

    # Detalhe de votacao (brancos, nulos, aptos, comparecimento) por municipio.
    print('Lendo detalhe_votacao (brancos/nulos/aptos)...')
    for row in read_rows(os.path.join(DETALHE_DIR, 'detalhe_votacao_munzona_1994_BR.csv')):
        if clean(row['CD_CARGO']) != CD_PRESIDENTE:
            continue
        uf = clean(row['SG_UF'])
        if uf in ALL_UFS:
            pres.add_detalhe(uf, clean(row['NR_TURNO']), row)
    for uf in ALL_UFS:
        path = os.path.join(DETALHE_DIR, 'detalhe_votacao_munzona_1994_%s.csv' % uf)
        if not os.path.exists(path):
            print('  [AVISO] detalhe ausente: %s' % path)
            continue
        for row in read_rows(path):
            cargo = clean(row['CD_CARGO'])
            if cargo == CD_GOVERNADOR:
                gov.add_detalhe(uf, clean(row['NR_TURNO']), row)
            elif cargo == CD_SENADOR:
                sen.add_detalhe(uf, clean(row['NR_TURNO']), row)

    # Coligacoes de governador (1994/coligações.txt, curadas) e do presidente
    # (cand1994.json) -> cand_names[3]/[4]; vice/coligacao vao tambem para o
    # detalhes_candidatos_1994.zip no formato data[UE][NOME] do site.
    detalhes = {'BR': {}}
    for nr, info in cand_pres.items():
        nome_urna = (info.get('nome_urna') or '').strip()
        if not nome_urna:
            continue
        colig = (info.get('nome_coligacao') or '').strip()
        comp = (info.get('composicao_coligacao') or '').strip()
        isolado = (not colig) or 'SEM COLIGA' in norm(colig)
        for key, cand_map in pres.cand.items():
            entry = cand_map.get(str(nr))
            if entry and not isolado:
                entry[3] = colig.upper()
                entry[4] = comp
        detalhes['BR'][norm_key(nome_urna)] = {
            'nome': nome_urna,
            'partido': info.get('partido') or '',
            'vice': info.get('nome_vice_completo') or info.get('nome_vice_urna') or '',
            'vice_partido': info.get('partido_vice') or '',
            'coligacao': None if isolado else colig,
            'composicao': None if isolado else comp,
        }

    coligacoes = parse_coligacoes()
    txt_usados = set()
    for (uf, turno), cand_map in sorted(gov.cand.items()):
        by_party = {}
        for idx, e in enumerate(coligacoes.get(uf, [])):
            by_party.setdefault(norm_sigla(e['partido']), (idx, e))
        for nr, entry in cand_map.items():
            match = by_party.get(norm_sigla(entry[1]))
            if not match:
                print('  [COLIG sem match] gov %s t%s nr %s %s (%s)'
                      % (uf, turno, nr, entry[0][:30], entry[1]))
                continue
            idx, e = match
            txt_usados.add((uf, idx))
            comp_display = ' / '.join(e['comp']) if e['comp'] else entry[1]
            if not e['isolado'] and e['comp']:
                entry[3] = (e['colig'] or comp_display).upper()
                entry[4] = comp_display
            det = detalhes.setdefault(uf, {})
            det[norm_key(entry[0])] = {
                'nome': entry[0],
                'partido': entry[1],
                'vice': e['vice'] or '',
                'vice_partido': e['vice_partido'] or '',
                'coligacao': None if (e['isolado'] or not e['comp']) else (e['colig'] or comp_display),
                'composicao': None if (e['isolado'] or not e['comp']) else comp_display,
            }
            # Cross-check de votacao (t1) contra o txt curado.
            if turno == '1' and e['votacao']:
                zip_total = sum(by_nr.get(nr, 0) for by_nr in gov.votes[(uf, turno)].values())
                if zip_total != e['votacao']:
                    print('  [COLIG votacao] gov %s nr %s: txt %s vs zip %s (dif %+d)'
                          % (uf, nr, format(e['votacao'], ',d'), format(zip_total, ',d'),
                             zip_total - e['votacao']))
    for uf, entries in coligacoes.items():
        for idx, e in enumerate(entries):
            if (uf, idx) not in txt_usados:
                print('  [COLIG txt sem candidato] %s %s (%s)' % (uf, e['colig'], e['partido']))

    detalhes_zip = os.path.join(BASE_DIR, 'resultados_geo', 'detalhes_candidatos_1994.zip')
    content = json.dumps(detalhes, ensure_ascii=False, separators=(',', ':'))
    with zipfile.ZipFile(detalhes_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('detalhes_candidatos_1994.json', content)
    print('  %s: %d UEs' % (detalhes_zip, len(detalhes)))

    print('Escrevendo zips...')
    emit(pres, 'presidente', tse_to_ibge, turnos=('1',))
    gov_emitted = emit(gov, 'governador', tse_to_ibge)
    emit(sen, 'senador', tse_to_ibge, turnos=('1',))

    print('UFs com 2º turno de governador: %s' % ', '.join(sorted(gov_emitted.get('2', []))))
    crosscheck_presidente(pres, tse_to_ibge)
    print('OK.')


if __name__ == '__main__':
    sys.exit(main())
