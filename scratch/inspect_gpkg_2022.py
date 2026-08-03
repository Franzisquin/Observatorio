import os
import zipfile
import sqlite3
import tempfile

zpath = r"c:\mapas\Observatorio\resultados_geo\locais_votacao_2022_gpkg.zip"

if os.path.exists(zpath):
    print("Extracting gpkg from zip...")
    with zipfile.ZipFile(zpath, 'r') as z:
        for zname in z.namelist():
            if zname.endswith('.gpkg'):
                with tempfile.TemporaryDirectory() as tmpdir:
                    extracted = z.extract(zname, tmpdir)
                    print(f"Extracted {extracted}")
                    conn = sqlite3.connect(extracted)
                    cursor = conn.cursor()
                    tables = [t[0] for t in cursor.execute("SELECT name FROM sqlite_master WHERE type='table';").fetchall()]
                    print("Tables in GPKG:", tables)
                    for t in tables:
                        if 'locais' in t.lower() or 'votacao' in t.lower() or t not in ['gpkg_spatial_ref_sys', 'gpkg_contents', 'gpkg_geometry_columns', 'sqlite_sequence']:
                            # Query Pilão Arcado or BA
                            try:
                                rows = cursor.execute(f"SELECT nm_localidade, cod_localidade_ibge FROM {t} WHERE UPPER(nm_localidade) LIKE '%PIL%' OR UPPER(nm_localidade) LIKE '%ARCADO%' LIMIT 10;").fetchall()
                                for r in rows:
                                    print(f"  Result in {t}: {r} (repr: {repr(r[0])})")
                            except Exception as ex:
                                print(f" Error querying {t}: {ex}")
                    conn.close()
