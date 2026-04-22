import os
import re
import warnings
import pandas as pd
import geopandas as gpd

# Suppress pandas fragmentation warnings and others
warnings.simplefilter(action='ignore', category=pd.errors.PerformanceWarning)
warnings.simplefilter(action='ignore', category=UserWarning)

# Paths
gpkg_path = r'E:\Mapas\Mapas Fictícios\Brasil Distrital\513 - Equalizado\Brasil Unido.gpkg'
out_dir = r'E:\Mapas\Mapas Fictícios\Brasil Distrital\513 - Equalizado\Brasil com Dados'
out_file = os.path.join(out_dir, 'Brasil com Dados.gpkg')

os.makedirs(out_dir, exist_ok=True)

print(f"Loading polygons from {gpkg_path}...")
polygons = gpd.read_file(gpkg_path)

# Dictionary to hold all aggregated results for each polygon
agg_results = {idx: {} for idx in polygons.index}

years = [2006, 2010, 2014, 2018, 2022]
base_dir = r'c:\Users\lixov\OneDrive\Documentos\Observatorio\resultados_geo'

for year in years:
    print(f"\nProcessing year {year}...")
    zip_path = os.path.join(base_dir, f'resultados_presidente_nacional_{year}.zip')
    
    if not os.path.exists(zip_path):
        print(f"File {zip_path} not found. Skipping...")
        continue
        
    print(f"Loading points for {year}...")
    try:
        points = gpd.read_file(f'zip://{zip_path}')
    except Exception as e:
        print(f"Error loading {year}: {e}")
        continue
    
    # Ensure CRS matches
    if points.crs != polygons.crs:
        print(f"Aligning CRS for {year}...")
        points = points.to_crs(polygons.crs)
        
    print(f"Spatial join for {year}...")
    # Fix potentially invalid geometries
    polygons['geometry'] = polygons.geometry.buffer(0)
    
    joined = gpd.sjoin(points, polygons, how='inner', predicate='within')
    print(f"Found {len(joined)} matching points inside polygons out of {len(points)}.")
    
    # Identify vote columns
    vote_cols_1t = []
    vote_cols_2t = []
    col_mapping = {}
    
    for col in points.columns:
        if ' 1T' in col or ' 2T' in col:
            # Check if it's a candidate column
            matches = re.findall(r'\((.*?)\)', col)
            round_t = '1T' if ' 1T' in col else '2T'
            
            if matches:
                party = matches[0].strip()
                new_col = f"{party}_{year}_{round_t}"
                col_mapping[col] = new_col
                
                # Make sure it's numeric
                joined[col] = pd.to_numeric(joined[col], errors='coerce').fillna(0)
                
                if round_t == '1T':
                    vote_cols_1t.append(col)
                else:
                    vote_cols_2t.append(col)
            else:
                # Other numerical columns like Total_Votos_Validos 1T
                base_name = col.replace(f' {round_t}', '').strip().replace(' ', '_')
                new_col = f"{base_name}_{year}_{round_t}"
                col_mapping[col] = new_col
                joined[col] = pd.to_numeric(joined[col], errors='coerce').fillna(0)
                
    # Group by polygon index
    print(f"Aggregating data for {year}...")
    grouped = joined.groupby('index_right')
    
    # Sum all the required columns
    all_cols = list(col_mapping.keys())
    summed = grouped[all_cols].sum()
    
    # Process each polygon
    for idx, row in summed.iterrows():
        # Store summed columns
        for col in all_cols:
            agg_results[idx][col_mapping[col]] = row[col]
            
        # Calculate winner and margin for 1T
        if vote_cols_1t:
            votes_1t = [(col_mapping[c], row[c]) for c in vote_cols_1t]
            votes_1t.sort(key=lambda x: x[1], reverse=True)
            winner_1t_party = votes_1t[0][0].split('_')[0]
            agg_results[idx][f'VENCEDOR_{year}_1T'] = winner_1t_party
            
            total_1t = sum([v[1] for v in votes_1t])
            if total_1t > 0:
                if len(votes_1t) > 1:
                    margin = ((votes_1t[0][1] - votes_1t[1][1]) / total_1t) * 100
                else:
                    margin = 100.0
                agg_results[idx][f'MARGEM_{year}_1T'] = margin
            else:
                agg_results[idx][f'MARGEM_{year}_1T'] = 0.0
                
        # Calculate winner and margin for 2T
        if vote_cols_2t:
            votes_2t = [(col_mapping[c], row[c]) for c in vote_cols_2t]
            votes_2t.sort(key=lambda x: x[1], reverse=True)
            winner_2t_party = votes_2t[0][0].split('_')[0]
            agg_results[idx][f'VENCEDOR_{year}_2T'] = winner_2t_party
            
            total_2t = sum([v[1] for v in votes_2t])
            if total_2t > 0:
                if len(votes_2t) > 1:
                    margin = ((votes_2t[0][1] - votes_2t[1][1]) / total_2t) * 100
                else:
                    margin = 100.0
                agg_results[idx][f'MARGEM_{year}_2T'] = margin
            else:
                agg_results[idx][f'MARGEM_{year}_2T'] = 0.0

print("\nAppending results to polygons...")
df_results = pd.DataFrame.from_dict(agg_results, orient='index')

# Fill NaN with 0 for vote columns or margem columns, and empty string for string columns
# But pandas will handle that if we want, or we can just leave NaN. GeoPackage translates NaN to NULL.
# But 0 votes is more correct than NULL votes. Let's leave as is to differentiate "0 votes" from "no data".

# Merge back with the polygons dataframe
final_polygons = polygons.join(df_results)

print(f"Saving to {out_file}...")
final_polygons.to_file(out_file, driver="GPKG")
print("Process completed successfully!")
