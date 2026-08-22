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
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from coleta import camada_alta, camada_municipal, municipios  # noqa: E402
from tse import CARGOS, Cliente  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent.parent


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
    ap.add_argument("--eleicao", required=True)
    ap.add_argument("--cargos", default="0001,0003,0005,0006,0007",
                    help="codigos separados por virgula, ou apelidos: " + ", ".join(CARGOS))
    ap.add_argument("--uf", nargs="*", default=[], help="UFs (padrao: todas as da eleicao)")
    ap.add_argument("--ambiente", default="oficial")
    ap.add_argument("--minutos", type=float, default=300, help="duracao do plantao")
    ap.add_argument("--intervalo-alto", type=float, default=45)
    ap.add_argument("--intervalo-mun", type=float, default=240)
    ap.add_argument("--taxa", type=float, default=80.0, help="requisicoes/s (limite do TSE: 100)")
    ap.add_argument("--paralelo", type=int, default=24,
                    help="requisicoes simultaneas; o teto real e --taxa")
    ap.add_argument("--saida", type=Path, default=RAIZ / "scratch" / "apuracao" / "plantao")
    ap.add_argument("--publicar", action="store_true", help="commita e empurra a cada volta")
    ap.add_argument("--branch", default="apuracao-data")
    args = ap.parse_args()

    cargos = [CARGOS.get(c.strip(), c.strip()) for c in args.cargos.split(",") if c.strip()]
    saida: Path = args.saida
    saida.mkdir(parents=True, exist_ok=True)

    cli = Cliente(ambiente=args.ambiente, por_segundo=args.taxa)
    config = cli.config_eleicoes()
    mapa = municipios(cli, config, args.eleicao)
    ufs = [u.lower() for u in args.uf] or sorted(mapa)
    print(f"plantao: eleicao {args.eleicao} | cargos {cargos} | {len(ufs)} UFs | "
          f"{args.minutos:.0f} min | saida {saida}", flush=True)

    fim = time.monotonic() + args.minutos * 60
    proxima_municipal = 0.0
    primeira_publicacao = True
    volta = 0

    while time.monotonic() < fim:
        inicio = time.monotonic()
        volta += 1
        for cargo in cargos:
            camada_alta(cli, config, args.eleicao, cargo, ufs, saida, silencioso=True)

        municipal = time.monotonic() >= proxima_municipal
        if municipal:
            for cargo in cargos:
                camada_municipal(cli, config, args.eleicao, cargo, ufs, mapa, saida,
                                 paralelo=args.paralelo, silencioso=True)
            proxima_municipal = time.monotonic() + args.intervalo_mun

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
