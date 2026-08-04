# -*- coding: utf-8 -*-
"""
Gera os dados da eleicao PRESIDENCIAL de 1989 (dois turnos) no formato
JSON-em-ZIP das gerais do site, no mesmo padrao de 1994.

Como 1994, 1989 nao tem dados por secao/local de votacao: o resultado existe
apenas por MUNICIPIO. Cada municipio vira UMA chave sintetica de RESULTS no
formato "1_{ibge7}_M" (3 partes, parts[1] = codigo, exigido pelos helpers 2002
do site). No site, todas as features de 1989 sao sinteticas (geometry:null) e o
mapa e o coropletico da malha 1989 (resultados_geo/municipios_1989/, gerada por
scripts/gerar_malha_svg.py 1989).

Diferenca em relacao a 1994: a fonte NAO e o re-export munzona do TSE (que nao
cobre 1989), e sim 1989/resultado1989.{1,2}.json — ja agregados por municipio e
ja chaveados por codigo IBGE-7, entao nao ha join por nome. Os nomes de urna,
partidos, vices e coligacoes vem de 1989/cand1989.json (curado).

METADATA de cada JSON:
  cand_names[nr] = [NOME_URNA, SG_PARTIDO, SITUACAO, NM_COLIGACAO, COMPOSICAO]
  muni_names     = {ibge7: NM_MUNICIPIO}  (nome da malha 1989, p/ casar 1:1)
  muni_ibge      = {ibge7: ibge7}
  muni_turnout   = {ibge7: [aptos, comparecimento]}

Saidas:
  resultados_geo/Majoritarias 1989/presidente_1989_t{1,2}_{UF}.zip
  resultados_geo/detalhes_candidatos_1989.zip   (vice/coligacao por nome de urna)

Uso:
  py scripts/gerar_presidencial_1989.py
"""

import json
import os
import sys
import zipfile
from collections import defaultdict

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(BASE_DIR, '1989')
OUT_DIR = os.path.join(BASE_DIR, 'resultados_geo', 'Majoritarias 1989')
INDEX_1989 = os.path.join(BASE_DIR, 'scratch', 'malha1989', 'index_1989.json')
DETALHES_ZIP = os.path.join(BASE_DIR, 'resultados_geo', 'detalhes_candidatos_1989.zip')

# Votacao nominal nacional publicada pelo TSE, para cross-check (t1, t2).
REF_NACIONAL = {
    '1': {'20': 20611030, '13': 11622673, '12': 11168228, '45': 7790426},
    '2': {'20': 35089998, '13': 31076364},
}


