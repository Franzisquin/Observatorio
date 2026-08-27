# -*- coding: utf-8 -*-
"""
Gera os arquivos das eleicoes LEGISLATIVAS de 1998 (Deputado Federal, Estadual e
Distrital) no mesmo formato JSON-em-ZIP das gerais de 2002-2022 do site.

Fonte: os arquivos POR SECAO do TSE (Resultados 1998/votacao_secao_1998_{UF}.zip),
os mesmos que ja alimentam as majoritarias de 1998. Como em 1998 o TSE nao
registrou NR_LOCAL_VOTACAO (vem -3 em todas as linhas), a geolocalizacao reusa,
sem alterar, o mapa (UF, zona, secao) -> local de 2006 de
gerar_majoritarias_1998.py: a secao que casa vira a chave "{zona}_{cdmun}_{local}"
-- a mesma dos pontos do GPKG 2006 -- e a que nao casa recebe a chave sintetica
"{zona}_{cdmun}_S{secao}", que nunca bate num ponto mas entra no total do
municipio. Assim o mapa de deputado usa exatamente os mesmos pontos que o de
presidente/governador/senador do ano, e o total por municipio continua real.

Metadados (nome de urna, sigla, coligacao, composicao e situacao) vem de
consulta_cand_1998: o NM_VOTAVEL das secoes de 1998 traz o nome COMPLETO, nao o de
urna. Diferente de 1994, 1998 ja tem composicao de coligacao proporcional no
dataset do TSE, entao o agrupamento por coligacao e o mesmo de 2002 (chave =
composicao normalizada e ordenada).

O voto de legenda tambem ja vem nas proprias secoes (NR_VOTAVEL de dois digitos),
sem precisar do rateio que 1994 exigiu.

official_totals_1998.json usa os numeros OFICIAIS do TSE, e nao a soma das secoes
(que o proprio TSE declara incompleta em 1998):
  - votos por coligacao: votacao_partido_munzona_1998 (nominais + legenda validos);
  - votos validos da UF:  detalhe_votacao_munzona_1998 (QT_TOTAL_VOTOS_VALIDOS);
  - vagas:                consulta_vagas_1998;
  - QE:                   Codigo Eleitoral art. 106 sobre os validos. Em 1998 o
                          voto em branco ja NAO e valido (Lei 9.504/1997, art. 5o),
                          ao contrario de 1994.

Saidas em resultados_geo/Legislativas 1998/:
  deputados_federal_1998_{UF}.zip
  deputados_estadual_1998_{UF}.zip   (no DF, o cargo 8 - Deputado Distrital)
  official_totals_1998.json

Uso:
  py scripts/gerar_legislativas_1998.py --ufs AC
  py scripts/gerar_legislativas_1998.py              (todas as UFs)
"""

import argparse
import csv
import io
import json
import os
import re
import sys
import unicodedata
import zipfile
from collections import defaultdict

from gerar_majoritarias_1998 import (ALL_UFS, SECOES_DIR, load_geo_keys,
                                     load_section_to_local_2006)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(BASE_DIR, 'resultados_geo', 'Legislativas 1998')

CONSULTA_ZIP = os.path.join(SECOES_DIR, 'consulta_cand_1998.zip')
VAGAS_ZIP = os.path.join(SECOES_DIR, 'consulta_vagas_1998.zip')
PARTIDO_ZIP = os.path.join(SECOES_DIR, 'votacao_partido_munzona_1998.zip')
DETALHE_ZIP = os.path.join(SECOES_DIR, 'detalhe_votacao_munzona_1998.zip')

# O DF usa CD_CARGO 8 (Deputado Distrital), mapeado como estadual -- igual a 2002.
CARGO_DEF = {'6': 'federal', '7': 'estadual', '8': 'estadual'}
TIPOS = ('federal', 'estadual')
TYPE_KEY = {'federal': 'f', 'estadual': 'e'}

_NE = ('#NE', '#NE#', '#NULO', '#NULO#', '-3', '-1', '')


def _clean(valor):
    texto = str(valor or '').strip()
    return '' if texto.upper() in _NE else texto


