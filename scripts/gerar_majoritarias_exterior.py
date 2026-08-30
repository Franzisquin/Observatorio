"""Gera os resultados do voto no EXTERIOR (escopo 'ZZ') das eleicoes presidenciais.

O TSE poe o voto da diaspora em SG_UF = 'ZZ' dentro do arquivo nacional por secao
(votacao_secao_{ano}_BR), com uma "cidade" por urna consular. Este script agrega
esse voto por PAIS -- que e a unidade do mapa da diaspora -- e por consulado, e
escreve no mesmo formato JSON-em-ZIP que a visao nacional ja le.

Saida: resultados_geo/Majoritarias {ano}/
  presidente_{ano}_t{turno}_ZZ.zip
    presidente_{ano}_t{turno}_ZZ.json         METADATA + RESULTS (por iso3) + CONSULADOS
    presidente_{ano}_t{turno}_ZZ_resumo.json  METADATA + TOTALS (exterior inteiro)

Um zip por ano+turno, e nao por unidade como nas UFs: o exterior inteiro cabe em
dezenas de KB, entao dividi-lo so multiplicaria requisicao.

DOIS REGIMES DE CODIGO
----------------------
Ate 2006 o TSE agregava o exterior por PAIS (11142 ARGENTINA); de 2010 em diante,
por CONSULADO (30287 PARIS). scripts/exterior_consulados.csv cobre os dois: a
chave e sempre CD_MUNICIPIO, e cada codigo carrega o iso3 e a coordenada.

FONTE DOS BRUTOS
----------------
Ficam fora do repositorio (ver .gitignore). O padrao de --fonte e a pasta onde
eles estao hoje; 2002 tambem existe em 'Resultados 2002/' dentro do projeto.
1998 e CSV-em-ZIP em vez de parquet e sai do proprio repositorio, depois de
  python scripts/baixar_secoes_1998.py --ufs      (so os arquivos nacionais)

Uso:
  python scripts/gerar_majoritarias_exterior.py
  python scripts/gerar_majoritarias_exterior.py --anos 2022
  python scripts/gerar_majoritarias_exterior.py --fonte "D:/brutos"
"""

import argparse
import csv
import json
import os
import sys
import zipfile
from collections import defaultdict

import pandas as pd

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO_DIR = os.path.join(BASE_DIR, 'resultados_geo')
CSV_CONSULADOS = os.path.join(BASE_DIR, 'scripts', 'exterior_consulados.csv')
MALHA_PAISES = os.path.join(GEO_DIR, 'paises_mundo.geojson')
FONTE_PADRAO = r'C:\mapas\site eleições'

ANOS_PARQUET = [2002, 2006, 2010, 2014, 2018, 2022]
ANOS_PAPEL = [1989, 1994]
ANOS = ANOS_PAPEL + [1998] + ANOS_PARQUET
CD_PRESIDENTE = 1
UF_EXTERIOR = 'ZZ'


def carregar_consulados():
    """CD_MUNICIPIO -> {nome, iso3, lat, lng}."""
    consulados = {}
    with open(CSV_CONSULADOS, encoding='utf-8') as fh:
        for linha in fh:
            linha = linha.strip()
            if not linha or linha.startswith('#'):
                continue
            cd, nome, iso3, lat, lng = linha.split(';')
            consulados[int(cd)] = {
                'nome': nome, 'iso3': iso3, 'lat': float(lat), 'lng': float(lng),
            }
    return consulados


def carregar_iso3_da_malha():
    with open(MALHA_PAISES, encoding='utf-8') as fh:
        malha = json.load(fh)
    return {f['properties']['iso3'] for f in malha['features']}


def cand_names_do_acervo(ano, turno):
    """cand_names de presidente daquele ano/turno, lido do proprio acervo.

    A eleicao presidencial e nacional: os 27 zips por UF carregam EXATAMENTE o
    mesmo cand_names (conferido em todos os anos). Reusa-lo aqui, em vez de
    rederivar de consulta_cand, e o que garante que o nome, o partido e a
    situacao no exterior sao os mesmos que o site ja mostra em todo o resto --
    e evita ter de reconstruir a situacao de 2006, cujo consulta_cand traz
    DS_SIT_TOT_TURNO = '#NULO#' em todos os candidatos a presidente.
    """
    out_dir = os.path.join(GEO_DIR, f'Majoritarias {ano}')
    for uf in ('SP', 'MG', 'RJ', 'BA', 'AC'):
        base = f'presidente_{ano}_t{turno}_{uf}'
        caminho = os.path.join(out_dir, f'{base}.zip')
        if not os.path.exists(caminho):
            continue
        with zipfile.ZipFile(caminho) as zf:
            nomes = zf.namelist()
            alvo = next((n for n in (f'{base}_resumo.json', f'{base}.json') if n in nomes), None)
            if not alvo:
                continue
            meta = json.loads(zf.read(alvo)).get('METADATA', {}).get('cand_names')
        if meta:
            return meta
    return None


