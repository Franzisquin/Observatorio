"""Confere coleta.historico, o arquivo da curva da apuracao, com entradas no
formato que coleta.resumo tira do EA20 do TSE. Sem rede.

    python scripts/apuracao/testar_historico.py
"""

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from coleta import historico  # noqa: E402


def entrada(st, pst, hora, a, b):
    return {"st": st, "pst": pst, "vvc": a + b, "dt": "04/10/2026", "ht": hora,
            "cand": {"1": a, "2": b}}


with tempfile.TemporaryDirectory() as pasta:
    destino = Path(pasta)

    def serie(abr="br"):
        return json.loads((destino / f"6257-0001-hist-{abr}.json").read_text(encoding="utf-8"))

    # Antes das 17h: st = 0, ou divulgacao bloqueada (votos zerados).
    assert not historico(destino, "6257", "0001", {"br": entrada(0, 0, "", 0, 0)})
    assert not historico(destino, "6257", "0001", {"zz": {"st": 40, "pst": 1, "vvc": 0}})
    assert not list(destino.iterdir())

    assert historico(destino, "6257", "0001", {"br": entrada(1000, 1.0, "17:10:00", 600, 400)})
    assert historico(destino, "6257", "0001", {"br": entrada(5000, 5.0, "17:20:00", 3000, 2000)})
    assert [p[1] for p in serie()] == [1000, 5000]
    assert serie()[-1][2] == "04/10/2026 17:20:00" and serie()[-1][3] == {"1": 60.0, "2": 40.0}

    # Copia atrasada da CDN: st menor, ignorada, e a serie fica inteira.
    assert not historico(destino, "6257", "0001", {"br": entrada(4000, 4.0, "17:15:00", 2400, 1600)})
    assert [p[1] for p in serie()] == [1000, 5000]

    # A mesma totalizacao lida de novo: nada muda.
    assert not historico(destino, "6257", "0001", {"br": entrada(5000, 5.0, "17:20:00", 3000, 2000)})

    # Mesmo st, numeros revistos: o ultimo ponto e substituido.
    assert historico(destino, "6257", "0001", {"br": entrada(5000, 5.0, "17:21:00", 2900, 2100)})
    assert [p[1] for p in serie()] == [1000, 5000] and serie()[-1][3] == {"1": 58.0, "2": 42.0}

    # Cada UF tem a sua serie, no seu arquivo.
    assert historico(destino, "6257", "0001", {"sp": entrada(300, 0.3, "17:21:00", 10, 20)})
    assert len(serie("sp")) == 1 and len(serie("br")) == 2

    # Queda para menos da metade: outra apuracao, a serie recomeca.
    assert historico(destino, "6257", "0001", {"br": entrada(100, 0.1, "09:00:00", 1, 1)})
    assert [p[1] for p in serie()] == [100]

    # Proporcional nao tem curva.
    assert not historico(destino, "6259", "0006", {"sp": entrada(10, 1.0, "17:10:00", 1, 1)})
    assert sorted(p.name for p in destino.iterdir()) == ["6257-0001-hist-br.json",
                                                         "6257-0001-hist-sp.json"]

print("historico: tudo certo")