def _fold(texto):
    """Maiusculas sem acento. As situacoes do TSE chegam de um CSV latin-1 e sao
    comparadas com literais de um fonte UTF-8; comparar sem acento tira do caminho
    tanto a normalizacao Unicode quanto as variantes 'MEDIA'/'MEDIA' do acervo."""
    decomposto = unicodedata.normalize('NFD', str(texto or ''))
    return ''.join(c for c in decomposto
                   if unicodedata.category(c) != 'Mn').upper().strip()


# Prioridade de DS_SIT_TOT_TURNO na deduplicacao -- numero maior vence. Mesma
# tabela de 2002 (comparada sem acento), com 'MEDIA' porque em 1998 o TSE grava o
# eleito por sobra apenas como "MEDIA", como tambem faz em 2006 e 2010.
SIT_PRIORITY = {
    '#NULO': 0,
    '#NULO#': 0,
    '': 1,
    'SUPLENTE': 2,
    'INAPTO': 2,
    'NAO ELEITO': 3,
    'ELEITO POR QP': 4,
    'ELEITO POR MEDIA': 4,
    'ELEITO': 4,
    'MEDIA': 4,
}

# Termos de candidatura rejeitada ou extinta, sem acento. Os de 2002 mais as
# grafias que 1998 usa para os mesmos casos: 'CANCELAMENTO DO PEDIDO',
# 'FALECIDO', 'HOMOLOGACAO DE DESISTENCIA' e 'REGISTRO NEGADO'.
INAPTO_KEYWORDS = [
    'INAPTO', 'CASSAD', 'INELEGIVEL', 'INDEFERIDO', 'FALECIMENTO', 'FALECID',
    'RENUNCIA', 'CANCELADO', 'CANCELAMENTO', 'NAO CONHECIMENTO', 'DESISTENCIA',
    'REGISTRO NEGADO',
]


def get_sit_priority(sit_tot):
    return SIT_PRIORITY.get(_fold(sit_tot), 1)


def is_eleito(sit_tot):
    """Situacao de totalizacao que significa cadeira conquistada. Em 1998 o TSE
    grava 'ELEITO' (quociente partidario) e 'MEDIA' (sobras)."""
    sit = _fold(sit_tot)
    if 'NAO ELEITO' in sit:
        return False
    return 'ELEITO' in sit or 'MEDIA' in sit


def resolve_status(sit_tot, sit_cand):
    """Situacao final do candidato, no mesmo criterio de 2002: preserva o
    DS_SIT_TOT_TURNO do TSE e so troca por 'INAPTO' quando a candidatura foi
    rejeitada ou extinta.

    Em 1998 o detalhe da candidatura vem em DS_SITUACAO_CANDIDATURA (DEFERIDO /
    INDEFERIDO / RENUNCIA / ...); DS_DETALHE_SITUACAO_CAND e '#NE' no arquivo
    inteiro. E essa coluna, portanto, que faz o papel do detalhe de 2002.

    Diferenca deliberada em relacao a 2002: quando o TSE totalizou o candidato
    como ELEITO ou MEDIA, a situacao eleita prevalece. Em 2002 o conflito nao
    aparece (renuncia/indeferimento zeram o DS_SIT_TOT_TURNO para '#NULO#'), mas
    em 1998 o TSE manteve a situacao real de quem tomou posse e so depois morreu,
    renunciou ou ficou sub judice -- marcar de INAPTO apagaria oito deputados
    eleitos de verdade, entre eles Atila Lins (AM) e Mauricio Fruet (PR).
    """
    sit_up = str(sit_tot or '').strip().upper()
    if not is_eleito(sit_tot):
        alvos = (_fold(sit_tot), _fold(sit_cand))
        inapto = any(k in alvo for alvo in alvos for k in INAPTO_KEYWORDS)
        com_recurso = any('COM RECURSO' in alvo for alvo in alvos)
        if inapto and not com_recurso:
            return 'INAPTO'

    return sit_up if sit_up not in ('#NULO#', '#NULO', '') else 'N/D'


def normalize_comp(comp_str):
    """Chave de agrupamento da coligacao: siglas em maiusculas, ordenadas e unidas
    por '/'. Mesma normalizacao de 2002 (e do normalizeComp do site)."""
    partes = [p.strip().upper() for p in str(comp_str or '').split('/')]
    return '/'.join(sorted(p for p in partes if p))


