# -*- coding: utf-8 -*-
"""
Converte as 4 malhas regionais do IBGE em malhas/ (shapefile) para GeoJSON por
UF, no mesmo padrao das malhas municipais do site, e gera o indice
municipio->regiao usado pelo filtro e pelo mapa de regioes.

Niveis: mesorregiao (2022), microrregiao (2021) — divisao antiga, extinta em
2017 — e regiao intermediaria / imediata (2023), a divisao vigente.

Simplificacao: shapely.coverage_simplify, NACIONAL e antes do split por UF.
Simplificar cada feicao isolada (geometry.simplify) abre fendas entre regioes
vizinhas — medido: ~740 km2 nas regioes imediatas. O coverage_simplify preserva
as bordas compartilhadas e deixa fenda ~0. Nacional e nao por UF porque
simplificar cada UF isolada so garantiria a topologia interna dela, e as
fronteiras entre estados divergiriam.

Tolerancia 0,005 grau (~550 m): a camada de regiao so e vista no enquadramento
da UF inteira (z6-z8), onde 1 pixel vale 600-2400 m. Quem quer detalhe clica na
regiao e cai na malha municipal, que continua em resolucao cheia.

Saidas:
  resultados_geo/regioes_{nivel}/regioes_{nivel}_{UF}.geojson   (108 arquivos)
  resultados_geo/regioes_index.json                             (muni -> regiao)

Uso:
  py scripts/gerar_malhas_regioes.py
"""

import json
import os
import sys
import time

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MALHAS_DIR = os.path.join(BASE_DIR, 'malhas')
OUT_DIR = os.path.join(BASE_DIR, 'resultados_geo')
MUNI_DIR = os.path.join(OUT_DIR, 'municipios_hd')
INDEX_OUT = os.path.join(OUT_DIR, 'regioes_index.json')
REGIOES_IBGE = os.path.join(OUT_DIR, 'regioes_ibge.json')

CRS = 'EPSG:4674'          # SIRGAS 2000, graus — o que o IBGE publica
TOLERANCIA = 0.005         # grau

# (nivel, pasta/arquivo, coluna de codigo, coluna de nome, coluna de UF)
NIVEIS = [
    ('meso',  'BR_Mesorregioes_2022',      'CD_MESO',  'NM_MESO',  'SIGLA_UF'),
    ('micro', 'BR_Microrregioes_2021',     'CD_MICRO', 'NM_MICRO', 'SIGLA'),
    ('rgint', 'BR_RG_Intermediarias_2023', 'CD_RGINT', 'NM_RGINT', 'CD_UF'),
    ('rgi',   'BR_RG_Imediatas_2023',      'CD_RGI',   'NM_RGI',   'CD_UF'),
]

# rgint/rgi trazem CD_UF, nao a sigla.
UF_POR_CODIGO = {
    '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
    '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL',
    '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
    '41': 'PR', '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
}


def ler_nivel(pasta, cd, nm, uf_col):
    """GeoDataFrame com colunas normalizadas cd/nm/uf. Sem `encoding=`: o
    geopandas ja resolve pelo .cpg (forcar latin-1 e que produziria mojibake)."""
    caminho = os.path.join(MALHAS_DIR, pasta, pasta + '.shp')
    g = gpd.read_file(caminho).to_crs(CRS)
    out = gpd.GeoDataFrame({
        'cd': g[cd].astype(str).str.strip(),
        'nm': g[nm].astype(str).str.strip(),
        'uf': (g[uf_col].astype(str).str.strip().map(UF_POR_CODIGO)
               if uf_col.startswith('CD_') else g[uf_col].astype(str).str.strip()),
        'geometry': g.geometry,
    }, crs=CRS)
    faltando = out['uf'].isna().sum()
    if faltando:
        raise SystemExit('%s: %d feicoes sem sigla de UF' % (pasta, faltando))
    return out


GRAU2_EM_KM2 = 12321.0  # ~(111,32 km)^2; suficiente para ordem de grandeza


