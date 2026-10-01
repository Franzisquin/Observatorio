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
        # Municipal em 2000 unidades e coordenada inteira (gerar_malhas_apuracao.py,
        # LARGURA_MUN); as regionais em 1000, na mesma proporcao.
        assert malha['w'] == 2000, f'{nome}: viewBox fora do padrao'
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

    # Ilhas oceanicas: Trindade e Martim Vaz fora de Vitoria (ES), e Fernando de
    # Noronha (PE) num quadro, nas tres camadas e no mesmo lugar de cada uma.
    for uf in ('ES', 'PE'):
        camadas = [os.path.join(SVG_DIR, f'municipios_{uf}.json')] + [
            os.path.join(BASE_DIR, 'resultados_geo', 'regioes_svg', f'{n}_{uf}.json')
            for n in ('rgint', 'rgi')]
        proporcoes = set()
        quadros = set()
        for caminho in camadas:
            with open(caminho, encoding='utf-8') as f:
                m = json.load(f)
            proporcoes.add(round(m['h'] / m['w'], 2))
            quadros.add(tuple(round(v / m['w'], 3) for v in (m.get('q') or [[0, 0, 0, 0]])[0][:4]))
            nums = [float(v) for _, _, d, *_ in m['p'] for v in re.findall(r'-?[\d.]+', d)]
            assert min(nums) >= -1 and max(nums) <= max(m['w'], m['h']) + 1,                 f'{caminho}: desenho fora do viewBox'
        assert len(proporcoes) == 1, f'{uf}: camadas com proporcoes diferentes {proporcoes}'
        assert len(quadros) == 1, f'{uf}: quadro em lugar diferente por camada {quadros}'
        assert (uf == 'PE') == any(quadros.pop()), f'{uf}: quadro de ilha inesperado'
    # ES sem Trindade: o estado tem mais altura que largura, como no mapa.
    with open(os.path.join(SVG_DIR, 'municipios_ES.json'), encoding='utf-8') as f:
        es = json.load(f)
    assert es['h'] > es['w'], 'ES ainda enquadra Trindade e Martim Vaz'

    print(f'OK: {len(arquivos)} UFs, {len(todos)} municipios, ponte TSE coberta.')


if __name__ == '__main__':
    sys.exit(main())
