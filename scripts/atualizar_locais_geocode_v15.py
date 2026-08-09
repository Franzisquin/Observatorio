"""Melhora as coordenadas dos locais de votacao com o geocode v0.15.

O site le a posicao de cada local de UM lugar so: os GeoPackages em
resultados_geo/locais_votacao_YYYY_g?pg.zip (os data-*.js fazem
"SELECT ... long, lat FROM <tabela>"). Nenhum arquivo de resultado, Censo ou
Historico guarda coordenada, entao mexer aqui e a atualizacao inteira -- nao ha
nada a mudar no JavaScript.

POR QUE NAO E SO COPIAR A v0.15
-------------------------------
A coluna long/lat do release traz a coordenada oficial do TSE **so no ano em que
o TSE mediu**; nos demais anos entrega a previsao do modelo. Como o TSE so passou
a publicar coordenada em 2018, copiar a v0.15 por cima deixaria 2006-2016 com
0% de coordenada medida -- enquanto o acervo do site JA tinha 45-55% desses anos
com a medicao oficial, propagada dos anos posteriores pela identidade da urna.
Medido contra ancora do TSE fora da amostra, copiar tudo piorava 2006 a 2020.

Alem disso, no subconjunto em que nenhum dos dois lados tem medicao (modelo velho
contra modelo novo, 80 mil locais de 2006-2014), o modelo ANTIGO acerta mais:
mediana de erro 105 m contra 186 m, e a v0.15 so e melhor em 23,5% dos locais.

REGRA ADOTADA -- so escreve o que e comprovadamente melhor
---------------------------------------------------------
  1. medida propria    o local tem coordenada oficial do TSE no proprio ano
                       -> escreve
  2. medida propagada   o local nao tem, mas a MESMA urna (panel_id da v0.15)
                       tem coordenada oficial em outro ano -> escreve a do ano
                       mais proximo
  3. sem ancora        nenhum ano daquela urna foi medido pelo TSE
                       -> NAO MEXE. So preenche se hoje estiver vazio, e ai usa
                       a previsao da v0.15 (qualquer coisa e melhor que nada).

A operacao e monotona: nunca troca uma coordenada medida por um palpite, nunca
troca o modelo antigo pelo novo. So pode melhorar ou ficar igual. Continua sendo
100% UPDATE -- nenhum local e inserido ou removido, e as linhas do acervo que a
v0.15 nao cobre ficam intactas.

Rodar da raiz do repo:  python scripts/atualizar_locais_geocode_v15.py
Desfazer:               git checkout -- resultados_geo/
"""

import csv
import os
import shutil
import sqlite3
import struct
import sys
import tempfile
import zipfile
from collections import Counter, defaultdict

CSV_V15 = "version_15_geocode/geocoded_polling_stations.csv"
PANEL_V15 = "version_15_geocode/panel_ids.csv"
DATA_DIR = "resultados_geo"

# (ano, nome do zip, tabela dentro do gpkg). O de 2022 e o unico "_gpkg" em vez
# de "_gkpg" -- o erro de digitacao esta no acervo, nao aqui.
ALVOS = [
    (2006, "locais_votacao_2006_gkpg.zip", "locais_votacao_2006_padronizado"),
    (2008, "locais_votacao_2008_gkpg.zip", "locais_votacao_2008_padronizado"),
    (2010, "locais_votacao_2010_gkpg.zip", "locais_votacao_2010_ENRIQUECIDO"),
    (2012, "locais_votacao_2012_gkpg.zip", "locais_votacao_2012_ENRIQUECIDO"),
    (2014, "locais_votacao_2014_gkpg.zip", "locais_votacao_2014_ENRIQUECIDO"),
    (2016, "locais_votacao_2016_gkpg.zip", "locais_votacao_2016_ENRIQUECIDO"),
    (2018, "locais_votacao_2018_gkpg.zip", "locais_votacao_2018_ENRIQUECIDO"),
    (2020, "locais_votacao_2020_gkpg.zip", "locais_votacao_2020_ENRIQUECIDO"),
    (2022, "locais_votacao_2022_gpkg.zip", "locais_votacao_2022_ENRIQUECIDO"),
    (2024, "locais_votacao_2024_gkpg.zip", "locais_votacao_2024_atualizado_2"),
    (2014, "locais_votacao_2014_am_suplementar_gkpg.zip",
     "locais_votacao_2014_am_suplementar"),
]

# Copia solta do mesmo conteudo do zip de 2006, versionada no repo; se nao for
# reescrita junto, as duas divergem.
COPIA_SOLTA_2006 = "locais_votacao_2006.gpkg"

ANOS = {ano for ano, _, _ in ALVOS}

PROPRIA, PROPAGADA, MODELO = "propria", "propagada", "modelo"


