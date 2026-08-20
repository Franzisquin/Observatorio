"""Monta o pacote de GOVERNADOR 2022 do simulador: um sidecar binario por UF com
a composicao do voto de 2022 para o governo do estado, em cada local de votacao.

Entradas (todas ja versionadas no repo — nada para baixar)
    resultados_geo/sim2026/index.json
    resultados_geo/sim2026/locais_<UF>.bin
    resultados_geo/governador2022/governador_<UF>_2022.geojson   (via zip_index)
    resultados_geo/regioes_ibge.json

Saidas
    resultados_geo/simgov2026/gov_<UF>.bin
    resultados_geo/simgov2026/regioes_<UF>.json
    resultados_geo/simgov2026/index.json

POR QUE UM SIDECAR, E NAO UM PACOTE NOVO

gerar_base_2026.py monta locais_<UF>.bin a partir de
scratch/eleitorado/2026/agregado/*.parquet, que esta no .gitignore e pesa ~2,5 GB
baixados do TSE. Regenerar o pacote presidencial e impossivel num checkout limpo.
Mas locais_<UF>.bin ja carrega tudo que precisamos: a chave natural, o codigo
IBGE, os aptos e as 42 fracoes demograficas — inclusive as 5 dimensoes do TSE que
formam o espaco de busca da imputacao por doadores. Entao o sidecar e
integralmente reproduzivel a partir do que esta commitado, e este script NAO
altera um byte de sim2026/.

AS ORIGENS SAO POR ESTADO

No presidencial as origens da migracao sao fixas (lula, bolsonaro, outros,
nulo_branco, abstencao). Aqui a lista de candidatos muda de estado para estado,
entao cada UF tem as suas: os candidatos com pelo menos LIMIAR_ORIGEM% dos
validos estaduais (no maximo MAX_ORIGENS), mais outros, nulo_branco e abstencao.
Ver schema_simgov2022.py.

    python scripts/gerar_base_governador_2022.py --conferir
    python scripts/gerar_base_governador_2022.py --uf RJ
    python scripts/gerar_base_governador_2022.py
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import schema_simgov2022 as esq  # noqa: E402
from gerar_base_2026 import (  # noqa: E402
    CABECALHO as CABECALHO_PRES,
    achar_chave,
    ler_geojson,
    normalizar,
    num,
    quantizar,
)

RAIZ = Path(__file__).resolve().parent.parent
GEO = RAIZ / "resultados_geo"
PACOTE_PRES = GEO / "sim2026"
SAIDA = GEO / "simgov2026"

UFS = ("AC AL AM AP BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR "
       "SC SP SE TO").split()


# ------------------------------------------------------- pacote presidencial

def ler_pacote_pres(uf: str, indice: dict) -> dict:
    """Cabecalho + fracoes demograficas de locais_<UF>.bin, sem pandas.

    Devolve as fracoes ja em 0..1 e so das dimensoes que a imputacao usa — e o
    unico pedaco do pacote presidencial de que precisamos aqui.
    """
    n = indice["ufs"][uf]
    rb, hb, nb = indice["recordBytes"], indice["headerBytes"], indice["nBuckets"]
    caminho = PACOTE_PRES / f"locais_{uf}.bin"
    bruto = np.fromfile(caminho, dtype=np.uint8)
    if bruto.size != n * rb:
        raise SystemExit(f"{caminho}: {bruto.size} bytes, esperado {n * rb} "
                         f"({n} locais x {rb}) — index.json fora de sincronia")
    recs = bruto.reshape(n, rb)
    cab = np.ascontiguousarray(recs[:, :hb]).view(CABECALHO_PRES).ravel()

    offs, pos = {}, 0
    for d in indice["dimensions"]:
        offs[d["key"]] = (pos, len(d["buckets"]))
        pos += len(d["buckets"])
    fracs = recs[:, hb:hb + nb].astype(np.float64) / indice["quant"]
    perfil = [fracs[:, o:o + k] for o, k in (offs[d] for d in esq.DIMS_DOADOR)]

    return {
        "n": n,
        "cd_municipio": cab["cd_municipio"].astype(np.int64),
        "nr_zona": cab["nr_zona"].astype(np.int64),
        "nr_locvot": cab["nr_locvot"].astype(np.int64),
        "cod_ibge": cab["cod_ibge"].astype(np.int64),
        "aptos": cab["aptos"].astype(np.float64),
        "perfil": np.hstack(perfil),
    }


# ------------------------------------------------------------ governador 2022

def ler_governador(uf: str) -> tuple[dict, list[dict], dict]:
    """(votos por chave natural, candidatos de 1o turno, info de 2o turno).

    `votos` guarda a linha crua por coluna de candidato mais os totais, porque a
    selecao de origens depende do agregado estadual e so acontece depois.
    """
    gj = ler_geojson(f"governador2022/governador_{uf}_2022.geojson")
    if not gj:
        raise SystemExit(f"{uf}: governador2022 nao encontrado no zip_index")

    props0 = gj["features"][0]["properties"]
    cands = [c for c in (esq.parse_coluna(k) for k in props0)
             if c and c["turno"] == "1T"]
    fin2t = [c for c in (esq.parse_coluna(k) for k in props0)
             if c and c["turno"] == "2T"]

    k_validos = achar_chave(props0, "Total_Votos_Validos", " 1T")
    k_brancos = achar_chave(props0, "Votos_Brancos", " 1T")
    k_nulos = achar_chave(props0, "Votos_Nulos", " 1T")
    k_abst = achar_chave(props0, "Absten", " 1T")
    k_aptos = achar_chave(props0, "Eleitores_Aptos", " 1T")
    if not k_validos or not k_aptos:
        raise SystemExit(f"{uf}: geojson de governador sem coluna de validos/aptos")

    votos = {}
    for f in gj["features"]:
        p = f["properties"]
        try:
            chave = (int(p["CD_MUNICIPIO"]), int(float(p["NR_ZONA"])),
                     int(p["NR_LOCAL_VOTACAO"]))
        except (KeyError, TypeError, ValueError):
            continue
        aptos = num(p.get(k_aptos))
        if aptos <= 0:
            continue
        validos = num(p.get(k_validos))
        nulo_branco = num(p.get(k_brancos)) + num(p.get(k_nulos))
        abstencao = num(p.get(k_abst)) if k_abst else 0.0
        if abstencao <= 0:
            abstencao = max(0.0, aptos - validos - nulo_branco)
        votos[chave] = {
            "cand": {c["coluna"]: num(p.get(c["coluna"])) for c in cands},
            "validos": validos, "nulo_branco": nulo_branco,
            "abstencao": abstencao, "aptos": aptos,
        }

    turno2 = {
        "houve": bool(fin2t),
        "finalistas": [{"nome": esq.rotulo_titulo(c["nome"]), "partido": c["partido"],
                        "situacao": c["situacao"]} for c in fin2t],
    }
    return votos, cands, turno2


def montar_origens(votos: dict, cands: list[dict]) -> tuple[list[dict], list[str], list[dict]]:
    """Origens da UF: candidatos >= LIMIAR_ORIGEM% dos validos + outros/nulo/abst.

    Devolve (metadados das origens, colunas selecionadas na mesma ordem, lista
    completa dos candidatos de 2022 para exibicao).
    """
    total = {c["coluna"]: 0.0 for c in cands}
    soma_validos = soma_aptos = soma_nb = soma_abst = 0.0
    for v in votos.values():
        for k, x in v["cand"].items():
            total[k] += x
        soma_validos += v["validos"]
        soma_aptos += v["aptos"]
        soma_nb += v["nulo_branco"]
        soma_abst += v["abstencao"]

    pct = {k: (100 * v / soma_validos if soma_validos > 0 else 0.0)
           for k, v in total.items()}
    escolhidas = esq.escolher_origens(pct)
    por_coluna = {c["coluna"]: c for c in cands}

    def p_aptos(v):
        return round(100 * v / soma_aptos, 4) if soma_aptos else 0.0

    usados: set[str] = set()
    origens: list[dict] = []
    for col in escolhidas:
        c = por_coluna[col]
        origens.append({
            "key": esq.slug(c["nome"], usados),
            "rotulo": esq.rotulo_titulo(c["nome"]),
            "partido": c["partido"],
            "situacao": c["situacao"],
            "pctValidos": round(pct[col], 4),
            "pctAptos": p_aptos(total[col]),
        })
    resto = max(0.0, soma_validos - sum(total[k] for k in escolhidas))
    origens.append({
        "key": "outros", "rotulo": "Outros candidatos",
        "pctValidos": round(100 * resto / soma_validos, 4) if soma_validos else 0.0,
        "pctAptos": p_aptos(resto),
    })
    origens.append({"key": "nulo_branco", "rotulo": "Nulo ou branco",
                    "pctAptos": p_aptos(soma_nb)})
    origens.append({"key": "abstencao", "rotulo": "Nao compareceu",
                    "pctAptos": p_aptos(soma_abst)})

    todos = [{"nome": esq.rotulo_titulo(c["nome"]), "partido": c["partido"],
              "situacao": c["situacao"], "pctValidos": round(pct[c["coluna"]], 4),
              "origem": c["coluna"] in escolhidas} for c in cands]
    todos.sort(key=lambda c: -c["pctValidos"])
    return origens, escolhidas, todos


# ------------------------------------------------------------------ imputacao

def imputar(voto: np.ndarray, casado: np.ndarray, perfil: np.ndarray,
            aptos: np.ndarray) -> int:
    """Locais sem par em 2022 herdam a PARTICIPACAO dos K casados mais parecidos.

    Mesma mecanica de gerar_base_2026.py: espaco das fracoes do TSE padronizadas
    mais log(aptos), para nao casar uma escola de 3 mil eleitores com uma sala de
    80. A unica diferenca e que as fracoes vem quantizadas do .bin (1/255), o que
    e irrelevante para uma metrica de distancia.
    """
    espaco = np.hstack([perfil, np.log1p(aptos)[:, None]])
    mu, sd = espaco.mean(axis=0), espaco.std(axis=0)
    sd[sd < 1e-9] = 1.0
    espaco = (espaco - mu) / sd

    doadores = np.flatnonzero(casado)
    novos = np.flatnonzero(~casado)
    if not len(novos) or not len(doadores):
        return 0
    for i in novos:
        dist = np.linalg.norm(espaco[doadores] - espaco[i], axis=1)
        k = min(esq.K_DOADORES, len(doadores))
        viz = doadores[np.argpartition(dist, k - 1)[:k]]
        d = np.linalg.norm(espaco[viz] - espaco[i], axis=1)
        escala = max(float(np.median(d)), 1e-6)
        w = np.exp(-d / escala)
        w /= w.sum()
        part = voto[viz] / np.maximum(voto[viz].sum(axis=1, keepdims=True), 1e-9)
        voto[i] = part.T @ w
    return len(novos)


# ------------------------------------------------------------------- regioes

def agregar_regioes(uf: str, pres: dict, voto: np.ndarray, chaves_origem: list[str],
                    mapa: dict, nomes: dict) -> dict:
    """Composicao de 2022 agregada por UF, RG intermediaria e RG imediata.

    E o que o painel de pesos territoriais carrega automaticamente. A RGINT e a
    etapa OBRIGATORIA do modo governador (o analogo da macrorregiao no
    presidencial) e a RGI e o refinamento posterior.

    Diferente do arquivo presidencial, aqui nao ha acumulacao entre rodadas:
    RGINT e RGI nunca cruzam a fronteira de um estado, entao reprocessar uma UF
    jamais precisa preservar a fatia de outra.
    """
    k = len(chaves_origem)
    balde: dict[str, dict] = {}

    def somar(chave: str, extra: dict, i: int):
        e = balde.get(chave)
        if e is None:
            e = balde[chave] = dict(extra, aptos=0.0, votos=np.zeros(k))
        e["aptos"] += float(pres["aptos"][i])
        e["votos"] += voto[i]

    for i in range(pres["n"]):
        somar(f"uf:{uf}", {"nivel": "uf", "codigo": uf, "nome": uf}, i)
        info = mapa.get(str(int(pres["cod_ibge"][i])))
        if not info:
            continue
        ri, rgi = info.get("ri"), info.get("rgi")
        if ri:
            somar(f"ri:{ri}", {"nivel": "ri", "codigo": str(ri),
                               "nome": nomes["ri"].get(str(ri), f"Regiao {ri}")}, i)
        if rgi:
            somar(f"rgi:{rgi}", {"nivel": "rgi", "codigo": str(rgi),
                                 "nome": nomes["rgi"].get(str(rgi), f"Regiao {rgi}"),
                                 "rgint": str(ri) if ri else ""}, i)

    # Os validos sao os candidatos mais "outros" — nulo/branco e abstencao ficam
    # de fora, como percentuais independentes do eleitorado apto.
    n_validos = k - 2
    saida = {}
    for chave, e in balde.items():
        ap = e["aptos"]
        if ap <= 0:
            continue
        pct = 100 * e["votos"] / ap
        soma_val = float(pct[:n_validos].sum())
        item = {kk: vv for kk, vv in e.items() if kk not in ("aptos", "votos")}
        item["aptos"] = int(round(ap))
        item["pct_aptos"] = {o: round(float(pct[j]), 4)
                             for j, o in enumerate(chaves_origem)}
        item["pct_validos"] = {
            o: (round(100 * float(pct[j]) / soma_val, 4) if soma_val > 0 else 0.0)
            for j, o in enumerate(chaves_origem[:n_validos])}
        saida[chave] = item
    return saida


# ---------------------------------------------------------------- principal

def processar_uf(uf: str, indice_pres: dict, mapa: dict, nomes: dict,
                 saida: Path, escrever: bool) -> dict:
    pres = ler_pacote_pres(uf, indice_pres)
    votos, cands, turno2 = ler_governador(uf)
    origens, colunas, todos = montar_origens(votos, cands)
    chaves = [o["key"] for o in origens]
    k = len(chaves)

    n = pres["n"]
    voto = np.zeros((n, k), dtype=np.float64)
    casado = np.zeros(n, dtype=bool)
    for i in range(n):
        v = votos.get((int(pres["cd_municipio"][i]), int(pres["nr_zona"][i]),
                       int(pres["nr_locvot"][i])))
        if v is None:
            continue
        for j, col in enumerate(colunas):
            voto[i, j] = v["cand"][col]
        # "outros" e o residuo dos validos, para que a soma feche por construcao.
        voto[i, k - 3] = max(0.0, v["validos"] - sum(v["cand"][c] for c in colunas))
        voto[i, k - 2] = v["nulo_branco"]
        voto[i, k - 1] = v["abstencao"]
        casado[i] = True

    imputados = imputar(voto, casado, pres["perfil"], pres["aptos"])
    residuo = origens[-3]["pctValidos"]

    linha = {
        "uf": uf, "locais": n, "nOrigens": k,
        "recordBytes": esq.CABECALHO.itemsize + k,
        "casados": int(casado.sum()), "imputados": int(imputados),
        "origens": origens, "candidatos2022": todos, "turno2": turno2,
    }

    print(f"  {uf}: {n:6,} locais  casados={int(casado.sum()):6,} "
          f"({casado.mean():5.1%})  imputados={imputados:4,}  "
          f"origens={k - 3}+3  outros={residuo:4.2f}%")
    if casado.mean() < 0.85:
        print(f"  ! {uf}: casamento em {casado.mean():.1%} — "
              f"{imputados} locais dependem de imputacao")
    if residuo > 5.0:
        print(f"  ! {uf}: 'outros' com {residuo:.1f}% dos validos — "
              f"MAX_ORIGENS={esq.MAX_ORIGENS} pode estar apertado")

    if not escrever:
        return linha

    cab = np.zeros(n, dtype=esq.CABECALHO)
    cab["cd_municipio"] = pres["cd_municipio"]
    cab["nr_zona"] = pres["nr_zona"]
    cab["nr_locvot"] = pres["nr_locvot"]
    cab["flags"] = (~casado).astype(np.uint8)   # bit 0 = imputado

    quant = quantizar(normalizar(voto))
    assert quant.shape == (n, k), (quant.shape, (n, k))
    somas = quant.sum(axis=1)
    assert bool(np.all((somas == esq.QUANT) | (somas == 0))), "linha quantizada nao fecha"

    saida.mkdir(parents=True, exist_ok=True)
    with open(saida / f"gov_{uf}.bin", "wb") as f:
        f.write(np.hstack([cab.view(np.uint8).reshape(n, -1), quant]).tobytes())

    regioes = agregar_regioes(uf, pres, voto, chaves, mapa, nomes)
    ap_uf = regioes[f"uf:{uf}"]["aptos"]
    for nivel in ("ri", "rgi"):
        ap = sum(r["aptos"] for r in regioes.values() if r["nivel"] == nivel)
        if abs(ap - ap_uf) > 0.001 * ap_uf:
            print(f"  ! {uf}: aptos por {nivel} ({ap:,}) != aptos da UF "
                  f"({ap_uf:,}) — locais sem codigo IBGE")
    with open(saida / f"regioes_{uf}.json", "w", encoding="utf-8") as f:
        json.dump({"uf": uf, "origens": chaves, "regioes": regioes}, f,
                  ensure_ascii=False)
    return linha


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--uf", nargs="*", metavar="UF")
    ap.add_argument("--saida", type=Path, default=SAIDA)
    ap.add_argument("--conferir", action="store_true",
                    help="so relata o casamento e as origens, sem escrever nada")
    args = ap.parse_args()

    with open(PACOTE_PRES / "index.json", encoding="utf-8") as f:
        indice_pres = json.load(f)
    with open(GEO / "regioes_ibge.json", encoding="utf-8") as f:
        reg = json.load(f)
    mapa = reg["muni_to_region"]
    nomes = {
        "ri": {str(r["cd"]): r["nome"]
               for lista in reg.get("rgint_by_uf", {}).values() for r in lista},
        "rgi": {k: v.get("nome", "") for k, v in reg.get("rgi", {}).items()},
    }

    ufs = [u.upper() for u in (args.uf or UFS)]
    faltando = [u for u in ufs if u not in indice_pres["ufs"]]
    if faltando:
        print(f"Sem pacote presidencial para: {', '.join(faltando)}")
        return 1

    destino = "conferencia" if args.conferir else f"gravando em {args.saida}"
    print(f"Montando {len(ufs)} UFs ({destino}):\n")
    linhas = [processar_uf(u, indice_pres, mapa, nomes, args.saida, not args.conferir)
              for u in ufs]

    if args.conferir:
        return 0

    # O indice acumula as UFs de rodadas anteriores: rodar --uf RJ nao pode
    # apagar as outras 26.
    caminho = args.saida / "index.json"
    anterior = {}
    if caminho.exists():
        with open(caminho, encoding="utf-8") as f:
            anterior = json.load(f).get("ufs", {})
    anterior.update({r["uf"]: r for r in linhas})
    presentes = {u: r for u, r in sorted(anterior.items())
                 if (args.saida / f"gov_{u}.bin").exists()}
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump({
            "versao": 1, "quant": esq.QUANT, "packBase": "sim2026",
            "headerBytes": esq.CABECALHO.itemsize,
            "limiarOrigem": esq.LIMIAR_ORIGEM, "maxOrigens": esq.MAX_ORIGENS,
            "ufs": presentes,
        }, f, ensure_ascii=False, indent=1)

    print(f"\n{len(presentes)} UFs no pacote  "
          f"{sum(r['locais'] for r in presentes.values()):,} locais  "
          f"{sum(r['imputados'] for r in presentes.values()):,} imputados")
    return 0


if __name__ == "__main__":
    sys.exit(main())
