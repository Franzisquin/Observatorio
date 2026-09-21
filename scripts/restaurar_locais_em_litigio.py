# -*- coding: utf-8 -*-
"""Devolve aos locais em area de litigio territorial a coordenada do TSE.

O PROBLEMA
----------
scripts/corrigir_locais_por_cnefe.py trata "local fora do poligono do proprio
municipio" como coordenada errada. Na divisa de Vitoria da Conquista com Anage
isso e um falso positivo: ha litigio territorial, e o TSE lota em Vitoria da
Conquista eleitor que mora em faixa que a malha do IBGE atribui a Anage. O ponto
esta certo; quem diverge e o limite.

A assinatura e inconfundivel. Em 2022 sao 14 locais, e 11 deles sao do MESMO
distrito -- Jose Goncalves --, formando um continuo ao norte do municipio, de
0,7 a 12,4 km alem da divisa. Erro de geocodificacao nao se organiza por
distrito nem em faixa; limite divergente se organiza assim.

Ao trata-los como quebrados, a correcao trocou a coordenada real de cada um pelo
centro do distrito Jose Goncalves. O efeito no mapa e o oposto do pretendido:
pontos que estavam espalhados pelos povoados certos viraram um aglomerado no
meio do distrito.

O QUE ESTE SCRIPT FAZ
---------------------
So devolve a coordenada. Para cada local de Vitoria da Conquista, olha qual era
a coordenada do TSE ANTES de qualquer intervencao:

  - a anterior ao reposicionamento por bairro, se o local aparece em
    resultados_geo/locais_reposicionados.csv NAQUELE ANO; senao
  - a do commit 93433b0, anterior a esta auditoria.

Se essa coordenada cai dentro de Anage, ela volta -- junto com os nove campos do
Censo que dela derivam (renda, cor/raca, esgoto), que tambem eram os certos e
foram sobrescritos. O resto do trabalho fica como esta: nenhum outro local e
tocado.

A LISTA E FECHADA
-----------------
Nao ha heuristica aqui. LITIGIO diz quais pares de municipios tem limite
divergente, e so esses sao considerados. Acrescentar um par novo exige saber do
litigio -- e nao adivinhar por causa de um ponto solto na fronteira, que e o
caso comum e continua sendo corrigido normalmente.

SAIDAS
------
  resultados_geo/locais_votacao_*.zip     coordenada do TSE de volta
  resultados_geo/Censo */censo_*_{UF}.zip perfil censitario de volta
  resultados_geo/locais_em_litigio.csv    um registro por local devolvido

Rodar da raiz do repo:  py scripts/restaurar_locais_em_litigio.py --simular
                        py scripts/restaurar_locais_em_litigio.py
"""

import collections
import csv
import hashlib
import json
import math
import os
import sqlite3
import struct
import subprocess
import sys
import tempfile
import unicodedata
import zipfile

DATA_DIR = "resultados_geo"
CSV_REPOSICIONADOS = os.path.join(DATA_DIR, "locais_reposicionados.csv")
CSV_SAIDA = os.path.join(DATA_DIR, "locais_em_litigio.csv")

# Commit anterior a esta auditoria: a referencia do que o TSE publicava.
BASE = "93433b0"

# (ano, zip, tabela, nome do gpkg dentro do zip)
ALVOS = [
    (2006, "locais_votacao_2006_gkpg.zip", "locais_votacao_2006_padronizado", "locais_votacao_2006.gpkg"),
    (2008, "locais_votacao_2008_gkpg.zip", "locais_votacao_2008_padronizado", "locais_votacao_2008.gpkg"),
    (2010, "locais_votacao_2010_gkpg.zip", "locais_votacao_2010_ENRIQUECIDO", "locais_votacao_2010.gpkg"),
    (2012, "locais_votacao_2012_gkpg.zip", "locais_votacao_2012_ENRIQUECIDO", "locais_votacao_2012.gpkg"),
    (2014, "locais_votacao_2014_gkpg.zip", "locais_votacao_2014_ENRIQUECIDO", "locais_votacao_2014.gpkg"),
    (2016, "locais_votacao_2016_gkpg.zip", "locais_votacao_2016_ENRIQUECIDO", "locais_votacao_2016.gpkg"),
    (2018, "locais_votacao_2018_gkpg.zip", "locais_votacao_2018_ENRIQUECIDO", "locais_votacao_2018.gpkg"),
    (2020, "locais_votacao_2020_gkpg.zip", "locais_votacao_2020_ENRIQUECIDO", "locais_votacao_2020.gpkg"),
    (2022, "locais_votacao_2022_gpkg.zip", "locais_votacao_2022_ENRIQUECIDO", "locais_votacao_2022.gpkg"),
    (2024, "locais_votacao_2024_gkpg.zip", "locais_votacao_2024_atualizado_2", "locais_votacao_2024.gpkg"),
]

