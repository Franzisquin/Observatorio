"""Monta a base do Simulador 2026: um pacote binario por UF com o eleitorado de
2026 e a composicao demografica de cada local de votacao.

Entradas
    scratch/eleitorado/2026/agregado/eleitorado_2026_<UF>.parquet  (gerar_eleitorado_2026.py)
    scratch/eleitorado/2026/eleitorado_local_votacao_2026.zip      (coordenadas 2026)
    resultados_geo/presidente_por_estado2022/presidente_<UF>_2022.geojson  (via zip_index)
    resultados_geo/locais_votacao_2022/locais_votacao_2022_<UF>.geojson    (Censo por local)
    resultados_geo/religiao_municipios.json

Saidas
    resultados_geo/sim2026/locais_<UF>.bin
    resultados_geo/sim2026/locais_<UF>.geojson
    resultados_geo/sim2026/index.json
    resultados_geo/sim2026/manifest.json

A chave de casamento 2022<->2026 e a natural do TSE — (CD_MUNICIPIO, NR_ZONA,
NR_LOCAL_VOTACAO). O `local_id` inteiro dos GeoJSON e sintetico do repo e nao
existe nos dados de 2026.

O pacote NAO guarda votos de 2026: guarda a *composicao* de cada local,
inclusive a dimensao voto2022 (quanto do eleitorado de 2026 daquele local
corresponde a cada comportamento de 2022). A superficie de votos e montada em
tempo de execucao aplicando a matriz de transferencia sobre essa composicao —
e o que mantem a migracao de 2022 como pilar sem chumbar candidatos no dado.

Locais de 2026 que nao existiam em 2022 nao tem historico eleitoral. Eles sao
imputados por *donor matching* demografico: os K locais casados mais parecidos
da mesma UF, no espaco das fracoes do TSE (padronizadas), com peso por kernel
softmax da distancia.

    python scripts/gerar_base_2026.py --uf AC
    python scripts/gerar_base_2026.py
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import schema_sim2026 as esq  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
GEO = RAIZ / "resultados_geo"
AGREGADO = RAIZ / "scratch" / "eleitorado" / "2026" / "agregado"
BRUTOS = RAIZ / "scratch" / "eleitorado" / "2026"
SAIDA = GEO / "sim2026"

DIMS_TSE = ["sexo", "idade", "escolaridade", "estado_civil", "deficiencia"]
K_DOADORES = 10

# Cabecalho do registro .bin, antes das fracoes (ver index.json / sim_ei_worker.js).
CABECALHO = np.dtype([
    ("cd_municipio", "<u4"), ("cod_ibge", "<u4"), ("nr_zona", "<u2"),
    ("nr_locvot", "<u2"), ("aptos", "<u4"), ("flags", "u1"), ("_pad", "u1"),
])


# ------------------------------------------------------------------ leitura

_INDICE_ZIP: dict | None = None


def ler_geojson(caminho: str) -> dict | None:
    """Le um GeoJSON de dentro dos zips de resultados_geo, como o fetchGeoJSON do front."""
    global _INDICE_ZIP
    if _INDICE_ZIP is None:
        with open(GEO / "zip_index.json", encoding="utf-8") as f:
            _INDICE_ZIP = json.load(f)
    entrada = _INDICE_ZIP.get(caminho)
    if entrada:
        with zipfile.ZipFile(GEO / entrada["zip"]) as zf:
            nome = entrada["file"]
            if nome not in zf.namelist():
                alvo = nome.lower()
                nome = next((n for n in zf.namelist() if n.lower() == alvo), None)
                if nome is None:
                    return None
            with zf.open(nome) as f:
                return json.load(io.TextIOWrapper(f, "utf-8"))
    solto = GEO / caminho
    if solto.exists():
        with open(solto, encoding="utf-8") as f:
            return json.load(f)
    return None


def achar_chave(props: dict, prefixo: str, sufixo: str) -> str | None:
    """Acha uma propriedade por prefixo+sufixo.

    Os GeoJSON de 2022 guardam os nomes dos candidatos como texto cp1252 mal
    decodificado ("JAIR BOLSONARO (PL) (N�O ELEITO) 2T"), entao casar a
    string inteira e fragil. Prefixo e sufixo caem so na parte sem acento.
    """
    for k in props:
        if k.startswith(prefixo) and k.endswith(sufixo):
            return k
    return None


def num(v) -> float:
    try:
        f = float(v)
        return f if np.isfinite(f) else 0.0
    except (TypeError, ValueError):
        return 0.0


# --------------------------------------------------------- fontes auxiliares

def carregar_religiao() -> dict[int, list[float]]:
    with open(GEO / "religiao_municipios.json", encoding="utf-8") as f:
        bruto = json.load(f)
    fora = {}
    for cod, r in bruto.items():
        v = [num(r.get("pct_rel_catolica")), num(r.get("pct_rel_evangelica")),
             num(r.get("pct_rel_outras")), num(r.get("pct_rel_sem_religiao"))]
        if sum(v) > 0:
            fora[int(cod)] = v
    return fora


def coords_2026(uf: str) -> dict[tuple[int, int, int], tuple[float, float]]:
    """(municipio, zona, local) -> (long, lat) a partir do registro de locais de 2026."""
    caminho = BRUTOS / "eleitorado_local_votacao_2026.zip"
    if not caminho.exists():
        return {}
    fora: dict[tuple[int, int, int], tuple[float, float]] = {}
    try:
        zf = zipfile.ZipFile(caminho)
    except zipfile.BadZipFile:
        # Download ainda em andamento: caimos para as coordenadas do gemeo de 2022.
        print("  . registro de locais 2026 incompleto — usando coordenadas de 2022")
        return {}
    with zf:
        nome = next((n for n in zf.namelist() if n.lower().endswith(".csv")), None)
        if nome is None:
            return {}
        with zf.open(nome) as bruto:
            leitor = csv.DictReader(io.TextIOWrapper(bruto, "latin-1", newline=""), delimiter=";")
            for linha in leitor:
                if linha.get("SG_UF") != uf:
                    continue
                try:
                    chave = (int(linha["CD_MUNICIPIO"]), int(linha["NR_ZONA"]),
                             int(linha["NR_LOCAL_VOTACAO"]))
                except (KeyError, ValueError):
                    continue
                if chave in fora:
                    continue
                lat, lon = num(linha.get("NR_LATITUDE")), num(linha.get("NR_LONGITUDE"))
                # O TSE usa -1 para coordenada ausente.
                if -90 < lat < 90 and -180 < lon < 180 and abs(lat) > 0.01:
                    fora[chave] = (lon, lat)
    return fora


def dados_2022(uf: str) -> tuple[dict, dict]:
    """(por chave natural: composicao voto2022 de 1o turno) e (idem: censo).

    A composicao e do PRIMEIRO turno — [lula, bolsonaro, outros, nulo_branco,
    abstencao] em votos absolutos. "outros" sao todos os demais candidatos
    presidenciais somados (Ciro, Tebet, ...), que sao o eleitorado mais
    disputado em 2026 e desaparecem se usarmos o 2o turno.
    """
    pres = ler_geojson(f"presidente_por_estado2022/presidente_{uf}_2022.geojson")
    locs = ler_geojson(f"locais_votacao_2022/locais_votacao_2022_{uf}.geojson")

    voto: dict[tuple[int, int, int], list[float]] = {}
    if pres:
        for f in pres["features"]:
            p = f["properties"]
            try:
                chave = (int(p["CD_MUNICIPIO"]), int(float(p["NR_ZONA"])),
                         int(p["NR_LOCAL_VOTACAO"]))
            except (KeyError, TypeError, ValueError):
                continue
            aptos = num(p.get("Eleitores_Aptos 1T")) or num(p.get("Eleitores_Aptos 2T"))
            if aptos <= 0:
                continue
            k_lula = achar_chave(p, "LULA (PT)", " 1T")
            k_bolso = achar_chave(p, "JAIR BOLSONARO (PL)", " 1T")
            if not (k_lula and k_bolso):
                continue
            lula, bolso = num(p.get(k_lula)), num(p.get(k_bolso))
            validos = num(p.get(achar_chave(p, "Total_Votos_Validos", " 1T") or ""))
            outros = max(0.0, validos - lula - bolso)
            nulo_branco = (num(p.get(achar_chave(p, "Votos_Brancos", " 1T") or ""))
                           + num(p.get(achar_chave(p, "Votos_Nulos", " 1T") or "")))
            abstencao = num(p.get(achar_chave(p, "Absten", " 1T") or ""))
            if abstencao <= 0:
                abstencao = max(0.0, aptos - validos - nulo_branco)
            voto[chave] = [lula, bolso, outros, nulo_branco, abstencao]

    censo: dict[tuple[int, int, int], dict] = {}
    if locs:
        for f in locs["features"]:
            p = f["properties"]
            try:
                chave = (int(p["cd_localidade_tse"]), int(float(p["NR_ZONA"])),
                         int(p["nr_locvot"]))
            except (KeyError, TypeError, ValueError):
                continue
            censo[chave] = {
                "ibge": int(num(p.get("cod_localidade_ibge"))),
                "raca": [num(p.get("Pct Branca")), num(p.get("Pct Preta")),
                         num(p.get("Pct Parda")), num(p.get("Pct Amarela")),
                         num(p.get("Pct Indigena"))],
                "renda": num(p.get("Renda Media")),
                "lonlat": (num(p.get("long")), num(p.get("lat"))),
            }
    return voto, censo


def redutos_da_uf(uf: str) -> dict[str, dict[tuple[int, int, int], float]]:
    """Votacao de governador 2022 (1o turno) dos politicos configurados em
    esq.REDUTOS, por local, como fracao dos eleitores aptos.

    E isso que permite ao simulador concentrar Zema em MG e Caiado em GO nos
    municipios onde cada um foi forte para o governo, em vez de espalha-los
    uniformemente pelo estado como faria a migracao presidencial sozinha.
    """
    alvos = [r for r in esq.REDUTOS if r["uf"] == uf]
    if not alvos:
        return {}
    gov = ler_geojson(f"governador2022/governador_{uf}_2022.geojson")
    if not gov:
        print(f"  ! {uf}: governador2022 nao encontrado — redutos ficam vazios")
        return {}

    fora = {r["chave"]: {} for r in alvos}
    achou = {r["chave"]: 0 for r in alvos}
    for f in gov["features"]:
        p = f["properties"]
        try:
            chave = (int(p["CD_MUNICIPIO"]), int(float(p["NR_ZONA"])),
                     int(p["NR_LOCAL_VOTACAO"]))
        except (KeyError, TypeError, ValueError):
            continue
        aptos = num(p.get("Eleitores_Aptos 1T"))
        if aptos <= 0:
            continue
        for r in alvos:
            k = achar_chave(p, r["prefixo"], " 1T")
            if not k:
                continue
            fora[r["chave"]][chave] = num(p.get(k)) / aptos
            achou[r["chave"]] += 1
    for r in alvos:
        if not achou[r["chave"]]:
            print(f"  ! {uf}: nenhuma coluna casou com '{r['prefixo']}' no governador de 2022")
    return fora


# ------------------------------------------------------------- normalizacao

def normalizar(bloco: np.ndarray) -> np.ndarray:
    """Linhas -> somam 1. Linha toda zero fica zero (dimensao sem informacao)."""
    soma = bloco.sum(axis=1, keepdims=True)
    fora = np.zeros_like(bloco, dtype=np.float64)
    ok = soma[:, 0] > 0
    fora[ok] = bloco[ok] / soma[ok]
    return fora


def quantizar(frac: np.ndarray) -> np.ndarray:
    """float 0..1 -> u8 0..QUANT, com maior-resto para a soma bater exatamente."""
    n, k = frac.shape
    fora = np.zeros((n, k), dtype=np.uint8)
    ativo = frac.sum(axis=1) > 0
    if not ativo.any():
        return fora
    escalado = frac[ativo] * esq.QUANT
    piso = np.floor(escalado).astype(np.int32)
    resto = escalado - piso
    falta = esq.QUANT - piso.sum(axis=1)
    for i in range(piso.shape[0]):
        f = int(falta[i])
        if f > 0:
            for j in np.argsort(-resto[i])[:f]:
                piso[i, j] += 1
        elif f < 0:
            for j in np.argsort(resto[i])[:-f]:
                piso[i, j] = max(0, piso[i, j] - 1)
    fora[ativo] = np.clip(piso, 0, 255).astype(np.uint8)
    return fora


# ---------------------------------------------------------------- principal

def processar_uf(uf: str, religiao: dict, saida: Path) -> dict:
    df = pd.read_parquet(AGREGADO / f"eleitorado_2026_{uf}.parquet")
    n = len(df)
    voto22, censo22 = dados_2022(uf)
    redutos22 = redutos_da_uf(uf)
    coords = coords_2026(uf)
    n_orig = len(next(d for d in esq.DIMENSOES if d["chave"] == "voto2022")["buckets"])

    chaves = list(zip(df["cd_municipio"].astype(int), df["nr_zona"].astype(int),
                      df["nr_locvot"].astype(int)))
    aptos = df["aptos"].to_numpy(dtype=np.float64)

    # --- dimensoes do TSE: contagem -> fracao ---
    blocos: dict[str, np.ndarray] = {}
    for d in esq.DIMENSOES:
        if d["chave"] not in DIMS_TSE:
            continue
        cols = [f"{d['chave']}|{b[0]}" for b in d["buckets"]]
        blocos[d["chave"]] = normalizar(df[cols].to_numpy(dtype=np.float64))

    # --- municipio: codigo IBGE (o TSE so da o codigo dele) ---
    tse_para_ibge: dict[int, int] = {}
    for (mun, _z, _l), c in censo22.items():
        if c["ibge"] and mun not in tse_para_ibge:
            tse_para_ibge[mun] = c["ibge"]
    ibge = np.array([tse_para_ibge.get(m, 0) for m, _, _ in chaves], dtype=np.int64)

    # --- casamento com 2022 ---
    casado = np.zeros(n, dtype=bool)
    voto = np.zeros((n, n_orig), dtype=np.float64)
    raca = np.zeros((n, 5), dtype=np.float64)
    renda_media = np.zeros(n, dtype=np.float64)
    reduto = np.zeros((n, esq.n_redutos()), dtype=np.float64)
    lonlat: list[tuple[float, float] | None] = [None] * n
    ordem_redutos = [r["chave"] for r in esq.REDUTOS]

    for i, chave in enumerate(chaves):
        v = voto22.get(chave)
        c = censo22.get(chave)
        if v is not None:
            voto[i] = v
            casado[i] = True
        if c is not None:
            raca[i] = c["raca"]
            renda_media[i] = c["renda"]
            if c["lonlat"][0]:
                lonlat[i] = c["lonlat"]
        if chave in coords:
            lonlat[i] = coords[chave]
        for j, rk in enumerate(ordem_redutos):
            if rk in redutos22:
                reduto[i, j] = redutos22[rk].get(chave, 0.0)

    # --- imputacao dos locais novos por donor matching demografico ---
    # Espaco de busca: as fracoes do TSE (disponiveis para TODO local de 2026)
    # padronizadas, mais log(aptos) para nao casar uma escola de 3 mil eleitores
    # com uma sala de 80.
    perfil = np.hstack([blocos[d] for d in DIMS_TSE] + [np.log1p(aptos)[:, None]])
    mu, sd = perfil.mean(axis=0), perfil.std(axis=0)
    sd[sd < 1e-9] = 1.0
    perfil = (perfil - mu) / sd

    doadores = np.flatnonzero(casado)
    novos = np.flatnonzero(~casado)
    imputados = 0
    if len(novos) and len(doadores):
        for i in novos:
            dist = np.linalg.norm(perfil[doadores] - perfil[i], axis=1)
            k = min(K_DOADORES, len(doadores))
            viz = doadores[np.argpartition(dist, k - 1)[:k]]
            d = np.linalg.norm(perfil[viz] - perfil[i], axis=1)
            # Kernel softmax com escala igual a distancia mediana: adapta-se a
            # UFs densas e esparsas sem constante magica.
            escala = max(np.median(d), 1e-6)
            w = np.exp(-d / escala)
            w /= w.sum()
            # Participacoes (nao votos absolutos): o local novo tem eleitorado proprio.
            part = voto[viz] / np.maximum(voto[viz].sum(axis=1, keepdims=True), 1e-9)
            voto[i] = part.T @ w
            if raca[i].sum() <= 0:
                raca[i] = raca[viz].T @ w
            if renda_media[i] <= 0:
                renda_media[i] = float(renda_media[viz] @ w)
            # O reduto tambem e herdado: um local novo dentro de um municipio
            # forte do Zema deve continuar forte para ele.
            if esq.n_redutos() and reduto[i].sum() <= 0:
                reduto[i] = reduto[viz].T @ w
            if lonlat[i] is None:
                cand = [j for j in viz if lonlat[j] is not None]
                if cand:
                    lonlat[i] = lonlat[cand[0]]
            imputados += 1

    # --- dimensoes de base "pop" ---
    blocos["raca"] = normalizar(raca)

    bloco_renda = np.zeros((n, 5), dtype=np.float64)
    idx_renda = {b[0]: j for j, b in enumerate(
        next(d for d in esq.DIMENSOES if d["chave"] == "renda")["buckets"])}
    for i in range(n):
        if renda_media[i] > 0:
            bloco_renda[i, idx_renda[esq.bucket_renda(renda_media[i])]] = 1.0
    blocos["renda"] = bloco_renda

    bloco_rel = np.zeros((n, 4), dtype=np.float64)
    for i in range(n):
        r = religiao.get(int(ibge[i]))
        if r:
            bloco_rel[i] = r
    blocos["religiao"] = normalizar(bloco_rel)

    blocos["voto2022"] = normalizar(voto)

    # --- montagem do pacote ---
    fracs = np.hstack([quantizar(blocos[d["chave"]]) for d in esq.DIMENSOES])
    assert fracs.shape[1] == esq.n_buckets(), (fracs.shape, esq.n_buckets())

    # Redutos: fracao dos aptos, quantizada independentemente (nao e uma
    # composicao, entao nao passa por `quantizar`, que normaliza a linha).
    reduto_q = np.clip(np.round(reduto * esq.QUANT), 0, 255).astype(np.uint8) \
        if esq.n_redutos() else np.zeros((n, 0), dtype=np.uint8)

    cab = np.zeros(n, dtype=CABECALHO)
    cab["cd_municipio"] = [m for m, _, _ in chaves]
    cab["cod_ibge"] = np.maximum(ibge, 0)
    cab["nr_zona"] = [z for _, z, _ in chaves]
    cab["nr_locvot"] = [l for _, _, l in chaves]
    cab["aptos"] = aptos.astype(np.uint32)
    cab["flags"] = (~casado).astype(np.uint8)  # bit 0 = imputado

    saida.mkdir(parents=True, exist_ok=True)
    with open(saida / f"locais_{uf}.bin", "wb") as f:
        f.write(np.hstack([cab.view(np.uint8).reshape(n, -1), fracs, reduto_q]).tobytes())

    # --- geojson leve so para desenhar o mapa ---
    feicoes = []
    for i in range(n):
        pos = lonlat[i]
        if pos is None:
            continue
        feicoes.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(pos[0], 6), round(pos[1], 6)]},
            "properties": {
                "i": i, "mun": int(cab["cd_municipio"][i]), "ibge": int(cab["cod_ibge"][i]),
                "z": int(cab["nr_zona"][i]), "l": int(cab["nr_locvot"][i]),
                "nm": df["nm_locvot"].iloc[i], "nm_mun": df["nm_municipio"].iloc[i],
                "aptos": int(cab["aptos"][i]), "imp": int(cab["flags"][i]),
            },
        })
    with open(saida / f"locais_{uf}.geojson", "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": feicoes}, f, ensure_ascii=False)

    sem_geo = n - len(feicoes)
    sem_religiao = int((bloco_rel.sum(axis=1) == 0).sum())
    sem_ibge = int((ibge <= 0).sum())
    print(f"  {uf}: {n:5,} locais  {int(aptos.sum()):>10,} eleitores  "
          f"casados={int(casado.sum()):5,} ({casado.mean():5.1%})  imputados={imputados:4,}  "
          f"sem_geo={sem_geo:4,}  sem_religiao={sem_religiao:4,}")
    if casado.mean() < 0.70:
        print(f"  ! {uf}: casamento abaixo de 70% — conferir a chave natural")
    if sem_ibge:
        # Sem codigo IBGE o local nao entra em nenhum municipio na agregacao
        # do worker; o total nacional continua certo, o municipal nao.
        print(f"  ! {uf}: {sem_ibge} locais sem codigo IBGE "
              f"({int(aptos[ibge <= 0].sum()):,} eleitores fora da agregacao municipal)")

    for j, rk in enumerate(ordem_redutos):
        if reduto[:, j].sum() > 0:
            top = np.argsort(-reduto[:, j])[:1]
            print(f"    reduto '{rk}': {(reduto[:, j] > 0).sum():,} locais, "
                  f"maximo {100 * reduto[top, j][0]:.1f}% dos aptos")

    return {
        "uf": uf, "locais": n, "aptos": int(aptos.sum()),
        "casados": int(casado.sum()), "imputados": imputados,
        "sem_geometria": sem_geo, "sem_religiao": sem_religiao, "sem_ibge": sem_ibge,
        "locais_2022_nao_reencontrados": len(voto22) - int(casado.sum()),
        # Composicao de 2022 (1T) agregada, para preencher os pesos regionais.
        "_voto2022": (blocos["voto2022"] * aptos[:, None]).sum(axis=0).tolist(),
        "_ibge": ibge, "_aptos": aptos, "_voto_abs": blocos["voto2022"] * aptos[:, None],
    }


def gerar_regioes(relatorio: list[dict], saida: Path) -> None:
    """Agrega a composicao de 2022 (1T) por macrorregiao e por regiao
    intermediaria, ja em percentuais — e o que o painel de pesos regionais
    carrega automaticamente para Lula, Bolsonaro, abstencao e nulos/brancos.

    Acumula rodada a rodada, como o manifesto, para que rodar uma UF isolada
    nao apague as demais.
    """
    caminho_reg = RAIZ / "resultados_geo" / "regioes_ibge.json"
    if not caminho_reg.exists():
        print("  ! regioes_ibge.json ausente — agregados regionais nao gerados")
        return
    with open(caminho_reg, encoding="utf-8") as f:
        mapa = json.load(f).get("muni_to_region", {})

    origens = [b[0] for b in next(d for d in esq.DIMENSOES if d["chave"] == "voto2022")["buckets"]]
    arq = saida / "baselines" / "regioes.json"

    # Guardado como bruto[regiao][UF]: uma macrorregiao cruza varias UFs, entao
    # reprocessar uma delas precisa SUBSTITUIR a fatia dela, nao somar de novo.
    bruto: dict[str, dict] = {}
    if arq.exists():
        with open(arq, encoding="utf-8") as f:
            bruto = json.load(f).get("_bruto", {})

    for r in relatorio:
        ibge, aptos, votos = r.get("_ibge"), r.get("_aptos"), r.get("_voto_abs")
        if ibge is None:
            continue
        uf = r["uf"]
        for chave in bruto:            # zera a contribuicao anterior desta UF
            bruto[chave].pop(uf, None)
        for i in range(len(ibge)):
            info = mapa.get(str(int(ibge[i])))
            if not info:
                continue
            for nivel, cod in (("mr", info.get("mr")), ("ri", info.get("ri"))):
                if cod is None:
                    continue
                chave = f"{nivel}:{cod}"
                e = bruto.setdefault(chave, {}).setdefault(
                    uf, {"aptos": 0.0, "votos": [0.0] * len(origens)})
                e["aptos"] += float(aptos[i])
                for p in range(len(origens)):
                    e["votos"][p] += float(votos[i, p])

    fora = {"origens": origens, "regioes": {}, "_bruto": bruto}
    for chave, porUf in bruto.items():
        nivel, cod = chave.split(":", 1)
        ap_ = sum(e["aptos"] for e in porUf.values())
        if ap_ <= 0:
            continue
        votos = [sum(e["votos"][p] for e in porUf.values()) for p in range(len(origens))]
        pct = [100 * v / ap_ for v in votos]
        validos = sum(pct[:3])  # lula + bolsonaro + outros
        ufs = sorted(porUf)
        fora["regioes"][chave] = {
            "nivel": nivel, "codigo": cod, "uf": ufs[0] if len(ufs) == 1 else "",
            "ufs": ufs, "aptos": int(ap_),
            # pct_aptos: fracao do eleitorado. pct_validos: divisao entre candidatos.
            "pct_aptos": {o: round(pct[p], 4) for p, o in enumerate(origens)},
            "pct_validos": {o: round(100 * pct[p] / validos, 4) if validos > 0 else 0.0
                            for p, o in enumerate(origens[:3])},
        }
    (saida / "baselines").mkdir(parents=True, exist_ok=True)
    with open(arq, "w", encoding="utf-8") as f:
        json.dump(fora, f, ensure_ascii=False)
    nmr = sum(1 for k in fora["regioes"] if k.startswith("mr:"))
    nri = sum(1 for k in fora["regioes"] if k.startswith("ri:"))
    print(f"\n  regioes.json: {nmr} macrorregioes, {nri} regioes intermediarias")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--uf", nargs="*", metavar="UF")
    ap.add_argument("--saida", type=Path, default=SAIDA)
    args = ap.parse_args()

    disponiveis = sorted(p.stem.split("_")[-1] for p in AGREGADO.glob("eleitorado_2026_*.parquet"))
    ufs = [u.upper() for u in (args.uf or disponiveis)]
    if not ufs:
        print(f"Nada em {AGREGADO}. Rode gerar_eleitorado_2026.py primeiro.")
        return 1

    religiao = carregar_religiao()
    print(f"Religiao: {len(religiao):,} municipios\nMontando {len(ufs)} UFs:\n")

    relatorio = [processar_uf(uf, religiao, args.saida) for uf in ufs]
    gerar_regioes(relatorio, args.saida)
    # Os arrays auxiliares so servem para o agregado regional acima.
    for r in relatorio:
        for k in ("_ibge", "_aptos", "_voto_abs", "_voto2022"):
            r.pop(k, None)

    # O manifesto acumula as UFs de rodadas anteriores; rodar --uf AC nao pode
    # apagar as outras 26 nem do manifesto nem do index.json.
    caminho_manifesto = args.saida / "manifest.json"
    anterior = {}
    if caminho_manifesto.exists():
        with open(caminho_manifesto, encoding="utf-8") as f:
            anterior = {r["uf"]: r for r in json.load(f).get("ufs", [])}
    anterior.update({r["uf"]: r for r in relatorio})
    # So conta a UF que realmente tem pacote em disco.
    todos = sorted((r for r in anterior.values()
                    if (args.saida / f"locais_{r['uf']}.bin").exists()),
                   key=lambda r: r["uf"])
    with open(caminho_manifesto, "w", encoding="utf-8") as f:
        json.dump({"ufs": todos,
                   "total_locais": sum(r["locais"] for r in todos),
                   "total_aptos": sum(r["aptos"] for r in todos),
                   "total_imputados": sum(r["imputados"] for r in todos)},
                  f, ensure_ascii=False, indent=1)

    indice = esq.para_json()
    indice["headerBytes"] = CABECALHO.itemsize
    indice["recordBytes"] = CABECALHO.itemsize + esq.n_buckets() + esq.n_redutos()
    indice["redutosOffset"] = CABECALHO.itemsize + esq.n_buckets()
    indice["header"] = [{"name": nome, "type": CABECALHO.fields[nome][0].str,
                         "offset": CABECALHO.fields[nome][1]}
                        for nome in CABECALHO.names if not nome.startswith("_")]
    indice["ufs"] = {r["uf"]: r["locais"] for r in todos}
    with open(args.saida / "index.json", "w", encoding="utf-8") as f:
        json.dump(indice, f, ensure_ascii=False, indent=1)

    print(f"\n{sum(r['locais'] for r in relatorio):,} locais  "
          f"{sum(r['aptos'] for r in relatorio):,} eleitores  "
          f"{sum(r['imputados'] for r in relatorio):,} imputados")
    print(f"Registro: {indice['recordBytes']} bytes ({esq.n_buckets()} buckets)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
