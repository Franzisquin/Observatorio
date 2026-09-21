# -*- coding: utf-8 -*-
"""Refaz o perfil censitario dos locais de votacao que mudaram de coordenada.

O PROBLEMA
----------
Em resultados_geo/Censo {ano}/censo_{ano}_{UF}.zip cada local de votacao carrega
nove campos que NAO vem do TSE: sao lidos do Censo do IBGE a partir da
COORDENADA do local, pela media da vizinhanca (kernel gaussiano sobre os setores
censitarios em volta).

    Renda Media, Pct Esgoto Rede Geral, Pct Fossa Septica, Pct Esgoto Inadequado,
    Pct Branca, Pct Preta, Pct Parda, Pct Amarela, Pct Indigena

scripts/corrigir_locais_por_cnefe.py mudou a coordenada de 1.309 locais. O perfil
deles ficou para tras -- continua sendo o do lugar errado onde estavam.

E o lugar errado nao era neutro. Em Vitoria da Conquista os locais da zona rural
estavam empilhados dentro de CANDEIAS, um dos bairros de renda mais alta da
cidade. Tres deles saem do Censo com Renda Media de R$ 5.833, R$ 5.833 e R$ 5.945
-- contra a mediana de R$ 1.632 do municipio e os ~R$ 1.000 dos povoados vizinhos.
Escola de povoado rural aparecendo com renda de bairro nobre: o voto daquela urna
entra em todo cruzamento por renda no decil errado.

O QUE ESTE SCRIPT FAZ -- E O QUE NAO FAZ
----------------------------------------
NAO recalcula o Censo. A formula original (scripts/recalcular_renda_raca_censo_2022.py)
precisa dos agregados por setor censitario do IBGE, dezenas de GB que nao estao
neste repositorio. Se um dia estiverem, RODAR AQUELE SCRIPT E MELHOR do que este.

Aqui o perfil do local movido passa a ser o do LOCAL DE VOTACAO MAIS PROXIMO que
nunca saiu do lugar. E uma aproximacao honesta: o proprio valor original ja e uma
media da vizinhanca, entao herdar a vizinhanca do vizinho mais proximo erra bem
menos que manter o bairro errado a 20 km de distancia.

QUEM RECEBE -- dois criterios
-----------------------------
  1. COORDENADA TROCADA  o local foi movido por corrigir_locais_por_cnefe.py
     (tipo_match entre as marcas dele). O perfil veio do lugar errado.

  2. RENDA INCOERENTE    local RURAL cuja Renda Media passa de 3x a mediana dos
     5 vizinhos RURAIS mais proximos do municipio. Pega o perfil que ficou
     congelado de quando a coordenada era outra, mesmo onde este mutirao nao
     mexeu: em 2024, 16 escolas de povoado de Vitoria da Conquista estao hoje na
     coordenada certa, de 12 a 70 km de Candeias, e ainda assim saem do Censo com
     R$ 5.800 a R$ 7.200, contra R$ 1.000 dos povoados ao redor.

     So se compara RURAL com RURAL, e de proposito. Comparando com todos, o
     Colegio Heleusa Figueira, a FAINOR e o CEMAE apareceriam como outliers --
     mas eles sao de Candeias de verdade e a renda alta deles esta certa; quem
     puxava a mediana deles para baixo eram justamente as escolas rurais ainda
     empilhadas ali ao lado. Medido na BA: 15 suspeitos em 5.200 locais rurais
     (0,3%), nenhum urbano legitimo.

QUEM DOA
--------
Local do MESMO MUNICIPIO e do MESMO TIPO (rural herda de rural) que nao foi
movido, nao e incoerente e nunca apareceu em
resultados_geo/locais_corrigidos_cnefe.csv. Os que continuam empilhados sem
correcao ficam de fora: estao no lugar errado e contaminariam quem os herdasse.

O mais proximo e medido pela coordenada NOVA, a corrigida. Se o municipio inteiro
foi movido (Alcobaca, Mascote e Piripa: 100% dos locais), nao ha doador e o local
fica como esta -- e entra no relatorio.

Cada registro corrigido ganha o campo "perfil_origem", dizendo de qual local veio
o perfil e a que distancia, para a conferencia depois ser possivel.

SAIDAS
------
  resultados_geo/Censo */censo_*_{UF}.zip     perfil corrigido
  resultados_geo/perfil_censo_corrigido.csv   antes/depois de cada local, com o
                                              doador e a distancia

Rodar da raiz do repo:  py scripts/corrigir_perfil_censo_dos_locais_movidos.py --simular
                        py scripts/corrigir_perfil_censo_dos_locais_movidos.py
Desfazer:               git checkout -- "resultados_geo/Censo 2022" (e demais anos)
"""

