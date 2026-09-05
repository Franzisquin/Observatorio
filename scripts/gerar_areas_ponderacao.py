# -*- coding: utf-8 -*-
"""
Gera a camada de Areas de Ponderacao do Censo 2022 como nivel geografico do
visualizador, entre o municipio e o local de votacao.

Sao 14.406 areas. Em 2.577 municipios elas subdividem a cidade (11.413 areas —
Sao Paulo vira 332, o Rio 209); nos outros 2.993 a area e o municipio inteiro,
e entra assim mesmo, para o mapa da UF nao ter buraco.

O calculo e o mais simples que existe: cada local de votacao cai dentro de uma
area, e o resultado da area e a soma dos locais dentro dela. O ponto-em-poligono
roda aqui, uma vez; o navegador recebe uma tabela local -> area e soma as props
de voto que ja carrega hoje.

Duas correcoes de borda sao obrigatorias, nao cosmeticas (medido: 66 + 1.038
locais). Um local geocodificado a poucos metros da divisa cai na area do
municipio vizinho, e ai a soma das areas daquele municipio deixa de fechar com
o total oficial dele. Por isso todo local sem area, ou com area de outro
municipio, e reatribuido a area MAIS PROXIMA DENTRO DO SEU PROPRIO MUNICIPIO —
o municipio do local vem do TSE e e o dado forte; a coordenada e que e
aproximada.

Simplificacao: shapely.coverage_simplify, NACIONAL e antes do split por UF,
pelo mesmo motivo de gerar_malhas_regioes.py — simplificar cada feicao isolada
abre fenda entre vizinhas. Tolerancia 0,001 grau (~110 m), dez vezes menor que
a das regioes: area de ponderacao urbana tem poucos quarteiroes de lado e e
vista no enquadramento da cidade, nao no da UF.

Escopo: gerais de 2022, 2018, 2014, 2010 e 2006 e as municipais de 2024, 2020, 2016,
2012 e 2008, todos os cargos. O indice local -> area
nao depende de cargo — e geografia de local de votacao —, entao serve a
presidente, governador, senador e aos dois deputados de uma vez. Depende do ANO,
porque a rede de locais muda entre eleicoes: sai um indice por ano.

A MALHA e do Censo 2022 nos dois anos. Aplicada a 2018 ela e um recorte
retrospectivo: as areas nao existiam la, sao uma particao do territorio usada
para reler aquele resultado. O mesmo ja se faz no site com as regioes do IBGE
sobre os municipios de 1989/1994.

Saidas:
  resultados_geo/regioes_ap/regioes_ap_{UF}.geojson      (27 arquivos, ~62 MB)
  resultados_geo/regioes_ap/locais_ap_{ano}_{UF}.json    (27 por ano)

Uso:
  py scripts/gerar_areas_ponderacao.py [ano ...]   (sem argumento, todos)
"""

import json
import os
import sqlite3
import sys
import tempfile
import time
import zipfile
from collections import defaultdict

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AREAS_DIR = os.path.join(BASE_DIR, 'malhas', 'BR_Areas_Ponderacao_2022', 'areas')
OUT_DIR = os.path.join(BASE_DIR, 'resultados_geo')
AP_DIR = os.path.join(OUT_DIR, 'regioes_ap')
PONTE = os.path.join(OUT_DIR, 'tse_para_ibge.json')
# (ano, [(zip do GeoPackage, tabela dentro dele), ...]). O de 2022 e o unico
# "_gpkg" em vez de "_gkpg" — o erro de digitacao esta no acervo, nao aqui.
# 2014 tem duas fontes: o acervo principal e o suplemento do Amazonas, numa
# tabela a parte. Sem ele os 1.493 locais do AM ficariam de fora do indice.
ANOS = [
    (2022, [('locais_votacao_2022_gpkg.zip', 'locais_votacao_2022_ENRIQUECIDO')]),
    (2018, [('locais_votacao_2018_gkpg.zip', 'locais_votacao_2018_ENRIQUECIDO')]),
    (2014, [('locais_votacao_2014_gkpg.zip', 'locais_votacao_2014_ENRIQUECIDO'),
            ('locais_votacao_2014_am_suplementar_gkpg.zip',
             'locais_votacao_2014_am_suplementar')]),
    (2010, [('locais_votacao_2010_gkpg.zip', 'locais_votacao_2010_ENRIQUECIDO')]),
    # 2006 e 2008 sao os dois '_padronizado': o acervo daqueles anos nao passou
    # pelo enriquecimento que os demais receberam.
    (2006, [('locais_votacao_2006_gkpg.zip', 'locais_votacao_2006_padronizado')]),
    (2024, [('locais_votacao_2024_gkpg.zip', 'locais_votacao_2024_atualizado_2')]),
    (2020, [('locais_votacao_2020_gkpg.zip', 'locais_votacao_2020_ENRIQUECIDO')]),
    (2016, [('locais_votacao_2016_gkpg.zip', 'locais_votacao_2016_ENRIQUECIDO')]),
    (2012, [('locais_votacao_2012_gkpg.zip', 'locais_votacao_2012_ENRIQUECIDO')]),
    (2008, [('locais_votacao_2008_gkpg.zip', 'locais_votacao_2008_padronizado')]),
]

