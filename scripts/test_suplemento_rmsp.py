"""Confere o suplemento da RMSP gerado por scripts/gerar_suplemento_rmsp.py.

O casamento por assinatura de votos e forte, mas o passo de AGREGACAO (um ponto do
CEM = soma de 2 a 3 urnas do TSE) e o que poderia casar por acaso. Quem trava isso e
a reconferencia em governador, feita dentro do proprio gerador: a soma tem de bater
tambem numa eleicao que nao foi usada para casar.

A checagem geografica que existia aqui foi REBAIXADA a informativa, e a razao
importa: ela comparava as urnas irmas usando a posicao delas na malha de 2006 --
justamente a malha ruim que este suplemento existe para substituir. Ela acusava 20
"suspeitos" em 1998 que a reconferencia em governador confirmou estarem certos. O
numero que ela produz mede o erro da malha antiga, nao do casamento novo.

Fica entao:
  1. Cobertura: 2002 tem de sair de 2.008 para ~2.579 urnas com ponto.
  2. Sanidade: nenhum ponto fora da RMSP, chave bem formada, urna com um ponto so.
  3. Geografia dos grupos agregados: so impresso, como medida do desvio da malha 2006.

    python scripts/test_suplemento_rmsp.py
"""

import collections
import json
import os
import statistics
import sys
import zipfile
from math import cos, hypot, radians

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gerar_suplemento_rmsp import (CONJUNTOS, ENTRADA_JSON, ENVELOPE, SAIDA,
                                   chave_tripla, malha_2006, resultados,
                                   resultados_presidente)

# Urnas de um mesmo predio: aceito ate 300 m entre elas na malha de 2006 (o CEM
# funde anexos, que sao vizinhos). Acima disso, a soma provavelmente foi acaso.
LIMITE_AGREGACAO_M = 300.0


def metros(a, b):
    return hypot((b[0] - a[0]) * 111320 * cos(radians(a[1])),
                 (b[1] - a[1]) * 110540)


def main():
    if not os.path.exists(SAIDA):
        raise SystemExit(f"{SAIDA} nao existe -- rode gerar_suplemento_rmsp.py antes.")
    with zipfile.ZipFile(SAIDA) as z:
        sup = json.loads(z.read(ENTRADA_JSON).decode("utf-8"))
    malha, _ = malha_2006()
    falhas = []

    for ano in CONJUNTOS:
        reg = sup[str(ano)]["locais"]
        pontos = {}
        for k, v in reg.items():
            assert chave_tripla(k), f"{ano}: chave malformada {k}"
            lon, lat = v["long"], v["lat"]
            assert ENVELOPE[0] <= lon <= ENVELOPE[1] and ENVELOPE[2] <= lat <= ENVELOPE[3], \
                f"{ano}: {k} fora da RMSP"
            pontos.setdefault((lon, lat), []).append(k)

        # 1) geografia dos grupos agregados
        ruins, distancias, grupos = [], [], 0
        for (lon, lat), chaves in pontos.items():
            if len(chaves) < 2:
                continue
            grupos += 1
            conhecidas = [malha[k] for k in chaves if k in malha]
            for i in range(len(conhecidas)):
                for j in range(i + 1, len(conhecidas)):
                    d = metros(conhecidas[i][:2], conhecidas[j][:2])
                    distancias.append(d)
                    if d > LIMITE_AGREGACAO_M:
                        ruins.append((chaves, round(d)))

        # 2) cobertura
        rm = {chave_tripla(k)[1] for k in reg}
        alvo = [k for k in resultados_presidente(ano)
                if chave_tripla(k) and chave_tripla(k)[1] in rm]
        antes = sum(1 for k in alvo if k in malha)
        depois = len({k for k in alvo if k in malha or k in reg})

        med = statistics.median(distancias) if distancias else 0.0
        print(f"{ano}: {len(reg)} urnas com ponto do CEM | grupos agregados {grupos}")
        print(f"      cobertura da RMSP: {antes} -> {depois} de {len(alvo)}"
              f" ({100.0*antes/len(alvo):.1f}% -> {100.0*depois/len(alvo):.1f}%)")
        print(f"      [informativo] urnas irmas na malha 2006: mediana {med:.0f} m,"
              f" {len(ruins)} pares acima de {LIMITE_AGREGACAO_M:.0f} m"
              f" -- mede o desvio da malha antiga, nao do casamento")

        if depois < antes:
            falhas.append(f"{ano}: cobertura caiu de {antes} para {depois}")

    # 2002 e a razao de tudo isto existir
    reg2002 = sup["2002"]["locais"]
    novos = sum(1 for v in reg2002.values() if v.get("novo"))
    if novos < 500:
        falhas.append(f"2002: so {novos} urnas novas, esperado ~571")
    print(f"\n2002: {novos} urnas que antes nao tinham ponto nenhum")

    # ---- 1998: o total do municipio nao pode mudar
    #
    # A conta que o site faz e:  dots + sintetica = total do acervo.
    # Ao trazer as estacoes do CEM, elas entram como dots com voto do CEM e as
    # chaves de secao correspondentes saem do calculo do resto. Se as duas somas
    # nao forem identicas, o municipio passa a exibir um total errado -- e este e
    # o unico jeito de perceber antes de ir para a tela.
    estacoes = sup["1998"].get("estacoes", [])
    cobertas = set(sup["1998"].get("secoes_cobertas", []))
    print(f"\n1998: {len(estacoes)} estacoes do CEM cobrindo {len(cobertas)} chaves de secao")
    for cargo, turno in (("presidente", 1), ("governador", 1), ("governador", 2),
                         ("senador", 1)):
        try:
            arquivo = resultados(cargo, 1998, turno)
        except SystemExit:
            continue
        chave_turno = f"{turno}T"
        do_cem = collections.Counter()
        for e in estacoes:
            for num, n in (e["votos"].get(cargo, {}).get(chave_turno, {}) or {}).items():
                do_cem[num] += n
        das_secoes = collections.Counter()
        vistas = 0
        for chave in cobertas:
            v = arquivo.get(chave)
            if v is None:
                continue
            vistas += 1
            for num, n in v.items():
                das_secoes[num] += int(n)
        if not vistas:
            continue
        if dict(do_cem) == dict(das_secoes):
            print(f"      {cargo} {chave_turno}: soma bate exatamente "
                  f"({sum(das_secoes.values())} votos em {vistas} chaves)")
        else:
            falhas.append(f"1998 {cargo} {chave_turno}: soma das estacoes do CEM "
                          f"({sum(do_cem.values())}) difere das secoes "
                          f"({sum(das_secoes.values())})")

    if falhas:
        raise SystemExit("FALHAS:\n  " + "\n  ".join(falhas))
    print("  ok")


if __name__ == "__main__":
    sys.exit(main())