def norm_sigla(sigla):
    """'PC do B' / 'PCdoB' / 'PC DO B' -> 'PCDOB'. Mesma normalizacao de
    coligacoes_1994.norm_sigla: serve para casar a sigla de um partido com a que
    aparece escrita dentro da composicao da coligacao."""
    return re.sub(r'[^A-Z0-9]', '', _fold(sigla))


def membros_da_composicao(comp_str):
    """Siglas normalizadas de uma composicao com dois ou mais partidos; lista vazia
    para partido isolado."""
    partes = [p.strip() for p in str(comp_str or '').split('/')]
    partes = [p for p in partes if p]
    return [norm_sigla(p) for p in partes] if len(partes) >= 2 else []


def quociente_eleitoral(validos, vagas):
    """CE art. 106: votos validos / vagas, "desprezada a fracao se igual ou
    inferior a meio, equivalente a um, se superior". Em inteiros, para nao
    depender do arredondamento binario do float."""
    if not vagas or validos <= 0:
        return 0
    inteiro, resto = divmod(validos, vagas)
    return inteiro + (1 if resto * 2 > vagas else 0)


# ----------------------------------------------------------------------------
# Leitura dos CSVs (todos latin-1, separados por ';')
# ----------------------------------------------------------------------------

def _has_member(zip_path, member):
    if not os.path.exists(zip_path):
        return False
    with zipfile.ZipFile(zip_path) as zf:
        return member in zf.namelist()


def _iter_csv(zip_path, member):
    """Percorre um CSV de dentro do ZIP em streaming: o de secoes de SP passa de
    1 GB descompactado, entao carregar tudo em memoria esta fora de questao."""
    with zipfile.ZipFile(zip_path) as zf:
        with zf.open(member) as fh:
            texto = io.TextIOWrapper(fh, encoding='latin-1', newline='')
            for row in csv.DictReader(texto, delimiter=';'):
                yield row


def _int(valor, padrao=0):
    try:
        return int(str(valor).strip())
    except (TypeError, ValueError):
        return padrao


def read_vagas():
    """{(uf, tipo): vagas} de consulta_vagas_1998."""
    vagas = {}
    if not os.path.exists(VAGAS_ZIP):
        print(f'  [AVISO] {VAGAS_ZIP} nao encontrado; official_totals sem vagas/QE.')
        return vagas
    for uf in ALL_UFS:
        membro = f'consulta_vagas_1998_{uf}.csv'
        if not _has_member(VAGAS_ZIP, membro):
            print(f'  [AVISO] {membro} ausente no zip de vagas.')
            continue
        for row in _iter_csv(VAGAS_ZIP, membro):
            tipo = CARGO_DEF.get(_clean(row.get('CD_CARGO')))
            qt = _int(row.get('QT_VAGAS'))
            if tipo and qt > 0:
                vagas[(uf, tipo)] = qt
    return vagas


def _meta_vazia():
    return {tipo: {'cand': {}, 'legendas': {}, 'grupos': {}, 'membros': {},
                   'eleitos': defaultdict(lambda: [0, 0])} for tipo in TIPOS}


