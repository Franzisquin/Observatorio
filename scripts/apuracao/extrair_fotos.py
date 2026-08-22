"""Extrai as fotos de urna dos pacotes de dados abertos do TSE.

Entrada: os ZIP `foto_cand2026_{UE}_div.zip` do portal de dados abertos
(https://dadosabertos.tse.jus.br/dataset/candidatos-2026), que trazem TODOS os
candidatos daquela unidade — inclusive deputados, vices e suplentes.

Saida: so as fotos dos candidatos que a apuracao mostra, em
resultados_geo/candidatos_2026/fotos/{sqCandidato}.jpg, mais o manifesto
fotos.json que a pagina consulta antes de pedir imagem.

    python scripts/apuracao/extrair_fotos.py <pasta-com-os-zips>
    python scripts/apuracao/extrair_fotos.py ~/Downloads --limpar

Dentro do ZIP o nome e `F{UE}{sqCandidato}_div.jpg`. O sqCandidato e a mesma
chave do DivulgaCandContas e do snapshot de apuracao de 2026, entao o
casamento e direto — nao ha heuristica de nome aqui.

Baixar os ZIP e outra historia: o cdn.tse.jus.br recusa cliente que nao pareca
navegador (403 do Akamai), entao o download tem de sair de um navegador de
verdade. Ver scripts/apuracao/ponte_divulgacand.py para o mesmo problema.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent.parent
BASE = RAIZ / "resultados_geo" / "candidatos_2026"
FOTOS = BASE / "fotos"

# F + unidade eleitoral + sqCandidato + _div.jpg
PADRAO = re.compile(r"^F([A-Z]{2})(\d+)_div\.(jpe?g)$", re.I)

# Abaixo disso o arquivo e um placeholder de erro, nao um retrato.
MINIMO = 512


def sq_desejados() -> dict[str, dict]:
    """Uniao dos candidatos que a apuracao exibe, por cargo."""
    todos: dict[str, dict] = {}
    for arq in sorted(BASE.glob("cargo-*.json")):
        todos.update(json.loads(arq.read_text(encoding="utf-8")))
    return todos


def extrair(zips: list[Path], alvo: dict[str, dict], limpar: bool) -> tuple[int, int]:
    FOTOS.mkdir(parents=True, exist_ok=True)
    novas = pulados = 0

    for caminho in zips:
        try:
            pacote = zipfile.ZipFile(caminho)
        except zipfile.BadZipFile:
            print(f"  ! {caminho.name} nao e um ZIP valido", file=sys.stderr)
            continue

        achados = 0
        for nome in pacote.namelist():
            m = PADRAO.match(Path(nome).name)
            if not m:
                continue
            sq = m.group(2)
            if sq not in alvo:
                pulados += 1
                continue
            dados = pacote.read(nome)
            if len(dados) < MINIMO:
                continue
            (FOTOS / f"{sq}.jpg").write_bytes(dados)
            novas += 1
            achados += 1

        print(f"  {caminho.name}: {achados} fotos aproveitadas de {len(pacote.namelist())}")
        pacote.close()
        if limpar:
            caminho.unlink()

    return novas, pulados


def manifesto() -> int:
    existentes = sorted(f.stem for f in FOTOS.glob("*.jpg"))
    (BASE / "fotos.json").write_text(
        json.dumps(existentes, separators=(",", ":")), encoding="utf-8")
    return len(existentes)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pasta", type=Path, help="onde estao os foto_cand2026_*.zip")
    ap.add_argument("--limpar", action="store_true", help="apaga cada ZIP depois de extrair")
    ap.add_argument("--padrao", default="*.zip", help="filtro de nome dentro da pasta")
    args = ap.parse_args()

    alvo = sq_desejados()
    if not alvo:
        print(f"Nenhum cargo-*.json em {BASE}. Rode antes a importacao das "
              f"candidaturas (ponte_divulgacand.py).", file=sys.stderr)
        return 1

    zips = sorted(args.pasta.glob(args.padrao))
    if not zips:
        print(f"Nenhum ZIP em {args.pasta} com o filtro {args.padrao}", file=sys.stderr)
        return 1

    print(f"{len(alvo)} candidatos procurados, {len(zips)} pacotes a abrir")
    novas, pulados = extrair(zips, alvo, args.limpar)
    total = manifesto()
    print(f"\n{novas} fotos gravadas, {pulados} ignoradas (nao sao dos cargos exibidos)")
    print(f"manifesto: {total} fotos -> {BASE / 'fotos.json'}")
    faltam = len(alvo) - total
    if faltam > 0:
        print(f"{faltam} candidatos ainda sem foto — o TSE so publica depois de "
              f"julgado o registro, e nem todo pacote de UF foi baixado.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
