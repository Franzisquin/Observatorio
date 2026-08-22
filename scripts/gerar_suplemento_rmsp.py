"""Malha de locais de votacao da RM de Sao Paulo em 1998 e 2002, a partir do CEM.

O PROBLEMA
----------
O site nao tem malha propria para 1998/2002: ele empresta a do GPKG de 2006
(loadGeneralScopeBase2006), casando por {zona}_{cd_municipio_tse}_{local}. Como o
zoneamento mudou entre 2002 e 2006, muita urna antiga nao acha par e fica sem ponto
no mapa -- os votos vao para o balde sintetico por municipio, entao o total fecha
mas o mapa fica vazado. Na RMSP, 2002 tem 2.581 urnas e so 2.008 pontos (77,8%);
so na capital sao 386 urnas sem ponto.

A CHAVE DO CASAMENTO: ASSINATURA DE VOTOS
-----------------------------------------
O CEM numera os locais com codigo proprio (COD_LV) e nao traz o nr_locvot do TSE,
entao nao ha codigo em comum. Nome tambem nao serve: os resultados do TSE de
1998/2002 sao so contagens, sem nome de local.

O que os dois lados tem em comum sao OS VOTOS. Dentro de um par (zona, municipio),
o vetor de votos de uma urna e praticamente unico -- casamento exato de 84% (1998)
e 87% (2002), com ZERO ambiguidade.

O resto se explica porque o CEM funde o anexo no predio-mae. Na zona 1 da capital os
totais batem exatamente (143.841 votos dos dois lados) e o "RIO BRANCO" do CEM e
1_71072_1112 + 1_71072_1252 do TSE. Procurando somas de 2 a 3 urnas livres do mesmo
par, o casamento sobe para 98,5% (1998) e 99,7% (2002).

DBF, NUNCA XLSX
---------------
O .shp pareia com o .DBF na ordem dos registros. O .xlsx tem OUTRA ordenacao: em
2002 a primeira linha do xlsx e "JOAO E RAPHAELA PASSALACQUA" (Bela Vista) mas o
primeiro ponto do .shp e de Juquitiba, a 50 km. Ler o xlsx daria coordenada trocada
em silencio. O DBF ainda e mais consistente: usa CD_MUN_T/CD_MUN_I nos dois anos,
enquanto o xlsx renomeou para CD_MUN/CD_MUN_IBGE em 2002.

Rodar da raiz do repo:  python scripts/gerar_suplemento_rmsp.py
"""

import collections
import csv
import gzip
import itertools
import json
import os
import sqlite3
import struct
import sys
import tempfile
import zipfile
from math import cos, hypot, radians

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from historico_texto import get_history_name_core_tokens

CEM_DIR = "version_15_geocode/rm_sp"
SAIDA = "resultados_geo/locais_suplemento_rmsp.zip"
ENTRADA_JSON = "locais_suplemento_rmsp.json"
IDENT = "resultados_geo/identidade_historico.csv.gz"

# ano -> (pasta do CEM, prefixo das colunas de presidente 1o turno)
CONJUNTOS = {
    1998: ("EL1998_LV_RMSP_CEM_V2", "PS98_1"),
    2002: ("EL2002_LV_RMSP_CEM_V2", "PS02_1"),
}

# Envelope da RMSP, para travar ponto que caia fora da regiao.
ENVELOPE = (-47.20, -45.80, -24.05, -23.20)  # long_min, long_max, lat_min, lat_max

# Ate 3 urnas do TSE somadas por ponto do CEM. Anexo e coisa de uma ou duas mesas;
# subir isso explode a combinatoria e comeca a casar por acaso.
MAX_PARCELAS = 3

# Raio para herdar hist_id de uma urna de 2006 proxima, quando a chave nao existe
# na malha de 2006. Predio vizinho em quadra urbana fica bem abaixo disso.
RAIO_HIST_M = 150.0

# Cargos com voto por SECAO em 1998 (chaves {zona}_{municipio}_S{n}, sem local
# nenhum). Para cada um: prefixo da coluna no CEM e se o sufixo carrega o turno.
#   presidente/governador: PS98_113 = turno 1, candidato 13
#   senador:               SE98_13  = candidato 13, sem turno (eleicao de um turno)
# Deputado federal e estadual ficam de fora: o acervo nao tem Legislativas 1998.
CARGOS_SECAO = {
    "presidente": ("PS98_", True),
    "governador": ("GO98_", True),
    "senador": ("SE98_", False),
}


