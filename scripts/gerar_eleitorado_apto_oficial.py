"""Grava Eleitores_Aptos oficial por local de votacao nos arquivos Censo {ano}.

POR QUE
-------
O Censo do acervo traz TOTAL_ELEITORES_PERFIL, que e quantos eleitores estao
CADASTRADOS naquele local, lido do perfil do eleitorado por secao. Nao e a mesma
coisa que quantos eleitores VOTAM ali: secao agregada continua cadastrada no
local de origem e vota no local principal. Em 2022 sao 3,6 milhoes de eleitores
que as duas contagens colocam em lugares diferentes.

Usar o cadastro como denominador de comparecimento erra nos dois sentidos, e o
erro nao e pequeno onde o local nao casou no perfil e herdou o vetor do vizinho
(TOTAL_ELEITORES_FONTE = 'parquet_vizinho'). Sao Bernardo do Campo em 2024 tem
45 dos 165 locais nessa situacao, com 165 mil eleitores entre eles.

O QUE ESTE SCRIPT FAZ
---------------------
Escreve um campo novo, Eleitores_Aptos, em cada local do Censo, a partir de duas
fontes oficiais do TSE em atualizacoes_eleitorado/:

  1. eleitorado_local_votacao_{ano}: quantos eleitores votam naquele local.
     A coluna muda com o tipo de pleito — QT_ELEITOR_ELEICAO_MUNICIPAL nos anos
     municipais, QT_ELEITOR_ELEICAO_FEDERAL nos gerais — e o script detecta qual
     das duas esta preenchida, com QT_ELEITOR_SECAO de reserva quando a coluna do
     pleito nao fecha (ver aptos_por_local).
  2. perfil_eleitorado_{ano}: o total de cada municipio, que fecha com o
     eleitorado oficial do TSE ao eleitor. Quando ele falta — os downloads de
     2008 e 2016 chegaram truncados —, o proprio arquivo por local serve de alvo.

O total de cada municipio vem da fonte 2; a reparticao entre os locais dele, da
fonte 1, e a reescala acerta o municipio quando as duas nao fecham. Com a coluna
certa elas fecham: a soma da fonte 1 fica entre 99,6% e 100,0% da fonte 2 em
todos os oito anos.

E quando o arquivo por local esta completo ele tambem serve de CADASTRO: locais
que existiram na eleicao e o Censo nao tem sao acrescentados, e locais do Censo
que nao existiram sao removidos. Sao Bernardo do Campo em 2024 tinha 45 locais
extintos e nao tinha os 46 que funcionaram; os votos desses 46 entravam sem
denominador e o municipio aparecia com 100,4% de comparecimento, contra 73,97%
reais.

TOTAL_ELEITORES_PERFIL e o vetor demografico nao sao tocados: continuam sendo o
cadastro, que e o que a ponderacao demografica quer.

getFeatureAptosCount (js/data-zip.js) ja le 'Eleitores_Aptos' antes de
TOTAL_ELEITORES_PERFIL, e os merges do Censo copiam todo campo do registro para
a feicao — entao o campo novo entra sem mudanca no JS.

Uso:  python scripts/gerar_eleitorado_apto_oficial.py [--dry-run] [ano ...]
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
UFS = ('AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC '
       'SE SP TO').split()
ANOS = (2010, 2012, 2014, 2016, 2018, 2020, 2022, 2024)

# ponytail: teto do fator de reescala, so como guarda contra caso patologico.
#
# Como o universo e o dos locais que os resultados apuraram (ver fatores()), um
# fator alto quase sempre significa que o acervo FUNDIU locais — Pongai (SP) em
# 2024 traz num unico local os 2.562 votos de dois, que juntos tem 2.974
# eleitores, e fator 1,996. Ali reescalar e exatamente o certo: o eleitorado tem
# de fundir junto com o voto, senao o municipio aparece com 172%.
#
# Com o universo restrito, o denominador do municipio e sempre o total oficial,
# entao a taxa nunca passa de 100%. Um teto apertado so troca um numero certo
# por um buraco: em 1,50 ficavam 31 municipios sem comparecimento nenhum.
FATOR_MAX = 3.00


def pasta_eleitorado():
    for nome in os.listdir(RAIZ):
        caminho = os.path.join(RAIZ, nome)
        if os.path.isdir(caminho) and 'eleitorado' in nome and 'atualiza' in nome:
            return caminho
    raise SystemExit('pasta atualizacoes_eleitorado nao encontrada')


def aptos_por_local(ano):
    """(uf, municipio, zona, local) -> (eleitores no 1o turno, nomes do local)."""
    caminho = os.path.join(pasta_eleitorado(), 'eleitorado_local_votacao_%d.zip' % ano)
    if not os.path.exists(caminho):
        return None, None, None
    z = zipfile.ZipFile(caminho)
    nome = next(n for n in z.namelist() if n.lower().endswith('.csv'))
    total = Counter()
    nomes = {}
    soma_fed = soma_mun = soma_sec = 0
    with z.open(nome) as fh:
        leitor = csv.reader(io.TextIOWrapper(fh, encoding='latin-1', newline=''),
                            delimiter=';')
        col = {c: i for i, c in enumerate(next(leitor))}
        iu, im, iz, il = col['SG_UF'], col['CD_MUNICIPIO'], col['NR_ZONA'], col['NR_LOCAL_VOTACAO']
        it, isec = col['NR_TURNO'], col['QT_ELEITOR_SECAO']
        ifed, imun = col['QT_ELEITOR_ELEICAO_FEDERAL'], col['QT_ELEITOR_ELEICAO_MUNICIPAL']
        inm, ilv, ibr = col['NM_MUNICIPIO'], col['NM_LOCAL_VOTACAO'], col['NM_BAIRRO']
        linhas = []
        for linha in leitor:
            if linha[it] != '1':
                continue
            fed, mun, sec = int(linha[ifed]), int(linha[imun]), int(linha[isec])
            soma_fed += fed
            soma_mun += mun
            soma_sec += sec
            chave = (linha[iu], int(linha[im]), int(linha[iz]), int(linha[il]))
            linhas.append((chave, fed, mun, sec))
            if chave not in nomes:
                nomes[chave] = (linha[inm], linha[ilv], linha[ibr])

    # A coluna do pleito — FEDERAL num ano geral, MUNICIPAL num ano municipal —
    # e a certa por definicao: diz quantos eleitores votam NAQUELE local, com a
    # secao agregada ja somada na principal.
    #
    # Mas nem sempre ela esta preenchida. Em 2016 QT_ELEITOR_ELEICAO_MUNICIPAL
    # soma 142,07 milhoes contra 144,09 milhoes de QT_ELEITOR_SECAO, que e o
    # eleitorado oficial de 2016 ao eleitor. Usar a coluna do pleito daria 16,51%
    # de abstencao contra os 17,58% oficiais; QT_ELEITOR_SECAO da 17,61%. Quando
    # a coluna do pleito nao fecha com o total de secao, ela esta incompleta, e o
    # cadastro e o melhor que ha — ao custo de deixar a secao agregada contada no
    # local de origem.
    escolhida = 'QT_ELEITOR_ELEICAO_MUNICIPAL' if soma_mun > soma_fed else 'QT_ELEITOR_ELEICAO_FEDERAL'
    soma_pleito = max(soma_mun, soma_fed)
    if soma_sec and soma_pleito < 0.995 * soma_sec:
        escolhida = 'QT_ELEITOR_SECAO'

    posicao = {'QT_ELEITOR_ELEICAO_FEDERAL': 1, 'QT_ELEITOR_ELEICAO_MUNICIPAL': 2,
               'QT_ELEITOR_SECAO': 3}[escolhida]
    for chave, fed, mun, sec in linhas:
        total[chave] += (fed, mun, sec)[posicao - 1]
    return total, nomes, escolhida


def locais_com_voto(ano, uf):
    """Chaves 'zona_municipio_local' que apuraram voto naquele ano, na UF.

    E a mesma chave que o Censo usa em local_key e que
    filterMunicipalFeatures* casa contra os resultados. Um local do Censo que
    tenha voto NUNCA pode ser removido: sem o registro do Censo a feicao perde
    id_unico e o filtro de prefeito a descarta do mapa.
    """
    if ano in (2010, 2014, 2018, 2022):
        caminho = os.path.join(RAIZ, 'resultados_geo', 'Majoritarias %d' % ano,
                               'presidente_%d_t1_%s.zip' % (ano, uf))
        if not os.path.exists(caminho):
            return None
        z = zipfile.ZipFile(caminho)
        nome = next(n for n in z.namelist() if not n.endswith('_resumo.json'))
        return set(json.loads(z.read(nome).decode('utf-8', 'replace'))['RESULTS'])

    caminho = os.path.join(RAIZ, 'resultados_geo', 'Municipais %d' % ano,
                           'prefeito_%d_ord_t1_%s.zip' % (ano, uf))
    if not os.path.exists(caminho):
        return None
    z = zipfile.ZipFile(caminho)
    chaves = set()
    for nome in z.namelist():
        if nome.endswith('_resumo.json') or not nome.endswith('.json'):
            continue
        chaves.update(json.loads(z.read(nome).decode('utf-8', 'replace'))['RESULTS'])
    return chaves


def total_por_municipio(ano):
    """(uf, municipio) -> eleitorado oficial do TSE."""
    caminho = os.path.join(pasta_eleitorado(), 'perfil_eleitorado_%d.zip' % ano)
    if not os.path.exists(caminho):
        return None
    try:
        z = zipfile.ZipFile(caminho)
    except zipfile.BadZipFile:
        # Download truncado (perfil_eleitorado_2008 e _2016 chegaram assim).
        return None
    total = Counter()
    for nome in z.namelist():
        if not nome.lower().endswith('.csv') or 'BRASIL' in nome.upper():
            continue
        with z.open(nome) as fh:
            leitor = csv.reader(io.TextIOWrapper(fh, encoding='latin-1', newline=''),
                                delimiter=';')
            col = {c: i for i, c in enumerate(next(leitor))}
            iu, im = col['SG_UF'], col['CD_MUNICIPIO']
            iq = col.get('QT_ELEITORES_PERFIL', col.get('QT_ELEITORES'))
            for linha in leitor:
                total[(linha[iu], int(linha[im]))] += int(linha[iq])
    return total


def fatores(locais, municipios, universo=None):
    """Fator por municipio para o eleitorado por local fechar com o total do TSE.

    `universo` e o conjunto de chaves 'zona_municipio_local' que a eleicao
    apurou. So elas entram na conta, porque so elas viram feicao no mapa:
    filterMunicipalFeatures* descarta do mapa todo local que nao esta nos
    resultados. Pongai (SP) em 2024 e o caso: o TSE tem dois locais, 1.490 e
    1.484 eleitores, e o acervo de resultados traz um so, com os 2.562 votos dos
    dois. Contar os dois locais no denominador e depois perder um deles no mapa
    dava 172% de comparecimento; concentrando os 2.974 eleitores no local que
    sobrou, da 86%.
    """
    parcial = Counter()
    for (uf, mun, zona, local), n in locais.items():
        if universo is not None and (
                '%d_%d_%d' % (zona, mun, local)) not in universo.get(uf, ()):
            continue
        parcial[(uf, mun)] += n
    out = {}
    for chave, soma in parcial.items():
        alvo = municipios.get(chave)
        if not alvo or not soma:
            out[chave] = None
            continue
        fator = alvo / soma
        out[chave] = fator if fator <= FATOR_MAX else None
    return out


def processar(ano, dry):
    locais, nomes, coluna = aptos_por_local(ano)
    if locais is None:
        print('%d: sem eleitorado_local_votacao, pulado' % ano)
        return
    municipios = total_por_municipio(ano)
    if municipios is None:
        # Sem o perfil_eleitorado nao ha alvo externo para reescalar. O proprio
        # arquivo por local serve de alvo quando ele ja fecha com o eleitorado
        # oficial — e o caso de 2016, cujo perfil_eleitorado veio truncado.
        municipios = Counter()
        for (uf, mun, _z, _l), n in locais.items():
            municipios[(uf, mun)] += n
        print('%d: sem perfil_eleitorado utilizavel, usando o total do proprio '
              'arquivo por local' % ano)
    universo = {}
    for uf in UFS:
        chaves = locais_com_voto(ano, uf)
        if chaves:
            universo[uf] = chaves
    fat = fatores(locais, municipios, universo)
    descartados = sum(1 for v in fat.values() if v is None)

    # O arquivo por local so pode ser usado como CADASTRO de locais quando cobre
    # o eleitorado inteiro. Com a coluna escolhida por aptos_por_local isso vale
    # nos oito anos, mas a guarda fica: se um arquivo futuro vier capenga, ele
    # passa a dizer so onde ha eleitor, nao quais locais existiram.
    completude = sum(locais.values()) / max(1, sum(municipios.values()))
    cadastro_confiavel = completude >= 0.99

    # A reescala so vale quando o cadastro esta completo. Onde ele perdeu locais,
    # reescalar poe os eleitores dos locais perdidos em cima dos que sobraram —
    # mas os VOTOS desses locais nao vem junto, porque eles nao existem no
    # arquivo. O resultado e uma taxa de comparecimento puxada para baixo: em
    # 2010 dava 19,83% de abstencao contra 18,12% oficiais. Sem reescala, cada
    # local sobrevivente fica com o seu eleitorado real e a taxa do recorte sai
    # certa, ao custo de o total do municipio ficar curto.
    if not cadastro_confiavel:
        fat = {chave: (1.0 if valor else None) for chave, valor in fat.items()}

    preenchidos = nulos = acrescentados = removidos = 0
    soma = 0
    for uf in UFS:
        zip_path = os.path.join(RAIZ, 'resultados_geo', 'Censo %d' % ano,
                                'censo_%d_%s.zip' % (ano, uf))
        if not os.path.exists(zip_path):
            continue
        z = zipfile.ZipFile(zip_path)
        arquivos = {n: z.read(n) for n in z.namelist()}
        z.close()

        principal = 'censo_%d_%s.json' % (ano, uf)
        dados = json.loads(arquivos[principal].decode('utf-8', 'replace'))
        com_voto = universo.get(uf)
        vistos = set()
        descartar = []
        for ident, registro in dados['RESULTS'].items():
            municipio = int(registro['cd_localidade_tse'])
            zona, local = int(registro['nr_zona']), int(registro['nr_locvot'])
            chave = (uf, municipio, zona, local)
            bruto = locais.get(chave)
            fator = fat.get(chave[:2])
            # Local fora dos resultados nao vira feicao no mapa; dar eleitorado
            # a ele so somaria denominador que ninguem usa.
            if com_voto is not None and (
                    '%d_%d_%d' % (zona, municipio, local)) not in com_voto:
                bruto = None
            if bruto is None or not fator:
                # Local herdado do vizinho, fora do cadastro oficial e sem voto
                # apurado: ele nao existiu naquela eleicao. Em Sao Bernardo do
                # Campo sao 45 de 165, todos com eleitorado copiado de outro
                # local. Se tiver voto, fica: sem o registro do Censo a feicao
                # perde id_unico e some do mapa.
                votou = com_voto is not None and (
                    '%d_%d_%d' % (zona, municipio, local)) in com_voto
                if (bruto is None and cadastro_confiavel and not votou
                        and registro.get('TOTAL_ELEITORES_FONTE') == 'parquet_vizinho'):
                    descartar.append(ident)
                    removidos += 1
                    continue
                registro['Eleitores_Aptos'] = None
                nulos += 1
            else:
                registro['Eleitores_Aptos'] = int(round(bruto * fator))
                soma += registro['Eleitores_Aptos']
                preenchidos += 1
            vistos.add(chave)

        for ident in descartar:
            del dados['RESULTS'][ident]

        # Locais que existiram na eleicao e o Censo nao tem. Entram so com a
        # identificacao e o eleitorado: sem eles a feicao com voto fica sem
        # denominador, e o municipio aparece com comparecimento acima de 100%.
        if cadastro_confiavel:
            for chave, bruto in locais.items():
                if chave[0] != uf or chave in vistos or not bruto:
                    continue
                fator = fat.get(chave[:2])
                if not fator:
                    continue
                _uf, mun, zona, local = chave
                if com_voto is not None and (
                        '%d_%d_%d' % (zona, mun, local)) not in com_voto:
                    continue
                nm_mun, nm_loc, bairro = nomes.get(chave, ('', '', ''))
                # local_key tem de ser 'zona_municipio_local', o mesmo formato
                # das chaves de RESULTS: mergeCensoJson* copia esse valor para
                # id_unico da feicao, e filterMunicipalFeatures* descarta do
                # mapa toda feicao cujo id_unico nao esteja nos resultados.
                chave_texto = '%d_%d_%d' % (zona, mun, local)
                dados['RESULTS'][chave_texto] = {
                    'local_key': chave_texto,
                    'cd_localidade_tse': mun,
                    'nr_zona': zona,
                    'nr_locvot': local,
                    'nm_localidade': nm_mun,
                    'nm_locvot': nm_loc,
                    'ds_bairro': bairro,
                    'Eleitores_Aptos': int(round(bruto * fator)),
                    'TOTAL_ELEITORES_PERFIL': None,
                    'TOTAL_ELEITORES_FONTE': 'ausente_no_censo',
                }
                soma += int(round(bruto * fator))
                acrescentados += 1

        if dry:
            continue
        resumo_nome = 'censo_%d_%s_resumo.json' % (ano, uf)
        if resumo_nome in arquivos:
            resumo = json.loads(arquivos[resumo_nome].decode('utf-8', 'replace'))
            resumo.setdefault('SUMMARY', {})['eleitores_aptos_fonte'] = coluna
            arquivos[resumo_nome] = json.dumps(resumo, ensure_ascii=False).encode('utf-8')
        arquivos[principal] = json.dumps(dados, ensure_ascii=False).encode('utf-8')
        tmp = zip_path + '.tmp'
        with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as saida:
            for nome, conteudo in arquivos.items():
                saida.writestr(nome, conteudo)
        shutil.move(tmp, zip_path)

    print('%d [%s, cadastro %s]: %d locais com aptos, %d sem, %d acrescentados, '
          '%d extintos removidos | %d municipios fora | eleitorado %s de %s (%.1f%%)'
          % (ano, coluna.replace('QT_ELEITOR_ELEICAO_', ''),
             'confiavel' if cadastro_confiavel else 'incompleto',
             preenchidos, nulos, acrescentados, removidos, descartados,
             format(soma, ','), format(sum(municipios.values()), ','),
             100 * soma / max(1, sum(municipios.values()))))


def main():
    dry = '--dry-run' in sys.argv
    pedidos = [int(a) for a in sys.argv[1:] if a.isdigit()]
    for ano in (pedidos or ANOS):
        processar(ano, dry)
    if dry:
        print('(dry-run: nada foi gravado)')


if __name__ == '__main__':
    main()
