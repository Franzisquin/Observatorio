"""Reconstroi os arquivos resultados_geo/Historico * usando o hist_id.

O QUE MUDA
----------
Antes, a identidade do predio era adivinhada ao montar o arquivo: casava-se cada
resultado novo com o historico existente por uma escada de chaves exatas, em que
zona+local pesava 0,9 e o nome pesava 0,6. Quando o TSE reusa um numero de local
para outro predio, o numero ganhava do nome e colava a escola errada; quando a
escola mudava de numero, o historico dela partia em dois.

Agora a identidade vem pronta de scripts/gerar_identidade_historico.py, gravada na
coluna hist_id dos GPKGs por scripts/gravar_hist_id_gpkg.py. Este script so agrupa
por ela. A escada antiga continua sendo emitida como alias de fallback, para o
local que ficou sem hist_id (linhas com ibge 0 e as que a v0.15 nao cobre).

ANOS ANTERIORES A 2006
----------------------
1998/2000/2002/2004 nao existem na v0.15. Eles usam a malha de pontos do GPKG de
2006 -- que e o mesmo que js/data-geral-2002.js faz para desenhar 2002 no mapa --
e portanto herdam o hist_id do local de 2006 de graca. Assim o historico casa
exatamente com o que o mapa mostra.

Rodar da raiz do repo (opcionalmente com uma lista de UFs):
    python scripts/gerar_historico.py
    python scripts/gerar_historico.py AM,SP
Desfazer:  git checkout -- resultados_geo/
"""

import io
import json
import os
import sqlite3
import sys
import tempfile
import zipfile
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scratch"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import generate_histories as G  # noqa: E402  (reusa a apuracao de votos, ja em uso)

# hist_id na frente: e a unica chave calculada, todas as outras sao heuristica.
# A ordem so precisa bater com o proprio arquivo -- o JS le history.match_types.
MATCH_TYPES = ["hist_id"] + list(G.MATCH_TYPES)
CONFIDENCE = dict(G.CONFIDENCE_BY_MATCH, hist_id=1.2)

ANOS_MAJORITARIA = [1998, 2002, 2006, 2010, 2014, 2018, 2022]
ANOS_PREFEITO = [2000, 2004, 2008, 2012, 2016, 2020, 2024]

# ano -> (zip do gpkg, tabela). Anos anteriores a 2006 caem na malha de 2006.
GPKG = {
    2006: ("locais_votacao_2006_gkpg.zip", "locais_votacao_2006_padronizado"),
    2008: ("locais_votacao_2008_gkpg.zip", "locais_votacao_2008_padronizado"),
    2010: ("locais_votacao_2010_gkpg.zip", "locais_votacao_2010_ENRIQUECIDO"),
    2012: ("locais_votacao_2012_gkpg.zip", "locais_votacao_2012_ENRIQUECIDO"),
    2014: ("locais_votacao_2014_gkpg.zip", "locais_votacao_2014_ENRIQUECIDO"),
    2016: ("locais_votacao_2016_gkpg.zip", "locais_votacao_2016_ENRIQUECIDO"),
    2018: ("locais_votacao_2018_gkpg.zip", "locais_votacao_2018_ENRIQUECIDO"),
    2020: ("locais_votacao_2020_gkpg.zip", "locais_votacao_2020_ENRIQUECIDO"),
    2022: ("locais_votacao_2022_gpkg.zip", "locais_votacao_2022_ENRIQUECIDO"),
    2024: ("locais_votacao_2024_gkpg.zip", "locais_votacao_2024_atualizado_2"),
}
ANO_MALHA = {1998: 2006, 2000: 2006, 2002: 2006, 2004: 2006}

CARGOS = [
    ("presidente", "Historico Presidente", "historico_presidente", ANOS_MAJORITARIA),
    ("governador", "Historico Governador", "historico_governador", ANOS_MAJORITARIA),
    ("senador", "Historico Senador", "historico_senador", ANOS_MAJORITARIA),
]

_CONN = {}
_LOCAIS = {}
_RESULTADOS = {}
_TSE_IBGE = None
_SUPLEMENTO = None

SUPLEMENTO_ZIP = "resultados_geo/locais_suplemento_rmsp.zip"