def read_consulta_cand(uf):
    """Metadados de candidato da UF, por tipo de cargo.

    {tipo: {'cand':     {num: [urna, sigla, status, coligacao, composicao]},
            'legendas': {nr_partido: ['', sigla, 'LEGENDA', coligacao, composicao]},
            'grupos':   {nr_partido: (id_grupo, composicao)},
            'membros':  {sigla_norm: (id_grupo, composicao, coligacao)},
            'eleitos':  {id_grupo: [eleitos_por_qp, eleitos_por_media]}}}
    """
    meta = _meta_vazia()
    membro = f'consulta_cand_1998_{uf}.csv'
    if not _has_member(CONSULTA_ZIP, membro):
        print(f'  [AVISO] {membro} nao encontrado; UF sem nome de urna/coligacao.')
        return meta

    prioridade = {tipo: {} for tipo in TIPOS}
    # Um numero pode ter dois registros quando houve substituicao (em SP 1998 o
    # 25005 estadual e Alfredo Penha, que renunciou, e Agripino, que assumiu).
    # A cadeira e uma so: guarda um eleito por numero e soma depois.
    eleitos_por_num = {tipo: {} for tipo in TIPOS}
    for row in _iter_csv(CONSULTA_ZIP, membro):
        tipo = CARGO_DEF.get(_clean(row.get('CD_CARGO')))
        if not tipo or _clean(row.get('NR_TURNO')) != '1':
            continue
        num = _clean(row.get('NR_CANDIDATO'))
        if not num.isdigit():
            continue
        num = str(int(num))

        sigla = _clean(row.get('SG_PARTIDO'))
        colig = _clean(row.get('NM_COLIGACAO'))
        comp = _clean(row.get('DS_COMPOSICAO_COLIGACAO')) or sigla
        sit_tot = row.get('DS_SIT_TOT_TURNO')
        status = resolve_status(sit_tot, row.get('DS_SITUACAO_CANDIDATURA'))
        nome = _clean(row.get('NM_URNA_CANDIDATO')) or _clean(row.get('NM_CANDIDATO'))

        alvo = meta[tipo]
        # Desempate entre registros de mesma situacao de totalizacao: quem esta com
        # a candidatura deferida vence -- e o que de fato ocupou a cadeira.
        pri = (get_sit_priority(sit_tot), 1 if _fold(row.get('DS_SITUACAO_CANDIDATURA')) == 'DEFERIDO' else 0)
        if pri > prioridade[tipo].get(num, (-1, -1)):
            alvo['cand'][num] = [nome, sigla, status, colig, comp]
            prioridade[tipo][num] = pri
            if is_eleito(sit_tot):
                eleitos_por_num[tipo][num] = (normalize_comp(comp),
                                              1 if 'MEDIA' in _fold(sit_tot) else 0)
            else:
                eleitos_por_num[tipo].pop(num, None)

        nr_partido = _clean(row.get('NR_PARTIDO'))
        if nr_partido.isdigit():
            nr_partido = str(int(nr_partido))
            if len(nr_partido) <= 2:
                alvo['legendas'].setdefault(nr_partido, ['', sigla, 'LEGENDA', colig, comp])
                alvo['grupos'].setdefault(nr_partido, (normalize_comp(comp), comp))

        # Indice partido -> coligacao a que ele pertence naquele cargo, montado a
        # partir da propria composicao. E o que resolve o partido que so tem voto
        # de legenda: ele nao aparece como candidato, mas esta escrito dentro da
        # composicao dos que aparecem. Mesmo mecanismo do party_to_coalition de
        # gerar_legislativas_1994.py.
        for membro_sigla in membros_da_composicao(comp):
            alvo['membros'].setdefault(membro_sigla, (normalize_comp(comp), comp, colig))

    for tipo, eleitos in eleitos_por_num.items():
        for gid, idx in eleitos.values():
            meta[tipo]['eleitos'][gid][idx] += 1

    return meta


def resolver_partidos_sem_candidato(meta_tipo, siglas_munzona):
    """Completa 'legendas' e 'grupos' com os partidos que tiveram voto de legenda
    mas nenhum candidato daquele cargo na UF (o consulta_cand nao os registra).

    A sigla da epoca vem do votacao_partido_munzona, mas a COLIGACAO nunca: em 1998
    a coluna DS_COMPOSICAO_COLIGACAO desse arquivo e inconsistente nas linhas de
    deputado -- o mesmo partido aparece ora como 'PARTIDO ISOLADO', ora com a
    composicao da coligacao MAJORITARIA do estado (em AC, a de 12 partidos do
    governador nas linhas de deputado federal, que so teve 9). A unica fonte
    confiavel da coligacao proporcional e o consulta_cand, e o criterio e estar
    escrito na composicao de uma delas: e la que o voto de legenda e computado.
    Partido que nao aparece em nenhuma concorreu isolado.
    """
    for nr_partido, sigla in siglas_munzona.items():
        if nr_partido in meta_tipo['grupos']:
            continue
        grupo = meta_tipo['membros'].get(norm_sigla(sigla))
        if grupo:
            gid, comp, colig = grupo
        else:
            gid, comp, colig = normalize_comp(sigla) or sigla, sigla or nr_partido, ''
        meta_tipo['grupos'][nr_partido] = (gid, comp)
        if len(nr_partido) <= 2:
            meta_tipo['legendas'].setdefault(nr_partido,
                                             ['', sigla or nr_partido, 'LEGENDA', colig, comp])


