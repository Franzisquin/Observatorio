import os
import re
import warnings
import pandas as pd
import geopandas as gpd

warnings.simplefilter(action='ignore', category=pd.errors.PerformanceWarning)
warnings.simplefilter(action='ignore', category=UserWarning)

gpkg_path = r'E:\Mapas\Mapas Fictícios\Brasil Distrital\513 - Equalizado\Brasil Unido.gpkg'
out_dir = r'E:\Mapas\Mapas Fictícios\Brasil Distrital\513 - Equalizado\Brasil com Dados'
out_file = os.path.join(out_dir, 'Brasil com Dados.gpkg')

os.makedirs(out_dir, exist_ok=True)

print(f"Loading polygons from {gpkg_path}...")
polygons = gpd.read_file(gpkg_path)

agg_results = {idx: {} for idx in polygons.index}

years = [2006, 2010, 2014, 2018, 2022]
base_dir = r'c:\Users\lixov\OneDrive\Documentos\Observatorio\resultados_geo'

for year in years:
    print(f"Processing year {year}...")
    zip_path = os.path.join(base_dir, f'resultados_presidente_nacional_{year}.zip')
    if not os.path.exists(zip_path): continue
    
    points = gpd.read_file(f'zip://{zip_path}')
    if points.crs != polygons.crs:
        points = points.to_crs(polygons.crs)
        
    polygons['geometry'] = polygons.geometry.buffer(0)
    joined = gpd.sjoin(points, polygons, how='inner', predicate='within')
    
    vote_cols_1t = []
    vote_cols_2t = []
    col_mapping = {}
    
    for col in points.columns:
        if ' 1T' in col or ' 2T' in col:
            matches = re.findall(r'\((.*?)\)', col)
            round_t = '1T' if ' 1T' in col else '2T'
            if matches:
                party = matches[0].strip()
                new_col = f"{party}_{year}_{round_t}"
                col_mapping[col] = new_col
                joined[col] = pd.to_numeric(joined[col], errors='coerce').fillna(0)
                if round_t == '1T': vote_cols_1t.append(col)
                else: vote_cols_2t.append(col)
            else:
                base_name = col.replace(f' {round_t}', '').strip().replace(' ', '_')
                new_col = f"{base_name}_{year}_{round_t}"
                col_mapping[col] = new_col
                joined[col] = pd.to_numeric(joined[col], errors='coerce').fillna(0)
                
    grouped = joined.groupby('index_right')
    all_cols = list(col_mapping.keys())
    summed = grouped[all_cols].sum()
    
    for idx, row in summed.iterrows():
        for col in all_cols:
            agg_results[idx][col_mapping[col]] = row[col]
            
        if vote_cols_1t:
            votes_1t = [(col_mapping[c], row[c]) for c in vote_cols_1t]
            votes_1t.sort(key=lambda x: x[1], reverse=True)
            winner_1t_party = votes_1t[0][0].split('_')[0]
            agg_results[idx][f'VENCEDOR_{year}_1T'] = winner_1t_party
            total_1t = sum([v[1] for v in votes_1t])
            margin = ((votes_1t[0][1] - votes_1t[1][1]) / total_1t) * 100 if total_1t > 0 and len(votes_1t) > 1 else (100.0 if total_1t > 0 else 0.0)
            agg_results[idx][f'MARGEM_{year}_1T'] = margin
                
        if vote_cols_2t:
            votes_2t = [(col_mapping[c], row[c]) for c in vote_cols_2t]
            votes_2t.sort(key=lambda x: x[1], reverse=True)
            winner_2t_party = votes_2t[0][0].split('_')[0]
            agg_results[idx][f'VENCEDOR_{year}_2T'] = winner_2t_party
            total_2t = sum([v[1] for v in votes_2t])
            margin = ((votes_2t[0][1] - votes_2t[1][1]) / total_2t) * 100 if total_2t > 0 and len(votes_2t) > 1 else (100.0 if total_2t > 0 else 0.0)
            agg_results[idx][f'MARGEM_{year}_2T'] = margin

df_results = pd.DataFrame.from_dict(agg_results, orient='index')

# Fill NaN values for VENCEDOR columns with empty strings so they don't break string type schemas
for col in df_results.columns:
    if col.startswith('VENCEDOR_'):
        df_results[col] = df_results[col].fillna('')
    else:
        # Numeric columns can just have NaN filled with 0
        df_results[col] = df_results[col].fillna(0.0)

final_polygons = polygons.join(df_results)

# Reorder columns: VENCEDOR_ ao final
winner_cols = [col for col in final_polygons.columns if 'VENCEDOR_' in col]
geom_col = [final_polygons.geometry.name]
other_cols = [col for col in final_polygons.columns if col not in winner_cols and col not in geom_col]

final_polygons = final_polygons[other_cols + winner_cols + geom_col]

print(f"Saving to {out_file}...")
try:
    final_polygons.to_file(out_file, driver="GPKG")
    print("Process completed successfully!")
except Exception as e:
    print(f"Error saving to GPKG: {e}")
