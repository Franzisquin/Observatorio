"""Uma eleicao presidencial de 2026 inventada, para ver a pagina presidencial —
e a comparacao com 2022, as setas do mapa — com dado no formato do coletor.

Parte do 1o turno de 2022, municipio a municipio (o acervo local), e o leva ate
um resultado nacional escolhido (ALVO): Flavio Bolsonaro 48%, Lula 41%, Renan
Santos em terceiro, Augusto Cury em quarto, Caiado em quinto, Zema em sexto.

  - A disputa entre os dois primeiros anda o quanto o pais andou, mais um
    desvio sorteado da UF e um do proprio municipio: e isso que faz as setas
    variarem de tamanho e de lado.
  - A terceira via ocupa o lugar que Tebet, Ciro e os outros ocupavam em 2022,
    e cada candidato rende mais no seu reduto (REDUTO).
  - Tudo e calibrado ate o pais bater o ALVO.

Os candidatos sao os de 2026 (resultados_geo/candidatos_2026/cargo-0001.json),
com o sqcand de verdade. Sai a apuracao encerrada, com Flavio e Lula no 2o turno.

    py scripts/apuracao/simular2026.py
    py scripts/apuracao/simular2026.py --semente 7

Depois abra:
    apuracao-presidente.html?cargo=0001&dados=scratch/apuracao/sim2026/

Tudo sai com fase "s": a pagina mostra o selo SIMULADO.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import re
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from coleta import escrever  # noqa: E402
from ensaio_2022 import COMPARECIMENTO, RAIZ, UFS, VOTOS_POR_SECAO, ler, nomes_dos_municipios  # noqa: E402

ELEICAO = "21270"
DESTINO = RAIZ / "scratch" / "apuracao" / "sim2026"
CHAPA = RAIZ / "resultados_geo" / "candidatos_2026" / "cargo-0001.json"
FORA = re.compile(r"^(Ren[uú]ncia|Indeferido|Cancelado|Falecimento|Pedido n[aã]o conhecido)\s*$", re.I)

# Resultado nacional, em % dos validos, por numero de urna. Os nanicos repartem
# o que sobra.
ALVO = {"22": 48.0, "13": 41.0, "14": 4.6, "70": 3.0, "55": 2.1, "30": 1.0}

# Onde cada terceira via rende mais que a media: o estado dele e o entorno.
REDUTO = {"55": {"go": 4.0, "mt": 1.6, "ms": 1.6, "df": 1.6, "to": 1.4},
          "30": {"mg": 4.0, "es": 1.4},
          "14": {"sp": 1.7, "pr": 1.3, "sc": 1.4, "rs": 1.3},
          "70": {"sp": 1.4, "go": 1.4, "mg": 1.2}}


def logit(p: float) -> float:
    p = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p))


def expit(x: float) -> float:
    return 1 / (1 + math.exp(-x))


def bissecao(f, alvo: float, lo: float, hi: float) -> float:
    """O x em [lo, hi] com f(x) = alvo, para f crescente."""
    for _ in range(60):
        meio = (lo + hi) / 2
        lo, hi = (meio, hi) if f(meio) < alvo else (lo, meio)
    return (lo + hi) / 2


def ler_2022() -> list[dict]:
    """Uma linha por municipio (e uma para o exterior): votos por numero,
    brancos, nulos e validos do 1o turno de 2022."""
    unidades = []
    for uf in UFS + ["zz"]:
        por_mun: dict[str, Counter] = {}
        for chave, votos in ler("0001", uf, "1")["RESULTS"].items():
            partes = chave.split("_")
            mun = partes[1].zfill(5) if len(partes) >= 3 else "zz"
            por_mun.setdefault(mun, Counter()).update({k: int(v) for k, v in votos.items()})
        for mun, c in por_mun.items():
            vv = sum(v for k, v in c.items() if k not in ("95", "96"))
            if vv:
                unidades.append({"uf": uf, "mun": mun, "vv": vv, "vb": c["95"], "vn": c["96"],
                                 "lula": c["13"] / vv, "jair": c["22"] / vv})
    return unidades


def simular(unidades: list[dict], numeros: list[str], semente: int) -> None:
    """Grava em cada unidade `votos` {numero: votos} de 2026."""
    rng = random.Random(semente)
    desvio_uf = {uf: rng.gauss(0, 0.12) for uf in UFS + ["zz"]}
    for u in unidades:
        u["e"] = desvio_uf[u["uf"]] + rng.gauss(0, 0.10)
        u["ruido_t"] = math.exp(rng.gauss(0, 0.25))
        u["vv26"] = max(1, round(u["vv"] * (1 + rng.gauss(0.01, 0.025))))
        u["ruido_c"] = {n: math.exp(rng.gauss(0, 0.2)) for n in numeros}
    total = sum(u["vv26"] for u in unidades)
    media = lambda f: sum(f(u) * u["vv26"] for u in unidades) / total  # noqa: E731

    # Terceira via: no lugar dos outros de 2022, ate somar o que o ALVO deixa.
    terceira = 1 - (ALVO["22"] + ALVO["13"]) / 100
    t = lambda u, k: min(0.7, max(0.005, (1 - u["lula"] - u["jair"]) * k * u["ruido_t"]))  # noqa: E731
    k = bissecao(lambda k: media(lambda u: t(u, k)), terceira, 0.01, 20)
    for u in unidades:
        u["t"] = t(u, k)

    # Os dois primeiros: a fatia de Flavio no voto dos dois anda d no pais todo.
    def p26(u, d):
        return expit(logit(u["jair"] / (u["jair"] + u["lula"])) + d + u["e"])
    d = bissecao(lambda d: media(lambda u: (1 - u["t"]) * p26(u, d)), ALVO["22"] / 100, -3, 3)

    # A terceira via repartida, com o peso de cada um calibrado ate o ALVO.
    outros = [n for n in numeros if n not in ("13", "22")]
    resto = (terceira * 100 - sum(ALVO.get(n, 0) for n in outros if n in ALVO))
    nanicos = [n for n in outros if n not in ALVO]
    meta = {n: ALVO.get(n, resto / max(1, len(nanicos))) for n in outros}
    peso = dict(meta)
    for _ in range(25):
        for u in unidades:
            w = {n: peso[n] * REDUTO.get(n, {}).get(u["uf"], 1) * u["ruido_c"][n] for n in outros}
            soma = sum(w.values())
            u["fatia"] = {n: u["t"] * w[n] / soma for n in outros}
        for n in outros:
            peso[n] *= meta[n] / (100 * media(lambda u: u["fatia"][n]))

    for u in unidades:
        p = p26(u, d)
        fatias = {"22": (1 - u["t"]) * p, "13": (1 - u["t"]) * (1 - p), **u["fatia"]}
        votos = {n: round(f * u["vv26"]) for n, f in fatias.items()}
        votos["22"] += u["vv26"] - sum(votos.values())          # arredondamento
        u["votos"] = votos
        escala = u["vv26"] / u["vv"]
        u["vb26"], u["vn26"] = round(u["vb"] * escala), round(u["vn"] * escala)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--semente", type=int, default=2026)
    ap.add_argument("--destino", type=Path, default=DESTINO)
    args = ap.parse_args()

    chapa = {sq: c for sq, c in json.loads(CHAPA.read_text(encoding="utf-8")).items()
             if not FORA.match(c.get("situacao") or "")}
    sq_de = {c["numero"]: sq for sq, c in chapa.items()}
    unidades = ler_2022()
    simular(unidades, list(sq_de), args.semente)

    nacional = Counter()
    for u in unidades:
        nacional.update(u["votos"])
    vv = sum(nacional.values())
    ordem = [n for n, _ in nacional.most_common()]
    dic = {}
    for sq, c in chapa.items():
        segundo = c["numero"] in ordem[:2]
        dic[sq] = {"nome": c["nome"], "urna": c["urna"], "numero": c["numero"],
                   "partido": c["partido"], "coligacao": c.get("coligacao") or "",
                   "situacao": "2º turno" if segundo else "Não eleito",
                   **({"eleito": "s"} if segundo else {})}

    agora = time.localtime()
    dt, ht = time.strftime("%d/%m/%Y", agora), time.strftime("%H:%M:%S", agora)
    meta = {"ele": ELEICAO, "t": "1", "f": "s", "sup": "n", "idg": "1", "dg": dt, "hg": ht,
            "cargo": "0001", "fonte": "simulacao ElectoMaps (scripts/apuracao/simular2026.py)",
            "gerado": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}

    def entrada(us: list[dict], completo: bool) -> dict:
        """No desenho de coleta.resumo: apuracao encerrada e totalizada."""
        votos = Counter()
        for u in us:
            votos.update(u["votos"])
        v = sum(votos.values())
        vb = sum(u["vb26"] for u in us)
        vn = sum(u["vn26"] for u in us)
        tv = v + vb + vn
        ts = sum(max(1, round((u["vv"] + u["vb"] + u["vn"]) / VOTOS_POR_SECAO)) for u in us)
        te = sum(round((u["vv"] + u["vb"] + u["vn"]) / COMPARECIMENTO) for u in us)
        e = {"and": "f", "tf": "s", "dv": "s", "md": "", "dt": dt, "ht": ht, "st": ts, "ts": ts,
             "pst": 100.0, "te": te, "comp": tv, "abst": max(0, te - tv), "tv": tv,
             "vvc": v, "vv": v, "vb": vb, "vn": vn,
             "cand": {sq_de[n]: votos.get(n, 0) for n in sq_de}}
        if completo:
            e.update({"nv": 1, "snt": 0, "si": ts, "sni": 0, "sa": ts, "sna": 0, "est": te,
                      "esnt": 0, "esi": te, "esni": 0, "esa": te, "esna": 0, "vnom": v, "vl": 0,
                      "van": 0, "vansj": 0, "tvn": vn, "vnt": 0, "vscv": 0, "vsan": 0})
        return e

    destino: Path = args.destino
    nomes = nomes_dos_municipios()
    abr_uf = {}
    for uf in UFS + ["zz"]:
        us = [u for u in unidades if u["uf"] == uf]
        abr_uf[uf] = entrada(us, True)
        if uf == "zz":
            continue
        escrever(destino, f"{ELEICAO}-0001-{uf}.json", {
            "meta": meta, "abr": {u["mun"]: entrada([u], False) for u in us},
            "mun": {u["mun"]: nomes.get(u["mun"], {"nm": u["mun"], "ibge": ""}) for u in us},
            "cand": dic})
    escrever(destino, f"{ELEICAO}-0001-uf.json", {"meta": meta, "abr": abr_uf, "cand": dic})
    escrever(destino, f"{ELEICAO}-0001-br.json",
             {"meta": meta, "abr": {"br": entrada(unidades, True)}, "cand": dic})
    escrever(destino, "indice.json", {
        "base": "simulacao", "ambiente": "sim2026", "fase": "s", "cargos": {"0001": ELEICAO},
        "eleicoes": {ELEICAO: {"t": "1", "tp": 8, "t2": "", "nm": "Simulação 2026 — 1º turno",
                               "cargos": ["0001"]}},
        "gerado": meta["gerado"]})

    print("Brasil:", ", ".join(f"{chapa[sq_de[n]]['urna']} {100 * nacional[n] / vv:.2f}%"
                                for n in ordem[:7]))
    print(f"-> {destino}")
    # O que foi pedido: os dois primeiros no ALVO e a ordem dos seis primeiros.
    assert ordem[:6] == ["22", "13", "14", "70", "55", "30"], ordem[:6]
    assert all(abs(100 * nacional[n] / vv - a) < 0.05 for n, a in ALVO.items())
    return 0


if __name__ == "__main__":
    sys.exit(main())
