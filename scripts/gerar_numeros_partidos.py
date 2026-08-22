# -*- coding: utf-8 -*-
"""Gera js/party-numbers.js: numero do partido -> sigla vigente em cada eleicao.

O voto de legenda vem no acervo como id de 2 digitos com metadado vazio
("19": ["VOTO DE LEGENDA", "PARTIDO 19", "LEGENDA", "", ""]). Sem a sigla da
epoca ele era resolvido por uma tabela de siglas atuais, e o PTN de 2010 virava
"PODEMOS" — que nao casa com a composicao oficial da coligacao (".../PTC/PTN/PV")
e acaba listado como legenda solta.

A traducao certa ja esta no proprio acervo: os CANDIDATOS trazem a sigla da epoca
e o numero deles comeca pelo numero do partido. Este script varre esses metadados
e consolida a tabela por ano.

Uso:
    python scripts/gerar_numeros_partidos.py             # gera js/party-numbers.js
    python scripts/gerar_numeros_partidos.py --verificar # confere contra official_totals
"""

import collections
import glob
import io
import json
import os
import re
import sys
import zipfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, 'js', 'party-numbers.js')

# 95/96 sao branco/nulo; 97+ sao codigos de apuracao, nunca partido.
NAO_PARTIDO = re.compile(r'^(9[5-9]|\d{3,})$')


def _le_metadata(caminho_zip):
    """METADATA.cand_names de um arquivo do acervo (prefere o _resumo, bem menor)."""
    try:
        with zipfile.ZipFile(caminho_zip) as z:
            nomes = z.namelist()
            alvo = next((n for n in nomes if n.endswith('_resumo.json')), None) \
                or next((n for n in nomes if n.endswith('.json')), None)
            if not alvo:
                return {}
            dados = json.loads(z.read(alvo).decode('utf-8', 'replace'))
            return (dados.get('METADATA') or {}).get('cand_names') or {}
    except (zipfile.BadZipFile, OSError, ValueError) as erro:
        print('  ! %s: %s' % (os.path.basename(caminho_zip), erro), file=sys.stderr)
        return {}


def _arquivos_por_ano():
    """{ano: [zips]} das eleicoes proporcionais (deputados e vereadores)."""
    por_ano = collections.defaultdict(list)
    padroes = [
        ('Legislativas', 'deputados_*_%s_*.zip'),
        ('Municipais_Legislativas', 'vereadores_%s_*.zip'),
    ]
    for pasta, padrao in padroes:
        for dir_ano in sorted(glob.glob(os.path.join(RAIZ, 'resultados_geo', pasta + ' *'))):
            ano = os.path.basename(dir_ano).rsplit(' ', 1)[-1]
            if not ano.isdigit():
                continue
            por_ano[ano].extend(sorted(glob.glob(os.path.join(dir_ano, padrao % ano))))
    return por_ano


def coletar():
    """{ano: {numero: sigla}} + conflitos observados."""
    contagem = collections.defaultdict(collections.Counter)  # (ano, num) -> Counter(sigla)
    por_ano = _arquivos_por_ano()

    for ano in sorted(por_ano):
        arquivos = por_ano[ano]
        print('%s: %d arquivos' % (ano, len(arquivos)))
        for caminho in arquivos:
            for cid, meta in _le_metadata(caminho).items():
                if len(cid) <= 2 or not isinstance(meta, list) or len(meta) < 2:
                    continue
                numero = cid[:2]
                if NAO_PARTIDO.match(numero):
                    continue
                sigla = str(meta[1] or '').strip()
                if not sigla or sigla.upper().startswith('PARTIDO') or sigla.isdigit():
                    continue
                contagem[(ano, numero)][sigla] += 1

    tabela = collections.defaultdict(dict)
    conflitos = []
    for (ano, numero), counter in sorted(contagem.items()):
        vencedora, votos = counter.most_common(1)[0]
        tabela[ano][numero] = vencedora
        total = sum(counter.values())
        # Divergencia residual e ruido de digitacao no acervo; so vira alerta quando
        # a segunda opcao tem peso real.
        if votos < total * 0.9:
            conflitos.append((ano, numero, counter.most_common(4)))
    return tabela, conflitos


