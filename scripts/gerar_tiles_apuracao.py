# -*- coding: utf-8 -*-
"""
Gera os vector tiles do mapa da apuracao presidencial (apuracao-presidente.html):
estados e municipios do Brasil inteiro, da malha HD do IBGE.

POR QUE TILES. A pagina carregava a malha HD em GeoJSON, um arquivo por UF, e o
worker do MapLibre fatiava tudo no navegador. Para o pais inteiro eram 49 MB e
varios segundos, com os estados surgindo um a um. Aqui o fatiamento acontece uma
vez, com o mesmo metodo do MapLibre (Douglas-Peucker a 3/4096 do tile, ~0,375 px
num tile de 512): o que aparece na tela e o mesmo, e o navegador so baixa os
tiles do que esta a vista. No ultimo nivel (Z_MAX) nao ha simplificacao nenhuma —
a malha HD inteira, na grade de 8192 do tile, ~10 m; acima dele o MapLibre
amplia esses mesmos tiles, entao o detalhe maximo e o da malha.

ESTADOS. Saem da uniao dos municipios da HD, e nao de estados_brasil.geojson:
aquela malha e mais leve, e a divisa dela escorregava por centenas de metros da
borda dos municipios ao aproximar.

MUNICIPIO NOVO. A HD e de 2022. Municipio instalado depois (hoje, so Boa
Esperanca do Norte/MT) entra pela malha simplificada — a unica que o tem — e sai
recortado do territorio dos municipios de onde veio, que a HD ainda conta
inteiros. Recortado, e nao pintado por cima: o preenchimento do mapa e
translucido, e a cor do municipio de baixo vazaria.

Saida (resultados_geo/malha_apuracao/):
  {z}/{x}/{y}.pbf   camadas `estados` {cd, uf} e `municipios` {cd, uf, nm},
                    com `cd` numerico (CD_UF / IBGE-7), que a pagina promove a id
                    para pintar por feature-state
  ufs.json          por UF: codigo, caixa para o enquadramento e os municipios

Tile vazio (mar, pais vizinho) e gravado com 0 byte quando fica a ate ANEL tiles
de terra, que e o que a tela pede ao olhar o litoral ou a fronteira: o MapLibre
aceita 404 como tile vazio, mas o navegador anota cada um no console. Mais longe
que isso nao: gravar a caixa inteira custaria quase 3 mil arquivos a mais, e o
plano gratuito da Cloudflare tem teto de 20 mil por versao.

Uso:
  py scripts/gerar_tiles_apuracao.py
"""

import json
import math
import os
import shutil
import sys
import time

import mapbox_vector_tile
import mercantile
import numpy as np
import shapely
from shapely.geometry import shape

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO = os.path.join(BASE_DIR, 'resultados_geo')
HD_DIR = os.path.join(GEO, 'municipios_hd')
SIMPLES_DIR = os.path.join(GEO, 'municipios')
PONTE = os.path.join(GEO, 'tse_para_ibge.json')
NOMES = os.path.join(GEO, 'regioes_ibge.json')
SAIDA = os.path.join(GEO, 'malha_apuracao')

# O mapa da pagina vai do zoom 2 ao 12. Acima de Z_MAX ele amplia os tiles de
# Z_MAX, que tem a malha inteira: a grade de ~10 m fica abaixo de meio pixel no
# zoom 12.
Z_MIN, Z_MAX = 2, 9
EXTENT = 4096
EXTENT_MAX = 8192
TOLERANCIA = 3          # em unidades de tile de 4096
BUFFER = 64             # idem; o do MapLibre para GeoJSON e o mesmo 1/64 do tile

# Caixa do Brasil com folga, a mesma `bounds` da fonte na pagina: fora dela o
# MapLibre nao pede tile.
CAIXA = (-74.5, -34.5, -28.0, 6.0)

# Distancia, em tiles, ate onde um tile vazio ainda e gravado. A tela da
# apuracao tem ~3 tiles de largura em qualquer zoom.
ANEL = 3

