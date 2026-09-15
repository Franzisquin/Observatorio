"""Plantao da noite de apuracao: coleta em ciclo e publica os snapshots.

Roda como um job longo, nao como cron. O `schedule` do GitHub Actions tem
granularidade minima de 5 minutos e atrasa sob carga — justamente o que nao se
pode ter numa noite de eleicao. Um unico job disparado a mao, com o loop por
dentro, da cadencia previsivel.

Duas cadencias, porque as camadas custam coisas muito diferentes:

    camada alta (BR + 27 UFs)   28 arquivos por cargo   -> a cada ~45s
    camada municipal            5.569 arquivos por cargo -> a cada ~4min

    python scripts/apuracao/plantao.py --eleicao 619 --cargos 0011 --uf mg \
        --minutos 5 --saida scratch/apuracao/plantao
    python scripts/apuracao/plantao.py --eleicao 999 --cargos 0001,0003,0005 \
        --minutos 300 --publicar --branch apuracao-data
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from coleta import (acompanhamento, camada_alta, camada_municipal,  # noqa: E402
                    cargos_da_eleicao, eleitos, escolher_ufs, escrever_indice,
                    municipios)
from tse import BASE, CARGOS, SIM_2026, Cliente, descobrir_ambiente  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent.parent


def saude(caminho: Path, estado: dict) -> None:
    """Escreve o status.json que a pagina de saude do plantao le.

    Um plantao de seis horas so e observavel se ele contar o que esta fazendo:
    qual geracao do TSE foi lida (idg), qual a hora da totalizacao no arquivo,
    quantas requisicoes sairam e quantos 404 voltaram. O teto e de 100 requisicoes
    por IP por segundo e um 404 repetido bloqueia igual a excesso — dez minutos
    fora do ar, renovados a cada nova tentativa. Sem esse arquivo, a primeira
    noticia de bloqueio seria a tela vazia.
    """
    caminho.write_text(json.dumps(estado, ensure_ascii=False, separators=(",", ":")),
                       encoding="utf-8")


def git(*args: str, cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)


def publicar(saida: Path, branch: str, primeira: bool) -> bool:
    """Empurra o estado atual da pasta para a branch de dados.

    Depois do primeiro commit, todos os seguintes sao --amend: a branch fica
    sempre com UM commit. Sem isso, uma noite de 6 horas deixaria centenas de
    commits de JSON no historico do repositorio.
    """
    git("add", "-A", cwd=saida)
    if not git("diff", "--cached", "--quiet", cwd=saida).returncode:
        return False  # nada mudou desde a ultima publicacao

    marca = time.strftime("%Y-%m-%d %H:%M:%S")
    if primeira:
        commit = git("commit", "-m", f"apuracao {marca}", cwd=saida)
    else:
        commit = git("commit", "--amend", "--no-edit", "-m", f"apuracao {marca}", cwd=saida)
    if commit.returncode:
        print(f"  ! commit falhou: {commit.stderr.strip()[:200]}", flush=True)
        return False

    envio = git("push", "--force", "origin", f"HEAD:{branch}", cwd=saida)
    if envio.returncode:
        print(f"  ! push falhou: {envio.stderr.strip()[:200]}", flush=True)
        return False
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--eleicao", required=True,
                    help="codigos separados por virgula; em 2026 a geral e duas — "
                         "a federal (presidente) e a estadual (governador, senador, "
                         "assembleias)")
    ap.add_argument("--cargos", default="0001,0003,0005,0006,0007",
                    help="codigos separados por virgula, ou apelidos: " + ", ".join(CARGOS))
    ap.add_argument("--uf", nargs="*", default=[],
                    help="UFs separadas por espaco (padrao: todas as da eleicao)")
    ap.add_argument("--ambiente", default="auto",
                    help="pasta de ambiente no CDN; 'auto' sonda os lugares conhecidos "
                         "e prefere o que estiver em fase simulada")
    ap.add_argument("--base", default=BASE,
                    help="host do CDN; o simulado de 2026 usa " + SIM_2026)
    ap.add_argument("--minutos", type=float, default=300, help="duracao do plantao")
    ap.add_argument("--intervalo-alto", type=float, default=45)
    ap.add_argument("--intervalo-mun", type=float, default=240)
    ap.add_argument("--taxa", type=float, default=60.0,
                    help="requisicoes/s; o teto do TSE e 100 por IP e a folga e de proposito")
    ap.add_argument("--paralelo", type=int, default=24,
                    help="requisicoes simultaneas; o teto real e --taxa")
    ap.add_argument("--saida", type=Path, default=RAIZ / "scratch" / "apuracao" / "plantao")
    ap.add_argument("--publicar", action="store_true", help="commita e empurra a cada volta")
    ap.add_argument("--branch", default="apuracao-data")
    args = ap.parse_args()

    cargos = [CARGOS.get(c.strip(), c.strip()) for c in args.cargos.split(",") if c.strip()]
    saida: Path = args.saida
    saida.mkdir(parents=True, exist_ok=True)

    base, ambiente, config = args.base, args.ambiente, None
    if ambiente in ("auto", "descobrir"):
        print("sondando os lugares conhecidos (1 requisicao para cada):", flush=True)
        base, ambiente, config = descobrir_ambiente(por_segundo=args.taxa)
        if not ambiente:
            print("nenhum ambiente respondeu — nao ha o que coletar.", flush=True)
            return 1

    cli = Cliente(ambiente=ambiente, por_segundo=args.taxa, base=base)
    config = config or cli.config_eleicoes()
    eleicoes = [e.strip() for e in args.eleicao.split(",") if e.strip()]
    # Cada eleicao traz os seus cargos e a sua lista de municipios; pedir o cargo
    # errado na eleicao errada e 404 em serie.
    plano: dict[str, list[str]] = {}
    mapas: dict[str, dict] = {}
    for eleicao in eleicoes:
        do_pleito = cargos_da_eleicao(config, eleicao, cargos)
        if not do_pleito:
            print(f"  ! eleicao {eleicao} nao tem nenhum dos cargos pedidos — fora do plano",
                  flush=True)
            continue
        plano[eleicao] = do_pleito
        mapas[eleicao] = municipios(cli, config, eleicao)
    if not plano:
        print("nenhuma eleicao pedida tem os cargos pedidos.", flush=True)
        return 1

    ufs = escolher_ufs(mapas[next(iter(plano))], args.uf)
    escrever_indice(saida, base, ambiente, config, plano)
    resumo_plano = " | ".join(f"{e}:{','.join(c)}" for e, c in plano.items())
    print(f"plantao: {base}/{ambiente} | fase {config.get('f')} | {resumo_plano} | "
          f"{len(ufs)} UFs | {args.minutos:.0f} min | saida {saida}", flush=True)

    fim = time.monotonic() + args.minutos * 60
    partida = time.time()
    proxima_municipal = 0.0
    primeira_publicacao = True
    volta = 0
    # Cargos cuja totalizacao final ja foi vista: o EA10 daquele cargo passa a
    # existir e vale reler a cada volta municipal. Antes disso e 404 em serie.
    finalizados: set[str] = set()
    estados: dict[str, dict] = {}

    while time.monotonic() < fim:
        inicio = time.monotonic()
        volta += 1
        for eleicao, do_pleito in plano.items():
            alvos = escolher_ufs(mapas[eleicao], args.uf)
            for cargo in do_pleito:
                estado = camada_alta(cli, config, eleicao, cargo, alvos, saida,
                                     silencioso=True)
                if estado:
                    estados[f"{eleicao}-{cargo}"] = estado
                    if estado.get("tf") == "s":
                        finalizados.add((eleicao, cargo))

        # EA14: uma requisicao por eleicao e volta, e dela sai o mapa de onde
        # ainda se esta contando — andamento por UF e municipios por estagio.
        ab = {}
        for eleicao in plano:
            ab = acompanhamento(cli, config, eleicao, saida, silencioso=True) or ab

        municipal = time.monotonic() >= proxima_municipal
        if municipal:
            for eleicao, do_pleito in plano.items():
                alvos = escolher_ufs(mapas[eleicao], args.uf)
                for cargo in do_pleito:
                    camada_municipal(cli, config, eleicao, cargo, alvos, mapas[eleicao],
                                     saida, paralelo=args.paralelo, silencioso=True)
                    # Prefeito nao tem camada alta: a totalizacao final aparece no
                    # snapshot municipal, entao ela e lida aqui.
                    if (eleicao, cargo) not in finalizados:
                        pacote = saida / f"{eleicao}-{cargo}-{alvos[0]}.json"
                        if pacote.exists():
                            try:
                                dados = json.loads(pacote.read_text(encoding="utf-8"))
                                if any(e.get("tf") == "s"
                                       for e in dados.get("abr", {}).values()):
                                    finalizados.add((eleicao, cargo))
                            except (ValueError, OSError):
                                pass
            for eleicao, cargo in sorted(finalizados):
                eleitos(cli, config, eleicao, cargo,
                        escolher_ufs(mapas[eleicao], args.uf), saida, silencioso=True)
            proxima_municipal = time.monotonic() + args.intervalo_mun

        saude(saida / "status.json", {
            "ambiente": ambiente,
            "base": base,
            "fase": config.get("f", ""),
            "eleicoes": plano,
            "volta": volta,
            "inicio": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(partida)),
            "agora": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "segundos": round(time.time() - partida),
            "intervalo_alto": args.intervalo_alto,
            "intervalo_mun": args.intervalo_mun,
            "taxa": args.taxa,
            "municipal": municipal,
            "req": dict(cli.contador),
            "taxa_medida": round(cli.contador["get"] / max(1.0, time.time() - partida), 1),
            "bloqueado_por": round(cli.bloqueio_restante()),
            "abrangencia": (ab.get("br") or {}) if ab else {},
            "estado": estados,
            "finalizados": [f"{e}-{c}" for e, c in sorted(finalizados)],
        })

        enviado = False
        if args.publicar:
            enviado = publicar(saida, args.branch, primeira_publicacao)
            primeira_publicacao = primeira_publicacao and not enviado

        gasto = time.monotonic() - inicio
        print(f"  volta {volta:>4} | {gasto:6.1f}s | municipal={'sim' if municipal else 'nao'} | "
              f"{cli.contador['get']} gets, {cli.contador['304']} 304, "
              f"{cli.contador['404']} 404, {cli.contador['bytes'] / 1e6:.0f} MB"
              f"{' | publicado' if enviado else ''}", flush=True)

        # Se uma volta demorou mais que o intervalo, segue direto: o atraso ja
        # e o sinal de que o gargalo e a rede, nao a espera.
        espera = args.intervalo_alto - (time.monotonic() - inicio)
        if espera > 0:
            time.sleep(espera)

    print(f"plantao encerrado apos {volta} voltas.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
