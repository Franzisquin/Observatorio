"""Confere cadeiras.py contra o resultado oficial de 2022, UF por UF.

Os votos de cada bloco sao os oficiais do TSE (official_totals_2022.json); a
fila de cada bloco sai do acervo por local, sem quem nao podia ocupar vaga.

  conta de 2022   com `fase3_aberta=False`, como o TSE fez em 2022, as cadeiras
                  de cada bloco tem de bater com os eleitos de 2022
  regra de hoje   a 3a fase aberta pelo STF tem de mover exatamente as cadeiras
                  que a retotalizacao mandada pelo STF moveu na Camara: quatro
                  no Amapa e uma no DF, em Rondonia e no Tocantins

    py scripts/apuracao/testar_cadeiras.py
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cadeiras import distribuir, quociente_eleitoral  # noqa: E402
from ensaio_2022 import LEG, UFS, Casa, blocos, ler, vagas_oficiais  # noqa: E402

# Cadeiras federais que a retotalizacao do STF mudou de bloco, por UF.
RETOTALIZACAO_STF = {"ap": 4, "df": 1, "ro": 1, "to": 1}

# O que a conta de 2022 nao reproduz:
#   TO  o TSE deu a 8a vaga ao PP (Lazaro Botelho), embora Uniao e Republicanos
#       tivessem media maior entre os blocos com 80% do QE. E a 3a fase de
#       2022, a que o STF mudou; pela regra de hoje a vaga e do Podemos.
#   PR  Deltan Dallagnol, eleito em 2022 e cassado em 2023: o acervo traz o voto
#       dele anulado, e sem ele na fila o Podemos perde a vaga. E dado, nao regra.
EXCECOES_2022 = {("0006", "to"), ("0006", "pr")}


def main() -> int:
    totais = json.loads((LEG / "official_totals_2022.json").read_text(encoding="utf-8"))
    falhas, casas, movidas = [], 0, {}
    for cargo in ("0006", "0007"):
        for uf in UFS:
            c = "0008" if cargo == "0007" and uf == "df" else cargo
            casa = Casa(c, uf, ler(c, uf, "1"), {}, 0, vagas_oficiais(c, uf))
            casa.avancar(1.0)
            todos = Counter()
            for acc in casa.mun.values():
                todos.update(acc["votos"])
            oficial = totais[uf.upper()]["f" if c == "0006" else "e"]
            por_nome = {o["raw_comp"].split("(")[0].strip().upper(): o
                        for o in oficial["coalitions"]}
            # bloco sem voto valido (PCO: todos anulados) nem aparece no oficial
            lista = [(b, por_nome[b["nm"].strip().upper()])
                     for b in blocos(casa, todos, final=True)
                     if b["nm"].strip().upper() in por_nome]
            votos = [o["votes"] for _, o in lista]
            filas = [[x["v"] for x in b["cand"] if "dvt" not in x] for b, _ in lista]
            eleitos = [o["elected"] for _, o in lista]
            casas += 1

            stats = oficial["stats"]
            if quociente_eleitoral(stats["qt_votos_validos"], casa.nv) != stats["vr_qe"]:
                falhas.append(f"  {c} {uf}: QE")
            if (c, uf) in EXCECOES_2022 and uf != "to":
                continue
            em_2022 = distribuir(votos, filas, casa.nv, fase3_aberta=False)
            if em_2022 != eleitos and (c, uf) not in EXCECOES_2022:
                falhas.append(f"  {c} {uf}: " + ", ".join(
                    f"{b['nm'][:30]} {a} (oficial {o})"
                    for (b, _), a, o in zip(lista, em_2022, eleitos) if a != o))
            hoje = distribuir(votos, filas, casa.nv)
            mudou = sum(max(0, a - o) for a, o in zip(hoje, eleitos))
            if mudou:
                movidas[uf if c == "0006" else f"{c} {uf}"] = mudou
                print(f"  regra de hoje, {c} {uf.upper()}: " + ", ".join(
                    f"{b['nm'][:30]} {o} -> {a}"
                    for (b, _), a, o in zip(lista, hoje, eleitos) if a != o))

    if movidas != RETOTALIZACAO_STF:
        falhas.append(f"  regra de hoje moveu {movidas}, a retotalizacao {RETOTALIZACAO_STF}")
    print(f"{casas - len(falhas)} de {casas} casas conferem")
    print("\n".join(falhas))
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())