def _padronizar(df):
    """Reduz qualquer fonte ao mesmo df: CD_MUNICIPIO, NR_TURNO, NR_VOTAVEL, QT_VOTOS."""
    df = df.rename(columns=str.upper)
    df = df[df['SG_UF'].astype(str).str.upper() == UF_EXTERIOR]
    df = df[pd.to_numeric(df['CD_CARGO'], errors='coerce') == CD_PRESIDENTE]
    saida = pd.DataFrame({
        'CD_MUNICIPIO': pd.to_numeric(df['CD_MUNICIPIO'], errors='coerce'),
        'NR_TURNO': pd.to_numeric(df['NR_TURNO'], errors='coerce'),
        'NR_VOTAVEL': pd.to_numeric(df['NR_VOTAVEL'], errors='coerce'),
        'QT_VOTOS': pd.to_numeric(df['QT_VOTOS'], errors='coerce'),
    }).dropna()
    return saida.astype(int)


def ler_ano_parquet(fonte, ano):
    votos = os.path.join(fonte, f'Resultados {ano}', f'votacao_secao_{ano}_BR.parquet')
    if not os.path.exists(votos):
        raise FileNotFoundError(votos)
    return _padronizar(pd.read_parquet(votos, columns=[
        'SG_UF', 'CD_CARGO', 'CD_MUNICIPIO', 'NR_TURNO', 'NR_VOTAVEL', 'QT_VOTOS']))


def _csv_do_zip(zip_path, nome_interno, usecols):
    with zipfile.ZipFile(zip_path) as zf:
        with zf.open(nome_interno) as fh:
            return pd.read_csv(fh, sep=';', encoding='latin-1', dtype=str,
                               usecols=usecols, on_bad_lines='skip')


def ler_1998(fonte):
    """1998 e o ano fora do padrao, em duas frentes.

    Primeira: o exterior NAO esta no votacao_secao_1998_BR -- esse arquivo cobre
    so as 27 UFs (conferido: nenhum codigo de urna consular aparece nele). O voto
    da diaspora daquele ano so existe agregado por municipio+zona, em
    votacao_candidato_munzona_1998_BRASIL.csv, com SG_UF = 'ZZ'. Como o mapa da
    diaspora agrega por PAIS de qualquer forma, perder a secao nao custa nada.

    Segunda: la a coluna de voto e QT_VOTOS_NOMINAIS_VALIDOS (QT_VOTOS_NOMINAIS
    vem zerada no arquivo BRASIL), e brancos e nulos nao estao nela -- vem do
    detalhe_votacao_munzona, e entram aqui como os votaveis 95 e 96 que os
    demais anos ja trazem prontos.
    """
    pastas = [os.path.join(base, 'Resultados 1998')
              for base in (BASE_DIR, os.path.dirname(BASE_DIR), fonte)]
    pasta = next((p for p in pastas if os.path.isdir(p)), None)
    if not pasta:
        raise FileNotFoundError(
            'Resultados 1998/ nao encontrada. Rode antes: '
            'python scripts/baixar_secoes_1998.py --ufs')

    cand_zip = os.path.join(pasta, 'votacao_candidato_munzona_1998.zip')
    det_zip = os.path.join(pasta, 'detalhe_votacao_munzona_1998.zip')
    if not os.path.exists(cand_zip):
        raise FileNotFoundError(cand_zip)

    nominais = _csv_do_zip(
        cand_zip, 'votacao_candidato_munzona_1998_BRASIL.csv',
        ['SG_UF', 'CD_CARGO', 'CD_MUNICIPIO', 'NR_TURNO', 'NR_CANDIDATO',
         'QT_VOTOS_NOMINAIS_VALIDOS'])
    nominais = nominais.rename(columns={'NR_CANDIDATO': 'NR_VOTAVEL',
                                        'QT_VOTOS_NOMINAIS_VALIDOS': 'QT_VOTOS'})
    partes = [_padronizar(nominais)]

    if os.path.exists(det_zip):
        det = _csv_do_zip(
            det_zip, 'detalhe_votacao_munzona_1998_BRASIL.csv',
            ['SG_UF', 'CD_CARGO', 'CD_MUNICIPIO', 'NR_TURNO',
             'QT_VOTOS_BRANCOS', 'QT_VOTOS_NULOS'])
        for coluna, votavel in (('QT_VOTOS_BRANCOS', '95'), ('QT_VOTOS_NULOS', '96')):
            bloco = det.rename(columns={coluna: 'QT_VOTOS'}).copy()
            bloco['NR_VOTAVEL'] = votavel
            partes.append(_padronizar(bloco))

    return pd.concat(partes, ignore_index=True)


