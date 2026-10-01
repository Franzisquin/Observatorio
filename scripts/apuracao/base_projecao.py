# -*- coding: utf-8 -*-
"""
Base da projecao (scripts/apuracao/projecao.py): como cada municipio votou na
eleicao anterior, em tres numeros.

  lean   logit da parte do PT entre os dois polos (PT e o candidato da direita)
  terc   logit do que nao foi para nenhum dos dois polos (a "terceira via")
  rho    votos validos por eleitor (so quando a fonte traz o eleitorado)

Chaveada pelo codigo TSE do municipio, o mesmo dos snapshots da apuracao, entao
casa direto com o que o coletor publica.

Duas fontes:
  snapshot  os snapshots municipais do proprio coletor (coleta.py) de uma
            eleicao ja encerrada. E a base de 2026: presidente 2022, 1o turno,
            coletado com  py scripts/apuracao/coleta.py --eleicao 544 --cargo 0001
  locais    os resultados por local de votacao do visualizador
            (resultados_geo/Majoritarias {ano}). Nao trazem eleitorado, entao sai
            sem `rho`. Serve a reencenacao de testar_projecao.py.

Uso:
  py scripts/apuracao/base_projecao.py
      gera scripts/apuracao/base_projecao_2022.json, a base do 1o turno de 2026

  py scripts/apuracao/base_projecao.py --pasta <snapshots do 1o turno de 2026> \\
      --eleicao 21270 --saida base_projecao_2026.json
      a base do 2o turno: o 1o turno da propria eleicao, que o plantao passa a
      usar sozinho quando o arquivo existe (plantao.projetar_rodada)
"""

from __future__ import annotations

import json
import math
import os
import sys
import zipfile
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent.parent
GEO = RAIZ / 'resultados_geo'

BRANCO_NULO = {'95', '96'}


def _logit(p: float) -> float:
    p = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p))


def resumir(pt: float, direita: float, validos: float, eleitorado: float | None) -> dict:
    """Os tres numeros de um municipio. Suavizado com meio voto: municipio
    minusculo com zero voto num polo nao vira infinito."""
    item = {
        'lean': round(_logit((pt + 0.5) / (pt + direita + 1)), 4),
        'terc': round(_logit((validos - pt - direita + 0.5) / (validos + 1)), 4),
    }
    if eleitorado:
        item['rho'] = round(validos / eleitorado, 4)
    return item


def de_snapshot(pasta: Path, eleicao: str, cargo: str = '0001',
                polos: tuple[str, str] = ('13', '22')) -> dict:
    """Base a partir dos snapshots municipais do coletor. `polos` sao os numeros
    de urna do PT e do candidato da direita naquela eleicao."""
    base = {}
    for arq in sorted(pasta.glob(f'{eleicao}-{cargo}-*.json')):
        uf = arq.stem.rsplit('-', 1)[1]
        if len(uf) != 2 or uf in ('br', 'uf', 'ab'):
            continue
        d = json.loads(arq.read_text(encoding='utf-8'))
        numero = {sq: str(c.get('numero', '')) for sq, c in (d.get('cand') or {}).items()}
        for cd, e in (d.get('abr') or {}).items():
            votos = {}
            for sq, v in (e.get('cand') or {}).items():
                votos[numero.get(sq, sq)] = votos.get(numero.get(sq, sq), 0) + v
            validos = e.get('vvc') or e.get('vv') or sum(votos.values())
            if not validos:
                continue
            base[cd] = resumir(votos.get(polos[0], 0), votos.get(polos[1], 0), validos, e.get('te'))
    return base


def votos_por_local(ano: int, turno: int) -> dict:
    """{(uf, cd_muni_tse, chave_local): {numero: votos validos}} dos zips por local."""
    pasta = GEO / f'Majoritarias {ano}'
    saida = {}
    for nome in sorted(os.listdir(pasta)):
        if not (nome.startswith(f'presidente_{ano}_t{turno}_') and nome.endswith('.zip')):
            continue
        uf = nome[-6:-4].lower()
        with zipfile.ZipFile(pasta / nome) as z:
            arq = [n for n in z.namelist() if n.endswith('.json') and 'resumo' not in n][0]
            dados = json.loads(z.read(arq))
        for chave, votos in dados['RESULTS'].items():
            # "{zona}_{municipio TSE}_{local}"; o exterior vem por pais ("JOR").
            partes = chave.split('_')
            cd = partes[1] if len(partes) == 3 else chave
            saida[(uf, cd, chave)] = {k: v for k, v in votos.items() if k not in BRANCO_NULO}
    return saida


def de_locais(ano: int, turno: int, polos: tuple[str, str]) -> dict:
    """Base a partir dos resultados por local de votacao, somados por municipio."""
    muni = {}
    for (_, cd, _), votos in votos_por_local(ano, turno).items():
        acc = muni.setdefault(cd, {})
        for k, v in votos.items():
            acc[k] = acc.get(k, 0) + v
    return {cd: resumir(v.get(polos[0], 0), v.get(polos[1], 0), sum(v.values()), None)
            for cd, v in muni.items() if sum(v.values())}


def main() -> int:
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--pasta', type=Path, default=RAIZ / 'scratch' / 'apuracao' / '2022')
    ap.add_argument('--eleicao', default='544')
    ap.add_argument('--saida', default='base_projecao_2022.json')
    args = ap.parse_args()
    base = de_snapshot(args.pasta, args.eleicao)
    if len(base) < 5000:
        print(f'base com {len(base)} municipios: faltam snapshots municipais em {args.pasta}. '
              f'Rode: py scripts/apuracao/coleta.py --eleicao {args.eleicao} --cargo 0001 '
              f'--destino {args.pasta}', file=sys.stderr)
        return 1
    destino = AQUI / args.saida
    destino.write_text(json.dumps(base, separators=(',', ':')), encoding='utf-8')
    print(f'{len(base)} municipios -> {destino.name} ({destino.stat().st_size / 1024:.0f} KB)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