def medir_fendas(geoms):
    """(n_buracos, area_km2, maior_km2) dos vazios ENTRE as regioes.

    Buraco = anel interior da uniao da cobertura. Nao usar
    soma(areas) - area(uniao): isso mede SOBREPOSICAO e da zero justamente
    quando ha fenda, que e o defeito que queremos pegar."""
    uniao = shapely.union_all(geoms)
    partes = list(uniao.geoms) if uniao.geom_type == 'MultiPolygon' else [uniao]
    areas = [shapely.area(shapely.Polygon(anel))
             for parte in partes for anel in parte.interiors]
    if not areas:
        return 0, 0.0, 0.0
    return len(areas), sum(areas) * GRAU2_EM_KM2, max(areas) * GRAU2_EM_KM2


def arredondar_coords(no, casas=5):
    """Arredonda in-place as coordenadas de um geometry GeoJSON. Vizinhas
    compartilham os mesmos vertices depois do coverage_simplify, e arredondar
    todo mundo para a mesma grade mantem isso — nao reabre fenda."""
    if isinstance(no, (int, float)):
        return round(no, casas)
    return [arredondar_coords(x, casas) for x in no]


def escrever_geojson(caminho, feicoes):
    with open(caminho, 'w', encoding='utf-8') as f:
        json.dump({'type': 'FeatureCollection', 'features': feicoes}, f,
                  ensure_ascii=False, separators=(',', ':'))
    return os.path.getsize(caminho)


def carregar_municipios():
    """Pontos representativos dos municipios da malha atual. Os arquivos de
    municipios_hd nao declaram CRS — sao graus, entao assumimos e reprojetamos."""
    partes = []
    for nome in sorted(os.listdir(MUNI_DIR)):
        if nome.endswith('.geojson'):
            partes.append(gpd.read_file(os.path.join(MUNI_DIR, nome)))
    mun = gpd.GeoDataFrame(pd.concat(partes, ignore_index=True))
    mun = mun.set_crs('EPSG:4326', allow_override=True).to_crs(CRS)
    pts = gpd.GeoDataFrame(
        {'CD_MUN': mun['CD_MUN'].astype(str)},
        geometry=mun.representative_point(), crs=CRS)
    return pts


