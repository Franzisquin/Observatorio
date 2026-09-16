"""Coleta o resultado por seção de uma UF e agrega por local de votação.

A divulgação (EA20) desce até a zona eleitoral e para. Resultado por seção só
existe no boletim de urna, e é de lá que sai também o número do local de votação
— `identificacaoSecao` traz {município, zona, local, seção}. O cadastro de
eleitorado entra só para dar nome, endereço e coordenada ao local, que o boletim
não tem.

Cada boletim se baixa UMA vez: urna transmitida não muda. Não é varredura
repetida, é fila — o EA16 diz quais seções já têm arquivo, e o resto se ignora.

Custo: 2 requisições por seção (o auxiliar e o boletim). Roraima são 1.615
seções, ~3.200 requisições, menos de um minuto a 60/s. São Paulo seriam 206 mil,
diluídas nas horas em que as urnas chegam.

    python scripts/apuracao/coletar_locais.py --eleicao 6278 --uf rr --cargo 0003
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import csv
import gzip
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import bu as leitor  # noqa: E402
from gerar_locais_votacao import escrever_indice  # noqa: E402
from coleta import candidatos  # noqa: E402
from tse import Cliente, ciclo_de, e6, eleicao_de, pleito_de, texto  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent.parent
CADASTRO = (RAIZ / "version_15_geocode" / "geocode_br_polling_stations-0.15" / "data")
DESTINO = RAIZ / "resultados_geo" / "locais_votacao"

# Caixa do Brasil, com folga. O cadastro do TSE tem coordenada trocada de sinal e
# endereco geocodificado no lugar errado; um local no meio do Atlantico estica o
# enquadramento do mapa e empurra o estado inteiro para um canto da tela.
CAIXA_BR = (-74.1, -34.0, -33.7, 5.5)   # oeste, sul, leste, norte


def dentro_do_brasil(lat: float | None, lon: float | None) -> bool:
    if lat is None or lon is None:
        return False
    o, s, l, n = CAIXA_BR
    return s <= lat <= n and o <= lon <= l


def cadastro_de_locais(uf: str, ano: int) -> dict[tuple[str, str], dict]:
    """{(municipio, local): nome, endereco, coordenada} do cadastro do TSE."""
    caminho = CADASTRO / f"eleitorado_local_votacao_{ano}.csv.gz"
    if not caminho.exists():
        return {}
    sigla = uf.upper()
    saida: dict[tuple[str, str], dict] = {}
    with gzip.open(caminho, "rt", encoding="latin-1") as arquivo:
        for linha in csv.DictReader(arquivo, delimiter=";"):
            if linha["SG_UF"] != sigla:
                continue
            chave = (linha["CD_MUNICIPIO"], str(int(linha["NR_LOCAL_VOTACAO"])))
            if chave in saida:
                continue
            try:
                lat = float(linha["NR_LATITUDE"])
                lon = float(linha["NR_LONGITUDE"])
            except (TypeError, ValueError):
                lat = lon = None
            if not dentro_do_brasil(lat, lon):
                lat = lon = None
            saida[chave] = {
                "nm": linha["NM_LOCAL_VOTACAO"].strip(),
                "end": linha["DS_ENDERECO"].strip(),
                "bairro": linha["NM_BAIRRO"].strip(),
                "nmun": linha["NM_MUNICIPIO"].strip(),
                "lat": lat, "lon": lon,
            }
    return saida


def secoes_da_uf(cli: Cliente, config: dict, eleicao: str, uf: str) -> list[tuple[str, str, str]]:
    pleito = int(pleito_de(config, eleicao))
    diretorio = cli.diretorio(config, "cs", cd_eleicao=eleicao, uf=uf)
    ea16 = cli.json_de(f"{diretorio}/{uf}-p{pleito:06d}-cs.json")
    if not ea16:
        raise SystemExit(f"EA16 ausente para {uf} no pleito {pleito}")
    return [(mu["cd"], z["cd"], s["ns"])
            for a in ea16.get("abr", []) for mu in a.get("mu", [])
            for z in mu.get("zon", []) for s in z.get("sec", [])]


def baixar(cli: Cliente, base: str, pleito: int, uf: str,
           alvo: tuple[str, str, str]) -> tuple[tuple[str, str, str], bytes | None]:
    municipio, zona, secao = alvo
    pasta = f"{base}/{municipio}/{zona}/{secao}"
    aux = cli.json_de(f"{pasta}/p{pleito:06d}-{uf}-m{municipio}-z{zona}-s{secao}-aux.json")
    if not aux or not aux.get("hashes"):
        return alvo, None
    for h in aux["hashes"]:
        nomes = [a["nm"] for a in h.get("arq", []) if a.get("tp") == "bu"]
        if nomes:
            return alvo, cli.bytes_de(f"{pasta}/{h['hash']}/{nomes[0]}")
    return alvo, None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--eleicao", required=True)
    ap.add_argument("--uf", required=True)
    ap.add_argument("--cargo", default="0003")
    ap.add_argument("--ano-cadastro", type=int, default=2024,
                    help="ano do cadastro de locais usado para nome e coordenada")
    ap.add_argument("--taxa", type=float, default=60.0)
    ap.add_argument("--paralelo", type=int, default=24)
    ap.add_argument("--destino", type=Path, default=DESTINO)
    args = ap.parse_args()

    uf = args.uf.lower()
    cli = Cliente(por_segundo=args.taxa)
    config = cli.config_eleicoes()
    registro = eleicao_de(config, args.eleicao)
    pleito = int(pleito_de(config, args.eleicao))
    ciclo = ciclo_de(config, args.eleicao)

    alvos = secoes_da_uf(cli, config, args.eleicao, uf)
    print(f"eleicao {args.eleicao} | {uf.upper()} | {len(alvos)} secoes | "
          f"cargo {args.cargo}", flush=True)

    base = f"{cli.base}/{cli.ambiente}/{ciclo}/arquivo-urna/{pleito}/dados/{uf}"
    locais: dict[str, dict] = {}
    lidos = ausentes = 0
    inicio = time.time()

    with cf.ThreadPoolExecutor(max_workers=args.paralelo) as pool:
        for alvo, corpo in pool.map(lambda a: baixar(cli, base, pleito, uf, a), alvos):
            if not corpo:
                ausentes += 1
                continue
            try:
                boletim = leitor.ler(corpo)
            except (ValueError, IndexError) as err:
                print(f"  ! boletim ilegivel em {alvo}: {err}", flush=True)
                ausentes += 1
                continue
            lidos += 1

            municipio, zona, secao = alvo
            chave = f"{municipio}-{boletim['local']}"
            local = locais.setdefault(chave, {
                "mun": municipio, "n": boletim["local"],
                "v": {}, "br": 0, "nu": 0, "comp": 0, "sec": {},
            })
            votos = leitor.por_candidato(boletim, args.cargo)
            agregado = leitor.agregados(boletim, args.cargo)
            for numero, quantidade in votos.items():
                local["v"][numero] = local["v"].get(numero, 0) + quantidade
            local["br"] += agregado.get("branco", 0)
            local["nu"] += agregado.get("nulo", 0)
            local["comp"] += agregado.get("total", 0)
            local["sec"][f"{zona}-{secao}"] = {
                "z": zona, "s": secao, "v": votos,
                "br": agregado.get("branco", 0), "nu": agregado.get("nulo", 0),
                "comp": agregado.get("total", 0),
            }

    # nomes dos candidatos, do arquivo de UF da divulgacao
    diretorio = cli.diretorio(config, "u", cd_eleicao=args.eleicao, uf=uf)
    payload = cli.json_de(f"{diretorio}/{uf}-c{args.cargo}-{e6(args.eleicao)}-u.json")
    nomes = {}
    if payload:
        for dados in candidatos(payload).values():
            nomes[str(dados["numero"])] = {
                "nome": dados["nome"], "urna": dados["urna"],
                "partido": dados["partido"], "situacao": dados["situacao"],
            }

    cadastro = cadastro_de_locais(uf, args.ano_cadastro)
    semcoord = semnome = 0
    for chave, local in locais.items():
        ficha = cadastro.get((local["mun"], local["n"]))
        if ficha:
            local.update({k: ficha[k] for k in ("nm", "end", "bairro", "nmun", "lat", "lon")})
            if ficha["lat"] is None:
                semcoord += 1
        else:
            semnome += 1
            local.update({"nm": f"Local {local['n']}", "end": "", "bairro": "",
                          "nmun": "", "lat": None, "lon": None})
        local["sec"] = [local["sec"][k] for k in sorted(local["sec"])]

    pacote = {
        "eleicao": args.eleicao, "uf": uf.upper(), "cargo": args.cargo,
        "nm": texto(registro.get("nm")), "turno": registro.get("t", ""),
        "cand": nomes,
        "locais": sorted(locais.values(), key=lambda x: (x["nmun"], x["nm"])),
        "secoes_lidas": lidos, "secoes_sem_urna": ausentes,
        "gerado": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    args.destino.mkdir(parents=True, exist_ok=True)
    caminho = args.destino / f"{uf}-{args.eleicao}.json"
    caminho.write_text(json.dumps(pacote, ensure_ascii=False, separators=(",", ":")),
                       encoding="utf-8")

    total = sum(sum(l["v"].values()) for l in locais.values())
    print(f"  {lidos} boletins lidos"
          + (f", {ausentes} secoes sem arquivo de urna" if ausentes else "")
          + f" | {len(locais)} locais"
          + (f", {semcoord} sem coordenada" if semcoord else "")
          + (f", {semnome} fora do cadastro" if semnome else ""))
    print(f"  {total:,} votos nominais | {cli.contador['get']} requisicoes, "
          f"{cli.contador['404']} ausentes | {time.time() - inicio:.0f}s"
          .replace(",", "."))
    print(f"  -> {caminho.name} ({caminho.stat().st_size / 1024:.0f} KB)")
    print(f"  indice: {escrever_indice(args.destino).name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
