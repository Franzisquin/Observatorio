# -*- coding: utf-8 -*-
"""
Converte 1994/mapa1994BR.svg (malha municipal de 1994; 5022 paths com
id = codigo IBGE-7, data-nome e data-uf) em GeoJSON georreferenciado por UF,
no mesmo schema da malha atual (CD_MUN / NM_MUN), para o choropleth das
eleicoes gerais de 1994.

Georreferenciamento: os municipios de 1994 ainda existem na malha atual
(resultados_geo/municipios_hd/municipios_{UF}.geojson). Casamos os centroides
por codigo IBGE e ajustamos uma transformacao AFIM (lon,lat <- x,y do SVG) por
minimos quadrados: uma global (fallback) e uma por UF (usada quando ha pontos
suficientes). O RMS por UF e reportado em km.

Saidas:
  resultados_geo/municipios_1994/municipios_1994_{UF}.geojson
  scratch/malha1994/index_1994.json  ({ibge: {nome, uf}} p/ join TSE->IBGE)

Uso:
  py scripts/gerar_malha_1994.py
"""

import html
import json
import math
import os
import re
import sys
from collections import defaultdict

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SVG_PATH = os.path.join(BASE_DIR, '1994', 'mapa1994BR.svg')
HD_DIR = os.path.join(BASE_DIR, 'resultados_geo', 'municipios_hd')
OUT_DIR = os.path.join(BASE_DIR, 'resultados_geo', 'municipios_1994')
SCRATCH_DIR = os.path.join(BASE_DIR, 'scratch', 'malha1994')

PATH_RE = re.compile(
    r'<path[^>]*?d="([^"]+)"[^>]*?id="(\d{7})"[^>]*?data-nome="([^"]*)"[^>]*?data-uf="([^"]*)"',
    re.S)


def parse_svg_paths(svg_text):
    """[(ibge, nome, uf, [anel [(x,y), ...], ...]), ...]"""
    out = []
    for m in PATH_RE.finditer(svg_text):
        d, ibge, nome, uf = m.group(1), m.group(2), html.unescape(m.group(3)), m.group(4)
        rings = []
        for sub in re.split(r'[MZz]', d):
            nums = re.findall(r'-?\d+(?:\.\d+)?', sub)
            if len(nums) < 6:
                continue
            pts = [(float(nums[i]), float(nums[i + 1])) for i in range(0, len(nums) - 1, 2)]
            if len(pts) >= 3:
                rings.append(pts)
        if rings:
            out.append((ibge, nome, uf, rings))
    return out


def ring_centroid(pts):
    """Centroide de area do anel (fallback: media dos vertices)."""
    a = cx = cy = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        cross = x1 * y2 - x2 * y1
        a += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    if abs(a) < 1e-9:
        return (sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n)
    a *= 0.5
    return (cx / (6 * a), cy / (6 * a))


def biggest_ring(rings):
    def ring_area(pts):
        a = 0.0
        for i in range(len(pts)):
            x1, y1 = pts[i]
            x2, y2 = pts[(i + 1) % len(pts)]
            a += x1 * y2 - x2 * y1
        return abs(a) / 2
    return max(rings, key=ring_area)


def geom_centroid_geojson(geom):
    if geom['type'] == 'Polygon':
        return ring_centroid(geom['coordinates'][0])
    if geom['type'] == 'MultiPolygon':
        best = max(geom['coordinates'], key=lambda poly: len(poly[0]))
        return ring_centroid(best[0])
    return None


def fit_affine(pairs):
    """pairs: [((x,y), (lon,lat))]. Retorna (ax,bx,cx, ay,by,cy) por minimos
    quadrados: lon = ax*x + bx*y + cx ; lat = ay*x + by*y + cy."""
    n = len(pairs)
    sx = sy = sxx = syy = sxy = 0.0
    slon = slat = sxlon = sylon = sxlat = sylat = 0.0
    for (x, y), (lon, lat) in pairs:
        sx += x; sy += y
        sxx += x * x; syy += y * y; sxy += x * y
        slon += lon; slat += lat
        sxlon += x * lon; sylon += y * lon
        sxlat += x * lat; sylat += y * lat

    # Resolve o sistema 3x3 (mesma matriz p/ lon e lat).
    A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, float(n)]]
    def solve3(mat, vec):
        m = [row[:] + [v] for row, v in zip(mat, vec)]
        for col in range(3):
            piv = max(range(col, 3), key=lambda r: abs(m[r][col]))
            m[col], m[piv] = m[piv], m[col]
            for r in range(3):
                if r != col and abs(m[col][col]) > 1e-12:
                    f = m[r][col] / m[col][col]
                    for c in range(4):
                        m[r][c] -= f * m[col][c]
        return [m[i][3] / m[i][i] for i in range(3)]

    ax, bx, cx = solve3(A, [sxlon, sylon, slon])
    ay, by, cy = solve3(A, [sxlat, sylat, slat])
    return (ax, bx, cx, ay, by, cy)


def apply_affine(t, x, y):
    ax, bx, cx, ay, by, cy = t
    return (ax * x + bx * y + cx, ay * x + by * y + cy)