def read_votos_oficiais(uf):
    """({tipo: {nr_partido: votos}}, {tipo: {nr_partido: sigla}}) de
    votacao_partido_munzona_1998: nominais validos + legenda validos, turno 1.

    So a sigla e aproveitada daqui; a composicao da coligacao vem do consulta_cand
    (ver resolver_partidos_sem_candidato)."""
    votos = {tipo: defaultdict(int) for tipo in TIPOS}
    siglas = {tipo: {} for tipo in TIPOS}
    membro = f'votacao_partido_munzona_1998_{uf}.csv'
    # O TSE nao publicou o arquivo por UF do DF neste dataset; as linhas do DF so
    # existem dentro do consolidado nacional, entao ele entra filtrado por SG_UF.
    filtrar_uf = not _has_member(PARTIDO_ZIP, membro)
    if filtrar_uf:
        membro = 'votacao_partido_munzona_1998_BRASIL.csv'
        if not _has_member(PARTIDO_ZIP, membro):
            print(f'  [AVISO] votacao_partido_munzona de {uf} nao encontrado; '
                  'official_totals sem coligacoes.')
            return votos, siglas
    for row in _iter_csv(PARTIDO_ZIP, membro):
        if filtrar_uf and _clean(row.get('SG_UF')) != uf:
            continue
        tipo = CARGO_DEF.get(_clean(row.get('CD_CARGO')))
        if not tipo or _clean(row.get('NR_TURNO')) != '1':
            continue
        nr_partido = _clean(row.get('NR_PARTIDO'))
        if not nr_partido.isdigit():
            continue
        nr_partido = str(int(nr_partido))
        votos[tipo][nr_partido] += (max(0, _int(row.get('QT_VOTOS_NOMINAIS_VALIDOS')))
                                    + max(0, _int(row.get('QT_TOTAL_VOTOS_LEG_VALIDOS'))))
        sigla = _clean(row.get('SG_PARTIDO'))
        if sigla:
            siglas[tipo].setdefault(nr_partido, sigla)
    return votos, siglas


def read_validos_oficiais(uf):
    """{tipo: votos validos da UF} de detalhe_votacao_munzona_1998 (turno 1)."""
    validos = {tipo: 0 for tipo in TIPOS}
    membro = f'detalhe_votacao_munzona_1998_{uf}.csv'
    if not _has_member(DETALHE_ZIP, membro):
        print(f'  [AVISO] {membro} nao encontrado; QE cai na soma das coligacoes.')
        return validos
    for row in _iter_csv(DETALHE_ZIP, membro):
        tipo = CARGO_DEF.get(_clean(row.get('CD_CARGO')))
        if not tipo or _clean(row.get('NR_TURNO')) != '1':
            continue
        validos[tipo] += max(0, _int(row.get('QT_TOTAL_VOTOS_VALIDOS')))
    return validos


def read_secoes(uf, sec2local, geo_keys):
    """Agrega o arquivo por secao da UF.

    {tipo: {'results': {chave: {num: votos}}, 'nomes': {num: NM_VOTAVEL}}}
    """
    zip_path = os.path.join(SECOES_DIR, f'votacao_secao_1998_{uf}.zip')
    if not os.path.exists(zip_path):
        print(f'  [AVISO] {os.path.basename(zip_path)} nao encontrado.')
        return None

    with zipfile.ZipFile(zip_path) as zf:
        membros = [n for n in zf.namelist() if n.lower().endswith('.csv')]
    if not membros:
        print(f'  [AVISO] {os.path.basename(zip_path)} sem CSV dentro.')
        return None

    saida = {tipo: {'results': defaultdict(lambda: defaultdict(int)), 'nomes': {}}
             for tipo in TIPOS}

    for row in _iter_csv(zip_path, membros[0]):
        tipo = CARGO_DEF.get(_clean(row.get('CD_CARGO')))
        if not tipo or _clean(row.get('NR_TURNO')) != '1':
            continue
        num = _clean(row.get('NR_VOTAVEL'))
        if not num.isdigit():
            continue
        num = str(int(num))
        cd = _int(row.get('CD_MUNICIPIO'), -1)
        zona = _int(row.get('NR_ZONA'), -1)
        secao = _int(row.get('NR_SECAO'), -1)
        votos = _int(row.get('QT_VOTOS'))
        if cd < 0 or zona < 0 or secao < 0 or votos <= 0:
            continue

        local = sec2local.get((uf, zona, secao))
        if local is not None and (zona, local) in geo_keys:
            chave = f'{zona}_{cd}_{local}'
        else:
            chave = f'{zona}_{cd}_S{secao}'
        saida[tipo]['results'][chave][num] += votos

        nome = _clean(row.get('NM_VOTAVEL'))
        if nome and num not in saida[tipo]['nomes']:
            saida[tipo]['nomes'][num] = nome

    return saida


