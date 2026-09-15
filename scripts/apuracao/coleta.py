"""Coletor da apuracao: le os arquivos de resultado do TSE e escreve snapshots.

Um snapshot e um unico JSON compacto por camada geografica, para que o
navegador faca 1 requisicao em vez de 5.569:

    snapshot/<eleicao>-<cargo>-br.json    o pais
    snapshot/<eleicao>-<cargo>-uf.json    as 27 UFs num arquivo
    snapshot/<eleicao>-<cargo>-<uf>.json  todos os municipios daquela UF

Uso (os dados de 2024 continuam no ar ate 04/04/2028, entao da para provar o
pipeline inteiro hoje, sem esperar 2026):

    python scripts/apuracao/coleta.py --listar
    python scripts/apuracao/coleta.py --check --eleicao 619 --cargo 0011 --uf mg
    python scripts/apuracao/coleta.py --eleicao 619 --cargo 0011 --uf mg
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tse import (BASE, CARGOS, CARGOS_COM_BR, CARGOS_COM_ELEITOS,  # noqa: E402
                 CARGOS_COM_UF, CARGOS_PROPORCIONAIS, SIM_2026, TIPOS_ELEICAO,
                 TIPOS_ORDINARIAS, Cliente, descobrir_ambiente, e6, eleicao_de,
                 ciclo_de, inteiro, num, texto, tipo_eleicao)

RAIZ = Path(__file__).resolve().parent.parent.parent
DESTINO = RAIZ / "scratch" / "apuracao"


# ---------------------------------------------------------------- catalogo

def eleicoes_disponiveis(config: dict) -> list[dict]:
    """Achata os pleitos do EA11 numa lista de eleicoes com o pleito junto."""
    achatada = []
    for pleito in config.get("pl", []):
        for eleicao in pleito.get("e", []):
            achatada.append({
                "pleito": pleito.get("cd"),
                "data": pleito.get("dt"),
                "eleicao": eleicao.get("cd"),
                "turno": eleicao.get("t"),
                "turno2": eleicao.get("cdt2") or "",
                # O nome vem com entidades dentro da string: "1&#186; Turno".
                "nome": texto(eleicao.get("nm")),
                "abr": [a.get("cd") for a in eleicao.get("abr", [])],
                "cargos": sorted({c.get("cd") for a in eleicao.get("abr", [])
                                  for c in a.get("cp", [])}),
            })
    return achatada


def c4(codigo) -> str:
    """Codigo de cargo com 4 digitos. O EA11 traz `cp[].cd` sem os zeros ("1",
    "13"), e o nome do arquivo de resultado usa quatro ("c0001", "c0013")."""
    try:
        return f"{int(codigo):04d}"
    except (TypeError, ValueError):
        return str(codigo or "")


def cargos_da_eleicao(config: dict, eleicao, pedidos: list[str] | None = None) -> list[str]:
    """Cargos que a eleicao declara no EA11, cruzados com os que foram pedidos.

    Em 2026 a eleicao geral vem partida em duas: uma federal, com presidente e
    deputado federal, e uma estadual, com governador, senador e as assembleias.
    Pedir governador na eleicao federal e 404 garantido — e 404 repetido bloqueia
    o acesso por dez minutos.
    """
    declarados = {c4(c.get("cd")) for a in eleicao_de(config, eleicao).get("abr", [])
                  for c in a.get("cp", [])}
    if pedidos is None:
        return sorted(declarados)
    return [c for c in pedidos if c in declarados]


def escrever_indice(destino: Path, base: str, ambiente: str, config: dict,
                    por_eleicao: dict[str, list[str]]) -> None:
    """Diz ao front qual codigo de eleicao vale para cada cargo.

    Sem isso a pagina teria de receber um codigo por cargo na URL, na vespera, a
    mao. O `cdt2` vai junto: a virada para o segundo turno e leitura de arquivo,
    nao edicao de configuracao.
    """
    cargos: dict[str, str] = {}
    eleicoes: dict[str, dict] = {}
    for eleicao, lista in por_eleicao.items():
        registro = eleicao_de(config, eleicao)
        eleicoes[str(eleicao)] = {
            "t": registro.get("t", ""),
            "tp": int(registro.get("tp") or 0),
            "t2": registro.get("cdt2") or "",
            "nm": texto(registro.get("nm")),
            "cargos": lista,
        }
        for cargo in lista:
            cargos[cargo] = str(eleicao)
    escrever(destino, "indice.json", {
        "base": base, "ambiente": ambiente, "fase": config.get("f", ""),
        "idg": config.get("idg", ""),
        "cargos": cargos, "eleicoes": eleicoes,
        "gerado": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })


def municipios(cli: Cliente, config: dict, eleicao: str) -> dict[str, list[dict]]:
    """EA12 — municipios por UF, com codigo TSE (5 digitos), IBGE, nome e zonas.

    O codigo IBGE (`cdi`) e a ponte com as malhas municipais do site; o codigo
    TSE (`cd`) e o que entra no nome dos arquivos de resultado.
    """
    diretorio = cli.diretorio(config, "cm", cd_eleicao=eleicao)
    dados = cli.json_de(f"{diretorio}/mun-{e6(eleicao)}-cm.json")
    if dados is None:
        raise RuntimeError(f"EA12 nao encontrado para a eleicao {eleicao}")

    por_uf: dict[str, list[dict]] = {}
    for abrangencia in dados.get("abr", []):
        uf = str(abrangencia.get("cd", "")).lower()
        por_uf[uf] = [
            # O nome do municipio vem com entidade HTML dentro da string, como
            # todo texto do TSE: "MACHADINHO D&apos;OESTE". Sao 45 municipios no
            # pais, e sem desfazer aqui a entidade vai crua para a tela.
            {"cd": m.get("cd"), "ibge": m.get("cdi"), "nm": texto(m.get("nm")),
             "zonas": list(m.get("z", []))}
            for m in abrangencia.get("mu", [])
        ]
    return por_uf


def escolher_ufs(mapa: dict[str, list[dict]], pedidas: list[str]) -> list[str]:
    """As UFs a coletar, conferidas contra as que o EA12 declara na eleicao.

    Sem esta conferencia, um `--uf rr,ap` (virgula em vez de espaco) ou uma sigla
    errada viram uma chave que nao existe no mapa: o coletor roda, nao baixa nada e
    nao reclama. Numa janela de simulado de tres horas, o silencio custa a janela.
    """
    if not pedidas:
        return sorted(mapa)
    pedidas = [u.lower().strip() for u in pedidas if u.strip()]
    desconhecidas = [u for u in pedidas if u not in mapa]
    if desconhecidas:
        raise SystemExit(f"UF desconhecida nesta eleicao: {', '.join(desconhecidas)}"
                         f"\n  disponiveis: {' '.join(sorted(mapa))}"
                         f"\n  (as siglas vao separadas por espaco, nao por virgula)")
    return pedidas


# ---------------------------------------------------------------- leitura

def url_resultado(cli: Cliente, config: dict, eleicao: str, cargo: str, uf: str,
                  munic: str | None = None, zona: str | None = None) -> str:
    """Monta a URL do EA20 (arquivo de resultado unificado) de uma abrangencia."""
    diretorio = cli.diretorio(config, "u", cd_eleicao=eleicao, uf=uf)
    if munic and zona:
        nome = f"{uf}{munic}-z{zona}-c{cargo}-{e6(eleicao)}-u.json"
    elif munic:
        nome = f"{uf}{munic}-c{cargo}-{e6(eleicao)}-u.json"
    else:
        nome = f"{uf}-c{cargo}-{e6(eleicao)}-u.json"
    return f"{diretorio}/{nome}"


# O que vai para o dicionario de candidatos do snapshot: os campos que descrevem
# a candidatura, e nao a votacao. Ficam UMA vez no arquivo, em vez de repetidos
# em cada um dos 5.569 municipios.
CHAVES_CAND = ("nome", "urna", "numero", "partido", "eleito", "situacao",
               "destino", "nasc", "coligacao", "federacao", "vice", "subs")


def candidatos(payload: dict) -> dict[str, dict]:
    """Extrai {sqcand: dados} percorrendo cargo -> agremiacao -> partido -> candidato.

    Leva a chapa inteira, nao so o cabeca: `vs[]` traz o vice de presidente e
    governador e os dois suplentes de cada senador — suplente de senador assume
    de fato, e nao aparece em praticamente nenhum painel antes da posse. `subs[]`
    traz quem foi substituido no meio da disputa (renuncia, inabilitacao,
    falecimento), que e o que da sentido a uma candidatura que sumiu da lista.
    """
    achatado: dict[str, dict] = {}
    for cargo in payload.get("carg", []):
        federacoes = {str(f.get("n")): f for f in cargo.get("fed", [])}
        for agremiacao in cargo.get("agr", []):
            for partido in agremiacao.get("par", []):
                fed = federacoes.get(str(partido.get("nfed") or "")) or {}
                for cand in partido.get("cand", []):
                    achatado[str(cand.get("sqcand"))] = {
                        "nome": texto(cand.get("nm")),
                        "urna": texto(cand.get("nmu")),
                        "numero": cand.get("n", ""),
                        "partido": texto(partido.get("sg")),
                        "situacao": texto(cand.get("st")),
                        "eleito": cand.get("e", "n"),
                        # dvt: Valido, Valido (legenda), Anulado, Anulado sub
                        # judice. O art. 265 par. 2 manda informar a situacao do
                        # voto, nao so o numero — sem este campo nao ha como.
                        "destino": texto(cand.get("dvt")),
                        "nasc": texto(cand.get("dt")),
                        "coligacao": (texto(agremiacao.get("com"))
                                      if agremiacao.get("tp") != "i" else ""),
                        "federacao": texto(fed.get("sg")),
                        "vice": [{"tp": v.get("tp", ""), "nome": texto(v.get("nm")),
                                  "urna": texto(v.get("nmu")),
                                  "partido": texto(v.get("sgp")),
                                  "sq": str(v.get("sqcand") or "")}
                                 for v in cand.get("vs", [])],
                        "subs": [{"nome": texto(x.get("nm")), "urna": texto(x.get("nmu")),
                                  "partido": texto(x.get("sgp"))}
                                 for x in cand.get("subs", [])],
                        "votos": inteiro(cand.get("vap")),
                        "pct": num(cand.get("pvap")),
                    }
    return achatado


def dicionario_cand(payload: dict) -> dict[str, dict]:
    """O dicionario como vai para o snapshot, sem os campos de votacao."""
    return {sq: {k: d[k] for k in CHAVES_CAND if d.get(k)}
            for sq, d in candidatos(payload).items()}


def partidos(payload: dict) -> dict[str, int]:
    """Votos validos por sigla: nominais do partido + os de legenda.

    E o que o mapa precisa para colorir uma disputa proporcional, e cabe em
    poucas centenas de bytes por municipio.
    """
    total: dict[str, int] = {}
    for cargo in payload.get("carg", []):
        for agremiacao in cargo.get("agr", []):
            for partido in agremiacao.get("par", []):
                sigla = texto(partido.get("sg"))
                if not sigla:
                    continue
                total[sigla] = (total.get(sigla, 0)
                                + inteiro(partido.get("tvtn"))
                                + inteiro(partido.get("tvtl")))
    return total


def agremiacoes(payload: dict) -> list[dict]:
    """Bancada por agremiacao: coligacao, federacao ou partido isolado.

    As vagas (`vag`) sao as do proprio TSE, recalculadas a cada totalizacao a
    partir do quociente. Ficam na agremiacao, nao no partido — numa federacao a
    cadeira e do bloco, e reparti-la entre os partidos seria inventar dado.
    """
    saida = []
    for cargo in payload.get("carg", []):
        federacoes = {str(f.get("n")): f for f in cargo.get("fed", [])}
        for agremiacao in cargo.get("agr", []):
            partes = agremiacao.get("par", [])
            nominais = sum(inteiro(p.get("tvtn")) for p in partes)
            legenda = sum(inteiro(p.get("tvtl")) for p in partes)
            fed = next((federacoes[str(p.get("nfed"))] for p in partes
                        if str(p.get("nfed") or "") in federacoes), None)
            saida.append({
                "nm": texto(agremiacao.get("nm")),
                "com": texto(agremiacao.get("com")) or texto(agremiacao.get("nm")),
                "tp": agremiacao.get("tp", "i"),
                "vag": inteiro(agremiacao.get("vag")),
                "v": nominais + legenda,
                # Nominal e legenda separados: e a leitura de quanto da bancada
                # veio do voto no partido, e desaparece ao somar as duas.
                "vtn": nominais,
                "vtl": legenda,
                # Votos computados, antes das regras de totalizacao. A diferenca
                # contra os validos e o que foi anulado.
                "van": sum(inteiro(p.get("tvan")) for p in partes),
                "val": sum(inteiro(p.get("tval")) for p in partes),
                **({"fed": texto(fed.get("sg")),
                    "fedcom": texto(fed.get("com"))} if fed else {}),
                "par": [{"sg": texto(p.get("sg")), "n": p.get("n", ""),
                         "vtn": inteiro(p.get("tvtn")), "vtl": inteiro(p.get("tvtl")),
                         "dvt": texto(p.get("dvt"))}
                        for p in partes if texto(p.get("sg"))],
            })
    return sorted(saida, key=lambda a: -a["v"])


def resumo(payload: dict, cargo: str = "", com_candidatos: bool = True,
           completo: bool = False) -> dict:
    """Reduz um EA20 ao que o mapa e o painel precisam.

    Nao recalcula nada: so seleciona e soma o que o TSE ja publicou. Alterar o
    conteudo esbarraria no art. 267 par. 4 da Resolucao 23.751/2026.

    `completo` acrescenta as tres hierarquias inteiras do EA20 — secoes,
    eleitorado e votos. Vale nos 28 arquivos da camada alta; na camada municipal
    sao 5.569 entradas por UF, e o mesmo detalhe por municipio multiplicaria o
    snapshot que o navegador recarrega a cada 4 minutos. O andamento municipio a
    municipio continua saindo de `and` e `pst`, que ficam sempre.
    """
    secoes = payload.get("s", {})
    eleitores = payload.get("e", {})
    votos = payload.get("v", {})
    proporcional = cargo in CARGOS_PROPORCIONAIS
    extra: dict = {}
    if proporcional:
        extra["part"] = partidos(payload)
        for c in payload.get("carg", []):
            if c.get("qe"):
                extra["qe"] = inteiro(c.get("qe"))
            if c.get("nv"):
                extra["nv"] = inteiro(c.get("nv"))

    if completo:
        extra.update({
            # secoes: ts = st + snt ; st = si + sni ; si = sa + sna
            "snt": inteiro(secoes.get("snt")),
            "si": inteiro(secoes.get("si")),
            "sni": inteiro(secoes.get("sni")),
            "sa": inteiro(secoes.get("sa")),
            "sna": inteiro(secoes.get("sna")),
            # eleitorado: te = est + esnt ; est = esi + esni ; esi = esa + esna.
            # esnt e o eleitorado das secoes que ainda faltam totalizar: contra a
            # diferenca entre primeiro e segundo colocado, e a unica resposta com
            # dado do TSE para "ainda da para virar?".
            "est": inteiro(eleitores.get("est")),
            "esnt": inteiro(eleitores.get("esnt")),
            "esi": inteiro(eleitores.get("esi")),
            "esni": inteiro(eleitores.get("esni")),
            "esa": inteiro(eleitores.get("esa")),
            "esna": inteiro(eleitores.get("esna")),
            # votos: tv = vvc + vb + tvn + vscv ; vvc = vv + van + vansj ;
            # vv = vnom + vl ; tvn = vn + vnt
            "vnom": inteiro(votos.get("vnom")),
            "vl": inteiro(votos.get("vl")),
            "van": inteiro(votos.get("van")),
            "vansj": inteiro(votos.get("vansj")),
            "tvn": inteiro(votos.get("tvn")),
            "vnt": inteiro(votos.get("vnt")),
            "vscv": inteiro(votos.get("vscv")),
            "vsan": inteiro(votos.get("vsan")),
        })
        # esae/mnae: a totalizacao final terminou sem atribuir eleito, e por que.
        # Sem tratar, a pagina mostraria disputa encerrada e vencedor em branco.
        if payload.get("esae"):
            extra["esae"] = payload.get("esae")
        if payload.get("mnae"):
            extra["mnae"] = [texto(m) for m in payload.get("mnae") or []]

    return {
        **extra,
        "and": payload.get("and", "n"),
        "tf": payload.get("tf", "n"),
        "dv": payload.get("dv", "s"),
        "md": payload.get("md", ""),
        "dt": payload.get("dt", ""),
        "ht": payload.get("ht", ""),
        # secoes: totalizadas de um total (o "% apurado" que sai na tela)
        "st": inteiro(secoes.get("st")),
        "ts": inteiro(secoes.get("ts")),
        "pst": num(secoes.get("pst")),
        # eleitorado e comparecimento
        "te": inteiro(eleitores.get("te")),
        "comp": inteiro(eleitores.get("c")),
        "abst": inteiro(eleitores.get("a")),
        # votos
        "tv": inteiro(votos.get("tv")),
        # vvc = votos a votaveis concorrentes. E a base do pvap do TSE, e nao
        # coincide com vv quando ha voto anulado ou sub judice: sem guardar vvc,
        # o percentual da tela divergiria do percentual publicado.
        "vvc": inteiro(votos.get("vvc")),
        "vv": inteiro(votos.get("vv")),
        "vb": inteiro(votos.get("vb")),
        "vn": inteiro(votos.get("vn")),
        # Proporcional so leva candidato na abrangencia do proprio cargo (UF
        # para deputado, municipio para vereador). No resto, o mapa se vira com
        # `part` e o arquivo fica 100 vezes menor.
        **({"cand": {sq: c["votos"] for sq, c in candidatos(payload).items()}}
           if com_candidatos else {}),
    }


# ---------------------------------------------------------------- snapshot

def coletar_municipios(cli: Cliente, config: dict, eleicao: str, cargo: str, uf: str,
                       lista: list[dict], paralelo: int = 12) -> dict:
    """Baixa o EA20 de todos os municipios de uma UF. Ausente = ainda sem dado."""
    resultado: dict[str, dict] = {}
    nomes: dict[str, dict] = {}
    cabecalho: dict = {}
    com_candidatos = cargo not in CARGOS_PROPORCIONAIS

    def um(muni: dict):
        url = url_resultado(cli, config, eleicao, cargo, uf, munic=muni["cd"])
        return muni, cli.json_de(url)

    with cf.ThreadPoolExecutor(max_workers=paralelo) as pool:
        for muni, payload in pool.map(um, lista):
            if payload is None:
                continue
            if not cabecalho:
                cabecalho = meta(payload, cargo)
            resultado[muni["cd"]] = resumo(payload, cargo, com_candidatos)
            nomes[muni["cd"]] = {"nm": muni["nm"], "ibge": muni["ibge"]}
            if not com_candidatos:
                continue
            nomes.setdefault("_cand", {}).update(dicionario_cand(payload))

    cands = nomes.pop("_cand", {})
    return {"meta": cabecalho, "abr": resultado, "mun": nomes, "cand": cands}


def meta(payload: dict, cargo: str) -> dict:
    """Cabecalho do snapshot: de qual eleicao, turno e fase o dado veio.

    `f` distingue simulado ("s") de oficial ("o"). Os dois tem exatamente a
    mesma cara, entao carregar essa marca ate a tela e o que impede publicar
    numero de teste como se fosse resultado.
    """
    return {
        "ele": payload.get("ele", ""),
        "t": payload.get("t", ""),
        "f": payload.get("f", ""),
        "sup": payload.get("sup", "n"),
        # idg identifica a geracao do arquivo (atributo novo em 2026). E o que
        # distingue uma atualizacao de verdade de uma releitura do mesmo
        # conteudo, e o que permite dizer na tela se o dado esta parado.
        "idg": payload.get("idg", ""),
        "dg": payload.get("dg", ""),
        "hg": payload.get("hg", ""),
        "cargo": cargo,
        "gerado": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def escrever(destino: Path, nome: str, conteudo: dict) -> Path:
    """Grava o snapshot de uma vez so, por troca de nome.

    O navegador pede estes arquivos a cada 45 segundos enquanto o coletor os
    reescreve. Gravar por cima do arquivo aberto deixa uma janela em que a
    pagina le um JSON truncado — um erro de parse por volta, mais frequente
    justamente quando o arquivo e grande. Escrever ao lado e renomear elimina a
    janela: `Path.replace` e atomico, tambem no Windows.
    """
    destino.mkdir(parents=True, exist_ok=True)
    caminho = destino / nome
    # separators sem espaco: o snapshot trafega a cada atualizacao, cada byte conta.
    temporario = destino / (nome + ".parcial")
    temporario.write_text(json.dumps(conteudo, ensure_ascii=False, separators=(",", ":")),
                          encoding="utf-8")
    temporario.replace(caminho)
    return caminho


def camada_alta(cli: Cliente, config: dict, eleicao: str, cargo: str, ufs: list[str],
                destino: Path, silencioso: bool = False) -> dict:
    """Brasil + 27 UFs: 28 arquivos. E a camada que atualiza a cada volta.

    Prefeito e vereador nao tem arquivo nessas abrangencias: sai sem fazer nada,
    em vez de pedir uma URL que so devolveria 404 (e 404 tambem bloqueia).

    Devolve o estado da volta — geracao, andamento, totalizacao final — para o
    plantao publicar a pagina de saude e decidir se ja vale pedir o EA10.
    """
    if cargo not in CARGOS_COM_UF:
        return {}

    # Proporcional nao leva candidato: com 27 UFs no mesmo arquivo, os nomes de
    # 50 mil candidatos a deputado passariam de 3 MB a cada 45 segundos. A
    # disputa proporcional se acompanha por partido e bancada.
    com_candidatos = cargo not in CARGOS_PROPORCIONAIS

    br = (cli.json_de(url_resultado(cli, config, eleicao, cargo, "br"))
          if cargo in CARGOS_COM_BR else None)
    if br:
        escrever(destino, f"{eleicao}-{cargo}-br.json",
                 {"meta": meta(br, cargo),
                  "abr": {"br": resumo(br, cargo, com_candidatos, completo=True)},
                  **({"agrem": agremiacoes(br)} if not com_candidatos else {}),
                  "cand": dicionario_cand(br) if com_candidatos else {}})
        if not silencioso:
            print(f"  br: {resumo(br, cargo)['pst']:.2f}% das secoes"
                  + ("  [dv=n: divulgacao presidencial bloqueada, votos zerados]"
                     if br.get("dv") == "n" else ""))

    # As 27 UFs em paralelo: em serie, com ~0,35s de ida e volta cada, um cargo
    # sozinho ja comeria 10s da volta de 45s.
    with cf.ThreadPoolExecutor(max_workers=12) as pool:
        payloads = list(pool.map(
            lambda uf: (uf, cli.json_de(url_resultado(cli, config, eleicao, cargo, uf))), ufs))

    porta_uf, nomes_uf, cabecalho, bancadas = {}, {}, {}, {}
    for uf, payload in payloads:
        if payload:
            cabecalho = cabecalho or meta(payload, cargo)
            porta_uf[uf] = resumo(payload, cargo, com_candidatos, completo=True)
            if not com_candidatos:
                bancadas[uf] = agremiacoes(payload)
                continue
            # Governador e senador tem candidatos diferentes em cada UF; o
            # sqcand e unico no pais, entao um dicionario so da conta.
            nomes_uf.update(dicionario_cand(payload))

    if porta_uf:
        escrever(destino, f"{eleicao}-{cargo}-uf.json",
                 {"meta": cabecalho, "abr": porta_uf, "cand": nomes_uf,
                  **({"agrem": bancadas} if bancadas else {})})
        if not silencioso:
            print(f"  uf: {len(porta_uf)} unidades")

    fonte = br or next((p for _, p in payloads if p), None) or {}
    return {
        "ok": bool(porta_uf or br),
        "idg": fonte.get("idg", ""),
        "dg": fonte.get("dg", ""),
        "hg": fonte.get("hg", ""),
        "dt": fonte.get("dt", ""),
        "ht": fonte.get("ht", ""),
        "and": fonte.get("and", "n"),
        "dv": fonte.get("dv", "s"),
        "md": fonte.get("md", ""),
        # Basta uma abrangencia finalizar para o EA10 daquele cargo passar a
        # existir; antes disso, pedi-lo e 404 em serie.
        "tf": "s" if (fonte.get("tf") == "s"
                      or any(e.get("tf") == "s" for e in porta_uf.values())) else "n",
        "ufs": len(porta_uf),
    }


def camada_municipal(cli: Cliente, config: dict, eleicao: str, cargo: str, ufs: list[str],
                     mapa: dict[str, list[dict]], destino: Path, paralelo: int = 12,
                     silencioso: bool = False) -> int:
    """Um arquivo por UF com todos os seus municipios. E a camada cara: 5.569
    arquivos lidos do TSE por cargo, entao roda em cadencia mais lenta."""
    escritos = 0
    for uf in ufs:
        pacote = coletar_municipios(cli, config, eleicao, cargo, uf, mapa.get(uf, []),
                                    paralelo=paralelo)
        if not pacote["abr"]:
            continue
        caminho = escrever(destino, f"{eleicao}-{cargo}-{uf}.json", pacote)
        escritos += 1
        if not silencioso:
            print(f"  {uf}: {len(pacote['abr'])}/{len(mapa.get(uf, []))} municipios "
                  f"-> {caminho.name} ({caminho.stat().st_size / 1024:.0f} KB)")
    return escritos


# ------------------------------------------------------ acompanhamento (EA14)

def acompanhamento(cli: Cliente, config: dict, eleicao: str, destino: Path,
                   silencioso: bool = False) -> dict:
    """EA14 — o mapa de onde ainda se esta contando, em UMA requisicao.

    Um arquivo por eleicao, com uma entrada para o Brasil e uma para cada UF:
    andamento (`and`), quantas UFs e quantos municipios estao em cada estagio
    (nao iniciado, parcial, finalizado) e as hierarquias de secoes e eleitorado.
    E a resposta para "onde falta" — a pergunta que continua interessante depois
    que o mapa de quem ganha ja saturou.

    O EA15 (os mesmos contadores, mas por municipio de uma UF) fica de fora de
    proposito: seriam 27 requisicoes por volta para repetir o `and` e o `pst` que
    o snapshot municipal do EA20 ja carrega municipio a municipio.
    """
    tipo = tipo_eleicao(config, eleicao)
    if tipo not in TIPOS_ORDINARIAS:
        # Suplementar e consulta popular nao tem EA14 (secao 1 da especificacao).
        # Pedir e um 404 por volta, e 404 repetido bloqueia igual a excesso.
        if not silencioso:
            print(f"  ab: eleicao {eleicao} e {TIPOS_ELEICAO.get(tipo, 'de tipo ' + str(tipo))}"
                  f" — sem arquivo de acompanhamento")
        return {}

    diretorio = cli.diretorio(config, "ab", cd_eleicao=eleicao, uf="br")
    dados = cli.json_de(f"{diretorio}/br-{e6(eleicao)}-ab.json")
    if not dados:
        return {}

    def bloco(entrada: dict) -> dict:
        secoes = entrada.get("s", {})
        eleitores = entrada.get("e", {})
        return {
            "and": entrada.get("and", "n"),
            "cd": str(entrada.get("cdabr", "")).lower(),
            "tp": entrada.get("tpabr", ""),
            "dt": entrada.get("dt", ""),
            "ht": entrada.get("ht", ""),
            # estagio: nr nao iniciado, pt parcial, f finalizado
            "ufnr": inteiro(entrada.get("ufsnr")),
            "ufpt": inteiro(entrada.get("ufspt")),
            "uff": inteiro(entrada.get("ufsf")),
            "munr": inteiro(entrada.get("munnr")),
            "mupt": inteiro(entrada.get("munpt")),
            "muf": inteiro(entrada.get("munf")),
            "ts": inteiro(secoes.get("ts")), "st": inteiro(secoes.get("st")),
            "pst": num(secoes.get("pst")), "snt": inteiro(secoes.get("snt")),
            "si": inteiro(secoes.get("si")), "sni": inteiro(secoes.get("sni")),
            "sa": inteiro(secoes.get("sa")), "sna": inteiro(secoes.get("sna")),
            "te": inteiro(eleitores.get("te")), "est": inteiro(eleitores.get("est")),
            "esnt": inteiro(eleitores.get("esnt")),
            "esni": inteiro(eleitores.get("esni")),
            "esna": inteiro(eleitores.get("esna")),
            "comp": inteiro(eleitores.get("c")), "abst": inteiro(eleitores.get("a")),
        }

    entradas = [bloco(a) for a in dados.get("abr", [])]
    pacote = {
        "meta": {"ele": dados.get("ele", ""), "t": dados.get("t", ""),
                 "f": dados.get("f", ""), "idg": dados.get("idg", ""),
                 "dg": dados.get("dg", ""), "hg": dados.get("hg", ""),
                 "gerado": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
        "br": next((e for e in entradas if e["tp"] == "br"), None),
        "uf": {e["cd"]: e for e in entradas if e["tp"] != "br"},
    }
    escrever(destino, f"{eleicao}-ab.json", pacote)
    if not silencioso:
        br = pacote["br"] or {}
        print(f"  ab: {br.get('pst', 0):.2f}% do pais | UFs finalizadas "
              f"{br.get('uff', 0)}, parciais {br.get('ufpt', 0)}, "
              f"nao iniciadas {br.get('ufnr', 0)}")
    return pacote


# -------------------------------------------------------------- eleitos (EA10)

def eleitos(cli: Cliente, config: dict, eleicao: str, cargo: str, ufs: list[str],
            destino: Path, silencioso: bool = False) -> dict:
    """EA10 — quem venceu, por cargo e abrangencia. So existe apos a totalizacao final.

    Governador, senador e deputado federal saem num unico arquivo BR cada: o
    placar final do pais sem varrer 27 unidades, com a composicao da coligacao e
    os suplentes junto. Prefeito e por UF.

    Pedir antes de tf=s devolveria 404 em serie, e 404 repetido bloqueia o acesso
    por 10 minutos — entao o plantao so chama isto quando ve tf=s.
    """
    # O EA10 existe apenas nas eleicoes gerais ordinarias e municipais ordinarias
    # (secao 1 da especificacao): nao ha em suplementar nem em consulta popular. E
    # no segundo turno de uma geral so ha o arquivo de governador.
    tipo = tipo_eleicao(config, eleicao)
    turno = str(eleicao_de(config, eleicao).get("t") or "1")
    if cargo not in CARGOS_COM_ELEITOS or tipo not in TIPOS_ORDINARIAS:
        return {}
    if turno == "2" and tipo != 3 and cargo != "0003":
        return {}
    # Prefeito e cargo municipal: o EA10 dele e um arquivo por UF. Governador,
    # senador e deputado federal saem num unico arquivo de abrangencia BR.
    alvos = ufs if cargo == "0011" else ["br"]

    def um(abrangencia: str):
        diretorio = cli.diretorio(config, "e", cd_eleicao=eleicao, uf=abrangencia)
        return abrangencia, cli.json_de(
            f"{diretorio}/{abrangencia}-c{cargo}-{e6(eleicao)}-e.json")

    with cf.ThreadPoolExecutor(max_workers=max(1, min(12, len(alvos)))) as pool:
        respostas = list(pool.map(um, alvos))

    por_abrangencia: dict[str, dict] = {}
    cabecalho: dict = {}
    for _, dados in respostas:
        if not dados:
            continue
        cabecalho = cabecalho or {
            "ele": dados.get("ele", ""), "t": dados.get("t", ""),
            "f": dados.get("f", ""), "idg": dados.get("idg", ""),
            "cargo": cargo, "nmcar": texto(dados.get("nmcar")),
            "gerado": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        for entrada in dados.get("abr", []):
            por_abrangencia[str(entrada.get("cdabr", "")).lower()] = {
                "nm": texto(entrada.get("nmabr")),
                "tp": entrada.get("tpabr", ""),
                "dt": entrada.get("dt", ""), "ht": entrada.get("ht", ""),
                "tvap": inteiro(entrada.get("tvap")),
                # esae/mnae: a totalizacao final nao conseguiu atribuir eleitos, e
                # os motivos em texto. E raro, e e noticia.
                "esae": entrada.get("esae", "n"),
                "mnae": [texto(m) for m in entrada.get("mnae") or []],
                "cand": [{
                    "sq": str(c.get("sqcand") or ""), "n": c.get("n", ""),
                    "nome": texto(c.get("nm")), "urna": texto(c.get("nmu")),
                    "partido": texto(c.get("sgp")), "com": texto(c.get("com")),
                    "votos": inteiro(c.get("vap")), "seq": inteiro(c.get("seq")),
                    "vice": [{"tp": v.get("tp", ""), "nome": texto(v.get("nm")),
                              "urna": texto(v.get("nmu")),
                              "partido": texto(v.get("sgp")),
                              "sq": str(v.get("sqcand") or "")}
                             for v in c.get("vs", [])],
                } for c in entrada.get("cand", [])],
            }

    if not por_abrangencia:
        return {}
    pacote = {"meta": cabecalho, "abr": por_abrangencia}
    escrever(destino, f"{eleicao}-{cargo}-eleitos.json", pacote)
    if not silencioso:
        total = sum(len(v["cand"]) for v in por_abrangencia.values())
        print(f"  eleitos c{cargo}: {total} em {len(por_abrangencia)} abrangencias")
    return pacote


# ---------------------------------------------------------------- verificacao

def verificar(cli: Cliente, config: dict, eleicao: str, cargo: str, uf: str,
              mapa: dict[str, list[dict]]) -> bool:
    """Soma dos filhos == arquivo do pai.

    O TSE publica as duas pontas, entao a divergencia acusa erro de coleta (URL
    errada, municipio faltando, parser de numero furado). E o check que pega
    quase todo bug antes da noite da eleicao.

    Cargo com arquivo de UF  : soma dos municipios  == arquivo da UF.
    Prefeito/vereador        : soma das zonas       == arquivo do municipio.
    """
    lista = mapa.get(uf, [])
    if not lista:
        print(f"  ! UF {uf} nao participa da eleicao {eleicao}")
        return False

    if cargo in CARGOS_COM_UF:
        pai = cli.json_de(url_resultado(cli, config, eleicao, cargo, uf))
        filhos = [(m["cd"], url_resultado(cli, config, eleicao, cargo, uf, munic=m["cd"]))
                  for m in lista]
        rotulo = f"{len(filhos)} municipios de {uf.upper()}"
    else:
        # o municipio com mais zonas: conferir contra uma soma de uma parcela so
        # nao provaria nada sobre a agregacao.
        muni = max(lista, key=lambda m: len(m["zonas"]))
        pai = cli.json_de(url_resultado(cli, config, eleicao, cargo, uf, munic=muni["cd"]))
        filhos = [(z, url_resultado(cli, config, eleicao, cargo, uf, munic=muni["cd"], zona=z))
                  for z in muni["zonas"]]
        rotulo = f"{len(filhos)} zonas de {muni['nm']}/{uf.upper()}"

    if pai is None:
        print(f"  ! arquivo do pai nao existe para cargo {cargo} em {uf}")
        return False

    # Em cargo proporcional a conferencia e por partido: e o que o snapshot
    # guarda, entao e o que precisa fechar.
    chave_votacao = "part" if cargo in CARGOS_PROPORCIONAIS else "cand"
    alvo = resumo(pai, cargo)
    soma = {"tv": 0, "vv": 0, "vb": 0, "vn": 0, "st": 0, "ts": 0, "comp": 0}
    por_cand: dict[str, int] = {}
    ausentes = 0

    with cf.ThreadPoolExecutor(max_workers=12) as pool:
        payloads = list(pool.map(lambda f: (f[0], cli.json_de(f[1])), filhos))

    for chave, payload in payloads:
        if payload is None:
            ausentes += 1
            continue
        parcial = resumo(payload, cargo)
        for campo in soma:
            soma[campo] += parcial[campo]
        for sq, votos in parcial[chave_votacao].items():
            por_cand[sq] = por_cand.get(sq, 0) + votos

    print(f"\n  conferencia: {rotulo}"
          + (f"  ({ausentes} sem arquivo)" if ausentes else ""))
    ok = True
    for campo, descricao in (("ts", "secoes totais"), ("st", "secoes totalizadas"),
                             ("tv", "votos totais"), ("vv", "votos validos"),
                             ("vb", "brancos"), ("vn", "nulos"), ("comp", "comparecimento")):
        marca = "ok " if soma[campo] == alvo[campo] else "ERRO"
        if soma[campo] != alvo[campo]:
            ok = False
        print(f"    [{marca}] {descricao:22s} filhos={soma[campo]:>12,} pai={alvo[campo]:>12,}"
              .replace(",", "."))

    esperado = alvo[chave_votacao]
    rotulo_votacao = "partidos" if chave_votacao == "part" else "candidatos"
    divergentes = [sq for sq in set(por_cand) | set(esperado)
                   if por_cand.get(sq, 0) != esperado.get(sq, 0)]
    if divergentes:
        ok = False
        print(f"    [ERRO] {len(divergentes)} {rotulo_votacao} com votacao divergente:")
        for sq in divergentes[:5]:
            print(f"           {sq}: filhos={por_cand.get(sq, 0)} pai={esperado.get(sq, 0)}")
    else:
        print(f"    [ok ] votacao de {len(esperado)} {rotulo_votacao} confere")

    return ok


# ---------------------------------------------------------------- cli

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ambiente", default="oficial",
                    help="pasta de ambiente do CDN: oficial, ou a do simulado "
                         "(pode ter mais de um segmento: simulado/simulado2026)")
    ap.add_argument("--base", default=BASE,
                    help="host do CDN; o simulado de 2026 usa " + SIM_2026)
    ap.add_argument("--eleicao", help="codigo da eleicao (ver --listar)")
    ap.add_argument("--cargo", default="0001",
                    help="codigo do cargo ou apelido: " + ", ".join(CARGOS))
    ap.add_argument("--uf", nargs="*", default=[], metavar="UF",
                    help="UFs separadas por espaco (padrao: as da eleicao)")
    ap.add_argument("--listar", action="store_true",
                    help="lista as eleicoes disponiveis no CDN e sai")
    ap.add_argument("--descobrir", action="store_true",
                    help="sonda os nomes de pasta de ambiente conhecidos e sai; o "
                         "ambiente dos simulados e divulgado as vesperas")
    ap.add_argument("--check", action="store_true",
                    help="confere soma dos filhos contra o arquivo do pai e sai")
    ap.add_argument("--destino", type=Path, default=DESTINO)
    ap.add_argument("--taxa", type=float, default=80.0,
                    help="requisicoes por segundo (limite do TSE e 100 por IP)")
    ap.add_argument("--paralelo", type=int, default=24,
                    help="requisicoes simultaneas; o teto real e --taxa")
    args = ap.parse_args()

    cargo = CARGOS.get(args.cargo, args.cargo)

    if args.descobrir:
        print("sondando os lugares conhecidos (1 requisicao para cada):")
        base, ambiente, _ = descobrir_ambiente(por_segundo=args.taxa)
        print("")
        print(f"  usar: --base {base} --ambiente {ambiente}" if ambiente
              else "  nenhum ambiente respondeu.")
        return 0 if ambiente else 1

    # 'auto' vale aqui tambem, para que o mesmo valor sirva ao plantao e a esta
    # CLI: numa janela de simulado, trocar o nome do ambiente em dois lugares e
    # uma chance a mais de errar.
    config = None
    if args.ambiente in ("auto", "descobrir"):
        print("sondando os lugares conhecidos (1 requisicao para cada):")
        args.base, args.ambiente, config = descobrir_ambiente(por_segundo=args.taxa)
        if not args.ambiente:
            print("  nenhum ambiente respondeu.")
            return 1

    cli = Cliente(ambiente=args.ambiente, por_segundo=args.taxa, base=args.base)
    config = config or cli.config_eleicoes()
    print(f"EA11: ciclo {ciclo_de(config) or '(por pleito)'} | fase {config.get('f')} | "
          f"gerado {config.get('dg')} {config.get('hg')}")

    catalogo = eleicoes_disponiveis(config)
    if args.listar or not args.eleicao:
        print(f"\n{len(catalogo)} eleicoes disponiveis:\n")
        for e in catalogo:
            print(f"  eleicao {e['eleicao']:>6}  pleito {e['pleito']:>5}  turno {e['turno']}  "
                  f"{e['data']}  cargos={','.join(e['cargos']) or '-'}  "
                  f"{e['nome'][:60]}")
        if not args.eleicao:
            print("\nUse --eleicao <codigo> para coletar.")
        return 0

    mapa = municipios(cli, config, args.eleicao)
    ufs = escolher_ufs(mapa, args.uf)
    print(f"EA12: {sum(len(v) for v in mapa.values())} municipios em {len(mapa)} UFs")

    if args.check:
        inicio = time.time()
        ok = all([verificar(cli, config, args.eleicao, cargo, uf, mapa) for uf in ufs])
        print(f"\n  {cli.contador['get']} requisicoes, {cli.contador['304']} nao modificadas, "
              f"{cli.contador['404']} ausentes, {cli.contador['bytes'] / 1e6:.1f} MB, "
              f"{time.time() - inicio:.1f}s")
        print("\nCONFERE" if ok else "\nDIVERGENCIA — nao publique este snapshot")
        return 0 if ok else 1

    # O ambiente pode ter mais de um segmento (simulado/simulado2026); vira um
    # nome de pasta so, para o site nao ter que apontar para um caminho aninhado.
    destino = args.destino / args.ambiente.replace("/", "-")
    estado = camada_alta(cli, config, args.eleicao, cargo, ufs, destino)
    acompanhamento(cli, config, args.eleicao, destino)
    camada_municipal(cli, config, args.eleicao, cargo, ufs, mapa, destino,
                     paralelo=args.paralelo)
    if estado.get("tf") == "s":
        eleitos(cli, config, args.eleicao, cargo, ufs, destino)

    print(f"\n{cli.contador['get']} requisicoes, {cli.contador['404']} ausentes, "
          f"{cli.contador['bytes'] / 1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
