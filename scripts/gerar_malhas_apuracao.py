# -*- coding: utf-8 -*-
"""
Pre-projeta a malha municipal de alta definicao (resultados_geo/municipios_hd)
em paths SVG prontos, um arquivo por UF, para o mapa da apuracao.

A pagina fazia isso em tempo de execucao: baixava a malha simplificada
(resultados_geo/municipios) e rodava Douglas-Peucker no navegador. Saia caro e
saia grosso — a malha de origem ja era a de baixa definicao. Aqui a fonte e a
HD do IBGE, a simplificacao acontece uma vez so, e o que chega ao navegador e
menor do que o GeoJSON que ele baixava antes.

Projecao equiretangular corrigida pelo cosseno da latitude media, viewBox de
largura 1000 — a mesma do mapa nacional embutido em apuracao-governador.html, para que o
CSS trate os dois mapas igual.

As camadas regionais (regiao imediata e intermediaria, divisao IBGE 2023) saem
no MESMO enquadramento da municipal daquela UF — mesmo viewBox, mesma origem —
para que trocar de camada no mapa da apuracao nao faca o desenho saltar. Cada
regiao carrega a lista de municipios que a compoem: e o que a pagina soma para
pintar, e evita baixar o indice nacional inteiro (430 KB).

Saida:
  resultados_geo/municipios_svg/municipios_{UF}.json
    {"w":1000,"h":H,"p":[[cd_ibge, nome, "M... Z"], ...]}
  resultados_geo/regioes_svg/{rgi|rgint}_{UF}.json
    {"w":1000,"h":H,"p":[[cd_regiao, nome, "M... Z", [cd_ibge, ...]], ...]}

Uso:
  py scripts/gerar_malhas_apuracao.py             (tudo, todas as UFs)
  py scripts/gerar_malhas_apuracao.py MG SP       (so essas)
  py scripts/gerar_malhas_apuracao.py --regioes   (so as camadas regionais)
"""

import json
import math
import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HD_DIR = os.path.join(BASE_DIR, 'resultados_geo', 'municipios_hd')
NOMES_DIR = os.path.join(BASE_DIR, 'resultados_geo', 'municipios')
OUT_DIR = os.path.join(BASE_DIR, 'resultados_geo', 'municipios_svg')
REG_OUT_DIR = os.path.join(BASE_DIR, 'resultados_geo', 'regioes_svg')
PONTE = os.path.join(BASE_DIR, 'resultados_geo', 'tse_para_ibge.json')
INDICE_REGIOES = os.path.join(BASE_DIR, 'resultados_geo', 'regioes_index.json')

# Niveis regionais oferecidos no mapa, na ordem em que aparecem no controle.
NIVEIS = ['rgint', 'rgi']

# Municipio instalado depois da divisao regional do IBGE (2023): nao consta do
# indice muni->regiao e sumiria da soma da camada regional — os votos dele estao
# no boletim e nao cairiam em regiao nenhuma. Herda a regiao do municipio de
# origem, que e quem ocupa o territorio dele na malha de 2023. A origem foi
# apurada por contencao geometrica na malha HD, nao por tabela externa; se
# aparecer um caso novo, a conferencia no fim deste script avisa.
ORFAOS = {'5101837': '5106240'}   # Boa Esperanca do Norte <- Nova Ubirata (MT)

# Ilhas oceanicas, ajustadas em graus ANTES da projecao — o enquadramento da UF
# sai do que sobra, entao o estado volta a ocupar o mapa.
#
# Trindade e Martim Vaz sao de Vitoria (ES), a 1.100 km da costa e sem eleitor:
# esticavam o enquadramento ate o meio do Atlantico. Saem por completo; o
# municipio fica, so sem as ilhas. Todo poligono inteiro a leste da longitude
# dada sai, em todas as camadas daquela UF.
SEM_ILHAS = {'ES': -38.0}

# Fernando de Noronha (PE) fica a 350 km da costa: no lugar real, o estado
# virava uma faixa no pe de um quadro vazio. Vai para um quadro logo abaixo do
# continente, no canto sudeste, ampliado `escala` vezes. O nome fica so no balao
# da pagina: o rotulo segue no arquivo (`q`), mas nao e desenhado.
# `canto` e o canto inferior direito do quadro, em graus (longitude, latitude).
QUADROS = {
    'PE': {'leste_de': -34.0, 'escala': 3.0, 'folga': 0.05,
           'canto': (-34.86, -9.30), 'rotulo': 'Fernando de Noronha'},
}