# ----------------------------------------------------------------------------
# Montagem dos payloads
# ----------------------------------------------------------------------------

def build_cand_names(meta_tipo, nomes_secao, numeros_votados):
    """cand_names[num] = [nome_urna, sigla, status, coligacao, composicao].

    Base: consulta_cand (nome de urna e coligacao da epoca). Quem aparece na urna
    e nao esta no cadastro cai no NM_VOTAVEL da propria secao, marcado 'EXTRAIDO'
    -- mesmo tratamento do verify_and_fix_names de 2002/2006.
    """
    cand_names = {num: list(entrada) for num, entrada in meta_tipo['cand'].items()}
    for num, entrada in meta_tipo['legendas'].items():
        cand_names.setdefault(num, list(entrada))

    for num in numeros_votados:
        if num in cand_names or num in ('95', '96', '97'):
            continue
        prefixo = num[:2]
        legenda = meta_tipo['legendas'].get(prefixo)
        sigla = legenda[1] if legenda else prefixo
        colig = legenda[3] if legenda else ''
        comp = legenda[4] if legenda else ''
        if len(num) <= 2:
            cand_names[num] = ['', sigla, 'LEGENDA', colig, comp]
        else:
            cand_names[num] = [nomes_secao.get(num) or f'Candidato {num}', sigla,
                               'EXTRAÍDO', colig, comp]

    cand_names['95'] = ['VOTO BRANCO', '', 'BRANCO', '', '']
    cand_names['96'] = ['VOTO NULO', '', 'NULO', '', '']
    if '97' in numeros_votados:
        cand_names['97'] = ['VOTO NULO', '', 'NULO', '', '']
    return cand_names


