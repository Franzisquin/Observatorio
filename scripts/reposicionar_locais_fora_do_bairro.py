# -*- coding: utf-8 -*-
"""Reaproxima locais de votacao que estao geocodificados longe do proprio bairro.

O PROBLEMA
----------
A ESCOLA MUNICIPAL RUBEM BRAGA, bairro JARDIM BOTANICO, Rio de Janeiro, esta
plotada em Senador Camara -- 30 km de distancia, do outro lado da cidade. Nao e
caso isolado: em 2010 o RJ tem 62 pontos assim, e o Brasil ~480. A coordenada
errada leva junto o resultado daquele local para o bairro errado, para a area de
ponderacao errada e para o perfil censitario errado.

O QUE ESTE SCRIPT FAZ -- E O QUE NAO FAZ
----------------------------------------
NAO geocodifica. Nao ha aqui nenhuma tentativa de descobrir o endereco certo: o
ponto e levado para JUNTO DOS IRMAOS -- os outros locais de votacao do MESMO
bairro do MESMO municipio --, a ~120 m do local mais central deles. Fica no
bairro certo, perto das escolas vizinhas, aproximado de proposito e marcado como
tal, para a correcao manual fina depois ser facil de achar e de fazer.

O CRITERIO (conservador -- na duvida, nao mexe)
-----------------------------------------------
Um ponto so e movido quando TODAS estas condicoes valem:

  1. A procedencia nao e medicao do TSE naquele ano ('geocode_v0.15 (propria)').
     Contra uma coordenada medida pelo proprio TSE para aquela urna naquele ano,
     quem provavelmente esta errado e o campo ds_bairro, nao o ponto.
  2. O bairro e um bairro de verdade: nome com 3+ caracteres e fora da lista de
     rotulos genericos ('ZONA RURAL', 'INTERIOR', 'DISTRITO', 'SEDE'...), que
     nomeiam o municipio inteiro e nao tem centro nenhum.
  3. Ha ao menos 3 irmaos no bairro, e eles sao COESOS: a distancia mediana ao
     medoide deles e <= 2 km. Bairro espalhado nao serve de referencia.
  4. O deslocamento e >= max(8 km, 10x o espalhamento dos irmaos) -- uma ordem de
     grandeza alem do tamanho do proprio bairro.
  5. Entre 8 e 15 km ainda e preciso PROVA EXTRA: o ponto tem de estar caido
     dentro do aglomerado de OUTRO bairro do mesmo municipio (a 2 km do medoide
     dele). Sem isso, uma escola rural cadastrada no bairro "CENTRO" e legitima e
     seria movida a toa -- foi o falso positivo que apareceu ao calibrar. Acima
     de 15 km nao ha duvida razoavel e a prova extra e dispensada.

A referencia e o MEDOIDE (o irmao que minimiza a soma das distancias aos demais),
nao a media: um unico irmao tambem errado desloca a media e nao move o medoide.

O deslocamento final leva um desvio de ~120 m em direcao deduzida da chave do
local. E deterministico -- rodar duas vezes da o mesmo resultado --, evita
empilhar varios pontos reposicionados exatamente no mesmo pixel, e deixa claro
no mapa que a posicao e aproximada.

A operacao e idempotente: depois de movido, o ponto passa a estar A ~120 m do
medoide dos irmaos e nunca mais satisfaz a condicao 4.

SAIDAS
------
  resultados_geo/locais_votacao_*.zip        coordenada corrigida no GeoPackage
  resultados_geo/locais_reposicionados.csv   um registro por ponto movido, com a
                                             posicao antiga, a nova, a distancia
                                             e a procedencia original -- e por
                                             ele que se faz a revisao manual.

DEPOIS DE RODAR: o indice de areas de ponderacao depende da coordenada. Regerar
com  py scripts/gerar_areas_ponderacao.py

Rodar da raiz do repo:  py scripts/reposicionar_locais_fora_do_bairro.py
                        py scripts/reposicionar_locais_fora_do_bairro.py --simular
Desfazer:               git checkout -- resultados_geo/
"""

import csv
import hashlib
import math
import os
import shutil
import sqlite3
import struct
import sys
import tempfile
import unicodedata
import zipfile
from collections import defaultdict

DATA_DIR = "resultados_geo"
CSV_SAIDA = os.path.join(DATA_DIR, "locais_reposicionados.csv")

