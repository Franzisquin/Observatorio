"""Corrige o eleitorado dos locais que herdaram o vetor do vizinho no Censo 2022.

Quando um local de votacao nao casa no perfil do eleitorado, o construtor do
Censo copia o vetor inteiro do local mais proximo e marca
TOTAL_ELEITORES_FONTE = 'parquet_vizinho'. Os locais que nao casam sao presidio,
Fundacao CASA, local temporario e voto em transito — que tem eleitorado minusculo
e acabam herdando a escola do lado inteira. Em Balbinos (SP) as duas
penitenciarias ficaram com 1.442 eleitores cada, contra 62 e 50 reais, e o
municipio aparecia com 26,2% de comparecimento no lugar de 74,0%.

Sao 270 locais em 2022, somando 780.475 eleitores no acervo contra 53.446 reais —
93% de todo o excesso nacional de eleitorado do repositorio.

Aqui o eleitorado desses locais e substituido pelo QT_ELEITOR_ELEICAO_FEDERAL do
arquivo oficial do TSE (atualizacoes_eleitorado/eleitorado_local_votacao_2022.zip),
que em 2022 fecha com o numero oficial ao eleitor. O vetor demografico e
reescalado pelo mesmo fator: a composicao do vizinho continua sendo a melhor
estimativa disponivel para o entorno, so o peso e que passa a ser o real.

Os locais herdados que nao estao no arquivo oficial E nao receberam nenhum voto
nao existiram como local de votacao em 2022 — sao duplicatas, como os seis de
Gravatai (RS) repetidos sob nome prefixado por numero. Esses sao removidos.

Se sobrar algum caso herdado sem valor oficial mas com voto, ele fica como esta,
com a marca 'parquet_vizinho' — getFeatureAptosCount (js/data-zip.js) nao usa
esse valor como denominador.

Uso:  python scripts/corrigir_eleitorado_censo_2022.py [--dry-run]
"""

import csv
import io
import json
import os
import shutil
import sys
import zipfile
from collections import Counter

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CENSO = os.path.join(RAIZ, 'resultados_geo', 'Censo 2022')
UFS = ('AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC '
       'SE SP TO').split()
FONTE_CORRIGIDA = 'oficial_local_votacao'


def pasta_eleitorado():
    """A pasta tem acento no nome; acha sem depender da normalizacao do sistema."""
    for nome in os.listdir(RAIZ):
        caminho = os.path.join(RAIZ, nome)
        if os.path.isdir(caminho) and 'eleitorado' in nome and 'atualiza' in nome:
            return caminho
    raise SystemExit('pasta atualizacoes_eleitorado nao encontrada')


def eleitorado_oficial():
    """(uf, municipio, zona, local) -> eleitores aptos na eleicao federal, 1o turno."""
    zip_path = os.path.join(pasta_eleitorado(), 'eleitorado_local_votacao_2022.zip')
    z = zipfile.ZipFile(zip_path)
    nome = next(n for n in z.namelist() if n.lower().endswith('.csv'))
    total = Counter()
    with z.open(nome) as fh:
        leitor = csv.reader(io.TextIOWrapper(fh, encoding='latin-1', newline=''),
                            delimiter=';')
        cab = next(leitor)
        col = {c: i for i, c in enumerate(cab)}
        i_turno, i_uf = col['NR_TURNO'], col['SG_UF']
        i_mun, i_zona, i_loc = col['CD_MUNICIPIO'], col['NR_ZONA'], col['NR_LOCAL_VOTACAO']
        i_fed = col['QT_ELEITOR_ELEICAO_FEDERAL']
        for linha in leitor:
            if linha[i_turno] != '1':
                continue
            chave = (linha[i_uf], int(linha[i_mun]), int(linha[i_zona]), int(linha[i_loc]))
            total[chave] += int(linha[i_fed])
    return total


def locais_com_voto(uf):
    """Locais do estado que apuraram voto para presidente no 1o turno de 2022."""
    caminho = os.path.join(RAIZ, 'resultados_geo', 'Majoritarias 2022',
                           'presidente_2022_t1_%s.zip' % uf)
    if not os.path.exists(caminho):
        return None
    z = zipfile.ZipFile(caminho)
    nome = next(n for n in z.namelist() if not n.endswith('_resumo.json'))
    dados = json.loads(z.read(nome).decode('utf-8', 'replace'))
    return set(dados['RESULTS'])


