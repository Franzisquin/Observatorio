"""Pre-compila os mapas municipais da apuracao a partir da malha de alta definicao.

Por que pre-compilar: a malha `municipios_hd` do IBGE tem 49 MB (MG sozinho tem
7,9 MB). Mandar isso para o navegador e simplificar la, a cada abertura de
pagina, e caro duas vezes — na rede e na CPU. Aqui a simplificacao roda uma vez
e o que o site baixa e so o path SVG pronto.

Saida: resultados_geo/municipios_svg/municipios_{UF}.json

    {"w":2000,"h":1730,"p":[["3106200","Belo Horizonte","M..Z"], ...]}

A chave e o codigo IBGE de 7 digitos, que o snapshot da apuracao carrega em
`mun[cd].ibge` — e a ponte entre geometria e resultado.

    python scripts/apuracao/gerar_mapas_municipais.py
    python scripts/apuracao/gerar_mapas_municipais.py --uf MG SP --tolerancia 0.00012

A malha HD nao traz o nome do municipio (so `CD_MUN` e `codarea`); o nome vem
da malha comum, que tem `NM_MUN`, casado pelo mesmo codigo.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent.parent
HD = RAIZ / "resultados_geo" / "municipios_hd"
COMUM = RAIZ / "resultados_geo" / "municipios"
DESTINO = RAIZ / "resultados_geo" / "municipios_svg"

# Largura do viewBox. 2000 em vez de 1000 dobra a resolucao das coordenadas
# inteiras, que e o que evita o serrilhado em municipio pequeno.
LARGURA = 2000

# Tolerancia do Douglas-Peucker, em graus ao quadrado. Ajustada para preservar
# reentrancia de divisa e recorte de litoral sem carregar ponto redundante.
TOLERANCIA = 0.000002

# Ilhas menores que isto somem na escala do mapa e so custam bytes.
AREA_MINIMA = 0.00002

UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT",
       "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"]


def dist2(p, a, b) -> float:
    x, y = a
    dx, dy = b[0] - x, b[1] - y
    if dx or dy:
        t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy)
        if t > 1:
            x, y = b
        elif t > 0:
            x, y = x + dx * t, y + dy * t
    return (p[0] - x) ** 2 + (p[1] - y) ** 2


def dp(pts: list, tol: float) -> list:
    """Douglas-Peucker iterativo: em anel de litoral a versao recursiva
    estoura a pilha do Python."""
    if len(pts) <= 3:
        return pts
    manter = [False] * len(pts)
    manter[0] = manter[-1] = True
    pilha = [(0, len(pts) - 1)]
    while pilha:
        ini, fim = pilha.pop()
        maior, idx = 0.0, -1
        for i in range(ini + 1, fim):
            d = dist2(pts[i], pts[ini], pts[fim])
            if d > maior:
                maior, idx = d, i
        if idx != -1 and maior > tol:
            manter[idx] = True
            pilha.append((ini, idx))
            pilha.append((idx, fim))
    return [p for p, k in zip(pts, manter) if k]


def area_anel(anel) -> float:
    return abs(sum(anel[i][0] * anel[i + 1][1] - anel[i + 1][0] * anel[i][1]
                   for i in range(len(anel) - 1)) / 2)


def aneis(geom):
    t = geom.get("type")
    if t == "Polygon":
        return [geom["coordinates"]]
    if t == "MultiPolygon":
        return geom["coordinates"]
    return []


def nomes_de(uf: str) -> dict[str, str]:
    caminho = COMUM / f"municipios_{uf}.geojson"
    if not caminho.exists():
        return {}
    dados = json.loads(caminho.read_text(encoding="utf-8"))
    saida = {}
    for f in dados.get("features", []):
        p = f.get("properties") or {}
        cd = str(p.get("CD_MUN") or p.get("codarea") or "")
        if cd:
            saida[cd] = str(p.get("NM_MUN") or "")
    return saida


def gerar(uf: str, tolerancia: float, area_minima: float) -> dict | None:
    origem = HD / f"municipios_{uf}.geojson"
    if not origem.exists():
        print(f"  {uf}: malha HD ausente", file=sys.stderr)
        return None

    dados = json.loads(origem.read_text(encoding="utf-8"))
    feats = dados.get("features", [])
    if not feats:
        return None

    mnx, mxx, mny, mxy = 180.0, -180.0, 90.0, -90.0
    for f in feats:
        for poly in aneis(f["geometry"]):
            for anel in poly:
                for x, y in anel:
                    mnx = min(mnx, x); mxx = max(mxx, x)
                    mny = min(mny, y); mxy = max(mxy, y)

    # Equirretangular corrigida pelo cosseno da latitude media: a mesma que o
    # resto do site usa, para o mapa nao sair esticado no sentido leste-oeste.
    k = math.cos(math.radians((mny + mxy) / 2)) or 1.0
    larg_geo = (mxx - mnx) * k
    alt_geo = (mxy - mny)
    altura = max(1, round(LARGURA * alt_geo / larg_geo))

    def proj(x, y):
        return (round((x - mnx) * k / larg_geo * LARGURA),
                round((mxy - y) / alt_geo * altura))

    nomes = nomes_de(uf)
    saida, pontos = [], 0

    for f in feats:
        props = f.get("properties") or {}
        cd = str(props.get("CD_MUN") or props.get("codarea") or "")
        if not cd:
            continue
        d = []
        for poly in aneis(f["geometry"]):
            for anel in poly:
                if len(anel) < 4 or area_anel(anel) < area_minima:
                    continue
                s = dp(anel, tolerancia)
                if len(s) < 4:
                    continue
                pontos += len(s)
                pts = [proj(x, y) for x, y in s]
                # remove ponto repetido depois do arredondamento
                limpo = [pts[0]]
                for p in pts[1:]:
                    if p != limpo[-1]:
                        limpo.append(p)
                if len(limpo) < 4:
                    continue
                d.append("M" + " ".join(f"{x} {y}" for x, y in limpo) + "Z")
        if d:
            saida.append([cd, nomes.get(cd, ""), "".join(d)])

    return {"w": LARGURA, "h": altura, "p": saida, "_pontos": pontos}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--uf", nargs="*", default=UFS, help="siglas (padrao: todas)")
    ap.add_argument("--tolerancia", type=float, default=TOLERANCIA)
    ap.add_argument("--area-minima", type=float, default=AREA_MINIMA)
    ap.add_argument("--destino", type=Path, default=DESTINO)
    args = ap.parse_args()

    args.destino.mkdir(parents=True, exist_ok=True)
    total_bytes = total_mun = 0

    for uf in [u.upper() for u in args.uf]:
        pacote = gerar(uf, args.tolerancia, args.area_minima)
        if not pacote:
            continue
        pontos = pacote.pop("_pontos")
        alvo = args.destino / f"municipios_{uf}.json"
        alvo.write_text(json.dumps(pacote, ensure_ascii=False, separators=(",", ":")),
                        encoding="utf-8")
        tam = alvo.stat().st_size
        total_bytes += tam
        total_mun += len(pacote["p"])
        origem = (HD / f"municipios_{uf}.geojson").stat().st_size
        print(f"  {uf}: {len(pacote['p']):4d} municipios, {pontos:6d} pontos, "
              f"{tam/1024:6.0f} KB  (de {origem/1024:7.0f} KB, "
              f"{100*tam/origem:4.1f}%)")

    print(f"\n{total_mun} municipios, {total_bytes/1048576:.1f} MB -> {args.destino}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
