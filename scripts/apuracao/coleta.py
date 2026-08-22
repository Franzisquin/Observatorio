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
from tse import (CARGOS, CARGOS_COM_BR, CARGOS_COM_UF,  # noqa: E402
                 CARGOS_PROPORCIONAIS, Cliente, e6, inteiro, num, texto)

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
                "nome": eleicao.get("nm", ""),
                "abr": [a.get("cd") for a in eleicao.get("abr", [])],
                "cargos": sorted({c.get("cd") for a in eleicao.get("abr", [])
                                  for c in a.get("cp", [])}),
            })
    return achatada


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
            {"cd": m.get("cd"), "ibge": m.get("cdi"), "nm": m.get("nm"),
             "zonas": list(m.get("z", []))}
            for m in abrangencia.get("mu", [])
        ]
    return por_uf


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


def candidatos(payload: dict) -> dict[str, dict]:
    """Extrai {sqcand: dados} percorrendo cargo -> agremiacao -> partido -> candidato."""
    achatado: dict[str, dict] = {}
    for cargo in payload.get("carg", []):
        for agremiacao in cargo.get("agr", []):
            for partido in agremiacao.get("par", []):
                for cand in partido.get("cand", []):
                    achatado[str(cand.get("sqcand"))] = {
                        "nome": texto(cand.get("nm")),
                        "urna": texto(cand.get("nmu")),
                        "numero": cand.get("n", ""),
                        "partido": texto(partido.get("sg")),
                        "situacao": texto(cand.get("st")),
                        "eleito": cand.get("e", "n"),
                        "votos": inteiro(cand.get("vap")),
                        "pct": num(cand.get("pvap")),
                    }
    return achatado


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
        for agremiacao in cargo.get("agr", []):
            validos = sum(inteiro(p.get("tvtn")) + inteiro(p.get("tvtl"))
                          for p in agremiacao.get("par", []))
            saida.append({
                "nm": texto(agremiacao.get("nm")),
                "com": texto(agremiacao.get("com")) or texto(agremiacao.get("nm")),
                "tp": agremiacao.get("tp", "i"),
                "vag": inteiro(agremiacao.get("vag")),
                "v": validos,
            })
    return sorted(saida, key=lambda a: -a["v"])


