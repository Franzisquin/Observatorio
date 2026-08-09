"""Trava a identidade do local de votacao contra os casos reais que motivaram ela.

Roda sobre resultados_geo/identidade_historico.csv.gz ja gerado:
    python scripts/gerar_identidade_historico.py
    python scripts/test_identidade_historico.py

Os tres casos sao vizinhos em Manaus, zona 40 e zona 63/31, e cobrem os dois modos
de falha de uma vez -- por isso valem mais que qualquer numero agregado:

  1. Candido Honorio  o TSE trocou o numero do local (1252 -> 1775) com 8 anos de
                      lacuna no meio. Tem de ser UMA identidade.
  2. CMEI Graziela    o slot 1775 era dele ate 2020. NAO pode levar junto o 2022,
     Ribeiro          que ja e o predio vizinho (371 x 371-A).
  3. E.M. Graziela    mudou de zona E de local (63/1279 -> 31/2119) sem lacuna. Tem
     Ribeiro          de ser uma identidade so, e separada do CMEI homonimo.
"""

import csv
import gzip
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from historico_texto import normalize_history_text

CSV_V15 = "version_15_geocode/geocoded_polling_stations.csv"
IDENT = "resultados_geo/identidade_historico.csv.gz"


def carregar():
    csv.field_size_limit(10 ** 9)
    with gzip.open(IDENT, "rt", encoding="utf-8", newline="") as f:
        hist = {int(r["local_id"]): int(r["hist_id"]) for r in csv.DictReader(f)}
    reg = {}
    with open(CSV_V15, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            lid = int(r["local_id"])
            if lid in hist:
                reg[lid] = r
    return hist, reg


def anos_de(hist, reg, uf, zona, local, ano=None):
    """Todos os anos da identidade a que pertence aquele (uf, zona, local[, ano])."""
    alvo = [l for l, r in reg.items()
            if r["sg_uf"] == uf and r["nr_zona"] == zona and r["nr_locvot"] == local
            and (ano is None or r["ano"] == ano)]
    assert alvo, f"nenhum local para {uf} z{zona} l{local} {ano or ''}"
    ids = {hist[l] for l in alvo}
    assert len(ids) == 1, f"{uf} z{zona} l{local} {ano or ''} caiu em {len(ids)} identidades"
    hid = ids.pop()
    return hid, sorted(int(r["ano"]) for l, r in reg.items() if hist[l] == hid)


def main():
    if not os.path.exists(IDENT):
        raise SystemExit(f"{IDENT} nao existe -- rode gerar_identidade_historico.py antes.")
    hist, reg = carregar()

    # 1) Candido Honorio: 1252 (2006-2012) e 1775 (2022-2024) sao o MESMO predio.
    id_ch, anos_ch = anos_de(hist, reg, "AM", "40", "1252")
    assert anos_ch == [2006, 2008, 2010, 2012, 2022, 2024], anos_ch
    id_2022, _ = anos_de(hist, reg, "AM", "40", "1775", "2022")
    assert id_2022 == id_ch, "o Candido Honorio de 2022 ficou fora da propria serie"
    print(f"  ok  Candido Honorio ..... 1 identidade, anos {anos_ch}")

    # 2) CMEI Graziela Ribeiro: dono do slot 1775 ate 2020, sem herdar o 2022 alheio.
    id_cmei, anos_cmei = anos_de(hist, reg, "AM", "40", "1775", "2020")
    assert id_cmei != id_ch, "CMEI e Candido Honorio ficaram na mesma identidade"
    assert anos_cmei == [2006, 2008, 2010, 2012, 2014, 2016, 2018, 2020], anos_cmei
    assert 2022 not in anos_cmei and 2024 not in anos_cmei
    print(f"  ok  CMEI Graziela ....... 1 identidade, anos {anos_cmei}, sem o 2022 do vizinho")

    # 3) E.M. Graziela Ribeiro: mudou de zona e de local, 10 anos continuos.
    id_emg, anos_emg = anos_de(hist, reg, "AM", "63", "1279")
    assert anos_emg == [2006, 2008, 2010, 2012, 2014, 2016, 2018, 2020, 2022, 2024], anos_emg
    id_nova, _ = anos_de(hist, reg, "AM", "31", "2119", "2016")
    assert id_nova == id_emg, "a mudanca de zona 63->31 partiu a serie"
    assert id_emg != id_cmei, "as duas Graziela Ribeiro viraram a mesma identidade"
    print(f"  ok  E.M. Graziela ....... 1 identidade, anos {anos_emg}, zona 63->31")

    # ---- invariantes globais
    por_id = {}
    for lid, hid in hist.items():
        por_id.setdefault(hid, []).append(lid)
    repetidos = [h for h, mem in por_id.items()
                 if len({reg[l]["ano"] for l in mem}) != len(mem)]
    assert not repetidos, f"{len(repetidos)} identidades com dois locais no mesmo ano"

    # O renome tem de estar DENTRO da identidade, nao virar identidade nova: pelo
    # menos o caso de Manaus tem de mostrar grafias diferentes sob o mesmo hist_id.
    grafias = {reg[l]["nm_locvot"] for l in por_id[id_ch]}
    assert len(grafias) > 1, "o Candido Honorio deveria ter mais de uma grafia junta"
    normalizadas = {normalize_history_text(g) for g in grafias}
    assert len(normalizadas) == 1, normalizadas

    print(f"\n  {len(hist)} locais em {len(por_id)} identidades, nenhuma com dois "
          f"locais no mesmo ano")
    print("  ok")


if __name__ == "__main__":
    sys.exit(main())