def residual_km(t, pair):
    (x, y), (lon, lat) = pair
    plon, plat = apply_affine(t, x, y)
    dlat = (plat - lat) * 111.32
    dlon = (plon - lon) * 111.32 * math.cos(math.radians(lat))
    return math.hypot(dlat, dlon)


def rms_km(t, pairs):
    if not pairs:
        return None
    total = sum(residual_km(t, p) ** 2 for p in pairs)
    return math.sqrt(total / len(pairs))


def fit_affine_robust(pairs, iters=6):
    """Ajuste afim com descarte iterativo de outliers. Municipios que perderam
    territorio para emancipacoes pos-1994 tem centroide moderno deslocado de
    verdade — nao sao erro de projecao e nao devem puxar o ajuste."""
    inliers = list(pairs)
    t = fit_affine(inliers)
    for _ in range(iters):
        res = sorted(residual_km(t, p) for p in inliers)
        med = res[len(res) // 2]
        thr = max(3.0 * med, 2.0)
        kept = [p for p in inliers if residual_km(t, p) <= thr]
        if len(kept) < 4 or len(kept) == len(inliers):
            break
        inliers = kept
        t = fit_affine(inliers)
    return t, inliers


def main():
    print('Lendo SVG...')
    with open(SVG_PATH, encoding='utf-8') as f:
        svg_text = f.read()
    paths = parse_svg_paths(svg_text)
    print(f'  {len(paths)} municipios no SVG')

    by_uf = defaultdict(list)
    for item in paths:
        by_uf[item[2]].append(item)

    # Centroides da malha atual por IBGE.
    print('Lendo malha atual (municipios_hd)...')
    modern = {}
    for uf in sorted(by_uf.keys()):
        hd = os.path.join(HD_DIR, f'municipios_{uf}.geojson')
        if not os.path.exists(hd):
            print(f'  [AVISO] sem malha atual para {uf}')
            continue
        with open(hd, encoding='utf-8') as f:
            gj = json.load(f)
        for feat in gj.get('features', []):
            code = str(feat.get('properties', {}).get('CD_MUN', '')).strip()
            cen = geom_centroid_geojson(feat.get('geometry') or {})
            if code and cen:
                modern[code] = cen

    # Pares de controle (centroide SVG do maior anel <-> centroide atual).
    pairs_by_uf = defaultdict(list)
    all_pairs = []
    for ibge, nome, uf, rings in paths:
        if ibge not in modern:
            continue
        svg_c = ring_centroid(biggest_ring(rings))
        pair = (svg_c, modern[ibge])
        pairs_by_uf[uf].append(pair)
        all_pairs.append(pair)

    print(f'  {len(all_pairs)} pares de controle (IBGE compartilhado)')
    t_global, g_inliers = fit_affine_robust(all_pairs)
    print(f'  RMS global robusto: {rms_km(t_global, g_inliers):.2f} km '
          f'({len(g_inliers)}/{len(all_pairs)} inliers)')

    # A projecao do SVG e afim globalmente (RMS < 1 km nos inliers), entao uma
    # unica transformacao serve para todas as UFs. Ajustes por UF sao piores em
    # estados onde quase todos os municipios mudaram de forma pos-1994 (ex.: RR),
    # pois nao sobra centroide estavel para ancorar o ajuste local.
    g_inlier_set = set(id(p) for p in g_inliers)
    print('RMS por UF (transformacao global, medido nos inliers globais da UF):')
    worst = 0.0
    for uf, pairs in sorted(pairs_by_uf.items()):
        inliers = [p for p in pairs if id(p) in g_inlier_set]
        r = rms_km(t_global, inliers if inliers else pairs)
        worst = max(worst, r)
        print(f'  {uf}: {r:6.2f} km  ({len(inliers)}/{len(pairs)} inliers globais)')
    print(f'  pior UF (inliers): {worst:.2f} km')
    transforms = {uf: t_global for uf in pairs_by_uf}

    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(SCRATCH_DIR, exist_ok=True)

    index = {}
    for uf, items in sorted(by_uf.items()):
        t = transforms.get(uf, t_global)
        features = []
        for ibge, nome, _uf, rings in items:
            polys = []
            for ring in rings:
                coords = [list(apply_affine(t, x, y)) for x, y in ring]
                if coords[0] != coords[-1]:
                    coords.append(coords[0])
                coords = [[round(lon, 5), round(lat, 5)] for lon, lat in coords]
                polys.append([coords])
            geometry = ({'type': 'Polygon', 'coordinates': polys[0]}
                        if len(polys) == 1
                        else {'type': 'MultiPolygon', 'coordinates': polys})
            features.append({
                'type': 'Feature',
                'geometry': geometry,
                'properties': {'CD_MUN': ibge, 'NM_MUN': nome, 'SIGLA_UF': uf}
            })
            index[ibge] = {'nome': nome, 'uf': uf}

        out = os.path.join(OUT_DIR, f'municipios_1994_{uf}.geojson')
        with open(out, 'w', encoding='utf-8') as f:
            json.dump({'type': 'FeatureCollection', 'features': features}, f,
                      ensure_ascii=False, separators=(',', ':'))
        print(f'  {out}: {len(features)} municipios')

    with open(os.path.join(SCRATCH_DIR, 'index_1994.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False)
    print('OK.')


if __name__ == '__main__':
    sys.exit(main())
