import zipfile

with zipfile.ZipFile('resultados_geo/resultados_presidente_nacional_2022.zip') as z:
    print('2022 zip contents:', z.namelist()[:5])

with zipfile.ZipFile('resultados_geo/locais_votacao_2022_1.zip') as z:
    print('locais 2022_1 zip contents:', z.namelist()[:5])