import collections
import csv
import json
import math
import os
import sqlite3
import statistics
import sys
import tempfile
import unicodedata
import zipfile

DATA_DIR = "resultados_geo"
CSV_CORRIGIDOS = os.path.join(DATA_DIR, "locais_corrigidos_cnefe.csv")
CSV_SAIDA = os.path.join(DATA_DIR, "perfil_censo_corrigido.csv")

# (ano, zip dos locais, tabela). Mesma lista de corrigir_locais_por_cnefe.py.
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
]

# Marcas que corrigir_locais_por_cnefe.py deixa em tipo_match.
MARCAS_MOVIDO = {
    "CNEFE 2022 (estabelecimento)",
    "CNEFE 2022 (localidade)",
    "Catalogo de Escolas INEP",
    "Revertido (coordenada original do TSE)",
}

# Campo de controle do IBGE: sem ele o registro nao tem perfil para doar.
CAMPO_CHAVE = "Renda Media"

# Marcas de endereco rural. Escola de povoado herda de escola de povoado: a
# renda de um local urbano nao serve de referencia para a zona rural, nem o
# contrario -- foi exatamente essa mistura que produziu o defeito.
RURAL = ("ZONA RURAL", "POVOADO", "COMUNIDADE", "ASSENTAMENTO", "FAZENDA",
         "DISTRITO", "RAMAL", "SITIO", "QUILOMBO")

# Um local rural com renda acima de N vezes a mediana dos vizinhos RURAIS mais
# proximos nao e heterogeneidade: e perfil calculado noutro lugar. Medido na BA:
# pega 15 de 5.200 locais rurais (0,3%), e nenhum urbano legitimo -- o Colegio
# Heleusa e a FAINOR, que sao de Candeias de verdade e tem renda alta correta,
# ficam de fora porque so se compara rural com rural.
FATOR_INCOERENCIA = 3.0
VIZINHOS_REFERENCIA = 5
MAX_PASSADAS = 12

# Teto para a distancia ao doador. Municipio nenhum tem 800 km de diametro: um
# doador tao longe significa que a coordenada do PROPRIO ALVO esta quebrada, e
# ai remendar o perfil so esconderia o defeito de coordenada. Melhor relatar.
MAX_DOADOR_KM = 50.0


def nz(texto):
    s = "".join(c for c in unicodedata.normalize("NFKD", str(texto or ""))
                if not unicodedata.combining(c))
    return " ".join(s.upper().split())


def dist_km(a, b):
    (lon1, lat1), (lon2, lat2) = a, b
    dy = (lat2 - lat1) * 111.32
    dx = (lon2 - lon1) * 111.32 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dx, dy)