# Anos de eleicao MUNICIPAL. O indice e o mesmo — a chave do local nao muda —,
# mas o acervo esta em outro lugar: nao ha presidencial em 2024, e o arquivo de
# prefeito vem por UF com um JSON por municipio dentro.
ANOS_MUNICIPAIS = {2024, 2020, 2016, 2012, 2008}

CRS = 'EPSG:4326'          # a malha de AP ja vem em WGS84, e o gpkg guarda long/lat
CRS_METRICO = 'EPSG:5880'  # SIRGAS 2000 policonica do Brasil, para medir distancia
TOLERANCIA = 0.001     # grau, ~110 m
CASAS = 5              # ~1 m; a mesma grade para todos, senao reabre fenda

UF_POR_CODIGO = {
    '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
    '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL',
    '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
    '41': 'PR', '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
}

GRAU2_EM_KM2 = 12321.0  # ~(111,32 km)^2; ordem de grandeza, como nas regioes


def carregar_areas():
    """As 14.406 areas de ponderacao, nacional, com cd/nm/og/mun/uf."""
    partes = []
    for codigo in sorted(UF_POR_CODIGO):
        caminho = os.path.join(AREAS_DIR, '%s.geojson' % codigo)
        if not os.path.exists(caminho):
            raise SystemExit('malha da UF %s nao encontrada: %s' % (codigo, caminho))
        partes.append(gpd.read_file(caminho))
    g = gpd.GeoDataFrame(pd.concat(partes, ignore_index=True))
    g = g.set_crs(CRS, allow_override=True)
    return gpd.GeoDataFrame({
        'cd': g['cd'].astype(str).str.strip(),
        'nm': g['nm'].astype(str).str.strip(),
        'og': g['og'].astype(str).str.strip(),
        'mun': g['mun'].astype(str).str.strip(),
        'uf': g['uf'].astype(str).str.strip(),
        'geometry': g.geometry,
    }, crs=CRS)


def carregar_locais(fontes):
    """Os locais de votacao do ano, do(s) GeoPackage(s), como pontos.

    Le com sqlite3 direto — as colunas long/lat bastam, nao ha por que passar
    pelo driver geoespacial so para reconstruir o ponto que ja esta ali."""
    partes = []
    for nome_zip, tabela in fontes:
        caminho_zip = os.path.join(OUT_DIR, nome_zip)
        if not os.path.exists(caminho_zip):
            continue
        with tempfile.TemporaryDirectory() as tmp:
            with zipfile.ZipFile(caminho_zip) as z:
                nome = next(n for n in z.namelist() if n.lower().endswith('.gpkg'))
                z.extract(nome, tmp)
            con = sqlite3.connect(os.path.join(tmp, nome))
            partes.append(pd.read_sql(
                'SELECT sg_uf, cod_localidade_ibge, nr_zona, nr_locvot, long, lat '
                'FROM "%s"' % tabela, con))
            con.close()
    df = pd.concat(partes, ignore_index=True)

    df['mun'] = df['cod_localidade_ibge'].astype(str).str.strip()
    # Parte das linhas traz cod_localidade_ibge = '0' (340 em 2022, 526 em 2018):
    # sao locais "Resgatados do TSE (Base Eleitorado)", que entram no GPKG sem
    # codigo de municipio. Sem ele nao da para montar a chave do local nem para
    # amarrar a area ao municipio certo, entao ficam de fora — e a conferencia
    # por municipio no fim mede quanto voto isso custa.
    validos = df['mun'].str.match(r'^\d{7}$')
    df['zona'] = df['nr_zona'].astype(int).astype(str)
    df['locvot'] = df['nr_locvot'].astype(int).astype(str)

    # As linhas sem codigo ficam de lado, nao no lixo: elas TEM coordenada, e o
    # municipio pode vir da chave do acervo (o codigo TSE esta la). Sao 400 dos
    # 744 locais de 2018 que a chave exata nao alcanca.
    orfas = {}
    for linha in df[~validos].itertuples():
        orfas[(linha.sg_uf, linha.zona, linha.locvot)] = (linha.long, linha.lat)

    df = df[validos].copy()
    pontos = gpd.GeoDataFrame(
        df, geometry=gpd.points_from_xy(df['long'], df['lat']), crs=CRS)
    return pontos, int((~validos).sum()), orfas


