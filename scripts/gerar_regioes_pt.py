# -*- coding: utf-8 -*-
"""
Gera a malha das regiões de Portugal (NUTS I, II, III e áreas metropolitanas)
para o modo "Regiões" do mapa do portal de Portugal.

As NUTS de Portugal são agrupamentos de municípios, então a malha sai da fusão
dos concelhos que o site já desenha (portugal/dados/mapas/concelhos_2026.geojson,
da CAOP) pelo mapeamento de portugal/js/pt/nuts-data.js. Assim as fronteiras
das regiões coincidem com as dos concelhos no mapa. O mapeamento foi conferido
concelho a concelho com a tabela LAU 2024 -> NUTS 2024 do Eurostat em
29/09/2026 (EU-27-LAU-2024-NUTS-2024.xlsx; em Portugal a LAU é a freguesia, com
o código DICOFRE).

Simplificação: shapely.coverage_simplify por nível, como em
gerar_malhas_regioes.py (Brasil): simplificar cada região isolada abre fendas
entre vizinhas. Tolerância 0,003 grau (~300 m): a camada é vista com o país
inteiro no ecrã (~1 km por pixel), e quem clica numa região cai nos concelhos em
resolução cheia. Com isso o arquivo tem ~500 KiB e o Corvo guarda 65 vértices.

O único buraco interno (Douro, e Norte na NUTS II) é o enclave de Trancoso, que
é das Beiras e Serra da Estrela: é geografia, não fenda.

Saída: portugal/dados/mapas/regioes.geojson, uma feição por região com
properties { id: "n3:Cávado", nivel: "n3", nome: "Cávado" }. O id é o valor do
filtro regional do site (STATE.currentNuts, <select id="selectNuts">).

Uso:
  py scripts/gerar_regioes_pt.py
"""

import json
import os
import re
import sys

import geopandas as gpd
import shapely

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PT_DIR = os.path.join(BASE_DIR, 'portugal')
CONCELHOS = os.path.join(PT_DIR, 'dados', 'mapas', 'concelhos_2026.geojson')
NUTS_JS = os.path.join(PT_DIR, 'js', 'pt', 'nuts-data.js')
SAIDA = os.path.join(PT_DIR, 'dados', 'mapas', 'regioes.geojson')

TOLERANCIA = 0.003   # grau
PRECISAO = 1e-4      # grau (~10 m), para o arquivo não levar 15 casas decimais
NIVEIS = ('n1', 'n2', 'n3', 'am')

# "0101": { n1: "Continente", n2: "Centro", n3: "Região de Aveiro", am: null },
LINHA = re.compile(r'"(\d{4})": \{ n1: "([^"]+)", n2: "([^"]+)", n3: "([^"]+)", am: (?:"([^"]+)"|null) \}')


def ler_nuts():
    texto = open(NUTS_JS, encoding='utf-8').read()
    return {m.group(1): dict(zip(NIVEIS, m.groups()[1:])) for m in LINHA.finditer(texto)}


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    nuts = ler_nuts()
    conc = gpd.read_file(CONCELHOS)
    divergentes = set(nuts) ^ set(conc['dico'])
    if len(nuts) != 308 or divergentes:
        sys.exit(f'nuts-data.js ({len(nuts)} concelhos) e a malha não batem: {sorted(divergentes)}')

    area_pais = conc.geometry.union_all().area
    feicoes = []
    for nivel in NIVEIS:
        conc['regiao'] = conc['dico'].map(lambda d: nuts[d][nivel])
        regioes = conc.dropna(subset=['regiao']).dissolve(by='regiao')
        geoms = shapely.coverage_simplify(regioes.geometry.values, TOLERANCIA)
        geoms = [shapely.set_precision(g, PRECISAO) for g in geoms]
        buracos = sum(len(p.interiors) for g in geoms for p in getattr(g, 'geoms', [g]))
        area = sum(g.area for g in geoms)
        print(f'{nivel}: {len(geoms):2} regiões, {buracos} buracos internos, '
              f'área {100 * area / area_pais:.2f}% do país')
        for nome, geom in zip(regioes.index, geoms):
            feicoes.append({
                'type': 'Feature',
                'properties': {'id': f'{nivel}:{nome}', 'nivel': nivel, 'nome': nome},
                'geometry': shapely.geometry.mapping(geom),
            })

    with open(SAIDA, 'w', encoding='utf-8') as f:
        json.dump({'type': 'FeatureCollection', 'features': feicoes}, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{SAIDA}: {len(feicoes)} regiões, {os.path.getsize(SAIDA) / 1024:.0f} KiB')


if __name__ == '__main__':
    main()
