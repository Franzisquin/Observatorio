# -*- coding: utf-8 -*-
"""
Pre-projeta as zonas eleitorais de algumas cidades em paths SVG prontos, um
arquivo por municipio, para a pagina de apuracao por zona (apuracao-zonas.html).

Fonte: as malhas de zona eleitoral do Centro de Estudos da Metropole (CEM/USP),
em resultados_geo/zonas_eleitorais/fontes/:
  EL2022_ZE_RMBRA_CEM_V1.zip   zonas de 2022 nas regioes metropolitanas
  EL2024_ZE_RMSP_CEM.zip       zonas de 2024 na regiao metropolitana de SP
Cada feicao e uma zona dentro de um municipio (ZE_NUM, CD_MUN_I = IBGE,
CD_MUN_T = TSE). Zona que atravessa municipios vem partida, uma parte em cada.

Alta definicao: a malha do CEM ja e enxuta (a cidade de Sao Paulo inteira tem
~21 mil vertices), entao quase nada sai. Largura de 2000 unidades, coordenada
inteira, e Douglas-Peucker com tolerancia de 0,35 unidade — abaixo de meio pixel
mesmo com o mapa em 1400 px de tela. O que a simplificacao tira sao os vertices
que o arredondamento ja colaria. Duas zonas vizinhas compartilham a borda da
fonte; com a tolerancia abaixo do pixel, a diferenca entre os dois lados nao
aparece.

Projecao equiretangular corrigida pelo cosseno da latitude media, como as
malhas municipais (scripts/gerar_malhas_apuracao.py).

Segunda fonte: areas de zona desenhadas sobre os setores censitarios do IBGE
(ZE_BR_INTEIRO.gpkg e os arquivos por UF), numeradas por DIST02 e conferidas
com os locais de votacao de 2026 — ver FONTES_AREAS, abaixo.

Saida:
  resultados_geo/zonas_svg/zonas_{IBGE}.json
    {"w":2000,"h":H,"ano":2022,"fonte":"...","p":[["0001", "", "M... Z"], ...]}
    Sem nome de zona: a pagina mostra so "Zona N".
    A chave da zona tem 4 digitos, como no nome do arquivo de zona do TSE
    (`-z0001-`) e na lista de zonas do EA12.
  resultados_geo/zonas_svg/indice.json
    {"cidades":[{"ibge","tse","uf","nm","ano","zonas"}, ...]}
  resultados_geo/zonas_eleitorais/conferencia_zonas.csv
    cada area contra a zona da maioria dos locais de votacao de 2026

Uso:
  py scripts/gerar_malhas_zonas.py
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import geopandas as gpd
from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry.polygon import orient

RAIZ = Path(__file__).resolve().parent.parent
FONTES = RAIZ / 'resultados_geo' / 'zonas_eleitorais' / 'fontes'
SAIDA = RAIZ / 'resultados_geo' / 'zonas_svg'
PONTE = RAIZ / 'resultados_geo' / 'tse_para_ibge.json'
MUN_SVG = RAIZ / 'resultados_geo' / 'municipios_svg'

FONTE_2022 = FONTES / 'EL2022_ZE_RMBRA_CEM_V1.zip'
FONTE_2024 = FONTES / 'EL2024_ZE_RMSP_CEM.zip'

# As cidades da pagina de zonas, por codigo IBGE. As que tem malha de 2024 (o
# zoneamento mais recente da RMSP) saem dela; o resto, da de 2022. Campinas fica
# de fora: o mapa dela vai ser feito a mao.
CIDADES_2024 = {
    '3550308',  # Sao Paulo
    '3548708',  # Sao Bernardo do Campo
}
CIDADES = [
    # DF
    '5300108',  # Brasilia
    # MG
    '3106200', '3106705', '3129806', '3157807', '3154606', '3118601',
    # ES
    '3205200', '3205309', '3201308', '3205002',
    # RJ
    '3303302', '3304904', '3301900', '3302502', '3301702', '3300456', '3305109',
    '3304557', '3302858', '3303203', '3303500', '3303906',
    # SP (interior)
    '3552403', '3501608',
    # SP (RMSP)
    '3505708', '3534401', '3510609', '3513009', '3515004', '3513801', '3547809',
    '3529401', '3543303', '3550308', '3548807', '3548708', '3518800', '3523107',
    '3530607', '3552502', '3552809',
    # SP (Baixada Santista)
    '3548500', '3518701', '3541000', '3551009',
    # GO
    '5208707', '5201405',
    # PA
    '1501402', '1502400',
    # CE
    '2304400', '2303709', '2307650',
    # PE
    '2611606', '2607901', '2609600', '2610707', '2602902', '2603454',
    # BA
    '2927408', '2905701',
]

LARGURA = 2000
TOLERANCIA = 0.35


def douglas_peucker(pts, tol2):
    """Iterativo, como em gerar_malhas_apuracao.py."""
    n = len(pts)
    if n <= 3:
        return pts
    manter = [False] * n
    manter[0] = manter[n - 1] = True
    pilha = [(0, n - 1)]
    while pilha:
        i, j = pilha.pop()
        ax, ay = pts[i]
        bx, by = pts[j]
        dx, dy = bx - ax, by - ay
        dd = dx * dx + dy * dy
        pior, idx = 0.0, -1
        for k in range(i + 1, j):
            px, py = pts[k]
            if dd:
                t = ((px - ax) * dx + (py - ay) * dy) / dd
                t = 0.0 if t < 0 else (1.0 if t > 1 else t)
                qx, qy = ax + dx * t, ay + dy * t
            else:
                qx, qy = ax, ay
            d = (px - qx) ** 2 + (py - qy) ** 2
            if d > pior:
                pior, idx = d, k
        if idx > 0 and pior > tol2:
            manter[idx] = True
            pilha.append((i, idx))
            pilha.append((idx, j))
    return [p for p, m in zip(pts, manter) if m]


def poligonos(geom):
    if geom is None or geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    return [g for g in getattr(geom, 'geoms', []) if isinstance(g, Polygon)]


def enquadrar(geoms):
    mnx, mny, mxx, mxy = 180.0, 90.0, -180.0, -90.0
    for g in geoms:
        a, b, c, d = g.bounds
        mnx, mny, mxx, mxy = min(mnx, a), min(mny, b), max(mxx, c), max(mxy, d)
    k = math.cos(((mny + mxy) / 2) * math.pi / 180) or 1
    lg, ag = (mxx - mnx) * k, (mxy - mny)
    return {'mnx': mnx, 'mxy': mxy, 'k': k, 'lg': lg, 'ag': ag,
            'h': max(1, round(LARGURA * ag / lg))}


def caminho(geom, proj):
    """Path de uma zona. Exterior e furos em sentidos opostos (shapely.orient),
    para o preenchimento padrao do SVG (nonzero) abrir os furos sem CSS."""
    tol = TOLERANCIA * max(1.0, proj['h'] / LARGURA)
    tol2 = tol * tol
    partes = []
    for poly in poligonos(geom):
        poly = orient(poly, sign=1.0)
        for anel in [poly.exterior, *poly.interiors]:
            pts = [((x - proj['mnx']) * proj['k'] / proj['lg'] * LARGURA,
                    (proj['mxy'] - y) / proj['ag'] * proj['h']) for x, y in anel.coords]
            pts = douglas_peucker(pts, tol2)
            limpo, ultimo = [], None
            for x, y in pts:
                c = (int(round(x)), int(round(y)))
                if c != ultimo:
                    limpo.append(c)
                    ultimo = c
            if len(limpo) > 1 and limpo[0] == limpo[-1]:
                limpo.pop()
            if len(limpo) < 3:
                continue
            partes.append('M' + ' '.join(f'{x} {y}' for x, y in limpo) + 'Z')
    return ''.join(partes)


def nomes_oficiais():
    """Nome com acento, da malha municipal do proprio site: o CEM grava em
    maiusculas sem acento."""
    nomes = {}
    for arq in MUN_SVG.glob('municipios_*.json'):
        uf = arq.stem.split('_')[1].lower()
        for cd, nm, *_ in json.loads(arq.read_text(encoding='utf-8'))['p']:
            nomes[str(cd)] = (nm, uf)
    return nomes


# --------------------------------------------------- areas desenhadas a mao

# Areas de zona desenhadas sobre os setores censitarios do IBGE 2022 (uma feicao
# por zona dentro do municipio, CD_MUN = IBGE). O numero da zona NAO vem no
# arquivo: DIST02 numera as areas na ordem das zonas da cidade — areas de DIST02
# 5 e 6 numa cidade das zonas 107 e 411 sao 107 e 411. Essa ordem pode falhar, e
# por isso cada area e conferida com os locais de votacao de 2026: vale a zona da
# maioria dos locais que caem dentro dela. A ordem so decide quando a area nao
# tem local nenhum. Tudo fica registrado em conferencia_zonas.csv.
FONTES_AREAS = ['ZE_BR_INTEIRO.gpkg', 'ZE_GO_IN.gpkg', 'ZE_MS.gpkg', 'ZE_MT.gpkg',
                'ZE_PR.gpkg', 'ZE_RS.gpkg', 'ZE_SC.gpkg']
# Desenhadas a mao no formato do CEM (com ZE_NUM): conferidas do mesmo jeito.
FONTES_CEM_AVULSAS = {'3509502': 'ZE_Campinas.gpkg'}
LOCAIS = RAIZ / 'scratch' / 'locais_votacao_2026' / 'locais_votacao_2026.gpkg'
CONFERENCIA = RAIZ / 'resultados_geo' / 'zonas_eleitorais' / 'conferencia_zonas.csv'

# Pedaco e furo menores que isto sao sobra da dissolucao dos setores, nao
# territorio: somem do desenho. Em m2.
MINIMO_M2 = 5000

# A legenda curta embaixo do mapa: de onde vem o desenho.
FONTE_CEM = 'malha do CEM/USP'
FONTE_SETORES = 'sobre setores censitários do IBGE'


def area_m2(poly):
    return poly.area * (111320.0 ** 2) * math.cos(math.radians(poly.centroid.y))


# Enclaves e exclaves errados, so nas cidades conferidas uma a uma (a limpeza
# geral desmontava cidades onde a zona e de fato descontigua). Pedaco solto
# menor que ENCLAVE_MAX da propria zona e conferido com os locais de votacao de
# 2026 que caem dentro dele.
ENCLAVE_CIDADES = {
    '3143302',  # Montes Claros
    '2611101',  # Petrolina
    '3170206',  # Uberlandia
    '2918407',  # Juazeiro: dois enclaves rurais da 47 dentro da 48 (a 48 segue
                # descontigua: a parte de 44 km2 tem 25 locais dela)
    '1504208',  # Maraba: dois enclaves rurais da 100 dentro da 23
}
ENCLAVE_MAX = 0.20


def desenclavar(zonas, pontos):
    """Cada zona fica com o seu pedaco maior. Cada outro pedaco pequeno:
      - com locais de votacao dentro: vai para a zona da maioria deles — se for
        a propria, o pedaco e real e fica;
      - sem local: encostado em outra zona, vai para a vizinha de maior
        fronteira (e fecha o furo que fazia nela); solto, fica se estiver dentro
        do contorno da cidade (as ilhas do Sao Francisco, em Petrolina) e sai se
        estiver fora.
    Devolve as zonas e a lista do que foi decidido, pedaco a pedaco."""
    from shapely.ops import unary_union
    geom = {z: unary_union(ps) for z, ps in zonas.items() if ps}
    decisoes = []
    principais = [max(poligonos(g), key=lambda q: q.area) for g in geom.values()]
    contorno = unary_union(principais).convex_hull.buffer(1e-4)
    for z in sorted(geom, key=lambda k: -geom[k].area):
        partes = sorted(poligonos(geom[z]), key=lambda q: -q.area)
        if len(partes) < 2:
            continue
        total = sum(q.area for q in partes)
        fica = [partes[0]]
        for parte in partes[1:]:
            km2 = area_m2(parte) / 1e6
            if parte.area >= ENCLAVE_MAX * total:
                fica.append(parte)
                continue
            zm, n, tot = maioria(parte, pontos)
            if zm is not None:
                destino = f'{zm:04d}'
                if destino == z or destino not in geom:
                    fica.append(parte)
                    decisoes.append(f'{km2:.2f} km2 da zona {int(z)}: {n} de {tot} locais sao dela — fica')
                else:
                    geom[destino] = unary_union([geom[destino], parte])
                    decisoes.append(f'{km2:.2f} km2 da zona {int(z)}: {n} de {tot} locais sao da '
                                    f'{zm} — foi para a {zm}')
                continue
            melhor, maior = None, 0.0
            for w, gw in geom.items():
                if w == z:
                    continue
                junto = parte.exterior.intersection(gw.buffer(1e-6)).length
                if junto > maior:
                    melhor, maior = w, junto
            if melhor is not None:
                geom[melhor] = unary_union([geom[melhor], parte])
                decisoes.append(f'{km2:.2f} km2 da zona {int(z)}, sem local: encosta na {int(melhor)} '
                                f'— foi para ela')
            elif parte.within(contorno):
                fica.append(parte)
            else:
                decisoes.append(f'{km2:.2f} km2 da zona {int(z)}, sem local e fora do contorno da '
                                f'cidade — saiu')
        geom[z] = unary_union(fica)
    return {z: poligonos(g) for z, g in geom.items()}, decisoes


def limpar(geoms):
    """Tira os pedacos e furos minusculos que a dissolucao dos setores deixa."""
    saida = []
    for poly in geoms:
        if area_m2(poly) < MINIMO_M2:
            continue
        furos = [anel for anel in poly.interiors if area_m2(Polygon(anel)) >= MINIMO_M2]
        saida.append(Polygon(poly.exterior, furos))
    return saida


def maioria(geom, pontos):
    """A zona da maioria dos locais de votacao dentro da area: (zona, locais
    dela, locais no total). Empate vai para quem tem mais eleitores ali."""
    if pontos is None or pontos.empty:
        return None, 0, 0
    idx = pontos.sindex.query(geom, predicate='contains')
    if not len(idx):
        return None, 0, 0
    dentro = pontos.iloc[idx]
    cont = (dentro.groupby('NR_ZONA').agg(n=('NR_ZONA', 'size'), e=('QT_ELEIT', 'sum'))
            .sort_values(['n', 'e'], ascending=False))
    return int(cont.index[0]), int(cont['n'].iloc[0]), len(dentro)


def mais_proximo(geom, pontos):
    """A zona do local de votacao da cidade mais proximo da area."""
    if pontos is None or pontos.empty:
        return None
    m = gpd.GeoSeries([geom], crs=4326).to_crs(5880).iloc[0]
    d = pontos.to_crs(5880).distance(m)
    return int(pontos['NR_ZONA'].iloc[int(d.values.argmin())])


def ler_locais(caminho):
    loc = gpd.read_file(caminho)[['NR_ZONA', 'CD_IBGE', 'QT_ELEIT', 'geometry']]
    loc['CD_IBGE'] = loc['CD_IBGE'].astype(str)
    loc['NR_ZONA'] = loc['NR_ZONA'].astype(int)
    loc['QT_ELEIT'] = loc['QT_ELEIT'].fillna(0).astype(int)
    por_cidade = {cd: sub.reset_index(drop=True) for cd, sub in loc.groupby('CD_IBGE')}
    return por_cidade, loc.reset_index(drop=True)


def cidade_dos_locais(geom, todos):
    """O municipio da maioria dos locais de votacao dentro da area, de qualquer
    cidade: (ibge, locais dele, locais no total). Pega area com o municipio
    errado na fonte — em ZE_BR_INTEIRO, a DIST02 78 vinha como Uberaba e tem os
    27 locais da zona 314 de Uberlandia."""
    idx = todos.sindex.query(geom, predicate='contains')
    if not len(idx):
        return None, 0, 0
    cont = todos.iloc[idx].groupby('CD_IBGE').size().sort_values(ascending=False)
    return str(cont.index[0]), int(cont.iloc[0]), len(idx)


def escrever_cidade(ibge, tse, uf, nm, ano, fonte, zonas):
    """zonas: {"0107": [Polygon, ...]}. Devolve a linha do indice e os vertices."""
    proj = enquadrar([gm for gs in zonas.values() for gm in gs])
    p, vertices = [], 0
    for z in sorted(zonas):
        d = caminho(MultiPolygon(zonas[z]), proj)
        vertices += d.count(' ') // 2 + d.count('M')
        # Sem nome: a pagina mostra so "Zona N".
        p.append([z, '', d])
    (SAIDA / f'zonas_{ibge}.json').write_text(
        json.dumps({'w': LARGURA, 'h': proj['h'], 'ano': ano, 'fonte': fonte, 'p': p},
                   ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'  {uf.upper()} {nm:28s} {len(p):3d} zonas ({ano})')
    return {'ibge': ibge, 'tse': str(tse).zfill(5), 'uf': uf, 'nm': nm, 'ano': ano,
            'zonas': len(p)}, vertices


def main() -> int:
    import argparse
    import csv
    ap = argparse.ArgumentParser()
    ap.add_argument('--locais', type=Path, default=LOCAIS,
                    help='locais de votacao de 2026 (GeoPackage com NR_ZONA e CD_IBGE)')
    args = ap.parse_args()

    ponte = json.loads(PONTE.read_text(encoding='utf-8'))
    ibge_para_tse = {v: k for k, v in ponte.items()}
    nomes = nomes_oficiais()
    locais, todos_locais = ler_locais(args.locais)
    fontes = {2022: gpd.read_file(f'zip://{FONTE_2022}'), 2024: gpd.read_file(f'zip://{FONTE_2024}')}
    for g in fontes.values():
        g['CD_MUN_I'] = g['CD_MUN_I'].astype(str)
        g['CD_MUN_T'] = g['CD_MUN_T'].astype(str)

    SAIDA.mkdir(parents=True, exist_ok=True)
    for velho in SAIDA.glob('zonas_*.json'):
        velho.unlink()
    indice, problemas, conferencia, total_v = [], [], [], 0

    def conferir(uf, nm, ibge, rotulo, declarada, geom, tipo):
        z, n, tot = maioria(geom, locais.get(ibge))
        conferencia.append({'tipo': tipo, 'uf': uf, 'cidade': nm, 'ibge': ibge, 'area': rotulo,
                            ('pela_ordem' if tipo == 'setores' else 'no_arquivo'): declarada,
                            'pela_maioria': z if z is not None else '',
                            'locais_da_zona': n, 'locais_na_area': tot})
        return z

    # ---- CEM (RMs 2022, RMSP 2024) e as avulsas no mesmo formato
    cem = [(ibge, fontes[2024 if ibge in CIDADES_2024 else 2022], 2024 if ibge in CIDADES_2024 else 2022)
           for ibge in CIDADES]
    for ibge, arq in FONTES_CEM_AVULSAS.items():
        g = gpd.read_file(FONTES / arq).to_crs(4326)
        g['CD_MUN_I'] = g['CD_MUN_I'].astype(str)
        g['CD_MUN_T'] = g['CD_MUN_T'].astype(str)
        cem.append((ibge, g, int(g['ANO_ELE'].iloc[0])))
    for ibge, g, ano in cem:
        sel = g[g['CD_MUN_I'] == ibge]
        if sel.empty:
            problemas.append(f'{ibge}: nao esta na malha de {ano}')
            continue
        tse = sel['CD_MUN_T'].iloc[0]
        if ponte.get(tse.lstrip('0')) != ibge:
            problemas.append(f'{ibge}: TSE {tse} nao bate com a ponte ({ponte.get(tse.lstrip("0"))})')
        nm, uf = nomes.get(ibge, (sel['MUN_NOME'].iloc[0].title(), ''))
        zonas = {}
        for _, f in sel.iterrows():
            z = int(f['ZE_NUM'])
            zm = conferir(uf, nm, ibge, f'ZE {z}', z, f.geometry, 'cem')
            if zm is not None and zm != z:
                problemas.append(f'{uf.upper()} {nm}: area da zona {z} tem a maioria dos locais '
                                 f'de 2026 na zona {zm} (mantida a {z}; ver conferencia)')
            zonas.setdefault(f'{z:04d}', []).extend(poligonos(f.geometry))
        linha, v = escrever_cidade(ibge, tse, uf, nm, ano, FONTE_CEM, zonas)
        indice.append(linha)
        total_v += v

    # ---- areas sobre setores censitarios, numeradas por DIST02
    feitas = {c['ibge'] for c in indice}
    areas = []
    for arq in FONTES_AREAS:
        g = gpd.read_file(FONTES / arq).to_crs(4326)
        g['CD_MUN'] = g['CD_MUN'].astype(str)
        # O municipio de cada area tambem e conferido pelos locais: se a maioria
        # dos que caem dentro dela e de outra cidade, a area vai para essa cidade.
        for i, f in g.iterrows():
            dono, n, tot = cidade_dos_locais(f.geometry, todos_locais)
            if dono and dono != f['CD_MUN'] and n * 2 > tot:
                nm_fonte = nomes.get(f['CD_MUN'], (f['NM_MUN'], ''))[0]
                nm_dono = nomes.get(dono, (dono, ''))[0]
                problemas.append(f'{nm_fonte}: area DIST02 {int(f["DIST02"])} vem marcada como '
                                 f'{nm_fonte}, mas {n} dos {tot} locais dentro dela sao de {nm_dono} '
                                 f'— foi para {nm_dono}')
                g.at[i, 'CD_MUN'] = dono
                g.at[i, 'NM_MUN'] = nm_dono
        areas.append(g)
    if areas:
        import pandas as pd
        g = gpd.GeoDataFrame(pd.concat(areas, ignore_index=True), crs=4326)
        for ibge, sub in g.groupby('CD_MUN'):
            if ibge in feitas:
                continue
            nm, uf = nomes.get(ibge, (sub['NM_MUN'].iloc[0], ''))
            zonas_mun = sorted(set(locais[ibge]['NR_ZONA'])) if ibge in locais else []
            sub = sub.assign(_d=sub['DIST02'].astype(int)).sort_values('_d')
            casam = len(sub) == len(zonas_mun)
            zonas = {}
            for i, (_, f) in enumerate(sub.iterrows()):
                ordem = zonas_mun[i] if casam else ''
                zm = conferir(uf, nm, ibge, f'DIST02 {f["_d"]}', ordem, f.geometry, 'setores')
                final = zm if zm is not None else ordem
                if final == '':
                    # Sem local dentro e sem ordem que valha (mais areas que
                    # zonas): fica com a zona do local de votacao mais proximo,
                    # que e onde o eleitor dali vota. Sinalizado no relatorio.
                    final = mais_proximo(f.geometry, locais.get(ibge))
                    if final is None:
                        problemas.append(f'{uf.upper()} {nm}: area DIST02 {f["_d"]} sem local e sem '
                                         f'ordem — fora do mapa')
                        continue
                    conferencia[-1]['pela_maioria'] = f'{final} (local mais proximo)'
                    problemas.append(f'{uf.upper()} {nm}: area DIST02 {f["_d"]} sem local dentro e sem '
                                     f'ordem ({len(sub)} areas para {len(zonas_mun)} zonas) — ficou com a '
                                     f'zona {final}, a do local de votacao mais proximo')
                if zm is not None and ordem != '' and zm != ordem:
                    problemas.append(f'{uf.upper()} {nm}: DIST02 {f["_d"]} seria a zona {ordem} pela '
                                     f'ordem; os locais dizem {zm} — ficou {zm}')
                zonas.setdefault(f'{int(final):04d}', []).extend(limpar(poligonos(f.geometry)))
            if len(sub) > len(zonas):
                problemas.append(f'{uf.upper()} {nm}: {len(sub)} areas viraram {len(zonas)} zonas '
                                 f'(areas da mesma zona juntadas)')
            sem_area = sorted(set(zonas_mun) - {int(z) for z in zonas})
            if sem_area:
                problemas.append(f'{uf.upper()} {nm}: zona(s) {", ".join(map(str, sem_area))} sem area '
                                 f'no desenho — aparecem so na tabela')
            tse = ibge_para_tse.get(ibge, '')
            if not tse:
                problemas.append(f'{ibge} {nm}: sem codigo TSE na ponte')
            if ibge in ENCLAVE_CIDADES:
                zonas, decisoes = desenclavar(zonas, locais.get(ibge))
                problemas += [f'{uf.upper()} {nm}: {d}' for d in decisoes]
            linha, v = escrever_cidade(ibge, tse, uf, nm, 2026, FONTE_SETORES, zonas)
            indice.append(linha)
            total_v += v
            feitas.add(ibge)

    indice.sort(key=lambda c: (c['uf'], c['nm']))
    (SAIDA / 'indice.json').write_text(
        json.dumps({'fonte': 'CEM/USP (zonas de 2022 e 2024) e desenho do ElectoMaps sobre '
                             'setores censitarios, conferido com os locais de votacao de 2026',
                    'cidades': indice}, ensure_ascii=False, indent=1), encoding='utf-8')

    with CONFERENCIA.open('w', encoding='utf-8', newline='') as f:
        campos = ['tipo', 'uf', 'cidade', 'ibge', 'area', 'no_arquivo', 'pela_ordem',
                  'pela_maioria', 'locais_da_zona', 'locais_na_area']
        w = csv.DictWriter(f, fieldnames=campos)
        w.writeheader()
        w.writerows(conferencia)

    peso = sum(f.stat().st_size for f in SAIDA.glob('zonas_*.json')) / 1024
    print(f'{len(indice)} cidades, {sum(c["zonas"] for c in indice)} zonas, '
          f'~{total_v:,} vertices, {peso:,.0f} KB'.replace(',', '.'))
    print(f'conferencia com os locais de 2026: {CONFERENCIA.relative_to(RAIZ)}')
    for x in problemas:
        print('  ! ' + x)
    return 0


if __name__ == '__main__':
    sys.exit(main())