# (ano, zip, tabela). Mesma lista de atualizar_locais_geocode_v15.py; o de 2022 e
# o unico "_gpkg" em vez de "_gkpg" -- o erro de digitacao esta no acervo.
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

# Copia solta do mesmo conteudo do zip de 2006, versionada no repo.
COPIA_SOLTA_2006 = "locais_votacao_2006.gpkg"

MARCA = "Reposicionado no bairro (aproximado)"
# Medicao do TSE para aquela urna naquele ano. Contra ela, quem erra e o bairro.
INTOCAVEL = {"geocode_v0.15 (propria)"}

# Rotulos que nomeiam o municipio inteiro, nao um bairro: nao tem centro.
GENERICO = {
    "ZONA RURAL", "RURAL", "INTERIOR", "AREA RURAL", "ZONA URBANA", "URBANA",
    "POVOADO", "DISTRITO", "SEDE", "ZONA", "CAMPO", "SITIO", "FAZENDA",
    "COMUNIDADE", "LOCALIDADE", "SEM BAIRRO", "NAO INFORMADO", "N I", "NI",
    "SN", "S N", "OUTROS", "DIVERSOS",
}

MIN_IRMAOS = 3        # menos que isso nao define um centro de bairro
MAX_ESPALHAMENTO = 2.0  # km; acima disso o bairro nao serve de referencia
PISO_KM = 8.0         # deslocamento minimo para sequer considerar
FATOR = 10.0          # ... e sempre 10x o espalhamento do proprio bairro
SEM_DUVIDA_KM = 15.0  # acima disso dispensa a prova extra
PERTO_DE_OUTRO_KM = 2.0  # "caiu no aglomerado de outro bairro"
DESVIO_KM = 0.12      # afastamento do medoide, para nao empilhar pontos


def norm(texto):
    """Maiuscula, sem acento e sem pontuacao -- para comparar nome de bairro."""
    s = unicodedata.normalize("NFKD", str(texto or "")).encode("ascii", "ignore").decode()
    return " ".join("".join(c if c.isalnum() else " " for c in s).upper().split())


def bairro_util(bairro):
    n = norm(bairro)
    return len(n) >= 3 and n not in GENERICO and not n.isdigit()


def dist_km(a, b):
    """Distancia plana em km. Nas escalas daqui (< 100 km) a diferenca para a
    haversine e milimetrica, e o custo importa: sao milhoes de pares."""
    (lon1, lat1), (lon2, lat2) = a, b
    dy = (lat2 - lat1) * 111.32
    dx = (lon2 - lon1) * 111.32 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dx, dy)


def medoide(pontos):
    """O ponto do conjunto que minimiza a soma das distancias aos demais. Um
    outlier no meio dos irmaos nao o desloca -- ao contrario da media."""
    return min(pontos, key=lambda p: sum(dist_km(p, q) for q in pontos))