def carregar_ponte_ibge_tse():
    """IBGE-7 -> codigo TSE. A chave do RESULTS usa o codigo do TSE; o gpkg so
    tem o do IBGE. tse_para_ibge.json e a ponte canonica do projeto."""
    with open(PONTE, encoding='utf-8') as f:
        tse_para_ibge = json.load(f)
    return {ibge: tse for tse, ibge in tse_para_ibge.items()}


def atribuir_areas(areas, locais):
    """local -> area, por ponto-em-poligono, com a area sempre do municipio do
    local. Devolve (Series de codigo de area alinhada a `locais`, n_orfaos,
    n_fora_do_municipio)."""
    j = gpd.sjoin(locais, areas[['cd', 'mun', 'geometry']],
                  how='left', predicate='within', lsuffix='loc', rsuffix='ap')
    # Um ponto exatamente sobre a divisa casa com as duas areas; a primeira
    # serve, porque o desempate real vem da checagem de municipio logo abaixo.
    j = j[~j.index.duplicated()]

    orfao = j['cd'].isna()
    fora = (~orfao) & (j['mun_loc'] != j['mun_ap'])
    ruins = orfao | fora

    cd = j['cd'].copy()
    # Zera ANTES de tentar recolocar. Quem nao for recolocado tem de ficar SEM
    # area, nao com a area errada: municipio criado depois do Censo 2022 nao tem
    # area nenhuma na malha — Boa Esperanca do Norte/MT, desmembrada de Nova
    # Ubirata, e o caso em 2024. Herdar a area da mae (o que o projeto faz com
    # REGIAO, em gerar_malhas_apuracao.py) nao serve aqui: area e subdivisao de
    # UM municipio, e emprestar quebraria a soma da area mae.
    cd[ruins.values] = None
    if ruins.any():
        # Reatribuicao: area mais proxima DENTRO do municipio do local. Um
        # sjoin_nearest global pegaria de novo a area vizinha, que e o defeito.
        # Em CRS_METRICO: "mais proxima" medida em graus nao e a mais proxima em
        # metros — no Brasil um grau de longitude vale de 111 km no Oiapoque a
        # 96 km no Chui, e a escolha entre duas areas quase equidistantes vira
        # sorteio.
        for mun, bloco in locais[ruins.values].groupby('mun'):
            candidatas = areas[areas['mun'] == mun]
            if candidatas.empty:
                continue
            perto = gpd.sjoin_nearest(bloco.to_crs(CRS_METRICO),
                                      candidatas[['cd', 'geometry']].to_crs(CRS_METRICO),
                                      how='left', lsuffix='loc', rsuffix='ap')
            perto = perto[~perto.index.duplicated()]
            cd.loc[perto.index] = perto['cd']

    return cd, int(orfao.sum()), int(fora.sum())


def medir_fendas(geoms):
    """(n_buracos, area_km2, maior_km2) dos vazios ENTRE as areas. Buraco =
    anel interior da uniao; soma(areas)-area(uniao) mediria sobreposicao e daria
    zero justamente quando ha fenda. Ver gerar_malhas_regioes.py."""
    uniao = shapely.union_all(geoms)
    partes = list(uniao.geoms) if uniao.geom_type == 'MultiPolygon' else [uniao]
    areas = [shapely.area(shapely.Polygon(anel))
             for parte in partes for anel in parte.interiors]
    if not areas:
        return 0, 0.0, 0.0
    return len(areas), sum(areas) * GRAU2_EM_KM2, max(areas) * GRAU2_EM_KM2


def arredondar_coords(no, casas=CASAS):
    if isinstance(no, (int, float)):
        return round(no, casas)
    return [arredondar_coords(x, casas) for x in no]


