import zipfile
with zipfile.ZipFile('resultados_geo/locais_votacao_2022_gpkg.zip') as z:
    print(z.namelist())
