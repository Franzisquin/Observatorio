"""Agrega o perfil do eleitorado 2026 do TSE de secao para local de votacao.

Entrada : scratch/eleitorado/2026/perfil_eleitor_secao_2026_<UF>.zip
Saida   : scratch/eleitorado/2026/agregado/eleitorado_2026_<UF>.parquet

Uma linha por local de votacao, com a chave natural que casa com os GeoJSON de
2022 do repo — (SG_UF, CD_MUNICIPIO, NR_ZONA, NR_LOCAL_VOTACAO). O `local_id`
inteiro dos GeoJSON e sintetico do proprio repo e nao existe nos dados do TSE,
entao nao serve de chave aqui.

O CSV e um cruzamento completo: uma linha por celula
(local x secao x sexo x estado civil x faixa etaria x escolaridade x raca x ...).
AC tem 380 mil linhas / 90 MB; SP passa de 6 GB descomprimido. Por isso a
leitura e feita em blocos e cada bloco ja e colapsado por (local, bucket) antes
de acumular — o que reduz milhoes de linhas a poucas centenas de milhares.

    python scripts/gerar_eleitorado_2026.py --uf AC
    python scripts/gerar_eleitorado_2026.py
"""

from __future__ import annotations

import argparse
import io
import sys
import time
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import schema_sim2026 as esq  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
ORIGEM = RAIZ / "scratch" / "eleitorado" / "2026"
DESTINO = ORIGEM / "agregado"

BLOCO = 1_000_000  # linhas por leitura

COLUNAS = [
    "CD_MUNICIPIO", "NM_MUNICIPIO", "NR_ZONA", "NR_LOCAL_VOTACAO", "NM_LOCAL_VOTACAO",
    "CD_GENERO", "CD_ESTADO_CIVIL", "CD_FAIXA_ETARIA", "CD_GRAU_ESCOLARIDADE",
    "QT_ELEITORES", "QT_ELEITORES_DEFICIENCIA",
]

# Dimensoes construidas aqui (as de base "pop" entram em gerar_base_2026.py).
DIMS_TSE = ["sexo", "idade", "escolaridade", "estado_civil", "deficiencia"]


def _colunas_bucket() -> list[str]:
    fora = []
    for d in esq.DIMENSOES:
        if d["chave"] in DIMS_TSE:
            fora += [f"{d['chave']}|{b[0]}" for b in d["buckets"]]
    return fora


def _mapear(codigos: pd.Series, tabela: dict) -> pd.Series:
    return codigos.map(tabela)


