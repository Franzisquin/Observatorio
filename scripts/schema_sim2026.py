"""Esquema demografico do Simulador 2026 — fonte unica da verdade.

Consumido por gerar_eleitorado_2026.py, gerar_base_2026.py e
gerar_ei_baselines_2026.py, e serializado para resultados_geo/sim2026/schema.json,
que o front-end (simulador.js + js/sim_ei_worker.js) le.

Duas familias de dimensao, distinguidas por `base`:

  base="elec"  vem do perfil do eleitorado 2026 do TSE, contagem exata por local
               de votacao (sexo, idade, escolaridade, estado civil, deficiencia).

  base="pop"   vem do Censo/IBGE ja agregado por local de votacao nos GeoJSON de
               locais_votacao_2022 (raca, renda) ou por municipio
               (religiao). E uma aproximacao: descreve a populacao do entorno do
               local, nao o eleitorado registrado nele.

O peso de um bucket na regressao ecologica usa `base` para escolher o
denominador — eleitores aptos para "elec", populacao do entorno para "pop".

NAO usamos CD_RACA_COR do TSE: em 2026 ela esta ~71% "NAO INFORMADO" (so e
coletada em realistamentos recentes, o que enviesa a subamostra para eleitores
jovens). A raca do Censo, ja presente nos GeoJSON, tem cobertura completa.
"""

from __future__ import annotations

# ---------------------------------------------------------------- dimensoes

DIMENSOES: list[dict] = [
    {
        "chave": "sexo",
        "rotulo": "Sexo",
        "base": "elec",
        "buckets": [("M", "Homens"), ("F", "Mulheres")],
    },
    {
        "chave": "idade",
        "rotulo": "Faixa etaria",
        "base": "elec",
        "ordinal": True,
        "buckets": [
            ("16-17", "16 a 17"), ("18-24", "18 a 24"), ("25-34", "25 a 34"),
            ("35-44", "35 a 44"), ("45-59", "45 a 59"), ("60-69", "60 a 69"),
            ("70+", "70 ou mais"),
        ],
    },
    {
        "chave": "escolaridade",
        "rotulo": "Grau de instrucao",
        "base": "elec",
        "ordinal": True,
        "buckets": [
            ("analfabeto", "Analfabeto"), ("le_escreve", "Le e escreve"),
            ("fund_inc", "Fundamental incompleto"), ("fund_comp", "Fundamental completo"),
            ("medio_inc", "Medio incompleto"), ("medio_comp", "Medio completo"),
            ("sup_inc", "Superior incompleto"), ("sup_comp", "Superior completo"),
        ],
    },
    {
        "chave": "estado_civil",
        "rotulo": "Estado civil",
        "base": "elec",
        "buckets": [
            ("solteiro", "Solteiro"), ("casado", "Casado"),
            ("separado", "Separado ou divorciado"), ("viuvo", "Viuvo"),
        ],
    },
    {
        "chave": "deficiencia",
        "rotulo": "Deficiencia",
        "base": "elec",
        "buckets": [("com", "Com deficiencia"), ("sem", "Sem deficiencia")],
    },
    {
        "chave": "raca",
        "rotulo": "Cor ou raca (Censo)",
        "base": "pop",
        "buckets": [
            ("branca", "Branca"), ("preta", "Preta"), ("parda", "Parda"),
            ("amarela", "Amarela"), ("indigena", "Indigena"),
        ],
    },
    {
        "chave": "renda",
        "rotulo": "Renda media do entorno",
        "base": "pop",
        "ordinal": True,
        "buckets": [
            ("ate1k", "Ate R$ 1.000"), ("1k2k", "R$ 1.000 a 2.000"),
            ("2k3k", "R$ 2.000 a 3.000"), ("3k5k", "R$ 3.000 a 5.000"),
            ("5k+", "Acima de R$ 5.000"),
        ],
    },
    {
        "chave": "religiao",
        "rotulo": "Religiao (Censo, municipal)",
        "base": "pop",
        "buckets": [
            ("catolica", "Catolica"), ("evangelica", "Evangelica"),
            ("outras", "Outras"), ("sem", "Sem religiao"),
        ],
    },
    {
        # PRIMEIRO turno, nao segundo: e a base da migracao e do preenchimento
        # automatico dos pesos regionais. O 1o turno tem "outros" (Ciro, Tebet,
        # etc.), que e justamente o eleitorado mais disputado em 2026 — no 2o
        # turno ele ja esta diluido em Lula/Bolsonaro e a informacao se perde.
        "chave": "voto2022",
        "rotulo": "Voto em 2022 (1o turno)",
        "base": "elec",
        "buckets": [
            ("lula", "Lula (PT)"), ("bolsonaro", "Bolsonaro (PL)"),
            ("outros", "Outros candidatos"),
            ("nulo_branco", "Nulo ou branco"), ("abstencao", "Abstencao"),
        ],
    },
]

