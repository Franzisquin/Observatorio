"""
Patch rapido: injeta METADATA.official_votes (totais COMPLETOS por candidato) nos
JSONs de vereador ja gerados, lendo apenas o votacao_candidato_munzona (arquivos
pequenos) — sem reler as secoes nem refazer o mapeamento de 2006.

Os totais municipais por candidato do munzona = soma de todas as zonas
(inclusive secoes sem geolocalizacao), que e exatamente o "resultado geral".

Uso:
  py scripts/patch_vereador_official_votes.py                 (2000 e 2004, todas UFs)
  py scripts/patch_vereador_official_votes.py --years 2000 --ufs TO,AL
"""
import argparse
import json
import os
import re
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gerar_municipais_2000_2004 import (  # noqa: E402
    parse_munzona, load_modern_name_to_code, GEO_DIR, ALL_UFS,
)


def patch_uf_year(uf, year):
    zip_path = os.path.join(GEO_DIR, f'Municipais_Legislativas {year}',
                            f'vereadores_{year}_{uf}.zip')
    if not os.path.exists(zip_path):
        return None

    _, mz_votes, _ = parse_munzona(uf, year, load_modern_name_to_code(uf))
    votes_by_cdmun = {}
    for (cdmun, mode), turnos in mz_votes.items():
        if mode != 'vereador':
            continue
        votes_by_cdmun[cdmun] = {str(k): int(v) for k, v in turnos.get(1, {}).items()}

    with zipfile.ZipFile(zip_path) as zin:
        entries = [(n, zin.read(n)) for n in zin.namelist()]

    patched = 0
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries:
            if name.endswith('.json') and not name.endswith('_resumo.json'):
                m = re.search(r'_(\d+)\.json$', name)
                cd = int(m.group(1)) if m else None
                ov = votes_by_cdmun.get(cd)
                if ov:
                    try:
                        j = json.loads(data)
                        j.setdefault('METADATA', {})['official_votes'] = ov
                        data = json.dumps(j, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
                        patched += 1
                    except Exception as e:
                        print(f'    [erro {name}]: {e}')
            zf.writestr(name, data)
    return patched


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--years', default='2000,2004')
    ap.add_argument('--ufs', default=','.join(ALL_UFS))
    args = ap.parse_args()
    years = [int(y) for y in args.years.split(',') if y.strip()]
    ufs = [u.strip().upper() for u in args.ufs.split(',') if u.strip()]

    for year in years:
        for uf in ufs:
            n = patch_uf_year(uf, year)
            if n is not None:
                print(f'  {uf} {year}: official_votes em {n} municipios')
    print('CONCLUIDO.')


if __name__ == '__main__':
    main()