LARGURA = 1000
# Tolerancia do Douglas-Peucker, em unidades do viewBox. O mapa ocupa no maximo
# ~1400px de tela, entao 0.15 unidade fica abaixo de um terco de pixel: e o
# ponto onde afinar mais so engorda o arquivo.
TOLERANCIA = 0.15
# Uma casa decimal em 1000 unidades da uma grade de ~0.1 unidade — na maior UF
# (MG, ~1160 km de largura) isso e pouco mais de 100 m.
CASAS = 1

# A camada municipal sai em 2000 unidades e coordenada inteira: a mesma grade de
# 0,5 unidade-de-1000, sem o ponto decimal, que e o que mais pesa num arquivo de
# 850 municipios. As regionais ficam em 1000 com uma casa. As duas tem a mesma
# proporcao, e a pagina troca o viewBox junto com a camada — o desenho nao salta.
LARGURA_MUN = 2000
CASAS_MUN = 0


def aneis(geom):
    t = (geom or {}).get('type')
    if t == 'Polygon':
        return [geom['coordinates']]
    if t == 'MultiPolygon':
        return geom['coordinates']
    return []


def douglas_peucker(pts, tol2):
    """Iterativo: alguns aneis da malha HD tem dezenas de milhares de pontos e a
    versao recursiva estoura a pilha do Python."""
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
        pior = 0.0
        idx = -1
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


def caixa_de(poligonos):
    xs = [x for poly in poligonos for x, _ in poly[0]]
    ys = [y for poly in poligonos for _, y in poly[0]]
    return min(xs), min(ys), max(xs), max(ys)


def ajuste_da_uf(uf, feicoes):
    """O que fazer com as ilhas daquela UF: (corte, quadro). `quadro` leva a
    transformacao ja resolvida — origem e escala tiradas da malha MUNICIPAL —,
    para que as camadas regionais recebam exatamente o mesmo deslocamento."""
    corte = SEM_ILHAS.get(uf)
    cfg = QUADROS.get(uf)
    if not cfg:
        return corte, None
    ilhas = [poly for f in feicoes for poly in aneis(f.get('geometry'))
             if min(x for x, _ in poly[0]) > cfg['leste_de']]
    if not ilhas:
        return corte, None
    o, s, l, n = caixa_de(ilhas)
    e, f = cfg['escala'], cfg['folga']
    largura, altura = (l - o) * e, (n - s) * e
    dx, dy = cfg['canto']
    # Canto inferior direito do quadro em `canto`; a ilha fica centrada nele.
    q_l, q_s = dx, dy
    q_o, q_n = q_l - largura - 2 * f, q_s + altura + 2 * f
    return corte, {**cfg, 'origem': (o, s), 'destino': (q_o + f, q_s + f),
                   'caixa': (q_o, q_s, q_l, q_n)}


def ajustar(geom, corte, quadro):
    """Aplica corte e quadro a uma geometria (em graus). Devolve None se nao
    sobrar nada."""
    if not geom or (corte is None and quadro is None):
        return geom
    novos = []
    for poly in aneis(geom):
        menor = min(x for x, _ in poly[0])
        if corte is not None and menor > corte:
            continue
        if quadro and menor > quadro['leste_de']:
            (ox, oy), (tx, ty), e = quadro['origem'], quadro['destino'], quadro['escala']
            poly = [[[tx + (x - ox) * e, ty + (y - oy) * e] for x, y in anel] for anel in poly]
        novos.append(poly)
    if not novos:
        return None
    return {'type': 'MultiPolygon', 'coordinates': novos}


def quadros_projetados(quadro, proj, largura=LARGURA):
    """O retangulo e o rotulo do quadro, ja no viewBox: [x, y, w, h, rotulo]."""
    if not quadro:
        return []
    o, s, l, n = quadro['caixa']
    escala = largura / LARGURA
    x = ((o - proj['mnx']) * proj['k']) / proj['lg'] * largura
    y = (proj['mxy'] - n) / proj['ag'] * proj['h'] * escala
    w = ((l - o) * proj['k']) / proj['lg'] * largura
    h = (n - s) / proj['ag'] * proj['h'] * escala
    return [[round(x, 1), round(y, 1), round(w, 1), round(h, 1), quadro['rotulo']]]


