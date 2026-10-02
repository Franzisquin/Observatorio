"""Senadores que NAO estao em disputa em 2026, com o partido de hoje.

2026 renova dois tercos do Senado (54 vagas). O terco restante sao os 27 eleitos
em 2022, com mandato ate 2031 — e e com eles que o semicirculo de 81 cadeiras da
pagina do Senado (apuracao-senado.html) enche o miolo, antes da primeira urna.

A fonte e o servico de dados abertos do proprio Senado: a lista de quem esta em
exercicio hoje, com a filiacao ATUAL (troca de partido conta) e o mandato.
Quem esta no lugar do eleito — o suplente em exercicio — vem no lugar dele, com
o mandato que herdou. Eleito em 2022 = mandato que comeca na 57a legislatura.

    python scripts/apuracao/senado_em_exercicio.py

Escreve resultados_geo/senado_em_exercicio.json. Rode de novo perto da eleicao:
filiacao e suplencia mudam.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent.parent
DESTINO = RAIZ / "resultados_geo" / "senado_em_exercicio.json"
FONTE = "https://legis.senado.leg.br/dadosabertos/senador/lista/atual"
LEGISLATURA_2022 = "57"


def baixar() -> dict:
    req = urllib.request.Request(FONTE, headers={
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compativel; observatorio-eleitoral/1.0)"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    dados = baixar()
    lista = dados["ListaParlamentarEmExercicio"]
    versao = (lista.get("Metadados") or {}).get("Versao", "")
    senadores = []
    for p in lista["Parlamentares"]["Parlamentar"]:
        mandato = p["Mandato"]
        if mandato["PrimeiraLegislaturaDoMandato"]["NumeroLegislatura"] != LEGISLATURA_2022:
            continue
        ident = p["IdentificacaoParlamentar"]
        senadores.append({
            "uf": mandato["UfParlamentar"].lower(),
            "nome": ident["NomeParlamentar"],
            "partido": ident.get("SiglaPartidoParlamentar") or "S/Partido",
            "participacao": mandato.get("DescricaoParticipacao", ""),
            "ate": mandato["SegundaLegislaturaDoMandato"]["DataFim"],
            "codigo": ident["CodigoParlamentar"],
        })
    senadores.sort(key=lambda s: s["uf"])

    # Um por UF, nem mais nem menos: se o servico mudar de forma, falha aqui
    # em vez de publicar um Senado com cadeira a mais ou a menos.
    ufs = [s["uf"] for s in senadores]
    if len(senadores) != 27 or len(set(ufs)) != 27:
        print(f"esperava 27 senadores eleitos em 2022, um por UF; vieram {len(senadores)} "
              f"em {len(set(ufs))} UFs", file=sys.stderr)
        return 1

    DESTINO.write_text(json.dumps({
        "fonte": FONTE, "versao": versao,
        "gerado": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "senadores": senadores,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    suplentes = [s for s in senadores if s["participacao"] != "Titular"]
    print(f"{len(senadores)} senadores (versao {versao}), {len(suplentes)} suplentes em "
          f"exercicio -> {DESTINO.relative_to(RAIZ)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
