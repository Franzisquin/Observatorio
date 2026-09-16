"""Gera o arquivo de locais de votacao de uma UF, com secoes e coordenadas.

A divulgacao de resultados do TSE nao tem local de votacao: o EA16 vai ate a
secao e para. O vinculo secao -> local, com endereco e coordenada, vem de outro
conjunto — o eleitorado por local de votacao, do portal de dados abertos, que ja
esta no repositorio em version_15_geocode/.

Saida: um JSON por UF e ano, com um registro por local:

    resultados_geo/locais_votacao/<uf>-<ano>.json

    {"uf","ano","turno","locais":[{id,mun,nmun,n,nm,end,bairro,tipo,lat,lon,
                                   el,acess,sec:[{z,s,el}]}]}

Um arquivo por estado porque o pais inteiro nao cabe numa tela: sao 82.052
locais e 500 mil secoes. Roraima da 344 locais; Sao Paulo, 7.668.

    python scripts/gerar_locais_votacao.py --uf rr --ano 2022
    python scripts/gerar_locais_votacao.py --uf rr sp --ano 2024
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
FONTE = RAIZ / "version_15_geocode" / "geocode_br_polling_stations-0.15" / "data"
DESTINO = RAIZ / "resultados_geo" / "locais_votacao"

# O CSV do TSE vem em latin-1 e com ; como separador.
CODIFICACAO = "latin-1"


def titulo(bruto: str) -> str:
    """Caixa alta do TSE para caixa de titulo, preservando sigla e numeral.

    "ESCOLA DOM PEDRO I" -> "Escola Dom Pedro I"; "E.M.E.F. JOAO XXIII" mantem as
    siglas. Palavra sem vogal, ou numeral romano, fica como esta.
    """
    if not bruto:
        return ""
    texto = bruto.strip()
    if texto != texto.upper():
        return texto
    particulas = {"DE", "DA", "DO", "DAS", "DOS", "E", "EM", "NO", "NA"}
    romanos = {"I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
               "XI", "XII", "XIII", "XIV", "XV", "XX", "XXI", "XXIII"}
    partes = []
    for i, palavra in enumerate(texto.split()):
        limpa = "".join(c for c in palavra if c.isalpha())
        if '.' in palavra[:-1] or palavra in romanos:
            # Abreviacao pontuada (E.E., E.M.E.F., A.B.C.) e numeral romano ficam
            # como estao: capitalizar transformaria "E.E." em "E.e.".
            partes.append(palavra)
        elif i and limpa in particulas:
            partes.append(palavra.lower())
        elif not limpa or not any(v in limpa for v in "AEIOU"):
            partes.append(palavra)          # sigla: E.M.E.F., CIEP, SESI
        else:
            partes.append(palavra.capitalize())
    return " ".join(partes)


def inteiro(bruto: str) -> int:
    try:
        v = int(str(bruto).strip())
    except (TypeError, ValueError):
        return 0
    return v if v > 0 else 0


# Caixa do Brasil, com folga. O cadastro do TSE tem coordenada trocada de sinal e
# endereco geocodificado no lugar errado: um local caindo no meio do Atlantico
# estica o enquadramento do mapa e empurra o estado inteiro para um canto.
CAIXA_BR = (-74.1, -34.0, -33.7, 5.5)   # oeste, sul, leste, norte


def decimal(bruto: str) -> float | None:
    """Coordenada do TSE. Local sem geocodificacao vem como -1 ou vazio."""
    try:
        v = float(str(bruto).replace(",", ".").strip())
    except (TypeError, ValueError):
        return None
    return None if abs(v) < 0.001 else v


def dentro_do_brasil(lat: float | None, lon: float | None) -> bool:
    if lat is None or lon is None:
        return False
    oeste, sul, leste, norte = CAIXA_BR
    return sul <= lat <= norte and oeste <= lon <= leste


def gerar(uf: str, ano: int, turno: str = "1") -> dict:
    caminho = FONTE / f"eleitorado_local_votacao_{ano}.csv.gz"
    if not caminho.exists():
        raise SystemExit(f"fonte ausente: {caminho}\n  anos disponiveis: "
                         + ", ".join(sorted(p.stem.split('_')[-1].split('.')[0]
                                            for p in FONTE.glob('eleitorado_local_votacao_*.csv.gz'))))

    sigla = uf.upper()
    locais: dict[tuple[str, str], dict] = {}
    linhas = semcoord = 0

    with gzip.open(caminho, "rt", encoding=CODIFICACAO) as arquivo:
        for linha in csv.DictReader(arquivo, delimiter=";"):
            if linha["SG_UF"] != sigla or linha["NR_TURNO"] != turno:
                continue
            linhas += 1
            chave = (linha["CD_MUNICIPIO"], linha["NR_LOCAL_VOTACAO"])
            local = locais.get(chave)
            if local is None:
                lat = decimal(linha["NR_LATITUDE"])
                lon = decimal(linha["NR_LONGITUDE"])
                if not dentro_do_brasil(lat, lon):
                    lat = lon = None
                    semcoord += 1
                local = locais[chave] = {
                    "id": f"{chave[0]}-{chave[1]}",
                    "mun": chave[0],
                    "nmun": titulo(linha["NM_MUNICIPIO"]),
                    "n": chave[1],
                    "nm": titulo(linha["NM_LOCAL_VOTACAO"]),
                    "end": titulo(linha["DS_ENDERECO"]),
                    "bairro": titulo(linha["NM_BAIRRO"]),
                    "tipo": linha["DS_TIPO_LOCAL"].strip(),
                    "lat": lat, "lon": lon,
                    "el": 0,
                    # Acessibilidade e do TSE, por secao; o local conta quantas
                    # das suas secoes sao acessiveis.
                    "acess": 0,
                    "sec": [],
                }
            eleitores = inteiro(linha["QT_ELEITOR_SECAO"])
            local["el"] += eleitores
            if inteiro(linha.get("CD_SITU_SECAO_ACESSIBILIDADE")):
                local["acess"] += 1
            local["sec"].append({
                "z": linha["NR_ZONA"].zfill(4),
                "s": linha["NR_SECAO"].zfill(4),
                "el": eleitores,
                # Secao agregada vota junto com a principal; sem isso a contagem
                # por local fica com buracos inexplicados.
                **({"p": linha["NR_SECAO_PRINCIPAL"].zfill(4)}
                   if inteiro(linha.get("NR_SECAO_PRINCIPAL")) else {}),
            })

    if not locais:
        raise SystemExit(f"nenhum local para {sigla} em {ano} (turno {turno})")

    for local in locais.values():
        local["sec"].sort(key=lambda s: (s["z"], s["s"]))

    ordenados = sorted(locais.values(), key=lambda x: (x["nmun"], x["nm"]))
    return {
        "uf": sigla, "ano": ano, "turno": turno,
        "locais": ordenados,
        "secoes": linhas,
        "sem_coordenada": semcoord,
        "gerado": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def escrever_indice(destino: Path) -> Path:
    """Varre a pasta e lista o que existe, para a pagina nao ter que adivinhar.

    Sem isto, abrir a tela sem `?eleicao=` na URL carregava o arquivo so de
    eleitorado e a votacao nao aparecia — sem nada dizendo que ela existia ao
    lado. O indice deixa a pagina escolher sozinha o conjunto com votacao.
    """
    conjuntos = []
    for caminho in sorted(destino.glob("*.json")):
        if caminho.name == "index.json":
            continue
        try:
            dados = json.loads(caminho.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            continue
        locais = dados.get("locais") or []
        conjuntos.append({
            "arquivo": caminho.stem,
            "uf": (dados.get("uf") or "").lower(),
            "rotulo": dados.get("nm") or f"Eleitorado de {dados.get('ano', '')}",
            "votacao": any(l.get("v") for l in locais),
            "cargo": dados.get("cargo", ""),
            "eleicao": dados.get("eleicao", ""),
            "ano": dados.get("ano", ""),
            "locais": len(locais),
        })
    caminho = destino / "index.json"
    caminho.write_text(json.dumps({"conjuntos": conjuntos}, ensure_ascii=False,
                                  separators=(",", ":")), encoding="utf-8")
    return caminho


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--uf", nargs="+", required=True, help="siglas, separadas por espaco")
    ap.add_argument("--ano", type=int, default=2022)
    ap.add_argument("--turno", default="1")
    ap.add_argument("--destino", type=Path, default=DESTINO)
    args = ap.parse_args()

    args.destino.mkdir(parents=True, exist_ok=True)
    for uf in args.uf:
        pacote = gerar(uf, args.ano, args.turno)
        caminho = args.destino / f"{uf.lower()}-{args.ano}.json"
        caminho.write_text(json.dumps(pacote, ensure_ascii=False, separators=(",", ":")),
                           encoding="utf-8")
        print(f"  {uf.upper()} {args.ano}: {len(pacote['locais'])} locais, "
              f"{pacote['secoes']} secoes, "
              f"{sum(l['el'] for l in pacote['locais']):,} eleitores"
              .replace(",", ".")
              + (f", {pacote['sem_coordenada']} sem coordenada"
                 if pacote["sem_coordenada"] else "")
              + f" -> {caminho.name} ({caminho.stat().st_size / 1024:.0f} KB)")
    print(f"  indice: {escrever_indice(args.destino).name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
