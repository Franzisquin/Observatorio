"""Reescreve Eleitores_Aptos de 2010, 2014 e 2018 em presidente_por_estado{ano}_*.zip.

O acervo por local de votacao traz Eleitores_Aptos inflado nesses tres anos: a
razao contra o eleitorado oficial vai de 1,87 a 2,00 conforme a UF (e ~5,9 em
2006). Nao e um fator fixo, entao dividir por dois nao resolve — sobrariam erros
de ate 6,5% por UF. Por isso js/comparecimento.js so libera 2022.

Aqui o valor e reconstruido a partir de duas fontes oficiais do TSE, em
atualizacoes_eleitorado/:

  1. eleitorado_local_votacao_{ano}: QT_ELEITOR_ELEICAO_FEDERAL por local e POR
     TURNO — o numero de eleitores que efetivamente votam naquele local (secao
     agregada entra zerada aqui e soma na principal). E a distribuicao certa,
     mas o arquivo foi regerado em 2024/2025 a partir do cadastro atual e perde
     secoes ja extintas: falta 0,7% do eleitorado em 2018, 2,3% em 2014 e 3,8%
     em 2010.

  2. perfil_eleitorado_{ano}: o total por municipio, que soma o eleitorado
     oficial do TSE ao eleitor em todos os anos.

O total de cada municipio e o da fonte 2; a repartição entre os locais dele e a
da fonte 1. Na pratica o ajuste e nulo: o fator mediano e 1,0000 (2010), 1,0005
(2014) e 1,0004 (2018).

Como o total do municipio vem da fonte 2, a taxa de comparecimento do municipio —
e de qualquer regiao acima dele — sai exata mesmo quando a fonte 1 perdeu locais.
So a reparticao dentro do municipio fica aproximada.

Quando a perda e grande demais, porem, o eleitorado que falta cai todo em cima
dos poucos locais sobreviventes: Figueirao (MS) em 2018 aparece com 113 eleitores
no lugar de ~2.300, e os dois locais restantes ficariam com 20x o eleitorado
real. Acima de FATOR_MAX o municipio fica com Eleitores_Aptos nulo, que e como a
pagina ja trata feicao sem denominador: ela descarta, em vez de somar
comparecimento sobre denominador nenhum.

Uso:  python scripts/corrigir_aptos_presidente_por_estado.py [--dry-run]
"""

import csv
import glob
import io
import json
import os
import shutil
import sys
import zipfile
from collections import Counter

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANOS = (2010, 2014, 2018)

# ponytail: municipio cujo arquivo por local cobre menos de 1/FATOR_MAX do
# eleitorado real fica sem denominador.
#
# O corte so protege o nivel 'locais' da pagina: como o total de cada municipio
# vem do perfil_eleitorado, a taxa do municipio — e de toda regiao acima dele — e
# exata qualquer que seja o fator. O que o fator estraga e a reparticao DENTRO do
# municipio: os eleitores dos locais que o arquivo perdeu sao distribuidos pelos
# que sobraram, entao cada local carrega ate FATOR_MAX vezes o eleitorado real (e
# o Delta entre turnos, que e o que a pagina mede, encolhe na mesma proporcao).
#
# Cortar apertado sai caro: em 1,10 Manaus ficava de fora por um fator de 1,14,
# e como ela e 60% do Amazonas o estado inteiro aparecia com 72% de
# comparecimento no lugar de 80%. Perder o agregado exato para proteger o ponto
# no mapa e o negocio errado. Em 1,50 sobra 99,2% do eleitorado em 2010, 99,5%
# em 2014 e 99,9% em 2018, e ficam de fora so os municipios em que o arquivo
# perdeu mais de um terco dos locais — os casos tipo Figueirao (MS) em 2018, com
# 113 eleitores no lugar de ~2.300 e fator 20.
FATOR_MAX = 1.50


def pasta_eleitorado():
    for nome in os.listdir(RAIZ):
        caminho = os.path.join(RAIZ, nome)
        if os.path.isdir(caminho) and 'eleitorado' in nome and 'atualiza' in nome:
            return caminho
    raise SystemExit('pasta atualizacoes_eleitorado nao encontrada')


