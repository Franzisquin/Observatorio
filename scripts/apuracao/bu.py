"""Leitor do boletim de urna (BU) do TSE — o unico lugar com resultado por secao.

A divulgacao (EA20) desce ate a zona eleitoral e para. Quem vota onde, e quantos
votos cada candidato teve em cada urna, so existe no boletim de urna, que e um
arquivo ASN.1/DER de uns poucos KB por secao.

Este modulo nao implementa a especificacao inteira: le o que a tela precisa —
identificacao da secao, comparecimento, e a votacao por cargo e por votavel. O
resto da estrutura e atravessado sem ser interpretado.

Formato, como observado nos arquivos oficiais:

    EnvelopeGenerico ::= SEQUENCE {
        cabecalho, fase, ..., conteudo OCTET STRING  -- o BU, outro DER
    }
    BoletimUrna ::= SEQUENCE {
        ..., identificacaoSecao, dataHoraEmissao, ...,
        resultados SEQUENCE OF SEQUENCE {
            idEleicao INTEGER, ...,
            porCargo SEQUENCE OF SEQUENCE {
                tipo ENUM, comparecimento INTEGER,
                totais SEQUENCE OF SEQUENCE {
                    codigoCargo  [1] INTEGER,     -- 3 governador, 1 presidente...
                    ...,
                    votaveis SEQUENCE OF SEQUENCE {
                        tipoVoto   [1] INTEGER,   -- 1 nominal, 2 branco, 3 nulo, 4 legenda
                        quantidade [2] INTEGER,
                        votavel    [3] SEQUENCE { codigo INTEGER, partido INTEGER } OPTIONAL
                    }
                }
            }
        }
    }

A conferencia que prova a leitura esta em `conferir_zona()`: a soma dos boletins
de uma zona tem de bater, candidato a candidato, com o arquivo de zona do EA20 —
os dois lados publicados pelo proprio TSE.
"""

from __future__ import annotations

# Codigos de cargo do BU, iguais aos da divulgacao (EA20, secao 2).
CARGOS = {1: "0001", 3: "0003", 5: "0005", 6: "0006", 7: "0007", 8: "0008",
          11: "0011", 13: "0013"}

# tipoVoto, na marcacao de contexto [1] do votavel. Medido contra o arquivo de
# zona do EA20 da suplementar de Roraima (eleicao 6278, Pacaraima, zona 0007):
#
#   tipo 1  6.060 votos, todos com numero de candidato  -> nominais
#   tipo 2     36 votos, sem numero                     -> EA20 vb = 36
#   tipo 3     59 votos, sem numero                     -> EA20 vn = 59
#
# Legenda (4) nao foi observada em campo: aquela eleicao so tinha cargo
# majoritario. Em cargo proporcional ela deve aparecer, e por isso esta aqui —
# mas o valor 4 ainda nao foi confirmado contra o EA20.
NOMINAL, BRANCO, NULO, LEGENDA = 1, 2, 3, 4
TIPOS_VOTO = {NOMINAL: "nominal", BRANCO: "branco", NULO: "nulo", LEGENDA: "legenda"}


def elementos(dados: bytes) -> list[tuple[int, bytes]]:
    """Fatia um bloco DER em (tag, valor). Nao decodifica: so separa."""
    saida: list[tuple[int, bytes]] = []
    i = 0
    n = len(dados)
    while i < n:
        tag = dados[i]
        i += 1
        if i >= n:
            break
        tamanho = dados[i]
        i += 1
        if tamanho & 0x80:
            octetos = tamanho & 0x7F
            tamanho = int.from_bytes(dados[i:i + octetos], "big")
            i += octetos
        saida.append((tag, dados[i:i + tamanho]))
        i += tamanho
    return saida


def inteiro(valor: bytes) -> int:
    return int.from_bytes(valor, "big") if valor else 0


def composto(tag: int) -> bool:
    return bool(tag & 0x20)


def _votaveis(bloco: bytes) -> list[dict]:
    """Le a lista de votaveis de um cargo."""
    saida = []
    for tag, valor in elementos(bloco):
        if not composto(tag):
            continue
        tipo = quantidade = None
        numero = partido = None
        for t, v in elementos(valor):
            if t == 0x81:
                tipo = inteiro(v)
            elif t == 0x82:
                quantidade = inteiro(v)
            elif t == 0xA3:
                nums = [inteiro(x) for tt, x in elementos(v) if tt == 0x02]
                if nums:
                    numero = nums[0]
                    partido = nums[1] if len(nums) > 1 else None
        if tipo is None or quantidade is None:
            continue
        saida.append({"tipo": tipo, "rotulo": TIPOS_VOTO.get(tipo, str(tipo)),
                      "votos": quantidade, "numero": numero, "partido": partido})
    return saida