def ler_dbf(caminho):
    """Leitor minimo de DBF: cabecalho de 32 bytes, descritores de campo de 32
    bytes ate 0x0D, e registros de tamanho fixo com 1 byte de flag na frente."""
    with open(caminho, "rb") as f:
        cabecalho = f.read(32)
        n_reg, tam_cab, tam_reg = struct.unpack("<I H H", cabecalho[4:12])
        campos = []
        while True:
            d = f.read(32)
            if d[0:1] in (b"\r", b""):
                break
            campos.append((d[:11].split(b"\x00")[0].decode("latin-1"), d[16]))
        f.seek(tam_cab)
        linhas = []
        for _ in range(n_reg):
            reg = f.read(tam_reg)
            if not reg or reg[0:1] == b"\x1a":
                break
            pos, linha = 1, {}
            for nome, tam in campos:
                linha[nome] = reg[pos:pos + tam].decode("latin-1").strip()
                pos += tam
            linhas.append(linha)
    return linhas


def ler_pontos(caminho):
    """Shapefile de pontos: 100 bytes de cabecalho e, por registro, 8 bytes de
    cabecalho (numero e comprimento em palavras de 16 bits) + conteudo.

    O comprimento vem do proprio registro -- assumir 28 bytes fixos estoura o
    buffer no ultimo ponto.
    """
    tamanho = os.path.getsize(caminho)
    pontos = []
    with open(caminho, "rb") as f:
        f.seek(100)
        while f.tell() < tamanho:
            _, comprimento = struct.unpack(">ii", f.read(8))
            corpo = f.read(comprimento * 2)
            tipo = struct.unpack("<i", corpo[:4])[0]
            if tipo != 1:
                raise SystemExit(f"{caminho}: shape tipo {tipo}, esperado 1 (ponto)")
            pontos.append(struct.unpack("<dd", corpo[4:20]))
    return pontos


def chave_tripla(k):
    partes = k.split("_")
    if len(partes) != 3:
        return None
    try:
        return int(partes[0]), int(partes[1]), int(partes[2])
    except ValueError:
        return None  # chave sintetica do acervo (ex.: 303_S314_1058)


def resultados(cargo, ano, turno=1):
    for padrao in (f"{cargo}_{ano}_t{turno}_SP.zip", f"{cargo}_{ano}_ord_t{turno}_SP.zip"):
        caminho = f"resultados_geo/Majoritarias {ano}/{padrao}"
        if os.path.exists(caminho):
            with zipfile.ZipFile(caminho) as z:
                nome = next(n for n in z.namelist()
                            if n.endswith(".json") and not n.endswith("_resumo.json"))
                return json.loads(z.read(nome).decode("utf-8"))["RESULTS"]
    raise SystemExit(f"resultados de {cargo} {ano} turno {turno} (SP) nao encontrados")


def resultados_presidente(ano):
    return resultados("presidente", ano)


def conferir_com_governador(ano, mapa):
    """Revalida cada casamento com uma eleicao que NAO foi usada para casar.

    O casamento sai do vetor de votos de presidente. Uma soma de 2-3 urnas pode,
    em tese, bater por acaso -- mas bater tambem no conjunto de candidatos a
    governador, com outra quantidade de candidatos e outra distribuicao, e
    praticamente impossivel. Sem este passo, a unica checagem disponivel seria
    geografica, contra a malha de 2006 -- que e justamente a que nao presta e
    da falso alarme (a mediana entre urnas irmas la e de 448 m em 1998).
    """
    votos = resultados("governador", ano)
    prefixo = f"GO{str(ano)[2:]}_1"
    grupos = collections.defaultdict(list)
    for chave, (ponto, linha) in mapa.items():
        grupos[(ponto, id(linha))].append((chave, linha))

    conferidos = divergentes = 0
    for itens in grupos.values():
        linha = itens[0][1]
        colunas = [c for c in linha if c.startswith(prefixo)]
        alvo = {c.split("_")[1][1:]: int(float(linha[c]))
                for c in colunas if linha[c] and float(linha[c])}
        soma = collections.Counter()
        completo = True
        for chave, _ in itens:
            v = votos.get(chave)
            if v is None:
                completo = False
                break
            soma.update({a: int(b) for a, b in v.items() if int(b)})
        if not completo:
            continue
        if dict(soma) == alvo:
            conferidos += 1
        else:
            divergentes += 1
            print(f"   DIVERGENTE em governador: {[c for c, _ in itens]}")
    if divergentes:
        raise SystemExit(
            f"{ano}: {divergentes} grupos casaram em presidente mas nao em "
            f"governador -- casamento por acaso, nao escrever.")
    return conferidos, len(grupos)


