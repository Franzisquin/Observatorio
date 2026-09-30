"""Monta o sprite com as 27 bandeiras estaduais usado nos cartoes da central.

Produz, na raiz do site:

    bandeiras-estados.png   uma tira de 27 celulas de 56x40, em ordem alfabetica
                            de UF (ac, al, am, ... to), exibida a 28x20 CSS

Por que sprite, e nao 27 arquivos: sao 27 requisicoes a menos e um unico asset
para o cache. Por que PNG, e nao o SVG original: as bandeiras do Commons custam
1,2 MB somadas (a do Rio sozinha tem 343 KB de brasao em vetor), e nada disso
sobrevive a um chip de 28 px. Rasterizado no tamanho de uso, o conjunto inteiro
cabe em poucas dezenas de KB.

Por que nao gradiente CSS, que seria de graca: metade das bandeiras estaduais
brasileiras tem brasao ou emblema central, e listrar de memoria erraria cor e
arranjo num site que existe para ser exato. A bandeira vem da fonte.

    python scripts/gerar_bandeiras_estados.py

Precisa de curl_cffi (download) e playwright com chromium (rasterizacao). Roda
uma vez; o PNG fica versionado e o site nao depende do Commons em runtime.

FONTE. Wikimedia Commons. Bandeiras estaduais brasileiras sao simbolos oficiais
instituidos em lei, de dominio publico (Lei 9.610/98, art. 8, IV — textos de
lei e atos oficiais nao sao obra protegida).
"""

from __future__ import annotations

import sys
import urllib.parse
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SAIDA = RAIZ / "bandeiras-estados.png"

# Lado da celula no sprite. O dobro do tamanho de exibicao (28x20), para nao
# borrar em tela de densidade 2x. 56x40 = 1,40, entre os 1,429 (10:7) e 1,50
# (3:2) que as bandeiras usam: o esticamento nao e visivel neste tamanho.
CEL_W, CEL_H = 56, 40

# Nome do arquivo no Commons. O genero do artigo varia ("do Acre", "de Alagoas",
# "da Bahia"), entao nao da para montar por regra — e lista mesmo.
NOMES = {
    "ac": "Bandeira do Acre.svg",
    "al": "Bandeira de Alagoas.svg",
    "am": "Bandeira do Amazonas.svg",
    "ap": "Bandeira do Amapá.svg",
    "ba": "Bandeira da Bahia.svg",
    "ce": "Bandeira do Ceará.svg",
    "df": "Bandeira do Distrito Federal (Brasil).svg",
    "es": "Bandeira do Espírito Santo.svg",
    "go": "Flag of Goiás.svg",
    "ma": "Bandeira do Maranhão.svg",
    "mg": "Bandeira de Minas Gerais.svg",
    "ms": "Bandeira de Mato Grosso do Sul.svg",
    "mt": "Bandeira de Mato Grosso.svg",
    "pa": "Bandeira do Pará.svg",
    "pb": "Bandeira da Paraíba.svg",
    "pe": "Bandeira de Pernambuco.svg",
    "pi": "Bandeira do Piauí.svg",
    "pr": "Bandeira do Paraná.svg",
    "rj": "Bandeira do estado do Rio de Janeiro.svg",
    "rn": "Bandeira do Rio Grande do Norte.svg",
    "ro": "Bandeira de Rondônia.svg",
    "rr": "Bandeira de Roraima.svg",
    "rs": "Bandeira do Rio Grande do Sul.svg",
    "sc": "Bandeira de Santa Catarina.svg",
    "se": "Bandeira de Sergipe.svg",
    "sp": "Bandeira do estado de São Paulo.svg",
    "to": "Bandeira do Tocantins.svg",
}

UFS = sorted(NOMES)


def baixar(cache: Path) -> dict[str, bytes]:
    from curl_cffi import requests

    cache.mkdir(parents=True, exist_ok=True)
    svgs: dict[str, bytes] = {}
    for uf in UFS:
        arq = cache / f"{uf}.svg"
        if arq.exists():
            svgs[uf] = arq.read_bytes()
            continue
        url = ("https://commons.wikimedia.org/wiki/Special:FilePath/"
               + urllib.parse.quote(NOMES[uf]))
        r = requests.get(url, impersonate="chrome", timeout=60)
        if r.status_code != 200 or b"<svg" not in r.content[:4000]:
            raise RuntimeError(f"{uf}: Commons devolveu {r.status_code} para {NOMES[uf]}")
        arq.write_bytes(r.content)
        svgs[uf] = r.content
        print(f"  baixada {uf}  {len(r.content) / 1024:6.1f} KB")
    return svgs


def rasterizar(svgs: dict[str, bytes], larg: int, alt: int):
    """Desenha as 27 numa tira so e fotografa de uma vez. Um navegador de
    verdade e o unico rasterizador aqui que entende os brasoes: sao SVGs com
    gradiente, mascara e texto, que conversor simples entrega errado."""
    import base64
    import io
    from PIL import Image
    from playwright.sync_api import sync_playwright

    celulas = "".join(
        f'<img src="data:image/svg+xml;base64,{base64.b64encode(svgs[uf]).decode()}" alt="">'
        for uf in UFS
    )
    # `object-fit: fill` de proposito: preencher a celula inteira mantem a tira
    # regular, e o desvio de razao (no maximo 1,50 -> 1,40) nao aparece a 28 px.
    # `cover` cortaria a tralha do mastro, que em varias bandeiras e o que
    # identifica o estado.
    pagina = f"""<!DOCTYPE html><meta charset="utf-8"><style>
      * {{ margin: 0; padding: 0; }}
      body {{ display: flex; width: {larg * len(UFS)}px; height: {alt}px; }}
      img {{ width: {larg}px; height: {alt}px; object-fit: fill; display: block; }}
    </style><body>{celulas}</body>"""

    with sync_playwright() as p:
        nav = p.chromium.launch()
        pag = nav.new_page(viewport={"width": larg * len(UFS), "height": alt},
                           device_scale_factor=1)
        pag.set_content(pagina)
        pag.wait_for_load_state("networkidle")
        bruto = pag.screenshot(omit_background=True)
        nav.close()
    return Image.open(io.BytesIO(bruto)).convert("RGBA")


def montar(svgs: dict[str, bytes], saida: Path) -> None:
    rasterizar(svgs, CEL_W, CEL_H).save(saida, optimize=True)


def main() -> int:
    cache = RAIZ / "scratch" / "bandeiras"
    try:
        svgs = baixar(cache)
    except Exception as e:  # noqa: BLE001
        print(f"download falhou: {e}", file=sys.stderr)
        return 1
    montar(svgs, SAIDA)
    kb = SAIDA.stat().st_size / 1024
    print(f"\n{len(UFS)} bandeiras -> {SAIDA.name}  "
          f"({CEL_W * len(UFS)}x{CEL_H}, {kb:.0f} KB)")
    print("ordem:", " ".join(UFS))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
