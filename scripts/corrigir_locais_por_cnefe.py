# -*- coding: utf-8 -*-
"""Recoloca locais de votacao errados usando o CNEFE 2022 do IBGE.

O PROBLEMA
----------
A coordenada que o TSE publica para o local de votacao falha de duas maneiras
distintas, e as duas chegam ao mapa como se fossem medicao:

  PILHA  Em Vitoria da Conquista, 22 locais da zona rural -- povoados a dezenas
         de quilometros uns dos outros -- estao na MESMA coordenada, dentro do
         bairro Candeias, na zona urbana. Sao 16 pontos a menos de 20 m entre si.
         E o geocodificador do TSE caindo num ponto de recuo quando o endereco e
         so "POVOADO X - ZONA RURAL". O mesmo acontece em Belo Campo e Piripa,
         que empilham 16 locais de DOIS municipios na mesma coordenada, dentro
         de um terceiro (Tremedal); em Alcobaca (15 de 15, em Prado); em Mascote
         (9 de 9, em Camacan); em Brasilia de Minas (11, a 179 km, em Buenopolis).

  FUGA   Outros pontos simplesmente caem fora do proprio municipio. No Brasil de
         2022 sao 1.081 locais (1,15%), dos quais ~660 a mais de 1 km da divisa
         -- o resto e precisao de malha em local de fronteira, e nao se mexe.

Como os arquivos historicos herdam a coordenada de 2022 casando zona+local, o
erro esta em todos os anos de 2006 a 2024.

A FONTE
-------
CNEFE 2022 (Cadastro Nacional de Enderecos para Fins Estatisticos, IBGE): todo
endereco do pais com coordenada coletada em campo no Censo 2022, com especie
(4 = estabelecimento de ensino, 5 = saude), nome do estabelecimento, localidade
e distrito. Em Vitoria da Conquista sao 199.847 enderecos, 430 deles escolas --
427 com coordenada de nivel 1 (coletada no endereco). Os nomes dos distritos vem
da API de localidades do IBGE.

O CRITERIO (conservador -- na duvida, nao mexe)
-----------------------------------------------
Um ponto so e movido quando ele esta comprovadamente quebrado:

  1. Esta fora do proprio municipio por MAIS de 1 km (abaixo disso e a malha, nao
     o dado); ou
  2. Faz parte de uma pilha: 3+ locais a menos de 50 m cujos enderecos sao RURAIS
     e nomeiam 3+ localidades diferentes. Tres escolas no mesmo quarteirao de uma
     cidade grande e normal (acontece em Feira de Santana e nao e erro); tres
     povoados no mesmo pixel e impossivel; ou
  3. Leva a marca de scripts/reposicionar_locais_fora_do_bairro.py, que moveu o
     ponto para o medoide dos "irmaos" de bairro -- e nestes municipios os irmaos
     eram a propria pilha; ou
  4. Esta a mais de 5 km de qualquer endereco do DISTRITO que o proprio ds_bairro
     declara. E o que pega o residuo: quando a maioria da pilha ja saiu, sobram
     dois ou tres pontos que nao formam mais pilha e continuam no bairro errado.

E a coordenada nova sai, em ordem de preferencia:

  ESTABELECIMENTO  o nome do local de votacao casa com um estabelecimento do
                   CNEFE DENTRO DO MESMO DISTRITO do TSE. O distrito e o que
                   desempata homonimos: "POVOADO BARREIRO" existe duas vezes em
                   Vitoria da Conquista, a 90 km um do outro.
  ESCOLA INEP      o nome casa com o Catalogo de Escolas do INEP, que traz o nome
                   oficial. Vale menos: so 68,7% das escolas tem coordenada la.
  LOCALIDADE       o nome nao casa, mas a localidade do ENDERECO existe no CNEFE
                   e e um aglomerado coeso: vai para o centro dela. ds_bairro so
                   entra aqui quando NAO nomeia um distrito -- o centroide de um
                   distrito inteiro recriaria a pilha que estamos desfazendo.
  REVERTIDO        reposicionar_locais_fora_do_bairro.py havia movido o ponto:
                   volta para a coordenada original do TSE, registrada em
                   resultados_geo/locais_reposicionados.csv. Ela vem ANTES do
                   centro do distrito, quando cai dentro dele: e um ponto
                   especifico, nao uma media.
  DISTRITO         ultimo recurso. A coordenada exata nao existe em fonte alguma
                   -- Fazenda Queimadas e Fazenda Lixa nao estao no CNEFE, nem no
                   INEP, nem no OpenStreetMap --, mas o distrito e certo. Fica no
                   meio dele, marcado como aproximado.
  (nenhum)         nao se mexe. Entra no CSV de revisao com o motivo.

Uma vaga ocupada nao encerra a busca: o candidato e descartado e a proxima pista
entra. Foi o que faltava para a Escola Sao Domingos I, que casava com a MESMA
escola do CNEFE que a Sao Domingos II ja tinha levado.

Toda coordenada nova e validada dentro do poligono do municipio antes de entrar,
e nenhuma correcao pode deixar dois locais a menos de 50 m -- senao trocariamos
uma pilha por outra. Nos metodos aproximados (localidade e distrito), em vez de
descartar, o ponto e afastado ~350 m em direcao deduzida da chave do local: duas
escolas do mesmo povoado lado a lado e o retrato honesto, empilhadas nao e.

SAIDAS
------
  resultados_geo/locais_votacao_*.zip        coordenada corrigida no GeoPackage
  resultados_geo/locais_corrigidos_cnefe.csv um registro por ponto, com posicao
                                             antiga, nova, metodo, confianca e a
                                             evidencia do CNEFE -- e por ele que
                                             se faz a conferencia manual
  revisao_locais_cnefe.html                  mapa lado a lado (antes/depois)

DEPOIS DE RODAR: o indice de areas de ponderacao depende da coordenada. Regerar
com  py scripts/gerar_areas_ponderacao.py

Rodar da raiz do repo:  py scripts/corrigir_locais_por_cnefe.py --simular
                        py scripts/corrigir_locais_por_cnefe.py
Desfazer:               git checkout -- resultados_geo/
"""

import collections
import csv
import gzip
import hashlib
import io
import json
import math
import os
import re
import shutil
import sqlite3
import struct
import sys
import tempfile
import unicodedata
import urllib.request
import zipfile
from difflib import SequenceMatcher

DATA_DIR = "resultados_geo"
CACHE_DIR = os.path.join("scratch", "cnefe")
CSV_SAIDA = os.path.join(DATA_DIR, "locais_corrigidos_cnefe.csv")
HTML_SAIDA = "revisao_locais_cnefe.html"
CSV_REPOSICIONADOS = os.path.join(DATA_DIR, "locais_reposicionados.csv")

