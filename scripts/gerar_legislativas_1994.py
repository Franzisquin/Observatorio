# -*- coding: utf-8 -*-
"""
Gera os arquivos das eleicoes LEGISLATIVAS de 1994 (Deputado Federal e
Estadual) no formato dos anos 2002-2022 do site, porem com votos por
MUNICIPIO (1994 nao tem dados por secao/local): RESULTS chaveado
"1_{cdMuniTSE}_M" — o mesmo esquema das majoritarias de 1994.

Voto de legenda: o TSE nao registrou isso nos CSVs de 1994 (as colunas
dedicadas do votacao_partido_munzona/detalhe_votacao_munzona vem zeradas em
todas as UFs), mas 1994/TSE_1994_voto_legenda.xlsx traz o total por UF+partido
(bate exatamente com o residual comparecimento-nominal-brancos-nulos dos CSVs
do TSE). E distribuido pelos municipios proporcional aos votos NOMINAIS do
mesmo partido ali (metodo historico do TSE p/ "conversao de legenda"); sem
candidato nominal na UF (raro, <0,15% do total), usa o comparecimento do
municipio como peso.

Limitacoes de 1994 (documentadas no guia do site):
- Sem composicao de coligacoes proporcionais (#NE em todos os datasets TSE) —
  o QE exibido pelo site e estimado.

Saidas em resultados_geo/Legislativas 1994/:
  deputados_federal_1994_{UF}.zip
  deputados_estadual_1994_{UF}.zip
  official_totals_1994.json (vagas oficiais + totais por partido)

Uso:
  py scripts/gerar_legislativas_1994.py
"""

import csv
import io
import json
import os
import sys
import zipfile
from collections import defaultdict

import pandas as pd

from gerar_majoritarias_1994 import clean, norm, norm_cd, build_tse_to_ibge, ALL_UFS
from coligacoes_1994 import parse_coligacoes, norm_sigla, UF_HEADERS, _norm as norm_uf_text

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_DIR = os.path.join(BASE_DIR, '1994', 'votacao_candidato_munzona_1994')
DETALHE_DIR = os.path.join(BASE_DIR, '1994')
OUT_DIR = os.path.join(BASE_DIR, 'resultados_geo', 'Legislativas 1994')
LEGENDA_XLSX = os.path.join(BASE_DIR, '1994', 'TSE_1994_voto_legenda.xlsx')

CARGO_DEF = {'6': 'federal', '7': 'estadual'}


def _round_half_up(x):
    """Arredondamento sempre-pra-cima em 0,5 (regra legal), diferente do
    banker's rounding do round() nativo do Python."""
    import math
    return math.floor(x + 0.5)


def _allocate_largest_remainder(total, weights):
    """Distribui um total inteiro pelos pesos (dict chave->peso>=0) pelo metodo
    do maior resto (Hamilton): a soma dos valores alocados fecha exatamente
    com `total`, sem perda/inflacao por arredondamento."""
    soma_pesos = sum(weights.values())
    if total <= 0 or soma_pesos <= 0:
        return {}
    exact = {k: total * w / soma_pesos for k, w in weights.items() if w > 0}
    floors = {k: int(v) for k, v in exact.items()}
    resto = total - sum(floors.values())
    if resto > 0:
        ordenado = sorted(exact.keys(), key=lambda k: exact[k] - floors[k], reverse=True)
        for k in ordenado[:resto]:
            floors[k] += 1
    return floors


def build_national_party_map():
    """norm_sigla(partido) -> (NR_PARTIDO, SG_PARTIDO). Numeros de partido sao
    nacionais (mesma sigla = mesmo numero em todo o Brasil), entao uma unica
    passada por todas as UFs resolve o numero mesmo quando o partido nao tem
    candidato na UF onde recebeu voto de legenda."""
    m = {}
    for uf in ALL_UFS:
        path = os.path.join(CSV_DIR, 'votacao_candidato_munzona_1994_%s.csv' % uf)
        if not os.path.exists(path):
            continue
        with io.open(path, encoding='latin-1', newline='') as f:
            for row in csv.DictReader(f, delimiter=';'):
                if CARGO_DEF.get(clean(row['CD_CARGO'])) is None:
                    continue
                partido = clean(row['SG_PARTIDO'])
                nr_partido = clean(row['NR_PARTIDO'])
                if partido and nr_partido:
                    m.setdefault(norm_sigla(partido), (nr_partido, partido))
    return m