# Redutos pessoais: candidatos a presidente em 2026 que foram governador em
# 2022 tem base eleitoral propria, concentrada nos municipios onde foram bem
# para o governo. Sem isso a migracao presidencial os espalha uniformemente
# pelo estado, o que subestima o reduto e superestima o resto.
#
# Guardamos, por local de votacao, a votacao de 1o turno do politico para
# governador como fracao dos aptos. O simulador usa isso para redistribuir os
# votos dele DENTRO do estado, preservando o total.
#
# Lista curada: para acrescentar alguem, basta uma linha aqui e reprocessar.
REDUTOS = [
    {"chave": "zema", "uf": "MG", "prefixo": "ZEMA (NOVO)", "nome": "Romeu Zema"},
    {"chave": "caiado", "uf": "GO", "prefixo": "RONALDO CAIADO", "nome": "Ronaldo Caiado"},
]


def n_redutos() -> int:
    return len(REDUTOS)

QUANT = 255  # fracoes quantizadas em u8, normalizadas dentro de cada dimensao


def chaves_buckets() -> list[str]:
    """Indice global dos buckets, na ordem em que sao gravados no .bin."""
    return [f"{d['chave']}|{b[0]}" for d in DIMENSOES for b in d["buckets"]]


def n_buckets() -> int:
    return sum(len(d["buckets"]) for d in DIMENSOES)


def offsets() -> dict[str, tuple[int, int]]:
    """chave da dimensao -> (offset do primeiro bucket, quantidade)."""
    fora, pos = {}, 0
    for d in DIMENSOES:
        fora[d["chave"]] = (pos, len(d["buckets"]))
        pos += len(d["buckets"])
    return fora


def para_json() -> dict:
    """Forma serializada lida pelo front-end."""
    return {
        "quant": QUANT,
        "nBuckets": n_buckets(),
        "bucketKeys": chaves_buckets(),
        "redutos": [{"key": r["chave"], "uf": r["uf"], "nome": r["nome"]} for r in REDUTOS],
        "dimensions": [
            {
                "key": d["chave"],
                "label": d["rotulo"],
                "base": d["base"],
                "ordinal": bool(d.get("ordinal")),
                "buckets": [{"key": k, "label": r} for k, r in d["buckets"]],
            }
            for d in DIMENSOES
        ],
    }


# ------------------------------------------------- mapeamento dos codigos TSE

def bucket_idade(codigo: int) -> str | None:
    """CD_FAIXA_ETARIA -> bucket. O codigo e AAII (idade inicial nos 2 primeiros digitos):
    1600='16 anos', 2124='21 a 24 anos', 9999='100 anos ou mais'. Mapeamos por faixa
    numerica em vez de lista fixa para sobreviver a codigos novos."""
    if codigo < 0:
        return None  # "Invalida" — fica de fora da normalizacao da dimensao
    inicio = codigo // 100
    if inicio < 16:
        return None
    if inicio <= 17:
        return "16-17"
    if inicio <= 24:
        return "18-24"
    if inicio <= 34:
        return "25-34"
    if inicio <= 44:
        return "35-44"
    if inicio <= 59:
        return "45-59"
    if inicio <= 69:
        return "60-69"
    return "70+"


BUCKET_SEXO = {2: "M", 4: "F"}

BUCKET_ESTADO_CIVIL = {1: "solteiro", 3: "casado", 5: "viuvo",
                       7: "separado", 9: "separado"}

BUCKET_ESCOLARIDADE = {
    1: "analfabeto", 2: "le_escreve", 3: "fund_inc", 4: "fund_comp",
    5: "medio_inc", 6: "medio_comp", 7: "sup_inc", 8: "sup_comp",
}


def bucket_renda(renda_media: float) -> str:
    if renda_media < 1000:
        return "ate1k"
    if renda_media < 2000:
        return "1k2k"
    if renda_media < 3000:
        return "2k3k"
    if renda_media < 5000:
        return "3k5k"
    return "5k+"
