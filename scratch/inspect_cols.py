import re
import zipfile
import geopandas as gpd

year = 2022
zip_path = fr'c:\Users\lixov\OneDrive\Documentos\Observatorio\resultados_geo\resultados_presidente_nacional_{year}.zip'
gdf = gpd.read_file(f'zip://{zip_path}')

print("Columns:")
for col in gdf.columns:
    print(col)
    
print("\nTesting Regex:")
for col in gdf.columns:
    if ' 1T' in col or ' 2T' in col:
        matches = re.findall(r'\((.*?)\)', col)
        if matches:
            party = matches[0]
            round_t = '1T' if ' 1T' in col else '2T'
            print(f"Col: {col} -> Party: {party}_{year}_{round_t}")
