"""Gera o perfil demografico agregado do Brasil, um arquivo por ano de censo.

Por que pre-calcular: o perfil da tela e montado somando os locais de votacao
carregados. No escopo nacional nao ha locais carregados (o mapa e por estado, e
baixar os 27 estados de censo custaria ~16 MB por ano so para preencher um
painel lateral). Cada arquivo gerado aqui tem algumas dezenas de numeros.

    resultados_geo/Censo <ANO>/perfil_nacional_<ANO>.json

A agregacao replica exatamente updateNeighborhoodProfileUI (js/ui-results.js):

  * renda      -> media SIMPLES entre locais com "Renda Media" > 0
  * raca e
    saneamento -> media das porcentagens por local, dividida por TODOS os
                  locais (inclusive os sem o dado), como o `pctSum[x] / count`
                  da tela
  * genero, estado civil,
    escolaridade, idade -> soma absoluta

As faixas etarias usam a mesma regra de sobreposicao proporcional de
aggregateAgeBucketsFromProps (js/utils.js): uma faixa de origem que cruza duas
faixas de destino tem o valor rateado pela fracao de anos em comum.

Uso:  py scripts/gerar_perfil_nacional.py [ano ...]
"""

import json
import re
import sys
import unicodedata
import zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CENSO_DIR = RAIZ / "resultados_geo"

# Espelha AGE_BUCKETS_STANDARD em js/utils.js
FAIXAS_ETARIAS = [("16-29", 16, 29), ("30-45", 30, 45), ("46-59", 46, 59), ("60+", 60, 200)]

CAMPOS_PCT = {
    "Branca": ["Pct Branca", "PCT BRANCA"],
    "Preta": ["Pct Preta", "PCT PRETA"],
    "Parda": ["Pct Parda", "PCT PARDA"],
    "Amarela": ["Pct Amarela", "PCT AMARELA"],
    "Indigena": ["Pct Indigena", "PCT INDIGENA"],
    "RedeGeral": ["Pct Esgoto Rede Geral"],
    "FossaSeptica": ["Pct Fossa Septica", "Pct Fossa Séptica"],
    "Inadequado": ["Pct Esgoto Inadequado"],
}

CAMPOS_ABS = {
    "Homens": ["MASCULINO", "HOMENS", "Homens"],
    "Mulheres": ["FEMININO", "MULHERES", "Mulheres"],
    "Solteiro": ["SOLTEIRO", "Solteiro"],
    "Casado": ["CASADO", "Casado"],
    "Divorciado": ["DIVORCIADO", "Divorciado"],
    "Viuvo": ["VIÚVO", "VIUVO", "Viúvo", "Viuvo"],
    "Separado": ["SEPARADO JUDICIALMENTE", "SEPARADO", "Separado"],
    "Analfabeto": ["ANALFABETO", "Analfabeto"],
    "LeEscreve": ["LÊ E ESCREVE", "LE E ESCREVE", "Lê e Escreve"],
    "FundIncomp": ["ENSINO FUNDAMENTAL INCOMPLETO", "FUNDAMENTAL INCOMPLETO"],
    "FundComp": ["ENSINO FUNDAMENTAL COMPLETO", "FUNDAMENTAL COMPLETO"],
    "MedIncomp": ["ENSINO MÉDIO INCOMPLETO", "MEDIO INCOMPLETO"],
    "MedComp": ["ENSINO MÉDIO COMPLETO", "MEDIO COMPLETO"],
    "SupIncomp": ["ENSINO SUPERIOR INCOMPLETO", "SUPERIOR INCOMPLETO"],
    "SupComp": ["ENSINO SUPERIOR COMPLETO", "SUPERIOR COMPLETO"],
}

UFS = [
    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
    "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
    "SP", "SE", "TO",
]


def num(valor):
    try:
        n = float(valor)
    except (TypeError, ValueError):
        return 0.0
    return n if n == n and n not in (float("inf"), float("-inf")) else 0.0


def pegar(props, chaves):
    """getVal do JS: tenta as chaves na ordem, depois case-insensitive."""
    for chave in chaves:
        if chave in props:
            return num(props[chave])
    maiusculas = {k.upper(): v for k, v in props.items()}
    for chave in chaves:
        if chave.upper() in maiusculas:
            return num(maiusculas[chave.upper()])
    return 0.0