def processar_uf(uf: str, origem: Path, destino: Path) -> pd.DataFrame:
    zip_path = origem / f"perfil_eleitor_secao_2026_{uf}.zip"
    if not zip_path.exists():
        raise FileNotFoundError(f"{zip_path} — rode baixar_perfil_eleitorado_2026.py primeiro")

    cols_bucket = _colunas_bucket()
    # (chave do local) -> vetor de contagens por bucket, acumulado bloco a bloco.
    partes: list[pd.DataFrame] = []
    nomes: dict[int, tuple[str, str, str]] = {}
    total_linhas = 0
    inicio = time.time()

    with zipfile.ZipFile(zip_path) as zf:
        nome_csv = next(n for n in zf.namelist() if n.lower().endswith(".csv"))
        with zf.open(nome_csv) as bruto:
            texto = io.TextIOWrapper(bruto, encoding="latin-1", newline="")
            leitor = pd.read_csv(
                texto, sep=";", usecols=COLUNAS, chunksize=BLOCO,
                dtype={"CD_MUNICIPIO": "int32", "NR_ZONA": "int32",
                       "NR_LOCAL_VOTACAO": "int32", "CD_GENERO": "int16",
                       "CD_ESTADO_CIVIL": "int16", "CD_FAIXA_ETARIA": "int32",
                       "CD_GRAU_ESCOLARIDADE": "int16", "QT_ELEITORES": "int32",
                       "QT_ELEITORES_DEFICIENCIA": "int32"},
            )
            for bloco in leitor:
                total_linhas += len(bloco)
                # Chave compacta do local: municipio(5) zona(4) local(5).
                chave = (bloco["CD_MUNICIPIO"].astype("int64") * 1_000_000_000
                         + bloco["NR_ZONA"].astype("int64") * 100_000
                         + bloco["NR_LOCAL_VOTACAO"].astype("int64"))
                bloco = bloco.assign(_k=chave)

                for k, nm_mun, nm_loc in zip(
                    bloco["_k"].to_numpy(), bloco["NM_MUNICIPIO"].to_numpy(),
                    bloco["NM_LOCAL_VOTACAO"].to_numpy()
                ):
                    if k not in nomes:
                        nomes[k] = (nm_mun, nm_loc)

                qt = bloco["QT_ELEITORES"]
                pedacos = []
                for dim, coluna, tabela in (
                    ("sexo", "CD_GENERO", esq.BUCKET_SEXO),
                    ("estado_civil", "CD_ESTADO_CIVIL", esq.BUCKET_ESTADO_CIVIL),
                    ("escolaridade", "CD_GRAU_ESCOLARIDADE", esq.BUCKET_ESCOLARIDADE),
                ):
                    b = _mapear(bloco[coluna], tabela)
                    ok = b.notna()
                    pedacos.append(pd.DataFrame({
                        "_k": bloco["_k"][ok], "col": dim + "|" + b[ok], "q": qt[ok]}))

                b = bloco["CD_FAIXA_ETARIA"].map(esq.bucket_idade)
                ok = b.notna()
                pedacos.append(pd.DataFrame({
                    "_k": bloco["_k"][ok], "col": "idade|" + b[ok], "q": qt[ok]}))

                # Deficiencia nao e uma dimensao do cruzamento: e uma contagem
                # dentro da celula. "sem" sai por diferenca contra QT_ELEITORES.
                defi = bloco["QT_ELEITORES_DEFICIENCIA"]
                pedacos.append(pd.DataFrame({
                    "_k": bloco["_k"], "col": "deficiencia|com", "q": defi}))
                pedacos.append(pd.DataFrame({
                    "_k": bloco["_k"], "col": "deficiencia|sem", "q": qt - defi}))
                # aptos: total real do local, incluindo celulas com codigo invalido
                pedacos.append(pd.DataFrame({"_k": bloco["_k"], "col": "aptos", "q": qt}))

                longo = pd.concat(pedacos, ignore_index=True)
                partes.append(longo.groupby(["_k", "col"], sort=False, observed=True)["q"].sum()
                              .reset_index())

                print(f"    {uf}: {total_linhas:,} linhas  ({time.time()-inicio:.0f}s)",
                      flush=True)

    longo = pd.concat(partes, ignore_index=True)
    longo = longo.groupby(["_k", "col"], sort=False, observed=True)["q"].sum().reset_index()
    largo = longo.pivot(index="_k", columns="col", values="q").fillna(0)

    for c in cols_bucket + ["aptos"]:
        if c not in largo.columns:
            largo[c] = 0
    largo = largo[["aptos"] + cols_bucket].astype("int64").reset_index()

    largo["sg_uf"] = uf
    largo["cd_municipio"] = (largo["_k"] // 1_000_000_000).astype("int32")
    largo["nr_zona"] = ((largo["_k"] // 100_000) % 10_000).astype("int32")
    largo["nr_locvot"] = (largo["_k"] % 100_000).astype("int32")
    largo["nm_municipio"] = [nomes[k][0] for k in largo["_k"]]
    largo["nm_locvot"] = [nomes[k][1] for k in largo["_k"]]
    largo = largo.drop(columns="_k")

    ordem = ["sg_uf", "cd_municipio", "nm_municipio", "nr_zona", "nr_locvot",
             "nm_locvot", "aptos"] + cols_bucket
    largo = largo[ordem].sort_values(["cd_municipio", "nr_zona", "nr_locvot"]).reset_index(drop=True)

    destino.mkdir(parents=True, exist_ok=True)
    saida = destino / f"eleitorado_2026_{uf}.parquet"
    largo.to_parquet(saida, index=False)

    # --- verificacoes ---
    aptos = int(largo["aptos"].sum())
    print(f"  {uf}: {len(largo):,} locais  {aptos:,} eleitores  "
          f"({total_linhas:,} celulas, {time.time()-inicio:.0f}s) -> {saida.name}")
    if (largo["aptos"] <= 0).any():
        print(f"  ! {uf}: {(largo['aptos'] <= 0).sum()} locais com aptos <= 0")
    for d in esq.DIMENSOES:
        if d["chave"] not in DIMS_TSE:
            continue
        cols = [f"{d['chave']}|{b[0]}" for b in d["buckets"]]
        soma = largo[cols].sum(axis=1)
        # A dimensao pode somar menos que aptos quando ha codigos invalidos; o
        # que nao pode e somar mais, nem faltar em um local inteiro.
        if (soma > largo["aptos"] * 1.0001).any():
            print(f"  ! {uf}/{d['chave']}: soma dos buckets excede aptos em "
                  f"{(soma > largo['aptos'] * 1.0001).sum()} locais")
        vazios = int((soma == 0).sum())
        if vazios:
            print(f"  . {uf}/{d['chave']}: {vazios} locais sem informacao")
        perda = 1 - soma.sum() / max(aptos, 1)
        if perda > 0.005:
            print(f"  . {uf}/{d['chave']}: {perda:.2%} dos eleitores sem codigo valido")
    return largo


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--uf", nargs="*", metavar="UF")
    ap.add_argument("--origem", type=Path, default=ORIGEM)
    ap.add_argument("--destino", type=Path, default=DESTINO)
    args = ap.parse_args()

    disponiveis = sorted(p.stem.split("_")[-1] for p in args.origem.glob("perfil_eleitor_secao_2026_*.zip"))
    ufs = [u.upper() for u in (args.uf or disponiveis)]
    if not ufs:
        print(f"Nenhum zip em {args.origem}. Rode baixar_perfil_eleitorado_2026.py.")
        return 1

    print(f"Agregando {len(ufs)} UFs: {', '.join(ufs)}\n")
    total = 0
    for uf in ufs:
        try:
            df = processar_uf(uf, args.origem, args.destino)
            total += int(df["aptos"].sum())
        except FileNotFoundError as err:
            print(f"  ! {err}")
    print(f"\nEleitorado agregado: {total:,}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