def suplemento_rmsp():
    """Locais da RM de Sao Paulo em 1998/2002 vindos do CEM, casados com o TSE por
    assinatura de votos (scripts/gerar_suplemento_rmsp.py).

    Sem isto, 571 urnas de 2002 na RMSP nao entram no historico: elas nao existem na
    malha de 2006, que e de onde os anos pre-2006 tiram os locais."""
    global _SUPLEMENTO
    if _SUPLEMENTO is None:
        _SUPLEMENTO = {}
        if os.path.exists(SUPLEMENTO_ZIP):
            with zipfile.ZipFile(SUPLEMENTO_ZIP) as z:
                _SUPLEMENTO = json.loads(
                    z.read("locais_suplemento_rmsp.json").decode("utf-8"))
    return _SUPLEMENTO


def tse_para_ibge():
    """Codigo de municipio do TSE -> IBGE7. A chave dos resultados usa o codigo do
    TSE e o GPKG guarda o do IBGE; sem a ponte nao da para casar por municipio."""
    global _TSE_IBGE
    if _TSE_IBGE is None:
        with open("resultados_geo/tse_para_ibge.json", encoding="utf-8") as f:
            _TSE_IBGE = {str(k): int(v) for k, v in json.load(f).items() if v}
    return _TSE_IBGE


def carregar_resultados(cargo, ano, uf):
    """{(zona, local): {cdmun, turn_records, results_key}} de um cargo/ano/UF.

    Nao da para usar G.load_results_for_year: ela le so namelist()[0], e o zip
    municipal traz um JSON POR MUNICIPIO (124 entradas em AM 2024, contando os
    _resumo). Ler so a primeira entrada rendia 2 municipios de 62. Cada entrada
    tambem tem a propria lista de candidatos, entao cand_names e por entrada.

    So o subtipo "ord": suplementares nunca estiveram no painel Historico e
    inclui-las mudaria o que ele mostra, o que nao e o assunto aqui.
    """
    chave_cache = (cargo, ano, uf)
    if chave_cache in _RESULTADOS:
        return _RESULTADOS[chave_cache]

    por_chave = {}
    for turno in (1, 2):
        caminho = G.find_results_zip(cargo, ano, turno, uf)
        if not caminho:
            continue
        with zipfile.ZipFile(caminho) as z:
            for nome in z.namelist():
                if not nome.endswith(".json") or nome.endswith("_resumo.json"):
                    continue
                dados = json.loads(z.read(nome).decode("utf-8"))
                cands = dados.get("METADATA", {}).get("cand_names", {})
                for k, votos in dados.get("RESULTS", {}).items():
                    por_chave.setdefault(k, {})[turno] = (votos, cands)

    saida = {}
    for k, turnos in por_chave.items():
        if "_S" in k:  # chave sintetica (municipio sem detalhe por local)
            continue
        partes = k.split("_")
        if len(partes) != 3:
            continue
        try:
            zona, cdmun, local = int(partes[0]), int(partes[1]), int(partes[2])
        except ValueError:
            continue
        registros = []
        for turno, rotulo in ((1, "1T"), (2, "2T")):
            if turno in turnos:
                r = G.compute_turn_record(rotulo, *turnos[turno])
                if r:
                    registros.append(r)
        if registros:
            # A chave TEM de incluir o municipio: a zona eleitoral atravessa
            # municipios e o numero do local recomeca em cada um, entao (zona,
            # local) sozinho colide. Em 2014 isso colapsaria as 96.448 urnas do
            # pais em 78.609 -- 18% sumindo, 35% em TO.
            saida[(zona, cdmun, local)] = {"cdmun": cdmun, "turn_records": registros,
                                           "results_key": k}

    _RESULTADOS[chave_cache] = saida
    return saida


def candidatos(cargo, ano, turno, uf="SP"):
    """cand_names do acervo, para transformar voto em registro de historico."""
    chave = ("meta", cargo, ano, turno, uf)
    if chave not in _RESULTADOS:
        caminho = G.find_results_zip(cargo, ano, turno, uf)
        nomes = {}
        if caminho:
            with zipfile.ZipFile(caminho) as z:
                nome = next(n for n in z.namelist()
                            if n.endswith(".json") and not n.endswith("_resumo.json"))
                dados = json.loads(z.read(nome).decode("utf-8"))
                nomes = dados.get("METADATA", {}).get("cand_names", {})
        _RESULTADOS[chave] = nomes
    return _RESULTADOS[chave]