# (ano, zip, tabela). Mesma lista de reposicionar_locais_fora_do_bairro.py; o de
# 2022 e o unico "_gpkg" em vez de "_gkpg" -- o erro de digitacao esta no acervo.
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
COPIA_SOLTA_2006 = "locais_votacao_2006.gpkg"

# Municipios tratados. Sao os que a auditoria nacional apontou com erro real
# (deslocamento > 1 km ou pilha); a varredura completa acha 642 municipios com
# ao menos um ponto fora, mas a maioria e um caso isolado de fronteira.
MUNICIPIOS = [
    2933307, 2903508, 2924702, 2900801, 2920908,          # BA
    2903003, 2904100, 2907103, 2910008, 2910800,          # BA
    3170008, 3108602, 3126703, 3138682, 3132305,          # MG
    1507003, 1504802, 1506351, 1505304, 1501204, 1501907,  # PA
    2409803, 2401404,                                      # RN
    2202251,                                               # PI
    5107800,                                               # MT
]

MARCA = {"estabelecimento": "CNEFE 2022 (estabelecimento)",
         "escola_inep": "Catalogo de Escolas INEP",
         "localidade": "CNEFE 2022 (localidade)",
         "distrito": "Centro do distrito (aproximado)",
         "revertido": "Revertido (coordenada original do TSE)"}
# Marca deixada por scripts/reposicionar_locais_fora_do_bairro.py.
MARCA_REPOSICIONADO = "Reposicionado no bairro (aproximado)"

FORA_MIN_KM = 1.0      # abaixo disso e imprecisao de malha, nao erro de dado
PILHA_M = 50.0         # raio que caracteriza empilhamento
PILHA_MIN = 3          # ... com ao menos este tanto de locais
# Raio maximo de um aglomerado que ainda conta como "localidade". Serve para
# recusar o centroide de um DISTRITO inteiro, que tem dezenas de km. Povoado
# rural de 2,5 km e normal: o Sao Domingos, com 283 enderecos e raio 2,54 km,
# estava sendo recusado a toa e caindo no centro do distrito, 4 km adiante.
# Os bairros urbanos de Vitoria da Conquista ficam todos abaixo de 1,4 km.
ESPALHAMENTO_MAX_KM = 3.0
MIN_ENDERECOS = 8      # localidade com menos enderecos nao define um centro
ESPALHAR_KM = 0.35     # afastamento entre dois pontos aproximados na mesma area
DISTRITO_FORA_KM = 5.0  # longe assim do proprio distrito nao e imprecisao, e erro

STOP = {"ESCOLA", "ESCOLAR", "MUNICIPAL", "ESTADUAL", "COLEGIO", "CENTRO", "EDUCACIONAL",
        "GRUPO", "DE", "DA", "DO", "DOS", "DAS", "E", "ENSINO", "FUNDAMENTAL", "INFANTIL",
        "EDUCACAO", "CRECHE", "EMEF", "EMEI", "CMEI", "CEMEI", "CEM", "EXTENSAO", "ANEXO",
        "POVOADO", "DISTRITO", "ZONA", "RURAL", "URBANA", "LOCALIDADE", "SEDE", "PROF",
        "PROFESSOR", "PROFESSORA", "DR", "DOUTOR", "INSTITUTO", "UNIDADE", "MOD", "MODULO",
        "CAMPO", "INTEGRAL", "BASICA", "PRE", "JARDIM", "NUCLEO", "EEF", "EEIF", "EM"}
GENERICO = {"ESCOLA", "ESCOLA MUNICIPAL", "ESCOLA ESTADUAL", "POSTO DE SAUDE",
            "ENSINO FUNDAMENTAL", "CRECHE", "ESCOLA RURAL"}
# Marcas de endereco rural: e o empilhamento DELES que denuncia o recuo do
# geocodificador. Endereco urbano empilhado costuma ser predio compartilhado.
RURAL = ("ZONA RURAL", "POVOADO", "COMUNIDADE", "ASSENTAMENTO", "FAZENDA", "DISTRITO",
         "RAMAL", "RODOVIA", "ESTRADA", "SITIO", "QUILOMBO")
PREFIXO_LOC = ("POVOADO", "DISTRITO", "FAZENDA", "ASSENTAMENTO", "COMUNIDADE", "VILA",
               "SITIO", "LOTEAMENTO", "CONJUNTO", "BAIRRO")

URL_CNEFE = ("https://ftp.ibge.gov.br/Cadastro_Nacional_de_Enderecos_para_Fins_Estatisticos/"
             "Censo_Demografico_2022/Arquivos_CNEFE/CSV/Municipio/")
URL_DISTRITOS = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios/{}/distritos"
# Catalogo de Escolas do INEP georreferenciado, espelho do IPEA (geobr), 103 MB.
INEP_URL = "https://www.ipea.gov.br/geobr/data_gpkg/schools/2020/schools_2020.gpkg"
INEP_GPKG = os.path.join(CACHE_DIR, "schools_inep_2020.gpkg")
UF_POR_COD = {11: "RO", 12: "AC", 13: "AM", 14: "RR", 15: "PA", 16: "AP", 17: "TO",
              21: "MA", 22: "PI", 23: "CE", 24: "RN", 25: "PB", 26: "PE", 27: "AL",
              28: "SE", 29: "BA", 31: "MG", 32: "ES", 33: "RJ", 35: "SP", 41: "PR",
              42: "SC", 43: "RS", 50: "MS", 51: "MT", 52: "GO", 53: "DF"}


# --------------------------------------------------------------------------- #
# texto
# --------------------------------------------------------------------------- #

def nz(texto):
    """Maiuscula, sem acento e sem pontuacao."""
    s = "".join(c for c in unicodedata.normalize("NFKD", str(texto or ""))
                if not unicodedata.combining(c))
    return " ".join("".join(c if c.isalnum() else " " for c in s).upper().split())


def toks(texto):
    return {t for t in nz(texto).split() if t not in STOP and len(t) > 2}


def sim(a, b):
    """Dice sobre tokens, com casamento aproximado: ARTUR ~ ARTHUR."""
    if not a or not b:
        return 0.0
    livres, n = set(b), 0
    for t in a:
        if t in livres:
            livres.discard(t)
            n += 1
            continue
        c = max(livres, key=lambda u: SequenceMatcher(None, t, u).ratio(), default=None)
        if c and SequenceMatcher(None, t, c).ratio() >= 0.85:
            livres.discard(c)
            n += 1
    return 2 * n / (len(a) + len(b))