def _procurar_resultados(bloco: bytes, achados: list[dict], prof: int = 0) -> None:
    """Desce a arvore atras dos blocos de cargo.

    O bloco de um cargo se reconhece pela assinatura: tem um `[1] INTEGER` com o
    codigo do cargo e, logo abaixo, uma sequencia cujos filhos tem `[1]` e `[2]`.
    Procurar pela forma, e nao por uma posicao fixa, e o que faz o leitor
    sobreviver a um campo novo no meio do caminho.
    """
    if prof > 12:
        return
    for tag, valor in elementos(bloco):
        if not composto(tag):
            continue
        filhos = elementos(valor)
        codigo = next((inteiro(v) for t, v in filhos if t == 0x81), None)
        lista = next((v for t, v in filhos if composto(t) and t == 0x30
                      and _parece_votaveis(v)), None)
        if codigo is not None and lista is not None:
            achados.append({"cargo": CARGOS.get(codigo, str(codigo)),
                            "codigo": codigo, "votaveis": _votaveis(lista)})
            continue
        _procurar_resultados(valor, achados, prof + 1)


def _parece_votaveis(bloco: bytes) -> bool:
    filhos = elementos(bloco)
    if not filhos:
        return False
    for tag, valor in filhos:
        if not composto(tag):
            return False
        marcas = {t for t, _ in elementos(valor)}
        if not ({0x81, 0x82} <= marcas):
            return False
    return True


def ler(dados: bytes) -> dict:
    """Le um arquivo .bu e devolve secao, comparecimento e votacao por cargo."""
    topo = elementos(dados)
    if not topo:
        raise ValueError("arquivo vazio ou nao e DER")
    interno = None
    for _, valor in [topo[0]]:
        for tag, v in elementos(valor):
            if tag == 0x04 and v[:1] == b"\x30":
                interno = v
    if interno is None:
        raise ValueError("conteudo do envelope nao encontrado")

    corpo = elementos(interno)[0][1]
    campos = elementos(corpo)

    # identificacaoSecao ::= SEQUENCE { SEQUENCE{municipio, zona}, local, secao }
    #
    # O `local` e o numero do local de votacao — o mesmo NR_LOCAL_VOTACAO do
    # cadastro do TSE. Confirmado em campo: tres secoes seguidas de Pacaraima/RR
    # trazem 1015, que e a Escola Estadual Indigena Tuchaua Silvestre. Isso
    # importa porque a divulgacao (EA16/EA20) nao conhece local de votacao em
    # lugar nenhum: o vinculo secao -> local vem daqui, do proprio boletim.
    municipio = zona = local = secao = None
    for tag, valor in campos:
        if tag != 0x30:
            continue
        filhos = elementos(valor)
        interno_seq = next((v for t, v in filhos if t == 0x30), None)
        numeros = [inteiro(v) for t, v in filhos if t == 0x02]
        if interno_seq is not None and len(numeros) >= 2:
            par = [inteiro(v) for t, v in elementos(interno_seq) if t == 0x02]
            if len(par) == 2:
                municipio, zona = par
                local, secao = numeros[0], numeros[1]
                break

    achados: list[dict] = []
    _procurar_resultados(interno, achados)

    eleicao = None
    for tag, valor in campos:
        if composto(tag):
            for t, v in elementos(valor):
                if composto(t):
                    n = [inteiro(x) for tt, x in elementos(v) if tt == 0x02]
                    if len(n) >= 3 and n[0] > 100:
                        eleicao = n[0]
                        break
        if eleicao:
            break

    return {
        "municipio": f"{municipio:05d}" if municipio is not None else "",
        "zona": f"{zona:04d}" if zona is not None else "",
        "local": str(local) if local is not None else "",
        "secao": f"{secao:04d}" if secao is not None else "",
        "eleicao": str(eleicao or ""),
        "cargos": achados,
    }


def por_candidato(bu: dict, cargo: str) -> dict[str, int]:
    """{numero do candidato: votos} de um cargo. Branco e nulo ficam de fora."""
    for c in bu["cargos"]:
        if c["cargo"] != cargo:
            continue
        return {str(v["numero"]): v["votos"] for v in c["votaveis"]
                if v["tipo"] == NOMINAL and v["numero"] is not None}
    return {}


def agregados(bu: dict, cargo: str) -> dict[str, int]:
    """Branco, nulo, legenda e o total de comparecimento daquele cargo."""
    for c in bu["cargos"]:
        if c["cargo"] != cargo:
            continue
        saida = {"branco": 0, "nulo": 0, "legenda": 0, "nominal": 0}
        for v in c["votaveis"]:
            saida[TIPOS_VOTO.get(v["tipo"], "nominal")] = \
                saida.get(TIPOS_VOTO.get(v["tipo"], "nominal"), 0) + v["votos"]
        saida["total"] = sum(v["votos"] for v in c["votaveis"])
        return saida
    return {}