def blob_ponto(lon, lat):
    """Blob GeoPackage de um POINT 4326: cabecalho de 8 bytes + WKB de 21.

    'GP', versao 0, flags 0x01 (little-endian, sem envelope), srs_id 4326, e
    entao WKB little-endian do tipo 1 (Point) com x e y. Confere byte a byte com
    os blobs que ja estao nos arquivos.
    """
    return (struct.pack("<BBBBi", 0x47, 0x50, 0, 1, 4326)
            + struct.pack("<BIdd", 1, 1, lon, lat))


def chave(ibge, zona, local):
    """(ibge, zona, local) como inteiros. No gpkg as tres colunas sao TEXT e no
    CSV sao numericas, entao normalizar dos dois lados e obrigatorio.

    ibge 0 nao identifica municipio: o acervo tem ~900 linhas assim por ano e a
    chave (0, zona, local) colide entre UFs (a mesma bate num local de AL e num
    de RS). Devolve None para nunca casar por ela.
    """
    try:
        k = (int(ibge), int(zona), int(local))
    except (TypeError, ValueError):
        return None
    return None if k[0] == 0 else k


def resolver_v15():
    """Resolve a melhor coordenada disponivel para cada (ano, chave).

    Devolve (melhor, painel_de, ancoras):
      melhor[ano][chave]  = (lon, lat, origem)
      painel_de[ano][chave] = panel_id  (ou None)
      ancoras[panel_id]   = ((ano, lon, lat), ...)  so coordenadas oficiais TSE
    """
    csv.field_size_limit(10 ** 9)

    linhas = {}                       # local_id -> (ano, chave, lon, lat)
    medida = {}                       # local_id -> (ano, lon, lat) oficial TSE
    print(f"lendo {CSV_V15} ...")
    with open(CSV_V15, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            try:
                ano, lid = int(r["ano"]), int(r["local_id"])
            except (TypeError, ValueError):
                continue
            if ano not in ANOS:
                continue
            k = chave(r["cod_localidade_ibge"], r["nr_zona"], r["nr_locvot"])
            if k is None:
                continue
            lon = float(r["long"]) if r["long"] else None
            lat = float(r["lat"]) if r["lat"] else None
            linhas[lid] = (ano, k, lon, lat)
            if r["tse_long"]:
                medida[lid] = (ano, float(r["tse_long"]), float(r["tse_lat"]))

    print(f"lendo {PANEL_V15} ...")
    membros = defaultdict(list)       # panel_id -> [local_id]
    de_qual_painel = {}               # local_id -> panel_id
    with open(PANEL_V15, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            pid, lid = int(r["panel_id"]), int(r["local_id"])
            membros[pid].append(lid)
            de_qual_painel[lid] = pid

    ancoras = {pid: tuple(medida[m] for m in mem if m in medida)
               for pid, mem in membros.items()}
    ancoras = {pid: a for pid, a in ancoras.items() if a}

    melhor = {ano: {} for ano in ANOS}
    painel_de = {ano: {} for ano in ANOS}
    for lid, (ano, k, lon, lat) in linhas.items():
        pid = de_qual_painel.get(lid)
        painel_de[ano][k] = pid
        propria = medida.get(lid)
        if propria:
            melhor[ano][k] = (propria[1], propria[2], PROPRIA)
            continue
        disp = ancoras.get(pid)
        if disp:
            _, alon, alat = min(disp, key=lambda a: abs(a[0] - ano))
            melhor[ano][k] = (alon, alat, PROPAGADA)
        elif lon is not None:
            melhor[ano][k] = (lon, lat, MODELO)

    return melhor, painel_de, ancoras


def atualizar_gpkg(caminho, tabela, melhor, painel_de, ancoras):
    con = sqlite3.connect(caminho)
    con.execute("PRAGMA journal_mode=DELETE")  # sem -wal solto ao rezipar

    # O gpkg de 2014 AM suplementar veio direto do pipeline upstream e nao tem a
    # coluna tipo_match que os outros dez tem.
    colunas = {c[1] for c in con.execute(f"PRAGMA table_info({tabela})")}
    marca = "tipo_match" in colunas

    updates = []
    conta = Counter()
    total = 0

    for fid, ibge, zo, l, lo, la, geom in con.execute(
        f"SELECT fid, cod_localidade_ibge, nr_zona, nr_locvot, long, lat, geom "
        f"FROM {tabela}"
    ):
        total += 1
        k = chave(ibge, zo, l)
        cand = melhor.get(k) if k else None
        if cand is None:
            conta["sem_cobertura"] += 1
            continue
        if geom is not None and len(geom) != 29:
            raise SystemExit(
                f"{caminho}: fid {fid} tem geom de {len(geom)} bytes; o script so "
                f"sabe reescrever POINT sem envelope (29 bytes)."
            )

        lon, lat, origem = cand
        vazia = lo is None or la is None or (lo == 0 and la == 0)

        if not vazia and origem == MODELO:
            # Modelo novo nao substitui o que ja esta la: medido contra ancora
            # do TSE, o modelo antigo do acervo acerta mais (105 m x 186 m).
            conta["mantida_sem_ancora"] += 1
            continue

        if not vazia:
            # Ja e uma medicao oficial (a propagacao do pipeline antigo)? Entao
            # nao ha ganho em trocar por outra medicao -- evita diff a toa.
            pid = painel_de.get(k)
            oficiais = {(a[1], a[2]) for a in ancoras.get(pid, ())}
            if (lo, la) in oficiais:
                conta["ja_medida"] += 1
                continue

        if lo == lon and la == lat:
            conta["ja_medida"] += 1
            continue

        conta["vazia_preenchida" if vazia else origem] += 1
        linha = [lon, lat, blob_ponto(lon, lat)]
        if marca:
            linha.append(f"geocode_v0.15 ({origem})")
        updates.append((*linha, fid))

    sets = "long=?, lat=?, geom=?" + (", tipo_match=?" if marca else "")
    con.executemany(f"UPDATE {tabela} SET {sets} WHERE fid=?", updates)

    # O site nunca consulta o indice espacial (le long/lat direto), mas deixar o
    # rtree apontando para as coordenadas velhas quebra o arquivo em qualquer GIS.
    rtree = f"rtree_{tabela}_geom"
    if con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                   (rtree,)).fetchone():
        con.execute(f'DELETE FROM "{rtree}"')
        con.execute(
            f'INSERT INTO "{rtree}"(id, minx, maxx, miny, maxy) '
            f"SELECT fid, long, long, lat, lat FROM {tabela} "
            f"WHERE long IS NOT NULL AND lat IS NOT NULL"
        )

    con.execute(
        "UPDATE gpkg_contents SET min_x=(SELECT min(long) FROM %s), "
        "min_y=(SELECT min(lat) FROM %s), max_x=(SELECT max(long) FROM %s), "
        "max_y=(SELECT max(lat) FROM %s) WHERE table_name=?" % ((tabela,) * 4),
        (tabela,),
    )

    con.commit()
    con.execute("VACUUM")
    conferido = con.execute(f"SELECT count(*) FROM {tabela}").fetchone()[0]
    con.close()

    if conferido != total:
        raise SystemExit(f"{caminho}: contagem mudou ({total} -> {conferido})")
    return total, conta


def processar(ano, nome_zip, tabela, melhor, painel_de, ancoras, tmpdir):
    caminho_zip = os.path.join(DATA_DIR, nome_zip)
    with zipfile.ZipFile(caminho_zip) as z:
        entrada = next(n for n in z.namelist() if n.lower().endswith(".gpkg"))
        destino = os.path.join(tmpdir, entrada)
        with open(destino, "wb") as f:
            f.write(z.read(entrada))

    total, c = atualizar_gpkg(destino, tabela, melhor, painel_de, ancoras)

    with zipfile.ZipFile(caminho_zip, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(destino, entrada)
    if entrada == COPIA_SOLTA_2006:
        shutil.copyfile(destino, os.path.join(DATA_DIR, COPIA_SOLTA_2006))

    escritas = c[PROPRIA] + c[PROPAGADA] + c["vazia_preenchida"]
    print(f"{nome_zip:<48} {total:>6} linhas | escritas {escritas:>6}"
          f"  (propria {c[PROPRIA]:>5}, propagada {c[PROPAGADA]:>5},"
          f" vazia {c['vazia_preenchida']:>4})"
          f" | ja medida {c['ja_medida']:>6} | mantida {c['mantida_sem_ancora']:>5}"
          f" | fora da v0.15 {c['sem_cobertura']:>5}")


def main():
    if not os.path.exists(CSV_V15):
        raise SystemExit(f"{CSV_V15} nao encontrado -- rode da raiz do repositorio.")

    melhor, painel_de, ancoras = resolver_v15()
    print()
    for ano in sorted(melhor):
        c = Counter(o for _, _, o in melhor[ano].values())
        n = sum(c.values())
        print(f"  {ano}: {n:>6} locais | medida propria {c[PROPRIA]:>6}"
              f" | medida propagada {c[PROPAGADA]:>6}"
              f" | so modelo {c[MODELO]:>6}"
              f"  -> {100.0*(c[PROPRIA]+c[PROPAGADA])/n:>4.0f}% medida")
    print()

    with tempfile.TemporaryDirectory() as tmpdir:
        for ano, nome_zip, tabela in ALVOS:
            processar(ano, nome_zip, tabela, melhor[ano], painel_de[ano], ancoras,
                      tmpdir)

    print("\nPronto. Para desfazer: git checkout -- resultados_geo/")


if __name__ == "__main__":
    sys.exit(main())