def resumo(payload: dict, cargo: str = "", com_candidatos: bool = True) -> dict:
    """Reduz um EA20 ao que o mapa e o painel precisam.

    Nao recalcula nada: so seleciona e soma o que o TSE ja publicou. Alterar o
    conteudo esbarraria no art. 267 par. 4 da Resolucao 23.751/2026.
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
            for sq, dados in candidatos(payload).items():
                nomes.setdefault("_cand", {})[sq] = {
                    k: dados[k] for k in ("nome", "urna", "numero", "partido")
                }

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
        "cargo": cargo,
        "gerado": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def escrever(destino: Path, nome: str, conteudo: dict) -> Path:
    destino.mkdir(parents=True, exist_ok=True)
    caminho = destino / nome
    # separators sem espaco: o snapshot trafega a cada atualizacao, cada byte conta.
    caminho.write_text(json.dumps(conteudo, ensure_ascii=False, separators=(",", ":")),
                       encoding="utf-8")
    return caminho


def camada_alta(cli: Cliente, config: dict, eleicao: str, cargo: str, ufs: list[str],
                destino: Path, silencioso: bool = False) -> bool:
    """Brasil + 27 UFs: 28 arquivos. E a camada que atualiza a cada volta.

    Prefeito e vereador nao tem arquivo nessas abrangencias: sai sem fazer nada,
    em vez de pedir uma URL que so devolveria 404 (e 404 tambem bloqueia).
    """
    if cargo not in CARGOS_COM_UF:
        return False

    # Proporcional nao leva candidato: com 27 UFs no mesmo arquivo, os nomes de
    # 50 mil candidatos a deputado passariam de 3 MB a cada 45 segundos. A
    # disputa proporcional se acompanha por partido e bancada.
    com_candidatos = cargo not in CARGOS_PROPORCIONAIS

    br = (cli.json_de(url_resultado(cli, config, eleicao, cargo, "br"))
          if cargo in CARGOS_COM_BR else None)
    if br:
        escrever(destino, f"{eleicao}-{cargo}-br.json",
                 {"meta": meta(br, cargo),
                  "abr": {"br": resumo(br, cargo, com_candidatos)},
                  **({"agrem": agremiacoes(br)} if not com_candidatos else {}),
                  "cand": {sq: {k: d[k] for k in ("nome", "urna", "numero", "partido")}
                           for sq, d in candidatos(br).items()} if com_candidatos else {}})
        if not silencioso:
            print(f"  br: {resumo(br, cargo)['pst']:.2f}% das secoes")

    # As 27 UFs em paralelo: em serie, com ~0,35s de ida e volta cada, um cargo
    # sozinho ja comeria 10s da volta de 45s.
    with cf.ThreadPoolExecutor(max_workers=12) as pool:
        payloads = list(pool.map(
            lambda uf: (uf, cli.json_de(url_resultado(cli, config, eleicao, cargo, uf))), ufs))

    porta_uf, nomes_uf, cabecalho, bancadas = {}, {}, {}, {}
    for uf, payload in payloads:
        if payload:
            cabecalho = cabecalho or meta(payload, cargo)
            porta_uf[uf] = resumo(payload, cargo, com_candidatos)
            if not com_candidatos:
                bancadas[uf] = agremiacoes(payload)
                continue
            # Governador e senador tem candidatos diferentes em cada UF; o
            # sqcand e unico no pais, entao um dicionario so da conta.
            for sq, dados in candidatos(payload).items():
                nomes_uf[sq] = {k: dados[k] for k in ("nome", "urna", "numero", "partido")}

    if porta_uf:
        escrever(destino, f"{eleicao}-{cargo}-uf.json",
                 {"meta": cabecalho, "abr": porta_uf, "cand": nomes_uf,
                  **({"agrem": bancadas} if bancadas else {})})
        if not silencioso:
            print(f"  uf: {len(porta_uf)} unidades")
    return bool(porta_uf)


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
                    help="pasta de ambiente do CDN: oficial, ou o nome do simulado")
    ap.add_argument("--eleicao", help="codigo da eleicao (ver --listar)")
    ap.add_argument("--cargo", default="0001",
                    help="codigo do cargo ou apelido: " + ", ".join(CARGOS))
    ap.add_argument("--uf", nargs="*", default=[], metavar="UF",
                    help="UFs a coletar (padrao: as da eleicao)")
    ap.add_argument("--listar", action="store_true",
                    help="lista as eleicoes disponiveis no CDN e sai")
    ap.add_argument("--check", action="store_true",
                    help="confere soma dos filhos contra o arquivo do pai e sai")
    ap.add_argument("--destino", type=Path, default=DESTINO)
    ap.add_argument("--taxa", type=float, default=80.0,
                    help="requisicoes por segundo (limite do TSE e 100 por IP)")
    ap.add_argument("--paralelo", type=int, default=24,
                    help="requisicoes simultaneas; o teto real e --taxa")
    args = ap.parse_args()

    cargo = CARGOS.get(args.cargo, args.cargo)
    cli = Cliente(ambiente=args.ambiente, por_segundo=args.taxa)
    config = cli.config_eleicoes()
    print(f"EA11: ciclo {config.get('c')} | fase {config.get('f')} | "
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
    ufs = [u.lower() for u in args.uf] or sorted(mapa)
    print(f"EA12: {sum(len(v) for v in mapa.values())} municipios em {len(mapa)} UFs")

    if args.check:
        inicio = time.time()
        ok = all([verificar(cli, config, args.eleicao, cargo, uf, mapa) for uf in ufs])
        print(f"\n  {cli.contador['get']} requisicoes, {cli.contador['304']} nao modificadas, "
              f"{cli.contador['404']} ausentes, {cli.contador['bytes'] / 1e6:.1f} MB, "
              f"{time.time() - inicio:.1f}s")
        print("\nCONFERE" if ok else "\nDIVERGENCIA — nao publique este snapshot")
        return 0 if ok else 1

    camada_alta(cli, config, args.eleicao, cargo, ufs, args.destino / args.ambiente)
    camada_municipal(cli, config, args.eleicao, cargo, ufs, mapa,
                     args.destino / args.ambiente, paralelo=args.paralelo)

    print(f"\n{cli.contador['get']} requisicoes, {cli.contador['404']} ausentes, "
          f"{cli.contador['bytes'] / 1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