def malha_2006():
    """{zona}_{tse}_{local} -> (long, lat, nome, hist_id) da malha que o site usa
    hoje para desenhar 1998/2002."""
    ponte = {str(k): int(v) for k, v in
             json.load(open("resultados_geo/tse_para_ibge.json", encoding="utf-8")).items()
             if v}
    hist = {}
    if os.path.exists(IDENT):
        csv.field_size_limit(10 ** 9)
        with gzip.open(IDENT, "rt", encoding="utf-8", newline="") as f:
            hist = {int(r["local_id"]): int(r["hist_id"]) for r in csv.DictReader(f)}
    # local_id da v0.15 -> (ibge, zona, local), so 2006 e so SP
    por_ibge = {}
    if hist:
        with open("version_15_geocode/geocoded_polling_stations.csv",
                  encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f):
                if r["ano"] != "2006" or r["sg_uf"] != "SP":
                    continue
                try:
                    k = (int(r["cod_localidade_ibge"]), int(r["nr_zona"]),
                         int(r["nr_locvot"]))
                except ValueError:
                    continue
                h = hist.get(int(r["local_id"]))
                if h is not None:
                    por_ibge[k] = h

    tmp = tempfile.mkdtemp()
    with zipfile.ZipFile("resultados_geo/locais_votacao_2006_gkpg.zip") as z:
        entrada = z.namelist()[0]
        destino = os.path.join(tmp, entrada)
        with open(destino, "wb") as f:
            f.write(z.read(entrada))
    con = sqlite3.connect(destino)
    coord = {}
    for ib, zo, l, lon, lat, nome, hid in con.execute(
            "SELECT cod_localidade_ibge, nr_zona, nr_locvot, long, lat, nm_locvot, "
            "hist_id FROM locais_votacao_2006_padronizado WHERE sg_uf='SP'"):
        try:
            k = (int(ib), int(zo), int(l))
        except (TypeError, ValueError):
            continue
        if lon is None:
            continue
        coord[k] = (lon, lat, nome or "", hid if hid is not None else por_ibge.get(k))
    con.close()

    saida = {}
    with zipfile.ZipFile("resultados_geo/Censo 2006/censo_2006_SP.zip") as z:
        censo = json.loads(z.read("censo_2006_SP.json").decode("utf-8"))["RESULTS"]
    for k in censo:
        t = chave_tripla(k)
        if not t:
            continue
        ib = ponte.get(str(t[1]))
        c = coord.get((ib, t[0], t[2])) if ib else None
        if c:
            saida[k] = c
    return saida, list(coord.values())


def metros(a, b):
    return hypot((b[0] - a[0]) * 111320 * cos(radians(a[1])),
                 (b[1] - a[1]) * 110540)


def votos_cem(linha, prefixo, com_turno, turno):
    """Vetor de votos de uma linha do CEM para um cargo e turno."""
    saida = {}
    for coluna, valor in linha.items():
        if not coluna.startswith(prefixo) or not valor:
            continue
        sufixo = coluna.split("_")[1]
        if com_turno:
            if not sufixo.startswith(str(turno)):
                continue
            numero = sufixo[1:]
        else:
            if turno != 1:
                continue
            numero = sufixo
        n = int(float(valor))
        if n:
            saida[numero] = saida.get(numero, 0) + n
    return saida