def campos_de_contagem(metadata):
    """Campos absolutos do perfil — os que precisam ser reescalados junto."""
    campos = []
    for grupo in (metadata.get('parquet_fields') or {}).values():
        campos.extend(grupo)
    return campos


def main():
    dry = '--dry-run' in sys.argv
    oficial = eleitorado_oficial()
    print('arquivo oficial: %d locais' % len(oficial))

    corrigidos = sem_valor = removidos = 0
    antes = depois = fantasmas = 0

    for uf in UFS:
        zip_path = os.path.join(CENSO, 'censo_%s.zip' % ('2022_' + uf))
        if not os.path.exists(zip_path):
            print('  falta %s' % os.path.basename(zip_path))
            continue

        z = zipfile.ZipFile(zip_path)
        arquivos = {n: z.read(n) for n in z.namelist()}
        z.close()

        principal = 'censo_2022_%s.json' % uf
        dados = json.loads(arquivos[principal].decode('utf-8', 'replace'))
        contagens = campos_de_contagem(dados.get('METADATA') or {})
        com_voto = locais_com_voto(uf)
        mexeu = False
        descartar = []

        for ident, registro in dados['RESULTS'].items():
            if registro.get('TOTAL_ELEITORES_FONTE') != 'parquet_vizinho':
                continue
            herdado = int(registro.get('TOTAL_ELEITORES_PERFIL') or 0)
            zona, local = int(registro['nr_zona']), int(registro['nr_locvot'])
            municipio = int(registro['cd_localidade_tse'])
            chave = (uf, municipio, zona, local)
            real = oficial.get(chave)
            if real is None:
                # Fora do arquivo oficial e sem voto apurado: o local nao existiu.
                votou = com_voto is None or (
                    '%d_%d_%d' % (zona, municipio, local)) in com_voto
                if not votou:
                    descartar.append(ident)
                    fantasmas += herdado
                    removidos += 1
                    mexeu = True
                else:
                    sem_valor += 1
                continue

            fator = (real / herdado) if herdado else 0
            for campo in contagens:
                if campo in registro:
                    registro[campo] = int(round((registro[campo] or 0) * fator))
            registro['TOTAL_ELEITORES_PERFIL'] = real
            registro['TOTAL_ELEITORES_FONTE'] = FONTE_CORRIGIDA
            antes += herdado
            depois += real
            corrigidos += 1
            mexeu = True

        for ident in descartar:
            del dados['RESULTS'][ident]

        if not mexeu or dry:
            continue

        resumo_nome = 'censo_2022_%s_resumo.json' % uf
        if resumo_nome in arquivos:
            resumo = json.loads(arquivos[resumo_nome].decode('utf-8', 'replace'))
            resumo.setdefault('SUMMARY', {})['eleitorado_corrigido_oficial'] = sum(
                1 for r in dados['RESULTS'].values()
                if r.get('TOTAL_ELEITORES_FONTE') == FONTE_CORRIGIDA)
            arquivos[resumo_nome] = json.dumps(resumo, ensure_ascii=False).encode('utf-8')
        arquivos[principal] = json.dumps(dados, ensure_ascii=False).encode('utf-8')

        tmp = zip_path + '.tmp'
        with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as saida:
            for nome, conteudo in arquivos.items():
                saida.writestr(nome, conteudo)
        shutil.move(tmp, zip_path)

    print('locais corrigidos: %d  (%s -> %s eleitores)'
          % (corrigidos, format(antes, ','), format(depois, ',')))
    print('locais fantasma removidos (sem voto e fora do oficial): %d  (%s eleitores)'
          % (removidos, format(fantasmas, ',')))
    print('sem valor oficial mas com voto, mantidos como parquet_vizinho: %d' % sem_valor)
    if dry:
        print('(dry-run: nada foi gravado)')


if __name__ == '__main__':
    main()
