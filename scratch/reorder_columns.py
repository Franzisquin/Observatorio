import os
import geopandas as gpd

file_path = r'E:\Mapas\Mapas Fictícios\Brasil Distrital\513 - Equalizado\Brasil com Dados\Brasil com Dados.gpkg'

print(f"Lendo o arquivo: {file_path}")
gdf = gpd.read_file(file_path)

# Separar colunas em diferentes grupos
winner_cols = [col for col in gdf.columns if 'VENCEDOR_' in col]
geom_col = [gdf.geometry.name] # geralmente 'geometry'
other_cols = [col for col in gdf.columns if col not in winner_cols and col not in geom_col]

# Nova ordem das colunas: todas exceto vencedores e geometria -> vencedores -> geometria
new_order = other_cols + winner_cols + geom_col

print("Reordenando as colunas...")
gdf = gdf[new_order]

print("Salvando o arquivo atualizado...")
gdf.to_file(file_path, driver="GPKG")
print("Processo concluído com sucesso!")
