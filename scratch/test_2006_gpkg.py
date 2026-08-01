import zipfile
import sqlite3
import tempfile
import os

with zipfile.ZipFile('resultados_geo/locais_votacao_2006_gkpg.zip') as z:
    gpkg_name = [f for f in z.namelist() if f.endswith('.gpkg')][0]
    z.extract(gpkg_name, 'scratch')

gpkg_path = os.path.join('scratch', gpkg_name)
conn = sqlite3.connect(gpkg_path)
c = conn.cursor()
c.execute("SELECT local_key, nm_localidade, cod_localidade_ibge FROM locais_votacao_2006_padronizado WHERE sg_uf='PR' LIMIT 5")
rows = c.fetchall()
print('Sample 2006 GPKG rows:', rows)

c.execute("SELECT count(distinct cod_localidade_ibge) FROM locais_votacao_2006_padronizado WHERE sg_uf='PR'")
print('Unique IBGE codes in 2006 PR GPKG:', c.fetchone())
conn.close()