def read_legend_votes():
    """{'federal'|'estadual': {uf: {sigla_norm: votacao}}} de
    1994/TSE_1994_voto_legenda.xlsx (o TSE nao registrou voto de legenda por
    partido nos CSVs — as colunas dedicadas vem zeradas; o total por UF/partido
    aqui bate exatamente com o residual comparecimento-nominal-brancos-nulos
    dos CSVs oficiais do TSE)."""
    out = {'federal': defaultdict(dict), 'estadual': defaultdict(dict)}
    if not os.path.exists(LEGENDA_XLSX):
        print('  [AVISO] %s nao encontrado — voto de legenda nao sera somado.' % LEGENDA_XLSX)
        return out
    sheet_to_cargo = {'Deputado Federal': 'federal', 'Deputado Estadual': 'estadual'}
    for sheet, cargo in sheet_to_cargo.items():
        df = pd.read_excel(LEGENDA_XLSX, sheet_name=sheet)
        for _, row in df.iterrows():
            uf = UF_HEADERS.get(norm_uf_text(str(row['UF']).rstrip(':')))
            if not uf:
                print('  [AVISO] UF nao reconhecida no xlsx (%s): %r' % (sheet, row['UF']))
                continue
            sigla_norm = norm_sigla(str(row['Legenda']))
            try:
                votos = int(row['Votação'])
            except (TypeError, ValueError):
                continue
            if votos > 0:
                out[cargo][uf][sigla_norm] = out[cargo][uf].get(sigla_norm, 0) + votos
    return out


def read_detalhe_uf(uf):
    """{type_label: {cd: [aptos, comparecimento, brancos, nulos, nominais]}}"""
    out = {'federal': defaultdict(lambda: [0, 0, 0, 0, 0]),
           'estadual': defaultdict(lambda: [0, 0, 0, 0, 0])}
    path = os.path.join(DETALHE_DIR, 'detalhe_votacao_munzona_1994_%s.csv' % uf)
    if not os.path.exists(path):
        print('  [AVISO] detalhe ausente: %s' % path)
        return out
    with io.open(path, encoding='latin-1', newline='') as f:
        for row in csv.DictReader(f, delimiter=';'):
            cargo = CARGO_DEF.get(clean(row['CD_CARGO']))
            if not cargo or clean(row['NR_TURNO']) != '1':
                continue
            cd = norm_cd(row['CD_MUNICIPIO'])
            if not cd:
                continue
            t = out[cargo][cd]
            for i, col in enumerate(['QT_APTOS', 'QT_COMPARECIMENTO', 'QT_VOTOS_BRANCOS',
                                     'QT_VOTOS_NULOS', 'QT_VOTOS_NOMINAIS_VALIDOS']):
                try:
                    v = int(row[col])
                except (TypeError, ValueError):
                    v = 0
                if v > 0:
                    t[i] += v
    return out


def read_vagas():
    """{(uf, type_label): qt_vaga} de consulta_vagas_1994_{UF}.csv.

    ATENCAO: o dataset do TSE rotula como "Deputado Estadual" (CD_CARGO 7) o que
    sao as vagas de Deputado FEDERAL (SP=70, BA=39, RS=31 — as bancadas federais)
    e nao traz linha para o estadual. Tratamos o cargo 7 como federal e derivamos
    o estadual pela formula constitucional (CF art. 27: 3x o federal ate 12
    deputados; acima disso, 36 + (federal - 12))."""
    vagas = {}
    for uf in ALL_UFS:
        path = os.path.join(DETALHE_DIR, 'consulta_vagas_1994_%s.csv' % uf)
        if not os.path.exists(path):
            continue
        with io.open(path, encoding='latin-1', newline='') as f:
            for row in csv.DictReader(f, delimiter=';'):
                if clean(row['CD_CARGO']) != '7':
                    continue
                try:
                    fed = int(row['QT_VAGA'])
                except (TypeError, ValueError):
                    continue
                vagas[(uf, 'federal')] = fed
                vagas[(uf, 'estadual')] = fed * 3 if fed <= 12 else 36 + (fed - 12)
    return vagas

SIT_PRIORITY = {
    '': 1,
    'SUPLENTE': 2,
    'INAPTO': 2,
    'NAO ELEITO': 3,
    'NÃO ELEITO': 3,
    'ELEITO POR QP': 4,
    'ELEITO POR MÉDIA': 4,
    'ELEITO POR MEDIA': 4,
    'ELEITO': 4,
    'MÉDIA': 4,
    'MEDIA': 4,
}

