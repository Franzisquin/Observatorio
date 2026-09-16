#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gera a versao publicavel da tabela de emancipacoes pre-2014.

POR QUE ESTE SCRIPT EXISTE
--------------------------
A tabela completa carrega a *derivacao*: quais secoes eleitorais foram
atribuidas a cada cidade que ainda nao existia, em que eleicao a identidade
dela foi encontrada, e quantas dessas secoes foram ambiguas o bastante para
exigir juizo editorial. Sao 796 secoes atribuidas e 36 ambiguidades resolvidas
em 58 municipios — a parte mais dificil e mais original do acervo.

O site nunca leu nada disso. js/emancipacoes-pre2014.js acessa exatamente
quatro campos (conferido por leitura do arquivo):

    c.cd_ibge   c.nome   c.por_pai   c.resultados

Publicar o resto entregava a pesquisa de graca e ainda enfraquecia a prova de
autoria: quem copiasse levava junto o metodo, e poderia alegar que chegou aos
mesmos numeros sozinho. Guardando a derivacao, uma copia identica dos totais
fica dificil de explicar.

O QUE FICA DE FORA E O QUE FICA
-------------------------------
Sai: secoes, n_secoes, n_secoes_ambiguas, identidade_ano, revisar, cd_tse,
parents — tudo que descreve *como* o numero foi obtido.

Fica: `_meta.mecanismo`. Uma linha dizendo que os municipios foram reconstituidos
somando secoes eleitorais nao e segredo industrial, e um site de transparencia
eleitoral deve dizer que aqueles numeros sao reconstrucao, nao boletim oficial.
Omitir isso seria apresentar estimativa como dado apurado.

USO
---
    python scripts/preparar_emancipacoes_publico.py

Le  resultados_geo/emancipacoes_pre2014.fonte.json   (completo, fora do git)
Escreve resultados_geo/emancipacoes_pre2014.json     (enxuto, publicado)

O arquivo-fonte NAO pode voltar para o versionamento: ele esta no .gitignore.
Guarde uma copia fora deste repositorio — se ela se perder, a reconstrucao
tem de ser refeita do zero.
"""

import json
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTE = os.path.join(RAIZ, 'resultados_geo', 'emancipacoes_pre2014.fonte.json')
PUBLICO = os.path.join(RAIZ, 'resultados_geo', 'emancipacoes_pre2014.json')

# Exatamente os campos que js/emancipacoes-pre2014.js le. Ao mexer no cliente,
# mexa aqui junto — um campo novo que o site passe a usar e que nao esteja nesta
# lista some da publicacao e a tela quebra sem erro visivel.
CAMPOS_PUBLICOS = ('cd_ibge', 'nome', 'por_pai', 'resultados')


def enxugar(completo):
    saida = {}

    meta = completo.get('_meta', {})
    if 'mecanismo' in meta:
        saida['_meta'] = {'mecanismo': meta['mecanismo']}

    anos = {}
    cidades = secoes_omitidas = ambiguas_omitidas = 0

    for ano, ufs in completo.get('anos', {}).items():
        anos[ano] = {}
        for uf, lista in ufs.items():
            enxutas = []
            for cid in lista:
                cidades += 1
                secoes_omitidas += cid.get('n_secoes', 0)
                ambiguas_omitidas += cid.get('n_secoes_ambiguas', 0)
                enxutas.append({k: cid[k] for k in CAMPOS_PUBLICOS if k in cid})
            anos[ano][uf] = enxutas

    saida['anos'] = anos
    return saida, cidades, secoes_omitidas, ambiguas_omitidas


def main():
    if not os.path.exists(FONTE):
        print('ERRO: arquivo-fonte nao encontrado:', FONTE, file=sys.stderr)
        print('', file=sys.stderr)
        print('Ele fica fora do versionamento de proposito. Restaure a copia que', file=sys.stderr)
        print('voce guardou fora do repositorio antes de rodar este script.', file=sys.stderr)
        return 1

    with open(FONTE, encoding='utf-8') as f:
        completo = json.load(f)

    enxuto, cidades, secoes, ambiguas = enxugar(completo)

    # separators sem espaco: o arquivo e transferido a cada carga da pagina.
    with open(PUBLICO, 'w', encoding='utf-8') as f:
        json.dump(enxuto, f, ensure_ascii=False, separators=(',', ':'))

    antes = os.path.getsize(FONTE)
    depois = os.path.getsize(PUBLICO)
    print(f'municipios reconstituidos : {cidades}')
    print(f'secoes mantidas fora do ar: {secoes}')
    print(f'ambiguidades mantidas fora: {ambiguas}')
    print(f'fonte  : {antes:>9,} bytes')
    print(f'publico: {depois:>9,} bytes')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
