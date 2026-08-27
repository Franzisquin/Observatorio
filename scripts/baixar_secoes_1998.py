"""Baixa os brutos das eleicoes de 1998 do CDN do TSE para 'Resultados 1998/'.

Insumo de scripts/gerar_legislativas_1998.py e scripts/gerar_majoritarias_1998.py.
Sao ~494 MB e ficam fora do git (ver .gitignore): votacao_secao_1998_SP.zip sozinho
tem 113 MB, acima do limite do GitHub.

Conjuntos baixados:

  votacao_secao_1998_<UF>.zip          votos por secao (27 UFs) + _BR (exterior)
  consulta_cand_1998.zip               nome de urna, sigla, coligacao, situacao
  consulta_vagas_1998.zip              vagas por cargo e UF
  detalhe_votacao_munzona_1998.zip     validos/brancos/nulos oficiais por mun+zona
  votacao_partido_munzona_1998.zip     votos por partido (nominais + legenda)
  votacao_candidato_munzona_1998.zip   votos por candidato (conferencia)

O CDN do TSE fica atras do Akamai, que responde 403 a cliente sem fingerprint TLS
de navegador -- urllib, requests e curl caem todos nisso. Por isso o download usa
curl_cffi (impersonate='chrome'):

    pip install curl_cffi

Rodar de novo pula o que ja esta baixado (arquivo completo em disco).

    python scripts/baixar_secoes_1998.py --ufs AC SC
    python scripts/baixar_secoes_1998.py
"""

from __future__ import annotations

import argparse
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESTINO = os.path.join(RAIZ, 'Resultados 1998')
BASE = 'https://cdn.tse.jus.br/estatistica/sead/odsele'

UFS = [
    'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
    'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
]

# Datasets nacionais (um arquivo cada), na ordem em que os geradores precisam deles.
NACIONAIS = [
    f'{BASE}/votacao_secao/votacao_secao_1998_BR.zip',
    f'{BASE}/consulta_cand/consulta_cand_1998.zip',
    f'{BASE}/consulta_vagas/consulta_vagas_1998.zip',
    f'{BASE}/detalhe_votacao_munzona/detalhe_votacao_munzona_1998.zip',
    f'{BASE}/votacao_partido_munzona/votacao_partido_munzona_1998.zip',
    f'{BASE}/votacao_candidato_munzona/votacao_candidato_munzona_1998.zip',
]

BLOCO = 1 << 20  # 1 MiB


def _requests():
    try:
        from curl_cffi import requests
    except ImportError:
        sys.exit('curl_cffi nao instalado. O CDN do TSE recusa cliente sem TLS de '
                 'navegador (403); instale com: pip install curl_cffi')
    return requests


def baixar(requests, url, tentativas=3):
    """Baixa uma URL para DESTINO. Devolve True se o arquivo esta la ao final."""
    nome = url.rsplit('/', 1)[-1]
    destino = os.path.join(DESTINO, nome)
    if os.path.exists(destino) and os.path.getsize(destino) > 0:
        print(f'  [ja existe] {nome} ({os.path.getsize(destino) / 1e6:.1f} MB)', flush=True)
        return True

    parcial = destino + '.part'
    for tentativa in range(1, tentativas + 1):
        resposta = None
        try:
            resposta = requests.get(url, impersonate='chrome', timeout=1800, stream=True)
            if resposta.status_code != 200:
                raise RuntimeError(f'HTTP {resposta.status_code}')
            with open(parcial, 'wb') as fh:
                for bloco in resposta.iter_content(BLOCO):
                    fh.write(bloco)
            os.replace(parcial, destino)
            print(f'  [ok] {nome} ({os.path.getsize(destino) / 1e6:.1f} MB)', flush=True)
            return True
        except Exception as erro:  # rede, HTTP, disco -- todos valem nova tentativa
            print(f'  [tentativa {tentativa}/{tentativas}] {nome}: '
                  f'{type(erro).__name__} {str(erro)[:120]}', flush=True)
            if os.path.exists(parcial):
                os.remove(parcial)
        finally:
            if resposta is not None:
                resposta.close()
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ufs', nargs='*', default=UFS,
                    help='UFs dos arquivos por secao (padrao: todas)')
    ap.add_argument('--sem-nacionais', action='store_true',
                    help='baixa so os arquivos por secao das UFs pedidas')
    args = ap.parse_args()

    requests = _requests()
    os.makedirs(DESTINO, exist_ok=True)

    alvos = [f'{BASE}/votacao_secao/votacao_secao_1998_{uf.upper()}.zip'
             for uf in args.ufs]
    if not args.sem_nacionais:
        alvos += NACIONAIS

    falhas = [url.rsplit('/', 1)[-1] for url in alvos if not baixar(requests, url)]
    print('\nFalhas:', ', '.join(falhas) if falhas else '(nenhuma)')
    print('Arquivos em:', DESTINO)
    return 1 if falhas else 0


if __name__ == '__main__':
    sys.exit(main())
