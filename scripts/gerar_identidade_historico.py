"""Calcula a identidade estavel de cada local de votacao (hist_id).

POR QUE ISTO EXISTE
-------------------
O painel "Historico" do site adivinha, em tempo de execucao, se o local clicado e o
mesmo predio de eleicoes anteriores. Ele tenta uma escada de aliases exatos em que
zona+local vale 0,8 e o nome vale 0,6 -- entao quando o TSE REUSA um numero de local
para outro predio, o numero ganha do nome e o historico mostra a escola errada.

Caso real (Manaus, zona 40):
    2006-2012  local 1252  ESCOLA MUNICIPAL CANDIDO HONORIO   Rua 5, 371-A
    2016-2020  local 1775  CMEI GRAZIELA RIBEIRO              Rua Abilio Alencar, 371
    2022-2024  local 1775  E.M.CANDIDO HONORIO                Rua Abilio Alencar, 371-A
Sao dois predios vizinhos. Em 2022 o TSE passou o slot 1775 do CMEI para o Candido
Honorio, e o site passou a mostrar o resultado de 2018 do CMEI dentro do historico do
Candido Honorio -- e a serie 2006-2012 do Candido Honorio virou um historico separado.

Escala nacional: 10,2% das escolas ocuparam mais de um slot ao longo do tempo (o
historico racha) e 34,8% dos slots hospedaram mais de um nome (o historico contamina).

O QUE ESTE SCRIPT FAZ
---------------------
Troca o palpite em tempo de execucao por um numero calculado uma vez, offline, com
todos os sinais disponiveis, e gravado nos dois lados do join. Parte do panel_id da
v0.15 (record linkage Fellegi-Sunter sobre nome e endereco, bem melhor que a escada
de aliases) e corrige as duas fraquezas dele:

  1. QUEBRA  o painel onde a identidade muda de fato entre anos consecutivos.
             O painel casa por nome E endereco; quando o predio muda mas o endereco
             quase nao (371 -> 371-A), ele segue o slot e cola escolas diferentes.
  2. REFUNDE pedacos da mesma escola separados por lacuna. O painel so casa anos
             CONSECUTIVOS, entao nao atravessa o sumico do Candido Honorio de 2014 a
             2020 -- por construcao, nunca ligaria 2012 a 2022.
  3. APLICA  scripts/historico_excecoes.csv por ultimo, sempre vencendo. Nenhum
             limiar acerta a cauda longa; caso encontrado no site vira uma linha la
             e fica resolvido, sem remexer nos limiares e reprocessar tudo.

Saida: resultados_geo/identidade_historico.csv.gz (local_id, hist_id).

Rodar da raiz do repo:  python scripts/gerar_identidade_historico.py
"""

import collections
import csv
import difflib
import gzip
import os
import sys
from math import cos, hypot, radians

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from historico_texto import get_history_name_core_tokens, normalize_history_text

CSV_V15 = "version_15_geocode/geocoded_polling_stations.csv"
PANEL_V15 = "version_15_geocode/panel_ids.csv"
EXCECOES = "scripts/historico_excecoes.csv"
SAIDA = "resultados_geo/identidade_historico.csv.gz"

# Um nome so "muda de verdade" abaixo disto E sem token-nucleo em comum. 0,75 mantem
# junto COLEGIO MUNICIPAL DE EDUCACAO INFANTIL GRAZIELA RIBEIRO -> CMEI GRAZIELA
# RIBEIRO (que compartilham o nucleo) e separa CMEI GRAZIELA RIBEIRO -> E.M.CANDIDO
# HONORIO (que nao compartilham nada).
SIM_MIN = 0.75

# Refusao por lacuna so dentro deste raio. Existe para nao colar escolas homonimas de
# bairros diferentes da mesma cidade -- caso comum ("E.M. SAO JOSE").
RAIO_REFUSAO_M = 1000.0

# ponytail: a refusao compara os fragmentos de um grupo aos pares (O(n^2)). Grupos
# grandes sao nomes genericos onde a fusao seria chute; pular e mais correto e mais
# barato. Se algum dia precisar casar dentro deles, indexe por celula de grade.
MAX_FRAG_POR_GRUPO = 60


def dist_m(a, b):
    if a["lon"] is None or b["lon"] is None:
        return None
    return hypot((b["lon"] - a["lon"]) * 111320 * cos(radians(a["lat"])),
                 (b["lat"] - a["lat"]) * 110540)


def mesma_identidade(a, b):
    """Dois registros de anos consecutivos sao o mesmo estabelecimento?"""
    if difflib.SequenceMatcher(None, a["nome"], b["nome"]).ratio() >= SIM_MIN:
        return True
    comum = a["core"] & b["core"]
    # Nucleo em comum vale quando cobre o nucleo inteiro do lado mais curto: "CMEI
    # GRAZIELA RIBEIRO" dentro de "COLEGIO ... GRAZIELA RIBEIRO" passa; um unico
    # sobrenome solto entre nomes longos e diferentes nao.
    return bool(comum) and len(comum) >= min(2, len(a["core"]), len(b["core"]))