def limpa_loc(bruto):
    """'POVOADO ITAPIREMA - ZONA RURAL' -> 'ITAPIREMA'."""
    s = nz(bruto)
    for suf in (" ZONA RURAL", " ZONA URBANA"):
        if s.endswith(suf):
            s = s[:-len(suf)]
    s = s.split(" SN")[0].split(",")[0].strip()
    for p in PREFIXO_LOC:
        if s.startswith(p + " "):
            s = s[len(p) + 1:]
    return s.strip()


def variantes_loc(bruto):
    """Nomes de localidade candidatos, incluindo o que vem entre parenteses.

    O TSE registra o apelido do povoado assim: "POVOADO LAGOA DA VISAO (LAGOA DA
    PEDRA)". O nome de dentro dos parenteses e as vezes o unico que o CNEFE
    conhece -- ali ele esta como "LOGOA DA PEDA", com o erro de digitacao do
    recenseador."""
    bruto = str(bruto or "")
    partes = [bruto.split("(")[0]]
    partes += re.findall(r"\(([^)]*)\)", bruto)
    saida = []
    for p in partes:
        v = limpa_loc(p)
        if v and v not in saida:
            saida.append(v)
    return saida


# --------------------------------------------------------------------------- #
# geometria
# --------------------------------------------------------------------------- #

def dist_km(a, b):
    """Distancia plana. Nas escalas daqui (< 100 km) a diferenca para a haversine
    e milimetrica, e o custo importa."""
    (lon1, lat1), (lon2, lat2) = a, b
    dy = (lat2 - lat1) * 111.32
    dx = (lon2 - lon1) * 111.32 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dx, dy)