def projecao(feicoes, extras=()):
    """Enquadramento da UF: mesma origem, mesma escala e mesmo viewBox para
    todas as camadas dela — municipio e regiao precisam se sobrepor pixel a
    pixel, senao trocar de camada faz o mapa saltar. `extras` sao pontos que
    tambem precisam caber: o quadro de uma ilha e o rotulo embaixo dele."""
    mnx, mxx, mny, mxy = 180.0, -180.0, 90.0, -90.0
    for x, y in extras:
        mnx = min(mnx, x); mxx = max(mxx, x)
        mny = min(mny, y); mxy = max(mxy, y)
    for feat in feicoes:
        for poly in aneis(feat.get('geometry')):
            for anel in poly:
                for x, y in anel:
                    mnx = min(mnx, x); mxx = max(mxx, x)
                    mny = min(mny, y); mxy = max(mxy, y)
    if mnx > mxx:
        return None

    k = math.cos(((mny + mxy) / 2) * math.pi / 180) or 1
    largura_geo = (mxx - mnx) * k
    altura_geo = (mxy - mny)
    return {'mnx': mnx, 'mxy': mxy, 'k': k, 'lg': largura_geo, 'ag': altura_geo,
            'h': max(1, round(LARGURA * altura_geo / largura_geo))}


def path(geom, proj, largura=LARGURA, casas=CASAS):
    escala = largura / LARGURA
    # Estado mais alto que largo aparece limitado pela altura, e cada unidade
    # do viewBox vale menos tela: a tolerancia acompanha o lado maior. Sem isso
    # o Espirito Santo, sem Trindade, saia com quatro vezes os vertices de antes.
    tol = TOLERANCIA * escala * max(1.0, proj['h'] / LARGURA)
    tol2 = tol * tol
    partes = []
    for poly in aneis(geom):
        for anel in poly:
            if len(anel) < 4:
                continue
            pts = [(((x - proj['mnx']) * proj['k']) / proj['lg'] * largura,
                    (proj['mxy'] - y) / proj['ag'] * proj['h'] * escala) for x, y in anel]
            pts = douglas_peucker(pts, tol2)
            # O arredondamento cola vertices vizinhos; sem tirar as repeticoes o
            # path fica cheio de segmentos de comprimento zero.
            limpo = []
            ultimo = None
            for x, y in pts:
                c = (round(x, casas), round(y, casas))
                if casas == 0:
                    c = (int(c[0]), int(c[1]))
                if c != ultimo:
                    limpo.append(c)
                    ultimo = c
            if len(limpo) < 3:
                continue
            partes.append('M' + ' '.join(f'{x:g} {y:g}' for x, y in limpo) + 'Z')
    return ''.join(partes)


def malha_simples(uf):
    """A malha simplificada (resultados_geo/municipios), que traz NM_MUN e esta
    mais atualizada que a HD."""
    caminho = os.path.join(NOMES_DIR, f'municipios_{uf}.geojson')
    if not os.path.exists(caminho):
        return []
    with open(caminho, encoding='utf-8') as f:
        return json.load(f).get('features', [])


def codigo(feat):
    return str(feat.get('properties', {}).get('CD_MUN', '')).strip()


def gerar(uf):
    with open(os.path.join(HD_DIR, f'municipios_{uf}.geojson'), encoding='utf-8') as f:
        feicoes = json.load(f)['features']
    simples = malha_simples(uf)
    nomes = {codigo(f): f.get('properties', {}).get('NM_MUN', '') for f in simples}

    # A malha HD e de 2022 e nao tem as emancipacoes instaladas depois (hoje, so
    # Boa Esperanca do Norte/MT). Esses municipios entram pela malha simplificada
    # e vao no fim da lista, para pintarem por cima do territorio de origem, que
    # na HD ainda os contem. A ponte do TSE filtra o resto do que so a malha
    # simplificada tem: as "areas operacionais" das lagoas gauchas, que sao
    # feicao do IBGE, nao municipio, e nunca receberiam voto.
    tem_hd = {codigo(f) for f in feicoes}
    do_tse = set(json.load(open(PONTE, encoding='utf-8')).values())
    feicoes = feicoes + [f for f in simples
                         if codigo(f) not in tem_hd and codigo(f) in do_tse]

    corte, quadro = ajuste_da_uf(uf, feicoes)
    feicoes = [{**f, 'geometry': ajustar(f.get('geometry'), corte, quadro)} for f in feicoes]
    extras = []
    if quadro:
        o, s, l, n = quadro['caixa']
        extras = [(o, s), (l, n)]
    proj = projecao(feicoes, extras)
    if not proj:
        return None, None
    proj['corte'], proj['quadro'] = corte, quadro

    saida = []
    for feat in feicoes:
        cd = codigo(feat)
        d = path(feat.get('geometry'), proj, LARGURA_MUN, CASAS_MUN)
        if d:
            saida.append([cd, nomes.get(cd, ''), d])

    escala = LARGURA_MUN / LARGURA
    malha = {'w': LARGURA_MUN, 'h': round(proj['h'] * escala), 'p': saida}
    if quadro:
        malha['q'] = quadros_projetados(quadro, proj, LARGURA_MUN)
    return malha, proj


