# -*- coding: utf-8 -*-
"""
Gera resultados_geo/tse_para_ibge.json: a ponte codigo do municipio no TSE ->
codigo IBGE-7.

POR QUE ISTO EXISTE. Os resultados eleitorais do TSE sao chaveados por codigo
TSE ("{zona}_{cdMuniTSE}_{local}"), e os poligonos da malha municipal so tem o
codigo IBGE (municipios_hd nem carrega nome). Sem a ponte, o site so conseguia
ligar os dois lados por NOME de municipio — e a grafia diverge entre os anos
(CANINDE DE SAO FRANCISCO em 2002, CANINDE DO SAO FRANCISCO em 2006), ou
dependia de o municipio ter algum local de votacao geolocalizado. Quando
falhava, o municipio virava um poligono cinza no mapa mesmo tendo votos no JSON.

FONTE. Os GeoJSON de locais de votacao trazem cd_localidade_tse e
cod_localidade_ibge lado a lado. Juntando todos os anos disponiveis
(2006...2024) sai uma bijecao completa e sem conflito: 5571 codigos TSE para
5571 IBGE distintos, nenhum codigo apontando para dois IBGE diferentes.

O arquivo NAO guarda nome de municipio de proposito: regioes_ibge.json ja tem o
nome canonico do IBGE por codigo e ja alimenta STATE.muniCodeToNameMap. Duas
fontes de nome e o comeco da proxima divergencia.

Uso:
  py scripts/gerar_ponte_tse_ibge.py
"""

import json
import os
import re
import sys
import zipfile
from collections import defaultdict

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO_DIR = os.path.join(BASE_DIR, 'resultados_geo')
SAIDA = os.path.join(GEO_DIR, 'tse_para_ibge.json')
REGIOES_IBGE = os.path.join(GEO_DIR, 'regioes_ibge.json')
MUNI_DIR = os.path.join(GEO_DIR, 'municipios_hd')

# locais_votacao_2006_1.zip, _2, ... — os *_gkpg.zip sao GeoPackage, nao GeoJSON.
PADRAO_ZIP = re.compile(r'^locais_votacao_\d{4}_\d+\.zip$')

ANOS_DEPUTADO = ['1994', '2002', '2006', '2010', '2014', '2018', '2022']

# Unico codigo TSE que aparece em resultado e nao tem municipio moderno:
# MT/2002, uma chave, 979 votos. Sem IBGE nao ha poligono, logo nao e buraco.
TSE_SEM_MUNICIPIO = {'91065'}


def coletar_ponte():
    """{cdTSE: ibge7} e os conflitos encontrados pelo caminho."""
    ponte = {}
    conflitos = defaultdict(set)
    lidos = 0

    for nome in sorted(os.listdir(GEO_DIR)):
        if not PADRAO_ZIP.match(nome):
            continue
        try:
            zf = zipfile.ZipFile(os.path.join(GEO_DIR, nome))
        except (zipfile.BadZipFile, OSError):
            print('  [AVISO] zip ilegivel: %s' % nome)
            continue
        lidos += 1
        for entrada in zf.namelist():
            if not entrada.endswith('.geojson'):
                continue
            try:
                feats = json.loads(zf.read(entrada)).get('features', [])
            except (ValueError, KeyError):
                continue
            for feat in feats:
                props = feat.get('properties') or {}
                tse, ibge = props.get('cd_localidade_tse'), props.get('cod_localidade_ibge')
                if tse is None or not ibge:
                    continue
                tse, ibge = str(int(tse)), str(int(ibge))
                anterior = ponte.get(tse)
                if anterior and anterior != ibge:
                    conflitos[tse].update([anterior, ibge])
                ponte[tse] = ibge

    print('  %d zips de locais lidos' % lidos)
    return ponte, conflitos


def municipios_da_malha():
    codigos = set()
    for nome in sorted(os.listdir(MUNI_DIR)):
        if not nome.endswith('.geojson'):
            continue
        with open(os.path.join(MUNI_DIR, nome), encoding='utf-8') as f:
            for feat in json.load(f)['features']:
                codigos.add(str(feat['properties']['CD_MUN']))
    return codigos


