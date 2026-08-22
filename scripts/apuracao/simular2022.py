"""Ensaio da noite de apuracao com os resultados reais de 2022.

Os arquivos de 2022 ainda estao no CDN do TSE, mas no layout antigo: os
contadores vem achatados dentro de `abr` e os nomes dos candidatos so existem
no arquivo simplificado de UF. Este script le esse formato, converte para o
formato de snapshot de 2026 e depois *toca* a noite.

Por que serve: 2024 nao teve eleicao presidencial e o simulado do TSE ainda nao
tem data. Este e o unico jeito, hoje, de ver a pagina se comportando ao vivo —
mapa recolorindo, ranking virando, barra andando — com magnitude real.

    python scripts/apuracao/simular2022.py --baixar
    python scripts/apuracao/simular2022.py --baixar --uf mg sp rj --turno 1 2
    python scripts/apuracao/simular2022.py --tocar --duracao 8 --passo 5

Depois abra:
    apuracao.html?dados=scratch/apuracao/2022/&eleicao=544&cargo=0001

O snapshot sai marcado com fase "s" (simulado). A pagina mostra o selo SIMULADO
em amarelo — 2022 nao pode ser confundido com apuracao em curso.

O que o ensaio NAO reproduz: a apuracao dentro de um municipio. Cada municipio
entra inteiro, na hora que lhe cabe. Fracionar os votos de dentro seria inventar
numero que o TSE nao publicou.
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import random
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from coleta import escrever  # noqa: E402
from tse import Cliente, e6, inteiro, num, texto  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent.parent
DESTINO = RAIZ / "scratch" / "apuracao" / "2022"
CICLO = "ele2022"
CARGO = "0001"  # Presidente: o unico cargo que interessa para o ensaio nacional
TURNOS = {"1": "544", "2": "545"}


def url(ciclo: str, eleicao: str, pasta: str, arquivo: str) -> str:
    return f"https://resultados.tse.jus.br/oficial/{ciclo}/{eleicao}/{pasta}/{arquivo}"


def converter(bloco: dict, votos_por_num: dict[str, int]) -> dict:
    """Layout 2022 -> resumo de 2026.

    Em 2022 os contadores estao no mesmo nivel do bloco de abrangencia: `s` e o
    total de secoes (o `ts` de hoje), `e` o eleitorado, `c` o comparecimento.
    """
    totalizadas, totais = inteiro(bloco.get("st")), inteiro(bloco.get("s"))
    return {
        # O simplificado de 2022 nao traz `and`; deriva-se das secoes, que e a
        # mesma definicao do campo em 2026.
        "and": (bloco.get("and") or ("f" if totalizadas >= totais > 0
                                     else "p" if totalizadas else "n")).lower(),
        "tf": (bloco.get("tf") or "n").lower(),
        "dv": (bloco.get("dv") or "s").lower(),
        "md": (bloco.get("md") or "").lower(),
        "dt": bloco.get("dt", ""),
        "ht": bloco.get("ht", ""),
        "st": inteiro(bloco.get("st")),
        "ts": inteiro(bloco.get("s")),
        "pst": num(bloco.get("pst")),
        "te": inteiro(bloco.get("e")),
        "comp": inteiro(bloco.get("c")),
        "abst": inteiro(bloco.get("a")),
        "tv": inteiro(bloco.get("tv")),
        "vv": inteiro(bloco.get("vv")),
        "vb": inteiro(bloco.get("vb")),
        "vn": inteiro(bloco.get("vn")),
        "cand": votos_por_num,
    }


def nomes_do_r(bloco: dict) -> dict[str, dict]:
    """Dicionario de candidatos a partir do arquivo simplificado da UF.

    A sigla do partido e o primeiro pedaco de `cc` ("PT - Federacao Brasil da
    Esperanca..." -> PT), que e como 2022 guardava a composicao.
    """
    saida = {}
    for cand in bloco.get("cand", []):
        numero = str(cand.get("n"))
        composicao = texto(cand.get("cc"))
        saida[numero] = {
            "nome": texto(cand.get("nm")),
            "urna": texto(cand.get("nm")),
            "numero": numero,
            "partido": composicao.split(" - ")[0].strip() if composicao else "",
        }
    return saida


def baixar(cli: Cliente, eleicao: str, ufs: list[str], destino: Path, paralelo: int) -> None:
    config_mun = cli.json_de(url(CICLO, eleicao, "config", f"mun-{e6(eleicao)}-cm.json"))
    if config_mun is None:
        raise RuntimeError(f"config de municipios de {eleicao} nao esta mais no CDN")

    mapa: dict[str, list[dict]] = {}
    for abrangencia in config_mun.get("abr", []):
        sigla = str(abrangencia.get("cd", "")).lower()
        mapa[sigla] = [{"cd": m.get("cd"), "ibge": m.get("cdi"), "nm": m.get("nm")}
                       for m in abrangencia.get("mu", [])]

    alvo = [u for u in (ufs or sorted(mapa)) if u in mapa]
    dicionario: dict[str, dict] = {}
    por_uf: dict[str, dict] = {}

    # 1) camada de UF: e de onde vem o nome de cada candidato.
    for uf in alvo:
        bloco = cli.json_de(url(CICLO, eleicao, f"dados-simplificados/{uf}",
                                f"{uf}-c{CARGO}-{e6(eleicao)}-r.json"))
        if not bloco:
            continue
        dicionario.update(nomes_do_r(bloco))
        votos = {str(c.get("n")): inteiro(c.get("vap")) for c in bloco.get("cand", [])}
        por_uf[uf] = converter(bloco, votos)
        print(f"  {uf}: {por_uf[uf]['ts']:>7} secoes, {len(votos)} candidatos", flush=True)

    cabecalho = {"ele": eleicao, "t": "1" if eleicao == TURNOS["1"] else "2",
                 "f": "s", "cargo": CARGO, "fonte": "TSE 2022 (ensaio)"}
    escrever(destino / "final", f"{eleicao}-{CARGO}-uf.json",
             {"meta": cabecalho, "abr": por_uf, "cand": dicionario})

    # O pais: em 2022 havia arquivo BR proprio, mas gerar aqui a partir das UFs
    # deixa o ensaio coerente com o que a pagina fara em 2026 e, principalmente,
    # impede que um br.json de uma rodada anterior (de uma UF so) sobreviva e
    # passe a mandar na tela.
    if por_uf:
        escrever(destino / "final", f"{eleicao}-{CARGO}-br.json",
                 {"meta": cabecalho, "cand": dicionario,
                  "abr": {"br": somar(list(por_uf.values()), next(iter(por_uf.values())))}})

    # 2) camada municipal: o simplificado nao existe por municipio, entao vem do
    #    arquivo completo, de onde se usa so o bloco tpabr=MU (o resto sao zonas).
    for uf in alvo:
        lista = mapa[uf]

        def um(muni: dict):
            return muni, cli.json_de(url(CICLO, eleicao, f"dados/{uf}",
                                         f"{uf}{muni['cd']}-c{CARGO}-{e6(eleicao)}-v.json"))

        entradas, nomes = {}, {}
        with cf.ThreadPoolExecutor(max_workers=paralelo) as pool:
            for muni, payload in pool.map(um, lista):
                if not payload:
                    continue
                bloco = next((a for a in payload.get("abr", [])
                              if str(a.get("tpabr", "")).upper() == "MU"), None)
                if not bloco:
                    continue
                votos = {str(c.get("n")): inteiro(c.get("vap")) for c in bloco.get("cand", [])}
                entradas[muni["cd"]] = converter(bloco, votos)
                nomes[muni["cd"]] = {"nm": muni["nm"], "ibge": muni["ibge"]}

        escrever(destino / "final", f"{eleicao}-{CARGO}-{uf}.json",
                 {"meta": {"ele": eleicao, "f": "s", "cargo": CARGO},
                  "abr": entradas, "mun": nomes, "cand": dicionario})
        print(f"  {uf}: {len(entradas)}/{len(lista)} municipios convertidos", flush=True)

    # `final/` e a copia mestra; a pasta de cima e o que a pagina le. Copiando
    # agora, abrir apuracao.html sem ter rodado --tocar ja mostra 2022 fechado,
    # em vez de uma tela vazia.
    for caminho in (destino / "final").glob(f"{eleicao}-{CARGO}-*.json"):
        shutil.copy(caminho, destino / caminho.name)


# ---------------------------------------------------------------- ensaio

def zerar(entrada: dict) -> dict:
    """Mesma abrangencia, ainda sem nenhuma secao totalizada."""
    vazio = dict(entrada)
    vazio.update({"and": "n", "tf": "n", "st": 0, "pst": 0.0, "comp": 0, "abst": 0,
                  "tv": 0, "vv": 0, "vb": 0, "vn": 0,
                  "cand": {k: 0 for k in entrada["cand"]}})
    return vazio


def somar(entradas: list[dict], modelo: dict) -> dict:
    total = dict(modelo)
    campos = ("st", "ts", "te", "comp", "abst", "tv", "vv", "vb", "vn")
    for campo in campos:
        total[campo] = sum(e.get(campo, 0) for e in entradas)
    total["pst"] = 100 * total["st"] / total["ts"] if total["ts"] else 0.0
    votos: dict[str, int] = {}
    for e in entradas:
        for chave, valor in e["cand"].items():
            votos[chave] = votos.get(chave, 0) + valor
    total["cand"] = votos
    total["and"] = "f" if total["st"] >= total["ts"] > 0 else "p" if total["st"] else "n"
    return total


def tocar(destino: Path, eleicao: str, duracao: float, passo: float, semente: int) -> None:
    origem = destino / "final"
    arquivos = sorted(origem.glob(f"{eleicao}-{CARGO}-*.json"))
    if not arquivos:
        raise RuntimeError(f"nada em {origem}: rode --baixar antes")

    pacotes = {}
    for caminho in arquivos:
        sufixo = caminho.stem.split("-")[-1]
        # `uf` e `br` sao camadas agregadas, remontadas a cada volta a partir dos
        # municipios. Tratar br como se fosse mais uma UF somaria o pais duas
        # vezes — era o que fazia o total de secoes dobrar.
        if sufixo in ("uf", "br"):
            continue
        pacotes[sufixo] = json.loads(caminho.read_text(encoding="utf-8"))

    modelo_uf = json.loads((origem / f"{eleicao}-{CARGO}-uf.json").read_text(encoding="utf-8"))

    # Hora de fechamento de cada municipio: cidade grande demora mais, como na
    # noite de verdade. O expoente achata a curva para que a maioria feche cedo
    # e as capitais arrastem a cauda.
    sorteio = random.Random(semente)
    fechamento: dict[tuple[str, str], float] = {}
    for uf, pacote in pacotes.items():
        ordenados = sorted(pacote["abr"].items(), key=lambda kv: kv[1]["te"])
        n = max(len(ordenados), 1)
        for posicao, (codigo, _) in enumerate(ordenados):
            base = (posicao / n) ** 0.7
            fechamento[(uf, codigo)] = min(1.0, base * 0.9 + sorteio.random() * 0.18)

    inicio = time.monotonic()
    fim = inicio + duracao * 60
    while True:
        agora = time.monotonic()
        t = min(1.0, (agora - inicio) / max(fim - inicio, 1e-6))

        resumo_ufs = {}
        for uf, pacote in pacotes.items():
            entradas = {}
            for codigo, entrada in pacote["abr"].items():
                entradas[codigo] = entrada if fechamento[(uf, codigo)] <= t else zerar(entrada)
            escrever(destino, f"{eleicao}-{CARGO}-{uf}.json",
                     {**pacote, "abr": entradas})
            resumo_ufs[uf] = somar(list(entradas.values()), modelo_uf["abr"].get(uf, {}))

        escrever(destino, f"{eleicao}-{CARGO}-uf.json", {**modelo_uf, "abr": resumo_ufs})
        escrever(destino, f"{eleicao}-{CARGO}-br.json",
                 {"meta": modelo_uf["meta"], "cand": modelo_uf["cand"],
                  "abr": {"br": somar(list(resumo_ufs.values()),
                                      next(iter(modelo_uf["abr"].values())))}})

        pais = somar(list(resumo_ufs.values()), next(iter(modelo_uf["abr"].values())))
        lider = max(pais["cand"].items(), key=lambda kv: kv[1], default=("-", 0))
        if pais["vv"]:
            nome = modelo_uf["cand"].get(lider[0], {}).get("nome", lider[0])
            frente = f"lider {nome} {100 * lider[1] / pais['vv']:.2f}%"
        else:
            frente = "nenhuma secao totalizada"
        print(f"  {t * 100:5.1f}% do ensaio | {pais['pst']:6.2f}% das secoes | {frente}",
              flush=True)

        if t >= 1.0:
            break
        time.sleep(passo)
    print("ensaio concluido.", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--baixar", action="store_true", help="converte 2022 para o formato de 2026")
    ap.add_argument("--tocar", action="store_true", help="reproduz a noite a partir do convertido")
    ap.add_argument("--turno", nargs="*", default=["1"], choices=["1", "2"])
    ap.add_argument("--uf", nargs="*", default=[], help="UFs (padrao: todas)")
    ap.add_argument("--duracao", type=float, default=8, help="minutos de ensaio")
    ap.add_argument("--passo", type=float, default=5, help="segundos entre atualizacoes")
    ap.add_argument("--semente", type=int, default=2022)
    ap.add_argument("--destino", type=Path, default=DESTINO)
    ap.add_argument("--taxa", type=float, default=80.0)
    ap.add_argument("--paralelo", type=int, default=24)
    args = ap.parse_args()

    if not (args.baixar or args.tocar):
        ap.error("escolha --baixar e/ou --tocar")

    ufs = [u.lower() for u in args.uf]
    if args.baixar:
        cli = Cliente(por_segundo=args.taxa)
        for turno in args.turno:
            eleicao = TURNOS[turno]
            print(f"2022, {turno}o turno (eleicao {eleicao}):", flush=True)
            baixar(cli, eleicao, ufs, args.destino, args.paralelo)
        print(f"\n{cli.contador['get']} requisicoes, {cli.contador['404']} ausentes, "
              f"{cli.contador['bytes'] / 1e6:.0f} MB", flush=True)

    if args.tocar:
        for turno in args.turno:
            eleicao = TURNOS[turno]
            print(f"\nensaio do {turno}o turno ({args.duracao:.0f} min):", flush=True)
            tocar(args.destino, eleicao, args.duracao, args.passo, args.semente)
    return 0


if __name__ == "__main__":
    sys.exit(main())
