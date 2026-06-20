"""
Gera js/municipal-aliases-2000-2004.js e deduplica lista_municipios.json.

Casa os municipios por CODIGO TSE (estavel entre 2000/2004 e 2008) e, onde a
GRAFIA do nome difere entre os anos, cria um grupo de aliases bidirecionais para
que o nome moderno (usado em 2008-2024) encontre o arquivo de 2000/2004 (gravado
com a grafia da epoca) e vice-versa. Tambem remove da lista de municipios as
grafias antigas que ja tem um nome moderno equivalente (evita entradas duplicadas
no seletor).

Rode depois de gerar_municipais_2000_2004.py.
"""
import json
import os
import re
import unicodedata
import zipfile
from collections import defaultdict

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO_DIR = os.path.join(BASE_DIR, 'resultados_geo')
JS_OUT = os.path.join(BASE_DIR, 'js', 'municipal-aliases-2000-2004.js')
LISTA = os.path.join(BASE_DIR, 'lista_municipios.json')

# AMAPARI (AP) conflita com o alias manual de Pedra Branca do Amapari
SKIP_SLUGS = {'AMAPARI'}


def slug(v):
    s = unicodedata.normalize('NFD', str(v))
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^A-Z0-9]+', '_', s.upper()).strip('_')


def code_slug(year):
    out = defaultdict(dict)
    import glob
    for zp in glob.glob(os.path.join(GEO_DIR, f'Municipais {year}', f'prefeito_{year}_ord_t1_*.zip')):
        uf = re.search(r'_([A-Z]{2})\.zip$', zp).group(1)
        for n in zipfile.ZipFile(zp).namelist():
            if n.endswith('.json') and not n.endswith('_resumo.json'):
                m = re.match(r'(\d+)_(.+)\.json$', n)
                if m:
                    out[uf][m.group(1)] = m.group(2)
    return out


def main():
    m08 = code_slug(2008)
    m04 = code_slug(2004)
    m00 = code_slug(2000)

    groups = []
    holes = []
    for uf in sorted(m08):
        for code, modern in m08[uf].items():
            olds = {mm[uf][code] for mm in (m00, m04) if code in mm.get(uf, {})}
            allslugs = sorted({modern} | olds)
            if not olds:
                holes.append((uf, modern))
            elif len(allslugs) > 1 and not (set(allslugs) & SKIP_SLUGS):
                groups.append((uf, modern, allslugs))

    # arquivo JS
    js = [
        '// === Aliases por codigo TSE: grafias 2000/2004 <-> nome moderno ===',
        '// Gerado por scripts/gen_aliases_municipais.py (casamento por codigo do municipio).',
        '// Requer MUNICIPAL_NAME_ALIASES (definido em data-municipal.js).',
        '(function () {',
        '  const groups = [',
    ]
    for uf, m, a in groups:
        js.append('    ' + json.dumps(a, ensure_ascii=False) + ',')
    js += [
        '  ];',
        '  if (typeof MUNICIPAL_NAME_ALIASES === "undefined") return;',
        '  for (const g of groups) for (const k of g) {',
        '    const arr = MUNICIPAL_NAME_ALIASES[k] || [k];',
        '    for (const v of g) if (!arr.includes(v)) arr.push(v);',
        '    MUNICIPAL_NAME_ALIASES[k] = arr;',
        '  }',
        '})();',
    ]
    with open(JS_OUT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(js) + '\n')

    # dedup lista
    oldmap = {}
    for uf, m, a in groups:
        for s in a:
            if s != m:
                oldmap.setdefault((uf, s), m)
    lista = json.load(open(LISTA, encoding='utf-8'))
    removed = 0
    for uf in lista:
        keep = [n for n in lista[uf] if (uf, slug(n)) not in oldmap]
        removed += len(lista[uf]) - len(keep)
        lista[uf] = sorted(set(keep))
    json.dump(lista, open(LISTA, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

    print(f'Aliases: {len(groups)} grupos -> {JS_OUT}')
    print(f'Lista dedup: {removed} nomes antigos removidos')
    print(f'Buracos reais (so em 2008, ausentes em 2000 E 2004): {len(holes)} -> '
          + ', '.join(f'{u}:{n}' for u, n in holes))


if __name__ == '__main__':
    main()