def registros_suplemento(cargo, ano, uf):
    """Registros de historico das estacoes do CEM que so existem como SECAO.

    Em 1998 na RMSP, 295 predios nao tem chave de local no acervo -- os votos deles
    estao espalhados em chaves {zona}_{municipio}_S{n}, que nenhum local reivindica.
    O mapa ja desenha esses predios (js/data-geral-2006.js, applyRmspSecoes1998); sem
    isto aqui, eles apareceriam no mapa mas o painel Historico pularia 1998, mesmo
    tendo o mesmo hist_id do local de 2002 em diante.

    O numero de local do registro e o COD_LV do CEM, que nao e numeracao do TSE --
    serve so para distinguir os registros; a identidade vem do hist_id.
    """
    if uf != "SP":
        return []
    estacoes = suplemento_rmsp().get(str(ano), {}).get("estacoes", [])
    saida = []
    for e in estacoes:
        por_turno = e.get("votos", {}).get(cargo, {})
        if not por_turno:
            continue
        turnos = []
        for turno in (1, 2):
            votos = por_turno.get(f"{turno}T")
            if not votos:
                continue
            r = G.compute_turn_record(f"{turno}T", votos, candidatos(cargo, ano, turno, uf))
            if r:
                turnos.append(r)
        if not turnos:
            continue
        try:
            local = int(str(e["chave"]).rsplit("C", 1)[1])
        except (IndexError, ValueError):
            local = 0
        registro = [ano, e.get("nm_localidade", ""), e.get("nm_locvot", ""),
                    e.get("ds_bairro", ""), e["nr_zona"], local,
                    f"{e['nr_zona']}_{local}", turnos]
        props = {
            "sg_uf": uf, "nr_zona": e["nr_zona"], "nr_locvot": local,
            "nm_localidade": e.get("nm_localidade", ""),
            "nm_locvot": e.get("nm_locvot", ""),
            "ds_endereco": e.get("ds_endereco", ""),
            "ds_bairro": e.get("ds_bairro", ""),
            "lat": e.get("lat", 0.0), "long": e.get("long", 0.0),
            "hist_id": e.get("hist_id"), "id_unico": e["chave"],
        }
        saida.append((e.get("hist_id"), e["nr_zona"], local, registro, props))
    return saida


def conexao(ano, tmpdir):
    if ano in _CONN:
        return _CONN[ano]
    nome_zip, tabela = GPKG[ano]
    with zipfile.ZipFile(os.path.join("resultados_geo", nome_zip)) as z:
        entrada = next(n for n in z.namelist() if n.lower().endswith(".gpkg"))
        destino = os.path.join(tmpdir, entrada)
        if not os.path.exists(destino):
            with open(destino, "wb") as f:
                f.write(z.read(entrada))
    _CONN[ano] = (sqlite3.connect(destino), tabela)
    return _CONN[ano]