def estacoes_de_secao_1998(linhas, mapa):
    """Devolve (estacoes, pares_cobertos) para as urnas de 1998 que so existem no
    acervo como SECAO, sem local de votacao.

    Em 1998 a RMSP tem 2.754 chaves {zona}_{municipio}_S{n} com 1.252.081 votos e
    nenhum local -- o mapa nao consegue desenhar nada disso e os votos ficam no
    balde sintetico do municipio. Sao 1.779 dessas chaves so na capital, contra 953
    locais de verdade.

    NAO da para dizer qual secao pertence a qual predio: testei particionar as
    secoes em blocos contiguos de numeracao e nao fecha (nos dois pares em que o
    teste e viavel, 6 alvos/44 secoes e 8/51, nao existe particao contigua). Mas
    tambem nao e preciso: o CEM ja traz o total POR PREDIO. Entao o par
    (zona, municipio) e tratado como um todo -- as estacoes do CEM que sobraram do
    casamento 1:1 recebem os votos que o CEM apurou nelas, e as chaves de secao
    daquele par saem do balde sintetico.

    Isso so vale se a identidade fechar exatamente:
        soma(estacoes CEM sem par) == soma(chaves S)
    conferida em TODOS os cargos e turnos. Par que nao fecha em algum deles fica
    de fora inteiro.
    """
    usadas = {id(linha) for _, linha in mapa.values()}
    pares_cem = {(int(l["ZE_NUM"]), int(l["CD_MUN_T"]))
                 for l in linhas if l["CD_MUN_T"].isdigit()}

    sobrando = collections.defaultdict(list)
    for linha in linhas:
        if id(linha) in usadas or not linha["CD_MUN_T"].isdigit():
            continue
        sobrando[(int(linha["ZE_NUM"]), int(linha["CD_MUN_T"]))].append(linha)

    # (cargo, turno) -> {par: (soma_cem, soma_secoes, [chaves S])}
    conferencia = {}
    for cargo, (prefixo, com_turno) in CARGOS_SECAO.items():
        for turno in (1, 2):
            try:
                res = resultados(cargo, 1998, turno)
            except SystemExit:
                continue
            tem_coluna = any(votos_cem(l, prefixo, com_turno, turno) for l in linhas)
            if not tem_coluna:
                continue
            soma_cem = collections.defaultdict(collections.Counter)
            for par, grupo in sobrando.items():
                for linha in grupo:
                    soma_cem[par].update(votos_cem(linha, prefixo, com_turno, turno))
            soma_sec = collections.defaultdict(collections.Counter)
            chaves = collections.defaultdict(list)
            for chave, v in res.items():
                partes = chave.split("_")
                if len(partes) != 3 or not partes[2].startswith("S"):
                    continue
                try:
                    par = (int(partes[0]), int(partes[1]))
                except ValueError:
                    continue
                if par not in pares_cem:
                    continue
                chaves[par].append(chave)
                soma_sec[par].update({a: int(b) for a, b in v.items() if int(b)})
            conferencia[(cargo, turno)] = (soma_cem, soma_sec, chaves)

    # Um par so entra se fechar em TODOS os cargos/turnos em que tem secao.
    candidatos = set()
    for _, soma_sec, _ in conferencia.values():
        candidatos.update(p for p, v in soma_sec.items() if v)
    aprovados, recusados = [], []
    for par in candidatos:
        if not sobrando.get(par):
            recusados.append((par, "sem estacao do CEM sobrando"))
            continue
        motivo = None
        for (cargo, turno), (soma_cem, soma_sec, _) in conferencia.items():
            if not soma_sec.get(par):
                continue
            if dict(soma_cem.get(par, {})) != dict(soma_sec[par]):
                motivo = f"{cargo} {turno}o turno"
                break
        if motivo:
            recusados.append((par, motivo))
        else:
            aprovados.append(par)

    estacoes = []
    for par in sorted(aprovados):
        zona, cd = par
        for linha in sobrando[par]:
            votos = {}
            for cargo, (prefixo, com_turno) in CARGOS_SECAO.items():
                for turno in (1, 2):
                    if (cargo, turno) not in conferencia:
                        continue
                    v = votos_cem(linha, prefixo, com_turno, turno)
                    if v:
                        votos.setdefault(cargo, {})[f"{turno}T"] = v
            if not votos:
                continue
            estacoes.append({
                "chave": f"{zona}_{cd}_C{linha['COD_LV']}",
                "zona": zona, "cd_localidade_tse": cd,
                "linha": linha, "votos": votos,
            })

    cobertas = []
    for (_, _, chaves) in conferencia.values():
        for par in aprovados:
            cobertas.extend(chaves.get(par, []))
    return estacoes, sorted(aprovados), sorted(set(cobertas)), recusados


