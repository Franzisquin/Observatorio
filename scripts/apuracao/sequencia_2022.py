"""A sequencia real da apuracao de 2022: quando cada boletim de urna chegou.

O unico arquivo publico com a hora de chegada de cada secao e o boletim de urna
do TSE (bweb), no campo DT_BU_RECEBIDO. Daqui sai, por local de votacao, a hora
em que os boletins dele chegaram — e o ensaio (ensaio_2022.py) passa a tocar a
noite na ordem e no ritmo da noite de verdade, em vez de um sorteio.

Os boletins nao vao para o repositorio (1o turno: 1,46 GB em 28 zips; 2o: ~66
MB). Ficam em scratch/bweb/, e o resumo, pequeno, ao lado:

    py scripts/apuracao/sequencia_2022.py --baixar            (os dois turnos)
    py scripts/apuracao/sequencia_2022.py --resumir           (gera os resumos)
    py scripts/apuracao/sequencia_2022.py --curva --turno 1   (a curva presidencial)

Curva: resultados_geo/comparacao/presidente_2022_t1_curva.json — como o 1o turno
presidencial de 2022 estava a cada 0,5% das secoes apuradas, no Brasil e em
cada UF: votos validos e os dos numeros 13 e 22, acumulados na ordem em que os
boletins chegaram. E o que a pagina presidencial usa para comparar 2026 com
2022 "no mesmo ponto da apuracao" (js/apuracao-nacional.js, comparacao).

Resumo: scratch/bweb/sequencia_2022_t{1,2}.json
    {"zero": "2022-10-02T17:00:00", "locais": {"<mun>_<zona>_<local>":
        [[minutos depois das 17h, aptos, comparecimento], ...uma por secao]}}
Chave com o municipio do TSE em 5 digitos, zona e local sem zeros a esquerda.
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import time
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent.parent
PASTA = RAIZ / 'scratch' / 'bweb'
UFS = ('ac al am ap ba ce df es go ma mg ms mt pa pb pe pi pr rj rn ro rr rs sc se sp to zz').split()
BASE = 'https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes2022/buweb/'
ARQUIVO = {'1': 'bweb_1t_{UF}_051020221321.zip', '2': 'bweb_2t_{UF}_311020221535.zip'}
ZERO = {'1': datetime(2022, 10, 2, 17, 0, 0), '2': datetime(2022, 10, 30, 17, 0, 0)}


def resumo_de(turno: str) -> Path:
    return PASTA / f'sequencia_2022_t{turno}.json'


def baixar(turno: str) -> None:
    PASTA.mkdir(parents=True, exist_ok=True)
    for uf in UFS:
        nome = ARQUIVO[turno].format(UF=uf.upper())
        destino = PASTA / nome
        if destino.exists() and destino.stat().st_size > 0:
            continue
        parcial = destino.with_suffix('.part')
        inicio = time.time()
        req = urllib.request.Request(BASE + nome, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=120) as r, parcial.open('wb') as f:
            while True:
                bloco = r.read(1 << 20)
                if not bloco:
                    break
                f.write(bloco)
        parcial.replace(destino)
        print(f'  {nome}: {destino.stat().st_size / 1e6:.0f} MB em {time.time() - inicio:.0f}s', flush=True)


def resumir(turno: str) -> None:
    """Uma passada por boletim: so as linhas do cargo de presidente (uma por
    votavel e secao), e de cada secao so o que descreve a secao."""
    zero = ZERO[turno]
    locais: dict[str, list] = {}
    for uf in UFS:
        arq = PASTA / ARQUIVO[turno].format(UF=uf.upper())
        inicio = time.time()
        vistas = set()
        with zipfile.ZipFile(arq) as z:
            nome = [n for n in z.namelist() if n.lower().endswith('.csv')][0]
            with z.open(nome) as bruto:
                texto = io.TextIOWrapper(bruto, encoding='latin-1', newline='')
                cab = [c.strip('"') for c in texto.readline().rstrip('\r\n').split(';')]
                col = {c: i for i, c in enumerate(cab)}
                i_cargo, i_mun, i_zona = col['CD_CARGO_PERGUNTA'], col['CD_MUNICIPIO'], col['NR_ZONA']
                i_secao, i_local = col['NR_SECAO'], col['NR_LOCAL_VOTACAO']
                i_hora, i_aptos, i_comp = col['DT_BU_RECEBIDO'], col['QT_APTOS'], col['QT_COMPARECIMENTO']
                for linha in texto:
                    p = linha.split(';')
                    if p[i_cargo].strip('"') != '1':
                        continue
                    mun, zona, secao = p[i_mun].strip('"'), p[i_zona].strip('"'), p[i_secao].strip('"')
                    if (mun, zona, secao) in vistas:
                        continue
                    vistas.add((mun, zona, secao))
                    t = datetime.strptime(p[i_hora].strip('"'), '%d/%m/%Y %H:%M:%S')
                    minutos = round((t - zero).total_seconds() / 60.0, 2)
                    chave = f'{mun.zfill(5)}_{int(zona)}_{int(p[i_local].strip(chr(34)))}'
                    locais.setdefault(chave, []).append(
                        [minutos, int(p[i_aptos].strip('"')), int(p[i_comp].strip('"'))])
        print(f'  {uf}: {len(vistas):,} secoes, {time.time() - inicio:.0f}s'.replace(',', '.'), flush=True)
    resumo_de(turno).write_text(json.dumps({'zero': zero.isoformat(), 'locais': locais},
                                           separators=(',', ':')), encoding='utf-8')
    print(f'{len(locais):,} locais -> {resumo_de(turno)}'.replace(',', '.'), flush=True)


CURVA = RAIZ / 'resultados_geo' / 'comparacao' / 'presidente_2022_t{turno}_curva.json'
PASSO_CURVA = 0.5   # em pontos percentuais de secoes apuradas
NUMEROS = ('13', '22')


def curva(turno: str) -> None:
    """Para cada unidade (o Brasil, cada UF e o exterior): as secoes na ordem de
    chegada do boletim e, a cada PASSO_CURVA% delas, o acumulado de votos
    validos e dos dois numeros. Voto valido = nominal (o boletim marca branco e
    nulo como tipos proprios)."""
    zero = ZERO[turno]
    secoes = []   # (uf, minutos, vv, v13, v22)
    for uf in UFS:
        arq = PASTA / ARQUIVO[turno].format(UF=uf.upper())
        inicio = time.time()
        atual = {}
        with zipfile.ZipFile(arq) as z:
            nome = [n for n in z.namelist() if n.lower().endswith('.csv')][0]
            with z.open(nome) as bruto:
                texto = io.TextIOWrapper(bruto, encoding='latin-1', newline='')
                cab = [c.strip('"') for c in texto.readline().rstrip('\r\n').split(';')]
                col = {c: i for i, c in enumerate(cab)}
                i_cargo, i_mun, i_zona = col['CD_CARGO_PERGUNTA'], col['CD_MUNICIPIO'], col['NR_ZONA']
                i_secao, i_hora = col['NR_SECAO'], col['DT_BU_RECEBIDO']
                i_tipo, i_num, i_votos = col['DS_TIPO_VOTAVEL'], col['NR_VOTAVEL'], col['QT_VOTOS']
                for linha in texto:
                    p = linha.split(';')
                    if p[i_cargo].strip('"') != '1':
                        continue
                    chave = (p[i_mun], p[i_zona], p[i_secao])
                    sec = atual.get(chave)
                    if sec is None:
                        t = datetime.strptime(p[i_hora].strip('"'), '%d/%m/%Y %H:%M:%S')
                        sec = atual[chave] = [(t - zero).total_seconds() / 60.0, 0, 0, 0]
                    if p[i_tipo].strip('"') != 'Nominal':
                        continue
                    v = int(p[i_votos].strip('"'))
                    sec[1] += v
                    num = p[i_num].strip('"')
                    if num == NUMEROS[0]:
                        sec[2] += v
                    elif num == NUMEROS[1]:
                        sec[3] += v
        secoes += [(uf, *v) for v in atual.values()]
        print(f'  {uf}: {len(atual):,} secoes, {time.time() - inicio:.0f}s'.replace(',', '.'), flush=True)

    def pontos(lista):
        lista = sorted(lista, key=lambda x: x[1])
        n = len(lista)
        acc, saida, k = [0, 0, 0], [], 0
        marcos = [round(n * i * PASSO_CURVA / 100) for i in range(int(100 / PASSO_CURVA) + 1)]
        saida.append([0, 0, 0])
        for i, (_, _, vv, a, b) in enumerate(lista, start=1):
            acc[0] += vv
            acc[1] += a
            acc[2] += b
            while k + 1 < len(marcos) and marcos[k + 1] <= i:
                k += 1
                saida.append(list(acc))
        while len(saida) < len(marcos):
            saida.append(list(acc))
        return saida

    saida = {'eleicao': f'2022, {turno}o turno', 'numeros': list(NUMEROS), 'passo': PASSO_CURVA,
             'br': pontos(secoes), 'uf': {}}
    for uf in UFS:
        saida['uf'][uf] = pontos([x for x in secoes if x[0] == uf])
    destino = Path(str(CURVA).format(turno=turno))
    destino.write_text(json.dumps(saida, separators=(',', ':')), encoding='utf-8')
    fim = saida['br'][-1]
    print(f'curva -> {destino} ({destino.stat().st_size / 1024:.0f} KB); Brasil no fim: '
          f'validos {fim[0]:,}, 13 {fim[1]:,}, 22 {fim[2]:,}'.replace(',', '.'), flush=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--baixar', action='store_true')
    ap.add_argument('--resumir', action='store_true')
    ap.add_argument('--curva', action='store_true')
    ap.add_argument('--turno', choices=['1', '2'], nargs='*', default=['1', '2'])
    a = ap.parse_args()
    for turno in a.turno:
        if a.baixar:
            print(f'baixando o {turno}o turno', flush=True)
            baixar(turno)
        if a.resumir:
            print(f'resumindo o {turno}o turno', flush=True)
            resumir(turno)
        if a.curva:
            print(f'curva do {turno}o turno', flush=True)
            curva(turno)
    return 0


if __name__ == '__main__':
    sys.exit(main())