def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def write_zip(basename, payload):
    os.makedirs(OUT_DIR, exist_ok=True)
    data = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
    with zipfile.ZipFile(os.path.join(OUT_DIR, basename + '.zip'), 'w',
                         zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(basename + '.json', data)


def build_cand_names(cand, turno, votos_nacionais):
    """cand_names do turno: so os candidatos com votos, com a situacao final
    deduzida do resultado (quem foi ao 2o turno / quem venceu)."""
    no_2t = {nr for nr, info in cand.items() if '2' in (info.get('turnos') or [])}
    eleito = max(votos_nacionais['2'], key=votos_nacionais['2'].get) if votos_nacionais['2'] else None

    out = {}
    for nr in sorted(votos_nacionais[turno], key=lambda n: -votos_nacionais[turno][n]):
        info = cand.get(nr)
        if not info:
            print('  [AVISO] candidato %s sem cadastro em cand1989.json' % nr)
            continue
        if turno == '2':
            situacao = 'ELEITO' if nr == eleito else 'NÃO ELEITO'
        else:
            situacao = '2º TURNO' if nr in no_2t else 'NÃO ELEITO'
        colig = (info.get('nome_coligacao') or '').strip()
        comp = (info.get('composicao_coligacao') or '').strip()
        isolado = (not colig) or colig.upper().startswith('SEM COLIGA')
        out[nr] = [
            info.get('nome_urna') or ('Candidato %s' % nr),
            info.get('partido') or '',
            situacao,
            'PARTIDO ISOLADO' if isolado else colig.upper(),
            comp or (info.get('partido') or ''),
        ]
    return out


def build_detalhes(cand, votos_nacionais):
    """detalhes_candidatos_1989.json: data['BR'][NOME_URNA_UPPER] = {...}."""
    concorreram = set(votos_nacionais['1']) | set(votos_nacionais['2'])
    br = {}
    for nr, info in cand.items():
        nome_urna = (info.get('nome_urna') or '').strip()
        if not nome_urna or nr not in concorreram:
            continue
        colig = (info.get('nome_coligacao') or '').strip()
        comp = (info.get('composicao_coligacao') or '').strip()
        isolado = (not colig) or colig.upper().startswith('SEM COLIGA')
        br[nome_urna.upper()] = {
            'nome': nome_urna,
            'partido': info.get('partido') or '',
            'vice': info.get('nome_vice_completo') or info.get('nome_vice_urna') or '',
            'vice_partido': info.get('partido_vice') or '',
            'coligacao': None if isolado else colig,
            'composicao': None if isolado else comp,
        }
    return {'BR': br}


def main():
    cand = load_json(os.path.join(SRC_DIR, 'cand1989.json'))
    if not os.path.exists(INDEX_1989):
        print('Malha 1989 ausente. Rode antes: py scripts/gerar_malha_svg.py 1989')
        return 1
    malha = load_json(INDEX_1989)

    resultados = {t: load_json(os.path.join(SRC_DIR, 'resultado1989.%s.json' % t))
                  for t in ('1', '2')}

    votos_nacionais = {t: defaultdict(int) for t in ('1', '2')}
    # por_uf[(uf, turno)] = {'results': {}, 'muni_names': {}, 'muni_turnout': {}}
    por_uf = defaultdict(lambda: {'results': {}, 'muni_names': {}, 'muni_turnout': {}})
    sem_malha = []

    for turno, ref in resultados.items():
        for ibge, entry in ref.items():
            info = malha.get(ibge)
            if not info:
                sem_malha.append((ibge, entry.get('nome'), entry.get('uf')))
                continue
            uf = info['uf']
            votos = {}
            for c in entry.get('list_cand') or []:
                nr = str(c['numero'])
                v = int(c['votos'])
                if v <= 0:
                    continue
                votos[nr] = votos.get(nr, 0) + v
                votos_nacionais[turno][nr] += v
            brancos = int(entry.get('brancos') or 0)
            nulos = int(entry.get('nulos') or 0)
            if brancos > 0:
                votos['95'] = brancos
            if nulos > 0:
                votos['96'] = nulos

            bucket = por_uf[(uf, turno)]
            bucket['results']['1_%s_M' % ibge] = dict(sorted(votos.items()))
            bucket['muni_names'][ibge] = info['nome']
            aptos = int(entry.get('eleitorado') or 0)
            comparecimento = int(entry.get('comparecimento') or 0)
            if aptos > 0 or comparecimento > 0:
                bucket['muni_turnout'][ibge] = [aptos, comparecimento]

    if sem_malha:
        print('  [AVISO] %d municipios sem poligono na malha 1989: %s'
              % (len(sem_malha), sem_malha[:8]))

    cand_names = {t: build_cand_names(cand, t, votos_nacionais) for t in ('1', '2')}

    for (uf, turno), bucket in sorted(por_uf.items()):
        payload = {
            'METADATA': {
                'tipo_eleicao': 'Ordinaria',
                'cand_names': {nr: meta for nr, meta in cand_names[turno].items()
                               if any(nr in votos for votos in bucket['results'].values())},
                'coalition_adjustments': {},
                'muni_names': bucket['muni_names'],
                'muni_ibge': {ibge: ibge for ibge in bucket['muni_names']},
                'muni_turnout': bucket['muni_turnout'],
            },
            'RESULTS': bucket['results'],
        }
        write_zip('presidente_1989_t%s_%s' % (turno, uf), payload)
    print('%d zips em %s' % (len(por_uf), OUT_DIR))

    detalhes = build_detalhes(cand, votos_nacionais)
    content = json.dumps(detalhes, ensure_ascii=False, separators=(',', ':'))
    with zipfile.ZipFile(DETALHES_ZIP, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('detalhes_candidatos_1989.json', content)
    print('%s: %d candidatos' % (DETALHES_ZIP, len(detalhes['BR'])))

    # Cross-check com a votacao nominal nacional publicada pelo TSE.
    for turno in ('1', '2'):
        total = sum(votos_nacionais[turno].values())
        print('Turno %s — nominais: %s' % (turno, format(total, ',d')))
        for nr, v in sorted(votos_nacionais[turno].items(), key=lambda kv: -kv[1])[:4]:
            nome = cand_names[turno][nr][0]
            ref = REF_NACIONAL[turno].get(nr)
            dif = '' if ref is None else ('  (TSE %s, dif %+d)' % (format(ref, ',d'), v - ref))
            print('  %-18s %12s  %5.2f%%%s' % (nome, format(v, ',d'), 100.0 * v / total, dif))

    return 0


if __name__ == '__main__':
    sys.exit(main())
