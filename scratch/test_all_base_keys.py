import zipfile
import json
import sqlite3

# Load SQLite GPKG locations
conn = sqlite3.connect('file:resultados_geo/locais_votacao_2022_gpkg.zip?mode=ro', uri=True)
c = conn.cursor()

# Test AC features in SQLite
c.execute("SELECT sg_uf, cod_localidade_ibge, nr_zona, nr_locvot, nm_localidade, nm_locvot, long, lat FROM locais_votacao_2022_ENRIQUECIDO WHERE sg_uf='AC' LIMIT 5")
rows = c.fetchall()
print("SQLite AC sample rows:", rows)

# Test Censo 2022 AC JSON keys
with zipfile.ZipFile('resultados_geo/Censo 2022/censo_2022_AC.zip') as z:
    with z.open('censo_2022_AC.json') as f:
        censo = json.load(f)

print("Censo AC RESULTS sample keys:", list(censo.get('RESULTS', {}).keys())[:10])

# Test Presidente 2022 AC JSON keys
with zipfile.ZipFile('resultados_geo/resultados_presidente_nacional_2022.zip') as z:
    for name in z.namelist():
        if 'presidente' in name and name.endswith('.geojson'):
            with z.open(name) as f:
                geo = json.load(f)
                ac_f = [feat for feat in geo['features'] if feat['properties'].get('SG_UF') == 'AC' or feat['properties'].get('sg_uf') == 'AC']
                print("GeoJSON file feature count for AC:", len(ac_f))
                if ac_f:
                    print("GeoJSON feature props sample keys:", list(ac_f[0]['properties'].keys())[:15])
                    print("GeoJSON feature id_unico / local_id / local_key:", ac_f[0]['properties'].get('id_unico'), ac_f[0]['properties'].get('local_id'), ac_f[0]['properties'].get('local_key'))
