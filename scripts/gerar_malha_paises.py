"""Gera resultados_geo/paises_mundo.geojson -- a malha do mundo da visao da diaspora.

Fonte: Natural Earth 50m admin-0 (dominio publico), via o repositorio
nvkelso/natural-earth-vector. E o equivalente de estados_brasil.geojson para o
escopo 'ZZ': js/diaspora-view.js le este arquivo cru e etiqueta cada feature com
CD_REG = iso3, que e a chave contra a qual o resumo por pais casa.

POR QUE 50m E NAO 110m
----------------------
A resolucao 110m (838 KB) descarta os paises pequenos -- Singapura, Hong Kong,
Bahrein, Malta -- e todos os quatro tem consulado brasileiro com voto. Sem eles o
mapa ficaria com buraco justamente onde ha eleitor.

REDUCAO
-------
O arquivo do Natural Earth tem 3,0 MB e ~90 propriedades por pais. Aqui sobram
tres (iso3, nome em portugues, nome em ingles) e a coordenada vai a 3 casas
decimais (~110 m no equador, ordens de grandeza alem do que um mapa-mundi
resolve). Resultado na casa de 1,5 MB, mesma ordem de estados_brasil.geojson.

ISO_A3 vem '-99' em alguns paises do Natural Earth (Franca, Noruega, Kosovo, e as
dependencias); nesses casos vale ADM0_A3, que nunca e nulo.

Rodar da raiz do repo:  python scripts/gerar_malha_paises.py
"""

import json
import os
import sys
import urllib.request

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(BASE_DIR, 'resultados_geo', 'paises_mundo.geojson')
FONTE = ('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/'
         'geojson/ne_50m_admin_0_countries.geojson')

CASAS = 3


def arredondar(coords):
    """Arredonda in-place a arvore de coordenadas do GeoJSON (aninhamento variavel)."""
    if isinstance(coords[0], (int, float)):
        return [round(float(v), CASAS) for v in coords]
    return [arredondar(c) for c in coords]


def iso3_de(props):
    for chave in ('ISO_A3', 'ISO_A3_EH', 'ADM0_A3'):
        valor = str(props.get(chave) or '').strip().upper()
        if valor and valor != '-99':
            return valor
    return ''


def main():
    print(f'Baixando {FONTE.rsplit("/", 1)[-1]} ...', flush=True)
    with urllib.request.urlopen(FONTE, timeout=300) as resposta:
        bruto = json.loads(resposta.read().decode('utf-8'))

    features = []
    vistos = set()
    for feature in bruto.get('features', []):
        props = feature.get('properties') or {}
        iso3 = iso3_de(props)
        if not iso3:
            print(f'  [sem iso3] {props.get("NAME")}')
            continue
        if iso3 in vistos:
            # Natural Earth separa alguns territorios em features irmas com o
            # mesmo codigo; a primeira e a soberania, que e o que interessa aqui.
            print(f'  [duplicado] {iso3} {props.get("NAME")}')
            continue
        vistos.add(iso3)

        geometria = feature.get('geometry')
        if not geometria or not geometria.get('coordinates'):
            continue

        features.append({
            'type': 'Feature',
            'properties': {
                'iso3': iso3,
                'nome_pt': str(props.get('NAME_PT') or props.get('NAME') or iso3),
                'nome_en': str(props.get('NAME') or iso3),
            },
            'geometry': {
                'type': geometria['type'],
                'coordinates': arredondar(geometria['coordinates']),
            },
        })

    os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
    with open(SAIDA, 'w', encoding='utf-8') as fh:
        json.dump({'type': 'FeatureCollection', 'features': features}, fh,
                  ensure_ascii=False, separators=(',', ':'))

    tamanho = os.path.getsize(SAIDA) / 1e6
    print(f'\n{len(features)} paises -> {SAIDA} ({tamanho:.1f} MB)')

    # Conferencia das quatro ausencias que motivaram escolher 50m.
    faltando = [i for i in ('SGP', 'HKG', 'BHR', 'MLT') if i not in vistos]
    if faltando:
        print('ATENCAO: faltam na malha:', ', '.join(faltando))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