def escrever(tabela):
    linhas = [
        '// GERADO por scripts/gerar_numeros_partidos.py — nao editar a mao.',
        '//',
        '// Numero do partido -> sigla VIGENTE NAQUELA ELEICAO. O voto de legenda chega',
        '// com id de dois digitos e metadado "PARTIDO 19" no lugar da sigla; traduzir',
        '// pelo nome de hoje (PODEMOS) impede o casamento com a composicao da coligacao',
        '// da epoca (PTN) e joga o partido para fora do seu grupo.',
        '//',
        '// Extraido dos proprios metadados de candidato do acervo, onde a sigla ja e a',
        '// da epoca e o numero do candidato comeca pelo numero do partido.',
        'const PARTY_NUMBER_BY_YEAR = {',
    ]
    for ano in sorted(tabela):
        pares = ', '.join(
            "'%s': '%s'" % (num, tabela[ano][num].replace("'", "\\'"))
            for num in sorted(tabela[ano], key=int)
        )
        linhas.append("  '%s': { %s }," % (ano, pares))
    linhas += [
        '};',
        '',
        'const PARTY_NUMBER_YEARS = Object.keys(PARTY_NUMBER_BY_YEAR).map(Number).sort((a, b) => a - b);',
        '',
        '// Ano exato quando existe; senao o ano conhecido mais proximo, preferindo o',
        '// anterior — uma sigla vale ate ser trocada, entao olhar para tras erra menos.',
        'function siglaForPartyNumber(numero, ano) {',
        "  const chave = String(numero || '').trim().padStart(2, '0');",
        '  if (!/^\\d{2}$/.test(chave)) return \'\';',
        '  const alvo = Number(ano);',
        '  let melhor = null;',
        '  for (const candidato of PARTY_NUMBER_YEARS) {',
        '    if (!PARTY_NUMBER_BY_YEAR[String(candidato)][chave]) continue;',
        '    if (melhor === null) { melhor = candidato; continue; }',
        '    if (!Number.isFinite(alvo)) continue;',
        '    if (candidato <= alvo && (melhor > alvo || candidato > melhor)) melhor = candidato;',
        '    else if (candidato > alvo && melhor > alvo && candidato < melhor) melhor = candidato;',
        '  }',
        "  return melhor === null ? '' : PARTY_NUMBER_BY_YEAR[String(melhor)][chave];",
        '}',
        '',
        '// Tabela inteira de um ano, para semear cache de prefixo: inclui tambem os',
        '// numeros que aquele ano nao registrou, resolvidos pelo ano mais proximo.',
        'function partyNumbersForYear(ano) {',
        '  const saida = {};',
        '  PARTY_NUMBER_YEARS.forEach((y) => {',
        '    Object.keys(PARTY_NUMBER_BY_YEAR[String(y)]).forEach((numero) => {',
        '      if (!saida[numero]) saida[numero] = siglaForPartyNumber(numero, ano);',
        '    });',
        '  });',
        '  return saida;',
        '}',
        '',
        '// 95 branco, 96 nulo, 97-99 reservados do TSE. Nenhum e partido, mas so 95 e',
        '// 96 eram filtrados — o 97 aparecia como legenda "97" em 2002 (PA/PE) e 2018 (BA).',
        'function isNonPartyBallotCode(id) {',
        "  return /^9[5-9]$/.test(String(id || '').trim());",
        '}',
        '',
        'if (typeof window !== \'undefined\') {',
        '  window.PARTY_NUMBER_BY_YEAR = PARTY_NUMBER_BY_YEAR;',
        '  window.siglaForPartyNumber = siglaForPartyNumber;',
        '  window.partyNumbersForYear = partyNumbersForYear;',
        '  window.isNonPartyBallotCode = isNonPartyBallotCode;',
        '}',
        '',
    ]
    with io.open(SAIDA, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(linhas))
    print('\nescrito: %s (%d anos)' % (SAIDA, len(tabela)))


def _norm_sigla(s):
    return re.sub(r'\s+', ' ', str(s or '').strip().upper())


def _siglas_das_composicoes(ano):
    """Todas as siglas que aparecem em composicao de coligacao naquele ano.

    Vem de DOIS campos independentes do acervo: raw_comp de official_totals e
    meta[4] dos candidatos. Nenhum dos dois e o meta[1] de onde a tabela saiu.
    """
    siglas = set()
    dir_ano = os.path.join(RAIZ, 'resultados_geo', 'Legislativas %s' % ano)
    oficial_path = os.path.join(dir_ano, 'official_totals_%s.json' % ano)
    if os.path.exists(oficial_path):
        with io.open(oficial_path, encoding='utf-8') as f:
            for bloco in json.load(f).values():
                for casa in bloco.values():
                    for col in casa.get('coalitions', []):
                        for parte in re.split(r'[/()]', col.get('raw_comp') or ''):
                            if _norm_sigla(parte):
                                siglas.add(_norm_sigla(parte))
    for caminho in glob.glob(os.path.join(dir_ano, 'deputados_*_%s_*.zip' % ano)):
        for meta in _le_metadata(caminho).values():
            if not isinstance(meta, list) or len(meta) < 5:
                continue
            for parte in re.split(r'[/()]', str(meta[4] or '')):
                if _norm_sigla(parte):
                    siglas.add(_norm_sigla(parte))
    return siglas


def verificar(tabela):
    """A sigla que a tabela devolve tem que ser a sigla DAQUELA eleicao.

    Criterio: toda sigla de um ano precisa aparecer em alguma composicao de
    coligacao do mesmo ano — e o indice contra o qual o voto de legenda e casado.
    Era exatamente isso que falhava: para 2010 a tabela antiga devolvia PODEMOS,
    AVANTE, AGIR, DC e REPUBLICANOS, siglas que so existem de 2018 em diante e
    portanto nunca casavam com "... / PTC / PTN / PV" — o partido saia listado
    sozinho, fora da coligacao.
    """
    falhas = 0
    for ano in sorted(tabela):
        conhecidas = _siglas_das_composicoes(ano)
        if not conhecidas:
            continue  # ano so municipal: nao ha composicao de deputado para conferir
        for numero in sorted(tabela[ano], key=int):
            sigla = tabela[ano][numero]
            if _norm_sigla(sigla) not in conhecidas:
                falhas += 1
                print('  X %s numero %s -> %r nao aparece em nenhuma composicao do ano'
                      % (ano, numero, sigla))
    print('\nverificadas %d siglas; %d anacronicas' % (sum(len(v) for v in tabela.values()), falhas))
    return falhas == 0


if __name__ == '__main__':
    tabela, conflitos = coletar()
    if conflitos:
        print('\nconflitos de sigla (ano, numero, contagens):')
        for c in conflitos:
            print('  ', c)
    if '--verificar' in sys.argv:
        sys.exit(0 if verificar(tabela) else 1)
    escrever(tabela)