def locais(uf, ano, tmpdir):
    """Locais do ano, direto do GPKG que o mapa usa.

    Devolve (por_ibge, por_zona_local):
      por_ibge[(zona, ibge7, local)]  -- indice bom, sem colisao entre municipios
      por_zona_local[(zona, local)]   -- so as chaves que sao unicas na UF, para
                                         resgatar as ~900 linhas por ano cujo
                                         cod_localidade_ibge vem zerado
    """
    # Cache pelo ANO, nao pela malha: 1998 e 2002 leem os dois o GPKG de 2006 mas
    # recebem suplementos diferentes da RMSP.
    if (uf, ano) in _LOCAIS:
        return _LOCAIS[(uf, ano)]

    malha = ANO_MALHA.get(ano, ano)
    con, tabela = conexao(malha, tmpdir)
    por_ibge, por_zl = {}, {}
    quantos = defaultdict(int)
    for ibge, zo, l, muni, nome, end, bairro, lon, lat, hid in con.execute(
        f"SELECT cod_localidade_ibge, nr_zona, nr_locvot, nm_localidade, nm_locvot, "
        f"ds_endereco, ds_bairro, long, lat, hist_id FROM {tabela} WHERE sg_uf = ?",
        (uf,)
    ):
        try:
            zona, local = int(zo), int(l)
        except (TypeError, ValueError):
            continue
        if zona <= 0 or local <= 0:
            continue
        props = {
            "sg_uf": uf, "nr_zona": zona, "nr_locvot": local,
            "nm_localidade": muni or "", "nm_locvot": nome or "",
            "ds_endereco": end or "", "ds_bairro": bairro or "",
            "lat": float(lat) if lat is not None else 0.0,
            "long": float(lon) if lon is not None else 0.0,
            "hist_id": hid,
        }
        try:
            codigo = int(ibge)
        except (TypeError, ValueError):
            codigo = 0
        if codigo:
            por_ibge[(zona, codigo, local)] = props
        quantos[(zona, local)] += 1
        por_zl[(zona, local)] = props

    por_zl = {k: v for k, v in por_zl.items() if quantos[k] == 1}

    # Suplemento do CEM na RM de Sao Paulo: coordenada medida no ano da eleicao e,
    # nas urnas que a malha de 2006 nao tem, o local inteiro.
    supl = (suplemento_rmsp().get(str(ano), {}).get("locais", {})
            if uf == "SP" else {})
    if supl:
        ponte = tse_para_ibge()
        for chave, reg in supl.items():
            partes = chave.split("_")
            try:
                zona, cd, local = int(partes[0]), int(partes[1]), int(partes[2])
            except (IndexError, ValueError):
                continue
            ibge = ponte.get(str(cd))
            if not ibge:
                continue
            props = por_ibge.get((zona, ibge, local))
            if props is None:
                props = {
                    "sg_uf": uf, "nr_zona": zona, "nr_locvot": local,
                    "nm_localidade": reg.get("nm_localidade", ""),
                    "nm_locvot": reg.get("nm_locvot", ""),
                    "ds_endereco": reg.get("ds_endereco", ""),
                    "ds_bairro": reg.get("ds_bairro", ""),
                    "hist_id": reg.get("hist_id"),
                }
                por_ibge[(zona, ibge, local)] = props
            props["lat"] = reg["lat"]
            props["long"] = reg["long"]
            if reg.get("hist_id") is not None:
                props["hist_id"] = reg["hist_id"]

    _LOCAIS[(uf, ano)] = (por_ibge, por_zl)
    return _LOCAIS[(uf, ano)]


def montar(cargo, uf, anos, tmpdir, filtro_cdmun=None):
    """Monta o dicionario de historico de um cargo/UF (ou de um municipio)."""
    por_identidade = defaultdict(list)
    props_de = {}

    ponte = tse_para_ibge()
    for ano in anos:
        por_ibge, por_zl = locais(uf, ano, tmpdir)
        for (zona, cdmun, local), res in carregar_resultados(cargo, ano, uf).items():
            if filtro_cdmun is not None and cdmun != filtro_cdmun:
                continue
            ibge = ponte.get(str(cdmun))
            info = por_ibge.get((zona, ibge, local)) if ibge else None
            if info is None:
                info = por_zl.get((zona, local))
            if not info:
                continue  # sem geolocalizacao: o mapa tambem nao desenha
            # Sem hist_id (ibge 0, local fora da v0.15) cai numa identidade propria
            # por zona/local, que e exatamente o comportamento antigo.
            chave = ("h", info["hist_id"]) if info["hist_id"] is not None else ("zl", zona, local)
            por_identidade[chave].append((ano, info, res))
            props_de.setdefault(chave, []).append(dict(info, id_unico=res["results_key"]))

    # Predios que so existem como SECAO no acervo de 1998 (RMSP): o voto deles nao
    # tem chave de local, entao nao vem do laco acima. O mapa ja os desenha; sem
    # isto o painel pularia 1998 num predio que tem 2002 em diante.
    extras = defaultdict(list)
    if filtro_cdmun is None and 1998 in anos:
        for hist_id, zona, local, registro, props in registros_suplemento(cargo, 1998, uf):
            chave = ("h", hist_id) if hist_id is not None else ("zl", zona, local)
            extras[chave].append(registro)
            props_de.setdefault(chave, []).append(props)

    identities, aliases = [], {}
    todas = set(por_identidade) | set(extras)
    for chave in sorted(todas, key=lambda c: (str(c[0]), tuple(map(str, c[1:])))):
        membros = sorted(por_identidade.get(chave, []), key=lambda m: m[0])
        registros = [[ano, info["nm_localidade"], info["nm_locvot"], info["ds_bairro"],
                      info["nr_zona"], info["nr_locvot"],
                      f"{info['nr_zona']}_{info['nr_locvot']}", res["turn_records"]]
                     for ano, info, res in membros]
        registros.extend(extras.get(chave, []))
        registros.sort(key=lambda r: G.get_history_year_sort_value(r[0]))
        if not registros:
            continue
        idx = len(identities)
        identities.append(registros)

        for props in props_de[chave]:
            candidatos = list(G.build_president_history_aliases(props))
            if props["hist_id"] is not None:
                candidatos.insert(0, f"hist_id:{props['hist_id']}")
            for alias in candidatos:
                tipo = next((t for t in MATCH_TYPES if alias.startswith(t + ":")), "local_key")
                novo = MATCH_TYPES.index(tipo)
                antigo = aliases.get(alias)
                # Alias disputado fica com quem tem a chave mais forte, como antes.
                if antigo is None or CONFIDENCE.get(tipo, 0.4) > CONFIDENCE.get(
                        MATCH_TYPES[antigo[1]], 0.4):
                    aliases[alias] = [idx, novo]

    return {
        "schema": 2, "cargo": cargo, "uf": uf,
        "match_types": MATCH_TYPES,
        "years": list(anos),
        "identities": identities,
        "aliases": aliases,
    }


