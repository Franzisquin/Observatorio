"""Ensaio da noite de apuracao com TODOS os cargos de 2022, do acervo local.

Toca a apuracao de 2022 inteira — presidente, governador, senador, deputado
federal, estadual e distrital, nos dois turnos — e escreve exatamente os
arquivos que coleta.py e plantao.py escrevem na noite de verdade, para que
todas as paginas da apuracao possam ser testadas ao mesmo tempo:

    indice.json                      cargo -> eleicao, como o plantao publica
    {ele}-ab.json                    acompanhamento (EA14): onde falta contar
    {ele}-{cargo}-br.json            o pais (presidente)
    {ele}-{cargo}-uf.json            as UFs; nos proporcionais, com `agrem`
    {ele}-{cargo}-{uf}.json          os municipios de uma UF
    {ele}-{cargo}-lista-{uf}.json    deputados: a lista aberta de cada bloco
    {ele}-{cargo}-zonas-{ibge}.json  as zonas eleitorais das cidades da pagina
                                     de zonas (presidente, governador, senador)
    {ele}-0001-proj.json             a projecao presidencial (com numpy)

    python scripts/apuracao/ensaio_2022.py --tocar --duracao 10 --passo 8
    python scripts/apuracao/ensaio_2022.py --turno 2 --tocar
    python scripts/apuracao/ensaio_2022.py --instante 0.4
    python scripts/apuracao/ensaio_2022.py --instante 0.4 --ufs sp rj ac

Depois abra, com o mesmo `dados=` em todas:
    apuracao-presidente.html?cargo=0001&dados=scratch/apuracao/ensaio2022-t1/
    apuracao-governador.html?dados=scratch/apuracao/ensaio2022-t1/
    apuracao-senado.html?dados=scratch/apuracao/ensaio2022-t1/
    apuracao-zonas.html?mun=3550308&dados=scratch/apuracao/ensaio2022-t1/
    apuracao-uf.html?uf=sp&cargo=0003&dados=scratch/apuracao/ensaio2022-t1/
    apuracao-deputados.html?cargo=0006&dados=scratch/apuracao/ensaio2022-t1/

DE ONDE VEM. resultados_geo/Majoritarias 2022 e Legislativas 2022: o voto de
cada candidato em cada local de votacao, com a situacao final (eleito, 2o
turno, eleito por QP...) e as federacoes. E o mesmo acervo do visualizador, e
nada aqui vai a rede.

O QUE E DE VERDADE: nomes, partidos, coligacoes, federacoes, votos por local,
vagas finais e a situacao final de cada candidato — e, com o resumo dos
boletins de urna (scripts/apuracao/sequencia_2022.py), o CAMINHO: cada secao
chega na hora em que o boletim dela chegou ao TSE na noite de 2022
(DT_BU_RECEBIDO), em todos os cargos ao mesmo tempo, com as secoes, os aptos e
o comparecimento reais. O acervo guarda o voto por local, nao por secao: o voto
de um local entra em faixas de 10 minutos, na proporcao do comparecimento das
secoes dele que chegaram naquela faixa. `--duracao` comprime a noite de 17h ate
o momento em que 99,9% das secoes tinham chegado; as poucas que chegaram depois
entram no fim. Sem o resumo (ou para o local que ele nao tem, como o exterior),
cada zona chega num instante sorteado, como antes, e secoes e eleitorado sao
estimados do voto. As vagas de deputado (`vag`), que o TSE refaz a
cada totalizacao, saem de cadeiras.py, com as regras de 2026; na totalizacao
final ficam os eleitos de 2022, antes da retotalizacao do STF. Tudo sai com fase
"s": as paginas mostram o selo SIMULADO.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
import zipfile
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cadeiras import distribuir, quociente_eleitoral  # noqa: E402
from coleta import escrever, historico  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent.parent
GEO = RAIZ / "resultados_geo"
MAJ = GEO / "Majoritarias 2022"
LEG = GEO / "Legislativas 2022"
PONTE = GEO / "tse_para_ibge.json"
ZONAS_INDICE = GEO / "zonas_svg" / "indice.json"
CARGOS_ZONAS = ("0001", "0003", "0005")

UFS = ("ac al am ap ba ce df es go ma mg ms mt pa pb pe pi pr rj rn ro rr rs sc se "
       "sp to").split()

# 2022 tinha uma eleicao geral so; aqui ela e partida como a de 2026 — uma
# federal e uma estadual —, com os codigos de eleicao de 2022.
ELEICOES = {
    "1": {"544": ["0001"], "546": ["0003", "0005", "0006", "0007", "0008"]},
    "2": {"545": ["0001"], "547": ["0003"]},
}
PROPORCIONAIS = {"0006", "0007", "0008"}
NOME_CARGO = {"0001": "Presidente", "0003": "Governador", "0005": "Senador",
              "0006": "Deputado Federal", "0007": "Deputado Estadual",
              "0008": "Deputado Distrital"}

SITUACAO = {"ELEITO": "Eleito", "2º TURNO": "2º turno", "NÃO ELEITO": "Não eleito",
            "ELEITO POR QP": "Eleito por QP", "ELEITO POR MÉDIA": "Eleito por média",
            "SUPLENTE": "Suplente"}

# Proporcoes de ensaio: o acervo guarda voto, nao secao nem eleitorado.
VOTOS_POR_SECAO = 280
COMPARECIMENTO = 0.79

# A noite real, dos boletins de urna (sequencia_2022.py). Faixa, em minutos,
# em que as secoes de um mesmo local chegam juntas; e a fracao das secoes do
# pais que marca o fim da noite comprimida em --duracao.
SEQUENCIA = RAIZ / "scratch" / "bweb" / "sequencia_2022_t{turno}.json"
FAIXA_MIN = 10
FIM_DA_NOITE = 0.999


def carregar_sequencia(turno: str) -> tuple[dict, float, str] | None:
    """(locais, minutos do fim da noite, hora zero) ou None sem o resumo."""
    caminho = Path(str(SEQUENCIA).format(turno=turno))
    if not caminho.exists():
        return None
    d = json.loads(caminho.read_text(encoding="utf-8"))
    tempos = sorted(s[0] for secoes in d["locais"].values() for s in secoes)
    fim = tempos[min(len(tempos) - 1, int(FIM_DA_NOITE * len(tempos)))]
    return d["locais"], max(fim, 1.0), d["zero"]


def inteiros(votos: Counter) -> Counter:
    """Voto fracionado (o local repartido pelas secoes) de volta a inteiro."""
    return Counter({k: int(round(v)) for k, v in votos.items()})


def ufs_do_cargo(cargo: str, turno: str, pedidas: list[str]) -> list[str]:
    base = [u for u in (pedidas or UFS)]
    if cargo == "0001":
        return base + (["zz"] if not pedidas or "zz" in pedidas else [])
    if cargo == "0008":
        return [u for u in base if u == "df"]
    if cargo == "0007":
        return [u for u in base if u != "df"]
    return base


def arquivo(cargo: str, uf: str, turno: str) -> tuple[Path, str]:
    U = uf.upper()
    if cargo == "0001":
        nome = f"presidente_2022_t{turno}_{U}"
    elif cargo == "0003":
        nome = f"governador_2022_t{turno}_{U}"
    elif cargo == "0005":
        nome = f"senador_2022_t1_{U}"
    else:
        casa = "federal" if cargo == "0006" else "estadual"
        return LEG / f"deputados_{casa}_2022_{U}.zip", f"deputados_{casa}_2022_{U}.json"
    return MAJ / f"{nome}.zip", f"{nome}.json"


def ler(cargo: str, uf: str, turno: str) -> dict | None:
    caminho, nome = arquivo(cargo, uf, turno)
    if not caminho.exists():
        return None
    with zipfile.ZipFile(caminho) as z:
        return json.loads(z.read(nome).decode("utf-8"))


# ------------------------------------------------------------------ unidades

class Casa:
    """Um cargo numa UF: as unidades (zona de um municipio) que chegam ao longo
    da noite, e o que ja chegou."""

    def __init__(self, cargo: str, uf: str, dados: dict, tamanho: dict[str, int],
                 semente: int, nv: int, sequencia: tuple | None = None):
        self.cargo, self.uf, self.nv = cargo, uf, nv
        self.nomes = dados["METADATA"]["cand_names"]
        self.unidades = []
        self.na_sequencia = self.fora_da_sequencia = 0
        locais, fim_da_noite = (sequencia[0], sequencia[1]) if sequencia else ({}, 1.0)
        unidades: dict[tuple[str, str], Counter] = {}
        for chave, votos in dados["RESULTS"].items():
            partes = chave.split("_")
            if len(partes) >= 3:
                zona, mun = partes[0], partes[1].zfill(5)
                secoes = locais.get(f"{mun}_{int(zona)}_{int(partes[2])}") if locais else None
                if secoes:
                    self.na_sequencia += 1
                    self.adicionar_local(mun, zona, votos, secoes, fim_da_noite)
                    continue
                self.fora_da_sequencia += 1
            elif uf == "zz":
                # O exterior vem por pais ("NPL", "CIV"): cada um e uma unidade.
                zona, mun = "1", chave
            else:
                continue
            alvo = unidades.setdefault((mun, zona), Counter())
            for numero, v in votos.items():
                alvo[str(numero)] += int(v)

        # Ordem de chegada: cada zona de cada municipio chega num instante
        # sorteado, com o sorteio puxado para cedo no municipio pequeno e
        # espalhado pela noite inteira na capital — como na noite real, em que o
        # interior fecha primeiro e a capital arrasta a cauda, mas comeca a
        # contar junto. Semeado por (UF, municipio, zona), e nao pelo cargo: a
        # mesma urna chega na mesma hora para todos.
        ordem = sorted(tamanho, key=lambda m: tamanho[m])
        posicao = {m: i / max(1, len(ordem) - 1) for i, m in enumerate(ordem)}
        for (mun, zona), votos in unidades.items():
            sorteio = random.Random(f"{semente}|{uf}|{mun}|{zona}")
            curva = 1.3 + 1.5 * (1 - posicao.get(mun, 0.5))
            fim = min(0.985, 0.01 + sorteio.random() ** curva)
            tv = sum(votos.values())
            self.unidades.append({"t": fim, "mun": mun, "zona": zona.zfill(4), "votos": votos,
                                  "fracao": 1.0, "secoes": max(1, round(tv / VOTOS_POR_SECAO)),
                                  "te": round(tv / COMPARECIMENTO)})
        self.unidades.sort(key=lambda u: u["t"])

        self.ts_mun, self.te_mun = Counter(), Counter()
        # A mesma conta por zona, para a pagina de zonas: (municipio, zona).
        self.ts_zona, self.te_zona = Counter(), Counter()
        for u in self.unidades:
            self.ts_mun[u["mun"]] += u["secoes"]
            self.te_mun[u["mun"]] += u["te"]
            self.ts_zona[(u["mun"], u["zona"])] += u["secoes"]
            self.te_zona[(u["mun"], u["zona"])] += u["te"]
        self.reiniciar()

    def adicionar_local(self, mun: str, zona: str, votos: dict, secoes: list,
                        fim_da_noite: float) -> None:
        """Um local de votacao na hora real: as secoes dele em faixas de
        FAIXA_MIN minutos, cada faixa com a parte do voto do local que cabe ao
        comparecimento das secoes que chegaram nela."""
        contagem = Counter()
        for numero, v in votos.items():
            contagem[str(numero)] += int(v)
        comp_total = sum(c for _, _, c in secoes)
        faixas: dict[int, list] = {}
        for minutos, aptos, comp in secoes:
            faixas.setdefault(int(max(0.0, minutos) // FAIXA_MIN), []).append((minutos, aptos, comp))
        for grupo in faixas.values():
            ultimo = max(m for m, _, _ in grupo)
            comp = sum(c for _, _, c in grupo)
            fracao = (comp / comp_total) if comp_total else len(grupo) / len(secoes)
            self.unidades.append({
                "t": min(0.999, max(0.0001, ultimo / fim_da_noite)),
                "mun": mun, "zona": zona.zfill(4), "votos": contagem, "fracao": fracao,
                "secoes": len(grupo), "te": sum(a for _, a, _ in grupo)})

    def reiniciar(self):
        self.ponteiro = 0
        self.mun = {m: {"votos": Counter(), "st": 0, "te": 0} for m in self.ts_mun}
        self.zona = {k: {"votos": Counter(), "st": 0, "te": 0} for k in self.ts_zona}

    def avancar(self, t: float):
        """Soma o que chegou ate o instante t (que so cresce)."""
        while self.ponteiro < len(self.unidades) and (self.unidades[self.ponteiro]["t"] <= t
                                                      or t >= 1.0):
            u = self.unidades[self.ponteiro]
            fracao = u["fracao"]
            for alvo in (self.mun[u["mun"]], self.zona[(u["mun"], u["zona"])]):
                if fracao == 1.0:
                    alvo["votos"].update(u["votos"])
                else:
                    acc = alvo["votos"]
                    for k, v in u["votos"].items():
                        acc[k] += v * fracao
                alvo["st"] += u["secoes"]
                alvo["te"] += u["te"]
            self.ponteiro += 1

    def anulados(self) -> set[str]:
        """Chaves dos candidatos com voto anulado (registro indeferido)."""
        return {sq(self.cargo, self.uf, n) for n in self.candidatos()
                if self.situacao(n) == "INAPTO"}

    # ---- leitura do voto

    def situacao(self, numero: str) -> str:
        return str((self.nomes.get(numero) or ["", "", ""])[2] or "")

    def candidatos(self) -> list[str]:
        """Numeros de candidato (sem branco, nulo e legenda)."""
        minimo = 4 if self.cargo in PROPORCIONAIS else 2
        return [n for n in self.nomes if len(n) >= minimo and n not in ("95", "96")
                and self.situacao(n) not in ("LEGENDA", "BRANCO", "NULO")]

    def separar(self, votos: Counter) -> dict:
        """Brancos, nulos, validos e anulados de um punhado de voto."""
        vb, vn = votos.get("95", 0), votos.get("96", 0)
        van = vnom = vl = 0
        for numero, v in votos.items():
            if numero in ("95", "96"):
                continue
            if len(numero) == 2 and self.cargo in PROPORCIONAIS:
                vl += v
            elif self.situacao(numero) == "INAPTO":
                van += v
            else:
                vnom += v
        return {"vb": vb, "vn": vn, "van": van, "vnom": vnom, "vl": vl, "vv": vnom + vl}


# --------------------------------------------------------------- formatacao

def sq(cargo: str, uf: str, numero: str) -> str:
    """Chave do candidato. Presidente e o mesmo em todas as UFs; os demais
    repetem numero de uma UF para outra, entao a UF entra na chave."""
    return numero if cargo == "0001" else f"{uf}{numero}"


def entrada(casa: Casa, votos: Counter, st: int, ts: int, te: int, te_fechado: int,
            final: bool, completo: bool, agora: time.struct_time) -> dict:
    votos = inteiros(votos)
    s = casa.separar(votos)
    tv = sum(votos.values())
    e = {
        "and": "f" if ts and st >= ts else ("p" if st else "n"),
        "tf": "s" if final else "n", "dv": "s", "md": "",
        "dt": time.strftime("%d/%m/%Y", agora), "ht": time.strftime("%H:%M:%S", agora),
        "st": st, "ts": ts, "pst": round(100 * st / ts, 2) if ts else 0.0,
        "te": te, "comp": tv, "abst": max(0, te_fechado - tv),
        "tv": tv, "vvc": s["vv"] + s["van"], "vv": s["vv"], "vb": s["vb"], "vn": s["vn"],
    }
    if casa.cargo in PROPORCIONAIS:
        e["part"] = votos_por_partido(casa, votos)
    else:
        e["cand"] = {sq(casa.cargo, casa.uf, n): votos.get(n, 0) for n in casa.candidatos()}
    if completo:
        e.update({"nv": casa.nv, "snt": ts - st, "si": st, "sni": 0, "sa": st, "sna": 0,
                  "est": te_fechado, "esnt": te - te_fechado, "esi": te_fechado, "esni": 0,
                  "esa": te_fechado, "esna": 0, "vnom": s["vnom"], "vl": s["vl"],
                  "van": s["van"], "vansj": 0, "tvn": s["vn"], "vnt": 0, "vscv": 0, "vsan": 0})
        if casa.cargo in PROPORCIONAIS and casa.nv:
            e["qe"] = quociente_eleitoral(s["vv"], casa.nv)
    return e


def sigla_de_numero(casa: Casa) -> dict[str, str]:
    if not hasattr(casa, "_siglas"):
        casa._siglas = {}
        for numero, meta in casa.nomes.items():
            if len(numero) >= 4 and meta[1]:
                casa._siglas.setdefault(numero[:2], meta[1])
    return casa._siglas


def votos_por_partido(casa: Casa, votos: Counter) -> dict[str, int]:
    total: Counter = Counter()
    siglas = sigla_de_numero(casa)
    for numero, v in votos.items():
        if numero in ("95", "96"):
            continue
        if len(numero) == 2:
            if numero in siglas:
                total[siglas[numero]] += v
        elif casa.situacao(numero) != "INAPTO":
            total[(casa.nomes.get(numero) or ["", ""])[1]] += v
    return dict(total)


def dicionario(casa: Casa, final: bool) -> dict[str, dict]:
    """Os candidatos majoritarios como o coletor os guarda. A situacao so vem
    na totalizacao final, como no TSE."""
    saida = {}
    for numero in casa.candidatos():
        urna, partido, situacao, coligacao, composicao = (casa.nomes[numero] + [""] * 5)[:5]
        item = {"nome": urna, "urna": urna, "numero": numero, "partido": partido,
                "coligacao": coligacao if composicao and "/" in composicao else ""}
        if situacao == "INAPTO":
            item["destino"] = "Anulado"
        if final and situacao in SITUACAO:
            item["situacao"] = SITUACAO[situacao]
            if situacao in ("ELEITO", "2º TURNO"):
                item["eleito"] = "s"
        saida[sq(casa.cargo, casa.uf, numero)] = item
    return saida


# ---------------------------------------------------------------- deputados

def blocos(casa: Casa, votos: Counter, final: bool) -> list[dict]:
    """Agremiacoes com a lista aberta, no desenho de coleta.agremiacoes()."""
    siglas = sigla_de_numero(casa)
    grupos: dict[str, dict] = {}
    for numero in casa.candidatos():
        urna, partido, situacao, tipo, rotulo = (casa.nomes[numero] + [""] * 5)[:5]
        if tipo == "FEDERAÇÃO" and "(" in rotulo:
            nm, com = rotulo.split("(", 1)
            nm, com, tp = nm.strip(), com.rstrip(")").strip(), "f"
        else:
            nm, com, tp = partido, partido, "i"
        g = grupos.setdefault(nm, {"nm": nm, "com": com, "tp": tp, "par": {}, "cand": [],
                                   "eleitos": 0})
        if tp == "f":
            g["fed"] = nm.split(" - ")[-1] if " - " in nm else nm
            g["fedcom"] = com
        par = g["par"].setdefault(partido, {"sg": partido, "n": numero[:2], "nm": "",
                                            "vtn": 0, "vtl": 0, "dvt": ""})
        v = votos.get(numero, 0)
        item = {"sq": sq(casa.cargo, casa.uf, numero), "n": numero, "urna": urna,
                "partido": partido, "v": v}
        if situacao == "INAPTO":
            item["dvt"] = "Anulado"
        else:
            par["vtn"] += v
        if final and situacao in SITUACAO:
            item["st"] = SITUACAO[situacao]
            if situacao.startswith("ELEITO"):
                item["e"] = "s"
                g["eleitos"] += 1
        elif situacao.startswith("ELEITO"):
            g["eleitos"] += 1
        g["cand"].append(item)

    for numero, v in votos.items():
        if len(numero) == 2 and numero not in ("95", "96") and numero in siglas:
            for g in grupos.values():
                if siglas[numero] in g["par"]:
                    g["par"][siglas[numero]]["vtl"] += v

    saida = []
    for g in grupos.values():
        par = list(g["par"].values())
        vtn = sum(p["vtn"] for p in par)
        vtl = sum(p["vtl"] for p in par)
        g["cand"].sort(key=lambda c: (-c["v"], c["urna"]))
        saida.append({"nm": g["nm"], "com": g["com"], "tp": g["tp"], "vag": 0,
                      "v": vtn + vtl, "vtn": vtn, "vtl": vtl, "van": vtn, "val": vtl,
                      **({"fed": g["fed"], "fedcom": g["fedcom"]} if g.get("fed") else {}),
                      "par": par, "cand": g["cand"], "_eleitos": g["eleitos"]})

    # Como o TSE (EA20: `vag` "pode ter seu valor atualizado a cada
    # totalizacao"), a vaga parcial sai a cada boletim, pelas regras de 2026; na
    # totalizacao final ficam os eleitos de 2022. `cad` e a conta do coletor.
    filas = [[c["v"] for c in b["cand"] if "dvt" not in c] for b in saida]
    for b, n in zip(saida, distribuir([b["v"] for b in saida], filas, casa.nv)):
        b["cad"] = n
        b["vag"] = b["_eleitos"] if final else n
        del b["_eleitos"]
    return sorted(saida, key=lambda b: -b["v"])


# -------------------------------------------------------------------- quadro

def meta(eleicao: str, turno: str, cargo: str, volta: int) -> dict:
    agora = time.gmtime()
    return {"ele": eleicao, "t": turno, "f": "s", "sup": "n", "idg": str(volta),
            "dg": time.strftime("%d/%m/%Y"), "hg": time.strftime("%H:%M:%S"),
            "cargo": cargo, "fonte": "TSE 2022 (ensaio)",
            "gerado": time.strftime("%Y-%m-%dT%H:%M:%SZ", agora)}


def somar(entradas: list[dict]) -> dict:
    total = dict(entradas[0])
    for campo in ("st", "ts", "te", "comp", "abst", "tv", "vvc", "vv", "vb", "vn", "snt",
                  "si", "sa", "est", "esnt", "esi", "esa", "vnom", "vl", "van", "tvn"):
        total[campo] = sum(e.get(campo, 0) for e in entradas)
    cand: Counter = Counter()
    for e in entradas:
        cand.update(e.get("cand") or {})
    total["cand"] = dict(cand)
    total["pst"] = round(100 * total["st"] / total["ts"], 2) if total["ts"] else 0.0
    total["and"] = ("f" if all(e["and"] == "f" for e in entradas)
                    else "p" if any(e["and"] != "n" for e in entradas) else "n")
    return total


def escrever_quadro(casas: dict, plano: dict[str, list[str]], turno: str, t: float,
                    volta: int, destino: Path, nomes_mun: dict,
                    relogio: time.struct_time | None = None) -> dict:
    final = t >= 1.0
    # A hora do boletim: a da noite de 2022 (com a sequencia real), para o
    # carimbo e o historico mostrarem 19h34, e nao a hora do ensaio.
    agora = relogio or time.localtime()
    resumo = {}
    for eleicao, cargos in plano.items():
        acompanha = None
        for cargo in cargos:
            por_uf = casas.get(cargo) or {}
            if not por_uf:
                continue
            cab = meta(eleicao, turno, cargo, volta)
            abr_uf, cand_uf, agrem_uf = {}, {}, {}
            totais_zonas = {}
            for uf, casa in por_uf.items():
                casa.avancar(t)
                municipal = {}
                for mun, acc in casa.mun.items():
                    municipal[mun] = entrada(casa, acc["votos"], acc["st"], casa.ts_mun[mun],
                                             casa.te_mun[mun], acc["te"], final, False, agora)
                todos = Counter()
                for acc in casa.mun.values():
                    todos.update(acc["votos"])
                todos = inteiros(todos)
                st = sum(a["st"] for a in casa.mun.values())
                te_f = sum(a["te"] for a in casa.mun.values())
                e_uf = entrada(casa, todos, st, sum(casa.ts_mun.values()),
                               sum(casa.te_mun.values()), te_f, final, True, agora)
                # Presidente se decide no pais: o `md` vai so no arquivo br.
                if cargo != "0001":
                    definir_md(e_uf, cargo, turno, casa.anulados())
                abr_uf[uf] = e_uf
                if cargo in PROPORCIONAIS:
                    lista = blocos(casa, todos, final)
                    agrem_uf[uf] = [{k: v for k, v in b.items() if k != "cand"} for b in lista]
                    escrever(destino, f"{eleicao}-{cargo}-lista-{uf}.json",
                             {"meta": cab, "uf": uf, "abr": e_uf, "agrem": lista})
                    dic = {}
                else:
                    dic = dicionario(casa, final)
                    cand_uf.update(dic)
                if uf != "zz":
                    mun_nomes = {m: nomes_mun.get(m, {"nm": m, "ibge": ""}) for m in municipal}
                    escrever(destino, f"{eleicao}-{cargo}-{uf}.json",
                             {"meta": cab, "abr": municipal, "mun": mun_nomes, "cand": dic})
                if cargo in CARGOS_ZONAS:
                    totais_zonas.update(escrever_zonas(casa, cab, dic, eleicao, cargo, uf, final,
                                                       agora, destino))

            escrever(destino, f"{eleicao}-{cargo}-uf.json",
                     {"meta": cab, "abr": abr_uf, "cand": cand_uf,
                      **({"agrem": agrem_uf} if agrem_uf else {})})
            entradas_hist = dict(abr_uf)
            if cargo == "0001":
                br = somar(list(abr_uf.values()))
                definir_md(br, cargo, turno, set().union(*(c.anulados() for c in por_uf.values())))
                escrever(destino, f"{eleicao}-{cargo}-br.json",
                         {"meta": cab, "cand": cand_uf, "abr": {"br": br}})
                entradas_hist["br"] = br
            # O mesmo historico que o coletor grava: um ponto por quadro.
            historico(destino, eleicao, cargo, entradas_hist)
            if totais_zonas:
                historico(destino, eleicao, cargo, totais_zonas, nome="hist-zonas")
            if acompanha is None:
                acompanha = (cargo, abr_uf, por_uf)
            br = somar(list(abr_uf.values()))
            resumo[f"{eleicao}-{cargo}"] = br["pst"]

        if acompanha:
            escrever_acompanhamento(destino, eleicao, turno, volta, *acompanha)
    return resumo


def definir_md(e: dict, cargo: str, turno: str, anulados: set[str] = frozenset()) -> None:
    """`md` como o TSE o publica (so presidente e governador, e so antes da
    totalizacao final): 'e' quando o lider ja tem maioria absoluta mesmo que
    todo o eleitorado que falta votasse contra; 's' quando ninguem mais alcanca
    a maioria e os dois primeiros ja nao podem ser passados.

    So entre quem tem voto valido: o anulado (registro indeferido) nao esta em
    `vv` e nao disputa. Contado, o Valmir de Francisquinho (SE 2022) saia com
    'e' — maioria "absoluta" de votos que nao valiam."""
    if cargo not in ("0001", "0003") or e.get("tf") == "s":
        return
    votos = sorted((v for k, v in (e.get("cand") or {}).items() if k not in anulados),
                   reverse=True) + [0, 0, 0]
    resta, vv = e.get("esnt", 0), e.get("vv", 0)
    if not vv:
        e["md"] = ""
    elif 2 * votos[0] > vv + resta:
        e["md"] = "e"
    elif turno == "1" and 2 * votos[0] + resta <= vv and votos[1] > votos[2] + resta:
        e["md"] = "s"
    else:
        e["md"] = ""


def cidades_com_zonas() -> dict[str, list[dict]]:
    """As cidades da pagina de zonas por UF, do indice das malhas de zona."""
    try:
        cidades = json.loads(ZONAS_INDICE.read_text(encoding="utf-8")).get("cidades", [])
    except (OSError, ValueError):
        return {}
    por_uf: dict[str, list[dict]] = {}
    for c in cidades:
        por_uf.setdefault(c["uf"], []).append(c)
    return por_uf


ZONAS = cidades_com_zonas()


def escrever_zonas(casa: Casa, cab: dict, dic: dict, eleicao: str, cargo: str, uf: str,
                   final: bool, agora: time.struct_time, destino: Path) -> None:
    """{ele}-{cargo}-zonas-{ibge}.json, como coleta.camada_zonas o escreve: o
    municipio inteiro em `total` e cada zona em `abr`. Devolve os totais, para o
    historico das cidades."""
    totais = {}
    for cidade in ZONAS.get(uf, []):
        mun = str(cidade["tse"]).zfill(5)
        if mun not in casa.mun:
            continue
        acc = casa.mun[mun]
        total = entrada(casa, acc["votos"], acc["st"], casa.ts_mun[mun], casa.te_mun[mun],
                        acc["te"], final, True, agora)
        zonas = {z: entrada(casa, a["votos"], a["st"], casa.ts_zona[(m, z)], casa.te_zona[(m, z)],
                            a["te"], final, True, agora)
                 for (m, z), a in casa.zona.items() if m == mun}
        escrever(destino, f"{eleicao}-{cargo}-zonas-{cidade['ibge']}.json",
                 {"meta": cab, "total": total, "abr": dict(sorted(zonas.items())), "cand": dic,
                  "mun": {"cd": mun, "ibge": cidade["ibge"], "nm": cidade["nm"], "uf": uf}})
        totais[str(cidade["ibge"])] = total
    return totais


def escrever_acompanhamento(destino: Path, eleicao: str, turno: str, volta: int,
                            cargo: str, abr_uf: dict, por_uf: dict) -> None:
    """EA14 de ensaio: o estagio de cada UF e quantos dos seus municipios fecharam."""
    blocos_uf = {}
    for uf, e in abr_uf.items():
        casa = por_uf[uf]
        estagios = Counter()
        for mun, acc in casa.mun.items():
            ts = casa.ts_mun[mun]
            estagios["f" if acc["st"] >= ts else ("p" if acc["st"] else "n")] += 1
        blocos_uf[uf] = {"and": e["and"], "cd": uf, "tp": "uf", "dt": e["dt"], "ht": e["ht"],
                         "ufnr": 0, "ufpt": 0, "uff": 0,
                         "munr": estagios["n"], "mupt": estagios["p"], "muf": estagios["f"],
                         "ts": e["ts"], "st": e["st"], "pst": e["pst"], "snt": e["snt"],
                         "si": e["si"], "sni": 0, "sa": e["sa"], "sna": 0,
                         "te": e["te"], "est": e["est"], "esnt": e["esnt"], "esni": 0,
                         "esna": 0, "comp": e["comp"], "abst": e["abst"]}
    lista = list(blocos_uf.values())
    br = {**lista[0], "cd": "br", "tp": "br"}
    for campo in ("munr", "mupt", "muf", "ts", "st", "snt", "si", "sa", "te", "est", "esnt",
                  "comp", "abst"):
        br[campo] = sum(b[campo] for b in lista)
    br["pst"] = round(100 * br["st"] / br["ts"], 2) if br["ts"] else 0.0
    br["uff"] = sum(1 for b in lista if b["and"] == "f")
    br["ufpt"] = sum(1 for b in lista if b["and"] == "p")
    br["ufnr"] = sum(1 for b in lista if b["and"] == "n")
    br["and"] = "f" if br["uff"] == len(lista) else ("p" if br["uff"] or br["ufpt"] else "n")
    escrever(destino, f"{eleicao}-ab.json", {
        "meta": {"ele": eleicao, "t": turno, "f": "s", "idg": str(volta),
                 "gerado": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
        "br": br, "uf": blocos_uf})


# ---------------------------------------------------------------------- main

def nomes_dos_municipios() -> dict[str, dict]:
    """Codigo TSE (5 digitos) -> nome e IBGE, da ponte e das malhas do site."""
    ponte = json.loads(PONTE.read_text(encoding="utf-8"))
    nome_ibge = {}
    for caminho in (GEO / "municipios_svg").glob("municipios_*.json"):
        for cd, nm, *_ in json.loads(caminho.read_text(encoding="utf-8"))["p"]:
            nome_ibge[cd] = nm
    return {tse.zfill(5): {"nm": nome_ibge.get(ibge, tse), "ibge": ibge}
            for tse, ibge in ponte.items()}


def vagas_oficiais(cargo: str, uf: str) -> int:
    if cargo not in PROPORCIONAIS:
        return 1
    totais = json.loads((LEG / "official_totals_2022.json").read_text(encoding="utf-8"))
    chave = "f" if cargo == "0006" else "e"
    return int(((totais.get(uf.upper()) or {}).get(chave) or {}).get("stats", {})
               .get("qt_vagas") or 0)


def projetar(destino: Path, turno: str) -> str:
    try:
        import projecao
    except ImportError as err:
        return f"sem projecao ({err})"
    eleicao = "544" if turno == "1" else "545"
    try:
        r = projecao.rodada(destino, eleicao, "0001", projecao.carregar_base(projecao.BASE_PADRAO))
        return f"projecao {'ok' if r.get('suficiente') else 'ainda insuficiente'}"
    except Exception as err:  # noqa: BLE001 — o ensaio vale mais que a projecao
        return f"projecao falhou ({type(err).__name__}: {err})"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--turno", choices=["1", "2"], default="1")
    ap.add_argument("--tocar", action="store_true", help="reproduz a noite do 0 ao 100%%")
    ap.add_argument("--instante", type=float, default=None,
                    help="escreve um quadro so, na fracao pedida (0 a 1), e sai")
    ap.add_argument("--duracao", type=float, default=10, help="minutos de ensaio")
    ap.add_argument("--passo", type=float, default=8, help="segundos entre quadros")
    ap.add_argument("--cargos", default="", help="so estes (padrao: todos do turno)")
    ap.add_argument("--ufs", nargs="*", default=[], help="so estas UFs (padrao: todas)")
    ap.add_argument("--semente", type=int, default=2022)
    ap.add_argument("--sorteio", action="store_true",
                    help="ignora a sequencia real de 2022 e sorteia a ordem de chegada")
    ap.add_argument("--sem-projecao", action="store_true")
    ap.add_argument("--destino", type=Path, default=None)
    args = ap.parse_args()
    if not args.tocar and args.instante is None:
        ap.error("escolha --tocar ou --instante")

    turno = args.turno
    destino = args.destino or RAIZ / "scratch" / "apuracao" / f"ensaio2022-t{turno}"
    pedidos = {c.strip() for c in args.cargos.split(",") if c.strip()}
    plano = {e: [c for c in cs if not pedidos or c in pedidos]
             for e, cs in ELEICOES[turno].items()}
    plano = {e: cs for e, cs in plano.items() if cs}
    ufs = [u.lower() for u in args.ufs]

    inicio = time.monotonic()
    nomes_mun = nomes_dos_municipios()
    sequencia = None if args.sorteio else carregar_sequencia(turno)
    if sequencia:
        print(f"  sequencia real de 2022: {len(sequencia[0]):,} locais, fim da noite "
              f"{17 + int(sequencia[1] // 60)}h{int(sequencia[1] % 60):02d}".replace(",", "."), flush=True)
    else:
        print("  sem a sequencia real (scripts/apuracao/sequencia_2022.py): ordem sorteada",
              flush=True)
    # Tamanho de cada municipio pelo voto presidencial do turno: e o que
    # decide quem chega cedo, e vale igual para todos os cargos.
    tamanho: dict[str, dict[str, int]] = {}
    for uf in ufs_do_cargo("0001", turno, ufs):
        dados = ler("0001", uf, turno)
        tam: Counter = Counter()
        for chave, votos in (dados or {}).get("RESULTS", {}).items():
            partes = chave.split("_")
            if len(partes) >= 3:
                tam[partes[1].zfill(5)] += sum(int(v) for v in votos.values())
        tamanho[uf] = dict(tam)

    casas: dict[str, dict[str, Casa]] = {}
    for cargos in plano.values():
        for cargo in cargos:
            casas[cargo] = {}
            for uf in ufs_do_cargo(cargo, turno, ufs):
                dados = ler(cargo, uf, turno)
                if not dados:
                    continue
                casas[cargo][uf] = Casa(cargo, uf, dados, tamanho.get(uf, {}),
                                        args.semente, vagas_oficiais(cargo, uf), sequencia)
            dentro = sum(c.na_sequencia for c in casas[cargo].values())
            fora = sum(c.fora_da_sequencia for c in casas[cargo].values())
            print(f"  {cargo} {NOME_CARGO[cargo]:18s} {len(casas[cargo]):2d} UFs"
                  + (f" | {dentro:,} locais na hora real, {fora:,} sorteados".replace(",", ".")
                     if sequencia else ""), flush=True)
    print(f"  acervo lido em {time.monotonic() - inicio:.0f}s", flush=True)

    indice_cargos = {c: e for e, cs in plano.items() for c in cs if casas.get(c)}
    escrever(destino, "indice.json", {
        "base": "ensaio", "ambiente": f"ensaio-2022-t{turno}", "fase": "s",
        "cargos": indice_cargos,
        "eleicoes": {e: {"t": turno, "tp": 8 if "0001" in cs else 1,
                         "t2": {"544": "545", "546": "547"}.get(e, "") if turno == "1" else "",
                         "nm": f"Ensaio 2022 — {turno}º turno", "cargos": cs}
                     for e, cs in plano.items()},
        "gerado": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })

    def quadro(t: float, volta: int) -> None:
        relogio = None
        if sequencia:
            from datetime import datetime, timedelta
            relogio = (datetime.fromisoformat(sequencia[2])
                       + timedelta(minutes=t * sequencia[1])).timetuple()
        resumo = escrever_quadro(casas, plano, turno, t, volta, destino, nomes_mun, relogio)
        proj = "" if args.sem_projecao or "0001" not in casas else " | " + projetar(destino, turno)
        andamento = " ".join(f"{k.split('-')[1]}={v:.1f}%" for k, v in resumo.items())
        hora = ""
        if sequencia:
            m = t * sequencia[1]
            hora = f" | {17 + int(m // 60):02d}h{int(m % 60):02d} de 2022"
        print(f"  t={t * 100:5.1f}%{hora} | {andamento}{proj}", flush=True)

    if args.instante is not None:
        quadro(max(0.0, min(1.0, args.instante)), 1)
        print(f"-> {destino}")
        return 0

    partida = time.monotonic()
    volta = 0
    while True:
        volta += 1
        t = min(1.0, (time.monotonic() - partida) / max(args.duracao * 60, 1e-6))
        quadro(t, volta)
        if t >= 1.0:
            break
        time.sleep(args.passo)
    print(f"ensaio concluido -> {destino}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
