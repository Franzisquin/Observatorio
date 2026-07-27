"""Regressao ecologica sobre os pacotes de 2026: como cada grupo demografico
votou em 2022, por escopo.

Entrada : resultados_geo/sim2026/locais_<UF>.bin  (gerar_base_2026.py)
Saida   : resultados_geo/sim2026/baselines/nacional.json
          resultados_geo/sim2026/baselines/uf/<UF>.json
          resultados_geo/sim2026/baselines/muni/<UF>.json
          resultados_geo/sim2026/baselines/qualidade.json

O modelo, por dimensao d e comportamento de 2022 p:

    share_ip  ~=  sum_k  frac_ik * support_kp        com support >= 0

resolvido por NNLS ponderado por eleitores aptos (a variancia de uma proporcao
cai com o tamanho da amostra, entao o peso e o proprio eleitorado). O `support`
resultante e normalizado para somar 1 entre os comportamentos: e a estimativa
de como o bucket k se dividiu entre Lula / Bolsonaro / nulo-branco / abstencao.

Uma media simples dos locais nao serve: ela atenua todo grupo misturado em
direcao a media nacional. A regressao separa os grupos justamente explorando a
variacao de composicao entre locais.

Isto tem dois usos: alimenta os valores iniciais do editor demografico e
semeia os defaults da matriz de transferencia do 2o turno.

    python scripts/gerar_ei_baselines_2026.py
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from scipy.optimize import nnls

sys.path.insert(0, str(Path(__file__).resolve().parent))
import schema_sim2026 as esq  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
PACOTES = RAIZ / "resultados_geo" / "sim2026"
SAIDA = PACOTES / "baselines"

# Os "partidos" do baseline sao os comportamentos de 2022 — os candidatos de
# 2026 so existem em tempo de execucao, derivados pela matriz de transferencia.
ORIGENS = [b[0] for b in next(d for d in esq.DIMENSOES if d["chave"] == "voto2022")["buckets"]]


def carregar(uf: str, indice: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """-> (cabecalho estruturado, fracoes 0..1, aptos)."""
    rb, hb = indice["recordBytes"], indice["headerBytes"]
    buf = np.fromfile(PACOTES / f"locais_{uf}.bin", dtype=np.uint8).reshape(-1, rb)
    dt = np.dtype([("cd_municipio", "<u4"), ("cod_ibge", "<u4"), ("nr_zona", "<u2"),
                   ("nr_locvot", "<u2"), ("aptos", "<u4"), ("flags", "u1"), ("_pad", "u1")])
    cab = np.ascontiguousarray(buf[:, :hb]).view(dt).ravel()
    fr = buf[:, hb:].astype(np.float64) / esq.QUANT
    return cab, fr, cab["aptos"].astype(np.float64)


ALFA_RIDGE = 0.15    # encolhimento para a media do escopo
ALFA_SUAVE = 0.60    # penalidade de primeira diferenca, so em dimensoes ordinais


def suporte(fr: np.ndarray, votos: np.ndarray, aptos: np.ndarray) -> dict:
    """NNLS ponderado por dimensao, regularizado.

    `votos` e (n, len(ORIGENS)) em votos absolutos.

    Sem regularizacao a regressao ecologica cai em solucoes de canto (0% / 100%):
    a composicao dos locais e fortemente colinear — quase todo local tem mistura
    parecida de idade e escolaridade — entao o sistema e mal condicionado e o NNLS
    empurra os coeficientes nao identificados para a fronteira. Isso produz numeros
    absurdos ("100% dos analfabetos votaram Lula") que nao sao achado, sao ruido.

    Duas penalidades, ambas montadas por aumento do sistema (preservando a
    restricao de nao-negatividade):

    RIDGE, em toda dimensao: ||x - media_do_escopo||^2. Puxa buckets pouco
    identificados para a media em vez de para a fronteira.

    SUAVIDADE, so onde os buckets tem ORDEM natural (idade, escolaridade,
    renda): ||D x||^2, com D a primeira diferenca entre buckets vizinhos. Sem
    ela o ajuste zigueizagueia — "medio incompleto" mais a esquerda que
    "fundamental completo" e que "medio completo" — porque categorias
    adjacentes sao quase colineares e a regressao troca massa entre elas
    livremente. A penalidade nao impoe monotonicidade; so cobra um preco por
    saltos entre vizinhos, deixando o gradiente real aparecer.

    Os dois lambdas sao escalados por trace(A'A)/nb, o que os torna invariantes
    ao tamanho do escopo: a mesma forca vale para AC (679 locais) e para o
    Brasil (~84 mil).
    """
    off = esq.offsets()
    w = np.sqrt(np.maximum(aptos, 0.0))
    part = np.zeros_like(votos)
    ok = aptos > 0
    part[ok] = votos[ok] / aptos[ok, None]
    peso = aptos / aptos.sum() if aptos.sum() > 0 else aptos
    media = (part * peso[:, None]).sum(axis=0)  # participacao media do escopo

    fora = {}
    for d in esq.DIMENSOES:
        if d["chave"] == "voto2022":
            continue  # a propria variavel resposta
        o, c = off[d["chave"]]
        A = fr[:, o:o + c] * w[:, None]
        escala = float((A * A).sum()) / max(c, 1)

        raiz_r = np.sqrt(max(ALFA_RIDGE * escala, 1e-12))
        blocos_A = [A, raiz_r * np.eye(c)]
        n_extra = c

        if d.get("ordinal") and c > 2:
            D = np.zeros((c - 1, c))
            for i in range(c - 1):
                D[i, i], D[i, i + 1] = -1.0, 1.0
            raiz_s = np.sqrt(max(ALFA_SUAVE * escala, 1e-12))
            blocos_A.append(raiz_s * D)
            n_extra += c - 1

        A_aug = np.vstack(blocos_A)
        sup = np.zeros((c, len(ORIGENS)))
        for p in range(len(ORIGENS)):
            b = [part[:, p] * w, np.full(c, raiz_r * media[p])]
            if n_extra > c:
                b.append(np.zeros(c - 1))   # a suavidade puxa para diferenca zero
            sup[:, p], _ = nnls(A_aug, np.concatenate(b))
        soma = sup.sum(axis=1, keepdims=True)
        soma[soma == 0] = 1.0
        fora[d["chave"]] = (sup / soma).round(5).tolist()
    return fora


def participacoes(fr: np.ndarray, aptos: np.ndarray) -> dict:
    """Peso de cada bucket no eleitorado do escopo."""
    off, fora = esq.offsets(), {}
    total = aptos.sum()
    for d in esq.DIMENSOES:
        o, c = off[d["chave"]]
        s = (fr[:, o:o + c] * aptos[:, None]).sum(axis=0)
        fora[d["chave"]] = (s / total if total > 0 else s).round(6).tolist()
    return fora


def qualidade(fr: np.ndarray, votos: np.ndarray, aptos: np.ndarray, sup: dict) -> dict:
    """MAE ponderado do ajuste, contra o modelo trivial (media do escopo).

    Se uma dimensao nao bate o trivial, ela nao explica nada da variacao entre
    locais e a UI deve sinalizar isso em vez de fingir precisao.
    """
    off = esq.offsets()
    ok = aptos > 0
    part = np.zeros_like(votos)
    part[ok] = votos[ok] / aptos[ok, None]
    peso = aptos / aptos.sum()
    media = (part * peso[:, None]).sum(axis=0)
    mae_trivial = float((np.abs(part - media) * peso[:, None]).sum() / len(ORIGENS))

    fora = {"mae_trivial": round(mae_trivial, 5)}
    for chave, matriz in sup.items():
        o, c = off[chave]
        pred = fr[:, o:o + c] @ np.array(matriz)
        mae = float((np.abs(part - pred) * peso[:, None]).sum() / len(ORIGENS))
        fora[chave] = {
            "mae": round(mae, 5),
            "ganho": round(1 - mae / mae_trivial, 4) if mae_trivial > 0 else 0.0,
        }
    return fora


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--saida", type=Path, default=SAIDA)
    args = ap.parse_args()

    with open(PACOTES / "index.json", encoding="utf-8") as f:
        indice = json.load(f)
    ufs = sorted(indice["ufs"])
    if not ufs:
        print("Nenhum pacote. Rode gerar_base_2026.py primeiro.")
        return 1

    off = esq.offsets()
    o_voto, c_voto = off["voto2022"]
    (args.saida / "uf").mkdir(parents=True, exist_ok=True)
    (args.saida / "muni").mkdir(parents=True, exist_ok=True)

    todos_fr, todos_votos, todos_aptos = [], [], []
    qual = {}

    print(f"Regressao ecologica em {len(ufs)} UFs:\n")
    for uf in ufs:
        cab, fr, aptos = carregar(uf, indice)
        votos = fr[:, o_voto:o_voto + c_voto] * aptos[:, None]

        sup = suporte(fr, votos, aptos)
        with open(args.saida / "uf" / f"{uf}.json", "w", encoding="utf-8") as f:
            json.dump({"escopo": f"uf:{uf}", "aptos": int(aptos.sum()),
                       "origens": ORIGENS, "shares": participacoes(fr, aptos),
                       "support": sup}, f, ensure_ascii=False)

        # Municipios herdam o `support` da UF (como no projeto EUA) e carregam
        # so a composicao propria — o que evita 5.570 NNLS instaveis em
        # municipios com 3 locais de votacao.
        muni = {}
        for cod in np.unique(cab["cod_ibge"]):
            if cod == 0:
                continue
            m = cab["cod_ibge"] == cod
            muni[int(cod)] = {"aptos": int(aptos[m].sum()),
                              "locais": int(m.sum()),
                              "shares": participacoes(fr[m], aptos[m])}
        with open(args.saida / "muni" / f"{uf}.json", "w", encoding="utf-8") as f:
            json.dump(muni, f, ensure_ascii=False)

        qual[uf] = qualidade(fr, votos, aptos, sup)
        todos_fr.append(fr)
        todos_votos.append(votos)
        todos_aptos.append(aptos)
        print(f"  {uf}: {len(fr):5,} locais  {len(muni):4,} municipios")

    fr = np.vstack(todos_fr)
    votos = np.vstack(todos_votos)
    aptos = np.concatenate(todos_aptos)
    sup = suporte(fr, votos, aptos)
    with open(args.saida / "nacional.json", "w", encoding="utf-8") as f:
        json.dump({"escopo": "nacional", "aptos": int(aptos.sum()),
                   "origens": ORIGENS, "shares": participacoes(fr, aptos),
                   "support": sup}, f, ensure_ascii=False)

    qual["BR"] = qualidade(fr, votos, aptos, sup)
    with open(args.saida / "qualidade.json", "w", encoding="utf-8") as f:
        json.dump(qual, f, ensure_ascii=False, indent=1)

    print(f"\nNacional: {len(fr):,} locais  {int(aptos.sum()):,} eleitores")
    print("\nComo cada grupo votou em 2022 (2o turno, estimativa nacional):")
    for d in esq.DIMENSOES:
        if d["chave"] not in sup:
            continue
        g = qual["BR"][d["chave"]]["ganho"]
        print(f"\n  {d['rotulo']}  (ganho sobre a media: {g:+.1%})")
        for (bk, rot), linha in zip(d["buckets"], sup[d["chave"]]):
            val = linha[0] + linha[1]
            lula = 100 * linha[0] / val if val > 0 else 0
            print(f"    {rot:26s} Lula {lula:5.1f}%  Bolso {100 - lula:5.1f}%   "
                  f"abst. {100 * linha[3]:4.1f}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