def espalhamento(pontos, centro):
    ds = sorted(dist_km(centro, p) for p in pontos)
    return ds[len(ds) // 2]


def desvio_determinista(chave, centro):
    """~120 m do medoide, em direcao deduzida da chave do local.

    Deterministico de proposito: rodar duas vezes da a mesma posicao, e dois
    locais reposicionados no mesmo bairro nao caem no mesmo pixel."""
    h = hashlib.md5(chave.encode("utf-8")).digest()
    ang = 2 * math.pi * (h[0] * 256 + h[1]) / 65536.0
    lon, lat = centro
    dlat = DESVIO_KM * math.sin(ang) / 111.32
    dlon = DESVIO_KM * math.cos(ang) / (111.32 * math.cos(math.radians(lat)))
    return round(lon + dlon, 7), round(lat + dlat, 7)


def blob_ponto(lon, lat):
    """Blob GeoPackage de um POINT 4326 -- mesmo formato que ja esta nos
    arquivos (ver atualizar_locais_geocode_v15.py)."""
    return (struct.pack("<BBBBi", 0x47, 0x50, 0, 1, 4326)
            + struct.pack("<BIdd", 1, 1, lon, lat))


def achar_deslocados(linhas):
    """[(fid, lon_novo, lat_novo, info)] dos locais que o criterio move.

    `linhas` sao tuplas (fid, uf, ibge, zona, local, nome, bairro, lon, lat, tipo).
    """
    grupos = defaultdict(list)
    for r in linhas:
        if r[7] is None or r[8] is None or not bairro_util(r[6]):
            continue
        grupos[(r[1], str(r[2]), norm(r[6]))].append(r)

    # Medoide de cada bairro coeso, por municipio: e contra eles que se testa
    # "o ponto caiu dentro de OUTRO bairro".
    centros_do_muni = defaultdict(list)
    for (uf, ibge, bairro), rs in grupos.items():
        if len(rs) < MIN_IRMAOS:
            continue
        pts = [(r[7], r[8]) for r in rs]
        m = medoide(pts)
        if espalhamento(pts, m) <= MAX_ESPALHAMENTO:
            centros_do_muni[(uf, ibge)].append((bairro, m))

    achados = []
    for (uf, ibge, bairro), rs in grupos.items():
        if len(rs) <= MIN_IRMAOS:
            continue
        for alvo in rs:
            if alvo[9] in INTOCAVEL:
                continue
            irmaos = [r for r in rs if r[0] != alvo[0]]
            if len(irmaos) < MIN_IRMAOS:
                continue
            pts = [(r[7], r[8]) for r in irmaos]
            centro = medoide(pts)
            esp = espalhamento(pts, centro)
            if esp > MAX_ESPALHAMENTO:
                continue

            atual = (alvo[7], alvo[8])
            d = dist_km(centro, atual)
            if d < max(PISO_KM, FATOR * esp):
                continue
            if d < SEM_DUVIDA_KM:
                caiu_em_outro = any(
                    b != bairro and dist_km(atual, mo) <= PERTO_DE_OUTRO_KM
                    for b, mo in centros_do_muni.get((uf, ibge), ()))
                if not caiu_em_outro:
                    continue

            chave = f"{uf}|{ibge}|{alvo[3]}|{alvo[4]}"
            lon, lat = desvio_determinista(chave, centro)
            achados.append((alvo[0], lon, lat, {
                "uf": uf, "ibge": ibge, "zona": alvo[3], "local": alvo[4],
                "nome": alvo[5], "bairro": alvo[6],
                "lon_antigo": alvo[7], "lat_antigo": alvo[8],
                "km": round(d, 2), "irmaos": len(irmaos),
                "espalhamento_km": round(esp, 3), "procedencia": alvo[9],
            }))
    return achados


def convergir(linhas, max_passadas=12):
    """Roda achar_deslocados ate nao encontrar mais nada.

    Uma passada so nao basta, e nao por descuido: o outlier INFLA o espalhamento
    do proprio bairro (ele nao entra no medoide, mas os irmaos de um bairro com
    dois erros se contaminam) e cada correcao aperta o aglomerado, expondo o
    seguinte. Medido: a 1a passada de 2010 acha 480 e a 2a ainda acha dezenas.
    Parar na primeira deixaria metade do problema de pe.

    A coordenada guardada no relatorio e sempre a ORIGINAL, nao a da passada
    anterior -- e ela que interessa para conferir o que foi mexido.
    """
    atual = {r[0]: list(r) for r in linhas}
    original = {}
    movidos = {}
    for _ in range(max_passadas):
        achados = achar_deslocados([tuple(v) for v in atual.values()])
        novos = [a for a in achados if abs(atual[a[0]][7] - a[1]) > 1e-9
                 or abs(atual[a[0]][8] - a[2]) > 1e-9]
        if not novos:
            break
        for fid, lon, lat, info in novos:
            if fid not in original:
                original[fid] = (atual[fid][7], atual[fid][8])
            atual[fid][7], atual[fid][8] = lon, lat
            info["lon_antigo"], info["lat_antigo"] = original[fid]
            movidos[fid] = (fid, lon, lat, info)
    return list(movidos.values())


def processar(caminho_gpkg, tabela, simular):
    con = sqlite3.connect(caminho_gpkg)
    try:
        return _processar(con, tabela, simular)
    finally:
        con.close()


def _processar(con, tabela, simular):
    # O suplemento do AM de 2014 nao tem a coluna de procedencia; ali todo ponto
    # e candidato e nada e marcado.
    colunas = {r[1] for r in con.execute(f'PRAGMA table_info("{tabela}")')}
    tem_tipo = "tipo_match" in colunas
    col_tipo = "tipo_match" if tem_tipo else "''"

    linhas = list(con.execute(
        f'SELECT fid, sg_uf, cod_localidade_ibge, nr_zona, nr_locvot, nm_locvot,'
        f' ds_bairro, long, lat, {col_tipo} FROM "{tabela}"'))
    total = len(linhas)
    achados = convergir(linhas)

    if not simular and achados:
        if tem_tipo:
            con.executemany(
                f"UPDATE {tabela} SET long=?, lat=?, geom=?, tipo_match=? WHERE fid=?",
                [(lon, lat, blob_ponto(lon, lat), MARCA, fid)
                 for fid, lon, lat, _ in achados])
        else:
            con.executemany(
                f"UPDATE {tabela} SET long=?, lat=?, geom=? WHERE fid=?",
                [(lon, lat, blob_ponto(lon, lat), fid)
                 for fid, lon, lat, _ in achados])

        # O site le long/lat direto e nunca consulta o indice espacial, mas
        # deixar o rtree apontando para as coordenadas velhas quebra o arquivo em
        # qualquer GIS.
        rtree = f"rtree_{tabela}_geom"
        if con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                       (rtree,)).fetchone():
            con.execute(f'DELETE FROM "{rtree}"')
            con.execute(
                f'INSERT INTO "{rtree}"(id, minx, maxx, miny, maxy) '
                f"SELECT fid, long, long, lat, lat FROM {tabela} "
                f"WHERE long IS NOT NULL AND lat IS NOT NULL")

        con.execute(
            "UPDATE gpkg_contents SET min_x=(SELECT min(long) FROM %s), "
            "min_y=(SELECT min(lat) FROM %s), max_x=(SELECT max(long) FROM %s), "
            "max_y=(SELECT max(lat) FROM %s) WHERE table_name=?" % ((tabela,) * 4),
            (tabela,))
        con.commit()
        con.execute("VACUUM")

    conferido = con.execute(f"SELECT count(*) FROM {tabela}").fetchone()[0]
    if conferido != total:
        raise SystemExit(f"{caminho_gpkg}: contagem mudou ({total} -> {conferido})")
    return total, achados