def build_official_entry(uf, tipo, meta_tipo, votos_oficiais, siglas_oficiais,
                         validos_oficiais, vagas):
    """Entrada de official_totals_1998.json para uma UF e cargo, no mesmo formato
    de 2002: stats (vagas, QE, validos) + coligacoes ordenadas por votos."""
    votos_por_grupo = defaultdict(int)
    raw_por_grupo = {}
    for nr_partido, total in votos_oficiais.items():
        # resolver_partidos_sem_candidato ja garantiu grupo para todo partido com
        # voto oficial, inclusive os que so tiveram legenda.
        gid, raw = meta_tipo['grupos'].get(nr_partido) or ('', '')
        if not gid:
            gid = raw = siglas_oficiais.get(nr_partido) or nr_partido
        votos_por_grupo[gid] += total
        raw_por_grupo.setdefault(gid, raw)

    qt_vagas = vagas.get((uf, tipo), 0)
    qt_validos = validos_oficiais or sum(votos_por_grupo.values())
    qe = quociente_eleitoral(qt_validos, qt_vagas)

    coligacoes = []
    for gid, total in sorted(votos_por_grupo.items(), key=lambda kv: -kv[1]):
        eleitos = meta_tipo['eleitos'].get(gid, [0, 0])
        coligacoes.append({
            'id': gid,
            'raw_comp': raw_por_grupo.get(gid, gid),
            'votes': total,
            'elected': eleitos[0] + eleitos[1],
            'elected_qp': eleitos[0],
            'elected_avg': eleitos[1],
            'vagas_qp': (total // qe) if qe > 0 else 0,
        })

    return {
        'stats': {'qt_vagas': qt_vagas, 'vr_qe': qe, 'qt_votos_validos': qt_validos},
        'coalitions': coligacoes,
    }


def write_zip(zip_name, json_name, payload):
    os.makedirs(OUT_DIR, exist_ok=True)
    zip_path = os.path.join(OUT_DIR, zip_name)
    conteudo = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(json_name, conteudo)
    return zip_path


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ufs', default=','.join(ALL_UFS))
    args = ap.parse_args()
    ufs = [u.strip().upper() for u in args.ufs.split(',') if u.strip()]

    if not os.path.isdir(SECOES_DIR):
        print(f'[ERRO] pasta dos brutos de 1998 nao encontrada: {SECOES_DIR}')
        return 1

    os.makedirs(OUT_DIR, exist_ok=True)
    sec2local = load_section_to_local_2006(ufs)
    vagas = read_vagas()

    caminho_totais = os.path.join(OUT_DIR, 'official_totals_1998.json')
    official_totals = {}
    if os.path.exists(caminho_totais):
        # Rodar so algumas UFs nao pode apagar o que ja foi gerado nas outras.
        with io.open(caminho_totais, encoding='utf-8') as fh:
            official_totals = json.load(fh)

    for uf in ufs:
        print(f'\n[{uf} 1998]')
        geo_keys = load_geo_keys(uf)
        meta = read_consulta_cand(uf)
        secoes = read_secoes(uf, sec2local, geo_keys)
        votos_oficiais, siglas_oficiais = read_votos_oficiais(uf)
        validos_oficiais = read_validos_oficiais(uf)
        for tipo in TIPOS:
            resolver_partidos_sem_candidato(meta[tipo], siglas_oficiais[tipo])

        for tipo in TIPOS:
            entry = build_official_entry(uf, tipo, meta[tipo], votos_oficiais[tipo],
                                         siglas_oficiais[tipo], validos_oficiais[tipo],
                                         vagas)
            if entry['coalitions'] or entry['stats']['qt_vagas']:
                official_totals.setdefault(uf, {})[TYPE_KEY[tipo]] = entry

            if not secoes:
                continue
            results = secoes[tipo]['results']
            if not results:
                continue

            numeros = set()
            for por_num in results.values():
                numeros.update(por_num)
            cand_names = build_cand_names(meta[tipo], secoes[tipo]['nomes'], numeros)

            payload = {
                'METADATA': {'cand_names': cand_names, 'coalition_adjustments': {}},
                'RESULTS': {k: dict(sorted(v.items())) for k, v in results.items()},
            }
            base = f'deputados_{tipo}_1998_{uf}'
            write_zip(base + '.zip', base + '.json', payload)

            n_geo = sum(1 for k in results if '_S' not in k)
            n_sint = len(results) - n_geo
            # Conferencia contra o total oficial. Voto em candidato INAPTO sai da
            # soma porque o TSE o anulou na totalizacao, mas ele continua gravado
            # nominalmente na secao -- e exatamente o que o "Filtrar Inaptos" do
            # site tira depois.
            soma_secoes = inaptos_secoes = 0
            for por_num in results.values():
                for num, v in por_num.items():
                    if num in ('95', '96', '97'):
                        continue
                    if (cand_names.get(num) or ['', '', ''])[2] == 'INAPTO':
                        inaptos_secoes += v
                    else:
                        soma_secoes += v
            oficial = entry['stats']['qt_votos_validos']
            cobertura = (100.0 * soma_secoes / oficial) if oficial else 0.0
            print(f'    {base}: {len(results)} chaves ({n_geo} geoloc / {n_sint} sinteticas), '
                  f'{len(cand_names)} numeros, {soma_secoes} validos nas secoes '
                  f'= {cobertura:.1f}% do oficial ({oficial})'
                  f'{f" [+{inaptos_secoes} em inaptos]" if inaptos_secoes else ""}; '
                  f'QE {entry["stats"]["vr_qe"]} em {entry["stats"]["qt_vagas"]} vagas')

    with io.open(caminho_totais, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(official_totals, fh, ensure_ascii=False, separators=(',', ':'))
    print(f'\nofficial_totals_1998.json: {len(official_totals)} UFs')
    print('Concluido! Arquivos em:', OUT_DIR)
    return 0


if __name__ == '__main__':
    sys.exit(main())
