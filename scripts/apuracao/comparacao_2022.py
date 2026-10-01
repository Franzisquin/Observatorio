"""Base da comparacao 2022 -> 2026 da pagina presidencial (js/apuracao-nacional.js).

O 1o turno presidencial de 2022, do acervo local, por municipio, por UF e no
Brasil: votos validos e os votos dos dois numeros que a pagina compara (13, Lula;
22, Jair Bolsonaro — em 2026, Lula e Flavio Bolsonaro tem os mesmos numeros). Vai
junto o ponto de onde sai a seta de cada municipio e de cada UF no mapa: um ponto
DENTRO do territorio (shapely.point_on_surface), e nao o centroide, que num
municipio em forma de lua cai fora dele.

    py scripts/apuracao/comparacao_2022.py

Saida, resultados_geo/comparacao/presidente_2022_t1.json:

    {"eleicao", "numeros": ["13", "22"],
     "br": [vv, v13, v22],
     "uf":  {"sp": [vv, v13, v22, lon, lat], ..., "zz": [vv, v13, v22]},
     "mun": {"<IBGE>": [vv, v13, v22, lon, lat], ...}}
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

import shapely
from shapely.geometry import shape

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ensaio_2022 import GEO, PONTE, UFS, ler  # noqa: E402

NUMEROS = ("13", "22")
SAIDA = GEO / "comparacao" / "presidente_2022_t1.json"


def ponto(geom) -> list[float]:
    p = shapely.point_on_surface(geom)
    return [round(p.x, 3), round(p.y, 3)]


def main() -> int:
    ponte = {k.zfill(5): str(v) for k, v in json.loads(PONTE.read_text(encoding="utf-8")).items()}
    br = Counter()
    uf_saida, mun_saida = {}, {}
    for uf in UFS + ["zz"]:
        dados = ler("0001", uf, "1")
        por_mun: dict[str, Counter] = {}
        for chave, votos in dados["RESULTS"].items():
            partes = chave.split("_")
            mun = partes[1].zfill(5) if len(partes) >= 3 else "exterior"
            alvo = por_mun.setdefault(mun, Counter())
            for numero, v in votos.items():
                if numero not in ("95", "96"):          # branco e nulo nao sao validos
                    alvo["vv"] += int(v)
                    if numero in NUMEROS:
                        alvo[numero] += int(v)
        total = sum(por_mun.values(), Counter())
        br.update(total)
        linha = lambda c: [c["vv"], c[NUMEROS[0]], c[NUMEROS[1]]]  # noqa: E731
        uf_saida[uf] = linha(total)
        if uf == "zz":
            continue

        geo = json.loads((GEO / "municipios" / f"municipios_{uf.upper()}.geojson")
                         .read_text(encoding="utf-8"))
        formas = {f["properties"]["CD_MUN"]: shape(f["geometry"]) for f in geo["features"]}
        uf_saida[uf] += ponto(shapely.union_all(list(formas.values())))
        sem_forma = 0
        for tse, c in por_mun.items():
            ibge = ponte.get(tse)
            if not ibge or ibge not in formas:
                sem_forma += 1
                continue
            mun_saida[ibge] = linha(c) + ponto(formas[ibge])
        if sem_forma:
            print(f"  ! {uf}: {sem_forma} municipio(s) do TSE sem malha", file=sys.stderr)

    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    SAIDA.write_text(json.dumps({
        "eleicao": "2022, 1o turno", "numeros": list(NUMEROS),
        "br": [br["vv"], br[NUMEROS[0]], br[NUMEROS[1]]],
        "uf": uf_saida, "mun": mun_saida,
    }, separators=(",", ":")), encoding="utf-8")

    pct = lambda n: 100 * br[n] / br["vv"]  # noqa: E731
    print(f"Brasil: Lula {pct('13'):.2f}%, Bolsonaro {pct('22'):.2f}% dos validos; "
          f"{len(mun_saida)} municipios -> {SAIDA} ({SAIDA.stat().st_size // 1024} KB)")
    # O resultado oficial de 2022 (1o turno): 48,43% e 43,20%.
    assert round(pct("13"), 2) == 48.43 and round(pct("22"), 2) == 43.20, "nao bate com o TSE"
    return 0


if __name__ == "__main__":
    sys.exit(main())
