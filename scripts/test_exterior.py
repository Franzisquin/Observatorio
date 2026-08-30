"""Confere os arquivos do voto no exterior ja gerados, sem precisar dos brutos.

O gerador (gerar_majoritarias_exterior.py) valida a agregacao contra o parquet
do TSE, mas so quem tem os brutos consegue roda-lo. Este teste checa o que fica
COMMITADO e o que o front-end de fato le -- e por isso pega a classe de erro que
mais provavelmente aparece depois: um zip regerado contra uma malha ou uma
tabela de consulados que mudou desde entao.

  python scripts/test_exterior.py
"""

import json
import os
import sys
import zipfile

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO_DIR = os.path.join(BASE_DIR, 'resultados_geo')
ANOS_TURNOS = [(1989, 1), (1989, 2), (1994, 1),
               (1998, 1), (2002, 1), (2002, 2), (2006, 1), (2006, 2), (2010, 1),
               (2010, 2), (2014, 1), (2014, 2), (2018, 1), (2018, 2),
               (2022, 1), (2022, 2)]


def main():
    with open(os.path.join(GEO_DIR, 'paises_mundo.geojson'), encoding='utf-8') as fh:
        iso3_malha = {f['properties']['iso3'] for f in json.load(fh)['features']}
    assert len(iso3_malha) > 200, f'malha com poucos paises: {len(iso3_malha)}'

    for ano, turno in ANOS_TURNOS:
        base = f'presidente_{ano}_t{turno}_ZZ'
        caminho = os.path.join(GEO_DIR, f'Majoritarias {ano}', f'{base}.zip')
        assert os.path.exists(caminho), f'faltando: {caminho}'

        with zipfile.ZipFile(caminho) as zf:
            dados = json.loads(zf.read(f'{base}.json'))
            resumo = json.loads(zf.read(f'{base}_resumo.json'))

        cand_names = dados['METADATA']['cand_names']
        results = dados['RESULTS']
        # Ate 1994 nao ha bloco CONSULADOS: o boletim agrega por pais e o mapa
        # desses anos nao desenha pontos.
        consulados = dados.get('CONSULADOS', [])
        assert bool(consulados) == (ano >= 1998),             f'{base}: CONSULADOS {"faltando" if ano >= 1998 else "nao deveria existir"}'

        orfaos = sorted(set(results) - iso3_malha)
        assert not orfaos, f'{base}: paises fora da malha: {orfaos}'

        soma_pais = sum(sum(v.values()) for v in results.values())
        soma_totais = sum(resumo['TOTALS'].values())
        assert soma_pais == soma_totais, (
            f'{base}: paises={soma_pais} totais={soma_totais}')
        if consulados:
            soma_cons = sum(sum(c['votos'].values()) for c in consulados)
            assert soma_cons == soma_pais, (
                f'{base}: consulados={soma_cons} paises={soma_pais}')

        sem_meta = sorted(k for k in resumo['TOTALS'] if k not in cand_names)
        assert not sem_meta, f'{base}: votos sem metadados: {sem_meta}'

        for c in consulados:
            assert c['iso3'] in iso3_malha, f"{base}: {c['nome']} -> {c['iso3']} fora da malha"
            assert -90 <= c['lat'] <= 90 and -180 <= c['lng'] <= 180, \
                f"{base}: coordenada invalida em {c['nome']}"

        # Uma urna consular ocupa um ponto so: coordenadas repetidas virariam
        # circulos empilhados, invisiveis um sob o outro.
        pontos = [(c['lat'], c['lng']) for c in consulados]
        assert len(pontos) == len(set(pontos)), f'{base}: consulados na mesma coordenada'

        # Chave com que o front-end identifica cada ponto: o codigo da urna, ou o
        # iso3 quando o ano nao tem urna (1989 e 1994). Repetida, todos os pontos
        # do mundo caem na mesma entrada e o mapa mostra o resultado de um pais so.
        chaves = [str(c['cd']) if c.get('cd') else c['iso3'] for c in consulados]
        assert len(chaves) == len(set(chaves)),             f'{base}: consulados com a mesma chave ({len(chaves) - len(set(chaves))} repetidas)'



        pontos = f'{len(consulados)} consulados, ' if consulados else 'sem pontos, '
        print(f'  {base}: {len(results)} paises, {pontos}{soma_pais} votos')

    print(f'\nOK -- {len(ANOS_TURNOS)} arquivos conferidos contra a malha de '
          f'{len(iso3_malha)} paises.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