# Municipio novo que cobre menos que isto de um municipio da HD nao saiu dele:
# e so o desencontro entre a malha simplificada e a HD.
FATIA_MINIMA = 0.05

R = 6378137.0


def mercator(xy):
    lon = np.radians(xy[:, 0])
    lat = np.radians(np.clip(xy[:, 1], -85.0511, 85.0511))
    return np.column_stack([R * lon, R * np.log(np.tan(np.pi / 4 + lat / 2))])


def ler(caminho):
    with open(caminho, encoding='utf-8') as f:
        return json.load(f)


def valida(g):
    """Onze municipios da HD tem autointersecao (AM, BA, CE, PE e RS), e a uniao
    que faz os estados nao passa por elas. O metodo `structure` conserta sem
    trocar area por linha."""
    return g if g.is_valid else shapely.make_valid(g, method='structure', keep_collapsed=False)


def municipios():
    """[cd, uf, geometria lon/lat] de todos os municipios, com o novo recortado."""
    lista = []
    for nome in sorted(os.listdir(HD_DIR)):
        uf = nome[11:13].lower()
        for f in ler(os.path.join(HD_DIR, nome))['features']:
            lista.append([int(f['properties']['CD_MUN']), uf, valida(shape(f['geometry']))])

    # Novo: esta na malha simplificada e na ponte do TSE, mas nao na HD. As
    # "areas operacionais" das lagoas gauchas tambem so estao na simplificada, e
    # a ponte as deixa de fora: sao feicao do IBGE, nunca recebem voto.
    tem = {cd for cd, _, _ in lista}
    do_tse = {int(v) for v in ler(PONTE).values()}
    for nome in sorted(os.listdir(SIMPLES_DIR)):
        if not nome.endswith('.geojson'):
            continue
        uf = nome[11:13].lower()
        for f in ler(os.path.join(SIMPLES_DIR, nome))['features']:
            cd = int(f['properties']['CD_MUN'])
            if cd in tem or cd not in do_tse:
                continue
            novo = valida(shape(f['geometry']))
            origens = [m for m in lista if m[1] == uf and m[2].intersects(novo)
                       and m[2].intersection(novo).area >= FATIA_MINIMA * novo.area]
            novo = novo.intersection(shapely.union_all([m[2] for m in origens]))
            for m in origens:
                m[2] = m[2].difference(novo)
            lista.append([cd, uf, novo])
            print(f'  novo {cd} ({uf}) recortado de {", ".join(str(m[0]) for m in origens)}')
    return lista


