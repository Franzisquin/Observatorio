"""Baixa o perfil do eleitorado de 2026 do CDN do TSE.

Dois conjuntos:

  perfil_eleitor_secao_2026_<UF>.zip   perfil demografico por secao (27 arquivos, ~2,5 GB)
  eleitorado_local_votacao_2026.zip    registro dos locais: secao -> local, lat/lon, endereco

Os brutos ficam em scratch/eleitorado/2026/ (fora do git, ver .gitignore) porque sao
grandes e regeneraveis. O download e resumivel: rodar de novo continua de onde parou.

    python scripts/baixar_perfil_eleitorado_2026.py --probe          # so inspeciona o schema de AC
    python scripts/baixar_perfil_eleitorado_2026.py --uf AC SC RJ
    python scripts/baixar_perfil_eleitorado_2026.py                  # tudo
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import csv
import io
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

BASE = "https://cdn.tse.jus.br/estatistica/sead/odsele"
URL_PERFIL = BASE + "/perfil_eleitor_secao/perfil_eleitor_secao_2026_{uf}.zip"
URL_LOCAIS = BASE + "/eleitorado_locais_votacao/eleitorado_local_votacao_2026.zip"

RAIZ = Path(__file__).resolve().parent.parent
DESTINO = RAIZ / "scratch" / "eleitorado" / "2026"

UFS = [
    "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT",
    "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
]

# Tamanho relativo do eleitorado, so para ordenar o pool de download (maiores primeiro).
PESO = {
    "SP": 34, "MG": 16, "RJ": 12, "BA": 11, "RS": 8, "PR": 8, "PE": 7, "CE": 7,
    "PA": 6, "SC": 5, "GO": 5, "MA": 5, "PB": 3, "ES": 3, "AM": 3, "RN": 3,
    "PI": 3, "AL": 2, "MT": 2, "DF": 2, "MS": 2, "SE": 2, "RO": 1, "TO": 1,
    "AC": 1, "AP": 1, "RR": 1,
}

# O CDN do TSE rejeita o user-agent padrao do urllib em alguns pontos de presenca.
CABECALHOS = {"User-Agent": "Mozilla/5.0 (compativel; observatorio-eleitoral/1.0)"}
BLOCO = 1 << 20  # 1 MiB


def _humano(n: float) -> str:
    for unidade in ("B", "KB", "MB", "GB"):
        if abs(n) < 1024 or unidade == "GB":
            return f"{n:,.1f} {unidade}".replace(",", ".")
        n /= 1024
    return f"{n:.1f} GB"


def tamanho_remoto(url: str) -> int | None:
    req = urllib.request.Request(url, method="HEAD", headers=CABECALHOS)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            bruto = resp.headers.get("Content-Length")
            return int(bruto) if bruto else None
    except urllib.error.HTTPError as err:
        if err.code == 404:
            return None
        raise


def baixar(url: str, alvo: Path, tentativas: int = 5, silencioso: bool = False) -> bool:
    """Baixa `url` para `alvo`, retomando de onde parou. True se o arquivo esta completo."""
    esperado = tamanho_remoto(url)
    if esperado is None:
        print(f"  ! nao existe no CDN: {url}")
        return False

    alvo.parent.mkdir(parents=True, exist_ok=True)
    ja = alvo.stat().st_size if alvo.exists() else 0
    if ja == esperado:
        print(f"  = {alvo.name} ja completo ({_humano(esperado)})")
        return True
    if ja > esperado:  # download anterior corrompido ou arquivo trocado no CDN
        print(f"  ! {alvo.name} maior que o remoto, recomecando")
        alvo.unlink()
        ja = 0

    for tentativa in range(1, tentativas + 1):
        req = urllib.request.Request(url, headers=dict(CABECALHOS))
        if ja:
            req.add_header("Range", f"bytes={ja}-")
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                # Se o servidor ignorar o Range e mandar 200, comecamos do zero.
                modo = "ab" if (ja and resp.status == 206) else "wb"
                if modo == "wb":
                    ja = 0
                inicio, ultimo_log = time.time(), 0.0
                with open(alvo, modo) as saida:
                    while pedaco := resp.read(BLOCO):
                        saida.write(pedaco)
                        ja += len(pedaco)
                        agora = time.time()
                        if not silencioso and agora - ultimo_log > 5:
                            pct = 100 * ja / esperado
                            taxa = ja / max(agora - inicio, 1e-6)
                            print(f"  {alvo.name}: {pct:5.1f}%  {_humano(ja)}/{_humano(esperado)}"
                                  f"  {_humano(taxa)}/s", flush=True)
                            ultimo_log = agora
            if ja == esperado:
                print(f"  + {alvo.name}: {_humano(ja)} completo", flush=True)
                return True
            print(f"  ! {alvo.name}: tamanho final {ja} != esperado {esperado}", flush=True)
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as err:
            ja = alvo.stat().st_size if alvo.exists() else 0
            espera = min(60, 2**tentativa)
            print(f"  ! {alvo.name}: {type(err).__name__}: {err} — tentativa {tentativa}/{tentativas}, "
                  f"aguardando {espera}s (retomando em {_humano(ja)})", flush=True)
            time.sleep(espera)

    return False


def sondar(caminho: Path, linhas: int = 3) -> None:
    """Imprime o schema real do CSV dentro do zip — passo 0 antes de escrever o parser."""
    print(f"\n=== SCHEMA: {caminho.name} ===")
    with zipfile.ZipFile(caminho) as zf:
        for info in zf.infolist():
            print(f"  entrada: {info.filename}  ({_humano(info.file_size)} descomprimido)")
        nome = next(n for n in zf.namelist() if n.lower().endswith(".csv"))
        with zf.open(nome) as bruto:
            texto = io.TextIOWrapper(bruto, encoding="latin-1", newline="")
            leitor = csv.reader(texto, delimiter=";")
            cabecalho = next(leitor)
            print(f"\n  {len(cabecalho)} colunas em {nome}:")
            for i, col in enumerate(cabecalho):
                print(f"    [{i:2d}] {col}")
            print("\n  primeiras linhas:")
            for _, linha in zip(range(linhas), leitor):
                print("    " + " | ".join(f"{c}={v}" for c, v in zip(cabecalho, linha)))

    # O parser depende destas colunas; avisar cedo se o TSE mudou o layout.
    # Em 2026 a coluna de contagem chama QT_ELEITORES (nas series antigas era
    # QT_ELEITORES_PERFIL) e o ano vem em AA_ELEICAO (antes ANO_ELEICAO).
    obrigatorias = {"SG_UF", "CD_MUNICIPIO", "NR_ZONA", "NR_LOCAL_VOTACAO", "QT_ELEITORES"}
    presentes = {c.strip('"').upper() for c in cabecalho}
    faltando = obrigatorias - presentes
    if faltando:
        print(f"\n  !! COLUNAS OBRIGATORIAS AUSENTES: {sorted(faltando)}")
    if "NR_LOCAL_VOTACAO" not in presentes:
        print("\n  !! NR_LOCAL_VOTACAO ausente — a agregacao secao->local vai precisar do "
              "registro eleitorado_local_votacao_2026 como ponte.")
    else:
        print("\n  ok: NR_LOCAL_VOTACAO presente, agregacao secao->local e direta.")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--uf", nargs="*", metavar="UF", help="UFs a baixar (padrao: todas)")
    ap.add_argument("--probe", action="store_true",
                    help="baixa so AC (o menor) e imprime o schema do CSV; nao processa o resto")
    ap.add_argument("--sem-locais", action="store_true", help="pula eleitorado_local_votacao_2026.zip")
    ap.add_argument("--destino", type=Path, default=DESTINO)
    ap.add_argument("--paralelo", type=int, default=4, metavar="N",
                    help="downloads simultaneos (o CDN limita por conexao, nao no total)")
    args = ap.parse_args()

    destino: Path = args.destino
    destino.mkdir(parents=True, exist_ok=True)

    if args.probe:
        alvo = destino / "perfil_eleitor_secao_2026_AC.zip"
        print("Sondando o schema com AC (menor UF)...")
        if not baixar(URL_PERFIL.format(uf="AC"), alvo):
            print("Falha ao baixar AC.")
            return 1
        sondar(alvo)
        return 0

    ufs = [u.upper() for u in (args.uf or UFS)]
    desconhecidas = [u for u in ufs if u not in UFS]
    if desconhecidas:
        print(f"UF invalida: {desconhecidas}")
        return 2

    falhas: list[str] = []
    if not args.sem_locais:
        print("Registro de locais de votacao 2026:")
        if not baixar(URL_LOCAIS, destino / "eleitorado_local_votacao_2026.zip"):
            falhas.append("locais")

    # As UFs maiores primeiro: com pool fixo, comecar pelas grandes evita terminar
    # com SP sozinho ocupando uma unica conexao no fim.
    ordem = sorted(ufs, key=lambda u: -PESO.get(u, 0))
    print(f"\nPerfil do eleitorado por secao — {len(ufs)} UFs, {args.paralelo} em paralelo:")
    with cf.ThreadPoolExecutor(max_workers=max(1, args.paralelo)) as pool:
        futuros = {
            pool.submit(baixar, URL_PERFIL.format(uf=uf),
                        destino / f"perfil_eleitor_secao_2026_{uf}.zip", 5, True): uf
            for uf in ordem
        }
        for concluido, fut in enumerate(cf.as_completed(futuros), 1):
            uf = futuros[fut]
            ok = False
            try:
                ok = fut.result()
            except Exception as err:  # noqa: BLE001 — uma UF nao pode derrubar o lote
                print(f"  ! {uf}: {type(err).__name__}: {err}", flush=True)
            if not ok:
                falhas.append(uf)
            print(f"  [{concluido}/{len(ordem)}] UFs concluidas", flush=True)

    total = sum(p.stat().st_size for p in destino.glob("*.zip"))
    print(f"\nTotal em {destino}: {_humano(total)}")
    if falhas:
        print(f"FALHARAM (rode de novo para retomar): {falhas}")
        return 1
    print("Todos os downloads completos.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
