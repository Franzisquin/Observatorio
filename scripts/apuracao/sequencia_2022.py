"""A sequencia real da apuracao de 2022: quando cada boletim de urna chegou.

O unico arquivo publico com a hora de chegada de cada secao e o boletim de urna
do TSE (bweb), no campo DT_BU_RECEBIDO. Daqui sai, por local de votacao, a hora
em que os boletins dele chegaram — e o ensaio (ensaio_2022.py) passa a tocar a
noite na ordem e no ritmo da noite de verdade, em vez de um sorteio.

Os boletins sao pesados (1o turno: 1,46 GB em 28 zips, dezenas de GB de CSV) e
so uma fracao deles interessa. `--converter` baixa um estado por vez, guarda em
parquet so o que o projeto usa e apaga o zip e o CSV na hora: o disco nunca
guarda mais que o CSV de um estado, e o que fica sao poucos MB.

    scratch/bweb/2022_t{1,2}/secoes_<UF>.parquet  uma linha por secao: municipio,
        zona, secao, local, hora de chegada do boletim, aptos, comparecimento
    scratch/bweb/2022_t{1,2}/votos_<UF>.parquet   votos por secao de presidente,
        governador e senador (cargo, tipo do votavel, numero, votos)
    scratch/bweb/2022_t{1,2}/totalizacao.parquet  o historico oficial da
        totalizacao presidencial (Dados Abertos do TSE): a cada totalizacao da
        noite, as secoes e os votos acumulados de cada candidato

    py scripts/apuracao/sequencia_2022.py --converter --totalizacao  (os dois turnos)
    py scripts/apuracao/sequencia_2022.py --resumir                 (a sequencia do ensaio)
    py scripts/apuracao/sequencia_2022.py --curva --turno 1         (a curva presidencial)
    py scripts/apuracao/sequencia_2022.py --conferir                (boletins x totalizacao)

Precisa de duckdb, pandas e pyarrow.

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
import shutil
import sys
import time
import urllib.request
import zipfile
from datetime import datetime, timedelta
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent.parent
PASTA = RAIZ / 'scratch' / 'bweb'
UFS = ('ac al am ap ba ce df es go ma mg ms mt pa pb pe pi pr rj rn ro rr rs sc se sp to zz').split()
BASE = 'https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes2022/buweb/'
ARQUIVO = {'1': 'bweb_1t_{UF}_051020221321.zip', '2': 'bweb_2t_{UF}_311020221535.zip'}
HISTORICO = ('https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes2022/'
             'Historico_Totalizacao_Presidente_BR_{turno}T_2022.zip')
ZERO = {'1': datetime(2022, 10, 2, 17, 0, 0), '2': datetime(2022, 10, 30, 17, 0, 0)}
CABECALHOS = {'User-Agent': 'Mozilla/5.0'}


def pasta_de(turno: str) -> Path:
    return PASTA / f'2022_t{turno}'


def resumo_de(turno: str) -> Path:
    return PASTA / f'sequencia_2022_t{turno}.json'


def parquet(turno: str, tipo: str) -> str:
    """Os parquets de um turno, no formato do read_parquet do DuckDB."""
    return (pasta_de(turno) / f'{tipo}_*.parquet').as_posix()


def banco():
    import duckdb
    con = duckdb.connect()
    # Pouca memoria na maquina: com teto, o DuckDB transborda para o disco em vez
    # de tomar a RAM inteira com o CSV de SP.
    con.execute("SET memory_limit='1GB'; SET threads=4; SET preserve_insertion_order=false")
    return con


def minutos_desde(turno: str, coluna: str) -> str:
    return f"date_diff('second', TIMESTAMP '{ZERO[turno]:%Y-%m-%d %H:%M:%S}', {coluna}) / 60.0"


# Uma linha por secao. A do cargo de presidente existe em toda secao, inclusive
# no exterior, que so vota para presidente.
SQL_SECOES = """
SELECT any_value(SG_UF) AS uf, TRY_CAST(CD_MUNICIPIO AS INTEGER) AS mun,
       TRY_CAST(NR_ZONA AS SMALLINT) AS zona, TRY_CAST(NR_SECAO AS SMALLINT) AS secao,
       TRY_CAST(any_value(NR_LOCAL_VOTACAO) AS INTEGER) AS local_votacao,
       try_strptime(any_value(DT_BU_RECEBIDO), '%d/%m/%Y %H:%M:%S') AS recebido,
       TRY_CAST(any_value(QT_APTOS) AS INTEGER) AS aptos,
       TRY_CAST(any_value(QT_COMPARECIMENTO) AS INTEGER) AS comparecimento,
       TRY_CAST(any_value(QT_ABSTENCOES) AS INTEGER) AS abstencoes,
       any_value(DS_TIPO_URNA) AS tipo_urna
