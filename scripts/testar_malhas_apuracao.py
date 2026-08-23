# -*- coding: utf-8 -*-
"""
Confere as malhas de resultados_geo/municipios_svg: geometria bem formada e,
sobretudo, cobertura — todo municipio que a ponte TSE->IBGE conhece precisa ter
um path, senao o mapa da apuracao fica com buraco na noite da eleicao.

  py scripts/testar_malhas_apuracao.py
"""

import json
import os
import re
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SVG_DIR = os.path.join(BASE_DIR, 'resultados_geo', 'municipios_svg')
PONTE = os.path.join(BASE_DIR, 'resultados_geo', 'tse_para_ibge.json')

PATH_OK = re.compile(r'^(M[-\d. ]+Z)+$')


def main():
    arquivos = sorted(f for f in os.listdir(SVG_DIR) if f.endswith('.json'))
    assert len(arquivos) == 27, f'esperava 27 UFs, achei {len(arquivos)}'

    todos = set()
    for nome in arquivos:
        with open(os.path.join(SVG_DIR, nome), encoding='utf-8') as f:
            malha = json.load(f)
        assert malha['w'] == 1000, f'{nome}: viewBox fora do padrao'
        assert malha['h'] > 0, f'{nome}: altura invalida'
        assert malha['p'], f'{nome}: sem municipios'
        for cd, nm, d in malha['p']:
            assert re.fullmatch(r'\d{7}', cd), f'{nome}: codigo IBGE invalido {cd!r}'
            assert nm, f'{nome}: {cd} sem nome'
            assert PATH_OK.match(d), f'{nome}: {cd} com path malformado'
            assert cd not in todos, f'{nome}: {cd} duplicado'
            todos.add(cd)

    # 5570 do censo de 2022 mais Boa Esperanca do Norte/MT, instalada depois.
    assert len(todos) == 5571, f'esperava 5571 municipios, montei {len(todos)}'

    with open(PONTE, encoding='utf-8') as f:
        ibges = set(json.load(f).values())
    faltando = ibges - todos
    assert not faltando, f'{len(faltando)} municipios do TSE sem geometria: {sorted(faltando)[:8]}'

    print(f'OK: {len(arquivos)} UFs, {len(todos)} municipios, ponte TSE coberta.')


if __name__ == '__main__':
    sys.exit(main())
