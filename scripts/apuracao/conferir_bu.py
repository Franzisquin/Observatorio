"""Confere o leitor de boletim de urna contra o arquivo de zona do EA20.

O TSE publica os dois lados: o boletim de cada seção e o resultado consolidado da
zona. Se a soma dos boletins bate com o arquivo de zona, candidato a candidato, o
leitor está certo. Se não bate, o erro é nosso — e é melhor descobrir agora do
que na noite da eleição.

O caso padrão é a eleição suplementar de governador de Roraima (6278), que segue
no ar e é pequena: uma zona dá umas 40 seções, ~85 requisições.

    python scripts/apuracao/conferir_bu.py
    python scripts/apuracao/conferir_bu.py --eleicao 6278 --uf rr --municipio 03123 --zona 0007
"""

from __future__ import annotations

import argparse
import collections
import concurrent.futures as cf
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bu as leitor  # noqa: E402
from coleta import candidatos, resumo  # noqa: E402
from tse import Cliente, ciclo_de, e6, pleito_de  # noqa: E402


def secoes_da_zona(cli: Cliente, config: dict, eleicao: str, uf: str,
                   municipio: str, zona: str) -> list[str]:
    pleito = int(pleito_de(config, eleicao))
    diretorio = cli.diretorio(config, "cs", cd_eleicao=eleicao, uf=uf)
    ea16 = cli.json_de(f"{diretorio}/{uf}-p{pleito:06d}-cs.json")
    if not ea16:
        raise SystemExit(f"EA16 ausente para {uf} no pleito {pleito}")
    return [s["ns"] for a in ea16.get("abr", []) for mu in a.get("mu", [])
            if mu["cd"] == municipio for z in mu.get("zon", [])
            if z["cd"] == zona for s in z.get("sec", [])]


def baixar_bu(cli: Cliente, base: str, pleito: int, uf: str, municipio: str,
              zona: str, secao: str) -> bytes | None:
    """EA18 da seção, e dele o nome e o hash do arquivo de urna."""
    pasta = f"{base}/{secao}"
    aux = cli.json_de(f"{pasta}/p{pleito:06d}-{uf}-m{municipio}-z{zona}-s{secao}-aux.json")
    if not aux or not aux.get("hashes"):
        return None
    for h in aux["hashes"]:
        nomes = [a["nm"] for a in h.get("arq", []) if a.get("tp") == "bu"]
        if nomes:
            return cli.bytes_de(f"{pasta}/{h['hash']}/{nomes[0]}")
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--eleicao", default="6278")
    ap.add_argument("--cargo", default="0003")
    ap.add_argument("--uf", default="rr")
    ap.add_argument("--municipio", default="03123")
    ap.add_argument("--zona", default="0007")
    ap.add_argument("--taxa", type=float, default=60.0)
    ap.add_argument("--paralelo", type=int, default=12)
    args = ap.parse_args()

    cli = Cliente(por_segundo=args.taxa)
    config = cli.config_eleicoes()
    pleito = int(pleito_de(config, args.eleicao))
    ciclo = ciclo_de(config, args.eleicao)

    secoes = secoes_da_zona(cli, config, args.eleicao, args.uf,
                            args.municipio, args.zona)
    if not secoes:
        raise SystemExit(f"nenhuma secao em {args.uf}/{args.municipio}/{args.zona}")
    print(f"eleicao {args.eleicao} | {args.uf}/{args.municipio} zona {args.zona} | "
          f"{len(secoes)} secoes")

    base = (f"{cli.base}/{cli.ambiente}/{ciclo}/arquivo-urna/{pleito}/dados/"
            f"{args.uf}/{args.municipio}/{args.zona}")

    soma: collections.Counter = collections.Counter()
    agregado: collections.Counter = collections.Counter()
    locais: set[str] = set()
    lidos = ausentes = 0

    with cf.ThreadPoolExecutor(max_workers=args.paralelo) as pool:
        corpos = pool.map(lambda s: baixar_bu(cli, base, pleito, args.uf,
                                              args.municipio, args.zona, s), secoes)
        for corpo in corpos:
            if not corpo:
                ausentes += 1
                continue
            boletim = leitor.ler(corpo)
            lidos += 1
            locais.add(boletim["local"])
            soma.update(leitor.por_candidato(boletim, args.cargo))
            for chave, valor in leitor.agregados(boletim, args.cargo).items():
                agregado[chave] += valor

    print(f"  {lidos} boletins lidos"
          + (f", {ausentes} sem arquivo de urna" if ausentes else "")
          + f" | {len(locais)} locais de votacao distintos"
          f" | {cli.contador['get']} requisicoes")

    diretorio = cli.diretorio(config, "u", cd_eleicao=args.eleicao, uf=args.uf)
    payload = cli.json_de(f"{diretorio}/{args.uf}{args.municipio}-z{args.zona}"
                          f"-c{args.cargo}-{e6(args.eleicao)}-u.json")
    if not payload:
        raise SystemExit("arquivo de zona do EA20 nao encontrado")
    alvo = resumo(payload, args.cargo, True, completo=True)
    por_numero = {c["numero"]: c["votos"] for c in candidatos(payload).values()}

    print("\n  votacao nominal, candidato a candidato")
    ok = True
    for numero in sorted(set(soma) | set(por_numero),
                         key=lambda n: -por_numero.get(n, 0)):
        aqui, la = soma.get(numero, 0), por_numero.get(numero, 0)
        certo = aqui == la
        ok = ok and certo
        print(f"    [{'ok ' if certo else 'ERRO'}] numero {numero:<5} "
              f"boletins={aqui:>9,} zona={la:>9,}".replace(",", "."))

    print("\n  agregados")
    for rotulo, aqui, la in (("brancos", agregado["branco"], alvo["vb"]),
                             ("nulos", agregado["nulo"], alvo["vn"]),
                             ("total de votos", agregado["total"], alvo["tv"])):
        certo = aqui == la
        ok = ok and certo
        print(f"    [{'ok ' if certo else 'ERRO'}] {rotulo:<16} "
              f"boletins={aqui:>9,} zona={la:>9,}".replace(",", "."))

    print("\n" + ("  CONFERE — a leitura do boletim de urna reproduz o arquivo do TSE"
                  if ok else "  DIVERGENCIA — nao use esta leitura"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