def membros(nivel):
    """Codigo da regiao -> municipios que a compoem, do indice que
    scripts/gerar_malhas_regioes.py escreve."""
    with open(INDICE_REGIOES, encoding='utf-8') as f:
        indice = json.load(f).get('muni', {})
    fora = {}
    for ibge, regs in indice.items():
        cd = regs.get(nivel)
        if cd:
            fora.setdefault(str(cd), []).append(str(ibge))

    for orfao, origem in ORFAOS.items():
        cd = (indice.get(origem) or {}).get(nivel)
        if cd:
            fora.setdefault(str(cd), []).append(orfao)
    return fora


def gerar_regiao(uf, nivel, proj, por_regiao):
    caminho = os.path.join(BASE_DIR, 'resultados_geo', f'regioes_{nivel}',
                           f'regioes_{nivel}_{uf}.geojson')
    if not os.path.exists(caminho):
        return None
    with open(caminho, encoding='utf-8') as f:
        feicoes = json.load(f)['features']

    saida = []
    for feat in feicoes:
        p = feat.get('properties', {})
        cd = str(p.get('CD_REG', '')).strip()
        geom = ajustar(feat.get('geometry'), proj.get('corte'), proj.get('quadro'))
        d = path(geom, proj)
        if cd and d:
            saida.append([cd, p.get('NM_REG', ''), d, sorted(por_regiao.get(cd, []))])

    if not saida:
        return None
    reg = {'w': LARGURA, 'h': proj['h'], 'p': saida}
    if proj.get('quadro'):
        reg['q'] = quadros_projetados(proj['quadro'], proj)
    return reg


def conferir(malha, reg):
    """As regioes tem que particionar os municipios da UF — cada um em exatamente
    uma regiao. Se isso quebrar, o mapa regional soma voto a mais ou a menos e
    ninguem percebe olhando: sai um mapa plausivel e errado."""
    do_mapa = {p[0] for p in malha['p']}
    listados = [ibge for p in reg['p'] for ibge in p[3]]
    return (len(listados) - len(set(listados)),   # municipio em duas regioes
            sorted(do_mapa - set(listados)),      # no mapa, fora de toda regiao
            sorted(set(listados) - do_mapa))      # em regiao, fora do mapa


def main():
    argv = [a for a in sys.argv[1:] if a != '--regioes']
    so_regioes = '--regioes' in sys.argv
    alvos = [a.upper() for a in argv]
    if not alvos:
        alvos = sorted(n[11:13] for n in os.listdir(HD_DIR) if n.endswith('.geojson'))

    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(REG_OUT_DIR, exist_ok=True)
    por_regiao = {n: membros(n) for n in NIVEIS}

    for uf in alvos:
        malha, proj = gerar(uf)
        if not proj:
            print(f'  [AVISO] {uf}: malha vazia')
            continue

        if not so_regioes:
            destino = os.path.join(OUT_DIR, f'municipios_{uf}.json')
            with open(destino, 'w', encoding='utf-8') as f:
                json.dump(malha, f, ensure_ascii=False, separators=(',', ':'))
            sem_nome = sum(1 for p in malha['p'] if not p[1])
            aviso = f'  [{sem_nome} sem nome]' if sem_nome else ''
            print(f'  {uf}: {len(malha["p"]):4d} municipios  '
                  f'{os.path.getsize(destino) / 1024:7.0f} KB{aviso}', flush=True)

        for nivel in NIVEIS:
            reg = gerar_regiao(uf, nivel, proj, por_regiao[nivel])
            if not reg:
                print(f'  [AVISO] {uf}/{nivel}: malha regional ausente')
                continue
            destino = os.path.join(REG_OUT_DIR, f'{nivel}_{uf}.json')
            with open(destino, 'w', encoding='utf-8') as f:
                json.dump(reg, f, ensure_ascii=False, separators=(',', ':'))
            dup, fora, sobra = conferir(malha, reg)
            alerta = []
            if dup:
                alerta.append(f'{dup} em duas regioes')
            if fora:
                alerta.append(f'{len(fora)} fora de regiao: {",".join(fora[:5])}')
            if sobra:
                alerta.append(f'{len(sobra)} fora do mapa: {",".join(sobra[:5])}')
            aviso = '  [AVISO] ' + '; '.join(alerta) if alerta else ''
            print(f'  {uf}/{nivel}: {len(reg["p"]):4d} regioes  '
                  f'{os.path.getsize(destino) / 1024:7.0f} KB{aviso}', flush=True)
    print('OK.')


if __name__ == '__main__':
    sys.exit(main())
