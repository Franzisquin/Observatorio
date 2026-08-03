import sqlite3
import zipfile
import tempfile
import os

zpath = r"c:\mapas\Observatorio\resultados_geo\locais_votacao_2022_gpkg.zip"

with tempfile.TemporaryDirectory() as tmpdir:
    with zipfile.ZipFile(zpath, 'r') as z:
        gname = [n for n in z.namelist() if n.endswith('.gpkg')][0]
        gpath = z.extract(gname, tmpdir)
    
    conn = sqlite3.connect(gpath)
    cursor = conn.cursor()
    
    cols = [c[1] for c in cursor.execute("PRAGMA table_info('locais_votacao_2022_ENRIQUECIDO');").fetchall()]
    print("Columns:", cols)
    
    rows = cursor.execute("SELECT cod_localidade_ibge, nm_localidade, sg_uf FROM locais_votacao_2022_ENRIQUECIDO WHERE sg_uf = 'BA';").fetchall()
    
    pilao_rows = [r for r in set(rows) if 'PIL' in str(r[1]).upper() or 'ARCADO' in str(r[1]).upper()]
    for p in pilao_rows:
        print("BA Pilao row:", p, "repr:", repr(p[1]))
    
    conn.close()