def escrever_json(caminho, obj):
    with open(caminho, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    return os.path.getsize(caminho)


def votos_por_local(ano, uf, turno):
    """{chave_do_local: total_de_votos} do arquivo oficial, brancos e nulos
    incluidos — e a mesma soma que a conferencia por area vai reproduzir.

    Nas gerais e a presidencial, que cobre todos os locais da UF. Nas municipais
    e o prefeito, e ai o zip da UF traz um JSON por municipio: sao todos que
    juntos cobrem a UF."""
    if ano in ANOS_MUNICIPAIS:
        caminho = os.path.join(OUT_DIR, 'Municipais %d' % ano,
                               'prefeito_%d_ord_t%d_%s.zip' % (ano, turno, uf))
        if not os.path.exists(caminho):
            return None
        total = {}
        with zipfile.ZipFile(caminho) as z:
            for nome in z.namelist():
                if not nome.endswith('.json') or nome.endswith('_resumo.json'):
                    continue
                dados = json.loads(z.read(nome).decode('utf-8'))
                for chave, votos in dados.get('RESULTS', {}).items():
                    total[chave] = sum(votos.values())
        return total or None

    base = 'presidente_%d_t%d_%s' % (ano, turno, uf)
    caminho = os.path.join(OUT_DIR, 'Majoritarias %d' % ano, base + '.zip')
    if not os.path.exists(caminho):
        return None
    with zipfile.ZipFile(caminho) as z:
        dados = json.loads(z.read(base + '.json').decode('utf-8'))
    return {chave: sum(votos.values())
            for chave, votos in dados.get('RESULTS', {}).items()}


def chaves_oficiais(ano, uf):
    """Todas as chaves de local que o acervo daquele ano usa na UF."""
    chaves = set()
    for turno in (1, 2):
        votos = votos_por_local(ano, uf, turno)
        if votos:
            chaves.update(votos)
    return chaves


def gerar_malha(areas):
    """Escreve os 27 GeoJSON da malha (compartilhada por todos os anos) e devolve
    (bytes, (uf_maior, bytes_maior))."""
    os.makedirs(AP_DIR, exist_ok=True)
    total = 0
    maior = ('', 0)
    for uf, bloco in areas.groupby('uf'):
        feicoes = []
        for linha in bloco.itertuples():
            geom = json.loads(shapely.to_geojson(linha.geometry))
            geom['coordinates'] = arredondar_coords(geom['coordinates'])
            feicoes.append({
                'type': 'Feature',
                'geometry': geom,
                'properties': {'CD_REG': linha.cd, 'NM_REG': linha.nm,
                               'SIGLA_UF': uf, 'OG_REG': linha.og},
            })
        destino = os.path.join(AP_DIR, 'regioes_ap_%s.geojson' % uf)
        tamanho = escrever_json(destino, {'type': 'FeatureCollection', 'features': feicoes})
        total += tamanho
        if tamanho > maior[1]:
            maior = (uf, tamanho)
    return total, maior


def gerar_indice_do_ano(ano, fontes, areas, ibge_para_tse, ufs):
    """Escreve locais_ap_{ano}_{UF}.json e devolve um relatorio do ano."""
    t0 = time.time()
    locais, sem_ibge, orfas = carregar_locais(fontes)
    cd, orfaos, fora = atribuir_areas(areas, locais)
    locais['cd_ap'] = cd
    sem_area = int(locais['cd_ap'].isna().sum())

    total_bytes = 0
    sem_ponte = set()
    recuperados = 0
    ap_por_chave = {}
    indices = {}
    faltantes = []

    for uf in ufs:
        indice = {}
        # Chave frouxa municipioTSE_local, para recuperar zona renumerada. So
        # entra quando TODAS as zonas daquele par apontam para a mesma area;
        # ambigua nao serve, e o mesmo criterio do fallback do runtime.
        solto = {}
        ambiguo = set()

        for linha in locais[locais['sg_uf'] == uf].itertuples():
            if not isinstance(linha.cd_ap, str):
                continue
            tse = ibge_para_tse.get(linha.mun)
            if tse is None:
                sem_ponte.add(linha.mun)
                continue
            indice['%s_%s_%s' % (linha.zona, tse, linha.locvot)] = linha.cd_ap
            frouxa = '%s_%s' % (tse, linha.locvot)
            if frouxa in solto and solto[frouxa] != linha.cd_ap:
                ambiguo.add(frouxa)
            else:
                solto[frouxa] = linha.cd_ap
        for k in ambiguo:
            solto.pop(k, None)

        # O acervo tem chaves que o GPKG nao reproduz exatamente: em 2018 a zona
        # foi renumerada em varios municipios depois da eleicao. O runtime ja
        # recupera esses locais pela chave sem a zona (ver os fallbacks em
        # js/data-geral-2018.js); o indice precisa recuperar do mesmo jeito,
        # senao a area fica sem parte dos votos e ninguem percebe.
        for chave in chaves_oficiais(ano, uf):
            if chave in indice:
                continue
            partes = chave.split('_')
            if len(partes) != 3:
                continue
            alvo = solto.get('%s_%s' % (partes[1], partes[2]))
            if alvo:
                indice[chave] = alvo
                recuperados += 1
            else:
                faltantes.append((uf, chave, partes[0], partes[1], partes[2]))

        indices[uf] = indice

    # Segunda recuperacao: o que sobrou costuma ser local "Resgatado do TSE",
    # que entra no GPKG sem codigo de municipio mas COM coordenada. O municipio
    # vem do codigo TSE da propria chave do acervo, e dai a atribuicao e a mesma
    # do caminho principal — area do proprio municipio, a mais proxima.
    por_coordenada = recuperar_por_coordenada(
        areas, orfas, faltantes, {t: i for i, t in ibge_para_tse.items()})
    for uf, chave, cd_ap in por_coordenada:
        indices[uf][chave] = cd_ap

    for uf in ufs:
        ap_por_chave.update(indices[uf])
        total_bytes += escrever_json(
            os.path.join(AP_DIR, 'locais_ap_%d_%s.json' % (ano, uf)), indices[uf])

    print('  %d: %d locais (%d sem codigo IBGE) | %d orfaos e %d fora do '
          'municipio reatribuidos | %d sem area | recuperados: %d por zona '
          'renumerada, %d por coordenada | %.1f MB (%.0fs)'
          % (ano, len(locais), sem_ibge, orfaos, fora, sem_area, recuperados,
             len(por_coordenada), total_bytes / 1e6, time.time() - t0))

    return {'ano': ano, 'locais': locais, 'sem_area': sem_area,
            'sem_ponte': sem_ponte, 'ap_por_chave': ap_por_chave}


def recuperar_por_coordenada(areas, orfas, faltantes, tse_para_ibge):
    """[(uf, chave, cd_ap)] para as chaves do acervo cujo local esta no GPKG sem
    codigo de municipio. A coordenada vem do GPKG; o municipio, da chave."""
    linhas = []
    for uf, chave, zona, tse, locvot in faltantes:
        ponto = orfas.get((uf, zona, locvot))
        ibge = tse_para_ibge.get(tse)
        if ponto and ibge:
            linhas.append({'uf': uf, 'chave': chave, 'mun': ibge,
                           'long': ponto[0], 'lat': ponto[1]})
    if not linhas:
        return []

    df = pd.DataFrame(linhas)
    pontos = gpd.GeoDataFrame(
        df, geometry=gpd.points_from_xy(df['long'], df['lat']), crs=CRS)
    cd, _, _ = atribuir_areas(areas, pontos)
    pontos['cd_ap'] = cd
    return [(l.uf, l.chave, l.cd_ap) for l in pontos.itertuples()
            if isinstance(l.cd_ap, str)]


def conferir_ano(rel, areas, ibge_para_tse, ufs):
    """Por municipio, a soma dos votos das areas tem de bater com o total dele.
    E o teste que pega o erro que importa."""
    ano = rel['ano']
    ok = True
    por_cd = dict(zip(areas['cd'], areas['mun']))
    locais = rel['locais']

    if rel['sem_area']:
        print('  [ALERTA] %d: %d locais ficaram sem area' % (ano, rel['sem_area']))
        ok = False
    if rel['sem_ponte']:
        print('  [ALERTA] %d: %d municipios sem codigo TSE na ponte'
              % (ano, len(rel['sem_ponte'])))
        ok = False

    trocados = [l for l in locais.itertuples()
                if isinstance(l.cd_ap, str) and por_cd.get(l.cd_ap) != l.mun]
    if trocados:
        print('  [ALERTA] %d: %d locais em area de outro municipio' % (ano, len(trocados)))
        ok = False

    ausentes = {c for c in locais['cd_ap'].dropna() if c not in set(areas['cd'])}
    if ausentes:
        print('  [ALERTA] %d: %d areas do indice ausentes do GeoJSON' % (ano, len(ausentes)))
        ok = False

    tse_para_ibge = {t: i for i, t in ibge_para_tse.items()}
    ap_por_chave = rel['ap_por_chave']
    for turno in (1, 2):
        divergentes = sem_par = votos_sem_par = total_mun = votos_tot = 0
        for uf in ufs:
            resultados = votos_por_local(ano, uf, turno)
            if not resultados:
                continue
            por_mun = defaultdict(int)
            por_mun_via_ap = defaultdict(int)
            for chave, votos in resultados.items():
                votos_tot += votos
                cd_ap = ap_por_chave.get(chave)
                if cd_ap is None:
                    sem_par += 1
                    votos_sem_par += votos
                    continue
                por_mun[tse_para_ibge.get(chave.split('_')[1])] += votos
                por_mun_via_ap[por_cd[cd_ap]] += votos
            for ibge, total in por_mun.items():
                total_mun += 1
                if por_mun_via_ap.get(ibge, 0) != total:
                    divergentes += 1
        if not total_mun:
            continue
        pct = (100.0 * votos_sem_par / votos_tot) if votos_tot else 0.0
        print('  %d t%d: %d municipios conferidos, %d divergentes | %d locais '
              'sem area (%d votos, %.3f%%)'
              % (ano, turno, total_mun, divergentes, sem_par, votos_sem_par, pct))
        if divergentes:
            ok = False
        # Ate 1% dos votos fora do mapa e o que a fonte impoe (locais sem codigo
        # de municipio no GPKG). Acima disso e defeito de atribuicao, nao do dado.
        if pct > 1.0:
            print('  [ALERTA] %d t%d: %.3f%% dos votos sem area' % (ano, turno, pct))
            ok = False
    return ok


def main():
    if not os.path.isdir(AREAS_DIR):
        print('Malha de areas de ponderacao nao encontrada em %s' % AREAS_DIR)
        return 1

    t0 = time.time()
    areas = carregar_areas()
    ibge_para_tse = carregar_ponte_ibge_tse()
    print('%d areas de ponderacao (%.0fs)' % (len(areas), time.time() - t0))

    areas['geometry'] = shapely.coverage_simplify(np.array(areas.geometry), TOLERANCIA)
    fendas = medir_fendas(np.array(areas.geometry))
    print('  simplificado a %.4f grau (%.0fs)' % (TOLERANCIA, time.time() - t0))

    # A malha e a mesma para todos os anos; so o indice local -> area muda.
    bytes_malha, maior = gerar_malha(areas)
    print('  malha: 27 arquivos, %.1f MB (maior: %s %.1f MB) (%.0fs)'
          % (bytes_malha / 1e6, maior[0], maior[1] / 1e6, time.time() - t0))

    ufs = sorted(set(areas['uf']))
    pedidos = {int(a) for a in sys.argv[1:] if a.isdigit()}
    relatorios = []
    for ano, fontes in ANOS:
        if pedidos and ano not in pedidos:
            continue
        if not any(os.path.exists(os.path.join(OUT_DIR, z)) for z, _ in fontes):
            print('  %d: GeoPackage nao encontrado, pulando' % ano)
            continue
        relatorios.append(
            gerar_indice_do_ano(ano, fontes, areas, ibge_para_tse, ufs))

    # ------------------------------------------------------------- cross-check
    print('\nCross-check')
    ok = True

    nf, area_km2, maior_km2 = fendas
    print('  fendas entre areas: %d, %.1f km2 no total, maior %.3f km2'
          % (nf, area_km2, maior_km2))
    # As fendas ja vem da FONTE, nao da simplificacao: a malha do IBGE crua tem
    # 19.859 vazios, 27,7 km2, maior 1,112 km2 — e simplificar a 0,001 leva a
    # ~16,7 mil, 46 km2, maior 1,84 km2. A mediana e de 232 m2 (lasca de
    # arredondamento) e os 6 maiores estao todos em meandro de rio da Amazonia,
    # ou seja, sao agua, nao buraco na cobertura. So 17 passam de 0,1 km2.
    # O limiar aqui e de REGRESSAO — pegar um GEOS futuro que estoure as fendas,
    # nao perseguir a perfeicao que a fonte nao tem.
    if maior_km2 > 5.0:
        print('  [ALERTA] maior fenda %.3f km2, muito acima do 1,8 km2 medido' % maior_km2)
        ok = False

    for rel in relatorios:
        if not conferir_ano(rel, areas, ibge_para_tse, ufs):
            ok = False

    print('OK.' if ok else 'FALHOU.')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
