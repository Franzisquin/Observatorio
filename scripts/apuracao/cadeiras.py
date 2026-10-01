"""Cadeiras da disputa proporcional (deputado federal, estadual e distrital)
pelas regras que valem em 2026: Codigo Eleitoral, arts. 106 a 109, na redacao
da Lei 14.211/2021, com o art. 109, III como o STF o leu nas ADIs 7228, 7263 e
7325 (fevereiro de 2024).

  QE       votos validos / vagas; fracao ate meio desprezada, acima de meio
           vale um (art. 106)
  1a fase  quociente partidario: votos do bloco / QE, fracao desprezada, e so
           para candidato com pelo menos 10% do QE (arts. 107 e 108)
  2a fase  sobras por maior media, votos / (cadeiras ja obtidas + 1), entre os
           blocos com pelo menos 80% do QE cujo proximo candidato tenha 20% do
           QE (art. 109, I e par. 2o)
  3a fase  o que ainda sobrar, pela mesma media, entre TODOS os blocos e sem
           minimo de voto nominal (art. 109, III, pelo STF)

Bloco e a federacao ou o partido isolado. As cadeiras de um bloco vao aos seus
mais votados, em ordem (art. 109, par. 1o): basta olhar o proximo da fila para
saber se o bloco ainda tem quem ocupe a vaga. Sem bloco nenhum no QE, tudo sai
pelas medias (o art. 111, dos mais votados, esta sob as mesmas ADIs).

Em 2022 o TSE fechou a 3a fase aos blocos com 80% do QE; `fase3_aberta=False`
refaz aquela conta, e e com ela que testar_cadeiras.py confere este codigo
contra o resultado oficial de 2022, UF por UF.
"""

from __future__ import annotations


def quociente_eleitoral(validos: int, vagas: int) -> int:
    q, r = divmod(validos, vagas)
    return q + (2 * r > vagas)


def distribuir(votos: list[int], candidatos: list[list[int]], vagas: int,
               fase3_aberta: bool = True) -> list[int]:
    """Cadeiras de cada bloco.

    votos       votos validos do bloco: nominais mais legenda
    candidatos  voto nominal de cada candidato do bloco que pode ocupar vaga
                (sem o anulado e o sub judice), do mais ao menos votado
    """
    cad = [0] * len(votos)
    qe = quociente_eleitoral(sum(votos), vagas) if vagas else 0
    if qe <= 0:
        return cad

    # 1a fase. Com quase nada apurado o QE arredondado pode render mais
    # quociente partidario que vagas; o teto segura.
    for i in sorted(range(len(votos)), key=lambda i: -votos[i]):
        aptos = sum(1 for c in candidatos[i] if 10 * c >= qe)
        cad[i] = min(votos[i] // qe, aptos, vagas - sum(cad))

    def proximo(i):
        return candidatos[i][cad[i]] if cad[i] < len(candidatos[i]) else None

    def medias(pode):
        while sum(cad) < vagas:
            vez = [i for i in range(len(votos)) if proximo(i) is not None and pode(i)]
            if not vez:
                return
            # empate de media: leva o bloco mais votado
            cad[max(vez, key=lambda i: (votos[i] / (cad[i] + 1), votos[i]))] += 1

    medias(lambda i: 5 * votos[i] >= 4 * qe and 5 * proximo(i) >= qe)
    medias(lambda i: fase3_aberta or 5 * votos[i] >= 4 * qe)
    return cad