def municipios_auditados():
    """Municipios cujas coordenadas este mutirao conferiu.

    O criterio da renda incoerente so vale aqui dentro. Fora, um local rural com
    renda de bairro nobre pode ser perfil velho -- ou pode ser a coordenada que
    esta errada, e trocar a renda esconderia isso. Sem conferir a coordenada,
    nao se mexe."""
    out = set()
    with open(CSV_CORRIGIDOS, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out.add(int(r["ibge"]))
    return out


def flagrados():
    """{(ibge, zona, local)} de todo local que a auditoria tocou ou apontou.

    Inclui os nao corrigidos de proposito: um local que continua empilhado esta
    no lugar errado e nao pode servir de doador."""
    if not os.path.exists(CSV_CORRIGIDOS):
        raise SystemExit(f"{CSV_CORRIGIDOS} nao encontrado -- rode antes "
                         "scripts/corrigir_locais_por_cnefe.py")
    out = set()
    with open(CSV_CORRIGIDOS, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out.add((int(r["ibge"]), int(r["zona"]), int(r["local"])))
    return out


def ler_locais(caminho_zip, tabela):
    """[(uf, ibge, municipio, zona, local, lon, lat, tipo_match)] do GeoPackage."""
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        with zipfile.ZipFile(caminho_zip) as z:
            entrada = next(n for n in z.namelist() if n.lower().endswith(".gpkg"))
            destino = os.path.join(tmp, entrada)
            with open(destino, "wb") as f:
                f.write(z.read(entrada))
        con = sqlite3.connect(destino)
        con.text_factory = lambda b: b.decode("utf-8", "replace")
        try:
            colunas = {r[1] for r in con.execute(f'PRAGMA table_info("{tabela}")')}
            col_tipo = "tipo_match" if "tipo_match" in colunas else "''"
            linhas = con.execute(
                f"SELECT sg_uf, cod_localidade_ibge, nm_localidade, nr_zona, nr_locvot,"
                f' long, lat, {col_tipo}, ds_endereco FROM "{tabela}"').fetchall()
        finally:
            con.close()
    saida = []
    for uf, ibge, muni, zona, local, lon, lat, tipo, endereco in linhas:
        if lon is None or lat is None:
            continue
        try:
            rural = any(t in nz(endereco) for t in RURAL)
            saida.append((uf, int(ibge), nz(muni), int(zona), int(local),
                          float(lon), float(lat), tipo or "", rural))
        except (TypeError, ValueError):
            continue
    return saida


def processar_uf(ano, uf, locais_uf, suspeitos, auditados, fora_escopo, orfaos,
                 simular, registros):
    """Corrige um censo_{ano}_{uf}.zip. Devolve (corrigidos, sem_doador)."""
    pasta = os.path.join(DATA_DIR, f"Censo {ano}")
    caminho = os.path.join(pasta, f"censo_{ano}_{uf}.zip")
    if not os.path.exists(caminho):
        return 0, 0

    with zipfile.ZipFile(caminho) as z:
        nomes = z.namelist()
        principal = next(n for n in nomes
                         if n.endswith(".json") and not n.endswith("_resumo.json"))
        conteudo = {n: z.read(n) for n in nomes}
    dados = json.loads(conteudo[principal].decode("utf-8"))
    meta, results = dados.get("METADATA", {}), dados.get("RESULTS", {})
    campos = [c for c in meta.get("geo_fields", []) if c]
    if not campos or not results:
        return 0, 0

    # (municipio, zona, local) -> chave do RESULTS
    por_chave = {}
    for k, v in results.items():
        try:
            por_chave[(nz(v.get("nm_localidade")), int(v["nr_zona"]), int(v["nr_locvot"]))] = k
        except (KeyError, TypeError, ValueError):
            continue

    # Registros do censo sem par no GeoPackage do ano. O arquivo de 2024 foi
    # montado sobre a lista de locais de 2022 e carrega 11 sobras so em Vitoria
    # da Conquista: sem coordenada no ano, nao ha como reposicionar o perfil --
    # e o site tambem nao os alcanca, porque busca pela lista de locais do ano.
    no_gpkg = {(m, z, l) for _, _, m, z, l, *_ in locais_uf}
    nomes_auditados = {m for _, ibge, m, *_ in locais_uf if ibge in auditados}
    orfaos[0] += sum(1 for k in por_chave
                     if k[0] in nomes_auditados and k not in no_gpkg)

    # Tudo que tem registro no censo, por municipio.
    por_muni = collections.defaultdict(list)
    for uf_l, ibge, muni, zona, local, lon, lat, tipo, rural in locais_uf:
        ch = por_chave.get((muni, zona, local))
        if ch is None:
            continue
        renda = results[ch].get(CAMPO_CHAVE)
        por_muni[ibge].append({"ch": ch, "muni": muni, "zona": zona, "local": local,
                               "lon": lon, "lat": lat, "rural": rural,
                               "renda": float(renda) if renda else None,
                               "movido": tipo in MARCAS_MOVIDO,
                               "flagrado": (ibge, zona, local) in suspeitos})

    corrigidos = sem_doador = 0
    for ibge, itens in por_muni.items():
        # A lista de doadores e refeita a cada passada, dentro do laco: so depois
        # da deteccao se sabe quem esta incoerente, e um local incoerente nao
        # pode doar -- sem isso ele chega a doar para SI MESMO, a 0 km, e o valor
        # errado se confirma sozinho (foi o que aconteceu com a Escola Jesuino
        # Jose, que "herdou" os proprios R$ 5.838).

        # Uma passada nao basta, e nao por descuido: enquanto o vizinho tambem
        # esta com a renda inflada, a mediana da vizinhanca sobe junto e esconde
        # o proximo. Cada correcao aperta a referencia e expoe o seguinte --
        # medido em Vitoria da Conquista, a 1a passada acha 10 e a 2a ainda acha
        # outros 10. Roda ate nao achar mais nada.
        for _ in range(MAX_PASSADAS):
            for it in itens:
                r = results[it["ch"]].get(CAMPO_CHAVE)
                it["renda"] = float(r) if r else None

            # Criterio 2: local rural com renda muito acima da dos outros rurais.
            # Duas referencias, e as duas sao necessarias:
            #   vizinhanca   pega o ponto isolado no meio de povoados pobres;
            #   municipio    pega o GRUPO inteiro que foi deslocado junto. Cinco
            #                escolas que estavam na mesma pilha saem todas com a
            #                mesma renda alta, entao nenhuma e outlier perto das
            #                outras -- so comparando com o municipio elas caem.
            #                Em Vitoria da Conquista sao 9 locais a 6x a mediana
            #                rural que a vizinhanca sozinha nao enxergava.
            rurais = [i for i in itens if i["rural"] and i["renda"]]
            med_muni = statistics.median([i["renda"] for i in rurais]) if len(rurais) >= 5 else 0
            for it in rurais:
                viz = sorted((dist_km((it["lon"], it["lat"]), (o["lon"], o["lat"])), o["renda"])
                             for o in rurais if o is not it)[:VIZINHOS_REFERENCIA]
                it["incoerente"] = False
                med = statistics.median([r for _, r in viz]) if len(viz) >= 3 else 0
                if med > 0 and it["renda"] > FATOR_INCOERENCIA * med:
                    it["incoerente"] = True
                    it["renda_vizinhos"] = med
                elif med_muni > 0 and it["renda"] > FATOR_INCOERENCIA * med_muni:
                    it["incoerente"] = True
                    it["renda_vizinhos"] = med_muni

            doadores = [i for i in itens
                        if i["renda"] and not i["movido"] and not i["flagrado"]
                        and not i.get("incoerente") and not i.get("tratado")]

            # Fora dos municipios auditados o criterio 2 so CONTA, nao corrige.
            if ibge in auditados:
                alvos = [i for i in itens
                         if (i["movido"] or i.get("incoerente")) and not i.get("tratado")]
            else:
                fora_escopo[0] += sum(1 for i in itens
                                      if i.get("incoerente") and not i.get("tratado"))
                for i in itens:
                    if i.get("incoerente"):
                        i["tratado"] = True
                alvos = [i for i in itens if i["movido"] and not i.get("tratado")]
            if not alvos:
                break
            c, s = _herdar(alvos, doadores, results, campos, ano, uf, ibge, registros)
            corrigidos += c
            sem_doador += s

    if corrigidos and not simular:
        meta["perfil_patch"] = (
            "locais com coordenada corrigida, ou com renda rural incoerente com a "
            "vizinhanca, herdaram os geo_fields do local de votacao intacto mais "
            "proximo do mesmo municipio e do mesmo tipo "
            "(scripts/corrigir_perfil_censo_dos_locais_movidos.py)")
        with zipfile.ZipFile(caminho, "w", zipfile.ZIP_DEFLATED) as z:
            for n, bruto in conteudo.items():
                if n == principal:
                    z.writestr(n, json.dumps(dados, ensure_ascii=False).encode("utf-8"))
                elif n.endswith("_resumo.json"):
                    r = json.loads(bruto.decode("utf-8"))
                    if "METADATA" in r:
                        r["METADATA"]["perfil_patch"] = meta["perfil_patch"]
                    z.writestr(n, json.dumps(r, ensure_ascii=False).encode("utf-8"))
                else:
                    z.writestr(n, bruto)
    return corrigidos, sem_doador


def _herdar(alvos, doadores, results, campos, ano, uf, ibge, registros):
    """Copia o perfil do doador mais proximo para cada alvo.

    Escreve sempre em `results`, mesmo em simulacao: e a mudanca na memoria que
    permite a passada seguinte enxergar o proximo incoerente. Quem decide gravar
    o arquivo e processar_uf.

    -> (corrigidos, sem_doador)
    """
    corrigidos = sem_doador = 0
    for it in alvos:
        it["tratado"] = True
        # Doador do mesmo tipo: escola de povoado herda de escola de povoado.
        mesmos = [d for d in doadores if d["rural"] == it["rural"]] or doadores
        motivo = ("coordenada corrigida" if it["movido"] else
                  "renda incoerente com os vizinhos rurais "
                  f"(R$ {it.get('renda_vizinhos', 0):.0f})")
        base = {"ano": ano, "uf": uf, "ibge": ibge, "municipio": it["muni"],
                "zona": it["zona"], "local": it["local"],
                "nome": results[it["ch"]].get("nm_locvot", ""),
                "renda_antes": results[it["ch"]].get(CAMPO_CHAVE, ""),
                "motivo": motivo}
        if not mesmos:
            sem_doador += 1
            registros.append(dict(base, renda_depois="", doador="", doador_nome="",
                                  distancia_km="",
                                  situacao="sem doador (nenhum local intacto no municipio)"))
            continue
        alvo_p = (it["lon"], it["lat"])
        d_it = min(mesmos, key=lambda c: dist_km(alvo_p, (c["lon"], c["lat"])))
        d = dist_km(alvo_p, (d_it["lon"], d_it["lat"]))
        if d > MAX_DOADOR_KM:
            sem_doador += 1
            registros.append(dict(base, renda_depois="", doador="", doador_nome="",
                                  distancia_km=round(d, 2),
                                  situacao=f"doador mais proximo a {d:.0f} km -- "
                                           "coordenada do proprio local e suspeita"))
            continue
        doador = results[d_it["ch"]]
        registros.append(dict(base, renda_depois=doador.get(CAMPO_CHAVE),
                              doador=d_it["ch"], doador_nome=doador.get("nm_locvot", ""),
                              distancia_km=round(d, 2), situacao="perfil herdado"))
        for c in campos:
            if c in doador:
                results[it["ch"]][c] = doador[c]
        results[it["ch"]]["perfil_origem"] = (
            f"herdado de {d_it['ch']} ({doador.get('nm_locvot', '')}) a {d:.2f} km "
            f"-- {motivo}")
        corrigidos += 1
    return corrigidos, sem_doador


def main():
    simular = "--simular" in sys.argv
    if not os.path.isdir(DATA_DIR):
        raise SystemExit(f"{DATA_DIR} nao encontrado -- rode da raiz do repositorio.")
    print("simulacao (nada e escrito)\n" if simular else "")

    suspeitos = flagrados()
    auditados = municipios_auditados()
    fora_escopo = [0]
    orfaos = [0]
    print(f"{len(suspeitos)} locais apontados pela auditoria (nao servem de doador)")
    print(f"{len(auditados)} municipios auditados (onde o criterio da renda vale)\n")

    registros = []
    for ano, nome_zip, tabela in ALVOS:
        caminho = os.path.join(DATA_DIR, nome_zip)
        if not os.path.exists(caminho) or not os.path.isdir(os.path.join(DATA_DIR, f"Censo {ano}")):
            print(f"{ano}: sem GeoPackage ou sem pasta de Censo, pulando")
            continue
        locais = ler_locais(caminho, tabela)
        por_uf = collections.defaultdict(list)
        for r in locais:
            por_uf[r[0]].append(r)
        tot = falta = 0
        for uf in sorted(por_uf):
            c, s = processar_uf(ano, uf, por_uf[uf], suspeitos, auditados,
                                fora_escopo, orfaos, simular, registros)
            tot += c
            falta += s
        print(f"Censo {ano}: perfis herdados {tot:>4} | sem doador {falta:>3}")

    if registros:
        campos = ["ano", "uf", "ibge", "municipio", "zona", "local", "nome",
                  "renda_antes", "renda_depois", "doador", "doador_nome",
                  "distancia_km", "motivo", "situacao"]
        with open(CSV_SAIDA, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=campos, extrasaction="ignore")
            w.writeheader()
            for r in sorted(registros, key=lambda x: (x["municipio"], x["local"], x["ano"])):
                w.writerow(r)
        herdados = [r for r in registros if r["situacao"] == "perfil herdado"]
        ds = sorted(float(r["distancia_km"]) for r in herdados) or [0]
        print(f"\n{len(herdados)} perfis herdados, "
              f"{len(registros) - len(herdados)} sem doador")
        print(f"distancia ao doador: mediana {ds[len(ds) // 2]:.1f} km | max {ds[-1]:.1f} km")
        print(f"Conferencia: {CSV_SAIDA}")
    if orfaos[0]:
        print(f"\n{orfaos[0]} registros do censo nao tem par na lista de locais do ano "
              "(sobra de um arquivo montado sobre outra eleicao).")
        print("Sem coordenada no ano, nao da para reposicionar o perfil deles -- e o site "
              "tambem nao os alcanca.")
    if fora_escopo[0]:
        print(f"\n{fora_escopo[0]} locais rurais FORA dos municipios auditados tem o "
              "mesmo sintoma (renda > 3x a dos vizinhos rurais).")
        print("Nao foram tocados: sem conferir a coordenada deles, trocar a renda "
              "poderia esconder um erro de posicao.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