def estados(lista):
    """[cd_uf, uf, geometria] pela uniao dos municipios de cada UF."""
    saida = []
    for uf in sorted({u for _, u, _ in lista}):
        partes = [m for m in lista if m[1] == uf]
        saida.append([partes[0][0] // 100000, uf, shapely.union_all([m[2] for m in partes])])
    return saida


def caixa_uf(geom):
    """Caixa para enquadrar a UF sem as ilhas pequenas: com Trindade o Espirito
    Santo abriria longe demais. Mesmo corte de area do antigo SVG nacional."""
    partes = list(getattr(geom, 'geoms', [geom]))
    grandes = [p for p in partes if p.area >= 0.01] or partes
    o, s, l, n = shapely.total_bounds(grandes)
    return [[round(o, 4), round(s, 4)], [round(l, 4), round(n, 4)]]


def codificar(camadas, tile, extent, buf):
    """Recorta, leva a grade do tile e codifica. Tudo vetorizado no shapely: pelo
    codificador, que quantiza e valida um poligono por vez em Python, o ultimo
    nivel levava dezenas de minutos."""
    b = mercantile.xy_bounds(tile)
    k = extent / (b.right - b.left)
    saida = []
    for nome, arvore, geoms, props in camadas:
        idx = arvore.query(shapely.box(b.left - buf, b.bottom - buf, b.right + buf, b.top + buf))
        if not len(idx):
            continue
        idx.sort()
        g = shapely.clip_by_rect(geoms[idx], b.left - buf, b.bottom - buf, b.right + buf, b.top + buf)
        # y para baixo, como o MVT quer; set_precision arredonda na grade inteira
        # e devolve geometria valida, e o anel externo sai com area positiva.
        g = shapely.transform(g, lambda c: np.column_stack([(c[:, 0] - b.left) * k, (b.top - c[:, 1]) * k]))
        g = shapely.orient_polygons(shapely.set_precision(g, 1.0))
        feats = [{'geometry': gi, 'properties': props[i]}
                 for gi, i in zip(g, idx)
                 if not gi.is_empty and gi.geom_type in ('Polygon', 'MultiPolygon')]
        if feats:
            saida.append({'name': nome, 'features': feats})
    if not saida:
        return b''
    return mapbox_vector_tile.encode(saida, default_options={
        'extents': extent, 'y_coord_down': True, 'check_winding_order': False})


def main():
    t0 = time.time()
    lista = municipios()
    nomes = {int(k): v['nome'] for k, v in ler(NOMES)['muni_to_region'].items()}
    ufs = estados(lista)
    print(f'  {len(lista)} municipios, {len(ufs)} estados  ({time.time() - t0:.0f} s)')

    meta = {uf: {'cd': cd, 'caixa': caixa_uf(g),
                 'mun': sorted(m[0] for m in lista if m[1] == uf)}
            for cd, uf, g in ufs}

    proj = lambda gs: shapely.transform(np.array(gs, dtype=object), mercator)
    mun_g = proj([m[2] for m in lista])
    mun_p = [{'cd': cd, 'uf': uf, 'nm': nomes.get(cd, '')} for cd, uf, _ in lista]
    est_g = proj([e[2] for e in ufs])
    est_p = [{'cd': cd, 'uf': uf} for cd, uf, _ in ufs]
    sem_nome = [p['cd'] for p in mun_p if not p['nm']]
    if sem_nome:
        print(f'  [AVISO] sem nome: {sem_nome[:10]}')

    if os.path.isdir(SAIDA):
        shutil.rmtree(SAIDA)
    os.makedirs(SAIDA)

    total_bytes = arquivos = 0
    for z in range(Z_MIN, Z_MAX + 1):
        tz = time.time()
        ultimo = z == Z_MAX
        extent = EXTENT_MAX if ultimo else EXTENT
        largura = 2 * math.pi * R / 2 ** z
        tol = 0 if ultimo else TOLERANCIA * largura / EXTENT
        buf = BUFFER * largura / EXTENT
        mz = shapely.simplify(mun_g, tol) if tol else mun_g
        ez = shapely.simplify(est_g, tol) if tol else est_g
        camadas = [('estados', shapely.STRtree(ez), ez, est_p),
                   ('municipios', shapely.STRtree(mz), mz, mun_p)]
        cheios, vazios = {}, []
        for t in mercantile.tiles(*CAIXA, z):
            dados = codificar(camadas, t, extent, buf)
            if dados:
                cheios[(t.x, t.y)] = dados
            else:
                vazios.append((t.x, t.y))
        perto = {(x + dx, y + dy) for x, y in cheios
                 for dx in range(-ANEL, ANEL + 1) for dy in range(-ANEL, ANEL + 1)}
        vazios = [v for v in vazios if v in perto]
        for (x, y), dados in list(cheios.items()) + [(v, b'') for v in vazios]:
            pasta = os.path.join(SAIDA, str(z), str(x))
            os.makedirs(pasta, exist_ok=True)
            with open(os.path.join(pasta, f'{y}.pbf'), 'wb') as f:
                f.write(dados)
        nbytes = sum(len(d) for d in cheios.values())
        total_bytes += nbytes
        arquivos += len(cheios) + len(vazios)
        print(f'  z{z}: {len(cheios):5d} tiles com dados, {len(vazios):5d} vazios, '
              f'{nbytes / 1e6:6.1f} MB  ({time.time() - tz:.0f} s)', flush=True)

    with open(os.path.join(SAIDA, 'ufs.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, separators=(',', ':'))
    print(f'OK: {arquivos + 1} arquivos, {total_bytes / 1e6:.1f} MB em {time.time() - t0:.0f} s')


if __name__ == '__main__':
    sys.exit(main())
