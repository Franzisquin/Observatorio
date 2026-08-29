# -*- coding: utf-8 -*-
"""
Regenera o mapa nacional por UF embutido nas paginas de apuracao
(apuracao.html e apuracao-presidente.html) a partir da malha estadual do IBGE
em resultados_geo/estados_brasil.geojson.

O desenho que estava ali tinha 971 vertices no pais inteiro e coordenadas
inteiras num viewBox de 1000 unidades: a costa saia em degraus de 1 unidade e
os trechos retos denunciavam a simplificacao. A malha do IBGE traz ~69 mil
vertices; aqui ela e projetada uma vez, simplificada por Douglas-Peucker com
tolerancia bem abaixo do pixel e escrita com uma casa decimal.

Enquadramento: equirretangular simples (longitude -> x, latitude -> y, sem
correcao pelo cosseno), ancorada no canto do bbox continental e escalada por
864 / (lat_max - lat_min). Nao e a projecao mais fiel, e sim exatamente a que o
mapa antigo usava — reproduzi-la mantem o viewBox 1000x864, o mesmo canto e a
mesma largura util de 868 unidades, entao o disco do "Exterior" e o CSS das duas
paginas continuam valendo sem ajuste.

Ilhas: so entram poligonos com area >= 0.01 grau^2 (~115 km^2). Abaixo disso o
ponto sairia menor que um pixel na tela e so sujaria o litoral — e o mapa antigo
tambem nao as tinha.

Uso:
  py scripts/gerar_mapa_nacional_svg.py            (regenera e reescreve o HTML)
  py scripts/gerar_mapa_nacional_svg.py --imprimir (so mostra o relatorio)
"""

import io
import json
import math
import os
import re
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MALHA = os.path.join(BASE_DIR, 'resultados_geo', 'estados_brasil.geojson')

# Paginas que trazem o mapa embutido, e o id do <svg> em cada uma.
PAGINAS = [
    ('apuracao.html', 'mapaNacional'),
    ('apuracao-presidente.html', 'mapaBrasil'),
]

ALTURA = 864.0          # altura do viewBox, herdada do mapa antigo
TOLERANCIA = 0.3        # unidades do viewBox (~0,4 px na maior tela prevista)
DECIMAIS = 1
AREA_MINIMA = 0.01      # grau^2; abaixo disso a ilha nao chega a um pixel


def poligonos(geom):
    return [geom['coordinates']] if geom['type'] == 'Polygon' else geom['coordinates']


def area_anel(anel):
    """Area do anel pela formula do shoelace, em grau^2 — serve so para separar
    o continente das ilhas, nao para medir territorio."""
    a = 0.0
    for i in range(len(anel) - 1):
        a += anel[i][0] * anel[i + 1][1] - anel[i + 1][0] * anel[i][1]
    return abs(a) / 2


def simplificar(pontos, tol):
    """Douglas-Peucker iterativo. O anel chega fechado e sai fechado: o primeiro
    e o ultimo ponto sao sempre preservados."""
    if len(pontos) < 3:
        return pontos
    guardar = [False] * len(pontos)
    guardar[0] = guardar[-1] = True
    pilha = [(0, len(pontos) - 1)]
    while pilha:
        i, j = pilha.pop()
        if j <= i + 1:
            continue
        x1, y1 = pontos[i]
        x2, y2 = pontos[j]
        dx, dy = x2 - x1, y2 - y1
        norma = dx * dx + dy * dy
        pior, alvo = 0.0, -1
        for m in range(i + 1, j):
            x, y = pontos[m]
            if norma == 0:
                dist = math.hypot(x - x1, y - y1)
            else:
                t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / norma))
                dist = math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))
            if dist > pior:
                pior, alvo = dist, m
        if pior > tol:
            guardar[alvo] = True
            pilha.append((i, alvo))
            pilha.append((alvo, j))
    return [p for p, k in zip(pontos, guardar) if k]


def ler_malha():
    dados = json.load(io.open(MALHA, encoding='utf-8'))
    estados = []
    for f in dados['features']:
        props = f['properties']
        aneis = [p for p in poligonos(f['geometry']) if area_anel(p[0]) >= AREA_MINIMA]
        if aneis:
            estados.append((props['SIGLA_UF'].lower(), props['NM_UF'], aneis))
    return estados


def enquadrar(estados):
    xs = [c[0] for _, _, ps in estados for p in ps for anel in p for c in anel]
    ys = [c[1] for _, _, ps in estados for p in ps for anel in p for c in anel]
    lon0, lat1 = min(xs), max(ys)
    k = ALTURA / (max(ys) - min(ys))
    return lon0, lat1, k


def caminho(aneis, lon0, lat1, k):
    partes = []
    for poly in aneis:
        for anel in poly:
            pts = [((c[0] - lon0) * k, (lat1 - c[1]) * k) for c in anel]
            pts = simplificar(pts, TOLERANCIA)
            fmt = '%.{0}f %.{0}f'.format(DECIMAIS)
            partes.append('M' + ' '.join(fmt % (x, y) for x, y in pts) + 'Z')
    return ''.join(partes)


def montar():
    estados = ler_malha()
    lon0, lat1, k = enquadrar(estados)

    # O Distrito Federal e um enclave e a malha nao abre buraco em Goias: sai por
    # ultimo para ficar por cima. O resto vai em ordem alfabetica.
    ordem = sorted(estados, key=lambda e: (e[0] == 'df', e[0]))

    linhas, vertices = [], 0
    for sigla, nome, aneis in ordem:
        d = caminho(aneis, lon0, lat1, k)
        vertices += len(re.findall(r'-?\d+\.\d+ -?\d+\.\d+', d))
        linhas.append('<path data-chave="%s" data-nome="%s" d="%s"></path>'
                      % (sigla, nome, d))
    return linhas, vertices


def reescrever(caminho_html, id_svg, blocos):
    s = io.open(caminho_html, encoding='utf-8').read()
    abertura = re.search(r'(<svg class="apu-map" id="%s"[^>]*>)' % id_svg, s)
    if not abertura:
        raise SystemExit('nao achei o <svg id="%s"> em %s' % (id_svg, caminho_html))
    # Depois dos estados vem o disco do "Exterior" na pagina do presidente e o
    # fecho do <svg> na central: a substituicao vai ate o que vier primeiro,
    # para nao encostar em nada alem dos paths das UFs.
    resto = s[abertura.end():]
    corte = min(i for i in (resto.find('<g class="apu-exterior">'), resto.find('</svg>'))
                if i >= 0)
    novo = ''.join('\n          ' + b for b in blocos) + '\n          '
    return s[:abertura.end()] + novo + resto[corte:]


def main():
    linhas, vertices = montar()
    peso = sum(len(l) for l in linhas) / 1024.0
    print('estados: %d   vertices: %d   marcacao: %.1f KB'
          % (len(linhas), vertices, peso))
    if '--imprimir' in sys.argv:
        return
    for arquivo, id_svg in PAGINAS:
        alvo = os.path.join(BASE_DIR, arquivo)
        # Monta a pagina inteira antes de abrir para escrita: abrir em 'w' trunca
        # o arquivo, e um erro no meio da montagem deixaria a pagina vazia.
        pagina = reescrever(alvo, id_svg, linhas)
        io.open(alvo, 'w', encoding='utf-8', newline='').write(pagina)
        print('reescrito', arquivo)


if __name__ == '__main__':
    main()