def escrever_zip(caminho, nome_json, dados):
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    with zipfile.ZipFile(caminho, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(nome_json, json.dumps(dados, ensure_ascii=False, separators=(",", ":")))


def fazer_prefeito(uf, tmpdir):
    """Um zip externo por UF, com um zip interno por municipio."""
    caminho = f"resultados_geo/Historico Prefeito/historico_prefeito_{uf}.zip"
    if uf == "DF":
        os.makedirs(os.path.dirname(caminho), exist_ok=True)
        with zipfile.ZipFile(caminho, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("placeholder.txt", "DF does not have municipalities")
        return 0

    cdmuns = set()
    for ano in ANOS_PREFEITO:
        for res in carregar_resultados("prefeito", ano, uf).values():
            cdmuns.add(res["cdmun"])

    internos = {}
    for cdmun in sorted(cdmuns):
        dados = montar("prefeito", uf, ANOS_PREFEITO, tmpdir, filtro_cdmun=cdmun)
        if not dados["identities"]:
            continue
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as iz:
            iz.writestr(f"historico_prefeito_{cdmun}.json",
                        json.dumps(dados, ensure_ascii=False, separators=(",", ":")))
        internos[f"historico_prefeito_{cdmun}.zip"] = buf.getvalue()

    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    with zipfile.ZipFile(caminho, "w", zipfile.ZIP_DEFLATED) as z:
        for nome, blob in internos.items():
            z.writestr(nome, blob)
    return len(internos)


def main():
    ufs = G.ALL_UFS
    if len(sys.argv) > 1:
        ufs = [u.strip().upper() for u in sys.argv[1].split(",") if u.strip()]

    with tempfile.TemporaryDirectory() as tmpdir:
        for uf in ufs:
            linha = [f"{uf}:"]
            for cargo, pasta, prefixo, anos in CARGOS:
                dados = montar(cargo, uf, anos, tmpdir)
                escrever_zip(f"resultados_geo/{pasta}/{prefixo}_{uf}.zip",
                             f"{prefixo}_{uf}.json", dados)
                linha.append(f"{cargo[:4]} {len(dados['identities'])}")
            linha.append(f"pref {fazer_prefeito(uf, tmpdir)} munis")
            print("  ".join(linha), flush=True)

        # Fechar ANTES do tmpdir sumir: no Windows o rmtree falha enquanto o
        # sqlite ainda segura o arquivo.
        for con, _ in _CONN.values():
            con.close()
        _CONN.clear()

    print("\nPronto. Para desfazer: git checkout -- resultados_geo/")


if __name__ == "__main__":
    sys.exit(main())