def main():
    if not os.path.isdir(MALHAS_DIR):
        print('Pasta malhas/ nao encontrada.')
        return 1

    pts = carregar_municipios()
    print('Municipios (malha atual): %d' % len(pts))

    index_muni = {}
    index_niveis = {}
    relatorio = []

    for nivel, pasta, cd, nm, uf_col in NIVEIS:
        t0 = time.time()
        g = ler_nivel(pasta, cd, nm, uf_col)
        g['geometry'] = shapely.coverage_simplify(np.array(g.geometry), TOLERANCIA)
        fendas = medir_fendas(np.array(g.geometry))

        # Join municipio -> regiao ANTES do arredondamento, com a geometria cheia.
        j = gpd.sjoin(pts, g[['cd', 'geometry']], predicate='within', how='left')
        sem_regiao = int(j['cd'].isna().sum())
        duplicados = int(j['CD_MUN'].duplicated().sum())
        for muni, code in zip(j['CD_MUN'], j['cd']):
            if isinstance(code, str):
                index_muni.setdefault(muni, {})[nivel] = code

        por_uf = {}
        pasta_out = os.path.join(OUT_DIR, 'regioes_%s' % nivel)
        os.makedirs(pasta_out, exist_ok=True)
        maior = ('', 0)
        total_bytes = 0
        for uf, bloco in g.groupby('uf'):
            feicoes = []
            for _, linha in bloco.iterrows():
                geom = json.loads(shapely.to_geojson(linha.geometry))
                geom['coordinates'] = arredondar_coords(geom['coordinates'])
                feicoes.append({
                    'type': 'Feature',
                    'geometry': geom,
                    'properties': {'CD_REG': linha.cd, 'NM_REG': linha.nm, 'SIGLA_UF': uf},
                })
                por_uf.setdefault(uf, {})[linha.cd] = linha.nm
            destino = os.path.join(pasta_out, 'regioes_%s_%s.geojson' % (nivel, uf))
            tamanho = escrever_geojson(destino, feicoes)
            total_bytes += tamanho
            if tamanho > maior[1]:
                maior = (uf, tamanho)

        index_niveis[nivel] = por_uf
        relatorio.append((nivel, len(g), len(por_uf), fendas,
                          total_bytes, maior, sem_regiao, duplicados, time.time() - t0))
        print('  %-6s %3d feicoes em %2d UFs  (%.0fs)'
              % (nivel, len(g), len(por_uf), time.time() - t0))

    with open(INDEX_OUT, 'w', encoding='utf-8') as f:
        json.dump({'muni': index_muni, 'niveis': index_niveis}, f,
                  ensure_ascii=False, separators=(',', ':'))

    # ---------------------------------------------------------------- cross-check
    # rgint e rgi (divisao vigente) saem com fenda ZERO. meso e micro (divisao
    # extinta em 2017) tem microfendas herdadas da fonte: as malhas de 2021/2022
    # nao formam cobertura valida, e as sobreposicoes sub-tolerancia da origem
    # viram vazios ao simplificar. Medido: baixar a tolerancia de 0,005 para
    # 0,001 mantem quase o mesmo numero de fendas (1098 -> 891) e so encolhe a
    # area — ou seja, elas estao no dado, nao na simplificacao.
    #
    # O limiar e de VISIBILIDADE, nao de perfeicao: a camada de regiao e vista no
    # enquadramento da UF (z6-z7, onde 1 px vale ~900-1800 m), entao uma fenda de
    # 2 km2 (~1,4 km de lado) e o primeiro tamanho que apareceria como risco no
    # mapa. O objetivo do alerta e pegar regressao de GEOS que estoure as fendas.
    LIMITE_FENDA_KM2 = 2.0
    print('\nCross-check')
    for (nivel, n, nufs, (nf, area_km2, maior_km2), total, maior, sem, dup, _t) in relatorio:
        media = (area_km2 / nf) if nf else 0.0
        print('  %-6s: %3d feicoes / %2d UFs | %d fendas, %.1f km2 no total '
              '(media %.3f km2, maior %.3f km2)'
              % (nivel, n, nufs, nf, area_km2, media, maior_km2))
        print('          %6.2f MB total, maior %s %.2f MB | sem regiao %d | munis duplicados %d'
              % (total / 1e6, maior[0], maior[1] / 1e6, sem, dup))
        if maior_km2 > LIMITE_FENDA_KM2:
            print('          [ALERTA] fenda de %.3f km2 fica visivel no zoom da UF' % maior_km2)
        if sem or dup:
            print('          [ALERTA] join incompleto')

    faltando = [m for m, v in index_muni.items() if len(v) != len(NIVEIS)]
    print('  indice: %d municipios, %d sem algum nivel' % (len(index_muni), len(faltando)))

    # regioes_ibge.json e a fonte canonica do IBGE para rgint/rgi: o join tem de
    # reproduzi-la exatamente (133 e 510 regioes, zero divergencia).
    if os.path.exists(REGIOES_IBGE):
        with open(REGIOES_IBGE, encoding='utf-8') as f:
            ref = json.load(f).get('muni_to_region', {})
        for nivel, campo in (('rgint', 'ri'), ('rgi', 'rgi')):
            div = [m for m, v in index_muni.items()
                   if m in ref and v.get(nivel) != ref[m].get(campo)]
            distintos = len({v[nivel] for v in index_muni.values() if nivel in v})
            print('  %-5s x regioes_ibge.json: %3d regioes, %d divergencias'
                  % (nivel, distintos, len(div)))
            if div:
                print('        exemplos:', div[:5])

    # As malhas historicas tem de estar cobertas — o mapa de regioes vale para
    # 1989/1994 tambem (municipios da epoca, poligono de regiao moderno).
    for ano in ('1989', '1994'):
        dir_ano = os.path.join(OUT_DIR, 'municipios_%s' % ano)
        if not os.path.isdir(dir_ano):
            continue
        codigos = set()
        for nome in os.listdir(dir_ano):
            if not nome.endswith('.geojson'):
                continue
            with open(os.path.join(dir_ano, nome), encoding='utf-8') as f:
                for feat in json.load(f)['features']:
                    codigos.add(str(feat['properties']['CD_MUN']))
        fora = [c for c in codigos if c not in index_muni]
        print('  malha %s: %d municipios, %d sem regiao no indice' % (ano, len(codigos), len(fora)))

    print('OK.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