# ---------------------------------------------------------------------------
# 1989 e 1994: os anos que so existem em papel
#
# Nao ha arquivo eletronico do exterior antes de 2002. O que existe sao os
# boletins impressos do TSE, digitalizados, lidos por
# scripts/extrair_exterior_1989_pdf.py e scripts/extrair_exterior_1994_pdf.py --
# que ja conferem cada numero contra a soma e o percentual do proprio papel.
# Aqui os CSVs que eles produzem entram no mesmo caminho dos demais anos.
# ---------------------------------------------------------------------------

CSV_PAISES_1989 = os.path.join(BASE_DIR, 'scripts', 'exterior_paises_1989.csv')
DADOS_PAPEL = os.path.join(BASE_DIR, 'scripts', 'dados_exterior_1989')

# Nome de urna no boletim de 1989 -> numero. O boletim abrevia; os numeros sao os
# de 1989/cand1989.json, que e a lista completa dos 22 candidatos.
NUMEROS_1989 = {
    'LULA': '13', 'MARRONZINHO': '42', 'ZAMIR': '31', 'AFIF': '22',
    'R. FREIRE': '23', 'PG': '54', 'AURELIANO': '25', 'BRIZOLA': '12',
    'GABEIRA': '43', 'PEDREIRA': '16', 'MANOEL HORTA': '57', 'CORREA': '26',
    'CELSO BRANT': '33', 'MALUF': '11', 'MARIO COVAS': '45', 'LIVIA MARIA': '27',
    'COLLOR': '20', 'A. CAMARGO': '14', 'ENEAS': '56', 'ULYSSES': '15',
    'R. CAIADO': '51', 'EUDES': '55',
}
RESUMO_1989 = {'#BRANCOS': '95', '#NULOS': '96'}


def carregar_paises_1989():
    """nome do pais no boletim de 1989 -> codigo iso3 da malha do mundo."""
    tabela = {}
    with open(CSV_PAISES_1989, encoding='utf-8') as fh:
        for linha in fh:
            linha = linha.strip()
            if not linha or linha.startswith('#'):
                continue
            nome, iso3 = linha.split(';')[:2]
            tabela[nome] = iso3
    return tabela


def ler_papel_1989(turno, consulados):
    """CSV do boletim de 1989 -> [{iso3, nome, votos por numero}], um por pais."""
    caminho = os.path.join(DADOS_PAPEL, f'exterior_1989_t{turno}.csv')
    if not os.path.exists(caminho):
        raise FileNotFoundError(caminho)
    paises = carregar_paises_1989()

    por_pais = {}
    with open(caminho, encoding='utf-8') as fh:
        for linha in csv.DictReader(fh, delimiter=';'):
            nome, chave, votos = linha['pais'], linha['chave'], int(linha['votos'])
            numero = NUMEROS_1989.get(chave) or RESUMO_1989.get(chave)
            if not numero:
                continue
            iso3 = paises[nome]
            unidade = por_pais.setdefault(iso3, {'iso3': iso3, 'nome': nome, 'votos': {}})
            unidade['votos'][numero] = unidade['votos'].get(numero, 0) + votos
    return list(por_pais.values())


def ler_papel_1994(consulados):
    """CSV do relatorio de 1994 -> [{iso3, nome, votos por numero}], um por pais."""
    caminho = os.path.join(DADOS_PAPEL, 'exterior_1994_t1.csv')
    if not os.path.exists(caminho):
        raise FileNotFoundError(caminho)

    por_pais = {}
    with open(caminho, encoding='utf-8') as fh:
        for linha in csv.DictReader(fh, delimiter=';'):
            cd = int(linha['cd_municipio'])
            info = consulados[cd]
            unidade = por_pais.setdefault(info['iso3'], {
                'iso3': info['iso3'], 'nome': linha['pais'], 'votos': {}})
            unidade['votos'][linha['numero']] = (
                unidade['votos'].get(linha['numero'], 0) + int(linha['votos']))
    return list(por_pais.values())