def aptos_por_local(ano):
    """(uf, municipio, zona, local, turno) -> eleitores aptos, por turno.

    QT_ELEITOR_ELEICAO_FEDERAL e a coluna certa por definicao — diz quantos
    eleitores votam NAQUELE local, com a secao agregada ja somada na principal.
    Mas nos anos antigos ela esta parcialmente vazia: em 2010 soma 130,68
    milhoes contra os 135,60 de QT_ELEITOR_SECAO, que e o eleitorado oficial ao
    eleitor. Quando ela nao fecha com o total de secao, o cadastro e o melhor
    que ha — ao custo de deixar a secao agregada contada no local de origem.
    Mesmo criterio de scripts/gerar_eleitorado_apto_oficial.py.
    """
    z = zipfile.ZipFile(os.path.join(pasta_eleitorado(),
                                     'eleitorado_local_votacao_%d.zip' % ano))
    nome = next(n for n in z.namelist() if n.lower().endswith('.csv'))
    total = Counter()
    soma_fed = soma_sec = 0
    linhas = []
    with z.open(nome) as fh:
        leitor = csv.reader(io.TextIOWrapper(fh, encoding='latin-1', newline=''),
                            delimiter=';')
        col = {c: i for i, c in enumerate(next(leitor))}
        iu, im, iz, il = col['SG_UF'], col['CD_MUNICIPIO'], col['NR_ZONA'], col['NR_LOCAL_VOTACAO']
        it, ife, ise = col['NR_TURNO'], col['QT_ELEITOR_ELEICAO_FEDERAL'], col['QT_ELEITOR_SECAO']
        for linha in leitor:
            fed, sec = int(linha[ife]), int(linha[ise])
            soma_fed += fed
            soma_sec += sec
            linhas.append(((linha[iu], int(linha[im]), int(linha[iz]),
                            int(linha[il]), linha[it]), fed, sec))
    usa_secao = bool(soma_sec) and soma_fed < 0.995 * soma_sec
    for chave, fed, sec in linhas:
        total[chave] += sec if usa_secao else fed
    return total, ('QT_ELEITOR_SECAO' if usa_secao else 'QT_ELEITOR_ELEICAO_FEDERAL')


def total_por_municipio(ano):
    """(uf, municipio) -> eleitorado oficial do TSE."""
    z = zipfile.ZipFile(os.path.join(pasta_eleitorado(),
                                     'perfil_eleitorado_%d.zip' % ano))
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


def fatores(ano, locais, municipios):
    """(uf, municipio, turno) -> fator de reescala, ou None se o municipio sai."""
    soma = Counter()
    for (uf, mun, _z, _l, turno), n in locais.items():
        soma[(uf, mun, turno)] += n
    out = {}
    for (uf, mun, turno), parcial in soma.items():
        alvo = municipios.get((uf, mun))
        if not alvo or not parcial:
            out[(uf, mun, turno)] = None
            continue
        fator = alvo / parcial
        out[(uf, mun, turno)] = fator if fator <= FATOR_MAX else None
    return out


def main():
    dry = '--dry-run' in sys.argv
    for ano in ANOS:
        locais, coluna = aptos_por_local(ano)
        municipios = total_por_municipio(ano)
        fat = fatores(ano, locais, municipios)
        print('\n%d [%s]: %d locais no oficial | %d municipios no perfil | %d descartados'
              % (ano, coluna.replace('QT_ELEITOR_', ''), len(locais), len(municipios),
                 len({k[:2] for k, v in fat.items() if v is None})))

        preenchidos = nulos = 0
        soma_aptos = Counter()
        for zip_path in sorted(glob.glob(os.path.join(
                RAIZ, 'resultados_geo', 'presidente_por_estado%d_*.zip' % ano))):
            z = zipfile.ZipFile(zip_path)
            arquivos = {n: z.read(n) for n in z.namelist()}
            z.close()
            mexeu = False

            for nome, conteudo in list(arquivos.items()):
                if not nome.endswith('.geojson'):
                    continue
                geo = json.loads(conteudo.decode('utf-8', 'replace'))
                for feicao in geo['features']:
                    p = feicao['properties']
                    uf = p.get('SG_UF')
                    try:
                        mun = int(p.get('CD_MUNICIPIO'))
                        zona = int(p.get('NR_ZONA'))
                        local = int(p.get('NR_LOCAL_VOTACAO'))
                    except (TypeError, ValueError):
                        p['Eleitores_Aptos 1T'] = p['Eleitores_Aptos 2T'] = None
                        nulos += 1
                        continue
                    for turno, campo in (('1', 'Eleitores_Aptos 1T'),
                                         ('2', 'Eleitores_Aptos 2T')):
                        bruto = locais.get((uf, mun, zona, local, turno))
                        fator = fat.get((uf, mun, turno))
                        if bruto is None or not fator:
                            p[campo] = None
                        else:
                            p[campo] = int(round(bruto * fator))
                            soma_aptos[turno] += p[campo]
                    if p['Eleitores_Aptos 1T'] is None:
                        nulos += 1
                    else:
                        preenchidos += 1
                arquivos[nome] = json.dumps(geo, ensure_ascii=False).encode('utf-8')
                mexeu = True

            if not mexeu or dry:
                continue
            tmp = zip_path + '.tmp'
            with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as saida:
                for nome, conteudo in arquivos.items():
                    saida.writestr(nome, conteudo)
            shutil.move(tmp, zip_path)

        print('   locais com aptos: %d | sem denominador: %d (%.1f%%)'
              % (preenchidos, nulos, 100 * nulos / max(1, preenchidos + nulos)))
        print('   eleitorado coberto: 1T %s | 2T %s'
              % (format(soma_aptos['1'], ','), format(soma_aptos['2'], ',')))
    if dry:
        print('\n(dry-run: nada foi gravado)')


if __name__ == '__main__':
    main()
