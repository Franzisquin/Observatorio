"""Grava a coluna hist_id nos GeoPackages de locais de votacao.

hist_id e a identidade estavel do predio ao longo das eleicoes, calculada por
scripts/gerar_identidade_historico.py. Gravando ela no GPKG, o local que o mapa
desenha passa a carregar a mesma chave que os arquivos resultados_geo/Historico *
usam -- o painel "Historico" vira busca exata em vez de palpite por nome/zona.

Nao mexe em coordenada nenhuma: so ALTER TABLE + UPDATE de uma coluna nova.

O GPKG de 2002 fica de fora de proposito: js/data-geral-2002.js usa a malha de
pontos do GPKG de 2006 para desenhar 2002, e generate_histories.py manda
1998/2000/2004 pelo mesmo caminho. Todos os anos pre-2006 herdam o hist_id de 2006.

Rodar da raiz do repo:  python scripts/gravar_hist_id_gpkg.py
Desfazer:               git checkout -- resultados_geo/
"""

import csv
import gzip
import os
import shutil
import sqlite3
import sys
import tempfile
import zipfile
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from atualizar_locais_geocode_v15 import ALVOS, COPIA_SOLTA_2006, DATA_DIR, chave

CSV_V15 = "version_15_geocode/geocoded_polling_stations.csv"
IDENT = "resultados_geo/identidade_historico.csv.gz"


def carregar_hist_por_chave():
    """{ano: {(ibge, zona, local): hist_id}} -- a mesma chave ja validada para as
    coordenadas, inclusive descartando ibge 0 (que colide entre UFs)."""
    csv.field_size_limit(10 ** 9)
    with gzip.open(IDENT, "rt", encoding="utf-8", newline="") as f:
        hist = {int(r["local_id"]): int(r["hist_id"]) for r in csv.DictReader(f)}

    por_ano = {}
    with open(CSV_V15, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            hid = hist.get(int(r["local_id"]))
            if hid is None:
                continue
            k = chave(r["cod_localidade_ibge"], r["nr_zona"], r["nr_locvot"])
            if k is None:
                continue
            por_ano.setdefault(int(r["ano"]), {})[k] = hid
    return por_ano


def gravar(caminho, tabela, mapa):
    con = sqlite3.connect(caminho)
    con.execute("PRAGMA journal_mode=DELETE")

    colunas = {c[1] for c in con.execute(f"PRAGMA table_info({tabela})")}
    if "hist_id" not in colunas:
        con.execute(f"ALTER TABLE {tabela} ADD COLUMN hist_id INTEGER")

    updates = []
    c = Counter()
    for fid, ibge, zo, l in con.execute(
            f"SELECT fid, cod_localidade_ibge, nr_zona, nr_locvot FROM {tabela}"):
        k = chave(ibge, zo, l)
        hid = mapa.get(k) if k else None
        if hid is None:
            c["sem_identidade"] += 1
            continue
        updates.append((hid, fid))
    con.executemany(f"UPDATE {tabela} SET hist_id=? WHERE fid=?", updates)
    con.commit()
    con.execute("VACUUM")
    con.close()
    return len(updates), c["sem_identidade"]


def main():
    if not os.path.exists(IDENT):
        raise SystemExit(f"{IDENT} nao existe -- rode gerar_identidade_historico.py antes.")

    print(f"lendo {IDENT} ...")
    por_ano = carregar_hist_por_chave()

    with tempfile.TemporaryDirectory() as tmpdir:
        for ano, nome_zip, tabela in ALVOS:
            caminho_zip = os.path.join(DATA_DIR, nome_zip)
            with zipfile.ZipFile(caminho_zip) as z:
                entrada = next(n for n in z.namelist() if n.lower().endswith(".gpkg"))
                destino = os.path.join(tmpdir, entrada)
                with open(destino, "wb") as f:
                    f.write(z.read(entrada))

            gravadas, sem = gravar(destino, tabela, por_ano.get(ano, {}))

            with zipfile.ZipFile(caminho_zip, "w", zipfile.ZIP_DEFLATED) as z:
                z.write(destino, entrada)
            if entrada == COPIA_SOLTA_2006:
                shutil.copyfile(destino, os.path.join(DATA_DIR, COPIA_SOLTA_2006))

            total = gravadas + sem
            print(f"{nome_zip:<48} {total:>6} linhas | com hist_id {gravadas:>6}"
                  f" ({100.0*gravadas/total:>4.1f}%) | sem {sem:>5}")

    print("\nPronto. Para desfazer: git checkout -- resultados_geo/")


if __name__ == "__main__":
    sys.exit(main())