def casar(ano, pasta, prefixo):
    base = os.path.join(CEM_DIR, pasta, pasta)
    linhas = ler_dbf(base + ".DBF")
    pontos = ler_pontos(base + ".shp")
    assert len(linhas) == len(pontos), \
        f"{pasta}: DBF tem {len(linhas)} registros e SHP tem {len(pontos)}"

    resultados = resultados_presidente(ano)
    colunas = [c for c in linhas[0] if c.startswith(prefixo)]
    numero_de = {c: c.split("_")[1][1:] for c in colunas}

    # urnas do TSE agrupadas por (zona, municipio) -- o par em que o CEM tambem
    # esta organizado, e dentro do qual o vetor de votos identifica a urna
    grupos = collections.defaultdict(dict)
    for k, votos in resultados.items():
        t = chave_tripla(k)
        if t:
            grupos[(t[0], t[1])][k] = {a: int(b) for a, b in votos.items() if int(b)}

    mapa = {}          # chave TSE -> (long, lat, linha do CEM)
    usados = set()
    sobra = []
    for linha, ponto in zip(linhas, pontos):
        try:
            zona, cd = int(linha["ZE_NUM"]), int(linha["CD_MUN_T"])
        except ValueError:
            continue
        vetor = {numero_de[c]: int(float(linha[c]))
                 for c in colunas if linha[c] and float(linha[c])}
        candidatos = [k for k, tv in grupos.get((zona, cd), {}).items()
                      if tv == vetor and k not in usados]
        if len(candidatos) == 1:
            mapa[candidatos[0]] = (ponto, linha)
            usados.add(candidatos[0])
        elif len(candidatos) > 1:
            raise SystemExit(
                f"{ano}: vetor de votos ambiguo em zona {zona} municipio {cd} "
                f"({linha['NOME_LV']}) -> {candidatos}")
        else:
            sobra.append((zona, cd, vetor, ponto, linha))

    exatas = len(mapa)

    # O CEM funde o anexo no predio-mae: um ponto do CEM = soma de N urnas do TSE.
    agregados = parcelas = 0
    for zona, cd, vetor, ponto, linha in sobra:
        alvo = sum(vetor.values())
        livres = [(k, tv) for k, tv in grupos.get((zona, cd), {}).items()
                  if k not in usados and sum(tv.values()) <= alvo]
        achou = None
        for tamanho in range(2, MAX_PARCELAS + 1):
            if len(livres) < tamanho:
                break
            for combo in itertools.combinations(livres, tamanho):
                soma = collections.Counter()
                for _, tv in combo:
                    soma.update(tv)
                if dict(soma) == vetor:
                    achou = combo
                    break
            if achou:
                break
        if achou:
            for k, _ in achou:
                mapa[k] = (ponto, linha)
                usados.add(k)
            agregados += 1
            parcelas += len(achou)

    return linhas, pontos, mapa, exatas, agregados, parcelas


