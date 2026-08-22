"""Esquema do pacote de GOVERNADOR 2022 — irmao de schema_sim2026.py.

Consumido por gerar_base_governador_2022.py e serializado para
resultados_geo/simgov2026/index.json, que o front-end (simulador.js +
js/sim_ei_worker.js) le no modo governador.

POR QUE UM MODULO SEPARADO

schema_sim2026.DIMENSOES e o contrato de um esquema GLOBAL E FIXO: as mesmas 42
colunas valem para as 27 UFs e estao gravadas em sim2026/index.json, que o
worker le no caminho quente. As origens de governador sao o oposto — mudam de
estado para estado, porque a lista de candidatos muda. Enfiar as duas coisas no
mesmo modulo contradiria o docstring dele ("fonte unica da verdade") e criaria
risco real de alterar o index.json presidencial por acidente.

O PACOTE

Um sidecar por UF, alinhado LINHA A LINHA com sim2026/locais_<UF>.bin — mesma
ordem, mesma contagem. Ele guarda apenas a composicao de 2022 para governador;
aptos, codigo IBGE e demografia continuam vindo do pacote presidencial, que seg
ue sendo a fonte unica do eleitorado de 2026.

A chave natural e repetida em cada registro de propos ito. Custa 9 bytes por
local (~760 KB no total) e compra a unica defesa contra a falha mais cara deste
desenho: um desalinhamento silencioso entre os dois pacotes atribuiria votos ao
local errado SEM aparecer no agregado estadual, que continuaria batendo.
"""

from __future__ import annotations

import re
import sys
import unicodedata
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import schema_sim2026 as esq  # noqa: E402

# ------------------------------------------------------------- parametros

# Um candidato so vira origem propria da migracao se tiver pelo menos este
# percentual dos validos ESTADUAIS; o resto soma em "outros". Medido nas 27 UFs
# de 2022, isto rende de 2 (PA, PI, RR) a 6 (DF, MS, RS, SC) origens, e o
# residuo que sobra em "outros" nunca passa de 2,5% (PA e o pior).
LIMIAR_ORIGEM = 1.5
MAX_ORIGENS = 6

# Reservadas: nunca podem ser a chave de um candidato (ver `slug`).
RESERVADAS = ("outros", "nulo_branco", "abstencao")

# Espaco de busca da imputacao por doadores, igual ao presidencial. Sao as
# dimensoes base="elec" do TSE, disponiveis para TODO local de 2026.
DIMS_DOADOR = ["sexo", "idade", "escolaridade", "estado_civil", "deficiencia"]
K_DOADORES = 10

# Cabecalho do registro do sidecar, antes das fracoes.
CABECALHO = np.dtype([
    ("cd_municipio", "<u4"), ("nr_zona", "<u2"), ("nr_locvot", "<u2"),
    ("flags", "u1"),
])
assert CABECALHO.itemsize == 9, CABECALHO.itemsize

QUANT = esq.QUANT  # mesma quantizacao do pacote presidencial

# ------------------------------------------------------------- colunas 2022

# "CLAUDIO CASTRO (PL) (ELEITO) 1T" -> nome, partido, situacao, turno.
#
# Os parenteses do meio sao um numero variavel de marcadores: (ELEITO),
# (NAO ELEITO), (2o TURNO), e as vezes (Inapto) antes deles. O nome usa
# repeticao preguicosa para nao engolir o partido, que e sempre o PRIMEIRO
# grupo entre parenteses.
#
# Conferido contra as 242 colunas de candidato dos 27 estados: 0 falhas.
COLUNA = re.compile(
    r"^(?P<nome>.+?)\s*\((?P<partido>[^()]+)\)\s*"
    r"(?P<marcas>(?:\([^()]*\)\s*)*)(?P<turno>[12]T)$"
)

# Colunas de totalizacao, que nao sao candidato.
PREFIXOS_TOTAL = ("Total_", "Votos_", "Absten", "Eleitores_")


def parse_coluna(chave: str) -> dict | None:
    """Nome/partido/situacao de uma coluna de candidato. None se nao for uma."""
    if chave.startswith(PREFIXOS_TOTAL):
        return None
    m = COLUNA.match(chave)
    if not m:
        return None
    marcas = [x.strip("() ") for x in re.findall(r"\([^()]*\)", m.group("marcas"))]
    marcas_up = [x.upper() for x in marcas]
    if "ELEITO" in marcas_up:
        situacao = "eleito"
    elif "2º TURNO" in marcas_up or "2° TURNO" in marcas_up:
        situacao = "segundo_turno"
    else:
        situacao = "nao_eleito"
    return {
        "coluna": chave,
        "nome": m.group("nome").strip(),
        "partido": m.group("partido").strip(),
        "situacao": situacao,
        "inapto": "INAPTO" in marcas_up,
        "turno": m.group("turno"),
    }


def slug(nome: str, usados: set[str] | None = None) -> str:
    """Nome -> chave estavel [a-z0-9_], unica dentro da UF."""
    sem_acento = "".join(c for c in unicodedata.normalize("NFD", nome)
                         if unicodedata.category(c) != "Mn")
    base = re.sub(r"[^a-z0-9]+", "_", sem_acento.lower()).strip("_") or "cand"
    if base in RESERVADAS:
        base += "_c"
    if usados is None:
        return base
    chave, n = base, 1
    while chave in usados:
        n += 1
        chave = f"{base}_{n}"
    usados.add(chave)
    return chave


def escolher_origens(pct_por_coluna: dict[str, float]) -> list[str]:
    """Colunas que viram origem propria: >= LIMIAR_ORIGEM% dos validos, as
    MAX_ORIGENS maiores. Ordenado por votacao, que e a ordem em que aparecem
    na tela de migracao."""
    ordenado = sorted(pct_por_coluna.items(), key=lambda kv: -kv[1])
    return [k for k, v in ordenado if v >= LIMIAR_ORIGEM][:MAX_ORIGENS]


def rotulo_titulo(nome: str) -> str:
    """'CLAUDIO CASTRO' -> 'Cláudio Castro'. Os GeoJSON vem em caixa alta."""
    miudas = {"de", "da", "do", "das", "dos", "e"}
    partes = []
    for i, p in enumerate(nome.split()):
        b = p.lower()
        partes.append(b if (i and b in miudas) else b[:1].upper() + b[1:])
    return " ".join(partes)