def agregar(df_turno, consulados):
    """Um turno -> (RESULTS por iso3, CONSULADOS, TOTALS)."""
    por_pais = defaultdict(lambda: defaultdict(int))
    por_ponto = {}
    totais = defaultdict(int)

    for cd, grupo in df_turno.groupby('CD_MUNICIPIO'):
        info = consulados[cd]
        # Dois codigos do TSE podem ser a mesma cidade (regime de pais ate 2006 e
        # de consulado depois). Somar por coordenada evita dois circulos empilhados
        # no mesmo ponto do mapa.
        ponto = (info['lat'], info['lng'])
        alvo = por_ponto.get(ponto)
        if alvo is None:
            alvo = por_ponto[ponto] = {
                'cd': int(cd), 'nome': info['nome'], 'iso3': info['iso3'],
                'lat': info['lat'], 'lng': info['lng'], 'votos': defaultdict(int),
            }
        for num, qt in grupo.groupby('NR_VOTAVEL')['QT_VOTOS'].sum().items():
            chave = str(int(num))
            qt = int(qt)
            por_pais[info['iso3']][chave] += qt
            alvo['votos'][chave] += qt
            totais[chave] += qt

    results = {iso3: dict(v) for iso3, v in por_pais.items()}
    lista = sorted(por_ponto.values(), key=lambda c: -sum(c['votos'].values()))
    for c in lista:
        c['votos'] = dict(c['votos'])
    return results, lista, dict(totais)