FROM {fonte} WHERE CD_CARGO_PERGUNTA = '1'
GROUP BY CD_MUNICIPIO, NR_ZONA, NR_SECAO
"""

# Tipo do votavel: 1 nominal, 2 branco, 3 nulo. Deputado fica de fora: o ensaio
# os tira do acervo por local, e com eles o arquivo seria dez vezes maior.
SQL_VOTOS = """
SELECT TRY_CAST(CD_MUNICIPIO AS INTEGER) AS mun, TRY_CAST(NR_ZONA AS SMALLINT) AS zona,
       TRY_CAST(NR_SECAO AS SMALLINT) AS secao, TRY_CAST(CD_CARGO_PERGUNTA AS TINYINT) AS cargo,
       TRY_CAST(CD_TIPO_VOTAVEL AS TINYINT) AS tipo, TRY_CAST(NR_VOTAVEL AS INTEGER) AS votavel,
       TRY_CAST(QT_VOTOS AS INTEGER) AS votos
FROM {fonte} WHERE CD_CARGO_PERGUNTA IN ('1', '3', '5')
"""


def converter(turno: str) -> None:
    """Um estado por vez: baixa o zip, extrai o CSV, grava os dois parquets e
    apaga o zip e o CSV. Estado com os dois parquets prontos e pulado, entao o
    comando retoma de onde parou."""
    destino, tmp = pasta_de(turno), PASTA / 'tmp'
    destino.mkdir(parents=True, exist_ok=True)
    tmp.mkdir(parents=True, exist_ok=True)
    con = banco()
    for uf in UFS:
        nome = ARQUIVO[turno].format(UF=uf.upper())
        prontos = [destino / f'{tipo}_{uf.upper()}.parquet' for tipo in ('secoes', 'votos')]
        if all(p.exists() for p in prontos):
            continue
        inicio = time.time()
        zipado, csv = tmp / nome, tmp / (nome[:-4] + '.csv')
        try:
            req = urllib.request.Request(BASE + nome, headers=CABECALHOS)
            with urllib.request.urlopen(req, timeout=300) as r, zipado.open('wb') as f:
                shutil.copyfileobj(r, f, 1 << 20)
            mb_zip = zipado.stat().st_size / 1e6
            with zipfile.ZipFile(zipado) as z:
                membro = next(n for n in z.namelist() if n.lower().endswith('.csv'))
                with z.open(membro) as src, csv.open('wb') as dst:
                    shutil.copyfileobj(src, dst, 1 << 20)
            zipado.unlink()
            mb_csv = csv.stat().st_size / 1e6
            fonte = (f"read_csv('{csv.as_posix()}', delim=';', header=true, quote='\"', "
                     "encoding='latin-1', all_varchar=true)")
            for sql, pronto in zip((SQL_SECOES, SQL_VOTOS), prontos):
                parcial = pronto.with_suffix('.parcial')
                con.execute(f"COPY ({sql.format(fonte=fonte)}) TO '{parcial.as_posix()}' "
                            "(FORMAT parquet, COMPRESSION zstd)")
                parcial.replace(pronto)
        finally:
            zipado.unlink(missing_ok=True)
            csv.unlink(missing_ok=True)
        mb = sum(p.stat().st_size for p in prontos) / 1e6
        print(f'  {uf}: zip {mb_zip:.0f} MB, CSV {mb_csv:.0f} MB -> parquet {mb:.2f} MB '
              f'em {time.time() - inicio:.0f}s', flush=True)


def totalizacao(turno: str) -> None:
    """O historico oficial da totalizacao presidencial: uma linha por totalizacao
    da noite, com as secoes e os votos de cada candidato acumulados."""
    import pandas as pd
    req = urllib.request.Request(HISTORICO.format(turno=turno), headers=CABECALHOS)
    with urllib.request.urlopen(req, timeout=120) as r:
        bruto = r.read()
    with zipfile.ZipFile(io.BytesIO(bruto)) as z:
        membro = next(n for n in z.namelist() if n.lower().endswith('.csv'))
        df = pd.read_csv(z.open(membro), sep=';', encoding='latin-1', dtype=str)
    df.columns = [c.strip() for c in df.columns]
    df = df.apply(lambda s: s.str.strip())
    saida = pd.DataFrame({
        'quando': pd.to_datetime(df['DT_TOTALIZACAO'], format='%d/%m/%Y %H:%M:%S'),
        'secoes': df['QT_SECOES_TOT_ACUMULADO'].astype('int64'),
        'secoes_total': df['QT_SECOES_TOTAL'].astype('int64'),
        'concorrentes': df['QT_VOTOS_CONCORRENTES_ACUMULADO'].astype('int64')})
    fim = '_QT_VOTOS_TOT_ACUMULADO'
    for c in df.columns:
        if c.endswith(fim):
            saida[c[:-len(fim)].lower()] = df[c].astype('int64')
    saida = saida.sort_values(['quando', 'secoes'], kind='stable').reset_index(drop=True)
    destino = pasta_de(turno) / 'totalizacao.parquet'
    destino.parent.mkdir(parents=True, exist_ok=True)
    saida.to_parquet(destino, compression='zstd', index=False)
    print(f'  {len(saida):,}'.replace(',', '.') + f' totalizacoes, de {saida.quando.iloc[0]:%H:%M:%S}'
          f' a {saida.quando.iloc[-1]:%d/%m %H:%M:%S} -> {destino.name} '
          f'({destino.stat().st_size / 1e6:.2f} MB)', flush=True)


def resumir(turno: str) -> None:
    """Por local de votacao, cada secao com a hora de chegada do boletim."""
    con = banco()
    linhas = con.execute(f"""
        SELECT mun, zona, local_votacao, {minutos_desde(turno, 'recebido')}, aptos, comparecimento
        FROM read_parquet('{parquet(turno, 'secoes')}') WHERE recebido IS NOT NULL
        ORDER BY uf, mun, zona, secao""").fetchall()
    locais: dict[str, list] = {}
    for mun, zona, local, minutos, aptos, comp in linhas:
        locais.setdefault(f'{mun:05d}_{zona}_{local}', []).append([round(minutos, 2), aptos, comp])
    resumo_de(turno).write_text(json.dumps({'zero': ZERO[turno].isoformat(), 'locais': locais},
                                           separators=(',', ':')), encoding='utf-8')
    milhar = lambda x: f'{x:,}'.replace(',', '.')  # noqa: E731
    print(f'{milhar(len(linhas))} secoes, {milhar(len(locais))} locais -> {resumo_de(turno)}', flush=True)


CURVA = RAIZ / 'resultados_geo' / 'comparacao' / 'presidente_2022_t{turno}_curva.json'
PASSO_CURVA = 0.5   # em pontos percentuais de secoes apuradas
NUMEROS = ('13', '22')


def por_secao(turno: str) -> list[tuple]:
    """(uf, minutos, votos validos, votos do 13, votos do 22) de cada secao, para
    presidente. Voto valido = nominal (o boletim marca branco e nulo a parte)."""
    con = banco()
    return con.execute(f"""
        WITH v AS (
            SELECT mun, zona, secao,
                   sum(votos) FILTER (WHERE tipo = 1) AS vv,
                   sum(votos) FILTER (WHERE votavel = {NUMEROS[0]}) AS a,
                   sum(votos) FILTER (WHERE votavel = {NUMEROS[1]}) AS b
            FROM read_parquet('{parquet(turno, 'votos')}') WHERE cargo = 1 GROUP BY ALL)
        SELECT lower(s.uf), {minutos_desde(turno, 's.recebido')},
               coalesce(v.vv, 0), coalesce(v.a, 0), coalesce(v.b, 0)
        FROM read_parquet('{parquet(turno, 'secoes')}') s LEFT JOIN v USING (mun, zona, secao)
        WHERE s.recebido IS NOT NULL
        ORDER BY s.uf, s.mun, s.zona, s.secao""").fetchall()


def curva(turno: str) -> None:
    """Para cada unidade (o Brasil, cada UF e o exterior): as secoes na ordem de
    chegada do boletim e, a cada PASSO_CURVA% delas, o acumulado de votos
    validos e dos dois numeros."""
    secoes = por_secao(turno)

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


def conferir(turno: str) -> None:
    """Os boletins contra a totalizacao oficial. O total do fim tem de bater; ao
    longo da noite, a comparacao mostra se a ordem de chegada dos boletins
    reproduz o placar que o TSE publicou, hora a hora."""
    import pandas as pd
    tot = pd.read_parquet(pasta_de(turno) / 'totalizacao.parquet')
    bu = pd.DataFrame(por_secao(turno), columns=['uf', 'minutos', 'vv', 'a', 'b'])
    bu = bu.sort_values('minutos', kind='stable').reset_index(drop=True)
    bu['n'] = 1
    bu[['n', 'vv', 'a', 'b']] = bu[['n', 'vv', 'a', 'b']].cumsum()
    total = int(tot.secoes_total.iloc[-1])
    fim = tot.iloc[-1]
    pct = lambda x, y: 100 * x / y if y else 0.0  # noqa: E731
    print(f'  secoes: TSE {int(fim.secoes):,} de {total:,} | boletins {int(bu.n.iloc[-1]):,}'
          .replace(',', '.'))
    print(f'  validos: TSE {int(fim.concorrentes):,} | boletins {int(bu.vv.iloc[-1]):,}'.replace(',', '.'))
    print(f'  Lula: TSE {int(fim.lula):,} | boletins {int(bu.a.iloc[-1]):,} — Bolsonaro: TSE '
          f'{int(fim.jair_bolsonaro):,} | boletins {int(bu.b.iloc[-1]):,}'.replace(',', '.'))
    print('\n  hora  | % secoes TSE  boletins | Lula TSE  boletins | Bolsonaro TSE  boletins')
    for meia_hora in range(1, 14):  # 17h30 a 23h30
        hora = ZERO[turno] + timedelta(minutes=30 * meia_hora)
        t = tot[tot.quando <= hora]
        b = bu[bu.minutos <= 30 * meia_hora]
        if len(t) and len(b):
            o, x = t.iloc[-1], b.iloc[-1]
            print(f'  {hora:%H:%M} | {pct(o.secoes, total):8.2f}  {pct(x.n, total):8.2f} | '
                  f'{pct(o.lula, o.concorrentes):6.2f}  {pct(x.a, x.vv):6.2f} | '
                  f'{pct(o.jair_bolsonaro, o.concorrentes):6.2f}  {pct(x.b, x.vv):6.2f}')

    def viradas(a, b, n):
        """Os % de secoes em que Lula passa para a frente de Bolsonaro. Antes de 1%
        das secoes e ruido de poucas urnas, e fica de fora."""
        frente, pct_n = (a > b).to_numpy(), (100 * n / total).to_numpy()
        return list(dict.fromkeys(f'{pct_n[i]:.2f}%' for i in range(1, len(frente))
                                  if frente[i] and not frente[i - 1] and pct_n[i] >= 1))
    for nome, lista in (('TSE', viradas(tot.lula, tot.jair_bolsonaro, tot.secoes)),
                        ('boletins', viradas(bu.a, bu.b, bu.n))):
        print(f'  Lula passa Bolsonaro ({nome}): ' + (', '.join(lista) or 'nunca') + ' das secoes')


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--converter', action='store_true',
                    help='baixa os boletins, grava os parquets e apaga zip e CSV')
    ap.add_argument('--totalizacao', action='store_true', help='o historico oficial da totalizacao')
    ap.add_argument('--resumir', action='store_true')
    ap.add_argument('--curva', action='store_true')
    ap.add_argument('--conferir', action='store_true')
    ap.add_argument('--turno', choices=['1', '2'], nargs='*', default=['1', '2'])
    a = ap.parse_args()
    for turno in a.turno:
        for pedido, passo in ((a.converter, converter), (a.totalizacao, totalizacao),
                              (a.resumir, resumir), (a.curva, curva), (a.conferir, conferir)):
            if pedido:
                print(f'{passo.__name__}: {turno}o turno', flush=True)
                passo(turno)
    return 0


if __name__ == '__main__':
    sys.exit(main())