def main():
    simular = "--simular" in sys.argv
    if not os.path.isdir(DATA_DIR):
        raise SystemExit(f"{DATA_DIR} nao encontrado -- rode da raiz do repositorio.")

    registros = []
    print("simulacao (nada e escrito)\n" if simular else "")
    for ano, nome_zip, tabela in ALVOS:
        caminho_zip = os.path.join(DATA_DIR, nome_zip)
        if not os.path.exists(caminho_zip):
            print(f"{nome_zip:<48} ausente, pulando")
            continue

        with tempfile.TemporaryDirectory() as tmp:
            with zipfile.ZipFile(caminho_zip) as z:
                entrada = next(n for n in z.namelist() if n.lower().endswith(".gpkg"))
                destino = os.path.join(tmp, entrada)
                with open(destino, "wb") as f:
                    f.write(z.read(entrada))

            total, achados = processar(destino, tabela, simular)

            if achados and not simular:
                with zipfile.ZipFile(caminho_zip, "w", zipfile.ZIP_DEFLATED) as z:
                    z.write(destino, entrada)
                if entrada == COPIA_SOLTA_2006:
                    shutil.copyfile(destino, os.path.join(DATA_DIR, COPIA_SOLTA_2006))

        por_uf = defaultdict(int)
        for _, _, _, info in achados:
            info["ano"] = ano
            registros.append(info)
            por_uf[info["uf"]] += 1
        top = ", ".join(f"{u}:{c}" for u, c in
                        sorted(por_uf.items(), key=lambda x: -x[1])[:5])
        print(f"{nome_zip:<48} {total:>6} linhas | reposicionados {len(achados):>5}"
              f"  ({100.0 * len(achados) / total:.2f}%) | {top}")

    if registros and not simular:
        campos = ["ano", "uf", "ibge", "zona", "local", "nome", "bairro",
                  "lon_antigo", "lat_antigo", "km", "irmaos", "espalhamento_km",
                  "procedencia"]
        with open(CSV_SAIDA, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=campos, extrasaction="ignore")
            w.writeheader()
            for r in sorted(registros, key=lambda x: (-x["km"], x["ano"])):
                w.writerow(r)
        print(f"\n{len(registros)} pontos reposicionados. Revisao manual: {CSV_SAIDA}")
        print("Regerar o indice de areas: py scripts/gerar_areas_ponderacao.py")
    elif simular:
        print(f"\n{len(registros)} pontos seriam reposicionados.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