INAPTO_KEYWORDS = [
    'INAPTO', 'CASSADO', 'INELEGÍVEL', 'INELEGIVEL',
    'INDEFERIDO', 'FALECIMENTO', 'RENÚNCIA', 'RENUNCIA',
    'CANCELADO', 'NÃO CONHECIMENTO',
]


def get_sit_priority(sit):
    return SIT_PRIORITY.get(str(sit or '').strip().upper(), 1)


def resolve_status(sit_tot):
    sit_up = str(sit_tot or '').strip().upper()
    if any(k in sit_up for k in INAPTO_KEYWORDS) and 'COM RECURSO' not in sit_up:
        return 'INAPTO'
    return sit_up if sit_up else 'N/D'


def write_zip(zip_name, json_name, payload):
    os.makedirs(OUT_DIR, exist_ok=True)
    zip_path = os.path.join(OUT_DIR, zip_name)
    content = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(json_name, content)


def main():
    tse_to_ibge = build_tse_to_ibge()
    vagas = read_vagas()
    official_totals = {}
    details = {}
    details_priority = {}
    coligacoes = parse_coligacoes()
    national_party_map = build_national_party_map()
    legend_votes = read_legend_votes()

    for uf in ALL_UFS:
        path = os.path.join(CSV_DIR, 'votacao_candidato_munzona_1994_%s.csv' % uf)
        if not os.path.exists(path):
            print('  [AVISO] CSV ausente: %s' % path)
            continue
        print('Lendo %s...' % uf)

        # Collect standard TSE party names first
        tse_parties = {}
        with io.open(path, encoding='latin-1', newline='') as f:
            for row in csv.DictReader(f, delimiter=';'):
                partido = clean(row['SG_PARTIDO'])
                if partido:
                    tse_parties[norm_sigla(partido)] = partido

        # Build party-to-coalition mapping for this UF
        party_to_coalition = {}
        uf_coligs = coligacoes.get(uf, [])
        for e in uf_coligs:
            if not e['isolado'] and e['comp']:
                members = []
                for p in e['comp']:
                    norm_p = norm_sigla(p)
                    tse_name = tse_parties.get(norm_p, p.upper())
                    members.append(tse_name)
                sorted_members = sorted(members)
                id_str = '/'.join(sorted_members)
                raw_comp = ' / '.join(sorted_members)
                colig_name = (e['colig'] or raw_comp).upper()
                
                coalition_info = {
                    'id': id_str,
                    'raw_comp': raw_comp,
                    'name': colig_name,
                    'entries': e
                }
                for p in e['comp']:
                    party_to_coalition[norm_sigla(p)] = coalition_info

        # votes[type_label][cdMuni][nr] = votos ; cand[type_label][nr] = entry
        votes = {'federal': defaultdict(lambda: defaultdict(int)),
                 'estadual': defaultdict(lambda: defaultdict(int))}
        # nominal_by_party[cargo][sigla_norm][cd] = soma nominal — pesos para
        # distribuir o voto de legenda (TSE_1994_voto_legenda.xlsx) por municipio.
        nominal_by_party = {'federal': defaultdict(lambda: defaultdict(int)),
                             'estadual': defaultdict(lambda: defaultdict(int))}
        cand = {'federal': {}, 'estadual': {}}
        cand_pri = {'federal': {}, 'estadual': {}}
        muni_names = {}

        detalhe = read_detalhe_uf(uf)

        with io.open(path, encoding='latin-1', newline='') as f:
            for row in csv.DictReader(f, delimiter=';'):
                cargo = CARGO_DEF.get(clean(row['CD_CARGO']))
                if not cargo or clean(row['NR_TURNO']) != '1':
                    continue
                cd = norm_cd(row['CD_MUNICIPIO'])
                nr = clean(row['NR_CANDIDATO'])
                if not cd or not nr:
                    continue
                try:
                    v = int(row['QT_VOTOS_NOMINAIS'])
                except (TypeError, ValueError):
                    continue
                partido = clean(row['SG_PARTIDO'])
                if v >= 0:
                    votes[cargo][cd][nr] += v
                    nominal_by_party[cargo][norm_sigla(partido)][cd] += v

                nome_mun = clean(row['NM_MUNICIPIO'])
                if nome_mun and cd not in muni_names:
                    muni_names[cd] = nome_mun

                sit = clean(row['DS_SIT_TOT_TURNO'])
                pri = get_sit_priority(sit)
                # NM_URNA do re-export de 1994 e o nome completo truncado em 30
                # chars — usa o NM_CANDIDATO integral.
                nome = clean(row['NM_CANDIDATO']) or clean(row['NM_URNA_CANDIDATO'])
                norm_p = norm_sigla(partido)
                colig = clean(row['NM_COLIGACAO'])
                comp = clean(row['DS_COMPOSICAO_COLIGACAO']) or partido
                if norm_p in party_to_coalition:
                    c_info = party_to_coalition[norm_p]
                    colig = c_info['name']
                    comp = c_info['raw_comp']
                else:
                    colig = ""
                    comp = partido

                if pri > cand_pri[cargo].get(nr, -1):
                    cand[cargo][nr] = [nome, partido, resolve_status(sit), colig, comp]
                    cand_pri[cargo][nr] = pri
                if pri > details_priority.get(nr + '|' + uf + '|' + cargo, -1):
                    details[nr + '|' + uf + '|' + cargo] = {
                        'nome': nome,
                        'partido': partido,
                        'numero': nr,
                        'cargo': ('DEPUTADO FEDERAL' if cargo == 'federal' else 'DEPUTADO ESTADUAL'),
                        'situacao': resolve_status(sit),
                        'coligacao': colig,
                        'composicao': comp,
                        'uf': uf,
                    }
                    details_priority[nr + '|' + uf + '|' + cargo] = pri

        # Cross-check do nominal (sem legenda) contra o detalhe do TSE, ANTES
        # de aplicar a legenda (que o detalhe nao inclui nessas colunas).
        nominal_only_by_cargo = {
            cargo: sum(sum(by_nr.values()) for by_nr in by_mun.values())
            for cargo, by_mun in votes.items()
        }

        # Voto de legenda (TSE_1994_voto_legenda.xlsx, por UF+partido — o TSE
        # nao registrou isso nos CSVs): distribui pelos municipios proporcional
        # aos votos NOMINAIS do mesmo partido ali (metodo historico do TSE p/
        # "conversao de legenda"); sem candidato nominal na UF (raro, <0,15%
        # do total nacional), usa o comparecimento do municipio como peso.
        legend_cand_by_cargo = {'federal': {}, 'estadual': {}}
        for cargo in ('federal', 'estadual'):
            for sigla_norm, total_legenda in legend_votes[cargo].get(uf, {}).items():
                party_info = national_party_map.get(sigla_norm)
                if not party_info:
                    print('  [LEGENDA sem numero] %s %s %s: partido nao encontrado em nenhum candidato do Brasil'
                          % (uf, cargo, sigla_norm))
                    continue
                nr_partido, sigla_tse = party_info
                weights = {cd: w for cd, w in nominal_by_party[cargo].get(sigla_norm, {}).items()
                           if w > 0 and cd in muni_names}
                used_fallback = False
                if not weights:
                    weights = {cd: t[1] for cd, t in detalhe.get(cargo, {}).items()
                               if t[1] > 0 and cd in muni_names}
                    used_fallback = True
                if not weights:
                    print('  [LEGENDA sem alocar] %s %s %s: %d votos sem pesos disponiveis'
                          % (uf, cargo, sigla_norm, total_legenda))
                    continue
                alloc = _allocate_largest_remainder(total_legenda, weights)
                for cd, fatia in alloc.items():
                    if fatia > 0:
                        votes[cargo][cd][nr_partido] += fatia
                legend_cand_by_cargo[cargo][nr_partido] = sigla_tse
                if used_fallback:
                    print('  [LEGENDA fallback comparecimento] %s %s %s: %d votos (sem candidato nominal na UF)'
                          % (uf, cargo, sigla_norm, total_legenda))

        for cargo, by_mun in votes.items():
            if not by_mun:
                continue
            turnout = detalhe.get(cargo, {})
            results = {}
            muni_turnout = {}
            detalhe_nom = 0
            for cd, by_nr in by_mun.items():
                vmap = dict(sorted(by_nr.items()))
                t = turnout.get(cd)
                if t:
                    if t[2] > 0:
                        vmap['95'] = t[2]
                    if t[3] > 0:
                        vmap['96'] = t[3]
                    muni_turnout[cd] = [t[0], t[1]]
                    detalhe_nom += t[4]
                results['1_%s_M' % cd] = vmap
            # Votos validos = nominal + legenda (by_mun ja inclui a legenda
            # aplicada acima); 95/96 ficam só no vmap, nao entram aqui.
            munzona_nom = sum(sum(by_nr.values()) for by_nr in by_mun.values())
            if detalhe_nom and nominal_only_by_cargo[cargo] != detalhe_nom:
                print('  [DIVERGENCIA detalhe] %s %s: munzona (so nominal) %d vs detalhe %d'
                      % (cargo, uf, nominal_only_by_cargo[cargo], detalhe_nom))
            names = {cd: nome for cd, nome in muni_names.items() if cd in by_mun}
            muni_ibge = {}
            for cd, nome in names.items():
                ibge = tse_to_ibge(norm(nome), uf)
                if ibge:
                    muni_ibge[cd] = ibge
            cand_names = dict(cand[cargo])
            for nr_partido, sigla_tse in legend_cand_by_cargo.get(cargo, {}).items():
                if nr_partido in cand_names:
                    continue
                norm_p = norm_sigla(sigla_tse)
                if norm_p in party_to_coalition:
                    c_info = party_to_coalition[norm_p]
                    colig, comp = c_info['name'], c_info['raw_comp']
                else:
                    colig, comp = '', sigla_tse
                cand_names[nr_partido] = ['', sigla_tse, 'LEGENDA', colig, comp]
            cand_names['95'] = ['VOTO BRANCO', '', 'BRANCO', '', '']
            cand_names['96'] = ['VOTO NULO', '', 'NULO', '', '']
            payload = {
                'METADATA': {
                    'cand_names': cand_names,
                    'coalition_adjustments': {},
                    'muni_names': names,
                    'muni_ibge': muni_ibge,
                    'muni_turnout': muni_turnout,
                },
                'RESULTS': results,
            }
            base = 'deputados_%s_1994_%s' % (cargo, uf)
            write_zip(base + '.zip', base + '.json', payload)
            print('  %s: %d municipios, %d candidatos' % (base, len(results), len(cand[cargo])))

            # official_totals: vagas oficiais + validos nominais + votos por partido/coligacao.
            type_key = 'f' if cargo == 'federal' else 'e'
            group_votes = defaultdict(int)
            group_raw_comp = {}
            for by_nr in by_mun.values():
                for nr, v in by_nr.items():
                    # cand_names ja inclui as entradas de legenda (indice 1 = sigla).
                    sigla = (cand_names.get(nr) or ['', ''])[1] or nr[:2]
                    norm_sig = norm_sigla(sigla)
                    if norm_sig in party_to_coalition:
                        c_info = party_to_coalition[norm_sig]
                        g_id = c_info['id']
                        g_raw = c_info['raw_comp']
                    else:
                        g_id = sigla
                        g_raw = sigla
                    group_votes[g_id] += v
                    group_raw_comp[g_id] = g_raw

            qt_brancos_total = sum(t[2] for t in turnout.values())
            entry = {
                'stats': {
                    'qt_votos_validos': munzona_nom,
                    'qt_brancos': qt_brancos_total,
                },
                'coalitions': [
                    {'id': g_id, 'raw_comp': group_raw_comp[g_id], 'votes': v}
                    for g_id, v in sorted(group_votes.items(), key=lambda kv: -kv[1])
                ],
            }
            if (uf, cargo) in vagas:
                entry['stats']['qt_vagas'] = vagas[(uf, cargo)]
                entry['stats']['vr_qe'] = _round_half_up((munzona_nom + qt_brancos_total) / vagas[(uf, cargo)])
            official_totals.setdefault(uf, {})[type_key] = entry

    # Vagas oficiais (consulta_vagas) + totais por partido para o painel proporcional.
    with open(os.path.join(OUT_DIR, 'official_totals_1994.json'), 'w', encoding='utf-8') as f:
        json.dump(official_totals, f, ensure_ascii=False, separators=(',', ':'))
    print('  official_totals_1994.json: %d UFs' % len(official_totals))

    # O detalhes_candidatos_1994.zip (formato data[UE][NOME] consumido por
    # ensureCandidateDetails) e gerado por gerar_majoritarias_1994.py, que tem
    # as coligacoes/vices de governador e presidente. Nao gravar aqui.
    print('OK.')


if __name__ == '__main__':
    sys.exit(main())
