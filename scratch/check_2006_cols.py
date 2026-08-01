import sqlite3
import os

gpkg_path = os.path.join('scratch', 'locais_votacao_2006.gpkg')
conn = sqlite3.connect(gpkg_path)
c = conn.cursor()
c.execute("PRAGMA table_info(locais_votacao_2006_padronizado)")
cols = [r[1] for r in c.fetchall()]
print('2006 columns:', cols)

c.execute("SELECT * FROM locais_votacao_2006_padronizado WHERE sg_uf='PR' LIMIT 2")
rows = c.fetchall()
print('Sample row:', rows)
conn.close()