def carregar_malha(uf):
    caminho = os.path.join(DATA_DIR, "municipios_hd", f"municipios_{uf}.geojson")
    if not os.path.exists(caminho):
        return {}
    saida = {}
    for f in json.load(open(caminho, encoding="utf-8"))["features"]:
        g = f["geometry"]
        saida[int(f["properties"]["CD_MUN"])] = (
            [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"])
    return saida


def aneis(poligonos):
    for p in poligonos:
        for r in p:
            yield r


def dentro_do_poligono(x, y, poligonos):
    """Ray casting: conta cruzamentos a esquerda, buracos incluidos."""
    n = 0
    for anel in aneis(poligonos):
        for i in range(len(anel) - 1):
            x1, y1 = anel[i][0], anel[i][1]
            x2, y2 = anel[i + 1][0], anel[i + 1][1]
            if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                n += 1
    return bool(n % 2)


def dist_fronteira_km(x, y, poligonos):
    return min(dist_km((x, y), (c[0], c[1])) for anel in aneis(poligonos) for c in anel)


# --------------------------------------------------------------------------- #
# CNEFE
# --------------------------------------------------------------------------- #

def abrir_url(url, timeout=180):
    """urlopen sem compressao: a API do IBGE responde gzip por padrao e o urllib
    nao descomprime sozinho."""
    req = urllib.request.Request(url, headers={"Accept-Encoding": "identity",
                                               "User-Agent": "Observatorio/1.0"})
    return urllib.request.urlopen(req, timeout=timeout)


def baixar(url, destino):
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    tmp = destino + ".parcial"
    with abrir_url(url, 600) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f)
    os.replace(tmp, destino)


def zip_cnefe(cod_municipio):
    """Baixa (com cache em scratch/) e devolve o caminho do zip municipal."""
    uf = UF_POR_COD[cod_municipio // 100000]
    destino = os.path.join(CACHE_DIR, f"{cod_municipio}.zip")
    if os.path.exists(destino):
        return destino
    pasta = f"{cod_municipio // 100000}_{uf}/"
    with abrir_url(URL_CNEFE + pasta) as r:
        listagem = r.read().decode("utf-8", "replace")
    alvo = next((n for n in listagem.split('href="')[1:]
                 if n.startswith(str(cod_municipio)) and '.zip' in n), None)
    if not alvo:
        raise LookupError(f"CNEFE sem arquivo para {cod_municipio}")
    baixar(URL_CNEFE + pasta + alvo.split('"')[0], destino)
    return destino


def distritos_ibge(cod_municipio):
    """{cod_distrito: nome}, da API de localidades do IBGE, com cache em disco."""
    fp = os.path.join(CACHE_DIR, f"distritos_{cod_municipio}.json")
    if not os.path.exists(fp):
        os.makedirs(CACHE_DIR, exist_ok=True)
        with abrir_url(URL_DISTRITOS.format(cod_municipio)) as r:
            bruto = r.read()
        # a API responde gzip mesmo com Accept-Encoding: identity
        if bruto[:2] == b"\x1f\x8b":
            bruto = gzip.decompress(bruto)
        dados = json.loads(bruto.decode("utf-8"))
        json.dump({str(x["id"]): x["nome"] for x in dados},
                  open(fp, "w", encoding="utf-8"), ensure_ascii=False)
    return json.load(open(fp, encoding="utf-8"))


def carregar_cnefe(cod_municipio):
    z = zipfile.ZipFile(zip_cnefe(cod_municipio))
    nome_csv = next(n for n in z.namelist() if n.lower().endswith(".csv"))
    leitor = csv.DictReader(
        io.StringIO(z.read(nome_csv).decode("utf-8", "replace")), delimiter=";")
    estab, loc = [], collections.defaultdict(list)
    for row in leitor:
        try:
            x, y = float(row["LONGITUDE"]), float(row["LATITUDE"])
        except (TypeError, ValueError):
            continue
        d = row["COD_DISTRITO"]
        nome_loc = nz(row["DSC_LOCALIDADE"])
        if nome_loc:
            loc[(d, nome_loc)].append((x, y))
        # 2 domicilio coletivo, 4 ensino, 5 saude, 6 outras finalidades, 8 religioso
        if row["COD_ESPECIE"] in ("2", "4", "5", "6", "8") and row["DSC_ESTABELECIMENTO"].strip():
            estab.append({"nome": row["DSC_ESTABELECIMENTO"], "loc": row["DSC_LOCALIDADE"],
                          "dist": d, "x": x, "y": y,
                          "_n": toks(row["DSC_ESTABELECIMENTO"]),
                          "_nz": nz(row["DSC_ESTABELECIMENTO"]),
                          "_l": toks(row["DSC_LOCALIDADE"]),
                          "_lz": nz(row["DSC_LOCALIDADE"])})
    dists = distritos_ibge(cod_municipio)
    return {"estab": estab, "loc": dict(loc), "_centro": {}, "_centro_dist": {},
            "dists": dists,
            "_dnome": {nz(v): k for k, v in dists.items()}}


def distrito_do_tse(ds_bairro, cnefe):
    """COD_DISTRITO correspondente ao ds_bairro do TSE, ou None.

    'DISTRITO SEDE' e o distrito-sede, que no IBGE leva o nome do municipio e e
    sempre o de menor codigo."""
    b = nz(ds_bairro)
    if not b.startswith("DISTRITO "):
        return None
    n = b[len("DISTRITO "):].strip()
    if n in ("SEDE", ""):
        # "DISTRITO SEDE" e o rotulo de recuo do TSE, nao uma afirmacao: o
        # Povoado da Choca e o Vereda Grande vem assim e ficam, no IBGE, em Sao
        # Sebastiao e Jose Goncalves. Tratar como distrito-sede filtraria fora a
        # resposta certa; melhor nao afirmar distrito nenhum.
        return None
    if n in cnefe["_dnome"]:
        return cnefe["_dnome"][n]
    tn = set(n.split())
    for nome, cod in cnefe["_dnome"].items():
        if set(nome.split()) == tn or sim(tn, set(nome.split())) >= 0.8:
            return cod
    return None


def carregar_inep(uf):
    """[{nome, endereco, x, y}] das escolas do catalogo do INEP naquela UF.

    O catalogo tem o nome OFICIAL da escola, que o CNEFE nao tem: la o campo e
    texto livre do recenseador e as vezes so diz "ESCOLA". Em compensacao so
    68,7% das 222.936 escolas tem coordenada -- as sem coordenada sao ignoradas.
    Espelho do IPEA (geobr), ano de referencia 2020."""
    if not os.path.exists(INEP_GPKG):
        print(f"  baixando catalogo de escolas do INEP ({INEP_URL})...", flush=True)
        baixar(INEP_URL, INEP_GPKG)
    con = sqlite3.connect(INEP_GPKG)
    con.text_factory = lambda b: b.decode("utf-8", "replace")
    try:
        linhas = con.execute("SELECT name_muni, name_school, address, geom "
                             "FROM schools_2020 WHERE abbrev_state=?", (uf,)).fetchall()
    finally:
        con.close()
    saida = collections.defaultdict(list)
    for muni, nome, endereco, blob in linhas:
        p = ponto_do_blob(blob)
        if p is None:
            continue
        saida[nz(muni)].append({"nome": nome, "endereco": endereco or "", "x": p[0], "y": p[1],
                                "_n": toks(nome), "_nz": nz(nome), "_e": toks(endereco)})
    return saida


def ponto_do_blob(blob):
    """(lon, lat) de um blob GeoPackage de POINT, ou None se a coordenada faltar.

    O cabecalho tem 8 bytes fixos mais um envelope opcional cujo tamanho vem
    codificado nos bits 1-3 das flags."""
    if not blob or len(blob) < 21:
        return None
    env = (blob[3] >> 1) & 0x07
    salto = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}.get(env)
    if salto is None:
        return None
    wkb = blob[8 + salto:]
    if len(wkb) < 21:
        return None
    fmt = "<" if wkb[0] == 1 else ">"
    x, y = struct.unpack(fmt + "dd", wkb[5:21])
    if math.isnan(x) or math.isnan(y):
        return None
    return x, y


def livre(x, y, ocupados):
    return all(dist_km((x, y), o) * 1000 >= PILHA_M for o in ocupados)


def espalhar(x, y, chave, ocupados, tentativas=14):
    """Afasta o ponto ate achar vaga, em direcao deduzida da chave do local.

    So vale para metodo APROXIMADO (localidade e distrito), onde a coordenada ja
    significa "algum ponto desta area": duas escolas do mesmo povoado a 300 m uma
    da outra e o retrato honesto; empilhadas nao e. Para o casamento exato nao
    se usa -- ali, colidir significa que o candidato e o mesmo estabelecimento
    que outro local ja levou, e o certo e tentar a proxima pista.

    Deterministico: rodar duas vezes da o mesmo lugar. O passo angular e o
    angulo aureo, para os pontos se distribuirem em vez de enfileirar."""
    h = hashlib.md5(str(chave).encode("utf-8")).digest()
    ang0 = 2 * math.pi * (h[0] * 256 + h[1]) / 65536.0
    for i in range(tentativas):
        raio = ESPALHAR_KM * (1 + i * 0.5)
        ang = ang0 + i * 2.39996323
        nx = x + raio * math.cos(ang) / (111.32 * math.cos(math.radians(y)))
        ny = y + raio * math.sin(ang) / 111.32
        if livre(nx, ny, ocupados):
            return round(nx, 7), round(ny, 7)
    return None


def perto_do_distrito(cnefe, ds_bairro, x, y):
    """A coordenada e compativel com o distrito que o ds_bairro declara?

    None quando nao ha distrito declarado -- nada a afirmar."""
    d = distrito_do_tse(ds_bairro, cnefe)
    if not d:
        return None
    pts = nuvem_do_distrito(cnefe, d)
    if not pts:
        return None
    return min(dist_km((x, y), p) for p in pts) <= DISTRITO_FORA_KM


def nuvem_do_distrito(cnefe, dist):
    """Amostra dos enderecos do CNEFE no distrito, para medir distancia ate ele."""
    ch = ("_nuvem", dist)
    if ch in cnefe["_centro_dist"]:
        return cnefe["_centro_dist"][ch]
    pts = [p for (d, _), v in cnefe["loc"].items() if d == dist for p in v]
    am = pts[::max(1, len(pts) // 400)] if len(pts) >= MIN_ENDERECOS else []
    cnefe["_centro_dist"][ch] = am
    return am


def centro_distrito(cnefe, dist):
    """(x, y, n) do centro do distrito: medoide dos enderecos do CNEFE nele."""
    if dist in cnefe["_centro_dist"]:
        return cnefe["_centro_dist"][dist]
    pts = [p for (d, _), v in cnefe["loc"].items() if d == dist for p in v]
    res = None
    if len(pts) >= MIN_ENDERECOS:
        amostra = pts[::max(1, len(pts) // 300)]
        m = min(amostra, key=lambda p: sum(dist_km(p, q) for q in amostra))
        res = (m[0], m[1], len(pts))
    cnefe["_centro_dist"][dist] = res
    return res


def centro_localidade(cnefe, chave):
    """(x, y, n, raio_km) da localidade, ou None se ela nao for um aglomerado."""
    if chave in cnefe["_centro"]:
        return cnefe["_centro"][chave]
    pts = cnefe["loc"].get(chave) or []
    res = None
    if len(pts) >= MIN_ENDERECOS:
        amostra = pts[::max(1, len(pts) // 300)]
        m = min(amostra, key=lambda p: sum(dist_km(p, q) for q in amostra))
        ds = sorted(dist_km(m, p) for p in pts)
        raio = ds[int(len(ds) * 0.75)]   # 3o quartil: tolera uma ponta, nao um distrito
        if raio <= ESPALHAMENTO_MAX_KM:
            res = (m[0], m[1], len(pts), raio)
    cnefe["_centro"][chave] = res
    return res


def casar(nm_locvot, ds_endereco, ds_bairro, cnefe, dentro, inep=(), ocupados=(), chave=""):
    """-> (x, y, metodo, confianca, evidencia) ou None.

    As pistas sao tentadas em ordem de precisao, e uma vaga ocupada nao encerra a
    busca: o candidato e descartado e a proxima pista entra. Foi o que faltava
    para a Escola Sao Domingos I, que casava com a MESMA escola do CNEFE que a
    Sao Domingos II ja tinha levado e por isso ficava sem nada -- agora ela cai
    no povoado Sao Domingos, ao lado da irma."""

    def colocar(x, y, metodo, conf, desc, aproximado=False):
        """Confere municipio e vaga. Metodo aproximado pode ser afastado."""
        if not dentro(x, y):
            return None
        if livre(x, y, ocupados):
            return x, y, metodo, conf, desc
        if not aproximado:
            return None
        p = espalhar(x, y, chave, ocupados)
        if p:
            return p[0], p[1], metodo, conf, desc + " | afastado do vizinho"
        return None

    nt, nzv = toks(nm_locvot), nz(nm_locvot)
    l_end, l_bai = limpa_loc(ds_endereco), limpa_loc(ds_bairro)
    t_end, t_bai = toks(l_end), toks(l_bai)
    dist = distrito_do_tse(ds_bairro, cnefe)
    nome_dist = cnefe["dists"].get(dist, "") if dist else ""
    sufixo = f" | distrito {nome_dist}" if dist else ""

    if nt and nzv not in GENERICO:
        # Duas passadas. Primeiro dentro do distrito do TSE, onde um homonimo e
        # improvavel e o limiar pode afrouxar. Depois no municipio inteiro, com
        # limiar cheio: o ds_bairro do TSE as vezes erra o distrito (a Escola
        # Artur Saldanha, no Vereda Grande, vem marcada como "DISTRITO SEDE"),
        # e um nome forte nao pode ser descartado por causa disso.
        for restrito in ([True, False] if dist else [False]):
            rank = []
            for e in cnefe["estab"]:
                if restrito and e["dist"] != dist:
                    continue
                ns = 1.0 if nzv == e["_nz"] else sim(nt, e["_n"])
                if ns < 0.5:
                    continue
                ls = 0.0
                for c, ct in ((l_end, t_end), (l_bai, t_bai)):
                    if c and c == e["_lz"]:
                        ls = max(ls, 1.0)
                    elif ct and e["_l"]:
                        ls = max(ls, sim(ct, e["_l"]))
                rank.append((ns + 0.6 * ls, ns, ls, e))
            rank = [r for r in sorted(rank, key=lambda t: -t[0]) if dentro(r[3]["x"], r[3]["y"])]
            if not rank:
                continue
            s, ns, ls, e = rank[0]
            margem = s - (rank[1][0] if len(rank) > 1 else 0.0)
            if ((ns >= 0.95 and ls >= 0.6) or (ns >= 0.95 and margem >= 0.3)
                    or (ns >= 0.75 and ls >= 0.6)
                    or (restrito and ns >= 0.66 and margem >= 0.2)):
                conf = "alta" if (ls >= 0.6 or (restrito and ns >= 0.95)) else "media"
                onde = sufixo if restrito else ""
                r = colocar(e["x"], e["y"], "estabelecimento", conf,
                            f"{e['nome']} [{e['loc']}]{onde}")
                if r:
                    return r

    # Catalogo do INEP: o nome oficial da escola. Vale menos que o CNEFE porque
    # nao traz distrito e o ano e 2020, entao o limiar e o cheio.
    if nt and nzv not in GENERICO and inep:
        rank = []
        for e in inep:
            ns = 1.0 if nzv == e["_nz"] else sim(nt, e["_n"])
            if ns < 0.6:
                continue
            ls = max((sim(toks(c), e["_e"]) for c in variantes_loc(ds_endereco) if c), default=0.0)
            rank.append((ns + 0.6 * ls, ns, ls, e))
        rank = [r for r in sorted(rank, key=lambda t: -t[0]) if dentro(r[3]["x"], r[3]["y"])]
        if rank:
            s, ns, ls, e = rank[0]
            margem = s - (rank[1][0] if len(rank) > 1 else 0.0)
            if (ns >= 0.95 and ls >= 0.5) or (ns >= 0.95 and margem >= 0.3):
                r = colocar(e["x"], e["y"], "escola_inep", "alta" if ls >= 0.5 else "media",
                            f"INEP: {e['nome']} [{e['endereco'][:44]}]")
                if r:
                    return r

    # Fallback posicional: centro da localidade, e so se ela for um aglomerado
    # coeso. O distrito continua sendo filtro duro aqui -- e ele que impede o
    # "POVOADO BARREIRO" do sul do municipio de receber o Barreiro do norte.
    # ds_bairro entra como candidato, menos quando nomeia um distrito: o centro
    # de um distrito inteiro so recriaria a pilha que estamos desfazendo.
    cands = list(variantes_loc(ds_endereco))
    if l_bai and not nz(ds_bairro).startswith("DISTRITO "):
        cands.append(l_bai)
    for cand in cands:
        if not cand:
            continue
        tc = toks(cand)
        # Nome identico primeiro; so depois o aproximado, que existe para o erro
        # de digitacao do recenseador ("LOGOA DA PEDA" por "LAGOA DA PEDRA").
        exatas = [k for k in cnefe["loc"]
                  if (not dist or k[0] == dist) and (k[1] == cand or (tc and toks(k[1]) == tc))]
        # Comparar tambem a string inteira, nao so os tokens: "LAGOA DA PEDRA"
        # contra "LOGOA DA PEDA" da 0,89 na string e so 0,50 nos tokens, porque
        # LAGOA/LOGOA sozinhos ficam em 0,80. Ja "LAGOA DE PATOS" contra "LAGOA
        # DE JUSTINO" fica em 0,73 e continua recusado.
        proximas = [k for k in cnefe["loc"]
                    if (not dist or k[0] == dist) and k not in exatas and tc
                    and (sim(tc, toks(k[1])) >= 0.8
                         or SequenceMatcher(None, cand, k[1]).ratio() >= 0.85)]
        for ch in (sorted(exatas, key=lambda k: -len(cnefe["loc"][k]))
                   + sorted(proximas, key=lambda k: -len(cnefe["loc"][k]))):
            c = centro_localidade(cnefe, ch)
            if not c:
                continue
            aprox = "" if ch in exatas else " ~"
            r = colocar(c[0], c[1], "localidade", "media",
                        f"localidade {ch[1]}{aprox} ({c[2]} enderecos, raio {c[3]:.1f} km){sufixo}",
                        aproximado=True)
            if r:
                return r

    # Ultimo recurso: o centro do distrito. A coordenada exata nao existe em
    # fonte nenhuma -- Fazenda Queimadas e Fazenda Lixa nao aparecem no CNEFE
    # nem no INEP nem no OpenStreetMap --, mas o DISTRITO e certo: vem do
    # ds_bairro do TSE cruzado com os distritos do IBGE. No meio do distrito
    # certo e uma aproximacao assumida; dentro de um bairro urbano a 30 km dele
    # e um erro que contamina o perfil censitario e a area de ponderacao.
    if dist:
        c = centro_distrito(cnefe, dist)
        if c:
            r = colocar(c[0], c[1], "distrito", "baixa",
                        f"centro do distrito {nome_dist} ({c[2]} enderecos)",
                        aproximado=True)
            if r:
                return r
    return None


# --------------------------------------------------------------------------- #
# deteccao
# --------------------------------------------------------------------------- #

def quebrados(linhas, poligonos, cnefe=None):
    """{nr_locvot: motivo} dos locais comprovadamente errados de um municipio.

    `linhas`: (fid, zona, local, nome, bairro, endereco, lon, lat, tipo).
    """
    ruins = {}
    for r in linhas:
        if poligonos and not dentro_do_poligono(r[6], r[7], poligonos):
            d = dist_fronteira_km(r[6], r[7], poligonos)
            if d > FORA_MIN_KM:
                ruins[r[2]] = f"fora do municipio ({d:.1f} km alem da divisa)"
        # Ponto que reposicionar_locais_fora_do_bairro.py moveu: ele foi levado
        # para o medoide dos "irmaos" de bairro, e nestes municipios os irmaos
        # eram a propria pilha. A marca e a confissao do problema.
        if r[8] == MARCA_REPOSICIONADO:
            ruins.setdefault(r[2], "movido por reposicionar_locais_fora_do_bairro.py")
    for r in linhas:
        perto = [o for o in linhas if dist_km((r[6], r[7]), (o[6], o[7])) * 1000 < PILHA_M]
        if len(perto) < PILHA_MIN:
            continue
        # Tres escolas no mesmo quarteirao de uma cidade grande e normal -- em
        # Feira de Santana isso acontece e nao e erro. Tres POVOADOS no mesmo
        # pixel e impossivel: e a pilha do geocodificador. So ela conta.
        rurais = [o for o in perto if any(t in nz(o[5]) for t in RURAL)]
        locs = {limpa_loc(o[5]) for o in rurais if limpa_loc(o[5])}
        if len(rurais) >= PILHA_MIN and len(locs) >= PILHA_MIN:
            ruins.setdefault(r[2], f"pilha de {len(perto)} locais em {PILHA_M:.0f} m "
                                   f"({len(locs)} localidades rurais distintas)")

    # Local que declara um distrito no ds_bairro mas esta longe de qualquer
    # endereco dele. E o que pega o RESIDUO da pilha: quando a maioria ja saiu,
    # sobram dois ou tres pontos que nao formam mais "pilha" pelo criterio de
    # cima, e continuam no bairro errado. Foi o caso das escolas Fazenda
    # Queimadas e Fazenda Lixa (Inhobim) e Sao Domingos I (Sao Sebastiao), que
    # ficaram em Candeias a 33 km do proprio distrito.
    #
    # "DISTRITO SEDE" nao entra: distrito_do_tse o trata como rotulo de recuo,
    # sem afirmacao de lugar. Medido: pega 11 de 142 locais em Vitoria da
    # Conquista e 1 de 9 em Mascote, e ZERO em Belo Campo e Feira de Santana.
    if cnefe:
        for r in linhas:
            d = distrito_do_tse(r[4], cnefe)
            if not d:
                continue
            pts = nuvem_do_distrito(cnefe, d)
            if not pts:
                continue
            longe = min(dist_km((r[6], r[7]), p) for p in pts)
            if longe > DISTRITO_FORA_KM:
                ruins.setdefault(r[2], f"a {longe:.0f} km do distrito "
                                       f"{cnefe['dists'].get(d, d)}, que o endereco declara")
    return ruins


def chave_local(cod, zona, local):
    """Chave estavel de um local de votacao.

    nr_zona e nr_locvot sao TEXT no GeoPackage e inteiros no CSV -- sem
    normalizar, as duas pontas nunca se encontram."""
    def n(v):
        try:
            return int(str(v).strip())
        except (TypeError, ValueError):
            return str(v).strip()
    return (int(cod), n(zona), n(local))


def originais_reposicionados():
    """{(ibge, zona, local): (lon, lat)} do CSV do script de reposicionamento."""
    if not os.path.exists(CSV_REPOSICIONADOS):
        return {}
    out = {}
    with open(CSV_REPOSICIONADOS, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out[chave_local(r["ibge"], r["zona"], r["local"])] = (
                float(r["lon_antigo"]), float(r["lat_antigo"]))
    return out


# --------------------------------------------------------------------------- #
# gravacao
# --------------------------------------------------------------------------- #

def blob_ponto(lon, lat):
    """Blob GeoPackage de um POINT 4326, no mesmo formato ja usado nos arquivos."""
    return (struct.pack("<BBBBi", 0x47, 0x50, 0, 1, 4326)
            + struct.pack("<BIdd", 1, 1, lon, lat))


def gravar(con, tabela, correcoes, tem_tipo):
    if tem_tipo:
        con.executemany(
            f"UPDATE {tabela} SET long=?, lat=?, geom=?, tipo_match=? WHERE fid=?",
            [(x, y, blob_ponto(x, y), MARCA[m], fid) for fid, x, y, m in correcoes])
    else:
        con.executemany(
            f"UPDATE {tabela} SET long=?, lat=?, geom=? WHERE fid=?",
            [(x, y, blob_ponto(x, y), fid) for fid, x, y, _ in correcoes])

    # O site le long/lat direto e nunca consulta o indice espacial, mas deixar o
    # rtree apontando para as coordenadas velhas quebra o arquivo em qualquer GIS.
    rtree = f"rtree_{tabela}_geom"
    if con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                   (rtree,)).fetchone():
        con.execute(f'DELETE FROM "{rtree}"')
        con.execute(f'INSERT INTO "{rtree}"(id, minx, maxx, miny, maxy) '
                    f"SELECT fid, long, long, lat, lat FROM {tabela} "
                    f"WHERE long IS NOT NULL AND lat IS NOT NULL")
    con.execute(
        "UPDATE gpkg_contents SET min_x=(SELECT min(long) FROM %s), "
        "min_y=(SELECT min(lat) FROM %s), max_x=(SELECT max(long) FROM %s), "
        "max_y=(SELECT max(lat) FROM %s) WHERE table_name=?" % ((tabela,) * 4), (tabela,))
    con.commit()
    con.execute("VACUUM")


# --------------------------------------------------------------------------- #
# relatorio
# --------------------------------------------------------------------------- #

def escrever_html(registros, caminho):
    pontos = [r for r in registros if r["lon_novo"]]
    if not pontos:
        return
    centro = (sum(p["lat_novo"] for p in pontos) / len(pontos),
              sum(p["lon_novo"] for p in pontos) / len(pontos))
    dados = json.dumps([{k: r[k] for k in ("municipio", "ano", "zona", "local", "nome",
                                           "bairro", "endereco", "lon_antigo", "lat_antigo",
                                           "lon_novo", "lat_novo", "km", "metodo",
                                           "confianca", "evidencia", "motivo")}
                        for r in pontos], ensure_ascii=False)
    html = """<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Revisao dos locais corrigidos</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<style>
  :root{--bg:#fff;--fg:#1a1a1a;--mut:#666;--lin:#e0e0e0;--old:#d33;--new:#2a7;}
  @media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#15171a;--fg:#e8e8e8;--mut:#9aa;--lin:#2c3036;}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;display:flex;height:100vh}
  #lista{width:420px;min-width:300px;overflow:auto;border-right:1px solid var(--lin)}
  #mapa{flex:1}
  h1{font-size:15px;margin:0;padding:14px 16px;border-bottom:1px solid var(--lin);position:sticky;top:0;background:var(--bg);z-index:5}
  h1 small{display:block;font-weight:400;color:var(--mut);margin-top:3px}
  .it{padding:11px 16px;border-bottom:1px solid var(--lin);cursor:pointer}
  .it:hover{background:rgba(127,127,127,.09)}
  .it b{display:block;font-size:13px}
  .it span{color:var(--mut);font-size:12px}
  .tag{display:inline-block;padding:1px 6px;border-radius:3px;font-size:11px;margin-top:4px}
  .alta{background:#2a7;color:#fff}.media{background:#c80;color:#fff}.baixa{background:#888;color:#fff}
  @media(max-width:760px){body{flex-direction:column}#lista{width:100%;height:45%;border-right:0;border-bottom:1px solid var(--lin)}}
</style></head><body>
<div id="lista"><h1>Locais corrigidos<small id="sub"></small></h1><div id="itens"></div></div>
<div id="mapa"></div>
<script>
const D = __DADOS__;
const map = L.map('mapa').setView([__LAT__, __LON__], 9);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  {maxZoom:19, attribution:'&copy; OpenStreetMap'}).addTo(map);
document.getElementById('sub').textContent =
  D.length + ' pontos | vermelho = onde estava, verde = onde passou a ficar';
const grupo = L.layerGroup().addTo(map);
D.forEach((r,i) => {
  const a = L.circleMarker([r.lat_antigo, r.lon_antigo],
    {radius:5, color:'#d33', weight:2, fillOpacity:.55});
  const b = L.circleMarker([r.lat_novo, r.lon_novo],
    {radius:6, color:'#2a7', weight:2, fillOpacity:.75});
  const linha = L.polyline([[r.lat_antigo,r.lon_antigo],[r.lat_novo,r.lon_novo]],
    {color:'#888', weight:1, dashArray:'4,4'});
  const txt = `<b>${r.nome}</b><br>${r.municipio} &middot; zona ${r.zona}, local ${r.local}` +
    `<br><i>${r.endereco}</i><br><br><b>Motivo:</b> ${r.motivo}` +
    `<br><b>Metodo:</b> ${r.metodo} (${r.confianca})<br><b>CNEFE:</b> ${r.evidencia}` +
    `<br><b>Moveu:</b> ${r.km} km`;
  a.bindPopup(txt); b.bindPopup(txt);
  grupo.addLayer(linha); grupo.addLayer(a); grupo.addLayer(b);
  r._b = b;
  const div = document.createElement('div');
  div.className = 'it';
  div.innerHTML = `<b>${r.nome}</b><span>${r.municipio} &middot; ${r.endereco}</span>` +
    `<span>${r.evidencia}</span><span class="tag ${r.confianca}">${r.metodo} &middot; ${r.confianca} &middot; ${r.km} km</span>`;
  div.onclick = () => { map.setView([r.lat_novo, r.lon_novo], 14); b.openPopup(); };
  document.getElementById('itens').appendChild(div);
});
map.fitBounds(grupo.getBounds(), {padding:[30,30]});
</script></body></html>"""
    html = (html.replace("__DADOS__", dados)
                .replace("__LAT__", f"{centro[0]:.5f}").replace("__LON__", f"{centro[1]:.5f}"))
    with open(caminho, "w", encoding="utf-8") as f:
        f.write(html)


# --------------------------------------------------------------------------- #

def main():
    simular = "--simular" in sys.argv
    if not os.path.isdir(DATA_DIR):
        raise SystemExit(f"{DATA_DIR} nao encontrado -- rode da raiz do repositorio.")
    print("simulacao (nada e escrito)\n" if simular else "")

    malhas, nomes = {}, {}
    for cod in MUNICIPIOS:
        uf = UF_POR_COD[cod // 100000]
        if uf not in malhas:
            malhas[uf] = carregar_malha(uf)
            svg = os.path.join(DATA_DIR, "municipios_svg", f"municipios_{uf}.json")
            if os.path.exists(svg):
                for c, n, _ in json.load(open(svg, encoding="utf-8"))["p"]:
                    nomes[int(c)] = n

    cnefes, ineps, registros = {}, {}, []
    reposicionados = originais_reposicionados()
    # (ibge, zona, local) -> (x, y, metodo, confianca, evidencia): o mesmo local
    # recebe a mesma coordenada em todos os anos.
    decidido = {}

    for ano, nome_zip, tabela in ALVOS:
        caminho_zip = os.path.join(DATA_DIR, nome_zip)
        if not os.path.exists(caminho_zip):
            print(f"{nome_zip:<48} ausente, pulando")
            continue

        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
            with zipfile.ZipFile(caminho_zip) as z:
                entrada = next(n for n in z.namelist() if n.lower().endswith(".gpkg"))
                destino = os.path.join(tmp, entrada)
                with open(destino, "wb") as f:
                    f.write(z.read(entrada))

            con = sqlite3.connect(destino)
            con.text_factory = lambda b: b.decode("utf-8", "replace")
            colunas = {r[1] for r in con.execute(f'PRAGMA table_info("{tabela}")')}
            tem_tipo = "tipo_match" in colunas
            col_tipo = "tipo_match" if tem_tipo else "''"
            total = con.execute(f"SELECT count(*) FROM {tabela}").fetchone()[0]

            correcoes = []
            for cod in MUNICIPIOS:
                poligonos = malhas[UF_POR_COD[cod // 100000]].get(cod)
                linhas = [r for r in con.execute(
                    f"SELECT fid, nr_zona, nr_locvot, nm_locvot, ds_bairro, ds_endereco,"
                    f' long, lat, {col_tipo} FROM "{tabela}" WHERE cod_localidade_ibge=?',
                    (cod,)) if r[6] is not None]
                if not linhas:
                    continue
                # O CNEFE entra ANTES da deteccao: um dos criterios e a
                # distancia ate o proprio distrito, e o distrito vem dele.
                if cod not in cnefes:
                    print(f"  CNEFE {cod} {nomes.get(cod, '')}...", flush=True)
                    cnefes[cod] = carregar_cnefe(cod)
                ruins = quebrados(linhas, poligonos, cnefes[cod])
                if not ruins:
                    continue
                uf_cod = UF_POR_COD[cod // 100000]
                if uf_cod not in ineps:
                    ineps[uf_cod] = carregar_inep(uf_cod)
                escolas_inep = ineps[uf_cod].get(nz(nomes.get(cod, "")), [])

                def dentro(x, y, _p=poligonos):
                    return dentro_do_poligono(x, y, _p) if _p else True

                # Ja corrigidos neste ano/municipio: nenhuma correcao pode cair
                # em cima de outro local -- senao trocamos uma pilha por outra.
                ocupados = [(r[6], r[7]) for r in linhas if r[2] not in ruins]

                for r in sorted(linhas, key=lambda r: r[2]):
                    if r[2] not in ruins:
                        continue
                    chave = chave_local(cod, r[1], r[2])
                    if chave not in decidido:
                        res = casar(r[3], r[5], r[4], cnefes[cod], dentro, escolas_inep,
                                    ocupados, chave)
                        # A coordenada original do TSE, quando existe e cai dentro
                        # do distrito declarado, vale MAIS que o centro do
                        # distrito: e um ponto especifico, nao uma media. Por
                        # isso ela tambem desbanca o metodo "distrito" -- a
                        # Escola Genny Fernandes tem original a 0 km do Inhobim,
                        # e o centroide a levaria 9 km para longe dela.
                        orig = reposicionados.get(chave)
                        if orig and dentro(*orig) and (res is None or res[2] == "distrito"):
                            if perto_do_distrito(cnefes[cod], r[4], *orig) is not False:
                                res = (orig[0], orig[1], "revertido", "media",
                                       "coordenada original do TSE, anterior ao "
                                       "reposicionamento por bairro")
                        decidido[chave] = res
                    res = decidido[chave]
                    if res is None:
                        registros.append({
                            "ibge": cod, "municipio": nomes.get(cod, cod), "ano": ano, "zona": r[1],
                            "local": r[2], "nome": r[3], "bairro": r[4], "endereco": r[5],
                            "lon_antigo": r[6], "lat_antigo": r[7], "lon_novo": "",
                            "lat_novo": "", "km": "", "metodo": "nao corrigido",
                            "confianca": "", "evidencia": "sem correspondencia no CNEFE",
                            "motivo": ruins[r[2]]})
                        continue
                    x, y, met, conf, ev = res
                    if any(dist_km((x, y), o) * 1000 < PILHA_M for o in ocupados):
                        registros.append({
                            "ibge": cod, "municipio": nomes.get(cod, cod), "ano": ano, "zona": r[1],
                            "local": r[2], "nome": r[3], "bairro": r[4], "endereco": r[5],
                            "lon_antigo": r[6], "lat_antigo": r[7], "lon_novo": "",
                            "lat_novo": "", "km": "", "metodo": "nao corrigido",
                            "confianca": "", "evidencia": f"descartado: {ev} cairia sobre "
                                                          f"outro local (< {PILHA_M:.0f} m)",
                            "motivo": ruins[r[2]]})
                        continue
                    ocupados.append((x, y))
                    correcoes.append((r[0], x, y, met))
                    registros.append({
                        "ibge": cod, "municipio": nomes.get(cod, cod), "ano": ano, "zona": r[1],
                        "local": r[2], "nome": r[3], "bairro": r[4], "endereco": r[5],
                        "lon_antigo": r[6], "lat_antigo": r[7],
                        "lon_novo": round(x, 7), "lat_novo": round(y, 7),
                        "km": round(dist_km((r[6], r[7]), (x, y)), 2),
                        "metodo": met, "confianca": conf, "evidencia": ev,
                        "motivo": ruins[r[2]]})

            if correcoes and not simular:
                gravar(con, tabela, correcoes, tem_tipo)
            conferido = con.execute(f"SELECT count(*) FROM {tabela}").fetchone()[0]
            con.close()
            if conferido != total:
                raise SystemExit(f"{nome_zip}: contagem mudou ({total} -> {conferido})")

            if correcoes and not simular:
                with zipfile.ZipFile(caminho_zip, "w", zipfile.ZIP_DEFLATED) as z:
                    z.write(destino, entrada)
                if entrada == COPIA_SOLTA_2006:
                    shutil.copyfile(destino, os.path.join(DATA_DIR, COPIA_SOLTA_2006))

        print(f"{nome_zip:<48} {total:>6} linhas | corrigidos {len(correcoes):>4}")

    corrigidos = [r for r in registros if r["lon_novo"] != ""]
    if registros:
        campos = ["ibge", "municipio", "ano", "zona", "local", "nome", "bairro", "endereco",
                  "lon_antigo", "lat_antigo", "lon_novo", "lat_novo", "km", "metodo",
                  "confianca", "evidencia", "motivo"]
        with open(CSV_SAIDA, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=campos, extrasaction="ignore")
            w.writeheader()
            for r in sorted(registros, key=lambda x: (x["municipio"], x["local"], x["ano"])):
                w.writerow(r)
        recentes = [r for r in corrigidos if r["ano"] == max(a for a, _, _ in ALVOS)]
        escrever_html(recentes or corrigidos, HTML_SAIDA)

        por_metodo = collections.Counter(r["metodo"] for r in registros)
        print(f"\n{len(corrigidos)} correcoes (todos os anos), "
              f"{len(registros) - len(corrigidos)} sem correspondencia")
        for m, n in por_metodo.most_common():
            print(f"   {m:<22} {n:>5}")
        print(f"\nConferencia: {CSV_SAIDA}")
        print(f"Mapa:        {HTML_SAIDA}")
        if not simular:
            print("Regerar o indice de areas: py scripts/gerar_areas_ponderacao.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