def write_zip(out_dir, zip_name, arquivos):
    os.makedirs(out_dir, exist_ok=True)
    caminho = os.path.join(out_dir, zip_name)
    with zipfile.ZipFile(caminho, 'w', zipfile.ZIP_DEFLATED) as zf:
        for nome, payload in arquivos.items():
            zf.writestr(nome, json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
    return caminho


def gerar_ano_papel(ano, consulados, iso3_validos):
    """1989 e 1994: a unidade ja e o PAIS, nao a urna consular.

    Os dois anos nao tem detalhe por consulado -- o boletim agrega por pais --,
    entao cada pais entra tambem como um unico ponto no mapa, na coordenada do
    consulado principal dele.
    """
    print(f'\n=== {ano} ===', flush=True)
    turnos = (1, 2) if ano == 1989 else (1,)
    out_dir = os.path.join(GEO_DIR, f'Majoritarias {ano}')
    falhas = 0

    for turno in turnos:
        try:
            unidades = (ler_papel_1989(turno, consulados) if ano == 1989
                        else ler_papel_1994(consulados))
        except FileNotFoundError as erro:
            print(f'  T{turno}: extracao ausente, pulando ({erro})')
            print('  rode antes: python scripts/extrair_exterior_'
                  f'{ano}_pdf.py' + (f' --turno {turno}' if ano == 1989 else ''))
            return 1

        sem_malha = sorted({u['iso3'] for u in unidades} - iso3_validos)
        if sem_malha:
            print(f'  ERRO T{turno}: iso3 fora de paises_mundo.geojson: {sem_malha}')
            return 1
        results = {u['iso3']: dict(u['votos']) for u in unidades}
        totais = {}
        for u in unidades:
            for numero, votos in u['votos'].items():
                totais[numero] = totais.get(numero, 0) + votos

        cand_names = cand_names_do_acervo(ano, turno)
        if not cand_names:
            print(f'  ERRO T{turno}: sem presidente_{ano}_t{turno}_<UF>.zip no acervo.')
            return 1
        cand_names = dict(cand_names)
        # 1989 teve 22 candidatos; o acervo por UF traz 21, porque Correa (26) nao
        # teve voto em nenhum estado. No exterior ele teve, entao entra aqui.
        if ano == 1989 and '26' not in cand_names:
            cand_names['26'] = ['Corrêa', 'PMB', 'NÃO ELEITO', '', '']
        # Branco e nulo nem sempre estao no cand_names por UF desses anos; no
        # exterior eles existem e precisam de rotulo para o painel.
        cand_names.setdefault('95', ['VOTO BRANCO', '', 'BRANCO', '', ''])
        cand_names.setdefault('96', ['VOTO NULO', '', 'NULO', '', ''])
        sem_meta = sorted(k for k in totais if k not in cand_names)
        if sem_meta:
            print(f'  ERRO T{turno}: votos em numeros sem cand_names: {sem_meta}')
            return 1

        metadata = {'cand_names': cand_names, 'coalition_adjustments': {}}
        base = f'presidente_{ano}_t{turno}_{UF_EXTERIOR}'
        # Sem bloco CONSULADOS: nestes anos o boletim agrega por PAIS, e a
        # "urna consular" seria o proprio poligono repetido como bolinha em cima
        # de si mesmo. O front-end so desenha os pontos onde ha detalhe de
        # verdade -- de 1998 em diante.
        caminho = write_zip(out_dir, f'{base}.zip', {
            f'{base}.json': {'METADATA': metadata, 'RESULTS': results},
            f'{base}_resumo.json': {'METADATA': metadata, 'TOTALS': totais},
        })
        validos = sum(v for n, v in totais.items() if n not in ('95', '96'))
        print(f'  T{turno}: {len(results)} paises, {validos:,} votos validos -> '
              f'{os.path.basename(caminho)} ({os.path.getsize(caminho)/1024:.0f} KB)'
              .replace(',', '.'))
    return falhas


def gerar_ano(ano, fonte, consulados, iso3_validos):
    print(f'\n=== {ano} ===', flush=True)
    try:
        df = ler_1998(fonte) if ano == 1998 else ler_ano_parquet(fonte, ano)
    except FileNotFoundError as erro:
        print(f'  bruto ausente, pulando: {erro}')
        return 0

    if df.empty:
        print('  sem linhas de exterior (SG_UF = ZZ) neste ano, pulando.')
        return 0

    faltando = sorted(set(df['CD_MUNICIPIO']) - set(consulados))
    if faltando:
        print(f'  ERRO: {len(faltando)} codigos fora de exterior_consulados.csv: {faltando}')
        return 1

    sem_malha = sorted({consulados[c]['iso3'] for c in set(df['CD_MUNICIPIO'])} - iso3_validos)
    if sem_malha:
        print(f'  ERRO: iso3 ausentes em paises_mundo.geojson: {sem_malha}')
        return 1

    out_dir = os.path.join(GEO_DIR, f'Majoritarias {ano}')
    for turno in sorted(df['NR_TURNO'].unique()):
        df_t = df[df['NR_TURNO'] == turno]
        results, lista, totais = agregar(df_t, consulados)

        bruto = int(df_t['QT_VOTOS'].sum())
        soma_pais = sum(sum(v.values()) for v in results.values())
        soma_cons = sum(sum(c['votos'].values()) for c in lista)
        if not (bruto == soma_pais == soma_cons):
            print(f'  ERRO T{turno}: bruto={bruto} paises={soma_pais} consulados={soma_cons}')
            return 1

        cand_names = cand_names_do_acervo(ano, turno)
        if not cand_names:
            print(f'  ERRO T{turno}: sem presidente_{ano}_t{turno}_<UF>.zip no acervo '
                  f'para herdar o cand_names.')
            return 1
        sem_meta = sorted(k for k in totais if k not in cand_names)
        if sem_meta:
            print(f'  ERRO T{turno}: votos em numeros que o cand_names nao tem: {sem_meta}')
            return 1
        metadata = {'cand_names': cand_names, 'coalition_adjustments': {}}
        base = f'presidente_{ano}_t{turno}_{UF_EXTERIOR}'
        caminho = write_zip(out_dir, f'{base}.zip', {
            f'{base}.json': {'METADATA': metadata, 'RESULTS': results, 'CONSULADOS': lista},
            f'{base}_resumo.json': {'METADATA': metadata, 'TOTALS': totais},
        })
        tamanho = os.path.getsize(caminho) / 1024
        print(f'  T{turno}: {len(results)} paises, {len(lista)} consulados, '
              f'{bruto:,}'.replace(',', '.')
              + f' votos -> {os.path.basename(caminho)} ({tamanho:.0f} KB)')
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fonte', default=FONTE_PADRAO,
                    help=f'pasta com as "Resultados {{ano}}" do TSE (padrao: {FONTE_PADRAO})')
    ap.add_argument('--anos', nargs='*', type=int, default=ANOS)
    args = ap.parse_args()

    consulados = carregar_consulados()
    iso3_validos = carregar_iso3_da_malha()
    print(f'{len(consulados)} urnas mapeadas; {len(iso3_validos)} paises na malha.')

    orfaos = sorted({c['iso3'] for c in consulados.values()} - iso3_validos)
    if orfaos:
        print('ERRO: iso3 do CSV que a malha nao tem:', ', '.join(orfaos))
        return 1

    falhas = sum(gerar_ano_papel(ano, consulados, iso3_validos) if ano in ANOS_PAPEL
                 else gerar_ano(ano, args.fonte, consulados, iso3_validos)
                 for ano in args.anos)
    print('\nConcluido.' if not falhas else f'\n{falhas} ano(s) com erro.')
    return 1 if falhas else 0


if __name__ == '__main__':
    sys.exit(main())
