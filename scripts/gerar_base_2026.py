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
    """(por chave natural: composicao voto2022) e (por chave natural: censo)."""
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
            aptos = num(p.get("Eleitores_Aptos 2T")) or num(p.get("Eleitores_Aptos 1T"))
            if aptos <= 0:
                continue
            k_lula = achar_chave(p, "LULA (PT)", " 2T")
            k_bolso = achar_chave(p, "JAIR BOLSONARO (PL)", " 2T")
            k_abs = achar_chave(p, "Absten", " 2T")
            k_br = achar_chave(p, "Votos_Brancos", " 2T")
            k_nu = achar_chave(p, "Votos_Nulos", " 2T")
            if not (k_lula and k_bolso):  # sem 2o turno gravado, cai para o 1o
                k_lula = achar_chave(p, "LULA (PT)", " 1T")
                k_bolso = achar_chave(p, "JAIR BOLSONARO (PL)", " 1T")
                k_abs = achar_chave(p, "Absten", " 1T")
                k_br = achar_chave(p, "Votos_Brancos", " 1T")
                k_nu = achar_chave(p, "Votos_Nulos", " 1T")
                aptos = num(p.get("Eleitores_Aptos 1T")) or aptos
            if not (k_lula and k_bolso):
                continue
            lula, bolso = num(p.get(k_lula)), num(p.get(k_bolso))
            nulo_branco = num(p.get(k_br)) + num(p.get(k_nu))
            abstencao = num(p.get(k_abs))
            if abstencao <= 0:
                abstencao = max(0.0, aptos - lula - bolso - nulo_branco)
            voto[chave] = [lula, bolso, nulo_branco, abstencao]

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
    coords = coords_2026(uf)

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
    voto = np.zeros((n, 4), dtype=np.float64)
    raca = np.zeros((n, 5), dtype=np.float64)
    renda_media = np.zeros(n, dtype=np.float64)
    lonlat: list[tuple[float, float] | None] = [None] * n

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

    cab = np.zeros(n, dtype=CABECALHO)
    cab["cd_municipio"] = [m for m, _, _ in chaves]
    cab["cod_ibge"] = np.maximum(ibge, 0)
    cab["nr_zona"] = [z for _, z, _ in chaves]
    cab["nr_locvot"] = [l for _, _, l in chaves]
    cab["aptos"] = aptos.astype(np.uint32)
    cab["flags"] = (~casado).astype(np.uint8)  # bit 0 = imputado

    saida.mkdir(parents=True, exist_ok=True)
    with open(saida / f"locais_{uf}.bin", "wb") as f:
        f.write(np.hstack([cab.view(np.uint8).reshape(n, -1), fracs]).tobytes())

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

    return {
        "uf": uf, "locais": n, "aptos": int(aptos.sum()),
        "casados": int(casado.sum()), "imputados": imputados,
        "sem_geometria": sem_geo, "sem_religiao": sem_religiao, "sem_ibge": sem_ibge,
        "locais_2022_nao_reencontrados": len(voto22) - int(casado.sum()),
    }


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
    indice["recordBytes"] = CABECALHO.itemsize + esq.n_buckets()
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