def main():
    if not os.path.isdir(CEM_DIR):
        raise SystemExit(f"{CEM_DIR} nao encontrado -- rode da raiz do repositorio.")

    malha, coords_2006 = malha_2006()
    print(f"malha 2006 (SP) com coordenada: {len(malha)} chaves")

    saida = {}
    for ano, (pasta, prefixo) in CONJUNTOS.items():
        linhas, pontos, mapa, exatas, agregados, parcelas = casar(ano, pasta, prefixo)
        pontos_por_id = {id(l): p for l, p in zip(linhas, pontos)}
        conferidos, grupos = conferir_com_governador(ano, mapa)

        rmsp = {int(l["CD_MUN_T"]) for l in linhas if l["CD_MUN_T"].isdigit()}
        alvo = [k for k in resultados_presidente(ano)
                if chave_tripla(k) and chave_tripla(k)[1] in rmsp]
        antes = sum(1 for k in alvo if k in malha)

        registros = {}
        novos = herdados = orfaos = 0
        for k, (ponto, linha) in mapa.items():
            lon, lat = ponto
            if not (ENVELOPE[0] <= lon <= ENVELOPE[1] and ENVELOPE[2] <= lat <= ENVELOPE[3]):
                raise SystemExit(f"{ano}: ponto fora da RMSP em {k}: {lon},{lat}")
            ja = malha.get(k)
            reg = {"long": round(lon, 7), "lat": round(lat, 7)}
            if ja is None:
                novos += 1
                # Unica fonte de nome/endereco para esta urna: o proprio CEM.
                titulo = (linha.get("TIT_LV") or "").strip()
                nome = (linha.get("NOME_LV") or "").strip()
                reg["nm_locvot"] = f"{titulo} {nome}".strip() if titulo else nome
                reg["ds_endereco"] = (linha.get("END_LV") or "").strip()
                reg["ds_bairro"] = (linha.get("DIS_NOME") or "").strip()
                reg["nm_localidade"] = (linha.get("MUN_NOME") or "").strip()
                reg["cod_localidade_ibge"] = (linha.get("CD_MUN_I") or "").strip()
                reg["novo"] = True
                # Herda a identidade historica da urna de 2006 mais proxima com
                # nome compativel; sem candidato, o gerador do historico cria uma.
                nucleo = set(get_history_name_core_tokens(reg["nm_locvot"]))
                melhor, menor = None, RAIO_HIST_M
                for lon6, lat6, nome6, hid in coords_2006:
                    if hid is None:
                        continue
                    d = metros((lon, lat), (lon6, lat6))
                    if d < menor and nucleo & set(get_history_name_core_tokens(nome6)):
                        melhor, menor = hid, d
                if melhor is not None:
                    reg["hist_id"] = melhor
                    herdados += 1
                else:
                    orfaos += 1
            else:
                # Ja tem ponto: so a coordenada vem do CEM. Nome, endereco e bairro
                # continuam os da malha de 2006, por decisao de projeto.
                if ja[3] is not None:
                    reg["hist_id"] = ja[3]
            registros[k] = reg

        estacoes, pares, cobertas = [], [], []
        if ano == 1998:
            crus, pares, cobertas, recusados = estacoes_de_secao_1998(linhas, mapa)
            for e in crus:
                linha = e["linha"]
                titulo = (linha.get("TIT_LV") or "").strip()
                nome = (linha.get("NOME_LV") or "").strip()
                lon, lat = pontos_por_id[id(linha)]
                nm = f"{titulo} {nome}".strip() if titulo else nome
                nucleo = set(get_history_name_core_tokens(nm))
                melhor, menor = None, RAIO_HIST_M
                for lon6, lat6, nome6, hid in coords_2006:
                    if hid is None:
                        continue
                    d = metros((lon, lat), (lon6, lat6))
                    if d < menor and nucleo & set(get_history_name_core_tokens(nome6)):
                        melhor, menor = hid, d
                estacoes.append({
                    "chave": e["chave"], "long": round(lon, 7), "lat": round(lat, 7),
                    "nm_locvot": nm,
                    "ds_endereco": (linha.get("END_LV") or "").strip(),
                    "ds_bairro": (linha.get("DIS_NOME") or "").strip(),
                    "nm_localidade": (linha.get("MUN_NOME") or "").strip(),
                    "cod_localidade_ibge": (linha.get("CD_MUN_I") or "").strip(),
                    "nr_zona": e["zona"], "cd_localidade_tse": e["cd_localidade_tse"],
                    "hist_id": melhor, "votos": e["votos"],
                })
            print(f"   secoes sem local: {len(cobertas)} chaves em {len(pares)} pares "
                  f"viram {len(estacoes)} estacoes do CEM")
            if recusados:
                print(f"   pares recusados (identidade nao fechou): {len(recusados)}")
                for par, motivo in recusados[:3]:
                    print(f"      zona {par[0]} municipio {par[1]}: {motivo}")

        saida[str(ano)] = {"locais": registros, "estacoes": estacoes,
                           "secoes_cobertas": cobertas}
        depois = antes + novos
        print(f"\n{ano}: CEM {len(linhas)} pontos | urnas do TSE na RMSP {len(alvo)}")
        print(f"   casadas {len(mapa)} = {exatas} exatas + {parcelas} por agregacao "
              f"({agregados} pontos do CEM)")
        print(f"   reconferidas em governador: {conferidos}/{grupos} grupos")
        print(f"   cobertura da RMSP: {antes} -> {depois} "
              f"({100.0*antes/len(alvo):.1f}% -> {100.0*depois/len(alvo):.1f}%)")
        print(f"   urnas novas {novos} (hist_id herdado {herdados}, sem identidade "
              f"{orfaos}) | ja tinham ponto {len(mapa)-novos}")

    os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
    with zipfile.ZipFile(SAIDA, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(ENTRADA_JSON, json.dumps(saida, ensure_ascii=False,
                                            separators=(",", ":")))
    print(f"\n-> {SAIDA}")


if __name__ == "__main__":
    sys.exit(main())