def faixa_da_chave(chave):
    """parseAgeRangeFromKey do JS."""
    if not re.search(r"anos", chave, re.I):
        return None
    m = re.search(r"(\d+)\s*(?:a|ate|to|-|_)\s*(\d+)", chave, re.I)
    if m:
        return (int(m.group(1)), int(m.group(2)))
    m = re.search(r"(\d+)\s*(?:anos)?\s*(?:ou)?\s*mais", chave, re.I)
    if m:
        return (int(m.group(1)), 200)
    m = re.search(r"(\d+)\s*anos", chave, re.I)
    if m:
        return (int(m.group(1)), int(m.group(1)))
    return None


def sobreposicao(origem, destino):
    """getAgeRangeOverlapRatio do JS."""
    inicio = max(origem[0], destino[0])
    fim = min(origem[1], destino[1])
    if fim < inicio:
        return 0.0
    return (fim - inicio + 1) / max(1, origem[1] - origem[0] + 1)


def faixas_do_local(props):
    """aggregateAgeBucketsFromProps: absolutos tem prioridade sobre Pct."""
    absolutos, percentuais = [], []
    for chave, valor in props.items():
        if not re.search(r"anos", chave, re.I):
            continue
        v = num(valor)
        if v <= 0:
            continue
        faixa = faixa_da_chave(chave)
        if not faixa:
            continue
        (percentuais if re.match(r"^Pct", chave, re.I) else absolutos).append((faixa, v))

    entradas = absolutos or percentuais
    baldes = {k: 0.0 for k, _, _ in FAIXAS_ETARIAS}
    for faixa, valor in entradas:
        for chave, minimo, maximo in FAIXAS_ETARIAS:
            razao = sobreposicao(faixa, (minimo, maximo))
            if razao > 0:
                baldes[chave] += valor * razao
    return baldes


def agregar_ano(ano):
    pasta = CENSO_DIR / f"Censo {ano}"
    if not pasta.is_dir():
        return None

    total = {
        "count": 0,
        "sumRenda": 0.0,
        "countRenda": 0,
        "pctSum": {k: 0.0 for k in CAMPOS_PCT},
        "abs": {k: 0.0 for k in CAMPOS_ABS},
        "ageBuckets": {k: 0.0 for k, _, _ in FAIXAS_ETARIAS},
        "ufs": 0,
    }

    for uf in UFS:
        caminho = pasta / f"censo_{ano}_{uf}.zip"
        if not caminho.exists():
            print(f"  [{ano}] {uf}: zip ausente", file=sys.stderr)
            continue
        with zipfile.ZipFile(caminho) as z:
            nome = f"censo_{ano}_{uf}.json"
            if nome not in z.namelist():
                candidatos = [n for n in z.namelist()
                              if n.endswith(".json") and not n.endswith("_resumo.json")]
                if not candidatos:
                    continue
                nome = candidatos[0]
            dados = json.loads(z.read(nome).decode("utf-8", errors="replace"))

        locais = dados.get("RESULTS") or {}
        if isinstance(locais, list):
            locais = {str(i): v for i, v in enumerate(locais)}
        if not locais:
            continue

        total["ufs"] += 1
        for props in locais.values():
            if not isinstance(props, dict):
                continue
            total["count"] += 1

            renda = num(props.get("Renda Media"))
            if renda > 0:
                total["sumRenda"] += renda
                total["countRenda"] += 1

            for destino, chaves in CAMPOS_PCT.items():
                total["pctSum"][destino] += pegar(props, chaves)
            for destino, chaves in CAMPOS_ABS.items():
                total["abs"][destino] += pegar(props, chaves)
            for chave, valor in faixas_do_local(props).items():
                total["ageBuckets"][chave] += valor

        print(f"  [{ano}] {uf}: {len(locais)} locais")

    return total if total["count"] else None


def main():
    anos = sys.argv[1:] or [p.name.split()[-1] for p in sorted(CENSO_DIR.glob("Censo *"))]
    for ano in anos:
        print(f"== Censo {ano}")
        total = agregar_ano(ano)
        if not total:
            print(f"  [{ano}] sem dados; pulando")
            continue

        total["abs"] = {k: round(v) for k, v in total["abs"].items()}
        total["ageBuckets"] = {k: round(v) for k, v in total["ageBuckets"].items()}
        total["pctSum"] = {k: round(v, 4) for k, v in total["pctSum"].items()}
        total["sumRenda"] = round(total["sumRenda"], 2)
        total["ano"] = int(ano)

        destino = CENSO_DIR / f"Censo {ano}" / f"perfil_nacional_{ano}.json"
        destino.write_text(json.dumps(total, ensure_ascii=False), encoding="utf-8")
        media = total["sumRenda"] / total["countRenda"] if total["countRenda"] else 0
        print(f"  -> {destino.name}: {total['count']} locais em {total['ufs']} UFs, "
              f"renda media R$ {media:,.2f}")


if __name__ == "__main__":
    main()