# Pares com limite divergente: {municipio: {vizinho que abriga a faixa}}.
LITIGIO = {
    2933307: (2901205, "BA"),   # Vitoria da Conquista x Anage
}

MARCA = "Area em litigio territorial (coordenada do TSE)"

# Marcas de casamento POR NOME: ali a correcao achou um estabelecimento com o
# nome da escola dentro do municipio, e isso vale mais que a coordenada crua do
# TSE. A Escola Regis Pacheco e a Joao XXIII sao esses casos -- existem no CNEFE,
# com o nome exato, a poucos quilometros do povoado declarado. Nao se desfaz.
MARCAS_POR_NOME = ("CNEFE 2022 (estabelecimento)", "Catalogo de Escolas INEP")

MIN_SEPARACAO_M = 50.0   # duas urnas no mesmo pixel: o TSE repete coordenada


def nz(texto):
    s = "".join(c for c in unicodedata.normalize("NFKD", str(texto or ""))
                if not unicodedata.combining(c))
    return " ".join(s.upper().split())


def carregar_poligono(uf, cod):
    caminho = os.path.join(DATA_DIR, "municipios_hd", f"municipios_{uf}.geojson")
    for f in json.load(open(caminho, encoding="utf-8"))["features"]:
        if int(f["properties"]["CD_MUN"]) == cod:
            g = f["geometry"]
            return [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
    return None


def dentro(x, y, poligonos):
    n = 0
    for p in poligonos:
        for anel in p:
            for i in range(len(anel) - 1):
                x1, y1 = anel[i][0], anel[i][1]
                x2, y2 = anel[i + 1][0], anel[i + 1][1]
                if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                    n += 1
    return bool(n % 2)


def originais_por_ano():
    """{(ano, ibge, zona, local): (lon, lat)} do CSV do reposicionamento.

    A chave leva o ANO: o mesmo local tem uma linha por eleicao, e aplicar a
    coordenada de 2010 a 2022 poria o ponto noutro lugar."""
    out = {}
    if not os.path.exists(CSV_REPOSICIONADOS):
        return out
    with open(CSV_REPOSICIONADOS, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out[(int(r["ano"]), int(r["ibge"]), int(r["zona"]), int(r["local"]))] = (
                float(r["lon_antigo"]), float(r["lat_antigo"]))
    return out


def gpkg_do_git(caminho_zip, nome_gpkg, destino):
    """Extrai para `destino` o gpkg como estava no commit BASE."""
    r = subprocess.run(["git", "show", f"{BASE}:{caminho_zip}"], capture_output=True)
    if r.returncode != 0 or not r.stdout:
        return None
    tmp_zip = destino + ".zip"
    with open(tmp_zip, "wb") as f:
        f.write(r.stdout)
    with zipfile.ZipFile(tmp_zip) as z:
        with open(destino, "wb") as f:
            f.write(z.read(nome_gpkg))
    return destino


def dist_m(a, b):
    dy = (b[1] - a[1]) * 111320.0
    dx = (b[0] - a[0]) * 111320.0 * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot(dx, dy)


def afastar(x, y, chave, ocupados):
    """Desloca ~150 m em direcao deduzida da chave, ate achar vaga."""
    h = hashlib.md5(chave.encode("utf-8")).digest()
    ang0 = 2 * math.pi * (h[0] * 256 + h[1]) / 65536.0
    for i in range(12):
        raio = 0.15 * (1 + i * 0.5)
        ang = ang0 + i * 2.39996323
        nx = x + raio * math.cos(ang) / (111.32 * math.cos(math.radians(y)))
        ny = y + raio * math.sin(ang) / 111.32
        if all(dist_m((nx, ny), q) >= MIN_SEPARACAO_M for q in ocupados):
            return round(nx, 7), round(ny, 7)
    return x, y


def blob_ponto(lon, lat):
    return (struct.pack("<BBBBi", 0x47, 0x50, 0, 1, 4326)
            + struct.pack("<BIdd", 1, 1, lon, lat))


def censo_original(ano, uf):
    """{(municipio, zona, local): {campo: valor}} dos geo_fields no commit BASE."""
    caminho = f"{DATA_DIR}/Censo {ano}/censo_{ano}_{uf}.zip"
    r = subprocess.run(["git", "show", f"{BASE}:{caminho}"], capture_output=True)
    if r.returncode != 0 or not r.stdout:
        return {}, []
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        fp = os.path.join(tmp, "c.zip")
        with open(fp, "wb") as f:
            f.write(r.stdout)
        with zipfile.ZipFile(fp) as z:
            nome = next(n for n in z.namelist()
                        if n.endswith(".json") and not n.endswith("_resumo.json"))
            dados = json.loads(z.read(nome).decode("utf-8"))
    campos = [c for c in dados.get("METADATA", {}).get("geo_fields", []) if c]
    out = {}
    for v in dados.get("RESULTS", {}).values():
        try:
            ch = (nz(v.get("nm_localidade")), int(v["nr_zona"]), int(v["nr_locvot"]))
        except (KeyError, TypeError, ValueError):
            continue
        out[ch] = {c: v[c] for c in campos if c in v}
    return out, campos


def main():
    simular = "--simular" in sys.argv
    if not os.path.isdir(DATA_DIR):
        raise SystemExit(f"{DATA_DIR} nao encontrado -- rode da raiz do repositorio.")
    print("simulacao (nada e escrito)\n" if simular else "")

    rep = originais_por_ano()
    registros = []

    for cod, (vizinho, uf) in LITIGIO.items():
        faixa = carregar_poligono(uf, vizinho)
        if not faixa:
            print(f"malha de {vizinho} nao encontrada, pulando")
            continue

        for ano, nome_zip, tabela, nome_gpkg in ALVOS:
            caminho_zip = os.path.join(DATA_DIR, nome_zip)
            if not os.path.exists(caminho_zip):
                continue

            with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
                atual = os.path.join(tmp, nome_gpkg)
                with zipfile.ZipFile(caminho_zip) as z:
                    with open(atual, "wb") as f:
                        f.write(z.read(nome_gpkg))
                base = gpkg_do_git(f"{DATA_DIR}/{nome_zip}", nome_gpkg,
                                   os.path.join(tmp, "base.gpkg"))
                if not base:
                    print(f"{ano}: {BASE} nao tem o arquivo, pulando")
                    continue

                con_b = sqlite3.connect(base)
                con_b.text_factory = lambda b: b.decode("utf-8", "replace")
                antigos = {}
                for zona, local, nm, x, y in con_b.execute(
                        f"SELECT nr_zona, nr_locvot, nm_locvot, long, lat FROM "
                        f'"{tabela}" WHERE cod_localidade_ibge=?', (cod,)):
                    if x is None:
                        continue
                    antigos[(int(zona), int(local))] = (nm, float(x), float(y))
                con_b.close()

                con = sqlite3.connect(atual)
                con.text_factory = lambda b: b.decode("utf-8", "replace")
                colunas = {r[1] for r in con.execute(f'PRAGMA table_info("{tabela}")')}
                tem_tipo = "tipo_match" in colunas
                devolver = []
                col_tipo = "tipo_match" if tem_tipo else "''"
                ocupados = []
                for fid, zona, local, nm, muni, x, y, marca in con.execute(
                        f"SELECT fid, nr_zona, nr_locvot, nm_locvot, nm_localidade, "
                        f'long, lat, {col_tipo} FROM "{tabela}" '
                        f"WHERE cod_localidade_ibge=?", (cod,)):
                    ch = (int(zona), int(local))
                    if str(marca or "").startswith(MARCAS_POR_NOME):
                        continue
                    # O original daquele ANO: o do CSV de reposicionamento tem
                    # prioridade, porque e anterior tambem aquela intervencao.
                    o = rep.get((ano, cod, ch[0], ch[1]))
                    if o is None:
                        o = antigos.get(ch, (None, None, None))[1:]
                    if o[0] is None or not dentro(o[0], o[1], faixa):
                        continue
                    if x is not None and abs(x - o[0]) < 1e-9 and abs(y - o[1]) < 1e-9:
                        continue          # ja esta onde deve
                    # O TSE repete coordenada entre urnas. Se duas voltarem para
                    # o mesmo ponto, a segunda e afastada -- lado a lado conta a
                    # verdade, empilhadas nao.
                    lon, lat = o[0], o[1]
                    if any(dist_m((lon, lat), q) < MIN_SEPARACAO_M for q in ocupados):
                        lon, lat = afastar(lon, lat, f"{cod}|{zona}|{local}", ocupados)
                    ocupados.append((lon, lat))
                    devolver.append((fid, lon, lat))
                    registros.append({
                        "ano": ano, "ibge": cod, "municipio": muni, "zona": zona,
                        "local": local, "nome": nm,
                        "lon_corrigido": x, "lat_corrigido": y,
                        "lon_tse": o[0], "lat_tse": o[1],
                        "vizinho": vizinho})

                if devolver and not simular:
                    if tem_tipo:
                        con.executemany(
                            f"UPDATE {tabela} SET long=?, lat=?, geom=?, tipo_match=? "
                            f"WHERE fid=?",
                            [(x, y, blob_ponto(x, y), MARCA, fid) for fid, x, y in devolver])
                    else:
                        con.executemany(
                            f"UPDATE {tabela} SET long=?, lat=?, geom=? WHERE fid=?",
                            [(x, y, blob_ponto(x, y), fid) for fid, x, y in devolver])
                    rtree = f"rtree_{tabela}_geom"
                    if con.execute("SELECT 1 FROM sqlite_master WHERE type='table' "
                                   "AND name=?", (rtree,)).fetchone():
                        con.execute(f'DELETE FROM "{rtree}"')
                        con.execute(
                            f'INSERT INTO "{rtree}"(id, minx, maxx, miny, maxy) '
                            f"SELECT fid, long, long, lat, lat FROM {tabela} "
                            f"WHERE long IS NOT NULL AND lat IS NOT NULL")
                    con.execute(
                        "UPDATE gpkg_contents SET min_x=(SELECT min(long) FROM %s), "
                        "min_y=(SELECT min(lat) FROM %s), max_x=(SELECT max(long) FROM %s), "
                        "max_y=(SELECT max(lat) FROM %s) WHERE table_name=?"
                        % ((tabela,) * 4), (tabela,))
                    con.commit()
                    con.execute("VACUUM")
                con.close()

                if devolver and not simular:
                    with zipfile.ZipFile(caminho_zip, "w", zipfile.ZIP_DEFLATED) as z:
                        z.write(atual, nome_gpkg)

            print(f"{ano}: {len(devolver):>3} locais devolvidos a coordenada do TSE")

            # O perfil censitario derivava da coordenada certa e tambem foi
            # sobrescrito: volta junto.
            if devolver and not simular:
                restaurar_censo(ano, uf, cod, {(d[1], d[2]) for d in devolver}, registros)

    if registros:
        campos = ["ano", "ibge", "municipio", "zona", "local", "nome",
                  "lon_corrigido", "lat_corrigido", "lon_tse", "lat_tse", "vizinho"]
        with open(CSV_SAIDA, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=campos, extrasaction="ignore")
            w.writeheader()
            for r in sorted(registros, key=lambda x: (x["local"], x["ano"])):
                w.writerow(r)
        por_ano = collections.Counter(r["ano"] for r in registros)
        print(f"\n{len(registros)} devolucoes, "
              f"{len({(r['zona'], r['local']) for r in registros})} locais distintos")
        print("por ano:", dict(sorted(por_ano.items())))
        print(f"Conferencia: {CSV_SAIDA}")
        if not simular:
            print("Regerar o indice de areas: py scripts/gerar_areas_ponderacao.py")
    else:
        print("\nnada a devolver.")
    return 0


def restaurar_censo(ano, uf, cod, coords, registros):
    """Devolve os geo_fields do Censo aos locais que voltaram para a faixa."""
    caminho = os.path.join(DATA_DIR, f"Censo {ano}", f"censo_{ano}_{uf}.zip")
    if not os.path.exists(caminho):
        return
    orig, campos = censo_original(ano, uf)
    if not orig:
        return
    alvos = {(r["zona"], r["local"]) for r in registros if r["ano"] == ano}
    with zipfile.ZipFile(caminho) as z:
        conteudo = {n: z.read(n) for n in z.namelist()}
        principal = next(n for n in conteudo
                         if n.endswith(".json") and not n.endswith("_resumo.json"))
    dados = json.loads(conteudo[principal].decode("utf-8"))
    n = 0
    for v in dados.get("RESULTS", {}).values():
        try:
            ch = (nz(v.get("nm_localidade")), int(v["nr_zona"]), int(v["nr_locvot"]))
        except (KeyError, TypeError, ValueError):
            continue
        if (v.get("nr_zona"), v.get("nr_locvot")) not in alvos and \
           (str(v.get("nr_zona")), str(v.get("nr_locvot"))) not in alvos:
            continue
        if ch not in orig:
            continue
        for c, val in orig[ch].items():
            v[c] = val
        v.pop("perfil_origem", None)
        n += 1
    if n:
        with zipfile.ZipFile(caminho, "w", zipfile.ZIP_DEFLATED) as z:
            for nome, bruto in conteudo.items():
                if nome == principal:
                    z.writestr(nome, json.dumps(dados, ensure_ascii=False).encode("utf-8"))
                else:
                    z.writestr(nome, bruto)
    print(f"      Censo {ano}: {n} perfis devolvidos")


if __name__ == "__main__":
    sys.exit(main())