def municipios_do_resultado(ano, uf):
    """Codigos TSE presentes no RESULTS de deputado federal daquele ano/UF."""
    caminho = os.path.join(GEO_DIR, 'Legislativas %s' % ano,
                           'deputados_federal_%s_%s.zip' % (ano, uf))
    if not os.path.exists(caminho):
        return None
    zf = zipfile.ZipFile(caminho)
    entrada = next(n for n in zf.namelist() if n.endswith('.json'))
    resultados = json.loads(zf.read(entrada)).get('RESULTS', {})
    return {k.split('_')[1] for k in resultados if len(k.split('_')) >= 3}


def main():
    print('Lendo os locais de votacao...')
    ponte, conflitos = coletar_ponte()

    if not ponte:
        print('Nenhum par TSE/IBGE encontrado — abortando.')
        return 1

    with open(SAIDA, 'w', encoding='utf-8') as f:
        json.dump(dict(sorted(ponte.items(), key=lambda kv: int(kv[0]))), f,
                  ensure_ascii=False, separators=(',', ':'))

    # ------------------------------------------------------------ cross-check
    print('\nCross-check')
    falhou = False

    distintos = len(set(ponte.values()))
    print('  %d codigos TSE -> %d IBGE distintos' % (len(ponte), distintos))
    if len(ponte) != distintos:
        print('  [ALERTA] a ponte nao e bijetiva')
        falhou = True

    print('  codigos apontando para mais de um IBGE: %d' % len(conflitos))
    if conflitos:
        # E a premissa do arquivo inteiro: se cair, o join volta a ser ambiguo.
        print('  [ALERTA] exemplos:', dict(list(conflitos.items())[:3]))
        falhou = True

    with open(REGIOES_IBGE, encoding='utf-8') as f:
        conhecidos = set(json.load(f).get('muni_to_region', {}))
    fora = set(ponte.values()) - conhecidos
    print('  IBGE fora de regioes_ibge.json: %d' % len(fora))
    if fora:
        print('  [ALERTA] exemplos:', sorted(fora)[:5])
        falhou = True

    malha = municipios_da_malha()
    sem_tse = malha - set(ponte.values())
    print('  poligonos em municipios_hd: %d | sem codigo TSE: %d' % (len(malha), len(sem_tse)))
    if sem_tse:
        print('  [ALERTA] exemplos:', sorted(sem_tse)[:5])
        falhou = True

    ufs = sorted(n.replace('municipios_', '').replace('.geojson', '')
                 for n in os.listdir(MUNI_DIR) if n.endswith('.geojson'))

    def malha_do_ano(ano, uf):
        """1994 desenha a malha historica do proprio ano, nao a moderna —
        comparar contra municipios_hd contaria como buraco os ~550 municipios
        que ainda nem existiam em 1994."""
        if ano == '1994':
            caminho = os.path.join(GEO_DIR, 'municipios_1994', 'municipios_1994_%s.geojson' % uf)
        else:
            caminho = os.path.join(MUNI_DIR, 'municipios_%s.geojson' % uf)
        if not os.path.exists(caminho):
            return set()
        with open(caminho, encoding='utf-8') as f:
            return {str(x['properties']['CD_MUN']) for x in json.load(f)['features']}

    print('\n  Buracos por ano (deputado federal, Brasil) — o que a ponte resolve:')
    for ano in ANOS_DEPUTADO:
        buracos = 0
        sem_ponte = set()
        tem_ano = False
        for uf in ufs:
            tse = municipios_do_resultado(ano, uf)
            if tse is None:
                continue
            tem_ano = True
            da_uf = malha_do_ano(ano, uf)
            com_resultado = {ponte[t] for t in tse if t in ponte}
            sem_ponte |= {t for t in tse if t not in ponte}
            buracos += len(da_uf - com_resultado)
        if not tem_ano:
            continue
        inesperados = sem_ponte - TSE_SEM_MUNICIPIO
        print('    %s: %3d poligonos sem resultado | TSE sem ponte: %s'
              % (ano, buracos, sorted(sem_ponte) or 'nenhum'))
        if inesperados:
            print('      [ALERTA] codigo TSE sem IBGE fora do esperado:', sorted(inesperados)[:5])
            falhou = True

    print('\n  Os poligonos sem resultado que sobram sao municipios criados DEPOIS')
    print('  da eleicao; emancipacoes_pre2014.json cobre esses casos no site.')
    print('\n%s: %d entradas, %.0f kB' % (SAIDA, len(ponte), os.path.getsize(SAIDA) / 1024))
    print('FALHOU.' if falhou else 'OK.')
    return 1 if falhou else 0


if __name__ == '__main__':
    sys.exit(main())