class UnionFind:
    def __init__(self, n):
        self.pai = list(range(n))

    def find(self, x):
        while self.pai[x] != x:
            self.pai[x] = self.pai[self.pai[x]]
            x = self.pai[x]
        return x

    def une(self, a, b):
        a, b = self.find(a), self.find(b)
        if a == b:
            return False
        self.pai[b] = a
        return True


def ler_v15():
    csv.field_size_limit(10 ** 9)
    reg = {}
    ilegiveis = 0
    print(f"lendo {CSV_V15} ...")
    with open(CSV_V15, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            try:
                lid, ano = int(r["local_id"]), int(r["ano"])
                zona, local = int(r["nr_zona"]), int(r["nr_locvot"])
            except (TypeError, ValueError):
                # Sem zona nao da para identificar nem casar com resultado. O release
                # 0.15 tem exatamente uma dessas (local_id 218275, PE 2010, sem zona
                # e sem nome). Contar em vez de sumir calado.
                ilegiveis += 1
                continue
            reg[lid] = {
                "ano": ano, "uf": r["sg_uf"].upper(), "zona": zona, "local": local,
                "muni": normalize_history_text(r["nm_localidade"]),
                "nome": normalize_history_text(r["nm_locvot"]),
                "core": frozenset(get_history_name_core_tokens(r["nm_locvot"])),
                "lon": float(r["long"]) if r["long"] else None,
                "lat": float(r["lat"]) if r["lat"] else None,
                "cru": r["nm_locvot"],
            }
    if ilegiveis:
        print(f"  {ilegiveis} linha(s) sem zona/local legivel, descartada(s)")
    return reg


def ler_paineis(reg):
    print(f"lendo {PANEL_V15} ...")
    pan = collections.defaultdict(list)
    with open(PANEL_V15, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            lid = int(r["local_id"])
            if lid in reg:
                pan[int(r["panel_id"])].append(lid)
    # Local que a v0.15 tem mas o painel nao menciona vira painel de um membro so,
    # senao sumiria da saida.
    vistos = {lid for mem in pan.values() for lid in mem}
    for lid in reg:
        if lid not in vistos:
            pan[("solto", lid)] = [lid]
    return pan


def quebrar(pan, reg):
    """Fatia cada painel onde o estabelecimento muda entre anos consecutivos."""
    frag, quebras = [], 0
    for mem in pan.values():
        mem.sort(key=lambda m: reg[m]["ano"])
        atual = [mem[0]]
        for anterior, seguinte in zip(mem, mem[1:]):
            if mesma_identidade(reg[anterior], reg[seguinte]):
                atual.append(seguinte)
            else:
                frag.append(atual)
                atual = [seguinte]
                quebras += 1
        frag.append(atual)
    return frag, quebras


def refundir(frag, reg):
    """Une fragmentos da mesma escola separados no tempo (lacuna no cadastro)."""
    uf = UnionFind(len(frag))
    anos = [{reg[m]["ano"] for m in fr} for fr in frag]

    grupos = collections.defaultdict(list)
    for i, fr in enumerate(frag):
        r = reg[fr[-1]]
        grupos[(r["uf"], r["muni"], r["nome"])].append(i)
        if r["core"]:
            grupos[(r["uf"], r["muni"], r["core"])].append(i)

    fusoes = 0
    for idxs in grupos.values():
        if len(idxs) < 2 or len(idxs) > MAX_FRAG_POR_GRUPO:
            continue
        for pos_i in range(len(idxs)):
            for pos_j in range(pos_i + 1, len(idxs)):
                a, b = uf.find(idxs[pos_i]), uf.find(idxs[pos_j])
                if a == b:
                    continue
                # Sobreposicao de ano = predios distintos coexistindo. Testar nas
                # raizes (nao nos fragmentos) mantem o invariante depois de uma
                # cadeia A-B-C de fusoes.
                if anos[a] & anos[b]:
                    continue
                d = dist_m(reg[frag[idxs[pos_i]][-1]], reg[frag[idxs[pos_j]][-1]])
                if d is None or d >= RAIO_REFUSAO_M:
                    continue
                uf.une(a, b)
                anos[uf.find(a)] = anos[a] | anos[b]
                fusoes += 1
    return uf, fusoes


def aplicar_excecoes(ident_de, reg, por_slot):
    """Sobrescreve o algoritmo, mexendo direto no mapa local_id -> identidade.

    Roda DEPOIS da refusao, de proposito: separar antes seria desfeito na hora,
    porque os pedacos separados tem o mesmo nome, anos sem sobreposicao e ficam
    perto -- exatamente o gatilho da refusao.

    SEPARAR primeiro, JUNTAR depois, para dar para desgrudar e remontar na mesma
    passada. Linha que nao casa com nenhum local e erro, nao silencio: excecao que
    para de valer (porque o cadastro mudou) tem de aparecer, nao sumir.
    """
    if not os.path.exists(EXCECOES):
        return 0, 0

    def alvos(linha):
        chave = (linha["uf"].strip().upper(), int(linha["zona"]), int(linha["local"]))
        lids = por_slot.get(chave, [])
        ano = (linha.get("ano") or "").strip()
        if ano:
            lids = [l for l in lids if reg[l]["ano"] == int(ano)]
        return lids

    with open(EXCECOES, encoding="utf-8", newline="") as f:
        linhas = [l for l in csv.DictReader(f)
                  if l.get("acao", "").strip()
                  and not l["acao"].lstrip().startswith("#")]

    proxima = max(ident_de.values(), default=0) + 1
    separados = juntados = 0

    for l in linhas:
        if l["acao"].strip().upper() != "SEPARAR":
            continue
        lids = alvos(l)
        if not lids:
            raise SystemExit(f"{EXCECOES}: nenhuma linha casa com {l}")
        # Os alvos saem juntos para uma identidade nova, sozinhos.
        for lid in lids:
            ident_de[lid] = proxima
        proxima += 1
        separados += len(lids)

    por_grupo = collections.defaultdict(list)
    for l in linhas:
        if l["acao"].strip().upper() == "JUNTAR":
            por_grupo[(l.get("grupo") or "").strip()].append(l)

    for grupo, linhas_do_grupo in por_grupo.items():
        if not grupo:
            raise SystemExit(f"{EXCECOES}: JUNTAR exige a coluna 'grupo' -- {linhas_do_grupo[0]}")
        chaves = set()
        for l in linhas_do_grupo:
            lids = alvos(l)
            if not lids:
                raise SystemExit(f"{EXCECOES}: nenhuma linha casa com {l}")
            chaves.update(ident_de[lid] for lid in lids)
        if len(chaves) < 2:
            continue
        # Absorve as identidades inteiras, nao so os locais citados: se o usuario diz
        # que dois predios sao o mesmo, tudo que ja estava com cada um vem junto.
        destino = min(chaves)
        for lid, k in ident_de.items():
            if k in chaves:
                ident_de[lid] = destino
        juntados += len(chaves) - 1
    return separados, juntados


def main():
    if not os.path.exists(CSV_V15):
        raise SystemExit(f"{CSV_V15} nao encontrado -- rode da raiz do repositorio.")

    reg = ler_v15()
    pan = ler_paineis(reg)
    por_slot = collections.defaultdict(list)
    for lid, r in reg.items():
        por_slot[(r["uf"], r["zona"], r["local"])].append(lid)

    frag, quebras = quebrar(pan, reg)
    uf_ds, fusoes = refundir(frag, reg)

    ident_de = {}
    for i, fr in enumerate(frag):
        raiz = uf_ds.find(i)
        for lid in fr:
            ident_de[lid] = raiz
    separados, juntados = aplicar_excecoes(ident_de, reg, por_slot)

    ident = collections.defaultdict(list)
    for lid, k in ident_de.items():
        ident[k].append(lid)

    # ---- invariantes
    assert set(ident_de) == set(reg), \
        f"faltaram {len(set(reg) - set(ident_de))} locais na saida"
    colisoes = [k for k, mem in ident.items()
                if len({reg[m]["ano"] for m in mem}) != len(mem)]
    if colisoes:
        # So pode vir de JUNTAR forcado: o algoritmo sozinho nunca junta dois locais
        # do mesmo ano (o painel e 1-para-1 e a refusao exige anos disjuntos).
        print(f"  AVISO: {len(colisoes)} identidades com dois locais no mesmo ano "
              f"(vindas de {EXCECOES})")

    hist_de = {}
    for novo, k in enumerate(sorted(ident), start=1):
        for lid in ident[k]:
            hist_de[lid] = novo

    os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
    with gzip.open(SAIDA, "wt", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["local_id", "hist_id"])
        for lid in sorted(hist_de):
            w.writerow([lid, hist_de[lid]])

    span = collections.Counter(len({reg[m]["ano"] for m in v}) for v in ident.values())
    disperso = 0
    for mem in ident.values():
        mx = 0.0
        for i in range(len(mem)):
            for j in range(i + 1, len(mem)):
                d = dist_m(reg[mem[i]], reg[mem[j]])
                if d and d > mx:
                    mx = d
        if mx > 1000:
            disperso += 1

    print()
    print(f"  paineis v0.15 ............ {len(pan)}")
    print(f"  quebras (slot reusado) ... {quebras}")
    print(f"  fusoes por lacuna ........ {fusoes}")
    print(f"  excecoes: SEPARAR {separados}, JUNTAR {juntados}")
    print(f"  identidades finais ....... {len(ident)}")
    print(f"  dispersas >1km ........... {disperso} ({100.0*disperso/len(ident):.1f}%)")
    print("  anos por identidade: " + ", ".join(
        f"{k}a={span[k]}" for k in range(1, 11) if span[k]))
    print(f"\n  -> {SAIDA} ({len(hist_de)} locais)")


if __name__ == "__main__":
    sys.exit(main())
